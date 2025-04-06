/**
 * Settings IPC Handlers
 * Provides handlers for settings-related IPC operations.
 * 
 * Related files:
 * - preload.js: Exposes these handlers to the renderer
 * - main.js: Registers these handlers
 */

const { ipcMain } = require('electron');
const { createStore } = require('../../utils/storeFactory');

// Create a store for settings
const settingsStore = createStore('settings', {
  encryptionKey: process.env.STORE_ENCRYPTION_KEY
});

// Default settings
const DEFAULT_SETTINGS = {
  ocr: {
    enabled: false
  },
  transcription: {
    model: 'whisper-1'
  }
};

// Register handlers
function registerHandlers() {
  // Get a setting
  ipcMain.handle('codex:get-setting', async (event, key) => {
    try {
      const parts = key.split('.');
      let value = settingsStore.get(parts[0], DEFAULT_SETTINGS[parts[0]]);
      
      // Navigate through nested properties
      for (let i = 1; i < parts.length; i++) {
        if (value === undefined || value === null) return undefined;
        value = value[parts[i]];
      }
      
      return value;
    } catch (error) {
      console.error(`Error getting setting ${key}:`, error);
      return undefined;
    }
  });

  // Set a setting
  ipcMain.handle('codex:set-setting', async (event, key, value) => {
    try {
      const parts = key.split('.');
      
      if (parts.length === 1) {
        // Top-level setting
        settingsStore.set(key, value);
      } else {
        // Nested setting
        const topLevel = parts[0];
        const current = settingsStore.get(topLevel, {});
        
        // Navigate to the right nesting level
        let target = current;
        for (let i = 1; i < parts.length - 1; i++) {
          if (!target[parts[i]]) target[parts[i]] = {};
          target = target[parts[i]];
        }
        
        // Set the value
        target[parts[parts.length - 1]] = value;
        settingsStore.set(topLevel, current);
      }
      
      return { success: true };
    } catch (error) {
      console.error(`Error setting ${key}:`, error);
      return { success: false, error: error.message };
    }
  });

  // OCR specific handlers
  ipcMain.handle('codex:settings:get-ocr-enabled', async () => {
    const enabled = settingsStore.get('ocr.enabled', DEFAULT_SETTINGS.ocr.enabled);
    console.log('🔍 [Settings] Get OCR enabled:', enabled);
    return enabled;
  });
  
  ipcMain.handle('codex:settings:get-ocr-enabled-direct', async () => {
    const enabled = settingsStore.get('ocr.enabled', DEFAULT_SETTINGS.ocr.enabled);
    console.log('🔍 [Settings] Get OCR enabled (direct):', enabled);
    return enabled;
  });

  ipcMain.handle('codex:settings:set-ocr-enabled', async (event, { enabled }) => {
    try {
      const ocr = settingsStore.get('ocr', DEFAULT_SETTINGS.ocr);
      ocr.enabled = enabled;
      settingsStore.set('ocr', ocr);
      return { success: true };
    } catch (error) {
      console.error('Error setting OCR enabled:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerHandlers
};
