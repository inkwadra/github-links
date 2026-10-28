import type { ConfigSchema, Environment, IInkdropPlugin } from '@inkdropapp/types'
import { createGithubLink } from './GithubLink'
import { GithubClient, type RateLimitError } from './github'
import { store } from './store'

type Disposable = { dispose(): void }

/** How long the token setting has to stay unchanged before it is used. */
const TOKEN_DEBOUNCE = 1000

class InkdropPlugin implements IInkdropPlugin {
  config: Record<string, ConfigSchema> = {
    token: {
      title: 'GitHub access token',
      description:
        "Optional personal access token (read-only access is enough). Raises the API rate limit from 60 to 5,000 requests per hour and is required for private repositories and discussions. Stored in plain text in Inkdrop's config file.",
      type: 'string',
      default: '',
      order: 1
    },
    showRepoName: {
      title: 'Show repository name',
      description:
        'Show "owner/repo#123" instead of "#123" next to issue, pull request, discussion and commit titles.',
      type: 'boolean',
      default: false,
      order: 2
    },
    cacheTTL: {
      title: 'Cache lifetime (minutes)',
      description: 'How long fetched GitHub data is reused before it is requested again.',
      type: 'integer',
      default: 15,
      minimum: 1,
      order: 3
    }
  }

  private subscriptions: Disposable[] = []
  private originalLink: unknown
  private githubLink: unknown

  activate(env: Environment) {
    const components = env.markdownRenderer.remarkReactComponents
    this.originalLink = components.a
    this.githubLink = createGithubLink(components.a ?? 'a', env.markdownRenderer.Context)
    components.a = this.githubLink

    const notifyRateLimit = (error: RateLimitError) => {
      env.notifications.addWarning('GitHub API rate limit exceeded', {
        detail: `GitHub links will be updated again after ${error.resetAt.toLocaleTimeString()}. Set an access token in the github-links plugin settings to raise the limit.`,
        dismissable: true
      })
    }
    const notifyTokenRejected = () => {
      env.notifications.addWarning('GitHub access token was rejected', {
        detail:
          'GitHub links are not being updated. The token in the github-links plugin settings may have expired or been revoked.',
        dismissable: true
      })
    }

    // A new token replaces the client and empties the cache, so it is applied
    // only once typing has paused; partial tokens never reach the API.
    let token: string | undefined
    let tokenTimer: ReturnType<typeof setTimeout> | undefined
    const applyToken = (value: string) => {
      store.setClient(new GithubClient(value, notifyRateLimit, notifyTokenRejected))
    }

    this.subscriptions.push(
      env.config.observe('github-links.token', (value?: string) => {
        const next = value?.trim() ?? ''
        if (next === token) return
        clearTimeout(tokenTimer)
        // The initial value is applied at once so links can load on first render
        if (token === undefined) applyToken(next)
        else tokenTimer = setTimeout(() => applyToken(next), TOKEN_DEBOUNCE)
        token = next
      }),
      { dispose: () => clearTimeout(tokenTimer) },
      env.config.observe('github-links.showRepoName', (value?: boolean) => {
        store.setShowRepoName(!!value)
      }),
      env.config.observe('github-links.cacheTTL', (minutes?: number) => {
        store.setTTL(minutes ?? 15)
      }),
      env.commands.add(document.body, {
        'github-links:refresh': () => store.clear()
      })
    )
  }

  deactivate(env: Environment) {
    const components = env.markdownRenderer.remarkReactComponents
    // Leave the component alone if another plugin has wrapped ours since
    if (components.a === this.githubLink) components.a = this.originalLink

    for (const subscription of this.subscriptions) subscription.dispose()
    this.subscriptions = []
    store.setClient(null)
  }
}

export default new InkdropPlugin()
