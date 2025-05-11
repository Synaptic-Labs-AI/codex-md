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
const apiKeyService = require('../ApiKeyService');

// Max chunk size for files (100MB)
const MAX_CHUNK_SIZE = 100 * 1024 * 1024;

// Utility to sanitize objects for logging, especially to handle Buffers
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
   * Enhanced with better debugging and fallback options
   */
  ensureConfigured() {
    if (!this.deepgram) {
      console.log('[DeepgramService] Configuring Deepgram client...');

      // Try multiple potential key locations with detailed logging
      const directKey = settingsStore.get('deepgramApiKey');
      const nestedKey = settingsStore.get('transcription.deepgramApiKey');
      const apiKeyServiceKey = require('../ApiKeyService').getApiKey('deepgram');
      console.log(`[DeepgramService] API Key sources:
              - Direct path (deepgramApiKey): ${directKey ? 'Found (length: ' + directKey.length + ')' : 'Not found'}
              - Nested path (transcription.deepgramApiKey): ${nestedKey ? 'Found (length: ' + nestedKey.length + ')' : 'Not found'}
              - ApiKeyService: ${apiKeyServiceKey ? 'Found (length: ' + apiKeyServiceKey.length + ')' : 'Not found'}`);

      // Use the first available key
      const apiKey = directKey || nestedKey || apiKeyServiceKey;
      if (apiKey) {
        try {
          console.log(`[DeepgramService] Creating Deepgram client with key (length: ${apiKey.length})`);
          this.deepgram = createClient(apiKey);

          // Test if the client was created successfully
          if (!this.deepgram) {
            throw new Error('Failed to create Deepgram client (undefined result)');
          }
          console.log('[DeepgramService] Successfully configured Deepgram with API key');

          // Save the key to ensure it's in all expected locations for future use
          try {
            if (!directKey) {
              console.log('[DeepgramService] Saving key to direct path for future use');
              settingsStore.set('deepgramApiKey', apiKey);
            }
            if (!nestedKey) {
              console.log('[DeepgramService] Saving key to nested path for future use');
              const currentTranscription = settingsStore.get('transcription') || {};
              currentTranscription.deepgramApiKey = apiKey;
              settingsStore.set('transcription', currentTranscription);
            }
            if (!apiKeyServiceKey) {
              console.log('[DeepgramService] Saving key to ApiKeyService for future use');
              require('../ApiKeyService').saveApiKey(apiKey, 'deepgram');
            }
          } catch (saveError) {
            // Just log the error but continue using the current key
            console.error('[DeepgramService] Error saving key to all locations:', saveError);
          }
        } catch (error) {
          console.error('[DeepgramService] Failed to configure with API key:', error);
          throw new Error(`Failed to configure Deepgram: ${error.message}`);
        }
      } else {
        console.error('[DeepgramService] No API key found in any location');
        throw new Error('Deepgram API not configured. Please set an API key in Settings → Transcription.');
      }
    } else {
      console.log('[DeepgramService] Deepgram client already configured');
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
      console.log(`[DeepgramService:STARTING][jobId:${jobId}] Starting transcription for file: ${filePath}`);
      console.log(`[DeepgramService:STARTING][jobId:${jobId}] Options:`, sanitizeForLogging(options));
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
        const errorMessage = error.message || 'Unknown transcription error';
        console.error(`[DeepgramService:FAILED][jobId:${jobId}] Transcription failed:`, sanitizeForLogging(error));
        this.updateJobStatus(jobId, 'failed', {
          error: errorMessage,
          details: sanitizeForLogging(error)
        });
      });
      return {
        jobId
      };
    } catch (error) {
      const errorMessage = error.message || 'Unknown error starting transcription';
      console.error('[DeepgramService:FAILED] Failed to start transcription:', sanitizeForLogging(error));
      throw new Error(errorMessage);
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
      this.updateJobStatus(jobId, 'preparing', {
        progress: 5
      });
      console.log(`[DeepgramService:PREPARING][jobId:${jobId}] Processing job for file: ${filePath}`);
      console.log(`[DeepgramService:PREPARING][jobId:${jobId}] Options:`, sanitizeForLogging(options));

      // Verify file exists
      if (!(await fs.pathExists(filePath))) {
        console.error(`[DeepgramService:VALIDATION_FAILED][jobId:${jobId}] File not found: ${filePath}`);
        throw new Error(`File not found: ${filePath}`);
      }
      this.updateJobStatus(jobId, 'validating', {
        progress: 10
      });
      const stats = await fs.stat(filePath);
      const fileExt = path.extname(filePath).toLowerCase();
      const fileSizeMB = stats.size / (1024 * 1024);
      const isVideo = options.isVideo || ['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(fileExt);
      const mediaType = options.mediaType || (isVideo ? 'video' : 'audio');
      console.log(`[DeepgramService:INFO][jobId:${jobId}] File info: type=${mediaType}, ext=${fileExt}, size=${fileSizeMB.toFixed(2)}MB`);

      // Check if file size exceeds Deepgram's limit (2GB)
      if (stats.size > 2 * 1024 * 1024 * 1024) {
        console.error(`[DeepgramService:VALIDATION_FAILED][jobId:${jobId}] File size (${fileSizeMB.toFixed(2)}MB) exceeds Deepgram's 2GB limit.`);
        throw new Error('File size exceeds Deepgram\'s 2GB limit');
      }
      this.updateJobStatus(jobId, 'processing', {
        progress: 15
      });

      // Read the file
      console.log(`[DeepgramService:READING_FILE][jobId:${jobId}] Reading file content...`);
      const fileData = await fs.readFile(filePath);
      console.log(`[DeepgramService:READING_FILE][jobId:${jobId}] File read successfully (Buffer length: ${fileData.length})`);
      this.updateJobStatus(jobId, 'transcribing', {
        progress: 30
      });

      // Get transcription model from settings or use default
      const model = settingsStore.get('transcription.model', 'nova-2'); // Changed default to nova-2 for broader compatibility

      console.log(`[DeepgramService:TRANSCRIBING][jobId:${jobId}] Sending file to Deepgram API using model: ${model}`);
      const transcriptionResult = await this.transcribeWithDeepgram(fileData, {
        model: model,
        smart_format: true,
        punctuate: true,
        // Added for better formatting
        diarize: options.diarize || false,
        // Speaker diarization
        utterances: options.utterances || false,
        // Utterance splitting
        language: options.language || 'en',
        ...options.deepgramOptions // Allow overriding with specific deepgram options
      }, jobId);
      this.updateJobStatus(jobId, 'formatting', {
        progress: 90
      });
      console.log(`[DeepgramService:FORMATTING][jobId:${jobId}] Formatting transcription result...`);
      const result = this.formatTranscriptionResult(transcriptionResult, options);

      // Clean up temp files
      const jobData = this.activeJobs.get(jobId);
      if (jobData && jobData.tempDir) {
        await fs.remove(jobData.tempDir);
        console.log(`[DeepgramService:CLEANUP][jobId:${jobId}] Cleaned up temporary files from: ${jobData.tempDir}`);
      } else {
        console.warn(`[DeepgramService:CLEANUP_WARN][jobId:${jobId}] No tempDir found for cleanup.`);
      }
      this.updateJobStatus(jobId, 'completed', {
        result
      });
      console.log(`[DeepgramService:COMPLETED][jobId:${jobId}] Transcription completed successfully.`);
      return result;
    } catch (error) {
      const errorMessage = error.message || 'Unknown transcription processing error';
      console.error(`[DeepgramService:FAILED][jobId:${jobId}] Transcription processing failed:`, sanitizeForLogging(error));
      this.updateJobStatus(jobId, 'failed', {
        error: errorMessage,
        details: sanitizeForLogging({
          name: error.name,
          code: error.code
          // stack: error.stack // Stack can be very long, consider omitting or truncating for general logs
        })
      });
      throw new Error(errorMessage); // Re-throw to be caught by the caller
    }
  }

  /**
   * Transcribe file using Deepgram API
   * @param {Buffer} fileData - File buffer
   * @param {Object} options - Transcription options
   * @returns {Promise<Object>} Transcription result
   */
  async transcribeWithDeepgram(fileData, options, jobId = 'N/A') {
    try {
      console.log(`[DeepgramService:API_CALL_START][jobId:${jobId}] Transcribing with Deepgram. Options:`, sanitizeForLogging(options));

      // Ensure Deepgram client is configured
      this.ensureConfigured(); // This will throw if not configured

      const {
        result,
        error: dgError
      } = await this.deepgram.listen.prerecorded.transcribeFile(fileData,
      // This should be a Buffer
      options);
      if (dgError) {
        console.error(`[DeepgramService:API_ERROR][jobId:${jobId}] Deepgram transcription error:`, sanitizeForLogging(dgError));
        // Attempt to get more details from the error object if it's structured
        let errorMessage = `Deepgram API error: ${dgError.message || 'Unknown error'}`;
        if (dgError.status) errorMessage += ` (Status: ${dgError.status})`;
        if (dgError.body && typeof dgError.body === 'object') {
          errorMessage += ` Details: ${JSON.stringify(sanitizeForLogging(dgError.body))}`;
        } else if (dgError.body) {
          errorMessage += ` Body: ${String(dgError.body).substring(0, 200)}`;
        }
        throw new Error(errorMessage);
      }
      if (!result) {
        console.error(`[DeepgramService:API_NO_RESULT][jobId:${jobId}] Deepgram API returned no result object.`);
        throw new Error('Deepgram API returned no result.');
      }
      console.log(`[DeepgramService:API_SUCCESS][jobId:${jobId}] Transcription successful. Result summary:`, sanitizeForLogging({
        channels: result.results?.channels?.length,
        metadataDuration: result.metadata?.duration
      }));
      return result;
    } catch (error) {
      // Catch and re-throw with more context if it's not already a detailed error
      const errorMessage = error.message || 'Unknown error during Deepgram transcription';
      console.error(`[DeepgramService:TRANSCRIBE_EXCEPTION][jobId:${jobId}] Error in Deepgram transcription:`, sanitizeForLogging(error));
      if (error.message && error.message.startsWith('Deepgram API error:')) {
        throw error; // Already a detailed error from above
      }
      throw new Error(`Transcription call failed: ${errorMessage}`);
    }
  }

  /**
   * Format Deepgram transcription result
   * @param {Object} rawResult - Raw Deepgram result
   * @param {Object} options - Formatting options
   * @returns {Object} Formatted result
   */
  formatTranscriptionResult(rawResult, options, jobId = 'N/A') {
    try {
      console.log(`[DeepgramService:FORMATTING_RESULT][jobId:${jobId}] Raw result:`, sanitizeForLogging(rawResult));
      let transcript = '';
      if (rawResult && rawResult.results && rawResult.results.channels && rawResult.results.channels.length > 0) {
        const channel = rawResult.results.channels[0];
        if (channel.alternatives && channel.alternatives.length > 0) {
          transcript = channel.alternatives[0].transcript || '';
          if (channel.alternatives[0].paragraphs) {
            // If paragraphs are available (e.g., with diarize: true), construct transcript from them
            transcript = channel.alternatives[0].paragraphs.transcript || transcript;
          }
        }
      } else {
        console.warn(`[DeepgramService:FORMATTING_WARN][jobId:${jobId}] Unexpected raw result structure or empty result.`);
      }
      const metadata = rawResult.metadata || {};
      const duration = metadata.duration || 0;
      const language = options.language || metadata.language || 'en';
      const formatted = {
        text: transcript.trim(),
        language: language,
        duration: duration,
        model: options.model || settingsStore.get('transcription.model', 'nova-2'),
        provider: 'deepgram',
        rawResponse: options.includeRawResponse ? sanitizeForLogging(rawResult) : undefined
      };
      console.log(`[DeepgramService:FORMATTING_SUCCESS][jobId:${jobId}] Formatted result:`, sanitizeForLogging(formatted));
      return formatted;
    } catch (error) {
      const errorMessage = error.message || 'Unknown error formatting result';
      console.error(`[DeepgramService:FORMATTING_ERROR][jobId:${jobId}] Error formatting transcription result:`, sanitizeForLogging(error));
      throw new Error(`Failed to format transcription result: ${errorMessage}`);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiY3JlYXRlQ2xpZW50IiwiQnVmZmVyIiwidjQiLCJ1dWlkdjQiLCJCYXNlU2VydmljZSIsImNyZWF0ZVN0b3JlIiwiYXBpS2V5U2VydmljZSIsIk1BWF9DSFVOS19TSVpFIiwic2FuaXRpemVGb3JMb2dnaW5nIiwib2JqIiwidmlzaXRlZCIsIlNldCIsImhhcyIsImFkZCIsImlzQnVmZmVyIiwibGVuZ3RoIiwiQXJyYXkiLCJpc0FycmF5IiwibWFwIiwiaXRlbSIsInNhbml0aXplZCIsImtleSIsInZhbHVlIiwiT2JqZWN0IiwiZW50cmllcyIsImRlbGV0ZSIsInNldHRpbmdzU3RvcmUiLCJEZWVwZ3JhbVNlcnZpY2UiLCJjb25zdHJ1Y3RvciIsInNraXBIYW5kbGVyU2V0dXAiLCJkZWVwZ3JhbSIsImZpbGVTdG9yYWdlIiwiYWN0aXZlSm9icyIsIk1hcCIsIm1hbnVhbFNldHVwSXBjSGFuZGxlcnMiLCJoYW5kbGVyTWV0aG9kcyIsImhhbmRsZVRyYW5zY3JpYmVTdGFydCIsImJpbmQiLCJoYW5kbGVUcmFuc2NyaWJlU3RhdHVzIiwiaGFuZGxlVHJhbnNjcmliZUNhbmNlbCIsImhhbmRsZUNvbmZpZ3VyZSIsImNoYW5uZWwiLCJoYW5kbGVyIiwiaXNIYW5kbGVyUmVnaXN0ZXJlZCIsImNvbnNvbGUiLCJsb2ciLCJyZWdpc3RlckhhbmRsZXIiLCJlcnJvciIsImlwY01haW4iLCJfZXZlbnRzIiwiZXJyIiwic2V0dXBJcGNIYW5kbGVycyIsImV2ZW50IiwiYXBpS2V5IiwiRXJyb3IiLCJzdWNjZXNzIiwibWVzc2FnZSIsImVuc3VyZUNvbmZpZ3VyZWQiLCJkaXJlY3RLZXkiLCJnZXQiLCJuZXN0ZWRLZXkiLCJhcGlLZXlTZXJ2aWNlS2V5IiwiZ2V0QXBpS2V5Iiwic2V0IiwiY3VycmVudFRyYW5zY3JpcHRpb24iLCJkZWVwZ3JhbUFwaUtleSIsInNhdmVBcGlLZXkiLCJzYXZlRXJyb3IiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJqb2JJZCIsInRlbXBEaXIiLCJjcmVhdGVUZW1wRGlyIiwic3RhdHVzIiwicHJvZ3Jlc3MiLCJ3aW5kb3ciLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJwcm9jZXNzVHJhbnNjcmlwdGlvbiIsImNhdGNoIiwiZXJyb3JNZXNzYWdlIiwidXBkYXRlSm9iU3RhdHVzIiwiZGV0YWlscyIsImpvYiIsInJlbW92ZSIsInBhdGhFeGlzdHMiLCJzdGF0cyIsInN0YXQiLCJmaWxlRXh0IiwiZXh0bmFtZSIsInRvTG93ZXJDYXNlIiwiZmlsZVNpemVNQiIsInNpemUiLCJpc1ZpZGVvIiwiaW5jbHVkZXMiLCJtZWRpYVR5cGUiLCJ0b0ZpeGVkIiwiZmlsZURhdGEiLCJyZWFkRmlsZSIsIm1vZGVsIiwidHJhbnNjcmlwdGlvblJlc3VsdCIsInRyYW5zY3JpYmVXaXRoRGVlcGdyYW0iLCJzbWFydF9mb3JtYXQiLCJwdW5jdHVhdGUiLCJkaWFyaXplIiwidXR0ZXJhbmNlcyIsImxhbmd1YWdlIiwiZGVlcGdyYW1PcHRpb25zIiwicmVzdWx0IiwiZm9ybWF0VHJhbnNjcmlwdGlvblJlc3VsdCIsImpvYkRhdGEiLCJ3YXJuIiwibmFtZSIsImNvZGUiLCJkZ0Vycm9yIiwibGlzdGVuIiwicHJlcmVjb3JkZWQiLCJ0cmFuc2NyaWJlRmlsZSIsImJvZHkiLCJKU09OIiwic3RyaW5naWZ5IiwiU3RyaW5nIiwic3Vic3RyaW5nIiwiY2hhbm5lbHMiLCJyZXN1bHRzIiwibWV0YWRhdGFEdXJhdGlvbiIsIm1ldGFkYXRhIiwiZHVyYXRpb24iLCJzdGFydHNXaXRoIiwicmF3UmVzdWx0IiwidHJhbnNjcmlwdCIsImFsdGVybmF0aXZlcyIsInBhcmFncmFwaHMiLCJmb3JtYXR0ZWQiLCJ0ZXh0IiwidHJpbSIsInByb3ZpZGVyIiwicmF3UmVzcG9uc2UiLCJpbmNsdWRlUmF3UmVzcG9uc2UiLCJ1bmRlZmluZWQiLCJhc3NpZ24iLCJ3ZWJDb250ZW50cyIsInNlbmQiLCJkZWVwZ3JhbVNlcnZpY2VJbnN0YW5jZSIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvYWkvRGVlcGdyYW1TZXJ2aWNlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBEZWVwZ3JhbVNlcnZpY2UuanNcclxuICogSGFuZGxlcyBhdWRpbyBhbmQgdmlkZW8gdHJhbnNjcmlwdGlvbiBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzIHVzaW5nIERlZXBncmFtLlxyXG4gKlxyXG4gKiBUaGlzIHNlcnZpY2UgaGFuZGxlczpcclxuICogLSBBdWRpbyBhbmQgdmlkZW8gZmlsZSB0cmFuc2NyaXB0aW9uXHJcbiAqIC0gQ2h1bmtpbmcgZm9yIGxhcmdlIGZpbGVzXHJcbiAqIC0gUmVzdWx0IGZvcm1hdHRpbmdcclxuICpcclxuICogUmVsYXRlZCBGaWxlczpcclxuICogLSBCYXNlU2VydmljZS5qczogUGFyZW50IGNsYXNzIHByb3ZpZGluZyBJUEMgaGFuZGxpbmdcclxuICogLSBGaWxlU3RvcmFnZVNlcnZpY2UuanM6IEZvciB0ZW1wb3JhcnkgZmlsZSBtYW5hZ2VtZW50XHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCB7IGNyZWF0ZUNsaWVudCB9ID0gcmVxdWlyZSgnQGRlZXBncmFtL3NkaycpO1xyXG5jb25zdCB7IEJ1ZmZlciB9ID0gcmVxdWlyZSgnbm9kZTpidWZmZXInKTtcclxuY29uc3QgeyB2NDogdXVpZHY0IH0gPSByZXF1aXJlKCd1dWlkJyk7XHJcbmNvbnN0IEJhc2VTZXJ2aWNlID0gcmVxdWlyZSgnLi4vQmFzZVNlcnZpY2UnKTtcclxuY29uc3QgeyBjcmVhdGVTdG9yZSB9ID0gcmVxdWlyZSgnLi4vLi4vdXRpbHMvc3RvcmVGYWN0b3J5Jyk7XHJcbmNvbnN0IGFwaUtleVNlcnZpY2UgPSByZXF1aXJlKCcuLi9BcGlLZXlTZXJ2aWNlJyk7XHJcblxyXG4vLyBNYXggY2h1bmsgc2l6ZSBmb3IgZmlsZXMgKDEwME1CKVxyXG5jb25zdCBNQVhfQ0hVTktfU0laRSA9IDEwMCAqIDEwMjQgKiAxMDI0O1xyXG5cclxuLy8gVXRpbGl0eSB0byBzYW5pdGl6ZSBvYmplY3RzIGZvciBsb2dnaW5nLCBlc3BlY2lhbGx5IHRvIGhhbmRsZSBCdWZmZXJzXHJcbmZ1bmN0aW9uIHNhbml0aXplRm9yTG9nZ2luZyhvYmosIHZpc2l0ZWQgPSBuZXcgU2V0KCkpIHtcclxuICBpZiAob2JqID09PSBudWxsIHx8IHR5cGVvZiBvYmogIT09ICdvYmplY3QnIHx8IHZpc2l0ZWQuaGFzKG9iaikpIHtcclxuICAgIHJldHVybiBvYmo7XHJcbiAgfVxyXG5cclxuICB2aXNpdGVkLmFkZChvYmopO1xyXG5cclxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKG9iaikpIHtcclxuICAgIHJldHVybiBgW0J1ZmZlciBsZW5ndGg6ICR7b2JqLmxlbmd0aH1dYDtcclxuICB9XHJcblxyXG4gIGlmIChBcnJheS5pc0FycmF5KG9iaikpIHtcclxuICAgIHJldHVybiBvYmoubWFwKGl0ZW0gPT4gc2FuaXRpemVGb3JMb2dnaW5nKGl0ZW0sIG5ldyBTZXQodmlzaXRlZCkpKTtcclxuICB9XHJcblxyXG4gIGNvbnN0IHNhbml0aXplZCA9IHt9O1xyXG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKG9iaikpIHtcclxuICAgIHNhbml0aXplZFtrZXldID0gc2FuaXRpemVGb3JMb2dnaW5nKHZhbHVlLCBuZXcgU2V0KHZpc2l0ZWQpKTtcclxuICB9XHJcbiAgXHJcbiAgdmlzaXRlZC5kZWxldGUob2JqKTtcclxuICByZXR1cm4gc2FuaXRpemVkO1xyXG59XHJcblxyXG4vLyBTZXR0aW5ncyBzdG9yZVxyXG5jb25zdCBzZXR0aW5nc1N0b3JlID0gY3JlYXRlU3RvcmUoJ3NldHRpbmdzJyk7XHJcblxyXG5jbGFzcyBEZWVwZ3JhbVNlcnZpY2UgZXh0ZW5kcyBCYXNlU2VydmljZSB7XHJcbiAgICBjb25zdHJ1Y3RvcigpIHtcclxuICAgICAgICAvLyBQYXNzIG9wdGlvbnMgdG8gQmFzZVNlcnZpY2UgY29uc3RydWN0b3JcclxuICAgICAgICBzdXBlcih7IHNraXBIYW5kbGVyU2V0dXA6IHRydWUgfSk7XHJcblxyXG4gICAgICAgIC8vIFNldCBpbnN0YW5jZSBwcm9wZXJ0aWVzXHJcbiAgICAgICAgdGhpcy5kZWVwZ3JhbSA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5maWxlU3RvcmFnZSA9IHJlcXVpcmUoJy4uL3N0b3JhZ2UvRmlsZVN0b3JhZ2VTZXJ2aWNlJyk7XHJcbiAgICAgICAgdGhpcy5hY3RpdmVKb2JzID0gbmV3IE1hcCgpO1xyXG5cclxuICAgICAgICAvLyBNYW51YWwgc2V0dXAgd2l0aCBkdXBsaWNhdGUgcmVnaXN0cmF0aW9uIHByZXZlbnRpb25cclxuICAgICAgICB0aGlzLm1hbnVhbFNldHVwSXBjSGFuZGxlcnMoKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIE1hbnVhbGx5IHNldCB1cCBJUEMgaGFuZGxlcnMgd2l0aCBkdXBsaWNhdGUgcmVnaXN0cmF0aW9uIHByZXZlbnRpb25cclxuICAgICAqL1xyXG4gICAgbWFudWFsU2V0dXBJcGNIYW5kbGVycygpIHtcclxuICAgICAgICBjb25zdCBoYW5kbGVyTWV0aG9kcyA9IHtcclxuICAgICAgICAgICAgJ3RyYW5zY3JpYmU6c3RhcnQnOiB0aGlzLmhhbmRsZVRyYW5zY3JpYmVTdGFydC5iaW5kKHRoaXMpLFxyXG4gICAgICAgICAgICAndHJhbnNjcmliZTpzdGF0dXMnOiB0aGlzLmhhbmRsZVRyYW5zY3JpYmVTdGF0dXMuYmluZCh0aGlzKSxcclxuICAgICAgICAgICAgJ3RyYW5zY3JpYmU6Y2FuY2VsJzogdGhpcy5oYW5kbGVUcmFuc2NyaWJlQ2FuY2VsLmJpbmQodGhpcyksXHJcbiAgICAgICAgICAgICdkZWVwZ3JhbTpjb25maWd1cmUnOiB0aGlzLmhhbmRsZUNvbmZpZ3VyZS5iaW5kKHRoaXMpXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgZm9yIChjb25zdCBbY2hhbm5lbCwgaGFuZGxlcl0gb2YgT2JqZWN0LmVudHJpZXMoaGFuZGxlck1ldGhvZHMpKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5pc0hhbmRsZXJSZWdpc3RlcmVkKGNoYW5uZWwpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2VdIEhhbmRsZXIgZm9yICR7Y2hhbm5lbH0gYWxyZWFkeSByZWdpc3RlcmVkLCBza2lwcGluZ2ApO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcihjaGFubmVsLCBoYW5kbGVyKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtEZWVwZ3JhbVNlcnZpY2VdIEVycm9yIHNldHRpbmcgdXAgaGFuZGxlciBmb3IgJHtjaGFubmVsfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVjayBpZiBhbiBJUEMgaGFuZGxlciBpcyBhbHJlYWR5IHJlZ2lzdGVyZWRcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjaGFubmVsIC0gVGhlIGNoYW5uZWwgdG8gY2hlY2tcclxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBoYW5kbGVyIGlzIHJlZ2lzdGVyZWRcclxuICAgICAqL1xyXG4gICAgaXNIYW5kbGVyUmVnaXN0ZXJlZChjaGFubmVsKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgeyBpcGNNYWluIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG4gICAgICAgICAgICAvLyBXZSBjYW4ndCBkaXJlY3RseSBjaGVjayBmb3IgaGFuZGxlciBleGlzdGVuY2UgaW4gYSByZWxpYWJsZSB3YXlcclxuICAgICAgICAgICAgLy8gVGhpcyBpcyBhIGJlc3QgZWZmb3J0IGF0dGVtcHRcclxuICAgICAgICAgICAgcmV0dXJuIGlwY01haW4uX2V2ZW50cyAmJiBpcGNNYWluLl9ldmVudHNbYGhhbmRsZS0ke2NoYW5uZWx9YF07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTZXQgdXAgSVBDIGhhbmRsZXJzIGZvciB0cmFuc2NyaXB0aW9uIG9wZXJhdGlvbnNcclxuICAgICAqL1xyXG4gICAgc2V0dXBJcGNIYW5kbGVycygpIHtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcigndHJhbnNjcmliZTpzdGFydCcsIHRoaXMuaGFuZGxlVHJhbnNjcmliZVN0YXJ0LmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCd0cmFuc2NyaWJlOnN0YXR1cycsIHRoaXMuaGFuZGxlVHJhbnNjcmliZVN0YXR1cy5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcigndHJhbnNjcmliZTpjYW5jZWwnLCB0aGlzLmhhbmRsZVRyYW5zY3JpYmVDYW5jZWwuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2RlZXBncmFtOmNvbmZpZ3VyZScsIHRoaXMuaGFuZGxlQ29uZmlndXJlLmJpbmQodGhpcykpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ29uZmlndXJlIERlZXBncmFtIHdpdGggQVBJIGtleVxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIENvbmZpZ3VyYXRpb24gcmVxdWVzdFxyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDb25maWd1cmUoZXZlbnQsIHsgYXBpS2V5IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBDcmVhdGUgRGVlcGdyYW0gY2xpZW50IHdpdGggQVBJIGtleVxyXG4gICAgICAgICAgICB0aGlzLmRlZXBncmFtID0gY3JlYXRlQ2xpZW50KGFwaUtleSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBUZXN0IHRoZSBjb25uZWN0aW9uIHdpdGggYSBzaW1wbGUgcmVxdWVzdFxyXG4gICAgICAgICAgICAvLyBKdXN0IGNoZWNraW5nIGlmIHRoZSBjbGllbnQgaXMgd29ya2luZywgbm90IGFjdHVhbGx5IG1ha2luZyBhIHRyYW5zY3JpcHRpb25cclxuICAgICAgICAgICAgaWYgKCF0aGlzLmRlZXBncmFtKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBpbml0aWFsaXplIERlZXBncmFtIGNsaWVudCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW0RlZXBncmFtU2VydmljZV0gU3VjY2Vzc2Z1bGx5IGNvbmZpZ3VyZWQgd2l0aCBBUEkga2V5Jyk7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRGVlcGdyYW1TZXJ2aWNlXSBDb25maWd1cmF0aW9uIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNvbmZpZ3VyZSBEZWVwZ3JhbTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEVuc3VyZSBEZWVwZ3JhbSBpcyBjb25maWd1cmVkIHdpdGggYW4gQVBJIGtleVxyXG4gICAgICogTG9hZHMgdGhlIGtleSBmcm9tIHNldHRpbmdzIGlmIG5vdCBhbHJlYWR5IGNvbmZpZ3VyZWRcclxuICAgICAqIEVuaGFuY2VkIHdpdGggYmV0dGVyIGRlYnVnZ2luZyBhbmQgZmFsbGJhY2sgb3B0aW9uc1xyXG4gICAgICovXHJcbiAgICBlbnN1cmVDb25maWd1cmVkKCkge1xyXG4gICAgICAgIGlmICghdGhpcy5kZWVwZ3JhbSkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW0RlZXBncmFtU2VydmljZV0gQ29uZmlndXJpbmcgRGVlcGdyYW0gY2xpZW50Li4uJyk7XHJcblxyXG4gICAgICAgICAgICAvLyBUcnkgbXVsdGlwbGUgcG90ZW50aWFsIGtleSBsb2NhdGlvbnMgd2l0aCBkZXRhaWxlZCBsb2dnaW5nXHJcbiAgICAgICAgICAgIGNvbnN0IGRpcmVjdEtleSA9IHNldHRpbmdzU3RvcmUuZ2V0KCdkZWVwZ3JhbUFwaUtleScpO1xyXG4gICAgICAgICAgICBjb25zdCBuZXN0ZWRLZXkgPSBzZXR0aW5nc1N0b3JlLmdldCgndHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleScpO1xyXG4gICAgICAgICAgICBjb25zdCBhcGlLZXlTZXJ2aWNlS2V5ID0gcmVxdWlyZSgnLi4vQXBpS2V5U2VydmljZScpLmdldEFwaUtleSgnZGVlcGdyYW0nKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlXSBBUEkgS2V5IHNvdXJjZXM6XHJcbiAgICAgICAgICAgICAgLSBEaXJlY3QgcGF0aCAoZGVlcGdyYW1BcGlLZXkpOiAke2RpcmVjdEtleSA/ICdGb3VuZCAobGVuZ3RoOiAnICsgZGlyZWN0S2V5Lmxlbmd0aCArICcpJyA6ICdOb3QgZm91bmQnfVxyXG4gICAgICAgICAgICAgIC0gTmVzdGVkIHBhdGggKHRyYW5zY3JpcHRpb24uZGVlcGdyYW1BcGlLZXkpOiAke25lc3RlZEtleSA/ICdGb3VuZCAobGVuZ3RoOiAnICsgbmVzdGVkS2V5Lmxlbmd0aCArICcpJyA6ICdOb3QgZm91bmQnfVxyXG4gICAgICAgICAgICAgIC0gQXBpS2V5U2VydmljZTogJHthcGlLZXlTZXJ2aWNlS2V5ID8gJ0ZvdW5kIChsZW5ndGg6ICcgKyBhcGlLZXlTZXJ2aWNlS2V5Lmxlbmd0aCArICcpJyA6ICdOb3QgZm91bmQnfWApO1xyXG5cclxuICAgICAgICAgICAgLy8gVXNlIHRoZSBmaXJzdCBhdmFpbGFibGUga2V5XHJcbiAgICAgICAgICAgIGNvbnN0IGFwaUtleSA9IGRpcmVjdEtleSB8fCBuZXN0ZWRLZXkgfHwgYXBpS2V5U2VydmljZUtleTtcclxuXHJcbiAgICAgICAgICAgIGlmIChhcGlLZXkpIHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2VdIENyZWF0aW5nIERlZXBncmFtIGNsaWVudCB3aXRoIGtleSAobGVuZ3RoOiAke2FwaUtleS5sZW5ndGh9KWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGVlcGdyYW0gPSBjcmVhdGVDbGllbnQoYXBpS2V5KTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVGVzdCBpZiB0aGUgY2xpZW50IHdhcyBjcmVhdGVkIHN1Y2Nlc3NmdWxseVxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5kZWVwZ3JhbSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBjcmVhdGUgRGVlcGdyYW0gY2xpZW50ICh1bmRlZmluZWQgcmVzdWx0KScpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tEZWVwZ3JhbVNlcnZpY2VdIFN1Y2Nlc3NmdWxseSBjb25maWd1cmVkIERlZXBncmFtIHdpdGggQVBJIGtleScpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBTYXZlIHRoZSBrZXkgdG8gZW5zdXJlIGl0J3MgaW4gYWxsIGV4cGVjdGVkIGxvY2F0aW9ucyBmb3IgZnV0dXJlIHVzZVxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZGlyZWN0S2V5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW0RlZXBncmFtU2VydmljZV0gU2F2aW5nIGtleSB0byBkaXJlY3QgcGF0aCBmb3IgZnV0dXJlIHVzZScpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0dGluZ3NTdG9yZS5zZXQoJ2RlZXBncmFtQXBpS2V5JywgYXBpS2V5KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFuZXN0ZWRLZXkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbRGVlcGdyYW1TZXJ2aWNlXSBTYXZpbmcga2V5IHRvIG5lc3RlZCBwYXRoIGZvciBmdXR1cmUgdXNlJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50VHJhbnNjcmlwdGlvbiA9IHNldHRpbmdzU3RvcmUuZ2V0KCd0cmFuc2NyaXB0aW9uJykgfHwge307XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdXJyZW50VHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleSA9IGFwaUtleTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldHRpbmdzU3RvcmUuc2V0KCd0cmFuc2NyaXB0aW9uJywgY3VycmVudFRyYW5zY3JpcHRpb24pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWFwaUtleVNlcnZpY2VLZXkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbRGVlcGdyYW1TZXJ2aWNlXSBTYXZpbmcga2V5IHRvIEFwaUtleVNlcnZpY2UgZm9yIGZ1dHVyZSB1c2UnKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVpcmUoJy4uL0FwaUtleVNlcnZpY2UnKS5zYXZlQXBpS2V5KGFwaUtleSwgJ2RlZXBncmFtJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChzYXZlRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gSnVzdCBsb2cgdGhlIGVycm9yIGJ1dCBjb250aW51ZSB1c2luZyB0aGUgY3VycmVudCBrZXlcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0RlZXBncmFtU2VydmljZV0gRXJyb3Igc2F2aW5nIGtleSB0byBhbGwgbG9jYXRpb25zOicsIHNhdmVFcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRGVlcGdyYW1TZXJ2aWNlXSBGYWlsZWQgdG8gY29uZmlndXJlIHdpdGggQVBJIGtleTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY29uZmlndXJlIERlZXBncmFtOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRGVlcGdyYW1TZXJ2aWNlXSBObyBBUEkga2V5IGZvdW5kIGluIGFueSBsb2NhdGlvbicpO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdEZWVwZ3JhbSBBUEkgbm90IGNvbmZpZ3VyZWQuIFBsZWFzZSBzZXQgYW4gQVBJIGtleSBpbiBTZXR0aW5ncyDihpIgVHJhbnNjcmlwdGlvbi4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbRGVlcGdyYW1TZXJ2aWNlXSBEZWVwZ3JhbSBjbGllbnQgYWxyZWFkeSBjb25maWd1cmVkJyk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIHRyYW5zY3JpcHRpb24gc3RhcnQgcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFRyYW5zY3JpcHRpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZVRyYW5zY3JpYmVTdGFydChldmVudCwgeyBmaWxlUGF0aCwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICB0aGlzLmVuc3VyZUNvbmZpZ3VyZWQoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGpvYklkID0gdXVpZHY0KCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ3RyYW5zY3JpcHRpb24nKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlOlNUQVJUSU5HXVtqb2JJZDoke2pvYklkfV0gU3RhcnRpbmcgdHJhbnNjcmlwdGlvbiBmb3IgZmlsZTogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2U6U1RBUlRJTkddW2pvYklkOiR7am9iSWR9XSBPcHRpb25zOmAsIHNhbml0aXplRm9yTG9nZ2luZyhvcHRpb25zKSk7XHJcblxyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUpvYnMuc2V0KGpvYklkLCB7XHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdwcmVwYXJpbmcnLFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDAsXHJcbiAgICAgICAgICAgICAgICBmaWxlUGF0aCxcclxuICAgICAgICAgICAgICAgIHRlbXBEaXIsXHJcbiAgICAgICAgICAgICAgICAvLyBHZXQgd2luZG93IG9ubHkgaWYgZXZlbnQgYW5kIHNlbmRlciBleGlzdCAoY2FsbGVkIHZpYSBJUEMpXHJcbiAgICAgICAgICAgICAgICB3aW5kb3c6IGV2ZW50ICYmIGV2ZW50LnNlbmRlciA/IGV2ZW50LnNlbmRlci5nZXRPd25lckJyb3dzZXJXaW5kb3coKSA6IG51bGxcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBTdGFydCB0cmFuc2NyaXB0aW9uIHByb2Nlc3NcclxuICAgICAgICAgICAgdGhpcy5wcm9jZXNzVHJhbnNjcmlwdGlvbihqb2JJZCwgZmlsZVBhdGgsIG9wdGlvbnMpLmNhdGNoKGVycm9yID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yLm1lc3NhZ2UgfHwgJ1Vua25vd24gdHJhbnNjcmlwdGlvbiBlcnJvcic7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbRGVlcGdyYW1TZXJ2aWNlOkZBSUxFRF1bam9iSWQ6JHtqb2JJZH1dIFRyYW5zY3JpcHRpb24gZmFpbGVkOmAsIHNhbml0aXplRm9yTG9nZ2luZyhlcnJvcikpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVKb2JTdGF0dXMoam9iSWQsICdmYWlsZWQnLCB7IGVycm9yOiBlcnJvck1lc3NhZ2UsIGRldGFpbHM6IHNhbml0aXplRm9yTG9nZ2luZyhlcnJvcikgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHsgam9iSWQgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlIHx8ICdVbmtub3duIGVycm9yIHN0YXJ0aW5nIHRyYW5zY3JpcHRpb24nO1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRGVlcGdyYW1TZXJ2aWNlOkZBSUxFRF0gRmFpbGVkIHRvIHN0YXJ0IHRyYW5zY3JpcHRpb246Jywgc2FuaXRpemVGb3JMb2dnaW5nKGVycm9yKSk7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSB0cmFuc2NyaXB0aW9uIHN0YXR1cyByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gU3RhdHVzIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVUcmFuc2NyaWJlU3RhdHVzKGV2ZW50LCB7IGpvYklkIH0pIHtcclxuICAgICAgICBjb25zdCBqb2IgPSB0aGlzLmFjdGl2ZUpvYnMuZ2V0KGpvYklkKTtcclxuICAgICAgICByZXR1cm4gam9iIHx8IHsgc3RhdHVzOiAnbm90X2ZvdW5kJyB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIHRyYW5zY3JpcHRpb24gY2FuY2VsbGF0aW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDYW5jZWxsYXRpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZVRyYW5zY3JpYmVDYW5jZWwoZXZlbnQsIHsgam9iSWQgfSkge1xyXG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuYWN0aXZlSm9icy5nZXQoam9iSWQpO1xyXG4gICAgICAgIGlmIChqb2IpIHtcclxuICAgICAgICAgICAgam9iLnN0YXR1cyA9ICdjYW5jZWxsZWQnO1xyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wb3JhcnkgZmlsZXNcclxuICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGpvYi50ZW1wRGlyKTtcclxuICAgICAgICAgICAgdGhpcy5hY3RpdmVKb2JzLmRlbGV0ZShqb2JJZCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgdHJhbnNjcmlwdGlvbiBqb2JcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIG1lZGlhIGZpbGVcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gVHJhbnNjcmlwdGlvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NUcmFuc2NyaXB0aW9uKGpvYklkLCBmaWxlUGF0aCwgb3B0aW9ucykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSm9iU3RhdHVzKGpvYklkLCAncHJlcGFyaW5nJywgeyBwcm9ncmVzczogNSB9KTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2U6UFJFUEFSSU5HXVtqb2JJZDoke2pvYklkfV0gUHJvY2Vzc2luZyBqb2IgZm9yIGZpbGU6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlOlBSRVBBUklOR11bam9iSWQ6JHtqb2JJZH1dIE9wdGlvbnM6YCwgc2FuaXRpemVGb3JMb2dnaW5nKG9wdGlvbnMpKTtcclxuXHJcbiAgICAgICAgICAgIC8vIFZlcmlmeSBmaWxlIGV4aXN0c1xyXG4gICAgICAgICAgICBpZiAoIWF3YWl0IGZzLnBhdGhFeGlzdHMoZmlsZVBhdGgpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbRGVlcGdyYW1TZXJ2aWNlOlZBTElEQVRJT05fRkFJTEVEXVtqb2JJZDoke2pvYklkfV0gRmlsZSBub3QgZm91bmQ6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZpbGUgbm90IGZvdW5kOiAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSm9iU3RhdHVzKGpvYklkLCAndmFsaWRhdGluZycsIHsgcHJvZ3Jlc3M6IDEwIH0pO1xyXG5cclxuICAgICAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgY29uc3QgZmlsZUV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICAgICAgY29uc3QgZmlsZVNpemVNQiA9IHN0YXRzLnNpemUgLyAoMTAyNCAqIDEwMjQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgaXNWaWRlbyA9IG9wdGlvbnMuaXNWaWRlbyB8fCBbJy5tcDQnLCAnLmF2aScsICcubW92JywgJy5ta3YnLCAnLndlYm0nXS5pbmNsdWRlcyhmaWxlRXh0KTtcclxuICAgICAgICAgICAgY29uc3QgbWVkaWFUeXBlID0gb3B0aW9ucy5tZWRpYVR5cGUgfHwgKGlzVmlkZW8gPyAndmlkZW8nIDogJ2F1ZGlvJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0RlZXBncmFtU2VydmljZTpJTkZPXVtqb2JJZDoke2pvYklkfV0gRmlsZSBpbmZvOiB0eXBlPSR7bWVkaWFUeXBlfSwgZXh0PSR7ZmlsZUV4dH0sIHNpemU9JHtmaWxlU2l6ZU1CLnRvRml4ZWQoMil9TUJgKTtcclxuXHJcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIGZpbGUgc2l6ZSBleGNlZWRzIERlZXBncmFtJ3MgbGltaXQgKDJHQilcclxuICAgICAgICAgICAgaWYgKHN0YXRzLnNpemUgPiAyICogMTAyNCAqIDEwMjQgKiAxMDI0KSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbRGVlcGdyYW1TZXJ2aWNlOlZBTElEQVRJT05fRkFJTEVEXVtqb2JJZDoke2pvYklkfV0gRmlsZSBzaXplICgke2ZpbGVTaXplTUIudG9GaXhlZCgyKX1NQikgZXhjZWVkcyBEZWVwZ3JhbSdzIDJHQiBsaW1pdC5gKTtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmlsZSBzaXplIGV4Y2VlZHMgRGVlcGdyYW1cXCdzIDJHQiBsaW1pdCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSm9iU3RhdHVzKGpvYklkLCAncHJvY2Vzc2luZycsIHsgcHJvZ3Jlc3M6IDE1IH0pO1xyXG5cclxuICAgICAgICAgICAgLy8gUmVhZCB0aGUgZmlsZVxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0RlZXBncmFtU2VydmljZTpSRUFESU5HX0ZJTEVdW2pvYklkOiR7am9iSWR9XSBSZWFkaW5nIGZpbGUgY29udGVudC4uLmApO1xyXG4gICAgICAgICAgICBjb25zdCBmaWxlRGF0YSA9IGF3YWl0IGZzLnJlYWRGaWxlKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2U6UkVBRElOR19GSUxFXVtqb2JJZDoke2pvYklkfV0gRmlsZSByZWFkIHN1Y2Nlc3NmdWxseSAoQnVmZmVyIGxlbmd0aDogJHtmaWxlRGF0YS5sZW5ndGh9KWApO1xyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUpvYlN0YXR1cyhqb2JJZCwgJ3RyYW5zY3JpYmluZycsIHsgcHJvZ3Jlc3M6IDMwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IHRyYW5zY3JpcHRpb24gbW9kZWwgZnJvbSBzZXR0aW5ncyBvciB1c2UgZGVmYXVsdFxyXG4gICAgICAgICAgICBjb25zdCBtb2RlbCA9IHNldHRpbmdzU3RvcmUuZ2V0KCd0cmFuc2NyaXB0aW9uLm1vZGVsJywgJ25vdmEtMicpOyAvLyBDaGFuZ2VkIGRlZmF1bHQgdG8gbm92YS0yIGZvciBicm9hZGVyIGNvbXBhdGliaWxpdHlcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlOlRSQU5TQ1JJQklOR11bam9iSWQ6JHtqb2JJZH1dIFNlbmRpbmcgZmlsZSB0byBEZWVwZ3JhbSBBUEkgdXNpbmcgbW9kZWw6ICR7bW9kZWx9YCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHRyYW5zY3JpcHRpb25SZXN1bHQgPSBhd2FpdCB0aGlzLnRyYW5zY3JpYmVXaXRoRGVlcGdyYW0oXHJcbiAgICAgICAgICAgICAgICBmaWxlRGF0YSwgXHJcbiAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWw6IG1vZGVsLFxyXG4gICAgICAgICAgICAgICAgICAgIHNtYXJ0X2Zvcm1hdDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBwdW5jdHVhdGU6IHRydWUsIC8vIEFkZGVkIGZvciBiZXR0ZXIgZm9ybWF0dGluZ1xyXG4gICAgICAgICAgICAgICAgICAgIGRpYXJpemU6IG9wdGlvbnMuZGlhcml6ZSB8fCBmYWxzZSwgLy8gU3BlYWtlciBkaWFyaXphdGlvblxyXG4gICAgICAgICAgICAgICAgICAgIHV0dGVyYW5jZXM6IG9wdGlvbnMudXR0ZXJhbmNlcyB8fCBmYWxzZSwgLy8gVXR0ZXJhbmNlIHNwbGl0dGluZ1xyXG4gICAgICAgICAgICAgICAgICAgIGxhbmd1YWdlOiBvcHRpb25zLmxhbmd1YWdlIHx8ICdlbicsXHJcbiAgICAgICAgICAgICAgICAgICAgLi4ub3B0aW9ucy5kZWVwZ3JhbU9wdGlvbnMgLy8gQWxsb3cgb3ZlcnJpZGluZyB3aXRoIHNwZWNpZmljIGRlZXBncmFtIG9wdGlvbnNcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBqb2JJZFxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVKb2JTdGF0dXMoam9iSWQsICdmb3JtYXR0aW5nJywgeyBwcm9ncmVzczogOTAgfSk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlOkZPUk1BVFRJTkddW2pvYklkOiR7am9iSWR9XSBGb3JtYXR0aW5nIHRyYW5zY3JpcHRpb24gcmVzdWx0Li4uYCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuZm9ybWF0VHJhbnNjcmlwdGlvblJlc3VsdCh0cmFuc2NyaXB0aW9uUmVzdWx0LCBvcHRpb25zKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZmlsZXNcclxuICAgICAgICAgICAgY29uc3Qgam9iRGF0YSA9IHRoaXMuYWN0aXZlSm9icy5nZXQoam9iSWQpO1xyXG4gICAgICAgICAgICBpZiAoam9iRGF0YSAmJiBqb2JEYXRhLnRlbXBEaXIpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZShqb2JEYXRhLnRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2U6Q0xFQU5VUF1bam9iSWQ6JHtqb2JJZH1dIENsZWFuZWQgdXAgdGVtcG9yYXJ5IGZpbGVzIGZyb206ICR7am9iRGF0YS50ZW1wRGlyfWApO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGBbRGVlcGdyYW1TZXJ2aWNlOkNMRUFOVVBfV0FSTl1bam9iSWQ6JHtqb2JJZH1dIE5vIHRlbXBEaXIgZm91bmQgZm9yIGNsZWFudXAuYCk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSm9iU3RhdHVzKGpvYklkLCAnY29tcGxldGVkJywgeyByZXN1bHQgfSk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlOkNPTVBMRVRFRF1bam9iSWQ6JHtqb2JJZH1dIFRyYW5zY3JpcHRpb24gY29tcGxldGVkIHN1Y2Nlc3NmdWxseS5gKTtcclxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlIHx8ICdVbmtub3duIHRyYW5zY3JpcHRpb24gcHJvY2Vzc2luZyBlcnJvcic7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtEZWVwZ3JhbVNlcnZpY2U6RkFJTEVEXVtqb2JJZDoke2pvYklkfV0gVHJhbnNjcmlwdGlvbiBwcm9jZXNzaW5nIGZhaWxlZDpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcoZXJyb3IpKTtcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVKb2JTdGF0dXMoam9iSWQsICdmYWlsZWQnLCB7IFxyXG4gICAgICAgICAgICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcclxuICAgICAgICAgICAgICAgIGRldGFpbHM6IHNhbml0aXplRm9yTG9nZ2luZyh7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogZXJyb3IubmFtZSxcclxuICAgICAgICAgICAgICAgICAgICBjb2RlOiBlcnJvci5jb2RlLFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIHN0YWNrOiBlcnJvci5zdGFjayAvLyBTdGFjayBjYW4gYmUgdmVyeSBsb25nLCBjb25zaWRlciBvbWl0dGluZyBvciB0cnVuY2F0aW5nIGZvciBnZW5lcmFsIGxvZ3NcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTsgLy8gUmUtdGhyb3cgdG8gYmUgY2F1Z2h0IGJ5IHRoZSBjYWxsZXJcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBUcmFuc2NyaWJlIGZpbGUgdXNpbmcgRGVlcGdyYW0gQVBJXHJcbiAgICAgKiBAcGFyYW0ge0J1ZmZlcn0gZmlsZURhdGEgLSBGaWxlIGJ1ZmZlclxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBUcmFuc2NyaXB0aW9uIG9wdGlvbnNcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IFRyYW5zY3JpcHRpb24gcmVzdWx0XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHRyYW5zY3JpYmVXaXRoRGVlcGdyYW0oZmlsZURhdGEsIG9wdGlvbnMsIGpvYklkID0gJ04vQScpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0RlZXBncmFtU2VydmljZTpBUElfQ0FMTF9TVEFSVF1bam9iSWQ6JHtqb2JJZH1dIFRyYW5zY3JpYmluZyB3aXRoIERlZXBncmFtLiBPcHRpb25zOmAsIHNhbml0aXplRm9yTG9nZ2luZyhvcHRpb25zKSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFbnN1cmUgRGVlcGdyYW0gY2xpZW50IGlzIGNvbmZpZ3VyZWRcclxuICAgICAgICAgICAgdGhpcy5lbnN1cmVDb25maWd1cmVkKCk7IC8vIFRoaXMgd2lsbCB0aHJvdyBpZiBub3QgY29uZmlndXJlZFxyXG5cclxuICAgICAgICAgICAgY29uc3QgeyByZXN1bHQsIGVycm9yOiBkZ0Vycm9yIH0gPSBhd2FpdCB0aGlzLmRlZXBncmFtLmxpc3Rlbi5wcmVyZWNvcmRlZC50cmFuc2NyaWJlRmlsZShcclxuICAgICAgICAgICAgICAgIGZpbGVEYXRhLCAvLyBUaGlzIHNob3VsZCBiZSBhIEJ1ZmZlclxyXG4gICAgICAgICAgICAgICAgb3B0aW9uc1xyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGRnRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtEZWVwZ3JhbVNlcnZpY2U6QVBJX0VSUk9SXVtqb2JJZDoke2pvYklkfV0gRGVlcGdyYW0gdHJhbnNjcmlwdGlvbiBlcnJvcjpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcoZGdFcnJvcikpO1xyXG4gICAgICAgICAgICAgICAgLy8gQXR0ZW1wdCB0byBnZXQgbW9yZSBkZXRhaWxzIGZyb20gdGhlIGVycm9yIG9iamVjdCBpZiBpdCdzIHN0cnVjdHVyZWRcclxuICAgICAgICAgICAgICAgIGxldCBlcnJvck1lc3NhZ2UgPSBgRGVlcGdyYW0gQVBJIGVycm9yOiAke2RnRXJyb3IubWVzc2FnZSB8fCAnVW5rbm93biBlcnJvcid9YDtcclxuICAgICAgICAgICAgICAgIGlmIChkZ0Vycm9yLnN0YXR1cykgZXJyb3JNZXNzYWdlICs9IGAgKFN0YXR1czogJHtkZ0Vycm9yLnN0YXR1c30pYDtcclxuICAgICAgICAgICAgICAgIGlmIChkZ0Vycm9yLmJvZHkgJiYgdHlwZW9mIGRnRXJyb3IuYm9keSA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlICs9IGAgRGV0YWlsczogJHtKU09OLnN0cmluZ2lmeShzYW5pdGl6ZUZvckxvZ2dpbmcoZGdFcnJvci5ib2R5KSl9YDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoZGdFcnJvci5ib2R5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlICs9IGAgQm9keTogJHtTdHJpbmcoZGdFcnJvci5ib2R5KS5zdWJzdHJpbmcoMCwyMDApfWA7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKCFyZXN1bHQpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtEZWVwZ3JhbVNlcnZpY2U6QVBJX05PX1JFU1VMVF1bam9iSWQ6JHtqb2JJZH1dIERlZXBncmFtIEFQSSByZXR1cm5lZCBubyByZXN1bHQgb2JqZWN0LmApO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdEZWVwZ3JhbSBBUEkgcmV0dXJuZWQgbm8gcmVzdWx0LicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0RlZXBncmFtU2VydmljZTpBUElfU1VDQ0VTU11bam9iSWQ6JHtqb2JJZH1dIFRyYW5zY3JpcHRpb24gc3VjY2Vzc2Z1bC4gUmVzdWx0IHN1bW1hcnk6YCwgXHJcbiAgICAgICAgICAgICAgICBzYW5pdGl6ZUZvckxvZ2dpbmcoeyBcclxuICAgICAgICAgICAgICAgICAgICBjaGFubmVsczogcmVzdWx0LnJlc3VsdHM/LmNoYW5uZWxzPy5sZW5ndGgsIFxyXG4gICAgICAgICAgICAgICAgICAgIG1ldGFkYXRhRHVyYXRpb246IHJlc3VsdC5tZXRhZGF0YT8uZHVyYXRpb24gXHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIC8vIENhdGNoIGFuZCByZS10aHJvdyB3aXRoIG1vcmUgY29udGV4dCBpZiBpdCdzIG5vdCBhbHJlYWR5IGEgZGV0YWlsZWQgZXJyb3JcclxuICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IubWVzc2FnZSB8fCAnVW5rbm93biBlcnJvciBkdXJpbmcgRGVlcGdyYW0gdHJhbnNjcmlwdGlvbic7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtEZWVwZ3JhbVNlcnZpY2U6VFJBTlNDUklCRV9FWENFUFRJT05dW2pvYklkOiR7am9iSWR9XSBFcnJvciBpbiBEZWVwZ3JhbSB0cmFuc2NyaXB0aW9uOmAsIHNhbml0aXplRm9yTG9nZ2luZyhlcnJvcikpO1xyXG4gICAgICAgICAgICBpZiAoZXJyb3IubWVzc2FnZSAmJiBlcnJvci5tZXNzYWdlLnN0YXJ0c1dpdGgoJ0RlZXBncmFtIEFQSSBlcnJvcjonKSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7IC8vIEFscmVhZHkgYSBkZXRhaWxlZCBlcnJvciBmcm9tIGFib3ZlXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUcmFuc2NyaXB0aW9uIGNhbGwgZmFpbGVkOiAke2Vycm9yTWVzc2FnZX1gKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBGb3JtYXQgRGVlcGdyYW0gdHJhbnNjcmlwdGlvbiByZXN1bHRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByYXdSZXN1bHQgLSBSYXcgRGVlcGdyYW0gcmVzdWx0XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIEZvcm1hdHRpbmcgb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge09iamVjdH0gRm9ybWF0dGVkIHJlc3VsdFxyXG4gICAgICovXHJcbiAgICBmb3JtYXRUcmFuc2NyaXB0aW9uUmVzdWx0KHJhd1Jlc3VsdCwgb3B0aW9ucywgam9iSWQgPSAnTi9BJykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlOkZPUk1BVFRJTkdfUkVTVUxUXVtqb2JJZDoke2pvYklkfV0gUmF3IHJlc3VsdDpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcocmF3UmVzdWx0KSk7XHJcbiAgICAgICAgICAgIGxldCB0cmFuc2NyaXB0ID0gJyc7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAocmF3UmVzdWx0ICYmIHJhd1Jlc3VsdC5yZXN1bHRzICYmIHJhd1Jlc3VsdC5yZXN1bHRzLmNoYW5uZWxzICYmIHJhd1Jlc3VsdC5yZXN1bHRzLmNoYW5uZWxzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNoYW5uZWwgPSByYXdSZXN1bHQucmVzdWx0cy5jaGFubmVsc1swXTtcclxuICAgICAgICAgICAgICAgIGlmIChjaGFubmVsLmFsdGVybmF0aXZlcyAmJiBjaGFubmVsLmFsdGVybmF0aXZlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJhbnNjcmlwdCA9IGNoYW5uZWwuYWx0ZXJuYXRpdmVzWzBdLnRyYW5zY3JpcHQgfHwgJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNoYW5uZWwuYWx0ZXJuYXRpdmVzWzBdLnBhcmFncmFwaHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gSWYgcGFyYWdyYXBocyBhcmUgYXZhaWxhYmxlIChlLmcuLCB3aXRoIGRpYXJpemU6IHRydWUpLCBjb25zdHJ1Y3QgdHJhbnNjcmlwdCBmcm9tIHRoZW1cclxuICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnNjcmlwdCA9IGNoYW5uZWwuYWx0ZXJuYXRpdmVzWzBdLnBhcmFncmFwaHMudHJhbnNjcmlwdCB8fCB0cmFuc2NyaXB0O1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgW0RlZXBncmFtU2VydmljZTpGT1JNQVRUSU5HX1dBUk5dW2pvYklkOiR7am9iSWR9XSBVbmV4cGVjdGVkIHJhdyByZXN1bHQgc3RydWN0dXJlIG9yIGVtcHR5IHJlc3VsdC5gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSByYXdSZXN1bHQubWV0YWRhdGEgfHwge307XHJcbiAgICAgICAgICAgIGNvbnN0IGR1cmF0aW9uID0gbWV0YWRhdGEuZHVyYXRpb24gfHwgMDtcclxuICAgICAgICAgICAgY29uc3QgbGFuZ3VhZ2UgPSBvcHRpb25zLmxhbmd1YWdlIHx8IChtZXRhZGF0YS5sYW5ndWFnZSB8fCAnZW4nKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGZvcm1hdHRlZCA9IHtcclxuICAgICAgICAgICAgICAgIHRleHQ6IHRyYW5zY3JpcHQudHJpbSgpLFxyXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2U6IGxhbmd1YWdlLFxyXG4gICAgICAgICAgICAgICAgZHVyYXRpb246IGR1cmF0aW9uLFxyXG4gICAgICAgICAgICAgICAgbW9kZWw6IG9wdGlvbnMubW9kZWwgfHwgc2V0dGluZ3NTdG9yZS5nZXQoJ3RyYW5zY3JpcHRpb24ubW9kZWwnLCAnbm92YS0yJyksXHJcbiAgICAgICAgICAgICAgICBwcm92aWRlcjogJ2RlZXBncmFtJyxcclxuICAgICAgICAgICAgICAgIHJhd1Jlc3BvbnNlOiBvcHRpb25zLmluY2x1ZGVSYXdSZXNwb25zZSA/IHNhbml0aXplRm9yTG9nZ2luZyhyYXdSZXN1bHQpIDogdW5kZWZpbmVkXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlOkZPUk1BVFRJTkdfU1VDQ0VTU11bam9iSWQ6JHtqb2JJZH1dIEZvcm1hdHRlZCByZXN1bHQ6YCwgc2FuaXRpemVGb3JMb2dnaW5nKGZvcm1hdHRlZCkpO1xyXG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0dGVkO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yLm1lc3NhZ2UgfHwgJ1Vua25vd24gZXJyb3IgZm9ybWF0dGluZyByZXN1bHQnO1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbRGVlcGdyYW1TZXJ2aWNlOkZPUk1BVFRJTkdfRVJST1JdW2pvYklkOiR7am9iSWR9XSBFcnJvciBmb3JtYXR0aW5nIHRyYW5zY3JpcHRpb24gcmVzdWx0OmAsIHNhbml0aXplRm9yTG9nZ2luZyhlcnJvcikpO1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBmb3JtYXQgdHJhbnNjcmlwdGlvbiByZXN1bHQ6ICR7ZXJyb3JNZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFVwZGF0ZSBqb2Igc3RhdHVzIGFuZCBub3RpZnkgcmVuZGVyZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RhdHVzIC0gTmV3IHN0YXR1c1xyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGRldGFpbHMgLSBBZGRpdGlvbmFsIGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgdXBkYXRlSm9iU3RhdHVzKGpvYklkLCBzdGF0dXMsIGRldGFpbHMgPSB7fSkge1xyXG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuYWN0aXZlSm9icy5nZXQoam9iSWQpO1xyXG4gICAgICAgIGlmIChqb2IpIHtcclxuICAgICAgICAgICAgam9iLnN0YXR1cyA9IHN0YXR1cztcclxuICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihqb2IsIGRldGFpbHMpO1xyXG5cclxuICAgICAgICAgICAgaWYgKGpvYi53aW5kb3cpIHtcclxuICAgICAgICAgICAgICAgIGpvYi53aW5kb3cud2ViQ29udGVudHMuc2VuZCgndHJhbnNjcmliZTpwcm9ncmVzcycsIHtcclxuICAgICAgICAgICAgICAgICAgICBqb2JJZCxcclxuICAgICAgICAgICAgICAgICAgICBzdGF0dXMsXHJcbiAgICAgICAgICAgICAgICAgICAgLi4uZGV0YWlsc1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIENyZWF0ZSBhbmQgZXhwb3J0IHRoZSBzaW5nbGV0b24gaW5zdGFuY2VcclxuY29uc3QgZGVlcGdyYW1TZXJ2aWNlSW5zdGFuY2UgPSBuZXcgRGVlcGdyYW1TZXJ2aWNlKCk7XHJcbm1vZHVsZS5leHBvcnRzID0gZGVlcGdyYW1TZXJ2aWNlSW5zdGFuY2U7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTUMsRUFBRSxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQzlCLE1BQU07RUFBRUU7QUFBYSxDQUFDLEdBQUdGLE9BQU8sQ0FBQyxlQUFlLENBQUM7QUFDakQsTUFBTTtFQUFFRztBQUFPLENBQUMsR0FBR0gsT0FBTyxDQUFDLGFBQWEsQ0FBQztBQUN6QyxNQUFNO0VBQUVJLEVBQUUsRUFBRUM7QUFBTyxDQUFDLEdBQUdMLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDdEMsTUFBTU0sV0FBVyxHQUFHTixPQUFPLENBQUMsZ0JBQWdCLENBQUM7QUFDN0MsTUFBTTtFQUFFTztBQUFZLENBQUMsR0FBR1AsT0FBTyxDQUFDLDBCQUEwQixDQUFDO0FBQzNELE1BQU1RLGFBQWEsR0FBR1IsT0FBTyxDQUFDLGtCQUFrQixDQUFDOztBQUVqRDtBQUNBLE1BQU1TLGNBQWMsR0FBRyxHQUFHLEdBQUcsSUFBSSxHQUFHLElBQUk7O0FBRXhDO0FBQ0EsU0FBU0Msa0JBQWtCQSxDQUFDQyxHQUFHLEVBQUVDLE9BQU8sR0FBRyxJQUFJQyxHQUFHLENBQUMsQ0FBQyxFQUFFO0VB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UUFBUSxFQUFFQSxRQUFRO1FBQ2xCcUIsUUFBUSxFQUFFQSxRQUFRO1FBQ2xCNUIsS0FBSyxFQUFFOUIsT0FBTyxDQUFDOEIsS0FBSyxJQUFJekUsYUFBYSxDQUFDaUMsR0FBRyxDQUFDLHFCQUFxQixFQUFFLFFBQVEsQ0FBQztRQUMxRTZFLFFBQVEsRUFBRSxVQUFVO1FBQ3BCQyxXQUFXLEVBQUVwRSxPQUFPLENBQUNxRSxrQkFBa0IsR0FBR2xJLGtCQUFrQixDQUFDeUgsU0FBUyxDQUFDLEdBQUdVO01BQzlFLENBQUM7TUFDRC9GLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDhDQUE4Q3lCLEtBQUsscUJBQXFCLEVBQUU5RCxrQkFBa0IsQ0FBQzZILFNBQVMsQ0FBQyxDQUFDO01BQ3BILE9BQU9BLFNBQVM7SUFDcEIsQ0FBQyxDQUFDLE9BQU90RixLQUFLLEVBQUU7TUFDWixNQUFNaUMsWUFBWSxHQUFHakMsS0FBSyxDQUFDUyxPQUFPLElBQUksaUNBQWlDO01BQ3ZFWixPQUFPLENBQUNHLEtBQUssQ0FBQyw0Q0FBNEN1QixLQUFLLDBDQUEwQyxFQUFFOUQsa0JBQWtCLENBQUN1QyxLQUFLLENBQUMsQ0FBQztNQUNySSxNQUFNLElBQUlPLEtBQUssQ0FBQywwQ0FBMEMwQixZQUFZLEVBQUUsQ0FBQztJQUM3RTtFQUNKOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNJQyxlQUFlQSxDQUFDWCxLQUFLLEVBQUVHLE1BQU0sRUFBRVMsT0FBTyxHQUFHLENBQUMsQ0FBQyxFQUFFO0lBQ3pDLE1BQU1DLEdBQUcsR0FBRyxJQUFJLENBQUNuRCxVQUFVLENBQUMyQixHQUFHLENBQUNXLEtBQUssQ0FBQztJQUN0QyxJQUFJYSxHQUFHLEVBQUU7TUFDTEEsR0FBRyxDQUFDVixNQUFNLEdBQUdBLE1BQU07TUFDbkJsRCxNQUFNLENBQUNxSCxNQUFNLENBQUN6RCxHQUFHLEVBQUVELE9BQU8sQ0FBQztNQUUzQixJQUFJQyxHQUFHLENBQUNSLE1BQU0sRUFBRTtRQUNaUSxHQUFHLENBQUNSLE1BQU0sQ0FBQ2tFLFdBQVcsQ0FBQ0MsSUFBSSxDQUFDLHFCQUFxQixFQUFFO1VBQy9DeEUsS0FBSztVQUNMRyxNQUFNO1VBQ04sR0FBR1M7UUFDUCxDQUFDLENBQUM7TUFDTjtJQUNKO0VBQ0o7QUFDSjs7QUFFQTtBQUNBLE1BQU02RCx1QkFBdUIsR0FBRyxJQUFJcEgsZUFBZSxDQUFDLENBQUM7QUFDckRxSCxNQUFNLENBQUNDLE9BQU8sR0FBR0YsdUJBQXVCIiwiaWdub3JlTGlzdCI6W119