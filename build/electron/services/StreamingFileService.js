"use strict";

/**
 * StreamingFileService.js
 * Handles streaming of large files for conversion processing.
 * Uses Node.js streams to efficiently handle large files without loading them entirely into memory.
 * 
 * Related files:
 * - src/electron/services/FileSystemService.js: Base file system operations
 * - src/electron/services/ElectronConversionService.js: Main conversion service
 * - src/electron/adapters/videoConverterAdapter.js: Video processing
 */

const fs = require('fs');
const {
  createReadStream
} = require('fs');
const {
  Readable
} = require('stream');
const {
  pipeline
} = require('stream/promises');
const path = require('path');
const FileSystemService = require('./FileSystemService');
class StreamingFileService {
  constructor() {
    this.chunkSize = 1024 * 1024; // 1MB chunks for reading
    this.fileSystem = FileSystemService;
  }

  /**
   * Stream a file in chunks
   * @param {string} filePath - Path to the file
   * @param {Object} options - Streaming options
   * @param {function} options.onChunk - Callback for each chunk
   * @param {function} options.onProgress - Progress callback
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async streamFile(filePath, options = {}) {
    try {
      // Validate path
      const validPath = await this.fileSystem.validatePath(filePath);
      const stats = await fs.promises.stat(validPath);
      if (!stats.isFile()) {
        throw new Error('Not a file');
      }
      const fileSize = stats.size;
      let bytesRead = 0;
      let lastProgressUpdate = Date.now();
      const progressInterval = 250; // 250ms between progress updates

      // Create read stream
      const readStream = createReadStream(validPath, {
        highWaterMark: this.chunkSize
      });

      // Process chunks
      readStream.on('data', chunk => {
        bytesRead += chunk.length;

        // Call chunk processor if provided
        if (options.onChunk) {
          options.onChunk(chunk);
        }

        // Update progress at intervals
        const now = Date.now();
        if (options.onProgress && now - lastProgressUpdate >= progressInterval) {
          const progress = bytesRead / fileSize * 100;
          options.onProgress(progress);
          lastProgressUpdate = now;
        }
      });

      // Wait for stream to complete
      await new Promise((resolve, reject) => {
        readStream.on('end', resolve);
        readStream.on('error', reject);
      });
      return {
        success: true
      };
    } catch (error) {
      console.error('Streaming error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Creates a readable stream from a buffer
   * @param {Buffer} buffer - Buffer to stream
   * @returns {Readable} Node.js readable stream
   */
  createBufferStream(buffer) {
    return Readable.from(buffer);
  }

