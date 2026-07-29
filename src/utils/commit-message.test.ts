import type { Inventory, InventoryDifferenceResult, InventoryHeaderInfo, InventoryScriptInfo } from '../types/inventory/model.js'
import type { TargetDetection, TargetInventory } from '../types/target.js'
import type { Workflow } from '../types/workflow.js'
import { buildInventoryCommitMessage } from './commit-message.js'
import { rawInventoryHeaderInfoToInventoryHeaderInfo } from './inventory.js'
import { createLogger } from './logger.js'
import { rawInventoryScriptInfoToInventoryScriptInfo } from './script.js'

const mockWorkflow: Workflow = { fileName: 'default.json', definition: { steps: [] } }
const mockLogger = createLogger('test')

function makeInventory(fileName: string, scripts: InventoryScriptInfo[], headers: InventoryHeaderInfo[]): Inventory {
  return {
    fileName,
    scripts,
    headers,
    alerts: {
      inventory: {
        newScriptIdentified: { destination: 'x' },
        newHeaderIdentified: { destination: 'x' },
      },
      detection: {
        newScriptDetected: { destination: 'x' },
        scriptMismatchDetected: { destination: 'x' },
        newHeaderDetected: { destination: 'x' },
      },
      successNotification: { destination: 'x' },
    },
    target: {
      inventory: { type: 'inventory', name: 'n', url: 'https://s', workflow: mockWorkflow, logger: mockLogger } as TargetInventory,
      detection: { type: 'detection', name: 'n', url: 'https://p', workflow: mockWorkflow, logger: mockLogger } as TargetDetection,
    },
  }
}

function headerWithContentMatchers(values: string[]): InventoryHeaderInfo {
  return rawInventoryHeaderInfoToInventoryHeaderInfo({
    identifyWith: { headerNameMatcher: '^content-security-policy$' },
    authoriseWith: values.map((v) => ({
      contentMatcher: `^${v}$`,
      authorisationInfo: { description: 'x', authorised: true, date: '2026-01-01T00:00:00.000Z' },
    })),
  })
}

function scriptWithHashes(hashes: string[]): InventoryScriptInfo {
  return rawInventoryScriptInfoToInventoryScriptInfo({
    identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/s\\.js$' },
    authoriseWith: {
      hashes: hashes.map((h) => ({ timestamp: '2026-01-01T00:00:00.000Z', hash: { value: h } })),
      authorisationInfo: { description: 'x', authorised: true, date: '2026-01-01T00:00:00.000Z' },
    },
  })
}

function scriptWithScopedHashes(globalHashes: string[], scopedHashes: string[]): InventoryScriptInfo {
  return rawInventoryScriptInfoToInventoryScriptInfo({
    identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/s\\.js$' },
    authoriseWith: [
      {
        hashes: globalHashes.map((hash) => ({ timestamp: '2026-01-01T00:00:00.000Z', hash: { value: hash } })),
        authorisationInfo: { description: 'global', authorised: true, date: '2026-01-01T00:00:00.000Z' },
      },
      ...scopedHashes.map((hash) => ({
        andMatcher: [{ workflowMatcher: '^workflow-a$' }, { hashes: [{ timestamp: '2026-01-02T00:00:00.000Z', hash: { value: hash } }] }],
        authorisationInfo: { description: 'scoped', authorised: true, date: '2026-01-02T00:00:00.000Z' },
      })),
    ],
  })
}

function headerWithScopedContentMatchers(globalValues: string[], scopedValues: string[]): InventoryHeaderInfo {
  return rawInventoryHeaderInfoToInventoryHeaderInfo({
    identifyWith: { headerNameMatcher: '^x-content-type-options$' },
    authoriseWith: [
      ...globalValues.map((value) => ({
        contentMatcher: `^${value}$`,
        authorisationInfo: { description: 'global', authorised: true, date: '2026-01-01T00:00:00.000Z' },
      })),
      ...scopedValues.map((value) => ({
        andMatcher: [{ workflowMatcher: '^workflow-a$' }, { contentMatcher: `^${value}$` }],
        authorisationInfo: { description: 'scoped', authorised: true, date: '2026-01-02T00:00:00.000Z' },
      })),
    ],
  })
}

function newScriptEntry(url: string): InventoryScriptInfo {
  return rawInventoryScriptInfoToInventoryScriptInfo({
    identifyWith: { nameMatcher: `^${url}$` },
    authoriseWith: {
      hashes: [{ timestamp: '2026-01-01T00:00:00.000Z', hash: { value: 'n' } }],
      authorisationInfo: { description: 'x', authorised: false, date: '2026-01-01T00:00:00.000Z' },
    },
  })
}

function newHeaderEntry(name: string): InventoryHeaderInfo {
  return rawInventoryHeaderInfoToInventoryHeaderInfo({
    identifyWith: { headerNameMatcher: `^${name}$` },
    authoriseWith: {
      contentMatcher: '^x$',
      authorisationInfo: { description: 'x', authorised: false, date: '2026-01-01T00:00:00.000Z' },
    },
  })
}

