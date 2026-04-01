import type { RawCliArgs } from '../types/cli.js'

/**
 * Native process.argv parser
 * Handles both --key value and --key=value formats
 *
 * @param argv - Command-line arguments from process.argv
 * @returns Parsed raw arguments (unvalidated)
 */
export function parseArguments(argv: string[]): RawCliArgs {
  const args: RawCliArgs = {}

  // Skip first two arguments (node executable and script path)
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]

    if (!arg) continue

    // Handle --help flag
    if (arg === '--help' || arg === '-h') {
      args.help = true
      continue
    }

    // Handle --key=value format
    if (arg.includes('=')) {
      const [key, ...valueParts] = arg.split('=')
      const value = valueParts.join('=') // Rejoin in case value contains '='

      if (!key) continue

      const normalizedKey = normalizeKey(key)
      if (normalizedKey) {
        setArgValue(args, normalizedKey, value)
      }
      continue
    }

    // Handle --key value format
    if (arg.startsWith('--')) {
      const key = normalizeKey(arg)
      if (!key) continue

      // Check if next argument is a value (not another flag)
      const nextArg = argv[i + 1]
      if (nextArg && !nextArg.startsWith('--')) {
        setArgValue(args, key, nextArg)
        i++ // Skip next argument as it's the value
      } else {
        // Flag without value (treat as boolean true)
        if (key === 'help') {
          args.help = true
        }
      }
      continue
    }
  }

  return args
}

/**
 * Normalize key from --key or --key-name format to camelCase
 * Converts: --mode -> mode, --git-token -> gitToken, --inventory-branch -> inventoryBranch
 */
function normalizeKey(key: string): keyof RawCliArgs | null {
  // Remove leading dashes
  const cleaned = key.replace(/^--?/, '')

  if (!cleaned) return null

  // Convert kebab-case to camelCase
  const camelCase = cleaned.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())

  // Map to valid RawCliArgs keys
  const validKeys: (keyof RawCliArgs)[] = ['mode', 'target', 'repo', 'gitToken', 'slackToken', 'inventoryBranch', 'detectionBranch', 'gitUserName', 'gitUserEmail', 'help']

  if (validKeys.includes(camelCase as keyof RawCliArgs)) {
    return camelCase as keyof RawCliArgs
  }

  return null
}

/**
 * Set argument value in RawCliArgs object
 */
function setArgValue(args: RawCliArgs, key: keyof RawCliArgs, value: string): void {
  if (key === 'help') {
    args[key] = true
  } else {
    ;(args as any)[key] = value
  }
}
