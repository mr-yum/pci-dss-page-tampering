# Research: CLI Implementation Approach

**Feature**: Command-Line Driven Execution Model
**Date**: 2025-11-12
**Purpose**: Resolve technology choices for CLI parsing, configuration management, and execution orchestration

## Research Questions

From plan.md Technical Context "NEEDS CLARIFICATION" items:

1. CLI Parsing Library: Which approach for parsing command-line arguments?
2. Configuration Validation: How to validate CLI arguments before execution?
3. Help Text Format: How to structure and display `--help` output?
4. Branch Name Handling: How to pass runtime branch names to GitInventoryStore?
5. Exit Code Strategy: What exit codes for different failure scenarios?

## Decision 1: CLI Parsing Library

### Options Evaluated

**Option A: Native `process.argv` parsing**
- **Pros**: Zero dependencies (aligns with Principle VI: Minimal Complexity), full control, TypeScript native
- **Cons**: Manual parsing logic (~80 LOC), manual validation, manual help text generation
- **Example**:
  ```typescript
  const args = process.argv.slice(2)
  const mode = args.find(arg => arg.startsWith('--mode='))?.split('=')[1]
  ```

**Option B: `yargs` library**
- **Pros**: Feature-rich (validation, help generation, types), TypeScript support
- **Cons**: +1 dependency (139KB), more API surface than needed
- **Package**: `yargs` ^17.7.2

**Option C: `commander` library**
- **Pros**: Popular (used by many CLI tools), TypeScript support, help generation
- **Cons**: +1 dependency (88KB), opinionated command structure
- **Package**: `commander` ^11.1.0

**Option D: `minimist` library**
- **Pros**: Lightweight (10KB), simple API, TypeScript types available
- **Cons**: No built-in validation or help generation, +1 dependency
- **Package**: `minimist` ^1.2.8

### Decision: **Option A - Native `process.argv` parsing**

**Rationale**:
1. **Principle VI Compliance**: Zero additional dependencies, reduces attack surface
2. **Simplicity**: Only 8 parameters to parse, manual logic is straightforward
3. **Control**: Full control over error messages, validation logic, help format
4. **Existing Pattern**: Project already minimizes dependencies (only 4 production deps)
5. **TypeScript Integration**: Direct access to process.argv, no library learning curve

**Implementation Approach**:
- Parse `process.argv` into key-value map (handle `--key value` and `--key=value` formats)
- Use Zod schema for validation (existing pattern in codebase)
- Generate help text manually (meets plain text requirement, no fancy formatting needed)
- ~100 LOC for parser.ts (acceptable per plan.md scope estimate)

**Trade-offs Accepted**:
- Manual help text generation (~30 LOC)
- Manual validation logic (mitigated by Zod schemas)
- No automatic type inference from CLI (using explicit TypeScript types instead)

**Alternatives Considered**:
- `yargs`: Rejected due to dependency bloat, more features than needed
- `commander`: Rejected due to opinionated structure (command-based), we only need flags
- `minimist`: Rejected because even minimal dependency adds complexity without value

## Decision 2: Configuration Validation

### Options Evaluated

**Option A: Zod schemas (existing pattern)**
- **Pros**: Already used for inventory validation, TypeScript integration, comprehensive error messages
- **Cons**: None (established pattern)
- **Example**:
  ```typescript
  const CliArgsSchema = z.object({
    mode: z.enum(['inventory', 'detection', 'all']).default('all'),
    repo: z.string().url(),
    // ...
  })
  ```

**Option B: Manual validation**
- **Pros**: No schema dependency
- **Cons**: Verbose (~50 LOC), inconsistent with existing code, harder to maintain

**Option C: TypeScript-only types**
- **Pros**: Compile-time only, zero runtime overhead
- **Cons**: No runtime validation (fails silently on invalid input)

### Decision: **Option A - Zod schemas**

**Rationale**:
1. **Consistency**: Project uses Zod for inventory validation (types/inventory/zod.ts)
2. **Type Safety**: Single source of truth for types (infer TypeScript types from Zod schemas)
3. **Error Messages**: Zod provides detailed validation errors for user feedback
4. **Fail-Fast**: Invalid arguments detected before execution begins

