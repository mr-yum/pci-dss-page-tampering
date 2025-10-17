# API Contracts: Header Comparison and Alert Refactor

**Feature Branch**: `002-continuing-our-refactor`
**Generated**: 2025-10-17

## Overview

This directory contains TypeScript interface contracts defining the public APIs for the header comparison and alert refactor. These contracts serve as executable specifications that can be validated during implementation.

## Contracts

### 1. header-comparison-results.ts

Defines the three typed header comparison result classes and supporting types:

- **UnknownHeaderFound**: Header not in inventory
- **KnownHeaderWithUnauthorisedContentFound**: Header identified but value unauthorized
- **AuthorizedHeaderFound**: Header both identified and authorized
- **DetectedHeader**: Single header name-value pair
- **InventoryHeaderInfo**: Header inventory entry schema
- **HeaderComparisonResultType**: Discriminated union of header results

**Key design decisions:**
- Extends ComparisonResult base class for consistency with scripts
- Includes complete context (no additional queries needed by handlers)
- Uses readonly properties for immutability
- Supports one result per header value for granular alerting

### 2. unified-alert-handler.ts

Defines the unified alert service interface processing both script and header results:

- **IAlertService**: Service interface with alertForTypedResults method
- **ComparisonResultType**: Discriminated union of ALL result types (scripts + headers)

**Key design decisions:**
- Single method replaces legacy alertForScripts and alertForHeaders
- Discriminated union enables exhaustive type checking
- TypeScript narrowing provides type safety in switch cases
- Legacy methods marked deprecated for migration period

**Example implementation pattern included in file**

### 3. header-comparison-service.ts

Defines the updated header comparison service interface:

- **IHeaderComparisonService**: Service interface returning typed results

**Key design decisions:**
- Returns `HeaderComparisonResultType[]` instead of `HeaderComparisonSummary`
- One result per header value (N values → N results)
- Case-insensitive name matching, case-sensitive value matching
- First-match-wins for inventory entry selection

**Algorithm and helper method patterns included in file**

## Usage Guidelines

### For Implementation

1. Implement result classes in `src/types/comparison/`:
   - Create `unknown-header-found.ts`
   - Create `known-header-unauthorised-content-found.ts`
   - Create `authorized-header-found.ts`

2. Update HeaderComparisonService in `src/services/comparison/header.ts`:
   - Change return type to `Promise<HeaderComparisonResultType[]>`
   - Implement iteration over header values
   - Apply matcher pattern (identifyWith, authoriseWith)
   - Return typed results

3. Update SlackAlertService in `src/services/alert/slack.ts`:
   - Expand ComparisonResultType union with header types
   - Add header result cases to switch statement
   - Remove legacy methods after migration confirmed

### For Testing

1. Unit tests must verify:
   - Each result type includes expected properties
   - Discriminator values are unique and correct
   - Case sensitivity rules enforced (name insensitive, value sensitive)
   - Empty string values handled correctly
   - First-match-wins logic works as expected

2. Integration tests must verify:
   - Full workflow with header violations generates correct alerts
   - Alert routing differs by workflow (inventory vs detection)
   - Multiple values generate multiple results
   - Mixed authorized/unauthorized values handled correctly

## Validation

These contracts can be type-checked against the actual implementation:

```bash
# Type-check contracts against implementation
npm run check:typing

# Verify no references to deprecated methods
grep -r "alertForScripts\|alertForHeaders" src/
```

## References

- **Data Model**: `../data-model.md` - Entity definitions and validation rules
- **Research**: `../research.md` - Design decisions and rationale
- **Feature Spec**: `../spec.md` - Requirements and acceptance criteria
- **Constitution**: `/.specify/memory/constitution.md` - Project principles

## Migration Checklist

- [ ] Implement header result classes in `src/types/comparison/`
- [ ] Update ComparisonResultType union to include header types
- [ ] Update HeaderComparisonService to return typed results
- [ ] Update SlackAlertService switch statement with header cases
- [ ] Write unit tests for header result types
- [ ] Write unit tests for unified alert handler
- [ ] Run integration tests with header violations
- [ ] Verify no regressions in script comparison
- [ ] Remove legacy alertForScripts and alertForHeaders methods
- [ ] Update interface definitions to remove deprecated methods
- [ ] Verify grep shows zero references to legacy methods
