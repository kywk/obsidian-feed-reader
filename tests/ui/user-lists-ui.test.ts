import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Article, ArticleSummary, FeedReadState } from '../../src/domain/models';

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl: HTMLElement;
    constructor(leaf: { contentEl: HTMLElement }) { this.contentEl = leaf.contentEl; }
  },
  WorkspaceLeaf: class {},
  Modal: class {},
  requestUrl: vi.fn(),
  Notice: class {},
  setIcon: () => {},
  Setting: class {
    el: HTMLElement;
    constructor(parent: HTMLElement) { this.el = document.createElement('div'); parent.append(this.el); }
    setName(value: string) { const el = document.createElement('span'); el.textContent = value; this.el.append(el); return this; }
    setDesc(value: string) { return this.setName(value); }
  },
}));

import { ReaderView, SourcesView, createReaderUiState } from '../../src/ui/views';
import { UserListsService } from '../../src/user-lists/service';
import type { UserListStorage } from '../../src/user-lists/storage';

class MemoryUserListStorage implements UserListStorage {
  files = new Map<string, string>();
  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }
  async write(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
  }
}

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://vault.test/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, KeyboardEvent: dom.window.KeyboardEvent });
  const prototype = dom.window.HTMLElement.prototype as HTMLElement & { empty?: () => void; createEl?: (tag: string, options?: Record<string, unknown>) => HTMLElement; createDiv?: (options?: Record<string, unknown>) => HTMLElement; addClass?: (name: string) => void };
  prototype.empty = function empty() { this.replaceChildren(); };
  prototype.addClass = function addClass(name: string) { this.classList.add(name); };
  (prototype as unknown as { createEl: (tag: string, options?: Record<string, unknown>) => HTMLElement }).createEl = function createEl(this: HTMLElement, tag: string, options: Record<string, unknown> = {}) {
    const element = document.createElement(tag);
    const optionsRecord = options as { text?: string; cls?: string; type?: string; placeholder?: string; href?: string; attr?: Record<string, string> };
    if (optionsRecord.text !== undefined) element.textContent = optionsRecord.text;
    if (optionsRecord.cls) element.className = optionsRecord.cls;
    if (optionsRecord.type) element.setAttribute('type', optionsRecord.type);
    if (optionsRecord.placeholder) element.setAttribute('placeholder', optionsRecord.placeholder);
    if (optionsRecord.href) element.setAttribute('href', optionsRecord.href);
    for (const [name, value] of Object.entries(optionsRecord.attr ?? {})) element.setAttribute(name, value);
    this.append(element);
    return element;
  };
  (prototype as unknown as { createDiv: (options?: Record<string, unknown>) => HTMLElement }).createDiv = function createDiv(this: HTMLElement, options: Record<string, unknown> = {}) {
    return (this as unknown as { createEl: (tag: string, options?: Record<string, unknown>) => HTMLElement }).createEl('div', options);
  };
  (prototype as unknown as { createSpan: (options?: Record<string, unknown>) => HTMLElement }).createSpan = function createSpan(this: HTMLElement, options: Record<string, unknown> = {}) {
    return (this as unknown as { createEl: (tag: string, options?: Record<string, unknown>) => HTMLElement }).createEl('span', options);
  };
});

const sampleArticle: Article = {
  id: 'article-1',
  feedId: 'feed-1',
  title: 'Test Article',
  url: 'https://example.com/item',
  firstFetchedAt: '2026-09-25T01:00:00.000Z',
  contentHtml: '<p>Content for test</p>',
};

