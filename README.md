# Vault Feed Reader

[繁體中文](README.zh-TW.md)

A desktop RSS and Atom reader for Obsidian, built for browsing many feeds and saving selected articles as Markdown. Subscriptions, reading state, and saved notes live in your vault; article content is cached locally in IndexedDB.

## Status and requirements

The MVP and OPML import/export are implemented. The recorded OPML validation passed the build and 90 regular tests, with one opt-in scale test skipped. OPML has not yet been tested in Obsidian or against real exports from other readers. See [OPML validation](docs/opml-validation.md) and the earlier [MVP validation](docs/history/2026-09-22-rss-reader-mvp/mvp-validation.md) for the scope and limitations of previous checks.

- Desktop Obsidian only; declared minimum version: **1.8.7**. This does not mean every desktop version has been tested.
- No Feedly or other service account is required. Only public HTTP(S) feeds are supported.
- Not yet published in the Community Plugins directory.

## Installation and development

Use Node.js 22:

```sh
npm ci
npm run build
npm test
# Optional: 100k article metadata scale test; takes several minutes
npm run test:scale
# Watch mode
npm run dev
```

Copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/vault-feed-reader/` in a test vault. Enable **Vault Feed Reader** under Settings → Community plugins. Disable and re-enable the plugin after replacing its files.

For release preparation, see the [publishing checklist](docs/releasing.md). Contributors should start with [AGENTS.md](AGENTS.md); the behavior contract is in [SPEC.md](SPEC.md), and recorded development progress is indexed in [docs/progress.md](docs/progress.md).

## Reading feeds

1. Click the RSS ribbon icon or run **Open RSS reader** to open the source sidebar and reader.
2. Open **Manage sources** to add a public RSS/Atom URL, a display name, and folders. One source can belong to multiple folders.
3. Select a source to show its full-width article list. Select an article to read it and mark it as read. Filters include all, unread, read, today, and saved; you can also filter by source/folder and search titles. Selecting a source reopens a closed reader or reuses an existing one.
4. Press `s` to save the feed-provided article body or summary as Markdown. Saving an already saved article opens its existing note without overwriting manual edits. The saved list does not depend on the article remaining in the cache.

The article view provides **Back to list**, **Previous**, and **Next**. Press `Esc` to return to the list with the selection preserved. Search, filters, and bulk **Reading actions** are available in the list view.

Lists show up to 50 articles per page and load full content on demand. Navigation with `j/k` crosses page boundaries. The cache retains the latest 500 articles per source; eviction does not delete reading state or saved notes. An article just marked as read stays in the unread list until you reapply filters or change sources.

| Shortcut | Action |
|---|---|
| `j` / `k` | Next / previous article; also changes the article when its content is open |
| `Enter` | Open the selected article |
| `o` | Open the HTTP(S) original in your external browser |
| `m` | Toggle read / unread |
| `s` | Save or open the existing saved note |
| `Esc` | Return to the list |

Shortcuts work only when the reader has focus and you are not typing in an input or composing with an IME. **Mark read on j/k navigation** is off by default.

## Subscriptions and reading state

Vault YAML is the authoritative subscription source. UI changes write back to YAML. YAML, TOML, and OPML import/export are supported. Import defaults to merging; replacing subscriptions requires confirmation. Merge deduplicates by URL while preserving existing folders and source IDs. URLs with different query strings remain distinct.

External YAML edits reload automatically. If the file is invalid, the plugin reports the error, retains the last valid list, and stops UI writes until the file is repaired. A source URL is part of its identity: add a new source to change the URL; names and folder assignments can be edited directly.

Removing a source from a folder only removes that association. Unsubscribing removes the source globally and clears its local cache. Deleting a folder keeps its sources; sources without folders appear under **Unfiled**. Resubscribing to the same URL preserves its original ID and reading history.

Bulk read actions apply to the current source, folder, or all sources, independently of title search. Date-based actions use local midnight and affect articles strictly before that cutoff. Manually marking an article unread overrides the cutoff until it is explicitly marked read again.

| Data | Default location |
|---|---|
| Subscription YAML | `Feed Reader/feeds.yaml` (configurable) |
| Per-source reading state | `Feed Reader/state/<feedId>.json` |
| URL-to-ID mapping | `Feed Reader/state/source-ids.json`; preserves identity on resubscription |
| Saved notes | `Feed Reader/Articles/` (configurable) |
| Article metadata and content | Local IndexedDB, partitioned by vault path and source |

Back up your vault subscriptions, state, and notes. IndexedDB is a disposable cache that can be rebuilt from available feeds, not a historical archive or cross-device sync source. The plugin does not merge cross-device conflicts.

## Refreshing and content

Opening the reader triggers a refresh. While any reader tab exists, feeds refresh every 30 minutes, even when you switch to a note. Closing the last reader stops the schedule. After sleep, an overdue schedule triggers one catch-up refresh. Manual refresh is available; a failed source retains its cached articles and displays an error.

Only feed-provided content or summaries are used. The plugin does not scrape original article pages, sign in to Feedly or other services, or download attachments. Rendering and saving share DOMPurify sanitization and HTTP(S) URL rules. Remote images remain URLs: saved text is available offline, but images may not be.

## Privacy and network access

- Refreshing sends requests directly to the public RSS/Atom URLs you subscribe to, including destinations reached through redirects, to retrieve articles.
- Displaying article images can contact the image hosts specified by the feed, including third-party hosts. Saved notes retain these remote URLs and may load them when viewed in Obsidian. Those hosts receive ordinary network requests, including your IP address.
- Opening the original article launches its URL in your external browser.
- The plugin has no analytics, telemetry, advertisements, paid features, or developer-operated backend. It does not upload your notes or reading state to a plugin service.
- Persistent subscriptions, state, and saved notes stay in the vault; plugin settings use Obsidian's plugin data storage. Article cache uses local IndexedDB. The plugin does not directly read or write arbitrary files outside the vault. Importing a file uses a user-selected file; exporting a download uses the browser download mechanism.

## Sidebar, themes, and large subscription lists

The sidebar groups common filters, source actions, **Feeds**, and **Unfiled**. Folder arrows collapse groups; folder names select their scope. Counts show unread cached articles, and **All articles** counts shared sources once. Collapse state lasts until the view closes.

The UI uses Obsidian buttons, icons, navigation colors, and font variables. Article content uses `markdown-rendered` and reading fonts. Feed HTML inline styles, classes, and legacy color/font attributes are removed to avoid overriding your theme. Default theme light/dark switching was tested previously; third-party themes have not been individually verified. The newer sidebar counting path has not been measured with 100k articles in native Obsidian.

**Manage sources** opens a dedicated tab and reuses it on subsequent opens. The list shows 50 sources per page and searches all subscriptions by name, URL, or folder without rebuilding the search field as you type. **Sources** and **Folders** have separate views. Editing, categorization, and import/export happen in this tab. Uncheck a folder in **Edit / folders** to remove only that association.

## Saved note templates

Under Settings → Vault Feed Reader → **Saved note templates**, configure:

- **Filename template**: omit `.md`; defaults to `{{date}} {{title}}`. Invalid filename characters are removed; collisions receive a unique suffix.
- **Body template**: Markdown content, defaulting to the title and article. Add your own notes, summaries, or task sections.
- **Custom Properties**: a YAML mapping without `---`. Supports strings, numbers, booleans, null, and lists of those values. Quote values containing variables; the serializer handles YAML escaping after substitution.

Example properties:

```yaml
tags:
  - rss
