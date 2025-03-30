// routes/index.js

import express from 'express';
import { ConversionController } from './controllers/ConversionController.js';
import { validateConversion } from './middleware/validators.js';
import { uploadMiddleware } from './middleware/upload.js';
import { apiKeyChecker } from './middleware/utils/apiKeyChecker.js';
import path from 'path';
import fs from 'fs';
const router = express.Router();
const controller = new ConversionController();

// Get JobManager instance from server
const jobManager = global.server?.getJobManager();

// Debug middleware to log requests with enhanced details
router.use((req, res, next) => {
    console.log(`📝 ${req.method} ${req.path}`);
    next();
});

// Document endpoints with enhanced error handling
router.post('/document/file',
    (req, res, next) => {
        console.log('📥 File upload request:', {
            method: req.method,
            path: req.path,
            headers: {
                'content-type': req.headers['content-type'],
                'content-length': req.headers['content-length'],
                'accept': req.headers['accept']
            },
            body: req.body,
            isMultipart: req.headers['content-type']?.includes('multipart/form-data'),
            boundary: req.headers['content-type']?.split('boundary=')[1]
        });
        next();
    },
    uploadMiddleware,
    (req, res, next) => {
        // Log successful file upload before validation
        if (req.file) {
            console.log('📁 File received:', {
                fieldname: req.file.fieldname,
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size
            });
        }
        next();
    },
    validateConversion,
    controller.handleFileConversion
);

// Multimedia endpoints
router.post('/multimedia/audio',
    uploadMiddleware,
    apiKeyChecker,
    validateConversion,
    controller.handleAudioConversion
);

router.post('/multimedia/video',
    uploadMiddleware,
    apiKeyChecker,
    validateConversion,
    controller.handleVideoConversion
);

// Web content endpoints
router.post('/web/url',
    validateConversion,
    controller.handleUrlConversion
);

router.post('/web/parent-url',
    validateConversion,
    controller.handleParentUrlConversion
);

// Batch conversion endpoint
router.post('/batch',
    uploadMiddleware,
    validateConversion,
    controller.handleBatchConversion
);


// Job status endpoint
router.get('/job/:jobId/status', (req, res, next) => {
    try {
        const { jobId } = req.params;
        
        if (!jobManager) {
            throw new Error('Job manager not initialized');
        }

        const job = jobManager.jobs.get(jobId);
        if (!job) {
            return res.status(404).json({
                status: 'error',
                message: 'Job not found'
            });
        }

        res.json({
            status: 'success',
            data: {
                jobId: job.id,
                status: job.status,
                progress: job.progress,
                message: job.message,
                downloadUrl: job.downloadUrl,
                error: job.error,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt
            }
        });
    } catch (error) {
        console.error('❌ Job status check failed:', {
            jobId: req.params.jobId,
            error: error.message
        });
        next(error);
    }
});

// Download endpoint for job results
router.get('/download/:jobId/:filename', (req, res, next) => {
    try {
        const { jobId, filename } = req.params;
        
        if (!jobManager) {
            throw new Error('Job manager not initialized');
        }

        // Get file path from job manager
        const filePath = jobManager.getJobResultPath(jobId, filename);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.error('❌ Download file not found:', {
                jobId,
                filename,
                path: filePath
            });
            return res.status(404).json({
                status: 'error',
                message: 'File not found'
            });
        }

        console.log('📥 Serving download:', {
            jobId,
            filename,
            size: fs.statSync(filePath).size
        });

        // Send file
        res.download(filePath, filename, (err) => {
            if (err) {
                console.error('❌ Download failed:', {
                    jobId,
                    filename,
                    error: err.message
                });
                // Don't send error response if headers are already sent
                if (!res.headersSent) {
                    res.status(500).json({
                        status: 'error',
                        message: 'Failed to download file'
                    });
                }
            }
        });
    } catch (error) {
        console.error('❌ Download error:', {
            error: error.message,
            jobId: req.params.jobId,
            filename: req.params.filename
        });
        next(error);
    }
});

export default router;
