import { JSDOM } from 'jsdom';
import { IDBDatabase, IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Article, ArticleSummary, FeedSource } from '../../src/domain/models';

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl: HTMLElement;
    constructor(leaf: { contentEl: HTMLElement }) { this.contentEl = leaf.contentEl; }
  },
  Notice: class {},
  setIcon: () => {},
  WorkspaceLeaf: class {},
}));

import { IndexedDbArticleCache } from '../../src/cache';
import { ReaderView, createReaderUiState } from '../../src/ui/views';

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://vault.test/' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event, KeyboardEvent: dom.window.KeyboardEvent,
  });
  const prototype = dom.window.HTMLElement.prototype as HTMLElement & {
    empty?: () => void; addClass?: (name: string) => void;
    createEl?: (tag: string, options?: Record<string, unknown>) => HTMLElement;
    createDiv?: (options?: Record<string, unknown>) => HTMLElement;
    createSpan?: (options?: Record<string, unknown>) => HTMLElement;
  };
  prototype.empty = function empty() { this.replaceChildren(); };
  prototype.addClass = function addClass(name: string) { this.classList.add(name); };
  (prototype as unknown as { createEl: (tag: string, options?: Record<string, unknown>) => HTMLElement }).createEl = function createEl(this: HTMLElement, tag: string, options: Record<string, unknown> = {}) {
    const element = document.createElement(tag);
    const values = options as { text?: string; cls?: string; type?: string; placeholder?: string; href?: string; attr?: Record<string, string> };
    if (values.text !== undefined) element.textContent = values.text;
    if (values.cls) element.className = values.cls;
    if (values.type) element.setAttribute('type', values.type);
    if (values.placeholder) element.setAttribute('placeholder', values.placeholder);
    if (values.href) element.setAttribute('href', values.href);
    for (const [name, value] of Object.entries(values.attr ?? {})) element.setAttribute(name, value);
    this.append(element); return element;
  };
  (prototype as unknown as { createDiv: (options?: Record<string, unknown>) => HTMLElement }).createDiv = function createDiv(this: HTMLElement, options = {}) {
    return (this as unknown as { createEl: (tag: string, options?: Record<string, unknown>) => HTMLElement }).createEl('div', options);
  };
  (prototype as unknown as { createSpan: (options?: Record<string, unknown>) => HTMLElement }).createSpan = function createSpan(this: HTMLElement, options = {}) {
    return (this as unknown as { createEl: (tag: string, options?: Record<string, unknown>) => HTMLElement }).createEl('span', options);
  };
});

function feeds(): FeedSource[] {
  return Array.from({ length: 200 }, (_, index) => ({
    id: `feed-${index}`, title: `Feed ${index}`, url: `https://example.test/${index}`, folderIds: [],
  }));
}

function metadata(sources: readonly FeedSource[]): ArticleSummary[] {
  return sources.flatMap((source, feedIndex) => Array.from({ length: 500 }, (_, articleIndex) => ({
    id: `article-${articleIndex}`, feedId: source.id, title: `Article ${feedIndex}-${articleIndex}`,
    publishedAt: new Date(Date.UTC(2026, 0, 1, feedIndex, articleIndex)).toISOString(),
    firstFetchedAt: '2026-01-01T00:00:00.000Z',
  }))).sort((left, right) => (right.publishedAt ?? '').localeCompare(left.publishedAt ?? ''));
}

