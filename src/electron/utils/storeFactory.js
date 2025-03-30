/**
 * Store Factory
 * 
 * Creates electron-store instances with built-in error handling and corruption prevention.
 * This factory ensures that store corruption doesn't crash the application and
 * provides fallback in-memory stores when needed.
 * 
 * Usage:
 * const { createStore } = require('./utils/storeFactory');
 * const myStore = createStore('my-store-name');
 */

const Store = require('electron-store');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Track created stores for cleanup
const storeInstances = new Map();

/**
 * Creates a store with error handling and corruption prevention
 * @param {string} name - Unique name for the store
 * @param {Object} options - Additional store options
 * @returns {Object} The store instance or a fallback in-memory store
 */
function createStore(name, options = {}) {
  // Check if we already have this store
  if (storeInstances.has(name)) {
    return storeInstances.get(name);
  }

  try {
    // Configure store with options to prevent corruption
    const store = new Store({
      name,
      clearInvalidConfig: true, // Automatically clear invalid config
      serialize: (value) => JSON.stringify(value, null, 2), // Pretty format JSON
      deserialize: (value) => {
        try {
          return JSON.parse(value);
        } catch (error) {
          console.error(`Failed to parse ${name} store data, resetting to defaults:`, error);
          return {}; // Return empty object if parsing fails
        }
      },
      ...options
    });
    
    console.log(`✅ Store "${name}" initialized successfully`);
    
    // Save the instance
    storeInstances.set(name, store);
    return store;
  } catch (error) {
    console.error(`❌ Failed to initialize store "${name}":`, error);
    
    // Create a fallback in-memory store
    const fallbackStore = {
      get: (key) => null,
      set: (key, value) => {},
      has: (key) => false,
      delete: (key) => {},
      clear: () => {},
      store: {},
      path: null,
      size: 0,
      // Add other methods that might be used
      onDidChange: () => ({ unsubscribe: () => {} }),
      onDidAnyChange: () => ({ unsubscribe: () => {} }),
      openInEditor: () => {}
    };
    
    console.log(`⚠️ Using in-memory fallback store for "${name}"`);
    
    // Save the fallback instance
    storeInstances.set(name, fallbackStore);
    return fallbackStore;
  }
}

/**
 * Attempts to repair a corrupted store file
 * @param {string} name - Name of the store to repair
 * @returns {boolean} Whether the repair was successful
 */
function repairStore(name) {
  try {
    // Get the store path
    const storePath = path.join(
      app.getPath('userData'),
      `${name}.json`
    );
    
    console.log(`🔧 Attempting to repair store: ${storePath}`);
    
    // Check if file exists
    if (!fs.existsSync(storePath)) {
      console.log(`Store file not found: ${storePath}`);
      return false;
    }
    
    // Create a backup
    const backupPath = `${storePath}.backup-${Date.now()}`;
    fs.copyFileSync(storePath, backupPath);
    console.log(`📦 Created backup at: ${backupPath}`);
    
    // Reset the file with empty JSON
    fs.writeFileSync(storePath, '{}');
    console.log(`🔄 Reset store file with empty configuration: ${storePath}`);
    
    return true;
  } catch (error) {
    console.error(`Failed to repair store "${name}":`, error);
    return false;
  }
}

/**
 * Cleans up all store instances
 */
function cleanupStores() {
  storeInstances.clear();
  console.log('🧹 Cleaned up all store instances');
}

module.exports = {
  createStore,
  repairStore,
  cleanupStores
};
