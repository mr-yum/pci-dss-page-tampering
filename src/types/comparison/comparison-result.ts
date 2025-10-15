/**
 * Comparison Result Base Class
 *
 * Provides common context shared across all comparison result types.
 * Used by ScriptComparisonService to return typed results with complete context.
 *
 * @see specs/001-refactor-script-identification/data-model.md for entity definitions
 * @see specs/001-refactor-script-identification/research.md (R3) for design rationale
 */

import type { Target } from '../target';

/**
 * Base class for all comparison results.
 * Provides common context shared across all result types.
 */
export abstract class ComparisonResult {
  /**
   * Discriminator for TypeScript discriminated unions.
   * Enables exhaustive type checking in handlers.
   */
  abstract readonly type: string;

  /**
   * The target being processed (inventory or detection URL).
   */
  public readonly target: Target;

  /**
   * When the comparison occurred (UTC).
   */
  public readonly timestamp: Date;

  constructor(target: Target, timestamp: Date) {
    this.target = target;
    this.timestamp = timestamp;
  }
}
