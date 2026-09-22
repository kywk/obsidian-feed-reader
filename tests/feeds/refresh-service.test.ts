import { describe, expect, it, vi } from 'vitest';
import type { Article } from '../../src/domain/models';
import type { ArticleCache, MetadataPage, QueryMetadataOptions } from '../../src/cache';
import {
  FeedRefreshService,
  type FeedParser,
  type FeedTransport,
  type FeedTransportResponse,
} from '../../src/feeds';

class RecordingCache implements ArticleCache {
  readonly articles = new Map<string, Article>();
  upsertCalls = 0;

  queryMetadata(_options: QueryMetadataOptions): Promise<MetadataPage> {
    return Promise.resolve({ items: [] });
  }

  getArticle(_feedId: string, articleId: string): Promise<Article | undefined> {
    return Promise.resolve(this.articles.get(articleId));
  }

  async upsert(_feedId: string, articles: readonly Article[]): Promise<void> {
    this.upsertCalls += 1;
    for (const article of articles) {
      this.articles.set(article.id, article);
    }
  }

  async deleteSource(): Promise<void> {}
  dispose(): void {}
}

const source = (id: string) => ({
  id,
  url: `https://example.com/${id}.xml`,
  title: id,
  folderIds: [],
});

const emptyParser: FeedParser = async () => [];

describe('FeedRefreshService', () => {
  it('isolates per-source errors and leaves existing cache untouched', async () => {
    const cache = new RecordingCache();
    cache.articles.set('existing', {
      id: 'existing',
      feedId: 'bad',
      title: 'Existing',
      firstFetchedAt: '2026-09-01T00:00:00Z',
      contentHtml: 'keep',
    });
    const transport: FeedTransport = {
      async fetch(url) {
        return url.includes('bad')
          ? { status: 503, body: '' }
          : { status: 200, body: '<rss><channel /></rss>' };
      },
    };
    const service = new FeedRefreshService(transport, cache, {
      parser: emptyParser,
    });

    const results = await service.refreshSources([source('bad'), source('good')]);
    expect(results).toEqual([
      expect.objectContaining({ feedId: 'bad', ok: false }),
      { feedId: 'good', ok: true, articleCount: 0 },
    ]);
    expect(cache.articles.get('existing')?.contentHtml).toBe('keep');
    expect(cache.upsertCalls).toBe(1);
    service.dispose();
  });

  it('deduplicates a source while it is in flight', async () => {
    let resolve!: (response: FeedTransportResponse) => void;
    const response = new Promise<FeedTransportResponse>((done) => {
      resolve = done;
    });
    const transport: FeedTransport = { fetch: vi.fn(() => response) };
    const service = new FeedRefreshService(transport, new RecordingCache(), {
      parser: emptyParser,
      timeoutMs: 1_000,
    });

    const first = service.refreshSource(source('same'));
    const second = service.refreshSource(source('same'));
    await vi.waitFor(() => expect(transport.fetch).toHaveBeenCalledTimes(1));
    resolve({ status: 200, body: '<rss><channel /></rss>' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { feedId: 'same', ok: true, articleCount: 0 },
      { feedId: 'same', ok: true, articleCount: 0 },
    ]);
    service.dispose();
  });

  it('keeps an ignoring transport physically guarded after timeout and discards its late result', async () => {
    let resolve!: (response: FeedTransportResponse) => void;
    const hung = new Promise<FeedTransportResponse>((done) => {
      resolve = done;
    });
    const transport: FeedTransport = { fetch: vi.fn(() => hung) };
    const cache = new RecordingCache();
    const service = new FeedRefreshService(transport, cache, {
      parser: emptyParser,
      timeoutMs: 10,
      concurrency: 1,
    });

    const first = await service.refreshSource(source('hung'));
    const repeated = await service.refreshSource(source('hung'));
    expect(first).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(repeated).toEqual(first);
    expect(transport.fetch).toHaveBeenCalledTimes(1);

    resolve({ status: 200, body: '<rss><channel /></rss>' });
    await vi.waitFor(() => expect(cache.upsertCalls).toBe(0));
    await new Promise((done) => setTimeout(done, 0));
    service.dispose();
  });

  it('enforces the configured physical request concurrency', async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const transport: FeedTransport = {
      async fetch() {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return { status: 200, body: '<rss><channel /></rss>' };
      },
    };
    const service = new FeedRefreshService(transport, new RecordingCache(), {
      parser: emptyParser,
      concurrency: 2,
      timeoutMs: 1_000,
    });
    const refresh = service.refreshSources([source('a'), source('b'), source('c')]);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());

    await expect(refresh).resolves.toHaveLength(3);
    expect(maximum).toBe(2);
    service.dispose();
  });
});

it('bounds queue wait when all physical slots hang and settles pending calls on unload', async () => {
  const transport: FeedTransport = { fetch: vi.fn(() => new Promise<FeedTransportResponse>(() => {})) };
  const service = new FeedRefreshService(transport, new RecordingCache(), { concurrency: 1, timeoutMs: 10 });
  const results = await service.refreshSources([source('hung'), source('queued')]);
  expect(results.every(result => !result.ok && result.error.code === 'timeout')).toBe(true);
  expect(transport.fetch).toHaveBeenCalledTimes(1);
  const pending = service.refreshSource(source('another-queued'));
  service.dispose();
  await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } });
});

it('does not repopulate an unsubscribed source when its request returns late', async () => {
  let finish!: (response: FeedTransportResponse) => void;
  const transport: FeedTransport = { fetch: vi.fn(() => new Promise<FeedTransportResponse>(resolve => { finish = resolve; })) };
  const cache = new RecordingCache();
  const service = new FeedRefreshService(transport, cache, { parser: emptyParser });
  const pending = service.refreshSource(source('removed'));
  await vi.waitFor(() => expect(transport.fetch).toHaveBeenCalledTimes(1));
  service.cancelSource('removed');
  await expect(pending).resolves.toMatchObject({ ok: false });
  finish({ status: 200, body: '' });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(cache.upsertCalls).toBe(0);
  service.dispose();
});

it('clears physical-request and queue timers on unload even if transport never settles', async () => {
  vi.useFakeTimers();
  try {
    const service = new FeedRefreshService({ fetch: () => new Promise<FeedTransportResponse>(() => {}) }, new RecordingCache(), { concurrency: 1 });
    const requests = service.refreshSources([source('active'), source('waiting')]);
    await Promise.resolve();
    service.dispose();
    await requests;
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
