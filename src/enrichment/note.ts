import { parse } from 'yaml';

export type NoteRule = { kind: 'heading'; heading: string } | { kind: 'body'; property: string; value: string };
export interface NoteRange { start: number; end: number; text: string; kind?: 'heading' | 'body' | 'managed' }
const marker = (kind: string, edge: string) => `<!-- feed-reader:${kind}:${edge} -->`;
const range = (source: string, start: number, end: number, kind?: NoteRange['kind']): NoteRange => ({ start, end, text: source.slice(start, end), kind });

export function parseNote(source: string): { properties: Record<string, unknown>; bodyStart: number } {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) {
    if (/^(?:\uFEFF)?---\r?\n/.test(source)) throw new Error('筆記 Properties 缺少結尾分隔線。');
    return { properties: {}, bodyStart: 0 };
  }
  const properties: unknown = parse(match[1]!, { maxAliasCount: 50 });
  if (properties != null && (typeof properties !== 'object' || Array.isArray(properties))) throw new Error('筆記 Properties 必須是 YAML 對應表。');
  return { properties: (properties ?? {}) as Record<string, unknown>, bodyStart: match[0].length };
}

export function resolveSourceUrls(source: string, fields = ['feed_reader_url', 'source', 'url']): string[] {
  const { properties } = parseNote(source);
  const urls: string[] = [];
  for (const field of fields) {
    const value = properties[field];
    if (typeof value !== 'string') continue;
    try {
      const url = new URL(value.trim());
      if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !urls.includes(url.href)) urls.push(url.href);
    } catch { /* Invalid source properties do not become requests. */ }
  }
  return urls;
}

interface Line { start: number; end: number; text: string; active: boolean }
function lines(source: string, start = 0): Line[] {
  const result: Line[] = [];
  let fence: { char: string; length: number } | undefined;
  const re = /[^\n]*(?:\n|$)/g;
  re.lastIndex = start;
  for (let match; (match = re.exec(source)) && match[0];) {
    const text = match[0].replace(/\r?\n$/, '');
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    const active = !fence && !opening;
    if (fence) {
      if (opening && opening[1]![0] === fence.char && opening[1]!.length >= fence.length && !opening[2]!.trim()) fence = undefined;
    } else if (opening) fence = { char: opening[1]![0]!, length: opening[1]!.length };
    result.push({ start: match.index, end: re.lastIndex, text, active });
  }
  return result;
}

function managedRanges(source: string, kind: string): NoteRange[] {
  const result: NoteRange[] = [];
  let open: { kind: string; start: number } | undefined;
  for (const line of lines(source, parseNote(source).bodyStart)) {
    if (!line.active) continue;
    const match = /^<!-- feed-reader:(fulltext|summary):(start|end) -->$/.exec(line.text.trim());
    if (!match) continue;
    if (match[2] === 'start') {
      if (open) throw new Error('筆記管理區塊標記重疊，請先修正。');
      open = { kind: match[1]!, start: line.start };
    } else {
      if (!open || open.kind !== match[1]) throw new Error('筆記管理區塊標記不完整，請先修正。');
      if (open.kind === kind) result.push(range(source, open.start, line.end, 'managed'));
      open = undefined;
    }
  }
  if (open) throw new Error('筆記管理區塊標記不完整，請先修正。');
  return result;
}

