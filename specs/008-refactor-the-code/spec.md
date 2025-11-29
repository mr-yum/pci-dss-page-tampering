# Feature Specification: Command-Line Driven Execution Model

**Feature Branch**: `008-refactor-the-code`
**Created**: 2025-11-12
**Status**: Draft
**Input**: User description: "Refactor the code so that we can run based on different configuration repository, different stages (inventory/detection) and for different targets, independently based on command line parameters so that we can utilise the inventory stage as part of a build pipeline."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Build Pipeline Integration (Priority: P1)

A CI/CD pipeline needs to run the inventory stage for a specific target during deployment to validate that newly deployed scripts match the authorized inventory baseline before promoting to production. Additionally, scheduled monitoring jobs need to run both inventory and detection workflows sequentially.

**Why this priority**: This is the primary driver for the refactor - enabling inventory checks as part of automated deployment workflows and supporting full monitoring cycles for scheduled jobs.

**Independent Test**: Can be fully tested by running the CLI with inventory mode for a single target and verifying it updates only that target's inventory and returns appropriate exit codes for CI/CD decision-making.

**Acceptance Scenarios**:

1. **Given** a deployment pipeline for staging environment, **When** the pipeline runs `npm start -- --mode inventory --target 1.0 --repo https://github.com/org/custom-inventory --git-token $TOKEN`, **Then** the system executes only the inventory workflow for target 1.0 and exits with code 0 if successful
2. **Given** multiple targets exist in the inventory repository, **When** running with `--target 2.0` flag, **Then** only target 2.0 is processed and other targets are ignored
3. **Given** a user needs guidance, **When** running `npm start -- --help`, **Then** the system displays all available command-line parameters with descriptions and examples
4. **Given** the inventory stage completes, **When** unauthorized scripts are found, **Then** the process exits with non-zero code to fail the pipeline build
5. **Given** a feature branch deployment, **When** running with `--inventory-branch feature/new-scripts`, **Then** the system pulls and pushes inventory changes to that branch instead of the default
6. **Given** required parameters are missing, **When** running without `--repo`, **Then** the system displays an error message and exits with non-zero code
7. **Given** a scheduled monitoring job, **When** running with `--mode all --repo https://github.com/org/inventory --git-token $TOKEN`, **Then** the system executes inventory workflow first (updating baseline), then detection workflow (monitoring against updated baseline)
8. **Given** no mode is specified, **When** running with only `--repo` and `--git-token`, **Then** the system defaults to `--mode all` behavior

---

### User Story 2 - Selective Detection Monitoring (Priority: P2)

Operations teams need to run detection checks on specific production targets on-demand to investigate reported issues or verify compliance without processing all targets.

**Why this priority**: Enables targeted investigation and reduces execution time when monitoring specific applications, though less critical than P1 since scheduled full detection runs still work.

**Independent Test**: Can be tested by running `npm start -- --mode detection --target 1.0` and verifying only that target's detection workflow executes against its inventory baseline.

**Acceptance Scenarios**:

1. **Given** multiple production targets are configured, **When** running `npm start -- --mode detection --target 2.0`, **Then** only target 2.0's detection workflow executes
2. **Given** a detection run completes, **When** violations are found, **Then** alerts are sent but no inventory modifications occur
3. **Given** detection mode is specified, **When** the workflow completes successfully with no violations, **Then** the process exits with code 0
4. **Given** a custom detection baseline branch, **When** running with `--detection-branch release/v2.0`, **Then** the system pulls inventory from that branch for comparison

---

### User Story 3 - Local Development Testing (Priority: P3)

Developers need to test inventory and detection workflows locally against different repository configurations and specific targets without affecting production monitoring or requiring full environment setup.

**Why this priority**: Improves developer experience and enables faster iteration, but doesn't block production use cases.

**Independent Test**: Can be tested by running with `--repo file:///local/path/to/test-inventory --target test-target` and verifying local repository is used.

**Acceptance Scenarios**:

1. **Given** a local test inventory repository, **When** running with `--repo file:///Users/dev/test-inventory --git-token dummy`, **Then** the system uses the local repository path
2. **Given** a developer wants to test without Slack alerts, **When** running without `--slack-token`, **Then** the system logs alert content to console instead of sending to Slack
3. **Given** a developer is unfamiliar with the CLI, **When** running `npm start -- --help`, **Then** comprehensive documentation is displayed including parameter descriptions, default values, and usage examples

---

### Edge Cases

