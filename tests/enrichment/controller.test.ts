import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkdownView, type Plugin, type TFile } from 'obsidian';
import type { EnrichmentDependencies, NoteAccess } from '../../src/enrichment/service';

const mocks = vi.hoisted(() => ({ enrich: vi.fn(), summarize: vi.fn(), notices: [] as (string | DocumentFragment)[] }));
vi.mock('obsidian', () => ({
  MarkdownView: class {},
  TFile: class {},
  Modal: class {},
  Setting: class {},
  requestUrl: vi.fn(),
  Notice: class { constructor(message: string | DocumentFragment) { mocks.notices.push(message); } hide() {} },
}));
vi.mock('../../src/enrichment/service', () => ({ enrichNote: mocks.enrich }));
vi.mock('../../src/enrichment/agents', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/enrichment/agents')>(), summarizeWithAgent: mocks.summarize,
}));
import { EnrichmentController } from '../../src/enrichment/controller';
import { DEFAULT_ENRICHMENT } from '../../src/enrichment/config';

let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM('<!doctype html>');
  vi.stubGlobal('document', dom.window.document);
  mocks.notices.length = 0;
  mocks.enrich.mockReset();
  mocks.summarize.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); dom.window.close(); });

function setup() {
  const file = { path: 'article.md', extension: 'md' } as TFile;
  let active: { file: TFile } | null = { file };
  const commands: { id: string; checkCallback: (checking: boolean) => boolean }[] = [];
  const cleanups: (() => void)[] = [];
  const leaves: { view: MarkdownView }[] = [];
  let text = 'Original article';
  const app = {
    loadLocalStorage: () => null,
    saveLocalStorage: vi.fn(),
    workspace: { getActiveViewOfType: () => active, getLeavesOfType: () => leaves },
    vault: {
      read: vi.fn(async () => text),
      process: vi.fn(async (_file: TFile, update: (current: string) => string) => { text = update(text); }),
    },
  };
  const plugin = { app, addCommand: (command: typeof commands[number]) => commands.push(command), register: (cleanup: () => void) => cleanups.push(cleanup) };
  const controller = new EnrichmentController(plugin as unknown as Plugin, () => structuredClone(DEFAULT_ENRICHMENT));
  controller.register();
  return { app, file, controller, commands, cleanups, leaves, activate: (next: typeof active) => { active = next; }, content: () => text, edit: (next: string) => { text = next; } };
}

function editorView(file: TFile, initial: string) {
  let text = initial;
  const editor = {
    getValue: () => text,
    lineCount: () => text.split('\n').length,
    lastLine: () => text.split('\n').length - 1,
    getLine: (line: number) => text.split('\n')[line] ?? '',
    offsetToPos: (offset: number) => { const lines = text.slice(0, offset).split('\n'); return { line: lines.length - 1, ch: lines.at(-1)!.length }; },
    replaceRange: vi.fn((value: string) => { text = value; }),
  };
  const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { file, editor });
  return { view, editor, edit: (next: string) => { text = next; } };
}

it('registers three commands available only with an active Markdown file', () => {
  const context = setup();
  expect(context.commands.map(command => command.id)).toEqual(['article-fetch', 'article-summarize', 'article-both']);
  for (const command of context.commands) expect(command.checkCallback(true)).toBe(true);
  expect(mocks.enrich).not.toHaveBeenCalled();
  context.activate(null);
  for (const command of context.commands) expect(command.checkCallback(false)).toBe(false);
  context.activate({ file: { extension: 'pdf' } as TFile });
  expect(context.commands[0]!.checkCallback(true)).toBe(false);
});

it('captures the starting file even after the active note changes and rejects stale disk content', async () => {
  let access!: NoteAccess;
  let finish!: (value: boolean) => void;
  mocks.enrich.mockImplementation((note: NoteAccess) => { access = note; return new Promise(resolve => { finish = resolve; }); });
  const context = setup();
  context.commands[0]!.checkCallback(false);
  context.activate({ file: { path: 'other.md', extension: 'md' } as TFile });
  expect(await access.read()).toBe('Original article');
  expect(context.app.vault.read).toHaveBeenCalledWith(context.file);
  context.edit('New user edit');
  expect(await access.compareAndWrite('Original article', 'Fetched article')).toBe(false);
  expect(context.content()).toBe('New user edit');
  expect(await access.compareAndWrite('New user edit', 'Fetched article')).toBe(true);
  expect(context.app.vault.process).toHaveBeenLastCalledWith(context.file, expect.any(Function));
  finish(true);
  await vi.waitFor(() => expect(mocks.notices).toContain('文章筆記已更新'));
});

