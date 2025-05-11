"use strict";

/**
 * Preload Script
 * Exposes specific Electron APIs to the renderer process
 * 
 * This script creates a secure bridge between the renderer process and the main process,
 * exposing only the necessary functionality while maintaining security through contextIsolation.
 * 
 * Includes initialization tracking and IPC call queueing to ensure reliable communication.
 */

const {
  contextBridge,
  ipcRenderer
} = require('electron');

// Add direct console output for debugging
console.log('====== PRELOAD SCRIPT STARTING ======');
try {
  // Use __filename if available (CommonJS), otherwise handle gracefully
  console.log('Preload script path:', typeof __filename !== 'undefined' ? __filename : 'Path not available');
} catch (error) {
  console.log('Unable to determine preload script path:', error.message);
}
console.log('====================================');

// Initialization tracking
let isAppReady = false;
const pendingCalls = new Map();
let readyCallback = null;
const CALL_TIMEOUT = 10000; // 10 second timeout for queued calls

/**
 * Queue an IPC call until app is ready
 * @param {string} channel - IPC channel name
 * @param {Array} args - Call arguments
 * @returns {Promise} Resolves when call completes
 */
function queueCall(channel, args) {
  return new Promise((resolve, reject) => {
    if (isAppReady) {
      // App is ready, make call immediately
      ipcRenderer.invoke(channel, ...args).then(resolve).catch(reject);
    } else {
      // Queue the call
      const id = Date.now().toString();
      pendingCalls.set(id, {
        channel,
        args,
        resolve,
        reject
      });

      // Set timeout for queued calls
      setTimeout(() => {
        if (pendingCalls.has(id)) {
          const {
            reject
          } = pendingCalls.get(id);
          pendingCalls.delete(id);
          reject(new Error(`IPC call to ${channel} timed out waiting for app ready`));
        }
      }, CALL_TIMEOUT);
    }
  });
}

/**
 * Process any queued calls once app is ready
 */
function processPendingCalls() {
  console.log(`📨 Processing ${pendingCalls.size} pending IPC calls`);
  for (const [id, {
    channel,
    args,
    resolve,
    reject
  }] of pendingCalls) {
    ipcRenderer.invoke(channel, ...args).then(resolve).catch(reject).finally(() => pendingCalls.delete(id));
  }
}

/**
 * Clean up event listeners on window unload
 */
function cleanupEventListeners() {
  // Remove all event listeners
  ipcRenderer.removeAllListeners('codex:convert:progress');
  ipcRenderer.removeAllListeners('codex:convert:status');
  ipcRenderer.removeAllListeners('codex:convert:complete');
  ipcRenderer.removeAllListeners('codex:convert:error');
  ipcRenderer.removeAllListeners('codex:offline:event');
  ipcRenderer.removeAllListeners('codex:file-dropped');
  ipcRenderer.removeAllListeners('codex:watch:event');
  ipcRenderer.removeAllListeners('app:ready');
  ipcRenderer.removeAllListeners('app:error');
}

// Handle app ready event
ipcRenderer.on('app:ready', () => {
  console.log('🚀 App ready event received');
  isAppReady = true;
  processPendingCalls();
  if (readyCallback) {
    readyCallback();
  }
});

