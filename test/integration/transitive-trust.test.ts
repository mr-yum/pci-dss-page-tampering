/**
 * Trust inherited through loaders, end to end in real Chrome.
 *
 * Every page here loads a loader script that loads more scripts, and the
 * inventory decides what the loads inherit:
 *
 * - `/g/` — the loader is authorised and grants its loads transitively: the
 *   external asset it inserts is authorised by inheritance, with the chain
 *   recorded. The inline script it inserts never inherits (an inline load is
 *   judged on page-controlled evidence only); authorised by an entry of its
 *   own, it carries the walk, so the script it inserts in turn inherits. A
 *   load the inventory identifies and denies stays denied.
 * - `/p/` — the same grant on a loader whose bytes no longer match: the
 *   mismatched root poisons its subtree, so its asset is unknown.
 * - `/n/` — an authorised loader with no grant: its asset is unknown.
 * - `/i/` — an inline bootstrap in the page markup, authorised under an entry
 *   that declares a grant: the chain passes through the inline script, but an
 *   inline script never grants (its text at scan time is not necessarily the
 *   code that ran), so the loader it inserts stays unknown.
 * - `/h/` — a transitive `initiatorHostMatcher` identifies an asset by a host
 *   two hops up its chain; the same matcher capped at one hop does not.
 * - `/f/` — the granting loader runs inside a cross-site frame (`localhost`
 *   under a `127.0.0.1` page, so Chrome gives it a process and a DevTools
 *   session of its own): its asset still inherits.
 * - `/x/` — the shim is forgeable, and this proves it does not matter: page
 *   code overrides `WeakMap.prototype.get`/`has` so the attribution shim
 *   reports an inline script the page inserted itself as inserted by the
 *   authorised, granting loader. The forgery takes (the chain says so), and
 *   the inline script still does not inherit — even under a guard that would
 *   admit it by its content.
 *
 * Drives `main.ts` as a subprocess through one `--mode detection` run, one
 * workflow per page, against a file:// inventory. Needs the Chrome that
 * Puppeteer installs; CI's `npm ci` provides it.
 */

import { execFileSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as http from 'http'
import type { AddressInfo } from 'net'
import * as os from 'os'
import * as path from 'path'

import { createSha256Hash } from '../../src/utils/hash.js'

const MAIN_PATH = path.join(__dirname, '../../src/main.ts')
const TSX_BIN = path.join(__dirname, '../../node_modules/.bin/tsx')
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' }

/** A script that inserts each of `srcs` as an external script. */
const inserts = (...srcs: string[]): string => srcs.map((src) => `(function(){var s=document.createElement('script');s.src=${JSON.stringify(src)};document.head.appendChild(s)})();`).join('\n')

// The inline script /g/loader.js inserts, which inserts /g/deep.js in turn.
// Written without characters innerHTML would escape, so its body is its source.
const G_INLINE = `/*g-inline*/var d=document.createElement('script');d.src='/g/deep.js';document.head.appendChild(d)`
// The inline bootstrap in /i/'s markup.
const I_BOOT = `/*i-boot*/var b=document.createElement('script');b.src='/i/loader.js';document.head.appendChild(b)`

// Page code in /x/'s markup that forges the shim's record for an inline
// script it inserts, so the record names the granting loader as its inserter.
// The payload marker is split so this source does not contain it.
const X_FORGE = `/*x-forge*/(function(){
  var loader = new URL('/x/loader.js', location.href).href;
  var el = document.createElement('script');
  var get = WeakMap.prototype.get, has = WeakMap.prototype.has;
  var forged = { token: 'forged-1', kind: 'script', inserterToken: null, url: loader };
  WeakMap.prototype.has = function (key) { return key === el ? true : has.call(this, key) };
  WeakMap.prototype.get = function (key) { return key === el ? forged : get.call(this, key) };
  el.text = '/*x-pay' + 'load*/window.xPayload=1';
  document.head.appendChild(el);
})();`

const scripts = (frameOrigin: string): Record<string, string> => ({
  '/g/loader.js': `${inserts('/g/asset.js', '/g/denied.js')}\nvar t=document.createElement('script');t.text=${JSON.stringify(G_INLINE)};document.head.appendChild(t);`,
  '/g/asset.js': 'window.gAsset=1',
  '/g/denied.js': 'window.gDenied=1',
  '/g/deep.js': 'window.gDeep=1',
  '/p/loader.js': `${inserts('/p/asset.js')}\nwindow.tampered=1`,
  '/p/asset.js': 'window.pAsset=1',
  '/n/loader.js': inserts('/n/asset.js'),
  '/n/asset.js': 'window.nAsset=1',
  '/i/loader.js': inserts('/i/asset.js'),
  '/i/asset.js': 'window.iAsset=1',
  // Served from localhost, so its host differs from the page's and the mid script's.
  '/h/loader.js': inserts(`${frameOrigin.replace('localhost', '127.0.0.1')}/h/mid.js`),
  '/h/mid.js': inserts('/h/asset.js', '/h/asset-near.js'),
  '/h/asset.js': 'window.hAsset=1',
  '/h/asset-near.js': 'window.hAssetNear=1',
  '/f/loader.js': inserts('/f/asset.js'),
  '/f/asset.js': 'window.fAsset=1',
  '/x/loader.js': 'window.xLoader=1',
})

const page = (body: string): string => `<!doctype html><html><head></head><body><span>Ready</span>${body}</body></html>`

const pages = (frameOrigin: string): Record<string, string> => ({
  '/g/page': page('<script src="/g/loader.js"></script>'),
  '/p/page': page('<script src="/p/loader.js"></script>'),
  '/n/page': page('<script src="/n/loader.js"></script>'),
  '/i/page': page(`<script>${I_BOOT}</script>`),
  '/h/page': page(`<script src="${frameOrigin}/h/loader.js"></script>`),
  '/f/page': page(`<iframe src="${frameOrigin}/f/frame"></iframe>`),
  '/f/frame': page('<script src="/f/loader.js"></script>'),
  '/x/page': page(`<script src="/x/loader.js"></script><script>${X_FORGE}</script>`),
})

const startServer = (): Promise<http.Server> =>
  new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const url = (request.url ?? '/').split('?')[0]!
      const frameOrigin = `http://localhost:${(server.address() as AddressInfo).port}`
      const body = scripts(frameOrigin)[url]
      if (body !== undefined) return response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(body)
      const html = pages(frameOrigin)[url]
      if (html !== undefined) return response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(html)
      return response.writeHead(404).end()
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })

const AUTHORISED = { description: 'Fixture', authorised: true, date: '2026-10-01T00:00:00.000Z' }
const hashOf = (content: string) => [{ timestamp: '2026-10-01T00:00:00.000Z', hash: { value: createSha256Hash(content).value } }]
const exact = (urlPath: string, host = '127\\.0\\.0\\.1'): string => `^http://${host}:\\d+${urlPath.replaceAll('.', '\\.')}$`

// Every grant names what its loads may be: here, anything served by the fixture.
const LOADS = { nameMatcher: '^http://(127\\.0\\.0\\.1|localhost):\\d+/' }
// A guard that would admit /x/'s payload by its content: only the rule that an
// inline load never inherits stands between the forged record and inheritance.
const X_LOADS = { orMatcher: [LOADS, { contentMatcher: 'xPayload' }] }

