import { t } from '../../i18n';
import { App, Modal, Notice, Setting, type ButtonComponent, type TextComponent } from 'obsidian';
import type { FeedSource } from '../../domain/models';
import type { SubscriptionService } from '../../subscriptions';
import type { FeedTransport } from '../../feeds/transport';
import { fetchFeedTitle } from '../../feeds/title';

export class AddSourceModal extends Modal {
  private closed = true;
  private busy = false;
  private request?: AbortController;
  constructor(app: App, private readonly service: SubscriptionService, private readonly refresh: (sources: readonly FeedSource[]) => Promise<void>, private readonly transport: FeedTransport) { super(app); }

  onOpen(): void {
    this.closed = false;
    this.titleEl.setText(t("Add RSS / Atom source"));
    let title = '', url = '';
    const folders = new Set<string>();
    let titleInput: TextComponent, submit: ButtonComponent;
    new Setting(this.contentEl).setName(t("Feed URL")).setDesc(t("Enter an RSS or Atom URL. Leave Title blank to detect it automatically."))
      .addText(text => text.setPlaceholder('https://example.com/feed.xml').onChange(value => { url = value; }));
    new Setting(this.contentEl).setName(t("Title")).addText(text => { titleInput = text; text.onChange(value => { title = value; }); });
    for (const folder of this.service.getSnapshot().document.folders) new Setting(this.contentEl).setName(folder.title)
      .addToggle(toggle => toggle.setValue(false).onChange(value => { if (value) folders.add(folder.id); else folders.delete(folder.id); }));
    const status = this.contentEl.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText(t("Cancel")).onClick(() => this.close()))
      .addButton(button => {
        submit = button;
        button.setButtonText(t("Add source")).setCta().setDisabled(!this.service.getSnapshot().writable).onClick(() => { void save(); });
      });
    const save = async (): Promise<void> => {
      if (this.closed || this.busy || !this.service.getSnapshot().writable) return;
      this.busy = true; submit.setDisabled(true);
      const submittedUrl = url.trim();
      this.request = new AbortController();
      try {
        if (!title.trim()) {
          status.setText(t("Detecting feed title…"));
          const detected = await fetchFeedTitle(submittedUrl, this.transport, this.request.signal);
          if (this.closed) return;
          if (url.trim() !== submittedUrl) { status.setText(t("Feed URL changed. Click Add source again.")); return; }
          // Keep a title typed while detection was running.
          if (!title.trim()) { title = detected; titleInput.setValue(title); }
        }
        if (this.closed) return;
        status.setText(t('Saving source…'));
        const source = await this.service.addFeed({ title: title.trim(), url: submittedUrl, folderIds: [...folders] });
        if (this.closed) return;
        this.close();
        try { await this.refresh([source]); } catch { new Notice(t('Source added, but refresh failed. Try Refresh again.')); }
      } catch (error) {
        if (!this.closed) status.setText(error instanceof Error ? error.message : t('Could not add the source. Your draft has been kept.'));
      } finally {
        this.busy = false; this.request = undefined;
        if (!this.closed) submit.setDisabled(!this.service.getSnapshot().writable);
      }
    };
  }
  onClose(): void { this.closed = true; this.request?.abort(); this.contentEl.empty(); }
}
