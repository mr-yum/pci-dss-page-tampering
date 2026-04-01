import axios from 'axios'

import type { IAlertService } from '../../interfaces/alert'
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

export class SlackAlertService implements IAlertService {
  private readonly oAuthToken: string
  private readonly repositoryUrl: string
  private readonly maxStringLength = 100

  constructor(slackToken: string, repositoryUrl: string) {
    this.oAuthToken = slackToken
    this.repositoryUrl = repositoryUrl
  }

  private getReviewChangesUrl(): string {
    const baseUrl = this.repositoryUrl.replace(/\.git$/, '')
    return `${baseUrl}/compare/update/scripts?expand=1`
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
  async alertForTypedResults(comparisonResults: ComparisonResultType[], target: Target, alertDestinations: InventoryAlert): Promise<void> {
    // Group results by type for batch processing
    const unknownScripts = comparisonResults.filter((r): r is UnknownScriptFound => r.type === 'unknown_script_found')
    const unauthorizedScripts = comparisonResults.filter((r): r is KnownScriptWithUnauthorisedContentFound => r.type === 'known_script_unauthorised_content')
    const unknownHeaders = comparisonResults.filter((r): r is UnknownHeaderFound => r.type === 'unknown_header_found')
    const unauthorizedHeaders = comparisonResults.filter((r): r is KnownHeaderWithUnauthorisedContentFound => r.type === 'known_header_unauthorised_content')

    // T033: Try-catch for each alert type to prevent blocking
    try {
      // Handle unknown scripts
      if (unknownScripts.length > 0) {
        const destination = target.type === 'inventory' ? alertDestinations.inventory.newScriptIdentified : alertDestinations.detection.newScriptDetected
        await this.alertOnUnknownScripts(unknownScripts, target, destination)
      }
    } catch (error) {
      console.error('[Alert Error] Failed to send unknown script alerts:', error)
    }

    try {
      // Handle unauthorized scripts
      if (unauthorizedScripts.length > 0 && target.type === 'detection') {
        await this.alertOnUnauthorizedScripts(unauthorizedScripts, target, alertDestinations.detection.scriptMismatchDetected)
      }
    } catch (error) {
      console.error('[Alert Error] Failed to send unauthorized script alerts:', error)
    }

    try {
      // T031: Handle unknown headers with workflow-based routing
      if (unknownHeaders.length > 0) {
        const destination = target.type === 'inventory' ? alertDestinations.inventory.newHeaderIdentified : alertDestinations.detection.newHeaderDetected
        await this.alertOnUnknownHeaders(unknownHeaders, target, destination)
      }
    } catch (error) {
      console.error('[Alert Error] Failed to send unknown header alerts:', error)
    }

    try {
      // T032: Handle unauthorized headers
      if (unauthorizedHeaders.length > 0 && target.type === 'detection') {
        await this.alertOnUnauthorizedHeaders(unauthorizedHeaders, target, alertDestinations.detection.scriptMismatchDetected)
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
   */
  private async alertOnUnauthorizedScripts(unauthorizedScripts: KnownScriptWithUnauthorisedContentFound[], target: Target, destination: AlertDestination): Promise<void> {
    const message = `Script hash mismatch detected for target!`

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

    // Convert typed results to HeaderInfo for alert payload
    const headers: HeaderInfo[] = unknownHeaders.map((result) => ({
      name: result.header.name,
      value: result.header.value,
    }))

    const messagePayload = this.createHeaderMessagePayload(message, headers, target, destination)

    this.log(AlertType.Header, message)
    await this.sendMessage(messagePayload)
  }

  /**
   * T032: Alert on unauthorized headers with matcher details and failure reason.
   * Includes matcher type, pattern, and why authorization failed.
   */
  private async alertOnUnauthorizedHeaders(unauthorizedHeaders: KnownHeaderWithUnauthorisedContentFound[], target: Target, destination: AlertDestination): Promise<void> {
    const message = `Header content mismatch detected for target!`

    const messagePayload = this.createUnauthorizedHeaderMessagePayload(message, unauthorizedHeaders, target, destination)

    this.log(AlertType.Header, message)
    await this.sendMessage(messagePayload)
  }

  /**
   * Converts DetectedScript from comparison result to ScriptInfo for legacy alert compatibility.
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
        },
        hash: detectedScript.hash,
      }
    }
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
          rows: [
            [
              {
                type: 'rich_text',
                elements: [
                  {
                    type: 'rich_text_section',
                    elements: [
                      {
                        type: 'text',
                        text: 'Identifier',
                        style: {
                          bold: true,
                        },
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
                        text: 'Hash',
                        style: {
                          bold: true,
                        },
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
                        text: 'Content Snippet',
                        style: {
                          bold: true,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
            ...scripts.slice(0, 19).map((scriptInfo) => this.scriptInfoToTableItem(scriptInfo)),
          ],
        },
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
          rows: [
            [
              {
                type: 'rich_text',
                elements: [
                  {
                    type: 'rich_text_section',
                    elements: [
                      {
                        type: 'text',
                        text: 'Identifier',
                        style: {
                          bold: true,
                        },
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
                        text: 'Hash',
                        style: {
                          bold: true,
                        },
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
                        text: 'Content',
                        style: {
                          bold: true,
                        },
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
                        text: 'Failure Reason',
                        style: {
                          bold: true,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
            ...unauthorizedScripts.slice(0, 19).map((result) => this.unauthorizedScriptToTableItem(result)),
          ],
        },
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
          rows: [
            [
              {
                type: 'rich_text',
                elements: [
                  {
                    type: 'rich_text_section',
                    elements: [
                      {
                        type: 'text',
                        text: 'Header Name',
                        style: {
                          bold: true,
                        },
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
                        text: 'Value',
                        style: {
                          bold: true,
                        },
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
                        text: 'Failure Reason',
                        style: {
                          bold: true,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
            ...unauthorizedHeaders.slice(0, 19).map((result) => this.unauthorizedHeaderToTableItem(result)),
          ],
        },
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

  private createHeaderMessagePayload(title: string, headers: HeaderInfo[], target: Target, destination: AlertDestination): object {
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
          rows: [
            [
              {
                type: 'rich_text',
                elements: [
                  {
                    type: 'rich_text_section',
                    elements: [
                      {
                        type: 'text',
                        text: 'Header Name',
                        style: {
                          bold: true,
                        },
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
                        text: 'Value',
                        style: {
                          bold: true,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
            ...headers.slice(0, 19).map((headerInfo) => this.headerInfoToTableItem(headerInfo)),
          ],
        },
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
