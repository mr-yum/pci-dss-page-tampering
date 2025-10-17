# Quickstart: Header Comparison and Alert Refactor

**Feature Branch**: `002-continuing-our-refactor`
**Last Updated**: 2025-10-17
**For**: Developers implementing the header comparison refactor

## What This Feature Does

This refactor extends the typed comparison result pattern from scripts to headers and consolidates all alert handling into a single unified handler. After this change:

1. **HeaderComparisonService** returns typed results (UnknownHeaderFound, KnownHeaderWithUnauthorisedContentFound, AuthorizedHeaderFound) instead of a simple summary
2. **SlackAlertService** processes both script and header results through a single `alertForTypedResults` method
3. **Header matching** uses the Matcher interface pattern (NameMatcher for names, ContentMatcher for values)
4. **Alert handlers** receive complete context without additional queries

## Prerequisites

- Familiarity with existing ScriptComparisonService implementation (see `src/services/comparison/script.ts`)
- Understanding of Matcher interface pattern (`src/types/matcher/matcher.interface.ts`)
- TypeScript discriminated unions and type narrowing
- Zod schema validation

## Quick Reference

### Key Files to Modify

```
src/types/comparison/
├── unknown-header-found.ts          # NEW - Header not in inventory
├── known-header-unauthorised-content-found.ts  # NEW - Header mismatch
├── authorized-header-found.ts       # NEW - Compliant header
└── index.ts                         # UPDATE - Export new types

src/services/comparison/
└── header.ts                        # MODIFY - Return typed results

src/services/alert/
└── slack.ts                         # MODIFY - Unified handler, remove legacy methods

src/types/inventory/
└── header-entry.ts                  # NEW - Zod schema for header inventory

test/unit/types/comparison/
├── unknown-header-found.test.ts     # NEW
├── known-header-unauthorised-content-found.test.ts  # NEW
└── authorized-header-found.test.ts  # NEW

test/unit/services/comparison/
└── header.test.ts                   # MODIFY - Test typed results

test/unit/services/alert/
└── slack.test.ts                    # MODIFY - Test unified handler
```

### Implementation Order

Follow this sequence to minimize integration issues:

1. **Phase 1**: Implement header result classes (types)
2. **Phase 2**: Update HeaderComparisonService to return typed results
3. **Phase 3**: Extend SlackAlertService with header result handling
4. **Phase 4**: Remove legacy alert methods
5. **Phase 5**: Update inventory schema and migration

## Step-by-Step Implementation

### Step 1: Create Header Result Classes

Create three new files in `src/types/comparison/`:

**File: `unknown-header-found.ts`**
```typescript
import type { DetectedHeader } from '../header'
import type { Target } from '../target'
import { ComparisonResult } from './comparison-result'

export class UnknownHeaderFound extends ComparisonResult {
  readonly type = 'unknown_header_found' as const
  public readonly header: DetectedHeader

  constructor(target: Target, timestamp: Date, header: DetectedHeader) {
    super(target, timestamp)
    this.header = header
  }
}
```

**File: `known-header-unauthorised-content-found.ts`**
```typescript
import type { InventoryHeaderInfo } from '../inventory/model'
import type { DetectedHeader } from '../header'
import type { Matcher } from '../matcher/matcher.interface'
import type { Target } from '../target'
import { ComparisonResult } from './comparison-result'

export class KnownHeaderWithUnauthorisedContentFound extends ComparisonResult {
  readonly type = 'known_header_unauthorised_content' as const
  public readonly header: DetectedHeader
  public readonly inventoryEntry: InventoryHeaderInfo
  public readonly authorizationMatcher: Matcher
  public readonly failureReason: string

  constructor(
    target: Target,
    timestamp: Date,
    header: DetectedHeader,
    inventoryEntry: InventoryHeaderInfo,
    authorizationMatcher: Matcher,
    failureReason: string
  ) {
    super(target, timestamp)
    this.header = header
    this.inventoryEntry = inventoryEntry
    this.authorizationMatcher = authorizationMatcher
    this.failureReason = failureReason
  }
}
```

