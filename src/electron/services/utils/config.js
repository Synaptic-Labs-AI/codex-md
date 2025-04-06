/**
 * config.js
 * 
 * Utility functions for handling configuration loading and caching.
 * Consolidates configuration functionality that was previously in adapters.
 * 
 * Related files:
 * - src/electron/services/TranscriptionService.js: Uses transcription config
 * - backend/src/config/transcription.js: Source configuration
 */

// Cache for configurations
const configCache = new Map();

/**
 * Load configuration from an ES module
 * @param {string} configPath - Path to the config module
 * @param {object} fallback - Fallback configuration if loading fails
 * @param {function} validate - Optional validation function
 * @returns {Promise<object>} - The loaded configuration
 */
async function loadConfig(configPath, fallback, validate = null) {
  try {
    // Check cache first
    if (configCache.has(configPath)) {
      return configCache.get(configPath);
    }

    // Use dynamic import to load the ES Module
    const configModule = await import(configPath);
    
    // Get the configuration
    const config = configModule.default;

    // Validate if a validation function is provided
    if (validate && typeof validate === 'function') {
      const isValid = validate(config);
      if (!isValid) {
        throw new Error('Invalid configuration format');
      }
    }

    // Cache the configuration
    configCache.set(configPath, config);
    
    console.log(`✅ Successfully loaded configuration from ${configPath}`);
    return config;

  } catch (error) {
    console.error(`❌ Failed to load configuration from ${configPath}:`, error);
    
    // Use fallback configuration
    if (fallback) {
      console.warn('⚠️ Using fallback configuration');
      return fallback;
    }
    
    throw error;
  }
}

/**
 * Clear the configuration cache
 * @param {string} [configPath] - Specific config path to clear, or all if not provided
 */
function clearConfigCache(configPath = null) {
  if (configPath) {
    configCache.delete(configPath);
  } else {
    configCache.clear();
  }
}

/**
 * Get transcription configuration
 * @returns {Promise<object>} The transcription configuration
 */
async function getTranscriptionConfig() {
  const fallbackConfig = {
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

  const validateConfig = (config) => {
    return config && 
           config.MODELS && 
           config.DEFAULT_MODEL && 
           config.RESPONSE_FORMATS;
  };

  return loadConfig(
    '../../../../backend/src/config/transcription.js',
    fallbackConfig,
    validateConfig
  );
}

module.exports = {
  loadConfig,
  clearConfigCache,
  getTranscriptionConfig
};
