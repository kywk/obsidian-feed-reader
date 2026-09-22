import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Article, ArticleSummary, FeedReadState } from '../../src/domain/models';

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl: HTMLElement;
    constructor(leaf: { contentEl: HTMLElement }) { this.contentEl = leaf.contentEl; }
  },
  WorkspaceLeaf: class {},
  Notice: class {},
  setIcon: () => {},
  Setting: class {
    el: HTMLElement;
    constructor(parent: HTMLElement) { this.el = document.createElement('div'); parent.append(this.el); }
    setName(value: string) { const el = document.createElement('span'); el.textContent = value; this.el.append(el); return this; }
    setDesc(value: string) { return this.setName(value); }
    addDropdown(configure: (dropdown: unknown) => void) {
      const el = document.createElement('select'); this.el.append(el);
      const component = {
        addOptions(options: Record<string, string>) { for (const [value, label] of Object.entries(options)) { const option = document.createElement('option'); option.value = value; option.textContent = label; el.append(option); } return component; },
        onChange(action: (value: string) => void) { el.addEventListener('change', () => action(el.value)); return component; },
      };
      configure(component); return this;
    }
    addButton(configure: (button: unknown) => void) {
      const el = document.createElement('button'); this.el.append(el);
      const component = {
        setCta() { return component; },
        setWarning() { return component; },
        setButtonText(value: string) { el.textContent = value; return component; },
        setDisabled(value: boolean) { el.disabled = value; return component; },
        onClick(action: () => void) { el.addEventListener('click', action); return component; },
      };
      configure(component); return this;
    }
  },
}));

import { ReaderView, SourcesView, createReaderUiState } from '../../src/ui/views';
import { ManageSubscriptionsView } from '../../src/ui/manage/subscriptions';
import { sanitizeArticleHtml } from '../../src/ui/content';

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
    this.append(element); return element;
  };
  (prototype as unknown as { createDiv: (options?: Record<string, unknown>) => HTMLElement }).createDiv = function createDiv(this: HTMLElement, options = {}) { return (this as unknown as { createEl: (tag: string, options?: Record<string, unknown>) => HTMLElement }).createEl('div', options); };
  (prototype as unknown as { createSpan: (options?: Record<string, unknown>) => HTMLElement }).createSpan = function createSpan(this: HTMLElement, options = {}) { return (this as unknown as { createEl: (tag: string, options?: Record<string, unknown>) => HTMLElement }).createEl('span', options); };
});

const feed = { id: 'feed-1', title: 'A feed', url: 'https://example.test/feed/', folderIds: ['folder-1'] };
const summary = (number: number): ArticleSummary => ({ id: `article-${number}`, feedId: feed.id, title: number === 1 ? 'Needle article' : `Article ${number}`, publishedAt: '2026-09-22T03:00:00.000Z', firstFetchedAt: '2026-09-22T03:00:00.000Z' });
const article = (item: ArticleSummary): Article => ({ ...item, contentHtml: '<p>Body</p>' });

function setup(markReadOnNavigate = false) {
  const rows = Array.from({ length: 60 }, (_, index) => summary(index + 1));
  let state: FeedReadState = { version: 1, feedId: feed.id, readIds: [], unreadIds: [] };
  const listeners = new Set<(feedId: string, result: { ok: true; state: FeedReadState }) => void>();
  const emit = () => { for (const listener of listeners) listener(feed.id, { ok: true, state }); };
  const markRead = vi.fn(async (_feedId: string, id: string) => { state = { ...state, readIds: [...new Set([...state.readIds, id])] }; emit(); return { ok: true as const, state }; });
  const markUnread = vi.fn(async (_feedId: string, id: string) => { state = { ...state, readIds: state.readIds.filter(item => item !== id) }; emit(); return { ok: true as const, state }; });
  const markAllRead = vi.fn(async (_feedId: string, items: ArticleSummary[]) => { state = { ...state, readIds: [...new Set([...state.readIds, ...items.map(item => item.id)])] }; emit(); return { ok: true as const, state }; });
  const cache = {
    queryMetadata: vi.fn(async ({ cursor, limit = 50 }: { cursor?: string; limit?: number }) => {
      const offset = cursor ? Number(cursor) : 0;
      return { items: rows.slice(offset, offset + limit), ...(offset + limit < rows.length ? { nextCursor: String(offset + limit) } : {}) };
    }),
    getArticle: vi.fn(async (_feedId: string, id: string) => article(rows.find(item => item.id === id)!)),
  };
  const root = document.createElement('div'); document.body.append(root);
  const onMarkScopeRead = vi.fn(); const uiState = createReaderUiState();
  const view = new ReaderView({ contentEl: root } as never, {
    state: uiState, cache,
    subscriptions: { getSnapshot: () => ({ document: { version: 1 as const, feeds: [feed], folders: [{ id: 'folder-1', title: 'Folder' }] }, writable: true }), subscribe: () => () => {} },
    readState: { load: async () => ({ ok: true as const, state }), markRead, markUnread, markAllRead, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } },
    onMarkScopeRead,
    markReadOnNavigate,
  });
  return { view, root, markRead, markAllRead, onMarkScopeRead, state: uiState };
}

