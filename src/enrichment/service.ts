import type { EnrichmentSettings } from './config';
import { updateSavedNoteDates } from '../save/note-dates';
import { mergeSummaryTags, parseSummaryResult, summaryWithTagsPrompt } from './summary';
import { findFullText, replaceFullText, replaceSummary, resolveSourceUrls, summaryInput, type NoteRange } from './note';

export type EnrichmentAction = 'fetch' | 'summarize' | 'both';
export interface NoteAccess {
  read(): Promise<string>;
  /** Atomic compare-and-swap; false leaves the note unchanged. */
  compareAndWrite(expected: string, next: string): Promise<boolean>;
}
export interface EnrichmentInteraction {
  choose(title: string, options: string[], signal: AbortSignal): Promise<number | null>;
  review(result: string, signal: AbortSignal): Promise<boolean>;
}
export interface EnrichmentDependencies {
  fetch(url: string, signal: AbortSignal): Promise<string>;
  summarize(article: string, prompt: string, signal: AbortSignal): Promise<string>;
  interaction: EnrichmentInteraction;
}

function alive(signal: AbortSignal): void { if (signal.aborted) throw new Error('工作已取消'); }

/** No Obsidian dependency: the adapter owns the captured file and atomic writes. */
export async function enrichNote(note: NoteAccess, action: EnrichmentAction, settings: EnrichmentSettings, deps: EnrichmentDependencies, signal: AbortSignal): Promise<boolean> {
  const original = await note.read();
  alive(signal);
  const ranges = findFullText(original, settings.rules);
  let range: NoteRange | undefined = ranges[0];
  if (ranges.length > 1) {
    const selected = await deps.interaction.choose('選擇原文區塊', ranges.map(r => r.text.slice(0, 160)), signal);
    if (selected === null) return false;
    range = ranges[selected];
  }
  const existingText = action === 'summarize' && range ? summaryInput(original, range) : '';
  const shouldFetch = action !== 'summarize' || !existingText.trim();
  alive(signal);
  let result = original;
  let input: string;
  if (shouldFetch) {
    const urls = resolveSourceUrls(original, settings.urlFields);
    if (!urls.length) throw new Error(`找不到有效原文網址，請在 Properties 補入 ${settings.urlFields.join('、')}`);
    let index = 0;
    if (urls.length > 1) {
      const selected = await deps.interaction.choose('原文網址有衝突，請選擇', urls.map(url => {
        const parsed = new URL(url); return `${parsed.origin}${parsed.pathname}${parsed.search ? '?…' : ''}`;
      }), signal);
      if (selected === null) return false;
      index = selected;
    }
    alive(signal);
    input = await deps.fetch(urls[index]!, signal);
    alive(signal);
    if (action !== 'summarize') result = replaceFullText(result, input, range, settings.fullTextHeading);
  } else {
    input = existingText;
  }
  if (action !== 'fetch') {
    if (!input.trim()) throw new Error('全文內容為空，請先擷取原文');
    const response = await deps.summarize(input, summaryWithTagsPrompt(settings.summaryPrompt), signal);
    alive(signal);
    if (!response.trim()) throw new Error('Agent 沒有回傳摘要');
    const { summary, tags } = parseSummaryResult(response);
    result = replaceSummary(result, summary, action === 'summarize' ? range : undefined);
    result = mergeSummaryTags(result, tags);
  }
  alive(signal);
  result = updateSavedNoteDates(result);
  let expected = original;
  while (!(await note.compareAndWrite(expected, result))) {
    alive(signal);
    expected = await note.read();
    if (!(await deps.interaction.review(result, signal))) return false;
    alive(signal);
  }
  return true;
}
