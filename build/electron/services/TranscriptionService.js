"use strict";

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
const {
  getTranscriptionConfig
} = require('./utils/config');

// Initialize store with error handling using the store factory
const {
  createStore
} = require('../utils/storeFactory');
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
        await this.transcriber.handleConfigure(null, {
          apiKey
        });
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
      let status = {
        status: 'preparing'
      };
      while (status.status !== 'completed' && status.status !== 'failed') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        status = await this.transcriber.handleTranscribeStatus(null, {
          jobId: result.jobId
        });
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJwYXRoIiwiY3J5cHRvIiwiZ2V0VHJhbnNjcmlwdGlvbkNvbmZpZyIsImNyZWF0ZVN0b3JlIiwic3RvcmUiLCJkZWVwZ3JhbVNlcnZpY2UiLCJUcmFuc2NyaXB0aW9uU2VydmljZSIsImNvbnN0cnVjdG9yIiwidHJhbnNjcmliZXIiLCJjb25zb2xlIiwibG9nIiwiX2dldFNlbGVjdGVkTW9kZWwiLCJtb2RlbCIsImdldCIsImVycm9yIiwid2FybiIsInZhbGlkTW9kZWxzIiwiaW5jbHVkZXMiLCJzZXRNb2RlbCIsInNldCIsInRyYW5zY3JpYmVBdWRpbyIsImF1ZGlvUGF0aCIsImFwaUtleSIsImhhbmRsZUNvbmZpZ3VyZSIsInJlc3VsdCIsImhhbmRsZVRyYW5zY3JpYmVTdGFydCIsImZpbGVQYXRoIiwib3B0aW9ucyIsImxhbmd1YWdlIiwic3RhdHVzIiwiUHJvbWlzZSIsInJlc29sdmUiLCJzZXRUaW1lb3V0IiwiaGFuZGxlVHJhbnNjcmliZVN0YXR1cyIsImpvYklkIiwiRXJyb3IiLCJ0ZXh0IiwidHJhbnNjcmliZVZpZGVvIiwidmlkZW9QYXRoIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9UcmFuc2NyaXB0aW9uU2VydmljZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogVHJhbnNjcmlwdGlvblNlcnZpY2UuanNcclxuICpcclxuICogUHJvdmlkZXMgYXVkaW8gYW5kIHZpZGVvIHRyYW5zY3JpcHRpb24gc2VydmljZXMgdXNpbmcgRGVlcGdyYW0ncyBBUEkuXHJcbiAqIFRoaXMgc2VydmljZSBhY3RzIGFzIGEgYnJpZGdlIGJldHdlZW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2VzcyBhbmRcclxuICogdGhlIHRyYW5zY3JpcHRpb24gc2VydmljZXMuIEl0IGhhbmRsZXMgZmlsZSBvcGVyYXRpb25zLCBBUEkga2V5XHJcbiAqIG1hbmFnZW1lbnQsIGFuZCB0cmFuc2NyaXB0aW9uIHJlcXVlc3RzLlxyXG4gKlxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9haS9EZWVwZ3JhbVNlcnZpY2UuanM6IERlZXBncmFtIHRyYW5zY3JpcHRpb24gc2VydmljZVxyXG4gKi9cclxuXHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgY3J5cHRvID0gcmVxdWlyZSgnY3J5cHRvJyk7XHJcbmNvbnN0IHsgZ2V0VHJhbnNjcmlwdGlvbkNvbmZpZyB9ID0gcmVxdWlyZSgnLi91dGlscy9jb25maWcnKTtcclxuXHJcbi8vIEluaXRpYWxpemUgc3RvcmUgd2l0aCBlcnJvciBoYW5kbGluZyB1c2luZyB0aGUgc3RvcmUgZmFjdG9yeVxyXG5jb25zdCB7IGNyZWF0ZVN0b3JlIH0gPSByZXF1aXJlKCcuLi91dGlscy9zdG9yZUZhY3RvcnknKTtcclxuY29uc3Qgc3RvcmUgPSBjcmVhdGVTdG9yZSgndHJhbnNjcmlwdGlvbi1zZXR0aW5ncycpO1xyXG5cclxuLy8gSW1wb3J0IHRoZSBEZWVwZ3JhbSBzZXJ2aWNlXHJcbmNvbnN0IGRlZXBncmFtU2VydmljZSA9IHJlcXVpcmUoJy4vYWkvRGVlcGdyYW1TZXJ2aWNlJyk7XHJcblxyXG5jbGFzcyBUcmFuc2NyaXB0aW9uU2VydmljZSB7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLnRyYW5zY3JpYmVyID0gZGVlcGdyYW1TZXJ2aWNlO1xyXG4gICAgY29uc29sZS5sb2coJ+KchSBUcmFuc2NyaXB0aW9uU2VydmljZSBpbml0aWFsaXplZCB3aXRoIERlZXBncmFtU2VydmljZScpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2V0IHRoZSBzZWxlY3RlZCB0cmFuc2NyaXB0aW9uIG1vZGVsIGZyb20gc2V0dGluZ3Mgb3IgcmV0dXJuIGRlZmF1bHRcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFRoZSBtb2RlbCBJRCB0byB1c2VcclxuICAgKi9cclxuICBhc3luYyBfZ2V0U2VsZWN0ZWRNb2RlbCgpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFNhZmVseSBnZXQgbW9kZWwgZnJvbSBzdG9yZVxyXG4gICAgICBsZXQgbW9kZWwgPSBudWxsO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIG1vZGVsID0gc3RvcmUuZ2V0KCd0cmFuc2NyaXB0aW9uLm1vZGVsJyk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdFcnJvciBhY2Nlc3Npbmcgc3RvcmUsIHVzaW5nIGRlZmF1bHQgbW9kZWw6JywgZXJyb3IpO1xyXG4gICAgICAgIHJldHVybiAnbm92YS0yJztcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gVmFsaWRhdGUgdGhlIG1vZGVsIGlzIG9uZSBvZiB0aGUgc3VwcG9ydGVkIERlZXBncmFtIG1vZGVsc1xyXG4gICAgICBjb25zdCB2YWxpZE1vZGVscyA9IFsnbm92YS0xJywgJ25vdmEtMicsICdub3ZhLTMnXTtcclxuICAgICAgaWYgKG1vZGVsICYmIHZhbGlkTW9kZWxzLmluY2x1ZGVzKG1vZGVsKSkge1xyXG4gICAgICAgIHJldHVybiBtb2RlbDtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdFcnJvciBnZXR0aW5nIHRyYW5zY3JpcHRpb24gbW9kZWwgZnJvbSBzZXR0aW5nczonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gJ25vdmEtMic7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTZXQgdGhlIHRyYW5zY3JpcHRpb24gbW9kZWwgdG8gdXNlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsIFRoZSBtb2RlbCBJRCB0byB1c2VcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gU3VjY2VzcyBzdGF0dXNcclxuICAgKi9cclxuICBhc3luYyBzZXRNb2RlbChtb2RlbCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVmFsaWRhdGUgdGhlIG1vZGVsIGlzIG9uZSBvZiB0aGUgc3VwcG9ydGVkIERlZXBncmFtIG1vZGVsc1xyXG4gICAgICBjb25zdCB2YWxpZE1vZGVscyA9IFsnbm92YS0xJywgJ25vdmEtMicsICdub3ZhLTMnXTtcclxuICAgICAgaWYgKCF2YWxpZE1vZGVscy5pbmNsdWRlcyhtb2RlbCkpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYEludmFsaWQgbW9kZWw6ICR7bW9kZWx9YCk7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTYXZlIHRvIHN0b3JlXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgc3RvcmUuc2V0KCd0cmFuc2NyaXB0aW9uLm1vZGVsJywgbW9kZWwpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgVHJhbnNjcmlwdGlvbiBtb2RlbCBzZXQgdG86ICR7bW9kZWx9YCk7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHNhdmUgbW9kZWwgdG8gc3RvcmU6JywgZXJyb3IpO1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igc2V0dGluZyB0cmFuc2NyaXB0aW9uIG1vZGVsOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogVHJhbnNjcmliZSBhdWRpbyBmaWxlIHVzaW5nIERlZXBncmFtXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGF1ZGlvUGF0aCBQYXRoIHRvIGF1ZGlvIGZpbGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXBpS2V5IERlZXBncmFtIEFQSSBrZXlcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBUcmFuc2NyaXB0aW9uIHRleHRcclxuICAgKi9cclxuICBhc3luYyB0cmFuc2NyaWJlQXVkaW8oYXVkaW9QYXRoLCBhcGlLZXkpIHtcclxuICAgIGNvbnNvbGUubG9nKGDwn461IFRyYW5zY3JpYmluZyBhdWRpbzogJHthdWRpb1BhdGh9YCk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gQ29uZmlndXJlIERlZXBncmFtIHdpdGggdGhlIEFQSSBrZXkgaWYgcHJvdmlkZWRcclxuICAgICAgaWYgKGFwaUtleSkge1xyXG4gICAgICAgIGF3YWl0IHRoaXMudHJhbnNjcmliZXIuaGFuZGxlQ29uZmlndXJlKG51bGwsIHsgYXBpS2V5IH0pO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBHZXQgc2VsZWN0ZWQgbW9kZWwgZnJvbSBzZXR0aW5nc1xyXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuX2dldFNlbGVjdGVkTW9kZWwoKTtcclxuICAgICAgY29uc29sZS5sb2coYFVzaW5nIHRyYW5zY3JpcHRpb24gbW9kZWw6ICR7bW9kZWx9YCk7XHJcblxyXG4gICAgICAvLyBVc2UgRGVlcGdyYW0gZm9yIHRyYW5zY3JpcHRpb25cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy50cmFuc2NyaWJlci5oYW5kbGVUcmFuc2NyaWJlU3RhcnQobnVsbCwge1xyXG4gICAgICAgIGZpbGVQYXRoOiBhdWRpb1BhdGgsXHJcbiAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgbW9kZWw6IG1vZGVsLFxyXG4gICAgICAgICAgbGFuZ3VhZ2U6ICdlbidcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gV2FpdCBmb3IgdGhlIGpvYiB0byBjb21wbGV0ZVxyXG4gICAgICBsZXQgc3RhdHVzID0geyBzdGF0dXM6ICdwcmVwYXJpbmcnIH07XHJcbiAgICAgIHdoaWxlIChzdGF0dXMuc3RhdHVzICE9PSAnY29tcGxldGVkJyAmJiBzdGF0dXMuc3RhdHVzICE9PSAnZmFpbGVkJykge1xyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDAwKSk7XHJcbiAgICAgICAgc3RhdHVzID0gYXdhaXQgdGhpcy50cmFuc2NyaWJlci5oYW5kbGVUcmFuc2NyaWJlU3RhdHVzKG51bGwsIHsgam9iSWQ6IHJlc3VsdC5qb2JJZCB9KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHN0YXR1cy5zdGF0dXMgPT09ICdmYWlsZWQnKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKHN0YXR1cy5lcnJvciB8fCAnVHJhbnNjcmlwdGlvbiBmYWlsZWQnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHN0YXR1cy5yZXN1bHQudGV4dDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1RyYW5zY3JpcHRpb24gZmFpbGVkOicsIGVycm9yKTtcclxuXHJcbiAgICAgIC8vIEZhbGxiYWNrIHRvIG1vY2sgaW1wbGVtZW50YXRpb25cclxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLl9nZXRTZWxlY3RlZE1vZGVsKCk7XHJcbiAgICAgIHJldHVybiBgW1RyYW5zY3JpcHRpb24gcGxhY2Vob2xkZXIgZm9yICR7YXVkaW9QYXRofSB1c2luZyAke21vZGVsfV1gO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogVHJhbnNjcmliZSB2aWRlbyBmaWxlIHVzaW5nIERlZXBncmFtXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHZpZGVvUGF0aCBQYXRoIHRvIHZpZGVvIGZpbGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXBpS2V5IERlZXBncmFtIEFQSSBrZXlcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBUcmFuc2NyaXB0aW9uIHRleHRcclxuICAgKi9cclxuICBhc3luYyB0cmFuc2NyaWJlVmlkZW8odmlkZW9QYXRoLCBhcGlLZXkpIHtcclxuICAgIGNvbnNvbGUubG9nKGDwn46sIFRyYW5zY3JpYmluZyB2aWRlbzogJHt2aWRlb1BhdGh9YCk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gRGVlcGdyYW0gY2FuIHRyYW5zY3JpYmUgdmlkZW8gZmlsZXMgZGlyZWN0bHkgd2l0aG91dCBleHRyYWN0aW9uXHJcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnRyYW5zY3JpYmVBdWRpbyh2aWRlb1BhdGgsIGFwaUtleSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdWaWRlbyB0cmFuc2NyaXB0aW9uIGVycm9yOicsIGVycm9yKTtcclxuXHJcbiAgICAgIC8vIEZhbGxiYWNrIHRvIG1vY2sgaW1wbGVtZW50YXRpb25cclxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLl9nZXRTZWxlY3RlZE1vZGVsKCk7XHJcbiAgICAgIHJldHVybiBgW1RyYW5zY3JpcHRpb24gcGxhY2Vob2xkZXIgZm9yICR7dmlkZW9QYXRofSB1c2luZyAke21vZGVsfV1gO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBuZXcgVHJhbnNjcmlwdGlvblNlcnZpY2UoKTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsRUFBRSxHQUFHQyxPQUFPLENBQUMsSUFBSSxDQUFDO0FBQ3hCLE1BQU1DLElBQUksR0FBR0QsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNRSxNQUFNLEdBQUdGLE9BQU8sQ0FBQyxRQUFRLENBQUM7QUFDaEMsTUFBTTtFQUFFRztBQUF1QixDQUFDLEdBQUdILE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQzs7QUFFNUQ7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