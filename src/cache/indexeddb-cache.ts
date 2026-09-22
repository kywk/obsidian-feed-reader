import type { Article, ArticleSummary } from '../domain/models';
import type {
  ArticleCache,
  MetadataCursor,
  MetadataPage,
  QueryMetadataOptions,
} from './types';

const DEFAULT_DATABASE_NAME = 'obsidian-feed-reader-cache';
const DATABASE_VERSION = 2;
const METADATA_STORE = 'article-metadata';
const CONTENT_STORE = 'article-content';
const BY_FEED = 'by-vault-feed';
const BY_FEED_TIME = 'by-vault-feed-time';
const BY_VAULT_TIME = 'by-vault-time';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
const MAX_ARTICLES_PER_FEED = 500;

type CacheKey = [string, string, string];

interface MetadataRecord extends ArticleSummary {
  vaultId: string;
  sortTimestamp: string;
}

interface ContentRecord {
  vaultId: string;
  feedId: string;
  articleId: string;
  contentHtml: string;
}

export interface IndexedDbArticleCacheOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
}

export class IndexedDbArticleCache implements ArticleCache {
  private readonly databasePromise: Promise<IDBDatabase>;
  private disposed = false;

  constructor(
    private readonly vaultId: string,
    options: IndexedDbArticleCacheOptions = {},
  ) {
    if (!vaultId) {
      throw new Error('vaultId must not be empty');
    }

    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) {
      throw new Error('IndexedDB is unavailable');
    }

