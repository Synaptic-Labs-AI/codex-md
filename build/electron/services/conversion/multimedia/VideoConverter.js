"use strict";

/**
 * VideoConverter.js
 * Handles conversion of video files to markdown format in the Electron main process.
 * 
 * This converter:
 * - Processes video files using fluent-ffmpeg
 * - Extracts metadata (duration, resolution, etc.)
 * - Extracts audio for transcription
 * - Integrates with TranscriberService for audio transcription
 * - Generates markdown with video information and transcription
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - FileProcessorService.js: Used for file operations (Note: Consider consolidating file operations under FileSystemService)
 * - TranscriberService.js: Used for audio transcription
 * - FileSystemService.js: For file operations including temporary file management
 * - ConversionLogger.js: Provides standardized logging
 * - ConversionStatus.js: Defines pipeline stages and status constants
 */

const path = require('path');
const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');
const {
  app
} = require('electron');
const {
  spawn
} = require('child_process');
const BaseService = require('../../BaseService');
const {
  v4: uuidv4
} = require('uuid'); // Import uuid for generating IDs
const BinaryPathResolver = require('../../../utils/BinaryPathResolver');
const {
  getLogger
} = require('../../../utils/logging/ConversionLogger');
const {
  sanitizeForLogging
} = require('../../../utils/logging/LogSanitizer');
const ConversionStatus = require('../../../utils/conversion/ConversionStatus');
class VideoConverter extends BaseService {
  constructor(registry, fileProcessor, transcriber, fileSystem) {
    // Use fileSystem instead of fileStorage
    super();
    this.registry = registry; // Store registry instance
    this.fileProcessor = fileProcessor; // TODO: Consolidate file operations?
    this.transcriber = transcriber;
    this.fileSystem = fileSystem; // Use fileSystem instance
    this.supportedExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'];
    // Remove internal activeConversions map - uses registry's map

    // Initialize the logger
    this.logger = getLogger('VideoConverter');

    // Configure ffmpeg to use the correct ffprobe path
    this.configureFfmpeg();
  }

  /**
   * Configure ffmpeg with the correct ffmpeg and ffprobe paths using BinaryPathResolver
   * This method uses the BinaryPathResolver module to locate binaries in both development
   * and production environments with multiple fallback strategies.
   *
   * The method handles errors gracefully and provides detailed logging for troubleshooting.
   */
  configureFfmpeg() {
    try {
      this.logger.info('Configuring ffmpeg and ffprobe paths using BinaryPathResolver', {
        phase: ConversionStatus.STATUS.STARTING
      });

      // Resolve ffmpeg binary path
      const ffmpegPath = BinaryPathResolver.resolveBinaryPath('ffmpeg');
      if (!ffmpegPath) {
        throw new Error('Failed to resolve ffmpeg binary path. Video conversion will not work.');
      }
      this.logger.info(`Successfully resolved ffmpeg binary at: ${ffmpegPath}`);

      // Resolve ffprobe binary path
      const ffprobePath = BinaryPathResolver.resolveBinaryPath('ffprobe');
      if (!ffprobePath) {
        throw new Error('Failed to resolve ffprobe binary path. Video metadata extraction will not work.');
      }
      this.logger.info(`Successfully resolved ffprobe binary at: ${ffprobePath}`);

      // Set the paths for fluent-ffmpeg using both methods (library function and environment variables)
      ffmpeg.setFfmpegPath(ffmpegPath);
      ffmpeg.setFfprobePath(ffprobePath);
      process.env.FFMPEG_PATH = ffmpegPath;
      process.env.FFPROBE_PATH = ffprobePath;

      // Force override the ffmpeg-static path to prevent any direct references
      try {
        // This is a hack to override any direct references to ffmpeg-static
        // It attempts to modify the require cache to redirect ffmpeg-static to our resolved path
        const ffmpegStaticPath = require.resolve('ffmpeg-static');
        if (ffmpegStaticPath && require.cache[ffmpegStaticPath]) {
          this.logger.debug(`Overriding ffmpeg-static module path in require cache`);
          require.cache[ffmpegStaticPath].exports = ffmpegPath;
        }
      } catch (err) {
        // This is not critical, just log it
        this.logger.debug(`Could not override ffmpeg-static module (this is normal in production): ${err.message}`);
      }

      // Verify that ffmpeg is working by checking formats
      this.verifyFfmpegWorks(ffmpegPath);
      this.logger.info('Binary paths configured successfully:');
      this.logger.info(`- ffmpeg: ${ffmpegPath}`);
      this.logger.info(`- ffprobe: ${ffprobePath}`);
    } catch (error) {
      this.logger.error(`Error configuring ffmpeg: ${error.message}`);
      this.logger.debug(`Error stack: ${error.stack}`);

      // Even though we log the error, we don't throw it here to allow the service to initialize
      // The actual conversion methods will handle the missing binaries gracefully
      this.logger.warn('Service will initialize but conversions may fail');
    }
  }

  /**
   * Verify that ffmpeg is working by checking formats
   * This method uses direct child_process.spawn instead of fluent-ffmpeg
   * to ensure we're using the correct binary path
   *
   * @param {string} ffmpegPath - Path to ffmpeg binary
   * @private
   */
  verifyFfmpegWorks(ffmpegPath) {
    try {
      this.logger.info(`Verifying ffmpeg works by checking formats: ${ffmpegPath}`);

      // Use spawn directly with the resolved path instead of relying on fluent-ffmpeg
      const process = spawn(ffmpegPath, ['-formats']);

      // Just log that we're checking, we don't need to wait for the result
      this.logger.debug(`Spawned ffmpeg process to check formats`);

      // Add listeners to log output but don't block
      process.stdout.on('data', data => {
        this.logger.debug(`ffmpeg formats check output: ${data.toString().substring(0, 100)}...`);
      });
      process.stderr.on('data', data => {
        this.logger.debug(`ffmpeg formats check stderr: ${data.toString().substring(0, 100)}...`);
      });
      process.on('error', err => {
        this.logger.error(`Error verifying ffmpeg: ${err.message}`);
        this.logger.error(`This may indicate a path resolution issue with ffmpeg`);
      });
      process.on('close', code => {
        this.logger.info(`ffmpeg formats check exited with code ${code}`);
      });
    } catch (error) {
      this.logger.error(`Failed to verify ffmpeg: ${error.message}`);
    }
  }

  /**
   * Set up IPC handlers for video conversion
   */
  setupIpcHandlers() {
    this.registerHandler('convert:video', this.handleConvert.bind(this));
    this.registerHandler('convert:video:metadata', this.handleGetMetadata.bind(this));
    this.registerHandler('convert:video:cancel', this.handleCancel.bind(this));
  }

  /**
   * Handle video conversion request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Conversion request details
   */
  async handleConvert(event, {
    filePath,
    options = {}
  }) {
    const conversionId = `video_${uuidv4()}`; // Generate unique ID
    const fileType = path.extname(filePath).substring(1); // Get file extension without dot

    // Validate output path if provided
    if (options.outputPath) {
      try {
        const outputDir = path.dirname(options.outputPath);
        await fs.ensureDir(outputDir);
        this.logger.info(`Validated output directory: ${outputDir}`);
      } catch (error) {
        const setupError = new Error(`Invalid output path: ${error.message}`);
        setupError.code = 'E_SETUP'; // Add error code
        this.logger.error(`[${setupError.code}] ${setupError.message}`);
        // Return a structured error for setup failures
        return {
          success: false,
          error: {
            code: setupError.code,
            message: setupError.message,
            details: error.stack // Include original stack
          }
        };
      }
    }

    // Initialize logger with context for this conversion
    this.logger.setContext({
      conversionId,
      fileType,
      outputPath: options.outputPath
    });
    this.logger.logConversionStart(fileType, options);

    // Get window reference safely, handling null event
    const window = event?.sender?.getOwnerBrowserWindow();
    let tempDir = options._tempDir; // Check if tempDir was passed by the wrapper
    let outputPath = options.outputPath; // Get output path from options

    let createdTempDir = false; // Flag to track if we created the temp dir here

    try {
      // Create temp directory only if not passed by the wrapper
      if (!tempDir) {
        // Use the new FileSystemService method to create a managed temporary directory
        tempDir = await this.fileSystem.createTemporaryDirectory('video_conversion');
        this.logger.info(`Created managed temporary directory: ${tempDir}`, {
          phase: 'setup'
        });
        createdTempDir = true; // Mark that we created it
      } else {
        this.logger.info(`Using temporary directory provided by wrapper: ${tempDir}`, {
          phase: 'setup'
        });
        // Note: If provided by wrapper, its lifecycle is managed externally
      }

      // Register the conversion with the central registry
      this.registry.registerConversion(conversionId, {
        id: conversionId,
        type: 'video',
        name: path.basename(filePath),
        status: ConversionStatus.STATUS.STARTING,
        progress: 0,
        filePath,
        // Store original path if needed, but process temp file
        tempDir,
        window,
        startTime: Date.now(),
        outputPath: options.outputPath // Store output path in registry
      }, async () => {
        // Ensure callback is async
        // Cleanup function for the registry - Release the managed temporary directory
        // Only release if this instance created it (createdTempDir flag)
        // Check if createdTempDir is defined and true before releasing
        if (tempDir && typeof createdTempDir !== 'undefined' && createdTempDir) {
          this.logger.info(`Releasing managed temporary directory via registry cleanup: ${tempDir}`, {
            phase: 'cleanup'
          });
          try {
            await this.fileSystem.releaseTemporaryDirectory(tempDir);
            this.logger.info(`Successfully released temporary directory: ${tempDir}`, {
              phase: 'cleanup'
            });
          } catch (cleanupError) {
            this.logger.error(`Error releasing temporary directory ${tempDir} during registry cleanup: ${cleanupError.message}`, {
              phase: 'cleanup'
            });
          }
        } else if (tempDir) {
          this.logger.info(`Temporary directory ${tempDir} was provided externally or not created by this instance, skipping release via registry cleanup.`, {
            phase: 'cleanup'
          });
        }
      });

      // Notify client that conversion has started, only if window is available
      if (window) {
        window.webContents.send('video:conversion-started', {
          conversionId
        });
      } else {
        this.logger.warn(`Window not available for conversion ${conversionId}, skipping initial notification.`);
      }

      // Start conversion process asynchronously (fire and forget - result handled via registry/IPC)
      this.processConversion(conversionId, filePath, options);
      // No .catch() here; processConversion handles its own errors and registry updates.

      // Return success *initiation* response
      return {
        success: true,
        conversionId
      };
    } catch (error) {
      const setupErrorCode = error.code || 'E_SETUP_UNEXPECTED';
      this.logger.logConversionError(fileType, error, {
        phase: 'error_setup',
        code: setupErrorCode
      });

      // Ensure cleanup if tempDir was created *by this instance* before the error occurred during setup
      if (tempDir && typeof createdTempDir !== 'undefined' && createdTempDir) {
        this.logger.warn(`Error during initial setup for ${conversionId}. Releasing temporary directory: ${tempDir}`, {
          phase: 'error_cleanup'
        });
        try {
          await this.fileSystem.releaseTemporaryDirectory(tempDir);
          this.logger.info(`Successfully released temporary directory after setup error: ${tempDir}`, {
            phase: 'error_cleanup'
          });
        } catch (cleanupError) {
          this.logger.error(`Error releasing temporary directory ${tempDir} during setup error handling: ${cleanupError.message}`, {
            phase: 'error_cleanup'
          });
        }
      }
      // Remove from registry if it was added before error
      // Note: removeConversion triggers the cleanup callback defined above,
      // which now also checks the createdTempDir flag.
      this.registry.removeConversion(conversionId);

      // Return a structured error object instead of throwing
      return {
        success: false,
        error: {
          code: setupErrorCode,
          message: `Video conversion setup failed: ${error.message}`,
          details: error.stack
        }
      };
    }
  }

  /**
   * Handle video metadata request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Metadata request details
   */
  async handleGetMetadata(event, {
    filePath
  }) {
    const fileType = path.extname(filePath).substring(1); // Get file extension without dot

    try {
      this.logger.info(`Getting metadata for ${filePath}`, {
        fileType,
        phase: ConversionStatus.STATUS.VALIDATING
      });
      const metadata = await this.getVideoMetadata(filePath);
      this.logger.info(`Successfully retrieved metadata`, {
        fileType,
        phase: ConversionStatus.STATUS.VALIDATING
      });
      return {
        success: true,
        metadata
      };
    } catch (error) {
      const metadataErrorCode = error.code || 'E_METADATA_FAILED';
      this.logger.error(`[${metadataErrorCode}] Failed to get metadata: ${error.message}`, {
        fileType
      });
      // Return structured error instead of throwing
      return {
        success: false,
        error: {
          code: metadataErrorCode,
          message: `Failed to get video metadata: ${error.message}`,
          details: error.stack
        }
      };
    }
  }

  /**
   * Handle conversion cancellation request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Cancellation request details
   */
  async handleCancel(event, {
    conversionId
  }) {
    this.logger.info(`Received cancel request for conversion: ${conversionId}`);
    const removed = this.registry.removeConversion(conversionId); // This also triggers cleanup
    if (removed) {
      this.logger.info(`Conversion ${conversionId} cancelled and removed from registry.`);
      // Optionally notify the window if needed, though registry might handle this
      const conversionData = this.registry.getConversion(conversionId); // Should be null now
      if (conversionData && conversionData.window) {
        conversionData.window.webContents.send('video:conversion-cancelled', {
          conversionId
        });
      }
    } else {
      this.logger.warn(`Conversion ${conversionId} not found in registry for cancellation.`);
    }
    return {
      success: removed
    };
  }

  /**
   * Process video conversion
   * @param {string} conversionId - Conversion identifier
   * @param {string} filePath - Path to video file
   * @param {Object} options - Conversion options
   */
  async processConversion(conversionId, filePath, options) {
    const fileType = path.extname(filePath).substring(1); // Get file extension without dot

    try {
      this.logger.setContext({
        conversionId,
        fileType
      });
      this.logger.logPhaseTransition(ConversionStatus.STATUS.STARTING, ConversionStatus.STATUS.VALIDATING);

      // Verify that ffmpeg and ffprobe binaries are available before proceeding
      const ffmpegPath = BinaryPathResolver.resolveBinaryPath('ffmpeg', {
        forceRefresh: false
      });
      const ffprobePath = BinaryPathResolver.resolveBinaryPath('ffprobe', {
        forceRefresh: false
      });
      if (!ffmpegPath || !ffprobePath) {
        // Throw specific error to be caught below
        const binaryError = new Error('FFmpeg or FFprobe binaries not available. Cannot proceed with conversion.');
        binaryError.code = 'E_MISSING_BINARY';
        throw binaryError;
      }
      this.logger.info(`Using ffmpeg at: ${ffmpegPath}`);
      this.logger.info(`Using ffprobe at: ${ffprobePath}`);

      // Retrieve conversion data from the central registry
      const conversionData = this.registry.getConversion(conversionId);
      if (!conversionData) {
        // It's possible the conversion was cancelled or timed out
        this.logger.warn(`Conversion ${conversionId} not found in registry during processing. It might have been cancelled or timed out.`);
        // Don't throw an error here, just exit gracefully. The registry handles cleanup.
        return; // Or handle as appropriate, maybe return a specific status
      }

      // Extract outputPath from conversionData
      let outputPath = conversionData.outputPath;
      const tempDir = conversionData.tempDir;
      const originalFilePath = conversionData.filePath; // Use original path for context if needed
      const tempFilePath = path.join(tempDir, `${path.basename(originalFilePath)}_${Date.now()}.mp4`); // Need to reconstruct or store temp path

      // Write the actual file content (passed as filePath argument here) to temp file
      // This assumes filePath passed to processConversion is the actual content buffer or path to read from
      // Let's assume filePath IS the path to the *original* file, and we need to copy it
      await fs.copy(originalFilePath, tempFilePath);
      this.logger.info(`Copied original file to temp path: ${tempFilePath}`);
      this.logger.info(`Using temp directory: ${tempDir}`);
      this.logger.info(`Processing temp file: ${tempFilePath}`);

      // Try fast path first
      this.logger.logPhaseTransition(ConversionStatus.STATUS.VALIDATING, ConversionStatus.STATUS.FAST_ATTEMPT);
      this.registry.pingConversion(conversionId, {
        status: ConversionStatus.STATUS.FAST_ATTEMPT,
        progress: 5
      });

      // Extract metadata
      this.logger.info(`Extracting metadata from: ${tempFilePath}`);
      const metadata = await this.getVideoMetadata(tempFilePath);
      this.logger.info(`Metadata extracted successfully`);
      this.logger.debug('Metadata details:', sanitizeForLogging(metadata));

      // Skip thumbnail generation
      this.logger.info(`Skipping thumbnail generation`, {
        phase: ConversionStatus.STATUS.PROCESSING
      });
      this.registry.pingConversion(conversionId, {
        status: ConversionStatus.STATUS.PROCESSING,
        progress: 10
      });
      const thumbnails = []; // Empty array instead of generating thumbnails

      // Extract audio for transcription
      this.logger.logPhaseTransition(ConversionStatus.STATUS.PROCESSING, ConversionStatus.STATUS.EXTRACTING_AUDIO);
      this.registry.pingConversion(conversionId, {
        status: ConversionStatus.STATUS.EXTRACTING_AUDIO,
        progress: 30
      });
      const audioPath = path.join(tempDir, 'audio.mp3');
      this.logger.info(`Extracting audio to: ${audioPath}`);
      await this.extractAudio(tempFilePath, audioPath);
      this.logger.info(`Audio extracted successfully`);

      // Transcribe audio if requested
      let transcription = null;
      if (options.transcribe !== false) {
        this.logger.logPhaseTransition(ConversionStatus.STATUS.EXTRACTING_AUDIO, ConversionStatus.STATUS.TRANSCRIBING);
        this.registry.pingConversion(conversionId, {
          status: ConversionStatus.STATUS.TRANSCRIBING,
          progress: 40
        });
        const transcriptionOptions = sanitizeForLogging({
          language: options.language || 'en'
        });
        this.logger.info(`Transcribing audio with options:`, transcriptionOptions);
        transcription = await this.transcribeAudio(audioPath, options.language || 'en');
        if (!transcription || !transcription.text || transcription.text.trim() === '') {
          this.logger.logPhaseTransition(ConversionStatus.STATUS.TRANSCRIBING, ConversionStatus.STATUS.CONTENT_EMPTY);
          this.registry.pingConversion(conversionId, {
            status: ConversionStatus.STATUS.CONTENT_EMPTY,
            progress: 80
          });
          this.logger.info(`Transcription produced empty content - this is normal for videos without speech`);
        } else {
          this.registry.pingConversion(conversionId, {
            status: ConversionStatus.STATUS.TRANSCRIBING,
            progress: 80
          });
          this.logger.info(`Transcription completed successfully (${transcription.text.length} characters)`);
        }
      }
      this.logger.logPhaseTransition(transcription ? ConversionStatus.STATUS.TRANSCRIBING : ConversionStatus.STATUS.EXTRACTING_AUDIO, ConversionStatus.STATUS.PROCESSING);
      this.registry.pingConversion(conversionId, {
        status: ConversionStatus.STATUS.PROCESSING,
        progress: 90
      });
      this.logger.info(`Generating markdown output`);

      // Generate markdown
      const markdown = this.generateMarkdown(metadata, thumbnails, transcription, options);
      this.logger.info(`Markdown generated successfully (${markdown.length} characters)`);

      // Write the markdown content to the output file
      try {
        // If outputPath not provided, create one in temp directory
        if (!outputPath) {
          outputPath = path.join(tempDir, `${path.basename(filePath, path.extname(filePath))}.md`);
        }
        this.logger.info(`Writing markdown content to: ${outputPath}`);
        await fs.writeFile(outputPath, markdown, 'utf8');
        this.logger.info(`Successfully wrote markdown content to file (${markdown.length} characters)`);

        // Update registry with completed status, result, and output path
        this.logger.logPhaseTransition(ConversionStatus.STATUS.PROCESSING, ConversionStatus.STATUS.COMPLETED);
        this.registry.pingConversion(conversionId, {
          status: ConversionStatus.STATUS.COMPLETED,
          progress: 100,
          result: markdown,
          outputPath
        });
        this.logger.logConversionComplete(fileType);
      } catch (writeError) {
        // Add specific code for file writing errors
        writeError.code = writeError.code || 'E_FILE_WRITE';
        this.logger.error(`[${writeError.code}] Failed to write markdown content to file: ${writeError.message}`);
        // Throw the error to be caught by the main catch block below
        throw new Error(`Failed to save conversion output: ${writeError.message}`);
      }

      // Cleanup is handled by the registry's removeConversion call eventually

      // On success, processConversion doesn't need to return anything here,
      // the result is communicated via the registry update above.
      return;
    } catch (error) {
      // Determine error code, default if not set
      const errorCode = error.code || 'E_VIDEO_CONVERSION_FAILED';

      // Sanitize error details before logging
      const sanitizedError = sanitizeForLogging({
        message: error.message,
        stack: error.stack,
        // Keep stack for detailed logging
        code: errorCode // Include the code
      });

      // Use the enhanced logger method that includes code
      this.logger.logConversionError(fileType, sanitizedError, {
        code: errorCode
      });

      // Update registry with failed status and structured error object
      this.registry.pingConversion(conversionId, {
        status: ConversionStatus.STATUS.ERROR,
        error: {
          // Store structured error
          code: errorCode,
          message: error.message // Keep original message for registry
          // Optionally add more details if needed, but keep it concise for IPC
        }
      });

      // Do NOT re-throw. Error is handled by updating the registry.
    }
  }
  /**
   * Get video file metadata
   * @param {string} filePath - Path to video file
   * @returns {Promise<Object>} Video metadata
   */
  async getVideoMetadata(filePath) {
    const fileType = path.extname(filePath).substring(1);
    this.logger.setContext({
      fileType,
      phase: ConversionStatus.STATUS.VALIDATING
    });
    return new Promise((resolve, reject) => {
      // Ensure we have the latest ffmpeg path before running ffprobe
      const ffprobePath = BinaryPathResolver.resolveBinaryPath('ffprobe', {
        forceRefresh: false
      });
      if (!ffprobePath) {
        const error = new Error('FFprobe binary not available. Cannot extract video metadata.');
        error.code = 'E_MISSING_BINARY'; // Add error code
        this.logger.error(`[${error.code}] ${error.message}`);
        return reject(error); // Reject with the coded error
      }
      this.logger.info(`Getting video metadata using ffprobe at: ${ffprobePath}`);
      // Create a new ffmpeg command with the correct path to ensure we're not using cached paths
      const command = ffmpeg();
      command.setFfprobePath(ffprobePath);
      command.input(filePath).ffprobe((err, metadata) => {
        if (err) {
          const metadataError = new Error(`FFprobe failed: ${err.message}`);
          metadataError.code = 'E_FFPROBE_FAILED'; // Specific code for ffprobe errors
          metadataError.details = err; // Attach original error
          this.logger.error(`[${metadataError.code}] Error getting metadata: ${metadataError.message}`);
          reject(metadataError); // Reject with the structured error
          return;
        }
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
        if (!videoStream) {
          const noStreamError = new Error('No video stream found in the file.');
          noStreamError.code = 'E_NO_VIDEO_STREAM'; // Specific code
          this.logger.error(`[${noStreamError.code}] ${noStreamError.message}`);
          reject(noStreamError); // Reject with the structured error
          return;
        }
        const result = {
          format: metadata.format.format_name,
          duration: metadata.format.duration,
          size: metadata.format.size,
          bitrate: metadata.format.bit_rate,
          filename: path.basename(filePath),
          video: {
            codec: videoStream.codec_name,
            width: videoStream.width,
            height: videoStream.height,
            frameRate: this.parseFrameRate(videoStream.r_frame_rate),
            aspectRatio: videoStream.display_aspect_ratio || `${videoStream.width}:${videoStream.height}`
          },
          audio: audioStream ? {
            codec: audioStream.codec_name,
            channels: audioStream.channels,
            sampleRate: audioStream.sample_rate
          } : null
        };
        this.logger.info(`Metadata extraction successful`);
        resolve(result);
      });
    });
  }

  /**
   * Parse frame rate string (e.g. "30000/1001") to number
   * @param {string} frameRate - Frame rate string
   * @returns {number} Frame rate as number
   */
  parseFrameRate(frameRate) {
    if (!frameRate) return null;
    const parts = frameRate.split('/');
    if (parts.length === 2) {
      return Math.round(parseInt(parts[0]) / parseInt(parts[1]) * 100) / 100;
    }
    return parseFloat(frameRate);
  }

