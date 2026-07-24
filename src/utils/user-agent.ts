import type { Protocol } from 'puppeteer'

/**
 * Headless Chrome advertises itself as headless in two places: the legacy
 * `User-Agent` string (`HeadlessChrome/<version>`) and the User-Agent Client
 * Hints (`navigator.userAgentData` / the `Sec-CH-UA` request header, whose
 * brand list includes `HeadlessChrome`). For a page-tampering monitor that is
 * a liability twice over — bot mitigation (e.g. Cloudflare) blocks on it, and
 * a cloaking attacker could key on it to serve the monitor a clean page while
 * real users get the tampered one — so both surfaces must present regular
 * Chrome. Normalising means the monitor observes what real users are served,
 * with values that always match the actual browser version and platform.
 */

/**
 * Rewrite the `HeadlessChrome` token in a legacy User-Agent string to `Chrome`.
 * Unrelated user agents are returned unchanged.
 */
export function normaliseHeadlessUserAgent(userAgent: string): string {
  return userAgent.replaceAll('HeadlessChrome/', 'Chrome/')
}

/**
 * Derive Client Hint metadata that presents as regular Chrome, keyed off the
 * (already normalised) User-Agent string so every surface stays self-consistent
 * — a UA string claiming macOS with a `Sec-CH-UA-Platform` of Linux is itself a
 * bot signal. Returns undefined for non-Chrome user agents (no version to
 * derive), so the caller falls back to overriding the UA string alone.
 */
export function deriveUserAgentMetadata(userAgent: string): Protocol.Emulation.UserAgentMetadata | undefined {
  const majorVersion = userAgent.match(/Chrome\/(\d+)/)?.[1]
  if (majorVersion === undefined) {
    return undefined
  }

  // GREASE brand list matching Chrome's own low-entropy Sec-CH-UA, minus the
  // HeadlessChrome brand. The "Not.A/Brand" entry is Chrome's deliberate
  // anti-ossification noise.
  const brands = [
    { brand: 'Chromium', version: majorVersion },
    { brand: 'Google Chrome', version: majorVersion },
    { brand: 'Not.A/Brand', version: '24' },
  ]

  return {
    brands,
    fullVersionList: brands.map((b) => ({ brand: b.brand, version: b.brand === 'Not.A/Brand' ? '24.0.0.0' : `${majorVersion}.0.0.0` })),
    platform: derivePlatform(userAgent),
    // High-entropy hints are only disclosed when a site requests them via
    // Accept-CH; leave them blank rather than assert a value that might
    // contradict the platform (e.g. arm64 vs x86).
    platformVersion: '',
    architecture: '',
    model: '',
    mobile: false,
  }
}

function derivePlatform(userAgent: string): string {
  if (/Windows/.test(userAgent)) return 'Windows'
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'macOS'
  if (/Android/.test(userAgent)) return 'Android'
  if (/CrOS/.test(userAgent)) return 'Chrome OS'
  if (/Linux|X11/.test(userAgent)) return 'Linux'
  return 'Unknown'
}