    this.databasePromise = openDatabase(
      factory,
      options.databaseName ?? DEFAULT_DATABASE_NAME,
    ).then((database) => {
      if (this.disposed) {
        database.close();
        throw new Error('Article cache is disposed');
      }
      return database;
    });
  }

  async queryMetadata(options: QueryMetadataOptions): Promise<MetadataPage> {
    this.assertActive();
    if (options.feedId && options.feedIds) {
      throw new Error('Use either feedId or feedIds, not both');
    }
    const selectedFeedIds = options.feedIds
      ? new Set(options.feedIds)
      : undefined;
    if (selectedFeedIds?.size === 0) {
      return { items: [] };
    }
    const limit = Math.min(
      Math.max(1, Math.trunc(options.limit ?? DEFAULT_PAGE_SIZE)),
      MAX_PAGE_SIZE,
    );
    const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
    const database = await this.databasePromise;
    this.assertActive();
    const transaction = database.transaction(METADATA_STORE, 'readonly');
    const completed = transactionComplete(transaction);
    const singleFeedId = options.feedId ??
      (selectedFeedIds?.size === 1 ? [...selectedFeedIds][0] : undefined);
    const index = transaction
      .objectStore(METADATA_STORE)
      .index(singleFeedId ? BY_FEED_TIME : BY_VAULT_TIME);
    const lower: IDBValidKey = singleFeedId
      ? [this.vaultId, singleFeedId, '', '']
      : [this.vaultId, '', '', ''];
    const upper: IDBValidKey = singleFeedId
      ? cursor
        ? [this.vaultId, singleFeedId, cursor.sortTimestamp, cursor.articleId]
        : [this.vaultId, singleFeedId, '\uffff', '\uffff']
      : cursor
        ? [
            this.vaultId,
            cursor.sortTimestamp,
            cursor.articleId,
            cursor.feedId ?? '\uffff',
          ]
        : [this.vaultId, '\uffff', '\uffff', '\uffff'];
    const range = IDBKeyRange.bound(lower, upper, false, Boolean(cursor));
    const records = await collectCursor<MetadataRecord>(
      index.openCursor(range, 'prev'),
      limit + 1,
      selectedFeedIds
        ? (record) => selectedFeedIds.has(record.feedId)
        : undefined,
    );
    await completed;

    const hasMore = records.length > limit;
    const pageRecords = records.slice(0, limit);
    const items = pageRecords.map(toSummary);
    const last = pageRecords.at(-1);
    return {
      items,
      ...(hasMore && last
        ? {
            nextCursor: encodeCursor({
              sortTimestamp: last.sortTimestamp,
              articleId: last.id,
              ...(!singleFeedId ? { feedId: last.feedId } : {}),
            }),
          }
        : {}),
    };
  }

  async getArticle(
    feedId: string,
    articleId: string,
  ): Promise<Article | undefined> {
    this.assertActive();
    const database = await this.databasePromise;
    this.assertActive();
    const transaction = database.transaction(
      [METADATA_STORE, CONTENT_STORE],
      'readonly',
    );
    const completed = transactionComplete(transaction);
    const key: CacheKey = [this.vaultId, feedId, articleId];
    const metadataRequest = transaction
      .objectStore(METADATA_STORE)
      .get(key) as IDBRequest<MetadataRecord | undefined>;
    const contentRequest = transaction
      .objectStore(CONTENT_STORE)
      .get(key) as IDBRequest<ContentRecord | undefined>;
    const [metadata, content] = await Promise.all([
      requestResult(metadataRequest),
      requestResult(contentRequest),
    ]);
    await completed;

    if (!metadata || !content) {
      return undefined;
    }
    return { ...toSummary(metadata), contentHtml: content.contentHtml };
  }

  async upsert(feedId: string, articles: readonly Article[]): Promise<void> {
    this.assertActive();
    if (articles.length === 0) {
      return;
    }
    for (const article of articles) {
      if (article.feedId !== feedId) {
        throw new Error(
          `Article ${article.id} belongs to ${article.feedId}, not ${feedId}`,
        );
      }
    }

    const uniqueArticles = [...new Map(articles.map((article) => [article.id, article])).values()];
    const database = await this.databasePromise;
    this.assertActive();
    const transaction = database.transaction(
      [METADATA_STORE, CONTENT_STORE],
      'readwrite',
    );
    const completed = transactionComplete(transaction);
    const metadataStore = transaction.objectStore(METADATA_STORE);
    const contentStore = transaction.objectStore(CONTENT_STORE);

    const existingRecords = await Promise.all(
      uniqueArticles.map((article) =>
        requestResult<MetadataRecord | undefined>(
          metadataStore.get([
            this.vaultId,
            feedId,
            article.id,
          ]) as IDBRequest<MetadataRecord | undefined>,
        ),
      ),
    );

    uniqueArticles.forEach((article, index) => {
      const existing = existingRecords[index];
      const firstFetchedAt = existing?.firstFetchedAt ?? article.firstFetchedAt;
      const metadata: MetadataRecord = {
        vaultId: this.vaultId,
        feedId,
        id: article.id,
        title: article.title,
        ...(article.url ? { url: article.url } : {}),
        ...(article.publishedAt ? { publishedAt: article.publishedAt } : {}),
        firstFetchedAt,
        sortTimestamp: effectiveTimestamp(article.publishedAt, firstFetchedAt),
      };
      const content: ContentRecord = {
        vaultId: this.vaultId,
        feedId,
        articleId: article.id,
        contentHtml: article.contentHtml,
      };
      metadataStore.put(metadata);
      contentStore.put(content);
    });

    await evictOldest(
      metadataStore.index(BY_FEED_TIME),
      contentStore,
      this.vaultId,
      feedId,
    );
    await completed;
  }

  async deleteSource(feedId: string): Promise<void> {
    this.assertActive();
    const database = await this.databasePromise;
    this.assertActive();
    const transaction = database.transaction(
      [METADATA_STORE, CONTENT_STORE],
      'readwrite',
    );
    const completed = transactionComplete(transaction);
    const metadataStore = transaction.objectStore(METADATA_STORE);
    const contentStore = transaction.objectStore(CONTENT_STORE);
    const range = IDBKeyRange.only([this.vaultId, feedId]);

    await walkCursor<MetadataRecord>(
      metadataStore.index(BY_FEED).openCursor(range),
      (cursor, record) => {
        cursor.delete();
        contentStore.delete([this.vaultId, feedId, record.id]);
      },
    );
    await completed;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    void this.databasePromise.then(
      (database) => database.close(),
      () => undefined,
    );
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Article cache is disposed');
    }
  }
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const metadata = database.objectStoreNames.contains(METADATA_STORE)
        ? request.transaction!.objectStore(METADATA_STORE)
        : database.createObjectStore(METADATA_STORE, {
            keyPath: ['vaultId', 'feedId', 'id'],
          });
      if (!metadata.indexNames.contains(BY_FEED)) {
        metadata.createIndex(BY_FEED, ['vaultId', 'feedId']);
      }
      if (!metadata.indexNames.contains(BY_FEED_TIME)) {
        metadata.createIndex(BY_FEED_TIME, [
          'vaultId',
          'feedId',
          'sortTimestamp',
          'id',
        ]);
      }
      if (!metadata.indexNames.contains(BY_VAULT_TIME)) {
        metadata.createIndex(BY_VAULT_TIME, [
          'vaultId',
          'sortTimestamp',
          'id',
          'feedId',
        ]);
      }
      if (!database.objectStoreNames.contains(CONTENT_STORE)) {
        database.createObjectStore(CONTENT_STORE, {
          keyPath: ['vaultId', 'feedId', 'articleId'],
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked'));
  });
}

