import puppeteer, { type Browser } from 'puppeteer'
import simpleGit from 'simple-git'
import { ZodError } from 'zod'

import { buildConfiguration } from './cli/config.js'
import { displayHelp } from './cli/help.js'
import { parseArguments } from './cli/parser.js'
import type { IAlertService } from './interfaces/alert'
import { ScriptInventoryRepository } from './repositories/inventory'
import { ConsoleAlertService } from './services/alert/console'
import { SlackAlertService } from './services/alert/slack'
import { HeaderComparisonService } from './services/comparison/header'
import { ScriptComparisonService } from './services/comparison/script'
import { DetectionService } from './services/detection'
import { ScriptInventoryService } from './services/inventory'
import { ensureInventoryPullRequest } from './services/inventory-pr-coordinator'
import { PullRequestService } from './services/pull-request'
import { GitInventoryStore } from './stores/inventory/git'
import { CliArgsSchema, ExitCode } from './types/cli.js'
import type { ComparisonResultType } from './types/comparison'
import { ExecutionMode, type RuntimeConfiguration } from './types/config.js'
import type { ExecutionSummary } from './types/execution-summary'
import type { Inventory, InventoryAlert, InventoryDifferenceResult } from './types/inventory/model'
import { PullTarget, type Target } from './types/target'
import { getScriptContentMatchersFromInventory } from './utils/script/matcher'

/**
 * Main entry point for PCI DSS Page Tampering Detection system
 * T014-T024: Command-line driven execution with mode selection and target filtering
 */
