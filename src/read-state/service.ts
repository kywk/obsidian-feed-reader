import type { ArticleSummary, FeedReadState } from '../domain/models';
import type { ReadStateStorage } from './storage';

export const DEFAULT_READ_STATE_DIRECTORY = 'Feed Reader/state';

export interface ReadStateError {
  path: string;
  message: string;
  cause?: unknown;
}

export type ReadStateResult =
  | { ok: true; state: FeedReadState }
  | { ok: false; state: FeedReadState; error: ReadStateError };

interface CachedState {
  state: FeedReadState;
  writable: boolean;
  error?: ReadStateError;
}

function clone(state: FeedReadState): FeedReadState {
  return {
    version: 1,
    feedId: state.feedId,
    ...(state.readBefore === undefined ? {} : { readBefore: state.readBefore }),
    readIds: [...state.readIds],
    unreadIds: [...state.unreadIds],
  };
}

function empty(feedId: string): FeedReadState {
  return { version: 1, feedId, readIds: [], unreadIds: [] };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validate(value: unknown, expectedFeedId: string): FeedReadState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('State must be an object');
  const record = value as Record<string, unknown>;
  if (record.version !== 1) throw new Error('State version must be 1');
  if (record.feedId !== expectedFeedId) throw new Error('State feedId does not match its filename');
  if (record.readBefore !== undefined && !validIso(record.readBefore)) throw new Error('readBefore must be an ISO timestamp');
  if (!Array.isArray(record.readIds) || record.readIds.some(id => typeof id !== 'string')) {
    throw new Error('readIds must be an array of strings');
  }
  if (!Array.isArray(record.unreadIds) || record.unreadIds.some(id => typeof id !== 'string')) {
    throw new Error('unreadIds must be an array of strings');
  }
  return {
    version: 1,
    feedId: expectedFeedId,
    ...(record.readBefore === undefined ? {} : { readBefore: record.readBefore }),
    readIds: unique(record.readIds as string[]),
    unreadIds: unique(record.unreadIds as string[]),
  };
}

function timestamp(article: ArticleSummary): number {
  const published = article.publishedAt === undefined ? Number.NaN : Date.parse(article.publishedAt);
  if (Number.isFinite(published)) return published;
  const fetched = Date.parse(article.firstFetchedAt);
  if (!Number.isFinite(fetched)) throw new Error(`Article ${article.id} has no valid effective timestamp`);
  return fetched;
}

export function effectiveArticleTimestamp(article: ArticleSummary): string {
  return new Date(timestamp(article)).toISOString();
}

export function isArticleRead(state: FeedReadState, article: ArticleSummary): boolean {
  if (state.unreadIds.includes(article.id)) return false;
  if (state.readIds.includes(article.id)) return true;
  return state.readBefore !== undefined && timestamp(article) < Date.parse(state.readBefore);
}

export class ReadStateService {
  private cache = new Map<string, CachedState>();
  private queues = new Map<string, Promise<void>>();
  private listeners = new Set<(feedId: string, result: ReadStateResult) => void>();

  private _directory: string;

  constructor(
    private readonly storage: ReadStateStorage,
    directory = DEFAULT_READ_STATE_DIRECTORY,
  ) {
    this._directory = directory;
  }

  get directory(): string {
    return this._directory;
  }

  setDirectory(directory: string): void {
    this._directory = directory;
    this.cache.clear();
  }

