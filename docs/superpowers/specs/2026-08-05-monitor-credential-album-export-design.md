# Monitor Credential Picker and Album Export Design

## Objective

Align the monitoring and album-download interfaces with the Credential-only authentication model and the existing article download/export pipeline.

The change has three outcomes:

1. The monitor page selects an available Credential directly instead of presenting a generic “add account” action.
2. The global header removes the QQ group and documentation shortcuts and links GitHub to this repository.
3. Album downloads use the same content, metadata, comment, and multi-format export capabilities as the article page.

## Scope

### Monitor page

- Replace the top-right “添加公众号” button and modal entry point with an inline `USelectMenu`.
- List only Credentials that are valid and not already represented by a monitored account.
- Display the captured account identity in each option, using the nickname when available and the `biz` value as fallback.
- Selecting an option immediately adds that account to monitoring.
- Clear the selection after the operation so the remaining eligible Credentials are shown accurately.
- Disable the selector while an account is being added and show an empty-state placeholder when no Credential can be added.
- Keep the existing Credential cards and empty-state guidance in the page body.

### Global header

- Remove the QQ group and documentation buttons from the top-right action area.
- Retain the GitHub button and point it to `https://github.com/tomczhang/wechat-article-monitor`.
- Remove imports and modal setup that become unused in the action component.
- Leave documentation configuration used by settings pages unchanged.

### Album page

- Remove the legacy `useDownloadAlbum` HTML-only ZIP workflow from the album page.
- Remove the explicit “抓取全部文章链接” control because full-album loading becomes an automatic prerequisite of every download or export action.
- Add the same two action menus exposed by the article page:
  - Grab: article content, reading/engagement metadata, and comments.
  - Export: Excel, JSON, HTML, Txt, Markdown, Word, and PDF.
- Preserve existing export preferences, including whether supported formats include cached content or comments.
- Process the complete selected album, not only the currently rendered page.

## Architecture

The album page will be a thin adapter over the existing article pipeline:

1. The album API remains responsible for discovering and paginating album entries.
2. A focused conversion utility turns an album entry into the minimum valid article record required by the existing downloader and exporter.
3. A cache helper inserts only album entries that do not already exist by URL. It never overwrites a richer article record created by normal account synchronization.
4. The album page passes the complete URL list to the existing `useDownloader` and `useExporter` composables.

This keeps `Downloader`, `Exporter`, export preferences, Credential validation, resource handling, and comment rendering as the single implementation of article capabilities. Because the album page is the only consumer of the old HTML-only batch helper, implementation will remove that dead composable and its stale architecture reference.

## Album Article Cache Adapter

`Downloader` and `Exporter` resolve every URL through the IndexedDB article table. Album API results may include older entries that have never been synchronized into that table, so loading every album page is not sufficient by itself.

For each missing URL, the adapter will create a stable article stub containing:

- `fakeid` from the selected account.
- `link`, `title`, `create_time`, paid status, and cover from the album entry.
- `appmsgid` and `itemidx` from `msgid` and `itemidx`.
- A stable `aid` derived from `msgid` and `itemidx`.
- Empty/default values for fields unavailable from the album API.
- The selected album in `appmsg_album_infos`.

Existing records found by URL are reused unchanged. This avoids data loss and makes later normal synchronization safe.

## Full-Album Loading

Every grab or export action first calls a single `prepareAlbumArticles` workflow:

1. Verify that an account and album are selected.
2. Load subsequent pages until the API reports `continue_flag === '0'`.
3. Detect lack of pagination progress and abort with an error instead of looping indefinitely.
4. Deduplicate entries by URL while preserving the selected sort order.
5. Insert missing article stubs.
6. Return the complete ordered URL list to the requested action.

Only one preparation or article action may run at a time. Switching the account or album aborts outstanding album-page requests and resets page-local state.

## Interaction and Data Flow

### Grab actions

- “文章内容” invokes the existing HTML-content downloader.
- “阅读量” and “留言内容” first verify that the selected account has a valid Credential.
- When the Credential is missing or expired, the existing Credential gate opens for that account instead of starting the action.
- Comment grabbing retains the current requirement that article HTML has already been cached.
- Existing downloader progress, stop behavior, and completion messages are reused.

### Export actions

- Excel and JSON may export from article records according to current preferences.
- HTML, Txt, Markdown, Word, and PDF require cached article content, using the same missing-content guard as the article page.
- Comment inclusion continues to follow the existing export preferences and renderer behavior.
- Existing exporter phases and progress counts are displayed in the album toolbar.

## Error Handling

- Album pagination failure stops the requested operation and reports that the complete album could not be prepared.
- A repeated pagination cursor or page with no new URLs while `continue_flag` remains active is treated as a pagination error.
- Missing or expired Credentials open the existing Credential acquisition flow.
- Downloader/exporter partial failures retain successfully cached work and use their current summaries.
- Changing the selected account or album prevents stale responses from replacing the new selection’s data.
- Action controls are disabled while album preparation, downloading, or exporting is active.

## Testing

Add focused tests for:

- Filtering the monitor selector to valid, unmonitored Credentials.
- Converting an album entry into a stable, valid article stub.
- Preserving an existing article instead of overwriting it with an album stub.
- Full-album pagination stopping when `continue_flag` is zero.
- Pagination progress protection and URL deduplication.
- Album-page regression checks confirming use of `useDownloader` and `useExporter` and removal of the HTML-only batch action.
- Header regression checks confirming removal of QQ/document actions and the new GitHub URL.

Run the relevant Node test suite and a production Nuxt build after implementation.

## Non-Goals

- Changing Credential capture or expiration rules.
- Changing the article page’s existing export semantics or user preferences.
- Adding per-article selection to the album page.
- Redesigning the album preview content.
- Removing documentation links used inside settings pages.
