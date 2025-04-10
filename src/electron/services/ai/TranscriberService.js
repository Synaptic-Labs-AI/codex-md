/**
 * TranscriberService.js
 * Handles audio and video transcription in the Electron main process.
 * 
 * This service handles:
 * - Audio extraction from video files
 * - Audio file chunking for large files
 * - Transcription coordination with OpenAI
 * - Result aggregation and formatting
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - OpenAIProxyService.js: For OpenAI API interactions
 * - FileStorageService.js: For temporary file management
 * - JobManagerService.js: For tracking transcription jobs
 */

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { Buffer } = require('node:buffer');
const ffmpeg = require('fluent-ffmpeg');
const { uuid } = require('uuid');
const BaseService = require('../BaseService');

// Max chunk size for audio files (25MB - OpenAI limit is 26MB)
const MAX_CHUNK_SIZE = 25 * 1024 * 1024;

class TranscriberService extends BaseService {
    constructor(openAIProxy, fileStorage) {
        super();
        this.openAIProxy = openAIProxy;
        this.fileStorage = fileStorage;
        this.activeJobs = new Map();
    }

    /**
     * Set up IPC handlers for transcription operations
     */
    setupIpcHandlers() {
        this.registerHandler('transcribe:start', this.handleTranscribeStart.bind(this));
        this.registerHandler('transcribe:status', this.handleTranscribeStatus.bind(this));
        this.registerHandler('transcribe:cancel', this.handleTranscribeCancel.bind(this));
    }

    /**
     * Handle transcription start request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Transcription request details
     */
    async handleTranscribeStart(event, { filePath, options = {} }) {
        try {
            const jobId = uuid();
            const tempDir = await this.fileStorage.createTempDir('transcription');
            
            this.activeJobs.set(jobId, {
                status: 'preparing',
                progress: 0,
                filePath,
                tempDir,
                window: event.sender.getOwnerBrowserWindow()
            });

            // Start transcription process
            this.processTranscription(jobId, filePath, options).catch(error => {
                console.error(`[TranscriberService] Transcription failed for job ${jobId}:`, error);
                this.updateJobStatus(jobId, 'failed', { error: error.message });
            });

            return { jobId };
        } catch (error) {
            console.error('[TranscriberService] Failed to start transcription:', error);
            throw error;
        }
    }

    /**
     * Handle transcription status request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Status request details
     */
    async handleTranscribeStatus(event, { jobId }) {
        const job = this.activeJobs.get(jobId);
        return job || { status: 'not_found' };
    }

