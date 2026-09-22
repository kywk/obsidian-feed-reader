import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchArticle, type ArticleFetchResponse } from '../../src/enrichment/fetch';

let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM('<!doctype html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('DOMParser', dom.window.DOMParser);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); dom.window.close(); });
const paragraph = 'This is an informative article about gardens, describing plants and how they grow with light and water. '.repeat(8);
function response(extra: Partial<ArticleFetchResponse> = {}): ArticleFetchResponse {
  return { status: 200, text: `<html><head><title>Gardens</title></head><body><article><h1>Gardens</h1><p>${paragraph}</p></article></body></html>`, headers: { 'Content-Type': 'text/html; charset=utf-8' }, ...extra };
}

it('extracts article content and uses shared sanitization with the final article URL', async () => {
  const html = `<html><head><title>Gardens</title><base href="https://evil.test/"></head><body><nav>Navigation</nav><article><p>${paragraph}</p><p><a href="../next">Next</a><img src="../image.png" onerror="danger()"><a href="javascript:danger()">bad</a></p><script>danger()</script><iframe src="https://evil.test"></iframe></article></body></html>`;
  const result = await fetchArticle('https://example.com/start', async () => response({ text: html, finalUrl: 'https://example.com/posts/story' }));
  expect(result.title).toBe('Gardens');
  expect(result.markdown).toContain('https://example.com/next');
  expect(result.markdown).toContain('https://example.com/image.png');
  expect(result.markdown).not.toMatch(/javascript:|danger\(|evil\.test|Navigation/);
});

it.each(['file:///tmp/a', 'javascript:alert(1)', 'https://user:secret@example.com', 'bad'])('rejects invalid article URL %s before requesting', async url => {
  const transport = vi.fn();
  await expect(fetchArticle(url, transport)).rejects.toThrow('Article URL');
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  [response({ status: 403 }), 'HTTP 403'],
  [response({ headers: { 'content-type': 'application/pdf' } }), 'not HTML'],
  [response({ text: '' }), 'empty'],
  [response({ text: '<html><body></body></html>' }), 'No readable'],
  [response({ text: '<html><head><title>Sign in</title></head><body><p>Please log in</p></body></html>' }), 'requires login'],
] as const)('rejects unsuitable responses', async (value, message) => {
  await expect(fetchArticle('https://example.com', async () => value)).rejects.toThrow(message);
});

it('measures response size in UTF-8 bytes', async () => {
  await expect(fetchArticle('https://example.com', async () => response({ text: '繁'.repeat(50) }), { maxBytes: 100 })).rejects.toThrow('size limit');
});

it('times out even if the underlying transport ignores cancellation', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const pending = fetchArticle('https://example.com', async (_url, value) => { signal = value; return new Promise(() => {}); }, { timeoutMs: 10 });
  const check = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(10);
  await check;
  expect(signal?.aborted).toBe(true);
});

it('cancels immediately and discards a late transport result', async () => {
  const controller = new AbortController();
  let resolve!: (value: ArticleFetchResponse) => void;
  const pending = fetchArticle('https://example.com', () => new Promise(done => { resolve = done; }), { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow('cancelled');
  resolve(response());
});
