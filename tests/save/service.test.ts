import { parse } from 'yaml';
import { DEFAULT_NOTE_TEMPLATES } from '../../src/save/templates';
import { describe, expect, it, vi } from 'vitest';
import type { Article, FeedSource } from '../../src/domain/models';
import { ArticleSaveService, articleKey } from '../../src/save';
import type { SavedArticle, SavedNoteChange, SavedNoteStorage } from '../../src/save';

class MemorySavedNoteStorage implements SavedNoteStorage {
  readonly files = new Map<string, string>();
  readonly metadata = new Map<string, SavedArticle>();
  readonly listeners = new Set<(change: SavedNoteChange) => void>();
  creates = 0;
  lists = 0;
  failNextCreate = false;
  createGate?: Promise<void>;

  exists(path: string): boolean {
    return this.files.has(path);
  }

  async create(path: string, contents: string): Promise<void> {
    this.creates += 1;
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('disk full');
    }
    await this.createGate;
    if (this.files.has(path)) throw new Error('already exists');
    this.files.set(path, contents);
  }

  list(): SavedArticle[] {
    this.lists += 1;
    return [...this.metadata.values()].map(note => ({ ...note }));
  }

  watch(listener: (change: SavedNoteChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(change: SavedNoteChange): void {
    if (change.type === 'upsert') this.metadata.set(change.note.path, { ...change.note });
    if (change.type === 'delete') {
      this.files.delete(change.path);
      this.metadata.delete(change.path);
    }
    if (change.type === 'rename') {
      const contents = this.files.get(change.oldPath);
      if (contents !== undefined) {
        this.files.delete(change.oldPath);
        this.files.set(change.newPath, contents);
      }
      const metadata = this.metadata.get(change.oldPath);
      if (metadata) {
        this.metadata.delete(change.oldPath);
        this.metadata.set(change.newPath, { ...metadata, path: change.newPath });
      }
    }
    for (const listener of this.listeners) listener(change);
  }
}

const source: FeedSource = {
  id: 'feed-one',
  url: 'https://example.com/feed.xml',
  title: 'Example: "News"',
  folderIds: [],
};

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'article-one',
    feedId: source.id,
    title: 'An article',
    url: 'https://example.com/posts/one',
    publishedAt: '2026-09-20T08:30:00.000Z',
    firstFetchedAt: '2026-09-21T00:00:00.000Z',
    contentHtml: '<p>Hello <strong>reader</strong>.</p>',
    ...overrides,
  };
}

function service(storage: MemorySavedNoteStorage, sanitize = (html: string) => html): ArticleSaveService {
  return new ArticleSaveService(storage, {
    folder: 'Feed Reader/Articles',
    sanitize,
    now: () => new Date('2026-09-22T02:03:04.000Z'),
  });
}

function frontmatter(markdown: string): Record<string, unknown> {
  return parse(markdown.split('---\n')[1]!) as Record<string, unknown>;
}

