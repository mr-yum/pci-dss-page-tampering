import type { CliArguments } from '../types/cli.js'
import type { AlertingConfiguration,AuthenticationConfiguration, BranchConfiguration, ExecutionMode, RepositoryConfiguration, RuntimeConfiguration, TargetFilter } from '../types/config.js'

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
    authentication: buildAuthenticationConfiguration(cliArgs.repo, cliArgs.gitToken),
    alerting: buildAlertingConfiguration(cliArgs.slackToken),
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
function buildAuthenticationConfiguration(repo: string, gitToken: string): AuthenticationConfiguration {
  return {
    gitToken,
    repositoryTarget: formatRepositoryUrl(repo, gitToken),
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
