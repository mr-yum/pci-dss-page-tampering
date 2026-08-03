import axios from 'axios'

import { parseGitHubRepo } from '../utils/github-url.js'

export type EnsurePullRequestArgs = Readonly<{
  repoUrl: string
  gitToken: string
  headBranch: string
  baseBranch: string
  title: string
  body: string
}>

export type EnsurePullRequestResult = Readonly<{
  url: string
  created: boolean
}>

export type FindOpenPullRequestArgs = Readonly<{
  repoUrl: string
  gitToken: string
  headBranch: string
}>

// `null` means the repository is not a supported GitHub HTTPS repository;
// `{ url: null }` means GitHub was queried and no open PR exists.
export type FindOpenPullRequestResult = Readonly<{ url: string | null }> | null

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'
const GITHUB_API_TIMEOUT_MS = 15_000

export class PullRequestService {
  async ensurePullRequest(args: EnsurePullRequestArgs): Promise<EnsurePullRequestResult | null> {
    const parsed = parseGitHubRepo(args.repoUrl)
    if (!parsed) {
      return null
    }

    const { owner, repo } = parsed
    const headers = this.buildHeaders(args.gitToken)

    const existing = await this.findOpenPullRequestUrl(owner, repo, args.headBranch, headers, args.baseBranch)
    if (existing) {
      return { url: existing, created: false }
    }

    return await this.createPullRequest(owner, repo, args, headers)
  }

  async findOpenPullRequest(args: FindOpenPullRequestArgs): Promise<FindOpenPullRequestResult> {
    const parsed = parseGitHubRepo(args.repoUrl)
    if (!parsed) return null

    const url = await this.findOpenPullRequestUrl(parsed.owner, parsed.repo, args.headBranch, this.buildHeaders(args.gitToken))
    return { url }
  }

  private buildHeaders(gitToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${gitToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    }
  }

  private async findOpenPullRequestUrl(owner: string, repo: string, headBranch: string, headers: Record<string, string>, baseBranch?: string): Promise<string | null> {
    const headQualifier = `${owner}:${encodeURIComponent(headBranch)}`
    const baseQuery = baseBranch === undefined ? '' : `&base=${encodeURIComponent(baseBranch)}`
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls?state=open&head=${headQualifier}${baseQuery}`

    const response = await axios.get<Array<{ html_url?: string }>>(url, { headers, timeout: GITHUB_API_TIMEOUT_MS })
    const first = response.data[0]
    return first?.html_url ?? null
  }

  private async createPullRequest(owner: string, repo: string, args: EnsurePullRequestArgs, headers: Record<string, string>): Promise<EnsurePullRequestResult> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls`
    const payload = {
      title: args.title,
      body: args.body,
      head: args.headBranch,
      base: args.baseBranch,
    }

    try {
      const response = await axios.post<{ html_url: string }>(url, payload, { headers, timeout: GITHUB_API_TIMEOUT_MS })
      return { url: response.data.html_url, created: true }
    } catch (error) {
      // Handle the race where a PR was opened between our GET and POST. GitHub
      // returns 422 with an "already exists" validation message; re-query to get
      // the canonical URL rather than failing the run.
      if (axios.isAxiosError(error) && error.response?.status === 422 && this.isAlreadyExistsError(error.response.data)) {
        const existing = await this.findOpenPullRequestUrl(owner, repo, args.headBranch, headers, args.baseBranch)
        if (existing) {
          return { url: existing, created: false }
        }
      }
      throw error
    }
  }

  private isAlreadyExistsError(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false
    const errors = (data as { errors?: Array<{ message?: string }> }).errors
    if (!Array.isArray(errors)) return false
    return errors.some((e) => typeof e.message === 'string' && e.message.toLowerCase().includes('already exists'))
  }
}
