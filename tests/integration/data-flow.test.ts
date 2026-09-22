import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { IndexedDbArticleCache } from '../../src/cache';
import { parseFeedXml } from '../../src/feeds/parser';
import { ReadStateService, isArticleRead } from '../../src/read-state/service';
import { SubscriptionService } from '../../src/subscriptions/service';

it('subscribes, fetches, reads, restores unread exception after restart and unsubscribe/re-add', async () => {
  const files = new Map<string, string>();
  const storage = {
    read: async (path: string) => files.get(path) ?? null,
    write: async (path: string, value: string) => { files.set(path, value); },
  };
  const subscriptions = new SubscriptionService(storage, 'feeds.yaml');
  await subscriptions.start();
  const source = await subscriptions.addFeed({ url: 'https://example.com/feed', title: 'Example' });
  const cache = new IndexedDbArticleCache('integration', { databaseName: `test-${crypto.randomUUID()}` });
  const xml = '<rss version="2.0"><channel><title>Example</title><item><guid>one</guid><title>First</title><description>Hello</description></item></channel></rss>';
  const articles = await parseFeedXml(xml, { feedId: source.id, feedUrl: source.url, fetchedAt: '2026-09-01T00:00:00Z' });
  await cache.upsert(source.id, articles);
  const summary = (await cache.queryMetadata({ feedId: source.id })).items[0]!;
  const state = new ReadStateService(storage);
  expect(isArticleRead((await state.load(source.id)).state, summary)).toBe(false);
  expect((await state.markAllRead(source.id, [summary], '2026-09-02T00:00:00Z')).ok).toBe(true);
  await state.markUnread(source.id, summary.id);
  await subscriptions.unsubscribe(source.id);
  await cache.deleteSource(source.id);
  const readded = await subscriptions.addFeed({ url: source.url, title: 'Re-added' });
  expect(readded.id).toBe(source.id);
  const restarted = new ReadStateService(storage);
  expect(isArticleRead((await restarted.load(source.id)).state, summary)).toBe(false);
  await cache.upsert(source.id, articles);
  expect((await cache.getArticle(source.id, summary.id))?.contentHtml).toBe('Hello');
  cache.dispose();
  subscriptions.stop();
});
