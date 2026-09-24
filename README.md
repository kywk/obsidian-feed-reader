# Vault Feed Reader

[繁體中文](README.zh-TW.md)

A desktop RSS and Atom reader for Obsidian, built for high-volume browsing, curation, and selective saving into your vault as Markdown.

---

## 1. Project Purpose

Vault Feed Reader brings an efficient, modern feed reading experience directly into Obsidian without relying on third-party cloud aggregators (no Feedly account required).

It adheres to a **Vault-as-Source-of-Truth** architecture:
- **Subscriptions**, **reading state**, **user lists** (Favorites & Read Later), and **saved notes** live inside your vault as standard files (`.yaml`, `.json`, `.md`), making your feeds and curation 100% portable across computers and sync systems.
- **Article content** is cached locally in an IndexedDB database for fast viewing and offline reading, designed to be disposable without cluttering vault sync.

---

## 2. Use Cases

- **Daily Feed Triage**: Monitor dozens or hundreds of feeds efficiently with keyboard navigation (`j` / `k`), view today's updates, or filter by unread articles.
- **Read Later & Favorites**: Triage articles on the fly. Add items to **Read Later** for deferred reading, or star them as **Favorites** for quick reference without creating notes immediately.
- **Selective Markdown Notes**: Save noteworthy articles into Markdown notes with customizable frontmatter and body templates. Re-saving opens the existing note without overwriting manual notes.
- **AI-Powered Note Enrichment**: Use Obsidian command palette actions on saved notes to extract full article text and generate structured AI summaries with topic tags using local CLI agents (Claude Code, Codex, OpenCode, pi).

---

## 3. Key Features

- **Streamlined Reader Interface**:
  - **Left Sidebar Navigation**: Fast access to `Today`, `Saved`, `Favorite`, and `Read Later`, plus a collapsible source tree organized by single-level folders with unread badges.
  - **List Header Navigation**: Dual-group filter toolbar separated by a divider:
    `All articles` / `Unread` / `Read` | `Today` / `Saved` / `Favorite` / `Read Later`
  - **Magazine Layout**: Rich thumbnail and summary snippet cards for individual feed views; clean, dense list layout for folders and global views.
  - **Compact Article Toolbar**: Icon-only controls with tooltips:
    1. Open original link (`external-link`)
    2. Copy original URL (`link`)
    3. Copy Markdown link (`file-text`)
    4. Save / Open note (`bookmark` / `bookmark-check` when saved)
    5. Add / Remove Favorite (`star`)
    6. Add / Remove Read Later (`clock`, manual removal only)
    7. Toggle read / unread (`check-check`)
  - **Full Keyboard Navigation**:
    | Shortcut | Action |
    |---|---|
    | `j` / `k` | Next / previous article (syncs reading pane) |
    | `Enter` | Open selected article |
    | `o` | Open original article in external browser |
    | `m` | Toggle read / unread |
    | `s` | Save note or reveal existing note |
    | `Esc` | Return to article list |
- **Vault-Centric Storage**:
  - Subscriptions saved in YAML (`feeds.yaml`), with full OPML / YAML / TOML import & export.
  - Reading state and user lists stored in JSON within `${rootFolder}/state/`.
  - Articles cached locally up to 500 items per feed; cache eviction never alters reading state or saved notes.
- **Note Templates & Preserved Edits**:
  - Customize filename, YAML properties, and Markdown body with variables (`{{title}}`, `{{feed}}`, `{{link}}`, `{{date}}`, `{{content}}`).
  - Edits made to saved Markdown notes are strictly preserved upon future saves.
- **Local AI Full-Text & Summaries**:
  - Command palette actions for Markdown notes: Fetch full text, Generate AI summary & tags, or both.
  - Integrates with local AI CLI tools via stdio with custom prompts.
- **Multilingual Support**:
  - English and Traditional Chinese (`zh-TW`) with automatic Obsidian language detection.

---

## 4. Configuration & Settings

Access settings via **Settings → Vault Feed Reader**:

### General Settings
- **Feed Reader root folder**: Vault-relative root folder (default: `Feed Reader`). Changing to an empty folder prompts you to move existing files or create a new source.
- **Subscriptions YAML**: Vault-relative YAML path (default: `Feed Reader/feeds.yaml`).
- **Saved articles folder**: Vault-relative folder for saved notes (default: `Feed Reader/Articles`).
- **Default list filter**: Initial filter when opening lists (`unread`, `all`, `read`, or `today`).
- **Mark read on j/k navigation**: Automatically mark articles as read when navigating with `j`/`k` (default: disabled).
- **Language**: Choose `Follow Obsidian` (default), `English`, or `繁體中文` (requires reload).

### Saved Note Templates
- **Filename template**: e.g., `{{date}} {{title}}` (without `.md`).
- **Body template**: Markdown content structure incorporating `{{content}}`.
- **Custom Properties**: Frontmatter mapping in YAML without `---`. Supports tags and metadata.

### Article Full Text & AI Summaries
- **Original URL fields**: Comma-separated frontmatter fields to detect article URLs (default: `feed_reader_url, source, url`).
- **Heading & Body Rules**: Target section headings for appending or replacing full text.
- **Summary prompt**: Custom prompt requesting summary points and topic tags.
- **Local Agent**: Select preconfigured CLI (`codex`, `claude`, `opencode`, `pi`) or specify a custom executable and arguments.

---

## 5. Obsidian Community Information

- **Platform Compatibility**: Desktop Obsidian only (macOS, Windows, Linux). Minimum required Obsidian version: **1.8.7**.
- **Installation**:
  - **Community Plugins**: Search for `Vault Feed Reader` in Obsidian Settings → Community Plugins and click Install.
  - **Manual Installation**: Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub Release](https://github.com/kywk/obsidian-feed-reader/releases), place them in `<vault>/.obsidian/plugins/vault-feed-reader/`, and enable the plugin in Settings.
- **Network & Privacy**:
  - Connects strictly via HTTP(S) to public feed URLs you subscribe to.
  - Images in articles load from remote hosts specified by feeds.
  - No telemetry, analytics, trackers, user accounts, or cloud server intermediaries.
  - AI summaries execute entirely through your local CLI installations.
- **License**: [MIT License](LICENSE).
