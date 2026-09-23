import type { FeedSource } from '../domain/models';
import type { ArticleCache } from '../cache';
import { parseFeedXml, type ParseFeedOptions } from './parser';
import { assertHttpUrl, type FeedTransport } from './transport';

export type FeedParser = (
  xml: string,
  options: ParseFeedOptions,
) => ReturnType<typeof parseFeedXml>;

export type FeedRefreshErrorCode =
  | 'disposed'
  | 'http'
  | 'network'
  | 'parse'
  | 'timeout';

export interface FeedRefreshSuccess {
  feedId: string;
  ok: true;
  articleCount: number;
}

export interface FeedRefreshFailure {
  feedId: string;
  ok: false;
  error: {
    code: FeedRefreshErrorCode;
    message: string;
  };
}

export type FeedRefreshResult = FeedRefreshSuccess | FeedRefreshFailure;

export interface FeedRefreshServiceOptions {
  concurrency?: number;
  timeoutMs?: number;
  now?: () => Date;
  parser?: FeedParser;
}

interface Attempt {
  timer?: number;
  active: boolean;
  controller: AbortController;
  feedId: string;
  publish: (result: FeedRefreshResult) => void;
}

export class FeedRefreshService {
  private readonly semaphore: Semaphore;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly parser: FeedParser;
  private readonly inFlight = new Map<string, Promise<FeedRefreshResult>>();
  private readonly attempts = new Set<Attempt>();
  private disposed = false;
  private readonly queued = new Map<string, { cancelled: boolean; timer: number; publish: (result: FeedRefreshResult) => void }>();

  constructor(
    private readonly transport: FeedTransport,
    private readonly cache: ArticleCache,
    options: FeedRefreshServiceOptions = {},
  ) {
    this.semaphore = new Semaphore(options.concurrency ?? 4);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.now = options.now ?? (() => new Date());
    this.parser = options.parser ?? parseFeedXml;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('timeoutMs must be positive');
    }
  }

  refreshSource(source: FeedSource): Promise<FeedRefreshResult> {
    if (this.disposed) {
      return Promise.resolve(failure(source.id, 'disposed', 'Refresh service is disposed'));
    }
    const existing = this.inFlight.get(source.id);
    if (existing) {
      return existing;
    }

    const deferred = createDeferred<FeedRefreshResult>();
    const refresh = deferred.promise;
    this.inFlight.set(source.id, refresh);
    // Queue wait is bounded too: hung non-cancellable requests must not leave
    // refreshSources (or plugin unload) waiting forever for a physical slot.
    const queued = {
      cancelled: false,
      publish: deferred.resolve,
      timer: window.setTimeout(() => {
        queued.cancelled = true;
        deferred.resolve(failure(source.id, 'timeout', `Feed queue wait exceeded ${this.timeoutMs} ms`));
      }, this.timeoutMs),
    };
    this.queued.set(source.id, queued);
    void this.semaphore
      .run(async () => {
        window.clearTimeout(queued.timer);
        this.queued.delete(source.id);
        if (!queued.cancelled) await this.runPhysicalAttempt(source, deferred.resolve);
      })
      .finally(() => {
        if (this.inFlight.get(source.id) === refresh) {
          this.inFlight.delete(source.id);
        }
      });
    return deferred.promise;
  }

  async refreshSources(
    sources: readonly FeedSource[],
  ): Promise<FeedRefreshResult[]> {
    return Promise.all(sources.map((source) => this.refreshSource(source)));
  }

  /** Invalidate late results before removing a source's local cache. */
  cancelSource(feedId: string): void {
    const queued = this.queued.get(feedId);
    if (queued) {
      queued.cancelled = true;
      window.clearTimeout(queued.timer);
      queued.publish(failure(feedId, 'disposed', 'Source was removed'));
    }
    for (const attempt of this.attempts) {
      if (attempt.feedId !== feedId) continue;
      attempt.active = false;
      attempt.controller.abort();
      window.clearTimeout(attempt.timer);
      attempt.publish(failure(feedId, 'disposed', 'Source was removed'));
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const [feedId, queued] of this.queued) {
      queued.cancelled = true;
      window.clearTimeout(queued.timer);
      queued.publish(failure(feedId, 'disposed', 'Refresh service is disposed'));
    }
    this.queued.clear();
    for (const attempt of this.attempts) {
      attempt.active = false;
      attempt.controller.abort();
      window.clearTimeout(attempt.timer);
      attempt.publish(
        failure(attempt.feedId, 'disposed', 'Refresh service is disposed'),
      );
    }
    this.attempts.clear();
  }

  private async runPhysicalAttempt(
    source: FeedSource,
    publishResult: (result: FeedRefreshResult) => void,
  ): Promise<void> {
    if (this.disposed) {
      publishResult(failure(source.id, 'disposed', 'Refresh service is disposed'));
      return;
    }
    try {
      assertHttpUrl(source.url);
    } catch (error) {
      publishResult(failure(source.id, 'network', errorMessage(error)));
      return;
    }

    let published = false;
    const publish = (result: FeedRefreshResult): void => {
      if (!published) {
        published = true;
        publishResult(result);
      }
    };
    const attempt: Attempt = {
      active: true,
      controller: new AbortController(),
      feedId: source.id,
      publish,
    };
    this.attempts.add(attempt);
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      attempt.active = false;
      attempt.controller.abort();
      window.clearTimeout(attempt.timer);
      publish(
        failure(
          source.id,
          'timeout',
          `Feed request exceeded ${this.timeoutMs} ms`,
        ),
      );
    }, this.timeoutMs);
    attempt.timer = timer;

    try {
      const result = await this.fetchParseAndStore(source, attempt);
      publish(result);
    } catch (error) {
      if (!timedOut) {
        publish(
          failure(source.id, classifyError(error), errorMessage(error)),
        );
      }
    } finally {
      attempt.active = false;
      this.attempts.delete(attempt);
      window.clearTimeout(timer);
    }
  }

  private async fetchParseAndStore(
    source: FeedSource,
    attempt: Attempt,
  ): Promise<FeedRefreshResult> {
    const response = await this.transport.fetch(source.url, attempt.controller.signal);
    if (!attempt.active || this.disposed) {
      throw new Error('Refresh result arrived after cancellation');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new HttpStatusError(response.status);
    }

    let articles;
    try {
      articles = await this.parser(response.body, {
        feedId: source.id,
        feedUrl: response.finalUrl ?? source.url,
        fetchedAt: this.now().toISOString(),
      });
    } catch (error) {
      throw new FeedParseError(error);
    }
    if (!attempt.active || this.disposed) {
      throw new Error('Refresh result arrived after cancellation');
    }
    await this.cache.upsert(source.id, articles);
    return { feedId: source.id, ok: true, articleCount: articles.length };
  }
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`Feed request returned HTTP ${status}`);
  }
}

class FeedParseError extends Error {
  constructor(cause: unknown) {
    super('Feed response could not be parsed', { cause });
  }
}

function classifyError(error: unknown): FeedRefreshErrorCode {
  if (error instanceof HttpStatusError) {
    return 'http';
  }
  if (error instanceof FeedParseError) {
    return 'parse';
  }
  return 'network';
}

function failure(
  feedId: string,
  code: FeedRefreshErrorCode,
  message: string,
): FeedRefreshFailure {
  return { feedId, ok: false, error: { code, message } };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class Semaphore {
  private active = 0;
  private readonly pending: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('concurrency must be a positive integer');
    }
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.pending.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    this.pending.shift()?.();
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((deferredResolve) => {
    resolve = deferredResolve;
  });
  return { promise, resolve };
}
