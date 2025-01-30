import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  Notice,
  normalizePath,
} from "obsidian";

interface KlarityPluginSettings {
  apiKey: string;
  syncDirectory: string;
  lastSyncTime: string;
  autoSync: boolean;
  syncTimeout: number; // minutes
  noteTemplate: string;
}

const DEFAULT_SETTINGS: KlarityPluginSettings = {
  apiKey: "",
  syncDirectory: "Klarity",
  lastSyncTime: "",
  autoSync: false,
  syncTimeout: 5,
  noteTemplate: `---
id: {{id}}
created: {{createdAt}}
updated: {{updatedAt}}
---

# {{title}}

## Transcription
{{transcription}}
`,
};

interface KlarityNote {
  id: string;
  title: string;
  transcription: string;
  createdAt: string;
  updatedAt: string;
}

export default class KlarityPlugin extends Plugin {
  settings: KlarityPluginSettings;
  syncIntervalId: NodeJS.Timeout | null = null;

  async onload() {
    await this.loadSettings();

    // Add settings tab
    this.addSettingTab(new KlaritySettingTab(this.app, this));

    // Add ribbon icon for manual sync
    this.addRibbonIcon("sync", "Sync with Klarity", async () => {
      await this.syncNotes(true);
    });

    // Add command for manual sync
    this.addCommand({
      id: "sync-klarity",
      name: "Sync with Klarity",
      callback: async () => {
        await this.syncNotes(true);
      },
    });

    // Setup auto sync
    this.setupAutoSync();

    // Initial sync after a short delay
    setTimeout(async () => {
      await this.syncNotes(false);
    }, 1000);
  }

  setupAutoSync() {
    this.clearAutoSync();
    if (this.settings.autoSync) {
      this.syncIntervalId = setInterval(() => {
        this.syncNotes(false);
      }, this.settings.syncTimeout * 60 * 1000);
    }
  }

  clearAutoSync() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  onunload() {
    this.clearAutoSync();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async fetchNotes(): Promise<{ notes: KlarityNote[] }> {
    try {
      const response = await fetch("https://local-api.klarity.pro/api/notes", {
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch notes from Klarity");
      }

      const result = await response.json();

      console.log(result);

      return result;
    } catch (error) {
      console.error("Error fetching notes:", error);
      throw error;
    }
  }

  private sanitizeFilename(filename: string): string {
    // Replace invalid characters with hyphens
    // Adding more invalid characters that could cause issues
    return filename.replace(/[\\/:*?"<>|]/g, "-");
  }

  private formatNote(note: KlarityNote): string {
    return this.settings.noteTemplate
      .replace(/{{id}}/g, note.id)
      .replace(/{{title}}/g, note.title)
      .replace(/{{createdAt}}/g, note.createdAt)
      .replace(/{{updatedAt}}/g, note.updatedAt)
      .replace(/{{transcription}}/g, note.transcription);
  }

  async createOrUpdateNote(note: KlarityNote) {
    const folderPath = normalizePath(this.settings.syncDirectory);

    // Create folder if it doesn't exist
    if (!(await this.app.vault.adapter.exists(folderPath))) {
      await this.app.vault.createFolder(folderPath);
    }

    const fileName = `${this.sanitizeFilename(note.title)}.md`;
    const filePath = `${folderPath}/${fileName}`;
    const content = this.formatNote(note);

    try {
      if (await this.app.vault.adapter.exists(filePath)) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          await this.app.vault.modify(file, content);
        }
      } else {
        await this.app.vault.create(filePath, content);
      }
    } catch (error) {
      console.error(`Error creating/updating note ${fileName}:`, error);
      throw error;
    }
  }

  async syncNotes(showNotice: boolean = true) {
    if (!this.settings.apiKey) {
      new Notice("Please set your Klarity API key in settings");
      return;
    }

    const statusBarItem = this.addStatusBarItem();
    statusBarItem.setText("Syncing with Klarity...");

    if (showNotice) {
      new Notice("Starting Klarity sync...");
    }

    try {
      const { notes } = await this.fetchNotes();
      let processed = 0;

      for (const note of notes) {
        await this.createOrUpdateNote(note);
        processed++;
        statusBarItem.setText(
          `Syncing with Klarity... ${processed}/${notes.length}`
        );
      }

      this.settings.lastSyncTime = new Date().toISOString();
      await this.saveSettings();

      const message = `Synced ${notes.length} notes from Klarity`;
      statusBarItem.setText(message);
      if (showNotice) {
        new Notice(message);
      }

      setTimeout(() => {
        statusBarItem.remove();
      }, 5000);
    } catch (error) {
      const errorMessage = "Failed to sync with Klarity";
      statusBarItem.setText(errorMessage);
      new Notice(errorMessage);
      setTimeout(() => {
        statusBarItem.remove();
      }, 5000);
      console.error("Sync failed:", error);
    }
  }
}

class KlaritySettingTab extends PluginSettingTab {
  plugin: KlarityPlugin;

  constructor(app: App, plugin: KlarityPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Klarity Sync Settings" });

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("Your Klarity API key")
      .addText((text) =>
        text
          .setPlaceholder("Enter your API key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Sync Directory")
      .setDesc("Directory to sync Klarity notes to")
      .addText((text) =>
        text
          .setPlaceholder("Enter directory name")
          .setValue(this.plugin.settings.syncDirectory)
          .onChange(async (value) => {
            this.plugin.settings.syncDirectory = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto Sync")
      .setDesc("Automatically sync notes periodically")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSync)
          .onChange(async (value) => {
            this.plugin.settings.autoSync = value;
            await this.plugin.saveSettings();
            if (value) {
              this.plugin.setupAutoSync();
            } else {
              this.plugin.clearAutoSync();
            }
          })
      );

    new Setting(containerEl)
      .setName("Sync Interval")
      .setDesc("How often to sync (in minutes)")
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.syncTimeout))
          .onChange(async (value) => {
            const timeout = Number(value);
            if (!isNaN(timeout) && timeout > 0) {
              this.plugin.settings.syncTimeout = timeout;
              await this.plugin.saveSettings();
              if (this.plugin.settings.autoSync) {
                this.plugin.setupAutoSync();
              }
            }
          })
      );

    new Setting(containerEl)
      .setName("Note Template")
      .setDesc(
        "Template for creating notes (use {{id}}, {{title}}, {{createdAt}}, {{updatedAt}}, {{transcription}})"
      )
      .addTextArea((text) =>
        text
          .setPlaceholder("Enter note template")
          .setValue(this.plugin.settings.noteTemplate)
          .onChange(async (value) => {
            this.plugin.settings.noteTemplate = value;
            await this.plugin.saveSettings();
          })
      );

    if (this.plugin.settings.lastSyncTime) {
      containerEl.createEl("p", {
        text: `Last synced: ${new Date(
          this.plugin.settings.lastSyncTime
        ).toLocaleString()}`,
      });
    }
  }
}
