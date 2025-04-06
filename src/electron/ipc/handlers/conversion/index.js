/**
 * Conversion IPC Handlers
 * Handles conversion-related IPC events between renderer and main process
 */

const { ipcMain, app } = require('electron');
const ElectronConversionService = require('../../../services/ElectronConversionService');
const { dialog } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * Register conversion IPC handlers
 */
function registerConversionHandlers() {
    // Handle file conversion requests
    ipcMain.handle('codex:convert:file', async (event, input, options) => {
        try {
            // Handle buffer input for binary files (audio/video/pdf/xlsx)
            if (options && options.buffer) {
                console.log(`IPC: Processing binary file of type ${options.type || 'unknown'}: ${options.originalFileName || 'unnamed'}`);
                
                // Log buffer details to help diagnose issues
                console.log('IPC: Buffer details:', {
                    bufferLength: options.buffer.byteLength,
                    isArrayBuffer: options.buffer instanceof ArrayBuffer,
                    type: options.type,
                    originalFileName: options.originalFileName,
                    isTemporary: options.isTemporary
                });
                
                // Convert ArrayBuffer to Buffer
                const buffer = Buffer.from(options.buffer);
                
                // Verify buffer was created correctly
                console.log(`IPC: Created Buffer of length ${buffer.length}`);
                
                return await ElectronConversionService.convert(buffer, {
                    ...options,
                    name: options.originalFileName,
                    isTemporary: true
                });
            }

            // Handle CSV content directly (when isContent flag is set)
            if (options && options.isContent && options.type === 'csv') {
                console.log(`IPC: Processing CSV content directly: ${options.originalFileName || 'unnamed'}`);
                
                // Create a temporary file with the CSV content
                const tempDir = path.join(app.getPath('temp'), 'codex-md-temp');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                
                const tempFilePath = path.join(tempDir, `temp_${Date.now()}.csv`);
                fs.writeFileSync(tempFilePath, input);
                
                console.log(`IPC: Created temporary CSV file: ${tempFilePath}`);
                
                // Convert the temporary file
                const result = await ElectronConversionService.convert(tempFilePath, {
                    ...options,
                    originalFileName: options.originalFileName || options.name,
                    name: options.originalFileName || options.name || path.basename(tempFilePath)
                });
                
                // Clean up the temporary file
                try {
                    fs.unlinkSync(tempFilePath);
                    console.log(`IPC: Removed temporary CSV file: ${tempFilePath}`);
                } catch (cleanupError) {
                    console.warn(`IPC: Failed to remove temporary CSV file: ${cleanupError.message}`);
                }
                
                return result;
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
