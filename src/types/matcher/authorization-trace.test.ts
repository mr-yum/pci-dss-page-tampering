/**
 * Unit tests for opt-in authorisation tracing.
 *
 * The trace exists so the auditor report can name the *specific* node that
 * authorised a resource — which OR alternative, which conjunct, which hash —
 * and turn that into a JSON pointer into the inventory file.
 *
 * Two properties matter most and are asserted throughout:
 * 1. Without `{ collectTrace: true }` no `trace` key appears at all, so every
 *    existing caller and whole-object assertion sees the shape it always saw.
 * 2. Tracing never changes an authorisation decision.
 *
 * @see ./authorization-trace.ts
 * @see ./or-matcher.ts
 * @see ./and-matcher.ts
 * @see ./hash-matcher.ts
 */

import type { SHA256Hash } from '../hash.js'
import type { InventoryScriptHashInfo } from '../inventory/model.js'
import { AndMatcher } from './and-matcher.js'
import { ContentMatcher } from './content-matcher.js'
import { HashMatcher } from './hash-matcher.js'
import type { AuthorisationInfo, DetectedScript, Matchable, Matcher } from './matcher.interface.js'
import { NameMatcher } from './name-matcher.js'
import { OrMatcher } from './or-matcher.js'
import { WorkflowMatcher } from './workflow-matcher.js'

