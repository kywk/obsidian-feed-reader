import { MarkdownView, Modal, Notice, Setting, TFile, requestUrl, type App, type Plugin } from 'obsidian';
import { DEFAULT_AGENT_CONFIGS, detectAgents, summarizeWithAgent, type AgentConfig, type DetectedAgent } from './agents';
import { fetchArticle } from './fetch';
import type { EnrichmentSettings } from './config';
import { enrichNote, type EnrichmentAction } from './service';

export interface LocalAgents { agents: AgentConfig[]; defaultId: string; detected: DetectedAgent[]; }
const LOCAL_KEY = 'vault-feed-reader:local-agents:v1';

class ChoiceModal extends Modal {
  private settled = false;
  constructor(app: App, private title: string, private options: string[], private resolve: (value: number | null) => void, private preview?: string) { super(app); }
  onOpen(): void {
    this.titleEl.setText(this.title);
    if (this.preview !== undefined) {
      this.contentEl.createEl('p', { text: '筆記在執行期間已變更。以下是以啟動時內容產生的完整結果；套用會取代目前筆記，包含期間新增的編輯。可複製結果自行合併，或取消保留目前筆記。' });
      const text = this.contentEl.createEl('textarea', { cls: 'vfr-enrichment-preview', attr: { 'aria-label': '完整結果', readonly: 'true' } });
      text.value = this.preview;
      text.rows = 20;
    }
    this.options.forEach((label, index) => new Setting(this.contentEl).setName(label).addButton(button => button.setButtonText('選擇').onClick(() => this.finish(index))));
    new Setting(this.contentEl).addButton(button => button.setButtonText('取消').onClick(() => this.finish(null)));
  }
  private finish(value: number | null): void { this.settled = true; this.resolve(value); this.close(); }
  onClose(): void { if (!this.settled) this.resolve(null); this.contentEl.empty(); }
}

export class EnrichmentController {
  local: LocalAgents;
  private stopped = false;
  private jobs = new Map<TFile, AbortController>();
  private tests = new Set<AbortController>();
  constructor(private plugin: Plugin, private settings: () => EnrichmentSettings) {
    const stored: Partial<LocalAgents> | null = plugin.app.loadLocalStorage(LOCAL_KEY);
    this.local = {
      agents: Array.isArray(stored?.agents) ? stored.agents : DEFAULT_AGENT_CONFIGS.map(agent => ({ ...agent })),
      defaultId: typeof stored?.defaultId === 'string' ? stored.defaultId : 'codex',
      detected: Array.isArray(stored?.detected) ? stored.detected : [],
    };
  }
  register(): void {
    for (const [action, name] of [['fetch', '抓取原文全文'], ['summarize', '產生 AI 摘要'], ['both', '抓取全文並摘要']] as const) {
      this.plugin.addCommand({ id: `article-${action}`, name, checkCallback: checking => {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file;
        if (!file || file.extension !== 'md') return false;
        if (!checking) void this.run(file, action);
        return true;
      } });
    }
    this.plugin.register(() => this.dispose());
  }
  saveLocal(next: LocalAgents): void {
    this.plugin.app.saveLocalStorage(LOCAL_KEY, next);
    this.local = next;
  }
  async detect(): Promise<DetectedAgent[]> {
    const detected = await detectAgents(this.local.agents);
    if (!this.stopped) this.saveLocal({ ...this.local, detected });
    return detected;
  }
  async test(config: AgentConfig, signal?: AbortSignal): Promise<string> {
    const abort = new AbortController();
    const cancel = (): void => abort.abort();
    if (this.stopped || signal?.aborted) abort.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    this.tests.add(abort);
    try { return await summarizeWithAgent(config, { article: 'This is a connection test. No vault content is included.', prompt: 'Reply only with OK.', signal: abort.signal, timeoutMs: 60_000 }); }
    finally { signal?.removeEventListener('abort', cancel); this.tests.delete(abort); }
  }
  private choose(title: string, options: string[], signal: AbortSignal, preview?: string): Promise<number | null> {
    if (signal.aborted || this.stopped) return Promise.resolve(null);
    return new Promise(resolve => {
      const modal = new ChoiceModal(this.plugin.app, title, options, value => { signal.removeEventListener('abort', close); resolve(value); }, preview);
      const close = (): void => modal.close();
      signal.addEventListener('abort', close, { once: true });
      modal.open();
    });
  }
  private async run(file: TFile, action: EnrichmentAction): Promise<void> {
    if (this.jobs.has(file)) { new Notice('此筆記已有工作進行中'); return; }
    const abort = new AbortController();
    this.jobs.set(file, abort);
    const message = document.createDocumentFragment();
    message.append(document.createTextNode('文章處理中… '));
    const cancel = document.createElement('button');
    cancel.textContent = '取消'; cancel.addEventListener('click', () => abort.abort(), { once: true }); message.append(cancel);
    const notice = new Notice(message, 0);
    const app = this.plugin.app;
    // Snapshot settings and selected agent for the whole operation.
    const settings = structuredClone(this.settings());
    const agent = this.local.agents.find(item => item.id === this.local.defaultId);
    const openEditors = (): MarkdownView[] => app.workspace.getLeavesOfType('markdown')
      .map(leaf => leaf.view).filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === file);
    try {
      const wrote = await enrichNote({
        read: async () => openEditors()[0]?.editor.getValue() ?? await app.vault.read(file),
        compareAndWrite: async (expected, next) => {
          if (this.stopped || abort.signal.aborted) throw new Error('工作已取消');
          // The visible editor can be newer than disk. Update through its undo-aware API
          // synchronously, leaving Obsidian to save its own buffer.
          const views = openEditors();
          if (views.length) {
            if (views.some(view => view.editor.getValue() !== expected)) return false;
            for (const view of views) {
              if (view.editor.getValue() === next) continue; // panes may share a buffer
              const end = view.editor.offsetToPos(expected.length);
              view.editor.replaceRange(next, { line: 0, ch: 0 }, end);
            }
            return true;
          }
          let written = false;
          await app.vault.process(file, current => {
            if (this.stopped || abort.signal.aborted) throw new Error('工作已取消');
            if (current !== expected) return current;
            written = true; return next;
          });
          return written;
        },
      }, action, settings, {
        fetch: async (url, signal) => (await fetchArticle(url, async target => {
          const response = await requestUrl({ url: target, throw: false });
          return { status: response.status, text: response.text, headers: response.headers };
        }, { signal })).markdown,
        summarize: (article, prompt, signal) => {
          if (!agent) throw new Error('請在設定選擇預設本地 Agent');
          return summarizeWithAgent(agent, { article, prompt, signal });
        },
        interaction: {
          choose: (title, options, signal) => this.choose(title, options, signal),
          review: async (result, signal) => (await this.choose('筆記內容已變更', ['以結果取代目前筆記'], signal, result)) === 0,
        },
      }, abort.signal);
      if (!this.stopped) new Notice(wrote ? '文章筆記已更新' : '已取消，筆記未變更');
    } catch (error) {
      if (!this.stopped) new Notice(abort.signal.aborted ? '工作已取消' : error instanceof Error ? error.message : String(error));
    } finally { notice.hide(); this.jobs.delete(file); }
  }
  dispose(): void {
    this.stopped = true;
    for (const job of this.jobs.values()) job.abort();
    for (const test of this.tests) test.abort();
    this.jobs.clear(); this.tests.clear();
  }
}