**Implementation Approach**:
- Define `CliArgsSchema` in `src/types/cli.ts`
- Use `z.infer<typeof CliArgsSchema>` for TypeScript types
- Validate parsed arguments before building RuntimeConfiguration
- Return validation errors with helpful messages (which parameter failed, why)

**Validation Rules**:
- `mode`: Enum ['inventory', 'detection', 'all'], optional (default 'all')
- `target`: String, optional (default: process all targets)
- `repo`: String (URL format), required
- `gitToken`: String (non-empty), required
- `slackToken`: String, optional
- `inventoryBranch`: String, optional (default 'updates/scripts')
- `detectionBranch`: String, optional (default 'main')
- `help`: Boolean, optional (flag presence detection)

## Decision 3: Help Text Format

### Options Evaluated

**Option A: Plain text with manual formatting**
- **Pros**: Full control, no dependencies, meets spec requirement (plain text)
- **Cons**: Manual string building (~30 LOC)
- **Example**:
  ```
  Usage: npm start -- [OPTIONS]

  Options:
    --mode <value>      Execution mode (inventory|detection|all) [default: all]
    --repo <url>        Inventory repository URL (required)
    --help              Display this help message
  ```

**Option B: Library-generated help (yargs/commander)**
- **Pros**: Automatic generation from parameter definitions
- **Cons**: Requires dependency, less control over format

### Decision: **Option A - Plain text with manual formatting**

**Rationale**:
1. **Spec Compliance**: FR-019 requires help documentation, spec out-of-scope excludes colors/formatting
2. **Dependency Avoidance**: Aligns with Decision 1 (native parsing)
3. **Customization**: Can include examples, migration notes, link to documentation
4. **Simplicity**: ~30 LOC for help.ts module

**Help Text Structure**:
```
PCI DSS Page Tampering Detection - CLI

Usage: npm start -- [OPTIONS]

Required Parameters:
  --repo <url>              Inventory repository URL (HTTPS or file://)
  --git-token <token>       Git authentication token (required for HTTPS repos)

Optional Parameters:
  --mode <mode>             Execution mode: inventory|detection|all [default: all]
  --target <name>           Process specific target (e.g., "1.0") [default: all targets]
  --slack-token <token>     Slack authentication token (logs to console if omitted)
  --inventory-branch <name> Branch for inventory operations [default: updates/scripts]
  --detection-branch <name> Branch for detection operations [default: main]
  --help                    Display this help message and exit

Examples:
  # Run full workflow (inventory + detection) for all targets
  npm start -- --repo https://github.com/org/inventory --git-token $TOKEN

  # Run inventory only for specific target
  npm start -- --mode inventory --target 1.0 --repo https://github.com/org/inventory --git-token $TOKEN

  # Run detection with custom branch
  npm start -- --mode detection --detection-branch release/v2.0 --repo https://github.com/org/inventory --git-token $TOKEN

  # Local testing with file protocol
  npm start -- --repo file:///Users/dev/test-inventory --git-token dummy

Exit Codes:
  0 - Success
  1 - Invalid arguments or configuration error
  2 - Execution failure (Git, network, or workflow error)

Documentation: See specs/008-refactor-the-code/ for implementation details
```

**Implementation**:
- `src/cli/help.ts` exports `displayHelp(): void` function
- Called when `--help` flag detected or validation fails
- Output to stdout, exit with code 0 (help) or 1 (error)

## Decision 4: Branch Name Handling

### Options Evaluated

**Option A: Constructor parameter**
- **Pros**: Immutable branch names per GitInventoryStore instance
- **Cons**: Requires new instance per workflow in `--mode all`, breaks existing code
- **Example**:
  ```typescript
  const store = new GitInventoryStore({
    gitClient,
    repositoryTarget,
    branchName: 'updates/scripts'
  })
  ```

**Option B: Method parameter**
- **Pros**: Single instance can pull from different branches, minimal API change
- **Cons**: Mutable behavior (less type-safe)
- **Example**:
  ```typescript
  await store.pull(PullTarget.Inventory, 'updates/scripts')
  ```

**Option C: Separate branch configuration object**
- **Pros**: Explicit branch mapping (inventory → branch, detection → branch)
- **Cons**: Additional abstraction, more complex API
- **Example**:
  ```typescript
  const branchConfig = { inventory: 'updates/scripts', detection: 'main' }
  const store = new GitInventoryStore({ gitClient, repositoryTarget, branchConfig })
  ```

