import type { FeedFolder, FeedSource, SubscriptionDocument } from '../domain/models';
import {
  emptySubscriptionDocument,
  normalizeFeedUrl,
  parseSubscriptions,
  serializeSubscriptions,
  sourceIdFromUrl,
  SubscriptionDocumentError,
  type SubscriptionFormat,
} from './codec';
import type { SubscriptionStorage } from './storage';

export type ImportMode = 'merge' | 'replace';

export interface SubscriptionSnapshot {
  document: SubscriptionDocument;
  error?: SubscriptionServiceError;
  writable: boolean;
}

export interface AddFeedInput {
  url: string;
  title: string;
  folderIds?: string[];
}

export class SubscriptionServiceError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SubscriptionServiceError';
  }
}

type Listener = (snapshot: SubscriptionSnapshot) => void;

function clone(document: SubscriptionDocument): SubscriptionDocument {
  return {
    version: 1,
    folders: document.folders.map(folder => ({ ...folder })),
    feeds: document.feeds.map(feed => ({ ...feed, folderIds: [...feed.folderIds] })),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export class SubscriptionService {
  private document = emptySubscriptionDocument();
  private error: SubscriptionServiceError | undefined;
  private writable = true;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<Listener>();
  private unwatch?: () => void;
  private started = false;
  private identities = new Map<string, string>();
  private _identityPath: string;

  constructor(
    private readonly storage: SubscriptionStorage,
    private activePath: string,
    private readonly createFolderId: () => string = () => `folder-${crypto.randomUUID()}`,
    identityPath = 'Feed Reader/state/source-ids.json',
  ) {
    this._identityPath = identityPath;
  }

  get path(): string {
    return this.activePath;
  }

  get identityPath(): string {
    return this._identityPath;
  }

  async setIdentityPath(path: string): Promise<void> {
    await this.enqueue(async () => {
      this._identityPath = path;
      try {
        await this.loadIdentities();
      } catch (error) {
        this.invalidate(error instanceof SubscriptionServiceError
          ? error
          : new SubscriptionServiceError('Could not load source identity registry', this._identityPath, error));
      }
    });
  }

  async start(): Promise<SubscriptionSnapshot> {
    await this.enqueue(async () => {
      try {
        await this.loadIdentities();
      } catch (error) {
        this.invalidate(error instanceof SubscriptionServiceError
          ? error
          : new SubscriptionServiceError('Could not load source identity registry', this.identityPath, error));
        return;
      }
      await this.reload(false);
      if (this.writable) {
        try {
          await this.persistIdentities(this.document);
        } catch (error) {
          this.invalidate(error instanceof SubscriptionServiceError
            ? error
            : new SubscriptionServiceError('Could not save source identity registry', this.identityPath, error));
        }
      }
    });
    this.started = true;
    this.beginWatching();
    return this.getSnapshot();
  }

  async setPath(path: string, identityPath?: string): Promise<SubscriptionSnapshot> {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
      throw new SubscriptionServiceError('Subscriptions path must be vault-relative', path);
    }
    await this.enqueue(async () => {
      this.unwatch?.();
      this.unwatch = undefined;
      this.activePath = path;
      if (identityPath !== undefined) {
        this._identityPath = identityPath;
        try {
          await this.loadIdentities();
        } catch (error) {
          this.invalidate(error instanceof SubscriptionServiceError
            ? error
            : new SubscriptionServiceError('Could not load source identity registry', this._identityPath, error));
          return;
        }
      }
      await this.reload(false);
      if (this.started) this.beginWatching();
    });
    return this.getSnapshot();
  }

  /** Roll back a failed settings commit without rereading a broken old file. */
  async restorePath(path: string, snapshot: SubscriptionSnapshot, identityPath?: string): Promise<void> {
    await this.enqueue(async () => {
      this.unwatch?.();
      this.unwatch = undefined;
      this.activePath = path;
      if (identityPath !== undefined) {
        this._identityPath = identityPath;
      }
      this.document = clone(snapshot.document);
      this.error = snapshot.error;
      this.writable = snapshot.writable;
      for (const feed of this.document.feeds) this.identities.set(normalizeFeedUrl(feed.url), feed.id);
      if (this.started) this.beginWatching();
      this.emit();
    });
  }

  stop(): void {
    this.unwatch?.();
    this.unwatch = undefined;
    this.started = false;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SubscriptionSnapshot {
    return { document: clone(this.document), error: this.error, writable: this.writable };
  }

  async addFeed(input: AddFeedInput): Promise<FeedSource> {
    let result!: FeedSource;
    await this.mutate(draft => {
      const url = normalizeFeedUrl(input.url);
      this.requireFolders(draft, input.folderIds ?? []);
      const existing = draft.feeds.find(feed => normalizeFeedUrl(feed.url) === url);
      if (existing) {
        existing.folderIds = unique([...existing.folderIds, ...(input.folderIds ?? [])]);
        result = { ...existing, folderIds: [...existing.folderIds] };
        return;
      }
      result = {
        id: this.identities.get(url) ?? sourceIdFromUrl(url),
        url,
        title: input.title.trim(),
        folderIds: unique(input.folderIds ?? []),
      };
      if (!result.title) throw new SubscriptionDocumentError('Feed title must not be empty');
      const conflictingId = draft.feeds.find(feed => feed.id === result.id);
      if (conflictingId) throw new SubscriptionDocumentError(`Feed ID collision: ${result.id}`);
      draft.feeds.push(result);
    });
    return result;
  }

  async updateFeed(feedId: string, patch: Partial<Pick<FeedSource, 'url' | 'title' | 'folderIds'>>): Promise<FeedSource> {
    let result!: FeedSource;
    await this.mutate(draft => {
      const feed = this.feed(draft, feedId);
      if (patch.folderIds) this.requireFolders(draft, patch.folderIds);
      if (patch.url !== undefined) {
        const url = normalizeFeedUrl(patch.url);
        if (url !== normalizeFeedUrl(feed.url)) {
          throw new SubscriptionDocumentError('Feed URL is its stable identity; unsubscribe and add the new URL instead');
        }
      }
      if (patch.title !== undefined) {
        if (!patch.title.trim()) throw new SubscriptionDocumentError('Feed title must not be empty');
        feed.title = patch.title.trim();
      }
      if (patch.folderIds) feed.folderIds = unique(patch.folderIds);
      result = { ...feed, folderIds: [...feed.folderIds] };
    });
    return result;
  }

  async unsubscribe(feedId: string): Promise<void> {
    await this.mutate(draft => {
      const index = draft.feeds.findIndex(feed => feed.id === feedId);
      if (index < 0) throw new SubscriptionDocumentError(`Unknown feed: ${feedId}`);
      draft.feeds.splice(index, 1);
    });
  }

  async createFolder(title: string): Promise<FeedFolder> {
    let result!: FeedFolder;
    await this.mutate(draft => {
      if (!title.trim()) throw new SubscriptionDocumentError('Folder title must not be empty');
      result = { id: this.createFolderId(), title: title.trim() };
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result.id) || draft.folders.some(folder => folder.id === result.id)) {
        throw new SubscriptionDocumentError(`Invalid or duplicate folder ID: ${result.id}`);
      }
      draft.folders.push(result);
    });
    return result;
  }

  async renameFolder(folderId: string, title: string): Promise<void> {
    await this.mutate(draft => {
      const folder = draft.folders.find(item => item.id === folderId);
      if (!folder) throw new SubscriptionDocumentError(`Unknown folder: ${folderId}`);
      if (!title.trim()) throw new SubscriptionDocumentError('Folder title must not be empty');
      folder.title = title.trim();
    });
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.mutate(draft => {
      const index = draft.folders.findIndex(folder => folder.id === folderId);
      if (index < 0) throw new SubscriptionDocumentError(`Unknown folder: ${folderId}`);
      draft.folders.splice(index, 1);
      for (const feed of draft.feeds) feed.folderIds = feed.folderIds.filter(id => id !== folderId);
    });
  }

  async assignFolder(feedId: string, folderId: string): Promise<void> {
    await this.mutate(draft => {
      this.requireFolders(draft, [folderId]);
      const feed = this.feed(draft, feedId);
      feed.folderIds = unique([...feed.folderIds, folderId]);
    });
  }

  async unassignFolder(feedId: string, folderId: string): Promise<void> {
    await this.mutate(draft => {
      const feed = this.feed(draft, feedId);
      feed.folderIds = feed.folderIds.filter(id => id !== folderId);
    });
  }

  async import(text: string, format: SubscriptionFormat, mode: ImportMode): Promise<SubscriptionDocument> {
    const incoming = parseSubscriptions(text, format);
    await this.mutate(draft => {
      if (format === 'opml') {
        const remap = new Map<string, string>();
        for (const folder of incoming.folders) {
          const matches = draft.folders.filter(existing => existing.title === folder.title);
          if (matches.length > 1) throw new SubscriptionDocumentError(`Ambiguous existing folder title: ${folder.title}`);
          const existing = matches[0];
          let id = existing?.id ?? folder.id;
          while ((!existing && draft.folders.some(item => item.id === id)) || [...remap.values()].includes(id)) id += '-opml';
          remap.set(folder.id, id);
        }
        for (const folder of incoming.folders) folder.id = remap.get(folder.id)!;
        for (const feed of incoming.feeds) {
          feed.folderIds = feed.folderIds.map(id => remap.get(id)!);
          feed.id = this.identities.get(feed.url) ?? feed.id;
        }
      }
      if (mode === 'replace') {
        draft.folders = incoming.folders.map(folder => ({ ...folder }));
        draft.feeds = incoming.feeds.map(feed => ({ ...feed, folderIds: [...feed.folderIds] }));
        return;
      }
      const folders = new Set(draft.folders.map(folder => folder.id));
      for (const folder of incoming.folders) {
        if (!folders.has(folder.id)) {
          draft.folders.push({ ...folder });
          folders.add(folder.id);
        }
      }
      for (const candidate of incoming.feeds) {
        const existing = draft.feeds.find(feed => normalizeFeedUrl(feed.url) === normalizeFeedUrl(candidate.url));
        if (existing) {
          existing.folderIds = unique([...existing.folderIds, ...candidate.folderIds]);
        } else {
          if (draft.feeds.some(feed => feed.id === candidate.id)) {
            throw new SubscriptionDocumentError(`Duplicate feed ID after merge: ${candidate.id}`);
          }
          draft.feeds.push({ ...candidate, folderIds: [...candidate.folderIds] });
        }
      }
    });
    return this.getSnapshot().document;
  }

  export(format: SubscriptionFormat): string {
    return serializeSubscriptions(this.document, format);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async mutate(change: (document: SubscriptionDocument) => void): Promise<void> {
    return this.enqueue(async () => {
      if (!this.writable) throw this.error ?? new SubscriptionServiceError('Subscriptions are read-only', this.path);
      const next = clone(this.document);
      change(next);
      const text = serializeSubscriptions(next, 'yaml');
      try {
        await this.persistIdentities(next);
        await this.storage.write(this.path, text);
      } catch (cause) {
        throw new SubscriptionServiceError('Could not write subscriptions', this.path, cause);
      }
      this.document = next;
      this.error = undefined;
      this.writable = true;
      this.emit();
    });
  }

  private async reload(external: boolean): Promise<void> {
    let text: string | null;
    try {
      text = await this.storage.read(this.path);
    } catch (cause) {
      this.invalidate(new SubscriptionServiceError('Could not read subscriptions', this.path, cause));
      return;
    }
    if (external && text !== null) {
      const current = this.writable ? serializeSubscriptions(this.document, 'yaml') : undefined;
      if (text === current) return;
    }
    if (text === null) {
      this.document = emptySubscriptionDocument();
      this.error = undefined;
      this.writable = true;
      this.emit();
      return;
    }
    try {
      const next = parseSubscriptions(text, 'yaml');
      await this.persistIdentities(next);
      this.document = next;
      this.error = undefined;
      this.writable = true;
      this.emit();
    } catch (cause) {
      const details = cause instanceof Error ? cause.message : String(cause);
      this.invalidate(new SubscriptionServiceError(`Invalid subscriptions: ${details}`, this.path, cause));
    }
  }

  private invalidate(error: SubscriptionServiceError): void {
    this.error = error;
    this.writable = false;
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private beginWatching(): void {
    if (!this.storage.watch || this.unwatch) return;
    this.unwatch = this.storage.watch(this.path, () => {
      void this.enqueue(() => this.reload(true));
    });
  }

  private feed(document: SubscriptionDocument, id: string): FeedSource {
    const feed = document.feeds.find(item => item.id === id);
    if (!feed) throw new SubscriptionDocumentError(`Unknown feed: ${id}`);
    return feed;
  }

  private requireFolders(document: SubscriptionDocument, ids: string[]): void {
    const known = new Set(document.folders.map(folder => folder.id));
    for (const id of ids) {
      if (!known.has(id)) throw new SubscriptionDocumentError(`Unknown folder: ${id}`);
    }
  }

  private async loadIdentities(): Promise<void> {
    let text: string | null;
    try {
      text = await this.storage.read(this.identityPath);
    } catch (cause) {
      throw new SubscriptionServiceError('Could not read source identity registry', this.identityPath, cause);
    }
    if (text === null) return;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Registry must be an object');
      const record = parsed as Record<string, unknown>;
      if (record.version !== 1 || !Array.isArray(record.sources)) throw new Error('Registry version or sources is invalid');
      for (const item of record.sources) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('Registry entry must be an object');
        const entry = item as Record<string, unknown>;
        if (typeof entry.url !== 'string' || typeof entry.id !== 'string') throw new Error('Registry entry needs url and id');
        const url = normalizeFeedUrl(entry.url);
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.id)) throw new Error(`Unsafe registry ID: ${entry.id}`);
        this.identities.set(url, entry.id);
      }
    } catch (cause) {
      throw new SubscriptionServiceError('Invalid source identity registry', this.identityPath, cause);
    }
  }

  private async persistIdentities(document: SubscriptionDocument): Promise<void> {
    const next = new Map(this.identities);
    for (const feed of document.feeds) next.set(normalizeFeedUrl(feed.url), feed.id);
    const sources = [...next.entries()]
      .map(([url, id]) => ({ url, id }))
      .sort((left, right) => left.url.localeCompare(right.url));
    const text = `${JSON.stringify({ version: 1, sources }, null, 2)}\n`;
    try {
      await this.storage.write(this.identityPath, text);
    } catch (cause) {
      throw new SubscriptionServiceError('Could not write source identity registry', this.identityPath, cause);
    }
    this.identities = next;
  }
}
