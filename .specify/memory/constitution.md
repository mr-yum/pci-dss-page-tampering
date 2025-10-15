<!--
Sync Impact Report:
- Version change: None → 1.0.0
- New constitution created from template
- Principles defined: 6 core principles aligned with PCI DSS compliance requirements
- Added sections: PCI DSS Compliance Requirements, Development Workflow
- Templates requiring updates:
  ✅ plan-template.md - Constitution Check section present, ready for use
  ✅ spec-template.md - Aligned with user scenario testing requirements
  ✅ tasks-template.md - Testing discipline and parallel execution support present
- Follow-up TODOs: None
-->

# PCI DSS Page Tampering Detection Constitution

## Core Principles

### I. Security-First Development (NON-NEGOTIABLE)

All code changes MUST maintain or enhance security posture. This system protects payment card data from e-skimming attacks, making security the highest priority above all other concerns including performance, convenience, or feature velocity.

**Rationale**: PCI DSS requirements 6.4.3 and 11.6.1 are legally mandated compliance requirements. Any security regression could expose payment card data to theft, resulting in regulatory violations, financial penalties, and customer harm.

**Requirements**:

- No code may bypass, disable, or weaken script hash verification
- No code may reduce alert coverage or sensitivity without explicit security review
- All inventory modifications must maintain full audit trail in Git
- Detection workflow MUST remain read-only (no inventory mutations)
- Cryptographic hashing (SHA-256 or stronger) required for all script integrity checks

### II. Dual-Workflow Integrity

The system MUST maintain strict separation between inventory updates (staging/baseline) and detection (production monitoring). Inventory workflow may modify baselines; detection workflow MUST be read-only.

**Rationale**: Mixing these workflows could allow compromised production scripts to auto-authorize themselves into the inventory, defeating the entire security control.

**Requirements**:

- Each target MUST define both `inventoryUrl` and `detectionUrl`
- `InventoryService` may push Git commits only when processing inventory targets
- `DetectionService` MUST never modify inventories, only compare and alert
- Alert categories MUST distinguish inventory discoveries from detection violations
- Scheduled jobs MUST execute inventory before detection to avoid stale baselines

### III. Git-Based Audit Trail

All inventory changes MUST be committed to the Git repository with descriptive commit messages. The Git history serves as the compliance audit trail for PCI DSS requirement 6.4.3.

**Rationale**: PCI DSS auditors require proof that script authorization is tracked, reviewed, and justified over time. Git commits provide timestamped, immutable evidence.

**Requirements**:

- Every new script added to inventory MUST have a Git commit
- Commit messages MUST reference the alert or ticket that triggered the update
- No force-pushes to main/master branches (preserve history)
- Branch protection SHOULD require pull request reviews for inventory changes
- Inventory repository access MUST be restricted via `INVENTORY_REPO_PAT` environment variable

### IV. Alert Completeness and Routing

All security-relevant events MUST generate alerts to appropriate channels. Missing alerts create blind spots that attackers can exploit.

**Rationale**: PCI DSS 11.6.1 requires detection AND alerting. Detection without notification fails compliance.

**Requirements**:

- `new_inventory_script_identified`: New script found during inventory update
- `uninventoried_script_detected`: Unknown script found during detection
- `mismatched_script_detected`: Known script with changed hash (tampering indicator)
- Each inventory MAY configure custom alert destinations per violation type
- Alert failures MUST NOT block detection (log and continue)
- Alerts MUST include sufficient context (script URL, hash, target, workflow step)

### V. Test Coverage for Security Logic

All comparison logic, hash validation, and alert generation MUST be covered by automated tests. Manual testing cannot provide sufficient confidence for security controls.

**Rationale**: Bugs in comparison logic could cause false negatives (missed attacks) or false positives (alert fatigue leading to ignored real attacks).

**Requirements**:

- Unit tests MUST cover: ScriptComparisonService, HeaderComparisonService, hash utilities
- Integration tests MUST cover: Full workflows with mock Puppeteer responses
- Test scenarios MUST include: New scripts, hash mismatches, missing headers, malformed data
- Tests MUST verify correct alert categories are generated
- Refactoring MUST NOT reduce test coverage (use code coverage tools to verify)

