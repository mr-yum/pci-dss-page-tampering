import { z } from 'zod'

import { decodeBase32, parseTotpSeedEntry } from '../utils/totp.js'

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
  gitUserName?: string
  gitUserEmail?: string
  totpSeed?: string[]
  reportDir?: string
  rumQueueUrl?: string
  help?: boolean
}

/**
 * T051: Custom URL validation with helpful error messages
 * Accepts https:// and file:// protocols
 */
const repoUrlSchema = z.string().superRefine((value, ctx) => {
  // Check if empty
  if (!value || value.trim() === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Repository URL is required. Example: https://github.com/org/repo or file:///path/to/repo',
    })
    return
  }

  // Check for supported protocols
  const trimmedValue = value.trim()
  const hasHttps = trimmedValue.startsWith('https://')
  const hasFile = trimmedValue.startsWith('file://')

  if (!hasHttps && !hasFile) {
    // Provide specific suggestions based on what they might have meant
    if (trimmedValue.startsWith('http://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Insecure http:// URLs are not supported. Use https:// instead. Example: https://github.com/org/repo',
      })
    } else if (trimmedValue.startsWith('git@') || (trimmedValue.includes(':') && !trimmedValue.includes('://'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SSH URLs (git@...) are not supported. Use HTTPS format instead. Example: https://github.com/org/repo',
      })
    } else if (trimmedValue.startsWith('/') || trimmedValue.startsWith('./') || trimmedValue.startsWith('~')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Local paths must use file:// protocol. Try: file://${trimmedValue.startsWith('/') ? trimmedValue : '/' + trimmedValue}`,
      })
    } else {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid repository URL format. Supported formats: https://github.com/org/repo or file:///path/to/repo',
      })
    }
    return
  }

  // Validate URL structure
  try {
    new URL(trimmedValue)
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid URL format: "${trimmedValue}". Please provide a valid URL.`,
    })
  }
})

/**
 * Validates repeatable `--totp-seed <name>=<base32-seed>` entries.
 * Error messages identify entries by position and name only — never by the
 * seed value, which is a durable credential.
 */
const totpSeedSchema = z
  .array(z.string())
  .default([])
  .superRefine((entries, ctx) => {
    const seenNames = new Set<string>()

    entries.forEach((entry, index) => {
      const parsed = parseTotpSeedEntry(entry)

      if (parsed === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `TOTP seed entry #${index + 1} must use the format <name>=<base32-seed>`,
        })
        return
      }

      const { name, seed } = parsed

      if (seenNames.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Duplicate TOTP seed name '${name}'`,
        })
        return
      }
      seenNames.add(name)

      try {
        decodeBase32(seed)
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'invalid base32'
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `TOTP seed '${name}' is invalid: ${reason}`,
        })
      }
    })
  })

/**
 * Zod schema for CLI argument validation
 * Applies type checking, format validation, and default values
 *
 * Note: `gitToken` is optional at the field level but conditionally required by the
 * object-level superRefine below. It is only skippable for `--mode validate` against
 * a `file://` repo (the CI inventory-validation case). All other combinations still
 * require a non-empty token to clone.
 */
export const CliArgsSchema = z
  .object({
    mode: z.enum(['inventory', 'detection', 'all', 'validate', 'rum-compare']).default('all'),
    target: z.string().optional(),
    repo: repoUrlSchema,
    gitToken: z.string().trim().default(''),
    slackToken: z.string().optional(),
    inventoryBranch: z.string().default('inventory-updates'),
    detectionBranch: z.string().default('main'),
    gitUserName: z.string().default('PCI DSS Page Tampering Bot'),
    gitUserEmail: z.string().default('noreply@example.com'),
    totpSeed: totpSeedSchema,
    reportDir: z.string().trim().min(1, 'Report directory must not be empty').optional(),
    rumQueueUrl: z.string().trim().optional(),
    help: z.boolean().default(false),
  })
  .superRefine((args, ctx) => {
    const isValidateModeWithFileRepo = args.mode === 'validate' && args.repo.trim().startsWith('file://')
    if (!isValidateModeWithFileRepo && args.gitToken.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gitToken'],
        message: 'Git token is required unless using --mode validate with a file:// repository',
      })
    }

    // --rum-queue-url is bound to --mode rum-compare in both directions:
    // the mode cannot run without a queue, and the parameter is meaningless
    // (and therefore rejected, not ignored) in every other mode.
    if (args.mode === 'rum-compare') {
      if (args.rumQueueUrl === undefined || args.rumQueueUrl.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rumQueueUrl'],
          message: '--rum-queue-url is required with --mode rum-compare. Example: https://sqs.us-east-1.amazonaws.com/123456789012/novel-observations or file:///path/to/local/queue',
        })
      } else if (!args.rumQueueUrl.startsWith('https://') && !args.rumQueueUrl.startsWith('file://')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rumQueueUrl'],
          message: '--rum-queue-url must be an https:// SQS queue URL or a file:// directory for local development',
        })
      }
    } else if (args.rumQueueUrl !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rumQueueUrl'],
        message: '--rum-queue-url is only valid with --mode rum-compare',
      })
    }
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
