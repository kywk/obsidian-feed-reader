import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  PluginSettingTab: class { containerEl = document.createElement('div'); },
  Notice: class {},
  ItemView: class {
    contentEl: HTMLElement;
    constructor(leaf: { contentEl: HTMLElement }) { this.contentEl = leaf.contentEl; }
  },
  WorkspaceLeaf: class {},
  setIcon: () => {},
  Setting: class {
    el: HTMLElement;
    constructor(parent: HTMLElement) { this.el = document.createElement('div'); parent.append(this.el); }
    setName(value: string) { const el = document.createElement('span'); el.textContent = value; this.el.append(el); return this; }
    setHeading() { this.el.classList.add('setting-item-heading'); return this; }
    setDesc(value: string) { return this.setName(value); }
    addText(configure: (text: unknown) => void) { return this.addInput('input', configure); }
    addTextArea(configure: (text: unknown) => void) { return this.addInput('textarea', configure); }
    addInput(tag: string, configure: (text: unknown) => void) {
      const el = document.createElement(tag) as HTMLInputElement; this.el.append(el);
      const component = {
        inputEl: el,
        setValue(value: string) { el.value = value; return component; },
        setPlaceholder(value: string) { el.placeholder = value; return component; },
        onChange(action: (value: string) => void) { el.addEventListener('input', () => action(el.value)); return component; },
      };
      configure(component); return this;
    }
    addToggle(configure: (toggle: unknown) => void) {
      const component = { setValue() { return component; }, onChange() { return component; } };
      configure(component); return this;
    }
    addButton(configure: (button: unknown) => void) {
      const el = document.createElement('button'); this.el.append(el);
      const component = {
        setCta() { return component; },
        setButtonText(value: string) { el.textContent = value; return component; },
        setDisabled(value: boolean) { el.disabled = value; return component; },
        onClick(action: () => void) { el.addEventListener('click', action); return component; },
      };
      configure(component); return this;
    }
  },
}));

import { FeedReaderSettingTab, DEFAULT_SETTINGS } from '../../src/settings';

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://vault.test/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, KeyboardEvent: dom.window.KeyboardEvent });
  const prototype = dom.window.HTMLElement.prototype as HTMLElement & { empty?: () => void; createEl?: (tag: string, options?: Record<string, unknown>) => HTMLElement; createDiv?: (options?: Record<string, unknown>) => HTMLElement; addClass?: (name: string) => void };
  prototype.empty = function empty() { this.replaceChildren(); };
  prototype.addClass = function addClass(name: string) { this.classList.add(name); };
  prototype.setText = function setText(value: string) { this.textContent = value; };
  (prototype as unknown as { createEl: (tag: string, options?: Record<string, unknown>) => HTMLElement }).createEl = function createEl(this: HTMLElement, tag: string, options: Record<string, unknown> = {}) {
    const element = document.createElement(tag);
    const optionsRecord = options as { text?: string; cls?: string; type?: string; placeholder?: string; href?: string; attr?: Record<string, string> };
    if (optionsRecord.text !== undefined) element.textContent = optionsRecord.text;
    if (optionsRecord.cls) element.className = optionsRecord.cls;
    if (optionsRecord.type) element.setAttribute('type', optionsRecord.type);
    if (optionsRecord.placeholder) element.setAttribute('placeholder', optionsRecord.placeholder);
    if (optionsRecord.href) element.setAttribute('href', optionsRecord.href);
    for (const [name, value] of Object.entries(optionsRecord.attr ?? {})) element.setAttribute(name, value);
    this.append(element); return element;
  };
  (prototype as unknown as { createDiv: (options?: Record<string, unknown>) => HTMLElement }).createDiv = function createDiv(this: HTMLElement, options = {}) { return (this as unknown as { createEl: (tag: string, options?: Record<string, unknown>) => HTMLElement }).createEl('div', options); };
  (prototype as unknown as { createSpan: (options?: Record<string, unknown>) => HTMLElement }).createSpan = function createSpan(this: HTMLElement, options = {}) { return (this as unknown as { createEl: (tag: string, options?: Record<string, unknown>) => HTMLElement }).createEl('span', options); };
});

function clickNamed(root: Element, name: string): void {
  const button = [...root.querySelectorAll('button')].find(element => element.textContent === name);
  expect(button, `button ${name}`).toBeDefined();
  button!.click();
}

function inputsNamed(root: Element, name: string): HTMLInputElement[] {
  return [...root.querySelectorAll('span')].filter(element => element.textContent === name)
    .map(element => element.parentElement!.querySelector('input')!).filter(Boolean);
}

function editInput(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value; input.dispatchEvent(new Event('input'));
}