const inventoryScripts = (frameOrigin: string) => {
  const bodies = scripts(frameOrigin)
  return [
    { identifyWith: { nameMatcher: exact('/g/loader.js') }, authoriseWith: { hashes: hashOf(bodies['/g/loader.js']!), authorisationInfo: AUTHORISED }, authorisesLoads: 'transitive', loadsMatching: LOADS },
    // The inline script /g/loader.js inserts, authorised on its own content: an inline load never inherits.
    { identifyWith: { contentMatcher: '^/\\*g-inline\\*/' }, authoriseWith: { hashes: hashOf(G_INLINE), authorisationInfo: AUTHORISED } },
    // Identified, and denied: an explicit verdict that inheritance must not overturn.
    { identifyWith: { nameMatcher: exact('/g/denied.js') }, authoriseWith: { hashes: hashOf('not these bytes'), authorisationInfo: AUTHORISED } },
    // The grant is real, but the loader's bytes are not the authorised ones.
    { identifyWith: { nameMatcher: exact('/p/loader.js') }, authoriseWith: { hashes: hashOf('the old loader'), authorisationInfo: AUTHORISED }, authorisesLoads: 'transitive', loadsMatching: LOADS },
    { identifyWith: { nameMatcher: exact('/n/loader.js') }, authoriseWith: { hashes: hashOf(bodies['/n/loader.js']!), authorisationInfo: AUTHORISED } },
    { identifyWith: { contentMatcher: '^/\\*i-boot\\*/' }, authoriseWith: { hashes: hashOf(I_BOOT), authorisationInfo: AUTHORISED }, authorisesLoads: 'direct', loadsMatching: LOADS },
    {
      identifyWith: { andMatcher: [{ nameMatcher: exact('/h/asset.js') }, { initiatorHostMatcher: { host: '^localhost:\\d+$', transitive: true } }] },
      authoriseWith: { nameMatcher: exact('/h/asset.js'), authorisationInfo: AUTHORISED },
    },
    {
      identifyWith: { andMatcher: [{ nameMatcher: exact('/h/asset-near.js') }, { initiatorHostMatcher: { host: '^localhost:\\d+$', transitive: true, maxDepth: 1 } }] },
      authoriseWith: { nameMatcher: exact('/h/asset-near.js'), authorisationInfo: AUTHORISED },
    },
    { identifyWith: { nameMatcher: exact('/f/loader.js', 'localhost') }, authoriseWith: { hashes: hashOf(bodies['/f/loader.js']!), authorisationInfo: AUTHORISED }, authorisesLoads: 'transitive', loadsMatching: LOADS },
    { identifyWith: { nameMatcher: exact('/x/loader.js') }, authoriseWith: { hashes: hashOf(bodies['/x/loader.js']!), authorisationInfo: AUTHORISED }, authorisesLoads: 'transitive', loadsMatching: X_LOADS },
  ]
}

const WORKFLOWS = ['g', 'p', 'n', 'i', 'h', 'f', 'x'] as const

const createFixtureRepo = (base: string, frameOrigin: string): string => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-transitive-trust-repo-'))
  fs.mkdirSync(path.join(repoPath, 'targets'))
  fs.mkdirSync(path.join(repoPath, 'workflows'))
  fs.writeFileSync(path.join(repoPath, 'workflows/wait.json'), JSON.stringify({ steps: [{ description: 'Page ready', waitFor: [{ type: 'span', identifier: 'Ready' }], action: { type: 'escape', delay: 1500 } }] }))
  const inventory = {
    target: {
      workflows: WORKFLOWS.map((id) => ({
        id,
        inventory: { type: 'inventory', name: `${id} staging`, url: `${base}/${id}/page`, workflow: 'wait.json' },
        detection: { type: 'detection', name: `${id} production`, url: `${base}/${id}/page`, workflow: 'wait.json' },
      })),
    },
    alerts: {
      inventory: { newScriptIdentified: { destination: '#i' }, newHeaderIdentified: { destination: '#i' } },
      detection: { newScriptDetected: { destination: '#d' }, scriptMismatchDetected: { destination: '#d' }, newHeaderDetected: { destination: '#d' } },
      successNotification: { destination: '#s' },
    },
    scripts: inventoryScripts(frameOrigin),
    headers: [],
  }
  fs.writeFileSync(path.join(repoPath, 'targets/shop.json'), JSON.stringify(inventory, null, 2))
  const git = (args: string[]) => execFileSync('git', args, { cwd: repoPath, env: gitEnv, stdio: 'ignore' })
  git(['init', '--initial-branch=main'])
  git(['add', '.'])
  git(['commit', '-m', 'fixture'])
  return repoPath
}

