/**
 * transcriptionConfigAdapter.js
 * 
 * This adapter provides access to the transcription configuration for Electron services.
 * It uses dynamic imports to load the ES Module configuration while maintaining CommonJS
 * compatibility. The configuration is cached after first load for performance.
 * 
 * Related files:
 * - backend/src/config/transcription.js: The source of truth configuration (ES Module)
 * - src/electron/services/TranscriptionService.js: The consumer of this adapter
 */

// Cache for the configuration
let cachedConfig = null;

/**
 * Dynamically imports and returns the transcription configuration
 * @returns {Promise<object>} The transcription configuration
 */
async function getConfig() {
  try {
    if (!cachedConfig) {
      // Use dynamic import to load the ES Module
      const configModule = await import('../../../backend/src/config/transcription.js');
      
      // Validate the imported configuration
      if (!configModule.default || !configModule.default.MODELS) {
        throw new Error('Invalid configuration format');
      }
      
      // Cache the configuration
      cachedConfig = configModule.default;
      console.log('✅ Successfully loaded transcription configuration');
    }
    
    return cachedConfig;
  } catch (error) {
    console.error('❌ Failed to load transcription configuration:', error);
    // Return a fallback configuration in case of error
    return {
      MODELS: {
        'whisper-1': {
          name: 'Whisper',
          description: 'Fallback model (configuration error)',
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
}

module.exports = {
  getConfig,
  // For synchronous access to the cached config (may be null initially)
  get currentConfig() {
    return cachedConfig;
  }
};
