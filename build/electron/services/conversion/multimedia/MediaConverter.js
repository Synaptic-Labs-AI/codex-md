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
        async: true,
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

    // Determine title
    const title = options.title || `${metadata.isVideo ? 'Video' : 'Audio'}: ${metadata.filename}`;

    // Create standardized frontmatter using metadata utility
    const {
      createStandardFrontmatter
    } = require('../../../converters/utils/metadata');
    const frontmatter = createStandardFrontmatter({
      title: title,
      fileType: metadata.isVideo ? 'video' : 'audio'
    });
    markdown.push(frontmatter.trim());
    markdown.push('');

    // Add title as heading
    markdown.push(`# ${title}`);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwidjQiLCJ1dWlkdjQiLCJCYXNlU2VydmljZSIsImNyZWF0ZVN0b3JlIiwic2V0dGluZ3NTdG9yZSIsInNhbml0aXplRm9yTG9nZ2luZyIsIm9iaiIsInZpc2l0ZWQiLCJTZXQiLCJoYXMiLCJhZGQiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImxlbmd0aCIsIkFycmF5IiwiaXNBcnJheSIsIm1hcCIsIml0ZW0iLCJzYW5pdGl6ZWQiLCJrZXkiLCJ2YWx1ZSIsIk9iamVjdCIsImVudHJpZXMiLCJkZWxldGUiLCJNZWRpYUNvbnZlcnRlciIsImNvbnN0cnVjdG9yIiwicmVnaXN0cnkiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJ0cmFuc2NyaXB0aW9uU2VydmljZSIsInN1cHBvcnRlZEV4dGVuc2lvbnMiLCJjb25zb2xlIiwibG9nIiwiam9pbiIsInNldHVwSXBjSGFuZGxlcnMiLCJyZWdpc3RlckhhbmRsZXIiLCJoYW5kbGVDb252ZXJ0IiwiYmluZCIsImhhbmRsZUdldE1ldGFkYXRhIiwiaGFuZGxlQ2FuY2VsIiwiZXZlbnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJjb252ZXJzaW9uSWQiLCJnZW5lcmF0ZUNvbnZlcnNpb25JZCIsIm9yaWdpbmFsRmlsZU5hbWVGb3JMb2ciLCJvcmlnaW5hbEZpbGVOYW1lIiwiYmFzZW5hbWUiLCJzYWZlT3B0aW9uc0ZvckxvZ2dpbmciLCJpc1RlbXBJbnB1dEZpbGUiLCJkZWVwZ3JhbUFwaUtleSIsInVuZGVmaW5lZCIsImxhbmd1YWdlIiwicHVuY3R1YXRlIiwic21hcnRfZm9ybWF0IiwiZGlhcml6ZSIsInV0dGVyYW5jZXMiLCJtb2RlbCIsImNvbnRlbnQiLCJidWZmZXIiLCJ0ZW1wRGlyRm9yQ2xlYW51cCIsImRpcm5hbWUiLCJ3aW5kb3ciLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJyZWdpc3RlckNvbnZlcnNpb24iLCJpZCIsInN0YXR1cyIsInByb2dyZXNzIiwidGVtcERpciIsInN0YXJ0VGltZSIsIkRhdGUiLCJub3ciLCJ3ZWJDb250ZW50cyIsInNlbmQiLCJwcm9jZXNzQ29udmVyc2lvbiIsImNhdGNoIiwiZXJyb3IiLCJlcnJvck1lc3NhZ2UiLCJtZXNzYWdlIiwicGluZ0NvbnZlcnNpb24iLCJyZW1vdmUiLCJjbGVhbnVwRXJyIiwiYXN5bmMiLCJnZXRDb252ZXJzaW9uIiwiRXJyb3IiLCJmaWxlVHlwZSIsImdldEZpbGVUeXBlIiwic3RhdHMiLCJzdGF0IiwibWV0YWRhdGEiLCJmb3JtYXQiLCJ0eXBlIiwiZHVyYXRpb24iLCJzaXplIiwiZmlsZW5hbWUiLCJpc0F1ZGlvIiwiaXNWaWRlbyIsInJlbW92ZUNvbnZlcnNpb24iLCJqb2JEYXRhIiwidGVtcERpclRvQ2xlYW51cCIsImFwaUtleVNlcnZpY2UiLCJnZXRBcGlLZXkiLCJ3YXJuIiwiZ2V0IiwiZXJyIiwidHJhbnNjcmlwdGlvblRleHQiLCJ0cmFuc2NyaWJlQXVkaW8iLCJkZWVwZ3JhbU9wdGlvbnMiLCJ0cmltIiwidHJhbnNjcmlwdGlvblJlc3VsdCIsInRleHQiLCJtYXJrZG93biIsImdlbmVyYXRlTWFya2Rvd24iLCJyZXN1bHQiLCJ0cmFuc2NyaWJlZCIsInRyYW5zY3JpcHRpb24iLCJ0aXRsZSIsImNyZWF0ZVN0YW5kYXJkRnJvbnRtYXR0ZXIiLCJmcm9udG1hdHRlciIsInB1c2giLCJmb3JtYXRGaWxlU2l6ZSIsImZvcm1hdER1cmF0aW9uIiwiYnl0ZXMiLCJ1bml0cyIsInVuaXRJbmRleCIsInRvRml4ZWQiLCJzZWNvbmRzIiwibWludXRlcyIsIk1hdGgiLCJmbG9vciIsInJlbWFpbmluZ1NlY29uZHMiLCJ0b1N0cmluZyIsInBhZFN0YXJ0IiwiZXh0IiwiZXh0bmFtZSIsInRvTG93ZXJDYXNlIiwiYXVkaW9FeHRlbnNpb25zIiwidmlkZW9FeHRlbnNpb25zIiwiZXh0ZW5zaW9uIiwic3Vic3RyaW5nIiwiaW5jbHVkZXMiLCJzdXBwb3J0c0ZpbGUiLCJnZXRJbmZvIiwibmFtZSIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsInRyYW5zY3JpYmUiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vbXVsdGltZWRpYS9NZWRpYUNvbnZlcnRlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogTWVkaWFDb252ZXJ0ZXIuanNcclxuICogSGFuZGxlcyBjb252ZXJzaW9uIG9mIGF1ZGlvIGFuZCB2aWRlbyBmaWxlcyB0byBtYXJrZG93biBmb3JtYXQgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogXHJcbiAqIFRoaXMgY29udmVydGVyOlxyXG4gKiAtIFByb2Nlc3NlcyBhdWRpbyBhbmQgdmlkZW8gZmlsZXMgdXNpbmcgRGVlcGdyYW0gQVBJXHJcbiAqIC0gRXh0cmFjdHMgbWV0YWRhdGEgKGR1cmF0aW9uLCB0eXBlLCBldGMuKVxyXG4gKiAtIFRyYW5zY3JpYmVzIGNvbnRlbnQgdXNpbmcgRGVlcGdyYW1cclxuICogLSBHZW5lcmF0ZXMgc3RydWN0dXJlZCBtYXJrZG93biBvdXRwdXRcclxuICogXHJcbiAqIFJlbGF0ZWQgRmlsZXM6XHJcbiAqIC0gQmFzZVNlcnZpY2UuanM6IFBhcmVudCBjbGFzcyBwcm92aWRpbmcgSVBDIGhhbmRsaW5nXHJcbiAqIC0gRGVlcGdyYW1TZXJ2aWNlLmpzOiBVc2VkIGZvciBhdWRpby92aWRlbyB0cmFuc2NyaXB0aW9uXHJcbiAqIC0gRmlsZVN0b3JhZ2VTZXJ2aWNlLmpzOiBGb3IgdGVtcG9yYXJ5IGZpbGUgbWFuYWdlbWVudFxyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcclxuY29uc3QgeyB2NDogdXVpZHY0IH0gPSByZXF1aXJlKCd1dWlkJyk7XHJcbmNvbnN0IEJhc2VTZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vQmFzZVNlcnZpY2UnKTtcclxuY29uc3QgeyBjcmVhdGVTdG9yZSB9ID0gcmVxdWlyZSgnLi4vLi4vLi4vdXRpbHMvc3RvcmVGYWN0b3J5Jyk7XHJcblxyXG4vLyBTZXR0aW5ncyBzdG9yZSBmb3IgdHJhbnNjcmlwdGlvbiBzZXR0aW5nc1xyXG5jb25zdCBzZXR0aW5nc1N0b3JlID0gY3JlYXRlU3RvcmUoJ3NldHRpbmdzJyk7XHJcblxyXG4vLyBVdGlsaXR5IHRvIHNhbml0aXplIG9iamVjdHMgZm9yIGxvZ2dpbmcsIGVzcGVjaWFsbHkgdG8gaGFuZGxlIEJ1ZmZlcnNcclxuLy8gQ29waWVkIGZyb20gRGVlcGdyYW1TZXJ2aWNlLmpzIGZvciBjb25zaXN0ZW5jeSwgb3IgY291bGQgYmUgbW92ZWQgdG8gYSBzaGFyZWQgdXRpbFxyXG5mdW5jdGlvbiBzYW5pdGl6ZUZvckxvZ2dpbmcob2JqLCB2aXNpdGVkID0gbmV3IFNldCgpKSB7XHJcbiAgaWYgKG9iaiA9PT0gbnVsbCB8fCB0eXBlb2Ygb2JqICE9PSAnb2JqZWN0JyB8fCB2aXNpdGVkLmhhcyhvYmopKSB7XHJcbiAgICByZXR1cm4gb2JqO1xyXG4gIH1cclxuXHJcbiAgdmlzaXRlZC5hZGQob2JqKTtcclxuXHJcbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihvYmopKSB7XHJcbiAgICByZXR1cm4gYFtCdWZmZXIgbGVuZ3RoOiAke29iai5sZW5ndGh9XWA7XHJcbiAgfVxyXG5cclxuICBpZiAoQXJyYXkuaXNBcnJheShvYmopKSB7XHJcbiAgICByZXR1cm4gb2JqLm1hcChpdGVtID0+IHNhbml0aXplRm9yTG9nZ2luZyhpdGVtLCBuZXcgU2V0KHZpc2l0ZWQpKSk7XHJcbiAgfVxyXG5cclxuICBjb25zdCBzYW5pdGl6ZWQgPSB7fTtcclxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhvYmopKSB7XHJcbiAgICBzYW5pdGl6ZWRba2V5XSA9IHNhbml0aXplRm9yTG9nZ2luZyh2YWx1ZSwgbmV3IFNldCh2aXNpdGVkKSk7XHJcbiAgfVxyXG4gIFxyXG4gIHZpc2l0ZWQuZGVsZXRlKG9iaik7XHJcbiAgcmV0dXJuIHNhbml0aXplZDtcclxufVxyXG5cclxuY2xhc3MgTWVkaWFDb252ZXJ0ZXIgZXh0ZW5kcyBCYXNlU2VydmljZSB7XHJcbiAgICBjb25zdHJ1Y3RvcihyZWdpc3RyeSwgZmlsZVByb2Nlc3NvciwgZmlsZVN0b3JhZ2UpIHtcclxuICAgICAgICBzdXBlcigpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0cnkgPSByZWdpc3RyeTtcclxuICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yO1xyXG4gICAgICAgIHRoaXMuZmlsZVN0b3JhZ2UgPSBmaWxlU3RvcmFnZTtcclxuICAgICAgICAvLyBJdCdzIGJldHRlciB0byB1c2UgdGhlIFRyYW5zY3JpcHRpb25TZXJ2aWNlIHdoaWNoIGFic3RyYWN0cyBEZWVwZ3JhbVxyXG4gICAgICAgIHRoaXMudHJhbnNjcmlwdGlvblNlcnZpY2UgPSByZXF1aXJlKCcuLi8uLi9UcmFuc2NyaXB0aW9uU2VydmljZScpOyBcclxuICAgICAgICBcclxuICAgICAgICAvLyBTdXBwb3J0ZWQgZmlsZSBleHRlbnNpb25zXHJcbiAgICAgICAgdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zID0gW1xyXG4gICAgICAgICAgICAvLyBBdWRpbyBmb3JtYXRzXHJcbiAgICAgICAgICAgICcubXAzJywgJy53YXYnLCAnLm9nZycsICcubTRhJywgJy5mbGFjJywgJy5hYWMnLFxyXG4gICAgICAgICAgICAvLyBWaWRlbyBmb3JtYXRzXHJcbiAgICAgICAgICAgICcubXA0JywgJy5tb3YnLCAnLmF2aScsICcubWt2JywgJy53ZWJtJ1xyXG4gICAgICAgIF07XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc29sZS5sb2coJ1tNZWRpYUNvbnZlcnRlcl0gSW5pdGlhbGl6ZWQgd2l0aCBzdXBwb3J0IGZvcjonLCB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMuam9pbignLCAnKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTZXQgdXAgSVBDIGhhbmRsZXJzIGZvciBtZWRpYSBjb252ZXJzaW9uXHJcbiAgICAgKi9cclxuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6bWVkaWEnLCB0aGlzLmhhbmRsZUNvbnZlcnQuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6bWVkaWE6bWV0YWRhdGEnLCB0aGlzLmhhbmRsZUdldE1ldGFkYXRhLmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0Om1lZGlhOmNhbmNlbCcsIHRoaXMuaGFuZGxlQ2FuY2VsLmJpbmQodGhpcykpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIG1lZGlhIGNvbnZlcnNpb24gcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIENvbnZlcnNpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUNvbnZlcnQoZXZlbnQsIHsgZmlsZVBhdGgsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICAgICAgY29uc3QgY29udmVyc2lvbklkID0gdGhpcy5nZW5lcmF0ZUNvbnZlcnNpb25JZCgpO1xyXG4gICAgICAgIC8vIGZpbGVQYXRoIGhlcmUgaXMgdGhlIHBhdGggdG8gdGhlIHRlbXBvcmFyeSBmaWxlIGNyZWF0ZWQgYnkgdGhlIGFkYXB0ZXIsIG9yIHRoZSBvcmlnaW5hbCB1c2VyIGZpbGUgcGF0aCBpZiBub3QgZnJvbSBidWZmZXIuXHJcbiAgICAgICAgY29uc3Qgb3JpZ2luYWxGaWxlTmFtZUZvckxvZyA9IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOkhBTkRMRV9DT05WRVJUX1NUQVJUXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBTdGFydGluZyBtZWRpYSBjb252ZXJzaW9uIGZvcjogJHtvcmlnaW5hbEZpbGVOYW1lRm9yTG9nfSAoaW5wdXQgcGF0aDogJHtmaWxlUGF0aH0pYCk7XHJcbiAgICAgICAgLy8gRG9uJ3QgbG9nIHRoZSBmdWxsIG9wdGlvbnMgb2JqZWN0IGFzIGl0IG1pZ2h0IGNvbnRhaW4gbGFyZ2UgYnVmZmVyc1xyXG4gICAgICAgIC8vIENyZWF0ZSBhIGNsZWFuIG9iamVjdCB3aXRob3V0IHNwcmVhZGluZyB0byBhdm9pZCBjb3B5aW5nIGJ1ZmZlciBkYXRhXHJcbiAgICAgICAgY29uc3Qgc2FmZU9wdGlvbnNGb3JMb2dnaW5nID0ge1xyXG4gICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgICAgICAgIGlzVGVtcElucHV0RmlsZTogb3B0aW9ucy5pc1RlbXBJbnB1dEZpbGUsXHJcbiAgICAgICAgICAgIGRlZXBncmFtQXBpS2V5OiBvcHRpb25zLmRlZXBncmFtQXBpS2V5ID8gJ1tBUEkgS2V5IEhpZGRlbl0nIDogdW5kZWZpbmVkLFxyXG4gICAgICAgICAgICBsYW5ndWFnZTogb3B0aW9ucy5sYW5ndWFnZSxcclxuICAgICAgICAgICAgcHVuY3R1YXRlOiBvcHRpb25zLnB1bmN0dWF0ZSxcclxuICAgICAgICAgICAgc21hcnRfZm9ybWF0OiBvcHRpb25zLnNtYXJ0X2Zvcm1hdCxcclxuICAgICAgICAgICAgZGlhcml6ZTogb3B0aW9ucy5kaWFyaXplLFxyXG4gICAgICAgICAgICB1dHRlcmFuY2VzOiBvcHRpb25zLnV0dGVyYW5jZXMsXHJcbiAgICAgICAgICAgIG1vZGVsOiBvcHRpb25zLm1vZGVsLFxyXG4gICAgICAgICAgICAvLyBFeHBsaWNpdGx5IGV4Y2x1ZGUgYW55IGJ1ZmZlci1saWtlIHByb3BlcnRpZXNcclxuICAgICAgICAgICAgY29udGVudDogb3B0aW9ucy5jb250ZW50ID8gJ1tCdWZmZXIgZXhjbHVkZWQgZnJvbSBsb2dzXScgOiB1bmRlZmluZWQsXHJcbiAgICAgICAgICAgIGJ1ZmZlcjogb3B0aW9ucy5idWZmZXIgPyAnW0J1ZmZlciBleGNsdWRlZCBmcm9tIGxvZ3NdJyA6IHVuZGVmaW5lZCxcclxuICAgICAgICAgICAgLy8gQWRkIGFueSBvdGhlciBzYWZlIHByb3BlcnRpZXMgeW91IHdhbnQgdG8gbG9nXHJcbiAgICAgICAgfTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOkhBTkRMRV9DT05WRVJUX1NUQVJUXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBPcHRpb25zOmAsIHNhZmVPcHRpb25zRm9yTG9nZ2luZyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gVGhlIGRpcmVjdG9yeSBjb250YWluaW5nIHRoZSBmaWxlUGF0aCB3aWxsIGJlIG1hbmFnZWQgZm9yIGNsZWFudXAuXHJcbiAgICAgICAgLy8gSWYgZmlsZVBhdGggaXMgYSBkaXJlY3QgdXNlciBmaWxlLCBpdHMgZGlyZWN0b3J5IHNob3VsZCBOT1QgYmUgZGVsZXRlZC5cclxuICAgICAgICAvLyBUaGUgYWRhcHRlciBzaG91bGQgaW5kaWNhdGUgaWYgZmlsZVBhdGggaXMgYSB0ZW1wb3JhcnkgZmlsZSBpdCBjcmVhdGVkLlxyXG4gICAgICAgIC8vIExldCdzIGFzc3VtZSBvcHRpb25zLmlzVGVtcElucHV0RmlsZSBpbmRpY2F0ZXMgdGhpcy5cclxuICAgICAgICBjb25zdCB0ZW1wRGlyRm9yQ2xlYW51cCA9IG9wdGlvbnMuaXNUZW1wSW5wdXRGaWxlID8gcGF0aC5kaXJuYW1lKGZpbGVQYXRoKSA6IG51bGw7XHJcbiAgICAgICAgaWYgKG9wdGlvbnMuaXNUZW1wSW5wdXRGaWxlKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXI6VEVNUF9JTlBVVF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gSW5wdXQgZmlsZSAke2ZpbGVQYXRofSBpcyB0ZW1wb3JhcnkgYW5kIGl0cyBkaXJlY3RvcnkgJHt0ZW1wRGlyRm9yQ2xlYW51cH0gd2lsbCBiZSBjbGVhbmVkIHVwLmApO1xyXG4gICAgICAgIH1cclxuXHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHdpbmRvdyA9IGV2ZW50Py5zZW5kZXI/LmdldE93bmVyQnJvd3NlcldpbmRvdz8uKCkgfHwgbnVsbDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIE5vIGxvbmdlciBjcmVhdGluZyBhIG5ldyB0ZW1wRGlyIGhlcmU7IHdpbGwgdXNlIHRoZSBkaXJlY3Rvcnkgb2YgZmlsZVBhdGggaWYgaXQncyBhIHRlbXAgZmlsZS5cclxuICAgICAgICAgICAgLy8gT3IsIGlmIHdlIG5lZWQgaXNvbGF0ZWQgcHJvY2Vzc2luZyBzcGFjZSwgY3JlYXRlIG9uZSBhbmQgY29weSBmaWxlUGF0aCBpbnRvIGl0LlxyXG4gICAgICAgICAgICAvLyBGb3Igbm93LCBsZXQncyBhc3N1bWUgZmlsZVBhdGggY2FuIGJlIHByb2Nlc3NlZCBpbiBwbGFjZSwgYW5kIGl0cyBkaXIgY2xlYW5lZCBpZiB0ZW1wLlxyXG5cclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5yZWdpc3RlckNvbnZlcnNpb24oY29udmVyc2lvbklkLCB7XHJcbiAgICAgICAgICAgICAgICBpZDogY29udmVyc2lvbklkLFxyXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnc3RhcnRpbmcnLFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDAsXHJcbiAgICAgICAgICAgICAgICBmaWxlUGF0aDogZmlsZVBhdGgsIC8vIFBhdGggdG8gdGhlIGFjdHVhbCBtZWRpYSBmaWxlIHRvIHByb2Nlc3NcclxuICAgICAgICAgICAgICAgIHRlbXBEaXI6IHRlbXBEaXJGb3JDbGVhbnVwLCAvLyBEaXJlY3RvcnkgdG8gY2xlYW4gdXAgaWYgaW5wdXQgd2FzIHRlbXBvcmFyeVxyXG4gICAgICAgICAgICAgICAgd2luZG93LFxyXG4gICAgICAgICAgICAgICAgc3RhcnRUaW1lOiBEYXRlLm5vdygpLFxyXG4gICAgICAgICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpIC8vIFVzZSBvcmlnaW5hbCBuYW1lIGZyb20gb3B0aW9ucyBpZiBhdmFpbGFibGVcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAod2luZG93ICYmIHdpbmRvdy53ZWJDb250ZW50cykge1xyXG4gICAgICAgICAgICAgICAgd2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ21lZGlhOmNvbnZlcnNpb24tc3RhcnRlZCcsIHsgY29udmVyc2lvbklkLCBvcmlnaW5hbEZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgcGF0aC5iYXNlbmFtZShmaWxlUGF0aCkgfSk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIEFzeW5jaHJvbm91c2x5IHByb2Nlc3MgdGhlIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgdGhpcy5wcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIGZpbGVQYXRoLCBvcHRpb25zKS5jYXRjaChhc3luYyBlcnJvciA9PiB7IC8vIE1ha2UgY2F0Y2ggYXN5bmMgZm9yIGNsZWFudXBcclxuICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yLm1lc3NhZ2UgfHwgJ1Vua25vd24gbWVkaWEgY29udmVyc2lvbiBwcm9jZXNzaW5nIGVycm9yJztcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNZWRpYUNvbnZlcnRlcjpQUk9DRVNTX0NPTlZFUlNJT05fRVJST1JdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIE92ZXJhbGwgY29udmVyc2lvbiBmYWlsZWQgZm9yICR7b3JpZ2luYWxGaWxlTmFtZUZvckxvZ306YCwgc2FuaXRpemVGb3JMb2dnaW5nKGVycm9yKSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgeyBcclxuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICdmYWlsZWQnLCBcclxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb2dyZXNzOiAxMDAgLy8gTWFyayBhcyBjb21wbGV0ZSBmb3IgVUkgaGFuZGxpbmcsIGJ1dCB3aXRoIGVycm9yXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIC8vIEF0dGVtcHQgY2xlYW51cCBldmVuIG9uIGVycm9yXHJcbiAgICAgICAgICAgICAgICBpZiAodGVtcERpckZvckNsZWFudXApIHtcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOkNMRUFOVVBfT05fRVJST1JdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIENsZWFuaW5nIHVwIHRlbXAgZGlyZWN0b3J5OiAke3RlbXBEaXJGb3JDbGVhbnVwfWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpckZvckNsZWFudXApO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW01lZGlhQ29udmVydGVyOkNMRUFOVVBfT05fRVJST1JfRkFJTEVEXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3RvcnkgJHt0ZW1wRGlyRm9yQ2xlYW51cH06YCwgc2FuaXRpemVGb3JMb2dnaW5nKGNsZWFudXBFcnIpKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICAgICAgICBhc3luYzogdHJ1ZSwgXHJcbiAgICAgICAgICAgICAgICBjb252ZXJzaW9uSWQsIFxyXG4gICAgICAgICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpIFxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yLm1lc3NhZ2UgfHwgJ0ZhaWxlZCB0byBzdGFydCBtZWRpYSBjb252ZXJzaW9uJztcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW01lZGlhQ29udmVydGVyOkhBTkRMRV9DT05WRVJUX0VSUk9SXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBFcnJvciBmb3IgJHtvcmlnaW5hbEZpbGVOYW1lRm9yTG9nfTpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcoZXJyb3IpKTtcclxuICAgICAgICAgICAgLy8gSWYgcmVnaXN0cmF0aW9uIGhhcHBlbmVkLCB1cGRhdGUgaXQgdG8gZmFpbGVkLlxyXG4gICAgICAgICAgICBpZiAodGhpcy5yZWdpc3RyeS5nZXRDb252ZXJzaW9uKGNvbnZlcnNpb25JZCkpIHtcclxuICAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgeyBzdGF0dXM6ICdmYWlsZWQnLCBlcnJvcjogZXJyb3JNZXNzYWdlLCBwcm9ncmVzczogMTAwfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8gQXR0ZW1wdCBjbGVhbnVwIGlmIHRlbXBEaXJGb3JDbGVhbnVwIHdhcyBkZXRlcm1pbmVkXHJcbiAgICAgICAgICAgIGlmICh0ZW1wRGlyRm9yQ2xlYW51cCkge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOkNMRUFOVVBfT05fU1RBUlRfRVJST1JdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIENsZWFuaW5nIHVwIHRlbXAgZGlyZWN0b3J5OiAke3RlbXBEaXJGb3JDbGVhbnVwfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyRm9yQ2xlYW51cCk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW01lZGlhQ29udmVydGVyOkNMRUFOVVBfT05fU1RBUlRfRVJST1JfRkFJTEVEXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3RvcnkgJHt0ZW1wRGlyRm9yQ2xlYW51cH06YCwgc2FuaXRpemVGb3JMb2dnaW5nKGNsZWFudXBFcnIpKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTsgLy8gUmUtdGhyb3cgZm9yIElQQyB0byBjYXRjaCBpZiBuZWVkZWRcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgbWV0YWRhdGEgcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIE1ldGFkYXRhIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVHZXRNZXRhZGF0YShldmVudCwgeyBmaWxlUGF0aCB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcl0gR2V0dGluZyBtZXRhZGF0YSBmb3I6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVUeXBlID0gdGhpcy5nZXRGaWxlVHlwZShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBTaW1wbGUgbWV0YWRhdGEgZXh0cmFjdGlvbiB3aXRob3V0IGZmcHJvYmVcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSB7XHJcbiAgICAgICAgICAgICAgICBmb3JtYXQ6IGZpbGVUeXBlLnR5cGUsXHJcbiAgICAgICAgICAgICAgICBkdXJhdGlvbjogXCJVbmtub3duXCIsIC8vIFdlIGRvbid0IGhhdmUgZmZwcm9iZSB0byBnZXQgZHVyYXRpb25cclxuICAgICAgICAgICAgICAgIHNpemU6IHN0YXRzLnNpemUsXHJcbiAgICAgICAgICAgICAgICBmaWxlbmFtZTogcGF0aC5iYXNlbmFtZShmaWxlUGF0aCksXHJcbiAgICAgICAgICAgICAgICBpc0F1ZGlvOiBmaWxlVHlwZS5pc0F1ZGlvLFxyXG4gICAgICAgICAgICAgICAgaXNWaWRlbzogZmlsZVR5cGUuaXNWaWRlb1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIG1ldGFkYXRhO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNZWRpYUNvbnZlcnRlcl0gRmFpbGVkIHRvIGdldCBtZXRhZGF0YTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBjb252ZXJzaW9uIGNhbmNlbGxhdGlvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ2FuY2VsbGF0aW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDYW5jZWwoZXZlbnQsIHsgY29udmVyc2lvbklkIH0pIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5yZWdpc3RyeS5yZW1vdmVDb252ZXJzaW9uKGNvbnZlcnNpb25JZCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBQcm9jZXNzIG1lZGlhIGNvbnZlcnNpb25cclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIGlkZW50aWZpZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gbWVkaWEgZmlsZVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgcHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCBmaWxlUGF0aCwgb3B0aW9ucykge1xyXG4gICAgICAgIGNvbnN0IG9yaWdpbmFsRmlsZU5hbWUgPSBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgcGF0aC5iYXNlbmFtZShmaWxlUGF0aCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpQUk9DRVNTX0NPTlZFUlNJT05fU1RBUlRdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIFByb2Nlc3NpbmcgbWVkaWEgZmlsZTogJHtvcmlnaW5hbEZpbGVOYW1lfSAoZnJvbSBwYXRoOiAke2ZpbGVQYXRofSlgKTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBqb2JEYXRhID0gdGhpcy5yZWdpc3RyeS5nZXRDb252ZXJzaW9uKGNvbnZlcnNpb25JZCk7XHJcbiAgICAgICAgY29uc3QgdGVtcERpclRvQ2xlYW51cCA9IGpvYkRhdGEgPyBqb2JEYXRhLnRlbXBEaXIgOiBudWxsOyAvLyBUaGlzIGlzIHBhdGguZGlybmFtZShmaWxlUGF0aCkgaWYgdGVtcFxyXG5cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBmaWxlVHlwZSA9IHRoaXMuZ2V0RmlsZVR5cGUoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgXHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICd2YWxpZGF0aW5nJywgXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogNSxcclxuICAgICAgICAgICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZS50eXBlLFxyXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogJ1ZhbGlkYXRpbmcgZmlsZS4uLidcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQoZmlsZVBhdGgpOyAvLyBmaWxlUGF0aCBpcyB0aGUgYWN0dWFsIGZpbGUgdG8gcHJvY2Vzc1xyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IHtcclxuICAgICAgICAgICAgICAgIGZpbGVuYW1lOiBvcmlnaW5hbEZpbGVOYW1lLCAvLyBVc2UgdGhlIG9yaWdpbmFsIGZpbGVuYW1lIGZvciBtZXRhZGF0YVxyXG4gICAgICAgICAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLnR5cGUsXHJcbiAgICAgICAgICAgICAgICBzaXplOiBzdGF0cy5zaXplLFxyXG4gICAgICAgICAgICAgICAgaXNBdWRpbzogZmlsZVR5cGUuaXNBdWRpbyxcclxuICAgICAgICAgICAgICAgIGlzVmlkZW86IGZpbGVUeXBlLmlzVmlkZW9cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpWQUxJREFURURdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIEZpbGUgdmFsaWRhdGVkLiBNZXRhZGF0YTpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcobWV0YWRhdGEpKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucGluZ0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB7IHN0YXR1czogJ3RyYW5zY3JpYmluZycsIHByb2dyZXNzOiAzMCwgbWVzc2FnZTogJ1N0YXJ0aW5nIHRyYW5zY3JpcHRpb24uLi4nIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgbGV0IGRlZXBncmFtQXBpS2V5ID0gb3B0aW9ucy5kZWVwZ3JhbUFwaUtleTsgLy8gQVBJIGtleSBmcm9tIG9wdGlvbnMgdGFrZXMgcHJlY2VkZW5jZVxyXG4gICAgICAgICAgICBpZiAoIWRlZXBncmFtQXBpS2V5KSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBhcGlLZXlTZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vQXBpS2V5U2VydmljZScpO1xyXG4gICAgICAgICAgICAgICAgZGVlcGdyYW1BcGlLZXkgPSBhcGlLZXlTZXJ2aWNlLmdldEFwaUtleSgnZGVlcGdyYW0nKTtcclxuICAgICAgICAgICAgICAgIGlmIChkZWVwZ3JhbUFwaUtleSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXI6QVBJX0tFWV9GT1VORF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gRGVlcGdyYW0gQVBJIGtleSBmb3VuZCB2aWEgQXBpS2V5U2VydmljZS5gKTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgW01lZGlhQ29udmVydGVyOkFQSV9LRVlfV0FSTl1bY29udklkOiR7Y29udmVyc2lvbklkfV0gRGVlcGdyYW0gQVBJIGtleSBub3QgcHJvdmlkZWQgaW4gb3B0aW9ucywgYXR0ZW1wdGluZyB0byBmaW5kIGluIHNldHRpbmdzIHN0b3JlLmApO1xyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlZXBncmFtQXBpS2V5ID0gc2V0dGluZ3NTdG9yZS5nZXQoJ2RlZXBncmFtQXBpS2V5JykgfHwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0dGluZ3NTdG9yZS5nZXQoJ3RyYW5zY3JpcHRpb24uZGVlcGdyYW1BcGlLZXknKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGRlZXBncmFtQXBpS2V5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpBUElfS0VZX0ZPVU5EXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBEZWVwZ3JhbSBBUEkga2V5IGZvdW5kIGluIHNldHRpbmdzIHN0b3JlLmApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignW01lZGlhQ29udmVydGVyOkFQSV9LRVlfU1RPUkVfRVJST1JdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIEVycm9yIGFjY2Vzc2luZyBzZXR0aW5ncyBzdG9yZSBmb3IgQVBJIGtleTonLCBzYW5pdGl6ZUZvckxvZ2dpbmcoZXJyKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXI6QVBJX0tFWV9QUk9WSURFRF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gRGVlcGdyYW0gQVBJIGtleSBwcm92aWRlZCBpbiBvcHRpb25zLmApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoIWRlZXBncmFtQXBpS2V5KSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWVkaWFDb252ZXJ0ZXI6Tk9fQVBJX0tFWV1bY29udklkOiR7Y29udmVyc2lvbklkfV0gTm8gRGVlcGdyYW0gQVBJIGtleSBmb3VuZC4gQWJvcnRpbmcgdHJhbnNjcmlwdGlvbi5gKTtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRGVlcGdyYW0gQVBJIGtleSBub3QgZm91bmQuIFBsZWFzZSBjb25maWd1cmUgaXQgaW4gU2V0dGluZ3MgPiBUcmFuc2NyaXB0aW9uLicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOlRSQU5TQ1JJUFRJT05fU1RBUlRdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIEluaXRpYXRpbmcgdHJhbnNjcmlwdGlvbiBmb3IgJHtvcmlnaW5hbEZpbGVOYW1lfWApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gVXNlIFRyYW5zY3JpcHRpb25TZXJ2aWNlIGZvciB0cmFuc2NyaXB0aW9uLCBmaWxlUGF0aCBpcyB0aGUgYWN0dWFsIG1lZGlhIGRhdGFcclxuICAgICAgICAgICAgY29uc3QgdHJhbnNjcmlwdGlvblRleHQgPSBhd2FpdCB0aGlzLnRyYW5zY3JpcHRpb25TZXJ2aWNlLnRyYW5zY3JpYmVBdWRpbyhmaWxlUGF0aCwgZGVlcGdyYW1BcGlLZXksIHtcclxuICAgICAgICAgICAgICAgIGxhbmd1YWdlOiBvcHRpb25zLmxhbmd1YWdlLCAvLyBQYXNzIHJlbGV2YW50IG9wdGlvbnNcclxuICAgICAgICAgICAgICAgIHB1bmN0dWF0ZTogb3B0aW9ucy5wdW5jdHVhdGUsXHJcbiAgICAgICAgICAgICAgICBzbWFydF9mb3JtYXQ6IG9wdGlvbnMuc21hcnRfZm9ybWF0LFxyXG4gICAgICAgICAgICAgICAgZGlhcml6ZTogb3B0aW9ucy5kaWFyaXplLFxyXG4gICAgICAgICAgICAgICAgdXR0ZXJhbmNlczogb3B0aW9ucy51dHRlcmFuY2VzLFxyXG4gICAgICAgICAgICAgICAgZGVlcGdyYW1PcHRpb25zOiBvcHRpb25zLmRlZXBncmFtT3B0aW9ucywgLy8gUGFzcyB0aHJvdWdoIGFueSBzcGVjaWZpYyBERyBvcHRpb25zXHJcbiAgICAgICAgICAgICAgICBtb2RlbDogb3B0aW9ucy5tb2RlbCAvLyBBbGxvdyBtb2RlbCBvdmVycmlkZSBmcm9tIG9wdGlvbnNcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBUcmFuc2NyaXB0aW9uU2VydmljZSBub3cgdGhyb3dzIG9uIGVtcHR5L2ZhaWxlZCByZXN1bHQsIHNvIHRoaXMgY2hlY2sgbWlnaHQgYmUgcmVkdW5kYW50IGJ1dCBzYWZlLlxyXG4gICAgICAgICAgICBpZiAoIXRyYW5zY3JpcHRpb25UZXh0IHx8IHRyYW5zY3JpcHRpb25UZXh0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNZWRpYUNvbnZlcnRlcjpFTVBUWV9UUkFOU0NSSVBUSU9OXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBUcmFuc2NyaXB0aW9uIGNvbXBsZXRlZCBidXQgcmV0dXJuZWQgbm8gdGV4dCBjb250ZW50LmApO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUcmFuc2NyaXB0aW9uIHByb2R1Y2VkIG5vIHRleHQgY29udGVudC4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOlRSQU5TQ1JJUFRJT05fU1VDQ0VTU11bY29udklkOiR7Y29udmVyc2lvbklkfV0gVHJhbnNjcmlwdGlvbiBzdWNjZXNzZnVsLiBUZXh0IGxlbmd0aDogJHt0cmFuc2NyaXB0aW9uVGV4dC5sZW5ndGh9YCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDb25zdHJ1Y3QgYSByZXN1bHQgb2JqZWN0IHNpbWlsYXIgdG8gd2hhdCBEZWVwZ3JhbVNlcnZpY2UncyBmb3JtYXRUcmFuc2NyaXB0aW9uUmVzdWx0IHdvdWxkIHByb2R1Y2VcclxuICAgICAgICAgICAgY29uc3QgdHJhbnNjcmlwdGlvblJlc3VsdCA9IHtcclxuICAgICAgICAgICAgICAgIHRleHQ6IHRyYW5zY3JpcHRpb25UZXh0LFxyXG4gICAgICAgICAgICAgICAgLy8gV2UgbWlnaHQgbm90IGhhdmUgZGV0YWlsZWQgZHVyYXRpb24vbW9kZWwgZnJvbSBUcmFuc2NyaXB0aW9uU2VydmljZSBkaXJlY3RseSBoZXJlLFxyXG4gICAgICAgICAgICAgICAgLy8gYnV0IHdlIGNhbiBwYXNzIHdoYXQgd2Uga25vdyBvciBlbmhhbmNlIFRyYW5zY3JpcHRpb25TZXJ2aWNlIHRvIHJldHVybiBtb3JlIGRldGFpbHMuXHJcbiAgICAgICAgICAgICAgICBtb2RlbDogb3B0aW9ucy5tb2RlbCB8fCBzZXR0aW5nc1N0b3JlLmdldCgndHJhbnNjcmlwdGlvbi5tb2RlbCcsICdub3ZhLTInKSxcclxuICAgICAgICAgICAgICAgIGxhbmd1YWdlOiBvcHRpb25zLmxhbmd1YWdlIHx8ICdlbicsXHJcbiAgICAgICAgICAgICAgICAvLyBkdXJhdGlvbjogXCJVbmtub3duXCIgLy8gT3IgZ2V0IGZyb20gbWV0YWRhdGEgaWYgcG9zc2libGVcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucGluZ0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB7IHN0YXR1czogJ2dlbmVyYXRpbmdfbWFya2Rvd24nLCBwcm9ncmVzczogOTAsIG1lc3NhZ2U6ICdHZW5lcmF0aW5nIE1hcmtkb3duLi4uJyB9KTtcclxuICAgICAgICAgICAgY29uc3QgbWFya2Rvd24gPSB0aGlzLmdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIHRyYW5zY3JpcHRpb25SZXN1bHQsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOk1BUktET1dOX0dFTkVSQVRFRF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gTWFya2Rvd24gZ2VuZXJhdGVkLmApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgXHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLCBcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAxMDAsXHJcbiAgICAgICAgICAgICAgICByZXN1bHQ6IG1hcmtkb3duLFxyXG4gICAgICAgICAgICAgICAgdHJhbnNjcmliZWQ6IHRydWUsXHJcbiAgICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBtZXRhZGF0YS5maWxlbmFtZSxcclxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdDb252ZXJzaW9uIGNvbXBsZXRlISdcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gbWFya2Rvd247XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IubWVzc2FnZSB8fCAnVW5rbm93biBtZWRpYSBjb252ZXJzaW9uIGVycm9yJztcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW01lZGlhQ29udmVydGVyOlBST0NFU1NfQ09OVkVSU0lPTl9GQUlMRURdW2NvbnZJZDoke2NvbnZlcnNpb25JZH1dIEVycm9yIGZvciAke29yaWdpbmFsRmlsZU5hbWV9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhlcnJvcikpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgXHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdmYWlsZWQnLCBcclxuICAgICAgICAgICAgICAgIGVycm9yOiBlcnJvck1lc3NhZ2UsXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMTAwLCAvLyBNYXJrIGFzIGNvbXBsZXRlIGZvciBVSSBoYW5kbGluZ1xyXG4gICAgICAgICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogb3JpZ2luYWxGaWxlTmFtZSwgLy8gS2VlcCBvcmlnaW5hbEZpbGVOYW1lIGluIHRoZSBzdGF0dXMgdXBkYXRlXHJcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBgQ29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3JNZXNzYWdlfWBcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBSZS10aHJvdyB0aGUgZXJyb3IgdG8gcHJldmVudCBjcmVhdGluZyBhIHBsYWNlaG9sZGVyIG5vdGVcclxuICAgICAgICAgICAgLy8gVGhpcyB3aWxsIGJlIGNhdWdodCBieSB0aGUgaGFuZGxlQ29udmVydCBtZXRob2QgYW5kIHByb3Blcmx5IGhhbmRsZWRcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgICAgLy8gQ2xlYW51cCB0aGUgdGVtcG9yYXJ5IGRpcmVjdG9yeSBpZiBvbmUgd2FzIHNwZWNpZmllZCBmb3IgY2xlYW51cFxyXG4gICAgICAgICAgICBpZiAodGVtcERpclRvQ2xlYW51cCkge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyOkNMRUFOVVBfRklOQUxMWV1bY29udklkOiR7Y29udmVyc2lvbklkfV0gQ2xlYW5pbmcgdXAgdGVtcCBkaXJlY3Rvcnk6ICR7dGVtcERpclRvQ2xlYW51cH1gKTtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpclRvQ2xlYW51cCk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpDTEVBTlVQX0ZJTkFMTFlfU1VDQ0VTU11bY29udklkOiR7Y29udmVyc2lvbklkfV0gVGVtcCBkaXJlY3RvcnkgJHt0ZW1wRGlyVG9DbGVhbnVwfSByZW1vdmVkLmApO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoY2xlYW51cEVycikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNZWRpYUNvbnZlcnRlcjpDTEVBTlVQX0ZJTkFMTFlfRkFJTEVEXVtjb252SWQ6JHtjb252ZXJzaW9uSWR9XSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3RvcnkgJHt0ZW1wRGlyVG9DbGVhbnVwfTpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcoY2xlYW51cEVycikpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcjpOT19DTEVBTlVQX05FRURFRF1bY29udklkOiR7Y29udmVyc2lvbklkfV0gTm8gdGVtcG9yYXJ5IGlucHV0IGRpcmVjdG9yeSB3YXMgc3BlY2lmaWVkIGZvciBjbGVhbnVwLmApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIG1hcmtkb3duIGZyb20gbWVkaWEgbWV0YWRhdGEgYW5kIHRyYW5zY3JpcHRpb25cclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBtZXRhZGF0YSAtIE1lZGlhIG1ldGFkYXRhXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gdHJhbnNjcmlwdGlvbiAtIFRyYW5zY3JpcHRpb24gcmVzdWx0XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gTWFya2Rvd24gY29udGVudFxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCB0cmFuc2NyaXB0aW9uLCBvcHRpb25zKSB7XHJcbiAgICAgICAgY29uc3QgbWFya2Rvd24gPSBbXTtcclxuXHJcbiAgICAgICAgLy8gRGV0ZXJtaW5lIHRpdGxlXHJcbiAgICAgICAgY29uc3QgdGl0bGUgPSBvcHRpb25zLnRpdGxlIHx8IGAke21ldGFkYXRhLmlzVmlkZW8gPyAnVmlkZW8nIDogJ0F1ZGlvJ306ICR7bWV0YWRhdGEuZmlsZW5hbWV9YDtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGZyb250bWF0dGVyIHVzaW5nIG1ldGFkYXRhIHV0aWxpdHlcclxuICAgICAgICBjb25zdCB7IGNyZWF0ZVN0YW5kYXJkRnJvbnRtYXR0ZXIgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL2NvbnZlcnRlcnMvdXRpbHMvbWV0YWRhdGEnKTtcclxuICAgICAgICBjb25zdCBmcm9udG1hdHRlciA9IGNyZWF0ZVN0YW5kYXJkRnJvbnRtYXR0ZXIoe1xyXG4gICAgICAgICAgICB0aXRsZTogdGl0bGUsXHJcbiAgICAgICAgICAgIGZpbGVUeXBlOiBtZXRhZGF0YS5pc1ZpZGVvID8gJ3ZpZGVvJyA6ICdhdWRpbydcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGZyb250bWF0dGVyLnRyaW0oKSk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcblxyXG4gICAgICAgIC8vIEFkZCB0aXRsZSBhcyBoZWFkaW5nXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgIyAke3RpdGxlfWApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG5cclxuICAgICAgICAvLyBBZGQgbWV0YWRhdGFcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBNZWRpYSBJbmZvcm1hdGlvbicpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJ3wgUHJvcGVydHkgfCBWYWx1ZSB8Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnfCAtLS0gfCAtLS0gfCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRmlsZW5hbWUgfCAke21ldGFkYXRhLmZpbGVuYW1lfSB8YCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBUeXBlIHwgJHttZXRhZGF0YS5pc1ZpZGVvID8gJ1ZpZGVvJyA6ICdBdWRpbyd9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IEZvcm1hdCB8ICR7bWV0YWRhdGEuZmlsZVR5cGV9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IEZpbGUgU2l6ZSB8ICR7dGhpcy5mb3JtYXRGaWxlU2l6ZShtZXRhZGF0YS5zaXplKX0gfGApO1xyXG5cclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuXHJcbiAgICAgICAgLy8gQWRkIHRyYW5zY3JpcHRpb24gc2VjdGlvblxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIFRyYW5zY3JpcHRpb24nKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdHJhbnNjcmlwdGlvbiB0ZXh0XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCh0cmFuc2NyaXB0aW9uLnRleHQpO1xyXG5cclxuICAgICAgICAvLyBBZGQgdHJhbnNjcmlwdGlvbiBtZXRhZGF0YSBpZiBhdmFpbGFibGVcclxuICAgICAgICBpZiAodHJhbnNjcmlwdGlvbi5tb2RlbCB8fCB0cmFuc2NyaXB0aW9uLmR1cmF0aW9uKSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyMgVHJhbnNjcmlwdGlvbiBEZXRhaWxzJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCd8IFByb3BlcnR5IHwgVmFsdWUgfCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCd8IC0tLSB8IC0tLSB8Jyk7XHJcbiAgICAgICAgICAgIGlmICh0cmFuc2NyaXB0aW9uLm1vZGVsKSB7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGB8IE1vZGVsIHwgJHt0cmFuc2NyaXB0aW9uLm1vZGVsfSB8YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRyYW5zY3JpcHRpb24uZHVyYXRpb24pIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGR1cmF0aW9uID0gdHlwZW9mIHRyYW5zY3JpcHRpb24uZHVyYXRpb24gPT09ICdudW1iZXInXHJcbiAgICAgICAgICAgICAgICAgICAgPyB0aGlzLmZvcm1hdER1cmF0aW9uKHRyYW5zY3JpcHRpb24uZHVyYXRpb24pXHJcbiAgICAgICAgICAgICAgICAgICAgOiB0cmFuc2NyaXB0aW9uLmR1cmF0aW9uO1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBEdXJhdGlvbiB8ICR7ZHVyYXRpb259IHxgKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodHJhbnNjcmlwdGlvbi5sYW5ndWFnZSkge1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBMYW5ndWFnZSB8ICR7dHJhbnNjcmlwdGlvbi5sYW5ndWFnZX0gfGApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBtYXJrZG93bi5qb2luKCdcXG4nKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBGb3JtYXQgZmlsZSBzaXplIGluIGJ5dGVzIHRvIGh1bWFuLXJlYWRhYmxlIGZvcm1hdFxyXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IGJ5dGVzIC0gRmlsZSBzaXplIGluIGJ5dGVzXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGb3JtYXR0ZWQgZmlsZSBzaXplXHJcbiAgICAgKi9cclxuICAgIGZvcm1hdEZpbGVTaXplKGJ5dGVzKSB7XHJcbiAgICAgICAgY29uc3QgdW5pdHMgPSBbJ0InLCAnS0InLCAnTUInLCAnR0InXTtcclxuICAgICAgICBsZXQgc2l6ZSA9IGJ5dGVzO1xyXG4gICAgICAgIGxldCB1bml0SW5kZXggPSAwO1xyXG5cclxuICAgICAgICB3aGlsZSAoc2l6ZSA+PSAxMDI0ICYmIHVuaXRJbmRleCA8IHVuaXRzLmxlbmd0aCAtIDEpIHtcclxuICAgICAgICAgICAgc2l6ZSAvPSAxMDI0O1xyXG4gICAgICAgICAgICB1bml0SW5kZXgrKztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBgJHtzaXplLnRvRml4ZWQoMil9ICR7dW5pdHNbdW5pdEluZGV4XX1gO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRm9ybWF0IGR1cmF0aW9uIGluIHNlY29uZHMgdG8gYSBodW1hbi1yZWFkYWJsZSBmb3JtYXRcclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBzZWNvbmRzIC0gRHVyYXRpb24gaW4gc2Vjb25kc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gRm9ybWF0dGVkIGR1cmF0aW9uXHJcbiAgICAgKi9cclxuICAgIGZvcm1hdER1cmF0aW9uKHNlY29uZHMpIHtcclxuICAgICAgICBpZiAoIXNlY29uZHMgfHwgdHlwZW9mIHNlY29uZHMgIT09ICdudW1iZXInKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAnVW5rbm93bic7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBtaW51dGVzID0gTWF0aC5mbG9vcihzZWNvbmRzIC8gNjApO1xyXG4gICAgICAgIGNvbnN0IHJlbWFpbmluZ1NlY29uZHMgPSBNYXRoLmZsb29yKHNlY29uZHMgJSA2MCk7XHJcblxyXG4gICAgICAgIGlmIChtaW51dGVzID09PSAwKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBgJHtyZW1haW5pbmdTZWNvbmRzfSBzZWNgO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGAke21pbnV0ZXN9OiR7cmVtYWluaW5nU2Vjb25kcy50b1N0cmluZygpLnBhZFN0YXJ0KDIsICcwJyl9YDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgZmlsZSB0eXBlIGluZm9ybWF0aW9uIGZyb20gZmlsZSBwYXRoXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIGZpbGVcclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IEZpbGUgdHlwZSBpbmZvcm1hdGlvblxyXG4gICAgICovXHJcbiAgICBnZXRGaWxlVHlwZShmaWxlUGF0aCkge1xyXG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBdWRpbyBleHRlbnNpb25zXHJcbiAgICAgICAgY29uc3QgYXVkaW9FeHRlbnNpb25zID0gWycubXAzJywgJy53YXYnLCAnLm9nZycsICcubTRhJywgJy5mbGFjJywgJy5hYWMnXTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBWaWRlbyBleHRlbnNpb25zXHJcbiAgICAgICAgY29uc3QgdmlkZW9FeHRlbnNpb25zID0gWycubXA0JywgJy5tb3YnLCAnLmF2aScsICcubWt2JywgJy53ZWJtJ107XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBleHQsXHJcbiAgICAgICAgICAgIHR5cGU6IGV4dC5zdWJzdHJpbmcoMSksIC8vIFJlbW92ZSB0aGUgZG90XHJcbiAgICAgICAgICAgIGlzQXVkaW86IGF1ZGlvRXh0ZW5zaW9ucy5pbmNsdWRlcyhleHQpLFxyXG4gICAgICAgICAgICBpc1ZpZGVvOiB2aWRlb0V4dGVuc2lvbnMuaW5jbHVkZXMoZXh0KVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgdW5pcXVlIGNvbnZlcnNpb24gaWRlbnRpZmllclxyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gVW5pcXVlIGNvbnZlcnNpb24gSURcclxuICAgICAqL1xyXG4gICAgZ2VuZXJhdGVDb252ZXJzaW9uSWQoKSB7XHJcbiAgICAgICAgcmV0dXJuIGBtZWRpYV8ke0RhdGUubm93KCl9XyR7dXVpZHY0KCkuc3Vic3RyaW5nKDAsIDgpfWA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgdGhpcyBjb252ZXJ0ZXIgc3VwcG9ydHMgdGhlIGdpdmVuIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gZmlsZVxyXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXHJcbiAgICAgKi9cclxuICAgIHN1cHBvcnRzRmlsZShmaWxlUGF0aCkge1xyXG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICByZXR1cm4gdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLmluY2x1ZGVzKGV4dCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgY29udmVydGVyIGluZm9ybWF0aW9uXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBnZXRJbmZvKCkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIG5hbWU6ICdNZWRpYSBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICBleHRlbnNpb25zOiB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMsXHJcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ29udmVydHMgYXVkaW8gYW5kIHZpZGVvIGZpbGVzIHRvIG1hcmtkb3duIHdpdGggdHJhbnNjcmlwdGlvbiB1c2luZyBEZWVwZ3JhbScsXHJcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICAgIHRyYW5zY3JpYmU6ICdXaGV0aGVyIHRvIHRyYW5zY3JpYmUgbWVkaWEgKGRlZmF1bHQ6IHRydWUpJyxcclxuICAgICAgICAgICAgICAgIGxhbmd1YWdlOiAnVHJhbnNjcmlwdGlvbiBsYW5ndWFnZSAoZGVmYXVsdDogZW4pJyxcclxuICAgICAgICAgICAgICAgIHRpdGxlOiAnT3B0aW9uYWwgZG9jdW1lbnQgdGl0bGUnXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IE1lZGlhQ29udmVydGVyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDOUIsTUFBTTtFQUFFRSxFQUFFLEVBQUVDO0FBQU8sQ0FBQyxHQUFHSCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQ3RDLE1BQU1JLFdBQVcsR0FBR0osT0FBTyxDQUFDLG1CQUFtQixDQUFDO0FBQ2hELE1BQU07RUFBRUs7QUFBWSxDQUFDLEdBQUdMLE9BQU8sQ0FBQyw2QkFBNkIsQ0FBQzs7QUFFOUQ7QUFDQSxNQUFNTSxhQUFhLEdBQUdELFdBQVcsQ0FBQyxVQUFVLENBQUM7O0FBRTdDO0FBQ0E7QUFDQSxTQUFTRSxrQkFBa0JBLENBQUNDLEdBQUcsRUFBRUMsT0FBTyxHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDLEVBQUU7RUFDcEQsSUFBSUYsR0FBRyxLQUFLLElBQUksSUFBSSxPQUFPQSxHQUFHLEtBQUssUUFBUSxJQUFJQyxPQUFPLENBQUNFLEdBQUcsQ0FBQ0gsR0FBRyxDQUFDLEVBQUU7SUFDL0QsT0FBT0EsR0FBRztFQUNaO0VBRUFDLE9BQU8sQ0FBQ0csR0FBRyxDQUFDSixHQUFHLENBQUM7RUFFaEIsSUFBSUssTUFBTSxDQUFDQyxRQUFRLENBQUNOLEdBQUcsQ0FBQyxFQUFFO0lBQ3hCLE9BQU8sbUJBQW1CQSxHQUFHLENBQUNPLE1BQU0sR0FBRztFQUN6QztFQUVBLElBQUlDLEtBQUssQ0FBQ0MsT0FBTyxDQUFDVCxHQUFHLENBQUMsRUFBRTtJQUN0QixPQUFPQSxHQUFHLENBQUNVLEdBQUcsQ0FBQ0MsSUFBSSxJQUFJWixrQkFBa0IsQ0FBQ1ksSUFBSSxFQUFFLElBQUlULEdBQUcsQ0FBQ0QsT0FBTyxDQUFDLENBQUMsQ0FBQztFQUNwRTtFQUVBLE1BQU1XLFNBQVMsR0FBRyxDQUFDLENBQUM7RUFDcEIsS0FBSyxNQUFNLENBQUNDLEdBQUcsRUFBRUMsS0FBSyxDQUFDLElBQUlDLE1BQU0sQ0FBQ0MsT0FBTyxDQUFDaEIsR0FBRyxDQUFDLEVBQUU7SUFDOUNZLFNBQVMsQ0FBQ0MsR0FBRyxDQUFDLEdBQUdkLGtCQUFrQixDQUFDZSxLQUFLLEVBQUUsSUFBSVosR0FBRyxDQUFDRCxPQUFPLENBQUMsQ0FBQztFQUM5RDtFQUVBQSxPQUFPLENBQUNnQixNQUFNLENBQUNqQixHQUFHLENBQUM7RUFDbkIsT0FBT1ksU0FBUztBQUNsQjtBQUVBLE1BQU1NLGNBQWMsU0FBU3RCLFdBQVcsQ0FBQztFQUNyQ3VCLFdBQVdBLENBQUNDLFFBQVEsRUFBRUMsYUFBYSxFQUFFQyxXQUFXLEVBQUU7SUFDOUMsS0FBSyxDQUFDLENBQUM7SUFDUCxJQUFJLENBQUNGLFFBQVEsR0FBR0EsUUFBUTtJQUN4QixJQUFJLENBQUNDLGFBQWEsR0FBR0EsYUFBYTtJQUNsQyxJQUFJLENBQUNDLFdBQVcsR0FBR0EsV0FBVztJQUM5QjtJQUNBLElBQUksQ0FBQ0Msb0JBQW9CLEdBQUcvQixPQUFPLENBQUMsNEJBQTRCLENBQUM7O0lBRWpFO0lBQ0EsSUFBSSxDQUFDZ0MsbUJBQW1CLEdBQUc7SUFDdkI7SUFDQSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU07SUFDL0M7SUFDQSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUMxQztJQUVEQyxPQUFPLENBQUNDLEdBQUcsQ0FBQyxnREFBZ0QsRUFBRSxJQUFJLENBQUNGLG1CQUFtQixDQUFDRyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7RUFDdEc7O0VBRUE7QUFDSjtBQUNBO0VBQ0lDLGdCQUFnQkEsQ0FBQSxFQUFHO0lBQ2YsSUFBSSxDQUFDQyxlQUFlLENBQUMsZUFBZSxFQUFFLElBQUksQ0FBQ0MsYUFBYSxDQUFDQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDcEUsSUFBSSxDQUFDRixlQUFlLENBQUMsd0JBQXdCLEVBQUUsSUFBSSxDQUFDRyxpQkFBaUIsQ0FBQ0QsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2pGLElBQUksQ0FBQ0YsZUFBZSxDQUFDLHNCQUFzQixFQUFFLElBQUksQ0FBQ0ksWUFBWSxDQUFDRixJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7RUFDOUU7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJLE1BQU1ELGFBQWFBLENBQUNJLEtBQUssRUFBRTtJQUFFQyxRQUFRO0lBQUVDLE9BQU8sR0FBRyxDQUFDO0VBQUUsQ0FBQyxFQUFFO0lBQ25ELE1BQU1DLFlBQVksR0FBRyxJQUFJLENBQUNDLG9CQUFvQixDQUFDLENBQUM7SUFDaEQ7SUFDQSxNQUFNQyxzQkFBc0IsR0FBR0gsT0FBTyxDQUFDSSxnQkFBZ0IsSUFBSWpELElBQUksQ0FBQ2tELFFBQVEsQ0FBQ04sUUFBUSxDQUFDO0lBQ2xGVixPQUFPLENBQUNDLEdBQUcsQ0FBQyxnREFBZ0RXLFlBQVksb0NBQW9DRSxzQkFBc0IsaUJBQWlCSixRQUFRLEdBQUcsQ0FBQztJQUMvSjtJQUNBO0lBQ0EsTUFBTU8scUJBQXFCLEdBQUc7TUFDMUJGLGdCQUFnQixFQUFFSixPQUFPLENBQUNJLGdCQUFnQjtNQUMxQ0csZUFBZSxFQUFFUCxPQUFPLENBQUNPLGVBQWU7TUFDeENDLGNBQWMsRUFBRVIsT0FBTyxDQUFDUSxjQUFjLEdBQUcsa0JBQWtCLEdBQUdDLFNBQVM7TUFDdkVDLFFBQVEsRUFBRVYsT0FBTyxDQUFDVSxRQUFRO01BQzFCQyxTQUFTLEVBQUVYLE9BQU8sQ0FBQ1csU0FBUztNQUM1QkMsWUFBWSxFQUFFWixPQUFPLENBQUNZLFlBQVk7TUFDbENDLE9BQU8sRUFBRWIsT0FBTyxDQUFDYSxPQUFPO01BQ3hCQyxVQUFVLEVBQUVkLE9BQU8sQ0FBQ2MsVUFBVTtNQUM5QkMsS0FBSyxFQUFFZixPQUFPLENBQUNlLEtBQUs7TUFDcEI7TUFDQUMsT0FBTyxFQUFFaEIsT0FBTyxDQUFDZ0IsT0FBTyxHQUFHLDZCQUE2QixHQUFHUCxTQUFTO01BQ3BFUSxNQUFNLEVBQUVqQixPQUFPLENBQUNpQixNQUFNLEdBQUcsNkJBQTZCLEdBQUdSO01BQ3pEO0lBQ0osQ0FBQztJQUNEcEIsT0FBTyxDQUFDQyxHQUFHLENBQUMsZ0RBQWdEVyxZQUFZLFlBQVksRUFBRUsscUJBQXFCLENBQUM7O0lBRTVHO0lBQ0E7SUFDQTtJQUNBO0lBQ0EsTUFBTVksaUJBQWlCLEdBQUdsQixPQUFPLENBQUNPLGVBQWUsR0FBR3BELElBQUksQ0FBQ2dFLE9BQU8sQ0FBQ3BCLFFBQVEsQ0FBQyxHQUFHLElBQUk7SUFDakYsSUFBSUMsT0FBTyxDQUFDTyxlQUFlLEVBQUU7TUFDekJsQixPQUFPLENBQUNDLEdBQUcsQ0FBQyxzQ0FBc0NXLFlBQVksZ0JBQWdCRixRQUFRLG1DQUFtQ21CLGlCQUFpQixzQkFBc0IsQ0FBQztJQUNySztJQUdBLElBQUk7TUFDQSxNQUFNRSxNQUFNLEdBQUd0QixLQUFLLEVBQUV1QixNQUFNLEVBQUVDLHFCQUFxQixHQUFHLENBQUMsSUFBSSxJQUFJOztNQUUvRDtNQUNBO01BQ0E7O01BRUEsSUFBSSxDQUFDdEMsUUFBUSxDQUFDdUMsa0JBQWtCLENBQUN0QixZQUFZLEVBQUU7UUFDM0N1QixFQUFFLEVBQUV2QixZQUFZO1FBQ2hCd0IsTUFBTSxFQUFFLFVBQVU7UUFDbEJDLFFBQVEsRUFBRSxDQUFDO1FBQ1gzQixRQUFRLEVBQUVBLFFBQVE7UUFBRTtRQUNwQjRCLE9BQU8sRUFBRVQsaUJBQWlCO1FBQUU7UUFDNUJFLE1BQU07UUFDTlEsU0FBUyxFQUFFQyxJQUFJLENBQUNDLEdBQUcsQ0FBQyxDQUFDO1FBQ3JCMUIsZ0JBQWdCLEVBQUVKLE9BQU8sQ0FBQ0ksZ0JBQWdCLElBQUlqRCxJQUFJLENBQUNrRCxRQUFRLENBQUNOLFFBQVEsQ0FBQyxDQUFDO01BQzFFLENBQUMsQ0FBQztNQUVGLElBQUlxQixNQUFNLElBQUlBLE1BQU0sQ0FBQ1csV0FBVyxFQUFFO1FBQzlCWCxNQUFNLENBQUNXLFdBQVcsQ0FBQ0MsSUFBSSxDQUFDLDBCQUEwQixFQUFFO1VBQUUvQixZQUFZO1VBQUVHLGdCQUFnQixFQUFFSixPQUFPLENBQUNJLGdCQUFnQixJQUFJakQsSUFBSSxDQUFDa0QsUUFBUSxDQUFDTixRQUFRO1FBQUUsQ0FBQyxDQUFDO01BQ2hKOztNQUVBO01BQ0EsSUFBSSxDQUFDa0MsaUJBQWlCLENBQUNoQyxZQUFZLEVBQUVGLFFBQVEsRUFBRUMsT0FBTyxDQUFDLENBQUNrQyxLQUFLLENBQUMsTUFBTUMsS0FBSyxJQUFJO1FBQUU7UUFDM0UsTUFBTUMsWUFBWSxHQUFHRCxLQUFLLENBQUNFLE9BQU8sSUFBSSwyQ0FBMkM7UUFDakZoRCxPQUFPLENBQUM4QyxLQUFLLENBQUMsb0RBQW9EbEMsWUFBWSxtQ0FBbUNFLHNCQUFzQixHQUFHLEVBQUV4QyxrQkFBa0IsQ0FBQ3dFLEtBQUssQ0FBQyxDQUFDO1FBQ3RLLElBQUksQ0FBQ25ELFFBQVEsQ0FBQ3NELGNBQWMsQ0FBQ3JDLFlBQVksRUFBRTtVQUN2Q3dCLE1BQU0sRUFBRSxRQUFRO1VBQ2hCVSxLQUFLLEVBQUVDLFlBQVk7VUFDbkJWLFFBQVEsRUFBRSxHQUFHLENBQUM7UUFDbEIsQ0FBQyxDQUFDO1FBQ0Y7UUFDQSxJQUFJUixpQkFBaUIsRUFBRTtVQUNuQixJQUFJO1lBQ0E3QixPQUFPLENBQUNDLEdBQUcsQ0FBQyw0Q0FBNENXLFlBQVksaUNBQWlDaUIsaUJBQWlCLEVBQUUsQ0FBQztZQUN6SCxNQUFNN0QsRUFBRSxDQUFDa0YsTUFBTSxDQUFDckIsaUJBQWlCLENBQUM7VUFDdEMsQ0FBQyxDQUFDLE9BQU9zQixVQUFVLEVBQUU7WUFDakJuRCxPQUFPLENBQUM4QyxLQUFLLENBQUMsbURBQW1EbEMsWUFBWSx1Q0FBdUNpQixpQkFBaUIsR0FBRyxFQUFFdkQsa0JBQWtCLENBQUM2RSxVQUFVLENBQUMsQ0FBQztVQUM3SztRQUNKO01BQ0osQ0FBQyxDQUFDO01BRUYsT0FBTztRQUNIQyxLQUFLLEVBQUUsSUFBSTtRQUNYeEMsWUFBWTtRQUNaRyxnQkFBZ0IsRUFBRUosT0FBTyxDQUFDSSxnQkFBZ0IsSUFBSWpELElBQUksQ0FBQ2tELFFBQVEsQ0FBQ04sUUFBUTtNQUN4RSxDQUFDO0lBQ0wsQ0FBQyxDQUFDLE9BQU9vQyxLQUFLLEVBQUU7TUFDWixNQUFNQyxZQUFZLEdBQUdELEtBQUssQ0FBQ0UsT0FBTyxJQUFJLGtDQUFrQztNQUN4RWhELE9BQU8sQ0FBQzhDLEtBQUssQ0FBQyxnREFBZ0RsQyxZQUFZLGVBQWVFLHNCQUFzQixHQUFHLEVBQUV4QyxrQkFBa0IsQ0FBQ3dFLEtBQUssQ0FBQyxDQUFDO01BQzlJO01BQ0EsSUFBSSxJQUFJLENBQUNuRCxRQUFRLENBQUMwRCxhQUFhLENBQUN6QyxZQUFZLENBQUMsRUFBRTtRQUMxQyxJQUFJLENBQUNqQixRQUFRLENBQUNzRCxjQUFjLENBQUNyQyxZQUFZLEVBQUU7VUFBRXdCLE1BQU0sRUFBRSxRQUFRO1VBQUVVLEtBQUssRUFBRUMsWUFBWTtVQUFFVixRQUFRLEVBQUU7UUFBRyxDQUFDLENBQUM7TUFDeEc7TUFDQTtNQUNBLElBQUlSLGlCQUFpQixFQUFFO1FBQ25CLElBQUk7VUFDQTdCLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLGtEQUFrRFcsWUFBWSxpQ0FBaUNpQixpQkFBaUIsRUFBRSxDQUFDO1VBQy9ILE1BQU03RCxFQUFFLENBQUNrRixNQUFNLENBQUNyQixpQkFBaUIsQ0FBQztRQUN0QyxDQUFDLENBQUMsT0FBT3NCLFVBQVUsRUFBRTtVQUNqQm5ELE9BQU8sQ0FBQzhDLEtBQUssQ0FBQyx5REFBeURsQyxZQUFZLHVDQUF1Q2lCLGlCQUFpQixHQUFHLEVBQUV2RCxrQkFBa0IsQ0FBQzZFLFVBQVUsQ0FBQyxDQUFDO1FBQ25MO01BQ0o7TUFDQSxNQUFNLElBQUlHLEtBQUssQ0FBQ1AsWUFBWSxDQUFDLENBQUMsQ0FBQztJQUNuQztFQUNKOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7RUFDSSxNQUFNeEMsaUJBQWlCQSxDQUFDRSxLQUFLLEVBQUU7SUFBRUM7RUFBUyxDQUFDLEVBQUU7SUFDekMsSUFBSTtNQUNBVixPQUFPLENBQUNDLEdBQUcsQ0FBQywwQ0FBMENTLFFBQVEsRUFBRSxDQUFDO01BQ2pFLE1BQU02QyxRQUFRLEdBQUcsSUFBSSxDQUFDQyxXQUFXLENBQUM5QyxRQUFRLENBQUM7TUFDM0MsTUFBTStDLEtBQUssR0FBRyxNQUFNekYsRUFBRSxDQUFDMEYsSUFBSSxDQUFDaEQsUUFBUSxDQUFDOztNQUVyQztNQUNBLE1BQU1pRCxRQUFRLEdBQUc7UUFDYkMsTUFBTSxFQUFFTCxRQUFRLENBQUNNLElBQUk7UUFDckJDLFFBQVEsRUFBRSxTQUFTO1FBQUU7UUFDckJDLElBQUksRUFBRU4sS0FBSyxDQUFDTSxJQUFJO1FBQ2hCQyxRQUFRLEVBQUVsRyxJQUFJLENBQUNrRCxRQUFRLENBQUNOLFFBQVEsQ0FBQztRQUNqQ3VELE9BQU8sRUFBRVYsUUFBUSxDQUFDVSxPQUFPO1FBQ3pCQyxPQUFPLEVBQUVYLFFBQVEsQ0FBQ1c7TUFDdEIsQ0FBQztNQUVELE9BQU9QLFFBQVE7SUFDbkIsQ0FBQyxDQUFDLE9BQU9iLEtBQUssRUFBRTtNQUNaOUMsT0FBTyxDQUFDOEMsS0FBSyxDQUFDLDBDQUEwQyxFQUFFQSxLQUFLLENBQUM7TUFDaEUsTUFBTUEsS0FBSztJQUNmO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJLE1BQU10QyxZQUFZQSxDQUFDQyxLQUFLLEVBQUU7SUFBRUc7RUFBYSxDQUFDLEVBQUU7SUFDeEMsT0FBTyxJQUFJLENBQUNqQixRQUFRLENBQUN3RSxnQkFBZ0IsQ0FBQ3ZELFlBQVksQ0FBQztFQUN2RDs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDSSxNQUFNZ0MsaUJBQWlCQSxDQUFDaEMsWUFBWSxFQUFFRixRQUFRLEVBQUVDLE9BQU8sRUFBRTtJQUNyRCxNQUFNSSxnQkFBZ0IsR0FBR0osT0FBTyxDQUFDSSxnQkFBZ0IsSUFBSWpELElBQUksQ0FBQ2tELFFBQVEsQ0FBQ04sUUFBUSxDQUFDO0lBQzVFVixPQUFPLENBQUNDLEdBQUcsQ0FBQyxvREFBb0RXLFlBQVksNEJBQTRCRyxnQkFBZ0IsZ0JBQWdCTCxRQUFRLEdBQUcsQ0FBQztJQUVwSixNQUFNMEQsT0FBTyxHQUFHLElBQUksQ0FBQ3pFLFFBQVEsQ0FBQzBELGFBQWEsQ0FBQ3pDLFlBQVksQ0FBQztJQUN6RCxNQUFNeUQsZ0JBQWdCLEdBQUdELE9BQU8sR0FBR0EsT0FBTyxDQUFDOUIsT0FBTyxHQUFHLElBQUksQ0FBQyxDQUFDOztJQUUzRCxJQUFJO01BQ0EsTUFBTWlCLFFBQVEsR0FBRyxJQUFJLENBQUNDLFdBQVcsQ0FBQzlDLFFBQVEsQ0FBQztNQUUzQyxJQUFJLENBQUNmLFFBQVEsQ0FBQ3NELGNBQWMsQ0FBQ3JDLFlBQVksRUFBRTtRQUN2Q3dCLE1BQU0sRUFBRSxZQUFZO1FBQ3BCQyxRQUFRLEVBQUUsQ0FBQztRQUNYa0IsUUFBUSxFQUFFQSxRQUFRLENBQUNNLElBQUk7UUFDdkJiLE9BQU8sRUFBRTtNQUNiLENBQUMsQ0FBQztNQUVGLE1BQU1TLEtBQUssR0FBRyxNQUFNekYsRUFBRSxDQUFDMEYsSUFBSSxDQUFDaEQsUUFBUSxDQUFDLENBQUMsQ0FBQztNQUN2QyxNQUFNaUQsUUFBUSxHQUFHO1FBQ2JLLFFBQVEsRUFBRWpELGdCQUFnQjtRQUFFO1FBQzVCd0MsUUFBUSxFQUFFQSxRQUFRLENBQUNNLElBQUk7UUFDdkJFLElBQUksRUFBRU4sS0FBSyxDQUFDTSxJQUFJO1FBQ2hCRSxPQUFPLEVBQUVWLFFBQVEsQ0FBQ1UsT0FBTztRQUN6QkMsT0FBTyxFQUFFWCxRQUFRLENBQUNXO01BQ3RCLENBQUM7TUFDRGxFLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHFDQUFxQ1csWUFBWSw2QkFBNkIsRUFBRXRDLGtCQUFrQixDQUFDcUYsUUFBUSxDQUFDLENBQUM7TUFFekgsSUFBSSxDQUFDaEUsUUFBUSxDQUFDc0QsY0FBYyxDQUFDckMsWUFBWSxFQUFFO1FBQUV3QixNQUFNLEVBQUUsY0FBYztRQUFFQyxRQUFRLEVBQUUsRUFBRTtRQUFFVyxPQUFPLEVBQUU7TUFBNEIsQ0FBQyxDQUFDO01BRTFILElBQUk3QixjQUFjLEdBQUdSLE9BQU8sQ0FBQ1EsY0FBYyxDQUFDLENBQUM7TUFDN0MsSUFBSSxDQUFDQSxjQUFjLEVBQUU7UUFDakIsTUFBTW1ELGFBQWEsR0FBR3ZHLE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQztRQUNwRG9ELGNBQWMsR0FBR21ELGFBQWEsQ0FBQ0MsU0FBUyxDQUFDLFVBQVUsQ0FBQztRQUNwRCxJQUFJcEQsY0FBYyxFQUFFO1VBQ2hCbkIsT0FBTyxDQUFDQyxHQUFHLENBQUMseUNBQXlDVyxZQUFZLDZDQUE2QyxDQUFDO1FBQ25ILENBQUMsTUFBTTtVQUNGWixPQUFPLENBQUN3RSxJQUFJLENBQUMsd0NBQXdDNUQsWUFBWSxtRkFBbUYsQ0FBQztVQUN0SixJQUFJO1lBQ0FPLGNBQWMsR0FBRzlDLGFBQWEsQ0FBQ29HLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUNuQ3BHLGFBQWEsQ0FBQ29HLEdBQUcsQ0FBQyw4QkFBOEIsQ0FBQztZQUNsRSxJQUFJdEQsY0FBYyxFQUFFO2NBQ2ZuQixPQUFPLENBQUNDLEdBQUcsQ0FBQyx5Q0FBeUNXLFlBQVksNkNBQTZDLENBQUM7WUFDcEg7VUFDSixDQUFDLENBQUMsT0FBTzhELEdBQUcsRUFBRTtZQUNWMUUsT0FBTyxDQUFDd0UsSUFBSSxDQUFDLDBHQUEwRyxFQUFFbEcsa0JBQWtCLENBQUNvRyxHQUFHLENBQUMsQ0FBQztVQUNySjtRQUNKO01BQ0osQ0FBQyxNQUFNO1FBQ0YxRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyw0Q0FBNENXLFlBQVkseUNBQXlDLENBQUM7TUFDbkg7TUFFQSxJQUFJLENBQUNPLGNBQWMsRUFBRTtRQUNqQm5CLE9BQU8sQ0FBQzhDLEtBQUssQ0FBQyxzQ0FBc0NsQyxZQUFZLHNEQUFzRCxDQUFDO1FBQ3ZILE1BQU0sSUFBSTBDLEtBQUssQ0FBQyw4RUFBOEUsQ0FBQztNQUNuRztNQUVBdEQsT0FBTyxDQUFDQyxHQUFHLENBQUMsK0NBQStDVyxZQUFZLGtDQUFrQ0csZ0JBQWdCLEVBQUUsQ0FBQzs7TUFFNUg7TUFDQSxNQUFNNEQsaUJBQWlCLEdBQUcsTUFBTSxJQUFJLENBQUM3RSxvQkFBb0IsQ0FBQzhFLGVBQWUsQ0FBQ2xFLFFBQVEsRUFBRVMsY0FBYyxFQUFFO1FBQ2hHRSxRQUFRLEVBQUVWLE9BQU8sQ0FBQ1UsUUFBUTtRQUFFO1FBQzVCQyxTQUFTLEVBQUVYLE9BQU8sQ0FBQ1csU0FBUztRQUM1QkMsWUFBWSxFQUFFWixPQUFPLENBQUNZLFlBQVk7UUFDbENDLE9BQU8sRUFBRWIsT0FBTyxDQUFDYSxPQUFPO1FBQ3hCQyxVQUFVLEVBQUVkLE9BQU8sQ0FBQ2MsVUFBVTtRQUM5Qm9ELGVBQWUsRUFBRWxFLE9BQU8sQ0FBQ2tFLGVBQWU7UUFBRTtRQUMxQ25ELEtBQUssRUFBRWYsT0FBTyxDQUFDZSxLQUFLLENBQUM7TUFDekIsQ0FBQyxDQUFDOztNQUVGO01BQ0EsSUFBSSxDQUFDaUQsaUJBQWlCLElBQUlBLGlCQUFpQixDQUFDRyxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtRQUN2RDlFLE9BQU8sQ0FBQzhDLEtBQUssQ0FBQywrQ0FBK0NsQyxZQUFZLHlEQUF5RCxDQUFDO1FBQ25JLE1BQU0sSUFBSTBDLEtBQUssQ0FBQyx5Q0FBeUMsQ0FBQztNQUM5RDtNQUNBdEQsT0FBTyxDQUFDQyxHQUFHLENBQUMsaURBQWlEVyxZQUFZLDRDQUE0QytELGlCQUFpQixDQUFDN0YsTUFBTSxFQUFFLENBQUM7O01BRWhKO01BQ0EsTUFBTWlHLG1CQUFtQixHQUFHO1FBQ3hCQyxJQUFJLEVBQUVMLGlCQUFpQjtRQUN2QjtRQUNBO1FBQ0FqRCxLQUFLLEVBQUVmLE9BQU8sQ0FBQ2UsS0FBSyxJQUFJckQsYUFBYSxDQUFDb0csR0FBRyxDQUFDLHFCQUFxQixFQUFFLFFBQVEsQ0FBQztRQUMxRXBELFFBQVEsRUFBRVYsT0FBTyxDQUFDVSxRQUFRLElBQUk7UUFDOUI7TUFDSixDQUFDO01BRUQsSUFBSSxDQUFDMUIsUUFBUSxDQUFDc0QsY0FBYyxDQUFDckMsWUFBWSxFQUFFO1FBQUV3QixNQUFNLEVBQUUscUJBQXFCO1FBQUVDLFFBQVEsRUFBRSxFQUFFO1FBQUVXLE9BQU8sRUFBRTtNQUF5QixDQUFDLENBQUM7TUFDOUgsTUFBTWlDLFFBQVEsR0FBRyxJQUFJLENBQUNDLGdCQUFnQixDQUFDdkIsUUFBUSxFQUFFb0IsbUJBQW1CLEVBQUVwRSxPQUFPLENBQUM7TUFDOUVYLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDhDQUE4Q1csWUFBWSx1QkFBdUIsQ0FBQztNQUU5RixJQUFJLENBQUNqQixRQUFRLENBQUNzRCxjQUFjLENBQUNyQyxZQUFZLEVBQUU7UUFDdkN3QixNQUFNLEVBQUUsV0FBVztRQUNuQkMsUUFBUSxFQUFFLEdBQUc7UUFDYjhDLE1BQU0sRUFBRUYsUUFBUTtRQUNoQkcsV0FBVyxFQUFFLElBQUk7UUFDakJyRSxnQkFBZ0IsRUFBRTRDLFFBQVEsQ0FBQ0ssUUFBUTtRQUNuQ2hCLE9BQU8sRUFBRTtNQUNiLENBQUMsQ0FBQztNQUVGLE9BQU9pQyxRQUFRO0lBQ25CLENBQUMsQ0FBQyxPQUFPbkMsS0FBSyxFQUFFO01BQ1osTUFBTUMsWUFBWSxHQUFHRCxLQUFLLENBQUNFLE9BQU8sSUFBSSxnQ0FBZ0M7TUFDdEVoRCxPQUFPLENBQUM4QyxLQUFLLENBQUMscURBQXFEbEMsWUFBWSxlQUFlRyxnQkFBZ0IsR0FBRyxFQUFFekMsa0JBQWtCLENBQUN3RSxLQUFLLENBQUMsQ0FBQztNQUU3SSxJQUFJLENBQUNuRCxRQUFRLENBQUNzRCxjQUFjLENBQUNyQyxZQUFZLEVBQUU7UUFDdkN3QixNQUFNLEVBQUUsUUFBUTtRQUNoQlUsS0FBSyxFQUFFQyxZQUFZO1FBQ25CVixRQUFRLEVBQUUsR0FBRztRQUFFO1FBQ2Z0QixnQkFBZ0IsRUFBRUEsZ0JBQWdCO1FBQUU7UUFDcENpQyxPQUFPLEVBQUUsc0JBQXNCRCxZQUFZO01BQy9DLENBQUMsQ0FBQzs7TUFFRjtNQUNBO01BQ0EsTUFBTUQsS0FBSztJQUNmLENBQUMsU0FBUztNQUNOO01BQ0EsSUFBSXVCLGdCQUFnQixFQUFFO1FBQ2xCLElBQUk7VUFDQXJFLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDJDQUEyQ1csWUFBWSxpQ0FBaUN5RCxnQkFBZ0IsRUFBRSxDQUFDO1VBQ3ZILE1BQU1yRyxFQUFFLENBQUNrRixNQUFNLENBQUNtQixnQkFBZ0IsQ0FBQztVQUNqQ3JFLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLG1EQUFtRFcsWUFBWSxvQkFBb0J5RCxnQkFBZ0IsV0FBVyxDQUFDO1FBQy9ILENBQUMsQ0FBQyxPQUFPbEIsVUFBVSxFQUFFO1VBQ2pCbkQsT0FBTyxDQUFDOEMsS0FBSyxDQUFDLGtEQUFrRGxDLFlBQVksdUNBQXVDeUQsZ0JBQWdCLEdBQUcsRUFBRS9GLGtCQUFrQixDQUFDNkUsVUFBVSxDQUFDLENBQUM7UUFDM0s7TUFDSixDQUFDLE1BQU07UUFDSG5ELE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDZDQUE2Q1csWUFBWSwyREFBMkQsQ0FBQztNQUNySTtJQUNKO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDSXNFLGdCQUFnQkEsQ0FBQ3ZCLFFBQVEsRUFBRTBCLGFBQWEsRUFBRTFFLE9BQU8sRUFBRTtJQUMvQyxNQUFNc0UsUUFBUSxHQUFHLEVBQUU7O0lBRW5CO0lBQ0EsTUFBTUssS0FBSyxHQUFHM0UsT0FBTyxDQUFDMkUsS0FBSyxJQUFJLEdBQUczQixRQUFRLENBQUNPLE9BQU8sR0FBRyxPQUFPLEdBQUcsT0FBTyxLQUFLUCxRQUFRLENBQUNLLFFBQVEsRUFBRTs7SUFFOUY7SUFDQSxNQUFNO01BQUV1QjtJQUEwQixDQUFDLEdBQUd4SCxPQUFPLENBQUMsb0NBQW9DLENBQUM7SUFDbkYsTUFBTXlILFdBQVcsR0FBR0QseUJBQXlCLENBQUM7TUFDMUNELEtBQUssRUFBRUEsS0FBSztNQUNaL0IsUUFBUSxFQUFFSSxRQUFRLENBQUNPLE9BQU8sR0FBRyxPQUFPLEdBQUc7SUFDM0MsQ0FBQyxDQUFDO0lBRUZlLFFBQVEsQ0FBQ1EsSUFBSSxDQUFDRCxXQUFXLENBQUNWLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDakNHLFFBQVEsQ0FBQ1EsSUFBSSxDQUFDLEVBQUUsQ0FBQzs7SUFFakI7SUFDQVIsUUFBUSxDQUFDUSxJQUFJLENBQUMsS0FBS0gsS0FBSyxFQUFFLENBQUM7SUFDM0JMLFFBQVEsQ0FBQ1EsSUFBSSxDQUFDLEVBQUUsQ0FBQzs7SUFFakI7SUFDQVIsUUFBUSxDQUFDUSxJQUFJLENBQUMsc0JBQXNCLENBQUM7SUFDckNSLFFBQVEsQ0FBQ1EsSUFBSSxDQUFDLEVBQUUsQ0FBQztJQUNqQlIsUUFBUSxDQUFDUSxJQUFJLENBQUMsc0JBQXNCLENBQUM7SUFDckNSLFFBQVEsQ0FBQ1EsSUFBSSxDQUFDLGVBQWUsQ0FBQztJQUM5QlIsUUFBUSxDQUFDUSxJQUFJLENBQUMsZ0JBQWdCOUIsUUFBUSxDQUFDSyxRQUFRLElBQUksQ0FBQztJQUNwRGlCLFFBQVEsQ0FBQ1EsSUFBSSxDQUFDLFlBQVk5QixRQUFRLENBQUNPLE9BQU8sR0FBRyxPQUFPLEdBQUcsT0FBTyxJQUFJLENBQUM7SUFDbkVlLFFBQVEsQ0FBQ1EsSUFBSSxDQUFDLGNBQWM5QixRQUFRLENBQUNKLFFBQVEsSUFBSSxDQUFDO0lBQ2xEMEIsUUFBUSxDQUFDUSxJQUFJLENBQUMsaUJBQWlCLElBQUksQ0FBQ0MsY0FBYyxDQUFDL0IsUUFBUSxDQUFDSSxJQUFJLENBQUMsSUFBSSxDQUFDO0lBRXRFa0IsUUFBUSxDQUFDUSxJQUFJLENBQUMsRUFBRSxDQUFDOztJQUVqQjtJQUNBUixRQUFRLENBQUNRLElBQUksQ0FBQyxrQkFBa0IsQ0FBQztJQUNqQ1IsUUFBUSxDQUFDUSxJQUFJLENBQUMsRUFBRSxDQUFDOztJQUVqQjtJQUNBUixRQUFRLENBQUNRLElBQUksQ0FBQ0osYUFBYSxDQUFDTCxJQUFJLENBQUM7O0lBRWpDO0lBQ0EsSUFBSUssYUFBYSxDQUFDM0QsS0FBSyxJQUFJMkQsYUFBYSxDQUFDdkIsUUFBUSxFQUFFO01BQy9DbUIsUUFBUSxDQUFDUSxJQUFJLENBQUMsRUFBRSxDQUFDO01BQ2pCUixRQUFRLENBQUNRLElBQUksQ0FBQywyQkFBMkIsQ0FBQztNQUMxQ1IsUUFBUSxDQUFDUSxJQUFJLENBQUMsRUFBRSxDQUFDO01BQ2pCUixRQUFRLENBQUNRLElBQUksQ0FBQyxzQkFBc0IsQ0FBQztNQUNyQ1IsUUFBUSxDQUFDUSxJQUFJLENBQUMsZUFBZSxDQUFDO01BQzlCLElBQUlKLGFBQWEsQ0FBQzNELEtBQUssRUFBRTtRQUNyQnVELFFBQVEsQ0FBQ1EsSUFBSSxDQUFDLGFBQWFKLGFBQWEsQ0FBQzNELEtBQUssSUFBSSxDQUFDO01BQ3ZEO01BQ0EsSUFBSTJELGFBQWEsQ0FBQ3ZCLFFBQVEsRUFBRTtRQUN4QixNQUFNQSxRQUFRLEdBQUcsT0FBT3VCLGFBQWEsQ0FBQ3ZCLFFBQVEsS0FBSyxRQUFRLEdBQ3JELElBQUksQ0FBQzZCLGNBQWMsQ0FBQ04sYUFBYSxDQUFDdkIsUUFBUSxDQUFDLEdBQzNDdUIsYUFBYSxDQUFDdkIsUUFBUTtRQUM1Qm1CLFFBQVEsQ0FBQ1EsSUFBSSxDQUFDLGdCQUFnQjNCLFFBQVEsSUFBSSxDQUFDO01BQy9DO01BQ0EsSUFBSXVCLGFBQWEsQ0FBQ2hFLFFBQVEsRUFBRTtRQUN4QjRELFFBQVEsQ0FBQ1EsSUFBSSxDQUFDLGdCQUFnQkosYUFBYSxDQUFDaEUsUUFBUSxJQUFJLENBQUM7TUFDN0Q7SUFDSjtJQUVBLE9BQU80RCxRQUFRLENBQUMvRSxJQUFJLENBQUMsSUFBSSxDQUFDO0VBQzlCOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7RUFDSXdGLGNBQWNBLENBQUNFLEtBQUssRUFBRTtJQUNsQixNQUFNQyxLQUFLLEdBQUcsQ0FBQyxHQUFHLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUM7SUFDckMsSUFBSTlCLElBQUksR0FBRzZCLEtBQUs7SUFDaEIsSUFBSUUsU0FBUyxHQUFHLENBQUM7SUFFakIsT0FBTy9CLElBQUksSUFBSSxJQUFJLElBQUkrQixTQUFTLEdBQUdELEtBQUssQ0FBQy9HLE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFDakRpRixJQUFJLElBQUksSUFBSTtNQUNaK0IsU0FBUyxFQUFFO0lBQ2Y7SUFFQSxPQUFPLEdBQUcvQixJQUFJLENBQUNnQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUlGLEtBQUssQ0FBQ0MsU0FBUyxDQUFDLEVBQUU7RUFDbkQ7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJSCxjQUFjQSxDQUFDSyxPQUFPLEVBQUU7SUFDcEIsSUFBSSxDQUFDQSxPQUFPLElBQUksT0FBT0EsT0FBTyxLQUFLLFFBQVEsRUFBRTtNQUN6QyxPQUFPLFNBQVM7SUFDcEI7SUFFQSxNQUFNQyxPQUFPLEdBQUdDLElBQUksQ0FBQ0MsS0FBSyxDQUFDSCxPQUFPLEdBQUcsRUFBRSxDQUFDO0lBQ3hDLE1BQU1JLGdCQUFnQixHQUFHRixJQUFJLENBQUNDLEtBQUssQ0FBQ0gsT0FBTyxHQUFHLEVBQUUsQ0FBQztJQUVqRCxJQUFJQyxPQUFPLEtBQUssQ0FBQyxFQUFFO01BQ2YsT0FBTyxHQUFHRyxnQkFBZ0IsTUFBTTtJQUNwQztJQUVBLE9BQU8sR0FBR0gsT0FBTyxJQUFJRyxnQkFBZ0IsQ0FBQ0MsUUFBUSxDQUFDLENBQUMsQ0FBQ0MsUUFBUSxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsRUFBRTtFQUN2RTs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0k5QyxXQUFXQSxDQUFDOUMsUUFBUSxFQUFFO0lBQ2xCLE1BQU02RixHQUFHLEdBQUd6SSxJQUFJLENBQUMwSSxPQUFPLENBQUM5RixRQUFRLENBQUMsQ0FBQytGLFdBQVcsQ0FBQyxDQUFDOztJQUVoRDtJQUNBLE1BQU1DLGVBQWUsR0FBRyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsTUFBTSxDQUFDOztJQUV6RTtJQUNBLE1BQU1DLGVBQWUsR0FBRyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUM7SUFFakUsT0FBTztNQUNIQyxTQUFTLEVBQUVMLEdBQUc7TUFDZDFDLElBQUksRUFBRTBDLEdBQUcsQ0FBQ00sU0FBUyxDQUFDLENBQUMsQ0FBQztNQUFFO01BQ3hCNUMsT0FBTyxFQUFFeUMsZUFBZSxDQUFDSSxRQUFRLENBQUNQLEdBQUcsQ0FBQztNQUN0Q3JDLE9BQU8sRUFBRXlDLGVBQWUsQ0FBQ0csUUFBUSxDQUFDUCxHQUFHO0lBQ3pDLENBQUM7RUFDTDs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtFQUNJMUYsb0JBQW9CQSxDQUFBLEVBQUc7SUFDbkIsT0FBTyxTQUFTMkIsSUFBSSxDQUFDQyxHQUFHLENBQUMsQ0FBQyxJQUFJdkUsTUFBTSxDQUFDLENBQUMsQ0FBQzJJLFNBQVMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUU7RUFDNUQ7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJRSxZQUFZQSxDQUFDckcsUUFBUSxFQUFFO0lBQ25CLE1BQU02RixHQUFHLEdBQUd6SSxJQUFJLENBQUMwSSxPQUFPLENBQUM5RixRQUFRLENBQUMsQ0FBQytGLFdBQVcsQ0FBQyxDQUFDO0lBQ2hELE9BQU8sSUFBSSxDQUFDMUcsbUJBQW1CLENBQUMrRyxRQUFRLENBQUNQLEdBQUcsQ0FBQztFQUNqRDs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtFQUNJUyxPQUFPQSxDQUFBLEVBQUc7SUFDTixPQUFPO01BQ0hDLElBQUksRUFBRSxpQkFBaUI7TUFDdkJDLFVBQVUsRUFBRSxJQUFJLENBQUNuSCxtQkFBbUI7TUFDcENvSCxXQUFXLEVBQUUsOEVBQThFO01BQzNGeEcsT0FBTyxFQUFFO1FBQ0x5RyxVQUFVLEVBQUUsNkNBQTZDO1FBQ3pEL0YsUUFBUSxFQUFFLHNDQUFzQztRQUNoRGlFLEtBQUssRUFBRTtNQUNYO0lBQ0osQ0FBQztFQUNMO0FBQ0o7QUFFQStCLE1BQU0sQ0FBQ0MsT0FBTyxHQUFHN0gsY0FBYyIsImlnbm9yZUxpc3QiOltdfQ==