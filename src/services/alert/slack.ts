import axios from 'axios'

import type { IAlertService, PullRequestFailureContext } from '../../interfaces/alert.js'
import type { RumAlertCategory, RumAlertContext } from '../../types/alert.js'
import { AlertType } from '../../types/alert.js'
import type { ComparisonResultType } from '../../types/comparison.js'
import type { KnownHeaderWithUnauthorisedContentFound } from '../../types/comparison/known-header-unauthorised-content-found.js'
import type { KnownScriptWithUnauthorisedContentFound } from '../../types/comparison/known-script-unauthorised-content-found.js'
import type { MissingRequiredHeader } from '../../types/comparison/missing-required-header.js'
import type { MissingRequiredScript } from '../../types/comparison/missing-required-script.js'
import type { UnknownHeaderFound } from '../../types/comparison/unknown-header-found.js'
import type { UnknownScriptFound } from '../../types/comparison/unknown-script-found.js'
import { ExecutionMode } from '../../types/config.js'
import { type AlertDeliveryFailure, type ExecutionSummary, type FailedTarget, getExecutionOutcome } from '../../types/execution-summary.js'
import type { HeaderInfo } from '../../types/header.js'
import type { AlertDestination, InventoryAlert } from '../../types/inventory/model.js'
import type { DetectedScript } from '../../types/matcher/matcher.interface.js'
import type { ScriptInfo } from '../../types/script.js'
import type { Target } from '../../types/target.js'
import { extractHost, redactUrl } from '../../utils/url.js'
import { redactForDisplay } from '../report/mapper.js'
import { resolveRumAlertDestination, rumAlertContextLines, rumAlertTitle } from './rum.js'

/**
 * Row passed to the unknown-header alert table. Carries the originating
 * response URL so the notification can show host (via extractHost) and so
 * AI prompts can quote the full URL when suggesting `hostMatcher` /
 * `urlMatcher` regexes.
 */
type HeaderAlertRow = HeaderInfo & { url?: string; detectedTarget: Target }

/**
 * Slack rejects a message whose table cells total more than 10,000 characters
 * (HTTP 200, `ok: false`, `invalid_blocks`) — and a rejected alert is a
 * finding nobody hears about. Tables are therefore fitted to a budget below
 * that cap before sending, with headroom for the header row and encoding.
 */
const TABLE_CHAR_BUDGET = 9500
/** No single cell may eat the budget: keeps at least a handful of rows visible. */
const TABLE_CELL_CHAR_CAP = 1200

type TextNode = { text?: unknown; elements?: unknown }

/** Sum the text carried by a table cell (rich_text nesting included). */
function tableCellChars(cell: unknown): number {
  if (cell === null || typeof cell !== 'object') return 0
  const node = cell as TextNode
  let total = typeof node.text === 'string' ? node.text.length : 0
  if (Array.isArray(node.elements)) for (const child of node.elements) total += tableCellChars(child)
  return total
}

/** Return a copy of the cell whose text totals at most `cap` characters. */
function clipTableCell(cell: unknown, cap: number): unknown {
  let remaining = cap
  const clip = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value
    const node = value as TextNode
    const copy: TextNode = { ...node }
    if (typeof node.text === 'string') {
      if (node.text.length <= remaining) {
        remaining -= node.text.length
      } else {
        copy.text = remaining > 1 ? `${node.text.slice(0, remaining - 1)}…` : ''
        remaining = 0
      }
    }
    if (Array.isArray(node.elements)) copy.elements = node.elements.map(clip)
    return copy
  }
  return clip(cell)
}

