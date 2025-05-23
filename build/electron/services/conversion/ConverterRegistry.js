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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJwYXRoIiwiaXBjTWFpbiIsIkNvbnZlcnRlclJlZ2lzdHJ5IiwiY29udmVydGVycyIsImFjdGl2ZUNvbnZlcnNpb25zIiwiTWFwIiwic2V0dXBDb252ZXJ0ZXJzIiwic2V0dXBDb252ZXJzaW9uVmFsaWRhdGlvbiIsInByb2Nlc3MiLCJvbiIsImNsZWFudXAiLCJleGl0IiwicHJvdG90eXBlIiwidmFsaWRhdGlvbkludGVydmFsIiwic2V0SW50ZXJ2YWwiLCJub3ciLCJEYXRlIiwic3RhbGVDb3VudCIsIkFycmF5IiwiZnJvbSIsImVudHJpZXMiLCJmb3JFYWNoIiwiaWQiLCJjb252Iiwic3RhdHVzIiwicmV0cmlldmVkIiwiY29uc29sZSIsImxvZyIsImRlbGV0ZSIsImxhc3RQaW5nIiwid2FybiIsIk1hdGgiLCJyb3VuZCIsImNsZWFudXBFcnJvciIsImVycm9yIiwic2l6ZSIsInJlZ2lzdGVyQ29udmVyc2lvbiIsImNvbnZlcnNpb25EYXRhIiwic2V0IiwicGluZ0NvbnZlcnNpb24iLCJ1cGRhdGVzIiwiY29udmVyc2lvbiIsImdldCIsInJlbW92ZUNvbnZlcnNpb24iLCJnZXRDb252ZXJzaW9uIiwiY2xlYXJJbnRlcnZhbCIsImNvbnZlcnNpb25Db3VudCIsImNsZWFyIiwicmVnaXN0ZXIiLCJ0eXBlIiwiY29udmVydGVyIiwiZ2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJleHRlbnNpb24iLCJub3JtYWxpemVkRXh0IiwidG9Mb3dlckNhc2UiLCJyZXBsYWNlIiwiZ2V0Q29udmVydGVyQnlNaW1lVHlwZSIsIm1pbWVUeXBlIiwiT2JqZWN0IiwiY29uZmlnIiwibWltZVR5cGVzIiwiaW5jbHVkZXMiLCJjb252ZXJ0VG9NYXJrZG93biIsImNvbnRlbnQiLCJvcHRpb25zIiwiRXJyb3IiLCJjb252ZXJ0IiwibmFtZSIsImFwaUtleSIsIkNzdkNvbnZlcnRlciIsIlhsc3hDb252ZXJ0ZXIiLCJNZWRpYUNvbnZlcnRlciIsIlBkZkZhY3RvcnkiLCJEb2N4Q29udmVydGVyIiwiUHB0eENvbnZlcnRlciIsIlVybENvbnZlcnRlciIsIlBhcmVudFVybENvbnZlcnRlciIsImZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UiLCJmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZSIsImRlZXBncmFtU2VydmljZUluc3RhbmNlIiwiY3N2Q29udmVydGVySW5zdGFuY2UiLCJ4bHN4Q29udmVydGVySW5zdGFuY2UiLCJtZWRpYUNvbnZlcnRlckluc3RhbmNlIiwicGRmQ29udmVydGVyRmFjdG9yeSIsImRvY3hDb252ZXJ0ZXJJbnN0YW5jZSIsInBwdHhDb252ZXJ0ZXJJbnN0YW5jZSIsInVybENvbnZlcnRlckluc3RhbmNlIiwicGFyZW50VXJsQ29udmVydGVySW5zdGFuY2UiLCJCdWZmZXIiLCJpc0J1ZmZlciIsInJlc3VsdCIsImZpbGVOYW1lIiwidHJpbSIsInN1Y2Nlc3MiLCJtZXNzYWdlIiwidmFsaWRhdGUiLCJsZW5ndGgiLCJleHRlbnNpb25zIiwibWF4U2l6ZSIsImNvbnRlbnRTdHIiLCJ0b1N0cmluZyIsIm9yaWdpbmFsRmlsZU5hbWUiLCJ4bHN4Iiwid29ya2Jvb2siLCJvcyIsInRlbXBEaXIiLCJqb2luIiwidG1wZGlyIiwiZW5zdXJlRGlyIiwidGVtcEZpbGUiLCJ3cml0ZUZpbGUiLCJyZWFkRmlsZSIsImNlbGxEYXRlcyIsInhsc3hPcHRpb25zIiwicmVtb3ZlIiwicmVhZEVycm9yIiwibWVkaWFBZGFwdGVyIiwiY3JlYXRlVGVtcERpciIsInRlbXBGaWxlTmFtZSIsImV4dG5hbWUiLCJkZWVwZ3JhbUFwaUtleSIsIm1vY2tFdmVudCIsInNlbmRlciIsImdldE93bmVyQnJvd3NlcldpbmRvdyIsIndlYkNvbnRlbnRzIiwic2VuZCIsImNoYW5uZWwiLCJkYXRhIiwiaGFuZGxlQ29udmVydCIsImZpbGVQYXRoIiwiaXNUZW1wSW5wdXRGaWxlIiwiY29udmVyc2lvbklkIiwiYXN5bmMiLCJpc1RyYW5zY3JpcHRpb24iLCJlcnJvck1lc3NhZ2UiLCJleGlzdHMiLCJwYXRoRXhpc3RzIiwidXNlT2NyIiwibWlzdHJhbEFwaUtleSIsIk1pc3RyYWxQZGZDb252ZXJ0ZXJDbGFzcyIsIm1pc3RyYWxDb252ZXJ0ZXIiLCJTdGFuZGFyZFBkZkNvbnZlcnRlckNsYXNzIiwic3RhbmRhcmRDb252ZXJ0ZXIiLCJwdXBwZXRlZXIiLCJicm93c2VyIiwibGF1bmNoIiwiaGVhZGxlc3MiLCJhcmdzIiwibWV0YWRhdGEiLCJmZXRjaE1ldGFkYXRhIiwiZXh0cmFjdGVkQ29udGVudCIsImV4dHJhY3RDb250ZW50IiwiaW5jbHVkZUltYWdlcyIsInByb2Nlc3NJbWFnZXMiLCJtYXJrZG93biIsImdlbmVyYXRlTWFya2Rvd24iLCJjbG9zZSIsInNpdGVtYXAiLCJkaXNjb3ZlclNpdGVtYXAiLCJtYXhQYWdlcyIsIm1pbiIsInBhZ2VzIiwicGFnZXNUb1Byb2Nlc3MiLCJzbGljZSIsInByb2Nlc3NlZFBhZ2VzIiwicGFnZSIsInBhZ2VDb250ZW50IiwicHJvY2Vzc1BhZ2UiLCJ1cmwiLCJwdXNoIiwidGl0bGUiLCJnZW5lcmF0ZUNvbWJpbmVkTWFya2Rvd24iLCJyZWdpc3RlcmVkVHlwZXMiLCJrZXlzIiwic3RhY2siLCJyZWdpc3RyeSIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogQ29udmVydGVyUmVnaXN0cnkuanNcclxuICogXHJcbiAqIENlbnRyYWwgcmVnaXN0cnkgZm9yIGFsbCBmaWxlIHR5cGUgY29udmVydGVycyBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBQcm92aWRlcyBhIHVuaWZpZWQgaW50ZXJmYWNlIGZvciBhY2Nlc3NpbmcgY29udmVydGVycyBiYXNlZCBvbiBmaWxlIHR5cGUuXHJcbiAqIFxyXG4gKiBUaGlzIGZpbGUgd2FzIGNyZWF0ZWQgYXMgcGFydCBvZiB0aGUgY29uc29saWRhdGlvbiBwcm9jZXNzIHRvIGNlbnRyYWxpemVcclxuICogYWxsIGNvbnZlcnRlciBmdW5jdGlvbmFsaXR5IGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNyYy9lbGVjdHJvbi9jb252ZXJ0ZXJzL1VuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmpzOiBVc2VzIHRoaXMgcmVnaXN0cnkgZm9yIGNvbnZlcnNpb25zXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanM6IFJlZmVyZW5jZXMgdGhpcyByZWdpc3RyeVxyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL2RhdGEvKi5qczogRGF0YSBjb252ZXJ0ZXJzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vZG9jdW1lbnQvKi5qczogRG9jdW1lbnQgY29udmVydGVyc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL211bHRpbWVkaWEvKi5qczogTXVsdGltZWRpYSBjb252ZXJ0ZXJzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vd2ViLyouanM6IFdlYiBjb252ZXJ0ZXJzXHJcbiAqL1xyXG5cclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IGlwY01haW4gfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcblxyXG4vKipcclxuICogUmVnaXN0cnkgZm9yIGFsbCBmaWxlIHR5cGUgY29udmVydGVyc1xyXG4gKi9cclxuZnVuY3Rpb24gQ29udmVydGVyUmVnaXN0cnkoKSB7XHJcbiAgICB0aGlzLmNvbnZlcnRlcnMgPSB7fTtcclxuICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMgPSBuZXcgTWFwKCk7IC8vIEdsb2JhbCBtYXAgdG8gdHJhY2sgYWxsIGFjdGl2ZSBjb252ZXJzaW9uc1xyXG4gICAgdGhpcy5zZXR1cENvbnZlcnRlcnMoKTtcclxuICAgIHRoaXMuc2V0dXBDb252ZXJzaW9uVmFsaWRhdGlvbigpO1xyXG4gICAgXHJcbiAgICAvLyBDbGVhbiB1cCByZXNvdXJjZXMgd2hlbiB0aGUgcHJvY2VzcyBleGl0c1xyXG4gICAgcHJvY2Vzcy5vbignZXhpdCcsICgpID0+IHRoaXMuY2xlYW51cCgpKTtcclxuICAgIHByb2Nlc3Mub24oJ1NJR0lOVCcsICgpID0+IHtcclxuICAgICAgICB0aGlzLmNsZWFudXAoKTtcclxuICAgICAgICBwcm9jZXNzLmV4aXQoMCk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFNldHMgdXAgcGVyaW9kaWMgdmFsaWRhdGlvbiBvZiBhY3RpdmUgY29udmVyc2lvbnMgdG8gY2xlYW4gdXAgc3RhbGUgb25lcy5cclxuICogVGhpcyBoZWxwcyBwcmV2ZW50IG1lbW9yeSBsZWFrcyBhbmQgcmVzb3VyY2UgaXNzdWVzIGJ5IHJlbW92aW5nIGNvbnZlcnNpb25zXHJcbiAqIHRoYXQgaGF2ZW4ndCBiZWVuIHVwZGF0ZWQgcmVjZW50bHkuXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuc2V0dXBDb252ZXJzaW9uVmFsaWRhdGlvbiA9IGZ1bmN0aW9uKCkge1xyXG4gICAgLy8gU2V0IHVwIGludGVydmFsIHRvIGNoZWNrIGZvciBzdGFsZSBjb252ZXJzaW9ucyBldmVyeSBtaW51dGVcclxuICAgIHRoaXMudmFsaWRhdGlvbkludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XHJcbiAgICAgICAgICAgIGxldCBzdGFsZUNvdW50ID0gMDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENoZWNrIGFsbCBhY3RpdmUgY29udmVyc2lvbnNcclxuICAgICAgICAgICAgQXJyYXkuZnJvbSh0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmVudHJpZXMoKSkuZm9yRWFjaCgoW2lkLCBjb252XSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgLy8gSGFuZGxlIGNvbXBsZXRlZCBjb252ZXJzaW9ucyBkaWZmZXJlbnRseVxyXG4gICAgICAgICAgICAgICAgaWYgKGNvbnYuc3RhdHVzID09PSAnY29tcGxldGVkJykge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIElmIGFscmVhZHkgcmV0cmlldmVkLCByZW1vdmUgaW1tZWRpYXRlbHlcclxuICAgICAgICAgICAgICAgICAgICBpZiAoY29udi5yZXRyaWV2ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtDb252ZXJ0ZXJSZWdpc3RyeV0gUmVtb3ZpbmcgcmV0cmlldmVkIGNvbnZlcnNpb24gJHtpZH1gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5kZWxldGUoaWQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdGFsZUNvdW50Kys7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gS2VlcCB1bi1yZXRyaWV2ZWQgY29tcGxldGVkIGNvbnZlcnNpb25zIGZvciB1cCB0byA1IG1pbnV0ZXNcclxuICAgICAgICAgICAgICAgICAgICBpZiAobm93IC0gY29udi5sYXN0UGluZyA+IDMwMDAwMCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtDb252ZXJ0ZXJSZWdpc3RyeV0gUmVtb3Zpbmcgb2xkIGNvbXBsZXRlZCBjb252ZXJzaW9uICR7aWR9IChjb21wbGV0ZWQgJHtNYXRoLnJvdW5kKChub3cgLSBjb252Lmxhc3RQaW5nKSAvIDEwMDApfXMgYWdvKWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmRlbGV0ZShpZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YWxlQ291bnQrKztcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBDb25zaWRlciBhIGNvbnZlcnNpb24gc3RhbGUgaWYgaXQgaGFzbid0IHBpbmdlZCBpbiB0aGUgbGFzdCAzMCBzZWNvbmRzXHJcbiAgICAgICAgICAgICAgICBpZiAobm93IC0gY29udi5sYXN0UGluZyA+IDMwMDAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gUmVtb3ZlIHRoZSBzdGFsZSBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5kZWxldGUoaWQpO1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YWxlQ291bnQrKztcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBMb2cgdGhlIHJlbW92YWxcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtDb252ZXJ0ZXJSZWdpc3RyeV0gU3RhbGUgY29udmVyc2lvbiAke2lkfSByZW1vdmVkIChpbmFjdGl2ZSBmb3IgJHtNYXRoLnJvdW5kKChub3cgLSBjb252Lmxhc3RQaW5nKSAvIDEwMDApfXMpYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgdGhlIGNvbnZlcnNpb24gaGFzIGEgY2xlYW51cCBmdW5jdGlvbiwgY2FsbCBpdFxyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY29udi5jbGVhbnVwID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb252LmNsZWFudXAoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbQ29udmVydGVyUmVnaXN0cnldIEVycm9yIGNsZWFuaW5nIHVwIGNvbnZlcnNpb24gJHtpZH06YCwgY2xlYW51cEVycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBMb2cgc3VtbWFyeSBpZiBhbnkgc3RhbGUgY29udmVyc2lvbnMgd2VyZSByZW1vdmVkXHJcbiAgICAgICAgICAgIGlmIChzdGFsZUNvdW50ID4gMCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtDb252ZXJ0ZXJSZWdpc3RyeV0gUmVtb3ZlZCAke3N0YWxlQ291bnR9IHN0YWxlIGNvbnZlcnNpb25zLiBBY3RpdmUgY29udmVyc2lvbnMgcmVtYWluaW5nOiAke3RoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2l6ZX1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tDb252ZXJ0ZXJSZWdpc3RyeV0gRXJyb3IgZHVyaW5nIGNvbnZlcnNpb24gdmFsaWRhdGlvbjonLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgfSwgNjAwMDApOyAvLyBSdW4gZXZlcnkgNjAgc2Vjb25kc1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlZ2lzdGVycyBhbiBhY3RpdmUgY29udmVyc2lvbiB3aXRoIHRoZSByZWdpc3RyeS5cclxuICogQHBhcmFtIHtzdHJpbmd9IGlkIC0gVW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBjb252ZXJzaW9uXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBjb252ZXJzaW9uRGF0YSAtIERhdGEgYWJvdXQgdGhlIGNvbnZlcnNpb25cclxuICogQHBhcmFtIHtGdW5jdGlvbn0gW2NsZWFudXBdIC0gT3B0aW9uYWwgY2xlYW51cCBmdW5jdGlvbiB0byBjYWxsIHdoZW4gdGhlIGNvbnZlcnNpb24gaXMgcmVtb3ZlZFxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLnJlZ2lzdGVyQ29udmVyc2lvbiA9IGZ1bmN0aW9uKGlkLCBjb252ZXJzaW9uRGF0YSwgY2xlYW51cCkge1xyXG4gICAgaWYgKCFpZCkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tDb252ZXJ0ZXJSZWdpc3RyeV0gQ2Fubm90IHJlZ2lzdGVyIGNvbnZlcnNpb24gd2l0aG91dCBJRCcpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zZXQoaWQsIHtcclxuICAgICAgICAuLi5jb252ZXJzaW9uRGF0YSxcclxuICAgICAgICBsYXN0UGluZzogRGF0ZS5ub3coKSxcclxuICAgICAgICBjbGVhbnVwOiBjbGVhbnVwXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coYFtDb252ZXJ0ZXJSZWdpc3RyeV0gUmVnaXN0ZXJlZCBjb252ZXJzaW9uICR7aWR9LiBUb3RhbCBhY3RpdmU6ICR7dGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zaXplfWApO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFVwZGF0ZXMgdGhlIGxhc3QgcGluZyB0aW1lIGZvciBhbiBhY3RpdmUgY29udmVyc2lvbiB0byBrZWVwIGl0IGFsaXZlLlxyXG4gKiBAcGFyYW0ge3N0cmluZ30gaWQgLSBVbmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGNvbnZlcnNpb25cclxuICogQHBhcmFtIHtPYmplY3R9IFt1cGRhdGVzXSAtIE9wdGlvbmFsIHVwZGF0ZXMgdG8gdGhlIGNvbnZlcnNpb24gZGF0YVxyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjb252ZXJzaW9uIHdhcyBmb3VuZCBhbmQgdXBkYXRlZFxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLnBpbmdDb252ZXJzaW9uID0gZnVuY3Rpb24oaWQsIHVwZGF0ZXMgPSB7fSkge1xyXG4gICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGlkKTtcclxuICAgIGlmICghY29udmVyc2lvbikge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gVXBkYXRlIHRoZSBsYXN0IHBpbmcgdGltZSBhbmQgYW55IG90aGVyIHByb3ZpZGVkIHVwZGF0ZXNcclxuICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2V0KGlkLCB7XHJcbiAgICAgICAgLi4uY29udmVyc2lvbixcclxuICAgICAgICAuLi51cGRhdGVzLFxyXG4gICAgICAgIGxhc3RQaW5nOiBEYXRlLm5vdygpXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHRydWU7XHJcbn07XHJcblxyXG4vKipcclxuICogUmVtb3ZlcyBhbiBhY3RpdmUgY29udmVyc2lvbiBmcm9tIHRoZSByZWdpc3RyeS5cclxuICogQHBhcmFtIHtzdHJpbmd9IGlkIC0gVW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBjb252ZXJzaW9uXHJcbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbnZlcnNpb24gd2FzIGZvdW5kIGFuZCByZW1vdmVkXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUucmVtb3ZlQ29udmVyc2lvbiA9IGZ1bmN0aW9uKGlkKSB7XHJcbiAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoaWQpO1xyXG4gICAgaWYgKCFjb252ZXJzaW9uKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBJZiB0aGUgY29udmVyc2lvbiBoYXMgYSBjbGVhbnVwIGZ1bmN0aW9uLCBjYWxsIGl0XHJcbiAgICBpZiAodHlwZW9mIGNvbnZlcnNpb24uY2xlYW51cCA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnZlcnNpb24uY2xlYW51cCgpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbQ29udmVydGVyUmVnaXN0cnldIEVycm9yIGNsZWFuaW5nIHVwIGNvbnZlcnNpb24gJHtpZH06YCwgY2xlYW51cEVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFJlbW92ZSB0aGUgY29udmVyc2lvblxyXG4gICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5kZWxldGUoaWQpO1xyXG4gICAgY29uc29sZS5sb2coYFtDb252ZXJ0ZXJSZWdpc3RyeV0gUmVtb3ZlZCBjb252ZXJzaW9uICR7aWR9LiBUb3RhbCBhY3RpdmU6ICR7dGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zaXplfWApO1xyXG4gICAgXHJcbiAgICByZXR1cm4gdHJ1ZTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXRzIGFuIGFjdGl2ZSBjb252ZXJzaW9uIGZyb20gdGhlIHJlZ2lzdHJ5LlxyXG4gKiBAcGFyYW0ge3N0cmluZ30gaWQgLSBVbmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGNvbnZlcnNpb25cclxuICogQHJldHVybnMge09iamVjdHxudWxsfSAtIFRoZSBjb252ZXJzaW9uIGRhdGEgb3IgbnVsbCBpZiBub3QgZm91bmRcclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5nZXRDb252ZXJzaW9uID0gZnVuY3Rpb24oaWQpIHtcclxuICAgIHJldHVybiB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChpZCkgfHwgbnVsbDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBDbGVhbnMgdXAgcmVzb3VyY2VzIHVzZWQgYnkgdGhlIHJlZ2lzdHJ5LlxyXG4gKiBUaGlzIHNob3VsZCBiZSBjYWxsZWQgd2hlbiB0aGUgYXBwbGljYXRpb24gaXMgc2h1dHRpbmcgZG93bi5cclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5jbGVhbnVwID0gZnVuY3Rpb24oKSB7XHJcbiAgICAvLyBDbGVhciB0aGUgdmFsaWRhdGlvbiBpbnRlcnZhbFxyXG4gICAgaWYgKHRoaXMudmFsaWRhdGlvbkludGVydmFsKSB7XHJcbiAgICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnZhbGlkYXRpb25JbnRlcnZhbCk7XHJcbiAgICAgICAgdGhpcy52YWxpZGF0aW9uSW50ZXJ2YWwgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBDbGVhbiB1cCBhbGwgYWN0aXZlIGNvbnZlcnNpb25zXHJcbiAgICBjb25zdCBjb252ZXJzaW9uQ291bnQgPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNpemU7XHJcbiAgICBpZiAoY29udmVyc2lvbkNvdW50ID4gMCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbQ29udmVydGVyUmVnaXN0cnldIENsZWFuaW5nIHVwICR7Y29udmVyc2lvbkNvdW50fSBhY3RpdmUgY29udmVyc2lvbnNgKTtcclxuICAgICAgICBcclxuICAgICAgICBBcnJheS5mcm9tKHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZW50cmllcygpKS5mb3JFYWNoKChbaWQsIGNvbnZdKSA9PiB7XHJcbiAgICAgICAgICAgIC8vIElmIHRoZSBjb252ZXJzaW9uIGhhcyBhIGNsZWFudXAgZnVuY3Rpb24sIGNhbGwgaXRcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBjb252LmNsZWFudXAgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udi5jbGVhbnVwKCk7XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbQ29udmVydGVyUmVnaXN0cnldIEVycm9yIGNsZWFuaW5nIHVwIGNvbnZlcnNpb24gJHtpZH06YCwgY2xlYW51cEVycm9yKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENsZWFyIHRoZSBtYXBcclxuICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmNsZWFyKCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCdbQ29udmVydGVyUmVnaXN0cnldIENsZWFudXAgY29tcGxldGUnKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZWdpc3RlciBhIGNvbnZlcnRlciBmb3IgYSBzcGVjaWZpYyBmaWxlIHR5cGVcclxuICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBGaWxlIHR5cGUgKGV4dGVuc2lvbiB3aXRob3V0IGRvdClcclxuICogQHBhcmFtIHtPYmplY3R9IGNvbnZlcnRlciAtIENvbnZlcnRlciBpbXBsZW1lbnRhdGlvblxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLnJlZ2lzdGVyID0gZnVuY3Rpb24odHlwZSwgY29udmVydGVyKSB7XHJcbiAgICB0aGlzLmNvbnZlcnRlcnNbdHlwZV0gPSBjb252ZXJ0ZXI7XHJcbiAgICBjb25zb2xlLmxvZyhgUmVnaXN0ZXJlZCBjb252ZXJ0ZXIgZm9yICR7dHlwZX1gKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXQgY29udmVydGVyIGJ5IGZpbGUgZXh0ZW5zaW9uXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBleHRlbnNpb24gLSBGaWxlIGV4dGVuc2lvbiAod2l0aCBvciB3aXRob3V0IGRvdClcclxuICogQHJldHVybnMge09iamVjdHxudWxsfSBDb252ZXJ0ZXIgb3IgbnVsbCBpZiBub3QgZm91bmRcclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiA9IGZ1bmN0aW9uKGV4dGVuc2lvbikge1xyXG4gICAgLy8gTm9ybWFsaXplIGV4dGVuc2lvbiAocmVtb3ZlIGRvdCwgbG93ZXJjYXNlKVxyXG4gICAgY29uc3Qgbm9ybWFsaXplZEV4dCA9IGV4dGVuc2lvbi50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL15cXC4vLCAnJyk7XHJcbiAgICByZXR1cm4gdGhpcy5jb252ZXJ0ZXJzW25vcm1hbGl6ZWRFeHRdIHx8IG51bGw7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0IGNvbnZlcnRlciBieSBNSU1FIHR5cGVcclxuICogQHBhcmFtIHtzdHJpbmd9IG1pbWVUeXBlIC0gTUlNRSB0eXBlXHJcbiAqIEByZXR1cm5zIHtPYmplY3R8bnVsbH0gQ29udmVydGVyIG9yIG51bGwgaWYgbm90IGZvdW5kXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuZ2V0Q29udmVydGVyQnlNaW1lVHlwZSA9IGZ1bmN0aW9uKG1pbWVUeXBlKSB7XHJcbiAgICAvLyBGaW5kIGNvbnZlcnRlciB0aGF0IHN1cHBvcnRzIHRoaXMgTUlNRSB0eXBlXHJcbiAgICBmb3IgKGNvbnN0IFt0eXBlLCBjb252ZXJ0ZXJdIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuY29udmVydGVycykpIHtcclxuICAgICAgICBpZiAoY29udmVydGVyLmNvbmZpZyAmJiBcclxuICAgICAgICAgICAgY29udmVydGVyLmNvbmZpZy5taW1lVHlwZXMgJiYgXHJcbiAgICAgICAgICAgIGNvbnZlcnRlci5jb25maWcubWltZVR5cGVzLmluY2x1ZGVzKG1pbWVUeXBlKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gY29udmVydGVyO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIENvbnZlcnQgY29udGVudCB0byBtYXJrZG93biB1c2luZyBhcHByb3ByaWF0ZSBjb252ZXJ0ZXJcclxuICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBGaWxlIHR5cGVcclxuICogQHBhcmFtIHtCdWZmZXJ8c3RyaW5nfSBjb250ZW50IC0gQ29udGVudCB0byBjb252ZXJ0XHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IENvbnZlcnNpb24gcmVzdWx0XHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuY29udmVydFRvTWFya2Rvd24gPSBhc3luYyBmdW5jdGlvbih0eXBlLCBjb250ZW50LCBvcHRpb25zKSB7XHJcbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgIGNvbnN0IGNvbnZlcnRlciA9IHRoaXMuZ2V0Q29udmVydGVyQnlFeHRlbnNpb24odHlwZSk7XHJcbiAgICBpZiAoIWNvbnZlcnRlcikge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gY29udmVydGVyIGZvdW5kIGZvciB0eXBlOiAke3R5cGV9YCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBhd2FpdCBjb252ZXJ0ZXIuY29udmVydChjb250ZW50LCBvcHRpb25zLm5hbWUgfHwgJ2ZpbGUnLCBvcHRpb25zLmFwaUtleSwgb3B0aW9ucyk7XHJcbn07XHJcblxyXG4vKipcclxuICogU2V0dXAgYWxsIGF2YWlsYWJsZSBjb252ZXJ0ZXJzXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuc2V0dXBDb252ZXJ0ZXJzID0gZnVuY3Rpb24oKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIC8vIEltcG9ydCBjb252ZXJ0ZXJzIGZyb20gdGhlIG5ldyBsb2NhdGlvblxyXG4gICAgICAgIGNvbnN0IENzdkNvbnZlcnRlciA9IHJlcXVpcmUoJy4vZGF0YS9Dc3ZDb252ZXJ0ZXInKTtcclxuICAgICAgICBjb25zdCBYbHN4Q29udmVydGVyID0gcmVxdWlyZSgnLi9kYXRhL1hsc3hDb252ZXJ0ZXInKTtcclxuICAgICAgICBjb25zdCBNZWRpYUNvbnZlcnRlciA9IHJlcXVpcmUoJy4vbXVsdGltZWRpYS9NZWRpYUNvbnZlcnRlcicpO1xyXG4gICAgICAgIGNvbnN0IFBkZkZhY3RvcnkgPSByZXF1aXJlKCcuL2RvY3VtZW50L1BkZkNvbnZlcnRlckZhY3RvcnknKTtcclxuICAgICAgICBjb25zdCBEb2N4Q29udmVydGVyID0gcmVxdWlyZSgnLi9kb2N1bWVudC9Eb2N4Q29udmVydGVyJyk7XHJcbiAgICAgICAgY29uc3QgUHB0eENvbnZlcnRlciA9IHJlcXVpcmUoJy4vZG9jdW1lbnQvUHB0eENvbnZlcnRlcicpO1xyXG4gICAgICAgIGNvbnN0IFVybENvbnZlcnRlciA9IHJlcXVpcmUoJy4vd2ViL1VybENvbnZlcnRlcicpO1xyXG4gICAgICAgIGNvbnN0IFBhcmVudFVybENvbnZlcnRlciA9IHJlcXVpcmUoJy4vd2ViL1BhcmVudFVybENvbnZlcnRlcicpO1xyXG5cclxuICAgICAgICAvLyBJbXBvcnQgc2luZ2xldG9uIHNlcnZpY2UgaW5zdGFuY2VzXHJcbiAgICAgICAgY29uc3QgZmlsZVByb2Nlc3NvclNlcnZpY2VJbnN0YW5jZSA9IHJlcXVpcmUoJy4uL3N0b3JhZ2UvRmlsZVByb2Nlc3NvclNlcnZpY2UnKTtcclxuICAgICAgICBjb25zdCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZSA9IHJlcXVpcmUoJy4uL3N0b3JhZ2UvRmlsZVN0b3JhZ2VTZXJ2aWNlJyk7XHJcbiAgICAgICAgY29uc3QgZGVlcGdyYW1TZXJ2aWNlSW5zdGFuY2UgPSByZXF1aXJlKCcuLi9haS9EZWVwZ3JhbVNlcnZpY2UnKTtcclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIGluc3RhbmNlcyBvZiBjb252ZXJ0ZXIgY2xhc3NlcywgcGFzc2luZyBzaW5nbGV0b24gZGVwZW5kZW5jaWVzXHJcbiAgICAgICAgY29uc3QgY3N2Q29udmVydGVySW5zdGFuY2UgPSBuZXcgQ3N2Q29udmVydGVyKCk7XHJcbiAgICAgICAgY29uc3QgeGxzeENvbnZlcnRlckluc3RhbmNlID0gbmV3IFhsc3hDb252ZXJ0ZXIoKTtcclxuICAgICAgICAvLyBQYXNzIHRoZSBzaW5nbGV0b24gaW5zdGFuY2VzIHRvIHRoZSBjb25zdHJ1Y3RvcnNcclxuICAgICAgICBjb25zdCBtZWRpYUNvbnZlcnRlckluc3RhbmNlID0gbmV3IE1lZGlhQ29udmVydGVyKHRoaXMsIGZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UsIGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlKTtcclxuICAgICAgICBjb25zdCBwZGZDb252ZXJ0ZXJGYWN0b3J5ID0gbmV3IFBkZkZhY3RvcnkoKTtcclxuICAgICAgICBjb25zdCBkb2N4Q29udmVydGVySW5zdGFuY2UgPSBuZXcgRG9jeENvbnZlcnRlcigpO1xyXG4gICAgICAgIGNvbnN0IHBwdHhDb252ZXJ0ZXJJbnN0YW5jZSA9IG5ldyBQcHR4Q29udmVydGVyKCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gSW5zdGFudGlhdGUgVVJMIGNvbnZlcnRlcnMgd2l0aCBzaW5nbGV0b24gZGVwZW5kZW5jaWVzIChvciBtb2NrcyBpZiBhcHByb3ByaWF0ZSlcclxuICAgICAgICAvLyBOb3RlOiBVUkwgY29udmVydGVycyBtaWdodCBub3QgbmVlZCB0aGUgZnVsbCBmaWxlIHNlcnZpY2VzLCB1c2luZyBtb2NrcyBtaWdodCBzdGlsbCBiZSBva2F5IGhlcmVcclxuICAgICAgICAvLyBVc2luZyBzaW5nbGV0b25zIGZvciBjb25zaXN0ZW5jeSwgYnV0IGNvdWxkIHJldmVydCB0byBtb2NrcyBpZiBuZWVkZWQuXHJcbiAgICAgICAgY29uc3QgdXJsQ29udmVydGVySW5zdGFuY2UgPSBuZXcgVXJsQ29udmVydGVyKGZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UsIGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlKTtcclxuICAgICAgICBjb25zdCBwYXJlbnRVcmxDb252ZXJ0ZXJJbnN0YW5jZSA9IG5ldyBQYXJlbnRVcmxDb252ZXJ0ZXIoZmlsZVByb2Nlc3NvclNlcnZpY2VJbnN0YW5jZSwgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UpO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIERPQ1ggY29udmVydGVyIHVzaW5nIHRoZSBhY3R1YWwgaW1wbGVtZW50YXRpb25cclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdkb2N4Jywge1xyXG4gICAgICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbRG9jeEFkYXB0ZXJdIENvbnZlcnRpbmcgRE9DWCBmaWxlOiAke25hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIGNvbnRlbnQgaXMgYSBCdWZmZXJcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihjb250ZW50KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0RPQ1ggY29udGVudCBtdXN0IGJlIGEgQnVmZmVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSB0aGUgYWN0dWFsIERvY3hDb252ZXJ0ZXIgaW1wbGVtZW50YXRpb25cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2N4Q29udmVydGVySW5zdGFuY2UuY29udmVydFRvTWFya2Rvd24oY29udGVudCwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxlTmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXBpS2V5XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHdlIGhhdmUgY29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcmVzdWx0IHx8IHR5cGVvZiByZXN1bHQgIT09ICdzdHJpbmcnIHx8IHJlc3VsdC50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRE9DWCBjb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQnKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogcmVzdWx0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnZG9jeCdcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbRG9jeEFkYXB0ZXJdIEVycm9yIGNvbnZlcnRpbmcgRE9DWDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRE9DWCBjb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB2YWxpZGF0ZTogKGNvbnRlbnQpID0+IEJ1ZmZlci5pc0J1ZmZlcihjb250ZW50KSAmJiBjb250ZW50Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ0RPQ1ggQ29udmVydGVyJyxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLmRvY3gnLCAnLmRvYyddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC53b3JkcHJvY2Vzc2luZ21sLmRvY3VtZW50JywgJ2FwcGxpY2F0aW9uL21zd29yZCddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAwICogMTAyNCAqIDEwMjQgLy8gMTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgYWRhcHRlciBmb3IgUFBUWCBjb252ZXJ0ZXIgdXNpbmcgdGhlIGFjdHVhbCBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3BwdHgnLCB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtQcHR4QWRhcHRlcl0gQ29udmVydGluZyBQUFRYIGZpbGU6ICR7bmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgY29udGVudCBpcyBhIEJ1ZmZlclxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUFBUWCBjb250ZW50IG11c3QgYmUgYSBCdWZmZXInKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHRoZSBhY3R1YWwgUHB0eENvbnZlcnRlciBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBwdHhDb252ZXJ0ZXJJbnN0YW5jZS5jb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhcGlLZXlcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgd2UgaGF2ZSBjb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQgfHwgdHlwZW9mIHJlc3VsdCAhPT0gJ3N0cmluZycgfHwgcmVzdWx0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQUFRYIGNvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiByZXN1bHQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwcHR4J1xyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQcHR4QWRhcHRlcl0gRXJyb3IgY29udmVydGluZyBQUFRYOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBQUFRYIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpICYmIGNvbnRlbnQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnUFBUWCBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICAgICAgZXh0ZW5zaW9uczogWycucHB0eCcsICcucHB0J10sXHJcbiAgICAgICAgICAgICAgICBtaW1lVHlwZXM6IFsnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnByZXNlbnRhdGlvbm1sLnByZXNlbnRhdGlvbicsICdhcHBsaWNhdGlvbi92bmQubXMtcG93ZXJwb2ludCddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAwICogMTAyNCAqIDEwMjQgLy8gMTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgYWRhcHRlciBmb3IgdGhlIENTViBjb252ZXJ0ZXJcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdjc3YnLCB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZBZGFwdGVyXSBDb252ZXJ0aW5nIENTViBmaWxlOiAke25hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ29udmVydCB0aGUgY29udGVudCB0byBzdHJpbmdcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb250ZW50U3RyID0gY29udGVudC50b1N0cmluZygpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSB0aGUgYWN0dWFsIENzdkNvbnZlcnRlciBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNzdkNvbnZlcnRlckluc3RhbmNlLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnRTdHIsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogbmFtZSAvLyBQYXNzIHRoZSBvcmlnaW5hbCBmaWxlbmFtZVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSB3ZSBoYXZlIGNvbnRlbnRcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXJlc3VsdCB8fCB0eXBlb2YgcmVzdWx0ICE9PSAnc3RyaW5nJyB8fCByZXN1bHQudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NTViBjb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQnKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogcmVzdWx0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnY3N2J1xyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtDc3ZBZGFwdGVyXSBFcnJvciBjb252ZXJ0aW5nIENTVjogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ1NWIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpICYmIGNvbnRlbnQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnQ1NWIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy5jc3YnXSxcclxuICAgICAgICAgICAgICAgIG1pbWVUeXBlczogWyd0ZXh0L2NzdiddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAwICogMTAyNCAqIDEwMjQgLy8gMTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIHRoZSBYTFNYIGNvbnZlcnRlclxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3hsc3gnLCB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4QWRhcHRlcl0gQ29udmVydGluZyBFeGNlbCBmaWxlOiAke25hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIGNvbnRlbnQgaXMgYSBCdWZmZXJcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihjb250ZW50KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4Y2VsIGNvbnRlbnQgbXVzdCBiZSBhIEJ1ZmZlcicpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBSZWFkIHRoZSBFeGNlbCBmaWxlIHVzaW5nIHhsc3ggbGlicmFyeVxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHhsc3ggPSByZXF1aXJlKCd4bHN4Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgbGV0IHdvcmtib29rO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBmaWxlIHRvIHJlYWQgdGhlIEV4Y2VsIGNvbnRlbnRcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcyA9IHJlcXVpcmUoJ29zJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBwYXRoLmpvaW4ob3MudG1wZGlyKCksIGB4bHN4X2NvbnZlcnNpb25fJHtEYXRlLm5vdygpfWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5lbnN1cmVEaXIodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBTdG9yZSBvcmlnaW5hbCBuYW1lIGZvciBsYXRlciB1c2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxGaWxlTmFtZSA9IG5hbWU7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgYSB0ZW1wIGZpbGUgd2l0aCBhIGdlbmVyaWMgbmFtZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRmlsZSA9IHBhdGguam9pbih0ZW1wRGlyLCBgZXhjZWxfY29udmVyc2lvbl8ke0RhdGUubm93KCl9Lnhsc3hgKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKHRlbXBGaWxlLCBjb250ZW50KTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFJlYWQgdGhlIEV4Y2VsIGZpbGVcclxuICAgICAgICAgICAgICAgICAgICAgICAgd29ya2Jvb2sgPSB4bHN4LnJlYWRGaWxlKHRlbXBGaWxlLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjZWxsRGF0ZXM6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi4ob3B0aW9ucy54bHN4T3B0aW9ucyB8fCB7fSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGZpbGVcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKHJlYWRFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeEFkYXB0ZXJdIEZhaWxlZCB0byByZWFkIEV4Y2VsIGZpbGU6ICR7bmFtZX1gLCByZWFkRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byByZWFkIEV4Y2VsIGZpbGU6ICR7cmVhZEVycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSB0aGUgYWN0dWFsIFhsc3hDb252ZXJ0ZXIgaW1wbGVtZW50YXRpb25cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB4bHN4Q29udmVydGVySW5zdGFuY2UuY29udmVydFRvTWFya2Rvd24od29ya2Jvb2ssIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogb3JpZ2luYWxGaWxlTmFtZSB8fCBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcmlnaW5hbEZpbGVOYW1lIHx8IG5hbWUgLy8gUGFzcyB0aGUgb3JpZ2luYWwgZmlsZW5hbWVcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgd2UgaGF2ZSBjb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQgfHwgdHlwZW9mIHJlc3VsdCAhPT0gJ3N0cmluZycgfHwgcmVzdWx0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeGNlbCBjb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQnKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gTWFrZSBzdXJlIHdlJ3JlIHByb3Blcmx5IHJldHVybmluZyB0aGUgb3JpZ2luYWwgZmlsZW5hbWVcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiByZXN1bHQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IG9yaWdpbmFsRmlsZU5hbWUgfHwgbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3hsc3gnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcmlnaW5hbEZpbGVOYW1lIHx8IG5hbWUgLy8gRW5zdXJlIHRoZSBvcmlnaW5hbCBmaWxlbmFtZSBpcyBwcmVzZXJ2ZWRcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeEFkYXB0ZXJdIEVycm9yIGNvbnZlcnRpbmcgRXhjZWw6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4Y2VsIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpICYmIGNvbnRlbnQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnRXhjZWwgQ29udmVydGVyJyxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnhsc3gnLCAnLnhscyddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JywgJ2FwcGxpY2F0aW9uL3ZuZC5tcy1leGNlbCddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAwICogMTAyNCAqIDEwMjQgLy8gMTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIG1lZGlhIGNvbnZlcnRlcnMgKGF1ZGlvIGFuZCB2aWRlbylcclxuICAgICAgICBjb25zdCBtZWRpYUFkYXB0ZXIgPSB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIGxldCB0ZW1wRGlyID0gbnVsbDsgLy8gRGVjbGFyZSB0ZW1wRGlyIG91dHNpZGUgdHJ5IGJsb2NrIGZvciBjbGVhbnVwIGFjY2Vzc1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQWRhcHRlcl0gQ29udmVydGluZyBtZWRpYSBmaWxlOiAke25hbWV9YCk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBjb250ZW50IGlzIGEgQnVmZmVyXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoY29udGVudCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNZWRpYSBjb250ZW50IG11c3QgYmUgYSBCdWZmZXInKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBmaWxlIHRvIHByb2Nlc3MgdGhlIG1lZGlhXHJcbiAgICAgICAgICAgICAgICAgICAgdGVtcERpciA9IGF3YWl0IGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlLmNyZWF0ZVRlbXBEaXIoJ21lZGlhX2FkYXB0ZXJfdGVtcCcpOyAvLyBNb3JlIHNwZWNpZmljIHRlbXAgZGlyIG5hbWVcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRmlsZU5hbWUgPSBgJHtuYW1lfV8ke0RhdGUubm93KCl9JHtwYXRoLmV4dG5hbWUobmFtZSkgfHwgJy5tcDQnfWA7IC8vIEVuc3VyZSBhIHZhbGlkIGV4dGVuc2lvbiwgZGVmYXVsdCB0byAubXA0XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcEZpbGUgPSBwYXRoLmpvaW4odGVtcERpciwgdGVtcEZpbGVOYW1lKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQWRhcHRlcl0gV3JpdGluZyBidWZmZXIgZm9yICcke25hbWV9JyB0byB0ZW1wb3JhcnkgZmlsZTogJHt0ZW1wRmlsZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUodGVtcEZpbGUsIGNvbnRlbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFBZGFwdGVyXSBCdWZmZXIgd3JpdHRlbiB0byAke3RlbXBGaWxlfWApO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBHZXQgZGVlcGdyYW0gQVBJIGtleSBmcm9tIG9wdGlvbnMgb3Igc2V0dGluZ3NcclxuICAgICAgICAgICAgICAgICAgICAvLyBUaGlzIGxvZ2ljIGlzIG5vdyBwcmltYXJpbHkgaGFuZGxlZCB3aXRoaW4gTWVkaWFDb252ZXJ0ZXIsIGJ1dCBjYW4gYmUgcGFzc2VkIGFzIG92ZXJyaWRlLlxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlZXBncmFtQXBpS2V5ID0gb3B0aW9ucy5kZWVwZ3JhbUFwaUtleSB8fCBudWxsOyBcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gUHJvY2VzcyB0aGUgbWVkaWEgZmlsZSB1c2luZyBNZWRpYUNvbnZlcnRlclxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBhIG1vcmUgY29tcGxldGUgbW9jayBldmVudCB0aGF0IHByb3ZpZGVzIGEgdmFsaWQgQnJvd3NlcldpbmRvdyBvciBudWxsXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gYnV0IGluIGEgd2F5IHRoYXQgd29uJ3QgdGhyb3cgZXJyb3JzIHdoZW4gYWNjZXNzaW5nIHByb3BlcnRpZXNcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBtb2NrRXZlbnQgPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbmRlcjoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZ2V0T3duZXJCcm93c2VyV2luZG93OiAoKSA9PiBudWxsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQWRkIGEgbW9jayB3ZWJDb250ZW50cyB0byBwcmV2ZW50IG51bGwgcmVmZXJlbmNlIGVycm9yc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgd2ViQ29udGVudHM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZW5kOiAoY2hhbm5lbCwgZGF0YSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW01lZGlhQWRhcHRlcl0gV291bGQgc2VuZCB0byBjaGFubmVsICR7Y2hhbm5lbH06YCwgZGF0YSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRoaXMgaXMgYSBuby1vcCBmdW5jdGlvbiB0aGF0IGxvZ3MgdGhlIHdvdWxkLWJlIHNlbnQgZGF0YVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBidXQgZG9lc24ndCBhY3R1YWxseSB0cnkgdG8gY29tbXVuaWNhdGUgd2l0aCBhIHdpbmRvd1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG1lZGlhQ29udmVydGVySW5zdGFuY2UuaGFuZGxlQ29udmVydChtb2NrRXZlbnQsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGg6IHRlbXBGaWxlLCAvLyBQYXNzIHRoZSBwYXRoIHRvIHRoZSB0ZW1wb3JhcnkgZmlsZSBjb250YWluaW5nIHRoZSBidWZmZXIgY29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLCAvLyBQYXNzIHRocm91Z2ggYWxsIG9yaWdpbmFsIG9wdGlvbnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzVGVtcElucHV0RmlsZTogdHJ1ZSwgLy8gSW5kaWNhdGUgdGhhdCBmaWxlUGF0aCBpcyBhIHRlbXAgZmlsZSBjcmVhdGVkIGJ5IHRoZSBhZGFwdGVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBuYW1lLCAvLyBQYXNzIHRoZSBvcmlnaW5hbCBmaWxlIG5hbWVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZXBncmFtQXBpS2V5OiBkZWVwZ3JhbUFwaUtleSwgLy8gUGFzcyBleHBsaWNpdGx5IGlmIHByb3ZpZGVkLCBvdGhlcndpc2UgTWVkaWFDb252ZXJ0ZXIgd2lsbCBmaW5kIGl0XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBfdGVtcERpciBpcyBubyBsb25nZXIgbmVlZGVkIGhlcmUgYXMgTWVkaWFDb252ZXJ0ZXIgaGFuZGxlcyBpdHMgb3duIHRlbXAgc3BhY2Ugb3IgY2xlYW5zIHRoZSBpbnB1dCB0ZW1wIGRpclxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gbWVkaWFDb252ZXJ0ZXJJbnN0YW5jZS5oYW5kbGVDb252ZXJ0IG5vdyByZXR1cm5zIHsgY29udmVyc2lvbklkLCBvcmlnaW5hbEZpbGVOYW1lIH1cclxuICAgICAgICAgICAgICAgICAgICAvLyBUaGUgc3VjY2VzcyBvZiB0aGUgKmluaXRpYXRpb24qIGlzIGltcGxpZWQgaWYgbm8gZXJyb3IgaXMgdGhyb3duLlxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFRoZSBhY3R1YWwgY29udmVyc2lvbiByZXN1bHQgaXMgYXN5bmNocm9ub3VzLlxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWVkaWFBZGFwdGVyXSBNZWRpYSBjb252ZXJzaW9uIGluaXRpYXRlZCBmb3IgJyR7bmFtZX0nLiBDb252ZXJzaW9uIElEOiAke3Jlc3VsdC5jb252ZXJzaW9uSWR9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSwgLy8gSW5kaWNhdGVzIHN1Y2Nlc3NmdWwgaW5pdGlhdGlvblxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb252ZXJzaW9uSWQ6IHJlc3VsdC5jb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFzeW5jOiB0cnVlLCAvLyBDcml0aWNhbDogc2lnbmFscyB0byBjbGllbnQgdGhhdCByZXN1bHQgaXMgYXN5bmNcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogcmVzdWx0Lm9yaWdpbmFsRmlsZU5hbWUgfHwgbmFtZSwgLy8gVXNlIG9yaWdpbmFsRmlsZU5hbWUgZnJvbSByZXN1bHQgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdtZWRpYScsIC8vIE9yIGRlcml2ZSBmcm9tIGFjdHVhbCBmaWxlIHR5cGUgaWYgbmVlZGVkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEFkZCBhIGZsYWcgdG8gaW5kaWNhdGUgdGhhdCB0aGlzIGlzIGEgdHJhbnNjcmlwdGlvbiBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlzVHJhbnNjcmlwdGlvbjogdHJ1ZSAvLyBUaGlzIHdpbGwgYmUgdXNlZCB0byBoYW5kbGUgdHJhbnNjcmlwdGlvbiBmYWlsdXJlcyBkaWZmZXJlbnRseVxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yLm1lc3NhZ2UgfHwgJ1Vua25vd24gZXJyb3IgaW4gbWVkaWEgYWRhcHRlcic7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW01lZGlhQWRhcHRlcl0gRXJyb3IgY29udmVydGluZyBtZWRpYSBmaWxlICcke25hbWV9JzpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgdGVtcERpciB3YXMgY3JlYXRlZCwgYXR0ZW1wdCB0byBjbGVhbiBpdCB1cC5cclxuICAgICAgICAgICAgICAgICAgICBpZiAodGVtcERpcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXhpc3RzID0gYXdhaXQgZnMucGF0aEV4aXN0cyh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGlzdHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUFkYXB0ZXJdIENsZWFuZWQgdXAgdGVtcCBkaXJlY3RvcnkgJHt0ZW1wRGlyfSBhZnRlciBlcnJvci5gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWVkaWFBZGFwdGVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3RvcnkgJHt0ZW1wRGlyfSBhZnRlciBlcnJvcjpgLCBjbGVhbnVwRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWVkaWEgY29udmVyc2lvbiBmYWlsZWQgZm9yICcke25hbWV9JzogJHtlcnJvck1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpICYmIGNvbnRlbnQubGVuZ3RoID4gMCwgLy8gVGhpcyBhZGFwdGVyIGlzIGZvciBidWZmZXIgaW5wdXRzXHJcbiAgICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ01lZGlhIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy5tcDMnLCAnLndhdicsICcub2dnJywgJy5tNGEnLCAnLmZsYWMnLCAnLm1wNCcsICcubW92JywgJy5hdmknLCAnLm1rdicsICcud2VibSddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbXHJcbiAgICAgICAgICAgICAgICAgICAgJ2F1ZGlvL21wZWcnLCAnYXVkaW8vbXAzJywgJ2F1ZGlvL3dhdicsICdhdWRpby9vZ2cnLCAnYXVkaW8vbTRhJywgJ2F1ZGlvL2ZsYWMnLFxyXG4gICAgICAgICAgICAgICAgICAgICd2aWRlby9tcDQnLCAndmlkZW8vd2VibScsICd2aWRlby9xdWlja3RpbWUnLCAndmlkZW8veC1tc3ZpZGVvJywgJ3ZpZGVvL3gtbWF0cm9za2EnXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogNTAwICogMTAyNCAqIDEwMjQgLy8gNTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIFJlZ2lzdGVyIGFsbCBtZWRpYSBmb3JtYXRzIHRvIHVzZSB0aGUgc2FtZSBjb252ZXJ0ZXJcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdtcDMnLCBtZWRpYUFkYXB0ZXIpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3dhdicsIG1lZGlhQWRhcHRlcik7XHJcbiAgICAgICAgdGhpcy5yZWdpc3Rlcignb2dnJywgbWVkaWFBZGFwdGVyKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdtNGEnLCBtZWRpYUFkYXB0ZXIpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ2ZsYWMnLCBtZWRpYUFkYXB0ZXIpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ21wNCcsIG1lZGlhQWRhcHRlcik7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcignbW92JywgbWVkaWFBZGFwdGVyKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdhdmknLCBtZWRpYUFkYXB0ZXIpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ21rdicsIG1lZGlhQWRhcHRlcik7XHJcbiAgICAgICAgdGhpcy5yZWdpc3Rlcignd2VibScsIG1lZGlhQWRhcHRlcik7XHJcblxyXG4gICAgICAgIC8vIFJlZ2lzdGVyIHBwdCBleHRlbnNpb24gdG8gdXNlIHRoZSBzYW1lIGNvbnZlcnRlciBhcyBwcHR4XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcigncHB0JywgdGhpcy5jb252ZXJ0ZXJzWydwcHR4J10pO1xyXG5cclxuICAgICAgICAvLyBSZWdpc3RlciB0aGUgUERGIGZhY3RvcnkgYWRhcHRlciB3aXRoIHByb3BlciBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3BkZicsIHtcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcIltQZGZBZGFwdGVyXSBDb252ZXJ0aW5nIFBERiBkb2N1bWVudFwiKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgdGVtcCBkaXJlY3RvcnkgZm9yIGNvbnZlcnNpb24gdXNpbmcgdGhlIHNpbmdsZXRvbiBzZXJ2aWNlXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlLmNyZWF0ZVRlbXBEaXIoJ3BkZl9jb252ZXJzaW9uJyk7IFxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSB0aGUgZGlyZWN0b3J5IGV4aXN0c1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLmVuc3VyZURpcih0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRmlsZSA9IHBhdGguam9pbih0ZW1wRGlyLCBgZG9jdW1lbnRfJHtEYXRlLm5vdygpfS5wZGZgKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBXcml0ZSBidWZmZXIgdG8gdGVtcCBmaWxlXHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKHRlbXBGaWxlLCBjb250ZW50KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBWZXJpZnkgdGhlIGZpbGUgd2FzIHdyaXR0ZW4gc3VjY2Vzc2Z1bGx5XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEoYXdhaXQgZnMucGF0aEV4aXN0cyh0ZW1wRmlsZSkpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHdyaXRlIHRlbXBvcmFyeSBQREYgZmlsZTogJHt0ZW1wRmlsZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRGV0ZXJtaW5lIGlmIE9DUiBzaG91bGQgYmUgdXNlZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBEZXRlcm1pbmUgaWYgT0NSIHNob3VsZCBiZSB1c2VkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHVzZU9jciA9IG9wdGlvbnMudXNlT2NyID09PSB0cnVlICYmIG9wdGlvbnMubWlzdHJhbEFwaUtleTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBhcHByb3ByaWF0ZSBjb252ZXJ0ZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGV0IHJlc3VsdDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVzZU9jcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tDb252ZXJ0ZXJSZWdpc3RyeV0gVXNpbmcgTWlzdHJhbCBPQ1IgY29udmVydGVyIGZvciBQREYgY29udmVyc2lvbicpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVXNlIE1pc3RyYWwgT0NSIGNvbnZlcnRlciAtIHJlcXVpcmUgaXQgZGlyZWN0bHkgdG8gZW5zdXJlIGl0J3MgaW4gc2NvcGVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdHJ1ZSBmb3Igc2tpcEhhbmRsZXJTZXR1cCB0byBhdm9pZCBkdXBsaWNhdGUgSVBDIGhhbmRsZXIgcmVnaXN0cmF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHNpbmdsZXRvbiBzZXJ2aWNlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgTWlzdHJhbFBkZkNvbnZlcnRlckNsYXNzID0gcmVxdWlyZSgnLi9kb2N1bWVudC9NaXN0cmFsUGRmQ29udmVydGVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtaXN0cmFsQ29udmVydGVyID0gbmV3IE1pc3RyYWxQZGZDb252ZXJ0ZXJDbGFzcyhmaWxlUHJvY2Vzc29yU2VydmljZUluc3RhbmNlLCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZSwgbnVsbCwgdHJ1ZSk7IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gU2V0IHRoZSBBUEkga2V5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtaXN0cmFsQ29udmVydGVyLmFwaUtleSA9IG9wdGlvbnMubWlzdHJhbEFwaUtleTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbQ29udmVydGVyUmVnaXN0cnldIE1pc3RyYWwgQVBJIGtleSBzZXQgZm9yIE9DUiBjb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IG1pc3RyYWxDb252ZXJ0ZXIuY29udmVydFRvTWFya2Rvd24oY29udGVudCwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZmlsZU5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlLZXk6IG9wdGlvbnMubWlzdHJhbEFwaUtleVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBVc2Ugc3RhbmRhcmQgY29udmVydGVyIC0gcmVxdWlyZSBpdCBkaXJlY3RseSB0byBlbnN1cmUgaXQncyBpbiBzY29wZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0cnVlIGZvciBza2lwSGFuZGxlclNldHVwIHRvIGF2b2lkIGR1cGxpY2F0ZSBJUEMgaGFuZGxlciByZWdpc3RyYXRpb25cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFBhc3Mgc2luZ2xldG9uIHNlcnZpY2VzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW0NvbnZlcnRlclJlZ2lzdHJ5XSBVc2luZyBzdGFuZGFyZCBQREYgY29udmVydGVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBTdGFuZGFyZFBkZkNvbnZlcnRlckNsYXNzID0gcmVxdWlyZSgnLi9kb2N1bWVudC9TdGFuZGFyZFBkZkNvbnZlcnRlcicpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhbmRhcmRDb252ZXJ0ZXIgPSBuZXcgU3RhbmRhcmRQZGZDb252ZXJ0ZXJDbGFzcyhmaWxlUHJvY2Vzc29yU2VydmljZUluc3RhbmNlLCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZSwgdHJ1ZSk7IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgc3RhbmRhcmRDb252ZXJ0ZXIuY29udmVydFRvTWFya2Rvd24oY29udGVudCwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZmlsZU5hbWU6IG5hbWVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgcmVzdWx0IGhhcyBzdWNjZXNzIGZsYWcgYW5kIGNvbnRlbnRcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKHJlc3VsdC5lcnJvciB8fCAnUERGIGNvbnZlcnNpb24gZmFpbGVkIHdpdGggbm8gc3BlY2lmaWMgZXJyb3InKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQuY29udGVudCB8fCB0eXBlb2YgcmVzdWx0LmNvbnRlbnQgIT09ICdzdHJpbmcnIHx8IHJlc3VsdC5jb250ZW50LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUERGIGNvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudCcpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFJlLXRocm93IGVycm9yXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BkZkFkYXB0ZXJdIEVycm9yIGNvbnZlcnRpbmcgUERGOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBQREYgY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdmFsaWRhdGU6IChjb250ZW50KSA9PiBCdWZmZXIuaXNCdWZmZXIoY29udGVudCkgJiYgY29udGVudC5sZW5ndGggPiAwLFxyXG4gICAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdQREYgQ29udmVydGVyJyxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnBkZiddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ2FwcGxpY2F0aW9uL3BkZiddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAwICogMTAyNCAqIDEwMjQgLy8gMTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIFVSTCBjb252ZXJ0ZXIgdXNpbmcgdGhlIGFjdHVhbCBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3VybCcsIHtcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgICAgLy8gVVJMIGNvbnZlcnRlciBleHBlY3RzIHRoZSBjb250ZW50IHRvIGJlIHRoZSBVUkwgc3RyaW5nXHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbVXJsQWRhcHRlcl0gQ29udmVydGluZyBVUkw6ICR7Y29udGVudH1gKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgdGVtcG9yYXJ5IGRpcmVjdG9yeSBmb3IgdGhlIGNvbnZlcnNpb24gdXNpbmcgdGhlIHNpbmdsZXRvbiBzZXJ2aWNlXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlLmNyZWF0ZVRlbXBEaXIoJ3VybF9jb252ZXJzaW9uJyk7IFxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIExhdW5jaCBhIGJyb3dzZXIgaW5zdGFuY2UgZm9yIHRoZSBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcHVwcGV0ZWVyID0gcmVxdWlyZSgncHVwcGV0ZWVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYnJvd3NlciA9IGF3YWl0IHB1cHBldGVlci5sYXVuY2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBoZWFkbGVzczogJ25ldycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFyZ3M6IFsnLS1uby1zYW5kYm94JywgJy0tZGlzYWJsZS1zZXR1aWQtc2FuZGJveCddXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRmV0Y2ggbWV0YWRhdGFcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB1cmxDb252ZXJ0ZXJJbnN0YW5jZS5mZXRjaE1ldGFkYXRhKGNvbnRlbnQsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRXh0cmFjdCBjb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGV4dHJhY3RlZENvbnRlbnQgPSBhd2FpdCB1cmxDb252ZXJ0ZXJJbnN0YW5jZS5leHRyYWN0Q29udGVudChjb250ZW50LCBvcHRpb25zLCBicm93c2VyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFByb2Nlc3MgaW1hZ2VzIGlmIHJlcXVlc3RlZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAob3B0aW9ucy5pbmNsdWRlSW1hZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB1cmxDb252ZXJ0ZXJJbnN0YW5jZS5wcm9jZXNzSW1hZ2VzKGV4dHJhY3RlZENvbnRlbnQsIHRlbXBEaXIsIGNvbnRlbnQsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBtYXJrZG93blxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXJrZG93biA9IHVybENvbnZlcnRlckluc3RhbmNlLmdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIGV4dHJhY3RlZENvbnRlbnQsIG51bGwsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xvc2UgYnJvd3NlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wb3JhcnkgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogbWFya2Rvd24sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3VybCdcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbG9zZSBicm93c2VyIG9uIGVycm9yXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXBvcmFyeSBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUmUtdGhyb3cgZXJyb3JcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbVXJsQWRhcHRlcl0gRXJyb3IgY29udmVydGluZyBVUkw6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVSTCBjb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB2YWxpZGF0ZTogKGNvbnRlbnQpID0+IHR5cGVvZiBjb250ZW50ID09PSAnc3RyaW5nJyAmJiBjb250ZW50Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ1VSTCBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICAgICAgZXh0ZW5zaW9uczogWycudXJsJywgJy5odG1sJywgJy5odG0nXSxcclxuICAgICAgICAgICAgICAgIG1pbWVUeXBlczogWyd0ZXh0L2h0bWwnLCAnYXBwbGljYXRpb24veC11cmwnXSxcclxuICAgICAgICAgICAgICAgIG1heFNpemU6IDEwICogMTAyNCAqIDEwMjQgLy8gMTBNQlxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgYWRhcHRlciBmb3IgUGFyZW50VVJMIGNvbnZlcnRlciB1c2luZyB0aGUgYWN0dWFsIGltcGxlbWVudGF0aW9uXHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcigncGFyZW50dXJsJywge1xyXG4gICAgICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAvLyBGb3IgVVJMIGNvbnZlcnRlcnMsIGNvbnRlbnQgaXMgdGhlIFVSTCBzdHJpbmcgaXRzZWxmXHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbUGFyZW50VXJsQWRhcHRlcl0gQ29udmVydGluZyBzaXRlOiAke2NvbnRlbnR9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIHRlbXBvcmFyeSBkaXJlY3RvcnkgZm9yIHRoZSBjb252ZXJzaW9uIHVzaW5nIHRoZSBzaW5nbGV0b24gc2VydmljZVxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZS5jcmVhdGVUZW1wRGlyKCdwYXJlbnRfdXJsX2NvbnZlcnNpb24nKTsgXHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gTGF1bmNoIGEgYnJvd3NlciBpbnN0YW5jZSBmb3IgdGhlIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBwdXBwZXRlZXIgPSByZXF1aXJlKCdwdXBwZXRlZXInKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBicm93c2VyID0gYXdhaXQgcHVwcGV0ZWVyLmxhdW5jaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGhlYWRsZXNzOiAnbmV3JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXJnczogWyctLW5vLXNhbmRib3gnLCAnLS1kaXNhYmxlLXNldHVpZC1zYW5kYm94J11cclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBEaXNjb3ZlciBzaXRlbWFwXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNpdGVtYXAgPSBhd2FpdCBwYXJlbnRVcmxDb252ZXJ0ZXJJbnN0YW5jZS5kaXNjb3ZlclNpdGVtYXAoY29udGVudCwgb3B0aW9ucywgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBQcm9jZXNzIGVhY2ggcGFnZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXhQYWdlcyA9IG9wdGlvbnMubWF4UGFnZXMgfHwgTWF0aC5taW4oc2l0ZW1hcC5wYWdlcy5sZW5ndGgsIDEwKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFnZXNUb1Byb2Nlc3MgPSBzaXRlbWFwLnBhZ2VzLnNsaWNlKDAsIG1heFBhZ2VzKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvY2Vzc2VkUGFnZXMgPSBbXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcGFnZSBvZiBwYWdlc1RvUHJvY2Vzcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gUHJvY2VzcyBwYWdlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwYWdlQ29udGVudCA9IGF3YWl0IHBhcmVudFVybENvbnZlcnRlckluc3RhbmNlLnByb2Nlc3NQYWdlKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhZ2UudXJsLCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zLCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicm93c2VyLCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZW1wRGlyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBBZGQgdG8gcHJvY2Vzc2VkIHBhZ2VzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9jZXNzZWRQYWdlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1cmw6IHBhZ2UudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlOiBwYWdlLnRpdGxlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHBhZ2VDb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgY29tYmluZWQgbWFya2Rvd25cclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2Rvd24gPSBwYXJlbnRVcmxDb252ZXJ0ZXJJbnN0YW5jZS5nZW5lcmF0ZUNvbWJpbmVkTWFya2Rvd24oXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaXRlbWFwLCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3NlZFBhZ2VzLCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsb3NlIGJyb3dzZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcG9yYXJ5IGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IG1hcmtkb3duLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdwYXJlbnR1cmwnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xvc2UgYnJvd3NlciBvbiBlcnJvclxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wb3JhcnkgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFJlLXRocm93IGVycm9yXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BhcmVudFVybEFkYXB0ZXJdIEVycm9yIGNvbnZlcnRpbmcgc2l0ZTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2l0ZSBjb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB2YWxpZGF0ZTogKGNvbnRlbnQpID0+IHR5cGVvZiBjb250ZW50ID09PSAnc3RyaW5nJyAmJiBjb250ZW50Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ1dlYnNpdGUgQ29udmVydGVyJyxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnVybCcsICcuaHRtbCcsICcuaHRtJ10sXHJcbiAgICAgICAgICAgICAgICBtaW1lVHlwZXM6IFsndGV4dC9odG1sJywgJ2FwcGxpY2F0aW9uL3gtdXJsJ10sXHJcbiAgICAgICAgICAgICAgICBtYXhTaXplOiAxMCAqIDEwMjQgKiAxMDI0IC8vIDEwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IHJlZ2lzdGVyZWRUeXBlcyA9IE9iamVjdC5rZXlzKHRoaXMuY29udmVydGVycyk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBDb252ZXJ0ZXJzIHJlZ2lzdGVyZWQgc3VjY2Vzc2Z1bGx5OiAke3JlZ2lzdGVyZWRUeXBlcy5sZW5ndGh9IHR5cGVzYCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4sgUmVnaXN0ZXJlZCB0eXBlczogJHtyZWdpc3RlcmVkVHlwZXMuam9pbignLCAnKX1gKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIHNldHRpbmcgdXAgY29udmVydGVyczonLCBlcnJvcik7XHJcbiAgICAgICAgLy8gQWRkIGRldGFpbGVkIGVycm9yIGxvZ2dpbmdcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBkZXRhaWxzOicsIHtcclxuICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcclxuICAgICAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxyXG4gICAgICAgICAgICBuYW1lOiBlcnJvci5uYW1lXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gVGhyb3cgdGhlIGVycm9yIHRvIGJlIGhhbmRsZWQgYnkgdGhlIGNhbGxlclxyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHNldCB1cCBjb252ZXJ0ZXJzOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICB9XHJcbn07XHJcblxyXG4vLyBDcmVhdGUgYW5kIGV4cG9ydCBzaW5nbGV0b24gaW5zdGFuY2VcclxudmFyIHJlZ2lzdHJ5ID0gbmV3IENvbnZlcnRlclJlZ2lzdHJ5KCk7XHJcbm1vZHVsZS5leHBvcnRzID0gcmVnaXN0cnk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLEVBQUUsR0FBR0MsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUM5QixNQUFNQyxJQUFJLEdB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