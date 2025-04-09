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
import { getFileHandlingInfo } from '@codex-md/shared/utils/files/types';

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
            // Get comprehensive file handling info
            const fileInfo = getFileHandlingInfo({
                name: options.originalFileName,
                type: options.type,
                path: typeof input === 'string' ? input : undefined
            });

            console.log('🔍 File handling info:', fileInfo);

            // Prepare conversion options with file info
            const conversionOptions = {
                ...options,
                isBinary: fileInfo.isBinary
            };
            
            // For non-web files, use the converter type from fileInfo
            // For web files (url/parenturl), preserve the original type
            if (!fileInfo.isWeb) {
                conversionOptions.type = fileInfo.converter;
            }

            // Special handling for CSV files - set isContent flag to trigger special handling in the backend
            if (fileInfo.converter === 'csv' ||
                (options.originalFileName && options.originalFileName.toLowerCase().endsWith('.csv'))) {
                console.log('📊 Detected CSV file, setting isContent flag to trigger special handling');
                conversionOptions.isContent = true;
                conversionOptions.type = 'csv';
            }

            // Handle based on input type
            if (input instanceof File) {
                // For all File objects, extract the buffer
                const arrayBuffer = await input.arrayBuffer();
                
                if (fileInfo.converter === 'pdf' && options.useOcr) {
                    // For PDFs with OCR enabled, include additional metadata
                    console.log(`Converting PDF with OCR: ${fileInfo.fileName}`);
                    conversionOptions.buffer = arrayBuffer;
                    conversionOptions.originalFileName = input.name;
                    conversionOptions.mimeType = input.type;
                    conversionOptions.size = input.size;
                    conversionOptions.useOcr = true;
                } else {
                    // For all other files, just pass the buffer
                    conversionOptions.buffer = arrayBuffer;
                }
                
                // Use a string placeholder for the input to avoid cloning issues
                input = 'buffer-in-options';
            } else if (input instanceof ArrayBuffer && options.isTemporary) {
                // Binary buffer handling
                console.log(`Converting binary file as ${fileInfo.converter}: ${fileInfo.fileName}`);
                conversionOptions.buffer = input;
            } else if (typeof input === 'string' && fileInfo.isWeb) {
            // URL handling
            console.log(`Converting URL: ${input} with type: ${options.type} (${fileInfo.isWeb ? 'web' : 'non-web'})`);
            conversionOptions.content = input;
            } else if (typeof input === 'string' && options.originalFileName) {
                // Text content handling
                console.log(`Converting text content from: ${fileInfo.fileName}`);
                conversionOptions.content = input;
            }

            // Log final conversion options for debugging
            console.log('🚀 Sending conversion request with options:', {
                type: conversionOptions.type,
                isWeb: fileInfo.isWeb,
                originalType: options.type,
                finalType: conversionOptions.type
            });
            
            return await window.electron.convert(input, conversionOptions);
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
    
    /**
     * Register a callback for file drop events
     * @param {Function} callback - Callback function to handle dropped files
     * @returns {Function} Cleanup function
     */
    onFileDropped(callback) {
        if (!window.electron) {
            throw new Error('Electron API not available');
        }
        
        return window.electron.onFileDropped(callback);
    }
}

// Export singleton instance
export default new ElectronClient();
