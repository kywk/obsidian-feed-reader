import type { Vault } from 'obsidian';
import type { ReadStateStorage } from './storage';

async function ensureParentFolders(vault: Vault, path: string): Promise<void> {
  const parts = path.split('/').slice(0, -1);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!vault.getAbstractFileByPath(current)) {
      try {
        await vault.createFolder(current);
      } catch (error) {
        if (!vault.getAbstractFileByPath(current)) throw error;
      }
    }
  }
}

export class VaultReadStateStorage implements ReadStateStorage {
  constructor(private readonly vault: Vault) {}

  async read(path: string): Promise<string | null> {
    const file = this.vault.getFileByPath(path);
    return file ? this.vault.read(file) : null;
  }

  async write(path: string, contents: string): Promise<void> {
    await ensureParentFolders(this.vault, path);
    const file = this.vault.getFileByPath(path);
    if (file) await this.vault.modify(file, contents);
    else await this.vault.create(path, contents);
  }
}
