// services/transcriber.js
import { OpenAI } from 'openai';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { path as ffprobePath } from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { File, Blob } from 'node:buffer';
import { PathUtils } from '../utils/paths/index.js';

// Get the directory name in ESM
const __dirname = PathUtils.getDirname(import.meta.url);

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
   * Create a File object from a file path
   * @param {string} filePath Path to the audio file
   * @returns {Promise<File>} File object for OpenAI API
   */
  async _createFileObject(filePath) {
    try {
      const fileData = await fs.readFile(filePath);
      const fileName = path.basename(filePath);
      return new File([fileData], fileName, { type: 'audio/mpeg' });
    } catch (error) {
      console.error('Error creating File object:', error);
      throw new Error(`Failed to create File object from ${filePath}: ${error.message}`);
    }
  }

  /**
   * Transcribe audio content to text
   * @param {string} filePath Path to the audio file
   * @param {string} apiKey OpenAI API key
   * @returns {Promise<string>} Transcribed text
   */
  async transcribe(filePath, apiKey) {
    if (!this.openai) {
      this.initialize(apiKey);
    }

    try {
      console.log('Starting transcription for:', filePath);

      // Verify file exists and is accessible
      try {
        await fs.access(filePath);
      } catch (error) {
        console.error('File access error:', error);
        throw new Error(`Cannot access audio file at ${filePath}`);
      }

      // Create File object for OpenAI API
      console.log('Creating File object from:', filePath);
      const file = await this._createFileObject(filePath);
      console.log('File object created successfully');

      // Create form with file object
      const response = await this.openai.audio.transcriptions.create({
        file,
        model: this.selectedModel,
        response_format: this._getResponseFormat()
      });

      console.log('Transcription completed successfully');
      return response.text;
    } catch (error) {
      console.error('Transcription error:', error);
      if (error.response?.status === 413) {
        throw new Error('Audio file too large. Maximum size is 25MB.');
      }
      throw error;
    }
  }

  /**
   * Extract audio from video buffer
   * @param {Buffer} buffer Video buffer
   * @returns {Promise<{path: string, cleanup: Function}>} Audio file path and cleanup function
   */
  async extractAudioFromVideo(buffer) {
    const tempDir = PathUtils.joinPaths(os.tmpdir(), uuidv4());
    const inputPath = PathUtils.joinPaths(tempDir, 'input.mp4');
    const outputPath = PathUtils.joinPaths(tempDir, 'output.mp3');

    // Create temp directory with platform-appropriate permissions
    try {
      await fs.mkdir(tempDir, { recursive: true });
      // Set appropriate permissions on Unix-like systems
      if (process.platform !== 'win32') {
        await fs.chmod(tempDir, 0o755);
      }
    } catch (error) {
      throw new Error(`Failed to create temp directory: ${error.message}`);
    }
    
    try {
      // Write buffer to temp file with platform-appropriate handling
      await fs.writeFile(inputPath, buffer);
      if (process.platform !== 'win32') {
        await fs.chmod(inputPath, 0o644);
      }

      console.log('Extracting audio with ffmpeg:', {
        inputPath,
        outputPath,
        ffmpegPath: ffmpegStatic
      });

      // Extract audio using platform-specific paths
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

      // Set appropriate permissions for output file on Unix-like systems
      if (process.platform !== 'win32') {
        await fs.chmod(outputPath, 0o644);
      }

      // Create cleanup function
      const cleanup = async () => {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
          console.log('Cleaned up temp directory:', tempDir);
        } catch (cleanupError) {
          console.warn('Failed to cleanup temp files:', cleanupError);
        }
      };

      // Delete input file early since we don't need it anymore
      await fs.unlink(inputPath);

      return { path: outputPath, cleanup };
    } catch (error) {
      // Clean up on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp files after error:', cleanupError);
      }
      console.error('Audio extraction error:', error);
      throw error;
    }
  }
}

export const transcriber = new Transcriber();
