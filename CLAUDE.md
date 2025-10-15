# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a PCI DSS compliance system implementing **requirements 6.4.3 (Script Management)** and **11.6.1 (Detection and Alerting)** to prevent page tampering and e-skimming attacks on payment pages. The system provides:

### PCI DSS Compliance Goals

- **6.4.3 Script Management**: Maintain authorized inventory of all payment page scripts with justification and integrity verification
- **11.6.1 Detection and Alerting**: Continuous monitoring and alerting for unauthorized script/header modifications

### System Components

- **Inventory Service**: Updates baseline inventory of approved scripts and headers, alerts on new discoveries
- **Detection Service**: Monitors live applications against inventory, alerts on violations without modifying inventory
- **Dual Workflows**: Each target has both inventory and detection URLs for comprehensive coverage
- **Git-based Storage**: Inventories stored in separate Git repository for audit trail and version control

### Monitored Resources

- **External scripts** loaded from remote URLs with hash verification
- **Inline scripts** dynamically added during page execution
- **Security-impacting HTTP headers** (CSP, security headers)
- **Puppeteer workflows** simulating real user payment flows

## Commands

### Development

- `npm run start` - Run the main detection process
- `npm run develop` - Build in watch mode for development
- `npm run build:js` - Build TypeScript to JavaScript

### Testing

- `npm run test:unit` - Run unit tests
- `npm run test:integration` - Run integration tests in Docker
- `npm run test:integration:watch` - Watch integration tests
- `npm run test:smoke` - Run smoke tests in Docker

### Code Quality

- `npm run check:formatting` - Check code formatting with Prettier
- `npm run fix:formatting` - Auto-fix formatting issues
- `npm run check:linting` - Run ESLint checks
- `npm run fix:linting` - Auto-fix linting issues
- `npm run check:typing` - Run TypeScript type checking

### Setup

- `npm run setup` - Initialize project with Husky hooks
- `npm run secrets:pull` - Pull environment secrets (requires dotenv-tools)

### Local Testing with GitHub Actions

```bash
# Requires .env.secrets file with INVENTORY_REPO_PAT and NPMRC_RO_FILE
act push --container-architecture linux/amd64 --secret-file .env.secrets
```

## Architecture

### Core Services

1. **DetectionService** (`src/services/detection.ts`) - Main orchestrator that:
   - Launches Puppeteer browser sessions
   - Executes workflow steps defined in `src/workflows/`
   - Captures scripts and headers during page navigation
   - Returns detection summaries for comparison

2. **ComparisonServices** - Compare detected resources against inventory:
   - `ScriptComparisonService` (`src/services/comparison/script.ts`)
   - `HeaderComparisonService` (`src/services/comparison/header.ts`)

3. **InventoryService** (`src/services/inventory.ts`) - Manages resource inventories stored in Git

4. **AlertService** (`src/services/alert/slack.ts`) - Sends Slack notifications for detected changes

### Data Flow

1. **Inventory Workflow**:
   - Executes against staging/inventory targets
   - Updates baseline inventory with newly discovered scripts
   - Alerts on unidentified scripts (requires manual authorization)
   - Pushes changes to Git repository

2. **Detection Workflow**:
   - Executes against production/detection targets
   - Compares findings against existing inventory (read-only)
   - Alerts on uninventoried or hash-mismatched scripts
   - No inventory modifications

3. **Alert Categories**:
   - `new_inventory_script_identified`: New script found during inventory (needs authorization)
   - `uninventoried_script_detected`: Unknown script found during detection
   - `mismatched_script_detected`: Known script with changed hash (potential tampering)

### Key Types

- **Target** (`src/types/target.ts`) - Defines URLs and workflows for monitoring
- **ScriptInfo** (`src/types/script.ts`) - Represents detected scripts with hash validation
- **DetectionSummary** (`src/types/detection.ts`) - Results from a detection run
- **Inventory** (`src/types/inventory/`) - Zod-validated inventory structures with:
  - `scripts[]`: Array of authorized scripts with hash history and justification
  - `headers{}`: Key-value map of expected security headers
  - `alerts{}`: Configuration for different violation alert destinations
  - `target`: Dual URLs for inventory and detection workflows

### Workflows

Workflows are defined as step-by-step instructions for Puppeteer in `src/workflows/`:

- Each step includes element selectors and actions (click, input, navigate)
- Steps are converted to PuppeteerLocatorActions for execution
- Support for popup handling and complex user flows

### Module Organization

- `src/handlers/` - Response handlers for scripts and headers
- `src/interfaces/` - TypeScript interfaces for services
- `src/repositories/` - Data access layer for inventories
- `src/stores/` - Storage implementations (Git, in-memory)
- `src/utils/` - Utility functions for hashing, parsing, and workflow conversion

## Environment Requirements

- Node.js >= 22
- NPM >= 10 (Yarn/PNPM not supported)
- Chrome dependencies for Puppeteer (see GitHub Actions workflow)

## Required Environment Variables

- `INVENTORY_REPO_PAT` - GitHub Personal Access Token for script-inventory repository access
- Slack webhook URLs for alerting (configured in SlackAlertService)

## Scheduled Execution

The system runs on CRON schedules:

- **Daily execution** at 12:00 PM UTC via GitHub Actions
- **Inventory workflow** runs first to update baselines
- **Detection workflow** follows to monitor against updated inventory
- Consider staggering schedules to avoid stale inventory data during detection

## Build System

Uses `@mr-yum/node-builder` for:

- TypeScript compilation
- ESLint configuration (extends `.node-builder/eslint-config.cjs`)
- Prettier configuration
- Jest testing setup

Configuration files extend from `.node-builder/` with project-specific overrides in `eslint.config.js`.