describe('reader view', () => {
  it('filters rows, handles keyboard commands, retains a just-read unread row, and batches the visible page', async () => {
    const { view, root, markRead, onMarkScopeRead } = setup();
    await view.onOpen();
    expect(root.querySelectorAll('.vfr-article-row')).toHaveLength(50);
    const search = root.querySelector<HTMLInputElement>('.vfr-search')!;
    search.value = 'needle'; search.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(root.querySelectorAll('.vfr-article-row')).toHaveLength(1));
    const preservedSearch = root.querySelector<HTMLInputElement>('.vfr-search')!;
    preservedSearch.focus(); preservedSearch.value = 'needle a'; preservedSearch.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(document.activeElement).toBe(root.querySelector('.vfr-search')));
    root.querySelector<HTMLInputElement>('.vfr-search')!.value = 'article 60';
    root.querySelector<HTMLInputElement>('.vfr-search')!.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(root.textContent).toContain('Article 60'));
    root.querySelector<HTMLInputElement>('.vfr-search')!.value = 'needle';
    root.querySelector<HTMLInputElement>('.vfr-search')!.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(root.querySelectorAll('.vfr-article-row')).toHaveLength(1));
    const row = root.querySelector<HTMLElement>('.vfr-article-row')!;
    row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    await vi.waitFor(() => expect(root.querySelector('.is-selected')).not.toBeNull());
    const selected = root.querySelector<HTMLElement>('.is-selected')!;
    expect(document.activeElement).toBe(selected);
    selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    await vi.waitFor(() => expect(document.activeElement).toBe(root.querySelector('.is-selected')));
    root.querySelector<HTMLElement>('.is-selected')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(markRead).toHaveBeenCalledWith(feed.id, 'article-1'));
    expect(root.querySelectorAll('.vfr-article-row')).toHaveLength(1);
    root.querySelector<HTMLButtonElement>('.vfr-list-actions button')!.click();
    await vi.waitFor(() => expect(onMarkScopeRead).toHaveBeenCalledOnce());
  });

  it('does not intercept typing in its search input', async () => {
    const { view, root, markRead } = setup(); await view.onOpen();
    root.querySelector<HTMLInputElement>('.vfr-search')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    await Promise.resolve(); expect(markRead).not.toHaveBeenCalled();
  });

  it('marks navigation targets read and keeps row focus across consecutive j commands', async () => {
    const { view, root, markRead } = setup(true); await view.onOpen();
    const first = root.querySelector<HTMLElement>('.vfr-article-row')!; first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    await vi.waitFor(() => expect(markRead).toHaveBeenCalledWith(feed.id, 'article-1'));
    const selected = root.querySelector<HTMLElement>('.is-selected')!;
    expect(document.activeElement).toBe(selected);
    selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    await vi.waitFor(() => expect(markRead).toHaveBeenCalledWith(feed.id, 'article-2'));
    expect(document.activeElement).toBe(root.querySelector('.is-selected'));
  });

  it('keeps a just-read article visible when an unread view refreshes', async () => {
    const { view, root, state } = setup(); await view.onOpen();
    state.select({ kind: 'global', filter: 'unread' });
    await vi.waitFor(() => expect(root.querySelectorAll('.vfr-article-row')).toHaveLength(50));
    const row = root.querySelector<HTMLElement>('.vfr-article-row')!; row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    await vi.waitFor(() => expect(root.querySelector('.is-selected')).not.toBeNull());
    root.querySelector<HTMLElement>('.is-selected')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(root.querySelector('.vfr-article-title')?.textContent).toContain('Needle article'));
    await view.refresh();
    expect(root.textContent).toContain('Needle article');
  });

  it('opens a saved note through its callback when the article cache has expired', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const state = createReaderUiState(); state.select({ kind: 'global', filter: 'saved' });
    const openSaved = vi.fn(); const saved = summary(1);
    const view = new ReaderView({ contentEl: root } as never, {
      state, cache: { queryMetadata: async () => ({ items: [] }), getArticle: async () => undefined },
      subscriptions: { getSnapshot: () => ({ document: { version: 1 as const, feeds: [feed], folders: [] }, writable: true }), subscribe: () => () => {} },
      getSavedArticles: async () => [saved], onOpenSavedArticle: openSaved,
    });
    await view.onOpen();
    const row = root.querySelector<HTMLElement>('.vfr-article-row')!; row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    await vi.waitFor(() => expect(root.querySelector('.is-selected')).not.toBeNull());
    root.querySelector<HTMLElement>('.is-selected')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(openSaved).toHaveBeenCalledWith(saved));
    root.querySelector<HTMLElement>('.is-selected')!.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    await vi.waitFor(() => expect(openSaved).toHaveBeenCalledTimes(2));
  });

  it('sanitizes executable markup and resolves only safe relative URLs from the feed URL', () => {
    const clean = sanitizeArticleHtml('<style>body{display:none}</style><script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(2)">bad</a><img src="images/a.png"><iframe src="https://bad.test"></iframe>', feed.url);
    expect(clean).not.toMatch(/script|iframe|style|onclick|javascript:/i);
    expect(clean).toContain('https://example.test/feed/images/a.png');
  });
});


