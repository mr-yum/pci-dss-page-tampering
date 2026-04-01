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
  gitUserName?: string
  gitUserEmail?: string
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
 * Zod schema for CLI argument validation
 * Applies type checking, format validation, and default values
 */
export const CliArgsSchema = z.object({
  mode: z.enum(['inventory', 'detection', 'all']).default('all'),
  target: z.string().optional(),
  repo: repoUrlSchema,
  gitToken: z.string().min(1, 'Git token is required for HTTPS repositories'),
  slackToken: z.string().optional(),
  inventoryBranch: z.string().default('inventory-updates'),
  detectionBranch: z.string().default('main'),
  gitUserName: z.string().default('PCI DSS Page Tampering Bot'),
  gitUserEmail: z.string().default('noreply@example.com'),
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
