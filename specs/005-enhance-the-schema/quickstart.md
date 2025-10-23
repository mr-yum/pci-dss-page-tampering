# Quickstart: Composite Matchers with Nested Authorization

**Feature**: 005-enhance-the-schema
**Date**: 2025-10-22
**Audience**: Developers implementing composite matcher support

## Overview

This quickstart guide walks through implementing composite matchers (OR/AND logic) with nested authorization metadata for the PCI DSS page tampering detection system.

---

## Prerequisites

- TypeScript knowledge (interfaces, classes, generics)
- Familiarity with Zod schema validation
- Understanding of the existing matcher system (`NameMatcher`, `ContentMatcher`, etc.)
- Access to the codebase at `/Users/tal/dev/pci-dss-page-tampering`

---

## Key Concepts

### 1. Composite Pattern

Composite matchers contain other matchers (including other composites) to build authorization trees:

```typescript
// Simple matcher (leaf node)
const leafMatcher = new ContentMatcher('default-src.*self')

// Composite matcher (branch node)
const compositeMatcher = new AndMatcher([
  new ContentMatcher('default-src'),
  new ContentMatcher('script-src'),
  new ContentMatcher('connect-src')
])

// Nested composite (tree structure)
const nestedComposite = new OrMatcher([
  new AndMatcher([...]),  // Option 1
  new AndMatcher([...])   // Option 2
])
```

### 2. Authorization Metadata Path

When composite matchers evaluate, they collect authorization metadata from root to leaf:

```typescript
// Result from nested matcher evaluation
{
  authorized: true,
  metadataPath: [
    { description: "CSP policy - strict or legacy", authorised: true, ... },  // Root
    { description: "Strict CSP with nonce scripts", authorised: true, ... }   // Leaf
  ]
}
```

### 3. Top-Level Authorization Override

Top-level `authorisationInfo.authorised` value overrides child authorization decisions (FR-004):

```typescript
// Even if children authorize, top-level false denies
const matcher = new OrMatcher(
  [new ContentMatcher('.*')], // Matches everything
  { authorised: false, description: 'Explicitly denied', date: '...' },
)

matcher.authorize(script) // { authorized: false, reason: 'Top-level authorization denied: ...' }
```

---

## Implementation Steps

### Step 0: Introduce Matchable Interface (Type Safety Refinement)

**File**: `src/types/matcher/matcher.interface.ts` (MODIFY)

```typescript
import type { SHA256Hash } from '../hash'

/**
 * Generic matchable resource (script or header).
 * Provides common structure for matcher operations.
 */
export interface Matchable {
  /** Resource name (script URL or header name) */
  name: string

  /** Resource content (script source or header value) */
  content: string | null

  /** Optional hash (scripts only, undefined for headers) */
  hash?: SHA256Hash
}

/**
 * Detected script with required hash (extends Matchable).
 * Backward compatible with existing code.
 */
export type DetectedScript = Matchable & {
  hash: SHA256Hash // Required for scripts (not optional)
}

/**
 * Generic matcher interface (updated to use Matchable).
 */
export interface Matcher<T extends Matchable = Matchable> {
  getType(): 'name' | 'header-name' | 'content' | 'hash' | 'or' | 'and'
  getPattern(): string | InventoryScriptHashInfo[] | Matcher[]
  identify(resource: T): boolean
  authorize(resource: T): AuthorizationResult
}
```

**Key Changes**:

- ✅ Introduces `Matchable` interface for scripts and headers
- ✅ `DetectedScript` extends `Matchable` (backward compatible)
- ✅ `Matcher` uses generic type parameter `<T extends Matchable>`
- ✅ Eliminates `hash: '' as unknown as SHA256Hash` workaround in header comparison

**How Headers Work with Matchable**:

```typescript
// Header comparison service adapts header data to Matchable shape:
const headerAsMatchable: Matchable = {
  name: header.name, // e.g., 'content-security-policy'
  content: header.value, // e.g., 'default-src https:; script-src...'
  hash: undefined, // No type cast needed! (was: '' as unknown as SHA256Hash)
}

// Composite matchers work identically for headers:
const headerMatcher = new AndMatcher<Matchable>([new ContentMatcher('default-src'), new ContentMatcher('script-src')])

headerMatcher.authorize(headerAsMatchable) // Works seamlessly!
```

---

