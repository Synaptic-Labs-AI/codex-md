/**
 * Conversion Handler
 * 
 * Manages the core conversion process for both single items and batches.
 * Coordinates between different conversion types and handles the conversion flow.
 * 
 * Related files:
 * - frontend/src/lib/api/electron/client.js
 * - frontend/src/lib/utils/conversion/manager/storeManager.js
 * - frontend/src/lib/utils/conversion/handlers/batchHandler.js
 * - frontend/src/lib/utils/conversion/handlers/tempFileManager.js
 */

import { get } from 'svelte/store';
import { files } from '$lib/stores/files.js';
import { apiKey } from '$lib/stores/apiKey.js';
import { unifiedConversion, ConversionState } from '$lib/stores/unifiedConversion.js';
import electronClient from '$lib/api/electron';
import { storeManager } from '../manager/storeManager.js';
import { batchHandler } from './batchHandler.js';
import { tempFileManager } from './tempFileManager.js';
import { CONVERSION_STATUSES, FILE_TYPES } from '../constants';

// Map old Phase constants to new ConversionState constants for backward compatibility
const Phase = {
  PREPARE: ConversionState.STATUS.PREPARING,
  CONVERTING: ConversionState.STATUS.CONVERTING,
  COMPLETE: ConversionState.STATUS.COMPLETED
};

