/**
 * transcriptionConfigAdapter.js
 * 
 * This adapter provides a CommonJS wrapper around the transcription config.
 * It allows the Electron code (which uses CommonJS) to import the backend code
 * (which uses ES modules) without compatibility issues.
 * 
 * Related files:
 * - backend/src/config/transcription.js: The original module
 * - src/electron/config/transcription.js: The local config
 * - src/electron/services/TranscriptionService.js: The consumer of this adapter
 */

// Import the local transcription config
const transcriptionConfig = require('../config/transcription.js');

// Export the config
module.exports = transcriptionConfig;
