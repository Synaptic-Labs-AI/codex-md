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
const { app } = require('electron');
const { spawn } = require('child_process');
const BaseService = require('../../BaseService');
const { v4: uuidv4 } = require('uuid'); // Import uuid for generating IDs
const BinaryPathResolver = require('../../../utils/BinaryPathResolver');
const { getLogger } = require('../../../utils/logging/ConversionLogger');
const { sanitizeForLogging } = require('../../../utils/logging/LogSanitizer');
const ConversionStatus = require('../../../utils/conversion/ConversionStatus');

class VideoConverter extends BaseService {
    constructor(registry, fileProcessor, transcriber, fileSystem) { // Use fileSystem instead of fileStorage
        super();
        this.registry = registry; // Store registry instance
        this.fileProcessor = fileProcessor; // TODO: Consolidate file operations?
        this.transcriber = transcriber;
        this.fileSystem = fileSystem; // Use fileSystem instance
        this.supportedExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'];
        // Remove internal activeConversions map - uses registry's map
        
        // Initialize the logger
        this.logger = getLogger('VideoConverter');
        this.ffmpegConfigured = false; // Flag to track if ffmpeg paths are set

        // Don't configure ffmpeg immediately, do it lazily
        // this.configureFfmpeg();
    }

    /**
     * Ensures ffmpeg/ffprobe paths are configured, calling configureFfmpeg only once.
     * @private
     */
    _ensureFfmpegConfigured() {
        if (!this.ffmpegConfigured) {
            this.configureFfmpeg();
            this.ffmpegConfigured = true; // Mark as configured (even if errors occurred, don't retry)
        }
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
            this.logger.log('Configuring ffmpeg and ffprobe paths using BinaryPathResolver', 'INFO', { phase: ConversionStatus.STATUS.STARTING });
            
            // Resolve ffmpeg binary path
            const ffmpegPath = BinaryPathResolver.resolveBinaryPath('ffmpeg');
            if (!ffmpegPath) {
                throw new Error('Failed to resolve ffmpeg binary path. Video conversion will not work.');
            }
            this.logger.log(`Successfully resolved ffmpeg binary at: ${ffmpegPath}`, 'INFO');
            
            // Resolve ffprobe binary path
            const ffprobePath = BinaryPathResolver.resolveBinaryPath('ffprobe');
            if (!ffprobePath) {
                throw new Error('Failed to resolve ffprobe binary path. Video metadata extraction will not work.');
            }
            this.logger.log(`Successfully resolved ffprobe binary at: ${ffprobePath}`, 'INFO');
            
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
            
            this.logger.log('Binary paths configured successfully:', 'INFO');
            this.logger.log(`- ffmpeg: ${ffmpegPath}`, 'INFO');
            this.logger.log(`- ffprobe: ${ffprobePath}`, 'INFO');
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
            this.logger.log(`Verifying ffmpeg works by checking formats: ${ffmpegPath}`, 'INFO');
            
            // Use spawn directly with the resolved path instead of relying on fluent-ffmpeg
            const process = spawn(ffmpegPath, ['-formats']);
            
            // Just log that we're checking, we don't need to wait for the result
            this.logger.debug(`Spawned ffmpeg process to check formats`);
            
            // Add listeners to log output but don't block
            process.stdout.on('data', (data) => {
                this.logger.debug(`ffmpeg formats check output: ${data.toString().substring(0, 100)}...`);
            });
            
            process.stderr.on('data', (data) => {
                this.logger.debug(`ffmpeg formats check stderr: ${data.toString().substring(0, 100)}...`);
            });
            
            process.on('error', (err) => {
                this.logger.error(`Error verifying ffmpeg: ${err.message}`);
                this.logger.error(`This may indicate a path resolution issue with ffmpeg`);
            });
            
            process.on('close', (code) => {
                this.logger.log(`ffmpeg formats check exited with code ${code}`, 'INFO');
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
    async handleConvert(event, { filePath, options = {} }) {
        const conversionId = `video_${uuidv4()}`; // Generate unique ID
        const fileType = path.extname(filePath).substring(1); // Get file extension without dot
        
        // Validate output path if provided
        if (options.outputPath) {
            try {
                const outputDir = path.dirname(options.outputPath);
                await fs.ensureDir(outputDir);
                this.logger.log(`Validated output directory: ${outputDir}`, 'INFO');
            } catch (error) {
                const setupError = new Error(`Invalid output path: ${error.message}`);
                setupError.code = 'E_SETUP'; // Add error code
                this.logger.error(`[${setupError.code}] ${setupError.message}`, { error }); // Log original error too
                // Re-throw the error to reject the promise as expected by tests
                throw setupError;
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
                this.logger.log(`Created managed temporary directory: ${tempDir}`, 'INFO', { phase: 'setup' });
                createdTempDir = true; // Mark that we created it
            } else {
                this.logger.log(`Using temporary directory provided by wrapper: ${tempDir}`, 'INFO', { phase: 'setup' });
                // Note: If provided by wrapper, its lifecycle is managed externally
            }

            // Register the conversion with the central registry
            this.registry.registerConversion(conversionId, {
                id: conversionId,
                type: 'video',
                name: path.basename(filePath),
                status: ConversionStatus.STATUS.STARTING,
                progress: 0,
                filePath, // Store original path if needed, but process temp file
                tempDir,
                window,
                startTime: Date.now(),
                outputPath: options.outputPath // Store output path in registry
            }, async () => { // Ensure callback is async
                // Cleanup function for the registry - Release the managed temporary directory
                // Only release if this instance created it (createdTempDir flag)
                // Check if createdTempDir is defined and true before releasing
                if (tempDir && typeof createdTempDir !== 'undefined' && createdTempDir) {
                    this.logger.log(`Releasing managed temporary directory via registry cleanup: ${tempDir}`, 'INFO', { phase: 'cleanup' });
                    try {
                        await this.fileSystem.releaseTemporaryDirectory(tempDir);
                        this.logger.log(`Successfully released temporary directory: ${tempDir}`, 'INFO', { phase: 'cleanup' });
                    } catch (cleanupError) {
                        this.logger.error(`Error releasing temporary directory ${tempDir} during registry cleanup: ${cleanupError.message}`, { phase: 'cleanup' });
                    }
                } else if (tempDir) {
                     this.logger.log(`Temporary directory ${tempDir} was provided externally or not created by this instance, skipping release via registry cleanup.`, 'INFO', { phase: 'cleanup' });
                }
            });

            // Notify client that conversion has started, only if window is available
            if (window) {
                window.webContents.send('video:conversion-started', { conversionId });
            } else {
                this.logger.warn(`Window not available for conversion ${conversionId}, skipping initial notification.`);
            }

            // Start conversion process asynchronously (fire and forget - result handled via registry/IPC)
            this.processConversion(conversionId, filePath, options);
            // No .catch() here; processConversion handles its own errors and registry updates.

            // Return success *initiation* response
            return { success: true, conversionId };
        } catch (error) {
            const setupErrorCode = error.code || 'E_SETUP_UNEXPECTED';
            this.logger.logConversionError(fileType, error, { phase: 'error_setup', code: setupErrorCode });
            
            // Ensure cleanup if tempDir was created *by this instance* before the error occurred during setup
            if (tempDir && typeof createdTempDir !== 'undefined' && createdTempDir) {
                this.logger.warn(`Error during initial setup for ${conversionId}. Releasing temporary directory: ${tempDir}`, { phase: 'error_cleanup' });
                try {
                    await this.fileSystem.releaseTemporaryDirectory(tempDir);
                    this.logger.log(`Successfully released temporary directory after setup error: ${tempDir}`, 'INFO', { phase: 'error_cleanup' });
                } catch (cleanupError) {
                    this.logger.error(`Error releasing temporary directory ${tempDir} during setup error handling: ${cleanupError.message}`, { phase: 'error_cleanup' });
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
    async handleGetMetadata(event, { filePath }) {
        const fileType = path.extname(filePath).substring(1); // Get file extension without dot
        
        try {
            this.logger.log(`Getting metadata for ${filePath}`, 'INFO', { fileType, phase: ConversionStatus.STATUS.VALIDATING });
            const metadata = await this.getVideoMetadata(filePath);
            this.logger.log(`Successfully retrieved metadata`, 'INFO', { fileType, phase: ConversionStatus.STATUS.VALIDATING });
            return { success: true, metadata };
        } catch (error) {
            const metadataErrorCode = error.code || 'E_METADATA_FAILED';
            this.logger.error(`[${metadataErrorCode}] Failed to get metadata: ${error.message}`, { fileType });
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
    async handleCancel(event, { conversionId }) {
        this.logger.log(`Received cancel request for conversion: ${conversionId}`, 'INFO');
        const removed = this.registry.removeConversion(conversionId); // This also triggers cleanup
        if (removed) {
            this.logger.log(`Conversion ${conversionId} cancelled and removed from registry.`, 'INFO');
            // Optionally notify the window if needed, though registry might handle this
            const conversionData = this.registry.getConversion(conversionId); // Should be null now
            if (conversionData && conversionData.window) {
                 conversionData.window.webContents.send('video:conversion-cancelled', { conversionId });
            }
        } else {
            this.logger.warn(`Conversion ${conversionId} not found in registry for cancellation.`);
        }
        return { success: removed };
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
            // Ensure ffmpeg is configured before proceeding
            this._ensureFfmpegConfigured(); // Ensure this call is present

            this.logger.setContext({ conversionId, fileType });
            this.logger.logPhaseTransition(ConversionStatus.STATUS.STARTING, ConversionStatus.STATUS.VALIDATING);
            
            // Verify that ffmpeg and ffprobe binaries are available before proceeding
            const ffmpegPath = BinaryPathResolver.resolveBinaryPath('ffmpeg', { forceRefresh: false });
            const ffprobePath = BinaryPathResolver.resolveBinaryPath('ffprobe', { forceRefresh: false });
            
            if (!ffmpegPath || !ffprobePath) {
                // Throw specific error to be caught below
                const binaryError = new Error('FFmpeg or FFprobe binaries not available. Cannot proceed with conversion.');
                binaryError.code = 'E_MISSING_BINARY';
                throw binaryError;
            }
            
            this.logger.log(`Using ffmpeg at: ${ffmpegPath}`, 'INFO');
            this.logger.log(`Using ffprobe at: ${ffprobePath}`, 'INFO');

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
            this.logger.log(`Copied original file to temp path: ${tempFilePath}`, 'INFO');

            this.logger.log(`Using temp directory: ${tempDir}`, 'INFO');
            this.logger.log(`Processing temp file: ${tempFilePath}`, 'INFO');

            // Try fast path first
            this.logger.logPhaseTransition(ConversionStatus.STATUS.VALIDATING, ConversionStatus.STATUS.FAST_ATTEMPT);
            this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.FAST_ATTEMPT, progress: 5 });
            
            // Extract metadata
            this.logger.log(`Extracting metadata from: ${tempFilePath}`, 'INFO');
            const metadata = await this.getVideoMetadata(tempFilePath);
            this.logger.log(`Metadata extracted successfully`, 'INFO');
            this.logger.debug('Metadata details:', sanitizeForLogging(metadata));

            // Skip thumbnail generation
            this.logger.log(`Skipping thumbnail generation`, 'INFO', { phase: ConversionStatus.STATUS.PROCESSING });
            this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.PROCESSING, progress: 10 });
            const thumbnails = []; // Empty array instead of generating thumbnails

            // Extract audio for transcription
            this.logger.logPhaseTransition(ConversionStatus.STATUS.PROCESSING, ConversionStatus.STATUS.EXTRACTING_AUDIO);
            this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.EXTRACTING_AUDIO, progress: 30 });
            
            const audioPath = path.join(tempDir, 'audio.mp3');
            this.logger.log(`Extracting audio to: ${audioPath}`, 'INFO');
            await this.extractAudio(tempFilePath, audioPath);
            this.logger.log(`Audio extracted successfully`, 'INFO');

            // Transcribe audio if requested
            let transcription = null;
            if (options.transcribe !== false) {
                this.logger.logPhaseTransition(ConversionStatus.STATUS.EXTRACTING_AUDIO, ConversionStatus.STATUS.TRANSCRIBING);
                this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.TRANSCRIBING, progress: 40 });
                
                const transcriptionOptions = sanitizeForLogging({ language: options.language || 'en' });
                this.logger.log(`Transcribing audio with options:`, 'INFO', transcriptionOptions);
                transcription = await this.transcribeAudio(audioPath, options.language || 'en');
                
                if (!transcription || !transcription.text || transcription.text.trim() === '') {
                    this.logger.logPhaseTransition(ConversionStatus.STATUS.TRANSCRIBING, ConversionStatus.STATUS.CONTENT_EMPTY);
                    this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.CONTENT_EMPTY, progress: 80 });
                    this.logger.log(`Transcription produced empty content - this is normal for videos without speech`, 'INFO');
                } else {
                    this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.TRANSCRIBING, progress: 80 });
                    this.logger.log(`Transcription completed successfully (${transcription.text.length} characters)`, 'INFO');
                }
            }

            this.logger.logPhaseTransition(
                transcription ? ConversionStatus.STATUS.TRANSCRIBING : ConversionStatus.STATUS.EXTRACTING_AUDIO, 
                ConversionStatus.STATUS.PROCESSING
            );
            this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.PROCESSING, progress: 90 });
            this.logger.log(`Generating markdown output`, 'INFO');

            // Generate markdown
            const markdown = this.generateMarkdown(metadata, thumbnails, transcription, options);
            this.logger.log(`Markdown generated successfully (${markdown.length} characters)`, 'INFO');

            // Write the markdown content to the output file
            try {
                // If outputPath not provided, create one in temp directory
                if (!outputPath) {
                    outputPath = path.join(tempDir, `${path.basename(filePath, path.extname(filePath))}.md`);
                }
                
                this.logger.log(`Writing markdown content to: ${outputPath}`, 'INFO');
                await fs.writeFile(outputPath, markdown, 'utf8');
                this.logger.log(`Successfully wrote markdown content to file (${markdown.length} characters)`, 'INFO');

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
                    stack: error.stack, // Keep stack for detailed logging
                    code: errorCode // Include the code
                });
                
                // Use the enhanced logger method that includes code
                // Log the error message directly, include sanitized details in metadata
                this.logger.logConversionError(fileType, error.message, { code: errorCode, details: sanitizedError });
                
                // Update registry with failed status and structured error object
                this.registry.pingConversion(conversionId, {
                    status: ConversionStatus.STATUS.ERROR,
                    error: { // Store structured error
                        code: errorCode,
                        message: error.message, // Keep original message for registry
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
        // Ensure ffmpeg (specifically ffprobe path) is configured
        this._ensureFfmpegConfigured(); // Add this call

        const fileType = path.extname(filePath).substring(1);
        this.logger.setContext({ fileType, phase: ConversionStatus.STATUS.VALIDATING });
        
        return new Promise((resolve, reject) => {
            // Ensure we have the latest ffmpeg path before running ffprobe
            const ffprobePath = BinaryPathResolver.resolveBinaryPath('ffprobe', { forceRefresh: false });
            if (!ffprobePath) {
                const error = new Error('FFprobe binary not available. Cannot extract video metadata.');
                error.code = 'E_MISSING_BINARY'; // Add error code
                this.logger.error(`[${error.code}] ${error.message}`);
                return reject(error); // Reject with the coded error
            }
                
                this.logger.log(`Getting video metadata using ffprobe at: ${ffprobePath}`, 'INFO');
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
                
                this.logger.log(`Metadata extraction successful`, 'INFO');
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
            return Math.round((parseInt(parts[0]) / parseInt(parts[1])) * 100) / 100;
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
        this.logger.setContext({ fileType, phase: ConversionStatus.STATUS.EXTRACTING_AUDIO });
        
        return new Promise((resolve, reject) => {
            // Ensure we have the latest ffmpeg path before extracting audio
            const ffmpegPath = BinaryPathResolver.resolveBinaryPath('ffmpeg', { forceRefresh: false });
            if (!ffmpegPath) {
                const error = new Error('FFmpeg binary not available. Cannot extract audio.');
                error.code = 'E_MISSING_BINARY'; // Add error code
                this.logger.error(`[${error.code}] ${error.message}`);
                return reject(error); // Reject with the coded error
            }
                
                this.logger.log(`Extracting audio using ffmpeg at: ${ffmpegPath}`, 'INFO');
            // Create a new ffmpeg command with the correct path to ensure we're not using cached paths
            const command = ffmpeg();
            command.setFfmpegPath(ffmpegPath);
            
            command.input(videoPath)
                .output(outputPath)
                .noVideo()
                .audioCodec('libmp3lame')
                .audioBitrate(128)
                .on('start', (commandLine) => {
                    this.logger.debug(`FFmpeg command: ${commandLine}`);
                })
                .on('progress', (progress) => {
                    this.logger.debug(`Audio extraction progress: ${JSON.stringify(progress)}`);
                })
                .on('end', () => {
                    this.logger.log(`Audio extraction completed successfully`, 'INFO');
                    resolve();
                })
                .on('error', (err, stdout, stderr) => { // Capture stdout/stderr for more context
                    const extractionError = new Error(`FFmpeg audio extraction failed: ${err.message}`);
                    extractionError.code = 'E_FFMPEG_AUDIO_EXTRACTION'; // Specific code
                    // Include ffmpeg's stderr if available, as it often contains useful info
                    extractionError.details = {
                        originalError: err,
                        stderr: stderr || 'N/A'
                    };
                    this.logger.error(`[${extractionError.code}] Audio extraction error: ${extractionError.message}. Stderr: ${stderr}`);
                    reject(extractionError); // Reject with the structured error
                })
                .run();
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
        this.logger.setContext({ fileType, phase: ConversionStatus.STATUS.TRANSCRIBING });
        
        try {
            // Use the TranscriberService to transcribe the audio
            this.logger.log(`Starting transcription of audio file: ${audioPath}`, 'INFO');
            const result = await this.transcriber.handleTranscribeStart(null, {
                filePath: audioPath,
                options: { language }
            });
            
            // Wait for transcription to complete
            this.logger.log(`Transcription job started with ID: ${result.jobId}`, 'INFO');
            let status = await this.transcriber.handleTranscribeStatus(null, { jobId: result.jobId });
            
            while (status.status !== 'completed' && status.status !== 'failed' && status.status !== 'cancelled') {
                // Wait a bit before checking again
                this.logger.debug(`Transcription in progress, status: ${status.status}, progress: ${status.progress || 'unknown'}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                status = await this.transcriber.handleTranscribeStatus(null, { jobId: result.jobId });
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
                this.logger.log(`Transcription completed but content is empty - this is normal for videos without speech`,
                    'INFO', { phase: ConversionStatus.STATUS.CONTENT_EMPTY });
            } else {
                this.logger.log(`Transcription completed successfully with ${status.result.text.length} characters`, 'INFO');
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
        this.logger.log(`Generating markdown content`, 'INFO', { phase: ConversionStatus.STATUS.PROCESSING });
        
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
        
        this.logger.log(`Markdown generation complete with ${markdown.length} lines`, 'INFO');
        return markdown.join('\n');
    }

    /**
     * Format duration in seconds to hh:mm:ss
     * @param {number} seconds - Duration in seconds
     * @returns {string} Formatted duration
     */
    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        return [
            hours.toString().padStart(2, '0'),
            minutes.toString().padStart(2, '0'),
            secs.toString().padStart(2, '0')
        ].join(':');
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
