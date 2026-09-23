import { describe, expect, it, vi, beforeEach } from 'vitest';

class MockFile {
  constructor(public path: string, public name: string, public content = '') {}
}

class MockFolder {
  children: (MockFile | MockFolder)[] = [];
  constructor(public path: string, public name: string) {}
}

let mockPromptResult: 'move' | 'create-new' | null = null;
vi.mock('../../src/ui/root-folder-modal', () => ({
  promptRootFolderAction: vi.fn(async () => mockPromptResult),
}));

vi.mock('obsidian', () => {
  class TAbstractFile {
    constructor(public path: string, public name: string) {}
  }
  class TFile extends TAbstractFile {
    extension = 'md';
  }
  class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];
  }
  class Notice {
    message: string;
    constructor(msg: string) {
      this.message = msg;
    }
  }
  class Plugin {
    app: unknown;
    constructor(app: unknown) {
      this.app = app;
    }
    register() {}
    registerEvent() {}
    registerDomEvent() {}
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab() {}
    async loadData() {
      return null;
    }
    async saveData() {}
  }
  return {
    Plugin,
    PluginSettingTab: class {},
    Setting: class {
      setName() { return this; }
      setDesc() { return this; }
      addText() { return this; }
      addButton() { return this; }
      addDropdown() { return this; }
      addToggle() { return this; }
    },
    Modal: class {},
    ItemView: class {
      contentEl = {};
    },
    WorkspaceLeaf: class {},
    TAbstractFile,
    TFile,
    TFolder,
    Notice,
    FileSystemAdapter: class {
      getBasePath() {
        return '/mock/vault';
      }
    },
    getLanguage: () => 'en',
    requestUrl: vi.fn(),
  };
});

import { TFile, TFolder } from 'obsidian';
import FeedReaderPlugin from '../../src/main';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { promptRootFolderAction } from '../../src/ui/root-folder-modal';

function makeTFolder(path: string, name: string): TFolder {
  const folder = Object.create(TFolder.prototype) as TFolder;
  folder.path = path;
  folder.name = name;
  folder.children = [];
  return folder;
}

function makeTFile(path: string, name: string): TFile {
  const file = Object.create(TFile.prototype) as TFile;
  file.path = path;
  file.name = name;
  return file;
}

function createMockApp() {
  const files = new Map<string, MockFile | MockFolder>();

  const vault = {
    getAbstractFileByPath(path: string) {
      const normalized = path.replace(/\/+$/, '');
      const item = files.get(normalized);
      if (!item) return null;
      if (item instanceof MockFolder) {
        const folder = makeTFolder(item.path, item.name);
        folder.children = item.children.map(c =>
          c instanceof MockFolder ? makeTFolder(c.path, c.name) : makeTFile(c.path, c.name),
        );
        return folder;
      }
      return makeTFile(item.path, item.name);
    },
    async createFolder(path: string) {
      const normalized = path.replace(/\/+$/, '');
      if (files.has(normalized)) throw new Error('Folder already exists');
      const name = normalized.split('/').pop()!;
      const folder = new MockFolder(normalized, name);
      files.set(normalized, folder);
      // Link into parent folder if exists
      const parentPath = normalized.split('/').slice(0, -1).join('/');
      if (parentPath && files.has(parentPath)) {
        (files.get(parentPath) as MockFolder).children.push(folder);
      }
      return makeTFolder(folder.path, folder.name);
    },
    async create(path: string, content: string) {
      if (files.has(path)) throw new Error('File already exists');
      const name = path.split('/').pop()!;
      const file = new MockFile(path, name, content);
      files.set(path, file);
      // Link into parent folder if exists
      const parentPath = path.split('/').slice(0, -1).join('/');
      if (parentPath && files.has(parentPath)) {
        (files.get(parentPath) as MockFolder).children.push(file);
      }
      return makeTFile(file.path, file.name);
    },
    async delete(file: { path: string }) {
      files.delete(file.path);
    },
    getFileByPath(path: string) {
      const item = files.get(path);
      return item instanceof MockFile ? makeTFile(item.path, item.name) : null;
    },
    async read(file: { path: string }) {
      const item = files.get(file.path);
      return item instanceof MockFile ? item.content : '';
    },
    async modify(file: { path: string }, content: string) {
      const item = files.get(file.path);
      if (item instanceof MockFile) item.content = content;
    },
    getMarkdownFiles() {
      return [];
    },
    on() {
      return {} as never;
    },
    offref() {},
  };

  const fileManager = {
    async renameFile(file: { path: string; name: string }, newPath: string) {
      const oldItem = files.get(file.path);
      if (!oldItem) throw new Error(`Source not found: ${file.path}`);
      files.delete(file.path);

      const newName = newPath.split('/').pop()!;
      if (oldItem instanceof MockFolder) {
        const moved = new MockFolder(newPath, newName);
        files.set(newPath, moved);
        // Also update subpaths
        for (const [key, val] of [...files.entries()]) {
          if (key.startsWith(file.path + '/')) {
            const suffix = key.slice(file.path.length);
            files.delete(key);
            val.path = newPath + suffix;
            files.set(val.path, val);
            if (val instanceof MockFile || val instanceof MockFolder) {
              moved.children.push(val);
            }
          }
        }
      } else {
        const moved = new MockFile(newPath, newName, oldItem.content);
        files.set(newPath, moved);
      }
    },
  };

  const workspace = {
    getLeavesOfType() {
      return [];
    },
  };

  const metadataCache = {
    getFileCache() {
      return null;
    },
    on() {
      return {} as never;
    },
    offref() {},
  };

  return {
    vault,
    fileManager,
    workspace,
    metadataCache,
    files,
  };
}

