"use strict";

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

const {
  ipcMain
} = require('electron');
const path = require('path');
const {
  createStore
} = require('../../../utils/storeFactory');
const transcriptionService = require('../../../services/TranscriptionService');
const apiKeyService = require('../../../services/ApiKeyService');
const {
  IPCChannels
} = require('../../types');
const {
  getTranscriptionConfig
} = require('../../../services/utils/config');
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
      MODELS: {
        'whisper-1': {
          default: true
        }
      },
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
  ipcMain.handle('codex:transcribe:audio', async (event, {
    filePath
  }) => {
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
  ipcMain.handle('codex:transcribe:video', async (event, {
    filePath
  }) => {
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
  ipcMain.handle('codex:transcription:set-model', async (event, {
    model
  }) => {
    try {
      if (!CONFIG.MODELS[model]) {
        throw new Error(`Invalid model: ${model}`);
      }
      await store.set('transcriptionModel', model);
      return {
        success: true
      };
    } catch (error) {
      console.error('Error setting transcription model:', error);
      return {
        success: false,
        error: error.message || 'Failed to set transcription model'
      };
    }
  });

  // Get Deepgram API key with enhanced debugging
  ipcMain.handle('codex:transcription:get-api-key', async event => {
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
        source: apiKeyDirect ? 'direct' : apiKeyNested ? 'nested' : 'none'
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
  ipcMain.handle('codex:transcription:set-api-key', async (event, {
    apiKey
  }) => {
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
          await deepgramService.handleConfigure(event, {
            apiKey
          });
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJpcGNNYWluIiwicmVxdWlyZSIsInBhdGgiLCJjcmVhdGVTdG9yZSIsInRyYW5zY3JpcHRpb25TZXJ2aWNlIiwiYXBpS2V5U2VydmljZSIsIklQQ0NoYW5uZWxzIiwiZ2V0VHJhbnNjcmlwdGlvbkNvbmZpZyIsIkNPTkZJRyIsImluaXRDb25maWciLCJjb25zb2xlIiwibG9nIiwiZXJyb3IiLCJNT0RFTFMiLCJkZWZhdWx0IiwiREVGQVVMVF9NT0RFTCIsInN0b3JlIiwicmVnaXN0ZXJUcmFuc2NyaXB0aW9uSGFuZGxlcnMiLCJoYW5kbGUiLCJldmVudCIsImZpbGVQYXRoIiwic3VjY2VzcyIsImV4dCIsImV4dG5hbWUiLCJ0b0xvd2VyQ2FzZSIsInN1cHBvcnRlZEF1ZGlvRm9ybWF0cyIsImluY2x1ZGVzIiwiam9pbiIsImF1ZGlvUGF0aCIsImNvbnZlcnRUb1N1cHBvcnRlZEZvcm1hdCIsInRyYW5zY3JpcHRpb24iLCJ0cmFuc2NyaWJlQXVkaW8iLCJtZXRhZGF0YSIsIm9yaWdpbmFsRmlsZSIsInRpbWVzdGFtcCIsIkRhdGUiLCJ0b0lTT1N0cmluZyIsIm1lc3NhZ2UiLCJzdXBwb3J0ZWRWaWRlb0Zvcm1hdHMiLCJ0cmFuc2NyaWJlVmlkZW8iLCJtb2RlbCIsImdldCIsIkVycm9yIiwic2V0Iiwic2VuZGVyIiwiZ2V0VVJMIiwic2V0dGluZ3NTdG9yZSIsInN0b3JlRGF0YSIsIk9iamVjdCIsImtleXMiLCJhcGlLZXlEaXJlY3QiLCJhcGlLZXlOZXN0ZWQiLCJsZW5ndGgiLCJhcGlLZXkiLCJ3YXJuIiwiaGFzS2V5Iiwic291cmNlIiwidHJpbSIsImJlZm9yZURhdGEiLCJjdXJyZW50VHJhbnNjcmlwdGlvbiIsImRlZXBncmFtQXBpS2V5IiwibmVzdGVkRXJyb3IiLCJ2ZXJpZnlEaXJlY3RLZXkiLCJ2ZXJpZnlOZXN0ZWRLZXkiLCJkZWVwZ3JhbVNlcnZpY2UiLCJoYW5kbGVDb25maWd1cmUiLCJjb25maWdFcnJvciIsImRpcmVjdFBhdGhTYXZlZCIsIm5lc3RlZFBhdGhTYXZlZCIsImNsZWFudXBUcmFuc2NyaXB0aW9uSGFuZGxlcnMiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL2lwYy9oYW5kbGVycy90cmFuc2NyaXB0aW9uL2luZGV4LmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBUcmFuc2NyaXB0aW9uIElQQyBIYW5kbGVyc1xyXG4gKiBJbXBsZW1lbnRzIGhhbmRsZXJzIGZvciBhdWRpbyBhbmQgdmlkZW8gdHJhbnNjcmlwdGlvbiBvcGVyYXRpb25zLlxyXG4gKiBcclxuICogUmVsYXRlZCBmaWxlczpcclxuICogLSBzZXJ2aWNlcy9UcmFuc2NyaXB0aW9uU2VydmljZS5qczogVHJhbnNjcmlwdGlvbiBpbXBsZW1lbnRhdGlvblxyXG4gKiAtIHNlcnZpY2VzL0FwaUtleVNlcnZpY2UuanM6IEFQSSBrZXkgbWFuYWdlbWVudFxyXG4gKiAtIGlwYy9oYW5kbGVycy5qczogSGFuZGxlciByZWdpc3RyYXRpb25cclxuICogLSBwcmVsb2FkLmpzOiBBUEkgZXhwb3N1cmUgdG8gcmVuZGVyZXJcclxuICovXHJcblxyXG5jb25zdCB7IGlwY01haW4gfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IHsgY3JlYXRlU3RvcmUgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL3V0aWxzL3N0b3JlRmFjdG9yeScpO1xyXG5jb25zdCB0cmFuc2NyaXB0aW9uU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uLy4uL3NlcnZpY2VzL1RyYW5zY3JpcHRpb25TZXJ2aWNlJyk7XHJcbmNvbnN0IGFwaUtleVNlcnZpY2UgPSByZXF1aXJlKCcuLi8uLi8uLi9zZXJ2aWNlcy9BcGlLZXlTZXJ2aWNlJyk7XHJcbmNvbnN0IHsgSVBDQ2hhbm5lbHMgfSA9IHJlcXVpcmUoJy4uLy4uL3R5cGVzJyk7XHJcbmNvbnN0IHsgZ2V0VHJhbnNjcmlwdGlvbkNvbmZpZyB9ID0gcmVxdWlyZSgnLi4vLi4vLi4vc2VydmljZXMvdXRpbHMvY29uZmlnJyk7XHJcbi8vIFdpbGwgYmUgaW5pdGlhbGl6ZWQgYXN5bmNocm9ub3VzbHlcclxubGV0IENPTkZJRyA9IG51bGw7XHJcbi8vIEluaXRpYWxpemUgY29uZmlnIGFzIHNvb24gYXMgcG9zc2libGVcclxuKGFzeW5jIGZ1bmN0aW9uIGluaXRDb25maWcoKSB7XHJcbiAgdHJ5IHtcclxuICAgIENPTkZJRyA9IGF3YWl0IGdldFRyYW5zY3JpcHRpb25Db25maWcoKTtcclxuICAgIGNvbnNvbGUubG9nKCfinIUgVHJhbnNjcmlwdGlvbiBoYW5kbGVyczogQ29uZmlndXJhdGlvbiBsb2FkZWQnKTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcign4p2MIFRyYW5zY3JpcHRpb24gaGFuZGxlcnM6IEZhaWxlZCB0byBsb2FkIGNvbmZpZ3VyYXRpb246JywgZXJyb3IpO1xyXG4gICAgLy8gVXNlIGZhbGxiYWNrIGlmIG5lZWRlZFxyXG4gICAgQ09ORklHID0ge1xyXG4gICAgICBNT0RFTFM6IHsgJ3doaXNwZXItMSc6IHsgZGVmYXVsdDogdHJ1ZSB9IH0sXHJcbiAgICAgIERFRkFVTFRfTU9ERUw6ICd3aGlzcGVyLTEnXHJcbiAgICB9O1xyXG4gIH1cclxufSkoKTtcclxuXHJcbi8vIEluaXRpYWxpemUgc3RvcmUgd2l0aCBlcnJvciBoYW5kbGluZ1xyXG5jb25zdCBzdG9yZSA9IGNyZWF0ZVN0b3JlKCd0cmFuc2NyaXB0aW9uLWhhbmRsZXJzJyk7XHJcblxyXG4vKipcclxuICogUmVnaXN0ZXIgYWxsIHRyYW5zY3JpcHRpb24gcmVsYXRlZCBJUEMgaGFuZGxlcnNcclxuICovXHJcbmZ1bmN0aW9uIHJlZ2lzdGVyVHJhbnNjcmlwdGlvbkhhbmRsZXJzKCkge1xyXG4gIC8vIFRyYW5zY3JpYmUgYXVkaW8gZmlsZVxyXG4gIGlwY01haW4uaGFuZGxlKCdjb2RleDp0cmFuc2NyaWJlOmF1ZGlvJywgYXN5bmMgKGV2ZW50LCB7IGZpbGVQYXRoIH0pID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFZhbGlkYXRlIGZpbGUgcGF0aFxyXG4gICAgICBpZiAoIWZpbGVQYXRoIHx8IHR5cGVvZiBmaWxlUGF0aCAhPT0gJ3N0cmluZycpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICBlcnJvcjogJ0ludmFsaWQgZmlsZSBwYXRoJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIEdldCBmaWxlIGV4dGVuc2lvblxyXG4gICAgICBjb25zdCBleHQgPSBwYXRoLmV4dG5hbWUoZmlsZVBhdGgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGNvbnN0IHN1cHBvcnRlZEF1ZGlvRm9ybWF0cyA9IFsnLm1wMycsICcubXA0JywgJy5tcGVnJywgJy5tcGdhJywgJy5tNGEnLCAnLndhdicsICcud2VibSddO1xyXG4gICAgICBcclxuICAgICAgaWYgKCFzdXBwb3J0ZWRBdWRpb0Zvcm1hdHMuaW5jbHVkZXMoZXh0KSkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgIGVycm9yOiBgVW5zdXBwb3J0ZWQgYXVkaW8gZm9ybWF0OiAke2V4dH0uIFN1cHBvcnRlZCBmb3JtYXRzOiAke3N1cHBvcnRlZEF1ZGlvRm9ybWF0cy5qb2luKCcsICcpfWBcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDb252ZXJ0IHRvIHN1cHBvcnRlZCBmb3JtYXQgaWYgbmVlZGVkXHJcbiAgICAgIGxldCBhdWRpb1BhdGggPSBmaWxlUGF0aDtcclxuICAgICAgaWYgKCFbJy5tcDMnLCAnLm00YScsICcud2VibScsICcubXA0JywgJy5tcGdhJywgJy53YXYnXS5pbmNsdWRlcyhleHQpKSB7XHJcbiAgICAgICAgYXVkaW9QYXRoID0gYXdhaXQgdHJhbnNjcmlwdGlvblNlcnZpY2UuY29udmVydFRvU3VwcG9ydGVkRm9ybWF0KGZpbGVQYXRoKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gVHJhbnNjcmliZSBhdWRpb1xyXG4gICAgICBjb25zdCB0cmFuc2NyaXB0aW9uID0gYXdhaXQgdHJhbnNjcmlwdGlvblNlcnZpY2UudHJhbnNjcmliZUF1ZGlvKGF1ZGlvUGF0aCk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgdHJhbnNjcmlwdGlvbixcclxuICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgb3JpZ2luYWxGaWxlOiBmaWxlUGF0aCxcclxuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXHJcbiAgICAgICAgfVxyXG4gICAgICB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignQXVkaW8gdHJhbnNjcmlwdGlvbiBlcnJvcjonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfHwgJ0ZhaWxlZCB0byB0cmFuc2NyaWJlIGF1ZGlvJ1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH0pO1xyXG5cclxuICAvLyBUcmFuc2NyaWJlIHZpZGVvIGZpbGVcclxuICBpcGNNYWluLmhhbmRsZSgnY29kZXg6dHJhbnNjcmliZTp2aWRlbycsIGFzeW5jIChldmVudCwgeyBmaWxlUGF0aCB9KSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBWYWxpZGF0ZSBmaWxlIHBhdGhcclxuICAgICAgaWYgKCFmaWxlUGF0aCB8fCB0eXBlb2YgZmlsZVBhdGggIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgZXJyb3I6ICdJbnZhbGlkIGZpbGUgcGF0aCdcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBHZXQgZmlsZSBleHRlbnNpb25cclxuICAgICAgY29uc3QgZXh0ID0gcGF0aC5leHRuYW1lKGZpbGVQYXRoKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICBjb25zdCBzdXBwb3J0ZWRWaWRlb0Zvcm1hdHMgPSBbJy5tcDQnLCAnLm1wZWcnLCAnLm1wZycsICcubW92JywgJy53ZWJtJywgJy5hdmknXTtcclxuICAgICAgXHJcbiAgICAgIGlmICghc3VwcG9ydGVkVmlkZW9Gb3JtYXRzLmluY2x1ZGVzKGV4dCkpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICBlcnJvcjogYFVuc3VwcG9ydGVkIHZpZGVvIGZvcm1hdDogJHtleHR9LiBTdXBwb3J0ZWQgZm9ybWF0czogJHtzdXBwb3J0ZWRWaWRlb0Zvcm1hdHMuam9pbignLCAnKX1gXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gVHJhbnNjcmliZSB2aWRlb1xyXG4gICAgICBjb25zdCB0cmFuc2NyaXB0aW9uID0gYXdhaXQgdHJhbnNjcmlwdGlvblNlcnZpY2UudHJhbnNjcmliZVZpZGVvKGZpbGVQYXRoKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICB0cmFuc2NyaXB0aW9uLFxyXG4gICAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgICBvcmlnaW5hbEZpbGU6IGZpbGVQYXRoLFxyXG4gICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdWaWRlbyB0cmFuc2NyaXB0aW9uIGVycm9yOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSB8fCAnRmFpbGVkIHRvIHRyYW5zY3JpYmUgdmlkZW8nXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfSk7XHJcblxyXG4gIC8vIEdldCBjdXJyZW50IHRyYW5zY3JpcHRpb24gbW9kZWxcclxuICBpcGNNYWluLmhhbmRsZSgnY29kZXg6dHJhbnNjcmlwdGlvbjpnZXQtbW9kZWwnLCBhc3luYyAoKSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHN0b3JlLmdldCgndHJhbnNjcmlwdGlvbk1vZGVsJyk7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICBtb2RlbDogbW9kZWwgfHwgQ09ORklHLkRFRkFVTFRfTU9ERUxcclxuICAgICAgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdldHRpbmcgdHJhbnNjcmlwdGlvbiBtb2RlbDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfHwgJ0ZhaWxlZCB0byBnZXQgdHJhbnNjcmlwdGlvbiBtb2RlbCdcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgLy8gU2V0IHRyYW5zY3JpcHRpb24gbW9kZWxcclxuICBpcGNNYWluLmhhbmRsZSgnY29kZXg6dHJhbnNjcmlwdGlvbjpzZXQtbW9kZWwnLCBhc3luYyAoZXZlbnQsIHsgbW9kZWwgfSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgaWYgKCFDT05GSUcuTU9ERUxTW21vZGVsXSkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBtb2RlbDogJHttb2RlbH1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgYXdhaXQgc3RvcmUuc2V0KCd0cmFuc2NyaXB0aW9uTW9kZWwnLCBtb2RlbCk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHNldHRpbmcgdHJhbnNjcmlwdGlvbiBtb2RlbDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfHwgJ0ZhaWxlZCB0byBzZXQgdHJhbnNjcmlwdGlvbiBtb2RlbCdcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgLy8gR2V0IERlZXBncmFtIEFQSSBrZXkgd2l0aCBlbmhhbmNlZCBkZWJ1Z2dpbmdcclxuICBpcGNNYWluLmhhbmRsZSgnY29kZXg6dHJhbnNjcmlwdGlvbjpnZXQtYXBpLWtleScsIGFzeW5jIChldmVudCkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYFtUcmFuc2NyaXB0aW9uXSBHZXQgRGVlcGdyYW0gQVBJIGtleSByZXF1ZXN0ZWQgZnJvbSAke2V2ZW50Py5zZW5kZXI/LmdldFVSTD8uKCkgfHwgJ3Vua25vd24gc291cmNlJ31gKTtcclxuXHJcbiAgICAgIC8vIENyZWF0ZSBhIGZyZXNoIHNldHRpbmdzIHN0b3JlIGluc3RhbmNlXHJcbiAgICAgIGNvbnN0IHNldHRpbmdzU3RvcmUgPSBjcmVhdGVTdG9yZSgnc2V0dGluZ3MnKTtcclxuXHJcbiAgICAgIC8vIEdldCBzdG9yZSBkYXRhIGZvciBkZWJ1Z2dpbmdcclxuICAgICAgY29uc3Qgc3RvcmVEYXRhID0gc2V0dGluZ3NTdG9yZS5zdG9yZTtcclxuICAgICAgY29uc29sZS5sb2coYFtUcmFuc2NyaXB0aW9uXSBTZXR0aW5ncyBzdG9yZSBkYXRhIGtleXM6ICR7T2JqZWN0LmtleXMoc3RvcmVEYXRhIHx8IHt9KS5qb2luKCcsICcpfWApO1xyXG5cclxuICAgICAgLy8gVHJ5IG11bHRpcGxlIHBvc3NpYmxlIGtleSBsb2NhdGlvbnNcclxuICAgICAgY29uc3QgYXBpS2V5RGlyZWN0ID0gc2V0dGluZ3NTdG9yZS5nZXQoJ2RlZXBncmFtQXBpS2V5Jyk7XHJcbiAgICAgIGNvbnN0IGFwaUtleU5lc3RlZCA9IHNldHRpbmdzU3RvcmUuZ2V0KCd0cmFuc2NyaXB0aW9uLmRlZXBncmFtQXBpS2V5Jyk7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgW1RyYW5zY3JpcHRpb25dIFJldHJpZXZlZCBBUEkga2V5OlxyXG4gICAgICAgIC0gRGlyZWN0IHBhdGggKGRlZXBncmFtQXBpS2V5KTogJHthcGlLZXlEaXJlY3QgPyAnRm91bmQgKGxlbmd0aDogJyArIGFwaUtleURpcmVjdC5sZW5ndGggKyAnKScgOiAnTm90IGZvdW5kJ31cclxuICAgICAgICAtIE5lc3RlZCBwYXRoICh0cmFuc2NyaXB0aW9uLmRlZXBncmFtQXBpS2V5KTogJHthcGlLZXlOZXN0ZWQgPyAnRm91bmQgKGxlbmd0aDogJyArIGFwaUtleU5lc3RlZC5sZW5ndGggKyAnKScgOiAnTm90IGZvdW5kJ31gKTtcclxuXHJcbiAgICAgIC8vIFVzZSB0aGUgZmlyc3QgZm91bmQga2V5XHJcbiAgICAgIGNvbnN0IGFwaUtleSA9IGFwaUtleURpcmVjdCB8fCBhcGlLZXlOZXN0ZWQgfHwgJyc7XHJcblxyXG4gICAgICAvLyBBZGRpdGlvbmFsIGxvZ2dpbmdcclxuICAgICAgaWYgKCFhcGlLZXkpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYFtUcmFuc2NyaXB0aW9uXSBObyBEZWVwZ3JhbSBBUEkga2V5IGZvdW5kIGluIGFueSBsb2NhdGlvbmApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgYXBpS2V5OiBhcGlLZXksXHJcbiAgICAgICAgaGFzS2V5OiAhIWFwaUtleSxcclxuICAgICAgICBzb3VyY2U6IGFwaUtleURpcmVjdCA/ICdkaXJlY3QnIDogKGFwaUtleU5lc3RlZCA/ICduZXN0ZWQnIDogJ25vbmUnKVxyXG4gICAgICB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignW1RyYW5zY3JpcHRpb25dIEVycm9yIGdldHRpbmcgRGVlcGdyYW0gQVBJIGtleTonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfHwgJ0ZhaWxlZCB0byBnZXQgRGVlcGdyYW0gQVBJIGtleSdcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgLy8gU2V0IERlZXBncmFtIEFQSSBrZXkgd2l0aCBlbmhhbmNlZCBkZWJ1Z2dpbmcgYW5kIHJlbGlhYmxlIHN0b3JhZ2VcclxuICBpcGNNYWluLmhhbmRsZSgnY29kZXg6dHJhbnNjcmlwdGlvbjpzZXQtYXBpLWtleScsIGFzeW5jIChldmVudCwgeyBhcGlLZXkgfSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYFtUcmFuc2NyaXB0aW9uXSBTZXR0aW5nIERlZXBncmFtIEFQSSBrZXkgKGxlbmd0aDogJHthcGlLZXk/Lmxlbmd0aCB8fCAwfSkgZnJvbSAke2V2ZW50Py5zZW5kZXI/LmdldFVSTD8uKCkgfHwgJ3Vua25vd24gc291cmNlJ31gKTtcclxuXHJcbiAgICAgIC8vIFZhbGlkYXRlIEFQSSBrZXlcclxuICAgICAgaWYgKCFhcGlLZXkgfHwgdHlwZW9mIGFwaUtleSAhPT0gJ3N0cmluZycgfHwgYXBpS2V5LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgQVBJIGtleScpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDcmVhdGUgYSBmcmVzaCBzZXR0aW5ncyBzdG9yZSBpbnN0YW5jZVxyXG4gICAgICBjb25zdCBzZXR0aW5nc1N0b3JlID0gY3JlYXRlU3RvcmUoJ3NldHRpbmdzJyk7XHJcblxyXG4gICAgICAvLyBMb2cgY3VycmVudCBzdG9yZSBkYXRhIGZvciBkZWJ1Z2dpbmdcclxuICAgICAgY29uc3QgYmVmb3JlRGF0YSA9IHNldHRpbmdzU3RvcmUuc3RvcmU7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBbVHJhbnNjcmlwdGlvbl0gU2V0dGluZ3Mgc3RvcmUgZGF0YSBiZWZvcmUgdXBkYXRlOiAke09iamVjdC5rZXlzKGJlZm9yZURhdGEgfHwge30pLmpvaW4oJywgJyl9YCk7XHJcblxyXG4gICAgICAvLyBTdG9yZSB0aGUgQVBJIGtleSBpbiBib3RoIGxvY2F0aW9ucyBmb3IgbWF4aW11bSBjb21wYXRpYmlsaXR5XHJcbiAgICAgIGNvbnNvbGUubG9nKGBbVHJhbnNjcmlwdGlvbl0gU3RvcmluZyBBUEkga2V5IGluIGRpcmVjdCBhbmQgbmVzdGVkIHBhdGhzLi4uYCk7XHJcblxyXG4gICAgICAvLyBGaXJzdCBzdG9yZSBhdCB0aGUgZGlyZWN0IHBhdGhcclxuICAgICAgc2V0dGluZ3NTdG9yZS5zZXQoJ2RlZXBncmFtQXBpS2V5JywgYXBpS2V5KTtcclxuXHJcbiAgICAgIC8vIFRoZW4gc3RvcmUgYXQgdGhlIG5lc3RlZCBwYXRoXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gR2V0IGN1cnJlbnQgdHJhbnNjcmlwdGlvbiBzZXR0aW5ncywgaWYgYW55XHJcbiAgICAgICAgY29uc3QgY3VycmVudFRyYW5zY3JpcHRpb24gPSBzZXR0aW5nc1N0b3JlLmdldCgndHJhbnNjcmlwdGlvbicpIHx8IHt9O1xyXG4gICAgICAgIC8vIFVwZGF0ZSB3aXRoIG5ldyBBUEkga2V5XHJcbiAgICAgICAgY3VycmVudFRyYW5zY3JpcHRpb24uZGVlcGdyYW1BcGlLZXkgPSBhcGlLZXk7XHJcbiAgICAgICAgLy8gU2F2ZSBiYWNrIHRvIHN0b3JlXHJcbiAgICAgICAgc2V0dGluZ3NTdG9yZS5zZXQoJ3RyYW5zY3JpcHRpb24nLCBjdXJyZW50VHJhbnNjcmlwdGlvbik7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtUcmFuc2NyaXB0aW9uXSBTdWNjZXNzZnVsbHkgc2F2ZWQgQVBJIGtleSB0byBuZXN0ZWQgcGF0aGApO1xyXG4gICAgICB9IGNhdGNoIChuZXN0ZWRFcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFtUcmFuc2NyaXB0aW9uXSBFcnJvciBzYXZpbmcgdG8gbmVzdGVkIHBhdGg6YCwgbmVzdGVkRXJyb3IpO1xyXG4gICAgICAgIC8vIENvbnRpbnVlIHdpdGgganVzdCB0aGUgZGlyZWN0IHBhdGggaWYgbmVzdGVkIHBhdGggZmFpbHNcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gVmVyaWZ5IGJvdGgga2V5cyB3ZXJlIHNhdmVkIGNvcnJlY3RseVxyXG4gICAgICBjb25zdCB2ZXJpZnlEaXJlY3RLZXkgPSBzZXR0aW5nc1N0b3JlLmdldCgnZGVlcGdyYW1BcGlLZXknKTtcclxuICAgICAgY29uc3QgdmVyaWZ5TmVzdGVkS2V5ID0gc2V0dGluZ3NTdG9yZS5nZXQoJ3RyYW5zY3JpcHRpb24uZGVlcGdyYW1BcGlLZXknKTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBbVHJhbnNjcmlwdGlvbl0gVmVyaWZpY2F0aW9uIHJlc3VsdHM6XHJcbiAgICAgICAgLSBEaXJlY3QgcGF0aCAoZGVlcGdyYW1BcGlLZXkpOiAke3ZlcmlmeURpcmVjdEtleSA/ICdTYXZlZCAobGVuZ3RoOiAnICsgdmVyaWZ5RGlyZWN0S2V5Lmxlbmd0aCArICcpJyA6ICdGYWlsZWQnfVxyXG4gICAgICAgIC0gTmVzdGVkIHBhdGggKHRyYW5zY3JpcHRpb24uZGVlcGdyYW1BcGlLZXkpOiAke3ZlcmlmeU5lc3RlZEtleSA/ICdTYXZlZCAobGVuZ3RoOiAnICsgdmVyaWZ5TmVzdGVkS2V5Lmxlbmd0aCArICcpJyA6ICdGYWlsZWQnfWApO1xyXG5cclxuICAgICAgLy8gQWxzbyBjb25maWd1cmUgRGVlcGdyYW0gc2VydmljZSB3aXRoIHRoZSBuZXcga2V5XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgZGVlcGdyYW1TZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vLi4vc2VydmljZXMvYWkvRGVlcGdyYW1TZXJ2aWNlJyk7XHJcbiAgICAgICAgaWYgKGRlZXBncmFtU2VydmljZSAmJiBkZWVwZ3JhbVNlcnZpY2UuaGFuZGxlQ29uZmlndXJlKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgW1RyYW5zY3JpcHRpb25dIENvbmZpZ3VyaW5nIERlZXBncmFtIHNlcnZpY2Ugd2l0aCB0aGUgbmV3IEFQSSBrZXlgKTtcclxuICAgICAgICAgIGF3YWl0IGRlZXBncmFtU2VydmljZS5oYW5kbGVDb25maWd1cmUoZXZlbnQsIHsgYXBpS2V5IH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoY29uZmlnRXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBbVHJhbnNjcmlwdGlvbl0gRXJyb3IgY29uZmlndXJpbmcgRGVlcGdyYW0gc2VydmljZTpgLCBjb25maWdFcnJvcik7XHJcbiAgICAgICAgLy8gQ29udGludWUgZXZlbiBpZiBjb25maWd1cmF0aW9uIGZhaWxzXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIEZpbmFsIHZlcmlmaWNhdGlvblxyXG4gICAgICBpZiAoIXZlcmlmeURpcmVjdEtleSAmJiAhdmVyaWZ5TmVzdGVkS2V5KSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gc2F2ZSBBUEkga2V5LiBTZXR0aW5ncyBzdG9yZSBtYXkgYmUgY29ycnVwdGVkLicpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgZGlyZWN0UGF0aFNhdmVkOiAhIXZlcmlmeURpcmVjdEtleSxcclxuICAgICAgICBuZXN0ZWRQYXRoU2F2ZWQ6ICEhdmVyaWZ5TmVzdGVkS2V5XHJcbiAgICAgIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdbVHJhbnNjcmlwdGlvbl0gRXJyb3Igc2V0dGluZyBEZWVwZ3JhbSBBUEkga2V5OicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSB8fCAnRmFpbGVkIHRvIHNldCBEZWVwZ3JhbSBBUEkga2V5J1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH0pO1xyXG5cclxuICBjb25zb2xlLmxvZygnVHJhbnNjcmlwdGlvbiBJUEMgaGFuZGxlcnMgcmVnaXN0ZXJlZCcpO1xyXG59XHJcblxyXG4vKipcclxuICogQ2xlYW4gdXAgYW55IHJlc291cmNlcyB3aGVuIHRoZSBhcHAgaXMgc2h1dHRpbmcgZG93blxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gY2xlYW51cFRyYW5zY3JpcHRpb25IYW5kbGVycygpIHtcclxuICAvLyBObyBjbGVhbnVwIG5lZWRlZCBmb3IgdHJhbnNjcmlwdGlvbiBoYW5kbGVyc1xyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHtcclxuICByZWdpc3RlclRyYW5zY3JpcHRpb25IYW5kbGVycyxcclxuICBjbGVhbnVwVHJhbnNjcmlwdGlvbkhhbmRsZXJzXHJcbn07XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNO0VBQUVBO0FBQVEsQ0FBQyxHQUFHQyxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ3ZDLE1BQU1DLElBQUksR0FBR0QsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNO0VBQUVFO0FBQVksQ0FBQyxHQUFHRixPQUFPLENBQUMsNkJBQTZCLENBQUM7QUFDOUQsTUFBTUcsb0JBQW9CLEdBQUdILE9BQU8sQ0FBQyx3Q0FBd0MsQ0FBQztBQUM5RSxNQUFNSSxhQUFhLEdBQUdK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