function effectiveTimestamp(
  publishedAt: string | undefined,
  firstFetchedAt: string,
): string {
  if (publishedAt && Number.isFinite(Date.parse(publishedAt))) {
    return new Date(publishedAt).toISOString();
  }
  if (Number.isFinite(Date.parse(firstFetchedAt))) {
    return new Date(firstFetchedAt).toISOString();
  }
  return new Date(0).toISOString();
}

function toSummary(record: MetadataRecord): ArticleSummary {
  return {
    id: record.id,
    feedId: record.feedId,
    title: record.title,
    ...(record.url ? { url: record.url } : {}),
    ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}),
    firstFetchedAt: record.firstFetchedAt,
  };
}

function encodeCursor(cursor: MetadataCursor): string {
  return encodeURIComponent(JSON.stringify(cursor));
}

function decodeCursor(value: string): MetadataCursor {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<MetadataCursor>;
    if (
      typeof parsed.sortTimestamp !== 'string' ||
      typeof parsed.articleId !== 'string'
    ) {
      throw new Error('Cursor fields are invalid');
    }
    return {
      sortTimestamp: parsed.sortTimestamp,
      articleId: parsed.articleId,
      ...(typeof parsed.feedId === 'string' ? { feedId: parsed.feedId } : {}),
    };
  } catch (error) {
    throw new Error('Invalid metadata cursor', { cause: error });
  }
}

async function evictOldest(
  index: IDBIndex,
  contentStore: IDBObjectStore,
  vaultId: string,
  feedId: string,
): Promise<void> {
  const range = IDBKeyRange.bound(
    [vaultId, feedId, '', ''],
    [vaultId, feedId, '\uffff', '\uffff'],
  );
  let position = 0;
  await walkCursor<MetadataRecord>(
    index.openCursor(range, 'prev'),
    (cursor, record) => {
      position += 1;
      if (position > MAX_ARTICLES_PER_FEED) {
        cursor.delete();
        contentStore.delete([vaultId, feedId, record.id]);
      }
    },
  );
}

function collectCursor<T>(
  request: IDBRequest<IDBCursorWithValue | null>,
  limit: number,
  include: (value: T) => boolean = () => true,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const records: T[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || records.length >= limit) {
        resolve(records);
        return;
      }
      const value = cursor.value as T;
      if (include(value)) {
        records.push(value);
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'));
  });
}

function walkCursor<T>(
  request: IDBRequest<IDBCursorWithValue | null>,
  visit: (cursor: IDBCursorWithValue, value: T) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      visit(cursor, cursor.value as T);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}
