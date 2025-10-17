import puppeteer, { type Browser } from 'puppeteer'
import simpleGit from 'simple-git'

import { ScriptInventoryRepository } from './repositories/inventory'
import { SlackAlertService } from './services/alert/slack'
import { HeaderComparisonService } from './services/comparison/header'
import { ScriptComparisonService } from './services/comparison/script'
import { DetectionService } from './services/detection'
import { ScriptInventoryService } from './services/inventory'
import { GitInventoryStore } from './stores/inventory/git'
import type { ComparisonResultType, ScriptComparisonSummary } from './types/comparison'
import type { Inventory, InventoryDifferenceResult } from './types/inventory/model'
import { PullTarget, type Target } from './types/target'
import { getScriptContentMatchersFromInventory } from './utils/script/matcher'

/**
 * T061: Temporary conversion function for backward compatibility with InventoryService.
 * Converts typed comparison results back to old ScriptComparisonSummary format.
 *
 * TODO: Remove this once InventoryService is updated to use typed results.
 */
function convertTypedResultsToSummary(results: ComparisonResultType[], target: Target): ScriptComparisonSummary {
  const newScripts: any[] = []
  const newHashes: any[] = []

  results.forEach((result) => {
    if (result.type === 'unknown_script_found') {
      // Convert DetectedScript to ScriptInfo
      const scriptInfo = {
        source: result.script.name.startsWith('http') ? { type: 'external' as const, url: result.script.name } : { type: 'inline' as const, id: result.script.name, content: result.script.content ?? '' },
        hash: result.script.hash,
      }
      newScripts.push(scriptInfo)
    } else if (result.type === 'known_script_unauthorised_content') {
      // Script known but content changed
      const scriptInfo = {
        source: result.script.name.startsWith('http') ? { type: 'external' as const, url: result.script.name } : { type: 'inline' as const, id: result.script.name, content: result.script.content ?? '' },
        hash: result.script.hash,
      }
      newHashes.push(scriptInfo)
    }
    // AuthorizedScriptFound doesn't need to be added to summary (compliant script)
  })

  // Separate by type
  const externalNewScripts = newScripts.filter((s) => s.source.type === 'external')
  const inlineNewScripts = newScripts.filter((s) => s.source.type === 'inline')
  const externalNewHashes = newHashes.filter((s) => s.source.type === 'external')
  const inlineNewHashes = newHashes.filter((s) => s.source.type === 'inline')

  return {
    target,
    externalScripts: {
      newScripts: externalNewScripts,
      newHashes: externalNewHashes,
    },
    inlineScripts: {
      newScripts: inlineNewScripts,
      newHashes: inlineNewHashes,
    },
  }
}

// Just to test the CI run-on-github workflow
async function main() {
  const gitToken =
    process.env['INVENTORY_REPO_PAT'] ??
    (() => {
      throw new Error('INVENTORY_REPO_PAT environment variable is required')
    })()
  const slackToken =
    process.env['SLACK_OAUTH_TOKEN'] ??
    (() => {
      throw new Error('SLACK_OAUTH_TOKEN environment variable is required')
    })()
  const gitInventoryStore = new GitInventoryStore({ gitClient: simpleGit(), repositoryTarget: `https://x-access-token:${gitToken}@github.com/mr-yum/script-inventory.git` })
  const scriptInventoryRepository = new ScriptInventoryRepository({ inventoryStore: gitInventoryStore })
  const scriptInventoryService = new ScriptInventoryService({ inventoryRepository: scriptInventoryRepository })
  const detectionService = new DetectionService()
  const scriptComparisonService = new ScriptComparisonService()
  const headerComparisonService = new HeaderComparisonService()
  const slackAlertService = new SlackAlertService(slackToken)

  const log = (message: string): void => {
    console.log(`[Main]: ${message}`)
  }

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

      // Run header comparison with inventory (returns typed results per Phase 3)
      // @ts-expect-error TODO Phase 4: Use _headerComparisonResults with alert handler
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _headerComparisonResults = await headerComparisonService.compare(detectionSummaryForTarget.target, payload, detectionSummaryForTarget.headerSummary)

      // Alert for inventory and target using new typed results
      await slackAlertService.alertForTypedResults(scriptComparisonResults, target, payload.alerts)
      // TODO Phase 4: Update alert handler to process header results
      // await slackAlertService.alertForTypedResults(_headerComparisonResults, target, payload.alerts)

      // Run inventory sanity check and return to push to inventory
      // Note: InventoryService.diff() still expects old ScriptComparisonSummary format
      // TODO: Update InventoryService to use typed results (future task)
      // For now, we convert typed results back to summary format
      if (target.type === 'inventory') {
        // Convert typed results back to old summary format for backward compatibility
        const scriptComparisonSummaryForTarget = convertTypedResultsToSummary(scriptComparisonResults, target)
        // TODO Phase 4: Convert header results back to summary format for backward compatibility
        const headerComparisonSummaryForTarget = { target, unauthorisedHeaders: undefined }
        return await scriptInventoryService.diff(payload, scriptComparisonSummaryForTarget, headerComparisonSummaryForTarget)
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

  // Launch new Browser for executing Puppeteer workflow
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  // Pull inventory
  log('Preparing to pull inventory.')
  const inventory = await scriptInventoryService.pull(PullTarget.Inventory)

  // Run inventory workflow
  log('Preparing to run inventory workflow.')
  const inventoryDiffResults = await Promise.all(
    inventory.map(async (inventory) => {
      const inventoryResult = await runForTargetAsync(browser, inventory, inventory.target.inventory)
      return {
        inventoryResult: inventoryResult ?? (await Promise.reject('Expected inventory diff result to exist, but received null!')),
      }
    }),
  )

  // Push inventory
  log('Preparing to push inventory.')
  const inventoriesToPush = inventoryDiffResults.map((result) => result.inventoryResult!)
  await scriptInventoryService.push(inventoriesToPush)

  // Pull inventory
  log('Preparing to pull inventory.')
  const detectionInventory = await scriptInventoryService.pull(PullTarget.Detection)

  // Run detection workflow
  log('Preparing to run detection workflow.')
  await Promise.all(
    detectionInventory.map(async (inventory) => {
      await runForTargetAsync(browser, inventory, inventory.target.detection)
    }),
  )

  // Close browser
  await browser.close()
}

main().catch((error) => {
  console.error('[Main]: Application failed')
  if (error instanceof Error) {
    console.error(`[Main]: Error name: ${error.name}`)
    console.error(`[Main]: Error message: ${error.message}`)
    console.error(`[Main]: Stack trace:`, error.stack)
  } else {
    console.error(`[Main]: Error: ${error}`)
  }
  process.exit(1)
})
