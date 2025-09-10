import type { ScriptMatcher } from '../../types/matcher'

const contentMatchers = payload.scripts
  .filter((script) => script.contentMatcher !== undefined)
  .map<ScriptMatcher>((script) => {
    return {
      nameMatcher: script.nameMatcher,
      contentMatcher: script.contentMatcher!,
    }
  })
