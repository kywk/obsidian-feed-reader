import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  Plugin: class {},
  Modal: class {},
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
    addDropdown(configure: (dropdown: unknown) => void) {
      const el = document.createElement('select'); this.el.append(el);
      const component = {
        setDisabled(value: boolean) { el.disabled = value; return component; },
        addOptions(options: Record<string, string>) { for (const [value, label] of Object.entries(options)) { const option = document.createElement('option'); option.value = value; option.textContent = label; el.append(option); } return component; },
        setValue(value: string) { el.value = value; return component; },
        onChange(action: (value: string) => void) { el.addEventListener('change', () => action(el.value)); return component; },
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
  clickNamed(section, "Add heading rule");
  editInput(inputsNamed(section, "Heading text")[0]!, 'Full article');
  clickNamed(section, "Add whole-body rule");
  editInput(inputsNamed(section, "Property field")[0]!, 'type');
  editInput(inputsNamed(section, "Matching value")[0]!, 'clipping');
  clickNamed(section, "Add heading rule");
  editInput(inputsNamed(section, "Heading text")[1]!, '正文');
  const arrows = [...section.querySelectorAll('button')].filter(button => button.textContent === '↑');
  arrows[1]!.click();
  expect(section.textContent).toContain('Rule 1 · Whole body');
  editInput(inputsNamed(section, "Original URL fields")[0]!, '');
  clickNamed(section, "Apply article settings");
  await vi.waitFor(() => expect(section.textContent).toContain('Configure at least one original URL field'));
  expect(plugin.changeEnrichment).not.toHaveBeenCalled();
  expect(settings.enrichment.rules).toEqual([]);
  editInput(inputsNamed(section, "Original URL fields")[0]!, 'feed_reader_url, source');
  clickNamed(section, "Apply article settings");
  await vi.waitFor(() => expect(section.textContent).toContain('cannot save'));
  expect(inputsNamed(section, "Heading text").map(input => input.value)).toEqual(['Full article', '正文']);
  expect(inputsNamed(section, "Property field")[0]!.value).toBe('type');
  plugin.changeEnrichment.mockImplementation(async () => {});
  clickNamed(section, "Apply article settings");
  await vi.waitFor(() => expect(section.textContent).toContain("Article settings saved"));
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
  await vi.waitFor(() => expect(section.textContent).toContain('Codex · Detected'));
  editInput(inputsNamed(section, "Executable name or absolute path")[1]!, '/custom/bin/claude');
  editInput(inputsNamed(section, "Custom arguments")[1]!, '-p --model "preferred model"');
  const defaults = [...section.querySelectorAll('button')].filter(button => button.textContent === "Set as default");
  defaults[1]!.click();
  expect(controller.saveLocal).not.toHaveBeenCalled();
  expect(local.defaultId).toBe('codex');
  expect(local.agents[1]!.command).toBe('claude');
  editInput(inputsNamed(section, "Custom arguments")[1]!, '-p "unterminated');
  clickNamed(section, "Apply local settings");
  expect(controller.saveLocal).not.toHaveBeenCalled();
  expect(inputsNamed(section, "Executable name or absolute path")[1]!.value).toBe('/custom/bin/claude');
  editInput(inputsNamed(section, "Custom arguments")[1]!, '-p --model "preferred model"');
  clickNamed(section, "Apply local settings");
  expect(controller.saveLocal).toHaveBeenCalledWith(expect.objectContaining({ defaultId: 'claude', agents: expect.arrayContaining([
    expect.objectContaining({ id: 'claude', command: '/custom/bin/claude', args: '-p --model "preferred model"' }),
  ]) }));
  clickNamed(section, "Detect saved configurations again");
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

it('renders Chinese settings while preserving templates and saves language only on selection', async () => {
  const { configureLanguage } = await import('../../src/i18n');
  configureLanguage('zh-TW', 'en');
  try {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const before = structuredClone(settings);
    const changeLanguage = vi.fn(async (language: string) => { settings.language = language as typeof settings.language; });
    const tab = new FeedReaderSettingTab({} as never, { settings, changeLanguage } as never);
    tab.display();
    expect(tab.containerEl.textContent).toContain('訂閱 YAML');
    expect(tab.containerEl.textContent).toContain('文章全文與 AI 摘要');
    expect(tab.containerEl.textContent).toContain('停用並重新啟用');
    expect(settings).toEqual(before);
    const draftInput = inputsNamed(tab.containerEl, '文章保存資料夾')[0]!;
    editInput(draftInput, 'Unsaved folder');
    const select = tab.containerEl.querySelector('select')!;
    expect([...select.options].map(option => option.value)).toEqual(['auto', 'en', 'zh-TW']);
    select.value = 'en'; select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(changeLanguage).toHaveBeenCalledWith('en'));
    expect(inputsNamed(tab.containerEl, '文章保存資料夾')[0]!.value).toBe('Unsaved folder');
    expect(settings.noteBodyTemplate).toBe(before.noteBodyTemplate);
    expect(settings.enrichment).toEqual(before.enrichment);
  } finally { configureLanguage('en', 'en'); }
});

it('persists the language preference and rolls back after a failed write', async () => {
  const { default: FeedReaderPlugin } = await import('../../src/main');
  const { configureLanguage, getLocale } = await import('../../src/i18n');
  configureLanguage('en', 'en');
  const settings = structuredClone(DEFAULT_SETTINGS);
  const saveSettings = vi.fn(async () => {});
  const plugin = { settings, saveSettings };
  await FeedReaderPlugin.prototype.changeLanguage.call(plugin as never, 'zh-TW');
  expect(settings.language).toBe('zh-TW');
  expect(saveSettings).toHaveBeenCalledOnce();
  expect(getLocale()).toBe('en'); // Active UI changes only on reload.
  saveSettings.mockRejectedValueOnce(new Error('disk full'));
  await expect(FeedReaderPlugin.prototype.changeLanguage.call(plugin as never, 'en')).rejects.toThrow('disk full');
  expect(settings.language).toBe('zh-TW');
});