    /**
     * Handle transcription cancellation request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Cancellation request details
     */
    async handleTranscribeCancel(event, { jobId }) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.status = 'cancelled';
            // Clean up temporary files
            await fs.remove(job.tempDir);
            this.activeJobs.delete(jobId);
        }
        return { success: true };
    }

    /**
     * Process transcription job
     * @param {string} jobId - Job identifier
     * @param {string} filePath - Path to media file
     * @param {Object} options - Transcription options
     */
    async processTranscription(jobId, filePath, options) {
        try {
            this.updateJobStatus(jobId, 'extracting_audio');
            const audioPath = await this.extractAudio(filePath, jobId);

            this.updateJobStatus(jobId, 'chunking');
            const chunks = await this.createAudioChunks(audioPath, jobId);

            this.updateJobStatus(jobId, 'transcribing', { total: chunks.length });
            const transcriptions = await this.transcribeChunks(jobId, chunks, options);

            this.updateJobStatus(jobId, 'combining');
            const result = this.combineTranscriptions(transcriptions);

            // Clean up temp files
            await fs.remove(this.activeJobs.get(jobId).tempDir);
            
            this.updateJobStatus(jobId, 'completed', { result });
        } catch (error) {
            console.error('[TranscriberService] Transcription processing failed:', error);
            throw error;
        }
    }

    /**
     * Extract audio from media file
     * @param {string} filePath - Path to media file
     * @param {string} jobId - Job identifier
     * @returns {Promise<string>} Path to extracted audio
     */
    async extractAudio(filePath, jobId) {
        const job = this.activeJobs.get(jobId);
        const outputPath = path.join(job.tempDir, 'audio.mp3');

        return new Promise((resolve, reject) => {
            ffmpeg(filePath)
                .toFormat('mp3')
                .on('progress', progress => {
                    this.updateJobStatus(jobId, 'extracting_audio', {
                        progress: Math.round(progress.percent || 0)
                    });
                })
                .on('end', () => resolve(outputPath))
                .on('error', error => reject(error))
                .save(outputPath);
        });
    }

    /**
     * Create audio chunks for large files
     * @param {string} audioPath - Path to audio file
     * @param {string} jobId - Job identifier
     * @returns {Promise<string[]>} Array of chunk file paths
     */
    async createAudioChunks(audioPath, jobId) {
        const job = this.activeJobs.get(jobId);
        const stats = await fs.stat(audioPath);

        if (stats.size <= MAX_CHUNK_SIZE) {
            return [audioPath];
        }

        const duration = await this.getAudioDuration(audioPath);
        const chunkDuration = Math.ceil((duration * MAX_CHUNK_SIZE) / stats.size);
        const chunks = [];

        for (let start = 0; start < duration; start += chunkDuration) {
            const chunkPath = path.join(job.tempDir, `chunk_${start}.mp3`);
            await this.extractAudioChunk(audioPath, chunkPath, start, chunkDuration);
            chunks.push(chunkPath);

            this.updateJobStatus(jobId, 'chunking', {
                progress: Math.round((start + chunkDuration) / duration * 100)
            });
        }

        return chunks;
    }

    /**
     * Get audio file duration
     * @param {string} audioPath - Path to audio file
     * @returns {Promise<number>} Duration in seconds
     */
    async getAudioDuration(audioPath) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(audioPath, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata.format.duration);
            });
        });
    }

    /**
     * Extract audio chunk
     * @param {string} inputPath - Input audio path
     * @param {string} outputPath - Output chunk path
     * @param {number} start - Start time in seconds
     * @param {number} duration - Chunk duration in seconds
     */
    async extractAudioChunk(inputPath, outputPath, start, duration) {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .setStartTime(start)
                .setDuration(duration)
                .output(outputPath)
                .on('end', resolve)
                .on('error', reject)
                .run();
        });
    }

    /**
     * Transcribe audio chunks
     * @param {string} jobId - Job identifier
     * @param {string[]} chunks - Array of chunk paths
     * @param {Object} options - Transcription options
     * @returns {Promise<Object[]>} Array of transcription results
     */
    async transcribeChunks(jobId, chunks, options) {
        const results = [];
        let completed = 0;

        for (const chunk of chunks) {
            const result = await this.openAIProxy.handleTranscribe(null, {
                audioPath: chunk,
                ...options
            });

            results.push(result);
            completed++;

            this.updateJobStatus(jobId, 'transcribing', {
                progress: Math.round((completed / chunks.length) * 100),
                completed,
                total: chunks.length
            });
        }

        return results;
    }

    /**
     * Combine chunk transcriptions
     * @param {Object[]} transcriptions - Array of transcription results
     * @returns {Object} Combined result
     */
    combineTranscriptions(transcriptions) {
        let combinedText = transcriptions
            .map(t => t.text.trim())
            .join('\n');

        return {
            text: combinedText,
            language: transcriptions[0].language
        };
    }

    /**
     * Update job status and notify renderer
     * @param {string} jobId - Job identifier
     * @param {string} status - New status
     * @param {Object} details - Additional details
     */
    updateJobStatus(jobId, status, details = {}) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.status = status;
            Object.assign(job, details);

            if (job.window) {
                job.window.webContents.send('transcribe:progress', {
                    jobId,
                    status,
                    ...details
                });
            }
        }
    }

    /**
     * Clean up job resources
     * @param {string} jobId - Job identifier
     */
    async cleanupJob(jobId) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            await fs.remove(job.tempDir);
            this.activeJobs.delete(jobId);
        }
    }
}

module.exports = TranscriberService;
