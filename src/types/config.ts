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
  Validate = 'validate',
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
  gitUserName: string
  gitUserEmail: string
}>

/**
 * Alerting configuration with mode detection
 */
export type AlertingConfiguration = Readonly<{
  slackToken: string | null // null = log to console
  mode: 'slack' | 'console'
}>

/**
 * TOTP seeds for workflow steps of type 'totp', keyed by the seed name that
 * workflow definitions reference via `seedRef`. Seeds are secrets: they only
 * ever arrive via --totp-seed and must never be logged or persisted.
 */
export type TotpConfiguration = Readonly<{
  seeds: ReadonlyMap<string, string>
}>

/**
 * Auditor report output configuration.
 *
 * Opt-in: no report is written unless --report-dir is supplied, so existing
 * local and manual runs behave exactly as before.
 */
export type ReportingConfiguration = Readonly<{
  /** Directory for report artefacts, or null when reporting is disabled. */
  reportDir: string | null
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
  totp: TotpConfiguration
  reporting: ReportingConfiguration
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