### Step 1: Create OrMatcher Class

**File**: `src/types/matcher/or-matcher.ts` (NEW)

```typescript
import { Matcher, Matchable } from './matcher.interface'
import { InventoryAuthorisationInfo } from '../inventory/authorisation-info'
import { AuthorizationResult } from './authorization-result'

/**
 * Generic composite matcher implementing OR logic.
 * Works with any Matchable resource type (scripts or headers).
 *
 * Type parameter T allows the matcher to be used with:
 * - Scripts: OrMatcher<DetectedScript>
 * - Headers: OrMatcher<Matchable> (hash is undefined)
 * - Any matchable resource: OrMatcher<T extends Matchable>
 */
export class OrMatcher<T extends Matchable = Matchable> implements Matcher<T> {
  private readonly children: Matcher<T>[]
  private readonly authorisationInfo?: InventoryAuthorisationInfo

  constructor(children: Matcher<T>[], authorisationInfo?: InventoryAuthorisationInfo) {
    // FR-008, FR-012: Reject empty arrays (fail-secure)
    if (!children || children.length === 0) {
      throw new Error('OrMatcher requires at least one child matcher')
    }
    this.children = children
    this.authorisationInfo = authorisationInfo
  }

  getType(): 'or' {
    return 'or'
  }

  getPattern(): Matcher<T>[] {
    return this.children
  }

  identify(resource: T): boolean {
    // FR-001: Succeeds if ANY child identifies
    return this.children.some((child) => child.identify(resource))
  }

  authorize(resource: T): AuthorizationResult {
    // Fail-secure: null/empty content check
    if (!resource || !resource.content || resource.content.trim() === '') {
      return {
        authorized: false,
        reason: 'Resource content is null or empty',
        metadataPath: this.authorisationInfo ? [this.authorisationInfo] : [],
      }
    }

    // FR-013: First-match-wins semantics
    const matchingChild = this.children.find((child) => child.identify(resource))

    if (!matchingChild) {
      return {
        authorized: false,
        reason: 'No child matcher identified the script',
        metadataPath: this.authorisationInfo ? [this.authorisationInfo] : [],
      }
    }

    // Get authorization from matching child
    const childResult = matchingChild.authorize(script)

    // FR-004: Top-level authorisationInfo overrides child result
    if (this.authorisationInfo) {
      return {
        authorized: this.authorisationInfo.authorised,
        reason: this.authorisationInfo.authorised ? undefined : `Top-level authorization denied: ${this.authorisationInfo.description}`,
        metadataPath: [this.authorisationInfo, ...(childResult.metadataPath ?? [])],
      }
    }

    // Use child authorization result
    return childResult
  }
}
```

**Key Points**:

- Constructor validates children array is non-empty (prevents vacuous truth issues)
- `identify()` uses `Array.some()` for OR logic
- `authorize()` implements first-match-wins and metadata path collection
- Top-level `authorisationInfo` overrides child authorization

---

### Step 2: Create AndMatcher Class

**File**: `src/types/matcher/and-matcher.ts` (NEW)

