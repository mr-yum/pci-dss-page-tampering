/**
 * Unit tests for inventory script serialisation.
 *
 * @see ./script.ts
 */

import { RawInventoryScriptInfoSchema } from '../types/inventory/zod.js'
import { inventoryScriptInfoToRawInventoryScriptInfo, rawInventoryScriptInfoToInventoryScriptInfo } from './script.js'

describe('inventoryScriptInfoToRawInventoryScriptInfo', () => {
  const authorisationInfo = { description: 'Approved', authorised: true, date: '2025-10-01T00:00:00.000Z' }

  // Through the real Zod schema on both ends, so a serialised config the loader
  // would reject cannot pass: the inventory repo's CI validates exactly this way.
  const roundTrip = (raw: unknown): { identifyWith: Record<string, string>; authoriseWith: Record<string, unknown> } => {
    const validated = RawInventoryScriptInfoSchema.parse(raw)

    return RawInventoryScriptInfoSchema.parse(inventoryScriptInfoToRawInventoryScriptInfo(rawInventoryScriptInfoToInventoryScriptInfo(validated as never))) as never
  }

  it('serialises a name matcher entry back to the same matcher kind and metadata', () => {
    const result = roundTrip({ identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/a\\.js$' }, authoriseWith: { contentMatcher: 'analytics', authorisationInfo } })

    expect(Object.keys(result.identifyWith)).toEqual(['nameMatcher'])
    expect(result.authoriseWith).toMatchObject({ contentMatcher: 'analytics', authorisationInfo })
  })

  it('round-trips a cspDirectiveMatcher through schema and serialiser', () => {
    const raw = {
      identifyWith: { headerNameMatcher: '^content-security-policy$' },
      authoriseWith: { cspDirectiveMatcher: { directive: 'frame-src', allow: ["'self'", 'https://js.stripe.com'] }, authorisationInfo },
    }

    expect(roundTrip(raw).authoriseWith).toEqual({ cspDirectiveMatcher: { directive: 'frame-src', allow: ["'self'", 'https://js.stripe.com'] }, authorisationInfo })
  })

  it('serialises a script entry identified by a header-name matcher', () => {
    // MatcherConfigSchema is shared between scripts and headers, so this
    // validates and loads. Before this case existed the serialiser threw
    // "Unknown matcher type: header-name" — which the auditor report now
    // reaches on the detection path, where a throw would cost that target its
    // tamper alerts.
    const raw = { identifyWith: { headerNameMatcher: '^x-legacy$' }, authoriseWith: { contentMatcher: 'analytics', authorisationInfo } }

    expect(() => roundTrip(raw)).not.toThrow()
    expect(roundTrip(raw).identifyWith).toEqual({ headerNameMatcher: '^x-legacy$' })
  })
})
