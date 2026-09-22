import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ENRICHMENT } from '../../src/enrichment/config';
import { enrichNote, type EnrichmentDependencies } from '../../src/enrichment/service';

const article = '---\nsource: https://example.com/story\n---\n## 原文\nOriginal article\n## Notes\nPersonal annotation\n';
function setup(initial = article) {
  let current = initial;
  const controller = new AbortController();
  const read = vi.fn(async () => current);
  const compareAndWrite = vi.fn(async (expected: string, next: string) => {
    if (current !== expected) return false;
    current = next;
    return true;
  });
  const fetch = vi.fn(async () => 'Fetched article');
  const summarize = vi.fn(async () => JSON.stringify({ summary: 'Generated summary', tags: ['文章', '閱讀', 'AI'] }));
  const choose = vi.fn(async (): Promise<number | null> => 0);
  const review = vi.fn(async () => true);
  const deps: EnrichmentDependencies = { fetch, summarize, interaction: { choose, review } };
  return { controller, read, compareAndWrite, fetch, summarize, choose, review,
    current: () => current, edit: (next: string) => { current = next; },
    run: (action: 'fetch' | 'summarize' | 'both') => enrichNote({ read, compareAndWrite }, action, DEFAULT_ENRICHMENT, deps, controller.signal) };
}

