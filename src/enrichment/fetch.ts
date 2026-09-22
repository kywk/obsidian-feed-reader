import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { sanitizeArticleHtml } from '../ui/content';

export interface ArticleFetchResponse {
  status: number;
  text: string;
  headers?: Record<string, string>;
  finalUrl?: string;
}
export type ArticleFetchTransport = (url: string, signal: AbortSignal) => Promise<ArticleFetchResponse>;
export interface FetchedArticle { url: string; title: string; markdown: string; }
export interface ArticleFetchOptions { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number; }

function articleUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Article URL is invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Article URL must be HTTP(S) without credentials');
  }
  return url.href;
}

/** Fetches public HTML without executing page scripts or using browser login state. */
export async function fetchArticle(url: string, transport: ArticleFetchTransport, options: ArticleFetchOptions = {}): Promise<FetchedArticle> {
  const target = articleUrl(url);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('Article fetch limits must be positive');
  }
  if (options.signal?.aborted) throw new Error('Article fetch cancelled');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = (): void => {};
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => { controller.abort(); reject(new Error('Article fetch cancelled')); };
      options.signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new Error('Article fetch timed out')); }, timeoutMs);
    });
    const response = await Promise.race([transport(target, controller.signal), cancelled]);
    if (options.signal?.aborted) throw new Error('Article fetch cancelled');
    if (response.status < 200 || response.status >= 300) throw new Error(`Article fetch failed (HTTP ${response.status})`);
    const contentType = Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1];
    if (contentType && !/^(text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(contentType)) {
      throw new Error('Article response is not HTML');
    }
    // requestUrl buffers responses; this bound protects parsing, not network allocation.
    if (response.text.length > maxBytes || new TextEncoder().encode(response.text).byteLength > maxBytes) {
      throw new Error('Article response exceeds size limit');
    }
    if (!response.text.trim() || (!contentType && !/<(?:!doctype\s+html|html|head|body|article|main|p)\b/i.test(response.text))) {
      throw new Error('Article response is empty or not HTML');
    }
    const baseUrl = response.finalUrl ? articleUrl(response.finalUrl) : target;
    const doc = new DOMParser().parseFromString(response.text, 'text/html');
    const pageTitle = doc.title.trim();
    const blockedTitle = /^(?:sign[ -]?in|log[ -]?in|access denied|forbidden|just a moment|attention required|subscription required)(?:\s*[-:|.!…]|\s*$)/i;
    if (blockedTitle.test(pageTitle) || doc.querySelector('#cf-challenge-running, #challenge-form, .g-recaptcha')) {
      throw new Error('Article page requires login or browser verification');
    }
    // Resolve relative links ourselves after extraction; hostile <base> elements cannot redirect them.
    doc.querySelectorAll('base').forEach(element => element.remove());
    const article = new Readability(doc).parse();
    if (!article?.content || !article.textContent?.trim()) throw new Error('No readable article content found');
    const clean = sanitizeArticleHtml(article.content, baseUrl);
    const markdown = new TurndownService({ bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '_', headingStyle: 'atx' }).turndown(clean).trim();
    if (!markdown) throw new Error('No readable article content found');
    return { url: baseUrl, title: article.title || pageTitle, markdown };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
