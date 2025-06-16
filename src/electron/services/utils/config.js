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
  // Hardcoded configuration for Deepgram transcription
  return {
    MODELS: {
      'deepgram-nova-2': {
        name: 'Deepgram Nova-2',
        description: 'Deepgram Nova-2 model',
        features: ['timestamps', 'punctuation', 'paragraphs'],
        default: true
      }
    },
    DEFAULT_MODEL: 'deepgram-nova-2',
    RESPONSE_FORMATS: {
      'deepgram-nova-2': ['json', 'text', 'srt', 'vtt']
    }
  };
}

module.exports = {
  getTranscriptionConfig
};
