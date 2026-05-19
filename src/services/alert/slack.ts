import axios from 'axios'

import type { IAlertService, PullRequestFailureContext } from '../../interfaces/alert'
import { AlertType } from '../../types/alert'
import type { ComparisonResultType } from '../../types/comparison'
import type { KnownHeaderWithUnauthorisedContentFound } from '../../types/comparison/known-header-unauthorised-content-found'
import type { KnownScriptWithUnauthorisedContentFound } from '../../types/comparison/known-script-unauthorised-content-found'
import type { UnknownHeaderFound } from '../../types/comparison/unknown-header-found'
import type { UnknownScriptFound } from '../../types/comparison/unknown-script-found'
import { ExecutionMode } from '../../types/config'
import type { ExecutionSummary } from '../../types/execution-summary'
import type { HeaderInfo } from '../../types/header'
import type { AlertDestination, InventoryAlert } from '../../types/inventory/model'
import type { ScriptInfo } from '../../types/script'
import type { Target } from '../../types/target'
import { extractHost } from '../../utils/url'

/**
 * Row passed to the unknown-header alert table. Carries the originating
 * response URL so the notification can show host (via extractHost) and so
 * AI prompts can quote the full URL when suggesting `hostMatcher` /
 * `urlMatcher` regexes.
 */
type HeaderAlertRow = HeaderInfo & { url?: string; detectedTarget: Target }

