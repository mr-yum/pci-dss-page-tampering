/**
 * Output encoding for the HTML report.
 *
 * Everything the report renders about a detected resource is attacker-supplied:
 * script URLs, inline script bodies and header values are precisely what an
 * e-skimmer leaves behind. An XSS in the evidence document is a real risk, so
 * this module makes escaping the default rather than something a caller has to
 * remember.
 *
 * The rule: every interpolation into `html` is escaped unless a developer wrote
 * a literal `raw(...)`. Reviewers grep one token to find every trust boundary.
 *
 * @see ./template.ts
 */

/**
 * OWASP's recommended set — a superset of the five strictly required.
 *
 * Escaping `/`, backtick and `=` as well means that even an interpolation that
 * lands in an unquoted or backtick-delimited attribute cannot break out, which
 * removes a whole class of "this one place forgot the quotes" bugs.
 */
const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`=/]/gu, (character) => ENTITIES[character]!)
}

/** Markup that has already been through the escaping boundary. */
export type RawHtml = { readonly __rawHtml: true; readonly value: string }

/**
 * Mark a string as trusted markup.
 *
 * Only ever call this on markup this codebase constructed. Passing detected
 * content through it defeats the entire module.
 */
export function raw(value: string): RawHtml {
  return { __rawHtml: true, value }
}

function isRawHtml(value: unknown): value is RawHtml {
  return typeof value === 'object' && value !== null && '__rawHtml' in value
}

function interpolate(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (isRawHtml(value)) return value.value
  if (Array.isArray(value)) return value.map(interpolate).join('')
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return escapeHtml(String(value))
}

/** Tagged template that escapes every interpolation by default. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  let output = ''

  strings.forEach((chunk, index) => {
    output += chunk
    if (index < values.length) output += interpolate(values[index])
  })

  return raw(output)
}

/** Render a list of fragments without re-escaping them. */
export function join(fragments: readonly RawHtml[], separator = ''): RawHtml {
  return raw(fragments.map((fragment) => fragment.value).join(separator))
}

/**
 * An `href` that is safe to click, or null.
 *
 * Only run metadata (repository, CI run) is ever linked. Detected URLs are
 * rendered as text: a `javascript:` or `data:text/html` script URL is exactly
 * what an attacker leaves behind, and turning the evidence document into a
 * click-to-execute page is not acceptable.
 */
export function safeHttpsHref(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null

  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}
