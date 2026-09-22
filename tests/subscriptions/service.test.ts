import { describe, expect, it, vi } from 'vitest';
import type { SubscriptionStorage } from '../../src/subscriptions/storage';
import {
  parseSubscriptions,
  serializeSubscriptions,
  sourceIdFromUrl,
} from '../../src/subscriptions/codec';
import { SubscriptionService } from '../../src/subscriptions/service';

class MemoryStorage implements SubscriptionStorage {
  readonly files = new Map<string, string>();
  readonly listeners = new Map<string, Set<() => void>>();
  writes: string[] = [];
  failPath?: string;

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async write(path: string, contents: string): Promise<void> {
    await Promise.resolve();
    if (path === this.failPath) throw new Error('disk full');
    this.files.set(path, contents);
    this.writes.push(path);
    for (const listener of this.listeners.get(path) ?? []) listener();
  }

  watch(path: string, listener: () => void): () => void {
    const listeners = this.listeners.get(path) ?? new Set();
    listeners.add(listener);
    this.listeners.set(path, listeners);
    return () => listeners.delete(listener);
  }

  external(path: string, contents: string): void {
    this.files.set(path, contents);
    for (const listener of this.listeners.get(path) ?? []) listener();
  }
}

const sample = {
  version: 1 as const,
  folders: [
    { id: 'news', title: 'News' },
    { id: 'tech', title: 'Tech' },
  ],
  feeds: [{ id: 'custom-source', url: 'https://example.com/rss?token=a', title: 'Example', folderIds: ['news', 'tech'] }],
};

describe('subscription codecs', () => {
  it.each(['yaml', 'toml'] as const)('round trips %s', format => {
    const restored = parseSubscriptions(serializeSubscriptions(sample, format), format);
    expect(restored).toEqual(sample);
  });

  it('merges duplicate URLs without losing folder membership and keeps query distinct', () => {
    const restored = parseSubscriptions(`
version: 1
folders:
  - { id: a, title: A }
  - { id: b, title: B }
feeds:
  - { id: one, url: "https://example.com/feed?q=1", title: One, folderIds: [a] }
  - { id: two, url: "https://example.com/feed?q=1", title: Two, folderIds: [b] }
  - { id: three, url: "https://example.com/feed?q=2", title: Three, folderIds: [] }
`, 'yaml');
    expect(restored.feeds).toHaveLength(2);
    expect(restored.feeds[0]?.folderIds).toEqual(['a', 'b']);
    expect(restored.feeds[1]?.url).toContain('q=2');
  });

  it('generates a stable filename-safe ID and preserves query identity', () => {
    expect(sourceIdFromUrl('https://EXAMPLE.com/feed?a=1#fragment')).toBe(sourceIdFromUrl('https://example.com/feed?a=1'));
    expect(sourceIdFromUrl('https://example.com/feed?a=2')).not.toBe(sourceIdFromUrl('https://example.com/feed?a=1'));
    expect(sourceIdFromUrl('https://example.com/feed?a=1')).toMatch(/^feed-[a-f0-9]{16}$/);
  });
});

