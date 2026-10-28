# github-links

Turns bare GitHub URLs in the Inkdrop preview into rich references with
[Octicons](https://primer.style/octicons), using the official GitHub API.

| Link | Rendered as |
| --- | --- |
| `https://github.com/primer/octicons` | <kbd>repo</kbd> primer/octicons |
| `https://github.com/primer/octicons/issues/1383` | <kbd>issue-closed</kbd> Investigate publish workflow failure #1383 |
| `https://github.com/primer/octicons/pull/1000` | <kbd>git-pull-request-closed</kbd> feat(octicons_react): add mjs extension for esm output #1000 |
| `https://github.com/primer` | <kbd>organization</kbd> primer |

Icons and colours follow the item's state, as on github.com:

- **Issues** — open, closed as completed, closed as not planned, closed as duplicate
- **Pull requests** — open, draft, merged, closed
- **Discussions** — open, resolved, outdated, duplicate (requires a token)
- **Repositories** — public, private, fork, template, archived
- **Users and organizations**
- **Commits** — first line of the message and the short SHA
- **Releases** — release name
- **Files and directories** (`/blob/…`, `/tree/…`) — path and line range, without an API call

Links to a comment (`#issuecomment-…`) get a "(comment)" suffix. Only links whose
text is the URL itself (or empty) are changed: `[my label](https://github.com/…)`
keeps its label. Until the data arrives, or if the request fails, the link shows
a short reference such as `primer/octicons#1383`.

## How to install

See [the documentation](https://docs.inkdrop.app/manual/extend-inkdrop-with-plugins) for more detail.

```sh
ipm install github-links
```

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| GitHub access token | – | Optional. Raises the rate limit from 60 to 5,000 requests per hour and is needed for private repositories and discussions. A fine-grained token with read-only access is enough. It is stored in plain text in Inkdrop's config file. |
| Show repository name | off | Show `owner/repo#123` instead of `#123` next to titles. |
| Cache lifetime (minutes) | 15 | How long fetched data is reused before it is requested again. |

Run **Plugins › GitHub Links › Refresh GitHub Links** (`github-links:refresh`) to
drop the cache and fetch everything again.

## Styling

The rendered link has the classes `github-link`, `github-link-<kind>` and, for
items with a state, `is-open`, `is-done`, `is-closed` or `is-muted`. Inside it
are `.github-link-icon`, `.github-link-title` and `.github-link-suffix`, so the
look can be adjusted from your `styles.less`.

## Development

```sh
pnpm install
pnpm dev       # rebuild on change
pnpm build     # production build into lib/
ipm link       # symlink into your Inkdrop data dir for local testing
```
