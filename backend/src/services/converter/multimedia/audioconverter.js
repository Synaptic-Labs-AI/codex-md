import { openaiProxy } from "../../openaiProxy.js";
import { generateMarkdown } from "../../../utils/markdownGenerator.js";
import { FormData } from "formdata-node";
import { AppError } from "../../../utils/errorHandler.js";
import { AudioChunker } from "../../../utils/audioChunker.js";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (OpenAI's current limit)
const SUPPORTED_FORMATS = ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"];

class AudioConverter {
  constructor() {
    this.config = {
      name: 'Audio Converter',
      version: '1.0.0',
      supportedFormats: SUPPORTED_FORMATS,
      maxFileSize: MAX_FILE_SIZE
    };

    this.chunker = new AudioChunker({
      chunkSize: MAX_FILE_SIZE,
      overlapSeconds: 2
    });
  }

  /**
   * Convert audio content to markdown format
   * @param {Buffer} input - Audio file buffer
   * @param {Object} options - Conversion options
   * @param {string} options.name - Original filename
   * @param {string} options.apiKey - OpenAI API key for transcription
   * @param {Function} options.onProgress - Progress callback
   * @returns {Promise<Object>} Conversion result
   */
  async convertToMarkdown(input, options) {
    const { name: originalName, apiKey, onProgress } = options || {};

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

      // Validate format
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

      let transcription;
      
      // Handle large files by chunking
      if (audioBuffer.length > MAX_FILE_SIZE) {
        console.log('🔄 [AudioConverter] File exceeds size limit, splitting into chunks...');
        
        // Create progress callback for chunking phase (0-50%)
        const onChunkingProgress = onProgress ? (progress) => {
          const scaledProgress = progress * 0.5; // Scale to 0-50%
          onProgress(scaledProgress);
          
          if (onProgress.reportPhase) {
            onProgress.reportPhase('chunking');
          }
        } : null;

        // Split audio into chunks
        console.log(`🔄 [AudioConverter] Splitting ${fileExt} file into chunks...`);
        const chunks = await this.chunker.splitAudio(audioBuffer, {
          onProgress: onChunkingProgress
        });

        console.log(`📦 [AudioConverter] Created ${chunks.length} chunks for processing`);

        // Process each chunk and collect transcriptions
        const transcriptions = [];
        for (let i = 0; i < chunks.length; i++) {
          try {
            // Update progress for transcription phase (50-100%)
            if (onProgress) {
              const progress = (i / chunks.length) * 100;
              const scaledProgress = 50 + (progress * 0.5); // Scale to 50-100%
              onProgress(scaledProgress);
              
              if (onProgress.reportPhase) {
                onProgress.reportPhase('transcribing');
              }
            }

            // Prepare form data for chunk
            const formData = new FormData();
            formData.append("file", new Blob([chunks[i]]), `chunk_${i+1}.mp3`);
            formData.append("model", "whisper-1");
            formData.append("response_format", "text");

            // Transcribe chunk
            const chunkTranscription = await openaiProxy.makeRequest(apiKey, "audio/transcriptions", formData);
            transcriptions.push(chunkTranscription);
          } catch (error) {
            console.error(`Error transcribing chunk ${i + 1}:`, error);
            transcriptions.push(`[Transcription failed for segment ${i + 1}]`);
          }
        }

        // Merge transcriptions with overlap handling
        transcription = this.chunker.mergeTranscriptions(transcriptions);
      } else {
        // Process single file directly
        console.log('📝 [AudioConverter] Processing file directly...');
        
        if (onProgress) {
          onProgress(50); // Mark as halfway done
          if (onProgress.reportPhase) {
            onProgress.reportPhase('transcribing');
          }
        }

        // Prepare form data
        const formData = new FormData();
        
        // For WAV files, explicitly set the MIME type to ensure proper handling
        const mimeType = fileExt === 'wav' ? 'audio/wav' : undefined;
        formData.append("file", new Blob([audioBuffer], { type: mimeType }), originalName);
        formData.append("model", "whisper-1");
        formData.append("response_format", "text");
        
        console.log(`📝 [AudioConverter] Sending ${fileExt} file to OpenAI API for transcription`);

        // Get transcription
        transcription = await openaiProxy.makeRequest(apiKey, "audio/transcriptions", formData);
        
        if (onProgress) {
          onProgress(100);
        }
      }
      
      if (!transcription) {
        console.error('❌ [AudioConverter] Empty transcription received');
        throw new AppError("No transcription received", 500);
      }

      console.log('📝 [AudioConverter] Transcription completed:', {
        transcriptionLength: transcription.length
      });

      // Remove temp_ prefix from title if present
      let cleanTitle = originalName;
      if (cleanTitle.startsWith("temp_")) {
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
