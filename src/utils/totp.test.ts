import { decodeBase32, generateTotp, millisecondsRemainingInTotpWindow, parseTotpSeedEntry } from './totp.js'

describe('decodeBase32', () => {
  // RFC 4648 section 10 test vectors
  it.each([
    ['MY======', 'f'],
    ['MZXQ====', 'fo'],
    ['MZXW6===', 'foo'],
    ['MZXW6YQ=', 'foob'],
    ['MZXW6YTB', 'fooba'],
    ['MZXW6YTBOI======', 'foobar'],
  ])('decodes RFC 4648 vector %s', (encoded, expected) => {
    expect(decodeBase32(encoded).toString('ascii')).toBe(expected)
  })

  it('is case-insensitive and tolerates whitespace, hyphens, and missing padding', () => {
    expect(decodeBase32('mzxw 6ytb-oi').toString('ascii')).toBe('foobar')
  })

  it('throws on empty input', () => {
    expect(() => decodeBase32('')).toThrow('TOTP seed must not be empty')
    expect(() => decodeBase32('====')).toThrow('TOTP seed must not be empty')
  })

  it('throws on characters outside the base32 alphabet without echoing the input', () => {
    expect(() => decodeBase32('MZXW6YTB1')).toThrow('TOTP seed is not valid base32 (RFC 4648)')
    expect(() => decodeBase32('MZXW6YTB8')).toThrow('TOTP seed is not valid base32 (RFC 4648)')
  })

  it('throws on a seed that decodes to zero bytes (would silently HMAC an empty key)', () => {
    expect(() => decodeBase32('A')).toThrow('TOTP seed decodes to zero bytes')
  })
})

describe('parseTotpSeedEntry', () => {
  it('splits on the first = and trims name and seed', () => {
    expect(parseTotpSeedEntry(' checkout = GEZDGNBVGY3TQOJQ ')).toEqual({ name: 'checkout', seed: 'GEZDGNBVGY3TQOJQ' })
  })

  it('keeps = characters within the seed (base32 padding)', () => {
    expect(parseTotpSeedEntry('admin=MZXW6YTBOI======')).toEqual({ name: 'admin', seed: 'MZXW6YTBOI======' })
  })

  it('returns null when the separator, name, or seed is missing', () => {
    expect(parseTotpSeedEntry('GEZDGNBVGY3TQOJQ')).toBeNull()
    expect(parseTotpSeedEntry('=GEZDGNBVGY3TQOJQ')).toBeNull()
    expect(parseTotpSeedEntry('checkout=')).toBeNull()
    expect(parseTotpSeedEntry('checkout=   ')).toBeNull()
  })
})

describe('generateTotp', () => {
  // RFC 6238 Appendix B test vectors (HMAC-SHA1). The RFC lists 8-digit
  // codes; the expected values below are their 6-digit truncations, which
  // is what dynamic truncation mod 10^6 yields for the same HMAC.
  const RFC_6238_SHA1_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' // base32 of ASCII "12345678901234567890"

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('matches the RFC 6238 vector at T=%is', (timeSeconds, expected) => {
    expect(generateTotp(RFC_6238_SHA1_SEED, timeSeconds * 1000)).toBe(expected)
  })

  it('returns the same code anywhere within a 30-second window', () => {
    expect(generateTotp(RFC_6238_SHA1_SEED, 30000)).toBe(generateTotp(RFC_6238_SHA1_SEED, 59999))
  })

  it('returns a different code in the next window', () => {
    expect(generateTotp(RFC_6238_SHA1_SEED, 59999)).not.toBe(generateTotp(RFC_6238_SHA1_SEED, 60000))
  })

  it('zero-pads codes to 6 digits', () => {
    expect(generateTotp(RFC_6238_SHA1_SEED, 1234567890000)).toBe('005924')
  })

  it('propagates seed validation errors', () => {
    expect(() => generateTotp('not base32!', 0)).toThrow('TOTP seed is not valid base32 (RFC 4648)')
  })
})

describe('millisecondsRemainingInTotpWindow', () => {
  it('returns the full period at a window boundary', () => {
    expect(millisecondsRemainingInTotpWindow(60000)).toBe(30000)
  })

  it('returns the remaining time mid-window', () => {
    expect(millisecondsRemainingInTotpWindow(75000)).toBe(15000)
  })

  it('returns a small remainder just before rollover', () => {
    expect(millisecondsRemainingInTotpWindow(89999)).toBe(1)
  })
})
