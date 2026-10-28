import { Octokit } from '@octokit/core'
import type { FetchableRef } from './parse'

/** The parts of a GitHub API response the plugin needs for rendering. */
export type ResourceInfo =
  | { type: 'user'; login: string; name: string | null; isOrg: boolean }
  | {
      type: 'repo'
      description: string | null
      isPrivate: boolean
      isFork: boolean
      isArchived: boolean
      isTemplate: boolean
    }
  | {
      type: 'issue'
      title: string
      state: string
      stateReason: string | null
      /** Present when the issue is actually a pull request. */
      pull?: { merged: boolean; draft: boolean }
    }
  | { type: 'discussion'; title: string; closed: boolean; stateReason: string | null }
  | { type: 'commit'; sha: string; message: string }
  | { type: 'release'; name: string | null; prerelease: boolean }

/** Thrown instead of calling the API while the rate limit is exhausted. */
export class RateLimitError extends Error {
  constructor(readonly resetAt: Date) {
    super(`GitHub API rate limit exceeded until ${resetAt.toLocaleTimeString()}`)
  }
}

/** How long a request may take before it is aborted. */
const REQUEST_TIMEOUT = 30_000

type Headers = Record<string, string | number | undefined>

/**
 * The fields read from Octokit's errors: `RequestError` for HTTP failures, and
 * `GraphqlResponseError` for errors reported in a GraphQL response body.
 */
type RequestErrorLike = {
  status?: number
  response?: { headers?: Headers }
  headers?: Headers
  errors?: { type?: string }[]
}

function asRequestError(error: unknown): RequestErrorLike {
  return (error ?? {}) as RequestErrorLike
}

/**
 * Whether the resource doesn't exist (or isn't visible with the current
 * token), so retrying soon won't help. The commits endpoint answers 422 for an
 * unknown SHA, and GraphQL reports NOT_FOUND in the response body.
 */
export function isNotFound(error: unknown): boolean {
  const { status, errors } = asRequestError(error)
  return status === 404 || status === 422 || !!errors?.some(e => e.type === 'NOT_FOUND')
}

const DISCUSSION_QUERY = `
  query ($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      discussion(number: $number) {
        title
        closed
        stateReason
      }
    }
  }
`

type DiscussionQueryResult = {
  repository: {
    discussion: { title: string; closed: boolean; stateReason: string | null } | null
  } | null
}

export class GithubClient {
  private readonly octokit: Octokit
  private readonly hasToken: boolean
  private blockedUntil = 0
  private tokenRejected = false

  constructor(
    token: string,
    private readonly onRateLimit: (error: RateLimitError) => void,
    private readonly onTokenRejected: () => void
  ) {
    this.hasToken = token !== ''
    this.octokit = new Octokit({
      auth: token || undefined,
      userAgent: 'inkdrop-github-links'
    })
    // A request that never settles would leave its links loading for good.
    // `options.request` is shared with Octokit's defaults, so it is replaced.
    this.octokit.hook.before('request', options => {
      options.request = { ...options.request, signal: AbortSignal.timeout(REQUEST_TIMEOUT) }
    })
  }

  async fetch(ref: FetchableRef): Promise<ResourceInfo> {
    if (Date.now() < this.blockedUntil) {
      throw new RateLimitError(new Date(this.blockedUntil))
    }
    try {
      return await this.request(ref)
    } catch (error) {
      this.handleRateLimit(error)
      this.handleRejectedToken(error)
      throw error
    }
  }

