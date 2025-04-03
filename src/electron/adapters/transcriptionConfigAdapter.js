/**
 * transcriptionConfigAdapter.js
 * 
 * This adapter provides access to the transcription configuration for Electron services.
 * It uses dynamic imports to load the ES Module configuration while maintaining CommonJS
 * compatibility. The configuration is cached after first load for performance.
 * 
 * Related files:
 * - backend/src/config/transcription.mjs: The source of truth configuration
 * - src/electron/services/TranscriptionService.js: The consumer of this adapter
 */

let cachedConfig = null;

/**
 * Retrieves the transcription configuration, using cache if available
 * @returns {Promise<object>} The transcription configuration
 * @throws {Error} If the configuration fails to load
 */
async function getConfig() {
    try {
        if (!cachedConfig) {
            const config = await import('../../../backend/src/config/transcription.mjs');
            
            if (!config || !config.MODELS) {
                throw new Error('Invalid configuration format');
            }
            
            cachedConfig = {
                MODELS: config.MODELS,
                DEFAULT_MODEL: config.DEFAULT_MODEL,
                RESPONSE_FORMATS: config.RESPONSE_FORMATS
            };
        }
        
        return cachedConfig;
    } catch (error) {
        throw new Error(`Failed to load transcription configuration: ${error.message}`);
    }
}

// Export an async interface
module.exports = {
    getConfig,
    // Synchronous access to last known config (may be null)
    get currentConfig() {
        return cachedConfig;
    }
};