// Handle app errors
ipcRenderer.on('app:error', (_, error) => {
  console.error('❌ App error:', error);
});

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electron', {
  // App Status
  isReady: () => isAppReady,
  onReady: callback => {
    if (isAppReady) {
      callback();
    } else {
      readyCallback = callback;
    }
  },
  //=== Conversion Operations ===//
  convert: async (input, options) => {
    // Handle ArrayBuffer conversion to Buffer for IPC
    if (options.buffer instanceof ArrayBuffer) {
      const buffer = Buffer.from(options.buffer);
      options.buffer = buffer;
    }
    return queueCall('codex:convert:file', [input, options]);
  },
  getResult: async path => {
    return queueCall('codex:convert:get-result', [path]);
  },
  cancelRequests: async () => {
    return queueCall('codex:convert:cancel', []);
  },
  // Helper method to log and redirect to generic convert method
  _redirectToConvert: async (input, options, type) => {
    console.log(`Redirecting ${type} conversion to generic convert method`);
    options.type = type;
    return queueCall('codex:convert:file', [input, options]);
  },
  // Specialized conversion methods that redirect to generic convert
  convertUrl: async (url, options) => {
    options = options || {};
    options.type = 'url';
    options.isWeb = true;
    console.log(`Converting URL: ${url} (redirecting to generic convert)`, options);
    return queueCall('codex:convert:file', [url, options]);
  },
  convertParentUrl: async (url, options) => {
    options = options || {};
    options.type = 'parenturl';
    options.isWeb = true;
    console.log(`Converting Parent URL: ${url} (redirecting to generic convert)`, options);
    return queueCall('codex:convert:file', [url, options]);
  },
  convertYoutube: async (url, options) => {
    options = options || {};
    options.type = 'youtube';
    options.isWeb = true;
    console.log(`Converting YouTube: ${url} (redirecting to generic convert)`, options);
    return queueCall('codex:convert:file', [url, options]);
  },
  convertFile: async (path, options) => {
    options = options || {};
    console.log(`Converting file: ${path} (redirecting to generic convert)`, options);
    return queueCall('codex:convert:file', [path, options]);
  },
  //=== Conversion Event Handlers ===//

  /**
   * Register callback for conversion progress
   * @param {Function} callback - Progress callback
   */
  onConversionProgress: callback => {
    ipcRenderer.on('codex:convert:progress', (_, progress) => callback(progress));
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('codex:convert:progress', callback);
    };
  },
  /**
   * Register callback for conversion status
   * @param {Function} callback - Status callback
   */
  onConversionStatus: callback => {
    ipcRenderer.on('codex:convert:status', (_, status) => callback(status));
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('codex:convert:status', callback);
    };
  },
  /**
   * Register callback for conversion completion
   * @param {Function} callback - Completion callback
   */
  onConversionComplete: callback => {
    ipcRenderer.on('codex:convert:complete', (_, result) => callback(result));
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('codex:convert:complete', callback);
    };
  },
  /**
   * Register callback for conversion errors
   * @param {Function} callback - Error callback
   */
  onConversionError: callback => {
    ipcRenderer.on('codex:convert:error', (_, error) => callback(error));
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('codex:convert:error', callback);
    };
  },
  /**
   * Remove conversion progress listener
   * @param {Function} listener - Progress listener to remove
   */
  offConversionProgress: listener => {
    ipcRenderer.removeListener('codex:convert:progress', listener);
  },
  /**
   * Remove conversion status listener
   * @param {Function} listener - Status listener to remove
   */
  offConversionStatus: listener => {
    ipcRenderer.removeListener('codex:convert:status', listener);
  },
  /**
   * Remove conversion complete listener
   * @param {Function} listener - Complete listener to remove
   */
  offConversionComplete: listener => {
    ipcRenderer.removeListener('codex:convert:complete', listener);
  },
  /**
   * Remove conversion error listener
   * @param {Function} listener - Error listener to remove
   */
  offConversionError: listener => {
    ipcRenderer.removeListener('codex:convert:error', listener);
  },
  //=== File System Operations ===//

  /**
   * Select files for conversion
   * @param {Object} options - Selection options
   */
  selectFiles: async options => {
    return await ipcRenderer.invoke('codex:fs:select-files', options);
  },
  /**
   * Select directory for output
   * @param {Object} options - Selection options
   */
  selectDirectory: async options => {
    return await ipcRenderer.invoke('codex:fs:select-directory', options);
  },
  /**
   * Select input directory
   * @param {Object} options - Selection options
   */
  selectInputDirectory: async options => {
    return await ipcRenderer.invoke('codex:fs:select-input-directory', options);
  },
  /**
   * Select output directory
   * @param {Object} options - Selection options
   */
  selectOutput: async options => {
    return await ipcRenderer.invoke('codex:fs:select-output', options);
  },
  /**
   * List directory contents
   * @param {string} path - Directory path
   * @param {Object} options - Listing options
   */
  listDirectoryDetailed: async (path, options) => {
    return await ipcRenderer.invoke('codex:fs:list-directory', {
      path,
      ...options
    });
  },
  /**
   * Show item in folder
   * @param {string} path - Item path
   */
  showItemInFolder: async path => {
    return await ipcRenderer.invoke('codex:show-item-in-folder', path);
  },
  /**
   * Get file or directory stats
   * @param {string} path - Path to check
   */
  getStats: async path => {
    return await ipcRenderer.invoke('codex:fs:stats', {
      path
    });
  },
  /**
   * Read file contents
   * @param {string} path - File path
   */
  readFile: async path => {
    return await ipcRenderer.invoke('codex:fs:read', {
      path
    });
  },
  /**
   * Write content to file
   * @param {string} path - File path
   * @param {string|Buffer} content - File content
   */
  writeFile: async (path, content) => {
    return await ipcRenderer.invoke('codex:fs:write', {
      path,
      content
    });
  },
  /**
   * Create directory
   * @param {string} path - Directory path
   */
  createDirectory: async path => {
    return await ipcRenderer.invoke('codex:fs:mkdir', {
      path
    });
  },
  /**
   * Move file or directory
   * @param {string} sourcePath - Source path
   * @param {string} destPath - Destination path
   */
  moveItem: async (sourcePath, destPath) => {
    return await ipcRenderer.invoke('codex:fs:move', {
      sourcePath,
      destPath
    });
  },
  /**
   * Delete file or directory
   * @param {string} path - Path to delete
   * @param {boolean} recursive - Whether to delete recursively
   */
  deleteItem: async (path, recursive) => {
    return await ipcRenderer.invoke('codex:fs:delete', {
      path,
      recursive
    });
  },
  /**
   * Open external URL or file
   * @param {string} url - URL or file path to open
   */
  openExternal: async url => {
    return await ipcRenderer.invoke('codex:open-external', url);
  },
  //=== Settings Management ===//
  getSetting: async key => {
    return queueCall('codex:get-setting', [key]);
  },
  setSetting: async (key, value) => {
    return queueCall('codex:set-setting', [key, value]);
  },
  // OCR specific settings
  setOcrEnabled: async ({
    enabled
  }) => {
    console.log(`[Preload] Setting OCR enabled to: ${enabled} (type: ${typeof enabled})`);
    // Ensure enabled is a boolean
    const boolEnabled = Boolean(enabled);
    console.log(`[Preload] Converted to boolean: ${boolEnabled} (type: ${typeof boolEnabled})`);
    const result = await queueCall('codex:settings:set-ocr-enabled', [{
      enabled: boolEnabled
    }]);
    console.log(`[Preload] Result from setting OCR enabled:`, result);
    return result;
  },
  getOcrEnabled: async () => {
    const result = await queueCall('codex:settings:get-ocr-enabled', []);
    console.log(`[Preload] Got OCR enabled: ${result} (type: ${typeof result})`);
    return result;
  },
  //=== API Key Management ===//
  saveApiKey: async (key, provider = 'openai') => {
    return queueCall('codex:apikey:save', [{
      key,
      provider
    }]);
  },
  checkApiKeyExists: async (provider = 'openai') => {
    return queueCall('codex:apikey:exists', [{
      provider
    }]);
  },
  deleteApiKey: async (provider = 'openai') => {
    return queueCall('codex:apikey:delete', [{
      provider
    }]);
  },
  validateApiKey: async (key, provider = 'openai') => {
    return queueCall('codex:apikey:validate', [{
      key,
      provider
    }]);
  },
  getApiKey: async (provider = 'openai') => {
    return queueCall('codex:apikey:get', [{
      provider
    }]);
  },
  //=== Offline Functionality ===//
  getOfflineStatus: async () => {
    return queueCall('codex:offline:status', []);
  },
  getQueuedOperations: async () => {
    return queueCall('codex:offline:queued-operations', []);
  },
  queueOperation: async operation => {
    return queueCall('codex:offline:queue-operation', [operation]);
  },
  cacheData: async (key, data) => {
    return queueCall('codex:offline:cache-data', [{
      key,
      data
    }]);
  },
  getCachedData: async (key, maxAge) => {
    return queueCall('codex:offline:get-cached-data', [{
      key,
      maxAge
    }]);
  },
  invalidateCache: async key => {
    return queueCall('codex:offline:invalidate-cache', [{
      key
    }]);
  },
  clearCache: async () => {
    return queueCall('codex:offline:clear-cache', []);
  },
  // Event handlers don't need queueing since they just register callbacks
  onOfflineEvent: callback => {
    ipcRenderer.on('codex:offline:event', (_, data) => callback(data));
    return () => {
      ipcRenderer.removeListener('codex:offline:event', callback);
    };
  },
  /**
   * Register callback for file drop events
   * @param {Function} callback - File drop callback
   */
  onFileDropped: callback => {
    ipcRenderer.on('codex:file-dropped', (_, files) => {
      console.log('File dropped event received:', files);
      callback(files);
    });
    return () => {
      ipcRenderer.removeListener('codex:file-dropped', callback);
    };
  },
  //=== Transcription ===//
  transcribeAudio: async filePath => {
    return queueCall('codex:transcribe:audio', [{
      filePath
    }]);
  },
  transcribeVideo: async filePath => {
    return queueCall('codex:transcribe:video', [{
      filePath
    }]);
  },
  getTranscriptionModel: async () => {
    return queueCall('codex:get-setting', ['transcription.model']);
  },
  setTranscriptionModel: async model => {
    return queueCall('codex:set-setting', ['transcription.model', model]);
  },
  // Enhanced Deepgram API key handlers - added to provide more reliable API key handling
  getDeepgramApiKey: async () => {
    console.log('[Preload] Getting Deepgram API key');
    try {
      // First try dedicated handler
      const result = await queueCall('codex:transcription:get-api-key', []);
      console.log('[Preload] Deepgram API key retrieval result:', result ? result.hasKey ? 'Found key' : 'No key found' : 'No result');
      return result;
    } catch (error) {
      console.error('[Preload] Error getting Deepgram API key:', error);
      // Fallback to generic setting
      try {
        const directKey = await queueCall('codex:get-setting', ['deepgramApiKey']);
        const nestedKey = await queueCall('codex:get-setting', ['transcription.deepgramApiKey']);
        const apiKey = directKey || nestedKey || '';
        return {
          success: true,
          apiKey,
          hasKey: !!apiKey,
          source: directKey ? 'direct' : nestedKey ? 'nested' : 'none'
        };
      } catch (fallbackError) {
        console.error('[Preload] Fallback error getting Deepgram API key:', fallbackError);
        throw error; // Throw original error
      }
    }
  },
  setDeepgramApiKey: async apiKey => {
    console.log('[Preload] Setting Deepgram API key');
    try {
      // First try dedicated handler
      const result = await queueCall('codex:transcription:set-api-key', [{
        apiKey
      }]);
      console.log('[Preload] Deepgram API key set result:', result);

      // Also set the key for the ApiKeyService for better compatibility
      try {
        await queueCall('codex:apikey:save', [{
          key: apiKey,
          provider: 'deepgram'
        }]);
        console.log('[Preload] Deepgram API key also saved via API key service');
      } catch (apiKeyError) {
        console.error('[Preload] Error saving to API key service:', apiKeyError);
        // Continue even if this fails
      }
      return result;
    } catch (error) {
      console.error('[Preload] Error setting Deepgram API key:', error);
      // Fallback to generic settings
      try {
        await queueCall('codex:set-setting', ['deepgramApiKey', apiKey]);
        await queueCall('codex:set-setting', ['transcription.deepgramApiKey', apiKey]);
        return {
          success: true
        };
      } catch (fallbackError) {
        console.error('[Preload] Fallback error setting Deepgram API key:', fallbackError);
        throw error; // Throw original error
      }
    }
  },
  //=== Application ===//
  getVersion: async () => {
    return queueCall('codex:get-version', []);
  },
  checkUpdates: async () => {
    return queueCall('codex:check-updates', []);
  }
});

