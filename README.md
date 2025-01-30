# Klarity Sync Plugin

This plugin enables seamless synchronization between your Klarity transcriptions and Obsidian notes. It automatically syncs your transcribed notes from Klarity's online service to your Obsidian vault, maintaining all your thoughts and ideas in one place.

Through the plugin settings, you can customize the sync directory, frequency, and note template format. The plugin preserves all metadata including creation and update timestamps.

### Features

* Automatically sync transcriptions based on configurable minutes from Klarity
* Customize the sync directory and frequency
* Customizable note template format
* Preserves metadata (creation date, update date, IDs)
* Manual sync option via ribbon icon or command palette
* Status bar indicators during sync operations

### Installation

The Klarity Sync Plugin can be installed manually:

#### Method 1: BRAT Installation
* Enable Community Plugins in Obsidian and install [Obsidian42 - BRAT](https://github.com/TfTHacker/obsidian42-brat)
* Go to settings and under "Beta Plugin List" click "Add Beta plugin"
* Add this repository URL

#### Method 2: Manual Installation
* Create a `klarity-sync` folder under `.obsidian/plugins` in your vault
* Download the `main.js`, `manifest.json`, and `styles.css` files from the latest release
* Add these files to the folder you created
* Enable the plugin in Obsidian's Community Plugins settings

### Configuration

1. Open Obsidian Settings
2. Navigate to Community Plugins and find "Klarity Sync"
3. Enter your Klarity API key
4. Configure sync settings:
   * Set your preferred sync directory
   * Enable/disable auto-sync
   * Set sync interval
   * Customize note template

### Note Template

The plugin allows you to customize how your notes are formatted using these variables:
- `{{id}}` - Unique identifier
- `{{title}}` - Note title
- `{{createdAt}}` - Creation timestamp
- `{{updatedAt}}` - Last update timestamp
- `{{transcription}}` - The transcribed content