**Option D: Refactor constants module to accept runtime values**
- **Pros**: Minimal changes to GitInventoryStore, backwards compatible
- **Cons**: Global mutable state (bad practice), not thread-safe (not an issue for single-process CLI)
- **Example**:
  ```typescript
  // src/utils/constants.ts
  export let GIT_UPDATED_SCRIPTS_BRANCH_NAME = 'updates/scripts'
  export function setInventoryBranch(branch: string) { GIT_UPDATED_SCRIPTS_BRANCH_NAME = branch }
  ```

### Decision: **Option B - Method parameter**

**Rationale**:
1. **Minimal API Change**: GitInventoryStore.pull() already accepts `PullTarget`, add optional `branchName` parameter
2. **Single Instance**: `--mode all` can reuse store instance, just call pull() with different branches
3. **Backward Compatibility**: Optional parameter, defaults to current behavior if omitted
4. **Type Safety**: TypeScript enforces branch name is string, no global state

**Implementation Approach**:
```typescript
// src/stores/inventory/git.ts
async pull(target: PullTarget, branchName?: string): Promise<InventoryPullResult> {
  const branch = branchName ?? (target === PullTarget.Inventory
    ? 'updates/scripts'  // Default inventory branch
    : 'main')            // Default detection branch

  await this.switchBranch(this.repositoryGitClient, branch)
  // ... rest of existing logic
}

async push(inventory: Inventory[], branchName?: string): Promise<void> {
  const branch = branchName ?? 'updates/scripts'  // Default inventory branch
  // ... existing logic but push to specified branch
}
```

**Migration Impact**:
- Existing calls without `branchName` parameter: No change (defaults maintained)
- New calls with `branchName`: Explicit branch control
- `src/utils/constants.ts`: Remove GIT_UPDATED_SCRIPTS_BRANCH_NAME and GIT_DETECTION_SCRIPTS_BRANCH_NAME exports (no longer needed)

**Trade-offs Accepted**:
- Method signature grows (but optional parameter maintains backwards compatibility)
- Branch name passed per-call (but enables flexibility for `--mode all`)

**Alternatives Rejected**:
- Option A: Would require two GitInventoryStore instances for `--mode all`, wasteful
- Option C: Over-engineered for 2 branches, adds abstraction without benefit
- Option D: Global mutable state is anti-pattern, risks future bugs

## Decision 5: Exit Code Strategy

### Options Evaluated

**Option A: Simple (0 = success, 1 = failure)**
- **Pros**: Standard Unix convention, easy to understand
- **Cons**: No distinction between error types (validation vs. execution)

**Option B: Detailed (0/1/2/...)**
- **Pros**: CI/CD can distinguish validation errors from execution errors
- **Cons**: More complex, requires documentation

### Decision: **Option B - Detailed exit codes**

**Rationale**:
1. **CI/CD Integration**: FR-010 requires exit codes for CI/CD decision making
2. **Debugging**: Operators can distinguish "bad arguments" from "network failure"
3. **Standard Practice**: Many CLI tools use detailed exit codes (Git, Docker, npm)

**Exit Code Mapping**:
```typescript
enum ExitCode {
  Success = 0,              // All workflows completed successfully
  ValidationError = 1,      // Invalid CLI arguments or configuration
  ExecutionError = 2,       // Git, network, or workflow failure
  HelpDisplayed = 0,        // --help flag (success, no execution)
}
```

**Usage Examples**:
- Missing `--repo` parameter: Exit 1 (validation error)
- Invalid Git URL: Exit 1 (validation error)
- Git clone failure: Exit 2 (execution error)
- Unauthorized script detected: Exit 0 (success - alert sent, system working correctly)
- Inventory workflow fails during `--mode all`: Exit 2 (execution error, detection skipped)

**Implementation**:
```typescript
// src/main.ts
process.exit(ExitCode.Success)  // Or ExitCode.ValidationError, etc.
```

**Trade-offs Accepted**:
- More exit codes to document (mitigated by help text)
- CI/CD scripts need to understand 0/1/2 distinction (but provides better debugging)

## Implementation Summary

### Technology Stack (Final)

