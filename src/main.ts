import { t, configureLanguage, normalizeLanguage, type Language } from './i18n';
import { getLanguage, FileSystemAdapter, Notice, Plugin, TFile, TFolder, type TAbstractFile, requestUrl } from 'obsidian';
import { DEFAULT_SETTINGS, DEFAULT_ROOT_FOLDER, FeedReaderSettingTab, isVaultRelative, type FeedReaderSettings } from './settings';
import { READER_VIEW, ReaderView, SOURCES_VIEW, SourcesView, createReaderUiState, type ReaderViewDependencies } from './ui/views';
import { SubscriptionService, VaultSubscriptionStorage, serializeSubscriptions, emptySubscriptionDocument } from './subscriptions';
import { ReadStateService, VaultReadStateStorage } from './read-state';
import { IndexedDbArticleCache } from './cache';
import { FeedRefreshService, createObsidianFeedTransport } from './feeds';
import { ArticleSaveService, ObsidianSavedNoteStorage } from './save';
import { sanitizeArticleHtml } from './ui/content';
import { MANAGE_VIEW, ManageSubscriptionsView } from './ui/manage/subscriptions';
import { markScopeRead } from './ui/manage/batch';
import { ReaderScheduler } from './scheduler';
import type { Article, ArticleSummary, FeedSource, ListFilter } from './domain/models';
import { validateNoteTemplates, type NoteTemplates } from './save/templates';
import { EnrichmentController } from './enrichment/controller';
import { DEFAULT_ENRICHMENT, validateEnrichment, type EnrichmentSettings } from './enrichment/config';
import { promptRootFolderAction } from './ui/root-folder-modal';
import { ensureFolderExists } from './vault-utils';

export default class FeedReaderPlugin extends Plugin {
  settings: FeedReaderSettings = { ...DEFAULT_SETTINGS };
  enrichment?: EnrichmentController;
  private subscriptions!: SubscriptionService;
  private readState!: ReadStateService;
  private cache!: IndexedDbArticleCache;
  private refreshService!: FeedRefreshService;
  private saves!: ArticleSaveService;
  private scheduler!: ReaderScheduler;
  private dependencies!: ReaderViewDependencies;
  private stopped = false;
  private openingReader?: Promise<void>;
  private switchingPath = false;
  private knownSources = new Set<string>();
  private reconcileTail: Promise<void> = Promise.resolve();
  private feedErrors = new Map<string, string>();
  private openingManager?: Promise<void>;

