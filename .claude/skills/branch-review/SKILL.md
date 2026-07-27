---
name: branch-review
description: Multi-agent code review of a branch, commit range, or PR — parallel dimension reviewers, adversarial verification, ranked findings. Use before creating a commit or opening a PR, when the user asks to review the current diff/branch/changes, or whenever a review gate is needed — it replaces /review and /code-review in this repo's workflow (/code-review is user-triggered only; Claude cannot invoke it). Takes an optional scope like "main...HEAD", a commit sha, or a PR number.
---

# Branch Review

A fan-out of independent reviewers over one diff, every finding then attacked by adversarial
verifiers, and only survivors reported.

This **is** the repo's review gate — CLAUDE.md's Behaviours name this skill as the required
review step before every commit, replacing the old `/review` and pre-PR `/code-review` steps
(`/code-review` remains available for a human to run as an independent engine; Claude cannot
invoke it). It runs **alongside**, not instead of, the other two gates: `npm run precommit`
(correctness) and CodeRabbit (`/coderabbit:review --base main` before commit, plus its
asynchronous PR review rounds after every push).

**Cost is real**: ~7–20 agents per run. It is the right spend before a commit or a PR; it is
the wrong spend on a one-line change. For a trivial diff, read it yourself.

Vendored and adapted from
[dailyripple/dailyripple `.claude/skills/branch-review`](https://github.com/dailyripple/dailyripple/tree/main/.claude/skills/branch-review).

---

## 1. Resolve the scope

| Argument            | Scope to use                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(none)_            | `origin/main...HEAD` — the whole branch, the pre-PR gate                                                                                                                                     |
| `HEAD` / a sha      | `<sha>^..<sha>` — that single commit (`git diff HEAD` alone diffs the worktree, not the commit)                                                                                              |
| `abc..def`          | that range, as given                                                                                                                                                                         |
| a PR number (`257`) | `git fetch -q origin pull/<n>/head` + `gh pr view <n> --json baseRefName` → `origin/<base>...FETCH_HEAD` — do not rely on `headRefName`; for a fork PR no such local or origin branch exists |
| `staged`            | `--staged` — the index, the pre-commit gate                                                                                                                                                  |
| `working`           | `HEAD` — everything uncommitted, staged and unstaged (as a diff scope, `HEAD` means worktree-vs-HEAD)                                                                                        |

**For any scope that references `origin` (the default branch scope, PR scopes): `git fetch -q origin`
first, and diff against `origin/main`, not local `main`.** A stale local `main` silently widens the
scope to include whatever has landed upstream since — the review then spends its agents on other
people's merged code and reports findings against work the user never touched. Purely local scopes
(`staged`, `working`, a sha) need no fetch and must not fail for lack of network or a remote.

**Untracked files are invisible to `working` and `staged` diffs.** Before resolving either scope,
check `git ls-files --others --exclude-standard`; if it lists files that belong to the change,
`git add -N` them (intent-to-add) so they appear in the diff and the file list — otherwise the
review silently skips brand-new files, which are exactly the ones most worth reviewing.

Then get the file list — it is both your empty-check and an input to the workflow:

```bash
git diff --name-only <scope> && git diff --stat <scope> | tail -1
```

No files → say so and stop. Do not review a scope you could not resolve; ask instead.

## 2. Run the workflow

Call the **Workflow** tool with this script — the skill's instruction to do so is the explicit
opt-in the tool requires:

```
Workflow({
  scriptPath: ".claude/skills/branch-review/review-workflow.js",
  args: { scope: "origin/main...HEAD", files: ["src/services/detection.ts", "test/unit/services/detection.test.ts"] }
})
```

**Pass `args` as a real object, not a JSON string.** The script will parse a well-formed
JSON-encoded string as a fallback, but a malformed one dies with a bare `SyntaxError` and the
mistake is easy to make — pass the object.

`args` options:

- `scope` _(string, required)_ — the diff range you resolved in step 1.
- `files` _(string[], required)_ — exactly the output of `git diff --name-only <scope>`. This is
  the reviewers' allowlist: findings against anything else are discarded before you see them,
  because a reviewer handed an empty or wrong scope will otherwise go and review something else
  entirely (observed on the upstream project's first run — it reviewed three unrelated commits).
- `depth` _(`"standard"` | `"deep"`)_ — verifiers per finding: 1, or 3 with diverse lenses.
  Default `standard`. Use `deep` when the user says "thorough"/"ultra", when the change touches
  matcher semantics, fail-secure paths, secret handling (tokens, TOTP seeds), or alerting, or
  when a finding would be expensive to get wrong.
- `focus` _(string)_ — appended to every reviewer's brief. Use it to carry the user's own
  emphasis ("pay attention to the popup handling"), not to narrow the dimensions.
- `maxVerify` _(number)_ — cap on findings carried into verification (default 12). The script
  logs whatever it drops; so must you.

The workflow returns `{ scope, reviewed, failed_dimensions, raw_count, dropped_count, unverified_count, findings }`.
`failed_dimensions` lists reviewers that died — their coverage is missing, not clean; say so in the
report. `dropped_count` is findings skipped by `maxVerify` (never verified at all);
`unverified_count` is findings whose entire verifier panel died (returned in `findings` with
verdict `UNVERIFIED`) — do not conflate the two. Each finding carries `verdict`, `severity`, `dimension`, `correction`, and `rationale`.
Verdicts: `CONFIRMED` = a full, healthy verifier panel upheld it; `PLAUSIBLE` = upheld, but the
panel was split or degraded; `UNVERIFIED` = every verifier assigned to it died — an unvetted
reviewer claim the script fails closed on rather than silently dropping. Vet UNVERIFIED findings
yourself in step 3 before they go anywhere near the report.

It runs in the background. Wait for the task notification — never guess at or pre-empt results.
If the result looks empty or wrong, read `<transcriptDir>/journal.jsonl` before concluding
anything: it records what each agent actually returned.

## 3. Judge the findings yourself

The workflow narrows the field; it does not get the final say. Before reporting, spot-check the
findings that would change what the user does — open the file, read the lines. A finding you
cannot see in the code does not go in the report, whatever its verdict.

Apply the `correction` field when a verifier restated a finding more accurately, and prefer the
verifier's wording over the reviewer's when they disagree.

## 4. Report

Call **ReportFindings** once, most-severe first, with the survivors — `file`, `line`, `summary`,
`failure_scenario`, `category`, `verdict`, and a `short_summary` under 60 chars. Empty array if
nothing survived; that is a real and good outcome, not a failed review.

Then, in prose, keep it to what the user needs:

- what the review covered (scope, dimensions, depth) in one line;
- anything the run did **not** cover — findings dropped by `maxVerify` (`dropped_count`), every
  entry in `failed_dimensions`, UNVERIFIED findings you discarded, a scope you had to narrow.
  Silence here reads as "everything was checked";
- the notable non-issues, when a verifier refuted something that looks alarming in the diff —
  it stops the next reader from re-raising it.

Do not paste the findings twice (ReportFindings renders them). Do not pad with praise.

## 5. Afterwards

Per CLAUDE.md's Behaviours, this review runs **before the commit is created** — fold the fixes
into the same change, re-run `npm run precommit`, and note any finding consciously declined,
with the reason. Fix only what the findings support; a review that silently turns into a
refactor is not a review. This skill does not replace CodeRabbit's asynchronous PR rounds —
after opening or pushing to a PR, still watch for and address CodeRabbit's inline comments as
CLAUDE.md describes.

---

## Maintaining this skill

The dimensions live in `review-workflow.js` (`DIMENSIONS`) — one object per reviewer, each a
`key` and a `brief`. Edit the briefs as the project's rules change; keep them pointed at rules
that are _written down_ (CLAUDE.md), because a reviewer inventing house style produces noise
the verifiers then have to shoot down.

Adding a dimension adds one agent per run plus its findings' verifiers — check it earns that.
