import { t, translateMessage, normalizeLanguage, type Language } from './i18n';
import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type FeedReaderPlugin from './main';
import { DEFAULT_NOTE_TEMPLATES, validateNoteTemplates, type NoteTemplates } from './save/templates';
import { articleKey, renderArticleNote, renderNoteFilename } from './save/markdown';
import { sanitizeArticleHtml } from './ui/content';
import type { Article, FeedSource } from './domain/models';
import { DEFAULT_ENRICHMENT, type EnrichmentSettings } from './enrichment/config';
import { displayEnrichmentSettings } from './enrichment/settings-ui';

export interface FeedReaderSettings extends NoteTemplates { language: Language; subscriptionsPath: string; savedArticlesFolder: string; markReadOnNavigate: boolean; enrichment: EnrichmentSettings; }
export const DEFAULT_SETTINGS: FeedReaderSettings = { ...DEFAULT_NOTE_TEMPLATES, language: 'auto', subscriptionsPath: 'Feed Reader/feeds.yaml', savedArticlesFolder: 'Feed Reader/Articles', markReadOnNavigate: false, enrichment: DEFAULT_ENRICHMENT };
export function isVaultRelative(path: string): boolean {
  return path.length > 0 && !/^(\/|[A-Za-z]:)/.test(path) && !path.includes('\\') && path.split('/').every(part => Boolean(part) && part !== '.' && part !== '..');
}
export class FeedReaderSettingTab extends PluginSettingTab {
  private cleanupEnrichment?: () => void;
  constructor(app: App, private readonly plugin: FeedReaderPlugin) { super(app, plugin); }
  display(): void {
    this.cleanupEnrichment?.();
    this.containerEl.empty();
    new Setting(this.containerEl).setName(t('Language')).setDesc(t('Changes take effect after disabling and re-enabling the plugin.'))
      .addDropdown(dropdown => dropdown.addOptions({ auto: t('Follow Obsidian'), en: 'English', 'zh-TW': '繁體中文' })
        .setValue(this.plugin.settings.language).onChange(async value => {
          dropdown.setDisabled(true);
          try { await this.plugin.changeLanguage(normalizeLanguage(value)); }
          catch (error) {
            dropdown.setValue(this.plugin.settings.language);
            new Notice(translateMessage(error instanceof Error ? error.message : String(error)));
          } finally { dropdown.setDisabled(false); }
        }));
    let subscriptionsPath = this.plugin.settings.subscriptionsPath;
    new Setting(this.containerEl).setName(t("Subscriptions YAML")).setDesc(t("Vault-relative YAML path. Apply validates the file before switching."))
      .addText(text => text.setValue(subscriptionsPath).onChange(value => { subscriptionsPath = value.trim(); }))
      .addButton(button => button.setButtonText(t("Apply")).onClick(() => { void this.apply(() => this.plugin.changeSubscriptionsPath(subscriptionsPath)); }));
    let folder = this.plugin.settings.savedArticlesFolder;
    new Setting(this.containerEl).setName(t("Saved articles folder")).setDesc(t("Vault-relative folder for future saves. Existing notes remain available."))
      .addText(text => text.setValue(folder).onChange(value => { folder = value.trim(); }))
      .addButton(button => button.setButtonText(t("Apply")).onClick(() => { void this.apply(() => this.plugin.changeSavedFolder(folder)); }));
    new Setting(this.containerEl).setName(t("Mark read on j/k navigation"))
      .addToggle(toggle => toggle.setValue(this.plugin.settings.markReadOnNavigate).onChange(value => this.apply(() => this.plugin.changeMarkReadOnNavigate(value))));
    this.displayNoteTemplates();
    this.cleanupEnrichment = displayEnrichmentSettings(this.containerEl, this.plugin.settings.enrichment, value => this.plugin.changeEnrichment(value), this.plugin.enrichment);
    new Setting(this.containerEl).setName(t("Open reader")).addButton(button => button.setButtonText(t("Open")).onClick(() => { void this.apply(() => this.plugin.openReader()); }));
  }
  hide(): void { this.cleanupEnrichment?.(); }
  private displayNoteTemplates(): void {
    const section = this.containerEl.createDiv({ cls: 'vfr-template-settings' });
    new Setting(section).setName(t("Saved note templates")).setHeading();
    section.createEl('p', { text: t("Applies only to newly created notes. Saving an existing article opens its note without replacing your edits.") });
    section.createEl('p', { text: t("Variables: {{title}}, {{feed}}, {{link}}, {{published}}, {{created}}, {{date}}, and {{content}} (body only). Date falls back from publication to first fetch to save date. Dates use UTC; optional formats: YYYY-MM-DD, YYYY-MM-DD HH:mm, YYYY-MM-DD HH:mm:ss, YYYY-MM-DDTHH:mm:ss. Example: {{created:YYYY-MM-DD}}.") });
    const draft: NoteTemplates = {
      noteFilenameTemplate: this.plugin.settings.noteFilenameTemplate,
      noteBodyTemplate: this.plugin.settings.noteBodyTemplate,
      notePropertiesTemplate: this.plugin.settings.notePropertiesTemplate,
    };
    const editors: Array<{ setValue(value: string): unknown; key: keyof NoteTemplates }> = [];
    const filename = new Setting(section).setName(t("Filename template")).setDesc(t("Without .md. Unsafe filename characters are removed; collisions get a suffix."));
    filename.addText(text => {
      text.setValue(draft.noteFilenameTemplate).onChange(value => { draft.noteFilenameTemplate = value; update(); });
      editors.push({ key: 'noteFilenameTemplate', setValue: value => text.setValue(value) });
    });
    new Setting(section).setName(t("Body template")).addTextArea(text => {
      text.setValue(draft.noteBodyTemplate).onChange(value => { draft.noteBodyTemplate = value; update(); });
      text.inputEl.rows = 10;
      text.inputEl.setAttribute('aria-label', t("Body template"));
      editors.push({ key: 'noteBodyTemplate', setValue: value => text.setValue(value) });
    });
    new Setting(section).setName(t("Custom Properties")).setDesc(t("YAML mapping without --- markers. Quote values containing variables, e.g. source: \"{{feed}}\". Supports scalar values and lists. title, date_created, date_updated and feed_reader_* are supplied automatically and cannot be overridden."))
      .addTextArea(text => {
        text.setPlaceholder('tags:\n  - rss\nstatus: inbox\nsource: "{{feed}}"');
        text.setValue(draft.notePropertiesTemplate).onChange(value => { draft.notePropertiesTemplate = value; update(); });
        text.inputEl.rows = 6;
        text.inputEl.setAttribute('aria-label', t("Custom Properties"));
        editors.push({ key: 'notePropertiesTemplate', setValue: value => text.setValue(value) });
      });
    const status = section.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
    new Setting(section).setName(t("Preview · example article")).setHeading();
    section.createEl('p', { text: t("Exact Markdown output using sample data. No file is created; actual filename collisions may add a suffix.") });
    const previewPath = section.createEl('code');
    const preview = section.createEl('pre', { cls: 'vfr-template-preview' });
    let applying = false;
    let applyButton: { setDisabled(value: boolean): unknown };
    const update = (): void => {
      try {
        validateNoteTemplates(draft);
        const source: FeedSource = { id: 'preview-source', title: 'Example: News', url: 'https://example.com/feed.xml', folderIds: [] };
        const article: Article = { id: 'preview-article', feedId: source.id, title: 'A useful article', url: 'https://example.com/article', publishedAt: '2026-09-20T08:30:00.000Z', firstFetchedAt: '2026-09-21T00:00:00.000Z', contentHtml: '<p>Example article with <strong>formatted content</strong>.</p>' };
        const savedAt = '2026-09-22T02:03:04.000Z';
        const path = `${this.plugin.settings.savedArticlesFolder}/${renderNoteFilename(article, source, savedAt, draft)}.md`;
        previewPath.textContent = path;
        preview.textContent = renderArticleNote(article, source, { articleKey: articleKey(source.id, article.id), articleId: article.id, feedId: source.id, title: article.title, sourceTitle: source.title, path, savedAt, firstFetchedAt: article.firstFetchedAt }, sanitizeArticleHtml, draft);
        status.textContent = t("Valid template · changes are not saved until Apply");
        applyButton?.setDisabled(applying);
      } catch (error) {
        status.textContent = translateMessage(error instanceof Error ? error.message : String(error));
        previewPath.textContent = '';
        preview.textContent = '';
        applyButton?.setDisabled(true);
      }
    };
    new Setting(section)
      .addButton(button => {
        applyButton = button;
        button.setButtonText(t("Apply templates")).setCta().onClick(async () => {
          applying = true;
          button.setDisabled(true);
          try {
            await this.plugin.changeNoteTemplates({ ...draft });
            status.textContent = t("Templates saved. Existing notes are unchanged.");
          } catch (error) {
            status.textContent = translateMessage(error instanceof Error ? error.message : String(error));
          } finally {
            applying = false;
            try { validateNoteTemplates(draft); button.setDisabled(false); }
            catch { button.setDisabled(true); }
          }
        });
      })
      .addButton(button => button.setButtonText(t("Load defaults")).onClick(() => {
        Object.assign(draft, DEFAULT_NOTE_TEMPLATES);
        for (const editor of editors) editor.setValue(draft[editor.key]);
        update();
      }));
    update();
  }
  private async apply(action: () => Promise<void>): Promise<void> {
    try { await action(); } catch (error) { new Notice(translateMessage(error instanceof Error ? error.message : String(error))); }
    this.display();
  }
}
