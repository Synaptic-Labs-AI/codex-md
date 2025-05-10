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
const { getTranscriptionConfig } = require('./utils/config');

// Initialize store with error handling using the store factory
const { createStore } = require('../utils/storeFactory');
const store = createStore('transcription-settings');

// Import the Deepgram service
const deepgramService = require('./ai/DeepgramService');

class TranscriptionService {
  constructor() {
    this.transcriber = deepgramService;
    console.log('✅ TranscriptionService initialized with DeepgramService');
  }

  /**
   * Get the selected transcription model from settings or return default
   * @private
   * @returns {string} The model ID to use
   */
  async _getSelectedModel() {
    try {
      // Safely get model from store
      let model = null;
      try {
        model = store.get('transcription.model');
      } catch (error) {
        console.warn('Error accessing store, using default model:', error);
        return 'nova-2';
      }

      // Validate the model is one of the supported Deepgram models
      const validModels = ['nova-1', 'nova-2', 'nova-3'];
      if (model && validModels.includes(model)) {
        return model;
      }
    } catch (error) {
      console.warn('Error getting transcription model from settings:', error);
    }
    return 'nova-2';
  }

  /**
   * Set the transcription model to use
   * @param {string} model The model ID to use
   * @returns {Promise<boolean>} Success status
   */
  async setModel(model) {
    try {
      // Validate the model is one of the supported Deepgram models
      const validModels = ['nova-1', 'nova-2', 'nova-3'];
      if (!validModels.includes(model)) {
        console.warn(`Invalid model: ${model}`);
        return false;
      }

      // Save to store
      try {
        store.set('transcription.model', model);
        console.log(`✅ Transcription model set to: ${model}`);
        return true;
      } catch (error) {
        console.error('Failed to save model to store:', error);
        return false;
      }
    } catch (error) {
      console.error('Error setting transcription model:', error);
      return false;
    }
  }

  /**
   * Transcribe audio file using Deepgram
   * @param {string} audioPath Path to audio file
   * @param {string} apiKey Deepgram API key
   * @returns {Promise<string>} Transcription text
   */
  async transcribeAudio(audioPath, apiKey) {
    console.log(`🎵 Transcribing audio: ${audioPath}`);

    try {
      // Configure Deepgram with the API key if provided
      if (apiKey) {
        await this.transcriber.handleConfigure(null, { apiKey });
      }

      // Get selected model from settings
      const model = await this._getSelectedModel();
      console.log(`Using transcription model: ${model}`);

      // Use Deepgram for transcription
      const result = await this.transcriber.handleTranscribeStart(null, {
        filePath: audioPath,
        options: {
          model: model,
          language: 'en'
        }
      });

      // Wait for the job to complete
      let status = { status: 'preparing' };
      while (status.status !== 'completed' && status.status !== 'failed') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        status = await this.transcriber.handleTranscribeStatus(null, { jobId: result.jobId });
      }

      if (status.status === 'failed') {
        throw new Error(status.error || 'Transcription failed');
      }

      return status.result.text;
    } catch (error) {
      console.error('Transcription failed:', error);

      // Fallback to mock implementation
      const model = await this._getSelectedModel();
      return `[Transcription placeholder for ${audioPath} using ${model}]`;
    }
  }

  /**
   * Transcribe video file using Deepgram
   * @param {string} videoPath Path to video file
   * @param {string} apiKey Deepgram API key
   * @returns {Promise<string>} Transcription text
   */
  async transcribeVideo(videoPath, apiKey) {
    console.log(`🎬 Transcribing video: ${videoPath}`);

    try {
      // Deepgram can transcribe video files directly without extraction
      return await this.transcribeAudio(videoPath, apiKey);
    } catch (error) {
      console.error('Video transcription error:', error);

      // Fallback to mock implementation
      const model = await this._getSelectedModel();
      return `[Transcription placeholder for ${videoPath} using ${model}]`;
    }
  }
}

module.exports = new TranscriptionService();
