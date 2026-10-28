import {
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ComponentProps,
  type Context,
  type ElementType,
  type ReactNode
} from 'react'
import type { MarkdownRendererContextType } from '@inkdropapp/types'
import { describe } from './describe'
import { isFetchable, parseGithubUrl, resourceKey, safeDecode, type GithubRef } from './parse'
import { store } from './store'

type AnchorProps = ComponentProps<'a'>

function normalizeUrl(url: string): string {
  return safeDecode(decodeURI, url.trim())
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
}

/**
 * Only links written as a bare URL (or with empty text) are restyled, so a
 * label the author chose is never replaced.
 */
function isBareLink(href: string, children: ReactNode): boolean {
  if (children == null || children === '') return true
  const text =
    typeof children === 'string'
      ? children
      : Array.isArray(children) && children.every(child => typeof child === 'string')
        ? children.join('')
        : null
  return text !== null && normalizeUrl(text) === normalizeUrl(href)
}

/**
 * Wraps the renderer's current `a` component. GitHub links get their content
 * replaced with an icon and a title, but are still rendered through `Original`
 * so Inkdrop's click handling and embeds keep working.
 */
export function createGithubLink(
  Original: ElementType<AnchorProps>,
  RendererContext: Context<MarkdownRendererContextType>
) {
  function GithubRefLink({ githubRef, linkProps }: { githubRef: GithubRef; linkProps: AnchorProps }) {
    const fetchable = isFetchable(githubRef) ? githubRef : null
    const key = fetchable && resourceKey(fetchable)
    // Links without an API resource (files, trees) only follow display changes
    const subscribe = useCallback(
      (listener: () => void) => store.subscribe(key ?? '', listener),
      [key]
    )
    const getEntry = () => (key ? store.get(key) : undefined)
    // The snapshot getters double as server snapshots so static rendering
    // (e.g. copying the preview as HTML) uses whatever is already cached.
    const entry = useSyncExternalStore(subscribe, getEntry, getEntry)
    const display = useSyncExternalStore(subscribe, store.getDisplay, store.getDisplay)

    // Runs after every render so entries that expired in the meantime get refreshed
    useEffect(() => {
      if (key && fetchable) store.load(key, fetchable)
    })

    // Another plugin's wrapper can keep rendering this after deactivation
    const view = display.enabled
      ? describe(githubRef, entry?.data, display.showRepoName)
      : null
    if (!view) return <Original {...linkProps} />

    const loading = !!key && !entry?.data && (!entry || entry.loading)
    const className = [
      linkProps.className,
      'github-link',
      `github-link-${githubRef.kind}`,
      view.tone && `is-${view.tone}`,
      loading && 'is-loading'
    ]
      .filter(Boolean)
      .join(' ')
    const { icon: Icon } = view

    return (
      <Original {...linkProps} className={className} title={linkProps.title ?? view.tooltip}>
        <Icon className="github-link-icon" />
        <span className="github-link-title">{view.title}</span>
        {view.suffix && (
          <>
            {' '}
            <span className={view.monoSuffix ? 'github-link-suffix is-mono' : 'github-link-suffix'}>
              {view.suffix}
            </span>
          </>
        )}
      </Original>
    )
  }

  return function GithubLink(props: AnchorProps) {
    const printMode = useContext(RendererContext)?.printMode
    const { href, children } = props
    // Exports are rendered once, without waiting for API responses
    const githubRef =
      !printMode && href && isBareLink(href, children) ? parseGithubUrl(href) : null
    if (!githubRef) return <Original {...props} />
    return <GithubRefLink githubRef={githubRef} linkProps={props} />
  }
}
