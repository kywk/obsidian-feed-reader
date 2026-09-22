import type { SubscriptionDocument, ArticleSummary } from '../../domain/models';
import type { ArticleCache } from '../../cache';
import type { ReadStateService } from '../../read-state';
import type { ReaderScopeBatchRequest } from '../views';

/** Batch scope ignores the reader's search and filter and pages metadata only. */
export async function markScopeRead(document: SubscriptionDocument, cache: Pick<ArticleCache, 'queryMetadata'>, state: Pick<ReadStateService, 'markAllRead' | 'markBefore'>, request: ReaderScopeBatchRequest): Promise<void> {
  const scope = request.scope;
  const sources = document.feeds.filter(feed => scope.kind === 'global' || (scope.kind === 'feed' ? feed.id === scope.feedId : feed.folderIds.includes(scope.folderId)));
  for (const source of sources) {
    const articles: ArticleSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await cache.queryMetadata({ feedId: source.id, limit: 500, ...(cursor ? { cursor } : {}) });
      articles.push(...page.items);
      if (page.nextCursor && page.nextCursor === cursor) throw new Error('Article cache returned a repeated cursor');
      cursor = page.nextCursor;
    } while (cursor);
    const result = request.all
      ? await state.markAllRead(source.id, articles, request.before)
      : await state.markBefore(source.id, request.before, articles);
    if (!result.ok) throw new Error(`${result.error.path}: ${result.error.message}`);
  }
}
