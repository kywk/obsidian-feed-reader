import { t, translateMessage } from '../i18n';
import { Setting } from 'obsidian';
import type { EnrichmentController } from './controller';
import { validateEnrichment, type EnrichmentSettings } from './config';
import { parseArguments, type AgentConfig } from './agents';

export function displayEnrichmentSettings(container: HTMLElement, current: EnrichmentSettings, save: (value: EnrichmentSettings) => Promise<void>, controller?: EnrichmentController): () => void {
  const section = container.createDiv({ cls: 'vfr-enrichment-settings' });
  new Setting(section).setName(t("Full text and AI summaries")).setHeading();
  section.createEl('p', { text: t("Applies to the current Markdown note through the command palette. Fetching again replaces edits inside the original-text section; content outside it is preserved.") });
  const draft = structuredClone(current);
  const state = section.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
  new Setting(section).setName(t("Original URL fields")).setDesc(t("Comma-separated fields, checked in order. Conflicting URLs prompt you to choose."))
    .addText(text => text.setValue(draft.urlFields.join(', ')).onChange(value => { draft.urlFields = value.split(',').map(v => v.trim()).filter(Boolean); }));
  new Setting(section).setName(t("Appended full-text heading")).addText(text => text.setValue(draft.fullTextHeading).onChange(value => { draft.fullTextHeading = value; }));
  section.createEl('p', { text: t("Rules are checked from top to bottom; the first match wins. Property matching supports Web Clipper templates, e.g. type = clipping. Configure it for your template; a URL alone does not imply full text. Whole-body rules only select summary input; fetching still appends a separate section.") });
  const rules = section.createDiv();
  const renderRules = (): void => {
    rules.empty();
    draft.rules.forEach((rule, index) => {
      const row = rules.createDiv();
      new Setting(row).setName(t('Rule {number} · {kind}', { number: index + 1, kind: rule.kind === 'heading' ? t('Heading section') : t('Whole body') }))
        .addButton(button => button.setButtonText('↑').setDisabled(index === 0).onClick(() => {
          [draft.rules[index - 1], draft.rules[index]] = [draft.rules[index]!, draft.rules[index - 1]!]; renderRules();
        }))
        .addButton(button => button.setButtonText('↓').setDisabled(index === draft.rules.length - 1).onClick(() => {
          [draft.rules[index + 1], draft.rules[index]] = [draft.rules[index]!, draft.rules[index + 1]!]; renderRules();
        }))
        .addButton(button => button.setButtonText(t("Remove")).onClick(() => { draft.rules.splice(index, 1); renderRules(); }));
      if (rule.kind === 'heading') new Setting(row).setName(t("Heading text")).addText(text => text.setValue(rule.heading).onChange(value => { rule.heading = value; }));
      else {
        new Setting(row).setName(t("Property field")).addText(text => text.setValue(rule.property).onChange(value => { rule.property = value; }));
        new Setting(row).setName(t("Matching value")).addText(text => text.setValue(rule.value).onChange(value => { rule.value = value; }));
      }
    });
  };
  renderRules();
  new Setting(section)
    .addButton(button => button.setButtonText(t("Add heading rule")).onClick(() => { draft.rules.push({ kind: 'heading', heading: '' }); renderRules(); }))
    .addButton(button => button.setButtonText(t("Add whole-body rule")).onClick(() => { draft.rules.push({ kind: 'body', property: '', value: '' }); renderRules(); }));
  new Setting(section).setName(t("Summary prompt")).setDesc(t("Controls summary content. The plugin also requests topic tags in the same response, merges existing tags, and requires JSON output.")).addTextArea(text => {
    text.setValue(draft.summaryPrompt).onChange(value => { draft.summaryPrompt = value; }); text.inputEl.rows = 5;
  });
  new Setting(section).addButton(button => button.setButtonText(t("Apply article settings")).setCta().onClick(async () => {
    button.setDisabled(true);
    try { validateEnrichment(draft); await save(structuredClone(draft)); state.setText(t("Article settings saved")); }
    catch (error) { state.setText(translateMessage(error instanceof Error ? error.message : String(error))); }
    finally { button.setDisabled(false); }
  }));
  if (!controller) return () => {};
  new Setting(section).setName(t("Local agents")).setHeading();
  section.createEl('p', { text: t("Uses the local CLI login and model; articles may be sent to its configured cloud service. Paths, arguments, and the default agent are stored only on this device. Tests send sample text without notes and may use model quota.") });
  let local = structuredClone(controller.local);
  let disposed = false;
  const tests = new Set<AbortController>();
  const list = section.createDiv();
  const status = section.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
  const errorText = (error: unknown): void => { if (!disposed) status.setText(translateMessage(error instanceof Error ? error.message : String(error))); };
  const renderAgents = (): void => {
    list.empty();
    for (const agent of local.agents) {
      const installed = local.detected.find(item => item.id === agent.id);
      const row = list.createDiv();
      new Setting(row).setName(`${agent.name} · ${installed?.installed ? t("Detected") : t("Not detected")}${agent.id === local.defaultId ? t(" · Default") : ''}`)
        .addButton(button => button.setButtonText(t("Set as default")).onClick(() => { local.defaultId = agent.id; renderAgents(); }))
        .addButton(button => button.setButtonText(t("Test")).onClick(async () => {
          const abort = new AbortController(); tests.add(abort); button.setDisabled(true);
          status.setText(t("Testing…"));
          try { parseArguments(agent.args); const answer = await controller.test({ ...agent }, abort.signal); if (!disposed) status.setText(t('Test succeeded: {answer}', { answer: answer.slice(0, 120) })); }
          catch (error) { errorText(error); }
          finally { tests.delete(abort); button.setDisabled(false); }
        }));
      new Setting(row).setName(t("Executable name or absolute path")).addText(text => text.setValue(agent.command).onChange(value => { agent.command = value; }));
      new Setting(row).setName(t("Custom arguments")).setDesc(t("Full launch arguments, separated by spaces with quote support; no shell is used. Keep the built-in non-interactive and output-format arguments."))
        .addText(text => text.setValue(agent.args).onChange(value => { agent.args = value; }));
      if (agent.kind === 'custom') {
        new Setting(row).setName(t("Display name")).addText(text => text.setValue(agent.name).onChange(value => { agent.name = value; }));
        new Setting(row).addButton(button => button.setButtonText(t("Remove custom agent")).onClick(() => { local.agents = local.agents.filter(item => item.id !== agent.id); renderAgents(); }));
      }
    }
  };
  renderAgents();
  new Setting(section)
    .addButton(button => button.setButtonText(t("Apply local settings")).onClick(() => {
      try {
        for (const agent of local.agents) { if (!agent.command.trim()) throw new Error(t("Executable cannot be empty")); parseArguments(agent.args); }
        if (!local.agents.some(agent => agent.id === local.defaultId)) throw new Error(t("Choose a default agent"));
        controller.saveLocal(structuredClone(local)); status.setText(t("Local settings saved"));
      } catch (error) { errorText(error); }
    }))
    .addButton(button => button.setButtonText(t("Detect saved configurations again")).onClick(async () => {
      button.setDisabled(true);
      try { local.detected = await controller.detect(); if (!disposed) { renderAgents(); status.setText(t("Detection complete; unsaved path and argument drafts were not checked")); } }
      catch (error) { errorText(error); }
      finally { button.setDisabled(false); }
    }))
    .addButton(button => button.setButtonText(t("Add custom CLI")).onClick(() => {
      const agent: AgentConfig = { id: `custom-${Date.now()}`, kind: 'custom', name: t("Custom CLI"), command: '', args: '' };
      local.agents.push(agent); renderAgents();
    }));
  void controller.detect().then(detected => { if (!disposed) { local.detected = detected; renderAgents(); } }).catch(errorText);
  return () => { disposed = true; for (const test of tests) test.abort(); };
}