  /**
   * Extract audio from video file
   * @param {string} videoPath - Path to video file
   * @param {string} outputPath - Output path for audio
   * @returns {Promise<void>}
   */
  async extractAudio(videoPath, outputPath) {
    const fileType = path.extname(videoPath).substring(1);
    this.logger.setContext({
      fileType,
      phase: ConversionStatus.STATUS.EXTRACTING_AUDIO
    });
    return new Promise((resolve, reject) => {
      // Ensure we have the latest ffmpeg path before extracting audio
      const ffmpegPath = BinaryPathResolver.resolveBinaryPath('ffmpeg', {
        forceRefresh: false
      });
      if (!ffmpegPath) {
        const error = new Error('FFmpeg binary not available. Cannot extract audio.');
        error.code = 'E_MISSING_BINARY'; // Add error code
        this.logger.error(`[${error.code}] ${error.message}`);
        return reject(error); // Reject with the coded error
      }
      this.logger.info(`Extracting audio using ffmpeg at: ${ffmpegPath}`);
      // Create a new ffmpeg command with the correct path to ensure we're not using cached paths
      const command = ffmpeg();
      command.setFfmpegPath(ffmpegPath);
      command.input(videoPath).output(outputPath).noVideo().audioCodec('libmp3lame').audioBitrate(128).on('start', commandLine => {
        this.logger.debug(`FFmpeg command: ${commandLine}`);
      }).on('progress', progress => {
        this.logger.debug(`Audio extraction progress: ${JSON.stringify(progress)}`);
      }).on('end', () => {
        this.logger.info(`Audio extraction completed successfully`);
        resolve();
      }).on('error', (err, stdout, stderr) => {
        // Capture stdout/stderr for more context
        const extractionError = new Error(`FFmpeg audio extraction failed: ${err.message}`);
        extractionError.code = 'E_FFMPEG_AUDIO_EXTRACTION'; // Specific code
        // Include ffmpeg's stderr if available, as it often contains useful info
        extractionError.details = {
          originalError: err,
          stderr: stderr || 'N/A'
        };
        this.logger.error(`[${extractionError.code}] Audio extraction error: ${extractionError.message}. Stderr: ${stderr}`);
        reject(extractionError); // Reject with the structured error
      }).run();
    });
  }

