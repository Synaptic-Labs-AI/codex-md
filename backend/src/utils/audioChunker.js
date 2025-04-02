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
   * @param {Buffer} audioBuffer - Audio buffer to split
   * @param {Object} options - Options for splitting
   * @param {Function} options.onProgress - Progress callback
   * @returns {Promise<Array<Buffer>>} Array of chunk buffers
   */
  async splitAudio(audioBuffer, options = {}) {
    try {
      // Ensure temp directory exists
      await fs.mkdir(this.tempDir, { recursive: true });

      // Write buffer to temporary file
      const inputPath = path.join(this.tempDir, `${uuidv4()}.mp3`);
      await fs.writeFile(inputPath, audioBuffer);

      // Get audio duration
      const duration = await this.getAudioDuration(inputPath);
      
      // Calculate optimal chunk sizes
      const chunks = this.calculateChunks(duration);
      
      // Track progress
      let processedChunks = 0;
      const totalChunks = chunks.length;
      
      // Process chunks sequentially to track progress
      const chunkBuffers = [];
      
      for (const { start, duration } of chunks) {
        const chunkBuffer = await this.extractChunk(inputPath, start, duration);
        chunkBuffers.push(chunkBuffer);
        
        // Update progress
        processedChunks++;
        const progress = (processedChunks / totalChunks) * 100;
        
        if (options.onProgress) {
          options.onProgress(progress);
          
          // Add phase information to the progress event
          if (options.onProgress.reportPhase) {
            options.onProgress.reportPhase('chunking');
          }
        }
      }

      // Cleanup
      await fs.unlink(inputPath);

      return chunkBuffers;
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

  async extractChunk(inputPath, start, duration) {
    const outputPath = path.join(this.tempDir, `${uuidv4()}.mp3`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(start)
        .setDuration(duration)
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const buffer = await fs.readFile(outputPath);
    await fs.unlink(outputPath);
    return buffer;
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