```typescript
import { Matcher } from './matcher.interface'
import { DetectedScript } from '../script'
import { InventoryAuthorisationInfo } from '../inventory/authorisation-info'

export interface AuthorizationResult {
  authorized: boolean
  reason?: string
  metadataPath?: InventoryAuthorisationInfo[]
}

export class AndMatcher implements Matcher {
  private readonly children: Matcher[]
  private readonly authorisationInfo?: InventoryAuthorisationInfo

  constructor(children: Matcher[], authorisationInfo?: InventoryAuthorisationInfo) {
    // FR-008, FR-012: Reject empty arrays (prevents Array.every([]) === true)
    if (!children || children.length === 0) {
      throw new Error('AndMatcher requires at least one child matcher')
    }
    this.children = children
    this.authorisationInfo = authorisationInfo
  }

  getType(): 'and' {
    return 'and'
  }

  getPattern(): Matcher[] {
    return this.children
  }

  identify(script: DetectedScript): boolean {
    // FR-002: Succeeds only if ALL children identify
    return this.children.every((child) => child.identify(script))
  }

  authorize(script: DetectedScript): AuthorizationResult {
    // Fail-secure: null/empty content check
    if (!script || !script.content || script.content.trim() === '') {
      return {
        authorized: false,
        reason: 'Script content is null or empty',
        metadataPath: this.authorisationInfo ? [this.authorisationInfo] : [],
      }
    }

    // Check if all children identify first
    if (!this.identify(script)) {
      return {
        authorized: false,
        reason: 'Not all child matchers identified the script',
        metadataPath: this.authorisationInfo ? [this.authorisationInfo] : [],
      }
    }

    const childResults: AuthorizationResult[] = []

    // FR-014: Short-circuit on first failure
    for (const child of this.children) {
      const childResult = child.authorize(script)
      childResults.push(childResult)

      if (!childResult.authorized) {
        const metadataPath = childResults.flatMap((r) => r.metadataPath ?? [])
        return {
          authorized: false,
          reason: `Child matcher failed: ${childResult.reason}`,
          metadataPath: this.authorisationInfo ? [this.authorisationInfo, ...metadataPath] : metadataPath,
        }
      }
    }

    // All children succeeded - collect full metadata path
    const fullMetadataPath = childResults.flatMap((r) => r.metadataPath ?? [])

    // FR-004: Top-level authorisationInfo overrides
    if (this.authorisationInfo) {
      return {
        authorized: this.authorisationInfo.authorised,
        reason: this.authorisationInfo.authorised ? undefined : `Top-level authorization denied: ${this.authorisationInfo.description}`,
        metadataPath: [this.authorisationInfo, ...fullMetadataPath],
      }
    }

    return {
      authorized: true,
      metadataPath: fullMetadataPath,
    }
  }
}
```

**Key Points**:

- Constructor validates children array is non-empty (critical for fail-secure behavior)
- `identify()` uses `Array.every()` but only because array is guaranteed non-empty
- `authorize()` implements short-circuit evaluation (FR-014)
- Metadata path collects from all evaluated children

**IMPORTANT**: Never use `Array.every()` without validating non-empty array first! `Array.every([]) === true` is a security violation for AND logic.

---

### Step 3: Update Matcher Interface

**File**: `src/types/matcher/matcher.interface.ts` (MODIFY)

```typescript
export interface Matcher {
  // Update return type to include composite types
  getType(): 'name' | 'header-name' | 'content' | 'hash' | 'or' | 'and'

  // Update return type to support Matcher[] for composites
  getPattern(): string | InventoryScriptHashInfo[] | Matcher[]

  identify(script: DetectedScript): boolean
  authorize(script: DetectedScript): AuthorizationResult // Use new result type
}
```

---

### Step 4: Extend Matcher Factory

**File**: `src/types/matcher/matcher-factory.ts` (MODIFY)

```typescript
import { OrMatcher } from './or-matcher'
import { AndMatcher } from './and-matcher'

export function createMatcher(config: MatcherConfig): Matcher {
  // Existing matchers (unchanged)
  if ('nameMatcher' in config) {
    return new NameMatcher(config.nameMatcher)
  }

  if ('headerNameMatcher' in config) {
    return new HeaderNameMatcher(config.headerNameMatcher)
  }

  if ('contentMatcher' in config) {
    return new ContentMatcher(config.contentMatcher)
  }

  if ('hashes' in config) {
    return new HashMatcher(config.hashes)
  }

  // NEW: Composite matchers
  if ('orMatcher' in config) {
    // Recursively create child matchers
    const children = config.orMatcher.map((childConfig) => createMatcher(childConfig))
    return new OrMatcher(children, config.authorisationInfo)
  }

  if ('andMatcher' in config) {
    // Recursively create child matchers
    const children = config.andMatcher.map((childConfig) => createMatcher(childConfig))
    return new AndMatcher(children, config.authorisationInfo)
  }

  throw new Error('Invalid MatcherConfig: no recognized matcher type')
}
```

**Key Point**: Recursive matcher creation via `config.orMatcher.map(createMatcher)` builds the composite tree.

---

### Step 5: Update Zod Schema for Recursive Matchers

**File**: `src/types/inventory/matcher-config-schema.ts` (MODIFY)

