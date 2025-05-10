/**
 * MediaConverter.js
 * Handles conversion of audio and video files to markdown format in the Electron main process.
 * 
 * This converter:
 * - Processes audio and video files using Deepgram API
 * - Extracts metadata (duration, type, etc.)
 * - Transcribes content using Deepgram
 * - Generates structured markdown output
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - DeepgramService.js: Used for audio/video transcription
 * - FileStorageService.js: For temporary file management
 */

const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const BaseService = require('../../BaseService');
const { createStore } = require('../../../utils/storeFactory');

// Settings store for transcription settings
const settingsStore = createStore('settings');

class MediaConverter extends BaseService {
    constructor(registry, fileProcessor, fileStorage) {
        super();
        this.registry = registry;
        this.fileProcessor = fileProcessor;
        this.fileStorage = fileStorage;
        this.deepgramService = require('../../ai/DeepgramService');
        
        // Supported file extensions
        this.supportedExtensions = [
            // Audio formats
            '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac',
            // Video formats
            '.mp4', '.mov', '.avi', '.mkv', '.webm'
        ];
        
        console.log('[MediaConverter] Initialized with support for:', this.supportedExtensions.join(', '));
    }

    /**
     * Set up IPC handlers for media conversion
     */
    setupIpcHandlers() {
        this.registerHandler('convert:media', this.handleConvert.bind(this));
        this.registerHandler('convert:media:metadata', this.handleGetMetadata.bind(this));
        this.registerHandler('convert:media:cancel', this.handleCancel.bind(this));
    }

    /**
     * Handle media conversion request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Conversion request details
     */
    async handleConvert(event, { filePath, options = {} }) {
        try {
            const conversionId = this.generateConversionId();
            const window = event.sender.getOwnerBrowserWindow();
            
            // Create a temp directory for processing
            const tempDir = await this.fileStorage.createTempDir('media_conversion');
            
            this.registry.registerConversion(conversionId, {
                id: conversionId,
                status: 'starting',
                progress: 0,
                filePath,
                tempDir,
                window,
                startTime: Date.now()
            });

            // Notify client that conversion has started
            window.webContents.send('media:conversion-started', { conversionId });

            // Start conversion process
            this.processConversion(conversionId, filePath, options).catch(error => {
                console.error(`[MediaConverter] Conversion failed for ${conversionId}:`, error);
                this.registry.pingConversion(conversionId, { 
                    status: 'failed', 
                    error: error.message 
                });
            });

            return { conversionId };
        } catch (error) {
            console.error('[MediaConverter] Failed to start conversion:', error);
            throw error;
        }
    }

    /**
     * Handle metadata request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Metadata request details
     */
    async handleGetMetadata(event, { filePath }) {
        try {
            console.log(`[MediaConverter] Getting metadata for: ${filePath}`);
            const fileType = this.getFileType(filePath);
            const stats = await fs.stat(filePath);
            
            // Simple metadata extraction without ffprobe
            const metadata = {
                format: fileType.type,
                duration: "Unknown", // We don't have ffprobe to get duration
                size: stats.size,
                filename: path.basename(filePath),
                isAudio: fileType.isAudio,
                isVideo: fileType.isVideo
            };
            
            return metadata;
        } catch (error) {
            console.error('[MediaConverter] Failed to get metadata:', error);
            throw error;
        }
    }

    /**
     * Handle conversion cancellation request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Cancellation request details
     */
    async handleCancel(event, { conversionId }) {
        return this.registry.removeConversion(conversionId);
    }

    /**
     * Process media conversion
     * @param {string} conversionId - Conversion identifier
     * @param {string} filePath - Path to media file
     * @param {Object} options - Conversion options
     */
    async processConversion(conversionId, filePath, options) {
        try {
            const fileType = this.getFileType(filePath);
            
            this.registry.pingConversion(conversionId, { 
                status: 'validating', 
                progress: 5,
                fileType: fileType.type
            });
            
            // Get basic file metadata
            const stats = await fs.stat(filePath);
            const metadata = {
                filename: path.basename(filePath),
                fileType: fileType.type,
                size: stats.size,
                isAudio: fileType.isAudio,
                isVideo: fileType.isVideo
            };
            
            // Transcribe using Deepgram
            this.registry.pingConversion(conversionId, { status: 'transcribing', progress: 30 });
            
            // Get transcription model from settings
            const model = settingsStore.get('transcription.model', 'nova-2');
            
            // Get transcription API key if not provided
            const deepgramApiKey = settingsStore.get('transcription.deepgramApiKey', '');
            if (!deepgramApiKey) {
                throw new Error('No Deepgram API key found. Please set one in Settings.');
            }
            
            // Start transcription job
            const transcriptionResult = await this.transcribeMedia(filePath, {
                model,
                deepgramApiKey,
                ...options
            });
            
            // Generate markdown
            this.registry.pingConversion(conversionId, { status: 'generating_markdown', progress: 90 });
            const markdown = this.generateMarkdown(metadata, transcriptionResult, options);
            
            // Complete conversion
            this.registry.pingConversion(conversionId, { 
                status: 'completed', 
                progress: 100,
                result: markdown 
            });
            
            return markdown;
        } catch (error) {
            console.error('[MediaConverter] Conversion processing failed:', error);
            throw error;
        }
    }
    
