/**
 * ProgressService.js
 * Manages conversion progress tracking and notifications via IPC.
 * Replaces socket-based communication with direct IPC events.
 * 
 * Related files:
 * - ipc/types.js: TypeScript definitions for IPC messages
 * - ipc/handlers/conversion/index.js: Conversion handlers that use this service
 * - main.js: Main process entry point
 * - preload.js: Exposes IPC channels to renderer
 */

const { BrowserWindow } = require('electron');
const { IPCChannels } = require('../ipc/types');

class ProgressService {
  constructor() {
    this.activeJobs = new Map();
  }

  /**
   * Registers a new conversion job
   * @param {string} id Job identifier
   * @param {Object} metadata Job metadata
   */
  registerJob(id, metadata = {}) {
    this.activeJobs.set(id, {
      id,
      startTime: Date.now(),
      progress: 0,
      status: 'initializing',
      metadata
    });
    
    this._broadcastStatus(id);
    return id;
  }

  /**
   * Updates job progress
   * @param {string} id Job identifier
   * @param {number} progress Progress percentage (0-100)
   * @param {Object} data Additional progress data
   */
  updateProgress(id, progress, data = {}) {
    if (!this.activeJobs.has(id)) return;
    
    const job = this.activeJobs.get(id);
    job.progress = Math.min(Math.round(progress), 100);
    job.lastUpdate = Date.now();
    
    if (data.status) {
      job.status = data.status;
    }
    
    this._broadcastProgress(id, job, data);
  }

  /**
   * Marks a job as complete
   * @param {string} id Job identifier
   * @param {Object} result Job result data
   */
  completeJob(id, result = {}) {
    if (!this.activeJobs.has(id)) return;
    
    const job = this.activeJobs.get(id);
    job.progress = 100;
    job.status = 'completed';
    job.endTime = Date.now();
    job.duration = job.endTime - job.startTime;
    
    this._broadcastComplete(id, job, result);
    this.activeJobs.delete(id);
  }

  /**
   * Marks a job as failed
   * @param {string} id Job identifier
   * @param {Error|string} error Error information
   */
  failJob(id, error) {
    if (!this.activeJobs.has(id)) return;
    
    const job = this.activeJobs.get(id);
    job.status = 'error';
    job.error = error instanceof Error ? error.message : error;
    job.endTime = Date.now();
    
    this._broadcastError(id, job);
    this.activeJobs.delete(id);
  }

  /**
   * Cancels a job
   * @param {string} id Job identifier
   */
  cancelJob(id) {
    if (!this.activeJobs.has(id)) return;
    
    const job = this.activeJobs.get(id);
    job.status = 'cancelled';
    job.endTime = Date.now();
    
    this._broadcastStatus(id);
    this.activeJobs.delete(id);
  }

  /**
   * Gets all active jobs
   * @returns {Array} Array of active jobs
   */
  getActiveJobs() {
    return Array.from(this.activeJobs.values());
  }

  /**
   * Broadcasts progress update to renderer
   * @private
   */
  _broadcastProgress(id, job, data = {}) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      window.webContents.send(IPCChannels.CONVERSION_PROGRESS, {
        id,
        progress: job.progress,
        status: job.status,
        ...data
      });
    });
  }

  /**
   * Broadcasts status update to renderer
   * @private
   */
  _broadcastStatus(id) {
    const job = this.activeJobs.get(id);
    if (!job) return;
    
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      window.webContents.send(IPCChannels.CONVERSION_STATUS, {
        id,
        status: job.status,
        metadata: job.metadata
      });
    });
  }

  /**
   * Broadcasts completion event to renderer
   * @private
   */
  _broadcastComplete(id, job, result) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      window.webContents.send(IPCChannels.CONVERSION_COMPLETE, {
        id,
        result,
        duration: job.duration,
        metadata: job.metadata
      });
    });
  }

  /**
   * Broadcasts error event to renderer
   * @private
   */
  _broadcastError(id, job) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      window.webContents.send(IPCChannels.CONVERSION_ERROR, {
        id,
        error: job.error,
        metadata: job.metadata
      });
    });
  }
}

module.exports = new ProgressService();
