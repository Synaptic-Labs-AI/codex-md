"use strict";

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
  async handleJobCreate(event, {
    type,
    metadata = {}
  }) {
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
      event.sender.send('job:created', {
        jobId
      });
      return {
        jobId
      };
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
  async handleJobUpdate(event, {
    jobId,
    status,
    progress,
    metadata = {}
  }) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    Object.assign(job, {
      status,
      progress,
      metadata: {
        ...job.metadata,
        ...metadata
      },
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
    return {
      success: true
    };
  }

  /**
   * Handle job cancellation request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Cancellation details
   */
  async handleJobCancel(event, {
    jobId
  }) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'cancelled';
      job.updatedAt = Date.now();
      if (job.window) {
        job.window.webContents.send('job:cancelled', {
          jobId
        });
      }
    }
    return {
      success: true
    };
  }

  /**
   * Handle job status request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Status request details
   */
  async handleJobStatus(event, {
    jobId
  }) {
    const job = this.jobs.get(jobId);
    return job || {
      status: 'not_found'
    };
  }

  /**
   * Handle job list request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - List request details
   */
  async handleJobList(event, {
    type,
    status
  } = {}) {
    const jobs = Array.from(this.jobs.values()).filter(job => (!type || job.type === type) && (!status || job.status === status)).map(({
      id,
      type,
      status,
      progress,
      metadata,
      createdAt,
      updatedAt
    }) => ({
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
      if (job.status === 'completed' && age > ONE_DAY || job.status === 'failed' && age > ONE_HOUR || job.status === 'cancelled' && age > ONE_HOUR) {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImNyeXB0byIsIkJhc2VTZXJ2aWNlIiwiSm9iTWFuYWdlclNlcnZpY2UiLCJjb25zdHJ1Y3RvciIsImpvYnMiLCJNYXAiLCJjbGVhbnVwSW50ZXJ2YWwiLCJzZXRJbnRlcnZhbCIsImNsZWFudXBPbGRKb2JzIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUpvYkNyZWF0ZSIsImJpbmQiLCJoYW5kbGVKb2JVcGRhdGUiLCJoYW5kbGVKb2JDYW5jZWwiLCJoYW5kbGVKb2JTdGF0dXMiLCJoYW5kbGVKb2JMaXN0IiwiZXZlbnQiLCJ0eXBlIiwibWV0YWRhdGEiLCJqb2JJZCIsImdlbmVyYXRlSm9iSWQiLCJqb2IiLCJpZCIsInN0YXR1cyIsInByb2dyZXNzIiwiY3JlYXRlZEF0IiwiRGF0ZSIsIm5vdyIsInVwZGF0ZWRBdCIsIndpbmRvdyIsInNlbmRlciIsImdldE93bmVyQnJvd3NlcldpbmRvdyIsInNldCIsInNlbmQiLCJlcnJvciIsImNvbnNvbGUiLCJnZXQiLCJFcnJvciIsIk9iamVjdCIsImFzc2lnbiIsIndlYkNvbnRlbnRzIiwic3VjY2VzcyIsIkFycmF5IiwiZnJvbSIsInZhbHVlcyIsImZpbHRlciIsIm1hcCIsIk9ORV9IT1VSIiwiT05FX0RBWSIsImVudHJpZXMiLCJhZ2UiLCJkZWxldGUiLCJsb2ciLCJyYW5kb21CeXRlcyIsInRvU3RyaW5nIiwic2h1dGRvd24iLCJjbGVhckludGVydmFsIiwiY2xlYXIiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0pvYk1hbmFnZXJTZXJ2aWNlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBKb2JNYW5hZ2VyU2VydmljZS5qc1xyXG4gKiBNYW5hZ2VzIGNvbnZlcnNpb24gam9icyBhbmQgdGhlaXIgbGlmZWN5Y2xlIGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXHJcbiAqIFxyXG4gKiBUaGlzIHNlcnZpY2UgaGFuZGxlczpcclxuICogLSBKb2IgY3JlYXRpb24gYW5kIHRyYWNraW5nXHJcbiAqIC0gU3RhdHVzIHVwZGF0ZXMgYW5kIHByb2dyZXNzIG1vbml0b3JpbmdcclxuICogLSBKb2IgY2xlYW51cCBhbmQgZXJyb3IgaGFuZGxpbmdcclxuICogXHJcbiAqIFJlbGF0ZWQgRmlsZXM6XHJcbiAqIC0gQmFzZVNlcnZpY2UuanM6IFBhcmVudCBjbGFzcyBwcm92aWRpbmcgSVBDIGhhbmRsaW5nXHJcbiAqIC0gQ29udmVyc2lvblNlcnZpY2UuanM6IFByaW1hcnkgY2xpZW50IG9mIGpvYiBtYW5hZ2VtZW50XHJcbiAqIC0gRmlsZVN0b3JhZ2VTZXJ2aWNlLmpzOiBVc2VkIGZvciBqb2IgYXJ0aWZhY3RzIGNsZWFudXBcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCBjcnlwdG8gPSByZXF1aXJlKCdjcnlwdG8nKTtcclxuY29uc3QgQmFzZVNlcnZpY2UgPSByZXF1aXJlKCcuL0Jhc2VTZXJ2aWNlJyk7XHJcblxyXG5jbGFzcyBKb2JNYW5hZ2VyU2VydmljZSBleHRlbmRzIEJhc2VTZXJ2aWNlIHtcclxuICAgIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgICAgIHN1cGVyKCk7XHJcbiAgICAgICAgdGhpcy5qb2JzID0gbmV3IE1hcCgpO1xyXG4gICAgICAgIHRoaXMuY2xlYW51cEludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5jbGVhbnVwT2xkSm9icygpLCAzMCAqIDYwICogMTAwMCk7IC8vIDMwIG1pbnV0ZXNcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIGpvYiBtYW5hZ2VtZW50XHJcbiAgICAgKi9cclxuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2pvYjpjcmVhdGUnLCB0aGlzLmhhbmRsZUpvYkNyZWF0ZS5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignam9iOnVwZGF0ZScsIHRoaXMuaGFuZGxlSm9iVXBkYXRlLmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdqb2I6Y2FuY2VsJywgdGhpcy5oYW5kbGVKb2JDYW5jZWwuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2pvYjpzdGF0dXMnLCB0aGlzLmhhbmRsZUpvYlN0YXR1cy5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignam9iOmxpc3QnLCB0aGlzLmhhbmRsZUpvYkxpc3QuYmluZCh0aGlzKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgam9iIGNyZWF0aW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBKb2IgY3JlYXRpb24gZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVKb2JDcmVhdGUoZXZlbnQsIHsgdHlwZSwgbWV0YWRhdGEgPSB7fSB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3Qgam9iSWQgPSB0aGlzLmdlbmVyYXRlSm9iSWQoKTtcclxuICAgICAgICAgICAgY29uc3Qgam9iID0ge1xyXG4gICAgICAgICAgICAgICAgaWQ6IGpvYklkLFxyXG4gICAgICAgICAgICAgICAgdHlwZSxcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ2NyZWF0ZWQnLFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDAsXHJcbiAgICAgICAgICAgICAgICBtZXRhZGF0YSxcclxuICAgICAgICAgICAgICAgIGNyZWF0ZWRBdDogRGF0ZS5ub3coKSxcclxuICAgICAgICAgICAgICAgIHVwZGF0ZWRBdDogRGF0ZS5ub3coKSxcclxuICAgICAgICAgICAgICAgIHdpbmRvdzogZXZlbnQuc2VuZGVyLmdldE93bmVyQnJvd3NlcldpbmRvdygpXHJcbiAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICB0aGlzLmpvYnMuc2V0KGpvYklkLCBqb2IpO1xyXG4gICAgICAgICAgICBldmVudC5zZW5kZXIuc2VuZCgnam9iOmNyZWF0ZWQnLCB7IGpvYklkIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHsgam9iSWQgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbSm9iTWFuYWdlclNlcnZpY2VdIEpvYiBjcmVhdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgam9iIHVwZGF0ZSByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gSm9iIHVwZGF0ZSBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUpvYlVwZGF0ZShldmVudCwgeyBqb2JJZCwgc3RhdHVzLCBwcm9ncmVzcywgbWV0YWRhdGEgPSB7fSB9KSB7XHJcbiAgICAgICAgY29uc3Qgam9iID0gdGhpcy5qb2JzLmdldChqb2JJZCk7XHJcbiAgICAgICAgaWYgKCFqb2IpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBKb2Igbm90IGZvdW5kOiAke2pvYklkfWApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgT2JqZWN0LmFzc2lnbihqb2IsIHtcclxuICAgICAgICAgICAgc3RhdHVzLFxyXG4gICAgICAgICAgICBwcm9ncmVzcyxcclxuICAgICAgICAgICAgbWV0YWRhdGE6IHsgLi4uam9iLm1ldGFkYXRhLCAuLi5tZXRhZGF0YSB9LFxyXG4gICAgICAgICAgICB1cGRhdGVkQXQ6IERhdGUubm93KClcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gTm90aWZ5IHJlbmRlcmVyIG9mIHVwZGF0ZVxyXG4gICAgICAgIGlmIChqb2Iud2luZG93KSB7XHJcbiAgICAgICAgICAgIGpvYi53aW5kb3cud2ViQ29udGVudHMuc2VuZCgnam9iOnVwZGF0ZWQnLCB7XHJcbiAgICAgICAgICAgICAgICBqb2JJZCxcclxuICAgICAgICAgICAgICAgIHN0YXR1cyxcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzLFxyXG4gICAgICAgICAgICAgICAgbWV0YWRhdGE6IGpvYi5tZXRhZGF0YVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBqb2IgY2FuY2VsbGF0aW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDYW5jZWxsYXRpb24gZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVKb2JDYW5jZWwoZXZlbnQsIHsgam9iSWQgfSkge1xyXG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuam9icy5nZXQoam9iSWQpO1xyXG4gICAgICAgIGlmIChqb2IpIHtcclxuICAgICAgICAgICAgam9iLnN0YXR1cyA9ICdjYW5jZWxsZWQnO1xyXG4gICAgICAgICAgICBqb2IudXBkYXRlZEF0ID0gRGF0ZS5ub3coKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChqb2Iud2luZG93KSB7XHJcbiAgICAgICAgICAgICAgICBqb2Iud2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ2pvYjpjYW5jZWxsZWQnLCB7IGpvYklkIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBqb2Igc3RhdHVzIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBTdGF0dXMgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUpvYlN0YXR1cyhldmVudCwgeyBqb2JJZCB9KSB7XHJcbiAgICAgICAgY29uc3Qgam9iID0gdGhpcy5qb2JzLmdldChqb2JJZCk7XHJcbiAgICAgICAgcmV0dXJuIGpvYiB8fCB7IHN0YXR1czogJ25vdF9mb3VuZCcgfTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBqb2IgbGlzdCByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gTGlzdCByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlSm9iTGlzdChldmVudCwgeyB0eXBlLCBzdGF0dXMgfSA9IHt9KSB7XHJcbiAgICAgICAgY29uc3Qgam9icyA9IEFycmF5LmZyb20odGhpcy5qb2JzLnZhbHVlcygpKVxyXG4gICAgICAgICAgICAuZmlsdGVyKGpvYiA9PiBcclxuICAgICAgICAgICAgICAgICghdHlwZSB8fCBqb2IudHlwZSA9PT0gdHlwZSkgJiZcclxuICAgICAgICAgICAgICAgICghc3RhdHVzIHx8IGpvYi5zdGF0dXMgPT09IHN0YXR1cylcclxuICAgICAgICAgICAgKVxyXG4gICAgICAgICAgICAubWFwKCh7IGlkLCB0eXBlLCBzdGF0dXMsIHByb2dyZXNzLCBtZXRhZGF0YSwgY3JlYXRlZEF0LCB1cGRhdGVkQXQgfSkgPT4gKHtcclxuICAgICAgICAgICAgICAgIGlkLFxyXG4gICAgICAgICAgICAgICAgdHlwZSxcclxuICAgICAgICAgICAgICAgIHN0YXR1cyxcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzLFxyXG4gICAgICAgICAgICAgICAgbWV0YWRhdGEsXHJcbiAgICAgICAgICAgICAgICBjcmVhdGVkQXQsXHJcbiAgICAgICAgICAgICAgICB1cGRhdGVkQXRcclxuICAgICAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICByZXR1cm4gam9icztcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENsZWFuIHVwIG9sZCBqb2JzXHJcbiAgICAgKiBSZW1vdmVzIGNvbXBsZXRlZCBqb2JzIG9sZGVyIHRoYW4gMjQgaG91cnMgYW5kIGZhaWxlZCBqb2JzIG9sZGVyIHRoYW4gMSBob3VyXHJcbiAgICAgKi9cclxuICAgIGNsZWFudXBPbGRKb2JzKCkge1xyXG4gICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XHJcbiAgICAgICAgY29uc3QgT05FX0hPVVIgPSA2MCAqIDYwICogMTAwMDtcclxuICAgICAgICBjb25zdCBPTkVfREFZID0gMjQgKiBPTkVfSE9VUjtcclxuXHJcbiAgICAgICAgZm9yIChjb25zdCBbam9iSWQsIGpvYl0gb2YgdGhpcy5qb2JzLmVudHJpZXMoKSkge1xyXG4gICAgICAgICAgICBjb25zdCBhZ2UgPSBub3cgLSBqb2IudXBkYXRlZEF0O1xyXG5cclxuICAgICAgICAgICAgaWYgKFxyXG4gICAgICAgICAgICAgICAgKGpvYi5zdGF0dXMgPT09ICdjb21wbGV0ZWQnICYmIGFnZSA+IE9ORV9EQVkpIHx8XHJcbiAgICAgICAgICAgICAgICAoam9iLnN0YXR1cyA9PT0gJ2ZhaWxlZCcgJiYgYWdlID4gT05FX0hPVVIpIHx8XHJcbiAgICAgICAgICAgICAgICAoam9iLnN0YXR1cyA9PT0gJ2NhbmNlbGxlZCcgJiYgYWdlID4gT05FX0hPVVIpXHJcbiAgICAgICAgICAgICkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5qb2JzLmRlbGV0ZShqb2JJZCk7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0pvYk1hbmFnZXJTZXJ2aWNlXSBDbGVhbmVkIHVwIGpvYjogJHtqb2JJZH1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIHVuaXF1ZSBqb2IgaWRlbnRpZmllclxyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gVW5pcXVlIGpvYiBJRFxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZUpvYklkKCkge1xyXG4gICAgICAgIHJldHVybiBjcnlwdG8ucmFuZG9tQnl0ZXMoOCkudG9TdHJpbmcoJ2hleCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2xlYW4gdXAgb24gc2VydmljZSBzaHV0ZG93blxyXG4gICAgICovXHJcbiAgICBzaHV0ZG93bigpIHtcclxuICAgICAgICBjbGVhckludGVydmFsKHRoaXMuY2xlYW51cEludGVydmFsKTtcclxuICAgICAgICB0aGlzLmpvYnMuY2xlYXIoKTtcclxuICAgIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBKb2JNYW5hZ2VyU2VydmljZTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1DLE1BQU0sR0FBR0QsT0FBTyxDQUFDLFFBQVEsQ0FBQztBQUNo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