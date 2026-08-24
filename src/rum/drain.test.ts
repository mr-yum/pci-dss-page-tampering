import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs'

import { createQueueSource, drainQueue, FileQueueSource, QueueMessage, QueueMessageSchema, QueueSource, RawQueueEntry, SqsQueueSource } from './drain.js'

const silentLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }

function validMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    target_id: '1.0',
    target_type: 'detection',
    observation: {
      kind: 'external-script',
      ts: 1755600000000,
      route: '/checkout',
      url: 'https://cdn.example.com/pixel.js',
    },
    novelty: {
      pk: '1.0#url:https://cdn.example.com/pixel.js',
      first_seen: 1755600000123,
      first_route: '/checkout',
    },
    received_at: 1755600000500,
    session_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    ...overrides,
  }
}

class FakeQueueSource implements QueueSource {
  receiveCalls = 0
  deleted: string[] = []
  deadLettered: { id: string; reason: string }[] = []

  constructor(private readonly batches: RawQueueEntry[][]) {}

  async receiveBatch(): Promise<RawQueueEntry[]> {
    this.receiveCalls++
    return this.batches.shift() ?? []
  }

  async delete(entry: RawQueueEntry): Promise<void> {
    this.deleted.push(entry.id)
  }

  async deadLetter(entry: RawQueueEntry, reason: string): Promise<void> {
    this.deadLettered.push({ id: entry.id, reason })
  }
}

describe('QueueMessageSchema', () => {
  it('accepts a valid detection message with an external-script observation', () => {
    expect(QueueMessageSchema.safeParse(validMessage()).success).toBe(true)
  })

  it('accepts inline-script and csp-violation observations', () => {
    const inline = validMessage({
      observation: { kind: 'inline-script', ts: 1755600000000, route: '/checkout', hash: 'a'.repeat(64), length: 42, head: 'window.x=1', tail: '=1' },
    })
    const csp = validMessage({
      observation: { kind: 'csp-violation', ts: 1755600000000, route: '/checkout', directive: 'script-src', blockedUri: 'https://evil.example.net/skim.js' },
    })

    expect(QueueMessageSchema.safeParse(inline).success).toBe(true)
    expect(QueueMessageSchema.safeParse(csp).success).toBe(true)
  })

  it('rejects agent-health observations — the contract never enqueues them', () => {
    const message = validMessage({
      observation: { kind: 'agent-health', ts: 1755600000000, route: '/checkout', p95TaskMs: 12, dropped: 0 },
    })

    expect(QueueMessageSchema.safeParse(message).success).toBe(false)
  })

  it('rejects an unknown message version', () => {
    expect(QueueMessageSchema.safeParse(validMessage({ v: 2 })).success).toBe(false)
  })

  it('rejects a target_type outside inventory/detection', () => {
    expect(QueueMessageSchema.safeParse(validMessage({ target_type: 'production' })).success).toBe(false)
  })
})

