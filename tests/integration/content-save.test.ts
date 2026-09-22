import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { sanitizeArticleHtml, sanitizeArticleFragment } from '../../src/ui/content';
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

it('renders a safe fragment with the same content and URLs as saved HTML', () => {
  const dom = new JSDOM('<!doctype html>');
  const previousWindow = globalThis.window;
  Object.assign(globalThis, { window: dom.window });
  try {
    const html = '<p style="color:red" class="override">Text<strong>bold</strong></p>'
      + '<script>alert(1)</script><iframe src="https://bad.test"></iframe>'
      + '<a href="javascript:alert(1)" onclick="alert(1)">bad</a>'
      + '<a href="../next">next</a><img src="../image.png" onerror="alert(1)">'
      + '<img src="data:image/png;base64,AAAA"><a href="file:///private/file">file</a>';
    const base = 'https://example.com/feeds/rss';
    const body = dom.window.document.createElement('div');
    body.append(sanitizeArticleFragment(html, base));
    expect(body.innerHTML).toBe(sanitizeArticleHtml(html, base));
    expect(body.querySelector('script, iframe, [style], [class], [onclick], [onerror]')).toBeNull();
    expect([...body.querySelectorAll('[href], [src]')].map(el => el.getAttribute('href') ?? el.getAttribute('src')))
      .toEqual(['https://example.com/next', 'https://example.com/image.png']);
    expect(body.querySelector('strong')?.textContent).toBe('bold');
  } finally {
    Object.assign(globalThis, { window: previousWindow });
    dom.window.close();
  }
});
