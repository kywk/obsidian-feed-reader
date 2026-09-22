import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { FeedFolder, FeedSource, SubscriptionDocument } from '../domain/models';

export type SubscriptionFormat = 'yaml' | 'toml';

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
  return format === 'toml'
    ? stringifyToml(valid as unknown as Record<string, unknown>)
    : stringifyYaml(valid, { lineWidth: 0 });
}

export function emptySubscriptionDocument(): SubscriptionDocument {
  return { version: 1, folders: [], feeds: [] };
}
