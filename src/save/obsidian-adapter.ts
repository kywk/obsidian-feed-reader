import type { EventRef, MetadataCache, Vault } from 'obsidian';
import type { SavedArticle, SavedNoteChange, SavedNoteStorage } from './types';

function metadataString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function savedArticleFromFrontmatter(path: string, frontmatter: Record<string, unknown> | undefined): SavedArticle | undefined {
  if (!frontmatter) return undefined;
  const articleKey = metadataString(frontmatter.feed_reader_id);
  const articleId = metadataString(frontmatter.feed_reader_article_id);
  const feedId = metadataString(frontmatter.feed_reader_source_id);
  const title = metadataString(frontmatter.title);
  const sourceTitle = metadataString(frontmatter.feed_reader_source);
  const savedAt = metadataString(frontmatter.date_created) ?? metadataString(frontmatter.feed_reader_saved_at);
  if (!articleKey || !articleId || !feedId || !title || !sourceTitle || !savedAt) return undefined;
  const firstFetchedAt = metadataString(frontmatter.feed_reader_first_fetched_at) ?? savedAt;

  const url = metadataString(frontmatter.feed_reader_url);
  const publishedAt = metadataString(frontmatter.feed_reader_published_at);
  return {
    articleKey,
    articleId,
    feedId,
    title,
    sourceTitle,
    path,
    savedAt,
    firstFetchedAt,
    ...(url ? { url } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  };
}

async function ensureParentFolders(vault: Vault, path: string): Promise<void> {
  const parts = path.split('/').slice(0, -1);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (vault.getAbstractFileByPath(current)) continue;
    try {
      await vault.createFolder(current);
    } catch (error) {
      if (!vault.getAbstractFileByPath(current)) throw error;
    }
  }
}

/** Vault I/O plus a metadata-cache-only index adapter for ArticleSaveService. */
export class ObsidianSavedNoteStorage implements SavedNoteStorage {
  constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
  ) {}

  exists(path: string): boolean {
    return this.vault.getAbstractFileByPath(path) !== null;
  }

  async create(path: string, contents: string): Promise<void> {
    if (this.exists(path)) throw new Error(`Refusing to overwrite existing note: ${path}`);
    await ensureParentFolders(this.vault, path);
    if (this.exists(path)) throw new Error(`Refusing to overwrite existing note: ${path}`);
    await this.vault.create(path, contents);
  }

  list(): SavedArticle[] {
    const notes: SavedArticle[] = [];
    for (const file of this.vault.getMarkdownFiles()) {
      const frontmatter = this.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      const note = savedArticleFromFrontmatter(file.path, frontmatter);
      if (note) notes.push(note);
    }
    return notes;
  }

  watch(listener: (change: SavedNoteChange) => void): () => void {
    const refs: Array<{ owner: Vault | MetadataCache; ref: EventRef }> = [];
    refs.push({
      owner: this.metadataCache,
      ref: this.metadataCache.on('changed', (file, _data, cache) => {
        const note = savedArticleFromFrontmatter(
          file.path,
          cache.frontmatter as Record<string, unknown> | undefined,
        );
        listener(note ? { type: 'upsert', note } : { type: 'delete', path: file.path });
      }),
    });
    refs.push({
      owner: this.metadataCache,
      ref: this.metadataCache.on('resolve', file => {
        const frontmatter = this.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        const note = savedArticleFromFrontmatter(file.path, frontmatter);
        if (note) listener({ type: 'upsert', note });
      }),
    });
    refs.push({
      owner: this.vault,
      ref: this.vault.on('delete', file => listener({ type: 'delete', path: file.path })),
    });
    refs.push({
      owner: this.vault,
      ref: this.vault.on('rename', (file, oldPath) => listener({
        type: 'rename',
        oldPath,
        newPath: file.path,
      })),
    });
    return () => refs.forEach(({ owner, ref }) => owner.offref(ref));
  }
}