| Component              | Technology                   | Justification                                         |
| ---------------------- | ---------------------------- | ----------------------------------------------------- |
| CLI Parsing            | Native `process.argv`        | Zero dependencies, full control, simple for 8 params  |
| Validation             | Zod schemas                  | Existing pattern, type-safe, detailed errors          |
| Help Text              | Manual string formatting     | Full control, meets plain text requirement            |
| Branch Configuration   | Method parameter             | Minimal API change, single instance reuse             |
| Exit Codes             | 0 (success), 1 (validation), 2 (execution) | CI/CD integration, debugging clarity |

### Code Modules (New)

1. **src/cli/parser.ts** (~100 LOC):
   - `parseArguments(argv: string[]): RawCliArgs`
   - Handles `--key value` and `--key=value` formats
   - Returns raw parsed object (unvalidated)

2. **src/cli/config.ts** (~50 LOC):
   - `buildConfiguration(rawArgs: RawCliArgs): RuntimeConfiguration`
   - Validates with Zod schema
   - Applies defaults
   - Returns typed configuration object

3. **src/cli/help.ts** (~30 LOC):
   - `displayHelp(): void`
   - Outputs formatted help text to stdout
   - Called when `--help` flag present or validation fails

4. **src/types/cli.ts** (~40 LOC):
   - `CliArgsSchema`: Zod schema for validation
   - `CliArguments`: TypeScript type (inferred from schema)
   - `RawCliArgs`: Unvalidated parsed arguments
   - `ExitCode`: Enum for process.exit() codes

5. **src/types/config.ts** (~30 LOC):
   - `RuntimeConfiguration`: Validated config passed to services
   - `ExecutionMode`: Enum (inventory | detection | all)
   - `BranchConfiguration`: Inventory and detection branch names

### Code Modifications (Existing)

1. **src/main.ts**:
   - Accept `RuntimeConfiguration` parameter
   - Remove hardcoded repository URL
   - Remove environment variable reads
   - Add mode selection logic (inventory | detection | all)
   - Add exit code handling

2. **src/stores/inventory/git.ts**:
   - Add optional `branchName` parameter to `pull()` method
   - Add optional `branchName` parameter to `push()` method
   - Default to 'updates/scripts' (inventory) or 'main' (detection) if omitted

3. **src/utils/constants.ts**:
   - Remove `GIT_UPDATED_SCRIPTS_BRANCH_NAME` export
   - Remove `GIT_DETECTION_SCRIPTS_BRANCH_NAME` export
   - Keep other constants (GIT_CLONE_PATH, TARGET_PATH, etc.)

### Testing Strategy

**Unit Tests** (co-located with source):
- `src/cli/parser.test.ts`: Test argument parsing edge cases
- `src/cli/config.test.ts`: Test validation, defaults, error messages
- `src/stores/inventory/git.test.ts`: Test dynamic branch behavior

**Integration Tests** (test/integration/):
- `cli-modes.test.ts`: Test `--mode inventory/detection/all` execution
- `cli-branches.test.ts`: Test `--inventory-branch` and `--detection-branch` overrides
- `cli-validation.test.ts`: Test parameter validation and error messages
- `cli-help.test.ts`: Test `--help` output and exit code

### Performance Expectations

- CLI parsing: <1ms (8 parameters, simple string operations)
- Validation: <5ms (Zod schema validation)
- Single target execution: <30s (existing performance maintained)
- `--mode all` overhead: ~100ms (additional Git pull between workflows)

### Security Considerations

- **Git Token Exposure**: Passed via CLI argument (visible in process list) - acceptable for CI/CD, document risk for local use
- **Branch Name Injection**: Git library validates branch names, invalid refs cause Git error (fail-fast)
- **URL Validation**: Zod URL schema prevents most injection attacks, Git library validates final URL

**Mitigation**: Document in quickstart.md that sensitive tokens should use CI/CD secrets, not typed directly in terminal.

## Open Questions

None. All research questions resolved with actionable decisions.

## Next Steps

Proceed to Phase 1:
1. Generate data-model.md (define RuntimeConfiguration, CliArguments structures)
2. Generate contracts/cli-args.schema.json (Zod schema as JSON schema)
3. Generate quickstart.md (developer guide for CLI usage)
4. Update agent context with new technology decisions
