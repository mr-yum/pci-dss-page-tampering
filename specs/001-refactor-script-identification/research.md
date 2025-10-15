# Research: Script Identification and Authorisation Refactor

**Date**: 2025-10-15
**Feature**: Script Identification and Authorisation Refactor
**Branch**: 001-refactor-script-identification

## Research Questions

Based on Technical Context unknowns and clarifications needed for implementation.

---

## R1: Matcher Pattern Design

**Question**: What design pattern best supports independent, testable matcher implementations while enabling first-match-wins ordering and regex validation?

**Decision**: Strategy Pattern with Registry

**Rationale**:
- **Strategy Pattern**: Each matcher type (NameMatcher, ContentMatcher, HashMatcher) implements common `Matcher` interface with `identify()` and `authorize()` methods
- **No Registry Needed**: First-match-wins handled by inventory array iteration order (per clarification Q1)
- **Validation at Schema Level**: Zod schema custom refinements validate regex patterns during inventory load (per clarification Q2)

**Alternatives Considered**:
- **Factory Pattern**: Rejected - adds unnecessary indirection; matchers instantiated directly from inventory config
- **Chain of Responsibility**: Rejected - violates first-match-wins semantics; would require complex priority management
- **Visitor Pattern**: Rejected - overcomplicates; scripts don't need polymorphic operations beyond matching

**Implementation Notes**:
```typescript
interface Matcher {
  identify(script: DetectedScript): boolean;
  authorize(script: DetectedScript): AuthorizationResult;
  getType(): 'name' | 'content' | 'hash';
  getPattern(): string | Hash[]; // For logging/debugging
}

class NameMatcher implements Matcher {
  constructor(private pattern: RegExp) {}
  identify(script: DetectedScript): boolean {
    return this.pattern.test(script.name);
  }
  authorize(script: DetectedScript): AuthorizationResult {
    return this.pattern.test(script.content)
      ? { authorized: true }
      : { authorized: false, reason: 'content does not match pattern' };
  }
}
```

---

## R2: Zod Schema Migration Strategy

**Question**: How should Zod schemas handle the transition from old schema (no identifyWith/authoriseWith) to new schema without runtime migration?

**Decision**: Strict Validation with Clear Error Messages

**Rationale** (per clarification Q4):
- Reject old schema format entirely (no backward compatibility)
- Require manual migration before deployment
- Provide actionable error messages identifying missing fields

**Alternatives Considered**:
- **Automatic Migration**: Rejected per user clarification Q4 - requires manual update
- **Dual Schema Support**: Rejected - adds complexity, delays full adoption of new pattern
- **Gradual Migration with Warnings**: Rejected - creates ambiguity about which schema is active

**Implementation Notes**:
```typescript
// src/types/inventory/zod.ts
const MatcherConfigSchema = z.union([
  z.object({ nameMatcher: z.string().regex(/.+/) }), // Validates non-empty
  z.object({ contentMatcher: z.string().regex(/.+/) }),
  z.object({ hashes: z.array(HashSchema).min(1) })
]).refine(
  (val) => {
    // Custom refinement: validate regex syntax
    if ('nameMatcher' in val) {
      try { new RegExp(val.nameMatcher); return true; }
      catch (e) { return false; }
    }
    if ('contentMatcher' in val) {
      try { new RegExp(val.contentMatcher); return true; }
      catch (e) { return false; }
    }
    return true;
  },
  { message: 'Invalid regex pattern in matcher configuration' }
);

const ScriptInventoryEntrySchema = z.object({
  identifyWith: MatcherConfigSchema,
  authoriseWith: MatcherConfigSchema,
  authorisationInfo: AuthorisationInfoSchema
});
```

**Migration Documentation**: See quickstart.md for step-by-step migration guide.

---

## R3: Typed Comparison Results Design

**Question**: What class hierarchy supports extensible comparison results with complete context for handlers?

**Decision**: Discriminated Union with Base Class

**Rationale**:
- **TypeScript Discriminated Unions**: Enable exhaustive type checking in handlers via `type` field
- **Base Class**: Provides common context (target, timestamp) shared across all results
- **Full Context**: Each result type includes everything handlers need (script details, matcher info, failure reason)

