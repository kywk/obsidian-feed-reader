// Shared data shapes for MVP implementation; these are not storage services.
export interface FeedSource {
  id: string;
  url: string;
  title: string;
  folderIds: string[];
}

export interface FeedFolder {
  id: string;
  title: string;
}

export interface SubscriptionDocument {
  version: 1;
  folders: FeedFolder[];
  feeds: FeedSource[];
}

export interface ArticleSummary {
  id: string;
  feedId: string;
  title: string;
  url?: string;
  publishedAt?: string;
  firstFetchedAt: string;
  author?: string;
  snippet?: string;
  imageUrl?: string;
}

export interface Article extends ArticleSummary {
  contentHtml: string;
}

export interface FeedReadState {
  version: 1;
  feedId: string;
  readBefore?: string;
  readIds: string[];
  unreadIds: string[];
}

export type ArticleFilter = 'all' | 'read' | 'unread' | 'today' | 'saved' | 'favorite' | 'readLater';
export type ListFilter = Exclude<ArticleFilter, 'saved' | 'favorite' | 'readLater'>;

export interface StoredArticleItem extends ArticleSummary {
  contentHtml?: string;
  addedAt: string;
}

export interface StoredArticleDocument {
  version: 1;
  items: StoredArticleItem[];
}
