import { mkdir, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { z } from 'zod'

import { CspViolationObservationSchema, ExternalScriptObservationSchema, InlineScriptObservationSchema } from '../types/beacon.js'
import { createLogger, Logger } from '../utils/logger.js'

/**
 * Novel-observation queue message — the contract between the ingest Lambda
 * (producer) and `--mode rum-compare` (consumer).
 * See specs/011-real-user-script/contracts/queue-message.md.
 *
 * The observation is carried verbatim as validated at ingest, so its schemas
 * are reused from the beacon wire schema. `agent-health` observations are
 * never enqueued (contract), so the union deliberately excludes them — one
 * arriving here is a malformed message, not a routable observation.
 */
export const QueueMessageSchema = z.strictObject({
  v: z.literal(1),
  target_id: z.string().min(1),
  target_type: z.enum(['inventory', 'detection']),
  observation: z.discriminatedUnion('kind', [ExternalScriptObservationSchema, InlineScriptObservationSchema, CspViolationObservationSchema]),
  novelty: z.strictObject({
    pk: z.string().min(1),
    first_seen: z.number().int().positive(),
    first_route: z.string(),
  }),
  received_at: z.number().int().positive(),
  session_id: z.string().min(1),
})

export type QueueMessage = z.infer<typeof QueueMessageSchema>

/** One undecoded queue delivery, as handed over by a {@link QueueSource}. */
export interface RawQueueEntry {
  id: string
  body: string
  receiptHandle?: string
}

/**
 * Transport abstraction over the novel-observations queue. Implementations
 * must preserve the contract's delete discipline: an entry that is neither
 * `delete`d nor `deadLetter`ed is redelivered on a later drain.
 */
export interface QueueSource {
  receiveBatch(): Promise<RawQueueEntry[]>
  delete(entry: RawQueueEntry): Promise<void>
  deadLetter(entry: RawQueueEntry, reason: string): Promise<void>
}

/** Matches the SQS ReceiveMessage cap; the file source mirrors it for parity. */
const RECEIVE_BATCH_SIZE = 10

/**
 * SQS-backed queue source for deployed stacks.
 *
 * Visibility timeout is deliberately left to the queue configuration (it must
 * exceed a workflow run — an operational concern, not a consumer one), and the
 * short long-poll keeps the drain loop responsive when the queue is empty.
 */
export class SqsQueueSource implements QueueSource {
  constructor(
    private readonly queueUrl: string,
    private readonly client: SQSClient = new SQSClient({}),
    private readonly logger: Logger = createLogger('rum-queue'),
  ) {}

  async receiveBatch(): Promise<RawQueueEntry[]> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: RECEIVE_BATCH_SIZE,
        WaitTimeSeconds: 2,
      }),
    )

    return (response.Messages ?? [])
      .filter((message) => message.Body !== undefined && message.ReceiptHandle !== undefined)
      .map((message) => ({
        id: message.MessageId ?? '(no-message-id)',
        // Both narrowed by the filter above; the SDK types cannot express it.
        body: message.Body as string,
        receiptHandle: message.ReceiptHandle as string,
      }))
  }

  async delete(entry: RawQueueEntry): Promise<void> {
    if (entry.receiptHandle === undefined) {
      throw new Error(`cannot delete queue message ${entry.id}: no receipt handle`)
    }

    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: entry.receiptHandle,
      }),
    )
  }

  /**
   * The contract says malformed messages are routed to the DLQ and never
   * silently deleted. On SQS the redrive policy *is* that route: leaving the
   * message undeleted lets it reappear after the visibility timeout and land
   * in the DLQ once `maxReceiveCount` receives are exhausted. A direct
   * SendMessage to the DLQ is deliberately not implemented — it would need a
   * second queue binding and would erase the receive-count audit trail, while
   * not deleting already satisfies the contract's real requirement: the
   * message is never lost. So dead-lettering here is record-and-release.
   */
  async deadLetter(entry: RawQueueEntry, reason: string): Promise<void> {
    this.logger.warn(`leaving message ${entry.id} undeleted for DLQ redrive: ${reason}`)
  }
}

