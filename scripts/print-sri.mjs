// Prints the Subresource Integrity hash (sha384, base64) of a file.
// Used by `npm run build:agent` so the pinned agent bundle hash is
// available straight from the build output.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/print-sri.mjs <file>')
  process.exit(1)
}

const digest = createHash('sha384').update(readFileSync(file)).digest('base64')
console.log(`SRI: sha384-${digest}`)