describe('SubscriptionService', () => {
  it('serializes concurrent UI mutations without losing either feed', async () => {
    const storage = new MemoryStorage();
    const service = new SubscriptionService(storage, 'feeds.yaml');
    await service.start();
    await Promise.all([
      service.addFeed({ url: 'https://example.com/a', title: 'A' }),
      service.addFeed({ url: 'https://example.com/b', title: 'B' }),
    ]);
    expect(service.getSnapshot().document.feeds.map(feed => feed.title)).toEqual(['A', 'B']);
    expect(parseSubscriptions(storage.files.get('feeds.yaml')!, 'yaml').feeds).toHaveLength(2);
  });

  it('applies an external revert to an older valid version instead of treating it as a stale self-write', async () => {
    const storage = new MemoryStorage();
    const service = new SubscriptionService(storage, 'feeds.yaml');
    await service.start();
    await service.addFeed({ url: 'https://example.com/a', title: 'A' });
    const older = storage.files.get('feeds.yaml')!;
    await service.addFeed({ url: 'https://example.com/b', title: 'B' });
    storage.external('feeds.yaml', older);
    await vi.waitFor(() => expect(service.getSnapshot().document.feeds).toHaveLength(1));
    expect(service.getSnapshot().document.feeds[0]?.title).toBe('A');
  });

  it('keeps last-good state and blocks writes while an external file is invalid', async () => {
    const storage = new MemoryStorage();
    storage.files.set('feeds.yaml', serializeSubscriptions(sample, 'yaml'));
    const service = new SubscriptionService(storage, 'feeds.yaml');
    await service.start();
    storage.external('feeds.yaml', 'version: [broken');
    await vi.waitFor(() => expect(service.getSnapshot().writable).toBe(false));
    expect(service.getSnapshot().document).toEqual(sample);
    await expect(service.addFeed({ url: 'https://example.com/no', title: 'No' })).rejects.toThrow(/Invalid subscriptions/);

    storage.external('feeds.yaml', serializeSubscriptions({ version: 1, folders: [], feeds: [] }, 'yaml'));
    await vi.waitFor(() => expect(service.getSnapshot().writable).toBe(true));
    expect(service.getSnapshot().document.feeds).toEqual([]);
  });

  it('retains imported custom IDs across unsubscribe and a service restart', async () => {
    const storage = new MemoryStorage();
    storage.files.set('feeds.yaml', serializeSubscriptions(sample, 'yaml'));
    const first = new SubscriptionService(storage, 'feeds.yaml');
    await first.start();
    await first.unsubscribe('custom-source');
    first.stop();

    const restarted = new SubscriptionService(storage, 'feeds.yaml');
    await restarted.start();
    const source = await restarted.addFeed({ url: sample.feeds[0]!.url, title: 'Back' });
    expect(source.id).toBe('custom-source');
  });

  it('merges by URL while preserving the existing ID, then supports explicit replacement', async () => {
    const storage = new MemoryStorage();
    storage.files.set('feeds.yaml', serializeSubscriptions(sample, 'yaml'));
    const service = new SubscriptionService(storage, 'feeds.yaml');
    await service.start();
    const incoming = {
      version: 1 as const,
      folders: [{ id: 'other', title: 'Other' }],
      feeds: [{ id: 'incoming-id', url: sample.feeds[0]!.url, title: 'Incoming', folderIds: ['other'] }],
    };
    await service.import(serializeSubscriptions(incoming, 'toml'), 'toml', 'merge');
    expect(service.getSnapshot().document.feeds[0]).toMatchObject({
      id: 'custom-source',
      folderIds: ['news', 'tech', 'other'],
    });
    await service.import(serializeSubscriptions(incoming, 'yaml'), 'yaml', 'replace');
    expect(service.getSnapshot().document).toEqual(incoming);
  });

  it('switches configured paths and freezes on a broken target without overwriting it', async () => {
    const storage = new MemoryStorage();
    storage.files.set('one.yaml', serializeSubscriptions(sample, 'yaml'));
    storage.files.set('broken.yaml', 'version: nope');
    const service = new SubscriptionService(storage, 'one.yaml');
    await service.start();
    const snapshot = await service.setPath('broken.yaml');
    expect(snapshot.writable).toBe(false);
    expect(snapshot.document).toEqual(sample);
    expect(storage.files.get('broken.yaml')).toBe('version: nope');
  });

  it('keeps URL identity immutable while allowing title and folder edits', async () => {
    const storage = new MemoryStorage();
    const service = new SubscriptionService(storage, 'feeds.yaml', () => 'folder-one');
    await service.start();
    const folder = await service.createFolder('Folder');
    const source = await service.addFeed({ url: 'https://example.com/feed', title: 'Before' });
    await service.updateFeed(source.id, { title: 'After', folderIds: [folder.id] });
    await expect(service.updateFeed(source.id, { url: 'https://example.com/other' })).rejects.toThrow(/stable identity/);
    expect(service.getSnapshot().document.feeds[0]).toMatchObject({ title: 'After', folderIds: ['folder-one'] });
  });

  it('does not commit in-memory subscription state when the YAML write fails', async () => {
    const storage = new MemoryStorage();
    const service = new SubscriptionService(storage, 'feeds.yaml');
    await service.start();
    storage.failPath = 'feeds.yaml';
    await expect(service.addFeed({ url: 'https://example.com/fail', title: 'Fail' })).rejects.toThrow(/write subscriptions/);
    expect(service.getSnapshot().document.feeds).toEqual([]);
  });
});

it('restores the old last-good snapshot after a settings commit fails while old YAML is broken', async () => {
  const storage = new MemoryStorage();
  storage.files.set('old.yaml', serializeSubscriptions(sample, 'yaml'));
  const service = new SubscriptionService(storage, 'old.yaml');
  await service.start();
  storage.external('old.yaml', 'feeds: [');
  await vi.waitFor(() => expect(service.getSnapshot().writable).toBe(false));
  const oldSnapshot = service.getSnapshot();
  const replacement = { version: 1 as const, folders: [], feeds: [] };
  storage.files.set('next.yaml', serializeSubscriptions(replacement, 'yaml'));
  await service.setPath('next.yaml');
  // Simulates saveData rejecting after the new path was successfully read.
  await service.restorePath('old.yaml', oldSnapshot);
  expect(service.path).toBe('old.yaml');
  expect(service.getSnapshot().document).toEqual(sample);
  expect(service.getSnapshot().writable).toBe(false);
  expect(storage.files.get('old.yaml')).toBe('feeds: [');
  storage.external('old.yaml', serializeSubscriptions(sample, 'yaml'));
  await vi.waitFor(() => expect(service.getSnapshot().writable).toBe(true));
  service.stop();
});