describe('drainQueue', () => {
  it('deletes only after the handler routes the outcome', async () => {
    const source = new FakeQueueSource([
      [
        { id: 'routes', body: JSON.stringify(validMessage()) },
        { id: 'throws', body: JSON.stringify(validMessage()) },
      ],
    ])
    const handler = jest.fn(async (_message: QueueMessage, entry: RawQueueEntry): Promise<'routed' | 'skip-dlq'> => {
      if (entry.id === 'throws') throw new Error('alert delivery failed')
      return 'routed'
    })

    const counts = await drainQueue(source, handler)

    expect(source.deleted).toEqual(['routes'])
    expect(source.deadLettered).toEqual([])
    expect(counts).toEqual({ received: 2, routed: 1, invalid: 0, failed: 1 })
  })

  it('dead-letters invalid JSON bodies and still processes the valid ones', async () => {
    const source = new FakeQueueSource([
      [
        { id: 'garbage', body: 'not json {' },
        { id: 'valid', body: JSON.stringify(validMessage()) },
      ],
    ])
    const handler = jest.fn().mockResolvedValue('routed')

    const counts = await drainQueue(source, handler)

    expect(source.deadLettered).toHaveLength(1)
    expect(source.deadLettered[0]!.id).toBe('garbage')
    expect(source.deadLettered[0]!.reason).toContain('unparseable JSON')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(source.deleted).toEqual(['valid'])
    expect(counts).toEqual({ received: 2, routed: 1, invalid: 1, failed: 0 })
  })

  it('dead-letters a message with an unknown version without calling the handler', async () => {
    const source = new FakeQueueSource([[{ id: 'v2', body: JSON.stringify(validMessage({ v: 2 })) }]])
    const handler = jest.fn()

    const counts = await drainQueue(source, handler)

    expect(source.deadLettered.map((d) => d.id)).toEqual(['v2'])
    expect(handler).not.toHaveBeenCalled()
    expect(counts).toEqual({ received: 1, routed: 0, invalid: 1, failed: 0 })
  })

  it('dead-letters a message carrying an agent-health observation', async () => {
    const message = validMessage({
      observation: { kind: 'agent-health', ts: 1755600000000, route: '/checkout', p95TaskMs: 12, dropped: 0 },
    })
    const source = new FakeQueueSource([[{ id: 'health', body: JSON.stringify(message) }]])
    const handler = jest.fn()

    const counts = await drainQueue(source, handler)

    expect(source.deadLettered.map((d) => d.id)).toEqual(['health'])
    expect(handler).not.toHaveBeenCalled()
    expect(counts.invalid).toBe(1)
  })

  it('dead-letters without deleting when the handler reports skip-dlq', async () => {
    const source = new FakeQueueSource([[{ id: 'skipped', body: JSON.stringify(validMessage()) }]])
    const handler = jest.fn().mockResolvedValue('skip-dlq')

    const counts = await drainQueue(source, handler)

    expect(source.deleted).toEqual([])
    expect(source.deadLettered.map((d) => d.id)).toEqual(['skipped'])
    expect(counts).toEqual({ received: 1, routed: 0, invalid: 0, failed: 1 })
  })

  it('stops when a receive returns empty', async () => {
    const source = new FakeQueueSource([[{ id: 'a', body: JSON.stringify(validMessage()) }], [{ id: 'b', body: JSON.stringify(validMessage()) }]])
    const handler = jest.fn().mockResolvedValue('routed')

    const counts = await drainQueue(source, handler)

    // Two batches with entries, then the empty receive that stops the loop.
    expect(source.receiveCalls).toBe(3)
    expect(counts).toEqual({ received: 2, routed: 2, invalid: 0, failed: 0 })
  })

  it('stops after maxBatches even when messages remain', async () => {
    const source = new FakeQueueSource([[{ id: 'a', body: JSON.stringify(validMessage()) }], [{ id: 'b', body: JSON.stringify(validMessage()) }]])
    const handler = jest.fn().mockResolvedValue('routed')

    const counts = await drainQueue(source, handler, { maxBatches: 1 })

    expect(source.receiveCalls).toBe(1)
    expect(counts.received).toBe(1)
  })
})

describe('FileQueueSource', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rum-drain-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads *.json files sorted by name', async () => {
    await writeFile(join(dir, 'b.json'), '{"second":true}')
    await writeFile(join(dir, 'a.json'), '{"first":true}')
    await writeFile(join(dir, 'notes.txt'), 'ignored')
    const source = new FileQueueSource(dir, silentLogger)

    const entries = await source.receiveBatch()

    expect(entries.map((e) => e.id)).toEqual(['a.json', 'b.json'])
    expect(entries[0]!.body).toBe('{"first":true}')
  })

  it('delete unlinks the file', async () => {
    await writeFile(join(dir, 'a.json'), '{}')
    const source = new FileQueueSource(dir, silentLogger)
    const [entry] = await source.receiveBatch()

    await source.delete(entry!)

    expect(await readdir(dir)).toEqual([])
  })

  it('deadLetter moves the file to <dir>/dlq/', async () => {
    await writeFile(join(dir, 'bad.json'), 'not json')
    const source = new FileQueueSource(dir, silentLogger)
    const [entry] = await source.receiveBatch()

    await source.deadLetter(entry!, 'unparseable')

    expect(await readdir(dir)).toEqual(['dlq'])
    expect(await readFile(join(dir, 'dlq', 'bad.json'), 'utf8')).toBe('not json')
  })

  it('does not re-serve a file within the same source instance', async () => {
    // Mirrors the SQS visibility timeout: a failed entry stays on disk for
    // the next run but must not spin the current drain loop forever.
    await writeFile(join(dir, 'a.json'), '{}')
    const source = new FileQueueSource(dir, silentLogger)

    expect(await source.receiveBatch()).toHaveLength(1)
    expect(await source.receiveBatch()).toEqual([])
  })

  it('treats a missing directory as an empty queue', async () => {
    const source = new FileQueueSource(join(dir, 'does-not-exist'), silentLogger)

    expect(await source.receiveBatch()).toEqual([])
  })
})

