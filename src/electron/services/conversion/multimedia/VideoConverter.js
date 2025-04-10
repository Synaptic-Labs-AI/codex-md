/**
 * VideoConverter.js
 * Handles conversion of video files to markdown format in the Electron main process.
 * 
 * This converter:
 * - Processes video files using fluent-ffmpeg
 * - Extracts metadata (duration, resolution, etc.)
 * - Generates thumbnails at specified intervals
 * - Extracts audio for transcription
 * - Integrates with TranscriberService for audio transcription
 * - Generates markdown with video information, thumbnails, and transcription
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - FileProcessorService.js: Used for file operations
 * - TranscriberService.js: Used for audio transcription
 * - FileStorageService.js: For temporary file management
 */

const path = require('path');
const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');
const BaseService = require('../../BaseService');

class VideoConverter extends BaseService {
    constructor(fileProcessor, transcriber, fileStorage) {
        super();
        this.fileProcessor = fileProcessor;
        this.transcriber = transcriber;
        this.fileStorage = fileStorage;
        this.supportedExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'];
        this.activeConversions = new Map();
    }

    /**
     * Set up IPC handlers for video conversion
     */
    setupIpcHandlers() {
        this.registerHandler('convert:video', this.handleConvert.bind(this));
        this.registerHandler('convert:video:metadata', this.handleGetMetadata.bind(this));
        this.registerHandler('convert:video:thumbnail', this.handleGenerateThumbnail.bind(this));
        this.registerHandler('convert:video:cancel', this.handleCancel.bind(this));
    }

    /**
     * Handle video conversion request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Conversion request details
     */
    async handleConvert(event, { filePath, options = {} }) {
        try {
            const conversionId = this.generateConversionId();
            const window = event.sender.getOwnerBrowserWindow();
            
            // Create temp directory for this conversion
            const tempDir = await this.fileStorage.createTempDir('video_conversion');
            
            this.activeConversions.set(conversionId, {
                id: conversionId,
                status: 'starting',
                progress: 0,
                filePath,
                tempDir,
                window
            });

            // Notify client that conversion has started
            window.webContents.send('video:conversion-started', { conversionId });

            // Start conversion process
            this.processConversion(conversionId, filePath, options).catch(error => {
                console.error(`[VideoConverter] Conversion failed for ${conversionId}:`, error);
                this.updateConversionStatus(conversionId, 'failed', { error: error.message });
                
                // Clean up temp directory
                fs.remove(tempDir).catch(err => {
                    console.error(`[VideoConverter] Failed to clean up temp directory: ${tempDir}`, err);
                });
            });

            return { conversionId };
        } catch (error) {
            console.error('[VideoConverter] Failed to start conversion:', error);
            throw error;
        }
    }

    /**
     * Handle video metadata request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Metadata request details
     */
    async handleGetMetadata(event, { filePath }) {
        try {
            const metadata = await this.getVideoMetadata(filePath);
            return metadata;
        } catch (error) {
            console.error('[VideoConverter] Failed to get metadata:', error);
            throw error;
        }
    }

    /**
     * Handle thumbnail generation request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Thumbnail request details
     */
    async handleGenerateThumbnail(event, { filePath, timeOffset = 0, options = {} }) {
        try {
            const tempDir = await this.fileStorage.createTempDir('thumbnail');
            const thumbnailPath = path.join(tempDir, 'thumbnail.jpg');
            
            await this.generateThumbnail(filePath, thumbnailPath, timeOffset, options);
            
            // Read the thumbnail as base64
            const thumbnailData = await fs.readFile(thumbnailPath, { encoding: 'base64' });
            
            // Clean up temp directory
            await fs.remove(tempDir);
            
            return {
                data: `data:image/jpeg;base64,${thumbnailData}`,
                timeOffset
            };
        } catch (error) {
            console.error('[VideoConverter] Failed to generate thumbnail:', error);
            throw error;
        }
    }

