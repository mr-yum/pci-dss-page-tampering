import { randomUUID } from 'crypto'
import puppeteer, { type Browser } from 'puppeteer'
import { simpleGit } from 'simple-git'
import { ZodError } from 'zod'

import { buildConfiguration } from './cli/config.js'
import { displayHelp } from './cli/help.js'
import { parseArguments } from './cli/parser.js'
import type { IAlertService } from './interfaces/alert.js'
import type { IReportCollector, ReportArtefactPaths } from './interfaces/report.js'
import { ScriptInventoryRepository } from './repositories/inventory.js'
import { createQueueSource } from './rum/drain.js'
import { runRumCompare } from './rum/run.js'
import { ConsoleAlertService } from './services/alert/console.js'
import { SlackAlertService } from './services/alert/slack.js'
import { HeaderComparisonService } from './services/comparison/header.js'
import { ScriptComparisonService } from './services/comparison/script.js'
import { DetectionService } from './services/detection.js'
import { ScriptInventoryService } from './services/inventory.js'
import { assertInventoryBranchReplacementSafe, prepareInventoryBranch } from './services/inventory-branch-coordinator.js'
import { ensureInventoryPullRequest } from './services/inventory-pr-coordinator.js'
import { PullRequestService } from './services/pull-request.js'
import { FileReportWriter, NoopReportCollector, ReportCollector, writeStepSummary } from './services/report/index.js'
import { GitInventoryStore } from './stores/inventory/git.js'
import { CliArgsSchema, ExitCode } from './types/cli.js'
import type { ComparisonResultType } from './types/comparison.js'
import { ExecutionMode, type RuntimeConfiguration } from './types/config.js'
import type { AuditorReportLocation, ExecutionSummary } from './types/execution-summary.js'
import { getInventoryWorkflows, type Inventory, type InventoryAlert, type InventoryDifferenceResult, type InventoryWorkflow } from './types/inventory/model.js'
import type { ReportPass } from './types/report.js'
import { PullTarget, type Target } from './types/target.js'
import { mapGroupsSequentially } from './utils/concurrency.js'
import { createLogger } from './utils/logger.js'
import { getScriptContentMatchersFromInventory } from './utils/script/matcher.js'
import { redactRepositoryTarget } from './utils/url.js'
import { collectTotpSeedRefs } from './utils/workflow.js'

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
  const log = (message: string): void => {
    console.log(`[Main]: ${message}`)
  }

  // Initialize services with configuration (T020: Use config, not hardcoded URL)
  const pullRequestService = new PullRequestService()
  const gitInventoryStore = new GitInventoryStore({
    gitClient: simpleGit(),
    repositoryTarget: config.authentication.repositoryTarget,
    gitUserName: config.authentication.gitUserName,
    gitUserEmail: config.authentication.gitUserEmail,
    verifyBranchReplacement: async (branchName) =>
      assertInventoryBranchReplacementSafe(
        {
          pullRequestService,
          repository: config.repository,
          branches: config.branches,
          gitToken: config.authentication.gitToken,
          log,
        },
        branchName,
      ),
  })
  const scriptInventoryRepository = new ScriptInventoryRepository({ inventoryStore: gitInventoryStore })
  const scriptInventoryService = new ScriptInventoryService({ inventoryRepository: scriptInventoryRepository })
  const detectionService = new DetectionService({ totpSeeds: config.totp.seeds })
  const scriptComparisonService = new ScriptComparisonService()
  const headerComparisonService = new HeaderComparisonService()

  // T042: Initialize alert service based on configuration
  // Use ConsoleAlertService for local development/testing when --slack-token is omitted
  const alertService: IAlertService = config.alerting.slackToken ? new SlackAlertService(config.alerting.slackToken, config.repository.url, config.branches.inventory) : new ConsoleAlertService()

  // Auditor report collection. A null object when --report-dir is absent, so
  // every call site below stays unconditional and the disabled path is
  // provably inert rather than a scattering of `if (collector)` checks.
  const reportDir = config.reporting.reportDir
  const reportCollector: IReportCollector = reportDir === null ? new NoopReportCollector() : new ReportCollector()
  const reportWriter = new FileReportWriter()
  const reportsWritten: { pass: ReportPass; paths: ReportArtefactPaths }[] = []
  // Ties the inventory and detection documents of one invocation together.
  const reportCorrelationId = randomUUID()

  // T009: Track execution context for success notification
  let totalResourceCount = 0
  const processedTargets: string[] = []
  let alertDestinations: InventoryAlert | null = null

  type PendingAlerts = {
    scriptComparisonResults: ComparisonResultType[]
    headerComparisonResults: ComparisonResultType[]
    target: Target
    alertDestinations: InventoryAlert
    /**
     * Comparison results that actually translated into an inventory mutation.
     * Surfaced to the alert layer so "Inventory updated" alerts only fire for
     * results the diff genuinely applied; results the diff intentionally
     * skipped (AndMatcher entries, non-hash/content authorisers, duplicates)
     * get a "manual review required" alert instead.
     */
    inventoryUpdatedResults: ReadonlySet<ComparisonResultType>
  }
  type TargetRunResult = { comparisonResults: ComparisonResultType[]; resourceCount: number; pendingAlerts: PendingAlerts | null }

  // Helper function to run workflow for a single target.
  // For detection targets, alerts are sent immediately (no PR exists). For
  // inventory targets, alerts are deferred so the caller can flush them after
  // the auto-PR is opened — letting the "Review changes" Slack button point at
  // the actual PR rather than the GitHub "create PR" page.
  const runForTargetAsync = async (browser: Browser, payload: Inventory, target: Target): Promise<TargetRunResult> => {
    try {
      console.log(`[Main]: Starting processing for target: ${target.url}`)

      // Fail fast, before any navigation, if the workflow references TOTP
      // seeds that were not supplied via --totp-seed.
      const missingSeedRefs = [...collectTotpSeedRefs(target.workflow.definition.steps)].filter((seedRef) => !config.totp.seeds.has(seedRef))
      if (missingSeedRefs.length > 0) {
        throw new Error(`Target '${target.url}' references TOTP seed(s) that were not provided: ${missingSeedRefs.join(', ')}. Pass them via --totp-seed <name>=<base32-seed>.`)
      }

      // Get content matchers for in-script detection
      const scriptMatchers = getScriptContentMatchersFromInventory(payload)

      // Prepare to run resource detection
      const detectResourcesForTarget = detectionService.detect(browser, target, scriptMatchers, payload.headers)

      // Run resource detection
      const detectionSummaryForTarget = await detectResourcesForTarget

      // Run script comparison with inventory (returns typed results)
      const scriptComparisonResults = await scriptComparisonService.compare(detectionSummaryForTarget.target, payload, detectionSummaryForTarget.scriptSummary)

      // Run header comparison with inventory (returns typed results)
      const headerComparisonResults = await headerComparisonService.compare(detectionSummaryForTarget.target, payload, detectionSummaryForTarget.headerSummary)

      // T009: Calculate resource count for this target (scripts + headers)
      const resourceCount = scriptComparisonResults.length + headerComparisonResults.length

      // Feed the auditor report here — before the inventory/detection branch —
      // so both passes are covered by one call site, and before any diff runs,
      // so the report records the baseline the comparison actually used.
      //
      // Isolated: this sits upstream of the detection alert calls below, so an
      // unhandled fault while building report rows would abort the target and
      // swallow its 11.6.1 tamper alerts. Evidence collection must never cost
      // us an alert.
      collectForReportSafely(() => reportCollector.recordTargetRun({ inventory: payload, target, comparisonResults: [...scriptComparisonResults, ...headerComparisonResults] }))

      if (target.type === 'inventory') {
        // Defer alerting; main flow will flush after PR creation.
        const allComparisonResults: ComparisonResultType[] = [...scriptComparisonResults, ...headerComparisonResults]
        return {
          comparisonResults: allComparisonResults,
          resourceCount,
          pendingAlerts: { scriptComparisonResults, headerComparisonResults, target, alertDestinations: payload.alerts, inventoryUpdatedResults: new Set() },
        }
      } else {
        // Detection mode: no PR is ever created here, alert immediately.
        await alertService.alertForTypedResults(scriptComparisonResults, target, payload.alerts)
        await alertService.alertForTypedResults(headerComparisonResults, target, payload.alerts)
        return { comparisonResults: [...scriptComparisonResults, ...headerComparisonResults], resourceCount, pendingAlerts: null }
      }
    } catch (error) {
      // Record the gap so a partially-failed run still produces evidence for
      // the targets that succeeded, with the failures named in the document.
      // Isolated too: a fault here would replace the real error with a
      // reporting one and hide why the target actually failed.
      collectForReportSafely(() => reportCollector.recordTargetFailure({ inventory: payload, target, error }))

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

  /**
   * Run a report-collection step without letting it break the run.
   *
   * The report is evidence *about* the run, never a participant in it. Alerting
   * on a tampered payment page is a hard compliance obligation; a defect in
   * report mapping must not be able to suppress it, so faults are logged loudly
   * and the run continues. The written report will simply be missing that data.
   */
  const collectForReportSafely = (collect: () => void): void => {
    try {
      collect()
    } catch (error) {
      console.error('[Main]: Failed to collect auditor report data (the run continues; the report may be incomplete):', error)
    }
  }

  /**
   * Build and write the report for one pass.
   *
   * Never throws. A disk error must not turn a healthy detection run red when
   * the finding already reached Slack, and on a failing run the real error must
   * not be masked by a reporting one. A missing artefact is surfaced at the CI
   * layer instead (`if-no-files-found: warn`).
   */
  const emitReportSafely = async (pass: ReportPass): Promise<void> => {
    if (reportDir === null) return

    try {
      const report = reportCollector.build(pass, {
        configuredMode: config.executionMode,
        targetFilter: config.targetFilter.targetName,
        correlationId: reportCorrelationId,
        inventoryRef: { branch: pass === 'inventory' ? config.branches.inventory : config.branches.detection, commitSha: null, commitIsoDate: null, repositoryUrl: redactRepositoryTarget(config.repository.url) },
        startedAt: new Date(executionStartTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - executionStartTime,
        ci: buildCiContext(),
      })

      if (report === null) return

      const paths = await reportWriter.write(report, reportDir, reportCollector.getInventoryFiles(pass))
      reportsWritten.push({ pass, paths })

      await reportWriter.writeIndex(reportDir, reportsWritten)
      await writeStepSummary(report, log)

      log(`Auditor report (${pass}): ${paths.htmlPath}`)
      log(`Auditor report (${pass}), machine-readable: ${paths.jsonPath}`)
    } catch (error) {
      console.error(`[Main]: Failed to write the ${pass} auditor report:`, error)
    }
  }

  /** Record which inventory revision a pass compared against. */
  const recordInventoryRef = (pass: ReportPass, branch: string): void => {
    const ref = scriptInventoryService.getLastPullRef()

    reportCollector.recordInventoryRef(pass, {
      branch: ref?.branch ?? branch,
      commitSha: ref?.commitSha ?? null,
      commitIsoDate: ref?.commitIsoDate ?? null,
      repositoryUrl: redactRepositoryTarget(config.repository.url),
    })
  }

  const flushPendingAlerts = async (pending: PendingAlerts): Promise<void> => {
    await alertService.alertForTypedResults(pending.scriptComparisonResults, pending.target, pending.alertDestinations, pending.inventoryUpdatedResults)
    await alertService.alertForTypedResults(pending.headerComparisonResults, pending.target, pending.alertDestinations, pending.inventoryUpdatedResults)
  }

  // Validate mode: fully deserialize inventory via the existing pipeline and exit.
  // No browser launch, no workflow execution, no alerting, no push.
  if (config.executionMode === ExecutionMode.Validate) {
    log('Preparing to validate inventory.')
    // Validate performs no comparisons, so there is nothing to report on.
    if (reportDir !== null) log('Note: --mode validate runs no workflows, so no auditor report is produced.')
    const inventory = await scriptInventoryService.pull(PullTarget.Inventory, config.branches.inventory)
    const fileList = inventory.map((i) => i.fileName).join(', ')
    log(`Successfully validated ${inventory.length} inventory file(s): ${fileList}`)
    return
  }

  // RUM compare mode: drain the novel-observations queue and route each
  // real-user observation against the inventory. No browser, no push — the
  // whole mode lives in src/rum/run.ts so the integration test can drive it
  // with the same entry point.
  if (config.executionMode === ExecutionMode.RumCompare) {
    // Guaranteed by CLI validation (--rum-queue-url is required with the mode);
    // guarded here so a future config regression fails loudly, not with an
    // undefined queue URL deep inside the drain.
    if (config.rum.queueUrl === null) {
      throw new Error('--mode rum-compare requires --rum-queue-url')
    }

    log('Preparing to run RUM comparison.')
    await runRumCompare({
      inventoryService: scriptInventoryService,
      scriptComparison: scriptComparisonService,
      alertService,
      queueSource: createQueueSource(config.rum.queueUrl),
      branches: { inventory: config.branches.inventory, detection: config.branches.detection },
      reportDir,
      log: createLogger('Main → RUM'),
      // Inventory-pass observations feed the candidate flow (US3); when a
      // candidate push lands, open the same PR --mode inventory would — its
      // skip conditions (file://, non-GitHub, same branch, no token) and its
      // failure semantics (throw → exit 2) live in the coordinator.
      ensurePullRequest: (commitMessage, alertDestinations) =>
        ensureInventoryPullRequest({
          pullRequestService,
          alertService,
          repository: config.repository,
          branches: config.branches,
          gitToken: config.authentication.gitToken,
          commitMessage,
          alertDestinations,
          log,
        }),
    })
    log('RUM comparison completed successfully.')
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
      // Emit the inventory report from a finally so evidence survives a target
      // failure, a push failure, or a failed PR creation.
      try {
        // Run inventory workflow
        log('Preparing to pull inventory.')
        const inventoryPullOptions = await prepareInventoryBranch({
          pullRequestService,
          repository: config.repository,
          branches: config.branches,
          gitToken: config.authentication.gitToken,
          log,
        })
        const inventory = await scriptInventoryService.pull(PullTarget.Inventory, config.branches.inventory, inventoryPullOptions)
        recordInventoryRef('inventory', config.branches.inventory)

        // T018, T024: Filter to specific target if requested
        const filteredInventory = filterInventoryByTarget(inventory, config.targetFilter.targetName)

        // T011: Store alert destinations from first processed inventory
        if (filteredInventory.length > 0 && alertDestinations === null) {
          alertDestinations = filteredInventory[0]!.alerts
        }

        log('Preparing to run inventory workflow.')
        // Variations in one inventory commonly exercise the same application
        // and payment backends. Run them serially to avoid one synthetic user
        // starving or rate-limiting another. Inventory files are also serial so
        // independent hosted-payment frames cannot starve the shared browser.
        const targetRunResults = await mapGroupsSequentially(
          filteredInventory,
          (inventory) => getWorkflowsForTargetFilter(inventory, config.targetFilter.targetName),
          async (inventory, workflow) => {
            const result = await runForTargetAsync(browser, inventory, workflow.inventory)
            totalResourceCount += result.resourceCount
            const targetName = workflow.inventory.name ?? `${inventory.fileName.replace(/\.json$/, '')}/${workflow.id}`
            if (!processedTargets.includes(targetName)) processedTargets.push(targetName)
            return result
          },
        )

        const diffResults = await Promise.all(
          filteredInventory.map(async (inventory, index) => {
            const workflowResults = targetRunResults[index] ?? []
            // One inventory is shared by every variation. Diff once against the complete
            // observation set so later workflow runs cannot overwrite earlier discoveries.
            const comparisonResults = workflowResults.flatMap((result) => result.comparisonResults)
            const diffResult = await scriptInventoryService.diff(inventory, comparisonResults)
            const inventoryUpdatedResults: ReadonlySet<ComparisonResultType> = new Set(diffResult.appliedResults ?? [])
            for (const result of workflowResults) {
              if (result.pendingAlerts) result.pendingAlerts.inventoryUpdatedResults = inventoryUpdatedResults
            }
            return { diffResult, workflowResults }
          }),
        )

        // Push inventory + open PR. Wrap in try/finally so that buffered
        // inventory alerts always get flushed — even if push() throws — so
        // operators don't lose findings on a failed inventory push.
        let prError: unknown = null
        try {
          log('Preparing to push inventory.')
          const inventoriesToPush: InventoryDifferenceResult[] = diffResults.map((result) => result.diffResult)
          const pushResult = await scriptInventoryService.push(inventoriesToPush, config.branches.inventory)

          log('Inventory workflow completed successfully.')

          // Open a PR so the inventory repo's CI (`--mode validate`) runs and humans
          // can review the change. Skip conditions are handled inside the service
          // (file://, non-github host) or in the coordinator (same branch, gitToken).
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
        } finally {
          // Flush deferred inventory alerts. When push+PR succeed, the override
          // URL is set so the "Review changes" button points to the PR; on a
          // failed push we fall back to the default branch-compare URL.
          for (const result of diffResults) {
            for (const workflowResult of result.workflowResults) {
              if (workflowResult.pendingAlerts) await flushPendingAlerts(workflowResult.pendingAlerts)
            }
          }
          // Clear the override so the detection phase (under --mode all) doesn't
          // inherit the inventory PR URL on its own review-link fallbacks.
          alertService.setReviewUrl(null)
        }

        if (prError !== null) {
          throw prError
        }

        // T022: If mode is 'inventory', send success notification and stop here
        if (config.executionMode === ExecutionMode.Inventory) {
          await emitReportSafely('inventory')
          await browser.close()

          // T010: Send success notification with try-catch error handling
          // T021: Pass execution start time for duration calculation
          await sendSuccessNotification(alertService, config, processedTargets, totalResourceCount, alertDestinations, executionStartTime, log, buildAuditorReportLocation(reportsWritten))
          return
        }

        // T022: If mode is 'all' and inventory succeeded, continue to detection
        log('Continuing to detection workflow (mode: all)...')
      } finally {
        // Skipped when --mode inventory already emitted above and returned.
        if (!reportsWritten.some((written) => written.pass === 'inventory')) await emitReportSafely('inventory')
      }
    }

    // T017, T021: Run detection workflow for 'detection' or 'all' mode
    if (config.executionMode === ExecutionMode.Detection || config.executionMode === ExecutionMode.All) {
      try {
        // Pull inventory from detection branch
        log('Preparing to pull inventory for detection.')
        const detectionInventory = await scriptInventoryService.pull(PullTarget.Detection, config.branches.detection)
        recordInventoryRef('detection', config.branches.detection)

        // T018, T024: Filter to specific target if requested
        const filteredDetectionInventory = filterInventoryByTarget(detectionInventory, config.targetFilter.targetName)

        // T011: Store alert destinations from first processed inventory (if not already set)
        if (filteredDetectionInventory.length > 0 && alertDestinations === null) {
          alertDestinations = filteredDetectionInventory[0]!.alerts
        }

        // Run detection workflow
        log('Preparing to run detection workflow.')
        await mapGroupsSequentially(
          filteredDetectionInventory,
          (inventory) => getWorkflowsForTargetFilter(inventory, config.targetFilter.targetName),
          async (inventory, workflow) => {
            const result = await runForTargetAsync(browser, inventory, workflow.detection)
            totalResourceCount += result.resourceCount
            const targetName = workflow.detection.name ?? `${inventory.fileName.replace(/\.json$/, '')}/${workflow.id}`
            if (!processedTargets.includes(targetName)) processedTargets.push(targetName)
            return result
          },
        )

        log('Detection workflow completed successfully.')
      } finally {
        await emitReportSafely('detection')
      }
    }
  } finally {
    // Always close browser
    await browser.close()
  }

  // T010: Send success notification with try-catch error handling (for detection and all modes)
  // T021: Pass execution start time for duration calculation
  await sendSuccessNotification(alertService, config, processedTargets, totalResourceCount, alertDestinations, executionStartTime, log, buildAuditorReportLocation(reportsWritten))
}

/**
 * T009, T010, T011: Send success notification after workflow completion
 * T020, T021: Calculates execution duration from start time
 * Constructs ExecutionSummary and calls alertOnSuccess() with non-blocking error handling
 */
/**
 * Identify the CI run that produced a report, so an assessor can trace the
 * artefact back to the job that generated it.
 *
 * Returns null outside GitHub Actions; these are the standard, non-secret
 * variables the runner always sets.
 */
function buildCiContext(): { provider: 'github-actions'; runId: string; runAttempt: string; workflow: string; repository: string; sha: string } | null {
  const runId = process.env['GITHUB_RUN_ID']

  if (runId === undefined || runId === '') return null

  return {
    provider: 'github-actions',
    runId,
    runAttempt: process.env['GITHUB_RUN_ATTEMPT'] ?? '1',
    workflow: process.env['GITHUB_WORKFLOW'] ?? '',
    repository: process.env['GITHUB_REPOSITORY'] ?? '',
    sha: process.env['GITHUB_SHA'] ?? '',
  }
}

/**
 * Where this run's auditor report can be found.
 *
 * Deliberately the run page rather than a direct artifact link: the artifact is
 * uploaded by a later workflow step, so it does not exist when this runs. The
 * run page lists it and also carries the job-summary digest.
 *
 * Returns null when no report was produced, so the notification stays silent
 * rather than linking somewhere empty.
 */
function buildAuditorReportLocation(written: readonly { paths: ReportArtefactPaths }[]): AuditorReportLocation | null {
  if (written.length === 0) return null

  const ci = buildCiContext()
  const server = process.env['GITHUB_SERVER_URL'] ?? 'https://github.com'
  const runUrl = ci === null || ci.repository === '' ? null : `${server}/${ci.repository}/actions/runs/${ci.runId}`

  return { runUrl, htmlPaths: written.map((entry) => entry.paths.htmlPath) }
}

async function sendSuccessNotification(
  alertService: IAlertService,
  config: RuntimeConfiguration,
  processedTargets: string[],
  totalResourceCount: number,
  alertDestinations: InventoryAlert | null,
  executionStartTime: number,
  log: (message: string) => void,
  auditorReport: AuditorReportLocation | null = null,
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
    auditorReport,
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
  const filtered = inventory.filter((inv) => getWorkflowsForTargetFilter(inv, targetName).length > 0)

  // T024: Throw error if target not found
  if (filtered.length === 0) {
    const availableTargets = inventory
      .flatMap((inv) => [
        inv.fileName.replace(/\.json$/, ''),
        ...getInventoryWorkflows(inv.target)
          .flatMap((workflow) => [workflow.inventory.name, workflow.detection.name])
          .filter((name): name is string => name !== undefined),
      ])
      .filter((name, index, names) => names.indexOf(name) === index)
      .join(', ')
    throw new Error(`Target '${targetName}' not found in inventory repository. Available targets: ${availableTargets}`)
  }

  return filtered
}

/** Select all workflows for a file-level target, or one named variation. */
function getWorkflowsForTargetFilter(inventory: Inventory, targetName: string | null): InventoryWorkflow[] {
  const workflows = getInventoryWorkflows(inventory.target)
  if (targetName === null || inventory.fileName.replace(/\.json$/, '') === targetName) return workflows
  return workflows.filter((workflow) => workflow.inventory.name === targetName || workflow.detection.name === targetName)
}

/**
 * T052: Log CLI configuration at startup
 * Redacts sensitive tokens to avoid exposing credentials in logs
 */
function logConfiguration(config: RuntimeConfiguration): void {
  const redactToken = (token: string | null): string => {
    if (!token) return '(not provided)'
    return '(redacted)'
  }

  console.log('[Main]: Starting PCI DSS Page Tampering Detection')
  console.log('[Main]: Configuration:')
  console.log(`[Main]:   Mode: ${config.executionMode}`)
  console.log(`[Main]:   Target: ${config.targetFilter.targetName ?? 'all targets'}`)
  console.log(`[Main]:   Repository: ${redactRepositoryTarget(config.repository.url)}`)
  console.log(`[Main]:   Inventory Branch: ${config.branches.inventory}`)
  console.log(`[Main]:   Detection Branch: ${config.branches.detection}`)
  console.log(`[Main]:   Git Token: ${redactToken(config.authentication.gitToken)}`)
  console.log(`[Main]:   Alerting: ${config.alerting.mode}${config.alerting.mode === 'slack' ? ` (token: ${redactToken(config.alerting.slackToken)})` : ''}`)
  // Log seed names only — the seed values are durable credentials.
  console.log(`[Main]:   TOTP Seeds: ${config.totp.seeds.size > 0 ? `${[...config.totp.seeds.keys()].join(', ')} (values redacted)` : '(none)'}`)
  if (config.rum.queueUrl !== null) {
    console.log(`[Main]:   RUM Queue: ${config.rum.queueUrl}`)
  }
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
