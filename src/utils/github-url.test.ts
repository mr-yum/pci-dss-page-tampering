import { parseGitHubRepo } from './github-url.js'

describe('parseGitHubRepo', () => {
  it('parses standard github.com HTTPS URL', () => {
    expect(parseGitHubRepo('https://github.com/org/inventory')).toEqual({ owner: 'org', repo: 'inventory' })
  })

  it('strips trailing .git suffix', () => {
    expect(parseGitHubRepo('https://github.com/org/inventory.git')).toEqual({ owner: 'org', repo: 'inventory' })
  })

  it('ignores trailing slash', () => {
    expect(parseGitHubRepo('https://github.com/org/inventory/')).toEqual({ owner: 'org', repo: 'inventory' })
  })

  it('ignores deeper path segments', () => {
    expect(parseGitHubRepo('https://github.com/org/inventory/tree/main')).toEqual({ owner: 'org', repo: 'inventory' })
  })

  it('is case-insensitive on hostname', () => {
    expect(parseGitHubRepo('https://GitHub.com/org/inventory')).toEqual({ owner: 'org', repo: 'inventory' })
  })

  it('returns null for file:// URLs', () => {
    expect(parseGitHubRepo('file:///tmp/inventory')).toBeNull()
  })

  it('returns null for non-github hosts', () => {
    expect(parseGitHubRepo('https://gitlab.com/org/inventory')).toBeNull()
    expect(parseGitHubRepo('https://github.enterprise.example/org/inventory')).toBeNull()
  })

  it('returns null for non-HTTPS schemes even on github.com', () => {
    expect(parseGitHubRepo('http://github.com/org/inventory')).toBeNull()
    expect(parseGitHubRepo('ssh://github.com/org/inventory')).toBeNull()
  })

  it('returns null when owner or repo is missing', () => {
    expect(parseGitHubRepo('https://github.com/')).toBeNull()
    expect(parseGitHubRepo('https://github.com/org')).toBeNull()
  })

  it('returns null for malformed URLs', () => {
    expect(parseGitHubRepo('not-a-url')).toBeNull()
    expect(parseGitHubRepo('')).toBeNull()
  })
})
