/**
 * CLI Help Integration Tests (T028)
 *
 * End-to-end integration tests for --help flag functionality.
 * Tests help output, exit codes, and documentation completeness.
 *
 * @see src/main.ts
 * @see src/cli/help.ts
 * @see specs/008-refactor-the-code/spec.md - US1, FR-008, FR-009, FR-021
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

describe('CLI Help Integration Tests (T028)', () => {
  describe('--help flag behavior', () => {
    it('should exit with code 0 when --help is provided', () => {
      const result = executeCli(['--help'])

      expect(result.status).toBe(0)
    })

    it('should display help text and exit without executing workflows', () => {
      const result = executeCli(['--help'])

      expect(result.status).toBe(0)
      expect(result.stdout).toBeTruthy()
      expect(result.stdout.length).toBeGreaterThan(100) // Should have substantial help content
    })

    it('should work with --help flag even without other required parameters', () => {
      // Help should work without --repo or --git-token
      const result = executeCli(['--help'])

      expect(result.status).toBe(0)
      expect(result.stderr).not.toContain('required')
    })
  })

  describe('Help content completeness', () => {
    let helpOutput: string

    beforeAll(() => {
      const result = executeCli(['--help'])
      helpOutput = result.stdout
    })

    it('should document all CLI parameters', () => {
      const requiredParams = ['--mode', '--target', '--repo', '--git-token', '--slack-token', '--inventory-branch', '--detection-branch', '--help']

      requiredParams.forEach((param) => {
        expect(helpOutput).toContain(param)
      })
    })

    it('should document the three execution modes', () => {
      expect(helpOutput).toContain('inventory')
      expect(helpOutput).toContain('detection')
      expect(helpOutput).toContain('all')
    })

    it('should include parameter descriptions', () => {
      // Help should explain what each parameter does
      expect(helpOutput).toMatch(/--mode.*(inventory|detection|all)/i)
      expect(helpOutput).toMatch(/--repo.*repository/i)
      expect(helpOutput).toMatch(/--git-token.*token/i)
    })

    it('should document default values', () => {
      // Help should show defaults for mode, inventory-branch, detection-branch
      expect(helpOutput).toContain('all') // default mode
      expect(helpOutput).toContain('updates/scripts') // default inventory branch
      expect(helpOutput).toContain('main') // default detection branch
    })

    it('should include usage examples', () => {
      // Help should provide at least one example
      expect(helpOutput).toMatch(/example|usage/i)
      expect(helpOutput).toContain('npm start')
    })

    it('should document optional vs required parameters', () => {
      // Help has "REQUIRED PARAMETERS" and "OPTIONAL PARAMETERS" sections
      expect(helpOutput).toContain('REQUIRED PARAMETERS')
      expect(helpOutput).toContain('OPTIONAL PARAMETERS')

      // repo and git-token should be in REQUIRED section
      const requiredSection = helpOutput.split('REQUIRED PARAMETERS')[1]?.split('OPTIONAL PARAMETERS')[0]
      expect(requiredSection).toBeDefined()
      expect(requiredSection).toContain('--repo')
      expect(requiredSection).toContain('--git-token')

      // target and slack-token should be in OPTIONAL section
      const optionalSection = helpOutput.split('OPTIONAL PARAMETERS')[1]
      expect(optionalSection).toBeDefined()
      expect(optionalSection).toContain('--target')
      expect(optionalSection).toContain('--slack-token')
    })
  })

  describe('Help formatting', () => {
    it('should use clear, readable formatting', () => {
      const result = executeCli(['--help'])

      // Should have line breaks for readability
      expect(result.stdout.split('\n').length).toBeGreaterThan(10)

      // Should not have overly long lines (> 120 chars suggests poor formatting)
      const lines = result.stdout.split('\n')
      const longLines = lines.filter((line) => line.length > 120)
      expect(longLines.length).toBeLessThan(lines.length / 2) // Most lines should be reasonable length
    })

    it('should include section headers or organization', () => {
      const result = executeCli(['--help'])

      // Help should be organized (look for actual section headers from the output)
      const hasOrganization =
        result.stdout.includes('USAGE:') || result.stdout.includes('REQUIRED PARAMETERS:') || result.stdout.includes('OPTIONAL PARAMETERS:') || result.stdout.includes('EXAMPLES:') || result.stdout.includes('EXIT CODES:')

      expect(hasOrganization).toBe(true)
    })
  })

  describe('Help accessibility', () => {
    it('should be understandable by new users within 2 minutes (SC-005)', () => {
      const result = executeCli(['--help'])

      // Test objective indicators of understandability:
      // 1. Reasonable length (not overwhelming)
      const wordCount = result.stdout.split(/\s+/).length
      expect(wordCount).toBeGreaterThan(50) // Enough detail
      expect(wordCount).toBeLessThan(1000) // Not overwhelming

      // 2. Contains examples
      expect(result.stdout).toMatch(/example/i)

      // 3. Documents all required parameters
      expect(result.stdout).toContain('--repo')
      expect(result.stdout).toContain('--git-token')
    })

    it('should work as documented in help when running suggested examples', () => {
      const result = executeCli(['--help'])

      // Help should document that --help works without other parameters
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('--help')
    })
  })

  describe('Help in error scenarios', () => {
    it('should suggest --help when validation fails', () => {
      // Try to run without required parameters
      const result = executeCli([])

      // Should exit with validation error and suggest help
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/--help|help/i)
    })

    it('should suggest --help when invalid parameters are provided', () => {
      const result = executeCli(['--mode', 'invalid-mode'])

      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/--help|help/i)
    })
  })
})
