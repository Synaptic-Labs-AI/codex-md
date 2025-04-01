/**
 * Large File Transfer IPC Handlers
 * 
 * Implements handlers for transferring large files from renderer to main process in chunks.
 * This is particularly useful for video files that are too large to transfer as a single base64 string.
 * 
 * Related files:
 * - services/StreamingFileService.js: Handles streaming of large files
 * - services/FileSystemService.js: Core file system operations
 * - ipc/types.js: Type definitions for IPC messages
 */

const { ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const FileSystemService = require('../../../services/FileSystemService');

// Store active transfers
const activeTransfers = new Map();

/**
 * Registers all large file transfer IPC handlers
 */
function registerLargeFileTransferHandlers() {
  // Initialize a large file transfer
  ipcMain.handle('mdcode:fs:init-large-file-transfer', async (event, request) => {
    try {
      if (!request?.tempFilePath || !request?.fileName || !request?.fileSize) {
        return { 
          success: false, 
          error: 'Invalid request: tempFilePath, fileName, and fileSize are required' 
        };
      }
      
      // Validate the path
      const validPath = await FileSystemService.validatePath(request.tempFilePath, false);
      
      // Create a unique transfer ID
      const transferId = uuidv4();
      
      // Create a temporary directory for chunks if it doesn't exist
      const chunksDir = path.join(path.dirname(validPath), `chunks_${transferId}`);
      await fs.mkdir(chunksDir, { recursive: true });
      
      // Calculate chunk size - default to 24MB if not specified
      const chunkSize = request.chunkSize || (24 * 1024 * 1024);
      
      // Store transfer information
      activeTransfers.set(transferId, {
        tempFilePath: validPath,
        chunksDir,
        fileName: request.fileName,
        fileSize: request.fileSize,
        fileType: request.fileType || 'application/octet-stream',
        receivedChunks: 0,
        totalChunks: Math.ceil(request.fileSize / chunkSize),
        chunkSize: chunkSize,
        startTime: Date.now(),
        chunks: new Map()
      });
      
      console.log(`📊 [LargeFileTransfer] Using chunk size: ${Math.round(chunkSize / (1024 * 1024))}MB, total chunks: ${Math.ceil(request.fileSize / chunkSize)}`);
      
      console.log(`📤 [LargeFileTransfer] Initialized transfer ${transferId} for ${request.fileName} (${Math.round(request.fileSize / (1024 * 1024))}MB)`);
      
      return {
        success: true,
        transferId
      };
    } catch (error) {
      console.error('❌ [LargeFileTransfer] Failed to initialize transfer:', error);
      return {
        success: false,
        error: `Failed to initialize transfer: ${error.message}`
      };
    }
  });
  
  // Transfer a chunk of a large file
  ipcMain.handle('mdcode:fs:transfer-file-chunk', async (event, request) => {
    try {
      if (!request?.transferId || request?.chunkIndex === undefined || !request?.data) {
        return { 
          success: false, 
          error: 'Invalid request: transferId, chunkIndex, and data are required' 
        };
      }
      
      // Get transfer information
      const transfer = activeTransfers.get(request.transferId);
      if (!transfer) {
        return {
          success: false,
          error: `Transfer not found: ${request.transferId}`
        };
      }
      
      // Decode base64 data
      const chunkBuffer = Buffer.from(request.data, 'base64');
      
      // Verify chunk size
      if (chunkBuffer.length !== request.size) {
        console.warn(`⚠️ [LargeFileTransfer] Chunk size mismatch: expected ${request.size}, got ${chunkBuffer.length}`);
      }
      
      // Save chunk to temporary file
      const chunkPath = path.join(transfer.chunksDir, `chunk_${request.chunkIndex}`);
      await fs.writeFile(chunkPath, chunkBuffer);
      
      // Update transfer information
      transfer.chunks.set(request.chunkIndex, {
        path: chunkPath,
        size: chunkBuffer.length
      });
      transfer.receivedChunks++;
      
      console.log(`📤 [LargeFileTransfer] Received chunk ${request.chunkIndex + 1}/${transfer.totalChunks} for transfer ${request.transferId} (${Math.round(chunkBuffer.length / 1024)}KB)`);
      
      return {
        success: true,
        receivedChunks: transfer.receivedChunks,
        totalChunks: transfer.totalChunks
      };
    } catch (error) {
      console.error('❌ [LargeFileTransfer] Failed to transfer chunk:', error);
      return {
        success: false,
        error: `Failed to transfer chunk: ${error.message}`
      };
    }
  });
  
  // Finalize a large file transfer
  ipcMain.handle('mdcode:fs:finalize-large-file-transfer', async (event, request) => {
    try {
      if (!request?.transferId) {
        return { 
          success: false, 
          error: 'Invalid request: transferId is required' 
        };
      }
      
      // Get transfer information
      const transfer = activeTransfers.get(request.transferId);
      if (!transfer) {
        return {
          success: false,
          error: `Transfer not found: ${request.transferId}`
        };
      }
      
      console.log(`📤 [LargeFileTransfer] Finalizing transfer ${request.transferId}: ${transfer.receivedChunks}/${transfer.totalChunks} chunks received`);
      
      // Check if all chunks were received
      if (transfer.receivedChunks !== transfer.totalChunks) {
        return {
          success: false,
          error: `Incomplete transfer: received ${transfer.receivedChunks}/${transfer.totalChunks} chunks`
        };
      }
      
      // Create output file
      const outputFile = await fs.open(transfer.tempFilePath, 'w');
      
      // Combine chunks
      for (let i = 0; i < transfer.totalChunks; i++) {
        const chunk = transfer.chunks.get(i);
        if (!chunk) {
          await outputFile.close();
          return {
            success: false,
            error: `Missing chunk ${i}`
          };
        }
        
        // Read chunk
        const chunkData = await fs.readFile(chunk.path);
        
        // Write chunk to output file
        await outputFile.write(chunkData);
      }
      
      // Close output file
      await outputFile.close();
      
      // Get file stats
      const stats = await fs.stat(transfer.tempFilePath);
      
      // Verify file size
      if (stats.size !== transfer.fileSize) {
        console.warn(`⚠️ [LargeFileTransfer] File size mismatch: expected ${transfer.fileSize}, got ${stats.size}`);
      }
      
      // Calculate transfer speed
      const transferTime = (Date.now() - transfer.startTime) / 1000; // in seconds
      const transferSpeed = Math.round((transfer.fileSize / (1024 * 1024)) / transferTime); // in MB/s
      
      console.log(`✅ [LargeFileTransfer] Transfer ${request.transferId} completed in ${transferTime.toFixed(2)}s (${transferSpeed}MB/s)`);
      console.log(`📁 [LargeFileTransfer] File saved to ${transfer.tempFilePath} (${Math.round(stats.size / (1024 * 1024))}MB)`);
      
      // Clean up chunks
      try {
        for (const chunk of transfer.chunks.values()) {
          await fs.unlink(chunk.path);
        }
        await fs.rmdir(transfer.chunksDir);
      } catch (cleanupError) {
        console.warn(`⚠️ [LargeFileTransfer] Failed to clean up chunks:`, cleanupError);
      }
      
      // Remove transfer from active transfers
      activeTransfers.delete(request.transferId);
      
      return {
        success: true,
        finalPath: transfer.tempFilePath,
        size: stats.size,
        transferTime,
        transferSpeed
      };
    } catch (error) {
      console.error('❌ [LargeFileTransfer] Failed to finalize transfer:', error);
      
      // Clean up transfer
      try {
        const transfer = activeTransfers.get(request.transferId);
        if (transfer) {
          // Clean up chunks
          for (const chunk of transfer.chunks.values()) {
            await fs.unlink(chunk.path);
          }
          await fs.rmdir(transfer.chunksDir);
          
          // Remove transfer from active transfers
          activeTransfers.delete(request.transferId);
        }
      } catch (cleanupError) {
        console.warn(`⚠️ [LargeFileTransfer] Failed to clean up after error:`, cleanupError);
      }
      
      return {
        success: false,
        error: `Failed to finalize transfer: ${error.message}`
      };
    }
  });
}

/**
 * Cleans up any active transfers
 */
async function cleanupLargeFileTransfers() {
  try {
    for (const [transferId, transfer] of activeTransfers.entries()) {
      console.log(`🧹 [LargeFileTransfer] Cleaning up transfer ${transferId}`);
      
      // Clean up chunks
      try {
        for (const chunk of transfer.chunks.values()) {
          await fs.unlink(chunk.path);
        }
        await fs.rmdir(transfer.chunksDir);
      } catch (cleanupError) {
        console.warn(`⚠️ [LargeFileTransfer] Failed to clean up chunks:`, cleanupError);
      }
    }
    
    // Clear active transfers
    activeTransfers.clear();
  } catch (error) {
    console.error('❌ [LargeFileTransfer] Failed to clean up transfers:', error);
  }
}

module.exports = {
  registerLargeFileTransferHandlers,
  cleanupLargeFileTransfers
};
