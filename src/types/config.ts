/**
 * Runtime configuration types for command-line driven execution
 * Built from validated CLI arguments with derived fields
 */

/**
 * Execution mode enum
 */
export enum ExecutionMode {
  Inventory = 'inventory',
  Detection = 'detection',
  All = 'all',
}

/**
 * Target filter configuration
 */
export type TargetFilter = Readonly<{
  targetName: string | null // null = process all targets
}>

/**
 * Repository configuration
 */
export type RepositoryConfiguration = Readonly<{
  url: string
  clonePath: string // Always './pulled_repo' (from constants)
}>

/**
 * Branch configuration for inventory and detection workflows
 */
export type BranchConfiguration = Readonly<{
  inventory: string
  detection: string
}>

/**
 * Authentication configuration with derived repository URL
 */
export type AuthenticationConfiguration = Readonly<{
  gitToken: string
  repositoryTarget: string // Formatted as https://x-access-token:{token}@github.com/...
}>

/**
 * Alerting configuration with mode detection
 */
export type AlertingConfiguration = Readonly<{
  slackToken: string | null // null = log to console
  mode: 'slack' | 'console'
}>

/**
 * Complete runtime configuration object
 * Passed to services for workflow execution
 */
export type RuntimeConfiguration = Readonly<{
  executionMode: ExecutionMode
  targetFilter: TargetFilter
  repository: RepositoryConfiguration
  branches: BranchConfiguration
  authentication: AuthenticationConfiguration
  alerting: AlertingConfiguration
}>

/**
 * Type guard for checking if help was requested
 */
export function isHelpRequested(help: boolean): boolean {
  return help === true
}

/**
 * Type guard for checking if specific target requested
 */
export function hasTargetFilter(config: RuntimeConfiguration): boolean {
  return config.targetFilter.targetName !== null
}

/**
 * Type guard for checking alert mode
 */
export function usesSlackAlerts(config: RuntimeConfiguration): boolean {
  return config.alerting.mode === 'slack'
}
