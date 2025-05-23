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
        // Handle completed conversions differently
        if (conv.status === 'completed') {
          // If already retrieved, remove immediately
          if (conv.retrieved) {
            console.log(`[ConverterRegistry] Removing retrieved conversion ${id}`);
            this.activeConversions.delete(id);
            staleCount++;
            return;
          }
          // Keep un-retrieved completed conversions for up to 5 minutes
          if (now - conv.lastPing > 300000) {
            console.warn(`[ConverterRegistry] Removing old completed conversion ${id} (completed ${Math.round((now - conv.lastPing) / 1000)}s ago)`);
            this.activeConversions.delete(id);
            staleCount++;
          }
          return;
        }

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
    const MediaConverter = require('./multimedia/MediaConverter');
    const PdfFactory = require('./document/PdfConverterFactory');
    const DocxConverter = require('./document/DocxConverter');
    const PptxConverter = require('./document/PptxConverter');
    const UrlConverter = require('./web/UrlConverter');
    const ParentUrlConverter = require('./web/ParentUrlConverter');

    // Import singleton service instances
    const fileProcessorServiceInstance = require('../storage/FileProcessorService');
    const fileStorageServiceInstance = require('../storage/FileStorageService');
    const deepgramServiceInstance = require('../ai/DeepgramService');

    // Create instances of converter classes, passing singleton dependencies
    const csvConverterInstance = new CsvConverter();
    const xlsxConverterInstance = new XlsxConverter();
    // Pass the singleton instances to the constructors
    const mediaConverterInstance = new MediaConverter(this, fileProcessorServiceInstance, fileStorageServiceInstance);
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

            // Store original name for later use
            const originalFileName = name;

            // Create a temp file with a generic name
            const tempFile = path.join(tempDir, `excel_conversion_${Date.now()}.xlsx`);
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
            name: originalFileName || name,
            originalFileName: originalFileName || name // Pass the original filename
          });

          // Ensure we have content
          if (!result || typeof result !== 'string' || result.trim() === '') {
            throw new Error('Excel conversion produced empty content');
          }

          // Make sure we're properly returning the original filename
          return {
            success: true,
            content: result,
            name: originalFileName || name,
            type: 'xlsx',
            originalFileName: originalFileName || name // Ensure the original filename is preserved
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

    // Create standardized adapter for media converters (audio and video)
    const mediaAdapter = {
      convert: async (content, name, apiKey, options) => {
        let tempDir = null; // Declare tempDir outside try block for cleanup access
        try {
          console.log(`[MediaAdapter] Converting media file: ${name}`);

          // Ensure content is a Buffer
          if (!Buffer.isBuffer(content)) {
            throw new Error('Media content must be a Buffer');
          }

          // Create a temporary file to process the media
          tempDir = await fileStorageServiceInstance.createTempDir('media_adapter_temp'); // More specific temp dir name
          const tempFileName = `${name}_${Date.now()}${path.extname(name) || '.mp4'}`; // Ensure a valid extension, default to .mp4
          const tempFile = path.join(tempDir, tempFileName);
          console.log(`[MediaAdapter] Writing buffer for '${name}' to temporary file: ${tempFile}`);
          await fs.writeFile(tempFile, content);
          console.log(`[MediaAdapter] Buffer written to ${tempFile}`);

          // Get deepgram API key from options or settings
          // This logic is now primarily handled within MediaConverter, but can be passed as override.
          const deepgramApiKey = options.deepgramApiKey || null;

          // Process the media file using MediaConverter
          // Create a more complete mock event that provides a valid BrowserWindow or null
          // but in a way that won't throw errors when accessing properties
          const mockEvent = {
            sender: {
              getOwnerBrowserWindow: () => null,
              // Add a mock webContents to prevent null reference errors
              webContents: {
                send: (channel, data) => {
                  console.log(`[MediaAdapter] Would send to channel ${channel}:`, data);
                  // This is a no-op function that logs the would-be sent data
                  // but doesn't actually try to communicate with a window
                }
              }
            }
          };
          const result = await mediaConverterInstance.handleConvert(mockEvent, {
            filePath: tempFile,
            // Pass the path to the temporary file containing the buffer content
            options: {
              ...options,
              // Pass through all original options
              isTempInputFile: true,
              // Indicate that filePath is a temp file created by the adapter
              originalFileName: name,
              // Pass the original file name
              deepgramApiKey: deepgramApiKey // Pass explicitly if provided, otherwise MediaConverter will find it
              // _tempDir is no longer needed here as MediaConverter handles its own temp space or cleans the input temp dir
            }
          });

          // mediaConverterInstance.handleConvert now returns { conversionId, originalFileName }
          // The success of the *initiation* is implied if no error is thrown.
          // The actual conversion result is asynchronous.
          console.log(`[MediaAdapter] Media conversion initiated for '${name}'. Conversion ID: ${result.conversionId}`);
          return {
            success: true,
            // Indicates successful initiation
            conversionId: result.conversionId,
            async: true,
            // Critical: signals to client that result is async
            name: result.originalFileName || name,
            // Use originalFileName from result if available
            type: 'media',
            // Or derive from actual file type if needed
            // Add a flag to indicate that this is a transcription conversion
            isTranscription: true // This will be used to handle transcription failures differently
          };
        } catch (error) {
          const errorMessage = error.message || 'Unknown error in media adapter';
          console.error(`[MediaAdapter] Error converting media file '${name}':`, error);
          // If tempDir was created, attempt to clean it up.
          if (tempDir) {
            try {
              const exists = await fs.pathExists(tempDir);
              if (exists) {
                await fs.remove(tempDir);
                console.log(`[MediaAdapter] Cleaned up temp directory ${tempDir} after error.`);
              }
            } catch (cleanupError) {
              console.error(`[MediaAdapter] Failed to clean up temp directory ${tempDir} after error:`, cleanupError);
            }
          }
          throw new Error(`Media conversion failed for '${name}': ${errorMessage}`);
        }
      },
      validate: content => Buffer.isBuffer(content) && content.length > 0,
      // This adapter is for buffer inputs
      config: {
        name: 'Media Converter',
        extensions: ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.mp4', '.mov', '.avi', '.mkv', '.webm'],
        mimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/flac', 'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'],
        maxSize: 500 * 1024 * 1024 // 500MB
      }
    };

    // Register all media formats to use the same converter
    this.register('mp3', mediaAdapter);
    this.register('wav', mediaAdapter);
    this.register('ogg', mediaAdapter);
    this.register('m4a', mediaAdapter);
    this.register('flac', mediaAdapter);
    this.register('mp4', mediaAdapter);
    this.register('mov', mediaAdapter);
    this.register('avi', mediaAdapter);
    this.register('mkv', mediaAdapter);
    this.register('webm', mediaAdapter);

    // Register ppt extension to use the same converter as pptx
    this.register('ppt', this.converters['pptx']);

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
        let conversionResult;
        try {
          console.log(`[UrlAdapter] Converting URL: ${content}`);
          console.log(`[UrlAdapter] fileStorageServiceInstance available:`, !!fileStorageServiceInstance);
          console.log(`[UrlAdapter] Creating temp directory...`);

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
            console.error(`[UrlAdapter] Inner error:`, error);
            console.error(`[UrlAdapter] Error stack:`, error.stack);
            // Close browser on error
            await browser.close();

            // Clean up temporary directory
            await fs.remove(tempDir);

            // Re-throw error
            throw error;
          }
        } catch (error) {
          console.error(`[UrlAdapter] Error converting URL: ${error.message}`);
          console.error(`[UrlAdapter] Full error:`, error);
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

            // Generate markdown files based on save mode
            const saveMode = options.websiteScraping?.saveMode || 'combined';
            console.log(`[ParentUrlAdapter] Using save mode: ${saveMode}`);
            let result;
            if (saveMode === 'separate') {
              // Generate separate files
              result = await parentUrlConverterInstance.generateSeparateFiles(sitemap, processedPages, options, tempDir);

              // Close browser
              await browser.close();

              // Don't remove tempDir as files are already moved to final location

              // Return the multiple files result
              return {
                success: true,
                ...result,
                name: name
              };
            } else {
              // Generate combined markdown (default behavior)
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
            }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJwYXRoIiwiaXBjTWFpbiIsIkNvbnZlcnRlclJlZ2lzdHJ5IiwiY29udmVydGVycyIsImFjdGl2ZUNvbnZlcnNpb25zIiwiTWFwIiwic2V0dXBDb252ZXJ0ZXJzIiwic2V0dXBDb252ZXJzaW9uVmFsaWRhdGlvbiIsInByb2Nlc3MiLCJvbiIsImNsZWFudXAiLCJleGl0IiwicHJvdG90eXBlIiwidmFsaWRhdGlvbkludGVydmFsIiwic2V0SW50ZXJ2YWwiLCJub3ciLCJEYXRlIiwic3RhbGVDb3VudCIsIkFycmF5IiwiZnJvbSIsImVudHJpZXMiLCJmb3JFYWNoIiwiaWQiLCJjb252Iiwic3RhdHVzIiwicmV0cmlldmVkIiwiY29uc29sZSIsImxvZyIsImRlbGV0ZSIsImxhc3RQaW5nIiwid2FybiIsIk1hdGgiLCJyb3VuZCIsImNsZWFudXBFcnJvciIsImVycm9yIiwic2l6ZSIsInJlZ2lzdGVyQ29udmVyc2lvbiIsImNvbnZlcnNpb25EYXRhIiwic2V0IiwicGluZ0NvbnZlcnNpb24iLCJ1cGRhdGVzIiwiY29udmVyc2lvbiIsImdldCIsInJlbW92ZUNvbnZlcnNpb24iLCJnZXRDb252ZXJzaW9uIiwiY2xlYXJJbnRlcnZhbCIsImNvbnZlcnNpb25Db3VudCIsImNsZWFyIiwicmVnaXN0ZXIiLCJ0eXBlIiwiY29udmVydGVyIiwiZ2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJleHRlbnNpb24iLCJub3JtYWxpemVkRXh0IiwidG9Mb3dlckNhc2UiLCJyZXBsYWNlIiwiZ2V0Q29udmVydGVyQnlNaW1lVHlwZSIsIm1pbWVUeXBlIiwiT2JqZWN0IiwiY29uZmlnIiwibWltZVR5cGVzIiwiaW5jbHVkZXMiLCJjb252ZXJ0VG9NYXJrZG93biIsImNvbnRlbnQiLCJvcHRpb25zIiwiRXJyb3IiLCJjb252ZXJ0IiwibmFtZSIsImFwaUtleSIsIkNzdkNvbnZlcnRlciIsIlhsc3hDb252ZXJ0ZXIiLCJNZWRpYUNvbnZlcnRlciIsIlBkZkZhY3RvcnkiLCJEb2N4Q29udmVydGVyIiwiUHB0eENvbnZlcnRlciIsIlVybENvbnZlcnRlciIsIlBhcmVudFVybENvbnZlcnRlciIsImZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UiLCJmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZSIsImRlZXBncmFtU2VydmljZUluc3RhbmNlIiwiY3N2Q29udmVydGVySW5zdGFuY2UiLCJ4bHN4Q29udmVydGVySW5zdGFuY2UiLCJtZWRpYUNvbnZlcnRlckluc3RhbmNlIiwicGRmQ29udmVydGVyRmFjdG9yeSIsImRvY3hDb252ZXJ0ZXJJbnN0YW5jZSIsInBwdHhDb252ZXJ0ZXJJbnN0YW5jZSIsInVybENvbnZlcnRlckluc3RhbmNlIiwicGFyZW50VXJsQ29udmVydGVySW5zdGFuY2UiLCJCdWZmZXIiLCJpc0J1ZmZlciIsInJlc3VsdCIsImZpbGVOYW1lIiwidHJpbSIsInN1Y2Nlc3MiLCJtZXNzYWdlIiwidmFsaWRhdGUiLCJsZW5ndGgiLCJleHRlbnNpb25zIiwibWF4U2l6ZSIsImNvbnRlbnRTdHIiLCJ0b1N0cmluZyIsIm9yaWdpbmFsRmlsZU5hbWUiLCJ4bHN4Iiwid29ya2Jvb2siLCJvcyIsInRlbXBEaXIiLCJqb2luIiwidG1wZGlyIiwiZW5zdXJlRGlyIiwidGVtcEZpbGUiLCJ3cml0ZUZpbGUiLCJyZWFkRmlsZSIsImNlbGxEYXRlcyIsInhsc3hPcHRpb25zIiwicmVtb3ZlIiwicmVhZEVycm9yIiwibWVkaWFBZGFwdGVyIiwiY3JlYXRlVGVtcERpciIsInRlbXBGaWxlTmFtZSIsImV4dG5hbWUiLCJkZWVwZ3JhbUFwaUtleSIsIm1vY2tFdmVudCIsInNlbmRlciIsImdldE93bmVyQnJvd3NlcldpbmRvdyIsIndlYkNvbnRlbnRzIiwic2VuZCIsImNoYW5uZWwiLCJkYXRhIiwiaGFuZGxlQ29udmVydCIsImZpbGVQYXRoIiwiaXNUZW1wSW5wdXRGaWxlIiwiY29udmVyc2lvbklkIiwiYXN5bmMiLCJpc1RyYW5zY3JpcHRpb24iLCJlcnJvck1lc3NhZ2UiLCJleGlzdHMiLCJwYXRoRXhpc3RzIiwidXNlT2NyIiwibWlzdHJhbEFwaUtleSIsIk1pc3RyYWxQZGZDb252ZXJ0ZXJDbGFzcyIsIm1pc3RyYWxDb252ZXJ0ZXIiLCJTdGFuZGFyZFBkZkNvbnZlcnRlckNsYXNzIiwic3RhbmRhcmRDb252ZXJ0ZXIiLCJjb252ZXJzaW9uUmVzdWx0IiwicHVwcGV0ZWVyIiwiYnJvd3NlciIsImxhdW5jaCIsImhlYWRsZXNzIiwiYXJncyIsIm1ldGFkYXRhIiwiZmV0Y2hNZXRhZGF0YSIsImV4dHJhY3RlZENvbnRlbnQiLCJleHRyYWN0Q29udGVudCIsImluY2x1ZGVJbWFnZXMiLCJwcm9jZXNzSW1hZ2VzIiwibWFya2Rvd24iLCJnZW5lcmF0ZU1hcmtkb3duIiwiY2xvc2UiLCJzdGFjayIsInNpdGVtYXAiLCJkaXNjb3ZlclNpdGVtYXAiLCJtYXhQYWdlcyIsIm1pbiIsInBhZ2VzIiwicGFnZXNUb1Byb2Nlc3MiLCJzbGljZSIsInByb2Nlc3NlZFBhZ2VzIiwicGFnZSIsInBhZ2VDb250ZW50IiwicHJvY2Vzc1BhZ2UiLCJ1cmwiLCJwdXNoIiwidGl0bGUiLCJzYXZlTW9kZSIsIndlYnNpdGVTY3JhcGluZyIsImdlbmVyYXRlU2VwYXJhdGVGaWxlcyIsImdlbmVyYXRlQ29tYmluZWRNYXJrZG93biIsInJlZ2lzdGVyZWRUeXBlcyIsImtleXMiLCJyZWdpc3RyeSIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogQ29udmVydGVyUmVnaXN0cnkuanNcclxuICogXHJcbiAqIENlbnRyYWwgcmVnaXN0cnkgZm9yIGFsbCBmaWxlIHR5cGUgY29udmVydGVycyBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBQcm92aWRlcyBhIHVuaWZpZWQgaW50ZXJmYWNlIGZvciBhY2Nlc3NpbmcgY29udmVydGVycyBiYXNlZCBvbiBmaWxlIHR5cGUuXHJcbiAqIFxyXG4gKiBUaGlzIGZpbGUgd2FzIGNyZWF0ZWQgYXMgcGFydCBvZiB0aGUgY29uc29saWRhdGlvbiBwcm9jZXNzIHRvIGNlbnRyYWxpemVcclxuICogYWxsIGNvbnZlcnRlciBmdW5jdGlvbmFsaXR5IGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNyYy9lbGVjdHJvbi9jb252ZXJ0ZXJzL1VuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmpzOiBVc2VzIHRoaXMgcmVnaXN0cnkgZm9yIGNvbnZlcnNpb25zXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanM6IFJlZmVyZW5jZXMgdGhpcyByZWdpc3RyeVxyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL2RhdGEvKi5qczogRGF0YSBjb252ZXJ0ZXJzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vZG9jdW1lbnQvKi5qczogRG9jdW1lbnQgY29udmVydGVyc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL211bHRpbWVkaWEvKi5qczogTXVsdGltZWRpYSBjb252ZXJ0ZXJzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vd2ViLyouanM6IFdlYiBjb252ZXJ0ZXJzXHJcbiAqL1xyXG5cclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IGlwY01haW4gfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcblxyXG4vKipcclxuICogUmVnaXN0cnkgZm9yIGFsbCBmaWxlIHR5cGUgY29udmVydGVyc1xyXG4gKi9cclxuZnVuY3Rpb24gQ29udmVydGVyUmVnaXN0cnkoKSB7XHJcbiAgICB0aGlzLmNvbnZlcnRlcnMgPSB7fTtcclxuICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMgPSBuZXcgTWFwKCk7IC8vIEdsb2JhbCBtYXAgdG8gdHJhY2sgYWxsIGFjdGl2ZSBjb252ZXJzaW9uc1xyXG4gICAgdGhpcy5zZXR1cENvbnZlcnRlcnMoKTtcclxuICAgIHRoaXMuc2V0dXBDb252ZXJzaW9uVmFsaWRhdGlvbigpO1xyXG4gICAgXHJcbiAgICAvLyBDbGVhbiB1cCByZXNvdXJjZXMgd2hlbiB0aGUgcHJvY2VzcyBleGl0c1xyXG4gICAgcHJvY2Vzcy5vbignZXhpdCcsICgpID0+IHRoaXMuY2xlYW51cCgpKTtcclxuICAgIHByb2Nlc3Mub24oJ1NJR0lOVCcsICgpID0+IHtcclxuICAgICAgICB0aGlzLmNsZWFudXAoKTtcclxuICAgICAgICBwcm9jZXNzLmV4aXQoMCk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFNldHMgdXAgcGVyaW9kaWMgdmFsaWRhdGlvbiBvZiBhY3RpdmUgY29udmVyc2lvbnMgdG8gY2xlYW4gdXAgc3RhbGUgb25lcy5cclxuICogVGhpcyBoZWxwcyBwcmV2ZW50IG1lbW9yeSBsZWFrcyBhbmQgcmVzb3VyY2UgaXNzdWVzIGJ5IHJlbW92aW5nIGNvbnZlcnNpb25zXHJcbiAqIHRoYXQgaGF2ZW4ndCBiZWVuIHVwZGF0ZWQgcmVjZW50bHkuXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuc2V0dXBDb252ZXJzaW9uVmFsaWRhdGlvbiA9IGZ1bmN0aW9uKCkge1xyXG4gICAgLy8gU2V0IHVwIGludGVydmFsIHRvIGNoZWNrIGZvciBzdGFsZSBjb252ZXJzaW9ucyBldmVyeSBtaW51dGVcclxuICAgIHRoaXMudmFsaWRhdGlvbkludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XHJcbiAgICAgICAgICAgIGxldCBzdGFsZUNvdW50ID0gMDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENoZWNrIGFsbCBhY3RpdmUgY29udmVyc2lvbnNcclxuICAgICAgICAgICAgQXJyYXkuZnJvbSh0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmVudHJpZXMoKSkuZm9yRWFjaCgoW2lkLCBjb252XSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgLy8gSGFuZGxlIGNvbXBsZXRlZCBjb252ZXJzaW9ucyBkaWZmZXJlbnRseVxyXG4gICAgICAgICAgICAgICAgaWYgKGNvbnYuc3RhdHVzID09PSAnY29tcGxldGVkJykge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIElmIGFscmVhZHkgcmV0cmlldmVkLCByZW1vdmUgaW1tZWRpYXRlbHlcclxuICAgICAgICAgICAgICAgICAgICBpZiAoY29udi5yZXRyaWV2ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtDb252ZXJ0ZXJSZWdpc3RyeV0gUmVtb3ZpbmcgcmV0cmlldmVkIGNvbnZlcnNpb24gJHtpZH1gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5kZWxldGUoaWQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGFsZUNvdW50Kys7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gS2VlcCB1bi1yZXRyaWV2ZWQgY29tcGxldGVkIGNvbnZlcnNpb25zIGZvciB1cCB0byA1IG1pbnV0ZXNcclxuICAgICAgICAgICAgICAgICAgICBpZiAobm93IC0gY29udi5sYXN0UGluZyA+IDMwMDAwMCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtDb252ZXJ0ZXJSZWdpc3RyeV0gUmVtb3Zpbmcgb2xkIGNvbXBsZXRlZCBjb252ZXJzaW9uICR7aWR9IChjb21wbGV0ZWQgJHtNYXRoLnJvdW5kKChub3cgLSBjb252Lmxhc3RQaW5nKSAvIDEwMDApfXMgYWdvKWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmRlbGV0ZShpZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YWxlQ291bnQrKztcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBDb25zaWRlciBhIGNvbnZlcnNpb24gc3RhbGUgaWYgaXQgaGFzbid0IHBpbmdlZCBpbiB0aGUgbGFzdCAzMCBzZWNvbmRzXHJcbiAgICAgICAgICAgICAgICBpZiAobm93IC0gY29udi5sYXN0UGluZyA+IDMwMDAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gUmVtb3ZlIHRoZSBzdGFsZSBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5kZWxldGUoaWQpO1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YWxlQ291bnQrKztcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBMb2cgdGhlIHJlbW92YWxcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtDb252ZXJ0ZXJSZWdpc3RyeV0gU3RhbGUgY29udmVyc2lvbiAke2lkfSByZW1vdmVkIChpbmFjdGl2ZSBmb3IgJHtNYXRoLnJvdW5kKChub3cgLSBjb252Lmxhc3RQaW5nKSAvIDEwMDApfXMpYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgdGhlIGNvbnZlcnNpb24gaGFzIGEgY2xlYW51cCBmdW5jdGlvbiwgY2FsbCBpdFxyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY29udi5jbGVhbnVwID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb252LmNsZWFudXAoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbQ29udmVydGVyUmVnaXN0cnldIEVycm9yIGNsZWFuaW5nIHVwIGNvbnZlcnNpb24gJHtpZH06YCwgY2xlYW51cEVycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBMb2cgc3VtbWFyeSBpZiBhbnkgc3RhbGUgY29udmVyc2lvbnMgd2VyZSByZW1vdmVkXHJcbiAgICAgICAgICAgIGlmIChzdGFsZUNvdW50ID4gMCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtDb252ZXJ0ZXJSZWdpc3RyeV0gUmVtb3ZlZCAke3N0YWxlQ291bnR9IHN0YWxlIGNvbnZlcnNpb25zLiBBY3RpdmUgY29udmVyc2lvbnMgcmVtYWluaW5nOiAke3RoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2l6ZX1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tDb252ZXJ0ZXJSZWdpc3RyeV0gRXJyb3IgZHVyaW5nIGNvbnZlcnNpb24gdmFsaWRhdGlvbjonLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgfSwgNjAwMDApOyAvLyBSdW4gZXZlcnkgNjAgc2Vjb25kc1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlZ2lzdGVycyBhbiBhY3RpdmUgY29udmVyc2lvbiB3aXRoIHRoZSByZWdpc3RyeS5cclxuICogQHBhcmFtIHtzdHJpbmd9IGlkIC0gVW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBjb252ZXJzaW9uXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBjb252ZXJzaW9uRGF0YSAtIERhdGEgYWJvdXQgdGhlIGNvbnZlcnNpb25cclxuICogQHBhcmFtIHtGdW5jdGlvbn0gW2NsZWFudXBdIC0gT3B0aW9uYWwgY2xlYW51cCBmdW5jdGlvbiB0byBjYWxsIHdoZW4gdGhlIGNvbnZlcnNpb24gaXMgcmVtb3ZlZFxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLnJlZ2lzdGVyQ29udmVyc2lvbiA9IGZ1bmN0aW9uKGlkLCBjb252ZXJzaW9uRGF0YSwgY2xlYW51cCkge1xyXG4gICAgaWYgKCFpZCkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tDb252ZXJ0ZXJSZWdpc3RyeV0gQ2Fubm90IHJlZ2lzdGVyIGNvbnZlcnNpb24gd2l0aG91dCBJRCcpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zZXQoaWQsIHtcclxuICAgICAgICAuLi5jb252ZXJzaW9uRGF0YSxcclxuICAgICAgICBsYXN0UGluZzogRGF0ZS5ub3coKSxcclxuICAgICAgICBjbGVhbnVwOiBjbGVhbnVwXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coYFtDb252ZXJ0ZXJSZWdpc3RyeV0gUmVnaXN0ZXJlZCBjb252ZXJzaW9uICR7aWR9LiBUb3RhbCBhY3RpdmU6ICR7dGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zaXplfWApO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFVwZGF0ZXMgdGhlIGxhc3QgcGluZyB0aW1lIGZvciBhbiBhY3RpdmUgY29udmVyc2lvbiB0byBrZWVwIGl0IGFsaXZlLlxyXG4gKiBAcGFyYW0ge3N0cmluZ30gaWQgLSBVbmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGNvbnZlcnNpb25cclxuICogQHBhcmFtIHtPYmplY3R9IFt1cGRhdGVzXSAtIE9wdGlvbmFsIHVwZGF0ZXMgdG8gdGhlIGNvbnZlcnNpb24gZGF0YVxyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjb252ZXJzaW9uIHdhcyBmb3VuZCBhbmQgdXBkYXRlZFxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLnBpbmdDb252ZXJzaW9uID0gZnVuY3Rpb24oaWQsIHVwZGF0ZXMgPSB7fSkge1xyXG4gICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGlkKTtcclxuICAgIGlmICghY29udmVyc2lvbikge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gVXBkYXRlIHRoZSBsYXN0IHBpbmcgdGltZSBhbmQgYW55IG90aGVyIHByb3ZpZGVkIHVwZGF0ZXNcclxuICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2V0KGlkLCB7XHJcbiAgICAgICAgLi4uY29udmVyc2lvbixcclxuICAgICAgICAuLi51cGRhdGVzLFxyXG4gICAgICAgIGxhc3RQaW5nOiBEYXRlLm5vdygpXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHRydWU7XHJcbn07XHJcblxyXG4vKipcclxuICogUmVtb3ZlcyBhbiBhY3RpdmUgY29udmVyc2lvbiBmcm9tIHRoZSByZWdpc3RyeS5cclxuICogQHBhcmFtIHtzdHJpbmd9IGlkIC0gVW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBjb252ZXJzaW9uXHJcbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbnZlcnNpb24gd2FzIGZvdW5kIGFuZCByZW1vdmVkXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUucmVtb3ZlQ29udmVyc2lvbiA9IGZ1bmN0aW9uKGlkKSB7XHJcbiAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoaWQpO1xyXG4gICAgaWYgKCFjb252ZXJzaW9uKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBJZiB0aGUgY29udmVyc2lvbiBoYXMgYSBjbGVhbnVwIGZ1bmN0aW9uLCBjYWxsIGl0XHJcbiAgICBpZiAodHlwZW9mIGNvbnZlcnNpb24uY2xlYW51cCA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnZlcnNpb24uY2xlYW51cCgpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbQ29udmVydGVyUmVnaXN0cnldIEVycm9yIGNsZWFuaW5nIHVwIGNvbnZlcnNpb24gJHtpZH06YCwgY2xlYW51cEVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFJlbW92ZSB0aGUgY29udmVyc2lvblxyXG4gICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5kZWxldGUoaWQpO1xyXG4gICAgY29uc29sZS5sb2coYFtDb252ZXJ0ZXJSZWdpc3RyeV0gUmVtb3ZlZCBjb252ZXJzaW9uICR7aWR9LiBUb3RhbCBhY3RpdmU6ICR7dGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zaXplfWApO1xyXG4gICAgXHJcbiAgICByZXR1cm4gdHJ1ZTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXRzIGFuIGFjdGl2ZSBjb252ZXJzaW9uIGZyb20gdGhlIHJlZ2lzdHJ5LlxyXG4gKiBAcGFyYW0ge3N0cmluZ30gaWQgLSBVbmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGNvbnZlcnNpb25cclxuICogQHJldHVybnMge09iamVjdHxudWxsfSAtIFRoZSBjb252ZXJzaW9uIGRhdGEgb3IgbnVsbCBpZiBub3QgZm91bmRcclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5nZXRDb252ZXJzaW9uID0gZnVuY3Rpb24oaWQpIHtcclxuICAgIHJldHVybiB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChpZCkgfHwgbnVsbDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBDbGVhbnMgdXAgcmVzb3VyY2VzIHVzZWQgYnkgdGhlIHJlZ2lzdHJ5LlxyXG4gKiBUaGlzIHNob3VsZCBiZSBjYWxsZWQgd2hlbiB0aGUgYXBwbGljYXRpb24gaXMgc2h1dHRpbmcgZG93bi5cclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5jbGVhbnVwID0gZnVuY3Rpb24oKSB7XHJcbiAgICAvLyBDbGVhciB0aGUgdmFsaWRhdGlvbiBpbnRlcnZhbFxyXG4gICAgaWYgKHRoaXMudmFsaWRhdGlvbkludGVydmFsKSB7XHJcbiAgICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnZhbGlkYXRpb25JbnRlcnZhbCk7XHJcbiAgICAgICAgdGhpcy52YWxpZGF0aW9uSW50ZXJ2YWwgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBDbGVhbiB1cCBhbGwgYWN0aXZlIGNvbnZlcnNpb25zXHJcbiAgICBjb25zdCBjb252ZXJzaW9uQ291bnQgPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNpemU7XHJcbiAgICBpZiAoY29udmVyc2lvbkNvdW50ID4gMCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbQ29udmVydGVyUmVnaXN0cnldIENsZWFuaW5nIHVwICR7Y29udmVyc2lvbkNvdW50fSBhY3RpdmUgY29udmVyc2lvbnNgKTtcclxuICAgICAgICBcclxuICAgICAgICBBcnJheS5mcm9tKHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZW50cmllcygpKS5mb3JFYWNoKChbaWQsIGNvbnZdKSA9PiB7XHJcbiAgICAgICAgICAgIC8vIElmIHRoZSBjb252ZXJzaW9uIGhhcyBhIGNsZWFudXAgZnVuY3Rpb24sIGNhbGwgaXRcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBjb252LmNsZWFudXAgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udi5jbGVhbnVwKCk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbQ29udmVydGVyUmVnaXN0cnldIEVycm9yIGNsZWFuaW5nIHVwIGNvbnZlcnNpb24gJHtpZH06YCwgY2xlYW51cEVycm9yKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENsZWFyIHRoZSBtYXBcclxuICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmNsZWFyKCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCdbQ29udmVydGVyUmVnaXN0cnldIENsZWFudXAgY29tcGxldGUnKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZWdpc3RlciBhIGNvbnZlcnRlciBmb3IgYSBzcGVjaWZpYyBmaWxlIHR5cGVcclxuICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBGaWxlIHR5cGUgKGV4dGVuc2lvbiB3aXRob3V0IGRvdClcclxuICogQHBhcmFtIHtPYmplY3R9IGNvbnZlcnRlciAtIENvbnZlcnRlciBpbXBsZW1lbnRhdGlvblxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLnJlZ2lzdGVyID0gZnVuY3Rpb24odHlwZSwgY29udmVydGVyKSB7XHJcbiAgICB0aGlzLmNvbnZlcnRlcnNbdHlwZV0gPSBjb252ZXJ0ZXI7XHJcbiAgICBjb25zb2xlLmxvZyhgUmVnaXN0ZXJlZCBjb252ZXJ0ZXIgZm9yICR7dHlwZX1gKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXQgY29udmVydGVyIGJ5IGZpbGUgZXh0ZW5zaW9uXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBleHRlbnNpb24gLSBGaWxlIGV4dGVuc2lvbiAod2l0aCBvciB3aXRob3V0IGRvdClcclxuICogQHJldHVybnMge09iamVjdHxudWxsfSBDb252ZXJ0ZXIgb3IgbnVsbCBpZiBub3QgZm91bmRcclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiA9IGZ1bmN0aW9uKGV4dGVuc2lvbikge1xyXG4gICAgLy8gTm9ybWFsaXplIGV4dGVuc2lvbiAocmVtb3ZlIGRvdCwgbG93ZXJjYXNlKVxyXG4gICAgY29uc3Qgbm9ybWFsaXplZEV4dCA9IGV4dGVuc2lvbi50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL15cXC4vLCAnJyk7XHJcbiAgICByZXR1cm4gdGhpcy5jb252ZXJ0ZXJzW25vcm1hbGl6ZWRFeHRdIHx8IG51bGw7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0IGNvbnZlcnRlciBieSBNSU1FIHR5cGVcclxuICogQHBhcmFtIHtzdHJpbmd9IG1pbWVUeXBlIC0gTUlNRSB0eXBlXHJcbiAqIEByZXR1cm5zIHtPYmplY3R8bnVsbH0gQ29udmVydGVyIG9yIG51bGwgaWYgbm90IGZvdW5kXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuZ2V0Q29udmVydGVyQnlNaW1lVHlwZSA9IGZ1bmN0aW9uKG1pbWVUeXBlKSB7XHJcbiAgICAvLyBGaW5kIGNvbnZlcnRlciB0aGF0IHN1cHBvcnRzIHRoaXMgTUlNRSB0eXBlXHJcbiAgICBmb3IgKGNvbnN0IFt0eXBlLCBjb252ZXJ0ZXJdIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuY29udmVydGVycykpIHtcclxuICAgICAgICBpZiAoY29udmVydGVyLmNvbmZpZyAmJiBcclxuICAgICAgICAgICAgY29udmVydGVyLmNvbmZpZy5taW1lVHlwZXMgJiYgXHJcbiAgICAgICAgICAgIGNvbnZlcnRlci5jb25maWcubWltZVR5cGVzLmluY2x1ZGVzKG1pbWVUeXBlKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gY29udmVydGVyO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIENvbnZlcnQgY29udGVudCB0byBtYXJrZG93biB1c2luZyBhcHByb3ByaWF0ZSBjb252ZXJ0ZXJcclxuICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBGaWxlIHR5cGVcclxuICogQHBhcmFtIHtCdWZmZXJ8c3RyaW5nfSBjb250ZW50IC0gQ29udGVudCB0byBjb252ZXJ0XHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IENvbnZlcnNpb24gcmVzdWx0XHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuY29udmVydFRvTWFya2Rvd24gPSBhc3luYyBmdW5jdGlvbih0eXBlLCBjb250ZW50LCBvcHRpb25zKSB7XHJcbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgIGNvbnN0IGNvbnZlcnRlciA9IHRoaXMuZ2V0Q29udmVydGVyQnlFeHRlbnNpb24odHlwZSk7XHJcbiAgICBpZiAoIWNvbnZlcnRlcikge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gY29udmVydGVyIGZvdW5kIGZvciB0eXBlOiAke3R5cGV9YCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBhd2FpdCBjb252ZXJ0ZXIuY29udmVydChjb250ZW50LCBvcHRpb25zLm5hbWUgfHwgJ2ZpbGUnLCBvcHRpb25zLmFwaUtleSwgb3B0aW9ucyk7XHJcbn07XHJcblxyXG4vKipcclxuICogU2V0dXAgYWxsIGF2YWlsYWJsZSBjb252ZXJ0ZXJzXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuc2V0dXBDb252ZXJ0ZXJzID0gZnVuY3Rpb24oKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIC8vIEltcG9ydCBjb252ZXJ0ZXJzIGZyb20gdGhlIG5ldyBsb2NhdGlvblxyXG4gICAgICAgIGNvbnN0IENzdkNvbnZlcnRlciA9IHJlcXVpcmUoJy4vZGF0YS9Dc3ZDb252ZXJ0ZXInKTtcclxuICAgICAgICBjb25zdCBYbHN4Q29udmVydGVyID0gcmVxdWlyZSgnLi9kYXRhL1hsc3hDb252ZXJ0ZXInKTtcclxuICAgICAgICBjb25zdCBNZWRpYUNvbnZlcnRlciA9IHJlcXVpcmUoJy4vbXVsdGltZWRpYS9NZWRpYUNvbnZlcnRlcicpO1xyXG4gICAgICAgIGNvbnN0IFBkZkZhY3RvcnkgPSByZXF1aXJlKCcuL2RvY3VtZW50L1BkZkNvbnZlcnRlckZhY3RvcnknKTtcclxuICAgICAgICBjb25zdCBEb2N4Q29udmVydGVyID0gcmVxdWlyZSgnLi9kb2N1bWVudC9Eb2N4Q29udmVydGVyJyk7XHJcbiAgICAgICAgY29uc3QgUHB0eENvbnZlcnRlciA9IHJlcXVpcmUoJy4vZG9jdW1lbnQvUHB0eENvbnZlcnRlcicpO1xyXG4gICAgICAgIGNvbnN0IFVybENvbnZlcnRlciA9IHJlcXVpcmUoJy4vd2ViL1VybENvbnZlcnRlcicpO1xyXG4gICAgICAgIGNvbnN0IFBhcmVudFVybENvbnZlcnRlciA9IHJlcXVpcmUoJy4vd2ViL1BhcmVudFVybENvbnZlcnRlcicpO1xyXG5cclxuICAgICAgICAvLyBJbXBvcnQgc2luZ2xldG9uIHNlcnZpY2UgaW5zdGFuY2VzXHJcbiAgICAgICAgY29uc3QgZmlsZVByb2Nlc3NvclNlcnZpY2VJbnN0YW5jZSA9IHJlcXVpcmUoJy4uL3N0b3JhZ2UvRmlsZVByb2Nlc3NvclNlcnZpY2UnKTtcclxuICAgICAgICBjb25zdCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZSA9IHJlcXVpcmUoJy4uL3N0b3JhZ2UvRmlsZVN0b3JhZ2VTZXJ2aWNlJyk7XHJcbiAgICAgICAgY29uc3QgZGVlcGdyYW1TZXJ2aWNlSW5zdGFuY2UgPSByZXF1aXJlKCcuLi9haS9EZWVwZ3JhbVNlcnZpY2UnKTtcclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIGluc3RhbmNlcyBvZiBjb252ZXJ0ZXIgY2xhc3NlcywgcGFzc2luZyBzaW5nbGV0b24gZGVwZW5kZW5jaWVzXHJcbiAgICAgICAgY29uc3QgY3N2Q29udmVydGVySW5zdGFuY2UgPSBuZXcgQ3N2Q29udmVydGVyKCk7XHJcbiAgICAgICAgY29uc3QgeGxzeENvbnZlcnRlckluc3RhbmNlID0gbmV3IFhsc3hDb252ZXJ0ZXIoKTtcclxuICAgICAgICAvLyBQYXNzIHRoZSBzaW5nbGV0b24gaW5zdGFuY2VzIHRvIHRoZSBjb25zdHJ1Y3RvcnNcclxuICAgICAgICBjb25zdCBtZWRpYUNvbnZlcnRlckluc3RhbmNlID0gbmV3IE1lZGlhQ29udmVydGVyKHRoaXMsIGZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UsIGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlKTtcclxuICAgICAgICBjb25zdCBwZGZDb252ZXJ0ZXJGYWN0b3J5ID0gbmV3IFBkZkZhY3RvcnkoKTtcclxuICAgICAgICBjb25zdCBkb2N4Q29udmVydGVySW5zdGFuY2UgPSBuZXcgRG9jeENvbnZlcnRlcigpO1xyXG4gICAgICAgIGNvbnN0IHBwdHhDb252ZXJ0ZXJJbnN0YW5jZSA9IG5ldyBQcHR4Q29udmVydGVyKCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gSW5zdGFudGlhdGUgVVJMIGNvbnZlcnRlcnMgd2l0aCBzaW5nbGV0b24gZGVwZW5kZW5jaWVzIChvciBtb2NrcyBpZiBhcHByb3ByaWF0ZSlcclxuICAgICAgICAvLyBOb3RlOiBVUkwgY29udmVydGVycyBtaWdodCBub3QgbmVlZCB0aGUgZnVsbCBmaWxlIHNlcnZpY2VzLCB1c2luZyBtb2NrcyBtaWdodCBzdGlsbCBiZSBva2F5IGhlcmVcclxuICAgICAgICAvLyBVc2luZyBzaW5nbGV0b25zIGZvciBjb25zaXN0ZW5jeSwgYnV0IGNvdWxkIHJldmVydCB0byBtb2NrcyBpZiBuZWVkZWQuXHJcbiAgICAgICAgY29uc3QgdXJsQ29udmVydGVySW5zdGFuY2UgPSBuZXcgVXJsQ29udmVydGVyKGZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UsIGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlKTtcclxuICAgICAgICBjb25zdCBwYXJlbnRVcmxDb252ZXJ0ZXJJbnN0YW5jZSA9IG5ldyBQYXJlbnRVcmxDb252ZXJ0ZXIoZmlsZVByb2Nlc3NvclNlcnZpY2VJbnN0YW5jZSwgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UpO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIERPQ1ggY29udmVydGVyIHVzaW5nIHRoZSBhY3R1YWwgaW1wbGVtZW50YXRpb25cclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdkb2N4Jywge1xyXG4gICAgICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRG9jeEFkYXB0ZXJdIENvbnZlcnRpbmcgRE9DWCBmaWxlOiAke25hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIGNvbnRlbnQgaXMgYSBCdWZmZXJcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihjb250ZW50KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0RPQ1ggY29udGVudCBtdXN0IGJlIGEgQnVmZmVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSB0aGUgYWN0dWFsIERvY3hDb252ZXJ0ZXIgaW1wbGVtZW50YXRpb25cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2N4Q29udmVydGVySW5zdGFuY2UuY29udmVydFRvTWFya2Rvd24oY29udGVudCwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxlTmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXBpS2V5XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHdlIGhhdmUgY29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcmVzdWx0IHx8IHR5cGVvZiByZXN1bHQgIT09ICdzdHJpbmcnIHx8IHJlc3VsdC50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRE9DWCBjb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQnKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogcmVzdWx0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnZG9jeCdcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbRG9jeEFkYXB0ZXJdIEVycm9yIGNvbnZlcnRpbmcgRE9DWDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRE9DWCBjb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB2YWxpZGF0ZTogKGNvbnRlbnQpID0+IEJ1ZmZlci5pc0J1ZmZlcihjb250ZW50KSAmJiBjb250ZW50Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ0RPQ1ggQ29udmVydGVyJyxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLmRvY3gnLCAnLmRvYyddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC53b3JkcHJvY2Vzc2luZ21sLmRvY3VtZW50JywgJ2FwcGxpY2F0aW9uL21zd29yZCddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAwICogMTAyNCAqIDEwMjQgLy8gMTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgYWRhcHRlciBmb3IgUFBUWCBjb252ZXJ0ZXIgdXNpbmcgdGhlIGFjdHVhbCBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3BwdHgnLCB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtQcHR4QWRhcHRlcl0gQ29udmVydGluZyBQUFRYIGZpbGU6ICR7bmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgY29udGVudCBpcyBhIEJ1ZmZlclxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUFBUWCBjb250ZW50IG11c3QgYmUgYSBCdWZmZXInKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHRoZSBhY3R1YWwgUHB0eENvbnZlcnRlciBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBwdHhDb252ZXJ0ZXJJbnN0YW5jZS5jb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhcGlLZXlcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgd2UgaGF2ZSBjb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQgfHwgdHlwZW9mIHJlc3VsdCAhPT0gJ3N0cmluZycgfHwgcmVzdWx0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQUFRYIGNvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiByZXN1bHQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwcHR4J1xyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQcHR4QWRhcHRlcl0gRXJyb3IgY29udmVydGluZyBQUFRYOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBQUFRYIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpICYmIGNvbnRlbnQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnUFBUWCBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICAgICAgZXh0ZW5zaW9uczogWycucHB0eCcsICcucHB0J10sXHJcbiAgICAgICAgICAgICAgICBtaW1lVHlwZXM6IFsnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnByZXNlbnRhdGlvbm1sLnByZXNlbnRhdGlvbicsICdhcHBsaWNhdGlvbi92bmQubXMtcG93ZXJwb2ludCddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAwICogMTAyNCAqIDEwMjQgLy8gMTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgYWRhcHRlciBmb3IgdGhlIENTViBjb252ZXJ0ZXJcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdjc3YnLCB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZBZGFwdGVyXSBDb252ZXJ0aW5nIENTViBmaWxlOiAke25hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ29udmVydCB0aGUgY29udGVudCB0byBzdHJpbmdcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb250ZW50U3RyID0gY29udGVudC50b1N0cmluZygpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSB0aGUgYWN0dWFsIENzdkNvbnZlcnRlciBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNzdkNvbnZlcnRlckluc3RhbmNlLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnRTdHIsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogbmFtZSAvLyBQYXNzIHRoZSBvcmlnaW5hbCBmaWxlbmFtZVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSB3ZSBoYXZlIGNvbnRlbnRcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXJlc3VsdCB8fCB0eXBlb2YgcmVzdWx0ICE9PSAnc3RyaW5nJyB8fCByZXN1bHQudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NTViBjb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQnKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogcmVzdWx0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnY3N2J1xyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtDc3ZBZGFwdGVyXSBFcnJvciBjb252ZXJ0aW5nIENTVjogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ1NWIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpICYmIGNvbnRlbnQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnQ1NWIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy5jc3YnXSxcclxuICAgICAgICAgICAgICAgIG1pbWVUeXBlczogWyd0ZXh0L2NzdiddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAwICogMTAyNCAqIDEwMjQgLy8gMTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIHRoZSBYTFNYIGNvbnZlcnRlclxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3hsc3gnLCB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4QWRhcHRlcl0gQ29udmVydGluZyBFeGNlbCBmaWxlOiAke25hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIGNvbnRlbnQgaXMgYSBCdWZmZXJcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihjb250ZW50KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4Y2VsIGNvbnRlbnQgbXVzdCBiZSBhIEJ1ZmZlcicpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBSZWFkIHRoZSBFeGNlbCBmaWxlIHVzaW5nIHhsc3ggbGlicmFyeVxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHhsc3ggPSByZXF1aXJlKCd4bHN4Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgbGV0IHdvcmtib29rO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBmaWxlIHRvIHJlYWQgdGhlIEV4Y2VsIGNvbnRlbnRcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcyA9IHJlcXVpcmUoJ29zJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBwYXRoLmpvaW4ob3MudG1wZGlyKCksIGB4bHN4X2NvbnZlcnNpb25fJHtEYXRlLm5vdygpfWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5lbnN1cmVEaXIodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBTdG9yZSBvcmlnaW5hbCBuYW1lIGZvciBsYXRlciB1c2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxGaWxlTmFtZSA9IG5hbWU7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgYSB0ZW1wIGZpbGUgd2l0aCBhIGdlbmVyaWMgbmFtZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRmlsZSA9IHBhdGguam9pbih0ZW1wRGlyLCBgZXhjZWxfY29udmVyc2lvbl8ke0RhdGUubm93KCl9Lnhsc3hgKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKHRlbXBGaWxlLCBjb250ZW50KTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFJlYWQgdGhlIEV4Y2VsIGZpbGVcclxuICAgICAgICAgICAgICAgICAgICAgICAgd29ya2Jvb2sgPSB4bHN4LnJlYWRGaWxlKHRlbXBGaWxlLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjZWxsRGF0ZXM6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi4ob3B0aW9ucy54bHN4T3B0aW9ucyB8fCB7fSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGZpbGVcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKHJlYWRFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeEFkYXB0ZXJdIEZhaWxlZCB0byByZWFkIEV4Y2VsIGZpbGU6ICR7bmFtZX1gLCByZWFkRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byByZWFkIEV4Y2VsIGZpbGU6ICR7cmVhZEVycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSB0aGUgYWN0dWFsIFhsc3hDb252ZXJ0ZXIgaW1wbGVtZW50YXRpb25cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB4bHN4Q29udmVydGVySW5zdGFuY2UuY29udmVydFRvTWFya2Rvd24od29ya2Jvb2ssIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogb3JpZ2luYWxGaWxlTmFtZSB8fCBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcmlnaW5hbEZpbGVOYW1lIHx8IG5hbWUgLy8gUGFzcyB0aGUgb3JpZ2luYWwgZmlsZW5hbWVcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgd2UgaGF2ZSBjb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQgfHwgdHlwZW9mIHJlc3VsdCAhPT0gJ3N0cmluZycgfHwgcmVzdWx0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeGNlbCBjb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQnKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gTWFrZSBzdXJlIHdlJ3JlIHByb3Blcmx5IHJldHVybmluZyB0aGUgb3JpZ2luYWwgZmlsZW5hbWVcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiByZXN1bHQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IG9yaWdpbmFsRmlsZU5hbWUgfHwgbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3hsc3gnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcmlnaW5hbEZpbGVOYW1lIHx8IG5hbWUgLy8gRW5zdXJlIHRoZSBvcmlnaW5hbCBmaWxlbmFtZSBpcyBwcmVzZXJ2ZWRcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeEFkYXB0ZXJdIEVycm9yIGNvbnZlcnRpbmcgRXhjZWw6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4Y2VsIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpICYmIGNvbnRlbnQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnRXhjZWwgQ29udmVydGVyJyxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnhsc3gnLCAnLnhscyddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JywgJ2FwcGxpY2F0aW9uL3ZuZC5tcy1leGNlbCddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAwICogMTAyNCAqIDEwMjQgLy8gMTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIG1lZGlhIGNvbnZlcnRlcnMgKGF1ZGlvIGFuZCB2aWRlbylcclxuICAgICAgICBjb25zdCBtZWRpYUFkYXB0ZXIgPSB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIGxldCB0ZW1wRGlyID0gbnVsbDsgLy8gRGVjbGFyZSB0ZW1wRGlyIG91dHNpZGUgdHJ5IGJsb2NrIGZvciBjbGVhbnVwIGFjY2Vzc1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQWRhcHRlcl0gQ29udmVydGluZyBtZWRpYSBmaWxlOiAke25hbWV9YCk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBjb250ZW50IGlzIGEgQnVmZmVyXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoY29udGVudCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNZWRpYSBjb250ZW50IG11c3QgYmUgYSBCdWZmZXInKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBmaWxlIHRvIHByb2Nlc3MgdGhlIG1lZGlhXHJcbiAgICAgICAgICAgICAgICAgICAgdGVtcERpciA9IGF3YWl0IGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlLmNyZWF0ZVRlbXBEaXIoJ21lZGlhX2FkYXB0ZXJfdGVtcCcpOyAvLyBNb3JlIHNwZWNpZmljIHRlbXAgZGlyIG5hbWVcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRmlsZU5hbWUgPSBgJHtuYW1lfV8ke0RhdGUubm93KCl9JHtwYXRoLmV4dG5hbWUobmFtZSkgfHwgJy5tcDQnfWA7IC8vIEVuc3VyZSBhIHZhbGlkIGV4dGVuc2lvbiwgZGVmYXVsdCB0byAubXA0XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcEZpbGUgPSBwYXRoLmpvaW4odGVtcERpciwgdGVtcEZpbGVOYW1lKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQWRhcHRlcl0gV3JpdGluZyBidWZmZXIgZm9yICcke25hbWV9JyB0byB0ZW1wb3JhcnkgZmlsZTogJHt0ZW1wRmlsZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUodGVtcEZpbGUsIGNvbnRlbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFBZGFwdGVyXSBCdWZmZXIgd3JpdHRlbiB0byAke3RlbXBGaWxlfWApO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBHZXQgZGVlcGdyYW0gQVBJIGtleSBmcm9tIG9wdGlvbnMgb3Igc2V0dGluZ3NcclxuICAgICAgICAgICAgICAgICAgICAvLyBUaGlzIGxvZ2ljIGlzIG5vdyBwcmltYXJpbHkgaGFuZGxlZCB3aXRoaW4gTWVkaWFDb252ZXJ0ZXIsIGJ1dCBjYW4gYmUgcGFzc2VkIGFzIG92ZXJyaWRlLlxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlZXBncmFtQXBpS2V5ID0gb3B0aW9ucy5kZWVwZ3JhbUFwaUtleSB8fCBudWxsOyBcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gUHJvY2VzcyB0aGUgbWVkaWEgZmlsZSB1c2luZyBNZWRpYUNvbnZlcnRlclxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBhIG1vcmUgY29tcGxldGUgbW9jayBldmVudCB0aGF0IHByb3ZpZGVzIGEgdmFsaWQgQnJvd3NlcldpbmRvdyBvciBudWxsXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gYnV0IGluIGEgd2F5IHRoYXQgd29uJ3QgdGhyb3cgZXJyb3JzIHdoZW4gYWNjZXNzaW5nIHByb3BlcnRpZXNcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBtb2NrRXZlbnQgPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbmRlcjoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2V0T3duZXJCcm93c2VyV2luZG93OiAoKSA9PiBudWxsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQWRkIGEgbW9jayB3ZWJDb250ZW50cyB0byBwcmV2ZW50IG51bGwgcmVmZXJlbmNlIGVycm9yc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgd2ViQ29udGVudHM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZW5kOiAoY2hhbm5lbCwgZGF0YSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQWRhcHRlcl0gV291bGQgc2VuZCB0byBjaGFubmVsICR7Y2hhbm5lbH06YCwgZGF0YSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRoaXMgaXMgYSBuby1vcCBmdW5jdGlvbiB0aGF0IGxvZ3MgdGhlIHdvdWxkLWJlIHNlbnQgZGF0YVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBidXQgZG9lc24ndCBhY3R1YWxseSB0cnkgdG8gY29tbXVuaWNhdGUgd2l0aCBhIHdpbmRvd1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG1lZGlhQ29udmVydGVySW5zdGFuY2UuaGFuZGxlQ29udmVydChtb2NrRXZlbnQsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGg6IHRlbXBGaWxlLCAvLyBQYXNzIHRoZSBwYXRoIHRvIHRoZSB0ZW1wb3JhcnkgZmlsZSBjb250YWluaW5nIHRoZSBidWZmZXIgY29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLCAvLyBQYXNzIHRocm91Z2ggYWxsIG9yaWdpbmFsIG9wdGlvbnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzVGVtcElucHV0RmlsZTogdHJ1ZSwgLy8gSW5kaWNhdGUgdGhhdCBmaWxlUGF0aCBpcyBhIHRlbXAgZmlsZSBjcmVhdGVkIGJ5IHRoZSBhZGFwdGVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBuYW1lLCAvLyBQYXNzIHRoZSBvcmlnaW5hbCBmaWxlIG5hbWVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZXBncmFtQXBpS2V5OiBkZWVwZ3JhbUFwaUtleSwgLy8gUGFzcyBleHBsaWNpdGx5IGlmIHByb3ZpZGVkLCBvdGhlcndpc2UgTWVkaWFDb252ZXJ0ZXIgd2lsbCBmaW5kIGl0XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBfdGVtcERpciBpcyBubyBsb25nZXIgbmVlZGVkIGhlcmUgYXMgTWVkaWFDb252ZXJ0ZXIgaGFuZGxlcyBpdHMgb3duIHRlbXAgc3BhY2Ugb3IgY2xlYW5zIHRoZSBpbnB1dCB0ZW1wIGRpclxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gbWVkaWFDb252ZXJ0ZXJJbnN0YW5jZS5oYW5kbGVDb252ZXJ0IG5vdyByZXR1cm5zIHsgY29udmVyc2lvbklkLCBvcmlnaW5hbEZpbGVOYW1lIH1cclxuICAgICAgICAgICAgICAgICAgICAvLyBUaGUgc3VjY2VzcyBvZiB0aGUgKmluaXRpYXRpb24qIGlzIGltcGxpZWQgaWYgbm8gZXJyb3IgaXMgdGhyb3duLlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFRoZSBhY3R1YWwgY29udmVyc2lvbiByZXN1bHQgaXMgYXN5bmNocm9ub3VzLlxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFBZGFwdGVyXSBNZWRpYSBjb252ZXJzaW9uIGluaXRpYXRlZCBmb3IgJyR7bmFtZX0nLiBDb252ZXJzaW9uIElEOiAke3Jlc3VsdC5jb252ZXJzaW9uSWR9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSwgLy8gSW5kaWNhdGVzIHN1Y2Nlc3NmdWwgaW5pdGlhdGlvblxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb252ZXJzaW9uSWQ6IHJlc3VsdC5jb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFzeW5jOiB0cnVlLCAvLyBDcml0aWNhbDogc2lnbmFscyB0byBjbGllbnQgdGhhdCByZXN1bHQgaXMgYXN5bmNcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogcmVzdWx0Lm9yaWdpbmFsRmlsZU5hbWUgfHwgbmFtZSwgLy8gVXNlIG9yaWdpbmFsRmlsZU5hbWUgZnJvbSByZXN1bHQgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdtZWRpYScsIC8vIE9yIGRlcml2ZSBmcm9tIGFjdHVhbCBmaWxlIHR5cGUgaWYgbmVlZGVkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEFkZCBhIGZsYWcgdG8gaW5kaWNhdGUgdGhhdCB0aGlzIGlzIGEgdHJhbnNjcmlwdGlvbiBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlzVHJhbnNjcmlwdGlvbjogdHJ1ZSAvLyBUaGlzIHdpbGwgYmUgdXNlZCB0byBoYW5kbGUgdHJhbnNjcmlwdGlvbiBmYWlsdXJlcyBkaWZmZXJlbnRseVxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yLm1lc3NhZ2UgfHwgJ1Vua25vd24gZXJyb3IgaW4gbWVkaWEgYWRhcHRlcic7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW01lZGlhQWRhcHRlcl0gRXJyb3IgY29udmVydGluZyBtZWRpYSBmaWxlICcke25hbWV9JzpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgdGVtcERpciB3YXMgY3JlYXRlZCwgYXR0ZW1wdCB0byBjbGVhbiBpdCB1cC5cclxuICAgICAgICAgICAgICAgICAgICBpZiAodGVtcERpcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXhpc3RzID0gYXdhaXQgZnMucGF0aEV4aXN0cyh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGlzdHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUFkYXB0ZXJdIENsZWFuZWQgdXAgdGVtcCBkaXJlY3RvcnkgJHt0ZW1wRGlyfSBhZnRlciBlcnJvci5gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWVkaWFBZGFwdGVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3RvcnkgJHt0ZW1wRGlyfSBhZnRlciBlcnJvcjpgLCBjbGVhbnVwRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWVkaWEgY29udmVyc2lvbiBmYWlsZWQgZm9yICcke25hbWV9JzogJHtlcnJvck1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpICYmIGNvbnRlbnQubGVuZ3RoID4gMCwgLy8gVGhpcyBhZGFwdGVyIGlzIGZvciBidWZmZXIgaW5wdXRzXHJcbiAgICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ01lZGlhIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy5tcDMnLCAnLndhdicsICcub2dnJywgJy5tNGEnLCAnLmZsYWMnLCAnLm1wNCcsICcubW92JywgJy5hdmknLCAnLm1rdicsICcud2VibSddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbXHJcbiAgICAgICAgICAgICAgICAgICAgJ2F1ZGlvL21wZWcnLCAnYXVkaW8vbXAzJywgJ2F1ZGlvL3dhdicsICdhdWRpby9vZ2cnLCAnYXVkaW8vbTRhJywgJ2F1ZGlvL2ZsYWMnLFxyXG4gICAgICAgICAgICAgICAgICAgICd2aWRlby9tcDQnLCAndmlkZW8vd2VibScsICd2aWRlby9xdWlja3RpbWUnLCAndmlkZW8veC1tc3ZpZGVvJywgJ3ZpZGVvL3gtbWF0cm9za2EnXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogNTAwICogMTAyNCAqIDEwMjQgLy8gNTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIFJlZ2lzdGVyIGFsbCBtZWRpYSBmb3JtYXRzIHRvIHVzZSB0aGUgc2FtZSBjb252ZXJ0ZXJcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdtcDMnLCBtZWRpYUFkYXB0ZXIpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3dhdicsIG1lZGlhQWRhcHRlcik7XHJcbiAgICAgICAgdGhpcy5yZWdpc3Rlcignb2dnJywgbWVkaWFBZGFwdGVyKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdtNGEnLCBtZWRpYUFkYXB0ZXIpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ2ZsYWMnLCBtZWRpYUFkYXB0ZXIpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ21wNCcsIG1lZGlhQWRhcHRlcik7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcignbW92JywgbWVkaWFBZGFwdGVyKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdhdmknLCBtZWRpYUFkYXB0ZXIpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ21rdicsIG1lZGlhQWRhcHRlcik7XHJcbiAgICAgICAgdGhpcy5yZWdpc3Rlcignd2VibScsIG1lZGlhQWRhcHRlcik7XHJcblxyXG4gICAgICAgIC8vIFJlZ2lzdGVyIHBwdCBleHRlbnNpb24gdG8gdXNlIHRoZSBzYW1lIGNvbnZlcnRlciBhcyBwcHR4XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcigncHB0JywgdGhpcy5jb252ZXJ0ZXJzWydwcHR4J10pO1xyXG5cclxuICAgICAgICAvLyBSZWdpc3RlciB0aGUgUERGIGZhY3RvcnkgYWRhcHRlciB3aXRoIHByb3BlciBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3BkZicsIHtcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcIltQZGZBZGFwdGVyXSBDb252ZXJ0aW5nIFBERiBkb2N1bWVudFwiKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgdGVtcCBkaXJlY3RvcnkgZm9yIGNvbnZlcnNpb24gdXNpbmcgdGhlIHNpbmdsZXRvbiBzZXJ2aWNlXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlLmNyZWF0ZVRlbXBEaXIoJ3BkZl9jb252ZXJzaW9uJyk7IFxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSB0aGUgZGlyZWN0b3J5IGV4aXN0c1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLmVuc3VyZURpcih0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRmlsZSA9IHBhdGguam9pbih0ZW1wRGlyLCBgZG9jdW1lbnRfJHtEYXRlLm5vdygpfS5wZGZgKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBXcml0ZSBidWZmZXIgdG8gdGVtcCBmaWxlXHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKHRlbXBGaWxlLCBjb250ZW50KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBWZXJpZnkgdGhlIGZpbGUgd2FzIHdyaXR0ZW4gc3VjY2Vzc2Z1bGx5XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEoYXdhaXQgZnMucGF0aEV4aXN0cyh0ZW1wRmlsZSkpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHdyaXRlIHRlbXBvcmFyeSBQREYgZmlsZTogJHt0ZW1wRmlsZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRGV0ZXJtaW5lIGlmIE9DUiBzaG91bGQgYmUgdXNlZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBEZXRlcm1pbmUgaWYgT0NSIHNob3VsZCBiZSB1c2VkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHVzZU9jciA9IG9wdGlvbnMudXNlT2NyID09PSB0cnVlICYmIG9wdGlvbnMubWlzdHJhbEFwaUtleTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBhcHByb3ByaWF0ZSBjb252ZXJ0ZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGV0IHJlc3VsdDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU9jcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tDb252ZXJ0ZXJSZWdpc3RyeV0gVXNpbmcgTWlzdHJhbCBPQ1IgY29udmVydGVyIGZvciBQREYgY29udmVyc2lvbicpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVXNlIE1pc3RyYWwgT0NSIGNvbnZlcnRlciAtIHJlcXVpcmUgaXQgZGlyZWN0bHkgdG8gZW5zdXJlIGl0J3MgaW4gc2NvcGVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdHJ1ZSBmb3Igc2tpcEhhbmRsZXJTZXR1cCB0byBhdm9pZCBkdXBsaWNhdGUgSVBDIGhhbmRsZXIgcmVnaXN0cmF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHNpbmdsZXRvbiBzZXJ2aWNlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgTWlzdHJhbFBkZkNvbnZlcnRlckNsYXNzID0gcmVxdWlyZSgnLi9kb2N1bWVudC9NaXN0cmFsUGRmQ29udmVydGVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtaXN0cmFsQ29udmVydGVyID0gbmV3IE1pc3RyYWxQZGZDb252ZXJ0ZXJDbGFzcyhmaWxlUHJvY2Vzc29yU2VydmljZUluc3RhbmNlLCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZSwgbnVsbCwgdHJ1ZSk7IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gU2V0IHRoZSBBUEkga2V5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtaXN0cmFsQ29udmVydGVyLmFwaUtleSA9IG9wdGlvbnMubWlzdHJhbEFwaUtleTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbQ29udmVydGVyUmVnaXN0cnldIE1pc3RyYWwgQVBJIGtleSBzZXQgZm9yIE9DUiBjb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IG1pc3RyYWxDb252ZXJ0ZXIuY29udmVydFRvTWFya2Rvd24oY29udGVudCwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZmlsZU5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlLZXk6IG9wdGlvbnMubWlzdHJhbEFwaUtleVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBVc2Ugc3RhbmRhcmQgY29udmVydGVyIC0gcmVxdWlyZSBpdCBkaXJlY3RseSB0byBlbnN1cmUgaXQncyBpbiBzY29wZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0cnVlIGZvciBza2lwSGFuZGxlclNldHVwIHRvIGF2b2lkIGR1cGxpY2F0ZSBJUEMgaGFuZGxlciByZWdpc3RyYXRpb25cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFBhc3Mgc2luZ2xldG9uIHNlcnZpY2VzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW0NvbnZlcnRlclJlZ2lzdHJ5XSBVc2luZyBzdGFuZGFyZCBQREYgY29udmVydGVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBTdGFuZGFyZFBkZkNvbnZlcnRlckNsYXNzID0gcmVxdWlyZSgnLi9kb2N1bWVudC9TdGFuZGFyZFBkZkNvbnZlcnRlcicpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhbmRhcmRDb252ZXJ0ZXIgPSBuZXcgU3RhbmRhcmRQZGZDb252ZXJ0ZXJDbGFzcyhmaWxlUHJvY2Vzc29yU2VydmljZUluc3RhbmNlLCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZSwgdHJ1ZSk7IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgc3RhbmRhcmRDb252ZXJ0ZXIuY29udmVydFRvTWFya2Rvd24oY29udGVudCwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZmlsZU5hbWU6IG5hbWVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgcmVzdWx0IGhhcyBzdWNjZXNzIGZsYWcgYW5kIGNvbnRlbnRcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKHJlc3VsdC5lcnJvciB8fCAnUERGIGNvbnZlcnNpb24gZmFpbGVkIHdpdGggbm8gc3BlY2lmaWMgZXJyb3InKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQuY29udGVudCB8fCB0eXBlb2YgcmVzdWx0LmNvbnRlbnQgIT09ICdzdHJpbmcnIHx8IHJlc3VsdC5jb250ZW50LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUERGIGNvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudCcpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFJlLXRocm93IGVycm9yXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BkZkFkYXB0ZXJdIEVycm9yIGNvbnZlcnRpbmcgUERGOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBQREYgY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdmFsaWRhdGU6IChjb250ZW50KSA9PiBCdWZmZXIuaXNCdWZmZXIoY29udGVudCkgJiYgY29udGVudC5sZW5ndGggPiAwLFxyXG4gICAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdQREYgQ29udmVydGVyJyxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnBkZiddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ2FwcGxpY2F0aW9uL3BkZiddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAwICogMTAyNCAqIDEwMjQgLy8gMTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIFVSTCBjb252ZXJ0ZXIgdXNpbmcgdGhlIGFjdHVhbCBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3VybCcsIHtcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgICAgLy8gVVJMIGNvbnZlcnRlciBleHBlY3RzIHRoZSBjb250ZW50IHRvIGJlIHRoZSBVUkwgc3RyaW5nXHJcbiAgICAgICAgICAgICAgICBsZXQgY29udmVyc2lvblJlc3VsdDtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtVcmxBZGFwdGVyXSBDb252ZXJ0aW5nIFVSTDogJHtjb250ZW50fWApO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbVXJsQWRhcHRlcl0gZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UgYXZhaWxhYmxlOmAsICEhZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbVXJsQWRhcHRlcl0gQ3JlYXRpbmcgdGVtcCBkaXJlY3RvcnkuLi5gKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgdGVtcG9yYXJ5IGRpcmVjdG9yeSBmb3IgdGhlIGNvbnZlcnNpb24gdXNpbmcgdGhlIHNpbmdsZXRvbiBzZXJ2aWNlXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlLmNyZWF0ZVRlbXBEaXIoJ3VybF9jb252ZXJzaW9uJyk7IFxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIExhdW5jaCBhIGJyb3dzZXIgaW5zdGFuY2UgZm9yIHRoZSBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcHVwcGV0ZWVyID0gcmVxdWlyZSgncHVwcGV0ZWVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYnJvd3NlciA9IGF3YWl0IHB1cHBldGVlci5sYXVuY2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBoZWFkbGVzczogJ25ldycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFyZ3M6IFsnLS1uby1zYW5kYm94JywgJy0tZGlzYWJsZS1zZXR1aWQtc2FuZGJveCddXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRmV0Y2ggbWV0YWRhdGFcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB1cmxDb252ZXJ0ZXJJbnN0YW5jZS5mZXRjaE1ldGFkYXRhKGNvbnRlbnQsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRXh0cmFjdCBjb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGV4dHJhY3RlZENvbnRlbnQgPSBhd2FpdCB1cmxDb252ZXJ0ZXJJbnN0YW5jZS5leHRyYWN0Q29udGVudChjb250ZW50LCBvcHRpb25zLCBicm93c2VyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFByb2Nlc3MgaW1hZ2VzIGlmIHJlcXVlc3RlZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAob3B0aW9ucy5pbmNsdWRlSW1hZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB1cmxDb252ZXJ0ZXJJbnN0YW5jZS5wcm9jZXNzSW1hZ2VzKGV4dHJhY3RlZENvbnRlbnQsIHRlbXBEaXIsIGNvbnRlbnQsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBtYXJrZG93blxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZG93biA9IHVybENvbnZlcnRlckluc3RhbmNlLmdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIGV4dHJhY3RlZENvbnRlbnQsIG51bGwsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xvc2UgYnJvd3NlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wb3JhcnkgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogbWFya2Rvd24sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3VybCdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbVXJsQWRhcHRlcl0gSW5uZXIgZXJyb3I6YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbVXJsQWRhcHRlcl0gRXJyb3Igc3RhY2s6YCwgZXJyb3Iuc3RhY2spO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbG9zZSBicm93c2VyIG9uIGVycm9yXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXBvcmFyeSBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmUtdGhyb3cgZXJyb3JcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbVXJsQWRhcHRlcl0gRXJyb3IgY29udmVydGluZyBVUkw6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbVXJsQWRhcHRlcl0gRnVsbCBlcnJvcjpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVUkwgY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdmFsaWRhdGU6IChjb250ZW50KSA9PiB0eXBlb2YgY29udGVudCA9PT0gJ3N0cmluZycgJiYgY29udGVudC5sZW5ndGggPiAwLFxyXG4gICAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdVUkwgQ29udmVydGVyJyxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnVybCcsICcuaHRtbCcsICcuaHRtJ10sXHJcbiAgICAgICAgICAgICAgICBtaW1lVHlwZXM6IFsndGV4dC9odG1sJywgJ2FwcGxpY2F0aW9uL3gtdXJsJ10sXHJcbiAgICAgICAgICAgICAgICBtYXhTaXplOiAxMCAqIDEwMjQgKiAxMDI0IC8vIDEwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIFBhcmVudFVSTCBjb252ZXJ0ZXIgdXNpbmcgdGhlIGFjdHVhbCBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3BhcmVudHVybCcsIHtcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgICAgLy8gRm9yIFVSTCBjb252ZXJ0ZXJzLCBjb250ZW50IGlzIHRoZSBVUkwgc3RyaW5nIGl0c2VsZlxyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW1BhcmVudFVybEFkYXB0ZXJdIENvbnZlcnRpbmcgc2l0ZTogJHtjb250ZW50fWApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSB0ZW1wb3JhcnkgZGlyZWN0b3J5IGZvciB0aGUgY29udmVyc2lvbiB1c2luZyB0aGUgc2luZ2xldG9uIHNlcnZpY2VcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UuY3JlYXRlVGVtcERpcigncGFyZW50X3VybF9jb252ZXJzaW9uJyk7IFxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIExhdW5jaCBhIGJyb3dzZXIgaW5zdGFuY2UgZm9yIHRoZSBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcHVwcGV0ZWVyID0gcmVxdWlyZSgncHVwcGV0ZWVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYnJvd3NlciA9IGF3YWl0IHB1cHBldGVlci5sYXVuY2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBoZWFkbGVzczogJ25ldycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFyZ3M6IFsnLS1uby1zYW5kYm94JywgJy0tZGlzYWJsZS1zZXR1aWQtc2FuZGJveCddXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRGlzY292ZXIgc2l0ZW1hcFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzaXRlbWFwID0gYXdhaXQgcGFyZW50VXJsQ29udmVydGVySW5zdGFuY2UuZGlzY292ZXJTaXRlbWFwKGNvbnRlbnQsIG9wdGlvbnMsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUHJvY2VzcyBlYWNoIHBhZ2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4UGFnZXMgPSBvcHRpb25zLm1heFBhZ2VzIHx8IE1hdGgubWluKHNpdGVtYXAucGFnZXMubGVuZ3RoLCAxMCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VzVG9Qcm9jZXNzID0gc2l0ZW1hcC5wYWdlcy5zbGljZSgwLCBtYXhQYWdlcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHByb2Nlc3NlZFBhZ2VzID0gW107XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHBhZ2Ugb2YgcGFnZXNUb1Byb2Nlc3MpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFByb2Nlc3MgcGFnZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFnZUNvbnRlbnQgPSBhd2FpdCBwYXJlbnRVcmxDb252ZXJ0ZXJJbnN0YW5jZS5wcm9jZXNzUGFnZShcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYWdlLnVybCwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucywgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJvd3NlciwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGVtcERpclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQWRkIHRvIHByb2Nlc3NlZCBwYWdlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2VkUGFnZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBwYWdlLnVybCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogcGFnZS50aXRsZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBwYWdlQ29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duIGZpbGVzIGJhc2VkIG9uIHNhdmUgbW9kZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzYXZlTW9kZSA9IG9wdGlvbnMud2Vic2l0ZVNjcmFwaW5nPy5zYXZlTW9kZSB8fCAnY29tYmluZWQnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW1BhcmVudFVybEFkYXB0ZXJdIFVzaW5nIHNhdmUgbW9kZTogJHtzYXZlTW9kZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxldCByZXN1bHQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzYXZlTW9kZSA9PT0gJ3NlcGFyYXRlJykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgc2VwYXJhdGUgZmlsZXNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHBhcmVudFVybENvbnZlcnRlckluc3RhbmNlLmdlbmVyYXRlU2VwYXJhdGVGaWxlcyhzaXRlbWFwLCBwcm9jZXNzZWRQYWdlcywgb3B0aW9ucywgdGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsb3NlIGJyb3dzZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRG9uJ3QgcmVtb3ZlIHRlbXBEaXIgYXMgZmlsZXMgYXJlIGFscmVhZHkgbW92ZWQgdG8gZmluYWwgbG9jYXRpb25cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmV0dXJuIHRoZSBtdWx0aXBsZSBmaWxlcyByZXN1bHRcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5yZXN1bHQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIGNvbWJpbmVkIG1hcmtkb3duIChkZWZhdWx0IGJlaGF2aW9yKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2Rvd24gPSBwYXJlbnRVcmxDb252ZXJ0ZXJJbnN0YW5jZS5nZW5lcmF0ZUNvbWJpbmVkTWFya2Rvd24oXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2l0ZW1hcCwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2VkUGFnZXMsIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsb3NlIGJyb3dzZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcG9yYXJ5IGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogbWFya2Rvd24sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGFyZW50dXJsJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsb3NlIGJyb3dzZXIgb24gZXJyb3JcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcG9yYXJ5IGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBSZS10aHJvdyBlcnJvclxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQYXJlbnRVcmxBZGFwdGVyXSBFcnJvciBjb252ZXJ0aW5nIHNpdGU6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNpdGUgY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdmFsaWRhdGU6IChjb250ZW50KSA9PiB0eXBlb2YgY29udGVudCA9PT0gJ3N0cmluZycgJiYgY29udGVudC5sZW5ndGggPiAwLFxyXG4gICAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdXZWJzaXRlIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy51cmwnLCAnLmh0bWwnLCAnLmh0bSddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ3RleHQvaHRtbCcsICdhcHBsaWNhdGlvbi94LXVybCddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAgKiAxMDI0ICogMTAyNCAvLyAxME1CXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCByZWdpc3RlcmVkVHlwZXMgPSBPYmplY3Qua2V5cyh0aGlzLmNvbnZlcnRlcnMpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgQ29udmVydGVycyByZWdpc3RlcmVkIHN1Y2Nlc3NmdWxseTogJHtyZWdpc3RlcmVkVHlwZXMubGVuZ3RofSB0eXBlc2ApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OLIFJlZ2lzdGVyZWQgdHlwZXM6ICR7cmVnaXN0ZXJlZFR5cGVzLmpvaW4oJywgJyl9YCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBzZXR0aW5nIHVwIGNvbnZlcnRlcnM6JywgZXJyb3IpO1xyXG4gICAgICAgIC8vIEFkZCBkZXRhaWxlZCBlcnJvciBsb2dnaW5nXHJcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZGV0YWlsczonLCB7XHJcbiAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcclxuICAgICAgICAgICAgbmFtZTogZXJyb3IubmFtZVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFRocm93IHRoZSBlcnJvciB0byBiZSBoYW5kbGVkIGJ5IHRoZSBjYWxsZXJcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBzZXQgdXAgY29udmVydGVyczogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgfVxyXG59O1xyXG5cclxuLy8gQ3JlYXRlIGFuZCBleHBvcnQgc2luZ2xldG9uIGluc3RhbmNlXHJcbnZhciByZWdpc3RyeSA9IG5ldyBDb252ZXJ0ZXJSZWdpc3RyeSgpO1xyXG5tb2R1bGUuZXhwb3J0cyA9IHJlZ2lzdHJ5O1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7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