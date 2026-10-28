import {
  ArchiveIcon,
  CommentDiscussionIcon,
  DiscussionClosedIcon,
  DiscussionDuplicateIcon,
  DiscussionOutdatedIcon,
  DuplicateIcon,
  FileDirectoryIcon,
  FileIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  IssueClosedIcon,
  IssueOpenedIcon,
  LockIcon,
  OrganizationIcon,
  PersonIcon,
  RepoForkedIcon,
  RepoIcon,
  RepoTemplateIcon,
  SkipIcon,
  TagIcon,
  type Icon
} from '@primer/octicons-react'
import type { ResourceInfo } from './github'
import type { GithubRef } from './parse'

/** Icon colour, matching GitHub's state colours. */
export type Tone = 'open' | 'done' | 'closed' | 'muted'

export interface LinkView {
  icon: Icon
  tone?: Tone
  title: string
  /** Secondary text after the title, e.g. the issue number. */
  suffix?: string
  /** Render the suffix in a monospace font (commit SHAs, line ranges). */
  monoSuffix?: boolean
  tooltip?: string
}

type Status = { icon: Icon; tone: Tone; label: string }

/** Shown until the item's state is known. */
const PENDING_ICONS = {
  issue: IssueOpenedIcon,
  pull: GitPullRequestIcon,
  discussion: CommentDiscussionIcon
}

type InfoOf<T extends ResourceInfo['type']> = Extract<ResourceInfo, { type: T }>

function issueStatus(info: InfoOf<'issue'>): Status {
  const { pull } = info
  if (pull) {
    if (pull.merged) return { icon: GitMergeIcon, tone: 'done', label: 'Merged' }
    if (info.state === 'closed') {
      return { icon: GitPullRequestClosedIcon, tone: 'closed', label: 'Closed' }
    }
    if (pull.draft) return { icon: GitPullRequestDraftIcon, tone: 'muted', label: 'Draft' }
    return { icon: GitPullRequestIcon, tone: 'open', label: 'Open' }
  }
  if (info.state === 'open') return { icon: IssueOpenedIcon, tone: 'open', label: 'Open' }
  switch (info.stateReason) {
    case 'not_planned':
      return { icon: SkipIcon, tone: 'muted', label: 'Closed as not planned' }
    case 'duplicate':
      return { icon: DuplicateIcon, tone: 'muted', label: 'Closed as duplicate' }
    case 'completed':
      return { icon: IssueClosedIcon, tone: 'done', label: 'Closed as completed' }
    default:
      return { icon: IssueClosedIcon, tone: 'done', label: 'Closed' }
  }
}

function discussionStatus(info: InfoOf<'discussion'>): Status {
  if (!info.closed) return { icon: CommentDiscussionIcon, tone: 'open', label: 'Open' }
  switch (info.stateReason) {
    case 'OUTDATED':
      return { icon: DiscussionOutdatedIcon, tone: 'muted', label: 'Closed as outdated' }
    case 'DUPLICATE':
      return { icon: DiscussionDuplicateIcon, tone: 'muted', label: 'Closed as duplicate' }
    default:
      return { icon: DiscussionClosedIcon, tone: 'done', label: 'Closed as resolved' }
  }
}

function repoIcon(info: InfoOf<'repo'> | undefined): Icon {
  if (info?.isPrivate) return LockIcon
  if (info?.isArchived) return ArchiveIcon
  if (info?.isTemplate) return RepoTemplateIcon
  if (info?.isFork) return RepoForkedIcon
  return RepoIcon
}

/**
 * Decides how a GitHub link looks. Without `info` (still loading, or the
 * request failed) the view is built from the URL alone; `null` means the link
 * should be left as it is.
 */
export function describe(
  ref: GithubRef,
  info: ResourceInfo | undefined,
  showRepoName: boolean
): LinkView | null {
  if (ref.kind === 'user') {
    // A single path segment is only known to be an account once the API says so.
    if (info?.type !== 'user') return null
    return {
      icon: info.isOrg ? OrganizationIcon : PersonIcon,
      title: info.login,
      tooltip: info.name ?? undefined
    }
  }

  const repoName = `${ref.owner}/${ref.repo}`
  switch (ref.kind) {
    case 'repo': {
      const repo = info?.type === 'repo' ? info : undefined
      return { icon: repoIcon(repo), title: repoName, tooltip: repo?.description ?? undefined }
    }
    case 'issue':
    case 'pull':
    case 'discussion': {
      const reference = `${repoName}#${ref.number}`
      const comment = ref.comment ? ' (comment)' : ''
      const item = info?.type === 'issue' || info?.type === 'discussion' ? info : undefined
      if (!item) return { icon: PENDING_ICONS[ref.kind], title: reference + comment }

      const status = item.type === 'issue' ? issueStatus(item) : discussionStatus(item)
      return {
        icon: status.icon,
        tone: status.tone,
        title: item.title,
        suffix: (showRepoName ? reference : `#${ref.number}`) + comment,
        tooltip: `${reference} · ${status.label}`
      }
    }
    case 'commit': {
      const short = ref.sha.slice(0, 7)
      if (info?.type !== 'commit') return { icon: GitCommitIcon, title: `${repoName}@${short}` }
      return {
        icon: GitCommitIcon,
        title: info.message.split('\n', 1)[0],
        suffix: showRepoName ? `${repoName}@${short}` : short,
        monoSuffix: true,
        tooltip: info.message
      }
    }
    case 'release': {
      const release = info?.type === 'release' ? info : undefined
      return {
        icon: TagIcon,
        title: release?.name || ref.tag,
        suffix: showRepoName ? repoName : undefined,
        tooltip: `${repoName}@${ref.tag}` + (release?.prerelease ? ' · Pre-release' : '')
      }
    }
    case 'blob':
    case 'tree': {
      const tooltip = `${repoName}@${ref.ref}` + (ref.path ? `:${ref.path}` : '')
      // The root of a tree is effectively a link to a branch or tag
      if (!ref.path) return { icon: GitBranchIcon, title: ref.ref, suffix: repoName, tooltip }
      return {
        icon: ref.kind === 'blob' ? FileIcon : FileDirectoryIcon,
        title: showRepoName ? `${repoName}/${ref.path}` : ref.path,
        suffix: ref.lines,
        monoSuffix: true,
        tooltip
      }
    }
  }
}