**File: `authorized-header-found.ts`**
```typescript
import type { InventoryHeaderInfo } from '../inventory/model'
import type { DetectedHeader } from '../header'
import type { Target } from '../target'
import { ComparisonResult } from './comparison-result'

export class AuthorizedHeaderFound extends ComparisonResult {
  readonly type = 'authorized_header' as const
  public readonly header: DetectedHeader
  public readonly inventoryEntry: InventoryHeaderInfo

  constructor(target: Target, timestamp: Date, header: DetectedHeader, inventoryEntry: InventoryHeaderInfo) {
    super(target, timestamp)
    this.header = header
    this.inventoryEntry = inventoryEntry
  }
}
```

**Update `src/types/comparison/index.ts`:**
```typescript
export * from './unknown-header-found'
export * from './known-header-unauthorised-content-found'
export * from './authorized-header-found'

// Update ComparisonResultType union
export type ComparisonResultType =
  | AuthorizedScriptFound
  | KnownScriptWithUnauthorisedContentFound
  | UnknownScriptFound
  | AuthorizedHeaderFound
  | KnownHeaderWithUnauthorisedContentFound
  | UnknownHeaderFound
```

**Write unit tests** for each class before proceeding.

---

### Step 2: Define DetectedHeader Type

**Update `src/types/header.ts`** with:

```typescript
export interface DetectedHeader {
  readonly name: string       // Normalized to lowercase
  readonly value: string      // Single value (may be empty string)
  readonly target: Target
  readonly workflow: string
}
```

---

### Step 3: Update HeaderComparisonService

**Modify `src/services/comparison/header.ts`:**

```typescript
import type { IHeaderComparisonService } from '../../interfaces/comparison'
import type { HeaderDetectionSummary } from '../../types/header'
import type { Inventory } from '../../types/inventory/model'
import type { Target } from '../../types/target'
import { AuthorizedHeaderFound, KnownHeaderWithUnauthorisedContentFound, UnknownHeaderFound } from '../../types/comparison'
import type { ComparisonResultType } from '../../types/comparison'

export class HeaderComparisonService implements IHeaderComparisonService {
  compare(
    target: Target,
    inventory: Inventory,
    headerDetectionSummary: HeaderDetectionSummary
  ): Promise<ComparisonResultType[]> {
    const inventoryHeaders = inventory.headers
    const detectedHeaders = headerDetectionSummary.headers
    const results: ComparisonResultType[] = []
    const timestamp = new Date()

    // Iterate detected headers (Map of name → Set<values>)
    for (const [headerName, valuesSet] of detectedHeaders.entries()) {
      const normalizedName = headerName.toLowerCase()

      // Iterate each value separately (one result per value)
      for (const value of valuesSet) {
        const detectedHeader = {
          name: normalizedName,
          value,
          target,
          workflow: headerDetectionSummary.workflow
        }

        const result = this.compareSingleHeader(
          detectedHeader,
          inventoryHeaders,
          target,
          timestamp
        )
        results.push(result)
      }
    }

    return Promise.resolve(results)
  }

  private compareSingleHeader(
    header: DetectedHeader,
    inventoryHeaders: InventoryHeaderInfo[],
    target: Target,
    timestamp: Date
  ): ComparisonResultType {
    // Find matching inventory entry (first-match-wins)
    const matchedEntry = this.findMatchingInventoryEntry(header.name, inventoryHeaders)

    // No match → unknown header
    if (!matchedEntry) {
      console.log(`[Comparison → Header]: Header '${header.name}' not identified in inventory for target '${target.url}'.`)
      return new UnknownHeaderFound(target, timestamp, header)
    }

    // Log identification
    const identifyMatcher = matchedEntry.identifyWith
    console.log(
      `[Comparison → Header]: Header '${header.name}' identified using ` +
      `${identifyMatcher.getType()}Matcher with pattern '${JSON.stringify(identifyMatcher.getPattern())}'.`
    )

    // Authorize value using authoriseWith matcher
    const authResult = matchedEntry.authoriseWith.authorize({ content: header.value })

    // Log authorization result
    const authorizeMatcher = matchedEntry.authoriseWith
    const authStatus = authResult.authorized ? 'AUTHORIZED' : `UNAUTHORIZED (${authResult.reason})`
    console.log(
      `[Comparison → Header]: Header '${header.name}' authorization via ` +
      `${authorizeMatcher.getType()}Matcher: ${authStatus}.`
    )

    // Return appropriate result
    if (!authResult.authorized) {
      return new KnownHeaderWithUnauthorisedContentFound(
        target,
        timestamp,
        header,
        matchedEntry,
        authorizeMatcher,
        authResult.reason ?? 'Unknown authorization failure'
      )
    }

    return new AuthorizedHeaderFound(target, timestamp, header, matchedEntry)
  }

  private findMatchingInventoryEntry(
    headerName: string,
    inventoryHeaders: InventoryHeaderInfo[]
  ): InventoryHeaderInfo | undefined {
    for (const entry of inventoryHeaders) {
      // Skip non-authorized entries (legacy compatibility)
      if (!entry.authorisationInfo.authorised) continue

      // Test identifyWith matcher (NameMatcher expects { name: string })
      if (entry.identifyWith.identify({ name: headerName })) {
        return entry  // First match wins
      }
    }
    return undefined
  }
}
```

