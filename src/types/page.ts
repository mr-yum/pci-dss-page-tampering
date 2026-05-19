export type PageScriptElement = {
  id: string
  content: string
  /**
   * URL of the script that initiated this inline script's insertion,
   * captured by the page-attribution shim (see `src/utils/page-attribution.ts`).
   * Falls back to `location.href` (the page URL) for parser-inserted inline
   * scripts in the original page HTML. Undefined only when the shim couldn't
   * run (very early-page race or non-browser context).
   */
  initiatorUrl?: string
}