it('prevents duplicate work on the same file and cancellation prevents writes', async () => {
  let access!: NoteAccess;
  let signal!: AbortSignal;
  let finish!: (value: boolean) => void;
  mocks.enrich.mockImplementation((note: NoteAccess, _action: unknown, _settings: unknown, _deps: EnrichmentDependencies, value: AbortSignal) => {
    access = note; signal = value; return new Promise(resolve => { finish = resolve; });
  });
  const context = setup();
  context.commands[0]!.checkCallback(false);
  context.commands[1]!.checkCallback(false);
  expect(mocks.enrich).toHaveBeenCalledTimes(1);
  expect(mocks.notices).toContain('此筆記已有工作進行中');
  const fragment = mocks.notices.find(item => typeof item !== 'string') as DocumentFragment;
  fragment.querySelector('button')!.click();
  expect(signal.aborted).toBe(true);
  await expect(access.compareAndWrite('Original article', 'Replacement')).rejects.toThrow('取消');
  expect(context.content()).toBe('Original article');
  finish(false);
});

it('unload aborts pending work and prevents late writes', async () => {
  let access!: NoteAccess;
  let signal!: AbortSignal;
  let finish!: (value: boolean) => void;
  mocks.enrich.mockImplementation((note: NoteAccess, _action: unknown, _settings: unknown, _deps: EnrichmentDependencies, value: AbortSignal) => {
    access = note; signal = value; return new Promise(resolve => { finish = resolve; });
  });
  const context = setup();
  context.commands[2]!.checkCallback(false);
  context.cleanups[0]!();
  expect(signal.aborted).toBe(true);
  await expect(access.compareAndWrite('Original article', 'Late result')).rejects.toThrow('取消');
  expect(context.app.vault.process).not.toHaveBeenCalled();
  finish(false);
});

it('reads unsaved editor text and refuses writes if any open editor changed', async () => {
  let access!: NoteAccess;
  let finish!: (value: boolean) => void;
  mocks.enrich.mockImplementation((note: NoteAccess) => { access = note; return new Promise(resolve => { finish = resolve; }); });
  const context = setup();
  const first = editorView(context.file, 'Unsaved article');
  const second = editorView(context.file, 'Unsaved article');
  context.leaves.push({ view: first.view }, { view: second.view });
  context.commands[0]!.checkCallback(false);
  expect(await access.read()).toBe('Unsaved article');
  expect(context.app.vault.read).not.toHaveBeenCalled();
  second.edit('New unsaved thought');
  expect(await access.compareAndWrite('Unsaved article', 'Result')).toBe(false);
  expect(first.editor.replaceRange).not.toHaveBeenCalled();
  expect(second.editor.replaceRange).not.toHaveBeenCalled();
  expect(context.app.vault.process).not.toHaveBeenCalled();
  second.edit('Unsaved article');
  expect(await access.compareAndWrite('Unsaved article', 'Result')).toBe(true);
  expect(first.editor.getValue()).toBe('Result');
  expect(second.editor.getValue()).toBe('Result');
  expect(context.app.vault.process).not.toHaveBeenCalled();
  finish(true);
});

it('unload cancels settings connection tests without sending vault content', async () => {
  let signal!: AbortSignal;
  mocks.summarize.mockImplementation((_config, options: { signal: AbortSignal; article: string }) => {
    signal = options.signal;
    expect(options.article).not.toContain('Original article');
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  });
  const context = setup();
  const pending = context.controller.test(context.controller.local.agents[0]!);
  const rejected = expect(pending).rejects.toThrow('cancelled');
  context.controller.dispose();
  expect(signal.aborted).toBe(true);
  await rejected;
});
