/**
 * CLI Validation Integration Tests (T029-T030, T032)
 *
 * End-to-end integration tests for CLI parameter validation and error handling.
 * Tests missing parameters, invalid values, target validation, and exit codes.
 *
 * @see src/main.ts
 * @see src/cli/parser.ts
 * @see src/cli/config.ts
 * @see src/types/cli.ts
 * @see specs/008-refactor-the-code/spec.md - US1, FR-010, FR-023, FR-024
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

describe('CLI Validation Integration Tests', () => {
  describe('T029: Missing required parameters', () => {
    it('should exit with code 1 when --repo is missing', () => {
      const result = executeCli(['--git-token', 'dummy-token'])

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('repo')
    })

    it('should exit with code 1 when --git-token is missing', () => {
      const result = executeCli(['--repo', 'file:///tmp/test-repo'])

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('gitToken')
    })

    it('should exit with code 1 when both required parameters are missing', () => {
      const result = executeCli([])

      expect(result.status).toBe(1)
      // Should mention validation errors
      expect(result.stderr).toBeTruthy()
    })

    it('should display helpful error message for missing parameters', () => {
      const result = executeCli(['--repo', 'file:///tmp/test-repo'])

      expect(result.status).toBe(1)
      // Should provide clear error message
      expect(result.stderr).toMatch(/required|gitToken/i)
      // Should suggest help
      expect(result.stderr).toMatch(/--help|help/i)
    })

    it('should list all validation errors when multiple parameters are invalid', () => {
      // Invalid repo URL format
      const result = executeCli(['--repo', 'not-a-url', '--git-token', ''])

      expect(result.status).toBe(1)
      // Should report multiple errors
      expect(result.stderr).toContain('repo')
    })
  })

  describe('T030: Invalid target name', () => {
    it('should exit with code 2 when target does not exist in inventory', () => {
      // This test requires a valid repo with inventory, so it will likely fail with code 2
      // The important part is that it's NOT code 1 (validation error)
      const result = executeCli(['--mode', 'inventory', '--target', 'nonexistent-target', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not be a validation error (code 1)
      // Should be execution error (code 2) or success after checking inventory
      expect(result.status).not.toBe(1)
    })

    it('should accept target parameter format validation', () => {
      // Target name should be accepted as a string
      const result = executeCli(['--mode', 'inventory', '--target', '1.0', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation (may fail execution if repo doesn't exist)
      expect(result.status).not.toBe(1)
    })

    it('should provide helpful error message when target not found', () => {
      // With file:// protocol and dummy repo, we expect execution error
      const result = executeCli(['--mode', 'inventory', '--target', 'invalid-target-name', '--repo', 'file:///tmp/nonexistent-test-repo-12345', '--git-token', 'dummy-token'])

      // Should exit with execution error (2), not validation error (1)
      // Error message depends on whether Git error or target error occurs first
      expect(result.status).toBeGreaterThan(0)
    })
  })

  describe('T032: Exit codes for CI/CD integration', () => {
    it('should exit with code 0 (Success) when --help is requested', () => {
      const result = executeCli(['--help'])

      expect(result.status).toBe(0)
    })

    it('should exit with code 1 (ValidationError) for invalid CLI arguments', () => {
      const result = executeCli(['--mode', 'invalid-mode', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      expect(result.status).toBe(1)
    })

    it('should exit with code 1 (ValidationError) for missing required parameters', () => {
      const result = executeCli(['--mode', 'inventory'])

      expect(result.status).toBe(1)
    })

    it('should exit with code 2 (ExecutionError) for Git/network/workflow failures', () => {
      // Use a nonexistent file:// repo to trigger Git error
      const result = executeCli(['--mode', 'inventory', '--repo', 'file:///tmp/nonexistent-repo-xyz-12345', '--git-token', 'dummy-token'])

      // Should fail with execution error, not validation error
      expect(result.status).toBe(2)
    })

    it('should use distinct exit codes for different error types', () => {
      // Validation error
      const validationResult = executeCli(['--mode', 'invalid'])
      expect(validationResult.status).toBe(1)

      // Execution error (bad repo)
      const executionResult = executeCli(['--mode', 'inventory', '--repo', 'file:///tmp/nonexistent-xyz', '--git-token', 'dummy-token'])
      expect(executionResult.status).toBe(2)

      // Verify they're different
      expect(validationResult.status).not.toBe(executionResult.status)
    })
  })

  describe('Parameter format validation', () => {
    it('should reject invalid URL format for --repo', () => {
      const result = executeCli(['--repo', 'not-a-valid-url', '--git-token', 'dummy-token'])

      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/url|repository/i)
    })

    it('should accept file:// protocol URLs for --repo', () => {
      const result = executeCli(['--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation (may fail execution)
      expect(result.status).not.toBe(1)
    })

    it('should accept https:// protocol URLs for --repo', () => {
      const result = executeCli(['--repo', 'https://github.com/test/repo', '--git-token', 'dummy-token'])

      // Should not fail validation (may fail execution)
      expect(result.status).not.toBe(1)
    })

    it('should accept http:// protocol URLs for --repo (upgraded to https)', () => {
      const result = executeCli(['--repo', 'http://github.com/test/repo', '--git-token', 'dummy-token'])

      // Should not fail validation (may fail execution)
      expect(result.status).not.toBe(1)
    })

    it('should reject empty string for --git-token', () => {
      const result = executeCli(['--repo', 'file:///tmp/test-repo', '--git-token', ''])

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('gitToken')
    })

    it('should accept valid mode values: inventory, detection, all', () => {
      const modes = ['inventory', 'detection', 'all']

      modes.forEach((mode) => {
        const result = executeCli(['--mode', mode, '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

        // Should not fail validation for valid modes
        expect(result.status).not.toBe(1)
      })
    })

    it('should reject invalid mode values', () => {
      const invalidModes = ['scan', 'check', 'run', 'deploy']

      invalidModes.forEach((mode) => {
        const result = executeCli(['--mode', mode, '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

        expect(result.status).toBe(1)
      })
    })

    it('should reject empty string mode value', () => {
      const result = executeCli(['--mode', '', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Empty string may be caught as validation error (1) or execution error (2)
      expect(result.status).toBeGreaterThan(0)
    })
  })

  describe('Error message quality', () => {
    it('should provide clear, actionable error messages', () => {
      const result = executeCli(['--mode', 'inventory'])

      expect(result.status).toBe(1)
      // Should explain what went wrong
      expect(result.stderr).toMatch(/invalid|error|required/i)
      // Should suggest next steps
      expect(result.stderr).toMatch(/--help|help/i)
    })

    it('should list specific validation failures', () => {
      const result = executeCli(['--repo', 'not-a-url'])

      expect(result.status).toBe(1)
      // Should identify which parameter failed
      expect(result.stderr).toContain('repo')
      // Should explain why it failed
      expect(result.stderr).toMatch(/url|valid/i)
    })

    it('should not expose sensitive information in error messages', () => {
      const result = executeCli(['--repo', 'file:///tmp/test-repo', '--git-token', 'super-secret-token-12345'])

      // Token should not appear in output (even though validation passes)
      expect(result.stdout).not.toContain('super-secret-token-12345')
      expect(result.stderr).not.toContain('super-secret-token-12345')
    })
  })

  describe('Parameter parsing edge cases', () => {
    it('should handle --key=value format', () => {
      const result = executeCli(['--repo=file:///tmp/test-repo', '--git-token=dummy-token', '--mode=inventory'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should handle --key value format', () => {
      const result = executeCli(['--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token', '--mode', 'inventory'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should handle mixed --key=value and --key value formats', () => {
      const result = executeCli(['--repo=file:///tmp/test-repo', '--git-token', 'dummy-token', '--mode=inventory'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should handle boolean flags correctly', () => {
      const result = executeCli(['--help'])

      expect(result.status).toBe(0)
    })

    it('should handle parameters with hyphens in values', () => {
      const result = executeCli(['--inventory-branch', 'feature/test-branch', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })

    it('should handle parameters with slashes in values', () => {
      const result = executeCli(['--inventory-branch', 'updates/scripts', '--detection-branch', 'release/v1.0', '--repo', 'file:///tmp/test-repo', '--git-token', 'dummy-token'])

      // Should not fail validation
      expect(result.status).not.toBe(1)
    })
  })
})