describe('SqsQueueSource', () => {
  function makeClient(send: jest.Mock): SQSClient {
    return { send } as unknown as SQSClient
  }

  it('receives with the SQS batch cap and a short long-poll, and maps messages to entries', async () => {
    const send = jest.fn().mockResolvedValue({
      Messages: [{ MessageId: 'm-1', Body: JSON.stringify(validMessage()), ReceiptHandle: 'rh-1' }],
    })
    const source = new SqsQueueSource('https://sqs.eu-west-1.amazonaws.com/123456789012/novel-observations', makeClient(send), silentLogger)

    const entries = await source.receiveBatch()

    expect(send).toHaveBeenCalledTimes(1)
    const command = send.mock.calls[0][0]
    expect(command).toBeInstanceOf(ReceiveMessageCommand)
    expect(command.input).toEqual({
      QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/novel-observations',
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 2,
    })
    expect(entries).toEqual([{ id: 'm-1', body: JSON.stringify(validMessage()), receiptHandle: 'rh-1' }])
  })

  it('routes then deletes on the happy path, and never deletes when the handler fails', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ Messages: [{ MessageId: 'm-1', Body: JSON.stringify(validMessage()), ReceiptHandle: 'rh-1' }] })
      .mockResolvedValueOnce({}) // DeleteMessage
      .mockResolvedValueOnce({ Messages: [] }) // empty receive stops the drain
    const source = new SqsQueueSource('https://sqs.example.test/q', makeClient(send), silentLogger)

    const counts = await drainQueue(source, async () => 'routed')

    const deleteCommands = send.mock.calls.map((call) => call[0]).filter((command) => command instanceof DeleteMessageCommand)
    expect(deleteCommands).toHaveLength(1)
    expect(deleteCommands[0]!.input).toEqual({ QueueUrl: 'https://sqs.example.test/q', ReceiptHandle: 'rh-1' })
    expect(counts).toEqual({ received: 1, routed: 1, invalid: 0, failed: 0 })

    // Handler failure: the message must stay on the queue for redelivery.
    const failingSend = jest
      .fn()
      .mockResolvedValueOnce({ Messages: [{ MessageId: 'm-2', Body: JSON.stringify(validMessage()), ReceiptHandle: 'rh-2' }] })
      .mockResolvedValueOnce({ Messages: [] })
    const failingSource = new SqsQueueSource('https://sqs.example.test/q', makeClient(failingSend), silentLogger)

    const failedCounts = await drainQueue(failingSource, async () => {
      throw new Error('routing failed')
    })

    expect(failingSend.mock.calls.map((call) => call[0]).some((command) => command instanceof DeleteMessageCommand)).toBe(false)
    expect(failedCounts).toEqual({ received: 1, routed: 0, invalid: 0, failed: 1 })
  })

  it('deadLetter records the message and sends no command — redrive moves it after maxReceiveCount', async () => {
    const send = jest.fn()
    const warn = jest.fn()
    const source = new SqsQueueSource('https://sqs.example.test/q', makeClient(send), { ...silentLogger, warn })

    await source.deadLetter({ id: 'm-1', body: '{', receiptHandle: 'rh-1' }, 'unparseable JSON')

    expect(send).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unparseable JSON'))
  })

  it('refuses to delete an entry without a receipt handle', async () => {
    const send = jest.fn()
    const source = new SqsQueueSource('https://sqs.example.test/q', makeClient(send), silentLogger)

    await expect(source.delete({ id: 'm-1', body: '{}' })).rejects.toThrow('no receipt handle')
    expect(send).not.toHaveBeenCalled()
  })

  it('skips received messages missing a body or receipt handle', async () => {
    const send = jest.fn().mockResolvedValue({
      Messages: [
        { MessageId: 'm-1', ReceiptHandle: 'rh-1' },
        { MessageId: 'm-2', Body: '{}' },
        { MessageId: 'm-3', Body: '{}', ReceiptHandle: 'rh-3' },
      ],
    })
    const source = new SqsQueueSource('https://sqs.example.test/q', makeClient(send), silentLogger)

    const entries = await source.receiveBatch()

    expect(entries.map((e) => e.id)).toEqual(['m-3'])
  })
})

describe('createQueueSource', () => {
  it('builds a FileQueueSource for file:// URLs', () => {
    expect(createQueueSource('file:///tmp/queue')).toBeInstanceOf(FileQueueSource)
  })

  it('builds an SqsQueueSource for https:// SQS URLs', () => {
    expect(createQueueSource('https://sqs.eu-west-1.amazonaws.com/123456789012/novel-observations')).toBeInstanceOf(SqsQueueSource)
  })

  it('rejects other schemes', () => {
    expect(() => createQueueSource('s3://bucket/queue')).toThrow('unsupported queue URL scheme')
  })
})
