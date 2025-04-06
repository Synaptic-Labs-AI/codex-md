/**
 * Electron Client
 * Handles communication with the Electron main process.
 * 
 * This client provides a wrapper around the Electron IPC API exposed through the preload script.
 * It ensures consistent error handling and provides a more convenient API for the renderer process.
 * 
 * Related files:
 * - src/electron/preload.js: Exposes the Electron API to the renderer
 * - src/electron/ipc/handlers/: Implements the IPC handlers in the main process
 */
import { ConversionError } from '@codex-md/shared/utils/conversion/errors';

export { ConversionError };

class ElectronClient {
    /**
     * Convert a file to markdown format
     * @param {string|ArrayBuffer} input - File path or buffer content
     * @param {Object} options - Conversion options
     * @param {Function} onProgress - Progress callback
     */
    async convertFile(input, options, onProgress) {
        if (!window.electron) {
            throw new Error('Electron API not available');
        }

        // Handle progress updates
        if (onProgress) {
            window.electron.onConversionProgress((progress) => {
                onProgress(progress);
            });
        }

        try {
            // For audio/video buffers
            if (input instanceof ArrayBuffer && options.isTemporary) {
                // Infer type from file extension for audio/video files
                const type = options.originalFileName 
                    ? (/\.(mp3|wav|m4a|ogg)$/i.test(options.originalFileName) ? 'audio' : 'video')
                    : 'audio';
                
                const conversionOptions = {
                    ...options,
                    buffer: input, // Pass buffer directly
                    type: type // Explicitly set type for audio/video handling
                };
                return await window.electron.convert(input, conversionOptions);
            }

            // For text content
            if (typeof input === 'string' && options.originalFileName) {
                const conversionOptions = {
                    ...options,
                    content: input
                };
                return await window.electron.convert(input, conversionOptions);
            }

            // For file paths
            return await window.electron.convert(input, options);
        } catch (error) {
            console.error('Conversion error:', error);
            throw error;
        }
    }

    /**
     * Select output directory for conversion results
     */
    async selectOutputDirectory() {
        if (!window.electron) {
            throw new Error('Electron API not available');
        }

        return await window.electron.selectDirectory();
    }

    /**
     * Cancel ongoing conversion requests
     */
    async cancelRequests() {
        if (!window.electron) {
            throw new Error('Electron API not available');
        }

        await window.electron.cancelRequests();
    }
    
    /**
     * Get offline status
     * @returns {Promise<{online: boolean, apiStatus: Object}>}
     */
    async getOfflineStatus() {
        if (!window.electron) {
            throw new Error('Electron API not available');
        }
        
        return await window.electron.getOfflineStatus();
    }
    
    /**
     * Get queued operations
     * @returns {Promise<Array>}
     */
    async getQueuedOperations() {
        if (!window.electron) {
            throw new Error('Electron API not available');
        }
        
        return await window.electron.getQueuedOperations();
    }
    
    /**
     * Clear cache
     * @returns {Promise<{success: boolean}>}
     */
    async clearCache() {
        if (!window.electron) {
            throw new Error('Electron API not available');
        }
        
        return await window.electron.clearCache();
    }
    
    /**
     * Register callback for offline events
     * @param {Function} callback - Callback function
     * @returns {Function} Cleanup function
     */
    onOfflineEvent(callback) {
        if (!window.electron) {
            throw new Error('Electron API not available');
        }
        
        return window.electron.onOfflineEvent(callback);
    }
    
    /**
     * Get a setting value
     * @param {string} key - Setting key
     * @returns {Promise<any>}
     */
    async getSetting(key) {
        if (!window.electron) {
            throw new Error('Electron API not available');
        }
        
        return await window.electron.getSetting(key);
    }
    
    /**
     * Set a setting value
     * @param {string} key - Setting key
     * @param {any} value - Setting value
     * @returns {Promise<{success: boolean}>}
     */
    async setSetting(key, value) {
        if (!window.electron) {
            throw new Error('Electron API not available');
        }
        
        return await window.electron.setSetting(key, value);
    }
}

// Export singleton instance
export default new ElectronClient();