    /**
     * Transcribe media file using Deepgram
     * @param {string} filePath - Path to media file
     * @param {Object} options - Transcription options
     * @returns {Promise<Object>} Transcription result
     */
    async transcribeMedia(filePath, options = {}) {
        try {
            console.log(`[MediaConverter] Transcribing: ${filePath} with model: ${options.model}`);
            
            // Configure Deepgram with API key if provided
            if (options.deepgramApiKey) {
                await this.deepgramService.handleConfigure(null, { 
                    apiKey: options.deepgramApiKey 
                });
            }
            
            // Start transcription job
            const result = await this.deepgramService.handleTranscribeStart(null, {
                filePath,
                options: {
                    model: options.model || 'nova-2',
                    language: options.language || 'en'
                }
            });
            
            console.log(`[MediaConverter] Transcription job started: ${result.jobId}`);
            
            // Wait for transcription to complete
            let status = await this.deepgramService.handleTranscribeStatus(null, { 
                jobId: result.jobId 
            });
            
            // Poll for completion
            while (status.status !== 'completed' && status.status !== 'failed' && status.status !== 'cancelled') {
                await new Promise(resolve => setTimeout(resolve, 1000));
                status = await this.deepgramService.handleTranscribeStatus(null, { 
                    jobId: result.jobId 
                });
            }
            
            if (status.status === 'failed') {
                throw new Error(status.error || 'Transcription failed');
            }
            
            if (status.status === 'cancelled') {
                throw new Error('Transcription cancelled');
            }
            
            console.log(`[MediaConverter] Transcription completed successfully`);
            return status.result;
        } catch (error) {
            console.error('[MediaConverter] Transcription failed:', error);
            throw error;
        }
    }
    
    /**
     * Generate markdown from media metadata and transcription
     * @param {Object} metadata - Media metadata
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
            const mediaType = metadata.isVideo ? 'Video' : 'Audio';
            markdown.push(`# ${mediaType}: ${metadata.filename}`);
        }
        
        markdown.push('');
        
        // Add metadata
        markdown.push('## Media Information');
        markdown.push('');
        markdown.push('| Property | Value |');
        markdown.push('| --- | --- |');
        markdown.push(`| Filename | ${metadata.filename} |`);
        markdown.push(`| Type | ${metadata.isVideo ? 'Video' : 'Audio'} |`);
        markdown.push(`| Format | ${metadata.fileType} |`);
        markdown.push(`| File Size | ${this.formatFileSize(metadata.size)} |`);
        
        markdown.push('');
        
        // Add transcription if available
        if (transcription && transcription.text) {
            markdown.push('## Transcription');
            markdown.push('');
            markdown.push(transcription.text);
        } else {
            markdown.push('## Transcription');
            markdown.push('');
            markdown.push('*No transcription available for this media file.*');
        }
        
        return markdown.join('\n');
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
     * Get file type information from file path
     * @param {string} filePath - Path to file
     * @returns {Object} File type information
     */
    getFileType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        
        // Audio extensions
        const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
        
        // Video extensions
        const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
        
        return {
            extension: ext,
            type: ext.substring(1), // Remove the dot
            isAudio: audioExtensions.includes(ext),
            isVideo: videoExtensions.includes(ext)
        };
    }
    
    /**
     * Generate unique conversion identifier
     * @returns {string} Unique conversion ID
     */
    generateConversionId() {
        return `media_${Date.now()}_${uuidv4().substring(0, 8)}`;
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
            name: 'Media Converter',
            extensions: this.supportedExtensions,
            description: 'Converts audio and video files to markdown with transcription using Deepgram',
            options: {
                transcribe: 'Whether to transcribe media (default: true)',
                language: 'Transcription language (default: en)',
                title: 'Optional document title'
            }
        };
    }
}

module.exports = MediaConverter;