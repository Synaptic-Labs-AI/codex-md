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
  // Parent URL specific events
  ipcRenderer.removeAllListeners('parent-url:conversion-progress');
  ipcRenderer.removeAllListeners('parent-url:conversion-started');
  ipcRenderer.removeAllListeners('parent-url:conversion-cancelling');
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
  /**
   * Cancel ongoing conversion requests
   * @returns {Promise<Object>}
   */
  cancelRequests: async () => {
    return queueCall('codex:convert:cancel', []);
  },
  /**
   * Cancel parent URL conversion
   * @param {string} conversionId - Conversion ID to cancel
   * @returns {Promise<Object>}
   */
  cancelParentUrlConversion: async conversionId => {
    return queueCall('convert:parent-url:cancel', [{
      conversionId
    }]);
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
  //=== Parent URL Conversion Events ===//

  /**
   * Register callback for parent URL conversion progress
   * @param {Function} callback - Progress callback
   */
  onParentUrlProgress: callback => {
    ipcRenderer.on('parent-url:conversion-progress', (_, data) => callback(data));
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('parent-url:conversion-progress', callback);
    };
  },
  /**
   * Register callback for parent URL conversion started
   * @param {Function} callback - Started callback
   */
  onParentUrlStarted: callback => {
    ipcRenderer.on('parent-url:conversion-started', (_, data) => callback(data));
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('parent-url:conversion-started', callback);
    };
  },
  /**
   * Register callback for parent URL conversion cancelling
   * @param {Function} callback - Cancelling callback
   */
  onParentUrlCancelling: callback => {
    ipcRenderer.on('parent-url:conversion-cancelling', (_, data) => callback(data));
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('parent-url:conversion-cancelling', callback);
    };
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
  saveApiKey: async (key, provider = 'mistral') => {
    return queueCall('codex:apikey:save', [{
      key,
      provider
    }]);
  },
  checkApiKeyExists: async (provider = 'mistral') => {
    return queueCall('codex:apikey:exists', [{
      provider
    }]);
  },
  deleteApiKey: async (provider = 'mistral') => {
    return queueCall('codex:apikey:delete', [{
      provider
    }]);
  },
  validateApiKey: async (key, provider = 'mistral') => {
    return queueCall('codex:apikey:validate', [{
      key,
      provider
    }]);
  },
  getApiKey: async (provider = 'mistral') => {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjb250ZXh0QnJpZGdlIiwiaXBjUmVuZGVyZXIiLCJyZXF1aXJlIiwiY29uc29sZSIsImxvZyIsIl9fZmlsZW5hbWUiLCJlcnJvciIsIm1lc3NhZ2UiLCJpc0FwcFJlYWR5IiwicGVuZGluZ0NhbGxzIiwiTWFwIiwicmVhZHlDYWxsYmFjayIsIkNBTExfVElNRU9VVCIsInF1ZXVlQ2FsbCIsImNoYW5uZWwiLCJhcmdzIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJpbnZva2UiLCJ0aGVuIiwiY2F0Y2giLCJpZCIsIkRhdGUiLCJub3ciLCJ0b1N0cmluZyIsInNldCIsInNldFRpbWVvdXQiLCJoYXMiLCJnZXQiLCJkZWxldGUiLCJFcnJvciIsInByb2Nlc3NQZW5kaW5nQ2FsbHMiLCJzaXplIiwiZmluYWxseSIsImNsZWFudXBFdmVudExpc3RlbmVycyIsInJlbW92ZUFsbExpc3RlbmVycyIsIm9uIiwiXyIsImV4cG9zZUluTWFpbldvcmxkIiwiaXNSZWFkeSIsIm9uUmVhZHkiLCJjYWxsYmFjayIsImNvbnZlcnQiLCJpbnB1dCIsIm9wdGlvbnMiLCJidWZmZXIiLCJBcnJheUJ1ZmZlciIsIkJ1ZmZlciIsImZyb20iLCJnZXRSZXN1bHQiLCJwYXRoIiwiY2FuY2VsUmVxdWVzdHMiLCJfcmVkaXJlY3RUb0NvbnZlcnQiLCJ0eXBlIiwiY29udmVydFVybCIsInVybCIsImlzV2ViIiwiY29udmVydFBhcmVudFVybCIsImNvbnZlcnRZb3V0dWJlIiwiY29udmVydEZpbGUiLCJjYW5jZWxQYXJlbnRVcmxDb252ZXJzaW9uIiwiY29udmVyc2lvbklkIiwib25Db252ZXJzaW9uUHJvZ3Jlc3MiLCJwcm9ncmVzcyIsInJlbW92ZUxpc3RlbmVyIiwib25Db252ZXJzaW9uU3RhdHVzIiwic3RhdHVzIiwib25Db252ZXJzaW9uQ29tcGxldGUiLCJyZXN1bHQiLCJvbkNvbnZlcnNpb25FcnJvciIsIm9mZkNvbnZlcnNpb25Qcm9ncmVzcyIsImxpc3RlbmVyIiwib2ZmQ29udmVyc2lvblN0YXR1cyIsIm9mZkNvbnZlcnNpb25Db21wbGV0ZSIsIm9mZkNvbnZlcnNpb25FcnJvciIsIm9uUGFyZW50VXJsUHJvZ3Jlc3MiLCJkYXRhIiwib25QYXJlbnRVcmxTdGFydGVkIiwib25QYXJlbnRVcmxDYW5jZWxsaW5nIiwic2VsZWN0RmlsZXMiLCJzZWxlY3REaXJlY3RvcnkiLCJzZWxlY3RJbnB1dERpcmVjdG9yeSIsInNlbGVjdE91dHB1dCIsImxpc3REaXJlY3RvcnlEZXRhaWxlZCIsInNob3dJdGVtSW5Gb2xkZXIiLCJnZXRTdGF0cyIsInJlYWRGaWxlIiwid3JpdGVGaWxlIiwiY29udGVudCIsImNyZWF0ZURpcmVjdG9yeSIsIm1vdmVJdGVtIiwic291cmNlUGF0aCIsImRlc3RQYXRoIiwiZGVsZXRlSXRlbSIsInJlY3Vyc2l2ZSIsIm9wZW5FeHRlcm5hbCIsImdldFNldHRpbmciLCJrZXkiLCJzZXRTZXR0aW5nIiwidmFsdWUiLCJzZXRPY3JFbmFibGVkIiwiZW5hYmxlZCIsImJvb2xFbmFibGVkIiwiQm9vbGVhbiIsImdldE9jckVuYWJsZWQiLCJzYXZlQXBpS2V5IiwicHJvdmlkZXIiLCJjaGVja0FwaUtleUV4aXN0cyIsImRlbGV0ZUFwaUtleSIsInZhbGlkYXRlQXBpS2V5IiwiZ2V0QXBpS2V5IiwiZ2V0T2ZmbGluZVN0YXR1cyIsImdldFF1ZXVlZE9wZXJhdGlvbnMiLCJxdWV1ZU9wZXJhdGlvbiIsIm9wZXJhdGlvbiIsImNhY2hlRGF0YSIsImdldENhY2hlZERhdGEiLCJtYXhBZ2UiLCJpbnZhbGlkYXRlQ2FjaGUiLCJjbGVhckNhY2hlIiwib25PZmZsaW5lRXZlbnQiLCJvbkZpbGVEcm9wcGVkIiwiZmlsZXMiLCJ0cmFuc2NyaWJlQXVkaW8iLCJmaWxlUGF0aCIsInRyYW5zY3JpYmVWaWRlbyIsImdldFRyYW5zY3JpcHRpb25Nb2RlbCIsInNldFRyYW5zY3JpcHRpb25Nb2RlbCIsIm1vZGVsIiwiZ2V0RGVlcGdyYW1BcGlLZXkiLCJoYXNLZXkiLCJkaXJlY3RLZXkiLCJuZXN0ZWRLZXkiLCJhcGlLZXkiLCJzdWNjZXNzIiwic291cmNlIiwiZmFsbGJhY2tFcnJvciIsInNldERlZXBncmFtQXBpS2V5IiwiYXBpS2V5RXJyb3IiLCJnZXRWZXJzaW9uIiwiY2hlY2tVcGRhdGVzIiwid2luZG93IiwiYWRkRXZlbnRMaXN0ZW5lciJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9lbGVjdHJvbi9wcmVsb2FkLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBQcmVsb2FkIFNjcmlwdFxyXG4gKiBFeHBvc2VzIHNwZWNpZmljIEVsZWN0cm9uIEFQSXMgdG8gdGhlIHJlbmRlcmVyIHByb2Nlc3NcclxuICogXHJcbiAqIFRoaXMgc2NyaXB0IGNyZWF0ZXMgYSBzZWN1cmUgYnJpZGdlIGJldHdlZW4gdGhlIHJlbmRlcmVyIHByb2Nlc3MgYW5kIHRoZSBtYWluIHByb2Nlc3MsXHJcbiAqIGV4cG9zaW5nIG9ubHkgdGhlIG5lY2Vzc2FyeSBmdW5jdGlvbmFsaXR5IHdoaWxlIG1haW50YWluaW5nIHNlY3VyaXR5IHRocm91Z2ggY29udGV4dElzb2xhdGlvbi5cclxuICogXHJcbiAqIEluY2x1ZGVzIGluaXRpYWxpemF0aW9uIHRyYWNraW5nIGFuZCBJUEMgY2FsbCBxdWV1ZWluZyB0byBlbnN1cmUgcmVsaWFibGUgY29tbXVuaWNhdGlvbi5cclxuICovXHJcblxyXG5jb25zdCB7IGNvbnRleHRCcmlkZ2UsIGlwY1JlbmRlcmVyIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5cclxuLy8gQWRkIGRpcmVjdCBjb25zb2xlIG91dHB1dCBmb3IgZGVidWdnaW5nXHJcbmNvbnNvbGUubG9nKCc9PT09PT0gUFJFTE9BRCBTQ1JJUFQgU1RBUlRJTkcgPT09PT09Jyk7XHJcbnRyeSB7XHJcbiAgICAvLyBVc2UgX19maWxlbmFtZSBpZiBhdmFpbGFibGUgKENvbW1vbkpTKSwgb3RoZXJ3aXNlIGhhbmRsZSBncmFjZWZ1bGx5XHJcbiAgICBjb25zb2xlLmxvZygnUHJlbG9hZCBzY3JpcHQgcGF0aDonLCB0eXBlb2YgX19maWxlbmFtZSAhPT0gJ3VuZGVmaW5lZCcgPyBfX2ZpbGVuYW1lIDogJ1BhdGggbm90IGF2YWlsYWJsZScpO1xyXG59IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5sb2coJ1VuYWJsZSB0byBkZXRlcm1pbmUgcHJlbG9hZCBzY3JpcHQgcGF0aDonLCBlcnJvci5tZXNzYWdlKTtcclxufVxyXG5jb25zb2xlLmxvZygnPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09Jyk7XHJcblxyXG4vLyBJbml0aWFsaXphdGlvbiB0cmFja2luZ1xyXG5sZXQgaXNBcHBSZWFkeSA9IGZhbHNlO1xyXG5jb25zdCBwZW5kaW5nQ2FsbHMgPSBuZXcgTWFwKCk7XHJcbmxldCByZWFkeUNhbGxiYWNrID0gbnVsbDtcclxuY29uc3QgQ0FMTF9USU1FT1VUID0gMTAwMDA7IC8vIDEwIHNlY29uZCB0aW1lb3V0IGZvciBxdWV1ZWQgY2FsbHNcclxuXHJcbi8qKlxyXG4gKiBRdWV1ZSBhbiBJUEMgY2FsbCB1bnRpbCBhcHAgaXMgcmVhZHlcclxuICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWwgLSBJUEMgY2hhbm5lbCBuYW1lXHJcbiAqIEBwYXJhbSB7QXJyYXl9IGFyZ3MgLSBDYWxsIGFyZ3VtZW50c1xyXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gUmVzb2x2ZXMgd2hlbiBjYWxsIGNvbXBsZXRlc1xyXG4gKi9cclxuZnVuY3Rpb24gcXVldWVDYWxsKGNoYW5uZWwsIGFyZ3MpIHtcclxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgICAgaWYgKGlzQXBwUmVhZHkpIHtcclxuICAgICAgICAgICAgLy8gQXBwIGlzIHJlYWR5LCBtYWtlIGNhbGwgaW1tZWRpYXRlbHlcclxuICAgICAgICAgICAgaXBjUmVuZGVyZXIuaW52b2tlKGNoYW5uZWwsIC4uLmFyZ3MpXHJcbiAgICAgICAgICAgICAgICAudGhlbihyZXNvbHZlKVxyXG4gICAgICAgICAgICAgICAgLmNhdGNoKHJlamVjdCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgLy8gUXVldWUgdGhlIGNhbGxcclxuICAgICAgICAgICAgY29uc3QgaWQgPSBEYXRlLm5vdygpLnRvU3RyaW5nKCk7XHJcbiAgICAgICAgICAgIHBlbmRpbmdDYWxscy5zZXQoaWQsIHsgY2hhbm5lbCwgYXJncywgcmVzb2x2ZSwgcmVqZWN0IH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gU2V0IHRpbWVvdXQgZm9yIHF1ZXVlZCBjYWxsc1xyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChwZW5kaW5nQ2FsbHMuaGFzKGlkKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHsgcmVqZWN0IH0gPSBwZW5kaW5nQ2FsbHMuZ2V0KGlkKTtcclxuICAgICAgICAgICAgICAgICAgICBwZW5kaW5nQ2FsbHMuZGVsZXRlKGlkKTtcclxuICAgICAgICAgICAgICAgICAgICByZWplY3QobmV3IEVycm9yKGBJUEMgY2FsbCB0byAke2NoYW5uZWx9IHRpbWVkIG91dCB3YWl0aW5nIGZvciBhcHAgcmVhZHlgKSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sIENBTExfVElNRU9VVCk7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBQcm9jZXNzIGFueSBxdWV1ZWQgY2FsbHMgb25jZSBhcHAgaXMgcmVhZHlcclxuICovXHJcbmZ1bmN0aW9uIHByb2Nlc3NQZW5kaW5nQ2FsbHMoKSB7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+TqCBQcm9jZXNzaW5nICR7cGVuZGluZ0NhbGxzLnNpemV9IHBlbmRpbmcgSVBDIGNhbGxzYCk7XHJcbiAgICBmb3IgKGNvbnN0IFtpZCwgeyBjaGFubmVsLCBhcmdzLCByZXNvbHZlLCByZWplY3QgfV0gb2YgcGVuZGluZ0NhbGxzKSB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIuaW52b2tlKGNoYW5uZWwsIC4uLmFyZ3MpXHJcbiAgICAgICAgICAgIC50aGVuKHJlc29sdmUpXHJcbiAgICAgICAgICAgIC5jYXRjaChyZWplY3QpXHJcbiAgICAgICAgICAgIC5maW5hbGx5KCgpID0+IHBlbmRpbmdDYWxscy5kZWxldGUoaWQpKTtcclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIENsZWFuIHVwIGV2ZW50IGxpc3RlbmVycyBvbiB3aW5kb3cgdW5sb2FkXHJcbiAqL1xyXG5mdW5jdGlvbiBjbGVhbnVwRXZlbnRMaXN0ZW5lcnMoKSB7XHJcbiAgICAvLyBSZW1vdmUgYWxsIGV2ZW50IGxpc3RlbmVyc1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdjb2RleDpjb252ZXJ0OnByb2dyZXNzJyk7XHJcbiAgICBpcGNSZW5kZXJlci5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2NvZGV4OmNvbnZlcnQ6c3RhdHVzJyk7XHJcbiAgICBpcGNSZW5kZXJlci5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2NvZGV4OmNvbnZlcnQ6Y29tcGxldGUnKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygnY29kZXg6Y29udmVydDplcnJvcicpO1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdjb2RleDpvZmZsaW5lOmV2ZW50Jyk7XHJcbiAgICBpcGNSZW5kZXJlci5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2NvZGV4OmZpbGUtZHJvcHBlZCcpO1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdjb2RleDp3YXRjaDpldmVudCcpO1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdhcHA6cmVhZHknKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygnYXBwOmVycm9yJyk7XHJcbiAgICAvLyBQYXJlbnQgVVJMIHNwZWNpZmljIGV2ZW50c1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdwYXJlbnQtdXJsOmNvbnZlcnNpb24tcHJvZ3Jlc3MnKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygncGFyZW50LXVybDpjb252ZXJzaW9uLXN0YXJ0ZWQnKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygncGFyZW50LXVybDpjb252ZXJzaW9uLWNhbmNlbGxpbmcnKTtcclxufVxyXG5cclxuLy8gSGFuZGxlIGFwcCByZWFkeSBldmVudFxyXG5pcGNSZW5kZXJlci5vbignYXBwOnJlYWR5JywgKCkgPT4ge1xyXG4gICAgY29uc29sZS5sb2coJ/CfmoAgQXBwIHJlYWR5IGV2ZW50IHJlY2VpdmVkJyk7XHJcbiAgICBpc0FwcFJlYWR5ID0gdHJ1ZTtcclxuICAgIHByb2Nlc3NQZW5kaW5nQ2FsbHMoKTtcclxuICAgIGlmIChyZWFkeUNhbGxiYWNrKSB7XHJcbiAgICAgICAgcmVhZHlDYWxsYmFjaygpO1xyXG4gICAgfVxyXG59KTtcclxuXHJcbi8vIEhhbmRsZSBhcHAgZXJyb3JzXHJcbmlwY1JlbmRlcmVyLm9uKCdhcHA6ZXJyb3InLCAoXywgZXJyb3IpID0+IHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBBcHAgZXJyb3I6JywgZXJyb3IpO1xyXG59KTtcclxuXHJcbi8vIEV4cG9zZSBwcm90ZWN0ZWQgbWV0aG9kcyB0byByZW5kZXJlciBwcm9jZXNzXHJcbmNvbnRleHRCcmlkZ2UuZXhwb3NlSW5NYWluV29ybGQoJ2VsZWN0cm9uJywge1xyXG4gICAgLy8gQXBwIFN0YXR1c1xyXG4gICAgaXNSZWFkeTogKCkgPT4gaXNBcHBSZWFkeSxcclxuICAgIFxyXG4gICAgb25SZWFkeTogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaWYgKGlzQXBwUmVhZHkpIHtcclxuICAgICAgICAgICAgY2FsbGJhY2soKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZWFkeUNhbGxiYWNrID0gY2FsbGJhY2s7XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICAvLz09PSBDb252ZXJzaW9uIE9wZXJhdGlvbnMgPT09Ly9cclxuICAgIGNvbnZlcnQ6IGFzeW5jIChpbnB1dCwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgIC8vIEhhbmRsZSBBcnJheUJ1ZmZlciBjb252ZXJzaW9uIHRvIEJ1ZmZlciBmb3IgSVBDXHJcbiAgICAgICAgaWYgKG9wdGlvbnMuYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcclxuICAgICAgICAgICAgY29uc3QgYnVmZmVyID0gQnVmZmVyLmZyb20ob3B0aW9ucy5idWZmZXIpO1xyXG4gICAgICAgICAgICBvcHRpb25zLmJ1ZmZlciA9IGJ1ZmZlcjtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpmaWxlJywgW2lucHV0LCBvcHRpb25zXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBnZXRSZXN1bHQ6IGFzeW5jIChwYXRoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpnZXQtcmVzdWx0JywgW3BhdGhdKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGNhbmNlbFJlcXVlc3RzOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpjYW5jZWwnLCBbXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvLyBIZWxwZXIgbWV0aG9kIHRvIGxvZyBhbmQgcmVkaXJlY3QgdG8gZ2VuZXJpYyBjb252ZXJ0IG1ldGhvZFxyXG4gICAgX3JlZGlyZWN0VG9Db252ZXJ0OiBhc3luYyAoaW5wdXQsIG9wdGlvbnMsIHR5cGUpID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgUmVkaXJlY3RpbmcgJHt0eXBlfSBjb252ZXJzaW9uIHRvIGdlbmVyaWMgY29udmVydCBtZXRob2RgKTtcclxuICAgICAgICBvcHRpb25zLnR5cGUgPSB0eXBlO1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmNvbnZlcnQ6ZmlsZScsIFtpbnB1dCwgb3B0aW9uc10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy8gU3BlY2lhbGl6ZWQgY29udmVyc2lvbiBtZXRob2RzIHRoYXQgcmVkaXJlY3QgdG8gZ2VuZXJpYyBjb252ZXJ0XHJcbiAgICBjb252ZXJ0VXJsOiBhc3luYyAodXJsLCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgb3B0aW9ucy50eXBlID0gJ3VybCc7XHJcbiAgICAgICAgb3B0aW9ucy5pc1dlYiA9IHRydWU7XHJcbiAgICAgICAgY29uc29sZS5sb2coYENvbnZlcnRpbmcgVVJMOiAke3VybH0gKHJlZGlyZWN0aW5nIHRvIGdlbmVyaWMgY29udmVydClgLCBvcHRpb25zKTtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpjb252ZXJ0OmZpbGUnLCBbdXJsLCBvcHRpb25zXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBjb252ZXJ0UGFyZW50VXJsOiBhc3luYyAodXJsLCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgb3B0aW9ucy50eXBlID0gJ3BhcmVudHVybCc7XHJcbiAgICAgICAgb3B0aW9ucy5pc1dlYiA9IHRydWU7XHJcbiAgICAgICAgY29uc29sZS5sb2coYENvbnZlcnRpbmcgUGFyZW50IFVSTDogJHt1cmx9IChyZWRpcmVjdGluZyB0byBnZW5lcmljIGNvbnZlcnQpYCwgb3B0aW9ucyk7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpmaWxlJywgW3VybCwgb3B0aW9uc10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgY29udmVydFlvdXR1YmU6IGFzeW5jICh1cmwsIG9wdGlvbnMpID0+IHtcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICBvcHRpb25zLnR5cGUgPSAneW91dHViZSc7XHJcbiAgICAgICAgb3B0aW9ucy5pc1dlYiA9IHRydWU7XHJcbiAgICAgICAgY29uc29sZS5sb2coYENvbnZlcnRpbmcgWW91VHViZTogJHt1cmx9IChyZWRpcmVjdGluZyB0byBnZW5lcmljIGNvbnZlcnQpYCwgb3B0aW9ucyk7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpmaWxlJywgW3VybCwgb3B0aW9uc10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgY29udmVydEZpbGU6IGFzeW5jIChwYXRoLCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgY29uc29sZS5sb2coYENvbnZlcnRpbmcgZmlsZTogJHtwYXRofSAocmVkaXJlY3RpbmcgdG8gZ2VuZXJpYyBjb252ZXJ0KWAsIG9wdGlvbnMpO1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmNvbnZlcnQ6ZmlsZScsIFtwYXRoLCBvcHRpb25zXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIENhbmNlbCBvbmdvaW5nIGNvbnZlcnNpb24gcmVxdWVzdHNcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59XHJcbiAgICAgKi9cclxuICAgIGNhbmNlbFJlcXVlc3RzOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpjYW5jZWwnLCBbXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIENhbmNlbCBwYXJlbnQgVVJMIGNvbnZlcnNpb25cclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIElEIHRvIGNhbmNlbFxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn1cclxuICAgICAqL1xyXG4gICAgY2FuY2VsUGFyZW50VXJsQ29udmVyc2lvbjogYXN5bmMgKGNvbnZlcnNpb25JZCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvbnZlcnQ6cGFyZW50LXVybDpjYW5jZWwnLCBbeyBjb252ZXJzaW9uSWQgfV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy89PT0gQ29udmVyc2lvbiBFdmVudCBIYW5kbGVycyA9PT0vL1xyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlZ2lzdGVyIGNhbGxiYWNrIGZvciBjb252ZXJzaW9uIHByb2dyZXNzXHJcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayAtIFByb2dyZXNzIGNhbGxiYWNrXHJcbiAgICAgKi9cclxuICAgIG9uQ29udmVyc2lvblByb2dyZXNzOiAoY2FsbGJhY2spID0+IHtcclxuICAgICAgICBpcGNSZW5kZXJlci5vbignY29kZXg6Y29udmVydDpwcm9ncmVzcycsIChfLCBwcm9ncmVzcykgPT4gY2FsbGJhY2socHJvZ3Jlc3MpKTtcclxuICAgICAgICAvLyBSZXR1cm4gY2xlYW51cCBmdW5jdGlvblxyXG4gICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpjb252ZXJ0OnByb2dyZXNzJywgY2FsbGJhY2spO1xyXG4gICAgICAgIH07XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlZ2lzdGVyIGNhbGxiYWNrIGZvciBjb252ZXJzaW9uIHN0YXR1c1xyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgLSBTdGF0dXMgY2FsbGJhY2tcclxuICAgICAqL1xyXG4gICAgb25Db252ZXJzaW9uU3RhdHVzOiAoY2FsbGJhY2spID0+IHtcclxuICAgICAgICBpcGNSZW5kZXJlci5vbignY29kZXg6Y29udmVydDpzdGF0dXMnLCAoXywgc3RhdHVzKSA9PiBjYWxsYmFjayhzdGF0dXMpKTtcclxuICAgICAgICAvLyBSZXR1cm4gY2xlYW51cCBmdW5jdGlvblxyXG4gICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpjb252ZXJ0OnN0YXR1cycsIGNhbGxiYWNrKTtcclxuICAgICAgICB9O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWdpc3RlciBjYWxsYmFjayBmb3IgY29udmVyc2lvbiBjb21wbGV0aW9uXHJcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayAtIENvbXBsZXRpb24gY2FsbGJhY2tcclxuICAgICAqL1xyXG4gICAgb25Db252ZXJzaW9uQ29tcGxldGU6IChjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLm9uKCdjb2RleDpjb252ZXJ0OmNvbXBsZXRlJywgKF8sIHJlc3VsdCkgPT4gY2FsbGJhY2socmVzdWx0KSk7XHJcbiAgICAgICAgLy8gUmV0dXJuIGNsZWFudXAgZnVuY3Rpb25cclxuICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcignY29kZXg6Y29udmVydDpjb21wbGV0ZScsIGNhbGxiYWNrKTtcclxuICAgICAgICB9O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWdpc3RlciBjYWxsYmFjayBmb3IgY29udmVyc2lvbiBlcnJvcnNcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIC0gRXJyb3IgY2FsbGJhY2tcclxuICAgICAqL1xyXG4gICAgb25Db252ZXJzaW9uRXJyb3I6IChjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLm9uKCdjb2RleDpjb252ZXJ0OmVycm9yJywgKF8sIGVycm9yKSA9PiBjYWxsYmFjayhlcnJvcikpO1xyXG4gICAgICAgIC8vIFJldHVybiBjbGVhbnVwIGZ1bmN0aW9uXHJcbiAgICAgICAgcmV0dXJuICgpID0+IHtcclxuICAgICAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4OmNvbnZlcnQ6ZXJyb3InLCBjYWxsYmFjayk7XHJcbiAgICAgICAgfTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUmVtb3ZlIGNvbnZlcnNpb24gcHJvZ3Jlc3MgbGlzdGVuZXJcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyIC0gUHJvZ3Jlc3MgbGlzdGVuZXIgdG8gcmVtb3ZlXHJcbiAgICAgKi9cclxuICAgIG9mZkNvbnZlcnNpb25Qcm9ncmVzczogKGxpc3RlbmVyKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4OmNvbnZlcnQ6cHJvZ3Jlc3MnLCBsaXN0ZW5lcik7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlbW92ZSBjb252ZXJzaW9uIHN0YXR1cyBsaXN0ZW5lclxyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gbGlzdGVuZXIgLSBTdGF0dXMgbGlzdGVuZXIgdG8gcmVtb3ZlXHJcbiAgICAgKi9cclxuICAgIG9mZkNvbnZlcnNpb25TdGF0dXM6IChsaXN0ZW5lcikgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpjb252ZXJ0OnN0YXR1cycsIGxpc3RlbmVyKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUmVtb3ZlIGNvbnZlcnNpb24gY29tcGxldGUgbGlzdGVuZXJcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyIC0gQ29tcGxldGUgbGlzdGVuZXIgdG8gcmVtb3ZlXHJcbiAgICAgKi9cclxuICAgIG9mZkNvbnZlcnNpb25Db21wbGV0ZTogKGxpc3RlbmVyKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4OmNvbnZlcnQ6Y29tcGxldGUnLCBsaXN0ZW5lcik7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlbW92ZSBjb252ZXJzaW9uIGVycm9yIGxpc3RlbmVyXHJcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBsaXN0ZW5lciAtIEVycm9yIGxpc3RlbmVyIHRvIHJlbW92ZVxyXG4gICAgICovXHJcbiAgICBvZmZDb252ZXJzaW9uRXJyb3I6IChsaXN0ZW5lcikgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpjb252ZXJ0OmVycm9yJywgbGlzdGVuZXIpO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy89PT0gUGFyZW50IFVSTCBDb252ZXJzaW9uIEV2ZW50cyA9PT0vL1xyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlZ2lzdGVyIGNhbGxiYWNrIGZvciBwYXJlbnQgVVJMIGNvbnZlcnNpb24gcHJvZ3Jlc3NcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIC0gUHJvZ3Jlc3MgY2FsbGJhY2tcclxuICAgICAqL1xyXG4gICAgb25QYXJlbnRVcmxQcm9ncmVzczogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIub24oJ3BhcmVudC11cmw6Y29udmVyc2lvbi1wcm9ncmVzcycsIChfLCBkYXRhKSA9PiBjYWxsYmFjayhkYXRhKSk7XHJcbiAgICAgICAgLy8gUmV0dXJuIGNsZWFudXAgZnVuY3Rpb25cclxuICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcigncGFyZW50LXVybDpjb252ZXJzaW9uLXByb2dyZXNzJywgY2FsbGJhY2spO1xyXG4gICAgICAgIH07XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlZ2lzdGVyIGNhbGxiYWNrIGZvciBwYXJlbnQgVVJMIGNvbnZlcnNpb24gc3RhcnRlZFxyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgLSBTdGFydGVkIGNhbGxiYWNrXHJcbiAgICAgKi9cclxuICAgIG9uUGFyZW50VXJsU3RhcnRlZDogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIub24oJ3BhcmVudC11cmw6Y29udmVyc2lvbi1zdGFydGVkJywgKF8sIGRhdGEpID0+IGNhbGxiYWNrKGRhdGEpKTtcclxuICAgICAgICAvLyBSZXR1cm4gY2xlYW51cCBmdW5jdGlvblxyXG4gICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdwYXJlbnQtdXJsOmNvbnZlcnNpb24tc3RhcnRlZCcsIGNhbGxiYWNrKTtcclxuICAgICAgICB9O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWdpc3RlciBjYWxsYmFjayBmb3IgcGFyZW50IFVSTCBjb252ZXJzaW9uIGNhbmNlbGxpbmdcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIC0gQ2FuY2VsbGluZyBjYWxsYmFja1xyXG4gICAgICovXHJcbiAgICBvblBhcmVudFVybENhbmNlbGxpbmc6IChjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLm9uKCdwYXJlbnQtdXJsOmNvbnZlcnNpb24tY2FuY2VsbGluZycsIChfLCBkYXRhKSA9PiBjYWxsYmFjayhkYXRhKSk7XHJcbiAgICAgICAgLy8gUmV0dXJuIGNsZWFudXAgZnVuY3Rpb25cclxuICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcigncGFyZW50LXVybDpjb252ZXJzaW9uLWNhbmNlbGxpbmcnLCBjYWxsYmFjayk7XHJcbiAgICAgICAgfTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IEZpbGUgU3lzdGVtIE9wZXJhdGlvbnMgPT09Ly9cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBTZWxlY3QgZmlsZXMgZm9yIGNvbnZlcnNpb25cclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gU2VsZWN0aW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgc2VsZWN0RmlsZXM6IGFzeW5jIChvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6ZnM6c2VsZWN0LWZpbGVzJywgb3B0aW9ucyk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFNlbGVjdCBkaXJlY3RvcnkgZm9yIG91dHB1dFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBTZWxlY3Rpb24gb3B0aW9uc1xyXG4gICAgICovXHJcbiAgICBzZWxlY3REaXJlY3Rvcnk6IGFzeW5jIChvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6ZnM6c2VsZWN0LWRpcmVjdG9yeScsIG9wdGlvbnMpO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBTZWxlY3QgaW5wdXQgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIFNlbGVjdGlvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIHNlbGVjdElucHV0RGlyZWN0b3J5OiBhc3luYyAob3B0aW9ucykgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnNlbGVjdC1pbnB1dC1kaXJlY3RvcnknLCBvcHRpb25zKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogU2VsZWN0IG91dHB1dCBkaXJlY3RvcnlcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gU2VsZWN0aW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgc2VsZWN0T3V0cHV0OiBhc3luYyAob3B0aW9ucykgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnNlbGVjdC1vdXRwdXQnLCBvcHRpb25zKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogTGlzdCBkaXJlY3RvcnkgY29udGVudHNcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRGlyZWN0b3J5IHBhdGhcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gTGlzdGluZyBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIGxpc3REaXJlY3RvcnlEZXRhaWxlZDogYXN5bmMgKHBhdGgsIG9wdGlvbnMpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczpsaXN0LWRpcmVjdG9yeScsIHsgcGF0aCwgLi4ub3B0aW9ucyB9KTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogU2hvdyBpdGVtIGluIGZvbGRlclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBJdGVtIHBhdGhcclxuICAgICAqL1xyXG4gICAgc2hvd0l0ZW1JbkZvbGRlcjogYXN5bmMgKHBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpzaG93LWl0ZW0taW4tZm9sZGVyJywgcGF0aCk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIEdldCBmaWxlIG9yIGRpcmVjdG9yeSBzdGF0c1xyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBQYXRoIHRvIGNoZWNrXHJcbiAgICAgKi9cclxuICAgIGdldFN0YXRzOiBhc3luYyAocGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnN0YXRzJywgeyBwYXRoIH0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWFkIGZpbGUgY29udGVudHNcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRmlsZSBwYXRoXHJcbiAgICAgKi9cclxuICAgIHJlYWRGaWxlOiBhc3luYyAocGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnJlYWQnLCB7IHBhdGggfSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFdyaXRlIGNvbnRlbnQgdG8gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBGaWxlIHBhdGhcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfEJ1ZmZlcn0gY29udGVudCAtIEZpbGUgY29udGVudFxyXG4gICAgICovXHJcbiAgICB3cml0ZUZpbGU6IGFzeW5jIChwYXRoLCBjb250ZW50KSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6ZnM6d3JpdGUnLCB7IHBhdGgsIGNvbnRlbnQgfSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIENyZWF0ZSBkaXJlY3RvcnlcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRGlyZWN0b3J5IHBhdGhcclxuICAgICAqL1xyXG4gICAgY3JlYXRlRGlyZWN0b3J5OiBhc3luYyAocGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOm1rZGlyJywgeyBwYXRoIH0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBNb3ZlIGZpbGUgb3IgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc291cmNlUGF0aCAtIFNvdXJjZSBwYXRoXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZGVzdFBhdGggLSBEZXN0aW5hdGlvbiBwYXRoXHJcbiAgICAgKi9cclxuICAgIG1vdmVJdGVtOiBhc3luYyAoc291cmNlUGF0aCwgZGVzdFBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczptb3ZlJywgeyBzb3VyY2VQYXRoLCBkZXN0UGF0aCB9KTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogRGVsZXRlIGZpbGUgb3IgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIFBhdGggdG8gZGVsZXRlXHJcbiAgICAgKiBAcGFyYW0ge2Jvb2xlYW59IHJlY3Vyc2l2ZSAtIFdoZXRoZXIgdG8gZGVsZXRlIHJlY3Vyc2l2ZWx5XHJcbiAgICAgKi9cclxuICAgIGRlbGV0ZUl0ZW06IGFzeW5jIChwYXRoLCByZWN1cnNpdmUpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczpkZWxldGUnLCB7IHBhdGgsIHJlY3Vyc2l2ZSB9KTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogT3BlbiBleHRlcm5hbCBVUkwgb3IgZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIFVSTCBvciBmaWxlIHBhdGggdG8gb3BlblxyXG4gICAgICovXHJcbiAgICBvcGVuRXh0ZXJuYWw6IGFzeW5jICh1cmwpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpvcGVuLWV4dGVybmFsJywgdXJsKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IFNldHRpbmdzIE1hbmFnZW1lbnQgPT09Ly9cclxuICAgIGdldFNldHRpbmc6IGFzeW5jIChrZXkpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpnZXQtc2V0dGluZycsIFtrZXldKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIHNldFNldHRpbmc6IGFzeW5jIChrZXksIHZhbHVlKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6c2V0LXNldHRpbmcnLCBba2V5LCB2YWx1ZV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy8gT0NSIHNwZWNpZmljIHNldHRpbmdzXHJcbiAgICBzZXRPY3JFbmFibGVkOiBhc3luYyAoeyBlbmFibGVkIH0pID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW1ByZWxvYWRdIFNldHRpbmcgT0NSIGVuYWJsZWQgdG86ICR7ZW5hYmxlZH0gKHR5cGU6ICR7dHlwZW9mIGVuYWJsZWR9KWApO1xyXG4gICAgICAgIC8vIEVuc3VyZSBlbmFibGVkIGlzIGEgYm9vbGVhblxyXG4gICAgICAgIGNvbnN0IGJvb2xFbmFibGVkID0gQm9vbGVhbihlbmFibGVkKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW1ByZWxvYWRdIENvbnZlcnRlZCB0byBib29sZWFuOiAke2Jvb2xFbmFibGVkfSAodHlwZTogJHt0eXBlb2YgYm9vbEVuYWJsZWR9KWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHF1ZXVlQ2FsbCgnY29kZXg6c2V0dGluZ3M6c2V0LW9jci1lbmFibGVkJywgW3sgZW5hYmxlZDogYm9vbEVuYWJsZWQgfV0pO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbUHJlbG9hZF0gUmVzdWx0IGZyb20gc2V0dGluZyBPQ1IgZW5hYmxlZDpgLCByZXN1bHQpO1xyXG4gICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBnZXRPY3JFbmFibGVkOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcXVldWVDYWxsKCdjb2RleDpzZXR0aW5nczpnZXQtb2NyLWVuYWJsZWQnLCBbXSk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtQcmVsb2FkXSBHb3QgT0NSIGVuYWJsZWQ6ICR7cmVzdWx0fSAodHlwZTogJHt0eXBlb2YgcmVzdWx0fSlgKTtcclxuICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy89PT0gQVBJIEtleSBNYW5hZ2VtZW50ID09PS8vXHJcbiAgICBzYXZlQXBpS2V5OiBhc3luYyAoa2V5LCBwcm92aWRlciA9ICdtaXN0cmFsJykgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmFwaWtleTpzYXZlJywgW3sga2V5LCBwcm92aWRlciB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBjaGVja0FwaUtleUV4aXN0czogYXN5bmMgKHByb3ZpZGVyID0gJ21pc3RyYWwnKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6YXBpa2V5OmV4aXN0cycsIFt7IHByb3ZpZGVyIH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGRlbGV0ZUFwaUtleTogYXN5bmMgKHByb3ZpZGVyID0gJ21pc3RyYWwnKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6YXBpa2V5OmRlbGV0ZScsIFt7IHByb3ZpZGVyIH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIHZhbGlkYXRlQXBpS2V5OiBhc3luYyAoa2V5LCBwcm92aWRlciA9ICdtaXN0cmFsJykgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmFwaWtleTp2YWxpZGF0ZScsIFt7IGtleSwgcHJvdmlkZXIgfV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgZ2V0QXBpS2V5OiBhc3luYyAocHJvdmlkZXIgPSAnbWlzdHJhbCcpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDphcGlrZXk6Z2V0JywgW3sgcHJvdmlkZXIgfV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy89PT0gT2ZmbGluZSBGdW5jdGlvbmFsaXR5ID09PS8vXHJcbiAgICBnZXRPZmZsaW5lU3RhdHVzOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6b2ZmbGluZTpzdGF0dXMnLCBbXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBnZXRRdWV1ZWRPcGVyYXRpb25zOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6b2ZmbGluZTpxdWV1ZWQtb3BlcmF0aW9ucycsIFtdKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIHF1ZXVlT3BlcmF0aW9uOiBhc3luYyAob3BlcmF0aW9uKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6b2ZmbGluZTpxdWV1ZS1vcGVyYXRpb24nLCBbb3BlcmF0aW9uXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBjYWNoZURhdGE6IGFzeW5jIChrZXksIGRhdGEpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpvZmZsaW5lOmNhY2hlLWRhdGEnLCBbeyBrZXksIGRhdGEgfV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgZ2V0Q2FjaGVkRGF0YTogYXN5bmMgKGtleSwgbWF4QWdlKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6b2ZmbGluZTpnZXQtY2FjaGVkLWRhdGEnLCBbeyBrZXksIG1heEFnZSB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBpbnZhbGlkYXRlQ2FjaGU6IGFzeW5jIChrZXkpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpvZmZsaW5lOmludmFsaWRhdGUtY2FjaGUnLCBbeyBrZXkgfV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgY2xlYXJDYWNoZTogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4Om9mZmxpbmU6Y2xlYXItY2FjaGUnLCBbXSk7XHJcbiAgICB9LFxyXG4gICAgLy8gRXZlbnQgaGFuZGxlcnMgZG9uJ3QgbmVlZCBxdWV1ZWluZyBzaW5jZSB0aGV5IGp1c3QgcmVnaXN0ZXIgY2FsbGJhY2tzXHJcbiAgICBvbk9mZmxpbmVFdmVudDogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIub24oJ2NvZGV4Om9mZmxpbmU6ZXZlbnQnLCAoXywgZGF0YSkgPT4gY2FsbGJhY2soZGF0YSkpO1xyXG4gICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpvZmZsaW5lOmV2ZW50JywgY2FsbGJhY2spO1xyXG4gICAgICAgIH07XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlZ2lzdGVyIGNhbGxiYWNrIGZvciBmaWxlIGRyb3AgZXZlbnRzXHJcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayAtIEZpbGUgZHJvcCBjYWxsYmFja1xyXG4gICAgICovXHJcbiAgICBvbkZpbGVEcm9wcGVkOiAoY2FsbGJhY2spID0+IHtcclxuICAgICAgICBpcGNSZW5kZXJlci5vbignY29kZXg6ZmlsZS1kcm9wcGVkJywgKF8sIGZpbGVzKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGaWxlIGRyb3BwZWQgZXZlbnQgcmVjZWl2ZWQ6JywgZmlsZXMpO1xyXG4gICAgICAgICAgICBjYWxsYmFjayhmaWxlcyk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgcmV0dXJuICgpID0+IHtcclxuICAgICAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4OmZpbGUtZHJvcHBlZCcsIGNhbGxiYWNrKTtcclxuICAgICAgICB9O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy89PT0gVHJhbnNjcmlwdGlvbiA9PT0vL1xyXG4gICAgdHJhbnNjcmliZUF1ZGlvOiBhc3luYyAoZmlsZVBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDp0cmFuc2NyaWJlOmF1ZGlvJywgW3sgZmlsZVBhdGggfV0pO1xyXG4gICAgfSxcclxuXHJcbiAgICB0cmFuc2NyaWJlVmlkZW86IGFzeW5jIChmaWxlUGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OnRyYW5zY3JpYmU6dmlkZW8nLCBbeyBmaWxlUGF0aCB9XSk7XHJcbiAgICB9LFxyXG5cclxuICAgIGdldFRyYW5zY3JpcHRpb25Nb2RlbDogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmdldC1zZXR0aW5nJywgWyd0cmFuc2NyaXB0aW9uLm1vZGVsJ10pO1xyXG4gICAgfSxcclxuXHJcbiAgICBzZXRUcmFuc2NyaXB0aW9uTW9kZWw6IGFzeW5jIChtb2RlbCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OnNldC1zZXR0aW5nJywgWyd0cmFuc2NyaXB0aW9uLm1vZGVsJywgbW9kZWxdKTtcclxuICAgIH0sXHJcblxyXG4gICAgLy8gRW5oYW5jZWQgRGVlcGdyYW0gQVBJIGtleSBoYW5kbGVycyAtIGFkZGVkIHRvIHByb3ZpZGUgbW9yZSByZWxpYWJsZSBBUEkga2V5IGhhbmRsaW5nXHJcbiAgICBnZXREZWVwZ3JhbUFwaUtleTogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdbUHJlbG9hZF0gR2V0dGluZyBEZWVwZ3JhbSBBUEkga2V5Jyk7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgLy8gRmlyc3QgdHJ5IGRlZGljYXRlZCBoYW5kbGVyXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHF1ZXVlQ2FsbCgnY29kZXg6dHJhbnNjcmlwdGlvbjpnZXQtYXBpLWtleScsIFtdKTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tQcmVsb2FkXSBEZWVwZ3JhbSBBUEkga2V5IHJldHJpZXZhbCByZXN1bHQ6JyxcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA/IChyZXN1bHQuaGFzS2V5ID8gJ0ZvdW5kIGtleScgOiAnTm8ga2V5IGZvdW5kJykgOiAnTm8gcmVzdWx0Jyk7XHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1ByZWxvYWRdIEVycm9yIGdldHRpbmcgRGVlcGdyYW0gQVBJIGtleTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIC8vIEZhbGxiYWNrIHRvIGdlbmVyaWMgc2V0dGluZ1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0S2V5ID0gYXdhaXQgcXVldWVDYWxsKCdjb2RleDpnZXQtc2V0dGluZycsIFsnZGVlcGdyYW1BcGlLZXknXSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBuZXN0ZWRLZXkgPSBhd2FpdCBxdWV1ZUNhbGwoJ2NvZGV4OmdldC1zZXR0aW5nJywgWyd0cmFuc2NyaXB0aW9uLmRlZXBncmFtQXBpS2V5J10pO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYXBpS2V5ID0gZGlyZWN0S2V5IHx8IG5lc3RlZEtleSB8fCAnJztcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBhcGlLZXksXHJcbiAgICAgICAgICAgICAgICAgICAgaGFzS2V5OiAhIWFwaUtleSxcclxuICAgICAgICAgICAgICAgICAgICBzb3VyY2U6IGRpcmVjdEtleSA/ICdkaXJlY3QnIDogKG5lc3RlZEtleSA/ICduZXN0ZWQnIDogJ25vbmUnKVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZmFsbGJhY2tFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1ByZWxvYWRdIEZhbGxiYWNrIGVycm9yIGdldHRpbmcgRGVlcGdyYW0gQVBJIGtleTonLCBmYWxsYmFja0Vycm9yKTtcclxuICAgICAgICAgICAgICAgIHRocm93IGVycm9yOyAvLyBUaHJvdyBvcmlnaW5hbCBlcnJvclxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBzZXREZWVwZ3JhbUFwaUtleTogYXN5bmMgKGFwaUtleSkgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdbUHJlbG9hZF0gU2V0dGluZyBEZWVwZ3JhbSBBUEkga2V5Jyk7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgLy8gRmlyc3QgdHJ5IGRlZGljYXRlZCBoYW5kbGVyXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHF1ZXVlQ2FsbCgnY29kZXg6dHJhbnNjcmlwdGlvbjpzZXQtYXBpLWtleScsIFt7IGFwaUtleSB9XSk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbUHJlbG9hZF0gRGVlcGdyYW0gQVBJIGtleSBzZXQgcmVzdWx0OicsIHJlc3VsdCk7XHJcblxyXG4gICAgICAgICAgICAvLyBBbHNvIHNldCB0aGUga2V5IGZvciB0aGUgQXBpS2V5U2VydmljZSBmb3IgYmV0dGVyIGNvbXBhdGliaWxpdHlcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHF1ZXVlQ2FsbCgnY29kZXg6YXBpa2V5OnNhdmUnLCBbeyBrZXk6IGFwaUtleSwgcHJvdmlkZXI6ICdkZWVwZ3JhbScgfV0pO1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tQcmVsb2FkXSBEZWVwZ3JhbSBBUEkga2V5IGFsc28gc2F2ZWQgdmlhIEFQSSBrZXkgc2VydmljZScpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChhcGlLZXlFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1ByZWxvYWRdIEVycm9yIHNhdmluZyB0byBBUEkga2V5IHNlcnZpY2U6JywgYXBpS2V5RXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgLy8gQ29udGludWUgZXZlbiBpZiB0aGlzIGZhaWxzXHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1ByZWxvYWRdIEVycm9yIHNldHRpbmcgRGVlcGdyYW0gQVBJIGtleTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIC8vIEZhbGxiYWNrIHRvIGdlbmVyaWMgc2V0dGluZ3NcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHF1ZXVlQ2FsbCgnY29kZXg6c2V0LXNldHRpbmcnLCBbJ2RlZXBncmFtQXBpS2V5JywgYXBpS2V5XSk7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBxdWV1ZUNhbGwoJ2NvZGV4OnNldC1zZXR0aW5nJywgWyd0cmFuc2NyaXB0aW9uLmRlZXBncmFtQXBpS2V5JywgYXBpS2V5XSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGZhbGxiYWNrRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcmVsb2FkXSBGYWxsYmFjayBlcnJvciBzZXR0aW5nIERlZXBncmFtIEFQSSBrZXk6JywgZmFsbGJhY2tFcnJvcik7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjsgLy8gVGhyb3cgb3JpZ2luYWwgZXJyb3JcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IEFwcGxpY2F0aW9uID09PS8vXHJcbiAgICBnZXRWZXJzaW9uOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Z2V0LXZlcnNpb24nLCBbXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBjaGVja1VwZGF0ZXM6IGFzeW5jICgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpjaGVjay11cGRhdGVzJywgW10pO1xyXG4gICAgfVxyXG59KTtcclxuXHJcbi8vIENsZWFuIHVwIHdoZW4gd2luZG93IHVubG9hZHNcclxud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3VubG9hZCcsIGNsZWFudXBFdmVudExpc3RlbmVycyk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTTtFQUFFQSxhQUFhO0VBQUVDO0FBQVksQ0FBQyxHQUFHQyxPQUFPLENBQUMsVUFBVSxDQUFDOztBQUUxRDtBQUNBQyxPQUFPLENBQUNDLEdBQUcsQ0FBQyx1Q0FBdUMsQ0FBQztBQUNwRCxJQUFJO0VBQ0E7RUFDQUQsT0FBTyxDQUFDQyxHQUFHLENBQUMsc0JBQXNCLEVBQUUsT0FBT0MsVUFBVSxLQUFLLFdBQVcsR0FBR0EsVUFBVSxHQUFHLG9CQUFvQixDQUFDO0FBQzlHLENBQUMsQ0FBQyxPQUFPQyxLQUFLLEVBQUU7RUFDWkgsT0FBTyxDQUFDQyxHQUFHLENBQUMsMENBQTBDLEVBQUVFLEtBQUssQ0FBQ0MsT0FBTyxDQUFDO0FBQzFFO0FBQ0FKLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHNDQUFzQyxDQUFDOztBQUVuRDtBQUNBLElBQUlJLFVBQVUsR0FBRyxLQUFLO0FBQ3RCLE1BQU1DLFlBQVksR0FBRyxJQUFJQyxHQUFHLENBQUMsQ0FBQztBQUM5QixJQUFJQyxhQUFhLEdBQUcsSUFBSTtBQUN4QixNQUFNQyxZQUFZLEdBQUcsS0FBSyxDQUFDLENBQUM7O0FBRTVCO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVNDLFNBQVNBLENBQUNDLE9BQU8sRUFBRUMsSUFBSSxFQUFFO0VB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QU0sR0FBRyxNQUFNeEQsU0FBUyxDQUFDLGlDQUFpQyxFQUFFLENBQUM7UUFBRXlIO01BQU8sQ0FBQyxDQUFDLENBQUM7TUFDL0VuSSxPQUFPLENBQUNDLEdBQUcsQ0FBQyx3Q0FBd0MsRUFBRWlFLE1BQU0sQ0FBQzs7TUFFN0Q7TUFDQSxJQUFJO1FBQ0EsTUFBTXhELFNBQVMsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1VBQUVxRixHQUFHLEVBQUVvQyxNQUFNO1VBQUUzQixRQUFRLEVBQUU7UUFBVyxDQUFDLENBQUMsQ0FBQztRQUM3RXhHLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDJEQUEyRCxDQUFDO01BQzVFLENBQUMsQ0FBQyxPQUFPdUksV0FBVyxFQUFFO1FBQ2xCeEksT0FBTyxDQUFDRyxLQUFLLENBQUMsNENBQTRDLEVBQUVxSSxXQUFXLENBQUM7UUFDeEU7TUFDSjtNQUVBLE9BQU90RSxNQUFNO0lBQ2pCLENBQUMsQ0FBQyxPQUFPL0QsS0FBSyxFQUFFO01BQ1pILE9BQU8sQ0FBQ0csS0FBSyxDQUFDLDJDQUEyQyxFQUFFQSxLQUFLLENBQUM7TUFDakU7TUFDQSxJQUFJO1FBQ0EsTUFBTU8sU0FBUyxDQUFDLG1CQUFtQixFQUFFLENBQUMsZ0JBQWdCLEVBQUV5SCxNQUFNLENBQUMsQ0FBQztRQUNoRSxNQUFNekgsU0FBUyxDQUFDLG1CQUFtQixFQUFFLENBQUMsOEJBQThCLEVBQUV5SCxNQUFNLENBQUMsQ0FBQztRQUM5RSxPQUFPO1VBQUVDLE9BQU8sRUFBRTtRQUFLLENBQUM7TUFDNUIsQ0FBQyxDQUFDLE9BQU9FLGFBQWEsRUFBRTtRQUNwQnRJLE9BQU8sQ0FBQ0csS0FBSyxDQUFDLG9EQUFvRCxFQUFFbUksYUFBYSxDQUFDO1FBQ2xGLE1BQU1uSSxLQUFLLENBQUMsQ0FBQztNQUNqQjtJQUNKO0VBQ0osQ0FBQztFQUVEO0VBQ0FzSSxVQUFVLEVBQUUsTUFBQUEsQ0FBQSxLQUFZO0lBQ3BCLE9BQU8vSCxTQUFTLENBQUMsbUJBQW1CLEVBQUUsRUFBRSxDQUFDO0VBQzdDLENBQUM7RUFFRGdJLFlBQVksRUFBRSxNQUFBQSxDQUFBLEtBQVk7SUFDdEIsT0FBT2hJLFNBQVMsQ0FBQyxxQkFBcUIsRUFBRSxFQUFFLENBQUM7RUFDL0M7QUFDSixDQUFDLENBQUM7O0FBRUY7QUFDQWlJLE1BQU0sQ0FBQ0MsZ0JBQWdCLENBQUMsUUFBUSxFQUFFNUcscUJBQXFCLENBQUMiLCJpZ25vcmVMaXN0IjpbXX0=