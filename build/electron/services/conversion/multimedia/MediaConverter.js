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
class MediaConverter extends BaseService {
  constructor(registry, fileProcessor, fileStorage) {
    super();
    this.registry = registry;
    this.fileProcessor = fileProcessor;
    this.fileStorage = fileStorage;
    this.deepgramService = require('../../ai/DeepgramService');

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
    try {
      const conversionId = this.generateConversionId();
      const window = event.sender.getOwnerBrowserWindow();

      // Create a temp directory for processing
      const tempDir = await this.fileStorage.createTempDir('media_conversion');
      this.registry.registerConversion(conversionId, {
        id: conversionId,
        status: 'starting',
        progress: 0,
        filePath,
        tempDir,
        window,
        startTime: Date.now()
      });

      // Notify client that conversion has started
      window.webContents.send('media:conversion-started', {
        conversionId
      });

      // Start conversion process
      this.processConversion(conversionId, filePath, options).catch(error => {
        console.error(`[MediaConverter] Conversion failed for ${conversionId}:`, error);
        this.registry.pingConversion(conversionId, {
          status: 'failed',
          error: error.message
        });
      });
      return {
        conversionId
      };
    } catch (error) {
      console.error('[MediaConverter] Failed to start conversion:', error);
      throw error;
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
    try {
      const fileType = this.getFileType(filePath);
      this.registry.pingConversion(conversionId, {
        status: 'validating',
        progress: 5,
        fileType: fileType.type
      });

      // Get basic file metadata
      const stats = await fs.stat(filePath);
      const metadata = {
        filename: path.basename(filePath),
        fileType: fileType.type,
        size: stats.size,
        isAudio: fileType.isAudio,
        isVideo: fileType.isVideo
      };

      // Transcribe using Deepgram
      this.registry.pingConversion(conversionId, {
        status: 'transcribing',
        progress: 30
      });

      // Get transcription model from settings
      const model = settingsStore.get('transcription.model', 'nova-2');

      // Get transcription API key if not provided
      const deepgramApiKey = settingsStore.get('transcription.deepgramApiKey', '');
      if (!deepgramApiKey) {
        throw new Error('No Deepgram API key found. Please set one in Settings.');
      }

      // Start transcription job
      const transcriptionResult = await this.transcribeMedia(filePath, {
        model,
        deepgramApiKey,
        ...options
      });

      // Generate markdown
      this.registry.pingConversion(conversionId, {
        status: 'generating_markdown',
        progress: 90
      });
      const markdown = this.generateMarkdown(metadata, transcriptionResult, options);

      // Complete conversion
      this.registry.pingConversion(conversionId, {
        status: 'completed',
        progress: 100,
        result: markdown
      });
      return markdown;
    } catch (error) {
      console.error('[MediaConverter] Conversion processing failed:', error);
      throw error;
    }
  }

  /**
   * Transcribe media file using Deepgram
   * @param {string} filePath - Path to media file
   * @param {Object} options - Transcription options
   * @returns {Promise<Object>} Transcription result
   */
  async transcribeMedia(filePath, options = {}) {
    try {
      console.log(`[MediaConverter] Transcribing: ${filePath} with model: ${options.model}`);

      // Configure Deepgram with API key if provided
      if (options.deepgramApiKey) {
        await this.deepgramService.handleConfigure(null, {
          apiKey: options.deepgramApiKey
        });
      }

      // Start transcription job
      const result = await this.deepgramService.handleTranscribeStart(null, {
        filePath,
        options: {
          model: options.model || 'nova-2',
          language: options.language || 'en'
        }
      });
      console.log(`[MediaConverter] Transcription job started: ${result.jobId}`);

      // Wait for transcription to complete
      let status = await this.deepgramService.handleTranscribeStatus(null, {
        jobId: result.jobId
      });

      // Poll for completion
      while (status.status !== 'completed' && status.status !== 'failed' && status.status !== 'cancelled') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        status = await this.deepgramService.handleTranscribeStatus(null, {
          jobId: result.jobId
        });
      }
      if (status.status === 'failed') {
        throw new Error(status.error || 'Transcription failed');
      }
      if (status.status === 'cancelled') {
        throw new Error('Transcription cancelled');
      }
      console.log(`[MediaConverter] Transcription completed successfully`);
      return status.result;
    } catch (error) {
      console.error('[MediaConverter] Transcription failed:', error);
      throw error;
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

    // Add transcription if available
    if (transcription && transcription.text) {
      markdown.push('## Transcription');
      markdown.push('');
      markdown.push(transcription.text);
    } else {
      markdown.push('## Transcription');
      markdown.push('');
      markdown.push('*No transcription available for this media file.*');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwidjQiLCJ1dWlkdjQiLCJCYXNlU2VydmljZSIsImNyZWF0ZVN0b3JlIiwic2V0dGluZ3NTdG9yZSIsIk1lZGlhQ29udmVydGVyIiwiY29uc3RydWN0b3IiLCJyZWdpc3RyeSIsImZpbGVQcm9jZXNzb3IiLCJmaWxlU3RvcmFnZSIsImRlZXBncmFtU2VydmljZSIsInN1cHBvcnRlZEV4dGVuc2lvbnMiLCJjb25zb2xlIiwibG9nIiwiam9pbiIsInNldHVwSXBjSGFuZGxlcnMiLCJyZWdpc3RlckhhbmRsZXIiLCJoYW5kbGVDb252ZXJ0IiwiYmluZCIsImhhbmRsZUdldE1ldGFkYXRhIiwiaGFuZGxlQ2FuY2VsIiwiZXZlbnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJjb252ZXJzaW9uSWQiLCJnZW5lcmF0ZUNvbnZlcnNpb25JZCIsIndpbmRvdyIsInNlbmRlciIsImdldE93bmVyQnJvd3NlcldpbmRvdyIsInRlbXBEaXIiLCJjcmVhdGVUZW1wRGlyIiwicmVnaXN0ZXJDb252ZXJzaW9uIiwiaWQiLCJzdGF0dXMiLCJwcm9ncmVzcyIsInN0YXJ0VGltZSIsIkRhdGUiLCJub3ciLCJ3ZWJDb250ZW50cyIsInNlbmQiLCJwcm9jZXNzQ29udmVyc2lvbiIsImNhdGNoIiwiZXJyb3IiLCJwaW5nQ29udmVyc2lvbiIsIm1lc3NhZ2UiLCJmaWxlVHlwZSIsImdldEZpbGVUeXBlIiwic3RhdHMiLCJzdGF0IiwibWV0YWRhdGEiLCJmb3JtYXQiLCJ0eXBlIiwiZHVyYXRpb24iLCJzaXplIiwiZmlsZW5hbWUiLCJiYXNlbmFtZSIsImlzQXVkaW8iLCJpc1ZpZGVvIiwicmVtb3ZlQ29udmVyc2lvbiIsIm1vZGVsIiwiZ2V0IiwiZGVlcGdyYW1BcGlLZXkiLCJFcnJvciIsInRyYW5zY3JpcHRpb25SZXN1bHQiLCJ0cmFuc2NyaWJlTWVkaWEiLCJtYXJrZG93biIsImdlbmVyYXRlTWFya2Rvd24iLCJyZXN1bHQiLCJoYW5kbGVDb25maWd1cmUiLCJhcGlLZXkiLCJoYW5kbGVUcmFuc2NyaWJlU3RhcnQiLCJsYW5ndWFnZSIsImpvYklkIiwiaGFuZGxlVHJhbnNjcmliZVN0YXR1cyIsIlByb21pc2UiLCJyZXNvbHZlIiwic2V0VGltZW91dCIsInRyYW5zY3JpcHRpb24iLCJ0aXRsZSIsInB1c2giLCJtZWRpYVR5cGUiLCJmb3JtYXRGaWxlU2l6ZSIsInRleHQiLCJieXRlcyIsInVuaXRzIiwidW5pdEluZGV4IiwibGVuZ3RoIiwidG9GaXhlZCIsImV4dCIsImV4dG5hbWUiLCJ0b0xvd2VyQ2FzZSIsImF1ZGlvRXh0ZW5zaW9ucyIsInZpZGVvRXh0ZW5zaW9ucyIsImV4dGVuc2lvbiIsInN1YnN0cmluZyIsImluY2x1ZGVzIiwic3VwcG9ydHNGaWxlIiwiZ2V0SW5mbyIsIm5hbWUiLCJleHRlbnNpb25zIiwiZGVzY3JpcHRpb24iLCJ0cmFuc2NyaWJlIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL211bHRpbWVkaWEvTWVkaWFDb252ZXJ0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIE1lZGlhQ29udmVydGVyLmpzXHJcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiBhdWRpbyBhbmQgdmlkZW8gZmlsZXMgdG8gbWFya2Rvd24gZm9ybWF0IGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXHJcbiAqIFxyXG4gKiBUaGlzIGNvbnZlcnRlcjpcclxuICogLSBQcm9jZXNzZXMgYXVkaW8gYW5kIHZpZGVvIGZpbGVzIHVzaW5nIERlZXBncmFtIEFQSVxyXG4gKiAtIEV4dHJhY3RzIG1ldGFkYXRhIChkdXJhdGlvbiwgdHlwZSwgZXRjLilcclxuICogLSBUcmFuc2NyaWJlcyBjb250ZW50IHVzaW5nIERlZXBncmFtXHJcbiAqIC0gR2VuZXJhdGVzIHN0cnVjdHVyZWQgbWFya2Rvd24gb3V0cHV0XHJcbiAqIFxyXG4gKiBSZWxhdGVkIEZpbGVzOlxyXG4gKiAtIEJhc2VTZXJ2aWNlLmpzOiBQYXJlbnQgY2xhc3MgcHJvdmlkaW5nIElQQyBoYW5kbGluZ1xyXG4gKiAtIERlZXBncmFtU2VydmljZS5qczogVXNlZCBmb3IgYXVkaW8vdmlkZW8gdHJhbnNjcmlwdGlvblxyXG4gKiAtIEZpbGVTdG9yYWdlU2VydmljZS5qczogRm9yIHRlbXBvcmFyeSBmaWxlIG1hbmFnZW1lbnRcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbmNvbnN0IHsgdjQ6IHV1aWR2NCB9ID0gcmVxdWlyZSgndXVpZCcpO1xyXG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL0Jhc2VTZXJ2aWNlJyk7XHJcbmNvbnN0IHsgY3JlYXRlU3RvcmUgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL3V0aWxzL3N0b3JlRmFjdG9yeScpO1xyXG5cclxuLy8gU2V0dGluZ3Mgc3RvcmUgZm9yIHRyYW5zY3JpcHRpb24gc2V0dGluZ3NcclxuY29uc3Qgc2V0dGluZ3NTdG9yZSA9IGNyZWF0ZVN0b3JlKCdzZXR0aW5ncycpO1xyXG5cclxuY2xhc3MgTWVkaWFDb252ZXJ0ZXIgZXh0ZW5kcyBCYXNlU2VydmljZSB7XHJcbiAgICBjb25zdHJ1Y3RvcihyZWdpc3RyeSwgZmlsZVByb2Nlc3NvciwgZmlsZVN0b3JhZ2UpIHtcclxuICAgICAgICBzdXBlcigpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0cnkgPSByZWdpc3RyeTtcclxuICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yO1xyXG4gICAgICAgIHRoaXMuZmlsZVN0b3JhZ2UgPSBmaWxlU3RvcmFnZTtcclxuICAgICAgICB0aGlzLmRlZXBncmFtU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL2FpL0RlZXBncmFtU2VydmljZScpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFN1cHBvcnRlZCBmaWxlIGV4dGVuc2lvbnNcclxuICAgICAgICB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMgPSBbXHJcbiAgICAgICAgICAgIC8vIEF1ZGlvIGZvcm1hdHNcclxuICAgICAgICAgICAgJy5tcDMnLCAnLndhdicsICcub2dnJywgJy5tNGEnLCAnLmZsYWMnLCAnLmFhYycsXHJcbiAgICAgICAgICAgIC8vIFZpZGVvIGZvcm1hdHNcclxuICAgICAgICAgICAgJy5tcDQnLCAnLm1vdicsICcuYXZpJywgJy5ta3YnLCAnLndlYm0nXHJcbiAgICAgICAgXTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zb2xlLmxvZygnW01lZGlhQ29udmVydGVyXSBJbml0aWFsaXplZCB3aXRoIHN1cHBvcnQgZm9yOicsIHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucy5qb2luKCcsICcpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIG1lZGlhIGNvbnZlcnNpb25cclxuICAgICAqL1xyXG4gICAgc2V0dXBJcGNIYW5kbGVycygpIHtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDptZWRpYScsIHRoaXMuaGFuZGxlQ29udmVydC5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDptZWRpYTptZXRhZGF0YScsIHRoaXMuaGFuZGxlR2V0TWV0YWRhdGEuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6bWVkaWE6Y2FuY2VsJywgdGhpcy5oYW5kbGVDYW5jZWwuYmluZCh0aGlzKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgbWVkaWEgY29udmVyc2lvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ29udmVyc2lvbiByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlQ29udmVydChldmVudCwgeyBmaWxlUGF0aCwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uSWQgPSB0aGlzLmdlbmVyYXRlQ29udmVyc2lvbklkKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHdpbmRvdyA9IGV2ZW50LnNlbmRlci5nZXRPd25lckJyb3dzZXJXaW5kb3coKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBhIHRlbXAgZGlyZWN0b3J5IGZvciBwcm9jZXNzaW5nXHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ21lZGlhX2NvbnZlcnNpb24nKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucmVnaXN0ZXJDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwge1xyXG4gICAgICAgICAgICAgICAgaWQ6IGNvbnZlcnNpb25JZCxcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3N0YXJ0aW5nJyxcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAwLFxyXG4gICAgICAgICAgICAgICAgZmlsZVBhdGgsXHJcbiAgICAgICAgICAgICAgICB0ZW1wRGlyLFxyXG4gICAgICAgICAgICAgICAgd2luZG93LFxyXG4gICAgICAgICAgICAgICAgc3RhcnRUaW1lOiBEYXRlLm5vdygpXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgLy8gTm90aWZ5IGNsaWVudCB0aGF0IGNvbnZlcnNpb24gaGFzIHN0YXJ0ZWRcclxuICAgICAgICAgICAgd2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ21lZGlhOmNvbnZlcnNpb24tc3RhcnRlZCcsIHsgY29udmVyc2lvbklkIH0pO1xyXG5cclxuICAgICAgICAgICAgLy8gU3RhcnQgY29udmVyc2lvbiBwcm9jZXNzXHJcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCBmaWxlUGF0aCwgb3B0aW9ucykuY2F0Y2goZXJyb3IgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW01lZGlhQ29udmVydGVyXSBDb252ZXJzaW9uIGZhaWxlZCBmb3IgJHtjb252ZXJzaW9uSWR9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucGluZ0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB7IFxyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2ZhaWxlZCcsIFxyXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlIFxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHsgY29udmVyc2lvbklkIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW01lZGlhQ29udmVydGVyXSBGYWlsZWQgdG8gc3RhcnQgY29udmVyc2lvbjonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBtZXRhZGF0YSByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gTWV0YWRhdGEgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUdldE1ldGFkYXRhKGV2ZW50LCB7IGZpbGVQYXRoIH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQ29udmVydGVyXSBHZXR0aW5nIG1ldGFkYXRhIGZvcjogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICAgICAgY29uc3QgZmlsZVR5cGUgPSB0aGlzLmdldEZpbGVUeXBlKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFNpbXBsZSBtZXRhZGF0YSBleHRyYWN0aW9uIHdpdGhvdXQgZmZwcm9iZVxyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IHtcclxuICAgICAgICAgICAgICAgIGZvcm1hdDogZmlsZVR5cGUudHlwZSxcclxuICAgICAgICAgICAgICAgIGR1cmF0aW9uOiBcIlVua25vd25cIiwgLy8gV2UgZG9uJ3QgaGF2ZSBmZnByb2JlIHRvIGdldCBkdXJhdGlvblxyXG4gICAgICAgICAgICAgICAgc2l6ZTogc3RhdHMuc2l6ZSxcclxuICAgICAgICAgICAgICAgIGZpbGVuYW1lOiBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKSxcclxuICAgICAgICAgICAgICAgIGlzQXVkaW86IGZpbGVUeXBlLmlzQXVkaW8sXHJcbiAgICAgICAgICAgICAgICBpc1ZpZGVvOiBmaWxlVHlwZS5pc1ZpZGVvXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gbWV0YWRhdGE7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW01lZGlhQ29udmVydGVyXSBGYWlsZWQgdG8gZ2V0IG1ldGFkYXRhOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIGNvbnZlcnNpb24gY2FuY2VsbGF0aW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDYW5jZWxsYXRpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUNhbmNlbChldmVudCwgeyBjb252ZXJzaW9uSWQgfSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnJlZ2lzdHJ5LnJlbW92ZUNvbnZlcnNpb24oY29udmVyc2lvbklkKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgbWVkaWEgY29udmVyc2lvblxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBtZWRpYSBmaWxlXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBwcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIGZpbGVQYXRoLCBvcHRpb25zKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgZmlsZVR5cGUgPSB0aGlzLmdldEZpbGVUeXBlKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucGluZ0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB7IFxyXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAndmFsaWRhdGluZycsIFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDUsXHJcbiAgICAgICAgICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUudHlwZVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdldCBiYXNpYyBmaWxlIG1ldGFkYXRhXHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0ge1xyXG4gICAgICAgICAgICAgICAgZmlsZW5hbWU6IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpLFxyXG4gICAgICAgICAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLnR5cGUsXHJcbiAgICAgICAgICAgICAgICBzaXplOiBzdGF0cy5zaXplLFxyXG4gICAgICAgICAgICAgICAgaXNBdWRpbzogZmlsZVR5cGUuaXNBdWRpbyxcclxuICAgICAgICAgICAgICAgIGlzVmlkZW86IGZpbGVUeXBlLmlzVmlkZW9cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFRyYW5zY3JpYmUgdXNpbmcgRGVlcGdyYW1cclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgc3RhdHVzOiAndHJhbnNjcmliaW5nJywgcHJvZ3Jlc3M6IDMwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IHRyYW5zY3JpcHRpb24gbW9kZWwgZnJvbSBzZXR0aW5nc1xyXG4gICAgICAgICAgICBjb25zdCBtb2RlbCA9IHNldHRpbmdzU3RvcmUuZ2V0KCd0cmFuc2NyaXB0aW9uLm1vZGVsJywgJ25vdmEtMicpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IHRyYW5zY3JpcHRpb24gQVBJIGtleSBpZiBub3QgcHJvdmlkZWRcclxuICAgICAgICAgICAgY29uc3QgZGVlcGdyYW1BcGlLZXkgPSBzZXR0aW5nc1N0b3JlLmdldCgndHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleScsICcnKTtcclxuICAgICAgICAgICAgaWYgKCFkZWVwZ3JhbUFwaUtleSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBEZWVwZ3JhbSBBUEkga2V5IGZvdW5kLiBQbGVhc2Ugc2V0IG9uZSBpbiBTZXR0aW5ncy4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gU3RhcnQgdHJhbnNjcmlwdGlvbiBqb2JcclxuICAgICAgICAgICAgY29uc3QgdHJhbnNjcmlwdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMudHJhbnNjcmliZU1lZGlhKGZpbGVQYXRoLCB7XHJcbiAgICAgICAgICAgICAgICBtb2RlbCxcclxuICAgICAgICAgICAgICAgIGRlZXBncmFtQXBpS2V5LFxyXG4gICAgICAgICAgICAgICAgLi4ub3B0aW9uc1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duXHJcbiAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucGluZ0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB7IHN0YXR1czogJ2dlbmVyYXRpbmdfbWFya2Rvd24nLCBwcm9ncmVzczogOTAgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duID0gdGhpcy5nZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCB0cmFuc2NyaXB0aW9uUmVzdWx0LCBvcHRpb25zKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENvbXBsZXRlIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgXHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLCBcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAxMDAsXHJcbiAgICAgICAgICAgICAgICByZXN1bHQ6IG1hcmtkb3duIFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiBtYXJrZG93bjtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbTWVkaWFDb252ZXJ0ZXJdIENvbnZlcnNpb24gcHJvY2Vzc2luZyBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogVHJhbnNjcmliZSBtZWRpYSBmaWxlIHVzaW5nIERlZXBncmFtXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIG1lZGlhIGZpbGVcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gVHJhbnNjcmlwdGlvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBUcmFuc2NyaXB0aW9uIHJlc3VsdFxyXG4gICAgICovXHJcbiAgICBhc3luYyB0cmFuc2NyaWJlTWVkaWEoZmlsZVBhdGgsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFDb252ZXJ0ZXJdIFRyYW5zY3JpYmluZzogJHtmaWxlUGF0aH0gd2l0aCBtb2RlbDogJHtvcHRpb25zLm1vZGVsfWApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ29uZmlndXJlIERlZXBncmFtIHdpdGggQVBJIGtleSBpZiBwcm92aWRlZFxyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy5kZWVwZ3JhbUFwaUtleSkge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5kZWVwZ3JhbVNlcnZpY2UuaGFuZGxlQ29uZmlndXJlKG51bGwsIHsgXHJcbiAgICAgICAgICAgICAgICAgICAgYXBpS2V5OiBvcHRpb25zLmRlZXBncmFtQXBpS2V5IFxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFN0YXJ0IHRyYW5zY3JpcHRpb24gam9iXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZGVlcGdyYW1TZXJ2aWNlLmhhbmRsZVRyYW5zY3JpYmVTdGFydChudWxsLCB7XHJcbiAgICAgICAgICAgICAgICBmaWxlUGF0aCxcclxuICAgICAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbDogb3B0aW9ucy5tb2RlbCB8fCAnbm92YS0yJyxcclxuICAgICAgICAgICAgICAgICAgICBsYW5ndWFnZTogb3B0aW9ucy5sYW5ndWFnZSB8fCAnZW4nXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcl0gVHJhbnNjcmlwdGlvbiBqb2Igc3RhcnRlZDogJHtyZXN1bHQuam9iSWR9YCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBXYWl0IGZvciB0cmFuc2NyaXB0aW9uIHRvIGNvbXBsZXRlXHJcbiAgICAgICAgICAgIGxldCBzdGF0dXMgPSBhd2FpdCB0aGlzLmRlZXBncmFtU2VydmljZS5oYW5kbGVUcmFuc2NyaWJlU3RhdHVzKG51bGwsIHsgXHJcbiAgICAgICAgICAgICAgICBqb2JJZDogcmVzdWx0LmpvYklkIFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFBvbGwgZm9yIGNvbXBsZXRpb25cclxuICAgICAgICAgICAgd2hpbGUgKHN0YXR1cy5zdGF0dXMgIT09ICdjb21wbGV0ZWQnICYmIHN0YXR1cy5zdGF0dXMgIT09ICdmYWlsZWQnICYmIHN0YXR1cy5zdGF0dXMgIT09ICdjYW5jZWxsZWQnKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwMCkpO1xyXG4gICAgICAgICAgICAgICAgc3RhdHVzID0gYXdhaXQgdGhpcy5kZWVwZ3JhbVNlcnZpY2UuaGFuZGxlVHJhbnNjcmliZVN0YXR1cyhudWxsLCB7IFxyXG4gICAgICAgICAgICAgICAgICAgIGpvYklkOiByZXN1bHQuam9iSWQgXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHN0YXR1cy5zdGF0dXMgPT09ICdmYWlsZWQnKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3Ioc3RhdHVzLmVycm9yIHx8ICdUcmFuc2NyaXB0aW9uIGZhaWxlZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoc3RhdHVzLnN0YXR1cyA9PT0gJ2NhbmNlbGxlZCcpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVHJhbnNjcmlwdGlvbiBjYW5jZWxsZWQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUNvbnZlcnRlcl0gVHJhbnNjcmlwdGlvbiBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5YCk7XHJcbiAgICAgICAgICAgIHJldHVybiBzdGF0dXMucmVzdWx0O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNZWRpYUNvbnZlcnRlcl0gVHJhbnNjcmlwdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgbWFya2Rvd24gZnJvbSBtZWRpYSBtZXRhZGF0YSBhbmQgdHJhbnNjcmlwdGlvblxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gTWVkaWEgbWV0YWRhdGFcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSB0cmFuc2NyaXB0aW9uIC0gVHJhbnNjcmlwdGlvbiByZXN1bHRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIHRyYW5zY3JpcHRpb24sIG9wdGlvbnMpIHtcclxuICAgICAgICBjb25zdCBtYXJrZG93biA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCB0aXRsZVxyXG4gICAgICAgIGlmIChvcHRpb25zLnRpdGxlKSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCMgJHtvcHRpb25zLnRpdGxlfWApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG1lZGlhVHlwZSA9IG1ldGFkYXRhLmlzVmlkZW8gPyAnVmlkZW8nIDogJ0F1ZGlvJztcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIyAke21lZGlhVHlwZX06ICR7bWV0YWRhdGEuZmlsZW5hbWV9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBtZXRhZGF0YVxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIE1lZGlhIEluZm9ybWF0aW9uJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnfCBQcm9wZXJ0eSB8IFZhbHVlIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IC0tLSB8IC0tLSB8Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBGaWxlbmFtZSB8ICR7bWV0YWRhdGEuZmlsZW5hbWV9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFR5cGUgfCAke21ldGFkYXRhLmlzVmlkZW8gPyAnVmlkZW8nIDogJ0F1ZGlvJ30gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRm9ybWF0IHwgJHttZXRhZGF0YS5maWxlVHlwZX0gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRmlsZSBTaXplIHwgJHt0aGlzLmZvcm1hdEZpbGVTaXplKG1ldGFkYXRhLnNpemUpfSB8YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHRyYW5zY3JpcHRpb24gaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgaWYgKHRyYW5zY3JpcHRpb24gJiYgdHJhbnNjcmlwdGlvbi50ZXh0KSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJyMjIFRyYW5zY3JpcHRpb24nKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2godHJhbnNjcmlwdGlvbi50ZXh0KTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBUcmFuc2NyaXB0aW9uJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcqTm8gdHJhbnNjcmlwdGlvbiBhdmFpbGFibGUgZm9yIHRoaXMgbWVkaWEgZmlsZS4qJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBtYXJrZG93bi5qb2luKCdcXG4nKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBGb3JtYXQgZmlsZSBzaXplIGluIGJ5dGVzIHRvIGh1bWFuLXJlYWRhYmxlIGZvcm1hdFxyXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IGJ5dGVzIC0gRmlsZSBzaXplIGluIGJ5dGVzXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGb3JtYXR0ZWQgZmlsZSBzaXplXHJcbiAgICAgKi9cclxuICAgIGZvcm1hdEZpbGVTaXplKGJ5dGVzKSB7XHJcbiAgICAgICAgY29uc3QgdW5pdHMgPSBbJ0InLCAnS0InLCAnTUInLCAnR0InXTtcclxuICAgICAgICBsZXQgc2l6ZSA9IGJ5dGVzO1xyXG4gICAgICAgIGxldCB1bml0SW5kZXggPSAwO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHdoaWxlIChzaXplID49IDEwMjQgJiYgdW5pdEluZGV4IDwgdW5pdHMubGVuZ3RoIC0gMSkge1xyXG4gICAgICAgICAgICBzaXplIC89IDEwMjQ7XHJcbiAgICAgICAgICAgIHVuaXRJbmRleCsrO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gYCR7c2l6ZS50b0ZpeGVkKDIpfSAke3VuaXRzW3VuaXRJbmRleF19YDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgZmlsZSB0eXBlIGluZm9ybWF0aW9uIGZyb20gZmlsZSBwYXRoXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIGZpbGVcclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IEZpbGUgdHlwZSBpbmZvcm1hdGlvblxyXG4gICAgICovXHJcbiAgICBnZXRGaWxlVHlwZShmaWxlUGF0aCkge1xyXG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBdWRpbyBleHRlbnNpb25zXHJcbiAgICAgICAgY29uc3QgYXVkaW9FeHRlbnNpb25zID0gWycubXAzJywgJy53YXYnLCAnLm9nZycsICcubTRhJywgJy5mbGFjJywgJy5hYWMnXTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBWaWRlbyBleHRlbnNpb25zXHJcbiAgICAgICAgY29uc3QgdmlkZW9FeHRlbnNpb25zID0gWycubXA0JywgJy5tb3YnLCAnLmF2aScsICcubWt2JywgJy53ZWJtJ107XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBleHQsXHJcbiAgICAgICAgICAgIHR5cGU6IGV4dC5zdWJzdHJpbmcoMSksIC8vIFJlbW92ZSB0aGUgZG90XHJcbiAgICAgICAgICAgIGlzQXVkaW86IGF1ZGlvRXh0ZW5zaW9ucy5pbmNsdWRlcyhleHQpLFxyXG4gICAgICAgICAgICBpc1ZpZGVvOiB2aWRlb0V4dGVuc2lvbnMuaW5jbHVkZXMoZXh0KVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgdW5pcXVlIGNvbnZlcnNpb24gaWRlbnRpZmllclxyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gVW5pcXVlIGNvbnZlcnNpb24gSURcclxuICAgICAqL1xyXG4gICAgZ2VuZXJhdGVDb252ZXJzaW9uSWQoKSB7XHJcbiAgICAgICAgcmV0dXJuIGBtZWRpYV8ke0RhdGUubm93KCl9XyR7dXVpZHY0KCkuc3Vic3RyaW5nKDAsIDgpfWA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgdGhpcyBjb252ZXJ0ZXIgc3VwcG9ydHMgdGhlIGdpdmVuIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gZmlsZVxyXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXHJcbiAgICAgKi9cclxuICAgIHN1cHBvcnRzRmlsZShmaWxlUGF0aCkge1xyXG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICByZXR1cm4gdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLmluY2x1ZGVzKGV4dCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgY29udmVydGVyIGluZm9ybWF0aW9uXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBnZXRJbmZvKCkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIG5hbWU6ICdNZWRpYSBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICBleHRlbnNpb25zOiB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMsXHJcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ29udmVydHMgYXVkaW8gYW5kIHZpZGVvIGZpbGVzIHRvIG1hcmtkb3duIHdpdGggdHJhbnNjcmlwdGlvbiB1c2luZyBEZWVwZ3JhbScsXHJcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICAgIHRyYW5zY3JpYmU6ICdXaGV0aGVyIHRvIHRyYW5zY3JpYmUgbWVkaWEgKGRlZmF1bHQ6IHRydWUpJyxcclxuICAgICAgICAgICAgICAgIGxhbmd1YWdlOiAnVHJhbnNjcmlwdGlvbiBsYW5ndWFnZSAoZGVmYXVsdDogZW4pJyxcclxuICAgICAgICAgICAgICAgIHRpdGxlOiAnT3B0aW9uYWwgZG9jdW1lbnQgdGl0bGUnXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IE1lZGlhQ29udmVydGVyOyJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1DLEVBQUUsR0FBR0QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUM5QixNQUFNO0VBQUVFLEVBQUUsRUFBRUM7QUFBTyxDQUFDLEdBQUdILE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDdEMsTUFBTUksV0FBVyxH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