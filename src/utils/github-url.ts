/**
 * Parse a GitHub HTTPS repository URL into `{ owner, repo }`.
 *
 * Returns `null` for `file://` URLs, non-`github.com` hosts, and URLs that
 * don't resolve to an `/owner/repo` path. This lets callers silently skip
 * GitHub-API-dependent behavior (e.g., PR creation) for local or
 * self-hosted setups without special-casing at each call site.
 */
export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
    return null
  }

  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0)
  if (segments.length < 2) {
    return null
  }

  const owner = segments[0]!
  const repoRaw = segments[1]!
  const repo = repoRaw.endsWith('.git') ? repoRaw.slice(0, -'.git'.length) : repoRaw

  if (owner.length === 0 || repo.length === 0) {
    return null
  }

  return { owner, repo }
}
