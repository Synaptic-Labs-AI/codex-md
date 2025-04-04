/**
 * Store Manager
 * 
 * Centralizes all store updates for conversion-related state.
 * Acts as a facade for store interactions, providing a single point of access
 * for updating conversion status, results, and progress.
 * 
 * Related files:
 * - frontend/src/lib/stores/conversionStatus.js
 * - frontend/src/lib/stores/conversionResult.js
 * - frontend/src/lib/stores/websiteProgressStore.js
 * - frontend/src/lib/stores/files.js
 */

import { get } from 'svelte/store';
import { conversionStatus } from '$lib/stores/conversionStatus.js';
import { conversionResult } from '$lib/stores/conversionResult.js';
import { websiteProgress, Phase } from '$lib/stores/websiteProgressStore.js';
import { files } from '$lib/stores/files.js';
import { CONVERSION_STATUSES } from '../constants';

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

        conversionStatus.setStatus(status);
        if (typeof progress === 'number') {
            conversionStatus.setProgress(progress);
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
        conversionStatus.setCurrentFile(filename);
    }

    /**
     * Sets an error state
     */
    setError(error) {
        const errorMessage = error?.message || error || 'An unknown error occurred';
        conversionStatus.setError(errorMessage);
        conversionStatus.setStatus(CONVERSION_STATUSES.ERROR);
        console.error('[StoreManager] Error:', errorMessage);
    }

    /**
     * Updates website conversion progress
     */
    updateWebsiteProgress(phase, message) {
        if (!Object.values(Phase).includes(phase)) {
            console.warn(`Invalid website conversion phase: ${phase}`);
            return;
        }
        websiteProgress.setPhase(phase, message);
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
        this.updateConversionStatus(CONVERSION_STATUSES.COMPLETED, 100);
    }

    /**
     * Cancels the ongoing conversion
     */
    cancelConversion() {
        this.updateConversionStatus(CONVERSION_STATUSES.CANCELLED, 0);
        
        const currentFiles = get(files);
        currentFiles.forEach(file => {
            if (file.status === CONVERSION_STATUSES.CONVERTING) {
                this.updateFileStatus(file.id, CONVERSION_STATUSES.CANCELLED);
            }
        });

        // Update website progress if it's a website conversion
        const firstFile = currentFiles[0];
        if (firstFile?.type === FILE_TYPES.PARENT) {
            this.updateWebsiteProgress(Phase.COMPLETE, 'Website conversion cancelled');
        }
    }

    /**
     * Resets all conversion-related stores
     */
    resetStores() {
        conversionStatus.reset();
        websiteProgress.reset();
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
