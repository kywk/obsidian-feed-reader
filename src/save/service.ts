import type { Article, ArticleSummary, FeedSource } from '../domain/models';
import { DEFAULT_NOTE_TEMPLATES, validateNoteTemplates } from './templates';
import {
  articleKey,
  renderNoteFilename,
  renderArticleNote,
  shortArticleId,
} from './markdown';
import type {
  SaveArticleOptions,
  SaveArticleResult,
  SavedArticle,
  SavedNoteChange,
  SavedNoteStorage,
} from './types';

function normalizeFolder(folder: string): string {
  const normalized = folder.replace(/\/+$/, '').trim();
  if (!normalized || normalized.startsWith('/') || normalized.includes('\\')
    || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Saved articles folder must be a vault-relative path');
  }
  return normalized;
}

export class ArticleSaveService {
  private readonly folder: string;
  private readonly now: () => Date;
  private readonly byKey = new Map<string, SavedArticle>();
  private readonly keyByPath = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<SaveArticleResult>>();
  private readonly reservedPaths = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private stopWatching?: () => void;

  constructor(
    private readonly storage: SavedNoteStorage,
    private readonly options: SaveArticleOptions,
  ) {
    this.folder = normalizeFolder(options.folder);
    this.now = options.now ?? (() => new Date());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch {}
    }
  }

  start(): void {
    if (this.stopWatching) return;
    this.rebuildIndex();
    this.stopWatching = this.storage.watch(change => this.applyChange(change));
  }

  dispose(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
  }

  rebuildIndex(): void {
    this.byKey.clear();
    this.keyByPath.clear();
    for (const note of this.storage.list()) this.index(note);
    this.notify();
  }

  listSaved(): SavedArticle[] {
    this.ensureStarted();
    if ([...this.byKey.values()].some(note => !this.storage.exists(note.path))) {
      this.rebuildIndex();
    }
    return [...this.byKey.values()]
      .filter(note => this.storage.exists(note.path))
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  }

  async listSavedArticles(): Promise<readonly ArticleSummary[]> {
    return this.listSaved().map(note => ({
      id: note.articleId,
      feedId: note.feedId,
      title: note.title,
      firstFetchedAt: note.firstFetchedAt,
      ...(note.url ? { url: note.url } : {}),
      ...(note.publishedAt ? { publishedAt: note.publishedAt } : {}),
    }));
  }

  findSaved(feedId: string, articleId: string): SavedArticle | undefined {
    this.ensureStarted();
    return this.resolveExisting(articleKey(feedId, articleId));
  }

  isSaved(feedId: string, articleId: string): boolean {
    return this.findSaved(feedId, articleId) !== undefined;
  }

  save(article: Article, source: FeedSource): Promise<SaveArticleResult> {
    this.ensureStarted();
    if (article.feedId !== source.id) {
      return Promise.reject(new Error('Article feedId does not match the source ID'));
    }

    const key = articleKey(source.id, article.id);
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const save = this.saveOnce(article, source, key).finally(() => {
      if (this.inFlight.get(key) === save) this.inFlight.delete(key);
    });
    this.inFlight.set(key, save);
    return save;
  }

  private async saveOnce(article: Article, source: FeedSource, key: string): Promise<SaveArticleResult> {
    const existing = this.resolveExisting(key);
    if (existing) return { created: false, note: existing };

    const savedAt = this.now();
    const savedAtIso = savedAt.toISOString();
    const templates = { ...(this.options.templates?.() ?? DEFAULT_NOTE_TEMPLATES) };
    validateNoteTemplates(templates);
    const stem = renderNoteFilename(article, source, savedAtIso, templates);
    const note: SavedArticle = {
      articleKey: key,
      articleId: article.id,
      feedId: source.id,
      title: article.title,
      sourceTitle: source.title,
      path: '',
      savedAt: savedAtIso,
      firstFetchedAt: article.firstFetchedAt,
      ...(article.url ? { url: article.url } : {}),
      ...(article.publishedAt ? { publishedAt: article.publishedAt } : {}),
    };

    const contents = renderArticleNote(article, source, note, this.options.sanitize, templates);
    let attempt = 0;
    while (true) {
      note.path = this.availablePath(stem, key, attempt);
      this.reservedPaths.add(note.path);
      try {
        await this.storage.create(note.path, contents);
        this.index(note);
        this.notify();
        return { created: true, note: { ...note } };
      } catch (error) {
        if (!this.storage.exists(note.path)) throw error;
        attempt += 1;
      } finally {
        this.reservedPaths.delete(note.path);
      }
    }
  }

  private availablePath(stem: string, key: string, attempt: number): string {
    let candidate = attempt;
    while (true) {
      const suffix = candidate === 0 ? '' : candidate === 1
        ? `-${shortArticleId(key)}`
        : `-${shortArticleId(key)}-${candidate}`;
      const path = `${this.folder}/${stem}${suffix}.md`;
      if (!this.reservedPaths.has(path) && !this.storage.exists(path)) return path;
      candidate += 1;
    }
  }

  private resolveExisting(key: string): SavedArticle | undefined {
    const indexed = this.byKey.get(key);
    if (!indexed) return undefined;
    if (this.storage.exists(indexed.path)) return { ...indexed };
    this.removePath(indexed.path);

    // A stale path is the only case that scans cached frontmatter again.
    const recovered = this.storage.list().find(note => note.articleKey === key && this.storage.exists(note.path));
    if (!recovered) return undefined;
    this.index(recovered);
    return { ...recovered };
  }

  private ensureStarted(): void {
    if (!this.stopWatching) this.start();
  }

  private index(note: SavedArticle): void {
    const previousAtPath = this.keyByPath.get(note.path);
    if (previousAtPath && previousAtPath !== note.articleKey) this.byKey.delete(previousAtPath);
    const previousForKey = this.byKey.get(note.articleKey);
    if (previousForKey && previousForKey.path !== note.path) this.keyByPath.delete(previousForKey.path);
    const copy = { ...note };
    this.byKey.set(copy.articleKey, copy);
    this.keyByPath.set(copy.path, copy.articleKey);
  }

  private removePath(path: string): void {
    const key = this.keyByPath.get(path);
    if (!key) return;
    this.keyByPath.delete(path);
    if (this.byKey.get(key)?.path === path) this.byKey.delete(key);
  }

  private applyChange(change: SavedNoteChange): void {
    if (change.type === 'upsert') {
      this.index(change.note);
      this.notify();
      return;
    }
    if (change.type === 'delete') {
      this.removePath(change.path);
      this.notify();
      return;
    }

    const key = this.keyByPath.get(change.oldPath);
    if (!key) return;
    const note = this.byKey.get(key);
    this.keyByPath.delete(change.oldPath);
    if (!note) return;
    note.path = change.newPath;
    this.keyByPath.set(change.newPath, key);
    this.notify();
  }
}
