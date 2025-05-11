"use strict";

/**
 * MediaConverter.js
 * Handles conversion of audio and video files to markdown format in the Electron main process.
 * 
 * This converter:
 * - Processes audio and video files using Deepgram API
 * - Extracts metadata (duration, type, etc.)
 * - Transcribes content using Deepgram
 * - Generates structured markdown output
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - DeepgramService.js: Used for audio/video transcription
 * - FileStorageService.js: For temporary file management
 */

const path = require('path');
const fs = require('fs-extra');
const {
  v4: uuidv4
} = require('uuid');
const BaseService = require('../../BaseService');
const {
  createStore
} = require('../../../utils/storeFactory');

// Settings store for transcription settings
const settingsStore = createStore('settings');

// Utility to sanitize objects for logging, especially to handle Buffers
// Copied from DeepgramService.js for consistency, or could be moved to a shared util
function sanitizeForLogging(obj, visited = new Set()) {
  if (obj === null || typeof obj !== 'object' || visited.has(obj)) {
    return obj;
  }
  visited.add(obj);
  if (Buffer.isBuffer(obj)) {
    return `[Buffer length: ${obj.length}]`;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForLogging(item, new Set(visited)));
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeForLogging(value, new Set(visited));
  }
  visited.delete(obj);
  return sanitized;
}
class MediaConverter extends BaseService {
  constructor(registry, fileProcessor, fileStorage) {
    super();
    this.registry = registry;
    this.fileProcessor = fileProcessor;
    this.fileStorage = fileStorage;
    // It's better to use the TranscriptionService which abstracts Deepgram
    this.transcriptionService = require('../../TranscriptionService');

    // Supported file extensions
    this.supportedExtensions = [
    // Audio formats
    '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac',
    // Video formats
    '.mp4', '.mov', '.avi', '.mkv', '.webm'];
    console.log('[MediaConverter] Initialized with support for:', this.supportedExtensions.join(', '));
  }

  /**
   * Set up IPC handlers for media conversion
   */
  setupIpcHandlers() {
    this.registerHandler('convert:media', this.handleConvert.bind(this));
    this.registerHandler('convert:media:metadata', this.handleGetMetadata.bind(this));
    this.registerHandler('convert:media:cancel', this.handleCancel.bind(this));
  }

  /**
   * Handle media conversion request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Conversion request details
   */
  async handleConvert(event, {
    filePath,
    options = {}
  }) {
    const conversionId = this.generateConversionId();
    // filePath here is the path to the temporary file created by the adapter, or the original user file path if not from buffer.
    const originalFileNameForLog = options.originalFileName || path.basename(filePath);
    console.log(`[MediaConverter:HANDLE_CONVERT_START][convId:${conversionId}] Starting media conversion for: ${originalFileNameForLog} (input path: ${filePath})`);
    console.log(`[MediaConverter:HANDLE_CONVERT_START][convId:${conversionId}] Options:`, sanitizeForLogging(options));

    // The directory containing the filePath will be managed for cleanup.
    // If filePath is a direct user file, its directory should NOT be deleted.
    // The adapter should indicate if filePath is a temporary file it created.
    // Let's assume options.isTempInputFile indicates this.
    const tempDirForCleanup = options.isTempInputFile ? path.dirname(filePath) : null;
    if (options.isTempInputFile) {
      console.log(`[MediaConverter:TEMP_INPUT][convId:${conversionId}] Input file ${filePath} is temporary and its directory ${tempDirForCleanup} will be cleaned up.`);
    }
    try {
      const window = event?.sender?.getOwnerBrowserWindow?.() || null;

      // No longer creating a new tempDir here; will use the directory of filePath if it's a temp file.
      // Or, if we need isolated processing space, create one and copy filePath into it.
      // For now, let's assume filePath can be processed in place, and its dir cleaned if temp.

      this.registry.registerConversion(conversionId, {
        id: conversionId,
        status: 'starting',
        progress: 0,
        filePath: filePath,
        // Path to the actual media file to process
        tempDir: tempDirForCleanup,
        // Directory to clean up if input was temporary
        window,
        startTime: Date.now(),
        originalFileName: options.originalFileName || path.basename(filePath) // Use original name from options if available
      });
      if (window && window.webContents) {
        window.webContents.send('media:conversion-started', {
          conversionId,
          originalFileName: options.originalFileName || path.basename(filePath)
        });
      }

      // Asynchronously process the conversion
      this.processConversion(conversionId, filePath, options).catch(async error => {
        // Make catch async for cleanup
        const errorMessage = error.message || 'Unknown media conversion processing error';
        console.error(`[MediaConverter:PROCESS_CONVERSION_ERROR][convId:${conversionId}] Overall conversion failed for ${originalFileNameForLog}:`, sanitizeForLogging(error));
        this.registry.pingConversion(conversionId, {
          status: 'failed',
          error: errorMessage,
          progress: 100 // Mark as complete for UI handling, but with error
        });
        // Attempt cleanup even on error
        if (tempDirForCleanup) {
          try {
            console.log(`[MediaConverter:CLEANUP_ON_ERROR][convId:${conversionId}] Cleaning up temp directory: ${tempDirForCleanup}`);
            await fs.remove(tempDirForCleanup);
          } catch (cleanupErr) {
            console.error(`[MediaConverter:CLEANUP_ON_ERROR_FAILED][convId:${conversionId}] Failed to clean up temp directory ${tempDirForCleanup}:`, sanitizeForLogging(cleanupErr));
          }
        }
      });
      return {
        conversionId,
        originalFileName: options.originalFileName || path.basename(filePath)
      };
    } catch (error) {
      const errorMessage = error.message || 'Failed to start media conversion';
      console.error(`[MediaConverter:HANDLE_CONVERT_ERROR][convId:${conversionId}] Error for ${originalFileNameForLog}:`, sanitizeForLogging(error));
      // If registration happened, update it to failed.
      if (this.registry.getConversion(conversionId)) {
        this.registry.pingConversion(conversionId, {
          status: 'failed',
          error: errorMessage,
          progress: 100
        });
      }
      // Attempt cleanup if tempDirForCleanup was determined
      if (tempDirForCleanup) {
        try {
          console.log(`[MediaConverter:CLEANUP_ON_START_ERROR][convId:${conversionId}] Cleaning up temp directory: ${tempDirForCleanup}`);
          await fs.remove(tempDirForCleanup);
        } catch (cleanupErr) {
          console.error(`[MediaConverter:CLEANUP_ON_START_ERROR_FAILED][convId:${conversionId}] Failed to clean up temp directory ${tempDirForCleanup}:`, sanitizeForLogging(cleanupErr));
        }
      }
      throw new Error(errorMessage); // Re-throw for IPC to catch if needed
    }
  }

  /**
   * Handle metadata request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Metadata request details
   */
  async handleGetMetadata(event, {
    filePath
  }) {
    try {
      console.log(`[MediaConverter] Getting metadata for: ${filePath}`);
      const fileType = this.getFileType(filePath);
      const stats = await fs.stat(filePath);

      // Simple metadata extraction without ffprobe
      const metadata = {
        format: fileType.type,
        duration: "Unknown",
        // We don't have ffprobe to get duration
        size: stats.size,
        filename: path.basename(filePath),
        isAudio: fileType.isAudio,
        isVideo: fileType.isVideo
      };
      return metadata;
    } catch (error) {
      console.error('[MediaConverter] Failed to get metadata:', error);
      throw error;
    }
  }

  /**
   * Handle conversion cancellation request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Cancellation request details
   */
  async handleCancel(event, {
    conversionId
  }) {
    return this.registry.removeConversion(conversionId);
  }

