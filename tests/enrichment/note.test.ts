import { describe, expect, it } from 'vitest';
import { findFullText, getSummaryRange, parseNote, replaceFullText, replaceSummary, resolveSourceUrls, summaryInput } from '../../src/enrichment/note';

describe('article note enrichment boundaries', () => {
  it('resolves ordered distinct public web URL properties and rejects unsafe or credential URLs', () => {
    const source = '---\nfeed_reader_url: https://example.com/a\nsource: https://example.com/b\nurl: https://example.com/a\nbad: javascript:alert(1)\nprivate: https://name:secret@example.com/\n---\nBody';
    expect(resolveSourceUrls(source, ['feed_reader_url', 'source', 'url', 'bad', 'private'])).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(() => parseNote('---\nx: [\n---\nBody')).toThrow();
    expect(() => parseNote('---\nx: 1')).toThrow();
  });

  it('uses first matching rule, returns ambiguous sections, and ignores headings in code fences', () => {
    const source = '# Title\n## 原文\nArticle\n```md\n## fake\n```\n### Detail\nDetails\n## Notes\nKeep\n## 原文\nSecond\n';
    const matches = findFullText(source, [{ kind: 'heading', heading: '原文' }, { kind: 'heading', heading: 'Notes' }]);
    expect(matches).toHaveLength(2);
    expect(summaryInput(source, matches[0])).toBe('Article\n```md\n## fake\n```\n### Detail\nDetails');
    const updated = replaceFullText(source, 'New article', matches[0]);
    expect(updated).toContain('## Notes\nKeep\n## 原文\nSecond');
    expect(updated).toContain('# Title\n');
    expect(findFullText(updated, [])).toHaveLength(1);
    expect(summaryInput(updated, findFullText(updated, [])[0])).toBe('New article');
  });

  it('preserves the whole original body when a clipper rule identifies summary input', () => {
    const source = '---\nsource: https://example.com/\ntags: [clipper]\n---\n## AI 摘要\nOld summary\n## Story\nFull article';
    const selected = findFullText(source, [{ kind: 'body', property: 'tags', value: 'clipper' }])[0]!;
    expect(summaryInput(source, selected)).toBe('## Story\nFull article');
    const updated = replaceFullText(source, 'Fresh text', selected);
    expect(updated).toContain('source: https://example.com/');
    expect(updated).toContain('Old summary');
    expect(updated).toContain('Full article');
    expect(updated).toContain('Fresh text');
    const summarized = replaceSummary(updated, 'Updated summary');
    expect(summaryInput(summarized, findFullText(summarized, [])[0])).toBe('Fresh text');
  });

  it('appends when unknown and puts one replaceable summary after Properties', () => {
    const source = '---\nsource: https://example.com/\n---\nMy notes';
    const appended = replaceFullText(source, 'Story');
    expect(appended).toContain('My notes\n\n<!-- feed-reader:fulltext:start -->');
    const summarized = replaceSummary(appended, 'First');
    const updated = replaceSummary(summarized, 'Second');
    expect(updated).not.toContain('First');
    expect(updated).toContain('Second');
    expect(updated).toContain('My notes');
    expect(getSummaryRange(updated)?.start).toBe(parseNote(source).bodyStart);
    expect(summaryInput(updated, findFullText(updated, [])[0])).toBe('Story');
  });

  it('rejects malformed managed sections and stale selected ranges without overwriting content', () => {
    expect(() => findFullText('<!-- feed-reader:fulltext:start -->\nUser text', [])).toThrow();
    const source = '## 原文\nBefore\n## Notes\nKeep';
    const selected = findFullText(source, [{ kind: 'heading', heading: '原文' }])[0]!;
    expect(() => replaceFullText(source.replace('Before', 'Edited'), 'New', selected)).toThrow(/已變更/);
    expect(() => replaceSummary('## AI 摘要\nOne\n## AI 摘要\nTwo', 'New')).toThrow();
  });

  it('does not let generated marker text create extra managed ranges', () => {
    const updated = replaceFullText('My notes', '<!-- feed-reader:fulltext:end -->\nMalicious');
    expect(findFullText(updated, [])).toHaveLength(1);
    expect(summaryInput(updated, findFullText(updated, [])[0])).toContain('&lt;!-- feed-reader:');
  });

  it('preserves article headings called AI 摘要 inside managed full text', () => {
    const source = replaceFullText('Personal notes', 'Intro\n## AI 摘要\nAn article section\n## End\nLast paragraph');
    expect(getSummaryRange(source)).toBeNull();
    const updated = replaceSummary(source, 'Plugin summary');
    expect(summaryInput(updated, findFullText(updated, [])[0])).toBe('Intro\n## AI 摘要\nAn article section\n## End\nLast paragraph');
  });

  it('keeps nested same-name article headings distinct from an outside summary', () => {
    const source = '## AI 摘要\nOld plugin summary\n## 原文\nIntro\n### AI 摘要\nArticle section\n## Notes\nKeep';
    const selected = findFullText(source, [{ kind: 'heading', heading: '原文' }])[0]!;
    expect(summaryInput(source, selected)).toBe('Intro\n### AI 摘要\nArticle section');
    const summarized = replaceSummary(source, 'Updated plugin summary', selected);
    expect(summarized).toContain('### AI 摘要\nArticle section');
    expect(summarized).not.toContain('Old plugin summary');
    expect(summarized).toContain('Updated plugin summary');
    const fetched = replaceFullText(source, 'New article', selected);
    expect(fetched).toContain('Old plugin summary');
    expect(fetched).not.toContain('Article section');
    expect(fetched).toContain('## Notes\nKeep');
  });

  it('does not move nested article summary headings out when replacing unmanaged full text', () => {
    const source = '## 原文\nIntro\n### AI 摘要\nArticle section\n## Notes\nKeep';
    const selected = findFullText(source, [{ kind: 'heading', heading: '原文' }])[0]!;
    expect(getSummaryRange(source, selected)).toBeNull();
    expect(replaceFullText(source, 'New article', selected)).not.toContain('Article section');
    expect(replaceSummary(source, 'Plugin summary', selected)).toContain('### AI 摘要\nArticle section');
  });

  it('does not identify headings inside existing summaries as original article sections', () => {
    const rules = [{ kind: 'heading' as const, heading: 'Article' }];
    const managed = replaceSummary('Unmarked clipped article', 'Overview\n## Article\nSummary details');
    expect(findFullText(managed, rules)).toEqual([]);
    expect(findFullText('## AI 摘要\nOverview\n### Article\nSummary details\n## Notes\nKeep', rules)).toEqual([]);
    const withOriginal = managed + '\n## Article\nActual full text\n';
    const candidates = findFullText(withOriginal, rules);
    expect(candidates).toHaveLength(1);
    expect(summaryInput(withOriginal, candidates[0])).toBe('Actual full text');
    const updated = replaceFullText(withOriginal, 'New full text', candidates[0]);
    expect(updated).toContain('Summary details');
    expect(updated).toContain('Unmarked clipped article');
  });

  it('rejects cross-kind nested and crossing markers before any replacement', () => {
    for (const ending of [
      '<!-- feed-reader:summary:end -->\n<!-- feed-reader:fulltext:end -->',
      '<!-- feed-reader:fulltext:end -->\n<!-- feed-reader:summary:end -->',
    ]) {
      const source = '<!-- feed-reader:fulltext:start -->\n## 原文\n<!-- feed-reader:summary:start -->\nSummary\n' + ending;
      expect(() => findFullText(source, [])).toThrow(/重疊/);
      expect(() => replaceSummary(source, 'Replacement')).toThrow(/重疊/);
    }
  });
});
