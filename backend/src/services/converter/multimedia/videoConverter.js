/**
 * Video Converter
 * 
 * Handles conversion of video files to markdown by extracting audio
 * and transcribing using OpenAI's Whisper API. Uses consistent error
 * handling and progress tracking patterns.
 * 
 * Related files:
 * - services/transcriber.js: Audio extraction and transcription
 * - utils/markdownGenerator.js: Markdown formatting
 * - utils/errorHandler.js: Error handling patterns
 * - utils/paths/index.js: ESM-compatible path utilities
 */

import { transcriber } from "../../transcriber.js";
import { generateMarkdown } from "../../../utils/markdownGenerator.js";
import { AppError } from "../../../utils/errorHandler.js";
import { AudioChunker } from "../../../utils/audioChunker.js";
import { PathUtils } from "../../../utils/paths/index.js";
import path from "path";
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

// Get the directory name in ESM
const __dirname = PathUtils.getDirname(import.meta.url);

const SUPPORTED_FORMATS = ["mp4", "webm", "avi"];

class VideoConverter {
  /**
   * Convert video to markdown format
   * @param {Buffer} input - Video file buffer
   * @param {Object} options - Conversion options
   * @param {string} options.name - Original filename
   * @param {string} options.apiKey - OpenAI API key for transcription
   * @param {string} options.mimeType - MIME type of video file
   * @returns {Promise<Object>} Conversion result
   */
  async convertToMarkdown(input, options = {}) {
    const { name, apiKey, mimeType } = options || {};

    try {
      // Check for required API key first
      if (!apiKey) {
        throw new AppError(
          "OpenAI API key is required for video transcription",
          400
        );
      }

      // Validate input exists
      if (!input) {
        throw new AppError(
          "No video input provided",
          400
        );
      }

      // Validate buffer type
      if (!Buffer.isBuffer(input)) {
        throw new AppError(
          "Invalid input: Expected a buffer - file may be corrupted",
          400
        );
      }

      // Validate format
      const fileExt = PathUtils.getExtension(name).toLowerCase();
      if (!SUPPORTED_FORMATS.includes(fileExt)) {
        throw new AppError(
          `Unsupported video format. Supported formats: ${SUPPORTED_FORMATS.join(", ")}`,
          400,
          {
            supportedFormats: SUPPORTED_FORMATS,
            providedFormat: fileExt
          }
        );
      }

      // Process video for transcription
      console.log("Processing video for transcription");
      try {
        // Extract audio from video and get file path
        const { path: audioPath, cleanup: cleanupAudio } = await transcriber.extractAudioFromVideo(input);
        console.log("Audio extracted, checking size...");

        // Check audio file size
        const stats = await fs.stat(audioPath);
        const isLargeAudio = stats.size > 25 * 1024 * 1024; // 25MB limit

        let transcriptions = [];
        try {
          if (isLargeAudio) {
            console.log("Audio file exceeds 25MB, splitting into chunks...");
            // Initialize AudioChunker
            const chunker = new AudioChunker({ 
              chunkSize: 25 * 1024 * 1024,
              overlapSeconds: 2
            });

            // Split audio with progress tracking
            const { paths: chunkPaths, cleanup: cleanupChunks } = await chunker.splitAudio(audioPath, { 
              onProgress: options.onProgress ? (progress) => {
                const scaledProgress = 50 + (progress * 0.25);
                options.onProgress(scaledProgress);
                options.onProgress.reportPhase?.('chunking');
              } : null
            });

            console.log(`Created ${chunkPaths.length} chunks for processing`);

            try {
              // Process chunks sequentially
              for (let i = 0; i < chunkPaths.length; i++) {
                try {
                  console.log(`Transcribing chunk ${i + 1}/${chunkPaths.length}`);

                  // Update progress for transcription phase (75-100%)
                  if (options.onProgress) {
                    const transcriptionProgress = (i / chunkPaths.length) * 100;
                    const scaledProgress = 75 + (transcriptionProgress * 0.25);
                    options.onProgress(scaledProgress);
                    options.onProgress.reportPhase?.('transcribing');
                  }

                  const result = await transcriber.transcribe(chunkPaths[i], apiKey);
                  transcriptions.push(result);
                } catch (error) {
                  console.error(`Error transcribing chunk ${i + 1}:`, error);
                  transcriptions.push(`[Transcription failed for segment ${i + 1}]`);
                }
              }
            } finally {
              // Clean up chunk files
              await cleanupChunks();
            }
          } else {
            console.log("Audio file within size limit, transcribing directly...");
            // Single transcription for smaller files
            const result = await transcriber.transcribe(audioPath, apiKey);
            transcriptions = [result];
          }
        } finally {
          // Clean up extracted audio file
          await cleanupAudio();
        }

        // Process transcriptions
        console.log("Processing transcriptions...");
        let fullTranscript;
        
        if (isLargeAudio) {
          console.log("Merging chunked transcriptions...");
          fullTranscript = chunker.mergeTranscriptions(transcriptions);
        } else {
          fullTranscript = transcriptions[0];
        }

        // Remove temp_ prefix from title if present
        let baseName = PathUtils.getBaseName(name);
        if (baseName.startsWith("temp_")) {
          // Extract original filename by removing "temp_timestamp_" prefix
          baseName = baseName.replace(/^temp_\d+_/, "");
        }
        
        // Generate content without frontmatter
        const content = `# Video Transcription: ${baseName}\n\n${fullTranscript}`;
        
        // Include metadata separately for ElectronConversionService to handle
        const metadata = {
          source: name,
          type: "video-transcription",
          mimeType: mimeType,
          created: new Date().toISOString()
        };

        return {
          success: true,
          content: content,
          metadata: metadata,
          type: "video",
          name,
          category: "video",
          originalContent: input
        };
      } catch (error) {
        if (error.message.includes("ffmpeg exited with code 1")) {
          throw new AppError(
            "Video conversion failed. Check ffmpeg installation or file integrity.",
            500,
            { originalError: error }
          );
        }
        throw error;
      }

    } catch (error) {
      // Convert non-AppError errors to AppError
      if (!(error instanceof AppError)) {
        throw new AppError(
          `Video conversion failed: ${error.message}`,
          500,
          { originalError: error }
        );
      }
      throw error;
    }
  }
}

// Export default
export default VideoConverter;
