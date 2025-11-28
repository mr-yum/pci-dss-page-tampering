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
import { GitInventoryStore } from './stores/inventory/git'
import { CliArgsSchema, ExitCode } from './types/cli.js'
import type { ComparisonResultType } from './types/comparison'
import { ExecutionMode, type RuntimeConfiguration } from './types/config.js'
import type { Inventory, InventoryDifferenceResult } from './types/inventory/model'
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

    // T019: Handle execution errors (Git, network, workflow failures)
    console.error('[Main]: Application execution failed')
    if (error instanceof Error) {
      console.error(`[Main]: Error name: ${error.name}`)
      console.error(`[Main]: Error message: ${error.message}`)
      console.error(`[Main]: Stack trace:`, error.stack)
    } else {
      console.error(`[Main]: Error: ${error}`)
    }
    process.exit(ExitCode.ExecutionError)
  }
}

/**
 * Execute workflows based on runtime configuration
 * T017, T018, T021, T022: Implements mode-based workflow execution with target filtering
 */
async function executeWorkflows(config: RuntimeConfiguration): Promise<void> {
  // Initialize services with configuration (T020: Use config, not hardcoded URL)
  const gitInventoryStore = new GitInventoryStore({
    gitClient: simpleGit(),
    repositoryTarget: config.authentication.repositoryTarget,
  })
  const scriptInventoryRepository = new ScriptInventoryRepository({ inventoryStore: gitInventoryStore })
  const scriptInventoryService = new ScriptInventoryService({ inventoryRepository: scriptInventoryRepository })
  const detectionService = new DetectionService()
  const scriptComparisonService = new ScriptComparisonService()
  const headerComparisonService = new HeaderComparisonService()

  // T042: Initialize alert service based on configuration
  // Use ConsoleAlertService for local development/testing when --slack-token is omitted
  const alertService: IAlertService = config.alerting.slackToken ? new SlackAlertService(config.alerting.slackToken) : new ConsoleAlertService()

  const log = (message: string): void => {
    console.log(`[Main]: ${message}`)
  }

  // Helper function to run workflow for a single target
  const runForTargetAsync = async (browser: Browser, payload: Inventory, target: Target): Promise<InventoryDifferenceResult | null> => {
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

      // Alert for inventory and target using typed results
      await alertService.alertForTypedResults(scriptComparisonResults, target, payload.alerts)
      await alertService.alertForTypedResults(headerComparisonResults, target, payload.alerts)

      // Run inventory sanity check and return to push to inventory (only for inventory mode)
      if (target.type === 'inventory') {
        // Combine script and header comparison results for single-pass processing
        const allComparisonResults: ComparisonResultType[] = [...scriptComparisonResults, ...headerComparisonResults]

        return await scriptInventoryService.diff(payload, allComparisonResults)
      } else {
        return null
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

      log('Preparing to run inventory workflow.')
      const inventoryDiffResults = await Promise.all(
        filteredInventory.map(async (inventory) => {
          const inventoryResult = await runForTargetAsync(browser, inventory, inventory.target.inventory)
          return {
            inventoryResult: inventoryResult ?? (await Promise.reject('Expected inventory diff result to exist, but received null!')),
          }
        }),
      )

      // Push inventory
      log('Preparing to push inventory.')
      const inventoriesToPush = inventoryDiffResults.map((result) => result.inventoryResult!)
      await scriptInventoryService.push(inventoriesToPush, config.branches.inventory)

      log('Inventory workflow completed successfully.')

      // T022: If mode is 'inventory', stop here (don't run detection)
      if (config.executionMode === ExecutionMode.Inventory) {
        await browser.close()
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

      // Run detection workflow
      log('Preparing to run detection workflow.')
      await Promise.all(
        filteredDetectionInventory.map(async (inventory) => {
          await runForTargetAsync(browser, inventory, inventory.target.detection)
        }),
      )

      log('Detection workflow completed successfully.')
    }
  } finally {
    // Always close browser
    await browser.close()
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

// Execute main function
// Error handling is done inside main() function (T019, T023)
void main()
