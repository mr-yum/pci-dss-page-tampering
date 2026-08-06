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
      identifyWith: { nameMatcher: '^https://payments\\.example\\.com/sdk\\.js$' },
      authoriseWith: { cspDirectiveMatcher: { directive: 'frame-src', allow: ["'self'", 'https://payments.example.com'] }, authorisationInfo },
    }

    expect(roundTrip(raw).authoriseWith).toEqual({ cspDirectiveMatcher: { directive: 'frame-src', allow: ["'self'", 'https://payments.example.com'] }, authorisationInfo })
  })

  it('rejects a script entry identified by a header-name matcher', () => {
    // HeaderNameMatcher is case-insensitive; script URLs are not. A
    // case-variant URL could otherwise reach the entry's authorisation
    // matcher, so the schema rejects the combination outright — including
    // nested inside composites. (The serialiser retains a defensive
    // 'header-name' case for any in-memory shape that slips past.)
    const flat = { identifyWith: { headerNameMatcher: '^x-legacy$' }, authoriseWith: { contentMatcher: 'analytics', authorisationInfo } }
    const nested = { identifyWith: { orMatcher: [{ nameMatcher: '^a$' }, { headerNameMatcher: '^x-legacy$' }] }, authoriseWith: { contentMatcher: 'analytics', authorisationInfo } }

    expect(() => RawInventoryScriptInfoSchema.parse(flat)).toThrow(/headerNameMatcher is not valid in a script entry/u)
    expect(() => RawInventoryScriptInfoSchema.parse(nested)).toThrow(/headerNameMatcher is not valid in a script entry/u)
  })
})
