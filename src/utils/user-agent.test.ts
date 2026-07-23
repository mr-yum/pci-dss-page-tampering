import { normaliseHeadlessUserAgent } from './user-agent.js'

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
