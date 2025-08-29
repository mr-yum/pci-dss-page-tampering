import type { IAlertService } from '../../interfaces/alert'
import type { HeaderComparisonSummary, ScriptComparisonSummary } from '../../types/comparison'
import type { Target } from '../../types/target'
import type { ScriptInfo } from '../../types/script'
import type { HeaderInfo, HeaderName, HeaderValues } from '../../types/header'

import { AlertType } from '../../types/alert'
import axios from 'axios'

export class SlackAlertService implements IAlertService {
  /* #_pci-page-tampering-alerts */
  private readonly _webhookUrl = 'https://hooks.slack.com/services/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'
  private readonly maxStringLength = 100

  async alertForScripts(scriptComparisonSummary: ScriptComparisonSummary, target: Target): Promise<void> {
    switch (target.type) {
      case 'inventory':
        await this.alertOnNewScripts(scriptComparisonSummary, target)
        break
      case 'detection':
        await this.alertOnNewScripts(scriptComparisonSummary, target)
        await this.alertOnNewHashes(scriptComparisonSummary, target)
        break
    }
  }

  async alertForHeaders(headerComparisonSummary: HeaderComparisonSummary, target: Target): Promise<void> {
    if (headerComparisonSummary.unauthorisedHeaders) {
      const message = `Unauthorised headers detected for target!`
      const headers = this.headerComparisonSummaryToHeaderInfo(headerComparisonSummary.unauthorisedHeaders)
      const messagePayload = this.createHeaderMessagePayload(message, headers, target)

      this.log(AlertType.Header, message)
      await this.sendMessage(messagePayload)
    }
  }

  private async alertOnNewScripts(scriptComparisonSummary: ScriptComparisonSummary, target: Target): Promise<void> {
    if (this.newScriptsFound(scriptComparisonSummary)) {
      const message = `Unauthorised scripts detected for target!`
      const newScripts = this.getNewScripts(scriptComparisonSummary)
      const messagePayload = this.createScriptMessagePayload(message, newScripts, target)

      this.log(AlertType.Script, message)
      await this.sendMessage(messagePayload)
    }
  }

  private async alertOnNewHashes(scriptComparisonSummary: ScriptComparisonSummary, target: Target): Promise<void> {
    if (this.newHashesFound(scriptComparisonSummary)) {
      const message = `Script hash mismatch detected for target!`
      const newHashes = this.getNewHashes(scriptComparisonSummary)
      const messagePayload = this.createScriptMessagePayload(message, newHashes, target)

      this.log(AlertType.Script, message)
      await this.sendMessage(messagePayload)
    }
  }

  private newScriptsFound(scriptComparisonSummary: ScriptComparisonSummary): boolean {
    return this.getNewScripts(scriptComparisonSummary).length !== 0
  }

  private newHashesFound(scriptComparisonSummary: ScriptComparisonSummary): boolean {
    return this.getNewHashes(scriptComparisonSummary).length !== 0
  }

  private async sendMessage(messagePayload: object): Promise<void> {
    await axios.post(this._webhookUrl, messagePayload)
  }

  private getNewScripts(scriptComparisonSummary: ScriptComparisonSummary): ScriptInfo[] {
    return scriptComparisonSummary.externalScripts.newScripts.concat(scriptComparisonSummary.inlineScripts.newScripts)
  }

  private getNewHashes(scriptComparisonSummary: ScriptComparisonSummary): ScriptInfo[] {
    return scriptComparisonSummary.externalScripts.newHashes.concat(scriptComparisonSummary.inlineScripts.newHashes)
  }

  private createScriptMessagePayload(title: string, scripts: ScriptInfo[], target: Target): object {
    return {
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

  private createHeaderMessagePayload(title: string, headers: HeaderInfo[], target: Target): object {
    return {
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
