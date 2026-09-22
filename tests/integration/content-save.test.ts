import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { sanitizeArticleHtml } from '../../src/ui/content';
import { articleKey, renderArticleNote } from '../../src/save/markdown';

it('uses the actual shared sanitizer before Markdown conversion', () => {
  const dom = new JSDOM('<!doctype html>');
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  try {
    const source = { id: 'feed-one', title: 'Example: source', url: 'https://example.com/feeds/rss', folderIds: [] };
    const article = {
      id: 'article-one', feedId: source.id, title: '<img src=x onerror=alert(1)> ![[private]]',
      url: 'https://example.com/posts/article', firstFetchedAt: '2026-09-22T00:00:00Z',
      contentHtml: '<p>Readable <strong>text</strong></p><script>alert(1)</script><iframe src="https://bad.test"></iframe><style>body{display:none}</style><a href="javascript:alert(1)">bad</a><img src="../image.png" onerror="alert(2)"><a href="../next">next</a>',
    };
    const markdown = renderArticleNote(article, source, {
      articleKey: articleKey(source.id,article.id), articleId: article.id, feedId: source.id,
      title: article.title, sourceTitle: source.title, path: 'Articles/test.md',
      savedAt: '2026-09-22T00:00:00Z', firstFetchedAt: article.firstFetchedAt,
    }, sanitizeArticleHtml);
    const body = markdown.split('\n---\n')[1]!;
    expect(body).toContain('Readable **text**');
    expect(body).toContain('https://example.com/image.png');
    expect(body).toContain('https://example.com/next');
    expect(body).not.toMatch(/<script|<iframe|<style|<img|javascript:|!\[\[private\]\]/i);
  } finally {
    Object.assign(globalThis, { window: previousWindow, document: previousDocument });
    dom.window.close();
  }
});