describe('authorisation tracing', () => {
  const TRACE = { collectTrace: true } as const

  const createHash = (value: string): SHA256Hash => ({ value })

  const createHashInfo = (value: string): InventoryScriptHashInfo => ({
    timestamp: new Date('2025-10-15T00:00:00.000Z'),
    hash: createHash(value),
  })

  const createAuthorisationInfo = (description: string, authorised = true): AuthorisationInfo => ({
    description,
    authorised,
    date: new Date('2025-10-15T00:00:00.000Z'),
  })

  const createScript = (overrides: Partial<DetectedScript> = {}): DetectedScript => ({
    name: 'https://cdn.example.com/analytics.js',
    content: 'console.log("analytics")',
    hash: createHash('hash-b'),
    ...overrides,
  })

  /** Run a matcher twice and assert tracing changed nothing but the trace key. */
  const expectDecisionUnaffected = (matcher: Matcher<DetectedScript>, script: DetectedScript): void => {
    const untraced = matcher.authorize(script)
    const traced = matcher.authorize(script, TRACE)
    const { trace, ...tracedWithoutTrace } = traced

    expect(trace).toBeDefined()
    expect(tracedWithoutTrace).toEqual(untraced)
  }

  describe('the non-breaking contract', () => {
    it.each([
      ['HashMatcher', (): Matcher<Matchable> => new HashMatcher([createHashInfo('hash-b')])],
      ['OrMatcher', (): Matcher<Matchable> => new OrMatcher<Matchable>([new ContentMatcher('analytics')])],
      ['AndMatcher', (): Matcher<Matchable> => new AndMatcher<Matchable>([new ContentMatcher('analytics')])],
    ])('%s omits the trace key entirely when no options are passed', (_name, build) => {
      const result = build().authorize(createScript())

      expect(result).not.toHaveProperty('trace')
      expect(Object.keys(result)).not.toContain('trace')
    })

    it('omits the trace key when collectTrace is explicitly false', () => {
      const result = new HashMatcher([createHashInfo('hash-b')]).authorize(createScript(), { collectTrace: false })

      expect(result).not.toHaveProperty('trace')
    })

    it('leaf matchers ignore the options argument', () => {
      // Typed as the interface deliberately: leaf matchers declare a single
      // parameter, and it is only through `Matcher` that a composite parent
      // ever passes options down to them.
      const matcher: Matcher<DetectedScript> = new ContentMatcher('analytics')

      expect(matcher.authorize(createScript(), TRACE)).toEqual(matcher.authorize(createScript()))
      expect(matcher.authorize(createScript(), TRACE)).not.toHaveProperty('trace')
    })
  })

  describe('HashMatcher', () => {
    const hashes = [createHashInfo('hash-a'), createHashInfo('hash-b'), createHashInfo('hash-c')]

    it('records the index of the matching hash', () => {
      const result = new HashMatcher(hashes).authorize(createScript({ hash: createHash('hash-c') }), TRACE)

      expect(result.authorized).toBe(true)
      expect(result.trace).toEqual({ type: 'hash', consulted: [{ slot: 'hashes', index: 2 }] })
    })

    it('records no consulted slot when no hash matches', () => {
      const result = new HashMatcher(hashes).authorize(createScript({ hash: createHash('unknown') }), TRACE)

      expect(result.authorized).toBe(false)
      expect(result.trace).toEqual({ type: 'hash', consulted: [] })
    })

    // ADAPTED (feature 011, evidence-aware matchers): the 'empty content'
    // case previously exercised the hash matcher's content pre-gate. The
    // hash is the matcher's evidence now, so the fail-secure denials to
    // trace are hash-shaped: missing hash and empty hash value.
    it.each([
      ['missing hash', { name: 'x', content: 'body' } as DetectedScript],
      ['empty hash value', createScript({ hash: createHash('') })],
    ])('emits an empty trace for a fail-secure denial on %s', (_case, script) => {
      const result = new HashMatcher(hashes).authorize(script, TRACE)

      expect(result.authorized).toBe(false)
      expect(result.trace).toEqual({ type: 'hash', consulted: [] })
    })

    it('records the consulted hash slot when authorising on hash evidence alone (content never transported)', () => {
      const result = new HashMatcher(hashes).authorize(createScript({ content: null, hash: createHash('hash-c') }), TRACE)

      expect(result.authorized).toBe(true)
      expect(result.trace).toEqual({ type: 'hash', consulted: [{ slot: 'hashes', index: 2 }] })
    })

    it('emits an empty trace when the top-level authorisation denies', () => {
      const matcher = new HashMatcher(hashes, createAuthorisationInfo('revoked', false))
      const result = matcher.authorize(createScript({ hash: createHash('hash-b') }), TRACE)

      expect(result.authorized).toBe(false)
      expect(result.trace).toEqual({ type: 'hash', consulted: [] })
    })

    it('does not change the decision', () => {
      expectDecisionUnaffected(new HashMatcher(hashes), createScript({ hash: createHash('hash-b') }))
      expectDecisionUnaffected(new HashMatcher(hashes), createScript({ hash: createHash('nope') }))
    })
  })

  describe('OrMatcher', () => {
    it('records the index of the winning alternative and nests its trace', () => {
      const matcher = new OrMatcher<DetectedScript>([new HashMatcher([createHashInfo('other')], createAuthorisationInfo('v1')), new HashMatcher([createHashInfo('hash-a'), createHashInfo('hash-b')], createAuthorisationInfo('v2'))])

      // The first child identifies by hash and does not match; the second does.
      const result = matcher.authorize(createScript({ hash: createHash('hash-b') }), TRACE)

      expect(result.authorized).toBe(true)
      expect(result.trace).toEqual({
        type: 'or',
        consulted: [{ slot: 'child', index: 1, child: { type: 'hash', consulted: [{ slot: 'hashes', index: 1 }] } }],
      })
    })

    it('synthesises a node for a leaf child that produces no trace of its own', () => {
      const matcher = new OrMatcher<DetectedScript>([new ContentMatcher('nomatch'), new ContentMatcher('analytics')])
      const result = matcher.authorize(createScript(), TRACE)

      expect(result.authorized).toBe(true)
      expect(result.trace).toEqual({ type: 'or', consulted: [{ slot: 'child', index: 1, child: { type: 'content', consulted: [] } }] })
    })

    it('records the identifying child even when that child then fails to authorise', () => {
      // OrMatcher picks the FIRST child that *identifies* and does not try the
      // next one if it denies. The trace has to reflect that, or the report
      // would point an auditor at an alternative that never ran.
      //
      // A revoked alternative is the realistic shape: it still lists the hash,
      // so it identifies, but its authorisationInfo denies.
      const matcher = new OrMatcher<DetectedScript>([new HashMatcher([createHashInfo('hash-b')], createAuthorisationInfo('revoked', false)), new HashMatcher([createHashInfo('hash-b')], createAuthorisationInfo('current'))])
      const result = matcher.authorize(createScript({ hash: createHash('hash-b') }), TRACE)

      expect(result.authorized).toBe(false)
      expect(result.trace).toEqual({
        type: 'or',
        consulted: [{ slot: 'child', index: 0, child: { type: 'hash', consulted: [] } }],
      })
    })

    it('records no consulted child when nothing identifies', () => {
      const matcher = new OrMatcher<DetectedScript>([new ContentMatcher('nomatch')])
      const result = matcher.authorize(createScript(), TRACE)

      expect(result.authorized).toBe(false)
      expect(result.trace).toEqual({ type: 'or', consulted: [] })
    })

    it('emits an empty trace for a fail-secure denial on empty content', () => {
      const matcher = new OrMatcher<DetectedScript>([new ContentMatcher('analytics')])
      const result = matcher.authorize(createScript({ content: '   ' }), TRACE)

      expect(result.authorized).toBe(false)
      expect(result.trace).toEqual({ type: 'or', consulted: [] })
    })

    it('keeps the winning index when a top-level authorisation overrides the decision', () => {
      const matcher = new OrMatcher<DetectedScript>([new ContentMatcher('nomatch'), new ContentMatcher('analytics')], createAuthorisationInfo('blanket denial', false))
      const result = matcher.authorize(createScript(), TRACE)

      expect(result.authorized).toBe(false)
      expect(result.trace?.consulted).toEqual([{ slot: 'child', index: 1, child: { type: 'content', consulted: [] } }])
    })

    it('does not change the decision', () => {
      const matcher = new OrMatcher<DetectedScript>([new ContentMatcher('nomatch'), new ContentMatcher('analytics')])

      expectDecisionUnaffected(matcher, createScript())
    })
  })

  describe('AndMatcher', () => {
    it('records every conjunct that was evaluated', () => {
      const matcher = new AndMatcher<DetectedScript>([new WorkflowMatcher('^checkout$'), new HashMatcher([createHashInfo('hash-b')])])
      const result = matcher.authorize(createScript({ workflowId: 'checkout' }), TRACE)

      expect(result.authorized).toBe(true)
      expect(result.trace).toEqual({
        type: 'and',
        consulted: [
          { slot: 'child', index: 0, child: { type: 'workflow', consulted: [] } },
          { slot: 'child', index: 1, child: { type: 'hash', consulted: [{ slot: 'hashes', index: 0 }] } },
        ],
      })
    })

    it('truncates the trace at the short-circuiting conjunct', () => {
      // All three identify — the middle child lists the script's hash, so it
      // identifies, but its authorisationInfo denies. Authorisation therefore
      // runs and short-circuits at index 1; index 2 must never appear.
      const matcher = new AndMatcher<DetectedScript>([new ContentMatcher('analytics'), new HashMatcher([createHashInfo('hash-b')], createAuthorisationInfo('revoked', false)), new ContentMatcher('analytics')])
      const result = matcher.authorize(createScript(), TRACE)

      expect(result.authorized).toBe(false)
      expect(result.trace?.consulted.map((step) => step.index)).toEqual([0, 1])
    })

    it('emits an empty trace when not all children identify', () => {
      const matcher = new AndMatcher<DetectedScript>([new ContentMatcher('analytics'), new NameMatcher('^https://other\\.example/')])
      const result = matcher.authorize(createScript(), TRACE)

      expect(result.authorized).toBe(false)
      expect(result.trace).toEqual({ type: 'and', consulted: [] })
    })

    it('does not change the decision', () => {
      const matcher = new AndMatcher<DetectedScript>([new WorkflowMatcher('^checkout$'), new HashMatcher([createHashInfo('hash-b')])])

      expectDecisionUnaffected(matcher, createScript({ workflowId: 'checkout' }))
      expectDecisionUnaffected(matcher, createScript({ workflowId: 'other' }))
    })
  })

  describe('nested composites', () => {
    it('traces a full root-to-leaf path through or → and → hash', () => {
      // The shape the inventory workflow mints for a workflow-scoped hash
      // alternative: [ { andMatcher: [ workflowMatcher, hashes ] }, ... ].
      const matcher = new OrMatcher<DetectedScript>([
        new AndMatcher<DetectedScript>([new WorkflowMatcher('^other$'), new HashMatcher([createHashInfo('hash-a')])], createAuthorisationInfo('other workflow')),
        new AndMatcher<DetectedScript>([new WorkflowMatcher('^checkout$'), new HashMatcher([createHashInfo('hash-a'), createHashInfo('hash-b')])], createAuthorisationInfo('checkout workflow')),
      ])

      const result = matcher.authorize(createScript({ workflowId: 'checkout', hash: createHash('hash-b') }), TRACE)

      expect(result.authorized).toBe(true)
      expect(result.trace).toEqual({
        type: 'or',
        consulted: [
          {
            slot: 'child',
            index: 1,
            child: {
              type: 'and',
              consulted: [
                { slot: 'child', index: 0, child: { type: 'workflow', consulted: [] } },
                { slot: 'child', index: 1, child: { type: 'hash', consulted: [{ slot: 'hashes', index: 1 }] } },
              ],
            },
          },
        ],
      })
    })

    it('traces four levels of nesting', () => {
      const matcher = new AndMatcher<DetectedScript>([new OrMatcher<DetectedScript>([new AndMatcher<DetectedScript>([new OrMatcher<DetectedScript>([new ContentMatcher('analytics')])])])])

      const result = matcher.authorize(createScript(), TRACE)

      expect(result.authorized).toBe(true)
      expect(result.trace).toEqual({
        type: 'and',
        consulted: [
          {
            slot: 'child',
            index: 0,
            child: {
              type: 'or',
              consulted: [
                {
                  slot: 'child',
                  index: 0,
                  child: {
                    type: 'and',
                    consulted: [{ slot: 'child', index: 0, child: { type: 'or', consulted: [{ slot: 'child', index: 0, child: { type: 'content', consulted: [] } }] } }],
                  },
                },
              ],
            },
          },
        ],
      })
    })
  })
})
