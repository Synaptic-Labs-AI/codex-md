/**
 * config.js
 * 
 * Utility functions for handling configuration loading and caching.
 * Provides hardcoded configurations that were previously loaded from separate configuration files.
 * 
 * Related files:
 * - src/electron/services/ai/TranscriberService.js: Uses transcription config
 */

/**
 * Get transcription configuration
 * @returns {object} The transcription configuration
 */
function getTranscriptionConfig() {
  // Hardcoded configuration that was previously in a separate config file
  return {
    MODELS: {
      'whisper-1': {
        name: 'Whisper',
        description: 'OpenAI Whisper model',
        features: ['timestamps'],
        default: true
      }
    },
    DEFAULT_MODEL: 'whisper-1',
    RESPONSE_FORMATS: {
      'whisper-1': ['json', 'text']
    }
  };
}

module.exports = {
  getTranscriptionConfig
};
