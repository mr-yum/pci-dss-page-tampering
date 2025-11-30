import type { CliArguments } from '../types/cli'
import { ExecutionMode } from '../types/config'
import { buildConfiguration, formatRepositoryUrl } from './config'

describe('Configuration Builder', () => {
  describe('buildConfiguration', () => {
    it('should build complete configuration from CLI arguments', () => {
      const cliArgs: CliArguments = {
        mode: 'inventory',
        target: '1.0',
        repo: 'https://github.com/org/inventory',
        gitToken: 'ghp_abc123xyz',
        slackToken: 'xoxb-slack-token',
        inventoryBranch: 'updates/scripts',
        detectionBranch: 'main',
        help: false,
      }

      const config = buildConfiguration(cliArgs)

      expect(config.executionMode).toBe(ExecutionMode.Inventory)
      expect(config.targetFilter.targetName).toBe('1.0')
      expect(config.repository.url).toBe('https://github.com/org/inventory')
      expect(config.repository.clonePath).toBe('./pulled_repo')
      expect(config.branches.inventory).toBe('updates/scripts')
      expect(config.branches.detection).toBe('main')
      expect(config.authentication.gitToken).toBe('ghp_abc123xyz')
      expect(config.authentication.repositoryTarget).toBe('https://x-access-token:ghp_abc123xyz@github.com/org/inventory')
      expect(config.alerting.slackToken).toBe('xoxb-slack-token')
      expect(config.alerting.mode).toBe('slack')
    })

    it('should handle undefined target as null in targetFilter', () => {
      const cliArgs: CliArguments = {
        mode: 'all',
        target: undefined,
        repo: 'https://github.com/org/inventory',
        gitToken: 'ghp_token',
        slackToken: undefined,
        inventoryBranch: 'updates/scripts',
        detectionBranch: 'main',
        help: false,
      }

      const config = buildConfiguration(cliArgs)

      expect(config.targetFilter.targetName).toBeNull()
    })

    it('should set alerting mode to console when slackToken is undefined', () => {
      const cliArgs: CliArguments = {
        mode: 'detection',
        target: undefined,
        repo: 'https://github.com/org/inventory',
        gitToken: 'ghp_token',
        slackToken: undefined,
        inventoryBranch: 'updates/scripts',
        detectionBranch: 'main',
        help: false,
      }

      const config = buildConfiguration(cliArgs)

      expect(config.alerting.slackToken).toBeNull()
      expect(config.alerting.mode).toBe('console')
    })

    it('should handle all execution mode', () => {
      const cliArgs: CliArguments = {
        mode: 'all',
        target: undefined,
        repo: 'https://github.com/org/inventory',
        gitToken: 'ghp_token',
        slackToken: undefined,
        inventoryBranch: 'updates/scripts',
        detectionBranch: 'main',
        help: false,
      }

      const config = buildConfiguration(cliArgs)

      expect(config.executionMode).toBe(ExecutionMode.All)
    })

    it('should handle detection execution mode', () => {
      const cliArgs: CliArguments = {
        mode: 'detection',
        target: '2.0',
        repo: 'https://github.com/org/inventory',
        gitToken: 'ghp_token',
        slackToken: 'xoxb-token',
        inventoryBranch: 'updates/scripts',
        detectionBranch: 'staging',
        help: false,
      }

      const config = buildConfiguration(cliArgs)

      expect(config.executionMode).toBe(ExecutionMode.Detection)
      expect(config.branches.detection).toBe('staging')
    })

    it('should handle custom branch configurations', () => {
      const cliArgs: CliArguments = {
        mode: 'inventory',
        target: undefined,
        repo: 'https://github.com/org/inventory',
        gitToken: 'ghp_token',
        slackToken: undefined,
        inventoryBranch: 'feature/new-scripts',
        detectionBranch: 'release/v2.0',
        help: false,
      }

      const config = buildConfiguration(cliArgs)

      expect(config.branches.inventory).toBe('feature/new-scripts')
      expect(config.branches.detection).toBe('release/v2.0')
    })
  })

  describe('formatRepositoryUrl', () => {
    it('should format HTTPS URL with x-access-token authentication', () => {
      const repo = 'https://github.com/org/inventory'
      const token = 'ghp_abc123xyz'

      const formatted = formatRepositoryUrl(repo, token)

      expect(formatted).toBe('https://x-access-token:ghp_abc123xyz@github.com/org/inventory')
    })

    it('should not modify file:// URLs', () => {
      const repo = 'file:///Users/dev/test-inventory'
      const token = 'dummy-token'

      const formatted = formatRepositoryUrl(repo, token)

      expect(formatted).toBe('file:///Users/dev/test-inventory')
    })

    it('should preserve URL query parameters', () => {
      const repo = 'https://github.com/org/inventory?param=value'
      const token = 'ghp_token'

      const formatted = formatRepositoryUrl(repo, token)

      expect(formatted).toBe('https://x-access-token:ghp_token@github.com/org/inventory?param=value')
    })

    it('should preserve URL fragments', () => {
      const repo = 'https://github.com/org/inventory#section'
      const token = 'ghp_token'

      const formatted = formatRepositoryUrl(repo, token)

      expect(formatted).toBe('https://x-access-token:ghp_token@github.com/org/inventory#section')
    })

    it('should handle HTTPS URLs with ports', () => {
      const repo = 'https://git.company.com:8443/org/repo'
      const token = 'ghp_token'

      const formatted = formatRepositoryUrl(repo, token)

      expect(formatted).toBe('https://x-access-token:ghp_token@git.company.com:8443/org/repo')
    })

    it('should handle GitHub Enterprise URLs', () => {
      const repo = 'https://github.enterprise.com/org/repo.git'
      const token = 'ghp_enterprise_token'

      const formatted = formatRepositoryUrl(repo, token)

      expect(formatted).toBe('https://x-access-token:ghp_enterprise_token@github.enterprise.com/org/repo.git')
    })

    it('should handle tokens with special characters', () => {
      const repo = 'https://github.com/org/repo'
      const token = 'ghp_abc-123_xyz'

      const formatted = formatRepositoryUrl(repo, token)

      expect(formatted).toBe('https://x-access-token:ghp_abc-123_xyz@github.com/org/repo')
    })

    it('should return original URL if parsing fails', () => {
      const repo = 'not-a-valid-url'
      const token = 'ghp_token'

      const formatted = formatRepositoryUrl(repo, token)

      // Should return original since URL parsing fails
      expect(formatted).toBe('not-a-valid-url')
    })

    it('should handle URLs with existing authentication (replace it)', () => {
      const repo = 'https://old-user:old-pass@github.com/org/repo'
      const token = 'ghp_new_token'

      const formatted = formatRepositoryUrl(repo, token)

      expect(formatted).toBe('https://x-access-token:ghp_new_token@github.com/org/repo')
    })

    it('should handle .git suffix in repository URL', () => {
      const repo = 'https://github.com/org/inventory.git'
      const token = 'ghp_token'

      const formatted = formatRepositoryUrl(repo, token)

      expect(formatted).toBe('https://x-access-token:ghp_token@github.com/org/inventory.git')
    })
  })
})
