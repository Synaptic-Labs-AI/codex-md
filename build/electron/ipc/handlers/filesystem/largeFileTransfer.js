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
const {
  instance: FileSystemService
} = require('../../../services/FileSystemService'); // Import instance

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJpcGNNYWluIiwicmVxdWlyZSIsImZzIiwicGF0aCIsInY0IiwidXVpZHY0IiwiaW5zdGFuY2UiLCJGaWxlU3lzdGVtU2VydmljZSIsImFjdGl2ZVRyYW5zZmVycyIsIk1hcCIsInJlZ2lzdGVyTGFyZ2VGaWxlVHJhbnNmZXJIYW5kbGVycyIsImhhbmRsZSIsImV2ZW50IiwicmVxdWVzdCIsInRlbXBGaWxlUGF0aCIsImZpbGVOYW1lIiwiZmlsZVNpemUiLCJzdWNjZXNzIiwiZXJyb3IiLCJ2YWxpZFBhdGgiLCJ2YWxpZGF0ZVBhdGgiLCJ0cmFuc2ZlcklkIiwiY2h1bmtzRGlyIiwiam9pbiIsImRpcm5hbWUiLCJta2RpciIsInJlY3Vyc2l2ZSIsImNodW5rU2l6ZSIsInNldCIsImZpbGVUeXBlIiwicmVjZWl2ZWRDaHVua3MiLCJ0b3RhbENodW5rcyIsIk1hdGgiLCJjZWlsIiwic3RhcnRUaW1lIiwiRGF0ZSIsIm5vdyIsImNodW5rcyIsImNvbnNvbGUiLCJsb2ciLCJyb3VuZCIsIm1lc3NhZ2UiLCJjaHVua0luZGV4IiwidW5kZWZpbmVkIiwiZGF0YSIsInRyYW5zZmVyIiwiZ2V0IiwiY2h1bmtCdWZmZXIiLCJCdWZmZXIiLCJmcm9tIiwibGVuZ3RoIiwic2l6ZSIsIndhcm4iLCJjaHVua1BhdGgiLCJ3cml0ZUZpbGUiLCJvdXRwdXRGaWxlIiwib3BlbiIsImkiLCJjaHVuayIsImNsb3NlIiwiY2h1bmtEYXRhIiwicmVhZEZpbGUiLCJ3cml0ZSIsInN0YXRzIiwic3RhdCIsInRyYW5zZmVyVGltZSIsInRyYW5zZmVyU3BlZWQiLCJ0b0ZpeGVkIiwidmFsdWVzIiwidW5saW5rIiwicm1kaXIiLCJjbGVhbnVwRXJyb3IiLCJkZWxldGUiLCJmaW5hbFBhdGgiLCJjbGVhbnVwTGFyZ2VGaWxlVHJhbnNmZXJzIiwiZW50cmllcyIsImNsZWFyIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi9pcGMvaGFuZGxlcnMvZmlsZXN5c3RlbS9sYXJnZUZpbGVUcmFuc2Zlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogTGFyZ2UgRmlsZSBUcmFuc2ZlciBJUEMgSGFuZGxlcnNcclxuICogXHJcbiAqIEltcGxlbWVudHMgaGFuZGxlcnMgZm9yIHRyYW5zZmVycmluZyBsYXJnZSBmaWxlcyBmcm9tIHJlbmRlcmVyIHRvIG1haW4gcHJvY2VzcyBpbiBjaHVua3MuXHJcbiAqIFRoaXMgaXMgcGFydGljdWxhcmx5IHVzZWZ1bCBmb3IgdmlkZW8gZmlsZXMgdGhhdCBhcmUgdG9vIGxhcmdlIHRvIHRyYW5zZmVyIGFzIGEgc2luZ2xlIGJhc2U2NCBzdHJpbmcuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNlcnZpY2VzL1N0cmVhbWluZ0ZpbGVTZXJ2aWNlLmpzOiBIYW5kbGVzIHN0cmVhbWluZyBvZiBsYXJnZSBmaWxlc1xyXG4gKiAtIHNlcnZpY2VzL0ZpbGVTeXN0ZW1TZXJ2aWNlLmpzOiBDb3JlIGZpbGUgc3lzdGVtIG9wZXJhdGlvbnNcclxuICogLSBpcGMvdHlwZXMuanM6IFR5cGUgZGVmaW5pdGlvbnMgZm9yIElQQyBtZXNzYWdlc1xyXG4gKi9cclxuXHJcbmNvbnN0IHsgaXBjTWFpbiB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy9wcm9taXNlcycpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IHY0OiB1dWlkdjQgfSA9IHJlcXVpcmUoJ3V1aWQnKTtcclxuY29uc3QgeyBpbnN0YW5jZTogRmlsZVN5c3RlbVNlcnZpY2UgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL3NlcnZpY2VzL0ZpbGVTeXN0ZW1TZXJ2aWNlJyk7IC8vIEltcG9ydCBpbnN0YW5jZVxyXG5cclxuLy8gU3RvcmUgYWN0aXZlIHRyYW5zZmVyc1xyXG5jb25zdCBhY3RpdmVUcmFuc2ZlcnMgPSBuZXcgTWFwKCk7XHJcblxyXG4vKipcclxuICogUmVnaXN0ZXJzIGFsbCBsYXJnZSBmaWxlIHRyYW5zZmVyIElQQyBoYW5kbGVyc1xyXG4gKi9cclxuZnVuY3Rpb24gcmVnaXN0ZXJMYXJnZUZpbGVUcmFuc2ZlckhhbmRsZXJzKCkge1xyXG4gIC8vIEluaXRpYWxpemUgYSBsYXJnZSBmaWxlIHRyYW5zZmVyXHJcbiAgaXBjTWFpbi5oYW5kbGUoJ2NvZGV4OmZzOmluaXQtbGFyZ2UtZmlsZS10cmFuc2ZlcicsIGFzeW5jIChldmVudCwgcmVxdWVzdCkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgaWYgKCFyZXF1ZXN0Py50ZW1wRmlsZVBhdGggfHwgIXJlcXVlc3Q/LmZpbGVOYW1lIHx8ICFyZXF1ZXN0Py5maWxlU2l6ZSkge1xyXG4gICAgICAgIHJldHVybiB7IFxyXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsIFxyXG4gICAgICAgICAgZXJyb3I6ICdJbnZhbGlkIHJlcXVlc3Q6IHRlbXBGaWxlUGF0aCwgZmlsZU5hbWUsIGFuZCBmaWxlU2l6ZSBhcmUgcmVxdWlyZWQnIFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFZhbGlkYXRlIHRoZSBwYXRoXHJcbiAgICAgIGNvbnN0IHZhbGlkUGF0aCA9IGF3YWl0IEZpbGVTeXN0ZW1TZXJ2aWNlLnZhbGlkYXRlUGF0aChyZXF1ZXN0LnRlbXBGaWxlUGF0aCwgZmFsc2UpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ3JlYXRlIGEgdW5pcXVlIHRyYW5zZmVyIElEXHJcbiAgICAgIGNvbnN0IHRyYW5zZmVySWQgPSB1dWlkdjQoKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBkaXJlY3RvcnkgZm9yIGNodW5rcyBpZiBpdCBkb2Vzbid0IGV4aXN0XHJcbiAgICAgIGNvbnN0IGNodW5rc0RpciA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUodmFsaWRQYXRoKSwgYGNodW5rc18ke3RyYW5zZmVySWR9YCk7XHJcbiAgICAgIGF3YWl0IGZzLm1rZGlyKGNodW5rc0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDYWxjdWxhdGUgY2h1bmsgc2l6ZSAtIGRlZmF1bHQgdG8gMjRNQiBpZiBub3Qgc3BlY2lmaWVkXHJcbiAgICAgIGNvbnN0IGNodW5rU2l6ZSA9IHJlcXVlc3QuY2h1bmtTaXplIHx8ICgyNCAqIDEwMjQgKiAxMDI0KTtcclxuICAgICAgXHJcbiAgICAgIC8vIFN0b3JlIHRyYW5zZmVyIGluZm9ybWF0aW9uXHJcbiAgICAgIGFjdGl2ZVRyYW5zZmVycy5zZXQodHJhbnNmZXJJZCwge1xyXG4gICAgICAgIHRlbXBGaWxlUGF0aDogdmFsaWRQYXRoLFxyXG4gICAgICAgIGNodW5rc0RpcixcclxuICAgICAgICBmaWxlTmFtZTogcmVxdWVzdC5maWxlTmFtZSxcclxuICAgICAgICBmaWxlU2l6ZTogcmVxdWVzdC5maWxlU2l6ZSxcclxuICAgICAgICBmaWxlVHlwZTogcmVxdWVzdC5maWxlVHlwZSB8fCAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJyxcclxuICAgICAgICByZWNlaXZlZENodW5rczogMCxcclxuICAgICAgICB0b3RhbENodW5rczogTWF0aC5jZWlsKHJlcXVlc3QuZmlsZVNpemUgLyBjaHVua1NpemUpLFxyXG4gICAgICAgIGNodW5rU2l6ZTogY2h1bmtTaXplLFxyXG4gICAgICAgIHN0YXJ0VGltZTogRGF0ZS5ub3coKSxcclxuICAgICAgICBjaHVua3M6IG5ldyBNYXAoKVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OKIFtMYXJnZUZpbGVUcmFuc2Zlcl0gVXNpbmcgY2h1bmsgc2l6ZTogJHtNYXRoLnJvdW5kKGNodW5rU2l6ZSAvICgxMDI0ICogMTAyNCkpfU1CLCB0b3RhbCBjaHVua3M6ICR7TWF0aC5jZWlsKHJlcXVlc3QuZmlsZVNpemUgLyBjaHVua1NpemUpfWApO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coYPCfk6QgW0xhcmdlRmlsZVRyYW5zZmVyXSBJbml0aWFsaXplZCB0cmFuc2ZlciAke3RyYW5zZmVySWR9IGZvciAke3JlcXVlc3QuZmlsZU5hbWV9ICgke01hdGgucm91bmQocmVxdWVzdC5maWxlU2l6ZSAvICgxMDI0ICogMTAyNCkpfU1CKWApO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIHRyYW5zZmVySWRcclxuICAgICAgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbTGFyZ2VGaWxlVHJhbnNmZXJdIEZhaWxlZCB0byBpbml0aWFsaXplIHRyYW5zZmVyOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYEZhaWxlZCB0byBpbml0aWFsaXplIHRyYW5zZmVyOiAke2Vycm9yLm1lc3NhZ2V9YFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH0pO1xyXG4gIFxyXG4gIC8vIFRyYW5zZmVyIGEgY2h1bmsgb2YgYSBsYXJnZSBmaWxlXHJcbiAgaXBjTWFpbi5oYW5kbGUoJ2NvZGV4OmZzOnRyYW5zZmVyLWZpbGUtY2h1bmsnLCBhc3luYyAoZXZlbnQsIHJlcXVlc3QpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICghcmVxdWVzdD8udHJhbnNmZXJJZCB8fCByZXF1ZXN0Py5jaHVua0luZGV4ID09PSB1bmRlZmluZWQgfHwgIXJlcXVlc3Q/LmRhdGEpIHtcclxuICAgICAgICByZXR1cm4geyBcclxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICAgIGVycm9yOiAnSW52YWxpZCByZXF1ZXN0OiB0cmFuc2ZlcklkLCBjaHVua0luZGV4LCBhbmQgZGF0YSBhcmUgcmVxdWlyZWQnIFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIEdldCB0cmFuc2ZlciBpbmZvcm1hdGlvblxyXG4gICAgICBjb25zdCB0cmFuc2ZlciA9IGFjdGl2ZVRyYW5zZmVycy5nZXQocmVxdWVzdC50cmFuc2ZlcklkKTtcclxuICAgICAgaWYgKCF0cmFuc2Zlcikge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgIGVycm9yOiBgVHJhbnNmZXIgbm90IGZvdW5kOiAke3JlcXVlc3QudHJhbnNmZXJJZH1gXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gRGVjb2RlIGJhc2U2NCBkYXRhXHJcbiAgICAgIGNvbnN0IGNodW5rQnVmZmVyID0gQnVmZmVyLmZyb20ocmVxdWVzdC5kYXRhLCAnYmFzZTY0Jyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBWZXJpZnkgY2h1bmsgc2l6ZVxyXG4gICAgICBpZiAoY2h1bmtCdWZmZXIubGVuZ3RoICE9PSByZXF1ZXN0LnNpemUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbTGFyZ2VGaWxlVHJhbnNmZXJdIENodW5rIHNpemUgbWlzbWF0Y2g6IGV4cGVjdGVkICR7cmVxdWVzdC5zaXplfSwgZ290ICR7Y2h1bmtCdWZmZXIubGVuZ3RofWApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBTYXZlIGNodW5rIHRvIHRlbXBvcmFyeSBmaWxlXHJcbiAgICAgIGNvbnN0IGNodW5rUGF0aCA9IHBhdGguam9pbih0cmFuc2Zlci5jaHVua3NEaXIsIGBjaHVua18ke3JlcXVlc3QuY2h1bmtJbmRleH1gKTtcclxuICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKGNodW5rUGF0aCwgY2h1bmtCdWZmZXIpO1xyXG4gICAgICBcclxuICAgICAgLy8gVXBkYXRlIHRyYW5zZmVyIGluZm9ybWF0aW9uXHJcbiAgICAgIHRyYW5zZmVyLmNodW5rcy5zZXQocmVxdWVzdC5jaHVua0luZGV4LCB7XHJcbiAgICAgICAgcGF0aDogY2h1bmtQYXRoLFxyXG4gICAgICAgIHNpemU6IGNodW5rQnVmZmVyLmxlbmd0aFxyXG4gICAgICB9KTtcclxuICAgICAgdHJhbnNmZXIucmVjZWl2ZWRDaHVua3MrKztcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OkIFtMYXJnZUZpbGVUcmFuc2Zlcl0gUmVjZWl2ZWQgY2h1bmsgJHtyZXF1ZXN0LmNodW5rSW5kZXggKyAxfS8ke3RyYW5zZmVyLnRvdGFsQ2h1bmtzfSBmb3IgdHJhbnNmZXIgJHtyZXF1ZXN0LnRyYW5zZmVySWR9ICgke01hdGgucm91bmQoY2h1bmtCdWZmZXIubGVuZ3RoIC8gMTAyNCl9S0IpYCk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgcmVjZWl2ZWRDaHVua3M6IHRyYW5zZmVyLnJlY2VpdmVkQ2h1bmtzLFxyXG4gICAgICAgIHRvdGFsQ2h1bmtzOiB0cmFuc2Zlci50b3RhbENodW5rc1xyXG4gICAgICB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtMYXJnZUZpbGVUcmFuc2Zlcl0gRmFpbGVkIHRvIHRyYW5zZmVyIGNodW5rOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYEZhaWxlZCB0byB0cmFuc2ZlciBjaHVuazogJHtlcnJvci5tZXNzYWdlfWBcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9KTtcclxuICBcclxuICAvLyBGaW5hbGl6ZSBhIGxhcmdlIGZpbGUgdHJhbnNmZXJcclxuICBpcGNNYWluLmhhbmRsZSgnY29kZXg6ZnM6ZmluYWxpemUtbGFyZ2UtZmlsZS10cmFuc2ZlcicsIGFzeW5jIChldmVudCwgcmVxdWVzdCkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgaWYgKCFyZXF1ZXN0Py50cmFuc2ZlcklkKSB7XHJcbiAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSwgXHJcbiAgICAgICAgICBlcnJvcjogJ0ludmFsaWQgcmVxdWVzdDogdHJhbnNmZXJJZCBpcyByZXF1aXJlZCcgXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gR2V0IHRyYW5zZmVyIGluZm9ybWF0aW9uXHJcbiAgICAgIGNvbnN0IHRyYW5zZmVyID0gYWN0aXZlVHJhbnNmZXJzLmdldChyZXF1ZXN0LnRyYW5zZmVySWQpO1xyXG4gICAgICBpZiAoIXRyYW5zZmVyKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgZXJyb3I6IGBUcmFuc2ZlciBub3QgZm91bmQ6ICR7cmVxdWVzdC50cmFuc2ZlcklkfWBcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TpCBbTGFyZ2VGaWxlVHJhbnNmZXJdIEZpbmFsaXppbmcgdHJhbnNmZXIgJHtyZXF1ZXN0LnRyYW5zZmVySWR9OiAke3RyYW5zZmVyLnJlY2VpdmVkQ2h1bmtzfS8ke3RyYW5zZmVyLnRvdGFsQ2h1bmtzfSBjaHVua3MgcmVjZWl2ZWRgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGlmIGFsbCBjaHVua3Mgd2VyZSByZWNlaXZlZFxyXG4gICAgICBpZiAodHJhbnNmZXIucmVjZWl2ZWRDaHVua3MgIT09IHRyYW5zZmVyLnRvdGFsQ2h1bmtzKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgZXJyb3I6IGBJbmNvbXBsZXRlIHRyYW5zZmVyOiByZWNlaXZlZCAke3RyYW5zZmVyLnJlY2VpdmVkQ2h1bmtzfS8ke3RyYW5zZmVyLnRvdGFsQ2h1bmtzfSBjaHVua3NgXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gQ3JlYXRlIG91dHB1dCBmaWxlXHJcbiAgICAgIGNvbnN0IG91dHB1dEZpbGUgPSBhd2FpdCBmcy5vcGVuKHRyYW5zZmVyLnRlbXBGaWxlUGF0aCwgJ3cnKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENvbWJpbmUgY2h1bmtzXHJcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdHJhbnNmZXIudG90YWxDaHVua3M7IGkrKykge1xyXG4gICAgICAgIGNvbnN0IGNodW5rID0gdHJhbnNmZXIuY2h1bmtzLmdldChpKTtcclxuICAgICAgICBpZiAoIWNodW5rKSB7XHJcbiAgICAgICAgICBhd2FpdCBvdXRwdXRGaWxlLmNsb3NlKCk7XHJcbiAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgZXJyb3I6IGBNaXNzaW5nIGNodW5rICR7aX1gXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBSZWFkIGNodW5rXHJcbiAgICAgICAgY29uc3QgY2h1bmtEYXRhID0gYXdhaXQgZnMucmVhZEZpbGUoY2h1bmsucGF0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gV3JpdGUgY2h1bmsgdG8gb3V0cHV0IGZpbGVcclxuICAgICAgICBhd2FpdCBvdXRwdXRGaWxlLndyaXRlKGNodW5rRGF0YSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIENsb3NlIG91dHB1dCBmaWxlXHJcbiAgICAgIGF3YWl0IG91dHB1dEZpbGUuY2xvc2UoKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEdldCBmaWxlIHN0YXRzXHJcbiAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdCh0cmFuc2Zlci50ZW1wRmlsZVBhdGgpO1xyXG4gICAgICBcclxuICAgICAgLy8gVmVyaWZ5IGZpbGUgc2l6ZVxyXG4gICAgICBpZiAoc3RhdHMuc2l6ZSAhPT0gdHJhbnNmZXIuZmlsZVNpemUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbTGFyZ2VGaWxlVHJhbnNmZXJdIEZpbGUgc2l6ZSBtaXNtYXRjaDogZXhwZWN0ZWQgJHt0cmFuc2Zlci5maWxlU2l6ZX0sIGdvdCAke3N0YXRzLnNpemV9YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIENhbGN1bGF0ZSB0cmFuc2ZlciBzcGVlZFxyXG4gICAgICBjb25zdCB0cmFuc2ZlclRpbWUgPSAoRGF0ZS5ub3coKSAtIHRyYW5zZmVyLnN0YXJ0VGltZSkgLyAxMDAwOyAvLyBpbiBzZWNvbmRzXHJcbiAgICAgIGNvbnN0IHRyYW5zZmVyU3BlZWQgPSBNYXRoLnJvdW5kKCh0cmFuc2Zlci5maWxlU2l6ZSAvICgxMDI0ICogMTAyNCkpIC8gdHJhbnNmZXJUaW1lKTsgLy8gaW4gTUIvc1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coYOKchSBbTGFyZ2VGaWxlVHJhbnNmZXJdIFRyYW5zZmVyICR7cmVxdWVzdC50cmFuc2ZlcklkfSBjb21wbGV0ZWQgaW4gJHt0cmFuc2ZlclRpbWUudG9GaXhlZCgyKX1zICgke3RyYW5zZmVyU3BlZWR9TUIvcylgKTtcclxuICAgICAgY29uc29sZS5sb2coYPCfk4EgW0xhcmdlRmlsZVRyYW5zZmVyXSBGaWxlIHNhdmVkIHRvICR7dHJhbnNmZXIudGVtcEZpbGVQYXRofSAoJHtNYXRoLnJvdW5kKHN0YXRzLnNpemUgLyAoMTAyNCAqIDEwMjQpKX1NQilgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENsZWFuIHVwIGNodW5rc1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGZvciAoY29uc3QgY2h1bmsgb2YgdHJhbnNmZXIuY2h1bmtzLnZhbHVlcygpKSB7XHJcbiAgICAgICAgICBhd2FpdCBmcy51bmxpbmsoY2h1bmsucGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGF3YWl0IGZzLnJtZGlyKHRyYW5zZmVyLmNodW5rc0Rpcik7XHJcbiAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFtMYXJnZUZpbGVUcmFuc2Zlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIGNodW5rczpgLCBjbGVhbnVwRXJyb3IpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBSZW1vdmUgdHJhbnNmZXIgZnJvbSBhY3RpdmUgdHJhbnNmZXJzXHJcbiAgICAgIGFjdGl2ZVRyYW5zZmVycy5kZWxldGUocmVxdWVzdC50cmFuc2ZlcklkKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICBmaW5hbFBhdGg6IHRyYW5zZmVyLnRlbXBGaWxlUGF0aCxcclxuICAgICAgICBzaXplOiBzdGF0cy5zaXplLFxyXG4gICAgICAgIHRyYW5zZmVyVGltZSxcclxuICAgICAgICB0cmFuc2ZlclNwZWVkXHJcbiAgICAgIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW0xhcmdlRmlsZVRyYW5zZmVyXSBGYWlsZWQgdG8gZmluYWxpemUgdHJhbnNmZXI6JywgZXJyb3IpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2xlYW4gdXAgdHJhbnNmZXJcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCB0cmFuc2ZlciA9IGFjdGl2ZVRyYW5zZmVycy5nZXQocmVxdWVzdC50cmFuc2ZlcklkKTtcclxuICAgICAgICBpZiAodHJhbnNmZXIpIHtcclxuICAgICAgICAgIC8vIENsZWFuIHVwIGNodW5rc1xyXG4gICAgICAgICAgZm9yIChjb25zdCBjaHVuayBvZiB0cmFuc2Zlci5jaHVua3MudmFsdWVzKCkpIHtcclxuICAgICAgICAgICAgYXdhaXQgZnMudW5saW5rKGNodW5rLnBhdGgpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgYXdhaXQgZnMucm1kaXIodHJhbnNmZXIuY2h1bmtzRGlyKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gUmVtb3ZlIHRyYW5zZmVyIGZyb20gYWN0aXZlIHRyYW5zZmVyc1xyXG4gICAgICAgICAgYWN0aXZlVHJhbnNmZXJzLmRlbGV0ZShyZXF1ZXN0LnRyYW5zZmVySWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gW0xhcmdlRmlsZVRyYW5zZmVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgYWZ0ZXIgZXJyb3I6YCwgY2xlYW51cEVycm9yKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYEZhaWxlZCB0byBmaW5hbGl6ZSB0cmFuc2ZlcjogJHtlcnJvci5tZXNzYWdlfWBcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9KTtcclxufVxyXG5cclxuLyoqXHJcbiAqIENsZWFucyB1cCBhbnkgYWN0aXZlIHRyYW5zZmVyc1xyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gY2xlYW51cExhcmdlRmlsZVRyYW5zZmVycygpIHtcclxuICB0cnkge1xyXG4gICAgZm9yIChjb25zdCBbdHJhbnNmZXJJZCwgdHJhbnNmZXJdIG9mIGFjdGl2ZVRyYW5zZmVycy5lbnRyaWVzKCkpIHtcclxuICAgICAgY29uc29sZS5sb2coYPCfp7kgW0xhcmdlRmlsZVRyYW5zZmVyXSBDbGVhbmluZyB1cCB0cmFuc2ZlciAke3RyYW5zZmVySWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDbGVhbiB1cCBjaHVua3NcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBmb3IgKGNvbnN0IGNodW5rIG9mIHRyYW5zZmVyLmNodW5rcy52YWx1ZXMoKSkge1xyXG4gICAgICAgICAgYXdhaXQgZnMudW5saW5rKGNodW5rLnBhdGgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBhd2FpdCBmcy5ybWRpcih0cmFuc2Zlci5jaHVua3NEaXIpO1xyXG4gICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbTGFyZ2VGaWxlVHJhbnNmZXJdIEZhaWxlZCB0byBjbGVhbiB1cCBjaHVua3M6YCwgY2xlYW51cEVycm9yKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBDbGVhciBhY3RpdmUgdHJhbnNmZXJzXHJcbiAgICBhY3RpdmVUcmFuc2ZlcnMuY2xlYXIoKTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcign4p2MIFtMYXJnZUZpbGVUcmFuc2Zlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIHRyYW5zZmVyczonLCBlcnJvcik7XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHtcclxuICByZWdpc3RlckxhcmdlRmlsZVRyYW5zZmVySGFuZGxlcnMsXHJcbiAgY2xlYW51cExhcmdlRmlsZVRyYW5zZmVyc1xyXG59O1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNO0VBQUVBO0FBQVEsQ0FBQyxHQUFHQyxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ3ZDLE1BQU1DLEVBQUUsR0FBR0QsT0FBTyxDQUFDLGFBQWEsQ0FBQztBQUNqQyxNQUFNRSxJQUFJLEdBQUdGLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTTtFQUFFRyxFQUFFLEVBQUVDO0FBQU8sQ0FBQyxHQUFHSixPQUFPLENBQUMsTUFBTSxDQUFDO0FBQ3RDLE1BQU07RUFBRUssUUFBUSxFQUFFQztBQUFrQixDQUFDLEdBQUdOLE9BQU8sQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDLENBQUM7O0FBRXhGO0FBQ0EsTUFBTU8sZUFBZSxHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDOztBQUVqQztBQUNBO0FBQ0E7QUFDQSxTQUFTQyxp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