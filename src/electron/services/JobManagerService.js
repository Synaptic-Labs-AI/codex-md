/**
 * JobManagerService.js
 * Manages conversion jobs and their lifecycle in the Electron main process.
 * 
 * This service handles:
 * - Job creation and tracking
 * - Status updates and progress monitoring
 * - Job cleanup and error handling
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - ConversionService.js: Primary client of job management
 * - FileStorageService.js: Used for job artifacts cleanup
 */

const path = require('path');
const crypto = require('crypto');
const BaseService = require('./BaseService');

class JobManagerService extends BaseService {
    constructor() {
        super();
        this.jobs = new Map();
        this.cleanupInterval = setInterval(() => this.cleanupOldJobs(), 30 * 60 * 1000); // 30 minutes
    }

    /**
     * Set up IPC handlers for job management
     */
    setupIpcHandlers() {
        this.registerHandler('job:create', this.handleJobCreate.bind(this));
        this.registerHandler('job:update', this.handleJobUpdate.bind(this));
        this.registerHandler('job:cancel', this.handleJobCancel.bind(this));
        this.registerHandler('job:status', this.handleJobStatus.bind(this));
        this.registerHandler('job:list', this.handleJobList.bind(this));
    }

    /**
     * Handle job creation request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Job creation details
     */
    async handleJobCreate(event, { type, metadata = {} }) {
        try {
            const jobId = this.generateJobId();
            const job = {
                id: jobId,
                type,
                status: 'created',
                progress: 0,
                metadata,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                window: event.sender.getOwnerBrowserWindow()
            };

            this.jobs.set(jobId, job);
            event.sender.send('job:created', { jobId });
            
            return { jobId };
        } catch (error) {
            console.error('[JobManagerService] Job creation failed:', error);
            throw error;
        }
    }

    /**
     * Handle job update request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Job update details
     */
    async handleJobUpdate(event, { jobId, status, progress, metadata = {} }) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job not found: ${jobId}`);
        }

        Object.assign(job, {
            status,
            progress,
            metadata: { ...job.metadata, ...metadata },
            updatedAt: Date.now()
        });

        // Notify renderer of update
        if (job.window) {
            job.window.webContents.send('job:updated', {
                jobId,
                status,
                progress,
                metadata: job.metadata
            });
        }

        return { success: true };
    }

    /**
     * Handle job cancellation request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Cancellation details
     */
    async handleJobCancel(event, { jobId }) {
        const job = this.jobs.get(jobId);
        if (job) {
            job.status = 'cancelled';
            job.updatedAt = Date.now();
            
            if (job.window) {
                job.window.webContents.send('job:cancelled', { jobId });
            }
        }
        return { success: true };
    }

    /**
     * Handle job status request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Status request details
     */
    async handleJobStatus(event, { jobId }) {
        const job = this.jobs.get(jobId);
        return job || { status: 'not_found' };
    }

    /**
     * Handle job list request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - List request details
     */
    async handleJobList(event, { type, status } = {}) {
        const jobs = Array.from(this.jobs.values())
            .filter(job => 
                (!type || job.type === type) &&
                (!status || job.status === status)
            )
            .map(({ id, type, status, progress, metadata, createdAt, updatedAt }) => ({
                id,
                type,
                status,
                progress,
                metadata,
                createdAt,
                updatedAt
            }));

        return jobs;
    }

    /**
     * Clean up old jobs
     * Removes completed jobs older than 24 hours and failed jobs older than 1 hour
     */
    cleanupOldJobs() {
        const now = Date.now();
        const ONE_HOUR = 60 * 60 * 1000;
        const ONE_DAY = 24 * ONE_HOUR;

        for (const [jobId, job] of this.jobs.entries()) {
            const age = now - job.updatedAt;

            if (
                (job.status === 'completed' && age > ONE_DAY) ||
                (job.status === 'failed' && age > ONE_HOUR) ||
                (job.status === 'cancelled' && age > ONE_HOUR)
            ) {
                this.jobs.delete(jobId);
                console.log(`[JobManagerService] Cleaned up job: ${jobId}`);
            }
        }
    }

    /**
     * Generate unique job identifier
     * @returns {string} Unique job ID
     */
    generateJobId() {
        return crypto.randomBytes(8).toString('hex');
    }

    /**
     * Clean up on service shutdown
     */
    shutdown() {
        clearInterval(this.cleanupInterval);
        this.jobs.clear();
    }
}

module.exports = JobManagerService;
