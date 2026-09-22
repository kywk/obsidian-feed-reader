import type { Article, ArticleSummary } from '../domain/models';

export interface MetadataCursor {
  sortTimestamp: string;
  articleId: string;
  feedId?: string;
}

export interface MetadataPage {
  items: ArticleSummary[];
  nextCursor?: string;
}

export interface QueryMetadataOptions {
  feedId?: string;
  feedIds?: readonly string[];
  limit?: number;
  cursor?: string;
}

export interface ArticleCache {
  queryMetadata(options: QueryMetadataOptions): Promise<MetadataPage>;
  getArticle(feedId: string, articleId: string): Promise<Article | undefined>;
  upsert(feedId: string, articles: readonly Article[]): Promise<void>;
  deleteSource(feedId: string): Promise<void>;
  dispose(): void;
}
