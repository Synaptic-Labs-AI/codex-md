/**
 * Conversion Handler
 * 
 * Manages the core conversion process for single file conversion.
 * Uses direct buffer handling for audio/video files to avoid temp files.
 */

import { get } from 'svelte/store';
import { files } from '@lib/stores/files.js';
import apiKeyStore, { apiKey } from '@lib/stores/apiKey.js';
import { unifiedConversion, ConversionState } from '@lib/stores/unifiedConversion.js';
import electronClient from '@lib/api/electron';
import { storeManager } from '../manager/storeManager.js';
import { CONVERSION_STATUSES, FILE_TYPES } from '../constants';
import { getFileHandlingInfo } from '@codex-md/shared/utils/files';

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

        // Reset and start the unified conversion timer
        unifiedConversion.reset();
        unifiedConversion.startTimer();
        
        storeManager.updateConversionStatus(CONVERSION_STATUSES.INITIALIZING, 0);
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
            storeManager.updateConversionStatus(CONVERSION_STATUSES.INITIALIZING, 0);
            await this.handleElectronConversion(currentFiles[0], currentApiKey);

            storeManager.updateConversionStatus(CONVERSION_STATUSES.PROCESSING, 50);
            this.showFeedback('✨ Processing started! You will be notified when the conversion is complete.', 'success');
            
        } catch (error) {
            console.error('Conversion error:', error);
            
            // Check for API key related errors
            const errorMessage = error.message || '';
            if (errorMessage.includes('Unauthorized') || 
                errorMessage.includes('401') || 
                errorMessage.includes('API key')) {
                
                // Provide a more user-friendly error message for API key issues
                const friendlyError = 'OCR conversion failed: Invalid or missing Mistral API key. Please check your API key in Settings.';
                storeManager.setError(friendlyError);
                this.showFeedback(friendlyError, 'error');
            } else {
                // Use the original error message
                storeManager.setError(errorMessage || 'An unexpected error occurred during conversion');
                this.showFeedback(errorMessage, 'error');
            }
        }
    }

    /**
     * Handles conversion in Electron environment
     * @private
     */
    async handleElectronConversion(item, openaiApiKey) {
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
            
            // Get Mistral API key from store
            const apiKeyState = get(apiKeyStore);
            const mistralApiKey = apiKeyState.keys.mistral || '';
            
            console.log(`Using API keys - OpenAI: ${openaiApiKey ? '✓ (set)' : '✗ (not set)'}, Mistral: ${mistralApiKey ? '✓ (set)' : '✗ (not set)'}`);
            
            // Create options object with separate keys for each service
            const options = {
                outputDir: outputResult.path,
                createSubdirectory: false,
                ...(openaiApiKey ? { apiKey: openaiApiKey } : {}), // OpenAI key for general use
                useOcr: ocrEnabled,
                mistralApiKey: mistralApiKey // Dedicated Mistral key for OCR
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
            // Get file handling info from centralized system
            const fileInfo = getFileHandlingInfo(item.file || item);
            
            // Prepare base conversion options
            const baseOptions = {
                ...options,
                isTemporary: fileInfo.isBinary,
                originalFileName: fileInfo.fileName
            };

            // For URLs, preserve original type and options
            const conversionOptions = fileInfo.isWeb
                ? {
                    ...baseOptions,
                    type: item.type, // Preserve original type (url/parenturl)
                    ...item.options, // Include any URL-specific options
                    // Ensure parent URL specific options are preserved
                    ...(item.type === 'parenturl' && {
                        maxDepth: item.options?.maxDepth || 3,
                        maxPages: item.options?.maxPages || 100,
                        includeImages: item.options?.includeImages ?? true,
                        includeMeta: item.options?.includeMeta ?? true
                    })
                  }
                : {
                    ...baseOptions,
                    type: fileInfo.converter
                  };

            // Log extended debug info for URL conversions
            if (fileInfo.isWeb) {
                console.log('🌐 Web conversion details:', {
                    originalType: item.type,
                    originalOptions: item.options,
                    finalType: conversionOptions.type,
                    isParentUrl: item.type === 'parenturl',
                    finalOptions: conversionOptions
                });
            }

            if (item.isNative && item.path) {
                // Native file path - use unified file converter
                result = await electronClient.convertFile(
                    item.path,
                    conversionOptions,
                    progress => {
                        storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, progress);
                    }
                );
            } else if (item.file instanceof File) {
                // Browser File object
                let content;
                
                if (fileInfo.isBinary) {
                    // For binary files (audio/video/pdf/office/etc), read as buffer
                    content = await item.file.arrayBuffer();
                } else if (fileInfo.converter === 'data' && fileInfo.fileType === 'csv') {
                    // Special case for CSV files - handle as text
                    content = await item.file.text();
                    conversionOptions.isContent = true;
                    conversionOptions.content = content;
                } else {
                    // For text files, read as text
                    content = await item.file.text();
                }
                
                result = await electronClient.convertFile(
                    content,
                    conversionOptions,
                    progress => {
                        storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, progress);
                    }
                );
            } else if (fileInfo.isWeb && item.url) {
                // For URLs, pass the URL string directly with the correct type
                // For URLs, pass options directly without modification
                result = await electronClient.convertFile(
                    item.url,
                    conversionOptions,
                    progress => {
                        storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, progress);
                    }
                );

                // Log the conversion options for debugging
                console.log('🔄 URL conversion options:', {
                    type: conversionOptions.type,
                    isParentUrl: conversionOptions.type === 'parenturl',
                    options: conversionOptions
                });
            } else {
                throw new Error(`Unsupported item type: ${item.type || 'unknown'}`);
            }
            
            // Validate the conversion result
            if (!result) {
                console.error('❌ [conversionHandler] No result returned from conversion');
                throw new Error('Conversion failed: No result returned');
            }
            
            // Log the result structure for debugging
            console.log(`🔍 [conversionHandler] Conversion result structure:`, {
                success: result.success,
                hasOutputPath: !!result.outputPath,
                hasContent: !!result.content,
                hasError: !!result.error,
                type: result.type,
                fileType: fileInfo.fileType,
                category: fileInfo.category,
                handlingType: fileInfo.handling
            });
            
            // Check for success flag
            if (result.success === false) {
                console.error('❌ [conversionHandler] Conversion failed with error:', result.error);
                throw new Error(`Conversion failed: ${result.error || 'Unknown error'}`);
            }
            
            // Check for output path specifically
            if (!result.outputPath) {
                console.error('❌ [conversionHandler] Result missing outputPath:', result);
                throw new Error('Conversion failed: No output path returned');
            }
            
            // Success path
            storeManager.updateConversionStatus(CONVERSION_STATUSES.COMPLETED, 100);
            storeManager.setConversionResult(result, [item]);
            storeManager.updateFileStatus(item.id, CONVERSION_STATUSES.COMPLETED, result.outputPath);
            return result;
        } catch (error) {
            console.error(`Error converting ${item.name || item.url}:`, error);
            
            // Check for API key related errors
            const errorMessage = error.message || '';
            if (errorMessage.includes('Unauthorized') || 
                errorMessage.includes('401') || 
                errorMessage.includes('API key')) {
                
                // Provide a more user-friendly error message for API key issues
                const friendlyError = 'OCR conversion failed: Invalid or missing Mistral API key. Please check your API key in Settings.';
                storeManager.setError(friendlyError);
                storeManager.updateFileStatus(item.id, CONVERSION_STATUSES.ERROR);
                throw new Error(friendlyError);
            } else {
                // Use the original error message
                storeManager.setError(errorMessage);
                storeManager.updateFileStatus(item.id, CONVERSION_STATUSES.ERROR);
                throw error;
            }
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
