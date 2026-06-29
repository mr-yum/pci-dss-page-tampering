import { extractHost } from './url.js'

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
