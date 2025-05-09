"use strict";

/**
 * AudioConverter.js
 * Handles conversion of audio files to markdown format in the Electron main process.
 * 
 * This converter:
 * - Processes audio files using fluent-ffmpeg
 * - Extracts metadata (duration, bitrate, etc.)
 * - Integrates with TranscriberService for transcription
 * - Generates markdown with audio information and transcription
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - FileProcessorService.js: Used for file operations
 * - TranscriberService.js: Used for audio transcription
 * - FileStorageService.js: For temporary file management
 */

const path = require('path');
const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');
const ffprobeStatic = require('ffprobe-static');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg'); // Import ffmpeg installer
const {
  app
} = require('electron');
const BaseService = require('../../BaseService');
class AudioConverter extends BaseService {
  constructor(fileProcessor, transcriber, fileStorage) {
    super();
    this.fileProcessor = fileProcessor;
    this.transcriber = transcriber;
    this.fileStorage = fileStorage;
    this.supportedExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
    this.activeConversions = new Map();
    this.ffmpegConfigured = false;

    // We'll configure ffmpeg lazily to ensure app is ready
    // This helps avoid timing issues with process.resourcesPath
  }

  /**
   * Configure ffmpeg with the correct ffprobe and ffmpeg paths
   * This method ensures ffmpeg and ffprobe binaries are correctly located
   * and configured for both development and production environments.
   * 
   * @returns {boolean} True if configuration was successful
   * @throws {Error} If binaries cannot be found in production mode
   */
  configureFfmpeg() {
    // Skip if already configured
    if (this.ffmpegConfigured) {
      return true;
    }
    try {
      console.log('[AudioConverter] Configuring ffmpeg and ffprobe paths...');

      // Default paths from static packages
      let ffprobePath = ffprobeStatic.path;
      let ffmpegPath = ffmpegInstaller.path;

      // Store original paths for logging
      const defaultFfprobePath = ffprobePath;
      const defaultFfmpegPath = ffmpegPath;

      // In production, use the paths from the resources directory
      if (app && app.isPackaged) {
        console.log('[AudioConverter] Running in packaged mode, checking resources directory');

        // Check for ffprobe.exe in resources
        const ffprobeResourcesPath = path.join(process.resourcesPath, 'ffprobe.exe');
        if (fs.existsSync(ffprobeResourcesPath)) {
          ffprobePath = ffprobeResourcesPath;
          console.log(`[AudioConverter] Using ffprobe from resources: ${ffprobePath}`);
        } else {
          const errorMsg = `ffprobe.exe not found in resources directory: ${ffprobeResourcesPath}`;
          console.error(`[AudioConverter] ${errorMsg}`);
          console.error('[AudioConverter] This indicates a build configuration issue with extraFiles');
          throw new Error(`[AudioConverter] ${errorMsg}`);
        }

        // Check for ffmpeg.exe in resources
        const ffmpegResourcesPath = path.join(process.resourcesPath, 'ffmpeg.exe');
        if (fs.existsSync(ffmpegResourcesPath)) {
          ffmpegPath = ffmpegResourcesPath;
          console.log(`[AudioConverter] Using ffmpeg from resources: ${ffmpegPath}`);
        } else {
          const errorMsg = `ffmpeg.exe not found in resources directory: ${ffmpegResourcesPath}`;
          console.error(`[AudioConverter] ${errorMsg}`);
          console.error('[AudioConverter] This indicates a build configuration issue with extraFiles');

          // Log the resources directory contents to help diagnose the issue
          try {
            const resourcesContents = fs.readdirSync(process.resourcesPath);
            console.error('[AudioConverter] Resources directory contents:', resourcesContents);
          } catch (dirError) {
            console.error('[AudioConverter] Could not read resources directory:', dirError.message);
          }
          throw new Error(`[AudioConverter] ${errorMsg}`);
        }
      } else {
        console.log('[AudioConverter] Running in development mode');
        console.log(`[AudioConverter] Using default ffprobe path: ${ffprobePath}`);
        console.log(`[AudioConverter] Using default ffmpeg path: ${ffmpegPath}`);
      }

      // Set the paths for fluent-ffmpeg
      console.log(`[AudioConverter] Setting ffprobe path to: ${ffprobePath}`);
      ffmpeg.setFfprobePath(ffprobePath);
      console.log(`[AudioConverter] Setting ffmpeg path to: ${ffmpegPath}`);
      ffmpeg.setFfmpegPath(ffmpegPath);

      // Verify the configuration by logging the actual paths used
      console.log(`[AudioConverter] ffprobe path configured: ${ffprobePath}`);
      console.log(`[AudioConverter] ffmpeg path configured: ${ffmpegPath}`);

      // Log if we're using different paths than the defaults
      if (ffprobePath !== defaultFfprobePath) {
        console.log(`[AudioConverter] Using custom ffprobe path instead of default: ${defaultFfprobePath}`);
      }
      if (ffmpegPath !== defaultFfmpegPath) {
        console.log(`[AudioConverter] Using custom ffmpeg path instead of default: ${defaultFfmpegPath}`);
      }
      this.ffmpegConfigured = true;
      return true;
    } catch (error) {
      console.error('[AudioConverter] Error configuring ffmpeg:', error);
      this.ffmpegConfigured = false;
      throw error; // Re-throw to allow proper error handling upstream
    }
  }

  /**
   * Set up IPC handlers for audio conversion
   */
  setupIpcHandlers() {
    this.registerHandler('convert:audio', this.handleConvert.bind(this));
    this.registerHandler('convert:audio:metadata', this.handleGetMetadata.bind(this));
    this.registerHandler('convert:audio:cancel', this.handleCancel.bind(this));
  }

  /**
   * Handle audio conversion request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Conversion request details
   */
  async handleConvert(event, {
    filePath,
    options = {}
  }) {
    try {
      // Ensure ffmpeg is configured at the start of the conversion process
      if (!this.ffmpegConfigured) {
        console.log('[AudioConverter] Configuring ffmpeg before handling conversion request');
        this.configureFfmpeg();
      }
      const conversionId = this.generateConversionId();
      const window = event.sender.getOwnerBrowserWindow();
      this.activeConversions.set(conversionId, {
        id: conversionId,
        status: 'starting',
        progress: 0,
        filePath,
        window
      });

      // Notify client that conversion has started
      window.webContents.send('audio:conversion-started', {
        conversionId
      });

      // Start conversion process
      this.processConversion(conversionId, filePath, options).catch(error => {
        console.error(`[AudioConverter] Conversion failed for ${conversionId}:`, error);
        this.updateConversionStatus(conversionId, 'failed', {
          error: error.message
        });
      });
      return {
        conversionId
      };
    } catch (error) {
      console.error('[AudioConverter] Failed to start conversion:', error);
      throw error;
    }
  }

