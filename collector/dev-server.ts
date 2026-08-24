/**
 * Local dev stand-in for the deployed collector (quickstart.md §1): runs the
 * REAL ingest handler in-process with file-backed deps — archive appends to
 * ./tmp/archive/beacons.jsonl, novelty lives in an in-memory Map persisted to
 * ./tmp/novelty.json (same conditional-put semantics as DynamoDB), and each
 * queue message lands as ./tmp/queue/<timestamp>-<seq>.json. Metrics print to
 * the console. Dev-only quality; never deployed.
 *
 * Run: npx tsx collector/dev-server.ts (origin map from origin-targets.local.json
 * at the repo root — copy origin-targets.local.example.json to create it).
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { appendFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CollectorConfig, CollectorDeps, NoveltyItem, OriginTarget } from './src/ingest.js'
import { createHandler } from './src/ingest.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const archiveFile = join(repoRoot, 'tmp', 'archive', 'beacons.jsonl')
const noveltyFile = join(repoRoot, 'tmp', 'novelty.json')
const queueDir = join(repoRoot, 'tmp', 'queue')
mkdirSync(dirname(archiveFile), { recursive: true })
mkdirSync(queueDir, { recursive: true })

const originTargetsPath = join(repoRoot, 'origin-targets.local.json')
let originTargets: OriginTarget[]
try {
  originTargets = JSON.parse(readFileSync(originTargetsPath, 'utf8')) as OriginTarget[]
} catch (error) {
  console.error(`Cannot read ${originTargetsPath} — copy origin-targets.local.example.json to origin-targets.local.json and adjust.`, error)
  process.exit(1)
}

const config: CollectorConfig = {
  originTargets,
  // Edge auth is the deployment's concern; the local loop trusts everything.
  edgeAuthMode: 'aws_iam',
  firehoseStream: 'local-archive',
  noveltyTable: 'local-novelty',
  queueUrl: 'local-queue',
  noveltyTtlDays: 90,
  metricNamespace: 'Collector/RUM-local',
}

const loadNovelty = (): Map<string, NoveltyItem> => {
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(noveltyFile, 'utf8')) as Record<string, NoveltyItem>))
  } catch {
    return new Map()
  }
}
const novelty = loadNovelty()
const persistNovelty = (): Promise<void> => writeFile(noveltyFile, JSON.stringify(Object.fromEntries(novelty), null, 2))

let seq = 0
const deps: CollectorDeps = {
  firehose: {
    putRecord: async ({ data }) => appendFile(archiveFile, data),
  },
  dynamo: {
    putItemIfAbsent: async ({ item }) => {
      if (novelty.has(item.pk)) throw Object.assign(new Error(`novelty pk exists: ${item.pk}`), { name: 'ConditionalCheckFailedException' })
      novelty.set(item.pk, item)
      await persistNovelty()
    },
    updateCounters: async ({ pk, lastSeen }) => {
      const item = novelty.get(pk)
      if (!item) return
      item.last_seen = lastSeen
      item.sessions += 1
      await persistNovelty()
    },
    // Compensating delete when a first-sighting enqueue fails (parity with the
    // real adapter); locally the file queue never fails, so this is rarely hit.
    deleteItem: async ({ pk }) => {
      if (novelty.delete(pk)) await persistNovelty()
    },
  },
  sqs: {
    // The file IS the message body: FileQueueSource parses each file as a bare
    // QueueMessage, so the wrapper attributes must not leak into the file.
    sendMessage: async ({ body }) => {
      const file = join(queueDir, `${Date.now()}-${String(seq++).padStart(4, '0')}.json`)
      await writeFile(file, JSON.stringify(JSON.parse(body), null, 2))
      console.log(`queued ${file}`)
    },
  },
  metrics: {
    publish: async ({ namespace, data }) => {
      for (const datum of data) console.log(`metric ${namespace}/${datum.name}=${datum.value}${datum.unit === 'Milliseconds' ? 'ms' : ''} ${JSON.stringify(datum.dimensions)}`)
    },
  },
  now: () => Date.now(),
}

const handler = createHandler(config, deps)

const server = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    void (async () => {
      // Node lowercases incoming header names; multi-value headers never
      // matter for the ones the handler reads (origin, edge key). rawPath is
      // the pathname only (no query), so the /csp-reports route is reachable
      // locally exactly as the Function URL delivers it.
      const rawPath = new URL(req.url ?? '/', 'http://localhost').pathname
      const result = await handler({ rawPath, headers: req.headers as Record<string, string | undefined>, body: Buffer.concat(chunks).toString('utf8'), isBase64Encoded: false })
      res.writeHead(result.statusCode).end()
    })()
  })
})

const port = Number(process.env['PORT'] ?? 9999)
server.listen(port, () => console.log(`collector dev server on http://localhost:${port} — ${originTargets.length} origin(s) mapped, archive/queue under ./tmp/`))
