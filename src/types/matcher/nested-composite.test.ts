import type { SHA256Hash } from '../hash.js'
import type { InventoryAuthorisationInfo } from '../inventory/model.js'
import { AndMatcher } from './and-matcher.js'
import { ContentMatcher } from './content-matcher.js'
import type { DetectedScript } from './matcher.interface.js'
import { OrMatcher } from './or-matcher.js'

describe('Nested Composite Matchers', () => {
  const mockScript = (name: string, content: string): DetectedScript => ({
    name,
    content,
    hash: 'mock-hash' as unknown as SHA256Hash,
  })

  const authInfo = (description: string, authorised: boolean = true): InventoryAuthorisationInfo => ({
    description,
    authorised,
    date: new Date(),
  })

  describe('T054: Nested OR containing AND (first AND group succeeds)', () => {
    it('should authorize when first AND group matches all children', () => {
      // Setup: OR containing two AND groups
      // Pattern 1: (content matches "foo" AND content matches "bar")
      // Pattern 2: (content matches "baz" AND content matches "qux")
      const andGroup1 = new AndMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('AND group 1: requires foo and bar'))

      const andGroup2 = new AndMatcher([new ContentMatcher('baz'), new ContentMatcher('qux')], authInfo('AND group 2: requires baz and qux'))

      const orMatcher = new OrMatcher([andGroup1, andGroup2], authInfo('Accept either AND group'))

      // Test: Content contains "foo" and "bar" (first AND group succeeds)
      const resource = mockScript('test-resource', 'This content has foo and bar in it')

      const result = orMatcher.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(2) // OR level + AND group 1 level
      expect(result.metadataPath![0]!.description).toBe('Accept either AND group')
      expect(result.metadataPath![1]!.description).toBe('AND group 1: requires foo and bar')
    })
  })

  describe('T055: Nested OR containing AND (second AND group succeeds)', () => {
    it('should authorize when second AND group matches all children', () => {
      const andGroup1 = new AndMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('AND group 1: requires foo and bar'))

      const andGroup2 = new AndMatcher([new ContentMatcher('baz'), new ContentMatcher('qux')], authInfo('AND group 2: requires baz and qux'))

      const orMatcher = new OrMatcher([andGroup1, andGroup2], authInfo('Accept either AND group'))

      // Test: Content contains "baz" and "qux" (second AND group succeeds)
      const resource = mockScript('test-resource', 'This content has baz and qux in it')

      const result = orMatcher.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(2) // OR level + AND group 2 level
      expect(result.metadataPath![0]!.description).toBe('Accept either AND group')
      expect(result.metadataPath![1]!.description).toBe('AND group 2: requires baz and qux')
    })
  })

  describe('T056: Nested OR containing AND (partial match of both groups, neither complete)', () => {
    it('should deny when no AND group fully matches', () => {
      const andGroup1 = new AndMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('AND group 1: requires foo and bar'))

      const andGroup2 = new AndMatcher([new ContentMatcher('baz'), new ContentMatcher('qux')], authInfo('AND group 2: requires baz and qux'))

      const orMatcher = new OrMatcher([andGroup1, andGroup2], authInfo('Accept either AND group'))

      // Test: Content has "foo" (partial match for group 1) and "baz" (partial match for group 2)
      // Neither group fully matches
      const resource = mockScript('test-resource', 'This content has foo and baz but not complete groups')

      const result = orMatcher.authorize(resource)

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('No child matcher identified the resource')
    })
  })

  describe('T057: Nested AND containing OR', () => {
    it('should authorize only when all OR children succeed', () => {
      // Setup: AND containing two OR groups
      // Pattern: (content matches "foo" OR "bar") AND (content matches "baz" OR "qux")
      const orGroup1 = new OrMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('OR group 1: foo or bar'))

      const orGroup2 = new OrMatcher([new ContentMatcher('baz'), new ContentMatcher('qux')], authInfo('OR group 2: baz or qux'))

      const andMatcher = new AndMatcher([orGroup1, orGroup2], authInfo('Both OR groups must match'))

      // Test: Content has "foo" (matches OR group 1) and "baz" (matches OR group 2)
      const resource = mockScript('test-resource', 'This content has foo and baz')

      const result = andMatcher.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(3) // AND level + OR group 1 + OR group 2
      expect(result.metadataPath![0]!.description).toBe('Both OR groups must match')
      expect(result.metadataPath![1]!.description).toBe('OR group 1: foo or bar')
      expect(result.metadataPath![2]!.description).toBe('OR group 2: baz or qux')
    })

    it('should deny when first OR group fails', () => {
      const orGroup1 = new OrMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('OR group 1: foo or bar'))

      const orGroup2 = new OrMatcher([new ContentMatcher('baz'), new ContentMatcher('qux')], authInfo('OR group 2: baz or qux'))

      const andMatcher = new AndMatcher([orGroup1, orGroup2], authInfo('Both OR groups must match'))

      // Test: Content has "baz" (matches OR group 2) but neither "foo" nor "bar" (OR group 1 fails)
      const resource = mockScript('test-resource', 'This content only has baz')

      const result = andMatcher.authorize(resource)

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Not all child matchers identified the resource')
    })
  })

  describe('T058: Deeply nested composites (5+ levels)', () => {
    it('should handle 5 levels of nesting correctly', () => {
      // Level 5 (deepest): Leaf matchers
      const leaf1 = new ContentMatcher('alpha')
      const leaf2 = new ContentMatcher('beta')

      // Level 4: AND group
      const level4 = new AndMatcher([leaf1, leaf2], authInfo('Level 4: alpha AND beta'))

      // Level 3: OR group
      const level3 = new OrMatcher([level4, new ContentMatcher('gamma')], authInfo('Level 3: (alpha AND beta) OR gamma'))

      // Level 2: AND group
      const level2 = new AndMatcher([level3, new ContentMatcher('delta')], authInfo('Level 2: level3 AND delta'))

      // Level 1: OR group (root)
      const level1 = new OrMatcher([level2, new ContentMatcher('epsilon')], authInfo('Level 1: level2 OR epsilon'))

      // Test: Content matches through the nested path (alpha, beta, delta)
      const resource = mockScript('test-resource', 'Content with alpha beta delta')

      const result = level1.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(4) // All 4 composite levels (leaf matchers don't have metadata)
      expect(result.metadataPath![0]!.description).toContain('Level 1')
      expect(result.metadataPath![1]!.description).toContain('Level 2')
      expect(result.metadataPath![2]!.description).toContain('Level 3')
      expect(result.metadataPath![3]!.description).toContain('Level 4')
    })

    it('should handle short-circuit path through 5 levels', () => {
      // Same structure as above
      const leaf1 = new ContentMatcher('alpha')
      const leaf2 = new ContentMatcher('beta')
      const level4 = new AndMatcher([leaf1, leaf2], authInfo('Level 4: alpha AND beta'))
      const level3 = new OrMatcher([level4, new ContentMatcher('gamma')], authInfo('Level 3: (alpha AND beta) OR gamma'))
      const level2 = new AndMatcher([level3, new ContentMatcher('delta')], authInfo('Level 2: level3 AND delta'))
      const level1 = new OrMatcher([level2, new ContentMatcher('epsilon')], authInfo('Level 1: level2 OR epsilon'))

      // Test: Content matches short-circuit path (epsilon only, bypassing nested structure)
      const resource = mockScript('test-resource', 'Content with epsilon only')

      const result = level1.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(1) // Only root OR level (short-circuited)
      expect(result.metadataPath![0]!.description).toContain('Level 1')
    })
  })

  describe('T059: Metadata path collection through nested composites', () => {
    it('should collect metadata from all evaluated composite levels', () => {
      const andGroup = new AndMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('AND: foo and bar required'))

      const orMatcher = new OrMatcher([andGroup, new ContentMatcher('baz')], authInfo('OR: AND group or baz'))

      const rootAnd = new AndMatcher([orMatcher, new ContentMatcher('qux')], authInfo('Root: OR group and qux'))

      // Test: Content matches through nested path
      const resource = mockScript('test-resource', 'Content with foo bar qux')

      const result = rootAnd.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(3) // Root AND + OR + nested AND
      expect(result.metadataPath![0]!.description).toBe('Root: OR group and qux')
      expect(result.metadataPath![1]!.description).toBe('OR: AND group or baz')
      expect(result.metadataPath![2]!.description).toBe('AND: foo and bar required')
    })

    it('should include partial path on authorization failure', () => {
      const andGroup = new AndMatcher(
        [new ContentMatcher('foo'), new ContentMatcher('bar')],
        authInfo('AND: foo and bar required', false), // Explicitly deny even if both match
      )

      const orMatcher = new OrMatcher([andGroup]) // No authorisationInfo - won't override child result

      const rootAnd = new AndMatcher([orMatcher, new ContentMatcher('qux')])

      // Test: Content has "foo" and "bar" (AND group identifies) but authorization denied by authorisationInfo
      const resource = mockScript('test-resource', 'Content with foo bar and qux')

      const result = rootAnd.authorize(resource)

      expect(result.authorized).toBe(false)
      // Metadata path should include the failed AND level
      expect(result.metadataPath).toBeDefined()
      expect(result.metadataPath!.length).toBeGreaterThan(0)
      expect(result.reason).toContain('Top-level authorization denied')
    })
  })
})