    /**
     * Handle conversion cancellation request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Cancellation request details
     */
    async handleCancel(event, { conversionId }) {
        const conversion = this.activeConversions.get(conversionId);
        if (conversion) {
            conversion.status = 'cancelled';
            
            if (conversion.window) {
                conversion.window.webContents.send('video:conversion-cancelled', { conversionId });
            }
            
            // Clean up temp directory
            if (conversion.tempDir) {
                await fs.remove(conversion.tempDir);
            }
            
            this.activeConversions.delete(conversionId);
        }
        return { success: true };
    }

    /**
     * Process video conversion
     * @param {string} conversionId - Conversion identifier
     * @param {string} filePath - Path to video file
     * @param {Object} options - Conversion options
     */
    async processConversion(conversionId, filePath, options) {
        try {
            const conversion = this.activeConversions.get(conversionId);
            if (!conversion) {
                throw new Error('Conversion not found');
            }
            
            const tempDir = conversion.tempDir;
            
            this.updateConversionStatus(conversionId, 'extracting_metadata');
            const metadata = await this.getVideoMetadata(filePath);
            
            // Generate thumbnails
            this.updateConversionStatus(conversionId, 'generating_thumbnails', { progress: 10 });
            const thumbnailCount = options.thumbnailCount || 3;
            const thumbnails = await this.generateThumbnails(filePath, tempDir, thumbnailCount);
            
            // Extract audio for transcription
            this.updateConversionStatus(conversionId, 'extracting_audio', { progress: 30 });
            const audioPath = path.join(tempDir, 'audio.mp3');
            await this.extractAudio(filePath, audioPath);
            
            // Transcribe audio if requested
            let transcription = null;
            if (options.transcribe !== false) {
                this.updateConversionStatus(conversionId, 'transcribing', { progress: 40 });
                transcription = await this.transcribeAudio(audioPath, options.language || 'en');
                this.updateConversionStatus(conversionId, 'transcribing', { progress: 80 });
            }
            
            this.updateConversionStatus(conversionId, 'generating_markdown', { progress: 90 });
            
            // Generate markdown
            const markdown = this.generateMarkdown(metadata, thumbnails, transcription, options);
            
            // Clean up temp directory
            await fs.remove(tempDir);
            
            this.updateConversionStatus(conversionId, 'completed', { 
                progress: 100,
                result: markdown
            });
            
            return markdown;
        } catch (error) {
            console.error('[VideoConverter] Conversion processing failed:', error);
            throw error;
        }
    }

    /**
     * Get video file metadata
     * @param {string} filePath - Path to video file
     * @returns {Promise<Object>} Video metadata
     */
    async getVideoMetadata(filePath) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const videoStream = metadata.streams.find(s => s.codec_type === 'video');
                const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
                
                if (!videoStream) {
                    reject(new Error('No video stream found'));
                    return;
                }
                
                resolve({
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
                });
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
     * Generate thumbnails at regular intervals
     * @param {string} filePath - Path to video file
     * @param {string} outputDir - Output directory
     * @param {number} count - Number of thumbnails to generate
     * @returns {Promise<Array>} Array of thumbnail info objects
     */
    async generateThumbnails(filePath, outputDir, count) {
        try {
            const metadata = await this.getVideoMetadata(filePath);
            const duration = metadata.duration;
            
            // Calculate time offsets for thumbnails
            const interval = duration / (count + 1);
            const timeOffsets = Array.from({ length: count }, (_, i) => (i + 1) * interval);
            
            // Generate thumbnails
            const thumbnails = [];
            for (let i = 0; i < timeOffsets.length; i++) {
                const timeOffset = timeOffsets[i];
                const thumbnailPath = path.join(outputDir, `thumbnail_${i}.jpg`);
                
                await this.generateThumbnail(filePath, thumbnailPath, timeOffset);
                
                // Read the thumbnail as base64
                const thumbnailData = await fs.readFile(thumbnailPath, { encoding: 'base64' });
                
                thumbnails.push({
                    index: i,
                    timeOffset,
                    formattedTime: this.formatDuration(timeOffset),
                    data: `data:image/jpeg;base64,${thumbnailData}`
                });
            }
            
            return thumbnails;
        } catch (error) {
            console.error('[VideoConverter] Failed to generate thumbnails:', error);
            throw error;
        }
    }

