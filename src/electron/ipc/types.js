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
 * @property {number} [index] Current file index
 * @property {number} [total] Total files
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
 * @typedef {Object} LargeFileTransferInitRequest
 * @property {string} tempFilePath Path to save the file
 * @property {string} fileName Original file name
 * @property {number} fileSize File size in bytes
 * @property {string} [fileType] File MIME type
 * @property {number} [chunkSize] Size of each chunk in bytes (default: 24MB)
 */

/**
 * @typedef {Object} LargeFileTransferInitResponse
 * @property {boolean} success Operation success status
 * @property {string} [transferId] Unique transfer ID
 * @property {string} [error] Error message if operation failed
 */

/**
 * @typedef {Object} LargeFileTransferChunkRequest
 * @property {string} transferId Transfer ID
 * @property {number} chunkIndex Chunk index
 * @property {number} totalChunks Total number of chunks
 * @property {string} data Base64-encoded chunk data
 * @property {number} size Original chunk size in bytes
 */

/**
 * @typedef {Object} LargeFileTransferChunkResponse
 * @property {boolean} success Operation success status
 * @property {number} [receivedChunks] Number of chunks received
 * @property {number} [totalChunks] Total number of chunks
 * @property {string} [error] Error message if operation failed
 */

/**
 * @typedef {Object} LargeFileTransferFinalizeRequest
 * @property {string} transferId Transfer ID
 */

/**
 * @typedef {Object} LargeFileTransferFinalizeResponse
 * @property {boolean} success Operation success status
 * @property {string} [finalPath] Path to the final file
 * @property {number} [size] Final file size in bytes
 * @property {number} [transferTime] Transfer time in seconds
 * @property {number} [transferSpeed] Transfer speed in MB/s
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
 * @property {boolean} apiStatus.mistral Mistral API status
 * @property {boolean} apiStatus.deepgram Deepgram API status
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
 * @property {string} [provider] API provider (e.g., 'mistral', 'deepgram')
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
  CONVERT_FILE: 'codex:convert:file',
  CONVERT_URL: 'codex:convert:url',
  CONVERT_PARENT_URL: 'codex:convert:parent-url',
  CONVERT_YOUTUBE: 'codex:convert:youtube',
  SELECT_FILES: 'codex:fs:select-files',
  SELECT_OUTPUT: 'codex:fs:select-output',
  GET_RESULT: 'codex:convert:get-result',
  CONVERSION_PROGRESS: 'codex:convert:progress',
  CONVERSION_STATUS: 'codex:convert:status',
  CONVERSION_COMPLETE: 'codex:convert:complete',
  CONVERSION_ERROR: 'codex:convert:error',
  CONVERSION_CANCEL: 'codex:convert:cancel',
  
  // File system operations
  READ_FILE: 'codex:fs:read',
  WRITE_FILE: 'codex:fs:write',
  CREATE_DIRECTORY: 'codex:fs:mkdir',
  LIST_DIRECTORY: 'codex:fs:list',
  LIST_DIRECTORY_DETAILED: 'codex:fs:list-directory',
  DELETE_ITEM: 'codex:fs:delete',
  GET_STATS: 'codex:fs:stats',
  MOVE_ITEM: 'codex:fs:move',
  SELECT_DIRECTORY: 'codex:fs:select-directory',
  SELECT_INPUT_DIRECTORY: 'codex:fs:select-input-directory',
  
  // Large file transfer operations
  INIT_LARGE_FILE_TRANSFER: 'codex:fs:init-large-file-transfer',
  TRANSFER_FILE_CHUNK: 'codex:fs:transfer-file-chunk',
  FINALIZE_LARGE_FILE_TRANSFER: 'codex:fs:finalize-large-file-transfer',
  
  // Settings
  GET_SETTING: 'codex:get-setting',
  SET_SETTING: 'codex:set-setting',
  
  // Application
  GET_VERSION: 'codex:get-version',
  CHECK_UPDATES: 'codex:check-updates',
  UPDATE_AVAILABLE: 'codex:update-available',
  
  // File watching
  WATCH_START: 'codex:watch:start',
  WATCH_STOP: 'codex:watch:stop',
  WATCH_EVENT: 'codex:watch:event',
  WATCH_ERROR: 'codex:watch:error',

  // System
  SHOW_ITEM: 'codex:show-item-in-folder',
  OPEN_EXTERNAL: 'codex:open-external',
  
  // Offline functionality
  OFFLINE_STATUS: 'codex:offline:status',
  OFFLINE_QUEUED_OPERATIONS: 'codex:offline:queued-operations',
  OFFLINE_QUEUE_OPERATION: 'codex:offline:queue-operation',
  OFFLINE_CACHE_DATA: 'codex:offline:cache-data',
  OFFLINE_GET_CACHED_DATA: 'codex:offline:get-cached-data',
  OFFLINE_INVALIDATE_CACHE: 'codex:offline:invalidate-cache',
  OFFLINE_CLEAR_CACHE: 'codex:offline:clear-cache',
  OFFLINE_EVENT: 'codex:offline:event',
  
  // API Key management
  APIKEY_SAVE: 'codex:apikey:save',
  APIKEY_EXISTS: 'codex:apikey:exists',
  APIKEY_DELETE: 'codex:apikey:delete',
  APIKEY_VALIDATE: 'codex:apikey:validate',
  APIKEY_GET: 'codex:apikey:get',
  
  // Transcription
  TRANSCRIBE_AUDIO: 'codex:transcribe:audio',
  TRANSCRIBE_VIDEO: 'codex:transcribe:video',
};

module.exports = {
  IPCChannels
};
