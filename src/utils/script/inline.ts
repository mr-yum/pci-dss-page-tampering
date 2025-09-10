import type { PageScriptElement } from '../../types/page'

/*
  Returns `inline_script/id_not_found` if we cannot match on known in-line script code.

  Known in-line script code include:
    - [Cloudflare Bot Flight Mode](https://community.cloudflare.com/t/report-of-deprecated-api-usage-in-cloudflares-auto-generated-script/578200/7)
 */
export function tryGetIdFromInLineScriptCode(pageScriptElement: PageScriptElement): string {
  if (isCloudflareBotFightScript(pageScriptElement)) {
    return 'inline_script/cloudflare-bot-fight'
  } else {
    return 'inline_script/id_not_found'
  }
}

/*
 Try to detect known in-line script code with [Cloudflare Bot Fight Mode](https://community.cloudflare.com/t/report-of-deprecated-api-usage-in-cloudflares-auto-generated-script/578200/7):
 */
function isCloudflareBotFightScript(pageScriptElement: PageScriptElement): boolean {
  const innerScriptSrcCode = "a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js'"
  return pageScriptElement.content.includes(innerScriptSrcCode)
}
