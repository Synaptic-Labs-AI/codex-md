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

// Max chunk size for files (100MB)
const MAX_CHUNK_SIZE = 100 * 1024 * 1024;

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
    async handleTranscribeStart(event, { filePath, options = {} }) {
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
                this.updateJobStatus(jobId, 'failed', { error: error.message });
            });

            return { jobId };
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
            this.updateJobStatus(jobId, 'preparing');
            console.log(`[DeepgramService] Processing job ${jobId} for file: ${filePath}`);
            console.log(`[DeepgramService] Options:`, JSON.stringify(options, null, 2));

            // Verify file exists
            if (!await fs.pathExists(filePath)) {
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
            this.updateJobStatus(jobId, 'transcribing', { progress: 30 });
            
            // Get transcription model from settings or use default
            const model = settingsStore.get('transcription.model', 'nova-3');
            
            const transcriptionResult = await this.transcribeWithDeepgram(
                fileData, 
                {
                    model: model,
                    smart_format: true,
                    language: options.language || 'en',
                    ...options.deepgramOptions
                }
            );
            
            this.updateJobStatus(jobId, 'formatting', { progress: 90 });
            
            // Format the result
            const result = this.formatTranscriptionResult(transcriptionResult, options);
            
            // Clean up temp files
            await fs.remove(this.activeJobs.get(jobId).tempDir);
            console.log(`[DeepgramService] Cleaned up temporary files for job ${jobId}`);

            this.updateJobStatus(jobId, 'completed', { result });
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
            
            const { result, error } = await this.deepgram.listen.prerecorded.transcribeFile(
                fileData,
                options
            );
            
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
            if (rawResult.results && 
                rawResult.results.channels && 
                rawResult.results.channels.length > 0 && 
                rawResult.results.channels[0].alternatives && 
                rawResult.results.channels[0].alternatives.length > 0) {
                
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