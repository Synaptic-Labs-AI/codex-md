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
      // Create Deepgram client with API key and extended timeout
      this.deepgram = createClient(apiKey, {
        global: {
          fetch: {
            options: {
              timeout: 300000 // 5 minutes timeout for large files
            }
          }
        }
      });

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
          // Create client with extended timeout for large files
          this.deepgram = createClient(apiKey, {
            global: {
              fetch: {
                options: {
                  timeout: 300000 // 5 minutes timeout for large files
                }
              }
            }
          });

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
      const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
      if (stats.size > MAX_FILE_SIZE) {
        console.error(`[DeepgramService:VALIDATION_FAILED][jobId:${jobId}] File size (${fileSizeMB.toFixed(2)}MB) exceeds Deepgram's 2GB limit.`);
        throw new Error(`File size (${fileSizeMB.toFixed(2)}MB) exceeds Deepgram's 2GB limit. Please use a smaller file.`);
      }

      // Warn if file is large (over 100MB)
      if (stats.size > 100 * 1024 * 1024) {
        console.warn(`[DeepgramService:LARGE_FILE_WARNING][jobId:${jobId}] Large file detected (${fileSizeMB.toFixed(2)}MB). This may take longer to process.`);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiY3JlYXRlQ2xpZW50IiwiQnVmZmVyIiwidjQiLCJ1dWlkdjQiLCJCYXNlU2VydmljZSIsImNyZWF0ZVN0b3JlIiwiYXBpS2V5U2VydmljZSIsIk1BWF9DSFVOS19TSVpFIiwic2FuaXRpemVGb3JMb2dnaW5nIiwib2JqIiwidmlzaXRlZCIsIlNldCIsImhhcyIsImFkZCIsImlzQnVmZmVyIiwibGVuZ3RoIiwiQXJyYXkiLCJpc0FycmF5IiwibWFwIiwiaXRlbSIsInNhbml0aXplZCIsImtleSIsInZhbHVlIiwiT2JqZWN0IiwiZW50cmllcyIsImRlbGV0ZSIsInNldHRpbmdzU3RvcmUiLCJEZWVwZ3JhbVNlcnZpY2UiLCJjb25zdHJ1Y3RvciIsInNraXBIYW5kbGVyU2V0dXAiLCJkZWVwZ3JhbSIsImZpbGVTdG9yYWdlIiwiYWN0aXZlSm9icyIsIk1hcCIsIm1hbnVhbFNldHVwSXBjSGFuZGxlcnMiLCJoYW5kbGVyTWV0aG9kcyIsImhhbmRsZVRyYW5zY3JpYmVTdGFydCIsImJpbmQiLCJoYW5kbGVUcmFuc2NyaWJlU3RhdHVzIiwiaGFuZGxlVHJhbnNjcmliZUNhbmNlbCIsImhhbmRsZUNvbmZpZ3VyZSIsImNoYW5uZWwiLCJoYW5kbGVyIiwiaXNIYW5kbGVyUmVnaXN0ZXJlZCIsImNvbnNvbGUiLCJsb2ciLCJyZWdpc3RlckhhbmRsZXIiLCJlcnJvciIsImlwY01haW4iLCJfZXZlbnRzIiwiZXJyIiwic2V0dXBJcGNIYW5kbGVycyIsImV2ZW50IiwiYXBpS2V5IiwiZ2xvYmFsIiwiZmV0Y2giLCJvcHRpb25zIiwidGltZW91dCIsIkVycm9yIiwic3VjY2VzcyIsIm1lc3NhZ2UiLCJlbnN1cmVDb25maWd1cmVkIiwiZGlyZWN0S2V5IiwiZ2V0IiwibmVzdGVkS2V5IiwiYXBpS2V5U2VydmljZUtleSIsImdldEFwaUtleSIsInNldCIsImN1cnJlbnRUcmFuc2NyaXB0aW9uIiwiZGVlcGdyYW1BcGlLZXkiLCJzYXZlQXBpS2V5Iiwic2F2ZUVycm9yIiwiZmlsZVBhdGgiLCJqb2JJZCIsInRlbXBEaXIiLCJjcmVhdGVUZW1wRGlyIiwic3RhdHVzIiwicHJvZ3Jlc3MiLCJ3aW5kb3ciLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJwcm9jZXNzVHJhbnNjcmlwdGlvbiIsImNhdGNoIiwiZXJyb3JNZXNzYWdlIiwidXBkYXRlSm9iU3RhdHVzIiwiZGV0YWlscyIsImpvYiIsInJlbW92ZSIsInBhdGhFeGlzdHMiLCJzdGF0cyIsInN0YXQiLCJmaWxlRXh0IiwiZXh0bmFtZSIsInRvTG93ZXJDYXNlIiwiZmlsZVNpemVNQiIsInNpemUiLCJpc1ZpZGVvIiwiaW5jbHVkZXMiLCJtZWRpYVR5cGUiLCJ0b0ZpeGVkIiwiTUFYX0ZJTEVfU0laRSIsIndhcm4iLCJmaWxlRGF0YSIsInJlYWRGaWxlIiwibW9kZWwiLCJ0cmFuc2NyaXB0aW9uUmVzdWx0IiwidHJhbnNjcmliZVdpdGhEZWVwZ3JhbSIsInNtYXJ0X2Zvcm1hdCIsInB1bmN0dWF0ZSIsImRpYXJpemUiLCJ1dHRlcmFuY2VzIiwibGFuZ3VhZ2UiLCJkZWVwZ3JhbU9wdGlvbnMiLCJyZXN1bHQiLCJmb3JtYXRUcmFuc2NyaXB0aW9uUmVzdWx0Iiwiam9iRGF0YSIsIm5hbWUiLCJjb2RlIiwiZGdFcnJvciIsImxpc3RlbiIsInByZXJlY29yZGVkIiwidHJhbnNjcmliZUZpbGUiLCJib2R5IiwiSlNPTiIsInN0cmluZ2lmeSIsIlN0cmluZyIsInN1YnN0cmluZyIsImNoYW5uZWxzIiwicmVzdWx0cyIsIm1ldGFkYXRhRHVyYXRpb24iLCJtZXRhZGF0YSIsImR1cmF0aW9uIiwic3RhcnRzV2l0aCIsInJhd1Jlc3VsdCIsInRyYW5zY3JpcHQiLCJhbHRlcm5hdGl2ZXMiLCJwYXJhZ3JhcGhzIiwiZm9ybWF0dGVkIiwidGV4dCIsInRyaW0iLCJwcm92aWRlciIsInJhd1Jlc3BvbnNlIiwiaW5jbHVkZVJhd1Jlc3BvbnNlIiwidW5kZWZpbmVkIiwiYXNzaWduIiwid2ViQ29udGVudHMiLCJzZW5kIiwiZGVlcGdyYW1TZXJ2aWNlSW5zdGFuY2UiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2FpL0RlZXBncmFtU2VydmljZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogRGVlcGdyYW1TZXJ2aWNlLmpzXHJcbiAqIEhhbmRsZXMgYXVkaW8gYW5kIHZpZGVvIHRyYW5zY3JpcHRpb24gaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2VzcyB1c2luZyBEZWVwZ3JhbS5cclxuICpcclxuICogVGhpcyBzZXJ2aWNlIGhhbmRsZXM6XHJcbiAqIC0gQXVkaW8gYW5kIHZpZGVvIGZpbGUgdHJhbnNjcmlwdGlvblxyXG4gKiAtIENodW5raW5nIGZvciBsYXJnZSBmaWxlc1xyXG4gKiAtIFJlc3VsdCBmb3JtYXR0aW5nXHJcbiAqXHJcbiAqIFJlbGF0ZWQgRmlsZXM6XHJcbiAqIC0gQmFzZVNlcnZpY2UuanM6IFBhcmVudCBjbGFzcyBwcm92aWRpbmcgSVBDIGhhbmRsaW5nXHJcbiAqIC0gRmlsZVN0b3JhZ2VTZXJ2aWNlLmpzOiBGb3IgdGVtcG9yYXJ5IGZpbGUgbWFuYWdlbWVudFxyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcclxuY29uc3QgeyBjcmVhdGVDbGllbnQgfSA9IHJlcXVpcmUoJ0BkZWVwZ3JhbS9zZGsnKTtcclxuY29uc3QgeyBCdWZmZXIgfSA9IHJlcXVpcmUoJ25vZGU6YnVmZmVyJyk7XHJcbmNvbnN0IHsgdjQ6IHV1aWR2NCB9ID0gcmVxdWlyZSgndXVpZCcpO1xyXG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uL0Jhc2VTZXJ2aWNlJyk7XHJcbmNvbnN0IHsgY3JlYXRlU3RvcmUgfSA9IHJlcXVpcmUoJy4uLy4uL3V0aWxzL3N0b3JlRmFjdG9yeScpO1xyXG5jb25zdCBhcGlLZXlTZXJ2aWNlID0gcmVxdWlyZSgnLi4vQXBpS2V5U2VydmljZScpO1xyXG5cclxuLy8gTWF4IGNodW5rIHNpemUgZm9yIGZpbGVzICgxMDBNQilcclxuY29uc3QgTUFYX0NIVU5LX1NJWkUgPSAxMDAgKiAxMDI0ICogMTAyNDtcclxuXHJcbi8vIFV0aWxpdHkgdG8gc2FuaXRpemUgb2JqZWN0cyBmb3IgbG9nZ2luZywgZXNwZWNpYWxseSB0byBoYW5kbGUgQnVmZmVyc1xyXG5mdW5jdGlvbiBzYW5pdGl6ZUZvckxvZ2dpbmcob2JqLCB2aXNpdGVkID0gbmV3IFNldCgpKSB7XHJcbiAgaWYgKG9iaiA9PT0gbnVsbCB8fCB0eXBlb2Ygb2JqICE9PSAnb2JqZWN0JyB8fCB2aXNpdGVkLmhhcyhvYmopKSB7XHJcbiAgICByZXR1cm4gb2JqO1xyXG4gIH1cclxuXHJcbiAgdmlzaXRlZC5hZGQob2JqKTtcclxuXHJcbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihvYmopKSB7XHJcbiAgICByZXR1cm4gYFtCdWZmZXIgbGVuZ3RoOiAke29iai5sZW5ndGh9XWA7XHJcbiAgfVxyXG5cclxuICBpZiAoQXJyYXkuaXNBcnJheShvYmopKSB7XHJcbiAgICByZXR1cm4gb2JqLm1hcChpdGVtID0+IHNhbml0aXplRm9yTG9nZ2luZyhpdGVtLCBuZXcgU2V0KHZpc2l0ZWQpKSk7XHJcbiAgfVxyXG5cclxuICBjb25zdCBzYW5pdGl6ZWQgPSB7fTtcclxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhvYmopKSB7XHJcbiAgICBzYW5pdGl6ZWRba2V5XSA9IHNhbml0aXplRm9yTG9nZ2luZyh2YWx1ZSwgbmV3IFNldCh2aXNpdGVkKSk7XHJcbiAgfVxyXG4gIFxyXG4gIHZpc2l0ZWQuZGVsZXRlKG9iaik7XHJcbiAgcmV0dXJuIHNhbml0aXplZDtcclxufVxyXG5cclxuLy8gU2V0dGluZ3Mgc3RvcmVcclxuY29uc3Qgc2V0dGluZ3NTdG9yZSA9IGNyZWF0ZVN0b3JlKCdzZXR0aW5ncycpO1xyXG5cclxuY2xhc3MgRGVlcGdyYW1TZXJ2aWNlIGV4dGVuZHMgQmFzZVNlcnZpY2Uge1xyXG4gICAgY29uc3RydWN0b3IoKSB7XHJcbiAgICAgICAgLy8gUGFzcyBvcHRpb25zIHRvIEJhc2VTZXJ2aWNlIGNvbnN0cnVjdG9yXHJcbiAgICAgICAgc3VwZXIoeyBza2lwSGFuZGxlclNldHVwOiB0cnVlIH0pO1xyXG5cclxuICAgICAgICAvLyBTZXQgaW5zdGFuY2UgcHJvcGVydGllc1xyXG4gICAgICAgIHRoaXMuZGVlcGdyYW0gPSBudWxsO1xyXG4gICAgICAgIHRoaXMuZmlsZVN0b3JhZ2UgPSByZXF1aXJlKCcuLi9zdG9yYWdlL0ZpbGVTdG9yYWdlU2VydmljZScpO1xyXG4gICAgICAgIHRoaXMuYWN0aXZlSm9icyA9IG5ldyBNYXAoKTtcclxuXHJcbiAgICAgICAgLy8gTWFudWFsIHNldHVwIHdpdGggZHVwbGljYXRlIHJlZ2lzdHJhdGlvbiBwcmV2ZW50aW9uXHJcbiAgICAgICAgdGhpcy5tYW51YWxTZXR1cElwY0hhbmRsZXJzKCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBNYW51YWxseSBzZXQgdXAgSVBDIGhhbmRsZXJzIHdpdGggZHVwbGljYXRlIHJlZ2lzdHJhdGlvbiBwcmV2ZW50aW9uXHJcbiAgICAgKi9cclxuICAgIG1hbnVhbFNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgY29uc3QgaGFuZGxlck1ldGhvZHMgPSB7XHJcbiAgICAgICAgICAgICd0cmFuc2NyaWJlOnN0YXJ0JzogdGhpcy5oYW5kbGVUcmFuc2NyaWJlU3RhcnQuYmluZCh0aGlzKSxcclxuICAgICAgICAgICAgJ3RyYW5zY3JpYmU6c3RhdHVzJzogdGhpcy5oYW5kbGVUcmFuc2NyaWJlU3RhdHVzLmJpbmQodGhpcyksXHJcbiAgICAgICAgICAgICd0cmFuc2NyaWJlOmNhbmNlbCc6IHRoaXMuaGFuZGxlVHJhbnNjcmliZUNhbmNlbC5iaW5kKHRoaXMpLFxyXG4gICAgICAgICAgICAnZGVlcGdyYW06Y29uZmlndXJlJzogdGhpcy5oYW5kbGVDb25maWd1cmUuYmluZCh0aGlzKVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGZvciAoY29uc3QgW2NoYW5uZWwsIGhhbmRsZXJdIG9mIE9iamVjdC5lbnRyaWVzKGhhbmRsZXJNZXRob2RzKSkge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuaXNIYW5kbGVyUmVnaXN0ZXJlZChjaGFubmVsKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlXSBIYW5kbGVyIGZvciAke2NoYW5uZWx9IGFscmVhZHkgcmVnaXN0ZXJlZCwgc2tpcHBpbmdgKTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoY2hhbm5lbCwgaGFuZGxlcik7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbRGVlcGdyYW1TZXJ2aWNlXSBFcnJvciBzZXR0aW5nIHVwIGhhbmRsZXIgZm9yICR7Y2hhbm5lbH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgYW4gSVBDIGhhbmRsZXIgaXMgYWxyZWFkeSByZWdpc3RlcmVkXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIFRoZSBjaGFubmVsIHRvIGNoZWNrXHJcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgaGFuZGxlciBpcyByZWdpc3RlcmVkXHJcbiAgICAgKi9cclxuICAgIGlzSGFuZGxlclJlZ2lzdGVyZWQoY2hhbm5lbCkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHsgaXBjTWFpbiB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuICAgICAgICAgICAgLy8gV2UgY2FuJ3QgZGlyZWN0bHkgY2hlY2sgZm9yIGhhbmRsZXIgZXhpc3RlbmNlIGluIGEgcmVsaWFibGUgd2F5XHJcbiAgICAgICAgICAgIC8vIFRoaXMgaXMgYSBiZXN0IGVmZm9ydCBhdHRlbXB0XHJcbiAgICAgICAgICAgIHJldHVybiBpcGNNYWluLl9ldmVudHMgJiYgaXBjTWFpbi5fZXZlbnRzW2BoYW5kbGUtJHtjaGFubmVsfWBdO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogU2V0IHVwIElQQyBoYW5kbGVycyBmb3IgdHJhbnNjcmlwdGlvbiBvcGVyYXRpb25zXHJcbiAgICAgKi9cclxuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ3RyYW5zY3JpYmU6c3RhcnQnLCB0aGlzLmhhbmRsZVRyYW5zY3JpYmVTdGFydC5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcigndHJhbnNjcmliZTpzdGF0dXMnLCB0aGlzLmhhbmRsZVRyYW5zY3JpYmVTdGF0dXMuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ3RyYW5zY3JpYmU6Y2FuY2VsJywgdGhpcy5oYW5kbGVUcmFuc2NyaWJlQ2FuY2VsLmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdkZWVwZ3JhbTpjb25maWd1cmUnLCB0aGlzLmhhbmRsZUNvbmZpZ3VyZS5iaW5kKHRoaXMpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENvbmZpZ3VyZSBEZWVwZ3JhbSB3aXRoIEFQSSBrZXlcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb25maWd1cmF0aW9uIHJlcXVlc3RcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlQ29uZmlndXJlKGV2ZW50LCB7IGFwaUtleSB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgLy8gQ3JlYXRlIERlZXBncmFtIGNsaWVudCB3aXRoIEFQSSBrZXkgYW5kIGV4dGVuZGVkIHRpbWVvdXRcclxuICAgICAgICAgICAgdGhpcy5kZWVwZ3JhbSA9IGNyZWF0ZUNsaWVudChhcGlLZXksIHtcclxuICAgICAgICAgICAgICAgIGdsb2JhbDoge1xyXG4gICAgICAgICAgICAgICAgICAgIGZldGNoOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVvdXQ6IDMwMDAwMCAvLyA1IG1pbnV0ZXMgdGltZW91dCBmb3IgbGFyZ2UgZmlsZXNcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBUZXN0IHRoZSBjb25uZWN0aW9uIHdpdGggYSBzaW1wbGUgcmVxdWVzdFxyXG4gICAgICAgICAgICAvLyBKdXN0IGNoZWNraW5nIGlmIHRoZSBjbGllbnQgaXMgd29ya2luZywgbm90IGFjdHVhbGx5IG1ha2luZyBhIHRyYW5zY3JpcHRpb25cclxuICAgICAgICAgICAgaWYgKCF0aGlzLmRlZXBncmFtKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBpbml0aWFsaXplIERlZXBncmFtIGNsaWVudCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW0RlZXBncmFtU2VydmljZV0gU3VjY2Vzc2Z1bGx5IGNvbmZpZ3VyZWQgd2l0aCBBUEkga2V5Jyk7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRGVlcGdyYW1TZXJ2aWNlXSBDb25maWd1cmF0aW9uIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNvbmZpZ3VyZSBEZWVwZ3JhbTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEVuc3VyZSBEZWVwZ3JhbSBpcyBjb25maWd1cmVkIHdpdGggYW4gQVBJIGtleVxyXG4gICAgICogTG9hZHMgdGhlIGtleSBmcm9tIHNldHRpbmdzIGlmIG5vdCBhbHJlYWR5IGNvbmZpZ3VyZWRcclxuICAgICAqIEVuaGFuY2VkIHdpdGggYmV0dGVyIGRlYnVnZ2luZyBhbmQgZmFsbGJhY2sgb3B0aW9uc1xyXG4gICAgICovXHJcbiAgICBlbnN1cmVDb25maWd1cmVkKCkge1xyXG4gICAgICAgIGlmICghdGhpcy5kZWVwZ3JhbSkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW0RlZXBncmFtU2VydmljZV0gQ29uZmlndXJpbmcgRGVlcGdyYW0gY2xpZW50Li4uJyk7XHJcblxyXG4gICAgICAgICAgICAvLyBUcnkgbXVsdGlwbGUgcG90ZW50aWFsIGtleSBsb2NhdGlvbnMgd2l0aCBkZXRhaWxlZCBsb2dnaW5nXHJcbiAgICAgICAgICAgIGNvbnN0IGRpcmVjdEtleSA9IHNldHRpbmdzU3RvcmUuZ2V0KCdkZWVwZ3JhbUFwaUtleScpO1xyXG4gICAgICAgICAgICBjb25zdCBuZXN0ZWRLZXkgPSBzZXR0aW5nc1N0b3JlLmdldCgndHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleScpO1xyXG4gICAgICAgICAgICBjb25zdCBhcGlLZXlTZXJ2aWNlS2V5ID0gcmVxdWlyZSgnLi4vQXBpS2V5U2VydmljZScpLmdldEFwaUtleSgnZGVlcGdyYW0nKTtcclxuXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlXSBBUEkgS2V5IHNvdXJjZXM6XHJcbiAgICAgICAgICAgICAgLSBEaXJlY3QgcGF0aCAoZGVlcGdyYW1BcGlLZXkpOiAke2RpcmVjdEtleSA/ICdGb3VuZCAobGVuZ3RoOiAnICsgZGlyZWN0S2V5Lmxlbmd0aCArICcpJyA6ICdOb3QgZm91bmQnfVxyXG4gICAgICAgICAgICAgIC0gTmVzdGVkIHBhdGggKHRyYW5zY3JpcHRpb24uZGVlcGdyYW1BcGlLZXkpOiAke25lc3RlZEtleSA/ICdGb3VuZCAobGVuZ3RoOiAnICsgbmVzdGVkS2V5Lmxlbmd0aCArICcpJyA6ICdOb3QgZm91bmQnfVxyXG4gICAgICAgICAgICAgIC0gQXBpS2V5U2VydmljZTogJHthcGlLZXlTZXJ2aWNlS2V5ID8gJ0ZvdW5kIChsZW5ndGg6ICcgKyBhcGlLZXlTZXJ2aWNlS2V5Lmxlbmd0aCArICcpJyA6ICdOb3QgZm91bmQnfWApO1xyXG5cclxuICAgICAgICAgICAgLy8gVXNlIHRoZSBmaXJzdCBhdmFpbGFibGUga2V5XHJcbiAgICAgICAgICAgIGNvbnN0IGFwaUtleSA9IGRpcmVjdEtleSB8fCBuZXN0ZWRLZXkgfHwgYXBpS2V5U2VydmljZUtleTtcclxuXHJcbiAgICAgICAgICAgIGlmIChhcGlLZXkpIHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2VdIENyZWF0aW5nIERlZXBncmFtIGNsaWVudCB3aXRoIGtleSAobGVuZ3RoOiAke2FwaUtleS5sZW5ndGh9KWApO1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBjbGllbnQgd2l0aCBleHRlbmRlZCB0aW1lb3V0IGZvciBsYXJnZSBmaWxlc1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGVlcGdyYW0gPSBjcmVhdGVDbGllbnQoYXBpS2V5LCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdsb2JhbDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZmV0Y2g6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVvdXQ6IDMwMDAwMCAvLyA1IG1pbnV0ZXMgdGltZW91dCBmb3IgbGFyZ2UgZmlsZXNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVGVzdCBpZiB0aGUgY2xpZW50IHdhcyBjcmVhdGVkIHN1Y2Nlc3NmdWxseVxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5kZWVwZ3JhbSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBjcmVhdGUgRGVlcGdyYW0gY2xpZW50ICh1bmRlZmluZWQgcmVzdWx0KScpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tEZWVwZ3JhbVNlcnZpY2VdIFN1Y2Nlc3NmdWxseSBjb25maWd1cmVkIERlZXBncmFtIHdpdGggQVBJIGtleScpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBTYXZlIHRoZSBrZXkgdG8gZW5zdXJlIGl0J3MgaW4gYWxsIGV4cGVjdGVkIGxvY2F0aW9ucyBmb3IgZnV0dXJlIHVzZVxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZGlyZWN0S2V5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW0RlZXBncmFtU2VydmljZV0gU2F2aW5nIGtleSB0byBkaXJlY3QgcGF0aCBmb3IgZnV0dXJlIHVzZScpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0dGluZ3NTdG9yZS5zZXQoJ2RlZXBncmFtQXBpS2V5JywgYXBpS2V5KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFuZXN0ZWRLZXkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbRGVlcGdyYW1TZXJ2aWNlXSBTYXZpbmcga2V5IHRvIG5lc3RlZCBwYXRoIGZvciBmdXR1cmUgdXNlJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50VHJhbnNjcmlwdGlvbiA9IHNldHRpbmdzU3RvcmUuZ2V0KCd0cmFuc2NyaXB0aW9uJykgfHwge307XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdXJyZW50VHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleSA9IGFwaUtleTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldHRpbmdzU3RvcmUuc2V0KCd0cmFuc2NyaXB0aW9uJywgY3VycmVudFRyYW5zY3JpcHRpb24pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWFwaUtleVNlcnZpY2VLZXkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbRGVlcGdyYW1TZXJ2aWNlXSBTYXZpbmcga2V5IHRvIEFwaUtleVNlcnZpY2UgZm9yIGZ1dHVyZSB1c2UnKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVpcmUoJy4uL0FwaUtleVNlcnZpY2UnKS5zYXZlQXBpS2V5KGFwaUtleSwgJ2RlZXBncmFtJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChzYXZlRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gSnVzdCBsb2cgdGhlIGVycm9yIGJ1dCBjb250aW51ZSB1c2luZyB0aGUgY3VycmVudCBrZXlcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0RlZXBncmFtU2VydmljZV0gRXJyb3Igc2F2aW5nIGtleSB0byBhbGwgbG9jYXRpb25zOicsIHNhdmVFcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRGVlcGdyYW1TZXJ2aWNlXSBGYWlsZWQgdG8gY29uZmlndXJlIHdpdGggQVBJIGtleTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY29uZmlndXJlIERlZXBncmFtOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRGVlcGdyYW1TZXJ2aWNlXSBObyBBUEkga2V5IGZvdW5kIGluIGFueSBsb2NhdGlvbicpO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdEZWVwZ3JhbSBBUEkgbm90IGNvbmZpZ3VyZWQuIFBsZWFzZSBzZXQgYW4gQVBJIGtleSBpbiBTZXR0aW5ncyDihpIgVHJhbnNjcmlwdGlvbi4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbRGVlcGdyYW1TZXJ2aWNlXSBEZWVwZ3JhbSBjbGllbnQgYWxyZWFkeSBjb25maWd1cmVkJyk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIHRyYW5zY3JpcHRpb24gc3RhcnQgcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFRyYW5zY3JpcHRpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZVRyYW5zY3JpYmVTdGFydChldmVudCwgeyBmaWxlUGF0aCwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICB0aGlzLmVuc3VyZUNvbmZpZ3VyZWQoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGpvYklkID0gdXVpZHY0KCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ3RyYW5zY3JpcHRpb24nKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlOlNUQVJUSU5HXVtqb2JJZDoke2pvYklkfV0gU3RhcnRpbmcgdHJhbnNjcmlwdGlvbiBmb3IgZmlsZTogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2U6U1RBUlRJTkddW2pvYklkOiR7am9iSWR9XSBPcHRpb25zOmAsIHNhbml0aXplRm9yTG9nZ2luZyhvcHRpb25zKSk7XHJcblxyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUpvYnMuc2V0KGpvYklkLCB7XHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdwcmVwYXJpbmcnLFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDAsXHJcbiAgICAgICAgICAgICAgICBmaWxlUGF0aCxcclxuICAgICAgICAgICAgICAgIHRlbXBEaXIsXHJcbiAgICAgICAgICAgICAgICAvLyBHZXQgd2luZG93IG9ubHkgaWYgZXZlbnQgYW5kIHNlbmRlciBleGlzdCAoY2FsbGVkIHZpYSBJUEMpXHJcbiAgICAgICAgICAgICAgICB3aW5kb3c6IGV2ZW50ICYmIGV2ZW50LnNlbmRlciA/IGV2ZW50LnNlbmRlci5nZXRPd25lckJyb3dzZXJXaW5kb3coKSA6IG51bGxcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBTdGFydCB0cmFuc2NyaXB0aW9uIHByb2Nlc3NcclxuICAgICAgICAgICAgdGhpcy5wcm9jZXNzVHJhbnNjcmlwdGlvbihqb2JJZCwgZmlsZVBhdGgsIG9wdGlvbnMpLmNhdGNoKGVycm9yID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yLm1lc3NhZ2UgfHwgJ1Vua25vd24gdHJhbnNjcmlwdGlvbiBlcnJvcic7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbRGVlcGdyYW1TZXJ2aWNlOkZBSUxFRF1bam9iSWQ6JHtqb2JJZH1dIFRyYW5zY3JpcHRpb24gZmFpbGVkOmAsIHNhbml0aXplRm9yTG9nZ2luZyhlcnJvcikpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVKb2JTdGF0dXMoam9iSWQsICdmYWlsZWQnLCB7IGVycm9yOiBlcnJvck1lc3NhZ2UsIGRldGFpbHM6IHNhbml0aXplRm9yTG9nZ2luZyhlcnJvcikgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHsgam9iSWQgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlIHx8ICdVbmtub3duIGVycm9yIHN0YXJ0aW5nIHRyYW5zY3JpcHRpb24nO1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRGVlcGdyYW1TZXJ2aWNlOkZBSUxFRF0gRmFpbGVkIHRvIHN0YXJ0IHRyYW5zY3JpcHRpb246Jywgc2FuaXRpemVGb3JMb2dnaW5nKGVycm9yKSk7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSB0cmFuc2NyaXB0aW9uIHN0YXR1cyByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gU3RhdHVzIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVUcmFuc2NyaWJlU3RhdHVzKGV2ZW50LCB7IGpvYklkIH0pIHtcclxuICAgICAgICBjb25zdCBqb2IgPSB0aGlzLmFjdGl2ZUpvYnMuZ2V0KGpvYklkKTtcclxuICAgICAgICByZXR1cm4gam9iIHx8IHsgc3RhdHVzOiAnbm90X2ZvdW5kJyB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIHRyYW5zY3JpcHRpb24gY2FuY2VsbGF0aW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDYW5jZWxsYXRpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZVRyYW5zY3JpYmVDYW5jZWwoZXZlbnQsIHsgam9iSWQgfSkge1xyXG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuYWN0aXZlSm9icy5nZXQoam9iSWQpO1xyXG4gICAgICAgIGlmIChqb2IpIHtcclxuICAgICAgICAgICAgam9iLnN0YXR1cyA9ICdjYW5jZWxsZWQnO1xyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wb3JhcnkgZmlsZXNcclxuICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGpvYi50ZW1wRGlyKTtcclxuICAgICAgICAgICAgdGhpcy5hY3RpdmVKb2JzLmRlbGV0ZShqb2JJZCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgdHJhbnNjcmlwdGlvbiBqb2JcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIG1lZGlhIGZpbGVcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gVHJhbnNjcmlwdGlvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NUcmFuc2NyaXB0aW9uKGpvYklkLCBmaWxlUGF0aCwgb3B0aW9ucykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSm9iU3RhdHVzKGpvYklkLCAncHJlcGFyaW5nJywgeyBwcm9ncmVzczogNSB9KTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2U6UFJFUEFSSU5HXVtqb2JJZDoke2pvYklkfV0gUHJvY2Vzc2luZyBqb2IgZm9yIGZpbGU6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlOlBSRVBBUklOR11bam9iSWQ6JHtqb2JJZH1dIE9wdGlvbnM6YCwgc2FuaXRpemVGb3JMb2dnaW5nKG9wdGlvbnMpKTtcclxuXHJcbiAgICAgICAgICAgIC8vIFZlcmlmeSBmaWxlIGV4aXN0c1xyXG4gICAgICAgICAgICBpZiAoIWF3YWl0IGZzLnBhdGhFeGlzdHMoZmlsZVBhdGgpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbRGVlcGdyYW1TZXJ2aWNlOlZBTElEQVRJT05fRkFJTEVEXVtqb2JJZDoke2pvYklkfV0gRmlsZSBub3QgZm91bmQ6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZpbGUgbm90IGZvdW5kOiAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSm9iU3RhdHVzKGpvYklkLCAndmFsaWRhdGluZycsIHsgcHJvZ3Jlc3M6IDEwIH0pO1xyXG5cclxuICAgICAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgY29uc3QgZmlsZUV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICAgICAgY29uc3QgZmlsZVNpemVNQiA9IHN0YXRzLnNpemUgLyAoMTAyNCAqIDEwMjQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgaXNWaWRlbyA9IG9wdGlvbnMuaXNWaWRlbyB8fCBbJy5tcDQnLCAnLmF2aScsICcubW92JywgJy5ta3YnLCAnLndlYm0nXS5pbmNsdWRlcyhmaWxlRXh0KTtcclxuICAgICAgICAgICAgY29uc3QgbWVkaWFUeXBlID0gb3B0aW9ucy5tZWRpYVR5cGUgfHwgKGlzVmlkZW8gPyAndmlkZW8nIDogJ2F1ZGlvJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0RlZXBncmFtU2VydmljZTpJTkZPXVtqb2JJZDoke2pvYklkfV0gRmlsZSBpbmZvOiB0eXBlPSR7bWVkaWFUeXBlfSwgZXh0PSR7ZmlsZUV4dH0sIHNpemU9JHtmaWxlU2l6ZU1CLnRvRml4ZWQoMil9TUJgKTtcclxuXHJcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIGZpbGUgc2l6ZSBleGNlZWRzIERlZXBncmFtJ3MgbGltaXQgKDJHQilcclxuICAgICAgICAgICAgY29uc3QgTUFYX0ZJTEVfU0laRSA9IDIgKiAxMDI0ICogMTAyNCAqIDEwMjQ7IC8vIDJHQlxyXG4gICAgICAgICAgICBpZiAoc3RhdHMuc2l6ZSA+IE1BWF9GSUxFX1NJWkUpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtEZWVwZ3JhbVNlcnZpY2U6VkFMSURBVElPTl9GQUlMRURdW2pvYklkOiR7am9iSWR9XSBGaWxlIHNpemUgKCR7ZmlsZVNpemVNQi50b0ZpeGVkKDIpfU1CKSBleGNlZWRzIERlZXBncmFtJ3MgMkdCIGxpbWl0LmApO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGaWxlIHNpemUgKCR7ZmlsZVNpemVNQi50b0ZpeGVkKDIpfU1CKSBleGNlZWRzIERlZXBncmFtJ3MgMkdCIGxpbWl0LiBQbGVhc2UgdXNlIGEgc21hbGxlciBmaWxlLmApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBXYXJuIGlmIGZpbGUgaXMgbGFyZ2UgKG92ZXIgMTAwTUIpXHJcbiAgICAgICAgICAgIGlmIChzdGF0cy5zaXplID4gMTAwICogMTAyNCAqIDEwMjQpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgW0RlZXBncmFtU2VydmljZTpMQVJHRV9GSUxFX1dBUk5JTkddW2pvYklkOiR7am9iSWR9XSBMYXJnZSBmaWxlIGRldGVjdGVkICgke2ZpbGVTaXplTUIudG9GaXhlZCgyKX1NQikuIFRoaXMgbWF5IHRha2UgbG9uZ2VyIHRvIHByb2Nlc3MuYCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdGhpcy51cGRhdGVKb2JTdGF0dXMoam9iSWQsICdwcm9jZXNzaW5nJywgeyBwcm9ncmVzczogMTUgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBSZWFkIHRoZSBmaWxlXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlOlJFQURJTkdfRklMRV1bam9iSWQ6JHtqb2JJZH1dIFJlYWRpbmcgZmlsZSBjb250ZW50Li4uYCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVEYXRhID0gYXdhaXQgZnMucmVhZEZpbGUoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0RlZXBncmFtU2VydmljZTpSRUFESU5HX0ZJTEVdW2pvYklkOiR7am9iSWR9XSBGaWxlIHJlYWQgc3VjY2Vzc2Z1bGx5IChCdWZmZXIgbGVuZ3RoOiAke2ZpbGVEYXRhLmxlbmd0aH0pYCk7XHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSm9iU3RhdHVzKGpvYklkLCAndHJhbnNjcmliaW5nJywgeyBwcm9ncmVzczogMzAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZXQgdHJhbnNjcmlwdGlvbiBtb2RlbCBmcm9tIHNldHRpbmdzIG9yIHVzZSBkZWZhdWx0XHJcbiAgICAgICAgICAgIGNvbnN0IG1vZGVsID0gc2V0dGluZ3NTdG9yZS5nZXQoJ3RyYW5zY3JpcHRpb24ubW9kZWwnLCAnbm92YS0yJyk7IC8vIENoYW5nZWQgZGVmYXVsdCB0byBub3ZhLTIgZm9yIGJyb2FkZXIgY29tcGF0aWJpbGl0eVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2U6VFJBTlNDUklCSU5HXVtqb2JJZDoke2pvYklkfV0gU2VuZGluZyBmaWxlIHRvIERlZXBncmFtIEFQSSB1c2luZyBtb2RlbDogJHttb2RlbH1gKTtcclxuICAgICAgICAgICAgY29uc3QgdHJhbnNjcmlwdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMudHJhbnNjcmliZVdpdGhEZWVwZ3JhbShcclxuICAgICAgICAgICAgICAgIGZpbGVEYXRhLCBcclxuICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbDogbW9kZWwsXHJcbiAgICAgICAgICAgICAgICAgICAgc21hcnRfZm9ybWF0OiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIHB1bmN0dWF0ZTogdHJ1ZSwgLy8gQWRkZWQgZm9yIGJldHRlciBmb3JtYXR0aW5nXHJcbiAgICAgICAgICAgICAgICAgICAgZGlhcml6ZTogb3B0aW9ucy5kaWFyaXplIHx8IGZhbHNlLCAvLyBTcGVha2VyIGRpYXJpemF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgdXR0ZXJhbmNlczogb3B0aW9ucy51dHRlcmFuY2VzIHx8IGZhbHNlLCAvLyBVdHRlcmFuY2Ugc3BsaXR0aW5nXHJcbiAgICAgICAgICAgICAgICAgICAgbGFuZ3VhZ2U6IG9wdGlvbnMubGFuZ3VhZ2UgfHwgJ2VuJyxcclxuICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLmRlZXBncmFtT3B0aW9ucyAvLyBBbGxvdyBvdmVycmlkaW5nIHdpdGggc3BlY2lmaWMgZGVlcGdyYW0gb3B0aW9uc1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGpvYklkXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUpvYlN0YXR1cyhqb2JJZCwgJ2Zvcm1hdHRpbmcnLCB7IHByb2dyZXNzOiA5MCB9KTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2U6Rk9STUFUVElOR11bam9iSWQ6JHtqb2JJZH1dIEZvcm1hdHRpbmcgdHJhbnNjcmlwdGlvbiByZXN1bHQuLi5gKTtcclxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5mb3JtYXRUcmFuc2NyaXB0aW9uUmVzdWx0KHRyYW5zY3JpcHRpb25SZXN1bHQsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBmaWxlc1xyXG4gICAgICAgICAgICBjb25zdCBqb2JEYXRhID0gdGhpcy5hY3RpdmVKb2JzLmdldChqb2JJZCk7XHJcbiAgICAgICAgICAgIGlmIChqb2JEYXRhICYmIGpvYkRhdGEudGVtcERpcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGpvYkRhdGEudGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0RlZXBncmFtU2VydmljZTpDTEVBTlVQXVtqb2JJZDoke2pvYklkfV0gQ2xlYW5lZCB1cCB0ZW1wb3JhcnkgZmlsZXMgZnJvbTogJHtqb2JEYXRhLnRlbXBEaXJ9YCk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtEZWVwZ3JhbVNlcnZpY2U6Q0xFQU5VUF9XQVJOXVtqb2JJZDoke2pvYklkfV0gTm8gdGVtcERpciBmb3VuZCBmb3IgY2xlYW51cC5gKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgdGhpcy51cGRhdGVKb2JTdGF0dXMoam9iSWQsICdjb21wbGV0ZWQnLCB7IHJlc3VsdCB9KTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2U6Q09NUExFVEVEXVtqb2JJZDoke2pvYklkfV0gVHJhbnNjcmlwdGlvbiBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5LmApO1xyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yLm1lc3NhZ2UgfHwgJ1Vua25vd24gdHJhbnNjcmlwdGlvbiBwcm9jZXNzaW5nIGVycm9yJztcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0RlZXBncmFtU2VydmljZTpGQUlMRURdW2pvYklkOiR7am9iSWR9XSBUcmFuc2NyaXB0aW9uIHByb2Nlc3NpbmcgZmFpbGVkOmAsIHNhbml0aXplRm9yTG9nZ2luZyhlcnJvcikpO1xyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUpvYlN0YXR1cyhqb2JJZCwgJ2ZhaWxlZCcsIHsgXHJcbiAgICAgICAgICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICAgICAgICAgICAgZGV0YWlsczogc2FuaXRpemVGb3JMb2dnaW5nKHtcclxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBlcnJvci5uYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvZGU6IGVycm9yLmNvZGUsXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gc3RhY2s6IGVycm9yLnN0YWNrIC8vIFN0YWNrIGNhbiBiZSB2ZXJ5IGxvbmcsIGNvbnNpZGVyIG9taXR0aW5nIG9yIHRydW5jYXRpbmcgZm9yIGdlbmVyYWwgbG9nc1xyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpOyAvLyBSZS10aHJvdyB0byBiZSBjYXVnaHQgYnkgdGhlIGNhbGxlclxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFRyYW5zY3JpYmUgZmlsZSB1c2luZyBEZWVwZ3JhbSBBUElcclxuICAgICAqIEBwYXJhbSB7QnVmZmVyfSBmaWxlRGF0YSAtIEZpbGUgYnVmZmVyXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIFRyYW5zY3JpcHRpb24gb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gVHJhbnNjcmlwdGlvbiByZXN1bHRcclxuICAgICAqL1xyXG4gICAgYXN5bmMgdHJhbnNjcmliZVdpdGhEZWVwZ3JhbShmaWxlRGF0YSwgb3B0aW9ucywgam9iSWQgPSAnTi9BJykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlOkFQSV9DQUxMX1NUQVJUXVtqb2JJZDoke2pvYklkfV0gVHJhbnNjcmliaW5nIHdpdGggRGVlcGdyYW0uIE9wdGlvbnM6YCwgc2FuaXRpemVGb3JMb2dnaW5nKG9wdGlvbnMpKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEVuc3VyZSBEZWVwZ3JhbSBjbGllbnQgaXMgY29uZmlndXJlZFxyXG4gICAgICAgICAgICB0aGlzLmVuc3VyZUNvbmZpZ3VyZWQoKTsgLy8gVGhpcyB3aWxsIHRocm93IGlmIG5vdCBjb25maWd1cmVkXHJcblxyXG4gICAgICAgICAgICBjb25zdCB7IHJlc3VsdCwgZXJyb3I6IGRnRXJyb3IgfSA9IGF3YWl0IHRoaXMuZGVlcGdyYW0ubGlzdGVuLnByZXJlY29yZGVkLnRyYW5zY3JpYmVGaWxlKFxyXG4gICAgICAgICAgICAgICAgZmlsZURhdGEsIC8vIFRoaXMgc2hvdWxkIGJlIGEgQnVmZmVyXHJcbiAgICAgICAgICAgICAgICBvcHRpb25zXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoZGdFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0RlZXBncmFtU2VydmljZTpBUElfRVJST1JdW2pvYklkOiR7am9iSWR9XSBEZWVwZ3JhbSB0cmFuc2NyaXB0aW9uIGVycm9yOmAsIHNhbml0aXplRm9yTG9nZ2luZyhkZ0Vycm9yKSk7XHJcbiAgICAgICAgICAgICAgICAvLyBBdHRlbXB0IHRvIGdldCBtb3JlIGRldGFpbHMgZnJvbSB0aGUgZXJyb3Igb2JqZWN0IGlmIGl0J3Mgc3RydWN0dXJlZFxyXG4gICAgICAgICAgICAgICAgbGV0IGVycm9yTWVzc2FnZSA9IGBEZWVwZ3JhbSBBUEkgZXJyb3I6ICR7ZGdFcnJvci5tZXNzYWdlIHx8ICdVbmtub3duIGVycm9yJ31gO1xyXG4gICAgICAgICAgICAgICAgaWYgKGRnRXJyb3Iuc3RhdHVzKSBlcnJvck1lc3NhZ2UgKz0gYCAoU3RhdHVzOiAke2RnRXJyb3Iuc3RhdHVzfSlgO1xyXG4gICAgICAgICAgICAgICAgaWYgKGRnRXJyb3IuYm9keSAmJiB0eXBlb2YgZGdFcnJvci5ib2R5ID09PSAnb2JqZWN0Jykge1xyXG4gICAgICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2UgKz0gYCBEZXRhaWxzOiAke0pTT04uc3RyaW5naWZ5KHNhbml0aXplRm9yTG9nZ2luZyhkZ0Vycm9yLmJvZHkpKX1gO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChkZ0Vycm9yLmJvZHkpIHtcclxuICAgICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2UgKz0gYCBCb2R5OiAke1N0cmluZyhkZ0Vycm9yLmJvZHkpLnN1YnN0cmluZygwLDIwMCl9YDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoIXJlc3VsdCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0RlZXBncmFtU2VydmljZTpBUElfTk9fUkVTVUxUXVtqb2JJZDoke2pvYklkfV0gRGVlcGdyYW0gQVBJIHJldHVybmVkIG5vIHJlc3VsdCBvYmplY3QuYCk7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0RlZXBncmFtIEFQSSByZXR1cm5lZCBubyByZXN1bHQuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRGVlcGdyYW1TZXJ2aWNlOkFQSV9TVUNDRVNTXVtqb2JJZDoke2pvYklkfV0gVHJhbnNjcmlwdGlvbiBzdWNjZXNzZnVsLiBSZXN1bHQgc3VtbWFyeTpgLCBcclxuICAgICAgICAgICAgICAgIHNhbml0aXplRm9yTG9nZ2luZyh7IFxyXG4gICAgICAgICAgICAgICAgICAgIGNoYW5uZWxzOiByZXN1bHQucmVzdWx0cz8uY2hhbm5lbHM/Lmxlbmd0aCwgXHJcbiAgICAgICAgICAgICAgICAgICAgbWV0YWRhdGFEdXJhdGlvbjogcmVzdWx0Lm1ldGFkYXRhPy5kdXJhdGlvbiBcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgLy8gQ2F0Y2ggYW5kIHJlLXRocm93IHdpdGggbW9yZSBjb250ZXh0IGlmIGl0J3Mgbm90IGFscmVhZHkgYSBkZXRhaWxlZCBlcnJvclxyXG4gICAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlIHx8ICdVbmtub3duIGVycm9yIGR1cmluZyBEZWVwZ3JhbSB0cmFuc2NyaXB0aW9uJztcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0RlZXBncmFtU2VydmljZTpUUkFOU0NSSUJFX0VYQ0VQVElPTl1bam9iSWQ6JHtqb2JJZH1dIEVycm9yIGluIERlZXBncmFtIHRyYW5zY3JpcHRpb246YCwgc2FuaXRpemVGb3JMb2dnaW5nKGVycm9yKSk7XHJcbiAgICAgICAgICAgIGlmIChlcnJvci5tZXNzYWdlICYmIGVycm9yLm1lc3NhZ2Uuc3RhcnRzV2l0aCgnRGVlcGdyYW0gQVBJIGVycm9yOicpKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjsgLy8gQWxyZWFkeSBhIGRldGFpbGVkIGVycm9yIGZyb20gYWJvdmVcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRyYW5zY3JpcHRpb24gY2FsbCBmYWlsZWQ6ICR7ZXJyb3JNZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEZvcm1hdCBEZWVwZ3JhbSB0cmFuc2NyaXB0aW9uIHJlc3VsdFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJhd1Jlc3VsdCAtIFJhdyBEZWVwZ3JhbSByZXN1bHRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gRm9ybWF0dGluZyBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBGb3JtYXR0ZWQgcmVzdWx0XHJcbiAgICAgKi9cclxuICAgIGZvcm1hdFRyYW5zY3JpcHRpb25SZXN1bHQocmF3UmVzdWx0LCBvcHRpb25zLCBqb2JJZCA9ICdOL0EnKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2U6Rk9STUFUVElOR19SRVNVTFRdW2pvYklkOiR7am9iSWR9XSBSYXcgcmVzdWx0OmAsIHNhbml0aXplRm9yTG9nZ2luZyhyYXdSZXN1bHQpKTtcclxuICAgICAgICAgICAgbGV0IHRyYW5zY3JpcHQgPSAnJztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChyYXdSZXN1bHQgJiYgcmF3UmVzdWx0LnJlc3VsdHMgJiYgcmF3UmVzdWx0LnJlc3VsdHMuY2hhbm5lbHMgJiYgcmF3UmVzdWx0LnJlc3VsdHMuY2hhbm5lbHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY2hhbm5lbCA9IHJhd1Jlc3VsdC5yZXN1bHRzLmNoYW5uZWxzWzBdO1xyXG4gICAgICAgICAgICAgICAgaWYgKGNoYW5uZWwuYWx0ZXJuYXRpdmVzICYmIGNoYW5uZWwuYWx0ZXJuYXRpdmVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgICAgICB0cmFuc2NyaXB0ID0gY2hhbm5lbC5hbHRlcm5hdGl2ZXNbMF0udHJhbnNjcmlwdCB8fCAnJztcclxuICAgICAgICAgICAgICAgICAgICBpZiAoY2hhbm5lbC5hbHRlcm5hdGl2ZXNbMF0ucGFyYWdyYXBocykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBJZiBwYXJhZ3JhcGhzIGFyZSBhdmFpbGFibGUgKGUuZy4sIHdpdGggZGlhcml6ZTogdHJ1ZSksIGNvbnN0cnVjdCB0cmFuc2NyaXB0IGZyb20gdGhlbVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2NyaXB0ID0gY2hhbm5lbC5hbHRlcm5hdGl2ZXNbMF0ucGFyYWdyYXBocy50cmFuc2NyaXB0IHx8IHRyYW5zY3JpcHQ7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGBbRGVlcGdyYW1TZXJ2aWNlOkZPUk1BVFRJTkdfV0FSTl1bam9iSWQ6JHtqb2JJZH1dIFVuZXhwZWN0ZWQgcmF3IHJlc3VsdCBzdHJ1Y3R1cmUgb3IgZW1wdHkgcmVzdWx0LmApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IHJhd1Jlc3VsdC5tZXRhZGF0YSB8fCB7fTtcclxuICAgICAgICAgICAgY29uc3QgZHVyYXRpb24gPSBtZXRhZGF0YS5kdXJhdGlvbiB8fCAwO1xyXG4gICAgICAgICAgICBjb25zdCBsYW5ndWFnZSA9IG9wdGlvbnMubGFuZ3VhZ2UgfHwgKG1ldGFkYXRhLmxhbmd1YWdlIHx8ICdlbicpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgZm9ybWF0dGVkID0ge1xyXG4gICAgICAgICAgICAgICAgdGV4dDogdHJhbnNjcmlwdC50cmltKCksXHJcbiAgICAgICAgICAgICAgICBsYW5ndWFnZTogbGFuZ3VhZ2UsXHJcbiAgICAgICAgICAgICAgICBkdXJhdGlvbjogZHVyYXRpb24sXHJcbiAgICAgICAgICAgICAgICBtb2RlbDogb3B0aW9ucy5tb2RlbCB8fCBzZXR0aW5nc1N0b3JlLmdldCgndHJhbnNjcmlwdGlvbi5tb2RlbCcsICdub3ZhLTInKSxcclxuICAgICAgICAgICAgICAgIHByb3ZpZGVyOiAnZGVlcGdyYW0nLFxyXG4gICAgICAgICAgICAgICAgcmF3UmVzcG9uc2U6IG9wdGlvbnMuaW5jbHVkZVJhd1Jlc3BvbnNlID8gc2FuaXRpemVGb3JMb2dnaW5nKHJhd1Jlc3VsdCkgOiB1bmRlZmluZWRcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtEZWVwZ3JhbVNlcnZpY2U6Rk9STUFUVElOR19TVUNDRVNTXVtqb2JJZDoke2pvYklkfV0gRm9ybWF0dGVkIHJlc3VsdDpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcoZm9ybWF0dGVkKSk7XHJcbiAgICAgICAgICAgIHJldHVybiBmb3JtYXR0ZWQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IubWVzc2FnZSB8fCAnVW5rbm93biBlcnJvciBmb3JtYXR0aW5nIHJlc3VsdCc7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtEZWVwZ3JhbVNlcnZpY2U6Rk9STUFUVElOR19FUlJPUl1bam9iSWQ6JHtqb2JJZH1dIEVycm9yIGZvcm1hdHRpbmcgdHJhbnNjcmlwdGlvbiByZXN1bHQ6YCwgc2FuaXRpemVGb3JMb2dnaW5nKGVycm9yKSk7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGZvcm1hdCB0cmFuc2NyaXB0aW9uIHJlc3VsdDogJHtlcnJvck1lc3NhZ2V9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogVXBkYXRlIGpvYiBzdGF0dXMgYW5kIG5vdGlmeSByZW5kZXJlclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkZW50aWZpZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzdGF0dXMgLSBOZXcgc3RhdHVzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gZGV0YWlscyAtIEFkZGl0aW9uYWwgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICB1cGRhdGVKb2JTdGF0dXMoam9iSWQsIHN0YXR1cywgZGV0YWlscyA9IHt9KSB7XHJcbiAgICAgICAgY29uc3Qgam9iID0gdGhpcy5hY3RpdmVKb2JzLmdldChqb2JJZCk7XHJcbiAgICAgICAgaWYgKGpvYikge1xyXG4gICAgICAgICAgICBqb2Iuc3RhdHVzID0gc3RhdHVzO1xyXG4gICAgICAgICAgICBPYmplY3QuYXNzaWduKGpvYiwgZGV0YWlscyk7XHJcblxyXG4gICAgICAgICAgICBpZiAoam9iLndpbmRvdykge1xyXG4gICAgICAgICAgICAgICAgam9iLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCd0cmFuc2NyaWJlOnByb2dyZXNzJywge1xyXG4gICAgICAgICAgICAgICAgICAgIGpvYklkLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cyxcclxuICAgICAgICAgICAgICAgICAgICAuLi5kZXRhaWxzXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxufVxyXG5cclxuLy8gQ3JlYXRlIGFuZCBleHBvcnQgdGhlIHNpbmdsZXRvbiBpbnN0YW5jZVxyXG5jb25zdCBkZWVwZ3JhbVNlcnZpY2VJbnN0YW5jZSA9IG5ldyBEZWVwZ3JhbVNlcnZpY2UoKTtcclxubW9kdWxlLmV4cG9ydHMgPSBkZWVwZ3JhbVNlcnZpY2VJbnN0YW5jZTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDOUIsTUFBTTtFQUFFRTtBQUFhLENBQUMsR0FBR0YsT0FBTyxDQUFDLGVBQWUsQ0FBQztBQUNqRCxNQUFNO0VBQUVHO0FBQU8sQ0FBQyxHQUFHSCxPQUFPLENBQUMsYUFBYSxDQUFDO0FBQ3pDLE1BQU07RUFBRUksRUFBRSxFQUFFQztBQUFPLENBQUMsR0FBR0wsT0FBTyxDQUFDLE1B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