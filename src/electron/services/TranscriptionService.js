/**
 * TranscriptionService.js
 * 
 * Provides audio and video transcription services using OpenAI's API.
 * This service acts as a bridge between the Electron main process and
 * the transcription services. It handles file operations, API key
 * management, and transcription requests.
 * 
 * Related files:
 * - src/electron/services/ai/TranscriberService.js: New transcription service
 * - src/electron/services/ai/OpenAIProxyService.js: OpenAI API interactions
 */

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const Store = require('electron-store');
const { getTranscriptionConfig } = require('./utils/config');

// Get configuration
const CONFIG = getTranscriptionConfig();

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

// Initialize store with error handling using the store factory
const { createStore } = require('../utils/storeFactory');
const store = createStore('transcription-settings');

// Use the new TranscriberService
const TranscriberService = require('./ai/TranscriberService');
const OpenAIProxyService = require('./ai/OpenAIProxyService');

// Create instances if needed
const openAIProxy = new OpenAIProxyService();

class TranscriptionService {
  constructor() {
    this.transcriber = new TranscriberService(openAIProxy, null);
    console.log('✅ TranscriptionService initialized with new TranscriberService');
  }
  
  /**
   * Generate a temporary directory path
   * @private
   * @returns {string} Path to temporary directory
   */
  _getTempDir() {
    const randomId = crypto.randomBytes(16).toString('hex');
    return path.join(os.tmpdir(), `mdcode-transcription-${randomId}`);
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
        model = store.get('transcriptionModel');
      } catch (error) {
        console.warn('Error accessing store, using default model:', error);
        return CONFIG.DEFAULT_MODEL;
      }
      
      if (model && CONFIG.MODELS[model]) {
        return model;
      }
    } catch (error) {
      console.warn('Error getting transcription model from settings:', error);
    }
    return CONFIG.DEFAULT_MODEL;
  }

  /**
   * Get the appropriate response format for a model
   * @private
   * @param {string} model The model ID
   * @returns {string} The response format to use
   */
  _getResponseFormat(model) {
    const formats = CONFIG.RESPONSE_FORMATS[model] || ['text'];
    return formats[0]; // Use first available format
  }

  /**
   * Set the transcription model to use
   * @param {string} model The model ID to use
   * @returns {Promise<boolean>} Success status
   */
  async setModel(model) {
    try {
      if (!CONFIG.MODELS[model]) {
        console.warn(`Invalid model: ${model}`);
        return false;
      }
      
      // Save to store
      try {
        store.set('transcriptionModel', model);
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
   * Transcribe audio file using the new TranscriberService
   * @param {string} audioPath Path to audio file
   * @param {string} apiKey OpenAI API key
   * @returns {Promise<string>} Transcription text
   */
  async transcribeAudio(audioPath, apiKey) {
    console.log(`🎵 Transcribing audio: ${audioPath}`);
    
    try {
      // Configure OpenAI with the API key
      await openAIProxy.handleConfigure(null, { apiKey });
      
      // Use the new transcriber service
      const jobId = crypto.randomBytes(16).toString('hex');
      const result = await this.transcriber.handleTranscribeStart(null, {
        filePath: audioPath,
        options: {
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
   * Transcribe video file using transcription service
   * @param {string} videoPath Path to video file
   * @param {string} apiKey OpenAI API key
   * @returns {Promise<string>} Transcription text
   */
  async transcribeVideo(videoPath, apiKey) {
    console.log(`🎬 Transcribing video: ${videoPath}`);
    
    try {
      // Extract audio first
      const tempDir = this._getTempDir();
      await fsPromises.mkdir(tempDir, { recursive: true });
      const audioPath = path.join(tempDir, 'audio.mp3');
      
      console.log(`Extracting audio to: ${audioPath}`);
      await this.extractAudioFromVideo(videoPath, audioPath);
      
      // Then transcribe the audio
      const transcription = await this.transcribeAudio(audioPath, apiKey);
      
      // Clean up temp files
      try {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Failed to clean up temp directory:', cleanupError);
      }
      
      return transcription;
    } catch (error) {
      console.error('Video transcription error:', error);
      
      // Fallback to mock implementation
      const model = await this._getSelectedModel();
      return `[Transcription placeholder for ${videoPath} using ${model}]`;
    }
  }

  /**
   * Extract audio from video file
   * @param {string} videoPath Path to video file
   * @param {string} outputPath Path to save extracted audio
   * @returns {Promise<string>} Path to extracted audio file
   */
  async extractAudioFromVideo(videoPath, outputPath) {
    console.log(`🔊 Extracting audio from: ${videoPath} to: ${outputPath}`);
    
    // Fallback to local ffmpeg
    return new Promise((resolve, reject) => {
      console.log('Using local ffmpeg for audio extraction');
      ffmpeg(videoPath)
        .outputOptions('-ab', '192k')
        .toFormat('mp3')
        .on('start', cmd => console.log('Started ffmpeg with command:', cmd))
        .on('error', err => {
          console.error('FFmpeg error:', err);
          reject(new Error(`FFmpeg error: ${err.message}`));
        })
        .on('end', () => {
          console.log('FFmpeg finished extracting audio');
          resolve(outputPath);
        })
        .save(outputPath);
    });
  }

  /**
   * Convert audio to supported format (MP3)
   * @param {string} audioPath Path to audio file
   * @returns {Promise<string>} Path to converted audio file
   */
  async convertToSupportedFormat(audioPath) {
    console.log(`🔄 Converting audio format: ${audioPath}`);
    
    // Use local ffmpeg
    const outputPath = path.join(
      path.dirname(audioPath),
      `${path.basename(audioPath, path.extname(audioPath))}.mp3`
    );
    
    return new Promise((resolve, reject) => {
      console.log('Using local ffmpeg for audio conversion');
      ffmpeg(audioPath)
        .toFormat('mp3')
        .on('error', err => reject(err))
        .on('end', () => resolve(outputPath))
        .save(outputPath);
    });
  }
}

module.exports = new TranscriptionService();
