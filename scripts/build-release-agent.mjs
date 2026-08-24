// Builds the browser agent bundle with a release version injected.
//
// The dev build (`npm run build:agent`) leaves `__AGENT_VERSION__` undefined,
// so the bundle falls back to '0.0.0' (see agent/src/agent.ts). Release
// artefacts must report the real tag version in every beacon
// (`session.agentVersion`), so this script runs the same esbuild invocation
// with `define: { __AGENT_VERSION__ }` added. Keep the build options in sync
// with the `build:agent` script in package.json.
//
// usage: node scripts/build-release-agent.mjs <X.Y.Z>
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { build } from 'esbuild'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node scripts/build-release-agent.mjs <X.Y.Z>')
  console.error('The version must be plain semver with no leading "v" — the beacon schema rejects anything else.')
  process.exit(1)
}

const outfile = 'dist/agent/agent.js'

await build({
  entryPoints: ['agent/src/agent.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outfile,
  define: { __AGENT_VERSION__: JSON.stringify(version) },
})

// Same output format as scripts/print-sri.mjs, so callers can parse either.
const digest = createHash('sha384').update(readFileSync(outfile)).digest('base64')
console.log(`SRI: sha384-${digest}`)
