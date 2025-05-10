/**
 * TranscriberService.js
 * Handles audio and video transcription in the Electron main process.
 * 
 * This service handles:
 * - Media file transcription through Deepgram
 * - Result formatting and callback
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - FileStorageService.js: For temporary file management
 */

const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const BaseService = require('../BaseService');
const { createStore } = require('../../utils/storeFactory');
const fileStorageServiceInstance = require('../storage/FileStorageService');

// Settings store for model selection
const settingsStore = createStore('settings');

class TranscriberService extends BaseService {
    constructor() { 
        super();
        this.fileStorage = fileStorageServiceInstance; 
        this.activeJobs = new Map();
        
        // Initialize Deepgram client if available
        this.initializeDeepgram();
    }
    
    /**
     * Initialize Deepgram client
     */
    async initializeDeepgram() {
        try {
            // Import Deepgram SDK
            const { Deepgram } = await import('@deepgram/sdk');
            
            // Get API key from environment or settings
            const apiKey = process.env.DEEPGRAM_API_KEY || settingsStore.get('transcription.deepgramApiKey');
            
            if (apiKey) {
                this.deepgram = new Deepgram(apiKey);
                console.log('[TranscriberService] Deepgram client initialized');
            } else {
                console.log('[TranscriberService] No Deepgram API key found');
                this.deepgram = null;
            }
        } catch (error) {
            console.error('[TranscriberService] Failed to initialize Deepgram:', error);
            this.deepgram = null;
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
     * Handle configuration request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} options - Configuration options with API key
     * @returns {Promise<Object>} Configuration result
     */
    async handleConfigure(event, { apiKey }) {
        try {
            if (!apiKey) {
                return { success: false, error: 'API key is required' };
            }
            
            // Store API key in settings
            settingsStore.set('transcription.deepgramApiKey', apiKey);
            
            // Initialize Deepgram client with new API key
            const { Deepgram } = await import('@deepgram/sdk');
            this.deepgram = new Deepgram(apiKey);
            
            console.log('[TranscriberService] Deepgram client configured with new API key');
            return { success: true };
        } catch (error) {
            console.error('[TranscriberService] Failed to configure Deepgram:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Handle transcription start request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Transcription request details
     */
    async handleTranscribeStart(event, { filePath, options = {} }) {
        try {
            // Use API key from options if provided
            if (options.apiKey) {
                await this.handleConfigure(event, { apiKey: options.apiKey });
            }
            
            // Check if Deepgram is initialized
            if (!this.deepgram) {
                throw new Error('Deepgram client not initialized. Please configure API key first.');
            }
            
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
                console.error(`[TranscriberService] Transcription failed for job ${jobId}:`, error);
                this.updateJobStatus(jobId, 'failed', { error: error.message });
            });

            return { jobId };
        } catch (error) {
            console.error('[TranscriberService] Failed to start transcription:', error);
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
            this.updateJobStatus(jobId, 'transcribing', { progress: 10 });
            
            // Get transcription model from settings or use default
            const model = options.model || settingsStore.get('transcription.model', 'nova-2');
            console.log(`[TranscriberService] Using Deepgram model: ${model}`);
            
            // Read file as buffer
            const audioBuffer = await fs.readFile(filePath);
            
            // Create source from buffer
            const source = {
                buffer: audioBuffer,
                mimetype: 'audio/mp3' // Default mimetype; adjust based on file type if needed
            };
            
            // Set transcription options
            const deepgramOptions = {
                model: model,
                language: options.language || 'en',
                smart_format: true,
                diarize: true
            };
            
            // Update job status
            this.updateJobStatus(jobId, 'transcribing', { 
                progress: 30,
                model: model
            });
            
            // Request transcription
            console.log('[TranscriberService] Sending transcription request to Deepgram');
            const response = await this.deepgram.transcription.preRecorded(source, deepgramOptions);
            
            // Process the response
            const transcription = this.processDeepgramResponse(response);
            
            // Update job status
            this.updateJobStatus(jobId, 'completed', { 
                progress: 100,
                result: transcription
            });
            
            // Clean up temp files
            await fs.remove(this.activeJobs.get(jobId).tempDir);
            
            return transcription;
        } catch (error) {
            console.error('[TranscriberService] Transcription processing failed:', error);
            throw error;
        }
    }
    
    /**
     * Process Deepgram response
     * @param {Object} response - Deepgram response
     * @returns {Object} Processed transcription
     */
    processDeepgramResponse(response) {
        try {
            console.log('[TranscriberService] Processing Deepgram response');
            
            if (!response || !response.results) {
                throw new Error('Invalid Deepgram response');
            }
            
            // Get the transcript
            const transcript = response.results.channels[0]?.alternatives[0]?.transcript || '';
            
            // Get the language
            const language = response.results.channels[0]?.alternatives[0]?.language || 'en';
            
            // Format paragraphs if available
            let formattedText = transcript;
            
            if (response.results.channels[0]?.alternatives[0]?.paragraphs) {
                const paragraphs = response.results.channels[0].alternatives[0].paragraphs.paragraphs;
                formattedText = paragraphs.map(p => p.text).join('\n\n');
            }
            
            return {
                text: formattedText,
                language: language,
                metadata: {
                    model: response.metadata?.model || 'unknown',
                    duration: response.metadata?.duration || 0
                }
            };
        } catch (error) {
            console.error('[TranscriberService] Error processing Deepgram response:', error);
            return {
                text: 'Transcription failed. Please try again.',
                language: 'en',
                error: error.message
            };
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

    /**
     * Clean up job resources
     * @param {string} jobId - Job identifier
     */
    async cleanupJob(jobId) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            await fs.remove(job.tempDir);
            this.activeJobs.delete(jobId);
        }
    }
    
    /**
     * Transcribe video file (convenience method)
     * @param {string} videoPath - Path to video file
     * @param {string} apiKey - Optional Deepgram API key
     * @returns {Promise<string>} Transcription text
     */
    async transcribeVideo(videoPath, apiKey) {
        console.log(`🎬 Transcribing video: ${videoPath}`);
        try {
            // Deepgram can transcribe video files directly without extraction
            return await this.transcribeAudio(videoPath, apiKey);
        } catch (error) {
            console.error('Video transcription error:', error);
            const model = await this._getSelectedModel();
            return `[Transcription placeholder for ${videoPath} using ${model}]`;
        }
    }
    
    /**
     * Transcribe audio file (convenience method)
     * @param {string} audioPath - Path to audio file
     * @param {string} apiKey - Optional Deepgram API key
     * @returns {Promise<string>} Transcription text
     */
    async transcribeAudio(audioPath, apiKey) {
        console.log(`🎵 Transcribing audio: ${audioPath}`);
        try {
            // Configure with API key if provided
            if (apiKey) {
                await this.handleConfigure(null, { apiKey });
            }
            
            // Start transcription job
            const { jobId } = await this.handleTranscribeStart(null, {
                filePath: audioPath,
                options: { 
                    model: await this._getSelectedModel(),
                    language: 'en'
                }
            });
            
            // Check job status until complete or failed
            return await this._waitForTranscription(jobId);
        } catch (error) {
            console.error('Audio transcription error:', error);
            return `[Transcription error: ${error.message}]`;
        }
    }
    
    /**
     * Wait for transcription job to complete
     * @param {string} jobId - Job ID
     * @returns {Promise<string>} Transcription text
     * @private
     */
    async _waitForTranscription(jobId) {
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(async () => {
                try {
                    const status = await this.handleTranscribeStatus(null, { jobId });
                    
                    if (status.status === 'completed') {
                        clearInterval(checkInterval);
                        resolve(status.result.text);
                    } else if (status.status === 'failed' || status.status === 'not_found') {
                        clearInterval(checkInterval);
                        reject(new Error(status.error || 'Transcription failed'));
                    }
                } catch (error) {
                    clearInterval(checkInterval);
                    reject(error);
                }
            }, 1000); // Check every second
            
            // Set timeout after 5 minutes
            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error('Transcription timed out'));
            }, 5 * 60 * 1000);
        });
    }
    
    /**
     * Get selected transcription model from settings
     * @returns {Promise<string>} Model name
     * @private
     */
    async _getSelectedModel() {
        return settingsStore.get('transcription.model', 'nova-2');
    }
}

// Create and export the singleton instance
const transcriberServiceInstance = new TranscriberService();
module.exports = transcriberServiceInstance;