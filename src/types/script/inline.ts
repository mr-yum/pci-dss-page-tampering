import type { PageScriptElement } from '../page.js'

export type InLineScriptMatcher = {
  resultingIdentifier: string
  predicate: (script: PageScriptElement) => boolean
}
