# API Contracts: Use Typed Comparison Results for Inventory Updates

**Feature**: 006-use-typed-comparison
**Date**: 2025-10-24

## Overview

This directory contains TypeScript interface definitions representing the contracts for the refactored inventory update system. These contracts define the expected inputs, outputs, and behaviors for the updated InventoryService.

## Contracts

### IInventoryService (Modified)

**File**: [inventory-service.interface.ts](./inventory-service.interface.ts)

**Changes**:

- `diff()` method signature updated to accept `ComparisonResultType[]` instead of separate summary parameters
- Return type unchanged (InventoryDifferenceResult)
- Behavior unchanged (creates Git commits for inventory workflow only)

### InventoryService Internal Methods (New)

**File**: [inventory-service-internal.ts](./inventory-service-internal.ts)

**Purpose**: Documents internal private methods for processing typed results

**Methods**:

- `processComparisonResult()` - Switch dispatcher for result types
- `addNewScript()` - Creates new inventory entry from UnknownScriptFound
- `updateScriptWithNewHash()` - Updates existing entry from KnownScriptWithUnauthorisedContentFound
- `addNewHeader()` - Creates new header entry from UnknownHeaderFound
- `updateHeaderWithNewContent()` - Updates existing header from KnownHeaderWithUnauthorisedContentFound

## Usage Examples

See [inventory-service-examples.ts](./inventory-service-examples.ts) for complete usage examples including:

- Processing mixed script and header results
- Handling duplicate results idempotently
- Converting single matcher to array syntax
- Validation error scenarios

## Migration Guide

See [migration-guide.md](./migration-guide.md) for step-by-step instructions on updating code from legacy ScriptComparisonSummary/HeaderComparisonSummary to ComparisonResultType[].
