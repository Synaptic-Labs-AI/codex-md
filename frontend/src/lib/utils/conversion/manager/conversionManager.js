/**
 * Conversion Manager
 * 
 * Main orchestrator for the file conversion process.
 * Coordinates between different handlers and provides a simplified API
 * for components to interact with the conversion system.
 * 
 * This is the primary entry point for conversion operations and replaces
 * the original monolithic conversionManager.js.
 * 
 * Related files:
 * - frontend/src/lib/utils/conversion/manager/storeManager.js
 * - frontend/src/lib/utils/conversion/handlers/conversionHandler.js
 * - frontend/src/lib/utils/conversion/handlers/downloadHandler.js
 * - frontend/src/lib/utils/conversion/handlers/tempFileManager.js
 */

import { storeManager } from './storeManager.js';
import { conversionHandler } from '../handlers/conversionHandler.js';
import { downloadHandler } from '../handlers/downloadHandler.js';
import { tempFileManager } from '../handlers/tempFileManager.js';

/**
 * Main conversion manager class that orchestrates the conversion process
 */
class ConversionManager {
    /**
     * Starts the conversion process
     * This is the main entry point for conversion operations
     */
    async startConversion() {
        try {
            await conversionHandler.startConversion();
        } catch (error) {
            console.error('Error in conversion process:', error);
            storeManager.setError(error.message || 'An unexpected error occurred');
        }
    }

    /**
     * Cancels the ongoing conversion process
     */
    cancelConversion() {
        try {
            conversionHandler.cancelConversion();
        } catch (error) {
            console.error('Error cancelling conversion:', error);
        }
    }

    /**
     * Clears files after conversion is complete
     */
    clearFiles() {
        try {
            downloadHandler.clearFiles();
        } catch (error) {
            console.error('Error clearing files:', error);
        }
    }

    /**
     * Opens a file in the default application
     */
    openFile(filePath) {
        try {
            downloadHandler.openFile(filePath);
        } catch (error) {
            console.error('Error opening file:', error);
        }
    }

    /**
     * Shows the file in the file explorer
     */
    showInFolder(filePath) {
        try {
            downloadHandler.showInFolder(filePath);
        } catch (error) {
            console.error('Error showing file in folder:', error);
        }
    }

    /**
     * Cleans up temporary files
     */
    cleanupTempFiles() {
        // This could be called during app shutdown or when switching views
        // to ensure no temporary files are left behind
    }
}

// Create and export a singleton instance
const conversionManager = new ConversionManager();

// Export the main methods for backward compatibility with the original API
export const {
    startConversion,
    cancelConversion,
    clearFiles,
    openFile,
    showInFolder
} = conversionManager;

// Export the manager instance for advanced usage
export default conversionManager;
