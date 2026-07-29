import { extractHost, redactRepositoryTarget, redactUrl, redactUrlCredentials } from './url.js'

describe('redactUrlCredentials', () => {
  it('removes authenticated URL userinfo from arbitrary Git error text', () => {
    const message = "fatal: repository 'https://x-access-token:ghp_super_secret@github.com/org/inventory' not found"

    expect(redactUrlCredentials(message)).toBe("fatal: repository 'https://[credentials-redacted]@github.com/org/inventory' not found")
    expect(redactUrlCredentials(message)).not.toContain('ghp_super_secret')
  })

  it('leaves credential-free text unchanged', () => {
    expect(redactUrlCredentials('fatal: unable to access https://github.com/org/inventory')).toBe('fatal: unable to access https://github.com/org/inventory')
  })
})

describe('redactRepositoryTarget', () => {
  it('removes HTTPS credentials, query parameters, and fragments', () => {
    const target = 'https://x-access-token:ghp_super_secret@github.com/org/inventory?token=also-secret#fragment'

    expect(redactRepositoryTarget(target)).toBe('https://github.com/org/inventory')
  })

  it('preserves a local file repository target', () => {
    expect(redactRepositoryTarget('file:///tmp/script-inventory')).toBe('file:///tmp/script-inventory')
  })

  it('removes the username from SCP-style SSH targets', () => {
    expect(redactRepositoryTarget('git@github.com:org/inventory.git')).toBe('github.com:org/inventory.git')
  })

  it('fails closed for an invalid target', () => {
    expect(redactRepositoryTarget('not a repository target')).toBe('(unknown)')
  })
})

describe('extractHost', () => {
  it('returns the host for a typical URL', () => {
    expect(extractHost('https://m.stripe.network/out-4.5.45.js')).toBe('m.stripe.network')
  })

  it('includes the port when present', () => {
    expect(extractHost('http://localhost:3000/index.html')).toBe('localhost:3000')
  })

  it('returns (unknown) for undefined', () => {
    expect(extractHost(undefined)).toBe('(unknown)')
  })

  it('returns (unknown) for null', () => {
    expect(extractHost(null)).toBe('(unknown)')
  })

  it('returns (unknown) for empty / whitespace-only', () => {
    expect(extractHost('')).toBe('(unknown)')
    expect(extractHost('   ')).toBe('(unknown)')
  })

  it('returns (unknown) for an unparseable URL string', () => {
    expect(extractHost('not a url')).toBe('(unknown)')
  })

  it('returns (unknown) when the URL has no host', () => {
    // about: URLs and similar have no host component
    expect(extractHost('about:blank')).toBe('(unknown)')
  })
})

describe('redactUrl', () => {
  it('drops the query string and fragment, keeping origin + path', () => {
    expect(redactUrl('https://itsyourtable.com/api/auth/set-token?token=secret123&sig=abc#frag')).toBe('https://itsyourtable.com/api/auth/set-token')
  })

  it('returns origin + path unchanged when there is no query', () => {
    expect(redactUrl('https://js.stripe.com/v3/fingerprinted/js/shared.js')).toBe('https://js.stripe.com/v3/fingerprinted/js/shared.js')
  })

  it('returns (unknown) for empty or unparseable input', () => {
    expect(redactUrl('')).toBe('(unknown)')
    expect(redactUrl(undefined)).toBe('(unknown)')
    expect(redactUrl('not a url')).toBe('(unknown)')
  })
})