**Update interface** in `src/interfaces/comparison.ts`:
```typescript
export interface IHeaderComparisonService {
  compare(
    target: Target,
    inventory: Inventory,
    headerDetectionSummary: HeaderDetectionSummary
  ): Promise<ComparisonResultType[]>  // Changed from HeaderComparisonSummary
}
```

**Write/update unit tests** to verify typed results.

---

### Step 4: Update SlackAlertService

**Modify `src/services/alert/slack.ts`:**

```typescript
async alertForTypedResults(
  comparisonResults: ComparisonResultType[],
  target: Target,
  alertDestinations: InventoryAlert
): Promise<void> {
  for (const result of comparisonResults) {
    try {
      switch (result.type) {
        case 'unknown_script_found':
          await this.alertForUnknownScript(result, target, alertDestinations)
          break

        case 'known_script_unauthorised_content':
          await this.alertForKnownScriptUnauthorised(result, target, alertDestinations)
          break

        case 'authorized_script':
          // No alert for authorized scripts
          break

        case 'unknown_header_found':
          await this.alertForUnknownHeader(result, target, alertDestinations)
          break

        case 'known_header_unauthorised_content':
          await this.alertForKnownHeaderUnauthorised(result, target, alertDestinations)
          break

        case 'authorized_header':
          // No alert for authorized headers
          break

        default:
          // Exhaustive check - compile error if case missing
          const _exhaustive: never = result
          throw new Error(`Unhandled result type: ${(result as any).type}`)
      }
    } catch (error) {
      // Alert failures must not block comparison
      console.error(`Alert failed for result type ${result.type}:`, error)
    }
  }
}

private async alertForUnknownHeader(
  result: UnknownHeaderFound,
  target: Target,
  alertDestinations: InventoryAlert
): Promise<void> {
  const category = this.isInventoryWorkflow(target)
    ? 'new_inventory_header_identified'
    : 'uninventoried_header_detected'

  await this.sendSlackAlert({
    category,
    header: result.header,
    target: result.target,
    destination: alertDestinations.newHeaderDetected  // Adjust based on category
  })
}

private async alertForKnownHeaderUnauthorised(
  result: KnownHeaderWithUnauthorisedContentFound,
  target: Target,
  alertDestinations: InventoryAlert
): Promise<void> {
  await this.sendSlackAlert({
    category: 'mismatched_header_detected',
    header: result.header,
    inventoryEntry: result.inventoryEntry,
    failureReason: result.failureReason,
    matcher: result.authorizationMatcher.getPattern(),
    target: result.target,
    destination: alertDestinations.headerMismatchDetected
  })
}
```

**Mark legacy methods deprecated:**
```typescript
/** @deprecated Use alertForTypedResults instead */
async alertForScripts(...) { ... }

/** @deprecated Use alertForTypedResults instead */
async alertForHeaders(...) { ... }
```

**After migration confirmed, remove legacy methods entirely.**

---

### Step 5: Update Inventory Schema

**Create `src/types/inventory/header-entry.ts`:**

```typescript
import { z } from 'zod'
import { MatcherSchema } from '../matcher/matcher-factory'

export const InventoryHeaderInfoSchema = z.object({
  identifyWith: MatcherSchema,  // Must be NameMatcher
  authoriseWith: MatcherSchema, // Must be ContentMatcher
  authorisationInfo: z.object({
    authorised: z.boolean(),
    justification: z.string().min(1),
    authorisedAt: z.string().datetime()
  })
})

export type InventoryHeaderInfo = z.infer<typeof InventoryHeaderInfoSchema>
```

