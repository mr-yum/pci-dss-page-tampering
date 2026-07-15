import type { CliArguments } from '../types/cli.js'
import type { AlertingConfiguration, AuthenticationConfiguration, BranchConfiguration, ExecutionMode, RepositoryConfiguration, RuntimeConfiguration, TargetFilter, TotpConfiguration } from '../types/config.js'
import { parseTotpSeedEntry } from '../utils/totp.js'

/**
 * Build runtime configuration from validated CLI arguments
 * Includes derived fields like repositoryTarget and alerting mode
 *
 * @param cliArgs - Validated CLI arguments from Zod schema
 * @returns Complete runtime configuration for service execution
 */
export function buildConfiguration(cliArgs: CliArguments): RuntimeConfiguration {
  return {
    executionMode: cliArgs.mode as ExecutionMode,
    targetFilter: buildTargetFilter(cliArgs.target),
    repository: buildRepositoryConfiguration(cliArgs.repo),
    branches: buildBranchConfiguration(cliArgs.inventoryBranch, cliArgs.detectionBranch),
    authentication: buildAuthenticationConfiguration(cliArgs.repo, cliArgs.gitToken, cliArgs.gitUserName, cliArgs.gitUserEmail),
    alerting: buildAlertingConfiguration(cliArgs.slackToken),
    totp: buildTotpConfiguration(cliArgs.totpSeed),
  }
}

/**
 * Build target filter configuration
 */
function buildTargetFilter(target: string | undefined): TargetFilter {
  return {
    targetName: target ?? null,
  }
}

/**
 * Build repository configuration
 */
function buildRepositoryConfiguration(repo: string): RepositoryConfiguration {
  return {
    url: repo,
    clonePath: './pulled_repo', // Hardcoded from existing constants
  }
}

/**
 * Build branch configuration
 */
function buildBranchConfiguration(inventoryBranch: string, detectionBranch: string): BranchConfiguration {
  return {
    inventory: inventoryBranch,
    detection: detectionBranch,
  }
}

/**
 * Build authentication configuration with formatted repository URL
 */
function buildAuthenticationConfiguration(repo: string, gitToken: string, gitUserName: string, gitUserEmail: string): AuthenticationConfiguration {
  return {
    gitToken,
    repositoryTarget: formatRepositoryUrl(repo, gitToken),
    gitUserName,
    gitUserEmail,
  }
}

/**
 * Build alerting configuration with mode detection
 */
function buildAlertingConfiguration(slackToken: string | undefined): AlertingConfiguration {
  return {
    slackToken: slackToken ?? null,
    mode: slackToken ? 'slack' : 'console',
  }
}

/**
 * Build TOTP configuration from validated `<name>=<base32-seed>` entries.
 * Format and base32 validity are enforced by the CLI Zod schema, which uses
 * the same parseTotpSeedEntry — entries that fail to parse here were already
 * rejected there.
 */
function buildTotpConfiguration(totpSeed: string[]): TotpConfiguration {
  const seeds = new Map<string, string>()
  for (const entry of totpSeed) {
    const parsed = parseTotpSeedEntry(entry)
    if (parsed !== null) {
      seeds.set(parsed.name, parsed.seed)
    }
  }
  return { seeds }
}

/**
 * Format repository URL with authentication token
 * Handles both HTTPS and file:// protocols
 *
 * @param repo - Repository URL
 * @param token - Git authentication token
 * @returns Formatted URL for simple-git
 */
export function formatRepositoryUrl(repo: string, token: string): string {
  // Local file:// repositories don't need authentication
  if (repo.startsWith('file://')) {
    return repo
  }

  // Format HTTPS URL with x-access-token authentication
  // Input: https://github.com/org/repo
  // Output: https://x-access-token:{token}@github.com/org/repo
  try {
    const url = new URL(repo)
    url.username = 'x-access-token'
    url.password = token
    return url.toString()
  } catch {
    // If URL parsing fails, return original (validation should have caught this)
    return repo
  }
}
