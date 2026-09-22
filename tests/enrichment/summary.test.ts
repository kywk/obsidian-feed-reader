import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { mergeSummaryTags, parseSummaryResult, summaryWithTagsPrompt } from '../../src/enrichment/summary';

describe('AI summary and frontmatter tags', () => {
  it('requests summary and tags in one response while retaining custom content instructions', () => {
    expect(summaryWithTagsPrompt('Use five points')).toContain('Use five points');
    const result = parseSummaryResult('```json\n{"summary":"概述\\n- 重點","tags":["AI","軟體開發","AI/agents"]}\n```');
    expect(result.summary).toBe('概述\n- 重點');
    expect(result.tags).toContain('AI/agents');
  });
  it('merges tags without losing other Properties, comments or any body content', () => {
    const source = '---\ntags: [AI, inbox]\ncustom: value # keep comment\n---\n# My article\n## Notes\nKeep';
    const updated = mergeSummaryTags(source, ['ai', '程式設計']);
    expect(parse(updated.split('---\n')[1]!)).toEqual({ tags: ['AI', 'inbox', '程式設計'], custom: 'value' });
    expect(updated).toContain('# keep comment');
    expect(updated.endsWith('# My article\n## Notes\nKeep')).toBe(true);
    expect(mergeSummaryTags(updated, ['ai', '程式設計'])).toBe(updated);
  });
  it('creates frontmatter and accepts an existing scalar tag list', () => {
    expect(mergeSummaryTags('Body', ['閱讀'])).toContain('---\ntags:\n  - 閱讀\n---\nBody');
    const updated = mergeSummaryTags('---\ntags: "#AI, inbox"\n---\nBody', ['AI']);
    expect(parse(updated.split('---\n')[1]!).tags).toEqual(['AI', 'inbox']);
  });
  it('rejects malformed output or incompatible existing tags instead of silently discarding data', () => {
    for (const tags of [[], ['123'], ['two words'], ['#AI'], ['a: b'], [123]]) {
      expect(() => parseSummaryResult(JSON.stringify({ summary: 'Summary', tags }))).toThrow();
    }
    expect(() => parseSummaryResult('Not JSON')).toThrow('JSON');
    expect(() => mergeSummaryTags('---\ntags: {custom: value}\n---\nBody', ['AI'])).toThrow('既有 tags');
  });
});
