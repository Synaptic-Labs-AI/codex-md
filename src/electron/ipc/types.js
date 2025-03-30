/**
 * TypeScript definitions for IPC message types.
 * Defines the structure and types for all IPC communication.
 * 
 * Related files:
 * - handlers.js: IPC handler implementations
 * - preload.js: API exposure to renderer
 */

/**
 * @typedef {Object} ConversionRequest
 * @property {string} path File path to convert
 * @property {Object} [options] Conversion options
 * @property {string} [options.apiKey] API key for certain conversions
 */

/**
 * @typedef {Object} BatchConversionRequest
 * @property {string[]} paths Array of file paths to convert
 * @property {Object} [options] Conversion options
 */

/**
 * @typedef {Object} ConversionResult
 * @property {boolean} success Operation success status
 * @property {string} [outputPath] Path to converted files
 * @property {string} [mainFile] Path to main markdown file
 * @property {Object} [metadata] Conversion metadata
 * @property {string} [error] Error message if conversion failed
 */

/**
 * @typedef {Object} ConversionProgress
 * @property {string} [id] Job identifier
 * @property {string} [file] Current file name
 * @property {number} progress Progress percentage (0-100)
 * @property {number} [index] Current file index in batch
 * @property {number} [total] Total files in batch
 * @property {string} status Current status
 */

/**
 * @typedef {Object} ConversionStatus
 * @property {string} id Job identifier
 * @property {string} status Current status
 * @property {Object} [metadata] Job metadata
 */

/**
 * @typedef {Object} ConversionComplete
 * @property {string} id Job identifier
 * @property {Object} result Conversion result
 * @property {number} duration Conversion duration in milliseconds
 * @property {Object} [metadata] Job metadata
 */

/**
 * @typedef {Object} ConversionError
 * @property {string} id Job identifier
 * @property {string} error Error message
 * @property {Object} [metadata] Job metadata
 */

/**
 * @typedef {Object} ConversionCancel
 * @property {string} id Job identifier
 */

/**
 * @typedef {Object} FileOperationRequest
 * @property {string} path File or directory path
 * @property {Object} [options] Operation options
 */

/**
 * @typedef {Object} FileOperationResponse
 * @property {boolean} success Operation success status
 * @property {string} [error] Error message if operation failed
 * @property {any} [data] Operation result data
 */

/**
 * @typedef {Object} FileSaveRequest
 * @property {string} content File content to save
 * @property {string} path File path to save to
 */

/**
 * @typedef {Object} FileListRequest
 * @property {string} path Directory path to list
 * @property {boolean} [recursive] Whether to list recursively
 * @property {string[]} [extensions] File extensions to filter
 */

/**
 * @typedef {Object} FileStatsResponse
 * @property {boolean} success Operation success status
 * @property {Object} [stats] File statistics
 * @property {number} stats.size File size in bytes
 * @property {Date} stats.created Creation timestamp
 * @property {Date} stats.modified Last modified timestamp
 * @property {boolean} stats.isDirectory Whether item is a directory
 * @property {boolean} stats.isFile Whether item is a file
 * @property {string} [error] Error message if operation failed
 */

/**
 * @typedef {Object} FileWatchRequest
 * @property {string|string[]} paths Paths to watch
 * @property {Object} [options] Watch options
 * @property {boolean} [options.recursive] Watch subdirectories
 * @property {string[]} [options.ignore] Paths to ignore
 */

/**
 * @typedef {Object} FileWatchEvent
 * @property {string} event Event type ('add'|'change'|'unlink'|'error')
 * @property {string} path Affected file path
 * @property {string} [error] Error message if event is 'error'
 */

/**
 * @typedef {Object} UpdateInfo
 * @property {string} version Available version
 * @property {string[]} [changes] List of changes
 * @property {Date} releaseDate Release date
 */

/**
 * @typedef {Object} OfflineStatusResponse
 * @property {boolean} online Current online status
 * @property {Object} apiStatus Status of individual APIs
 * @property {boolean} apiStatus.openai OpenAI API status
 */

/**
 * @typedef {Object} OfflineOperation
 * @property {string} id Operation ID
 * @property {string} type Operation type ('conversion'|'api-request'|'sync')
 * @property {Object} data Operation data
 * @property {number} timestamp Operation timestamp
 */

/**
 * @typedef {Object} OfflineEvent
 * @property {string} type Event type ('status-change'|'api-status'|'operation-complete'|'operation-failed')
 * @property {boolean} [online] Online status (for 'status-change')
 * @property {Object} [status] API status (for 'api-status')
 * @property {OfflineOperation} [operation] Operation details (for 'operation-complete' and 'operation-failed')
 * @property {string} [error] Error message (for 'operation-failed')
 * @property {number} timestamp Event timestamp
 */

/**
 * @typedef {Object} CacheRequest
 * @property {string} key Cache key
 * @property {any} data Data to cache
 */

/**
 * @typedef {Object} CacheResponse
 * @property {boolean} success Operation success status
 * @property {any} [data] Cached data
 * @property {string} [error] Error message if operation failed
 */

/**
 * @typedef {Object} ApiKeyRequest
 * @property {string} key API key
 * @property {string} [provider] API provider (e.g., 'openai')
 */