**Alternatives Considered**:
- **Plain Objects**: Rejected - loses type safety, no compile-time guarantees in handler switches
- **Deep Inheritance Hierarchy**: Rejected - violates Principle VI (minimal complexity)
- **Result Wrapper with Generic**: Rejected - obscures result types, makes handler logic verbose

**Implementation Notes**:
```typescript
// src/types/comparison.ts
abstract class ComparisonResult {
  abstract readonly type: string;
  constructor(
    public readonly target: Target,
    public readonly timestamp: Date
  ) {}
}

class UnknownScriptFound extends ComparisonResult {
  readonly type = 'unknown_script_found';
  constructor(
    target: Target,
    timestamp: Date,
    public readonly script: DetectedScript
  ) {
    super(target, timestamp);
  }
}

class KnownScriptWithUnauthorisedContentFound extends ComparisonResult {
  readonly type = 'known_script_unauthorised_content';
  constructor(
    target: Target,
    timestamp: Date,
    public readonly script: DetectedScript,
    public readonly inventoryEntry: ScriptInventoryEntry,
    public readonly authorizationMatcher: Matcher,
    public readonly failureReason: string
  ) {
    super(target, timestamp);
  }
}

class AuthorizedScriptFound extends ComparisonResult {
  readonly type = 'authorized_script';
  constructor(
    target: Target,
    timestamp: Date,
    public readonly script: DetectedScript,
    public readonly inventoryEntry: ScriptInventoryEntry
  ) {
    super(target, timestamp);
  }
}

type ComparisonResultType =
  | UnknownScriptFound
  | KnownScriptWithUnauthorisedContentFound
  | AuthorizedScriptFound;
```

**Handler Pattern**:
```typescript
function handleComparisonResult(result: ComparisonResultType) {
  switch (result.type) {
    case 'unknown_script_found':
      // TypeScript narrows type to UnknownScriptFound
      alertService.send({ script: result.script, target: result.target });
      break;
    case 'known_script_unauthorised_content':
      // TypeScript narrows type to KnownScriptWithUnauthorisedContentFound
      alertService.send({
        script: result.script,
        inventoryEntry: result.inventoryEntry,
        reason: result.failureReason,
        matcher: result.authorizationMatcher.getPattern()
      });
      break;
    case 'authorized_script':
      // No alert needed
      break;
  }
}
```

---

## R4: First-Match-Wins Implementation

**Question**: How should comparison service enforce first-match-wins when multiple inventory entries could match a detected script?

**Decision**: Array Iteration with Early Return

**Rationale** (per clarification Q1):
- Iterate inventory.scripts in array order
- Return first matcher where `identifyWith.identify(script)` returns true
- Simple, predictable, aligns with common pattern-matching systems (routing, firewall rules)

**Alternatives Considered**:
- **Specificity Scoring**: Rejected per user clarification - order-dependent preferred
- **Explicit Priority Field**: Rejected - array order is priority
- **Match-All-Then-Select**: Rejected - unnecessary overhead, violates early-exit principle

**Implementation Notes**:
```typescript
function findMatchingInventoryEntry(
  script: DetectedScript,
  inventory: ScriptInventoryEntry[]
): ScriptInventoryEntry | null {
  for (const entry of inventory) {
    const matcher = createMatcher(entry.identifyWith);
    if (matcher.identify(script)) {
      return entry; // First match wins
    }
  }
  return null; // No match found
}
```

---

## R5: Null/Empty Content Handling

**Question**: How should matchers behave when detected script has null or empty content?

**Decision**: Fail-Secure with UnknownScriptFound (per clarification Q3)

**Rationale**:
- Null/empty content indicates detection failure or potential attack
- Cannot reliably match contentMatcher or validate hashes
- Treat as security event requiring investigation

**Alternatives Considered**:
- **Silent Skip**: Rejected - creates security blind spot
- **Name-Only Match**: Rejected - partial matching could miss unauthorized content
- **Fail Entire Workflow**: Rejected - overly aggressive, blocks legitimate detection