```typescript
import { z } from 'zod'

// Authorization info schema (existing)
const InventoryAuthorisationInfoRawSchema = z.object({
  description: z.string().min(1),
  authorised: z.boolean(),
  date: z.string().datetime(),
})

// Leaf matcher schemas (existing)
const NameMatcherConfigSchema = z.object({
  nameMatcher: z.string().min(1),
})

const ContentMatcherConfigSchema = z.object({
  contentMatcher: z.string().min(1),
})

// ... other leaf matchers

// NEW: Composite matcher schemas with z.lazy() for recursion
const OrMatcherConfigSchema = z.object({
  orMatcher: z.lazy(() => z.array(MatcherConfigSchema).min(1, 'orMatcher must contain at least 1 child')),
  authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
})

const AndMatcherConfigSchema = z.object({
  andMatcher: z.lazy(() => z.array(MatcherConfigSchema).min(1, 'andMatcher must contain at least 1 child')),
  authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
})

// Combined matcher config (discriminated union)
export const MatcherConfigSchema = z.union([
  NameMatcherConfigSchema,
  ContentMatcherConfigSchema,
  // ... other leaf matchers
  OrMatcherConfigSchema,
  AndMatcherConfigSchema,
])

export type MatcherConfig = z.infer<typeof MatcherConfigSchema>
```

**Key Points**:

- Use `z.lazy()` to defer schema evaluation for recursive references
- `.min(1)` enforces FR-008 (composite arrays must have at least one child)
- TypeScript will infer the correct recursive type

---

### Step 6: Support Array Syntax for OR

**File**: `src/types/inventory/zod.ts` (MODIFY)

```typescript
// FR-006: Array syntax as syntactic sugar for OR matcher
export const RawAuthorizeWithConfigSchema = z.union([
  // Single matcher (existing)
  z.intersection(MatcherConfigSchema, z.object({ authorisationInfo: InventoryAuthorisationInfoRawSchema })),

  // NEW: Array of matchers (syntactic sugar for OR)
  z.array(z.intersection(MatcherConfigSchema, z.object({ authorisationInfo: InventoryAuthorisationInfoRawSchema }))).min(1),
])

// Processing function to convert array to OrMatcher
export function processAuthorizeWith(raw: RawAuthorizeWithConfig): AuthorizeWithConfig {
  if (Array.isArray(raw)) {
    // Convert array to OrMatcher automatically
    const children = raw.map((item) => createMatcher(item))
    const matcher = new OrMatcher(children)
    return {
      matcher,
      authorisationInfo: raw[0].authorisationInfo, // Use first element's metadata
    }
  }

  // Single matcher (existing path)
  return {
    matcher: createMatcher(raw),
    authorisationInfo: raw.authorisationInfo,
  }
}
```

---

### Step 7: Update Comparison Results

**File**: `src/types/comparison/authorized-script-found.ts` (MODIFY)

```typescript
export class AuthorizedScriptFound {
  readonly type = 'AuthorizedScriptFound' as const
  readonly script: DetectedScript
  readonly inventoryEntry: InventoryEntry
  readonly metadataPath: InventoryAuthorisationInfo[] // NEW: Add metadata path

  constructor(
    script: DetectedScript,
    inventoryEntry: InventoryEntry,
    metadataPath: InventoryAuthorisationInfo[] = [], // NEW parameter
  ) {
    this.script = script
    this.inventoryEntry = inventoryEntry
    this.metadataPath = metadataPath
  }
}
```

**Repeat for**: `KnownScriptWithUnauthorisedContentFound`, `AuthorizedHeaderFound`, `KnownHeaderUnauthorisedContentFound`

---

### Step 8: Update Comparison Services

**File**: `src/services/comparison/script.ts` (MODIFY)

```typescript
private compareSingleScriptWithInventory(
  script: DetectedScript,
  inventory: Inventory
): ComparisonResult {
  for (const entry of inventory.scripts) {
    const identifyMatcher = entry.identifyWith
    const authorizeMatcher = entry.authoriseWith.matcher

    if (identifyMatcher.identify(script)) {
      // Script identified - check authorization
      const authResult = authorizeMatcher.authorize(script)

      if (authResult.authorized) {
        // NEW: Pass metadata path to result
        return new AuthorizedScriptFound(script, entry, authResult.metadataPath ?? [])
      } else {
        return new KnownScriptWithUnauthorisedContentFound(
          script,
          entry,
          authResult.reason ?? 'Authorization failed',
          authResult.metadataPath ?? []  // NEW: Pass partial path
        )
      }
    }
  }

  // No inventory entry identified this script
  return new UnknownScriptFound(script)
}
```