  async onload(): Promise<void> {
    this.stopped = false;
    const stored = (await this.loadData()) as Partial<FeedReaderSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...stored };
    if (!this.settings.rootFolder) {
      if (stored?.subscriptionsPath && stored.subscriptionsPath.includes('/')) {
        this.settings.rootFolder = stored.subscriptionsPath.split('/').slice(0, -1).join('/');
      } else {
        this.settings.rootFolder = DEFAULT_ROOT_FOLDER;
      }
    }
    const validListFilters: ListFilter[] = ['unread', 'all', 'read', 'today'];
    if (!validListFilters.includes(this.settings.defaultListFilter)) {
      this.settings.defaultListFilter = 'unread';
    }
    this.settings.language = normalizeLanguage(this.settings.language);
    configureLanguage(this.settings.language, getLanguage());
    this.settings.enrichment = { ...structuredClone(DEFAULT_ENRICHMENT), ...this.settings.enrichment };
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("Vault Feed Reader requires a desktop vault"));
    this.cache = new IndexedDbArticleCache(adapter.getBasePath());
    const stateDir = `${this.settings.rootFolder}/state`;
    const identityPath = `${stateDir}/source-ids.json`;
    this.subscriptions = new SubscriptionService(new VaultSubscriptionStorage(this.app.vault), this.settings.subscriptionsPath, undefined, identityPath);
    this.readState = new ReadStateService(new VaultReadStateStorage(this.app.vault), stateDir);
    this.refreshService = new FeedRefreshService(createObsidianFeedTransport(requestUrl), this.cache);
    this.saves = this.makeSaveService(this.settings.savedArticlesFolder);
    this.saves.start();
    const snapshot = await this.subscriptions.start();
    if (this.stopped) { this.subscriptions.stop(); return; }
    this.knownSources = new Set(snapshot.document.feeds.map(feed => feed.id));
    this.dependencies = {
      subscriptions: this.subscriptions, cache: this.cache, readState: this.readState,
      state: createReaderUiState(this.settings.defaultListFilter), markReadOnNavigate: this.settings.markReadOnNavigate,
      defaultListFilter: this.settings.defaultListFilter,
      getSavedArticles: () => this.saves.listSavedArticles(),
      getFeedErrors: () => this.feedErrors,
      onManageSubscriptions: () => this.openManager(),
      onOpenReader: () => this.openReader(),
      onRefresh: sources => this.refreshFeeds(sources),
      onSaveArticle: article => this.report(() => this.saveArticle(article)),
      onOpenSavedArticle: article => this.report(() => this.openSavedArticle(article)),
      onMarkScopeRead: request => this.report(() => markScopeRead(this.subscriptions.getSnapshot().document, this.cache, this.readState, request)),
    };
    this.registerView(SOURCES_VIEW, leaf => new SourcesView(leaf, this.dependencies));
    this.registerView(READER_VIEW, leaf => new ReaderView(leaf, this.dependencies));
    this.registerView(MANAGE_VIEW, leaf => new ManageSubscriptionsView(leaf, this.subscriptions, sources => this.refreshFeeds(sources)));
    this.scheduler = new ReaderScheduler(() => this.refreshFeeds(this.subscriptions.getSnapshot().document.feeds), undefined, error => this.notice(error));
    this.register(this.subscriptions.subscribe(snapshot => {
      if (this.stopped || this.switchingPath || !snapshot.writable) return;
      void this.reconcileSources(snapshot.document.feeds).catch(error => this.notice(error));
    }));
    this.register(this.readState.subscribe((_id, result) => { if (!result.ok) this.notice(`${result.error.path}: ${result.error.message}`); }));
    const reloadState = (path: string): void => {
      const prefix = `${this.readState.directory}/`;
      if (this.stopped || !path.startsWith(prefix) || !path.endsWith('.json')) return;
      const id = path.slice(prefix.length, -5);
      if (id === 'source-ids' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return;
      void this.readState.load(id, true).catch(error => this.notice(error));
    };
    this.registerEvent(this.app.vault.on('create', file => reloadState(file.path)));
    this.registerEvent(this.app.vault.on('modify', file => reloadState(file.path)));
    this.registerEvent(this.app.vault.on('delete', file => reloadState(file.path)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { reloadState(oldPath); reloadState(file.path); }));
    const syncPresence = (): void => { if (!this.stopped) this.scheduler.setPresent(this.app.workspace.getLeavesOfType(READER_VIEW).length > 0); };
    this.registerEvent(this.app.workspace.on('layout-change', syncPresence));
    this.app.workspace.onLayoutReady(syncPresence);
    this.registerDomEvent(window, 'focus', () => this.scheduler.check());
    this.registerDomEvent(document, 'visibilitychange', () => this.scheduler.check());
    const open = (): void => { void this.report(() => this.openReader()); };
    this.addRibbonIcon('rss', t("Open RSS reader"), open);
    this.addCommand({ id: 'open-reader', name: t("Open RSS reader"), callback: open });
    this.addCommand({ id: 'manage-sources', name: t("Manage sources"), callback: () => this.openManager() });
    this.enrichment = new EnrichmentController(this, () => this.settings.enrichment);
    this.enrichment.register();
    this.addSettingTab(new FeedReaderSettingTab(this.app, this));
    syncPresence();
  }

  onunload(): void {
    this.stopped = true;
    this.enrichment?.dispose();
    this.scheduler?.dispose(); this.refreshService?.dispose(); this.subscriptions?.stop(); this.saves?.dispose();
    // Obsidian owns registered leaves; preserve their layout across reloads.
    this.cache?.dispose();
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  async changeLanguage(value: Language): Promise<void> {
    const previous = this.settings.language;
    this.settings.language = normalizeLanguage(value);
    try { await this.saveSettings(); } catch (error) { this.settings.language = previous; throw error; }
  }

  async changeEnrichment(value: EnrichmentSettings): Promise<void> {
    validateEnrichment(value);
    const previous = this.settings.enrichment;
    this.settings.enrichment = value;
    try { await this.saveSettings(); } catch (error) { this.settings.enrichment = previous; throw error; }
  }

  async changeRootFolder(folderInput: string): Promise<void> {
    const nextRoot = folderInput.trim().replace(/\/+$/, '');
    if (!nextRoot || !isVaultRelative(nextRoot)) {
      throw new Error(t("Choose a vault-relative folder"));
    }
    const currentRoot = this.settings.rootFolder;
    if (nextRoot === currentRoot) return;

    if (this.switchingPath) {
      throw new Error(t("A subscriptions path change is already in progress"));
    }

    const target = this.app.vault.getAbstractFileByPath(nextRoot);
    if (target instanceof TFile) {
      throw new Error(t("A file with the same name already exists"));
    }

    const isEmpty = !target || (target instanceof TFolder && target.children.length === 0);

    if (isEmpty) {
      const choice = await promptRootFolderAction(this.app, currentRoot, nextRoot);
      if (!choice) return;

      if (choice === 'move') {
        if (nextRoot.startsWith(currentRoot + '/')) {
          throw new Error(t("Cannot move a folder into its own subfolder"));
        }
        await this.executeMoveRootFolder(currentRoot, nextRoot, target);
      } else if (choice === 'create-new') {
        await this.executeCreateNewRootSource(nextRoot);
      }
    } else {
      await this.executeSwitchRootFolder(currentRoot, nextRoot);
    }
  }

  private async executeMoveRootFolder(currentRoot: string, nextRoot: string, target: TAbstractFile | null): Promise<void> {
    this.switchingPath = true;
    try {
      const currentAbstract = this.app.vault.getAbstractFileByPath(currentRoot);
      if (currentAbstract instanceof TFolder) {
        if (!target) {
          const parent = nextRoot.split('/').slice(0, -1).join('/');
          if (parent) await ensureFolderExists(this.app.vault, parent);
          await this.app.fileManager.renameFile(currentAbstract, nextRoot);
        } else if (target instanceof TFolder) {
          for (const child of [...currentAbstract.children]) {
            await this.app.fileManager.renameFile(child, `${nextRoot}/${child.name}`);
          }
          await this.app.vault.delete(currentAbstract);
        }
      } else {
        await ensureFolderExists(this.app.vault, nextRoot);
      }

      const oldSubscriptionsPath = this.settings.subscriptionsPath;
      const oldSavedFolder = this.settings.savedArticlesFolder;

      const nextSubscriptionsPath = oldSubscriptionsPath.startsWith(currentRoot + '/')
        ? `${nextRoot}${oldSubscriptionsPath.slice(currentRoot.length)}`
        : (oldSubscriptionsPath === currentRoot ? nextRoot : `${nextRoot}/feeds.yaml`);

      const nextSavedFolder = oldSavedFolder.startsWith(currentRoot + '/')
        ? `${nextRoot}${oldSavedFolder.slice(currentRoot.length)}`
        : (oldSavedFolder === currentRoot ? nextRoot : `${nextRoot}/Articles`);

      const nextStateDir = `${nextRoot}/state`;
      const nextIdentityPath = `${nextStateDir}/source-ids.json`;

      const existingFeed = this.app.vault.getAbstractFileByPath(nextSubscriptionsPath);
      if (!existingFeed) {
        const initialYaml = serializeSubscriptions(emptySubscriptionDocument(), 'yaml');
        await this.app.vault.create(nextSubscriptionsPath, initialYaml);
      }

      this.settings.rootFolder = nextRoot;
      this.settings.subscriptionsPath = nextSubscriptionsPath;
      this.settings.savedArticlesFolder = nextSavedFolder;
      await this.saveSettings();

      this.readState.setDirectory(nextStateDir);
      await this.subscriptions.setPath(nextSubscriptionsPath, nextIdentityPath);

      this.saves.dispose();
      this.saves = this.makeSaveService(nextSavedFolder);
      this.saves.start();

      await this.reconcileSources(this.subscriptions.getSnapshot().document.feeds);
      this.refreshViews();
      new Notice(t("Moved Feed Reader files to {folder}", { folder: nextRoot }));
    } finally {
      this.switchingPath = false;
    }
  }

  private async executeCreateNewRootSource(nextRoot: string): Promise<void> {
    this.switchingPath = true;
    try {
      await ensureFolderExists(this.app.vault, nextRoot);

      const nextSubscriptionsPath = `${nextRoot}/feeds.yaml`;
      const nextSavedFolder = `${nextRoot}/Articles`;
      const nextStateDir = `${nextRoot}/state`;
      const nextIdentityPath = `${nextStateDir}/source-ids.json`;

      const existingFeed = this.app.vault.getAbstractFileByPath(nextSubscriptionsPath);
      if (!existingFeed) {
        const initialYaml = serializeSubscriptions(emptySubscriptionDocument(), 'yaml');
        await this.app.vault.create(nextSubscriptionsPath, initialYaml);
      }

      this.settings.rootFolder = nextRoot;
      this.settings.subscriptionsPath = nextSubscriptionsPath;
      this.settings.savedArticlesFolder = nextSavedFolder;
      await this.saveSettings();

      this.readState.setDirectory(nextStateDir);
      await this.subscriptions.setPath(nextSubscriptionsPath, nextIdentityPath);

      this.saves.dispose();
      this.saves = this.makeSaveService(nextSavedFolder);
      this.saves.start();

      await this.reconcileSources(this.subscriptions.getSnapshot().document.feeds);
      this.refreshViews();
      new Notice(t("Created new RSS source in {folder}", { folder: nextRoot }));
    } finally {
      this.switchingPath = false;
    }
  }

  private async executeSwitchRootFolder(currentRoot: string, nextRoot: string): Promise<void> {
    this.switchingPath = true;
    try {
      const nextStateDir = `${nextRoot}/state`;
      const nextIdentityPath = `${nextStateDir}/source-ids.json`;

      let nextSubscriptionsPath = `${nextRoot}/feeds.yaml`;
      if (this.app.vault.getAbstractFileByPath(`${nextRoot}/feeds.yml`)) {
        nextSubscriptionsPath = `${nextRoot}/feeds.yml`;
      } else if (!this.app.vault.getAbstractFileByPath(nextSubscriptionsPath)) {
        const initialYaml = serializeSubscriptions(emptySubscriptionDocument(), 'yaml');
        await this.app.vault.create(nextSubscriptionsPath, initialYaml);
      }

      const nextSavedFolder = `${nextRoot}/Articles`;

      this.settings.rootFolder = nextRoot;
      this.settings.subscriptionsPath = nextSubscriptionsPath;
      this.settings.savedArticlesFolder = nextSavedFolder;
      await this.saveSettings();

      this.readState.setDirectory(nextStateDir);
      await this.subscriptions.setPath(nextSubscriptionsPath, nextIdentityPath);

      this.saves.dispose();
      this.saves = this.makeSaveService(nextSavedFolder);
      this.saves.start();

      await this.reconcileSources(this.subscriptions.getSnapshot().document.feeds);
      this.refreshViews();
      new Notice(t("Switched Feed Reader root folder to {folder}", { folder: nextRoot }));
    } finally {
      this.switchingPath = false;
    }
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(SOURCES_VIEW)) {
      if (leaf.view instanceof SourcesView) leaf.view.refresh();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(READER_VIEW)) {
      if (leaf.view instanceof ReaderView) void leaf.view.refresh();
    }
  }

  async changeSubscriptionsPath(path: string): Promise<void> {
    if (!isVaultRelative(path) || !/\.ya?ml$/i.test(path)) throw new Error(t("Choose a vault-relative .yaml or .yml path"));
    if (this.switchingPath) throw new Error(t("A subscriptions path change is already in progress"));
    const oldPath = this.settings.subscriptionsPath;
    const oldSnapshot = this.subscriptions.getSnapshot();
    this.switchingPath = true;
    try {
      const result = await this.subscriptions.setPath(path);
      if (!result.writable) throw result.error ?? new Error(t("Could not load subscriptions"));
      this.settings.subscriptionsPath = path;
      await this.saveSettings();
    } catch (error) {
      this.settings.subscriptionsPath = oldPath;
      await this.subscriptions.restorePath(oldPath, oldSnapshot);
      throw error;
    } finally { this.switchingPath = false; }
    // The path is committed. Cache cleanup failures must not roll it back.
    await this.reconcileSources(this.subscriptions.getSnapshot().document.feeds);
  }

  async changeSavedFolder(path: string): Promise<void> {
    if (!isVaultRelative(path)) throw new Error(t("Choose a vault-relative folder"));
    const next = this.makeSaveService(path), previous = this.settings.savedArticlesFolder;
    this.settings.savedArticlesFolder = path;
    try { await this.saveSettings(); } catch (error) { this.settings.savedArticlesFolder = previous; throw error; }
    this.saves.dispose(); this.saves = next; next.start();
  }

  async changeMarkReadOnNavigate(value: boolean): Promise<void> {
    const previous = this.settings.markReadOnNavigate;
    this.settings.markReadOnNavigate = value;
    try { await this.saveSettings(); } catch (error) { this.settings.markReadOnNavigate = previous; throw error; }
    this.dependencies.markReadOnNavigate = value;
  }

  async changeDefaultListFilter(value: ListFilter): Promise<void> {
    const validListFilters: ListFilter[] = ['unread', 'all', 'read', 'today'];
    const normalized: ListFilter = validListFilters.includes(value) ? value : 'unread';
    const previous = this.settings.defaultListFilter;
    this.settings.defaultListFilter = normalized;
    try { await this.saveSettings(); } catch (error) { this.settings.defaultListFilter = previous; throw error; }
    this.dependencies.defaultListFilter = normalized;
    for (const leaf of this.app.workspace.getLeavesOfType(SOURCES_VIEW)) {
      if (leaf.view instanceof SourcesView) leaf.view.refresh();
    }
  }

  async changeNoteTemplates(templates: NoteTemplates): Promise<void> {
    validateNoteTemplates(templates);
    const previous = this.settings;
    this.settings = { ...previous, ...templates };
    try { await this.saveSettings(); } catch (error) { this.settings = previous; throw error; }
  }

  async openReader(): Promise<void> {
    if (this.stopped) return;
    if (this.openingReader) return this.openingReader;
    const opening = this.openReaderLeaves();
    this.openingReader = opening;
    try { await opening; }
    finally { if (this.openingReader === opening) this.openingReader = undefined; }
  }

  private async openReaderLeaves(): Promise<void> {
    if (this.stopped) return;
    let sources = this.app.workspace.getLeavesOfType(SOURCES_VIEW)[0];
    if (!sources) {
      sources = this.app.workspace.getLeftLeaf(false) ?? undefined;
      if (sources) await sources.setViewState({ type: SOURCES_VIEW, active: true });
    }
    if (this.stopped) return;
    if (sources) await this.app.workspace.revealLeaf(sources);
    let reader = this.app.workspace.getLeavesOfType(READER_VIEW)[0];
    if (!reader) { reader = this.app.workspace.getLeaf('tab'); await reader.setViewState({ type: READER_VIEW, active: true }); }
    if (this.stopped) return;
    await this.app.workspace.revealLeaf(reader);
    this.scheduler.setPresent(true);
  }

  private openManager(): void {
    void this.report(async () => {
      if (this.openingManager) return this.openingManager;
      const opening = this.openManagerLeaf();
      this.openingManager = opening;
      try { await opening; }
      finally { if (this.openingManager === opening) this.openingManager = undefined; }
    });
  }
  private async openManagerLeaf(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(MANAGE_VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: MANAGE_VIEW, active: true }); }
    if (!this.stopped) await this.app.workspace.revealLeaf(leaf);
  }
  private makeSaveService(folder: string): ArticleSaveService {
    return new ArticleSaveService(new ObsidianSavedNoteStorage(this.app.vault, this.app.metadataCache), { folder, sanitize: sanitizeArticleHtml, templates: () => this.settings });
  }
  private async saveArticle(article: Article): Promise<void> {
    const source = this.subscriptions.getSnapshot().document.feeds.find(feed => feed.id === article.feedId);
    if (!source) throw new Error(t("This source is no longer subscribed"));
    const result = await this.saves.save(article, source);
    if (this.stopped) return;
    await this.openNote(result.note.path);
    this.notice(result.created ? t("Article saved") : t("Opened saved article"));
  }
  private async openSavedArticle(article: ArticleSummary): Promise<void> {
    const note = this.saves.findSaved(article.feedId, article.id);
    if (!note) throw new Error(t("The saved note could not be found"));
    await this.openNote(note.path);
  }
  private async openNote(path: string): Promise<void> {
    if (this.stopped) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(t('Saved note not found: {path}', { path }));
    await this.app.workspace.getLeaf('tab').openFile(file);
  }
  private async reconcileSources(sources: readonly FeedSource[]): Promise<void> {
    let added: FeedSource[] = [];
    const operation = this.reconcileTail.then(async () => {
      if (this.stopped) return;
      const next = new Set(sources.map(source => source.id));
      const removed = [...this.knownSources].filter(id => !next.has(id));
      added = sources.filter(source => !this.knownSources.has(source.id));
      this.knownSources = next;
      for (const id of removed) {
        this.refreshService.cancelSource(id); this.feedErrors.delete(id);
        await this.cache.deleteSource(id);
      }
    });
    this.reconcileTail = operation.catch(error => this.notice(error));
    await operation;
    if (!this.stopped && added.length && this.app.workspace.getLeavesOfType(READER_VIEW).length) await this.refreshFeeds(added);
  }
  private async refreshFeeds(sources: readonly FeedSource[]): Promise<void> {
    await this.reconcileTail;
    if (this.stopped) return;
    const currentSources = sources.filter(source => this.knownSources.has(source.id));
    const results = await this.refreshService.refreshSources(currentSources);
    if (this.stopped) return;
    for (const result of results) {
      if (!this.knownSources.has(result.feedId)) continue;
      if (result.ok) this.feedErrors.delete(result.feedId); else this.feedErrors.set(result.feedId, result.error.message);
    }
    for (const leaf of this.app.workspace.getLeavesOfType(SOURCES_VIEW)) (leaf.view as SourcesView).refresh();
    await Promise.all(this.app.workspace.getLeavesOfType(READER_VIEW).map(leaf => (leaf.view as ReaderView).refresh()));
  }
  private notice(error: unknown): void { if (!this.stopped) new Notice(error instanceof Error ? error.message : String(error)); }
  private async report(operation: () => Promise<void>): Promise<void> { try { if (!this.stopped) await operation(); } catch (error) { this.notice(error); } }
}
