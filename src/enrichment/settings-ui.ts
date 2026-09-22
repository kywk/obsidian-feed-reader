import { Setting } from 'obsidian';
import type { EnrichmentController } from './controller';
import { validateEnrichment, type EnrichmentSettings } from './config';
import { parseArguments, type AgentConfig } from './agents';

export function displayEnrichmentSettings(container: HTMLElement, current: EnrichmentSettings, save: (value: EnrichmentSettings) => Promise<void>, controller?: EnrichmentController): () => void {
  const section = container.createDiv({ cls: 'vfr-enrichment-settings' });
  new Setting(section).setName('文章全文與 AI 摘要').setHeading();
  section.createEl('p', { text: '僅命令面板的目前 Markdown 筆記。原文區塊內的人工編輯會被重抓取代；區塊外內容保留。' });
  const draft = structuredClone(current);
  const state = section.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
  new Setting(section).setName('原文網址欄位').setDesc('逗號分隔，依序查找；不同網址會提示選擇。')
    .addText(text => text.setValue(draft.urlFields.join(', ')).onChange(value => { draft.urlFields = value.split(',').map(v => v.trim()).filter(Boolean); }));
  new Setting(section).setName('附加原文標題').addText(text => text.setValue(draft.fullTextHeading).onChange(value => { draft.fullTextHeading = value; }));
  section.createEl('p', { text: '原文規則由上而下，第一個符合的規則優先。Properties 比對可用於 Web Clipper 模板，例如 type = clipping；請依自己的模板設定，不以網址存在推定全文。整份正文規則只供摘要取材，擷取全文仍另加區塊，不取代原筆記。' });
  const rules = section.createDiv();
  const renderRules = (): void => {
    rules.empty();
    draft.rules.forEach((rule, index) => {
      const row = rules.createDiv();
      new Setting(row).setName(`規則 ${index + 1} · ${rule.kind === 'heading' ? '標題區塊' : '整份正文'}`)
        .addButton(button => button.setButtonText('↑').setDisabled(index === 0).onClick(() => {
          [draft.rules[index - 1], draft.rules[index]] = [draft.rules[index]!, draft.rules[index - 1]!]; renderRules();
        }))
        .addButton(button => button.setButtonText('↓').setDisabled(index === draft.rules.length - 1).onClick(() => {
          [draft.rules[index + 1], draft.rules[index]] = [draft.rules[index]!, draft.rules[index + 1]!]; renderRules();
        }))
        .addButton(button => button.setButtonText('移除').onClick(() => { draft.rules.splice(index, 1); renderRules(); }));
      if (rule.kind === 'heading') new Setting(row).setName('標題文字').addText(text => text.setValue(rule.heading).onChange(value => { rule.heading = value; }));
      else {
        new Setting(row).setName('Properties 欄位').addText(text => text.setValue(rule.property).onChange(value => { rule.property = value; }));
        new Setting(row).setName('符合值').addText(text => text.setValue(rule.value).onChange(value => { rule.value = value; }));
      }
    });
  };
  renderRules();
  new Setting(section)
    .addButton(button => button.setButtonText('新增標題規則').onClick(() => { draft.rules.push({ kind: 'heading', heading: '' }); renderRules(); }))
    .addButton(button => button.setButtonText('新增全文條件').onClick(() => { draft.rules.push({ kind: 'body', property: '', value: '' }); renderRules(); }));
  new Setting(section).setName('摘要提示詞').setDesc('控制摘要內容；插件會另外要求同次生成主題 tags，合併既有標籤，並使用 JSON 回傳格式。').addTextArea(text => {
    text.setValue(draft.summaryPrompt).onChange(value => { draft.summaryPrompt = value; }); text.inputEl.rows = 5;
  });
  new Setting(section).addButton(button => button.setButtonText('套用文章設定').setCta().onClick(async () => {
    button.setDisabled(true);
    try { validateEnrichment(draft); await save(structuredClone(draft)); state.setText('文章設定已儲存'); }
    catch (error) { state.setText(error instanceof Error ? error.message : String(error)); }
    finally { button.setDisabled(false); }
  }));
  if (!controller) return () => {};
  new Setting(section).setName('本機 Agent').setHeading();
  section.createEl('p', { text: '沿用本機 CLI 登入與模型，可能將文章送往該 CLI 設定的雲端服務。路徑、參數與預設選擇只儲存在此裝置。測試會送出不含筆記的測試文字，可能使用模型額度。' });
  let local = structuredClone(controller.local);
  let disposed = false;
  const tests = new Set<AbortController>();
  const list = section.createDiv();
  const status = section.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
  const errorText = (error: unknown): void => { if (!disposed) status.setText(error instanceof Error ? error.message : String(error)); };
  const renderAgents = (): void => {
    list.empty();
    for (const agent of local.agents) {
      const installed = local.detected.find(item => item.id === agent.id);
      const row = list.createDiv();
      new Setting(row).setName(`${agent.name} · ${installed?.installed ? '已偵測' : '未偵測'}${agent.id === local.defaultId ? ' · 預設' : ''}`)
        .addButton(button => button.setButtonText('設為預設').onClick(() => { local.defaultId = agent.id; renderAgents(); }))
        .addButton(button => button.setButtonText('測試').onClick(async () => {
          const abort = new AbortController(); tests.add(abort); button.setDisabled(true);
          status.setText('測試中…');
          try { parseArguments(agent.args); const answer = await controller.test({ ...agent }, abort.signal); if (!disposed) status.setText(`測試成功：${answer.slice(0, 120)}`); }
          catch (error) { errorText(error); }
          finally { tests.delete(abort); button.setDisabled(false); }
        }));
      new Setting(row).setName('執行檔名稱或絕對路徑').addText(text => text.setValue(agent.command).onChange(value => { agent.command = value; }));
      new Setting(row).setName('自訂參數').setDesc('完整啟動參數，空白分隔並支援引號；不執行 shell。請保留內建的非互動與輸出格式參數。')
        .addText(text => text.setValue(agent.args).onChange(value => { agent.args = value; }));
      if (agent.kind === 'custom') {
        new Setting(row).setName('顯示名稱').addText(text => text.setValue(agent.name).onChange(value => { agent.name = value; }));
        new Setting(row).addButton(button => button.setButtonText('移除自訂 Agent').onClick(() => { local.agents = local.agents.filter(item => item.id !== agent.id); renderAgents(); }));
      }
    }
  };
  renderAgents();
  new Setting(section)
    .addButton(button => button.setButtonText('套用本機設定').onClick(() => {
      try {
        for (const agent of local.agents) { if (!agent.command.trim()) throw new Error('執行檔不可空白'); parseArguments(agent.args); }
        if (!local.agents.some(agent => agent.id === local.defaultId)) throw new Error('請選擇預設 Agent');
        controller.saveLocal(structuredClone(local)); status.setText('本機設定已儲存');
      } catch (error) { errorText(error); }
    }))
    .addButton(button => button.setButtonText('重新偵測已儲存設定').onClick(async () => {
      button.setDisabled(true);
      try { local.detected = await controller.detect(); if (!disposed) { renderAgents(); status.setText('偵測完成；未套用的路徑／參數草稿尚未偵測'); } }
      catch (error) { errorText(error); }
      finally { button.setDisabled(false); }
    }))
    .addButton(button => button.setButtonText('新增自訂 CLI').onClick(() => {
      const agent: AgentConfig = { id: `custom-${Date.now()}`, kind: 'custom', name: '自訂 CLI', command: '', args: '' };
      local.agents.push(agent); renderAgents();
    }));
  void controller.detect().then(detected => { if (!disposed) { local.detected = detected; renderAgents(); } }).catch(errorText);
  return () => { disposed = true; for (const test of tests) test.abort(); };
}