describe('note enrichment orchestration', () => {
  it('migrates saved-note dates only after a successful content update', async () => {
    const source = article.replace('source: https://example.com/story', 'source: https://example.com/story\nfeed_reader_id: saved\nfeed_reader_saved_at: 2026-09-20T00:00:00Z\nfeed_reader_first_fetched_at: 2026-09-19T00:00:00Z');
    const failed = setup(source);
    failed.summarize.mockRejectedValue(new Error('offline'));
    await expect(failed.run('summarize')).rejects.toThrow('offline');
    expect(failed.current()).toBe(source);
    const success = setup(source);
    await success.run('summarize');
    expect(success.current()).toContain('date_created: 2026-09-20T00:00:00Z');
    expect(success.current()).toContain('date_updated:');
    expect(success.current()).not.toContain('feed_reader_saved_at:');
    expect(success.current()).not.toContain('feed_reader_first_fetched_at:');
    expect(success.current()).toContain('Personal annotation');
  });

  it('summarizes identified full text without fetching or including personal notes', async () => {
    const s = setup();
    expect(await s.run('summarize')).toBe(true);
    expect(s.fetch).not.toHaveBeenCalled();
    expect(s.summarize).toHaveBeenCalledWith('Original article', expect.stringContaining(DEFAULT_ENRICHMENT.summaryPrompt), s.controller.signal);
    expect(s.current()).toContain('Personal annotation');
    expect(s.current()).toContain('Generated summary');
    expect(s.current()).toContain('source: https://example.com/story');
    expect(s.current()).toContain('tags:');
    expect(s.current()).toContain('  - 閱讀');
  });

  it('does not partially save a summary when generated tags are invalid', async () => {
    const s = setup();
    s.summarize.mockResolvedValue(JSON.stringify({ summary: 'Summary', tags: { invalid: true } }));
    await expect(s.run('summarize')).rejects.toThrow('tags');
    expect(s.current()).toBe(article);
    expect(s.compareAndWrite).not.toHaveBeenCalled();
  });

  it('fetches and summarizes new full text, then writes the result once', async () => {
    const s = setup();
    expect(await s.run('both')).toBe(true);
    expect(s.fetch).toHaveBeenCalledWith('https://example.com/story', s.controller.signal);
    expect(s.summarize).toHaveBeenCalledWith('Fetched article', expect.stringContaining(DEFAULT_ENRICHMENT.summaryPrompt), s.controller.signal);
    expect(s.compareAndWrite).toHaveBeenCalledTimes(1);
    expect(s.current()).not.toContain('Original article');
    expect(s.current()).toContain('Personal annotation');
  });

  it('fetches missing full text in the background but writes only a summary before the unchanged body', async () => {
    const original = '---\nsource: https://example.com/story\n---\nClipped body\n## My notes\nKeep me';
    const s = setup(original);
    await s.run('summarize');
    expect(s.choose).not.toHaveBeenCalled();
    expect(s.fetch).toHaveBeenCalledOnce();
    expect(s.summarize).toHaveBeenCalledWith('Fetched article', expect.any(String), s.controller.signal);
    expect(s.current()).not.toContain('Fetched article');
    expect(s.current()).not.toContain('feed-reader:fulltext:');
    expect(s.current()).toContain('Clipped body\n## My notes\nKeep me');
    expect(s.current().indexOf('Generated summary')).toBeLessThan(s.current().indexOf('Clipped body'));
    await s.run('summarize');
    expect(s.current().match(/feed-reader:summary:start/g)).toHaveLength(1);
  });

  it('appends full text after unknown content and replaces only the managed text on rerun', async () => {
    const original = '---\nsource: https://example.com/story\n---\nOriginal clipping\n## Notes\nKeep notes';
    const s = setup(original);
    await s.run('both');
    expect(s.current()).toContain('Original clipping\n## Notes\nKeep notes');
    expect(s.current().indexOf('Generated summary')).toBeLessThan(s.current().indexOf('Original clipping'));
    expect(s.current().indexOf('Fetched article')).toBeGreaterThan(s.current().indexOf('Keep notes'));
    s.fetch.mockResolvedValue('Updated full text');
    await s.run('fetch');
    expect(s.current()).not.toContain('Fetched article');
    expect(s.current()).toContain('Updated full text');
    expect(s.current()).toContain('Original clipping\n## Notes\nKeep notes');
    expect(s.current()).toContain('Generated summary');
  });

  it('uses background fetching for an empty full-text section without filling it', async () => {
    const original = '---\nsource: https://example.com/story\n---\n## 全文\n\n## Notes\nKeep';
    const s = setup(original);
    await s.run('summarize');
    expect(s.fetch).toHaveBeenCalledOnce();
    expect(s.current()).not.toContain('Fetched article');
    expect(s.current()).toContain('## 全文\n\n## Notes\nKeep');
  });

  it('lets the user choose ambiguous sections and conflicting URLs without displaying query secrets', async () => {
    const s = setup('---\nsource: https://example.com/a?token=secret\nurl: https://example.com/b\n---\n## 原文\nFirst\n## 原文\nSecond');
    s.choose.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    await s.run('fetch');
    expect(s.choose.mock.calls[1]).toEqual(['原文網址有衝突，請選擇', ['https://example.com/a?…', 'https://example.com/b'], s.controller.signal]);
    expect(s.fetch).toHaveBeenCalledWith('https://example.com/b', s.controller.signal);
    expect(s.current()).toContain('First');
    expect(s.current()).not.toContain('Second');
    expect(s.summarize).not.toHaveBeenCalled();
  });

  it('does not fetch or write when a URL is absent or an interaction is cancelled', async () => {
    const absent = setup('## 原文\nArticle');
    await expect(absent.run('fetch')).rejects.toThrow('找不到有效原文網址');
    expect(absent.fetch).not.toHaveBeenCalled();
    expect(absent.compareAndWrite).not.toHaveBeenCalled();
    const cancelled = setup('---\nsource: https://example.com/a\nurl: https://example.com/b\n---\nUnrecognized body');
    cancelled.choose.mockResolvedValue(null);
    expect(await cancelled.run('summarize')).toBe(false);
    expect(cancelled.summarize).not.toHaveBeenCalled();
    expect(cancelled.compareAndWrite).not.toHaveBeenCalled();
  });

  it('preserves the original note if fetching or summarizing fails', async () => {
    const fetched = setup();
    fetched.fetch.mockRejectedValue(new Error('Network failure'));
    await expect(fetched.run('both')).rejects.toThrow('Network failure');
    expect(fetched.summarize).not.toHaveBeenCalled();
    expect(fetched.compareAndWrite).not.toHaveBeenCalled();
    const summarized = setup();
    summarized.summarize.mockRejectedValue(new Error('Agent failure'));
    await expect(summarized.run('both')).rejects.toThrow('Agent failure');
    expect(summarized.compareAndWrite).not.toHaveBeenCalled();
    expect(summarized.current()).toBe(article);
  });

  it('rejects empty summaries without changing the note', async () => {
    const s = setup();
    s.summarize.mockResolvedValue('  ');
    await expect(s.run('summarize')).rejects.toThrow('Agent 沒有回傳摘要');
    expect(s.compareAndWrite).not.toHaveBeenCalled();
  });

  it('requires review after a concurrent edit and writes only after approval', async () => {
    const s = setup();
    s.summarize.mockImplementation(async () => { s.edit(article + '\nNew typing'); return JSON.stringify({ summary: 'Summary', tags: ['閱讀'] }); });
    await s.run('summarize');
    expect(s.review).toHaveBeenCalledOnce();
    expect(s.compareAndWrite).toHaveBeenCalledTimes(2);
    expect(s.compareAndWrite.mock.calls[1]?.[0]).toBe(article + '\nNew typing');
  });

  it('preserves concurrent edits if review is declined', async () => {
    const s = setup();
    s.summarize.mockImplementation(async () => { s.edit('User edits'); return JSON.stringify({ summary: 'Summary', tags: ['閱讀'] }); });
    s.review.mockResolvedValue(false);
    expect(await s.run('summarize')).toBe(false);
    expect(s.current()).toBe('User edits');
    expect(s.compareAndWrite).toHaveBeenCalledOnce();
  });

  it('asks again when the note changes during conflict review', async () => {
    const s = setup();
    s.summarize.mockImplementation(async () => { s.edit('First edit'); return JSON.stringify({ summary: 'Summary', tags: ['閱讀'] }); });
    s.review.mockImplementationOnce(async () => { s.edit('Second edit'); return true; }).mockResolvedValueOnce(false);
    expect(await s.run('summarize')).toBe(false);
    expect(s.review).toHaveBeenCalledTimes(2);
    expect(s.current()).toBe('Second edit');
  });

  it('discards late fetch and agent results after cancellation', async () => {
    const fetched = setup();
    fetched.fetch.mockImplementation(async () => { fetched.controller.abort(); return 'Late fetch'; });
    await expect(fetched.run('both')).rejects.toThrow('工作已取消');
    expect(fetched.summarize).not.toHaveBeenCalled();
    expect(fetched.compareAndWrite).not.toHaveBeenCalled();
    const summarized = setup();
    summarized.summarize.mockImplementation(async () => { summarized.controller.abort(); return 'Late summary'; });
    await expect(summarized.run('summarize')).rejects.toThrow('工作已取消');
    expect(summarized.compareAndWrite).not.toHaveBeenCalled();
  });

  it('does not write after cancellation during review', async () => {
    const s = setup();
    s.summarize.mockImplementation(async () => { s.edit('User edit'); return JSON.stringify({ summary: 'Summary', tags: ['閱讀'] }); });
    s.review.mockImplementation(async () => { s.controller.abort(); return true; });
    await expect(s.run('summarize')).rejects.toThrow('工作已取消');
    expect(s.compareAndWrite).toHaveBeenCalledOnce();
    expect(s.current()).toBe('User edit');
  });

  it('keeps nested article summary headings while updating a separate existing summary', async () => {
    const s = setup('## AI 摘要\nPrevious summary\n## 原文\nIntro\n### AI 摘要\nArticle section\n## Notes\nKeep');
    await s.run('summarize');
    expect(s.summarize).toHaveBeenCalledWith('Intro\n### AI 摘要\nArticle section', expect.any(String), s.controller.signal);
    expect(s.current()).toContain('### AI 摘要\nArticle section');
    expect(s.current()).not.toContain('Previous summary');
    expect(s.current()).toContain('Generated summary');
  });

  it('does not start fetching after cancellation in the URL chooser', async () => {
    const s = setup('---\nsource: https://example.com/a\nurl: https://example.com/b\n---\n## 原文\nArticle');
    s.choose.mockImplementation(async () => { s.controller.abort(); return 0; });
    await expect(s.run('both')).rejects.toThrow('工作已取消');
    expect(s.fetch).not.toHaveBeenCalled();
    expect(s.compareAndWrite).not.toHaveBeenCalled();
  });
});
