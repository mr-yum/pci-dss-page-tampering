export const meta = {
  name: 'branch-review',
  description: 'Review a diff with parallel dimension reviewers, then adversarially verify every finding',
  whenToUse: 'Pre-commit / pre-PR review of a branch or commit range in the pci-dss-page-tampering repo',
  phases: [
    { title: 'Find', detail: 'one reviewer per dimension, reading the diff and its surroundings' },
    { title: 'Verify', detail: 'adversarial refutation — each surviving finding must resist attack' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs, via the Workflow tool's `args` (an OBJECT, not a JSON string):
//   scope   — REQUIRED. Git diff range or single commit, e.g. "origin/main...HEAD".
//   files   — REQUIRED. Repo-relative paths the scope touches, from
//             `git diff --name-only <scope>`. Doubles as the in-scope allowlist.
//   depth   — "standard" (1 verifier per finding) or "deep" (3, diverse lenses).
//   focus   — extra instruction appended to every reviewer's brief.
//   maxVerify — cap on findings carried into verification (default 12).
//
// scope and files are required TOGETHER and on purpose. A reviewer handed a
// scope that resolves to nothing does not stop — it goes looking for something
// else to review, and reports findings against code the user never touched.
// (Observed upstream, not theorised: the first run of this workflow reviewed
// three unrelated commits that way.) The file list makes "nothing to review" a
// fact the script can act on, and gives the findings a deterministic filter.
// ---------------------------------------------------------------------------
const input = typeof args === 'string' ? JSON.parse(args) : args || {}
const scope = input.scope
const files = input.files || []
const depth = input.depth || 'standard'
const focus = input.focus || ''
const maxVerify = input.maxVerify || 12
const voters = depth === 'deep' ? 3 : 1

if (!scope) throw new Error('branch-review: args.scope is required (e.g. "origin/main...HEAD"). Pass args as an object, not a JSON string.')
if (!Array.isArray(files) || files.length === 0) {
  log(`No files in scope for ${scope} — nothing to review. (Resolve the scope and pass args.files from \`git diff --name-only ${scope}\`.)`)
  return { scope: scope, depth: depth, reviewed: [], failed_dimensions: [], files_in_scope: 0, raw_count: 0, off_scope_discarded: 0, unverified_count: 0, findings: [], empty_scope: true }
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string', description: 'repo-relative path' },
          line: { type: 'integer', description: '1-indexed line in the post-change file' },
          category: { type: 'string', description: 'kebab-case slug, e.g. correctness, fail-secure, test-coverage' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          summary: { type: 'string', description: 'one sentence stating the defect' },
          failure_scenario: { type: 'string', description: 'concrete inputs/state -> wrong output, in one or two sentences' },
          evidence: { type: 'string', description: 'what you read that proves it — file:line references, not reasoning' },
        },
        required: ['file', 'line', 'category', 'severity', 'summary', 'failure_scenario', 'evidence'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding does NOT hold up' },
    reason: { type: 'string', description: 'what you checked and what you concluded' },
    correction: { type: 'string', description: 'if the finding is real but mis-stated, the accurate statement; else empty' },
  },
  required: ['refuted', 'reason'],
}

// The shared contract. Every reviewer reads the diff itself — the point of the
// fan-out is independent eyes, not a shared summary they all inherit.
const BASE = `You are reviewing a change in the pci-dss-page-tampering codebase: a TypeScript /
Node 24 / native-ESM Puppeteer monitor implementing PCI DSS 6.4.3 (script inventory) and 11.6.1
(tamper detection/alerting) for payment pages. It compares scripts and headers detected on live
pages against a Git-stored inventory of matchers, and alerts on violations. A bug that makes it
silently authorize something is worse than a bug that makes it crash.

THE REVIEW SCOPE IS EXACTLY THIS DIFF: \`git diff ${scope}\`

It touches these ${files.length} files, and no others:
${files.map((f) => `  - ${f}`).join('\n')}

Run that exact command — do not substitute another range, do not review HEAD, the working tree,
or recent commits, and do not go looking for a different change to review. If the command prints
nothing, something is wrong with the scope: return an empty findings list and say so. Reviewing
code the user did not change is the single worst outcome of this job; findings outside the file
list above are discarded before they reach anyone.

Then read:
${scope.includes('..') ? `- \`git log --oneline ${scope}\` for the commit story` : '- (uncommitted work — there is no commit story to read; do not run git log on this scope)'}
- CLAUDE.md — it is the project's written rulebook (architecture, matcher semantics, behaviours)
- the surrounding code of anything you flag — the diff alone rarely proves a defect. Reading
  outside the file list is expected and encouraged; REPORTING outside it is not.

Rules of engagement:
- Report DEFECTS IN THIS DIFF. Pre-existing problems the diff merely touches are out of
  scope unless the change makes them reachable or worse.
- Every finding needs a concrete failure scenario: inputs or state -> wrong behaviour.
  "This could be confusing" or "consider extracting" is not a finding.
- Verify before you report. Read the callers, the tests, the types. If you cannot show
  the defect from what you read, drop it.
- No style nitpicks (Prettier and ESLint own formatting), no praise, no summary of the
  change. Findings only.
- An empty findings list is a fine and common answer. Do not invent work.

${focus ? `Additional instruction from the reviewer: ${focus}\n` : ''}
Your assigned dimension:
`

const DIMENSIONS = [
  {
    key: 'correctness',
    brief: `Logic defects in the changed code. Boundary conditions, null/undefined/empty paths,
off-by-one, inverted conditions, wrong operator precedence, unawaited or floating promises,
async races (Puppeteer page events vs navigation, listeners attached after the events they need),
early returns that skip required work, exceptions that escape or are swallowed, regexes that do
not match what the author assumed (escaping, anchoring, case sensitivity). Trace each changed
function end to end with a hostile example.`,
  },
  {
    key: 'integration',
    brief: `Blast radius beyond the diff. Every caller of a changed function or signature — grep for
callers, do not assume the diff shows them all. The lockstep chains this repo depends on: a new or
changed matcher type must land together in the Zod inventory schema, createMatcher(), serialization,
and docs; a new workflow step type must be wired through the step-to-PuppeteerLocatorAction
conversion; a new comparison result or alert category must be handled by InventoryService's
discriminated-union switch and the alert service. Matcher pipeline ordering: identification is
first-match-wins over inventory entries, so a reordered or broadened identifyWith can shadow a
stricter entry below it. ESM: relative imports must carry explicit .js extensions — Jest's
moduleNameMapper hides a missing extension, so tests pass while the built app breaks at runtime.`,
  },
  {
    key: 'conventions',
    brief: `Adherence to this project's stated rules, and only rules that are actually written down in
CLAUDE.md. High-value ones: configuration is CLI-parameters-only — no new environment variables for
execution config; relative imports carry explicit .js extensions, CommonJS config files use .cjs;
inline-script classifiers in src/utils/script/inline.ts are tech-generic only (framework/vendor
snippets with cited evidence in the matcher's comment) — anything site-specific belongs in the
target's inventory entry; ContentMatcher matches actual content, never the URL (URL matching is
NameMatcher/UrlMatcher/HostMatcher); NameMatcher is case-sensitive, HeaderNameMatcher is
case-insensitive per RFC 7230 — do not let a change blur that distinction. Quote the rule you are
applying. If it is not written down, it is not a finding.`,
  },
  {
    key: 'tests',
    brief: `Test coverage and test correctness for this change. Behaviour changed with no unit or
integration test that would catch a regression; tests that assert the mock rather than the
behaviour; time-dependent tests not pinned with Jest fake timers (TOTP windows, hash timestamps,
date-template resolution — they pass all day and flake on a boundary); fail-secure paths tested
only on the happy path (a matcher test suite that never feeds null/empty content or a missing url
is not testing the property that matters); tests that hit the network or a real browser from the
unit suite. Jest 30 with @swc/jest; moduleNameMapper strips .js extensions in tests.`,
  },
  {
    key: 'docs',
    brief: `Documentation obligations this repo attaches to change, per CLAUDE.md. User-facing
changes (CLI parameters, exit codes, execution modes, workflow step types, waitFor selector types,
inventory schema shapes) must update README.md and the CLI --help text in lockstep; changes to the
matcher system, services, comparison results, or build system must keep CLAUDE.md's corresponding
sections accurate — stale CLAUDE.md guidance misleads every future reviewer and agent. New matcher
examples in docs must be valid against the actual Zod schema. Check what the diff does, then check
whether its documentation obligation was met; name the specific file and section that needs the
update.`,
  },
  {
    key: 'security',
    brief: `Fail-secure and secret hygiene — this tool is itself a PCI DSS control, so a silent-allow
bug is the worst defect class it can have. Fail-secure: null/empty script content must yield
UnknownScriptFound, never a match; HostMatcher/UrlMatcher must fail when Matchable.url is missing or
unparseable; empty composite matcher arrays must be rejected; generated matchers must never widen to
a universal match. Regex laxity: an unanchored or under-escaped pattern in a matcher (or in matcher
generation) that an attacker-controlled URL, host, or script body could satisfy — e.g. an unescaped
dot or missing anchors letting evil-example.com match example.com. Mode boundaries: detection mode
must remain read-only against the inventory; alerts must not be silently swallowed on error. Secrets:
TOTP seeds, --git-token, and --slack-token must never be committed, logged, or included in alerts;
URLs in block logs stay redacted. Anything user- or page-supplied reaching a shell, a Git command,
or an alert unescaped.`,
  },
]

phase('Find')
log(`Reviewing ${scope} across ${DIMENSIONS.length} dimensions (${depth}).`)

// Barrier is deliberate: the dedupe below needs every reviewer's findings at
// once, and verification is the expensive half — better to spend it on a
// deduped list than on six copies of the same finding.
const rounds = await parallel(DIMENSIONS.map((d) => () => agent(BASE + d.brief, { label: `find:${d.key}`, phase: 'Find', schema: FINDINGS_SCHEMA }).then((r) => ({ key: d.key, ok: !!(r && r.findings), findings: (r && r.findings) || [] }))))

// A dead reviewer is a coverage hole, not a clean pass. Name it — in the log
// AND in the return value — or "no findings" reads as "reviewed and clean".
const completedRounds = rounds.filter(Boolean)
const failedDimensions = DIMENSIONS.map((d) => d.key).filter((k) => !completedRounds.some((r) => r.key === k && r.ok))
if (failedDimensions.length > 0) {
  log(`WARNING: ${failedDimensions.length} dimension reviewer(s) died and produced nothing: ${failedDimensions.join(', ')}. Their coverage is MISSING, not clean.`)
}
const reviewedDimensions = DIMENSIONS.map((d) => d.key).filter((k) => !failedDimensions.includes(k))

const raw = []
const offScope = []
const inScope = new Set(files)
completedRounds.forEach((r) => {
  r.findings.forEach((f) => {
    const finding = Object.assign({}, f, { dimension: r.key })
    // The prompt says in-scope only; this is what makes it true. A finding
    // against a file the diff never touched is not a finding, however good.
    if (inScope.has(f.file)) raw.push(finding)
    else offScope.push(finding)
  })
})

if (offScope.length > 0) {
  log(`Discarded ${offScope.length} finding(s) against files outside the diff: ${offScope.map((f) => f.file).join(', ')}`)
}

// Sort BEFORE deduping so a collision keeps the highest-severity phrasing —
// dedupe-then-sort let an early low-severity duplicate shadow a later high one.
const RANK = { high: 0, medium: 1, low: 2 }
raw.sort((a, b) => (RANK[a.severity] || 3) - (RANK[b.severity] || 3))

const seen = new Set()
const deduped = raw.filter((f) => {
  const key = `${f.file}:${f.line}:${f.category}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})