/**
 * file:// queue adapter for local development (quickstart §3): each queue
 * message is one `*.json` file in the directory; delete unlinks it and
 * dead-lettering moves it to `<dir>/dlq/`.
 *
 * A file is served at most once per source instance. That mirrors the SQS
 * visibility timeout within a single drain: an entry whose handler failed
 * stays on disk but is not re-served in the same run (which would loop
 * forever on a deterministic failure) — it is redelivered on the next run.
 */
export class FileQueueSource implements QueueSource {
  private readonly served = new Set<string>()

  constructor(
    private readonly dir: string,
    private readonly logger: Logger = createLogger('rum-queue'),
  ) {}

  async receiveBatch(): Promise<RawQueueEntry[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch (error) {
      // A missing directory is an empty local queue, not a failure.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }

    const fresh = names
      .filter((name) => name.endsWith('.json') && !this.served.has(name))
      .sort()
      .slice(0, RECEIVE_BATCH_SIZE)

    const entries: RawQueueEntry[] = []
    for (const name of fresh) {
      this.served.add(name)
      entries.push({ id: name, body: await readFile(join(this.dir, name), 'utf8') })
    }
    return entries
  }

  async delete(entry: RawQueueEntry): Promise<void> {
    await unlink(join(this.dir, entry.id))
  }

  async deadLetter(entry: RawQueueEntry, reason: string): Promise<void> {
    const dlqDir = join(this.dir, 'dlq')
    await mkdir(dlqDir, { recursive: true })
    await rename(join(this.dir, entry.id), join(dlqDir, entry.id))
    this.logger.warn(`moved ${entry.id} to dlq: ${reason}`)
  }
}

/**
 * Builds the queue source for a `--rum-queue-url` value: `file://` for the
 * local development adapter, `https://` for a real SQS queue URL.
 */
export function createQueueSource(url: string): QueueSource {
  if (url.startsWith('file://')) return new FileQueueSource(fileURLToPath(url))
  if (url.startsWith('https://')) return new SqsQueueSource(url)
  throw new Error(`unsupported queue URL scheme: ${url} (expected file:// or https://)`)
}

/** Outcome the routing handler reports for one validated message. */
export type DrainOutcome = 'routed' | 'skip-dlq'

export interface DrainCounts {
  received: number
  routed: number
  invalid: number
  failed: number
}

/**
 * Drains the queue and applies the contract's delete discipline:
 *
 * - a body that fails JSON parsing or schema validation is dead-lettered and
 *   counted `invalid` — never deleted, never handed to the handler;
 * - the entry is deleted only when the handler reports `'routed'` (outcome
 *   delivered downstream); `'skip-dlq'` dead-letters it and counts `failed`;
 * - a handler throw leaves the entry untouched for redelivery and counts
 *   `failed` — the drain continues with the next message;
 * - the loop stops on an empty receive, or after `maxBatches` batches.
 */
export async function drainQueue(source: QueueSource, handler: (message: QueueMessage, entry: RawQueueEntry) => Promise<DrainOutcome>, opts: { maxBatches?: number } = {}): Promise<DrainCounts> {
  const counts: DrainCounts = { received: 0, routed: 0, invalid: 0, failed: 0 }
  let batches = 0

  while (opts.maxBatches === undefined || batches < opts.maxBatches) {
    const entries = await source.receiveBatch()
    batches++
    if (entries.length === 0) break

    for (const entry of entries) {
      counts.received++

      let parsed: unknown
      try {
        parsed = JSON.parse(entry.body)
      } catch (error) {
        counts.invalid++
        await source.deadLetter(entry, `unparseable JSON body: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }

      const result = QueueMessageSchema.safeParse(parsed)
      if (!result.success) {
        counts.invalid++
        const detail = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
        await source.deadLetter(entry, `schema-invalid message: ${detail}`)
        continue
      }

      try {
        const outcome = await handler(result.data, entry)
        if (outcome === 'routed') {
          await source.delete(entry)
          counts.routed++
        } else {
          counts.failed++
          await source.deadLetter(entry, 'handler reported skip-dlq')
        }
      } catch {
        // No delete: the entry is redelivered on a later drain (and lands in
        // the DLQ after maxReceiveCount) — routing is idempotent by contract.
        counts.failed++
      }
    }
  }

  return counts
}
