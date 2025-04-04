/**
 * Batch Handler
 * 
 * Manages batch conversion operations, including preparation of items
 * and coordination of batch processing.
 * 
 * Related files:
 * - frontend/src/lib/api/electron/client.js
 * - src/electron/services/WorkerManager.js
 * - frontend/src/lib/utils/conversion/manager/storeManager.js
 * - frontend/src/lib/utils/conversion/handlers/tempFileManager.js
 */

import { get } from 'svelte/store';
import { files } from '$lib/stores/files.js';
import electronClient, { validateAndNormalizeItem } from '$lib/api/electron';
import { storeManager } from '../manager/storeManager.js';
import { tempFileManager } from './tempFileManager.js';
import { FILE_TYPES, CONVERSION_STATUSES, TEMP_FILE_CONFIG } from '../constants';

class BatchHandler {
    /**
     * Prepares items for batch conversion
     * @param {Array} items - Array of items to convert
     * @returns {Promise<Array>} - Array of prepared items
     */
    async prepareItems(items) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('No items provided for conversion');
        }
        
        return Promise.all(items.map(async item => {
            const prepared = validateAndNormalizeItem(item);
            
            // Determine if item should be included in batch based on type
            if (prepared.type === FILE_TYPES.URL || prepared.type === FILE_TYPES.PARENT) {
                // URLs and parent URLs can be batched
                prepared.shouldBatch = true;
                prepared.isUrl = true; // Flag for special handling
            } else {
                // For files and other types, use original logic
                prepared.shouldBatch = prepared.type !== FILE_TYPES.DOCUMENT;
                prepared.isUrl = false;
            }
            
            return prepared;
        }));
    }
    
    /**
     * Processes a batch of items for conversion
     * @param {Array} items - Items to convert
     * @param {Object} options - Conversion options
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Object>} - Conversion result
     */
    async processBatch(items, options, onProgress) {
        if (!items || items.length === 0) {
            throw new Error('No items provided for batch conversion');
        }
        
        storeManager.updateConversionStatus(CONVERSION_STATUSES.PREPARING, 5);
        
        // Track temporary files for cleanup
        const tempFilePaths = [];
        
        try {
            // Process each item to handle File objects and URLs
            const processedItems = await Promise.all(
                items.map(async (item, index) => {
                    // Update current file
                    storeManager.updateCurrentFile(item.file?.name || item.url || `Item ${index + 1}`);
                    
                    if (item.isUrl) {
                        // For URLs, return an object with URL info
                        return {
                            type: item.type,
                            url: item.url,
                            options: item.options,
                            id: item.id
                        };
                    }
                    // For native files, just use the path
                    else if (item.isNative && item.path) {
                        return {
                            type: 'file',
                            path: item.path,
                            options: item.options,
                            id: item.id
                        };
                    }
                    // For File objects, save to temporary file first
                    else if (item.file instanceof File) {
                        storeManager.updateCurrentFile(`Preparing ${item.file.name}...`);
                        const tempFilePath = await tempFileManager.saveTempFile(item.file, (progress) => {
                            // Update chunk progress if available
                            if (typeof conversionStatus.setChunkProgress === 'function') {
                                conversionStatus.setChunkProgress(progress);
                            }
                        });
                        
                        tempFilePaths.push({ 
                            path: tempFilePath, 
                            originalName: item.file.name 
                        });
                        
                        return {
                            type: 'file',
                            path: tempFilePath,
                            isTemporary: true,
                            options: item.options,
                            id: item.id
                        };
                    }
                    // For unsupported types
                    else {
                        throw new Error(`Unsupported item type in batch: ${item.type || 'unknown'}`);
                    }
                })
            );
            
            // Show worker initialization phase
            storeManager.updateConversionStatus(CONVERSION_STATUSES.INITIALIZING, 10);
            
            // Add a delay to show the worker initialization messages
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            storeManager.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, 15);
            
            // Convert batch with mixed content types
            const result = await electronClient.convertBatch(
                processedItems,
                { 
                    batchName: `Batch_${new Date().toISOString().replace(/:/g, '-')}`,
                    ...options
                },
                (progress) => {
                    // Scale progress from 10-90% to account for temp file operations
                    storeManager.updateConversionStatus(
                        CONVERSION_STATUSES.CONVERTING, 
                        10 + (progress * 0.8)
                    );
                    
                    if (onProgress) {
                        onProgress(progress);
                    }
                },
                (itemId, success, error) => {
                    storeManager.updateFileStatus(
                        itemId, 
                        success ? CONVERSION_STATUSES.COMPLETED : CONVERSION_STATUSES.ERROR,
                        null,
                        error?.message || null
                    );
                }
            );
            
            storeManager.updateConversionStatus(CONVERSION_STATUSES.COMPLETED, 90);
            
            // Update status and store result
            if (result && result.outputPath) {
                // Mark temporary files as ready for cleanup
                storeManager.updateConversionStatus(CONVERSION_STATUSES.PREPARING, 95);
                
                // First mark all files as ready for cleanup
                tempFilePaths.forEach(tempFile => {
                    tempFileManager.markForCleanup(tempFile.path);
                });
                
                // Then clean them up with a delay to ensure worker processes are done with them
                await new Promise(resolve => setTimeout(resolve, TEMP_FILE_CONFIG.CLEANUP_DELAY));
                
                await Promise.all(
                    tempFilePaths.map(async (tempFile) => {
                        try {
                            await tempFileManager.cleanup(tempFile.path);
                        } catch (cleanupError) {
                            console.warn(`Failed to clean up temporary file ${tempFile.path}:`, cleanupError);
                        }
                    })
                );
                
                // Ensure we set the status to completed and update the progress
                storeManager.updateConversionStatus(CONVERSION_STATUSES.COMPLETED, 100);
                
                // Store the result with batch information
                storeManager.setConversionResult(result, items, {
                    isBatch: true,
                    totalCount: items.length
                });
                
                // Update all file statuses
                items.forEach(item => {
                    storeManager.updateFileStatus(item.id, CONVERSION_STATUSES.COMPLETED, result.outputPath);
                });
                
                return result;
            } else {
                throw new Error('Batch conversion failed: No output path returned');
            }
        } catch (error) {
            console.error('Batch conversion error:', error);
            storeManager.setError(error.message);
            
            // Ensure cleanup happens even if conversion fails
            if (tempFilePaths.length > 0) {
                console.log(`Cleaning up ${tempFilePaths.length} temporary files...`);
                
                // First mark all files as ready for cleanup
                tempFilePaths.forEach(tempFile => {
                    tempFileManager.markForCleanup(tempFile.path);
                });
                
                // Then clean them up with a delay to ensure worker processes are done with them
                await new Promise(resolve => setTimeout(resolve, TEMP_FILE_CONFIG.CLEANUP_DELAY));
                
                await Promise.all(
                    tempFilePaths.map(async (tempFile) => {
                        try {
                            await tempFileManager.cleanup(tempFile.path, { force: true });
                        } catch (cleanupError) {
                            console.warn(`Failed to clean up temporary file ${tempFile.path}:`, cleanupError);
                        }
                    })
                );
            }
            
            throw error;
        }
    }
    
    /**
     * Determines if a batch of items can be processed together
     * @param {Array} items - Items to check
     * @returns {boolean} - Whether items can be batched
     */
    canBatchItems(items) {
        if (!items || items.length <= 1) {
            return false;
        }
        
        // Check if all items can be batched
        return items.every(item => item.shouldBatch !== false);
    }
}

// Export singleton instance
export const batchHandler = new BatchHandler();