  private async request(ref: FetchableRef): Promise<ResourceInfo> {
    const { octokit } = this
    switch (ref.kind) {
      case 'user': {
        const { data } = await octokit.request('GET /users/{username}', {
          username: ref.owner
        })
        return {
          type: 'user',
          login: data.login,
          name: data.name ?? null,
          isOrg: data.type === 'Organization'
        }
      }
      case 'repo': {
        const { data } = await octokit.request('GET /repos/{owner}/{repo}', {
          owner: ref.owner,
          repo: ref.repo
        })
        return {
          type: 'repo',
          description: data.description,
          isPrivate: data.private,
          isFork: data.fork,
          isArchived: data.archived,
          isTemplate: data.is_template ?? false
        }
      }
      case 'issue':
      case 'pull': {
        // The issues endpoint serves pull requests too, including their merge
        // and draft state, so one request covers both kinds.
        try {
          const { data } = await octokit.request(
            'GET /repos/{owner}/{repo}/issues/{issue_number}',
            { owner: ref.owner, repo: ref.repo, issue_number: ref.number }
          )
          return {
            type: 'issue',
            title: data.title,
            state: data.state,
            stateReason: data.state_reason ?? null,
            pull: data.pull_request && {
              merged: !!data.pull_request.merged_at,
              draft: !!data.draft
            }
          }
        } catch (error) {
          // Repositories with issues disabled answer 410 even for pull requests
          if (asRequestError(error).status !== 410) throw error
        }
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
          owner: ref.owner,
          repo: ref.repo,
          pull_number: ref.number
        })
        return {
          type: 'issue',
          title: data.title,
          state: data.state,
          stateReason: null,
          pull: { merged: !!data.merged_at, draft: !!data.draft }
        }
      }
      case 'discussion': {
        // Discussions are only exposed through GraphQL, which rejects
        // anonymous requests.
        if (!this.hasToken) {
          throw new Error('Fetching discussions requires a GitHub token')
        }
        const { repository } = await octokit.graphql<DiscussionQueryResult>(DISCUSSION_QUERY, {
          owner: ref.owner,
          repo: ref.repo,
          number: ref.number
        })
        const discussion = repository?.discussion
        if (!discussion) throw Object.assign(new Error('Not found'), { status: 404 })
        return { type: 'discussion', ...discussion }
      }
      case 'commit': {
        const { data } = await octokit.request(
          'GET /repos/{owner}/{repo}/commits/{ref}',
          // The response embeds the changed files; one is enough.
          { owner: ref.owner, repo: ref.repo, ref: ref.sha, per_page: 1 }
        )
        return { type: 'commit', sha: data.sha, message: data.commit.message }
      }
      case 'release': {
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/releases/tags/{tag}', {
          owner: ref.owner,
          repo: ref.repo,
          tag: ref.tag
        })
        return { type: 'release', name: data.name, prerelease: data.prerelease }
      }
    }
  }

  private handleRateLimit(error: unknown) {
    const { status, response, headers: bodyErrorHeaders, errors } = asRequestError(error)
    const headers = response?.headers ?? bodyErrorHeaders ?? {}
    const limited =
      status === 429 ||
      // Secondary limits answer 403 with `retry-after` while quota remains
      (status === 403 &&
        (String(headers['x-ratelimit-remaining']) === '0' ||
          headers['retry-after'] !== undefined)) ||
      // GraphQL reports an exhausted limit in the body of a 200 response
      !!errors?.some(e => e.type === 'RATE_LIMITED')
    if (!limited) return

    const retryAfter = Number(headers['retry-after'])
    const reset = Number(headers['x-ratelimit-reset'])
    const resetAt =
      retryAfter > 0
        ? Date.now() + retryAfter * 1000
        : reset > 0
          ? reset * 1000
          : Date.now() + 60_000
    // Several in-flight requests fail together; report the limit only once.
    const reported = Date.now() < this.blockedUntil
    this.blockedUntil = Math.max(this.blockedUntil, resetAt)
    if (!reported) this.onRateLimit(new RateLimitError(new Date(this.blockedUntil)))
  }

  private handleRejectedToken(error: unknown) {
    if (!this.hasToken || this.tokenRejected || asRequestError(error).status !== 401) return
    // Every request fails the same way until the token is changed, which
    // creates a new client; report it once.
    this.tokenRejected = true
    this.onTokenRejected()
  }
}