it('edits and reorders article rules as a draft and preserves them through validation and save failures', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.enrichment.rules = [];
  const plugin = { settings, changeEnrichment: vi.fn(async (): Promise<void> => { throw new Error('cannot save'); }) };
  const tab = new FeedReaderSettingTab({} as never, plugin as never);
  tab.display();
  const section = tab.containerEl.querySelector('.vfr-enrichment-settings')!;
  clickNamed(section, '新增標題規則');
  editInput(inputsNamed(section, '標題文字')[0]!, 'Full article');
  clickNamed(section, '新增全文條件');
  editInput(inputsNamed(section, 'Properties 欄位')[0]!, 'type');
  editInput(inputsNamed(section, '符合值')[0]!, 'clipping');
  clickNamed(section, '新增標題規則');
  editInput(inputsNamed(section, '標題文字')[1]!, '正文');
  const arrows = [...section.querySelectorAll('button')].filter(button => button.textContent === '↑');
  arrows[1]!.click();
  expect(section.textContent).toContain('規則 1 · 整份正文');
  editInput(inputsNamed(section, '原文網址欄位')[0]!, '');
  clickNamed(section, '套用文章設定');
  await vi.waitFor(() => expect(section.textContent).toContain('至少設定一個原文網址欄位'));
  expect(plugin.changeEnrichment).not.toHaveBeenCalled();
  expect(settings.enrichment.rules).toEqual([]);
  editInput(inputsNamed(section, '原文網址欄位')[0]!, 'feed_reader_url, source');
  clickNamed(section, '套用文章設定');
  await vi.waitFor(() => expect(section.textContent).toContain('cannot save'));
  expect(inputsNamed(section, '標題文字').map(input => input.value)).toEqual(['Full article', '正文']);
  expect(inputsNamed(section, 'Properties 欄位')[0]!.value).toBe('type');
  plugin.changeEnrichment.mockImplementation(async () => {});
  clickNamed(section, '套用文章設定');
  await vi.waitFor(() => expect(section.textContent).toContain('文章設定已儲存'));
  expect(plugin.changeEnrichment).toHaveBeenLastCalledWith(expect.objectContaining({
    urlFields: ['feed_reader_url', 'source'],
    rules: [
      { kind: 'body', property: 'type', value: 'clipping' },
      { kind: 'heading', heading: 'Full article' },
      { kind: 'heading', heading: '正文' },
    ],
  }));
  expect(settings.enrichment.rules).toEqual([]);
});

it('keeps local command edits and the default agent in a draft until Apply', async () => {
  const local = {
    agents: [
      { id: 'codex', kind: 'codex', name: 'Codex', command: 'codex', args: 'exec -' },
      { id: 'claude', kind: 'claude', name: 'Claude', command: 'claude', args: '-p' },
    ],
    defaultId: 'codex', detected: [],
  };
  const controller = { local, saveLocal: vi.fn(), detect: vi.fn(async () => [{ id: 'codex', installed: true }]), test: vi.fn() };
  const plugin = { settings: structuredClone(DEFAULT_SETTINGS), enrichment: controller };
  const tab = new FeedReaderSettingTab({} as never, plugin as never);
  tab.display();
  const section = tab.containerEl.querySelector('.vfr-enrichment-settings')!;
  await vi.waitFor(() => expect(section.textContent).toContain('Codex · 已偵測'));
  editInput(inputsNamed(section, '執行檔名稱或絕對路徑')[1]!, '/custom/bin/claude');
  editInput(inputsNamed(section, '自訂參數')[1]!, '-p --model "preferred model"');
  const defaults = [...section.querySelectorAll('button')].filter(button => button.textContent === '設為預設');
  defaults[1]!.click();
  expect(controller.saveLocal).not.toHaveBeenCalled();
  expect(local.defaultId).toBe('codex');
  expect(local.agents[1]!.command).toBe('claude');
  editInput(inputsNamed(section, '自訂參數')[1]!, '-p "unterminated');
  clickNamed(section, '套用本機設定');
  expect(controller.saveLocal).not.toHaveBeenCalled();
  expect(inputsNamed(section, '執行檔名稱或絕對路徑')[1]!.value).toBe('/custom/bin/claude');
  editInput(inputsNamed(section, '自訂參數')[1]!, '-p --model "preferred model"');
  clickNamed(section, '套用本機設定');
  expect(controller.saveLocal).toHaveBeenCalledWith(expect.objectContaining({ defaultId: 'claude', agents: expect.arrayContaining([
    expect.objectContaining({ id: 'claude', command: '/custom/bin/claude', args: '-p --model "preferred model"' }),
  ]) }));
  clickNamed(section, '重新偵測已儲存設定');
  await vi.waitFor(() => expect(controller.detect).toHaveBeenCalledTimes(2));
  tab.hide();
});

it('previews unsaved edits, blocks invalid templates, and keeps the draft after a failed Apply', async () => {
  const plugin = {
    settings: { ...DEFAULT_SETTINGS },
    changeNoteTemplates: vi.fn(async (): Promise<void> => { throw new Error('disk full'); }),
  };
  const tab = new FeedReaderSettingTab({} as never, plugin as never);
  tab.display();
  const section = tab.containerEl.querySelector('.vfr-template-settings')!;
  const preview = section.querySelector('pre')!;
  const button = [...section.querySelectorAll('button')].find(el => el.textContent === 'Apply templates')!;
  const body = section.querySelector<HTMLTextAreaElement>('[aria-label="Body template"]')!;
  const properties = section.querySelector<HTMLTextAreaElement>('[aria-label="Custom Properties"]')!;
  expect(preview.textContent).toContain('feed_reader_id:');
  body.value = '{{typo}}'; body.dispatchEvent(new Event('input'));
  expect(button.disabled).toBe(true);
  expect(section.textContent).toContain('Unknown template variable');
  body.value = '## Thoughts\n\n{{content}}'; body.dispatchEvent(new Event('input'));
  properties.value = 'tags: [rss]'; properties.dispatchEvent(new Event('input'));
  expect(preview.textContent).toContain('## Thoughts');
  expect(preview.textContent).toContain('  - rss');
  expect(plugin.changeNoteTemplates).not.toHaveBeenCalled();
  button.click();
  await vi.waitFor(() => expect(section.textContent).toContain('disk full'));
  expect(body.value).toContain('## Thoughts');
  expect(plugin.settings.noteBodyTemplate).toBe(DEFAULT_SETTINGS.noteBodyTemplate);
  plugin.changeNoteTemplates.mockImplementation(async () => {});
  button.click();
  await vi.waitFor(() => expect(section.textContent).toContain('Templates saved'));
  expect(plugin.changeNoteTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ noteBodyTemplate: body.value, notePropertiesTemplate: properties.value }));
});
