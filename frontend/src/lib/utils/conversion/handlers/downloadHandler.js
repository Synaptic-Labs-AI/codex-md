/**
 * Download Handler
 * 
 * Manages the file operations after conversion is complete.
 * Handles opening files and showing them in the file explorer.
 * 
 * Related files:
 * - frontend/src/lib/stores/conversionResult.js
 * - frontend/src/lib/components/ResultDisplay.svelte
 */

import { get } from 'svelte/store';
import { conversionResult } from '@lib/stores/conversionResult.js';
import { files } from '@lib/stores/files.js';
import { storeManager } from '../manager/storeManager.js';

class DownloadHandler {
    /**
     * Clears the files store after conversion is complete
     */
    clearFiles() {
        storeManager.clearFiles();
    }
    
    /**
     * Opens a file in the default application
     */
    openFile(filePath) {
        if (!filePath) {
            console.error('No file path provided to open');
            return;
        }
        
        window.electron.openFile(filePath)
            .then(result => {
                if (!result.success) {
                    console.error(`Failed to open file: ${result.error}`);
                }
            })
            .catch(error => {
                console.error('Error opening file:', error);
            });
    }
    
    /**
     * Shows the file in the file explorer
     */
    showInFolder(filePath) {
        if (!filePath) {
            console.error('No file path provided to show in folder');
            return;
        }
        
        window.electron.showItemInFolder(filePath)
            .then(result => {
                if (!result.success) {
                    console.error(`Failed to show item in folder: ${result.error}`);
                }
            })
            .catch(error => {
                console.error('Error showing item in folder:', error);
            });
    }
}

// Export singleton instance
export const downloadHandler = new DownloadHandler();
