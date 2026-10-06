import type { IScriptComparisonService } from '../../interfaces/comparison.js'
import type { ComparisonResultType } from '../../types/comparison.js'
import { AuthorizedScriptFound, KnownScriptWithUnauthorisedContentFound, MissingRequiredScript, UnknownScriptFound } from '../../types/comparison.js'
import type { InheritedAuthorisation } from '../../types/comparison/index.js'
import { chainPaths, describeChain, type InitiatorHop, inlineInstanceOf, ownEvidence } from '../../types/initiator-chain.js'
import type { Inventory, InventoryScriptInfo } from '../../types/inventory/model.js'
import type { DetectedScript, Matchable } from '../../types/matcher/matcher.interface.js'
import type { ScriptDetectionSummary, ScriptInfo } from '../../types/script.js'
import type { Target } from '../../types/target.js'
import { getScriptSource } from '../../utils/script.js'
import { extractHost } from '../../utils/url.js'

export class ScriptComparisonService implements IScriptComparisonService {
  /**
   * Returns typed comparison results with complete context for alert handlers.
   *
   * Result types:
   * - UnknownScriptFound: Script not in inventory or has null/empty content
   * - KnownScriptWithUnauthorisedContentFound: Script identified but authorization failed
   * - AuthorizedScriptFound: Script both identified and authorized (compliant)
   */
  compare(target: Target, inventory: Inventory, scriptDetectionSummary: ScriptDetectionSummary): Promise<ComparisonResultType[]> {
    const inventoryScripts = inventory.scripts
    const detectedExternalScripts = scriptDetectionSummary.externalScripts
    const detectedInlineScripts = scriptDetectionSummary.inlineScripts

    const externalScriptsResults = this.compareScriptWithInventory(detectedExternalScripts, inventoryScripts, target)
    const inlineScriptsResults = this.compareScriptWithInventory(detectedInlineScripts, inventoryScripts, target)
    const missingRequiredResults = this.findMissingRequiredScripts([...detectedExternalScripts, ...detectedInlineScripts], inventoryScripts, target)

    // Pass 2: a script no entry identified may still be authorised by a load
    // grant on an ancestor that pass 1 authorised (see inheritAuthorisation).
    const pass1 = [...externalScriptsResults, ...inlineScriptsResults]
    const judged = [...detectedExternalScripts, ...detectedInlineScripts].map((script, index) => ({ script, result: pass1[index]! }))
    const withInheritance = inheritAuthorisation(judged, target, (script) => this.findMatchingInventoryEntry(script, inventoryScripts) !== undefined)

    return Promise.resolve([...withInheritance, ...missingRequiredResults])
  }

  /**
   * Presence sweep for `requiredOn` entries — the script-side analogue of the
   * header service's missing-required check (feature 011, FR-016 / R12).
   *
   * An entry that declares `requiredOn` for the current pass asserts that some
   * detected script is identified by its `identifyWith`. When nothing on the
   * page matches, the control is gone — e.g. the RUM monitoring agent removed
   * from a payment page — and that absence is the finding. Integrity of a
   * script that IS present stays with the entry's ordinary authorisation
   * (hash) path; this sweep only ever answers "was it there at all".
   *
   * Synthetic pass only by construction: it runs from `compare()`, which the
   * RUM evidence path never enters — a beacon stream can prove presence but
   * never absence.
   */
  private findMissingRequiredScripts(detectedScripts: ScriptInfo[], inventoryScripts: InventoryScriptInfo[], target: Target): MissingRequiredScript[] {
    const requiredEntries = inventoryScripts.filter((entry) => entry.authoriseWith.authorisationInfo.authorised && (entry.requiredOn?.includes(target.type) ?? false))

    if (requiredEntries.length === 0) return []

    const timestamp = new Date()
    const detected = detectedScripts.map((script) => this.scriptInfoToDetectedScript(script, target))
    const missing: MissingRequiredScript[] = []

    for (const entry of requiredEntries) {
      // Tested against the entry directly, not via first-match-wins: an
      // earlier entry claiming the script for identification purposes must not
      // make the required one look absent.
      if (detected.some((script) => entry.identifyWith.identify(script))) continue

      const description = entry.identifyWith.getDescription()
      target.logger.log(`Required script '${description}' missing: no detected script identified by this entry on the ${target.type} pass.`)
      missing.push(new MissingRequiredScript(target, timestamp, description, entry))
    }

    return missing
  }

