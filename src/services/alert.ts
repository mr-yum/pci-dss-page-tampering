import type { IAlertService } from '../interfaces/alert'
import type { ScriptComparisonSummary } from '../types/comparison'
import type { Target } from '../types/target'
import type { ScriptInfo } from '../types/script'

import axios from 'axios'

export class SlackAlertService implements IAlertService {
  private _webhookUrl = 'https://hooks.slack.com/services/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'

  async alert(scriptComparisonSummary: ScriptComparisonSummary, target: Target): Promise<void> {
    switch (target.type) {
      case 'detection':
        if (this.newScriptsFound(scriptComparisonSummary)) {
          const message = `Unauthorised script detected for Detection target!`
          this.log(message)

          await this.sendMessage(message, scriptComparisonSummary)
        }

        if (this.newHashesFound(scriptComparisonSummary)) {
          const message = `Script hash mismatch found for Detection target!`
          this.log(message)

          await this.sendMessage(message, scriptComparisonSummary)
        }
        break

      case 'inventory':
        if (this.newScriptsFound(scriptComparisonSummary)) {
          const message = `New unauthorised script detected for Inventory target!`
          this.log(message)

          await this.sendMessage(message, scriptComparisonSummary)
        }
        break
    }
    return Promise.resolve()
  }

  private newScriptsFound(scriptComparisonSummary: ScriptComparisonSummary): boolean {
    return this.getNewScripts(scriptComparisonSummary).length !== 0
  }

  private newHashesFound(scriptComparisonSummary: ScriptComparisonSummary): boolean {
    return this.getNewHashes(scriptComparisonSummary).length !== 0
  }

  private async sendMessage(title: string, scriptComparisonSummary: ScriptComparisonSummary): Promise<void> {
    const payload = this.createMessagePayload(title, scriptComparisonSummary)
    await axios.post(this._webhookUrl, payload)
  }

  private getNewScripts(scriptComparisonSummary: ScriptComparisonSummary): ScriptInfo[] {
    return scriptComparisonSummary.externalScripts.newScripts.concat(scriptComparisonSummary.inlineScripts.newScripts)
  }

  private getNewHashes(scriptComparisonSummary: ScriptComparisonSummary): ScriptInfo[] {
    return scriptComparisonSummary.externalScripts.newHashes.concat(scriptComparisonSummary.inlineScripts.newHashes)
  }

  private createMessagePayload(title: string, scriptComparisonSummary: ScriptComparisonSummary): object {
    const scriptInfoToResourceHashString = (scriptInfo: ScriptInfo) => {
      let resourceHashString: string

      switch (scriptInfo.source.type) {
        case 'external':
          const lastSlashIndex = scriptInfo.source.url.lastIndexOf('/')
          const scriptName = scriptInfo.source.url.slice(lastSlashIndex + 1)

          resourceHashString = `${scriptName}:${scriptInfo.hash.value}`
          break
        case 'inline':
          resourceHashString = `${scriptInfo.source.id}:${scriptInfo.hash.value}`
          break
      }

      return resourceHashString.slice(0, 75) // Slack only allows a max text length of 76.
    }

    const getMessageBlock = (blockTitle: string, options: string[]) => {
      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${blockTitle}*`,
        },
        accessory: {
          type: 'static_select',
          placeholder: {
            type: 'plain_text',
            text: 'View detected changes',
            emoji: true,
          },
          options: options.map((option) => {
            return {
              text: {
                type: 'plain_text',
                text: `${option}`,
                emoji: true,
              },
              value: `${option}`,
            }
          }),
          action_id: 'static_select-action',
        },
      }
    }

    const newScriptsMessageValues = this.getNewScripts(scriptComparisonSummary).map(scriptInfoToResourceHashString)
    const newHashesMessageValues = this.getNewHashes(scriptComparisonSummary).map(scriptInfoToResourceHashString)

    const messageBlock = newScriptsMessageValues.length > 0 ? getMessageBlock('Detected Scripts', newScriptsMessageValues) : getMessageBlock('Detected Hashes', newHashesMessageValues)

    return {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${title}*`,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Target Type*\n- \`${scriptComparisonSummary.target.type}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Target Source*\n- \`${scriptComparisonSummary.target.url}\``,
          },
        },
        messageBlock,
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

  private log(message: string): void {
    console.log(`[Alert]: ${message}`)
  }
}
