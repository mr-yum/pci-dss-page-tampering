import type { RawCliArgs } from '../types/cli.js'
import { parseArguments } from './parser.js'

describe('CLI Parser', () => {
  describe('parseArguments', () => {
    it('should parse --key value format', () => {
      const argv = ['node', 'script.js', '--mode', 'inventory', '--repo', 'https://github.com/org/repo']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        mode: 'inventory',
        repo: 'https://github.com/org/repo',
      })
    })

    it('should parse --key=value format', () => {
      const argv = ['node', 'script.js', '--mode=detection', '--repo=https://github.com/org/repo']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        mode: 'detection',
        repo: 'https://github.com/org/repo',
      })
    })

    it('should parse mixed formats', () => {
      const argv = ['node', 'script.js', '--mode=inventory', '--target', '1.0', '--repo=https://github.com/org/repo', '--git-token', 'ghp_abc123']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        mode: 'inventory',
        target: '1.0',
        repo: 'https://github.com/org/repo',
        gitToken: 'ghp_abc123',
      })
    })

    it('should parse --help flag', () => {
      const argv = ['node', 'script.js', '--help']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        help: true,
      })
    })

    it('should parse -h shorthand for help', () => {
      const argv = ['node', 'script.js', '-h']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        help: true,
      })
    })

    it('should parse kebab-case keys to camelCase', () => {
      const argv = ['node', 'script.js', '--git-token', 'ghp_abc', '--slack-token', 'xoxb-123', '--inventory-branch', 'develop', '--detection-branch', 'staging']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        gitToken: 'ghp_abc',
        slackToken: 'xoxb-123',
        inventoryBranch: 'develop',
        detectionBranch: 'staging',
      })
    })

    it('should handle values with equals signs', () => {
      const argv = ['node', 'script.js', '--repo=file:///path/with=equals']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        repo: 'file:///path/with=equals',
      })
    })

    it('should handle empty argv (no arguments)', () => {
      const argv = ['node', 'script.js']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({})
    })

    it('should ignore unknown flags', () => {
      const argv = ['node', 'script.js', '--unknown-flag', 'value', '--mode', 'inventory']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        mode: 'inventory',
      })
    })

    it('should parse all valid parameters', () => {
      const argv = [
        'node',
        'script.js',
        '--mode',
        'all',
        '--target',
        '1.0',
        '--repo',
        'https://github.com/org/repo',
        '--git-token',
        'ghp_abc123xyz',
        '--slack-token',
        'xoxb-slack-token',
        '--inventory-branch',
        'updates/scripts',
        '--detection-branch',
        'main',
      ]
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        mode: 'all',
        target: '1.0',
        repo: 'https://github.com/org/repo',
        gitToken: 'ghp_abc123xyz',
        slackToken: 'xoxb-slack-token',
        inventoryBranch: 'updates/scripts',
        detectionBranch: 'main',
      })
    })

    it('should handle file:// protocol URLs', () => {
      const argv = ['node', 'script.js', '--repo', 'file:///Users/dev/test-inventory']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        repo: 'file:///Users/dev/test-inventory',
      })
    })

    it('should handle flags at the end without values', () => {
      const argv = ['node', 'script.js', '--mode', 'inventory', '--help']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        mode: 'inventory',
        help: true,
      })
    })

    it('should handle URL values with query parameters', () => {
      const argv = ['node', 'script.js', '--repo', 'https://github.com/org/repo?param=value']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        repo: 'https://github.com/org/repo?param=value',
      })
    })

    it('should handle empty string values in key=value format', () => {
      const argv = ['node', 'script.js', '--mode=']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        mode: '',
      })
    })

    it('should skip invalid empty arguments', () => {
      const argv = ['node', 'script.js', '--mode', 'inventory', '', '--target', '1.0']
      const result = parseArguments(argv)

      expect(result).toEqual<RawCliArgs>({
        mode: 'inventory',
        target: '1.0',
      })
    })
  })
})
