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
 */

import { transcriber } from "../../transcriber.js";
import { generateMarkdown } from "../../../utils/markdownGenerator.js";
import { AppError } from "../../../utils/errorHandler.js";
import { AudioChunker } from "../../../utils/audioChunker.js";
import path from "path";

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
  async convertToMarkdown(input, options) {
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
      const fileExt = path.extname(name).slice(1).toLowerCase();
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

      // Extract audio and transcribe
      console.log("Processing video for transcription");
      try {
        // Extract audio from video
        const audioBuffer = await transcriber.extractAudioFromVideo(input);
        console.log("Audio extracted, checking size...");

        // Initialize AudioChunker with 25MB limit and 2s overlap
        const chunker = new AudioChunker({ 
          chunkSize: 25 * 1024 * 1024,
          overlapSeconds: 2
        });
        
        // Always split audio to ensure consistent processing
        console.log("Splitting audio into manageable chunks...");
        const chunks = await chunker.splitAudio(audioBuffer);
        console.log(`Created ${chunks.length} chunks for processing`);

        // Process chunks in parallel with progress tracking
        console.log(`Transcribing ${chunks.length} chunks`);
        const transcriptions = await Promise.all(
          chunks.map(async (chunk, index) => {
            try {
              console.log(`Transcribing chunk ${index + 1}/${chunks.length}`);
              return await transcriber.transcribe(chunk, apiKey);
            } catch (error) {
              console.error(`Error transcribing chunk ${index + 1}:`, error);
              // Return placeholder for failed chunk to maintain sequence
              return `[Transcription failed for segment ${index + 1}]`;
            }
          })
        );

        // Smart merge transcriptions with overlap handling
        console.log("Merging transcribed chunks...");
        const fullTranscript = chunks.length > 1 
          ? chunker.mergeTranscriptions(transcriptions)
          : transcriptions[0];

        // Remove temp_ prefix from title if present
        let baseName = path.basename(name, path.extname(name));
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
