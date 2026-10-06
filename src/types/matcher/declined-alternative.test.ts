/**
 * FR-011 for leaf matchers: `authorisationInfo.authorised: false` always denies.
 *
 * A leaf matcher carries its own `authorisationInfo` whenever it is an element
 * of an array-syntax `authoriseWith` (each element must carry one) or a child
 * of a composite. Hash, CSP-directive, workflow, target-type and the
 * composites always honoured the flag; these five did not, so a pending or
 * declined alternative authorised whatever its pattern matched.
 */

import type { SHA256Hash } from '../hash.js'
import type { InventoryAuthorisationInfo } from '../inventory/model.js'
import { processAuthorizeWith } from '../inventory/zod.js'
import { ContentMatcher } from './content-matcher.js'
import { HostMatcher } from './host-matcher.js'
import { InitiatorHostMatcher } from './initiator-host-matcher.js'
import type { AuthorisationMatcher, DetectedScript } from './matcher.interface.js'
import { NameMatcher } from './name-matcher.js'
import { UrlMatcher } from './url-matcher.js'

const declined: InventoryAuthorisationInfo = { description: 'Declined by review', authorised: false, date: new Date('2026-10-01T00:00:00.000Z') }
const approved: InventoryAuthorisationInfo = { ...declined, description: 'Approved', authorised: true }

const SCRIPT: DetectedScript = {
  name: 'https://js.vendor.example/sdk.js',
  url: 'https://js.vendor.example/sdk.js',
  content: 'vendor.init()',
  hash: { value: 'abc' } as SHA256Hash,
  initiator: 'https://pay.example/checkout',
  initiatorChain: [{ url: 'https://pay.example/checkout', kind: 'document' }],
}

const leaves: [string, (info: InventoryAuthorisationInfo) => AuthorisationMatcher, DetectedScript][] = [
  ['nameMatcher', (info) => new NameMatcher('^https://js\\.vendor\\.example/', info), SCRIPT],
  ['urlMatcher', (info) => new UrlMatcher('^https://js\\.vendor\\.example/', info), SCRIPT],
  ['hostMatcher', (info) => new HostMatcher('^js\\.vendor\\.example$', info), SCRIPT],
  ['initiatorHostMatcher', (info) => new InitiatorHostMatcher('^pay\\.example$', info), SCRIPT],
  ['initiatorHostMatcher (transitive)', (info) => new InitiatorHostMatcher('^pay\\.example$', info, { transitive: true }), SCRIPT],
  ['contentMatcher', (info) => new ContentMatcher('^vendor\\.init', info), SCRIPT],
  ['contentMatcher (window evidence)', (info) => new ContentMatcher('^vendor\\.init', info), { name: 'inline_script/x', content: null, contentEvidence: { length: 300, head: 'vendor.init()', tail: ';' } } as DetectedScript],
]

describe.each(leaves)('%s honours authorised: false', (_label, build, script) => {
  it('authorises when its own authorisationInfo approves', () => {
    expect(build(approved).authorize(script).authorized).toBe(true)
  })

  it('denies, naming the flag, when its own authorisationInfo declines — whatever its pattern matches', () => {
    const result = build(declined).authorize(script)
    expect(result.authorized).toBe(false)
    expect(result.reason).toBe('Top-level authorization denied: Declined by review')
    expect(result.metadataPath).toEqual([declined])
  })
})

describe('an array-syntax authoriseWith with a declined alternative', () => {
  it('authorises nothing through the declined alternative, even though the entry-level (first) alternative is approved', () => {
    const authoriseWith = processAuthorizeWith([
      { hashes: [{ timestamp: '2026-10-01T00:00:00.000Z', hash: { value: 'the approved release' } }], authorisationInfo: { description: 'v1', authorised: true, date: '2026-10-01T00:00:00.000Z' } },
      { nameMatcher: '^https://js\\.vendor\\.example/', authorisationInfo: { description: 'Any release (pending review)', authorised: false, date: '2026-10-02T00:00:00.000Z' } },
    ] as never)
    expect(authoriseWith.authorisationInfo.authorised).toBe(true)
    const result = authoriseWith.matcher.authorize(SCRIPT)
    expect(result.authorized).toBe(false)
    expect(result.reason).toBe('Top-level authorization denied: Any release (pending review)')
  })
})
