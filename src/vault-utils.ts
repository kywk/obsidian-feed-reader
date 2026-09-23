import type { Vault } from 'obsidian';

export async function ensureFolderExists(vault: Vault, folderPath: string): Promise<void> {
  const parts = folderPath.split('/').filter(Boolean);
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

export async function ensureParentFolders(vault: Vault, filePath: string): Promise<void> {
  const parent = filePath.split('/').slice(0, -1).join('/');
  if (parent) {
    await ensureFolderExists(vault, parent);
  }
}