describe('Source navigation', () => {
  it('counts metadata once globally, preserves collapse and reflects folder selection', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const state = createReaderUiState();
    const getArticle = vi.fn();
    const view = new SourcesView({ contentEl: root } as never, {
      state,
      subscriptions: { getSnapshot: () => ({ document: { version: 1, feeds: [feed], folders: [{ id: 'folder-1', title: 'Folder' }] }, writable: true }), subscribe: () => () => {} },
      cache: { queryMetadata: async () => ({ items: [summary(1), summary(2)] }), getArticle },
      readState: { load: async () => ({ ok: true, state: { version: 1, feedId: feed.id, readIds: ['article-1'], unreadIds: [] } }), subscribe: () => () => {}, markRead: vi.fn(), markUnread: vi.fn(), markAllRead: vi.fn() },
    });
    await view.onOpen();
    await vi.waitFor(() => expect(root.querySelector('.vfr-unread-count')?.textContent).toBe('1'));
    expect(getArticle).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('.vfr-folder-toggle')!.click();
    expect(root.querySelector<HTMLElement>('.vfr-folder-children')!.hidden).toBe(true);
    state.select({ kind: 'folder', folderId: 'folder-1', filter: 'unread' });
    expect(root.querySelector('[aria-current="page"]')?.textContent).toContain('Folder');
    view.refresh();
    expect(root.querySelector<HTMLElement>('.vfr-folder-children')!.hidden).toBe(true);
    await view.onClose();
  });
  it('removes publisher theme overrides while retaining semantic content', () => {
    const clean = sanitizeArticleHtml('<p class="theme-dark" style="color:red" id="app"><font color="red" face="Arial" size="7">Hello</font><strong>World</strong></p>');
    expect(clean).not.toMatch(/class=|style=|id=|color=|face=|size=/);
    expect(clean).toContain('<strong>World</strong>');
  });
});


describe('List to article reading flow', () => {
  it('opens full-width content, navigates with j/k, returns with Escape, and resets on source selection', async () => {
    const { view, root, state, markRead } = setup(); await view.onOpen();
    const surface = root.querySelector<HTMLElement>('.vfr-reader')!;
    const list = root.querySelector<HTMLElement>('.vfr-list')!;
    const content = root.querySelector<HTMLElement>('.vfr-content')!;
    expect(list.hidden).toBe(false); expect(content.hidden).toBe(true);
    root.querySelector<HTMLButtonElement>('.vfr-article-row')!.click();
    await vi.waitFor(() => expect(content.querySelector('h1')?.textContent).toBe('Needle article'));
    expect(list.hidden).toBe(true); expect(content.hidden).toBe(false);
    expect(document.activeElement).toBe(surface);
    surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    await vi.waitFor(() => expect(content.querySelector('h1')?.textContent).toBe('Article 2'));
    expect(markRead).toHaveBeenCalledWith(feed.id, 'article-2');
    surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    await vi.waitFor(() => expect(content.querySelector('h1')?.textContent).toBe('Needle article'));
    surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(list.hidden).toBe(false); expect(content.hidden).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('.is-selected'));
    root.querySelector<HTMLButtonElement>('.vfr-article-row')!.click();
    await vi.waitFor(() => expect(content.hidden).toBe(false));
    state.select({ kind: 'feed', feedId: feed.id, filter: 'all' });
    await vi.waitFor(() => expect(list.querySelector('h1')?.textContent).toBe('A feed'));
    expect(list.hidden).toBe(false); expect(content.hidden).toBe(true);
    await view.onClose();
  });
  it('navigates across the 50-row page boundary in both directions', async () => {
    const { view, root } = setup(); await view.onOpen();
    const surface = root.querySelector<HTMLElement>('.vfr-reader')!;
    const title = () => root.querySelector('.vfr-content h1')?.textContent;
    root.querySelectorAll<HTMLButtonElement>('.vfr-article-row')[49]!.click();
    await vi.waitFor(() => expect(title()).toBe('Article 50'));
    surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    await vi.waitFor(() => expect(title()).toBe('Article 51'));
    expect(root.querySelectorAll('.vfr-article-row')).toHaveLength(10);
    surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    await vi.waitFor(() => expect(title()).toBe('Article 50'));
    expect(root.querySelectorAll('.vfr-article-row')).toHaveLength(50);
    await view.onClose();
  });
});


