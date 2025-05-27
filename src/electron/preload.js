/**
 * Preload Script
 * Exposes specific Electron APIs to the renderer process
 * 
 * This script creates a secure bridge between the renderer process and the main process,
 * exposing only the necessary functionality while maintaining security through contextIsolation.
 * 
 * Includes initialization tracking and IPC call queueing to ensure reliable communication.
 */

const { contextBridge, ipcRenderer } = require('electron');

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
            ipcRenderer.invoke(channel, ...args)
                .then(resolve)
                .catch(reject);
        } else {
            // Queue the call
            const id = Date.now().toString();
            pendingCalls.set(id, { channel, args, resolve, reject });
            
            // Set timeout for queued calls
            setTimeout(() => {
                if (pendingCalls.has(id)) {
                    const { reject } = pendingCalls.get(id);
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
    for (const [id, { channel, args, resolve, reject }] of pendingCalls) {
        ipcRenderer.invoke(channel, ...args)
            .then(resolve)
            .catch(reject)
            .finally(() => pendingCalls.delete(id));
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
    
    onReady: (callback) => {
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
    
    getResult: async (path) => {
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
    cancelParentUrlConversion: async (conversionId) => {
        return queueCall('convert:parent-url:cancel', [{ conversionId }]);
    },
    
    //=== Conversion Event Handlers ===//
    
    /**
     * Register callback for conversion progress
     * @param {Function} callback - Progress callback
     */
    onConversionProgress: (callback) => {
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
    onConversionStatus: (callback) => {
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
    onConversionComplete: (callback) => {
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
    onConversionError: (callback) => {
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
    offConversionProgress: (listener) => {
        ipcRenderer.removeListener('codex:convert:progress', listener);
    },
    
    /**
     * Remove conversion status listener
     * @param {Function} listener - Status listener to remove
     */
    offConversionStatus: (listener) => {
        ipcRenderer.removeListener('codex:convert:status', listener);
    },
    
    /**
     * Remove conversion complete listener
     * @param {Function} listener - Complete listener to remove
     */
    offConversionComplete: (listener) => {
        ipcRenderer.removeListener('codex:convert:complete', listener);
    },
    
    /**
     * Remove conversion error listener
     * @param {Function} listener - Error listener to remove
     */
    offConversionError: (listener) => {
        ipcRenderer.removeListener('codex:convert:error', listener);
    },
    
    //=== Parent URL Conversion Events ===//
    
    /**
     * Register callback for parent URL conversion progress
     * @param {Function} callback - Progress callback
     */
    onParentUrlProgress: (callback) => {
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
    onParentUrlStarted: (callback) => {
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
    onParentUrlCancelling: (callback) => {
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
    selectFiles: async (options) => {
        return await ipcRenderer.invoke('codex:fs:select-files', options);
    },
    
    /**
     * Select directory for output
     * @param {Object} options - Selection options
     */
    selectDirectory: async (options) => {
        return await ipcRenderer.invoke('codex:fs:select-directory', options);
    },
    
    /**
     * Select input directory
     * @param {Object} options - Selection options
     */
    selectInputDirectory: async (options) => {
        return await ipcRenderer.invoke('codex:fs:select-input-directory', options);
    },
    
    /**
     * Select output directory
     * @param {Object} options - Selection options
     */
    selectOutput: async (options) => {
        return await ipcRenderer.invoke('codex:fs:select-output', options);
    },
    
    /**
     * List directory contents
     * @param {string} path - Directory path
     * @param {Object} options - Listing options
     */
    listDirectoryDetailed: async (path, options) => {
        return await ipcRenderer.invoke('codex:fs:list-directory', { path, ...options });
    },
    
    /**
     * Show item in folder
     * @param {string} path - Item path
     */
    showItemInFolder: async (path) => {
        return await ipcRenderer.invoke('codex:show-item-in-folder', path);
    },
    
    /**
     * Get file or directory stats
     * @param {string} path - Path to check
     */
    getStats: async (path) => {
        return await ipcRenderer.invoke('codex:fs:stats', { path });
    },
    
    /**
     * Read file contents
     * @param {string} path - File path
     */
    readFile: async (path) => {
        return await ipcRenderer.invoke('codex:fs:read', { path });
    },
    
    /**
     * Write content to file
     * @param {string} path - File path
     * @param {string|Buffer} content - File content
     */
    writeFile: async (path, content) => {
        return await ipcRenderer.invoke('codex:fs:write', { path, content });
    },
    
    /**
     * Create directory
     * @param {string} path - Directory path
     */
    createDirectory: async (path) => {
        return await ipcRenderer.invoke('codex:fs:mkdir', { path });
    },
    
    /**
     * Move file or directory
     * @param {string} sourcePath - Source path
     * @param {string} destPath - Destination path
     */
    moveItem: async (sourcePath, destPath) => {
        return await ipcRenderer.invoke('codex:fs:move', { sourcePath, destPath });
    },
    
    /**
     * Delete file or directory
     * @param {string} path - Path to delete
     * @param {boolean} recursive - Whether to delete recursively
     */
    deleteItem: async (path, recursive) => {
        return await ipcRenderer.invoke('codex:fs:delete', { path, recursive });
    },
    
    /**
     * Open external URL or file
     * @param {string} url - URL or file path to open
     */
    openExternal: async (url) => {
        return await ipcRenderer.invoke('codex:open-external', url);
    },
    
    //=== Settings Management ===//
    getSetting: async (key) => {
        return queueCall('codex:get-setting', [key]);
    },
    
    setSetting: async (key, value) => {
        return queueCall('codex:set-setting', [key, value]);
    },
    
    // OCR specific settings
    setOcrEnabled: async ({ enabled }) => {
        console.log(`[Preload] Setting OCR enabled to: ${enabled} (type: ${typeof enabled})`);
        // Ensure enabled is a boolean
        const boolEnabled = Boolean(enabled);
        console.log(`[Preload] Converted to boolean: ${boolEnabled} (type: ${typeof boolEnabled})`);
        
        const result = await queueCall('codex:settings:set-ocr-enabled', [{ enabled: boolEnabled }]);
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
        return queueCall('codex:apikey:save', [{ key, provider }]);
    },
    
    checkApiKeyExists: async (provider = 'openai') => {
        return queueCall('codex:apikey:exists', [{ provider }]);
    },
    
    deleteApiKey: async (provider = 'openai') => {
        return queueCall('codex:apikey:delete', [{ provider }]);
    },
    
    validateApiKey: async (key, provider = 'openai') => {
        return queueCall('codex:apikey:validate', [{ key, provider }]);
    },
    
    getApiKey: async (provider = 'openai') => {
        return queueCall('codex:apikey:get', [{ provider }]);
    },
    
    //=== Offline Functionality ===//
    getOfflineStatus: async () => {
        return queueCall('codex:offline:status', []);
    },
    
    getQueuedOperations: async () => {
        return queueCall('codex:offline:queued-operations', []);
    },
    
    queueOperation: async (operation) => {
        return queueCall('codex:offline:queue-operation', [operation]);
    },
    
    cacheData: async (key, data) => {
        return queueCall('codex:offline:cache-data', [{ key, data }]);
    },
    
    getCachedData: async (key, maxAge) => {
        return queueCall('codex:offline:get-cached-data', [{ key, maxAge }]);
    },
    
    invalidateCache: async (key) => {
        return queueCall('codex:offline:invalidate-cache', [{ key }]);
    },
    
    clearCache: async () => {
        return queueCall('codex:offline:clear-cache', []);
    },
    // Event handlers don't need queueing since they just register callbacks
    onOfflineEvent: (callback) => {
        ipcRenderer.on('codex:offline:event', (_, data) => callback(data));
        return () => {
            ipcRenderer.removeListener('codex:offline:event', callback);
        };
    },
    
    /**
     * Register callback for file drop events
     * @param {Function} callback - File drop callback
     */
    onFileDropped: (callback) => {
        ipcRenderer.on('codex:file-dropped', (_, files) => {
            console.log('File dropped event received:', files);
            callback(files);
        });
        return () => {
            ipcRenderer.removeListener('codex:file-dropped', callback);
        };
    },
    
    //=== Transcription ===//
    transcribeAudio: async (filePath) => {
        return queueCall('codex:transcribe:audio', [{ filePath }]);
    },

    transcribeVideo: async (filePath) => {
        return queueCall('codex:transcribe:video', [{ filePath }]);
    },

    getTranscriptionModel: async () => {
        return queueCall('codex:get-setting', ['transcription.model']);
    },

    setTranscriptionModel: async (model) => {
        return queueCall('codex:set-setting', ['transcription.model', model]);
    },

    // Enhanced Deepgram API key handlers - added to provide more reliable API key handling
    getDeepgramApiKey: async () => {
        console.log('[Preload] Getting Deepgram API key');
        try {
            // First try dedicated handler
            const result = await queueCall('codex:transcription:get-api-key', []);
            console.log('[Preload] Deepgram API key retrieval result:',
                result ? (result.hasKey ? 'Found key' : 'No key found') : 'No result');
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
                    source: directKey ? 'direct' : (nestedKey ? 'nested' : 'none')
                };
            } catch (fallbackError) {
                console.error('[Preload] Fallback error getting Deepgram API key:', fallbackError);
                throw error; // Throw original error
            }
        }
    },

    setDeepgramApiKey: async (apiKey) => {
        console.log('[Preload] Setting Deepgram API key');
        try {
            // First try dedicated handler
            const result = await queueCall('codex:transcription:set-api-key', [{ apiKey }]);
            console.log('[Preload] Deepgram API key set result:', result);

            // Also set the key for the ApiKeyService for better compatibility
            try {
                await queueCall('codex:apikey:save', [{ key: apiKey, provider: 'deepgram' }]);
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
                return { success: true };
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