### VI. Minimal Complexity

Introduce new abstractions, dependencies, or patterns ONLY when existing patterns are demonstrably insufficient. Complexity increases attack surface and maintenance burden.

**Rationale**: Security systems should be comprehensible to auditors and maintainers. Unnecessary abstraction layers hide bugs and make code reviews harder.

**Requirements**:

- Use Zod schemas for all inventory validation (already established pattern)
- Prefer functional utilities over class hierarchies unless state management required
- Document any non-obvious patterns (e.g., matcher comparison in script inventory)
- New dependencies MUST be justified (What problem? Why can't we solve it with existing tools?)
- YAGNI: Don't build extension points "for future flexibility" without concrete need

## PCI DSS Compliance Requirements

This section maps constitution principles to specific PCI DSS requirements.

### 6.4.3 Script Management

**Requirement**: All payment page scripts must be inventoried, authorized, and integrity-verified.

**Implementation**:

- Inventory stored in Git repository (Principle III)
- Each script has: URL, hash history, justification
- Hash verification on every detection run (Principle I)
- Dual workflow prevents auto-authorization (Principle II)

### 11.6.1 Detection and Alerting

**Requirement**: Automated mechanism to detect and alert on unauthorized changes to payment pages.

**Implementation**:

- DetectionService runs on schedule (daily at 12:00 PM UTC)
- Compares live page state against authorized inventory
- Generates categorized alerts (Principle IV)
- Monitors both scripts and security headers

## Development Workflow

### Code Quality Gates

All changes MUST pass before merge:

1. `npm run check:formatting` - Prettier formatting
2. `npm run check:linting` - ESLint rules
3. `npm run check:typing` - TypeScript type checking
4. `npm run test:unit` - Unit test suite
5. `npm run test:integration` - Integration tests (Dockerized)

### Refactoring Protocol

When refactoring comparison or detection logic:

1. Write tests that capture current behavior FIRST
2. Verify tests pass with current implementation
3. Refactor code
4. Verify tests still pass (no behavior change)
5. If behavior change is intentional, update tests AND document why in commit message

### Dependency Updates

- Security patches MUST be applied within 7 days of disclosure
- Major version bumps MUST be tested against staging targets before production
- Puppeteer updates REQUIRE smoke tests (browser API changes frequently)
- Avoid dependency bloat: prefer standard library or lightweight utilities

### Secrets Management

- `INVENTORY_REPO_PAT` stored in environment, never in code
- `.env.secrets` file MUST be in `.gitignore` (verify on setup)
- Slack tokens and webhooks configured via environment or secure secrets manager
- No credentials in logs or error messages

## Governance

This constitution supersedes all conflicting practices, patterns, or conveniences. When in doubt, prioritize security and compliance over convenience.

**Amendment Procedure**:

1. Propose change via pull request to `constitution.md`
2. Document rationale: What problem? Why can't existing rules address it?
3. Identify affected code and update plan (migration tasks if needed)
4. Increment version per semantic versioning rules (see below)
5. Update dependent templates (plan-template.md, spec-template.md, tasks-template.md)
6. Require approval from security/compliance stakeholder (not just development team)

**Versioning Policy**:

- **MAJOR**: Principle removed, redefined, or backward-incompatible governance change
- **MINOR**: New principle added, section expanded, new requirement introduced
- **PATCH**: Clarifications, typo fixes, non-semantic wording improvements

**Compliance Review**:

- All PRs MUST include constitution compliance check in description
- Reviewer MUST verify: "Does this change maintain dual-workflow integrity? Preserve audit trail? Maintain alert coverage?"
- Complexity violations MUST be explicitly justified (document in PR or refactor to comply)
- Use CLAUDE.md for agent-specific runtime development guidance

**Version**: 1.0.0 | **Ratified**: 2025-10-15 | **Last Amended**: 2025-10-15
