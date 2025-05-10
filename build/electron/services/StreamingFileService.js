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
const {
  instance: FileSystemService
} = require('./FileSystemService'); // Import instance

class StreamingFileService {
  constructor() {
    this.chunkSize = 1024 * 1024; // 1MB chunks for reading
    this.fileSystem = FileSystemService; // Use the imported instance
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJjcmVhdGVSZWFkU3RyZWFtIiwiUmVhZGFibGUiLCJwaXBlbGluZSIsInBhdGgiLCJpbnN0YW5jZSIsIkZpbGVTeXN0ZW1TZXJ2aWNlIiwiU3RyZWFtaW5nRmlsZVNlcnZpY2UiLCJjb25zdHJ1Y3RvciIsImNodW5rU2l6ZSIsImZpbGVTeXN0ZW0iLCJzdHJlYW1GaWxlIiwiZmlsZVBhdGgiLCJvcHRpb25zIiwidmFsaWRQYXRoIiwidmFsaWRhdGVQYXRoIiwic3RhdHMiLCJwcm9taXNlcyIsInN0YXQiLCJpc0ZpbGUiLCJFcnJvciIsImZpbGVTaXplIiwic2l6ZSIsImJ5dGVzUmVhZCIsImxhc3RQcm9ncmVzc1VwZGF0ZSIsIkRhdGUiLCJub3ciLCJwcm9ncmVzc0ludGVydmFsIiwicmVhZFN0cmVhbSIsImhpZ2hXYXRlck1hcmsiLCJvbiIsImNodW5rIiwibGVuZ3RoIiwib25DaHVuayIsIm9uUHJvZ3Jlc3MiLCJwcm9ncmVzcyIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0Iiwic3VjY2VzcyIsImVycm9yIiwiY29uc29sZSIsIm1lc3NhZ2UiLCJjcmVhdGVCdWZmZXJTdHJlYW0iLCJidWZmZXIiLCJmcm9tIiwicHJvY2Vzc1ZpZGVvRmlsZSIsImNodW5rcyIsInRvdGFsU2l6ZSIsIm9yaWdpbmFsT25Qcm9ncmVzcyIsInB1c2giLCJyZXBvcnRQaGFzZSIsIkJ1ZmZlciIsImNvbmNhdCIsImZpbGVUeXBlIiwiZXh0bmFtZSIsInNsaWNlIiwidG9Mb3dlckNhc2UiLCJ0eXBlIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9TdHJlYW1pbmdGaWxlU2VydmljZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogU3RyZWFtaW5nRmlsZVNlcnZpY2UuanNcclxuICogSGFuZGxlcyBzdHJlYW1pbmcgb2YgbGFyZ2UgZmlsZXMgZm9yIGNvbnZlcnNpb24gcHJvY2Vzc2luZy5cclxuICogVXNlcyBOb2RlLmpzIHN0cmVhbXMgdG8gZWZmaWNpZW50bHkgaGFuZGxlIGxhcmdlIGZpbGVzIHdpdGhvdXQgbG9hZGluZyB0aGVtIGVudGlyZWx5IGludG8gbWVtb3J5LlxyXG4gKiBcclxuICogUmVsYXRlZCBmaWxlczpcclxuICogLSBzcmMvZWxlY3Ryb24vc2VydmljZXMvRmlsZVN5c3RlbVNlcnZpY2UuanM6IEJhc2UgZmlsZSBzeXN0ZW0gb3BlcmF0aW9uc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9FbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmpzOiBNYWluIGNvbnZlcnNpb24gc2VydmljZVxyXG4gKiAtIHNyYy9lbGVjdHJvbi9hZGFwdGVycy92aWRlb0NvbnZlcnRlckFkYXB0ZXIuanM6IFZpZGVvIHByb2Nlc3NpbmdcclxuICovXHJcblxyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XHJcbmNvbnN0IHsgY3JlYXRlUmVhZFN0cmVhbSB9ID0gcmVxdWlyZSgnZnMnKTtcclxuY29uc3QgeyBSZWFkYWJsZSB9ID0gcmVxdWlyZSgnc3RyZWFtJyk7XHJcbmNvbnN0IHsgcGlwZWxpbmUgfSA9IHJlcXVpcmUoJ3N0cmVhbS9wcm9taXNlcycpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IGluc3RhbmNlOiBGaWxlU3lzdGVtU2VydmljZSB9ID0gcmVxdWlyZSgnLi9GaWxlU3lzdGVtU2VydmljZScpOyAvLyBJbXBvcnQgaW5zdGFuY2VcclxuXHJcbmNsYXNzIFN0cmVhbWluZ0ZpbGVTZXJ2aWNlIHtcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuY2h1bmtTaXplID0gMTAyNCAqIDEwMjQ7IC8vIDFNQiBjaHVua3MgZm9yIHJlYWRpbmdcclxuICAgIHRoaXMuZmlsZVN5c3RlbSA9IEZpbGVTeXN0ZW1TZXJ2aWNlOyAvLyBVc2UgdGhlIGltcG9ydGVkIGluc3RhbmNlXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTdHJlYW0gYSBmaWxlIGluIGNodW5rc1xyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gdGhlIGZpbGVcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIFN0cmVhbWluZyBvcHRpb25zXHJcbiAgICogQHBhcmFtIHtmdW5jdGlvbn0gb3B0aW9ucy5vbkNodW5rIC0gQ2FsbGJhY2sgZm9yIGVhY2ggY2h1bmtcclxuICAgKiBAcGFyYW0ge2Z1bmN0aW9ufSBvcHRpb25zLm9uUHJvZ3Jlc3MgLSBQcm9ncmVzcyBjYWxsYmFja1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzdWNjZXNzOiBib29sZWFuLCBlcnJvcj86IHN0cmluZ30+fVxyXG4gICAqL1xyXG4gIGFzeW5jIHN0cmVhbUZpbGUoZmlsZVBhdGgsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVmFsaWRhdGUgcGF0aFxyXG4gICAgICBjb25zdCB2YWxpZFBhdGggPSBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0udmFsaWRhdGVQYXRoKGZpbGVQYXRoKTtcclxuICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5wcm9taXNlcy5zdGF0KHZhbGlkUGF0aCk7XHJcblxyXG4gICAgICBpZiAoIXN0YXRzLmlzRmlsZSgpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdOb3QgYSBmaWxlJyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGZpbGVTaXplID0gc3RhdHMuc2l6ZTtcclxuICAgICAgbGV0IGJ5dGVzUmVhZCA9IDA7XHJcbiAgICAgIGxldCBsYXN0UHJvZ3Jlc3NVcGRhdGUgPSBEYXRlLm5vdygpO1xyXG4gICAgICBjb25zdCBwcm9ncmVzc0ludGVydmFsID0gMjUwOyAvLyAyNTBtcyBiZXR3ZWVuIHByb2dyZXNzIHVwZGF0ZXNcclxuXHJcbiAgICAgIC8vIENyZWF0ZSByZWFkIHN0cmVhbVxyXG4gICAgICBjb25zdCByZWFkU3RyZWFtID0gY3JlYXRlUmVhZFN0cmVhbSh2YWxpZFBhdGgsIHtcclxuICAgICAgICBoaWdoV2F0ZXJNYXJrOiB0aGlzLmNodW5rU2l6ZVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIFByb2Nlc3MgY2h1bmtzXHJcbiAgICAgIHJlYWRTdHJlYW0ub24oJ2RhdGEnLCAoY2h1bmspID0+IHtcclxuICAgICAgICBieXRlc1JlYWQgKz0gY2h1bmsubGVuZ3RoO1xyXG5cclxuICAgICAgICAvLyBDYWxsIGNodW5rIHByb2Nlc3NvciBpZiBwcm92aWRlZFxyXG4gICAgICAgIGlmIChvcHRpb25zLm9uQ2h1bmspIHtcclxuICAgICAgICAgIG9wdGlvbnMub25DaHVuayhjaHVuayk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBVcGRhdGUgcHJvZ3Jlc3MgYXQgaW50ZXJ2YWxzXHJcbiAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcclxuICAgICAgICBpZiAob3B0aW9ucy5vblByb2dyZXNzICYmIG5vdyAtIGxhc3RQcm9ncmVzc1VwZGF0ZSA+PSBwcm9ncmVzc0ludGVydmFsKSB7XHJcbiAgICAgICAgICBjb25zdCBwcm9ncmVzcyA9IChieXRlc1JlYWQgLyBmaWxlU2l6ZSkgKiAxMDA7XHJcbiAgICAgICAgICBvcHRpb25zLm9uUHJvZ3Jlc3MocHJvZ3Jlc3MpO1xyXG4gICAgICAgICAgbGFzdFByb2dyZXNzVXBkYXRlID0gbm93O1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBXYWl0IGZvciBzdHJlYW0gdG8gY29tcGxldGVcclxuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgIHJlYWRTdHJlYW0ub24oJ2VuZCcsIHJlc29sdmUpO1xyXG4gICAgICAgIHJlYWRTdHJlYW0ub24oJ2Vycm9yJywgcmVqZWN0KTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignU3RyZWFtaW5nIGVycm9yOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZVxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlcyBhIHJlYWRhYmxlIHN0cmVhbSBmcm9tIGEgYnVmZmVyXHJcbiAgICogQHBhcmFtIHtCdWZmZXJ9IGJ1ZmZlciAtIEJ1ZmZlciB0byBzdHJlYW1cclxuICAgKiBAcmV0dXJucyB7UmVhZGFibGV9IE5vZGUuanMgcmVhZGFibGUgc3RyZWFtXHJcbiAgICovXHJcbiAgY3JlYXRlQnVmZmVyU3RyZWFtKGJ1ZmZlcikge1xyXG4gICAgcmV0dXJuIFJlYWRhYmxlLmZyb20oYnVmZmVyKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFByb2Nlc3MgYSB2aWRlbyBmaWxlIGluIHN0cmVhbWluZyBtb2RlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgdmlkZW8gZmlsZVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gUHJvY2Vzc2luZyBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8e2J1ZmZlcjogQnVmZmVyLCB0eXBlOiBzdHJpbmd9Pn1cclxuICAgKi9cclxuICBhc3luYyBwcm9jZXNzVmlkZW9GaWxlKGZpbGVQYXRoLCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnN0IGNodW5rcyA9IFtdO1xyXG4gICAgbGV0IHRvdGFsU2l6ZSA9IDA7XHJcbiAgICBjb25zdCBvcmlnaW5hbE9uUHJvZ3Jlc3MgPSBvcHRpb25zLm9uUHJvZ3Jlc3M7XHJcbiAgICBcclxuICAgIC8vIEZpcnN0IHBoYXNlOiBSZWFkaW5nIGZpbGUgKDAtNTAlIG9mIHByb2dyZXNzKVxyXG4gICAgYXdhaXQgdGhpcy5zdHJlYW1GaWxlKGZpbGVQYXRoLCB7XHJcbiAgICAgIG9uQ2h1bms6IChjaHVuaykgPT4ge1xyXG4gICAgICAgIGNodW5rcy5wdXNoKGNodW5rKTtcclxuICAgICAgICB0b3RhbFNpemUgKz0gY2h1bmsubGVuZ3RoO1xyXG4gICAgICB9LFxyXG4gICAgICBvblByb2dyZXNzOiAocHJvZ3Jlc3MpID0+IHtcclxuICAgICAgICAvLyBTY2FsZSBwcm9ncmVzcyB0byAwLTUwJSByYW5nZVxyXG4gICAgICAgIGlmIChvcmlnaW5hbE9uUHJvZ3Jlc3MpIHtcclxuICAgICAgICAgIG9yaWdpbmFsT25Qcm9ncmVzcyhwcm9ncmVzcyAqIDAuNSk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIEFkZCBwaGFzZSBpbmZvcm1hdGlvbiB0byB0aGUgcHJvZ3Jlc3MgZXZlbnRcclxuICAgICAgICAgIGlmIChvcmlnaW5hbE9uUHJvZ3Jlc3MucmVwb3J0UGhhc2UpIHtcclxuICAgICAgICAgICAgb3JpZ2luYWxPblByb2dyZXNzLnJlcG9ydFBoYXNlKCdyZWFkaW5nJyk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gQ3JlYXRlIGJ1ZmZlciBmcm9tIGNodW5rc1xyXG4gICAgY29uc3QgYnVmZmVyID0gQnVmZmVyLmNvbmNhdChjaHVua3MsIHRvdGFsU2l6ZSk7XHJcbiAgICBjb25zdCBmaWxlVHlwZSA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkuc2xpY2UoMSkudG9Mb3dlckNhc2UoKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgYnVmZmVyLFxyXG4gICAgICB0eXBlOiBmaWxlVHlwZVxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gbmV3IFN0cmVhbWluZ0ZpbGVTZXJ2aWNlKCk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFD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QUNELEtBQUssQ0FBQyxrQkFBa0IsRUFBRUEsS0FBSyxDQUFDO01BQ3hDLE9BQU87UUFDTEQsT0FBTyxFQUFFLEtBQUs7UUFDZEMsS0FBSyxFQUFFQSxLQUFLLENBQUNFO01BQ2YsQ0FBQztJQUNIO0VBQ0Y7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtFQUNFQyxrQkFBa0JBLENBQUNDLE1BQU0sRUFBRTtJQUN6QixPQUFPMUMsUUFBUSxDQUFDMkMsSUFBSSxDQUFDRCxNQUFNLENBQUM7RUFDOUI7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsTUFBTUUsZ0JBQWdCQSxDQUFDbEMsUUFBUSxFQUFFQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLEVBQUU7SUFDN0MsTUFBTWtDLE1BQU0sR0FBRyxFQUFFO0lBQ2pCLElBQUlDLFNBQVMsR0FBRyxDQUFDO0lBQ2pCLE1BQU1DLGtCQUFrQixHQUFHcEMsT0FBTyxDQUFDcUIsVUFBVTs7SUFFN0M7SUFDQSxNQUFNLElBQUksQ0FBQ3ZCLFVBQVUsQ0FBQ0MsUUFBUSxFQUFFO01BQzlCcUIsT0FBTyxFQUFHRixLQUFLLElBQUs7UUFDbEJnQixNQUFNLENBQUNHLElBQUksQ0FBQ25CLEtBQUssQ0FBQztRQUNsQmlCLFNBQVMsSUFBSWpCLEtBQUssQ0FBQ0MsTUFBTTtNQUMzQixDQUFDO01BQ0RFLFVBQVUsRUFBR0MsUUFBUSxJQUFLO1FBQ3hCO1FBQ0EsSUFBSWMsa0JBQWtCLEVBQUU7VUFDdEJBLGtCQUFrQixDQUFDZCxRQUFRLEdBQUcsR0FBRyxDQUFDOztVQUVsQztVQUNBLElBQUljLGtCQUFrQixDQUFDRSxXQUFXLEVBQUU7WUFDbENGLGtCQUFrQixDQUFDRSxXQUFXLENBQUMsU0FBUyxDQUFDO1VBQzNDO1FBQ0Y7TUFDRjtJQUNGLENBQUMsQ0FBQzs7SUFFRjtJQUNBLE1BQU1QLE1BQU0sR0FBR1EsTUFBTSxDQUFDQyxNQUFNLENBQUNOLE1BQU0sRUFBRUMsU0FBUyxDQUFDO0lBQy9DLE1BQU1NLFFBQVEsR0FBR2xELElBQUksQ0FBQ21ELE9BQU8sQ0FBQzNDLFFBQVEsQ0FBQyxDQUFDNEMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztJQUU5RCxPQUFPO01BQ0xiLE1BQU07TUFDTmMsSUFBSSxFQUFFSjtJQUNSLENBQUM7RUFDSDtBQUNGO0FBRUFLLE1BQU0sQ0FBQ0MsT0FBTyxHQUFHLElBQUlyRCxvQkFBb0IsQ0FBQyxDQUFDIiwiaWdub3JlTGlzdCI6W119