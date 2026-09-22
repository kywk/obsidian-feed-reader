import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DEFAULT_NOTE_TEMPLATES, renderProperties, renderTemplate, validateNoteTemplates, type TemplateContext } from '../../src/save/templates';
import { articleKey, renderArticleNote, renderNoteFilename } from '../../src/save/markdown';

const context: TemplateContext = { title: 'A title', feed: 'News', link: 'https://example.com/', published: '', created: '2026-09-22T02:03:04.000Z', date: '2026-09-21', content: '**Article**' };

describe('note templates', () => {
  it('still rejects missing or non-text template fields', () => {
    for (const key of ['noteFilenameTemplate', 'noteBodyTemplate', 'notePropertiesTemplate'] as const) {
      for (const value of [undefined, null, false, {}]) {
        const malformed = { ...DEFAULT_NOTE_TEMPLATES, [key]: value };
        expect(() => validateNoteTemplates(malformed as unknown as typeof DEFAULT_NOTE_TEMPLATES)).toThrow('Templates must be text');
      }
    }
  });

  it('rejects unknown variables, malformed expressions, unsupported formats and reserved properties', () => {
    for (const body of ['{{author}}', '{{title', '{{title:yaml}}', '{{created:bad}}']) {
      expect(() => validateNoteTemplates({ ...DEFAULT_NOTE_TEMPLATES, noteBodyTemplate: body })).toThrow();
    }
    for (const yaml of ['title: changed', 'date_created: changed', 'date_updated: changed', 'feed_reader_id: changed', 'tags: one\ntags: two', '- not-a-mapping', 'nested:\n  value: no']) {
      expect(() => renderProperties(yaml, context)).toThrow();
    }
    expect(() => renderTemplate('{{content}}', context, 'filename')).toThrow(/body/);
  });

  it('inserts hostile article strings as scalar values, never as YAML structure or second-pass templates', () => {
    const hostile = 'News\nfeed_reader_id: injected\n{{created}}';
    const properties = renderProperties('source: "{{feed}}"\ntags: [rss, "{{title}}"]\nreviewed: false\nscore: 3', { ...context, feed: hostile });
    expect(properties).toEqual({ source: hostile, tags: ['rss', 'A title'], reviewed: false, score: 3 });
    expect(renderTemplate('{{feed}}', { ...context, feed: '{{content}}' }, 'body')).toContain('content');
    expect(renderTemplate('{{feed}}', { ...context, feed: '{{content}}' }, 'body')).not.toContain('Article');
  });

  it('formats UTC dates and handles a missing publication date', () => {
    expect(renderTemplate('{{published:YYYY-MM-DD}} / {{created:YYYY-MM-DD HH:mm:ss}}', context, 'property')).toBe(' / 2026-09-22 02:03:04');
    expect(renderTemplate('{{date}} {{created:YYYY-MM-DDTHH:mm:ss}}', context, 'filename')).toBe('2026-09-21 2026-09-22T02:03:04');
  });

  it('uses the same rendering for preview and saves while protecting system metadata and Markdown text', () => {
    const source = { id: 'feed', title: 'News: "quoted"\nnext', url: 'https://example.com/rss', folderIds: [] };
    const article = { id: 'article', feedId: source.id, title: '<img src=x> ![[private]]', firstFetchedAt: '2026-09-21T00:00:00Z', contentHtml: '<p>Original <strong>body</strong></p>' };
    const templates = { noteFilenameTemplate: '../{{date}} {{title}}', noteBodyTemplate: '# {{title}}\n\n## My notes\n\n## Article\n{{content}}', notePropertiesTemplate: 'source: "{{feed}}"\ntags: [rss]\nstatus: inbox' };
    const filename = renderNoteFilename(article, source, context.created, templates);
    expect(filename).not.toMatch(/[\/<>]/);
    const note = { articleKey: articleKey(source.id, article.id), articleId: article.id, feedId: source.id, title: article.title, sourceTitle: source.title, path: filename, savedAt: context.created, firstFetchedAt: article.firstFetchedAt };
    const markdown = renderArticleNote(article, source, note, html => html, templates);
    const properties = parse(markdown.split('---\n')[1]!);
    expect(properties.feed_reader_id).toBe(note.articleKey);
    expect(properties.source).toBe(source.title);
    expect(properties.tags).toEqual(['rss']);
    expect(markdown).toContain('## My notes');
    expect(markdown).toContain('Original **body**');
    const body = markdown.split('\n---\n')[1]!;
    expect(body).not.toContain('![[private]]');
    expect(body).not.toContain('<img');
  });
});
