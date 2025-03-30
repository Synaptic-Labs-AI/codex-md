import { ConversionService } from "../../services/ConversionService.js";
import { AppError } from '../../utils/errorHandler.js';
import path from 'path';
import { randomUUID } from 'crypto';

export class ConversionController {
  constructor() {
    this.conversionService = new ConversionService();
  }

  handleConversion = async (req, res, next) => {
    try {
      // Get JobManager instance
      const jobManager = global.server?.getJobManager();
      if (!jobManager) {
        throw new AppError('Job manager not initialized', 500);
      }

      // Create new job
      const jobId = jobManager.createJob();
      console.log('🎯 Created new generic conversion job:', {
        jobId,
        filename: req.file?.originalname
      });

      // Send immediate response with job ID
      res.json({ jobId });

      // Start processing in background
      this.#processGenericConversionInBackground(jobId, req.file, req.body.options, req.headers);
    } catch (error) {
      console.error('❌ Failed to start generic conversion job:', {
        filename: req.file?.originalname,
        error: error.message
      });
      next(new AppError(error.message, 500));
    }
  };

  #processGenericConversionInBackground = async (jobId, file, rawOptions, headers) => {
    const jobManager = global.server?.getJobManager();
    
    try {
      jobManager.updateJobStatus(jobId, 'validating', 'Validating file...');

      // Validate file data
      if (!file || !Buffer.isBuffer(file.buffer)) {
        throw new AppError('Invalid file data received', 400);
      }

      if (file.buffer.length === 0) {
        throw new AppError('Empty file received', 400);
      }

      // Parse options
      let options;
      try {
        options = rawOptions ? JSON.parse(rawOptions) : {};
      } catch (error) {
        throw new AppError('Invalid options format', 400);
      }

      // Add API key from headers
      const apiKey = headers['x-api-key'] || headers['authorization']?.replace('Bearer ', '');
      if (apiKey) {
        options.apiKey = apiKey;
      }

      // Create a fresh buffer copy and validate file type
      const fileBuffer = Buffer.from(file.buffer);
      const fileExtension = path.extname(file.originalname).slice(1).toLowerCase();
      const fileType = this.#determineFileType(fileExtension, file.mimetype);

      jobManager.updateJobStatus(jobId, 'processing', 'Converting file...');

      const conversionData = {
        type: fileType,
        content: fileBuffer,
        name: file.originalname,
        options: {
          ...options,
          originalMimeType: file.mimetype,
          streamProcessing: true,
          memoryLimit: 512 * 1024 * 1024,
          chunkSize: file.buffer.length > 50 * 1024 * 1024 ? 25 * 1024 * 1024 : undefined,
          onProgress: (progress) => {
            jobManager.updateJobProgress(jobId, progress);
          }
        },
        mimeType: file.mimetype
      };

      const result = await this.conversionService.convert(conversionData);

      if (!result.buffer || !result.filename) {
        throw new Error('Invalid conversion result');
      }

      // Save result and generate download URL
      const downloadUrl = jobManager.generateDownloadUrl(jobId, result.filename);
      jobManager.saveJobResult(jobId, result.buffer, result.filename);

      // Complete job with download URL
      jobManager.completeJob(jobId, downloadUrl);

    } catch (error) {
      console.error('❌ Generic conversion failed:', {
        jobId,
        filename: file?.originalname,
        error: error.message
      });
      jobManager.failJob(jobId, error);
    }
  };

    handleBatchConversion = async (req, res, next) => {
        try {
            // Get JobManager instance
            const jobManager = global.server?.getJobManager();
            if (!jobManager) {
                throw new AppError('Job manager not initialized', 500);
            }

            // Create new job
            const jobId = jobManager.createJob();

            // Parse items and get files
            const files = req.files || {};
            const items = JSON.parse(req.body.items || '[]');
            const allFiles = [...(files.file || []), ...(files.files || [])];

            console.log('🎯 Created new batch conversion job:', {
                jobId,
                totalFiles: allFiles.length,
                itemsCount: items.length,
                fileNames: allFiles.map(f => f.originalname)
            });

            // Send immediate response with job ID
            res.json({ jobId });

            // Start processing in background
            this.#processBatchInBackground(jobId, allFiles, items);
        } catch (error) {
            console.error('❌ Failed to start batch conversion job:', {
                error: error.message
            });
            next(new AppError(error.message, 500));
        }
    };

    #processBatchInBackground = async (jobId, files, items) => {
        const jobManager = global.server?.getJobManager();
        const startTime = Date.now();
        const initialMemory = process.memoryUsage();
        
        try {
            jobManager.updateJobStatus(jobId, 'preparing', 'Preparing batch conversion...');

            // Process file uploads
            const fileItems = files.map(file => {
                const fileType = this.#determineFileType(path.extname(file.originalname).slice(1), file.mimetype);
                return {
                    id: randomUUID(),
                    type: fileType,
                    content: file.buffer,
                    name: file.originalname,
                    mimeType: file.mimetype,
                    options: {
                        includeImages: true,
                        includeMeta: true,
                        convertLinks: true,
                        originalMimeType: file.mimetype
                    }
                };
            });

            // Process URL items
            const urlItems = items.map(item => ({
                id: randomUUID(),
                ...item,
                content: item.url,
                type: item.type.toLowerCase(),
                options: {
                    includeImages: true,
                    includeMeta: true,
                    convertLinks: true,
                    ...item.options
                }
            }));

            const allItems = [...fileItems, ...urlItems].map(item => ({
                ...item,
                options: {
                    ...item.options,
                    chunkSize: 50,
                    memoryLimit: 512 * 1024 * 1024,
                    streamProcessing: true,
                    onProgress: (progress) => {
                        // Calculate overall progress based on item's progress
                        const itemWeight = 1 / allItems.length;
                        const itemIndex = allItems.findIndex(i => i.id === item.id);
                        const baseProgress = (itemIndex * itemWeight) * 100;
                        const itemProgress = progress * itemWeight;
                        jobManager.updateJobProgress(jobId, Math.round(baseProgress + itemProgress));
                    }
                }
            }));

            jobManager.updateJobStatus(jobId, 'processing', 'Converting files...');
            const result = await this.conversionService.convertBatch(allItems);

            // Save result and generate download URL
            const downloadUrl = jobManager.generateDownloadUrl(jobId, result.filename);
            jobManager.saveJobResult(jobId, result.buffer, result.filename);

            const endMemory = process.memoryUsage();
            console.log('✅ Batch conversion completed:', {
                jobId,
                totalItems: allItems.length,
                duration: Math.round((Date.now() - startTime)/1000) + 's',
                memoryUsed: Math.round((endMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
            });

            // Complete job with download URL
            jobManager.completeJob(jobId, downloadUrl);

        } catch (error) {
            console.error('❌ Batch conversion failed:', {
                jobId,
                error: error.message,
                duration: Math.round((Date.now() - startTime)/1000) + 's'
            });
            jobManager.failJob(jobId, error);
        }
    };

  handleUrlConversion = async (req, res, next) => {
    try {
      // Get JobManager instance
      const jobManager = global.server?.getJobManager();
      if (!jobManager) {
        throw new AppError('Job manager not initialized', 500);
      }

      // Create new job
      const jobId = jobManager.createJob();
      console.log('🎯 Created new URL conversion job:', {
        jobId,
        url: req.body.url
      });

      // Send immediate response with job ID
      res.json({ jobId });

      // Start processing in background
      this.#processUrlInBackground(jobId, req.body);
    } catch (error) {
      console.error('❌ Failed to start URL conversion job:', {
        url: req.body.url,
        error: error.message
      });
      next(new AppError(error.message, 500));
    }
  };

  #processUrlInBackground = async (jobId, body) => {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();
    const jobManager = global.server?.getJobManager();

    try {
      jobManager.updateJobStatus(jobId, 'processing', 'Starting URL conversion...');

      console.log('🌐 Processing URL in background:', {
        jobId,
        url: body.url,
        initialMemory: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      // Run garbage collection if available
      if (global.gc && initialMemory.heapUsed > 512 * 1024 * 1024) {
        console.log('🧹 Running initial garbage collection');
        global.gc();
      }

      const data = {
        type: 'url',
        content: body.url,
        name: new URL(body.url).hostname,
        options: {
          ...body.options,
          streamProcessing: true,
          memoryLimit: 512 * 1024 * 1024,
          onProgress: (progress) => {
            jobManager.updateJobProgress(jobId, progress);
          }
        }
      };
      
      const result = await this.conversionService.convert(data);

      // Save result and generate download URL
      const downloadUrl = jobManager.generateDownloadUrl(jobId, result.filename);
      jobManager.saveJobResult(jobId, result.buffer, result.filename);

      const endMemory = process.memoryUsage();
      console.log('✅ URL conversion completed:', {
        jobId,
        url: body.url,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((endMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB',
        finalMemory: Math.round(endMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      // Complete job with download URL
      jobManager.completeJob(jobId, downloadUrl);

    } catch (error) {
      console.error('❌ URL conversion failed:', {
        jobId,
        url: body.url,
        error: error.message,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((process.memoryUsage().heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });

      jobManager.failJob(jobId, error);
    }
  };

  handleParentUrlConversion = async (req, res, next) => {
    try {
      // Get JobManager instance
      const jobManager = global.server?.getJobManager();
      if (!jobManager) {
        throw new AppError('Job manager not initialized', 500);
      }

      // Create new job
      const jobId = jobManager.createJob();
      console.log('🎯 Created new parent URL conversion job:', {
        jobId,
        url: req.body.parenturl
      });

      // Send immediate response with job ID
      res.json({ jobId });

      // Start processing in background
      this.#processParentUrlInBackground(jobId, req.body);
    } catch (error) {
      console.error('❌ Failed to start parent URL conversion job:', {
        url: req.body.parenturl,
        error: error.message
      });
      next(new AppError(error.message, 500));
    }
  };

  #processParentUrlInBackground = async (jobId, body) => {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();
    const jobManager = global.server?.getJobManager();

    try {
      jobManager.updateJobStatus(jobId, 'processing', 'Starting parent URL conversion...');

      console.log('🚀 Processing parent URL in background:', {
        jobId,
        url: body.parenturl,
        initialMemory: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      // Run garbage collection if available
      if (global.gc && initialMemory.heapUsed > 512 * 1024 * 1024) {
        console.log('🧹 Running initial garbage collection');
        global.gc();
      }

      const data = {
        type: 'parenturl',
        content: body.parenturl,
        name: new URL(body.parenturl).hostname,
        options: {
          ...body.options,
          chunkSize: 50, // Process URLs in chunks of 50
          memoryLimit: 512 * 1024 * 1024, // 512MB memory limit
          onProgress: (progress) => {
            jobManager.updateJobProgress(jobId, progress);
          }
        }
      };
      
      const result = await this.conversionService.convert(data);

      // Save result and generate download URL
      const downloadUrl = jobManager.generateDownloadUrl(jobId, result.filename);
      jobManager.saveJobResult(jobId, result.buffer, result.filename);

      const endMemory = process.memoryUsage();
      console.log('✅ Parent URL conversion completed:', {
        jobId,
        url: body.parenturl,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((endMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB',
        finalMemory: Math.round(endMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      // Complete job with download URL
      jobManager.completeJob(jobId, downloadUrl);

    } catch (error) {
      console.error('❌ Parent URL conversion failed:', {
        jobId,
        url: body.parenturl,
        error: error.message,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((process.memoryUsage().heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });

      jobManager.failJob(jobId, error);
    }
  };

    handleFileConversion = async (req, res, next) => {
        try {
            // Get JobManager instance
            const jobManager = global.server?.getJobManager();
            if (!jobManager) {
                throw new AppError('Job manager not initialized', 500);
            }

            // Create new job
            const jobId = jobManager.createJob();
            
            // Enhanced request logging with file signature info
            const fileSignature = req.file?.buffer?.slice(0, 4).toString('hex');
            console.log('📝 File conversion request:', {
                jobId,
                headers: {
                    'content-type': req.headers['content-type'],
                    'content-length': req.headers['content-length'],
                    'authorization': req.headers['authorization'] ? 'present' : 'missing'
                },
                file: req.file ? {
                    fieldname: req.file.fieldname,
                    originalname: req.file.originalname,
                    mimetype: req.file.mimetype,
                    size: req.file.buffer?.length,
                    signature: fileSignature,
                    extension: path.extname(req.file.originalname).slice(1).toLowerCase()
                } : null
            });

            // Send immediate response with job ID
            res.json({ jobId });

            // Start processing in background
            this.#processFileInBackground(jobId, req.file, req.body.options);
        } catch (error) {
            console.error('❌ Failed to start file conversion job:', {
                filename: req.file?.originalname,
                error: error.message
            });
            next(new AppError(error.message, 500));
        }
    };

    #processFileInBackground = async (jobId, file, rawOptions) => {
        const jobManager = global.server?.getJobManager();
        
        try {
            jobManager.updateJobStatus(jobId, 'validating', 'Validating file...');

            // Validate file data
            if (!file || !Buffer.isBuffer(file.buffer)) {
                throw new AppError('Invalid file data received', 400);
            }

            if (file.buffer.length === 0) {
                throw new AppError('Empty file received', 400);
            }

            // Parse options
            let options;
            try {
                options = rawOptions ? JSON.parse(rawOptions) : {};
            } catch (error) {
                throw new AppError('Invalid options format', 400);
            }

            // Create a fresh buffer copy and validate file type
            const fileBuffer = Buffer.from(file.buffer);
            const fileExtension = path.extname(file.originalname).slice(1).toLowerCase();
            const fileType = this.#determineFileType(fileExtension, file.mimetype);

            if (!fileType) {
                throw new AppError(`Unsupported file type: ${fileExtension}`, 400);
            }

            jobManager.updateJobStatus(jobId, 'processing', 'Converting file...');

            const conversionData = {
                type: fileType,
                content: fileBuffer,
                name: file.originalname,
                options: {
                    ...options,
                    originalMimeType: file.mimetype,
                    onProgress: (progress) => {
                        jobManager.updateJobProgress(jobId, progress);
                    }
                },
                mimeType: file.mimetype
            };

            const result = await this.conversionService.convert(conversionData);

            // Save result and generate download URL
            const downloadUrl = jobManager.generateDownloadUrl(jobId, result.filename);
            jobManager.saveJobResult(jobId, result.buffer, result.filename);

            // Complete job with download URL
            jobManager.completeJob(jobId, downloadUrl);

        } catch (error) {
            console.error('❌ File conversion failed:', {
                jobId,
                filename: file?.originalname,
                error: error.message
            });
            jobManager.failJob(jobId, error);
        }
    };

  handleAudioConversion = async (req, res, next) => {
    try {
      // Get JobManager instance
      const jobManager = global.server?.getJobManager();
      if (!jobManager) {
        throw new AppError('Job manager not initialized', 500);
      }

      // Create new job
      const jobId = jobManager.createJob();
      console.log('🎯 Created new audio conversion job:', {
        jobId,
        filename: req.file?.originalname
      });

      // Send immediate response with job ID
      res.json({ jobId });

      // Start processing in background
      this.#processAudioInBackground(jobId, req.file, req.body.options, req.headers);
    } catch (error) {
      console.error('❌ Failed to start audio conversion job:', {
        filename: req.file?.originalname,
        error: error.message
      });
      next(new AppError(error.message, 500));
    }
  };

  #processAudioInBackground = async (jobId, file, rawOptions, headers) => {
    const jobManager = global.server?.getJobManager();
    
    try {
      jobManager.updateJobStatus(jobId, 'validating', 'Validating audio file...');

      // Validate file data
      if (!file || !Buffer.isBuffer(file.buffer)) {
        throw new AppError('Invalid audio file data received', 400);
      }

      if (file.buffer.length === 0) {
        throw new AppError('Empty audio file received', 400);
      }

      // Parse options
      let options;
      try {
        options = rawOptions ? JSON.parse(rawOptions) : {};
      } catch (error) {
        throw new AppError('Invalid options format', 400);
      }

      // Ensure API key is present
      const apiKey = headers['x-api-key'] || headers['authorization']?.replace('Bearer ', '');
      if (!apiKey) {
        throw new AppError('API key is required for audio conversion', 401);
      }

      jobManager.updateJobStatus(jobId, 'processing', 'Converting audio...');

      const conversionData = {
        type: 'audio',
        content: file.buffer,
        mimeType: file.mimetype,
        name: file.originalname,
        apiKey,
        options: {
          ...options,
          streamProcessing: true,
          memoryLimit: 512 * 1024 * 1024,
          chunkSize: file.buffer.length > 50 * 1024 * 1024 ? 25 * 1024 * 1024 : undefined,
          onProgress: (progress) => {
            jobManager.updateJobProgress(jobId, progress);
          }
        }
      };

      const result = await this.conversionService.convert(conversionData);

      // Save result and generate download URL
      const downloadUrl = jobManager.generateDownloadUrl(jobId, result.filename);
      jobManager.saveJobResult(jobId, result.buffer, result.filename);

      // Complete job with download URL
      jobManager.completeJob(jobId, downloadUrl);

    } catch (error) {
      console.error('❌ Audio conversion failed:', {
        jobId,
        filename: file?.originalname,
        error: error.message
      });
      jobManager.failJob(jobId, error);
    }
  };

  handleVideoConversion = async (req, res, next) => {
    try {
      // Get JobManager instance
      const jobManager = global.server?.getJobManager();
      if (!jobManager) {
        throw new AppError('Job manager not initialized', 500);
      }

      // Create new job
      const jobId = jobManager.createJob();
      console.log('🎯 Created new video conversion job:', {
        jobId,
        filename: req.file?.originalname
      });

      // Send immediate response with job ID
      res.json({ jobId });

      // Start processing in background
      this.#processVideoInBackground(jobId, req.file, req.body.options, req.headers);
    } catch (error) {
      console.error('❌ Failed to start video conversion job:', {
        filename: req.file?.originalname,
        error: error.message
      });
      next(new AppError(error.message, 500));
    }
  };

  #processVideoInBackground = async (jobId, file, rawOptions, headers) => {
    const jobManager = global.server?.getJobManager();
    
    try {
      jobManager.updateJobStatus(jobId, 'validating', 'Validating video file...');

      // Validate file data
      if (!file || !Buffer.isBuffer(file.buffer)) {
        throw new AppError('Invalid video file data received', 400);
      }

      if (file.buffer.length === 0) {
        throw new AppError('Empty video file received', 400);
      }

      // Parse options
      let options;
      try {
        options = rawOptions ? JSON.parse(rawOptions) : {};
      } catch (error) {
        throw new AppError('Invalid options format', 400);
      }

      // Ensure API key is present
      const apiKey = headers['x-api-key'] || headers['authorization']?.replace('Bearer ', '');
      if (!apiKey) {
        throw new AppError('API key is required for video conversion', 401);
      }

      jobManager.updateJobStatus(jobId, 'processing', 'Converting video...');

      const conversionData = {
        type: 'video',
        content: file.buffer,
        mimeType: file.mimetype,
        name: file.originalname,
        apiKey,
        options: {
          ...options,
          streamProcessing: true,
          memoryLimit: 512 * 1024 * 1024,
          chunkSize: file.buffer.length > 50 * 1024 * 1024 ? 25 * 1024 * 1024 : undefined,
          onProgress: (progress) => {
            jobManager.updateJobProgress(jobId, progress);
          }
        }
      };

      const result = await this.conversionService.convert(conversionData);

      // Save result and generate download URL
      const downloadUrl = jobManager.generateDownloadUrl(jobId, result.filename);
      jobManager.saveJobResult(jobId, result.buffer, result.filename);

      // Complete job with download URL
      jobManager.completeJob(jobId, downloadUrl);

    } catch (error) {
      console.error('❌ Video conversion failed:', {
        jobId,
        filename: file?.originalname,
        error: error.message
      });
      jobManager.failJob(jobId, error);
    }
  };

  #extractConversionData(req) {
    try {
      const { type, url, options = {} } = req.body;
      
      if (!req.file && !url) {
        throw new Error('No file or URL provided');
      }

      // Handle file uploads
      if (req.file) {
        const extension = path.extname(req.file.originalname).toLowerCase().slice(1);
        const fileType = this.#determineFileType(extension, req.file.mimetype);
        
        console.log('File type determination:', {
          originalName: req.file.originalname,
          extension,
          mimetype: req.file.mimetype,
          determinedType: fileType
        });

        return {
          type: fileType,
          content: req.file.buffer,
          name: req.file.originalname,
          apiKey: req.headers['x-api-key'],
          options
        };
      }

      // Handle URL conversion
      return {
        type: type || 'url',
        content: url,
        name: url ? new URL(url).hostname : 'Untitled',
        apiKey: req.headers['x-api-key'],
        options
      };
    } catch (error) {
      console.error('Error extracting conversion data:', error);
      throw new AppError(`Invalid request: ${error.message}`, 400);
    }
  }

  #determineFileType(extension, mimetype) {
    const mimeTypeMap = {
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/msword': 'doc',
      'text/csv': 'csv',
      'application/csv': 'csv',
      'application/vnd.ms-excel': extension === 'csv' ? 'csv' : 'xlsx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/vnd.ms-powerpoint': 'pptx',
    };

    // Trust the extension for known document types
    if (['pptx', 'docx'].includes(extension.toLowerCase())) {
      return extension.toLowerCase();
    }

    // If extension is docx but mime type is pdf, trust the extension
    if (extension === 'docx' && mimetype === 'application/pdf') {
      console.log('Overriding PDF mime type for DOCX file');
      return 'docx';
    }

    // Special handling for CSV files
    if (extension === 'csv') {
      return 'csv';
    }

    // Otherwise use the mime type mapping or fall back to extension
    return mimeTypeMap[mimetype] || extension;
  }

  #extractBatchItems(req) {
    const { items = [] } = req.body;
    const fileItems = (req.files || []).map(file => ({
      type: 'file',
      content: file.buffer,
      name: file.originalname
    }));
    
    return [...items, ...fileItems];
  }

  #sendZipResponse(res, result) {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();

    try {
      // Handle different response types based on conversion result
      const contentType = result.type === 'markdown' ? 'text/markdown' : 'application/zip';
      const bufferSize = Math.round(result.buffer.length / (1024 * 1024));
      
      console.log('📤 Preparing response:', {
        type: result.type,
        filename: result.filename,
        contentType,
        sizeMB: bufferSize,
        initialMemory: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      // Run garbage collection if available before sending large responses
      if (global.gc && bufferSize > 100) { // If response is larger than 100MB
        console.log('🧹 Running pre-send garbage collection');
        global.gc();
      }

      // Set response headers
      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Content-Length': result.buffer.length,
        'Transfer-Encoding': bufferSize > 100 ? 'chunked' : undefined, // Use chunked encoding for large files
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });

      // Send the response
      res.send(result.buffer);

      const endMemory = process.memoryUsage();
      console.log('✅ Response sent successfully:', {
        type: result.type,
        filename: result.filename,
        sizeMB: bufferSize,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((endMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB',
        finalMemory: Math.round(endMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      // Run garbage collection after sending large responses
      if (global.gc && bufferSize > 100) {
        console.log('🧹 Running post-send garbage collection');
        global.gc();
      }
    } catch (error) {
      console.error('❌ Failed to send response:', {
        error: error.message,
        type: result.type,
        filename: result.filename,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((process.memoryUsage().heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });
      throw error; // Let the error handler deal with it
    }
  }
}
