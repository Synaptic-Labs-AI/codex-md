/**
 * Store Manager
 * 
 * Centralizes all store updates for conversion-related state.
 * Acts as a facade for store interactions, providing a single point of access
 * for updating conversion status, results, and progress.
 * 
 * Related files:
 * - frontend/src/lib/stores/unifiedConversion.js
 * - frontend/src/lib/stores/conversionResult.js
 * - frontend/src/lib/stores/files.js
 */

import { get } from 'svelte/store';
import { unifiedConversion, ConversionState } from '$lib/stores/unifiedConversion.js';
import { conversionResult } from '$lib/stores/conversionResult.js';
import { files } from '$lib/stores/files.js';
import { CONVERSION_STATUSES, FILE_TYPES } from '../constants';

// Map old status constants to new ones for backward compatibility
const statusMap = {
  [CONVERSION_STATUSES.IDLE]: ConversionState.STATUS.IDLE,
  [CONVERSION_STATUSES.INITIALIZING]: ConversionState.STATUS.INITIALIZING,
  [CONVERSION_STATUSES.PREPARING]: ConversionState.STATUS.PREPARING,
  [CONVERSION_STATUSES.SELECTING_OUTPUT]: ConversionState.STATUS.PREPARING,
  [CONVERSION_STATUSES.CONVERTING]: ConversionState.STATUS.CONVERTING,
  [CONVERSION_STATUSES.PROCESSING]: ConversionState.STATUS.CONVERTING,
  [CONVERSION_STATUSES.COMPLETED]: ConversionState.STATUS.COMPLETED,
  [CONVERSION_STATUSES.ERROR]: ConversionState.STATUS.ERROR,
  [CONVERSION_STATUSES.CANCELLED]: ConversionState.STATUS.CANCELLED
};

// Map old phase constants to new status constants
const phaseMap = {
  'prepare': ConversionState.STATUS.PREPARING,
  'converting': ConversionState.STATUS.CONVERTING,
  'complete': ConversionState.STATUS.COMPLETED
};

/**
 * Manages all store updates related to conversion process
 */
class StoreManager {
    /**
     * Updates the conversion status and progress
     */
    updateConversionStatus(status, progress) {
        if (!Object.values(CONVERSION_STATUSES).includes(status)) {
            console.warn(`Invalid conversion status: ${status}`);
            return;
        }

        // Map old status to new status
        const newStatus = statusMap[status] || status;
        unifiedConversion.setStatus(newStatus);
        
        if (typeof progress === 'number') {
            unifiedConversion.setProgress(progress);
        }
    }

    /**
     * Updates the current file being processed
     */
    updateCurrentFile(filename) {
        if (!filename) {
            console.warn('No filename provided for current file update');
            return;
        }
        unifiedConversion.setCurrentFile(filename);
    }

    /**
     * Sets an error state
     */
    setError(error) {
        const errorMessage = error?.message || error || 'An unknown error occurred';
        unifiedConversion.setError(errorMessage);
        console.error('[StoreManager] Error:', errorMessage);
    }

    /**
     * Updates website conversion progress
     */
    updateWebsiteProgress(phase, message) {
        // Map old phase to new status
        const status = phaseMap[phase] || phase;
        
        if (!status) {
            console.warn(`Invalid website conversion phase: ${phase}`);
            return;
        }
        
        unifiedConversion.setStatus(status);
        
        // If there's additional data, update it
        if (message) {
            unifiedConversion.batchUpdate({ message });
        }
    }

    /**
     * Updates a specific file's status
     */
    updateFileStatus(fileId, status, outputPath = null) {
        if (!fileId) {
            console.warn('No fileId provided for status update');
            return;
        }

        const currentFiles = get(files);
        const fileExists = currentFiles.some(f => f.id === fileId);
        
        if (!fileExists) {
            console.warn(`File with id ${fileId} not found`);
            return;
        }

        files.updateFile(fileId, {
            status,
            ...(outputPath ? { outputPath } : {})
        });
    }

    /**
     * Sets the conversion result
     */
    setConversionResult(result, items, options = {}) {
        if (!result) {
            console.warn('No result provided to setConversionResult');
            return;
        }

        if (result.outputPath) {
            conversionResult.setNativeResult(result.outputPath, items, options);
        } else if (result.blob) {
            conversionResult.setWebResult(result.blob, items, options);
        } else {
            console.warn('Invalid result format - missing outputPath or blob');
        }
    }

    /**
     * Updates batch conversion progress
     */
    updateBatchProgress(current, total) {
        if (typeof current !== 'number' || typeof total !== 'number') {
            console.warn('Invalid batch progress values');
            return;
        }

        const progress = Math.min(Math.round((current / total) * 100), 100);
        this.updateConversionStatus(CONVERSION_STATUSES.CONVERTING, progress);
    }

    /**
     * Handles conversion completion
     */
    completeConversion() {
        unifiedConversion.completeConversion();
    }

    /**
     * Cancels the ongoing conversion
     */
    cancelConversion() {
        unifiedConversion.setStatus(ConversionState.STATUS.CANCELLED);
        unifiedConversion.setProgress(0);
        
        const currentFiles = get(files);
        currentFiles.forEach(file => {
            if (file.status === CONVERSION_STATUSES.CONVERTING) {
                this.updateFileStatus(file.id, CONVERSION_STATUSES.CANCELLED);
            }
        });

        // Update website progress if it's a website conversion
        const firstFile = currentFiles[0];
        if (firstFile?.type === FILE_TYPES.PARENT) {
            unifiedConversion.setStatus(ConversionState.STATUS.CANCELLED);
            unifiedConversion.batchUpdate({ message: 'Website conversion cancelled' });
        }
    }

    /**
     * Resets all conversion-related stores
     */
    resetStores() {
        unifiedConversion.reset();
        files.clearFiles().catch(error => {
            console.warn('Failed to clear files store:', error);
        });
    }

    /**
     * Gets whether there are any files in processing state
     */
    hasProcessingFiles() {
        const currentFiles = get(files);
        return currentFiles.some(file => 
            file.status === CONVERSION_STATUSES.CONVERTING || 
            file.status === CONVERSION_STATUSES.PROCESSING
        );
    }
}

// Export a singleton instance
export const storeManager = new StoreManager();
