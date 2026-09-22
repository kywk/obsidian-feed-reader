import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { updateSavedNoteDates } from '../../src/save/note-dates';
import { ObsidianSavedNoteStorage } from '../../src/save/obsidian-adapter';

describe('saved note date properties', () => {
  const original = '2026-09-20T01:00:00.000Z';
  const now = '2026-09-22T02:00:00.000Z';
  it('migrates legacy dates on explicit updates without altering body or custom properties', () => {
    const source = `---\nfeed_reader_id: article\nfeed_reader_saved_at: ${original}\nfeed_reader_first_fetched_at: 2026-09-19T00:00:00Z\ncustom: value # keep\n---\n\nHuman edit\n`;
    const updated = updateSavedNoteDates(source, now);
    const properties = parse(updated.split('---\n')[1]!);
    expect(properties).toMatchObject({ date_created: original, date_updated: now, custom: 'value' });
    expect(properties).not.toHaveProperty('feed_reader_saved_at');
    expect(properties).not.toHaveProperty('feed_reader_first_fetched_at');
    expect(updated).toContain('# keep');
    expect(updated.endsWith('\n\nHuman edit\n')).toBe(true);
    const again = updateSavedNoteDates(updated, '2026-09-23T00:00:00Z');
    expect(parse(again.split('---\n')[1]!).date_created).toBe(original);
  });
  it('does not add feed date fields to Web Clipper notes', () => {
    const source = '---\nsource: https://example.com\n---\nBody';
    expect(updateSavedNoteDates(source, now)).toBe(source);
  });
  it.each(['date_created', 'feed_reader_saved_at'])('indexes %s notes after restart without requiring removed fields', dateField => {
    const file = { path: 'note.md' };
    const storage = new ObsidianSavedNoteStorage({ getMarkdownFiles: () => [file] } as never, {
      getFileCache: () => ({ frontmatter: { feed_reader_id: '["f","a"]', feed_reader_article_id: 'a', feed_reader_source_id: 'f', title: 'Title', feed_reader_source: 'Feed', [dateField]: original } }),
    } as never);
    expect(storage.list()).toMatchObject([{ savedAt: original, firstFetchedAt: original, path: 'note.md' }]);
  });
});
