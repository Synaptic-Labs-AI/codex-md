/**
 * Batch Handler
 *
 * Manages batch conversion operations, including preparation of items
 * and coordination of batch processing.
 *
 * TEMPORARILY DISABLED: Batch processing functionality has been disabled to simplify
 * the application to only handle one item at a time. The code is kept for future reference.
 *
 * Related files:
 * - frontend/src/lib/api/electron/client.js
 * - frontend/src/lib/utils/conversion/manager/storeManager.js
 */

import { get } from 'svelte/store';
import { files } from '$lib/stores/files.js';
import electronClient, { validateAndNormalizeItem, getFileCategory, isAudioType, isVideoType } from '$lib/api/electron';
import { storeManager } from '../manager/storeManager.js';
import { FILE_TYPES, CONVERSION_STATUSES } from '../constants';

class BatchHandler {
    /**
     * Prepares items for batch conversion
     * @param {Array} items - Array of items to convert
     * @returns {Promise<Array>} - Array of prepared items
     */
    async prepareItems(items) {
        // TEMPORARILY DISABLED: Batch processing functionality has been disabled
        console.warn('Batch processing is temporarily disabled');
        
        // Return only the first item if multiple are provided
        if (Array.isArray(items) && items.length > 0) {
            const item = items[0];
            const prepared = validateAndNormalizeItem(item);
            return [prepared];
        }
        
        throw new Error('No items provided for conversion');
    }
    
    /**
     * Processes a batch of items for conversion
     * @param {Array} items - Items to convert
     * @param {Object} options - Conversion options
     * @returns {Promise<Object>} - Conversion result
     */
    async processBatch(items, options) {
        // TEMPORARILY DISABLED: Batch processing functionality has been disabled
        console.warn('Batch processing is temporarily disabled - processing only the first item');
        
        // Only process the first item
        if (items && items.length > 0) {
            const item = items[0];
            console.log(`Processing only the first item: ${item.path || item.url}`);
            
            try {
                let result;
                
                // Process based on item type
                if (item.path) {
                    result = await electronClient.convertFile(item.path, options);
                } else if (item.url) {
                    if (item.type === 'parent') {
                        result = await electronClient.convertParentUrl(item.url, options);
                    } else {
                        result = await electronClient.convertUrl(item.url, options);
                    }
                } else {
                    throw new Error('Item has neither path nor URL');
                }
                
                // Return a batch-like result structure with just the one item
                return {
                    success: true,
                    results: [result],
                    outputPath: result.outputPath
                };
            } catch (error) {
                console.error('Single item conversion failed:', error);
                return {
                    success: false,
                    error: error.message,
                    results: []
                };
            }
        } else {
            throw new Error('No items provided for conversion');
        }
    }
    
    /**
     * Determines if a batch of items can be processed together
     * @param {Array} items - Items to check
     * @returns {boolean} - Whether items can be batched
     */
    canBatchItems(items) {
        // TEMPORARILY DISABLED: Always return false to force single item processing
        return false;
    }
}

// Export singleton instance
export const batchHandler = new BatchHandler();
