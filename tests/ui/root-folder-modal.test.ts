import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {
    contentEl = document.createElement('div');
    titleEl = document.createElement('h2');
    open() {
      document.body.append(this.contentEl);
      (this as unknown as { onOpen(): void }).onOpen();
    }
    close() {
      (this as unknown as { onClose(): void }).onClose();
      this.contentEl.remove();
    }
  },
  Setting: class {
    el: HTMLElement;
    constructor(parent: HTMLElement) {
      this.el = document.createElement('div');
      parent.append(this.el);
    }
    setName(name: string) {
      this.el.setAttribute('data-name', name);
      return this;
    }
    setDesc() {
      return this;
    }
    addButton(configure: (value: unknown) => void) {
      const button = document.createElement('button');
      this.el.append(button);
      const component = {
        setCta() {
          return component;
        },
        setButtonText(value: string) {
          button.textContent = value;
          return component;
        },
        setDisabled(value: boolean) {
          button.disabled = value;
          return component;
        },
        onClick(handler: () => void) {
          button.addEventListener('click', handler);
          return component;
        },
      };
      configure(component);
      return this;
    }
  },
}));

import { RootFolderChangeModal, promptRootFolderAction, type RootFolderChoice } from '../../src/ui/root-folder-modal';

beforeEach(() => {
  const dom = new JSDOM('<!doctype html><body></body>');
  Object.assign(globalThis, { document: dom.window.document, Event: dom.window.Event });
  const prototype = dom.window.HTMLElement.prototype;
  Object.assign(prototype, {
    empty(this: HTMLElement) {
      this.replaceChildren();
    },
    setText(this: HTMLElement, text: string) {
      this.textContent = text;
    },
    createEl(this: HTMLElement, tag: string, options: { text?: string; attr?: Record<string, string> } = {}) {
      const el = document.createElement(tag);
      if (options.text) el.textContent = options.text;
      for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
      this.append(el);
      return el;
    },
  });
});

describe('RootFolderChangeModal', () => {
  it('renders modal with options to move files or create new source', () => {
    let chosen: RootFolderChoice = null;
    const modal = new RootFolderChangeModal({} as never, 'Feed Reader', 'New Feeds', choice => {
      chosen = choice;
    });
    modal.open();

    expect(modal.titleEl.textContent).toBe('Change Feed Reader root folder');
    expect(modal.contentEl.textContent).toContain('The destination folder "New Feeds" is empty');
    expect(modal.contentEl.textContent).toContain('Feed Reader');

    const moveSetting = modal.contentEl.querySelector('[data-name="Move original files"]');
    expect(moveSetting).not.toBeNull();
    const moveBtn = moveSetting!.querySelector('button');
    expect(moveBtn?.textContent).toBe('Move files');

    const newSourceSetting = modal.contentEl.querySelector('[data-name="Create new RSS source"]');
    expect(newSourceSetting).not.toBeNull();
    const newSourceBtn = newSourceSetting!.querySelector('button');
    expect(newSourceBtn?.textContent).toBe('Create new source');
  });

  it('resolves with "move" when Move files button is clicked', () => {
    let chosen: RootFolderChoice = null;
    const modal = new RootFolderChangeModal({} as never, 'Feed Reader', 'New Feeds', choice => {
      chosen = choice;
    });
    modal.open();

    const moveBtn = modal.contentEl.querySelector('[data-name="Move original files"] button') as HTMLButtonElement;
    moveBtn.click();
    expect(chosen).toBe('move');
  });

  it('resolves with "create-new" when Create new source button is clicked', () => {
    let chosen: RootFolderChoice = null;
    const modal = new RootFolderChangeModal({} as never, 'Feed Reader', 'New Feeds', choice => {
      chosen = choice;
    });
    modal.open();

    const newSourceBtn = modal.contentEl.querySelector('[data-name="Create new RSS source"] button') as HTMLButtonElement;
    newSourceBtn.click();
    expect(chosen).toBe('create-new');
  });

  it('resolves with null when Cancel button is clicked', () => {
    let chosen: RootFolderChoice = 'move';
    const modal = new RootFolderChangeModal({} as never, 'Feed Reader', 'New Feeds', choice => {
      chosen = choice;
    });
    modal.open();

    const buttons = [...modal.contentEl.querySelectorAll('button')];
    const cancelBtn = buttons.find(b => b.textContent === 'Cancel')!;
    cancelBtn.click();
    expect(chosen).toBeNull();
  });

  it('resolves promptRootFolderAction via promise', async () => {
    const promise = promptRootFolderAction({} as never, 'Feed Reader', 'MyFeeds');
    const moveBtn = document.querySelector('[data-name="Move original files"] button') as HTMLButtonElement;
    expect(moveBtn).not.toBeNull();
    moveBtn.click();
    const result = await promise;
    expect(result).toBe('move');
  });
});
