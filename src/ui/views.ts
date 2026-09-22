import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import type { Article, ArticleFilter, ArticleSummary, FeedReadState, FeedSource, SubscriptionDocument } from '../domain/models';
import type { ArticleCache } from '../cache';
import { effectiveArticleTimestamp, isArticleRead, type ReadStateService } from '../read-state';
import type { SubscriptionService, SubscriptionSnapshot } from '../subscriptions';
import { sanitizeArticleFragment } from './content';

export const SOURCES_VIEW = 'vault-feed-reader-sources';
export const READER_VIEW = 'vault-feed-reader-articles';
const PAGE_SIZE = 50;

export type ReaderScope =
  | { kind: 'global'; filter: ArticleFilter }
  | { kind: 'feed'; feedId: string; filter: Exclude<ArticleFilter, 'saved'> }
  | { kind: 'folder'; folderId: string; filter: Exclude<ArticleFilter, 'saved'> };

export interface ReaderScopeBatchRequest { scope: ReaderScope; before: Date; all?: boolean; }

export interface ReaderViewDependencies {
  subscriptions?: Pick<SubscriptionService, 'getSnapshot' | 'subscribe'>;
  cache?: Pick<ArticleCache, 'queryMetadata' | 'getArticle'>;
  readState?: Pick<ReadStateService, 'load' | 'markRead' | 'markUnread' | 'markAllRead' | 'subscribe'>;
  /** Supplies saved-note metadata, including notes whose cache entry has expired. */
  getSavedArticles?: () => Promise<readonly ArticleSummary[]>;
  /** Save or reveal the note for this article. */
  onSaveArticle?: (article: Article) => Promise<void> | void;
  onOpenSavedArticle?: (summary: ArticleSummary) => Promise<void> | void;
  onManageSubscriptions?: () => void;
  onOpenReader?: () => Promise<void> | void;
  onRefresh?: (sources: readonly FeedSource[]) => Promise<void> | void;
  /** Per-source refresh errors supplied by FeedRefreshService's UI adapter. */
  getFeedErrors?: () => ReadonlyMap<string, string>;
  /** Mark every matching item in this scope read; T5 can page cache metadata safely. */
  onMarkScopeRead?: (request: ReaderScopeBatchRequest) => Promise<void> | void;
  markReadOnNavigate?: boolean;
  state?: ReaderUiState;
}

type ScopeListener = (scope: ReaderScope) => void;