/**
 * @typedef {Object} ApiKeyResponse
 * @property {boolean} success Operation success status
 * @property {string} [error] Error message if operation failed
 */

/**
 * @typedef {Object} ApiKeyValidationResponse
 * @property {boolean} valid Whether the API key is valid
 * @property {string} [error] Error message if validation failed
 */

/**
 * @typedef {Object} ApiKeyExistsResponse
 * @property {boolean} exists Whether the API key exists
 */

/**
 * @typedef {Object} TranscriptionRequest
 * @property {string} filePath Path to audio or video file
 */

/**
 * @typedef {Object} TranscriptionResponse
 * @property {boolean} success Operation success status
 * @property {string} [transcription] Transcription text
 * @property {Object} [metadata] Transcription metadata
 * @property {string} [error] Error message if transcription failed
 */

/**
 * @typedef {Object} UrlConversionRequest
 * @property {string} url URL to convert
 * @property {Object} [options] Conversion options
 */

/**
 * @typedef {Object} ParentUrlConversionRequest
 * @property {string} url Parent URL to convert
 * @property {Object} [options] Conversion options
 * @property {number} [options.depth] Crawl depth
 * @property {number} [options.maxPages] Maximum pages to convert
 */

/**
 * @typedef {Object} YoutubeConversionRequest
 * @property {string} url YouTube URL to convert
 * @property {Object} [options] Conversion options
 */

/**
 * Defines all valid IPC channel names
 * @readonly
 * @enum {string}
 */
const IPCChannels = {
  // Conversion operations
  CONVERT_FILE: 'mdcode:convert:file',
  CONVERT_BATCH: 'mdcode:convert:batch',
  CONVERT_URL: 'mdcode:convert:url',
  CONVERT_PARENT_URL: 'mdcode:convert:parent-url',
  CONVERT_YOUTUBE: 'mdcode:convert:youtube',
  SELECT_FILES: 'mdcode:convert:select-files',
  SELECT_OUTPUT: 'mdcode:convert:select-output',
  GET_RESULT: 'mdcode:convert:get-result',
  CONVERSION_PROGRESS: 'mdcode:convert:progress',
  CONVERSION_STATUS: 'mdcode:convert:status',
  CONVERSION_COMPLETE: 'mdcode:convert:complete',
  CONVERSION_ERROR: 'mdcode:convert:error',
  CONVERSION_CANCEL: 'mdcode:convert:cancel',
  
  // File system operations
  READ_FILE: 'mdcode:fs:read',
  WRITE_FILE: 'mdcode:fs:write',
  CREATE_DIRECTORY: 'mdcode:fs:mkdir',
  LIST_DIRECTORY: 'mdcode:fs:list',
  LIST_DIRECTORY_DETAILED: 'mdcode:fs:list-directory',
  DELETE_ITEM: 'mdcode:fs:delete',
  GET_STATS: 'mdcode:fs:stats',
  MOVE_ITEM: 'mdcode:fs:move',
  SELECT_DIRECTORY: 'mdcode:fs:select-directory',
  SELECT_INPUT_DIRECTORY: 'mdcode:fs:select-input-directory',
  
  // Settings
  GET_SETTING: 'mdcode:get-setting',
  SET_SETTING: 'mdcode:set-setting',
  
  // Application
  GET_VERSION: 'mdcode:get-version',
  CHECK_UPDATES: 'mdcode:check-updates',
  UPDATE_AVAILABLE: 'mdcode:update-available',
  
  // File watching
  WATCH_START: 'mdcode:watch:start',
  WATCH_STOP: 'mdcode:watch:stop',
  WATCH_EVENT: 'mdcode:watch:event',
  WATCH_ERROR: 'mdcode:watch:error',

  // System
  SHOW_ITEM: 'mdcode:show-item-in-folder',
  OPEN_EXTERNAL: 'mdcode:open-external',
  
  // Offline functionality
  OFFLINE_STATUS: 'mdcode:offline:status',
  OFFLINE_QUEUED_OPERATIONS: 'mdcode:offline:queued-operations',
  OFFLINE_QUEUE_OPERATION: 'mdcode:offline:queue-operation',
  OFFLINE_CACHE_DATA: 'mdcode:offline:cache-data',
  OFFLINE_GET_CACHED_DATA: 'mdcode:offline:get-cached-data',
  OFFLINE_INVALIDATE_CACHE: 'mdcode:offline:invalidate-cache',
  OFFLINE_CLEAR_CACHE: 'mdcode:offline:clear-cache',
  OFFLINE_EVENT: 'mdcode:offline:event',
  
  // API Key management
  APIKEY_SAVE: 'mdcode:apikey:save',
  APIKEY_EXISTS: 'mdcode:apikey:exists',
  APIKEY_DELETE: 'mdcode:apikey:delete',
  APIKEY_VALIDATE: 'mdcode:apikey:validate',
  APIKEY_GET_FOR_SERVICE: 'mdcode:apikey:get-for-service',
  
  // Transcription
  TRANSCRIBE_AUDIO: 'mdcode:transcribe:audio',
  TRANSCRIBE_VIDEO: 'mdcode:transcribe:video',
};

module.exports = {
  IPCChannels
};
