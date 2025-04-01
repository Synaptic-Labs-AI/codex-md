import { openaiProxy } from "../../openaiProxy.js";
import { generateMarkdown } from "../../../utils/markdownGenerator.js";
import { FormData } from "formdata-node";
import { AppError } from "../../../utils/errorHandler.js";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (OpenAI's current limit)
const SUPPORTED_FORMATS = ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"];

class AudioConverter {
  constructor() {
    this.config = {
      name: 'Audio Converter',
      version: '1.0.0',
      supportedFormats: ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"],
      maxFileSize: 25 * 1024 * 1024 // 25 MB (OpenAI's current limit)
    };
  }

  /**
   * Convert audio content to markdown format
   * @param {Buffer} input - Audio file buffer
   * @param {Object} options - Conversion options
   * @param {string} options.name - Original filename
   * @param {string} options.apiKey - OpenAI API key for transcription
   * @returns {Promise<Object>} Conversion result
   */
  async convertToMarkdown(input, options) {
    const { name: originalName, apiKey } = options || {};

    try {
      console.log('🎵 [AudioConverter] Starting conversion with options:', {
        hasInput: !!input,
        inputType: input ? typeof input : 'none',
        originalName,
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey ? apiKey.length : 0
      });

      // Check for required API key first
      if (!apiKey) {
        console.error('❌ [AudioConverter] Missing API key');
        throw new AppError(
          "OpenAI API key is required for audio transcription",
          400
        );
      }
      
      // Validate input exists
      if (!input) {
        throw new AppError(
          "No audio input provided",
          400
        );
      }

      // Normalize input
      const audioBuffer = Buffer.isBuffer(input) ? input : input.buffer;
      
      if (!audioBuffer || audioBuffer.length === 0) {
        throw new AppError(
          "Invalid or empty audio buffer - file may be corrupted",
          400
        );
      }

      if (audioBuffer.length > MAX_FILE_SIZE) {
        throw new AppError(
          `File size exceeds the maximum limit of ${MAX_FILE_SIZE / (1024 * 1024)} MB`,
          400,
          {
            maxSize: MAX_FILE_SIZE,
            actualSize: audioBuffer.length,
            unit: "bytes"
          }
        );
      }

      const fileExt = originalName.split(".").pop().toLowerCase();
      if (!SUPPORTED_FORMATS.includes(fileExt)) {
        throw new AppError(
          `Unsupported audio format. Supported formats: ${SUPPORTED_FORMATS.join(", ")}`,
          400,
          {
            supportedFormats: SUPPORTED_FORMATS,
            providedFormat: fileExt
          }
        );
      }

      // Prepare form data for OpenAI
      const formData = new FormData();
      formData.append("file", new Blob([audioBuffer]), originalName);
      formData.append("model", "whisper-1");
      formData.append("response_format", "text");

      console.log('📝 [AudioConverter] Preparing OpenAI request...');
      
      // Get transcription
      const transcription = await openaiProxy.makeRequest(apiKey, "audio/transcriptions", formData);
      
      console.log('📝 [AudioConverter] Transcription result:', {
        hasTranscription: !!transcription,
        transcriptionLength: transcription ? transcription.length : 0
      });
      
      if (!transcription) {
        console.error('❌ [AudioConverter] Empty transcription received from OpenAI');
        throw new AppError("No transcription received", 500);
      }

      // Remove temp_ prefix from title if present
      let cleanTitle = originalName;
      if (cleanTitle.startsWith("temp_")) {
        // Extract original filename by removing 'temp_timestamp_' prefix
        cleanTitle = cleanTitle.replace(/^temp_\d+_/, "");
      }
      
      // Generate markdown content
      const markdown = generateMarkdown({
        title: `Audio Transcription: ${cleanTitle}`,
        content: transcription,
        metadata: {
          source: originalName,
          type: "audio-transcription",
          format: fileExt,
          fileSize: audioBuffer.length,
          created: new Date().toISOString()
        }
      });

      // Return with success flag
      return {
        success: true,
        content: markdown,
        type: "audio",
        name: originalName,
        category: "audio",
        originalContent: audioBuffer // Keep original audio for ZIP
      };

    } catch (error) {
      // Convert non-AppError errors to AppError
      if (!(error instanceof AppError)) {
        throw new AppError(
          `Audio conversion failed: ${error.message}`,
          500,
          { originalError: error }
        );
      }
      throw error;
    }
  }
}

// Export default
export default AudioConverter;
