import { JSDOM } from 'jsdom';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {}, Notice: class {},
  Modal: class {
    contentEl = document.createElement('div'); titleEl = document.createElement('h2');
    open() { document.body.append(this.contentEl); (this as unknown as { onOpen(): void }).onOpen(); }
    close() { (this as unknown as { onClose(): void }).onClose(); this.contentEl.remove(); }
  },
  Setting: class {
    el: HTMLElement;
    constructor(parent: HTMLElement) { this.el = document.createElement('div'); parent.append(this.el); }
    setName(name: string) { this.el.setAttribute('data-name', name); return this; }
    setDesc() { return this; }
    addText(configure: (value: unknown) => void) {
      const input = document.createElement('input'); this.el.append(input);
      const component = {
        setPlaceholder(value: string) { input.placeholder = value; return component; },
        setValue(value: string) { input.value = value; return component; },
        onChange(handler: (value: string) => void) { input.addEventListener('input', () => handler(input.value)); return component; },
      }; configure(component); return this;
    }
    addButton(configure: (value: unknown) => void) {
      const button = document.createElement('button'); this.el.append(button);
      const component = {
        setCta() { return component; },
        setButtonText(value: string) { button.textContent = value; return component; },
        setDisabled(value: boolean) { button.disabled = value; return component; },
        onClick(handler: () => void) { button.addEventListener('click', handler); return component; },
      }; configure(component); return this;
    }
  },
}));
import { AddSourceModal } from '../../src/ui/manage/source-modal';
import type { FeedTransportResponse } from '../../src/feeds/transport';

beforeEach(() => {
  const dom = new JSDOM('<!doctype html><body></body>');
  Object.assign(globalThis, { document: dom.window.document, Event: dom.window.Event });
  const prototype = dom.window.HTMLElement.prototype;
  Object.assign(prototype, {
    empty(this: HTMLElement) { this.replaceChildren(); },
    setText(this: HTMLElement, text: string) { this.textContent = text; },
    createEl(this: HTMLElement, tag: string, options: { attr?: Record<string, string> }) {
      const el = document.createElement(tag);
      for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
      this.append(el); return el;
    },
  });
});
function setup(response: () => Promise<FeedTransportResponse> = async () => ({ status: 200, body: '<rss><channel><title>Detected title</title></channel></rss>' })) {
  const addFeed = vi.fn(async (data: object) => ({ ...data, id: 'feed' }));
  const refresh = vi.fn(async () => {}), fetch = vi.fn(response);
  const service = { getSnapshot: () => ({ writable: true, document: { folders: [] } }), addFeed };
  const modal = new AddSourceModal({} as never, service as never, refresh, { fetch }); modal.open();
  const set = (name: string, value: string) => {
    const el = document.querySelector<HTMLInputElement>(`[data-name="${name}"] input`)!;
    el.value = value; el.dispatchEvent(new Event('input'));
  };
  const submit = () => [...document.querySelectorAll('button')].find(el => el.textContent === 'Add source')!.click();
  set('Feed URL', 'https://example.test/feed');
  return { modal, addFeed, refresh, fetch, set, submit };
}
it('URL-only submission detects a title, creates and refreshes one source', async () => {
  const { submit, fetch, addFeed, refresh } = setup(); submit(); submit();
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(addFeed).toHaveBeenCalledWith({ title: 'Detected title', url: 'https://example.test/feed', folderIds: [] });
});
it('handwritten titles bypass title detection', async () => {
  const { submit, set, fetch, addFeed } = setup(); set('Title', 'My title'); submit();
  await vi.waitFor(() => expect(addFeed).toHaveBeenCalled()); expect(fetch).not.toHaveBeenCalled();
});
it('preserves draft and allows manual recovery after a failed detection', async () => {
  const { submit, set, addFeed } = setup(async () => ({ status: 403, body: '' })); submit();
  await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('403'));
  expect(addFeed).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLInputElement>('[data-name="Feed URL"] input')?.value).toBe('https://example.test/feed');
  set('Title', 'Recovered title'); submit(); await vi.waitFor(() => expect(addFeed).toHaveBeenCalled());
});
it('does not replace a title entered while detection runs', async () => {
  let finish!: (value: FeedTransportResponse) => void;
  const { submit, set, addFeed } = setup(() => new Promise(resolve => { finish = resolve; })); submit(); set('Title', 'My newer title');
  finish({ status: 200, body: '<feed><title>Remote title</title></feed>' });
  await vi.waitFor(() => expect(addFeed).toHaveBeenCalledWith(expect.objectContaining({ title: 'My newer title' })));
});
it('closing prevents a late request from adding a source', async () => {
  let finish!: (value: FeedTransportResponse) => void;
  const { modal, submit, addFeed, refresh } = setup(() => new Promise(resolve => { finish = resolve; })); submit(); modal.close();
  finish({ status: 200, body: '<feed><title>Remote title</title></feed>' });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(addFeed).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
});
it('changing the URL during detection preserves the draft for another submission', async () => {
  let finish!: (value: FeedTransportResponse) => void;
  const { submit, set, addFeed } = setup(() => new Promise(resolve => { finish = resolve; })); submit(); set('Feed URL', 'https://other.test/feed');
  finish({ status: 200, body: '<feed><title>Old URL title</title></feed>' });
  await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('URL changed'));
  expect(addFeed).not.toHaveBeenCalled();
});
