"use strict";

/**
 * ConverterRegistry.js
 * 
 * Central registry for all file type converters in the Electron main process.
 * Provides a unified interface for accessing converters based on file type.
 * 
 * This file was created as part of the consolidation process to centralize
 * all converter functionality in the Electron main process.
 * 
 * Related files:
 * - src/electron/converters/UnifiedConverterFactory.js: Uses this registry for conversions
 * - src/electron/services/ElectronConversionService.js: References this registry
 * - src/electron/services/conversion/data/*.js: Data converters
 * - src/electron/services/conversion/document/*.js: Document converters
 * - src/electron/services/conversion/multimedia/*.js: Multimedia converters
 * - src/electron/services/conversion/web/*.js: Web converters
 */

const fs = require('fs-extra');
const path = require('path');
const {
  ipcMain
} = require('electron');

/**
 * Registry for all file type converters
 */
function ConverterRegistry() {
  this.converters = {};
  this.activeConversions = new Map(); // Global map to track all active conversions
  this.setupConverters();
  this.setupConversionValidation();

  // Clean up resources when the process exits
  process.on('exit', () => this.cleanup());
  process.on('SIGINT', () => {
    this.cleanup();
    process.exit(0);
  });
}

/**
 * Sets up periodic validation of active conversions to clean up stale ones.
 * This helps prevent memory leaks and resource issues by removing conversions
 * that haven't been updated recently.
 */
ConverterRegistry.prototype.setupConversionValidation = function () {
  // Set up interval to check for stale conversions every minute
  this.validationInterval = setInterval(() => {
    try {
      const now = Date.now();
      let staleCount = 0;

      // Check all active conversions
      Array.from(this.activeConversions.entries()).forEach(([id, conv]) => {
        // Consider a conversion stale if it hasn't pinged in the last 30 seconds
        if (now - conv.lastPing > 30000) {
          // Remove the stale conversion
          this.activeConversions.delete(id);
          staleCount++;

          // Log the removal
          console.warn(`[ConverterRegistry] Stale conversion ${id} removed (inactive for ${Math.round((now - conv.lastPing) / 1000)}s)`);

          // If the conversion has a cleanup function, call it
          if (typeof conv.cleanup === 'function') {
            try {
              conv.cleanup();
            } catch (cleanupError) {
              console.error(`[ConverterRegistry] Error cleaning up conversion ${id}:`, cleanupError);
            }
          }
        }
      });

      // Log summary if any stale conversions were removed
      if (staleCount > 0) {
        console.log(`[ConverterRegistry] Removed ${staleCount} stale conversions. Active conversions remaining: ${this.activeConversions.size}`);
      }
    } catch (error) {
      console.error('[ConverterRegistry] Error during conversion validation:', error);
    }
  }, 60000); // Run every 60 seconds
};

/**
 * Registers an active conversion with the registry.
 * @param {string} id - Unique identifier for the conversion
 * @param {Object} conversionData - Data about the conversion
 * @param {Function} [cleanup] - Optional cleanup function to call when the conversion is removed
 */
ConverterRegistry.prototype.registerConversion = function (id, conversionData, cleanup) {
  if (!id) {
    console.error('[ConverterRegistry] Cannot register conversion without ID');
    return;
  }
  this.activeConversions.set(id, {
    ...conversionData,
    lastPing: Date.now(),
    cleanup: cleanup
  });
  console.log(`[ConverterRegistry] Registered conversion ${id}. Total active: ${this.activeConversions.size}`);
};

/**
 * Updates the last ping time for an active conversion to keep it alive.
 * @param {string} id - Unique identifier for the conversion
 * @param {Object} [updates] - Optional updates to the conversion data
 * @returns {boolean} - Whether the conversion was found and updated
 */
ConverterRegistry.prototype.pingConversion = function (id, updates = {}) {
  const conversion = this.activeConversions.get(id);
  if (!conversion) {
    return false;
  }

  // Update the last ping time and any other provided updates
  this.activeConversions.set(id, {
    ...conversion,
    ...updates,
    lastPing: Date.now()
  });
  return true;
};

/**
 * Removes an active conversion from the registry.
 * @param {string} id - Unique identifier for the conversion
 * @returns {boolean} - Whether the conversion was found and removed
 */
ConverterRegistry.prototype.removeConversion = function (id) {
  const conversion = this.activeConversions.get(id);
  if (!conversion) {
    return false;
  }

  // If the conversion has a cleanup function, call it
  if (typeof conversion.cleanup === 'function') {
    try {
      conversion.cleanup();
    } catch (cleanupError) {
      console.error(`[ConverterRegistry] Error cleaning up conversion ${id}:`, cleanupError);
    }
  }

  // Remove the conversion
  this.activeConversions.delete(id);
  console.log(`[ConverterRegistry] Removed conversion ${id}. Total active: ${this.activeConversions.size}`);
  return true;
};

/**
 * Gets an active conversion from the registry.
 * @param {string} id - Unique identifier for the conversion
 * @returns {Object|null} - The conversion data or null if not found
 */
ConverterRegistry.prototype.getConversion = function (id) {
  return this.activeConversions.get(id) || null;
};

/**
 * Cleans up resources used by the registry.
 * This should be called when the application is shutting down.
 */
ConverterRegistry.prototype.cleanup = function () {
  // Clear the validation interval
  if (this.validationInterval) {
    clearInterval(this.validationInterval);
    this.validationInterval = null;
  }

  // Clean up all active conversions
  const conversionCount = this.activeConversions.size;
  if (conversionCount > 0) {
    console.log(`[ConverterRegistry] Cleaning up ${conversionCount} active conversions`);
    Array.from(this.activeConversions.entries()).forEach(([id, conv]) => {
      // If the conversion has a cleanup function, call it
      if (typeof conv.cleanup === 'function') {
        try {
          conv.cleanup();
        } catch (cleanupError) {
          console.error(`[ConverterRegistry] Error cleaning up conversion ${id}:`, cleanupError);
        }
      }
    });

    // Clear the map
    this.activeConversions.clear();
  }
  console.log('[ConverterRegistry] Cleanup complete');
};

/**
 * Register a converter for a specific file type
 * @param {string} type - File type (extension without dot)
 * @param {Object} converter - Converter implementation
 */
ConverterRegistry.prototype.register = function (type, converter) {
  this.converters[type] = converter;
  console.log(`Registered converter for ${type}`);
};

/**
 * Get converter by file extension
 * @param {string} extension - File extension (with or without dot)
 * @returns {Object|null} Converter or null if not found
 */
ConverterRegistry.prototype.getConverterByExtension = function (extension) {
  // Normalize extension (remove dot, lowercase)
  const normalizedExt = extension.toLowerCase().replace(/^\./, '');
  return this.converters[normalizedExt] || null;
};

/**
 * Get converter by MIME type
 * @param {string} mimeType - MIME type
 * @returns {Object|null} Converter or null if not found
 */
ConverterRegistry.prototype.getConverterByMimeType = function (mimeType) {
  // Find converter that supports this MIME type
  for (const [type, converter] of Object.entries(this.converters)) {
    if (converter.config && converter.config.mimeTypes && converter.config.mimeTypes.includes(mimeType)) {
      return converter;
    }
  }
  return null;
};

/**
 * Convert content to markdown using appropriate converter
 * @param {string} type - File type
 * @param {Buffer|string} content - Content to convert
 * @param {Object} options - Conversion options
 * @returns {Promise<Object>} Conversion result
 */
ConverterRegistry.prototype.convertToMarkdown = async function (type, content, options) {
  options = options || {};
  const converter = this.getConverterByExtension(type);
  if (!converter) {
    throw new Error(`No converter found for type: ${type}`);
  }
  return await converter.convert(content, options.name || 'file', options.apiKey, options);
};

/**
 * Setup all available converters
 */