async function main() {
  try {
    // T015: Parse CLI arguments
    const rawArgs = parseArguments(process.argv)

    // T016: Handle --help flag early
    if (rawArgs.help) {
      displayHelp()
      process.exit(ExitCode.Success)
    }

    // T023: Validate CLI arguments with Zod (throws ZodError for missing/invalid params)
    const cliArgs = CliArgsSchema.parse(rawArgs)

    // T014: Build runtime configuration from validated arguments
    const config = buildConfiguration(cliArgs)

    // T052: Log configuration at startup (redact sensitive tokens)
    logConfiguration(config)

    // Execute workflows based on configuration
    await executeWorkflows(config)

    // T019: Exit with success code
    process.exit(ExitCode.Success)
  } catch (error) {
    // T023: Handle validation errors (missing/invalid parameters)
    if (error instanceof ZodError) {
      console.error('[Main]: Invalid CLI arguments')
      console.error()
      for (const issue of error.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`)
      }
      console.error()
      console.error('Run "npm start -- --help" for usage information')
      process.exit(ExitCode.ValidationError)
    }

    // T048, T049, T050: Handle execution errors with comprehensive messages
    const errorMessage = error instanceof Error ? error.message : String(error)
    const enhancedError = getEnhancedErrorMessage(errorMessage)

    console.error('[Main]: Application execution failed')
    console.error(`[Main]: ${enhancedError.category}: ${enhancedError.message}`)
    if (enhancedError.suggestion) {
      console.error(`[Main]: Suggestion: ${enhancedError.suggestion}`)
    }
    if (error instanceof Error && error.stack) {
      console.error(`[Main]: Stack trace:`, error.stack)
    }
    process.exit(ExitCode.ExecutionError)
  }
}

/**
 * Execute workflows based on runtime configuration
 * T017, T018, T021, T022: Implements mode-based workflow execution with target filtering
 * T009-T011: Sends success notification after workflow completion
 * T020-T021: Tracks execution start time and calculates duration for incident response context
 */
async function executeWorkflows(config: RuntimeConfiguration): Promise<void> {
  // T020: Track execution start time for calculating execution duration
  const executionStartTime = Date.now()

  // Initialize services with configuration (T020: Use config, not hardcoded URL)
  const gitInventoryStore = new GitInventoryStore({
    gitClient: simpleGit(),
    repositoryTarget: config.authentication.repositoryTarget,
    gitUserName: config.authentication.gitUserName,
    gitUserEmail: config.authentication.gitUserEmail,
  })
  const scriptInventoryRepository = new ScriptInventoryRepository({ inventoryStore: gitInventoryStore })
  const scriptInventoryService = new ScriptInventoryService({ inventoryRepository: scriptInventoryRepository })
  const detectionService = new DetectionService()
  const scriptComparisonService = new ScriptComparisonService()
  const headerComparisonService = new HeaderComparisonService()

  // T042: Initialize alert service based on configuration
  // Use ConsoleAlertService for local development/testing when --slack-token is omitted
  const alertService: IAlertService = config.alerting.slackToken ? new SlackAlertService(config.alerting.slackToken, config.repository.url, config.branches.inventory) : new ConsoleAlertService()

  const pullRequestService = new PullRequestService()

  const log = (message: string): void => {
    console.log(`[Main]: ${message}`)
  }

  // T009: Track execution context for success notification
  let totalResourceCount = 0
  const processedTargets: string[] = []
  let alertDestinations: InventoryAlert | null = null

  type PendingAlerts = { scriptComparisonResults: ComparisonResultType[]; headerComparisonResults: ComparisonResultType[]; target: Target; alertDestinations: InventoryAlert }
  type TargetRunResult = { diffResult: InventoryDifferenceResult | null; resourceCount: number; pendingAlerts: PendingAlerts | null }

  // Helper function to run workflow for a single target.
  // For detection targets, alerts are sent immediately (no PR exists). For
  // inventory targets, alerts are deferred so the caller can flush them after
  // the auto-PR is opened — letting the "Review changes" Slack button point at
  // the actual PR rather than the GitHub "create PR" page.
  const runForTargetAsync = async (browser: Browser, payload: Inventory, target: Target): Promise<TargetRunResult> => {
    try {
      console.log(`[Main]: Starting processing for target: ${target.url}`)

      // Get content matchers for in-script detection
      const scriptMatchers = getScriptContentMatchersFromInventory(payload)

      // Prepare to run resource detection
      const detectResourcesForTarget = detectionService.detect(browser, target, scriptMatchers)

      // Run resource detection
      const detectionSummaryForTarget = await detectResourcesForTarget

      // Run script comparison with inventory (returns typed results)
      const scriptComparisonResults = await scriptComparisonService.compare(detectionSummaryForTarget.target, payload, detectionSummaryForTarget.scriptSummary)

      // Run header comparison with inventory (returns typed results)
      const headerComparisonResults = await headerComparisonService.compare(detectionSummaryForTarget.target, payload, detectionSummaryForTarget.headerSummary)

      // T009: Calculate resource count for this target (scripts + headers)
      const resourceCount = scriptComparisonResults.length + headerComparisonResults.length

      if (target.type === 'inventory') {
        // Defer alerting; main flow will flush after PR creation.
        const allComparisonResults: ComparisonResultType[] = [...scriptComparisonResults, ...headerComparisonResults]
        const diffResult = await scriptInventoryService.diff(payload, allComparisonResults)
        return {
          diffResult,
          resourceCount,
          pendingAlerts: { scriptComparisonResults, headerComparisonResults, target, alertDestinations: payload.alerts },
        }
      } else {
        // Detection mode: no PR is ever created here, alert immediately.
        await alertService.alertForTypedResults(scriptComparisonResults, target, payload.alerts)
        await alertService.alertForTypedResults(headerComparisonResults, target, payload.alerts)
        return { diffResult: null, resourceCount, pendingAlerts: null }
      }
    } catch (error) {
      console.error(`[Main]: Error processing target: ${target.url}`)
      if (error instanceof Error) {
        console.error(`[Main]: Error name: ${error.name}`)
        console.error(`[Main]: Error message: ${error.message}`)
        console.error(`[Main]: Stack trace:`, error.stack)
      } else {
        console.error(`[Main]: Error: ${error}`)
      }
      throw error // Re-throw to maintain error propagation
    }
  }

  const flushPendingAlerts = async (pending: PendingAlerts): Promise<void> => {
    await alertService.alertForTypedResults(pending.scriptComparisonResults, pending.target, pending.alertDestinations)
    await alertService.alertForTypedResults(pending.headerComparisonResults, pending.target, pending.alertDestinations)
  }

  // Validate mode: fully deserialize inventory via the existing pipeline and exit.
  // No browser launch, no workflow execution, no alerting, no push.
  if (config.executionMode === ExecutionMode.Validate) {
    log('Preparing to validate inventory.')
    const inventory = await scriptInventoryService.pull(PullTarget.Inventory, config.branches.inventory)
    const fileList = inventory.map((i) => i.fileName).join(', ')
    log(`Successfully validated ${inventory.length} inventory file(s): ${fileList}`)
    return
  }

  // Launch browser for executing Puppeteer workflows
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    // T017, T021, T022: Execute workflows based on mode
    if (config.executionMode === ExecutionMode.Inventory || config.executionMode === ExecutionMode.All) {
      // Run inventory workflow
      log('Preparing to pull inventory.')
      const inventory = await scriptInventoryService.pull(PullTarget.Inventory, config.branches.inventory)

      // T018, T024: Filter to specific target if requested
      const filteredInventory = filterInventoryByTarget(inventory, config.targetFilter.targetName)

      // T011: Store alert destinations from first processed inventory
      if (filteredInventory.length > 0 && alertDestinations === null) {
        alertDestinations = filteredInventory[0]!.alerts
      }

      log('Preparing to run inventory workflow.')
      const targetRunResults = await Promise.all(
        filteredInventory.map(async (inventory) => {
          const result = await runForTargetAsync(browser, inventory, inventory.target.inventory)
          // T009: Track resource count and target name
          totalResourceCount += result.resourceCount
          const targetName = inventory.fileName.replace(/\.json$/, '')
          if (!processedTargets.includes(targetName)) {
            processedTargets.push(targetName)
          }
          return result
        }),
      )

      // Push inventory
      log('Preparing to push inventory.')
      const inventoriesToPush = targetRunResults.map((result) => {
        if (result.diffResult === null) {
          throw new Error('Expected inventory diff result to exist, but received null!')
        }
        return result.diffResult
      })
      const pushResult = await scriptInventoryService.push(inventoriesToPush, config.branches.inventory)

      log('Inventory workflow completed successfully.')

      // Open a PR so the inventory repo's CI (`--mode validate`) runs and humans
      // can review the change. Skip conditions are handled inside the service
      // (file://, non-github host) or in the coordinator (same branch, gitToken).
      // We capture any error and re-throw after flushing alerts, so operators
      // still get notified about new scripts/headers even when PR creation fails.
      let prError: unknown = null
      if (pushResult.pushed) {
        try {
          const prUrl = await ensureInventoryPullRequest({
            pullRequestService,
            alertService,
            repository: config.repository,
            branches: config.branches,
            gitToken: config.authentication.gitToken,
            commitMessage: pushResult.commitMessage,
            alertDestinations,
            log,
          })
          if (prUrl !== null) {
            // Point the "Review changes" Slack button at the actual PR.
            alertService.setReviewUrl(prUrl)
          }
        } catch (error) {
          prError = error
        }
      }

      // Flush deferred inventory alerts now — review URL has been set when the
      // PR is in place, otherwise the alert service falls back to its default
      // branch-compare URL.
      for (const result of targetRunResults) {
        if (result.pendingAlerts) {
          await flushPendingAlerts(result.pendingAlerts)
        }
      }

      if (prError !== null) {
        throw prError
      }

      // T022: If mode is 'inventory', send success notification and stop here
      if (config.executionMode === ExecutionMode.Inventory) {
        await browser.close()

        // T010: Send success notification with try-catch error handling
        // T021: Pass execution start time for duration calculation
        await sendSuccessNotification(alertService, config, processedTargets, totalResourceCount, alertDestinations, executionStartTime, log)
        return
      }

      // T022: If mode is 'all' and inventory succeeded, continue to detection
      log('Continuing to detection workflow (mode: all)...')
    }

    // T017, T021: Run detection workflow for 'detection' or 'all' mode
    if (config.executionMode === ExecutionMode.Detection || config.executionMode === ExecutionMode.All) {
      // Pull inventory from detection branch
      log('Preparing to pull inventory for detection.')
      const detectionInventory = await scriptInventoryService.pull(PullTarget.Detection, config.branches.detection)

      // T018, T024: Filter to specific target if requested
      const filteredDetectionInventory = filterInventoryByTarget(detectionInventory, config.targetFilter.targetName)

      // T011: Store alert destinations from first processed inventory (if not already set)
      if (filteredDetectionInventory.length > 0 && alertDestinations === null) {
        alertDestinations = filteredDetectionInventory[0]!.alerts
      }

      // Run detection workflow
      log('Preparing to run detection workflow.')
      await Promise.all(
        filteredDetectionInventory.map(async (inventory) => {
          const result = await runForTargetAsync(browser, inventory, inventory.target.detection)
          // T009: Track resource count and target name
          totalResourceCount += result.resourceCount
          const targetName = inventory.fileName.replace(/\.json$/, '')
          if (!processedTargets.includes(targetName)) {
            processedTargets.push(targetName)
          }
        }),
      )

      log('Detection workflow completed successfully.')
    }
  } finally {
    // Always close browser
    await browser.close()
  }

  // T010: Send success notification with try-catch error handling (for detection and all modes)
  // T021: Pass execution start time for duration calculation
  await sendSuccessNotification(alertService, config, processedTargets, totalResourceCount, alertDestinations, executionStartTime, log)
}

/**
 * T009, T010, T011: Send success notification after workflow completion
 * T020, T021: Calculates execution duration from start time
 * Constructs ExecutionSummary and calls alertOnSuccess() with non-blocking error handling
 */
async function sendSuccessNotification(
  alertService: IAlertService,
  config: RuntimeConfiguration,
  processedTargets: string[],
  totalResourceCount: number,
  alertDestinations: InventoryAlert | null,
  executionStartTime: number,
  log: (message: string) => void,
): Promise<void> {
  // Skip if no targets were processed (should not happen, but fail-safe)
  if (processedTargets.length === 0) {
    log('No targets processed, skipping success notification.')
    return
  }

  // Skip if no alert destinations available (should not happen, but fail-safe)
  if (alertDestinations === null) {
    log('No alert destinations available, skipping success notification.')
    return
  }

  // T021: Calculate execution duration
  const executionDuration = Date.now() - executionStartTime

  // T009: Construct ExecutionSummary from config and execution results
  // T021: Include calculated execution duration
  const summary: ExecutionSummary = {
    mode: config.executionMode,
    targetsProcessed: processedTargets,
    repositoryUrl: config.repository.url,
    inventoryBranch: config.executionMode === ExecutionMode.Detection ? null : config.branches.inventory,
    detectionBranch: config.executionMode === ExecutionMode.Inventory ? null : config.branches.detection,
    resourceCount: totalResourceCount,
    completedAt: new Date(),
    executionDuration,
  }

  // T010: Call alertOnSuccess() with try-catch error handling (non-blocking per FR-009)
  try {
    await alertService.alertOnSuccess(summary, alertDestinations)
  } catch (error) {
    // Log error but don't fail workflow - success notification is informational only
    console.error('[Main]: Failed to send success notification:', error)
  }
}

/**
 * T018, T024: Filter inventory by target name if specified
 * Throws error if target not found in inventory
 */
function filterInventoryByTarget(inventory: Inventory[], targetName: string | null): Inventory[] {
  if (targetName === null) {
    // Process all targets
    return inventory
  }

  // Filter to specific target by matching the target name
  // Targets are named after their JSON files (e.g., "1.0" from "1.0.json")
  const filtered = inventory.filter((inv) => {
    // Match by inventory target name or filename (without .json)
    const nameFromFile = inv.fileName.replace(/\.json$/, '')
    return inv.target.inventory.name === targetName || inv.target.detection.name === targetName || nameFromFile === targetName
  })

  // T024: Throw error if target not found
  if (filtered.length === 0) {
    const availableTargets = inventory.map((inv) => inv.fileName.replace(/\.json$/, '')).join(', ')
    throw new Error(`Target '${targetName}' not found in inventory repository. Available targets: ${availableTargets}`)
  }

  return filtered
}

/**
 * T052: Log CLI configuration at startup
 * Redacts sensitive tokens to avoid exposing credentials in logs
 */
function logConfiguration(config: RuntimeConfiguration): void {
  const redactToken = (token: string | null): string => {
    if (!token) return '(not provided)'
    if (token.length <= 8) return '***'
    return `${token.substring(0, 4)}...${token.substring(token.length - 4)} (${token.length} chars)`
  }

  console.log('[Main]: Starting PCI DSS Page Tampering Detection')
  console.log('[Main]: Configuration:')
  console.log(`[Main]:   Mode: ${config.executionMode}`)
  console.log(`[Main]:   Target: ${config.targetFilter.targetName ?? 'all targets'}`)
  console.log(`[Main]:   Repository: ${config.repository.url}`)
  console.log(`[Main]:   Inventory Branch: ${config.branches.inventory}`)
  console.log(`[Main]:   Detection Branch: ${config.branches.detection}`)
  console.log(`[Main]:   Git Token: ${redactToken(config.authentication.gitToken)}`)
  console.log(`[Main]:   Alerting: ${config.alerting.mode}${config.alerting.mode === 'slack' ? ` (token: ${redactToken(config.alerting.slackToken)})` : ''}`)
  console.log('')
}

/**
 * T048, T049, T050: Enhanced error message helper
 * Classifies errors and provides helpful suggestions for common failure scenarios
 */
type EnhancedErrorInfo = {
  category: string
  message: string
  suggestion?: string
}

function getEnhancedErrorMessage(errorMessage: string): EnhancedErrorInfo {
  const lowerMessage = errorMessage.toLowerCase()

  // T048: Git authentication failures
  if (lowerMessage.includes('authentication') || lowerMessage.includes('401') || lowerMessage.includes('403') || lowerMessage.includes('could not read username') || lowerMessage.includes('invalid credentials')) {
    return {
      category: 'Git Authentication Error',
      message: errorMessage,
      suggestion: 'Verify that --git-token is a valid GitHub Personal Access Token with "repo" scope. For GitHub Actions, use ${{ secrets.GITHUB_TOKEN }} or a PAT.',
    }
  }

  // T048: Git permission errors
  if (lowerMessage.includes('permission denied') || lowerMessage.includes('access denied')) {
    return {
      category: 'Git Permission Error',
      message: errorMessage,
      suggestion: 'The provided token may not have sufficient permissions. Ensure the token has "repo" scope for private repositories or "public_repo" for public repositories.',
    }
  }

  // T049: Repository URL errors (malformed or not found)
  if (lowerMessage.includes('repository not found') || lowerMessage.includes('404') || lowerMessage.includes('could not find repository')) {
    return {
      category: 'Repository Not Found',
      message: errorMessage,
      suggestion: 'Verify that --repo points to a valid repository URL. Check for typos in the organization/repository name and ensure the repository exists.',
    }
  }

  // T049: Invalid URL format
  if (lowerMessage.includes('invalid url') || lowerMessage.includes('malformed') || lowerMessage.includes('unable to parse')) {
    return {
      category: 'Invalid Repository URL',
      message: errorMessage,
      suggestion: 'The --repo parameter must be a valid URL. Examples: https://github.com/org/repo or file:///path/to/local/repo',
    }
  }

  // T050: Branch name errors
  if (lowerMessage.includes('branch') && (lowerMessage.includes('not found') || lowerMessage.includes('does not exist') || lowerMessage.includes('invalid ref'))) {
    return {
      category: 'Invalid Branch Name',
      message: errorMessage,
      suggestion: 'The specified branch does not exist. Check --inventory-branch or --detection-branch values. Available defaults: "updates/scripts" for inventory, "main" for detection.',
    }
  }

  // T050: Git ref errors
  if (lowerMessage.includes('refname') || lowerMessage.includes('invalid reference')) {
    return {
      category: 'Invalid Git Reference',
      message: errorMessage,
      suggestion: 'Branch names must be valid Git references. Avoid special characters and ensure the branch exists in the repository.',
    }
  }

  // Network errors
  if (lowerMessage.includes('network') || lowerMessage.includes('econnrefused') || lowerMessage.includes('enotfound') || lowerMessage.includes('timeout') || lowerMessage.includes('etimedout')) {
    return {
      category: 'Network Error',
      message: errorMessage,
      suggestion: 'Unable to connect to the Git server. Check your network connection and verify the repository URL is accessible.',
    }
  }

  // Clone directory errors
  if (lowerMessage.includes('already exists') && lowerMessage.includes('clone')) {
    return {
      category: 'Clone Directory Exists',
      message: errorMessage,
      suggestion: 'The local clone directory already exists. This may be from a previous run. Delete the ./pulled_repo directory and retry.',
    }
  }

  // SSL/TLS errors
  if (lowerMessage.includes('ssl') || lowerMessage.includes('certificate')) {
    return {
      category: 'SSL/TLS Error',
      message: errorMessage,
      suggestion: 'There was an SSL certificate error. This may indicate a network proxy or certificate issue. Verify your network configuration.',
    }
  }

  // Default: return original error
  return {
    category: 'Execution Error',
    message: errorMessage,
  }
}

// Execute main function
// Error handling is done inside main() function (T019, T023)
void main()
