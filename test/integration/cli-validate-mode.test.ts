/**
 * Integration tests for `--mode validate`.
 *
 * Validate mode runs the full deserialization pipeline (Zod + createMatcher() +
 * workflow file resolution) against a local checkout, then exits. These tests
 * cover CLI argument acceptance plus end-to-end fixtures exercising the happy
 * path and two representative failure modes.
 */

import { execFileSync, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const MAIN_PATH = path.join(__dirname, '../../src/main.ts')
const PROJECT_ROOT = path.join(__dirname, '../..')
const TSX_BIN = path.join(PROJECT_ROOT, 'node_modules/.bin/tsx')

/**
 * Runs the CLI in the given working directory. The tool hard-codes its clone
 * target to `./pulled_repo`; giving each test its own cwd means concurrent runs
 * can't stomp on each other's clone state.
 */
const executeCli = (args: string[], cwd: string = PROJECT_ROOT) =>
  spawnSync(TSX_BIN, [MAIN_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
    cwd,
  })

/**
 * Build a minimal inventory JSON that exercises both a script and a header entry
 * with nested composite matchers, so createMatcher() runs on a non-trivial tree.
 */
const validInventoryPayload = {
  target: {
    inventory: {
      type: 'inventory',
      url: 'https://example.com/checkout',
      workflow: 'checkout.json',
    },
    detection: {
      type: 'detection',
      url: 'https://example.com/checkout',
      workflow: 'checkout.json',
    },
  },
  alerts: {
    inventory: {
      newScriptIdentified: { destination: '#pci-alerts' },
      newHeaderIdentified: { destination: '#pci-alerts' },
    },
    detection: {
      newScriptDetected: { destination: '#pci-alerts' },
      scriptMismatchDetected: { destination: '#pci-alerts' },
      newHeaderDetected: { destination: '#pci-alerts' },
    },
    successNotification: { destination: '#pci-success' },
  },
  scripts: [
    {
      identifyWith: { nameMatcher: '^https://example\\.com/app\\.js$' },
      authoriseWith: {
        hashes: [{ timestamp: '2025-01-01T00:00:00.000Z', hash: { value: 'a'.repeat(64) } }],
        authorisationInfo: {
          description: 'app script',
          authorised: true,
          date: '2025-01-01T00:00:00.000Z',
        },
      },
    },
  ],
  headers: [
    {
      identifyWith: { headerNameMatcher: '^content-security-policy$' },
      authoriseWith: {
        andMatcher: [{ contentMatcher: "default-src\\s+'self'" }, { contentMatcher: "object-src\\s+'none'" }],
        authorisationInfo: {
          description: 'CSP requires self + no objects',
          authorised: true,
          date: '2025-01-01T00:00:00.000Z',
        },
      },
    },
  ],
}

/**
 * Creates a temporary bare-working-tree git repo with `targets/` and `workflows/`
 * populated by `mutator`, commits the state to `main`, and returns the repo path.
 * Caller is responsible for cleaning up and for removing `./pulled_repo`.
 */
const createFixtureRepo = (mutator: (repoPath: string) => void): string => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-validate-'))
  fs.mkdirSync(path.join(repoPath, 'targets'))
  fs.mkdirSync(path.join(repoPath, 'workflows'))
  // Git doesn't track empty directories; seed workflows/.gitkeep so the folder
  // still exists after clone when a test intentionally omits workflow files.
  // targets/ always gets at least one inventory file from the mutator, and the
  // tool iterates every file there — so no .gitkeep in targets/ (it would be
  // parsed as JSON and fail).
  fs.writeFileSync(path.join(repoPath, 'workflows/.gitkeep'), '')
  mutator(repoPath)

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  }
  const run = (args: string[]) => execFileSync('git', args, { cwd: repoPath, env: gitEnv, stdio: 'ignore' })
  run(['init', '--initial-branch=main'])
  run(['add', '.'])
  run(['commit', '-m', 'fixture'])
  return repoPath
}