describe('User Lists UI Integration', () => {
  it('renders Today, Saved, Favorite, Read Later in SourcesView navigation', async () => {
    const state = createReaderUiState();
    const storage = new MemoryUserListStorage();
    const userLists = new UserListsService(storage, 'state');
    await userLists.load();
    await userLists.addFavorite(sampleArticle);

    const subscriptions = {
      getSnapshot: () => ({ writable: true, document: { version: 1 as const, folders: [], feeds: [] } }),
      subscribe: () => () => {},
    };

    const container = document.createElement('div');
    const sourcesView = new SourcesView({ contentEl: container } as never, {
      state,
      subscriptions,
      userLists,
    });

    await sourcesView.onOpen();

    const navButtons = container.querySelectorAll<HTMLButtonElement>('.vfr-navigation button');
    expect(navButtons.length).toBe(4);

    const scopes = [...navButtons].map(btn => JSON.parse(btn.dataset.scope!));
    expect(scopes).toEqual([
      { kind: 'global', filter: 'today' },
      { kind: 'global', filter: 'saved' },
      { kind: 'global', filter: 'favorite' },
      { kind: 'global', filter: 'readLater' },
    ]);

    // Favorite should have badge "1"
    const favButton = navButtons[2]!;
    expect(favButton.textContent).toContain('1');

    // Click favorite button updates state scope
    favButton.click();
    await Promise.resolve();
    expect(state.getScope()).toEqual({ kind: 'global', filter: 'favorite' });
  });

  it('renders Favorite and Read Later buttons in ReaderView and toggles them', async () => {
    const state = createReaderUiState();
    const storage = new MemoryUserListStorage();
    const userLists = new UserListsService(storage, 'state');
    await userLists.load();

    const subscriptions = {
      getSnapshot: () => ({
        writable: true,
        document: {
          version: 1 as const,
          folders: [],
          feeds: [{ id: 'feed-1', title: 'Feed 1', url: 'https://example.com/feed', folderIds: [] }],
        },
      }),
      subscribe: () => () => {},
    };

    const cache = {
      queryMetadata: async () => ({ items: [sampleArticle] }),
      getArticle: async () => sampleArticle,
    };

    const readState = {
      load: async () => ({ ok: true as const, state: { version: 1 as const, feedId: 'feed-1', readIds: [], unreadIds: [] } }),
      markRead: async () => ({ ok: true as const, state: { version: 1 as const, feedId: 'feed-1', readIds: ['article-1'], unreadIds: [] } }),
      markUnread: async () => ({ ok: true as const, state: { version: 1 as const, feedId: 'feed-1', readIds: [], unreadIds: ['article-1'] } }),
      markAllRead: async () => ({ ok: true as const, state: { version: 1 as const, feedId: 'feed-1', readIds: [], unreadIds: [] } }),
      subscribe: () => () => {},
    };

    const container = document.createElement('div');
    const readerView = new ReaderView({ contentEl: container } as never, {
      state,
      subscriptions,
      cache,
      readState,
      userLists,
    });

    await readerView.onOpen();

    // Click article row to open
    const row = container.querySelector<HTMLButtonElement>('.vfr-article-row')!;
    expect(row).not.toBeNull();
    row.click();

    // Wait for article render
    await new Promise(r => setTimeout(r, 20));

    // Verify layout: h1 is first, meta is below h1
    const heading = container.querySelector('.vfr-reading-column > h1')!;
    expect(heading).not.toBeNull();
    expect(heading.textContent).toBe('Test Article');
    const meta = container.querySelector('.vfr-reading-column > .vfr-article-meta')!;
    expect(meta).not.toBeNull();
    expect(meta.textContent).toContain('Feed 1');

    // Find action buttons by aria-label / title
    const favBtn = container.querySelector<HTMLButtonElement>('[aria-label="Add to favorites"]')!;
    const laterBtn = container.querySelector<HTMLButtonElement>('[aria-label="Add to read later"]')!;
    expect(favBtn).not.toBeNull();
    expect(laterBtn).not.toBeNull();

    // Toggle Favorite
    favBtn.click();
    await new Promise(r => setTimeout(r, 20));

    expect(userLists.isFavorite('feed-1', 'article-1')).toBe(true);

    // Toggle Read Later
    laterBtn.click();
    await new Promise(r => setTimeout(r, 20));

    expect(userLists.isReadLater('feed-1', 'article-1')).toBe(true);
  });

  it('falls back to stored article content when cache misses in offline/cross-device scenario', async () => {
    const state = createReaderUiState({ kind: 'global', filter: 'favorite' });
    const storage = new MemoryUserListStorage();
    const userLists = new UserListsService(storage, 'state');
    await userLists.load();
    await userLists.addFavorite(sampleArticle, '<p>Stored offline content</p>');

    const subscriptions = {
      getSnapshot: () => ({ writable: true, document: { version: 1 as const, folders: [], feeds: [] } }),
      subscribe: () => () => {},
    };

    // Cache has NO article (simulating new computer with empty IndexedDB)
    const cache = {
      queryMetadata: async () => ({ items: [] }),
      getArticle: async () => undefined,
    };

    const container = document.createElement('div');
    const readerView = new ReaderView({ contentEl: container } as never, {
      state,
      subscriptions,
      cache,
      userLists,
    });

    await readerView.onOpen();

    // The favorite article should appear in list
    const row = container.querySelector<HTMLButtonElement>('.vfr-article-row')!;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('Test Article');

    // Click to open
    row.click();
    await new Promise(r => setTimeout(r, 20));

    // Article body should render the stored offline content
    const body = container.querySelector('.vfr-article-body')!;
    expect(body.textContent).toContain('Stored offline content');
  });
});