  /**
   * Compares detected scripts against inventory, returning typed results for each script.
   */
  private compareScriptWithInventory(detectedScripts: ScriptInfo[], inventoryScripts: InventoryScriptInfo[], target: Target): ComparisonResultType[] {
    const results: ComparisonResultType[] = []

    detectedScripts.forEach((script) => {
      const comparisonResult = this.compareSingleScriptWithInventory(script, inventoryScripts, target)
      results.push(comparisonResult)
    })

    return results
  }

  /**
   * Converts ScriptInfo to DetectedScript format for matcher operations.
   *
   * Each Matchable field carries what its name says, for every script type:
   * - `name`: the script URL (external) or inline id (inline) — NameMatcher.
   * - `content`: the actual script source — ContentMatcher.
   * - `url`: provenance — HostMatcher / UrlMatcher. External scripts use
   *   `source.url` directly, inline scripts use the initiator URL captured
   *   by the page-attribution shim (`InlineScriptSource.url`); both matchers
   *   fail-secure when it's missing.
   */
  private scriptInfoToDetectedScript(scriptInfo: ScriptInfo, target: Target): DetectedScript {
    const name = getScriptSource(scriptInfo)
    const content = scriptInfo.source.content
    // Both source variants carry `url` directly — external (its own URL,
    // always populated) and inline (initiator URL, optional). The discriminated
    // union narrows the type for us; no ternary needed.
    const url = scriptInfo.source.url
    // The initiator, for InitiatorHostMatcher: external scripts carry it from
    // the CDP request initiator; for inline scripts the source `url` IS the
    // initiator (page-attribution shim), so the same value is exposed under
    // both names — mirroring the RUM normalisation.
    const initiator = scriptInfo.source.type === 'external' ? scriptInfo.source.initiator : scriptInfo.source.url

    return {
      name,
      content,
      hash: scriptInfo.hash,
      workflowId: target.workflowId ?? 'default',
      targetType: target.type,
      ...(url !== undefined ? { url } : {}),
      ...(initiator !== undefined ? { initiator } : {}),
      ...(scriptInfo.initiatorChain !== undefined ? { initiatorChain: scriptInfo.initiatorChain } : {}),
      ...(scriptInfo.alternateInitiatorChains !== undefined ? { alternateInitiatorChains: scriptInfo.alternateInitiatorChains } : {}),
    }
  }

  /**
   * Compares a single detected script against inventory using matcher pipeline.
   * Implements first-match-wins identification and authorization logic.
   *
   * T054: Updated to return ComparisonResultType instead of { isNewScript, isNewHash }
   * T055-T057: Instantiates typed result classes based on comparison outcome
   *
   * Phase 4 Refactoring (T035-T040):
   * - Uses identifyWith matcher for script identification (first-match-wins)
   * - Uses authoriseWith matcher for content authorization
   * - Handles null/empty content as new script (fail-secure per clarification Q3)
   * - Logs matcher execution with type, pattern, result, and timing
   */
  private compareSingleScriptWithInventory(script: ScriptInfo, inventoryScripts: InventoryScriptInfo[], target: Target): ComparisonResultType {
    const scriptSourceValue = getScriptSource(script)
    const detectedScript = this.scriptInfoToDetectedScript(script, target)
    const timestamp = new Date()

    // Mirror the header format — lead log lines with `Script '<host>':'<identifier>'`
    // so operators can scan provenance at a glance. Host derived from the
    // attribution URL (external → script URL; inline → initiator URL captured
    // by the page-attribution shim).
    const scriptLabel = `Script '${extractHost(detectedScript.url)}':'${scriptSourceValue}'`

    // T055: Null/empty content handling - fail-secure (per clarification Q3)
    // Applies to the synthetic path only: a script the tool fetched itself
    // must have content, so its absence means the fetch failed and nothing
    // can be safely matched. The RUM evidence path (compareScriptEvidence)
    // enters evaluateDetectedScript directly because there content is
    // structurally absent, not missing.
    if (!detectedScript.content || detectedScript.content.trim() === '') {
      target.logger.log(`${scriptLabel} has null/empty content, treating as new script.`)
      return new UnknownScriptFound(target, timestamp, detectedScript)
    }

    return this.evaluateDetectedScript(detectedScript, inventoryScripts, target, scriptLabel, timestamp)
  }

