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
const { createClient } = require('@deepgram/sdk');
const { Buffer } = require('node:buffer');
const { v4: uuidv4 } = require('uuid');
const BaseService = require('../BaseService');
const { createStore } = require('../../utils/storeFactory');
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
        super({ skipHandlerSetup: true });

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
            const { ipcMain } = require('electron');
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
    async handleConfigure(event, { apiKey }) {
        try {
            // Create Deepgram client with API key
            this.deepgram = createClient(apiKey);
            
            // Test the connection with a simple request
            // Just checking if the client is working, not actually making a transcription
            if (!this.deepgram) {
                throw new Error('Failed to initialize Deepgram client');
            }
            
            console.log('[DeepgramService] Successfully configured with API key');
            return { success: true };
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
    async handleTranscribeStart(event, { filePath, options = {} }) {
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
                this.updateJobStatus(jobId, 'failed', { error: errorMessage, details: sanitizeForLogging(error) });
            });

            return { jobId };
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
    async handleTranscribeStatus(event, { jobId }) {
        const job = this.activeJobs.get(jobId);
        return job || { status: 'not_found' };
    }

    /**
     * Handle transcription cancellation request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Cancellation request details
     */
    async handleTranscribeCancel(event, { jobId }) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.status = 'cancelled';
            // Clean up temporary files
            await fs.remove(job.tempDir);
            this.activeJobs.delete(jobId);
        }
        return { success: true };
    }

    /**
     * Process transcription job
     * @param {string} jobId - Job identifier
     * @param {string} filePath - Path to media file
     * @param {Object} options - Transcription options
     */
    async processTranscription(jobId, filePath, options) {
        try {
            this.updateJobStatus(jobId, 'preparing', { progress: 5 });
            console.log(`[DeepgramService:PREPARING][jobId:${jobId}] Processing job for file: ${filePath}`);
            console.log(`[DeepgramService:PREPARING][jobId:${jobId}] Options:`, sanitizeForLogging(options));

            // Verify file exists
            if (!await fs.pathExists(filePath)) {
                console.error(`[DeepgramService:VALIDATION_FAILED][jobId:${jobId}] File not found: ${filePath}`);
                throw new Error(`File not found: ${filePath}`);
            }
            this.updateJobStatus(jobId, 'validating', { progress: 10 });

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
            this.updateJobStatus(jobId, 'processing', { progress: 15 });

            // Read the file
            console.log(`[DeepgramService:READING_FILE][jobId:${jobId}] Reading file content...`);
            const fileData = await fs.readFile(filePath);
            console.log(`[DeepgramService:READING_FILE][jobId:${jobId}] File read successfully (Buffer length: ${fileData.length})`);
            this.updateJobStatus(jobId, 'transcribing', { progress: 30 });
            
            // Get transcription model from settings or use default
            const model = settingsStore.get('transcription.model', 'nova-2'); // Changed default to nova-2 for broader compatibility
            
            console.log(`[DeepgramService:TRANSCRIBING][jobId:${jobId}] Sending file to Deepgram API using model: ${model}`);
            const transcriptionResult = await this.transcribeWithDeepgram(
                fileData, 
                {
                    model: model,
                    smart_format: true,
                    punctuate: true, // Added for better formatting
                    diarize: options.diarize || false, // Speaker diarization
                    utterances: options.utterances || false, // Utterance splitting
                    language: options.language || 'en',
                    ...options.deepgramOptions // Allow overriding with specific deepgram options
                },
                jobId
            );
            
            this.updateJobStatus(jobId, 'formatting', { progress: 90 });
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

            this.updateJobStatus(jobId, 'completed', { result });
            console.log(`[DeepgramService:COMPLETED][jobId:${jobId}] Transcription completed successfully.`);
            return result;
        } catch (error) {
            const errorMessage = error.message || 'Unknown transcription processing error';
            console.error(`[DeepgramService:FAILED][jobId:${jobId}] Transcription processing failed:`, sanitizeForLogging(error));
            this.updateJobStatus(jobId, 'failed', { 
                error: errorMessage,
                details: sanitizeForLogging({
                    name: error.name,
                    code: error.code,
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

            const { result, error: dgError } = await this.deepgram.listen.prerecorded.transcribeFile(
                fileData, // This should be a Buffer
                options
            );
            
            if (dgError) {
                console.error(`[DeepgramService:API_ERROR][jobId:${jobId}] Deepgram transcription error:`, sanitizeForLogging(dgError));
                // Attempt to get more details from the error object if it's structured
                let errorMessage = `Deepgram API error: ${dgError.message || 'Unknown error'}`;
                if (dgError.status) errorMessage += ` (Status: ${dgError.status})`;
                if (dgError.body && typeof dgError.body === 'object') {
                     errorMessage += ` Details: ${JSON.stringify(sanitizeForLogging(dgError.body))}`;
                } else if (dgError.body) {
                    errorMessage += ` Body: ${String(dgError.body).substring(0,200)}`;
                }
                throw new Error(errorMessage);
            }
            
            if (!result) {
                console.error(`[DeepgramService:API_NO_RESULT][jobId:${jobId}] Deepgram API returned no result object.`);
                throw new Error('Deepgram API returned no result.');
            }
            
            console.log(`[DeepgramService:API_SUCCESS][jobId:${jobId}] Transcription successful. Result summary:`, 
                sanitizeForLogging({ 
                    channels: result.results?.channels?.length, 
                    metadataDuration: result.metadata?.duration 
                })
            );
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
            const language = options.language || (metadata.language || 'en');
            
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
