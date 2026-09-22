import { parseDocument } from 'yaml';

export interface NoteTemplates {
  noteFilenameTemplate: string;
  noteBodyTemplate: string;
  notePropertiesTemplate: string;
}

export const DEFAULT_NOTE_TEMPLATES: NoteTemplates = {
  noteFilenameTemplate: '{{date}} {{title}}',
  noteBodyTemplate: '# {{title}}\n\n{{content}}',
  notePropertiesTemplate: '',
};

export type TemplateContext = Record<'title' | 'feed' | 'link' | 'published' | 'created' | 'date' | 'content', string>;
const VARIABLES = new Set(['title', 'feed', 'link', 'published', 'created', 'date', 'content']);
const DATE_FORMATS = new Set(['YYYY-MM-DD', 'YYYY-MM-DD HH:mm', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DDTHH:mm:ss']);

export function escapeMarkdownText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]{}()#+\-.!|])/g, '\\$1');
}

/** Single pass: article text is never interpreted as another template. */
export function renderTemplate(template: string, context: TemplateContext, target: 'filename' | 'body' | 'property'): string {
  const remaining = template.replace(/\{\{([^{}]*)\}\}/g, '');
  if (remaining.includes('{{') || remaining.includes('}}')) throw new Error('Unclosed or malformed template variable');
  return template.replace(/\{\{([^{}]*)\}\}/g, (_match, expression: string) => {
    const colon = expression.indexOf(':');
    const name = (colon < 0 ? expression : expression.slice(0, colon)).trim();
    const format = colon < 0 ? undefined : expression.slice(colon + 1).trim();
    if (!VARIABLES.has(name)) throw new Error(`Unknown template variable: ${name}`);
    if (name === 'content' && target !== 'body') throw new Error('{{content}} is only available in the body template');
    let value = context[name as keyof TemplateContext];
    if (format !== undefined) {
      if (!['published', 'created', 'date'].includes(name) || !DATE_FORMATS.has(format)) {
        throw new Error(`Unsupported format: ${expression}. Dates support YYYY-MM-DD, YYYY-MM-DD HH:mm, YYYY-MM-DD HH:mm:ss or YYYY-MM-DDTHH:mm:ss (UTC)`);
      }
      if (value) {
        const date = new Date(value);
        const iso = date.toISOString();
        value = format === 'YYYY-MM-DD' ? iso.slice(0, 10)
          : format === 'YYYY-MM-DDTHH:mm:ss' ? iso.slice(0, 19)
            : iso.slice(0, format.endsWith(':ss') ? 19 : 16).replace('T', ' ');
      }
    }
    return target === 'body' && name !== 'content' ? escapeMarkdownText(value) : value;
  });
}

/** Parse the structure before substituting values so feed text cannot inject YAML. */
export function renderProperties(template: string, context: TemplateContext): Record<string, unknown> {
  if (!template.trim()) return {};
  const document = parseDocument(template, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`Invalid Properties YAML: ${document.errors[0]!.message}`);
  const value: unknown = document.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Properties must be a YAML mapping');
  const result: Record<string, unknown> = Object.create(null);
  const scalar = (item: unknown): unknown => {
    if (typeof item === 'string') return renderTemplate(item, context, 'property');
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return item;
    throw new Error('Property values must be text, numbers, booleans, null, or lists of these values');
  };
  for (const [key, item] of Object.entries(value)) {
    if (!key.trim() || key === 'title' || key.startsWith('feed_reader_') || ['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new Error(`Property "${key}" is reserved or invalid`);
    }
    if (key.includes('{{') || key.includes('}}')) throw new Error('Property names cannot contain template variables');
    result[key] = Array.isArray(item) ? item.map(scalar) : scalar(item);
  }
  return result;
}

export function validateNoteTemplates(templates: NoteTemplates): void {
  for (const value of Object.values(templates)) if (typeof value !== 'string') throw new Error('Templates must be text');
  if (!templates.noteFilenameTemplate.trim()) throw new Error('Filename template cannot be empty');
  if (!templates.noteBodyTemplate.trim()) throw new Error('Body template cannot be empty');
  const context: TemplateContext = { title: 'Example article', feed: 'Example feed', link: 'https://example.com/article', published: '2026-09-20T08:30:00.000Z', created: '2026-09-22T02:03:04.000Z', date: '2026-09-20', content: 'Example article content.' };
  renderTemplate(templates.noteFilenameTemplate, context, 'filename');
  renderTemplate(templates.noteBodyTemplate, context, 'body');
  renderProperties(templates.notePropertiesTemplate, context);
}
