/**
 * Conversion Handler
 * 
 * Manages the core conversion process for single file conversion.
 * Uses direct buffer handling for audio/video files to avoid temp files.
 */

import { get } from 'svelte/store';
import { files } from '$lib/stores/files.js';
import { apiKey } from '$lib/stores/apiKey.js';
import { unifiedConversion, ConversionState } from '$lib/stores/unifiedConversion.js';
import electronClient from '$lib/api/electron';
import { storeManager } from '../manager/storeManager.js';
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
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
            storeManager.updateConversionStatus(CONVERSION_STATUSES.INITIALIZING, 0);
            await this.handleElectronConversion(currentFiles[0], currentApiKey);

            storeManager.updateConversionStatus(CONVERSION_STATUSES.PROCESSING, 50);
            this.showFeedback('✨ Processing started! You will be notified when the conversion is complete.', 'success');
            
        } catch (error) {
            console.error('Conversion error:', error);
            storeManager.setError(error.message || 'An unexpected error occurred during conversion');
            this.showFeedback(error.message, 'error');
        }
    }

    /**
     * Handles conversion in Electron environment
     * @private
     */
    async handleElectronConversion(item, apiKey) {
        try {
            // First prompt for output directory
            storeManager.updateConversionStatus(CONVERSION_STATUSES.SELECTING_OUTPUT, 0);
            const outputResult = await electronClient.selectOutputDirectory();
            
            if (!outputResult.success) {
                storeManager.updateConversionStatus(CONVERSION_STATUSES.CANCELLED, 0);
                this.showFeedback('Conversion cancelled: No output directory selected', 'info');
                return;
            }

            // Get current OCR settings
            const ocrEnabled = await window.electron.getSetting('ocr.enabled');

            // Create options object
            const options = {
                outputDir: outputResult.path,
                createSubdirectory: false,
                ...(apiKey ? { apiKey } : {}),
                useOcr: ocrEnabled,
                mistralApiKey: apiKey
            };

            await this.handleSingleItemConversion(item, options);

        } catch (error) {
            console.error('Electron conversion error:', error);
            storeManager.setError(error.message);
            throw error;
        }
    }

    /**
     * Handles single item conversion
     * @private
     */
    async handleSingleItemConversion(item, options) {
        storeManager.updateCurrentFile(item.name || item.url || 'File');
        storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, 0);
        
        try {
            let result;
            
            if (item.isNative && item.path) {
                // Native file path - use unified file converter
                result = await electronClient.convertFile(item.path, options, (progress) => {
                    storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, progress);
                });
            } else if (item.file instanceof File) {
                // Browser File object
                const isAudioVideo = ['mp3', 'wav', 'm4a', 'ogg', 'mp4', 'avi', 'webm']
                    .includes(item.file.name.split('.').pop().toLowerCase());
                
                if (isAudioVideo) {
                    // For audio/video, read as buffer and pass directly
                    const buffer = await item.file.arrayBuffer();
                    result = await electronClient.convertFile(buffer, {
                        ...options,
                        isTemporary: true,
                        originalFileName: item.file.name
                    }, (progress) => {
                        storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, progress);
                    });
                } else {
                    // For other files, read as text
                    const text = await item.file.text();
                    result = await electronClient.convertFile(text, {
                        ...options,
                        originalFileName: item.file.name
                    }, (progress) => {
                        storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, progress);
                    });
                }
            } else {
                throw new Error(`Unsupported item type: ${item.type || 'unknown'}`);
            }
            
            if (result && result.outputPath) {
                storeManager.updateConversionStatus(CONVERSION_STATUSES.COMPLETED, 100);
                storeManager.setConversionResult(result, [item]);
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
    }
}

// Export singleton instance
export const conversionHandler = new ConversionHandler();