  /**
   * RUM evidence path (feature 011): identification-only lookup for a script
   * observed in a real user's browser. External script bodies are opaque
   * client-side (research R8), so the only question an external RUM
   * observation can answer is "does any inventory entry identify this?" —
   * first-match-wins over `identifyWith`, exactly like the synthetic path.
   *
   * Accepts a plain `Matchable` because RUM externals carry no hash and no
   * content; matchers that need either (HashMatcher, ContentMatcher) simply
   * return false, which is their documented fail-secure behaviour.
   */
  identifyScript(script: Matchable, inventoryScripts: InventoryScriptInfo[]): InventoryScriptInfo | undefined {
    return this.findMatchingInventoryEntry(script, inventoryScripts)
  }

  /**
   * RUM evidence path (feature 011): full identify → authorise evaluation for
   * a script whose content the tool never fetched — the client-computed hash
   * is the evidence (inline scripts).
   *
   * Deliberately skips the synthetic null-content pre-gate: content is
   * structurally absent for RUM observations, and blanket-classifying every
   * identified inline script as unknown would hide tampering behind the wrong
   * alert category. Matchers are evidence-aware: a hash-based authoriser
   * (HashMatcher, alone or inside a composite) compares the client-computed
   * hash and can authorise — or report a hash mismatch — and ContentMatcher
   * evaluates anchored head/tail window evidence (`Matchable.contentEvidence`,
   * T028): a sound anchored match authorises, anything else fails secure with
   * an explicit bounded-excerpt reason. Matchers whose evidence is truly
   * absent (CspDirectiveMatcher, ContentMatcher with no windows) fail secure
   * with their own reason, yielding KnownScriptWithUnauthorisedContentFound —
   * a mismatched alert, the fail-secure outcome.
   */
  compareScriptEvidence(detectedScript: DetectedScript, inventoryScripts: InventoryScriptInfo[], target: Target): ComparisonResultType {
    const scriptLabel = `Script '${extractHost(detectedScript.url)}':'${detectedScript.name}'`
    return this.evaluateDetectedScript(detectedScript, inventoryScripts, target, scriptLabel, new Date())
  }

  /**
   * Shared identify → authorise core: first-match-wins identification, then
   * authorisation via the matched entry's authoriseWith matcher. Used by both
   * the synthetic path (after its null-content gate) and the RUM evidence
   * path (which has no such gate).
   */
  private evaluateDetectedScript(detectedScript: DetectedScript, inventoryScripts: InventoryScriptInfo[], target: Target, scriptLabel: string, timestamp: Date): ComparisonResultType {
    // First-match-wins identification using matcher pipeline
    const matchedEntry = this.findMatchingInventoryEntry(detectedScript, inventoryScripts)

    // T055: Script not identified in inventory
    if (!matchedEntry) {
      target.logger.log(`${scriptLabel} not identified in inventory (no identifyWith matcher matched).`)
      return new UnknownScriptFound(target, timestamp, detectedScript)
    }

    // Log successful identification with matcher details
    const identifyDescription = matchedEntry.identifyWith.getDescription()
    target.logger.log(`${scriptLabel} identified using ${identifyDescription}.`)

    // Authorization using authoriseWith matcher
    const authorizationResult = matchedEntry.authoriseWith.matcher.authorize(detectedScript)

    // Log authorization result with matcher details
    const authorizeDescription = matchedEntry.authoriseWith.matcher.getDescription()
    const authStatus = authorizationResult.authorized ? 'AUTHORIZED' : `UNAUTHORIZED (${authorizationResult.reason})`

    // Build full metadata path: top-level authorisationInfo + nested metadataPath
    const fullPath = [matchedEntry.authoriseWith.authorisationInfo, ...(authorizationResult.metadataPath ?? [])]
    const metadataPathDesc = fullPath.length > 0 ? ` Auth: ${fullPath.map((m) => m.description).join(' > ')}` : ''

    target.logger.log(`${scriptLabel} authorization via ${authorizeDescription}: ${authStatus}.${metadataPathDesc}`)

    // T056: Known script but unauthorized content
    // T029: Pass metadataPath from AuthorizationResult for composite matcher support
    if (!authorizationResult.authorized) {
      return new KnownScriptWithUnauthorisedContentFound(
        target,
        timestamp,
        detectedScript,
        matchedEntry,
        matchedEntry.authoriseWith.matcher,
        authorizationResult.reason ?? 'Unknown authorization failure',
        authorizationResult.metadataPath ?? [], // NEW: Pass metadata path from authorization result
      )
    }

    // T057: Script is both identified and authorized
    // T029: Pass metadataPath from AuthorizationResult for composite matcher support
    return new AuthorizedScriptFound(target, timestamp, detectedScript, matchedEntry, authorizationResult.metadataPath ?? [])
  }

