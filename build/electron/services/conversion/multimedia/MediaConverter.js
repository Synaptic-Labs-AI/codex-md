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
    // Don't log the full options object as it might contain large buffers
    // Create a clean object without spreading to avoid copying buffer data
    const safeOptionsForLogging = {
      originalFileName: options.originalFileName,
      isTempInputFile: options.isTempInputFile,
      deepgramApiKey: options.deepgramApiKey ? '[API Key Hidden]' : undefined,
      language: options.language,
      punctuate: options.punctuate,
      smart_format: options.smart_format,
      diarize: options.diarize,
      utterances: options.utterances,
      model: options.model,
      // Explicitly exclude any buffer-like properties
      content: options.content ? '[Buffer excluded from logs]' : undefined,
      buffer: options.buffer ? '[Buffer excluded from logs]' : undefined
      // Add any other safe properties you want to log
    };
    console.log(`[MediaConverter:HANDLE_CONVERT_START][convId:${conversionId}] Options:`, safeOptionsForLogging);

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

      // Re-throw the error to prevent creating a placeholder note
      // This will be caught by the handleConvert method and properly handled
      throw error;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwidjQiLCJ1dWlkdjQiLCJCYXNlU2VydmljZSIsImNyZWF0ZVN0b3JlIiwic2V0dGluZ3NTdG9yZSIsInNhbml0aXplRm9yTG9nZ2luZyIsIm9iaiIsInZpc2l0ZWQiLCJTZXQiLCJoYXMiLCJhZGQiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImxlbmd0aCIsIkFycmF5IiwiaXNBcnJheSIsIm1hcCIsIml0ZW0iLCJzYW5pdGl6ZWQiLCJrZXkiLCJ2YWx1ZSIsIk9iamVjdCIsImVudHJpZXMiLCJkZWxldGUiLCJNZWRpYUNvbnZlcnRlciIsImNvbnN0cnVjdG9yIiwicmVnaXN0cnkiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJ0cmFuc2NyaXB0aW9uU2VydmljZSIsInN1cHBvcnRlZEV4dGVuc2lvbnMiLCJjb25zb2xlIiwibG9nIiwiam9pbiIsInNldHVwSXBjSGFuZGxlcnMiLCJyZWdpc3RlckhhbmRsZXIiLCJoYW5kbGVDb252ZXJ0IiwiYmluZCIsImhhbmRsZUdldE1ldGFkYXRhIiwiaGFuZGxlQ2FuY2VsIiwiZXZlbnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJjb252ZXJzaW9uSWQiLCJnZW5lcmF0ZUNvbnZlcnNpb25JZCIsIm9yaWdpbmFsRmlsZU5hbWVGb3JMb2ciLCJvcmlnaW5hbEZpbGVOYW1lIiwiYmFzZW5hbWUiLCJzYWZlT3B0aW9uc0ZvckxvZ2dpbmciLCJpc1RlbXBJbnB1dEZpbGUiLCJkZWVwZ3JhbUFwaUtleSIsInVuZGVmaW5lZCIsImxhbmd1YWdlIiwicHVuY3R1YXRlIiwic21hcnRfZm9ybWF0IiwiZGlhcml6ZSIsInV0dGVyYW5jZXMiLCJtb2RlbCIsImNvbnRlbnQiLCJidWZmZXIiLCJ0ZW1wRGlyRm9yQ2xlYW51cCIsImRpcm5hbWUiLCJ3aW5kb3ciLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJyZWdpc3RlckNvbnZlcnNpb24iLCJpZCIsInN0YXR1cyIsInByb2dyZXNzIiwidGVtcERpciIsInN0YXJ0VGltZSIsIkRhdGUiLCJub3ciLCJ3ZWJDb250ZW50cyIsInNlbmQiLCJwcm9jZXNzQ29udmVyc2lvbiIsImNhdGNoIiwiZXJyb3IiLCJlcnJvck1lc3NhZ2UiLCJtZXNzYWdlIiwicGluZ0NvbnZlcnNpb24iLCJyZW1vdmUiLCJjbGVhbnVwRXJyIiwiZ2V0Q29udmVyc2lvbiIsIkVycm9yIiwiZmlsZVR5cGUiLCJnZXRGaWxlVHlwZSIsInN0YXRzIiwic3RhdCIsIm1ldGFkYXRhIiwiZm9ybWF0IiwidHlwZSIsImR1cmF0aW9uIiwic2l6ZSIsImZpbGVuYW1lIiwiaXNBdWRpbyIsImlzVmlkZW8iLCJyZW1vdmVDb252ZXJzaW9uIiwiam9iRGF0YSIsInRlbXBEaXJUb0NsZWFudXAiLCJhcGlLZXlTZXJ2aWNlIiwiZ2V0QXBpS2V5Iiwid2FybiIsImdldCIsImVyciIsInRyYW5zY3JpcHRpb25UZXh0IiwidHJhbnNjcmliZUF1ZGlvIiwiZGVlcGdyYW1PcHRpb25zIiwidHJpbSIsInRyYW5zY3JpcHRpb25SZXN1bHQiLCJ0ZXh0IiwibWFya2Rvd24iLCJnZW5lcmF0ZU1hcmtkb3duIiwicmVzdWx0IiwidHJhbnNjcmliZWQiLCJ0cmFuc2NyaXB0aW9uIiwidGl0bGUiLCJwdXNoIiwibWVkaWFUeXBlIiwiZm9ybWF0RmlsZVNpemUiLCJmb3JtYXREdXJhdGlvbiIsImJ5dGVzIiwidW5pdHMiLCJ1bml0SW5kZXgiLCJ0b0ZpeGVkIiwic2Vjb25kcyIsIm1pbnV0ZXMiLCJNYXRoIiwiZmxvb3IiLCJyZW1haW5pbmdTZWNvbmRzIiwidG9TdHJpbmciLCJwYWRTdGFydCIsImV4dCIsImV4dG5hbWUiLCJ0b0xvd2VyQ2FzZSIsImF1ZGlvRXh0ZW5zaW9ucyIsInZpZGVvRXh0ZW5zaW9ucyIsImV4dGVuc2lvbiIsInN1YnN0cmluZyIsImluY2x1ZGVzIiwic3VwcG9ydHNGaWxlIiwiZ2V0SW5mbyIsIm5hbWUiLCJleHRlbnNpb25zIiwiZGVzY3JpcHRpb24iLCJ0cmFuc2NyaWJlIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL211bHRpbWVkaWEvTWVkaWFDb252ZXJ0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIE1lZGlhQ29udmVydGVyLmpzXHJcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiBhdWRpbyBhbmQgdmlkZW8gZmlsZXMgdG8gbWFya2Rvd24gZm9ybWF0IGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXHJcbiAqIFxyXG4gKiBUaGlzIGNvbnZlcnRlcjpcclxuICogLSBQcm9jZXNzZXMgYXVkaW8gYW5kIHZpZGVvIGZpbGVzIHVzaW5nIERlZXBncmFtIEFQSVxyXG4gKiAtIEV4dHJhY3RzIG1ldGFkYXRhIChkdXJhdGlvbiwgdHlwZSwgZXRjLilcclxuICogLSBUcmFuc2NyaWJlcyBjb250ZW50IHVzaW5nIERlZXBncmFtXHJcbiAqIC0gR2VuZXJhdGVzIHN0cnVjdHVyZWQgbWFya2Rvd24gb3V0cHV0XHJcbiAqIFxyXG4gKiBSZWxhdGVkIEZpbGVzOlxyXG4gKiAtIEJhc2VTZXJ2aWNlLmpzOiBQYXJlbnQgY2xhc3MgcHJvdmlkaW5nIElQQyBoYW5kbGluZ1xyXG4gKiAtIERlZXBncmFtU2VydmljZS5qczogVXNlZCBmb3IgYXVkaW8vdmlkZW8gdHJhbnNjcmlwdGlvblxyXG4gKiAtIEZpbGVTdG9yYWdlU2VydmljZS5qczogRm9yIHRlbXBvcmFyeSBmaWxlIG1hbmFnZW1lbnRcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbmNvbnN0IHsgdjQ6IHV1aWR2NCB9ID0gcmVxdWlyZSgndXVpZCcpO1xyXG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL0Jhc2VTZXJ2aWNlJyk7XHJcbmNvbnN0IHsgY3JlYXRlU3RvcmUgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL3V0aWxzL3N0b3JlRmFjdG9yeScpO1xyXG5cclxuLy8gU2V0dGluZ3Mgc3RvcmUgZm9yIHRyYW5zY3JpcHRpb24gc2V0dGluZ3NcclxuY29uc3Qgc2V0dGluZ3NTdG9yZSA9IGNyZWF0ZVN0b3JlKCdzZXR0aW5ncycpO1xyXG5cclxuLy8gVXRpbGl0eSB0byBzYW5pdGl6ZSBvYmplY3RzIGZvciBsb2dnaW5nLCBlc3BlY2lhbGx5IHRvIGhhbmRsZSBCdWZmZXJzXHJcbi8vIENvcGllZCBmcm9tIERlZXBncmFtU2VydmljZS5qcyBmb3IgY29uc2lzdGVuY3ksIG9yIGNvdWxkIGJlIG1vdmVkIHRvIGEgc2hhcmVkIHV0aWxcclxuZnVuY3Rpb24gc2FuaXRpemVGb3JMb2dnaW5nKG9iaiwgdmlzaXRlZCA9IG5ldyBTZXQoKSkge1xyXG4gIGlmIChvYmogPT09IG51bGwgfHwgdHlwZW9mIG9iaiAhPT0gJ29iamVjdCcgfHwgdmlzaXRlZC5oYXMob2JqKSkge1xyXG4gICAgcmV0dXJuIG9iajtcclxuICB9XHJcblxyXG4gIHZpc2l0ZWQuYWRkKG9iaik7XHJcblxyXG4gIGlmIChCdWZmZXIuaXNCdWZmZXIob2JqKSkge1xyXG4gICAgcmV0dXJuIGBbQnVmZmVyIGxlbmd0aDogJHtvYmoubGVuZ3RofV1gO1xyXG4gIH1cclxuXHJcbiAgaWYgKEFycmF5LmlzQXJyYXkob2JqKSkge1xyXG4gICAgcmV0dXJuIG9iai5tYXAoaXRlbSA9PiBzYW5pdGl6ZUZvckxvZ2dpbmcoaXRlbSwgbmV3IFNldCh2aXNpdGVkKSkpO1xyXG4gIH1cclxuXHJcbiAgY29uc3Qgc2FuaXRpemVkID0ge307XHJcbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMob2JqKSkge1xyXG4gICAgc2FuaXRpemVkW2tleV0gPSBzYW5pdGl6ZUZvckxvZ2dpbmcodmFsdWUsIG5ldyBTZXQodmlzaXRlZCkpO1xyXG4gIH1cclxuICBcclxuICB2aXNpdGVkLmRlbGV0ZShvYmopO1xyXG4gIHJldHVybiBzYW5pdGl6ZWQ7XHJcbn1cclxuXHJcbmNsYXNzIE1lZGlhQ29udmVydGVyIGV4dGVuZHMgQmFzZVNlcnZpY2Uge1xyXG4gICAgY29uc3RydWN0b3IocmVnaXN0cnksIGZpbGVQcm9jZXNzb3IsIGZpbGVTdG9yYWdlKSB7XHJcbiAgICAgICAgc3VwZXIoKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdHJ5ID0gcmVnaXN0cnk7XHJcbiAgICAgICAgdGhpcy5maWxlUHJvY2Vzc29yID0gZmlsZVByb2Nlc3NvcjtcclxuICAgICAgICB0aGlzLmZpbGVTdG9yYWdlID0gZmlsZVN0b3JhZ2U7XHJcbiAgICAgICAgLy8gSXQncyBiZXR0ZXIgdG8gdXNlIHRoZSBUcmFuc2NyaXB0aW9uU2VydmljZSB3aGljaCBhYnN0cmFjdHMgRGVlcGdyYW1cclxuICAgICAgICB0aGlzLnRyYW5zY3JpcHRpb25TZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vVHJhbnNjcmlwdGlvblNlcnZpY2UnKTsgXHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gU3VwcG9ydGVkIGZpbGUgZXh0ZW5zaW9uc1xyXG4gICAgICAgIHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyA9IFtcclxuICAgICAgICAgICAgLy8gQXVkaW8gZm9ybWF0c1xyXG4gICAgICAgICAgICAnLm1wMycsICcud2F2JywgJy5vZ2cnLCAnLm00YScsICcuZmxhYycsICcuYWFjJyxcclxuICAgICAgICAgICAgLy8gVmlkZW8gZm9ybWF0c1xyXG4gICAgICAgICAgICAnLm1wNCcsICcubW92JywgJy5hdmknLCAnLm1rdicsICcud2VibSdcclxuICAgICAgICBdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKCdbTWVkaWFDb252ZXJ0ZXJdIEluaXRpYWxpemVkIHdpdGggc3VwcG9ydCBmb3I6JywgdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLmpvaW4oJywgJykpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogU2V0IHVwIElQQyBoYW5kbGVycyBmb3IgbWVkaWEgY29udmVyc2lvblxyXG4gICAgICovXHJcbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0Om1lZGlhJywgdGhpcy5oYW5kbGVDb252ZXJ0LmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0Om1lZGlhOm1ldGFkYXRhJywgdGhpcy5oYW5kbGVHZXRNZXRhZGF0YS5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDptZWRpYTpjYW5jZWwnLCB0aGlzLmhhbmRsZUNhbmNlbC5iaW5kKHRoaXMpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBtZWRpYSBjb252ZXJzaW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb252ZXJzaW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDb252ZXJ0KGV2ZW50LCB7IGZpbGVQYXRoLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIGNvbnN0IGNvbnZlcnNpb25JZCA9IHRoaXMuZ2VuZXJhdGVDb252ZXJzaW9uSWQoKTtcclxuICAgICAgICAvLyBmaWxlUGF0aCBoZXJlIGlzIHRoZSBwYXRoIHRvIHRoZSB0ZW1wb3JhcnkgZmlsZSBjcmVhdGVkIGJ5IHRoZSBhZGFwdGVyLCBvciB0aGUgb3JpZ2luYWwgdXNlciBmaWxlIHBhdGggaWYgbm90IGZyb20gYnVmZmVyLlxyXG4gICAgICAgIGNvbnN0IG9yaWdpbmFsRmlsZU5hbWVGb3JMb2cgPSBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgcGF0aC5iYXNlbmFtZShmaWxlUGF0aCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpIQU5ETEVfQ09OVkVSVF9TVEFSVF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gU3RhcnRpbmcgbWVkaWEgY29udmVyc2lvbiBmb3I6ICR7b3JpZ2luYWxGaWxlTmFtZUZvckxvZ30gKGlucHV0IHBhdGg6ICR7ZmlsZVBhdGh9KWApO1xyXG4gICAgICAgIC8vIERvbid0IGxvZyB0aGUgZnVsbCBvcHRpb25zIG9iamVjdCBhcyBpdCBtaWdodCBjb250YWluIGxhcmdlIGJ1ZmZlcnNcclxuICAgICAgICAvLyBDcmVhdGUgYSBjbGVhbiBvYmplY3Qgd2l0aG91dCBzcHJlYWRpbmcgdG8gYXZvaWQgY29weWluZyBidWZmZXIgZGF0YVxyXG4gICAgICAgIGNvbnN0IHNhZmVPcHRpb25zRm9yTG9nZ2luZyA9IHtcclxuICAgICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICAgICAgICBpc1RlbXBJbnB1dEZpbGU6IG9wdGlvbnMuaXNUZW1wSW5wdXRGaWxlLFxyXG4gICAgICAgICAgICBkZWVwZ3JhbUFwaUtleTogb3B0aW9ucy5kZWVwZ3JhbUFwaUtleSA/ICdbQVBJIEtleSBIaWRkZW5dJyA6IHVuZGVmaW5lZCxcclxuICAgICAgICAgICAgbGFuZ3VhZ2U6IG9wdGlvbnMubGFuZ3VhZ2UsXHJcbiAgICAgICAgICAgIHB1bmN0dWF0ZTogb3B0aW9ucy5wdW5jdHVhdGUsXHJcbiAgICAgICAgICAgIHNtYXJ0X2Zvcm1hdDogb3B0aW9ucy5zbWFydF9mb3JtYXQsXHJcbiAgICAgICAgICAgIGRpYXJpemU6IG9wdGlvbnMuZGlhcml6ZSxcclxuICAgICAgICAgICAgdXR0ZXJhbmNlczogb3B0aW9ucy51dHRlcmFuY2VzLFxyXG4gICAgICAgICAgICBtb2RlbDogb3B0aW9ucy5tb2RlbCxcclxuICAgICAgICAgICAgLy8gRXhwbGljaXRseSBleGNsdWRlIGFueSBidWZmZXItbGlrZSBwcm9wZXJ0aWVzXHJcbiAgICAgICAgICAgIGNvbnRlbnQ6IG9wdGlvbnMuY29udGVudCA/ICdbQnVmZmVyIGV4Y2x1ZGVkIGZyb20gbG9nc10nIDogdW5kZWZpbmVkLFxyXG4gICAgICAgICAgICBidWZmZXI6IG9wdGlvbnMuYnVmZmVyID8gJ1tCdWZmZXIgZXhjbHVkZWQgZnJvbSBsb2dzXScgOiB1bmRlZmluZWQsXHJcbiAgICAgICAgICAgIC8vIEFkZCBhbnkgb3RoZXIgc2FmZSBwcm9wZXJ0aWVzIHlvdSB3YW50IHRvIGxvZ1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpIQU5ETEVfQ09OVkVSVF9TVEFSVF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gT3B0aW9uczpgLCBzYWZlT3B0aW9uc0ZvckxvZ2dpbmcpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFRoZSBkaXJlY3RvcnkgY29udGFpbmluZyB0aGUgZmlsZVBhdGggd2lsbCBiZSBtYW5hZ2VkIGZvciBjbGVhbnVwLlxyXG4gICAgICAgIC8vIElmIGZpbGVQYXRoIGlzIGEgZGlyZWN0IHVzZXIgZmlsZSwgaXRzIGRpcmVjdG9yeSBzaG91bGQgTk9UIGJlIGRlbGV0ZWQuXHJcbiAgICAgICAgLy8gVGhlIGFkYXB0ZXIgc2hvdWxkIGluZGljYXRlIGlmIGZpbGVQYXRoIGlzIGEgdGVtcG9yYXJ5IGZpbGUgaXQgY3JlYXRlZC5cclxuICAgICAgICAvLyBMZXQncyBhc3N1bWUgb3B0aW9ucy5pc1RlbXBJbnB1dEZpbGUgaW5kaWNhdGVzIHRoaXMuXHJcbiAgICAgICAgY29uc3QgdGVtcERpckZvckNsZWFudXAgPSBvcHRpb25zLmlzVGVtcElucHV0RmlsZSA/IHBhdGguZGlybmFtZShmaWxlUGF0aCkgOiBudWxsO1xyXG4gICAgICAgIGlmIChvcHRpb25zLmlzVGVtcElucHV0RmlsZSkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOlRFTVBfSU5QVVRdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIElucHV0IGZpbGUgJHtmaWxlUGF0aH0gaXMgdGVtcG9yYXJ5IGFuZCBpdHMgZGlyZWN0b3J5ICR7dGVtcERpckZvckNsZWFudXB9IHdpbGwgYmUgY2xlYW5lZCB1cC5gKTtcclxuICAgICAgICB9XHJcblxyXG5cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCB3aW5kb3cgPSBldmVudD8uc2VuZGVyPy5nZXRPd25lckJyb3dzZXJXaW5kb3c/LigpIHx8IG51bGw7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBObyBsb25nZXIgY3JlYXRpbmcgYSBuZXcgdGVtcERpciBoZXJlOyB3aWxsIHVzZSB0aGUgZGlyZWN0b3J5IG9mIGZpbGVQYXRoIGlmIGl0J3MgYSB0ZW1wIGZpbGUuXHJcbiAgICAgICAgICAgIC8vIE9yLCBpZiB3ZSBuZWVkIGlzb2xhdGVkIHByb2Nlc3Npbmcgc3BhY2UsIGNyZWF0ZSBvbmUgYW5kIGNvcHkgZmlsZVBhdGggaW50byBpdC5cclxuICAgICAgICAgICAgLy8gRm9yIG5vdywgbGV0J3MgYXNzdW1lIGZpbGVQYXRoIGNhbiBiZSBwcm9jZXNzZWQgaW4gcGxhY2UsIGFuZCBpdHMgZGlyIGNsZWFuZWQgaWYgdGVtcC5cclxuXHJcbiAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucmVnaXN0ZXJDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwge1xyXG4gICAgICAgICAgICAgICAgaWQ6IGNvbnZlcnNpb25JZCxcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3N0YXJ0aW5nJyxcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAwLFxyXG4gICAgICAgICAgICAgICAgZmlsZVBhdGg6IGZpbGVQYXRoLCAvLyBQYXRoIHRvIHRoZSBhY3R1YWwgbWVkaWEgZmlsZSB0byBwcm9jZXNzXHJcbiAgICAgICAgICAgICAgICB0ZW1wRGlyOiB0ZW1wRGlyRm9yQ2xlYW51cCwgLy8gRGlyZWN0b3J5IHRvIGNsZWFuIHVwIGlmIGlucHV0IHdhcyB0ZW1wb3JhcnlcclxuICAgICAgICAgICAgICAgIHdpbmRvdyxcclxuICAgICAgICAgICAgICAgIHN0YXJ0VGltZTogRGF0ZS5ub3coKSxcclxuICAgICAgICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKSAvLyBVc2Ugb3JpZ2luYWwgbmFtZSBmcm9tIG9wdGlvbnMgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgaWYgKHdpbmRvdyAmJiB3aW5kb3cud2ViQ29udGVudHMpIHtcclxuICAgICAgICAgICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdtZWRpYTpjb252ZXJzaW9uLXN0YXJ0ZWQnLCB7IGNvbnZlcnNpb25JZCwgb3JpZ2luYWxGaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpIH0pO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBBc3luY2hyb25vdXNseSBwcm9jZXNzIHRoZSBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCBmaWxlUGF0aCwgb3B0aW9ucykuY2F0Y2goYXN5bmMgZXJyb3IgPT4geyAvLyBNYWtlIGNhdGNoIGFzeW5jIGZvciBjbGVhbnVwXHJcbiAgICAgICAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlIHx8ICdVbmtub3duIG1lZGlhIGNvbnZlcnNpb24gcHJvY2Vzc2luZyBlcnJvcic7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWVkaWFDb252ZXJ0ZXI6UFJPQ0VTU19DT05WRVJTSU9OX0VSUk9SXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBPdmVyYWxsIGNvbnZlcnNpb24gZmFpbGVkIGZvciAke29yaWdpbmFsRmlsZU5hbWVGb3JMb2d9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhlcnJvcikpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgXHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJywgXHJcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcclxuICAgICAgICAgICAgICAgICAgICBwcm9ncmVzczogMTAwIC8vIE1hcmsgYXMgY29tcGxldGUgZm9yIFVJIGhhbmRsaW5nLCBidXQgd2l0aCBlcnJvclxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAvLyBBdHRlbXB0IGNsZWFudXAgZXZlbiBvbiBlcnJvclxyXG4gICAgICAgICAgICAgICAgaWYgKHRlbXBEaXJGb3JDbGVhbnVwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpDTEVBTlVQX09OX0VSUk9SXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBDbGVhbmluZyB1cCB0ZW1wIGRpcmVjdG9yeTogJHt0ZW1wRGlyRm9yQ2xlYW51cH1gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXJGb3JDbGVhbnVwKTtcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNZWRpYUNvbnZlcnRlcjpDTEVBTlVQX09OX0VSUk9SX0ZBSUxFRF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gRmFpbGVkIHRvIGNsZWFuIHVwIHRlbXAgZGlyZWN0b3J5ICR7dGVtcERpckZvckNsZWFudXB9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhjbGVhbnVwRXJyKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnZlcnNpb25JZCwgb3JpZ2luYWxGaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IubWVzc2FnZSB8fCAnRmFpbGVkIHRvIHN0YXJ0IG1lZGlhIGNvbnZlcnNpb24nO1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWVkaWFDb252ZXJ0ZXI6SEFORExFX0NPTlZFUlRfRVJST1JdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIEVycm9yIGZvciAke29yaWdpbmFsRmlsZU5hbWVGb3JMb2d9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhlcnJvcikpO1xyXG4gICAgICAgICAgICAvLyBJZiByZWdpc3RyYXRpb24gaGFwcGVuZWQsIHVwZGF0ZSBpdCB0byBmYWlsZWQuXHJcbiAgICAgICAgICAgIGlmICh0aGlzLnJlZ2lzdHJ5LmdldENvbnZlcnNpb24oY29udmVyc2lvbklkKSkge1xyXG4gICAgICAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucGluZ0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB7IHN0YXR1czogJ2ZhaWxlZCcsIGVycm9yOiBlcnJvck1lc3NhZ2UsIHByb2dyZXNzOiAxMDB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyBBdHRlbXB0IGNsZWFudXAgaWYgdGVtcERpckZvckNsZWFudXAgd2FzIGRldGVybWluZWRcclxuICAgICAgICAgICAgaWYgKHRlbXBEaXJGb3JDbGVhbnVwKSB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXI6Q0xFQU5VUF9PTl9TVEFSVF9FUlJPUl1bY29udklkOiR7Y29udmVyc2lvbklkfV0gQ2xlYW5pbmcgdXAgdGVtcCBkaXJlY3Rvcnk6ICR7dGVtcERpckZvckNsZWFudXB9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXJGb3JDbGVhbnVwKTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWVkaWFDb252ZXJ0ZXI6Q0xFQU5VUF9PTl9TVEFSVF9FUlJPUl9GQUlMRURdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIEZhaWxlZCB0byBjbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeSAke3RlbXBEaXJGb3JDbGVhbnVwfTpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcoY2xlYW51cEVycikpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpOyAvLyBSZS10aHJvdyBmb3IgSVBDIHRvIGNhdGNoIGlmIG5lZWRlZFxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBtZXRhZGF0YSByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gTWV0YWRhdGEgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUdldE1ldGFkYXRhKGV2ZW50LCB7IGZpbGVQYXRoIH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyXSBHZXR0aW5nIG1ldGFkYXRhIGZvcjogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICAgICAgY29uc3QgZmlsZVR5cGUgPSB0aGlzLmdldEZpbGVUeXBlKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFNpbXBsZSBtZXRhZGF0YSBleHRyYWN0aW9uIHdpdGhvdXQgZmZwcm9iZVxyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IHtcclxuICAgICAgICAgICAgICAgIGZvcm1hdDogZmlsZVR5cGUudHlwZSxcclxuICAgICAgICAgICAgICAgIGR1cmF0aW9uOiBcIlVua25vd25cIiwgLy8gV2UgZG9uJ3QgaGF2ZSBmZnByb2JlIHRvIGdldCBkdXJhdGlvblxyXG4gICAgICAgICAgICAgICAgc2l6ZTogc3RhdHMuc2l6ZSxcclxuICAgICAgICAgICAgICAgIGZpbGVuYW1lOiBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKSxcclxuICAgICAgICAgICAgICAgIGlzQXVkaW86IGZpbGVUeXBlLmlzQXVkaW8sXHJcbiAgICAgICAgICAgICAgICBpc1ZpZGVvOiBmaWxlVHlwZS5pc1ZpZGVvXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gbWV0YWRhdGE7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW01lZGlhQ29udmVydGVyXSBGYWlsZWQgdG8gZ2V0IG1ldGFkYXRhOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIGNvbnZlcnNpb24gY2FuY2VsbGF0aW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDYW5jZWxsYXRpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUNhbmNlbChldmVudCwgeyBjb252ZXJzaW9uSWQgfSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnJlZ2lzdHJ5LnJlbW92ZUNvbnZlcnNpb24oY29udmVyc2lvbklkKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgbWVkaWEgY29udmVyc2lvblxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBtZWRpYSBmaWxlXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBwcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIGZpbGVQYXRoLCBvcHRpb25zKSB7XHJcbiAgICAgICAgY29uc3Qgb3JpZ2luYWxGaWxlTmFtZSA9IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOlBST0NFU1NfQ09OVkVSU0lPTl9TVEFSVF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gUHJvY2Vzc2luZyBtZWRpYSBmaWxlOiAke29yaWdpbmFsRmlsZU5hbWV9IChmcm9tIHBhdGg6ICR7ZmlsZVBhdGh9KWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGpvYkRhdGEgPSB0aGlzLnJlZ2lzdHJ5LmdldENvbnZlcnNpb24oY29udmVyc2lvbklkKTtcclxuICAgICAgICBjb25zdCB0ZW1wRGlyVG9DbGVhbnVwID0gam9iRGF0YSA/IGpvYkRhdGEudGVtcERpciA6IG51bGw7IC8vIFRoaXMgaXMgcGF0aC5kaXJuYW1lKGZpbGVQYXRoKSBpZiB0ZW1wXHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVUeXBlID0gdGhpcy5nZXRGaWxlVHlwZShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgeyBcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3ZhbGlkYXRpbmcnLCBcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiA1LFxyXG4gICAgICAgICAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLnR5cGUsXHJcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiAnVmFsaWRhdGluZyBmaWxlLi4uJ1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChmaWxlUGF0aCk7IC8vIGZpbGVQYXRoIGlzIHRoZSBhY3R1YWwgZmlsZSB0byBwcm9jZXNzXHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0ge1xyXG4gICAgICAgICAgICAgICAgZmlsZW5hbWU6IG9yaWdpbmFsRmlsZU5hbWUsIC8vIFVzZSB0aGUgb3JpZ2luYWwgZmlsZW5hbWUgZm9yIG1ldGFkYXRhXHJcbiAgICAgICAgICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUudHlwZSxcclxuICAgICAgICAgICAgICAgIHNpemU6IHN0YXRzLnNpemUsXHJcbiAgICAgICAgICAgICAgICBpc0F1ZGlvOiBmaWxlVHlwZS5pc0F1ZGlvLFxyXG4gICAgICAgICAgICAgICAgaXNWaWRlbzogZmlsZVR5cGUuaXNWaWRlb1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOlZBTElEQVRFRF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gRmlsZSB2YWxpZGF0ZWQuIE1ldGFkYXRhOmAsIHNhbml0aXplRm9yTG9nZ2luZyhtZXRhZGF0YSkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgc3RhdHVzOiAndHJhbnNjcmliaW5nJywgcHJvZ3Jlc3M6IDMwLCBtZXNzYWdlOiAnU3RhcnRpbmcgdHJhbnNjcmlwdGlvbi4uLicgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBsZXQgZGVlcGdyYW1BcGlLZXkgPSBvcHRpb25zLmRlZXBncmFtQXBpS2V5OyAvLyBBUEkga2V5IGZyb20gb3B0aW9ucyB0YWtlcyBwcmVjZWRlbmNlXHJcbiAgICAgICAgICAgIGlmICghZGVlcGdyYW1BcGlLZXkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGFwaUtleVNlcnZpY2UgPSByZXF1aXJlKCcuLi8uLi9BcGlLZXlTZXJ2aWNlJyk7XHJcbiAgICAgICAgICAgICAgICBkZWVwZ3JhbUFwaUtleSA9IGFwaUtleVNlcnZpY2UuZ2V0QXBpS2V5KCdkZWVwZ3JhbScpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGRlZXBncmFtQXBpS2V5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpBUElfS0VZX0ZPVU5EXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBEZWVwZ3JhbSBBUEkga2V5IGZvdW5kIHZpYSBBcGlLZXlTZXJ2aWNlLmApO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGBbTWVkaWFDb252ZXJ0ZXI6QVBJX0tFWV9XQVJOXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBEZWVwZ3JhbSBBUEkga2V5IG5vdCBwcm92aWRlZCBpbiBvcHRpb25zLCBhdHRlbXB0aW5nIHRvIGZpbmQgaW4gc2V0dGluZ3Mgc3RvcmUuYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVlcGdyYW1BcGlLZXkgPSBzZXR0aW5nc1N0b3JlLmdldCgnZGVlcGdyYW1BcGlLZXknKSB8fCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXR0aW5nc1N0b3JlLmdldCgndHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleScpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZGVlcGdyYW1BcGlLZXkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOkFQSV9LRVlfRk9VTkRdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIERlZXBncmFtIEFQSSBrZXkgZm91bmQgaW4gc2V0dGluZ3Mgc3RvcmUuYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdbTWVkaWFDb252ZXJ0ZXI6QVBJX0tFWV9TVE9SRV9FUlJPUl1bY29udklkOiR7Y29udmVyc2lvbklkfV0gRXJyb3IgYWNjZXNzaW5nIHNldHRpbmdzIHN0b3JlIGZvciBBUEkga2V5OicsIHNhbml0aXplRm9yTG9nZ2luZyhlcnIpKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpBUElfS0VZX1BST1ZJREVEXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBEZWVwZ3JhbSBBUEkga2V5IHByb3ZpZGVkIGluIG9wdGlvbnMuYCk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmICghZGVlcGdyYW1BcGlLZXkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNZWRpYUNvbnZlcnRlcjpOT19BUElfS0VZXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBObyBEZWVwZ3JhbSBBUEkga2V5IGZvdW5kLiBBYm9ydGluZyB0cmFuc2NyaXB0aW9uLmApO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdEZWVwZ3JhbSBBUEkga2V5IG5vdCBmb3VuZC4gUGxlYXNlIGNvbmZpZ3VyZSBpdCBpbiBTZXR0aW5ncyA+IFRyYW5zY3JpcHRpb24uJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXI6VFJBTlNDUklQVElPTl9TVEFSVF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gSW5pdGlhdGluZyB0cmFuc2NyaXB0aW9uIGZvciAke29yaWdpbmFsRmlsZU5hbWV9YCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBVc2UgVHJhbnNjcmlwdGlvblNlcnZpY2UgZm9yIHRyYW5zY3JpcHRpb24sIGZpbGVQYXRoIGlzIHRoZSBhY3R1YWwgbWVkaWEgZGF0YVxyXG4gICAgICAgICAgICBjb25zdCB0cmFuc2NyaXB0aW9uVGV4dCA9IGF3YWl0IHRoaXMudHJhbnNjcmlwdGlvblNlcnZpY2UudHJhbnNjcmliZUF1ZGlvKGZpbGVQYXRoLCBkZWVwZ3JhbUFwaUtleSwge1xyXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2U6IG9wdGlvbnMubGFuZ3VhZ2UsIC8vIFBhc3MgcmVsZXZhbnQgb3B0aW9uc1xyXG4gICAgICAgICAgICAgICAgcHVuY3R1YXRlOiBvcHRpb25zLnB1bmN0dWF0ZSxcclxuICAgICAgICAgICAgICAgIHNtYXJ0X2Zvcm1hdDogb3B0aW9ucy5zbWFydF9mb3JtYXQsXHJcbiAgICAgICAgICAgICAgICBkaWFyaXplOiBvcHRpb25zLmRpYXJpemUsXHJcbiAgICAgICAgICAgICAgICB1dHRlcmFuY2VzOiBvcHRpb25zLnV0dGVyYW5jZXMsXHJcbiAgICAgICAgICAgICAgICBkZWVwZ3JhbU9wdGlvbnM6IG9wdGlvbnMuZGVlcGdyYW1PcHRpb25zLCAvLyBQYXNzIHRocm91Z2ggYW55IHNwZWNpZmljIERHIG9wdGlvbnNcclxuICAgICAgICAgICAgICAgIG1vZGVsOiBvcHRpb25zLm1vZGVsIC8vIEFsbG93IG1vZGVsIG92ZXJyaWRlIGZyb20gb3B0aW9uc1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFRyYW5zY3JpcHRpb25TZXJ2aWNlIG5vdyB0aHJvd3Mgb24gZW1wdHkvZmFpbGVkIHJlc3VsdCwgc28gdGhpcyBjaGVjayBtaWdodCBiZSByZWR1bmRhbnQgYnV0IHNhZmUuXHJcbiAgICAgICAgICAgIGlmICghdHJhbnNjcmlwdGlvblRleHQgfHwgdHJhbnNjcmlwdGlvblRleHQudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW01lZGlhQ29udmVydGVyOkVNUFRZX1RSQU5TQ1JJUFRJT05dW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIFRyYW5zY3JpcHRpb24gY29tcGxldGVkIGJ1dCByZXR1cm5lZCBubyB0ZXh0IGNvbnRlbnQuYCk7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RyYW5zY3JpcHRpb24gcHJvZHVjZWQgbm8gdGV4dCBjb250ZW50LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXI6VFJBTlNDUklQVElPTl9TVUNDRVNTXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBUcmFuc2NyaXB0aW9uIHN1Y2Nlc3NmdWwuIFRleHQgbGVuZ3RoOiAke3RyYW5zY3JpcHRpb25UZXh0Lmxlbmd0aH1gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENvbnN0cnVjdCBhIHJlc3VsdCBvYmplY3Qgc2ltaWxhciB0byB3aGF0IERlZXBncmFtU2VydmljZSdzIGZvcm1hdFRyYW5zY3JpcHRpb25SZXN1bHQgd291bGQgcHJvZHVjZVxyXG4gICAgICAgICAgICBjb25zdCB0cmFuc2NyaXB0aW9uUmVzdWx0ID0ge1xyXG4gICAgICAgICAgICAgICAgdGV4dDogdHJhbnNjcmlwdGlvblRleHQsXHJcbiAgICAgICAgICAgICAgICAvLyBXZSBtaWdodCBub3QgaGF2ZSBkZXRhaWxlZCBkdXJhdGlvbi9tb2RlbCBmcm9tIFRyYW5zY3JpcHRpb25TZXJ2aWNlIGRpcmVjdGx5IGhlcmUsXHJcbiAgICAgICAgICAgICAgICAvLyBidXQgd2UgY2FuIHBhc3Mgd2hhdCB3ZSBrbm93IG9yIGVuaGFuY2UgVHJhbnNjcmlwdGlvblNlcnZpY2UgdG8gcmV0dXJuIG1vcmUgZGV0YWlscy5cclxuICAgICAgICAgICAgICAgIG1vZGVsOiBvcHRpb25zLm1vZGVsIHx8IHNldHRpbmdzU3RvcmUuZ2V0KCd0cmFuc2NyaXB0aW9uLm1vZGVsJywgJ25vdmEtMicpLFxyXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2U6IG9wdGlvbnMubGFuZ3VhZ2UgfHwgJ2VuJyxcclxuICAgICAgICAgICAgICAgIC8vIGR1cmF0aW9uOiBcIlVua25vd25cIiAvLyBPciBnZXQgZnJvbSBtZXRhZGF0YSBpZiBwb3NzaWJsZVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgc3RhdHVzOiAnZ2VuZXJhdGluZ19tYXJrZG93bicsIHByb2dyZXNzOiA5MCwgbWVzc2FnZTogJ0dlbmVyYXRpbmcgTWFya2Rvd24uLi4nIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBtYXJrZG93biA9IHRoaXMuZ2VuZXJhdGVNYXJrZG93bihtZXRhZGF0YSwgdHJhbnNjcmlwdGlvblJlc3VsdCwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXI6TUFSS0RPV05fR0VORVJBVEVEXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBNYXJrZG93biBnZW5lcmF0ZWQuYCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgeyBcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsIFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDEwMCxcclxuICAgICAgICAgICAgICAgIHJlc3VsdDogbWFya2Rvd24sXHJcbiAgICAgICAgICAgICAgICB0cmFuc2NyaWJlZDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG1ldGFkYXRhLmZpbGVuYW1lLFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogJ0NvbnZlcnNpb24gY29tcGxldGUhJ1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiBtYXJrZG93bjtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlIHx8ICdVbmtub3duIG1lZGlhIGNvbnZlcnNpb24gZXJyb3InO1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWVkaWFDb252ZXJ0ZXI6UFJPQ0VTU19DT05WRVJTSU9OX0ZBSUxFRF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gRXJyb3IgZm9yICR7b3JpZ2luYWxGaWxlTmFtZX06YCwgc2FuaXRpemVGb3JMb2dnaW5nKGVycm9yKSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgeyBcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ2ZhaWxlZCcsIFxyXG4gICAgICAgICAgICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAxMDAsIC8vIE1hcmsgYXMgY29tcGxldGUgZm9yIFVJIGhhbmRsaW5nXHJcbiAgICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcmlnaW5hbEZpbGVOYW1lLCAvLyBLZWVwIG9yaWdpbmFsRmlsZU5hbWUgaW4gdGhlIHN0YXR1cyB1cGRhdGVcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGBDb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvck1lc3NhZ2V9YFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFJlLXRocm93IHRoZSBlcnJvciB0byBwcmV2ZW50IGNyZWF0aW5nIGEgcGxhY2Vob2xkZXIgbm90ZVxyXG4gICAgICAgICAgICAvLyBUaGlzIHdpbGwgYmUgY2F1Z2h0IGJ5IHRoZSBoYW5kbGVDb252ZXJ0IG1ldGhvZCBhbmQgcHJvcGVybHkgaGFuZGxlZFxyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9IGZpbmFsbHkge1xyXG4gICAgICAgICAgICAvLyBDbGVhbnVwIHRoZSB0ZW1wb3JhcnkgZGlyZWN0b3J5IGlmIG9uZSB3YXMgc3BlY2lmaWVkIGZvciBjbGVhbnVwXHJcbiAgICAgICAgICAgIGlmICh0ZW1wRGlyVG9DbGVhbnVwKSB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXI6Q0xFQU5VUF9GSU5BTExZXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBDbGVhbmluZyB1cCB0ZW1wIGRpcmVjdG9yeTogJHt0ZW1wRGlyVG9DbGVhbnVwfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyVG9DbGVhbnVwKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOkNMRUFOVVBfRklOQUxMWV9TVUNDRVNTXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBUZW1wIGRpcmVjdG9yeSAke3RlbXBEaXJUb0NsZWFudXB9IHJlbW92ZWQuYCk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW01lZGlhQ29udmVydGVyOkNMRUFOVVBfRklOQUxMWV9GQUlMRURdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIEZhaWxlZCB0byBjbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeSAke3RlbXBEaXJUb0NsZWFudXB9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhjbGVhbnVwRXJyKSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOk5PX0NMRUFOVVBfTkVFREVEXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBObyB0ZW1wb3JhcnkgaW5wdXQgZGlyZWN0b3J5IHdhcyBzcGVjaWZpZWQgZm9yIGNsZWFudXAuYCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgbWFya2Rvd24gZnJvbSBtZWRpYSBtZXRhZGF0YSBhbmQgdHJhbnNjcmlwdGlvblxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gTWVkaWEgbWV0YWRhdGFcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSB0cmFuc2NyaXB0aW9uIC0gVHJhbnNjcmlwdGlvbiByZXN1bHRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIHRyYW5zY3JpcHRpb24sIG9wdGlvbnMpIHtcclxuICAgICAgICBjb25zdCBtYXJrZG93biA9IFtdO1xyXG5cclxuICAgICAgICAvLyBBZGQgdGl0bGVcclxuICAgICAgICBpZiAob3B0aW9ucy50aXRsZSkge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7b3B0aW9ucy50aXRsZX1gKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zdCBtZWRpYVR5cGUgPSBtZXRhZGF0YS5pc1ZpZGVvID8gJ1ZpZGVvJyA6ICdBdWRpbyc7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCMgJHttZWRpYVR5cGV9OiAke21ldGFkYXRhLmZpbGVuYW1lfWApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcblxyXG4gICAgICAgIC8vIEFkZCBtZXRhZGF0YVxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIE1lZGlhIEluZm9ybWF0aW9uJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnfCBQcm9wZXJ0eSB8IFZhbHVlIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IC0tLSB8IC0tLSB8Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBGaWxlbmFtZSB8ICR7bWV0YWRhdGEuZmlsZW5hbWV9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFR5cGUgfCAke21ldGFkYXRhLmlzVmlkZW8gPyAnVmlkZW8nIDogJ0F1ZGlvJ30gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRm9ybWF0IHwgJHttZXRhZGF0YS5maWxlVHlwZX0gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRmlsZSBTaXplIHwgJHt0aGlzLmZvcm1hdEZpbGVTaXplKG1ldGFkYXRhLnNpemUpfSB8YCk7XHJcblxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG5cclxuICAgICAgICAvLyBBZGQgdHJhbnNjcmlwdGlvbiBzZWN0aW9uXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgVHJhbnNjcmlwdGlvbicpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCB0cmFuc2NyaXB0aW9uIHRleHRcclxuICAgICAgICBtYXJrZG93bi5wdXNoKHRyYW5zY3JpcHRpb24udGV4dCk7XHJcblxyXG4gICAgICAgIC8vIEFkZCB0cmFuc2NyaXB0aW9uIG1ldGFkYXRhIGlmIGF2YWlsYWJsZVxyXG4gICAgICAgIGlmICh0cmFuc2NyaXB0aW9uLm1vZGVsIHx8IHRyYW5zY3JpcHRpb24uZHVyYXRpb24pIHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJyMjIyBUcmFuc2NyaXB0aW9uIERldGFpbHMnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ3wgUHJvcGVydHkgfCBWYWx1ZSB8Jyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ3wgLS0tIHwgLS0tIHwnKTtcclxuICAgICAgICAgICAgaWYgKHRyYW5zY3JpcHRpb24ubW9kZWwpIHtcclxuICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYHwgTW9kZWwgfCAke3RyYW5zY3JpcHRpb24ubW9kZWx9IHxgKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodHJhbnNjcmlwdGlvbi5kdXJhdGlvbikge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZHVyYXRpb24gPSB0eXBlb2YgdHJhbnNjcmlwdGlvbi5kdXJhdGlvbiA9PT0gJ251bWJlcidcclxuICAgICAgICAgICAgICAgICAgICA/IHRoaXMuZm9ybWF0RHVyYXRpb24odHJhbnNjcmlwdGlvbi5kdXJhdGlvbilcclxuICAgICAgICAgICAgICAgICAgICA6IHRyYW5zY3JpcHRpb24uZHVyYXRpb247XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGB8IER1cmF0aW9uIHwgJHtkdXJhdGlvbn0gfGApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh0cmFuc2NyaXB0aW9uLmxhbmd1YWdlKSB7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGB8IExhbmd1YWdlIHwgJHt0cmFuc2NyaXB0aW9uLmxhbmd1YWdlfSB8YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIEZvcm1hdCBmaWxlIHNpemUgaW4gYnl0ZXMgdG8gaHVtYW4tcmVhZGFibGUgZm9ybWF0XHJcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gYnl0ZXMgLSBGaWxlIHNpemUgaW4gYnl0ZXNcclxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IEZvcm1hdHRlZCBmaWxlIHNpemVcclxuICAgICAqL1xyXG4gICAgZm9ybWF0RmlsZVNpemUoYnl0ZXMpIHtcclxuICAgICAgICBjb25zdCB1bml0cyA9IFsnQicsICdLQicsICdNQicsICdHQiddO1xyXG4gICAgICAgIGxldCBzaXplID0gYnl0ZXM7XHJcbiAgICAgICAgbGV0IHVuaXRJbmRleCA9IDA7XHJcblxyXG4gICAgICAgIHdoaWxlIChzaXplID49IDEwMjQgJiYgdW5pdEluZGV4IDwgdW5pdHMubGVuZ3RoIC0gMSkge1xyXG4gICAgICAgICAgICBzaXplIC89IDEwMjQ7XHJcbiAgICAgICAgICAgIHVuaXRJbmRleCsrO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGAke3NpemUudG9GaXhlZCgyKX0gJHt1bml0c1t1bml0SW5kZXhdfWA7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBGb3JtYXQgZHVyYXRpb24gaW4gc2Vjb25kcyB0byBhIGh1bWFuLXJlYWRhYmxlIGZvcm1hdFxyXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHNlY29uZHMgLSBEdXJhdGlvbiBpbiBzZWNvbmRzXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGb3JtYXR0ZWQgZHVyYXRpb25cclxuICAgICAqL1xyXG4gICAgZm9ybWF0RHVyYXRpb24oc2Vjb25kcykge1xyXG4gICAgICAgIGlmICghc2Vjb25kcyB8fCB0eXBlb2Ygc2Vjb25kcyAhPT0gJ251bWJlcicpIHtcclxuICAgICAgICAgICAgcmV0dXJuICdVbmtub3duJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IG1pbnV0ZXMgPSBNYXRoLmZsb29yKHNlY29uZHMgLyA2MCk7XHJcbiAgICAgICAgY29uc3QgcmVtYWluaW5nU2Vjb25kcyA9IE1hdGguZmxvb3Ioc2Vjb25kcyAlIDYwKTtcclxuXHJcbiAgICAgICAgaWYgKG1pbnV0ZXMgPT09IDApIHtcclxuICAgICAgICAgICAgcmV0dXJuIGAke3JlbWFpbmluZ1NlY29uZHN9IHNlY2A7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gYCR7bWludXRlc306JHtyZW1haW5pbmdTZWNvbmRzLnRvU3RyaW5nKCkucGFkU3RhcnQoMiwgJzAnKX1gO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIEdldCBmaWxlIHR5cGUgaW5mb3JtYXRpb24gZnJvbSBmaWxlIHBhdGhcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gZmlsZVxyXG4gICAgICogQHJldHVybnMge09iamVjdH0gRmlsZSB0eXBlIGluZm9ybWF0aW9uXHJcbiAgICAgKi9cclxuICAgIGdldEZpbGVUeXBlKGZpbGVQYXRoKSB7XHJcbiAgICAgICAgY29uc3QgZXh0ID0gcGF0aC5leHRuYW1lKGZpbGVQYXRoKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEF1ZGlvIGV4dGVuc2lvbnNcclxuICAgICAgICBjb25zdCBhdWRpb0V4dGVuc2lvbnMgPSBbJy5tcDMnLCAnLndhdicsICcub2dnJywgJy5tNGEnLCAnLmZsYWMnLCAnLmFhYyddO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFZpZGVvIGV4dGVuc2lvbnNcclxuICAgICAgICBjb25zdCB2aWRlb0V4dGVuc2lvbnMgPSBbJy5tcDQnLCAnLm1vdicsICcuYXZpJywgJy5ta3YnLCAnLndlYm0nXTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBleHRlbnNpb246IGV4dCxcclxuICAgICAgICAgICAgdHlwZTogZXh0LnN1YnN0cmluZygxKSwgLy8gUmVtb3ZlIHRoZSBkb3RcclxuICAgICAgICAgICAgaXNBdWRpbzogYXVkaW9FeHRlbnNpb25zLmluY2x1ZGVzKGV4dCksXHJcbiAgICAgICAgICAgIGlzVmlkZW86IHZpZGVvRXh0ZW5zaW9ucy5pbmNsdWRlcyhleHQpXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSB1bmlxdWUgY29udmVyc2lvbiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBVbmlxdWUgY29udmVyc2lvbiBJRFxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZUNvbnZlcnNpb25JZCgpIHtcclxuICAgICAgICByZXR1cm4gYG1lZGlhXyR7RGF0ZS5ub3coKX1fJHt1dWlkdjQoKS5zdWJzdHJpbmcoMCwgOCl9YDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVjayBpZiB0aGlzIGNvbnZlcnRlciBzdXBwb3J0cyB0aGUgZ2l2ZW4gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBmaWxlXHJcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBzdXBwb3J0ZWRcclxuICAgICAqL1xyXG4gICAgc3VwcG9ydHNGaWxlKGZpbGVQYXRoKSB7XHJcbiAgICAgICAgY29uc3QgZXh0ID0gcGF0aC5leHRuYW1lKGZpbGVQYXRoKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgIHJldHVybiB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMuaW5jbHVkZXMoZXh0KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IENvbnZlcnRlciBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGdldEluZm8oKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgbmFtZTogJ01lZGlhIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbnM6IHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyxcclxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb252ZXJ0cyBhdWRpbyBhbmQgdmlkZW8gZmlsZXMgdG8gbWFya2Rvd24gd2l0aCB0cmFuc2NyaXB0aW9uIHVzaW5nIERlZXBncmFtJyxcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgICAgdHJhbnNjcmliZTogJ1doZXRoZXIgdG8gdHJhbnNjcmliZSBtZWRpYSAoZGVmYXVsdDogdHJ1ZSknLFxyXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2U6ICdUcmFuc2NyaXB0aW9uIGxhbmd1YWdlIChkZWZhdWx0OiBlbiknLFxyXG4gICAgICAgICAgICAgICAgdGl0bGU6ICdPcHRpb25hbCBkb2N1bWVudCB0aXRsZSdcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTWVkaWFDb252ZXJ0ZXI7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FB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