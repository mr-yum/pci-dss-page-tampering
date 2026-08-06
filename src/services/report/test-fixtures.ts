/**
 * Shared fixtures for report tests.
 *
 * Lives outside a `.test.ts` file so both the collector tests and the HTML
 * template tests build reports the same way; a drift between them would let a
 * rendering bug hide behind a differently-shaped fixture.
 *
 * Not a test file itself — `jest.config.cjs` only picks up `*.test.ts`.
 */

import type { ReportRunContext } from '../../interfaces/report.js'
import type { ComparisonResultType } from '../../types/comparison.js'
import { AuthorizedHeaderFound } from '../../types/comparison/authorized-header-found.js'
import { AuthorizedScriptFound } from '../../types/comparison/authorized-script-found.js'
import { KnownHeaderWithUnauthorisedContentFound } from '../../types/comparison/known-header-unauthorised-content-found.js'
import { KnownScriptWithUnauthorisedContentFound } from '../../types/comparison/known-script-unauthorised-content-found.js'
import { MissingRequiredHeader } from '../../types/comparison/missing-required-header.js'
import { UnknownHeaderFound } from '../../types/comparison/unknown-header-found.js'
import { UnknownScriptFound } from '../../types/comparison/unknown-script-found.js'
import { ExecutionMode } from '../../types/config.js'
import type { DetectedHeader } from '../../types/header.js'
import type { Inventory, InventoryHeaderInfo, InventoryScriptInfo } from '../../types/inventory/model.js'
import { RawInventorySchema } from '../../types/inventory/zod.js'
import type { DetectedScript } from '../../types/matcher/matcher.interface.js'
import type { Target, TargetDetection, TargetInventory } from '../../types/target.js'
import { rawInventoryHeaderInfoToInventoryHeaderInfo } from '../../utils/inventory.js'
import { createLogger } from '../../utils/logger.js'
import { rawInventoryScriptInfoToInventoryScriptInfo } from '../../utils/script.js'

export const SCRIPT_URL = 'https://cdn.example.com/analytics.js'
export const SCRIPT_HASH = 'aaaa000000000000000000000000000000000000000000000000000000000001'
export const OTHER_HASH = 'bbbb000000000000000000000000000000000000000000000000000000000002'

const workflow = { fileName: 'checkout-workflow.json', definition: { steps: [] } }

export const detectionTarget: TargetDetection = {
  type: 'detection',
  workflowId: 'checkout',
  name: 'example checkout',
  url: 'https://checkout.example.com/pay?session=secret',
  workflow,
  logger: createLogger('report-test'),
}

export const inventoryTarget: TargetInventory = {
  type: 'inventory',
  workflowId: 'checkout',
  name: 'example checkout (staging)',
  url: 'https://staging.example.test/pay',
  workflow,
  logger: createLogger('report-test'),
}

export const INVENTORY_TEXT = `{
  "target": {
    "inventory": { "type": "inventory", "url": "https://staging.example.test/pay", "workflow": "checkout-workflow.json" },
    "detection": { "type": "detection", "url": "https://checkout.example.com/pay", "workflow": "checkout-workflow.json" }
  },
  "alerts": {
    "inventory": { "newScriptIdentified": { "destination": "c" }, "newHeaderIdentified": { "destination": "c" } },
    "detection": { "newScriptDetected": { "destination": "c" }, "scriptMismatchDetected": { "destination": "c" }, "newHeaderDetected": { "destination": "c" } },
    "successNotification": { "destination": "c" }
  },
  "scripts": [
    {
      "identifyWith": { "nameMatcher": "^https://cdn\\\\.example\\\\.com/analytics\\\\.js$" },
      "authoriseWith": {
        "hashes": [
          { "timestamp": "2025-10-01T00:00:00.000Z", "hash": { "value": "${OTHER_HASH}" } },
          { "timestamp": "2025-10-02T00:00:00.000Z", "hash": { "value": "${SCRIPT_HASH}" } }
        ],
        "authorisationInfo": { "description": "Analytics, approved by security", "authorised": true, "date": "2025-10-02T00:00:00.000Z" }
      }
    },
    {
      "identifyWith": { "nameMatcher": "^https://cdn\\\\.example\\\\.com/never-loaded\\\\.js$" },
      "authoriseWith": {
        "hashes": [{ "timestamp": "2025-10-01T00:00:00.000Z", "hash": { "value": "${OTHER_HASH}" } }],
        "authorisationInfo": { "description": "Legacy widget", "authorised": true, "date": "2025-10-01T00:00:00.000Z" }
      }
    }
  ],
  "headers": [
    {
      "identifyWith": { "headerNameMatcher": "^content-security-policy$" },
      "authoriseWith": {
        "andMatcher": [{ "contentMatcher": "default-src 'self'" }, { "contentMatcher": "object-src 'none'" }],
        "authorisationInfo": { "description": "CSP requires both directives", "authorised": true, "date": "2025-10-02T00:00:00.000Z" }
      },
      "requiredOn": ["document"]
    }
  ]
}`