describe('changeRootFolder integration', () => {
  beforeEach(() => {
    mockPromptResult = null;
    vi.clearAllMocks();
  });

  it('rejects invalid vault relative paths', async () => {
    const app = createMockApp();
    const plugin = new FeedReaderPlugin(app as never, {} as never);
    plugin.settings = { ...DEFAULT_SETTINGS };

    await expect(plugin.changeRootFolder('')).rejects.toThrow('Choose a vault-relative folder');
    await expect(plugin.changeRootFolder('/absolute/path')).rejects.toThrow('Choose a vault-relative folder');
    await expect(plugin.changeRootFolder('../escape')).rejects.toThrow('Choose a vault-relative folder');
  });

  it('no-ops when target path equals current rootFolder', async () => {
    const app = createMockApp();
    const plugin = new FeedReaderPlugin(app as never, {} as never);
    plugin.settings = { ...DEFAULT_SETTINGS, rootFolder: 'Feed Reader' };

    await plugin.changeRootFolder('Feed Reader');
    expect(promptRootFolderAction).not.toHaveBeenCalled();
  });

  it('rejects if a file already exists at the target path', async () => {
    const app = createMockApp();
    await app.vault.create('some-file.md', 'content');
    const plugin = new FeedReaderPlugin(app as never, {} as never);
    plugin.settings = { ...DEFAULT_SETTINGS, rootFolder: 'Feed Reader' };

    await expect(plugin.changeRootFolder('some-file.md')).rejects.toThrow('A file with the same name already exists');
  });

  it('rejects moving folder into its own subfolder', async () => {
    const app = createMockApp();
    mockPromptResult = 'move';
    const plugin = new FeedReaderPlugin(app as never, {} as never);
    plugin.settings = { ...DEFAULT_SETTINGS, rootFolder: 'Feed Reader' };

    await expect(plugin.changeRootFolder('Feed Reader/Subfolder')).rejects.toThrow(
      'Cannot move a folder into its own subfolder',
    );
  });

  it('does nothing when target folder is empty and user cancels prompt', async () => {
    const app = createMockApp();
    await app.vault.createFolder('Feed Reader');
    await app.vault.create('Feed Reader/feeds.yaml', 'version: 1\nfeeds: []\nfolders: []');
    mockPromptResult = null; // User cancelled

    const plugin = new FeedReaderPlugin(app as never, {} as never);
    plugin.settings = { ...DEFAULT_SETTINGS, rootFolder: 'Feed Reader' };

    await plugin.changeRootFolder('New Feeds');
    expect(promptRootFolderAction).toHaveBeenCalledWith(app, 'Feed Reader', 'New Feeds');
    expect(plugin.settings.rootFolder).toBe('Feed Reader');
    expect(app.files.has('Feed Reader/feeds.yaml')).toBe(true);
    expect(app.files.has('New Feeds')).toBe(false);
  });

  it('moves files to new folder when user selects "move"', async () => {
    const app = createMockApp();
    await app.vault.createFolder('Feed Reader');
    await app.vault.create('Feed Reader/feeds.yaml', 'version: 1\nfeeds: []\nfolders: []\n');
    await app.vault.createFolder('Feed Reader/Articles');
    await app.vault.create('Feed Reader/Articles/test.md', '# Note');
    await app.vault.createFolder('Feed Reader/state');
    await app.vault.create('Feed Reader/state/source-ids.json', '{}');

    mockPromptResult = 'move';

    const plugin = new FeedReaderPlugin(app as never, {} as never);
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      rootFolder: 'Feed Reader',
      subscriptionsPath: 'Feed Reader/feeds.yaml',
      savedArticlesFolder: 'Feed Reader/Articles',
    };

    // Mock services on plugin
    const mockSubscriptions = {
      identityPath: 'Feed Reader/state/source-ids.json',
      getSnapshot: () => ({ writable: true, document: { feeds: [] } }),
      setPath: vi.fn(async () => ({ writable: true, document: { feeds: [] } })),
    };
    const mockReadState = {
      directory: 'Feed Reader/state',
      setDirectory: vi.fn(),
    };
    const mockSaves = {
      dispose: vi.fn(),
      start: vi.fn(),
      listSavedArticles: vi.fn(() => []),
    };

    (plugin as unknown as { subscriptions: unknown }).subscriptions = mockSubscriptions;
    (plugin as unknown as { readState: unknown }).readState = mockReadState;
    (plugin as unknown as { saves: unknown }).saves = mockSaves;
    (plugin as unknown as { makeSaveService: unknown }).makeSaveService = vi.fn(() => mockSaves);
    (plugin as unknown as { reconcileSources: unknown }).reconcileSources = vi.fn(async () => {});
    (plugin as unknown as { saveSettings: unknown }).saveSettings = vi.fn(async () => {});

    await plugin.changeRootFolder('My Feeds');

    expect(promptRootFolderAction).toHaveBeenCalledWith(app, 'Feed Reader', 'My Feeds');
    expect(plugin.settings.rootFolder).toBe('My Feeds');
    expect(plugin.settings.subscriptionsPath).toBe('My Feeds/feeds.yaml');
    expect(plugin.settings.savedArticlesFolder).toBe('My Feeds/Articles');

    expect(mockReadState.setDirectory).toHaveBeenCalledWith('My Feeds/state');
    expect(mockSubscriptions.setPath).toHaveBeenCalledWith('My Feeds/feeds.yaml', 'My Feeds/state/source-ids.json');

    // Check files were moved
    expect(app.files.has('My Feeds/feeds.yaml')).toBe(true);
    expect(app.files.has('My Feeds/Articles/test.md')).toBe(true);
    expect(app.files.has('My Feeds/state/source-ids.json')).toBe(true);
    expect(app.files.has('Feed Reader')).toBe(false);
  });

  it('creates new RSS source and keeps original folder intact when user selects "create-new"', async () => {
    const app = createMockApp();
    await app.vault.createFolder('Feed Reader');
    await app.vault.create('Feed Reader/feeds.yaml', 'version: 1\nfeeds: []\nfolders: []\n');

    mockPromptResult = 'create-new';

    const plugin = new FeedReaderPlugin(app as never, {} as never);
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      rootFolder: 'Feed Reader',
      subscriptionsPath: 'Feed Reader/feeds.yaml',
      savedArticlesFolder: 'Feed Reader/Articles',
    };

    const mockSubscriptions = {
      identityPath: 'Feed Reader/state/source-ids.json',
      getSnapshot: () => ({ writable: true, document: { feeds: [] } }),
      setPath: vi.fn(async () => ({ writable: true, document: { feeds: [] } })),
    };
    const mockReadState = {
      directory: 'Feed Reader/state',
      setDirectory: vi.fn(),
    };
    const mockSaves = {
      dispose: vi.fn(),
      start: vi.fn(),
      listSavedArticles: vi.fn(() => []),
    };

    (plugin as unknown as { subscriptions: unknown }).subscriptions = mockSubscriptions;
    (plugin as unknown as { readState: unknown }).readState = mockReadState;
    (plugin as unknown as { saves: unknown }).saves = mockSaves;
    (plugin as unknown as { makeSaveService: unknown }).makeSaveService = vi.fn(() => mockSaves);
    (plugin as unknown as { reconcileSources: unknown }).reconcileSources = vi.fn(async () => {});
    (plugin as unknown as { saveSettings: unknown }).saveSettings = vi.fn(async () => {});

    await plugin.changeRootFolder('Brand New Feeds');

    expect(promptRootFolderAction).toHaveBeenCalledWith(app, 'Feed Reader', 'Brand New Feeds');
    expect(plugin.settings.rootFolder).toBe('Brand New Feeds');
    expect(plugin.settings.subscriptionsPath).toBe('Brand New Feeds/feeds.yaml');
    expect(plugin.settings.savedArticlesFolder).toBe('Brand New Feeds/Articles');

    // Original folder still intact
    expect(app.files.has('Feed Reader/feeds.yaml')).toBe(true);

    // New folder has new empty feeds.yaml
    expect(app.files.has('Brand New Feeds/feeds.yaml')).toBe(true);
    expect(mockReadState.setDirectory).toHaveBeenCalledWith('Brand New Feeds/state');
    expect(mockSubscriptions.setPath).toHaveBeenCalledWith('Brand New Feeds/feeds.yaml', 'Brand New Feeds/state/source-ids.json');
  });

  it('switches to folder directly without prompt when target folder is not empty', async () => {
    const app = createMockApp();
    await app.vault.createFolder('Existing Feeds');
    await app.vault.create('Existing Feeds/feeds.yaml', 'version: 1\nfeeds: []\nfolders: []\n');

    const plugin = new FeedReaderPlugin(app as never, {} as never);
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      rootFolder: 'Feed Reader',
      subscriptionsPath: 'Feed Reader/feeds.yaml',
      savedArticlesFolder: 'Feed Reader/Articles',
    };

    const mockSubscriptions = {
      identityPath: 'Feed Reader/state/source-ids.json',
      getSnapshot: () => ({ writable: true, document: { feeds: [] } }),
      setPath: vi.fn(async () => ({ writable: true, document: { feeds: [] } })),
    };
    const mockReadState = {
      directory: 'Feed Reader/state',
      setDirectory: vi.fn(),
    };
    const mockSaves = {
      dispose: vi.fn(),
      start: vi.fn(),
      listSavedArticles: vi.fn(() => []),
    };

    (plugin as unknown as { subscriptions: unknown }).subscriptions = mockSubscriptions;
    (plugin as unknown as { readState: unknown }).readState = mockReadState;
    (plugin as unknown as { saves: unknown }).saves = mockSaves;
    (plugin as unknown as { makeSaveService: unknown }).makeSaveService = vi.fn(() => mockSaves);
    (plugin as unknown as { reconcileSources: unknown }).reconcileSources = vi.fn(async () => {});
    (plugin as unknown as { saveSettings: unknown }).saveSettings = vi.fn(async () => {});

    await plugin.changeRootFolder('Existing Feeds');

    // Should NOT have prompted the modal because folder is NOT empty
    expect(promptRootFolderAction).not.toHaveBeenCalled();
    expect(plugin.settings.rootFolder).toBe('Existing Feeds');
    expect(plugin.settings.subscriptionsPath).toBe('Existing Feeds/feeds.yaml');
    expect(plugin.settings.savedArticlesFolder).toBe('Existing Feeds/Articles');
    expect(mockReadState.setDirectory).toHaveBeenCalledWith('Existing Feeds/state');
    expect(mockSubscriptions.setPath).toHaveBeenCalledWith('Existing Feeds/feeds.yaml', 'Existing Feeds/state/source-ids.json');
  });
});
