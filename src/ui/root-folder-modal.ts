import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

export type RootFolderChoice = 'move' | 'create-new' | null;

export class RootFolderChangeModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly oldFolder: string,
    private readonly newFolder: string,
    private readonly onChoice: (choice: RootFolderChoice) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t("Change Feed Reader root folder"));
    this.contentEl.createEl('p', {
      text: t(
        'The destination folder "{newFolder}" is empty. Would you like to move files from the original folder "{oldFolder}", or create a new RSS source in the new directory?',
        { oldFolder: this.oldFolder, newFolder: this.newFolder },
      ),
    });

    new Setting(this.contentEl)
      .setName(t("Move original files"))
      .setDesc(t("Move all existing feeds, reading state, and notes from the original folder to the new folder."))
      .addButton(button =>
        button
          .setButtonText(t("Move files"))
          .setCta()
          .onClick(() => this.finish('move')),
      );

    new Setting(this.contentEl)
      .setName(t("Create new RSS source"))
      .setDesc(t("Keep the original folder unchanged and start with an empty RSS source in the new folder."))
      .addButton(button =>
        button
          .setButtonText(t("Create new source"))
          .onClick(() => this.finish('create-new')),
      );

    new Setting(this.contentEl).addButton(button =>
      button.setButtonText(t("Cancel")).onClick(() => this.finish(null)),
    );
  }

  private finish(choice: RootFolderChoice): void {
    this.settled = true;
    this.close();
    this.onChoice(choice);
  }

  onClose(): void {
    if (!this.settled) this.onChoice(null);
    this.contentEl.empty();
  }
}

export function promptRootFolderAction(
  app: App,
  oldFolder: string,
  newFolder: string,
): Promise<RootFolderChoice> {
  return new Promise(resolve => {
    new RootFolderChangeModal(app, oldFolder, newFolder, resolve).open();
  });
}
