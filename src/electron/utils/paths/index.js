/**
 * Path utilities for electron
 * Provides utilities for working with file paths
 * 
 * This module contains utilities for path manipulation and resolution,
 * particularly important for handling paths consistently across platforms
 * and within the Electron environment.
 * 
 * Used by:
 * - src/electron/services/FileSystemService.js
 * - src/electron/services/StreamingFileService.js
 * - src/electron/ipc/handlers/filesystem/
 */

/**
 * Path Utilities
 * Re-exports the PathUtils class for consistent usage across the application
 * 
 * Used by:
 * - src/electron/services/FileSystemService.js
 * - src/electron/services/StreamingFileService.js
 */

const PathUtils = require('./paths');

// Re-export the PathUtils class
module.exports = {
    PathUtils
};