/** Shared by the two Obsidian leaves so a source click changes the reader. */
export class ReaderUiState {
  private scope: ReaderScope = { kind: 'global', filter: 'all' };
  private readonly listeners = new Set<ScopeListener>();
  private readonly batchListeners = new Set<() => void>();
  getScope(): ReaderScope { return this.scope; }
  select(scope: ReaderScope): void {
    this.scope = scope;
    for (const listener of this.listeners) listener(scope);
  }
  subscribe(listener: ScopeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  requestMarkAllRead(): void { for (const listener of this.batchListeners) listener(); }
  onMarkAllRead(listener: () => void): () => void {
    this.batchListeners.add(listener);
    return () => this.batchListeners.delete(listener);
  }
}

export function createReaderUiState(): ReaderUiState { return new ReaderUiState(); }

export class SourcesView extends ItemView {
  private readonly state: ReaderUiState;
  private cleanups: (() => void)[] = [];
  private collapsed = new Set<string>();
  private counts = new Map<string, number>();
  private generation = 0;
  private closed = true;
  constructor(leaf: WorkspaceLeaf, private readonly dependencies: ReaderViewDependencies = {}) {
    super(leaf); this.state = dependencies.state ?? createReaderUiState();
  }
  getViewType(): string { return SOURCES_VIEW; }
  getDisplayText(): string { return 'RSS sources'; }
  getIcon(): string { return 'rss'; }
  async onOpen(): Promise<void> {
    this.closed = false;
    this.cleanups = [this.state.subscribe(() => this.updateSelection())];
    const subscriptions = this.dependencies.subscriptions?.subscribe(() => this.refresh());
    const states = this.dependencies.readState?.subscribe(() => this.refresh());
    if (subscriptions) this.cleanups.push(subscriptions);
    if (states) this.cleanups.push(states);
    this.refresh();
  }
  async onClose(): Promise<void> { this.closed = true; ++this.generation; this.cleanups.forEach(fn => fn()); this.cleanups = []; }
  refresh(): void {
    if (this.closed) return;
    this.render();
    void this.updateCounts(++this.generation);
  }
  private async updateCounts(generation: number): Promise<void> {
    const { cache, readState, subscriptions } = this.dependencies;
    if (!cache || !readState || !subscriptions) return;
    const feeds = subscriptions.getSnapshot().document.feeds;
    const counts = new Map<string, number>();
    try {
      for (const feed of feeds) {
        const result = await readState.load(feed.id);
        if (!result.ok) continue;
        let cursor: string | undefined, count = 0;
        do {
          if (generation !== this.generation || this.closed) return;
          const page = await cache.queryMetadata({ feedId: feed.id, limit: 500, cursor });
          count += page.items.filter(article => !isArticleRead(result.state, article)).length;
          cursor = page.nextCursor;
        } while (cursor);
        counts.set(feed.id, count);
      }
      if (generation !== this.generation || this.closed) return;
      this.counts = counts;
      for (const badge of this.contentEl.querySelectorAll<HTMLElement>('[data-count-feeds]')) {
        const ids = JSON.parse(badge.dataset.countFeeds!) as string[];
        const known = ids.every(id => counts.has(id));
        badge.textContent = known ? String(ids.reduce((sum, id) => sum + counts.get(id)!, 0)) : '';
      }
    } catch { /* Counts are supplementary; source errors remain visible. */ }
  }
  private render(): void {
    const snapshot = this.dependencies.subscriptions?.getSnapshot();
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: 'vfr-sources' });
    const header = root.createDiv({ cls: 'vfr-sidebar-header' });
    setIcon(header.createSpan({ cls: 'vfr-nav-icon' }), 'rss');
    header.createSpan({ text: 'Feed Reader', cls: 'vfr-sidebar-title' });
    const nav = root.createDiv({ cls: 'vfr-navigation', attr: { 'aria-label': 'Reader navigation' } });
    for (const [filter, icon] of [['today', 'calendar-days'], ['unread', 'circle-dot'], ['saved', 'bookmark'], ['read', 'history']] as const) {
      this.row(nav, labelForFilter(filter), icon, { kind: 'global', filter });
    }
    const actions = root.createDiv({ cls: 'vfr-sidebar-tools' });
    this.action(actions, 'Manage sources', 'list-plus', () => this.dependencies.onManageSubscriptions?.());
    this.action(actions, 'Refresh', 'refresh-cw', () => this.dependencies.onRefresh?.(snapshot?.document.feeds ?? []));
    this.action(actions, 'Mark scope read', 'check-check', () => this.state.requestMarkAllRead());
    if (!snapshot) { root.createEl('p', { text: 'Reader services are not available yet.' }); return; }
    if (snapshot.error) root.createEl('p', { cls: 'vfr-error', text: snapshot.error.message });
    root.createDiv({ cls: 'vfr-section-label', text: 'Feeds' });
    this.row(root, 'All articles', 'list-filter', { kind: 'global', filter: 'all' }, snapshot.document.feeds.map(feed => feed.id));
    if (!snapshot.document.feeds.length) root.createEl('p', { cls: 'vfr-empty-sources', text: 'Add your first source to start reading.' });
    for (const folder of snapshot.document.folders) {
      const feeds = snapshot.document.feeds.filter(feed => feed.folderIds.includes(folder.id));
      const section = root.createDiv({ cls: 'vfr-folder' });
      const heading = section.createDiv({ cls: 'vfr-folder-heading' });
      const collapsed = this.collapsed.has(folder.id);
      const toggle = heading.createEl('button', { cls: 'vfr-folder-toggle clickable-icon', attr: { 'aria-label': `Toggle ${folder.title}`, 'aria-expanded': String(!collapsed) } });
      setIcon(toggle, collapsed ? 'chevron-right' : 'chevron-down');
      const children = section.createDiv({ cls: 'vfr-folder-children' });
      children.hidden = collapsed;
      toggle.addEventListener('click', () => {
        children.hidden = !children.hidden;
        if (children.hidden) this.collapsed.add(folder.id); else this.collapsed.delete(folder.id);
        toggle.setAttribute('aria-expanded', String(!children.hidden));
        setIcon(toggle, children.hidden ? 'chevron-right' : 'chevron-down');
      });
      this.row(heading, folder.title, undefined, { kind: 'folder', folderId: folder.id, filter: 'all' }, feeds.map(feed => feed.id));
      feeds.forEach(feed => this.feedRow(children, feed));
    }
    const unfiled = snapshot.document.feeds.filter(feed => !feed.folderIds.length);
    if (unfiled.length) {
      root.createDiv({ cls: 'vfr-section-label', text: 'Unfiled' });
      unfiled.forEach(feed => this.feedRow(root, feed));
    }
    this.updateSelection();
  }
  private feedRow(parent: HTMLElement, feed: FeedSource): void {
    const button = this.row(parent, feed.title, 'rss', { kind: 'feed', feedId: feed.id, filter: 'all' }, [feed.id]);
    const error = this.dependencies.getFeedErrors?.().get(feed.id);
    if (error) {
      button.title = `${feed.title}: ${error}`;
      setIcon(button.createSpan({ cls: 'vfr-error vfr-nav-icon', attr: { 'aria-label': error } }), 'circle-alert');
    }
  }
  private row(parent: HTMLElement, title: string, icon: string | undefined, scope: ReaderScope, feedIds?: string[]): HTMLButtonElement {
    const button = this.action(parent, title, icon, async () => {
      this.state.select(scope);
      await this.dependencies.onOpenReader?.();
    });
    button.dataset.scope = JSON.stringify(scope);
    if (feedIds) button.createSpan({ cls: 'vfr-unread-count', text: feedIds.every(id => this.counts.has(id)) ? String(feedIds.reduce((sum, id) => sum + this.counts.get(id)!, 0)) : '', attr: { 'data-count-feeds': JSON.stringify(feedIds), 'aria-label': 'Unread articles' } });
    return button;
  }
  private action(parent: HTMLElement, title: string, icon: string | undefined, click: () => unknown): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'vfr-nav-row tree-item-self', attr: { title } });
    if (icon) setIcon(button.createSpan({ cls: 'vfr-nav-icon' }), icon);
    button.createSpan({ cls: 'vfr-nav-label tree-item-inner', text: title });
    button.addEventListener('click', () => { void Promise.resolve().then(click).catch(error => new Notice(message(error))); });
    return button;
  }
  private updateSelection(): void {
    const current = this.state.getScope();
    for (const button of this.contentEl.querySelectorAll<HTMLElement>('[data-scope]')) {
      const scope = JSON.parse(button.dataset.scope!) as ReaderScope;
      const selected = scope.kind === current.kind && (scope.kind === 'global' ? scope.filter === current.filter : scope.kind === 'feed' ? current.kind === 'feed' && scope.feedId === current.feedId : current.kind === 'folder' && scope.folderId === current.folderId);
      button.classList.toggle('is-active', selected);
      if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
  }
}