if (deduped.length < raw.length) log(`Deduped ${raw.length - deduped.length} duplicate finding(s) reported by multiple dimensions (kept the highest-severity phrasing of each).`)

if (deduped.length === 0) {
  log('No findings survived the reviewers. Nothing to verify.')
  return { scope: scope, depth: depth, reviewed: reviewedDimensions, failed_dimensions: failedDimensions, files_in_scope: files.length, raw_count: raw.length, off_scope_discarded: offScope.length, unverified_count: 0, findings: [] }
}

const toVerify = deduped.slice(0, maxVerify)
const dropped = deduped.length - toVerify.length
if (dropped > 0) log(`Verifying the top ${toVerify.length} of ${deduped.length} findings — ${dropped} lower-severity findings NOT verified.`)
else log(`${toVerify.length} distinct findings (from ${raw.length} raw). Verifying each.`)

// Diverse lenses beat redundancy: three verifiers asking the same question find
// the same blind spot three times.
const LENSES = [
  'Reproduce it. Walk the exact code path with the stated inputs and say what actually happens at each step.',
  'Check the guards. Something else in the system may already prevent this — a Zod schema rejection, a fail-secure branch, a type constraint, a caller that never passes that input. Find it or confirm its absence.',
  'Check the claim itself. Is the finding describing the code as it is after this diff, or as the reviewer imagined it? Re-read the actual lines.',
]

