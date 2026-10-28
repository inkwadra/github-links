/** A github.com URL the plugin knows how to render, broken into its parts. */
export type GithubRef =
  | { kind: 'user'; owner: string }
  | { kind: 'repo'; owner: string; repo: string }
  | {
      kind: 'issue' | 'pull' | 'discussion'
      owner: string
      repo: string
      number: number
      /** The URL points at a comment rather than the item itself. */
      comment: boolean
    }
  | { kind: 'commit'; owner: string; repo: string; sha: string }
  | { kind: 'release'; owner: string; repo: string; tag: string }
  | {
      kind: 'blob' | 'tree'
      owner: string
      repo: string
      ref: string
      path: string
      /** Line anchor of a blob URL, e.g. `L10-L20`. */
      lines?: string
    }

/** Refs that need a GitHub API call to be rendered. */
export type FetchableRef = Exclude<GithubRef, { kind: 'blob' | 'tree' }>

const HOSTS = new Set(['github.com', 'www.github.com'])

/**
 * Top-level github.com paths that are site pages rather than users or orgs.
 * GitHub never hands these out as account names, so skipping them saves API
 * calls that would only come back 404.
 */
const RESERVED_OWNERS = new Set([
  'about',
  'account',
  'advisories',
  'apps',
  'blog',
  'codespaces',
  'collections',
  'contact',
  'copilot',
  'customer-stories',
  'dashboard',
  'discussions',
  'education',
  'enterprise',
  'enterprises',
  'events',
  'explore',
  'features',
  'git-guides',
  'github-copilot',
  'issues',
  'join',
  'login',
  'logout',
  'marketplace',
  'mobile',
  'models',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'pulls',
  'readme',
  'resources',
  'search',
  'security',
  'settings',
  'signup',
  'site',
  'sitemap',
  'solutions',
  'sponsors',
  'stars',
  'team',
  'topics',
  'trending',
  'users',
  'watching'
])

const OWNER_RE = /^[a-z\d][a-z\d-]{0,38}$/i
const REPO_RE = /^(?!\.\.?$)[\w.-]{1,100}$/
const NUMBER_RE = /^[1-9]\d*$/
const SHA_RE = /^[\da-f]{7,40}$/i
const LINES_RE = /^L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/
const COMMENT_ANCHOR_RE =
  /^(?:issuecomment-|discussioncomment-|discussion_r|pullrequestreview-)\d+$/

/** Applies a URI decoder, keeping the input when it isn't valid percent-encoding. */
export function safeDecode(decoder: (value: string) => string, value: string): string {
  try {
    return decoder(value)
  } catch {
    return value
  }
}

export function parseGithubUrl(href: string): GithubRef | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    !HOSTS.has(url.hostname.toLowerCase())
  ) {
    return null
  }

  const [owner, rawRepo, section, ...rest] = url.pathname
    .split('/')
    .filter(Boolean)
    .map(segment => safeDecode(decodeURIComponent, segment))
  const hash = url.hash.slice(1)

  if (
    !owner ||
    !OWNER_RE.test(owner) ||
    RESERVED_OWNERS.has(owner.toLowerCase())
  ) {
    return null
  }
  if (!rawRepo) return { kind: 'user', owner }

  const repo = rawRepo.replace(/\.git$/, '')
  if (!REPO_RE.test(repo)) return null
  if (!section) return { kind: 'repo', owner, repo }

  const comment = COMMENT_ANCHOR_RE.test(hash)
  switch (section) {
    case 'issues':
    case 'discussions': {
      if (rest.length !== 1 || !NUMBER_RE.test(rest[0])) return null
      const kind = section === 'issues' ? 'issue' : 'discussion'
      return { kind, owner, repo, number: Number(rest[0]), comment }
    }
    case 'pull': {
      if (!NUMBER_RE.test(rest[0] ?? '')) return null
      // A commit viewed in the context of a pull request
      if (rest[1] === 'commits' && SHA_RE.test(rest[2] ?? '')) {
        return { kind: 'commit', owner, repo, sha: rest[2] }
      }
      return { kind: 'pull', owner, repo, number: Number(rest[0]), comment }
    }
    case 'commit': {
      if (rest.length !== 1 || !SHA_RE.test(rest[0])) return null
      return { kind: 'commit', owner, repo, sha: rest[0] }
    }
    case 'releases': {
      // Tags may contain slashes, e.g. `@scope/pkg@1.0.0`
      if (rest[0] !== 'tag' || rest.length < 2) return null
      return { kind: 'release', owner, repo, tag: rest.slice(1).join('/') }
    }
    case 'blob':
    case 'tree': {
      // Branch names with slashes can't be told apart from the path without
      // an API call, so the first segment is assumed to be the whole ref.
      const [ref, ...path] = rest
      if (!ref || (section === 'blob' && path.length === 0)) return null
      const lines = section === 'blob' && LINES_RE.test(hash) ? hash : undefined
      return { kind: section, owner, repo, ref, path: path.join('/'), lines }
    }
    default:
      return null
  }
}

export function isFetchable(ref: GithubRef): ref is FetchableRef {
  return ref.kind !== 'blob' && ref.kind !== 'tree'
}

/**
 * Cache key of the API resource behind a ref. Issues and pull requests share
 * a key because both are served by the issues endpoint.
 */
export function resourceKey(ref: FetchableRef): string {
  if (ref.kind === 'user') return `user:${ref.owner.toLowerCase()}`
  const repo = `${ref.owner}/${ref.repo}`.toLowerCase()
  switch (ref.kind) {
    case 'repo':
      return `repo:${repo}`
    case 'issue':
    case 'pull':
      return `issue:${repo}#${ref.number}`
    case 'discussion':
      return `discussion:${repo}#${ref.number}`
    case 'commit':
      return `commit:${repo}@${ref.sha.toLowerCase()}`
    case 'release':
      return `release:${repo}@${ref.tag}`
  }
}
