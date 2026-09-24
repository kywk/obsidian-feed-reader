import type { ArticleSummary, StoredArticleDocument, StoredArticleItem } from '../domain/models';
import type { UserListStorage } from './storage';

export const DEFAULT_USER_LISTS_DIRECTORY = 'Feed Reader/state';

export interface UserListError {
  path: string;
  message: string;
  cause?: unknown;
}

export type UserListKind = 'favorites' | 'read-later';

function itemKey(feedId: string, articleId: string): string {
  return `${feedId}\0${articleId}`;
}

function validateDocument(data: unknown, path: string): StoredArticleDocument {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('User list document must be an object');
  }
  const record = data as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error('User list document version must be 1');
  }
  if (!Array.isArray(record.items)) {
    throw new Error('User list items must be an array');
  }

  const items: StoredArticleItem[] = [];
  for (const raw of record.items) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      continue;
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.feedId !== 'string') {
      continue;
    }
    items.push({
      id: item.id,
      feedId: item.feedId,
      title: typeof item.title === 'string' ? item.title : '',
      firstFetchedAt: typeof item.firstFetchedAt === 'string' ? item.firstFetchedAt : new Date().toISOString(),
      addedAt: typeof item.addedAt === 'string' ? item.addedAt : new Date().toISOString(),
      ...(typeof item.url === 'string' ? { url: item.url } : {}),
      ...(typeof item.publishedAt === 'string' ? { publishedAt: item.publishedAt } : {}),
      ...(typeof item.author === 'string' ? { author: item.author } : {}),
      ...(typeof item.snippet === 'string' ? { snippet: item.snippet } : {}),
      ...(typeof item.imageUrl === 'string' ? { imageUrl: item.imageUrl } : {}),
      ...(typeof item.contentHtml === 'string' ? { contentHtml: item.contentHtml } : {}),
    });
  }

  return { version: 1, items };
}

export class UserListsService {
  private favorites = new Map<string, StoredArticleItem>();
  private readLater = new Map<string, StoredArticleItem>();
  private queues = new Map<UserListKind, Promise<void>>();
  private listeners = new Set<() => void>();
  private _directory: string;

  constructor(
    private readonly storage: UserListStorage,
    directory = DEFAULT_USER_LISTS_DIRECTORY,
  ) {
    this._directory = directory;
  }

  get directory(): string {
    return this._directory;
  }