  /**
   * Finds first inventory entry where identifyWith matcher returns true.
   * Implements first-match-wins logic per clarification Q1.
   *
   * Accepts any Matchable: identification consults `identifyWith` matchers
   * only, and every matcher fails secure on evidence the resource lacks
   * (RUM external scripts, for instance, carry neither content nor hash).
   *
   * @param script - Detected resource to match
   * @param inventoryScripts - Array of inventory entries (iteration order determines priority)
   * @returns First matching entry or undefined if no match
   */
  private findMatchingInventoryEntry(script: Matchable, inventoryScripts: InventoryScriptInfo[]): InventoryScriptInfo | undefined {
    for (const inventoryEntry of inventoryScripts) {
      // Skip non-authorized entries (legacy compatibility)
      if (!inventoryEntry.authoriseWith.authorisationInfo.authorised) {
        continue
      }

      const identified = inventoryEntry.identifyWith.identify(script)
      if (identified) {
        return inventoryEntry // First match wins
      }
    }
    return undefined
  }
}

type Judged = { script: ScriptInfo; result: ComparisonResultType }

/**
 * Pass 2 of the script comparison: trust inherited through loaders.
 *
 * For every script pass 1 left `unknown`, walk its initiator chain outward.
 * The script inherits authorisation from the first hop that is a script pass
 * 1 AUTHORISED (explicitly, by an entry identifying it) under an entry
 * carrying `authorisesLoads`, provided the hop sits within the grant's depth
 * and, if the grant has a `loadsMatching` guard, the guard identifies the
 * script. Each rule is fail-secure:
 *
 * - **Only `unknown` inherits.** An explicit verdict beats inheritance: a
 *   script an entry identified and denied stays denied.
 * - **A denied ancestor poisons its subtree.** Every observation of a hop's
 *   script must be authorised in this run; one mismatched copy (the walk
 *   cannot tell which copy did the loading) and nothing below it inherits.
 *   Identified-but-denied is not authorised.
 * - **A broken chain stops inheritance.** The walk ends at the first hop that
 *   is not an observed script (`document`, `unknown`, or a script absent from
 *   this comparison); no chain at all inherits nothing.
 * - **Pass-through needs authorisation too.** A hop that does not grant (no
 *   grant, out of depth, guard rejects) is crossed only if it is itself
 *   authorised — explicitly or by inheritance — so an unvouched-for loader
 *   cuts its loads off from any grant further out.
 * - **Any recorded path counts.** Paths share the immediate inserter and fork
 *   only above it; each path is judged by the same rules.
 */
