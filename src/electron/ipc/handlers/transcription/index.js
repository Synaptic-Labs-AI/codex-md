/**
 * Transcription IPC Handlers
 * Implements handlers for audio and video transcription operations.
 * 
 * Related files:
 * - services/TranscriptionService.js: Transcription implementation
 * - services/ApiKeyService.js: API key management
 * - ipc/handlers.js: Handler registration
 * - preload.js: API exposure to renderer
 */

const { ipcMain } = require('electron');
const path = require('path');
const { createStore } = require('../../../utils/storeFactory');
const transcriptionService = require('../../../services/TranscriptionService');
const apiKeyService = require('../../../services/ApiKeyService');
const { IPCChannels } = require('../../types');
const CONFIG = require('../../../config/transcription');

// Initialize store with error handling
const store = createStore('transcription-handlers');

/**
 * Register all transcription related IPC handlers
 */
function registerTranscriptionHandlers() {
  // Transcribe audio file
  ipcMain.handle('mdcode:transcribe:audio', async (event, { filePath }) => {
    try {
      // Validate file path
      if (!filePath || typeof filePath !== 'string') {
        return {
          success: false,
          error: 'Invalid file path'
        };
      }

      // Get file extension
      const ext = path.extname(filePath).toLowerCase();
      const supportedAudioFormats = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm'];
      
      if (!supportedAudioFormats.includes(ext)) {
        return {
          success: false,
          error: `Unsupported audio format: ${ext}. Supported formats: ${supportedAudioFormats.join(', ')}`
        };
      }

      // Convert to supported format if needed
      let audioPath = filePath;
      if (!['.mp3', '.m4a', '.webm', '.mp4', '.mpga', '.wav'].includes(ext)) {
        audioPath = await transcriptionService.convertToSupportedFormat(filePath);
      }

      // Transcribe audio
      const transcription = await transcriptionService.transcribeAudio(audioPath);
      
      return {
        success: true,
        transcription,
        metadata: {
          originalFile: filePath,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Audio transcription error:', error);
      return {
        success: false,
        error: error.message || 'Failed to transcribe audio'
      };
    }
  });

  // Transcribe video file
  ipcMain.handle('mdcode:transcribe:video', async (event, { filePath }) => {
    try {
      // Validate file path
      if (!filePath || typeof filePath !== 'string') {
        return {
          success: false,
          error: 'Invalid file path'
        };
      }

      // Get file extension
      const ext = path.extname(filePath).toLowerCase();
      const supportedVideoFormats = ['.mp4', '.mpeg', '.mpg', '.mov', '.webm', '.avi'];
      
      if (!supportedVideoFormats.includes(ext)) {
        return {
          success: false,
          error: `Unsupported video format: ${ext}. Supported formats: ${supportedVideoFormats.join(', ')}`
        };
      }

      // Transcribe video
      const transcription = await transcriptionService.transcribeVideo(filePath);
      
      return {
        success: true,
        transcription,
        metadata: {
          originalFile: filePath,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Video transcription error:', error);
      return {
        success: false,
        error: error.message || 'Failed to transcribe video'
      };
    }
  });

  // Get current transcription model
  ipcMain.handle('mdcode:transcription:get-model', async () => {
    try {
      const model = await store.get('transcriptionModel');
      return {
        success: true,
        model: model || CONFIG.DEFAULT_MODEL
      };
    } catch (error) {
      console.error('Error getting transcription model:', error);
      return {
        success: false,
        error: error.message || 'Failed to get transcription model'
      };
    }
  });

  // Set transcription model
  ipcMain.handle('mdcode:transcription:set-model', async (event, { model }) => {
    try {
      if (!CONFIG.MODELS[model]) {
        throw new Error(`Invalid model: ${model}`);
      }

      await store.set('transcriptionModel', model);
      return { success: true };
    } catch (error) {
      console.error('Error setting transcription model:', error);
      return {
        success: false,
        error: error.message || 'Failed to set transcription model'
      };
    }
  });

  console.log('Transcription IPC handlers registered');
}

/**
 * Clean up any resources when the app is shutting down
 */
async function cleanupTranscriptionHandlers() {
  // No cleanup needed for transcription handlers
}

module.exports = {
  registerTranscriptionHandlers,
  cleanupTranscriptionHandlers
};
