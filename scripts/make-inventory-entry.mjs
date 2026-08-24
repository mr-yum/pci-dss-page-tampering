// Generates the ready-to-paste inventory entry for a released agent bundle.
//
// Run via tsx, not plain node — the script validates its own output against
// the real inventory schema, which lives in TypeScript:
//
//   npx tsx scripts/make-inventory-entry.mjs dist/agent/agent.js 1.2.3
//
// The entry deliberately ships `authorised: false`: the adopter pastes it
// into their inventory repository, reviews it (point the REPLACE-ME
// nameMatcher at the URL they actually serve the agent from, confirm the
// hash matches the bundle they deployed), and only then flips `authorised`
// to true. Shipping it pre-authorised would make "paste without review" the
// path of least resistance. The inventory schema is strict, so the review
// instruction lives in the description — a bespoke `comment` key would fail
// `--mode validate`.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { RawInventoryScriptInfoSchema } from '../src/types/inventory/zod.js'

const [file, version] = process.argv.slice(2)
if (!file || !version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: npx tsx scripts/make-inventory-entry.mjs <agent-bundle.js> <X.Y.Z>')
  process.exit(1)
}

const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
const buildTime = new Date().toISOString()
const escapedVersion = version.replaceAll('.', '\\.')

const entry = {
  identifyWith: {
    // REPLACE-ME: anchor this to the exact URL you serve the agent from.
    nameMatcher: `^https://static\\.example\\.com/REPLACE-ME/agent-v${escapedVersion}\\.js$`,
  },
  authoriseWith: {
    hashes: [{ timestamp: buildTime, hash: { value: sha256 } }],
    authorisationInfo: {
      description: `pci-dss-page-tampering RUM agent v${version}, sha256-pinned release bundle. REPLACE-ME: point nameMatcher at the URL you serve the agent from, verify the hash against the bundle you deployed, then set authorised to true.`,
      authorised: false,
      date: buildTime,
    },
  },
  // The agent must be present on both passes: its absence from a payment
  // page is the 11.6.1 self-defeat signal (missing_required_script).
  requiredOn: ['inventory', 'detection'],
}

const parsed = RawInventoryScriptInfoSchema.safeParse(entry)
if (!parsed.success) {
  console.error('Generated entry failed inventory schema validation:')
  console.error(JSON.stringify(parsed.error.issues, null, 2))
  process.exit(1)
}

process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`)