describe('CLI --mode validate integration tests', () => {
  describe('CLI argument acceptance', () => {
    it('documents validate in --help', () => {
      const result = executeCli(['--help'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('validate')
      expect(result.stdout).toMatch(/Validate Mode|validate.*deserialize|--mode validate/i)
    })

    it('accepts --mode validate with file:// repo and no --git-token', () => {
      // Make a unique path then immediately remove it so the clone is guaranteed to fail
      // with an execution error (exit 2). Exit 1 here would mean the schema is still
      // enforcing --git-token.
      const missingRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-validate-missing-'))
      fs.rmSync(missingRepoPath, { recursive: true, force: true })

      const result = executeCli(['--mode', 'validate', '--repo', `file://${missingRepoPath}`])

      expect(result.status).toBe(2)
      expect(result.stderr).not.toContain('Git token is required')
    })

    it('still rejects non-validate modes that omit --git-token', () => {
      const result = executeCli(['--mode', 'inventory', '--repo', 'file:///tmp/pci-validate-nonexistent'])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Git token is required')
    })

    it('requires --git-token for validate mode against https:// repos', () => {
      const result = executeCli(['--mode', 'validate', '--repo', 'https://github.com/org/inventory'])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Git token is required')
    })
  })

  describe('End-to-end against fixture repos', () => {
    let repoPath: string | null = null
    let sandboxPath: string | null = null

    afterEach(() => {
      if (repoPath) {
        fs.rmSync(repoPath, { recursive: true, force: true })
        repoPath = null
      }
      if (sandboxPath) {
        fs.rmSync(sandboxPath, { recursive: true, force: true })
        sandboxPath = null
      }
    })

    const newSandbox = (): string => {
      sandboxPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-validate-cwd-'))
      return sandboxPath
    }

    it('exits 0 for a valid inventory repo', () => {
      repoPath = createFixtureRepo((root) => {
        fs.writeFileSync(path.join(root, 'targets/1.0.json'), JSON.stringify(validInventoryPayload, null, 2))
        fs.writeFileSync(path.join(root, 'workflows/checkout.json'), JSON.stringify({ steps: [] }))
      })

      const result = executeCli(['--mode', 'validate', '--repo', `file://${repoPath}`, '--inventory-branch', 'main'], newSandbox())

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Successfully validated 1 inventory file(s)')
      expect(result.stdout).toContain('1.0.json')
    })

    it('exits 2 with file context when a matcher regex is malformed', () => {
      const payload = structuredClone(validInventoryPayload) as typeof validInventoryPayload
      payload.scripts[0]!.identifyWith = { nameMatcher: '^https://example\\.com/[' }

      repoPath = createFixtureRepo((root) => {
        fs.writeFileSync(path.join(root, 'targets/1.0.json'), JSON.stringify(payload, null, 2))
        fs.writeFileSync(path.join(root, 'workflows/checkout.json'), JSON.stringify({ steps: [] }))
      })

      const result = executeCli(['--mode', 'validate', '--repo', `file://${repoPath}`, '--inventory-branch', 'main'], newSandbox())

      // Inventory-file Zod failures are re-thrown as plain Errors with file context,
      // so they fall into the ExecutionError branch (exit 2), not ZodError (exit 1).
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('1.0.json')
      expect(result.stderr).toMatch(/Invalid regex|nameMatcher/i)
    })

    it('exits 2 when an inventory references a non-existent workflow file', () => {
      repoPath = createFixtureRepo((root) => {
        fs.writeFileSync(path.join(root, 'targets/1.0.json'), JSON.stringify(validInventoryPayload, null, 2))
        // workflows/ exists via createFixtureRepo(); the .gitkeep keeps the empty directory in the commit.
        // The inventory still references workflows/checkout.json, which is absent.
      })

      const result = executeCli(['--mode', 'validate', '--repo', `file://${repoPath}`, '--inventory-branch', 'main'], newSandbox())

      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/ENOENT|checkout\.json/i)
    })
  })
})