function diffOf(fileName: string, oldI: Inventory, newI: Inventory): InventoryDifferenceResult {
  return { oldInventory: { ...oldI, fileName }, newInventory: { ...newI, fileName } }
}

describe('buildInventoryCommitMessage', () => {
  it('summarises a single file with only new header matchers', () => {
    const before = makeInventory('2.0.json', [], [headerWithContentMatchers(['a'])])
    const after = makeInventory('2.0.json', [], [headerWithContentMatchers(['a', 'b', 'c'])])

    const message = buildInventoryCommitMessage([diffOf('2.0.json', before, after)])

    expect(message).toBe('inventory(2.0): add 2 header matchers')
  })

  it('summarises a single file with only one new header matcher (singular)', () => {
    const before = makeInventory('2.0.json', [], [headerWithContentMatchers(['a'])])
    const after = makeInventory('2.0.json', [], [headerWithContentMatchers(['a', 'b'])])

    const message = buildInventoryCommitMessage([diffOf('2.0.json', before, after)])

    expect(message).toBe('inventory(2.0): add 1 header matcher')
  })

  it('combines new script entries and new header matchers across multiple files', () => {
    const file1Before = makeInventory('1.0.json', [], [])
    const file1After = makeInventory('1.0.json', [newScriptEntry('https://x.example.com/a.js')], [])

    const file2Before = makeInventory('2.0.json', [], [headerWithContentMatchers(['a'])])
    const file2After = makeInventory('2.0.json', [], [headerWithContentMatchers(['a', 'b', 'c'])])

    const message = buildInventoryCommitMessage([diffOf('1.0.json', file1Before, file1After), diffOf('2.0.json', file2Before, file2After)])

    expect(message).toBe('inventory(1.0, 2.0): add 1 script and 2 header matchers')
  })

  it('counts new hashes on existing scripts', () => {
    const before = makeInventory('1.0.json', [scriptWithHashes(['baseline'])], [])
    const after = makeInventory('1.0.json', [scriptWithHashes(['baseline', 'h1', 'h2'])], [])

    const message = buildInventoryCommitMessage([diffOf('1.0.json', before, after)])

    expect(message).toBe('inventory(1.0): add 2 script hashes')
  })

  it('counts new hashes nested in workflow-scoped composite matchers', () => {
    const before = makeInventory('1.0.json', [scriptWithScopedHashes(['baseline'], [])], [])
    const after = makeInventory('1.0.json', [scriptWithScopedHashes(['baseline'], ['workflow-hash'])], [])

    expect(buildInventoryCommitMessage([diffOf('1.0.json', before, after)])).toBe('inventory(1.0): add 1 script hash')
  })

  it('counts new header matchers nested in workflow-scoped composites', () => {
    const before = makeInventory('1.0.json', [], [headerWithScopedContentMatchers(['nosniff'], [])])
    const after = makeInventory('1.0.json', [], [headerWithScopedContentMatchers(['nosniff'], ['legacy-value'])])

    expect(buildInventoryCommitMessage([diffOf('1.0.json', before, after)])).toBe('inventory(1.0): add 1 header matcher')
  })

  it('omits files with no changes from the scope', () => {
    const file1Before = makeInventory('1.0.json', [], [headerWithContentMatchers(['a'])])
    const file1After = makeInventory('1.0.json', [], [headerWithContentMatchers(['a'])])

    const file2Before = makeInventory('2.0.json', [], [headerWithContentMatchers(['a'])])
    const file2After = makeInventory('2.0.json', [], [headerWithContentMatchers(['a', 'b'])])

    const message = buildInventoryCommitMessage([diffOf('1.0.json', file1Before, file1After), diffOf('2.0.json', file2Before, file2After)])

    expect(message).toBe('inventory(2.0): add 1 header matcher')
  })

  it('handles all four change buckets with Oxford comma', () => {
    const before = makeInventory('2.0.json', [scriptWithHashes(['b'])], [headerWithContentMatchers(['a'])])
    const after = makeInventory(
      '2.0.json',
      [scriptWithHashes(['b', 'new-hash']), newScriptEntry('https://x.example.com/a.js'), newScriptEntry('https://x.example.com/c.js')],
      [headerWithContentMatchers(['a', 'b']), newHeaderEntry('x-new-header')],
    )

    const message = buildInventoryCommitMessage([diffOf('2.0.json', before, after)])

    expect(message).toBe('inventory(2.0): add 2 scripts, 1 script hash, 1 header, and 1 header matcher')
  })

  it('returns null when no diffs changed anything', () => {
    const before = makeInventory('1.0.json', [], [headerWithContentMatchers(['a'])])
    const after = makeInventory('1.0.json', [], [headerWithContentMatchers(['a'])])

    const message = buildInventoryCommitMessage([diffOf('1.0.json', before, after)])

    expect(message).toBeNull()
  })

  it('returns null when no diffs are supplied', () => {
    expect(buildInventoryCommitMessage([])).toBeNull()
  })
})
