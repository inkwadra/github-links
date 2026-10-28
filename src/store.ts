import { isNotFound, type GithubClient, type ResourceInfo } from './github'
import { resourceKey, type FetchableRef } from './parse'

export interface CacheEntry {
  /** Last fetched data; kept while revalidating or after a transient error. */
  data?: ResourceInfo
  error?: unknown
  loading: boolean
  expiresAt: number
}

/** State every link renders with; replaced on change so it works as a snapshot. */
export interface DisplayState {
  /** False while there is no client, i.e. once the plugin is deactivated. */
  enabled: boolean
  showRepoName: boolean
}

/** How long failures other than 404 are remembered before retrying. */
const ERROR_TTL = 60_000

type Listener = () => void

/**
 * Shared cache of GitHub API responses. The preview re-renders on every edit,
 * so links read from here instead of fetching on mount; components subscribe
 * to their entry with `useSyncExternalStore` and re-render when it changes.
 */
class ResourceStore {
  private entries = new Map<string, CacheEntry>()
  /** Listeners by resource key, so a response only reaches the links showing it. */
  private listeners = new Map<string, Set<Listener>>()
  /** Bumped by `clear()` so responses to stale requests are dropped. */
  private generation = 0
  private client: GithubClient | null = null
  private ttl = 15 * 60_000
  private display: DisplayState = { enabled: false, showRepoName: false }

  /** Listens to one entry; `clear()` and display changes notify every listener. */
  subscribe(key: string, listener: Listener) {
    const keyListeners = this.listeners.get(key) ?? new Set<Listener>()
    this.listeners.set(key, keyListeners)
    keyListeners.add(listener)
    return () => {
      keyListeners.delete(listener)
      if (keyListeners.size === 0) this.listeners.delete(key)
    }
  }

  get = (key: string): CacheEntry | undefined => this.entries.get(key)

  getDisplay = (): DisplayState => this.display

  /** Fetches the resource unless a fresh or in-flight entry already exists. */
  load(key: string, ref: FetchableRef) {
    const { client, generation } = this
    const previous = this.entries.get(key)
    if (!client || previous?.loading || (previous && Date.now() < previous.expiresAt)) {
      return
    }

    this.set(key, { data: previous?.data, loading: true, expiresAt: Infinity })
    client.fetch(ref).then(
      data => {
        const entry = { data, loading: false, expiresAt: Date.now() + this.ttl }
        this.settle(generation, key, entry)
        // A commit linked by an abbreviated SHA also serves links to the full one
        if (ref.kind === 'commit' && data.type === 'commit') {
          const fullKey = resourceKey({ ...ref, sha: data.sha })
          if (fullKey !== key) this.settle(generation, fullKey, entry)
        }
      },
      error => {
        const notFound = isNotFound(error)
        this.settle(generation, key, {
          data: notFound ? undefined : previous?.data,
          error,
          loading: false,
          expiresAt: Date.now() + (notFound ? this.ttl : ERROR_TTL)
        })
      }
    )
  }

  /** Drops every entry; mounted links fetch their data again. */
  clear() {
    this.generation++
    this.entries.clear()
    this.emit()
  }

  setClient(client: GithubClient | null) {
    this.client = client
    this.display = { ...this.display, enabled: client !== null }
    this.clear()
  }

  setTTL(minutes: number) {
    this.ttl = Math.max(1, minutes) * 60_000
  }

  setShowRepoName(value: boolean) {
    this.display = { ...this.display, showRepoName: value }
    this.emit()
  }

  private settle(generation: number, key: string, entry: CacheEntry) {
    if (generation === this.generation) this.set(key, entry)
  }

  private set(key: string, entry: CacheEntry) {
    this.entries.set(key, entry)
    this.emit(key)
  }

  /** Notifies the listeners of `key`, or every listener without one. */
  private emit(key?: string) {
    const groups = key === undefined ? [...this.listeners.values()] : [this.listeners.get(key)]
    for (const group of groups) {
      if (group) for (const listener of group) listener()
    }
  }
}

export const store = new ResourceStore()
