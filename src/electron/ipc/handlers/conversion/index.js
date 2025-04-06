/**
 * Conversion IPC Handlers
 * Handles conversion-related IPC events between renderer and main process
 */

const { ipcMain } = require('electron');
const ElectronConversionService = require('../../../services/ElectronConversionService');
const { dialog } = require('electron');

/**
 * Register conversion IPC handlers
 */
function registerConversionHandlers() {
    // Handle file conversion requests
    ipcMain.handle('codex:convert:file', async (event, input, options) => {
        try {
            // Handle buffer input for audio/video
            if (options && options.buffer) {
                return await ElectronConversionService.convert(Buffer.from(options.buffer), {
                    ...options,
                    name: options.originalFileName
                });
            }

            // Handle text content
            if (options && options.content) {
                return await ElectronConversionService.convert(options.content, {
                    ...options,
                    name: options.originalFileName
                });
            }

            // Handle file paths
            return await ElectronConversionService.convert(input, options);
        } catch (error) {
            console.error('Conversion error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });

    // Directory selection is now handled by filesystem/index.js
    
    // Handle cancel conversion requests
    ipcMain.handle('codex:convert:cancel', async () => {
        try {
            await ElectronConversionService.cancelRequests();
            return { success: true };
        } catch (error) {
            console.error('Cancel requests error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });
}

module.exports = {
    registerConversionHandlers
};
