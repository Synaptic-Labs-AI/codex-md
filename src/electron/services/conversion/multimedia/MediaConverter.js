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

// Utility to sanitize objects for logging, especially to handle Buffers
// Copied from DeepgramService.js for consistency, or could be moved to a shared util
function sanitizeForLogging(obj, visited = new Set()) {
  if (obj === null || typeof obj !== 'object' || visited.has(obj)) {
    return obj;
  }

  visited.add(obj);

  if (Buffer.isBuffer(obj)) {
    return `[Buffer length: ${obj.length}]`;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForLogging(item, new Set(visited)));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeForLogging(value, new Set(visited));
  }
  
  visited.delete(obj);
  return sanitized;
}

class MediaConverter extends BaseService {
    constructor(registry, fileProcessor, fileStorage) {
        super();
        this.registry = registry;
        this.fileProcessor = fileProcessor;
        this.fileStorage = fileStorage;
        // It's better to use the TranscriptionService which abstracts Deepgram
        this.transcriptionService = require('../../TranscriptionService'); 
        
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
        const conversionId = this.generateConversionId();
        // filePath here is the path to the temporary file created by the adapter, or the original user file path if not from buffer.
        const originalFileNameForLog = options.originalFileName || path.basename(filePath);
        console.log(`[MediaConverter:HANDLE_CONVERT_START][convId:${conversionId}] Starting media conversion for: ${originalFileNameForLog} (input path: ${filePath})`);
        // Don't log the full options object as it might contain large buffers
        // Create a clean object without spreading to avoid copying buffer data
        const safeOptionsForLogging = {
            originalFileName: options.originalFileName,
            isTempInputFile: options.isTempInputFile,
            deepgramApiKey: options.deepgramApiKey ? '[API Key Hidden]' : undefined,
            language: options.language,
            punctuate: options.punctuate,
            smart_format: options.smart_format,
            diarize: options.diarize,
            utterances: options.utterances,
            model: options.model,
            // Explicitly exclude any buffer-like properties
            content: options.content ? '[Buffer excluded from logs]' : undefined,
            buffer: options.buffer ? '[Buffer excluded from logs]' : undefined,
            // Add any other safe properties you want to log
        };
        console.log(`[MediaConverter:HANDLE_CONVERT_START][convId:${conversionId}] Options:`, safeOptionsForLogging);
        
        // The directory containing the filePath will be managed for cleanup.
        // If filePath is a direct user file, its directory should NOT be deleted.
        // The adapter should indicate if filePath is a temporary file it created.
        // Let's assume options.isTempInputFile indicates this.
        const tempDirForCleanup = options.isTempInputFile ? path.dirname(filePath) : null;
        if (options.isTempInputFile) {
            console.log(`[MediaConverter:TEMP_INPUT][convId:${conversionId}] Input file ${filePath} is temporary and its directory ${tempDirForCleanup} will be cleaned up.`);
        }


        try {
            const window = event?.sender?.getOwnerBrowserWindow?.() || null;
            
            // No longer creating a new tempDir here; will use the directory of filePath if it's a temp file.
            // Or, if we need isolated processing space, create one and copy filePath into it.
            // For now, let's assume filePath can be processed in place, and its dir cleaned if temp.

            this.registry.registerConversion(conversionId, {
                id: conversionId,
                status: 'starting',
                progress: 0,
                filePath: filePath, // Path to the actual media file to process
                tempDir: tempDirForCleanup, // Directory to clean up if input was temporary
                window,
                startTime: Date.now(),
                originalFileName: options.originalFileName || path.basename(filePath) // Use original name from options if available
            });

            if (window && window.webContents) {
                window.webContents.send('media:conversion-started', { conversionId, originalFileName: options.originalFileName || path.basename(filePath) });
            }

            // Asynchronously process the conversion
            this.processConversion(conversionId, filePath, options).catch(async error => { // Make catch async for cleanup
                const errorMessage = error.message || 'Unknown media conversion processing error';
                console.error(`[MediaConverter:PROCESS_CONVERSION_ERROR][convId:${conversionId}] Overall conversion failed for ${originalFileNameForLog}:`, sanitizeForLogging(error));
                this.registry.pingConversion(conversionId, { 
                    status: 'failed', 
                    error: errorMessage,
                    progress: 100 // Mark as complete for UI handling, but with error
                });
                // Attempt cleanup even on error
                if (tempDirForCleanup) {
                    try {
                        console.log(`[MediaConverter:CLEANUP_ON_ERROR][convId:${conversionId}] Cleaning up temp directory: ${tempDirForCleanup}`);
                        await fs.remove(tempDirForCleanup);
                    } catch (cleanupErr) {
                        console.error(`[MediaConverter:CLEANUP_ON_ERROR_FAILED][convId:${conversionId}] Failed to clean up temp directory ${tempDirForCleanup}:`, sanitizeForLogging(cleanupErr));
                    }
                }
            });

            return { conversionId, originalFileName: options.originalFileName || path.basename(filePath) };
        } catch (error) {
            const errorMessage = error.message || 'Failed to start media conversion';
            console.error(`[MediaConverter:HANDLE_CONVERT_ERROR][convId:${conversionId}] Error for ${originalFileNameForLog}:`, sanitizeForLogging(error));
            // If registration happened, update it to failed.
            if (this.registry.getConversion(conversionId)) {
                 this.registry.pingConversion(conversionId, { status: 'failed', error: errorMessage, progress: 100});
            }
            // Attempt cleanup if tempDirForCleanup was determined
            if (tempDirForCleanup) {
                try {
                    console.log(`[MediaConverter:CLEANUP_ON_START_ERROR][convId:${conversionId}] Cleaning up temp directory: ${tempDirForCleanup}`);
                    await fs.remove(tempDirForCleanup);
                } catch (cleanupErr) {
                    console.error(`[MediaConverter:CLEANUP_ON_START_ERROR_FAILED][convId:${conversionId}] Failed to clean up temp directory ${tempDirForCleanup}:`, sanitizeForLogging(cleanupErr));
                }
            }
            throw new Error(errorMessage); // Re-throw for IPC to catch if needed
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
        const originalFileName = options.originalFileName || path.basename(filePath);
        console.log(`[MediaConverter:PROCESS_CONVERSION_START][convId:${conversionId}] Processing media file: ${originalFileName} (from path: ${filePath})`);
        
        const jobData = this.registry.getConversion(conversionId);
        const tempDirToCleanup = jobData ? jobData.tempDir : null; // This is path.dirname(filePath) if temp

        try {
            const fileType = this.getFileType(filePath);
            
            this.registry.pingConversion(conversionId, { 
                status: 'validating', 
                progress: 5,
                fileType: fileType.type,
                message: 'Validating file...'
            });
            
            const stats = await fs.stat(filePath); // filePath is the actual file to process
            const metadata = {
                filename: originalFileName, // Use the original filename for metadata
                fileType: fileType.type,
                size: stats.size,
                isAudio: fileType.isAudio,
                isVideo: fileType.isVideo
            };
            console.log(`[MediaConverter:VALIDATED][convId:${conversionId}] File validated. Metadata:`, sanitizeForLogging(metadata));
            
            this.registry.pingConversion(conversionId, { status: 'transcribing', progress: 30, message: 'Starting transcription...' });
            
            let deepgramApiKey = options.deepgramApiKey; // API key from options takes precedence
            if (!deepgramApiKey) {
                const apiKeyService = require('../../ApiKeyService');
                deepgramApiKey = apiKeyService.getApiKey('deepgram');
                if (deepgramApiKey) {
                    console.log(`[MediaConverter:API_KEY_FOUND][convId:${conversionId}] Deepgram API key found via ApiKeyService.`);
                } else {
                     console.warn(`[MediaConverter:API_KEY_WARN][convId:${conversionId}] Deepgram API key not provided in options, attempting to find in settings store.`);
                    try {
                        deepgramApiKey = settingsStore.get('deepgramApiKey') || 
                                         settingsStore.get('transcription.deepgramApiKey');
                        if (deepgramApiKey) {
                             console.log(`[MediaConverter:API_KEY_FOUND][convId:${conversionId}] Deepgram API key found in settings store.`);
                        }
                    } catch (err) {
                        console.warn('[MediaConverter:API_KEY_STORE_ERROR][convId:${conversionId}] Error accessing settings store for API key:', sanitizeForLogging(err));
                    }
                }
            } else {
                 console.log(`[MediaConverter:API_KEY_PROVIDED][convId:${conversionId}] Deepgram API key provided in options.`);
            }

            if (!deepgramApiKey) {
                console.error(`[MediaConverter:NO_API_KEY][convId:${conversionId}] No Deepgram API key found. Aborting transcription.`);
                throw new Error('Deepgram API key not found. Please configure it in Settings > Transcription.');
            }
            
            console.log(`[MediaConverter:TRANSCRIPTION_START][convId:${conversionId}] Initiating transcription for ${originalFileName}`);
            
            // Use TranscriptionService for transcription, filePath is the actual media data
            const transcriptionText = await this.transcriptionService.transcribeAudio(filePath, deepgramApiKey, {
                language: options.language, // Pass relevant options
                punctuate: options.punctuate,
                smart_format: options.smart_format,
                diarize: options.diarize,
                utterances: options.utterances,
                deepgramOptions: options.deepgramOptions, // Pass through any specific DG options
                model: options.model // Allow model override from options
            });
            
            // TranscriptionService now throws on empty/failed result, so this check might be redundant but safe.
            if (!transcriptionText || transcriptionText.trim() === '') {
                console.error(`[MediaConverter:EMPTY_TRANSCRIPTION][convId:${conversionId}] Transcription completed but returned no text content.`);
                throw new Error('Transcription produced no text content.');
            }
            console.log(`[MediaConverter:TRANSCRIPTION_SUCCESS][convId:${conversionId}] Transcription successful. Text length: ${transcriptionText.length}`);
            
            // Construct a result object similar to what DeepgramService's formatTranscriptionResult would produce
            const transcriptionResult = {
                text: transcriptionText,
                // We might not have detailed duration/model from TranscriptionService directly here,
                // but we can pass what we know or enhance TranscriptionService to return more details.
                model: options.model || settingsStore.get('transcription.model', 'nova-2'),
                language: options.language || 'en',
                // duration: "Unknown" // Or get from metadata if possible
            };
            
            this.registry.pingConversion(conversionId, { status: 'generating_markdown', progress: 90, message: 'Generating Markdown...' });
            const markdown = this.generateMarkdown(metadata, transcriptionResult, options);
            console.log(`[MediaConverter:MARKDOWN_GENERATED][convId:${conversionId}] Markdown generated.`);
            
            this.registry.pingConversion(conversionId, { 
                status: 'completed', 
                progress: 100,
                result: markdown,
                transcribed: true,
                originalFileName: metadata.filename,
                message: 'Conversion complete!'
            });
            
            return markdown;
        } catch (error) {
            const errorMessage = error.message || 'Unknown media conversion error';
            console.error(`[MediaConverter:PROCESS_CONVERSION_FAILED][convId:${conversionId}] Error for ${originalFileName}:`, sanitizeForLogging(error));
            
            this.registry.pingConversion(conversionId, { 
                status: 'failed', 
                error: errorMessage,
                progress: 100, // Mark as complete for UI handling
                originalFileName: originalFileName, // Keep originalFileName in the status update
                message: `Conversion failed: ${errorMessage}`
            });
            
            // Re-throw the error to prevent creating a placeholder note
            // This will be caught by the handleConvert method and properly handled
            throw error;
        } finally {
            // Cleanup the temporary directory if one was specified for cleanup
            if (tempDirToCleanup) {
                try {
                    console.log(`[MediaConverter:CLEANUP_FINALLY][convId:${conversionId}] Cleaning up temp directory: ${tempDirToCleanup}`);
                    await fs.remove(tempDirToCleanup);
                    console.log(`[MediaConverter:CLEANUP_FINALLY_SUCCESS][convId:${conversionId}] Temp directory ${tempDirToCleanup} removed.`);
                } catch (cleanupErr) {
                    console.error(`[MediaConverter:CLEANUP_FINALLY_FAILED][convId:${conversionId}] Failed to clean up temp directory ${tempDirToCleanup}:`, sanitizeForLogging(cleanupErr));
                }
            } else {
                console.log(`[MediaConverter:NO_CLEANUP_NEEDED][convId:${conversionId}] No temporary input directory was specified for cleanup.`);
            }
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

        // Add transcription section
        markdown.push('## Transcription');
        markdown.push('');
        
        // Add transcription text
        markdown.push(transcription.text);

        // Add transcription metadata if available
        if (transcription.model || transcription.duration) {
            markdown.push('');
            markdown.push('### Transcription Details');
            markdown.push('');
            markdown.push('| Property | Value |');
            markdown.push('| --- | --- |');
            if (transcription.model) {
                markdown.push(`| Model | ${transcription.model} |`);
            }
            if (transcription.duration) {
                const duration = typeof transcription.duration === 'number'
                    ? this.formatDuration(transcription.duration)
                    : transcription.duration;
                markdown.push(`| Duration | ${duration} |`);
            }
            if (transcription.language) {
                markdown.push(`| Language | ${transcription.language} |`);
            }
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
     * Format duration in seconds to a human-readable format
     * @param {number} seconds - Duration in seconds
     * @returns {string} Formatted duration
     */
    formatDuration(seconds) {
        if (!seconds || typeof seconds !== 'number') {
            return 'Unknown';
        }

        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);

        if (minutes === 0) {
            return `${remainingSeconds} sec`;
        }

        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
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
