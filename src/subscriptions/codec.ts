import { XMLParser } from 'fast-xml-parser';
import Builder from 'fast-xml-builder';
import { SyntaxValidator } from 'fast-xml-validator';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { FeedFolder, FeedSource, SubscriptionDocument } from '../domain/models';

export type SubscriptionFormat = 'yaml' | 'toml' | 'opml';

export class SubscriptionDocumentError extends Error {
  constructor(message: string, readonly details?: string) {
    super(message);
    this.name = 'SubscriptionDocumentError';
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SubscriptionDocumentError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SubscriptionDocumentError(`${label} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new SubscriptionDocumentError(`${label} must be an array of strings`);
  }
  return [...new Set(value as string[])];
}

function safeId(value: unknown, label: string): string {
  const id = string(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new SubscriptionDocumentError(`${label} is not a safe ID`);
  }
  return id;
}

export function normalizeFeedUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new SubscriptionDocumentError(`Invalid feed URL: ${value}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SubscriptionDocumentError(`Feed URL must use HTTP or HTTPS: ${value}`);
  }
  parsed.hash = '';
  return parsed.toString();
}

/** Stable, filename-safe FNV-1a digest used when a URL first becomes a source. */
export function sourceIdFromUrl(url: string): string {
  const normalized = normalizeFeedUrl(url);
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(normalized)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `feed-${hash.toString(16).padStart(16, '0')}`;
}

export function validateSubscriptionDocument(value: unknown): SubscriptionDocument {
  const root = object(value, 'Subscription document');
  if (root.version !== 1) throw new SubscriptionDocumentError('Subscription version must be 1');
  if (!Array.isArray(root.folders)) throw new SubscriptionDocumentError('folders must be an array');
  if (!Array.isArray(root.feeds)) throw new SubscriptionDocumentError('feeds must be an array');

  const folderIds = new Set<string>();
  const folders: FeedFolder[] = root.folders.map((entry, index) => {
    const item = object(entry, `folders[${index}]`);
    const id = safeId(item.id, `folders[${index}].id`);
    if (folderIds.has(id)) throw new SubscriptionDocumentError(`Duplicate folder ID: ${id}`);
    folderIds.add(id);
    return { id, title: string(item.title, `folders[${index}].title`) };
  });

  const feedIds = new Set<string>();
  const feedsByUrl = new Map<string, FeedSource>();
  for (const [index, entry] of root.feeds.entries()) {
    const item = object(entry, `feeds[${index}]`);
    const id = safeId(item.id, `feeds[${index}].id`);
    if (feedIds.has(id)) throw new SubscriptionDocumentError(`Duplicate feed ID: ${id}`);
    feedIds.add(id);
    const url = normalizeFeedUrl(string(item.url, `feeds[${index}].url`));
    const title = string(item.title, `feeds[${index}].title`);
    const references = stringArray(item.folderIds, `feeds[${index}].folderIds`);
    for (const folderId of references) {
      if (!folderIds.has(folderId)) {
        throw new SubscriptionDocumentError(`Feed ${id} references unknown folder ${folderId}`);
      }
    }
    const duplicate = feedsByUrl.get(url);
    if (duplicate) {
      duplicate.folderIds = [...new Set([...duplicate.folderIds, ...references])];
    } else {
      feedsByUrl.set(url, { id, url, title, folderIds: references });
    }
  }
  return { version: 1, folders, feeds: [...feedsByUrl.values()] };
}

export function parseSubscriptions(text: string, format: SubscriptionFormat): SubscriptionDocument {
  try {
    if (format === 'opml') return parseOpml(text);
    if (format === 'toml') return validateSubscriptionDocument(parseToml(text));
    const document = parseDocument(text, { uniqueKeys: true });
    if (document.errors.length > 0) {
      const error = document.errors[0];
      throw new SubscriptionDocumentError(error?.message ?? 'Invalid YAML');
    }
    return validateSubscriptionDocument(document.toJS());
  } catch (error) {
    if (error instanceof SubscriptionDocumentError) throw error;
    throw new SubscriptionDocumentError(
      `Invalid ${format.toUpperCase()} subscription document`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function serializeSubscriptions(document: SubscriptionDocument, format: SubscriptionFormat): string {
  const valid = validateSubscriptionDocument(document);
  if (format === 'opml') return serializeOpml(valid);
  return format === 'toml'
    ? stringifyToml(valid)
    : stringifyYaml(valid, { lineWidth: 0 });
}

export function emptySubscriptionDocument(): SubscriptionDocument {
  return { version: 1, folders: [], feeds: [] };
}

/** OPML is an exchange format; vault persistence remains YAML. */
function parseOpml(text: string): SubscriptionDocument {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new SubscriptionDocumentError('OPML must not contain DTD or entity declarations');
  try {
    SyntaxValidator.validate(text);
  } catch (error) {
    throw new SubscriptionDocumentError(`Invalid OPML XML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, parseTagValue: false,
    isArray: name => name === 'outline' }).parse(text) as Record<string, unknown>;
  const root = object(parsed.opml, 'OPML root');
  if (!['1.0', '1.1', '2.0'].includes(String(root['@_version']))) throw new SubscriptionDocumentError('Unsupported OPML version');
  if (!Object.hasOwn(root, 'body')) throw new SubscriptionDocumentError('OPML body is required');
  const body = root.body === '' ? {} : object(root.body, 'OPML body');
  const folders = new Map<string, FeedFolder>();
  const paths = new Map<string, string>();
  const feeds = new Map<string, FeedSource>();
  const label = (node: Record<string, unknown>): string => {
    for (const key of ['@_title', '@_text']) {
      const value = node[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };
  const visit = (value: unknown, path: string[], depth: number): void => {
    if (depth > 100) throw new SubscriptionDocumentError('OPML nesting exceeds 100 levels');
    if (value === undefined) return;
    if (!Array.isArray(value)) throw new SubscriptionDocumentError('Invalid OPML outlines');
    for (const entry of value) {
      const node = object(entry, 'OPML outline');
      const title = label(node);
      if (Object.hasOwn(node, '@_xmlUrl')) {
        const url = normalizeFeedUrl(string(node['@_xmlUrl'], 'OPML xmlUrl'));
        const folder = folders.get(path.join(' / '));
        const references = folder ? [folder.id] : [];
        const existing = feeds.get(url);
        if (existing) existing.folderIds = [...new Set([...existing.folderIds, ...references])];
        else feeds.set(url, { id: sourceIdFromUrl(url), url, title: title || url, folderIds: references });
        visit(node.outline, path, depth + 1);
      } else {
        const outlineType = typeof node['@_type'] === 'string' ? node['@_type'] : '';
        if (outlineType.toLowerCase() === 'rss') throw new SubscriptionDocumentError('RSS outline is missing xmlUrl');
        if (outlineType && outlineType !== 'rss') throw new SubscriptionDocumentError(`Unsupported OPML outline type: ${outlineType}`);
        if (!title) throw new SubscriptionDocumentError('OPML folder must have text or title');
        const next = [...path, title], name = next.join(' / '), identity = JSON.stringify(next);
        if (paths.has(name) && paths.get(name) !== identity) throw new SubscriptionDocumentError(`Ambiguous flattened OPML folder: ${name}`);
        paths.set(name, identity);
        if (!folders.has(name)) folders.set(name, { id: sourceIdFromUrl(`https://opml.invalid/${encodeURIComponent(name)}`).replace('feed-', 'folder-'), title: name });
        visit(node.outline, next, depth + 1);
      }
    }
  };
  visit(body.outline, [], 0);
  return validateSubscriptionDocument({ version: 1, folders: [...folders.values()], feeds: [...feeds.values()] });
}

function serializeOpml(document: SubscriptionDocument): string {
  // OPML cannot distinguish same-named flat folders on import.
  if (new Set(document.folders.map(folder => folder.title)).size !== document.folders.length) {
    throw new SubscriptionDocumentError('Rename duplicate folder titles before exporting OPML');
  }
  const outline = (feed: FeedSource): Record<string, unknown> => ({ '@_text': feed.title, '@_title': feed.title, '@_type': 'rss', '@_xmlUrl': feed.url });
  const outlines = [
    ...document.folders.map(folder => ({ '@_text': folder.title, outline: document.feeds.filter(feed => feed.folderIds.includes(folder.id)).map(outline) })),
    ...document.feeds.filter(feed => feed.folderIds.length === 0).map(outline),
  ];
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new Builder({ ignoreAttributes: false, format: true }).build({
    opml: { '@_version': '2.0', head: { title: 'Vault Feed Reader subscriptions' }, body: { outline: outlines } },
  });
}
