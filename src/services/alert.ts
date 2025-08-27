import type { IAlertService } from '../interfaces/alert'
import type { ScriptComparisonSummary } from '../types/comparison'
import type { Target } from '../types/target'
import type { ScriptInfo } from '../types/script'

import axios from 'axios'

export class SlackAlertService implements IAlertService {
  /* #_pci-page-tampering-alerts */
  private _webhookUrl = 'https://hooks.slack.com/services/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'

  async alert(scriptComparisonSummary: ScriptComparisonSummary, _target: Target): Promise<void> {
    // if (this.changedHeadersFound(scriptComparisonSummary)) {
    //   const message = `Header content changes detected for target!`
    //   const changedHeaders = this.getChangedHeaders(scriptComparisonSummary)
    //
    //   this.log(message)
    //   await this.sendHeaderMessage(message, changedHeaders, scriptComparisonSummary.target)
    // }

    if (this.newScriptsFound(scriptComparisonSummary)) {
      const message = `Unauthorised scripts detected for target!`
      const newScripts = this.getNewScripts(scriptComparisonSummary)

      this.log(message)
      await this.sendMessage(message, newScripts, scriptComparisonSummary.target)
    }

    if (this.newHashesFound(scriptComparisonSummary)) {
      const message = `Script hash mismatch detected for target!`
      const newHashes = this.getNewHashes(scriptComparisonSummary)

      this.log(message)
      await this.sendMessage(message, newHashes, scriptComparisonSummary.target)
    }

    return Promise.resolve()
  }

  private newScriptsFound(scriptComparisonSummary: ScriptComparisonSummary): boolean {
    return this.getNewScripts(scriptComparisonSummary).length !== 0
  }

  private newHashesFound(scriptComparisonSummary: ScriptComparisonSummary): boolean {
    return this.getNewHashes(scriptComparisonSummary).length !== 0
  }

  // private changedHeadersFound(scriptComparisonSummary: ScriptComparisonSummary): boolean {
  //   return this.getChangedHeaders(scriptComparisonSummary).length !== 0
  // }

  private async sendMessage(title: string, scripts: ScriptInfo[], target: Target): Promise<void> {
    const payload = this.createMessagePayload(title, scripts, target)
    await axios.post(this._webhookUrl, payload)
  }

  // private async sendHeaderMessage(title: string, headers: HeaderInfo[], target: Target): Promise<void> {
  //   const payload = this.createHeaderMessagePayload(title, headers, target)
  //   await axios.post(this._webhookUrl, payload)
  // }

  private getNewScripts(scriptComparisonSummary: ScriptComparisonSummary): ScriptInfo[] {
    return scriptComparisonSummary.externalScripts.newScripts.concat(scriptComparisonSummary.inlineScripts.newScripts)
  }

  private getNewHashes(scriptComparisonSummary: ScriptComparisonSummary): ScriptInfo[] {
    return scriptComparisonSummary.externalScripts.newHashes.concat(scriptComparisonSummary.inlineScripts.newHashes)
  }

  // private getChangedHeaders(scriptComparisonSummary: ScriptComparisonSummary): HeaderInfo[] {
  //   return scriptComparisonSummary.headers?.changedHeaders || []
  // }

  private createMessagePayload(title: string, scripts: ScriptInfo[], target: Target): object {
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
            text: `*Detection Summary*`,
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
            ...scripts.map(this.scriptInfoToTableItem),
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

  // private createHeaderMessagePayload(title: string, headers: HeaderInfo[], target: Target): object {
  //   return {
  //     blocks: [
  //       {
  //         type: 'section',
  //         text: {
  //           type: 'mrkdwn',
  //           text: `:warning: *${title}* :warning:`,
  //         },
  //       },
  //       {
  //         type: 'divider',
  //       },
  //       {
  //         type: 'section',
  //         text: {
  //           type: 'mrkdwn',
  //           text: `*Target Type*: \`${target.type}\``,
  //         },
  //       },
  //       {
  //         type: 'section',
  //         text: {
  //           type: 'mrkdwn',
  //           text: `*Target Source*: \`${target.url}\``,
  //         },
  //       },
  //       {
  //         type: 'section',
  //         text: {
  //           type: 'mrkdwn',
  //           text: `*Number of Detected Changes*: ${headers.length}`,
  //         },
  //       },
  //       {
  //         type: 'section',
  //         text: {
  //           type: 'mrkdwn',
  //           text: `*Header Changes Summary*`,
  //         },
  //       },
  //       {
  //         type: 'table',
  //         rows: [
  //           [
  //             {
  //               type: 'rich_text',
  //               elements: [
  //                 {
  //                   type: 'rich_text_section',
  //                   elements: [
  //                     {
  //                       type: 'text',
  //                       text: 'Header Name',
  //                       style: {
  //                         bold: true,
  //                       },
  //                     },
  //                   ],
  //                 },
  //               ],
  //             },
  //             {
  //               type: 'rich_text',
  //               elements: [
  //                 {
  //                   type: 'rich_text_section',
  //                   elements: [
  //                     {
  //                       type: 'text',
  //                       text: 'Current Content',
  //                       style: {
  //                         bold: true,
  //                       },
  //                     },
  //                   ],
  //                 },
  //               ],
  //             },
  //           ],
  //           ...headers.map(this.headerInfoToTableItem),
  //         ],
  //       },
  //       {
  //         type: 'section',
  //         text: {
  //           type: 'mrkdwn',
  //           text: 'Please review the changes as soon as possible:',
  //         },
  //       },
  //       {
  //         type: 'actions',
  //         elements: [
  //           {
  //             type: 'button',
  //             text: {
  //               type: 'plain_text',
  //               text: 'Review changes',
  //             },
  //             url: 'https://github.com/mr-yum/script-inventory/compare/update/scripts?expand=1',
  //           },
  //         ],
  //       },
  //     ],
  //   }
  // }

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
                text: scriptIdentifier,
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
                text: scriptInfo.hash.value,
              },
            ],
          },
        ],
      },
    ]
  }

  // private headerInfoToTableItem(headerInfo: HeaderInfo) {
  //   return [
  //     {
  //       type: 'rich_text',
  //       elements: [
  //         {
  //           type: 'rich_text_section',
  //           elements: [
  //             {
  //               type: 'text',
  //               text: headerInfo.name,
  //             },
  //           ],
  //         },
  //       ],
  //     },
  //     {
  //       type: 'rich_text',
  //       elements: [
  //         {
  //           type: 'rich_text_section',
  //           elements: [
  //             {
  //               type: 'text',
  //               text: headerInfo.value,
  //             },
  //           ],
  //         },
  //       ],
  //     },
  //   ]
  // }

  private log(message: string): void {
    console.log(`[Alert]: ${message}`)
  }
}
