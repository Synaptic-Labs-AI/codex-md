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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjb250ZXh0QnJpZGdlIiwiaXBjUmVuZGVyZXIiLCJyZXF1aXJlIiwiY29uc29sZSIsImxvZyIsIl9fZmlsZW5hbWUiLCJlcnJvciIsIm1lc3NhZ2UiLCJpc0FwcFJlYWR5IiwicGVuZGluZ0NhbGxzIiwiTWFwIiwicmVhZHlDYWxsYmFjayIsIkNBTExfVElNRU9VVCIsInF1ZXVlQ2FsbCIsImNoYW5uZWwiLCJhcmdzIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJpbnZva2UiLCJ0aGVuIiwiY2F0Y2giLCJpZCIsIkRhdGUiLCJub3ciLCJ0b1N0cmluZyIsInNldCIsInNldFRpbWVvdXQiLCJoYXMiLCJnZXQiLCJkZWxldGUiLCJFcnJvciIsInByb2Nlc3NQZW5kaW5nQ2FsbHMiLCJzaXplIiwiZmluYWxseSIsImNsZWFudXBFdmVudExpc3RlbmVycyIsInJlbW92ZUFsbExpc3RlbmVycyIsIm9uIiwiXyIsImV4cG9zZUluTWFpbldvcmxkIiwiaXNSZWFkeSIsIm9uUmVhZHkiLCJjYWxsYmFjayIsImNvbnZlcnQiLCJpbnB1dCIsIm9wdGlvbnMiLCJidWZmZXIiLCJBcnJheUJ1ZmZlciIsIkJ1ZmZlciIsImZyb20iLCJnZXRSZXN1bHQiLCJwYXRoIiwiY2FuY2VsUmVxdWVzdHMiLCJfcmVkaXJlY3RUb0NvbnZlcnQiLCJ0eXBlIiwiY29udmVydFVybCIsInVybCIsImlzV2ViIiwiY29udmVydFBhcmVudFVybCIsImNvbnZlcnRZb3V0dWJlIiwiY29udmVydEZpbGUiLCJjYW5jZWxQYXJlbnRVcmxDb252ZXJzaW9uIiwiY29udmVyc2lvbklkIiwib25Db252ZXJzaW9uUHJvZ3Jlc3MiLCJwcm9ncmVzcyIsInJlbW92ZUxpc3RlbmVyIiwib25Db252ZXJzaW9uU3RhdHVzIiwic3RhdHVzIiwib25Db252ZXJzaW9uQ29tcGxldGUiLCJyZXN1bHQiLCJvbkNvbnZlcnNpb25FcnJvciIsIm9mZkNvbnZlcnNpb25Qcm9ncmVzcyIsImxpc3RlbmVyIiwib2ZmQ29udmVyc2lvblN0YXR1cyIsIm9mZkNvbnZlcnNpb25Db21wbGV0ZSIsIm9mZkNvbnZlcnNpb25FcnJvciIsIm9uUGFyZW50VXJsUHJvZ3Jlc3MiLCJkYXRhIiwib25QYXJlbnRVcmxTdGFydGVkIiwib25QYXJlbnRVcmxDYW5jZWxsaW5nIiwic2VsZWN0RmlsZXMiLCJzZWxlY3REaXJlY3RvcnkiLCJzZWxlY3RJbnB1dERpcmVjdG9yeSIsInNlbGVjdE91dHB1dCIsImxpc3REaXJlY3RvcnlEZXRhaWxlZCIsInNob3dJdGVtSW5Gb2xkZXIiLCJnZXRTdGF0cyIsInJlYWRGaWxlIiwid3JpdGVGaWxlIiwiY29udGVudCIsImNyZWF0ZURpcmVjdG9yeSIsIm1vdmVJdGVtIiwic291cmNlUGF0aCIsImRlc3RQYXRoIiwiZGVsZXRlSXRlbSIsInJlY3Vyc2l2ZSIsIm9wZW5FeHRlcm5hbCIsImdldFNldHRpbmciLCJrZXkiLCJzZXRTZXR0aW5nIiwidmFsdWUiLCJzZXRPY3JFbmFibGVkIiwiZW5hYmxlZCIsImJvb2xFbmFibGVkIiwiQm9vbGVhbiIsImdldE9jckVuYWJsZWQiLCJzYXZlQXBpS2V5IiwicHJvdmlkZXIiLCJjaGVja0FwaUtleUV4aXN0cyIsImRlbGV0ZUFwaUtleSIsInZhbGlkYXRlQXBpS2V5IiwiZ2V0QXBpS2V5IiwiZ2V0T2ZmbGluZVN0YXR1cyIsImdldFF1ZXVlZE9wZXJhdGlvbnMiLCJxdWV1ZU9wZXJhdGlvbiIsIm9wZXJhdGlvbiIsImNhY2hlRGF0YSIsImdldENhY2hlZERhdGEiLCJtYXhBZ2UiLCJpbnZhbGlkYXRlQ2FjaGUiLCJjbGVhckNhY2hlIiwib25PZmZsaW5lRXZlbnQiLCJvbkZpbGVEcm9wcGVkIiwiZmlsZXMiLCJ0cmFuc2NyaWJlQXVkaW8iLCJmaWxlUGF0aCIsInRyYW5zY3JpYmVWaWRlbyIsImdldFRyYW5zY3JpcHRpb25Nb2RlbCIsInNldFRyYW5zY3JpcHRpb25Nb2RlbCIsIm1vZGVsIiwiZ2V0RGVlcGdyYW1BcGlLZXkiLCJoYXNLZXkiLCJkaXJlY3RLZXkiLCJuZXN0ZWRLZXkiLCJhcGlLZXkiLCJzdWNjZXNzIiwic291cmNlIiwiZmFsbGJhY2tFcnJvciIsInNldERlZXBncmFtQXBpS2V5IiwiYXBpS2V5RXJyb3IiLCJnZXRWZXJzaW9uIiwiY2hlY2tVcGRhdGVzIiwid2luZG93IiwiYWRkRXZlbnRMaXN0ZW5lciJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9lbGVjdHJvbi9wcmVsb2FkLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBQcmVsb2FkIFNjcmlwdFxyXG4gKiBFeHBvc2VzIHNwZWNpZmljIEVsZWN0cm9uIEFQSXMgdG8gdGhlIHJlbmRlcmVyIHByb2Nlc3NcclxuICogXHJcbiAqIFRoaXMgc2NyaXB0IGNyZWF0ZXMgYSBzZWN1cmUgYnJpZGdlIGJldHdlZW4gdGhlIHJlbmRlcmVyIHByb2Nlc3MgYW5kIHRoZSBtYWluIHByb2Nlc3MsXHJcbiAqIGV4cG9zaW5nIG9ubHkgdGhlIG5lY2Vzc2FyeSBmdW5jdGlvbmFsaXR5IHdoaWxlIG1haW50YWluaW5nIHNlY3VyaXR5IHRocm91Z2ggY29udGV4dElzb2xhdGlvbi5cclxuICogXHJcbiAqIEluY2x1ZGVzIGluaXRpYWxpemF0aW9uIHRyYWNraW5nIGFuZCBJUEMgY2FsbCBxdWV1ZWluZyB0byBlbnN1cmUgcmVsaWFibGUgY29tbXVuaWNhdGlvbi5cclxuICovXHJcblxyXG5jb25zdCB7IGNvbnRleHRCcmlkZ2UsIGlwY1JlbmRlcmVyIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5cclxuLy8gQWRkIGRpcmVjdCBjb25zb2xlIG91dHB1dCBmb3IgZGVidWdnaW5nXHJcbmNvbnNvbGUubG9nKCc9PT09PT0gUFJFTE9BRCBTQ1JJUFQgU1RBUlRJTkcgPT09PT09Jyk7XHJcbnRyeSB7XHJcbiAgICAvLyBVc2UgX19maWxlbmFtZSBpZiBhdmFpbGFibGUgKENvbW1vbkpTKSwgb3RoZXJ3aXNlIGhhbmRsZSBncmFjZWZ1bGx5XHJcbiAgICBjb25zb2xlLmxvZygnUHJlbG9hZCBzY3JpcHQgcGF0aDonLCB0eXBlb2YgX19maWxlbmFtZSAhPT0gJ3VuZGVmaW5lZCcgPyBfX2ZpbGVuYW1lIDogJ1BhdGggbm90IGF2YWlsYWJsZScpO1xyXG59IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5sb2coJ1VuYWJsZSB0byBkZXRlcm1pbmUgcHJlbG9hZCBzY3JpcHQgcGF0aDonLCBlcnJvci5tZXNzYWdlKTtcclxufVxyXG5jb25zb2xlLmxvZygnPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09Jyk7XHJcblxyXG4vLyBJbml0aWFsaXphdGlvbiB0cmFja2luZ1xyXG5sZXQgaXNBcHBSZWFkeSA9IGZhbHNlO1xyXG5jb25zdCBwZW5kaW5nQ2FsbHMgPSBuZXcgTWFwKCk7XHJcbmxldCByZWFkeUNhbGxiYWNrID0gbnVsbDtcclxuY29uc3QgQ0FMTF9USU1FT1VUID0gMTAwMDA7IC8vIDEwIHNlY29uZCB0aW1lb3V0IGZvciBxdWV1ZWQgY2FsbHNcclxuXHJcbi8qKlxyXG4gKiBRdWV1ZSBhbiBJUEMgY2FsbCB1bnRpbCBhcHAgaXMgcmVhZHlcclxuICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWwgLSBJUEMgY2hhbm5lbCBuYW1lXHJcbiAqIEBwYXJhbSB7QXJyYXl9IGFyZ3MgLSBDYWxsIGFyZ3VtZW50c1xyXG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gUmVzb2x2ZXMgd2hlbiBjYWxsIGNvbXBsZXRlc1xyXG4gKi9cclxuZnVuY3Rpb24gcXVldWVDYWxsKGNoYW5uZWwsIGFyZ3MpIHtcclxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgICAgaWYgKGlzQXBwUmVhZHkpIHtcclxuICAgICAgICAgICAgLy8gQXBwIGlzIHJlYWR5LCBtYWtlIGNhbGwgaW1tZWRpYXRlbHlcclxuICAgICAgICAgICAgaXBjUmVuZGVyZXIuaW52b2tlKGNoYW5uZWwsIC4uLmFyZ3MpXHJcbiAgICAgICAgICAgICAgICAudGhlbihyZXNvbHZlKVxyXG4gICAgICAgICAgICAgICAgLmNhdGNoKHJlamVjdCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgLy8gUXVldWUgdGhlIGNhbGxcclxuICAgICAgICAgICAgY29uc3QgaWQgPSBEYXRlLm5vdygpLnRvU3RyaW5nKCk7XHJcbiAgICAgICAgICAgIHBlbmRpbmdDYWxscy5zZXQoaWQsIHsgY2hhbm5lbCwgYXJncywgcmVzb2x2ZSwgcmVqZWN0IH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gU2V0IHRpbWVvdXQgZm9yIHF1ZXVlZCBjYWxsc1xyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChwZW5kaW5nQ2FsbHMuaGFzKGlkKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHsgcmVqZWN0IH0gPSBwZW5kaW5nQ2FsbHMuZ2V0KGlkKTtcclxuICAgICAgICAgICAgICAgICAgICBwZW5kaW5nQ2FsbHMuZGVsZXRlKGlkKTtcclxuICAgICAgICAgICAgICAgICAgICByZWplY3QobmV3IEVycm9yKGBJUEMgY2FsbCB0byAke2NoYW5uZWx9IHRpbWVkIG91dCB3YWl0aW5nIGZvciBhcHAgcmVhZHlgKSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sIENBTExfVElNRU9VVCk7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBQcm9jZXNzIGFueSBxdWV1ZWQgY2FsbHMgb25jZSBhcHAgaXMgcmVhZHlcclxuICovXHJcbmZ1bmN0aW9uIHByb2Nlc3NQZW5kaW5nQ2FsbHMoKSB7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+TqCBQcm9jZXNzaW5nICR7cGVuZGluZ0NhbGxzLnNpemV9IHBlbmRpbmcgSVBDIGNhbGxzYCk7XHJcbiAgICBmb3IgKGNvbnN0IFtpZCwgeyBjaGFubmVsLCBhcmdzLCByZXNvbHZlLCByZWplY3QgfV0gb2YgcGVuZGluZ0NhbGxzKSB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIuaW52b2tlKGNoYW5uZWwsIC4uLmFyZ3MpXHJcbiAgICAgICAgICAgIC50aGVuKHJlc29sdmUpXHJcbiAgICAgICAgICAgIC5jYXRjaChyZWplY3QpXHJcbiAgICAgICAgICAgIC5maW5hbGx5KCgpID0+IHBlbmRpbmdDYWxscy5kZWxldGUoaWQpKTtcclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIENsZWFuIHVwIGV2ZW50IGxpc3RlbmVycyBvbiB3aW5kb3cgdW5sb2FkXHJcbiAqL1xyXG5mdW5jdGlvbiBjbGVhbnVwRXZlbnRMaXN0ZW5lcnMoKSB7XHJcbiAgICAvLyBSZW1vdmUgYWxsIGV2ZW50IGxpc3RlbmVyc1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdjb2RleDpjb252ZXJ0OnByb2dyZXNzJyk7XHJcbiAgICBpcGNSZW5kZXJlci5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2NvZGV4OmNvbnZlcnQ6c3RhdHVzJyk7XHJcbiAgICBpcGNSZW5kZXJlci5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2NvZGV4OmNvbnZlcnQ6Y29tcGxldGUnKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygnY29kZXg6Y29udmVydDplcnJvcicpO1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdjb2RleDpvZmZsaW5lOmV2ZW50Jyk7XHJcbiAgICBpcGNSZW5kZXJlci5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2NvZGV4OmZpbGUtZHJvcHBlZCcpO1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdjb2RleDp3YXRjaDpldmVudCcpO1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdhcHA6cmVhZHknKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygnYXBwOmVycm9yJyk7XHJcbiAgICAvLyBQYXJlbnQgVVJMIHNwZWNpZmljIGV2ZW50c1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdwYXJlbnQtdXJsOmNvbnZlcnNpb24tcHJvZ3Jlc3MnKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygncGFyZW50LXVybDpjb252ZXJzaW9uLXN0YXJ0ZWQnKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygncGFyZW50LXVybDpjb252ZXJzaW9uLWNhbmNlbGxpbmcnKTtcclxufVxyXG5cclxuLy8gSGFuZGxlIGFwcCByZWFkeSBldmVudFxyXG5pcGNSZW5kZXJlci5vbignYXBwOnJlYWR5JywgKCkgPT4ge1xyXG4gICAgY29uc29sZS5sb2coJ/CfmoAgQXBwIHJlYWR5IGV2ZW50IHJlY2VpdmVkJyk7XHJcbiAgICBpc0FwcFJlYWR5ID0gdHJ1ZTtcclxuICAgIHByb2Nlc3NQZW5kaW5nQ2FsbHMoKTtcclxuICAgIGlmIChyZWFkeUNhbGxiYWNrKSB7XHJcbiAgICAgICAgcmVhZHlDYWxsYmFjaygpO1xyXG4gICAgfVxyXG59KTtcclxuXHJcbi8vIEhhbmRsZSBhcHAgZXJyb3JzXHJcbmlwY1JlbmRlcmVyLm9uKCdhcHA6ZXJyb3InLCAoXywgZXJyb3IpID0+IHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBBcHAgZXJyb3I6JywgZXJyb3IpO1xyXG59KTtcclxuXHJcbi8vIEV4cG9zZSBwcm90ZWN0ZWQgbWV0aG9kcyB0byByZW5kZXJlciBwcm9jZXNzXHJcbmNvbnRleHRCcmlkZ2UuZXhwb3NlSW5NYWluV29ybGQoJ2VsZWN0cm9uJywge1xyXG4gICAgLy8gQXBwIFN0YXR1c1xyXG4gICAgaXNSZWFkeTogKCkgPT4gaXNBcHBSZWFkeSxcclxuICAgIFxyXG4gICAgb25SZWFkeTogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaWYgKGlzQXBwUmVhZHkpIHtcclxuICAgICAgICAgICAgY2FsbGJhY2soKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZWFkeUNhbGxiYWNrID0gY2FsbGJhY2s7XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICAvLz09PSBDb252ZXJzaW9uIE9wZXJhdGlvbnMgPT09Ly9cclxuICAgIGNvbnZlcnQ6IGFzeW5jIChpbnB1dCwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgIC8vIEhhbmRsZSBBcnJheUJ1ZmZlciBjb252ZXJzaW9uIHRvIEJ1ZmZlciBmb3IgSVBDXHJcbiAgICAgICAgaWYgKG9wdGlvbnMuYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcclxuICAgICAgICAgICAgY29uc3QgYnVmZmVyID0gQnVmZmVyLmZyb20ob3B0aW9ucy5idWZmZXIpO1xyXG4gICAgICAgICAgICBvcHRpb25zLmJ1ZmZlciA9IGJ1ZmZlcjtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpmaWxlJywgW2lucHV0LCBvcHRpb25zXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBnZXRSZXN1bHQ6IGFzeW5jIChwYXRoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpnZXQtcmVzdWx0JywgW3BhdGhdKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGNhbmNlbFJlcXVlc3RzOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpjYW5jZWwnLCBbXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvLyBIZWxwZXIgbWV0aG9kIHRvIGxvZyBhbmQgcmVkaXJlY3QgdG8gZ2VuZXJpYyBjb252ZXJ0IG1ldGhvZFxyXG4gICAgX3JlZGlyZWN0VG9Db252ZXJ0OiBhc3luYyAoaW5wdXQsIG9wdGlvbnMsIHR5cGUpID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgUmVkaXJlY3RpbmcgJHt0eXBlfSBjb252ZXJzaW9uIHRvIGdlbmVyaWMgY29udmVydCBtZXRob2RgKTtcclxuICAgICAgICBvcHRpb25zLnR5cGUgPSB0eXBlO1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmNvbnZlcnQ6ZmlsZScsIFtpbnB1dCwgb3B0aW9uc10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy8gU3BlY2lhbGl6ZWQgY29udmVyc2lvbiBtZXRob2RzIHRoYXQgcmVkaXJlY3QgdG8gZ2VuZXJpYyBjb252ZXJ0XHJcbiAgICBjb252ZXJ0VXJsOiBhc3luYyAodXJsLCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgb3B0aW9ucy50eXBlID0gJ3VybCc7XHJcbiAgICAgICAgb3B0aW9ucy5pc1dlYiA9IHRydWU7XHJcbiAgICAgICAgY29uc29sZS5sb2coYENvbnZlcnRpbmcgVVJMOiAke3VybH0gKHJlZGlyZWN0aW5nIHRvIGdlbmVyaWMgY29udmVydClgLCBvcHRpb25zKTtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpjb252ZXJ0OmZpbGUnLCBbdXJsLCBvcHRpb25zXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBjb252ZXJ0UGFyZW50VXJsOiBhc3luYyAodXJsLCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgb3B0aW9ucy50eXBlID0gJ3BhcmVudHVybCc7XHJcbiAgICAgICAgb3B0aW9ucy5pc1dlYiA9IHRydWU7XHJcbiAgICAgICAgY29uc29sZS5sb2coYENvbnZlcnRpbmcgUGFyZW50IFVSTDogJHt1cmx9IChyZWRpcmVjdGluZyB0byBnZW5lcmljIGNvbnZlcnQpYCwgb3B0aW9ucyk7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpmaWxlJywgW3VybCwgb3B0aW9uc10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgY29udmVydFlvdXR1YmU6IGFzeW5jICh1cmwsIG9wdGlvbnMpID0+IHtcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICBvcHRpb25zLnR5cGUgPSAneW91dHViZSc7XHJcbiAgICAgICAgb3B0aW9ucy5pc1dlYiA9IHRydWU7XHJcbiAgICAgICAgY29uc29sZS5sb2coYENvbnZlcnRpbmcgWW91VHViZTogJHt1cmx9IChyZWRpcmVjdGluZyB0byBnZW5lcmljIGNvbnZlcnQpYCwgb3B0aW9ucyk7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpmaWxlJywgW3VybCwgb3B0aW9uc10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgY29udmVydEZpbGU6IGFzeW5jIChwYXRoLCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgY29uc29sZS5sb2coYENvbnZlcnRpbmcgZmlsZTogJHtwYXRofSAocmVkaXJlY3RpbmcgdG8gZ2VuZXJpYyBjb252ZXJ0KWAsIG9wdGlvbnMpO1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmNvbnZlcnQ6ZmlsZScsIFtwYXRoLCBvcHRpb25zXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIENhbmNlbCBvbmdvaW5nIGNvbnZlcnNpb24gcmVxdWVzdHNcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59XHJcbiAgICAgKi9cclxuICAgIGNhbmNlbFJlcXVlc3RzOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpjYW5jZWwnLCBbXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIENhbmNlbCBwYXJlbnQgVVJMIGNvbnZlcnNpb25cclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIElEIHRvIGNhbmNlbFxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn1cclxuICAgICAqL1xyXG4gICAgY2FuY2VsUGFyZW50VXJsQ29udmVyc2lvbjogYXN5bmMgKGNvbnZlcnNpb25JZCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvbnZlcnQ6cGFyZW50LXVybDpjYW5jZWwnLCBbeyBjb252ZXJzaW9uSWQgfV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy89PT0gQ29udmVyc2lvbiBFdmVudCBIYW5kbGVycyA9PT0vL1xyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlZ2lzdGVyIGNhbGxiYWNrIGZvciBjb252ZXJzaW9uIHByb2dyZXNzXHJcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayAtIFByb2dyZXNzIGNhbGxiYWNrXHJcbiAgICAgKi9cclxuICAgIG9uQ29udmVyc2lvblByb2dyZXNzOiAoY2FsbGJhY2spID0+IHtcclxuICAgICAgICBpcGNSZW5kZXJlci5vbignY29kZXg6Y29udmVydDpwcm9ncmVzcycsIChfLCBwcm9ncmVzcykgPT4gY2FsbGJhY2socHJvZ3Jlc3MpKTtcclxuICAgICAgICAvLyBSZXR1cm4gY2xlYW51cCBmdW5jdGlvblxyXG4gICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpjb252ZXJ0OnByb2dyZXNzJywgY2FsbGJhY2spO1xyXG4gICAgICAgIH07XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlZ2lzdGVyIGNhbGxiYWNrIGZvciBjb252ZXJzaW9uIHN0YXR1c1xyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgLSBTdGF0dXMgY2FsbGJhY2tcclxuICAgICAqL1xyXG4gICAgb25Db252ZXJzaW9uU3RhdHVzOiAoY2FsbGJhY2spID0+IHtcclxuICAgICAgICBpcGNSZW5kZXJlci5vbignY29kZXg6Y29udmVydDpzdGF0dXMnLCAoXywgc3RhdHVzKSA9PiBjYWxsYmFjayhzdGF0dXMpKTtcclxuICAgICAgICAvLyBSZXR1cm4gY2xlYW51cCBmdW5jdGlvblxyXG4gICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpjb252ZXJ0OnN0YXR1cycsIGNhbGxiYWNrKTtcclxuICAgICAgICB9O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWdpc3RlciBjYWxsYmFjayBmb3IgY29udmVyc2lvbiBjb21wbGV0aW9uXHJcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayAtIENvbXBsZXRpb24gY2FsbGJhY2tcclxuICAgICAqL1xyXG4gICAgb25Db252ZXJzaW9uQ29tcGxldGU6IChjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLm9uKCdjb2RleDpjb252ZXJ0OmNvbXBsZXRlJywgKF8sIHJlc3VsdCkgPT4gY2FsbGJhY2socmVzdWx0KSk7XHJcbiAgICAgICAgLy8gUmV0dXJuIGNsZWFudXAgZnVuY3Rpb25cclxuICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcignY29kZXg6Y29udmVydDpjb21wbGV0ZScsIGNhbGxiYWNrKTtcclxuICAgICAgICB9O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWdpc3RlciBjYWxsYmFjayBmb3IgY29udmVyc2lvbiBlcnJvcnNcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIC0gRXJyb3IgY2FsbGJhY2tcclxuICAgICAqL1xyXG4gICAgb25Db252ZXJzaW9uRXJyb3I6IChjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLm9uKCdjb2RleDpjb252ZXJ0OmVycm9yJywgKF8sIGVycm9yKSA9PiBjYWxsYmFjayhlcnJvcikpO1xyXG4gICAgICAgIC8vIFJldHVybiBjbGVhbnVwIGZ1bmN0aW9uXHJcbiAgICAgICAgcmV0dXJuICgpID0+IHtcclxuICAgICAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4OmNvbnZlcnQ6ZXJyb3InLCBjYWxsYmFjayk7XHJcbiAgICAgICAgfTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUmVtb3ZlIGNvbnZlcnNpb24gcHJvZ3Jlc3MgbGlzdGVuZXJcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyIC0gUHJvZ3Jlc3MgbGlzdGVuZXIgdG8gcmVtb3ZlXHJcbiAgICAgKi9cclxuICAgIG9mZkNvbnZlcnNpb25Qcm9ncmVzczogKGxpc3RlbmVyKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4OmNvbnZlcnQ6cHJvZ3Jlc3MnLCBsaXN0ZW5lcik7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlbW92ZSBjb252ZXJzaW9uIHN0YXR1cyBsaXN0ZW5lclxyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gbGlzdGVuZXIgLSBTdGF0dXMgbGlzdGVuZXIgdG8gcmVtb3ZlXHJcbiAgICAgKi9cclxuICAgIG9mZkNvbnZlcnNpb25TdGF0dXM6IChsaXN0ZW5lcikgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpjb252ZXJ0OnN0YXR1cycsIGxpc3RlbmVyKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUmVtb3ZlIGNvbnZlcnNpb24gY29tcGxldGUgbGlzdGVuZXJcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyIC0gQ29tcGxldGUgbGlzdGVuZXIgdG8gcmVtb3ZlXHJcbiAgICAgKi9cclxuICAgIG9mZkNvbnZlcnNpb25Db21wbGV0ZTogKGxpc3RlbmVyKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4OmNvbnZlcnQ6Y29tcGxldGUnLCBsaXN0ZW5lcik7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlbW92ZSBjb252ZXJzaW9uIGVycm9yIGxpc3RlbmVyXHJcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBsaXN0ZW5lciAtIEVycm9yIGxpc3RlbmVyIHRvIHJlbW92ZVxyXG4gICAgICovXHJcbiAgICBvZmZDb252ZXJzaW9uRXJyb3I6IChsaXN0ZW5lcikgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpjb252ZXJ0OmVycm9yJywgbGlzdGVuZXIpO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy89PT0gUGFyZW50IFVSTCBDb252ZXJzaW9uIEV2ZW50cyA9PT0vL1xyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlZ2lzdGVyIGNhbGxiYWNrIGZvciBwYXJlbnQgVVJMIGNvbnZlcnNpb24gcHJvZ3Jlc3NcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIC0gUHJvZ3Jlc3MgY2FsbGJhY2tcclxuICAgICAqL1xyXG4gICAgb25QYXJlbnRVcmxQcm9ncmVzczogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIub24oJ3BhcmVudC11cmw6Y29udmVyc2lvbi1wcm9ncmVzcycsIChfLCBkYXRhKSA9PiBjYWxsYmFjayhkYXRhKSk7XHJcbiAgICAgICAgLy8gUmV0dXJuIGNsZWFudXAgZnVuY3Rpb25cclxuICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcigncGFyZW50LXVybDpjb252ZXJzaW9uLXByb2dyZXNzJywgY2FsbGJhY2spO1xyXG4gICAgICAgIH07XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlZ2lzdGVyIGNhbGxiYWNrIGZvciBwYXJlbnQgVVJMIGNvbnZlcnNpb24gc3RhcnRlZFxyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgLSBTdGFydGVkIGNhbGxiYWNrXHJcbiAgICAgKi9cclxuICAgIG9uUGFyZW50VXJsU3RhcnRlZDogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIub24oJ3BhcmVudC11cmw6Y29udmVyc2lvbi1zdGFydGVkJywgKF8sIGRhdGEpID0+IGNhbGxiYWNrKGRhdGEpKTtcclxuICAgICAgICAvLyBSZXR1cm4gY2xlYW51cCBmdW5jdGlvblxyXG4gICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdwYXJlbnQtdXJsOmNvbnZlcnNpb24tc3RhcnRlZCcsIGNhbGxiYWNrKTtcclxuICAgICAgICB9O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWdpc3RlciBjYWxsYmFjayBmb3IgcGFyZW50IFVSTCBjb252ZXJzaW9uIGNhbmNlbGxpbmdcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIC0gQ2FuY2VsbGluZyBjYWxsYmFja1xyXG4gICAgICovXHJcbiAgICBvblBhcmVudFVybENhbmNlbGxpbmc6IChjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLm9uKCdwYXJlbnQtdXJsOmNvbnZlcnNpb24tY2FuY2VsbGluZycsIChfLCBkYXRhKSA9PiBjYWxsYmFjayhkYXRhKSk7XHJcbiAgICAgICAgLy8gUmV0dXJuIGNsZWFudXAgZnVuY3Rpb25cclxuICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcigncGFyZW50LXVybDpjb252ZXJzaW9uLWNhbmNlbGxpbmcnLCBjYWxsYmFjayk7XHJcbiAgICAgICAgfTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IEZpbGUgU3lzdGVtIE9wZXJhdGlvbnMgPT09Ly9cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBTZWxlY3QgZmlsZXMgZm9yIGNvbnZlcnNpb25cclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gU2VsZWN0aW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgc2VsZWN0RmlsZXM6IGFzeW5jIChvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6ZnM6c2VsZWN0LWZpbGVzJywgb3B0aW9ucyk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFNlbGVjdCBkaXJlY3RvcnkgZm9yIG91dHB1dFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBTZWxlY3Rpb24gb3B0aW9uc1xyXG4gICAgICovXHJcbiAgICBzZWxlY3REaXJlY3Rvcnk6IGFzeW5jIChvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6ZnM6c2VsZWN0LWRpcmVjdG9yeScsIG9wdGlvbnMpO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBTZWxlY3QgaW5wdXQgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIFNlbGVjdGlvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIHNlbGVjdElucHV0RGlyZWN0b3J5OiBhc3luYyAob3B0aW9ucykgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnNlbGVjdC1pbnB1dC1kaXJlY3RvcnknLCBvcHRpb25zKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogU2VsZWN0IG91dHB1dCBkaXJlY3RvcnlcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gU2VsZWN0aW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgc2VsZWN0T3V0cHV0OiBhc3luYyAob3B0aW9ucykgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnNlbGVjdC1vdXRwdXQnLCBvcHRpb25zKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogTGlzdCBkaXJlY3RvcnkgY29udGVudHNcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRGlyZWN0b3J5IHBhdGhcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gTGlzdGluZyBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIGxpc3REaXJlY3RvcnlEZXRhaWxlZDogYXN5bmMgKHBhdGgsIG9wdGlvbnMpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczpsaXN0LWRpcmVjdG9yeScsIHsgcGF0aCwgLi4ub3B0aW9ucyB9KTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogU2hvdyBpdGVtIGluIGZvbGRlclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBJdGVtIHBhdGhcclxuICAgICAqL1xyXG4gICAgc2hvd0l0ZW1JbkZvbGRlcjogYXN5bmMgKHBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpzaG93LWl0ZW0taW4tZm9sZGVyJywgcGF0aCk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIEdldCBmaWxlIG9yIGRpcmVjdG9yeSBzdGF0c1xyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBQYXRoIHRvIGNoZWNrXHJcbiAgICAgKi9cclxuICAgIGdldFN0YXRzOiBhc3luYyAocGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnN0YXRzJywgeyBwYXRoIH0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWFkIGZpbGUgY29udGVudHNcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRmlsZSBwYXRoXHJcbiAgICAgKi9cclxuICAgIHJlYWRGaWxlOiBhc3luYyAocGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnJlYWQnLCB7IHBhdGggfSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFdyaXRlIGNvbnRlbnQgdG8gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBGaWxlIHBhdGhcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfEJ1ZmZlcn0gY29udGVudCAtIEZpbGUgY29udGVudFxyXG4gICAgICovXHJcbiAgICB3cml0ZUZpbGU6IGFzeW5jIChwYXRoLCBjb250ZW50KSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6ZnM6d3JpdGUnLCB7IHBhdGgsIGNvbnRlbnQgfSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIENyZWF0ZSBkaXJlY3RvcnlcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRGlyZWN0b3J5IHBhdGhcclxuICAgICAqL1xyXG4gICAgY3JlYXRlRGlyZWN0b3J5OiBhc3luYyAocGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOm1rZGlyJywgeyBwYXRoIH0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBNb3ZlIGZpbGUgb3IgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc291cmNlUGF0aCAtIFNvdXJjZSBwYXRoXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZGVzdFBhdGggLSBEZXN0aW5hdGlvbiBwYXRoXHJcbiAgICAgKi9cclxuICAgIG1vdmVJdGVtOiBhc3luYyAoc291cmNlUGF0aCwgZGVzdFBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczptb3ZlJywgeyBzb3VyY2VQYXRoLCBkZXN0UGF0aCB9KTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogRGVsZXRlIGZpbGUgb3IgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIFBhdGggdG8gZGVsZXRlXHJcbiAgICAgKiBAcGFyYW0ge2Jvb2xlYW59IHJlY3Vyc2l2ZSAtIFdoZXRoZXIgdG8gZGVsZXRlIHJlY3Vyc2l2ZWx5XHJcbiAgICAgKi9cclxuICAgIGRlbGV0ZUl0ZW06IGFzeW5jIChwYXRoLCByZWN1cnNpdmUpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczpkZWxldGUnLCB7IHBhdGgsIHJlY3Vyc2l2ZSB9KTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogT3BlbiBleHRlcm5hbCBVUkwgb3IgZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIFVSTCBvciBmaWxlIHBhdGggdG8gb3BlblxyXG4gICAgICovXHJcbiAgICBvcGVuRXh0ZXJuYWw6IGFzeW5jICh1cmwpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpvcGVuLWV4dGVybmFsJywgdXJsKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IFNldHRpbmdzIE1hbmFnZW1lbnQgPT09Ly9cclxuICAgIGdldFNldHRpbmc6IGFzeW5jIChrZXkpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpnZXQtc2V0dGluZycsIFtrZXldKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIHNldFNldHRpbmc6IGFzeW5jIChrZXksIHZhbHVlKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6c2V0LXNldHRpbmcnLCBba2V5LCB2YWx1ZV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy8gT0NSIHNwZWNpZmljIHNldHRpbmdzXHJcbiAgICBzZXRPY3JFbmFibGVkOiBhc3luYyAoeyBlbmFibGVkIH0pID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW1ByZWxvYWRdIFNldHRpbmcgT0NSIGVuYWJsZWQgdG86ICR7ZW5hYmxlZH0gKHR5cGU6ICR7dHlwZW9mIGVuYWJsZWR9KWApO1xyXG4gICAgICAgIC8vIEVuc3VyZSBlbmFibGVkIGlzIGEgYm9vbGVhblxyXG4gICAgICAgIGNvbnN0IGJvb2xFbmFibGVkID0gQm9vbGVhbihlbmFibGVkKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW1ByZWxvYWRdIENvbnZlcnRlZCB0byBib29sZWFuOiAke2Jvb2xFbmFibGVkfSAodHlwZTogJHt0eXBlb2YgYm9vbEVuYWJsZWR9KWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHF1ZXVlQ2FsbCgnY29kZXg6c2V0dGluZ3M6c2V0LW9jci1lbmFibGVkJywgW3sgZW5hYmxlZDogYm9vbEVuYWJsZWQgfV0pO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbUHJlbG9hZF0gUmVzdWx0IGZyb20gc2V0dGluZyBPQ1IgZW5hYmxlZDpgLCByZXN1bHQpO1xyXG4gICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBnZXRPY3JFbmFibGVkOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcXVldWVDYWxsKCdjb2RleDpzZXR0aW5nczpnZXQtb2NyLWVuYWJsZWQnLCBbXSk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtQcmVsb2FkXSBHb3QgT0NSIGVuYWJsZWQ6ICR7cmVzdWx0fSAodHlwZTogJHt0eXBlb2YgcmVzdWx0fSlgKTtcclxuICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy89PT0gQVBJIEtleSBNYW5hZ2VtZW50ID09PS8vXHJcbiAgICBzYXZlQXBpS2V5OiBhc3luYyAoa2V5LCBwcm92aWRlciA9ICdvcGVuYWknKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6YXBpa2V5OnNhdmUnLCBbeyBrZXksIHByb3ZpZGVyIH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGNoZWNrQXBpS2V5RXhpc3RzOiBhc3luYyAocHJvdmlkZXIgPSAnb3BlbmFpJykgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmFwaWtleTpleGlzdHMnLCBbeyBwcm92aWRlciB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBkZWxldGVBcGlLZXk6IGFzeW5jIChwcm92aWRlciA9ICdvcGVuYWknKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6YXBpa2V5OmRlbGV0ZScsIFt7IHByb3ZpZGVyIH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIHZhbGlkYXRlQXBpS2V5OiBhc3luYyAoa2V5LCBwcm92aWRlciA9ICdvcGVuYWknKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6YXBpa2V5OnZhbGlkYXRlJywgW3sga2V5LCBwcm92aWRlciB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBnZXRBcGlLZXk6IGFzeW5jIChwcm92aWRlciA9ICdvcGVuYWknKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6YXBpa2V5OmdldCcsIFt7IHByb3ZpZGVyIH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IE9mZmxpbmUgRnVuY3Rpb25hbGl0eSA9PT0vL1xyXG4gICAgZ2V0T2ZmbGluZVN0YXR1czogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4Om9mZmxpbmU6c3RhdHVzJywgW10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgZ2V0UXVldWVkT3BlcmF0aW9uczogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4Om9mZmxpbmU6cXVldWVkLW9wZXJhdGlvbnMnLCBbXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBxdWV1ZU9wZXJhdGlvbjogYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4Om9mZmxpbmU6cXVldWUtb3BlcmF0aW9uJywgW29wZXJhdGlvbl0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgY2FjaGVEYXRhOiBhc3luYyAoa2V5LCBkYXRhKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6b2ZmbGluZTpjYWNoZS1kYXRhJywgW3sga2V5LCBkYXRhIH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGdldENhY2hlZERhdGE6IGFzeW5jIChrZXksIG1heEFnZSkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4Om9mZmxpbmU6Z2V0LWNhY2hlZC1kYXRhJywgW3sga2V5LCBtYXhBZ2UgfV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgaW52YWxpZGF0ZUNhY2hlOiBhc3luYyAoa2V5KSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6b2ZmbGluZTppbnZhbGlkYXRlLWNhY2hlJywgW3sga2V5IH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGNsZWFyQ2FjaGU6IGFzeW5jICgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpvZmZsaW5lOmNsZWFyLWNhY2hlJywgW10pO1xyXG4gICAgfSxcclxuICAgIC8vIEV2ZW50IGhhbmRsZXJzIGRvbid0IG5lZWQgcXVldWVpbmcgc2luY2UgdGhleSBqdXN0IHJlZ2lzdGVyIGNhbGxiYWNrc1xyXG4gICAgb25PZmZsaW5lRXZlbnQ6IChjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLm9uKCdjb2RleDpvZmZsaW5lOmV2ZW50JywgKF8sIGRhdGEpID0+IGNhbGxiYWNrKGRhdGEpKTtcclxuICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcignY29kZXg6b2ZmbGluZTpldmVudCcsIGNhbGxiYWNrKTtcclxuICAgICAgICB9O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZWdpc3RlciBjYWxsYmFjayBmb3IgZmlsZSBkcm9wIGV2ZW50c1xyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgLSBGaWxlIGRyb3AgY2FsbGJhY2tcclxuICAgICAqL1xyXG4gICAgb25GaWxlRHJvcHBlZDogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIub24oJ2NvZGV4OmZpbGUtZHJvcHBlZCcsIChfLCBmaWxlcykgPT4ge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRmlsZSBkcm9wcGVkIGV2ZW50IHJlY2VpdmVkOicsIGZpbGVzKTtcclxuICAgICAgICAgICAgY2FsbGJhY2soZmlsZXMpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpmaWxlLWRyb3BwZWQnLCBjYWxsYmFjayk7XHJcbiAgICAgICAgfTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IFRyYW5zY3JpcHRpb24gPT09Ly9cclxuICAgIHRyYW5zY3JpYmVBdWRpbzogYXN5bmMgKGZpbGVQYXRoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6dHJhbnNjcmliZTphdWRpbycsIFt7IGZpbGVQYXRoIH1dKTtcclxuICAgIH0sXHJcblxyXG4gICAgdHJhbnNjcmliZVZpZGVvOiBhc3luYyAoZmlsZVBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDp0cmFuc2NyaWJlOnZpZGVvJywgW3sgZmlsZVBhdGggfV0pO1xyXG4gICAgfSxcclxuXHJcbiAgICBnZXRUcmFuc2NyaXB0aW9uTW9kZWw6IGFzeW5jICgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpnZXQtc2V0dGluZycsIFsndHJhbnNjcmlwdGlvbi5tb2RlbCddKTtcclxuICAgIH0sXHJcblxyXG4gICAgc2V0VHJhbnNjcmlwdGlvbk1vZGVsOiBhc3luYyAobW9kZWwpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpzZXQtc2V0dGluZycsIFsndHJhbnNjcmlwdGlvbi5tb2RlbCcsIG1vZGVsXSk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8vIEVuaGFuY2VkIERlZXBncmFtIEFQSSBrZXkgaGFuZGxlcnMgLSBhZGRlZCB0byBwcm92aWRlIG1vcmUgcmVsaWFibGUgQVBJIGtleSBoYW5kbGluZ1xyXG4gICAgZ2V0RGVlcGdyYW1BcGlLZXk6IGFzeW5jICgpID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZygnW1ByZWxvYWRdIEdldHRpbmcgRGVlcGdyYW0gQVBJIGtleScpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIEZpcnN0IHRyeSBkZWRpY2F0ZWQgaGFuZGxlclxyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBxdWV1ZUNhbGwoJ2NvZGV4OnRyYW5zY3JpcHRpb246Z2V0LWFwaS1rZXknLCBbXSk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbUHJlbG9hZF0gRGVlcGdyYW0gQVBJIGtleSByZXRyaWV2YWwgcmVzdWx0OicsXHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPyAocmVzdWx0Lmhhc0tleSA/ICdGb3VuZCBrZXknIDogJ05vIGtleSBmb3VuZCcpIDogJ05vIHJlc3VsdCcpO1xyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcmVsb2FkXSBFcnJvciBnZXR0aW5nIERlZXBncmFtIEFQSSBrZXk6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICAvLyBGYWxsYmFjayB0byBnZW5lcmljIHNldHRpbmdcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGRpcmVjdEtleSA9IGF3YWl0IHF1ZXVlQ2FsbCgnY29kZXg6Z2V0LXNldHRpbmcnLCBbJ2RlZXBncmFtQXBpS2V5J10pO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbmVzdGVkS2V5ID0gYXdhaXQgcXVldWVDYWxsKCdjb2RleDpnZXQtc2V0dGluZycsIFsndHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleSddKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGFwaUtleSA9IGRpcmVjdEtleSB8fCBuZXN0ZWRLZXkgfHwgJyc7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgYXBpS2V5LFxyXG4gICAgICAgICAgICAgICAgICAgIGhhc0tleTogISFhcGlLZXksXHJcbiAgICAgICAgICAgICAgICAgICAgc291cmNlOiBkaXJlY3RLZXkgPyAnZGlyZWN0JyA6IChuZXN0ZWRLZXkgPyAnbmVzdGVkJyA6ICdub25lJylcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGZhbGxiYWNrRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcmVsb2FkXSBGYWxsYmFjayBlcnJvciBnZXR0aW5nIERlZXBncmFtIEFQSSBrZXk6JywgZmFsbGJhY2tFcnJvcik7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjsgLy8gVGhyb3cgb3JpZ2luYWwgZXJyb3JcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgc2V0RGVlcGdyYW1BcGlLZXk6IGFzeW5jIChhcGlLZXkpID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZygnW1ByZWxvYWRdIFNldHRpbmcgRGVlcGdyYW0gQVBJIGtleScpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIEZpcnN0IHRyeSBkZWRpY2F0ZWQgaGFuZGxlclxyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBxdWV1ZUNhbGwoJ2NvZGV4OnRyYW5zY3JpcHRpb246c2V0LWFwaS1rZXknLCBbeyBhcGlLZXkgfV0pO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW1ByZWxvYWRdIERlZXBncmFtIEFQSSBrZXkgc2V0IHJlc3VsdDonLCByZXN1bHQpO1xyXG5cclxuICAgICAgICAgICAgLy8gQWxzbyBzZXQgdGhlIGtleSBmb3IgdGhlIEFwaUtleVNlcnZpY2UgZm9yIGJldHRlciBjb21wYXRpYmlsaXR5XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBxdWV1ZUNhbGwoJ2NvZGV4OmFwaWtleTpzYXZlJywgW3sga2V5OiBhcGlLZXksIHByb3ZpZGVyOiAnZGVlcGdyYW0nIH1dKTtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbUHJlbG9hZF0gRGVlcGdyYW0gQVBJIGtleSBhbHNvIHNhdmVkIHZpYSBBUEkga2V5IHNlcnZpY2UnKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoYXBpS2V5RXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcmVsb2FkXSBFcnJvciBzYXZpbmcgdG8gQVBJIGtleSBzZXJ2aWNlOicsIGFwaUtleUVycm9yKTtcclxuICAgICAgICAgICAgICAgIC8vIENvbnRpbnVlIGV2ZW4gaWYgdGhpcyBmYWlsc1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcmVsb2FkXSBFcnJvciBzZXR0aW5nIERlZXBncmFtIEFQSSBrZXk6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICAvLyBGYWxsYmFjayB0byBnZW5lcmljIHNldHRpbmdzXHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBxdWV1ZUNhbGwoJ2NvZGV4OnNldC1zZXR0aW5nJywgWydkZWVwZ3JhbUFwaUtleScsIGFwaUtleV0pO1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgcXVldWVDYWxsKCdjb2RleDpzZXQtc2V0dGluZycsIFsndHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleScsIGFwaUtleV0pO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgICAgICAgICB9IGNhdGNoIChmYWxsYmFja0Vycm9yKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUHJlbG9hZF0gRmFsbGJhY2sgZXJyb3Igc2V0dGluZyBEZWVwZ3JhbSBBUEkga2V5OicsIGZhbGxiYWNrRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7IC8vIFRocm93IG9yaWdpbmFsIGVycm9yXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvLz09PSBBcHBsaWNhdGlvbiA9PT0vL1xyXG4gICAgZ2V0VmVyc2lvbjogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmdldC12ZXJzaW9uJywgW10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgY2hlY2tVcGRhdGVzOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y2hlY2stdXBkYXRlcycsIFtdKTtcclxuICAgIH1cclxufSk7XHJcblxyXG4vLyBDbGVhbiB1cCB3aGVuIHdpbmRvdyB1bmxvYWRzXHJcbndpbmRvdy5hZGRFdmVudExpc3RlbmVyKCd1bmxvYWQnLCBjbGVhbnVwRXZlbnRMaXN0ZW5lcnMpO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU07RUFBRUEsYUFBYTtFQUFFQztBQUFZLENBQUMsR0FBR0MsT0FBTyxDQUFDLFVBQVUsQ0FBQzs7QUFFMUQ7QUFDQUMsT0FBTyxDQUFDQyxHQUFHLENBQUMsdUNBQXVDLENBQUM7QUFDcEQsSUFBSTtFQUNBO0VBQ0FELE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHNCQUFzQixFQUFFLE9BQU9DLFVBQVUsS0FBSyxXQUFXLEdBQUdBLFVBQVUsR0FBRyxvQkFBb0IsQ0FBQztBQUM5RyxDQUFDLENBQUMsT0FBT0MsS0FBSyxFQUFFO0VBQ1pILE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDBDQUEwQyxFQUFFRSxLQUFLLENBQUNDLE9BQU8sQ0FBQztBQUMxRTtBQUNBSixPQUFPLENBQUNDLEdBQUcsQ0FBQyxzQ0FBc0MsQ0FBQzs7QUFFbkQ7QUFDQSxJQUFJSSxVQUFVLEdBQUcsS0FBSztBQUN0QixNQUFNQyxZQUFZLEdBQUcsSUFBSUMsR0FBRyxDQUFDLENBQUM7QUFDOUIsSUFBSUMsYUFBYSxHQUFHLElBQUk7QUFDeEIsTUFBTUMsWUFBWSxHQUFHLEtBQUssQ0FBQyxDQUFDOztBQUU1QjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTQyxTQUFTQSxDQUFDQyxPQUFPLEVBQUVDLElBQUksRUFBRTtFQUM5QixPQUFPLElBQUlDLE9BQU8sQ0FBQyxDQUFDQyxPQUFPLEVBQUVDLE1BQU0sS0FBSztJQUNwQyxJQUFJVixVQUFVLEVBQUU7TUFDWjtNQUNBUCxXQUFXLENBQUNrQixNQUFNLENBQUNMLE9BQU8sRUFBRSxHQUFHQyxJQUFJLENBQUMsQ0FDL0JLLElBQUksQ0FBQ0gsT0FBTyxDQUFDLENBQ2JJLEtBQUssQ0FBQ0gsTUFBTSxDQUFDO0lBQ3RCLENBQUMsTUFBTTtNQUNIO01BQ0EsTUFBTUksRUFBRSxHQUFHQyxJQUFJLENBQUNDLEdBQUcsQ0FBQyxDQUFDLENBQUNDLFFBQVEsQ0FBQyxDQUFDO01BQ2hDaEIsWUFBWSxDQUFDaUIsR0FBRyxDQUFDSixFQUFFLEVBQUU7UUFBRVIsT0FBTztRQUFFQyxJQUFJO1FBQUVFLE9BQU87UUFBRUM7TUFBTyxDQUFDLENBQUM7O01BRXhEO01BQ0FTLFVBQVUsQ0FBQyxNQUFNO1FBQ2IsSUFBSWxCLFlBQVksQ0FBQ21CLEdBQUcsQ0FBQ04sRUFBRSxDQUFDLEVBQUU7VUFDdEIsTUFBTTtZQUFFSjtVQUFPLENBQUMsR0FBR1QsWUFBWSxDQUFDb0IsR0FBRyxDQUFDUCxFQUFFLENBQUM7VUFDdkNiLFlBQVksQ0FBQ3FCLE1BQU0sQ0FBQ1IsRUFBRSxDQUFDO1VBQ3ZCSixNQUFNLENBQUMsSUFBSWEsS0FBSyxDQUFDLGVBQWVqQixPQUFPLGtDQUFrQyxDQUFDLENBQUM7UUFDL0U7TUFDSixDQUFDLEVBQUVGLFlBQVksQ0FBQztJQUNwQjtFQUNKLENBQUMsQ0FBQztBQUNOOztBQUVBO0FBQ0E7QUFDQTtBQUNBLFNBQVNvQixtQkFBbUJBLENBQUEsRUFBRztFQUMzQjdCLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLGlCQUFpQkssWUFBWSxDQUFDd0IsSUFBSSxvQkFBb0IsQ0FBQztFQUNuRSxLQUFLLE1BQU0sQ0FBQ1gsRUFBRSxFQUFFO0lBQUVSLE9BQU87SUFBRUMsSUFBSTtJQUFFRSxPQUFPO0lBQUVDO0VBQU8sQ0FBQyxDQUFDLElBQUlULFlBQVksRUFBRTtJQUNqRVIsV0FBVyxDQUFDa0IsTUFBTSxDQUFDTCxPQUFPLEVBQUUsR0FBR0MsSUFBSSxDQUFDLENBQy9CSyxJQUFJLENBQUNILE9BQU8sQ0FBQyxDQUNiSSxLQUFLLENBQUNILE1BQU0sQ0FBQyxDQUNiZ0IsT0FBTyxDQUFDLE1BQU16QixZQUFZLENBQUNxQixNQUFNLENBQUNSLEVBQUUsQ0FBQyxDQUFDO0VBQy9DO0FBQ0o7O0FBRUE7QUFDQTtBQUNBO0FBQ0EsU0FBU2EscUJBQXFCQSxDQUFBLEVBQUc7RUFDN0I7RUFDQWxDLFdBQVcsQ0FBQ21DLGtCQUFrQixDQUFDLHdCQUF3QixDQUFDO0VBQ3hEbkMsV0FBVyxDQUFDbUMsa0JBQWtCLENBQUMsc0JBQXNCLENBQUM7RUFDdERuQyxXQUFXLENBQUNtQyxrQkFBa0IsQ0FBQyx3QkFBd0IsQ0FBQztFQUN4RG5DLFdBQVcsQ0FBQ21DLGtCQUFrQixDQUFDLHFCQUFxQixDQUFDO0VBQ3JEbkMsV0FBVyxDQUFDbUMsa0JBQWtCLENBQUMscUJBQXFCLENBQUM7RUFDckRuQyxXQUFXLENBQUNtQyxrQkFBa0IsQ0FBQyxvQkFBb0IsQ0FBQztFQUNwRG5DLFdBQVcsQ0FBQ21DLGtCQUFrQixDQUFDLG1CQUFtQixDQUFDO0VBQ25EbkMsV0FBVyxDQUFDbUMsa0JBQWtCLENBQUMsV0FBVyxDQUFDO0VBQzNDbkMsV0FBVyxDQUFDbUMsa0JBQWtCLENBQUMsV0FBVyxDQUFDO0VBQzNDO0VBQ0FuQyxXQUFXLENBQUNtQyxrQkFBa0IsQ0FBQyxnQ0FBZ0MsQ0FBQztFQUNoRW5DLFdBQVcsQ0FBQ21DLGtCQUFrQixDQUFDLCtCQUErQixDQUFDO0VBQy9EbkMsV0FBVyxDQUFDbUMsa0JBQWtCLENBQUMsa0NBQWtDLENBQUM7QUFDdEU7O0FBRUE7QUFDQW5DLFdBQVcsQ0FBQ29DLEVBQUUsQ0FBQyxXQUFXLEVBQUUsTUFBTTtFQUM5QmxDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDZCQUE2QixDQUFDO0VBQzFDSSxVQUFVLEdBQUcsSUFBSTtFQUNqQndCLG1CQUFtQixDQUFDLENBQUM7RUFDckIsSUFBSXJCLGFBQWEsRUFBRTtJQUNmQSxhQUFhLENBQUMsQ0FBQztFQUNuQjtBQUNKLENBQUMsQ0FBQzs7QUFFRjtBQUNBVixXQUFXLENBQUNvQyxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUNDLENBQUMsRUFBRWhDLEtBQUssS0FBSztFQUN0Q0gsT0FBTyxDQUFDRyxLQUFLLENBQUMsY0FBYyxFQUFFQSxLQUFLLENBQUM7QUFDeEMsQ0FBQyxDQUFDOztBQUVGO0FBQ0FOLGFBQWEsQ0FBQ3VDLGlCQUFpQixDQUFDLFVBQVUsRUFBRTtFQUN4QztFQUNBQyxPQUFPLEVBQUVBLENBQUEsS0FBTWhDLFVBQVU7RUFFekJpQyxPQUFPLEVBQUdDLFFBQVEsSUFBSztJQUNuQixJQUFJbEMsVUFBVSxFQUFFO01BQ1prQyxRQUFRLENBQUMsQ0FBQztJQUNkLENBQUMsTUFBTTtNQUNIL0IsYUFBYSxHQUFHK0IsUUFBUTtJQUM1QjtFQUNKLENBQUM7RUFFRDtFQUNBQyxPQUFPLEVBQUUsTUFBQUEsQ0FBT0MsS0FBSyxFQUFFQyxPQUFPLEtBQUs7SUFDL0I7SUFDQSxJQUFJQSxPQUFPLENBQUNDLE1BQU0sWUFBWUMsV0FBVyxFQUFFO01BQ3ZDLE1BQU1ELE1BQU0sR0FBR0UsTUFBTSxDQUFDQyxJQUFJLENBQUNKLE9BQU8sQ0FBQ0MsTUFBTSxDQUFDO01BQzFDRCxPQUFPLENBQUNDLE1BQU0sR0FBR0EsTUFBTTtJQUMzQjtJQUNBLE9BQU9qQyxTQUFTLENBQUMsb0JBQW9CLEVBQUUsQ0FBQytCLEtBQUssRUFBRUMsT0FBTyxDQUFDLENBQUM7RUFDNUQsQ0FBQztFQUVESyxTQUFTLEVBQUUsTUFBT0MsSUFBSSxJQUFLO0lBQ3ZCLE9BQU90QyxTQUFTLENBQUMsMEJBQTBCLEVBQUUsQ0FBQ3NDLElBQUksQ0FBQyxDQUFDO0VBQ3hELENBQUM7RUFFREMsY0FBYyxFQUFFLE1BQUFBLENBQUEsS0FBWTtJQUN4QixPQUFPdkMsU0FBUyxDQUFDLHNCQUFzQixFQUFFLEVBQUUsQ0FBQztFQUNoRCxDQUFDO0VBRUQ7RUFDQXdDLGtCQUFrQixFQUFFLE1BQUFBLENBQU9ULEtBQUssRUFBRUMsT0FBTyxFQUFFUyxJQUFJLEtBQUs7SUFDaERuRCxPQUFPLENBQUNDLEdBQUcsQ0FBQyxlQUFla0QsSUFBSSx1Q0FBdUMsQ0FBQztJQUN2RVQsT0FBTyxDQUFDUyxJQUFJLEdBQUdBLElBQUk7SUFDbkIsT0FBT3pDLFNBQVMsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDK0IsS0FBSyxFQUFFQyxPQUFPLENBQUMsQ0FBQztFQUM1RCxDQUFDO0VBRUQ7RUFDQVUsVUFBVSxFQUFFLE1BQUFBLENBQU9DLEdBQUcsRUFBRVgsT0FBTyxLQUFLO0lBQ2hDQSxPQUFPLEdBQUdBLE9BQU8sSUFBSSxDQUFDLENBQUM7SUFDdkJBLE9BQU8sQ0FBQ1MsSUFBSSxHQUFHLEtBQUs7SUFDcEJULE9BQU8sQ0FBQ1ksS0FBSyxHQUFHLElBQUk7SUFDcEJ0RCxPQUFPLENBQUNDLEdBQUcsQ0FBQyxtQkFBbUJvRCxHQUFHLG1DQUFtQyxFQUFFWCxPQUFPLENBQUM7SUFDL0UsT0FBT2hDLFNBQVMsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDMkMsR0FBRyxFQUFFWCxPQUFPLENBQUMsQ0FBQztFQUMxRCxDQUFDO0VBRURhLGdCQUFnQixFQUFFLE1BQUFBLENBQU9GLEdBQUcsRUFBRVgsT0FBTyxLQUFLO0lBQ3RDQSxPQUFPLEdBQUdBLE9BQU8sSUFBSSxDQUFDLENBQUM7SUFDdkJBLE9BQU8sQ0FBQ1MsSUFBSSxHQUFHLFdBQVc7SUFDMUJULE9BQU8sQ0FBQ1ksS0FBSyxHQUFHLElBQUk7SUFDcEJ0RCxPQUFPLENBQUNDLEdBQUcsQ0FBQywwQkFBMEJvRCxHQUFHLG1DQUFtQyxFQUFFWCxPQUFPLENBQUM7SUFDdEYsT0FBT2hDLFNBQVMsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDMkMsR0FBRyxFQUFFWCxPQUFPLENBQUMsQ0FBQztFQUMxRCxDQUFDO0VBRURjLGNBQWMsRUFBRSxNQUFBQSxDQUFPSCxHQUFHLEVBQUVYLE9BQU8sS0FBSztJQUNwQ0EsT0FBTyxHQUFHQSxPQUFPLElBQUksQ0FBQyxDQUFDO0lBQ3ZCQSxPQUFPLENBQUNTLElBQUksR0FBRyxTQUFTO0lBQ3hCVCxPQUFPLENBQUNZLEtBQUssR0FBRyxJQUFJO0lBQ3BCdEQsT0FBTyxDQUFDQyxHQUFHLENBQUMsdUJBQXVCb0QsR0FBRyxtQ0FBbUMsRUFBRVgsT0FBTyxDQUFDO0lBQ25GLE9BQU9oQyxTQUFTLENBQUMsb0JBQW9CLEVBQUUsQ0FBQzJDLEdBQUcsRUFBRVgsT0FBTyxDQUFDLENBQUM7RUFDMUQsQ0FBQztFQUVEZSxXQUFXLEVBQUUsTUFBQUEsQ0FBT1QsSUFBSSxFQUFFTixPQUFPLEtBQUs7SUFDbENBLE9BQU8sR0FBR0EsT0FBTyxJQUFJLENBQUMsQ0FBQztJQUN2QjFDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLG9CQUFvQitDLElBQUksbUNBQW1DLEVBQUVOLE9BQU8sQ0FBQztJQUNqRixPQUFPaEMsU0FBUyxDQUFDLG9CQUFvQixFQUFFLENBQUNzQyxJQUFJLEVBQUVOLE9BQU8sQ0FBQyxDQUFDO0VBQzNELENBQUM7RUFFRDtBQUNKO0FBQ0E7QUFDQTtFQUNJTyxjQUFjLEVBQUUsTUFBQUEsQ0FBQSxLQUFZO0lBQ3hCLE9BQU92QyxTQUFTLENBQUMsc0JBQXNCLEVBQUUsRUFBRSxDQUFDO0VBQ2hELENBQUM7RUFFRDtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0lnRCx5QkFBeUIsRUFBRSxNQUFPQyxZQUFZLElBQUs7SUFDL0MsT0FBT2pELFNBQVMsQ0FBQywyQkFBMkIsRUFBRSxDQUFDO01BQUVpRDtJQUFhLENBQUMsQ0FBQyxDQUFDO0VBQ3JFLENBQUM7RUFFRDs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtFQUNJQyxvQkFBb0IsRUFBR3JCLFFBQVEsSUFBSztJQUNoQ3pDLFdBQVcsQ0FBQ29DLEVBQUUsQ0FBQyx3QkFBd0IsRUFBRSxDQUFDQyxDQUFDLEVBQUUwQixRQUFRLEtBQUt0QixRQUFRLENBQUNzQixRQUFRLENBQUMsQ0FBQztJQUM3RTtJQUNBLE9BQU8sTUFBTTtNQUNUL0QsV0FBVyxDQUFDZ0UsY0FBYyxDQUFDLHdCQUF3QixFQUFFdkIsUUFBUSxDQUFDO0lBQ2xFLENBQUM7RUFDTCxDQUFDO0VBRUQ7QUFDSjtBQUNBO0FBQ0E7RUFDSXdCLGtCQUFrQixFQUFHeEIsUUFBUSxJQUFLO0lBQzlCekMsV0FBVyxDQUFDb0MsRUFBRSxDQUFDLHNCQUFzQixFQUFFLENBQUNDLENBQUMsRUFBRTZCLE1BQU0sS0FBS3pCLFFBQVEsQ0FBQ3lCLE1BQU0sQ0FBQyxDQUFDO0lBQ3ZFO0lBQ0EsT0FBTyxNQUFNO01BQ1RsRSxXQUFXLENBQUNnRSxjQUFjLENBQUMsc0JBQXNCLEVBQUV2QixRQUFRLENBQUM7SUFDaEUsQ0FBQztFQUNMLENBQUM7RUFFRDtBQUNKO0FBQ0E7QUFDQTtFQUNJMEIsb0JBQW9CLEVBQUcxQixRQUFRLElBQUs7SUFDaEN6QyxXQUFXLENBQUNvQyxFQUFFLENBQUMsd0JBQXdCLEVBQUUsQ0FBQ0MsQ0FBQyxFQUFFK0IsTUFBTSxLQUFLM0IsUUFBUSxDQUFDMkIsTUFBTSxDQUFDLENBQUM7SUFDekU7SUFDQSxPQUFPLE1BQU07TUFDVHBFLFdBQVcsQ0FBQ2dFLGNBQWMsQ0FBQyx3QkFBd0IsRUFBRXZCLFFBQVEsQ0FBQztJQUNsRSxDQUFDO0VBQ0wsQ0FBQztFQUVEO0FBQ0o7QUFDQTtBQUNBO0VBQ0k0QixpQkFBaUIsRUFBRzVCLFFBQVEsSUFBSztJQUM3QnpDLFdBQVcsQ0FBQ29DLEVBQUUsQ0FBQyxxQkFBcUIsRUFBRSxDQUFDQyxDQUFDLEVBQUVoQyxLQUFLLEtBQUtvQyxRQUFRLENBQUNwQyxLQUFLLENBQUMsQ0FBQztJQUNwRTtJQUNBLE9BQU8sTUFBTTtNQUNUTCxXQUFXLENBQUNnRSxjQUFjLENBQUMscUJBQXFCLEVBQUV2QixRQUFRLENBQUM7SUFDL0QsQ0FBQztFQUNMLENBQUM7RUFFRDtBQUNKO0FBQ0E7QUFDQTtFQUNJNkIscUJBQXFCLEVBQUdDLFFBQVEsSUFBSztJQUNqQ3ZFLFdBQVcsQ0FBQ2dFLGNBQWMsQ0FBQyx3QkFBd0IsRUFBRU8sUUFBUSxDQUFDO0VBQ2xFLENBQUM7RUFFRDtBQUNKO0FBQ0E7QUFDQTtFQUNJQyxtQkFBbUIsRUFBR0QsUUFBUSxJQUFLO0lBQy9CdkUsV0FBVyxDQUFDZ0UsY0FBYyxDQUFDLHNCQUFzQixFQUFFTyxRQUFRLENBQUM7RUFDaEUsQ0FBQztFQUVEO0FBQ0o7QUFDQTtBQUNBO0VBQ0lFLHFCQUFxQixFQUFHRixRQUFRLElBQUs7SUFDakN2RSxXQUFXLENBQUNnRSxjQUFjLENBQUMsd0JBQXdCLEVBQUVPLFFBQVEsQ0FBQztFQUNsRSxDQUFDO0VBRUQ7QUFDSjtBQUNBO0FBQ0E7RUFDSUcsa0JBQWtCLEVBQUdILFFBQVEsSUFBSztJQUM5QnZFLFdBQVcsQ0FBQ2dFLGNBQWMsQ0FBQyxxQkFBcUIsRUFBRU8sUUFBUSxDQUFDO0VBQy9ELENBQUM7RUFFRDs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtFQUNJSSxtQkFBbUIsRUFBR2xDLFFBQVEsSUFBSztJQUMvQnpDLFdBQVcsQ0FBQ29DLEVBQUUsQ0FBQyxnQ0FBZ0MsRUFBRSxDQUFDQyxDQUFDLEVBQUV1QyxJQUFJLEtBQUtuQyxRQUFRLENBQUNtQyxJQUFJLENBQUMsQ0FBQztJQUM3RTtJQUNBLE9BQU8sTUFBTTtNQUNUNUUsV0FBVyxDQUFDZ0UsY0FBYyxDQUFDLGdDQUFnQyxFQUFFdkIsUUFBUSxDQUFDO0lBQzFFLENBQUM7RUFDTCxDQUFDO0VBRUQ7QUFDSjtBQUNBO0FBQ0E7RUFDSW9DLGtCQUFrQixFQUFHcEMsUUFBUSxJQUFLO0lBQzlCekMsV0FBVyxDQUFDb0MsRUFBRSxDQUFDLCtCQUErQixFQUFFLENBQUNDLENBQUMsRUFBRXVDLElBQUksS0FBS25DLFFBQVEsQ0FBQ21DLElBQUksQ0FBQyxDQUFDO0lBQzVFO0lBQ0EsT0FBTyxNQUFNO01BQ1Q1RSxXQUFXLENBQUNnRSxjQUFjLENBQUMsK0JBQStCLEVBQUV2QixRQUFRLENBQUM7SUFDekUsQ0FBQztFQUNMLENBQUM7RUFFRDtBQUNKO0FBQ0E7QUFDQTtFQUNJcUMscUJBQXFCLEVBQUdyQyxRQUFRLElBQUs7SUFDakN6QyxXQUFXLENBQUNvQyxFQUFFLENBQUMsa0NBQWtDLEVBQUUsQ0FBQ0MsQ0FBQyxFQUFFdUMsSUFBSSxLQUFLbkMsUUFBUSxDQUFDbUMsSUFBSSxDQUFDLENBQUM7SUFDL0U7SUFDQSxPQUFPLE1BQU07TUFDVDVFLFdBQVcsQ0FBQ2dFLGNBQWMsQ0FBQyxrQ0FBa0MsRUFBRXZCLFFBQVEsQ0FBQztJQUM1RSxDQUFDO0VBQ0wsQ0FBQztFQUVEOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0VBQ0lzQyxXQUFXLEVBQUUsTUFBT25DLE9BQU8sSUFBSztJQUM1QixPQUFPLE1BQU01QyxXQUFXLENBQUNrQixNQUFNLENBQUMsdUJBQXVCLEVBQUUwQixPQUFPLENBQUM7RUFDckUsQ0FBQztFQUVEO0FBQ0o7QUFDQTtBQUNBO0VBQ0lvQyxlQUFlLEVBQUUsTUFBT3BDLE9BQU8sSUFBSztJQUNoQyxPQUFPLE1BQU01QyxXQUFXLENBQUNrQixNQUFNLENBQUMsMkJBQTJCLEVBQUUwQixPQUFPLENBQUM7RUFDekUsQ0FBQztFQUVEO0FBQ0o7QUFDQTtBQUNBO0VBQ0lxQyxvQkFBb0IsRUFBRSxNQUFPckMsT0FBTyxJQUFLO0lBQ3JDLE9BQU8sTUFBTTVDLFdBQVcsQ0FBQ2tCLE1BQU0sQ0FBQyxpQ0FBaUMsRUFBRTBCLE9BQU8sQ0FBQztFQUMvRSxDQUFDO0VBRUQ7QUFDSjtBQUNBO0FBQ0E7RUFDSXNDLFlBQVksRUFBRSxNQUFPdEMsT0FBTyxJQUFLO0lBQzdCLE9BQU8sTUFBTTVDLFdBQVcsQ0FBQ2tCLE1BQU0sQ0FBQyx3QkFBd0IsRUFBRTBCLE9BQU8sQ0FBQztFQUN0RSxDQUFDO0VBRUQ7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJdUMscUJBQXFCLEVBQUUsTUFBQUEsQ0FBT2pDLElBQUksRUFBRU4sT0FBTyxLQUFLO0lBQzVDLE9BQU8sTUFBTTVDLFdBQVcsQ0FBQ2tCLE1BQU0sQ0FBQyx5QkFBeUIsRUFBRTtNQUFFZ0MsSUFBSTtNQUFFLEdBQUdOO0lBQVEsQ0FBQyxDQUFDO0VBQ3BGLENBQUM7RUFFRDtBQUNKO0FBQ0E7QUFDQTtFQUNJd0MsZ0JBQWdCLEVBQUUsTUFBT2xDLElBQUksSUFBSztJQUM5QixPQUFPLE1BQU1sRCxXQUFXLENBQUNrQixNQUFNLENBQUMsMkJBQTJCLEVBQUVnQyxJQUFJLENBQUM7RUFDdEUsQ0FBQztFQUVEO0FBQ0o7QUFDQTtBQUNBO0VBQ0ltQyxRQUFRLEVBQUUsTUFBT25DLElBQUksSUFBSztJQUN0QixPQUFPLE1BQU1sRCxXQUFXLENBQUNrQixNQUFNLENBQUMsZ0JBQWdCLEVBQUU7TUFBRWdDO0lBQUssQ0FBQyxDQUFDO0VBQy9ELENBQUM7RUFFRDtBQUNKO0FBQ0E7QUFDQTtFQUNJb0MsUUFBUSxFQUFFLE1BQU9wQyxJQUFJLElBQUs7SUFDdEIsT0FBTyxNQUFNbEQsV0FBVyxDQUFDa0IsTUFBTSxDQUFDLGVBQWUsRUFBRTtNQUFFZ0M7SUFBSyxDQUFDLENBQUM7RUFDOUQsQ0FBQztFQUVEO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7RUFDSXFDLFNBQVMsRUFBRSxNQUFBQSxDQUFPckMsSUFBSSxFQUFFc0MsT0FBTyxLQUFLO0lBQ2hDLE9BQU8sTUFBTXhGLFdBQVcsQ0FBQ2tCLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRTtNQUFFZ0MsSUFBSTtNQUFFc0M7SUFBUSxDQUFDLENBQUM7RUFDeEUsQ0FBQztFQUVEO0FBQ0o7QUFDQTtBQUNBO0VBQ0lDLGVBQWUsRUFBRSxNQUFPdkMsSUFBSSxJQUFLO0lBQzdCLE9BQU8sTUFBTWxELFdBQVcsQ0FBQ2tCLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRTtNQUFFZ0M7SUFBSyxDQUFDLENBQUM7RUFDL0QsQ0FBQztFQUVEO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7RUFDSXdDLFFBQVEsRUFBRSxNQUFBQSxDQUFPQyxVQUFVLEVBQUVDLFFBQVEsS0FBSztJQUN0QyxPQUFPLE1BQU01RixXQUFXLENBQUNrQixNQUFNLENBQUMsZUFBZSxFQUFFO01BQUV5RSxVQUFVO01BQUVDO0lBQVMsQ0FBQyxDQUFDO0VBQzlFLENBQUM7RUFFRDtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0lDLFVBQVUsRUFBRSxNQUFBQSxDQUFPM0MsSUFBSSxFQUFFNEMsU0FBUyxLQUFLO0lBQ25DLE9BQU8sTUFBTTlGLFdBQVcsQ0FBQ2tCLE1BQU0sQ0FBQyxpQkFBaUIsRUFBRTtNQUFFZ0MsSUFBSTtNQUFFNEM7SUFBVSxDQUFDLENBQUM7RUFDM0UsQ0FBQztFQUVEO0FBQ0o7QUFDQTtBQUNBO0VBQ0lDLFlBQVksRUFBRSxNQUFPeEMsR0FBRyxJQUFLO0lBQ3pCLE9BQU8sTUFBTXZELFdBQVcsQ0FBQ2tCLE1BQU0sQ0FBQyxxQkFBcUIsRUFBRXFDLEdBQUcsQ0FBQztFQUMvRCxDQUFDO0VBRUQ7RUFDQXlDLFVBQVUsRUFBRSxNQUFPQyxHQUFHLElBQUs7SUFDdkIsT0FBT3JGLFNBQVMsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDcUYsR0FBRyxDQUFDLENBQUM7RUFDaEQsQ0FBQztFQUVEQyxVQUFVLEVBQUUsTUFBQUEsQ0FBT0QsR0FBRyxFQUFFRSxLQUFLLEtBQUs7SUFDOUIsT0FBT3ZGLFNBQVMsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDcUYsR0FBRyxFQUFFRSxLQUFLLENBQUMsQ0FBQztFQUN2RCxDQUFDO0VBRUQ7RUFDQUMsYUFBYSxFQUFFLE1BQUFBLENBQU87SUFBRUM7RUFBUSxDQUFDLEtBQUs7SUFDbENuRyxPQUFPLENBQUNDLEdBQUcsQ0FBQyxxQ0FBcUNrRyxPQUFPLFdBQVcsT0FBT0EsT0FBTyxHQUFHLENBQUM7SUFDckY7SUFDQSxNQUFNQyxXQUFXLEdBQUdDLE9BQU8sQ0FBQ0YsT0FBTyxDQUFDO0lBQ3BDbkcsT0FBTyxDQUFDQyxHQUFHLENBQUMsbUNBQW1DbUcsV0FBVyxXQUFXLE9BQU9BLFdBQVcsR0FBRyxDQUFDO0lBRTNGLE1BQU1sQyxNQUFNLEdBQUcsTUFBTXhELFNBQVMsQ0FBQyxnQ0FBZ0MsRUFBRSxDQUFDO01BQUV5RixPQUFPLEVBQUVDO0lBQVksQ0FBQyxDQUFDLENBQUM7SUFDNUZwRyxPQUFPLENBQUNDLEdBQUcsQ0FBQyw0Q0FBNEMsRUFBRWlFLE1BQU0sQ0FBQztJQUNqRSxPQUFPQSxNQUFNO0VBQ2pCLENBQUM7RUFFRG9DLGFBQWEsRUFBRSxNQUFBQSxDQUFBLEtBQVk7SUFDdkIsTUFBTXBDLE1BQU0sR0FBRyxNQUFNeEQsU0FBUyxDQUFDLGdDQUFnQyxFQUFFLEVBQUUsQ0FBQztJQUNwRVYsT0FBTyxDQUFDQyxHQUFHLENBQUMsOEJBQThCaUUsTUFBTSxXQUFXLE9BQU9BLE1BQU0sR0FBRyxDQUFDO0lBQzVFLE9BQU9BLE1BQU07RUFDakIsQ0FBQztFQUVEO0VBQ0FxQyxVQUFVLEVBQUUsTUFBQUEsQ0FBT1IsR0FBRyxFQUFFUyxRQUFRLEdBQUcsUUFBUSxLQUFLO0lBQzVDLE9BQU85RixTQUFTLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztNQUFFcUYsR0FBRztNQUFFUztJQUFTLENBQUMsQ0FBQyxDQUFDO0VBQzlELENBQUM7RUFFREMsaUJBQWlCLEVBQUUsTUFBQUEsQ0FBT0QsUUFBUSxHQUFHLFFBQVEsS0FBSztJQUM5QyxPQUFPOUYsU0FBUyxDQUFDLHFCQUFxQixFQUFFLENBQUM7TUFBRThGO0lBQVMsQ0FBQyxDQUFDLENBQUM7RUFDM0QsQ0FBQztFQUVERSxZQUFZLEVBQUUsTUFBQUEsQ0FBT0YsUUFBUSxHQUFHLFFBQVEsS0FBSztJQUN6QyxPQUFPOUYsU0FBUyxDQUFDLHFCQUFxQixFQUFFLENBQUM7TUFBRThGO0lBQVMsQ0FBQyxDQUFDLENBQUM7RUFDM0QsQ0FBQztFQUVERyxjQUFjLEVBQUUsTUFBQUEsQ0FBT1osR0FBRyxFQUFFUyxRQUFRLEdBQUcsUUFBUSxLQUFLO0lBQ2hELE9BQU85RixTQUFTLENBQUMsdUJBQXVCLEVBQUUsQ0FBQztNQUFFcUYsR0FBRztNQUFFUztJQUFTLENBQUMsQ0FBQyxDQUFDO0VBQ2xFLENBQUM7RUFFREksU0FBUyxFQUFFLE1BQUFBLENBQU9KLFFBQVEsR0FBRyxRQUFRLEtBQUs7SUFDdEMsT0FBTzlGLFNBQVMsQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO01BQUU4RjtJQUFTLENBQUMsQ0FBQyxDQUFDO0VBQ3hELENBQUM7RUFFRDtFQUNBSyxnQkFBZ0IsRUFBRSxNQUFBQSxDQUFBLEtBQVk7SUFDMUIsT0FBT25HLFNBQVMsQ0FBQyxzQkFBc0IsRUFBRSxFQUFFLENBQUM7RUFDaEQsQ0FBQztFQUVEb0csbUJBQW1CLEVBQUUsTUFBQUEsQ0FBQSxLQUFZO0lBQzdCLE9BQU9wRyxTQUFTLENBQUMsaUNBQWlDLEVBQUUsRUFBRSxDQUFDO0VBQzNELENBQUM7RUFFRHFHLGNBQWMsRUFBRSxNQUFPQyxTQUFTLElBQUs7SUFDakMsT0FBT3RHLFNBQVMsQ0FBQywrQkFBK0IsRUFBRSxDQUFDc0csU0FBUyxDQUFDLENBQUM7RUFDbEUsQ0FBQztFQUVEQyxTQUFTLEVBQUUsTUFBQUEsQ0FBT2xCLEdBQUcsRUFBRXJCLElBQUksS0FBSztJQUM1QixPQUFPaEUsU0FBUyxDQUFDLDBCQUEwQixFQUFFLENBQUM7TUFBRXFGLEdBQUc7TUFBRXJCO0lBQUssQ0FBQyxDQUFDLENBQUM7RUFDakUsQ0FBQztFQUVEd0MsYUFBYSxFQUFFLE1BQUFBLENBQU9uQixHQUFHLEVBQUVvQixNQUFNLEtBQUs7SUFDbEMsT0FBT3pHLFNBQVMsQ0FBQywrQkFBK0IsRUFBRSxDQUFDO01BQUVxRixHQUFHO01BQUVvQjtJQUFPLENBQUMsQ0FBQyxDQUFDO0VBQ3hFLENBQUM7RUFFREMsZUFBZSxFQUFFLE1BQU9yQixHQUFHLElBQUs7SUFDNUIsT0FBT3JGLFNBQVMsQ0FBQyxnQ0FBZ0MsRUFBRSxDQUFDO01BQUVxRjtJQUFJLENBQUMsQ0FBQyxDQUFDO0VBQ2pFLENBQUM7RUFFRHNCLFVBQVUsRUFBRSxNQUFBQSxDQUFBLEtBQVk7SUFDcEIsT0FBTzNHLFNBQVMsQ0FBQywyQkFBMkIsRUFBRSxFQUFFLENBQUM7RUFDckQsQ0FBQztFQUNEO0VBQ0E0RyxjQUFjLEVBQUcvRSxRQUFRLElBQUs7SUFDMUJ6QyxXQUFXLENBQUNvQyxFQUFFLENBQUMscUJBQXFCLEVBQUUsQ0FBQ0MsQ0FBQyxFQUFFdUMsSUFBSSxLQUFLbkMsUUFBUSxDQUFDbUMsSUFBSSxDQUFDLENBQUM7SUFDbEUsT0FBTyxNQUFNO01BQ1Q1RSxXQUFXLENBQUNnRSxjQUFjLENBQUMscUJBQXFCLEVBQUV2QixRQUFRLENBQUM7SUFDL0QsQ0FBQztFQUNMLENBQUM7RUFFRDtBQUNKO0FBQ0E7QUFDQTtFQUNJZ0YsYUFBYSxFQUFHaEYsUUFBUSxJQUFLO0lBQ3pCekMsV0FBVyxDQUFDb0MsRUFBRSxDQUFDLG9CQUFvQixFQUFFLENBQUNDLENBQUMsRUFBRXFGLEtBQUssS0FBSztNQUMvQ3hILE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDhCQUE4QixFQUFFdUgsS0FBSyxDQUFDO01BQ2xEakYsUUFBUSxDQUFDaUYsS0FBSyxDQUFDO0lBQ25CLENBQUMsQ0FBQztJQUNGLE9BQU8sTUFBTTtNQUNUMUgsV0FBVyxDQUFDZ0UsY0FBYyxDQUFDLG9CQUFvQixFQUFFdkIsUUFBUSxDQUFDO0lBQzlELENBQUM7RUFDTCxDQUFDO0VBRUQ7RUFDQWtGLGVBQWUsRUFBRSxNQUFPQyxRQUFRLElBQUs7SUFDakMsT0FBT2hILFNBQVMsQ0FBQyx3QkFBd0IsRUFBRSxDQUFDO01BQUVnSDtJQUFTLENBQUMsQ0FBQyxDQUFDO0VBQzlELENBQUM7RUFFREMsZUFBZSxFQUFFLE1BQU9ELFFBQVEsSUFBSztJQUNqQyxPQUFPaEgsU0FBUyxDQUFDLHdCQUF3QixFQUFFLENBQUM7TUFBRWdIO0lBQVMsQ0FBQyxDQUFDLENBQUM7RUFDOUQsQ0FBQztFQUVERSxxQkFBcUIsRUFBRSxNQUFBQSxDQUFBLEtBQVk7SUFDL0IsT0FBT2xILFNBQVMsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLHFCQUFxQixDQUFDLENBQUM7RUFDbEUsQ0FBQztFQUVEbUgscUJBQXFCLEVBQUUsTUFBT0MsS0FBSyxJQUFLO0lBQ3BDLE9BQU9wSCxTQUFTLENBQUMsbUJBQW1CLEVBQUUsQ0FBQyxxQkFBcUIsRUFBRW9ILEtBQUssQ0FBQyxDQUFDO0VBQ3pFLENBQUM7RUFFRDtFQUNBQyxpQkFBaUIsRUFBRSxNQUFBQSxDQUFBLEtBQVk7SUFDM0IvSCxPQUFPLENBQUNDLEdBQUcsQ0FBQyxvQ0FBb0MsQ0FBQztJQUNqRCxJQUFJO01BQ0E7TUFDQSxNQUFNaUUsTUFBTSxHQUFHLE1BQU14RCxTQUFTLENBQUMsaUNBQWlDLEVBQUUsRUFBRSxDQUFDO01BQ3JFVixPQUFPLENBQUNDLEdBQUcsQ0FBQyw4Q0FBOEMsRUFDdERpRSxNQUFNLEdBQUlBLE1BQU0sQ0FBQzhELE1BQU0sR0FBRyxXQUFXLEdBQUcsY0FBYyxHQUFJLFdBQVcsQ0FBQztNQUMxRSxPQUFPOUQsTUFBTTtJQUNqQixDQUFDLENBQUMsT0FBTy9ELEtBQUssRUFBRTtNQUNaSCxPQUFPLENBQUNHLEtBQUssQ0FBQywyQ0FBMkMsRUFBRUEsS0FBSyxDQUFDO01BQ2pFO01BQ0EsSUFBSTtRQUNBLE1BQU04SCxTQUFTLEdBQUcsTUFBTXZILFNBQVMsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLGdCQUFnQixDQUFDLENBQUM7UUFDMUUsTUFBTXdILFNBQVMsR0FBRyxNQUFNeEgsU0FBUyxDQUFDLG1CQUFtQixFQUFFLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUN4RixNQUFNeUgsTUFBTSxHQUFHRixTQUFTLElBQUlDLFNBQVMsSUFBSSxFQUFFO1FBQzNDLE9BQU87VUFDSEUsT0FBTyxFQUFFLElBQUk7VUFDYkQsTUFBTTtVQUNOSCxNQUFNLEVBQUUsQ0FBQyxDQUFDRyxNQUFNO1VBQ2hCRSxNQUFNLEVBQUVKLFNBQVMsR0FBRyxRQUFRLEdBQUlDLFNBQVMsR0FBRyxRQUFRLEdBQUc7UUFDM0QsQ0FBQztNQUNMLENBQUMsQ0FBQyxPQUFPSSxhQUFhLEVBQUU7UUFDcEJ0SSxPQUFPLENBQUNHLEtBQUssQ0FBQyxvREFBb0QsRUFBRW1JLGFBQWEsQ0FBQztRQUNsRixNQUFNbkksS0FBSyxDQUFDLENBQUM7TUFDakI7SUFDSjtFQUNKLENBQUM7RUFFRG9JLGlCQUFpQixFQUFFLE1BQU9KLE1BQU0sSUFBSztJQUNqQ25JLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLG9DQUFvQyxDQUFDO0lBQ2pELElBQUk7TUFDQTtNQUNBLE1BQU1pRSxNQUFNLEdBQUcsTUFBTXhELFNBQVMsQ0FBQyxpQ0FBaUMsRUFBRSxDQUFDO1FBQUV5SDtNQUFPLENBQUMsQ0FBQyxDQUFDO01BQy9FbkksT0FBTyxDQUFDQyxHQUFHLENBQUMsd0NBQXdDLEVBQUVpRSxNQUFNLENBQUM7O01BRTdEO01BQ0EsSUFBSTtRQUNBLE1BQU14RCxTQUFTLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztVQUFFcUYsR0FBRyxFQUFFb0MsTUFBTTtVQUFFM0IsUUFBUSxFQUFFO1FBQVcsQ0FBQyxDQUFDLENBQUM7UUFDN0V4RyxPQUFPLENBQUNDLEdBQUcsQ0FBQywyREFBMkQsQ0FBQztNQUM1RSxDQUFDLENBQUMsT0FBT3VJLFdBQVcsRUFBRTtRQUNsQnhJLE9BQU8sQ0FBQ0csS0FBSyxDQUFDLDRDQUE0QyxFQUFFcUksV0FBVyxDQUFDO1FBQ3hFO01BQ0o7TUFFQSxPQUFPdEUsTUFBTTtJQUNqQixDQUFDLENBQUMsT0FBTy9ELEtBQUssRUFBRTtNQUNaSCxPQUFPLENBQUNHLEtBQUssQ0FBQywyQ0FBMkMsRUFBRUEsS0FBSyxDQUFDO01BQ2pFO01BQ0EsSUFBSTtRQUNBLE1BQU1PLFNBQVMsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLGdCQUFnQixFQUFFeUgsTUFBTSxDQUFDLENBQUM7UUFDaEUsTUFBTXpILFNBQVMsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLDhCQUE4QixFQUFFeUgsTUFBTSxDQUFDLENBQUM7UUFDOUUsT0FBTztVQUFFQyxPQUFPLEVBQUU7UUFBSyxDQUFDO01BQzVCLENBQUMsQ0FBQyxPQUFPRSxhQUFhLEVBQUU7UUFDcEJ0SSxPQUFPLENBQUNHLEtBQUssQ0FBQyxvREFBb0QsRUFBRW1JLGFBQWEsQ0FBQztRQUNsRixNQUFNbkksS0FBSyxDQUFDLENBQUM7TUFDakI7SUFDSjtFQUNKLENBQUM7RUFFRDtFQUNBc0ksVUFBVSxFQUFFLE1BQUFBLENBQUEsS0FBWTtJQUNwQixPQUFPL0gsU0FBUyxDQUFDLG1CQUFtQixFQUFFLEVBQUUsQ0FBQztFQUM3QyxDQUFDO0VBRURnSSxZQUFZLEVBQUUsTUFBQUEsQ0FBQSxLQUFZO0lBQ3RCLE9BQU9oSSxTQUFTLENBQUMscUJBQXFCLEVBQUUsRUFBRSxDQUFDO0VBQy9DO0FBQ0osQ0FBQyxDQUFDOztBQUVGO0FBQ0FpSSxNQUFNLENBQUNDLGdCQUFnQixDQUFDLFFBQVEsRUFBRTVHLHFCQUFxQixDQUFDIiwiaWdub3JlTGlzdCI6W119