  /**
   * Handle audio metadata request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Metadata request details
   */
  async handleGetMetadata(event, {
    filePath
  }) {
    try {
      // Ensure ffmpeg is configured before getting metadata
      if (!this.ffmpegConfigured) {
        console.log('[AudioConverter] Configuring ffmpeg before getting metadata');
        this.configureFfmpeg();
      }
      console.log(`[AudioConverter] Handling metadata request for: ${filePath}`);
      const metadata = await this.getAudioMetadata(filePath);
      return metadata;
    } catch (error) {
      console.error('[AudioConverter] Failed to get metadata:', error);
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
    const conversion = this.activeConversions.get(conversionId);
    if (conversion) {
      conversion.status = 'cancelled';
      if (conversion.window) {
        conversion.window.webContents.send('audio:conversion-cancelled', {
          conversionId
        });
      }
      this.activeConversions.delete(conversionId);
    }
    return {
      success: true
    };
  }

  /**
   * Process audio conversion
   * @param {string} conversionId - Conversion identifier
   * @param {string} filePath - Path to audio file
   * @param {Object} options - Conversion options
   */
  async processConversion(conversionId, filePath, options) {
    try {
      // Ensure ffmpeg is configured before starting conversion
      if (!this.ffmpegConfigured) {
        console.log(`[AudioConverter] Configuring ffmpeg before conversion for ${conversionId}`);
        this.configureFfmpeg();
      }
      this.updateConversionStatus(conversionId, 'extracting_metadata');
      const metadata = await this.getAudioMetadata(filePath);
      this.updateConversionStatus(conversionId, 'transcribing', {
        progress: 10
      });

      // Transcribe audio if requested
      let transcription = null;
      if (options.transcribe !== false) {
        transcription = await this.transcribeAudio(filePath, options.language || 'en');
        this.updateConversionStatus(conversionId, 'transcribing', {
          progress: 90
        });
      }
      this.updateConversionStatus(conversionId, 'generating_markdown', {
        progress: 95
      });

      // Generate markdown
      const markdown = this.generateMarkdown(metadata, transcription, options);
      this.updateConversionStatus(conversionId, 'completed', {
        progress: 100,
        result: markdown
      });
      return markdown;
    } catch (error) {
      console.error('[AudioConverter] Conversion processing failed:', error);
      throw error;
    }
  }

  /**
   * Get audio file metadata
   * @param {string} filePath - Path to audio file
   * @returns {Promise<Object>} Audio metadata
   */
  async getAudioMetadata(filePath) {
    // Ensure ffmpeg is configured before use
    if (!this.ffmpegConfigured) {
      this.configureFfmpeg();
    }
    return new Promise((resolve, reject) => {
      try {
        console.log(`[AudioConverter] Getting metadata for: ${filePath}`);
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) {
            console.error('[AudioConverter] ffprobe error:', err);
            reject(err);
            return;
          }
          const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
          if (!audioStream) {
            const error = new Error('No audio stream found');
            console.error('[AudioConverter]', error.message);
            reject(error);
            return;
          }
          resolve({
            format: metadata.format.format_name,
            duration: metadata.format.duration,
            size: metadata.format.size,
            bitrate: metadata.format.bit_rate,
            codec: audioStream.codec_name,
            channels: audioStream.channels,
            sampleRate: audioStream.sample_rate,
            filename: path.basename(filePath)
          });
        });
      } catch (error) {
        console.error('[AudioConverter] Error in getAudioMetadata:', error);
        reject(error);
      }
    });
  }

  /**
   * Transcribe audio file
   * @param {string} filePath - Path to audio file
   * @param {string} language - Language code
   * @returns {Promise<Object>} Transcription result
   */
  async transcribeAudio(filePath, language) {
    try {
      // Ensure ffmpeg is configured before use
      if (!this.ffmpegConfigured) {
        this.configureFfmpeg();
      }
      console.log(`[AudioConverter] Starting transcription for: ${filePath}`);

      // Use the TranscriberService to transcribe the audio
      const result = await this.transcriber.handleTranscribeStart(null, {
        filePath,
        options: {
          language
        }
      });

      // Wait for transcription to complete
      let status = await this.transcriber.handleTranscribeStatus(null, {
        jobId: result.jobId
      });
      while (status.status !== 'completed' && status.status !== 'failed' && status.status !== 'cancelled') {
        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 1000));
        status = await this.transcriber.handleTranscribeStatus(null, {
          jobId: result.jobId
        });
      }
      if (status.status === 'failed') {
        throw new Error(status.error || 'Transcription failed');
      }
      if (status.status === 'cancelled') {
        throw new Error('Transcription cancelled');
      }
      return status.result;
    } catch (error) {
      console.error('[AudioConverter] Transcription failed:', error);
      throw error;
    }
  }

  /**
   * Generate markdown from audio metadata and transcription
   * @param {Object} metadata - Audio metadata
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
      markdown.push(`# Audio: ${metadata.filename}`);
    }
    markdown.push('');

    // Add metadata
    markdown.push('## Audio Information');
    markdown.push('');
    markdown.push('| Property | Value |');
    markdown.push('| --- | --- |');
    markdown.push(`| Filename | ${metadata.filename} |`);
    markdown.push(`| Duration | ${this.formatDuration(metadata.duration)} |`);
    markdown.push(`| Format | ${metadata.format} |`);
    markdown.push(`| Codec | ${metadata.codec} |`);
    markdown.push(`| Channels | ${metadata.channels} |`);
    markdown.push(`| Sample Rate | ${metadata.sampleRate} Hz |`);
    markdown.push(`| Bitrate | ${Math.round(metadata.bitrate / 1000)} kbps |`);
    markdown.push(`| File Size | ${this.formatFileSize(metadata.size)} |`);
    markdown.push('');

    // Add transcription if available
    if (transcription) {
      markdown.push('## Transcription');
      markdown.push('');
      markdown.push(transcription.text);
    }
    return markdown.join('\n');
  }

  /**
   * Format duration in seconds to hh:mm:ss
   * @param {number} seconds - Duration in seconds
   * @returns {string} Formatted duration
   */
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const secs = Math.floor(seconds % 60);
    return [hours.toString().padStart(2, '0'), minutes.toString().padStart(2, '0'), secs.toString().padStart(2, '0')].join(':');
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
   * Update conversion status and notify renderer
   * @param {string} conversionId - Conversion identifier
   * @param {string} status - New status
   * @param {Object} details - Additional details
   */
  updateConversionStatus(conversionId, status, details = {}) {
    const conversion = this.activeConversions.get(conversionId);
    if (conversion) {
      conversion.status = status;
      Object.assign(conversion, details);
      if (conversion.window) {
        conversion.window.webContents.send('audio:conversion-progress', {
          conversionId,
          status,
          ...details
        });
      }

      // Clean up completed or failed conversions
      if (status === 'completed' || status === 'failed') {
        setTimeout(() => {
          this.activeConversions.delete(conversionId);
        }, 5 * 60 * 1000); // Keep for 5 minutes for status queries
      }
    }
  }

  /**
   * Generate unique conversion identifier
   * @returns {string} Unique conversion ID
   */
  generateConversionId() {
    return `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
      name: 'Audio Converter',
      extensions: this.supportedExtensions,
      description: 'Converts audio files to markdown with transcription',
      options: {
        transcribe: 'Whether to transcribe audio (default: true)',
        language: 'Transcription language (default: en)',
        title: 'Optional document title'
      }
    };
  }
}
module.exports = AudioConverter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiZmZtcGVnIiwiZmZwcm9iZVN0YXRpYyIsImZmbXBlZ0luc3RhbGxlciIsImFwcCIsIkJhc2VTZXJ2aWNlIiwiQXVkaW9Db252ZXJ0ZXIiLCJjb25zdHJ1Y3RvciIsImZpbGVQcm9jZXNzb3IiLCJ0cmFuc2NyaWJlciIsImZpbGVTdG9yYWdlIiwic3VwcG9ydGVkRXh0ZW5zaW9ucyIsImFjdGl2ZUNvbnZlcnNpb25zIiwiTWFwIiwiZmZtcGVnQ29uZmlndXJlZCIsImNvbmZpZ3VyZUZmbXBlZyIsImNvbnNvbGUiLCJsb2ciLCJmZnByb2JlUGF0aCIsImZmbXBlZ1BhdGgiLCJkZWZhdWx0RmZwcm9iZVBhdGgiLCJkZWZhdWx0RmZtcGVnUGF0aCIsImlzUGFja2FnZWQiLCJmZnByb2JlUmVzb3VyY2VzUGF0aCIsImpvaW4iLCJwcm9jZXNzIiwicmVzb3VyY2VzUGF0aCIsImV4aXN0c1N5bmMiLCJlcnJvck1zZyIsImVycm9yIiwiRXJyb3IiLCJmZm1wZWdSZXNvdXJjZXNQYXRoIiwicmVzb3VyY2VzQ29udGVudHMiLCJyZWFkZGlyU3luYyIsImRpckVycm9yIiwibWVzc2FnZSIsInNldEZmcHJvYmVQYXRoIiwic2V0RmZtcGVnUGF0aCIsInNldHVwSXBjSGFuZGxlcnMiLCJyZWdpc3RlckhhbmRsZXIiLCJoYW5kbGVDb252ZXJ0IiwiYmluZCIsImhhbmRsZUdldE1ldGFkYXRhIiwiaGFuZGxlQ2FuY2VsIiwiZXZlbnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJjb252ZXJzaW9uSWQiLCJnZW5lcmF0ZUNvbnZlcnNpb25JZCIsIndpbmRvdyIsInNlbmRlciIsImdldE93bmVyQnJvd3NlcldpbmRvdyIsInNldCIsImlkIiwic3RhdHVzIiwicHJvZ3Jlc3MiLCJ3ZWJDb250ZW50cyIsInNlbmQiLCJwcm9jZXNzQ29udmVyc2lvbiIsImNhdGNoIiwidXBkYXRlQ29udmVyc2lvblN0YXR1cyIsIm1ldGFkYXRhIiwiZ2V0QXVkaW9NZXRhZGF0YSIsImNvbnZlcnNpb24iLCJnZXQiLCJkZWxldGUiLCJzdWNjZXNzIiwidHJhbnNjcmlwdGlvbiIsInRyYW5zY3JpYmUiLCJ0cmFuc2NyaWJlQXVkaW8iLCJsYW5ndWFnZSIsIm1hcmtkb3duIiwiZ2VuZXJhdGVNYXJrZG93biIsInJlc3VsdCIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0IiwiZmZwcm9iZSIsImVyciIsImF1ZGlvU3RyZWFtIiwic3RyZWFtcyIsImZpbmQiLCJzIiwiY29kZWNfdHlwZSIsImZvcm1hdCIsImZvcm1hdF9uYW1lIiwiZHVyYXRpb24iLCJzaXplIiwiYml0cmF0ZSIsImJpdF9yYXRlIiwiY29kZWMiLCJjb2RlY19uYW1lIiwiY2hhbm5lbHMiLCJzYW1wbGVSYXRlIiwic2FtcGxlX3JhdGUiLCJmaWxlbmFtZSIsImJhc2VuYW1lIiwiaGFuZGxlVHJhbnNjcmliZVN0YXJ0IiwiaGFuZGxlVHJhbnNjcmliZVN0YXR1cyIsImpvYklkIiwic2V0VGltZW91dCIsInRpdGxlIiwicHVzaCIsImZvcm1hdER1cmF0aW9uIiwiTWF0aCIsInJvdW5kIiwiZm9ybWF0RmlsZVNpemUiLCJ0ZXh0Iiwic2Vjb25kcyIsImhvdXJzIiwiZmxvb3IiLCJtaW51dGVzIiwic2VjcyIsInRvU3RyaW5nIiwicGFkU3RhcnQiLCJieXRlcyIsInVuaXRzIiwidW5pdEluZGV4IiwibGVuZ3RoIiwidG9GaXhlZCIsImRldGFpbHMiLCJPYmplY3QiLCJhc3NpZ24iLCJEYXRlIiwibm93IiwicmFuZG9tIiwic3Vic3RyIiwic3VwcG9ydHNGaWxlIiwiZXh0IiwiZXh0bmFtZSIsInRvTG93ZXJDYXNlIiwiaW5jbHVkZXMiLCJnZXRJbmZvIiwibmFtZSIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9tdWx0aW1lZGlhL0F1ZGlvQ29udmVydGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBBdWRpb0NvbnZlcnRlci5qc1xyXG4gKiBIYW5kbGVzIGNvbnZlcnNpb24gb2YgYXVkaW8gZmlsZXMgdG8gbWFya2Rvd24gZm9ybWF0IGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXHJcbiAqIFxyXG4gKiBUaGlzIGNvbnZlcnRlcjpcclxuICogLSBQcm9jZXNzZXMgYXVkaW8gZmlsZXMgdXNpbmcgZmx1ZW50LWZmbXBlZ1xyXG4gKiAtIEV4dHJhY3RzIG1ldGFkYXRhIChkdXJhdGlvbiwgYml0cmF0ZSwgZXRjLilcclxuICogLSBJbnRlZ3JhdGVzIHdpdGggVHJhbnNjcmliZXJTZXJ2aWNlIGZvciB0cmFuc2NyaXB0aW9uXHJcbiAqIC0gR2VuZXJhdGVzIG1hcmtkb3duIHdpdGggYXVkaW8gaW5mb3JtYXRpb24gYW5kIHRyYW5zY3JpcHRpb25cclxuICogXHJcbiAqIFJlbGF0ZWQgRmlsZXM6XHJcbiAqIC0gQmFzZVNlcnZpY2UuanM6IFBhcmVudCBjbGFzcyBwcm92aWRpbmcgSVBDIGhhbmRsaW5nXHJcbiAqIC0gRmlsZVByb2Nlc3NvclNlcnZpY2UuanM6IFVzZWQgZm9yIGZpbGUgb3BlcmF0aW9uc1xyXG4gKiAtIFRyYW5zY3JpYmVyU2VydmljZS5qczogVXNlZCBmb3IgYXVkaW8gdHJhbnNjcmlwdGlvblxyXG4gKiAtIEZpbGVTdG9yYWdlU2VydmljZS5qczogRm9yIHRlbXBvcmFyeSBmaWxlIG1hbmFnZW1lbnRcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbmNvbnN0IGZmbXBlZyA9IHJlcXVpcmUoJ2ZsdWVudC1mZm1wZWcnKTtcclxuY29uc3QgZmZwcm9iZVN0YXRpYyA9IHJlcXVpcmUoJ2ZmcHJvYmUtc3RhdGljJyk7XHJcbmNvbnN0IGZmbXBlZ0luc3RhbGxlciA9IHJlcXVpcmUoJ0BmZm1wZWctaW5zdGFsbGVyL2ZmbXBlZycpOyAvLyBJbXBvcnQgZmZtcGVnIGluc3RhbGxlclxyXG5jb25zdCB7IGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgQmFzZVNlcnZpY2UgPSByZXF1aXJlKCcuLi8uLi9CYXNlU2VydmljZScpO1xyXG5cclxuY2xhc3MgQXVkaW9Db252ZXJ0ZXIgZXh0ZW5kcyBCYXNlU2VydmljZSB7XHJcbiAgICBjb25zdHJ1Y3RvcihmaWxlUHJvY2Vzc29yLCB0cmFuc2NyaWJlciwgZmlsZVN0b3JhZ2UpIHtcclxuICAgICAgICBzdXBlcigpO1xyXG4gICAgICAgIHRoaXMuZmlsZVByb2Nlc3NvciA9IGZpbGVQcm9jZXNzb3I7XHJcbiAgICAgICAgdGhpcy50cmFuc2NyaWJlciA9IHRyYW5zY3JpYmVyO1xyXG4gICAgICAgIHRoaXMuZmlsZVN0b3JhZ2UgPSBmaWxlU3RvcmFnZTtcclxuICAgICAgICB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMgPSBbJy5tcDMnLCAnLndhdicsICcub2dnJywgJy5tNGEnLCAnLmZsYWMnLCAnLmFhYyddO1xyXG4gICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMgPSBuZXcgTWFwKCk7XHJcbiAgICAgICAgdGhpcy5mZm1wZWdDb25maWd1cmVkID0gZmFsc2U7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gV2UnbGwgY29uZmlndXJlIGZmbXBlZyBsYXppbHkgdG8gZW5zdXJlIGFwcCBpcyByZWFkeVxyXG4gICAgICAgIC8vIFRoaXMgaGVscHMgYXZvaWQgdGltaW5nIGlzc3VlcyB3aXRoIHByb2Nlc3MucmVzb3VyY2VzUGF0aFxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIENvbmZpZ3VyZSBmZm1wZWcgd2l0aCB0aGUgY29ycmVjdCBmZnByb2JlIGFuZCBmZm1wZWcgcGF0aHNcclxuICAgICAqIFRoaXMgbWV0aG9kIGVuc3VyZXMgZmZtcGVnIGFuZCBmZnByb2JlIGJpbmFyaWVzIGFyZSBjb3JyZWN0bHkgbG9jYXRlZFxyXG4gICAgICogYW5kIGNvbmZpZ3VyZWQgZm9yIGJvdGggZGV2ZWxvcG1lbnQgYW5kIHByb2R1Y3Rpb24gZW52aXJvbm1lbnRzLlxyXG4gICAgICogXHJcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBjb25maWd1cmF0aW9uIHdhcyBzdWNjZXNzZnVsXHJcbiAgICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgYmluYXJpZXMgY2Fubm90IGJlIGZvdW5kIGluIHByb2R1Y3Rpb24gbW9kZVxyXG4gICAgICovXHJcbiAgICBjb25maWd1cmVGZm1wZWcoKSB7XHJcbiAgICAgICAgLy8gU2tpcCBpZiBhbHJlYWR5IGNvbmZpZ3VyZWRcclxuICAgICAgICBpZiAodGhpcy5mZm1wZWdDb25maWd1cmVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tBdWRpb0NvbnZlcnRlcl0gQ29uZmlndXJpbmcgZmZtcGVnIGFuZCBmZnByb2JlIHBhdGhzLi4uJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBEZWZhdWx0IHBhdGhzIGZyb20gc3RhdGljIHBhY2thZ2VzXHJcbiAgICAgICAgICAgIGxldCBmZnByb2JlUGF0aCA9IGZmcHJvYmVTdGF0aWMucGF0aDtcclxuICAgICAgICAgICAgbGV0IGZmbXBlZ1BhdGggPSBmZm1wZWdJbnN0YWxsZXIucGF0aDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFN0b3JlIG9yaWdpbmFsIHBhdGhzIGZvciBsb2dnaW5nXHJcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRGZnByb2JlUGF0aCA9IGZmcHJvYmVQYXRoO1xyXG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0RmZtcGVnUGF0aCA9IGZmbXBlZ1BhdGg7XHJcblxyXG4gICAgICAgICAgICAvLyBJbiBwcm9kdWN0aW9uLCB1c2UgdGhlIHBhdGhzIGZyb20gdGhlIHJlc291cmNlcyBkaXJlY3RvcnlcclxuICAgICAgICAgICAgaWYgKGFwcCAmJiBhcHAuaXNQYWNrYWdlZCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tBdWRpb0NvbnZlcnRlcl0gUnVubmluZyBpbiBwYWNrYWdlZCBtb2RlLCBjaGVja2luZyByZXNvdXJjZXMgZGlyZWN0b3J5Jyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIENoZWNrIGZvciBmZnByb2JlLmV4ZSBpbiByZXNvdXJjZXNcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZmcHJvYmVSZXNvdXJjZXNQYXRoID0gcGF0aC5qb2luKHByb2Nlc3MucmVzb3VyY2VzUGF0aCwgJ2ZmcHJvYmUuZXhlJyk7XHJcbiAgICAgICAgICAgICAgICBpZiAoZnMuZXhpc3RzU3luYyhmZnByb2JlUmVzb3VyY2VzUGF0aCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBmZnByb2JlUGF0aCA9IGZmcHJvYmVSZXNvdXJjZXNQYXRoO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQXVkaW9Db252ZXJ0ZXJdIFVzaW5nIGZmcHJvYmUgZnJvbSByZXNvdXJjZXM6ICR7ZmZwcm9iZVBhdGh9YCk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTXNnID0gYGZmcHJvYmUuZXhlIG5vdCBmb3VuZCBpbiByZXNvdXJjZXMgZGlyZWN0b3J5OiAke2ZmcHJvYmVSZXNvdXJjZXNQYXRofWA7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0F1ZGlvQ29udmVydGVyXSAke2Vycm9yTXNnfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tBdWRpb0NvbnZlcnRlcl0gVGhpcyBpbmRpY2F0ZXMgYSBidWlsZCBjb25maWd1cmF0aW9uIGlzc3VlIHdpdGggZXh0cmFGaWxlcycpO1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgW0F1ZGlvQ29udmVydGVyXSAke2Vycm9yTXNnfWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIC8vIENoZWNrIGZvciBmZm1wZWcuZXhlIGluIHJlc291cmNlc1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZmZtcGVnUmVzb3VyY2VzUGF0aCA9IHBhdGguam9pbihwcm9jZXNzLnJlc291cmNlc1BhdGgsICdmZm1wZWcuZXhlJyk7XHJcbiAgICAgICAgICAgICAgICBpZiAoZnMuZXhpc3RzU3luYyhmZm1wZWdSZXNvdXJjZXNQYXRoKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZmbXBlZ1BhdGggPSBmZm1wZWdSZXNvdXJjZXNQYXRoO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQXVkaW9Db252ZXJ0ZXJdIFVzaW5nIGZmbXBlZyBmcm9tIHJlc291cmNlczogJHtmZm1wZWdQYXRofWApO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBlcnJvck1zZyA9IGBmZm1wZWcuZXhlIG5vdCBmb3VuZCBpbiByZXNvdXJjZXMgZGlyZWN0b3J5OiAke2ZmbXBlZ1Jlc291cmNlc1BhdGh9YDtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbQXVkaW9Db252ZXJ0ZXJdICR7ZXJyb3JNc2d9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0F1ZGlvQ29udmVydGVyXSBUaGlzIGluZGljYXRlcyBhIGJ1aWxkIGNvbmZpZ3VyYXRpb24gaXNzdWUgd2l0aCBleHRyYUZpbGVzJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gTG9nIHRoZSByZXNvdXJjZXMgZGlyZWN0b3J5IGNvbnRlbnRzIHRvIGhlbHAgZGlhZ25vc2UgdGhlIGlzc3VlXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzb3VyY2VzQ29udGVudHMgPSBmcy5yZWFkZGlyU3luYyhwcm9jZXNzLnJlc291cmNlc1BhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbQXVkaW9Db252ZXJ0ZXJdIFJlc291cmNlcyBkaXJlY3RvcnkgY29udGVudHM6JywgcmVzb3VyY2VzQ29udGVudHMpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGRpckVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tBdWRpb0NvbnZlcnRlcl0gQ291bGQgbm90IHJlYWQgcmVzb3VyY2VzIGRpcmVjdG9yeTonLCBkaXJFcnJvci5tZXNzYWdlKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBbQXVkaW9Db252ZXJ0ZXJdICR7ZXJyb3JNc2d9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW0F1ZGlvQ29udmVydGVyXSBSdW5uaW5nIGluIGRldmVsb3BtZW50IG1vZGUnKTtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQXVkaW9Db252ZXJ0ZXJdIFVzaW5nIGRlZmF1bHQgZmZwcm9iZSBwYXRoOiAke2ZmcHJvYmVQYXRofWApO1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtBdWRpb0NvbnZlcnRlcl0gVXNpbmcgZGVmYXVsdCBmZm1wZWcgcGF0aDogJHtmZm1wZWdQYXRofWApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBTZXQgdGhlIHBhdGhzIGZvciBmbHVlbnQtZmZtcGVnXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQXVkaW9Db252ZXJ0ZXJdIFNldHRpbmcgZmZwcm9iZSBwYXRoIHRvOiAke2ZmcHJvYmVQYXRofWApO1xyXG4gICAgICAgICAgICBmZm1wZWcuc2V0RmZwcm9iZVBhdGgoZmZwcm9iZVBhdGgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtBdWRpb0NvbnZlcnRlcl0gU2V0dGluZyBmZm1wZWcgcGF0aCB0bzogJHtmZm1wZWdQYXRofWApO1xyXG4gICAgICAgICAgICBmZm1wZWcuc2V0RmZtcGVnUGF0aChmZm1wZWdQYXRoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFZlcmlmeSB0aGUgY29uZmlndXJhdGlvbiBieSBsb2dnaW5nIHRoZSBhY3R1YWwgcGF0aHMgdXNlZFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0F1ZGlvQ29udmVydGVyXSBmZnByb2JlIHBhdGggY29uZmlndXJlZDogJHtmZnByb2JlUGF0aH1gKTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtBdWRpb0NvbnZlcnRlcl0gZmZtcGVnIHBhdGggY29uZmlndXJlZDogJHtmZm1wZWdQYXRofWApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gTG9nIGlmIHdlJ3JlIHVzaW5nIGRpZmZlcmVudCBwYXRocyB0aGFuIHRoZSBkZWZhdWx0c1xyXG4gICAgICAgICAgICBpZiAoZmZwcm9iZVBhdGggIT09IGRlZmF1bHRGZnByb2JlUGF0aCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtBdWRpb0NvbnZlcnRlcl0gVXNpbmcgY3VzdG9tIGZmcHJvYmUgcGF0aCBpbnN0ZWFkIG9mIGRlZmF1bHQ6ICR7ZGVmYXVsdEZmcHJvYmVQYXRofWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmIChmZm1wZWdQYXRoICE9PSBkZWZhdWx0RmZtcGVnUGF0aCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtBdWRpb0NvbnZlcnRlcl0gVXNpbmcgY3VzdG9tIGZmbXBlZyBwYXRoIGluc3RlYWQgb2YgZGVmYXVsdDogJHtkZWZhdWx0RmZtcGVnUGF0aH1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5mZm1wZWdDb25maWd1cmVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0F1ZGlvQ29udmVydGVyXSBFcnJvciBjb25maWd1cmluZyBmZm1wZWc6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aGlzLmZmbXBlZ0NvbmZpZ3VyZWQgPSBmYWxzZTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7IC8vIFJlLXRocm93IHRvIGFsbG93IHByb3BlciBlcnJvciBoYW5kbGluZyB1cHN0cmVhbVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIGF1ZGlvIGNvbnZlcnNpb25cclxuICAgICAqL1xyXG4gICAgc2V0dXBJcGNIYW5kbGVycygpIHtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDphdWRpbycsIHRoaXMuaGFuZGxlQ29udmVydC5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDphdWRpbzptZXRhZGF0YScsIHRoaXMuaGFuZGxlR2V0TWV0YWRhdGEuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6YXVkaW86Y2FuY2VsJywgdGhpcy5oYW5kbGVDYW5jZWwuYmluZCh0aGlzKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgYXVkaW8gY29udmVyc2lvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ29udmVyc2lvbiByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlQ29udmVydChldmVudCwgeyBmaWxlUGF0aCwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBFbnN1cmUgZmZtcGVnIGlzIGNvbmZpZ3VyZWQgYXQgdGhlIHN0YXJ0IG9mIHRoZSBjb252ZXJzaW9uIHByb2Nlc3NcclxuICAgICAgICAgICAgaWYgKCF0aGlzLmZmbXBlZ0NvbmZpZ3VyZWQpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbQXVkaW9Db252ZXJ0ZXJdIENvbmZpZ3VyaW5nIGZmbXBlZyBiZWZvcmUgaGFuZGxpbmcgY29udmVyc2lvbiByZXF1ZXN0Jyk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmNvbmZpZ3VyZUZmbXBlZygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uSWQgPSB0aGlzLmdlbmVyYXRlQ29udmVyc2lvbklkKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHdpbmRvdyA9IGV2ZW50LnNlbmRlci5nZXRPd25lckJyb3dzZXJXaW5kb3coKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2V0KGNvbnZlcnNpb25JZCwge1xyXG4gICAgICAgICAgICAgICAgaWQ6IGNvbnZlcnNpb25JZCxcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3N0YXJ0aW5nJyxcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAwLFxyXG4gICAgICAgICAgICAgICAgZmlsZVBhdGgsXHJcbiAgICAgICAgICAgICAgICB3aW5kb3dcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBOb3RpZnkgY2xpZW50IHRoYXQgY29udmVyc2lvbiBoYXMgc3RhcnRlZFxyXG4gICAgICAgICAgICB3aW5kb3cud2ViQ29udGVudHMuc2VuZCgnYXVkaW86Y29udmVyc2lvbi1zdGFydGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBTdGFydCBjb252ZXJzaW9uIHByb2Nlc3NcclxuICAgICAgICAgICAgdGhpcy5wcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIGZpbGVQYXRoLCBvcHRpb25zKS5jYXRjaChlcnJvciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbQXVkaW9Db252ZXJ0ZXJdIENvbnZlcnNpb24gZmFpbGVkIGZvciAke2NvbnZlcnNpb25JZH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2ZhaWxlZCcsIHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHsgY29udmVyc2lvbklkIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0F1ZGlvQ29udmVydGVyXSBGYWlsZWQgdG8gc3RhcnQgY29udmVyc2lvbjonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBhdWRpbyBtZXRhZGF0YSByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gTWV0YWRhdGEgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUdldE1ldGFkYXRhKGV2ZW50LCB7IGZpbGVQYXRoIH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBFbnN1cmUgZmZtcGVnIGlzIGNvbmZpZ3VyZWQgYmVmb3JlIGdldHRpbmcgbWV0YWRhdGFcclxuICAgICAgICAgICAgaWYgKCF0aGlzLmZmbXBlZ0NvbmZpZ3VyZWQpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbQXVkaW9Db252ZXJ0ZXJdIENvbmZpZ3VyaW5nIGZmbXBlZyBiZWZvcmUgZ2V0dGluZyBtZXRhZGF0YScpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5jb25maWd1cmVGZm1wZWcoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtBdWRpb0NvbnZlcnRlcl0gSGFuZGxpbmcgbWV0YWRhdGEgcmVxdWVzdCBmb3I6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgdGhpcy5nZXRBdWRpb01ldGFkYXRhKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgcmV0dXJuIG1ldGFkYXRhO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tBdWRpb0NvbnZlcnRlcl0gRmFpbGVkIHRvIGdldCBtZXRhZGF0YTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBjb252ZXJzaW9uIGNhbmNlbGxhdGlvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ2FuY2VsbGF0aW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDYW5jZWwoZXZlbnQsIHsgY29udmVyc2lvbklkIH0pIHtcclxuICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcclxuICAgICAgICBpZiAoY29udmVyc2lvbikge1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uLnN0YXR1cyA9ICdjYW5jZWxsZWQnO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24ud2luZG93KSB7XHJcbiAgICAgICAgICAgICAgICBjb252ZXJzaW9uLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdhdWRpbzpjb252ZXJzaW9uLWNhbmNlbGxlZCcsIHsgY29udmVyc2lvbklkIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmRlbGV0ZShjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBQcm9jZXNzIGF1ZGlvIGNvbnZlcnNpb25cclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIGlkZW50aWZpZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gYXVkaW8gZmlsZVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgcHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCBmaWxlUGF0aCwgb3B0aW9ucykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIEVuc3VyZSBmZm1wZWcgaXMgY29uZmlndXJlZCBiZWZvcmUgc3RhcnRpbmcgY29udmVyc2lvblxyXG4gICAgICAgICAgICBpZiAoIXRoaXMuZmZtcGVnQ29uZmlndXJlZCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtBdWRpb0NvbnZlcnRlcl0gQ29uZmlndXJpbmcgZmZtcGVnIGJlZm9yZSBjb252ZXJzaW9uIGZvciAke2NvbnZlcnNpb25JZH1gKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuY29uZmlndXJlRmZtcGVnKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdleHRyYWN0aW5nX21ldGFkYXRhJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgdGhpcy5nZXRBdWRpb01ldGFkYXRhKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICd0cmFuc2NyaWJpbmcnLCB7IHByb2dyZXNzOiAxMCB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFRyYW5zY3JpYmUgYXVkaW8gaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgICAgIGxldCB0cmFuc2NyaXB0aW9uID0gbnVsbDtcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMudHJhbnNjcmliZSAhPT0gZmFsc2UpIHtcclxuICAgICAgICAgICAgICAgIHRyYW5zY3JpcHRpb24gPSBhd2FpdCB0aGlzLnRyYW5zY3JpYmVBdWRpbyhmaWxlUGF0aCwgb3B0aW9ucy5sYW5ndWFnZSB8fCAnZW4nKTtcclxuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICd0cmFuc2NyaWJpbmcnLCB7IHByb2dyZXNzOiA5MCB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2dlbmVyYXRpbmdfbWFya2Rvd24nLCB7IHByb2dyZXNzOiA5NSB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duXHJcbiAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duID0gdGhpcy5nZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCB0cmFuc2NyaXB0aW9uLCBvcHRpb25zKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdjb21wbGV0ZWQnLCB7IFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDEwMCxcclxuICAgICAgICAgICAgICAgIHJlc3VsdDogbWFya2Rvd25cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gbWFya2Rvd247XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0F1ZGlvQ29udmVydGVyXSBDb252ZXJzaW9uIHByb2Nlc3NpbmcgZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGF1ZGlvIGZpbGUgbWV0YWRhdGFcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gYXVkaW8gZmlsZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gQXVkaW8gbWV0YWRhdGFcclxuICAgICAqL1xyXG4gICAgYXN5bmMgZ2V0QXVkaW9NZXRhZGF0YShmaWxlUGF0aCkge1xyXG4gICAgICAgIC8vIEVuc3VyZSBmZm1wZWcgaXMgY29uZmlndXJlZCBiZWZvcmUgdXNlXHJcbiAgICAgICAgaWYgKCF0aGlzLmZmbXBlZ0NvbmZpZ3VyZWQpIHtcclxuICAgICAgICAgICAgdGhpcy5jb25maWd1cmVGZm1wZWcoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQXVkaW9Db252ZXJ0ZXJdIEdldHRpbmcgbWV0YWRhdGEgZm9yOiAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgICAgICAgICAgZmZtcGVnLmZmcHJvYmUoZmlsZVBhdGgsIChlcnIsIG1ldGFkYXRhKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbQXVkaW9Db252ZXJ0ZXJdIGZmcHJvYmUgZXJyb3I6JywgZXJyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYXVkaW9TdHJlYW0gPSBtZXRhZGF0YS5zdHJlYW1zLmZpbmQocyA9PiBzLmNvZGVjX3R5cGUgPT09ICdhdWRpbycpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghYXVkaW9TdHJlYW0pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ05vIGF1ZGlvIHN0cmVhbSBmb3VuZCcpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbQXVkaW9Db252ZXJ0ZXJdJywgZXJyb3IubWVzc2FnZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvcm1hdDogbWV0YWRhdGEuZm9ybWF0LmZvcm1hdF9uYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkdXJhdGlvbjogbWV0YWRhdGEuZm9ybWF0LmR1cmF0aW9uLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzaXplOiBtZXRhZGF0YS5mb3JtYXQuc2l6ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYml0cmF0ZTogbWV0YWRhdGEuZm9ybWF0LmJpdF9yYXRlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlYzogYXVkaW9TdHJlYW0uY29kZWNfbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbm5lbHM6IGF1ZGlvU3RyZWFtLmNoYW5uZWxzLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzYW1wbGVSYXRlOiBhdWRpb1N0cmVhbS5zYW1wbGVfcmF0ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZW5hbWU6IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tBdWRpb0NvbnZlcnRlcl0gRXJyb3IgaW4gZ2V0QXVkaW9NZXRhZGF0YTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBUcmFuc2NyaWJlIGF1ZGlvIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gYXVkaW8gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGxhbmd1YWdlIC0gTGFuZ3VhZ2UgY29kZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gVHJhbnNjcmlwdGlvbiByZXN1bHRcclxuICAgICAqL1xyXG4gICAgYXN5bmMgdHJhbnNjcmliZUF1ZGlvKGZpbGVQYXRoLCBsYW5ndWFnZSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIEVuc3VyZSBmZm1wZWcgaXMgY29uZmlndXJlZCBiZWZvcmUgdXNlXHJcbiAgICAgICAgICAgIGlmICghdGhpcy5mZm1wZWdDb25maWd1cmVkKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmNvbmZpZ3VyZUZmbXBlZygpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0F1ZGlvQ29udmVydGVyXSBTdGFydGluZyB0cmFuc2NyaXB0aW9uIGZvcjogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFVzZSB0aGUgVHJhbnNjcmliZXJTZXJ2aWNlIHRvIHRyYW5zY3JpYmUgdGhlIGF1ZGlvXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMudHJhbnNjcmliZXIuaGFuZGxlVHJhbnNjcmliZVN0YXJ0KG51bGwsIHtcclxuICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxyXG4gICAgICAgICAgICAgICAgb3B0aW9uczogeyBsYW5ndWFnZSB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gV2FpdCBmb3IgdHJhbnNjcmlwdGlvbiB0byBjb21wbGV0ZVxyXG4gICAgICAgICAgICBsZXQgc3RhdHVzID0gYXdhaXQgdGhpcy50cmFuc2NyaWJlci5oYW5kbGVUcmFuc2NyaWJlU3RhdHVzKG51bGwsIHsgam9iSWQ6IHJlc3VsdC5qb2JJZCB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHdoaWxlIChzdGF0dXMuc3RhdHVzICE9PSAnY29tcGxldGVkJyAmJiBzdGF0dXMuc3RhdHVzICE9PSAnZmFpbGVkJyAmJiBzdGF0dXMuc3RhdHVzICE9PSAnY2FuY2VsbGVkJykge1xyXG4gICAgICAgICAgICAgICAgLy8gV2FpdCBhIGJpdCBiZWZvcmUgY2hlY2tpbmcgYWdhaW5cclxuICAgICAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDAwKSk7XHJcbiAgICAgICAgICAgICAgICBzdGF0dXMgPSBhd2FpdCB0aGlzLnRyYW5zY3JpYmVyLmhhbmRsZVRyYW5zY3JpYmVTdGF0dXMobnVsbCwgeyBqb2JJZDogcmVzdWx0LmpvYklkIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoc3RhdHVzLnN0YXR1cyA9PT0gJ2ZhaWxlZCcpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihzdGF0dXMuZXJyb3IgfHwgJ1RyYW5zY3JpcHRpb24gZmFpbGVkJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChzdGF0dXMuc3RhdHVzID09PSAnY2FuY2VsbGVkJykge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUcmFuc2NyaXB0aW9uIGNhbmNlbGxlZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gc3RhdHVzLnJlc3VsdDtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbQXVkaW9Db252ZXJ0ZXJdIFRyYW5zY3JpcHRpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgbWFya2Rvd24gZnJvbSBhdWRpbyBtZXRhZGF0YSBhbmQgdHJhbnNjcmlwdGlvblxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gQXVkaW8gbWV0YWRhdGFcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSB0cmFuc2NyaXB0aW9uIC0gVHJhbnNjcmlwdGlvbiByZXN1bHRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIHRyYW5zY3JpcHRpb24sIG9wdGlvbnMpIHtcclxuICAgICAgICBjb25zdCBtYXJrZG93biA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCB0aXRsZVxyXG4gICAgICAgIGlmIChvcHRpb25zLnRpdGxlKSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCMgJHtvcHRpb25zLnRpdGxlfWApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCMgQXVkaW86ICR7bWV0YWRhdGEuZmlsZW5hbWV9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBtZXRhZGF0YVxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIEF1ZGlvIEluZm9ybWF0aW9uJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnfCBQcm9wZXJ0eSB8IFZhbHVlIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IC0tLSB8IC0tLSB8Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBGaWxlbmFtZSB8ICR7bWV0YWRhdGEuZmlsZW5hbWV9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IER1cmF0aW9uIHwgJHt0aGlzLmZvcm1hdER1cmF0aW9uKG1ldGFkYXRhLmR1cmF0aW9uKX0gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRm9ybWF0IHwgJHttZXRhZGF0YS5mb3JtYXR9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IENvZGVjIHwgJHttZXRhZGF0YS5jb2RlY30gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgQ2hhbm5lbHMgfCAke21ldGFkYXRhLmNoYW5uZWxzfSB8YCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBTYW1wbGUgUmF0ZSB8ICR7bWV0YWRhdGEuc2FtcGxlUmF0ZX0gSHogfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgQml0cmF0ZSB8ICR7TWF0aC5yb3VuZChtZXRhZGF0YS5iaXRyYXRlIC8gMTAwMCl9IGticHMgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRmlsZSBTaXplIHwgJHt0aGlzLmZvcm1hdEZpbGVTaXplKG1ldGFkYXRhLnNpemUpfSB8YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHRyYW5zY3JpcHRpb24gaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgaWYgKHRyYW5zY3JpcHRpb24pIHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgVHJhbnNjcmlwdGlvbicpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCh0cmFuc2NyaXB0aW9uLnRleHQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbWFya2Rvd24uam9pbignXFxuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBGb3JtYXQgZHVyYXRpb24gaW4gc2Vjb25kcyB0byBoaDptbTpzc1xyXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHNlY29uZHMgLSBEdXJhdGlvbiBpbiBzZWNvbmRzXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGb3JtYXR0ZWQgZHVyYXRpb25cclxuICAgICAqL1xyXG4gICAgZm9ybWF0RHVyYXRpb24oc2Vjb25kcykge1xyXG4gICAgICAgIGNvbnN0IGhvdXJzID0gTWF0aC5mbG9vcihzZWNvbmRzIC8gMzYwMCk7XHJcbiAgICAgICAgY29uc3QgbWludXRlcyA9IE1hdGguZmxvb3IoKHNlY29uZHMgJSAzNjAwKSAvIDYwKTtcclxuICAgICAgICBjb25zdCBzZWNzID0gTWF0aC5mbG9vcihzZWNvbmRzICUgNjApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBbXHJcbiAgICAgICAgICAgIGhvdXJzLnRvU3RyaW5nKCkucGFkU3RhcnQoMiwgJzAnKSxcclxuICAgICAgICAgICAgbWludXRlcy50b1N0cmluZygpLnBhZFN0YXJ0KDIsICcwJyksXHJcbiAgICAgICAgICAgIHNlY3MudG9TdHJpbmcoKS5wYWRTdGFydCgyLCAnMCcpXHJcbiAgICAgICAgXS5qb2luKCc6Jyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBGb3JtYXQgZmlsZSBzaXplIGluIGJ5dGVzIHRvIGh1bWFuLXJlYWRhYmxlIGZvcm1hdFxyXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IGJ5dGVzIC0gRmlsZSBzaXplIGluIGJ5dGVzXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGb3JtYXR0ZWQgZmlsZSBzaXplXHJcbiAgICAgKi9cclxuICAgIGZvcm1hdEZpbGVTaXplKGJ5dGVzKSB7XHJcbiAgICAgICAgY29uc3QgdW5pdHMgPSBbJ0InLCAnS0InLCAnTUInLCAnR0InXTtcclxuICAgICAgICBsZXQgc2l6ZSA9IGJ5dGVzO1xyXG4gICAgICAgIGxldCB1bml0SW5kZXggPSAwO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHdoaWxlIChzaXplID49IDEwMjQgJiYgdW5pdEluZGV4IDwgdW5pdHMubGVuZ3RoIC0gMSkge1xyXG4gICAgICAgICAgICBzaXplIC89IDEwMjQ7XHJcbiAgICAgICAgICAgIHVuaXRJbmRleCsrO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gYCR7c2l6ZS50b0ZpeGVkKDIpfSAke3VuaXRzW3VuaXRJbmRleF19YDtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFVwZGF0ZSBjb252ZXJzaW9uIHN0YXR1cyBhbmQgbm90aWZ5IHJlbmRlcmVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RhdHVzIC0gTmV3IHN0YXR1c1xyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGRldGFpbHMgLSBBZGRpdGlvbmFsIGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgdXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsIHN0YXR1cywgZGV0YWlscyA9IHt9KSB7XHJcbiAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XHJcbiAgICAgICAgaWYgKGNvbnZlcnNpb24pIHtcclxuICAgICAgICAgICAgY29udmVyc2lvbi5zdGF0dXMgPSBzdGF0dXM7XHJcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oY29udmVyc2lvbiwgZGV0YWlscyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoY29udmVyc2lvbi53aW5kb3cpIHtcclxuICAgICAgICAgICAgICAgIGNvbnZlcnNpb24ud2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ2F1ZGlvOmNvbnZlcnNpb24tcHJvZ3Jlc3MnLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvbklkLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cyxcclxuICAgICAgICAgICAgICAgICAgICAuLi5kZXRhaWxzXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgY29tcGxldGVkIG9yIGZhaWxlZCBjb252ZXJzaW9uc1xyXG4gICAgICAgICAgICBpZiAoc3RhdHVzID09PSAnY29tcGxldGVkJyB8fCBzdGF0dXMgPT09ICdmYWlsZWQnKSB7XHJcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmRlbGV0ZShjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgICAgICAgICAgfSwgNSAqIDYwICogMTAwMCk7IC8vIEtlZXAgZm9yIDUgbWludXRlcyBmb3Igc3RhdHVzIHF1ZXJpZXNcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIHVuaXF1ZSBjb252ZXJzaW9uIGlkZW50aWZpZXJcclxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IFVuaXF1ZSBjb252ZXJzaW9uIElEXHJcbiAgICAgKi9cclxuICAgIGdlbmVyYXRlQ29udmVyc2lvbklkKCkge1xyXG4gICAgICAgIHJldHVybiBgYXVkaW9fJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cigyLCA5KX1gO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgdGhpcyBjb252ZXJ0ZXIgc3VwcG9ydHMgdGhlIGdpdmVuIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gZmlsZVxyXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXHJcbiAgICAgKi9cclxuICAgIHN1cHBvcnRzRmlsZShmaWxlUGF0aCkge1xyXG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICByZXR1cm4gdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLmluY2x1ZGVzKGV4dCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgY29udmVydGVyIGluZm9ybWF0aW9uXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBnZXRJbmZvKCkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIG5hbWU6ICdBdWRpbyBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICBleHRlbnNpb25zOiB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMsXHJcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ29udmVydHMgYXVkaW8gZmlsZXMgdG8gbWFya2Rvd24gd2l0aCB0cmFuc2NyaXB0aW9uJyxcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgICAgdHJhbnNjcmliZTogJ1doZXRoZXIgdG8gdHJhbnNjcmliZSBhdWRpbyAoZGVmYXVsdDogdHJ1ZSknLFxyXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2U6ICdUcmFuc2NyaXB0aW9uIGxhbmd1YWdlIChkZWZhdWx0OiBlbiknLFxyXG4gICAgICAgICAgICAgICAgdGl0bGU6ICdPcHRpb25hbCBkb2N1bWVudCB0aXRsZSdcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQXVkaW9Db252ZXJ0ZXI7XHJcbiJdLCJtYXBwaW5ncyI6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