// Clean up when window unloads
window.addEventListener('unload', cleanupEventListeners);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjb250ZXh0QnJpZGdlIiwiaXBjUmVuZGVyZXIiLCJyZXF1aXJlIiwiY29uc29sZSIsImxvZyIsIl9fZmlsZW5hbWUiLCJlcnJvciIsIm1lc3NhZ2UiLCJpc0FwcFJlYWR5IiwicGVuZGluZ0NhbGxzIiwiTWFwIiwicmVhZHlDYWxsYmFjayIsIkNBTExfVElNRU9VVCIsInF1ZXVlQ2FsbCIsImNoYW5uZWwiLCJhcmdzIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJpbnZva2UiLCJ0aGVuIiwiY2F0Y2giLCJpZCIsIkRhdGUiLCJub3ciLCJ0b1N0cmluZyIsInNldCIsInNldFRpbWVvdXQiLCJoYXMiLCJnZXQiLCJkZWxldGUiLCJFcnJvciIsInByb2Nlc3NQZW5kaW5nQ2FsbHMiLCJzaXplIiwiZmluYWxseSIsImNsZWFudXBFdmVudExpc3RlbmVycyIsInJlbW92ZUFsbExpc3RlbmVycyIsIm9uIiwiXyIsImV4cG9zZUluTWFpbldvcmxkIiwiaXNSZWFkeSIsIm9uUmVhZHkiLCJjYWxsYmFjayIsImNvbnZlcnQiLCJpbnB1dCIsIm9wdGlvbnMiLCJidWZmZXIiLCJBcnJheUJ1ZmZlciIsIkJ1ZmZlciIsImZyb20iLCJnZXRSZXN1bHQiLCJwYXRoIiwiY2FuY2VsUmVxdWVzdHMiLCJfcmVkaXJlY3RUb0NvbnZlcnQiLCJ0eXBlIiwiY29udmVydFVybCIsInVybCIsImlzV2ViIiwiY29udmVydFBhcmVudFVybCIsImNvbnZlcnRZb3V0dWJlIiwiY29udmVydEZpbGUiLCJvbkNvbnZlcnNpb25Qcm9ncmVzcyIsInByb2dyZXNzIiwicmVtb3ZlTGlzdGVuZXIiLCJvbkNvbnZlcnNpb25TdGF0dXMiLCJzdGF0dXMiLCJvbkNvbnZlcnNpb25Db21wbGV0ZSIsInJlc3VsdCIsIm9uQ29udmVyc2lvbkVycm9yIiwib2ZmQ29udmVyc2lvblByb2dyZXNzIiwibGlzdGVuZXIiLCJvZmZDb252ZXJzaW9uU3RhdHVzIiwib2ZmQ29udmVyc2lvbkNvbXBsZXRlIiwib2ZmQ29udmVyc2lvbkVycm9yIiwic2VsZWN0RmlsZXMiLCJzZWxlY3REaXJlY3RvcnkiLCJzZWxlY3RJbnB1dERpcmVjdG9yeSIsInNlbGVjdE91dHB1dCIsImxpc3REaXJlY3RvcnlEZXRhaWxlZCIsInNob3dJdGVtSW5Gb2xkZXIiLCJnZXRTdGF0cyIsInJlYWRGaWxlIiwid3JpdGVGaWxlIiwiY29udGVudCIsImNyZWF0ZURpcmVjdG9yeSIsIm1vdmVJdGVtIiwic291cmNlUGF0aCIsImRlc3RQYXRoIiwiZGVsZXRlSXRlbSIsInJlY3Vyc2l2ZSIsIm9wZW5FeHRlcm5hbCIsImdldFNldHRpbmciLCJrZXkiLCJzZXRTZXR0aW5nIiwidmFsdWUiLCJzZXRPY3JFbmFibGVkIiwiZW5hYmxlZCIsImJvb2xFbmFibGVkIiwiQm9vbGVhbiIsImdldE9jckVuYWJsZWQiLCJzYXZlQXBpS2V5IiwicHJvdmlkZXIiLCJjaGVja0FwaUtleUV4aXN0cyIsImRlbGV0ZUFwaUtleSIsInZhbGlkYXRlQXBpS2V5IiwiZ2V0QXBpS2V5IiwiZ2V0T2ZmbGluZVN0YXR1cyIsImdldFF1ZXVlZE9wZXJhdGlvbnMiLCJxdWV1ZU9wZXJhdGlvbiIsIm9wZXJhdGlvbiIsImNhY2hlRGF0YSIsImRhdGEiLCJnZXRDYWNoZWREYXRhIiwibWF4QWdlIiwiaW52YWxpZGF0ZUNhY2hlIiwiY2xlYXJDYWNoZSIsIm9uT2ZmbGluZUV2ZW50Iiwib25GaWxlRHJvcHBlZCIsImZpbGVzIiwidHJhbnNjcmliZUF1ZGlvIiwiZmlsZVBhdGgiLCJ0cmFuc2NyaWJlVmlkZW8iLCJnZXRUcmFuc2NyaXB0aW9uTW9kZWwiLCJzZXRUcmFuc2NyaXB0aW9uTW9kZWwiLCJtb2RlbCIsImdldERlZXBncmFtQXBpS2V5IiwiaGFzS2V5IiwiZGlyZWN0S2V5IiwibmVzdGVkS2V5IiwiYXBpS2V5Iiwic3VjY2VzcyIsInNvdXJjZSIsImZhbGxiYWNrRXJyb3IiLCJzZXREZWVwZ3JhbUFwaUtleSIsImFwaUtleUVycm9yIiwiZ2V0VmVyc2lvbiIsImNoZWNrVXBkYXRlcyIsIndpbmRvdyIsImFkZEV2ZW50TGlzdGVuZXIiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvZWxlY3Ryb24vcHJlbG9hZC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogUHJlbG9hZCBTY3JpcHRcclxuICogRXhwb3NlcyBzcGVjaWZpYyBFbGVjdHJvbiBBUElzIHRvIHRoZSByZW5kZXJlciBwcm9jZXNzXHJcbiAqIFxyXG4gKiBUaGlzIHNjcmlwdCBjcmVhdGVzIGEgc2VjdXJlIGJyaWRnZSBiZXR3ZWVuIHRoZSByZW5kZXJlciBwcm9jZXNzIGFuZCB0aGUgbWFpbiBwcm9jZXNzLFxyXG4gKiBleHBvc2luZyBvbmx5IHRoZSBuZWNlc3NhcnkgZnVuY3Rpb25hbGl0eSB3aGlsZSBtYWludGFpbmluZyBzZWN1cml0eSB0aHJvdWdoIGNvbnRleHRJc29sYXRpb24uXHJcbiAqIFxyXG4gKiBJbmNsdWRlcyBpbml0aWFsaXphdGlvbiB0cmFja2luZyBhbmQgSVBDIGNhbGwgcXVldWVpbmcgdG8gZW5zdXJlIHJlbGlhYmxlIGNvbW11bmljYXRpb24uXHJcbiAqL1xyXG5cclxuY29uc3QgeyBjb250ZXh0QnJpZGdlLCBpcGNSZW5kZXJlciB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuXHJcbi8vIEFkZCBkaXJlY3QgY29uc29sZSBvdXRwdXQgZm9yIGRlYnVnZ2luZ1xyXG5jb25zb2xlLmxvZygnPT09PT09IFBSRUxPQUQgU0NSSVBUIFNUQVJUSU5HID09PT09PScpO1xyXG50cnkge1xyXG4gICAgLy8gVXNlIF9fZmlsZW5hbWUgaWYgYXZhaWxhYmxlIChDb21tb25KUyksIG90aGVyd2lzZSBoYW5kbGUgZ3JhY2VmdWxseVxyXG4gICAgY29uc29sZS5sb2coJ1ByZWxvYWQgc2NyaXB0IHBhdGg6JywgdHlwZW9mIF9fZmlsZW5hbWUgIT09ICd1bmRlZmluZWQnID8gX19maWxlbmFtZSA6ICdQYXRoIG5vdCBhdmFpbGFibGUnKTtcclxufSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUubG9nKCdVbmFibGUgdG8gZGV0ZXJtaW5lIHByZWxvYWQgc2NyaXB0IHBhdGg6JywgZXJyb3IubWVzc2FnZSk7XHJcbn1cclxuY29uc29sZS5sb2coJz09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PScpO1xyXG5cclxuLy8gSW5pdGlhbGl6YXRpb24gdHJhY2tpbmdcclxubGV0IGlzQXBwUmVhZHkgPSBmYWxzZTtcclxuY29uc3QgcGVuZGluZ0NhbGxzID0gbmV3IE1hcCgpO1xyXG5sZXQgcmVhZHlDYWxsYmFjayA9IG51bGw7XHJcbmNvbnN0IENBTExfVElNRU9VVCA9IDEwMDAwOyAvLyAxMCBzZWNvbmQgdGltZW91dCBmb3IgcXVldWVkIGNhbGxzXHJcblxyXG4vKipcclxuICogUXVldWUgYW4gSVBDIGNhbGwgdW50aWwgYXBwIGlzIHJlYWR5XHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBjaGFubmVsIC0gSVBDIGNoYW5uZWwgbmFtZVxyXG4gKiBAcGFyYW0ge0FycmF5fSBhcmdzIC0gQ2FsbCBhcmd1bWVudHNcclxuICogQHJldHVybnMge1Byb21pc2V9IFJlc29sdmVzIHdoZW4gY2FsbCBjb21wbGV0ZXNcclxuICovXHJcbmZ1bmN0aW9uIHF1ZXVlQ2FsbChjaGFubmVsLCBhcmdzKSB7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgIGlmIChpc0FwcFJlYWR5KSB7XHJcbiAgICAgICAgICAgIC8vIEFwcCBpcyByZWFkeSwgbWFrZSBjYWxsIGltbWVkaWF0ZWx5XHJcbiAgICAgICAgICAgIGlwY1JlbmRlcmVyLmludm9rZShjaGFubmVsLCAuLi5hcmdzKVxyXG4gICAgICAgICAgICAgICAgLnRoZW4ocmVzb2x2ZSlcclxuICAgICAgICAgICAgICAgIC5jYXRjaChyZWplY3QpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIC8vIFF1ZXVlIHRoZSBjYWxsXHJcbiAgICAgICAgICAgIGNvbnN0IGlkID0gRGF0ZS5ub3coKS50b1N0cmluZygpO1xyXG4gICAgICAgICAgICBwZW5kaW5nQ2FsbHMuc2V0KGlkLCB7IGNoYW5uZWwsIGFyZ3MsIHJlc29sdmUsIHJlamVjdCB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFNldCB0aW1lb3V0IGZvciBxdWV1ZWQgY2FsbHNcclxuICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAocGVuZGluZ0NhbGxzLmhhcyhpZCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB7IHJlamVjdCB9ID0gcGVuZGluZ0NhbGxzLmdldChpZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcGVuZGluZ0NhbGxzLmRlbGV0ZShpZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgSVBDIGNhbGwgdG8gJHtjaGFubmVsfSB0aW1lZCBvdXQgd2FpdGluZyBmb3IgYXBwIHJlYWR5YCkpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LCBDQUxMX1RJTUVPVVQpO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG59XHJcblxyXG4vKipcclxuICogUHJvY2VzcyBhbnkgcXVldWVkIGNhbGxzIG9uY2UgYXBwIGlzIHJlYWR5XHJcbiAqL1xyXG5mdW5jdGlvbiBwcm9jZXNzUGVuZGluZ0NhbGxzKCkge1xyXG4gICAgY29uc29sZS5sb2coYPCfk6ggUHJvY2Vzc2luZyAke3BlbmRpbmdDYWxscy5zaXplfSBwZW5kaW5nIElQQyBjYWxsc2ApO1xyXG4gICAgZm9yIChjb25zdCBbaWQsIHsgY2hhbm5lbCwgYXJncywgcmVzb2x2ZSwgcmVqZWN0IH1dIG9mIHBlbmRpbmdDYWxscykge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLmludm9rZShjaGFubmVsLCAuLi5hcmdzKVxyXG4gICAgICAgICAgICAudGhlbihyZXNvbHZlKVxyXG4gICAgICAgICAgICAuY2F0Y2gocmVqZWN0KVxyXG4gICAgICAgICAgICAuZmluYWxseSgoKSA9PiBwZW5kaW5nQ2FsbHMuZGVsZXRlKGlkKSk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDbGVhbiB1cCBldmVudCBsaXN0ZW5lcnMgb24gd2luZG93IHVubG9hZFxyXG4gKi9cclxuZnVuY3Rpb24gY2xlYW51cEV2ZW50TGlzdGVuZXJzKCkge1xyXG4gICAgLy8gUmVtb3ZlIGFsbCBldmVudCBsaXN0ZW5lcnNcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygnY29kZXg6Y29udmVydDpwcm9ncmVzcycpO1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdjb2RleDpjb252ZXJ0OnN0YXR1cycpO1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdjb2RleDpjb252ZXJ0OmNvbXBsZXRlJyk7XHJcbiAgICBpcGNSZW5kZXJlci5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2NvZGV4OmNvbnZlcnQ6ZXJyb3InKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygnY29kZXg6b2ZmbGluZTpldmVudCcpO1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdjb2RleDpmaWxlLWRyb3BwZWQnKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygnY29kZXg6d2F0Y2g6ZXZlbnQnKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygnYXBwOnJlYWR5Jyk7XHJcbiAgICBpcGNSZW5kZXJlci5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2FwcDplcnJvcicpO1xyXG59XHJcblxyXG4vLyBIYW5kbGUgYXBwIHJlYWR5IGV2ZW50XHJcbmlwY1JlbmRlcmVyLm9uKCdhcHA6cmVhZHknLCAoKSA9PiB7XHJcbiAgICBjb25zb2xlLmxvZygn8J+agCBBcHAgcmVhZHkgZXZlbnQgcmVjZWl2ZWQnKTtcclxuICAgIGlzQXBwUmVhZHkgPSB0cnVlO1xyXG4gICAgcHJvY2Vzc1BlbmRpbmdDYWxscygpO1xyXG4gICAgaWYgKHJlYWR5Q2FsbGJhY2spIHtcclxuICAgICAgICByZWFkeUNhbGxiYWNrKCk7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuLy8gSGFuZGxlIGFwcCBlcnJvcnNcclxuaXBjUmVuZGVyZXIub24oJ2FwcDplcnJvcicsIChfLCBlcnJvcikgPT4ge1xyXG4gICAgY29uc29sZS5lcnJvcign4p2MIEFwcCBlcnJvcjonLCBlcnJvcik7XHJcbn0pO1xyXG5cclxuLy8gRXhwb3NlIHByb3RlY3RlZCBtZXRob2RzIHRvIHJlbmRlcmVyIHByb2Nlc3NcclxuY29udGV4dEJyaWRnZS5leHBvc2VJbk1haW5Xb3JsZCgnZWxlY3Ryb24nLCB7XHJcbiAgICAvLyBBcHAgU3RhdHVzXHJcbiAgICBpc1JlYWR5OiAoKSA9PiBpc0FwcFJlYWR5LFxyXG4gICAgXHJcbiAgICBvblJlYWR5OiAoY2FsbGJhY2spID0+IHtcclxuICAgICAgICBpZiAoaXNBcHBSZWFkeSkge1xyXG4gICAgICAgICAgICBjYWxsYmFjaygpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHJlYWR5Q2FsbGJhY2sgPSBjYWxsYmFjaztcclxuICAgICAgICB9XHJcbiAgICB9LFxyXG5cclxuICAgIC8vPT09IENvbnZlcnNpb24gT3BlcmF0aW9ucyA9PT0vL1xyXG4gICAgY29udmVydDogYXN5bmMgKGlucHV0LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgLy8gSGFuZGxlIEFycmF5QnVmZmVyIGNvbnZlcnNpb24gdG8gQnVmZmVyIGZvciBJUENcclxuICAgICAgICBpZiAob3B0aW9ucy5idWZmZXIgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xyXG4gICAgICAgICAgICBjb25zdCBidWZmZXIgPSBCdWZmZXIuZnJvbShvcHRpb25zLmJ1ZmZlcik7XHJcbiAgICAgICAgICAgIG9wdGlvbnMuYnVmZmVyID0gYnVmZmVyO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpjb252ZXJ0OmZpbGUnLCBbaW5wdXQsIG9wdGlvbnNdKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGdldFJlc3VsdDogYXN5bmMgKHBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpjb252ZXJ0OmdldC1yZXN1bHQnLCBbcGF0aF0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgY2FuY2VsUmVxdWVzdHM6IGFzeW5jICgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpjb252ZXJ0OmNhbmNlbCcsIFtdKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vIEhlbHBlciBtZXRob2QgdG8gbG9nIGFuZCByZWRpcmVjdCB0byBnZW5lcmljIGNvbnZlcnQgbWV0aG9kXHJcbiAgICBfcmVkaXJlY3RUb0NvbnZlcnQ6IGFzeW5jIChpbnB1dCwgb3B0aW9ucywgdHlwZSkgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBSZWRpcmVjdGluZyAke3R5cGV9IGNvbnZlcnNpb24gdG8gZ2VuZXJpYyBjb252ZXJ0IG1ldGhvZGApO1xyXG4gICAgICAgIG9wdGlvbnMudHlwZSA9IHR5cGU7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpmaWxlJywgW2lucHV0LCBvcHRpb25zXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvLyBTcGVjaWFsaXplZCBjb252ZXJzaW9uIG1ldGhvZHMgdGhhdCByZWRpcmVjdCB0byBnZW5lcmljIGNvbnZlcnRcclxuICAgIGNvbnZlcnRVcmw6IGFzeW5jICh1cmwsIG9wdGlvbnMpID0+IHtcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICBvcHRpb25zLnR5cGUgPSAndXJsJztcclxuICAgICAgICBvcHRpb25zLmlzV2ViID0gdHJ1ZTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgQ29udmVydGluZyBVUkw6ICR7dXJsfSAocmVkaXJlY3RpbmcgdG8gZ2VuZXJpYyBjb252ZXJ0KWAsIG9wdGlvbnMpO1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmNvbnZlcnQ6ZmlsZScsIFt1cmwsIG9wdGlvbnNdKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGNvbnZlcnRQYXJlbnRVcmw6IGFzeW5jICh1cmwsIG9wdGlvbnMpID0+IHtcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICBvcHRpb25zLnR5cGUgPSAncGFyZW50dXJsJztcclxuICAgICAgICBvcHRpb25zLmlzV2ViID0gdHJ1ZTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgQ29udmVydGluZyBQYXJlbnQgVVJMOiAke3VybH0gKHJlZGlyZWN0aW5nIHRvIGdlbmVyaWMgY29udmVydClgLCBvcHRpb25zKTtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpjb252ZXJ0OmZpbGUnLCBbdXJsLCBvcHRpb25zXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBjb252ZXJ0WW91dHViZTogYXN5bmMgKHVybCwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgICAgIG9wdGlvbnMudHlwZSA9ICd5b3V0dWJlJztcclxuICAgICAgICBvcHRpb25zLmlzV2ViID0gdHJ1ZTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgQ29udmVydGluZyBZb3VUdWJlOiAke3VybH0gKHJlZGlyZWN0aW5nIHRvIGdlbmVyaWMgY29udmVydClgLCBvcHRpb25zKTtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpjb252ZXJ0OmZpbGUnLCBbdXJsLCBvcHRpb25zXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBjb252ZXJ0RmlsZTogYXN5bmMgKHBhdGgsIG9wdGlvbnMpID0+IHtcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgQ29udmVydGluZyBmaWxlOiAke3BhdGh9IChyZWRpcmVjdGluZyB0byBnZW5lcmljIGNvbnZlcnQpYCwgb3B0aW9ucyk7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpmaWxlJywgW3BhdGgsIG9wdGlvbnNdKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IENvbnZlcnNpb24gRXZlbnQgSGFuZGxlcnMgPT09Ly9cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWdpc3RlciBjYWxsYmFjayBmb3IgY29udmVyc2lvbiBwcm9ncmVzc1xyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgLSBQcm9ncmVzcyBjYWxsYmFja1xyXG4gICAgICovXHJcbiAgICBvbkNvbnZlcnNpb25Qcm9ncmVzczogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIub24oJ2NvZGV4OmNvbnZlcnQ6cHJvZ3Jlc3MnLCAoXywgcHJvZ3Jlc3MpID0+IGNhbGxiYWNrKHByb2dyZXNzKSk7XHJcbiAgICAgICAgLy8gUmV0dXJuIGNsZWFudXAgZnVuY3Rpb25cclxuICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcignY29kZXg6Y29udmVydDpwcm9ncmVzcycsIGNhbGxiYWNrKTtcclxuICAgICAgICB9O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWdpc3RlciBjYWxsYmFjayBmb3IgY29udmVyc2lvbiBzdGF0dXNcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIC0gU3RhdHVzIGNhbGxiYWNrXHJcbiAgICAgKi9cclxuICAgIG9uQ29udmVyc2lvblN0YXR1czogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIub24oJ2NvZGV4OmNvbnZlcnQ6c3RhdHVzJywgKF8sIHN0YXR1cykgPT4gY2FsbGJhY2soc3RhdHVzKSk7XHJcbiAgICAgICAgLy8gUmV0dXJuIGNsZWFudXAgZnVuY3Rpb25cclxuICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcignY29kZXg6Y29udmVydDpzdGF0dXMnLCBjYWxsYmFjayk7XHJcbiAgICAgICAgfTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUmVnaXN0ZXIgY2FsbGJhY2sgZm9yIGNvbnZlcnNpb24gY29tcGxldGlvblxyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgLSBDb21wbGV0aW9uIGNhbGxiYWNrXHJcbiAgICAgKi9cclxuICAgIG9uQ29udmVyc2lvbkNvbXBsZXRlOiAoY2FsbGJhY2spID0+IHtcclxuICAgICAgICBpcGNSZW5kZXJlci5vbignY29kZXg6Y29udmVydDpjb21wbGV0ZScsIChfLCByZXN1bHQpID0+IGNhbGxiYWNrKHJlc3VsdCkpO1xyXG4gICAgICAgIC8vIFJldHVybiBjbGVhbnVwIGZ1bmN0aW9uXHJcbiAgICAgICAgcmV0dXJuICgpID0+IHtcclxuICAgICAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4OmNvbnZlcnQ6Y29tcGxldGUnLCBjYWxsYmFjayk7XHJcbiAgICAgICAgfTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUmVnaXN0ZXIgY2FsbGJhY2sgZm9yIGNvbnZlcnNpb24gZXJyb3JzXHJcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayAtIEVycm9yIGNhbGxiYWNrXHJcbiAgICAgKi9cclxuICAgIG9uQ29udmVyc2lvbkVycm9yOiAoY2FsbGJhY2spID0+IHtcclxuICAgICAgICBpcGNSZW5kZXJlci5vbignY29kZXg6Y29udmVydDplcnJvcicsIChfLCBlcnJvcikgPT4gY2FsbGJhY2soZXJyb3IpKTtcclxuICAgICAgICAvLyBSZXR1cm4gY2xlYW51cCBmdW5jdGlvblxyXG4gICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpjb252ZXJ0OmVycm9yJywgY2FsbGJhY2spO1xyXG4gICAgICAgIH07XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlbW92ZSBjb252ZXJzaW9uIHByb2dyZXNzIGxpc3RlbmVyXHJcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBsaXN0ZW5lciAtIFByb2dyZXNzIGxpc3RlbmVyIHRvIHJlbW92ZVxyXG4gICAgICovXHJcbiAgICBvZmZDb252ZXJzaW9uUHJvZ3Jlc3M6IChsaXN0ZW5lcikgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpjb252ZXJ0OnByb2dyZXNzJywgbGlzdGVuZXIpO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZW1vdmUgY29udmVyc2lvbiBzdGF0dXMgbGlzdGVuZXJcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyIC0gU3RhdHVzIGxpc3RlbmVyIHRvIHJlbW92ZVxyXG4gICAgICovXHJcbiAgICBvZmZDb252ZXJzaW9uU3RhdHVzOiAobGlzdGVuZXIpID0+IHtcclxuICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcignY29kZXg6Y29udmVydDpzdGF0dXMnLCBsaXN0ZW5lcik7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlbW92ZSBjb252ZXJzaW9uIGNvbXBsZXRlIGxpc3RlbmVyXHJcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBsaXN0ZW5lciAtIENvbXBsZXRlIGxpc3RlbmVyIHRvIHJlbW92ZVxyXG4gICAgICovXHJcbiAgICBvZmZDb252ZXJzaW9uQ29tcGxldGU6IChsaXN0ZW5lcikgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpjb252ZXJ0OmNvbXBsZXRlJywgbGlzdGVuZXIpO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZW1vdmUgY29udmVyc2lvbiBlcnJvciBsaXN0ZW5lclxyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gbGlzdGVuZXIgLSBFcnJvciBsaXN0ZW5lciB0byByZW1vdmVcclxuICAgICAqL1xyXG4gICAgb2ZmQ29udmVyc2lvbkVycm9yOiAobGlzdGVuZXIpID0+IHtcclxuICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcignY29kZXg6Y29udmVydDplcnJvcicsIGxpc3RlbmVyKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IEZpbGUgU3lzdGVtIE9wZXJhdGlvbnMgPT09Ly9cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBTZWxlY3QgZmlsZXMgZm9yIGNvbnZlcnNpb25cclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gU2VsZWN0aW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgc2VsZWN0RmlsZXM6IGFzeW5jIChvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6ZnM6c2VsZWN0LWZpbGVzJywgb3B0aW9ucyk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFNlbGVjdCBkaXJlY3RvcnkgZm9yIG91dHB1dFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBTZWxlY3Rpb24gb3B0aW9uc1xyXG4gICAgICovXHJcbiAgICBzZWxlY3REaXJlY3Rvcnk6IGFzeW5jIChvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6ZnM6c2VsZWN0LWRpcmVjdG9yeScsIG9wdGlvbnMpO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBTZWxlY3QgaW5wdXQgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIFNlbGVjdGlvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIHNlbGVjdElucHV0RGlyZWN0b3J5OiBhc3luYyAob3B0aW9ucykgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnNlbGVjdC1pbnB1dC1kaXJlY3RvcnknLCBvcHRpb25zKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogU2VsZWN0IG91dHB1dCBkaXJlY3RvcnlcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gU2VsZWN0aW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgc2VsZWN0T3V0cHV0OiBhc3luYyAob3B0aW9ucykgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnNlbGVjdC1vdXRwdXQnLCBvcHRpb25zKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogTGlzdCBkaXJlY3RvcnkgY29udGVudHNcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRGlyZWN0b3J5IHBhdGhcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gTGlzdGluZyBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIGxpc3REaXJlY3RvcnlEZXRhaWxlZDogYXN5bmMgKHBhdGgsIG9wdGlvbnMpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczpsaXN0LWRpcmVjdG9yeScsIHsgcGF0aCwgLi4ub3B0aW9ucyB9KTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogU2hvdyBpdGVtIGluIGZvbGRlclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBJdGVtIHBhdGhcclxuICAgICAqL1xyXG4gICAgc2hvd0l0ZW1JbkZvbGRlcjogYXN5bmMgKHBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpzaG93LWl0ZW0taW4tZm9sZGVyJywgcGF0aCk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIEdldCBmaWxlIG9yIGRpcmVjdG9yeSBzdGF0c1xyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBQYXRoIHRvIGNoZWNrXHJcbiAgICAgKi9cclxuICAgIGdldFN0YXRzOiBhc3luYyAocGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnN0YXRzJywgeyBwYXRoIH0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWFkIGZpbGUgY29udGVudHNcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRmlsZSBwYXRoXHJcbiAgICAgKi9cclxuICAgIHJlYWRGaWxlOiBhc3luYyAocGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnJlYWQnLCB7IHBhdGggfSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFdyaXRlIGNvbnRlbnQgdG8gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBGaWxlIHBhdGhcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfEJ1ZmZlcn0gY29udGVudCAtIEZpbGUgY29udGVudFxyXG4gICAgICovXHJcbiAgICB3cml0ZUZpbGU6IGFzeW5jIChwYXRoLCBjb250ZW50KSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6ZnM6d3JpdGUnLCB7IHBhdGgsIGNvbnRlbnQgfSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIENyZWF0ZSBkaXJlY3RvcnlcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRGlyZWN0b3J5IHBhdGhcclxuICAgICAqL1xyXG4gICAgY3JlYXRlRGlyZWN0b3J5OiBhc3luYyAocGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOm1rZGlyJywgeyBwYXRoIH0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBNb3ZlIGZpbGUgb3IgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc291cmNlUGF0aCAtIFNvdXJjZSBwYXRoXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZGVzdFBhdGggLSBEZXN0aW5hdGlvbiBwYXRoXHJcbiAgICAgKi9cclxuICAgIG1vdmVJdGVtOiBhc3luYyAoc291cmNlUGF0aCwgZGVzdFBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczptb3ZlJywgeyBzb3VyY2VQYXRoLCBkZXN0UGF0aCB9KTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogRGVsZXRlIGZpbGUgb3IgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIFBhdGggdG8gZGVsZXRlXHJcbiAgICAgKiBAcGFyYW0ge2Jvb2xlYW59IHJlY3Vyc2l2ZSAtIFdoZXRoZXIgdG8gZGVsZXRlIHJlY3Vyc2l2ZWx5XHJcbiAgICAgKi9cclxuICAgIGRlbGV0ZUl0ZW06IGFzeW5jIChwYXRoLCByZWN1cnNpdmUpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczpkZWxldGUnLCB7IHBhdGgsIHJlY3Vyc2l2ZSB9KTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogT3BlbiBleHRlcm5hbCBVUkwgb3IgZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIFVSTCBvciBmaWxlIHBhdGggdG8gb3BlblxyXG4gICAgICovXHJcbiAgICBvcGVuRXh0ZXJuYWw6IGFzeW5jICh1cmwpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpvcGVuLWV4dGVybmFsJywgdXJsKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IFNldHRpbmdzIE1hbmFnZW1lbnQgPT09Ly9cclxuICAgIGdldFNldHRpbmc6IGFzeW5jIChrZXkpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpnZXQtc2V0dGluZycsIFtrZXldKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIHNldFNldHRpbmc6IGFzeW5jIChrZXksIHZhbHVlKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6c2V0LXNldHRpbmcnLCBba2V5LCB2YWx1ZV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy8gT0NSIHNwZWNpZmljIHNldHRpbmdzXHJcbiAgICBzZXRPY3JFbmFibGVkOiBhc3luYyAoeyBlbmFibGVkIH0pID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW1ByZWxvYWRdIFNldHRpbmcgT0NSIGVuYWJsZWQgdG86ICR7ZW5hYmxlZH0gKHR5cGU6ICR7dHlwZW9mIGVuYWJsZWR9KWApO1xyXG4gICAgICAgIC8vIEVuc3VyZSBlbmFibGVkIGlzIGEgYm9vbGVhblxyXG4gICAgICAgIGNvbnN0IGJvb2xFbmFibGVkID0gQm9vbGVhbihlbmFibGVkKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW1ByZWxvYWRdIENvbnZlcnRlZCB0byBib29sZWFuOiAke2Jvb2xFbmFibGVkfSAodHlwZTogJHt0eXBlb2YgYm9vbEVuYWJsZWR9KWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHF1ZXVlQ2FsbCgnY29kZXg6c2V0dGluZ3M6c2V0LW9jci1lbmFibGVkJywgW3sgZW5hYmxlZDogYm9vbEVuYWJsZWQgfV0pO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbUHJlbG9hZF0gUmVzdWx0IGZyb20gc2V0dGluZyBPQ1IgZW5hYmxlZDpgLCByZXN1bHQpO1xyXG4gICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBnZXRPY3JFbmFibGVkOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcXVldWVDYWxsKCdjb2RleDpzZXR0aW5nczpnZXQtb2NyLWVuYWJsZWQnLCBbXSk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtQcmVsb2FkXSBHb3QgT0NSIGVuYWJsZWQ6ICR7cmVzdWx0fSAodHlwZTogJHt0eXBlb2YgcmVzdWx0fSlgKTtcclxuICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy89PT0gQVBJIEtleSBNYW5hZ2VtZW50ID09PS8vXHJcbiAgICBzYXZlQXBpS2V5OiBhc3luYyAoa2V5LCBwcm92aWRlciA9ICdvcGVuYWknKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6YXBpa2V5OnNhdmUnLCBbeyBrZXksIHByb3ZpZGVyIH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGNoZWNrQXBpS2V5RXhpc3RzOiBhc3luYyAocHJvdmlkZXIgPSAnb3BlbmFpJykgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmFwaWtleTpleGlzdHMnLCBbeyBwcm92aWRlciB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBkZWxldGVBcGlLZXk6IGFzeW5jIChwcm92aWRlciA9ICdvcGVuYWknKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6YXBpa2V5OmRlbGV0ZScsIFt7IHByb3ZpZGVyIH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIHZhbGlkYXRlQXBpS2V5OiBhc3luYyAoa2V5LCBwcm92aWRlciA9ICdvcGVuYWknKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6YXBpa2V5OnZhbGlkYXRlJywgW3sga2V5LCBwcm92aWRlciB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBnZXRBcGlLZXk6IGFzeW5jIChwcm92aWRlciA9ICdvcGVuYWknKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6YXBpa2V5OmdldCcsIFt7IHByb3ZpZGVyIH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IE9mZmxpbmUgRnVuY3Rpb25hbGl0eSA9PT0vL1xyXG4gICAgZ2V0T2ZmbGluZVN0YXR1czogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4Om9mZmxpbmU6c3RhdHVzJywgW10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgZ2V0UXVldWVkT3BlcmF0aW9uczogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4Om9mZmxpbmU6cXVldWVkLW9wZXJhdGlvbnMnLCBbXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBxdWV1ZU9wZXJhdGlvbjogYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4Om9mZmxpbmU6cXVldWUtb3BlcmF0aW9uJywgW29wZXJhdGlvbl0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgY2FjaGVEYXRhOiBhc3luYyAoa2V5LCBkYXRhKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6b2ZmbGluZTpjYWNoZS1kYXRhJywgW3sga2V5LCBkYXRhIH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGdldENhY2hlZERhdGE6IGFzeW5jIChrZXksIG1heEFnZSkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4Om9mZmxpbmU6Z2V0LWNhY2hlZC1kYXRhJywgW3sga2V5LCBtYXhBZ2UgfV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgaW52YWxpZGF0ZUNhY2hlOiBhc3luYyAoa2V5KSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6b2ZmbGluZTppbnZhbGlkYXRlLWNhY2hlJywgW3sga2V5IH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGNsZWFyQ2FjaGU6IGFzeW5jICgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpvZmZsaW5lOmNsZWFyLWNhY2hlJywgW10pO1xyXG4gICAgfSxcclxuICAgIC8vIEV2ZW50IGhhbmRsZXJzIGRvbid0IG5lZWQgcXVldWVpbmcgc2luY2UgdGhleSBqdXN0IHJlZ2lzdGVyIGNhbGxiYWNrc1xyXG4gICAgb25PZmZsaW5lRXZlbnQ6IChjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLm9uKCdjb2RleDpvZmZsaW5lOmV2ZW50JywgKF8sIGRhdGEpID0+IGNhbGxiYWNrKGRhdGEpKTtcclxuICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcignY29kZXg6b2ZmbGluZTpldmVudCcsIGNhbGxiYWNrKTtcclxuICAgICAgICB9O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWdpc3RlciBjYWxsYmFjayBmb3IgZmlsZSBkcm9wIGV2ZW50c1xyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgLSBGaWxlIGRyb3AgY2FsbGJhY2tcclxuICAgICAqL1xyXG4gICAgb25GaWxlRHJvcHBlZDogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIub24oJ2NvZGV4OmZpbGUtZHJvcHBlZCcsIChfLCBmaWxlcykgPT4ge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRmlsZSBkcm9wcGVkIGV2ZW50IHJlY2VpdmVkOicsIGZpbGVzKTtcclxuICAgICAgICAgICAgY2FsbGJhY2soZmlsZXMpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpmaWxlLWRyb3BwZWQnLCBjYWxsYmFjayk7XHJcbiAgICAgICAgfTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IFRyYW5zY3JpcHRpb24gPT09Ly9cclxuICAgIHRyYW5zY3JpYmVBdWRpbzogYXN5bmMgKGZpbGVQYXRoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6dHJhbnNjcmliZTphdWRpbycsIFt7IGZpbGVQYXRoIH1dKTtcclxuICAgIH0sXHJcblxyXG4gICAgdHJhbnNjcmliZVZpZGVvOiBhc3luYyAoZmlsZVBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDp0cmFuc2NyaWJlOnZpZGVvJywgW3sgZmlsZVBhdGggfV0pO1xyXG4gICAgfSxcclxuXHJcbiAgICBnZXRUcmFuc2NyaXB0aW9uTW9kZWw6IGFzeW5jICgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpnZXQtc2V0dGluZycsIFsndHJhbnNjcmlwdGlvbi5tb2RlbCddKTtcclxuICAgIH0sXHJcblxyXG4gICAgc2V0VHJhbnNjcmlwdGlvbk1vZGVsOiBhc3luYyAobW9kZWwpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpzZXQtc2V0dGluZycsIFsndHJhbnNjcmlwdGlvbi5tb2RlbCcsIG1vZGVsXSk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8vIEVuaGFuY2VkIERlZXBncmFtIEFQSSBrZXkgaGFuZGxlcnMgLSBhZGRlZCB0byBwcm92aWRlIG1vcmUgcmVsaWFibGUgQVBJIGtleSBoYW5kbGluZ1xyXG4gICAgZ2V0RGVlcGdyYW1BcGlLZXk6IGFzeW5jICgpID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZygnW1ByZWxvYWRdIEdldHRpbmcgRGVlcGdyYW0gQVBJIGtleScpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIEZpcnN0IHRyeSBkZWRpY2F0ZWQgaGFuZGxlclxyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBxdWV1ZUNhbGwoJ2NvZGV4OnRyYW5zY3JpcHRpb246Z2V0LWFwaS1rZXknLCBbXSk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbUHJlbG9hZF0gRGVlcGdyYW0gQVBJIGtleSByZXRyaWV2YWwgcmVzdWx0OicsXHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPyAocmVzdWx0Lmhhc0tleSA/ICdGb3VuZCBrZXknIDogJ05vIGtleSBmb3VuZCcpIDogJ05vIHJlc3VsdCcpO1xyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcmVsb2FkXSBFcnJvciBnZXR0aW5nIERlZXBncmFtIEFQSSBrZXk6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICAvLyBGYWxsYmFjayB0byBnZW5lcmljIHNldHRpbmdcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdEtleSA9IGF3YWl0IHF1ZXVlQ2FsbCgnY29kZXg6Z2V0LXNldHRpbmcnLCBbJ2RlZXBncmFtQXBpS2V5J10pO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbmVzdGVkS2V5ID0gYXdhaXQgcXVldWVDYWxsKCdjb2RleDpnZXQtc2V0dGluZycsIFsndHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleSddKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGFwaUtleSA9IGRpcmVjdEtleSB8fCBuZXN0ZWRLZXkgfHwgJyc7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgYXBpS2V5LFxyXG4gICAgICAgICAgICAgICAgICAgIGhhc0tleTogISFhcGlLZXksXHJcbiAgICAgICAgICAgICAgICAgICAgc291cmNlOiBkaXJlY3RLZXkgPyAnZGlyZWN0JyA6IChuZXN0ZWRLZXkgPyAnbmVzdGVkJyA6ICdub25lJylcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGZhbGxiYWNrRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcmVsb2FkXSBGYWxsYmFjayBlcnJvciBnZXR0aW5nIERlZXBncmFtIEFQSSBrZXk6JywgZmFsbGJhY2tFcnJvcik7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjsgLy8gVGhyb3cgb3JpZ2luYWwgZXJyb3JcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgc2V0RGVlcGdyYW1BcGlLZXk6IGFzeW5jIChhcGlLZXkpID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZygnW1ByZWxvYWRdIFNldHRpbmcgRGVlcGdyYW0gQVBJIGtleScpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIEZpcnN0IHRyeSBkZWRpY2F0ZWQgaGFuZGxlclxyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBxdWV1ZUNhbGwoJ2NvZGV4OnRyYW5zY3JpcHRpb246c2V0LWFwaS1rZXknLCBbeyBhcGlLZXkgfV0pO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW1ByZWxvYWRdIERlZXBncmFtIEFQSSBrZXkgc2V0IHJlc3VsdDonLCByZXN1bHQpO1xyXG5cclxuICAgICAgICAgICAgLy8gQWxzbyBzZXQgdGhlIGtleSBmb3IgdGhlIEFwaUtleVNlcnZpY2UgZm9yIGJldHRlciBjb21wYXRpYmlsaXR5XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBxdWV1ZUNhbGwoJ2NvZGV4OmFwaWtleTpzYXZlJywgW3sga2V5OiBhcGlLZXksIHByb3ZpZGVyOiAnZGVlcGdyYW0nIH1dKTtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbUHJlbG9hZF0gRGVlcGdyYW0gQVBJIGtleSBhbHNvIHNhdmVkIHZpYSBBUEkga2V5IHNlcnZpY2UnKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoYXBpS2V5RXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcmVsb2FkXSBFcnJvciBzYXZpbmcgdG8gQVBJIGtleSBzZXJ2aWNlOicsIGFwaUtleUVycm9yKTtcclxuICAgICAgICAgICAgICAgIC8vIENvbnRpbnVlIGV2ZW4gaWYgdGhpcyBmYWlsc1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcmVsb2FkXSBFcnJvciBzZXR0aW5nIERlZXBncmFtIEFQSSBrZXk6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICAvLyBGYWxsYmFjayB0byBnZW5lcmljIHNldHRpbmdzXHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBxdWV1ZUNhbGwoJ2NvZGV4OnNldC1zZXR0aW5nJywgWydkZWVwZ3JhbUFwaUtleScsIGFwaUtleV0pO1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgcXVldWVDYWxsKCdjb2RleDpzZXQtc2V0dGluZycsIFsndHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleScsIGFwaUtleV0pO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgICAgICAgICB9IGNhdGNoIChmYWxsYmFja0Vycm9yKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUHJlbG9hZF0gRmFsbGJhY2sgZXJyb3Igc2V0dGluZyBEZWVwZ3JhbSBBUEkga2V5OicsIGZhbGxiYWNrRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7IC8vIFRocm93IG9yaWdpbmFsIGVycm9yXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvLz09PSBBcHBsaWNhdGlvbiA9PT0vL1xyXG4gICAgZ2V0VmVyc2lvbjogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmdldC12ZXJzaW9uJywgW10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgY2hlY2tVcGRhdGVzOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y2hlY2stdXBkYXRlcycsIFtdKTtcclxuICAgIH1cclxufSk7XHJcblxyXG4vLyBDbGVhbiB1cCB3aGVuIHdpbmRvdyB1bmxvYWRzXHJcbndpbmRvdy5hZGRFdmVudExpc3RlbmVyKCd1bmxvYWQnLCBjbGVhbnVwRXZlbnRMaXN0ZW5lcnMpO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU07RUFBRUEsYUFBYTtFQUFFQztBQUFZLENBQUMsR0FBR0MsT0FBTyxDQUFDLFVBQVUsQ0FBQzs7QUFFMUQ7QUFDQUMsT0FBTyxDQUFDQyxHQUFHLENBQUMsdUNBQXVDLENBQUM7QUFDcEQsSUFBSTtFQUNBO0VBQ0FELE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHNCQUFzQixFQUFFLE9BQU9DLFVBQVUsS0FBSyxXQUFXLEdBQUdBLFVBQVUsR0FBRyxvQkFBb0IsQ0FBQztB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