**Key Changes**:

- Call `authorize()` method on matcher (returns `AuthorizationResult` with metadata path)
- Pass `metadataPath` to comparison result constructors

---

## Testing Strategy

### Unit Tests

**File**: `test/unit/types/matcher/or-matcher.test.ts` (NEW)

```typescript
describe('OrMatcher', () => {
  describe('constructor validation', () => {
    it('should reject empty array', () => {
      expect(() => new OrMatcher([])).toThrow('requires at least one child')
    })

    it('should accept single child', () => {
      const matcher = new OrMatcher([new ContentMatcher('test')])
      expect(matcher.getType()).toBe('or')
    })
  })

  describe('identify()', () => {
    it('should return true if any child identifies', () => {
      const matcher = new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')])

      const script = { name: 'test', content: 'pattern2 here', hash: '...' }
      expect(matcher.identify(script)).toBe(true)
    })

    it('should return false if no children identify', () => {
      const matcher = new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')])

      const script = { name: 'test', content: 'other', hash: '...' }
      expect(matcher.identify(script)).toBe(false)
    })
  })

  describe('authorize()', () => {
    it('should authorize when first child matches', () => {
      const authInfo = { description: 'Test', authorised: true, date: '2025-10-22T12:00:00.000Z' }
      const matcher = new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')])

      const script = { name: 'test', content: 'pattern1 here', hash: '...' }
      const result = matcher.authorize(script)

      expect(result.authorized).toBe(true)
    })

    it('should deny when top-level authorised is false', () => {
      const authInfo = { description: 'Denied', authorised: false, date: '2025-10-22T12:00:00.000Z' }
      const matcher = new OrMatcher(
        [new ContentMatcher('.*')], // Matches everything
        authInfo,
      )

      const script = { name: 'test', content: 'anything', hash: '...' }
      const result = matcher.authorize(script)

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Top-level authorization denied')
    })

    it('should collect metadata path', () => {
      const rootInfo = { description: 'Root', authorised: true, date: '2025-10-22T12:00:00.000Z' }
      const matcher = new OrMatcher([new ContentMatcher('test')], rootInfo)

      const script = { name: 'test', content: 'test', hash: '...' }
      const result = matcher.authorize(script)

      expect(result.metadataPath).toContainEqual(rootInfo)
    })
  })
})
```

**Repeat similar tests for**: `AndMatcher`, nested composites, array syntax

---

### Integration Tests

**File**: `test/integration/composite-matcher-workflow.test.ts` (NEW)

```typescript
describe('Composite Matcher Integration', () => {
  it('should authorize CSP header with AND logic', async () => {
    const inventory = {
      headers: [
        {
          identifyWith: { headerNameMatcher: '^content-security-policy$' },
          authoriseWith: {
            andMatcher: [{ contentMatcher: 'default-src' }, { contentMatcher: 'script-src' }, { contentMatcher: 'connect-src' }],
            authorisationInfo: {
              description: 'Complete CSP with all directives',
              authorised: true,
              date: '2025-10-22T12:00:00.000Z',
            },
          },
        },
      ],
    }

    const detectedHeader = {
      name: 'Content-Security-Policy',
      value: 'default-src https:; script-src https:; connect-src https:;',
    }

    const result = await headerComparisonService.compare(detectedHeader, inventory)

    expect(result.type).toBe('AuthorizedHeaderFound')
    expect(result.metadataPath).toHaveLength(1)
  })

  it('should deny CSP header missing required directive', async () => {
    // Same inventory as above
    const detectedHeader = {
      name: 'Content-Security-Policy',
      value: 'default-src https:; script-src https:;', // Missing connect-src
    }

    const result = await headerComparisonService.compare(detectedHeader, inventory)

    expect(result.type).toBe('KnownHeaderUnauthorisedContentFound')
    expect(result.reason).toContain('AND matcher failed')
  })
})
```

---

## Common Patterns

### Pattern 1: Multiple Required Conditions (AND)

Use `andMatcher` when ALL conditions must be present:

```json
{
  "identifyWith": { "headerNameMatcher": "^content-security-policy$" },
  "authoriseWith": {
    "andMatcher": [{ "contentMatcher": "default-src" }, { "contentMatcher": "script-src" }, { "contentMatcher": "object-src.*none" }],
    "authorisationInfo": {
      "description": "CSP must include default-src, script-src, and block objects",
      "authorised": true,
      "date": "2025-10-22T12:00:00.000Z"
    }
  }
}
```

