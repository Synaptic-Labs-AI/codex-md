/**
 * AudioConverter.js
 * Handles conversion of audio files to markdown format in the Electron main process.
 * 
 * This converter:
 * - Processes audio files using fluent-ffmpeg
 * - Extracts metadata (duration, bitrate, etc.)
 * - Integrates with TranscriberService for transcription
 * - Generates markdown with audio information and transcription
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
const ffprobeStatic = require('ffprobe-static');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg'); // Import ffmpeg installer
const { app } = require('electron');
const BaseService = require('../../BaseService');

class AudioConverter extends BaseService {
    constructor(fileProcessor, transcriber, fileStorage) {
        super();
        this.fileProcessor = fileProcessor;
        this.transcriber = transcriber;
        this.fileStorage = fileStorage;
        this.supportedExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
        this.activeConversions = new Map();
        
        // Configure ffmpeg to use the correct ffprobe path
        this.configureFfmpeg();
    }
    
    /**
     * Configure ffmpeg with the correct ffprobe and ffmpeg paths
     */
    configureFfmpeg() {
        try {
            // Default paths from static packages
            let ffprobePath = ffprobeStatic.path;
            let ffmpegPath = ffmpegInstaller.path;

            // In production, use the paths from the resources directory
            if (app && app.isPackaged) {
                // Check for ffprobe.exe in resources
                const ffprobeResourcesPath = path.join(process.resourcesPath, 'ffprobe.exe');
                if (fs.existsSync(ffprobeResourcesPath)) {
                    ffprobePath = ffprobeResourcesPath;
                    console.log(`[AudioConverter] Using ffprobe from resources: ${ffprobePath}`);
                } else {
                    console.warn(`[AudioConverter] ffprobe.exe not found in resources, falling back to default path: ${ffprobePath}`);
                }

                // Check for ffmpeg.exe in resources
                const ffmpegResourcesPath = path.join(process.resourcesPath, 'ffmpeg.exe');
                if (fs.existsSync(ffmpegResourcesPath)) {
                    ffmpegPath = ffmpegResourcesPath;
                    console.log(`[AudioConverter] Using ffmpeg from resources: ${ffmpegPath}`);
                } else {
                    console.warn(`[AudioConverter] ffmpeg.exe not found in resources, falling back to default path: ${ffmpegPath}`);
                }
            } else {
                console.log(`[AudioConverter] Using default ffprobe path: ${ffprobePath}`);
                console.log(`[AudioConverter] Using default ffmpeg path: ${ffmpegPath}`);
            }

            // Set the paths for fluent-ffmpeg
            ffmpeg.setFfprobePath(ffprobePath);
            ffmpeg.setFfmpegPath(ffmpegPath);
            console.log(`[AudioConverter] ffprobe path set to: ${ffprobePath}`);
            console.log(`[AudioConverter] ffmpeg path set to: ${ffmpegPath}`);
        } catch (error) {
            console.error('[AudioConverter] Error configuring ffmpeg:', error);
        }
    }

    /**
     * Set up IPC handlers for audio conversion
     */
    setupIpcHandlers() {
        this.registerHandler('convert:audio', this.handleConvert.bind(this));
        this.registerHandler('convert:audio:metadata', this.handleGetMetadata.bind(this));
        this.registerHandler('convert:audio:cancel', this.handleCancel.bind(this));
    }

    /**
     * Handle audio conversion request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Conversion request details
     */
    async handleConvert(event, { filePath, options = {} }) {
        try {
            const conversionId = this.generateConversionId();
            const window = event.sender.getOwnerBrowserWindow();
            
            this.activeConversions.set(conversionId, {
                id: conversionId,
                status: 'starting',
                progress: 0,
                filePath,
                window
            });

            // Notify client that conversion has started
            window.webContents.send('audio:conversion-started', { conversionId });

            // Start conversion process
            this.processConversion(conversionId, filePath, options).catch(error => {
                console.error(`[AudioConverter] Conversion failed for ${conversionId}:`, error);
                this.updateConversionStatus(conversionId, 'failed', { error: error.message });
            });

            return { conversionId };
        } catch (error) {
            console.error('[AudioConverter] Failed to start conversion:', error);
            throw error;
        }
    }

    /**
     * Handle audio metadata request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Metadata request details
     */
    async handleGetMetadata(event, { filePath }) {
        try {
            const metadata = await this.getAudioMetadata(filePath);
            return metadata;
        } catch (error) {
            console.error('[AudioConverter] Failed to get metadata:', error);
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
                conversion.window.webContents.send('audio:conversion-cancelled', { conversionId });
            }
            
            this.activeConversions.delete(conversionId);
        }
        return { success: true };
    }

    /**
     * Process audio conversion
     * @param {string} conversionId - Conversion identifier
     * @param {string} filePath - Path to audio file
     * @param {Object} options - Conversion options
     */
    async processConversion(conversionId, filePath, options) {
        try {
            this.updateConversionStatus(conversionId, 'extracting_metadata');
            const metadata = await this.getAudioMetadata(filePath);
            
            this.updateConversionStatus(conversionId, 'transcribing', { progress: 10 });
            
            // Transcribe audio if requested
            let transcription = null;
            if (options.transcribe !== false) {
                transcription = await this.transcribeAudio(filePath, options.language || 'en');
                this.updateConversionStatus(conversionId, 'transcribing', { progress: 90 });
            }
            
            this.updateConversionStatus(conversionId, 'generating_markdown', { progress: 95 });
            
            // Generate markdown
            const markdown = this.generateMarkdown(metadata, transcription, options);
            
            this.updateConversionStatus(conversionId, 'completed', { 
                progress: 100,
                result: markdown
            });
            
            return markdown;
        } catch (error) {
            console.error('[AudioConverter] Conversion processing failed:', error);
            throw error;
        }
    }

    /**
     * Get audio file metadata
     * @param {string} filePath - Path to audio file
     * @returns {Promise<Object>} Audio metadata
     */
    async getAudioMetadata(filePath) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
                if (!audioStream) {
                    reject(new Error('No audio stream found'));
                    return;
                }
                
                resolve({
                    format: metadata.format.format_name,
                    duration: metadata.format.duration,
                    size: metadata.format.size,
                    bitrate: metadata.format.bit_rate,
                    codec: audioStream.codec_name,
                    channels: audioStream.channels,
                    sampleRate: audioStream.sample_rate,
                    filename: path.basename(filePath)
                });
            });
        });
    }

    /**
     * Transcribe audio file
     * @param {string} filePath - Path to audio file
     * @param {string} language - Language code
     * @returns {Promise<Object>} Transcription result
     */
    async transcribeAudio(filePath, language) {
        try {
            // Use the TranscriberService to transcribe the audio
            const result = await this.transcriber.handleTranscribeStart(null, {
                filePath,
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
            console.error('[AudioConverter] Transcription failed:', error);
            throw error;
        }
    }

    /**
     * Generate markdown from audio metadata and transcription
     * @param {Object} metadata - Audio metadata
     * @param {Object} transcription - Transcription result
     * @param {Object} options - Conversion options
     * @returns {string} Markdown content
     */
    generateMarkdown(metadata, transcription, options) {
        const markdown = [];
        
        // Add title
        if (options.title) {
            markdown.push(`# ${options.title}`);
        } else {
            markdown.push(`# Audio: ${metadata.filename}`);
        }
        
        markdown.push('');
        
        // Add metadata
        markdown.push('## Audio Information');
        markdown.push('');
        markdown.push('| Property | Value |');
        markdown.push('| --- | --- |');
        markdown.push(`| Filename | ${metadata.filename} |`);
        markdown.push(`| Duration | ${this.formatDuration(metadata.duration)} |`);
        markdown.push(`| Format | ${metadata.format} |`);
        markdown.push(`| Codec | ${metadata.codec} |`);
        markdown.push(`| Channels | ${metadata.channels} |`);
        markdown.push(`| Sample Rate | ${metadata.sampleRate} Hz |`);
        markdown.push(`| Bitrate | ${Math.round(metadata.bitrate / 1000)} kbps |`);
        markdown.push(`| File Size | ${this.formatFileSize(metadata.size)} |`);
        
        markdown.push('');
        
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
                conversion.window.webContents.send('audio:conversion-progress', {
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
        return `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
            name: 'Audio Converter',
            extensions: this.supportedExtensions,
            description: 'Converts audio files to markdown with transcription',
            options: {
                transcribe: 'Whether to transcribe audio (default: true)',
                language: 'Transcription language (default: en)',
                title: 'Optional document title'
            }
        };
    }
}

module.exports = AudioConverter;
