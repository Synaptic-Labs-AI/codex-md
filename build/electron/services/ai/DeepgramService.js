"use strict";

/**
 * DeepgramService.js
 * Handles audio and video transcription in the Electron main process using Deepgram.
 *
 * This service handles:
 * - Audio and video file transcription
 * - Chunking for large files
 * - Result formatting
 *
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - FileStorageService.js: For temporary file management
 */

const path = require('path');
const fs = require('fs-extra');
const {
  createClient
} = require('@deepgram/sdk');
const {
  Buffer
} = require('node:buffer');
const {
  v4: uuidv4
} = require('uuid');
const BaseService = require('../BaseService');
const {
  createStore
} = require('../../utils/storeFactory');

// Max chunk size for files (100MB)
const MAX_CHUNK_SIZE = 100 * 1024 * 1024;

// Settings store
const settingsStore = createStore('settings');
class DeepgramService extends BaseService {
  constructor() {
    // Pass options to BaseService constructor
    super({
      skipHandlerSetup: true
    });

    // Set instance properties
    this.deepgram = null;
    this.fileStorage = require('../storage/FileStorageService');
    this.activeJobs = new Map();

    // Manual setup with duplicate registration prevention
    this.manualSetupIpcHandlers();
  }

  /**
   * Manually set up IPC handlers with duplicate registration prevention
   */
  manualSetupIpcHandlers() {
    const handlerMethods = {
      'transcribe:start': this.handleTranscribeStart.bind(this),
      'transcribe:status': this.handleTranscribeStatus.bind(this),
      'transcribe:cancel': this.handleTranscribeCancel.bind(this),
      'deepgram:configure': this.handleConfigure.bind(this)
    };
    for (const [channel, handler] of Object.entries(handlerMethods)) {
      try {
        if (this.isHandlerRegistered(channel)) {
          console.log(`[DeepgramService] Handler for ${channel} already registered, skipping`);
        } else {
          this.registerHandler(channel, handler);
        }
      } catch (error) {
        console.error(`[DeepgramService] Error setting up handler for ${channel}:`, error);
      }
    }
  }

  /**
   * Check if an IPC handler is already registered
   * @param {string} channel - The channel to check
   * @returns {boolean} Whether the handler is registered
   */
  isHandlerRegistered(channel) {
    try {
      const {
        ipcMain
      } = require('electron');
      // We can't directly check for handler existence in a reliable way
      // This is a best effort attempt
      return ipcMain._events && ipcMain._events[`handle-${channel}`];
    } catch (err) {
      return false;
    }
  }

  /**
   * Set up IPC handlers for transcription operations
   */
  setupIpcHandlers() {
    this.registerHandler('transcribe:start', this.handleTranscribeStart.bind(this));
    this.registerHandler('transcribe:status', this.handleTranscribeStatus.bind(this));
    this.registerHandler('transcribe:cancel', this.handleTranscribeCancel.bind(this));
    this.registerHandler('deepgram:configure', this.handleConfigure.bind(this));
  }

  /**
   * Configure Deepgram with API key
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Configuration request
   */
  async handleConfigure(event, {
    apiKey
  }) {
    try {
      // Create Deepgram client with API key
      this.deepgram = createClient(apiKey);

      // Test the connection with a simple request
      // Just checking if the client is working, not actually making a transcription
      if (!this.deepgram) {
        throw new Error('Failed to initialize Deepgram client');
      }
      console.log('[DeepgramService] Successfully configured with API key');
      return {
        success: true
      };
    } catch (error) {
      console.error('[DeepgramService] Configuration failed:', error);
      throw new Error(`Failed to configure Deepgram: ${error.message}`);
    }
  }

  /**
   * Ensure Deepgram is configured with an API key
   * Loads the key from settings if not already configured
   */
  ensureConfigured() {
    if (!this.deepgram) {
      const apiKey = settingsStore.get('transcription.deepgramApiKey');
      if (apiKey) {
        try {
          this.deepgram = createClient(apiKey);
          console.log('[DeepgramService] Configured Deepgram with key from settings');
        } catch (error) {
          console.error('[DeepgramService] Failed to configure with stored key:', error);
          throw new Error(`Failed to configure Deepgram: ${error.message}`);
        }
      } else {
        console.error('[DeepgramService] No API key found in settings');
        throw new Error('Deepgram API not configured. Please set an API key in settings.');
      }
    }
  }

  /**
   * Handle transcription start request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Transcription request details
   */
  async handleTranscribeStart(event, {
    filePath,
    options = {}
  }) {
    try {
      this.ensureConfigured();
      const jobId = uuidv4();
      const tempDir = await this.fileStorage.createTempDir('transcription');
      this.activeJobs.set(jobId, {
        status: 'preparing',
        progress: 0,
        filePath,
        tempDir,
        // Get window only if event and sender exist (called via IPC)
        window: event && event.sender ? event.sender.getOwnerBrowserWindow() : null
      });

      // Start transcription process
      this.processTranscription(jobId, filePath, options).catch(error => {
        console.error(`[DeepgramService] Transcription failed for job ${jobId}:`, error);
        this.updateJobStatus(jobId, 'failed', {
          error: error.message
        });
      });
      return {
        jobId
      };
    } catch (error) {
      console.error('[DeepgramService] Failed to start transcription:', error);
      throw error;
    }
  }

  /**
   * Handle transcription status request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Status request details
   */
  async handleTranscribeStatus(event, {
    jobId
  }) {
    const job = this.activeJobs.get(jobId);
    return job || {
      status: 'not_found'
    };
  }

