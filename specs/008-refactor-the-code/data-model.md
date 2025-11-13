# Data Model: CLI Configuration and Runtime Types

**Feature**: Command-Line Driven Execution Model
**Date**: 2025-11-12
**Purpose**: Define data structures for CLI parsing, validation, and runtime configuration

## Overview

This document defines the types and structures for the command-line interface refactor. The data flow is:

```
process.argv → RawCliArgs → [Validation] → CliArguments → RuntimeConfiguration → Services
```

## Entity Definitions

### 1. RawCliArgs

**Purpose**: Unvalidated, parsed command-line arguments (output of parser.ts)

**Location**: `src/types/cli.ts`

**Structure**:
```typescript
type RawCliArgs = {
  mode?: string;
  target?: string;
  repo?: string;
  gitToken?: string;
  slackToken?: string;
  inventoryBranch?: string;
  detectionBranch?: string;
  help?: boolean;
}
```

**Fields**:
- All fields optional (validation happens later)
- String values may be invalid (URLs, branch names not validated yet)
- Boolean `help` flag indicates `--help` presence

**Validation Rules**: None (raw parse output)

**Example**:
```typescript
const raw: RawCliArgs = {
  mode: 'inventory',
  repo: 'https://github.com/org/inventory',
  gitToken: 'ghp_abc123',
  target: '1.0',
}
```

### 2. CliArguments

**Purpose**: Validated, typed command-line arguments (output of Zod validation)

**Location**: `src/types/cli.ts`

**Zod Schema**:
```typescript
import { z } from 'zod';

export const CliArgsSchema = z.object({
  mode: z.enum(['inventory', 'detection', 'all']).default('all'),
  target: z.string().optional(),
  repo: z.string().url('Repository must be a valid URL'),
  gitToken: z.string().min(1, 'Git token is required for HTTPS repositories'),
  slackToken: z.string().optional(),
  inventoryBranch: z.string().default('updates/scripts'),
  detectionBranch: z.string().default('main'),
  help: z.boolean().default(false),
});

export type CliArguments = z.infer<typeof CliArgsSchema>;
```

**Fields**:
| Field             | Type                                | Required | Default            | Validation                      |
| ----------------- | ----------------------------------- | -------- | ------------------ | ------------------------------- |
| mode              | 'inventory' \| 'detection' \| 'all' | No       | 'all'              | Enum validation                 |
| target            | string \| undefined                 | No       | undefined (all targets) | None (validated against inventory later) |
| repo              | string                              | Yes      | -                  | Must be valid URL               |
| gitToken          | string                              | Yes      | -                  | Non-empty string                |
| slackToken        | string \| undefined                 | No       | undefined          | None                            |
| inventoryBranch   | string                              | No       | 'updates/scripts'  | None (Git validates on checkout) |
| detectionBranch   | string                              | No       | 'main'             | None (Git validates on checkout) |
| help              | boolean                             | No       | false              | Flag presence                   |

