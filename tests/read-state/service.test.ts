import { describe, expect, it } from 'vitest';
import type { ArticleSummary } from '../../src/domain/models';
import { isArticleRead, ReadStateService } from '../../src/read-state/service';
import type { ReadStateStorage } from '../../src/read-state/storage';

class MemoryStorage implements ReadStateStorage {
  readonly files = new Map<string, string>();
  failWrites = false;

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async write(path: string, contents: string): Promise<void> {
    if (this.failWrites) throw new Error('disk full');
    this.files.set(path, contents);
  }
}

function article(id: string, time: string, publishedAt = true): ArticleSummary {
  return {
    id,
    feedId: 'feed-one',
    title: id,
    ...(publishedAt ? { publishedAt: time } : {}),
    firstFetchedAt: publishedAt ? '2030-01-01T00:00:00.000Z' : time,
  };
}

describe('ReadStateService', () => {
  it('applies unread, individual read, strict cutoff precedence and fallback time', () => {
    const cutoff = '2026-09-22T10:00:00.000Z';
    const state = {
      version: 1 as const,
      feedId: 'feed-one',
      readBefore: cutoff,
      readIds: ['individual'],
      unreadIds: ['exception'],
    };
    expect(isArticleRead(state, article('old', '2026-09-22T09:00:00.000Z'))).toBe(true);
    expect(isArticleRead(state, article('exception', '2026-09-22T09:00:00.000Z'))).toBe(false);
    expect(isArticleRead(state, article('individual', cutoff))).toBe(true);
    expect(isArticleRead(state, article('equal', cutoff))).toBe(false);
    expect(isArticleRead(state, article('fallback', '2026-09-22T09:00:00.000Z', false))).toBe(true);
  });

  it('marks known equality-boundary articles and retains a manual unread exception across restart', async () => {
    const storage = new MemoryStorage();
    const service = new ReadStateService(storage);
    const equal = article('equal', '2026-09-22T10:00:00.000Z');
    const marked = await service.markAllRead('feed-one', [equal], equal.publishedAt!);
    expect(marked.ok).toBe(true);
    expect(isArticleRead(marked.state, equal)).toBe(true);
    const unread = await service.markUnread('feed-one', equal.id);
    expect(isArticleRead(unread.state, equal)).toBe(false);

    const restarted = new ReadStateService(storage);
    const loaded = await restarted.load('feed-one');
    expect(isArticleRead(loaded.state, equal)).toBe(false);
  });

  it('clears only exceptions covered by a newly advanced cutoff', async () => {
    const storage = new MemoryStorage();
    const service = new ReadStateService(storage);
    const old = article('old', '2026-09-20T00:00:00.000Z');
    const newer = article('newer', '2026-09-23T00:00:00.000Z');
    await service.markBefore('feed-one', '2026-09-22T00:00:00.000Z');
    await service.markUnread('feed-one', old.id);
    await service.markUnread('feed-one', newer.id);

    const earlier = await service.markBefore('feed-one', '2026-09-21T00:00:00.000Z', [old, newer]);
    expect(earlier.state.unreadIds).toEqual(['old', 'newer']);
    const advanced = await service.markBefore('feed-one', '2026-09-24T00:00:00.000Z', [old, newer]);
    expect(advanced.state.unreadIds).toEqual([]);
  });

  it('preserves unknown IDs while compacting known state', async () => {
    const storage = new MemoryStorage();
    const service = new ReadStateService(storage);
    await service.markRead('feed-one', 'unknown-read');
    await service.markUnread('feed-one', 'unknown-unread');
    const result = await service.markBefore('feed-one', '2026-09-22T00:00:00.000Z', [article('known', '2026-09-20T00:00:00.000Z')]);
    expect(result.state.readIds).toContain('unknown-read');
    expect(result.state.unreadIds).toContain('unknown-unread');
  });

  it('returns a displayable error and leaves memory unchanged on write failure', async () => {
    const storage = new MemoryStorage();
    const service = new ReadStateService(storage);
    await service.markRead('feed-one', 'already-read');
    storage.failWrites = true;
    const failed = await service.markUnread('feed-one', 'already-read');
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.message).toMatch(/write/);
    expect(failed.state.readIds).toEqual(['already-read']);
    expect(failed.state.unreadIds).toEqual([]);
  });

  it('freezes corrupt files until an explicit reload sees repaired state and emits changes', async () => {
    const storage = new MemoryStorage();
    const path = 'Feed Reader/state/feed-one.json';
    storage.files.set(path, '{broken');
    const service = new ReadStateService(storage);
    const events: boolean[] = [];
    service.subscribe((_feedId, result) => events.push(result.ok));
    expect((await service.load('feed-one')).ok).toBe(false);
    expect((await service.markRead('feed-one', 'x')).ok).toBe(false);
    storage.files.set(path, JSON.stringify({ version: 1, feedId: 'feed-one', readIds: [], unreadIds: [] }));
    expect((await service.load('feed-one', true)).ok).toBe(true);
    expect(events).toEqual([false, false, true]);
  });
});
