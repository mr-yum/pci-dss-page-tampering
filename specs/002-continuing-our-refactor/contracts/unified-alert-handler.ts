/**
 * Unified Alert Handler Contract
 *
 * Defines the interface for processing both script and header comparison results
 * through a single typed alert handler using discriminated union pattern.
 *
 * @see ../research.md R4: Unified Typed Alert Handler
 * @see ../data-model.md E6: ComparisonResultType
 */

// Import script result types
import type { AuthorizedScriptFound, KnownScriptWithUnauthorisedContentFound, UnknownScriptFound } from '../../../src/types/comparison'
import type { InventoryAlert } from '../../../src/types/inventory/model'
import type { Target } from '../../../src/types/target'
// Import header result types
import type { AuthorizedHeaderFound, KnownHeaderWithUnauthorisedContentFound, UnknownHeaderFound } from './header-comparison-results'

/**
 * Discriminated union of ALL comparison result types (scripts + headers).
 * Enables exhaustive type checking in alert handler switch statements.
 *
 * @see research.md R8: TypeScript Discriminated Union for Result Types
 */
export type ComparisonResultType =
  // Script results
  | AuthorizedScriptFound
  | KnownScriptWithUnauthorisedContentFound
  | UnknownScriptFound
  // Header results
  | AuthorizedHeaderFound
  | KnownHeaderWithUnauthorisedContentFound
  | UnknownHeaderFound

/**
 * Unified alert service interface.
 * Replaces legacy alertForScripts and alertForHeaders methods.
 */
export interface IAlertService {
  /**
   * Process typed comparison results and generate appropriate alerts.
   *
   * Implementation must use discriminated union pattern to handle each result type:
   * - Switch on result.type
   * - TypeScript provides type narrowing in each case block
   * - Default case uses `never` type for exhaustive checking
   *
   * Alert routing determined by:
   * 1. Result type (unknown, unauthorized, authorized)
   * 2. Workflow context (inventory vs detection)
   * 3. Alert destinations from inventory configuration
   *
   * Behavior:
   * - Authorized results: No alert generated
   * - Unknown results: Route to new_inventory/uninventoried alert per workflow
   * - Unauthorized results: Route to mismatch alert (detection workflow only)
   * - Alert failures: Log error and continue (do not block comparison)
   *
   * @param comparisonResults - Array of typed comparison results (scripts and/or headers)
   * @param target - The target being processed (determines workflow context)
   * @param alertDestinations - Alert routing configuration from inventory
   *
   * @see data-model.md BR-6: Alert Routing by Workflow
   */
  alertForTypedResults(comparisonResults: ComparisonResultType[], target: Target, alertDestinations: InventoryAlert): Promise<void>

  /**
   * @deprecated Use alertForTypedResults instead.
   * Will be removed after migration to typed results is complete.
   */
  alertForScripts?(scriptComparisonSummary: unknown, target: Target, alertDestinations: InventoryAlert): Promise<void>

  /**
   * @deprecated Use alertForTypedResults instead.
   * Will be removed after migration to typed results is complete.
   */
  alertForHeaders?(headerComparisonSummary: unknown, target: Target, alertDestinations: InventoryAlert): Promise<void>
}

/**
 * Example implementation pattern for alertForTypedResults:
 *
 * ```typescript
 * async alertForTypedResults(
 *   results: ComparisonResultType[],
 *   target: Target,
 *   alertDestinations: InventoryAlert
 * ): Promise<void> {
 *   for (const result of results) {
 *     try {
 *       switch (result.type) {
 *         case 'unknown_script_found':
 *           // TypeScript knows result is UnknownScriptFound
 *           await this.sendAlert({
 *             category: this.isInventoryWorkflow(target)
 *               ? 'new_inventory_script_identified'
 *               : 'uninventoried_script_detected',
 *             script: result.script,
 *             target: result.target,
 *             destination: alertDestinations.newScriptDetected
 *           })
 *           break
 *
 *         case 'known_script_unauthorised_content':
 *           // TypeScript knows result is KnownScriptWithUnauthorisedContentFound
 *           await this.sendAlert({
 *             category: 'mismatched_script_detected',
 *             script: result.script,
 *             inventoryEntry: result.inventoryEntry,
 *             failureReason: result.failureReason,
 *             matcher: result.authorizationMatcher.getPattern(),
 *             target: result.target,
 *             destination: alertDestinations.scriptMismatchDetected
 *           })
 *           break
 *
 *         case 'authorized_script':
 *           // No alert for authorized scripts
 *           break
 *
 *         case 'unknown_header_found':
 *           // TypeScript knows result is UnknownHeaderFound
 *           await this.sendAlert({
 *             category: this.isInventoryWorkflow(target)
 *               ? 'new_inventory_header_identified'
 *               : 'uninventoried_header_detected',
 *             header: result.header,
 *             target: result.target,
 *             destination: alertDestinations.newHeaderDetected
 *           })
 *           break
 *
 *         case 'known_header_unauthorised_content':
 *           // TypeScript knows result is KnownHeaderWithUnauthorisedContentFound
 *           await this.sendAlert({
 *             category: 'mismatched_header_detected',
 *             header: result.header,
 *             inventoryEntry: result.inventoryEntry,
 *             failureReason: result.failureReason,
 *             matcher: result.authorizationMatcher.getPattern(),
 *             target: result.target,
 *             destination: alertDestinations.headerMismatchDetected
 *           })
 *           break
 *
 *         case 'authorized_header':
 *           // No alert for authorized headers
 *           break
 *
 *         default:
 *           // Exhaustive check: compile error if case missing
 *           const _exhaustive: never = result
 *           throw new Error(`Unhandled result type: ${(result as any).type}`)
 *       }
 *     } catch (error) {
 *       // Alert failures must not block comparison
 *       console.error(`Alert failed for result type ${result.type}:`, error)
 *     }
 *   }
 * }
 * ```
 */
