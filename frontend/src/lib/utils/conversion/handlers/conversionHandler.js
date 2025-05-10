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
import { getFileHandlingInfo } from '@lib/utils/files';

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
        console.log('🔄 [VERBOSE] ConversionHandler.startConversion called');
        console.time('🕒 [VERBOSE] Total conversion handler time');
        
        const currentFiles = get(files);
        const currentApiKey = get(apiKey);

        console.log('🔍 [VERBOSE] Conversion starting with:', {
            fileCount: currentFiles.length,
            hasApiKey: !!currentApiKey,
            files: currentFiles.map(f => ({
                id: f.id,
                name: f.name,
                type: f.type,
                size: f.size,
                hasUrl: !!f.url
            }))
        });

        if (currentFiles.length === 0) {
            const error = new Error('No files available for conversion.');
            storeManager.setError(error.message);
            console.error('❌ [VERBOSE] No files available for conversion');
            console.timeEnd('🕒 [VERBOSE] Total conversion handler time');
            return;
        }

        // Reset and start the unified conversion timer
        console.log('🔄 [VERBOSE] Resetting and starting unified conversion timer');
        unifiedConversion.reset();
        unifiedConversion.startTimer();
        
        storeManager.updateConversionStatus(CONVERSION_STATUSES.INITIALIZING, 0);
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
            console.log('🔄 [VERBOSE] Initializing conversion');
            storeManager.updateConversionStatus(CONVERSION_STATUSES.INITIALIZING, 0);
            
            console.log('🔄 [VERBOSE] Starting Electron conversion for file:', currentFiles[0].name);
            await this.handleElectronConversion(currentFiles[0], currentApiKey);

            console.log('✅ [VERBOSE] Electron conversion completed successfully');
            storeManager.updateConversionStatus(CONVERSION_STATUSES.PROCESSING, 50);
            this.showFeedback('✨ Processing started! You will be notified when the conversion is complete.', 'success');
            
            console.timeEnd('🕒 [VERBOSE] Total conversion handler time');
        } catch (error) {
            console.timeEnd('🕒 [VERBOSE] Total conversion handler time');
            console.error('❌ [VERBOSE] Conversion error in startConversion:', error);
            
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
        console.log('🔄 [VERBOSE] handleElectronConversion called with item:', {
            id: item.id,
            name: item.name,
            type: item.type,
            size: item.size,
            hasUrl: !!item.url,
            hasPath: !!item.path,
            hasFile: !!item.file,
            hasApiKey: !!openaiApiKey
        });
        console.time('🕒 [VERBOSE] Electron conversion time');

        try {
            // First prompt for output directory
            console.log('🔄 [VERBOSE] Prompting for output directory');
            storeManager.updateConversionStatus(CONVERSION_STATUSES.SELECTING_OUTPUT, 0);
            const outputResult = await electronClient.selectOutputDirectory();

            console.log('🔍 [VERBOSE] Output directory selection result:', {
                success: outputResult.success,
                path: outputResult.path ? outputResult.path.substring(0, 50) + '...' : 'none'
            });

            if (!outputResult.success) {
                console.log('ℹ️ [VERBOSE] Conversion cancelled: No output directory selected');
                storeManager.updateConversionStatus(CONVERSION_STATUSES.CANCELLED, 0);
                this.showFeedback('Conversion cancelled: No output directory selected', 'info');
                console.timeEnd('🕒 [VERBOSE] Electron conversion time');
                return;
            }

            // Get current OCR settings
            console.log('🔄 [VERBOSE] Getting OCR settings');
            const ocrEnabled = await window.electron.getSetting('ocr.enabled');
            console.log('🔍 [VERBOSE] OCR enabled:', ocrEnabled);

            // Get Mistral API key from store - ensure it's the most current value
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

            // Validate Mistral API key if OCR is enabled
            if (ocrEnabled && !mistralApiKey) {
                console.warn('⚠️ OCR is enabled but no Mistral API key is set');
                this.showFeedback('Warning: OCR is enabled but no Mistral API key is set. Add a Mistral API key in Settings for OCR to work.', 'warning');
            }
            
            console.log('🔍 [VERBOSE] Conversion options prepared:', {
                outputDir: options.outputDir ? options.outputDir.substring(0, 50) + '...' : 'none',
                createSubdirectory: options.createSubdirectory,
                hasApiKey: !!options.apiKey,
                useOcr: options.useOcr,
                hasMistralApiKey: !!options.mistralApiKey
            });

            console.log('🔄 [VERBOSE] Starting single item conversion');
            await this.handleSingleItemConversion(item, options);
            console.log('✅ [VERBOSE] Single item conversion completed');
            
            console.timeEnd('🕒 [VERBOSE] Electron conversion time');
        } catch (error) {
            console.timeEnd('🕒 [VERBOSE] Electron conversion time');
            console.error('❌ [VERBOSE] Electron conversion error:', error);
            console.log('🔍 [VERBOSE] Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            storeManager.setError(error.message);
            throw error;
        }
    }

    /**
     * Handles single item conversion
     * @private
     */
    async handleSingleItemConversion(item, options) {
        console.log('🔄 [VERBOSE] handleSingleItemConversion called with item:', {
            id: item.id,
            name: item.name,
            type: item.type,
            size: item.size,
            hasUrl: !!item.url,
            hasPath: !!item.path,
            hasFile: !!item.file
        });
        console.time('🕒 [VERBOSE] Single item conversion time');
        
        storeManager.updateCurrentFile(item.name || item.url || 'File');
        storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, 0);
        
        try {
            // Determine file type ONCE at the beginning
            console.log('🔍 [VERBOSE] Getting file handling info');
            const fileInfo = getFileHandlingInfo(item.file || item);
            console.log('🔍 [VERBOSE] File handling info:', fileInfo);
            
            let result;
            
            // Explicitly include fileType in conversion options
            const baseOptions = {
                ...options,
                fileType: fileInfo.fileType, // Single source of truth
                category: fileInfo.category,
                handling: fileInfo.handling,
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
                    fileType: conversionOptions.fileType, // Log the fileType we're sending
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
                    // For other binary files (audio/video/office/etc), read as buffer
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
                fileType: result.fileType,
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
            console.error(`Error converting ${item.name || item.url}:`, {
                error: error.message,
                stack: error.stack,
                item: {
                    id: item.id,
                    type: item.type,
                    name: item.name,
                    url: item.url
                }
                // No reference to fileInfo here
            });
            
            // Check for API key related errors
            const errorMessage = error.message || '';
            if (errorMessage.includes('Unauthorized') ||
                errorMessage.includes('401') ||
                errorMessage.includes('API key')) {

                // Provide a more user-friendly error message for API key issues
                const apiKeyState = get(apiKeyStore);
                const mistralKeyExists = !!apiKeyState.keys.mistral;

                let friendlyError;
                if (mistralKeyExists) {
                    friendlyError = 'OCR conversion failed: Invalid Mistral API key. Please check your API key in Settings.';
                } else {
                    friendlyError = 'OCR conversion failed: Missing Mistral API key. Please add your Mistral API key in Settings.';
                }

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
        // In a real implementation, this could show a toast notification or other UI feedback
        // For now, just log to console
    }
}

// Export singleton instance
export const conversionHandler = new ConversionHandler();
