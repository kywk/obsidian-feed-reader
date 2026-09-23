import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import { assertHttpUrl, type FeedTransport } from './transport';

interface FeedTitleDocument {
  rss?: { channel?: { title?: unknown } };
  RDF?: { channel?: { title?: unknown } };
  feed?: { title?: unknown };
}

function isValidXml(xml: string): boolean {
  try { SyntaxValidator.validate(xml); return true; } catch { return false; }
}

/** Reads the feed-level title, never an article title or HTML page title. */
export function parseFeedTitle(xml: string): string {
  if (xml.length > 5_000_000) throw new Error('Feed is too large to detect its title. Enter a title manually.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !isValidXml(xml)) {
    throw new Error('Feed XML is invalid or contains unsupported declarations. Enter a title manually.');
  }
  const document = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false }).parse(xml) as FeedTitleDocument;
  const title = document.rss?.channel?.title ?? document.RDF?.channel?.title ?? document.feed?.title;
  const text = (value: unknown): string => typeof value === 'string' ? value : value && typeof value === 'object'
    ? Object.values(value).map(text).join(' ') : '';
  const result = text(title).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (!result) throw new Error('No feed title was found. Enter a title manually.');
  return result;
}

export async function fetchFeedTitle(url: string, transport: FeedTransport, signal: AbortSignal, timeoutMs = 15_000): Promise<string> {
  try { assertHttpUrl(url); } catch { throw new Error('Enter a valid HTTP or HTTPS feed URL.'); }
  if (signal.aborted) throw new Error('Title detection cancelled.');
  const controller = new AbortController();
  let timer: number | undefined;
  let cancel = (): void => {};
  const interrupted = new Promise<never>((_, reject) => {
    cancel = () => { controller.abort(); reject(new Error('Title detection cancelled.')); };
    signal.addEventListener('abort', cancel, { once: true });
    timer = window.setTimeout(() => { controller.abort(); reject(new Error('Title detection timed out. Enter a title manually.')); }, timeoutMs);
  });
  try {
    const response = await Promise.race([transport.fetch(url, controller.signal).catch(() => { throw new Error('Could not detect the feed title. Enter a title manually.'); }), interrupted]);
    if (response.status < 200 || response.status >= 300) throw new Error(`Feed request failed (HTTP ${response.status}). Enter a title manually.`);
    return parseFeedTitle(response.body);
  } catch (error) {
    if (signal.aborted) throw new Error('Title detection cancelled.');
    // Transport errors can contain credentials or query strings; never show them verbatim.
    if (error instanceof Error && /^(Feed |No feed |Title detection)/.test(error.message)) throw error;
    throw new Error('Could not detect the feed title. Enter a title manually.');
  } finally { window.clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}
