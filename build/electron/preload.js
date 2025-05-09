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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjb250ZXh0QnJpZGdlIiwiaXBjUmVuZGVyZXIiLCJyZXF1aXJlIiwiY29uc29sZSIsImxvZyIsIl9fZmlsZW5hbWUiLCJlcnJvciIsIm1lc3NhZ2UiLCJpc0FwcFJlYWR5IiwicGVuZGluZ0NhbGxzIiwiTWFwIiwicmVhZHlDYWxsYmFjayIsIkNBTExfVElNRU9VVCIsInF1ZXVlQ2FsbCIsImNoYW5uZWwiLCJhcmdzIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJpbnZva2UiLCJ0aGVuIiwiY2F0Y2giLCJpZCIsIkRhdGUiLCJub3ciLCJ0b1N0cmluZyIsInNldCIsInNldFRpbWVvdXQiLCJoYXMiLCJnZXQiLCJkZWxldGUiLCJFcnJvciIsInByb2Nlc3NQZW5kaW5nQ2FsbHMiLCJzaXplIiwiZmluYWxseSIsImNsZWFudXBFdmVudExpc3RlbmVycyIsInJlbW92ZUFsbExpc3RlbmVycyIsIm9uIiwiXyIsImV4cG9zZUluTWFpbldvcmxkIiwiaXNSZWFkeSIsIm9uUmVhZHkiLCJjYWxsYmFjayIsImNvbnZlcnQiLCJpbnB1dCIsIm9wdGlvbnMiLCJidWZmZXIiLCJBcnJheUJ1ZmZlciIsIkJ1ZmZlciIsImZyb20iLCJnZXRSZXN1bHQiLCJwYXRoIiwiY2FuY2VsUmVxdWVzdHMiLCJfcmVkaXJlY3RUb0NvbnZlcnQiLCJ0eXBlIiwiY29udmVydFVybCIsInVybCIsImlzV2ViIiwiY29udmVydFBhcmVudFVybCIsImNvbnZlcnRZb3V0dWJlIiwiY29udmVydEZpbGUiLCJvbkNvbnZlcnNpb25Qcm9ncmVzcyIsInByb2dyZXNzIiwicmVtb3ZlTGlzdGVuZXIiLCJvbkNvbnZlcnNpb25TdGF0dXMiLCJzdGF0dXMiLCJvbkNvbnZlcnNpb25Db21wbGV0ZSIsInJlc3VsdCIsIm9uQ29udmVyc2lvbkVycm9yIiwib2ZmQ29udmVyc2lvblByb2dyZXNzIiwibGlzdGVuZXIiLCJvZmZDb252ZXJzaW9uU3RhdHVzIiwib2ZmQ29udmVyc2lvbkNvbXBsZXRlIiwib2ZmQ29udmVyc2lvbkVycm9yIiwic2VsZWN0RmlsZXMiLCJzZWxlY3REaXJlY3RvcnkiLCJzZWxlY3RJbnB1dERpcmVjdG9yeSIsInNlbGVjdE91dHB1dCIsImxpc3REaXJlY3RvcnlEZXRhaWxlZCIsInNob3dJdGVtSW5Gb2xkZXIiLCJnZXRTdGF0cyIsInJlYWRGaWxlIiwid3JpdGVGaWxlIiwiY29udGVudCIsImNyZWF0ZURpcmVjdG9yeSIsIm1vdmVJdGVtIiwic291cmNlUGF0aCIsImRlc3RQYXRoIiwiZGVsZXRlSXRlbSIsInJlY3Vyc2l2ZSIsIm9wZW5FeHRlcm5hbCIsImdldFNldHRpbmciLCJrZXkiLCJzZXRTZXR0aW5nIiwidmFsdWUiLCJzZXRPY3JFbmFibGVkIiwiZW5hYmxlZCIsImJvb2xFbmFibGVkIiwiQm9vbGVhbiIsImdldE9jckVuYWJsZWQiLCJzYXZlQXBpS2V5IiwicHJvdmlkZXIiLCJjaGVja0FwaUtleUV4aXN0cyIsImRlbGV0ZUFwaUtleSIsInZhbGlkYXRlQXBpS2V5IiwiZ2V0QXBpS2V5IiwiZ2V0T2ZmbGluZVN0YXR1cyIsImdldFF1ZXVlZE9wZXJhdGlvbnMiLCJxdWV1ZU9wZXJhdGlvbiIsIm9wZXJhdGlvbiIsImNhY2hlRGF0YSIsImRhdGEiLCJnZXRDYWNoZWREYXRhIiwibWF4QWdlIiwiaW52YWxpZGF0ZUNhY2hlIiwiY2xlYXJDYWNoZSIsIm9uT2ZmbGluZUV2ZW50Iiwib25GaWxlRHJvcHBlZCIsImZpbGVzIiwidHJhbnNjcmliZUF1ZGlvIiwiZmlsZVBhdGgiLCJ0cmFuc2NyaWJlVmlkZW8iLCJnZXRUcmFuc2NyaXB0aW9uTW9kZWwiLCJzZXRUcmFuc2NyaXB0aW9uTW9kZWwiLCJtb2RlbCIsImdldFZlcnNpb24iLCJjaGVja1VwZGF0ZXMiLCJ3aW5kb3ciLCJhZGRFdmVudExpc3RlbmVyIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL2VsZWN0cm9uL3ByZWxvYWQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFByZWxvYWQgU2NyaXB0XHJcbiAqIEV4cG9zZXMgc3BlY2lmaWMgRWxlY3Ryb24gQVBJcyB0byB0aGUgcmVuZGVyZXIgcHJvY2Vzc1xyXG4gKiBcclxuICogVGhpcyBzY3JpcHQgY3JlYXRlcyBhIHNlY3VyZSBicmlkZ2UgYmV0d2VlbiB0aGUgcmVuZGVyZXIgcHJvY2VzcyBhbmQgdGhlIG1haW4gcHJvY2VzcyxcclxuICogZXhwb3Npbmcgb25seSB0aGUgbmVjZXNzYXJ5IGZ1bmN0aW9uYWxpdHkgd2hpbGUgbWFpbnRhaW5pbmcgc2VjdXJpdHkgdGhyb3VnaCBjb250ZXh0SXNvbGF0aW9uLlxyXG4gKiBcclxuICogSW5jbHVkZXMgaW5pdGlhbGl6YXRpb24gdHJhY2tpbmcgYW5kIElQQyBjYWxsIHF1ZXVlaW5nIHRvIGVuc3VyZSByZWxpYWJsZSBjb21tdW5pY2F0aW9uLlxyXG4gKi9cclxuXHJcbmNvbnN0IHsgY29udGV4dEJyaWRnZSwgaXBjUmVuZGVyZXIgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcblxyXG4vLyBBZGQgZGlyZWN0IGNvbnNvbGUgb3V0cHV0IGZvciBkZWJ1Z2dpbmdcclxuY29uc29sZS5sb2coJz09PT09PSBQUkVMT0FEIFNDUklQVCBTVEFSVElORyA9PT09PT0nKTtcclxudHJ5IHtcclxuICAgIC8vIFVzZSBfX2ZpbGVuYW1lIGlmIGF2YWlsYWJsZSAoQ29tbW9uSlMpLCBvdGhlcndpc2UgaGFuZGxlIGdyYWNlZnVsbHlcclxuICAgIGNvbnNvbGUubG9nKCdQcmVsb2FkIHNjcmlwdCBwYXRoOicsIHR5cGVvZiBfX2ZpbGVuYW1lICE9PSAndW5kZWZpbmVkJyA/IF9fZmlsZW5hbWUgOiAnUGF0aCBub3QgYXZhaWxhYmxlJyk7XHJcbn0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmxvZygnVW5hYmxlIHRvIGRldGVybWluZSBwcmVsb2FkIHNjcmlwdCBwYXRoOicsIGVycm9yLm1lc3NhZ2UpO1xyXG59XHJcbmNvbnNvbGUubG9nKCc9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0nKTtcclxuXHJcbi8vIEluaXRpYWxpemF0aW9uIHRyYWNraW5nXHJcbmxldCBpc0FwcFJlYWR5ID0gZmFsc2U7XHJcbmNvbnN0IHBlbmRpbmdDYWxscyA9IG5ldyBNYXAoKTtcclxubGV0IHJlYWR5Q2FsbGJhY2sgPSBudWxsO1xyXG5jb25zdCBDQUxMX1RJTUVPVVQgPSAxMDAwMDsgLy8gMTAgc2Vjb25kIHRpbWVvdXQgZm9yIHF1ZXVlZCBjYWxsc1xyXG5cclxuLyoqXHJcbiAqIFF1ZXVlIGFuIElQQyBjYWxsIHVudGlsIGFwcCBpcyByZWFkeVxyXG4gKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIElQQyBjaGFubmVsIG5hbWVcclxuICogQHBhcmFtIHtBcnJheX0gYXJncyAtIENhbGwgYXJndW1lbnRzXHJcbiAqIEByZXR1cm5zIHtQcm9taXNlfSBSZXNvbHZlcyB3aGVuIGNhbGwgY29tcGxldGVzXHJcbiAqL1xyXG5mdW5jdGlvbiBxdWV1ZUNhbGwoY2hhbm5lbCwgYXJncykge1xyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICBpZiAoaXNBcHBSZWFkeSkge1xyXG4gICAgICAgICAgICAvLyBBcHAgaXMgcmVhZHksIG1ha2UgY2FsbCBpbW1lZGlhdGVseVxyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5pbnZva2UoY2hhbm5lbCwgLi4uYXJncylcclxuICAgICAgICAgICAgICAgIC50aGVuKHJlc29sdmUpXHJcbiAgICAgICAgICAgICAgICAuY2F0Y2gocmVqZWN0KTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAvLyBRdWV1ZSB0aGUgY2FsbFxyXG4gICAgICAgICAgICBjb25zdCBpZCA9IERhdGUubm93KCkudG9TdHJpbmcoKTtcclxuICAgICAgICAgICAgcGVuZGluZ0NhbGxzLnNldChpZCwgeyBjaGFubmVsLCBhcmdzLCByZXNvbHZlLCByZWplY3QgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBTZXQgdGltZW91dCBmb3IgcXVldWVkIGNhbGxzXHJcbiAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKHBlbmRpbmdDYWxscy5oYXMoaWQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgeyByZWplY3QgfSA9IHBlbmRpbmdDYWxscy5nZXQoaWQpO1xyXG4gICAgICAgICAgICAgICAgICAgIHBlbmRpbmdDYWxscy5kZWxldGUoaWQpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoYElQQyBjYWxsIHRvICR7Y2hhbm5lbH0gdGltZWQgb3V0IHdhaXRpbmcgZm9yIGFwcCByZWFkeWApKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSwgQ0FMTF9USU1FT1VUKTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFByb2Nlc3MgYW55IHF1ZXVlZCBjYWxscyBvbmNlIGFwcCBpcyByZWFkeVxyXG4gKi9cclxuZnVuY3Rpb24gcHJvY2Vzc1BlbmRpbmdDYWxscygpIHtcclxuICAgIGNvbnNvbGUubG9nKGDwn5OoIFByb2Nlc3NpbmcgJHtwZW5kaW5nQ2FsbHMuc2l6ZX0gcGVuZGluZyBJUEMgY2FsbHNgKTtcclxuICAgIGZvciAoY29uc3QgW2lkLCB7IGNoYW5uZWwsIGFyZ3MsIHJlc29sdmUsIHJlamVjdCB9XSBvZiBwZW5kaW5nQ2FsbHMpIHtcclxuICAgICAgICBpcGNSZW5kZXJlci5pbnZva2UoY2hhbm5lbCwgLi4uYXJncylcclxuICAgICAgICAgICAgLnRoZW4ocmVzb2x2ZSlcclxuICAgICAgICAgICAgLmNhdGNoKHJlamVjdClcclxuICAgICAgICAgICAgLmZpbmFsbHkoKCkgPT4gcGVuZGluZ0NhbGxzLmRlbGV0ZShpZCkpO1xyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogQ2xlYW4gdXAgZXZlbnQgbGlzdGVuZXJzIG9uIHdpbmRvdyB1bmxvYWRcclxuICovXHJcbmZ1bmN0aW9uIGNsZWFudXBFdmVudExpc3RlbmVycygpIHtcclxuICAgIC8vIFJlbW92ZSBhbGwgZXZlbnQgbGlzdGVuZXJzXHJcbiAgICBpcGNSZW5kZXJlci5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2NvZGV4OmNvbnZlcnQ6cHJvZ3Jlc3MnKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygnY29kZXg6Y29udmVydDpzdGF0dXMnKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygnY29kZXg6Y29udmVydDpjb21wbGV0ZScpO1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdjb2RleDpjb252ZXJ0OmVycm9yJyk7XHJcbiAgICBpcGNSZW5kZXJlci5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2NvZGV4Om9mZmxpbmU6ZXZlbnQnKTtcclxuICAgIGlwY1JlbmRlcmVyLnJlbW92ZUFsbExpc3RlbmVycygnY29kZXg6ZmlsZS1kcm9wcGVkJyk7XHJcbiAgICBpcGNSZW5kZXJlci5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2NvZGV4OndhdGNoOmV2ZW50Jyk7XHJcbiAgICBpcGNSZW5kZXJlci5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2FwcDpyZWFkeScpO1xyXG4gICAgaXBjUmVuZGVyZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCdhcHA6ZXJyb3InKTtcclxufVxyXG5cclxuLy8gSGFuZGxlIGFwcCByZWFkeSBldmVudFxyXG5pcGNSZW5kZXJlci5vbignYXBwOnJlYWR5JywgKCkgPT4ge1xyXG4gICAgY29uc29sZS5sb2coJ/CfmoAgQXBwIHJlYWR5IGV2ZW50IHJlY2VpdmVkJyk7XHJcbiAgICBpc0FwcFJlYWR5ID0gdHJ1ZTtcclxuICAgIHByb2Nlc3NQZW5kaW5nQ2FsbHMoKTtcclxuICAgIGlmIChyZWFkeUNhbGxiYWNrKSB7XHJcbiAgICAgICAgcmVhZHlDYWxsYmFjaygpO1xyXG4gICAgfVxyXG59KTtcclxuXHJcbi8vIEhhbmRsZSBhcHAgZXJyb3JzXHJcbmlwY1JlbmRlcmVyLm9uKCdhcHA6ZXJyb3InLCAoXywgZXJyb3IpID0+IHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBBcHAgZXJyb3I6JywgZXJyb3IpO1xyXG59KTtcclxuXHJcbi8vIEV4cG9zZSBwcm90ZWN0ZWQgbWV0aG9kcyB0byByZW5kZXJlciBwcm9jZXNzXHJcbmNvbnRleHRCcmlkZ2UuZXhwb3NlSW5NYWluV29ybGQoJ2VsZWN0cm9uJywge1xyXG4gICAgLy8gQXBwIFN0YXR1c1xyXG4gICAgaXNSZWFkeTogKCkgPT4gaXNBcHBSZWFkeSxcclxuICAgIFxyXG4gICAgb25SZWFkeTogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaWYgKGlzQXBwUmVhZHkpIHtcclxuICAgICAgICAgICAgY2FsbGJhY2soKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZWFkeUNhbGxiYWNrID0gY2FsbGJhY2s7XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICAvLz09PSBDb252ZXJzaW9uIE9wZXJhdGlvbnMgPT09Ly9cclxuICAgIGNvbnZlcnQ6IGFzeW5jIChpbnB1dCwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgIC8vIEhhbmRsZSBBcnJheUJ1ZmZlciBjb252ZXJzaW9uIHRvIEJ1ZmZlciBmb3IgSVBDXHJcbiAgICAgICAgaWYgKG9wdGlvbnMuYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcclxuICAgICAgICAgICAgY29uc3QgYnVmZmVyID0gQnVmZmVyLmZyb20ob3B0aW9ucy5idWZmZXIpO1xyXG4gICAgICAgICAgICBvcHRpb25zLmJ1ZmZlciA9IGJ1ZmZlcjtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpmaWxlJywgW2lucHV0LCBvcHRpb25zXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBnZXRSZXN1bHQ6IGFzeW5jIChwYXRoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpnZXQtcmVzdWx0JywgW3BhdGhdKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGNhbmNlbFJlcXVlc3RzOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpjYW5jZWwnLCBbXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvLyBIZWxwZXIgbWV0aG9kIHRvIGxvZyBhbmQgcmVkaXJlY3QgdG8gZ2VuZXJpYyBjb252ZXJ0IG1ldGhvZFxyXG4gICAgX3JlZGlyZWN0VG9Db252ZXJ0OiBhc3luYyAoaW5wdXQsIG9wdGlvbnMsIHR5cGUpID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgUmVkaXJlY3RpbmcgJHt0eXBlfSBjb252ZXJzaW9uIHRvIGdlbmVyaWMgY29udmVydCBtZXRob2RgKTtcclxuICAgICAgICBvcHRpb25zLnR5cGUgPSB0eXBlO1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmNvbnZlcnQ6ZmlsZScsIFtpbnB1dCwgb3B0aW9uc10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy8gU3BlY2lhbGl6ZWQgY29udmVyc2lvbiBtZXRob2RzIHRoYXQgcmVkaXJlY3QgdG8gZ2VuZXJpYyBjb252ZXJ0XHJcbiAgICBjb252ZXJ0VXJsOiBhc3luYyAodXJsLCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgb3B0aW9ucy50eXBlID0gJ3VybCc7XHJcbiAgICAgICAgb3B0aW9ucy5pc1dlYiA9IHRydWU7XHJcbiAgICAgICAgY29uc29sZS5sb2coYENvbnZlcnRpbmcgVVJMOiAke3VybH0gKHJlZGlyZWN0aW5nIHRvIGdlbmVyaWMgY29udmVydClgLCBvcHRpb25zKTtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpjb252ZXJ0OmZpbGUnLCBbdXJsLCBvcHRpb25zXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBjb252ZXJ0UGFyZW50VXJsOiBhc3luYyAodXJsLCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgb3B0aW9ucy50eXBlID0gJ3BhcmVudHVybCc7XHJcbiAgICAgICAgb3B0aW9ucy5pc1dlYiA9IHRydWU7XHJcbiAgICAgICAgY29uc29sZS5sb2coYENvbnZlcnRpbmcgUGFyZW50IFVSTDogJHt1cmx9IChyZWRpcmVjdGluZyB0byBnZW5lcmljIGNvbnZlcnQpYCwgb3B0aW9ucyk7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpmaWxlJywgW3VybCwgb3B0aW9uc10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgY29udmVydFlvdXR1YmU6IGFzeW5jICh1cmwsIG9wdGlvbnMpID0+IHtcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICBvcHRpb25zLnR5cGUgPSAneW91dHViZSc7XHJcbiAgICAgICAgb3B0aW9ucy5pc1dlYiA9IHRydWU7XHJcbiAgICAgICAgY29uc29sZS5sb2coYENvbnZlcnRpbmcgWW91VHViZTogJHt1cmx9IChyZWRpcmVjdGluZyB0byBnZW5lcmljIGNvbnZlcnQpYCwgb3B0aW9ucyk7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Y29udmVydDpmaWxlJywgW3VybCwgb3B0aW9uc10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgY29udmVydEZpbGU6IGFzeW5jIChwYXRoLCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICAgICAgY29uc29sZS5sb2coYENvbnZlcnRpbmcgZmlsZTogJHtwYXRofSAocmVkaXJlY3RpbmcgdG8gZ2VuZXJpYyBjb252ZXJ0KWAsIG9wdGlvbnMpO1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmNvbnZlcnQ6ZmlsZScsIFtwYXRoLCBvcHRpb25zXSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvLz09PSBDb252ZXJzaW9uIEV2ZW50IEhhbmRsZXJzID09PS8vXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUmVnaXN0ZXIgY2FsbGJhY2sgZm9yIGNvbnZlcnNpb24gcHJvZ3Jlc3NcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIC0gUHJvZ3Jlc3MgY2FsbGJhY2tcclxuICAgICAqL1xyXG4gICAgb25Db252ZXJzaW9uUHJvZ3Jlc3M6IChjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLm9uKCdjb2RleDpjb252ZXJ0OnByb2dyZXNzJywgKF8sIHByb2dyZXNzKSA9PiBjYWxsYmFjayhwcm9ncmVzcykpO1xyXG4gICAgICAgIC8vIFJldHVybiBjbGVhbnVwIGZ1bmN0aW9uXHJcbiAgICAgICAgcmV0dXJuICgpID0+IHtcclxuICAgICAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4OmNvbnZlcnQ6cHJvZ3Jlc3MnLCBjYWxsYmFjayk7XHJcbiAgICAgICAgfTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUmVnaXN0ZXIgY2FsbGJhY2sgZm9yIGNvbnZlcnNpb24gc3RhdHVzXHJcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayAtIFN0YXR1cyBjYWxsYmFja1xyXG4gICAgICovXHJcbiAgICBvbkNvbnZlcnNpb25TdGF0dXM6IChjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLm9uKCdjb2RleDpjb252ZXJ0OnN0YXR1cycsIChfLCBzdGF0dXMpID0+IGNhbGxiYWNrKHN0YXR1cykpO1xyXG4gICAgICAgIC8vIFJldHVybiBjbGVhbnVwIGZ1bmN0aW9uXHJcbiAgICAgICAgcmV0dXJuICgpID0+IHtcclxuICAgICAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4OmNvbnZlcnQ6c3RhdHVzJywgY2FsbGJhY2spO1xyXG4gICAgICAgIH07XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlZ2lzdGVyIGNhbGxiYWNrIGZvciBjb252ZXJzaW9uIGNvbXBsZXRpb25cclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIC0gQ29tcGxldGlvbiBjYWxsYmFja1xyXG4gICAgICovXHJcbiAgICBvbkNvbnZlcnNpb25Db21wbGV0ZTogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIub24oJ2NvZGV4OmNvbnZlcnQ6Y29tcGxldGUnLCAoXywgcmVzdWx0KSA9PiBjYWxsYmFjayhyZXN1bHQpKTtcclxuICAgICAgICAvLyBSZXR1cm4gY2xlYW51cCBmdW5jdGlvblxyXG4gICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgIGlwY1JlbmRlcmVyLnJlbW92ZUxpc3RlbmVyKCdjb2RleDpjb252ZXJ0OmNvbXBsZXRlJywgY2FsbGJhY2spO1xyXG4gICAgICAgIH07XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFJlZ2lzdGVyIGNhbGxiYWNrIGZvciBjb252ZXJzaW9uIGVycm9yc1xyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgLSBFcnJvciBjYWxsYmFja1xyXG4gICAgICovXHJcbiAgICBvbkNvbnZlcnNpb25FcnJvcjogKGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIub24oJ2NvZGV4OmNvbnZlcnQ6ZXJyb3InLCAoXywgZXJyb3IpID0+IGNhbGxiYWNrKGVycm9yKSk7XHJcbiAgICAgICAgLy8gUmV0dXJuIGNsZWFudXAgZnVuY3Rpb25cclxuICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcignY29kZXg6Y29udmVydDplcnJvcicsIGNhbGxiYWNrKTtcclxuICAgICAgICB9O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZW1vdmUgY29udmVyc2lvbiBwcm9ncmVzcyBsaXN0ZW5lclxyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gbGlzdGVuZXIgLSBQcm9ncmVzcyBsaXN0ZW5lciB0byByZW1vdmVcclxuICAgICAqL1xyXG4gICAgb2ZmQ29udmVyc2lvblByb2dyZXNzOiAobGlzdGVuZXIpID0+IHtcclxuICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcignY29kZXg6Y29udmVydDpwcm9ncmVzcycsIGxpc3RlbmVyKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUmVtb3ZlIGNvbnZlcnNpb24gc3RhdHVzIGxpc3RlbmVyXHJcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBsaXN0ZW5lciAtIFN0YXR1cyBsaXN0ZW5lciB0byByZW1vdmVcclxuICAgICAqL1xyXG4gICAgb2ZmQ29udmVyc2lvblN0YXR1czogKGxpc3RlbmVyKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4OmNvbnZlcnQ6c3RhdHVzJywgbGlzdGVuZXIpO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBSZW1vdmUgY29udmVyc2lvbiBjb21wbGV0ZSBsaXN0ZW5lclxyXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gbGlzdGVuZXIgLSBDb21wbGV0ZSBsaXN0ZW5lciB0byByZW1vdmVcclxuICAgICAqL1xyXG4gICAgb2ZmQ29udmVyc2lvbkNvbXBsZXRlOiAobGlzdGVuZXIpID0+IHtcclxuICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcignY29kZXg6Y29udmVydDpjb21wbGV0ZScsIGxpc3RlbmVyKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUmVtb3ZlIGNvbnZlcnNpb24gZXJyb3IgbGlzdGVuZXJcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyIC0gRXJyb3IgbGlzdGVuZXIgdG8gcmVtb3ZlXHJcbiAgICAgKi9cclxuICAgIG9mZkNvbnZlcnNpb25FcnJvcjogKGxpc3RlbmVyKSA9PiB7XHJcbiAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4OmNvbnZlcnQ6ZXJyb3InLCBsaXN0ZW5lcik7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvLz09PSBGaWxlIFN5c3RlbSBPcGVyYXRpb25zID09PS8vXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogU2VsZWN0IGZpbGVzIGZvciBjb252ZXJzaW9uXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIFNlbGVjdGlvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIHNlbGVjdEZpbGVzOiBhc3luYyAob3B0aW9ucykgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnNlbGVjdC1maWxlcycsIG9wdGlvbnMpO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBTZWxlY3QgZGlyZWN0b3J5IGZvciBvdXRwdXRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gU2VsZWN0aW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgc2VsZWN0RGlyZWN0b3J5OiBhc3luYyAob3B0aW9ucykgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOnNlbGVjdC1kaXJlY3RvcnknLCBvcHRpb25zKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogU2VsZWN0IGlucHV0IGRpcmVjdG9yeVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBTZWxlY3Rpb24gb3B0aW9uc1xyXG4gICAgICovXHJcbiAgICBzZWxlY3RJbnB1dERpcmVjdG9yeTogYXN5bmMgKG9wdGlvbnMpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczpzZWxlY3QtaW5wdXQtZGlyZWN0b3J5Jywgb3B0aW9ucyk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFNlbGVjdCBvdXRwdXQgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIFNlbGVjdGlvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIHNlbGVjdE91dHB1dDogYXN5bmMgKG9wdGlvbnMpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczpzZWxlY3Qtb3V0cHV0Jywgb3B0aW9ucyk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIExpc3QgZGlyZWN0b3J5IGNvbnRlbnRzXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIERpcmVjdG9yeSBwYXRoXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIExpc3Rpbmcgb3B0aW9uc1xyXG4gICAgICovXHJcbiAgICBsaXN0RGlyZWN0b3J5RGV0YWlsZWQ6IGFzeW5jIChwYXRoLCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6ZnM6bGlzdC1kaXJlY3RvcnknLCB7IHBhdGgsIC4uLm9wdGlvbnMgfSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFNob3cgaXRlbSBpbiBmb2xkZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gSXRlbSBwYXRoXHJcbiAgICAgKi9cclxuICAgIHNob3dJdGVtSW5Gb2xkZXI6IGFzeW5jIChwYXRoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6c2hvdy1pdGVtLWluLWZvbGRlcicsIHBhdGgpO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgZmlsZSBvciBkaXJlY3Rvcnkgc3RhdHNcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gUGF0aCB0byBjaGVja1xyXG4gICAgICovXHJcbiAgICBnZXRTdGF0czogYXN5bmMgKHBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczpzdGF0cycsIHsgcGF0aCB9KTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUmVhZCBmaWxlIGNvbnRlbnRzXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIEZpbGUgcGF0aFxyXG4gICAgICovXHJcbiAgICByZWFkRmlsZTogYXN5bmMgKHBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczpyZWFkJywgeyBwYXRoIH0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBXcml0ZSBjb250ZW50IHRvIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gRmlsZSBwYXRoXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ3xCdWZmZXJ9IGNvbnRlbnQgLSBGaWxlIGNvbnRlbnRcclxuICAgICAqL1xyXG4gICAgd3JpdGVGaWxlOiBhc3luYyAocGF0aCwgY29udGVudCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpcGNSZW5kZXJlci5pbnZva2UoJ2NvZGV4OmZzOndyaXRlJywgeyBwYXRoLCBjb250ZW50IH0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBDcmVhdGUgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIERpcmVjdG9yeSBwYXRoXHJcbiAgICAgKi9cclxuICAgIGNyZWF0ZURpcmVjdG9yeTogYXN5bmMgKHBhdGgpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaXBjUmVuZGVyZXIuaW52b2tlKCdjb2RleDpmczpta2RpcicsIHsgcGF0aCB9KTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogTW92ZSBmaWxlIG9yIGRpcmVjdG9yeVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHNvdXJjZVBhdGggLSBTb3VyY2UgcGF0aFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGRlc3RQYXRoIC0gRGVzdGluYXRpb24gcGF0aFxyXG4gICAgICovXHJcbiAgICBtb3ZlSXRlbTogYXN5bmMgKHNvdXJjZVBhdGgsIGRlc3RQYXRoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6ZnM6bW92ZScsIHsgc291cmNlUGF0aCwgZGVzdFBhdGggfSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIERlbGV0ZSBmaWxlIG9yIGRpcmVjdG9yeVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBQYXRoIHRvIGRlbGV0ZVxyXG4gICAgICogQHBhcmFtIHtib29sZWFufSByZWN1cnNpdmUgLSBXaGV0aGVyIHRvIGRlbGV0ZSByZWN1cnNpdmVseVxyXG4gICAgICovXHJcbiAgICBkZWxldGVJdGVtOiBhc3luYyAocGF0aCwgcmVjdXJzaXZlKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6ZnM6ZGVsZXRlJywgeyBwYXRoLCByZWN1cnNpdmUgfSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIE9wZW4gZXh0ZXJuYWwgVVJMIG9yIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgb3IgZmlsZSBwYXRoIHRvIG9wZW5cclxuICAgICAqL1xyXG4gICAgb3BlbkV4dGVybmFsOiBhc3luYyAodXJsKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGlwY1JlbmRlcmVyLmludm9rZSgnY29kZXg6b3Blbi1leHRlcm5hbCcsIHVybCk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvLz09PSBTZXR0aW5ncyBNYW5hZ2VtZW50ID09PS8vXHJcbiAgICBnZXRTZXR0aW5nOiBhc3luYyAoa2V5KSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6Z2V0LXNldHRpbmcnLCBba2V5XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBzZXRTZXR0aW5nOiBhc3luYyAoa2V5LCB2YWx1ZSkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OnNldC1zZXR0aW5nJywgW2tleSwgdmFsdWVdKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vIE9DUiBzcGVjaWZpYyBzZXR0aW5nc1xyXG4gICAgc2V0T2NyRW5hYmxlZDogYXN5bmMgKHsgZW5hYmxlZCB9KSA9PiB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtQcmVsb2FkXSBTZXR0aW5nIE9DUiBlbmFibGVkIHRvOiAke2VuYWJsZWR9ICh0eXBlOiAke3R5cGVvZiBlbmFibGVkfSlgKTtcclxuICAgICAgICAvLyBFbnN1cmUgZW5hYmxlZCBpcyBhIGJvb2xlYW5cclxuICAgICAgICBjb25zdCBib29sRW5hYmxlZCA9IEJvb2xlYW4oZW5hYmxlZCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtQcmVsb2FkXSBDb252ZXJ0ZWQgdG8gYm9vbGVhbjogJHtib29sRW5hYmxlZH0gKHR5cGU6ICR7dHlwZW9mIGJvb2xFbmFibGVkfSlgKTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBxdWV1ZUNhbGwoJ2NvZGV4OnNldHRpbmdzOnNldC1vY3ItZW5hYmxlZCcsIFt7IGVuYWJsZWQ6IGJvb2xFbmFibGVkIH1dKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW1ByZWxvYWRdIFJlc3VsdCBmcm9tIHNldHRpbmcgT0NSIGVuYWJsZWQ6YCwgcmVzdWx0KTtcclxuICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgZ2V0T2NyRW5hYmxlZDogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHF1ZXVlQ2FsbCgnY29kZXg6c2V0dGluZ3M6Z2V0LW9jci1lbmFibGVkJywgW10pO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbUHJlbG9hZF0gR290IE9DUiBlbmFibGVkOiAke3Jlc3VsdH0gKHR5cGU6ICR7dHlwZW9mIHJlc3VsdH0pYCk7XHJcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8vPT09IEFQSSBLZXkgTWFuYWdlbWVudCA9PT0vL1xyXG4gICAgc2F2ZUFwaUtleTogYXN5bmMgKGtleSwgcHJvdmlkZXIgPSAnb3BlbmFpJykgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmFwaWtleTpzYXZlJywgW3sga2V5LCBwcm92aWRlciB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBjaGVja0FwaUtleUV4aXN0czogYXN5bmMgKHByb3ZpZGVyID0gJ29wZW5haScpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDphcGlrZXk6ZXhpc3RzJywgW3sgcHJvdmlkZXIgfV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgZGVsZXRlQXBpS2V5OiBhc3luYyAocHJvdmlkZXIgPSAnb3BlbmFpJykgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmFwaWtleTpkZWxldGUnLCBbeyBwcm92aWRlciB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICB2YWxpZGF0ZUFwaUtleTogYXN5bmMgKGtleSwgcHJvdmlkZXIgPSAnb3BlbmFpJykgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmFwaWtleTp2YWxpZGF0ZScsIFt7IGtleSwgcHJvdmlkZXIgfV0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgZ2V0QXBpS2V5OiBhc3luYyAocHJvdmlkZXIgPSAnb3BlbmFpJykgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmFwaWtleTpnZXQnLCBbeyBwcm92aWRlciB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvLz09PSBPZmZsaW5lIEZ1bmN0aW9uYWxpdHkgPT09Ly9cclxuICAgIGdldE9mZmxpbmVTdGF0dXM6IGFzeW5jICgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpvZmZsaW5lOnN0YXR1cycsIFtdKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGdldFF1ZXVlZE9wZXJhdGlvbnM6IGFzeW5jICgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpvZmZsaW5lOnF1ZXVlZC1vcGVyYXRpb25zJywgW10pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgcXVldWVPcGVyYXRpb246IGFzeW5jIChvcGVyYXRpb24pID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpvZmZsaW5lOnF1ZXVlLW9wZXJhdGlvbicsIFtvcGVyYXRpb25dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGNhY2hlRGF0YTogYXN5bmMgKGtleSwgZGF0YSkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4Om9mZmxpbmU6Y2FjaGUtZGF0YScsIFt7IGtleSwgZGF0YSB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBnZXRDYWNoZWREYXRhOiBhc3luYyAoa2V5LCBtYXhBZ2UpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpvZmZsaW5lOmdldC1jYWNoZWQtZGF0YScsIFt7IGtleSwgbWF4QWdlIH1dKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGludmFsaWRhdGVDYWNoZTogYXN5bmMgKGtleSkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4Om9mZmxpbmU6aW52YWxpZGF0ZS1jYWNoZScsIFt7IGtleSB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBjbGVhckNhY2hlOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6b2ZmbGluZTpjbGVhci1jYWNoZScsIFtdKTtcclxuICAgIH0sXHJcbiAgICAvLyBFdmVudCBoYW5kbGVycyBkb24ndCBuZWVkIHF1ZXVlaW5nIHNpbmNlIHRoZXkganVzdCByZWdpc3RlciBjYWxsYmFja3NcclxuICAgIG9uT2ZmbGluZUV2ZW50OiAoY2FsbGJhY2spID0+IHtcclxuICAgICAgICBpcGNSZW5kZXJlci5vbignY29kZXg6b2ZmbGluZTpldmVudCcsIChfLCBkYXRhKSA9PiBjYWxsYmFjayhkYXRhKSk7XHJcbiAgICAgICAgcmV0dXJuICgpID0+IHtcclxuICAgICAgICAgICAgaXBjUmVuZGVyZXIucmVtb3ZlTGlzdGVuZXIoJ2NvZGV4Om9mZmxpbmU6ZXZlbnQnLCBjYWxsYmFjayk7XHJcbiAgICAgICAgfTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUmVnaXN0ZXIgY2FsbGJhY2sgZm9yIGZpbGUgZHJvcCBldmVudHNcclxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIC0gRmlsZSBkcm9wIGNhbGxiYWNrXHJcbiAgICAgKi9cclxuICAgIG9uRmlsZURyb3BwZWQ6IChjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIGlwY1JlbmRlcmVyLm9uKCdjb2RleDpmaWxlLWRyb3BwZWQnLCAoXywgZmlsZXMpID0+IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZpbGUgZHJvcHBlZCBldmVudCByZWNlaXZlZDonLCBmaWxlcyk7XHJcbiAgICAgICAgICAgIGNhbGxiYWNrKGZpbGVzKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICBpcGNSZW5kZXJlci5yZW1vdmVMaXN0ZW5lcignY29kZXg6ZmlsZS1kcm9wcGVkJywgY2FsbGJhY2spO1xyXG4gICAgICAgIH07XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICAvLz09PSBUcmFuc2NyaXB0aW9uID09PS8vXHJcbiAgICB0cmFuc2NyaWJlQXVkaW86IGFzeW5jIChmaWxlUGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OnRyYW5zY3JpYmU6YXVkaW8nLCBbeyBmaWxlUGF0aCB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICB0cmFuc2NyaWJlVmlkZW86IGFzeW5jIChmaWxlUGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OnRyYW5zY3JpYmU6dmlkZW8nLCBbeyBmaWxlUGF0aCB9XSk7XHJcbiAgICB9LFxyXG4gICAgXHJcbiAgICBnZXRUcmFuc2NyaXB0aW9uTW9kZWw6IGFzeW5jICgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpnZXQtc2V0dGluZycsIFsndHJhbnNjcmlwdGlvbi5tb2RlbCddKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIHNldFRyYW5zY3JpcHRpb25Nb2RlbDogYXN5bmMgKG1vZGVsKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHF1ZXVlQ2FsbCgnY29kZXg6c2V0LXNldHRpbmcnLCBbJ3RyYW5zY3JpcHRpb24ubW9kZWwnLCBtb2RlbF0pO1xyXG4gICAgfSxcclxuICAgIFxyXG4gICAgLy89PT0gQXBwbGljYXRpb24gPT09Ly9cclxuICAgIGdldFZlcnNpb246IGFzeW5jICgpID0+IHtcclxuICAgICAgICByZXR1cm4gcXVldWVDYWxsKCdjb2RleDpnZXQtdmVyc2lvbicsIFtdKTtcclxuICAgIH0sXHJcbiAgICBcclxuICAgIGNoZWNrVXBkYXRlczogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBxdWV1ZUNhbGwoJ2NvZGV4OmNoZWNrLXVwZGF0ZXMnLCBbXSk7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuLy8gQ2xlYW4gdXAgd2hlbiB3aW5kb3cgdW5sb2Fkc1xyXG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigndW5sb2FkJywgY2xlYW51cEV2ZW50TGlzdGVuZXJzKTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNO0VBQUVBLGFBQWE7RUFBRUM7QUFBWSxDQUFDLEdBQUdDLE9BQU8sQ0FBQyxVQUFVLENBQUM7O0FBRTFEO0FBQ0FDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHVDQUF1QyxDQUFDO0FBQ3BELElBQUk7RUFDQTtFQUNBRCxPQUFPLENBQUNDLEdBQUcsQ0FBQyxzQkFBc0IsRUFBRSxPQUFPQyxVQUFVLEtBQUssV0FBVyxHQUFHQSxVQUFVLEdBQUcsb0JBQW9CLENBQUM7QUFDOUcsQ0FBQyxDQUFDLE9BQU9DLEtBQUssRUFBRTtFQUNaSCxPQUFPLENBQUNDLEdBQUcsQ0FBQywwQ0FBMEMsRUFBRUUsS0FBSyxDQUFDQyxPQUFPLENBQUM7QUFDMUU7QUFDQUosT0FBTyxDQUFDQyxHQUFHLENBQUMsc0NBQXNDLENBQUM7O0FBRW5EO0FBQ0EsSUFBSUksVUFBVSxHQUFHLEtBQUs7QUFDdEIsTUFBTUMsWUFBWSxHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDO0FBQzlCLElBQUlDLGFBQWEsR0FBRyxJQUFJO0FBQ3hCLE1BQU1DLFlBQVksR0FBRyxLQUFLLENBQUMsQ0FBQzs7QUFFNUI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBU0MsU0FBU0EsQ0FBQ0MsT0FBTyxFQUFFQyxJQUFJLEVBQUU7RUFDOUIsT0FBTyxJQUFJQyxPQUFPLENBQUMsQ0FBQ0MsT0FBTyxFQUFFQyxNQUFNLEtBQUs7SUFDcEMsSUFBSVYsVUFBVSxF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