  /**
   * Handle transcription cancellation request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Cancellation request details
   */
  async handleTranscribeCancel(event, {
    jobId
  }) {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.status = 'cancelled';
      // Clean up temporary files
      await fs.remove(job.tempDir);
      this.activeJobs.delete(jobId);
    }
    return {
      success: true
    };
  }

  /**
   * Process transcription job
   * @param {string} jobId - Job identifier
   * @param {string} filePath - Path to media file
   * @param {Object} options - Transcription options
   */
  async processTranscription(jobId, filePath, options) {
    try {
      this.updateJobStatus(jobId, 'preparing');
      console.log(`[DeepgramService] Processing job ${jobId} for file: ${filePath}`);
      console.log(`[DeepgramService] Options:`, JSON.stringify(options, null, 2));

      // Verify file exists
      if (!(await fs.pathExists(filePath))) {
        console.error(`[DeepgramService] File not found: ${filePath}`);
        throw new Error('File not found');
      }
      const stats = await fs.stat(filePath);
      const fileExt = path.extname(filePath).toLowerCase();
      const fileSize = stats.size / (1024 * 1024); // Convert to MB

      const isVideo = options.isVideo || ['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(fileExt);
      const mediaType = options.mediaType || (isVideo ? 'video' : 'audio');
      console.log(`[DeepgramService] File info: ${mediaType}, ${fileExt}, ${fileSize.toFixed(2)} MB`);

      // Check if file size exceeds Deepgram's limit (2GB)
      if (stats.size > 2 * 1024 * 1024 * 1024) {
        throw new Error('File size exceeds Deepgram\'s 2GB limit');
      }

      // Use chunking for large files
      this.updateJobStatus(jobId, 'processing');
      console.log(`[DeepgramService] Processing file for transcription`);

      // Read the file
      const fileData = await fs.readFile(filePath);

      // Transcribe the file using Deepgram
      console.log(`[DeepgramService] Sending file to Deepgram API for transcription`);
      this.updateJobStatus(jobId, 'transcribing', {
        progress: 30
      });

      // Get transcription model from settings or use default
      const model = settingsStore.get('transcription.model', 'nova-3');
      const transcriptionResult = await this.transcribeWithDeepgram(fileData, {
        model: model,
        smart_format: true,
        language: options.language || 'en',
        ...options.deepgramOptions
      });
      this.updateJobStatus(jobId, 'formatting', {
        progress: 90
      });

      // Format the result
      const result = this.formatTranscriptionResult(transcriptionResult, options);

      // Clean up temp files
      await fs.remove(this.activeJobs.get(jobId).tempDir);
      console.log(`[DeepgramService] Cleaned up temporary files for job ${jobId}`);
      this.updateJobStatus(jobId, 'completed', {
        result
      });
      return result;
    } catch (error) {
      console.error('[DeepgramService] Transcription processing failed:', error);
      console.error('[DeepgramService] Error stack:', error.stack);
      this.updateJobStatus(jobId, 'failed', {
        error: error.message,
        details: {
          name: error.name,
          code: error.code,
          stack: error.stack
        }
      });
      throw error;
    }
  }

  /**
   * Transcribe file using Deepgram API
   * @param {Buffer} fileData - File buffer
   * @param {Object} options - Transcription options
   * @returns {Promise<Object>} Transcription result
   */
  async transcribeWithDeepgram(fileData, options) {
    try {
      console.log(`[DeepgramService] Transcribing with Deepgram using model: ${options.model}`);
      const {
        result,
        error
      } = await this.deepgram.listen.prerecorded.transcribeFile(fileData, options);
      if (error) {
        console.error('[DeepgramService] Deepgram transcription error:', error);
        throw new Error(`Deepgram transcription failed: ${error.message || 'Unknown error'}`);
      }
      console.log(`[DeepgramService] Transcription successful`);
      return result;
    } catch (error) {
      console.error('[DeepgramService] Error in Deepgram transcription:', error);
      throw error;
    }
  }

  /**
   * Format Deepgram transcription result
   * @param {Object} rawResult - Raw Deepgram result
   * @param {Object} options - Formatting options
   * @returns {Object} Formatted result
   */
  formatTranscriptionResult(rawResult, options) {
    try {
      // Extract transcript from Deepgram response
      let transcript = '';

      // Deepgram response includes alternatives in channels
      if (rawResult.results && rawResult.results.channels && rawResult.results.channels.length > 0 && rawResult.results.channels[0].alternatives && rawResult.results.channels[0].alternatives.length > 0) {
        transcript = rawResult.results.channels[0].alternatives[0].transcript;
      }

      // Extract metadata
      const metadata = rawResult.metadata || {};
      const duration = metadata.duration || 0;
      const language = options.language || 'en';
      return {
        text: transcript,
        language: language,
        duration: duration,
        model: options.model || 'nova-3',
        provider: 'deepgram',
        rawResponse: options.includeRawResponse ? rawResult : undefined
      };
    } catch (error) {
      console.error('[DeepgramService] Error formatting transcription result:', error);
      throw new Error(`Failed to format transcription result: ${error.message}`);
    }
  }

  /**
   * Update job status and notify renderer
   * @param {string} jobId - Job identifier
   * @param {string} status - New status
   * @param {Object} details - Additional details
   */
  updateJobStatus(jobId, status, details = {}) {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.status = status;
      Object.assign(job, details);
      if (job.window) {
        job.window.webContents.send('transcribe:progress', {
          jobId,
          status,
          ...details
        });
      }
    }
  }
}