export function buildInventory(text: string = INVENTORY_TEXT, fileName = '1.0.json'): Inventory {
  // Through the real schema, not a bare JSON.parse: Zod coerces timestamps to
  // Date, and a fixture that skipped it would exercise shapes the running
  // system never produces.
  const raw = RawInventorySchema.parse(JSON.parse(text))

  return {
    fileName,
    target: { inventory: inventoryTarget, detection: detectionTarget },
    alerts: raw.alerts,
    scripts: raw.scripts.map(rawInventoryScriptInfoToInventoryScriptInfo),
    headers: raw.headers.map(rawInventoryHeaderInfoToInventoryHeaderInfo),
    source: { file: `targets/${fileName}`, text },
  }
}

export function makeScript(overrides: Partial<DetectedScript> = {}): DetectedScript {
  return { name: SCRIPT_URL, content: 'window.analytics=1', hash: { value: SCRIPT_HASH }, url: SCRIPT_URL, workflowId: 'checkout', ...overrides }
}

export function makeHeader(overrides: Partial<DetectedHeader> = {}): DetectedHeader {
  return {
    name: 'content-security-policy',
    value: "default-src 'self'; object-src 'none'",
    target: detectionTarget,
    workflow,
    url: 'https://checkout.example.com/pay',
    ...overrides,
  } as DetectedHeader
}

const timestamp = new Date('2026-01-01T00:00:00.000Z')

/** One comparison result of every variant, against `buildInventory()`. */
export function everyResultType(inventory: Inventory, target: Target = detectionTarget): ComparisonResultType[] {
  const scriptEntry: InventoryScriptInfo = inventory.scripts[0]!
  const headerEntry: InventoryHeaderInfo = inventory.headers[0]!

  return [
    new AuthorizedScriptFound(target, timestamp, makeScript(), scriptEntry, [{ description: 'Analytics, approved by security', authorised: true, date: timestamp }]),
    new KnownScriptWithUnauthorisedContentFound(
      target,
      timestamp,
      makeScript({ name: 'https://cdn.example.com/analytics.js', hash: { value: 'cccc' } }),
      scriptEntry,
      scriptEntry.authoriseWith.matcher,
      'hash cccc not in authorized list',
      [],
    ),
    new UnknownScriptFound(target, timestamp, makeScript({ name: 'https://evil.example.test/skim.js', content: 'steal()', hash: { value: 'dddd' }, url: 'https://evil.example.test/skim.js' })),
    new AuthorizedHeaderFound(target, timestamp, makeHeader(), headerEntry, [{ description: 'CSP requires both directives', authorised: true, date: timestamp }]),
    new KnownHeaderWithUnauthorisedContentFound(target, timestamp, makeHeader({ value: 'default-src *' }), headerEntry, headerEntry.authoriseWith.matcher, 'content does not match pattern', []),
    new UnknownHeaderFound(target, timestamp, makeHeader({ name: 'x-unexpected', value: 'surprise' })),
    new MissingRequiredHeader(target, timestamp, 'content-security-policy', 'https://checkout.example.com/pay', 'document', headerEntry),
  ]
}

export function runContext(overrides: Partial<ReportRunContext> = {}): ReportRunContext {
  return {
    configuredMode: ExecutionMode.Detection,
    targetFilter: null,
    correlationId: '00000000-0000-4000-8000-000000000000',
    inventoryRef: { branch: 'main', commitSha: 'abc1234def5678', commitIsoDate: '2026-01-01T00:00:00.000Z', repositoryUrl: 'https://github.example.com/org/inventory' },
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:30.000Z',
    durationMs: 30000,
    ci: null,
    ...overrides,
  }
}
