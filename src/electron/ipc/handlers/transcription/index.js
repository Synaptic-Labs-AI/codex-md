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
const { getTranscriptionConfig } = require('../../../services/utils/config');
// Will be initialized asynchronously
let CONFIG = null;
// Initialize config as soon as possible
(async function initConfig() {
  try {
    CONFIG = await getTranscriptionConfig();
    console.log('✅ Transcription handlers: Configuration loaded');
  } catch (error) {
    console.error('❌ Transcription handlers: Failed to load configuration:', error);
    // Use fallback if needed
    CONFIG = {
      MODELS: { 'whisper-1': { default: true } },
      DEFAULT_MODEL: 'whisper-1'
    };
  }
})();

// Initialize store with error handling
const store = createStore('transcription-handlers');

/**
 * Register all transcription related IPC handlers
 */
function registerTranscriptionHandlers() {
  // Transcribe audio file
  ipcMain.handle('codex:transcribe:audio', async (event, { filePath }) => {
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
  ipcMain.handle('codex:transcribe:video', async (event, { filePath }) => {
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
  ipcMain.handle('codex:transcription:get-model', async () => {
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
  ipcMain.handle('codex:transcription:set-model', async (event, { model }) => {
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

  // Get Deepgram API key with enhanced debugging
  ipcMain.handle('codex:transcription:get-api-key', async (event) => {
    try {
      console.log(`[Transcription] Get Deepgram API key requested from ${event?.sender?.getURL?.() || 'unknown source'}`);

      // Create a fresh settings store instance
      const settingsStore = createStore('settings');

      // Get store data for debugging
      const storeData = settingsStore.store;
      console.log(`[Transcription] Settings store data keys: ${Object.keys(storeData || {}).join(', ')}`);

      // Try multiple possible key locations
      const apiKeyDirect = settingsStore.get('deepgramApiKey');
      const apiKeyNested = settingsStore.get('transcription.deepgramApiKey');

      console.log(`[Transcription] Retrieved API key:
        - Direct path (deepgramApiKey): ${apiKeyDirect ? 'Found (length: ' + apiKeyDirect.length + ')' : 'Not found'}
        - Nested path (transcription.deepgramApiKey): ${apiKeyNested ? 'Found (length: ' + apiKeyNested.length + ')' : 'Not found'}`);

      // Use the first found key
      const apiKey = apiKeyDirect || apiKeyNested || '';

      // Additional logging
      if (!apiKey) {
        console.warn(`[Transcription] No Deepgram API key found in any location`);
      }

      return {
        success: true,
        apiKey: apiKey,
        hasKey: !!apiKey,
        source: apiKeyDirect ? 'direct' : (apiKeyNested ? 'nested' : 'none')
      };
    } catch (error) {
      console.error('[Transcription] Error getting Deepgram API key:', error);
      return {
        success: false,
        error: error.message || 'Failed to get Deepgram API key'
      };
    }
  });

  // Set Deepgram API key with enhanced debugging and reliable storage
  ipcMain.handle('codex:transcription:set-api-key', async (event, { apiKey }) => {
    try {
      console.log(`[Transcription] Setting Deepgram API key (length: ${apiKey?.length || 0}) from ${event?.sender?.getURL?.() || 'unknown source'}`);

      // Validate API key
      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
        throw new Error('Invalid API key');
      }

      // Create a fresh settings store instance
      const settingsStore = createStore('settings');

      // Log current store data for debugging
      const beforeData = settingsStore.store;
      console.log(`[Transcription] Settings store data before update: ${Object.keys(beforeData || {}).join(', ')}`);

      // Store the API key in both locations for maximum compatibility
      console.log(`[Transcription] Storing API key in direct and nested paths...`);

      // First store at the direct path
      settingsStore.set('deepgramApiKey', apiKey);

      // Then store at the nested path
      try {
        // Get current transcription settings, if any
        const currentTranscription = settingsStore.get('transcription') || {};
        // Update with new API key
        currentTranscription.deepgramApiKey = apiKey;
        // Save back to store
        settingsStore.set('transcription', currentTranscription);
        console.log(`[Transcription] Successfully saved API key to nested path`);
      } catch (nestedError) {
        console.error(`[Transcription] Error saving to nested path:`, nestedError);
        // Continue with just the direct path if nested path fails
      }

      // Verify both keys were saved correctly
      const verifyDirectKey = settingsStore.get('deepgramApiKey');
      const verifyNestedKey = settingsStore.get('transcription.deepgramApiKey');

      console.log(`[Transcription] Verification results:
        - Direct path (deepgramApiKey): ${verifyDirectKey ? 'Saved (length: ' + verifyDirectKey.length + ')' : 'Failed'}
        - Nested path (transcription.deepgramApiKey): ${verifyNestedKey ? 'Saved (length: ' + verifyNestedKey.length + ')' : 'Failed'}`);

      // Also configure Deepgram service with the new key
      try {
        const deepgramService = require('../../../services/ai/DeepgramService');
        if (deepgramService && deepgramService.handleConfigure) {
          console.log(`[Transcription] Configuring Deepgram service with the new API key`);
          await deepgramService.handleConfigure(event, { apiKey });
        }
      } catch (configError) {
        console.error(`[Transcription] Error configuring Deepgram service:`, configError);
        // Continue even if configuration fails
      }

      // Final verification
      if (!verifyDirectKey && !verifyNestedKey) {
        throw new Error('Failed to save API key. Settings store may be corrupted.');
      }

      return {
        success: true,
        directPathSaved: !!verifyDirectKey,
        nestedPathSaved: !!verifyNestedKey
      };
    } catch (error) {
      console.error('[Transcription] Error setting Deepgram API key:', error);
      return {
        success: false,
        error: error.message || 'Failed to set Deepgram API key'
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
