import { describe, expect, it, vi } from 'vitest';
import { markScopeRead } from '../../src/ui/manage/batch';
import { ReadStateService, isArticleRead } from '../../src/read-state/service';
import type { ArticleSummary, SubscriptionDocument } from '../../src/domain/models';

const document: SubscriptionDocument = { version: 1, folders: [{ id: 'folder', title: 'Folder' }], feeds: [
  { id: 'one', title: 'One', url: 'https://example.com/1', folderIds: ['folder'] },
  { id: 'two', title: 'Two', url: 'https://example.com/2', folderIds: [] },
] };
const article = (id: string, time: string, feedId = 'one'): ArticleSummary => ({ id, feedId, title: id, firstFetchedAt: time });
function stateService() {
  const files = new Map<string, string>();
  return new ReadStateService({ read: async path => files.get(path) ?? null, write: async (path, text) => { files.set(path, text); } });
}

describe('reader batch integration', () => {
  it('pages the complete folder scope and keeps strict cutoff boundaries and newer unread overrides', async () => {
    const state = stateService();
    const cutoff = new Date('2026-09-22T00:00:00Z');
    const old = article('old', '2026-09-21T23:59:59Z');
    const boundary = article('boundary', cutoff.toISOString());
    const next = article('next', '2026-09-23T00:00:00Z');
    await state.markUnread('one', old.id); await state.markUnread('one', next.id);
    const queryMetadata = vi.fn().mockResolvedValueOnce({ items: [old], nextCursor: 'page2' }).mockResolvedValueOnce({ items: [boundary, next] });
    await markScopeRead(document, { queryMetadata }, state, { scope: { kind: 'folder', folderId: 'folder', filter: 'unread' }, before: cutoff });
    expect(queryMetadata.mock.calls).toEqual([[{ feedId: 'one', limit: 500 }], [{ feedId: 'one', limit: 500, cursor: 'page2' }]]);
    const result = await state.load('one');
    expect(isArticleRead(result.state, old)).toBe(true);
    expect(isArticleRead(result.state, boundary)).toBe(false);
    expect(isArticleRead(result.state, next)).toBe(false);
    expect((await state.load('two')).state.readBefore).toBeUndefined();
  });
  it('global mark all includes same-time and future cached articles across every source', async () => {
    const state = stateService();
    const now = new Date('2026-09-22T00:00:00Z');
    const future = article('future', '2026-09-23T00:00:00Z');
    const same = article('same', now.toISOString(), 'two');
    const queryMetadata = vi.fn(async ({ feedId }: { feedId?: string }) => ({ items: feedId === 'one' ? [future] : [same] }));
    await markScopeRead(document, { queryMetadata }, state, { scope: { kind: 'global', filter: 'today' }, before: now, all: true });
    expect(isArticleRead((await state.load('one')).state, future)).toBe(true);
    expect(isArticleRead((await state.load('two')).state, same)).toBe(true);
    expect(queryMetadata).toHaveBeenCalledTimes(2);
  });
  it('surfaces persistence failure instead of reporting a successful batch', async () => {
    const state = new ReadStateService({ read: async () => null, write: async () => { throw new Error('Disk full'); } });
    await expect(markScopeRead(document, { queryMetadata: async () => ({ items: [] }) }, state, { scope: { kind: 'feed', feedId: 'one', filter: 'all' }, before: new Date(), all: true })).rejects.toThrow('Could not write read-state');
  });
});
