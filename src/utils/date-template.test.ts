import { resolveDateTemplates } from './date-template.js'

describe('resolveDateTemplates', () => {
  const now = new Date('2026-07-20T12:00:00.000Z')

  it('returns input without placeholders unchanged', () => {
    const url = 'https://example.com/venue?view=times&partySize=2'
    expect(resolveDateTemplates(url, now)).toBe(url)
  })

  it('resolves {{date}} to today (UTC)', () => {
    expect(resolveDateTemplates('https://example.com/?date={{date}}', now)).toBe('https://example.com/?date=2026-07-20')
  })

  it('resolves {{date+2d}} to two days ahead', () => {
    expect(resolveDateTemplates('https://example.com/?date={{date+2d}}', now)).toBe('https://example.com/?date=2026-07-22')
  })

  it('crosses month boundaries correctly', () => {
    expect(resolveDateTemplates('{{date+12d}}', now)).toBe('2026-08-01')
  })

  it('resolves multiple placeholders in one string', () => {
    expect(resolveDateTemplates('from={{date}}&to={{date+1d}}', now)).toBe('from=2026-07-20&to=2026-07-21')
  })

  it('leaves malformed placeholders untouched', () => {
    expect(resolveDateTemplates('date={{date-1d}}&x={{date+d}}', now)).toBe('date={{date-1d}}&x={{date+d}}')
  })
})