### Pattern 2: Alternative Acceptable Policies (OR)

Use `orMatcher` or array syntax when ANY option is acceptable:

```json
{
  "identifyWith": { "headerNameMatcher": "^content-security-policy$" },
  "authoriseWith": [
    {
      "contentMatcher": "default-src.*self.*script-src.*nonce-",
      "authorisationInfo": {
        "description": "Strict CSP with nonces",
        "authorised": true,
        "date": "2025-10-22T12:00:00.000Z"
      }
    },
    {
      "contentMatcher": "default-src.*self.*script-src.*hash-",
      "authorisationInfo": {
        "description": "Strict CSP with hashes",
        "authorised": true,
        "date": "2025-10-22T12:00:00.000Z"
      }
    }
  ]
}
```

### Pattern 3: Complex Nested Logic

Use nested composites for "(A AND B) OR (C AND D)" logic:

```json
{
  "identifyWith": { "headerNameMatcher": "^content-security-policy$" },
  "authoriseWith": {
    "orMatcher": [
      {
        "andMatcher": [{ "contentMatcher": "default-src.*self" }, { "contentMatcher": "upgrade-insecure-requests" }],
        "authorisationInfo": {
          "description": "Secure policy with upgrade",
          "authorised": true,
          "date": "2025-10-22T12:00:00.000Z"
        }
      },
      {
        "andMatcher": [{ "contentMatcher": "default-src.*https:" }, { "contentMatcher": "block-all-mixed-content" }],
        "authorisationInfo": {
          "description": "HTTPS-only policy",
          "authorised": true,
          "date": "2025-10-22T12:00:00.000Z"
        }
      }
    ],
    "authorisationInfo": {
      "description": "CSP policy - secure or HTTPS-only",
      "authorised": true,
      "date": "2025-10-22T12:00:00.000Z"
    }
  }
}
```

### Pattern 4: Explicit Denial

Use `authorised: false` to explicitly deny a pattern:

```json
{
  "identifyWith": { "headerNameMatcher": "^x-frame-options$" },
  "authoriseWith": {
    "contentMatcher": "DENY|SAMEORIGIN",
    "authorisationInfo": {
      "description": "X-Frame-Options is deprecated; use CSP frame-ancestors instead",
      "authorised": false,
      "date": "2025-10-22T12:00:00.000Z"
    }
  }
}
```

---

## Debugging Tips

### 1. Check Metadata Path

```typescript
console.log('Authorization metadata path:', result.metadataPath)
// Output: [
//   { description: 'Root composite', authorised: true, ... },
//   { description: 'Leaf matcher', authorised: true, ... }
// ]
```

### 2. Verify Matcher Type

```typescript
console.log('Matcher type:', matcher.getType())
// Output: 'or' or 'and'
```

### 3. Inspect Children

```typescript
const pattern = matcher.getPattern()
if (Array.isArray(pattern)) {
  console.log('Composite matcher with', pattern.length, 'children')
  pattern.forEach((child, i) => console.log(`Child ${i}:`, child.getType()))
}
```

---

## Rollout Checklist

- [ ] `OrMatcher` class created and tested
- [ ] `AndMatcher` class created and tested
- [ ] `Matcher` interface updated for composite types
- [ ] Matcher factory extended with composite matcher creation
- [ ] Zod schema updated with `z.lazy()` for recursive matchers
- [ ] Array syntax support added for OR logic
- [ ] Comparison result types updated with `metadataPath`
- [ ] Comparison services updated to pass metadata paths
- [ ] Unit tests written for all composite matcher scenarios
- [ ] Integration tests written for end-to-end workflows
- [ ] Documentation updated (CLAUDE.md, README.md)
- [ ] Schema validation tested with example inventory entries
- [ ] Migration plan documented for existing inventory entries

---

## Next Steps

After implementing composite matchers:

1. Run the full test suite: `npm run test:unit && npm run test:integration`
2. Validate example inventory entries: `npm run validate-inventory`
3. Update CLAUDE.md with composite matcher patterns
4. Test with real CSP headers in staging environment
5. Create example inventory entries for documentation
6. Generate tasks.md via `/speckit.tasks` command for implementation tracking
