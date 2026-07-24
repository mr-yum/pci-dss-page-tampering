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
 * User-Agent string so every surface stays self-consistent — a UA string
 * claiming macOS with a `Sec-CH-UA-Platform` of Linux is itself a bot signal.
 *
 * The UA is normalised internally, so passing a raw `HeadlessChrome` string is
 * safe. Returns undefined — so the caller falls back to overriding the UA
 * string alone — when there is no Chrome version to derive, or for mobile /
 * unrecognised platforms whose consistent hints this desktop-only tool cannot
 * assert (it always runs desktop headless Chrome).
 *
 * @param fullVersion optional real build version (e.g. `browser.version()`,
 *   `Chrome/150.0.7871.24`); used verbatim for the high-entropy
 *   `Sec-CH-UA-Full-Version-List` so it matches a real build rather than a
 *   fabricated `<major>.0.0.0`.
 */
export function deriveUserAgentMetadata(userAgent: string, fullVersion?: string): Protocol.Emulation.UserAgentMetadata | undefined {
  const normalised = normaliseHeadlessUserAgent(userAgent)
  const majorVersion = normalised.match(/Chrome\/(\d+)/)?.[1]
  if (majorVersion === undefined) {
    return undefined
  }

  const platform = deriveDesktopPlatform(normalised)
  if (platform === undefined) {
    return undefined
  }

  const fullVersionNumber = fullVersion?.match(/\d+\.\d+\.\d+\.\d+/)?.[0] ?? `${majorVersion}.0.0.0`

  // GREASE brand list matching Chrome's own Sec-CH-UA, minus the
  // HeadlessChrome brand. The "Not.A/Brand" entry is Chrome's deliberate
  // anti-ossification noise (versioned 24 / 24.0.0.0 in real Chrome).
  const brands = [
    { brand: 'Chromium', version: majorVersion },
    { brand: 'Google Chrome', version: majorVersion },
    { brand: 'Not.A/Brand', version: '24' },
  ]

  return {
    brands,
    fullVersionList: brands.map((b) => ({ brand: b.brand, version: b.brand === 'Not.A/Brand' ? '24.0.0.0' : fullVersionNumber })),
    platform,
    // High-entropy hints are only disclosed when a site requests them via
    // Accept-CH; leave them blank rather than assert a value that might
    // contradict the platform (e.g. arm64 vs x86).
    platformVersion: '',
    architecture: '',
    model: '',
    mobile: false,
  }
}

/**
 * Map a UA string to a desktop `Sec-CH-UA-Platform` value. Returns undefined
 * for mobile (Android) or unrecognised platforms — the caller then presents
 * the UA string alone rather than pairing it with `mobile: false` hints that
 * would contradict it. Android is checked before Linux because Android UAs
 * also contain "Linux".
 */
function deriveDesktopPlatform(userAgent: string): string | undefined {
  if (/Windows/.test(userAgent)) return 'Windows'
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'macOS'
  if (/CrOS/.test(userAgent)) return 'Chrome OS'
  if (/Android/.test(userAgent)) return undefined
  if (/Linux|X11/.test(userAgent)) return 'Linux'
  return undefined
}
