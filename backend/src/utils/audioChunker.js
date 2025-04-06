import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobe from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
import { Readable } from 'stream';
import { promises as fs } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import os from 'os';

export class AudioChunker {
  constructor(options = {}) {
    // Configure ffmpeg path
    ffmpeg.setFfmpegPath(ffmpegStatic);

    this.chunkSize = options.chunkSize || 24 * 1024 * 1024; // 24MB default
    this.overlapSeconds = options.overlapSeconds || 2;
    this.tempDir = path.join(os.tmpdir(), 'audio-chunks');
  }

  /**
   * Split audio into chunks with progress tracking
   * @param {string} inputPath - Path to the audio file to split
   * @param {Object} options - Options for splitting
   * @param {Function} options.onProgress - Progress callback
   * @returns {Promise<{paths: Array<string>, cleanup: Function}>} Array of chunk file paths and cleanup function
   */
  async splitAudio(inputPath, options = {}) {
    // Create a unique temp directory for this chunking operation
    const chunkDir = path.join(this.tempDir, uuidv4());
    const chunkPaths = [];

    try {
      // Ensure temp directories exist
      await fs.mkdir(this.tempDir, { recursive: true });
      await fs.mkdir(chunkDir, { recursive: true });

      // Verify file exists
      try {
        await fs.access(inputPath);
      } catch (error) {
        throw new Error(`Cannot access audio file at ${inputPath}`);
      }

      // Get audio duration
      const duration = await this.getAudioDuration(inputPath);
      
      // Calculate optimal chunk sizes
      const chunks = this.calculateChunks(duration);
      
      // Track progress
      let processedChunks = 0;
      const totalChunks = chunks.length;
      
      // Process chunks sequentially to track progress
      for (const { start, duration } of chunks) {
        const chunkPath = path.join(chunkDir, `chunk_${processedChunks + 1}.mp3`);
        await this.extractChunkToFile(inputPath, start, duration, chunkPath);
        chunkPaths.push(chunkPath);
        
        // Update progress
        processedChunks++;
        const progress = (processedChunks / totalChunks) * 100;
        
        if (options.onProgress) {
          options.onProgress(progress);
          options.onProgress.reportPhase?.('chunking');
        }
      }

      // Create cleanup function
      const cleanup = async () => {
        try {
          await fs.rm(chunkDir, { recursive: true, force: true });
          console.log('Cleaned up chunk directory:', chunkDir);
        } catch (cleanupError) {
          console.warn('Failed to cleanup chunk files:', cleanupError);
        }
      };

      return { paths: chunkPaths, cleanup };
    } catch (error) {
      console.error('Error splitting audio:', error);
      throw error;
    }
  }

  async getAudioDuration(filePath) {
    try {
      const info = await ffprobe(filePath, { path: ffprobeStatic.path });
      if (!info.streams || !info.streams[0]) {
        throw new Error('No media streams found');
      }
      return info.streams[0].duration;
    } catch (error) {
      console.error('Error getting audio duration:', error);
      throw new Error(`Failed to get audio duration: ${error.message}`);
    }
  }

  calculateChunks(totalDuration) {
    const chunks = [];
    let currentTime = 0;

    while (currentTime < totalDuration) {
      // Calculate chunk duration based on typical audio bitrate
      const chunkDuration = Math.min(
        (this.chunkSize / (128 * 1024)) * 8, // Assuming 128kbps bitrate
        totalDuration - currentTime + this.overlapSeconds
      );

      chunks.push({
        start: Math.max(0, currentTime - this.overlapSeconds),
        duration: chunkDuration
      });

      currentTime += chunkDuration - this.overlapSeconds;
    }

    return chunks;
  }

  /**
   * Extract a chunk of audio to a file
   * @param {string} inputPath - Path to input audio file
   * @param {number} start - Start time in seconds
   * @param {number} duration - Duration in seconds
   * @param {string} outputPath - Path for the output chunk
   * @returns {Promise<void>}
   */
  async extractChunkToFile(inputPath, start, duration, outputPath) {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(start)
        .setDuration(duration)
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }

  mergeTranscriptions(transcriptions) {
    return transcriptions
      .map((text, i) => {
        if (i === 0) return text;
        
        // Remove potential duplicate sentences from overlap
        const overlap = this.findOverlap(transcriptions[i - 1], text);
        return text.substring(overlap);
      })
      .join(' ')
      .trim();
  }

  findOverlap(prev, current) {
    // Find the best overlapping point between consecutive transcriptions
    const words = current.split(' ');
    const prevWords = prev.split(' ');
    
    for (let i = 0; i < words.length; i++) {
      const phrase = words.slice(0, i + 1).join(' ');
      if (prev.endsWith(phrase)) {
        return phrase.length;
      }
    }
    
    return 0;
  }
}
