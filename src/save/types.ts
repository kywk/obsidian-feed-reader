import type { Article, FeedSource } from '../domain/models';
import type { NoteTemplates } from './templates';

export type SanitizeArticleHtml = (html: string, baseUrl?: string) => string;

export interface SavedArticle {
  articleKey: string;
  articleId: string;
  feedId: string;
  title: string;
  sourceTitle: string;
  path: string;
  savedAt: string;
  firstFetchedAt: string;
  url?: string;
  publishedAt?: string;
}

export type SavedNoteChange =
  | { type: 'upsert'; note: SavedArticle }
  | { type: 'rename'; oldPath: string; newPath: string }
  | { type: 'delete'; path: string };

/**
 * The save service deliberately works against frontmatter metadata rather than
 * note contents. This keeps index recovery cheap even for a large vault.
 */
export interface SavedNoteStorage {
  exists(path: string): boolean;
  create(path: string, contents: string): Promise<void>;
  list(): SavedArticle[];
  watch(listener: (change: SavedNoteChange) => void): () => void;
}

export interface SaveArticleOptions {
  folder: string;
  sanitize: SanitizeArticleHtml;
  now?: () => Date;
  templates?: () => NoteTemplates;
}

export interface SaveArticleResult {
  created: boolean;
  note: SavedArticle;
}

export type SaveArticle = (article: Article, source: FeedSource) => Promise<SaveArticleResult>;