export function inheritAuthorisation(judged: readonly Judged[], target: Target, identified: (script: Matchable) => boolean = () => false): ComparisonResultType[] {
  if (!judged.some(({ result }) => result.type === 'unknown_script_found')) return judged.map(({ result }) => result)

  const byUrl = new Map<string, Judged[]>()
  const byToken = new Map<string, Judged>()
  for (const entry of judged) {
    const source = entry.script.source
    if (source.type === 'external') byUrl.set(source.url, [...(byUrl.get(source.url) ?? []), entry])
    // Only the observation's own element: an inline hop names exactly one element.
    else if (source.instances?.[0] !== undefined) byToken.set(source.instances[0].token, entry)
  }
  const observationsOf = (hop: InitiatorHop): Judged[] => {
    const token = inlineInstanceOf(hop.url)
    if (token !== null) {
      const inline = byToken.get(token)
      return inline === undefined ? [] : [inline]
    }
    return byUrl.get(hop.url) ?? []
  }

  const inherited = new Map<Judged, InheritedVerdict | null>()
  const inProgress = new Set<Judged>()

  /** The grant every observation of this hop extends to a script `depth` hops below it, or null. */
  const grantAt = (observations: readonly Judged[], depth: number, loaded: Matchable): InventoryScriptInfo | null => {
    if (observations.length === 0) return null
    const entries: InventoryScriptInfo[] = []
    for (const { script, result } of observations) {
      // An inline script never grants: what the scan reads is the element's
      // text at scan time, which the code that ran can rewrite to match an
      // authorised entry after doing its work. Its hop still carries the walk
      // (pass-through) when it is itself authorised.
      if (script.source.type !== 'external') return null
      if (result.type !== 'authorized_script' || result.inherited !== undefined) return null
      const grant = result.inventoryEntry.authorisesLoads
      // Belt and braces: validation already refuses a grant on an entry that
      // is not authorised, and pass 1 never authorises under one.
      if (grant === undefined || result.inventoryEntry.authoriseWith.authorisationInfo.authorised !== true) return null
      if (depth > grant.maxDepth) return null
      // Mandatory (validation refuses a grant without it): the one check on a
      // load that rests on the load's own URL, which the page cannot forge.
      if (grant.loadsMatching === undefined || !grant.loadsMatching.identify(ownEvidence(loaded))) return null
      entries.push(result.inventoryEntry)
    }
    return entries[0]!
  }

  const authorised = (observations: readonly Judged[]): boolean =>
    observations.length > 0 && observations.every((entry) => entry.result.type === 'authorized_script' || (entry.result.type === 'unknown_script_found' && inheritFor(entry) !== null))

  const inheritFor = (entry: Judged): InheritedVerdict | null => {
    if (inherited.has(entry)) return inherited.get(entry)!
    // A cycle in the evidence: whatever is being decided further down the
    // stack cannot vouch for itself.
    if (inProgress.has(entry) || entry.result.type !== 'unknown_script_found') return null
    // Unknown only because its content was empty (the synthetic null-content
    // gate runs before identification): an entry claims it, so its verdict is
    // that entry's to give, never a grant's.
    if (identified(entry.result.script)) return null
    inProgress.add(entry)
    let verdict: InheritedVerdict | null = null
    const loaded = entry.result.script
    search: for (const path of chainPaths(loaded)) {
      for (const [index, hop] of path.entries()) {
        if (hop.kind !== 'script') break
        const observations = observationsOf(hop)
        const granting = grantAt(observations, index + 1, loaded)
        if (granting !== null) {
          verdict = { entry: granting, inherited: { from: hop.url, via: path.slice(0, index + 1), mode: granting.authorisesLoads!.mode } }
          break search
        }
        if (!authorised(observations)) break
      }
    }
    inProgress.delete(entry)
    inherited.set(entry, verdict)
    return verdict
  }

  return judged.map((entry) => {
    if (entry.result.type !== 'unknown_script_found') return entry.result
    const verdict = inheritFor(entry)
    if (verdict === null) return entry.result
    const script = entry.result.script
    target.logger.log(
      `Script '${extractHost(script.url)}':'${script.name}' authorised by inheritance from ${verdict.entry.identifyWith.getDescription()} (${verdict.inherited.mode} grant): ${describeChain(verdict.inherited.via, (hop) => hop.url)}.`,
    )
    return new AuthorizedScriptFound(entry.result.target, entry.result.timestamp, script, verdict.entry, [verdict.entry.authoriseWith.authorisationInfo], verdict.inherited)
  })
}

type InheritedVerdict = { entry: InventoryScriptInfo; inherited: InheritedAuthorisation }
