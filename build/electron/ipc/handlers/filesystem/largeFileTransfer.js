"use strict";

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

const {
  ipcMain
} = require('electron');
const fs = require('fs/promises');
const path = require('path');
const {
  v4: uuidv4
} = require('uuid');
const FileSystemService = require('../../../services/FileSystemService');

// Store active transfers
const activeTransfers = new Map();

/**
 * Registers all large file transfer IPC handlers
 */
function registerLargeFileTransferHandlers() {
  // Initialize a large file transfer
  ipcMain.handle('codex:fs:init-large-file-transfer', async (event, request) => {
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
      await fs.mkdir(chunksDir, {
        recursive: true
      });

      // Calculate chunk size - default to 24MB if not specified
      const chunkSize = request.chunkSize || 24 * 1024 * 1024;

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
  ipcMain.handle('codex:fs:transfer-file-chunk', async (event, request) => {
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
  ipcMain.handle('codex:fs:finalize-large-file-transfer', async (event, request) => {
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
      const transferSpeed = Math.round(transfer.fileSize / (1024 * 1024) / transferTime); // in MB/s

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJpcGNNYWluIiwicmVxdWlyZSIsImZzIiwicGF0aCIsInY0IiwidXVpZHY0IiwiRmlsZVN5c3RlbVNlcnZpY2UiLCJhY3RpdmVUcmFuc2ZlcnMiLCJNYXAiLCJyZWdpc3RlckxhcmdlRmlsZVRyYW5zZmVySGFuZGxlcnMiLCJoYW5kbGUiLCJldmVudCIsInJlcXVlc3QiLCJ0ZW1wRmlsZVBhdGgiLCJmaWxlTmFtZSIsImZpbGVTaXplIiwic3VjY2VzcyIsImVycm9yIiwidmFsaWRQYXRoIiwidmFsaWRhdGVQYXRoIiwidHJhbnNmZXJJZCIsImNodW5rc0RpciIsImpvaW4iLCJkaXJuYW1lIiwibWtkaXIiLCJyZWN1cnNpdmUiLCJjaHVua1NpemUiLCJzZXQiLCJmaWxlVHlwZSIsInJlY2VpdmVkQ2h1bmtzIiwidG90YWxDaHVua3MiLCJNYXRoIiwiY2VpbCIsInN0YXJ0VGltZSIsIkRhdGUiLCJub3ciLCJjaHVua3MiLCJjb25zb2xlIiwibG9nIiwicm91bmQiLCJtZXNzYWdlIiwiY2h1bmtJbmRleCIsInVuZGVmaW5lZCIsImRhdGEiLCJ0cmFuc2ZlciIsImdldCIsImNodW5rQnVmZmVyIiwiQnVmZmVyIiwiZnJvbSIsImxlbmd0aCIsInNpemUiLCJ3YXJuIiwiY2h1bmtQYXRoIiwid3JpdGVGaWxlIiwib3V0cHV0RmlsZSIsIm9wZW4iLCJpIiwiY2h1bmsiLCJjbG9zZSIsImNodW5rRGF0YSIsInJlYWRGaWxlIiwid3JpdGUiLCJzdGF0cyIsInN0YXQiLCJ0cmFuc2ZlclRpbWUiLCJ0cmFuc2ZlclNwZWVkIiwidG9GaXhlZCIsInZhbHVlcyIsInVubGluayIsInJtZGlyIiwiY2xlYW51cEVycm9yIiwiZGVsZXRlIiwiZmluYWxQYXRoIiwiY2xlYW51cExhcmdlRmlsZVRyYW5zZmVycyIsImVudHJpZXMiLCJjbGVhciIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vaXBjL2hhbmRsZXJzL2ZpbGVzeXN0ZW0vbGFyZ2VGaWxlVHJhbnNmZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIExhcmdlIEZpbGUgVHJhbnNmZXIgSVBDIEhhbmRsZXJzXHJcbiAqIFxyXG4gKiBJbXBsZW1lbnRzIGhhbmRsZXJzIGZvciB0cmFuc2ZlcnJpbmcgbGFyZ2UgZmlsZXMgZnJvbSByZW5kZXJlciB0byBtYWluIHByb2Nlc3MgaW4gY2h1bmtzLlxyXG4gKiBUaGlzIGlzIHBhcnRpY3VsYXJseSB1c2VmdWwgZm9yIHZpZGVvIGZpbGVzIHRoYXQgYXJlIHRvbyBsYXJnZSB0byB0cmFuc2ZlciBhcyBhIHNpbmdsZSBiYXNlNjQgc3RyaW5nLlxyXG4gKiBcclxuICogUmVsYXRlZCBmaWxlczpcclxuICogLSBzZXJ2aWNlcy9TdHJlYW1pbmdGaWxlU2VydmljZS5qczogSGFuZGxlcyBzdHJlYW1pbmcgb2YgbGFyZ2UgZmlsZXNcclxuICogLSBzZXJ2aWNlcy9GaWxlU3lzdGVtU2VydmljZS5qczogQ29yZSBmaWxlIHN5c3RlbSBvcGVyYXRpb25zXHJcbiAqIC0gaXBjL3R5cGVzLmpzOiBUeXBlIGRlZmluaXRpb25zIGZvciBJUEMgbWVzc2FnZXNcclxuICovXHJcblxyXG5jb25zdCB7IGlwY01haW4gfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMvcHJvbWlzZXMnKTtcclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgeyB2NDogdXVpZHY0IH0gPSByZXF1aXJlKCd1dWlkJyk7XHJcbmNvbnN0IEZpbGVTeXN0ZW1TZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vLi4vc2VydmljZXMvRmlsZVN5c3RlbVNlcnZpY2UnKTtcclxuXHJcbi8vIFN0b3JlIGFjdGl2ZSB0cmFuc2ZlcnNcclxuY29uc3QgYWN0aXZlVHJhbnNmZXJzID0gbmV3IE1hcCgpO1xyXG5cclxuLyoqXHJcbiAqIFJlZ2lzdGVycyBhbGwgbGFyZ2UgZmlsZSB0cmFuc2ZlciBJUEMgaGFuZGxlcnNcclxuICovXHJcbmZ1bmN0aW9uIHJlZ2lzdGVyTGFyZ2VGaWxlVHJhbnNmZXJIYW5kbGVycygpIHtcclxuICAvLyBJbml0aWFsaXplIGEgbGFyZ2UgZmlsZSB0cmFuc2ZlclxyXG4gIGlwY01haW4uaGFuZGxlKCdjb2RleDpmczppbml0LWxhcmdlLWZpbGUtdHJhbnNmZXInLCBhc3luYyAoZXZlbnQsIHJlcXVlc3QpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICghcmVxdWVzdD8udGVtcEZpbGVQYXRoIHx8ICFyZXF1ZXN0Py5maWxlTmFtZSB8fCAhcmVxdWVzdD8uZmlsZVNpemUpIHtcclxuICAgICAgICByZXR1cm4geyBcclxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICAgIGVycm9yOiAnSW52YWxpZCByZXF1ZXN0OiB0ZW1wRmlsZVBhdGgsIGZpbGVOYW1lLCBhbmQgZmlsZVNpemUgYXJlIHJlcXVpcmVkJyBcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBWYWxpZGF0ZSB0aGUgcGF0aFxyXG4gICAgICBjb25zdCB2YWxpZFBhdGggPSBhd2FpdCBGaWxlU3lzdGVtU2VydmljZS52YWxpZGF0ZVBhdGgocmVxdWVzdC50ZW1wRmlsZVBhdGgsIGZhbHNlKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSBhIHVuaXF1ZSB0cmFuc2ZlciBJRFxyXG4gICAgICBjb25zdCB0cmFuc2ZlcklkID0gdXVpZHY0KCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgYSB0ZW1wb3JhcnkgZGlyZWN0b3J5IGZvciBjaHVua3MgaWYgaXQgZG9lc24ndCBleGlzdFxyXG4gICAgICBjb25zdCBjaHVua3NEaXIgPSBwYXRoLmpvaW4ocGF0aC5kaXJuYW1lKHZhbGlkUGF0aCksIGBjaHVua3NfJHt0cmFuc2ZlcklkfWApO1xyXG4gICAgICBhd2FpdCBmcy5ta2RpcihjaHVua3NEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2FsY3VsYXRlIGNodW5rIHNpemUgLSBkZWZhdWx0IHRvIDI0TUIgaWYgbm90IHNwZWNpZmllZFxyXG4gICAgICBjb25zdCBjaHVua1NpemUgPSByZXF1ZXN0LmNodW5rU2l6ZSB8fCAoMjQgKiAxMDI0ICogMTAyNCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBTdG9yZSB0cmFuc2ZlciBpbmZvcm1hdGlvblxyXG4gICAgICBhY3RpdmVUcmFuc2ZlcnMuc2V0KHRyYW5zZmVySWQsIHtcclxuICAgICAgICB0ZW1wRmlsZVBhdGg6IHZhbGlkUGF0aCxcclxuICAgICAgICBjaHVua3NEaXIsXHJcbiAgICAgICAgZmlsZU5hbWU6IHJlcXVlc3QuZmlsZU5hbWUsXHJcbiAgICAgICAgZmlsZVNpemU6IHJlcXVlc3QuZmlsZVNpemUsXHJcbiAgICAgICAgZmlsZVR5cGU6IHJlcXVlc3QuZmlsZVR5cGUgfHwgJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbScsXHJcbiAgICAgICAgcmVjZWl2ZWRDaHVua3M6IDAsXHJcbiAgICAgICAgdG90YWxDaHVua3M6IE1hdGguY2VpbChyZXF1ZXN0LmZpbGVTaXplIC8gY2h1bmtTaXplKSxcclxuICAgICAgICBjaHVua1NpemU6IGNodW5rU2l6ZSxcclxuICAgICAgICBzdGFydFRpbWU6IERhdGUubm93KCksXHJcbiAgICAgICAgY2h1bmtzOiBuZXcgTWFwKClcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TiiBbTGFyZ2VGaWxlVHJhbnNmZXJdIFVzaW5nIGNodW5rIHNpemU6ICR7TWF0aC5yb3VuZChjaHVua1NpemUgLyAoMTAyNCAqIDEwMjQpKX1NQiwgdG90YWwgY2h1bmtzOiAke01hdGguY2VpbChyZXF1ZXN0LmZpbGVTaXplIC8gY2h1bmtTaXplKX1gKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OkIFtMYXJnZUZpbGVUcmFuc2Zlcl0gSW5pdGlhbGl6ZWQgdHJhbnNmZXIgJHt0cmFuc2ZlcklkfSBmb3IgJHtyZXF1ZXN0LmZpbGVOYW1lfSAoJHtNYXRoLnJvdW5kKHJlcXVlc3QuZmlsZVNpemUgLyAoMTAyNCAqIDEwMjQpKX1NQilgKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICB0cmFuc2ZlcklkXHJcbiAgICAgIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW0xhcmdlRmlsZVRyYW5zZmVyXSBGYWlsZWQgdG8gaW5pdGlhbGl6ZSB0cmFuc2ZlcjonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGBGYWlsZWQgdG8gaW5pdGlhbGl6ZSB0cmFuc2ZlcjogJHtlcnJvci5tZXNzYWdlfWBcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9KTtcclxuICBcclxuICAvLyBUcmFuc2ZlciBhIGNodW5rIG9mIGEgbGFyZ2UgZmlsZVxyXG4gIGlwY01haW4uaGFuZGxlKCdjb2RleDpmczp0cmFuc2Zlci1maWxlLWNodW5rJywgYXN5bmMgKGV2ZW50LCByZXF1ZXN0KSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBpZiAoIXJlcXVlc3Q/LnRyYW5zZmVySWQgfHwgcmVxdWVzdD8uY2h1bmtJbmRleCA9PT0gdW5kZWZpbmVkIHx8ICFyZXF1ZXN0Py5kYXRhKSB7XHJcbiAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSwgXHJcbiAgICAgICAgICBlcnJvcjogJ0ludmFsaWQgcmVxdWVzdDogdHJhbnNmZXJJZCwgY2h1bmtJbmRleCwgYW5kIGRhdGEgYXJlIHJlcXVpcmVkJyBcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBHZXQgdHJhbnNmZXIgaW5mb3JtYXRpb25cclxuICAgICAgY29uc3QgdHJhbnNmZXIgPSBhY3RpdmVUcmFuc2ZlcnMuZ2V0KHJlcXVlc3QudHJhbnNmZXJJZCk7XHJcbiAgICAgIGlmICghdHJhbnNmZXIpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICBlcnJvcjogYFRyYW5zZmVyIG5vdCBmb3VuZDogJHtyZXF1ZXN0LnRyYW5zZmVySWR9YFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIERlY29kZSBiYXNlNjQgZGF0YVxyXG4gICAgICBjb25zdCBjaHVua0J1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlcXVlc3QuZGF0YSwgJ2Jhc2U2NCcpO1xyXG4gICAgICBcclxuICAgICAgLy8gVmVyaWZ5IGNodW5rIHNpemVcclxuICAgICAgaWYgKGNodW5rQnVmZmVyLmxlbmd0aCAhPT0gcmVxdWVzdC5zaXplKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gW0xhcmdlRmlsZVRyYW5zZmVyXSBDaHVuayBzaXplIG1pc21hdGNoOiBleHBlY3RlZCAke3JlcXVlc3Quc2l6ZX0sIGdvdCAke2NodW5rQnVmZmVyLmxlbmd0aH1gKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gU2F2ZSBjaHVuayB0byB0ZW1wb3JhcnkgZmlsZVxyXG4gICAgICBjb25zdCBjaHVua1BhdGggPSBwYXRoLmpvaW4odHJhbnNmZXIuY2h1bmtzRGlyLCBgY2h1bmtfJHtyZXF1ZXN0LmNodW5rSW5kZXh9YCk7XHJcbiAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShjaHVua1BhdGgsIGNodW5rQnVmZmVyKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFVwZGF0ZSB0cmFuc2ZlciBpbmZvcm1hdGlvblxyXG4gICAgICB0cmFuc2Zlci5jaHVua3Muc2V0KHJlcXVlc3QuY2h1bmtJbmRleCwge1xyXG4gICAgICAgIHBhdGg6IGNodW5rUGF0aCxcclxuICAgICAgICBzaXplOiBjaHVua0J1ZmZlci5sZW5ndGhcclxuICAgICAgfSk7XHJcbiAgICAgIHRyYW5zZmVyLnJlY2VpdmVkQ2h1bmtzKys7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TpCBbTGFyZ2VGaWxlVHJhbnNmZXJdIFJlY2VpdmVkIGNodW5rICR7cmVxdWVzdC5jaHVua0luZGV4ICsgMX0vJHt0cmFuc2Zlci50b3RhbENodW5rc30gZm9yIHRyYW5zZmVyICR7cmVxdWVzdC50cmFuc2ZlcklkfSAoJHtNYXRoLnJvdW5kKGNodW5rQnVmZmVyLmxlbmd0aCAvIDEwMjQpfUtCKWApO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIHJlY2VpdmVkQ2h1bmtzOiB0cmFuc2Zlci5yZWNlaXZlZENodW5rcyxcclxuICAgICAgICB0b3RhbENodW5rczogdHJhbnNmZXIudG90YWxDaHVua3NcclxuICAgICAgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbTGFyZ2VGaWxlVHJhbnNmZXJdIEZhaWxlZCB0byB0cmFuc2ZlciBjaHVuazonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGBGYWlsZWQgdG8gdHJhbnNmZXIgY2h1bms6ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfSk7XHJcbiAgXHJcbiAgLy8gRmluYWxpemUgYSBsYXJnZSBmaWxlIHRyYW5zZmVyXHJcbiAgaXBjTWFpbi5oYW5kbGUoJ2NvZGV4OmZzOmZpbmFsaXplLWxhcmdlLWZpbGUtdHJhbnNmZXInLCBhc3luYyAoZXZlbnQsIHJlcXVlc3QpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICghcmVxdWVzdD8udHJhbnNmZXJJZCkge1xyXG4gICAgICAgIHJldHVybiB7IFxyXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsIFxyXG4gICAgICAgICAgZXJyb3I6ICdJbnZhbGlkIHJlcXVlc3Q6IHRyYW5zZmVySWQgaXMgcmVxdWlyZWQnIFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIEdldCB0cmFuc2ZlciBpbmZvcm1hdGlvblxyXG4gICAgICBjb25zdCB0cmFuc2ZlciA9IGFjdGl2ZVRyYW5zZmVycy5nZXQocmVxdWVzdC50cmFuc2ZlcklkKTtcclxuICAgICAgaWYgKCF0cmFuc2Zlcikge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgIGVycm9yOiBgVHJhbnNmZXIgbm90IGZvdW5kOiAke3JlcXVlc3QudHJhbnNmZXJJZH1gXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coYPCfk6QgW0xhcmdlRmlsZVRyYW5zZmVyXSBGaW5hbGl6aW5nIHRyYW5zZmVyICR7cmVxdWVzdC50cmFuc2ZlcklkfTogJHt0cmFuc2Zlci5yZWNlaXZlZENodW5rc30vJHt0cmFuc2Zlci50b3RhbENodW5rc30gY2h1bmtzIHJlY2VpdmVkYCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBpZiBhbGwgY2h1bmtzIHdlcmUgcmVjZWl2ZWRcclxuICAgICAgaWYgKHRyYW5zZmVyLnJlY2VpdmVkQ2h1bmtzICE9PSB0cmFuc2Zlci50b3RhbENodW5rcykge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgIGVycm9yOiBgSW5jb21wbGV0ZSB0cmFuc2ZlcjogcmVjZWl2ZWQgJHt0cmFuc2Zlci5yZWNlaXZlZENodW5rc30vJHt0cmFuc2Zlci50b3RhbENodW5rc30gY2h1bmtzYFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSBvdXRwdXQgZmlsZVxyXG4gICAgICBjb25zdCBvdXRwdXRGaWxlID0gYXdhaXQgZnMub3Blbih0cmFuc2Zlci50ZW1wRmlsZVBhdGgsICd3Jyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDb21iaW5lIGNodW5rc1xyXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRyYW5zZmVyLnRvdGFsQ2h1bmtzOyBpKyspIHtcclxuICAgICAgICBjb25zdCBjaHVuayA9IHRyYW5zZmVyLmNodW5rcy5nZXQoaSk7XHJcbiAgICAgICAgaWYgKCFjaHVuaykge1xyXG4gICAgICAgICAgYXdhaXQgb3V0cHV0RmlsZS5jbG9zZSgpO1xyXG4gICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICAgIGVycm9yOiBgTWlzc2luZyBjaHVuayAke2l9YFxyXG4gICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmVhZCBjaHVua1xyXG4gICAgICAgIGNvbnN0IGNodW5rRGF0YSA9IGF3YWl0IGZzLnJlYWRGaWxlKGNodW5rLnBhdGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFdyaXRlIGNodW5rIHRvIG91dHB1dCBmaWxlXHJcbiAgICAgICAgYXdhaXQgb3V0cHV0RmlsZS53cml0ZShjaHVua0RhdGEpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBDbG9zZSBvdXRwdXQgZmlsZVxyXG4gICAgICBhd2FpdCBvdXRwdXRGaWxlLmNsb3NlKCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBHZXQgZmlsZSBzdGF0c1xyXG4gICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQodHJhbnNmZXIudGVtcEZpbGVQYXRoKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFZlcmlmeSBmaWxlIHNpemVcclxuICAgICAgaWYgKHN0YXRzLnNpemUgIT09IHRyYW5zZmVyLmZpbGVTaXplKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gW0xhcmdlRmlsZVRyYW5zZmVyXSBGaWxlIHNpemUgbWlzbWF0Y2g6IGV4cGVjdGVkICR7dHJhbnNmZXIuZmlsZVNpemV9LCBnb3QgJHtzdGF0cy5zaXplfWApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBDYWxjdWxhdGUgdHJhbnNmZXIgc3BlZWRcclxuICAgICAgY29uc3QgdHJhbnNmZXJUaW1lID0gKERhdGUubm93KCkgLSB0cmFuc2Zlci5zdGFydFRpbWUpIC8gMTAwMDsgLy8gaW4gc2Vjb25kc1xyXG4gICAgICBjb25zdCB0cmFuc2ZlclNwZWVkID0gTWF0aC5yb3VuZCgodHJhbnNmZXIuZmlsZVNpemUgLyAoMTAyNCAqIDEwMjQpKSAvIHRyYW5zZmVyVGltZSk7IC8vIGluIE1CL3NcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGDinIUgW0xhcmdlRmlsZVRyYW5zZmVyXSBUcmFuc2ZlciAke3JlcXVlc3QudHJhbnNmZXJJZH0gY29tcGxldGVkIGluICR7dHJhbnNmZXJUaW1lLnRvRml4ZWQoMil9cyAoJHt0cmFuc2ZlclNwZWVkfU1CL3MpYCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OBIFtMYXJnZUZpbGVUcmFuc2Zlcl0gRmlsZSBzYXZlZCB0byAke3RyYW5zZmVyLnRlbXBGaWxlUGF0aH0gKCR7TWF0aC5yb3VuZChzdGF0cy5zaXplIC8gKDEwMjQgKiAxMDI0KSl9TUIpYCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDbGVhbiB1cCBjaHVua3NcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBmb3IgKGNvbnN0IGNodW5rIG9mIHRyYW5zZmVyLmNodW5rcy52YWx1ZXMoKSkge1xyXG4gICAgICAgICAgYXdhaXQgZnMudW5saW5rKGNodW5rLnBhdGgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBhd2FpdCBmcy5ybWRpcih0cmFuc2Zlci5jaHVua3NEaXIpO1xyXG4gICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbTGFyZ2VGaWxlVHJhbnNmZXJdIEZhaWxlZCB0byBjbGVhbiB1cCBjaHVua3M6YCwgY2xlYW51cEVycm9yKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gUmVtb3ZlIHRyYW5zZmVyIGZyb20gYWN0aXZlIHRyYW5zZmVyc1xyXG4gICAgICBhY3RpdmVUcmFuc2ZlcnMuZGVsZXRlKHJlcXVlc3QudHJhbnNmZXJJZCk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgZmluYWxQYXRoOiB0cmFuc2Zlci50ZW1wRmlsZVBhdGgsXHJcbiAgICAgICAgc2l6ZTogc3RhdHMuc2l6ZSxcclxuICAgICAgICB0cmFuc2ZlclRpbWUsXHJcbiAgICAgICAgdHJhbnNmZXJTcGVlZFxyXG4gICAgICB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtMYXJnZUZpbGVUcmFuc2Zlcl0gRmFpbGVkIHRvIGZpbmFsaXplIHRyYW5zZmVyOicsIGVycm9yKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENsZWFuIHVwIHRyYW5zZmVyXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgdHJhbnNmZXIgPSBhY3RpdmVUcmFuc2ZlcnMuZ2V0KHJlcXVlc3QudHJhbnNmZXJJZCk7XHJcbiAgICAgICAgaWYgKHRyYW5zZmVyKSB7XHJcbiAgICAgICAgICAvLyBDbGVhbiB1cCBjaHVua3NcclxuICAgICAgICAgIGZvciAoY29uc3QgY2h1bmsgb2YgdHJhbnNmZXIuY2h1bmtzLnZhbHVlcygpKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLnVubGluayhjaHVuay5wYXRoKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGF3YWl0IGZzLnJtZGlyKHRyYW5zZmVyLmNodW5rc0Rpcik7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIFJlbW92ZSB0cmFuc2ZlciBmcm9tIGFjdGl2ZSB0cmFuc2ZlcnNcclxuICAgICAgICAgIGFjdGl2ZVRyYW5zZmVycy5kZWxldGUocmVxdWVzdC50cmFuc2ZlcklkKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFtMYXJnZUZpbGVUcmFuc2Zlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIGFmdGVyIGVycm9yOmAsIGNsZWFudXBFcnJvcik7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGBGYWlsZWQgdG8gZmluYWxpemUgdHJhbnNmZXI6ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDbGVhbnMgdXAgYW55IGFjdGl2ZSB0cmFuc2ZlcnNcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGNsZWFudXBMYXJnZUZpbGVUcmFuc2ZlcnMoKSB7XHJcbiAgdHJ5IHtcclxuICAgIGZvciAoY29uc3QgW3RyYW5zZmVySWQsIHRyYW5zZmVyXSBvZiBhY3RpdmVUcmFuc2ZlcnMuZW50cmllcygpKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn6e5IFtMYXJnZUZpbGVUcmFuc2Zlcl0gQ2xlYW5pbmcgdXAgdHJhbnNmZXIgJHt0cmFuc2ZlcklkfWApO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2xlYW4gdXAgY2h1bmtzXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBjaHVuayBvZiB0cmFuc2Zlci5jaHVua3MudmFsdWVzKCkpIHtcclxuICAgICAgICAgIGF3YWl0IGZzLnVubGluayhjaHVuay5wYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgYXdhaXQgZnMucm1kaXIodHJhbnNmZXIuY2h1bmtzRGlyKTtcclxuICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gW0xhcmdlRmlsZVRyYW5zZmVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgY2h1bmtzOmAsIGNsZWFudXBFcnJvcik7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gQ2xlYXIgYWN0aXZlIHRyYW5zZmVyc1xyXG4gICAgYWN0aXZlVHJhbnNmZXJzLmNsZWFyKCk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbTGFyZ2VGaWxlVHJhbnNmZXJdIEZhaWxlZCB0byBjbGVhbiB1cCB0cmFuc2ZlcnM6JywgZXJyb3IpO1xyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7XHJcbiAgcmVnaXN0ZXJMYXJnZUZpbGVUcmFuc2ZlckhhbmRsZXJzLFxyXG4gIGNsZWFudXBMYXJnZUZpbGVUcmFuc2ZlcnNcclxufTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTTtFQUFFQTtBQUFRLENBQUMsR0FBR0MsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUN2QyxNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxhQUFhLENBQUM7QUFDakMsTUFBTUUsSUFBSSxHQUFHRixPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU07RUFBRUcsRUFBRSxFQUFFQztBQUFPLENBQUMsR0FBR0osT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUN0QyxNQUFNSyxpQkFBaUIsR0FBR0wsT0FBTyxDQUFDLHFDQUFxQyxDQUFDOztBQUV4RTtBQUNBLE1BQU1NLGVBQWUsR0FBRyxJQUFJQyxHQUFHLENBQUMsQ0FBQzs7QUFFakM7QUFDQTtBQUNBO0FBQ0EsU0FBU0MsaUNBQWlDQSxDQUFBLEVBQUc7RUFDM0M7RUFDQVQsT0FBTyxDQUFDVSxNQUFNLENBQUMsbUNBQW1DLEVBQUUsT0FBT0MsS0FBSyxF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