describe('Sidebar reopening the reader', () => {
  it('requests the reader with the selected source even after the previous reader has closed', async () => {
    const { view, state } = setup(); await view.onOpen(); await view.onClose();
    const root = document.createElement('div'); document.body.append(root);
    const onOpenReader = vi.fn(async () => { expect(state.getScope()).toEqual({ kind: 'feed', feedId: feed.id, filter: 'all' }); });
    const sources = new SourcesView({ contentEl: root } as never, {
      state, ...{ onOpenReader },
      subscriptions: { getSnapshot: () => ({ document: { version: 1, feeds: [feed], folders: [{ id: 'folder-1', title: 'Folder' }] }, writable: true }), subscribe: () => () => {} },
    });
    await sources.onOpen();
    root.querySelector<HTMLButtonElement>('[title="A feed"]')!.click();
    await vi.waitFor(() => expect(onOpenReader).toHaveBeenCalledOnce());
    await sources.onClose();
  });
});


describe('Large source manager', () => {
  it('paginates 200 sources and searches every page without replacing the input', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const feeds = Array.from({ length: 200 }, (_, i) => ({ id: `feed-${i}`, title: `Source ${i}`, url: `https://example.test/${i}`, folderIds: i === 199 ? ['rare'] : [] }));
    const service = { getSnapshot: () => ({ writable: true, document: { version: 1, feeds, folders: [{ id: 'rare', title: 'Rare folder' }] } }), subscribe: () => () => {} };
    const view = new ManageSubscriptionsView({ contentEl: root } as never, service as never, async () => {});
    await view.onOpen();
    expect(view.getViewType()).toBe('vault-feed-reader-manage');
    expect(root.querySelectorAll('.vfr-managed-source')).toHaveLength(50);
    expect(root.textContent).toContain('1–50 of 200 sources');
    Array.from(root.querySelectorAll('button')).find(button => button.textContent === 'Next page')!.click();
    expect(root.textContent).toContain('51–100 of 200 sources');
    const search = root.querySelector<HTMLInputElement>('.vfr-manager-search')!;
    search.focus(); search.value = 'Rare folder'; search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelectorAll('.vfr-managed-source')).toHaveLength(1);
    expect(root.querySelector('.vfr-managed-source')?.textContent).toContain('Source 199');
    expect(document.activeElement).toBe(search);
    search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelectorAll('.vfr-managed-source')).toHaveLength(50);
    await view.onClose();
  });
});


it('routes OPML export and import through the selected format and confirms replacement', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const exported = '<opml version="2.0"><body/></opml>';
  const service = {
    getSnapshot: () => ({ document: { version: 1, feeds: [], folders: [] }, writable: true }),
    subscribe: () => () => {}, export: vi.fn(() => exported), import: vi.fn(async () => {}),
  };
  const view = new ManageSubscriptionsView({ contentEl: root } as never, service as never, async () => {});
  await view.onOpen();
  const click = (label: string) => { const button = [...root.querySelectorAll('button')].find(b => b.textContent === label); expect(button).toBeDefined(); button!.click(); };
  click('Import / export');
  const format = root.querySelector('select')!; format.value = 'opml'; format.dispatchEvent(new Event('change'));
  click('Generate export');
  expect(service.export).toHaveBeenCalledWith('opml');
  expect(root.querySelector('textarea')!.value).toBe(exported);
  expect(root.querySelector('input[type=file]')!.getAttribute('accept')).toContain('.opml');
  click('Import');
  await vi.waitFor(() => expect(service.import).toHaveBeenCalledWith(exported, 'opml', 'merge'));
  await vi.waitFor(() => expect(root.querySelector('h2')!.textContent).toBe('Manage RSS sources'));
  click('Import / export');
  const selectors = root.querySelectorAll('select');
  selectors[0]!.value = 'opml'; selectors[0]!.dispatchEvent(new Event('change'));
  selectors[1]!.value = 'replace'; selectors[1]!.dispatchEvent(new Event('change'));
  root.querySelector('textarea')!.value = exported;
  click('Import');
  expect(service.import).toHaveBeenCalledTimes(1);
  expect(root.textContent).toContain('Replace all subscriptions?');
  click('Confirm');
  await vi.waitFor(() => expect(service.import).toHaveBeenCalledWith(exported, 'opml', 'replace'));
  await view.onClose();
});
