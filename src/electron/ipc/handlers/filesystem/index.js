/**
 * FileSystem IPC Handlers
 * Implements handlers for file system operations using the FileSystemService.
 * 
 * Related files:
 * - services/FileSystemService.js: Core file system operations
 * - ipc/types.js: Type definitions for IPC messages
 * - handlers/filesystem/largeFileTransfer.js: Handlers for large file transfers
 */

const { ipcMain, dialog } = require('electron');
const { IPCChannels } = require('../../types');
const FileSystemService = require('../../../services/FileSystemService');
const { registerLargeFileTransferHandlers, cleanupLargeFileTransfers } = require('./largeFileTransfer');

/**
 * Registers all file system IPC handlers
 */
function registerFileSystemHandlers() {
  // Register large file transfer handlers
  registerLargeFileTransferHandlers();
  
  // Read file contents
  ipcMain.handle(IPCChannels.READ_FILE, async (event, request) => {
    if (!request?.path) {
      return { success: false, error: 'Invalid request: path is required' };
    }
    return await FileSystemService.readFile(request.path);
  });

  // Write file contents
  ipcMain.handle(IPCChannels.WRITE_FILE, async (event, request) => {
    if (!request?.path || !request?.content) {
      return { 
        success: false, 
        error: 'Invalid request: path and content are required' 
      };
    }
    return await FileSystemService.writeFile(request.path, request.content);
  });

  // Create directory
  ipcMain.handle(IPCChannels.CREATE_DIRECTORY, async (event, request) => {
    if (!request?.path) {
      return { success: false, error: 'Invalid request: path is required' };
    }
    return await FileSystemService.createDirectory(request.path);
  });

  // List directory contents
  ipcMain.handle(IPCChannels.LIST_DIRECTORY, async (event, request) => {
    if (!request?.path) {
      return { success: false, error: 'Invalid request: path is required' };
    }
    return await FileSystemService.listDirectory(request.path, {
      recursive: request.recursive,
      extensions: request.extensions
    });
  });

  // Delete file or directory
  ipcMain.handle(IPCChannels.DELETE_ITEM, async (event, request) => {
    if (!request?.path) {
      return { success: false, error: 'Invalid request: path is required' };
    }
    return await FileSystemService.delete(request.path, request.recursive);
  });

  // Get file or directory stats
  ipcMain.handle(IPCChannels.GET_STATS, async (event, request) => {
    if (!request?.path) {
      return { success: false, error: 'Invalid request: path is required' };
    }
    return await FileSystemService.getStats(request.path);
  });

  // Move file or directory
  ipcMain.handle(IPCChannels.MOVE_ITEM, async (event, request) => {
    if (!request?.sourcePath || !request?.destPath) {
      return { 
        success: false, 
        error: 'Invalid request: sourcePath and destPath are required' 
      };
    }
    return await FileSystemService.move(request.sourcePath, request.destPath);
  });

  // Enhanced directory selection with filters
  ipcMain.handle(IPCChannels.SELECT_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Target Directory',
      buttonLabel: 'Select Directory'
    });
    
    if (result.canceled) {
      return { success: false, reason: 'USER_CANCELLED' };
    }
    
    return { 
      success: true, 
      path: result.filePaths[0]
    };
  });
  
  // Select input directory
  ipcMain.handle('mdcode:fs:select-input-directory', async (event, request) => {
    const options = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Input Directory',
      buttonLabel: 'Select Directory'
    };
    
    // Add filters if provided
    if (request?.filters) {
      options.filters = request.filters;
    }
    
    const result = await dialog.showOpenDialog(options);
    
    if (result.canceled) {
      return { success: false, reason: 'USER_CANCELLED' };
    }
    
    return { 
      success: true, 
      path: result.filePaths[0]
    };
  });
  
  // List directory with detailed information
  ipcMain.handle('mdcode:fs:list-directory', async (event, request) => {
    if (!request?.path) {
      return { success: false, error: 'Invalid request: path is required' };
    }
    
    return await FileSystemService.listDirectory(request.path, {
      recursive: request.recursive || false,
      extensions: request.extensions
    });
  });
}

/**
 * Cleans up any file system resources
 */
async function cleanupFileSystemHandlers() {
  await cleanupLargeFileTransfers();
}

module.exports = {
  registerFileSystemHandlers,
  cleanupFileSystemHandlers
};