function headingRanges(source: string, heading: string): NoteRange[] {
  const normalized = heading.trim().replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '');
  const bodyLines = lines(source, parseNote(source).bodyStart);
  const headings = bodyLines.flatMap(line => {
    const match = line.active ? /^ {0,3}(#{1,6})\s+(.+?)\s*$/.exec(line.text) : null;
    return match ? [{ ...line, level: match[1]!.length, title: match[2]!.replace(/\s+#+$/, '') }] : [];
  });
  return headings.flatMap((item, index) => {
    if (item.title !== normalized) return [];
    const nextHeading = headings.slice(index + 1).find(next => next.level <= item.level)?.start ?? source.length;
    // A managed section's opening marker belongs with its following heading.
    const nextMarker = bodyLines.find(line => line.active && line.start > item.start && line.start < nextHeading
      && /^<!-- feed-reader:(?:fulltext|summary):start -->$/.test(line.text.trim()))?.start;
    return [range(source, item.start, nextMarker ?? nextHeading, 'heading')];
  });
}

export function getSummaryRange(source: string, originalRange?: NoteRange): NoteRange | null {
  const matches = managedRanges(source, 'summary');
  const fullText = managedRanges(source, 'fulltext');
  if (originalRange && originalRange.kind !== 'body') fullText.push(originalRange);
  const candidates = matches.length ? matches : headingRanges(source, 'AI 摘要')
    .filter(candidate => !fullText.some(article => candidate.start >= article.start && candidate.start < article.end));
  if (candidates.length > 1) throw new Error('筆記包含多個 AI 摘要區塊，請先整理。');
  return candidates[0] ?? null;
}

export function findFullText(source: string, rules: NoteRule[]): NoteRange[] {
  const managed = managedRanges(source, 'fulltext');
  if (managed.length) return managed;
  const managedSummary = managedRanges(source, 'summary');
  const summaries = managedSummary.length ? managedSummary : headingRanges(source, 'AI 摘要');
  const { properties, bodyStart } = parseNote(source);
  for (const rule of rules) {
    if (rule.kind === 'heading') {
      const matches = headingRanges(source, rule.heading).filter(candidate => !summaries.some(summary =>
        candidate.start >= summary.start && candidate.start < summary.end));
      if (matches.length) return matches;
    } else if (Object.hasOwn(properties, rule.property) && (Array.isArray(properties[rule.property])
      ? (properties[rule.property] as unknown[]).some(value => String(value) === rule.value)
      : String(properties[rule.property]) === rule.value)) return [range(source, bodyStart, source.length, 'body')];
  }
  return [];
}

export function summaryInput(source: string, selected?: NoteRange): string {
  const bodyStart = parseNote(source).bodyStart;
  const start = selected?.start ?? bodyStart;
  const end = selected?.end ?? source.length;
  const summary = getSummaryRange(source, selected);
  let content = source.slice(start, end);
  if (summary && summary.start >= start && summary.end <= end) content = source.slice(start, summary.start) + source.slice(summary.end, end);
  content = content.replace(/^\s*<!-- feed-reader:fulltext:start -->\r?\n/, '').replace(/\r?\n?<!-- feed-reader:fulltext:end -->\s*$/, '');
  if (selected && selected.kind !== 'body') content = content.replace(/^ {0,3}#{1,6}\s+[^\n]*(?:\n|$)/, '');
  return content.trim();
}

function block(kind: string, heading: string, content: string): string {
  const safeContent = content.replace(/<!--\s*feed-reader:/g, '&lt;!-- feed-reader:');
  const title = heading.trim().replace(/^#{1,6}\s+/, '').replace(/[\r\n]/g, ' ') || '原文';
  return `${marker(kind, 'start')}\n## ${title}\n\n${safeContent.trim()}\n${marker(kind, 'end')}\n`;
}

export function replaceFullText(source: string, content: string, selected?: NoteRange, heading = '原文'): string {
  const replacement = block('fulltext', heading, content);
  // A body rule identifies summary input; it never grants ownership of the entire note.
  if (!selected || selected.kind === 'body') return `${source}${source.endsWith('\n\n') ? '' : source.endsWith('\n') ? '\n' : '\n\n'}${replacement}`;
  if (source.slice(selected.start, selected.end) !== selected.text) throw new Error('原文區塊已變更，請重新確認。');
  const summary = getSummaryRange(source, selected);
  const preserved = summary && summary.start >= selected.start && summary.end <= selected.end ? `${summary.text.trim()}\n\n` : '';
  return source.slice(0, selected.start) + preserved + replacement + '\n' + source.slice(selected.end);
}

export function replaceSummary(source: string, content: string, originalRange?: NoteRange): string {
  const selected = getSummaryRange(source, originalRange);
  const replacement = block('summary', 'AI 摘要', content);
  if (selected) return source.slice(0, selected.start) + replacement + '\n' + source.slice(selected.end);
  const { bodyStart } = parseNote(source);
  return source.slice(0, bodyStart) + replacement + '\n' + source.slice(bodyStart);
}
