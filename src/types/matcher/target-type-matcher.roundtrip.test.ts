import { inventoryHeaderInfoToRawInventoryHeaderInfo, rawInventoryHeaderInfoToInventoryHeaderInfo } from '../../utils/inventory.js'
import { inventoryScriptInfoToRawInventoryScriptInfo, rawInventoryScriptInfoToInventoryScriptInfo } from '../../utils/script.js'
import { MatcherConfigSchema } from '../inventory/matcher-config-schema.js'

const authorisationInfo = { description: 'Provider sandbox, staging only', authorised: true, date: '2026-08-18T00:00:00.000Z' }

describe('targetTypeMatcher serialisation', () => {
  // Regression: the matcher was added to the schema and factory but not to
  // either matcherToConfig serialiser, so an inventory using it threw
  // "Unknown matcher type: targetType" on the push path and lost the report.
  it('survives a script entry deserialise -> serialise round trip', () => {
    const raw = {
      identifyWith: { andMatcher: [{ targetTypeMatcher: '^inventory$' }, { nameMatcher: '^https:\\/\\/sandbox\\.provider\\.example\\/.+$' }] },
      authoriseWith: { urlMatcher: '^https:\\/\\/sandbox\\.provider\\.example\\/', authorisationInfo },
    }

    expect(inventoryScriptInfoToRawInventoryScriptInfo(rawInventoryScriptInfoToInventoryScriptInfo(raw as any))).toEqual(raw)
  })

  it('survives a header entry deserialise -> serialise round trip', () => {
    const raw = {
      identifyWith: { andMatcher: [{ targetTypeMatcher: '^detection$' }, { headerNameMatcher: '^strict-transport-security$' }] },
      authoriseWith: { targetTypeMatcher: '^detection$', authorisationInfo },
    }

    expect(inventoryHeaderInfoToRawInventoryHeaderInfo(rawInventoryHeaderInfoToInventoryHeaderInfo(raw as any))).toEqual(raw)
  })

  it('is accepted by the matcher config schema and rejects an invalid regex', () => {
    expect(MatcherConfigSchema.safeParse({ targetTypeMatcher: '^inventory$' }).success).toBe(true)
    expect(MatcherConfigSchema.safeParse({ targetTypeMatcher: '' }).success).toBe(false)

    const bad = MatcherConfigSchema.safeParse({ targetTypeMatcher: '^(inventory$' })
    expect(bad.success).toBe(false)
    expect(JSON.stringify(bad)).toContain('Invalid regex in targetTypeMatcher')
  })
})
