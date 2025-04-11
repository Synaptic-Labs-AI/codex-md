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
    model: 'whisper'
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
      console.log(`[Settings Handler] Setting ${key} to: ${value} (type: ${typeof value})`);
      
      // Log current store value
      const currentValue = settingsStore.get(key);
      console.log(`[Settings Handler] Current value of ${key}: ${currentValue} (type: ${typeof currentValue})`);
      
      const parts = key.split('.');
      
      if (parts.length === 1) {
        // Top-level setting
        console.log(`[Settings Handler] Setting top-level setting ${key}`);
        settingsStore.set(key, value);
      } else {
        // Nested setting
        console.log(`[Settings Handler] Setting nested setting ${key}`);
        const topLevel = parts[0];
        const current = settingsStore.get(topLevel, {});
        console.log(`[Settings Handler] Current top-level object:`, current);
        
        // Navigate to the right nesting level
        let target = current;
        for (let i = 1; i < parts.length - 1; i++) {
          if (!target[parts[i]]) {
            console.log(`[Settings Handler] Creating nested object at ${parts.slice(0, i+1).join('.')}`);
            target[parts[i]] = {};
          }
          target = target[parts[i]];
        }
        
        // Set the value
        const lastKey = parts[parts.length - 1];
        const oldValue = target[lastKey];
        target[lastKey] = value;
        console.log(`[Settings Handler] Updated ${key} from ${oldValue} to ${value}`);
        
        settingsStore.set(topLevel, current);
      }
      
      // Verify the setting was saved
      const savedValue = settingsStore.get(key);
      console.log(`[Settings Handler] Successfully set ${key} to: ${savedValue} (type: ${typeof savedValue})`);
      
      return { success: true };
    } catch (error) {
      console.error(`Error setting ${key}:`, error);
      return { success: false, error: error.message };
    }
  });

  // OCR specific handlers
  ipcMain.handle('codex:settings:get-ocr-enabled', async () => {
    // Check both ways of accessing the setting
    const nestedEnabled = settingsStore.get('ocr.enabled', DEFAULT_SETTINGS.ocr.enabled);
    const ocr = settingsStore.get('ocr', DEFAULT_SETTINGS.ocr);
    const directEnabled = ocr.enabled;
    
    console.log('🔍 [Settings] Get OCR enabled (nested):', nestedEnabled, `(type: ${typeof nestedEnabled})`);
    console.log('🔍 [Settings] Get OCR enabled (direct):', directEnabled, `(type: ${typeof directEnabled})`);
    console.log('🔍 [Settings] Full OCR object:', ocr);
    
    return nestedEnabled;
  });
  
  ipcMain.handle('codex:settings:get-ocr-enabled-direct', async () => {
    const enabled = settingsStore.get('ocr.enabled', DEFAULT_SETTINGS.ocr.enabled);
    console.log('🔍 [Settings] Get OCR enabled (direct):', enabled, `(type: ${typeof enabled})`);
    
    // Also check the raw store data
    const rawData = settingsStore.store;
    console.log('🔍 [Settings] Raw store data:', rawData);
    
    return enabled;
  });

  ipcMain.handle('codex:settings:set-ocr-enabled', async (event, { enabled }) => {
    try {
      console.log(`[Settings] Set OCR enabled called with:`, enabled, `(type: ${typeof enabled})`);
      
      // Ensure enabled is a boolean
      const boolEnabled = Boolean(enabled);
      console.log(`[Settings] Converted to boolean: ${boolEnabled} (type: ${typeof boolEnabled})`);
      
      // Get current value for comparison
      const currentOcr = settingsStore.get('ocr', DEFAULT_SETTINGS.ocr);
      console.log(`[Settings] Current OCR settings:`, currentOcr);
      
      // Update the setting
      const ocr = {...currentOcr};
      const oldValue = ocr.enabled;
      ocr.enabled = boolEnabled;
      console.log(`[Settings] Updating OCR enabled from ${oldValue} to ${boolEnabled}`);
      
      // Save to store
      settingsStore.set('ocr', ocr);
      
      // Verify the setting was saved
      const savedOcr = settingsStore.get('ocr');
      console.log(`[Settings] Saved OCR settings:`, savedOcr);
      console.log(`[Settings] Verified OCR enabled is now: ${savedOcr.enabled} (type: ${typeof savedOcr.enabled})`);
      
      // Double-check that the value was saved correctly
      if (savedOcr.enabled !== boolEnabled) {
        console.warn(`[Settings] Warning: Saved value (${savedOcr.enabled}) doesn't match requested value (${boolEnabled}). Attempting to fix...`);
        
        // Try setting directly with the dot notation
        settingsStore.set('ocr.enabled', boolEnabled);
        
        // Verify again
        const recheck = settingsStore.get('ocr');
        console.log(`[Settings] After fix attempt, OCR enabled is: ${recheck.enabled} (type: ${typeof recheck.enabled})`);
      }
      
      return { success: true, value: savedOcr.enabled };
    } catch (error) {
      console.error('Error setting OCR enabled:', error);
      return { success: false, error: error.message };
    }
  });
}
/**
 * Get a setting value directly (for use by other modules)
 * @param {string} key - The setting key
 * @param {any} defaultValue - Default value if setting not found
 * @returns {any} The setting value
 */
function getSettingValue(key, defaultValue) {
  try {
    const parts = key.split('.');
    let value = settingsStore.get(parts[0], DEFAULT_SETTINGS[parts[0]]);
    
    // Navigate through nested properties
    for (let i = 1; i < parts.length; i++) {
      if (value === undefined || value === null) return defaultValue;
      value = value[parts[i]];
    }
    
    return value !== undefined ? value : defaultValue;
  } catch (error) {
    console.error(`Error getting setting ${key}:`, error);
    return defaultValue;
  }
}

module.exports = {
  registerHandlers,
  getSettingValue
};