class ConversionHandler {
    /**
     * Starts the conversion process
     */
    async startConversion() {
        const currentFiles = get(files);
        const currentApiKey = get(apiKey);

        if (currentFiles.length === 0) {
            const error = new Error('No files available for conversion.');
            storeManager.setError(error.message);
            console.error(error);
            return;
        }

        storeManager.updateConversionStatus(CONVERSION_STATUSES.INITIALIZING, 0);
        
        // Add a small delay to show the initializing message
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
            // Prepare items for conversion
            const items = await batchHandler.prepareItems(currentFiles);
            const itemCount = items.length;
            
            // Handle website conversion initialization
            const isWebsiteConversion = items[0]?.type === FILE_TYPES.PARENT;
            if (isWebsiteConversion) {
                unifiedConversion.reset();
                unifiedConversion.batchUpdate({
                    type: ConversionState.TYPE.WEBSITE,
                    status: Phase.PREPARE,
                    message: 'Preparing website conversion...'
                });
            }

            // Start conversion and set total count
            storeManager.updateConversionStatus(CONVERSION_STATUSES.INITIALIZING, 0);
            
            // Handle conversion
            await this.handleElectronConversion(items, currentApiKey);

            // Update status
            storeManager.updateConversionStatus(CONVERSION_STATUSES.PROCESSING, 50);
            this.showFeedback('✨ Processing started! You will be notified when the conversion is complete.', 'success');
            
            // Add error handling for worker communication errors
            window.addEventListener('error', (event) => {
                // Check if this is the worker communication error
                if (event.message && event.message.includes('Cannot destructure property')) {
                    console.warn('Caught worker communication error:', event.message);
                    // Don't let this error affect the UI state
                    event.preventDefault();
                    event.stopPropagation();
                }
            }, true);

        } catch (error) {
            console.error('Conversion error:', error);

            const errorMessage = error.message || 'An unexpected error occurred during conversion';
            storeManager.setError(errorMessage);

            // Handle top-level website error state
            const currentFiles = get(files);
            if (currentFiles && currentFiles[0]?.type === FILE_TYPES.PARENT) {
                unifiedConversion.batchUpdate({
                    status: Phase.COMPLETE,
                    message: `Error: ${errorMessage}`
                });
            }

            this.showFeedback(errorMessage, 'error');
        }
    }

    /**
     * Handles conversion in Electron environment
     * @private
     */
    async handleElectronConversion(items, apiKey) {
        try {
            // First prompt for output directory
            storeManager.updateConversionStatus(CONVERSION_STATUSES.SELECTING_OUTPUT, 0);
            const outputResult = await electronClient.selectOutputDirectory();
            
            if (!outputResult.success) {
                // User cancelled directory selection
                storeManager.updateConversionStatus(CONVERSION_STATUSES.CANCELLED, 0);
                
                // Update website progress if needed
                if (items[0]?.type === FILE_TYPES.PARENT) {
                    unifiedConversion.batchUpdate({
                        status: Phase.COMPLETE,
                        message: 'Website conversion cancelled'
                    });
                }
                
                this.showFeedback('Conversion cancelled: No output directory selected', 'info');
                return;
            }

            // Update website progress if needed
            if (items[0]?.type === FILE_TYPES.PARENT && outputResult.path) {
                unifiedConversion.batchUpdate({
                    status: Phase.CONVERTING,
                    message: 'Starting website conversion...'
                });
            }
            
            // Get current OCR settings
            const ocrEnabled = await window.electronAPI.getSetting('ocr.enabled');

            // Create options object with outputDir, OCR settings, and API key
            const options = {
                outputDir: outputResult.path,
                createSubdirectory: false, // Save directly to the selected directory
                ...(apiKey ? { apiKey } : {}),
                useOcr: ocrEnabled,
                mistralApiKey: apiKey, // Use same API key for Mistral if OCR is enabled
            };
            
            console.log('Conversion options:', {
                outputDir: outputResult.path,
                createSubdirectory: false,
                hasApiKey: !!apiKey,
                useOcr: ocrEnabled,
                hasMistralKey: !!options.mistralApiKey
            });
            
            // For single file conversion
            if (items.length === 1) {
                await this.handleSingleItemConversion(items[0], options);
            } 
            // For batch conversion
            else if (batchHandler.canBatchItems(items)) {
                await batchHandler.processBatch(items, options, (progress) => {
                    storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, progress);
                });
            }
            // For mixed items that can't be batched
            else {
                throw new Error('Mixed item types cannot be converted together');
            }
        } catch (error) {
            console.error('Electron conversion error:', error);
            storeManager.setError(error.message);

            // Handle website error state
            if (items[0]?.type === FILE_TYPES.PARENT) {
                unifiedConversion.batchUpdate({
                    status: Phase.COMPLETE,
                    message: `Error: ${error.message}`
                });
            }

            throw error;
        }
    }

    /**
     * Handles conversion of a single item
     * @private
     */
    async handleSingleItemConversion(item, options) {
        // Set current file in status
        storeManager.updateCurrentFile(item.name || item.url || 'File');
        storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, 0);
        
        // Handle different item types
        let result;
        
        try {
            if (item.isNative && item.path) {
                // Convert native file path with output directory
                result = await electronClient.convertFile(item.path, {
                    ...item.options,
                    ...options
                }, (progress) => {
                    storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, progress);
                });
            } else if (item.type === FILE_TYPES.URL) {
                // Convert URL with output directory
                result = await electronClient.convertUrl(item.url, {
                    ...item.options,
                    ...options
                }, (progress) => {
                    storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, progress);
                });
            } else if (item.type === FILE_TYPES.PARENT) {
                // Convert parent URL (website) with output directory
                result = await electronClient.convertParentUrl(item.url, {
                    ...item.options,
                    ...options
                }, (progress) => {
                    storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, progress);
                    if (progress === 100) {
                        unifiedConversion.batchUpdate({
                            status: Phase.COMPLETE,
                            message: 'Website conversion complete!'
                        });
                    }
                });
            } else if (item.type === FILE_TYPES.YOUTUBE) {
                // Convert YouTube URL with output directory
                result = await electronClient.convertYoutube(item.url, {
                    ...item.options,
                    ...options
                }, (progress) => {
                    storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, progress);
                });
            } else if (item.file instanceof File) {
                // Convert File object by saving to a temporary file first
                storeManager.updateConversionStatus(CONVERSION_STATUSES.PREPARING, 10);
                
                // Save the file to a temporary location
                const tempFilePath = await tempFileManager.saveTempFile(item.file, (progress) => {
                    // Update chunk progress
                    unifiedConversion.batchUpdate({
                        chunkProgress: progress
                    });
                });
                
                try {
                    // Convert the temporary file
                    result = await electronClient.convertFile(tempFilePath, {
                        ...item.options,
                        ...options,
                        isTemporary: true // Flag to indicate this is a temporary file
                    }, (progress) => {
                        // Scale progress from 20-90% to account for temp file operations
                        storeManager.updateConversionStatus(
                            CONVERSION_STATUSES.CONVERTING, 
                            20 + (progress * 0.7)
                        );
                    });
                    
                    storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, 90);
                } finally {
                    // Mark the file as ready for cleanup
                    tempFileManager.markForCleanup(tempFilePath);
                    
                    // Add a small delay to ensure the worker process is done with the file
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Clean up the temporary file regardless of success/failure
                    await tempFileManager.cleanup(tempFilePath, { force: true });
                    storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, 95);
                }
            } else {
                throw new Error(`Unsupported item type: ${item.type || 'unknown'}`);
            }
            
            // Update status and store result
            if (result && result.outputPath) {
                storeManager.updateConversionStatus(CONVERSION_STATUSES.COMPLETED, 100);
                
                // Store the result
                storeManager.setConversionResult(result, [item]);
                
                // Update file status
                storeManager.updateFileStatus(item.id, CONVERSION_STATUSES.COMPLETED, result.outputPath);
                
                return result;
            } else {
                throw new Error('Conversion failed: No output path returned');
            }
        } catch (error) {
            console.error(`Error converting ${item.name || item.url}:`, error);
            storeManager.setError(error.message);
            storeManager.updateFileStatus(item.id, CONVERSION_STATUSES.ERROR);
            throw error;
        }
    }

    // Web environment method removed - Electron-only app

    /**
     * Cancels the ongoing conversion process
     */
    cancelConversion() {
        electronClient.cancelRequests();
        storeManager.cancelConversion();
        this.showFeedback('Conversion cancelled by user', 'info');
    }

    /**
     * Shows feedback message
     * @private
     */
    showFeedback(message, type = 'info') {
        console.log(`${type.toUpperCase()}: ${message}`);
        // In a real implementation, this would show a toast or notification
    }
}

// Export singleton instance
export const conversionHandler = new ConversionHandler();
