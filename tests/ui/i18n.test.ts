import { afterEach, describe, expect, it } from 'vitest';
import { configureLanguage, getLocale, normalizeLanguage, resolveLocale, t, translateMessage } from '../../src/i18n';
import { zhTW } from '../../src/i18n/zh-TW';

afterEach(() => configureLanguage('en', 'en'));

describe('interface language', () => {
  it('follows supported Obsidian locales and falls back to English', () => {
    for (const code of ['zh-TW', 'zh_HK', 'zh-Hant', 'zh-Hant-TW', 'zh-MO']) expect(resolveLocale('auto', code)).toBe('zh-TW');
    for (const code of ['en', 'de', 'zh', 'zh-CN', '']) expect(resolveLocale('auto', code)).toBe('en');
    expect(resolveLocale('en', 'zh-TW')).toBe('en');
    expect(resolveLocale('zh-TW', 'en')).toBe('zh-TW');
    for (const value of [undefined, null, 'fr', {}, 'auto']) expect(normalizeLanguage(value)).toBe('auto');
  });
  it('uses explicit language and interpolates user text without translating it', () => {
    configureLanguage('zh-TW', 'en');
    expect(getLocale()).toBe('zh-TW');
    expect(t('Unsubscribe from {title}?', { title: 'Read {count} <新聞>' })).toBe('要取消訂閱「Read {count} <新聞>」嗎？');
    expect(t('{start}–{end} of {count} sources', { start: 1, end: 50, count: 60 })).toBe('第 1–50 個，共 60 個來源');
    configureLanguage('en', 'zh-TW');
    expect(t('Open RSS reader')).toBe('Open RSS reader');
    expect(translateMessage('原文網址有衝突，請選擇')).toBe('Conflicting original URLs; choose one');
    expect(translateMessage('HTTP 503: remote diagnostic')).toBe('HTTP 503: remote diagnostic');
  });
  it('provides nonempty translations with matching placeholders for every message', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
    for (const [key, value] of Object.entries(zhTW)) {
      expect(value.trim(), key).not.toBe('');
      expect(placeholders(value), key).toEqual(placeholders(key));
    }
  });
});
