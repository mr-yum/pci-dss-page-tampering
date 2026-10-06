/**
 * The RUM agent's initiator chains, in real Chrome.
 *
 * jsdom never executes scripts, so the agent unit tests cannot show what
 * matters most here: inserting an inline script runs it synchronously INSIDE
 * the `appendChild` call, so whatever it inserts has to find the inline
 * script's chain already recorded — which is why the insertion patch records
 * a chain before calling through. This bundles the real agent with esbuild,
 * serves it on a page whose loader inserts an inline script that inserts a
 * further script (the tag-manager pattern), lets the page hide so the agent
 * flushes, and validates what arrives with the real beacon schema.
 */

import { execFileSync, spawn } from 'child_process'
import * as http from 'http'
import type { AddressInfo } from 'net'
import * as path from 'path'

import { type Beacon, parseBeacon } from '../../src/types/beacon.js'

const ESBUILD = path.join(__dirname, '../../node_modules/.bin/esbuild')
const AGENT_ENTRY = path.join(__dirname, '../../agent/src/agent.ts')

const INNER = `var p=document.createElement('script');p.src='/tags/pixel.js';document.head.appendChild(p)`
const SCRIPTS: Record<string, string> = {
  '/tags/loader.js': `var i=document.createElement('script');i.text=${JSON.stringify(INNER)};document.head.appendChild(i);var a=document.createElement('script');a.src='/tags/asset.js';document.head.appendChild(a)`,
  '/tags/pixel.js': 'window.pixel=1',
  '/tags/asset.js': 'window.asset=1',
}

describe('RUM agent initiator chains in real Chrome', () => {
  jest.setTimeout(60_000)
  let server: http.Server
  const beacons: Beacon[] = []

  beforeAll(async () => {
    const agent = execFileSync(ESBUILD, [AGENT_ENTRY, '--bundle', '--format=iife', '--target=es2020'], { encoding: 'utf8' })
    server = http.createServer((request, response) => {
      const url = (request.url ?? '/').split('?')[0]!
      if (url === '/collect') {
        let body = ''
        request.on('data', (chunk) => (body += chunk))
        request.on('end', () => {
          const parsed = parseBeacon(body)
          if (parsed.ok) beacons.push(parsed.beacon)
          else beacons.push({ invalid: parsed.detail } as unknown as Beacon)
          response.writeHead(204).end()
        })
        return
      }
      if (url === '/agent.js') return response.writeHead(200, { 'content-type': 'text/javascript' }).end(agent)
      if (SCRIPTS[url] !== undefined) return response.writeHead(200, { 'content-type': 'text/javascript' }).end(SCRIPTS[url])
      if (url === '/checkout')
        return response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><head><script src="/agent.js" data-collector="/collect"></script><script src="/tags/loader.js"></script></head><body>Pay</body></html>')
      if (url === '/done') return response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><body>Done</body></html>')
      return response.writeHead(404).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    // Puppeteer is ESM-only, so the browser is driven from a child process
    // while this process keeps serving. Leaving the page hides it: the agent
    // flushes its beacons. Launched with the same flags as main.ts: CI's
    // container has no usable Chrome sandbox, and the page is a local fixture.
    const drive = `import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
const page = await browser.newPage()
await page.goto(process.argv[1] + '/checkout?order=secret-42', { waitUntil: 'networkidle0' })
await page.goto(process.argv[1] + '/done', { waitUntil: 'networkidle0' })
await browser.close()`
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', drive, base], { cwd: path.join(__dirname, '../..'), stdio: 'inherit' })
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`browser driver exited ${code}`))))
    })
    const deadline = Date.now() + 10_000
    while (beacons.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const observations = () => beacons.flatMap((beacon) => beacon.observations ?? [])
  const chainOf = (suffix: string) => {
    const found = observations().find((observation) => observation.kind === 'external-script' && observation.url.endsWith(suffix))
    if (found === undefined || found.kind !== 'external-script') throw new Error(`no observation for ${suffix}: ${JSON.stringify(beacons)}`)
    return (found.initiatorChain ?? []).map((hop) => `${hop.kind}:${hop.url.startsWith('inline_script/') ? 'inline' : new URL(hop.url).pathname}`)
  }

  it('sends only schema-valid v2 beacons', () => {
    expect(beacons.length).toBeGreaterThan(0)
    for (const beacon of beacons) expect(beacon.v).toBe(2)
  })

  it('passes a chain through an inline script inserted (and so executed) inside appendChild', () => {
    expect(chainOf('/tags/pixel.js')).toEqual(['script:inline', 'script:/tags/loader.js', 'unknown:/checkout'])
  })

  it('records the loader for what it inserts directly, and never puts the page query on the wire', () => {
    expect(chainOf('/tags/asset.js')).toEqual(['script:/tags/loader.js', 'unknown:/checkout'])
    expect(JSON.stringify(observations().map((observation) => ('initiatorChain' in observation ? observation.initiatorChain : [])))).not.toContain('secret-42')
  })
})