  /**
   * Process media conversion
   * @param {string} conversionId - Conversion identifier
   * @param {string} filePath - Path to media file
   * @param {Object} options - Conversion options
   */
  async processConversion(conversionId, filePath, options) {
    const originalFileName = options.originalFileName || path.basename(filePath);
    console.log(`[MediaConverter:PROCESS_CONVERSION_START][convId:${conversionId}] Processing media file: ${originalFileName} (from path: ${filePath})`);
    const jobData = this.registry.getConversion(conversionId);
    const tempDirToCleanup = jobData ? jobData.tempDir : null; // This is path.dirname(filePath) if temp

    try {
      const fileType = this.getFileType(filePath);
      this.registry.pingConversion(conversionId, {
        status: 'validating',
        progress: 5,
        fileType: fileType.type,
        message: 'Validating file...'
      });
      const stats = await fs.stat(filePath); // filePath is the actual file to process
      const metadata = {
        filename: originalFileName,
        // Use the original filename for metadata
        fileType: fileType.type,
        size: stats.size,
        isAudio: fileType.isAudio,
        isVideo: fileType.isVideo
      };
      console.log(`[MediaConverter:VALIDATED][convId:${conversionId}] File validated. Metadata:`, sanitizeForLogging(metadata));
      this.registry.pingConversion(conversionId, {
        status: 'transcribing',
        progress: 30,
        message: 'Starting transcription...'
      });
      let deepgramApiKey = options.deepgramApiKey; // API key from options takes precedence
      if (!deepgramApiKey) {
        const apiKeyService = require('../../ApiKeyService');
        deepgramApiKey = apiKeyService.getApiKey('deepgram');
        if (deepgramApiKey) {
          console.log(`[MediaConverter:API_KEY_FOUND][convId:${conversionId}] Deepgram API key found via ApiKeyService.`);
        } else {
          console.warn(`[MediaConverter:API_KEY_WARN][convId:${conversionId}] Deepgram API key not provided in options, attempting to find in settings store.`);
          try {
            deepgramApiKey = settingsStore.get('deepgramApiKey') || settingsStore.get('transcription.deepgramApiKey');
            if (deepgramApiKey) {
              console.log(`[MediaConverter:API_KEY_FOUND][convId:${conversionId}] Deepgram API key found in settings store.`);
            }
          } catch (err) {
            console.warn('[MediaConverter:API_KEY_STORE_ERROR][convId:${conversionId}] Error accessing settings store for API key:', sanitizeForLogging(err));
          }
        }
      } else {
        console.log(`[MediaConverter:API_KEY_PROVIDED][convId:${conversionId}] Deepgram API key provided in options.`);
      }
      if (!deepgramApiKey) {
        console.error(`[MediaConverter:NO_API_KEY][convId:${conversionId}] No Deepgram API key found. Aborting transcription.`);
        throw new Error('Deepgram API key not found. Please configure it in Settings > Transcription.');
      }
      console.log(`[MediaConverter:TRANSCRIPTION_START][convId:${conversionId}] Initiating transcription for ${originalFileName}`);

      // Use TranscriptionService for transcription, filePath is the actual media data
      const transcriptionText = await this.transcriptionService.transcribeAudio(filePath, deepgramApiKey, {
        language: options.language,
        // Pass relevant options
        punctuate: options.punctuate,
        smart_format: options.smart_format,
        diarize: options.diarize,
        utterances: options.utterances,
        deepgramOptions: options.deepgramOptions,
        // Pass through any specific DG options
        model: options.model // Allow model override from options
      });

      // TranscriptionService now throws on empty/failed result, so this check might be redundant but safe.
      if (!transcriptionText || transcriptionText.trim() === '') {
        console.error(`[MediaConverter:EMPTY_TRANSCRIPTION][convId:${conversionId}] Transcription completed but returned no text content.`);
        throw new Error('Transcription produced no text content.');
      }
      console.log(`[MediaConverter:TRANSCRIPTION_SUCCESS][convId:${conversionId}] Transcription successful. Text length: ${transcriptionText.length}`);

      // Construct a result object similar to what DeepgramService's formatTranscriptionResult would produce
      const transcriptionResult = {
        text: transcriptionText,
        // We might not have detailed duration/model from TranscriptionService directly here,
        // but we can pass what we know or enhance TranscriptionService to return more details.
        model: options.model || settingsStore.get('transcription.model', 'nova-2'),
        language: options.language || 'en'
        // duration: "Unknown" // Or get from metadata if possible
      };
      this.registry.pingConversion(conversionId, {
        status: 'generating_markdown',
        progress: 90,
        message: 'Generating Markdown...'
      });
      const markdown = this.generateMarkdown(metadata, transcriptionResult, options);
      console.log(`[MediaConverter:MARKDOWN_GENERATED][convId:${conversionId}] Markdown generated.`);
      this.registry.pingConversion(conversionId, {
        status: 'completed',
        progress: 100,
        result: markdown,
        transcribed: true,
        originalFileName: metadata.filename,
        message: 'Conversion complete!'
      });
      return markdown;
    } catch (error) {
      const errorMessage = error.message || 'Unknown media conversion error';
      console.error(`[MediaConverter:PROCESS_CONVERSION_FAILED][convId:${conversionId}] Error for ${originalFileName}:`, sanitizeForLogging(error));
      this.registry.pingConversion(conversionId, {
        status: 'failed',
        error: errorMessage,
        progress: 100,
        // Mark as complete for UI handling
        originalFileName: originalFileName,
        // Keep originalFileName in the status update
        message: `Conversion failed: ${errorMessage}`
      });
      // Error is logged and status updated. Do not re-throw to allow cleanup.
    } finally {
      // Cleanup the temporary directory if one was specified for cleanup
      if (tempDirToCleanup) {
        try {
          console.log(`[MediaConverter:CLEANUP_FINALLY][convId:${conversionId}] Cleaning up temp directory: ${tempDirToCleanup}`);
          await fs.remove(tempDirToCleanup);
          console.log(`[MediaConverter:CLEANUP_FINALLY_SUCCESS][convId:${conversionId}] Temp directory ${tempDirToCleanup} removed.`);
        } catch (cleanupErr) {
          console.error(`[MediaConverter:CLEANUP_FINALLY_FAILED][convId:${conversionId}] Failed to clean up temp directory ${tempDirToCleanup}:`, sanitizeForLogging(cleanupErr));
        }
      } else {
        console.log(`[MediaConverter:NO_CLEANUP_NEEDED][convId:${conversionId}] No temporary input directory was specified for cleanup.`);
      }
    }
  }

  /**
   * Generate markdown from media metadata and transcription
   * @param {Object} metadata - Media metadata
   * @param {Object} transcription - Transcription result
   * @param {Object} options - Conversion options
   * @returns {string} Markdown content
   */
  generateMarkdown(metadata, transcription, options) {
    const markdown = [];

    // Add title
    if (options.title) {
      markdown.push(`# ${options.title}`);
    } else {
      const mediaType = metadata.isVideo ? 'Video' : 'Audio';
      markdown.push(`# ${mediaType}: ${metadata.filename}`);
    }
    markdown.push('');

    // Add metadata
    markdown.push('## Media Information');
    markdown.push('');
    markdown.push('| Property | Value |');
    markdown.push('| --- | --- |');
    markdown.push(`| Filename | ${metadata.filename} |`);
    markdown.push(`| Type | ${metadata.isVideo ? 'Video' : 'Audio'} |`);
    markdown.push(`| Format | ${metadata.fileType} |`);
    markdown.push(`| File Size | ${this.formatFileSize(metadata.size)} |`);
    markdown.push('');

    // Add transcription section
    markdown.push('## Transcription');
    markdown.push('');

    // Add transcription text
    markdown.push(transcription.text);

    // Add transcription metadata if available
    if (transcription.model || transcription.duration) {
      markdown.push('');
      markdown.push('### Transcription Details');
      markdown.push('');
      markdown.push('| Property | Value |');
      markdown.push('| --- | --- |');
      if (transcription.model) {
        markdown.push(`| Model | ${transcription.model} |`);
      }
      if (transcription.duration) {
        const duration = typeof transcription.duration === 'number' ? this.formatDuration(transcription.duration) : transcription.duration;
        markdown.push(`| Duration | ${duration} |`);
      }
      if (transcription.language) {
        markdown.push(`| Language | ${transcription.language} |`);
      }
    }
    return markdown.join('\n');
  }

