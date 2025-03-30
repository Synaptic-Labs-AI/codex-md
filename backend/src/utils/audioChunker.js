import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';
import { promises as fs } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import os from 'os';

export class AudioChunker {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 24 * 1024 * 1024; // 24MB default
    this.overlapSeconds = options.overlapSeconds || 2;
    this.tempDir = path.join(os.tmpdir(), 'audio-chunks');
  }

  async splitAudio(audioBuffer) {
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

      // Split audio into chunks
      const chunkBuffers = await Promise.all(
        chunks.map(({ start, duration }) =>
          this.extractChunk(inputPath, start, duration)
        )
      );

      // Cleanup
      await fs.unlink(inputPath);

      return chunkBuffers;
    } catch (error) {
      console.error('Error splitting audio:', error);
      throw error;
    }
  }

  getAudioDuration(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata.format.duration);
      });
    });
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
