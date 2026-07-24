import { deriveUserAgentMetadata, normaliseHeadlessUserAgent } from './user-agent.js'

describe('normaliseHeadlessUserAgent', () => {
  it('replaces the HeadlessChrome token with Chrome, keeping the version', () => {
    const headless = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/150.0.0.0 Safari/537.36'
    expect(normaliseHeadlessUserAgent(headless)).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36')
  })

  it('normalises every occurrence of the token', () => {
    expect(normaliseHeadlessUserAgent('HeadlessChrome/1.0 HeadlessChrome/1.0')).toBe('Chrome/1.0 Chrome/1.0')
  })

  it('leaves a regular Chrome user agent unchanged', () => {
    const headful = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
    expect(normaliseHeadlessUserAgent(headful)).toBe(headful)
  })
})

describe('deriveUserAgentMetadata', () => {
  const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

  it('derives a brand list that excludes HeadlessChrome and carries the major version', () => {
    const meta = deriveUserAgentMetadata(linux)
    expect(meta?.brands).toEqual([
      { brand: 'Chromium', version: '150' },
      { brand: 'Google Chrome', version: '150' },
      { brand: 'Not.A/Brand', version: '24' },
    ])
    expect(JSON.stringify(meta)).not.toContain('Headless')
  })

  it('keeps the platform consistent with the UA string', () => {
    expect(deriveUserAgentMetadata(linux)?.platform).toBe('Linux')
    expect(deriveUserAgentMetadata('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/150.0.0.0 Safari/537.36')?.platform).toBe('macOS')
    expect(deriveUserAgentMetadata('Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/150.0.0.0 Safari/537.36')?.platform).toBe('Windows')
  })

  it('normalises a HeadlessChrome UA before deriving (via normaliseHeadlessUserAgent), so no brand leaks headless', () => {
    const meta = deriveUserAgentMetadata(normaliseHeadlessUserAgent('Mozilla/5.0 (X11; Linux x86_64) ... HeadlessChrome/150.0.0.0 Safari/537.36'))
    expect(meta?.brands?.some((b) => b.brand.includes('Headless'))).toBe(false)
    expect(meta?.brands?.[0]?.version).toBe('150')
  })

  it('leaves high-entropy hints blank rather than asserting a possibly-inconsistent value', () => {
    const meta = deriveUserAgentMetadata(linux)
    expect(meta?.architecture).toBe('')
    expect(meta?.platformVersion).toBe('')
    expect(meta?.mobile).toBe(false)
  })

  it('returns undefined for a non-Chrome user agent', () => {
    expect(deriveUserAgentMetadata('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/130.0')).toBeUndefined()
  })
})