    /**
     * Generate a single thumbnail
     * @param {string} filePath - Path to video file
     * @param {string} outputPath - Output path for thumbnail
     * @param {number} timeOffset - Time offset in seconds
     * @param {Object} options - Thumbnail options
     * @returns {Promise<void>}
     */
    async generateThumbnail(filePath, outputPath, timeOffset, options = {}) {
        return new Promise((resolve, reject) => {
            const width = options.width || 320;
            const height = options.height || 180;
            
            ffmpeg(filePath)
                .screenshots({
                    timestamps: [timeOffset],
                    filename: path.basename(outputPath),
                    folder: path.dirname(outputPath),
                    size: `${width}x${height}`
                })
                .on('end', () => resolve())
                .on('error', err => reject(err));
        });
    }

    /**
     * Extract audio from video file
     * @param {string} videoPath - Path to video file
     * @param {string} outputPath - Output path for audio
     * @returns {Promise<void>}
     */
    async extractAudio(videoPath, outputPath) {
        return new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .output(outputPath)
                .noVideo()
                .audioCodec('libmp3lame')
                .audioBitrate(128)
                .on('end', () => resolve())
                .on('error', err => reject(err))
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
        try {
            // Use the TranscriberService to transcribe the audio
            const result = await this.transcriber.handleTranscribeStart(null, {
                filePath: audioPath,
                options: { language }
            });
            
            // Wait for transcription to complete
            let status = await this.transcriber.handleTranscribeStatus(null, { jobId: result.jobId });
            
            while (status.status !== 'completed' && status.status !== 'failed' && status.status !== 'cancelled') {
                // Wait a bit before checking again
                await new Promise(resolve => setTimeout(resolve, 1000));
                status = await this.transcriber.handleTranscribeStatus(null, { jobId: result.jobId });
            }
            
            if (status.status === 'failed') {
                throw new Error(status.error || 'Transcription failed');
            }
            
            if (status.status === 'cancelled') {
                throw new Error('Transcription cancelled');
            }
            
            return status.result;
        } catch (error) {
            console.error('[VideoConverter] Transcription failed:', error);
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
        
        // Add thumbnails
        if (thumbnails && thumbnails.length > 0) {
            markdown.push('## Thumbnails');
            markdown.push('');
            
            for (const thumbnail of thumbnails) {
                markdown.push(`### ${this.formatDuration(thumbnail.timeOffset)}`);
                markdown.push('');
                markdown.push(`![Thumbnail at ${thumbnail.formattedTime}](${thumbnail.data})`);
                markdown.push('');
            }
        }
        
        // Add transcription if available
        if (transcription) {
            markdown.push('## Transcription');
            markdown.push('');
            markdown.push(transcription.text);
        }
        
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
     * Update conversion status and notify renderer
     * @param {string} conversionId - Conversion identifier
     * @param {string} status - New status
     * @param {Object} details - Additional details
     */
    updateConversionStatus(conversionId, status, details = {}) {
        const conversion = this.activeConversions.get(conversionId);
        if (conversion) {
            conversion.status = status;
            Object.assign(conversion, details);
            
            if (conversion.window) {
                conversion.window.webContents.send('video:conversion-progress', {
                    conversionId,
                    status,
                    ...details
                });
            }
            
            // Clean up completed or failed conversions
            if (status === 'completed' || status === 'failed') {
                setTimeout(() => {
                    this.activeConversions.delete(conversionId);
                }, 5 * 60 * 1000); // Keep for 5 minutes for status queries
            }
        }
    }

    /**
     * Generate unique conversion identifier
     * @returns {string} Unique conversion ID
     */
    generateConversionId() {
        return `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
            description: 'Converts video files to markdown with thumbnails and transcription',
            options: {
                transcribe: 'Whether to transcribe audio (default: true)',
                language: 'Transcription language (default: en)',
                thumbnailCount: 'Number of thumbnails to generate (default: 3)',
                title: 'Optional document title'
            }
        };
    }
}

module.exports = VideoConverter;
