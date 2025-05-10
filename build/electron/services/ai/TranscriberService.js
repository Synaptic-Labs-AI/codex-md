"use strict";

function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
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
const {
  v4: uuidv4
} = require('uuid');
const BaseService = require('../BaseService');
const {
  createStore
} = require('../../utils/storeFactory');
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
      const {
        Deepgram
      } = await Promise.resolve().then(() => _interopRequireWildcard(require('@deepgram/sdk')));

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
  async handleConfigure(event, {
    apiKey
  }) {
    try {
      if (!apiKey) {
        return {
          success: false,
          error: 'API key is required'
        };
      }

      // Store API key in settings
      settingsStore.set('transcription.deepgramApiKey', apiKey);

      // Initialize Deepgram client with new API key
      const {
        Deepgram
      } = await Promise.resolve().then(() => _interopRequireWildcard(require('@deepgram/sdk')));
      this.deepgram = new Deepgram(apiKey);
      console.log('[TranscriberService] Deepgram client configured with new API key');
      return {
        success: true
      };
    } catch (error) {
      console.error('[TranscriberService] Failed to configure Deepgram:', error);
      return {
        success: false,
        error: error.message
      };
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
      // Use API key from options if provided
      if (options.apiKey) {
        await this.handleConfigure(event, {
          apiKey: options.apiKey
        });
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
        this.updateJobStatus(jobId, 'failed', {
          error: error.message
        });
      });
      return {
        jobId
      };
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
      this.updateJobStatus(jobId, 'transcribing', {
        progress: 10
      });

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
        await this.handleConfigure(null, {
          apiKey
        });
      }

      // Start transcription job
      const {
        jobId
      } = await this.handleTranscribeStart(null, {
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
          const status = await this.handleTranscribeStatus(null, {
            jobId
          });
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwidjQiLCJ1dWlkdjQiLCJCYXNlU2VydmljZSIsImNyZWF0ZVN0b3JlIiwiZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UiLCJzZXR0aW5nc1N0b3JlIiwiVHJhbnNjcmliZXJTZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJmaWxlU3RvcmFnZSIsImFjdGl2ZUpvYnMiLCJNYXAiLCJpbml0aWFsaXplRGVlcGdyYW0iLCJEZWVwZ3JhbSIsIlByb21pc2UiLCJyZXNvbHZlIiwidGhlbiIsIl9pbnRlcm9wUmVxdWlyZVdpbGRjYXJkIiwiYXBpS2V5IiwicHJvY2VzcyIsImVudiIsIkRFRVBHUkFNX0FQSV9LRVkiLCJnZXQiLCJkZWVwZ3JhbSIsImNvbnNvbGUiLCJsb2ciLCJlcnJvciIsInNldHVwSXBjSGFuZGxlcnMiLCJyZWdpc3RlckhhbmRsZXIiLCJoYW5kbGVUcmFuc2NyaWJlU3RhcnQiLCJiaW5kIiwiaGFuZGxlVHJhbnNjcmliZVN0YXR1cyIsImhhbmRsZVRyYW5zY3JpYmVDYW5jZWwiLCJoYW5kbGVDb25maWd1cmUiLCJldmVudCIsInN1Y2Nlc3MiLCJzZXQiLCJtZXNzYWdlIiwiZmlsZVBhdGgiLCJvcHRpb25zIiwiRXJyb3IiLCJqb2JJZCIsInRlbXBEaXIiLCJjcmVhdGVUZW1wRGlyIiwic3RhdHVzIiwicHJvZ3Jlc3MiLCJ3aW5kb3ciLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJwcm9jZXNzVHJhbnNjcmlwdGlvbiIsImNhdGNoIiwidXBkYXRlSm9iU3RhdHVzIiwiam9iIiwicmVtb3ZlIiwiZGVsZXRlIiwibW9kZWwiLCJhdWRpb0J1ZmZlciIsInJlYWRGaWxlIiwic291cmNlIiwiYnVmZmVyIiwibWltZXR5cGUiLCJkZWVwZ3JhbU9wdGlvbnMiLCJsYW5ndWFnZSIsInNtYXJ0X2Zvcm1hdCIsImRpYXJpemUiLCJyZXNwb25zZSIsInRyYW5zY3JpcHRpb24iLCJwcmVSZWNvcmRlZCIsInByb2Nlc3NEZWVwZ3JhbVJlc3BvbnNlIiwicmVzdWx0IiwicmVzdWx0cyIsInRyYW5zY3JpcHQiLCJjaGFubmVscyIsImFsdGVybmF0aXZlcyIsImZvcm1hdHRlZFRleHQiLCJwYXJhZ3JhcGhzIiwibWFwIiwicCIsInRleHQiLCJqb2luIiwibWV0YWRhdGEiLCJkdXJhdGlvbiIsImRldGFpbHMiLCJPYmplY3QiLCJhc3NpZ24iLCJ3ZWJDb250ZW50cyIsInNlbmQiLCJjbGVhbnVwSm9iIiwidHJhbnNjcmliZVZpZGVvIiwidmlkZW9QYXRoIiwidHJhbnNjcmliZUF1ZGlvIiwiX2dldFNlbGVjdGVkTW9kZWwiLCJhdWRpb1BhdGgiLCJfd2FpdEZvclRyYW5zY3JpcHRpb24iLCJyZWplY3QiLCJjaGVja0ludGVydmFsIiwic2V0SW50ZXJ2YWwiLCJjbGVhckludGVydmFsIiwic2V0VGltZW91dCIsInRyYW5zY3JpYmVyU2VydmljZUluc3RhbmNlIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9haS9UcmFuc2NyaWJlclNlcnZpY2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFRyYW5zY3JpYmVyU2VydmljZS5qc1xyXG4gKiBIYW5kbGVzIGF1ZGlvIGFuZCB2aWRlbyB0cmFuc2NyaXB0aW9uIGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXHJcbiAqIFxyXG4gKiBUaGlzIHNlcnZpY2UgaGFuZGxlczpcclxuICogLSBNZWRpYSBmaWxlIHRyYW5zY3JpcHRpb24gdGhyb3VnaCBEZWVwZ3JhbVxyXG4gKiAtIFJlc3VsdCBmb3JtYXR0aW5nIGFuZCBjYWxsYmFja1xyXG4gKiBcclxuICogUmVsYXRlZCBGaWxlczpcclxuICogLSBCYXNlU2VydmljZS5qczogUGFyZW50IGNsYXNzIHByb3ZpZGluZyBJUEMgaGFuZGxpbmdcclxuICogLSBGaWxlU3RvcmFnZVNlcnZpY2UuanM6IEZvciB0ZW1wb3JhcnkgZmlsZSBtYW5hZ2VtZW50XHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCB7IHY0OiB1dWlkdjQgfSA9IHJlcXVpcmUoJ3V1aWQnKTtcclxuY29uc3QgQmFzZVNlcnZpY2UgPSByZXF1aXJlKCcuLi9CYXNlU2VydmljZScpO1xyXG5jb25zdCB7IGNyZWF0ZVN0b3JlIH0gPSByZXF1aXJlKCcuLi8uLi91dGlscy9zdG9yZUZhY3RvcnknKTtcclxuY29uc3QgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UgPSByZXF1aXJlKCcuLi9zdG9yYWdlL0ZpbGVTdG9yYWdlU2VydmljZScpO1xyXG5cclxuLy8gU2V0dGluZ3Mgc3RvcmUgZm9yIG1vZGVsIHNlbGVjdGlvblxyXG5jb25zdCBzZXR0aW5nc1N0b3JlID0gY3JlYXRlU3RvcmUoJ3NldHRpbmdzJyk7XHJcblxyXG5jbGFzcyBUcmFuc2NyaWJlclNlcnZpY2UgZXh0ZW5kcyBCYXNlU2VydmljZSB7XHJcbiAgICBjb25zdHJ1Y3RvcigpIHsgXHJcbiAgICAgICAgc3VwZXIoKTtcclxuICAgICAgICB0aGlzLmZpbGVTdG9yYWdlID0gZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2U7IFxyXG4gICAgICAgIHRoaXMuYWN0aXZlSm9icyA9IG5ldyBNYXAoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBJbml0aWFsaXplIERlZXBncmFtIGNsaWVudCBpZiBhdmFpbGFibGVcclxuICAgICAgICB0aGlzLmluaXRpYWxpemVEZWVwZ3JhbSgpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIEluaXRpYWxpemUgRGVlcGdyYW0gY2xpZW50XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGluaXRpYWxpemVEZWVwZ3JhbSgpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBJbXBvcnQgRGVlcGdyYW0gU0RLXHJcbiAgICAgICAgICAgIGNvbnN0IHsgRGVlcGdyYW0gfSA9IGF3YWl0IGltcG9ydCgnQGRlZXBncmFtL3NkaycpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IEFQSSBrZXkgZnJvbSBlbnZpcm9ubWVudCBvciBzZXR0aW5nc1xyXG4gICAgICAgICAgICBjb25zdCBhcGlLZXkgPSBwcm9jZXNzLmVudi5ERUVQR1JBTV9BUElfS0VZIHx8IHNldHRpbmdzU3RvcmUuZ2V0KCd0cmFuc2NyaXB0aW9uLmRlZXBncmFtQXBpS2V5Jyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoYXBpS2V5KSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmRlZXBncmFtID0gbmV3IERlZXBncmFtKGFwaUtleSk7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW1RyYW5zY3JpYmVyU2VydmljZV0gRGVlcGdyYW0gY2xpZW50IGluaXRpYWxpemVkJyk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW1RyYW5zY3JpYmVyU2VydmljZV0gTm8gRGVlcGdyYW0gQVBJIGtleSBmb3VuZCcpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5kZWVwZ3JhbSA9IG51bGw7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbVHJhbnNjcmliZXJTZXJ2aWNlXSBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBEZWVwZ3JhbTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRoaXMuZGVlcGdyYW0gPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIHRyYW5zY3JpcHRpb24gb3BlcmF0aW9uc1xyXG4gICAgICovXHJcbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCd0cmFuc2NyaWJlOnN0YXJ0JywgdGhpcy5oYW5kbGVUcmFuc2NyaWJlU3RhcnQuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ3RyYW5zY3JpYmU6c3RhdHVzJywgdGhpcy5oYW5kbGVUcmFuc2NyaWJlU3RhdHVzLmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCd0cmFuc2NyaWJlOmNhbmNlbCcsIHRoaXMuaGFuZGxlVHJhbnNjcmliZUNhbmNlbC5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignZGVlcGdyYW06Y29uZmlndXJlJywgdGhpcy5oYW5kbGVDb25maWd1cmUuYmluZCh0aGlzKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgY29uZmlndXJhdGlvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIHdpdGggQVBJIGtleVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gQ29uZmlndXJhdGlvbiByZXN1bHRcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlQ29uZmlndXJlKGV2ZW50LCB7IGFwaUtleSB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgaWYgKCFhcGlLZXkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogJ0FQSSBrZXkgaXMgcmVxdWlyZWQnIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFN0b3JlIEFQSSBrZXkgaW4gc2V0dGluZ3NcclxuICAgICAgICAgICAgc2V0dGluZ3NTdG9yZS5zZXQoJ3RyYW5zY3JpcHRpb24uZGVlcGdyYW1BcGlLZXknLCBhcGlLZXkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gSW5pdGlhbGl6ZSBEZWVwZ3JhbSBjbGllbnQgd2l0aCBuZXcgQVBJIGtleVxyXG4gICAgICAgICAgICBjb25zdCB7IERlZXBncmFtIH0gPSBhd2FpdCBpbXBvcnQoJ0BkZWVwZ3JhbS9zZGsnKTtcclxuICAgICAgICAgICAgdGhpcy5kZWVwZ3JhbSA9IG5ldyBEZWVwZ3JhbShhcGlLZXkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tUcmFuc2NyaWJlclNlcnZpY2VdIERlZXBncmFtIGNsaWVudCBjb25maWd1cmVkIHdpdGggbmV3IEFQSSBrZXknKTtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tUcmFuc2NyaWJlclNlcnZpY2VdIEZhaWxlZCB0byBjb25maWd1cmUgRGVlcGdyYW06JywgZXJyb3IpO1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgdHJhbnNjcmlwdGlvbiBzdGFydCByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gVHJhbnNjcmlwdGlvbiByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlVHJhbnNjcmliZVN0YXJ0KGV2ZW50LCB7IGZpbGVQYXRoLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIFVzZSBBUEkga2V5IGZyb20gb3B0aW9ucyBpZiBwcm92aWRlZFxyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy5hcGlLZXkpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQ29uZmlndXJlKGV2ZW50LCB7IGFwaUtleTogb3B0aW9ucy5hcGlLZXkgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIERlZXBncmFtIGlzIGluaXRpYWxpemVkXHJcbiAgICAgICAgICAgIGlmICghdGhpcy5kZWVwZ3JhbSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdEZWVwZ3JhbSBjbGllbnQgbm90IGluaXRpYWxpemVkLiBQbGVhc2UgY29uZmlndXJlIEFQSSBrZXkgZmlyc3QuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGpvYklkID0gdXVpZHY0KCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ3RyYW5zY3JpcHRpb24nKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlSm9icy5zZXQoam9iSWQsIHtcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3ByZXBhcmluZycsXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMCxcclxuICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxyXG4gICAgICAgICAgICAgICAgdGVtcERpcixcclxuICAgICAgICAgICAgICAgIC8vIEdldCB3aW5kb3cgb25seSBpZiBldmVudCBhbmQgc2VuZGVyIGV4aXN0IChjYWxsZWQgdmlhIElQQylcclxuICAgICAgICAgICAgICAgIHdpbmRvdzogZXZlbnQgJiYgZXZlbnQuc2VuZGVyID8gZXZlbnQuc2VuZGVyLmdldE93bmVyQnJvd3NlcldpbmRvdygpIDogbnVsbFxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIC8vIFN0YXJ0IHRyYW5zY3JpcHRpb24gcHJvY2Vzc1xyXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NUcmFuc2NyaXB0aW9uKGpvYklkLCBmaWxlUGF0aCwgb3B0aW9ucykuY2F0Y2goZXJyb3IgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1RyYW5zY3JpYmVyU2VydmljZV0gVHJhbnNjcmlwdGlvbiBmYWlsZWQgZm9yIGpvYiAke2pvYklkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUpvYlN0YXR1cyhqb2JJZCwgJ2ZhaWxlZCcsIHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHsgam9iSWQgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbVHJhbnNjcmliZXJTZXJ2aWNlXSBGYWlsZWQgdG8gc3RhcnQgdHJhbnNjcmlwdGlvbjonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSB0cmFuc2NyaXB0aW9uIHN0YXR1cyByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gU3RhdHVzIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVUcmFuc2NyaWJlU3RhdHVzKGV2ZW50LCB7IGpvYklkIH0pIHtcclxuICAgICAgICBjb25zdCBqb2IgPSB0aGlzLmFjdGl2ZUpvYnMuZ2V0KGpvYklkKTtcclxuICAgICAgICByZXR1cm4gam9iIHx8IHsgc3RhdHVzOiAnbm90X2ZvdW5kJyB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIHRyYW5zY3JpcHRpb24gY2FuY2VsbGF0aW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDYW5jZWxsYXRpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZVRyYW5zY3JpYmVDYW5jZWwoZXZlbnQsIHsgam9iSWQgfSkge1xyXG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuYWN0aXZlSm9icy5nZXQoam9iSWQpO1xyXG4gICAgICAgIGlmIChqb2IpIHtcclxuICAgICAgICAgICAgam9iLnN0YXR1cyA9ICdjYW5jZWxsZWQnO1xyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wb3JhcnkgZmlsZXNcclxuICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGpvYi50ZW1wRGlyKTtcclxuICAgICAgICAgICAgdGhpcy5hY3RpdmVKb2JzLmRlbGV0ZShqb2JJZCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgdHJhbnNjcmlwdGlvbiBqb2JcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIG1lZGlhIGZpbGVcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gVHJhbnNjcmlwdGlvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NUcmFuc2NyaXB0aW9uKGpvYklkLCBmaWxlUGF0aCwgb3B0aW9ucykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSm9iU3RhdHVzKGpvYklkLCAndHJhbnNjcmliaW5nJywgeyBwcm9ncmVzczogMTAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZXQgdHJhbnNjcmlwdGlvbiBtb2RlbCBmcm9tIHNldHRpbmdzIG9yIHVzZSBkZWZhdWx0XHJcbiAgICAgICAgICAgIGNvbnN0IG1vZGVsID0gb3B0aW9ucy5tb2RlbCB8fCBzZXR0aW5nc1N0b3JlLmdldCgndHJhbnNjcmlwdGlvbi5tb2RlbCcsICdub3ZhLTInKTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtUcmFuc2NyaWJlclNlcnZpY2VdIFVzaW5nIERlZXBncmFtIG1vZGVsOiAke21vZGVsfWApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gUmVhZCBmaWxlIGFzIGJ1ZmZlclxyXG4gICAgICAgICAgICBjb25zdCBhdWRpb0J1ZmZlciA9IGF3YWl0IGZzLnJlYWRGaWxlKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBzb3VyY2UgZnJvbSBidWZmZXJcclxuICAgICAgICAgICAgY29uc3Qgc291cmNlID0ge1xyXG4gICAgICAgICAgICAgICAgYnVmZmVyOiBhdWRpb0J1ZmZlcixcclxuICAgICAgICAgICAgICAgIG1pbWV0eXBlOiAnYXVkaW8vbXAzJyAvLyBEZWZhdWx0IG1pbWV0eXBlOyBhZGp1c3QgYmFzZWQgb24gZmlsZSB0eXBlIGlmIG5lZWRlZFxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gU2V0IHRyYW5zY3JpcHRpb24gb3B0aW9uc1xyXG4gICAgICAgICAgICBjb25zdCBkZWVwZ3JhbU9wdGlvbnMgPSB7XHJcbiAgICAgICAgICAgICAgICBtb2RlbDogbW9kZWwsXHJcbiAgICAgICAgICAgICAgICBsYW5ndWFnZTogb3B0aW9ucy5sYW5ndWFnZSB8fCAnZW4nLFxyXG4gICAgICAgICAgICAgICAgc21hcnRfZm9ybWF0OiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgZGlhcml6ZTogdHJ1ZVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gVXBkYXRlIGpvYiBzdGF0dXNcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVKb2JTdGF0dXMoam9iSWQsICd0cmFuc2NyaWJpbmcnLCB7IFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDMwLFxyXG4gICAgICAgICAgICAgICAgbW9kZWw6IG1vZGVsXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gUmVxdWVzdCB0cmFuc2NyaXB0aW9uXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbVHJhbnNjcmliZXJTZXJ2aWNlXSBTZW5kaW5nIHRyYW5zY3JpcHRpb24gcmVxdWVzdCB0byBEZWVwZ3JhbScpO1xyXG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZGVlcGdyYW0udHJhbnNjcmlwdGlvbi5wcmVSZWNvcmRlZChzb3VyY2UsIGRlZXBncmFtT3B0aW9ucyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBQcm9jZXNzIHRoZSByZXNwb25zZVxyXG4gICAgICAgICAgICBjb25zdCB0cmFuc2NyaXB0aW9uID0gdGhpcy5wcm9jZXNzRGVlcGdyYW1SZXNwb25zZShyZXNwb25zZSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBVcGRhdGUgam9iIHN0YXR1c1xyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUpvYlN0YXR1cyhqb2JJZCwgJ2NvbXBsZXRlZCcsIHsgXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMTAwLFxyXG4gICAgICAgICAgICAgICAgcmVzdWx0OiB0cmFuc2NyaXB0aW9uXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBmaWxlc1xyXG4gICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGhpcy5hY3RpdmVKb2JzLmdldChqb2JJZCkudGVtcERpcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gdHJhbnNjcmlwdGlvbjtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbVHJhbnNjcmliZXJTZXJ2aWNlXSBUcmFuc2NyaXB0aW9uIHByb2Nlc3NpbmcgZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgRGVlcGdyYW0gcmVzcG9uc2VcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXNwb25zZSAtIERlZXBncmFtIHJlc3BvbnNlXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBQcm9jZXNzZWQgdHJhbnNjcmlwdGlvblxyXG4gICAgICovXHJcbiAgICBwcm9jZXNzRGVlcGdyYW1SZXNwb25zZShyZXNwb25zZSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbVHJhbnNjcmliZXJTZXJ2aWNlXSBQcm9jZXNzaW5nIERlZXBncmFtIHJlc3BvbnNlJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoIXJlc3BvbnNlIHx8ICFyZXNwb25zZS5yZXN1bHRzKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgRGVlcGdyYW0gcmVzcG9uc2UnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IHRoZSB0cmFuc2NyaXB0XHJcbiAgICAgICAgICAgIGNvbnN0IHRyYW5zY3JpcHQgPSByZXNwb25zZS5yZXN1bHRzLmNoYW5uZWxzWzBdPy5hbHRlcm5hdGl2ZXNbMF0/LnRyYW5zY3JpcHQgfHwgJyc7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZXQgdGhlIGxhbmd1YWdlXHJcbiAgICAgICAgICAgIGNvbnN0IGxhbmd1YWdlID0gcmVzcG9uc2UucmVzdWx0cy5jaGFubmVsc1swXT8uYWx0ZXJuYXRpdmVzWzBdPy5sYW5ndWFnZSB8fCAnZW4nO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRm9ybWF0IHBhcmFncmFwaHMgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgICAgIGxldCBmb3JtYXR0ZWRUZXh0ID0gdHJhbnNjcmlwdDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChyZXNwb25zZS5yZXN1bHRzLmNoYW5uZWxzWzBdPy5hbHRlcm5hdGl2ZXNbMF0/LnBhcmFncmFwaHMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHBhcmFncmFwaHMgPSByZXNwb25zZS5yZXN1bHRzLmNoYW5uZWxzWzBdLmFsdGVybmF0aXZlc1swXS5wYXJhZ3JhcGhzLnBhcmFncmFwaHM7XHJcbiAgICAgICAgICAgICAgICBmb3JtYXR0ZWRUZXh0ID0gcGFyYWdyYXBocy5tYXAocCA9PiBwLnRleHQpLmpvaW4oJ1xcblxcbicpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgdGV4dDogZm9ybWF0dGVkVGV4dCxcclxuICAgICAgICAgICAgICAgIGxhbmd1YWdlOiBsYW5ndWFnZSxcclxuICAgICAgICAgICAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWw6IHJlc3BvbnNlLm1ldGFkYXRhPy5tb2RlbCB8fCAndW5rbm93bicsXHJcbiAgICAgICAgICAgICAgICAgICAgZHVyYXRpb246IHJlc3BvbnNlLm1ldGFkYXRhPy5kdXJhdGlvbiB8fCAwXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1RyYW5zY3JpYmVyU2VydmljZV0gRXJyb3IgcHJvY2Vzc2luZyBEZWVwZ3JhbSByZXNwb25zZTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICB0ZXh0OiAnVHJhbnNjcmlwdGlvbiBmYWlsZWQuIFBsZWFzZSB0cnkgYWdhaW4uJyxcclxuICAgICAgICAgICAgICAgIGxhbmd1YWdlOiAnZW4nLFxyXG4gICAgICAgICAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2VcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBVcGRhdGUgam9iIHN0YXR1cyBhbmQgbm90aWZ5IHJlbmRlcmVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWRlbnRpZmllclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHN0YXR1cyAtIE5ldyBzdGF0dXNcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBkZXRhaWxzIC0gQWRkaXRpb25hbCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIHVwZGF0ZUpvYlN0YXR1cyhqb2JJZCwgc3RhdHVzLCBkZXRhaWxzID0ge30pIHtcclxuICAgICAgICBjb25zdCBqb2IgPSB0aGlzLmFjdGl2ZUpvYnMuZ2V0KGpvYklkKTtcclxuICAgICAgICBpZiAoam9iKSB7XHJcbiAgICAgICAgICAgIGpvYi5zdGF0dXMgPSBzdGF0dXM7XHJcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oam9iLCBkZXRhaWxzKTtcclxuXHJcbiAgICAgICAgICAgIGlmIChqb2Iud2luZG93KSB7XHJcbiAgICAgICAgICAgICAgICBqb2Iud2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ3RyYW5zY3JpYmU6cHJvZ3Jlc3MnLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgam9iSWQsXHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLFxyXG4gICAgICAgICAgICAgICAgICAgIC4uLmRldGFpbHNcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2xlYW4gdXAgam9iIHJlc291cmNlc1xyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkZW50aWZpZXJcclxuICAgICAqL1xyXG4gICAgYXN5bmMgY2xlYW51cEpvYihqb2JJZCkge1xyXG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuYWN0aXZlSm9icy5nZXQoam9iSWQpO1xyXG4gICAgICAgIGlmIChqb2IpIHtcclxuICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGpvYi50ZW1wRGlyKTtcclxuICAgICAgICAgICAgdGhpcy5hY3RpdmVKb2JzLmRlbGV0ZShqb2JJZCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFRyYW5zY3JpYmUgdmlkZW8gZmlsZSAoY29udmVuaWVuY2UgbWV0aG9kKVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHZpZGVvUGF0aCAtIFBhdGggdG8gdmlkZW8gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGFwaUtleSAtIE9wdGlvbmFsIERlZXBncmFtIEFQSSBrZXlcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IFRyYW5zY3JpcHRpb24gdGV4dFxyXG4gICAgICovXHJcbiAgICBhc3luYyB0cmFuc2NyaWJlVmlkZW8odmlkZW9QYXRoLCBhcGlLZXkpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+OrCBUcmFuc2NyaWJpbmcgdmlkZW86ICR7dmlkZW9QYXRofWApO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIERlZXBncmFtIGNhbiB0cmFuc2NyaWJlIHZpZGVvIGZpbGVzIGRpcmVjdGx5IHdpdGhvdXQgZXh0cmFjdGlvblxyXG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy50cmFuc2NyaWJlQXVkaW8odmlkZW9QYXRoLCBhcGlLZXkpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1ZpZGVvIHRyYW5zY3JpcHRpb24gZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuX2dldFNlbGVjdGVkTW9kZWwoKTtcclxuICAgICAgICAgICAgcmV0dXJuIGBbVHJhbnNjcmlwdGlvbiBwbGFjZWhvbGRlciBmb3IgJHt2aWRlb1BhdGh9IHVzaW5nICR7bW9kZWx9XWA7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFRyYW5zY3JpYmUgYXVkaW8gZmlsZSAoY29udmVuaWVuY2UgbWV0aG9kKVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGF1ZGlvUGF0aCAtIFBhdGggdG8gYXVkaW8gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGFwaUtleSAtIE9wdGlvbmFsIERlZXBncmFtIEFQSSBrZXlcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IFRyYW5zY3JpcHRpb24gdGV4dFxyXG4gICAgICovXHJcbiAgICBhc3luYyB0cmFuc2NyaWJlQXVkaW8oYXVkaW9QYXRoLCBhcGlLZXkpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+OtSBUcmFuc2NyaWJpbmcgYXVkaW86ICR7YXVkaW9QYXRofWApO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIENvbmZpZ3VyZSB3aXRoIEFQSSBrZXkgaWYgcHJvdmlkZWRcclxuICAgICAgICAgICAgaWYgKGFwaUtleSkge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oYW5kbGVDb25maWd1cmUobnVsbCwgeyBhcGlLZXkgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFN0YXJ0IHRyYW5zY3JpcHRpb24gam9iXHJcbiAgICAgICAgICAgIGNvbnN0IHsgam9iSWQgfSA9IGF3YWl0IHRoaXMuaGFuZGxlVHJhbnNjcmliZVN0YXJ0KG51bGwsIHtcclxuICAgICAgICAgICAgICAgIGZpbGVQYXRoOiBhdWRpb1BhdGgsXHJcbiAgICAgICAgICAgICAgICBvcHRpb25zOiB7IFxyXG4gICAgICAgICAgICAgICAgICAgIG1vZGVsOiBhd2FpdCB0aGlzLl9nZXRTZWxlY3RlZE1vZGVsKCksXHJcbiAgICAgICAgICAgICAgICAgICAgbGFuZ3VhZ2U6ICdlbidcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDaGVjayBqb2Igc3RhdHVzIHVudGlsIGNvbXBsZXRlIG9yIGZhaWxlZFxyXG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2FpdEZvclRyYW5zY3JpcHRpb24oam9iSWQpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0F1ZGlvIHRyYW5zY3JpcHRpb24gZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICByZXR1cm4gYFtUcmFuc2NyaXB0aW9uIGVycm9yOiAke2Vycm9yLm1lc3NhZ2V9XWA7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFdhaXQgZm9yIHRyYW5zY3JpcHRpb24gam9iIHRvIGNvbXBsZXRlXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgSURcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IFRyYW5zY3JpcHRpb24gdGV4dFxyXG4gICAgICogQHByaXZhdGVcclxuICAgICAqL1xyXG4gICAgYXN5bmMgX3dhaXRGb3JUcmFuc2NyaXB0aW9uKGpvYklkKSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgY2hlY2tJbnRlcnZhbCA9IHNldEludGVydmFsKGFzeW5jICgpID0+IHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhdHVzID0gYXdhaXQgdGhpcy5oYW5kbGVUcmFuc2NyaWJlU3RhdHVzKG51bGwsIHsgam9iSWQgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHN0YXR1cy5zdGF0dXMgPT09ICdjb21wbGV0ZWQnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwoY2hlY2tJbnRlcnZhbCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmUoc3RhdHVzLnJlc3VsdC50ZXh0KTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHN0YXR1cy5zdGF0dXMgPT09ICdmYWlsZWQnIHx8IHN0YXR1cy5zdGF0dXMgPT09ICdub3RfZm91bmQnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwoY2hlY2tJbnRlcnZhbCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3Ioc3RhdHVzLmVycm9yIHx8ICdUcmFuc2NyaXB0aW9uIGZhaWxlZCcpKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwoY2hlY2tJbnRlcnZhbCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSwgMTAwMCk7IC8vIENoZWNrIGV2ZXJ5IHNlY29uZFxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gU2V0IHRpbWVvdXQgYWZ0ZXIgNSBtaW51dGVzXHJcbiAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY2xlYXJJbnRlcnZhbChjaGVja0ludGVydmFsKTtcclxuICAgICAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoJ1RyYW5zY3JpcHRpb24gdGltZWQgb3V0JykpO1xyXG4gICAgICAgICAgICB9LCA1ICogNjAgKiAxMDAwKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgc2VsZWN0ZWQgdHJhbnNjcmlwdGlvbiBtb2RlbCBmcm9tIHNldHRpbmdzXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBNb2RlbCBuYW1lXHJcbiAgICAgKiBAcHJpdmF0ZVxyXG4gICAgICovXHJcbiAgICBhc3luYyBfZ2V0U2VsZWN0ZWRNb2RlbCgpIHtcclxuICAgICAgICByZXR1cm4gc2V0dGluZ3NTdG9yZS5nZXQoJ3RyYW5zY3JpcHRpb24ubW9kZWwnLCAnbm92YS0yJyk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIENyZWF0ZSBhbmQgZXhwb3J0IHRoZSBzaW5nbGV0b24gaW5zdGFuY2VcclxuY29uc3QgdHJhbnNjcmliZXJTZXJ2aWNlSW5zdGFuY2UgPSBuZXcgVHJhbnNjcmliZXJTZXJ2aWNlKCk7XHJcbm1vZHVsZS5leHBvcnRzID0gdHJhbnNjcmliZXJTZXJ2aWNlSW5zdGFuY2U7Il0sIm1hcHBpbmdzIjoiOzs7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNQyxFQUFFLEdBQUdE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