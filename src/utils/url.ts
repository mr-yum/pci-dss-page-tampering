/**
 * Tiny display helpers for full URLs.
 *
 * Match against the full URL (`Matchable.url`) but display the host in log
 * lines and alert tables — the host is what's scannable. This module is the
 * single source of truth for "how do we render a URL for a human".
 */

const UNKNOWN_HOST = '(unknown)'

/**
 * Remove credentials and other secret-bearing URL components from arbitrary
 * log text. Git errors commonly echo the authenticated remote, so sanitising
 * only the normal success-path log line is not sufficient.
 */
export function redactUrlCredentials(value: string): string {
  const credentialsRedacted = value.replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/giu, '$1[credentials-redacted]@')

  return credentialsRedacted.replace(
    /([a-z][a-z\d+.-]*:\/\/[^\s"'?#]*)(\?[^\s"'#]*)?(#[^\s"']*)?/giu,
    (_url, repositoryPath: string, query: string | undefined, fragment: string | undefined) => `${repositoryPath}${query === undefined ? '' : '?[query-redacted]'}${fragment === undefined ? '' : '#[fragment-redacted]'}`,
  )
}

/**
 * Render a repository target without credentials, query parameters, or a
 * fragment. HTTPS credentials contain the Git token; queries and fragments
 * may also contain secrets. Local file URLs remain useful, and SCP-style SSH
 * targets have their username removed.
 */
export function redactRepositoryTarget(target: string | undefined | null): string {
  if (!target || target.trim() === '') return UNKNOWN_HOST

  try {
    const parsed = new URL(target)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''

    if (parsed.protocol === 'file:') return parsed.href
    if (parsed.host === '') return UNKNOWN_HOST
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    const scpTarget = target.trim().match(/^(?:[^@\s]+@)?([^:/\s]+):([^?#\s]+)(?:[?#].*)?$/u)
    return scpTarget ? `${scpTarget[1]}:${scpTarget[2]}` : UNKNOWN_HOST
  }
}

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