ConverterRegistry.prototype.setupConverters = function () {
  try {
    // Import converters from the new location
    const CsvConverter = require('./data/CsvConverter');
    const XlsxConverter = require('./data/XlsxConverter');
    const AudioConverter = require('./multimedia/AudioConverter');
    const VideoConverter = require('./multimedia/VideoConverter');
    const PdfFactory = require('./document/PdfConverterFactory');
    const DocxConverter = require('./document/DocxConverter');
    const PptxConverter = require('./document/PptxConverter');
    const UrlConverter = require('./web/UrlConverter');
    const ParentUrlConverter = require('./web/ParentUrlConverter');

    // Import singleton service instances
    const fileProcessorServiceInstance = require('../storage/FileProcessorService');
    const fileStorageServiceInstance = require('../storage/FileStorageService');
    const transcriberServiceInstance = require('../ai/TranscriberService');
    // OpenAIProxyService singleton is already imported by TranscriberService

    // Create instances of converter classes, passing singleton dependencies
    const csvConverterInstance = new CsvConverter();
    const xlsxConverterInstance = new XlsxConverter();
    // Pass the singleton instances to the constructors
    const audioConverterInstance = new AudioConverter(fileProcessorServiceInstance, transcriberServiceInstance, fileStorageServiceInstance);
    // Pass the registry instance (this) to the VideoConverter constructor
    const videoConverterInstance = new VideoConverter(this, fileProcessorServiceInstance, transcriberServiceInstance, fileStorageServiceInstance);
    const pdfConverterFactory = new PdfFactory();
    const docxConverterInstance = new DocxConverter();
    const pptxConverterInstance = new PptxConverter();

    // Instantiate URL converters with singleton dependencies (or mocks if appropriate)
    // Note: URL converters might not need the full file services, using mocks might still be okay here
    // Using singletons for consistency, but could revert to mocks if needed.
    const urlConverterInstance = new UrlConverter(fileProcessorServiceInstance, fileStorageServiceInstance);
    const parentUrlConverterInstance = new ParentUrlConverter(fileProcessorServiceInstance, fileStorageServiceInstance);

    // Create standardized adapter for DOCX converter using the actual implementation
    this.register('docx', {
      convert: async (content, name, apiKey, options) => {
        try {
          console.log(`[DocxAdapter] Converting DOCX file: ${name}`);

          // Ensure content is a Buffer
          if (!Buffer.isBuffer(content)) {
            throw new Error('DOCX content must be a Buffer');
          }

          // Use the actual DocxConverter implementation
          const result = await docxConverterInstance.convertToMarkdown(content, {
            ...options,
            fileName: name,
            apiKey
          });

          // Ensure we have content
          if (!result || typeof result !== 'string' || result.trim() === '') {
            throw new Error('DOCX conversion produced empty content');
          }
          return {
            success: true,
            content: result,
            name: name,
            type: 'docx'
          };
        } catch (error) {
          console.error(`[DocxAdapter] Error converting DOCX: ${error.message}`);
          throw new Error(`DOCX conversion failed: ${error.message}`);
        }
      },
      validate: content => Buffer.isBuffer(content) && content.length > 0,
      config: {
        name: 'DOCX Converter',
        extensions: ['.docx', '.doc'],
        mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'],
        maxSize: 100 * 1024 * 1024 // 100MB
      }
    });

    // Create standardized adapter for PPTX converter using the actual implementation
    this.register('pptx', {
      convert: async (content, name, apiKey, options) => {
        try {
          console.log(`[PptxAdapter] Converting PPTX file: ${name}`);

          // Ensure content is a Buffer
          if (!Buffer.isBuffer(content)) {
            throw new Error('PPTX content must be a Buffer');
          }

          // Use the actual PptxConverter implementation
          const result = await pptxConverterInstance.convertToMarkdown(content, {
            ...options,
            fileName: name,
            apiKey
          });

          // Ensure we have content
          if (!result || typeof result !== 'string' || result.trim() === '') {
            throw new Error('PPTX conversion produced empty content');
          }
          return {
            success: true,
            content: result,
            name: name,
            type: 'pptx'
          };
        } catch (error) {
          console.error(`[PptxAdapter] Error converting PPTX: ${error.message}`);
          throw new Error(`PPTX conversion failed: ${error.message}`);
        }
      },
      validate: content => Buffer.isBuffer(content) && content.length > 0,
      config: {
        name: 'PPTX Converter',
        extensions: ['.pptx', '.ppt'],
        mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint'],
        maxSize: 100 * 1024 * 1024 // 100MB
      }
    });

    // Create standardized adapter for the CSV converter
    this.register('csv', {
      convert: async (content, name, apiKey, options) => {
        try {
          console.log(`[CsvAdapter] Converting CSV file: ${name}`);

          // Convert the content to string
          const contentStr = content.toString();

          // Use the actual CsvConverter implementation
          const result = await csvConverterInstance.convertToMarkdown(contentStr, {
            ...options,
            name,
            originalFileName: name // Pass the original filename
          });

          // Ensure we have content
          if (!result || typeof result !== 'string' || result.trim() === '') {
            throw new Error('CSV conversion produced empty content');
          }
          return {
            success: true,
            content: result,
            name: name,
            type: 'csv'
          };
        } catch (error) {
          console.error(`[CsvAdapter] Error converting CSV: ${error.message}`);
          throw new Error(`CSV conversion failed: ${error.message}`);
        }
      },
      validate: content => Buffer.isBuffer(content) && content.length > 0,
      config: {
        name: 'CSV Converter',
        extensions: ['.csv'],
        mimeTypes: ['text/csv'],
        maxSize: 100 * 1024 * 1024 // 100MB
      }
    });

    // Create standardized adapter for the XLSX converter
    this.register('xlsx', {
      convert: async (content, name, apiKey, options) => {
        try {
          console.log(`[XlsxAdapter] Converting Excel file: ${name}`);

          // Ensure content is a Buffer
          if (!Buffer.isBuffer(content)) {
            throw new Error('Excel content must be a Buffer');
          }

          // Read the Excel file using xlsx library
          const xlsx = require('xlsx');
          let workbook;
          try {
            // Create a temporary file to read the Excel content
            const fs = require('fs-extra');
            const os = require('os');
            const path = require('path');
            const tempDir = path.join(os.tmpdir(), `xlsx_conversion_${Date.now()}`);
            await fs.ensureDir(tempDir);
            const tempFile = path.join(tempDir, `${name}_${Date.now()}.xlsx`);
            await fs.writeFile(tempFile, content);

            // Read the Excel file
            workbook = xlsx.readFile(tempFile, {
              cellDates: true,
              ...(options.xlsxOptions || {})
            });

            // Clean up temp file
            await fs.remove(tempDir);
          } catch (readError) {
            console.error(`[XlsxAdapter] Failed to read Excel file: ${name}`, readError);
            throw new Error(`Failed to read Excel file: ${readError.message}`);
          }
          // Use the actual XlsxConverter implementation
          const result = await xlsxConverterInstance.convertToMarkdown(workbook, {
            ...options,
            name,
            originalFileName: name // Pass the original filename
          });

          // Ensure we have content
          if (!result || typeof result !== 'string' || result.trim() === '') {
            throw new Error('Excel conversion produced empty content');
          }
          return {
            success: true,
            content: result,
            name: name,
            type: 'xlsx'
          };
        } catch (error) {
          console.error(`[XlsxAdapter] Error converting Excel: ${error.message}`);
          throw new Error(`Excel conversion failed: ${error.message}`);
        }
      },
      validate: content => Buffer.isBuffer(content) && content.length > 0,
      config: {
        name: 'Excel Converter',
        extensions: ['.xlsx', '.xls'],
        mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
        maxSize: 100 * 1024 * 1024 // 100MB
      }
    });

    // Create standardized adapter for audio converters
    // Create standardized adapter for audio converters
    const audioAdapter = {
      convert: async (content, name, apiKey, options) => {
        try {
          console.log(`[AudioAdapter] Converting audio file: ${name}`);

          // Ensure content is a Buffer
          if (!Buffer.isBuffer(content)) {
            throw new Error('Audio content must be a Buffer');
          }

          // Create a temporary file to process the audio using the singleton service
          const tempDir = await fileStorageServiceInstance.createTempDir('audio_conversion');
          const tempFile = path.join(tempDir, `${name}_${Date.now()}.mp3`);
          await fs.writeFile(tempFile, content);

          // Process the audio file using the AudioConverter
          const result = await audioConverterInstance.processConversion(`audio_${Date.now()}`, tempFile, {
            ...options,
            transcribe: options.transcribe !== false,
            language: options.language || 'en',
            title: options.title || name
          });

          // Clean up temp file
          await fs.remove(tempDir);

          // Return the conversion result
          return {
            success: true,
            content: result,
            name: name,
            type: 'audio'
          };
        } catch (error) {
          console.error(`[AudioAdapter] Error converting audio: ${error.message}`);
          throw new Error(`Audio conversion failed: ${error.message}`);
        }
      },
      validate: content => Buffer.isBuffer(content) && content.length > 0,
      config: {
        name: 'Audio Converter',
        extensions: ['.mp3', '.wav', '.ogg', '.m4a', '.mpga'],
        mimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a'],
        maxSize: 100 * 1024 * 1024 // 100MB
      }
    };
    this.register('mp3', audioAdapter);
    this.register('wav', audioAdapter);

    // Register ppt extension to use the same converter as pptx
    this.register('ppt', this.converters['pptx']);

    // --- Removed Video Adapter ---
    // The VideoConverter instance itself will handle IPC calls via its BaseService methods
    // Register the VideoConverter instance directly for relevant extensions
    const videoConverterConfig = {
      name: 'Video Converter',
      extensions: ['.mp4', '.webm', '.mov', '.avi'],
      mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'],
      maxSize: 500 * 1024 * 1024 // 500MB
    };

    // We need a wrapper here if the IPC handler expects a specific 'convert' function signature
    // Or, ideally, the IPC handler should call the appropriate method on the service instance
    // For now, let's assume the IPC handler can call `videoConverterInstance.handleConvert`
    // If not, we'd need an adapter similar to the others, but calling handleConvert
    // Let's register the instance directly for now, assuming IPC routing handles it.
    // If errors occur, we might need to re-introduce a simple adapter.
    const videoConverterWrapper = {
      // This 'convert' method acts as an adapter if the calling code
      // (like UnifiedConverterFactory) expects a simple convert function.
      // It simulates the necessary parts of an IPC call to trigger the
      // VideoConverter's internal handling logic via handleConvert.
      convert: async (content, name, apiKey, options) => {
        console.log("[ConverterRegistry] VideoConverterWrapper 'convert' called. Simulating IPC call to handleConvert.");
        try {
          // Create a temporary file for the video content
          // The original videoAdapter did this, and handleConvert expects a file path
          let tempDir;
          let tempFile;

          // Check if content is a Buffer (which is what we expect from UnifiedConverterFactory)
          if (Buffer.isBuffer(content)) {
            console.log(`[VideoConverterWrapper] Content is a Buffer of size: ${content.length} bytes`);

            // Create a temporary directory for this conversion
            tempDir = await fileStorageServiceInstance.createTempDir('video_conversion');
            console.log(`[VideoConverterWrapper] Created temp directory: ${tempDir}`);

            // Write the buffer to a temporary file
            tempFile = path.join(tempDir, `${name}_${Date.now()}.mp4`);
            console.log(`[VideoConverterWrapper] Writing video content to temp file: ${tempFile}`);
            await fs.writeFile(tempFile, content);

            // Verify the temp file was created successfully
            const tempFileExists = await fs.pathExists(tempFile);
            const tempFileStats = tempFileExists ? await fs.stat(tempFile) : null;
            console.log(`[VideoConverterWrapper] Temp file created: ${tempFileExists}, size: ${tempFileStats ? tempFileStats.size : 'N/A'} bytes`);
            if (!tempFileExists || tempFileStats && tempFileStats.size === 0) {
              throw new Error('Failed to write video content to temporary file');
            }
          } else if (typeof content === 'string') {
            // If content is already a string (file path), use it directly
            console.log(`[VideoConverterWrapper] Content is a file path: ${content}`);
            tempFile = content;
          } else {
            // If content is neither a Buffer nor a string, throw an error
            console.error("[VideoConverterWrapper] Unexpected content type:", typeof content);
            throw new Error(`VideoConverterWrapper requires buffer or file path, received: ${typeof content}`);
          }

          // Simulate the event object minimally or pass null
          const mockEvent = null; // Or { sender: { getOwnerBrowserWindow: () => null } } if needed

          // Call the instance's handleConvert method with the temp file path
          console.log(`[VideoConverterWrapper] Calling handleConvert with file path: ${tempFile}`);
          const result = await videoConverterInstance.handleConvert(mockEvent, {
            filePath: tempFile,
            options: {
              ...options,
              apiKey,
              // Pass the tempDir so it can be cleaned up properly
              _tempDir: tempDir
            }
          });

          // Note: The VideoConverter will handle cleanup of the temp directory
          // through the registry's conversion tracking and cleanup mechanism

          // Return an object indicating the process started
          return {
            success: true,
            conversionId: result.conversionId,
            async: true,
            name: name,
            type: 'video'
          };
        } catch (error) {
          console.error(`[VideoConverterWrapper] Error in convert:`, error);
          throw new Error(`Video conversion failed: ${error.message}`);
        }
      },
      validate: content => Buffer.isBuffer(content) && content.length > 0,
      // Validation might need adjustment if content is path
      config: videoConverterConfig,
      // Store the actual instance so it can be accessed if needed by the caller
      instance: videoConverterInstance
    };
    this.register('mp4', videoConverterWrapper);
    this.register('webm', videoConverterWrapper);
    this.register('mov', videoConverterWrapper);
    this.register('avi', videoConverterWrapper);

    // Register the PDF factory adapter with proper implementation
    this.register('pdf', {
      convert: async (content, name, apiKey, options) => {
        try {
          console.log("[PdfAdapter] Converting PDF document");

          // Create temp directory for conversion using the singleton service
          const tempDir = await fileStorageServiceInstance.createTempDir('pdf_conversion');

          // Ensure the directory exists
          await fs.ensureDir(tempDir);
          const tempFile = path.join(tempDir, `document_${Date.now()}.pdf`);

          // Write buffer to temp file
          await fs.writeFile(tempFile, content);

          // Verify the file was written successfully
          if (!(await fs.pathExists(tempFile))) {
            throw new Error(`Failed to write temporary PDF file: ${tempFile}`);
          }
          try {
            // Determine if OCR should be used
            // Determine if OCR should be used
            const useOcr = options.useOcr === true && options.mistralApiKey;

            // Create appropriate converter
            let result;
            if (useOcr) {
              console.log('[ConverterRegistry] Using Mistral OCR converter for PDF conversion');
              // Use Mistral OCR converter - require it directly to ensure it's in scope
              // Pass true for skipHandlerSetup to avoid duplicate IPC handler registration
              // Pass singleton services
              const MistralPdfConverterClass = require('./document/MistralPdfConverter');
              const mistralConverter = new MistralPdfConverterClass(fileProcessorServiceInstance, fileStorageServiceInstance, null, true);
              // Set the API key
              mistralConverter.apiKey = options.mistralApiKey;
              console.log('[ConverterRegistry] Mistral API key set for OCR conversion');
              result = await mistralConverter.convertToMarkdown(content, {
                ...options,
                fileName: name,
                name: name,
                apiKey: options.mistralApiKey
              });
            } else {
              // Use standard converter - require it directly to ensure it's in scope
              // Pass true for skipHandlerSetup to avoid duplicate IPC handler registration
              // Pass singleton services
              console.log('[ConverterRegistry] Using standard PDF converter');
              const StandardPdfConverterClass = require('./document/StandardPdfConverter');
              const standardConverter = new StandardPdfConverterClass(fileProcessorServiceInstance, fileStorageServiceInstance, true);
              result = await standardConverter.convertToMarkdown(content, {
                ...options,
                fileName: name
              });
            }

            // Clean up temp directory
            await fs.remove(tempDir);

            // Ensure result has success flag and content
            if (!result.success) {
              throw new Error(result.error || 'PDF conversion failed with no specific error');
            }
            if (!result.content || typeof result.content !== 'string' || result.content.trim() === '') {
              throw new Error('PDF conversion produced empty content');
            }
            return result;
          } catch (error) {
            // Clean up temp directory
            await fs.remove(tempDir);

            // Re-throw error
            throw error;
          }
        } catch (error) {
          console.error(`[PdfAdapter] Error converting PDF: ${error.message}`);
          throw new Error(`PDF conversion failed: ${error.message}`);
        }
      },
      validate: content => Buffer.isBuffer(content) && content.length > 0,
      config: {
        name: 'PDF Converter',
        extensions: ['.pdf'],
        mimeTypes: ['application/pdf'],
        maxSize: 100 * 1024 * 1024 // 100MB
      }
    });

    // Create standardized adapter for URL converter using the actual implementation
    this.register('url', {
      convert: async (content, name, apiKey, options) => {
        // URL converter expects the content to be the URL string
        try {
          console.log(`[UrlAdapter] Converting URL: ${content}`);

          // Create temporary directory for the conversion using the singleton service
          const tempDir = await fileStorageServiceInstance.createTempDir('url_conversion');

          // Launch a browser instance for the conversion
          const puppeteer = require('puppeteer');
          const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
          });
          try {
            // Fetch metadata
            const metadata = await urlConverterInstance.fetchMetadata(content, browser);

            // Extract content
            const extractedContent = await urlConverterInstance.extractContent(content, options, browser);

            // Process images if requested
            if (options.includeImages) {
              await urlConverterInstance.processImages(extractedContent, tempDir, content, browser);
            }

            // Generate markdown
            const markdown = urlConverterInstance.generateMarkdown(metadata, extractedContent, null, options);

            // Close browser
            await browser.close();

            // Clean up temporary directory
            await fs.remove(tempDir);
            return {
              success: true,
              content: markdown,
              name: name,
              type: 'url'
            };
          } catch (error) {
            // Close browser on error
            await browser.close();

            // Clean up temporary directory
            await fs.remove(tempDir);

            // Re-throw error
            throw error;
          }
        } catch (error) {
          console.error(`[UrlAdapter] Error converting URL: ${error.message}`);
          throw new Error(`URL conversion failed: ${error.message}`);
        }
      },
      validate: content => typeof content === 'string' && content.length > 0,
      config: {
        name: 'URL Converter',
        extensions: ['.url', '.html', '.htm'],
        mimeTypes: ['text/html', 'application/x-url'],
        maxSize: 10 * 1024 * 1024 // 10MB
      }
    });

    // Create standardized adapter for ParentURL converter using the actual implementation
    this.register('parenturl', {
      convert: async (content, name, apiKey, options) => {
        // For URL converters, content is the URL string itself
        try {
          console.log(`[ParentUrlAdapter] Converting site: ${content}`);

          // Create temporary directory for the conversion using the singleton service
          const tempDir = await fileStorageServiceInstance.createTempDir('parent_url_conversion');

          // Launch a browser instance for the conversion
          const puppeteer = require('puppeteer');
          const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
          });
          try {
            // Discover sitemap
            const sitemap = await parentUrlConverterInstance.discoverSitemap(content, options, browser);

            // Process each page
            const maxPages = options.maxPages || Math.min(sitemap.pages.length, 10);
            const pagesToProcess = sitemap.pages.slice(0, maxPages);
            const processedPages = [];
            for (const page of pagesToProcess) {
              // Process page
              const pageContent = await parentUrlConverterInstance.processPage(page.url, options, browser, tempDir);

              // Add to processed pages
              processedPages.push({
                url: page.url,
                title: page.title,
                content: pageContent
              });
            }

            // Generate combined markdown
            const markdown = parentUrlConverterInstance.generateCombinedMarkdown(sitemap, processedPages, options);

            // Close browser
            await browser.close();

            // Clean up temporary directory
            await fs.remove(tempDir);
            return {
              success: true,
              content: markdown,
              name: name,
              type: 'parenturl'
            };
          } catch (error) {
            // Close browser on error
            await browser.close();

            // Clean up temporary directory
            await fs.remove(tempDir);

            // Re-throw error
            throw error;
          }
        } catch (error) {
          console.error(`[ParentUrlAdapter] Error converting site: ${error.message}`);
          throw new Error(`Site conversion failed: ${error.message}`);
        }
      },
      validate: content => typeof content === 'string' && content.length > 0,
      config: {
        name: 'Website Converter',
        extensions: ['.url', '.html', '.htm'],
        mimeTypes: ['text/html', 'application/x-url'],
        maxSize: 10 * 1024 * 1024 // 10MB
      }
    });
    const registeredTypes = Object.keys(this.converters);
    console.log(`✅ Converters registered successfully: ${registeredTypes.length} types`);
    console.log(`📋 Registered types: ${registeredTypes.join(', ')}`);
  } catch (error) {
    console.error('❌ Error setting up converters:', error);
    // Add detailed error logging
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    // Throw the error to be handled by the caller
    throw new Error(`Failed to set up converters: ${error.message}`);
  }
};

