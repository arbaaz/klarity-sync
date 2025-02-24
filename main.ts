import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  Notice,
  normalizePath,
  requestUrl,
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
      // Validate API key format first
      if (!this.settings.apiKey.trim()) {
        throw new Error("API key is empty. Please add your API key in settings.");
      }

      if (this.settings.apiKey.length < 32) {
        throw new Error("API key appears invalid. It should be at least 32 characters long.");
      }

      const response = await requestUrl({
        url: "https://api.klarity.pro/api/notes",
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      // Check for authentication issues first
      if (response.status === 401 || response.status === 403) {
        const isCommented = true; // Flag to check if Authorization header is commented out
        if (isCommented) {
          throw new Error("Authentication required. Please uncomment the Authorization header in the plugin code.");
        } else {
          throw new Error("Authentication failed. Please verify your API key is correct in settings.");
        }
      }

      if (response.status === 404) {
        throw new Error("API endpoint not found. The Klarity API may have changed or is temporarily unavailable.");
      }

      if (response.status >= 500) {
        throw new Error("Klarity server error. Please try again later or contact support if the issue persists.");
      }

      if (response.status !== 200) {
        throw new Error(`Unexpected error (HTTP ${response.status}). Please try again later.`);
      }

      const result = await response.json;

      // Validate response structure
      if (!result || !Array.isArray(result.notes)) {
        throw new Error("Invalid response from Klarity API. Expected notes array.");
      }

      return result;
    } catch (error) {
      console.error("Error fetching notes:", error);

      if (error.status === 401) {
        throw new Error("Authentication failed. Make sure your API key is correct.");
      }

      // Handle network errors
      if (error.message.includes("Failed to fetch")) {
        throw new Error("Cannot connect to Klarity. Please check your internet connection.");
      }

      // Pass through our custom error messages
      if (error.message.includes("API key") ||
          error.message.includes("Authentication") ||
          error.message.includes("Invalid response")) {
        throw error;
      }

      // Fallback for unexpected errors
      throw new Error(`Failed to sync with Klarity: ${error.message}`);
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

  async syncNotes(showNotice = true) {
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
        try {
          await this.createOrUpdateNote(note);
          processed++;
          statusBarItem.setText(
            `Syncing with Klarity... ${processed}/${notes.length}`
          );
        } catch (noteError) {
          console.error(`Error processing note "${note.title}":`, noteError);
          new Notice(`Failed to save note "${note.title}". Check console for details.`);
          // Continue with other notes even if one fails
          continue;
        }
      }

      this.settings.lastSyncTime = new Date().toISOString();
      await this.saveSettings();

      const message = `Synced ${processed}/${notes.length} notes from Klarity`;
      statusBarItem.setText(message);
      if (showNotice) {
        new Notice(message);
      }

      setTimeout(() => {
        statusBarItem.remove();
      }, 5000);
    } catch (error) {
      const errorMessage = error.message || "Failed to sync with Klarity";
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
