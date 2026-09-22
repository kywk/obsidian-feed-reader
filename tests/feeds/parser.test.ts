import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseFeedXml } from '../../src/feeds';

const fixture = (name: string) =>
  readFile(new URL(`../fixtures/feeds/${name}`, import.meta.url), 'utf8');

describe('parseFeedXml', () => {
  it('parses namespaced RSS, resolves URLs, fills missing fields, and deduplicates', async () => {
    const articles = await parseFeedXml(await fixture('rss-namespaced.xml'), {
      feedId: 'rss-feed',
      feedUrl: 'https://example.com/feed.xml',
      fetchedAt: '2026-09-22T01:02:03.000Z',
    });

    expect(articles).toHaveLength(3);
    expect(articles[0]).toMatchObject({
      feedId: 'rss-feed',
      title: 'First post',
      url: 'https://example.com/blog/one?ref=feed',
      publishedAt: '2026-09-21T04:30:00.000Z',
      firstFetchedAt: '2026-09-22T01:02:03.000Z',
      contentHtml: '<p>Hello <strong>RSS</strong>.</p>',
    });
    expect(articles[1]).not.toHaveProperty('publishedAt');
    expect(articles[1]?.contentHtml).toBe('<p>Summary only.</p>');
    expect(articles[2]).toMatchObject({ title: 'Untitled', contentHtml: '' });
  });

  it('parses Atom IDs, XHTML content, relative links, and missing optional fields', async () => {
    const xml = await fixture('atom-relative.xml');
    const first = await parseFeedXml(xml, {
      feedId: 'atom-feed',
      feedUrl: 'https://fallback.test/feed',
      fetchedAt: '2026-09-22T00:00:00Z',
    });
    const second = await parseFeedXml(xml.replace('Atom body', 'Updated body'), {
      feedId: 'atom-feed',
      feedUrl: 'https://fallback.test/feed',
      fetchedAt: '2026-09-23T00:00:00Z',
    });

    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      url: 'https://example.net/articles/one',
      publishedAt: '2026-09-20T04:00:00.000Z',
    });
    expect(first[0]?.contentHtml).toContain('<p>Atom body</p>');
    expect(first[1]).not.toHaveProperty('publishedAt');
    expect(first[1]?.contentHtml).toBe('');
    expect(second[0]?.id).toBe(first[0]?.id);
  });

  it('keeps fallback identity stable when body changes but stable fields remain', async () => {
    const before = `<rss><channel><item><title>Stable</title><pubDate>2026-09-20</pubDate><description>before</description></item></channel></rss>`;
    const after = before.replace('before', 'after');
    const options = {
      feedId: 'fallback-feed',
      feedUrl: 'https://example.com/feed',
      fetchedAt: '2026-09-22T00:00:00Z',
    };
    const [first] = await parseFeedXml(before, options);
    const [second] = await parseFeedXml(after, options);
    expect(second?.id).toBe(first?.id);
  });

  it('rejects malformed XML instead of accepting a partial tree', async () => {
    await expect(
      parseFeedXml(await fixture('malformed.xml'), {
        feedId: 'broken',
        feedUrl: 'https://example.com/feed',
      }),
    ).rejects.toThrow(/could not be parsed/i);
  });
});
