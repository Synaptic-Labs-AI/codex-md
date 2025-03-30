// JobManager.js
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

export class JobManager {
  constructor(io) {
    this.io = io;
    this.jobs = new Map();
    this.cleanupInterval = setInterval(() => this.cleanupOldJobs(), 1000 * 60 * 60); // Cleanup every hour
    
    // Create temp directory if it doesn't exist
    this.tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Create a new job and return its ID
   */
  createJob() {
    const jobId = randomUUID();
    this.jobs.set(jobId, {
      id: jobId,
      status: 'created',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    return jobId;
  }

  /**
   * Update job status and emit event
   */
  updateJobStatus(jobId, status, message = '') {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = status;
    job.message = message;
    job.updatedAt = new Date();

    this.io.to(`job:${jobId}`).emit(`job:status:${jobId}`, {
      status,
      message
    });

    console.log('🔄 Job status updated:', {
      jobId,
      status,
      message
    });
  }

  /**
   * Update job progress and emit event
   */
  updateJobProgress(jobId, progress) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.progress = progress;
    job.updatedAt = new Date();

    this.io.to(`job:${jobId}`).emit(`job:progress:${jobId}`, {
      progress
    });

    console.log('📊 Job progress updated:', {
      jobId,
      progress: `${progress}%`
    });
  }

  /**
   * Complete job with download URL
   */
  completeJob(jobId, downloadUrl) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'completed';
    job.downloadUrl = downloadUrl;
    job.updatedAt = new Date();

    this.io.to(`job:${jobId}`).emit(`job:complete:${jobId}`, {
      status: 'completed',
      downloadUrl
    });

    console.log('✅ Job completed:', {
      jobId,
      downloadUrl
    });
  }

  /**
   * Mark job as failed
   */
  failJob(jobId, error) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'error';
    job.error = error.message;
    job.updatedAt = new Date();

    this.io.to(`job:${jobId}`).emit(`job:error:${jobId}`, {
      status: 'error',
      message: error.message
    });

    console.error('❌ Job failed:', {
      jobId,
      error: error.message
    });
  }

  /**
   * Generate a secure download URL for a job result
   */
  generateDownloadUrl(jobId, filename) {
    // Store file in temp directory with job ID
    const tempPath = path.join(this.tempDir, jobId);
    if (!fs.existsSync(tempPath)) {
      fs.mkdirSync(tempPath, { recursive: true });
    }
    
    // Return path that will be served by Express
    return `/api/v1/download/${jobId}/${encodeURIComponent(filename)}`;
  }

  /**
   * Save job result to temp storage
   */
  saveJobResult(jobId, buffer, filename) {
    const tempPath = path.join(this.tempDir, jobId);
    if (!fs.existsSync(tempPath)) {
      fs.mkdirSync(tempPath, { recursive: true });
    }
    
    const filePath = path.join(tempPath, filename);
    fs.writeFileSync(filePath, buffer);
    
    return filePath;
  }

  /**
   * Get job result file path
   */
  getJobResultPath(jobId, filename) {
    return path.join(this.tempDir, jobId, filename);
  }

  /**
   * Clean up old jobs and their files
   */
  cleanupOldJobs() {
    const now = new Date();
    for (const [jobId, job] of this.jobs.entries()) {
      // Remove jobs older than 24 hours
      if (now - job.updatedAt > 1000 * 60 * 60 * 24) {
        // Delete job files
        const jobPath = path.join(this.tempDir, jobId);
        if (fs.existsSync(jobPath)) {
          fs.rmSync(jobPath, { recursive: true, force: true });
        }
        
        // Remove job from memory
        this.jobs.delete(jobId);
        
        console.log('🧹 Cleaned up old job:', {
          jobId,
          age: Math.round((now - job.createdAt) / (1000 * 60 * 60)) + ' hours'
        });
      }
    }
  }

  /**
   * Clean up when shutting down
   */
  cleanup() {
    clearInterval(this.cleanupInterval);
    // Could add additional cleanup here if needed
  }
}
