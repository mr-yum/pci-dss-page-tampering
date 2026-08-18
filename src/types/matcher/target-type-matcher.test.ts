import { AndMatcher } from './and-matcher.js'
import { NameMatcher } from './name-matcher.js'
import { TargetTypeMatcher } from './target-type-matcher.js'

const make = (targetType?: string, name = 'resource') => ({
  name,
  content: 'content',
  ...(targetType !== undefined ? { targetType } : {}),
})

describe('TargetTypeMatcher', () => {
  it('identifies the pass that observed the resource', () => {
    const matcher = new TargetTypeMatcher('^inventory$')

    expect(matcher.identify(make('inventory'))).toBe(true)
    expect(matcher.identify(make('detection'))).toBe(false)
  })

  it('fails secure when the target type is missing or empty', () => {
    const matcher = new TargetTypeMatcher('.*')

    expect(matcher.identify(make())).toBe(false)
    expect(matcher.identify(make(''))).toBe(false)
    expect(matcher.identify(make('   '))).toBe(false)
    expect(matcher.authorize(make())).toEqual({ authorized: false, reason: 'target type is missing or empty' })
  })

  it('returns matcher metadata on authorization', () => {
    const authorisationInfo = { description: 'Staging only', authorised: true, date: new Date('2026-08-18T00:00:00.000Z') }
    const result = new TargetTypeMatcher('^inventory$', authorisationInfo).authorize(make('inventory'))

    expect(result).toEqual({ authorized: true, metadataPath: [authorisationInfo] })
  })

  it('denies a matching target type when its authorization metadata is denied', () => {
    const authorisationInfo = { description: 'Withdrawn', authorised: false, date: new Date('2026-08-18T00:00:00.000Z') }
    const result = new TargetTypeMatcher('^inventory$', authorisationInfo).authorize(make('inventory'))

    expect(result.authorized).toBe(false)
    expect(result.reason).toContain('Withdrawn')
  })

  it('reports the non-matching target type in the failure reason', () => {
    const result = new TargetTypeMatcher('^inventory$').authorize(make('detection'))

    expect(result).toEqual({ authorized: false, reason: "target type 'detection' does not match pattern: ^inventory$" })
  })

  it('exposes its type and a truncated description', () => {
    const matcher = new TargetTypeMatcher('^inventory$')

    expect(matcher.getType()).toBe('targetType')
    expect(matcher.getPattern()).toBe('^inventory$')
    expect(matcher.getDescription()).toBe('target-type:/^inventory$/')
  })

  // The reason this matcher exists: a workflow id is shared by a variation's
  // inventory and detection targets, so it cannot keep a staging-only origin
  // off the production payment page. Combining with target type can.
  it('scopes a sandbox origin to the inventory pass only', () => {
    const sandboxOnly = new AndMatcher([new TargetTypeMatcher('^inventory$'), new NameMatcher('^https:\\/\\/sandbox\\.provider\\.example\\/.+$')])
    const sandboxScript = 'https://sandbox.provider.example/sdk.js'

    expect(sandboxOnly.identify({ ...make('inventory'), name: sandboxScript })).toBe(true)
    expect(sandboxOnly.identify({ ...make('detection'), name: sandboxScript })).toBe(false)
  })
})
