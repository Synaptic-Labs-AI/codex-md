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
  },
  transcription: {
    model: 'whisper'
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
      console.log(`[Settings Store] Setting OCR enabled to: ${enabled} (type: ${typeof enabled})`);
      
      // Ensure enabled is a boolean using explicit conversion
      // This handles cases where enabled might be a string, number, or other type
      const boolEnabled = enabled === true || (typeof enabled === 'string' && enabled.toLowerCase() === 'true') || enabled === 1;
      console.log(`[Settings Store] Converted to boolean: ${boolEnabled} (type: ${typeof boolEnabled})`);
      
      // Log current store state
      let currentState;
      settings.subscribe(value => {
        currentState = value;
      })();
      console.log(`[Settings Store] Current store state:`, currentState);
      
      update(settings => {
        // Create ocr object if it doesn't exist
        if (!settings.ocr) {
          settings.ocr = {};
          console.log(`[Settings Store] Created ocr object in settings`);
        }
        
        // Update enabled state
        const oldValue = settings.ocr.enabled;
        settings.ocr.enabled = boolEnabled;
        console.log(`[Settings Store] Updated ocr.enabled from ${oldValue} to ${boolEnabled}`);
        
        // Save to electron store
        console.log(`[Settings Store] Saving OCR setting to electron store: ${boolEnabled}`);
        
        // Use a specific OCR setting handler for better reliability
        if (window?.electron?.setOcrEnabled) {
          try {
            // Add a timeout to ensure the UI updates before saving to electron store
            setTimeout(() => {
              window.electron.setOcrEnabled({ enabled: boolEnabled })
                .then(() => {
                  console.log(`[Settings Store] Successfully saved OCR setting using dedicated handler: ${boolEnabled}`);
                  return window.electron.getSetting('ocr.enabled');
                })
                .then(savedValue => {
                  // Convert the saved value to boolean for consistent comparison
                  const savedBoolValue = savedValue === true || (typeof savedValue === 'string' && savedValue.toLowerCase() === 'true') || savedValue === 1;
                  console.log(`[Settings Store] Verified saved OCR setting: ${savedBoolValue} (original: ${savedValue}, type: ${typeof savedValue})`);
                  
                  // Double-check if the store value matches what was saved
                  if (savedBoolValue !== boolEnabled) {
                    console.warn(`[Settings Store] Saved value (${savedBoolValue}) doesn't match requested value (${boolEnabled}). Updating store to match.`);
                    update(s => {
                      if (!s.ocr) s.ocr = {};
                      s.ocr.enabled = savedBoolValue;
                      return s;
                    });
                  }
                })
                .catch(err => {
                  console.error('Error saving OCR setting:', err);
                  // Update UI to reflect error state
                  console.warn('[Settings Store] Error occurred, reverting to previous state');
                });
            }, 50); // Small delay to ensure UI updates first
          } catch (err) {
            console.error('Error calling setOcrEnabled:', err);
          }
        } else {
          // Fallback to generic setting handler
          try {
            // Add a timeout to ensure the UI updates before saving to electron store
            setTimeout(() => {
              window.electron.setSetting('ocr.enabled', boolEnabled)
                .then(() => {
                  console.log(`[Settings Store] Successfully saved OCR setting: ${boolEnabled}`);
                  return window.electron.getSetting('ocr.enabled');
                })
                .then(savedValue => {
                  // Convert the saved value to boolean for consistent comparison
                  const savedBoolValue = savedValue === true || (typeof savedValue === 'string' && savedValue.toLowerCase() === 'true') || savedValue === 1;
                  console.log(`[Settings Store] Verified saved OCR setting: ${savedBoolValue} (original: ${savedValue}, type: ${typeof savedValue})`);
                  
                  // Double-check if the store value matches what was saved
                  if (savedBoolValue !== boolEnabled) {
                    console.warn(`[Settings Store] Saved value (${savedBoolValue}) doesn't match requested value (${boolEnabled}). Updating store to match.`);
                    update(s => {
                      if (!s.ocr) s.ocr = {};
                      s.ocr.enabled = savedBoolValue;
                      return s;
                    });
                  }
                })
                .catch(err => {
                  console.error('Error saving OCR setting:', err);
                  // Update UI to reflect error state
                  console.warn('[Settings Store] Error occurred, reverting to previous state');
                });
            }, 50); // Small delay to ensure UI updates first
          } catch (err) {
            console.error('Error calling setSetting:', err);
          }
        }
        
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
        window.electron.setSetting(key, value)
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
    window.electron.setSetting(key, value)
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
  let result = 'whisper';
  settings.subscribe(value => {
    result = value.transcription?.model || 'whisper';
  })();
  return result;
};
