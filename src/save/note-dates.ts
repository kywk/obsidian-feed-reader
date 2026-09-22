import { parseDocument } from 'yaml';

/** Update only feed-reader notes, retaining the original creation time and YAML comments. */
export function updateSavedNoteDates(source: string, now = new Date().toISOString()): string {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) return source;
  const doc = parseDocument(match[1]!, { uniqueKeys: true });
  if (doc.errors.length) throw new Error('筆記 Properties 格式錯誤');
  if (!doc.get('feed_reader_id')) return source;
  const created = doc.get('date_created') ?? doc.get('feed_reader_saved_at') ?? now;
  doc.set('date_created', created);
  doc.set('date_updated', now);
  doc.delete('feed_reader_saved_at');
  doc.delete('feed_reader_first_fetched_at');
  return `---\n${doc.toString().trimEnd()}\n---\n${source.slice(match[0].length)}`;
}
