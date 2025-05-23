/**
 * TranscriptionService.js
 *
 * Provides audio and video transcription services using Deepgram's API.
 * This service acts as a bridge between the Electron main process and
 * the transcription services. It handles file operations, API key
 * management, and transcription requests.
 *
 * Related files:
 * - src/electron/services/ai/DeepgramService.js: Deepgram transcription service
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// const { getTranscriptionConfig } = require('./utils/config'); // Not used, can be removed

// Initialize store with error handling using the store factory
const { createStore } = require('../utils/storeFactory');
const store = createStore('transcription-settings');

// Import the Deepgram service
const deepgramService = require('./ai/DeepgramService'); // This is an instance

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


class TranscriptionService {
  constructor() {
    this.transcriber = deepgramService; // Using the imported instance
    console.log('[TranscriptionService:INIT] TranscriptionService initialized with DeepgramService');
  }

  /**
   * Get the selected transcription model from settings or return default
   * @private
   * @returns {string} The model ID to use
   */
  async _getSelectedModel() {
    let model = 'nova-2'; // Default model
    try {
      const storedModel = store.get('transcription.model');
      const validModels = ['nova-1', 'nova-2', 'nova-3', 'base', 'enhanced']; // Added more generic model names if Deepgram changes them
      if (storedModel && validModels.includes(storedModel)) {
        model = storedModel;
      } else if (storedModel) {
        console.warn(`[TranscriptionService:MODEL_WARN] Invalid model '${storedModel}' in store, using default '${model}'.`);
      }
    } catch (error) {
      console.warn('[TranscriptionService:MODEL_ERROR] Error accessing model from store, using default model:', sanitizeForLogging(error));
    }
    console.log(`[TranscriptionService:MODEL_SELECTED] Using transcription model: ${model}`);
    return model;
  }

  /**
   * Set the transcription model to use
   * @param {string} model The model ID to use
   * @returns {Promise<boolean>} Success status
   */
  async setModel(modelId) {
    try {
      const validModels = ['nova-1', 'nova-2', 'nova-3', 'base', 'enhanced'];
      if (!validModels.includes(modelId)) {
        console.warn(`[TranscriptionService:SET_MODEL_INVALID] Invalid model: ${modelId}`);
        return false;
      }

      store.set('transcription.model', modelId);
      console.log(`[TranscriptionService:SET_MODEL_SUCCESS] Transcription model set to: ${modelId}`);
      return true;
    } catch (error) {
      console.error('[TranscriptionService:SET_MODEL_ERROR] Error setting transcription model:', sanitizeForLogging(error));
      return false;
    }
  }

  /**
   * Transcribe audio file using Deepgram
   * @param {string} audioPath Path to audio file
   * @param {string} apiKey Deepgram API key
   * @returns {Promise<string>} Transcription text
   */
  async transcribeAudio(audioPath, apiKey, options = {}) {
    const operationId = crypto.randomBytes(4).toString('hex');
    console.log(`[TranscriptionService:TRANSCRIBE_AUDIO_START][opId:${operationId}] Starting audio transcription for: ${audioPath}`);
    console.log(`[TranscriptionService:TRANSCRIBE_AUDIO_START][opId:${operationId}] API key provided: ${!!apiKey}`);
    console.log(`[TranscriptionService:TRANSCRIBE_AUDIO_START][opId:${operationId}] Options:`, sanitizeForLogging(options));

    try {
      // Ensure Deepgram is configured, preferably with the provided API key
      if (apiKey) {
        console.log(`[TranscriptionService:CONFIGURING][opId:${operationId}] Configuring Deepgram with provided API key.`);
        await this.transcriber.handleConfigure(null, { apiKey });
      } else {
        console.log(`[TranscriptionService:CONFIGURING][opId:${operationId}] Ensuring Deepgram is configured (no API key explicitly passed to transcribeAudio).`);
        this.transcriber.ensureConfigured(); // This will use stored key or throw
      }

      const model = await this._getSelectedModel();
      
      const transcriptionOptions = {
        model: model,
        language: options.language || 'en',
        punctuate: options.punctuate !== undefined ? options.punctuate : true,
        smart_format: options.smart_format !== undefined ? options.smart_format : true,
        diarize: options.diarize || false,
        utterances: options.utterances || false,
        ...options.deepgramOptions // Allow further deepgram specific options
      };
      console.log(`[TranscriptionService:TRANSCRIBE_AUDIO_OPTIONS][opId:${operationId}] Effective Deepgram options:`, sanitizeForLogging(transcriptionOptions));

      const { jobId } = await this.transcriber.handleTranscribeStart(null, {
        filePath: audioPath,
        options: transcriptionOptions
      });
      console.log(`[TranscriptionService:JOB_STARTED][opId:${operationId}][jobId:${jobId}] Deepgram job started.`);

      let status;
      const maxPollTime = 600 * 1000; // 10 minutes for large files
      const pollInterval = 2000; // 2 seconds
      let elapsedTime = 0;

      do {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        elapsedTime += pollInterval;
        status = await this.transcriber.handleTranscribeStatus(null, { jobId });
        console.log(`[TranscriptionService:POLLING_STATUS][opId:${operationId}][jobId:${jobId}] Status: ${status.status}, Progress: ${status.progress || 0}%`);

        if (elapsedTime >= maxPollTime && status.status !== 'completed' && status.status !== 'failed') {
          console.error(`[TranscriptionService:TIMEOUT][opId:${operationId}][jobId:${jobId}] Transcription polling timed out after ${maxPollTime / 1000}s.`);
          throw new Error('Transcription polling timed out.');
        }
      } while (status.status !== 'completed' && status.status !== 'failed');

      if (status.status === 'failed') {
        const errorMessage = status.error || 'Unknown Deepgram transcription failure';
        console.error(`[TranscriptionService:JOB_FAILED][opId:${operationId}][jobId:${jobId}] Transcription failed:`, errorMessage, sanitizeForLogging(status.details));
        throw new Error(`Transcription failed: ${errorMessage}`);
      }

      if (!status.result || typeof status.result.text !== 'string') {
        console.error(`[TranscriptionService:NO_TEXT_RESULT][opId:${operationId}][jobId:${jobId}] Transcription completed but no text result found. Status:`, sanitizeForLogging(status));
        throw new Error('Transcription completed but returned no text.');
      }
      
      console.log(`[TranscriptionService:JOB_SUCCESS][opId:${operationId}][jobId:${jobId}] Transcription successful. Text length: ${status.result.text.length}`);
      return status.result.text;

    } catch (error) {
      const errorMessage = error.message || 'Unknown error during audio transcription';
      console.error(`[TranscriptionService:TRANSCRIBE_AUDIO_ERROR][opId:${operationId}] Error:`, sanitizeForLogging(error));
      // Do NOT return a placeholder. Let the error propagate.
      throw new Error(`Audio transcription failed: ${errorMessage}`);
    }
  }

  /**
   * Transcribe video file using Deepgram
   * @param {string} videoPath Path to video file
   * @param {string} apiKey Deepgram API key
   * @returns {Promise<string>} Transcription text
   */
  async transcribeVideo(videoPath, apiKey, options = {}) {
    const operationId = crypto.randomBytes(4).toString('hex');
    console.log(`[TranscriptionService:TRANSCRIBE_VIDEO_START][opId:${operationId}] Starting video transcription for: ${videoPath}`);
    
    // Videos are transcribed like audio by Deepgram, so we can reuse the audio transcription logic.
    // Pass along any video-specific options if needed in the future.
    try {
      return await this.transcribeAudio(videoPath, apiKey, { ...options, isVideo: true });
    } catch (error) {
      const errorMessage = error.message || 'Unknown error during video transcription';
      console.error(`[TranscriptionService:TRANSCRIBE_VIDEO_ERROR][opId:${operationId}] Error:`, sanitizeForLogging(error));
      // Do NOT return a placeholder. Let the error propagate.
      throw new Error(`Video transcription failed: ${errorMessage}`);
    }
  }
}

// Export a single instance (singleton pattern)
const transcriptionServiceInstance = new TranscriptionService();
module.exports = transcriptionServiceInstance;
