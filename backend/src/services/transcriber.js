// services/transcriber.js
import { Readable } from 'stream';
import { OpenAI } from 'openai';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { path as ffprobePath } from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

// Import the transcription config using ES Module syntax
import transcriptionConfig from '../config/transcription.js';

// Set ffmpeg and ffprobe paths
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobePath);

class Transcriber {
  constructor() {
    this.openai = null;
    this.selectedModel = transcriptionConfig.DEFAULT_MODEL;
  }

  setModel(model) {
    if (transcriptionConfig.MODELS[model]) {
      this.selectedModel = model;
    }
  }

  getModel() {
    return this.selectedModel;
  }

  _getResponseFormat() {
    const formats = transcriptionConfig.RESPONSE_FORMATS[this.selectedModel] || ['text'];
    return formats[0];
  }

  initialize(apiKey) {
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Create a read stream from a buffer or file path
   */
  _createAudioStream(input) {
    if (Buffer.isBuffer(input)) {
      return Readable.from(input);
    }
    // For file paths, return path directly as OpenAI SDK handles them
    return input;
  }

  /**
   * Transcribe audio content to text
   * @param {Buffer|string} input Audio content as buffer or file path
   * @param {string} apiKey OpenAI API key
   * @returns {Promise<string>} Transcribed text
   */
  async transcribe(input, apiKey) {
    if (!this.openai) {
      this.initialize(apiKey);
    }

    try {
      const file = this._createAudioStream(input);
      
      const response = await this.openai.audio.transcriptions.create({
        file,
        model: this.selectedModel,
        response_format: this._getResponseFormat()
      });

      return response.text;
    } catch (error) {
      console.error('Transcription error:', error);
      throw error;
    }
  }

  /**
   * Extract audio from video buffer
   * @param {Buffer} buffer Video buffer
   * @returns {Promise<Buffer>} Audio buffer
   */
  async extractAudioFromVideo(buffer) {
    const tempDir = path.join(os.tmpdir(), uuidv4());
    const inputPath = path.join(tempDir, 'input.mp4');
    const outputPath = path.join(tempDir, 'output.mp3');

    try {
      // Create temp directory
      await fs.mkdir(tempDir, { recursive: true });
      
      // Write buffer to temp file (required for ffmpeg)
      await fs.writeFile(inputPath, buffer);

      console.log('Extracting audio with ffmpeg:', {
        inputPath,
        outputPath,
        ffmpegPath: ffmpegStatic
      });

      // Extract audio
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .toFormat('mp3')
          .audioQuality(0) // Best quality
          .on('start', cmd => console.log('Started ffmpeg with command:', cmd))
          .on('error', err => {
            console.error('FFmpeg error:', err);
            reject(new Error(`FFmpeg error: ${err.message}`));
          })
          .on('end', () => {
            console.log('FFmpeg finished extracting audio');
            resolve();
          })
          .save(outputPath);
      });

      // Read output file
      const audioBuffer = await fs.readFile(outputPath);
      return audioBuffer;

    } catch (error) {
      console.error('Audio extraction error:', error);
      throw error;
    } finally {
      // Cleanup temp files
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp files:', cleanupError);
      }
    }
  }
}

export const transcriber = new Transcriber();
