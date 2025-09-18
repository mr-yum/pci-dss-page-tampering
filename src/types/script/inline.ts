import type { PageScriptElement } from '../page'

export type InLineScriptMatcher = {
  resultingIdentifier: string
  predicate: (script: PageScriptElement) => boolean
}
