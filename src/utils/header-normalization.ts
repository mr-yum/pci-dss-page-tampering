/**
 * Header values are canonicalised before inventory comparison so harmless
 * case, whitespace and directive-order changes do not churn the baseline.
 * Set-Cookie is special: cookie values and expiry timestamps are deliberately
 * discarded before the observation can reach inventory, logs or alerts.
 */

export const TRACKED_HEADER_NAMES = ['content-security-policy', 'x-frame-options', 'strict-transport-security', 'x-xss-protection', 'x-content-type-options', 'set-cookie'] as const

export type TrackedHeaderName = (typeof TRACKED_HEADER_NAMES)[number]

const collapseWhitespace = (value: string): string => value.trim().replace(/\s+/g, ' ')

function normalizeCsp(value: string): string[] {
  const directives = value
    .split(';')
    .map(collapseWhitespace)
    .filter(Boolean)
    .map((directive) => {
      const separator = directive.indexOf(' ')
      if (separator === -1) return directive.toLowerCase()

      const name = directive.slice(0, separator).toLowerCase()
      return `${name} ${directive.slice(separator + 1)}`
    })

  directives.sort((left, right) => left.localeCompare(right))
  return directives
}

function normalizeSingleToken(value: string, uppercase = false): string[] {
  const normalized = collapseWhitespace(value)
  return [uppercase ? normalized.toUpperCase() : normalized.toLowerCase()]
}

function normalizeHsts(value: string): string[] {
  const directives = value
    .split(';')
    .map(collapseWhitespace)
    .filter(Boolean)
    .map((directive) => {
      const separator = directive.indexOf('=')
      if (separator === -1) return directive.toLowerCase()

      const name = directive.slice(0, separator).trim().toLowerCase()
      let directiveValue = directive.slice(separator + 1).trim()
      if (directiveValue.startsWith('"') && directiveValue.endsWith('"')) {
        directiveValue = directiveValue.slice(1, -1)
      }
      if (name === 'max-age' && /^\d+$/.test(directiveValue)) {
        // BigInt safely removes leading zeroes without losing large values.
        directiveValue = BigInt(directiveValue).toString()
      }
      return `${name}=${directiveValue}`
    })

  const priority = (directive: string): number => {
    if (directive.startsWith('max-age=')) return 0
    if (directive === 'includesubdomains') return 1
    if (directive === 'preload') return 2
    return 3
  }

  directives.sort((left, right) => priority(left) - priority(right) || left.localeCompare(right))
  return [directives.join('; ')]
}

function normalizeXXssProtection(value: string): string[] {
  const directives = value
    .split(';')
    .map(collapseWhitespace)
    .filter(Boolean)
    .map((directive) => {
      const separator = directive.indexOf('=')
      if (separator === -1) return directive.toLowerCase()
      const name = directive.slice(0, separator).trim().toLowerCase()
      const rawValue = directive.slice(separator + 1).trim()
      if (name !== 'report') return `${name}=${rawValue.toLowerCase()}`

      // Report URLs can contain credentials or session identifiers. Retain
      // only origin + path; fall back to a presence marker if unparseable.
      try {
        const reportUrl = new URL(rawValue.replace(/^"|"$/g, ''))
        return `report=${reportUrl.origin}${reportUrl.pathname}`
      } catch {
        return 'report=present'
      }
    })
  return [directives.join('; ')]
}

function normalizeCookieLine(line: string, referenceTimeMs: number): string {
  const segments = line
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)

  const cookiePair = segments.shift() ?? ''
  const pairSeparator = cookiePair.indexOf('=')
  const cookieName = (pairSeparator === -1 ? cookiePair : cookiePair.slice(0, pairSeparator)).trim()
  const cookieValue = pairSeparator === -1 ? '' : cookiePair.slice(pairSeparator + 1)
  const facts = [`cookie=${cookieName || '(invalid)'}`, `empty=${cookieValue.length === 0}`]
  const attributes = new Map<string, string[]>()

  for (const segment of segments) {
    const separator = segment.indexOf('=')
    const name = (separator === -1 ? segment : segment.slice(0, separator)).trim().toLowerCase()
    const rawValue = separator === -1 ? '' : segment.slice(separator + 1).trim()
    let safeValue: string

    switch (name) {
      case 'secure':
      case 'httponly':
      case 'partitioned':
        safeValue = 'true'
        break
      case 'domain':
        safeValue = rawValue.toLowerCase().replace(/^\./, '')
        break
      case 'path':
        safeValue = rawValue
        break
      case 'samesite':
        safeValue = rawValue.toLowerCase()
        break
      case 'max-age':
        safeValue = /^-?\d+$/.test(rawValue) ? BigInt(rawValue).toString() : 'invalid'
        break
      case 'expires':
        // Preserve deletion/persistence semantics without retaining the exact
        // timestamp, which is dynamic and can contain unnecessary detail.
        // Compare with the response's Date header when available so the result
        // reflects the server-observed cookie behaviour rather than clock skew.
        // An invalid date remains distinct so malformed expiry cannot look valid.
        {
          const expiresAt = Date.parse(rawValue)
          safeValue = Number.isNaN(expiresAt) ? 'invalid' : expiresAt <= referenceTimeMs ? 'expired' : 'future'
        }
        break
      default:
        // Unknown extension values could themselves be sensitive. Preserve
        // the attribute's existence without allowing its value to escape.
        safeValue = rawValue === '' ? 'true' : 'present'
        break
    }

    const existing = attributes.get(name) ?? []
    existing.push(safeValue)
    attributes.set(name, existing)
  }

  for (const name of [...attributes.keys()].sort()) {
    for (const value of attributes.get(name) ?? []) {
      facts.push(`${name}=${value}`)
    }
  }

  return facts.join('; ')
}

function normalizeSetCookie(value: string, referenceTimeMs: number): string[] {
  // Puppeteer preserves distinct Set-Cookie fields by joining them with a
  // newline. Never split on commas: Expires dates contain commas.
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeCookieLine(line, referenceTimeMs))
}

export function normalizeTrackedHeader(name: string, value: string, referenceTimeMs = Date.now()): string[] {
  switch (name.toLowerCase()) {
    case 'content-security-policy':
      return normalizeCsp(value)
    case 'x-frame-options':
      return normalizeSingleToken(value, true)
    case 'strict-transport-security':
      return normalizeHsts(value)
    case 'x-xss-protection':
      return normalizeXXssProtection(value)
    case 'x-content-type-options':
      return normalizeSingleToken(value)
    case 'set-cookie':
      return normalizeSetCookie(value, referenceTimeMs)
    default:
      return []
  }
}
