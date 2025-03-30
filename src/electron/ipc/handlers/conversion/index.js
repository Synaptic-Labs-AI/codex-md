/**
 * Conversion IPC Handlers
 * Implements handlers for document conversion operations.
 * 
 * These handlers expose the ElectronConversionService functionality to the
 * renderer process through secure IPC channels. They manage file selection,
 * conversion processes, and progress tracking.
 * 
 * Related files:
 * - services/ElectronConversionService.js: Core conversion functionality
 * - services/FileSystemService.js: File system operations
 * - ipc/types.js: TypeScript definitions
 * - features/notifications.js: Native notifications for conversion events
 */

const { ipcMain, dialog } = require('electron');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { IPCChannels } = require('../../types');
const ElectronConversionService = require('../../../services/ElectronConversionService');
const ProgressService = require('../../../services/ProgressService');

/**
 * Registers all conversion-related IPC handlers
 */
function registerConversionHandlers() {
  // Convert single file
  ipcMain.handle(IPCChannels.CONVERT_FILE, async (event, request) => {
    if (!request?.path) {
      return { 
        success: false, 
        error: 'Invalid request: file path is required' 
      };
    }

    // Generate a unique job ID
    const jobId = uuidv4();
    
    try {
      // Register job with ProgressService
      ProgressService.registerJob(jobId, {
        type: 'file',
        path: request.path,
        filename: path.basename(request.path)
      });
      
      const result = await ElectronConversionService.convert(request.path, {
        ...request.options,
        onProgress: (progress) => {
          // Update progress via ProgressService
          ProgressService.updateProgress(jobId, progress, {
            file: request.path,
            status: progress < 100 ? 'converting' : 'complete'
          });
        }
      });
      
      // Mark job as complete
      ProgressService.completeJob(jobId, result);
      
      // Show notification on successful conversion
      if (result.success && global.notificationManager) {
        global.notificationManager.showConversionComplete(request.path, result.outputPath);
      }
      
      return {
        ...result,
        jobId // Return jobId to client for reference
      };
    } catch (error) {
      // Mark job as failed
      ProgressService.failJob(jobId, error);
      
      // Show notification on conversion error
      if (global.notificationManager) {
        global.notificationManager.showConversionError(request.path, error);
      }
      
      return {
        success: false,
        error: error.message,
        jobId
      };
    }
  });

  // Convert multiple files
  ipcMain.handle(IPCChannels.CONVERT_BATCH, async (event, request) => {
    if (!request?.paths || !Array.isArray(request.paths)) {
      return { 
        success: false, 
        error: 'Invalid request: file paths array is required' 
      };
    }

    // Generate a unique job ID
    const jobId = uuidv4();
    
    try {
      // Register job with ProgressService
      ProgressService.registerJob(jobId, {
        type: 'batch',
        paths: request.paths,
        count: request.paths.length
      });
      
      const result = await ElectronConversionService.convertBatch(request.paths, {
        ...request.options,
        onProgress: (progressInfo) => {
          // Update progress via ProgressService
          ProgressService.updateProgress(jobId, progressInfo.progress, {
            file: progressInfo.file,
            index: progressInfo.index,
            total: request.paths.length,
            status: 'converting'
          });
        }
      });
      
      // Mark job as complete
      ProgressService.completeJob(jobId, result);
      
      // Show notification on successful batch conversion
      if (result.success && global.notificationManager) {
        global.notificationManager.showBatchConversionComplete(
          result.results.length, 
          result.outputDir
        );
      }
      
      return {
        ...result,
        jobId // Return jobId to client for reference
      };
    } catch (error) {
      // Mark job as failed
      ProgressService.failJob(jobId, error);
      
      // Show notification on batch conversion error
      if (global.notificationManager) {
        global.notificationManager.showConversionError('batch conversion', error);
      }
      
      return {
        success: false,
        error: error.message,
        jobId
      };
    }
  });

  // Select files for conversion
  ipcMain.handle(IPCChannels.SELECT_FILES, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'pptx', 'xlsx'] },
        { name: 'Audio/Video', extensions: ['mp3', 'mp4', 'wav', 'avi'] },
        { name: 'Data', extensions: ['csv', 'json', 'yaml'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled) {
      return { success: false, reason: 'USER_CANCELLED' };
    }

    return { 
      success: true, 
      paths: result.filePaths
    };
  });

  // Select output directory
  ipcMain.handle(IPCChannels.SELECT_OUTPUT, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Output Directory',
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

  // Convert URL to Markdown
  ipcMain.handle(IPCChannels.CONVERT_URL, async (event, request) => {
    if (!request?.url) {
      return { 
        success: false, 
        error: 'Invalid request: URL is required' 
      };
    }

    // Generate a unique job ID
    const jobId = uuidv4();
    
    try {
      // Register job with ProgressService
      ProgressService.registerJob(jobId, {
        type: 'url',
        url: request.url
      });
      
      const result = await ElectronConversionService.convertUrl(request.url, {
        ...request.options,
        onProgress: (progress) => {
          // Update progress via ProgressService
          ProgressService.updateProgress(jobId, progress, {
            file: request.url,
            status: progress < 100 ? 'converting' : 'complete'
          });
        }
      });
      
      // Mark job as complete
      ProgressService.completeJob(jobId, result);
      
      // Show notification on successful URL conversion
      if (result.success && global.notificationManager) {
        global.notificationManager.showConversionComplete(request.url, result.outputPath);
      }
      
      return {
        ...result,
        jobId // Return jobId to client for reference
      };
    } catch (error) {
      // Mark job as failed
      ProgressService.failJob(jobId, error);
      
      // Show notification on URL conversion error
      if (global.notificationManager) {
        global.notificationManager.showConversionError(request.url, error);
      }
      
      return {
        success: false,
        error: error.message,
        jobId
      };
    }
  });

  // Convert Parent URL (website) to Markdown
  ipcMain.handle(IPCChannels.CONVERT_PARENT_URL, async (event, request) => {
    if (!request?.url) {
      return { 
        success: false, 
        error: 'Invalid request: parent URL is required' 
      };
    }

    // Generate a unique job ID
    const jobId = uuidv4();
    
    try {
      // Register job with ProgressService
      ProgressService.registerJob(jobId, {
        type: 'parent-url',
        url: request.url
      });
      
      const result = await ElectronConversionService.convertParentUrl(request.url, {
        ...request.options,
        onProgress: (progress) => {
          // Update progress via ProgressService
          ProgressService.updateProgress(jobId, progress, {
            file: request.url,
            status: progress < 100 ? 'converting' : 'complete'
          });
        }
      });
      
      // Mark job as complete
      ProgressService.completeJob(jobId, result);
      
      // Show notification on successful parent URL conversion
      if (result.success && global.notificationManager) {
        global.notificationManager.showConversionComplete(request.url, result.outputPath);
      }
      
      return {
        ...result,
        jobId // Return jobId to client for reference
      };
    } catch (error) {
      // Mark job as failed
      ProgressService.failJob(jobId, error);
      
      // Show notification on parent URL conversion error
      if (global.notificationManager) {
        global.notificationManager.showConversionError(request.url, error);
      }
      
      return {
        success: false,
        error: error.message,
        jobId
      };
    }
  });

  // Convert YouTube URL to Markdown
  ipcMain.handle(IPCChannels.CONVERT_YOUTUBE, async (event, request) => {
    if (!request?.url) {
      return { 
        success: false, 
        error: 'Invalid request: YouTube URL is required' 
      };
    }

    // Generate a unique job ID
    const jobId = uuidv4();
    
    try {
      // Register job with ProgressService
      ProgressService.registerJob(jobId, {
        type: 'youtube',
        url: request.url
      });
      
      const result = await ElectronConversionService.convertYoutube(request.url, {
        ...request.options,
        onProgress: (progress) => {
          // Update progress via ProgressService
          ProgressService.updateProgress(jobId, progress, {
            file: request.url,
            status: progress < 100 ? 'converting' : 'complete'
          });
        }
      });
      
      // Mark job as complete
      ProgressService.completeJob(jobId, result);
      
      // Show notification on successful YouTube conversion
      if (result.success && global.notificationManager) {
        global.notificationManager.showConversionComplete(request.url, result.outputPath);
      }
      
      return {
        ...result,
        jobId // Return jobId to client for reference
      };
    } catch (error) {
      // Mark job as failed
      ProgressService.failJob(jobId, error);
      
      // Show notification on YouTube conversion error
      if (global.notificationManager) {
        global.notificationManager.showConversionError(request.url, error);
      }
      
      return {
        success: false,
        error: error.message,
        jobId
      };
    }
  });

  // Get conversion result
  ipcMain.handle(IPCChannels.GET_RESULT, async (event, request) => {
    if (!request?.path) {
      return { 
        success: false, 
        error: 'Invalid request: result path is required' 
      };
    }

    try {
      // Check if path exists and is valid
      const stats = await ElectronConversionService.fileSystem.getStats(request.path);
      if (!stats.success) {
        throw new Error('Result not found or inaccessible');
      }

      // Read metadata if available
      const metadataPath = path.join(request.path, 'metadata.json');
      const metadata = await ElectronConversionService.fileSystem.readFile(metadataPath);

      // Read main document
      const mainFilePath = path.join(request.path, 'document.md');
      const mainFile = await ElectronConversionService.fileSystem.readFile(mainFilePath);

      if (!mainFile.success) {
        throw new Error('Failed to read conversion result');
      }

      return {
        success: true,
        content: mainFile.data,
        metadata: metadata.success ? JSON.parse(metadata.data) : null
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get conversion result: ${error.message}`
      };
    }
  });
  
  // Cancel conversion
  ipcMain.handle(IPCChannels.CONVERSION_CANCEL, async (event, request) => {
    if (!request?.id) {
      return { 
        success: false, 
        error: 'Invalid request: job ID is required' 
      };
    }
    
    try {
      ProgressService.cancelJob(request.id);
      return { success: true };
    } catch (error) {
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
