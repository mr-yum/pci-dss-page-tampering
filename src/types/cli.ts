import { z } from 'zod'

/**
 * Raw CLI arguments parsed from process.argv
 * No validation applied at this stage
 */
export type RawCliArgs = {
  mode?: string
  target?: string
  repo?: string
  gitToken?: string
  slackToken?: string
  inventoryBranch?: string
  detectionBranch?: string
  help?: boolean
}

/**
 * Zod schema for CLI argument validation
 * Applies type checking, format validation, and default values
 */
export const CliArgsSchema = z.object({
  mode: z.enum(['inventory', 'detection', 'all']).default('all'),
  target: z.string().optional(),
  repo: z.string().url('Repository must be a valid URL'),
  gitToken: z.string().min(1, 'Git token is required for HTTPS repositories'),
  slackToken: z.string().optional(),
  inventoryBranch: z.string().default('updates/scripts'),
  detectionBranch: z.string().default('main'),
  help: z.boolean().default(false),
})

/**
 * Validated CLI arguments type (inferred from Zod schema)
 */
export type CliArguments = z.infer<typeof CliArgsSchema>

/**
 * Exit codes for CI/CD integration
 */
export enum ExitCode {
  Success = 0, // All workflows completed successfully
  ValidationError = 1, // Invalid CLI arguments or configuration
  ExecutionError = 2, // Git, network, or workflow failure
}