/** Escape the three characters Slack's mrkdwn treats as control syntax. */
function escapeMrkdwn(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export class SlackAlertService implements IAlertService {
  private readonly oAuthToken: string
  private readonly repositoryUrl: string
  private readonly inventoryBranch: string
  private readonly maxStringLength = 100

  /** Alerts this service could not deliver; see {@link getDeliveryFailures}. */
  private readonly deliveryFailures: AlertDeliveryFailure[] = []
  private reviewUrlOverride: string | null = null

  constructor(slackToken: string, repositoryUrl: string, inventoryBranch: string) {
    this.oAuthToken = slackToken
    this.repositoryUrl = repositoryUrl
    this.inventoryBranch = inventoryBranch
  }

  setReviewUrl(url: string | null): void {
    this.reviewUrlOverride = url
  }

  private getReviewChangesUrl(): string {
    if (this.reviewUrlOverride !== null) {
      return this.reviewUrlOverride
    }
    const baseUrl = this.repositoryUrl.replace(/\.git$/, '')
    return `${baseUrl}/compare/${this.inventoryBranch}?expand=1`
  }

  /**
   * Phase 4 (User Story 2): Unified typed handler for both scripts and headers.
   * T028-T033: Handles all ComparisonResultType variants with exhaustive type checking.
   *
   * Implementation:
   * - Switch on result.type discriminator
   * - Route to appropriate alert method based on result type
   * - Error handling per T033 (log and continue)
   * - Workflow-based alert routing per FR-011
   */
  async alertForTypedResults(comparisonResults: ComparisonResultType[], target: Target, alertDestinations: InventoryAlert, inventoryUpdatedResults?: ReadonlySet<ComparisonResultType>): Promise<void> {
    // Group results by type for batch processing
    const unknownScripts = comparisonResults.filter((r): r is UnknownScriptFound => r.type === 'unknown_script_found')
    const unauthorizedScripts = comparisonResults.filter((r): r is KnownScriptWithUnauthorisedContentFound => r.type === 'known_script_unauthorised_content')
    const unknownHeaders = comparisonResults.filter((r): r is UnknownHeaderFound => r.type === 'unknown_header_found')
    const unauthorizedHeaders = comparisonResults.filter((r): r is KnownHeaderWithUnauthorisedContentFound => r.type === 'known_header_unauthorised_content')
    const missingHeaders = comparisonResults.filter((r): r is MissingRequiredHeader => r.type === 'missing_required_header')
    const missingScripts = comparisonResults.filter((r): r is MissingRequiredScript => r.type === 'missing_required_script')

    // For inventory-mode unauthorised results, split into "diff applied an
    // inventory mutation for this result" vs "diff did not auto-update".
    // Detection mode passes no set and routes everything as before.
    const isInventoryMode = target.type === 'inventory'
    const splitByApplied = <T extends KnownScriptWithUnauthorisedContentFound | KnownHeaderWithUnauthorisedContentFound>(items: T[]): { applied: T[]; skipped: T[] } => {
      if (!isInventoryMode || !inventoryUpdatedResults) {
        return { applied: items, skipped: [] }
      }
      const applied: T[] = []
      const skipped: T[] = []
      for (const item of items) {
        if (inventoryUpdatedResults.has(item)) {
          applied.push(item)
        } else {
          skipped.push(item)
        }
      }
      return { applied, skipped }
    }

    // T033: Try-catch for each alert type to prevent blocking
    try {
      // Handle unknown scripts
      if (unknownScripts.length > 0) {
        const destination = isInventoryMode ? alertDestinations.inventory.newScriptIdentified : alertDestinations.detection.newScriptDetected
        await this.alertOnUnknownScripts(unknownScripts, target, destination)
      }
    } catch (error) {
      this.recordDeliveryFailure('unknown script alerts', target.url, error)
    }

    try {
      // Handle scripts that were identified but had unauthorised content. In
      // inventory mode the inventory service may have auto-added the new hash
      // — and may not (e.g. AndMatcher entries, non-hash authorisers). Use the
      // applied/skipped split to keep the message truthful: "Inventory updated"
      // only for the applied subset, "manual review required" for the rest.
      // In detection mode this is always a potential tampering event.
      if (unauthorizedScripts.length > 0) {
        const destination = isInventoryMode ? alertDestinations.inventory.newScriptIdentified : alertDestinations.detection.scriptMismatchDetected
        const { applied, skipped } = splitByApplied(unauthorizedScripts)
        if (applied.length > 0) {
          await this.alertOnUnauthorizedScripts(applied, target, destination, 'updated')
        }
        if (skipped.length > 0) {
          await this.alertOnUnauthorizedScripts(skipped, target, destination, 'manual-review')
        }
      }
    } catch (error) {
      this.recordDeliveryFailure('unauthorized script alerts', target.url, error)
    }

    try {
      // T031: Handle unknown headers with workflow-based routing
      if (unknownHeaders.length > 0) {
        const destination = isInventoryMode ? alertDestinations.inventory.newHeaderIdentified : alertDestinations.detection.newHeaderDetected
        await this.alertOnUnknownHeaders(unknownHeaders, target, destination)
      }
    } catch (error) {
      this.recordDeliveryFailure('unknown header alerts', target.url, error)
    }

    try {
      // Headers identified but with unauthorised content — same split as
      // scripts. "Inventory updated" only fires for results the diff actually
      // appended a new content matcher for; the rest get a manual-review
      // message so operators aren't told the inventory changed when it didn't.
      if (unauthorizedHeaders.length > 0) {
        const destination = isInventoryMode ? alertDestinations.inventory.newHeaderIdentified : (alertDestinations.detection.headerMismatchDetected ?? alertDestinations.detection.newHeaderDetected)
        const { applied, skipped } = splitByApplied(unauthorizedHeaders)
        if (applied.length > 0) {
          await this.alertOnUnauthorizedHeaders(applied, target, destination, 'updated')
        }
        if (skipped.length > 0) {
          await this.alertOnUnauthorizedHeaders(skipped, target, destination, 'manual-review')
        }
      }
    } catch (error) {
      this.recordDeliveryFailure('unauthorized header alerts', target.url, error)
    }

    try {
      if (missingHeaders.length > 0) {
        const destination = isInventoryMode
          ? alertDestinations.inventory.newHeaderIdentified
          : (alertDestinations.detection.missingHeaderDetected ?? alertDestinations.detection.headerMismatchDetected ?? alertDestinations.detection.newHeaderDetected)
        await this.alertOnMissingHeaders(missingHeaders, target, destination)
      }
    } catch (error) {
      this.recordDeliveryFailure('missing header alerts', target.url, error)
    }

    try {
      // Required script absent from the page (e.g. the RUM monitoring agent
      // removed) — routed like missing headers: a dedicated destination when
      // configured, otherwise the mismatch channel (an absent pinned control
      // is closest to tampering, not to a new discovery).
      if (missingScripts.length > 0) {
        const destination = isInventoryMode ? alertDestinations.inventory.newScriptIdentified : (alertDestinations.detection.missingScriptDetected ?? alertDestinations.detection.scriptMismatchDetected)
        await this.alertOnMissingScripts(missingScripts, target, destination)
      }
    } catch (error) {
      this.recordDeliveryFailure('missing script alerts', target.url, error)
    }

    // T030: AuthorizedScriptFound and AuthorizedHeaderFound are no-ops (no alert)
  }

  /**
   * Send one real-user monitoring alert (feature 011).
   *
   * Deliberately lets delivery errors propagate: the RUM router catches, logs,
   * and counts them so a broken Slack call never blocks queue routing — but
   * the router needs to see the failure to count it.
   */
  async alertForRumObservation(category: RumAlertCategory, context: RumAlertContext, alertDestinations: InventoryAlert): Promise<void> {
    const destination = resolveRumAlertDestination(alertDestinations, category)
    const title = rumAlertTitle(category)

    const messagePayload = {
      channel: destination.destination,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:warning: *${title}* :warning:` },
        },
        { type: 'divider' },
        ...rumAlertContextLines(category, context).map((line) => ({
          type: 'section',
          // Backticks in an attacker-influenced value (URL, failure reason)
          // would close the mrkdwn code span and let the remainder render as
          // markup — swap them for a lookalike before interpolating.
          text: { type: 'mrkdwn', text: `*${line.label}*: \`${this.truncateText(line.value).replace(/`/g, 'ˋ')}\`` },
        })),
      ],
    }

    this.log(AlertType.Rum, title)
    await this.sendMessage(messagePayload)
  }

  /**
   * T062, T063: Alert on unknown scripts with complete result context.
   * Enhanced with matcher details for better incident response.
   */
  private async alertOnUnknownScripts(unknownScripts: UnknownScriptFound[], target: Target, destination: AlertDestination): Promise<void> {
    const message = `Unauthorised scripts detected for target!`
    const scripts = unknownScripts.map((result) => this.detectedScriptToScriptInfo(result.script))
    const messagePayload = this.createScriptMessagePayload(message, scripts, target, destination)

    this.log(AlertType.Script, message)
    await this.sendMessage(messagePayload)
  }

  /**
   * T062, T063: Alert on unauthorized scripts with matcher failure details.
   * Includes which matcher failed and why for debugging.
   *
   * `inventoryMessageVariant` selects between two inventory-mode messages:
   *  - 'updated': the diff appended a new hash for this result.
   *  - 'manual-review': the diff intentionally did not auto-update (e.g.
   *    AndMatcher entry, non-hash authoriser, duplicate hash) — the operator
   *    must investigate manually.
   * The argument is ignored when `target.type !== 'inventory'`.
   */
  private async alertOnUnauthorizedScripts(unauthorizedScripts: KnownScriptWithUnauthorisedContentFound[], target: Target, destination: AlertDestination, inventoryMessageVariant: 'updated' | 'manual-review' = 'updated'): Promise<void> {
    const message =
      target.type === 'inventory'
        ? inventoryMessageVariant === 'updated'
          ? `Inventory updated: existing script entry has new content`
          : `Manual review required: script identified but authorisation failed (inventory not auto-updated)`
        : `Script hash mismatch detected for target!`

    // T063: Enhanced message payload with matcher details
    const messagePayload = this.createUnauthorizedScriptMessagePayload(message, unauthorizedScripts, target, destination)

    this.log(AlertType.Script, message)
    await this.sendMessage(messagePayload)
  }

  /**
   * T031: Alert on unknown headers with workflow-based routing.
   * FR-011: inventory → newHeaderIdentified, detection → uninventoriedHeaderDetected
   */
  private async alertOnUnknownHeaders(unknownHeaders: UnknownHeaderFound[], target: Target, destination: AlertDestination): Promise<void> {
    const message = `Unauthorised headers detected for target!`

    // Carry host through to the table so operators can see which response set
    // the header (e.g. distinguish first-party CSP from a third-party CSP).
    const headers: HeaderAlertRow[] = unknownHeaders.map((result) => ({
      name: result.header.name,
      value: result.header.value,
      ...(result.header.url !== undefined ? { url: result.header.url } : {}),
      detectedTarget: result.target,
    }))

    const messagePayload = this.createHeaderMessagePayload(message, headers, target, destination)

    this.log(AlertType.Header, message)
    await this.sendMessage(messagePayload)
  }

  /**
   * T032: Alert on unauthorized headers with matcher details and failure reason.
   * Includes matcher type, pattern, and why authorization failed.
   *
   * `inventoryMessageVariant` selects between two inventory-mode messages
   * (see scripts equivalent for full rationale).
   */
  private async alertOnUnauthorizedHeaders(unauthorizedHeaders: KnownHeaderWithUnauthorisedContentFound[], target: Target, destination: AlertDestination, inventoryMessageVariant: 'updated' | 'manual-review' = 'updated'): Promise<void> {
    const message =
      target.type === 'inventory'
        ? inventoryMessageVariant === 'updated'
          ? `Inventory updated: existing header entry has new value`
          : `Manual review required: header identified but authorisation failed (inventory not auto-updated)`
        : `Header content mismatch detected for target!`

    const messagePayload = this.createUnauthorizedHeaderMessagePayload(message, unauthorizedHeaders, target, destination)

    this.log(AlertType.Header, message)
    await this.sendMessage(messagePayload)
  }

  private async alertOnMissingHeaders(missingHeaders: MissingRequiredHeader[], target: Target, destination: AlertDestination): Promise<void> {
    const message = `Required security header missing from target!`
    const rows = missingHeaders
      .slice(0, 19)
      .map((result) => [this.buildRichTextCell(result.headerName), this.buildRichTextCell(extractHost(result.url)), this.buildRichTextCell(result.resourceType), this.buildRichTextCell(redactUrl(result.url))])
    const payload = {
      channel: destination.destination,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `:warning: *${message}* :warning:` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Target*: \`${target.url}\`` } },
        ...this.boundedTable([[this.buildBoldHeaderCell('Header Name'), this.buildBoldHeaderCell('Host'), this.buildBoldHeaderCell('Resource Type'), this.buildBoldHeaderCell('Response URL')], ...rows], missingHeaders.length),
      ],
    }

    this.log(AlertType.Header, message)
    await this.sendMessage(payload)
  }

  private async alertOnMissingScripts(missingScripts: MissingRequiredScript[], target: Target, destination: AlertDestination): Promise<void> {
    const message = `Required script missing from target!`
    const rows = missingScripts
      .slice(0, 19)
      .map((result) => [
        this.buildRichTextCell(this.truncateText(result.scriptDescription)),
        this.buildRichTextCell((result.inventoryEntry.requiredOn ?? []).join(', ')),
        this.buildRichTextCell(result.inventoryEntry.authoriseWith.authorisationInfo.description),
      ])
    const payload = {
      channel: destination.destination,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `:warning: *${message}* :warning:` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Target*: \`${target.url}\`` } },
        ...this.boundedTable([[this.buildBoldHeaderCell('Identified By'), this.buildBoldHeaderCell('Required On'), this.buildBoldHeaderCell('Justification')], ...rows], missingScripts.length),
      ],
    }

    this.log(AlertType.Script, message)
    await this.sendMessage(payload)
  }

  /**
   * Converts DetectedScript from comparison result to ScriptInfo for legacy
   * alert compatibility. `detectedScript.url` (the initiator URL for inline
   * scripts, the script's own URL for external) is propagated into the
   * resulting source so the alert table can render a Host column derived
   * from it via extractHost.
   */
  private detectedScriptToScriptInfo(detectedScript: DetectedScript): ScriptInfo {
    // Inline script names are always `inline_script/...` ids (assigned by
    // getInlineScriptsFromPage / tryGetIdFromInLineScriptCode); anything else
    // is an external script URL — including non-http schemes such as blob:
    // worker code minted via URL.createObjectURL.
    const isInline = detectedScript.name.startsWith('inline_script/')

    if (!isInline) {
      return {
        source: {
          type: 'external',
          // Prefer the provenance URL; fall back to the name (identical for
          // external scripts today, but url is the documented source of truth).
          url: detectedScript.url ?? detectedScript.name,
          content: detectedScript.content ?? '',
        },
        hash: detectedScript.hash,
      }
    } else {
      return {
        source: {
          type: 'inline',
          id: detectedScript.name,
          content: detectedScript.content ?? '',
          ...(detectedScript.url !== undefined ? { url: detectedScript.url } : {}),
        },
        hash: detectedScript.hash,
      }
    }
  }

  /**
   * Returns the originating URL for a ScriptInfo: external scripts use the
   * script's own URL, inline scripts use the initiator URL captured by the
   * page-attribution shim. Returned as `undefined` when neither applies.
   */
  private getScriptUrl(scriptInfo: ScriptInfo): string | undefined {
    return scriptInfo.source.type === 'external' ? scriptInfo.source.url : scriptInfo.source.url
  }

  /**
   * Post to Slack and fail loudly when Slack refuses the message.
   *
   * `chat.postMessage` answers HTTP 200 with `{ ok: false, error }` for a
   * rejected payload (an oversize block, an unknown channel), so a bare await
   * on the request would count a dropped alert as delivered. Throwing here
   * lets every caller's existing catch log the rejection instead.
   */
  private async sendMessage(messagePayload: object): Promise<void> {
    const postMessageEndpoint = 'https://slack.com/api/chat.postMessage'
    const response = await axios.post<{ ok?: boolean; error?: string }>(postMessageEndpoint, messagePayload, { headers: { Authorization: `Bearer ${this.oAuthToken}`, 'Content-Type': 'application/json' } })
    if (response.data !== undefined && response.data !== null && response.data.ok === false) {
      throw new Error(`Slack rejected the message: ${response.data.error ?? 'unknown error'}`)
    }
  }

  private createScriptMessagePayload(title: string, scripts: ScriptInfo[], target: Target, destination: AlertDestination): object {
    return {
      channel: destination.destination,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:warning: *${title}* :warning:`,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Target Type*: \`${target.type}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Target Source*: \`${target.url}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Number of Detected Changes*: ${scripts.length}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Detection Summary (Max of 20)*`,
          },
        },
        ...this.boundedTable(
          [
            [this.buildBoldHeaderCell('Identifier'), this.buildBoldHeaderCell('Hash'), this.buildBoldHeaderCell('Content Snippet'), this.buildBoldHeaderCell('Host'), this.buildBoldHeaderCell('Suggested AI Prompt')],
            ...scripts.slice(0, 19).map((scriptInfo) => [...this.scriptInfoToTableItem(scriptInfo), this.buildRichTextCell(extractHost(this.getScriptUrl(scriptInfo))), this.buildRichTextCell(this.buildScriptAiPrompt(scriptInfo, target))]),
          ],
          scripts.length,
        ),
        ...(target.type === 'inventory'
          ? [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: 'Please review the changes as soon as possible:',
                },
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: {
                      type: 'plain_text',
                      text: 'Review changes',
                    },
                    url: this.getReviewChangesUrl(),
                  },
                ],
              },
            ]
          : []),
      ],
    }
  }

  /**
   * T063: Enhanced message payload with matcher failure details for better debugging.
   * Includes which matcher type failed, the pattern/hashes used, and the failure reason.
   */
  private createUnauthorizedScriptMessagePayload(title: string, unauthorizedScripts: KnownScriptWithUnauthorisedContentFound[], target: Target, destination: AlertDestination): object {
    const scripts = unauthorizedScripts.map((result) => this.detectedScriptToScriptInfo(result.script))

    return {
      channel: destination.destination,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:warning: *${title}* :warning:`,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Target Type*: \`${target.type}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Target Source*: \`${target.url}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Number of Detected Changes*: ${scripts.length}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Detection Summary with Matcher Details (Max of 20)*`,
          },
        },
        ...this.boundedTable(
          [
            [
              this.buildBoldHeaderCell('Identifier'),
              this.buildBoldHeaderCell('Hash'),
              this.buildBoldHeaderCell('Content'),
              this.buildBoldHeaderCell('Host'),
              this.buildBoldHeaderCell('Failure Reason'),
              this.buildBoldHeaderCell('Suggested AI Prompt'),
            ],
            ...unauthorizedScripts.slice(0, 19).map((result) => {
              const row = this.unauthorizedScriptToTableItem(result)
              // Splice the host cell in between Content and Failure Reason so column order matches the header row.
              return [...row.slice(0, 3), this.buildRichTextCell(extractHost(result.script.url)), ...row.slice(3), this.buildRichTextCell(this.buildUnauthorizedScriptAiPrompt(result))]
            }),
          ],
          unauthorizedScripts.length,
        ),
        ...(target.type === 'inventory'
          ? [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: 'Please review the changes as soon as possible:',
                },
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: {
                      type: 'plain_text',
                      text: 'Review changes',
                    },
                    url: this.getReviewChangesUrl(),
                  },
                ],
              },
            ]
          : []),
      ],
    }
  }

  /**
   * T063: Converts unauthorized script result to table row with matcher details.
   */
  private unauthorizedScriptToTableItem(result: KnownScriptWithUnauthorisedContentFound) {
    const scriptInfo = this.detectedScriptToScriptInfo(result.script)
    let scriptIdentifier: string

    switch (scriptInfo.source.type) {
      case 'external':
        scriptIdentifier = scriptInfo.source.url
        break
      case 'inline':
        scriptIdentifier = scriptInfo.source.id
        break
    }

    const matcherType = result.authorizationMatcher.getType()
    const pattern = JSON.stringify(result.authorizationMatcher.getPattern())
    const failureReason = `${matcherType}Matcher failed: ${result.failureReason} (expected: ${pattern})`
    const contentSnippet = this.createContentSnippet(result.script.content ?? '')

    return [
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: this.truncateText(scriptIdentifier),
              },
            ],
          },
        ],
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: this.truncateText(scriptInfo.hash.value),
              },
            ],
          },
        ],
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: contentSnippet,
              },
            ],
          },
        ],
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: this.truncateText(failureReason),
              },
            ],
          },
        ],
      },
    ]
  }

  /**
   * T032: Create message payload for unauthorized headers with matcher details.
   * Similar to unauthorized scripts but for headers.
   */
  private createUnauthorizedHeaderMessagePayload(title: string, unauthorizedHeaders: KnownHeaderWithUnauthorisedContentFound[], target: Target, destination: AlertDestination): object {
    return {
      channel: destination.destination,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:warning: *${title}* :warning:`,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Target Type*: \`${target.type}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Target Source*: \`${target.url}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Number of Detected Changes*: ${unauthorizedHeaders.length}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Detection Summary with Matcher Details (Max of 20)*`,
          },
        },
        ...this.boundedTable(
          [
            [this.buildBoldHeaderCell('Header Name'), this.buildBoldHeaderCell('Value'), this.buildBoldHeaderCell('Host'), this.buildBoldHeaderCell('Failure Reason'), this.buildBoldHeaderCell('Suggested AI Prompt')],
            ...unauthorizedHeaders.slice(0, 19).map((result) => [...this.unauthorizedHeaderToTableItem(result), this.buildRichTextCell(this.buildUnauthorizedHeaderAiPrompt(result))]),
          ],
          unauthorizedHeaders.length,
        ),
        ...(target.type === 'inventory'
          ? [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: 'Please review the changes as soon as possible:',
                },
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: {
                      type: 'plain_text',
                      text: 'Review changes',
                    },
                    url: this.getReviewChangesUrl(),
                  },
                ],
              },
            ]
          : []),
      ],
    }
  }

  /**
   * T032: Convert unauthorized header result to table row with matcher details.
   */
  private unauthorizedHeaderToTableItem(result: KnownHeaderWithUnauthorisedContentFound) {
    const matcherType = result.authorizationMatcher.getType()
    const pattern = JSON.stringify(result.authorizationMatcher.getPattern())
    const failureReason = `${matcherType}Matcher failed: ${result.failureReason} (expected: ${pattern})`
    const hostCell = this.buildRichTextCell(extractHost(result.header.url))

    return [
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: this.truncateText(result.header.name),
              },
            ],
          },
        ],
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: result.header.value,
              },
            ],
          },
        ],
      },
      hostCell,
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: this.truncateText(failureReason),
              },
            ],
          },
        ],
      },
    ]
  }

  private createHeaderMessagePayload(title: string, headers: HeaderAlertRow[], target: Target, destination: AlertDestination): object {
    return {
      channel: destination.destination,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:warning: *${title}* :warning:`,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Target Type*: \`${target.type}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Target Source*: \`${target.url}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Number of unauthorised headers*: ${headers.length}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Detection Summary (Max of 20)*`,
          },
        },
        ...this.boundedTable(
          [
            [this.buildBoldHeaderCell('Header Name'), this.buildBoldHeaderCell('Value'), this.buildBoldHeaderCell('Host'), this.buildBoldHeaderCell('Suggested AI Prompt')],
            ...headers.slice(0, 19).map((row) => [...this.headerInfoToTableItem({ name: row.name, value: row.value }), this.buildRichTextCell(extractHost(row.url)), this.buildRichTextCell(this.buildHeaderAiPrompt(row, target))]),
          ],
          headers.length,
        ),
        ...(target.type === 'inventory'
          ? [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: 'Please review the changes as soon as possible:',
                },
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: {
                      type: 'plain_text',
                      text: 'Review changes',
                    },
                    url: this.getReviewChangesUrl(),
                  },
                ],
              },
            ]
          : []),
      ],
    }
  }

  private scriptInfoToTableItem(scriptInfo: ScriptInfo) {
    let scriptIdentifier: string
    let contentSnippet: string

    switch (scriptInfo.source.type) {
      case 'external':
        scriptIdentifier = scriptInfo.source.url
        contentSnippet = this.createContentSnippet(scriptInfo.source.content)
        break
      case 'inline':
        scriptIdentifier = scriptInfo.source.id
        contentSnippet = this.createContentSnippet(scriptInfo.source.content)
        break
    }

    return [
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: this.truncateText(scriptIdentifier),
              },
            ],
          },
        ],
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: this.truncateText(scriptInfo.hash.value),
              },
            ],
          },
        ],
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: contentSnippet,
              },
            ],
          },
        ],
      },
    ]
  }

  private headerInfoToTableItem(headerInfo: HeaderInfo) {
    return [
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: this.truncateText(headerInfo.name),
              },
            ],
          },
        ],
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: headerInfo.value,
              },
            ],
          },
        ],
      },
    ]
  }

  private log(alertType: AlertType, message: string): void {
    console.log(`[Alert → ${alertType}]: ${message}`)
  }

  private truncateText(text: string): string {
    return text.length > this.maxStringLength ? text.slice(0, this.maxStringLength - 4).concat('...') : text
  }

  /**
   * Build a rich_text table cell containing a single text element.
   * Used for the Suggested AI Prompt column where we want the prompt
   * to render verbatim without truncation.
   */
  private buildRichTextCell(text: string): object {
    return {
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: [
            {
              type: 'text',
              text,
            },
          ],
        },
      ],
    }
  }

  /**
   * Build a bold rich_text table header cell containing the given label.
   */
  private buildBoldHeaderCell(label: string): object {
    return {
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_section',
          elements: [
            {
              type: 'text',
              text: label,
              style: { bold: true },
            },
          ],
        },
      ],
    }
  }

  /**
   * Suggested AI prompt for a previously-unknown script.
   * Tells an AI assistant how to add the script to the inventory file.
   */
  private buildScriptAiPrompt(script: ScriptInfo, target: Target): string {
    const identifier = script.source.type === 'external' ? script.source.url : script.source.id
    const originUrl = this.getScriptUrl(script)
    const provenanceHint =
      script.source.type === 'inline' && originUrl
        ? ` This inline script was injected by "${originUrl}" (host: ${extractHost(originUrl)}); if it should only be authorised when initiated by that origin, combine the ContentMatcher with a HostMatcher (host-only) or UrlMatcher (full-URL precision) under an AndMatcher in identifyWith.`
        : ''
    return `Add a new entry to the inventory file for target ${target.url} authorising script "${identifier}" with SHA-256 hash ${script.hash.value}.${provenanceHint} Use a NameMatcher on the URL for identification and a HashMatcher for authorisation. Include authorisationInfo with a description and today's date.`
  }

  /**
   * Suggested AI prompt for a known script whose content failed authorisation.
   * Tells an AI assistant how to update the existing inventory entry.
   */
  private buildUnauthorizedScriptAiPrompt(result: KnownScriptWithUnauthorisedContentFound): string {
    const scriptInfo = this.detectedScriptToScriptInfo(result.script)
    const identifier = scriptInfo.source.type === 'external' ? scriptInfo.source.url : scriptInfo.source.id
    const provenanceHint = result.script.url ? ` Note: this script's originating URL was "${result.script.url}" (host: ${extractHost(result.script.url)}).` : ''
    return `In the inventory file for target ${result.target.url}, the existing entry that identifies "${identifier}" failed authorisation (${result.failureReason}). Either add the new SHA-256 hash ${result.script.hash.value} to its authoriseWith.hashes list with today's timestamp, or investigate the change before authorising.${provenanceHint}`
  }

  /**
   * Suggested AI prompt for a previously-unknown header.
   */
  private buildHeaderAiPrompt(header: HeaderAlertRow, target: Target): string {
    const provenanceHint = header.url
      ? ` This header was emitted by "${redactUrl(header.url)}" (host: ${extractHost(header.url)}) — if it should only be authorised from that origin, combine the HeaderNameMatcher with a HostMatcher (host-only) or UrlMatcher (path precision) under an AndMatcher in identifyWith.`
      : ''
    return `Add a new entry to the inventory file for target ${target.url} authorising response header "${header.name}" with value "${header.value}".${provenanceHint} Use a HeaderNameMatcher for identification and a ContentMatcher for authorisation. Include authorisationInfo with a description and today's date.`
  }

  /**
   * Suggested AI prompt for a known header whose value failed authorisation.
   */
  private buildUnauthorizedHeaderAiPrompt(result: KnownHeaderWithUnauthorisedContentFound): string {
    const provenanceHint = result.header.url ? ` Note: this value was emitted by "${redactUrl(result.header.url)}" (host: ${extractHost(result.header.url)}).` : ''
    return `In the inventory file for target ${result.target.url}, the existing entry that identifies header "${result.header.name}" failed authorisation (${result.failureReason}). Update its authoriseWith matcher to allow the new value "${result.header.value}" with today's date, or investigate before authorising.${provenanceHint}`
  }

  /**
   * Creates a content snippet showing the first 100 and last 100 characters
   * of the script content, with "..." in between for easier identification.
   */
  private createContentSnippet(content: string): string {
    // External script bodies can be hundreds of KB; cut generously oversized
    // head/tail slices first so whitespace normalization never scans the
    // whole body just to render ~200 characters.
    const trimmed = content ? content.trim() : ''
    if (trimmed.length === 0) {
      return '(empty)'
    }
    const raw = trimmed.length <= 1000 ? trimmed : `${trimmed.slice(0, 500)} ${trimmed.slice(-500)}`

    // Remove leading/trailing whitespace and normalize line breaks for cleaner display
    const normalized = raw.replace(/\s+/g, ' ')

    if (normalized.length <= 203) {
      // 100 + 3 ("...") + 100 = 203
      return normalized
    }

    const start = normalized.slice(0, 100)
    const end = normalized.slice(-100)
    return `${start}...${end}`
  }

  /**
   * Summarise a completed run in Slack: what was monitored, what failed, and where the evidence is.
   *
   * Feature 010: Uses alertDestinations.successNotification directly for all modes and outcomes.
   * The headline changes with the outcome so a partial run cannot be mistaken for a clean one
   * at a glance, and every failed target is named with its pass and reason.
   */
  async alertOnRunCompletion(summary: ExecutionSummary, alertDestinations: InventoryAlert): Promise<void> {
    try {
      // Feature 010: Direct access to dedicated success destination
      const destination = alertDestinations.successNotification

      // Create and send message
      const messagePayload = this.createRunCompletionMessagePayload(summary, destination)
      const failed = summary.targetsFailed?.length ?? 0
      this.log(AlertType.Success, failed === 0 ? 'Workflow execution completed successfully' : `Workflow execution completed with ${failed} failed target(s)`)
      await this.sendMessage(messagePayload)
    } catch (error) {
      this.recordDeliveryFailure('the run summary notification', null, error)
    }
  }

  /**
   * Create the Slack Block Kit payload for the run summary.
   *
   * Green check for a clean run, warning for a partial one, red circle when
   * every target failed — the emoji is the first thing a reader scanning the
   * channel sees, so it has to carry the verdict on its own.
   */
  private createRunCompletionMessagePayload(summary: ExecutionSummary, destination: AlertDestination): object {
    const failed = summary.targetsFailed ?? []
    const undelivered = summary.alertsUndelivered ?? []
    const outcome = getExecutionOutcome(summary)
    const problems = [failed.length > 0 ? `${failed.length} Failed Target${failed.length === 1 ? '' : 's'}` : null, undelivered.length > 0 ? `${undelivered.length} Undelivered Alert${undelivered.length === 1 ? '' : 's'}` : null].filter(
      (part): part is string => part !== null,
    )
    const headline = {
      success: ':white_check_mark: *Workflow Execution Completed Successfully* :white_check_mark:',
      partial: `:warning: *Workflow Execution Completed With ${problems.join(' And ')}* :warning:`,
      failure: ':red_circle: *Workflow Execution Failed For Every Target* :red_circle:',
    }[outcome]

    return {
      channel: destination.destination,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: headline,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Execution Mode*: \`${summary.mode}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${this.formatTargetLabel(summary.targetsProcessed.length, failed.length > 0)}*: ${summary.targetsProcessed.length === 0 ? '(none)' : this.formatTargetList(summary.targetsProcessed)}`,
          },
        },
        ...this.formatFailedTargets(failed).map((text) => ({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text,
          },
        })),
        ...this.formatUndeliveredAlerts(undelivered).map((text) => ({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text,
          },
        })),
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Repository*: \`${summary.repositoryUrl}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${this.formatBranchLabel(summary.mode)}*: ${this.formatBranchDisplay(summary)}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Resources Monitored*: ${this.formatResourceCount(summary.resourceCount)}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Completed At*: ${summary.completedAt.toISOString()}`,
          },
        },
        // Optional: execution duration (P3 enhancement)
        ...(summary.executionDuration !== undefined && summary.executionDuration !== null
          ? [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Execution Duration*: ${this.formatDuration(summary.executionDuration)}`,
                },
              },
            ]
          : []),
        ...this.createAuditorReportBlocks(summary),
      ],
    }
  }

  /**
   * Link the run's auditor report, when one was produced.
   *
   * Points at the workflow run page rather than the artifact itself: the
   * artifact is uploaded by a later workflow step and has no URL yet when this
   * message is sent. The run page is the better target anyway — it offers the
   * artifact for download and shows the job-summary digest of findings inline.
   *
   * Outside CI there is no run page, so the written paths are listed instead;
   * that keeps a local run's message useful without pretending a link exists.
   */
  private createAuditorReportBlocks(summary: ExecutionSummary): object[] {
    const report = summary.auditorReport

    if (report === undefined || report === null) return []

    const label = report.htmlPaths.length === 1 ? 'Auditor Report' : 'Auditor Reports'

    if (report.runUrl === null) {
      return [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${label}*: ${report.htmlPaths.map((path) => `\`${path}\``).join(', ')}` },
        },
      ]
    }

    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${label}*: full census of every script and header, mapped to the inventory matcher that authorised it.` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'View run & download' },
          url: report.runUrl,
          action_id: 'view_auditor_report',
        },
      },
    ]
  }

  /**
   * Format target label (singular/plural).
   */
  getDeliveryFailures(): readonly AlertDeliveryFailure[] {
    return this.deliveryFailures
  }

  /**
   * Log a delivery error and keep it for the run summary.
   *
   * The per-finding paths deliberately swallow their errors so one bad message
   * cannot block the next alert; recording them here is what stops that
   * swallowing from turning into silence at the end of the run.
   */
  private recordDeliveryFailure(alert: string, target: string | null, error: unknown): void {
    console.error(`[Alert Error] Failed to send ${alert}:`, error)
    this.deliveryFailures.push({ alert, target, reason: redactForDisplay(error instanceof Error ? error.message : String(error)).text })
  }

  /**
   * A table block fitted to Slack's character budget, plus a note when rows had to go.
   *
   * `rows[0]` is the header row. Cells are clipped individually first, then
   * rows are kept in order until the budget is spent; what could not be shown
   * is named by count and pointed at the auditor report, which holds the full
   * census. An unbounded table is rejected wholesale, which is worse than a
   * shortened one.
   */
  private boundedTable(rows: object[][], totalItems: number): object[] {
    const [header, ...data] = rows
    if (header === undefined) return []

    const kept: object[][] = [header]
    let used = header.reduce((sum, cell) => sum + tableCellChars(cell), 0)
    for (const row of data) {
      const clipped = row.map((cell) => clipTableCell(cell, TABLE_CELL_CHAR_CAP) as object)
      const size = clipped.reduce((sum, cell) => sum + tableCellChars(cell), 0)
      if (used + size > TABLE_CHAR_BUDGET) break
      kept.push(clipped)
      used += size
    }

    const shown = kept.length - 1
    const blocks: object[] = [{ type: 'table', column_settings: header.map(() => ({ is_wrapped: true })), rows: kept }]
    if (shown < totalItems) {
      // Rows can be cut by the caller's row cap or by the character budget; the
      // note states the effect, not a cause it cannot know.
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `_Showing ${shown} of ${totalItems}. The full list is in the auditor report._` } })
    }
    return blocks
  }

  /**
   * Name every alert that could not be delivered, as bounded section texts.
   * Same rules as the failed-target list: nothing dropped, escaped, split.
   */
  private formatUndeliveredAlerts(undelivered: AlertDeliveryFailure[]): string[] {
    if (undelivered.length === 0) return []

    const reasonLimit = 300
    const targetLimit = 300
    const sectionLimit = 2900
    const label = undelivered.length === 1 ? 'Alert Not Delivered' : 'Alerts Not Delivered'
    const header = `*${label} (${undelivered.length})* — these findings were raised but *never reached Slack*; read them in the auditor report:`

    const clip = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit)}…` : text)
    const sections: string[] = []
    let current = header
    for (const failure of undelivered) {
      const target = failure.target === null ? '' : ` for \`${escapeMrkdwn(clip(failure.target, targetLimit))}\``
      const line = `• ${escapeMrkdwn(failure.alert)}${target}: ${escapeMrkdwn(clip(failure.reason, reasonLimit))}`
      if (current.length + 1 + line.length > sectionLimit) {
        sections.push(current)
        current = `*${label} (continued)*`
      }
      current += `\n${line}`
    }
    sections.push(current)
    return sections
  }

  private formatTargetLabel(count: number, alongsideFailures = false): string {
    // "Processed" reads as "all of them" when nothing failed; beside a failure
    // list it has to say which side of the line these targets are on.
    const noun = count === 1 ? 'Target' : 'Targets'
    return `${noun} ${alongsideFailures ? 'Succeeded' : 'Processed'}`
  }

  /**
   * Name every failed target with its pass and reason, as one or more section texts.
   *
   * Never truncated to "and N more": the whole point of this block is that a
   * reader learns exactly which payment pages went unmonitored. Slack caps a
   * section's text at 3000 characters and answers an oversize block with
   * `ok: false`, dropping the whole message — so the list is split across as
   * many sections as it needs, each reason clipped per entry, and the text is
   * escaped: the reason is an error message a tampered page can influence, and
   * raw `<!channel>` or `<url|label>` inside mrkdwn would ping or spoof.
   */
  private formatFailedTargets(failed: FailedTarget[]): string[] {
    if (failed.length === 0) return []

    const reasonLimit = 300
    const sectionLimit = 2900 // headroom under Slack's 3000-character section text cap
    const label = failed.length === 1 ? 'Target Failed' : 'Targets Failed'
    const header = `*${label} (${failed.length})* — no observations were recorded for these, so they were *not monitored* in this run:`

    const sections: string[] = []
    let current = header
    for (const target of failed) {
      const reason = target.reason.length > reasonLimit ? `${target.reason.slice(0, reasonLimit)}…` : target.reason
      const line = `• \`${escapeMrkdwn(target.name)}\` (${target.pass}): ${escapeMrkdwn(reason)}`
      if (current.length + 1 + line.length > sectionLimit) {
        sections.push(current)
        current = `*${label} (continued)*`
      }
      current += `\n${line}`
    }
    sections.push(current)
    return sections
  }

  /**
   * Format target list for display.
   * Shows first 3 targets + "and N more" if > 5 targets.
   */
  private formatTargetList(targets: string[]): string {
    if (targets.length <= 5) {
      return targets.join(', ')
    }
    const firstThree = targets.slice(0, 3)
    const remaining = targets.length - 3
    return `${firstThree.join(', ')}, and ${remaining} more`
  }

  /**
   * Format branch label based on execution mode (singular/plural).
   */
  private formatBranchLabel(mode: ExecutionMode): string {
    return mode === ExecutionMode.All ? 'Branches Used' : 'Branch Used'
  }

  /**
   * Format branch display based on execution mode.
   */
  private formatBranchDisplay(summary: ExecutionSummary): string {
    switch (summary.mode) {
      case ExecutionMode.Inventory:
      case ExecutionMode.Validate:
        return `\`${summary.inventoryBranch ?? 'unknown'}\``
      case ExecutionMode.Detection:
        return `\`${summary.detectionBranch ?? 'unknown'}\``
      // rum-compare reads both branches (detection targets from the detection
      // branch, inventory targets from the inventory branch), so both are shown.
      case ExecutionMode.All:
      case ExecutionMode.RumCompare:
        return `\`${summary.inventoryBranch ?? 'unknown'}\` (inventory), \`${summary.detectionBranch ?? 'unknown'}\` (detection)`
    }
  }

  /**
   * Format resource count with edge case warning for zero resources.
   */
  private formatResourceCount(count: number): string {
    if (count === 0) {
      return '0 scripts and headers :warning: This may warrant investigation'
    }
    return `${count} scripts and headers`
  }

  async alertOnPullRequestFailure(context: PullRequestFailureContext, alertDestinations: InventoryAlert): Promise<void> {
    try {
      const destination = alertDestinations.inventory.newScriptIdentified
      const errorMessage = context.error instanceof Error ? context.error.message : String(context.error)
      const messagePayload = {
        channel: destination.destination,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: ':rotating_light: *Inventory push succeeded but PR creation failed* :rotating_light:',
            },
          },
          { type: 'divider' },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Repository*: \`${context.repoUrl}\`` },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Head Branch*: \`${context.headBranch}\`` },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Base Branch*: \`${context.baseBranch}\`` },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Error*: \`${this.truncateText(errorMessage)}\`` },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: 'Open the PR manually so CI validation can run.' },
          },
        ],
      }
      console.log('[Alert → PRFailure]: Sending PR-failure notification')
      await this.sendMessage(messagePayload)
    } catch (error) {
      // Swallow: the caller is already exiting non-zero with the original PR
      // error; a broken alert call should not replace the useful error.
      this.recordDeliveryFailure('PR-failure notification', null, error)
    }
  }

  /**
   * Format duration in human-readable format.
   */
  private formatDuration(milliseconds: number): string {
    if (milliseconds < 1000) {
      return `${milliseconds}ms`
    }
    const seconds = Math.floor(milliseconds / 1000)
    if (seconds < 60) {
      return `${seconds}s`
    }
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }
}
