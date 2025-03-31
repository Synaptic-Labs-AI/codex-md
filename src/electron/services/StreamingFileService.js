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
const { createReadStream } = require('fs');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
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
      readStream.on('data', (chunk) => {
        bytesRead += chunk.length;

        // Call chunk processor if provided
        if (options.onChunk) {
          options.onChunk(chunk);
        }

        // Update progress at intervals
        const now = Date.now();
        if (options.onProgress && now - lastProgressUpdate >= progressInterval) {
          const progress = (bytesRead / fileSize) * 100;
          options.onProgress(progress);
          lastProgressUpdate = now;
        }
      });

      // Wait for stream to complete
      await new Promise((resolve, reject) => {
        readStream.on('end', resolve);
        readStream.on('error', reject);
      });

      return { success: true };

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

    await this.streamFile(filePath, {
      onChunk: (chunk) => {
        chunks.push(chunk);
        totalSize += chunk.length;
      },
      onProgress: options.onProgress
    });

    return {
      buffer: Buffer.concat(chunks, totalSize),
      type: path.extname(filePath).slice(1).toLowerCase()
    };
  }
}

module.exports = new StreamingFileService();