  /**
   * Process a video file in streaming mode
   * @param {string} filePath - Path to the video file
   * @param {Object} options - Processing options
   * @returns {Promise<{buffer: Buffer, type: string}>}
   */
  async processVideoFile(filePath, options = {}) {
    const chunks = [];
    let totalSize = 0;
    const originalOnProgress = options.onProgress;

    // First phase: Reading file (0-50% of progress)
    await this.streamFile(filePath, {
      onChunk: chunk => {
        chunks.push(chunk);
        totalSize += chunk.length;
      },
      onProgress: progress => {
        // Scale progress to 0-50% range
        if (originalOnProgress) {
          originalOnProgress(progress * 0.5);

          // Add phase information to the progress event
          if (originalOnProgress.reportPhase) {
            originalOnProgress.reportPhase('reading');
          }
        }
      }
    });

    // Create buffer from chunks
    const buffer = Buffer.concat(chunks, totalSize);
    const fileType = path.extname(filePath).slice(1).toLowerCase();
    return {
      buffer,
      type: fileType
    };
  }
}
module.exports = new StreamingFileService();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJjcmVhdGVSZWFkU3RyZWFtIiwiUmVhZGFibGUiLCJwaXBlbGluZSIsInBhdGgiLCJGaWxlU3lzdGVtU2VydmljZSIsIlN0cmVhbWluZ0ZpbGVTZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJjaHVua1NpemUiLCJmaWxlU3lzdGVtIiwic3RyZWFtRmlsZSIsImZpbGVQYXRoIiwib3B0aW9ucyIsInZhbGlkUGF0aCIsInZhbGlkYXRlUGF0aCIsInN0YXRzIiwicHJvbWlzZXMiLCJzdGF0IiwiaXNGaWxlIiwiRXJyb3IiLCJmaWxlU2l6ZSIsInNpemUiLCJieXRlc1JlYWQiLCJsYXN0UHJvZ3Jlc3NVcGRhdGUiLCJEYXRlIiwibm93IiwicHJvZ3Jlc3NJbnRlcnZhbCIsInJlYWRTdHJlYW0iLCJoaWdoV2F0ZXJNYXJrIiwib24iLCJjaHVuayIsImxlbmd0aCIsIm9uQ2h1bmsiLCJvblByb2dyZXNzIiwicHJvZ3Jlc3MiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInN1Y2Nlc3MiLCJlcnJvciIsImNvbnNvbGUiLCJtZXNzYWdlIiwiY3JlYXRlQnVmZmVyU3RyZWFtIiwiYnVmZmVyIiwiZnJvbSIsInByb2Nlc3NWaWRlb0ZpbGUiLCJjaHVua3MiLCJ0b3RhbFNpemUiLCJvcmlnaW5hbE9uUHJvZ3Jlc3MiLCJwdXNoIiwicmVwb3J0UGhhc2UiLCJCdWZmZXIiLCJjb25jYXQiLCJmaWxlVHlwZSIsImV4dG5hbWUiLCJzbGljZSIsInRvTG93ZXJDYXNlIiwidHlwZSIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvU3RyZWFtaW5nRmlsZVNlcnZpY2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFN0cmVhbWluZ0ZpbGVTZXJ2aWNlLmpzXHJcbiAqIEhhbmRsZXMgc3RyZWFtaW5nIG9mIGxhcmdlIGZpbGVzIGZvciBjb252ZXJzaW9uIHByb2Nlc3NpbmcuXHJcbiAqIFVzZXMgTm9kZS5qcyBzdHJlYW1zIHRvIGVmZmljaWVudGx5IGhhbmRsZSBsYXJnZSBmaWxlcyB3aXRob3V0IGxvYWRpbmcgdGhlbSBlbnRpcmVseSBpbnRvIG1lbW9yeS5cclxuICogXHJcbiAqIFJlbGF0ZWQgZmlsZXM6XHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0ZpbGVTeXN0ZW1TZXJ2aWNlLmpzOiBCYXNlIGZpbGUgc3lzdGVtIG9wZXJhdGlvbnNcclxuICogLSBzcmMvZWxlY3Ryb24vc2VydmljZXMvRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZS5qczogTWFpbiBjb252ZXJzaW9uIHNlcnZpY2VcclxuICogLSBzcmMvZWxlY3Ryb24vYWRhcHRlcnMvdmlkZW9Db252ZXJ0ZXJBZGFwdGVyLmpzOiBWaWRlbyBwcm9jZXNzaW5nXHJcbiAqL1xyXG5cclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcycpO1xyXG5jb25zdCB7IGNyZWF0ZVJlYWRTdHJlYW0gfSA9IHJlcXVpcmUoJ2ZzJyk7XHJcbmNvbnN0IHsgUmVhZGFibGUgfSA9IHJlcXVpcmUoJ3N0cmVhbScpO1xyXG5jb25zdCB7IHBpcGVsaW5lIH0gPSByZXF1aXJlKCdzdHJlYW0vcHJvbWlzZXMnKTtcclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgRmlsZVN5c3RlbVNlcnZpY2UgPSByZXF1aXJlKCcuL0ZpbGVTeXN0ZW1TZXJ2aWNlJyk7XHJcblxyXG5jbGFzcyBTdHJlYW1pbmdGaWxlU2VydmljZSB7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmNodW5rU2l6ZSA9IDEwMjQgKiAxMDI0OyAvLyAxTUIgY2h1bmtzIGZvciByZWFkaW5nXHJcbiAgICB0aGlzLmZpbGVTeXN0ZW0gPSBGaWxlU3lzdGVtU2VydmljZTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFN0cmVhbSBhIGZpbGUgaW4gY2h1bmtzXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgZmlsZVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gU3RyZWFtaW5nIG9wdGlvbnNcclxuICAgKiBAcGFyYW0ge2Z1bmN0aW9ufSBvcHRpb25zLm9uQ2h1bmsgLSBDYWxsYmFjayBmb3IgZWFjaCBjaHVua1xyXG4gICAqIEBwYXJhbSB7ZnVuY3Rpb259IG9wdGlvbnMub25Qcm9ncmVzcyAtIFByb2dyZXNzIGNhbGxiYWNrXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8e3N1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogc3RyaW5nfT59XHJcbiAgICovXHJcbiAgYXN5bmMgc3RyZWFtRmlsZShmaWxlUGF0aCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBWYWxpZGF0ZSBwYXRoXHJcbiAgICAgIGNvbnN0IHZhbGlkUGF0aCA9IGF3YWl0IHRoaXMuZmlsZVN5c3RlbS52YWxpZGF0ZVBhdGgoZmlsZVBhdGgpO1xyXG4gICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnByb21pc2VzLnN0YXQodmFsaWRQYXRoKTtcclxuXHJcbiAgICAgIGlmICghc3RhdHMuaXNGaWxlKCkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vdCBhIGZpbGUnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgZmlsZVNpemUgPSBzdGF0cy5zaXplO1xyXG4gICAgICBsZXQgYnl0ZXNSZWFkID0gMDtcclxuICAgICAgbGV0IGxhc3RQcm9ncmVzc1VwZGF0ZSA9IERhdGUubm93KCk7XHJcbiAgICAgIGNvbnN0IHByb2dyZXNzSW50ZXJ2YWwgPSAyNTA7IC8vIDI1MG1zIGJldHdlZW4gcHJvZ3Jlc3MgdXBkYXRlc1xyXG5cclxuICAgICAgLy8gQ3JlYXRlIHJlYWQgc3RyZWFtXHJcbiAgICAgIGNvbnN0IHJlYWRTdHJlYW0gPSBjcmVhdGVSZWFkU3RyZWFtKHZhbGlkUGF0aCwge1xyXG4gICAgICAgIGhpZ2hXYXRlck1hcms6IHRoaXMuY2h1bmtTaXplXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gUHJvY2VzcyBjaHVua3NcclxuICAgICAgcmVhZFN0cmVhbS5vbignZGF0YScsIChjaHVuaykgPT4ge1xyXG4gICAgICAgIGJ5dGVzUmVhZCArPSBjaHVuay5sZW5ndGg7XHJcblxyXG4gICAgICAgIC8vIENhbGwgY2h1bmsgcHJvY2Vzc29yIGlmIHByb3ZpZGVkXHJcbiAgICAgICAgaWYgKG9wdGlvbnMub25DaHVuaykge1xyXG4gICAgICAgICAgb3B0aW9ucy5vbkNodW5rKGNodW5rKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFVwZGF0ZSBwcm9ncmVzcyBhdCBpbnRlcnZhbHNcclxuICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xyXG4gICAgICAgIGlmIChvcHRpb25zLm9uUHJvZ3Jlc3MgJiYgbm93IC0gbGFzdFByb2dyZXNzVXBkYXRlID49IHByb2dyZXNzSW50ZXJ2YWwpIHtcclxuICAgICAgICAgIGNvbnN0IHByb2dyZXNzID0gKGJ5dGVzUmVhZCAvIGZpbGVTaXplKSAqIDEwMDtcclxuICAgICAgICAgIG9wdGlvbnMub25Qcm9ncmVzcyhwcm9ncmVzcyk7XHJcbiAgICAgICAgICBsYXN0UHJvZ3Jlc3NVcGRhdGUgPSBub3c7XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIFdhaXQgZm9yIHN0cmVhbSB0byBjb21wbGV0ZVxyXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgICAgcmVhZFN0cmVhbS5vbignZW5kJywgcmVzb2x2ZSk7XHJcbiAgICAgICAgcmVhZFN0cmVhbS5vbignZXJyb3InLCByZWplY3QpO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdTdHJlYW1pbmcgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGVzIGEgcmVhZGFibGUgc3RyZWFtIGZyb20gYSBidWZmZXJcclxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gYnVmZmVyIC0gQnVmZmVyIHRvIHN0cmVhbVxyXG4gICAqIEByZXR1cm5zIHtSZWFkYWJsZX0gTm9kZS5qcyByZWFkYWJsZSBzdHJlYW1cclxuICAgKi9cclxuICBjcmVhdGVCdWZmZXJTdHJlYW0oYnVmZmVyKSB7XHJcbiAgICByZXR1cm4gUmVhZGFibGUuZnJvbShidWZmZXIpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUHJvY2VzcyBhIHZpZGVvIGZpbGUgaW4gc3RyZWFtaW5nIG1vZGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIHRoZSB2aWRlbyBmaWxlXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBQcm9jZXNzaW5nIG9wdGlvbnNcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7YnVmZmVyOiBCdWZmZXIsIHR5cGU6IHN0cmluZ30+fVxyXG4gICAqL1xyXG4gIGFzeW5jIHByb2Nlc3NWaWRlb0ZpbGUoZmlsZVBhdGgsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgY29uc3QgY2h1bmtzID0gW107XHJcbiAgICBsZXQgdG90YWxTaXplID0gMDtcclxuICAgIGNvbnN0IG9yaWdpbmFsT25Qcm9ncmVzcyA9IG9wdGlvbnMub25Qcm9ncmVzcztcclxuICAgIFxyXG4gICAgLy8gRmlyc3QgcGhhc2U6IFJlYWRpbmcgZmlsZSAoMC01MCUgb2YgcHJvZ3Jlc3MpXHJcbiAgICBhd2FpdCB0aGlzLnN0cmVhbUZpbGUoZmlsZVBhdGgsIHtcclxuICAgICAgb25DaHVuazogKGNodW5rKSA9PiB7XHJcbiAgICAgICAgY2h1bmtzLnB1c2goY2h1bmspO1xyXG4gICAgICAgIHRvdGFsU2l6ZSArPSBjaHVuay5sZW5ndGg7XHJcbiAgICAgIH0sXHJcbiAgICAgIG9uUHJvZ3Jlc3M6IChwcm9ncmVzcykgPT4ge1xyXG4gICAgICAgIC8vIFNjYWxlIHByb2dyZXNzIHRvIDAtNTAlIHJhbmdlXHJcbiAgICAgICAgaWYgKG9yaWdpbmFsT25Qcm9ncmVzcykge1xyXG4gICAgICAgICAgb3JpZ2luYWxPblByb2dyZXNzKHByb2dyZXNzICogMC41KTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gQWRkIHBoYXNlIGluZm9ybWF0aW9uIHRvIHRoZSBwcm9ncmVzcyBldmVudFxyXG4gICAgICAgICAgaWYgKG9yaWdpbmFsT25Qcm9ncmVzcy5yZXBvcnRQaGFzZSkge1xyXG4gICAgICAgICAgICBvcmlnaW5hbE9uUHJvZ3Jlc3MucmVwb3J0UGhhc2UoJ3JlYWRpbmcnKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBDcmVhdGUgYnVmZmVyIGZyb20gY2h1bmtzXHJcbiAgICBjb25zdCBidWZmZXIgPSBCdWZmZXIuY29uY2F0KGNodW5rcywgdG90YWxTaXplKTtcclxuICAgIGNvbnN0IGZpbGVUeXBlID0gcGF0aC5leHRuYW1lKGZpbGVQYXRoKS5zbGljZSgxKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBidWZmZXIsXHJcbiAgICAgIHR5cGU6IGZpbGVUeXBlXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBuZXcgU3RyZWFtaW5nRmlsZVNlcnZpY2UoKTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLEVBQUUsR0FBR0MsT0FBTyxDQUFDLElBQUksQ0FB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