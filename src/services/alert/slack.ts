import type { IAlertService } from '../../interfaces/alert'
import type { HeaderComparisonSummary, ScriptComparisonSummary } from '../../types/comparison'
import type { Target } from '../../types/target'
import type { ScriptInfo } from '../../types/script'
import type { HeaderInfo, HeaderName, HeaderValues } from '../../types/header'
import type { AlertDestination, InventoryAlert } from '../../types/inventory/model'

import { AlertType } from '../../types/alert'
import type { ComparisonResultType, UnknownScriptFound, KnownScriptWithUnauthorisedContentFound } from '../../types/comparison'
import axios from 'axios'

export class SlackAlertService implements IAlertService {
  private readonly oAuthToken: string
  private readonly maxStringLength = 100

  constructor(slackToken: string) {
    this.oAuthToken = slackToken
  }

  /**
   * T058, T059, T060: Updated to handle typed comparison results.
   * Switches on result.type to route to appropriate alert method.
   */
  async alertForTypedResults(comparisonResults: ComparisonResultType[], target: Target, alertDestinations: InventoryAlert): Promise<void> {
    // Filter results by type
    const unknownScripts = comparisonResults.filter((r): r is UnknownScriptFound => r.type === 'unknown_script_found')
    const unauthorizedScripts = comparisonResults.filter((r): r is KnownScriptWithUnauthorisedContentFound => r.type === 'known_script_unauthorised_content')

    // Send alerts based on target type and result type
    switch (target.type) {
      case 'inventory':
        if (unknownScripts.length > 0) {
          await this.alertOnUnknownScripts(unknownScripts, target, alertDestinations.inventory.newScriptIdentified)
        }
        break
      case 'detection':
        if (unknownScripts.length > 0) {
          await this.alertOnUnknownScripts(unknownScripts, target, alertDestinations.detection.newScriptDetected)
        }
        if (unauthorizedScripts.length > 0) {
          await this.alertOnUnauthorizedScripts(unauthorizedScripts, target, alertDestinations.detection.scriptMismatchDetected)
        }
        break
    }
  }

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
    const scripts = unknownScripts.map(result => this.detectedScriptToScriptInfo(result.script))
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
    const messagePayload = this.createUnauthorizedScriptMessagePayload(
      message,
      unauthorizedScripts,
      target,
      destination
    )

    this.log(AlertType.Script, message)
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
          url: detectedScript.name
        },
        hash: detectedScript.hash
      }
    } else {
      return {
        source: {
          type: 'inline',
          id: detectedScript.name,
          content: detectedScript.content ?? ''
        },
        hash: detectedScript.hash
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
  private createUnauthorizedScriptMessagePayload(
    title: string,
    unauthorizedScripts: KnownScriptWithUnauthorisedContentFound[],
    target: Target,
    destination: AlertDestination
  ): object {
    const scripts = unauthorizedScripts.map(result => this.detectedScriptToScriptInfo(result.script))

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
