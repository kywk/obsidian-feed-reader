import { t } from '../../i18n';
import { ItemView, WorkspaceLeaf, Notice, Setting, requestUrl } from 'obsidian';
import type { FeedSource } from '../../domain/models';
import type { SubscriptionService, SubscriptionFormat } from '../../subscriptions';

import { AddSourceModal } from './source-modal';
import { createObsidianFeedTransport, type FeedTransport } from '../../feeds/transport';

export const MANAGE_VIEW = 'vault-feed-reader-manage';

export class ManageSubscriptionsView extends ItemView {
  private addModal?: AddSourceModal;
  private off?: () => void;
  private closed = false;
  private page: 'list' | 'edit' | 'transfer' | 'confirm' = 'list';
  private busy = false;
  private section: 'sources' | 'folders' = 'sources';
  private query = '';
  private offset = 0;
  constructor(leaf: WorkspaceLeaf, private readonly service: SubscriptionService, private readonly refresh: (sources: readonly FeedSource[]) => Promise<void>, private readonly transport: FeedTransport = createObsidianFeedTransport(requestUrl)) { super(leaf); }
  getViewType(): string { return MANAGE_VIEW; }
  getDisplayText(): string { return t("Manage RSS sources"); }
  getIcon(): string { return 'list-tree'; }
  async onOpen(): Promise<void> {
    this.contentEl.classList.add('vfr-manager');
    this.closed = false;
    this.off = this.service.subscribe(() => { if (this.page === 'list' && !this.closed) this.render(); });
    this.render();
  }
  async onClose(): Promise<void> { this.closed = true; this.addModal?.close(); this.off?.(); this.contentEl.empty(); }
  private async run(action: () => Promise<unknown>, after: () => void = () => this.render()): Promise<void> {
    if (this.closed || this.busy) return;
    this.busy = true;
    try { await action(); if (!this.closed) after(); }
    catch (error) { if (!this.closed) new Notice(error instanceof Error ? error.message : String(error)); }
    finally { this.busy = false; }
  }
  private heading(title: string, page: typeof this.page): void {
    this.page = page; this.contentEl.empty(); this.contentEl.createEl('h2', { text: title });
    if (page !== 'list') new Setting(this.contentEl).addButton(button => button.setButtonText(t("Back")).onClick(() => this.render()));
  }
  private render(): void {
    this.heading(t("Manage RSS sources"), 'list');
    const snapshot = this.service.getSnapshot(), locked = !snapshot.writable;
    if (snapshot.error) this.contentEl.createEl('p', { cls: 'vfr-error', text: t('{path}: {message}. Fix the file to enable changes.', { path: snapshot.error.path, message: snapshot.error.message }) });
    new Setting(this.contentEl).setName(t("Sources"))
      .addButton(button => button.setButtonText(t("Add source")).setDisabled(locked).onClick(() => this.addFeed()))
      .addButton(button => button.setButtonText(t("Refresh all")).onClick(() => { void this.run(() => this.refresh(this.service.getSnapshot().document.feeds)); }))
      .addButton(button => button.setButtonText(t("Import / export")).onClick(() => this.transfer()));
    const tabs = this.contentEl.createDiv({ cls: 'vfr-manager-tabs' });
    for (const section of ['sources', 'folders'] as const) {
      const tab = tabs.createEl('button', { text: section === 'sources' ? t('Sources ({count})', { count: snapshot.document.feeds.length }) : t('Folders ({count})', { count: snapshot.document.folders.length }), attr: { 'aria-pressed': String(this.section === section) } });
      tab.addEventListener('click', () => { this.section = section; this.render(); });
    }
    if (this.section === 'sources') {
      const search = this.contentEl.createEl('input', { type: 'search', cls: 'vfr-manager-search', placeholder: t("Search sources, URLs or folders"), attr: { 'aria-label': t("Search sources") } });
      search.value = this.query;
      const results = this.contentEl.createDiv({ cls: 'vfr-manager-results' });
      const renderResults = (): void => {
        results.empty();
        const query = this.query.trim().toLocaleLowerCase();
        const feeds = snapshot.document.feeds.filter(feed => [feed.title, feed.url, ...snapshot.document.folders.filter(folder => feed.folderIds.includes(folder.id)).map(folder => folder.title)].some(value => value.toLocaleLowerCase().includes(query)));
        this.offset = Math.min(this.offset, Math.max(0, Math.floor((feeds.length - 1) / 50) * 50));
        const controls = results.createDiv({ cls: 'vfr-manager-pagination' });
        controls.createSpan({ text: feeds.length ? t('{start}–{end} of {count} sources', { start: this.offset + 1, end: Math.min(this.offset + 50, feeds.length), count: feeds.length }) : t("No matching sources") });
        const prev = controls.createEl('button', { text: t("Previous page") }); prev.disabled = this.offset === 0;
        const next = controls.createEl('button', { text: t("Next page") }); next.disabled = this.offset + 50 >= feeds.length;
        prev.addEventListener('click', () => { this.offset -= 50; renderResults(); this.contentEl.scrollTop = 0; });
        next.addEventListener('click', () => { this.offset += 50; renderResults(); this.contentEl.scrollTop = 0; });
        for (const feed of feeds.slice(this.offset, this.offset + 50)) {
          const folders = snapshot.document.folders.filter(folder => feed.folderIds.includes(folder.id)).map(folder => folder.title);
          const row = results.createDiv({ cls: 'vfr-managed-source' });
          new Setting(row).setName(feed.title).setDesc(`${feed.url} · ${folders.join(', ') || t("Unfiled")}`)
            .addButton(button => button.setButtonText(t("Edit / folders")).setDisabled(locked).onClick(() => this.editFeed(feed)))
            .addButton(button => button.setButtonText(t("Refresh")).onClick(() => { void this.run(() => this.refresh([feed])); }))
            .addButton(button => button.setButtonText(t("Unsubscribe")).setDisabled(locked).onClick(() => this.confirm(t('Unsubscribe from {title}?', { title: feed.title }), t("Remove this source from every folder and delete its local article cache. Reading history and saved notes are kept."), () => this.service.unsubscribe(feed.id))));
        }
      };
      search.addEventListener('input', () => { this.query = search.value; this.offset = 0; renderResults(); });
      renderResults();
      return;
    }
    this.contentEl.createEl('h3', { text: t("Folders (one level)") });
    let title = '';
    new Setting(this.contentEl).setName(t("New folder"))
      .addText(text => text.setPlaceholder(t("Folder title")).onChange(value => { title = value; }))
      .addButton(button => button.setButtonText(t("Create")).setDisabled(locked).onClick(() => { void this.run(() => this.service.createFolder(title)); }));
    for (const folder of snapshot.document.folders) {
      let nextTitle = folder.title;
      new Setting(this.contentEl).setName(folder.title)
        .addText(text => text.setValue(nextTitle).setDisabled(locked).onChange(value => { nextTitle = value; }))
        .addButton(button => button.setButtonText(t("Rename")).setDisabled(locked).onClick(() => { void this.run(() => this.service.renameFolder(folder.id, nextTitle)); }))
        .addButton(button => button.setButtonText(t("Delete folder")).setDisabled(locked).onClick(() => this.confirm(t('Delete {title}?', { title: folder.title }), t("Sources stay subscribed. Only folder memberships are removed."), () => this.service.deleteFolder(folder.id))));
    }
  }
  private addFeed(): void {
    this.addModal?.close();
    this.addModal = new AddSourceModal(this.app, this.service, this.refresh, this.transport);
    this.addModal.open();
  }
  private editFeed(feed: FeedSource): void {
    this.heading(t("Edit source and folders"), 'edit');
    let title = feed.title;
    const url = feed.url;
    const folders = new Set(feed.folderIds);
    new Setting(this.contentEl).setName(t("Title")).addText(text => text.setValue(title).onChange(value => { title = value; }));
    new Setting(this.contentEl).setName(t("Feed URL")).setDesc(t("The URL defines source identity. To change it, unsubscribe and add a new source."))
      .addText(text => text.setValue(url).setPlaceholder('https://example.com/feed.xml').setDisabled(true));
    this.contentEl.createEl('p', { text: t("Choose any number of folders. Unchecking a folder only removes its association.") });
    for (const folder of this.service.getSnapshot().document.folders) new Setting(this.contentEl).setName(folder.title)
      .addToggle(toggle => toggle.setValue(folders.has(folder.id)).onChange(value => { if (value) folders.add(folder.id); else folders.delete(folder.id); }));
    new Setting(this.contentEl).addButton(button => button.setButtonText(t("Save source")).setCta().setDisabled(!this.service.getSnapshot().writable).onClick(() => {
      void this.run(async () => {
        await this.service.updateFeed(feed.id, { title, folderIds: [...folders] });
      });
    }));
  }
  private confirm(title: string, description: string, action: () => Promise<unknown>): void {
    this.heading(title, 'confirm'); this.contentEl.createEl('p', { text: description });
    new Setting(this.contentEl).addButton(button => {
      const confirmButton = button.setButtonText(t("Confirm"));
      // setDestructive needs Obsidian 1.13; fall back to setWarning on the declared 1.8.7 minimum.
      const style = confirmButton as unknown as { setDestructive?: () => unknown; setWarning?: () => unknown };
      (style.setDestructive ?? style.setWarning)?.call(confirmButton);
      confirmButton.onClick(() => { void this.run(action); });
    });
  }
  private transfer(): void {
    this.heading(t("Import / export subscriptions"), 'transfer');
    let format: SubscriptionFormat = 'yaml', mode: 'merge' | 'replace' = 'merge';
    new Setting(this.contentEl).setName(t("Format")).addDropdown(dropdown => dropdown.addOptions({ yaml: 'YAML', toml: 'TOML', opml: 'OPML' }).onChange(value => { format = value as SubscriptionFormat; }));
    this.contentEl.createEl('p', { text: t("OPML transfers subscriptions only. Nested folders become Parent / Child; repeated feeds keep all folder memberships.") });
    const area = this.contentEl.createEl('textarea', { cls: 'vfr-subscriptions-document', attr: { rows: '16', 'aria-label': t("Subscriptions document"), spellcheck: 'false' } });
    new Setting(this.contentEl).setName(t("Export")).setDesc(t("Generate text to copy, or download a file."))
      .addButton(button => button.setButtonText(t("Generate export")).onClick(() => { try { area.value = this.service.export(format); area.focus(); area.select(); } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); } }))
      .addButton(button => button.setButtonText(t("Download")).onClick(() => {
        let contents: string;
        try { contents = this.service.export(format); } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); return; }
        const objectUrl = URL.createObjectURL(new Blob([contents], { type: format === 'opml' ? 'text/x-opml;charset=utf-8' : 'text/plain;charset=utf-8' }));
        const link = this.contentEl.createEl('a', { attr: { href: objectUrl, download: `feeds.${format}` } }); link.click(); link.remove(); URL.revokeObjectURL(objectUrl);
      }));
    new Setting(this.contentEl).setName(t("Import mode")).setDesc(t("Merge preserves existing source identity and folder associations."))
      .addDropdown(dropdown => dropdown.addOptions({ merge: t("Merge"), replace: t("Replace all subscriptions") }).onChange(value => { mode = value as typeof mode; }));
    const file = this.contentEl.createEl('input', { type: 'file', attr: { accept: '.yaml,.yml,.toml,.opml,.xml', 'aria-label': t("Choose subscriptions file") } });
    file.addEventListener('change', () => { const selected = file.files?.[0]; if (selected) void selected.text().then(text => { if (!this.closed && this.page === 'transfer') area.value = text; }).catch(error => new Notice(String(error))); });
    new Setting(this.contentEl).addButton(button => button.setButtonText(t("Import")).setCta().setDisabled(!this.service.getSnapshot().writable).onClick(() => {
      const contents = area.value;
      if (mode === 'replace') this.confirm(t("Replace all subscriptions?"), t("Sources missing from this document will be unsubscribed and their local article cache removed. Reading history and saved notes remain."), () => this.service.import(contents, format, 'replace'));
      else void this.run(() => this.service.import(contents, format, 'merge'));
    }));
  }
}