**Update `src/types/inventory/model.ts`** to include headers array with new schema.

---

## Testing Checklist

### Unit Tests

- [ ] UnknownHeaderFound class instantiation and properties
- [ ] KnownHeaderWithUnauthorisedContentFound class with all fields
- [ ] AuthorizedHeaderFound class with inventory entry
- [ ] HeaderComparisonService returns typed results
- [ ] HeaderComparisonService case-insensitive name matching
- [ ] HeaderComparisonService case-sensitive value matching
- [ ] HeaderComparisonService first-match-wins logic
- [ ] HeaderComparisonService empty value handling
- [ ] HeaderComparisonService multiple values → multiple results
- [ ] SlackAlertService switch handles all header result types
- [ ] SlackAlertService exhaustive checking (default case throws)

### Integration Tests

- [ ] Full workflow with unknown header generates correct alert
- [ ] Full workflow with mismatched header value generates alert
- [ ] Full workflow with authorized header generates no alert
- [ ] Multiple header values generate separate results
- [ ] Alert routing differs by workflow (inventory vs detection)
- [ ] No regressions in script comparison and alerting

## Common Pitfalls

### Pitfall 1: Not Iterating Values Separately
**Wrong:**
```typescript
for (const [name, values] of headers.entries()) {
  // Processing entire Set as one result
  const result = compare(name, values)  // ❌
}
```

**Correct:**
```typescript
for (const [name, values] of headers.entries()) {
  for (const value of values) {
    // One result per value
    const result = compare(name, value)  // ✅
  }
}
```

### Pitfall 2: Case-Sensitive Name Matching
**Wrong:**
```typescript
// Direct regex test without normalization
entry.identifyWith.identify({ name: "Content-Type" })  // ❌ May fail
```

**Correct:**
```typescript
// Normalize to lowercase first
const normalized = headerName.toLowerCase()
entry.identifyWith.identify({ name: normalized })  // ✅
```

### Pitfall 3: Not Handling Empty Values
**Wrong:**
```typescript
if (!value || value.trim() === '') {
  return new UnknownHeaderFound(...)  // ❌ Incorrectly rejects valid empty
}
```

**Correct:**
```typescript
// Let ContentMatcher decide if empty is authorized
const authResult = entry.authoriseWith.authorize({ content: value })  // ✅
```

### Pitfall 4: Missing Exhaustive Check
**Wrong:**
```typescript
switch (result.type) {
  case 'unknown_header_found': ...
  case 'authorized_header': ...
  // Missing 'known_header_unauthorised_content' case
}
// No default case - silent failure ❌
```

**Correct:**
```typescript
switch (result.type) {
  case 'unknown_header_found': ...
  case 'known_header_unauthorised_content': ...
  case 'authorized_header': ...
  default:
    const _exhaustive: never = result  // ✅ Compile error if case missing
}
```

## Debugging Tips

### Verify Typed Results
```typescript
console.log('Result type:', result.type)
console.log('Has header?', 'header' in result)
console.log('Has inventoryEntry?', 'inventoryEntry' in result)
```

### Check Matcher Execution
```typescript
console.log('Matcher type:', matcher.getType())
console.log('Matcher pattern:', JSON.stringify(matcher.getPattern()))
console.log('Identify result:', matcher.identify(input))
console.log('Authorize result:', matcher.authorize(input))
```

### Validate Case Handling
```typescript
const original = "Content-Type"
const normalized = original.toLowerCase()
console.log('Original:', original)
console.log('Normalized:', normalized)
console.log('Match result:', pattern.test(normalized))
```

## References

- **Feature Spec**: `./spec.md` - Requirements and user scenarios
- **Research**: `./research.md` - Design decisions and rationale
- **Data Model**: `./data-model.md` - Entity definitions and validation
- **Contracts**: `./contracts/` - TypeScript interface definitions
- **Constitution**: `/.specify/memory/constitution.md` - Project principles

## Getting Help

- Review existing ScriptComparisonService implementation in `src/services/comparison/script.ts`
- Check Matcher interface usage in `src/types/matcher/*.test.ts`
- Consult TypeScript discriminated union docs: https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html#discriminating-unions

---

**Ready to start?** Begin with Step 1 (header result classes) and work through each step sequentially. Write tests before implementation to follow TDD principles per the constitution.
