/**
 * Script Comparison Service Interface Contract
 *
 * Defines the updated interface for ScriptComparisonService after refactoring.
 *
 * @see data-model.md for data flow
 * @see research.md (R4) for first-match-wins implementation
 */

import { DetectedScript } from '../../../src/types/script';
import { ScriptInventoryEntry } from '../../../src/types/inventory/model';
import { Target } from '../../../src/types/target';
import { ComparisonResultType } from './comparison-result.interface';

/**
 * Service responsible for comparing detected scripts against inventory.
 *
 * Key behaviors:
 * - First-match-wins: Iterates inventory array in order, returns first match
 * - Fail-secure: Null/empty content triggers UnknownScriptFound
 * - Typed results: Returns array of ComparisonResultType for type-safe handling
 */
export interface IScriptComparisonService {
  /**
   * Compares an array of detected scripts against inventory.
   *
   * For each detected script:
   * 1. Check if content is null/empty → UnknownScriptFound (fail-secure)
   * 2. Iterate inventory.scripts in array order
   * 3. For each inventory entry, create matcher from identifyWith config
   * 4. If matcher.identify(script) returns true:
   *    a. Create matcher from authoriseWith config
   *    b. If matcher.authorize(script) passes → AuthorizedScriptFound
   *    c. If matcher.authorize(script) fails → KnownScriptWithUnauthorisedContentFound
   * 5. If no inventory entry matches → UnknownScriptFound
   *
   * @param detectedScripts - Scripts captured during workflow execution
   * @param inventory - Array of authorized script entries (from Git repository)
   * @param target - Target being processed (for result context)
   * @returns Array of comparison results (one per detected script)
   *
   * @example
   * const results = service.compare(detectedScripts, inventory, target);
   * results.forEach(result => {
   *   switch (result.type) {
   *     case 'unknown_script_found':
   *       alertService.sendUnknownScriptAlert(result);
   *       break;
   *     case 'known_script_unauthorised_content':
   *       alertService.sendMismatchAlert(result);
   *       break;
   *     case 'authorized_script':
   *       // No action needed
   *       break;
   *   }
   * });
   */
  compare(
    detectedScripts: DetectedScript[],
    inventory: ScriptInventoryEntry[],
    target: Target
  ): ComparisonResultType[];

  /**
   * Finds the first matching inventory entry for a detected script.
   * Helper method for testing and debugging.
   *
   * @param script - The detected script
   * @param inventory - Array of authorized script entries
   * @returns Matching inventory entry or null if no match
   *
   * Implementation:
   * - Iterates inventory array in order
   * - For each entry, creates matcher from identifyWith config
   * - Returns first entry where matcher.identify(script) is true
   * - Returns null if no match found
   */
  findMatchingInventoryEntry(
    script: DetectedScript,
    inventory: ScriptInventoryEntry[]
  ): ScriptInventoryEntry | null;
}
