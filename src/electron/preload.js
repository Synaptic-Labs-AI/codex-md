/**
 * Preload script that runs in a privileged context before the renderer process.
 * Provides secure bridge between main and renderer processes via contextBridge.
 * Exposes only specifically allowed APIs to the renderer.
 *
 * TEMPORARILY MODIFIED: Batch processing functionality has been disabled to simplify
 * the application to only handle one item at a time.
 *
 * Related files:
 * - main.js: Main process entry point
 * - ipc/types.js: TypeScript definitions for IPC messages
 * - ipc/handlers/*.js: IPC handler implementations
 */

const { contextBridge, ipcRenderer } = require('electron');

// Add enhanced error handling and logging for IPC events
const safeIpcHandler = (channel, callback) => {
  console.log('[IPC Preload] Creating handler for channel:', channel);
  
  return (event, ...args) => {
    try {
      // Log all incoming IPC events
      console.log('[IPC Preload] Event received:', {
        channel,
        args,
        hasData: args && args.length > 0,
        dataType: args && args.length > 0 ? typeof args[0] : 'undefined',
        timestamp: new Date().toISOString()
      });

      // For conversion events, log detailed data structure
      if (channel === 'mdcode:convert:progress' || channel === 'mdcode:convert:status') {
        const data = args[0];
        console.log('[IPC Preload] Conversion event details:', {
          channel,
          eventType: channel.split(':')[2],
          status: data?.status,
          hasWebsiteData: !!(data?.websiteUrl || data?.currentUrl),
          progress: data?.progress,
          processedCount: data?.processedCount,
          totalCount: data?.totalCount,
          currentUrl: data?.currentUrl,
          timestamp: new Date().toISOString()
        });

        // Special handling for website conversion events
        if (data?.websiteUrl) {
          console.log('[IPC Preload] Website conversion status:', {
            status: data.status,
            websiteUrl: data.websiteUrl,
            currentUrl: data.currentUrl,
            processedCount: data.processedCount,
            totalCount: data.totalCount,
            progress: data.progress,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Check if data is defined before processing
      if (args && args.length > 0) {
        callback(event, ...args);
      } else {
        console.warn(`[IPC Preload] Received undefined data on channel: ${channel}`, {
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error(`[IPC Preload] Error handling event on channel ${channel}:`, {
        error: error.message,
        stack: error.stack,
        args: args,
        timestamp: new Date().toISOString()
      });
    }
  };
};

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electronAPI',
  {
    // Conversion operations
    convertFile: (path, options) => ipcRenderer.invoke('mdcode:convert:file', { path, options }),
    // TEMPORARILY MODIFIED: Batch processing is disabled, this will only process the first item
    convertBatch: (items, options) => ipcRenderer.invoke('mdcode:convert:batch', { items, options }),
    convertUrl: (url, options) => ipcRenderer.invoke('mdcode:convert:url', { url, options }),
    convertParentUrl: (url, options) => ipcRenderer.invoke('mdcode:convert:parent-url', { url, options }),
    convertYoutube: (url, options) => ipcRenderer.invoke('mdcode:convert:youtube', { url, options }),
    selectFiles: () => ipcRenderer.invoke('mdcode:convert:select-files'),
    selectOutput: () => ipcRenderer.invoke('mdcode:convert:select-output'),
    getResult: (path) => ipcRenderer.invoke('mdcode:convert:get-result', { path }),

    // File system operations
    readFile: (path) => ipcRenderer.invoke('mdcode:fs:read', { path }),
    writeFile: (path, content) => ipcRenderer.invoke('mdcode:fs:write', { path, content }),
    createDirectory: (path) => ipcRenderer.invoke('mdcode:fs:mkdir', { path }),
    listDirectory: (path, options) => ipcRenderer.invoke('mdcode:fs:list', { path, ...options }),
    listDirectoryDetailed: (path, options) => ipcRenderer.invoke('mdcode:fs:list-directory', { path, ...options }),
    deleteItem: (path, recursive) => ipcRenderer.invoke('mdcode:fs:delete', { path, recursive }),
    getStats: (path) => ipcRenderer.invoke('mdcode:fs:stats', { path }),
    moveItem: (sourcePath, destPath) => ipcRenderer.invoke('mdcode:fs:move', { sourcePath, destPath }),
    selectInputDirectory: (options) => ipcRenderer.invoke('mdcode:fs:select-input-directory', options),
    
    // Large file transfer operations
    initLargeFileTransfer: (params) => ipcRenderer.invoke('mdcode:fs:init-large-file-transfer', params),
    transferFileChunk: (params) => ipcRenderer.invoke('mdcode:fs:transfer-file-chunk', params),
    finalizeLargeFileTransfer: (params) => ipcRenderer.invoke('mdcode:fs:finalize-large-file-transfer', params),
    
    // Settings management
    getSetting: (key) => ipcRenderer.invoke('mdcode:get-setting', key),
    setSetting: (key, value) => ipcRenderer.invoke('mdcode:set-setting', key, value),
    getOcrEnabled: () => ipcRenderer.invoke('mdcode:settings:get-ocr-enabled'),
    setOcrEnabled: (enabled) => ipcRenderer.invoke('mdcode:settings:set-ocr-enabled', { enabled }),
    
    // Application
    getVersion: () => ipcRenderer.invoke('mdcode:get-version'),
    checkForUpdates: () => ipcRenderer.invoke('mdcode:check-updates'),
    
    // System integration
    showItemInFolder: (path) => ipcRenderer.invoke('mdcode:show-item-in-folder', path),
    openExternal: (url) => ipcRenderer.invoke('mdcode:open-external', url),
    
    // File watching
    watchStart: (paths, options) => ipcRenderer.invoke('mdcode:watch:start', { paths, options }),
    watchStop: (watchId) => ipcRenderer.invoke('mdcode:watch:stop', { watchId }),
    acquireLock: (path, options) => ipcRenderer.invoke('mdcode:watch:lock', { path, options }),
    releaseLock: (path) => ipcRenderer.invoke('mdcode:watch:unlock', { path }),
    isLocked: (path) => ipcRenderer.invoke('mdcode:watch:is-locked', { path }),
    
    // Offline functionality
    getOfflineStatus: () => ipcRenderer.invoke('mdcode:offline:status'),
    getQueuedOperations: () => ipcRenderer.invoke('mdcode:offline:queued-operations'),
    queueOperation: (operation) => ipcRenderer.invoke('mdcode:offline:queue-operation', operation),
    cacheData: (key, data) => ipcRenderer.invoke('mdcode:offline:cache-data', { key, data }),
    getCachedData: (key, maxAge) => ipcRenderer.invoke('mdcode:offline:get-cached-data', { key, maxAge }),
    invalidateCache: (key) => ipcRenderer.invoke('mdcode:offline:invalidate-cache', { key }),
    clearCache: () => ipcRenderer.invoke('mdcode:offline:clear-cache'),
    
    // API Key management
    saveApiKey: (key, provider) => ipcRenderer.invoke('mdcode:apikey:save', { key, provider }),
    checkApiKeyExists: (provider) => ipcRenderer.invoke('mdcode:apikey:exists', { provider }),
    deleteApiKey: (provider) => ipcRenderer.invoke('mdcode:apikey:delete', { provider }),
    validateApiKey: (key, provider) => ipcRenderer.invoke('mdcode:apikey:validate', { key, provider }),
    getApiKey: (provider) => ipcRenderer.invoke('mdcode:apikey:get', { provider }),
    
    // Transcription
    transcribeAudio: (filePath) => ipcRenderer.invoke('mdcode:transcribe:audio', { filePath }),
    transcribeVideo: (filePath) => ipcRenderer.invoke('mdcode:transcribe:video', { filePath }),
    getTranscriptionModel: () => ipcRenderer.invoke('mdcode:transcription:get-model'),
    setTranscriptionModel: (model) => ipcRenderer.invoke('mdcode:transcription:set-model', { model }),
    
    // Events with on/off functionality - using safeIpcHandler to prevent errors
    onFileDropped: (callback) => {
      const safeCallback = safeIpcHandler('mdcode:file-dropped', callback);
      ipcRenderer.on('mdcode:file-dropped', safeCallback);
      return safeCallback; // Return for removal reference
    },
    offFileDropped: (callback) => ipcRenderer.removeListener('mdcode:file-dropped', callback),
    
    onUpdateAvailable: (callback) => {
      const safeCallback = safeIpcHandler('mdcode:update-available', callback);
      ipcRenderer.on('mdcode:update-available', safeCallback);
      return safeCallback;
    },
    offUpdateAvailable: (callback) => ipcRenderer.removeListener('mdcode:update-available', callback),
    
    onConversionProgress: (callback) => {
      const safeCallback = safeIpcHandler('mdcode:convert:progress', callback);
      ipcRenderer.on('mdcode:convert:progress', safeCallback);
      return safeCallback;
    },
    offConversionProgress: (callback) => ipcRenderer.removeListener('mdcode:convert:progress', callback),
    
    onConversionStatus: (callback) => {
      const safeCallback = safeIpcHandler('mdcode:convert:status', callback);
      ipcRenderer.on('mdcode:convert:status', safeCallback);
      return safeCallback;
    },
    offConversionStatus: (callback) => ipcRenderer.removeListener('mdcode:convert:status', callback),
    
    onConversionComplete: (callback) => {
      const safeCallback = safeIpcHandler('mdcode:convert:complete', callback);
      ipcRenderer.on('mdcode:convert:complete', safeCallback);
      return safeCallback;
    },
    offConversionComplete: (callback) => ipcRenderer.removeListener('mdcode:convert:complete', callback),
    
    onConversionError: (callback) => {
      const safeCallback = safeIpcHandler('mdcode:convert:error', callback);
      ipcRenderer.on('mdcode:convert:error', safeCallback);
      return safeCallback;
    },
    offConversionError: (callback) => ipcRenderer.removeListener('mdcode:convert:error', callback),
    
    cancelConversion: (id) => ipcRenderer.invoke('mdcode:convert:cancel', { id }),
    
    onFileEvent: (callback) => {
      const safeCallback = safeIpcHandler('mdcode:watch:event', callback);
      ipcRenderer.on('mdcode:watch:event', safeCallback);
      return safeCallback;
    },
    offFileEvent: (callback) => ipcRenderer.removeListener('mdcode:watch:event', callback),
    
    onOfflineEvent: (callback) => {
      const safeCallback = safeIpcHandler('mdcode:offline:event', callback);
      ipcRenderer.on('mdcode:offline:event', safeCallback);
      return safeCallback;
    },
    offOfflineEvent: (callback) => ipcRenderer.removeListener('mdcode:offline:event', callback)
  }
);

// Type definitions for TypeScript support
/**
 * @typedef {Object} ElectronAPI
 * @property {(path: string, options?: Object) => Promise<ConversionResult>} convertFile
 * @property {(items: Array<Object>, options?: Object) => Promise<{success: boolean, results: ConversionResult[]}>} convertBatch - TEMPORARILY MODIFIED: Only processes the first item
 * @property {() => Promise<{success: boolean, paths?: string[]}>} selectFiles
 * @property {() => Promise<{success: boolean, path?: string}>} selectOutput
 * @property {(path: string) => Promise<{success: boolean, content?: string, metadata?: Object}>} getResult
 * 
 * @property {(path: string) => Promise<FileOperationResponse>} readFile
 * @property {(path: string, content: string) => Promise<FileOperationResponse>} writeFile
 * @property {(path: string) => Promise<FileOperationResponse>} createDirectory
 * @property {(path: string, options?: { recursive?: boolean, extensions?: string[] }) => Promise<FileOperationResponse>} listDirectory
 * @property {(path: string, options?: { recursive?: boolean, extensions?: string[] }) => Promise<{success: boolean, items?: Array<Object>, error?: string}>} listDirectoryDetailed
 * @property {(options?: Object) => Promise<{success: boolean, path?: string, error?: string}>} selectInputDirectory
 * @property {(path: string, recursive?: boolean) => Promise<FileOperationResponse>} deleteItem
 * @property {(path: string) => Promise<FileStatsResponse>} getStats
 * @property {(sourcePath: string, destPath: string) => Promise<FileOperationResponse>} moveItem
 * 
 * @property {(key: string) => Promise<any>} getSetting
 * @property {(key: string, value: any) => Promise<void>} setSetting
 * @property {() => Promise<string>} getVersion
 * @property {() => Promise<void>} checkForUpdates
 * @property {(path: string) => Promise<void>} showItemInFolder
 * @property {(url: string) => Promise<void>} openExternal
 * 
 * @property {(callback: (event: any, files: string[]) => void) => void} onFileDropped
 * @property {(callback: (event: any, version: string) => void) => void} onUpdateAvailable
 * @property {(paths: string|string[], options?: Object) => Promise<{success: boolean, watchId?: string, error?: string}>} watchStart
 * @property {(watchId: string) => Promise<{success: boolean, error?: string}>} watchStop
 * @property {(path: string, options?: Object) => Promise<{success: boolean, error?: string}>} acquireLock
 * @property {(path: string) => Promise<{success: boolean, error?: string}>} releaseLock
 * @property {(path: string) => Promise<{success: boolean, locked?: boolean, lockedBy?: string, error?: string}>} isLocked
 * @property {(callback: (event: any, progress: ConversionProgress) => void) => void} onConversionProgress
 * @property {(callback: (event: any, status: ConversionStatus) => void) => void} onConversionStatus
 * @property {(callback: (event: any, result: ConversionComplete) => void) => void} onConversionComplete
 * @property {(callback: (event: any, error: ConversionError) => void) => void} onConversionError
 * @property {(id: string) => Promise<{success: boolean, error?: string}>} cancelConversion
 * @property {(callback: (event: any, fileEvent: FileWatchEvent) => void) => void} onFileEvent
 * 
 * @property {(key: string, provider?: string) => Promise<ApiKeyResponse>} saveApiKey
 * @property {(provider?: string) => Promise<ApiKeyExistsResponse>} checkApiKeyExists
 * @property {(provider?: string) => Promise<ApiKeyResponse>} deleteApiKey
 * @property {(key: string, provider?: string) => Promise<ApiKeyValidationResponse>} validateApiKey
 * 
 * @property {(filePath: string) => Promise<TranscriptionResponse>} transcribeAudio
 * @property {(filePath: string) => Promise<TranscriptionResponse>} transcribeVideo
 */

/** @type {ElectronAPI} */
window.electronAPI;
