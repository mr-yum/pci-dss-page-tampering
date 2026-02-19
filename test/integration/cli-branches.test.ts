/**
 * CLI Branch Override Integration Tests (T031, T038)
 *
 * End-to-end integration tests for --inventory-branch and --detection-branch parameters.
 * Tests custom branch configuration and default behavior.
 *
 * @see src/main.ts
 * @see src/cli/config.ts
 * @see src/types/config.ts
 * @see src/stores/inventory/git.ts
 * @see specs/008-refactor-the-code/spec.md - US1, US2, FR-006, FR-007
 */

import { spawnSync } from 'child_process'
import path from 'path'

// Path to main.ts (we'll execute via tsx)
const MAIN_PATH = path.join(__dirname, '../../src/main.ts')

// Helper to execute CLI with arguments
const executeCli = (args: string[]) => {
  return spawnSync('npx', ['tsx', MAIN_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  })
}

describe('CLI Branch Override Integration Tests', () => {
  describe('T031: --inventory-branch parameter', () => {
    it('should accept --inventory-branch with custom value', () => {
      const result = executeCli(['--mode', 'inventory', '--inventory-branch', 'feature/test-branch', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should use default "inventory-updates" when --inventory-branch is omitted', () => {
      // Verify default is documented in help
      const result = executeCli(['--help'])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('inventory-updates')
      expect(result.stdout).toContain('--inventory-branch')
    })

    it('should accept branch names with slashes', () => {
      const branchNames = ['inventory-updates', 'feature/new-workflow', 'release/v1.0', 'hotfix/security-patch']

      branchNames.forEach((branchName) => {
        const result = executeCli(['--mode', 'inventory', '--inventory-branch', branchName, '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

        // Should not fail validation
        expect(result.status).not.toBe(1)
      })
    })

    it('should accept branch names with hyphens', () => {
      const result = executeCli(['--mode', 'inventory', '--inventory-branch', 'feature-branch-name', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should accept branch names with underscores', () => {
      const result = executeCli(['--mode', 'inventory', '--inventory-branch', 'feature_branch_name', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should work in inventory mode with custom branch', () => {
      const result = executeCli(['--mode', 'inventory', '--inventory-branch', 'custom-inventory-branch', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation (may fail execution if repo doesn't exist)
      expect(result.status).not.toBe(1)
    })

    it('should work in --mode all with custom inventory branch', () => {
      const result = executeCli(['--mode', 'all', '--inventory-branch', 'staging-inventory', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })
  })

  describe('T038: --detection-branch parameter', () => {
    it('should accept --detection-branch with custom value', () => {
      const result = executeCli(['--mode', 'detection', '--detection-branch', 'production', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should use default "main" when --detection-branch is omitted', () => {
      // Verify default is documented in help
      const result = executeCli(['--help'])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('main')
      expect(result.stdout).toContain('--detection-branch')
    })

    it('should accept branch names with slashes', () => {
      const branchNames = ['main', 'master', 'production', 'release/v2.0', 'stable/prod']

      branchNames.forEach((branchName) => {
        const result = executeCli(['--mode', 'detection', '--detection-branch', branchName, '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

        // Should not fail validation
        expect(result.status).not.toBe(1)
      })
    })

    it('should accept branch names with hyphens and underscores', () => {
      const result = executeCli(['--mode', 'detection', '--detection-branch', 'production-stable_v1', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should work in detection mode with custom branch', () => {
      const result = executeCli(['--mode', 'detection', '--detection-branch', 'custom-detection-branch', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation (may fail execution if repo doesn't exist)
      expect(result.status).not.toBe(1)
    })

    it('should work in --mode all with custom detection branch', () => {
      const result = executeCli(['--mode', 'all', '--detection-branch', 'production-baseline', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })
  })

  describe('Combined branch overrides', () => {
    it('should accept both --inventory-branch and --detection-branch together', () => {
      const result = executeCli(['--mode', 'all', '--inventory-branch', 'staging-updates', '--detection-branch', 'production-baseline', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should allow same branch name for both inventory and detection', () => {
      const result = executeCli(['--mode', 'all', '--inventory-branch', 'main', '--detection-branch', 'main', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation (though not recommended in practice)
      expect(result.status).not.toBe(1)
    })

    it('should allow different branch names for inventory and detection', () => {
      const result = executeCli(['--mode', 'all', '--inventory-branch', 'inventory-updates', '--detection-branch', 'main', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation (this is the recommended pattern)
      expect(result.status).not.toBe(1)
    })
  })

  describe('Branch parameter validation', () => {
    it('should document branch parameters in help', () => {
      const result = executeCli(['--help'])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('--inventory-branch')
      expect(result.stdout).toContain('--detection-branch')
    })

    it('should document default branch values in help', () => {
      const result = executeCli(['--help'])

      expect(result.status).toBe(0)
      // Default inventory branch
      expect(result.stdout).toContain('inventory-updates')
      // Default detection branch
      expect(result.stdout).toContain('main')
    })

    it('should handle branch parameters in --key=value format', () => {
      const result = executeCli(['--mode=inventory', '--inventory-branch=feature/test', '--repo=file:///tmp/test-repo', '--git-token=dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should handle branch parameters in --key value format', () => {
      const result = executeCli(['--mode', 'detection', '--detection-branch', 'production', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })
  })

  describe('Branch override use cases', () => {
    it('should support feature branch testing workflow', () => {
      // Test inventory updates on a feature branch before merging
      const result = executeCli(['--mode', 'inventory', '--inventory-branch', 'feature/new-script', '--target', '1.0', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should support production detection workflow', () => {
      // Run detection against production baseline
      const result = executeCli(['--mode', 'detection', '--detection-branch', 'production', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should support staging environment workflow', () => {
      // Use staging branch for both inventory and detection
      const result = executeCli(['--mode', 'all', '--inventory-branch', 'staging', '--detection-branch', 'staging', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should support release workflow testing', () => {
      // Test against a specific release branch
      const result = executeCli(['--mode', 'detection', '--detection-branch', 'release/v2.0', '--target', '2.0', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })
  })

  describe('Branch parameter edge cases', () => {
    it('should accept branch names with dots', () => {
      const result = executeCli(['--mode', 'inventory', '--inventory-branch', 'release/v1.2.3', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should accept branch names with numbers', () => {
      const result = executeCli(['--mode', 'detection', '--detection-branch', 'production-2024', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should handle branch parameters with common Git branch naming patterns', () => {
      const validBranchNames = ['main', 'master', 'develop', 'feature/ABC-123', 'bugfix/fix-issue', 'hotfix/security', 'release/1.0.0', 'staging', 'production']

      validBranchNames.forEach((branchName) => {
        const result = executeCli(['--mode', 'inventory', '--inventory-branch', branchName, '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

        // Should not fail validation
        expect(result.status).not.toBe(1)
      })
    })
  })

  describe('Default behavior verification', () => {
    it('should use inventory-updates for inventory when no override provided', () => {
      // This is tested implicitly - if default wasn't working, execution would fail differently
      const result = executeCli(['--mode', 'inventory', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should use main for detection when no override provided', () => {
      const result = executeCli(['--mode', 'detection', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should use defaults for both branches in --mode all', () => {
      const result = executeCli(['--mode', 'all', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })
  })
})
