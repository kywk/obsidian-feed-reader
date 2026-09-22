import { describe, expect, it, vi } from 'vitest';
import { fetchFeedTitle, parseFeedTitle } from '../../src/feeds/title';

describe('feed title detection', () => {
  it.each([
    ['<rss><channel><title>A &amp; B</title><item><title>Wrong</title></item></channel></rss>', 'A & B'],
    ['<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom title</title></feed>', 'Atom title'],
    ['<rdf:RDF xmlns:rdf="http://example.org"><channel><title>RDF title</title></channel></rdf:RDF>', 'RDF title'],
  ])('reads only the feed-level title', (xml, title) => expect(parseFeedTitle(xml)).toBe(title));
  it.each(['<html><title>Login</title></html>', '<rss><channel><item><title>Article</title></item></channel></rss>', '<rss>', '<!DOCTYPE rss><rss/>'])('rejects unsupported or missing titles', xml => expect(() => parseFeedTitle(xml)).toThrow());
  it('reports HTTP failure and rejects dangerous protocols before network access', async () => {
    const transport = { fetch: vi.fn(async () => ({ status: 403, body: 'forbidden' })) };
    await expect(fetchFeedTitle('javascript:alert(1)', transport, new AbortController().signal)).rejects.toThrow('HTTP');
    expect(transport.fetch).not.toHaveBeenCalled();
    await expect(fetchFeedTitle('https://example.test/feed', transport, new AbortController().signal)).rejects.toThrow('403');
  });
  it('times out and cancels transports that ignore cancellation', async () => {
    const transport = { fetch: vi.fn(() => new Promise<never>(() => {})) };
    await expect(fetchFeedTitle('https://example.test/feed', transport, new AbortController().signal, 5)).rejects.toThrow('timed out');
    const controller = new AbortController();
    const result = fetchFeedTitle('https://example.test/feed', transport, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow('cancelled');
  });
});