// Create and export the singleton instance
const deepgramServiceInstance = new DeepgramService();
module.exports = deepgramServiceInstance;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiY3JlYXRlQ2xpZW50IiwiQnVmZmVyIiwidjQiLCJ1dWlkdjQiLCJCYXNlU2VydmljZSIsImNyZWF0ZVN0b3JlIiwiTUFYX0NIVU5LX1NJWkUiLCJzZXR0aW5nc1N0b3JlIiwiRGVlcGdyYW1TZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJza2lwSGFuZGxlclNldHVwIiwiZGVlcGdyYW0iLCJmaWxlU3RvcmFnZSIsImFjdGl2ZUpvYnMiLCJNYXAiLCJtYW51YWxTZXR1cElwY0hhbmRsZXJzIiwiaGFuZGxlck1ldGhvZHMiLCJoYW5kbGVUcmFuc2NyaWJlU3RhcnQiLCJiaW5kIiwiaGFuZGxlVHJhbnNjcmliZVN0YXR1cyIsImhhbmRsZVRyYW5zY3JpYmVDYW5jZWwiLCJoYW5kbGVDb25maWd1cmUiLCJjaGFubmVsIiwiaGFuZGxlciIsIk9iamVjdCIsImVudHJpZXMiLCJpc0hhbmRsZXJSZWdpc3RlcmVkIiwiY29uc29sZSIsImxvZyIsInJlZ2lzdGVySGFuZGxlciIsImVycm9yIiwiaXBjTWFpbiIsIl9ldmVudHMiLCJlcnIiLCJzZXR1cElwY0hhbmRsZXJzIiwiZXZlbnQiLCJhcGlLZXkiLCJFcnJvciIsInN1Y2Nlc3MiLCJtZXNzYWdlIiwiZW5zdXJlQ29uZmlndXJlZCIsImdldCIsImZpbGVQYXRoIiwib3B0aW9ucyIsImpvYklkIiwidGVtcERpciIsImNyZWF0ZVRlbXBEaXIiLCJzZXQiLCJzdGF0dXMiLCJwcm9ncmVzcyIsIndpbmRvdyIsInNlbmRlciIsImdldE93bmVyQnJvd3NlcldpbmRvdyIsInByb2Nlc3NUcmFuc2NyaXB0aW9uIiwiY2F0Y2giLCJ1cGRhdGVKb2JTdGF0dXMiLCJqb2IiLCJyZW1vdmUiLCJkZWxldGUiLCJKU09OIiwic3RyaW5naWZ5IiwicGF0aEV4aXN0cyIsInN0YXRzIiwic3RhdCIsImZpbGVFeHQiLCJleHRuYW1lIiwidG9Mb3dlckNhc2UiLCJmaWxlU2l6ZSIsInNpemUiLCJpc1ZpZGVvIiwiaW5jbHVkZXMiLCJtZWRpYVR5cGUiLCJ0b0ZpeGVkIiwiZmlsZURhdGEiLCJyZWFkRmlsZSIsIm1vZGVsIiwidHJhbnNjcmlwdGlvblJlc3VsdCIsInRyYW5zY3JpYmVXaXRoRGVlcGdyYW0iLCJzbWFydF9mb3JtYXQiLCJsYW5ndWFnZSIsImRlZXBncmFtT3B0aW9ucyIsInJlc3VsdCIsImZvcm1hdFRyYW5zY3JpcHRpb25SZXN1bHQiLCJzdGFjayIsImRldGFpbHMiLCJuYW1lIiwiY29kZSIsImxpc3RlbiIsInByZXJlY29yZGVkIiwidHJhbnNjcmliZUZpbGUiLCJyYXdSZXN1bHQiLCJ0cmFuc2NyaXB0IiwicmVzdWx0cyIsImNoYW5uZWxzIiwibGVuZ3RoIiwiYWx0ZXJuYXRpdmVzIiwibWV0YWRhdGEiLCJkdXJhdGlvbiIsInRleHQiLCJwcm92aWRlciIsInJhd1Jlc3BvbnNlIiwiaW5jbHVkZVJhd1Jlc3BvbnNlIiwidW5kZWZpbmVkIiwiYXNzaWduIiwid2ViQ29udGVudHMiLCJzZW5kIiwiZGVlcGdyYW1TZXJ2aWNlSW5zdGFuY2UiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2FpL0RlZXBncmFtU2VydmljZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogRGVlcGdyYW1TZXJ2aWNlLmpzXHJcbiAqIEhhbmRsZXMgYXVkaW8gYW5kIHZpZGVvIHRyYW5zY3JpcHRpb24gaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2VzcyB1c2luZyBEZWVwZ3JhbS5cclxuICpcclxuICogVGhpcyBzZXJ2aWNlIGhhbmRsZXM6XHJcbiAqIC0gQXVkaW8gYW5kIHZpZGVvIGZpbGUgdHJhbnNjcmlwdGlvblxyXG4gKiAtIENodW5raW5nIGZvciBsYXJnZSBmaWxlc1xyXG4gKiAtIFJlc3VsdCBmb3JtYXR0aW5nXHJcbiAqXHJcbiAqIFJlbGF0ZWQgRmlsZXM6XHJcbiAqIC0gQmFzZVNlcnZpY2UuanM6IFBhcmVudCBjbGFzcyBwcm92aWRpbmcgSVBDIGhhbmRsaW5nXHJcbiAqIC0gRmlsZVN0b3JhZ2VTZXJ2aWNlLmpzOiBGb3IgdGVtcG9yYXJ5IGZpbGUgbWFuYWdlbWVudFxyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcclxuY29uc3QgeyBjcmVhdGVDbGllbnQgfSA9IHJlcXVpcmUoJ0BkZWVwZ3JhbS9zZGsnKTtcclxuY29uc3QgeyBCdWZmZXIgfSA9IHJlcXVpcmUoJ25vZGU6YnVmZmVyJyk7XHJcbmNvbnN0IHsgdjQ6IHV1aWR2NCB9ID0gcmVxdWlyZSgndXVpZCcpO1xyXG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uL0Jhc2VTZXJ2aWNlJyk7XHJcbmNvbnN0IHsgY3JlYXRlU3RvcmUgfSA9IHJlcXVpcmUoJy4uLy4uL3V0aWxzL3N0b3JlRmFjdG9yeScpO1xyXG5cclxuLy8gTWF4IGNodW5rIHNpemUgZm9yIGZpbGVzICgxMDBNQilcclxuY29uc3QgTUFYX0NIVU5LX1NJWkUgPSAxMDAgKiAxMDI0ICogMTAyNDtcclxuXHJcbi8vIFNldHRpbmdzIHN0b3JlXHJcbmNvbnN0IHNldHRpbmdzU3RvcmUgPSBjcmVhdGVTdG9yZSgnc2V0dGluZ3MnKTtcclxuXHJcbmNsYXNzIERlZXBncmFtU2VydmljZSBleHRlbmRzIEJhc2VTZXJ2aWNlIHtcclxuICAgIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgICAgIC8vIFBhc3Mgb3B0aW9ucyB0byBCYXNlU2VydmljZSBjb25zdHJ1Y3RvclxyXG4gICAgICAgIHN1cGVyKHsgc2tpcEhhbmRsZXJTZXR1cDogdHJ1ZSB9KTtcclxuXHJcbiAgICAgICAgLy8gU2V0IGluc3RhbmNlIHByb3BlcnRpZXNcclxuICAgICAgICB0aGlzLmRlZXBncmFtID0gbnVsbDtcclxuICAgICAgICB0aGlzLmZpbGVTdG9yYWdlID0gcmVxdWlyZSgnLi4vc3RvcmFnZS9GaWxlU3RvcmFnZVNlcnZpY2UnKTtcclxuICAgICAgICB0aGlzLmFjdGl2ZUpvYnMgPSBuZXcgTWFwKCk7XHJcblxyXG4gICAgICAgIC8vIE1hbnVhbCBzZXR1cCB3aXRoIGR1cGxpY2F0ZSByZWdpc3RyYXRpb24gcHJldmVudGlvblxyXG4gICAgICAgIHRoaXMubWFudWFsU2V0dXBJcGNIYW5kbGVycygpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogTWFudWFsbHkgc2V0IHVwIElQQyBoYW5kbGVycyB3aXRoIGR1cGxpY2F0ZSByZWdpc3RyYXRpb24gcHJldmVudGlvblxyXG4gICAgICovXHJcbiAgICBtYW51YWxTZXR1cElwY0hhbmRsZXJzKCkge1xyXG4gICAgICAgIGNvbnN0IGhhbmRsZXJNZXRob2RzID0ge1xyXG4gICAgICAgICAgICAndHJhbnNjcmliZTpzdGFydCc6IHRoaXMuaGFuZGxlVHJhbnNjcmliZVN0YXJ0LmJpbmQodGhpcyksXHJcbiAgICAgICAgICAgICd0cmFuc2NyaWJlOnN0YXR1cyc6IHRoaXMuaGFuZGxlVHJhbnNjcmliZVN0YXR1cy5iaW5kKHRoaXMpLFxyXG4gICAgICAgICAgICAndHJhbnNjcmliZTpjYW5jZWwnOiB0aGlzLmhhbmRsZVRyYW5zY3JpYmVDYW5jZWwuYmluZCh0aGlzKSxcclxuICAgICAgICAgICAgJ2RlZXBncmFtOmNvbmZpZ3VyZSc6IHRoaXMuaGFuZGxlQ29uZmlndXJlLmJpbmQodGhpcylcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBmb3IgKGNvbnN0IFtjaGFubmVsLCBoYW5kbGVyXSBvZiBPYmplY3QuZW50cmllcyhoYW5kbGVyTWV0aG9kcykpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmlzSGFuZGxlclJlZ2lzdGVyZWQoY2hhbm5lbCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0RlZXBncmFtU2VydmljZV0gSGFuZGxlciBmb3IgJHtjaGFubmVsfSBhbHJlYWR5IHJlZ2lzdGVyZWQsIHNraXBwaW5nYCk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKGNoYW5uZWwsIGhhbmRsZXIpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0RlZXBncmFtU2VydmljZV0gRXJyb3Igc2V0dGluZyB1cCBoYW5kbGVyIGZvciAke2NoYW5uZWx9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENoZWNrIGlmIGFuIElQQyBoYW5kbGVyIGlzIGFscmVhZHkgcmVnaXN0ZXJlZFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWwgLSBUaGUgY2hhbm5lbCB0byBjaGVja1xyXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIGhhbmRsZXIgaXMgcmVnaXN0ZXJlZFxyXG4gICAgICovXHJcbiAgICBpc0hhbmRsZXJSZWdpc3RlcmVkKGNoYW5uZWwpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCB7IGlwY01haW4gfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbiAgICAgICAgICAgIC8vIFdlIGNhbid0IGRpcmVjdGx5IGNoZWNrIGZvciBoYW5kbGVyIGV4aXN0ZW5jZSBpbiBhIHJlbGlhYmxlIHdheVxyXG4gICAgICAgICAgICAvLyBUaGlzIGlzIGEgYmVzdCBlZmZvcnQgYXR0ZW1wdFxyXG4gICAgICAgICAgICByZXR1cm4gaXBjTWFpbi5fZXZlbnRzICYmIGlwY01haW4uX2V2ZW50c1tgaGFuZGxlLSR7Y2hhbm5lbH1gXTtcclxuICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIHRyYW5zY3JpcHRpb24gb3BlcmF0aW9uc1xyXG4gICAgICovXHJcbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCd0cmFuc2NyaWJlOnN0YXJ0JywgdGhpcy5oYW5kbGVUcmFuc2NyaWJlU3RhcnQuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ3RyYW5zY3JpYmU6c3RhdHVzJywgdGhpcy5oYW5kbGVUcmFuc2NyaWJlU3RhdHVzLmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCd0cmFuc2NyaWJlOmNhbmNlbCcsIHRoaXMuaGFuZGxlVHJhbnNjcmliZUNhbmNlbC5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignZGVlcGdyYW06Y29uZmlndXJlJywgdGhpcy5oYW5kbGVDb25maWd1cmUuYmluZCh0aGlzKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDb25maWd1cmUgRGVlcGdyYW0gd2l0aCBBUEkga2V5XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ29uZmlndXJhdGlvbiByZXF1ZXN0XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUNvbmZpZ3VyZShldmVudCwgeyBhcGlLZXkgfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBEZWVwZ3JhbSBjbGllbnQgd2l0aCBBUEkga2V5XHJcbiAgICAgICAgICAgIHRoaXMuZGVlcGdyYW0gPSBjcmVhdGVDbGllbnQoYXBpS2V5KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFRlc3QgdGhlIGNvbm5lY3Rpb24gd2l0aCBhIHNpbXBsZSByZXF1ZXN0XHJcbiAgICAgICAgICAgIC8vIEp1c3QgY2hlY2tpbmcgaWYgdGhlIGNsaWVudCBpcyB3b3JraW5nLCBub3QgYWN0dWFsbHkgbWFraW5nIGEgdHJhbnNjcmlwdGlvblxyXG4gICAgICAgICAgICBpZiAoIXRoaXMuZGVlcGdyYW0pIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIGluaXRpYWxpemUgRGVlcGdyYW0gY2xpZW50Jyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbRGVlcGdyYW1TZXJ2aWNlXSBTdWNjZXNzZnVsbHkgY29uZmlndXJlZCB3aXRoIEFQSSBrZXknKTtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tEZWVwZ3JhbVNlcnZpY2VdIENvbmZpZ3VyYXRpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY29uZmlndXJlIERlZXBncmFtOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRW5zdXJlIERlZXBncmFtIGlzIGNvbmZpZ3VyZWQgd2l0aCBhbiBBUEkga2V5XHJcbiAgICAgKiBMb2FkcyB0aGUga2V5IGZyb20gc2V0dGluZ3MgaWYgbm90IGFscmVhZHkgY29uZmlndXJlZFxyXG4gICAgICovXHJcbiAgICBlbnN1cmVDb25maWd1cmVkKCkge1xyXG4gICAgICAgIGlmICghdGhpcy5kZWVwZ3JhbSkge1xyXG4gICAgICAgICAgICBjb25zdCBhcGlLZXkgPSBzZXR0aW5nc1N0b3JlLmdldCgndHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleScpO1xyXG4gICAgICAgICAgICBpZiAoYXBpS2V5KSB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGVlcGdyYW0gPSBjcmVhdGVDbGllbnQoYXBpS2V5KTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW0RlZXBncmFtU2VydmljZV0gQ29uZmlndXJlZCBEZWVwZ3JhbSB3aXRoIGtleSBmcm9tIHNldHRpbmdzJyk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tEZWVwZ3JhbVNlcnZpY2VdIEZhaWxlZCB0byBjb25maWd1cmUgd2l0aCBzdG9yZWQga2V5OicsIGVycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBjb25maWd1cmUgRGVlcGdyYW06ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tEZWVwZ3JhbVNlcnZpY2VdIE5vIEFQSSBrZXkgZm91bmQgaW4gc2V0dGluZ3MnKTtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRGVlcGdyYW0gQVBJIG5vdCBjb25maWd1cmVkLiBQbGVhc2Ugc2V0IGFuIEFQSSBrZXkgaW4gc2V0dGluZ3MuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgdHJhbnNjcmlwdGlvbiBzdGFydCByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gVHJhbnNjcmlwdGlvbiByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlVHJhbnNjcmliZVN0YXJ0KGV2ZW50LCB7IGZpbGVQYXRoLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHRoaXMuZW5zdXJlQ29uZmlndXJlZCgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3Qgam9iSWQgPSB1dWlkdjQoKTtcclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IHRoaXMuZmlsZVN0b3JhZ2UuY3JlYXRlVGVtcERpcigndHJhbnNjcmlwdGlvbicpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5hY3RpdmVKb2JzLnNldChqb2JJZCwge1xyXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAncHJlcGFyaW5nJyxcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAwLFxyXG4gICAgICAgICAgICAgICAgZmlsZVBhdGgsXHJcbiAgICAgICAgICAgICAgICB0ZW1wRGlyLFxyXG4gICAgICAgICAgICAgICAgLy8gR2V0IHdpbmRvdyBvbmx5IGlmIGV2ZW50IGFuZCBzZW5kZXIgZXhpc3QgKGNhbGxlZCB2aWEgSVBDKVxyXG4gICAgICAgICAgICAgICAgd2luZG93OiBldmVudCAmJiBldmVudC5zZW5kZXIgPyBldmVudC5zZW5kZXIuZ2V0T3duZXJCcm93c2VyV2luZG93KCkgOiBudWxsXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgLy8gU3RhcnQgdHJhbnNjcmlwdGlvbiBwcm9jZXNzXHJcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc1RyYW5zY3JpcHRpb24oam9iSWQsIGZpbGVQYXRoLCBvcHRpb25zKS5jYXRjaChlcnJvciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbRGVlcGdyYW1TZXJ2aWNlXSBUcmFuc2NyaXB0aW9uIGZhaWxlZCBmb3Igam9iICR7am9iSWR9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlSm9iU3RhdHVzKGpvYklkLCAnZmFpbGVkJywgeyBlcnJvcjogZXJyb3IubWVzc2FnZSB9KTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4geyBqb2JJZCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tEZWVwZ3JhbVNlcnZpY2VdIEZhaWxlZCB0byBzdGFydCB0cmFuc2NyaXB0aW9uOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIHRyYW5zY3JpcHRpb24gc3RhdHVzIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBTdGF0dXMgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZVRyYW5zY3JpYmVTdGF0dXMoZXZlbnQsIHsgam9iSWQgfSkge1xyXG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuYWN0aXZlSm9icy5nZXQoam9iSWQpO1xyXG4gICAgICAgIHJldHVybiBqb2IgfHwgeyBzdGF0dXM6ICdub3RfZm91bmQnIH07XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgdHJhbnNjcmlwdGlvbiBjYW5jZWxsYXRpb24gcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIENhbmNlbGxhdGlvbiByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlVHJhbnNjcmliZUNhbmNlbChldmVudCwgeyBqb2JJZCB9KSB7XHJcbiAgICAgICAgY29uc3Qgam9iID0gdGhpcy5hY3RpdmVKb2JzLmdldChqb2JJZCk7XHJcbiAgICAgICAgaWYgKGpvYikge1xyXG4gICAgICAgICAgICBqb2Iuc3RhdHVzID0gJ2NhbmNlbGxlZCc7XHJcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXBvcmFyeSBmaWxlc1xyXG4gICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUoam9iLnRlbXBEaXIpO1xyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUpvYnMuZGVsZXRlKGpvYklkKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUHJvY2VzcyB0cmFuc2NyaXB0aW9uIGpvYlxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkZW50aWZpZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gbWVkaWEgZmlsZVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBUcmFuc2NyaXB0aW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgcHJvY2Vzc1RyYW5zY3JpcHRpb24oam9iSWQsIGZpbGVQYXRoLCBvcHRpb25zKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVKb2JTdGF0dXMoam9iSWQsICdwcmVwYXJpbmcnKTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2VdIFByb2Nlc3Npbmcgam9iICR7am9iSWR9IGZvciBmaWxlOiAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0RlZXBncmFtU2VydmljZV0gT3B0aW9uczpgLCBKU09OLnN0cmluZ2lmeShvcHRpb25zLCBudWxsLCAyKSk7XHJcblxyXG4gICAgICAgICAgICAvLyBWZXJpZnkgZmlsZSBleGlzdHNcclxuICAgICAgICAgICAgaWYgKCFhd2FpdCBmcy5wYXRoRXhpc3RzKGZpbGVQYXRoKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0RlZXBncmFtU2VydmljZV0gRmlsZSBub3QgZm91bmQ6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpbGUgbm90IGZvdW5kJyk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVFeHQgPSBwYXRoLmV4dG5hbWUoZmlsZVBhdGgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVTaXplID0gc3RhdHMuc2l6ZSAvICgxMDI0ICogMTAyNCk7IC8vIENvbnZlcnQgdG8gTUJcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGlzVmlkZW8gPSBvcHRpb25zLmlzVmlkZW8gfHwgWycubXA0JywgJy5hdmknLCAnLm1vdicsICcubWt2JywgJy53ZWJtJ10uaW5jbHVkZXMoZmlsZUV4dCk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1lZGlhVHlwZSA9IG9wdGlvbnMubWVkaWFUeXBlIHx8IChpc1ZpZGVvID8gJ3ZpZGVvJyA6ICdhdWRpbycpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2VdIEZpbGUgaW5mbzogJHttZWRpYVR5cGV9LCAke2ZpbGVFeHR9LCAke2ZpbGVTaXplLnRvRml4ZWQoMil9IE1CYCk7XHJcblxyXG4gICAgICAgICAgICAvLyBDaGVjayBpZiBmaWxlIHNpemUgZXhjZWVkcyBEZWVwZ3JhbSdzIGxpbWl0ICgyR0IpXHJcbiAgICAgICAgICAgIGlmIChzdGF0cy5zaXplID4gMiAqIDEwMjQgKiAxMDI0ICogMTAyNCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdGaWxlIHNpemUgZXhjZWVkcyBEZWVwZ3JhbVxcJ3MgMkdCIGxpbWl0Jyk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIFVzZSBjaHVua2luZyBmb3IgbGFyZ2UgZmlsZXNcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVKb2JTdGF0dXMoam9iSWQsICdwcm9jZXNzaW5nJyk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlXSBQcm9jZXNzaW5nIGZpbGUgZm9yIHRyYW5zY3JpcHRpb25gKTtcclxuXHJcbiAgICAgICAgICAgIC8vIFJlYWQgdGhlIGZpbGVcclxuICAgICAgICAgICAgY29uc3QgZmlsZURhdGEgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBUcmFuc2NyaWJlIHRoZSBmaWxlIHVzaW5nIERlZXBncmFtXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlXSBTZW5kaW5nIGZpbGUgdG8gRGVlcGdyYW0gQVBJIGZvciB0cmFuc2NyaXB0aW9uYCk7XHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSm9iU3RhdHVzKGpvYklkLCAndHJhbnNjcmliaW5nJywgeyBwcm9ncmVzczogMzAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZXQgdHJhbnNjcmlwdGlvbiBtb2RlbCBmcm9tIHNldHRpbmdzIG9yIHVzZSBkZWZhdWx0XHJcbiAgICAgICAgICAgIGNvbnN0IG1vZGVsID0gc2V0dGluZ3NTdG9yZS5nZXQoJ3RyYW5zY3JpcHRpb24ubW9kZWwnLCAnbm92YS0zJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCB0cmFuc2NyaXB0aW9uUmVzdWx0ID0gYXdhaXQgdGhpcy50cmFuc2NyaWJlV2l0aERlZXBncmFtKFxyXG4gICAgICAgICAgICAgICAgZmlsZURhdGEsIFxyXG4gICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgIG1vZGVsOiBtb2RlbCxcclxuICAgICAgICAgICAgICAgICAgICBzbWFydF9mb3JtYXQ6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgbGFuZ3VhZ2U6IG9wdGlvbnMubGFuZ3VhZ2UgfHwgJ2VuJyxcclxuICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLmRlZXBncmFtT3B0aW9uc1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVKb2JTdGF0dXMoam9iSWQsICdmb3JtYXR0aW5nJywgeyBwcm9ncmVzczogOTAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBGb3JtYXQgdGhlIHJlc3VsdFxyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSB0aGlzLmZvcm1hdFRyYW5zY3JpcHRpb25SZXN1bHQodHJhbnNjcmlwdGlvblJlc3VsdCwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGZpbGVzXHJcbiAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0aGlzLmFjdGl2ZUpvYnMuZ2V0KGpvYklkKS50ZW1wRGlyKTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2VdIENsZWFuZWQgdXAgdGVtcG9yYXJ5IGZpbGVzIGZvciBqb2IgJHtqb2JJZH1gKTtcclxuXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSm9iU3RhdHVzKGpvYklkLCAnY29tcGxldGVkJywgeyByZXN1bHQgfSk7XHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0RlZXBncmFtU2VydmljZV0gVHJhbnNjcmlwdGlvbiBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tEZWVwZ3JhbVNlcnZpY2VdIEVycm9yIHN0YWNrOicsIGVycm9yLnN0YWNrKTtcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVKb2JTdGF0dXMoam9iSWQsICdmYWlsZWQnLCB7IFxyXG4gICAgICAgICAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgICAgICAgICBkZXRhaWxzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogZXJyb3IubmFtZSxcclxuICAgICAgICAgICAgICAgICAgICBjb2RlOiBlcnJvci5jb2RlLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0YWNrOiBlcnJvci5zdGFja1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogVHJhbnNjcmliZSBmaWxlIHVzaW5nIERlZXBncmFtIEFQSVxyXG4gICAgICogQHBhcmFtIHtCdWZmZXJ9IGZpbGVEYXRhIC0gRmlsZSBidWZmZXJcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gVHJhbnNjcmlwdGlvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBUcmFuc2NyaXB0aW9uIHJlc3VsdFxyXG4gICAgICovXHJcbiAgICBhc3luYyB0cmFuc2NyaWJlV2l0aERlZXBncmFtKGZpbGVEYXRhLCBvcHRpb25zKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2VdIFRyYW5zY3JpYmluZyB3aXRoIERlZXBncmFtIHVzaW5nIG1vZGVsOiAke29wdGlvbnMubW9kZWx9YCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCB7IHJlc3VsdCwgZXJyb3IgfSA9IGF3YWl0IHRoaXMuZGVlcGdyYW0ubGlzdGVuLnByZXJlY29yZGVkLnRyYW5zY3JpYmVGaWxlKFxyXG4gICAgICAgICAgICAgICAgZmlsZURhdGEsXHJcbiAgICAgICAgICAgICAgICBvcHRpb25zXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tEZWVwZ3JhbVNlcnZpY2VdIERlZXBncmFtIHRyYW5zY3JpcHRpb24gZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBEZWVwZ3JhbSB0cmFuc2NyaXB0aW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlIHx8ICdVbmtub3duIGVycm9yJ31gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2VdIFRyYW5zY3JpcHRpb24gc3VjY2Vzc2Z1bGApO1xyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tEZWVwZ3JhbVNlcnZpY2VdIEVycm9yIGluIERlZXBncmFtIHRyYW5zY3JpcHRpb246JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBGb3JtYXQgRGVlcGdyYW0gdHJhbnNjcmlwdGlvbiByZXN1bHRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByYXdSZXN1bHQgLSBSYXcgRGVlcGdyYW0gcmVzdWx0XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIEZvcm1hdHRpbmcgb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge09iamVjdH0gRm9ybWF0dGVkIHJlc3VsdFxyXG4gICAgICovXHJcbiAgICBmb3JtYXRUcmFuc2NyaXB0aW9uUmVzdWx0KHJhd1Jlc3VsdCwgb3B0aW9ucykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgdHJhbnNjcmlwdCBmcm9tIERlZXBncmFtIHJlc3BvbnNlXHJcbiAgICAgICAgICAgIGxldCB0cmFuc2NyaXB0ID0gJyc7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBEZWVwZ3JhbSByZXNwb25zZSBpbmNsdWRlcyBhbHRlcm5hdGl2ZXMgaW4gY2hhbm5lbHNcclxuICAgICAgICAgICAgaWYgKHJhd1Jlc3VsdC5yZXN1bHRzICYmIFxyXG4gICAgICAgICAgICAgICAgcmF3UmVzdWx0LnJlc3VsdHMuY2hhbm5lbHMgJiYgXHJcbiAgICAgICAgICAgICAgICByYXdSZXN1bHQucmVzdWx0cy5jaGFubmVscy5sZW5ndGggPiAwICYmIFxyXG4gICAgICAgICAgICAgICAgcmF3UmVzdWx0LnJlc3VsdHMuY2hhbm5lbHNbMF0uYWx0ZXJuYXRpdmVzICYmIFxyXG4gICAgICAgICAgICAgICAgcmF3UmVzdWx0LnJlc3VsdHMuY2hhbm5lbHNbMF0uYWx0ZXJuYXRpdmVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdHJhbnNjcmlwdCA9IHJhd1Jlc3VsdC5yZXN1bHRzLmNoYW5uZWxzWzBdLmFsdGVybmF0aXZlc1swXS50cmFuc2NyaXB0O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IG1ldGFkYXRhXHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gcmF3UmVzdWx0Lm1ldGFkYXRhIHx8IHt9O1xyXG4gICAgICAgICAgICBjb25zdCBkdXJhdGlvbiA9IG1ldGFkYXRhLmR1cmF0aW9uIHx8IDA7XHJcbiAgICAgICAgICAgIGNvbnN0IGxhbmd1YWdlID0gb3B0aW9ucy5sYW5ndWFnZSB8fCAnZW4nO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIHRleHQ6IHRyYW5zY3JpcHQsXHJcbiAgICAgICAgICAgICAgICBsYW5ndWFnZTogbGFuZ3VhZ2UsXHJcbiAgICAgICAgICAgICAgICBkdXJhdGlvbjogZHVyYXRpb24sXHJcbiAgICAgICAgICAgICAgICBtb2RlbDogb3B0aW9ucy5tb2RlbCB8fCAnbm92YS0zJyxcclxuICAgICAgICAgICAgICAgIHByb3ZpZGVyOiAnZGVlcGdyYW0nLFxyXG4gICAgICAgICAgICAgICAgcmF3UmVzcG9uc2U6IG9wdGlvbnMuaW5jbHVkZVJhd1Jlc3BvbnNlID8gcmF3UmVzdWx0IDogdW5kZWZpbmVkXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0RlZXBncmFtU2VydmljZV0gRXJyb3IgZm9ybWF0dGluZyB0cmFuc2NyaXB0aW9uIHJlc3VsdDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGZvcm1hdCB0cmFuc2NyaXB0aW9uIHJlc3VsdDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFVwZGF0ZSBqb2Igc3RhdHVzIGFuZCBub3RpZnkgcmVuZGVyZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RhdHVzIC0gTmV3IHN0YXR1c1xyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGRldGFpbHMgLSBBZGRpdGlvbmFsIGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgdXBkYXRlSm9iU3RhdHVzKGpvYklkLCBzdGF0dXMsIGRldGFpbHMgPSB7fSkge1xyXG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuYWN0aXZlSm9icy5nZXQoam9iSWQpO1xyXG4gICAgICAgIGlmIChqb2IpIHtcclxuICAgICAgICAgICAgam9iLnN0YXR1cyA9IHN0YXR1cztcclxuICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihqb2IsIGRldGFpbHMpO1xyXG5cclxuICAgICAgICAgICAgaWYgKGpvYi53aW5kb3cpIHtcclxuICAgICAgICAgICAgICAgIGpvYi53aW5kb3cud2ViQ29udGVudHMuc2VuZCgndHJhbnNjcmliZTpwcm9ncmVzcycsIHtcclxuICAgICAgICAgICAgICAgICAgICBqb2JJZCxcclxuICAgICAgICAgICAgICAgICAgICBzdGF0dXMsXHJcbiAgICAgICAgICAgICAgICAgICAgLi4uZGV0YWlsc1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIENyZWF0ZSBhbmQgZXhwb3J0IHRoZSBzaW5nbGV0b24gaW5zdGFuY2VcclxuY29uc3QgZGVlcGdyYW1TZXJ2aWNlSW5zdGFuY2UgPSBuZXcgRGVlcGdyYW1TZXJ2aWNlKCk7XHJcbm1vZHVsZS5leHBvcnRzID0gZGVlcGdyYW1TZXJ2aWNlSW5zdGFuY2U7Il0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDOUIsTUFBTTtFQUFFRTtBQUFhLENBQUMsR0FBR0YsT0FBTyxDQUFDLGVBQWUsQ0FBQztBQUNqRCxNQUFNO0VBQUVHO0FBQU8sQ0FBQyxHQUFHSCxPQUFPLENBQUMsYUFBYSxDQUFDO0FBQ3pDLE1BQU07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