status: inbox
source: "{{feed}}"
```

Example body:

```markdown
# {{title}}

## My notes

## Article

{{content}}
```

Available variables: `{{title}}`, `{{feed}}`, `{{link}}`, `{{published}}`, `{{created}}`, and `{{date}}`; `{{content}}` is available only in the body and contains the feed-provided content/summary. Author, separate summary, and folder variables are not supported. Text values are Markdown-escaped in the body; content is sanitized HTML converted to Markdown. Variables do not expand recursively or execute code.

`published` and `created` default to ISO timestamps. Supported date formats are `YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, `YYYY-MM-DD HH:mm:ss`, and `YYYY-MM-DDTHH:mm:ss`, for example `{{created:YYYY-MM-DD}}`; all use UTC. Missing publication dates yield an empty `published`. The `date` fallback order is publication time, first fetch time, then save time.

The settings page previews the filename and Markdown source. Unknown variables, invalid YAML, and reserved properties show errors and disable **Apply**. **Apply templates** saves changes; **Load defaults** only resets the draft and still requires Apply. `title` and `feed_reader_*` are managed by the plugin and cannot be overridden.

Templates affect only new notes. Existing saved notes open unchanged; editing templates does not rewrite historical notes or personal annotations. Users without custom templates keep the default format.

## Moving subscriptions with OPML

In **Manage sources → Import / export**, select **OPML**, paste text or select an `.opml`/`.xml` file, then click Import. Selecting a file does not change the format automatically. Import defaults to Merge; **Replace all subscriptions** requires confirmation. **Generate export** produces text to copy; **Download** saves `feeds.opml`.

- Imports OPML 1.0, 1.1, and 2.0; exports OPML 2.0. YAML remains authoritative.
- Nested categories flatten to `Parent / Child`; parent and empty folders are retained. Export uses one level and does not reconstruct the hierarchy.
- Duplicate URLs merge with all folder associations. A source may appear in multiple exported categories but becomes one source when reimported.
- Merge matches folders by exact name and retains existing source names, IDs, and associations. Replace uses imported names/categories while retaining known URL IDs.
- OPML contains no project-specific IDs. A new environment generates new IDs. Reading state, cached content, and saved notes are not part of OPML.
- Outline `title` takes precedence over `text`; unnamed feeds use their URL. Feed URLs must use HTTP(S).
- Malformed XML, RSS outlines without `xmlUrl`, unsupported outline types, unnamed categories, and ambiguous flattened names reject the entire import. DTD/custom entity declarations are rejected; standard XML escaping is supported.
- Standard OPML cannot distinguish same-named folders. Rename ambiguous folders before export or matching them to existing folders on import.

## Reporting issues

Report problems through [GitHub Issues](https://github.com/kywk/obsidian-feed-reader/issues). Include Obsidian and plugin versions, operating system, steps to reproduce, and relevant errors. For parsing/import issues, provide a minimal public feed URL or sanitized sample. Remove private notes, credentials, and subscription URLs containing tokens before sharing.

## License

[MIT](LICENSE), copyright 2026 kywk. Third-party dependencies retain their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md). The build includes these notices in `main.js` so they accompany installed copies.
