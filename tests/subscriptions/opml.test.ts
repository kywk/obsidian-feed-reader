import { describe, expect, it } from 'vitest';
import { parseSubscriptions, serializeSubscriptions } from '../../src/subscriptions/codec';
import { SubscriptionService } from '../../src/subscriptions/service';

const wrap = (body: string, version = '2.0'): string => `<opml version="${version}"><head><title>Subscriptions</title></head><body>${body}</body></opml>`;
const feed = '<outline type="rss" text="A &amp; B" xmlUrl="https://example.com/rss?a=1&amp;b=2"/>';
const parse = (text: string) => parseSubscriptions(text, 'opml');
const memberships = (document: ReturnType<typeof parse>) => document.feeds.map(item => ({
  url: item.url, title: item.title, folders: item.folderIds.map(id => document.folders.find(folder => folder.id === id)!.title).sort(),
})).sort((a, b) => a.url.localeCompare(b.url));

describe('OPML exchange', () => {
  it.each(['1.0', '1.1', '2.0'])('imports version %s, entities and title fallback', version => {
    expect(parse(wrap(feed, version)).feeds[0]).toMatchObject({ title: 'A & B', url: 'https://example.com/rss?a=1&b=2', folderIds: [] });
    expect(parse(wrap('<outline title="Preferred" text="Fallback" xmlUrl="https://example.com"/>')).feeds[0]?.title).toBe('Preferred');
    expect(parse(wrap('<outline xmlUrl="https://example.com"/>')).feeds[0]?.title).toBe('https://example.com/');
  });
  it('flattens nested folders, unions duplicate memberships and preserves empty folders', () => {
    const doc = parse(wrap(`<outline text="Tech"><outline text="AI">${feed}</outline></outline><outline text="News">${feed}</outline><outline text="Empty"/>`));
    expect(doc.folders.map(f => f.title)).toEqual(['Tech', 'Tech / AI', 'News', 'Empty']);
    expect(memberships(doc)[0]?.folders).toEqual(['News', 'Tech / AI']);
    expect(doc.feeds).toHaveLength(1);
    const restored = parse(serializeSubscriptions(doc, 'opml'));
    expect(memberships(restored)).toEqual(memberships(doc));
    expect(restored.folders.map(f => f.title)).toEqual(doc.folders.map(f => f.title));
  });
  it('round trips unfiled feeds, special characters and empty subscriptions', () => {
    const doc = parse(wrap(`<outline text="&quot;Tech &amp; &lt;News&gt;&quot;">${feed}</outline><outline text="Other" xmlUrl="https://example.com/rss?a=2"/>`));
    expect(memberships(parse(serializeSubscriptions(doc, 'opml')))).toEqual(memberships(doc));
    expect(parse(serializeSubscriptions({ version: 1, folders: [], feeds: [] }, 'opml'))).toEqual({ version: 1, folders: [], feeds: [] });
  });
  it.each([
    'not xml', '<opml version="2.0"><body></opml>', '<rss/>', '<opml version="2.0"/>',
    wrap('<outline type="rss" text="Missing"/>'), wrap('<outline xmlUrl="javascript:alert(1)"/>'),
    wrap('<outline xmlUrl=""/>'), wrap('<outline/>'),
    '<!DOCTYPE opml [<!ENTITY x "test">]>' + wrap(feed),
    wrap('<outline text="A / B"/><outline text="A"><outline text="B"/></outline>'),
  ])('rejects invalid or ambiguous documents: %s', input => {
    expect(() => parse(input)).toThrow();
  });
  it('rejects indistinguishable same-title export folders', () => {
    expect(() => serializeSubscriptions({ version: 1, folders: [{ id: 'a', title: 'Same' }, { id: 'b', title: 'Same' }], feeds: [] }, 'opml')).toThrow(/duplicate folder/);
  });
  it('preserves existing and retired source IDs across merge, replacement and restart', async () => {
    const files = new Map<string, string>();
    const storage = { read: async (p: string) => files.get(p) ?? null, write: async (p: string, s: string) => { files.set(p, s); } };
    files.set('feeds.yaml', serializeSubscriptions({ version: 1, folders: [{ id: 'custom-folder', title: 'News' }], feeds: [{ id: 'custom-id', title: 'My title', url: 'https://example.com/rss?a=1&b=2', folderIds: ['custom-folder'] }] }, 'yaml'));
    const service = new SubscriptionService(storage, 'feeds.yaml');
    await service.start();
    const incoming = wrap(`<outline text="News">${feed}</outline><outline text="Extra">${feed}</outline>`);
    await service.import(incoming, 'opml', 'merge');
    await service.import(incoming, 'opml', 'merge');
    expect(service.getSnapshot().document.folders).toHaveLength(2);
    expect(service.getSnapshot().document.feeds[0]).toMatchObject({ id: 'custom-id', title: 'My title' });
    await service.import(incoming, 'opml', 'replace');
    expect(service.getSnapshot().document.feeds[0]?.id).toBe('custom-id');
    await service.unsubscribe('custom-id');
    const restarted = new SubscriptionService(storage, 'feeds.yaml');
    await restarted.start();
    await restarted.import(incoming, 'opml', 'merge');
    expect(restarted.getSnapshot().document.feeds[0]?.id).toBe('custom-id');
    expect(parseSubscriptions(files.get('feeds.yaml')!, 'yaml')).toEqual(restarted.getSnapshot().document);
    const before = new Map(files);
    await expect(restarted.import(wrap('<outline type="rss"/>'), 'opml', 'replace')).rejects.toThrow();
    expect(files).toEqual(before);
  });
});
