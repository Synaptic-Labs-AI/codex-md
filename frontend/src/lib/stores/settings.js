/**
 * Settings Store
 * 
 * Manages application settings including OCR toggle state.
 * Provides methods for getting and setting OCR settings.
 * Persists settings to electron store when in electron environment.
 * 
 * Related files:
 * - frontend/src/routes/settings/+page.svelte: Settings UI
 * - src/electron/ipc/handlers/settings.js: Settings IPC handlers
 * - src/electron/adapters/pdfConverterAdapter.js: Uses OCR settings
 */

import { writable } from 'svelte/store';

// Default settings
const DEFAULT_SETTINGS = {
  ocr: {
    enabled: false
  }
};

// Create the settings store
const createSettingsStore = () => {
  const { subscribe, set, update } = writable(DEFAULT_SETTINGS);
  
  return {
    subscribe,
    set,
    update,
    
    /**
     * Set OCR enabled state
     * @param {boolean} enabled - Whether OCR is enabled
     */
    setOcrEnabled: (enabled) => {
      update(settings => {
        // Create ocr object if it doesn't exist
        if (!settings.ocr) {
          settings.ocr = {};
        }
        
        // Update enabled state
        settings.ocr.enabled = enabled;
        
        // Save to electron store
        window.electronAPI.setSetting('ocr.enabled', enabled)
          .catch(err => console.error('Error saving OCR setting:', err));
        
        return settings;
      });
    },
    
    /**
     * Reset settings to defaults
     */
    reset: () => {
      set(DEFAULT_SETTINGS);
      
      // Save to electron store
      Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
        window.electronAPI.setSetting(key, value)
          .catch(err => console.error(`Error resetting setting ${key}:`, err));
      });
    }
  };
};

// Create and export the settings store
export const settings = createSettingsStore();

// Export helper functions
export const setOcrEnabled = settings.setOcrEnabled;
export const resetSettings = settings.reset;

/**
 * Get settings object
 * @returns {Object} Settings object
 */
export const getSettings = () => {
  let result;
  settings.subscribe(value => {
    result = value;
  })();
  return result;
};

/**
 * Update a setting
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 */
export const updateSetting = (key, value) => {
  settings.update(settings => {
    // Handle nested keys
    const keys = key.split('.');
    let current = settings;
    
    // Navigate to the right nesting level
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    // Set the value
    current[keys[keys.length - 1]] = value;
    
    // Save to electron store
    window.electronAPI.setSetting(key, value)
      .catch(err => console.error(`Error updating setting ${key}:`, err));
    
    return settings;
  });
};

/**
 * Check if OCR is enabled
 * @returns {boolean} Whether OCR is enabled
 */
export const isOcrEnabled = () => {
  let result = false;
  settings.subscribe(value => {
    result = value.ocr?.enabled || false;
  })();
  return result;
};

/**
 * Set transcription model
 * @param {string} model - Transcription model
 */
export const setTranscriptionModel = (model) => {
  updateSetting('transcription.model', model);
};

/**
 * Get transcription model
 * @returns {string} Transcription model
 */
export const getTranscriptionModel = () => {
  let result = 'whisper-1';
  settings.subscribe(value => {
    result = value.transcription?.model || 'whisper-1';
  })();
  return result;
};