export class SlackAlertService implements IAlertService {
  private readonly oAuthToken: string
  private readonly repositoryUrl: string
  private readonly inventoryBranch: string
  private readonly maxStringLength = 100
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
      console.error('[Alert Error] Failed to send unknown script alerts:', error)
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
      console.error('[Alert Error] Failed to send unauthorized script alerts:', error)
    }

    try {
      // T031: Handle unknown headers with workflow-based routing
      if (unknownHeaders.length > 0) {
        const destination = isInventoryMode ? alertDestinations.inventory.newHeaderIdentified : alertDestinations.detection.newHeaderDetected
        await this.alertOnUnknownHeaders(unknownHeaders, target, destination)
      }
    } catch (error) {
      console.error('[Alert Error] Failed to send unknown header alerts:', error)
    }

    try {
      // Headers identified but with unauthorised content — same split as
      // scripts. "Inventory updated" only fires for results the diff actually
      // appended a new content matcher for; the rest get a manual-review
      // message so operators aren't told the inventory changed when it didn't.
      if (unauthorizedHeaders.length > 0) {
        const destination = isInventoryMode ? alertDestinations.inventory.newHeaderIdentified : alertDestinations.detection.scriptMismatchDetected
        const { applied, skipped } = splitByApplied(unauthorizedHeaders)
        if (applied.length > 0) {
          await this.alertOnUnauthorizedHeaders(applied, target, destination, 'updated')
        }
        if (skipped.length > 0) {
          await this.alertOnUnauthorizedHeaders(skipped, target, destination, 'manual-review')
        }
      }
    } catch (error) {
      console.error('[Alert Error] Failed to send unauthorized header alerts:', error)
    }

    // T030: AuthorizedScriptFound and AuthorizedHeaderFound are no-ops (no alert)
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

  /**
   * Converts DetectedScript from comparison result to ScriptInfo for legacy
   * alert compatibility. `detectedScript.url` (the initiator URL for inline
   * scripts, the script's own URL for external) is propagated into the
   * resulting source so the alert table can render a Host column derived
   * from it via extractHost.
   */
  private detectedScriptToScriptInfo(detectedScript: any): ScriptInfo {
    // Parse script name to determine type (URL vs inline ID)
    const isUrl = detectedScript.name.startsWith('http://') || detectedScript.name.startsWith('https://')

    if (isUrl) {
      return {
        source: {
          type: 'external',
          url: detectedScript.name,
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

  private async sendMessage(messagePayload: object): Promise<void> {
    const postMessageEndpoint = 'https://slack.com/api/chat.postMessage'
    await axios.post(postMessageEndpoint, messagePayload, { headers: { Authorization: `Bearer ${this.oAuthToken}`, 'Content-Type': 'application/json' } })
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
        {
          type: 'table',
          column_settings: [{ is_wrapped: true }, { is_wrapped: true }, { is_wrapped: true }, { is_wrapped: true }, { is_wrapped: true }],
          rows: [
            [this.buildBoldHeaderCell('Identifier'), this.buildBoldHeaderCell('Hash'), this.buildBoldHeaderCell('Content Snippet'), this.buildBoldHeaderCell('Host'), this.buildBoldHeaderCell('Suggested AI Prompt')],
            ...scripts.slice(0, 19).map((scriptInfo) => [...this.scriptInfoToTableItem(scriptInfo), this.buildRichTextCell(extractHost(this.getScriptUrl(scriptInfo))), this.buildRichTextCell(this.buildScriptAiPrompt(scriptInfo, target))]),
          ],
        },
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
        {
          type: 'table',
          column_settings: [{ is_wrapped: true }, { is_wrapped: true }, { is_wrapped: true }, { is_wrapped: true }, { is_wrapped: true }, { is_wrapped: true }],
          rows: [
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
        },
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
        {
          type: 'table',
          column_settings: [{ is_wrapped: true }, { is_wrapped: true }, { is_wrapped: true }, { is_wrapped: true }, { is_wrapped: true }],
          rows: [
            [this.buildBoldHeaderCell('Header Name'), this.buildBoldHeaderCell('Value'), this.buildBoldHeaderCell('Host'), this.buildBoldHeaderCell('Failure Reason'), this.buildBoldHeaderCell('Suggested AI Prompt')],
            ...unauthorizedHeaders.slice(0, 19).map((result) => [...this.unauthorizedHeaderToTableItem(result), this.buildRichTextCell(this.buildUnauthorizedHeaderAiPrompt(result))]),
          ],
        },
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
        {
          type: 'table',
          column_settings: [{ is_wrapped: true }, { is_wrapped: true }, { is_wrapped: true }, { is_wrapped: true }],
          rows: [
            [this.buildBoldHeaderCell('Header Name'), this.buildBoldHeaderCell('Value'), this.buildBoldHeaderCell('Host'), this.buildBoldHeaderCell('Suggested AI Prompt')],
            ...headers.slice(0, 19).map((row) => [...this.headerInfoToTableItem({ name: row.name, value: row.value }), this.buildRichTextCell(extractHost(row.url)), this.buildRichTextCell(this.buildHeaderAiPrompt(row, target))]),
          ],
        },
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
        contentSnippet = 'N/A (external)'
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
      ? ` This header was emitted by "${header.url}" (host: ${extractHost(header.url)}) — if it should only be authorised from that origin, combine the HeaderNameMatcher with a HostMatcher (host-only) or UrlMatcher (full-URL precision) under an AndMatcher in identifyWith.`
      : ''
    return `Add a new entry to the inventory file for target ${target.url} authorising response header "${header.name}" with value "${header.value}".${provenanceHint} Use a HeaderNameMatcher for identification and a ContentMatcher for authorisation. Include authorisationInfo with a description and today's date.`
  }

  /**
   * Suggested AI prompt for a known header whose value failed authorisation.
   */
  private buildUnauthorizedHeaderAiPrompt(result: KnownHeaderWithUnauthorisedContentFound): string {
    const provenanceHint = result.header.url ? ` Note: this value was emitted by "${result.header.url}" (host: ${extractHost(result.header.url)}).` : ''
    return `In the inventory file for target ${result.target.url}, the existing entry that identifies header "${result.header.name}" failed authorisation (${result.failureReason}). Update its authoriseWith matcher to allow the new value "${result.header.value}" with today's date, or investigate before authorising.${provenanceHint}`
  }

  /**
   * Creates a content snippet showing the first 100 and last 100 characters
   * of the script content, with "..." in between for easier identification.
   */
  private createContentSnippet(content: string): string {
    if (!content || content.length === 0) {
      return '(empty)'
    }

    // Remove leading/trailing whitespace and normalize line breaks for cleaner display
    const normalized = content.trim().replace(/\s+/g, ' ')

    if (normalized.length <= 203) {
      // 100 + 3 ("...") + 100 = 203
      return normalized
    }

    const start = normalized.slice(0, 100)
    const end = normalized.slice(-100)
    return `${start}...${end}`
  }

  /**
   * Alert for successful workflow execution.
   * Sends informational Slack notification when workflows complete without errors.
   *
   * Feature 010: Uses alertDestinations.successNotification directly for all modes.
   * This routes success notifications to a dedicated destination separate from violation alerts.
   */
  async alertOnSuccess(summary: ExecutionSummary, alertDestinations: InventoryAlert): Promise<void> {
    try {
      // Feature 010: Direct access to dedicated success destination
      const destination = alertDestinations.successNotification

      // Create and send message
      const messagePayload = this.createSuccessMessagePayload(summary, destination)
      this.log(AlertType.Success, 'Workflow execution completed successfully')
      await this.sendMessage(messagePayload)
    } catch (error) {
      console.error('[Alert Error] Failed to send success notification:', error)
    }
  }

  /**
   * Create Slack Block Kit payload for success notification.
   * Uses green check mark emoji for visual distinction from violation alerts.
   */
  private createSuccessMessagePayload(summary: ExecutionSummary, destination: AlertDestination): object {
    return {
      channel: destination.destination,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ':white_check_mark: *Workflow Execution Completed Successfully* :white_check_mark:',
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
            text: `*${this.formatTargetLabel(summary.targetsProcessed.length)}*: ${this.formatTargetList(summary.targetsProcessed)}`,
          },
        },
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
      ],
    }
  }

  /**
   * Format target label (singular/plural).
   */
  private formatTargetLabel(count: number): string {
    return count === 1 ? 'Target Processed' : 'Targets Processed'
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
      case ExecutionMode.All:
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
      console.error('[Alert Error] Failed to send PR-failure notification:', error)
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
