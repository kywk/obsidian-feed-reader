import { XMLParser } from 'fast-xml-parser';
import Builder from 'fast-xml-builder';
import { SyntaxValidator } from 'fast-xml-validator';
import type { Article } from '../domain/models';

type XmlNode = Record<string, unknown>;

export interface ParseFeedOptions {
  feedId: string;
  feedUrl: string;
  fetchedAt?: string;
}

export async function parseFeedXml(
  xml: string,
  options: ParseFeedOptions,
): Promise<Article[]> {
  const fetchedAt = normalizeRequiredTimestamp(options.fetchedAt ?? new Date().toISOString());
  try {
    SyntaxValidator.validate(xml);
  } catch (error) {
    throw new Error(`Feed XML could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
  });

  let document: XmlNode;
  try {
    document = parser.parse(xml) as XmlNode;
  } catch (error) {
    throw new Error('Feed XML could not be parsed', { cause: error });
  }

  const rssRoot = asNode(document.rss);
  const rdfRoot = asNode(document.RDF);
  const atomRoot = asNode(document.feed);
  let entries: XmlNode[];
  let kind: 'rss' | 'atom';
  let documentBase = options.feedUrl;

  if (rssRoot) {
    const channel = asNode(rssRoot.channel);
    if (!channel) {
      throw new Error('RSS feed has no channel');
    }
    entries = asArray(channel.item).flatMap((value) => {
      const node = asNode(value);
      return node ? [node] : [];
    });
    documentBase = resolveHttpUrl(textValue(channel.link), options.feedUrl) ?? options.feedUrl;
    kind = 'rss';
  } else if (rdfRoot) {
    entries = asArray(rdfRoot.item).flatMap((value) => {
      const node = asNode(value);
      return node ? [node] : [];
    });
    const channel = asNode(rdfRoot.channel);
    documentBase = resolveHttpUrl(textValue(channel?.link), options.feedUrl) ?? options.feedUrl;
    kind = 'rss';
  } else if (atomRoot) {
    entries = asArray(atomRoot.entry).flatMap((value) => {
      const node = asNode(value);
      return node ? [node] : [];
    });
    documentBase =
      resolveHttpUrl(attribute(atomRoot, 'base'), options.feedUrl) ?? options.feedUrl;
    kind = 'atom';
  } else {
    throw new Error('Document is neither an RSS nor Atom feed');
  }

  const articles = await Promise.all(
    entries.map((entry) =>
      parseEntry(entry, kind, {
        feedId: options.feedId,
        feedUrl: options.feedUrl,
        documentBase,
        fetchedAt,
      }),
    ),
  );
  const deduplicated = new Map<string, Article>();
  for (const article of articles) {
    if (!deduplicated.has(article.id)) {
      deduplicated.set(article.id, article);
    }
  }
  return [...deduplicated.values()];
}

interface EntryContext {
  feedId: string;
  feedUrl: string;
  documentBase: string;
  fetchedAt: string;
}

async function parseEntry(
  entry: XmlNode,
  kind: 'rss' | 'atom',
  context: EntryContext,
): Promise<Article> {
  const entryBase =
    resolveHttpUrl(attribute(entry, 'base'), context.documentBase) ?? context.documentBase;
  const url =
    kind === 'atom'
      ? atomEntryUrl(entry, entryBase)
      : resolveHttpUrl(textValue(entry.link), entryBase);
  const guid = kind === 'rss' ? textValue(entry.guid) : undefined;
  const atomId = kind === 'atom' ? textValue(entry.id) : undefined;
  const sourceTitle = cleanText(textValue(entry.title));
  const title = sourceTitle || 'Untitled';
  const contentHtml = entryContent(entry, kind);
  const publishedAt = normalizeOptionalTimestamp(
    textValue(
      kind === 'atom'
        ? (entry.published ?? entry.updated)
        : (entry.pubDate ?? entry.date ?? entry.published),
    ),
  );
  const identity = guid
    ? `guid:${guid}`
    : atomId
      ? `atom:${atomId}`
      : url
        ? `url:${url}`
        : sourceTitle || publishedAt
          ? `fields:${sourceTitle}\n${publishedAt ?? ''}`
          : `body:${contentHtml}`;
  const id = `a_${await sha256(`${context.feedId}\n${identity}`)}`;

  const author = entryAuthor(entry, kind);
  const snippet = entrySnippet(entry, kind, contentHtml);
  const imageUrl = entryImageUrl(entry, kind, contentHtml, entryBase);

  return {
    id,
    feedId: context.feedId,
    title,
    ...(url ? { url } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    firstFetchedAt: context.fetchedAt,
    contentHtml,
    ...(author ? { author } : {}),
    ...(snippet ? { snippet } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function atomEntryUrl(entry: XmlNode, base: string): string | undefined {
  const links = asArray(entry.link).flatMap((value) => {
    if (typeof value === 'string') {
      return [{ href: value, rel: undefined }];
    }
    const node = asNode(value);
    const href = node ? attribute(node, 'href') : undefined;
    return href
      ? [{ href, rel: node ? attribute(node, 'rel') : undefined }]
      : [];
  });
  const preferred = links.find((link) => !link.rel || link.rel === 'alternate') ?? links[0];
  return preferred ? resolveHttpUrl(preferred.href, base) : undefined;
}

function entryContent(entry: XmlNode, kind: 'rss' | 'atom'): string {
  const value =
    kind === 'atom'
      ? (entry.content ?? entry.summary)
      : (entry.encoded ?? entry.content ?? entry.description);
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  const node = asNode(value);
  if (!node) {
    return '';
  }
  const directText = textValue(node['#text']);
  const elementEntries = Object.entries(node).filter(
    ([key]) => key !== '#text' && !key.startsWith('@_'),
  );
  if (elementEntries.length === 0) {
    return directText?.trim() ?? '';
  }
  const builder = new Builder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    suppressEmptyNode: true,
  });
  return elementEntries
    .map(([key, child]) => builder.build({ [key]: child }))
    .join('')
    .trim();
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim();
    return text || undefined;
  }
  const node = asNode(value);
  return node ? textValue(node['#text']) : undefined;
}

function cleanText(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function attribute(node: XmlNode, name: string): string | undefined {
  return textValue(node[`@_${name}`]);
}

function asNode(value: unknown): XmlNode | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as XmlNode)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function resolveHttpUrl(
  value: string | undefined,
  base: string,
): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const resolved = new URL(value, base);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:'
      ? resolved.href
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeOptionalTimestamp(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : undefined;
}

function normalizeRequiredTimestamp(value: string): string {
  const normalized = normalizeOptionalTimestamp(value);
  if (!normalized) {
    throw new Error(`Invalid fetchedAt timestamp: ${value}`);
  }
  return normalized;
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function entryAuthor(entry: XmlNode, kind: 'rss' | 'atom'): string | undefined {
  if (kind === 'atom') {
    const authorNode = asNode(entry.author);
    if (authorNode) {
      const name = textValue(authorNode.name) ?? textValue(authorNode['#text']);
      if (name) return cleanText(name);
    }
    const direct = textValue(entry.author);
    if (direct) return cleanText(direct);
  }
  const creator = textValue(entry.creator ?? entry['dc:creator']);
  if (creator) return cleanText(creator);
  const author = entry.author;
  const authorNode = asNode(author);
  if (authorNode) {
    const name = textValue(authorNode.name) ?? textValue(authorNode['#text']);
    if (name) return cleanText(name);
  }
  const directAuthor = textValue(author);
  if (directAuthor) {
    const match = /\(([^)]+)\)/.exec(directAuthor);
    return cleanText(match ? match[1] : directAuthor);
  }
  return undefined;
}

function entryImageUrl(
  entry: XmlNode,
  kind: 'rss' | 'atom',
  contentHtml: string,
  base: string,
): string | undefined {
  // 1. Enclosures
  for (const item of asArray(entry.enclosure)) {
    const node = asNode(item);
    if (node) {
      const type = attribute(node, 'type') ?? '';
      const url = attribute(node, 'url');
      if (url && (type.startsWith('image/') || isImageExtension(url))) {
        const resolved = resolveHttpUrl(url, base);
        if (resolved) return resolved;
      }
    }
  }

  // 2. Media thumbnails / contents
  const mediaNodes = [
    ...asArray(entry.thumbnail),
    ...asArray(entry['media:thumbnail']),
    ...asArray(entry['media:content']),
    ...asArray(entry.content).filter((c) => typeof c === 'object' && c !== null && ('@_url' in (c as Record<string, unknown>))),
  ];
  for (const item of mediaNodes) {
    const node = asNode(item);
    if (node) {
      const url = attribute(node, 'url') ?? textValue(node['#text']);
      const medium = attribute(node, 'medium');
      const type = attribute(node, 'type') ?? '';
      if (url && (medium === 'image' || type.startsWith('image/') || isImageExtension(url) || (!medium && !type))) {
        const resolved = resolveHttpUrl(url, base);
        if (resolved) return resolved;
      }
    }
  }

  // 3. itunes:image
  for (const item of [...asArray(entry.image), ...asArray(entry['itunes:image'])]) {
    const node = asNode(item);
    if (node) {
      const href = attribute(node, 'href') ?? attribute(node, 'url');
      if (href) {
        const resolved = resolveHttpUrl(href, base);
        if (resolved) return resolved;
      }
    }
  }

  // 4. First <img> tag in description, summary, or contentHtml
  const candidates = [
    typeof entry.description === 'string' ? entry.description : '',
    typeof entry.summary === 'string' ? entry.summary : '',
    contentHtml,
  ];
  for (const html of candidates) {
    if (!html) continue;
    const match = /<img\s+[^>]*src=["']([^"']+)["']/i.exec(html);
    if (match && match[1]) {
      const src = match[1].trim();
      if (!src.startsWith('data:') && !src.includes('1x1') && !src.includes('spacer')) {
        const resolved = resolveHttpUrl(src, base);
        if (resolved) return resolved;
      }
    }
  }

  return undefined;
}

function isImageExtension(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(jpe?g|png|webp|gif|avif|svg)$/i.test(path);
  } catch {
    return false;
  }
}

function entrySnippet(
  entry: XmlNode,
  kind: 'rss' | 'atom',
  contentHtml: string,
): string | undefined {
  const rawSummary =
    kind === 'atom'
      ? (entry.summary ?? entry.content)
      : (entry.description ?? entry.encoded ?? entry.content);
  let text = '';
  if (typeof rawSummary === 'string') {
    text = stripHtml(rawSummary);
  } else if (contentHtml) {
    text = stripHtml(contentHtml);
  }
  if (!text) return undefined;
  if (text.length > 160) {
    return text.slice(0, 160).trim() + ' [...]';
  }
  return text;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}
