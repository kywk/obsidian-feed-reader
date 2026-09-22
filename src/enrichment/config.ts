import type { NoteRule } from './note';

export interface EnrichmentSettings {
  urlFields: string[];
  rules: NoteRule[];
  fullTextHeading: string;
  summaryPrompt: string;
}

export const DEFAULT_ENRICHMENT: EnrichmentSettings = {
  urlFields: ['feed_reader_url', 'source', 'url'],
  rules: [{ kind: 'heading', heading: '原文' }, { kind: 'heading', heading: '全文' }, { kind: 'heading', heading: 'Article' }],
  fullTextHeading: '原文',
  summaryPrompt: '請以台灣常用繁體中文摘要文章：先寫一段概述，再列出 3–5 個重點。忠於原文，不捏造事實，僅輸出摘要 Markdown，不加最外層程式碼區塊。',
};

export function validateEnrichment(value: EnrichmentSettings): void {
  if (!Array.isArray(value.urlFields) || !value.urlFields.length || value.urlFields.some(field => typeof field !== 'string' || !field.trim())) throw new Error('至少設定一個原文網址欄位');
  if (!value.fullTextHeading?.trim() || /[\r\n]/.test(value.fullTextHeading)) throw new Error('原文標題必須為單行文字');
  if (!value.summaryPrompt?.trim()) throw new Error('摘要提示詞不可空白');
  if (!Array.isArray(value.rules)) throw new Error('原文規則必須是清單');
  for (const rule of value.rules) {
    if (!rule || (rule.kind !== 'heading' && rule.kind !== 'body')) throw new Error('不支援的原文規則');
    if (rule.kind === 'heading' && (!rule.heading?.trim() || /[\r\n]/.test(rule.heading))) throw new Error('區塊標題不可空白或換行');
    if (rule.kind === 'body' && (!rule.property?.trim() || typeof rule.value !== 'string')) throw new Error('正文規則需 Properties 欄位與比對值');
  }
}