type Hop = { url: string; kind: string }
type Row = { name: string; status: string; observed: { initiatorChain?: Hop[] }; authorisation: { inherited?: { from: string; chain: Hop[]; mode: string } } }
type ReportTarget = { workflowId: string; scripts: Row[] }
type Report = { targets: ReportTarget[] }

describe('trust inherited through loaders, in real Chrome', () => {
  jest.setTimeout(300_000)
  let server: http.Server
  let repoPath: string
  let workDir: string
  let output = ''
  let report: Report

  beforeAll(async () => {
    server = await startServer()
    const port = (server.address() as AddressInfo).port
    repoPath = createFixtureRepo(`http://127.0.0.1:${port}`, `http://localhost:${port}`)
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-transitive-trust-cwd-'))
    const reportDir = path.join(workDir, 'reports')
    await new Promise<number | null>((resolve, reject) => {
      const args = [TSX_BIN, MAIN_PATH, '--mode', 'detection', '--repo', `file://${repoPath}`, '--git-token', 'dummy-token', '--report-dir', reportDir]
      const child = spawn('sh', ['-c', `${args.map((part) => `'${part}'`).join(' ')} 2>&1`], { env: { ...process.env, NODE_ENV: 'test' }, cwd: workDir })
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
      const timer = setTimeout(() => child.kill('SIGKILL'), 280_000)
      child.on('error', reject)
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    report = JSON.parse(fs.readFileSync(path.join(reportDir, 'detection', 'report.json'), 'utf8'))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const dir of [repoPath, workDir]) fs.rmSync(dir, { recursive: true, force: true })
  })

  const rows = (workflowId: string): Row[] => {
    const target = report.targets.find((candidate) => candidate.workflowId === workflowId)
    if (target === undefined) throw new Error(`no report target for ${workflowId}; run output:\n${output}`)
    return target.scripts
  }
  const row = (workflowId: string, suffix: string): Row => {
    const found = rows(workflowId).find((candidate) => candidate.name.endsWith(suffix))
    if (found === undefined) throw new Error(`no row ending ${suffix} for ${workflowId}: ${JSON.stringify(rows(workflowId).map((r) => r.name))}\n${output}`)
    return found
  }
  const inline = (workflowId: string, marker: string): Row => {
    // Inline rows are named by a generated id; find one by its content excerpt.
    const found = rows(workflowId).find((candidate) => candidate.name.startsWith('inline_script/') && JSON.stringify(candidate).includes(marker))
    if (found === undefined) throw new Error(`no inline row containing ${marker} for ${workflowId}: ${JSON.stringify(rows(workflowId))}`)
    return found
  }
  const paths = (chain: Hop[] | undefined): string[] => (chain ?? []).map((hop) => `${hop.kind}:${hop.url.startsWith('inline_script/') ? 'inline' : new URL(hop.url).pathname}`)

  it('authorises what an authorised, granting loader inserts — through an authorised inline hop, two hops deep — with the chain recorded', () => {
    expect(row('g', '/g/loader.js').status).toBe('authorised')
    expect(row('g', '/g/loader.js').authorisation.inherited).toBeUndefined()

    const asset = row('g', '/g/asset.js')
    expect(asset.status).toBe('authorised')
    expect(asset.authorisation.inherited).toEqual(expect.objectContaining({ mode: 'transitive' }))
    expect(paths(asset.observed.initiatorChain)).toEqual(['script:/g/loader.js', 'document:/g/page'])

    // Authorised by its own entry, never by the grant.
    const inserted = inline('g', 'g-inline')
    expect(inserted.status).toBe('authorised')
    expect(inserted.authorisation.inherited).toBeUndefined()
    expect(paths(inserted.observed.initiatorChain)).toEqual(['script:/g/loader.js', 'document:/g/page'])

    // The external script the inline script inserted: its network initiator
    // names no script (the inline script has no URL), so the chain passes
    // through the inline hop the attribution shim recorded.
    const deep = row('g', '/g/deep.js')
    expect(deep.status).toBe('authorised')
    expect(paths(deep.observed.initiatorChain)).toEqual(['script:inline', 'script:/g/loader.js', 'document:/g/page'])
    expect(paths(deep.authorisation.inherited?.chain)).toEqual(['script:inline', 'script:/g/loader.js'])
  })

  it('never overturns an explicit denial: a load the inventory identifies and denies stays denied', () => {
    expect(row('g', '/g/denied.js').status).toBe('unauthorised_content')
  })

  it('poisons the subtree of a granting loader whose bytes no longer match', () => {
    expect(row('p', '/p/loader.js').status).toBe('unauthorised_content')
    expect(row('p', '/p/asset.js').status).toBe('unknown')
    expect(paths(row('p', '/p/asset.js').observed.initiatorChain)).toEqual(['script:/p/loader.js', 'document:/p/page'])
  })

  it('grants nothing from an authorised loader that does not declare authorisesLoads', () => {
    expect(row('n', '/n/loader.js').status).toBe('authorised')
    expect(row('n', '/n/asset.js').status).toBe('unknown')
  })

  it('passes the chain through an inline bootstrap in the markup, which never grants', () => {
    expect(inline('i', 'i-boot').status).toBe('authorised')
    const loader = row('i', '/i/loader.js')
    expect(loader.status).toBe('unknown')
    expect(paths(loader.observed.initiatorChain)).toEqual(['script:inline', 'document:/i/page'])

    const asset = row('i', '/i/asset.js')
    expect(asset.status).toBe('unknown')
    expect(paths(asset.observed.initiatorChain)).toEqual(['script:/i/loader.js', 'script:inline', 'document:/i/page'])
  })

  it('identifies a script by a host further up its chain with a transitive initiatorHostMatcher, within its maxDepth only', () => {
    const asset = row('h', '/h/asset.js')
    expect(asset.status).toBe('authorised')
    expect(asset.authorisation.inherited).toBeUndefined()
    expect(asset.observed.initiatorChain?.map((hop) => new URL(hop.url).hostname)).toEqual(['127.0.0.1', 'localhost', '127.0.0.1'])
    expect(row('h', '/h/asset-near.js').status).toBe('unknown')
  })

  it('carries the grant across a cross-site frame running in its own process', () => {
    expect(row('f', '/f/loader.js').status).toBe('authorised')
    const asset = row('f', '/f/asset.js')
    expect(asset.status).toBe('authorised')
    expect(asset.authorisation.inherited).toBeDefined()
    expect(asset.observed.initiatorChain?.map((hop) => `${hop.kind}:${new URL(hop.url).hostname}${new URL(hop.url).pathname}`)).toEqual(['script:localhost/f/loader.js', 'document:localhost/f/frame'])
  })

  it('never lets an inline load inherit, even when page code forges the shim into naming the granting loader as its inserter', () => {
    expect(row('x', '/x/loader.js').status).toBe('authorised')
    const payload = inline('x', 'x-payload')
    // The forgery took: the shim reported the granting loader as the inserter.
    expect(paths(payload.observed.initiatorChain)).toEqual(['script:/x/loader.js', 'document:/x/page'])
    expect(payload.status).toBe('unknown')
    expect(payload.authorisation.inherited).toBeUndefined()
  })
})