  setDirectory(directory: string): void {
    this._directory = directory;
    void this.load();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Ignore listener errors */
      }
    }
  }

  private filePath(kind: UserListKind): string {
    return `${this.directory}/${kind}.json`;
  }

  async load(): Promise<void> {
    await Promise.all([
      this.loadFile('favorites'),
      this.loadFile('read-later'),
    ]);
  }

  async reloadFile(filePath: string): Promise<void> {
    if (filePath === this.filePath('favorites')) {
      await this.loadFile('favorites');
    } else if (filePath === this.filePath('read-later')) {
      await this.loadFile('read-later');
    }
  }

  private async loadFile(kind: UserListKind): Promise<void> {
    const path = this.filePath(kind);
    try {
      const text = await this.storage.read(path);
      if (text === null) {
        if (kind === 'favorites') this.favorites.clear();
        else this.readLater.clear();
        this.notify();
        return;
      }
      const parsed = JSON.parse(text) as unknown;
      const doc = validateDocument(parsed, path);
      const targetMap = kind === 'favorites' ? this.favorites : this.readLater;
      targetMap.clear();
      for (const item of doc.items) {
        targetMap.set(itemKey(item.feedId, item.id), item);
      }
      this.notify();
    } catch (cause) {
      // Keep existing memory items on error; do not overwrite corrupt files
      console.error(`Failed to load ${kind} list from ${path}:`, cause);
    }
  }

  private enqueue<T>(kind: UserListKind, op: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(kind) ?? Promise.resolve();
    const result = prev.then(op, op);
    const tail = result.then(() => undefined, () => undefined);
    this.queues.set(kind, tail);
    void tail.finally(() => {
      if (this.queues.get(kind) === tail) this.queues.delete(kind);
    });
    return result;
  }

  private async persist(kind: UserListKind): Promise<void> {
    const path = this.filePath(kind);
    const map = kind === 'favorites' ? this.favorites : this.readLater;
    const items = [...map.values()].sort((a, b) => {
      const cmp = b.addedAt.localeCompare(a.addedAt);
      if (cmp !== 0) return cmp;
      return (b.publishedAt || b.firstFetchedAt).localeCompare(a.publishedAt || a.firstFetchedAt);
    });
    const doc: StoredArticleDocument = { version: 1, items };
    const content = `${JSON.stringify(doc, null, 2)}\n`;
    await this.storage.write(path, content);
  }

  // --- Favorites ---

  isFavorite(feedId: string, articleId: string): boolean {
    return this.favorites.has(itemKey(feedId, articleId));
  }

  getFavorites(): readonly StoredArticleItem[] {
    return [...this.favorites.values()].sort((a, b) => {
      const cmp = b.addedAt.localeCompare(a.addedAt);
      if (cmp !== 0) return cmp;
      return (b.publishedAt || b.firstFetchedAt).localeCompare(a.publishedAt || a.firstFetchedAt);
    });
  }

  async addFavorite(article: ArticleSummary, contentHtml?: string): Promise<void> {
    const key = itemKey(article.feedId, article.id);
    const existing = this.favorites.get(key);
    const item: StoredArticleItem = {
      ...article,
      contentHtml: contentHtml ?? existing?.contentHtml,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
    };
    this.favorites.set(key, item);
    await this.enqueue('favorites', async () => {
      await this.persist('favorites');
      this.notify();
    });
  }

  async removeFavorite(feedId: string, articleId: string): Promise<void> {
    const key = itemKey(feedId, articleId);
    if (!this.favorites.has(key)) return;
    this.favorites.delete(key);
    await this.enqueue('favorites', async () => {
      await this.persist('favorites');
      this.notify();
    });
  }

  async toggleFavorite(article: ArticleSummary, contentHtml?: string): Promise<boolean> {
    if (this.isFavorite(article.feedId, article.id)) {
      await this.removeFavorite(article.feedId, article.id);
      return false;
    } else {
      await this.addFavorite(article, contentHtml);
      return true;
    }
  }

  // --- Read Later ---

  isReadLater(feedId: string, articleId: string): boolean {
    return this.readLater.has(itemKey(feedId, articleId));
  }

  getReadLater(): readonly StoredArticleItem[] {
    return [...this.readLater.values()].sort((a, b) => {
      const cmp = b.addedAt.localeCompare(a.addedAt);
      if (cmp !== 0) return cmp;
      return (b.publishedAt || b.firstFetchedAt).localeCompare(a.publishedAt || a.firstFetchedAt);
    });
  }

  async addReadLater(article: ArticleSummary, contentHtml?: string): Promise<void> {
    const key = itemKey(article.feedId, article.id);
    const existing = this.readLater.get(key);
    const item: StoredArticleItem = {
      ...article,
      contentHtml: contentHtml ?? existing?.contentHtml,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
    };
    this.readLater.set(key, item);
    await this.enqueue('read-later', async () => {
      await this.persist('read-later');
      this.notify();
    });
  }

  async removeReadLater(feedId: string, articleId: string): Promise<void> {
    const key = itemKey(feedId, articleId);
    if (!this.readLater.has(key)) return;
    this.readLater.delete(key);
    await this.enqueue('read-later', async () => {
      await this.persist('read-later');
      this.notify();
    });
  }

  async toggleReadLater(article: ArticleSummary, contentHtml?: string): Promise<boolean> {
    if (this.isReadLater(article.feedId, article.id)) {
      await this.removeReadLater(article.feedId, article.id);
      return false;
    } else {
      await this.addReadLater(article, contentHtml);
      return true;
    }
  }

  // --- Cross-lookup for offline cache fallback ---

  getStoredArticle(feedId: string, articleId: string): StoredArticleItem | undefined {
    const key = itemKey(feedId, articleId);
    return this.favorites.get(key) ?? this.readLater.get(key);
  }
}