- What happens when an invalid target name is specified (target doesn't exist in inventory repository)?
- How does the system handle malformed repository URLs or Git authentication failures?
- How are multiple instances prevented from conflicting when running against the same Git repository?
- What happens when a non-existent branch is specified via `--inventory-branch` or `--detection-branch`?
- How does the system handle branch naming conflicts when custom branches are used?
- What happens when `--help` is combined with other parameters?
- What happens when required parameter `--repo` is omitted?
- What happens when `--git-token` is omitted but the repository requires authentication?
- What happens when `--mode all` is used with `--target` (should both workflows run for that target)?
- What happens if inventory workflow fails during `--mode all` (should detection still run)?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST accept an optional `--mode` parameter with values `inventory`, `detection`, or `all` (defaults to `all` if not specified)
- **FR-002**: System MUST accept an optional `--target` parameter to specify which target configuration to process (e.g., "1.0", "2.0")
- **FR-003**: System MUST require a `--repo` parameter to specify inventory repository URL (no hardcoded default, no environment variable fallback)
- **FR-004**: System MUST require a `--git-token` parameter for Git authentication when using HTTPS repositories (no environment variable fallback)
- **FR-005**: System MUST accept an optional `--slack-token` parameter for Slack authentication (if omitted, logs alerts to console instead)
- **FR-006**: System MUST accept an optional `--inventory-branch` parameter to specify which branch to use for inventory operations (defaults to "updates/scripts" if not specified)
- **FR-007**: System MUST accept an optional `--detection-branch` parameter to specify which branch to use for detection operations (defaults to "main" if not specified)
- **FR-008**: System MUST accept a `--help` parameter that displays comprehensive CLI documentation and exits with code 0
- **FR-009**: System MUST display help documentation when `--help` is provided, regardless of other parameters, and skip all other operations
- **FR-010**: System MUST exit with code 0 on successful execution and non-zero on failure for CI/CD integration
- **FR-011**: When `--mode inventory` is specified, system MUST execute only inventory workflow and push changes to the specified or default inventory branch
- **FR-012**: When `--mode detection` is specified, system MUST execute only detection workflow without modifying inventory, pulling baseline from specified or default detection branch
- **FR-013**: When `--mode all` is specified or `--mode` is omitted, system MUST execute inventory workflow first, then detection workflow sequentially
- **FR-014**: When `--mode all` is used, system MUST pull from inventory branch, update it, push changes, then pull from detection branch for monitoring
- **FR-015**: When `--target` is specified, system MUST process only that target and skip others (applies to all modes)
- **FR-016**: When `--target` is not specified, system MUST process all targets found in the repository
- **FR-017**: System MUST validate that specified target exists in inventory repository before executing workflows
- **FR-018**: System MUST NOT use environment variables for parameters controllable via command-line (repo, git-token, slack-token, inventory-branch, detection-branch, mode)
- **FR-019**: System MUST log clear error messages when required parameters are missing or invalid, and exit with non-zero code
- **FR-020**: System MUST support both HTTPS and file:// protocol URLs for `--repo` parameter to enable local testing
- **FR-021**: Help documentation MUST include parameter name, description, whether required/optional, default value (if any), and usage examples
- **FR-022**: When inventory workflow fails during `--mode all`, system MUST exit with non-zero code and NOT proceed to detection workflow

### Key Entities

- **CLI Arguments**: Command-line parameters including mode (optional, defaults to "all"), target (optional), repo (required), git-token (required for HTTPS), slack-token (optional), inventory-branch (optional), detection-branch (optional), help
- **Execution Context**: Runtime configuration combining CLI arguments and defaults (no environment variables for CLI-controllable parameters)
- **Target Filter**: Logic to select specific target(s) from inventory based on CLI input
- **Help Documentation**: Formatted text output describing all available parameters with examples
- **Workflow Sequence**: For `--mode all`, the ordered execution of inventory workflow followed by detection workflow

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Developers can run inventory stage for a single target in under 30 seconds (excluding network time)
- **SC-002**: CI/CD pipelines can integrate inventory checks with appropriate exit codes (0 for success, non-zero for failure)
- **SC-003**: System supports any Git repository URL enabling multiple teams to maintain separate inventories without vendor lock-in
- **SC-004**: Command-line execution reduces resource usage by 80% when processing single target compared to processing all targets
- **SC-005**: New users can understand all CLI options within 2 minutes by reading `--help` output
- **SC-006**: Developers can test locally against file-based repositories without requiring GitHub access
- **SC-007**: System has zero hardcoded organization-specific configuration (fully configurable via CLI)
- **SC-008**: Scheduled monitoring jobs can run complete workflow (inventory + detection) with `--mode all` or by omitting the mode parameter
- **SC-009**: System maintains backward compatibility behavior via `--mode all` default (inventory first, then detection)

## Assumptions

- Repository structure and JSON inventory format remain unchanged
- Existing services (DetectionService, InventoryService, ComparisonServices) do not require interface changes
- Single-target execution is safe (no cross-target dependencies requiring sequential processing)
- File protocol repositories follow same directory structure as GitHub repositories
- Puppeteer browser instance can be shared across multiple targets in same execution mode
- Puppeteer browser instance can be reused between inventory and detection workflows in `--mode all`
- Branch names follow Git naming conventions and don't contain special characters requiring escaping
- Inventory and detection branches can be the same branch if needed (system handles pull/push correctly)
- Current Git implementation for non-existent branches (creates from origin/main) is acceptable for custom branches
- Help text can be plain text output to console (no fancy formatting or colors required initially)
- Git token is always required for HTTPS repositories (no anonymous access assumed)
- For `--mode all`, it is acceptable to fail fast (exit on inventory failure without running detection)

## Dependencies

- Depends on existing GitInventoryStore supporting configurable repository URLs and branch names
- Depends on existing service layer (DetectionService, InventoryService) accepting individual targets
- Requires command-line argument parsing library or implementation (Node.js native `process.argv` parsing)
- Depends on removal of hardcoded repository URL from main.ts (currently references "mr-yum/script-inventory")
- Depends on removal of environment variable fallbacks (INVENTORY_REPO_PAT, SLACK_OAUTH_TOKEN, GIT_UPDATED_SCRIPTS_BRANCH_NAME, GIT_DETECTION_SCRIPTS_BRANCH_NAME) for CLI-controllable parameters

## Out of Scope

- Parallel execution of multiple targets (remains sequential within single process)
- Configuration file support (beyond command-line arguments)
- Interactive CLI with prompts (all parameters must be provided upfront)
- Persistent CLI configuration or profiles
- Auto-discovery of targets (must specify target explicitly or process all)
- Webhook-based triggering or API interface (remains CLI-only)
- Backward compatibility for environment variable configuration (breaking change acceptable)
- Colored or formatted help output (plain text is sufficient)
- Auto-completion or shell integration for CLI parameters
- Graceful recovery in `--mode all` (if inventory fails, detection is skipped - fail fast approach)