**Validation Rules**:
- `repo`: Must be valid URL (supports https:// and file:// protocols)
- `gitToken`: Non-empty string (required for authentication)
- `mode`: Must be one of three enum values
- `target`: No format validation (validated against inventory JSON files at runtime)
- Branch names: No format validation (Git will error on invalid refs, fail-fast)

**Error Messages**:
```typescript
// Example Zod validation error
{
  "issues": [
    {
      "path": ["repo"],
      "message": "Repository must be a valid URL",
      "received": "not-a-url"
    }
  ]
}
```

**Example**:
```typescript
const validated: CliArguments = {
  mode: 'inventory',
  target: '1.0',
  repo: 'https://github.com/org/inventory',
  gitToken: 'ghp_abc123xyz',
  slackToken: undefined,
  inventoryBranch: 'updates/scripts',
  detectionBranch: 'main',
  help: false,
}
```

### 3. RuntimeConfiguration

**Purpose**: Complete configuration object passed to services (includes derived values)

**Location**: `src/types/config.ts`

**Structure**:
```typescript
export type RuntimeConfiguration = {
  executionMode: ExecutionMode;
  targetFilter: TargetFilter;
  repository: RepositoryConfiguration;
  branches: BranchConfiguration;
  authentication: AuthenticationConfiguration;
  alerting: AlertingConfiguration;
}

export enum ExecutionMode {
  Inventory = 'inventory',
  Detection = 'detection',
  All = 'all',
}

export type TargetFilter = {
  targetName: string | null;  // null = process all targets
}

export type RepositoryConfiguration = {
  url: string;
  clonePath: string;  // Always './pulled_repo' (from constants)
}

export type BranchConfiguration = {
  inventory: string;
  detection: string;
}

export type AuthenticationConfiguration = {
  gitToken: string;
  repositoryTarget: string;  // Formatted as https://x-access-token:{token}@github.com/...
}

export type AlertingConfiguration = {
  slackToken: string | null;  // null = log to console
  mode: 'slack' | 'console';
}
```

**Fields**:

**ExecutionMode**:
- Enum representation of `--mode` parameter
- Used for workflow selection in main.ts

**TargetFilter**:
- `targetName`: null (process all) or specific target ID (e.g., "1.0")
- Determines filtering logic in main.ts

**RepositoryConfiguration**:
- `url`: User-provided repository URL
- `clonePath`: Hardcoded './pulled_repo' (from existing constants)

**BranchConfiguration**:
- `inventory`: Branch for inventory operations (push changes)
- `detection`: Branch for detection operations (read-only)
- Can be same branch (system pulls latest before each workflow)

**AuthenticationConfiguration**:
- `gitToken`: Raw token from CLI
- `repositoryTarget`: Formatted URL for simple-git (https://x-access-token:{token}@github.com/...)
- Handles both HTTPS (with token) and file:// (no authentication) protocols

**AlertingConfiguration**:
- `slackToken`: Token for Slack API (null if omitted)
- `mode`: Derived field ('slack' if token provided, 'console' otherwise)
- Used by SlackAlertService to decide log vs. send

**Derivation Logic**:
```typescript
function buildConfiguration(cliArgs: CliArguments): RuntimeConfiguration {
  return {
    executionMode: cliArgs.mode as ExecutionMode,
    targetFilter: {
      targetName: cliArgs.target ?? null,
    },
    repository: {
      url: cliArgs.repo,
      clonePath: './pulled_repo',  // From constants
    },
    branches: {
      inventory: cliArgs.inventoryBranch,
      detection: cliArgs.detectionBranch,
    },
    authentication: {
      gitToken: cliArgs.gitToken,
      repositoryTarget: formatRepositoryUrl(cliArgs.repo, cliArgs.gitToken),
    },
    alerting: {
      slackToken: cliArgs.slackToken ?? null,
      mode: cliArgs.slackToken ? 'slack' : 'console',
    },
  };
}

function formatRepositoryUrl(repo: string, token: string): string {
  if (repo.startsWith('file://')) {
    return repo;  // No authentication for local repos
  }

  // Replace https:// with https://x-access-token:{token}@
  const url = new URL(repo);
  url.username = 'x-access-token';
  url.password = token;
  return url.toString();
}
```

**Example**:
```typescript
const config: RuntimeConfiguration = {
  executionMode: ExecutionMode.Inventory,
  targetFilter: {
    targetName: '1.0',
  },
  repository: {
    url: 'https://github.com/org/inventory',
    clonePath: './pulled_repo',
  },
  branches: {
    inventory: 'updates/scripts',
    detection: 'main',
  },
  authentication: {
    gitToken: 'ghp_abc123xyz',
    repositoryTarget: 'https://x-access-token:ghp_abc123xyz@github.com/org/inventory',
  },
  alerting: {
    slackToken: null,
    mode: 'console',
  },
}
```

### 4. ExitCode

**Purpose**: Standardized exit codes for CI/CD integration

**Location**: `src/types/cli.ts`

**Structure**:
```typescript
export enum ExitCode {
  Success = 0,              // All workflows completed successfully
  ValidationError = 1,      // Invalid CLI arguments or configuration
  ExecutionError = 2,       // Git, network, or workflow failure
}
```

**Usage**:
```typescript
// In main.ts
try {
  const rawArgs = parseArguments(process.argv);
  const cliArgs = CliArgsSchema.parse(rawArgs);
  const config = buildConfiguration(cliArgs);

  await executeWorkflows(config);

  process.exit(ExitCode.Success);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Invalid arguments:', error.message);
    displayHelp();
    process.exit(ExitCode.ValidationError);
  } else {
    console.error('Execution failed:', error.message);
    process.exit(ExitCode.ExecutionError);
  }
}
```

## Data Flow Diagram

```
┌─────────────────┐
│  process.argv   │  ["--mode", "inventory", "--repo", "...", "--git-token", "..."]
└────────┬────────┘
         │
         │ parseArguments()
         ▼
┌─────────────────┐
│  RawCliArgs     │  { mode: "inventory", repo: "...", gitToken: "..." }
└────────┬────────┘
         │
         │ CliArgsSchema.parse()
         ▼
┌─────────────────┐
│  CliArguments   │  Validated + Defaults applied
└────────┬────────┘
         │
         │ buildConfiguration()
         ▼
┌─────────────────────────┐
│  RuntimeConfiguration   │  Complete config with derived fields
└────────┬────────────────┘
         │
         ├─────────────────┐
         │                 │
         ▼                 ▼
    GitInventoryStore  SlackAlertService
    (with branches)    (with token/console mode)
```

## Entity Relationships

```
CliArguments (1) ──builds──> (1) RuntimeConfiguration

RuntimeConfiguration (1) ──configures──> (1) GitInventoryStore
RuntimeConfiguration (1) ──configures──> (1) SlackAlertService
RuntimeConfiguration (1) ──determines──> (1) ExecutionMode

ExecutionMode (1) ──selects──> (*) Workflow
  - Inventory: InventoryService workflow
  - Detection: DetectionService workflow
  - All: Both workflows sequentially

BranchConfiguration (1) ──passed to──> (*) GitInventoryStore.pull()/push() calls
```

## State Transitions

### Execution Mode State Machine

```
┌─────────┐
│  Start  │
└────┬────┘
     │
     │ Parse & Validate CLI
     ▼
┌─────────────┐
│  --help?    │──Yes──> Display Help ──> Exit(0)
└────┬────────┘
     │ No
     │
     ▼
┌─────────────────────┐
│  mode = ?           │
└────┬────────────────┘
     │
     ├───inventory──> Execute Inventory ──> Push to Git ──> Exit(0/2)
     │
     ├───detection──> Execute Detection ──> Send Alerts ──> Exit(0/2)
     │
     └───all───> Execute Inventory ──┬──Success──> Execute Detection ──> Exit(0/2)
                                      │
                                      └──Failure──> Exit(2) [Skip Detection]
```

### Target Filtering State Machine

```
┌──────────────────────┐
│  RuntimeConfiguration │
└──────────┬───────────┘
           │
           │ Pull Inventory
           ▼
┌──────────────────────┐
│  All Targets Loaded  │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  targetFilter.name?  │
└──────────┬───────────┘
           │
           ├───null───────> Process All Targets
           │
           └───"1.0"──────> Filter to Target "1.0" ──┬──Found──> Process Target
                                                      │
                                                      └──Not Found──> Error Exit(1)
```

## Validation Rules Summary

| Entity          | Validation Point     | Rules                                                |
| --------------- | -------------------- | ---------------------------------------------------- |
| RawCliArgs      | None                 | Raw parse output, no validation                      |
| CliArguments    | Zod Schema           | URL format, non-empty strings, enum values           |
| RuntimeConfig   | buildConfiguration() | Derived fields (repositoryTarget format)             |
| Target Name     | Runtime (main.ts)    | Must exist in inventory JSON files                   |
| Branch Name     | Runtime (Git)        | Git library validates on checkout, fail-fast on error |
| Repository URL  | Zod + Git            | URL format (Zod), Git clone validates accessibility  |

## Error Handling

### Validation Errors (Exit Code 1)

```typescript
// Missing required parameter
Input: npm start --
Error: Repository URL is required (--repo)
Exit: 1

// Invalid URL format
Input: npm start -- --repo not-a-url --git-token abc
Error: Repository must be a valid URL
Exit: 1

// Invalid mode value
Input: npm start -- --mode invalid --repo ... --git-token ...
Error: mode must be one of: inventory, detection, all
Exit: 1
```

### Execution Errors (Exit Code 2)

```typescript
// Git authentication failure
Input: npm start -- --repo https://github.com/org/private --git-token wrong-token
Error: Git clone failed: authentication failed
Exit: 2

// Target not found in inventory
Input: npm start -- --target nonexistent --repo ... --git-token ...
Error: Target 'nonexistent' not found in inventory repository
Exit: 2

// Branch does not exist (Git error)
Input: npm start -- --inventory-branch nonexistent --repo ... --git-token ...
Error: Branch 'nonexistent' does not exist in repository
Exit: 2
```

## Type Guards

```typescript
// Type guard for checking if help was requested
export function isHelpRequested(args: CliArguments): boolean {
  return args.help === true;
}

// Type guard for checking if specific target requested
export function hasTargetFilter(config: RuntimeConfiguration): boolean {
  return config.targetFilter.targetName !== null;
}

// Type guard for checking alert mode
export function usesSlackAlerts(config: RuntimeConfiguration): boolean {
  return config.alerting.mode === 'slack';
}
```

## Immutability Guarantees

All configuration types are immutable (readonly):

```typescript
export type RuntimeConfiguration = Readonly<{
  executionMode: ExecutionMode;
  targetFilter: Readonly<TargetFilter>;
  repository: Readonly<RepositoryConfiguration>;
  branches: Readonly<BranchConfiguration>;
  authentication: Readonly<AuthenticationConfiguration>;
  alerting: Readonly<AlertingConfiguration>;
}>;
```

This prevents accidental mutation during execution and makes configuration behavior predictable.

## Testing Considerations

**Unit Test Coverage**:
- Parser: Test all CLI formats (--key value, --key=value, mixed)
- Validation: Test all Zod schema rules, error messages
- Config Builder: Test derived field logic (repositoryTarget formatting)
- Type Guards: Test boundary conditions (null, undefined, edge cases)

**Integration Test Coverage**:
- End-to-end: Parse → Validate → Build → Execute workflows
- Error paths: Invalid args → Help display → Exit code 1
- Mode selection: Test inventory/detection/all workflows
- Branch overrides: Test custom branch names work correctly

## Migration from Environment Variables

**Before** (main.ts with environment variables):
```typescript
const gitToken = process.env['INVENTORY_REPO_PAT'] ?? throw Error(...)
const slackToken = process.env['SLACK_OAUTH_TOKEN'] ?? throw Error(...)
const repositoryTarget = `https://x-access-token:${gitToken}@github.com/mr-yum/script-inventory.git`
```

**After** (main.ts with RuntimeConfiguration):
```typescript
const config = await parseAndValidateCLI(process.argv);
// config.authentication.repositoryTarget already formatted
// config.alerting.slackToken is null or string
```

**Benefits**:
- No hardcoded repository URL (vendor-neutral)
- No environment variable reads (explicit configuration)
- Type-safe configuration (TypeScript + Zod)
- Testable without environment setup
