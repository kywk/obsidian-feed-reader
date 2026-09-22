import type { EventRef, Vault } from 'obsidian';
import type { SubscriptionStorage } from './storage';

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

export class VaultSubscriptionStorage implements SubscriptionStorage {
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

  watch(path: string, onChange: () => void): () => void {
    const refs: EventRef[] = [
      this.vault.on('create', file => { if (file.path === path) onChange(); }),
      this.vault.on('modify', file => { if (file.path === path) onChange(); }),
      this.vault.on('delete', file => { if (file.path === path) onChange(); }),
      this.vault.on('rename', (file, oldPath) => { if (file.path === path || oldPath === path) onChange(); }),
    ];
    return () => refs.forEach(ref => this.vault.offref(ref));
  }
}