// Create and export singleton instance
var registry = new ConverterRegistry();
module.exports = registry;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJwYXRoIiwiaXBjTWFpbiIsIkNvbnZlcnRlclJlZ2lzdHJ5IiwiY29udmVydGVycyIsImFjdGl2ZUNvbnZlcnNpb25zIiwiTWFwIiwic2V0dXBDb252ZXJ0ZXJzIiwic2V0dXBDb252ZXJzaW9uVmFsaWRhdGlvbiIsInByb2Nlc3MiLCJvbiIsImNsZWFudXAiLCJleGl0IiwicHJvdG90eXBlIiwidmFsaWRhdGlvbkludGVydmFsIiwic2V0SW50ZXJ2YWwiLCJub3ciLCJEYXRlIiwic3RhbGVDb3VudCIsIkFycmF5IiwiZnJvbSIsImVudHJpZXMiLCJmb3JFYWNoIiwiaWQiLCJjb252IiwibGFzdFBpbmciLCJkZWxldGUiLCJjb25zb2xlIiwid2FybiIsIk1hdGgiLCJyb3VuZCIsImNsZWFudXBFcnJvciIsImVycm9yIiwibG9nIiwic2l6ZSIsInJlZ2lzdGVyQ29udmVyc2lvbiIsImNvbnZlcnNpb25EYXRhIiwic2V0IiwicGluZ0NvbnZlcnNpb24iLCJ1cGRhdGVzIiwiY29udmVyc2lvbiIsImdldCIsInJlbW92ZUNvbnZlcnNpb24iLCJnZXRDb252ZXJzaW9uIiwiY2xlYXJJbnRlcnZhbCIsImNvbnZlcnNpb25Db3VudCIsImNsZWFyIiwicmVnaXN0ZXIiLCJ0eXBlIiwiY29udmVydGVyIiwiZ2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJleHRlbnNpb24iLCJub3JtYWxpemVkRXh0IiwidG9Mb3dlckNhc2UiLCJyZXBsYWNlIiwiZ2V0Q29udmVydGVyQnlNaW1lVHlwZSIsIm1pbWVUeXBlIiwiT2JqZWN0IiwiY29uZmlnIiwibWltZVR5cGVzIiwiaW5jbHVkZXMiLCJjb252ZXJ0VG9NYXJrZG93biIsImNvbnRlbnQiLCJvcHRpb25zIiwiRXJyb3IiLCJjb252ZXJ0IiwibmFtZSIsImFwaUtleSIsIkNzdkNvbnZlcnRlciIsIlhsc3hDb252ZXJ0ZXIiLCJBdWRpb0NvbnZlcnRlciIsIlZpZGVvQ29udmVydGVyIiwiUGRmRmFjdG9yeSIsIkRvY3hDb252ZXJ0ZXIiLCJQcHR4Q29udmVydGVyIiwiVXJsQ29udmVydGVyIiwiUGFyZW50VXJsQ29udmVydGVyIiwiZmlsZVByb2Nlc3NvclNlcnZpY2VJbnN0YW5jZSIsImZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlIiwidHJhbnNjcmliZXJTZXJ2aWNlSW5zdGFuY2UiLCJjc3ZDb252ZXJ0ZXJJbnN0YW5jZSIsInhsc3hDb252ZXJ0ZXJJbnN0YW5jZSIsImF1ZGlvQ29udmVydGVySW5zdGFuY2UiLCJ2aWRlb0NvbnZlcnRlckluc3RhbmNlIiwicGRmQ29udmVydGVyRmFjdG9yeSIsImRvY3hDb252ZXJ0ZXJJbnN0YW5jZSIsInBwdHhDb252ZXJ0ZXJJbnN0YW5jZSIsInVybENvbnZlcnRlckluc3RhbmNlIiwicGFyZW50VXJsQ29udmVydGVySW5zdGFuY2UiLCJCdWZmZXIiLCJpc0J1ZmZlciIsInJlc3VsdCIsImZpbGVOYW1lIiwidHJpbSIsInN1Y2Nlc3MiLCJtZXNzYWdlIiwidmFsaWRhdGUiLCJsZW5ndGgiLCJleHRlbnNpb25zIiwibWF4U2l6ZSIsImNvbnRlbnRTdHIiLCJ0b1N0cmluZyIsIm9yaWdpbmFsRmlsZU5hbWUiLCJ4bHN4Iiwid29ya2Jvb2siLCJvcyIsInRlbXBEaXIiLCJqb2luIiwidG1wZGlyIiwiZW5zdXJlRGlyIiwidGVtcEZpbGUiLCJ3cml0ZUZpbGUiLCJyZWFkRmlsZSIsImNlbGxEYXRlcyIsInhsc3hPcHRpb25zIiwicmVtb3ZlIiwicmVhZEVycm9yIiwiYXVkaW9BZGFwdGVyIiwiY3JlYXRlVGVtcERpciIsInByb2Nlc3NDb252ZXJzaW9uIiwidHJhbnNjcmliZSIsImxhbmd1YWdlIiwidGl0bGUiLCJ2aWRlb0NvbnZlcnRlckNvbmZpZyIsInZpZGVvQ29udmVydGVyV3JhcHBlciIsInRlbXBGaWxlRXhpc3RzIiwicGF0aEV4aXN0cyIsInRlbXBGaWxlU3RhdHMiLCJzdGF0IiwibW9ja0V2ZW50IiwiaGFuZGxlQ29udmVydCIsImZpbGVQYXRoIiwiX3RlbXBEaXIiLCJjb252ZXJzaW9uSWQiLCJhc3luYyIsImluc3RhbmNlIiwidXNlT2NyIiwibWlzdHJhbEFwaUtleSIsIk1pc3RyYWxQZGZDb252ZXJ0ZXJDbGFzcyIsIm1pc3RyYWxDb252ZXJ0ZXIiLCJTdGFuZGFyZFBkZkNvbnZlcnRlckNsYXNzIiwic3RhbmRhcmRDb252ZXJ0ZXIiLCJwdXBwZXRlZXIiLCJicm93c2VyIiwibGF1bmNoIiwiaGVhZGxlc3MiLCJhcmdzIiwibWV0YWRhdGEiLCJmZXRjaE1ldGFkYXRhIiwiZXh0cmFjdGVkQ29udGVudCIsImV4dHJhY3RDb250ZW50IiwiaW5jbHVkZUltYWdlcyIsInByb2Nlc3NJbWFnZXMiLCJtYXJrZG93biIsImdlbmVyYXRlTWFya2Rvd24iLCJjbG9zZSIsInNpdGVtYXAiLCJkaXNjb3ZlclNpdGVtYXAiLCJtYXhQYWdlcyIsIm1pbiIsInBhZ2VzIiwicGFnZXNUb1Byb2Nlc3MiLCJzbGljZSIsInByb2Nlc3NlZFBhZ2VzIiwicGFnZSIsInBhZ2VDb250ZW50IiwicHJvY2Vzc1BhZ2UiLCJ1cmwiLCJwdXNoIiwiZ2VuZXJhdGVDb21iaW5lZE1hcmtkb3duIiwicmVnaXN0ZXJlZFR5cGVzIiwia2V5cyIsInN0YWNrIiwicmVnaXN0cnkiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIENvbnZlcnRlclJlZ2lzdHJ5LmpzXHJcbiAqIFxyXG4gKiBDZW50cmFsIHJlZ2lzdHJ5IGZvciBhbGwgZmlsZSB0eXBlIGNvbnZlcnRlcnMgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogUHJvdmlkZXMgYSB1bmlmaWVkIGludGVyZmFjZSBmb3IgYWNjZXNzaW5nIGNvbnZlcnRlcnMgYmFzZWQgb24gZmlsZSB0eXBlLlxyXG4gKiBcclxuICogVGhpcyBmaWxlIHdhcyBjcmVhdGVkIGFzIHBhcnQgb2YgdGhlIGNvbnNvbGlkYXRpb24gcHJvY2VzcyB0byBjZW50cmFsaXplXHJcbiAqIGFsbCBjb252ZXJ0ZXIgZnVuY3Rpb25hbGl0eSBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBcclxuICogUmVsYXRlZCBmaWxlczpcclxuICogLSBzcmMvZWxlY3Ryb24vY29udmVydGVycy9VbmlmaWVkQ29udmVydGVyRmFjdG9yeS5qczogVXNlcyB0aGlzIHJlZ2lzdHJ5IGZvciBjb252ZXJzaW9uc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9FbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmpzOiBSZWZlcmVuY2VzIHRoaXMgcmVnaXN0cnlcclxuICogLSBzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kYXRhLyouanM6IERhdGEgY29udmVydGVyc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL2RvY3VtZW50LyouanM6IERvY3VtZW50IGNvbnZlcnRlcnNcclxuICogLSBzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9tdWx0aW1lZGlhLyouanM6IE11bHRpbWVkaWEgY29udmVydGVyc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL3dlYi8qLmpzOiBXZWIgY29udmVydGVyc1xyXG4gKi9cclxuXHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgeyBpcGNNYWluIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5cclxuLyoqXHJcbiAqIFJlZ2lzdHJ5IGZvciBhbGwgZmlsZSB0eXBlIGNvbnZlcnRlcnNcclxuICovXHJcbmZ1bmN0aW9uIENvbnZlcnRlclJlZ2lzdHJ5KCkge1xyXG4gICAgdGhpcy5jb252ZXJ0ZXJzID0ge307XHJcbiAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zID0gbmV3IE1hcCgpOyAvLyBHbG9iYWwgbWFwIHRvIHRyYWNrIGFsbCBhY3RpdmUgY29udmVyc2lvbnNcclxuICAgIHRoaXMuc2V0dXBDb252ZXJ0ZXJzKCk7XHJcbiAgICB0aGlzLnNldHVwQ29udmVyc2lvblZhbGlkYXRpb24oKTtcclxuICAgIFxyXG4gICAgLy8gQ2xlYW4gdXAgcmVzb3VyY2VzIHdoZW4gdGhlIHByb2Nlc3MgZXhpdHNcclxuICAgIHByb2Nlc3Mub24oJ2V4aXQnLCAoKSA9PiB0aGlzLmNsZWFudXAoKSk7XHJcbiAgICBwcm9jZXNzLm9uKCdTSUdJTlQnLCAoKSA9PiB7XHJcbiAgICAgICAgdGhpcy5jbGVhbnVwKCk7XHJcbiAgICAgICAgcHJvY2Vzcy5leGl0KDApO1xyXG4gICAgfSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBTZXRzIHVwIHBlcmlvZGljIHZhbGlkYXRpb24gb2YgYWN0aXZlIGNvbnZlcnNpb25zIHRvIGNsZWFuIHVwIHN0YWxlIG9uZXMuXHJcbiAqIFRoaXMgaGVscHMgcHJldmVudCBtZW1vcnkgbGVha3MgYW5kIHJlc291cmNlIGlzc3VlcyBieSByZW1vdmluZyBjb252ZXJzaW9uc1xyXG4gKiB0aGF0IGhhdmVuJ3QgYmVlbiB1cGRhdGVkIHJlY2VudGx5LlxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLnNldHVwQ29udmVyc2lvblZhbGlkYXRpb24gPSBmdW5jdGlvbigpIHtcclxuICAgIC8vIFNldCB1cCBpbnRlcnZhbCB0byBjaGVjayBmb3Igc3RhbGUgY29udmVyc2lvbnMgZXZlcnkgbWludXRlXHJcbiAgICB0aGlzLnZhbGlkYXRpb25JbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xyXG4gICAgICAgICAgICBsZXQgc3RhbGVDb3VudCA9IDA7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDaGVjayBhbGwgYWN0aXZlIGNvbnZlcnNpb25zXHJcbiAgICAgICAgICAgIEFycmF5LmZyb20odGhpcy5hY3RpdmVDb252ZXJzaW9ucy5lbnRyaWVzKCkpLmZvckVhY2goKFtpZCwgY29udl0pID0+IHtcclxuICAgICAgICAgICAgICAgIC8vIENvbnNpZGVyIGEgY29udmVyc2lvbiBzdGFsZSBpZiBpdCBoYXNuJ3QgcGluZ2VkIGluIHRoZSBsYXN0IDMwIHNlY29uZHNcclxuICAgICAgICAgICAgICAgIGlmIChub3cgLSBjb252Lmxhc3RQaW5nID4gMzAwMDApIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBSZW1vdmUgdGhlIHN0YWxlIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmRlbGV0ZShpZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgc3RhbGVDb3VudCsrO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIExvZyB0aGUgcmVtb3ZhbFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgW0NvbnZlcnRlclJlZ2lzdHJ5XSBTdGFsZSBjb252ZXJzaW9uICR7aWR9IHJlbW92ZWQgKGluYWN0aXZlIGZvciAke01hdGgucm91bmQoKG5vdyAtIGNvbnYubGFzdFBpbmcpIC8gMTAwMCl9cylgKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBJZiB0aGUgY29udmVyc2lvbiBoYXMgYSBjbGVhbnVwIGZ1bmN0aW9uLCBjYWxsIGl0XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBjb252LmNsZWFudXAgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnYuY2xlYW51cCgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtDb252ZXJ0ZXJSZWdpc3RyeV0gRXJyb3IgY2xlYW5pbmcgdXAgY29udmVyc2lvbiAke2lkfTpgLCBjbGVhbnVwRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIExvZyBzdW1tYXJ5IGlmIGFueSBzdGFsZSBjb252ZXJzaW9ucyB3ZXJlIHJlbW92ZWRcclxuICAgICAgICAgICAgaWYgKHN0YWxlQ291bnQgPiAwKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0NvbnZlcnRlclJlZ2lzdHJ5XSBSZW1vdmVkICR7c3RhbGVDb3VudH0gc3RhbGUgY29udmVyc2lvbnMuIEFjdGl2ZSBjb252ZXJzaW9ucyByZW1haW5pbmc6ICR7dGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zaXplfWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0NvbnZlcnRlclJlZ2lzdHJ5XSBFcnJvciBkdXJpbmcgY29udmVyc2lvbiB2YWxpZGF0aW9uOicsIGVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICB9LCA2MDAwMCk7IC8vIFJ1biBldmVyeSA2MCBzZWNvbmRzXHJcbn07XHJcblxyXG4vKipcclxuICogUmVnaXN0ZXJzIGFuIGFjdGl2ZSBjb252ZXJzaW9uIHdpdGggdGhlIHJlZ2lzdHJ5LlxyXG4gKiBAcGFyYW0ge3N0cmluZ30gaWQgLSBVbmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGNvbnZlcnNpb25cclxuICogQHBhcmFtIHtPYmplY3R9IGNvbnZlcnNpb25EYXRhIC0gRGF0YSBhYm91dCB0aGUgY29udmVyc2lvblxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY2xlYW51cF0gLSBPcHRpb25hbCBjbGVhbnVwIGZ1bmN0aW9uIHRvIGNhbGwgd2hlbiB0aGUgY29udmVyc2lvbiBpcyByZW1vdmVkXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUucmVnaXN0ZXJDb252ZXJzaW9uID0gZnVuY3Rpb24oaWQsIGNvbnZlcnNpb25EYXRhLCBjbGVhbnVwKSB7XHJcbiAgICBpZiAoIWlkKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignW0NvbnZlcnRlclJlZ2lzdHJ5XSBDYW5ub3QgcmVnaXN0ZXIgY29udmVyc2lvbiB3aXRob3V0IElEJyk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNldChpZCwge1xyXG4gICAgICAgIC4uLmNvbnZlcnNpb25EYXRhLFxyXG4gICAgICAgIGxhc3RQaW5nOiBEYXRlLm5vdygpLFxyXG4gICAgICAgIGNsZWFudXA6IGNsZWFudXBcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZyhgW0NvbnZlcnRlclJlZ2lzdHJ5XSBSZWdpc3RlcmVkIGNvbnZlcnNpb24gJHtpZH0uIFRvdGFsIGFjdGl2ZTogJHt0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNpemV9YCk7XHJcbn07XHJcblxyXG4vKipcclxuICogVXBkYXRlcyB0aGUgbGFzdCBwaW5nIHRpbWUgZm9yIGFuIGFjdGl2ZSBjb252ZXJzaW9uIHRvIGtlZXAgaXQgYWxpdmUuXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBpZCAtIFVuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgY29udmVyc2lvblxyXG4gKiBAcGFyYW0ge09iamVjdH0gW3VwZGF0ZXNdIC0gT3B0aW9uYWwgdXBkYXRlcyB0byB0aGUgY29udmVyc2lvbiBkYXRhXHJcbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbnZlcnNpb24gd2FzIGZvdW5kIGFuZCB1cGRhdGVkXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUucGluZ0NvbnZlcnNpb24gPSBmdW5jdGlvbihpZCwgdXBkYXRlcyA9IHt9KSB7XHJcbiAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoaWQpO1xyXG4gICAgaWYgKCFjb252ZXJzaW9uKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBVcGRhdGUgdGhlIGxhc3QgcGluZyB0aW1lIGFuZCBhbnkgb3RoZXIgcHJvdmlkZWQgdXBkYXRlc1xyXG4gICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zZXQoaWQsIHtcclxuICAgICAgICAuLi5jb252ZXJzaW9uLFxyXG4gICAgICAgIC4uLnVwZGF0ZXMsXHJcbiAgICAgICAgbGFzdFBpbmc6IERhdGUubm93KClcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICByZXR1cm4gdHJ1ZTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZW1vdmVzIGFuIGFjdGl2ZSBjb252ZXJzaW9uIGZyb20gdGhlIHJlZ2lzdHJ5LlxyXG4gKiBAcGFyYW0ge3N0cmluZ30gaWQgLSBVbmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGNvbnZlcnNpb25cclxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY29udmVyc2lvbiB3YXMgZm91bmQgYW5kIHJlbW92ZWRcclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5yZW1vdmVDb252ZXJzaW9uID0gZnVuY3Rpb24oaWQpIHtcclxuICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChpZCk7XHJcbiAgICBpZiAoIWNvbnZlcnNpb24pIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIElmIHRoZSBjb252ZXJzaW9uIGhhcyBhIGNsZWFudXAgZnVuY3Rpb24sIGNhbGwgaXRcclxuICAgIGlmICh0eXBlb2YgY29udmVyc2lvbi5jbGVhbnVwID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29udmVyc2lvbi5jbGVhbnVwKCk7XHJcbiAgICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtDb252ZXJ0ZXJSZWdpc3RyeV0gRXJyb3IgY2xlYW5pbmcgdXAgY29udmVyc2lvbiAke2lkfTpgLCBjbGVhbnVwRXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gUmVtb3ZlIHRoZSBjb252ZXJzaW9uXHJcbiAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmRlbGV0ZShpZCk7XHJcbiAgICBjb25zb2xlLmxvZyhgW0NvbnZlcnRlclJlZ2lzdHJ5XSBSZW1vdmVkIGNvbnZlcnNpb24gJHtpZH0uIFRvdGFsIGFjdGl2ZTogJHt0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNpemV9YCk7XHJcbiAgICBcclxuICAgIHJldHVybiB0cnVlO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEdldHMgYW4gYWN0aXZlIGNvbnZlcnNpb24gZnJvbSB0aGUgcmVnaXN0cnkuXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBpZCAtIFVuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgY29udmVyc2lvblxyXG4gKiBAcmV0dXJucyB7T2JqZWN0fG51bGx9IC0gVGhlIGNvbnZlcnNpb24gZGF0YSBvciBudWxsIGlmIG5vdCBmb3VuZFxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLmdldENvbnZlcnNpb24gPSBmdW5jdGlvbihpZCkge1xyXG4gICAgcmV0dXJuIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGlkKSB8fCBudWxsO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIENsZWFucyB1cCByZXNvdXJjZXMgdXNlZCBieSB0aGUgcmVnaXN0cnkuXHJcbiAqIFRoaXMgc2hvdWxkIGJlIGNhbGxlZCB3aGVuIHRoZSBhcHBsaWNhdGlvbiBpcyBzaHV0dGluZyBkb3duLlxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLmNsZWFudXAgPSBmdW5jdGlvbigpIHtcclxuICAgIC8vIENsZWFyIHRoZSB2YWxpZGF0aW9uIGludGVydmFsXHJcbiAgICBpZiAodGhpcy52YWxpZGF0aW9uSW50ZXJ2YWwpIHtcclxuICAgICAgICBjbGVhckludGVydmFsKHRoaXMudmFsaWRhdGlvbkludGVydmFsKTtcclxuICAgICAgICB0aGlzLnZhbGlkYXRpb25JbnRlcnZhbCA9IG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIENsZWFuIHVwIGFsbCBhY3RpdmUgY29udmVyc2lvbnNcclxuICAgIGNvbnN0IGNvbnZlcnNpb25Db3VudCA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2l6ZTtcclxuICAgIGlmIChjb252ZXJzaW9uQ291bnQgPiAwKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtDb252ZXJ0ZXJSZWdpc3RyeV0gQ2xlYW5pbmcgdXAgJHtjb252ZXJzaW9uQ291bnR9IGFjdGl2ZSBjb252ZXJzaW9uc2ApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIEFycmF5LmZyb20odGhpcy5hY3RpdmVDb252ZXJzaW9ucy5lbnRyaWVzKCkpLmZvckVhY2goKFtpZCwgY29udl0pID0+IHtcclxuICAgICAgICAgICAgLy8gSWYgdGhlIGNvbnZlcnNpb24gaGFzIGEgY2xlYW51cCBmdW5jdGlvbiwgY2FsbCBpdFxyXG4gICAgICAgICAgICBpZiAodHlwZW9mIGNvbnYuY2xlYW51cCA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb252LmNsZWFudXAoKTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtDb252ZXJ0ZXJSZWdpc3RyeV0gRXJyb3IgY2xlYW5pbmcgdXAgY29udmVyc2lvbiAke2lkfTpgLCBjbGVhbnVwRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2xlYXIgdGhlIG1hcFxyXG4gICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuY2xlYXIoKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ1tDb252ZXJ0ZXJSZWdpc3RyeV0gQ2xlYW51cCBjb21wbGV0ZScpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlZ2lzdGVyIGEgY29udmVydGVyIGZvciBhIHNwZWNpZmljIGZpbGUgdHlwZVxyXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIEZpbGUgdHlwZSAoZXh0ZW5zaW9uIHdpdGhvdXQgZG90KVxyXG4gKiBAcGFyYW0ge09iamVjdH0gY29udmVydGVyIC0gQ29udmVydGVyIGltcGxlbWVudGF0aW9uXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUucmVnaXN0ZXIgPSBmdW5jdGlvbih0eXBlLCBjb252ZXJ0ZXIpIHtcclxuICAgIHRoaXMuY29udmVydGVyc1t0eXBlXSA9IGNvbnZlcnRlcjtcclxuICAgIGNvbnNvbGUubG9nKGBSZWdpc3RlcmVkIGNvbnZlcnRlciBmb3IgJHt0eXBlfWApO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEdldCBjb252ZXJ0ZXIgYnkgZmlsZSBleHRlbnNpb25cclxuICogQHBhcmFtIHtzdHJpbmd9IGV4dGVuc2lvbiAtIEZpbGUgZXh0ZW5zaW9uICh3aXRoIG9yIHdpdGhvdXQgZG90KVxyXG4gKiBAcmV0dXJucyB7T2JqZWN0fG51bGx9IENvbnZlcnRlciBvciBudWxsIGlmIG5vdCBmb3VuZFxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLmdldENvbnZlcnRlckJ5RXh0ZW5zaW9uID0gZnVuY3Rpb24oZXh0ZW5zaW9uKSB7XHJcbiAgICAvLyBOb3JtYWxpemUgZXh0ZW5zaW9uIChyZW1vdmUgZG90LCBsb3dlcmNhc2UpXHJcbiAgICBjb25zdCBub3JtYWxpemVkRXh0ID0gZXh0ZW5zaW9uLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXlxcLi8sICcnKTtcclxuICAgIHJldHVybiB0aGlzLmNvbnZlcnRlcnNbbm9ybWFsaXplZEV4dF0gfHwgbnVsbDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXQgY29udmVydGVyIGJ5IE1JTUUgdHlwZVxyXG4gKiBAcGFyYW0ge3N0cmluZ30gbWltZVR5cGUgLSBNSU1FIHR5cGVcclxuICogQHJldHVybnMge09iamVjdHxudWxsfSBDb252ZXJ0ZXIgb3IgbnVsbCBpZiBub3QgZm91bmRcclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5nZXRDb252ZXJ0ZXJCeU1pbWVUeXBlID0gZnVuY3Rpb24obWltZVR5cGUpIHtcclxuICAgIC8vIEZpbmQgY29udmVydGVyIHRoYXQgc3VwcG9ydHMgdGhpcyBNSU1FIHR5cGVcclxuICAgIGZvciAoY29uc3QgW3R5cGUsIGNvbnZlcnRlcl0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5jb252ZXJ0ZXJzKSkge1xyXG4gICAgICAgIGlmIChjb252ZXJ0ZXIuY29uZmlnICYmIFxyXG4gICAgICAgICAgICBjb252ZXJ0ZXIuY29uZmlnLm1pbWVUeXBlcyAmJiBcclxuICAgICAgICAgICAgY29udmVydGVyLmNvbmZpZy5taW1lVHlwZXMuaW5jbHVkZXMobWltZVR5cGUpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBjb252ZXJ0ZXI7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn07XHJcblxyXG4vKipcclxuICogQ29udmVydCBjb250ZW50IHRvIG1hcmtkb3duIHVzaW5nIGFwcHJvcHJpYXRlIGNvbnZlcnRlclxyXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIEZpbGUgdHlwZVxyXG4gKiBAcGFyYW0ge0J1ZmZlcnxzdHJpbmd9IGNvbnRlbnQgLSBDb250ZW50IHRvIGNvbnZlcnRcclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gQ29udmVyc2lvbiByZXN1bHRcclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5jb252ZXJ0VG9NYXJrZG93biA9IGFzeW5jIGZ1bmN0aW9uKHR5cGUsIGNvbnRlbnQsIG9wdGlvbnMpIHtcclxuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgY29uc3QgY29udmVydGVyID0gdGhpcy5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbih0eXBlKTtcclxuICAgIGlmICghY29udmVydGVyKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBjb252ZXJ0ZXIgZm91bmQgZm9yIHR5cGU6ICR7dHlwZX1gKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGF3YWl0IGNvbnZlcnRlci5jb252ZXJ0KGNvbnRlbnQsIG9wdGlvbnMubmFtZSB8fCAnZmlsZScsIG9wdGlvbnMuYXBpS2V5LCBvcHRpb25zKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBTZXR1cCBhbGwgYXZhaWxhYmxlIGNvbnZlcnRlcnNcclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5zZXR1cENvbnZlcnRlcnMgPSBmdW5jdGlvbigpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgLy8gSW1wb3J0IGNvbnZlcnRlcnMgZnJvbSB0aGUgbmV3IGxvY2F0aW9uXHJcbiAgICAgICAgY29uc3QgQ3N2Q29udmVydGVyID0gcmVxdWlyZSgnLi9kYXRhL0NzdkNvbnZlcnRlcicpO1xyXG4gICAgICAgIGNvbnN0IFhsc3hDb252ZXJ0ZXIgPSByZXF1aXJlKCcuL2RhdGEvWGxzeENvbnZlcnRlcicpO1xyXG4gICAgICAgIGNvbnN0IEF1ZGlvQ29udmVydGVyID0gcmVxdWlyZSgnLi9tdWx0aW1lZGlhL0F1ZGlvQ29udmVydGVyJyk7XHJcbiAgICAgICAgY29uc3QgVmlkZW9Db252ZXJ0ZXIgPSByZXF1aXJlKCcuL211bHRpbWVkaWEvVmlkZW9Db252ZXJ0ZXInKTtcclxuICAgICAgICBjb25zdCBQZGZGYWN0b3J5ID0gcmVxdWlyZSgnLi9kb2N1bWVudC9QZGZDb252ZXJ0ZXJGYWN0b3J5Jyk7XHJcbiAgICAgICAgY29uc3QgRG9jeENvbnZlcnRlciA9IHJlcXVpcmUoJy4vZG9jdW1lbnQvRG9jeENvbnZlcnRlcicpO1xyXG4gICAgICAgIGNvbnN0IFBwdHhDb252ZXJ0ZXIgPSByZXF1aXJlKCcuL2RvY3VtZW50L1BwdHhDb252ZXJ0ZXInKTtcclxuICAgICAgICBjb25zdCBVcmxDb252ZXJ0ZXIgPSByZXF1aXJlKCcuL3dlYi9VcmxDb252ZXJ0ZXInKTtcclxuICAgICAgICBjb25zdCBQYXJlbnRVcmxDb252ZXJ0ZXIgPSByZXF1aXJlKCcuL3dlYi9QYXJlbnRVcmxDb252ZXJ0ZXInKTtcclxuXHJcbiAgICAgICAgLy8gSW1wb3J0IHNpbmdsZXRvbiBzZXJ2aWNlIGluc3RhbmNlc1xyXG4gICAgICAgIGNvbnN0IGZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UgPSByZXF1aXJlKCcuLi9zdG9yYWdlL0ZpbGVQcm9jZXNzb3JTZXJ2aWNlJyk7XHJcbiAgICAgICAgY29uc3QgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UgPSByZXF1aXJlKCcuLi9zdG9yYWdlL0ZpbGVTdG9yYWdlU2VydmljZScpO1xyXG4gICAgICAgIGNvbnN0IHRyYW5zY3JpYmVyU2VydmljZUluc3RhbmNlID0gcmVxdWlyZSgnLi4vYWkvVHJhbnNjcmliZXJTZXJ2aWNlJyk7XHJcbiAgICAgICAgLy8gT3BlbkFJUHJveHlTZXJ2aWNlIHNpbmdsZXRvbiBpcyBhbHJlYWR5IGltcG9ydGVkIGJ5IFRyYW5zY3JpYmVyU2VydmljZVxyXG5cclxuICAgICAgICAvLyBDcmVhdGUgaW5zdGFuY2VzIG9mIGNvbnZlcnRlciBjbGFzc2VzLCBwYXNzaW5nIHNpbmdsZXRvbiBkZXBlbmRlbmNpZXNcclxuICAgICAgICBjb25zdCBjc3ZDb252ZXJ0ZXJJbnN0YW5jZSA9IG5ldyBDc3ZDb252ZXJ0ZXIoKTtcclxuICAgICAgICBjb25zdCB4bHN4Q29udmVydGVySW5zdGFuY2UgPSBuZXcgWGxzeENvbnZlcnRlcigpO1xyXG4gICAgICAgIC8vIFBhc3MgdGhlIHNpbmdsZXRvbiBpbnN0YW5jZXMgdG8gdGhlIGNvbnN0cnVjdG9yc1xyXG4gICAgICAgIGNvbnN0IGF1ZGlvQ29udmVydGVySW5zdGFuY2UgPSBuZXcgQXVkaW9Db252ZXJ0ZXIoZmlsZVByb2Nlc3NvclNlcnZpY2VJbnN0YW5jZSwgdHJhbnNjcmliZXJTZXJ2aWNlSW5zdGFuY2UsIGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlKTtcclxuICAgICAgICAvLyBQYXNzIHRoZSByZWdpc3RyeSBpbnN0YW5jZSAodGhpcykgdG8gdGhlIFZpZGVvQ29udmVydGVyIGNvbnN0cnVjdG9yXHJcbiAgICAgICAgY29uc3QgdmlkZW9Db252ZXJ0ZXJJbnN0YW5jZSA9IG5ldyBWaWRlb0NvbnZlcnRlcih0aGlzLCBmaWxlUHJvY2Vzc29yU2VydmljZUluc3RhbmNlLCB0cmFuc2NyaWJlclNlcnZpY2VJbnN0YW5jZSwgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UpO1xyXG4gICAgICAgIGNvbnN0IHBkZkNvbnZlcnRlckZhY3RvcnkgPSBuZXcgUGRmRmFjdG9yeSgpO1xyXG4gICAgICAgIGNvbnN0IGRvY3hDb252ZXJ0ZXJJbnN0YW5jZSA9IG5ldyBEb2N4Q29udmVydGVyKCk7XHJcbiAgICAgICAgY29uc3QgcHB0eENvbnZlcnRlckluc3RhbmNlID0gbmV3IFBwdHhDb252ZXJ0ZXIoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBJbnN0YW50aWF0ZSBVUkwgY29udmVydGVycyB3aXRoIHNpbmdsZXRvbiBkZXBlbmRlbmNpZXMgKG9yIG1vY2tzIGlmIGFwcHJvcHJpYXRlKVxyXG4gICAgICAgIC8vIE5vdGU6IFVSTCBjb252ZXJ0ZXJzIG1pZ2h0IG5vdCBuZWVkIHRoZSBmdWxsIGZpbGUgc2VydmljZXMsIHVzaW5nIG1vY2tzIG1pZ2h0IHN0aWxsIGJlIG9rYXkgaGVyZVxyXG4gICAgICAgIC8vIFVzaW5nIHNpbmdsZXRvbnMgZm9yIGNvbnNpc3RlbmN5LCBidXQgY291bGQgcmV2ZXJ0IHRvIG1vY2tzIGlmIG5lZWRlZC5cclxuICAgICAgICBjb25zdCB1cmxDb252ZXJ0ZXJJbnN0YW5jZSA9IG5ldyBVcmxDb252ZXJ0ZXIoZmlsZVByb2Nlc3NvclNlcnZpY2VJbnN0YW5jZSwgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UpO1xyXG4gICAgICAgIGNvbnN0IHBhcmVudFVybENvbnZlcnRlckluc3RhbmNlID0gbmV3IFBhcmVudFVybENvbnZlcnRlcihmaWxlUHJvY2Vzc29yU2VydmljZUluc3RhbmNlLCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZSk7XHJcblxyXG4gICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgYWRhcHRlciBmb3IgRE9DWCBjb252ZXJ0ZXIgdXNpbmcgdGhlIGFjdHVhbCBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ2RvY3gnLCB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtEb2N4QWRhcHRlcl0gQ29udmVydGluZyBET0NYIGZpbGU6ICR7bmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgY29udGVudCBpcyBhIEJ1ZmZlclxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRE9DWCBjb250ZW50IG11c3QgYmUgYSBCdWZmZXInKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHRoZSBhY3R1YWwgRG9jeENvbnZlcnRlciBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY3hDb252ZXJ0ZXJJbnN0YW5jZS5jb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhcGlLZXlcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgd2UgaGF2ZSBjb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQgfHwgdHlwZW9mIHJlc3VsdCAhPT0gJ3N0cmluZycgfHwgcmVzdWx0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdET0NYIGNvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiByZXN1bHQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdkb2N4J1xyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtEb2N4QWRhcHRlcl0gRXJyb3IgY29udmVydGluZyBET0NYOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBET0NYIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpICYmIGNvbnRlbnQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnRE9DWCBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICAgICAgZXh0ZW5zaW9uczogWycuZG9jeCcsICcuZG9jJ10sXHJcbiAgICAgICAgICAgICAgICBtaW1lVHlwZXM6IFsnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LndvcmRwcm9jZXNzaW5nbWwuZG9jdW1lbnQnLCAnYXBwbGljYXRpb24vbXN3b3JkJ10sXHJcbiAgICAgICAgICAgICAgICBtYXhTaXplOiAxMDAgKiAxMDI0ICogMTAyNCAvLyAxMDBNQlxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBhZGFwdGVyIGZvciBQUFRYIGNvbnZlcnRlciB1c2luZyB0aGUgYWN0dWFsIGltcGxlbWVudGF0aW9uXHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcigncHB0eCcsIHtcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW1BwdHhBZGFwdGVyXSBDb252ZXJ0aW5nIFBQVFggZmlsZTogJHtuYW1lfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBjb250ZW50IGlzIGEgQnVmZmVyXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoY29udGVudCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQUFRYIGNvbnRlbnQgbXVzdCBiZSBhIEJ1ZmZlcicpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgdGhlIGFjdHVhbCBQcHR4Q29udmVydGVyIGltcGxlbWVudGF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcHB0eENvbnZlcnRlckluc3RhbmNlLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZU5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwaUtleVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSB3ZSBoYXZlIGNvbnRlbnRcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXJlc3VsdCB8fCB0eXBlb2YgcmVzdWx0ICE9PSAnc3RyaW5nJyB8fCByZXN1bHQudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1BQVFggY29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHJlc3VsdCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BwdHgnXHJcbiAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BwdHhBZGFwdGVyXSBFcnJvciBjb252ZXJ0aW5nIFBQVFg6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFBQVFggY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdmFsaWRhdGU6IChjb250ZW50KSA9PiBCdWZmZXIuaXNCdWZmZXIoY29udGVudCkgJiYgY29udGVudC5sZW5ndGggPiAwLFxyXG4gICAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdQUFRYIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy5wcHR4JywgJy5wcHQnXSxcclxuICAgICAgICAgICAgICAgIG1pbWVUeXBlczogWydhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQucHJlc2VudGF0aW9ubWwucHJlc2VudGF0aW9uJywgJ2FwcGxpY2F0aW9uL3ZuZC5tcy1wb3dlcnBvaW50J10sXHJcbiAgICAgICAgICAgICAgICBtYXhTaXplOiAxMDAgKiAxMDI0ICogMTAyNCAvLyAxMDBNQlxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBhZGFwdGVyIGZvciB0aGUgQ1NWIGNvbnZlcnRlclxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ2NzdicsIHtcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0NzdkFkYXB0ZXJdIENvbnZlcnRpbmcgQ1NWIGZpbGU6ICR7bmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBDb252ZXJ0IHRoZSBjb250ZW50IHRvIHN0cmluZ1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRlbnRTdHIgPSBjb250ZW50LnRvU3RyaW5nKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHRoZSBhY3R1YWwgQ3N2Q29udmVydGVyIGltcGxlbWVudGF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY3N2Q29udmVydGVySW5zdGFuY2UuY29udmVydFRvTWFya2Rvd24oY29udGVudFN0ciwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBuYW1lIC8vIFBhc3MgdGhlIG9yaWdpbmFsIGZpbGVuYW1lXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHdlIGhhdmUgY29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcmVzdWx0IHx8IHR5cGVvZiByZXN1bHQgIT09ICdzdHJpbmcnIHx8IHJlc3VsdC50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ1NWIGNvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiByZXN1bHQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdjc3YnXHJcbiAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0NzdkFkYXB0ZXJdIEVycm9yIGNvbnZlcnRpbmcgQ1NWOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDU1YgY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdmFsaWRhdGU6IChjb250ZW50KSA9PiBCdWZmZXIuaXNCdWZmZXIoY29udGVudCkgJiYgY29udGVudC5sZW5ndGggPiAwLFxyXG4gICAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdDU1YgQ29udmVydGVyJyxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLmNzdiddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ3RleHQvY3N2J10sXHJcbiAgICAgICAgICAgICAgICBtYXhTaXplOiAxMDAgKiAxMDI0ICogMTAyNCAvLyAxMDBNQlxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgYWRhcHRlciBmb3IgdGhlIFhMU1ggY29udmVydGVyXHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcigneGxzeCcsIHtcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW1hsc3hBZGFwdGVyXSBDb252ZXJ0aW5nIEV4Y2VsIGZpbGU6ICR7bmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgY29udGVudCBpcyBhIEJ1ZmZlclxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhjZWwgY29udGVudCBtdXN0IGJlIGEgQnVmZmVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJlYWQgdGhlIEV4Y2VsIGZpbGUgdXNpbmcgeGxzeCBsaWJyYXJ5XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgeGxzeCA9IHJlcXVpcmUoJ3hsc3gnKTtcclxuICAgICAgICAgICAgICAgICAgICBsZXQgd29ya2Jvb2s7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGZpbGUgdG8gcmVhZCB0aGUgRXhjZWwgY29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG9zID0gcmVxdWlyZSgnb3MnKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IHBhdGguam9pbihvcy50bXBkaXIoKSwgYHhsc3hfY29udmVyc2lvbl8ke0RhdGUubm93KCl9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLmVuc3VyZURpcih0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBGaWxlID0gcGF0aC5qb2luKHRlbXBEaXIsIGAke25hbWV9XyR7RGF0ZS5ub3coKX0ueGxzeGApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUodGVtcEZpbGUsIGNvbnRlbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmVhZCB0aGUgRXhjZWwgZmlsZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB3b3JrYm9vayA9IHhsc3gucmVhZEZpbGUodGVtcEZpbGUsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNlbGxEYXRlczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLihvcHRpb25zLnhsc3hPcHRpb25zIHx8IHt9KVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZmlsZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAocmVhZEVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtYbHN4QWRhcHRlcl0gRmFpbGVkIHRvIHJlYWQgRXhjZWwgZmlsZTogJHtuYW1lfWAsIHJlYWRFcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHJlYWQgRXhjZWwgZmlsZTogJHtyZWFkRXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHRoZSBhY3R1YWwgWGxzeENvbnZlcnRlciBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHhsc3hDb252ZXJ0ZXJJbnN0YW5jZS5jb252ZXJ0VG9NYXJrZG93bih3b3JrYm9vaywge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBuYW1lIC8vIFBhc3MgdGhlIG9yaWdpbmFsIGZpbGVuYW1lXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHdlIGhhdmUgY29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcmVzdWx0IHx8IHR5cGVvZiByZXN1bHQgIT09ICdzdHJpbmcnIHx8IHJlc3VsdC50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhjZWwgY29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHJlc3VsdCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3hsc3gnXHJcbiAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1hsc3hBZGFwdGVyXSBFcnJvciBjb252ZXJ0aW5nIEV4Y2VsOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeGNlbCBjb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB2YWxpZGF0ZTogKGNvbnRlbnQpID0+IEJ1ZmZlci5pc0J1ZmZlcihjb250ZW50KSAmJiBjb250ZW50Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ0V4Y2VsIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy54bHN4JywgJy54bHMnXSxcclxuICAgICAgICAgICAgICAgIG1pbWVUeXBlczogWydhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsICdhcHBsaWNhdGlvbi92bmQubXMtZXhjZWwnXSxcclxuICAgICAgICAgICAgICAgIG1heFNpemU6IDEwMCAqIDEwMjQgKiAxMDI0IC8vIDEwME1CXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBhZGFwdGVyIGZvciBhdWRpbyBjb252ZXJ0ZXJzXHJcbiAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBhZGFwdGVyIGZvciBhdWRpbyBjb252ZXJ0ZXJzXHJcbiAgICAgICAgY29uc3QgYXVkaW9BZGFwdGVyID0ge1xyXG4gICAgICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQXVkaW9BZGFwdGVyXSBDb252ZXJ0aW5nIGF1ZGlvIGZpbGU6ICR7bmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgY29udGVudCBpcyBhIEJ1ZmZlclxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQXVkaW8gY29udGVudCBtdXN0IGJlIGEgQnVmZmVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBmaWxlIHRvIHByb2Nlc3MgdGhlIGF1ZGlvIHVzaW5nIHRoZSBzaW5nbGV0b24gc2VydmljZVxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZS5jcmVhdGVUZW1wRGlyKCdhdWRpb19jb252ZXJzaW9uJyk7IFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBGaWxlID0gcGF0aC5qb2luKHRlbXBEaXIsIGAke25hbWV9XyR7RGF0ZS5ub3coKX0ubXAzYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKHRlbXBGaWxlLCBjb250ZW50KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBQcm9jZXNzIHRoZSBhdWRpbyBmaWxlIHVzaW5nIHRoZSBBdWRpb0NvbnZlcnRlclxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGF1ZGlvQ29udmVydGVySW5zdGFuY2UucHJvY2Vzc0NvbnZlcnNpb24oXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGBhdWRpb18ke0RhdGUubm93KCl9YCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcEZpbGUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2NyaWJlOiBvcHRpb25zLnRyYW5zY3JpYmUgIT09IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFuZ3VhZ2U6IG9wdGlvbnMubGFuZ3VhZ2UgfHwgJ2VuJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlOiBvcHRpb25zLnRpdGxlIHx8IG5hbWVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBmaWxlXHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJldHVybiB0aGUgY29udmVyc2lvbiByZXN1bHRcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiByZXN1bHQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdhdWRpbydcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbQXVkaW9BZGFwdGVyXSBFcnJvciBjb252ZXJ0aW5nIGF1ZGlvOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdWRpbyBjb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB2YWxpZGF0ZTogKGNvbnRlbnQpID0+IEJ1ZmZlci5pc0J1ZmZlcihjb250ZW50KSAmJiBjb250ZW50Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ0F1ZGlvIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy5tcDMnLCAnLndhdicsICcub2dnJywgJy5tNGEnLCAnLm1wZ2EnXSxcclxuICAgICAgICAgICAgICAgIG1pbWVUeXBlczogWydhdWRpby9tcGVnJywgJ2F1ZGlvL21wMycsICdhdWRpby93YXYnLCAnYXVkaW8vb2dnJywgJ2F1ZGlvL200YSddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAwICogMTAyNCAqIDEwMjQgLy8gMTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcignbXAzJywgYXVkaW9BZGFwdGVyKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCd3YXYnLCBhdWRpb0FkYXB0ZXIpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFJlZ2lzdGVyIHBwdCBleHRlbnNpb24gdG8gdXNlIHRoZSBzYW1lIGNvbnZlcnRlciBhcyBwcHR4XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcigncHB0JywgdGhpcy5jb252ZXJ0ZXJzWydwcHR4J10pO1xyXG5cclxuICAgICAgICAvLyAtLS0gUmVtb3ZlZCBWaWRlbyBBZGFwdGVyIC0tLVxyXG4gICAgICAgIC8vIFRoZSBWaWRlb0NvbnZlcnRlciBpbnN0YW5jZSBpdHNlbGYgd2lsbCBoYW5kbGUgSVBDIGNhbGxzIHZpYSBpdHMgQmFzZVNlcnZpY2UgbWV0aG9kc1xyXG4gICAgICAgIC8vIFJlZ2lzdGVyIHRoZSBWaWRlb0NvbnZlcnRlciBpbnN0YW5jZSBkaXJlY3RseSBmb3IgcmVsZXZhbnQgZXh0ZW5zaW9uc1xyXG4gICAgICAgIGNvbnN0IHZpZGVvQ29udmVydGVyQ29uZmlnID0ge1xyXG4gICAgICAgICAgICBuYW1lOiAnVmlkZW8gQ29udmVydGVyJyxcclxuICAgICAgICAgICAgZXh0ZW5zaW9uczogWycubXA0JywgJy53ZWJtJywgJy5tb3YnLCAnLmF2aSddLFxyXG4gICAgICAgICAgICBtaW1lVHlwZXM6IFsndmlkZW8vbXA0JywgJ3ZpZGVvL3dlYm0nLCAndmlkZW8vcXVpY2t0aW1lJywgJ3ZpZGVvL3gtbXN2aWRlbyddLFxyXG4gICAgICAgICAgICBtYXhTaXplOiA1MDAgKiAxMDI0ICogMTAyNCAvLyA1MDBNQlxyXG4gICAgICAgIH07XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gV2UgbmVlZCBhIHdyYXBwZXIgaGVyZSBpZiB0aGUgSVBDIGhhbmRsZXIgZXhwZWN0cyBhIHNwZWNpZmljICdjb252ZXJ0JyBmdW5jdGlvbiBzaWduYXR1cmVcclxuICAgICAgICAvLyBPciwgaWRlYWxseSwgdGhlIElQQyBoYW5kbGVyIHNob3VsZCBjYWxsIHRoZSBhcHByb3ByaWF0ZSBtZXRob2Qgb24gdGhlIHNlcnZpY2UgaW5zdGFuY2VcclxuICAgICAgICAvLyBGb3Igbm93LCBsZXQncyBhc3N1bWUgdGhlIElQQyBoYW5kbGVyIGNhbiBjYWxsIGB2aWRlb0NvbnZlcnRlckluc3RhbmNlLmhhbmRsZUNvbnZlcnRgXHJcbiAgICAgICAgLy8gSWYgbm90LCB3ZSdkIG5lZWQgYW4gYWRhcHRlciBzaW1pbGFyIHRvIHRoZSBvdGhlcnMsIGJ1dCBjYWxsaW5nIGhhbmRsZUNvbnZlcnRcclxuICAgICAgICAvLyBMZXQncyByZWdpc3RlciB0aGUgaW5zdGFuY2UgZGlyZWN0bHkgZm9yIG5vdywgYXNzdW1pbmcgSVBDIHJvdXRpbmcgaGFuZGxlcyBpdC5cclxuICAgICAgICAgLy8gSWYgZXJyb3JzIG9jY3VyLCB3ZSBtaWdodCBuZWVkIHRvIHJlLWludHJvZHVjZSBhIHNpbXBsZSBhZGFwdGVyLlxyXG4gICAgICAgICBjb25zdCB2aWRlb0NvbnZlcnRlcldyYXBwZXIgPSB7XHJcbiAgICAgICAgICAgICAvLyBUaGlzICdjb252ZXJ0JyBtZXRob2QgYWN0cyBhcyBhbiBhZGFwdGVyIGlmIHRoZSBjYWxsaW5nIGNvZGVcclxuICAgICAgICAgICAgIC8vIChsaWtlIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5KSBleHBlY3RzIGEgc2ltcGxlIGNvbnZlcnQgZnVuY3Rpb24uXHJcbiAgICAgICAgICAgICAvLyBJdCBzaW11bGF0ZXMgdGhlIG5lY2Vzc2FyeSBwYXJ0cyBvZiBhbiBJUEMgY2FsbCB0byB0cmlnZ2VyIHRoZVxyXG4gICAgICAgICAgICAgLy8gVmlkZW9Db252ZXJ0ZXIncyBpbnRlcm5hbCBoYW5kbGluZyBsb2dpYyB2aWEgaGFuZGxlQ29udmVydC5cclxuICAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcIltDb252ZXJ0ZXJSZWdpc3RyeV0gVmlkZW9Db252ZXJ0ZXJXcmFwcGVyICdjb252ZXJ0JyBjYWxsZWQuIFNpbXVsYXRpbmcgSVBDIGNhbGwgdG8gaGFuZGxlQ29udmVydC5cIik7XHJcbiAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGZpbGUgZm9yIHRoZSB2aWRlbyBjb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgIC8vIFRoZSBvcmlnaW5hbCB2aWRlb0FkYXB0ZXIgZGlkIHRoaXMsIGFuZCBoYW5kbGVDb252ZXJ0IGV4cGVjdHMgYSBmaWxlIHBhdGhcclxuICAgICAgICAgICAgICAgICAgICAgbGV0IHRlbXBEaXI7XHJcbiAgICAgICAgICAgICAgICAgICAgIGxldCB0ZW1wRmlsZTtcclxuICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIGNvbnRlbnQgaXMgYSBCdWZmZXIgKHdoaWNoIGlzIHdoYXQgd2UgZXhwZWN0IGZyb20gVW5pZmllZENvbnZlcnRlckZhY3RvcnkpXHJcbiAgICAgICAgICAgICAgICAgICAgIGlmIChCdWZmZXIuaXNCdWZmZXIoY29udGVudCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbVmlkZW9Db252ZXJ0ZXJXcmFwcGVyXSBDb250ZW50IGlzIGEgQnVmZmVyIG9mIHNpemU6ICR7Y29udGVudC5sZW5ndGh9IGJ5dGVzYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBkaXJlY3RvcnkgZm9yIHRoaXMgY29udmVyc2lvblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgdGVtcERpciA9IGF3YWl0IGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlLmNyZWF0ZVRlbXBEaXIoJ3ZpZGVvX2NvbnZlcnNpb24nKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbVmlkZW9Db252ZXJ0ZXJXcmFwcGVyXSBDcmVhdGVkIHRlbXAgZGlyZWN0b3J5OiAke3RlbXBEaXJ9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdyaXRlIHRoZSBidWZmZXIgdG8gYSB0ZW1wb3JhcnkgZmlsZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgdGVtcEZpbGUgPSBwYXRoLmpvaW4odGVtcERpciwgYCR7bmFtZX1fJHtEYXRlLm5vdygpfS5tcDRgKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbVmlkZW9Db252ZXJ0ZXJXcmFwcGVyXSBXcml0aW5nIHZpZGVvIGNvbnRlbnQgdG8gdGVtcCBmaWxlOiAke3RlbXBGaWxlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKHRlbXBGaWxlLCBjb250ZW50KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgLy8gVmVyaWZ5IHRoZSB0ZW1wIGZpbGUgd2FzIGNyZWF0ZWQgc3VjY2Vzc2Z1bGx5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRmlsZUV4aXN0cyA9IGF3YWl0IGZzLnBhdGhFeGlzdHModGVtcEZpbGUpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcEZpbGVTdGF0cyA9IHRlbXBGaWxlRXhpc3RzID8gYXdhaXQgZnMuc3RhdCh0ZW1wRmlsZSkgOiBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtWaWRlb0NvbnZlcnRlcldyYXBwZXJdIFRlbXAgZmlsZSBjcmVhdGVkOiAke3RlbXBGaWxlRXhpc3RzfSwgc2l6ZTogJHt0ZW1wRmlsZVN0YXRzID8gdGVtcEZpbGVTdGF0cy5zaXplIDogJ04vQSd9IGJ5dGVzYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGVtcEZpbGVFeGlzdHMgfHwgKHRlbXBGaWxlU3RhdHMgJiYgdGVtcEZpbGVTdGF0cy5zaXplID09PSAwKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIHdyaXRlIHZpZGVvIGNvbnRlbnQgdG8gdGVtcG9yYXJ5IGZpbGUnKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgY29udGVudCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgIC8vIElmIGNvbnRlbnQgaXMgYWxyZWFkeSBhIHN0cmluZyAoZmlsZSBwYXRoKSwgdXNlIGl0IGRpcmVjdGx5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW1ZpZGVvQ29udmVydGVyV3JhcHBlcl0gQ29udGVudCBpcyBhIGZpbGUgcGF0aDogJHtjb250ZW50fWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgdGVtcEZpbGUgPSBjb250ZW50O1xyXG4gICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgLy8gSWYgY29udGVudCBpcyBuZWl0aGVyIGEgQnVmZmVyIG5vciBhIHN0cmluZywgdGhyb3cgYW4gZXJyb3JcclxuICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJbVmlkZW9Db252ZXJ0ZXJXcmFwcGVyXSBVbmV4cGVjdGVkIGNvbnRlbnQgdHlwZTpcIiwgdHlwZW9mIGNvbnRlbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBWaWRlb0NvbnZlcnRlcldyYXBwZXIgcmVxdWlyZXMgYnVmZmVyIG9yIGZpbGUgcGF0aCwgcmVjZWl2ZWQ6ICR7dHlwZW9mIGNvbnRlbnR9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgIC8vIFNpbXVsYXRlIHRoZSBldmVudCBvYmplY3QgbWluaW1hbGx5IG9yIHBhc3MgbnVsbFxyXG4gICAgICAgICAgICAgICAgICAgICBjb25zdCBtb2NrRXZlbnQgPSBudWxsOyAvLyBPciB7IHNlbmRlcjogeyBnZXRPd25lckJyb3dzZXJXaW5kb3c6ICgpID0+IG51bGwgfSB9IGlmIG5lZWRlZFxyXG4gICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgLy8gQ2FsbCB0aGUgaW5zdGFuY2UncyBoYW5kbGVDb252ZXJ0IG1ldGhvZCB3aXRoIHRoZSB0ZW1wIGZpbGUgcGF0aFxyXG4gICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW1ZpZGVvQ29udmVydGVyV3JhcHBlcl0gQ2FsbGluZyBoYW5kbGVDb252ZXJ0IHdpdGggZmlsZSBwYXRoOiAke3RlbXBGaWxlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2aWRlb0NvbnZlcnRlckluc3RhbmNlLmhhbmRsZUNvbnZlcnQobW9ja0V2ZW50LCB7IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGg6IHRlbXBGaWxlLCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnM6IHsgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4ub3B0aW9ucywgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpS2V5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdGhlIHRlbXBEaXIgc28gaXQgY2FuIGJlIGNsZWFuZWQgdXAgcHJvcGVybHlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfdGVtcERpcjogdGVtcERpclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgfSBcclxuICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAvLyBOb3RlOiBUaGUgVmlkZW9Db252ZXJ0ZXIgd2lsbCBoYW5kbGUgY2xlYW51cCBvZiB0aGUgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgICAgICAgLy8gdGhyb3VnaCB0aGUgcmVnaXN0cnkncyBjb252ZXJzaW9uIHRyYWNraW5nIGFuZCBjbGVhbnVwIG1lY2hhbmlzbVxyXG4gICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgLy8gUmV0dXJuIGFuIG9iamVjdCBpbmRpY2F0aW5nIHRoZSBwcm9jZXNzIHN0YXJ0ZWRcclxuICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25JZDogcmVzdWx0LmNvbnZlcnNpb25JZCwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICBhc3luYzogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAndmlkZW8nXHJcbiAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1ZpZGVvQ29udmVydGVyV3JhcHBlcl0gRXJyb3IgaW4gY29udmVydDpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVmlkZW8gY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgdmFsaWRhdGU6IChjb250ZW50KSA9PiBCdWZmZXIuaXNCdWZmZXIoY29udGVudCkgJiYgY29udGVudC5sZW5ndGggPiAwLCAvLyBWYWxpZGF0aW9uIG1pZ2h0IG5lZWQgYWRqdXN0bWVudCBpZiBjb250ZW50IGlzIHBhdGhcclxuICAgICAgICAgICAgIGNvbmZpZzogdmlkZW9Db252ZXJ0ZXJDb25maWcsXHJcbiAgICAgICAgICAgICAvLyBTdG9yZSB0aGUgYWN0dWFsIGluc3RhbmNlIHNvIGl0IGNhbiBiZSBhY2Nlc3NlZCBpZiBuZWVkZWQgYnkgdGhlIGNhbGxlclxyXG4gICAgICAgICAgICAgaW5zdGFuY2U6IHZpZGVvQ29udmVydGVySW5zdGFuY2VcclxuICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcignbXA0JywgdmlkZW9Db252ZXJ0ZXJXcmFwcGVyKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCd3ZWJtJywgdmlkZW9Db252ZXJ0ZXJXcmFwcGVyKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdtb3YnLCB2aWRlb0NvbnZlcnRlcldyYXBwZXIpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ2F2aScsIHZpZGVvQ29udmVydGVyV3JhcHBlcik7XHJcblxyXG4gICAgICAgIC8vIFJlZ2lzdGVyIHRoZSBQREYgZmFjdG9yeSBhZGFwdGVyIHdpdGggcHJvcGVyIGltcGxlbWVudGF0aW9uXHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcigncGRmJywge1xyXG4gICAgICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiW1BkZkFkYXB0ZXJdIENvbnZlcnRpbmcgUERGIGRvY3VtZW50XCIpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSB0ZW1wIGRpcmVjdG9yeSBmb3IgY29udmVyc2lvbiB1c2luZyB0aGUgc2luZ2xldG9uIHNlcnZpY2VcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UuY3JlYXRlVGVtcERpcigncGRmX2NvbnZlcnNpb24nKTsgXHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHRoZSBkaXJlY3RvcnkgZXhpc3RzXHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMuZW5zdXJlRGlyKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBGaWxlID0gcGF0aC5qb2luKHRlbXBEaXIsIGBkb2N1bWVudF8ke0RhdGUubm93KCl9LnBkZmApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFdyaXRlIGJ1ZmZlciB0byB0ZW1wIGZpbGVcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUodGVtcEZpbGUsIGNvbnRlbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFZlcmlmeSB0aGUgZmlsZSB3YXMgd3JpdHRlbiBzdWNjZXNzZnVsbHlcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIShhd2FpdCBmcy5wYXRoRXhpc3RzKHRlbXBGaWxlKSkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gd3JpdGUgdGVtcG9yYXJ5IFBERiBmaWxlOiAke3RlbXBGaWxlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBEZXRlcm1pbmUgaWYgT0NSIHNob3VsZCBiZSB1c2VkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIERldGVybWluZSBpZiBPQ1Igc2hvdWxkIGJlIHVzZWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdXNlT2NyID0gb3B0aW9ucy51c2VPY3IgPT09IHRydWUgJiYgb3B0aW9ucy5taXN0cmFsQXBpS2V5O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIGFwcHJvcHJpYXRlIGNvbnZlcnRlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICBsZXQgcmVzdWx0O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodXNlT2NyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW0NvbnZlcnRlclJlZ2lzdHJ5XSBVc2luZyBNaXN0cmFsIE9DUiBjb252ZXJ0ZXIgZm9yIFBERiBjb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBVc2UgTWlzdHJhbCBPQ1IgY29udmVydGVyIC0gcmVxdWlyZSBpdCBkaXJlY3RseSB0byBlbnN1cmUgaXQncyBpbiBzY29wZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0cnVlIGZvciBza2lwSGFuZGxlclNldHVwIHRvIGF2b2lkIGR1cGxpY2F0ZSBJUEMgaGFuZGxlciByZWdpc3RyYXRpb25cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFBhc3Mgc2luZ2xldG9uIHNlcnZpY2VzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBNaXN0cmFsUGRmQ29udmVydGVyQ2xhc3MgPSByZXF1aXJlKCcuL2RvY3VtZW50L01pc3RyYWxQZGZDb252ZXJ0ZXInKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1pc3RyYWxDb252ZXJ0ZXIgPSBuZXcgTWlzdHJhbFBkZkNvbnZlcnRlckNsYXNzKGZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UsIGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlLCBudWxsLCB0cnVlKTsgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBTZXQgdGhlIEFQSSBrZXlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1pc3RyYWxDb252ZXJ0ZXIuYXBpS2V5ID0gb3B0aW9ucy5taXN0cmFsQXBpS2V5O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tDb252ZXJ0ZXJSZWdpc3RyeV0gTWlzdHJhbCBBUEkga2V5IHNldCBmb3IgT0NSIGNvbnZlcnNpb24nKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgbWlzdHJhbENvbnZlcnRlci5jb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmaWxlTmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaUtleTogb3B0aW9ucy5taXN0cmFsQXBpS2V5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVzZSBzdGFuZGFyZCBjb252ZXJ0ZXIgLSByZXF1aXJlIGl0IGRpcmVjdGx5IHRvIGVuc3VyZSBpdCdzIGluIHNjb3BlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRydWUgZm9yIHNraXBIYW5kbGVyU2V0dXAgdG8gYXZvaWQgZHVwbGljYXRlIElQQyBoYW5kbGVyIHJlZ2lzdHJhdGlvblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyBzaW5nbGV0b24gc2VydmljZXNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbQ29udmVydGVyUmVnaXN0cnldIFVzaW5nIHN0YW5kYXJkIFBERiBjb252ZXJ0ZXInKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IFN0YW5kYXJkUGRmQ29udmVydGVyQ2xhc3MgPSByZXF1aXJlKCcuL2RvY3VtZW50L1N0YW5kYXJkUGRmQ29udmVydGVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzdGFuZGFyZENvbnZlcnRlciA9IG5ldyBTdGFuZGFyZFBkZkNvbnZlcnRlckNsYXNzKGZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UsIGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlLCB0cnVlKTsgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCBzdGFuZGFyZENvbnZlcnRlci5jb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmaWxlTmFtZTogbmFtZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSByZXN1bHQgaGFzIHN1Y2Nlc3MgZmxhZyBhbmQgY29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IocmVzdWx0LmVycm9yIHx8ICdQREYgY29udmVyc2lvbiBmYWlsZWQgd2l0aCBubyBzcGVjaWZpYyBlcnJvcicpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXJlc3VsdC5jb250ZW50IHx8IHR5cGVvZiByZXN1bHQuY29udGVudCAhPT0gJ3N0cmluZycgfHwgcmVzdWx0LmNvbnRlbnQudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQREYgY29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmUtdGhyb3cgZXJyb3JcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbUGRmQWRhcHRlcl0gRXJyb3IgY29udmVydGluZyBQREY6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFBERiBjb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB2YWxpZGF0ZTogKGNvbnRlbnQpID0+IEJ1ZmZlci5pc0J1ZmZlcihjb250ZW50KSAmJiBjb250ZW50Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ1BERiBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICAgICAgZXh0ZW5zaW9uczogWycucGRmJ10sXHJcbiAgICAgICAgICAgICAgICBtaW1lVHlwZXM6IFsnYXBwbGljYXRpb24vcGRmJ10sXHJcbiAgICAgICAgICAgICAgICBtYXhTaXplOiAxMDAgKiAxMDI0ICogMTAyNCAvLyAxMDBNQlxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgYWRhcHRlciBmb3IgVVJMIGNvbnZlcnRlciB1c2luZyB0aGUgYWN0dWFsIGltcGxlbWVudGF0aW9uXHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcigndXJsJywge1xyXG4gICAgICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAvLyBVUkwgY29udmVydGVyIGV4cGVjdHMgdGhlIGNvbnRlbnQgdG8gYmUgdGhlIFVSTCBzdHJpbmdcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtVcmxBZGFwdGVyXSBDb252ZXJ0aW5nIFVSTDogJHtjb250ZW50fWApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSB0ZW1wb3JhcnkgZGlyZWN0b3J5IGZvciB0aGUgY29udmVyc2lvbiB1c2luZyB0aGUgc2luZ2xldG9uIHNlcnZpY2VcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UuY3JlYXRlVGVtcERpcigndXJsX2NvbnZlcnNpb24nKTsgXHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gTGF1bmNoIGEgYnJvd3NlciBpbnN0YW5jZSBmb3IgdGhlIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBwdXBwZXRlZXIgPSByZXF1aXJlKCdwdXBwZXRlZXInKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBicm93c2VyID0gYXdhaXQgcHVwcGV0ZWVyLmxhdW5jaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGhlYWRsZXNzOiAnbmV3JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXJnczogWyctLW5vLXNhbmRib3gnLCAnLS1kaXNhYmxlLXNldHVpZC1zYW5kYm94J11cclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBGZXRjaCBtZXRhZGF0YVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHVybENvbnZlcnRlckluc3RhbmNlLmZldGNoTWV0YWRhdGEoY29udGVudCwgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBFeHRyYWN0IGNvbnRlbnRcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXh0cmFjdGVkQ29udGVudCA9IGF3YWl0IHVybENvbnZlcnRlckluc3RhbmNlLmV4dHJhY3RDb250ZW50KGNvbnRlbnQsIG9wdGlvbnMsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUHJvY2VzcyBpbWFnZXMgaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGVJbWFnZXMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHVybENvbnZlcnRlckluc3RhbmNlLnByb2Nlc3NJbWFnZXMoZXh0cmFjdGVkQ29udGVudCwgdGVtcERpciwgY29udGVudCwgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duID0gdXJsQ29udmVydGVySW5zdGFuY2UuZ2VuZXJhdGVNYXJrZG93bihtZXRhZGF0YSwgZXh0cmFjdGVkQ29udGVudCwgbnVsbCwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbG9zZSBicm93c2VyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXBvcmFyeSBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBtYXJrZG93bixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAndXJsJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsb3NlIGJyb3dzZXIgb24gZXJyb3JcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcG9yYXJ5IGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBSZS10aHJvdyBlcnJvclxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtVcmxBZGFwdGVyXSBFcnJvciBjb252ZXJ0aW5nIFVSTDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVVJMIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gdHlwZW9mIGNvbnRlbnQgPT09ICdzdHJpbmcnICYmIGNvbnRlbnQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnVVJMIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy51cmwnLCAnLmh0bWwnLCAnLmh0bSddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ3RleHQvaHRtbCcsICdhcHBsaWNhdGlvbi94LXVybCddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAgKiAxMDI0ICogMTAyNCAvLyAxME1CXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBhZGFwdGVyIGZvciBQYXJlbnRVUkwgY29udmVydGVyIHVzaW5nIHRoZSBhY3R1YWwgaW1wbGVtZW50YXRpb25cclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdwYXJlbnR1cmwnLCB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIC8vIEZvciBVUkwgY29udmVydGVycywgY29udGVudCBpcyB0aGUgVVJMIHN0cmluZyBpdHNlbGZcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtQYXJlbnRVcmxBZGFwdGVyXSBDb252ZXJ0aW5nIHNpdGU6ICR7Y29udGVudH1gKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgdGVtcG9yYXJ5IGRpcmVjdG9yeSBmb3IgdGhlIGNvbnZlcnNpb24gdXNpbmcgdGhlIHNpbmdsZXRvbiBzZXJ2aWNlXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlLmNyZWF0ZVRlbXBEaXIoJ3BhcmVudF91cmxfY29udmVyc2lvbicpOyBcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBMYXVuY2ggYSBicm93c2VyIGluc3RhbmNlIGZvciB0aGUgY29udmVyc2lvblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHB1cHBldGVlciA9IHJlcXVpcmUoJ3B1cHBldGVlcicpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJyb3dzZXIgPSBhd2FpdCBwdXBwZXRlZXIubGF1bmNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaGVhZGxlc3M6ICduZXcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhcmdzOiBbJy0tbm8tc2FuZGJveCcsICctLWRpc2FibGUtc2V0dWlkLXNhbmRib3gnXVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIERpc2NvdmVyIHNpdGVtYXBcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcCA9IGF3YWl0IHBhcmVudFVybENvbnZlcnRlckluc3RhbmNlLmRpc2NvdmVyU2l0ZW1hcChjb250ZW50LCBvcHRpb25zLCBicm93c2VyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFByb2Nlc3MgZWFjaCBwYWdlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1heFBhZ2VzID0gb3B0aW9ucy5tYXhQYWdlcyB8fCBNYXRoLm1pbihzaXRlbWFwLnBhZ2VzLmxlbmd0aCwgMTApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwYWdlc1RvUHJvY2VzcyA9IHNpdGVtYXAucGFnZXMuc2xpY2UoMCwgbWF4UGFnZXMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9jZXNzZWRQYWdlcyA9IFtdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBwYWdlIG9mIHBhZ2VzVG9Qcm9jZXNzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBQcm9jZXNzIHBhZ2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VDb250ZW50ID0gYXdhaXQgcGFyZW50VXJsQ29udmVydGVySW5zdGFuY2UucHJvY2Vzc1BhZ2UoXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFnZS51cmwsIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnMsIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyb3dzZXIsIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBEaXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEFkZCB0byBwcm9jZXNzZWQgcGFnZXNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3NlZFBhZ2VzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVybDogcGFnZS51cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU6IHBhZ2UudGl0bGUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogcGFnZUNvbnRlbnRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBjb21iaW5lZCBtYXJrZG93blxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZG93biA9IHBhcmVudFVybENvbnZlcnRlckluc3RhbmNlLmdlbmVyYXRlQ29tYmluZWRNYXJrZG93bihcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNpdGVtYXAsIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2VkUGFnZXMsIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9uc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xvc2UgYnJvd3NlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wb3JhcnkgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogbWFya2Rvd24sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3BhcmVudHVybCdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbG9zZSBicm93c2VyIG9uIGVycm9yXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXBvcmFyeSBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmUtdGhyb3cgZXJyb3JcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbUGFyZW50VXJsQWRhcHRlcl0gRXJyb3IgY29udmVydGluZyBzaXRlOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTaXRlIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gdHlwZW9mIGNvbnRlbnQgPT09ICdzdHJpbmcnICYmIGNvbnRlbnQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnV2Vic2l0ZSBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICAgICAgZXh0ZW5zaW9uczogWycudXJsJywgJy5odG1sJywgJy5odG0nXSxcclxuICAgICAgICAgICAgICAgIG1pbWVUeXBlczogWyd0ZXh0L2h0bWwnLCAnYXBwbGljYXRpb24veC11cmwnXSxcclxuICAgICAgICAgICAgICAgIG1heFNpemU6IDEwICogMTAyNCAqIDEwMjQgLy8gMTBNQlxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgcmVnaXN0ZXJlZFR5cGVzID0gT2JqZWN0LmtleXModGhpcy5jb252ZXJ0ZXJzKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIENvbnZlcnRlcnMgcmVnaXN0ZXJlZCBzdWNjZXNzZnVsbHk6ICR7cmVnaXN0ZXJlZFR5cGVzLmxlbmd0aH0gdHlwZXNgKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+TiyBSZWdpc3RlcmVkIHR5cGVzOiAke3JlZ2lzdGVyZWRUeXBlcy5qb2luKCcsICcpfWApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3Igc2V0dGluZyB1cCBjb252ZXJ0ZXJzOicsIGVycm9yKTtcclxuICAgICAgICAvLyBBZGQgZGV0YWlsZWQgZXJyb3IgbG9nZ2luZ1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGRldGFpbHM6Jywge1xyXG4gICAgICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXHJcbiAgICAgICAgICAgIG5hbWU6IGVycm9yLm5hbWVcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBUaHJvdyB0aGUgZXJyb3IgdG8gYmUgaGFuZGxlZCBieSB0aGUgY2FsbGVyXHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gc2V0IHVwIGNvbnZlcnRlcnM6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgIH1cclxufTtcclxuXHJcbi8vIENyZWF0ZSBhbmQgZXhwb3J0IHNpbmdsZXRvbiBpbnN0YW5jZVxyXG52YXIgcmVnaXN0cnkgPSBuZXcgQ29udmVydGVyUmVnaXN0cnkoKTtcclxubW9kdWxlLmV4cG9ydHMgPSByZWdpc3RyeTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsRUFBRSxHQUFHQyxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQzlCLE1BQU1DLElBQUksR0FBR0QsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNO0VBQUVFO0FBQVEsQ0FBQyxHQUFHRixPQUFPLENBQUMsVUFBVSxDQUFDOztBQUV2QztBQUNBO0FBQ0E7QUFDQSxTQUFTRyxpQkFBaUJBLENBQUEsRUFBRztFQUN6QixJQUFJLENBQUNDLFVBQVUsR0FBRyxDQUFDLENBQUM7RUFDcEIsSUFBSSxDQUFDQyxpQkFBaUIsR0FBRyxJQUFJQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7RUFDcEMsSUFBSSxDQUFDQyxlQUFlLENBQUMsQ0FBQztF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