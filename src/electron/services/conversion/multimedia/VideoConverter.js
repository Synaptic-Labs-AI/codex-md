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
 * - FileProcessorService.js: Used for file operations
 * - TranscriberService.js: Used for audio transcription
 * - FileStorageService.js: For temporary file management
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
const ConversionStatus = require('../../../utils/conversion/ConversionStatus');

class VideoConverter extends BaseService {
    constructor(registry, fileProcessor, transcriber, fileStorage) { // Add registry parameter
        super();
        this.registry = registry; // Store registry instance
        this.fileProcessor = fileProcessor;
        this.transcriber = transcriber;
        this.fileStorage = fileStorage;
        this.supportedExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'];
        // Remove internal activeConversions map - will use registry's map
        
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
            this.logger.info('Configuring ffmpeg and ffprobe paths using BinaryPathResolver', { phase: ConversionStatus.STATUS.STARTING });
            
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
    async handleConvert(event, { filePath, options = {} }) {
        const conversionId = `video_${uuidv4()}`; // Generate unique ID
        const fileType = path.extname(filePath).substring(1); // Get file extension without dot
        
        // Initialize logger with context for this conversion
        this.logger.setContext({ 
            conversionId, 
            fileType
        });
        
        this.logger.logConversionStart(fileType, options);
        
        // Get window reference safely, handling null event
        const window = event?.sender?.getOwnerBrowserWindow(); 
        let tempDir = options._tempDir; // Check if tempDir was passed by the wrapper

        try {
            // Create temp directory only if not passed by the wrapper
            if (!tempDir) {
                tempDir = await this.fileStorage.createTempDir('video_conversion');
                this.logger.info(`Created temp directory: ${tempDir}`);
            } else {
                this.logger.info(`Using temp directory provided by wrapper: ${tempDir}`);
            }
            // Create temp directory for this conversion
            tempDir = await this.fileStorage.createTempDir('video_conversion');
            this.logger.info(`Created temp directory: ${tempDir}`);

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
                startTime: Date.now()
            }, async () => {
                // Cleanup function for the registry
                if (tempDir) {
                    this.logger.info(`Removing temp directory: ${tempDir}`, { phase: 'cleanup' });
                    await fs.remove(tempDir);
                }
            });

            // Notify client that conversion has started, only if window is available
            if (window) {
                window.webContents.send('video:conversion-started', { conversionId });
            } else {
                this.logger.warn(`Window not available for conversion ${conversionId}, skipping initial notification.`);
            }

            // Start conversion process asynchronously
            // Pass the file path (which should be the temp file path if created) and options
            this.processConversion(conversionId, filePath, options).catch(error => {
                this.logger.error(`Conversion failed for ${conversionId}: ${error.message}`);
                this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.ERROR, error: error.message });
                // Cleanup is handled by the registry's removal process
            });

            return { conversionId };
        } catch (error) {
            this.logger.logConversionError(fileType, error);
            // Ensure cleanup if tempDir was created before error
            if (tempDir) {
                await fs.remove(tempDir);
            }
            // Remove from registry if it was added before error
            this.registry.removeConversion(conversionId);
            throw error;
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
            this.logger.info(`Getting metadata for ${filePath}`, { fileType, phase: ConversionStatus.STATUS.VALIDATING });
            const metadata = await this.getVideoMetadata(filePath);
            this.logger.info(`Successfully retrieved metadata`, { fileType, phase: ConversionStatus.STATUS.VALIDATING });
            return metadata;
        } catch (error) {
            this.logger.error(`Failed to get metadata: ${error.message}`, { fileType });
            throw error;
        }
    }


    /**
     * Handle conversion cancellation request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Cancellation request details
     */
    async handleCancel(event, { conversionId }) {
        this.logger.info(`Received cancel request for conversion: ${conversionId}`);
        const removed = this.registry.removeConversion(conversionId); // This also triggers cleanup
        if (removed) {
            this.logger.info(`Conversion ${conversionId} cancelled and removed from registry.`);
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
            this.logger.setContext({ conversionId, fileType });
            this.logger.logPhaseTransition(ConversionStatus.STATUS.STARTING, ConversionStatus.STATUS.VALIDATING);
            
            // Verify that ffmpeg and ffprobe binaries are available before proceeding
            const ffmpegPath = BinaryPathResolver.resolveBinaryPath('ffmpeg', { forceRefresh: false });
            const ffprobePath = BinaryPathResolver.resolveBinaryPath('ffprobe', { forceRefresh: false });
            
            if (!ffmpegPath || !ffprobePath) {
                throw new Error('FFmpeg or FFprobe binaries not available. Cannot proceed with conversion.');
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
            this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.FAST_ATTEMPT, progress: 5 });
            
            // Extract metadata
            this.logger.info(`Extracting metadata from: ${tempFilePath}`);
            const metadata = await this.getVideoMetadata(tempFilePath);
            this.logger.info(`Metadata extracted successfully`);
            this.logger.debug(`Metadata details: ${JSON.stringify(metadata)}`);

            // Skip thumbnail generation
            this.logger.info(`Skipping thumbnail generation`, { phase: ConversionStatus.STATUS.PROCESSING });
            this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.PROCESSING, progress: 10 });
            const thumbnails = []; // Empty array instead of generating thumbnails

            // Extract audio for transcription
            this.logger.logPhaseTransition(ConversionStatus.STATUS.PROCESSING, ConversionStatus.STATUS.EXTRACTING_AUDIO);
            this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.EXTRACTING_AUDIO, progress: 30 });
            
            const audioPath = path.join(tempDir, 'audio.mp3');
            this.logger.info(`Extracting audio to: ${audioPath}`);
            await this.extractAudio(tempFilePath, audioPath);
            this.logger.info(`Audio extracted successfully`);

            // Transcribe audio if requested
            let transcription = null;
            if (options.transcribe !== false) {
                this.logger.logPhaseTransition(ConversionStatus.STATUS.EXTRACTING_AUDIO, ConversionStatus.STATUS.TRANSCRIBING);
                this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.TRANSCRIBING, progress: 40 });
                
                this.logger.info(`Transcribing audio with language: ${options.language || 'en'}`);
                transcription = await this.transcribeAudio(audioPath, options.language || 'en');
                
                if (!transcription || !transcription.text || transcription.text.trim() === '') {
                    this.logger.logPhaseTransition(ConversionStatus.STATUS.TRANSCRIBING, ConversionStatus.STATUS.CONTENT_EMPTY);
                    this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.CONTENT_EMPTY, progress: 80 });
                    this.logger.info(`Transcription produced empty content - this is normal for videos without speech`);
                } else {
                    this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.TRANSCRIBING, progress: 80 });
                    this.logger.info(`Transcription completed successfully (${transcription.text.length} characters)`);
                }
            }

            this.logger.logPhaseTransition(
                transcription ? ConversionStatus.STATUS.TRANSCRIBING : ConversionStatus.STATUS.EXTRACTING_AUDIO, 
                ConversionStatus.STATUS.PROCESSING
            );
            this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.PROCESSING, progress: 90 });
            this.logger.info(`Generating markdown output`);

            // Generate markdown
            const markdown = this.generateMarkdown(metadata, thumbnails, transcription, options);
            this.logger.info(`Markdown generated successfully (${markdown.length} characters)`);

            // Update registry with completed status and result
            this.logger.logPhaseTransition(ConversionStatus.STATUS.PROCESSING, ConversionStatus.STATUS.COMPLETED);
            this.registry.pingConversion(conversionId, {
                status: ConversionStatus.STATUS.COMPLETED,
                progress: 100,
                result: markdown
            });

            this.logger.logConversionComplete(fileType);

            // Cleanup is handled by the registry's removeConversion call eventually

            return markdown; // Return the result
        } catch (error) {
            this.logger.logConversionError(fileType, error);
            // Update registry with failed status
            this.registry.pingConversion(conversionId, { status: ConversionStatus.STATUS.ERROR, error: error.message });
            // Let the error propagate to be caught by the caller in handleConvert
            throw error;
        }
    }

    /**
     * Get video file metadata
     * @param {string} filePath - Path to video file
     * @returns {Promise<Object>} Video metadata
     */
    async getVideoMetadata(filePath) {
        const fileType = path.extname(filePath).substring(1);
        this.logger.setContext({ fileType, phase: ConversionStatus.STATUS.VALIDATING });
        
        return new Promise((resolve, reject) => {
            // Ensure we have the latest ffmpeg path before running ffprobe
            const ffprobePath = BinaryPathResolver.resolveBinaryPath('ffprobe', { forceRefresh: false });
            if (!ffprobePath) {
                const error = new Error('FFprobe binary not available. Cannot extract video metadata.');
                this.logger.error(error.message);
                return reject(error);
            }
            
            this.logger.info(`Getting video metadata using ffprobe at: ${ffprobePath}`);
            
            // Create a new ffmpeg command with the correct path to ensure we're not using cached paths
            const command = ffmpeg();
            command.setFfprobePath(ffprobePath);
            
            command.input(filePath).ffprobe((err, metadata) => {
                if (err) {
                    this.logger.error(`Error getting metadata: ${err.message}`);
                    reject(err);
                    return;
                }
                
                const videoStream = metadata.streams.find(s => s.codec_type === 'video');
                const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
                
                if (!videoStream) {
                    const error = new Error('No video stream found');
                    this.logger.error(error.message);
                    reject(error);
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
                this.logger.error(error.message);
                return reject(error);
            }
            
            this.logger.info(`Extracting audio using ffmpeg at: ${ffmpegPath}`);
            
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
                    this.logger.info(`Audio extraction completed successfully`);
                    resolve();
                })
                .on('error', (err) => {
                    this.logger.error(`Audio extraction error: ${err.message}`);
                    reject(err);
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
            this.logger.info(`Starting transcription of audio file: ${audioPath}`);
            const result = await this.transcriber.handleTranscribeStart(null, {
                filePath: audioPath,
                options: { language }
            });
            
            // Wait for transcription to complete
            this.logger.info(`Transcription job started with ID: ${result.jobId}`);
            let status = await this.transcriber.handleTranscribeStatus(null, { jobId: result.jobId });
            
            while (status.status !== 'completed' && status.status !== 'failed' && status.status !== 'cancelled') {
                // Wait a bit before checking again
                this.logger.debug(`Transcription in progress, status: ${status.status}, progress: ${status.progress || 'unknown'}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                status = await this.transcriber.handleTranscribeStatus(null, { jobId: result.jobId });
            }
            
            if (status.status === 'failed') {
                const error = new Error(status.error || 'Transcription failed');
                this.logger.error(`Transcription failed: ${error.message}`);
                throw error;
            }
            
            if (status.status === 'cancelled') {
                const error = new Error('Transcription cancelled');
                this.logger.warn(`Transcription cancelled`);
                throw error;
            }
            
            if (!status.result || !status.result.text || status.result.text.trim() === '') {
                this.logger.info(`Transcription completed but content is empty - this is normal for videos without speech`, 
                    { phase: ConversionStatus.STATUS.CONTENT_EMPTY });
            } else {
                this.logger.info(`Transcription completed successfully with ${status.result.text.length} characters`);
            }
            
            return status.result;
        } catch (error) {
            this.logger.error(`Transcription failed: ${error.message}`);
            throw error;
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
        this.logger.info(`Generating markdown content`, { phase: ConversionStatus.STATUS.PROCESSING });
        
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
