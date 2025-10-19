import axios from 'axios'

import type { IAlertService } from '../../interfaces/alert'
import { AlertType } from '../../types/alert'
import type { ComparisonResultType, HeaderComparisonSummary, ScriptComparisonSummary } from '../../types/comparison'
import type { KnownHeaderWithUnauthorisedContentFound } from '../../types/comparison/known-header-unauthorised-content-found'
import type { KnownScriptWithUnauthorisedContentFound } from '../../types/comparison/known-script-unauthorised-content-found'
import type { UnknownHeaderFound } from '../../types/comparison/unknown-header-found'
import type { UnknownScriptFound } from '../../types/comparison/unknown-script-found'
import type { HeaderInfo, HeaderName, HeaderValues } from '../../types/header'
import type { AlertDestination, InventoryAlert } from '../../types/inventory/model'
import type { ScriptInfo } from '../../types/script'
import type { Target } from '../../types/target'

export class SlackAlertService implements IAlertService {
  private readonly oAuthToken: string
  private readonly maxStringLength = 100

  constructor(slackToken: string) {
    this.oAuthToken = slackToken
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
   * @deprecated T036: Use alertForTypedResults instead.
   * This method is deprecated and will be removed in a future release.
   * Migrate to alertForTypedResults which handles both scripts and headers with complete context.
   */
  async alertForScripts(scriptComparisonSummary: ScriptComparisonSummary, target: Target, alertDestinations: InventoryAlert): Promise<void> {
    switch (target.type) {
      case 'inventory':
        await this.alertOnNewScripts(scriptComparisonSummary, target, alertDestinations.inventory.newScriptIdentified)
        break
      case 'detection':
        await this.alertOnNewScripts(scriptComparisonSummary, target, alertDestinations.detection.newScriptDetected)
        await this.alertOnNewHashes(scriptComparisonSummary, target, alertDestinations.detection.scriptMismatchDetected)
        break
    }
  }

  /**
   * @deprecated T037: Use alertForTypedResults instead.
   * This method is deprecated and will be removed in a future release.
   * Migrate to alertForTypedResults which handles both scripts and headers with complete context.
   */
  async alertForHeaders(headerComparisonSummary: HeaderComparisonSummary, target: Target, alertDestinations: InventoryAlert): Promise<void> {
    if (headerComparisonSummary.unauthorisedHeaders) {
      const headers = this.headerComparisonSummaryToHeaderInfo(headerComparisonSummary.unauthorisedHeaders)

      switch (target.type) {
        case 'inventory':
          await this.alertOnNewHeaders(headers, target, alertDestinations.inventory.newHeaderIdentified)
          break
        case 'detection':
          await this.alertOnNewHeaders(headers, target, alertDestinations.detection.newHeaderDetected)
          break
      }
    }
  }

  private async alertOnNewHeaders(headers: HeaderInfo[], target: Target, destination: AlertDestination): Promise<void> {
    const message = `Unauthorised headers detected for target!`
    const messagePayload = this.createHeaderMessagePayload(message, headers, target, destination)

    this.log(AlertType.Header, message)
    await this.sendMessage(messagePayload)
  }

  private async alertOnNewScripts(scriptComparisonSummary: ScriptComparisonSummary, target: Target, destination: AlertDestination): Promise<void> {
    if (this.newScriptsFound(scriptComparisonSummary)) {
      const message = `Unauthorised scripts detected for target!`
      const newScripts = this.getNewScripts(scriptComparisonSummary)
      const messagePayload = this.createScriptMessagePayload(message, newScripts, target, destination)

      this.log(AlertType.Script, message)
      await this.sendMessage(messagePayload)
    }
  }

  private async alertOnNewHashes(scriptComparisonSummary: ScriptComparisonSummary, target: Target, destination: AlertDestination): Promise<void> {
    if (this.newHashesFound(scriptComparisonSummary)) {
      const message = `Script hash mismatch detected for target!`
      const newHashes = this.getNewHashes(scriptComparisonSummary)
      const messagePayload = this.createScriptMessagePayload(message, newHashes, target, destination)

      this.log(AlertType.Script, message)
      await this.sendMessage(messagePayload)
    }
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

  private newScriptsFound(scriptComparisonSummary: ScriptComparisonSummary): boolean {
    return this.getNewScripts(scriptComparisonSummary).length !== 0
  }

  private newHashesFound(scriptComparisonSummary: ScriptComparisonSummary): boolean {
    return this.getNewHashes(scriptComparisonSummary).length !== 0
  }

  private async sendMessage(messagePayload: object): Promise<void> {
    const postMessageEndpoint = 'https://slack.com/api/chat.postMessage'
    await axios.post(postMessageEndpoint, messagePayload, { headers: { Authorization: `Bearer ${this.oAuthToken}`, 'Content-Type': 'application/json' } })
  }

  private getNewScripts(scriptComparisonSummary: ScriptComparisonSummary): ScriptInfo[] {
    return scriptComparisonSummary.externalScripts.newScripts.concat(scriptComparisonSummary.inlineScripts.newScripts)
  }

  private getNewHashes(scriptComparisonSummary: ScriptComparisonSummary): ScriptInfo[] {
    return scriptComparisonSummary.externalScripts.newHashes.concat(scriptComparisonSummary.inlineScripts.newHashes)
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
              url: 'https://github.com/mr-yum/script-inventory/compare/update/scripts?expand=1',
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
              url: 'https://github.com/mr-yum/script-inventory/compare/update/scripts?expand=1',
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
              url: 'https://github.com/mr-yum/script-inventory/compare/update/scripts?expand=1',
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
                text: this.truncateText(result.header.value),
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
              url: 'https://github.com/mr-yum/script-inventory/compare/update/scripts?expand=1',
            },
          ],
        },
      ],
    }
  }

  private scriptInfoToTableItem(scriptInfo: ScriptInfo) {
    let scriptIdentifier: string

    switch (scriptInfo.source.type) {
      case 'external':
        scriptIdentifier = scriptInfo.source.url
        break
      case 'inline':
        scriptIdentifier = scriptInfo.source.id
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

  private headerComparisonSummaryToHeaderInfo(unauthorisedHeaders: Map<HeaderName, HeaderValues>): HeaderInfo[] {
    return [...unauthorisedHeaders].flatMap(([headerName, headerValues]) => {
      const headerValuesArray = [...headerValues.values()]
      return headerValuesArray.map<HeaderInfo>((headerValue) => {
        return {
          name: headerName,
          value: this.truncateText(headerValue),
        }
      })
    })
  }

  private log(alertType: AlertType, message: string): void {
    console.log(`[Alert → ${alertType}]: ${message}`)
  }

  private truncateText(text: string): string {
    return text.length > this.maxStringLength ? text.slice(0, this.maxStringLength - 4).concat('...') : text
  }
}
