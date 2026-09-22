import { Document, isMap, parseDocument } from 'yaml';

export interface ArticleSummaryResult { summary: string; tags: string[]; }
export function summaryWithTagsPrompt(prompt: string): string {
  return `${prompt}\n\n輸出協定（優先於上述格式要求）：只輸出 JSON 物件 {"summary":"Markdown 摘要","tags":["標籤"]}。summary 保留上述摘要內容要求。tags 提供 3–5 個精確主題標籤，可用繁體中文或通用技術名稱；不加 #、不含空白，允許連字號、底線或 / 階層。不可只有數字。不要輸出 JSON 以外的內容。`;
}

export function parseSummaryResult(output: string): ArticleSummaryResult {
  const text = output.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Agent 摘要與標籤格式不正確，請重試（需要 JSON）'); }
  if (!value || typeof value !== 'object') throw new Error('Agent 未回傳有效的摘要與標籤');
  const result = value as Partial<ArticleSummaryResult>;
  if (typeof result.summary !== 'string' || !result.summary.trim()) throw new Error('Agent 沒有回傳摘要');
  if (!Array.isArray(result.tags) || !result.tags.length || result.tags.length > 8 || result.tags.some(tag =>
    typeof tag !== 'string' || tag.length > 80 || !/^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(tag) || !/[\p{L}_\/-]/u.test(tag))) {
    throw new Error('Agent 回傳的 tags 無效，請重試');
  }
  return { summary: result.summary.trim(), tags: result.tags };
}

export function mergeSummaryTags(source: string, tags: string[]): string {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  const doc = match ? parseDocument(match[1]!, { uniqueKeys: true }) : new Document({});
  if (doc.errors.length || (doc.contents !== null && !isMap(doc.contents))) throw new Error('筆記 Properties 格式錯誤，無法加入 tags');
  const properties = doc.toJS({ maxAliasCount: 50 }) as Record<string, unknown> | null;
  const existing = properties?.tags;
  let previous: string[] = [];
  if (typeof existing === 'string') previous = existing.split(/[,\s]+/u).filter(Boolean);
  else if (Array.isArray(existing) && existing.every(tag => typeof tag === 'string')) previous = existing;
  else if (existing != null) throw new Error('既有 tags 必須是文字或文字清單，請先修正');
  const merged: string[] = [], seen = new Set<string>();
  for (const tag of [...previous, ...tags]) {
    const normalized = tag.trim().replace(/^#/, '');
    const key = normalized.normalize('NFC').toLowerCase();
    if (key && !seen.has(key)) { seen.add(key); merged.push(normalized); }
  }
  doc.set('tags', merged);
  return `---\n${doc.toString().trimEnd()}\n---\n${match ? source.slice(match[0].length) : source}`;
}
