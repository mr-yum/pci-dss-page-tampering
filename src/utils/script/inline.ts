import type { PageScriptElement } from '../../types/page'
import type { InLineScriptMatcher } from '../../types/script/inline'

/*
  Returns `inline_script/id_not_found` if we cannot match on known in-line script code.

  Known in-line script code include:
    - [Cloudflare Bot Flight Mode](https://community.cloudflare.com/t/report-of-deprecated-api-usage-in-cloudflares-auto-generated-script/578200/7)
    - [Next.js Server-side Rendering](https://github.com/vercel/next.js/discussions/42170#discussioncomment-8880248)
 */
export function tryGetIdFromInLineScriptCode(pageScriptElement: PageScriptElement): string {
  const scriptMatchers = [cloudFlareScriptMatcher, nextJsServerSideRenderingScriptMatcher]
  const maybeMatch = scriptMatchers.find((matcher) => matcher.predicate(pageScriptElement))

  return maybeMatch ? maybeMatch.resultingIdentifier : 'inline_script/id_not_found'
}

/*
 In-line script code with [Cloudflare Bot Fight Mode](https://community.cloudflare.com/t/report-of-deprecated-api-usage-in-cloudflares-auto-generated-script/578200/7):
 */
const cloudFlareScriptMatcher: InLineScriptMatcher = {
  resultingIdentifier: 'inline_script/cloudflare-bot-fight',
  predicate: (script): boolean => {
    const innerScriptSrcCode = "a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js'"
    return script.content.includes(innerScriptSrcCode)
  },
}

/*
 In-line script code for Next.js [Server-side Rendering](https://github.com/vercel/next.js/discussions/42170#discussioncomment-8880248)
 */
const nextJsServerSideRenderingScriptMatcher: InLineScriptMatcher = {
  resultingIdentifier: 'inline_script/nextjs-ssr',
  predicate: (script: PageScriptElement) => {
    const innerScriptSrcCode = 'self.__next_f.push'
    return script.content.includes(innerScriptSrcCode)
  },
}
