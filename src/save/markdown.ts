import TurndownService from 'turndown';
import { stringify } from 'yaml';
import type { Article, FeedSource } from '../domain/models';
import type { SanitizeArticleHtml, SavedArticle } from './types';
import { DEFAULT_NOTE_TEMPLATES, renderTemplate, renderProperties, type NoteTemplates, type TemplateContext } from './templates';

const turndown = new TurndownService({
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
  headingStyle: 'atx',
});

export function articleKey(feedId: string, articleId: string): string {
  return JSON.stringify([feedId, articleId]);
}

export function safeTitle(value: string): string {
  const title = value
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#[\]^]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return (title || 'Untitled').slice(0, 96).trimEnd();
}

export function filenameDate(article: Article, savedAt: Date): string {
  for (const candidate of [article.publishedAt, article.firstFetchedAt]) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return savedAt.toISOString().slice(0, 10);
}

export function shortArticleId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function markdownText(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim() || 'Untitled';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]{}()#+\-.!|])/g, '\\$1');
}

export function renderArticleNote(
  article: Article,
  source: FeedSource,
  note: SavedArticle,
  sanitize: SanitizeArticleHtml,
  templates: NoteTemplates = DEFAULT_NOTE_TEMPLATES,
): string {
  const frontmatter: Record<string, unknown> = {
    title: article.title,
    feed_reader_id: note.articleKey,
    feed_reader_article_id: article.id,
    feed_reader_source_id: source.id,
    feed_reader_source: source.title,
    feed_reader_first_fetched_at: article.firstFetchedAt,
  };
  if (article.url) frontmatter.feed_reader_url = article.url;
  if (article.publishedAt) frontmatter.feed_reader_published_at = article.publishedAt;
  frontmatter.feed_reader_saved_at = note.savedAt;

  const cleanHtml = sanitize(article.contentHtml, source.url);
  const body = turndown.turndown(cleanHtml).trim();
  const content = body || '_This feed item did not include article content or a summary._';
  const context = noteTemplateContext(article, source, note.savedAt, content);
  Object.assign(frontmatter, renderProperties(templates.notePropertiesTemplate, context));
  const metadata = stringify(frontmatter, { lineWidth: 0 }).trimEnd();

  return `---\n${metadata}\n---\n\n${renderTemplate(templates.noteBodyTemplate, context, 'body')}\n`;
}

export function noteTemplateContext(article: Article, source: FeedSource, savedAt: string, content = ''): TemplateContext {
  return { title: article.title, feed: source.title, link: article.url ?? '', published: article.publishedAt ?? '', created: savedAt, date: filenameDate(article, new Date(savedAt)), content };
}

export function renderNoteFilename(article: Article, source: FeedSource, savedAt: string, templates: NoteTemplates = DEFAULT_NOTE_TEMPLATES): string {
  return safeTitle(renderTemplate(templates.noteFilenameTemplate, noteTemplateContext(article, source, savedAt), 'filename'));
}
