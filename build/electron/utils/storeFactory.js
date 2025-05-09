"use strict";

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
const {
  app
} = require('electron');

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
    // Handle encryption key properly
    const storeOptions = {
      name,
      clearInvalidConfig: true,
      // Automatically clear invalid config
      serialize: value => JSON.stringify(value, null, 2),
      // Pretty format JSON
      deserialize: value => {
        try {
          return JSON.parse(value);
        } catch (error) {
          console.error(`Failed to parse ${name} store data, resetting to defaults:`, error);
          return {}; // Return empty object if parsing fails
        }
      },
      ...options
    };

    // Only include encryptionKey if it's actually defined
    // This allows electron-store to use its default machine-specific encryption
    // which is more stable across restarts than an undefined/empty key
    if (options.encryptionKey === undefined || options.encryptionKey === null || options.encryptionKey === '') {
      console.log(`⚠️ No encryption key provided for store "${name}", using machine-specific encryption`);
      // Remove the encryptionKey property entirely if it exists but is empty/undefined
      delete storeOptions.encryptionKey;
    } else {
      console.log(`✅ Using provided encryption key for store "${name}"`);
    }

    // Configure store with options to prevent corruption
    const store = new Store(storeOptions);
    console.log(`✅ Store "${name}" initialized successfully`);

    // Save the instance
    storeInstances.set(name, store);
    return store;
  } catch (error) {
    console.error(`❌ Failed to initialize store "${name}":`, error);

    // Create a fallback in-memory store
    const fallbackStore = {
      get: key => null,
      set: (key, value) => {},
      has: key => false,
      delete: key => {},
      clear: () => {},
      store: {},
      path: null,
      size: 0,
      // Add other methods that might be used
      onDidChange: () => ({
        unsubscribe: () => {}
      }),
      onDidAnyChange: () => ({
        unsubscribe: () => {}
      }),
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
    const storePath = path.join(app.getPath('userData'), `${name}.json`);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJTdG9yZSIsInJlcXVpcmUiLCJwYXRoIiwiZnMiLCJhcHAiLCJzdG9yZUluc3RhbmNlcyIsIk1hcCIsImNyZWF0ZVN0b3JlIiwibmFtZSIsIm9wdGlvbnMiLCJoYXMiLCJnZXQiLCJzdG9yZU9wdGlvbnMiLCJjbGVhckludmFsaWRDb25maWciLCJzZXJpYWxpemUiLCJ2YWx1ZSIsIkpTT04iLCJzdHJpbmdpZnkiLCJkZXNlcmlhbGl6ZSIsInBhcnNlIiwiZXJyb3IiLCJjb25zb2xlIiwiZW5jcnlwdGlvbktleSIsInVuZGVmaW5lZCIsImxvZyIsInN0b3JlIiwic2V0IiwiZmFsbGJhY2tTdG9yZSIsImtleSIsImRlbGV0ZSIsImNsZWFyIiwic2l6ZSIsIm9uRGlkQ2hhbmdlIiwidW5zdWJzY3JpYmUiLCJvbkRpZEFueUNoYW5nZSIsIm9wZW5JbkVkaXRvciIsInJlcGFpclN0b3JlIiwic3RvcmVQYXRoIiwiam9pbiIsImdldFBhdGgiLCJleGlzdHNTeW5jIiwiYmFja3VwUGF0aCIsIkRhdGUiLCJub3ciLCJjb3B5RmlsZVN5bmMiLCJ3cml0ZUZpbGVTeW5jIiwiY2xlYW51cFN0b3JlcyIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vdXRpbHMvc3RvcmVGYWN0b3J5LmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBTdG9yZSBGYWN0b3J5XHJcbiAqIFxyXG4gKiBDcmVhdGVzIGVsZWN0cm9uLXN0b3JlIGluc3RhbmNlcyB3aXRoIGJ1aWx0LWluIGVycm9yIGhhbmRsaW5nIGFuZCBjb3JydXB0aW9uIHByZXZlbnRpb24uXHJcbiAqIFRoaXMgZmFjdG9yeSBlbnN1cmVzIHRoYXQgc3RvcmUgY29ycnVwdGlvbiBkb2Vzbid0IGNyYXNoIHRoZSBhcHBsaWNhdGlvbiBhbmRcclxuICogcHJvdmlkZXMgZmFsbGJhY2sgaW4tbWVtb3J5IHN0b3JlcyB3aGVuIG5lZWRlZC5cclxuICogXHJcbiAqIFVzYWdlOlxyXG4gKiBjb25zdCB7IGNyZWF0ZVN0b3JlIH0gPSByZXF1aXJlKCcuL3V0aWxzL3N0b3JlRmFjdG9yeScpO1xyXG4gKiBjb25zdCBteVN0b3JlID0gY3JlYXRlU3RvcmUoJ215LXN0b3JlLW5hbWUnKTtcclxuICovXHJcblxyXG5jb25zdCBTdG9yZSA9IHJlcXVpcmUoJ2VsZWN0cm9uLXN0b3JlJyk7XHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcclxuY29uc3QgeyBhcHAgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcblxyXG4vLyBUcmFjayBjcmVhdGVkIHN0b3JlcyBmb3IgY2xlYW51cFxyXG5jb25zdCBzdG9yZUluc3RhbmNlcyA9IG5ldyBNYXAoKTtcclxuXHJcbi8qKlxyXG4gKiBDcmVhdGVzIGEgc3RvcmUgd2l0aCBlcnJvciBoYW5kbGluZyBhbmQgY29ycnVwdGlvbiBwcmV2ZW50aW9uXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gVW5pcXVlIG5hbWUgZm9yIHRoZSBzdG9yZVxyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIEFkZGl0aW9uYWwgc3RvcmUgb3B0aW9uc1xyXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBUaGUgc3RvcmUgaW5zdGFuY2Ugb3IgYSBmYWxsYmFjayBpbi1tZW1vcnkgc3RvcmVcclxuICovXHJcbmZ1bmN0aW9uIGNyZWF0ZVN0b3JlKG5hbWUsIG9wdGlvbnMgPSB7fSkge1xyXG4gIC8vIENoZWNrIGlmIHdlIGFscmVhZHkgaGF2ZSB0aGlzIHN0b3JlXHJcbiAgaWYgKHN0b3JlSW5zdGFuY2VzLmhhcyhuYW1lKSkge1xyXG4gICAgcmV0dXJuIHN0b3JlSW5zdGFuY2VzLmdldChuYW1lKTtcclxuICB9XHJcblxyXG4gIHRyeSB7XHJcbiAgICAvLyBIYW5kbGUgZW5jcnlwdGlvbiBrZXkgcHJvcGVybHlcclxuICAgIGNvbnN0IHN0b3JlT3B0aW9ucyA9IHtcclxuICAgICAgbmFtZSxcclxuICAgICAgY2xlYXJJbnZhbGlkQ29uZmlnOiB0cnVlLCAvLyBBdXRvbWF0aWNhbGx5IGNsZWFyIGludmFsaWQgY29uZmlnXHJcbiAgICAgIHNlcmlhbGl6ZTogKHZhbHVlKSA9PiBKU09OLnN0cmluZ2lmeSh2YWx1ZSwgbnVsbCwgMiksIC8vIFByZXR0eSBmb3JtYXQgSlNPTlxyXG4gICAgICBkZXNlcmlhbGl6ZTogKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIHJldHVybiBKU09OLnBhcnNlKHZhbHVlKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIHBhcnNlICR7bmFtZX0gc3RvcmUgZGF0YSwgcmVzZXR0aW5nIHRvIGRlZmF1bHRzOmAsIGVycm9yKTtcclxuICAgICAgICAgIHJldHVybiB7fTsgLy8gUmV0dXJuIGVtcHR5IG9iamVjdCBpZiBwYXJzaW5nIGZhaWxzXHJcbiAgICAgICAgfVxyXG4gICAgICB9LFxyXG4gICAgICAuLi5vcHRpb25zXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIE9ubHkgaW5jbHVkZSBlbmNyeXB0aW9uS2V5IGlmIGl0J3MgYWN0dWFsbHkgZGVmaW5lZFxyXG4gICAgLy8gVGhpcyBhbGxvd3MgZWxlY3Ryb24tc3RvcmUgdG8gdXNlIGl0cyBkZWZhdWx0IG1hY2hpbmUtc3BlY2lmaWMgZW5jcnlwdGlvblxyXG4gICAgLy8gd2hpY2ggaXMgbW9yZSBzdGFibGUgYWNyb3NzIHJlc3RhcnRzIHRoYW4gYW4gdW5kZWZpbmVkL2VtcHR5IGtleVxyXG4gICAgaWYgKG9wdGlvbnMuZW5jcnlwdGlvbktleSA9PT0gdW5kZWZpbmVkIHx8IG9wdGlvbnMuZW5jcnlwdGlvbktleSA9PT0gbnVsbCB8fCBvcHRpb25zLmVuY3J5cHRpb25LZXkgPT09ICcnKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDimqDvuI8gTm8gZW5jcnlwdGlvbiBrZXkgcHJvdmlkZWQgZm9yIHN0b3JlIFwiJHtuYW1lfVwiLCB1c2luZyBtYWNoaW5lLXNwZWNpZmljIGVuY3J5cHRpb25gKTtcclxuICAgICAgLy8gUmVtb3ZlIHRoZSBlbmNyeXB0aW9uS2V5IHByb3BlcnR5IGVudGlyZWx5IGlmIGl0IGV4aXN0cyBidXQgaXMgZW1wdHkvdW5kZWZpbmVkXHJcbiAgICAgIGRlbGV0ZSBzdG9yZU9wdGlvbnMuZW5jcnlwdGlvbktleTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDinIUgVXNpbmcgcHJvdmlkZWQgZW5jcnlwdGlvbiBrZXkgZm9yIHN0b3JlIFwiJHtuYW1lfVwiYCk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ29uZmlndXJlIHN0b3JlIHdpdGggb3B0aW9ucyB0byBwcmV2ZW50IGNvcnJ1cHRpb25cclxuICAgIGNvbnN0IHN0b3JlID0gbmV3IFN0b3JlKHN0b3JlT3B0aW9ucyk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKGDinIUgU3RvcmUgXCIke25hbWV9XCIgaW5pdGlhbGl6ZWQgc3VjY2Vzc2Z1bGx5YCk7XHJcbiAgICBcclxuICAgIC8vIFNhdmUgdGhlIGluc3RhbmNlXHJcbiAgICBzdG9yZUluc3RhbmNlcy5zZXQobmFtZSwgc3RvcmUpO1xyXG4gICAgcmV0dXJuIHN0b3JlO1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKGDinYwgRmFpbGVkIHRvIGluaXRpYWxpemUgc3RvcmUgXCIke25hbWV9XCI6YCwgZXJyb3IpO1xyXG4gICAgXHJcbiAgICAvLyBDcmVhdGUgYSBmYWxsYmFjayBpbi1tZW1vcnkgc3RvcmVcclxuICAgIGNvbnN0IGZhbGxiYWNrU3RvcmUgPSB7XHJcbiAgICAgIGdldDogKGtleSkgPT4gbnVsbCxcclxuICAgICAgc2V0OiAoa2V5LCB2YWx1ZSkgPT4ge30sXHJcbiAgICAgIGhhczogKGtleSkgPT4gZmFsc2UsXHJcbiAgICAgIGRlbGV0ZTogKGtleSkgPT4ge30sXHJcbiAgICAgIGNsZWFyOiAoKSA9PiB7fSxcclxuICAgICAgc3RvcmU6IHt9LFxyXG4gICAgICBwYXRoOiBudWxsLFxyXG4gICAgICBzaXplOiAwLFxyXG4gICAgICAvLyBBZGQgb3RoZXIgbWV0aG9kcyB0aGF0IG1pZ2h0IGJlIHVzZWRcclxuICAgICAgb25EaWRDaGFuZ2U6ICgpID0+ICh7IHVuc3Vic2NyaWJlOiAoKSA9PiB7fSB9KSxcclxuICAgICAgb25EaWRBbnlDaGFuZ2U6ICgpID0+ICh7IHVuc3Vic2NyaWJlOiAoKSA9PiB7fSB9KSxcclxuICAgICAgb3BlbkluRWRpdG9yOiAoKSA9PiB7fVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coYOKaoO+4jyBVc2luZyBpbi1tZW1vcnkgZmFsbGJhY2sgc3RvcmUgZm9yIFwiJHtuYW1lfVwiYCk7XHJcbiAgICBcclxuICAgIC8vIFNhdmUgdGhlIGZhbGxiYWNrIGluc3RhbmNlXHJcbiAgICBzdG9yZUluc3RhbmNlcy5zZXQobmFtZSwgZmFsbGJhY2tTdG9yZSk7XHJcbiAgICByZXR1cm4gZmFsbGJhY2tTdG9yZTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBBdHRlbXB0cyB0byByZXBhaXIgYSBjb3JydXB0ZWQgc3RvcmUgZmlsZVxyXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUgb2YgdGhlIHN0b3JlIHRvIHJlcGFpclxyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgcmVwYWlyIHdhcyBzdWNjZXNzZnVsXHJcbiAqL1xyXG5mdW5jdGlvbiByZXBhaXJTdG9yZShuYW1lKSB7XHJcbiAgdHJ5IHtcclxuICAgIC8vIEdldCB0aGUgc3RvcmUgcGF0aFxyXG4gICAgY29uc3Qgc3RvcmVQYXRoID0gcGF0aC5qb2luKFxyXG4gICAgICBhcHAuZ2V0UGF0aCgndXNlckRhdGEnKSxcclxuICAgICAgYCR7bmFtZX0uanNvbmBcclxuICAgICk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKGDwn5SnIEF0dGVtcHRpbmcgdG8gcmVwYWlyIHN0b3JlOiAke3N0b3JlUGF0aH1gKTtcclxuICAgIFxyXG4gICAgLy8gQ2hlY2sgaWYgZmlsZSBleGlzdHNcclxuICAgIGlmICghZnMuZXhpc3RzU3luYyhzdG9yZVBhdGgpKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBTdG9yZSBmaWxlIG5vdCBmb3VuZDogJHtzdG9yZVBhdGh9YCk7XHJcbiAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gQ3JlYXRlIGEgYmFja3VwXHJcbiAgICBjb25zdCBiYWNrdXBQYXRoID0gYCR7c3RvcmVQYXRofS5iYWNrdXAtJHtEYXRlLm5vdygpfWA7XHJcbiAgICBmcy5jb3B5RmlsZVN5bmMoc3RvcmVQYXRoLCBiYWNrdXBQYXRoKTtcclxuICAgIGNvbnNvbGUubG9nKGDwn5OmIENyZWF0ZWQgYmFja3VwIGF0OiAke2JhY2t1cFBhdGh9YCk7XHJcbiAgICBcclxuICAgIC8vIFJlc2V0IHRoZSBmaWxlIHdpdGggZW1wdHkgSlNPTlxyXG4gICAgZnMud3JpdGVGaWxlU3luYyhzdG9yZVBhdGgsICd7fScpO1xyXG4gICAgY29uc29sZS5sb2coYPCflIQgUmVzZXQgc3RvcmUgZmlsZSB3aXRoIGVtcHR5IGNvbmZpZ3VyYXRpb246ICR7c3RvcmVQYXRofWApO1xyXG4gICAgXHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIHJlcGFpciBzdG9yZSBcIiR7bmFtZX1cIjpgLCBlcnJvcik7XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogQ2xlYW5zIHVwIGFsbCBzdG9yZSBpbnN0YW5jZXNcclxuICovXHJcbmZ1bmN0aW9uIGNsZWFudXBTdG9yZXMoKSB7XHJcbiAgc3RvcmVJbnN0YW5jZXMuY2xlYXIoKTtcclxuICBjb25zb2xlLmxvZygn8J+nuSBDbGVhbmVkIHVwIGFsbCBzdG9yZSBpbnN0YW5jZXMnKTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7XHJcbiAgY3JlYXRlU3RvcmUsXHJcbiAgcmVwYWlyU3RvcmUsXHJcbiAgY2xlYW51cFN0b3Jlc1xyXG59O1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxLQUFLLEdBQUdDLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQztBQUN2QyxNQUFNQyxJQUFJLEdBQUdELE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTUUsRUFBRSxHQUFHRixPQUFPLENBQUMsSUFBSSxDQUFDO0FBQ3hCLE1BQU07RUFBRUc7QUFBSSxDQUFDLEdBQUdILE9BQU8sQ0FBQyxVQUFVLENBQUM7O0FBRW5DO0FBQ0EsTUFBTUksY0FBYyxHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDOztBQUVoQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTQyxXQUFXQSxDQUFDQyxJQUFJLEVBQUVDLE9BQU8sR0FBRyxDQUFDLENBQUMsRUFBRTtFQUN2QztFQUNBLElBQUlKLGNBQWMsQ0FBQ0ssR0FBRyxDQUFDRixJQUFJLENBQUMsRUFBRTtJQUM1QixPQUFPSCxjQUFjLENBQUNNLEdBQUcsQ0FBQ0gsSUFBSSxDQUFDO0VBQ2pDO0VBRUEsSUFBSTtJQUNGO0lBQ0EsTUFBTUksWUFBWSxHQUFHO01BQ25CSixJQUFJO01BQ0pLLGtCQUFrQixFQUFFLElBQUk7TUFBRTtNQUMxQkMsU0FBUyxFQUFHQyxLQUFLLElBQUtDLElBQUksQ0FBQ0MsU0FBUyxDQUFDRixLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztNQUFFO01BQ3RERyxXQUFXLEVBQUdILEtBQUssSUFBSztRQUN0QixJQUFJO1VBQ0YsT0FBT0MsSUFBSSxDQUFDRyxLQUFLLENBQUNKLEtBQUssQ0FBQztRQUMxQixDQUFDLENBQUMsT0FBT0ssS0FBSyxFQUFFO1VBQ2RDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFD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