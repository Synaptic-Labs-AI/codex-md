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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJpcGNNYWluIiwicmVxdWlyZSIsInBhdGgiLCJjcmVhdGVTdG9yZSIsInRyYW5zY3JpcHRpb25TZXJ2aWNlIiwiYXBpS2V5U2VydmljZSIsIklQQ0NoYW5uZWxzIiwiZ2V0VHJhbnNjcmlwdGlvbkNvbmZpZyIsIkNPTkZJRyIsImluaXRDb25maWciLCJjb25zb2xlIiwibG9nIiwiZXJyb3IiLCJNT0RFTFMiLCJkZWZhdWx0IiwiREVGQVVMVF9NT0RFTCIsInN0b3JlIiwicmVnaXN0ZXJUcmFuc2NyaXB0aW9uSGFuZGxlcnMiLCJoYW5kbGUiLCJldmVudCIsImZpbGVQYXRoIiwic3VjY2VzcyIsImV4dCIsImV4dG5hbWUiLCJ0b0xvd2VyQ2FzZSIsInN1cHBvcnRlZEF1ZGlvRm9ybWF0cyIsImluY2x1ZGVzIiwiam9pbiIsImF1ZGlvUGF0aCIsImNvbnZlcnRUb1N1cHBvcnRlZEZvcm1hdCIsInRyYW5zY3JpcHRpb24iLCJ0cmFuc2NyaWJlQXVkaW8iLCJtZXRhZGF0YSIsIm9yaWdpbmFsRmlsZSIsInRpbWVzdGFtcCIsIkRhdGUiLCJ0b0lTT1N0cmluZyIsIm1lc3NhZ2UiLCJzdXBwb3J0ZWRWaWRlb0Zvcm1hdHMiLCJ0cmFuc2NyaWJlVmlkZW8iLCJtb2RlbCIsImdldCIsIkVycm9yIiwic2V0IiwiY2xlYW51cFRyYW5zY3JpcHRpb25IYW5kbGVycyIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vaXBjL2hhbmRsZXJzL3RyYW5zY3JpcHRpb24vaW5kZXguanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFRyYW5zY3JpcHRpb24gSVBDIEhhbmRsZXJzXHJcbiAqIEltcGxlbWVudHMgaGFuZGxlcnMgZm9yIGF1ZGlvIGFuZCB2aWRlbyB0cmFuc2NyaXB0aW9uIG9wZXJhdGlvbnMuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNlcnZpY2VzL1RyYW5zY3JpcHRpb25TZXJ2aWNlLmpzOiBUcmFuc2NyaXB0aW9uIGltcGxlbWVudGF0aW9uXHJcbiAqIC0gc2VydmljZXMvQXBpS2V5U2VydmljZS5qczogQVBJIGtleSBtYW5hZ2VtZW50XHJcbiAqIC0gaXBjL2hhbmRsZXJzLmpzOiBIYW5kbGVyIHJlZ2lzdHJhdGlvblxyXG4gKiAtIHByZWxvYWQuanM6IEFQSSBleHBvc3VyZSB0byByZW5kZXJlclxyXG4gKi9cclxuXHJcbmNvbnN0IHsgaXBjTWFpbiB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgeyBjcmVhdGVTdG9yZSB9ID0gcmVxdWlyZSgnLi4vLi4vLi4vdXRpbHMvc3RvcmVGYWN0b3J5Jyk7XHJcbmNvbnN0IHRyYW5zY3JpcHRpb25TZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vLi4vc2VydmljZXMvVHJhbnNjcmlwdGlvblNlcnZpY2UnKTtcclxuY29uc3QgYXBpS2V5U2VydmljZSA9IHJlcXVpcmUoJy4uLy4uLy4uL3NlcnZpY2VzL0FwaUtleVNlcnZpY2UnKTtcclxuY29uc3QgeyBJUENDaGFubmVscyB9ID0gcmVxdWlyZSgnLi4vLi4vdHlwZXMnKTtcclxuY29uc3QgeyBnZXRUcmFuc2NyaXB0aW9uQ29uZmlnIH0gPSByZXF1aXJlKCcuLi8uLi8uLi9zZXJ2aWNlcy91dGlscy9jb25maWcnKTtcclxuLy8gV2lsbCBiZSBpbml0aWFsaXplZCBhc3luY2hyb25vdXNseVxyXG5sZXQgQ09ORklHID0gbnVsbDtcclxuLy8gSW5pdGlhbGl6ZSBjb25maWcgYXMgc29vbiBhcyBwb3NzaWJsZVxyXG4oYXN5bmMgZnVuY3Rpb24gaW5pdENvbmZpZygpIHtcclxuICB0cnkge1xyXG4gICAgQ09ORklHID0gYXdhaXQgZ2V0VHJhbnNjcmlwdGlvbkNvbmZpZygpO1xyXG4gICAgY29uc29sZS5sb2coJ+KchSBUcmFuc2NyaXB0aW9uIGhhbmRsZXJzOiBDb25maWd1cmF0aW9uIGxvYWRlZCcpO1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCfinYwgVHJhbnNjcmlwdGlvbiBoYW5kbGVyczogRmFpbGVkIHRvIGxvYWQgY29uZmlndXJhdGlvbjonLCBlcnJvcik7XHJcbiAgICAvLyBVc2UgZmFsbGJhY2sgaWYgbmVlZGVkXHJcbiAgICBDT05GSUcgPSB7XHJcbiAgICAgIE1PREVMUzogeyAnd2hpc3Blci0xJzogeyBkZWZhdWx0OiB0cnVlIH0gfSxcclxuICAgICAgREVGQVVMVF9NT0RFTDogJ3doaXNwZXItMSdcclxuICAgIH07XHJcbiAgfVxyXG59KSgpO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBzdG9yZSB3aXRoIGVycm9yIGhhbmRsaW5nXHJcbmNvbnN0IHN0b3JlID0gY3JlYXRlU3RvcmUoJ3RyYW5zY3JpcHRpb24taGFuZGxlcnMnKTtcclxuXHJcbi8qKlxyXG4gKiBSZWdpc3RlciBhbGwgdHJhbnNjcmlwdGlvbiByZWxhdGVkIElQQyBoYW5kbGVyc1xyXG4gKi9cclxuZnVuY3Rpb24gcmVnaXN0ZXJUcmFuc2NyaXB0aW9uSGFuZGxlcnMoKSB7XHJcbiAgLy8gVHJhbnNjcmliZSBhdWRpbyBmaWxlXHJcbiAgaXBjTWFpbi5oYW5kbGUoJ2NvZGV4OnRyYW5zY3JpYmU6YXVkaW8nLCBhc3luYyAoZXZlbnQsIHsgZmlsZVBhdGggfSkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVmFsaWRhdGUgZmlsZSBwYXRoXHJcbiAgICAgIGlmICghZmlsZVBhdGggfHwgdHlwZW9mIGZpbGVQYXRoICE9PSAnc3RyaW5nJykge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgIGVycm9yOiAnSW52YWxpZCBmaWxlIHBhdGgnXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gR2V0IGZpbGUgZXh0ZW5zaW9uXHJcbiAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgY29uc3Qgc3VwcG9ydGVkQXVkaW9Gb3JtYXRzID0gWycubXAzJywgJy5tcDQnLCAnLm1wZWcnLCAnLm1wZ2EnLCAnLm00YScsICcud2F2JywgJy53ZWJtJ107XHJcbiAgICAgIFxyXG4gICAgICBpZiAoIXN1cHBvcnRlZEF1ZGlvRm9ybWF0cy5pbmNsdWRlcyhleHQpKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgZXJyb3I6IGBVbnN1cHBvcnRlZCBhdWRpbyBmb3JtYXQ6ICR7ZXh0fS4gU3VwcG9ydGVkIGZvcm1hdHM6ICR7c3VwcG9ydGVkQXVkaW9Gb3JtYXRzLmpvaW4oJywgJyl9YFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIENvbnZlcnQgdG8gc3VwcG9ydGVkIGZvcm1hdCBpZiBuZWVkZWRcclxuICAgICAgbGV0IGF1ZGlvUGF0aCA9IGZpbGVQYXRoO1xyXG4gICAgICBpZiAoIVsnLm1wMycsICcubTRhJywgJy53ZWJtJywgJy5tcDQnLCAnLm1wZ2EnLCAnLndhdiddLmluY2x1ZGVzKGV4dCkpIHtcclxuICAgICAgICBhdWRpb1BhdGggPSBhd2FpdCB0cmFuc2NyaXB0aW9uU2VydmljZS5jb252ZXJ0VG9TdXBwb3J0ZWRGb3JtYXQoZmlsZVBhdGgpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBUcmFuc2NyaWJlIGF1ZGlvXHJcbiAgICAgIGNvbnN0IHRyYW5zY3JpcHRpb24gPSBhd2FpdCB0cmFuc2NyaXB0aW9uU2VydmljZS50cmFuc2NyaWJlQXVkaW8oYXVkaW9QYXRoKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICB0cmFuc2NyaXB0aW9uLFxyXG4gICAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgICBvcmlnaW5hbEZpbGU6IGZpbGVQYXRoLFxyXG4gICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdBdWRpbyB0cmFuc2NyaXB0aW9uIGVycm9yOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSB8fCAnRmFpbGVkIHRvIHRyYW5zY3JpYmUgYXVkaW8nXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfSk7XHJcblxyXG4gIC8vIFRyYW5zY3JpYmUgdmlkZW8gZmlsZVxyXG4gIGlwY01haW4uaGFuZGxlKCdjb2RleDp0cmFuc2NyaWJlOnZpZGVvJywgYXN5bmMgKGV2ZW50LCB7IGZpbGVQYXRoIH0pID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFZhbGlkYXRlIGZpbGUgcGF0aFxyXG4gICAgICBpZiAoIWZpbGVQYXRoIHx8IHR5cGVvZiBmaWxlUGF0aCAhPT0gJ3N0cmluZycpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICBlcnJvcjogJ0ludmFsaWQgZmlsZSBwYXRoJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIEdldCBmaWxlIGV4dGVuc2lvblxyXG4gICAgICBjb25zdCBleHQgPSBwYXRoLmV4dG5hbWUoZmlsZVBhdGgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGNvbnN0IHN1cHBvcnRlZFZpZGVvRm9ybWF0cyA9IFsnLm1wNCcsICcubXBlZycsICcubXBnJywgJy5tb3YnLCAnLndlYm0nLCAnLmF2aSddO1xyXG4gICAgICBcclxuICAgICAgaWYgKCFzdXBwb3J0ZWRWaWRlb0Zvcm1hdHMuaW5jbHVkZXMoZXh0KSkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgIGVycm9yOiBgVW5zdXBwb3J0ZWQgdmlkZW8gZm9ybWF0OiAke2V4dH0uIFN1cHBvcnRlZCBmb3JtYXRzOiAke3N1cHBvcnRlZFZpZGVvRm9ybWF0cy5qb2luKCcsICcpfWBcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBUcmFuc2NyaWJlIHZpZGVvXHJcbiAgICAgIGNvbnN0IHRyYW5zY3JpcHRpb24gPSBhd2FpdCB0cmFuc2NyaXB0aW9uU2VydmljZS50cmFuc2NyaWJlVmlkZW8oZmlsZVBhdGgpO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIHRyYW5zY3JpcHRpb24sXHJcbiAgICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICAgIG9yaWdpbmFsRmlsZTogZmlsZVBhdGgsXHJcbiAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1ZpZGVvIHRyYW5zY3JpcHRpb24gZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlIHx8ICdGYWlsZWQgdG8gdHJhbnNjcmliZSB2aWRlbydcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgLy8gR2V0IGN1cnJlbnQgdHJhbnNjcmlwdGlvbiBtb2RlbFxyXG4gIGlwY01haW4uaGFuZGxlKCdjb2RleDp0cmFuc2NyaXB0aW9uOmdldC1tb2RlbCcsIGFzeW5jICgpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgc3RvcmUuZ2V0KCd0cmFuc2NyaXB0aW9uTW9kZWwnKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIG1vZGVsOiBtb2RlbCB8fCBDT05GSUcuREVGQVVMVF9NT0RFTFxyXG4gICAgICB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2V0dGluZyB0cmFuc2NyaXB0aW9uIG1vZGVsOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSB8fCAnRmFpbGVkIHRvIGdldCB0cmFuc2NyaXB0aW9uIG1vZGVsJ1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH0pO1xyXG5cclxuICAvLyBTZXQgdHJhbnNjcmlwdGlvbiBtb2RlbFxyXG4gIGlwY01haW4uaGFuZGxlKCdjb2RleDp0cmFuc2NyaXB0aW9uOnNldC1tb2RlbCcsIGFzeW5jIChldmVudCwgeyBtb2RlbCB9KSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBpZiAoIUNPTkZJRy5NT0RFTFNbbW9kZWxdKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIG1vZGVsOiAke21vZGVsfWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBhd2FpdCBzdG9yZS5zZXQoJ3RyYW5zY3JpcHRpb25Nb2RlbCcsIG1vZGVsKTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igc2V0dGluZyB0cmFuc2NyaXB0aW9uIG1vZGVsOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSB8fCAnRmFpbGVkIHRvIHNldCB0cmFuc2NyaXB0aW9uIG1vZGVsJ1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH0pO1xyXG5cclxuICBjb25zb2xlLmxvZygnVHJhbnNjcmlwdGlvbiBJUEMgaGFuZGxlcnMgcmVnaXN0ZXJlZCcpO1xyXG59XHJcblxyXG4vKipcclxuICogQ2xlYW4gdXAgYW55IHJlc291cmNlcyB3aGVuIHRoZSBhcHAgaXMgc2h1dHRpbmcgZG93blxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gY2xlYW51cFRyYW5zY3JpcHRpb25IYW5kbGVycygpIHtcclxuICAvLyBObyBjbGVhbnVwIG5lZWRlZCBmb3IgdHJhbnNjcmlwdGlvbiBoYW5kbGVyc1xyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHtcclxuICByZWdpc3RlclRyYW5zY3JpcHRpb25IYW5kbGVycyxcclxuICBjbGVhbnVwVHJhbnNjcmlwdGlvbkhhbmRsZXJzXHJcbn07XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNO0VBQUVBO0FBQVEsQ0FBQyxHQUFHQyxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ3ZDLE1BQU1DLElBQUksR0FBR0QsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNO0VBQUVFO0FBQVksQ0FBQyxHQUFHRixPQUFPLENBQUMsNkJBQTZCLENBQUM7QUFDOUQsTUFBTUcsb0JBQW9CLEdBQUdILE9BQU8sQ0FBQyx3Q0FBd0MsQ0FBQztBQUM5RSxNQUFNSSxhQUFhLEdBQUdKLE9BQU8sQ0FBQyxpQ0FBaUMsQ0FBQztBQUNoRSxNQUFNO0VBQUVLO0FBQVksQ0FBQyxHQUFHTCxPQUFPLENBQUMsYUFBYSxDQUFDO0FBQzlDLE1BQU07RUFBRU07QUFBdUIsQ0FBQyxHQUFHTixPQUFPLENBQUMsZ0NBQWdDLENBQUM7QUFDNUU7QUFDQSxJQUFJTyxNQUFNLEdBQUcsSUFBSTtBQUNqQjtBQUNBLENBQUMsZUFBZUMsVUFBVUEsQ0FBQSxFQUFHO0VBQzNCLElBQUk7SUFDRkQsTUFBTSxHQUFHLE1BQU1ELHNCQUFzQixDQUFD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