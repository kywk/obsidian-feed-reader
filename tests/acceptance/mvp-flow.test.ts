import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import { beforeAll, expect, it } from 'vitest';
import { IndexedDbArticleCache } from '../../src/cache';
import type { FeedSource } from '../../src/domain/models';
import { FeedRefreshService, type FeedTransport } from '../../src/feeds';
import { ReadStateService, isArticleRead } from '../../src/read-state';
import { ArticleSaveService, type SavedArticle, type SavedNoteChange, type SavedNoteStorage } from '../../src/save';
import { SubscriptionService, type SubscriptionStorage } from '../../src/subscriptions';
import { sanitizeArticleHtml } from '../../src/ui/content';

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Object.assign(dom.window, { indexedDB: globalThis.indexedDB });
});

class VaultFiles implements SubscriptionStorage {
  readonly files = new Map<string, string>();
  private readonly watchers = new Map<string, Set<() => void>>();

  async read(path: string): Promise<string | null> { return this.files.get(path) ?? null; }
  async write(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
    for (const watcher of this.watchers.get(path) ?? []) watcher();
  }
  watch(path: string, watcher: () => void): () => void {
    const watchers = this.watchers.get(path) ?? new Set();
    watchers.add(watcher); this.watchers.set(path, watchers);
    return () => watchers.delete(watcher);
  }
}

class Notes implements SavedNoteStorage {
  readonly files = new Map<string, string>();
  readonly metadata = new Map<string, SavedArticle>();
  private readonly listeners = new Set<(change: SavedNoteChange) => void>();

  exists(path: string): boolean { return this.files.has(path); }
  async create(path: string, contents: string): Promise<void> {
    if (this.files.has(path)) throw new Error('already exists');
    this.files.set(path, contents);
  }
  list(): SavedArticle[] { return [...this.metadata.values()].map(note => ({ ...note })); }
  watch(listener: (change: SavedNoteChange) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  record(note: SavedArticle): void {
    this.metadata.set(note.path, { ...note });
    this.emit({ type: 'upsert', note });
  }
  rename(oldPath: string, newPath: string): void {
    const contents = this.files.get(oldPath);
    const note = this.metadata.get(oldPath);
    if (contents === undefined || !note) throw new Error('missing note');
    this.files.delete(oldPath); this.files.set(newPath, contents);
    this.metadata.delete(oldPath); this.metadata.set(newPath, { ...note, path: newPath });
    this.emit({ type: 'rename', oldPath, newPath });
  }
  private emit(change: SavedNoteChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>RSS</title>
  <item><guid>rss-one</guid><title>RSS story</title><link>/rss-one</link>
  <description><![CDATA[<p>RSS body</p>]]></description></item></channel></rss>`;
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
  <entry><id>atom-one</id><title>Atom story</title><updated>2026-09-22T04:00:00Z</updated>
  <link href="/atom-one"/><content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content></entry></feed>`;

it('takes RSS and Atom through subscribe, refresh, read, save, restart, and note reopen', async () => {
  const vault = new VaultFiles();
  const subscriptions = new SubscriptionService(vault, 'Feed Reader/feeds.yaml', () => 'news');
  await subscriptions.start();
  const folder = await subscriptions.createFolder('News');
  const rssSource = await subscriptions.addFeed({ url: 'https://example.test/rss', title: 'RSS', folderIds: [folder.id] });
  const atomSource = await subscriptions.addFeed({ url: 'https://example.test/atom', title: 'Atom', folderIds: [folder.id] });
  const sources = [rssSource, atomSource];

  const cache = new IndexedDbArticleCache('acceptance-vault', { databaseName: `acceptance-${crypto.randomUUID()}` });
  let offline = false;
  const transport: FeedTransport = {
    fetch: async (url) => {
      if (offline) throw new Error('offline');
      return { status: 200, body: url.endsWith('/rss') ? rss : atom, finalUrl: url };
    },
  };
  const refresh = new FeedRefreshService(transport, cache, { now: () => new Date('2026-09-22T05:00:00Z') });
  expect(await refresh.refreshSources(sources)).toEqual([
    { feedId: rssSource.id, ok: true, articleCount: 1 },
    { feedId: atomSource.id, ok: true, articleCount: 1 },
  ]);

  const summaries = (await cache.queryMetadata({ feedIds: sources.map(source => source.id), limit: 50 })).items;
  expect(summaries.map(item => item.title).sort()).toEqual(['Atom story', 'RSS story']);
  const selected = summaries.find(item => item.feedId === atomSource.id)!;
  const article = await cache.getArticle(selected.feedId, selected.id);
  expect(article?.contentHtml).toContain('Atom body');

  const readState = new ReadStateService(vault);
  expect((await readState.markRead(selected.feedId, selected.id)).ok).toBe(true);
  expect(isArticleRead((await readState.load(selected.feedId)).state, selected)).toBe(true);
  expect((await readState.markUnread(selected.feedId, selected.id)).ok).toBe(true);
  const restartedReadState = new ReadStateService(vault);
  expect(isArticleRead((await restartedReadState.load(selected.feedId)).state, selected)).toBe(false);

  const notes = new Notes();
  const saver = new ArticleSaveService(notes, {
    folder: 'Feed Reader/Articles', sanitize: sanitizeArticleHtml,
    now: () => new Date('2026-09-22T05:10:00Z'),
  });
  const saved = await saver.save(article!, atomSource);
  notes.record(saved.note);
  notes.files.set(saved.note.path, `${notes.files.get(saved.note.path)}\nHuman edit`);
  expect((await saver.save(article!, atomSource)).created).toBe(false);
  expect(notes.files.get(saved.note.path)).toContain('Human edit');
  notes.rename(saved.note.path, 'Archive/Atom story.md');
  expect(saver.findSaved(atomSource.id, selected.id)?.path).toBe('Archive/Atom story.md');

  offline = true;
  expect(await refresh.refreshSource(rssSource)).toMatchObject({ ok: false, error: { code: 'network' } });
  expect((await cache.queryMetadata({ feedId: rssSource.id })).items).toHaveLength(1);

  saver.dispose(); refresh.dispose(); cache.dispose(); subscriptions.stop();
});