describe('100k metadata acceptance', () => {
  it('renders only the first 50 rows and reads no full text until one article opens', async () => {
    const sources = feeds();
    const rows = metadata(sources);
    let metadataQueries = 0; let fullReads = 0;
    const cache = {
      queryMetadata: vi.fn(async ({ cursor, limit = 50 }: { cursor?: string; limit?: number }) => {
        metadataQueries += 1;
        const offset = cursor ? Number(cursor) : 0;
        return { items: rows.slice(offset, offset + limit), ...(offset + limit < rows.length ? { nextCursor: String(offset + limit) } : {}) };
      }),
      getArticle: vi.fn(async (feedId: string, articleId: string): Promise<Article | undefined> => {
        fullReads += 1;
        const summary = rows.find(item => item.feedId === feedId && item.id === articleId);
        return summary ? { ...summary, contentHtml: '<p>On-demand body</p>' } : undefined;
      }),
    };
    const root = document.createElement('div'); document.body.append(root);
    const started = performance.now();
    const view = new ReaderView({ contentEl: root } as never, {
      state: createReaderUiState(), cache,
      subscriptions: {
        getSnapshot: () => ({ document: { version: 1 as const, feeds: sources, folders: [] }, writable: true }),
        subscribe: () => () => {},
      },
      readState: {
        load: async (feedId: string) => ({ ok: true as const, state: { version: 1 as const, feedId, readIds: [], unreadIds: [] } }),
        markRead: async (feedId: string, id: string) => ({ ok: true as const, state: { version: 1 as const, feedId, readIds: [id], unreadIds: [] } }),
        markUnread: async (feedId: string, id: string) => ({ ok: true as const, state: { version: 1 as const, feedId, readIds: [], unreadIds: [id] } }),
        markAllRead: async (feedId: string) => ({ ok: true as const, state: { version: 1 as const, feedId, readIds: [], unreadIds: [] } }),
        subscribe: () => () => {},
      },
    });
    await view.onOpen();
    const firstPageMs = performance.now() - started;
    expect(rows).toHaveLength(100_000);
    expect(root.querySelectorAll('.vfr-article-row')).toHaveLength(50);
    expect(metadataQueries).toBe(1);
    expect(cache.queryMetadata).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    expect(fullReads).toBe(0);
    root.querySelector<HTMLButtonElement>('.vfr-article-row')!.click();
    await vi.waitFor(() => expect(fullReads).toBe(1));
    expect(root.querySelectorAll('.vfr-article-row')).toHaveLength(50);
    console.info(JSON.stringify({ check: 'mock-100k-reader', firstPageMs, domRows: 50, fullReadsBeforeOpen: 0, fullReadsAfterOpen: fullReads }));
    await view.onClose(); root.remove();
  });

  const scale = process.env.VFR_RUN_SCALE === '1' ? it : it.skip;
  scale('queries a real IndexedDB first page without opening the content store', async () => {
    Object.assign(globalThis, { IDBKeyRange });
    const cache = new IndexedDbArticleCache('scale-vault', { indexedDB, databaseName: `scale-${crypto.randomUUID()}` });
    const startedSeed = performance.now();
    for (let feedIndex = 0; feedIndex < 200; feedIndex += 1) {
      const feedId = `feed-${feedIndex}`;
      await cache.upsert(feedId, Array.from({ length: 500 }, (_, articleIndex) => ({
        id: `article-${articleIndex}`, feedId, title: `Article ${articleIndex}`,
        publishedAt: new Date(Date.UTC(2026, 0, 1, feedIndex, articleIndex)).toISOString(),
        firstFetchedAt: '2026-01-01T00:00:00.000Z', contentHtml: '<p>Body</p>',
      })));
    }
    const seedMs = performance.now() - startedSeed;
    let contentStoreTransactions = 0;
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function transaction(this: IDBDatabase, storeNames, ...rest) {
      const names = typeof storeNames === 'string' ? [storeNames] : Array.from(storeNames);
      if (names.includes('article-content')) contentStoreTransactions += 1;
      return Reflect.apply(original, this, [storeNames, ...rest]) as IDBTransaction;
    } as typeof original;
    try {
      const startedQuery = performance.now();
      const page = await cache.queryMetadata({ limit: 50 });
      const firstPageMs = performance.now() - startedQuery;
      expect(page.items).toHaveLength(50);
      expect(page.nextCursor).toBeDefined();
      expect(contentStoreTransactions).toBe(0);
      console.info(JSON.stringify({ check: 'fake-indexeddb-100k', records: 100_000, seedMs, firstPageMs, pageRows: page.items.length, contentStoreTransactions }));
    } finally {
      IDBDatabase.prototype.transaction = original;
      cache.dispose();
    }
  });
});