export class ReaderView extends ItemView {
  private readonly state: ReaderUiState;
  private closed = true;
  private root?: HTMLElement;
  private listEl?: HTMLElement;
  private articleEl?: HTMLElement;
  private search?: HTMLInputElement;
  private readerScope: ReaderScope;
  private summaries: ArticleSummary[] = [];
  private nextCursor?: string;
  private selectedIndex = -1;
  private openedKey?: string;
  private composing = false;
  private loading = false;
  private loadGeneration = 0;
  private query = '';
  private listScroll = 0;
  private pageHistory: { items: ArticleSummary[]; nextCursor?: string }[] = [];
  private navigationQueue = Promise.resolve();
  private stateError?: string;
  private states = new Map<string, FeedReadState>();
  private unsubscribeScope?: () => void;
  private unsubscribeStates?: () => void;
  private unsubscribeSubscriptions?: () => void;
  private unsubscribeBatch?: () => void;

  constructor(leaf: WorkspaceLeaf, private readonly dependencies: ReaderViewDependencies = {}) {
    super(leaf);
    this.state = dependencies.state ?? createReaderUiState();
    this.readerScope = this.state.getScope();
  }
  getViewType(): string { return READER_VIEW; }
  getDisplayText(): string { return 'RSS reader'; }
  getIcon(): string { return 'rss'; }
  async onOpen(): Promise<void> {
    this.closed = false;
    this.contentEl.empty();
    this.root = this.contentEl.createDiv({ cls: 'vfr-reader', attr: { tabindex: '0', 'aria-label': 'RSS reader' } });
    this.listEl = this.root.createDiv({ cls: 'vfr-list' });
    this.articleEl = this.root.createDiv({ cls: 'vfr-content' });
    this.root.addEventListener('keydown', event => void this.onKeyDown(event).catch(error => this.showError(error)));
    this.root.addEventListener('compositionstart', () => { this.composing = true; });
    this.root.addEventListener('compositionend', () => { this.composing = false; });
    this.unsubscribeScope = this.state.subscribe(scope => { this.root?.focus(); void this.applyScope(scope); });
    this.unsubscribeBatch = this.state.onMarkAllRead(() => void this.markScopeRead().catch(error => this.showError(error)));
    this.unsubscribeStates = this.dependencies.readState?.subscribe((feedId, result) => {
      if (this.closed) return;
      this.states.set(feedId, result.state);
      this.stateError = result.ok ? undefined : result.error.message;
      this.renderList(); // A read item remains in an already-visible unread list.
    });
    this.unsubscribeSubscriptions = this.dependencies.subscriptions?.subscribe(() => void this.refresh());
    await this.applyScope(this.readerScope);
  }
  async onClose(): Promise<void> {
    this.closed = true;
    ++this.loadGeneration; this.openedKey = undefined;
    this.root = undefined; this.listEl = undefined; this.articleEl = undefined;
    this.unsubscribeScope?.(); this.unsubscribeBatch?.(); this.unsubscribeStates?.(); this.unsubscribeSubscriptions?.();
  }
  private async applyScope(scope: ReaderScope): Promise<void> {
    const generation = ++this.loadGeneration;
    this.readerScope = scope; this.selectedIndex = -1; this.openedKey = undefined; this.nextCursor = undefined; this.summaries = [];
    this.pageHistory = []; this.listScroll = 0; this.showList(false);
    this.renderArticlePlaceholder('Choose an article');
    await this.loadPage(undefined, generation);
  }
  private async loadPage(cursor?: string, generation = ++this.loadGeneration): Promise<void> {
    if (!this.dependencies.cache || !this.dependencies.subscriptions) return this.renderUnavailable();
    const scope = this.readerScope, query = this.query;
    this.loading = true; this.renderList();
    try {
      if (scopeFilter(scope) === 'saved') {
        const saved = await this.dependencies.getSavedArticles?.() ?? [];
        const all = saved.filter(article => article.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
        const offset = cursor?.startsWith('saved:') ? Number(cursor.slice(6)) : 0;
        if (generation !== this.loadGeneration) return;
        this.summaries = [...all].slice(offset, offset + PAGE_SIZE); this.nextCursor = offset + PAGE_SIZE < all.length ? `saved:${offset + PAGE_SIZE}` : undefined;
      } else {
        const feedIds = this.scopeFeedIds(this.dependencies.subscriptions.getSnapshot().document, scope);
        await this.loadStates(feedIds);
        const result = await this.collectMatchingPage(feedIds, cursor, scope, query);
        if (generation !== this.loadGeneration) return;
        this.summaries = result.items; this.nextCursor = result.nextCursor;
      }
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.summaries = []; this.nextCursor = undefined; this.renderList(message(error)); return;
    }
    finally { if (generation === this.loadGeneration) this.loading = false; }
    if (generation !== this.loadGeneration) return;
    this.renderList();
  }
  private async collectMatchingPage(feedIds: readonly string[], cursor: string | undefined, scope: ReaderScope, query: string): Promise<{ items: ArticleSummary[]; nextCursor?: string }> {
    const matches: ArticleSummary[] = [], seen = new Set<string>();
    let next = cursor;
    do {
      const page = await this.dependencies.cache!.queryMetadata({ feedIds, limit: PAGE_SIZE - matches.length, ...(next ? { cursor: next } : {}) });
      next = page.nextCursor;
      for (const summary of page.items) if (!seen.has(articleKey(summary)) && this.matches(summary, scope, query)) {
        seen.add(articleKey(summary)); matches.push(summary); if (matches.length === PAGE_SIZE) break;
      }
    } while (next && matches.length < PAGE_SIZE);
    return { items: matches, ...(next ? { nextCursor: next } : {}) };
  }
  private scopeFeedIds(document: SubscriptionDocument, scope: ReaderScope): string[] {
    if (scope.kind === 'feed') return document.feeds.some(feed => feed.id === scope.feedId) ? [scope.feedId] : [];
    if (scope.kind === 'folder') return [...new Set(document.feeds.filter(feed => feed.folderIds.includes(scope.folderId)).map(feed => feed.id))];
    return document.feeds.map(feed => feed.id);
  }
  private async loadStates(feedIds: readonly string[]): Promise<void> {
    if (!this.dependencies.readState) return;
    const loaded = await Promise.all(feedIds.map(feedId => this.dependencies.readState!.load(feedId)));
    for (const result of loaded) {
      this.states.set(result.state.feedId, result.state);
      if (!result.ok) this.stateError = result.error.message;
    }
  }
  private matches(article: ArticleSummary, scope: ReaderScope, query: string): boolean {
    const filter = scopeFilter(scope), state = this.states.get(article.feedId);
    const statusMatch = filter === 'read' ? (state ? isArticleRead(state, article) : false)
      : filter === 'unread' ? (state ? !isArticleRead(state, article) : true)
        : filter === 'today' ? isToday(article) : true;
    return statusMatch && article.title.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  }
  private renderList(error?: string): void {
    const list = this.listEl; if (!list) return;
    const active = document.activeElement;
    const restoreSearch = active === this.search;
    const restoreRow = active instanceof HTMLElement && active.classList.contains('vfr-article-row');
    const restoreRoot = active === this.root;
    const start = restoreSearch && this.search ? this.search.selectionStart : undefined;
    const end = restoreSearch && this.search ? this.search.selectionEnd : undefined;
    const scroll = list.scrollTop;
    list.empty();
    const heading = list.createDiv({ cls: 'vfr-list-heading' });
    heading.createEl('h1', { text: this.scopeLabel() });
    heading.createEl('p', { cls: 'vfr-list-description', text: 'Choose an article to read · j / k to navigate' });
    const filters = list.createDiv({ cls: 'vfr-filter-actions' });
    for (const filter of ['all', 'unread', 'read', 'today'] as const) {
      const button = filters.createEl('button', { text: labelForFilter(filter) });
      button.setAttribute('aria-pressed', String(this.readerScope.filter === filter));
      button.addEventListener('click', () => this.setScopeFilter(filter));
    }
    const search = list.createEl('input', { type: 'search', placeholder: 'Search titles', cls: 'vfr-search' });
    search.value = this.search?.value ?? '';
    search.addEventListener('input', () => { this.query = search.value; void this.applyScope(this.readerScope); }); this.search = search;
    const more = list.createEl('details', { cls: 'vfr-batch-menu' });
    more.createEl('summary', { text: 'Reading actions' });
    const actions = more.createDiv({ cls: 'vfr-list-actions' });
    const batch = actions.createEl('button', { text: 'Mark scope read' }); batch.addEventListener('click', () => void this.markScopeRead().catch(error => this.showError(error)));
    const date = actions.createEl('input', { type: 'date', attr: { 'aria-label': 'Mark articles before local date' } });
    const before = actions.createEl('button', { text: 'Mark before date' });
    before.addEventListener('click', () => {
      if (!date.value) { this.showError('Choose a local cutoff date'); return; }
      const cutoff = new Date(`${date.value}T00:00:00`);
      void this.markScopeRead(cutoff).catch(error => this.showError(error));
    });
    actions.createEl('small', { text: 'Applies to the entire source, folder, or global scope, regardless of search and filter. Date excludes that local day.' });
    const refresh = actions.createEl('button', { text: 'Refresh' });
    refresh.addEventListener('click', () => void this.refreshFromSource().catch(error => this.showError(error)));
    if (error ?? this.stateError) list.createEl('p', { cls: 'vfr-error', text: error ?? this.stateError! });
    if (this.loading) list.createEl('p', { text: 'Loading articles…' });
    this.renderRows(search.value);
    list.scrollTop = scroll;
    if (restoreSearch) { search.focus(); search.setSelectionRange(start ?? search.value.length, end ?? search.value.length); }
    else if (restoreRow) this.listEl?.querySelector<HTMLElement>('.is-selected')?.focus();
    else if (restoreRoot) this.root?.focus();
  }
  private renderRows(query: string): void {
    const list = this.listEl; if (!list) return;
    list.querySelector('.vfr-rows')?.remove(); list.querySelector('.vfr-page-controls')?.remove();
    const rows = list.createDiv({ cls: 'vfr-rows', attr: { role: 'listbox', 'aria-label': 'Articles' } });
    const visible = this.summaries.slice(0, PAGE_SIZE);
    if (!visible.length && !this.loading) rows.createEl('p', { text: 'No articles match this view.' });
    for (const summary of visible) {
      const index = this.summaries.indexOf(summary);
      const row = rows.createEl('button', { cls: `vfr-article-row${index === this.selectedIndex ? ' is-selected' : ''}`, attr: { role: 'option', 'aria-selected': String(index === this.selectedIndex) } });
      row.createSpan({ cls: 'vfr-article-source', text: this.dependencies.subscriptions?.getSnapshot().document.feeds.find(feed => feed.id === summary.feedId)?.title ?? 'Saved article' });
      row.createSpan({ cls: 'vfr-article-title', text: summary.title || 'Untitled article' });
      row.createSpan({ cls: 'vfr-article-date', text: formatDate(summary) });
      if (!this.articleRead(summary)) row.addClass('is-unread');
      row.addEventListener('click', () => { this.selectedIndex = index; void this.openSelected().catch(error => this.showError(error)); });
    }
    if (this.nextCursor || this.pageHistory.length) {
      const controls = list.createDiv({ cls: 'vfr-page-controls' });
      if (this.pageHistory.length) {
        const previous = controls.createEl('button', { text: 'Previous page' });
        previous.addEventListener('click', () => void this.changePage(-1));
      }
      if (this.nextCursor) {
        const next = controls.createEl('button', { text: 'Next 50 articles' });
        next.addEventListener('click', () => void this.changePage(1));
      }
    }
  }
  private scopeLabel(): string {
    const doc = this.dependencies.subscriptions?.getSnapshot().document, scope = this.readerScope;
    return scope.kind === 'feed' ? doc?.feeds.find(feed => feed.id === scope.feedId)?.title ?? 'Source articles'
      : scope.kind === 'folder' ? doc?.folders.find(folder => folder.id === scope.folderId)?.title ?? 'Folder articles' : labelForFilter(scope.filter);
  }
  private showList(focus = true): void {
    this.openedKey = undefined;
    if (this.listEl) { this.listEl.hidden = false; this.listEl.scrollTop = this.listScroll; }
    if (this.articleEl) this.articleEl.hidden = true;
    if (focus) (this.listEl?.querySelector<HTMLElement>('.is-selected') ?? this.root)?.focus();
  }
  private showArticle(): void {
    if (this.listEl && !this.listEl.hidden) this.listScroll = this.listEl.scrollTop;
    if (this.listEl) this.listEl.hidden = true;
    if (this.articleEl) { this.articleEl.hidden = false; this.articleEl.scrollTop = 0; }
    this.root?.focus();
  }
  private async changePage(direction: number): Promise<void> {
    if (this.loading) return;
    if (direction > 0 && this.nextCursor) {
      this.pageHistory.push({ items: this.summaries, nextCursor: this.nextCursor });
      await this.loadPage(this.nextCursor);
    } else if (direction < 0 && this.pageHistory.length) {
      const page = this.pageHistory.pop()!;
      this.summaries = page.items; this.nextCursor = page.nextCursor;
    } else return;
    this.selectedIndex = -1; this.listScroll = 0; this.renderList();
    if (this.listEl) this.listEl.scrollTop = 0;
  }

  private async onKeyDown(event: KeyboardEvent): Promise<void> {
    if (this.closed || this.composing || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || isEditingTarget(event.target)) return;
    if (!['j', 'k', 'Enter', 'o', 'm', 's', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'j') return this.move(1);
    if (event.key === 'k') return this.move(-1);
    if (event.key === 'Enter') return this.openSelected();
    if (event.key === 'o') return this.openOriginal();
    if (event.key === 'm') return this.toggleRead();
    if (event.key === 's') return this.saveSelected();
    this.showList();
  }
  private move(delta: number): Promise<void> {
    const scope = this.readerScope;
    const action = this.navigationQueue.then(() => {
      if (!this.closed && scope === this.readerScope) return this.moveNow(delta);
    });
    this.navigationQueue = action.catch(() => {});
    return action;
  }
  private async moveNow(delta: number): Promise<void> {
    if (!this.summaries.length || this.loading) return;
    const inArticle = !!this.openedKey;
    const scope = this.readerScope;
    {
      let index = this.selectedIndex < 0 ? 0 : this.selectedIndex + delta;
      if (index >= this.summaries.length && this.nextCursor) { await this.changePage(1); index = 0; }
      else if (index < 0 && this.pageHistory.length) { await this.changePage(-1); index = this.summaries.length - 1; }
      if (this.closed || scope !== this.readerScope) return;
      this.selectedIndex = Math.min(this.summaries.length - 1, Math.max(0, index)); this.renderList();
      if (inArticle) await this.openSelected();
      else {
        const selectedRow = this.listEl?.querySelector<HTMLElement>('.is-selected');
        selectedRow?.focus(); selectedRow?.scrollIntoView?.({ block: 'nearest' });
        const selected = this.selected();
        if (selected && this.dependencies.markReadOnNavigate) await this.markRead(selected);
      }
    }
  }
  private async openSelected(): Promise<void> {
    const selected = this.selected(); if (!selected) return;
    if (scopeFilter(this.readerScope) === 'saved' && this.dependencies.onOpenSavedArticle) {
      await this.dependencies.onOpenSavedArticle(selected); return;
    }
    if (!this.dependencies.cache) return;
    this.openedKey = articleKey(selected); this.showArticle(); this.renderArticlePlaceholder('Loading article…');
    try {
      const article = await this.dependencies.cache.getArticle(selected.feedId, selected.id);
      if (!article) throw new Error('The article is no longer in the cache.');
      if (this.openedKey !== articleKey(selected)) return;
      this.renderArticle(article); await this.markRead(article);
    } catch (error) { if (!this.closed && this.openedKey === articleKey(selected)) this.renderArticlePlaceholder(message(error), true); }
  }
  private renderArticle(article: Article): void {
    const container = this.articleEl; if (!container) return;
    container.empty(); this.articleNavigation(container);
    const reading = container.createDiv({ cls: 'vfr-reading-column' });
    reading.createEl('p', { cls: 'vfr-article-meta', text: `${this.dependencies.subscriptions?.getSnapshot().document.feeds.find(feed => feed.id === article.feedId)?.title ?? ''} · ${formatDate(article)}` });
    reading.createEl('h1', { text: article.title || 'Untitled article' });
    const actions = reading.createDiv({ cls: 'vfr-article-actions' });
    if (article.url && isSafeHttpUrl(article.url)) {
      const link = actions.createEl('a', { text: 'Open original', href: article.url });
      link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer');
    }
    const save = actions.createEl('button', { text: 'Save / open note' });
    save.addEventListener('click', () => void Promise.resolve(this.dependencies.onSaveArticle?.(article)).catch(error => this.showError(error)));
    const read = actions.createEl('button', { text: 'Toggle read / unread' });
    read.addEventListener('click', () => void this.toggleRead().catch(error => this.showError(error)));
    const body = reading.createDiv({ cls: 'vfr-article-body markdown-rendered' });
    body.append(sanitizeArticleFragment(article.contentHtml, this.sourceUrl(article.feedId)));
    for (const link of body.querySelectorAll('a[href]')) {
      link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer');
    }
    if (!body.textContent?.trim() && !body.children.length) body.createEl('p', { text: 'This source did not provide article content.' });
  }
  private articleNavigation(container: HTMLElement): void {
    const nav = container.createDiv({ cls: 'vfr-article-navigation' });
    const back = nav.createEl('button', { text: 'Back to list', attr: { 'aria-label': 'Back to list (Escape)' } });
    back.addEventListener('click', () => this.showList());
    nav.createSpan({ cls: 'vfr-navigation-scope', text: this.scopeLabel() });
    const previous = nav.createEl('button', { text: 'Previous', attr: { 'aria-label': 'Previous article (k)' } });
    previous.disabled = this.selectedIndex <= 0 && !this.pageHistory.length;
    previous.addEventListener('click', () => void this.move(-1).catch(error => this.showError(error)));
    const next = nav.createEl('button', { text: 'Next', attr: { 'aria-label': 'Next article (j)' } });
    next.disabled = this.selectedIndex >= this.summaries.length - 1 && !this.nextCursor;
    next.addEventListener('click', () => void this.move(1).catch(error => this.showError(error)));
  }
  private sourceUrl(feedId: string): string | undefined {
    return this.dependencies.subscriptions?.getSnapshot().document.feeds.find(feed => feed.id === feedId)?.url;
  }
  private renderArticlePlaceholder(text: string, failure = false): void {
    if (!this.articleEl) return;
    this.articleEl.empty(); if (this.openedKey) this.articleNavigation(this.articleEl); this.articleEl.createEl('h2', { text: failure ? 'Could not open article' : text });
    if (failure) this.articleEl.createEl('p', { cls: 'vfr-error', text });
  }
  private renderUnavailable(): void {
    this.renderArticlePlaceholder('Reader services are not available yet.');
    this.listEl?.empty(); this.listEl?.createEl('p', { text: 'Reader services are not available yet.' });
  }
  private selected(): ArticleSummary | undefined { return this.selectedIndex < 0 ? undefined : this.summaries[this.selectedIndex]; }
  private articleRead(article: ArticleSummary): boolean { const state = this.states.get(article.feedId); return state ? isArticleRead(state, article) : false; }
  private async markRead(article: ArticleSummary): Promise<void> {
    const result = await this.dependencies.readState?.markRead(article.feedId, article.id);
    if (this.closed) return;
    if (result) { this.states.set(article.feedId, result.state); this.stateError = result.ok ? undefined : result.error.message; } this.renderList();
  }
  private async toggleRead(): Promise<void> {
    const article = this.selected(); if (!article || !this.dependencies.readState) return;
    const result = this.articleRead(article) ? await this.dependencies.readState.markUnread(article.feedId, article.id) : await this.dependencies.readState.markRead(article.feedId, article.id);
    if (this.closed) return;
    this.states.set(article.feedId, result.state); this.stateError = result.ok ? undefined : result.error.message; this.renderList();
  }
  private async saveSelected(): Promise<void> {
    const summary = this.selected(); if (!summary) return;
    if (scopeFilter(this.readerScope) === 'saved' && this.dependencies.onOpenSavedArticle) {
      await this.dependencies.onOpenSavedArticle(summary); return;
    }
    if (!this.dependencies.cache || !this.dependencies.onSaveArticle) return;
    const article = await this.dependencies.cache.getArticle(summary.feedId, summary.id); if (article) await this.dependencies.onSaveArticle(article);
  }
  private async openOriginal(): Promise<void> {
    const article = this.selected(); if (!article?.url || !isSafeHttpUrl(article.url)) return;
    window.open(article.url, '_blank', 'noopener,noreferrer');
  }
  private async markScopeRead(before?: Date): Promise<void> {
    await this.dependencies.onMarkScopeRead?.({ scope: this.readerScope, before: before ?? new Date(), all: !before });
    if (this.closed) return;
    // T5 owns the paged cache traversal; reapply only after it persists state.
    await this.applyScope(this.readerScope);
  }
  /** Reloads metadata without dislodging the selected article or just-read unread rows. */
  async refresh(): Promise<void> {
    if (this.closed) return;
    const selectedKey = this.selected() ? articleKey(this.selected()!) : undefined;
    const retained = this.summaries;
    const generation = ++this.loadGeneration;
    await this.loadPage(undefined, generation);
    if (generation !== this.loadGeneration) return;
    if (scopeFilter(this.readerScope) === 'unread') {
      this.summaries = [...new Map([...retained, ...this.summaries].map(item => [articleKey(item), item])).values()].slice(0, PAGE_SIZE);
    }
    this.selectedIndex = selectedKey ? this.summaries.findIndex(item => articleKey(item) === selectedKey) : -1;
    this.renderList();
  }
  private async refreshFromSource(): Promise<void> {
    await this.dependencies.onRefresh?.(this.dependencies.subscriptions?.getSnapshot().document.feeds ?? []);
    await this.refresh();
  }
  private showError(error: unknown): void { if (!this.closed) { this.stateError = message(error); this.renderList(); new Notice(this.stateError); } }
  private setScopeFilter(filter: Exclude<ArticleFilter, 'saved'>): void {
    if (this.readerScope.kind === 'global') this.state.select({ kind: 'global', filter });
    else if (this.readerScope.kind === 'feed') this.state.select({ ...this.readerScope, filter });
    else this.state.select({ ...this.readerScope, filter });
  }
}

function articleKey(article: ArticleSummary): string { return `${article.feedId}\u0000${article.id}`; }
function scopeFilter(scope: ReaderScope): ArticleFilter { return scope.filter; }
function labelForFilter(filter: ArticleFilter): string { return ({ all: 'All articles', unread: 'Unread', read: 'Read', today: 'Today', saved: 'Saved' })[filter]; }
function scopeTitle(scope: ReaderScope): string { return scope.kind === 'global' ? labelForFilter(scope.filter) : scope.kind === 'feed' ? 'Source articles' : 'Folder articles'; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function isSafeHttpUrl(value: string): boolean { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; } }
function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
function isToday(article: ArticleSummary, now = new Date()): boolean {
  const date = new Date(effectiveArticleTimestamp(article));
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}
function formatDate(article: ArticleSummary): string {
  const date = new Date(effectiveArticleTimestamp(article));
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : '';
}