  /**
   * Transcribe audio file
   * @param {string} audioPath - Path to audio file
   * @param {string} language - Language code
   * @returns {Promise<Object>} Transcription result
   */
  async transcribeAudio(audioPath, language) {
    const fileType = 'mp3'; // Audio is always converted to mp3
    this.logger.setContext({
      fileType,
      phase: ConversionStatus.STATUS.TRANSCRIBING
    });
    try {
      // Use the TranscriberService to transcribe the audio
      this.logger.info(`Starting transcription of audio file: ${audioPath}`);
      const result = await this.transcriber.handleTranscribeStart(null, {
        filePath: audioPath,
        options: {
          language
        }
      });

      // Wait for transcription to complete
      this.logger.info(`Transcription job started with ID: ${result.jobId}`);
      let status = await this.transcriber.handleTranscribeStatus(null, {
        jobId: result.jobId
      });
      while (status.status !== 'completed' && status.status !== 'failed' && status.status !== 'cancelled') {
        // Wait a bit before checking again
        this.logger.debug(`Transcription in progress, status: ${status.status}, progress: ${status.progress || 'unknown'}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        status = await this.transcriber.handleTranscribeStatus(null, {
          jobId: result.jobId
        });
      }
      if (status.status === 'failed') {
        const transcriptionError = new Error(status.error || 'Transcription failed');
        transcriptionError.code = 'E_TRANSCRIPTION_FAILED'; // Specific code
        this.logger.error(`[${transcriptionError.code}] Transcription failed: ${transcriptionError.message}`);
        throw transcriptionError; // Throw coded error
      }
      if (status.status === 'cancelled') {
        const cancelledError = new Error('Transcription cancelled');
        cancelledError.code = 'E_TRANSCRIPTION_CANCELLED'; // Specific code
        this.logger.warn(`[${cancelledError.code}] Transcription cancelled`);
        throw cancelledError; // Throw coded error
      }
      if (!status.result || !status.result.text || status.result.text.trim() === '') {
        this.logger.info(`Transcription completed but content is empty - this is normal for videos without speech`, {
          phase: ConversionStatus.STATUS.CONTENT_EMPTY
        });
      } else {
        this.logger.info(`Transcription completed successfully with ${status.result.text.length} characters`);
      }
      return status.result;
    } catch (error) {
      // Ensure error has a code before re-throwing
      error.code = error.code || 'E_TRANSCRIPTION_UNEXPECTED';
      this.logger.error(`[${error.code}] Transcription failed: ${error.message}`);
      throw error; // Re-throw (will be caught by processConversion)
    }
  }

  /**
   * Generate markdown from video metadata, thumbnails, and transcription
   * @param {Object} metadata - Video metadata
   * @param {Array} thumbnails - Array of thumbnail info objects
   * @param {Object} transcription - Transcription result
   * @param {Object} options - Conversion options
   * @returns {string} Markdown content
   */
  generateMarkdown(metadata, thumbnails, transcription, options) {
    this.logger.info(`Generating markdown content`, {
      phase: ConversionStatus.STATUS.PROCESSING
    });
    const markdown = [];

    // Add title
    if (options.title) {
      markdown.push(`# ${options.title}`);
    } else {
      markdown.push(`# Video: ${metadata.filename}`);
    }
    markdown.push('');

    // Add metadata
    markdown.push('## Video Information');
    markdown.push('');
    markdown.push('| Property | Value |');
    markdown.push('| --- | --- |');
    markdown.push(`| Filename | ${metadata.filename} |`);
    markdown.push(`| Duration | ${this.formatDuration(metadata.duration)} |`);
    markdown.push(`| Resolution | ${metadata.video.width}x${metadata.video.height} |`);
    markdown.push(`| Format | ${metadata.format} |`);
    markdown.push(`| Video Codec | ${metadata.video.codec} |`);
    if (metadata.audio) {
      markdown.push(`| Audio Codec | ${metadata.audio.codec} |`);
      markdown.push(`| Audio Channels | ${metadata.audio.channels} |`);
    }
    markdown.push(`| Frame Rate | ${metadata.video.frameRate} fps |`);
    markdown.push(`| Bitrate | ${Math.round(metadata.bitrate / 1000)} kbps |`);
    markdown.push(`| File Size | ${this.formatFileSize(metadata.size)} |`);
    markdown.push('');

    // Thumbnails section removed

    // Add transcription if available
    if (transcription && transcription.text && transcription.text.trim() !== '') {
      markdown.push('## Transcription');
      markdown.push('');
      markdown.push(transcription.text);
    } else if (transcription) {
      markdown.push('## Transcription');
      markdown.push('');
      markdown.push('*No speech detected in this video.*');
    }
    this.logger.info(`Markdown generation complete with ${markdown.length} lines`);
    return markdown.join('\n');
  }

  /**
   * Format duration in seconds to hh:mm:ss
   * @param {number} seconds - Duration in seconds
   * @returns {string} Formatted duration
   */
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const secs = Math.floor(seconds % 60);
    return [hours.toString().padStart(2, '0'), minutes.toString().padStart(2, '0'), secs.toString().padStart(2, '0')].join(':');
  }

  /**
   * Format file size in bytes to human-readable format
   * @param {number} bytes - File size in bytes
   * @returns {string} Formatted file size
   */
  formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Check if this converter supports the given file
   * @param {string} filePath - Path to file
   * @returns {boolean} True if supported
   */
  supportsFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  /**
   * Get converter information
   * @returns {Object} Converter details
   */
  getInfo() {
    return {
      name: 'Video Converter',
      extensions: this.supportedExtensions,
      description: 'Converts video files to markdown with metadata and transcription',
      options: {
        transcribe: 'Whether to transcribe audio (default: true)',
        language: 'Transcription language (default: en)',
        title: 'Optional document title'
      }
    };
  }
}
module.exports = VideoConverter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiZmZtcGVnIiwiYXBwIiwic3Bhd24iLCJCYXNlU2VydmljZSIsInY0IiwidXVpZHY0IiwiQmluYXJ5UGF0aFJlc29sdmVyIiwiZ2V0TG9nZ2VyIiwic2FuaXRpemVGb3JMb2dnaW5nIiwiQ29udmVyc2lvblN0YXR1cyIsIlZpZGVvQ29udmVydGVyIiwiY29uc3RydWN0b3IiLCJyZWdpc3RyeSIsImZpbGVQcm9jZXNzb3IiLCJ0cmFuc2NyaWJlciIsImZpbGVTeXN0ZW0iLCJzdXBwb3J0ZWRFeHRlbnNpb25zIiwibG9nZ2VyIiwiY29uZmlndXJlRmZtcGVnIiwiaW5mbyIsInBoYXNlIiwiU1RBVFVTIiwiU1RBUlRJTkciLCJmZm1wZWdQYXRoIiwicmVzb2x2ZUJpbmFyeVBhdGgiLCJFcnJvciIsImZmcHJvYmVQYXRoIiwic2V0RmZtcGVnUGF0aCIsInNldEZmcHJvYmVQYXRoIiwicHJvY2VzcyIsImVudiIsIkZGTVBFR19QQVRIIiwiRkZQUk9CRV9QQVRIIiwiZmZtcGVnU3RhdGljUGF0aCIsInJlc29sdmUiLCJjYWNoZSIsImRlYnVnIiwiZXhwb3J0cyIsImVyciIsIm1lc3NhZ2UiLCJ2ZXJpZnlGZm1wZWdXb3JrcyIsImVycm9yIiwic3RhY2siLCJ3YXJuIiwic3Rkb3V0Iiwib24iLCJkYXRhIiwidG9TdHJpbmciLCJzdWJzdHJpbmciLCJzdGRlcnIiLCJjb2RlIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUNvbnZlcnQiLCJiaW5kIiwiaGFuZGxlR2V0TWV0YWRhdGEiLCJoYW5kbGVDYW5jZWwiLCJldmVudCIsImZpbGVQYXRoIiwib3B0aW9ucyIsImNvbnZlcnNpb25JZCIsImZpbGVUeXBlIiwiZXh0bmFtZSIsIm91dHB1dFBhdGgiLCJvdXRwdXREaXIiLCJkaXJuYW1lIiwiZW5zdXJlRGlyIiwic2V0dXBFcnJvciIsInN1Y2Nlc3MiLCJkZXRhaWxzIiwic2V0Q29udGV4dCIsImxvZ0NvbnZlcnNpb25TdGFydCIsIndpbmRvdyIsInNlbmRlciIsImdldE93bmVyQnJvd3NlcldpbmRvdyIsInRlbXBEaXIiLCJfdGVtcERpciIsImNyZWF0ZWRUZW1wRGlyIiwiY3JlYXRlVGVtcG9yYXJ5RGlyZWN0b3J5IiwicmVnaXN0ZXJDb252ZXJzaW9uIiwiaWQiLCJ0eXBlIiwibmFtZSIsImJhc2VuYW1lIiwic3RhdHVzIiwicHJvZ3Jlc3MiLCJzdGFydFRpbWUiLCJEYXRlIiwibm93IiwicmVsZWFzZVRlbXBvcmFyeURpcmVjdG9yeSIsImNsZWFudXBFcnJvciIsIndlYkNvbnRlbnRzIiwic2VuZCIsInByb2Nlc3NDb252ZXJzaW9uIiwic2V0dXBFcnJvckNvZGUiLCJsb2dDb252ZXJzaW9uRXJyb3IiLCJyZW1vdmVDb252ZXJzaW9uIiwiVkFMSURBVElORyIsIm1ldGFkYXRhIiwiZ2V0VmlkZW9NZXRhZGF0YSIsIm1ldGFkYXRhRXJyb3JDb2RlIiwicmVtb3ZlZCIsImNvbnZlcnNpb25EYXRhIiwiZ2V0Q29udmVyc2lvbiIsImxvZ1BoYXNlVHJhbnNpdGlvbiIsImZvcmNlUmVmcmVzaCIsImJpbmFyeUVycm9yIiwib3JpZ2luYWxGaWxlUGF0aCIsInRlbXBGaWxlUGF0aCIsImpvaW4iLCJjb3B5IiwiRkFTVF9BVFRFTVBUIiwicGluZ0NvbnZlcnNpb24iLCJQUk9DRVNTSU5HIiwidGh1bWJuYWlscyIsIkVYVFJBQ1RJTkdfQVVESU8iLCJhdWRpb1BhdGgiLCJleHRyYWN0QXVkaW8iLCJ0cmFuc2NyaXB0aW9uIiwidHJhbnNjcmliZSIsIlRSQU5TQ1JJQklORyIsInRyYW5zY3JpcHRpb25PcHRpb25zIiwibGFuZ3VhZ2UiLCJ0cmFuc2NyaWJlQXVkaW8iLCJ0ZXh0IiwidHJpbSIsIkNPTlRFTlRfRU1QVFkiLCJsZW5ndGgiLCJtYXJrZG93biIsImdlbmVyYXRlTWFya2Rvd24iLCJ3cml0ZUZpbGUiLCJDT01QTEVURUQiLCJyZXN1bHQiLCJsb2dDb252ZXJzaW9uQ29tcGxldGUiLCJ3cml0ZUVycm9yIiwiZXJyb3JDb2RlIiwic2FuaXRpemVkRXJyb3IiLCJFUlJPUiIsIlByb21pc2UiLCJyZWplY3QiLCJjb21tYW5kIiwiaW5wdXQiLCJmZnByb2JlIiwibWV0YWRhdGFFcnJvciIsInZpZGVvU3RyZWFtIiwic3RyZWFtcyIsImZpbmQiLCJzIiwiY29kZWNfdHlwZSIsImF1ZGlvU3RyZWFtIiwibm9TdHJlYW1FcnJvciIsImZvcm1hdCIsImZvcm1hdF9uYW1lIiwiZHVyYXRpb24iLCJzaXplIiwiYml0cmF0ZSIsImJpdF9yYXRlIiwiZmlsZW5hbWUiLCJ2aWRlbyIsImNvZGVjIiwiY29kZWNfbmFtZSIsIndpZHRoIiwiaGVpZ2h0IiwiZnJhbWVSYXRlIiwicGFyc2VGcmFtZVJhdGUiLCJyX2ZyYW1lX3JhdGUiLCJhc3BlY3RSYXRpbyIsImRpc3BsYXlfYXNwZWN0X3JhdGlvIiwiYXVkaW8iLCJjaGFubmVscyIsInNhbXBsZVJhdGUiLCJzYW1wbGVfcmF0ZSIsInBhcnRzIiwic3BsaXQiLCJNYXRoIiwicm91bmQiLCJwYXJzZUludCIsInBhcnNlRmxvYXQiLCJ2aWRlb1BhdGgiLCJvdXRwdXQiLCJub1ZpZGVvIiwiYXVkaW9Db2RlYyIsImF1ZGlvQml0cmF0ZSIsImNvbW1hbmRMaW5lIiwiSlNPTiIsInN0cmluZ2lmeSIsImV4dHJhY3Rpb25FcnJvciIsIm9yaWdpbmFsRXJyb3IiLCJydW4iLCJoYW5kbGVUcmFuc2NyaWJlU3RhcnQiLCJqb2JJZCIsImhhbmRsZVRyYW5zY3JpYmVTdGF0dXMiLCJzZXRUaW1lb3V0IiwidHJhbnNjcmlwdGlvbkVycm9yIiwiY2FuY2VsbGVkRXJyb3IiLCJ0aXRsZSIsInB1c2giLCJmb3JtYXREdXJhdGlvbiIsImZvcm1hdEZpbGVTaXplIiwic2Vjb25kcyIsImhvdXJzIiwiZmxvb3IiLCJtaW51dGVzIiwic2VjcyIsInBhZFN0YXJ0IiwiYnl0ZXMiLCJ1bml0cyIsInVuaXRJbmRleCIsInRvRml4ZWQiLCJzdXBwb3J0c0ZpbGUiLCJleHQiLCJ0b0xvd2VyQ2FzZSIsImluY2x1ZGVzIiwiZ2V0SW5mbyIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsIm1vZHVsZSJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL211bHRpbWVkaWEvVmlkZW9Db252ZXJ0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFZpZGVvQ29udmVydGVyLmpzXHJcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiB2aWRlbyBmaWxlcyB0byBtYXJrZG93biBmb3JtYXQgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogXHJcbiAqIFRoaXMgY29udmVydGVyOlxyXG4gKiAtIFByb2Nlc3NlcyB2aWRlbyBmaWxlcyB1c2luZyBmbHVlbnQtZmZtcGVnXHJcbiAqIC0gRXh0cmFjdHMgbWV0YWRhdGEgKGR1cmF0aW9uLCByZXNvbHV0aW9uLCBldGMuKVxyXG4gKiAtIEV4dHJhY3RzIGF1ZGlvIGZvciB0cmFuc2NyaXB0aW9uXHJcbiAqIC0gSW50ZWdyYXRlcyB3aXRoIFRyYW5zY3JpYmVyU2VydmljZSBmb3IgYXVkaW8gdHJhbnNjcmlwdGlvblxyXG4gKiAtIEdlbmVyYXRlcyBtYXJrZG93biB3aXRoIHZpZGVvIGluZm9ybWF0aW9uIGFuZCB0cmFuc2NyaXB0aW9uXHJcbiAqIFxyXG4gKiBSZWxhdGVkIEZpbGVzOlxyXG4gKiAtIEJhc2VTZXJ2aWNlLmpzOiBQYXJlbnQgY2xhc3MgcHJvdmlkaW5nIElQQyBoYW5kbGluZ1xyXG4gKiAtIEZpbGVQcm9jZXNzb3JTZXJ2aWNlLmpzOiBVc2VkIGZvciBmaWxlIG9wZXJhdGlvbnMgKE5vdGU6IENvbnNpZGVyIGNvbnNvbGlkYXRpbmcgZmlsZSBvcGVyYXRpb25zIHVuZGVyIEZpbGVTeXN0ZW1TZXJ2aWNlKVxyXG4gKiAtIFRyYW5zY3JpYmVyU2VydmljZS5qczogVXNlZCBmb3IgYXVkaW8gdHJhbnNjcmlwdGlvblxyXG4gKiAtIEZpbGVTeXN0ZW1TZXJ2aWNlLmpzOiBGb3IgZmlsZSBvcGVyYXRpb25zIGluY2x1ZGluZyB0ZW1wb3JhcnkgZmlsZSBtYW5hZ2VtZW50XHJcbiAqIC0gQ29udmVyc2lvbkxvZ2dlci5qczogUHJvdmlkZXMgc3RhbmRhcmRpemVkIGxvZ2dpbmdcclxuICogLSBDb252ZXJzaW9uU3RhdHVzLmpzOiBEZWZpbmVzIHBpcGVsaW5lIHN0YWdlcyBhbmQgc3RhdHVzIGNvbnN0YW50c1xyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcclxuY29uc3QgZmZtcGVnID0gcmVxdWlyZSgnZmx1ZW50LWZmbXBlZycpO1xyXG5jb25zdCB7IGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgeyBzcGF3biB9ID0gcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpO1xyXG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL0Jhc2VTZXJ2aWNlJyk7XHJcbmNvbnN0IHsgdjQ6IHV1aWR2NCB9ID0gcmVxdWlyZSgndXVpZCcpOyAvLyBJbXBvcnQgdXVpZCBmb3IgZ2VuZXJhdGluZyBJRHNcclxuY29uc3QgQmluYXJ5UGF0aFJlc29sdmVyID0gcmVxdWlyZSgnLi4vLi4vLi4vdXRpbHMvQmluYXJ5UGF0aFJlc29sdmVyJyk7XHJcbmNvbnN0IHsgZ2V0TG9nZ2VyIH0gPSByZXF1aXJlKCcuLi8uLi8uLi91dGlscy9sb2dnaW5nL0NvbnZlcnNpb25Mb2dnZXInKTtcclxuY29uc3QgeyBzYW5pdGl6ZUZvckxvZ2dpbmcgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL3V0aWxzL2xvZ2dpbmcvTG9nU2FuaXRpemVyJyk7XHJcbmNvbnN0IENvbnZlcnNpb25TdGF0dXMgPSByZXF1aXJlKCcuLi8uLi8uLi91dGlscy9jb252ZXJzaW9uL0NvbnZlcnNpb25TdGF0dXMnKTtcclxuXHJcbmNsYXNzIFZpZGVvQ29udmVydGVyIGV4dGVuZHMgQmFzZVNlcnZpY2Uge1xyXG4gICAgY29uc3RydWN0b3IocmVnaXN0cnksIGZpbGVQcm9jZXNzb3IsIHRyYW5zY3JpYmVyLCBmaWxlU3lzdGVtKSB7IC8vIFVzZSBmaWxlU3lzdGVtIGluc3RlYWQgb2YgZmlsZVN0b3JhZ2VcclxuICAgICAgICBzdXBlcigpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0cnkgPSByZWdpc3RyeTsgLy8gU3RvcmUgcmVnaXN0cnkgaW5zdGFuY2VcclxuICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yOyAvLyBUT0RPOiBDb25zb2xpZGF0ZSBmaWxlIG9wZXJhdGlvbnM/XHJcbiAgICAgICAgdGhpcy50cmFuc2NyaWJlciA9IHRyYW5zY3JpYmVyO1xyXG4gICAgICAgIHRoaXMuZmlsZVN5c3RlbSA9IGZpbGVTeXN0ZW07IC8vIFVzZSBmaWxlU3lzdGVtIGluc3RhbmNlXHJcbiAgICAgICAgdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zID0gWycubXA0JywgJy5tb3YnLCAnLmF2aScsICcubWt2JywgJy53ZWJtJywgJy5mbHYnLCAnLndtdiddO1xyXG4gICAgICAgIC8vIFJlbW92ZSBpbnRlcm5hbCBhY3RpdmVDb252ZXJzaW9ucyBtYXAgLSB1c2VzIHJlZ2lzdHJ5J3MgbWFwXHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gSW5pdGlhbGl6ZSB0aGUgbG9nZ2VyXHJcbiAgICAgICAgdGhpcy5sb2dnZXIgPSBnZXRMb2dnZXIoJ1ZpZGVvQ29udmVydGVyJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ29uZmlndXJlIGZmbXBlZyB0byB1c2UgdGhlIGNvcnJlY3QgZmZwcm9iZSBwYXRoXHJcbiAgICAgICAgdGhpcy5jb25maWd1cmVGZm1wZWcoKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBDb25maWd1cmUgZmZtcGVnIHdpdGggdGhlIGNvcnJlY3QgZmZtcGVnIGFuZCBmZnByb2JlIHBhdGhzIHVzaW5nIEJpbmFyeVBhdGhSZXNvbHZlclxyXG4gICAgICogVGhpcyBtZXRob2QgdXNlcyB0aGUgQmluYXJ5UGF0aFJlc29sdmVyIG1vZHVsZSB0byBsb2NhdGUgYmluYXJpZXMgaW4gYm90aCBkZXZlbG9wbWVudFxyXG4gICAgICogYW5kIHByb2R1Y3Rpb24gZW52aXJvbm1lbnRzIHdpdGggbXVsdGlwbGUgZmFsbGJhY2sgc3RyYXRlZ2llcy5cclxuICAgICAqXHJcbiAgICAgKiBUaGUgbWV0aG9kIGhhbmRsZXMgZXJyb3JzIGdyYWNlZnVsbHkgYW5kIHByb3ZpZGVzIGRldGFpbGVkIGxvZ2dpbmcgZm9yIHRyb3VibGVzaG9vdGluZy5cclxuICAgICAqL1xyXG4gICAgY29uZmlndXJlRmZtcGVnKCkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ0NvbmZpZ3VyaW5nIGZmbXBlZyBhbmQgZmZwcm9iZSBwYXRocyB1c2luZyBCaW5hcnlQYXRoUmVzb2x2ZXInLCB7IHBoYXNlOiBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5TVEFSVElORyB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFJlc29sdmUgZmZtcGVnIGJpbmFyeSBwYXRoXHJcbiAgICAgICAgICAgIGNvbnN0IGZmbXBlZ1BhdGggPSBCaW5hcnlQYXRoUmVzb2x2ZXIucmVzb2x2ZUJpbmFyeVBhdGgoJ2ZmbXBlZycpO1xyXG4gICAgICAgICAgICBpZiAoIWZmbXBlZ1BhdGgpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIHJlc29sdmUgZmZtcGVnIGJpbmFyeSBwYXRoLiBWaWRlbyBjb252ZXJzaW9uIHdpbGwgbm90IHdvcmsuJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgU3VjY2Vzc2Z1bGx5IHJlc29sdmVkIGZmbXBlZyBiaW5hcnkgYXQ6ICR7ZmZtcGVnUGF0aH1gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFJlc29sdmUgZmZwcm9iZSBiaW5hcnkgcGF0aFxyXG4gICAgICAgICAgICBjb25zdCBmZnByb2JlUGF0aCA9IEJpbmFyeVBhdGhSZXNvbHZlci5yZXNvbHZlQmluYXJ5UGF0aCgnZmZwcm9iZScpO1xyXG4gICAgICAgICAgICBpZiAoIWZmcHJvYmVQYXRoKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byByZXNvbHZlIGZmcHJvYmUgYmluYXJ5IHBhdGguIFZpZGVvIG1ldGFkYXRhIGV4dHJhY3Rpb24gd2lsbCBub3Qgd29yay4nKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTdWNjZXNzZnVsbHkgcmVzb2x2ZWQgZmZwcm9iZSBiaW5hcnkgYXQ6ICR7ZmZwcm9iZVBhdGh9YCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBTZXQgdGhlIHBhdGhzIGZvciBmbHVlbnQtZmZtcGVnIHVzaW5nIGJvdGggbWV0aG9kcyAobGlicmFyeSBmdW5jdGlvbiBhbmQgZW52aXJvbm1lbnQgdmFyaWFibGVzKVxyXG4gICAgICAgICAgICBmZm1wZWcuc2V0RmZtcGVnUGF0aChmZm1wZWdQYXRoKTtcclxuICAgICAgICAgICAgZmZtcGVnLnNldEZmcHJvYmVQYXRoKGZmcHJvYmVQYXRoKTtcclxuICAgICAgICAgICAgcHJvY2Vzcy5lbnYuRkZNUEVHX1BBVEggPSBmZm1wZWdQYXRoO1xyXG4gICAgICAgICAgICBwcm9jZXNzLmVudi5GRlBST0JFX1BBVEggPSBmZnByb2JlUGF0aDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEZvcmNlIG92ZXJyaWRlIHRoZSBmZm1wZWctc3RhdGljIHBhdGggdG8gcHJldmVudCBhbnkgZGlyZWN0IHJlZmVyZW5jZXNcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIC8vIFRoaXMgaXMgYSBoYWNrIHRvIG92ZXJyaWRlIGFueSBkaXJlY3QgcmVmZXJlbmNlcyB0byBmZm1wZWctc3RhdGljXHJcbiAgICAgICAgICAgICAgICAvLyBJdCBhdHRlbXB0cyB0byBtb2RpZnkgdGhlIHJlcXVpcmUgY2FjaGUgdG8gcmVkaXJlY3QgZmZtcGVnLXN0YXRpYyB0byBvdXIgcmVzb2x2ZWQgcGF0aFxyXG4gICAgICAgICAgICAgICAgY29uc3QgZmZtcGVnU3RhdGljUGF0aCA9IHJlcXVpcmUucmVzb2x2ZSgnZmZtcGVnLXN0YXRpYycpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGZmbXBlZ1N0YXRpY1BhdGggJiYgcmVxdWlyZS5jYWNoZVtmZm1wZWdTdGF0aWNQYXRoXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBPdmVycmlkaW5nIGZmbXBlZy1zdGF0aWMgbW9kdWxlIHBhdGggaW4gcmVxdWlyZSBjYWNoZWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmUuY2FjaGVbZmZtcGVnU3RhdGljUGF0aF0uZXhwb3J0cyA9IGZmbXBlZ1BhdGg7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgLy8gVGhpcyBpcyBub3QgY3JpdGljYWwsIGp1c3QgbG9nIGl0XHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ291bGQgbm90IG92ZXJyaWRlIGZmbXBlZy1zdGF0aWMgbW9kdWxlICh0aGlzIGlzIG5vcm1hbCBpbiBwcm9kdWN0aW9uKTogJHtlcnIubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gVmVyaWZ5IHRoYXQgZmZtcGVnIGlzIHdvcmtpbmcgYnkgY2hlY2tpbmcgZm9ybWF0c1xyXG4gICAgICAgICAgICB0aGlzLnZlcmlmeUZmbXBlZ1dvcmtzKGZmbXBlZ1BhdGgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnQmluYXJ5IHBhdGhzIGNvbmZpZ3VyZWQgc3VjY2Vzc2Z1bGx5OicpO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAtIGZmbXBlZzogJHtmZm1wZWdQYXRofWApO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAtIGZmcHJvYmU6ICR7ZmZwcm9iZVBhdGh9YCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIGNvbmZpZ3VyaW5nIGZmbXBlZzogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRXJyb3Igc3RhY2s6ICR7ZXJyb3Iuc3RhY2t9YCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFdmVuIHRob3VnaCB3ZSBsb2cgdGhlIGVycm9yLCB3ZSBkb24ndCB0aHJvdyBpdCBoZXJlIHRvIGFsbG93IHRoZSBzZXJ2aWNlIHRvIGluaXRpYWxpemVcclxuICAgICAgICAgICAgLy8gVGhlIGFjdHVhbCBjb252ZXJzaW9uIG1ldGhvZHMgd2lsbCBoYW5kbGUgdGhlIG1pc3NpbmcgYmluYXJpZXMgZ3JhY2VmdWxseVxyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdTZXJ2aWNlIHdpbGwgaW5pdGlhbGl6ZSBidXQgY29udmVyc2lvbnMgbWF5IGZhaWwnKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogVmVyaWZ5IHRoYXQgZmZtcGVnIGlzIHdvcmtpbmcgYnkgY2hlY2tpbmcgZm9ybWF0c1xyXG4gICAgICogVGhpcyBtZXRob2QgdXNlcyBkaXJlY3QgY2hpbGRfcHJvY2Vzcy5zcGF3biBpbnN0ZWFkIG9mIGZsdWVudC1mZm1wZWdcclxuICAgICAqIHRvIGVuc3VyZSB3ZSdyZSB1c2luZyB0aGUgY29ycmVjdCBiaW5hcnkgcGF0aFxyXG4gICAgICpcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmZm1wZWdQYXRoIC0gUGF0aCB0byBmZm1wZWcgYmluYXJ5XHJcbiAgICAgKiBAcHJpdmF0ZVxyXG4gICAgICovXHJcbiAgICB2ZXJpZnlGZm1wZWdXb3JrcyhmZm1wZWdQYXRoKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgVmVyaWZ5aW5nIGZmbXBlZyB3b3JrcyBieSBjaGVja2luZyBmb3JtYXRzOiAke2ZmbXBlZ1BhdGh9YCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBVc2Ugc3Bhd24gZGlyZWN0bHkgd2l0aCB0aGUgcmVzb2x2ZWQgcGF0aCBpbnN0ZWFkIG9mIHJlbHlpbmcgb24gZmx1ZW50LWZmbXBlZ1xyXG4gICAgICAgICAgICBjb25zdCBwcm9jZXNzID0gc3Bhd24oZmZtcGVnUGF0aCwgWyctZm9ybWF0cyddKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEp1c3QgbG9nIHRoYXQgd2UncmUgY2hlY2tpbmcsIHdlIGRvbid0IG5lZWQgdG8gd2FpdCBmb3IgdGhlIHJlc3VsdFxyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgU3Bhd25lZCBmZm1wZWcgcHJvY2VzcyB0byBjaGVjayBmb3JtYXRzYCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBBZGQgbGlzdGVuZXJzIHRvIGxvZyBvdXRwdXQgYnV0IGRvbid0IGJsb2NrXHJcbiAgICAgICAgICAgIHByb2Nlc3Muc3Rkb3V0Lm9uKCdkYXRhJywgKGRhdGEpID0+IHtcclxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBmZm1wZWcgZm9ybWF0cyBjaGVjayBvdXRwdXQ6ICR7ZGF0YS50b1N0cmluZygpLnN1YnN0cmluZygwLCAxMDApfS4uLmApO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcclxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBmZm1wZWcgZm9ybWF0cyBjaGVjayBzdGRlcnI6ICR7ZGF0YS50b1N0cmluZygpLnN1YnN0cmluZygwLCAxMDApfS4uLmApO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHByb2Nlc3Mub24oJ2Vycm9yJywgKGVycikgPT4ge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIHZlcmlmeWluZyBmZm1wZWc6ICR7ZXJyLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgVGhpcyBtYXkgaW5kaWNhdGUgYSBwYXRoIHJlc29sdXRpb24gaXNzdWUgd2l0aCBmZm1wZWdgKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBwcm9jZXNzLm9uKCdjbG9zZScsIChjb2RlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBmZm1wZWcgZm9ybWF0cyBjaGVjayBleGl0ZWQgd2l0aCBjb2RlICR7Y29kZX1gKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhaWxlZCB0byB2ZXJpZnkgZmZtcGVnOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogU2V0IHVwIElQQyBoYW5kbGVycyBmb3IgdmlkZW8gY29udmVyc2lvblxyXG4gICAgICovXHJcbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnZpZGVvJywgdGhpcy5oYW5kbGVDb252ZXJ0LmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnZpZGVvOm1ldGFkYXRhJywgdGhpcy5oYW5kbGVHZXRNZXRhZGF0YS5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDp2aWRlbzpjYW5jZWwnLCB0aGlzLmhhbmRsZUNhbmNlbC5iaW5kKHRoaXMpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSB2aWRlbyBjb252ZXJzaW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb252ZXJzaW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDb252ZXJ0KGV2ZW50LCB7IGZpbGVQYXRoLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIGNvbnN0IGNvbnZlcnNpb25JZCA9IGB2aWRlb18ke3V1aWR2NCgpfWA7IC8vIEdlbmVyYXRlIHVuaXF1ZSBJRFxyXG4gICAgICAgIGNvbnN0IGZpbGVUeXBlID0gcGF0aC5leHRuYW1lKGZpbGVQYXRoKS5zdWJzdHJpbmcoMSk7IC8vIEdldCBmaWxlIGV4dGVuc2lvbiB3aXRob3V0IGRvdFxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFZhbGlkYXRlIG91dHB1dCBwYXRoIGlmIHByb3ZpZGVkXHJcbiAgICAgICAgaWYgKG9wdGlvbnMub3V0cHV0UGF0aCkge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgb3V0cHV0RGlyID0gcGF0aC5kaXJuYW1lKG9wdGlvbnMub3V0cHV0UGF0aCk7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBmcy5lbnN1cmVEaXIob3V0cHV0RGlyKTtcclxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFZhbGlkYXRlZCBvdXRwdXQgZGlyZWN0b3J5OiAke291dHB1dERpcn1gKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNldHVwRXJyb3IgPSBuZXcgRXJyb3IoYEludmFsaWQgb3V0cHV0IHBhdGg6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIHNldHVwRXJyb3IuY29kZSA9ICdFX1NFVFVQJzsgLy8gQWRkIGVycm9yIGNvZGVcclxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBbJHtzZXR1cEVycm9yLmNvZGV9XSAke3NldHVwRXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIC8vIFJldHVybiBhIHN0cnVjdHVyZWQgZXJyb3IgZm9yIHNldHVwIGZhaWx1cmVzXHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvZGU6IHNldHVwRXJyb3IuY29kZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogc2V0dXBFcnJvci5tZXNzYWdlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZXRhaWxzOiBlcnJvci5zdGFjayAvLyBJbmNsdWRlIG9yaWdpbmFsIHN0YWNrXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBJbml0aWFsaXplIGxvZ2dlciB3aXRoIGNvbnRleHQgZm9yIHRoaXMgY29udmVyc2lvblxyXG4gICAgICAgIHRoaXMubG9nZ2VyLnNldENvbnRleHQoe1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgIGZpbGVUeXBlLFxyXG4gICAgICAgICAgICBvdXRwdXRQYXRoOiBvcHRpb25zLm91dHB1dFBhdGhcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uU3RhcnQoZmlsZVR5cGUsIG9wdGlvbnMpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEdldCB3aW5kb3cgcmVmZXJlbmNlIHNhZmVseSwgaGFuZGxpbmcgbnVsbCBldmVudFxyXG4gICAgICAgIGNvbnN0IHdpbmRvdyA9IGV2ZW50Py5zZW5kZXI/LmdldE93bmVyQnJvd3NlcldpbmRvdygpOyBcclxuICAgICAgICBsZXQgdGVtcERpciA9IG9wdGlvbnMuX3RlbXBEaXI7IC8vIENoZWNrIGlmIHRlbXBEaXIgd2FzIHBhc3NlZCBieSB0aGUgd3JhcHBlclxyXG4gICAgICAgIGxldCBvdXRwdXRQYXRoID0gb3B0aW9ucy5vdXRwdXRQYXRoOyAvLyBHZXQgb3V0cHV0IHBhdGggZnJvbSBvcHRpb25zXHJcblxyXG4gICAgICAgIGxldCBjcmVhdGVkVGVtcERpciA9IGZhbHNlOyAvLyBGbGFnIHRvIHRyYWNrIGlmIHdlIGNyZWF0ZWQgdGhlIHRlbXAgZGlyIGhlcmVcclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgLy8gQ3JlYXRlIHRlbXAgZGlyZWN0b3J5IG9ubHkgaWYgbm90IHBhc3NlZCBieSB0aGUgd3JhcHBlclxyXG4gICAgICAgICAgICBpZiAoIXRlbXBEaXIpIHtcclxuICAgICAgICAgICAgICAgIC8vIFVzZSB0aGUgbmV3IEZpbGVTeXN0ZW1TZXJ2aWNlIG1ldGhvZCB0byBjcmVhdGUgYSBtYW5hZ2VkIHRlbXBvcmFyeSBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgIHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0uY3JlYXRlVGVtcG9yYXJ5RGlyZWN0b3J5KCd2aWRlb19jb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDcmVhdGVkIG1hbmFnZWQgdGVtcG9yYXJ5IGRpcmVjdG9yeTogJHt0ZW1wRGlyfWAsIHsgcGhhc2U6ICdzZXR1cCcgfSk7XHJcbiAgICAgICAgICAgICAgICBjcmVhdGVkVGVtcERpciA9IHRydWU7IC8vIE1hcmsgdGhhdCB3ZSBjcmVhdGVkIGl0XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBVc2luZyB0ZW1wb3JhcnkgZGlyZWN0b3J5IHByb3ZpZGVkIGJ5IHdyYXBwZXI6ICR7dGVtcERpcn1gLCB7IHBoYXNlOiAnc2V0dXAnIH0pO1xyXG4gICAgICAgICAgICAgICAgLy8gTm90ZTogSWYgcHJvdmlkZWQgYnkgd3JhcHBlciwgaXRzIGxpZmVjeWNsZSBpcyBtYW5hZ2VkIGV4dGVybmFsbHlcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gUmVnaXN0ZXIgdGhlIGNvbnZlcnNpb24gd2l0aCB0aGUgY2VudHJhbCByZWdpc3RyeVxyXG4gICAgICAgICAgICB0aGlzLnJlZ2lzdHJ5LnJlZ2lzdGVyQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHtcclxuICAgICAgICAgICAgICAgIGlkOiBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICB0eXBlOiAndmlkZW8nLFxyXG4gICAgICAgICAgICAgICAgbmFtZTogcGF0aC5iYXNlbmFtZShmaWxlUGF0aCksXHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6IENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlNUQVJUSU5HLFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDAsXHJcbiAgICAgICAgICAgICAgICBmaWxlUGF0aCwgLy8gU3RvcmUgb3JpZ2luYWwgcGF0aCBpZiBuZWVkZWQsIGJ1dCBwcm9jZXNzIHRlbXAgZmlsZVxyXG4gICAgICAgICAgICAgICAgdGVtcERpcixcclxuICAgICAgICAgICAgICAgIHdpbmRvdyxcclxuICAgICAgICAgICAgICAgIHN0YXJ0VGltZTogRGF0ZS5ub3coKSxcclxuICAgICAgICAgICAgICAgIG91dHB1dFBhdGg6IG9wdGlvbnMub3V0cHV0UGF0aCAvLyBTdG9yZSBvdXRwdXQgcGF0aCBpbiByZWdpc3RyeVxyXG4gICAgICAgICAgICB9LCBhc3luYyAoKSA9PiB7IC8vIEVuc3VyZSBjYWxsYmFjayBpcyBhc3luY1xyXG4gICAgICAgICAgICAgICAgLy8gQ2xlYW51cCBmdW5jdGlvbiBmb3IgdGhlIHJlZ2lzdHJ5IC0gUmVsZWFzZSB0aGUgbWFuYWdlZCB0ZW1wb3JhcnkgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICAvLyBPbmx5IHJlbGVhc2UgaWYgdGhpcyBpbnN0YW5jZSBjcmVhdGVkIGl0IChjcmVhdGVkVGVtcERpciBmbGFnKVxyXG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgY3JlYXRlZFRlbXBEaXIgaXMgZGVmaW5lZCBhbmQgdHJ1ZSBiZWZvcmUgcmVsZWFzaW5nXHJcbiAgICAgICAgICAgICAgICBpZiAodGVtcERpciAmJiB0eXBlb2YgY3JlYXRlZFRlbXBEaXIgIT09ICd1bmRlZmluZWQnICYmIGNyZWF0ZWRUZW1wRGlyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgUmVsZWFzaW5nIG1hbmFnZWQgdGVtcG9yYXJ5IGRpcmVjdG9yeSB2aWEgcmVnaXN0cnkgY2xlYW51cDogJHt0ZW1wRGlyfWAsIHsgcGhhc2U6ICdjbGVhbnVwJyB9KTtcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0ucmVsZWFzZVRlbXBvcmFyeURpcmVjdG9yeSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgU3VjY2Vzc2Z1bGx5IHJlbGVhc2VkIHRlbXBvcmFyeSBkaXJlY3Rvcnk6ICR7dGVtcERpcn1gLCB7IHBoYXNlOiAnY2xlYW51cCcgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBFcnJvciByZWxlYXNpbmcgdGVtcG9yYXJ5IGRpcmVjdG9yeSAke3RlbXBEaXJ9IGR1cmluZyByZWdpc3RyeSBjbGVhbnVwOiAke2NsZWFudXBFcnJvci5tZXNzYWdlfWAsIHsgcGhhc2U6ICdjbGVhbnVwJyB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRlbXBEaXIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgVGVtcG9yYXJ5IGRpcmVjdG9yeSAke3RlbXBEaXJ9IHdhcyBwcm92aWRlZCBleHRlcm5hbGx5IG9yIG5vdCBjcmVhdGVkIGJ5IHRoaXMgaW5zdGFuY2UsIHNraXBwaW5nIHJlbGVhc2UgdmlhIHJlZ2lzdHJ5IGNsZWFudXAuYCwgeyBwaGFzZTogJ2NsZWFudXAnIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIC8vIE5vdGlmeSBjbGllbnQgdGhhdCBjb252ZXJzaW9uIGhhcyBzdGFydGVkLCBvbmx5IGlmIHdpbmRvdyBpcyBhdmFpbGFibGVcclxuICAgICAgICAgICAgaWYgKHdpbmRvdykge1xyXG4gICAgICAgICAgICAgICAgd2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ3ZpZGVvOmNvbnZlcnNpb24tc3RhcnRlZCcsIHsgY29udmVyc2lvbklkIH0pO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgV2luZG93IG5vdCBhdmFpbGFibGUgZm9yIGNvbnZlcnNpb24gJHtjb252ZXJzaW9uSWR9LCBza2lwcGluZyBpbml0aWFsIG5vdGlmaWNhdGlvbi5gKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gU3RhcnQgY29udmVyc2lvbiBwcm9jZXNzIGFzeW5jaHJvbm91c2x5IChmaXJlIGFuZCBmb3JnZXQgLSByZXN1bHQgaGFuZGxlZCB2aWEgcmVnaXN0cnkvSVBDKVxyXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgZmlsZVBhdGgsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICAvLyBObyAuY2F0Y2goKSBoZXJlOyBwcm9jZXNzQ29udmVyc2lvbiBoYW5kbGVzIGl0cyBvd24gZXJyb3JzIGFuZCByZWdpc3RyeSB1cGRhdGVzLlxyXG5cclxuICAgICAgICAgICAgLy8gUmV0dXJuIHN1Y2Nlc3MgKmluaXRpYXRpb24qIHJlc3BvbnNlXHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGNvbnZlcnNpb25JZCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHNldHVwRXJyb3JDb2RlID0gZXJyb3IuY29kZSB8fCAnRV9TRVRVUF9VTkVYUEVDVEVEJztcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvbkVycm9yKGZpbGVUeXBlLCBlcnJvciwgeyBwaGFzZTogJ2Vycm9yX3NldHVwJywgY29kZTogc2V0dXBFcnJvckNvZGUgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFbnN1cmUgY2xlYW51cCBpZiB0ZW1wRGlyIHdhcyBjcmVhdGVkICpieSB0aGlzIGluc3RhbmNlKiBiZWZvcmUgdGhlIGVycm9yIG9jY3VycmVkIGR1cmluZyBzZXR1cFxyXG4gICAgICAgICAgICBpZiAodGVtcERpciAmJiB0eXBlb2YgY3JlYXRlZFRlbXBEaXIgIT09ICd1bmRlZmluZWQnICYmIGNyZWF0ZWRUZW1wRGlyKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBFcnJvciBkdXJpbmcgaW5pdGlhbCBzZXR1cCBmb3IgJHtjb252ZXJzaW9uSWR9LiBSZWxlYXNpbmcgdGVtcG9yYXJ5IGRpcmVjdG9yeTogJHt0ZW1wRGlyfWAsIHsgcGhhc2U6ICdlcnJvcl9jbGVhbnVwJyB9KTtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLnJlbGVhc2VUZW1wb3JhcnlEaXJlY3RvcnkodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgU3VjY2Vzc2Z1bGx5IHJlbGVhc2VkIHRlbXBvcmFyeSBkaXJlY3RvcnkgYWZ0ZXIgc2V0dXAgZXJyb3I6ICR7dGVtcERpcn1gLCB7IHBoYXNlOiAnZXJyb3JfY2xlYW51cCcgfSk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgcmVsZWFzaW5nIHRlbXBvcmFyeSBkaXJlY3RvcnkgJHt0ZW1wRGlyfSBkdXJpbmcgc2V0dXAgZXJyb3IgaGFuZGxpbmc6ICR7Y2xlYW51cEVycm9yLm1lc3NhZ2V9YCwgeyBwaGFzZTogJ2Vycm9yX2NsZWFudXAnIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIFJlbW92ZSBmcm9tIHJlZ2lzdHJ5IGlmIGl0IHdhcyBhZGRlZCBiZWZvcmUgZXJyb3JcclxuICAgICAgICAgICAgLy8gTm90ZTogcmVtb3ZlQ29udmVyc2lvbiB0cmlnZ2VycyB0aGUgY2xlYW51cCBjYWxsYmFjayBkZWZpbmVkIGFib3ZlLFxyXG4gICAgICAgICAgICAvLyB3aGljaCBub3cgYWxzbyBjaGVja3MgdGhlIGNyZWF0ZWRUZW1wRGlyIGZsYWcuXHJcbiAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucmVtb3ZlQ29udmVyc2lvbihjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gUmV0dXJuIGEgc3RydWN0dXJlZCBlcnJvciBvYmplY3QgaW5zdGVhZCBvZiB0aHJvd2luZ1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICBlcnJvcjoge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvZGU6IHNldHVwRXJyb3JDb2RlLFxyXG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGBWaWRlbyBjb252ZXJzaW9uIHNldHVwIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWAsXHJcbiAgICAgICAgICAgICAgICAgICAgZGV0YWlsczogZXJyb3Iuc3RhY2tcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgdmlkZW8gbWV0YWRhdGEgcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIE1ldGFkYXRhIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVHZXRNZXRhZGF0YShldmVudCwgeyBmaWxlUGF0aCB9KSB7XHJcbiAgICAgICAgY29uc3QgZmlsZVR5cGUgPSBwYXRoLmV4dG5hbWUoZmlsZVBhdGgpLnN1YnN0cmluZygxKTsgLy8gR2V0IGZpbGUgZXh0ZW5zaW9uIHdpdGhvdXQgZG90XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgR2V0dGluZyBtZXRhZGF0YSBmb3IgJHtmaWxlUGF0aH1gLCB7IGZpbGVUeXBlLCBwaGFzZTogQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuVkFMSURBVElORyB9KTtcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB0aGlzLmdldFZpZGVvTWV0YWRhdGEoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTdWNjZXNzZnVsbHkgcmV0cmlldmVkIG1ldGFkYXRhYCwgeyBmaWxlVHlwZSwgcGhhc2U6IENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlZBTElEQVRJTkcgfSk7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIG1ldGFkYXRhIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGFFcnJvckNvZGUgPSBlcnJvci5jb2RlIHx8ICdFX01FVEFEQVRBX0ZBSUxFRCc7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBbJHttZXRhZGF0YUVycm9yQ29kZX1dIEZhaWxlZCB0byBnZXQgbWV0YWRhdGE6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGZpbGVUeXBlIH0pO1xyXG4gICAgICAgICAgICAvLyBSZXR1cm4gc3RydWN0dXJlZCBlcnJvciBpbnN0ZWFkIG9mIHRocm93aW5nXHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGVycm9yOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29kZTogbWV0YWRhdGFFcnJvckNvZGUsXHJcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogYEZhaWxlZCB0byBnZXQgdmlkZW8gbWV0YWRhdGE6ICR7ZXJyb3IubWVzc2FnZX1gLFxyXG4gICAgICAgICAgICAgICAgICAgIGRldGFpbHM6IGVycm9yLnN0YWNrXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBjb252ZXJzaW9uIGNhbmNlbGxhdGlvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ2FuY2VsbGF0aW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDYW5jZWwoZXZlbnQsIHsgY29udmVyc2lvbklkIH0pIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZWNlaXZlZCBjYW5jZWwgcmVxdWVzdCBmb3IgY29udmVyc2lvbjogJHtjb252ZXJzaW9uSWR9YCk7XHJcbiAgICAgICAgY29uc3QgcmVtb3ZlZCA9IHRoaXMucmVnaXN0cnkucmVtb3ZlQ29udmVyc2lvbihjb252ZXJzaW9uSWQpOyAvLyBUaGlzIGFsc28gdHJpZ2dlcnMgY2xlYW51cFxyXG4gICAgICAgIGlmIChyZW1vdmVkKSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbnZlcnNpb24gJHtjb252ZXJzaW9uSWR9IGNhbmNlbGxlZCBhbmQgcmVtb3ZlZCBmcm9tIHJlZ2lzdHJ5LmApO1xyXG4gICAgICAgICAgICAvLyBPcHRpb25hbGx5IG5vdGlmeSB0aGUgd2luZG93IGlmIG5lZWRlZCwgdGhvdWdoIHJlZ2lzdHJ5IG1pZ2h0IGhhbmRsZSB0aGlzXHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb25EYXRhID0gdGhpcy5yZWdpc3RyeS5nZXRDb252ZXJzaW9uKGNvbnZlcnNpb25JZCk7IC8vIFNob3VsZCBiZSBudWxsIG5vd1xyXG4gICAgICAgICAgICBpZiAoY29udmVyc2lvbkRhdGEgJiYgY29udmVyc2lvbkRhdGEud2luZG93KSB7XHJcbiAgICAgICAgICAgICAgICAgY29udmVyc2lvbkRhdGEud2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ3ZpZGVvOmNvbnZlcnNpb24tY2FuY2VsbGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBDb252ZXJzaW9uICR7Y29udmVyc2lvbklkfSBub3QgZm91bmQgaW4gcmVnaXN0cnkgZm9yIGNhbmNlbGxhdGlvbi5gKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogcmVtb3ZlZCB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUHJvY2VzcyB2aWRlbyBjb252ZXJzaW9uXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIHZpZGVvIGZpbGVcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgZmlsZVBhdGgsIG9wdGlvbnMpIHtcclxuICAgICAgICBjb25zdCBmaWxlVHlwZSA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkuc3Vic3RyaW5nKDEpOyAvLyBHZXQgZmlsZSBleHRlbnNpb24gd2l0aG91dCBkb3RcclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5zZXRDb250ZXh0KHsgY29udmVyc2lvbklkLCBmaWxlVHlwZSB9KTtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlNUQVJUSU5HLCBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5WQUxJREFUSU5HKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFZlcmlmeSB0aGF0IGZmbXBlZyBhbmQgZmZwcm9iZSBiaW5hcmllcyBhcmUgYXZhaWxhYmxlIGJlZm9yZSBwcm9jZWVkaW5nXHJcbiAgICAgICAgICAgIGNvbnN0IGZmbXBlZ1BhdGggPSBCaW5hcnlQYXRoUmVzb2x2ZXIucmVzb2x2ZUJpbmFyeVBhdGgoJ2ZmbXBlZycsIHsgZm9yY2VSZWZyZXNoOiBmYWxzZSB9KTtcclxuICAgICAgICAgICAgY29uc3QgZmZwcm9iZVBhdGggPSBCaW5hcnlQYXRoUmVzb2x2ZXIucmVzb2x2ZUJpbmFyeVBhdGgoJ2ZmcHJvYmUnLCB7IGZvcmNlUmVmcmVzaDogZmFsc2UgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoIWZmbXBlZ1BhdGggfHwgIWZmcHJvYmVQYXRoKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBUaHJvdyBzcGVjaWZpYyBlcnJvciB0byBiZSBjYXVnaHQgYmVsb3dcclxuICAgICAgICAgICAgICAgIGNvbnN0IGJpbmFyeUVycm9yID0gbmV3IEVycm9yKCdGRm1wZWcgb3IgRkZwcm9iZSBiaW5hcmllcyBub3QgYXZhaWxhYmxlLiBDYW5ub3QgcHJvY2VlZCB3aXRoIGNvbnZlcnNpb24uJyk7XHJcbiAgICAgICAgICAgICAgICBiaW5hcnlFcnJvci5jb2RlID0gJ0VfTUlTU0lOR19CSU5BUlknO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgYmluYXJ5RXJyb3I7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFVzaW5nIGZmbXBlZyBhdDogJHtmZm1wZWdQYXRofWApO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBVc2luZyBmZnByb2JlIGF0OiAke2ZmcHJvYmVQYXRofWApO1xyXG5cclxuICAgICAgICAgICAgLy8gUmV0cmlldmUgY29udmVyc2lvbiBkYXRhIGZyb20gdGhlIGNlbnRyYWwgcmVnaXN0cnlcclxuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbkRhdGEgPSB0aGlzLnJlZ2lzdHJ5LmdldENvbnZlcnNpb24oY29udmVyc2lvbklkKTtcclxuICAgICAgICAgICAgaWYgKCFjb252ZXJzaW9uRGF0YSkge1xyXG4gICAgICAgICAgICAgICAgLy8gSXQncyBwb3NzaWJsZSB0aGUgY29udmVyc2lvbiB3YXMgY2FuY2VsbGVkIG9yIHRpbWVkIG91dFxyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgQ29udmVyc2lvbiAke2NvbnZlcnNpb25JZH0gbm90IGZvdW5kIGluIHJlZ2lzdHJ5IGR1cmluZyBwcm9jZXNzaW5nLiBJdCBtaWdodCBoYXZlIGJlZW4gY2FuY2VsbGVkIG9yIHRpbWVkIG91dC5gKTtcclxuICAgICAgICAgICAgICAgIC8vIERvbid0IHRocm93IGFuIGVycm9yIGhlcmUsIGp1c3QgZXhpdCBncmFjZWZ1bGx5LiBUaGUgcmVnaXN0cnkgaGFuZGxlcyBjbGVhbnVwLlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuOyAvLyBPciBoYW5kbGUgYXMgYXBwcm9wcmlhdGUsIG1heWJlIHJldHVybiBhIHNwZWNpZmljIHN0YXR1c1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IG91dHB1dFBhdGggZnJvbSBjb252ZXJzaW9uRGF0YVxyXG4gICAgICAgICAgICBsZXQgb3V0cHV0UGF0aCA9IGNvbnZlcnNpb25EYXRhLm91dHB1dFBhdGg7XHJcblxyXG4gICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gY29udmVyc2lvbkRhdGEudGVtcERpcjtcclxuICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxGaWxlUGF0aCA9IGNvbnZlcnNpb25EYXRhLmZpbGVQYXRoOyAvLyBVc2Ugb3JpZ2luYWwgcGF0aCBmb3IgY29udGV4dCBpZiBuZWVkZWRcclxuICAgICAgICAgICAgY29uc3QgdGVtcEZpbGVQYXRoID0gcGF0aC5qb2luKHRlbXBEaXIsIGAke3BhdGguYmFzZW5hbWUob3JpZ2luYWxGaWxlUGF0aCl9XyR7RGF0ZS5ub3coKX0ubXA0YCk7IC8vIE5lZWQgdG8gcmVjb25zdHJ1Y3Qgb3Igc3RvcmUgdGVtcCBwYXRoXHJcblxyXG4gICAgICAgICAgICAvLyBXcml0ZSB0aGUgYWN0dWFsIGZpbGUgY29udGVudCAocGFzc2VkIGFzIGZpbGVQYXRoIGFyZ3VtZW50IGhlcmUpIHRvIHRlbXAgZmlsZVxyXG4gICAgICAgICAgICAvLyBUaGlzIGFzc3VtZXMgZmlsZVBhdGggcGFzc2VkIHRvIHByb2Nlc3NDb252ZXJzaW9uIGlzIHRoZSBhY3R1YWwgY29udGVudCBidWZmZXIgb3IgcGF0aCB0byByZWFkIGZyb21cclxuICAgICAgICAgICAgLy8gTGV0J3MgYXNzdW1lIGZpbGVQYXRoIElTIHRoZSBwYXRoIHRvIHRoZSAqb3JpZ2luYWwqIGZpbGUsIGFuZCB3ZSBuZWVkIHRvIGNvcHkgaXRcclxuICAgICAgICAgICAgYXdhaXQgZnMuY29weShvcmlnaW5hbEZpbGVQYXRoLCB0ZW1wRmlsZVBhdGgpO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDb3BpZWQgb3JpZ2luYWwgZmlsZSB0byB0ZW1wIHBhdGg6ICR7dGVtcEZpbGVQYXRofWApO1xyXG5cclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgVXNpbmcgdGVtcCBkaXJlY3Rvcnk6ICR7dGVtcERpcn1gKTtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgUHJvY2Vzc2luZyB0ZW1wIGZpbGU6ICR7dGVtcEZpbGVQYXRofWApO1xyXG5cclxuICAgICAgICAgICAgLy8gVHJ5IGZhc3QgcGF0aCBmaXJzdFxyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuVkFMSURBVElORywgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRkFTVF9BVFRFTVBUKTtcclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgc3RhdHVzOiBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GQVNUX0FUVEVNUFQsIHByb2dyZXNzOiA1IH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBtZXRhZGF0YVxyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBFeHRyYWN0aW5nIG1ldGFkYXRhIGZyb206ICR7dGVtcEZpbGVQYXRofWApO1xyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHRoaXMuZ2V0VmlkZW9NZXRhZGF0YSh0ZW1wRmlsZVBhdGgpO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBNZXRhZGF0YSBleHRyYWN0ZWQgc3VjY2Vzc2Z1bGx5YCk7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdNZXRhZGF0YSBkZXRhaWxzOicsIHNhbml0aXplRm9yTG9nZ2luZyhtZXRhZGF0YSkpO1xyXG5cclxuICAgICAgICAgICAgLy8gU2tpcCB0aHVtYm5haWwgZ2VuZXJhdGlvblxyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTa2lwcGluZyB0aHVtYm5haWwgZ2VuZXJhdGlvbmAsIHsgcGhhc2U6IENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkcgfSk7XHJcbiAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucGluZ0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB7IHN0YXR1czogQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuUFJPQ0VTU0lORywgcHJvZ3Jlc3M6IDEwIH0pO1xyXG4gICAgICAgICAgICBjb25zdCB0aHVtYm5haWxzID0gW107IC8vIEVtcHR5IGFycmF5IGluc3RlYWQgb2YgZ2VuZXJhdGluZyB0aHVtYm5haWxzXHJcblxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGF1ZGlvIGZvciB0cmFuc2NyaXB0aW9uXHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5QUk9DRVNTSU5HLCBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5FWFRSQUNUSU5HX0FVRElPKTtcclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgc3RhdHVzOiBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5FWFRSQUNUSU5HX0FVRElPLCBwcm9ncmVzczogMzAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBhdWRpb1BhdGggPSBwYXRoLmpvaW4odGVtcERpciwgJ2F1ZGlvLm1wMycpO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBFeHRyYWN0aW5nIGF1ZGlvIHRvOiAke2F1ZGlvUGF0aH1gKTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5leHRyYWN0QXVkaW8odGVtcEZpbGVQYXRoLCBhdWRpb1BhdGgpO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBBdWRpbyBleHRyYWN0ZWQgc3VjY2Vzc2Z1bGx5YCk7XHJcblxyXG4gICAgICAgICAgICAvLyBUcmFuc2NyaWJlIGF1ZGlvIGlmIHJlcXVlc3RlZFxyXG4gICAgICAgICAgICBsZXQgdHJhbnNjcmlwdGlvbiA9IG51bGw7XHJcbiAgICAgICAgICAgIGlmIChvcHRpb25zLnRyYW5zY3JpYmUgIT09IGZhbHNlKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRVhUUkFDVElOR19BVURJTywgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuVFJBTlNDUklCSU5HKTtcclxuICAgICAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucGluZ0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB7IHN0YXR1czogQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuVFJBTlNDUklCSU5HLCBwcm9ncmVzczogNDAgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IHRyYW5zY3JpcHRpb25PcHRpb25zID0gc2FuaXRpemVGb3JMb2dnaW5nKHsgbGFuZ3VhZ2U6IG9wdGlvbnMubGFuZ3VhZ2UgfHwgJ2VuJyB9KTtcclxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFRyYW5zY3JpYmluZyBhdWRpbyB3aXRoIG9wdGlvbnM6YCwgdHJhbnNjcmlwdGlvbk9wdGlvbnMpO1xyXG4gICAgICAgICAgICAgICAgdHJhbnNjcmlwdGlvbiA9IGF3YWl0IHRoaXMudHJhbnNjcmliZUF1ZGlvKGF1ZGlvUGF0aCwgb3B0aW9ucy5sYW5ndWFnZSB8fCAnZW4nKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCF0cmFuc2NyaXB0aW9uIHx8ICF0cmFuc2NyaXB0aW9uLnRleHQgfHwgdHJhbnNjcmlwdGlvbi50ZXh0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuVFJBTlNDUklCSU5HLCBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5DT05URU5UX0VNUFRZKTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgeyBzdGF0dXM6IENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkNPTlRFTlRfRU1QVFksIHByb2dyZXNzOiA4MCB9KTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBUcmFuc2NyaXB0aW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQgLSB0aGlzIGlzIG5vcm1hbCBmb3IgdmlkZW9zIHdpdGhvdXQgc3BlZWNoYCk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVnaXN0cnkucGluZ0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB7IHN0YXR1czogQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuVFJBTlNDUklCSU5HLCBwcm9ncmVzczogODAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgVHJhbnNjcmlwdGlvbiBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5ICgke3RyYW5zY3JpcHRpb24udGV4dC5sZW5ndGh9IGNoYXJhY3RlcnMpYCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICAgICAgICAgIHRyYW5zY3JpcHRpb24gPyBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5UUkFOU0NSSUJJTkcgOiBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5FWFRSQUNUSU5HX0FVRElPLCBcclxuICAgICAgICAgICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkdcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHsgc3RhdHVzOiBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5QUk9DRVNTSU5HLCBwcm9ncmVzczogOTAgfSk7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEdlbmVyYXRpbmcgbWFya2Rvd24gb3V0cHV0YCk7XHJcblxyXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBtYXJrZG93blxyXG4gICAgICAgICAgICBjb25zdCBtYXJrZG93biA9IHRoaXMuZ2VuZXJhdGVNYXJrZG93bihtZXRhZGF0YSwgdGh1bWJuYWlscywgdHJhbnNjcmlwdGlvbiwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYE1hcmtkb3duIGdlbmVyYXRlZCBzdWNjZXNzZnVsbHkgKCR7bWFya2Rvd24ubGVuZ3RofSBjaGFyYWN0ZXJzKWApO1xyXG5cclxuICAgICAgICAgICAgLy8gV3JpdGUgdGhlIG1hcmtkb3duIGNvbnRlbnQgdG8gdGhlIG91dHB1dCBmaWxlXHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAvLyBJZiBvdXRwdXRQYXRoIG5vdCBwcm92aWRlZCwgY3JlYXRlIG9uZSBpbiB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgaWYgKCFvdXRwdXRQYXRoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgb3V0cHV0UGF0aCA9IHBhdGguam9pbih0ZW1wRGlyLCBgJHtwYXRoLmJhc2VuYW1lKGZpbGVQYXRoLCBwYXRoLmV4dG5hbWUoZmlsZVBhdGgpKX0ubWRgKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgV3JpdGluZyBtYXJrZG93biBjb250ZW50IHRvOiAke291dHB1dFBhdGh9YCk7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUob3V0cHV0UGF0aCwgbWFya2Rvd24sICd1dGY4Jyk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTdWNjZXNzZnVsbHkgd3JvdGUgbWFya2Rvd24gY29udGVudCB0byBmaWxlICgke21hcmtkb3duLmxlbmd0aH0gY2hhcmFjdGVycylgKTtcclxuXHJcbiAgICAgICAgICAgICAgICAvLyBVcGRhdGUgcmVnaXN0cnkgd2l0aCBjb21wbGV0ZWQgc3RhdHVzLCByZXN1bHQsIGFuZCBvdXRwdXQgcGF0aFxyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkcsIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkNPTVBMRVRFRCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwge1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuQ09NUExFVEVELFxyXG4gICAgICAgICAgICAgICAgICAgIHByb2dyZXNzOiAxMDAsXHJcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0OiBtYXJrZG93bixcclxuICAgICAgICAgICAgICAgICAgICBvdXRwdXRQYXRoXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uQ29tcGxldGUoZmlsZVR5cGUpO1xyXG4gICAgICAgICAgICB9IGNhdGNoICh3cml0ZUVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBBZGQgc3BlY2lmaWMgY29kZSBmb3IgZmlsZSB3cml0aW5nIGVycm9yc1xyXG4gICAgICAgICAgICAgICAgd3JpdGVFcnJvci5jb2RlID0gd3JpdGVFcnJvci5jb2RlIHx8ICdFX0ZJTEVfV1JJVEUnO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFske3dyaXRlRXJyb3IuY29kZX1dIEZhaWxlZCB0byB3cml0ZSBtYXJrZG93biBjb250ZW50IHRvIGZpbGU6ICR7d3JpdGVFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgLy8gVGhyb3cgdGhlIGVycm9yIHRvIGJlIGNhdWdodCBieSB0aGUgbWFpbiBjYXRjaCBibG9jayBiZWxvd1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gc2F2ZSBjb252ZXJzaW9uIG91dHB1dDogJHt3cml0ZUVycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQ2xlYW51cCBpcyBoYW5kbGVkIGJ5IHRoZSByZWdpc3RyeSdzIHJlbW92ZUNvbnZlcnNpb24gY2FsbCBldmVudHVhbGx5XHJcbiAgICBcclxuICAgICAgICAgICAgICAgIC8vIE9uIHN1Y2Nlc3MsIHByb2Nlc3NDb252ZXJzaW9uIGRvZXNuJ3QgbmVlZCB0byByZXR1cm4gYW55dGhpbmcgaGVyZSxcclxuICAgICAgICAgICAgICAgIC8vIHRoZSByZXN1bHQgaXMgY29tbXVuaWNhdGVkIHZpYSB0aGUgcmVnaXN0cnkgdXBkYXRlIGFib3ZlLlxyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgLy8gRGV0ZXJtaW5lIGVycm9yIGNvZGUsIGRlZmF1bHQgaWYgbm90IHNldFxyXG4gICAgICAgICAgICAgICAgY29uc3QgZXJyb3JDb2RlID0gZXJyb3IuY29kZSB8fCAnRV9WSURFT19DT05WRVJTSU9OX0ZBSUxFRCc7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFNhbml0aXplIGVycm9yIGRldGFpbHMgYmVmb3JlIGxvZ2dpbmdcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNhbml0aXplZEVycm9yID0gc2FuaXRpemVGb3JMb2dnaW5nKHtcclxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0YWNrOiBlcnJvci5zdGFjaywgLy8gS2VlcCBzdGFjayBmb3IgZGV0YWlsZWQgbG9nZ2luZ1xyXG4gICAgICAgICAgICAgICAgICAgIGNvZGU6IGVycm9yQ29kZSAvLyBJbmNsdWRlIHRoZSBjb2RlXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gVXNlIHRoZSBlbmhhbmNlZCBsb2dnZXIgbWV0aG9kIHRoYXQgaW5jbHVkZXMgY29kZVxyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvbkVycm9yKGZpbGVUeXBlLCBzYW5pdGl6ZWRFcnJvciwgeyBjb2RlOiBlcnJvckNvZGUgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSByZWdpc3RyeSB3aXRoIGZhaWxlZCBzdGF0dXMgYW5kIHN0cnVjdHVyZWQgZXJyb3Igb2JqZWN0XHJcbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwge1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRVJST1IsXHJcbiAgICAgICAgICAgICAgICAgICAgZXJyb3I6IHsgLy8gU3RvcmUgc3RydWN0dXJlZCBlcnJvclxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb2RlOiBlcnJvckNvZGUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsIC8vIEtlZXAgb3JpZ2luYWwgbWVzc2FnZSBmb3IgcmVnaXN0cnlcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gT3B0aW9uYWxseSBhZGQgbW9yZSBkZXRhaWxzIGlmIG5lZWRlZCwgYnV0IGtlZXAgaXQgY29uY2lzZSBmb3IgSVBDXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIERvIE5PVCByZS10aHJvdy4gRXJyb3IgaXMgaGFuZGxlZCBieSB1cGRhdGluZyB0aGUgcmVnaXN0cnkuXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAvKipcclxuICAgICAqIEdldCB2aWRlbyBmaWxlIG1ldGFkYXRhXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIHZpZGVvIGZpbGVcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IFZpZGVvIG1ldGFkYXRhXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGdldFZpZGVvTWV0YWRhdGEoZmlsZVBhdGgpIHtcclxuICAgICAgICBjb25zdCBmaWxlVHlwZSA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkuc3Vic3RyaW5nKDEpO1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLnNldENvbnRleHQoeyBmaWxlVHlwZSwgcGhhc2U6IENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlZBTElEQVRJTkcgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICAgICAgLy8gRW5zdXJlIHdlIGhhdmUgdGhlIGxhdGVzdCBmZm1wZWcgcGF0aCBiZWZvcmUgcnVubmluZyBmZnByb2JlXHJcbiAgICAgICAgICAgIGNvbnN0IGZmcHJvYmVQYXRoID0gQmluYXJ5UGF0aFJlc29sdmVyLnJlc29sdmVCaW5hcnlQYXRoKCdmZnByb2JlJywgeyBmb3JjZVJlZnJlc2g6IGZhbHNlIH0pO1xyXG4gICAgICAgICAgICBpZiAoIWZmcHJvYmVQYXRoKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignRkZwcm9iZSBiaW5hcnkgbm90IGF2YWlsYWJsZS4gQ2Fubm90IGV4dHJhY3QgdmlkZW8gbWV0YWRhdGEuJyk7XHJcbiAgICAgICAgICAgICAgICBlcnJvci5jb2RlID0gJ0VfTUlTU0lOR19CSU5BUlknOyAvLyBBZGQgZXJyb3IgY29kZVxyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFske2Vycm9yLmNvZGV9XSAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycm9yKTsgLy8gUmVqZWN0IHdpdGggdGhlIGNvZGVkIGVycm9yXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgR2V0dGluZyB2aWRlbyBtZXRhZGF0YSB1c2luZyBmZnByb2JlIGF0OiAke2ZmcHJvYmVQYXRofWApO1xyXG4gICAgICAgICAgICAvLyBDcmVhdGUgYSBuZXcgZmZtcGVnIGNvbW1hbmQgd2l0aCB0aGUgY29ycmVjdCBwYXRoIHRvIGVuc3VyZSB3ZSdyZSBub3QgdXNpbmcgY2FjaGVkIHBhdGhzXHJcbiAgICAgICAgICAgIGNvbnN0IGNvbW1hbmQgPSBmZm1wZWcoKTtcclxuICAgICAgICAgICAgY29tbWFuZC5zZXRGZnByb2JlUGF0aChmZnByb2JlUGF0aCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb21tYW5kLmlucHV0KGZpbGVQYXRoKS5mZnByb2JlKChlcnIsIG1ldGFkYXRhKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGFFcnJvciA9IG5ldyBFcnJvcihgRkZwcm9iZSBmYWlsZWQ6ICR7ZXJyLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgbWV0YWRhdGFFcnJvci5jb2RlID0gJ0VfRkZQUk9CRV9GQUlMRUQnOyAvLyBTcGVjaWZpYyBjb2RlIGZvciBmZnByb2JlIGVycm9yc1xyXG4gICAgICAgICAgICAgICAgICAgIG1ldGFkYXRhRXJyb3IuZGV0YWlscyA9IGVycjsgLy8gQXR0YWNoIG9yaWdpbmFsIGVycm9yXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFske21ldGFkYXRhRXJyb3IuY29kZX1dIEVycm9yIGdldHRpbmcgbWV0YWRhdGE6ICR7bWV0YWRhdGFFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChtZXRhZGF0YUVycm9yKTsgLy8gUmVqZWN0IHdpdGggdGhlIHN0cnVjdHVyZWQgZXJyb3JcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IHZpZGVvU3RyZWFtID0gbWV0YWRhdGEuc3RyZWFtcy5maW5kKHMgPT4gcy5jb2RlY190eXBlID09PSAndmlkZW8nKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGF1ZGlvU3RyZWFtID0gbWV0YWRhdGEuc3RyZWFtcy5maW5kKHMgPT4gcy5jb2RlY190eXBlID09PSAnYXVkaW8nKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCF2aWRlb1N0cmVhbSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5vU3RyZWFtRXJyb3IgPSBuZXcgRXJyb3IoJ05vIHZpZGVvIHN0cmVhbSBmb3VuZCBpbiB0aGUgZmlsZS4nKTtcclxuICAgICAgICAgICAgICAgICAgICBub1N0cmVhbUVycm9yLmNvZGUgPSAnRV9OT19WSURFT19TVFJFQU0nOyAvLyBTcGVjaWZpYyBjb2RlXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFske25vU3RyZWFtRXJyb3IuY29kZX1dICR7bm9TdHJlYW1FcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChub1N0cmVhbUVycm9yKTsgLy8gUmVqZWN0IHdpdGggdGhlIHN0cnVjdHVyZWQgZXJyb3JcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IHtcclxuICAgICAgICAgICAgICAgICAgICBmb3JtYXQ6IG1ldGFkYXRhLmZvcm1hdC5mb3JtYXRfbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICBkdXJhdGlvbjogbWV0YWRhdGEuZm9ybWF0LmR1cmF0aW9uLFxyXG4gICAgICAgICAgICAgICAgICAgIHNpemU6IG1ldGFkYXRhLmZvcm1hdC5zaXplLFxyXG4gICAgICAgICAgICAgICAgICAgIGJpdHJhdGU6IG1ldGFkYXRhLmZvcm1hdC5iaXRfcmF0ZSxcclxuICAgICAgICAgICAgICAgICAgICBmaWxlbmFtZTogcGF0aC5iYXNlbmFtZShmaWxlUGF0aCksXHJcbiAgICAgICAgICAgICAgICAgICAgdmlkZW86IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29kZWM6IHZpZGVvU3RyZWFtLmNvZGVjX25hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpZHRoOiB2aWRlb1N0cmVhbS53aWR0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgaGVpZ2h0OiB2aWRlb1N0cmVhbS5oZWlnaHQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZyYW1lUmF0ZTogdGhpcy5wYXJzZUZyYW1lUmF0ZSh2aWRlb1N0cmVhbS5yX2ZyYW1lX3JhdGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhc3BlY3RSYXRpbzogdmlkZW9TdHJlYW0uZGlzcGxheV9hc3BlY3RfcmF0aW8gfHwgYCR7dmlkZW9TdHJlYW0ud2lkdGh9OiR7dmlkZW9TdHJlYW0uaGVpZ2h0fWBcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGF1ZGlvOiBhdWRpb1N0cmVhbSA/IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29kZWM6IGF1ZGlvU3RyZWFtLmNvZGVjX25hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5uZWxzOiBhdWRpb1N0cmVhbS5jaGFubmVscyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2FtcGxlUmF0ZTogYXVkaW9TdHJlYW0uc2FtcGxlX3JhdGVcclxuICAgICAgICAgICAgICAgICAgICB9IDogbnVsbFxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgTWV0YWRhdGEgZXh0cmFjdGlvbiBzdWNjZXNzZnVsYCk7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKHJlc3VsdCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUGFyc2UgZnJhbWUgcmF0ZSBzdHJpbmcgKGUuZy4gXCIzMDAwMC8xMDAxXCIpIHRvIG51bWJlclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZyYW1lUmF0ZSAtIEZyYW1lIHJhdGUgc3RyaW5nXHJcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBGcmFtZSByYXRlIGFzIG51bWJlclxyXG4gICAgICovXHJcbiAgICBwYXJzZUZyYW1lUmF0ZShmcmFtZVJhdGUpIHtcclxuICAgICAgICBpZiAoIWZyYW1lUmF0ZSkgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgcGFydHMgPSBmcmFtZVJhdGUuc3BsaXQoJy8nKTtcclxuICAgICAgICBpZiAocGFydHMubGVuZ3RoID09PSAyKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBNYXRoLnJvdW5kKChwYXJzZUludChwYXJ0c1swXSkgLyBwYXJzZUludChwYXJ0c1sxXSkpICogMTAwKSAvIDEwMDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHBhcnNlRmxvYXQoZnJhbWVSYXRlKTtcclxuICAgIH1cclxuXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBFeHRyYWN0IGF1ZGlvIGZyb20gdmlkZW8gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHZpZGVvUGF0aCAtIFBhdGggdG8gdmlkZW8gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IG91dHB1dFBhdGggLSBPdXRwdXQgcGF0aCBmb3IgYXVkaW9cclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxyXG4gICAgICovXHJcbiAgICBhc3luYyBleHRyYWN0QXVkaW8odmlkZW9QYXRoLCBvdXRwdXRQYXRoKSB7XHJcbiAgICAgICAgY29uc3QgZmlsZVR5cGUgPSBwYXRoLmV4dG5hbWUodmlkZW9QYXRoKS5zdWJzdHJpbmcoMSk7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuc2V0Q29udGV4dCh7IGZpbGVUeXBlLCBwaGFzZTogQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRVhUUkFDVElOR19BVURJTyB9KTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgICAgICAvLyBFbnN1cmUgd2UgaGF2ZSB0aGUgbGF0ZXN0IGZmbXBlZyBwYXRoIGJlZm9yZSBleHRyYWN0aW5nIGF1ZGlvXHJcbiAgICAgICAgICAgIGNvbnN0IGZmbXBlZ1BhdGggPSBCaW5hcnlQYXRoUmVzb2x2ZXIucmVzb2x2ZUJpbmFyeVBhdGgoJ2ZmbXBlZycsIHsgZm9yY2VSZWZyZXNoOiBmYWxzZSB9KTtcclxuICAgICAgICAgICAgaWYgKCFmZm1wZWdQYXRoKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignRkZtcGVnIGJpbmFyeSBub3QgYXZhaWxhYmxlLiBDYW5ub3QgZXh0cmFjdCBhdWRpby4nKTtcclxuICAgICAgICAgICAgICAgIGVycm9yLmNvZGUgPSAnRV9NSVNTSU5HX0JJTkFSWSc7IC8vIEFkZCBlcnJvciBjb2RlXHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgWyR7ZXJyb3IuY29kZX1dICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiByZWplY3QoZXJyb3IpOyAvLyBSZWplY3Qgd2l0aCB0aGUgY29kZWQgZXJyb3JcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBFeHRyYWN0aW5nIGF1ZGlvIHVzaW5nIGZmbXBlZyBhdDogJHtmZm1wZWdQYXRofWApO1xyXG4gICAgICAgICAgICAvLyBDcmVhdGUgYSBuZXcgZmZtcGVnIGNvbW1hbmQgd2l0aCB0aGUgY29ycmVjdCBwYXRoIHRvIGVuc3VyZSB3ZSdyZSBub3QgdXNpbmcgY2FjaGVkIHBhdGhzXHJcbiAgICAgICAgICAgIGNvbnN0IGNvbW1hbmQgPSBmZm1wZWcoKTtcclxuICAgICAgICAgICAgY29tbWFuZC5zZXRGZm1wZWdQYXRoKGZmbXBlZ1BhdGgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29tbWFuZC5pbnB1dCh2aWRlb1BhdGgpXHJcbiAgICAgICAgICAgICAgICAub3V0cHV0KG91dHB1dFBhdGgpXHJcbiAgICAgICAgICAgICAgICAubm9WaWRlbygpXHJcbiAgICAgICAgICAgICAgICAuYXVkaW9Db2RlYygnbGlibXAzbGFtZScpXHJcbiAgICAgICAgICAgICAgICAuYXVkaW9CaXRyYXRlKDEyOClcclxuICAgICAgICAgICAgICAgIC5vbignc3RhcnQnLCAoY29tbWFuZExpbmUpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRkZtcGVnIGNvbW1hbmQ6ICR7Y29tbWFuZExpbmV9YCk7XHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgLm9uKCdwcm9ncmVzcycsIChwcm9ncmVzcykgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBdWRpbyBleHRyYWN0aW9uIHByb2dyZXNzOiAke0pTT04uc3RyaW5naWZ5KHByb2dyZXNzKX1gKTtcclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBBdWRpbyBleHRyYWN0aW9uIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHlgKTtcclxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKCk7XHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgLm9uKCdlcnJvcicsIChlcnIsIHN0ZG91dCwgc3RkZXJyKSA9PiB7IC8vIENhcHR1cmUgc3Rkb3V0L3N0ZGVyciBmb3IgbW9yZSBjb250ZXh0XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXh0cmFjdGlvbkVycm9yID0gbmV3IEVycm9yKGBGRm1wZWcgYXVkaW8gZXh0cmFjdGlvbiBmYWlsZWQ6ICR7ZXJyLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgZXh0cmFjdGlvbkVycm9yLmNvZGUgPSAnRV9GRk1QRUdfQVVESU9fRVhUUkFDVElPTic7IC8vIFNwZWNpZmljIGNvZGVcclxuICAgICAgICAgICAgICAgICAgICAvLyBJbmNsdWRlIGZmbXBlZydzIHN0ZGVyciBpZiBhdmFpbGFibGUsIGFzIGl0IG9mdGVuIGNvbnRhaW5zIHVzZWZ1bCBpbmZvXHJcbiAgICAgICAgICAgICAgICAgICAgZXh0cmFjdGlvbkVycm9yLmRldGFpbHMgPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsRXJyb3I6IGVycixcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3RkZXJyOiBzdGRlcnIgfHwgJ04vQSdcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBbJHtleHRyYWN0aW9uRXJyb3IuY29kZX1dIEF1ZGlvIGV4dHJhY3Rpb24gZXJyb3I6ICR7ZXh0cmFjdGlvbkVycm9yLm1lc3NhZ2V9LiBTdGRlcnI6ICR7c3RkZXJyfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChleHRyYWN0aW9uRXJyb3IpOyAvLyBSZWplY3Qgd2l0aCB0aGUgc3RydWN0dXJlZCBlcnJvclxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIC5ydW4oKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFRyYW5zY3JpYmUgYXVkaW8gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGF1ZGlvUGF0aCAtIFBhdGggdG8gYXVkaW8gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGxhbmd1YWdlIC0gTGFuZ3VhZ2UgY29kZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gVHJhbnNjcmlwdGlvbiByZXN1bHRcclxuICAgICAqL1xyXG4gICAgYXN5bmMgdHJhbnNjcmliZUF1ZGlvKGF1ZGlvUGF0aCwgbGFuZ3VhZ2UpIHtcclxuICAgICAgICBjb25zdCBmaWxlVHlwZSA9ICdtcDMnOyAvLyBBdWRpbyBpcyBhbHdheXMgY29udmVydGVkIHRvIG1wM1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLnNldENvbnRleHQoeyBmaWxlVHlwZSwgcGhhc2U6IENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlRSQU5TQ1JJQklORyB9KTtcclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBVc2UgdGhlIFRyYW5zY3JpYmVyU2VydmljZSB0byB0cmFuc2NyaWJlIHRoZSBhdWRpb1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTdGFydGluZyB0cmFuc2NyaXB0aW9uIG9mIGF1ZGlvIGZpbGU6ICR7YXVkaW9QYXRofWApO1xyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnRyYW5zY3JpYmVyLmhhbmRsZVRyYW5zY3JpYmVTdGFydChudWxsLCB7XHJcbiAgICAgICAgICAgICAgICBmaWxlUGF0aDogYXVkaW9QYXRoLFxyXG4gICAgICAgICAgICAgICAgb3B0aW9uczogeyBsYW5ndWFnZSB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gV2FpdCBmb3IgdHJhbnNjcmlwdGlvbiB0byBjb21wbGV0ZVxyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBUcmFuc2NyaXB0aW9uIGpvYiBzdGFydGVkIHdpdGggSUQ6ICR7cmVzdWx0LmpvYklkfWApO1xyXG4gICAgICAgICAgICBsZXQgc3RhdHVzID0gYXdhaXQgdGhpcy50cmFuc2NyaWJlci5oYW5kbGVUcmFuc2NyaWJlU3RhdHVzKG51bGwsIHsgam9iSWQ6IHJlc3VsdC5qb2JJZCB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHdoaWxlIChzdGF0dXMuc3RhdHVzICE9PSAnY29tcGxldGVkJyAmJiBzdGF0dXMuc3RhdHVzICE9PSAnZmFpbGVkJyAmJiBzdGF0dXMuc3RhdHVzICE9PSAnY2FuY2VsbGVkJykge1xyXG4gICAgICAgICAgICAgICAgLy8gV2FpdCBhIGJpdCBiZWZvcmUgY2hlY2tpbmcgYWdhaW5cclxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBUcmFuc2NyaXB0aW9uIGluIHByb2dyZXNzLCBzdGF0dXM6ICR7c3RhdHVzLnN0YXR1c30sIHByb2dyZXNzOiAke3N0YXR1cy5wcm9ncmVzcyB8fCAndW5rbm93bid9YCk7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwMCkpO1xyXG4gICAgICAgICAgICAgICAgc3RhdHVzID0gYXdhaXQgdGhpcy50cmFuc2NyaWJlci5oYW5kbGVUcmFuc2NyaWJlU3RhdHVzKG51bGwsIHsgam9iSWQ6IHJlc3VsdC5qb2JJZCB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHN0YXR1cy5zdGF0dXMgPT09ICdmYWlsZWQnKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB0cmFuc2NyaXB0aW9uRXJyb3IgPSBuZXcgRXJyb3Ioc3RhdHVzLmVycm9yIHx8ICdUcmFuc2NyaXB0aW9uIGZhaWxlZCcpO1xyXG4gICAgICAgICAgICAgICAgdHJhbnNjcmlwdGlvbkVycm9yLmNvZGUgPSAnRV9UUkFOU0NSSVBUSU9OX0ZBSUxFRCc7IC8vIFNwZWNpZmljIGNvZGVcclxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBbJHt0cmFuc2NyaXB0aW9uRXJyb3IuY29kZX1dIFRyYW5zY3JpcHRpb24gZmFpbGVkOiAke3RyYW5zY3JpcHRpb25FcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgdHJhbnNjcmlwdGlvbkVycm9yOyAvLyBUaHJvdyBjb2RlZCBlcnJvclxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoc3RhdHVzLnN0YXR1cyA9PT0gJ2NhbmNlbGxlZCcpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNhbmNlbGxlZEVycm9yID0gbmV3IEVycm9yKCdUcmFuc2NyaXB0aW9uIGNhbmNlbGxlZCcpO1xyXG4gICAgICAgICAgICAgICAgY2FuY2VsbGVkRXJyb3IuY29kZSA9ICdFX1RSQU5TQ1JJUFRJT05fQ0FOQ0VMTEVEJzsgLy8gU3BlY2lmaWMgY29kZVxyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgWyR7Y2FuY2VsbGVkRXJyb3IuY29kZX1dIFRyYW5zY3JpcHRpb24gY2FuY2VsbGVkYCk7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBjYW5jZWxsZWRFcnJvcjsgLy8gVGhyb3cgY29kZWQgZXJyb3JcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKCFzdGF0dXMucmVzdWx0IHx8ICFzdGF0dXMucmVzdWx0LnRleHQgfHwgc3RhdHVzLnJlc3VsdC50ZXh0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFRyYW5zY3JpcHRpb24gY29tcGxldGVkIGJ1dCBjb250ZW50IGlzIGVtcHR5IC0gdGhpcyBpcyBub3JtYWwgZm9yIHZpZGVvcyB3aXRob3V0IHNwZWVjaGAsIFxyXG4gICAgICAgICAgICAgICAgICAgIHsgcGhhc2U6IENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkNPTlRFTlRfRU1QVFkgfSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBUcmFuc2NyaXB0aW9uIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHkgd2l0aCAke3N0YXR1cy5yZXN1bHQudGV4dC5sZW5ndGh9IGNoYXJhY3RlcnNgKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHN0YXR1cy5yZXN1bHQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgLy8gRW5zdXJlIGVycm9yIGhhcyBhIGNvZGUgYmVmb3JlIHJlLXRocm93aW5nXHJcbiAgICAgICAgICAgIGVycm9yLmNvZGUgPSBlcnJvci5jb2RlIHx8ICdFX1RSQU5TQ1JJUFRJT05fVU5FWFBFQ1RFRCc7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBbJHtlcnJvci5jb2RlfV0gVHJhbnNjcmlwdGlvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7IC8vIFJlLXRocm93ICh3aWxsIGJlIGNhdWdodCBieSBwcm9jZXNzQ29udmVyc2lvbilcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSBtYXJrZG93biBmcm9tIHZpZGVvIG1ldGFkYXRhLCB0aHVtYm5haWxzLCBhbmQgdHJhbnNjcmlwdGlvblxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gVmlkZW8gbWV0YWRhdGFcclxuICAgICAqIEBwYXJhbSB7QXJyYXl9IHRodW1ibmFpbHMgLSBBcnJheSBvZiB0aHVtYm5haWwgaW5mbyBvYmplY3RzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gdHJhbnNjcmlwdGlvbiAtIFRyYW5zY3JpcHRpb24gcmVzdWx0XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gTWFya2Rvd24gY29udGVudFxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCB0aHVtYm5haWxzLCB0cmFuc2NyaXB0aW9uLCBvcHRpb25zKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgR2VuZXJhdGluZyBtYXJrZG93biBjb250ZW50YCwgeyBwaGFzZTogQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuUFJPQ0VTU0lORyB9KTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBtYXJrZG93biA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCB0aXRsZVxyXG4gICAgICAgIGlmIChvcHRpb25zLnRpdGxlKSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCMgJHtvcHRpb25zLnRpdGxlfWApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCMgVmlkZW86ICR7bWV0YWRhdGEuZmlsZW5hbWV9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBtZXRhZGF0YVxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIFZpZGVvIEluZm9ybWF0aW9uJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnfCBQcm9wZXJ0eSB8IFZhbHVlIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IC0tLSB8IC0tLSB8Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBGaWxlbmFtZSB8ICR7bWV0YWRhdGEuZmlsZW5hbWV9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IER1cmF0aW9uIHwgJHt0aGlzLmZvcm1hdER1cmF0aW9uKG1ldGFkYXRhLmR1cmF0aW9uKX0gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgUmVzb2x1dGlvbiB8ICR7bWV0YWRhdGEudmlkZW8ud2lkdGh9eCR7bWV0YWRhdGEudmlkZW8uaGVpZ2h0fSB8YCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBGb3JtYXQgfCAke21ldGFkYXRhLmZvcm1hdH0gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgVmlkZW8gQ29kZWMgfCAke21ldGFkYXRhLnZpZGVvLmNvZGVjfSB8YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKG1ldGFkYXRhLmF1ZGlvKSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYHwgQXVkaW8gQ29kZWMgfCAke21ldGFkYXRhLmF1ZGlvLmNvZGVjfSB8YCk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYHwgQXVkaW8gQ2hhbm5lbHMgfCAke21ldGFkYXRhLmF1ZGlvLmNoYW5uZWxzfSB8YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRnJhbWUgUmF0ZSB8ICR7bWV0YWRhdGEudmlkZW8uZnJhbWVSYXRlfSBmcHMgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgQml0cmF0ZSB8ICR7TWF0aC5yb3VuZChtZXRhZGF0YS5iaXRyYXRlIC8gMTAwMCl9IGticHMgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRmlsZSBTaXplIHwgJHt0aGlzLmZvcm1hdEZpbGVTaXplKG1ldGFkYXRhLnNpemUpfSB8YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gVGh1bWJuYWlscyBzZWN0aW9uIHJlbW92ZWRcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdHJhbnNjcmlwdGlvbiBpZiBhdmFpbGFibGVcclxuICAgICAgICBpZiAodHJhbnNjcmlwdGlvbiAmJiB0cmFuc2NyaXB0aW9uLnRleHQgJiYgdHJhbnNjcmlwdGlvbi50ZXh0LnRyaW0oKSAhPT0gJycpIHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgVHJhbnNjcmlwdGlvbicpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCh0cmFuc2NyaXB0aW9uLnRleHQpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAodHJhbnNjcmlwdGlvbikge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBUcmFuc2NyaXB0aW9uJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcqTm8gc3BlZWNoIGRldGVjdGVkIGluIHRoaXMgdmlkZW8uKicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBNYXJrZG93biBnZW5lcmF0aW9uIGNvbXBsZXRlIHdpdGggJHttYXJrZG93bi5sZW5ndGh9IGxpbmVzYCk7XHJcbiAgICAgICAgcmV0dXJuIG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRm9ybWF0IGR1cmF0aW9uIGluIHNlY29uZHMgdG8gaGg6bW06c3NcclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBzZWNvbmRzIC0gRHVyYXRpb24gaW4gc2Vjb25kc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gRm9ybWF0dGVkIGR1cmF0aW9uXHJcbiAgICAgKi9cclxuICAgIGZvcm1hdER1cmF0aW9uKHNlY29uZHMpIHtcclxuICAgICAgICBjb25zdCBob3VycyA9IE1hdGguZmxvb3Ioc2Vjb25kcyAvIDM2MDApO1xyXG4gICAgICAgIGNvbnN0IG1pbnV0ZXMgPSBNYXRoLmZsb29yKChzZWNvbmRzICUgMzYwMCkgLyA2MCk7XHJcbiAgICAgICAgY29uc3Qgc2VjcyA9IE1hdGguZmxvb3Ioc2Vjb25kcyAlIDYwKTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gW1xyXG4gICAgICAgICAgICBob3Vycy50b1N0cmluZygpLnBhZFN0YXJ0KDIsICcwJyksXHJcbiAgICAgICAgICAgIG1pbnV0ZXMudG9TdHJpbmcoKS5wYWRTdGFydCgyLCAnMCcpLFxyXG4gICAgICAgICAgICBzZWNzLnRvU3RyaW5nKCkucGFkU3RhcnQoMiwgJzAnKVxyXG4gICAgICAgIF0uam9pbignOicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRm9ybWF0IGZpbGUgc2l6ZSBpbiBieXRlcyB0byBodW1hbi1yZWFkYWJsZSBmb3JtYXRcclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBieXRlcyAtIEZpbGUgc2l6ZSBpbiBieXRlc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gRm9ybWF0dGVkIGZpbGUgc2l6ZVxyXG4gICAgICovXHJcbiAgICBmb3JtYXRGaWxlU2l6ZShieXRlcykge1xyXG4gICAgICAgIGNvbnN0IHVuaXRzID0gWydCJywgJ0tCJywgJ01CJywgJ0dCJ107XHJcbiAgICAgICAgbGV0IHNpemUgPSBieXRlcztcclxuICAgICAgICBsZXQgdW5pdEluZGV4ID0gMDtcclxuICAgICAgICBcclxuICAgICAgICB3aGlsZSAoc2l6ZSA+PSAxMDI0ICYmIHVuaXRJbmRleCA8IHVuaXRzLmxlbmd0aCAtIDEpIHtcclxuICAgICAgICAgICAgc2l6ZSAvPSAxMDI0O1xyXG4gICAgICAgICAgICB1bml0SW5kZXgrKztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGAke3NpemUudG9GaXhlZCgyKX0gJHt1bml0c1t1bml0SW5kZXhdfWA7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVjayBpZiB0aGlzIGNvbnZlcnRlciBzdXBwb3J0cyB0aGUgZ2l2ZW4gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBmaWxlXHJcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBzdXBwb3J0ZWRcclxuICAgICAqL1xyXG4gICAgc3VwcG9ydHNGaWxlKGZpbGVQYXRoKSB7XHJcbiAgICAgICAgY29uc3QgZXh0ID0gcGF0aC5leHRuYW1lKGZpbGVQYXRoKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgIHJldHVybiB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMuaW5jbHVkZXMoZXh0KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IENvbnZlcnRlciBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGdldEluZm8oKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgbmFtZTogJ1ZpZGVvIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbnM6IHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyxcclxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb252ZXJ0cyB2aWRlbyBmaWxlcyB0byBtYXJrZG93biB3aXRoIG1ldGFkYXRhIGFuZCB0cmFuc2NyaXB0aW9uJyxcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgICAgdHJhbnNjcmliZTogJ1doZXRoZXIgdG8gdHJhbnNjcmliZSBhdWRpbyAoZGVmYXVsdDogdHJ1ZSknLFxyXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2U6ICdUcmFuc2NyaXB0aW9uIGxhbmd1YWdlIChkZWZhdWx0OiBlbiknLFxyXG4gICAgICAgICAgICAgICAgdGl0bGU6ICdPcHRpb25hbCBkb2N1bWVudCB0aXRsZSdcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gVmlkZW9Db252ZXJ0ZXI7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTUMsRUFBRSxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQzlCLE1BQU1FLE1BQU0sR0FBR0YsT0FBTyxDQUFDLGVBQWUsQ0FBQztBQUN2QyxNQUFNO0VBQUVHO0FBQUksQ0FBQyxHQUFHSCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ25DLE1BQU07RUFBRUk7QUFBTSxDQUFDLEdBQUdKLE9BQU8sQ0FBQyxlQUFlLENBQUM7QUFDMUMsTUFBTUssV0FBVyxHQUFHTCxPQUFPLENBQUMsbUJBQW1CLENBQUM7QUFDaEQsTUFBTTtFQUFFTSxFQUFFLEVBQUVDO0FBQU8sQ0FBQyxHQUFHUCxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUN4QyxNQUFNUSxrQkFBa0IsR0FBR1IsT0FBTyxDQUFDLG1DQUFtQyxDQUFDO0FBQ3ZFLE1BQU07RUFBRVM7QUFBVSxDQUFDLEdBQUdULE9BQU8sQ0FBQyx5Q0FBeUMsQ0FBQztBQUN4RSxNQUFNO0VBQUVVO0FBQW1CLENBQUMsR0FBR1YsT0FBTyxDQUFDLHFDQUFxQyxDQUFDO0FBQzdFLE1BQU1XLGdCQUFnQixHQUFHWCxPQUFPLENBQUMsNENBQTRDLENBQUM7QUFFOUUsTUFBTVksY0FBYyxTQUFTUCxXQUFXLENBQUM7RUFDckNRLFdBQVdBLENBQUNDLFFBQVEsRUFBRUMsYUFBYSxFQUFFQyxXQUFXLEVBQUVDLFVBQVUsRUFBRTtJQUFFO0lBQzVELEtBQUssQ0FBQyxDQUFDO0lBQ1AsSUFBSSxDQUFDSCxRQUFRLEdBQUdBLFFBQVEsQ0FBQyxDQUFDO0lBQzFCLElBQUksQ0FBQ0MsYUFBYSxHQUFHQSxhQUFhLENBQUMsQ0FBQztJQUNwQyxJQUFJLENBQUNDLFdBQVcsR0FBR0EsV0FBVztJQUM5QixJQUFJLENBQUNDLFVBQVUsR0FBR0EsVUFBVSxDQUFDLENBQUM7SUFDOUIsSUFBSSxDQUFDQyxtQkFBbUIsR0FBRyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sQ0FBQztJQUNwRjs7SUFFQTtJQUNBLElBQUksQ0FBQ0MsTUFBTSxHQUFHVixTQUFTLENBQUMsZ0JBQWdCLENBQUM7O0lBRXpDO0lBQ0EsSUFBSSxDQUFDVyxlQUFlLENBQUMsQ0FBQztFQUMxQjs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNJQSxlQUFlQSxDQUFBLEVBQUc7SUFDZCxJQUFJO01BQ0EsSUFBSSxDQUFDRCxNQUFNLENBQUNFLElBQUksQ0FBQywrREFBK0QsRUFBRTtRQUFFQyxLQUFLLEVBQUVYLGdCQUFnQixDQUFDWSxNQUFNLENBQUNDO01BQVMsQ0FBQyxDQUFDOztNQUU5SDtNQUNBLE1BQU1DLFVBQVUsR0FBR2pCLGtCQUFrQixDQUFDa0IsaUJBQWlCLENBQUMsUUFBUSxDQUFDO01BQ2pFLElBQUksQ0FBQ0QsVUFBVSxFQUFFO1FBQ2IsTUFBTSxJQUFJRSxLQUFLLENBQUMsdUVBQXVFLENBQUM7TUFDNUY7TUFDQSxJQUFJLENBQUNSLE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLDJDQUEyQ0ksVUFBVSxFQUFFLENBQUM7O01BRXpFO01BQ0EsTUFBTUcsV0FBVyxHQUFHcEIsa0JBQWtCLENBQUNrQixpQkFBaUIsQ0FBQyxTQUFTLENBQUM7TUFDbkUsSUFBSSxDQUFDRSxXQUFXLEVBQUU7UUFDZCxNQUFNLElBQUlELEtBQUssQ0FBQyxpRkFBaUYsQ0FBQztNQUN0RztNQUNBLElBQUksQ0FBQ1IsTUFBTSxDQUFDRSxJQUFJLENBQUMsNENBQTRDTyxXQUFXLEVBQUUsQ0FBQzs7TUFFM0U7TUFDQTFCLE1BQU0sQ0FBQzJCLGFBQWEsQ0FBQ0osVUFBVSxDQUFDO01BQ2hDdkIsTUFBTSxDQUFDNEIsY0FBYyxDQUFDRixXQUFXLENBQUM7TUFDbENHLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDQyxXQUFXLEdBQUdSLFVBQVU7TUFDcENNLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDRSxZQUFZLEdBQUdOLFdBQVc7O01BRXRDO01BQ0EsSUFBSTtRQUNBO1FBQ0E7UUFDQSxNQUFNTyxnQkFBZ0IsR0FBR25DLE9BQU8sQ0FBQ29DLE9BQU8sQ0FBQyxlQUFlLENBQUM7UUFDekQsSUFBSUQsZ0JBQWdCLElBQUluQyxPQUFPLENBQUNxQyxLQUFLLENBQUNGLGdCQUFnQixDQUFDLEVBQUU7VUFDckQsSUFBSSxDQUFDaEIsTUFBTSxDQUFDbUIsS0FBSyxDQUFDLHVEQUF1RCxDQUFDO1VBQzFFdEMsT0FBTyxDQUFDcUMsS0FBSyxDQUFDRixnQkFBZ0IsQ0FBQyxDQUFDSSxPQUFPLEdBQUdkLFVBQVU7UUFDeEQ7TUFDSixDQUFDLENBQUMsT0FBT2UsR0FBRyxFQUFFO1FBQ1Y7UUFDQSxJQUFJLENBQUNyQixNQUFNLENBQUNtQixLQUFLLENBQUMsMkVBQTJFRSxHQUFHLENBQUNDLE9BQU8sRUFBRSxDQUFDO01BQy9HOztNQUVBO01BQ0EsSUFBSSxDQUFDQyxpQkFBaUIsQ0FBQ2pCLFVBQVUsQ0FBQztNQUVsQyxJQUFJLENBQUNOLE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLHVDQUF1QyxDQUFDO01BQ3pELElBQUksQ0FBQ0YsTUFBTSxDQUFDRSxJQUFJLENBQUMsYUFBYUksVUFBVSxFQUFFLENBQUM7TUFDM0MsSUFBSSxDQUFDTixNQUFNLENBQUNFLElBQUksQ0FBQyxjQUFjTyxXQUFXLEVBQUUsQ0FBQztJQUNqRCxDQUFDLENBQUMsT0FBT2UsS0FBSyxFQUFFO01BQ1osSUFBSSxDQUFDeEIsTUFBTSxDQUFDd0IsS0FBSyxDQUFDLDZCQUE2QkEsS0FBSyxDQUFDRixPQUFPLEVBQUUsQ0FBQztNQUMvRCxJQUFJLENBQUN0QixNQUFNLENBQUNtQixLQUFLLENBQUMsZ0JBQWdCSyxLQUFLLENBQUNDLEtBQUssRUFBRSxDQUFDOztNQUVoRDtNQUNBO01BQ0EsSUFBSSxDQUFDekIsTUFBTSxDQUFDMEIsSUFBSSxDQUFDLGtEQUFrRCxDQUFDO0lBQ3hFO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNJSCxpQkFBaUJBLENBQUNqQixVQUFVLEVBQUU7SUFDMUIsSUFBSTtNQUNBLElBQUksQ0FBQ04sTUFBTSxDQUFDRSxJQUFJLENBQUMsK0NBQStDSSxVQUFVLEVBQUUsQ0FBQzs7TUFFN0U7TUFDQSxNQUFNTSxPQUFPLEdBQUczQixLQUFLLENBQUNxQixVQUFVLEVBQUUsQ0FBQyxVQUFVLENBQUMsQ0FBQzs7TUFFL0M7TUFDQSxJQUFJLENBQUNOLE1BQU0sQ0FBQ21CLEtBQUssQ0FBQyx5Q0FBeUMsQ0FBQzs7TUFFNUQ7TUFDQVAsT0FBTyxDQUFDZSxNQUFNLENBQUNDLEVBQUUsQ0FBQyxNQUFNLEVBQUdDLElBQUksSUFBSztRQUNoQyxJQUFJLENBQUM3QixNQUFNLENBQUNtQixLQUFLLENBQUMsZ0NBQWdDVSxJQUFJLENBQUNDLFFBQVEsQ0FBQyxDQUFDLENBQUNDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQztNQUM3RixDQUFDLENBQUM7TUFFRm5CLE9BQU8sQ0FBQ29CLE1BQU0sQ0FBQ0osRUFBRSxDQUFDLE1BQU0sRUFBR0MsSUFBSSxJQUFLO1FBQ2hDLElBQUksQ0FBQzdCLE1BQU0sQ0FBQ21CLEtBQUssQ0FBQyxnQ0FBZ0NVLElBQUksQ0FBQ0MsUUFBUSxDQUFDLENBQUMsQ0FBQ0MsU0FBUyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsS0FBSyxDQUFDO01BQzdGLENBQUMsQ0FBQztNQUVGbkIsT0FBTyxDQUFDZ0IsRUFBRSxDQUFDLE9BQU8sRUFBR1AsR0FBRyxJQUFLO1FBQ3pCLElBQUksQ0FBQ3JCLE1BQU0sQ0FBQ3dCLEtBQUssQ0FBQywyQkFBMkJILEdBQUcsQ0FBQ0MsT0FBTyxFQUFFLENBQUM7UUFDM0QsSUFBSSxDQUFDdEIsTUFBTSxDQUFDd0IsS0FBSyxDQUFDLHVEQUF1RCxDQUFDO01BQzlFLENBQUMsQ0FBQztNQUVGWixPQUFPLENBQUNnQixFQUFFLENBQUMsT0FBTyxFQUFHSyxJQUFJLElBQUs7UUFDMUIsSUFBSSxDQUFDakMsTUFBTSxDQUFDRSxJQUFJLENBQUMseUNBQXlDK0IsSUFBSSxFQUFFLENBQUM7TUFDckUsQ0FBQyxDQUFDO0lBQ04sQ0FBQyxDQUFDLE9BQU9ULEtBQUssRUFBRTtNQUNaLElBQUksQ0FBQ3hCLE1BQU0sQ0FBQ3dCLEtBQUssQ0FBQyw0QkFBNEJBLEtBQUssQ0FBQ0YsT0FBTyxFQUFFLENBQUM7SUFDbEU7RUFDSjs7RUFFQTtBQUNKO0FBQ0E7RUFDSVksZ0JBQWdCQSxDQUFBLEVBQUc7SUFDZixJQUFJLENBQUNDLGVBQWUsQ0FBQyxlQUFlLEVBQUUsSUFBSSxDQUFDQyxhQUFhLENBQUNDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNwRSxJQUFJLENBQUNGLGVBQWUsQ0FBQyx3QkFBd0IsRUFBRSxJQUFJLENBQUNHLGlCQUFpQixDQUFDRCxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDakYsSUFBSSxDQUFDRixlQUFlLENBQUMsc0JBQXNCLEVBQUUsSUFBSSxDQUFDSSxZQUFZLENBQUNGLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztFQUM5RTs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTUQsYUFBYUEsQ0FBQ0ksS0FBSyxFQUFFO0lBQUVDLFFBQVE7SUFBRUMsT0FBTyxHQUFHLENBQUM7RUFBRSxDQUFDLEVBQUU7SUFDbkQsTUFBTUMsWUFBWSxHQUFHLFNBQVN2RCxNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUMxQyxNQUFNd0QsUUFBUSxHQUFHaEUsSUFBSSxDQUFDaUUsT0FBTyxDQUFDSixRQUFRLENBQUMsQ0FBQ1YsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7O0lBRXREO0lBQ0EsSUFBSVcsT0FBTyxDQUFDSSxVQUFVLEVBQUU7TUFDcEIsSUFBSTtRQUNBLE1BQU1DLFNBQVMsR0FBR25FLElBQUksQ0FBQ29FLE9BQU8sQ0FBQ04sT0FBTyxDQUFDSSxVQUFVLENBQUM7UUFDbEQsTUFBTWhFLEVBQUUsQ0FBQ21FLFNBQVMsQ0FBQ0YsU0FBUyxDQUFDO1FBQzdCLElBQUksQ0FBQy9DLE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLCtCQUErQjZDLFNBQVMsRUFBRSxDQUFDO01BQ2hFLENBQUMsQ0FBQyxPQUFPdkIsS0FBSyxFQUFFO1FBQ1osTUFBTTBCLFVBQVUsR0FBRyxJQUFJMUMsS0FBSyxDQUFDLHdCQUF3QmdCLEtBQUssQ0FBQ0YsT0FBTyxFQUFFLENBQUM7UUFDckU0QixVQUFVLENBQUNqQixJQUFJLEdBQUcsU0FBUyxDQUFDLENBQUM7UUFDN0IsSUFBSSxDQUFDakMsTUFBTSxDQUFDd0IsS0FBSyxDQUFDLElBQUkwQixVQUFVLENBQUNqQixJQUFJLEtBQUtpQixVQUFVLENBQUM1QixPQUFPLEVBQUUsQ0FBQztRQUMvRDtRQUNBLE9BQU87VUFDSDZCLE9BQU8sRUFBRSxLQUFLO1VBQ2QzQixLQUFLLEVBQUU7WUFDSFMsSUFBSSxFQUFFaUIsVUFBVSxDQUFDakIsSUFBSTtZQUNyQlgsT0FBTyxFQUFFNEIsVUFBVSxDQUFDNUIsT0FBTztZQUMzQjhCLE9BQU8sRUFBRTVCLEtBQUssQ0FBQ0MsS0FBSyxDQUFDO1VBQ3pCO1FBQ0osQ0FBQztNQUNMO0lBQ0o7O0lBRUE7SUFDQSxJQUFJLENBQUN6QixNQUFNLENBQUNxRCxVQUFVLENBQUM7TUFDbkJWLFlBQVk7TUFDWkMsUUFBUTtNQUNSRSxVQUFVLEVBQUVKLE9BQU8sQ0FBQ0k7SUFDeEIsQ0FBQyxDQUFDO0lBRUYsSUFBSSxDQUFDOUMsTUFBTSxDQUFDc0Qsa0JBQWtCLENBQUNWLFFBQVEsRUFBRUYsT0FBTyxDQUFDOztJQUVqRDtJQUNBLE1BQU1hLE1BQU0sR0FBR2YsS0FBSyxFQUFFZ0IsTUFBTSxFQUFFQyxxQkFBcUIsQ0FBQyxDQUFDO0lBQ3JELElBQUlDLE9BQU8sR0FBR2hCLE9BQU8sQ0FBQ2lCLFFBQVEsQ0FBQyxDQUFDO0lBQ2hDLElBQUliLFVBQVUsR0FBR0osT0FBTyxDQUFDSSxVQUFVLENBQUMsQ0FBQzs7SUFFckMsSUFBSWMsY0FBYyxHQUFHLEtBQUssQ0FBQyxDQUFDOztJQUU1QixJQUFJO01BQ0E7TUFDQSxJQUFJLENBQUNGLE9BQU8sRUFBRTtRQUNWO1FBQ0FBLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQzVELFVBQVUsQ0FBQytELHdCQUF3QixDQUFDLGtCQUFrQixDQUFDO1FBQzVFLElBQUksQ0FBQzdELE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLHdDQUF3Q3dELE9BQU8sRUFBRSxFQUFFO1VBQUV2RCxLQUFLLEVBQUU7UUFBUSxDQUFDLENBQUM7UUFDdkZ5RCxjQUFjLEdBQUcsSUFBSSxDQUFDLENBQUM7TUFDM0IsQ0FBQyxNQUFNO1FBQ0gsSUFBSSxDQUFDNUQsTUFBTSxDQUFDRSxJQUFJLENBQUMsa0RBQWtEd0QsT0FBTyxFQUFFLEVBQUU7VUFBRXZELEtBQUssRUFBRTtRQUFRLENBQUMsQ0FBQztRQUNqRztNQUNKOztNQUVBO01BQ0EsSUFBSSxDQUFDUixRQUFRLENBQUNtRSxrQkFBa0IsQ0FBQ25CLFlBQVksRUFBRTtRQUMzQ29CLEVBQUUsRUFBRXBCLFlBQVk7UUFDaEJxQixJQUFJLEVBQUUsT0FBTztRQUNiQyxJQUFJLEVBQUVyRixJQUFJLENBQUNzRixRQUFRLENBQUN6QixRQUFRLENBQUM7UUFDN0IwQixNQUFNLEVBQUUzRSxnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDQyxRQUFRO1FBQ3hDK0QsUUFBUSxFQUFFLENBQUM7UUFDWDNCLFFBQVE7UUFBRTtRQUNWaUIsT0FBTztRQUNQSCxNQUFNO1FBQ05jLFNBQVMsRUFBRUMsSUFBSSxDQUFDQyxHQUFHLENBQUMsQ0FBQztRQUNyQnpCLFVBQVUsRUFBRUosT0FBTyxDQUFDSSxVQUFVLENBQUM7TUFDbkMsQ0FBQyxFQUFFLFlBQVk7UUFBRTtRQUNiO1FBQ0E7UUFDQTtRQUNBLElBQUlZLE9BQU8sSUFBSSxPQUFPRSxjQUFjLEtBQUssV0FBVyxJQUFJQSxjQUFjLEVBQUU7VUFDcEUsSUFBSSxDQUFDNUQsTUFBTSxDQUFDRSxJQUFJLENBQUMsK0RBQStEd0QsT0FBTyxFQUFFLEVBQUU7WUFBRXZELEtBQUssRUFBRTtVQUFVLENBQUMsQ0FBQztVQUNoSCxJQUFJO1lBQ0EsTUFBTSxJQUFJLENBQUNMLFVBQVUsQ0FBQzBFLHlCQUF5QixDQUFDZCxPQUFPLENBQUM7WUFDeEQsSUFBSSxDQUFDMUQsTUFBTSxDQUFDRSxJQUFJLENBQUMsOENBQThDd0QsT0FBTyxFQUFFLEVBQUU7Y0FBRXZELEtBQUssRUFBRTtZQUFVLENBQUMsQ0FBQztVQUNuRyxDQUFDLENBQUMsT0FBT3NFLFlBQVksRUFBRTtZQUNuQixJQUFJLENBQUN6RSxNQUFNLENBQUN3QixLQUFLLENBQUMsdUNBQXVDa0MsT0FBTyw2QkFBNkJlLFlBQVksQ0FBQ25ELE9BQU8sRUFBRSxFQUFFO2NBQUVuQixLQUFLLEVBQUU7WUFBVSxDQUFDLENBQUM7VUFDOUk7UUFDSixDQUFDLE1BQU0sSUFBSXVELE9BQU8sRUFBRTtVQUNmLElBQUksQ0FBQzFELE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLHVCQUF1QndELE9BQU8sa0dBQWtHLEVBQUU7WUFBRXZELEtBQUssRUFBRTtVQUFVLENBQUMsQ0FBQztRQUM3SztNQUNKLENBQUMsQ0FBQzs7TUFFRjtNQUNBLElBQUlvRCxNQUFNLEVBQUU7UUFDUkEsTUFBTSxDQUFDbUIsV0FBVyxDQUFDQyxJQUFJLENBQUMsMEJBQTBCLEVBQUU7VUFBRWhDO1FBQWEsQ0FBQyxDQUFDO01BQ3pFLENBQUMsTUFBTTtRQUNILElBQUksQ0FBQzNDLE1BQU0sQ0FBQzBCLElBQUksQ0FBQyx1Q0FBdUNpQixZQUFZLGtDQUFrQyxDQUFDO01BQzNHOztNQUVBO01BQ0EsSUFBSSxDQUFDaUMsaUJBQWlCLENBQUNqQyxZQUFZLEVBQUVGLFFBQVEsRUFBRUMsT0FBTyxDQUFDO01BQ3ZEOztNQUVBO01BQ0EsT0FBTztRQUFFUyxPQUFPLEVBQUUsSUFBSTtRQUFFUjtNQUFhLENBQUM7SUFDMUMsQ0FBQyxDQUFDLE9BQU9uQixLQUFLLEVBQUU7TUFDWixNQUFNcUQsY0FBYyxHQUFHckQsS0FBSyxDQUFDUyxJQUFJLElBQUksb0JBQW9CO01BQ3pELElBQUksQ0FBQ2pDLE1BQU0sQ0FBQzhFLGtCQUFrQixDQUFDbEMsUUFBUSxFQUFFcEIsS0FBSyxFQUFFO1FBQUVyQixLQUFLLEVBQUUsYUFBYTtRQUFFOEIsSUFBSSxFQUFFNEM7TUFBZSxDQUFDLENBQUM7O01BRS9GO01BQ0EsSUFBSW5CLE9BQU8sSUFBSSxPQUFPRSxjQUFjLEtBQUssV0FBVyxJQUFJQSxjQUFjLEVBQUU7UUFDcEUsSUFBSSxDQUFDNUQsTUFBTSxDQUFDMEIsSUFBSSxDQUFDLGtDQUFrQ2lCLFlBQVksb0NBQW9DZSxPQUFPLEVBQUUsRUFBRTtVQUFFdkQsS0FBSyxFQUFFO1FBQWdCLENBQUMsQ0FBQztRQUN6SSxJQUFJO1VBQ0EsTUFBTSxJQUFJLENBQUNMLFVBQVUsQ0FBQzBFLHlCQUF5QixDQUFDZCxPQUFPLENBQUM7VUFDeEQsSUFBSSxDQUFDMUQsTUFBTSxDQUFDRSxJQUFJLENBQUMsZ0VBQWdFd0QsT0FBTyxFQUFFLEVBQUU7WUFBRXZELEtBQUssRUFBRTtVQUFnQixDQUFDLENBQUM7UUFDM0gsQ0FBQyxDQUFDLE9BQU9zRSxZQUFZLEVBQUU7VUFDbkIsSUFBSSxDQUFDekUsTUFBTSxDQUFDd0IsS0FBSyxDQUFDLHVDQUF1Q2tDLE9BQU8saUNBQWlDZSxZQUFZLENBQUNuRCxPQUFPLEVBQUUsRUFBRTtZQUFFbkIsS0FBSyxFQUFFO1VBQWdCLENBQUMsQ0FBQztRQUN4SjtNQUNKO01BQ0E7TUFDQTtNQUNBO01BQ0EsSUFBSSxDQUFDUixRQUFRLENBQUNvRixnQkFBZ0IsQ0FBQ3BDLFlBQVksQ0FBQzs7TUFFNUM7TUFDQSxPQUFPO1FBQ0hRLE9BQU8sRUFBRSxLQUFLO1FBQ2QzQixLQUFLLEVBQUU7VUFDSFMsSUFBSSxFQUFFNEMsY0FBYztVQUNwQnZELE9BQU8sRUFBRSxrQ0FBa0NFLEtBQUssQ0FBQ0YsT0FBTyxFQUFFO1VBQzFEOEIsT0FBTyxFQUFFNUIsS0FBSyxDQUFDQztRQUNuQjtNQUNKLENBQUM7SUFDTDtFQUNKOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7RUFDSSxNQUFNYSxpQkFBaUJBLENBQUNFLEtBQUssRUFBRTtJQUFFQztFQUFTLENBQUMsRUFBRTtJQUN6QyxNQUFNRyxRQUFRLEdBQUdoRSxJQUFJLENBQUNpRSxPQUFPLENBQUNKLFFBQVEsQ0FBQyxDQUFDVixTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQzs7SUFFdEQsSUFBSTtNQUNBLElBQUksQ0FBQy9CLE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLHdCQUF3QnVDLFFBQVEsRUFBRSxFQUFFO1FBQUVHLFFBQVE7UUFBRXpDLEtBQUssRUFBRVgsZ0JBQWdCLENBQUNZLE1BQU0sQ0FBQzRFO01BQVcsQ0FBQyxDQUFDO01BQzdHLE1BQU1DLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQ0MsZ0JBQWdCLENBQUN6QyxRQUFRLENBQUM7TUFDdEQsSUFBSSxDQUFDekMsTUFBTSxDQUFDRSxJQUFJLENBQUMsaUNBQWlDLEVBQUU7UUFBRTBDLFFBQVE7UUFBRXpDLEtBQUssRUFBRVgsZ0JBQWdCLENBQUNZLE1BQU0sQ0FBQzRFO01BQVcsQ0FBQyxDQUFDO01BQzVHLE9BQU87UUFBRTdCLE9BQU8sRUFBRSxJQUFJO1FBQUU4QjtNQUFTLENBQUM7SUFDdEMsQ0FBQyxDQUFDLE9BQU96RCxLQUFLLEVBQUU7TUFDWixNQUFNMkQsaUJBQWlCLEdBQUczRCxLQUFLLENBQUNTLElBQUksSUFBSSxtQkFBbUI7TUFDM0QsSUFBSSxDQUFDakMsTUFBTSxDQUFDd0IsS0FBSyxDQUFDLElBQUkyRCxpQkFBaUIsNkJBQTZCM0QsS0FBSyxDQUFDRixPQUFPLEVBQUUsRUFBRTtRQUFFc0I7TUFBUyxDQUFDLENBQUM7TUFDbEc7TUFDQSxPQUFPO1FBQ0hPLE9BQU8sRUFBRSxLQUFLO1FBQ2QzQixLQUFLLEVBQUU7VUFDSFMsSUFBSSxFQUFFa0QsaUJBQWlCO1VBQ3ZCN0QsT0FBTyxFQUFFLGlDQUFpQ0UsS0FBSyxDQUFDRixPQUFPLEVBQUU7VUFDekQ4QixPQUFPLEVBQUU1QixLQUFLLENBQUNDO1FBQ25CO01BQ0osQ0FBQztJQUNMO0VBQ0o7O0VBR0E7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJLE1BQU1jLFlBQVlBLENBQUNDLEtBQUssRUFBRTtJQUFFRztFQUFhLENBQUMsRUFBRTtJQUN4QyxJQUFJLENBQUMzQyxNQUFNLENBQUNFLElBQUksQ0FBQywyQ0FBMkN5QyxZQUFZLEVBQUUsQ0FBQztJQUMzRSxNQUFNeUMsT0FBTyxHQUFHLElBQUksQ0FBQ3pGLFFBQVEsQ0FBQ29GLGdCQUFnQixDQUFDcEMsWUFBWSxDQUFDLENBQUMsQ0FBQztJQUM5RCxJQUFJeUMsT0FBTyxFQUFFO01BQ1QsSUFBSSxDQUFDcEYsTUFBTSxDQUFDRSxJQUFJLENBQUMsY0FBY3lDLFlBQVksdUNBQXVDLENBQUM7TUFDbkY7TUFDQSxNQUFNMEMsY0FBYyxHQUFHLElBQUksQ0FBQzFGLFFBQVEsQ0FBQzJGLGFBQWEsQ0FBQzNDLFlBQVksQ0FBQyxDQUFDLENBQUM7TUFDbEUsSUFBSTBDLGNBQWMsSUFBSUEsY0FBYyxDQUFDOUIsTUFBTSxFQUFFO1FBQ3hDOEIsY0FBYyxDQUFDOUIsTUFBTSxDQUFDbUIsV0FBVyxDQUFDQyxJQUFJLENBQUMsNEJBQTRCLEVBQUU7VUFBRWhDO1FBQWEsQ0FBQyxDQUFDO01BQzNGO0lBQ0osQ0FBQyxNQUFNO01BQ0gsSUFBSSxDQUFDM0MsTUFBTSxDQUFDMEIsSUFBSSxDQUFDLGNBQWNpQixZQUFZLDBDQUEwQyxDQUFDO0lBQzFGO0lBQ0EsT0FBTztNQUFFUSxPQUFPLEVBQUVpQztJQUFRLENBQUM7RUFDL0I7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTVIsaUJBQWlCQSxDQUFDakMsWUFBWSxFQUFFRixRQUFRLEVBQUVDLE9BQU8sRUFBRTtJQUNyRCxNQUFNRSxRQUFRLEdBQUdoRSxJQUFJLENBQUNpRSxPQUFPLENBQUNKLFFBQVEsQ0FBQyxDQUFDVixTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQzs7SUFFdEQsSUFBSTtNQUNBLElBQUksQ0FBQy9CLE1BQU0sQ0FBQ3FELFVBQVUsQ0FBQztRQUFFVixZQUFZO1FBQUVDO01BQVMsQ0FBQyxDQUFDO01BQ2xELElBQUksQ0FBQzVDLE1BQU0sQ0FBQ3VGLGtCQUFrQixDQUFDL0YsZ0JBQWdCLENBQUNZLE1BQU0sQ0FBQ0MsUUFBUSxFQUFFYixnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDNEUsVUFBVSxDQUFDOztNQUVwRztNQUNBLE1BQU0xRSxVQUFVLEdBQUdqQixrQkFBa0IsQ0FBQ2tCLGlCQUFpQixDQUFDLFFBQVEsRUFBRTtRQUFFaUYsWUFBWSxFQUFFO01BQU0sQ0FBQyxDQUFDO01BQzFGLE1BQU0vRSxXQUFXLEdBQUdwQixrQkFBa0IsQ0FBQ2tCLGlCQUFpQixDQUFDLFNBQVMsRUFBRTtRQUFFaUYsWUFBWSxFQUFFO01BQU0sQ0FBQyxDQUFDO01BRTVGLElBQUksQ0FBQ2xGLFVBQVUsSUFBSSxDQUFDRyxXQUFXLEVBQUU7UUFDN0I7UUFDQSxNQUFNZ0YsV0FBVyxHQUFHLElBQUlqRixLQUFLLENBQUMsMkVBQTJFLENBQUM7UUFDMUdpRixXQUFXLENBQUN4RCxJQUFJLEdBQUcsa0JBQWtCO1FBQ3JDLE1BQU13RCxXQUFXO01BQ3JCO01BRUEsSUFBSSxDQUFDekYsTUFBTSxDQUFDRSxJQUFJLENBQUMsb0JBQW9CSSxVQUFVLEVBQUUsQ0FBQztNQUNsRCxJQUFJLENBQUNOLE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLHFCQUFxQk8sV0FBVyxFQUFFLENBQUM7O01BRXBEO01BQ0EsTUFBTTRFLGNBQWMsR0FBRyxJQUFJLENBQUMxRixRQUFRLENBQUMyRixhQUFhLENBQUMzQyxZQUFZLENBQUM7TUFDaEUsSUFBSSxDQUFDMEMsY0FBYyxFQUFFO1FBQ2pCO1FBQ0EsSUFBSSxDQUFDckYsTUFBTSxDQUFDMEIsSUFBSSxDQUFDLGNBQWNpQixZQUFZLHNGQUFzRixDQUFDO1FBQ2xJO1FBQ0EsT0FBTyxDQUFDO01BQ1o7O01BRUE7TUFDQSxJQUFJRyxVQUFVLEdBQUd1QyxjQUFjLENBQUN2QyxVQUFVO01BRTFDLE1BQU1ZLE9BQU8sR0FBRzJCLGNBQWMsQ0FBQzNCLE9BQU87TUFDdEMsTUFBTWdDLGdCQUFnQixHQUFHTCxjQUFjLENBQUM1QyxRQUFRLENBQUMsQ0FBQztNQUNsRCxNQUFNa0QsWUFBWSxHQUFHL0csSUFBSSxDQUFDZ0gsSUFBSSxDQUFDbEMsT0FBTyxFQUFFLEdBQUc5RSxJQUFJLENBQUNzRixRQUFRLENBQUN3QixnQkFBZ0IsQ0FBQyxJQUFJcEIsSUFBSSxDQUFDQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDOztNQUVqRztNQUNBO01BQ0E7TUFDQSxNQUFNekYsRUFBRSxDQUFDK0csSUFBSSxDQUFDSCxnQkFBZ0IsRUFBRUMsWUFBWSxDQUFDO01BQzdDLElBQUksQ0FBQzNGLE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLHNDQUFzQ3lGLFlBQVksRUFBRSxDQUFDO01BRXRFLElBQUksQ0FBQzNGLE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLHlCQUF5QndELE9BQU8sRUFBRSxDQUFDO01BQ3BELElBQUksQ0FBQzFELE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLHlCQUF5QnlGLFlBQVksRUFBRSxDQUFDOztNQUV6RDtNQUNBLElBQUksQ0FBQzNGLE1BQU0sQ0FBQ3VGLGtCQUFrQixDQUFDL0YsZ0JBQWdCLENBQUNZLE1BQU0sQ0FBQzRFLFVBQVUsRUFBRXhGLGdCQUFnQixDQUFDWSxNQUFNLENBQUMwRixZQUFZLENBQUM7TUFDeEcsSUFBSSxDQUFDbkcsUUFBUSxDQUFDb0csY0FBYyxDQUFDcEQsWUFBWSxFQUFFO1FBQUV3QixNQUFNLEVBQUUzRSxnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDMEYsWUFBWTtRQUFFMUIsUUFBUSxFQUFFO01BQUUsQ0FBQyxDQUFDOztNQUV6RztNQUNBLElBQUksQ0FBQ3BFLE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLDZCQUE2QnlGLFlBQVksRUFBRSxDQUFDO01BQzdELE1BQU1WLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQ0MsZ0JBQWdCLENBQUNTLFlBQVksQ0FBQztNQUMxRCxJQUFJLENBQUMzRixNQUFNLENBQUNFLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQztNQUNuRCxJQUFJLENBQUNGLE1BQU0sQ0FBQ21CLEtBQUssQ0FBQyxtQkFBbUIsRUFBRTVCLGtCQUFrQixDQUFDMEYsUUFBUSxDQUFDLENBQUM7O01BRXBFO01BQ0EsSUFBSSxDQUFDakYsTUFBTSxDQUFDRSxJQUFJLENBQUMsK0JBQStCLEVBQUU7UUFBRUMsS0FBSyxFQUFFWCxnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDNEY7TUFBVyxDQUFDLENBQUM7TUFDaEcsSUFBSSxDQUFDckcsUUFBUSxDQUFDb0csY0FBYyxDQUFDcEQsWUFBWSxFQUFFO1FBQUV3QixNQUFNLEVBQUUzRSxnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDNEYsVUFBVTtRQUFFNUIsUUFBUSxFQUFFO01BQUcsQ0FBQyxDQUFDO01BQ3hHLE1BQU02QixVQUFVLEdBQUcsRUFBRSxDQUFDLENBQUM7O01BRXZCO01BQ0EsSUFBSSxDQUFDakcsTUFBTSxDQUFDdUYsa0JBQWtCLENBQUMvRixnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDNEYsVUFBVSxFQUFFeEcsZ0JBQWdCLENBQUNZLE1BQU0sQ0FBQzhGLGdCQUFnQixDQUFDO01BQzVHLElBQUksQ0FBQ3ZHLFFBQVEsQ0FBQ29HLGNBQWMsQ0FBQ3BELFlBQVksRUFBRTtRQUFFd0IsTUFBTSxFQUFFM0UsZ0JBQWdCLENBQUNZLE1BQU0sQ0FBQzhGLGdCQUFnQjtRQUFFOUIsUUFBUSxFQUFFO01BQUcsQ0FBQyxDQUFDO01BRTlHLE1BQU0rQixTQUFTLEdBQUd2SCxJQUFJLENBQUNnSCxJQUFJLENBQUNsQyxPQUFPLEVBQUUsV0FBVyxDQUFDO01BQ2pELElBQUksQ0FBQzFELE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLHdCQUF3QmlHLFNBQVMsRUFBRSxDQUFDO01BQ3JELE1BQU0sSUFBSSxDQUFDQyxZQUFZLENBQUNULFlBQVksRUFBRVEsU0FBUyxDQUFDO01BQ2hELElBQUksQ0FBQ25HLE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLDhCQUE4QixDQUFDOztNQUVoRDtNQUNBLElBQUltRyxhQUFhLEdBQUcsSUFBSTtNQUN4QixJQUFJM0QsT0FBTyxDQUFDNEQsVUFBVSxLQUFLLEtBQUssRUFBRTtRQUM5QixJQUFJLENBQUN0RyxNQUFNLENBQUN1RixrQkFBa0IsQ0FBQy9GLGdCQUFnQixDQUFDWSxNQUFNLENBQUM4RixnQkFBZ0IsRUFBRTFHLGdCQUFnQixDQUFDWSxNQUFNLENBQUNtRyxZQUFZLENBQUM7UUFDOUcsSUFBSSxDQUFDNUcsUUFBUSxDQUFDb0csY0FBYyxDQUFDcEQsWUFBWSxFQUFFO1VBQUV3QixNQUFNLEVBQUUzRSxnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDbUcsWUFBWTtVQUFFbkMsUUFBUSxFQUFFO1FBQUcsQ0FBQyxDQUFDO1FBRTFHLE1BQU1vQyxvQkFBb0IsR0FBR2pILGtCQUFrQixDQUFDO1VBQUVrSCxRQUFRLEVBQUUvRCxPQUFPLENBQUMrRCxRQUFRLElBQUk7UUFBSyxDQUFDLENBQUM7UUFDdkYsSUFBSSxDQUFDekcsTUFBTSxDQUFDRSxJQUFJLENBQUMsa0NBQWtDLEVBQUVzRyxvQkFBb0IsQ0FBQztRQUMxRUgsYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDSyxlQUFlLENBQUNQLFNBQVMsRUFBRXpELE9BQU8sQ0FBQytELFFBQVEsSUFBSSxJQUFJLENBQUM7UUFFL0UsSUFBSSxDQUFDSixhQUFhLElBQUksQ0FBQ0EsYUFBYSxDQUFDTSxJQUFJLElBQUlOLGFBQWEsQ0FBQ00sSUFBSSxDQUFDQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtVQUMzRSxJQUFJLENBQUM1RyxNQUFNLENBQUN1RixrQkFBa0IsQ0FBQy9GLGdCQUFnQixDQUFDWSxNQUFNLENBQUNtRyxZQUFZLEVBQUUvRyxnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDeUcsYUFBYSxDQUFDO1VBQzNHLElBQUksQ0FBQ2xILFFBQVEsQ0FBQ29HLGNBQWMsQ0FBQ3BELFlBQVksRUFBRTtZQUFFd0IsTUFBTSxFQUFFM0UsZ0JBQWdCLENBQUNZLE1BQU0sQ0FBQ3lHLGFBQWE7WUFBRXpDLFFBQVEsRUFBRTtVQUFHLENBQUMsQ0FBQztVQUMzRyxJQUFJLENBQUNwRSxNQUFNLENBQUNFLElBQUksQ0FBQyxpRkFBaUYsQ0FBQztRQUN2RyxDQUFDLE1BQU07VUFDSCxJQUFJLENBQUNQLFFBQVEsQ0FBQ29HLGNBQWMsQ0FBQ3BELFlBQVksRUFBRTtZQUFFd0IsTUFBTSxFQUFFM0UsZ0JBQWdCLENBQUNZLE1BQU0sQ0FBQ21HLFlBQVk7WUFBRW5DLFFBQVEsRUFBRTtVQUFHLENBQUMsQ0FBQztVQUMxRyxJQUFJLENBQUNwRSxNQUFNLENBQUNFLElBQUksQ0FBQyx5Q0FBeUNtRyxhQUFhLENBQUNNLElBQUksQ0FBQ0csTUFBTSxjQUFjLENBQUM7UUFDdEc7TUFDSjtNQUVBLElBQUksQ0FBQzlHLE1BQU0sQ0FBQ3VGLGtCQUFrQixDQUMxQmMsYUFBYSxHQUFHN0csZ0JBQWdCLENBQUNZLE1BQU0sQ0FBQ21HLFlBQVksR0FBRy9HLGdCQUFnQixDQUFDWSxNQUFNLENBQUM4RixnQkFBZ0IsRUFDL0YxRyxnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDNEYsVUFDNUIsQ0FBQztNQUNELElBQUksQ0FBQ3JHLFFBQVEsQ0FBQ29HLGNBQWMsQ0FBQ3BELFlBQVksRUFBRTtRQUFFd0IsTUFBTSxFQUFFM0UsZ0JBQWdCLENBQUNZLE1BQU0sQ0FBQzRGLFVBQVU7UUFBRTVCLFFBQVEsRUFBRTtNQUFHLENBQUMsQ0FBQztNQUN4RyxJQUFJLENBQUNwRSxNQUFNLENBQUNFLElBQUksQ0FBQyw0QkFBNEIsQ0FBQzs7TUFFOUM7TUFDQSxNQUFNNkcsUUFBUSxHQUFHLElBQUksQ0FBQ0MsZ0JBQWdCLENBQUMvQixRQUFRLEVBQUVnQixVQUFVLEVBQUVJLGFBQWEsRUFBRTNELE9BQU8sQ0FBQztNQUNwRixJQUFJLENBQUMxQyxNQUFNLENBQUNFLElBQUksQ0FBQyxvQ0FBb0M2RyxRQUFRLENBQUNELE1BQU0sY0FBYyxDQUFDOztNQUVuRjtNQUNBLElBQUk7UUFDQTtRQUNBLElBQUksQ0FBQ2hFLFVBQVUsRUFBRTtVQUNiQSxVQUFVLEdBQUdsRSxJQUFJLENBQUNnSCxJQUFJLENBQUNsQyxPQUFPLEVBQUUsR0FBRzlFLElBQUksQ0FBQ3NGLFFBQVEsQ0FBQ3pCLFFBQVEsRUFBRTdELElBQUksQ0FBQ2lFLE9BQU8sQ0FBQ0osUUFBUSxDQUFDLENBQUMsS0FBSyxDQUFDO1FBQzVGO1FBRUEsSUFBSSxDQUFDekMsTUFBTSxDQUFDRSxJQUFJLENBQUMsZ0NBQWdDNEMsVUFBVSxFQUFFLENBQUM7UUFDOUQsTUFBTWhFLEVBQUUsQ0FBQ21JLFNBQVMsQ0FBQ25FLFVBQVUsRUFBRWlFLFFBQVEsRUFBRSxNQUFNLENBQUM7UUFDaEQsSUFBSSxDQUFDL0csTUFBTSxDQUFDRSxJQUFJLENBQUMsZ0RBQWdENkcsUUFBUSxDQUFDRCxNQUFNLGNBQWMsQ0FBQzs7UUFFL0Y7UUFDQSxJQUFJLENBQUM5RyxNQUFNLENBQUN1RixrQkFBa0IsQ0FBQy9GLGdCQUFnQixDQUFDWSxNQUFNLENBQUM0RixVQUFVLEVBQUV4RyxnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDOEcsU0FBUyxDQUFDO1FBQ3JHLElBQUksQ0FBQ3ZILFFBQVEsQ0FBQ29HLGNBQWMsQ0FBQ3BELFlBQVksRUFBRTtVQUN2Q3dCLE1BQU0sRUFBRTNFLGdCQUFnQixDQUFDWSxNQUFNLENBQUM4RyxTQUFTO1VBQ3pDOUMsUUFBUSxFQUFFLEdBQUc7VUFDYitDLE1BQU0sRUFBRUosUUFBUTtVQUNoQmpFO1FBQ0osQ0FBQyxDQUFDO1FBRUYsSUFBSSxDQUFDOUMsTUFBTSxDQUFDb0gscUJBQXFCLENBQUN4RSxRQUFRLENBQUM7TUFDL0MsQ0FBQyxDQUFDLE9BQU95RSxVQUFVLEVBQUU7UUFDakI7UUFDQUEsVUFBVSxDQUFDcEYsSUFBSSxHQUFHb0YsVUFBVSxDQUFDcEYsSUFBSSxJQUFJLGNBQWM7UUFDbkQsSUFBSSxDQUFDakMsTUFBTSxDQUFDd0IsS0FBSyxDQUFDLElBQUk2RixVQUFVLENBQUNwRixJQUFJLCtDQUErQ29GLFVBQVUsQ0FBQy9GLE9BQU8sRUFBRSxDQUFDO1FBQ3pHO1FBQ0EsTUFBTSxJQUFJZCxLQUFLLENBQUMscUNBQXFDNkcsVUFBVSxDQUFDL0YsT0FBTyxFQUFFLENBQUM7TUFDOUU7O01BRUk7O01BRUE7TUFDQTtNQUNBO0lBQ0osQ0FBQyxDQUFDLE9BQU9FLEtBQUssRUFBRTtNQUNaO01BQ0EsTUFBTThGLFNBQVMsR0FBRzlGLEtBQUssQ0FBQ1MsSUFBSSxJQUFJLDJCQUEyQjs7TUFFM0Q7TUFDQSxNQUFNc0YsY0FBYyxHQUFHaEksa0JBQWtCLENBQUM7UUFDdEMrQixPQUFPLEVBQUVFLEtBQUssQ0FBQ0YsT0FBTztRQUN0QkcsS0FBSyxFQUFFRCxLQUFLLENBQUNDLEtBQUs7UUFBRTtRQUNwQlEsSUFBSSxFQUFFcUYsU0FBUyxDQUFDO01BQ3BCLENBQUMsQ0FBQzs7TUFFRjtNQUNBLElBQUksQ0FBQ3RILE1BQU0sQ0FBQzhFLGtCQUFrQixDQUFDbEMsUUFBUSxFQUFFMkUsY0FBYyxFQUFFO1FBQUV0RixJQUFJLEVBQUVxRjtNQUFVLENBQUMsQ0FBQzs7TUFFN0U7TUFDQSxJQUFJLENBQUMzSCxRQUFRLENBQUNvRyxjQUFjLENBQUNwRCxZQUFZLEVBQUU7UUFDdkN3QixNQUFNLEVBQUUzRSxnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDb0gsS0FBSztRQUNyQ2hHLEtBQUssRUFBRTtVQUFFO1VBQ0xTLElBQUksRUFBRXFGLFNBQVM7VUFDZmhHLE9BQU8sRUFBRUUsS0FBSyxDQUFDRixPQUFPLENBQUU7VUFDeEI7UUFDSjtNQUNKLENBQUMsQ0FBQzs7TUFFRjtJQUNKO0VBQ0o7RUFDSjtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTTRELGdCQUFnQkEsQ0FBQ3pDLFFBQVEsRUFBRTtJQUM3QixNQUFNRyxRQUFRLEdBQUdoRSxJQUFJLENBQUNpRSxPQUFPLENBQUNKLFFBQVEsQ0FBQyxDQUFDVixTQUFTLENBQUMsQ0FBQyxDQUFDO0lBQ3BELElBQUksQ0FBQy9CLE1BQU0sQ0FBQ3FELFVBQVUsQ0FBQztNQUFFVCxRQUFRO01BQUV6QyxLQUFLLEVBQUVYLGdCQUFnQixDQUFDWSxNQUFNLENBQUM0RTtJQUFXLENBQUMsQ0FBQztJQUUvRSxPQUFPLElBQUl5QyxPQUFPLENBQUMsQ0FBQ3hHLE9BQU8sRUFBRXlHLE1BQU0sS0FBSztNQUNwQztNQUNBLE1BQU1qSCxXQUFXLEdBQUdwQixrQkFBa0IsQ0FBQ2tCLGlCQUFpQixDQUFDLFNBQVMsRUFBRTtRQUFFaUYsWUFBWSxFQUFFO01BQU0sQ0FBQyxDQUFDO01BQzVGLElBQUksQ0FBQy9FLFdBQVcsRUFBRTtRQUNkLE1BQU1lLEtBQUssR0FBRyxJQUFJaEIsS0FBSyxDQUFDLDhEQUE4RCxDQUFDO1FBQ3ZGZ0IsS0FBSyxDQUFDUyxJQUFJLEdBQUcsa0JBQWtCLENBQUMsQ0FBQztRQUNqQyxJQUFJLENBQUNqQyxNQUFNLENBQUN3QixLQUFLLENBQUMsSUFBSUEsS0FBSyxDQUFDUyxJQUFJLEtBQUtULEtBQUssQ0FBQ0YsT0FBTyxFQUFFLENBQUM7UUFDckQsT0FBT29HLE1BQU0sQ0FBQ2xHLEtBQUssQ0FBQyxDQUFDLENBQUM7TUFDMUI7TUFFSSxJQUFJLENBQUN4QixNQUFNLENBQUNFLElBQUksQ0FBQyw0Q0FBNENPLFdBQVcsRUFBRSxDQUFDO01BQy9FO01BQ0EsTUFBTWtILE9BQU8sR0FBRzVJLE1BQU0sQ0FBQyxDQUFDO01BQ3hCNEksT0FBTyxDQUFDaEgsY0FBYyxDQUFDRixXQUFXLENBQUM7TUFFbkNrSCxPQUFPLENBQUNDLEtBQUssQ0FBQ25GLFFBQVEsQ0FBQyxDQUFDb0YsT0FBTyxDQUFDLENBQUN4RyxHQUFHLEVBQUU0RCxRQUFRLEtBQUs7UUFDL0MsSUFBSTVELEdBQUcsRUFBRTtVQUNMLE1BQU15RyxhQUFhLEdBQUcsSUFBSXRILEtBQUssQ0FBQyxtQkFBbUJhLEdBQUcsQ0FBQ0MsT0FBTyxFQUFFLENBQUM7VUFDakV3RyxhQUFhLENBQUM3RixJQUFJLEdBQUcsa0JBQWtCLENBQUMsQ0FBQztVQUN6QzZGLGFBQWEsQ0FBQzFFLE9BQU8sR0FBRy9CLEdBQUcsQ0FBQyxDQUFDO1VBQzdCLElBQUksQ0FBQ3JCLE1BQU0sQ0FBQ3dCLEtBQUssQ0FBQyxJQUFJc0csYUFBYSxDQUFDN0YsSUFBSSw2QkFBNkI2RixhQUFhLENBQUN4RyxPQUFPLEVBQUUsQ0FBQztVQUM3Rm9HLE1BQU0sQ0FBQ0ksYUFBYSxDQUFDLENBQUMsQ0FBQztVQUN2QjtRQUNKO1FBRUEsTUFBTUMsV0FBVyxHQUFHOUMsUUFBUSxDQUFDK0MsT0FBTyxDQUFDQyxJQUFJLENBQUNDLENBQUMsSUFBSUEsQ0FBQyxDQUFDQyxVQUFVLEtBQUssT0FBTyxDQUFDO1FBQ3hFLE1BQU1DLFdBQVcsR0FBR25ELFFBQVEsQ0FBQytDLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDQyxDQUFDLElBQUlBLENBQUMsQ0FBQ0MsVUFBVSxLQUFLLE9BQU8sQ0FBQztRQUV4RSxJQUFJLENBQUNKLFdBQVcsRUFBRTtVQUNkLE1BQU1NLGFBQWEsR0FBRyxJQUFJN0gsS0FBSyxDQUFDLG9DQUFvQyxDQUFDO1VBQ3JFNkgsYUFBYSxDQUFDcEcsSUFBSSxHQUFHLG1CQUFtQixDQUFDLENBQUM7VUFDMUMsSUFBSSxDQUFDakMsTUFBTSxDQUFDd0IsS0FBSyxDQUFDLElBQUk2RyxhQUFhLENBQUNwRyxJQUFJLEtBQUtvRyxhQUFhLENBQUMvRyxPQUFPLEVBQUUsQ0FBQztVQUNyRW9HLE1BQU0sQ0FBQ1csYUFBYSxDQUFDLENBQUMsQ0FBQztVQUN2QjtRQUNKO1FBRUEsTUFBTWxCLE1BQU0sR0FBRztVQUNYbUIsTUFBTSxFQUFFckQsUUFBUSxDQUFDcUQsTUFBTSxDQUFDQyxXQUFXO1VBQ25DQyxRQUFRLEVBQUV2RCxRQUFRLENBQUNxRCxNQUFNLENBQUNFLFFBQVE7VUFDbENDLElBQUksRUFBRXhELFFBQVEsQ0FBQ3FELE1BQU0sQ0FBQ0csSUFBSTtVQUMxQkMsT0FBTyxFQUFFekQsUUFBUSxDQUFDcUQsTUFBTSxDQUFDSyxRQUFRO1VBQ2pDQyxRQUFRLEVBQUVoSyxJQUFJLENBQUNzRixRQUFRLENBQUN6QixRQUFRLENBQUM7VUFDakNvRyxLQUFLLEVBQUU7WUFDSEMsS0FBSyxFQUFFZixXQUFXLENBQUNnQixVQUFVO1lBQzdCQyxLQUFLLEVBQUVqQixXQUFXLENBQUNpQixLQUFLO1lBQ3hCQyxNQUFNLEVBQUVsQixXQUFXLENBQUNrQixNQUFNO1lBQzFCQyxTQUFTLEVBQUUsSUFBSSxDQUFDQyxjQUFjLENBQUNwQixXQUFXLENBQUNxQixZQUFZLENBQUM7WUFDeERDLFdBQVcsRUFBRXRCLFdBQVcsQ0FBQ3VCLG9CQUFvQixJQUFJLEdBQUd2QixXQUFXLENBQUNpQixLQUFLLElBQUlqQixXQUFXLENBQUNrQixNQUFNO1VBQy9GLENBQUM7VUFDRE0sS0FBSyxFQUFFbkIsV0FBVyxHQUFHO1lBQ2pCVSxLQUFLLEVBQUVWLFdBQVcsQ0FBQ1csVUFBVTtZQUM3QlMsUUFBUSxFQUFFcEIsV0FBVyxDQUFDb0IsUUFBUTtZQUM5QkMsVUFBVSxFQUFFckIsV0FBVyxDQUFDc0I7VUFDNUIsQ0FBQyxHQUFHO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQzFKLE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLGdDQUFnQyxDQUFDO1FBQ2xEZSxPQUFPLENBQUNrRyxNQUFNLENBQUM7TUFDbkIsQ0FBQyxDQUFDO0lBQ04sQ0FBQyxDQUFDO0VBQ047O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJZ0MsY0FBY0EsQ0FBQ0QsU0FBUyxFQUFFO0lBQ3RCLElBQUksQ0FBQ0EsU0FBUyxFQUFFLE9BQU8sSUFBSTtJQUUzQixNQUFNUyxLQUFLLEdBQUdULFNBQVMsQ0FBQ1UsS0FBSyxDQUFDLEdBQUcsQ0FBQztJQUNsQyxJQUFJRCxLQUFLLENBQUM3QyxNQUFNLEtBQUssQ0FBQyxFQUFFO01BQ3BCLE9BQU8rQyxJQUFJLENBQUNDLEtBQUssQ0FBRUMsUUFBUSxDQUFDSixLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBR0ksUUFBUSxDQUFDSixLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBSSxHQUFHLENBQUMsR0FBRyxHQUFHO0lBQzVFO0lBRUEsT0FBT0ssVUFBVSxDQUFDZCxTQUFTLENBQUM7RUFDaEM7O0VBR0E7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTTlDLFlBQVlBLENBQUM2RCxTQUFTLEVBQUVuSCxVQUFVLEVBQUU7SUFDdEMsTUFBTUYsUUFBUSxHQUFHaEUsSUFBSSxDQUFDaUUsT0FBTyxDQUFDb0gsU0FBUyxDQUFDLENBQUNsSSxTQUFTLENBQUMsQ0FBQyxDQUFDO0lBQ3JELElBQUksQ0FBQy9CLE1BQU0sQ0FBQ3FELFVBQVUsQ0FBQztNQUFFVCxRQUFRO01BQUV6QyxLQUFLLEVBQUVYLGdCQUFnQixDQUFDWSxNQUFNLENBQUM4RjtJQUFpQixDQUFDLENBQUM7SUFFckYsT0FBTyxJQUFJdUIsT0FBTyxDQUFDLENBQUN4RyxPQUFPLEVBQUV5RyxNQUFNLEtBQUs7TUFDcEM7TUFDQSxNQUFNcEgsVUFBVSxHQUFHakIsa0JBQWtCLENBQUNrQixpQkFBaUIsQ0FBQyxRQUFRLEVBQUU7UUFBRWlGLFlBQVksRUFBRTtNQUFNLENBQUMsQ0FBQztNQUMxRixJQUFJLENBQUNsRixVQUFVLEVBQUU7UUFDYixNQUFNa0IsS0FBSyxHQUFHLElBQUloQixLQUFLLENBQUMsb0RBQW9ELENBQUM7UUFDN0VnQixLQUFLLENBQUNTLElBQUksR0FBRyxrQkFBa0IsQ0FBQyxDQUFDO1FBQ2pDLElBQUksQ0FBQ2pDLE1BQU0sQ0FBQ3dCLEtBQUssQ0FBQyxJQUFJQSxLQUFLLENBQUNTLElBQUksS0FBS1QsS0FBSyxDQUFDRixPQUFPLEVBQUUsQ0FBQztRQUNyRCxPQUFPb0csTUFBTSxDQUFDbEcsS0FBSyxDQUFDLENBQUMsQ0FBQztNQUMxQjtNQUVJLElBQUksQ0FBQ3hCLE1BQU0sQ0FBQ0UsSUFBSSxDQUFDLHFDQUFxQ0ksVUFBVSxFQUFFLENBQUM7TUFDdkU7TUFDQSxNQUFNcUgsT0FBTyxHQUFHNUksTUFBTSxDQUFDLENBQUM7TUFDeEI0SSxPQUFPLENBQUNqSCxhQUFhLENBQUNKLFVBQVUsQ0FBQztNQUVqQ3FILE9BQU8sQ0FBQ0MsS0FBSyxDQUFDcUMsU0FBUyxDQUFDLENBQ25CQyxNQUFNLENBQUNwSCxVQUFVLENBQUMsQ0FDbEJxSCxPQUFPLENBQUMsQ0FBQyxDQUNUQyxVQUFVLENBQUMsWUFBWSxDQUFDLENBQ3hCQyxZQUFZLENBQUMsR0FBRyxDQUFDLENBQ2pCekksRUFBRSxDQUFDLE9BQU8sRUFBRzBJLFdBQVcsSUFBSztRQUMxQixJQUFJLENBQUN0SyxNQUFNLENBQUNtQixLQUFLLENBQUMsbUJBQW1CbUosV0FBVyxFQUFFLENBQUM7TUFDdkQsQ0FBQyxDQUFDLENBQ0QxSSxFQUFFLENBQUMsVUFBVSxFQUFHd0MsUUFBUSxJQUFLO1FBQzFCLElBQUksQ0FBQ3BFLE1BQU0sQ0FBQ21CLEtBQUssQ0FBQyw4QkFBOEJvSixJQUFJLENBQUNDLFNBQVMsQ0FBQ3BHLFFBQVEsQ0FBQyxFQUFFLENBQUM7TUFDL0UsQ0FBQyxDQUFDLENBQ0R4QyxFQUFFLENBQUMsS0FBSyxFQUFFLE1BQU07UUFDYixJQUFJLENBQUM1QixNQUFNLENBQUNFLElBQUksQ0FBQyx5Q0FBeUMsQ0FBQztRQUMzRGUsT0FBTyxDQUFDLENBQUM7TUFDYixDQUFDLENBQUMsQ0FDRFcsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDUCxHQUFHLEVBQUVNLE1BQU0sRUFBRUssTUFBTSxLQUFLO1FBQUU7UUFDcEMsTUFBTXlJLGVBQWUsR0FBRyxJQUFJakssS0FBSyxDQUFDLG1DQUFtQ2EsR0FBRyxDQUFDQyxPQUFPLEVBQUUsQ0FBQztRQUNuRm1KLGVBQWUsQ0FBQ3hJLElBQUksR0FBRywyQkFBMkIsQ0FBQyxDQUFDO1FBQ3BEO1FBQ0F3SSxlQUFlLENBQUNySCxPQUFPLEdBQUc7VUFDdEJzSCxhQUFhLEVBQUVySixHQUFHO1VBQ2xCVyxNQUFNLEVBQUVBLE1BQU0sSUFBSTtRQUN0QixDQUFDO1FBQ0QsSUFBSSxDQUFDaEMsTUFBTSxDQUFDd0IsS0FBSyxDQUFDLElBQUlpSixlQUFlLENBQUN4SSxJQUFJLDZCQUE2QndJLGVBQWUsQ0FBQ25KLE9BQU8sYUFBYVUsTUFBTSxFQUFFLENBQUM7UUFDcEgwRixNQUFNLENBQUMrQyxlQUFlLENBQUMsQ0FBQyxDQUFDO01BQzdCLENBQUMsQ0FBQyxDQUNERSxHQUFHLENBQUMsQ0FBQztJQUNkLENBQUMsQ0FBQztFQUNOOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNJLE1BQU1qRSxlQUFlQSxDQUFDUCxTQUFTLEVBQUVNLFFBQVEsRUFBRTtJQUN2QyxNQUFNN0QsUUFBUSxHQUFHLEtBQUssQ0FBQyxDQUFDO0lBQ3hCLElBQUksQ0FBQzVDLE1BQU0sQ0FBQ3FELFVBQVUsQ0FBQztNQUFFVCxRQUFRO01BQUV6QyxLQUFLLEVBQUVYLGdCQUFnQixDQUFDWSxNQUFNLENBQUNtRztJQUFhLENBQUMsQ0FBQztJQUVqRixJQUFJO01BQ0E7TUFDQSxJQUFJLENBQUN2RyxNQUFNLENBQUNFLElBQUksQ0FBQyx5Q0FBeUNpRyxTQUFTLEVBQUUsQ0FBQztNQUN0RSxNQUFNZ0IsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDdEgsV0FBVyxDQUFDK0sscUJBQXFCLENBQUMsSUFBSSxFQUFFO1FBQzlEbkksUUFBUSxFQUFFMEQsU0FBUztRQUNuQnpELE9BQU8sRUFBRTtVQUFFK0Q7UUFBUztNQUN4QixDQUFDLENBQUM7O01BRUY7TUFDQSxJQUFJLENBQUN6RyxNQUFNLENBQUNFLElBQUksQ0FBQyxzQ0FBc0NpSCxNQUFNLENBQUMwRCxLQUFLLEVBQUUsQ0FBQztNQUN0RSxJQUFJMUcsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDdEUsV0FBVyxDQUFDaUwsc0JBQXNCLENBQUMsSUFBSSxFQUFFO1FBQUVELEtBQUssRUFBRTFELE1BQU0sQ0FBQzBEO01BQU0sQ0FBQyxDQUFDO01BRXpGLE9BQU8xRyxNQUFNLENBQUNBLE1BQU0sS0FBSyxXQUFXLElBQUlBLE1BQU0sQ0FBQ0EsTUFBTSxLQUFLLFFBQVEsSUFBSUEsTUFBTSxDQUFDQSxNQUFNLEtBQUssV0FBVyxFQUFFO1FBQ2pHO1FBQ0EsSUFBSSxDQUFDbkUsTUFBTSxDQUFDbUIsS0FBSyxDQUFDLHNDQUFzQ2dELE1BQU0sQ0FBQ0EsTUFBTSxlQUFlQSxNQUFNLENBQUNDLFFBQVEsSUFBSSxTQUFTLEVBQUUsQ0FBQztRQUNuSCxNQUFNLElBQUlxRCxPQUFPLENBQUN4RyxPQUFPLElBQUk4SixVQUFVLENBQUM5SixPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDdkRrRCxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUN0RSxXQUFXLENBQUNpTCxzQkFBc0IsQ0FBQyxJQUFJLEVBQUU7VUFBRUQsS0FBSyxFQUFFMUQsTUFBTSxDQUFDMEQ7UUFBTSxDQUFDLENBQUM7TUFDekY7TUFFQSxJQUFJMUcsTUFBTSxDQUFDQSxNQUFNLEtBQUssUUFBUSxFQUFFO1FBQzVCLE1BQU02RyxrQkFBa0IsR0FBRyxJQUFJeEssS0FBSyxDQUFDMkQsTUFBTSxDQUFDM0MsS0FBSyxJQUFJLHNCQUFzQixDQUFDO1FBQzVFd0osa0JBQWtCLENBQUMvSSxJQUFJLEdBQUcsd0JBQXdCLENBQUMsQ0FBQztRQUNwRCxJQUFJLENBQUNqQyxNQUFNLENBQUN3QixLQUFLLENBQUMsSUFBSXdKLGtCQUFrQixDQUFDL0ksSUFBSSwyQkFBMkIrSSxrQkFBa0IsQ0FBQzFKLE9BQU8sRUFBRSxDQUFDO1FBQ3JHLE1BQU0wSixrQkFBa0IsQ0FBQyxDQUFDO01BQzlCO01BRUEsSUFBSTdHLE1BQU0sQ0FBQ0EsTUFBTSxLQUFLLFdBQVcsRUFBRTtRQUMvQixNQUFNOEcsY0FBYyxHQUFHLElBQUl6SyxLQUFLLENBQUMseUJBQXlCLENBQUM7UUFDM0R5SyxjQUFjLENBQUNoSixJQUFJLEdBQUcsMkJBQTJCLENBQUMsQ0FBQztRQUNuRCxJQUFJLENBQUNqQyxNQUFNLENBQUMwQixJQUFJLENBQUMsSUFBSXVKLGNBQWMsQ0FBQ2hKLElBQUksMkJBQTJCLENBQUM7UUFDcEUsTUFBTWdKLGNBQWMsQ0FBQyxDQUFDO01BQzFCO01BRUEsSUFBSSxDQUFDOUcsTUFBTSxDQUFDZ0QsTUFBTSxJQUFJLENBQUNoRCxNQUFNLENBQUNnRCxNQUFNLENBQUNSLElBQUksSUFBSXhDLE1BQU0sQ0FBQ2dELE1BQU0sQ0FBQ1IsSUFBSSxDQUFDQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtRQUMzRSxJQUFJLENBQUM1RyxNQUFNLENBQUNFLElBQUksQ0FBQyx5RkFBeUYsRUFDdEc7VUFBRUMsS0FBSyxFQUFFWCxnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDeUc7UUFBYyxDQUFDLENBQUM7TUFDekQsQ0FBQyxNQUFNO1FBQ0gsSUFBSSxDQUFDN0csTUFBTSxDQUFDRSxJQUFJLENBQUMsNkNBQTZDaUUsTUFBTSxDQUFDZ0QsTUFBTSxDQUFDUixJQUFJLENBQUNHLE1BQU0sYUFBYSxDQUFDO01BQ3pHO01BRUEsT0FBTzNDLE1BQU0sQ0FBQ2dELE1BQU07SUFDeEIsQ0FBQyxDQUFDLE9BQU8zRixLQUFLLEVBQUU7TUFDWjtNQUNBQSxLQUFLLENBQUNTLElBQUksR0FBR1QsS0FBSyxDQUFDUyxJQUFJLElBQUksNEJBQTRCO01BQ3ZELElBQUksQ0FBQ2pDLE1BQU0sQ0FBQ3dCLEtBQUssQ0FBQyxJQUFJQSxLQUFLLENBQUNTLElBQUksMkJBQTJCVCxLQUFLLENBQUNGLE9BQU8sRUFBRSxDQUFDO01BQzNFLE1BQU1FLEtBQUssQ0FBQyxDQUFDO0lBQ2pCO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNJd0YsZ0JBQWdCQSxDQUFDL0IsUUFBUSxFQUFFZ0IsVUFBVSxFQUFFSSxhQUFhLEVBQUUzRCxPQUFPLEVBQUU7SUFDM0QsSUFBSSxDQUFDMUMsTUFBTSxDQUFDRSxJQUFJLENBQUMsNkJBQTZCLEVBQUU7TUFBRUMsS0FBSyxFQUFFWCxnQkFBZ0IsQ0FBQ1ksTUFBTSxDQUFDNEY7SUFBVyxDQUFDLENBQUM7SUFFOUYsTUFBTWUsUUFBUSxHQUFHLEVBQUU7O0lBRW5CO0lBQ0EsSUFBSXJFLE9BQU8sQ0FBQ3dJLEtBQUssRUFBRTtNQUNmbkUsUUFBUSxDQUFDb0UsSUFBSSxDQUFDLEtBQUt6SSxPQUFPLENBQUN3SSxLQUFLLEVBQUUsQ0FBQztJQUN2QyxDQUFDLE1BQU07TUFDSG5FLFFBQVEsQ0FBQ29FLElBQUksQ0FBQyxZQUFZbEcsUUFBUSxDQUFDMkQsUUFBUSxFQUFFLENBQUM7SUFDbEQ7SUFFQTdCLFFBQVEsQ0FBQ29FLElBQUksQ0FBQyxFQUFFLENBQUM7O0lBRWpCO0lBQ0FwRSxRQUFRLENBQUNvRSxJQUFJLENBQUMsc0JBQXNCLENBQUM7SUFDckNwRSxRQUFRLENBQUNvRSxJQUFJLENBQUMsRUFBRSxDQUFDO0lBQ2pCcEUsUUFBUSxDQUFDb0UsSUFBSSxDQUFDLHNCQUFzQixDQUFDO0lBQ3JDcEUsUUFBUSxDQUFDb0UsSUFBSSxDQUFDLGVBQWUsQ0FBQztJQUM5QnBFLFFBQVEsQ0FBQ29FLElBQUksQ0FBQyxnQkFBZ0JsRyxRQUFRLENBQUMyRCxRQUFRLElBQUksQ0FBQztJQUNwRDdCLFFBQVEsQ0FBQ29FLElBQUksQ0FBQyxnQkFBZ0IsSUFBSSxDQUFDQyxjQUFjLENBQUNuRyxRQUFRLENBQUN1RCxRQUFRLENBQUMsSUFBSSxDQUFDO0lBQ3pFekIsUUFBUSxDQUFDb0UsSUFBSSxDQUFDLGtCQUFrQmxHLFFBQVEsQ0FBQzRELEtBQUssQ0FBQ0csS0FBSyxJQUFJL0QsUUFBUSxDQUFDNEQsS0FBSyxDQUFDSSxNQUFNLElBQUksQ0FBQztJQUNsRmxDLFFBQVEsQ0FBQ29FLElBQUksQ0FBQyxjQUFjbEcsUUFBUSxDQUFDcUQsTUFBTSxJQUFJLENBQUM7SUFDaER2QixRQUFRLENBQUNvRSxJQUFJLENBQUMsbUJBQW1CbEcsUUFBUSxDQUFDNEQsS0FBSyxDQUFDQyxLQUFLLElBQUksQ0FBQztJQUUxRCxJQUFJN0QsUUFBUSxDQUFDc0UsS0FBSyxFQUFFO01BQ2hCeEMsUUFBUSxDQUFDb0UsSUFBSSxDQUFDLG1CQUFtQmxHLFFBQVEsQ0FBQ3NFLEtBQUssQ0FBQ1QsS0FBSyxJQUFJLENBQUM7TUFDMUQvQixRQUFRLENBQUNvRSxJQUFJLENBQUMsc0JBQXNCbEcsUUFBUSxDQUFDc0UsS0FBSyxDQUFDQyxRQUFRLElBQUksQ0FBQztJQUNwRTtJQUVBekMsUUFBUSxDQUFDb0UsSUFBSSxDQUFDLGtCQUFrQmxHLFFBQVEsQ0FBQzRELEtBQUssQ0FBQ0ssU0FBUyxRQUFRLENBQUM7SUFDakVuQyxRQUFRLENBQUNvRSxJQUFJLENBQUMsZUFBZXRCLElBQUksQ0FBQ0MsS0FBSyxDQUFDN0UsUUFBUSxDQUFDeUQsT0FBTyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUM7SUFDMUUzQixRQUFRLENBQUNvRSxJQUFJLENBQUMsaUJBQWlCLElBQUksQ0FBQ0UsY0FBYyxDQUFDcEcsUUFBUSxDQUFDd0QsSUFBSSxDQUFDLElBQUksQ0FBQztJQUV0RTFCLFFBQVEsQ0FBQ29FLElBQUksQ0FBQyxFQUFFLENBQUM7O0lBRWpCOztJQUVBO0lBQ0EsSUFBSTlFLGFBQWEsSUFBSUEsYUFBYSxDQUFDTSxJQUFJLElBQUlOLGFBQWEsQ0FBQ00sSUFBSSxDQUFDQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtNQUN6RUcsUUFBUSxDQUFDb0UsSUFBSSxDQUFDLGtCQUFrQixDQUFDO01BQ2pDcEUsUUFBUSxDQUFDb0UsSUFBSSxDQUFDLEVBQUUsQ0FBQztNQUNqQnBFLFFBQVEsQ0FBQ29FLElBQUksQ0FBQzlFLGFBQWEsQ0FBQ00sSUFBSSxDQUFDO0lBQ3JDLENBQUMsTUFBTSxJQUFJTixhQUFhLEVBQUU7TUFDdEJVLFFBQVEsQ0FBQ29FLElBQUksQ0FBQyxrQkFBa0IsQ0FBQztNQUNqQ3BFLFFBQVEsQ0FBQ29FLElBQUksQ0FBQyxFQUFFLENBQUM7TUFDakJwRSxRQUFRLENBQUNvRSxJQUFJLENBQUMscUNBQXFDLENBQUM7SUFDeEQ7SUFFQSxJQUFJLENBQUNuTCxNQUFNLENBQUNFLElBQUksQ0FBQyxxQ0FBcUM2RyxRQUFRLENBQUNELE1BQU0sUUFBUSxDQUFDO0lBQzlFLE9BQU9DLFFBQVEsQ0FBQ25CLElBQUksQ0FBQyxJQUFJLENBQUM7RUFDOUI7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJd0YsY0FBY0EsQ0FBQ0UsT0FBTyxFQUFFO0lBQ3BCLE1BQU1DLEtBQUssR0FBRzFCLElBQUksQ0FBQzJCLEtBQUssQ0FBQ0YsT0FBTyxHQUFHLElBQUksQ0FBQztJQUN4QyxNQUFNRyxPQUFPLEdBQUc1QixJQUFJLENBQUMyQixLQUFLLENBQUVGLE9BQU8sR0FBRyxJQUFJLEdBQUksRUFBRSxDQUFDO0lBQ2pELE1BQU1JLElBQUksR0FBRzdCLElBQUksQ0FBQzJCLEtBQUssQ0FBQ0YsT0FBTyxHQUFHLEVBQUUsQ0FBQztJQUVyQyxPQUFPLENBQ0hDLEtBQUssQ0FBQ3pKLFFBQVEsQ0FBQyxDQUFDLENBQUM2SixRQUFRLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxFQUNqQ0YsT0FBTyxDQUFDM0osUUFBUSxDQUFDLENBQUMsQ0FBQzZKLFFBQVEsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLEVBQ25DRCxJQUFJLENBQUM1SixRQUFRLENBQUMsQ0FBQyxDQUFDNkosUUFBUSxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FDbkMsQ0FBQy9GLElBQUksQ0FBQyxHQUFHLENBQUM7RUFDZjs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0l5RixjQUFjQSxDQUFDTyxLQUFLLEVBQUU7SUFDbEIsTUFBTUMsS0FBSyxHQUFHLENBQUMsR0FBRyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDO0lBQ3JDLElBQUlwRCxJQUFJLEdBQUdtRCxLQUFLO0lBQ2hCLElBQUlFLFNBQVMsR0FBRyxDQUFDO0lBRWpCLE9BQU9yRCxJQUFJLElBQUksSUFBSSxJQUFJcUQsU0FBUyxHQUFHRCxLQUFLLENBQUMvRSxNQUFNLEdBQUcsQ0FBQyxFQUFFO01BQ2pEMkIsSUFBSSxJQUFJLElBQUk7TUFDWnFELFNBQVMsRUFBRTtJQUNmO0lBRUEsT0FBTyxHQUFHckQsSUFBSSxDQUFDc0QsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFJRixLQUFLLENBQUNDLFNBQVMsQ0FBQyxFQUFFO0VBQ25EOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7RUFDSUUsWUFBWUEsQ0FBQ3ZKLFFBQVEsRUFBRTtJQUNuQixNQUFNd0osR0FBRyxHQUFHck4sSUFBSSxDQUFDaUUsT0FBTyxDQUFDSixRQUFRLENBQUMsQ0FBQ3lKLFdBQVcsQ0FBQyxDQUFDO0lBQ2hELE9BQU8sSUFBSSxDQUFDbk0sbUJBQW1CLENBQUNvTSxRQUFRLENBQUNGLEdBQUcsQ0FBQztFQUNqRDs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtFQUNJRyxPQUFPQSxDQUFBLEVBQUc7SUFDTixPQUFPO01BQ0huSSxJQUFJLEVBQUUsaUJBQWlCO01BQ3ZCb0ksVUFBVSxFQUFFLElBQUksQ0FBQ3RNLG1CQUFtQjtNQUNwQ3VNLFdBQVcsRUFBRSxrRUFBa0U7TUFDL0U1SixPQUFPLEVBQUU7UUFDTDRELFVBQVUsRUFBRSw2Q0FBNkM7UUFDekRHLFFBQVEsRUFBRSxzQ0FBc0M7UUFDaER5RSxLQUFLLEVBQUU7TUFDWDtJQUNKLENBQUM7RUFDTDtBQUNKO0FBRUFxQixNQUFNLENBQUNuTCxPQUFPLEdBQUczQixjQUFjIiwiaWdub3JlTGlzdCI6W119