  /**
   * Format file size in bytes to human-readable format
   * @param {number} bytes - File size in bytes
   * @returns {string} Formatted file size
   */
  formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Format duration in seconds to a human-readable format
   * @param {number} seconds - Duration in seconds
   * @returns {string} Formatted duration
   */
  formatDuration(seconds) {
    if (!seconds || typeof seconds !== 'number') {
      return 'Unknown';
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    if (minutes === 0) {
      return `${remainingSeconds} sec`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Get file type information from file path
   * @param {string} filePath - Path to file
   * @returns {Object} File type information
   */
  getFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    // Audio extensions
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];

    // Video extensions
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
    return {
      extension: ext,
      type: ext.substring(1),
      // Remove the dot
      isAudio: audioExtensions.includes(ext),
      isVideo: videoExtensions.includes(ext)
    };
  }

  /**
   * Generate unique conversion identifier
   * @returns {string} Unique conversion ID
   */
  generateConversionId() {
    return `media_${Date.now()}_${uuidv4().substring(0, 8)}`;
  }

  /**
   * Check if this converter supports the given file
   * @param {string} filePath - Path to file
   * @returns {boolean} True if supported
   */
  supportsFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  /**
   * Get converter information
   * @returns {Object} Converter details
   */
  getInfo() {
    return {
      name: 'Media Converter',
      extensions: this.supportedExtensions,
      description: 'Converts audio and video files to markdown with transcription using Deepgram',
      options: {
        transcribe: 'Whether to transcribe media (default: true)',
        language: 'Transcription language (default: en)',
        title: 'Optional document title'
      }
    };
  }
}
module.exports = MediaConverter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwidjQiLCJ1dWlkdjQiLCJCYXNlU2VydmljZSIsImNyZWF0ZVN0b3JlIiwic2V0dGluZ3NTdG9yZSIsInNhbml0aXplRm9yTG9nZ2luZyIsIm9iaiIsInZpc2l0ZWQiLCJTZXQiLCJoYXMiLCJhZGQiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImxlbmd0aCIsIkFycmF5IiwiaXNBcnJheSIsIm1hcCIsIml0ZW0iLCJzYW5pdGl6ZWQiLCJrZXkiLCJ2YWx1ZSIsIk9iamVjdCIsImVudHJpZXMiLCJkZWxldGUiLCJNZWRpYUNvbnZlcnRlciIsImNvbnN0cnVjdG9yIiwicmVnaXN0cnkiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJ0cmFuc2NyaXB0aW9uU2VydmljZSIsInN1cHBvcnRlZEV4dGVuc2lvbnMiLCJjb25zb2xlIiwibG9nIiwiam9pbiIsInNldHVwSXBjSGFuZGxlcnMiLCJyZWdpc3RlckhhbmRsZXIiLCJoYW5kbGVDb252ZXJ0IiwiYmluZCIsImhhbmRsZUdldE1ldGFkYXRhIiwiaGFuZGxlQ2FuY2VsIiwiZXZlbnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJjb252ZXJzaW9uSWQiLCJnZW5lcmF0ZUNvbnZlcnNpb25JZCIsIm9yaWdpbmFsRmlsZU5hbWVGb3JMb2ciLCJvcmlnaW5hbEZpbGVOYW1lIiwiYmFzZW5hbWUiLCJ0ZW1wRGlyRm9yQ2xlYW51cCIsImlzVGVtcElucHV0RmlsZSIsImRpcm5hbWUiLCJ3aW5kb3ciLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJyZWdpc3RlckNvbnZlcnNpb24iLCJpZCIsInN0YXR1cyIsInByb2dyZXNzIiwidGVtcERpciIsInN0YXJ0VGltZSIsIkRhdGUiLCJub3ciLCJ3ZWJDb250ZW50cyIsInNlbmQiLCJwcm9jZXNzQ29udmVyc2lvbiIsImNhdGNoIiwiZXJyb3IiLCJlcnJvck1lc3NhZ2UiLCJtZXNzYWdlIiwicGluZ0NvbnZlcnNpb24iLCJyZW1vdmUiLCJjbGVhbnVwRXJyIiwiZ2V0Q29udmVyc2lvbiIsIkVycm9yIiwiZmlsZVR5cGUiLCJnZXRGaWxlVHlwZSIsInN0YXRzIiwic3RhdCIsIm1ldGFkYXRhIiwiZm9ybWF0IiwidHlwZSIsImR1cmF0aW9uIiwic2l6ZSIsImZpbGVuYW1lIiwiaXNBdWRpbyIsImlzVmlkZW8iLCJyZW1vdmVDb252ZXJzaW9uIiwiam9iRGF0YSIsInRlbXBEaXJUb0NsZWFudXAiLCJkZWVwZ3JhbUFwaUtleSIsImFwaUtleVNlcnZpY2UiLCJnZXRBcGlLZXkiLCJ3YXJuIiwiZ2V0IiwiZXJyIiwidHJhbnNjcmlwdGlvblRleHQiLCJ0cmFuc2NyaWJlQXVkaW8iLCJsYW5ndWFnZSIsInB1bmN0dWF0ZSIsInNtYXJ0X2Zvcm1hdCIsImRpYXJpemUiLCJ1dHRlcmFuY2VzIiwiZGVlcGdyYW1PcHRpb25zIiwibW9kZWwiLCJ0cmltIiwidHJhbnNjcmlwdGlvblJlc3VsdCIsInRleHQiLCJtYXJrZG93biIsImdlbmVyYXRlTWFya2Rvd24iLCJyZXN1bHQiLCJ0cmFuc2NyaWJlZCIsInRyYW5zY3JpcHRpb24iLCJ0aXRsZSIsInB1c2giLCJtZWRpYVR5cGUiLCJmb3JtYXRGaWxlU2l6ZSIsImZvcm1hdER1cmF0aW9uIiwiYnl0ZXMiLCJ1bml0cyIsInVuaXRJbmRleCIsInRvRml4ZWQiLCJzZWNvbmRzIiwibWludXRlcyIsIk1hdGgiLCJmbG9vciIsInJlbWFpbmluZ1NlY29uZHMiLCJ0b1N0cmluZyIsInBhZFN0YXJ0IiwiZXh0IiwiZXh0bmFtZSIsInRvTG93ZXJDYXNlIiwiYXVkaW9FeHRlbnNpb25zIiwidmlkZW9FeHRlbnNpb25zIiwiZXh0ZW5zaW9uIiwic3Vic3RyaW5nIiwiaW5jbHVkZXMiLCJzdXBwb3J0c0ZpbGUiLCJnZXRJbmZvIiwibmFtZSIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsInRyYW5zY3JpYmUiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vbXVsdGltZWRpYS9NZWRpYUNvbnZlcnRlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogTWVkaWFDb252ZXJ0ZXIuanNcclxuICogSGFuZGxlcyBjb252ZXJzaW9uIG9mIGF1ZGlvIGFuZCB2aWRlbyBmaWxlcyB0byBtYXJrZG93biBmb3JtYXQgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogXHJcbiAqIFRoaXMgY29udmVydGVyOlxyXG4gKiAtIFByb2Nlc3NlcyBhdWRpbyBhbmQgdmlkZW8gZmlsZXMgdXNpbmcgRGVlcGdyYW0gQVBJXHJcbiAqIC0gRXh0cmFjdHMgbWV0YWRhdGEgKGR1cmF0aW9uLCB0eXBlLCBldGMuKVxyXG4gKiAtIFRyYW5zY3JpYmVzIGNvbnRlbnQgdXNpbmcgRGVlcGdyYW1cclxuICogLSBHZW5lcmF0ZXMgc3RydWN0dXJlZCBtYXJrZG93biBvdXRwdXRcclxuICogXHJcbiAqIFJlbGF0ZWQgRmlsZXM6XHJcbiAqIC0gQmFzZVNlcnZpY2UuanM6IFBhcmVudCBjbGFzcyBwcm92aWRpbmcgSVBDIGhhbmRsaW5nXHJcbiAqIC0gRGVlcGdyYW1TZXJ2aWNlLmpzOiBVc2VkIGZvciBhdWRpby92aWRlbyB0cmFuc2NyaXB0aW9uXHJcbiAqIC0gRmlsZVN0b3JhZ2VTZXJ2aWNlLmpzOiBGb3IgdGVtcG9yYXJ5IGZpbGUgbWFuYWdlbWVudFxyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcclxuY29uc3QgeyB2NDogdXVpZHY0IH0gPSByZXF1aXJlKCd1dWlkJyk7XHJcbmNvbnN0IEJhc2VTZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vQmFzZVNlcnZpY2UnKTtcclxuY29uc3QgeyBjcmVhdGVTdG9yZSB9ID0gcmVxdWlyZSgnLi4vLi4vLi4vdXRpbHMvc3RvcmVGYWN0b3J5Jyk7XHJcblxyXG4vLyBTZXR0aW5ncyBzdG9yZSBmb3IgdHJhbnNjcmlwdGlvbiBzZXR0aW5nc1xyXG5jb25zdCBzZXR0aW5nc1N0b3JlID0gY3JlYXRlU3RvcmUoJ3NldHRpbmdzJyk7XHJcblxyXG4vLyBVdGlsaXR5IHRvIHNhbml0aXplIG9iamVjdHMgZm9yIGxvZ2dpbmcsIGVzcGVjaWFsbHkgdG8gaGFuZGxlIEJ1ZmZlcnNcclxuLy8gQ29waWVkIGZyb20gRGVlcGdyYW1TZXJ2aWNlLmpzIGZvciBjb25zaXN0ZW5jeSwgb3IgY291bGQgYmUgbW92ZWQgdG8gYSBzaGFyZWQgdXRpbFxyXG5mdW5jdGlvbiBzYW5pdGl6ZUZvckxvZ2dpbmcob2JqLCB2aXNpdGVkID0gbmV3IFNldCgpKSB7XHJcbiAgaWYgKG9iaiA9PT0gbnVsbCB8fCB0eXBlb2Ygb2JqICE9PSAnb2JqZWN0JyB8fCB2aXNpdGVkLmhhcyhvYmopKSB7XHJcbiAgICByZXR1cm4gb2JqO1xyXG4gIH1cclxuXHJcbiAgdmlzaXRlZC5hZGQob2JqKTtcclxuXHJcbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihvYmopKSB7XHJcbiAgICByZXR1cm4gYFtCdWZmZXIgbGVuZ3RoOiAke29iai5sZW5ndGh9XWA7XHJcbiAgfVxyXG5cclxuICBpZiAoQXJyYXkuaXNBcnJheShvYmopKSB7XHJcbiAgICByZXR1cm4gb2JqLm1hcChpdGVtID0+IHNhbml0aXplRm9yTG9nZ2luZyhpdGVtLCBuZXcgU2V0KHZpc2l0ZWQpKSk7XHJcbiAgfVxyXG5cclxuICBjb25zdCBzYW5pdGl6ZWQgPSB7fTtcclxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhvYmopKSB7XHJcbiAgICBzYW5pdGl6ZWRba2V5XSA9IHNhbml0aXplRm9yTG9nZ2luZyh2YWx1ZSwgbmV3IFNldCh2aXNpdGVkKSk7XHJcbiAgfVxyXG4gIFxyXG4gIHZpc2l0ZWQuZGVsZXRlKG9iaik7XHJcbiAgcmV0dXJuIHNhbml0aXplZDtcclxufVxyXG5cclxuY2xhc3MgTWVkaWFDb252ZXJ0ZXIgZXh0ZW5kcyBCYXNlU2VydmljZSB7XHJcbiAgICBjb25zdHJ1Y3RvcihyZWdpc3RyeSwgZmlsZVByb2Nlc3NvciwgZmlsZVN0b3JhZ2UpIHtcclxuICAgICAgICBzdXBlcigpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0cnkgPSByZWdpc3RyeTtcclxuICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yO1xyXG4gICAgICAgIHRoaXMuZmlsZVN0b3JhZ2UgPSBmaWxlU3RvcmFnZTtcclxuICAgICAgICAvLyBJdCdzIGJldHRlciB0byB1c2UgdGhlIFRyYW5zY3JpcHRpb25TZXJ2aWNlIHdoaWNoIGFic3RyYWN0cyBEZWVwZ3JhbVxyXG4gICAgICAgIHRoaXMudHJhbnNjcmlwdGlvblNlcnZpY2UgPSByZXF1aXJlKCcuLi8uLi9UcmFuc2NyaXB0aW9uU2VydmljZScpOyBcclxuICAgICAgICBcclxuICAgICAgICAvLyBTdXBwb3J0ZWQgZmlsZSBleHRlbnNpb25zXHJcbiAgICAgICAgdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zID0gW1xyXG4gICAgICAgICAgICAvLyBBdWRpbyBmb3JtYXRzXHJcbiAgICAgICAgICAgICcubXAzJywgJy53YXYnLCAnLm9nZycsICcubTRhJywgJy5mbGFjJywgJy5hYWMnLFxyXG4gICAgICAgICAgICAvLyBWaWRlbyBmb3JtYXRzXHJcbiAgICAgICAgICAgICcubXA0JywgJy5tb3YnLCAnLmF2aScsICcubWt2JywgJy53ZWJtJ1xyXG4gICAgICAgIF07XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc29sZS5sb2coJ1tNZWRpYUNvbnZlcnRlcl0gSW5pdGlhbGl6ZWQgd2l0aCBzdXBwb3J0IGZvcjonLCB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMuam9pbignLCAnKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTZXQgdXAgSVBDIGhhbmRsZXJzIGZvciBtZWRpYSBjb252ZXJzaW9uXHJcbiAgICAgKi9cclxuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6bWVkaWEnLCB0aGlzLmhhbmRsZUNvbnZlcnQuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6bWVkaWE6bWV0YWRhdGEnLCB0aGlzLmhhbmRsZUdldE1ldGFkYXRhLmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0Om1lZGlhOmNhbmNlbCcsIHRoaXMuaGFuZGxlQ2FuY2VsLmJpbmQodGhpcykpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIG1lZGlhIGNvbnZlcnNpb24gcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIENvbnZlcnNpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUNvbnZlcnQoZXZlbnQsIHsgZmlsZVBhdGgsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICAgICAgY29uc3QgY29udmVyc2lvbklkID0gdGhpcy5nZW5lcmF0ZUNvbnZlcnNpb25JZCgpO1xyXG4gICAgICAgIC8vIGZpbGVQYXRoIGhlcmUgaXMgdGhlIHBhdGggdG8gdGhlIHRlbXBvcmFyeSBmaWxlIGNyZWF0ZWQgYnkgdGhlIGFkYXB0ZXIsIG9yIHRoZSBvcmlnaW5hbCB1c2VyIGZpbGUgcGF0aCBpZiBub3QgZnJvbSBidWZmZXIuXHJcbiAgICAgICAgY29uc3Qgb3JpZ2luYWxGaWxlTmFtZUZvckxvZyA9IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOkhBTkRMRV9DT05WRVJUX1NUQVJUXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBTdGFydGluZyBtZWRpYSBjb252ZXJzaW9uIGZvcjogJHtvcmlnaW5hbEZpbGVOYW1lRm9yTG9nfSAoaW5wdXQgcGF0aDogJHtmaWxlUGF0aH0pYCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpIQU5ETEVfQ09OVkVSVF9TVEFSVF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gT3B0aW9uczpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcob3B0aW9ucykpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFRoZSBkaXJlY3RvcnkgY29udGFpbmluZyB0aGUgZmlsZVBhdGggd2lsbCBiZSBtYW5hZ2VkIGZvciBjbGVhbnVwLlxyXG4gICAgICAgIC8vIElmIGZpbGVQYXRoIGlzIGEgZGlyZWN0IHVzZXIgZmlsZSwgaXRzIGRpcmVjdG9yeSBzaG91bGQgTk9UIGJlIGRlbGV0ZWQuXHJcbiAgICAgICAgLy8gVGhlIGFkYXB0ZXIgc2hvdWxkIGluZGljYXRlIGlmIGZpbGVQYXRoIGlzIGEgdGVtcG9yYXJ5IGZpbGUgaXQgY3JlYXRlZC5cclxuICAgICAgICAvLyBMZXQncyBhc3N1bWUgb3B0aW9ucy5pc1RlbXBJbnB1dEZpbGUgaW5kaWNhdGVzIHRoaXMuXHJcbiAgICAgICAgY29uc3QgdGVtcERpckZvckNsZWFudXAgPSBvcHRpb25zLmlzVGVtcElucHV0RmlsZSA/IHBhdGguZGlybmFtZShmaWxlUGF0aCkgOiBudWxsO1xyXG4gICAgICAgIGlmIChvcHRpb25zLmlzVGVtcElucHV0RmlsZSkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOlRFTVBfSU5QVVRdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIElucHV0IGZpbGUgJHtmaWxlUGF0aH0gaXMgdGVtcG9yYXJ5IGFuZCBpdHMgZGlyZWN0b3J5ICR7dGVtcERpckZvckNsZWFudXB9IHdpbGwgYmUgY2xlYW5lZCB1cC5gKTtcclxuICAgICAgICB9XHJcblxyXG5cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCB3aW5kb3cgPSBldmVudD8uc2VuZGVyPy5nZXRPd25lckJyb3dzZXJXaW5kb3c/LigpIHx8IG51bGw7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBObyBsb25nZXIgY3JlYXRpbmcgYSBuZXcgdGVtcERpciBoZXJlOyB3aWxsIHVzZSB0aGUgZGlyZWN0b3J5IG9mIGZpbGVQYXRoIGlmIGl0J3MgYSB0ZW1wIGZpbGUuXHJcbiAgICAgICAgICAgIC8vIE9yLCBpZiB3ZSBuZWVkIGlzb2xhdGVkIHByb2Nlc3Npbmcgc3BhY2UsIGNyZWF0ZSBvbmUgYW5kIGNvcHkgZmlsZVBhdGggaW50byBpdC5cclxuICAgICAgICAgICAgLy8gRm9yIG5vdywgbGV0J3MgYXNzdW1lIGZpbGVQYXRoIGNhbiBiZSBwcm9jZXNzZWQgaW4gcGxhY2UsIGFuZCBpdHMgZGlyIGNsZWFuZWQgaWYgdGVtcC5cclxuXHJcbiAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucmVnaXN0ZXJDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwge1xyXG4gICAgICAgICAgICAgICAgaWQ6IGNvbnZlcnNpb25JZCxcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3N0YXJ0aW5nJyxcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAwLFxyXG4gICAgICAgICAgICAgICAgZmlsZVBhdGg6IGZpbGVQYXRoLCAvLyBQYXRoIHRvIHRoZSBhY3R1YWwgbWVkaWEgZmlsZSB0byBwcm9jZXNzXHJcbiAgICAgICAgICAgICAgICB0ZW1wRGlyOiB0ZW1wRGlyRm9yQ2xlYW51cCwgLy8gRGlyZWN0b3J5IHRvIGNsZWFuIHVwIGlmIGlucHV0IHdhcyB0ZW1wb3JhcnlcclxuICAgICAgICAgICAgICAgIHdpbmRvdyxcclxuICAgICAgICAgICAgICAgIHN0YXJ0VGltZTogRGF0ZS5ub3coKSxcclxuICAgICAgICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKSAvLyBVc2Ugb3JpZ2luYWwgbmFtZSBmcm9tIG9wdGlvbnMgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgaWYgKHdpbmRvdyAmJiB3aW5kb3cud2ViQ29udGVudHMpIHtcclxuICAgICAgICAgICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdtZWRpYTpjb252ZXJzaW9uLXN0YXJ0ZWQnLCB7IGNvbnZlcnNpb25JZCwgb3JpZ2luYWxGaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpIH0pO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBBc3luY2hyb25vdXNseSBwcm9jZXNzIHRoZSBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCBmaWxlUGF0aCwgb3B0aW9ucykuY2F0Y2goYXN5bmMgZXJyb3IgPT4geyAvLyBNYWtlIGNhdGNoIGFzeW5jIGZvciBjbGVhbnVwXHJcbiAgICAgICAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlIHx8ICdVbmtub3duIG1lZGlhIGNvbnZlcnNpb24gcHJvY2Vzc2luZyBlcnJvcic7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWVkaWFDb252ZXJ0ZXI6UFJPQ0VTU19DT05WRVJTSU9OX0VSUk9SXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBPdmVyYWxsIGNvbnZlcnNpb24gZmFpbGVkIGZvciAke29yaWdpbmFsRmlsZU5hbWVGb3JMb2d9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhlcnJvcikpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgXHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJywgXHJcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcclxuICAgICAgICAgICAgICAgICAgICBwcm9ncmVzczogMTAwIC8vIE1hcmsgYXMgY29tcGxldGUgZm9yIFVJIGhhbmRsaW5nLCBidXQgd2l0aCBlcnJvclxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAvLyBBdHRlbXB0IGNsZWFudXAgZXZlbiBvbiBlcnJvclxyXG4gICAgICAgICAgICAgICAgaWYgKHRlbXBEaXJGb3JDbGVhbnVwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpDTEVBTlVQX09OX0VSUk9SXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBDbGVhbmluZyB1cCB0ZW1wIGRpcmVjdG9yeTogJHt0ZW1wRGlyRm9yQ2xlYW51cH1gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXJGb3JDbGVhbnVwKTtcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNZWRpYUNvbnZlcnRlcjpDTEVBTlVQX09OX0VSUk9SX0ZBSUxFRF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gRmFpbGVkIHRvIGNsZWFuIHVwIHRlbXAgZGlyZWN0b3J5ICR7dGVtcERpckZvckNsZWFudXB9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhjbGVhbnVwRXJyKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnZlcnNpb25JZCwgb3JpZ2luYWxGaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IubWVzc2FnZSB8fCAnRmFpbGVkIHRvIHN0YXJ0IG1lZGlhIGNvbnZlcnNpb24nO1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWVkaWFDb252ZXJ0ZXI6SEFORExFX0NPTlZFUlRfRVJST1JdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIEVycm9yIGZvciAke29yaWdpbmFsRmlsZU5hbWVGb3JMb2d9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhlcnJvcikpO1xyXG4gICAgICAgICAgICAvLyBJZiByZWdpc3RyYXRpb24gaGFwcGVuZWQsIHVwZGF0ZSBpdCB0byBmYWlsZWQuXHJcbiAgICAgICAgICAgIGlmICh0aGlzLnJlZ2lzdHJ5LmdldENvbnZlcnNpb24oY29udmVyc2lvbklkKSkge1xyXG4gICAgICAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucGluZ0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB7IHN0YXR1czogJ2ZhaWxlZCcsIGVycm9yOiBlcnJvck1lc3NhZ2UsIHByb2dyZXNzOiAxMDB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyBBdHRlbXB0IGNsZWFudXAgaWYgdGVtcERpckZvckNsZWFudXAgd2FzIGRldGVybWluZWRcclxuICAgICAgICAgICAgaWYgKHRlbXBEaXJGb3JDbGVhbnVwKSB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXI6Q0xFQU5VUF9PTl9TVEFSVF9FUlJPUl1bY29udklkOiR7Y29udmVyc2lvbklkfV0gQ2xlYW5pbmcgdXAgdGVtcCBkaXJlY3Rvcnk6ICR7dGVtcERpckZvckNsZWFudXB9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXJGb3JDbGVhbnVwKTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWVkaWFDb252ZXJ0ZXI6Q0xFQU5VUF9PTl9TVEFSVF9FUlJPUl9GQUlMRURdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIEZhaWxlZCB0byBjbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeSAke3RlbXBEaXJGb3JDbGVhbnVwfTpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcoY2xlYW51cEVycikpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpOyAvLyBSZS10aHJvdyBmb3IgSVBDIHRvIGNhdGNoIGlmIG5lZWRlZFxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBtZXRhZGF0YSByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gTWV0YWRhdGEgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUdldE1ldGFkYXRhKGV2ZW50LCB7IGZpbGVQYXRoIH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyXSBHZXR0aW5nIG1ldGFkYXRhIGZvcjogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICAgICAgY29uc3QgZmlsZVR5cGUgPSB0aGlzLmdldEZpbGVUeXBlKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFNpbXBsZSBtZXRhZGF0YSBleHRyYWN0aW9uIHdpdGhvdXQgZmZwcm9iZVxyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IHtcclxuICAgICAgICAgICAgICAgIGZvcm1hdDogZmlsZVR5cGUudHlwZSxcclxuICAgICAgICAgICAgICAgIGR1cmF0aW9uOiBcIlVua25vd25cIiwgLy8gV2UgZG9uJ3QgaGF2ZSBmZnByb2JlIHRvIGdldCBkdXJhdGlvblxyXG4gICAgICAgICAgICAgICAgc2l6ZTogc3RhdHMuc2l6ZSxcclxuICAgICAgICAgICAgICAgIGZpbGVuYW1lOiBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKSxcclxuICAgICAgICAgICAgICAgIGlzQXVkaW86IGZpbGVUeXBlLmlzQXVkaW8sXHJcbiAgICAgICAgICAgICAgICBpc1ZpZGVvOiBmaWxlVHlwZS5pc1ZpZGVvXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gbWV0YWRhdGE7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW01lZGlhQ29udmVydGVyXSBGYWlsZWQgdG8gZ2V0IG1ldGFkYXRhOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIGNvbnZlcnNpb24gY2FuY2VsbGF0aW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDYW5jZWxsYXRpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUNhbmNlbChldmVudCwgeyBjb252ZXJzaW9uSWQgfSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnJlZ2lzdHJ5LnJlbW92ZUNvbnZlcnNpb24oY29udmVyc2lvbklkKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgbWVkaWEgY29udmVyc2lvblxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBtZWRpYSBmaWxlXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBwcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIGZpbGVQYXRoLCBvcHRpb25zKSB7XHJcbiAgICAgICAgY29uc3Qgb3JpZ2luYWxGaWxlTmFtZSA9IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOlBST0NFU1NfQ09OVkVSU0lPTl9TVEFSVF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gUHJvY2Vzc2luZyBtZWRpYSBmaWxlOiAke29yaWdpbmFsRmlsZU5hbWV9IChmcm9tIHBhdGg6ICR7ZmlsZVBhdGh9KWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGpvYkRhdGEgPSB0aGlzLnJlZ2lzdHJ5LmdldENvbnZlcnNpb24oY29udmVyc2lvbklkKTtcclxuICAgICAgICBjb25zdCB0ZW1wRGlyVG9DbGVhbnVwID0gam9iRGF0YSA/IGpvYkRhdGEudGVtcERpciA6IG51bGw7IC8vIFRoaXMgaXMgcGF0aC5kaXJuYW1lKGZpbGVQYXRoKSBpZiB0ZW1wXHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVUeXBlID0gdGhpcy5nZXRGaWxlVHlwZShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgeyBcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3ZhbGlkYXRpbmcnLCBcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiA1LFxyXG4gICAgICAgICAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLnR5cGUsXHJcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiAnVmFsaWRhdGluZyBmaWxlLi4uJ1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChmaWxlUGF0aCk7IC8vIGZpbGVQYXRoIGlzIHRoZSBhY3R1YWwgZmlsZSB0byBwcm9jZXNzXHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0ge1xyXG4gICAgICAgICAgICAgICAgZmlsZW5hbWU6IG9yaWdpbmFsRmlsZU5hbWUsIC8vIFVzZSB0aGUgb3JpZ2luYWwgZmlsZW5hbWUgZm9yIG1ldGFkYXRhXHJcbiAgICAgICAgICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUudHlwZSxcclxuICAgICAgICAgICAgICAgIHNpemU6IHN0YXRzLnNpemUsXHJcbiAgICAgICAgICAgICAgICBpc0F1ZGlvOiBmaWxlVHlwZS5pc0F1ZGlvLFxyXG4gICAgICAgICAgICAgICAgaXNWaWRlbzogZmlsZVR5cGUuaXNWaWRlb1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOlZBTElEQVRFRF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gRmlsZSB2YWxpZGF0ZWQuIE1ldGFkYXRhOmAsIHNhbml0aXplRm9yTG9nZ2luZyhtZXRhZGF0YSkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgc3RhdHVzOiAndHJhbnNjcmliaW5nJywgcHJvZ3Jlc3M6IDMwLCBtZXNzYWdlOiAnU3RhcnRpbmcgdHJhbnNjcmlwdGlvbi4uLicgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBsZXQgZGVlcGdyYW1BcGlLZXkgPSBvcHRpb25zLmRlZXBncmFtQXBpS2V5OyAvLyBBUEkga2V5IGZyb20gb3B0aW9ucyB0YWtlcyBwcmVjZWRlbmNlXHJcbiAgICAgICAgICAgIGlmICghZGVlcGdyYW1BcGlLZXkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGFwaUtleVNlcnZpY2UgPSByZXF1aXJlKCcuLi8uLi9BcGlLZXlTZXJ2aWNlJyk7XHJcbiAgICAgICAgICAgICAgICBkZWVwZ3JhbUFwaUtleSA9IGFwaUtleVNlcnZpY2UuZ2V0QXBpS2V5KCdkZWVwZ3JhbScpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGRlZXBncmFtQXBpS2V5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpBUElfS0VZX0ZPVU5EXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBEZWVwZ3JhbSBBUEkga2V5IGZvdW5kIHZpYSBBcGlLZXlTZXJ2aWNlLmApO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGBbTWVkaWFDb252ZXJ0ZXI6QVBJX0tFWV9XQVJOXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBEZWVwZ3JhbSBBUEkga2V5IG5vdCBwcm92aWRlZCBpbiBvcHRpb25zLCBhdHRlbXB0aW5nIHRvIGZpbmQgaW4gc2V0dGluZ3Mgc3RvcmUuYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVlcGdyYW1BcGlLZXkgPSBzZXR0aW5nc1N0b3JlLmdldCgnZGVlcGdyYW1BcGlLZXknKSB8fCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXR0aW5nc1N0b3JlLmdldCgndHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleScpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZGVlcGdyYW1BcGlLZXkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOkFQSV9LRVlfRk9VTkRdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIERlZXBncmFtIEFQSSBrZXkgZm91bmQgaW4gc2V0dGluZ3Mgc3RvcmUuYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdbTWVkaWFDb252ZXJ0ZXI6QVBJX0tFWV9TVE9SRV9FUlJPUl1bY29udklkOiR7Y29udmVyc2lvbklkfV0gRXJyb3IgYWNjZXNzaW5nIHNldHRpbmdzIHN0b3JlIGZvciBBUEkga2V5OicsIHNhbml0aXplRm9yTG9nZ2luZyhlcnIpKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpBUElfS0VZX1BST1ZJREVEXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBEZWVwZ3JhbSBBUEkga2V5IHByb3ZpZGVkIGluIG9wdGlvbnMuYCk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmICghZGVlcGdyYW1BcGlLZXkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNZWRpYUNvbnZlcnRlcjpOT19BUElfS0VZXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBObyBEZWVwZ3JhbSBBUEkga2V5IGZvdW5kLiBBYm9ydGluZyB0cmFuc2NyaXB0aW9uLmApO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdEZWVwZ3JhbSBBUEkga2V5IG5vdCBmb3VuZC4gUGxlYXNlIGNvbmZpZ3VyZSBpdCBpbiBTZXR0aW5ncyA+IFRyYW5zY3JpcHRpb24uJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXI6VFJBTlNDUklQVElPTl9TVEFSVF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gSW5pdGlhdGluZyB0cmFuc2NyaXB0aW9uIGZvciAke29yaWdpbmFsRmlsZU5hbWV9YCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBVc2UgVHJhbnNjcmlwdGlvblNlcnZpY2UgZm9yIHRyYW5zY3JpcHRpb24sIGZpbGVQYXRoIGlzIHRoZSBhY3R1YWwgbWVkaWEgZGF0YVxyXG4gICAgICAgICAgICBjb25zdCB0cmFuc2NyaXB0aW9uVGV4dCA9IGF3YWl0IHRoaXMudHJhbnNjcmlwdGlvblNlcnZpY2UudHJhbnNjcmliZUF1ZGlvKGZpbGVQYXRoLCBkZWVwZ3JhbUFwaUtleSwge1xyXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2U6IG9wdGlvbnMubGFuZ3VhZ2UsIC8vIFBhc3MgcmVsZXZhbnQgb3B0aW9uc1xyXG4gICAgICAgICAgICAgICAgcHVuY3R1YXRlOiBvcHRpb25zLnB1bmN0dWF0ZSxcclxuICAgICAgICAgICAgICAgIHNtYXJ0X2Zvcm1hdDogb3B0aW9ucy5zbWFydF9mb3JtYXQsXHJcbiAgICAgICAgICAgICAgICBkaWFyaXplOiBvcHRpb25zLmRpYXJpemUsXHJcbiAgICAgICAgICAgICAgICB1dHRlcmFuY2VzOiBvcHRpb25zLnV0dGVyYW5jZXMsXHJcbiAgICAgICAgICAgICAgICBkZWVwZ3JhbU9wdGlvbnM6IG9wdGlvbnMuZGVlcGdyYW1PcHRpb25zLCAvLyBQYXNzIHRocm91Z2ggYW55IHNwZWNpZmljIERHIG9wdGlvbnNcclxuICAgICAgICAgICAgICAgIG1vZGVsOiBvcHRpb25zLm1vZGVsIC8vIEFsbG93IG1vZGVsIG92ZXJyaWRlIGZyb20gb3B0aW9uc1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFRyYW5zY3JpcHRpb25TZXJ2aWNlIG5vdyB0aHJvd3Mgb24gZW1wdHkvZmFpbGVkIHJlc3VsdCwgc28gdGhpcyBjaGVjayBtaWdodCBiZSByZWR1bmRhbnQgYnV0IHNhZmUuXHJcbiAgICAgICAgICAgIGlmICghdHJhbnNjcmlwdGlvblRleHQgfHwgdHJhbnNjcmlwdGlvblRleHQudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW01lZGlhQ29udmVydGVyOkVNUFRZX1RSQU5TQ1JJUFRJT05dW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIFRyYW5zY3JpcHRpb24gY29tcGxldGVkIGJ1dCByZXR1cm5lZCBubyB0ZXh0IGNvbnRlbnQuYCk7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RyYW5zY3JpcHRpb24gcHJvZHVjZWQgbm8gdGV4dCBjb250ZW50LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXI6VFJBTlNDUklQVElPTl9TVUNDRVNTXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBUcmFuc2NyaXB0aW9uIHN1Y2Nlc3NmdWwuIFRleHQgbGVuZ3RoOiAke3RyYW5zY3JpcHRpb25UZXh0Lmxlbmd0aH1gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENvbnN0cnVjdCBhIHJlc3VsdCBvYmplY3Qgc2ltaWxhciB0byB3aGF0IERlZXBncmFtU2VydmljZSdzIGZvcm1hdFRyYW5zY3JpcHRpb25SZXN1bHQgd291bGQgcHJvZHVjZVxyXG4gICAgICAgICAgICBjb25zdCB0cmFuc2NyaXB0aW9uUmVzdWx0ID0ge1xyXG4gICAgICAgICAgICAgICAgdGV4dDogdHJhbnNjcmlwdGlvblRleHQsXHJcbiAgICAgICAgICAgICAgICAvLyBXZSBtaWdodCBub3QgaGF2ZSBkZXRhaWxlZCBkdXJhdGlvbi9tb2RlbCBmcm9tIFRyYW5zY3JpcHRpb25TZXJ2aWNlIGRpcmVjdGx5IGhlcmUsXHJcbiAgICAgICAgICAgICAgICAvLyBidXQgd2UgY2FuIHBhc3Mgd2hhdCB3ZSBrbm93IG9yIGVuaGFuY2UgVHJhbnNjcmlwdGlvblNlcnZpY2UgdG8gcmV0dXJuIG1vcmUgZGV0YWlscy5cclxuICAgICAgICAgICAgICAgIG1vZGVsOiBvcHRpb25zLm1vZGVsIHx8IHNldHRpbmdzU3RvcmUuZ2V0KCd0cmFuc2NyaXB0aW9uLm1vZGVsJywgJ25vdmEtMicpLFxyXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2U6IG9wdGlvbnMubGFuZ3VhZ2UgfHwgJ2VuJyxcclxuICAgICAgICAgICAgICAgIC8vIGR1cmF0aW9uOiBcIlVua25vd25cIiAvLyBPciBnZXQgZnJvbSBtZXRhZGF0YSBpZiBwb3NzaWJsZVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgc3RhdHVzOiAnZ2VuZXJhdGluZ19tYXJrZG93bicsIHByb2dyZXNzOiA5MCwgbWVzc2FnZTogJ0dlbmVyYXRpbmcgTWFya2Rvd24uLi4nIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBtYXJrZG93biA9IHRoaXMuZ2VuZXJhdGVNYXJrZG93bihtZXRhZGF0YSwgdHJhbnNjcmlwdGlvblJlc3VsdCwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXI6TUFSS0RPV05fR0VORVJBVEVEXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBNYXJrZG93biBnZW5lcmF0ZWQuYCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgeyBcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsIFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDEwMCxcclxuICAgICAgICAgICAgICAgIHJlc3VsdDogbWFya2Rvd24sXHJcbiAgICAgICAgICAgICAgICB0cmFuc2NyaWJlZDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG1ldGFkYXRhLmZpbGVuYW1lLFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogJ0NvbnZlcnNpb24gY29tcGxldGUhJ1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiBtYXJrZG93bjtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlIHx8ICdVbmtub3duIG1lZGlhIGNvbnZlcnNpb24gZXJyb3InO1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWVkaWFDb252ZXJ0ZXI6UFJPQ0VTU19DT05WRVJTSU9OX0ZBSUxFRF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gRXJyb3IgZm9yICR7b3JpZ2luYWxGaWxlTmFtZX06YCwgc2FuaXRpemVGb3JMb2dnaW5nKGVycm9yKSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgeyBcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ2ZhaWxlZCcsIFxyXG4gICAgICAgICAgICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAxMDAsIC8vIE1hcmsgYXMgY29tcGxldGUgZm9yIFVJIGhhbmRsaW5nXHJcbiAgICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcmlnaW5hbEZpbGVOYW1lLCAvLyBLZWVwIG9yaWdpbmFsRmlsZU5hbWUgaW4gdGhlIHN0YXR1cyB1cGRhdGVcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGBDb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvck1lc3NhZ2V9YFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgLy8gRXJyb3IgaXMgbG9nZ2VkIGFuZCBzdGF0dXMgdXBkYXRlZC4gRG8gbm90IHJlLXRocm93IHRvIGFsbG93IGNsZWFudXAuXHJcbiAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgICAgLy8gQ2xlYW51cCB0aGUgdGVtcG9yYXJ5IGRpcmVjdG9yeSBpZiBvbmUgd2FzIHNwZWNpZmllZCBmb3IgY2xlYW51cFxyXG4gICAgICAgICAgICBpZiAodGVtcERpclRvQ2xlYW51cCkge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOkNMRUFOVVBfRklOQUxMWV1bY29udklkOiR7Y29udmVyc2lvbklkfV0gQ2xlYW5pbmcgdXAgdGVtcCBkaXJlY3Rvcnk6ICR7dGVtcERpclRvQ2xlYW51cH1gKTtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpclRvQ2xlYW51cCk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpDTEVBTlVQX0ZJTkFMTFlfU1VDQ0VTU11bY29udklkOiR7Y29udmVyc2lvbklkfV0gVGVtcCBkaXJlY3RvcnkgJHt0ZW1wRGlyVG9DbGVhbnVwfSByZW1vdmVkLmApO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoY2xlYW51cEVycikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNZWRpYUNvbnZlcnRlcjpDTEVBTlVQX0ZJTkFMTFlfRkFJTEVEXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3RvcnkgJHt0ZW1wRGlyVG9DbGVhbnVwfTpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcoY2xlYW51cEVycikpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpOT19DTEVBTlVQX05FRURFRF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gTm8gdGVtcG9yYXJ5IGlucHV0IGRpcmVjdG9yeSB3YXMgc3BlY2lmaWVkIGZvciBjbGVhbnVwLmApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIG1hcmtkb3duIGZyb20gbWVkaWEgbWV0YWRhdGEgYW5kIHRyYW5zY3JpcHRpb25cclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBtZXRhZGF0YSAtIE1lZGlhIG1ldGFkYXRhXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gdHJhbnNjcmlwdGlvbiAtIFRyYW5zY3JpcHRpb24gcmVzdWx0XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gTWFya2Rvd24gY29udGVudFxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCB0cmFuc2NyaXB0aW9uLCBvcHRpb25zKSB7XHJcbiAgICAgICAgY29uc3QgbWFya2Rvd24gPSBbXTtcclxuXHJcbiAgICAgICAgLy8gQWRkIHRpdGxlXHJcbiAgICAgICAgaWYgKG9wdGlvbnMudGl0bGUpIHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIyAke29wdGlvbnMudGl0bGV9YCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc3QgbWVkaWFUeXBlID0gbWV0YWRhdGEuaXNWaWRlbyA/ICdWaWRlbycgOiAnQXVkaW8nO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7bWVkaWFUeXBlfTogJHttZXRhZGF0YS5maWxlbmFtZX1gKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG5cclxuICAgICAgICAvLyBBZGQgbWV0YWRhdGFcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBNZWRpYSBJbmZvcm1hdGlvbicpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJ3wgUHJvcGVydHkgfCBWYWx1ZSB8Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnfCAtLS0gfCAtLS0gfCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRmlsZW5hbWUgfCAke21ldGFkYXRhLmZpbGVuYW1lfSB8YCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBUeXBlIHwgJHttZXRhZGF0YS5pc1ZpZGVvID8gJ1ZpZGVvJyA6ICdBdWRpbyd9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IEZvcm1hdCB8ICR7bWV0YWRhdGEuZmlsZVR5cGV9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IEZpbGUgU2l6ZSB8ICR7dGhpcy5mb3JtYXRGaWxlU2l6ZShtZXRhZGF0YS5zaXplKX0gfGApO1xyXG5cclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuXHJcbiAgICAgICAgLy8gQWRkIHRyYW5zY3JpcHRpb24gc2VjdGlvblxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIFRyYW5zY3JpcHRpb24nKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdHJhbnNjcmlwdGlvbiB0ZXh0XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCh0cmFuc2NyaXB0aW9uLnRleHQpO1xyXG5cclxuICAgICAgICAvLyBBZGQgdHJhbnNjcmlwdGlvbiBtZXRhZGF0YSBpZiBhdmFpbGFibGVcclxuICAgICAgICBpZiAodHJhbnNjcmlwdGlvbi5tb2RlbCB8fCB0cmFuc2NyaXB0aW9uLmR1cmF0aW9uKSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyMgVHJhbnNjcmlwdGlvbiBEZXRhaWxzJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCd8IFByb3BlcnR5IHwgVmFsdWUgfCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCd8IC0tLSB8IC0tLSB8Jyk7XHJcbiAgICAgICAgICAgIGlmICh0cmFuc2NyaXB0aW9uLm1vZGVsKSB7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGB8IE1vZGVsIHwgJHt0cmFuc2NyaXB0aW9uLm1vZGVsfSB8YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRyYW5zY3JpcHRpb24uZHVyYXRpb24pIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGR1cmF0aW9uID0gdHlwZW9mIHRyYW5zY3JpcHRpb24uZHVyYXRpb24gPT09ICdudW1iZXInXHJcbiAgICAgICAgICAgICAgICAgICAgPyB0aGlzLmZvcm1hdER1cmF0aW9uKHRyYW5zY3JpcHRpb24uZHVyYXRpb24pXHJcbiAgICAgICAgICAgICAgICAgICAgOiB0cmFuc2NyaXB0aW9uLmR1cmF0aW9uO1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBEdXJhdGlvbiB8ICR7ZHVyYXRpb259IHxgKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodHJhbnNjcmlwdGlvbi5sYW5ndWFnZSkge1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBMYW5ndWFnZSB8ICR7dHJhbnNjcmlwdGlvbi5sYW5ndWFnZX0gfGApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBtYXJrZG93bi5qb2luKCdcXG4nKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBGb3JtYXQgZmlsZSBzaXplIGluIGJ5dGVzIHRvIGh1bWFuLXJlYWRhYmxlIGZvcm1hdFxyXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IGJ5dGVzIC0gRmlsZSBzaXplIGluIGJ5dGVzXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGb3JtYXR0ZWQgZmlsZSBzaXplXHJcbiAgICAgKi9cclxuICAgIGZvcm1hdEZpbGVTaXplKGJ5dGVzKSB7XHJcbiAgICAgICAgY29uc3QgdW5pdHMgPSBbJ0InLCAnS0InLCAnTUInLCAnR0InXTtcclxuICAgICAgICBsZXQgc2l6ZSA9IGJ5dGVzO1xyXG4gICAgICAgIGxldCB1bml0SW5kZXggPSAwO1xyXG5cclxuICAgICAgICB3aGlsZSAoc2l6ZSA+PSAxMDI0ICYmIHVuaXRJbmRleCA8IHVuaXRzLmxlbmd0aCAtIDEpIHtcclxuICAgICAgICAgICAgc2l6ZSAvPSAxMDI0O1xyXG4gICAgICAgICAgICB1bml0SW5kZXgrKztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBgJHtzaXplLnRvRml4ZWQoMil9ICR7dW5pdHNbdW5pdEluZGV4XX1gO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRm9ybWF0IGR1cmF0aW9uIGluIHNlY29uZHMgdG8gYSBodW1hbi1yZWFkYWJsZSBmb3JtYXRcclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBzZWNvbmRzIC0gRHVyYXRpb24gaW4gc2Vjb25kc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gRm9ybWF0dGVkIGR1cmF0aW9uXHJcbiAgICAgKi9cclxuICAgIGZvcm1hdER1cmF0aW9uKHNlY29uZHMpIHtcclxuICAgICAgICBpZiAoIXNlY29uZHMgfHwgdHlwZW9mIHNlY29uZHMgIT09ICdudW1iZXInKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAnVW5rbm93bic7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBtaW51dGVzID0gTWF0aC5mbG9vcihzZWNvbmRzIC8gNjApO1xyXG4gICAgICAgIGNvbnN0IHJlbWFpbmluZ1NlY29uZHMgPSBNYXRoLmZsb29yKHNlY29uZHMgJSA2MCk7XHJcblxyXG4gICAgICAgIGlmIChtaW51dGVzID09PSAwKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBgJHtyZW1haW5pbmdTZWNvbmRzfSBzZWNgO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGAke21pbnV0ZXN9OiR7cmVtYWluaW5nU2Vjb25kcy50b1N0cmluZygpLnBhZFN0YXJ0KDIsICcwJyl9YDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgZmlsZSB0eXBlIGluZm9ybWF0aW9uIGZyb20gZmlsZSBwYXRoXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIGZpbGVcclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IEZpbGUgdHlwZSBpbmZvcm1hdGlvblxyXG4gICAgICovXHJcbiAgICBnZXRGaWxlVHlwZShmaWxlUGF0aCkge1xyXG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBdWRpbyBleHRlbnNpb25zXHJcbiAgICAgICAgY29uc3QgYXVkaW9FeHRlbnNpb25zID0gWycubXAzJywgJy53YXYnLCAnLm9nZycsICcubTRhJywgJy5mbGFjJywgJy5hYWMnXTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBWaWRlbyBleHRlbnNpb25zXHJcbiAgICAgICAgY29uc3QgdmlkZW9FeHRlbnNpb25zID0gWycubXA0JywgJy5tb3YnLCAnLmF2aScsICcubWt2JywgJy53ZWJtJ107XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBleHQsXHJcbiAgICAgICAgICAgIHR5cGU6IGV4dC5zdWJzdHJpbmcoMSksIC8vIFJlbW92ZSB0aGUgZG90XHJcbiAgICAgICAgICAgIGlzQXVkaW86IGF1ZGlvRXh0ZW5zaW9ucy5pbmNsdWRlcyhleHQpLFxyXG4gICAgICAgICAgICBpc1ZpZGVvOiB2aWRlb0V4dGVuc2lvbnMuaW5jbHVkZXMoZXh0KVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgdW5pcXVlIGNvbnZlcnNpb24gaWRlbnRpZmllclxyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gVW5pcXVlIGNvbnZlcnNpb24gSURcclxuICAgICAqL1xyXG4gICAgZ2VuZXJhdGVDb252ZXJzaW9uSWQoKSB7XHJcbiAgICAgICAgcmV0dXJuIGBtZWRpYV8ke0RhdGUubm93KCl9XyR7dXVpZHY0KCkuc3Vic3RyaW5nKDAsIDgpfWA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgdGhpcyBjb252ZXJ0ZXIgc3VwcG9ydHMgdGhlIGdpdmVuIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gZmlsZVxyXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXHJcbiAgICAgKi9cclxuICAgIHN1cHBvcnRzRmlsZShmaWxlUGF0aCkge1xyXG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICByZXR1cm4gdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLmluY2x1ZGVzKGV4dCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgY29udmVydGVyIGluZm9ybWF0aW9uXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBnZXRJbmZvKCkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIG5hbWU6ICdNZWRpYSBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICBleHRlbnNpb25zOiB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMsXHJcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ29udmVydHMgYXVkaW8gYW5kIHZpZGVvIGZpbGVzIHRvIG1hcmtkb3duIHdpdGggdHJhbnNjcmlwdGlvbiB1c2luZyBEZWVwZ3JhbScsXHJcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICAgIHRyYW5zY3JpYmU6ICdXaGV0aGVyIHRvIHRyYW5zY3JpYmUgbWVkaWEgKGRlZmF1bHQ6IHRydWUpJyxcclxuICAgICAgICAgICAgICAgIGxhbmd1YWdlOiAnVHJhbnNjcmlwdGlvbiBsYW5ndWFnZSAoZGVmYXVsdDogZW4pJyxcclxuICAgICAgICAgICAgICAgIHRpdGxlOiAnT3B0aW9uYWwgZG9jdW1lbnQgdGl0bGUnXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IE1lZGlhQ29udmVydGVyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDOUIsTUFBTTtFQUFFRSxFQUFFLEVBQUVDO0FBQU8sQ0FBQyxHQUFHSCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQ3RDLE1BQU1JLFdBQVcsR0FBR0osT0FBTyxDQUFDLG1CQUFtQixDQUFDO0FBQ2hELE1BQU07RUFBRUs7QUFBWSxDQUFD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