**Implementation Notes**:
```typescript
class ContentMatcher implements Matcher {
  identify(script: DetectedScript): boolean {
    if (!script.content || script.content.trim() === '') {
      return false; // Cannot match on empty content
    }
    return this.pattern.test(script.content);
  }
}

// In comparison service:
function compareScript(script: DetectedScript, inventory: ScriptInventoryEntry[]): ComparisonResult {
  if (!script.content || script.content.trim() === '') {
    return new UnknownScriptFound(target, new Date(), script);
  }
  // ... normal matching logic
}
```

---

## R6: Regex Validation Error Messages

**Question**: What error messages provide sufficient context for inventory administrators to fix invalid regex patterns?

**Decision**: Include pattern, error location, and suggested fix

**Rationale**:
- Regex syntax errors are common (unclosed brackets, invalid escape sequences)
- Error message must identify which inventory entry and which field (identifyWith vs authoriseWith)
- Include JavaScript RegExp error message for debugging

**Implementation Notes**:
```typescript
// Zod custom refinement with detailed error
const MatcherConfigSchema = z.union([
  z.object({ nameMatcher: z.string() }),
  z.object({ contentMatcher: z.string() }),
  z.object({ hashes: z.array(HashSchema) })
]).superRefine((val, ctx) => {
  let patternType: 'nameMatcher' | 'contentMatcher' | null = null;
  let pattern: string | null = null;

  if ('nameMatcher' in val) {
    patternType = 'nameMatcher';
    pattern = val.nameMatcher;
  } else if ('contentMatcher' in val) {
    patternType = 'contentMatcher';
    pattern = val.contentMatcher;
  }

  if (pattern && patternType) {
    try {
      new RegExp(pattern);
    } catch (e: any) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid regex in ${patternType}: "${pattern}". Error: ${e.message}. Ensure all brackets are closed and escape sequences are valid.`,
        path: [patternType]
      });
    }
  }
});
```

---

## R7: Test Coverage Strategy

**Question**: What test scenarios ensure matcher implementations and comparison logic maintain security guarantees?

**Decision**: Unit Tests + Integration Tests + Refactoring Tests

**Rationale**:
- **Unit Tests**: Each matcher type independently tested (10+ scenarios per matcher)
- **Integration Tests**: Full comparison pipeline with all 9 combinations (3 identify × 3 authorize)
- **Refactoring Tests**: Capture current behavior before refactoring (per Constitution Refactoring Protocol)

**Test Scenarios**:

**NameMatcher Unit Tests**:
- Exact URL match
- URL with dynamic query parameters
- URL with path variables
- Non-matching URL
- Null/empty script name
- Invalid regex pattern (should be caught by Zod)

**ContentMatcher Unit Tests**:
- Exact content match
- Partial content match (regex)
- Non-matching content
- Null/empty content
- Multi-line content with newlines
- Special regex characters in content

**HashMatcher Unit Tests**:
- Single hash match
- Multiple hashes (any match)
- No hash match
- Empty hash array
- Null content (cannot compute hash)

**Comparison Service Integration Tests**:
- Unknown script (no inventory match)
- Known script, authorized content
- Known script, unauthorized content
- First-match-wins with overlapping patterns
- Null content handling
- Invalid regex in inventory (should fail on load)

**Refactoring Tests** (pre-refactoring baseline):
- Current script.ts behavior with real inventory examples
- Hash-based matching for external scripts
- Name-based matching for scripts with query params
- Content-based matching for inline scripts

---

## Summary

All research questions resolved. Key decisions:
1. **Matcher Pattern**: Strategy pattern with interface-based polymorphism
2. **Schema Migration**: Strict validation, manual migration required
3. **Comparison Results**: Discriminated union with base class for type safety
4. **First-Match-Wins**: Array iteration with early return
5. **Null Content**: Fail-secure with UnknownScriptFound
6. **Regex Validation**: Detailed error messages with pattern and location
7. **Test Coverage**: >90% coverage with unit + integration + refactoring tests

Proceed to Phase 1 (Design & Contracts).
