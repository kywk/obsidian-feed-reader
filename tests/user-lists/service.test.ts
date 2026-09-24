import { describe, expect, it, vi } from 'vitest';
import { UserListsService } from '../../src/user-lists/service';
import type { UserListStorage } from '../../src/user-lists/storage';
import type { Article } from '../../src/domain/models';

class MemoryUserListStorage implements UserListStorage {
  files = new Map<string, string>();
  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }
  async write(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
  }
}

const sampleArticle: Article = {
  id: 'article-1',
  feedId: 'feed-1',
  title: 'Test Article 1',
  url: 'https://example.com/1',
  publishedAt: '2026-09-25T00:00:00.000Z',
  firstFetchedAt: '2026-09-25T01:00:00.000Z',
  author: 'Author 1',
  snippet: 'Snippet 1',
  contentHtml: '<p>Hello World</p>',
};

const sampleArticle2: Article = {
  id: 'article-2',
  feedId: 'feed-1',
  title: 'Test Article 2',
  url: 'https://example.com/2',
  publishedAt: '2026-09-25T02:00:00.000Z',
  firstFetchedAt: '2026-09-25T02:00:00.000Z',
  contentHtml: '<p>Second article content</p>',
};

describe('UserListsService', () => {
  it('adds, checks, and removes favorites with persistence', async () => {
    const storage = new MemoryUserListStorage();
    const service = new UserListsService(storage, 'state');
    await service.load();

    expect(service.isFavorite('feed-1', 'article-1')).toBe(false);
    expect(service.getFavorites()).toHaveLength(0);

    const added = await service.toggleFavorite(sampleArticle, sampleArticle.contentHtml);
    expect(added).toBe(true);
    expect(service.isFavorite('feed-1', 'article-1')).toBe(true);
    expect(service.getFavorites()).toHaveLength(1);
    expect(service.getFavorites()[0]!.title).toBe('Test Article 1');
    expect(service.getFavorites()[0]!.contentHtml).toBe('<p>Hello World</p>');

    // Check JSON written
    const jsonText = await storage.read('state/favorites.json');
    expect(jsonText).not.toBeNull();
    const parsed = JSON.parse(jsonText!);
    expect(parsed.version).toBe(1);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].id).toBe('article-1');

    // Toggle off
    const removed = await service.toggleFavorite(sampleArticle);
    expect(removed).toBe(false);
    expect(service.isFavorite('feed-1', 'article-1')).toBe(false);
    expect(service.getFavorites()).toHaveLength(0);

    const updatedText = await storage.read('state/favorites.json');
    const updatedParsed = JSON.parse(updatedText!);
    expect(updatedParsed.items).toHaveLength(0);
  });

  it('adds, checks, and removes read-later items with persistence', async () => {
    const storage = new MemoryUserListStorage();
    const service = new UserListsService(storage, 'state');
    await service.load();

    expect(service.isReadLater('feed-1', 'article-2')).toBe(false);
    expect(service.getReadLater()).toHaveLength(0);

    await service.addReadLater(sampleArticle2, sampleArticle2.contentHtml);
    expect(service.isReadLater('feed-1', 'article-2')).toBe(true);
    expect(service.getReadLater()).toHaveLength(1);
    expect(service.getReadLater()[0]!.contentHtml).toBe('<p>Second article content</p>');

    // Verify stored article fallback for cache miss
    const stored = service.getStoredArticle('feed-1', 'article-2');
    expect(stored?.contentHtml).toBe('<p>Second article content</p>');

    await service.removeReadLater('feed-1', 'article-2');
    expect(service.isReadLater('feed-1', 'article-2')).toBe(false);
    expect(service.getReadLater()).toHaveLength(0);
  });

  it('sorts items by addedAt descending', async () => {
    const storage = new MemoryUserListStorage();
    const service = new UserListsService(storage, 'state');
    await service.load();

    await service.addFavorite(sampleArticle);
    await new Promise(r => setTimeout(r, 5));
    // Add second article
    await service.addFavorite(sampleArticle2);

    const favorites = service.getFavorites();
    expect(favorites).toHaveLength(2);
    // Latest added should be first
    expect(favorites[0]!.id).toBe('article-2');
    expect(favorites[1]!.id).toBe('article-1');
  });

  it('notifies subscribers on change', async () => {
    const storage = new MemoryUserListStorage();
    const service = new UserListsService(storage, 'state');
    await service.load();

    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    await service.addFavorite(sampleArticle);
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    unsubscribe();
    await service.removeFavorite(sampleArticle.feedId, sampleArticle.id);
    expect(listener).not.toHaveBeenCalled();
  });

  it('gracefully recovers when json text is corrupted', async () => {
    const storage = new MemoryUserListStorage();
    await storage.write('state/favorites.json', 'INVALID JSON {{{{');

    const service = new UserListsService(storage, 'state');
    await service.load();

    expect(service.getFavorites()).toHaveLength(0);
  });
});