  subscribe(listener: (feedId: string, result: ReadStateResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(feedId: string, reload = false): Promise<ReadStateResult> {
    this.requireSafeFeedId(feedId);
    if (!reload) {
      const cached = this.cache.get(feedId);
      if (cached) return this.result(cached);
    }
    return this.enqueue(feedId, async () => {
      if (!reload) {
        const cached = this.cache.get(feedId);
        if (cached) return this.result(cached);
      }
      const fallback = this.cache.get(feedId)?.state ?? empty(feedId);
      const path = this.path(feedId);
      let text: string | null;
      try {
        text = await this.storage.read(path);
      } catch (cause) {
        const entry: CachedState = { state: clone(fallback), writable: false, error: { path, message: 'Could not read read-state', cause } };
        this.cache.set(feedId, entry);
        return this.emit(feedId, entry);
      }
      if (text === null) {
        const entry: CachedState = { state: empty(feedId), writable: true };
        this.cache.set(feedId, entry);
        return this.emit(feedId, entry);
      }
      try {
        const entry: CachedState = { state: validate(JSON.parse(text), feedId), writable: true };
        this.cache.set(feedId, entry);
        return this.emit(feedId, entry);
      } catch (cause) {
        const entry: CachedState = {
          state: clone(fallback),
          writable: false,
          error: { path, message: `Invalid read-state: ${cause instanceof Error ? cause.message : String(cause)}`, cause },
        };
        this.cache.set(feedId, entry);
        return this.emit(feedId, entry);
      }
    });
  }

  async markRead(feedId: string, articleId: string): Promise<ReadStateResult> {
    return this.update(feedId, state => {
      state.unreadIds = state.unreadIds.filter(id => id !== articleId);
      state.readIds = unique([...state.readIds, articleId]);
    });
  }

  async markUnread(feedId: string, articleId: string): Promise<ReadStateResult> {
    return this.update(feedId, state => {
      state.readIds = state.readIds.filter(id => id !== articleId);
      state.unreadIds = unique([...state.unreadIds, articleId]);
    });
  }

  async markBefore(feedId: string, cutoff: Date | string, articles: ArticleSummary[] = []): Promise<ReadStateResult> {
    const cutoffTime = this.cutoff(cutoff);
    return this.update(feedId, state => {
      const prior = state.readBefore === undefined ? Number.NEGATIVE_INFINITY : Date.parse(state.readBefore);
      if (cutoffTime <= prior) return;
      const effective = Math.max(prior, cutoffTime);
      state.readBefore = new Date(effective).toISOString();
      const known = new Map(articles.map(article => [article.id, timestamp(article)]));
      state.unreadIds = state.unreadIds.filter(id => {
        const time = known.get(id);
        return time === undefined || time >= effective;
      });
      state.readIds = state.readIds.filter(id => {
        const time = known.get(id);
        return time === undefined || time >= effective;
      });
    });
  }

  async markAllRead(
    feedId: string,
    articles: ArticleSummary[],
    now: Date | string = new Date(),
  ): Promise<ReadStateResult> {
    const cutoffTime = this.cutoff(now);
    return this.update(feedId, state => {
      const prior = state.readBefore === undefined ? Number.NEGATIVE_INFINITY : Date.parse(state.readBefore);
      const effective = Math.max(prior, cutoffTime);
      state.readBefore = new Date(effective).toISOString();
      const known = new Map(articles.map(article => [article.id, timestamp(article)]));
      const knownIds = new Set(known.keys());
      state.unreadIds = state.unreadIds.filter(id => {
        const time = known.get(id);
        return !knownIds.has(id) && (time === undefined || time >= effective);
      });
      state.readIds = unique([...state.readIds, ...knownIds]).filter(id => {
        const time = known.get(id);
        return time === undefined || time >= effective;
      });
    });
  }

  private async update(feedId: string, change: (state: FeedReadState) => void): Promise<ReadStateResult> {
    this.requireSafeFeedId(feedId);
    return this.enqueue(feedId, async () => {
      let entry = this.cache.get(feedId);
      if (!entry) {
        const loaded = await this.loadDirect(feedId);
        entry = loaded;
      }
      if (!entry.writable) return this.emit(feedId, entry);
      const next = clone(entry.state);
      change(next);
      const path = this.path(feedId);
      try {
        await this.storage.write(path, `${JSON.stringify(next, null, 2)}\n`);
      } catch (cause) {
        const result: ReadStateResult = { ok: false, state: clone(entry.state), error: { path, message: 'Could not write read-state', cause } };
        this.notify(feedId, result);
        return result;
      }
      const updated: CachedState = { state: next, writable: true };
      this.cache.set(feedId, updated);
      return this.emit(feedId, updated);
    });
  }

  private async loadDirect(feedId: string): Promise<CachedState> {
    const path = this.path(feedId);
    try {
      const text = await this.storage.read(path);
      const entry: CachedState = {
        state: text === null ? empty(feedId) : validate(JSON.parse(text), feedId),
        writable: true,
      };
      this.cache.set(feedId, entry);
      return entry;
    } catch (cause) {
      const entry: CachedState = {
        state: empty(feedId),
        writable: false,
        error: { path, message: `Could not load read-state: ${cause instanceof Error ? cause.message : String(cause)}`, cause },
      };
      this.cache.set(feedId, entry);
      return entry;
    }
  }

  private enqueue<T>(feedId: string, operation: () => Promise<T>): Promise<T> {
    const current = this.queues.get(feedId) ?? Promise.resolve();
    const result = current.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.queues.set(feedId, tail);
    void tail.finally(() => {
      if (this.queues.get(feedId) === tail) this.queues.delete(feedId);
    });
    return result;
  }

  private result(entry: CachedState): ReadStateResult {
    return entry.writable
      ? { ok: true, state: clone(entry.state) }
      : { ok: false, state: clone(entry.state), error: entry.error! };
  }

  private emit(feedId: string, entry: CachedState): ReadStateResult {
    const result = this.result(entry);
    this.notify(feedId, result);
    return result;
  }

  private notify(feedId: string, result: ReadStateResult): void {
    for (const listener of this.listeners) listener(feedId, result);
  }

  private cutoff(value: Date | string): number {
    const time = value instanceof Date ? value.getTime() : Date.parse(value);
    if (!Number.isFinite(time)) throw new Error('Cutoff must be a valid date or ISO timestamp');
    return time;
  }

  private path(feedId: string): string {
    return `${this.directory}/${feedId}.json`;
  }

  private requireSafeFeedId(feedId: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(feedId)) throw new Error(`Unsafe feed ID: ${feedId}`);
  }
}
