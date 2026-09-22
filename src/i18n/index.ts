import { zhTW } from './zh-TW';

export type Language = 'auto' | 'en' | 'zh-TW';
export type Locale = Exclude<Language, 'auto'>;
export type MessageKey = keyof typeof zhTW;
let locale: Locale = 'en';

export function normalizeLanguage(value: unknown): Language {
  return value === 'en' || value === 'zh-TW' ? value : 'auto';
}

/** Obsidian uses zh-TW; accept standard regional and script aliases too. */
export function resolveLocale(language: Language, obsidianLanguage: string): Locale {
  if (language !== 'auto') return language;
  return /^zh-(tw|hk|mo|hant)(-|$)/i.test(obsidianLanguage.replaceAll('_', '-')) ? 'zh-TW' : 'en';
}

/** Set once on plugin load so open drafts and running jobs retain their language. */
export function configureLanguage(language: Language, obsidianLanguage: string): void {
  locale = resolveLocale(language, obsidianLanguage);
}
export function getLocale(): Locale { return locale; }

export function t(key: MessageKey, values: Record<string, string | number> = {}): string {
  const text: string = locale === 'zh-TW' ? zhTW[key] : key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => Object.hasOwn(values, name) ? String(values[name]) : match);
}

/** Translate known service messages at the UI boundary; preserve external diagnostics. */
export function translateMessage(message: string): string {
  if (Object.hasOwn(zhTW, message)) return t(message as MessageKey);
  const key = (Object.keys(zhTW) as MessageKey[]).find(key => zhTW[key] === message);
  return key ? t(key) : message;
}