describe('ArticleSaveService', () => {
  it('saves and reopens when the template callback returns the full plugin settings', async () => {
    const storage = new MemorySavedNoteStorage();
    const settings = {
      ...DEFAULT_NOTE_TEMPLATES,
      subscriptionsPath: 'Feed Reader/feeds.yaml',
      savedArticlesFolder: 'Feed Reader/Articles',
      markReadOnNavigate: true,
      enrichment: { rules: [], summaryPrompt: '摘要' },
    };
    const saver = new ArticleSaveService(storage, { folder: settings.savedArticlesFolder, sanitize: html => html, templates: () => settings });
    const saved = await saver.save(article(), source);
    expect(saved.created).toBe(true);
    expect(storage.files.get(saved.note.path)).toContain('Hello **reader**');
    storage.files.set(saved.note.path, 'Human edit');
    expect((await saver.save(article(), source)).created).toBe(false);
    expect(storage.files.get(saved.note.path)).toBe('Human edit');
  });

  it('deduplicates simultaneous and repeated saves without replacing the note', async () => {
    const storage = new MemorySavedNoteStorage();
    let releaseCreate!: () => void;
    storage.createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
    const saver = service(storage);

    const first = saver.save(article(), source);
    const simultaneous = saver.save(article(), source);
    releaseCreate();
    const [created, shared] = await Promise.all([first, simultaneous]);
    expect(created).toEqual(shared);
    expect(created.created).toBe(true);
    expect(storage.creates).toBe(1);

    storage.files.set(created.note.path, `${storage.files.get(created.note.path)}\nHuman edit`);
    const repeated = await saver.save(article({ contentHtml: '<p>Changed upstream</p>' }), source);
    expect(repeated).toEqual({ created: false, note: created.note });
    expect(storage.creates).toBe(1);
    expect(storage.files.get(created.note.path)).toContain('Human edit');
  });

  it('applies template changes only to new notes and rejects invalid templates before writing', async () => {
    const storage = new MemorySavedNoteStorage();
    let templates = { ...DEFAULT_NOTE_TEMPLATES };
    const saver = new ArticleSaveService(storage, { folder: 'Articles', sanitize: html => html, templates: () => templates });
    const first = await saver.save(article(), source);
    storage.files.set(first.note.path, 'Human notes');
    templates = { ...templates, noteFilenameTemplate: 'Saved {{title}}', noteBodyTemplate: '## My notes\n\n{{content}}', notePropertiesTemplate: 'tags: [rss]\nstatus: inbox' };
    expect((await saver.save(article(), source)).note.path).toBe(first.note.path);
    expect(storage.files.get(first.note.path)).toBe('Human notes');
    const second = await saver.save(article({ id: 'two' }), source);
    expect(second.note.path).toBe('Articles/Saved An article.md');
    expect(storage.files.get(second.note.path)).toContain('## My notes');
    expect(frontmatter(storage.files.get(second.note.path)!).tags).toEqual(['rss']);
    templates = { ...templates, noteBodyTemplate: '{{unknown}}' };
    await expect(saver.save(article({ id: 'three' }), source)).rejects.toThrow(/Unknown/);
    expect(storage.creates).toBe(2);
    expect((await saver.save(article(), source)).created).toBe(false);
  });

  it('uses a stable short ID when different articles have the same title and date', async () => {
    const storage = new MemorySavedNoteStorage();
    const saver = service(storage);
    const first = await saver.save(article({ id: 'first', title: 'Same/title' }), source);
    const second = await saver.save(article({ id: 'second', title: 'Same/title' }), source);

    expect(first.note.path).toBe('Feed Reader/Articles/2026-09-20 Same title.md');
    expect(second.note.path).toMatch(/^Feed Reader\/Articles\/2026-09-20 Same title-[a-f0-9]{8}\.md$/);
    expect(second.note.path).not.toBe(first.note.path);
  });

  it('serializes special frontmatter values as valid YAML', async () => {
    const storage = new MemorySavedNoteStorage();
    const saver = service(storage);
    const unusualSource = { ...source, title: 'Source: #1\n"quoted"' };
    const unusual = article({
      title: 'Title: [x] # value\nnext',
      feedId: unusualSource.id,
      url: 'https://example.com/post?a=1&b=two#part',
    });
    const result = await saver.save(unusual, unusualSource);
    const parsed = frontmatter(storage.files.get(result.note.path)!);

    expect(parsed).toMatchObject({
      title: unusual.title,
      feed_reader_id: articleKey(unusualSource.id, unusual.id),
      feed_reader_source_id: unusualSource.id,
      feed_reader_source: unusualSource.title,
      feed_reader_url: unusual.url,
      feed_reader_published_at: unusual.publishedAt,
      date_created: '2026-09-22T02:03:04.000Z',
      date_updated: '2026-09-22T02:03:04.000Z',
    });
    expect(parsed).not.toHaveProperty('feed_reader_saved_at');
    expect(parsed).not.toHaveProperty('feed_reader_first_fetched_at');
  });

  it('sanitizes against the article URL before conversion and explains empty content', async () => {
    const storage = new MemorySavedNoteStorage();
    const sanitize = vi.fn(() => '');
    const saver = service(storage, sanitize);
    const item = article({ contentHtml: '<script>bad()</script>' });
    const result = await saver.save(item, source);
    const markdown = storage.files.get(result.note.path)!;

    expect(sanitize).toHaveBeenCalledWith(item.contentHtml, source.url);
    expect(markdown).toContain('did not include article content or a summary');
    expect(markdown).not.toContain('bad()');
  });

  it('tracks renamed notes, forgets deleted notes, and permits saving them again', async () => {
    const storage = new MemorySavedNoteStorage();
    const saver = service(storage);
    const original = await saver.save(article(), source);
    const renamedPath = 'Archive/An article.md';
    storage.emit({ type: 'rename', oldPath: original.note.path, newPath: renamedPath });

    expect(saver.findSaved(source.id, 'article-one')?.path).toBe(renamedPath);
    expect((await saver.save(article(), source)).created).toBe(false);

    storage.emit({ type: 'delete', path: renamedPath });
    expect(saver.findSaved(source.id, 'article-one')).toBeUndefined();
    const restored = await saver.save(article(), source);
    expect(restored.created).toBe(true);
    expect(storage.creates).toBe(2);
  });

  it('records a save only after a successful write and allows retry', async () => {
    const storage = new MemorySavedNoteStorage();
    storage.failNextCreate = true;
    const saver = service(storage);
    await expect(saver.save(article(), source)).rejects.toThrow('disk full');
    expect(saver.listSaved()).toEqual([]);

    const retried = await saver.save(article(), source);
    expect(retried.created).toBe(true);
    expect(storage.creates).toBe(2);
  });

  it('rebuilds the saved view from metadata and only rescans after an indexed path is stale', async () => {
    const storage = new MemorySavedNoteStorage();
    const key = articleKey(source.id, 'article-one');
    const indexed: SavedArticle = {
      articleKey: key,
      articleId: 'article-one',
      feedId: source.id,
      title: 'An article',
      sourceTitle: source.title,
      path: 'Archive/old.md',
      savedAt: '2026-09-22T02:03:04.000Z',
      firstFetchedAt: '2026-09-21T00:00:00.000Z',
    };
    storage.files.set(indexed.path, 'note');
    storage.metadata.set(indexed.path, indexed);
    const saver = service(storage);

    expect(saver.listSaved()).toEqual([indexed]);
    await expect(saver.listSavedArticles()).resolves.toEqual([{
      id: indexed.articleId,
      feedId: indexed.feedId,
      title: indexed.title,
      firstFetchedAt: indexed.firstFetchedAt,
    }]);
    expect(storage.lists).toBe(1);
    expect(saver.findSaved(source.id, 'article-one')).toEqual(indexed);
    expect(storage.lists).toBe(1);

    storage.files.delete(indexed.path);
    storage.metadata.delete(indexed.path);
    const moved = { ...indexed, path: 'Archive/moved.md' };
    storage.files.set(moved.path, 'note');
    storage.metadata.set(moved.path, moved);
    expect(saver.findSaved(source.id, 'article-one')).toEqual(moved);
    expect(storage.lists).toBe(2);
  });

  it('rejects paths that could escape the vault and mismatched feed identities', async () => {
    const storage = new MemorySavedNoteStorage();
    expect(() => new ArticleSaveService(storage, {
      folder: '../outside',
      sanitize: html => html,
    })).toThrow(/vault-relative/);
    await expect(service(storage).save(article({ feedId: 'other' }), source)).rejects.toThrow(/does not match/);
  });

  it('escapes untrusted titles in the Markdown heading while preserving the YAML value', async () => {
    const storage = new MemorySavedNoteStorage();
    const saver = service(storage);
    const hostileTitle = '<img src=x onerror=bad()>\n![[secret]] # heading';
    const result = await saver.save(article({ title: hostileTitle }), source);
    const markdown = storage.files.get(result.note.path)!;

    expect(frontmatter(markdown).title).toBe(hostileTitle);
    expect(markdown).toContain('# &lt;img src=x onerror=bad\\(\\)&gt; \\!\\[\\[secret\\]\\] \\# heading');
    expect(markdown).not.toContain('\n![[secret]]');
  });

  it('notifies subscribers and tracks isSaved state on create, upsert, delete, and rename', async () => {
    const storage = new MemorySavedNoteStorage();
    const saver = service(storage);
    saver.start();
    const listener = vi.fn();
    const unsubscribe = saver.subscribe(listener);

    expect(saver.isSaved(source.id, 'article-one')).toBe(false);

    // 1. Create note
    const result = await saver.save(article({ id: 'article-one' }), source);
    expect(saver.isSaved(source.id, 'article-one')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    // 2. Rename note
    storage.emit({ type: 'rename', oldPath: result.note.path, newPath: 'Articles/renamed.md' });
    expect(saver.isSaved(source.id, 'article-one')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);

    // 3. Delete note
    storage.emit({ type: 'delete', path: 'Articles/renamed.md' });
    expect(saver.isSaved(source.id, 'article-one')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    storage.emit({ type: 'upsert', note: result.note });
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
