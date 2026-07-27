/**
 * Tiny display helpers for full URLs.
 *
 * Match against the full URL (`Matchable.url`) but display the host in log
 * lines and alert tables — the host is what's scannable. This module is the
 * single source of truth for "how do we render a URL for a human".
 */

const UNKNOWN_HOST = '(unknown)'

/**
 * Returns the host portion of a URL string. Returns `(unknown)` when the
 * input is undefined, empty, or unparseable so callers can interpolate the
 * result directly into log lines and Slack cells without conditionals.
 */
export function extractHost(url: string | undefined | null): string {
  if (!url || url.trim() === '') return UNKNOWN_HOST
  try {
    const host = new URL(url).host
    return host.length > 0 ? host : UNKNOWN_HOST
  } catch {
    return UNKNOWN_HOST
  }
}

/**
 * Returns `origin + pathname`, dropping the query string and fragment. Use
 * when logging a URL that may carry sensitive query parameters (tokens,
 * signed URLs, PII) — keeps the endpoint identifiable without leaking secrets.
 * Falls back to `(unknown)` for unparseable input.
 */
export function redactUrl(url: string | undefined | null): string {
  if (!url || url.trim() === '') return UNKNOWN_HOST
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return UNKNOWN_HOST
  }
}
