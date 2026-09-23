import 'fake-indexeddb/auto';
import { IDBDatabase } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Article } from '../../src/domain/models';
import { IndexedDbArticleCache } from '../../src/cache';

const caches: IndexedDbArticleCache[] = [];

afterEach(() => {
  for (const cache of caches.splice(0)) {
    cache.dispose();
  }
  vi.restoreAllMocks();
});

function makeCache(vaultId: string, databaseName: string): IndexedDbArticleCache {
  const cache = new IndexedDbArticleCache(vaultId, { databaseName });
  caches.push(cache);
  return cache;
}

function article(
  id: string,
  feedId: string,
  timestamp: string,
  overrides: Partial<Article> = {},
): Article {
  return {
    id,
    feedId,
    title: `Article ${id}`,
    publishedAt: timestamp,
    firstFetchedAt: timestamp,
    contentHtml: `<p>${id}</p>`,
    ...overrides,
  };
}

describe('IndexedDbArticleCache', () => {
  it('preserves firstFetchedAt while updating metadata and full text', async () => {
    const cache = makeCache('vault-a', `cache-first-${crypto.randomUUID()}`);
    await cache.upsert('feed-a', [
      article('one', 'feed-a', '2026-09-01T00:00:00Z'),
    ]);
    await cache.upsert('feed-a', [
      article('one', 'feed-a', '2026-09-20T00:00:00Z', {
        title: 'Updated',
        firstFetchedAt: '2026-09-20T00:00:00Z',
        contentHtml: '<p>updated</p>',
      }),
    ]);

    await expect(cache.getArticle('feed-a', 'one')).resolves.toMatchObject({
      title: 'Updated',
      firstFetchedAt: '2026-09-01T00:00:00Z',
      contentHtml: '<p>updated</p>',
    });
  });

  it('paginates globally and by selected feeds using only the metadata store', async () => {
    const cache = makeCache('vault-a', `cache-page-${crypto.randomUUID()}`);
    await cache.upsert('feed-a', [
      article('a1', 'feed-a', '2026-09-03T00:00:00Z'),
      article('a2', 'feed-a', '2026-09-01T00:00:00Z'),
    ]);
    await cache.upsert('feed-b', [
      article('b1', 'feed-b', '2026-09-02T00:00:00Z'),
    ]);

    const transactionSpy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const first = await cache.queryMetadata({ limit: 2 });
    const second = await cache.queryMetadata({ limit: 2, cursor: first.nextCursor });
    const selected = await cache.queryMetadata({ feedIds: ['feed-b'], limit: 10 });

    expect(first.items.map((item) => item.id)).toEqual(['a1', 'b1']);
    expect(second.items.map((item) => item.id)).toEqual(['a2']);
    expect(selected.items.map((item) => item.id)).toEqual(['b1']);
    expect(first.items[0]).not.toHaveProperty('contentHtml');
    expect(transactionSpy.mock.calls.every(([stores]) => stores === 'article-metadata')).toBe(true);
  });

  it('isolates vaults and deletes only one source partition', async () => {
    const databaseName = `cache-vault-${crypto.randomUUID()}`;
    const firstVault = makeCache('vault-a', databaseName);
    const secondVault = makeCache('vault-b', databaseName);
    await firstVault.upsert('shared-feed', [
      article('one', 'shared-feed', '2026-09-01T00:00:00Z'),
    ]);
    await secondVault.upsert('shared-feed', [
      article('two', 'shared-feed', '2026-09-02T00:00:00Z'),
    ]);

    await firstVault.deleteSource('shared-feed');
    await expect(firstVault.queryMetadata({ feedId: 'shared-feed' })).resolves.toMatchObject({
      items: [],
    });
    await expect(secondVault.getArticle('shared-feed', 'two')).resolves.toBeDefined();
  });

  it('retains only the newest 500 articles using firstFetchedAt when publication is absent', async () => {
    const cache = makeCache('vault-a', `cache-limit-${crypto.randomUUID()}`);
    const articles = Array.from({ length: 505 }, (_, index) => {
      const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      return article(`item-${index}`, 'feed-a', timestamp, {
        publishedAt: undefined,
      });
    });
    await cache.upsert('feed-a', articles);

    const page = await cache.queryMetadata({ feedId: 'feed-a', limit: 500 });
    expect(page.items).toHaveLength(500);
    expect(page.items[0]?.id).toBe('item-504');
    expect(page.items.at(-1)?.id).toBe('item-5');
    await expect(cache.getArticle('feed-a', 'item-4')).resolves.toBeUndefined();
  }, 20_000);
});
