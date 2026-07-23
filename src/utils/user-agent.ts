/**
 * Headless Chrome advertises itself in the User-Agent as
 * `HeadlessChrome/<version>` instead of `Chrome/<version>`. For a
 * page-tampering monitor that token is a liability twice over: bot
 * mitigation (e.g. Cloudflare) blocks on it, and a cloaking attacker could
 * key on it to serve the monitor a clean page while real users get the
 * tampered one. Normalising to the regular Chrome token means the monitor
 * observes what real users are served, with a UA that always matches the
 * actual browser version.
 */
export function normaliseHeadlessUserAgent(userAgent: string): string {
  return userAgent.replaceAll('HeadlessChrome/', 'Chrome/')
}