phase('Verify')
const verified = await parallel(
  toVerify.map(
    (f) => () =>
      parallel(
        Array.from(
          { length: voters },
          (unused, i) => () =>
            agent(
              `Adversarially verify one claimed defect in the diff \`${scope}\`. Your default is REFUTED —
the finding must earn its place. Read the actual code (and its callers, tests, and types) before deciding.

CLAIM: ${f.summary}
WHERE: ${f.file}:${f.line} (${f.category})
CLAIMED FAILURE: ${f.failure_scenario}
REVIEWER'S EVIDENCE: ${f.evidence}

${LENSES[i % LENSES.length]}

Refute it if: the code does not actually do this; something already prevents it; it is
pre-existing and untouched by the diff; it is a style opinion rather than a defect; or you
cannot demonstrate the failure. If it is real but the reviewer described it inaccurately,
mark it not-refuted and give the accurate statement in "correction".`,
              { label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA },
            ),
        ),
      ).then((votes) => {
        const cast = votes.filter(Boolean)
        const kept = cast.filter((v) => !v.refuted)
        // Fail closed on verifier death: zero votes is an infrastructure
        // failure, not a refutation — keep the finding, marked UNVERIFIED.
        // CONFIRMED requires a FULL healthy panel; a degraded panel that
        // upholds is only ever PLAUSIBLE.
        const verdict = cast.length === 0 ? 'UNVERIFIED' : kept.length <= cast.length / 2 ? 'REFUTED' : kept.length === cast.length && cast.length === voters ? 'CONFIRMED' : 'PLAUSIBLE'
        return Object.assign({}, f, {
          votes: cast.length,
          upheld: kept.length,
          verdict: verdict,
          correction: (kept[0] && kept[0].correction) || '',
          rationale: (cast[0] && cast[0].reason) || '',
        })
      }),
  ),
)

const survivors = verified.filter(Boolean).filter((f) => f.verdict !== 'REFUTED')
survivors.sort((a, b) => (RANK[a.severity] || 3) - (RANK[b.severity] || 3))

const unvetted = survivors.filter((f) => f.verdict === 'UNVERIFIED').length
log(`${survivors.length} of ${toVerify.length} findings survived verification.`)
if (unvetted > 0) log(`WARNING: ${unvetted} finding(s) are UNVERIFIED — every verifier assigned to them died. They are unvetted reviewer claims, not confirmed defects; check them by hand.`)

return {
  scope: scope,
  depth: depth,
  reviewed: reviewedDimensions,
  failed_dimensions: failedDimensions,
  files_in_scope: files.length,
  raw_count: raw.length,
  off_scope_discarded: offScope.length,
  unverified_count: dropped,
  findings: survivors,
}
