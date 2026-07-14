import type { PageScriptElement } from '../../types/page.js'
import type { InLineScriptMatcher } from '../../types/script/inline.js'

/**
 * Shared fallback id for inline scripts that match none of the known
 * framework snippets below. Multiple distinct scripts can carry this id at
 * once, so it must never be used to *identify* a script in the inventory —
 * `InventoryService.addNewScript` generates a provenance + content-snippet
 * matcher for these instead of a name matcher.
 */
export const UNIDENTIFIED_INLINE_SCRIPT_ID = 'inline_script/id_not_found'

/*
  Returns `inline_script/id_not_found` if we cannot match on known in-line script code.

  Known in-line script code include:
    - [Cloudflare Bot Flight Mode](https://community.cloudflare.com/t/report-of-deprecated-api-usage-in-cloudflares-auto-generated-script/578200/7)
    - [Next.js Server-side Rendering](https://github.com/vercel/next.js/discussions/42170#discussioncomment-8880248)
    - React Server Components runtime helpers and hydration-timing bootstrap
 */
export function tryGetIdFromInLineScriptCode(pageScriptElement: PageScriptElement): string {
  const scriptMatchers = [cloudFlareScriptMatcher, nextJsServerSideRenderingScriptMatcher, reactServerComponentScriptMatcher, reactHydrationTimingScriptMatcher]
  const maybeMatch = scriptMatchers.find((matcher) => matcher.predicate(pageScriptElement))

  return maybeMatch ? maybeMatch.resultingIdentifier : UNIDENTIFIED_INLINE_SCRIPT_ID
}

/*
 In-line script code with [Cloudflare Bot Fight Mode](https://community.cloudflare.com/t/report-of-deprecated-api-usage-in-cloudflares-auto-generated-script/578200/7):
 */
const cloudFlareScriptMatcher: InLineScriptMatcher = {
  resultingIdentifier: 'inline_script/cloudflare-bot-fight',
  predicate: (script: PageScriptElement): boolean => {
    const innerScriptSrcCode = "a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js'"
    return script.content.includes(innerScriptSrcCode)
  },
}

/*
 In-line script code for Next.js [Server-side Rendering](https://github.com/vercel/next.js/discussions/42170#discussioncomment-8880248).
 Anchored to the start of the script so it covers both the flush chunks
 (`self.__next_f.push([1,"..."])`) and the initialiser variant
 (`(self.__next_f=self.__next_f||[]).push([0])`) without matching scripts
 that merely mention the marker somewhere in their body.
 */
const nextJsServerSideRenderingScriptMatcher: InLineScriptMatcher = {
  resultingIdentifier: 'inline_script/nextjs-ssr',
  predicate: (script: PageScriptElement) => {
    const regex = RegExp('^\\(?self\\.__next_f[.=]')
    return regex.test(script.content)
  },
}

/*
 In-line script code for React [Server Components](https://tonyalicea.dev/blog/understanding-react-server-components/).
 The RSC runtime emits several `$R<letter>` globals at the start of its
 bootstrap scripts ($RC/$RS completion handlers, but also $RB/$RV/$RT
 runtime helpers), so accept any leading `$R<uppercase>` token — but only
 as a complete identifier (assignment `$RC=` or call `$RC(`), so unrelated
 identifiers like `$RANDOM` don't inherit the RSC identity.
 */
const reactServerComponentScriptMatcher: InLineScriptMatcher = {
  resultingIdentifier: 'inline_script/react-server-component',
  predicate: (script: PageScriptElement) => {
    const regex = RegExp('^\\$R[A-Z](?![A-Za-z0-9_$])')
    return regex.test(script.content)
  },
}

/*
 React/Next.js hydration-timing bootstrap: records the render timestamp into
 `$RT` for the RSC runtime. Emitted verbatim by the framework, so match the
 whole snippet exactly (modulo surrounding whitespace).
 */
const reactHydrationTimingScriptMatcher: InLineScriptMatcher = {
  resultingIdentifier: 'inline_script/react-hydration-timing',
  predicate: (script: PageScriptElement) => {
    const regex = RegExp('^requestAnimationFrame\\(function\\(\\)\\{\\$RT=performance\\.now\\(\\)\\}\\);?$')
    return regex.test(script.content.trim())
  },
}
