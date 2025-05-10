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

    // Create standardized adapter for media converters (audio and video)
    const mediaAdapter = {
      convert: async (content, name, apiKey, options) => {
        try {
          console.log(`[MediaAdapter] Converting media file: ${name}`);

          // Ensure content is a Buffer
          if (!Buffer.isBuffer(content)) {
            throw new Error('Media content must be a Buffer');
          }

          // Create a temporary file to process the media
          const tempDir = await fileStorageServiceInstance.createTempDir('media_conversion');
          const tempFile = path.join(tempDir, `${name}_${Date.now()}${path.extname(name) || '.mp4'}`);
          await fs.writeFile(tempFile, content);

          // Get deepgram API key from options or settings
          const deepgramApiKey = options.deepgramApiKey || '';

          // Process the media file using MediaConverter
          // Simulate an event object for the handler
          const mockEvent = {
            sender: {
              getOwnerBrowserWindow: () => null
            }
          };
          const result = await mediaConverterInstance.handleConvert(mockEvent, {
            filePath: tempFile,
            options: {
              ...options,
              transcribe: options.transcribe !== false,
              deepgramApiKey: deepgramApiKey,
              language: options.language || 'en',
              title: options.title || name,
              _tempDir: tempDir // Pass tempDir for cleanup
            }
          });

          // Media conversion is handled asynchronously, so we return a placeholder
          // The actual content will be available via the conversion progress events
          return {
            success: true,
            conversionId: result.conversionId,
            async: true,
            name: name,
            type: 'media'
          };
        } catch (error) {
          console.error(`[MediaAdapter] Error converting media: ${error.message}`);
          throw new Error(`Media conversion failed: ${error.message}`);
        }
      },
      validate: content => Buffer.isBuffer(content) && content.length > 0,
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJwYXRoIiwiaXBjTWFpbiIsIkNvbnZlcnRlclJlZ2lzdHJ5IiwiY29udmVydGVycyIsImFjdGl2ZUNvbnZlcnNpb25zIiwiTWFwIiwic2V0dXBDb252ZXJ0ZXJzIiwic2V0dXBDb252ZXJzaW9uVmFsaWRhdGlvbiIsInByb2Nlc3MiLCJvbiIsImNsZWFudXAiLCJleGl0IiwicHJvdG90eXBlIiwidmFsaWRhdGlvbkludGVydmFsIiwic2V0SW50ZXJ2YWwiLCJub3ciLCJEYXRlIiwic3RhbGVDb3VudCIsIkFycmF5IiwiZnJvbSIsImVudHJpZXMiLCJmb3JFYWNoIiwiaWQiLCJjb252IiwibGFzdFBpbmciLCJkZWxldGUiLCJjb25zb2xlIiwid2FybiIsIk1hdGgiLCJyb3VuZCIsImNsZWFudXBFcnJvciIsImVycm9yIiwibG9nIiwic2l6ZSIsInJlZ2lzdGVyQ29udmVyc2lvbiIsImNvbnZlcnNpb25EYXRhIiwic2V0IiwicGluZ0NvbnZlcnNpb24iLCJ1cGRhdGVzIiwiY29udmVyc2lvbiIsImdldCIsInJlbW92ZUNvbnZlcnNpb24iLCJnZXRDb252ZXJzaW9uIiwiY2xlYXJJbnRlcnZhbCIsImNvbnZlcnNpb25Db3VudCIsImNsZWFyIiwicmVnaXN0ZXIiLCJ0eXBlIiwiY29udmVydGVyIiwiZ2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJleHRlbnNpb24iLCJub3JtYWxpemVkRXh0IiwidG9Mb3dlckNhc2UiLCJyZXBsYWNlIiwiZ2V0Q29udmVydGVyQnlNaW1lVHlwZSIsIm1pbWVUeXBlIiwiT2JqZWN0IiwiY29uZmlnIiwibWltZVR5cGVzIiwiaW5jbHVkZXMiLCJjb252ZXJ0VG9NYXJrZG93biIsImNvbnRlbnQiLCJvcHRpb25zIiwiRXJyb3IiLCJjb252ZXJ0IiwibmFtZSIsImFwaUtleSIsIkNzdkNvbnZlcnRlciIsIlhsc3hDb252ZXJ0ZXIiLCJNZWRpYUNvbnZlcnRlciIsIlBkZkZhY3RvcnkiLCJEb2N4Q29udmVydGVyIiwiUHB0eENvbnZlcnRlciIsIlVybENvbnZlcnRlciIsIlBhcmVudFVybENvbnZlcnRlciIsImZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UiLCJmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZSIsImRlZXBncmFtU2VydmljZUluc3RhbmNlIiwiY3N2Q29udmVydGVySW5zdGFuY2UiLCJ4bHN4Q29udmVydGVySW5zdGFuY2UiLCJtZWRpYUNvbnZlcnRlckluc3RhbmNlIiwicGRmQ29udmVydGVyRmFjdG9yeSIsImRvY3hDb252ZXJ0ZXJJbnN0YW5jZSIsInBwdHhDb252ZXJ0ZXJJbnN0YW5jZSIsInVybENvbnZlcnRlckluc3RhbmNlIiwicGFyZW50VXJsQ29udmVydGVySW5zdGFuY2UiLCJCdWZmZXIiLCJpc0J1ZmZlciIsInJlc3VsdCIsImZpbGVOYW1lIiwidHJpbSIsInN1Y2Nlc3MiLCJtZXNzYWdlIiwidmFsaWRhdGUiLCJsZW5ndGgiLCJleHRlbnNpb25zIiwibWF4U2l6ZSIsImNvbnRlbnRTdHIiLCJ0b1N0cmluZyIsIm9yaWdpbmFsRmlsZU5hbWUiLCJ4bHN4Iiwid29ya2Jvb2siLCJvcyIsInRlbXBEaXIiLCJqb2luIiwidG1wZGlyIiwiZW5zdXJlRGlyIiwidGVtcEZpbGUiLCJ3cml0ZUZpbGUiLCJyZWFkRmlsZSIsImNlbGxEYXRlcyIsInhsc3hPcHRpb25zIiwicmVtb3ZlIiwicmVhZEVycm9yIiwibWVkaWFBZGFwdGVyIiwiY3JlYXRlVGVtcERpciIsImV4dG5hbWUiLCJkZWVwZ3JhbUFwaUtleSIsIm1vY2tFdmVudCIsInNlbmRlciIsImdldE93bmVyQnJvd3NlcldpbmRvdyIsImhhbmRsZUNvbnZlcnQiLCJmaWxlUGF0aCIsInRyYW5zY3JpYmUiLCJsYW5ndWFnZSIsInRpdGxlIiwiX3RlbXBEaXIiLCJjb252ZXJzaW9uSWQiLCJhc3luYyIsInBhdGhFeGlzdHMiLCJ1c2VPY3IiLCJtaXN0cmFsQXBpS2V5IiwiTWlzdHJhbFBkZkNvbnZlcnRlckNsYXNzIiwibWlzdHJhbENvbnZlcnRlciIsIlN0YW5kYXJkUGRmQ29udmVydGVyQ2xhc3MiLCJzdGFuZGFyZENvbnZlcnRlciIsInB1cHBldGVlciIsImJyb3dzZXIiLCJsYXVuY2giLCJoZWFkbGVzcyIsImFyZ3MiLCJtZXRhZGF0YSIsImZldGNoTWV0YWRhdGEiLCJleHRyYWN0ZWRDb250ZW50IiwiZXh0cmFjdENvbnRlbnQiLCJpbmNsdWRlSW1hZ2VzIiwicHJvY2Vzc0ltYWdlcyIsIm1hcmtkb3duIiwiZ2VuZXJhdGVNYXJrZG93biIsImNsb3NlIiwic2l0ZW1hcCIsImRpc2NvdmVyU2l0ZW1hcCIsIm1heFBhZ2VzIiwibWluIiwicGFnZXMiLCJwYWdlc1RvUHJvY2VzcyIsInNsaWNlIiwicHJvY2Vzc2VkUGFnZXMiLCJwYWdlIiwicGFnZUNvbnRlbnQiLCJwcm9jZXNzUGFnZSIsInVybCIsInB1c2giLCJnZW5lcmF0ZUNvbWJpbmVkTWFya2Rvd24iLCJyZWdpc3RlcmVkVHlwZXMiLCJrZXlzIiwic3RhY2siLCJyZWdpc3RyeSIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogQ29udmVydGVyUmVnaXN0cnkuanNcclxuICogXHJcbiAqIENlbnRyYWwgcmVnaXN0cnkgZm9yIGFsbCBmaWxlIHR5cGUgY29udmVydGVycyBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBQcm92aWRlcyBhIHVuaWZpZWQgaW50ZXJmYWNlIGZvciBhY2Nlc3NpbmcgY29udmVydGVycyBiYXNlZCBvbiBmaWxlIHR5cGUuXHJcbiAqIFxyXG4gKiBUaGlzIGZpbGUgd2FzIGNyZWF0ZWQgYXMgcGFydCBvZiB0aGUgY29uc29saWRhdGlvbiBwcm9jZXNzIHRvIGNlbnRyYWxpemVcclxuICogYWxsIGNvbnZlcnRlciBmdW5jdGlvbmFsaXR5IGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNyYy9lbGVjdHJvbi9jb252ZXJ0ZXJzL1VuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmpzOiBVc2VzIHRoaXMgcmVnaXN0cnkgZm9yIGNvbnZlcnNpb25zXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanM6IFJlZmVyZW5jZXMgdGhpcyByZWdpc3RyeVxyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL2RhdGEvKi5qczogRGF0YSBjb252ZXJ0ZXJzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vZG9jdW1lbnQvKi5qczogRG9jdW1lbnQgY29udmVydGVyc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL211bHRpbWVkaWEvKi5qczogTXVsdGltZWRpYSBjb252ZXJ0ZXJzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vd2ViLyouanM6IFdlYiBjb252ZXJ0ZXJzXHJcbiAqL1xyXG5cclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IGlwY01haW4gfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcblxyXG4vKipcclxuICogUmVnaXN0cnkgZm9yIGFsbCBmaWxlIHR5cGUgY29udmVydGVyc1xyXG4gKi9cclxuZnVuY3Rpb24gQ29udmVydGVyUmVnaXN0cnkoKSB7XHJcbiAgICB0aGlzLmNvbnZlcnRlcnMgPSB7fTtcclxuICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMgPSBuZXcgTWFwKCk7IC8vIEdsb2JhbCBtYXAgdG8gdHJhY2sgYWxsIGFjdGl2ZSBjb252ZXJzaW9uc1xyXG4gICAgdGhpcy5zZXR1cENvbnZlcnRlcnMoKTtcclxuICAgIHRoaXMuc2V0dXBDb252ZXJzaW9uVmFsaWRhdGlvbigpO1xyXG4gICAgXHJcbiAgICAvLyBDbGVhbiB1cCByZXNvdXJjZXMgd2hlbiB0aGUgcHJvY2VzcyBleGl0c1xyXG4gICAgcHJvY2Vzcy5vbignZXhpdCcsICgpID0+IHRoaXMuY2xlYW51cCgpKTtcclxuICAgIHByb2Nlc3Mub24oJ1NJR0lOVCcsICgpID0+IHtcclxuICAgICAgICB0aGlzLmNsZWFudXAoKTtcclxuICAgICAgICBwcm9jZXNzLmV4aXQoMCk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFNldHMgdXAgcGVyaW9kaWMgdmFsaWRhdGlvbiBvZiBhY3RpdmUgY29udmVyc2lvbnMgdG8gY2xlYW4gdXAgc3RhbGUgb25lcy5cclxuICogVGhpcyBoZWxwcyBwcmV2ZW50IG1lbW9yeSBsZWFrcyBhbmQgcmVzb3VyY2UgaXNzdWVzIGJ5IHJlbW92aW5nIGNvbnZlcnNpb25zXHJcbiAqIHRoYXQgaGF2ZW4ndCBiZWVuIHVwZGF0ZWQgcmVjZW50bHkuXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuc2V0dXBDb252ZXJzaW9uVmFsaWRhdGlvbiA9IGZ1bmN0aW9uKCkge1xyXG4gICAgLy8gU2V0IHVwIGludGVydmFsIHRvIGNoZWNrIGZvciBzdGFsZSBjb252ZXJzaW9ucyBldmVyeSBtaW51dGVcclxuICAgIHRoaXMudmFsaWRhdGlvbkludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XHJcbiAgICAgICAgICAgIGxldCBzdGFsZUNvdW50ID0gMDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENoZWNrIGFsbCBhY3RpdmUgY29udmVyc2lvbnNcclxuICAgICAgICAgICAgQXJyYXkuZnJvbSh0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmVudHJpZXMoKSkuZm9yRWFjaCgoW2lkLCBjb252XSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgLy8gQ29uc2lkZXIgYSBjb252ZXJzaW9uIHN0YWxlIGlmIGl0IGhhc24ndCBwaW5nZWQgaW4gdGhlIGxhc3QgMzAgc2Vjb25kc1xyXG4gICAgICAgICAgICAgICAgaWYgKG5vdyAtIGNvbnYubGFzdFBpbmcgPiAzMDAwMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJlbW92ZSB0aGUgc3RhbGUgY29udmVyc2lvblxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZGVsZXRlKGlkKTtcclxuICAgICAgICAgICAgICAgICAgICBzdGFsZUNvdW50Kys7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gTG9nIHRoZSByZW1vdmFsXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGBbQ29udmVydGVyUmVnaXN0cnldIFN0YWxlIGNvbnZlcnNpb24gJHtpZH0gcmVtb3ZlZCAoaW5hY3RpdmUgZm9yICR7TWF0aC5yb3VuZCgobm93IC0gY29udi5sYXN0UGluZykgLyAxMDAwKX1zKWApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIElmIHRoZSBjb252ZXJzaW9uIGhhcyBhIGNsZWFudXAgZnVuY3Rpb24sIGNhbGwgaXRcclxuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGNvbnYuY2xlYW51cCA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udi5jbGVhbnVwKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0NvbnZlcnRlclJlZ2lzdHJ5XSBFcnJvciBjbGVhbmluZyB1cCBjb252ZXJzaW9uICR7aWR9OmAsIGNsZWFudXBFcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gTG9nIHN1bW1hcnkgaWYgYW55IHN0YWxlIGNvbnZlcnNpb25zIHdlcmUgcmVtb3ZlZFxyXG4gICAgICAgICAgICBpZiAoc3RhbGVDb3VudCA+IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQ29udmVydGVyUmVnaXN0cnldIFJlbW92ZWQgJHtzdGFsZUNvdW50fSBzdGFsZSBjb252ZXJzaW9ucy4gQWN0aXZlIGNvbnZlcnNpb25zIHJlbWFpbmluZzogJHt0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNpemV9YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbQ29udmVydGVyUmVnaXN0cnldIEVycm9yIGR1cmluZyBjb252ZXJzaW9uIHZhbGlkYXRpb246JywgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgIH0sIDYwMDAwKTsgLy8gUnVuIGV2ZXJ5IDYwIHNlY29uZHNcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZWdpc3RlcnMgYW4gYWN0aXZlIGNvbnZlcnNpb24gd2l0aCB0aGUgcmVnaXN0cnkuXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBpZCAtIFVuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgY29udmVyc2lvblxyXG4gKiBAcGFyYW0ge09iamVjdH0gY29udmVyc2lvbkRhdGEgLSBEYXRhIGFib3V0IHRoZSBjb252ZXJzaW9uXHJcbiAqIEBwYXJhbSB7RnVuY3Rpb259IFtjbGVhbnVwXSAtIE9wdGlvbmFsIGNsZWFudXAgZnVuY3Rpb24gdG8gY2FsbCB3aGVuIHRoZSBjb252ZXJzaW9uIGlzIHJlbW92ZWRcclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5yZWdpc3RlckNvbnZlcnNpb24gPSBmdW5jdGlvbihpZCwgY29udmVyc2lvbkRhdGEsIGNsZWFudXApIHtcclxuICAgIGlmICghaWQpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdbQ29udmVydGVyUmVnaXN0cnldIENhbm5vdCByZWdpc3RlciBjb252ZXJzaW9uIHdpdGhvdXQgSUQnKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2V0KGlkLCB7XHJcbiAgICAgICAgLi4uY29udmVyc2lvbkRhdGEsXHJcbiAgICAgICAgbGFzdFBpbmc6IERhdGUubm93KCksXHJcbiAgICAgICAgY2xlYW51cDogY2xlYW51cFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKGBbQ29udmVydGVyUmVnaXN0cnldIFJlZ2lzdGVyZWQgY29udmVyc2lvbiAke2lkfS4gVG90YWwgYWN0aXZlOiAke3RoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2l6ZX1gKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBVcGRhdGVzIHRoZSBsYXN0IHBpbmcgdGltZSBmb3IgYW4gYWN0aXZlIGNvbnZlcnNpb24gdG8ga2VlcCBpdCBhbGl2ZS5cclxuICogQHBhcmFtIHtzdHJpbmd9IGlkIC0gVW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBjb252ZXJzaW9uXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBbdXBkYXRlc10gLSBPcHRpb25hbCB1cGRhdGVzIHRvIHRoZSBjb252ZXJzaW9uIGRhdGFcclxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY29udmVyc2lvbiB3YXMgZm91bmQgYW5kIHVwZGF0ZWRcclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5waW5nQ29udmVyc2lvbiA9IGZ1bmN0aW9uKGlkLCB1cGRhdGVzID0ge30pIHtcclxuICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChpZCk7XHJcbiAgICBpZiAoIWNvbnZlcnNpb24pIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFVwZGF0ZSB0aGUgbGFzdCBwaW5nIHRpbWUgYW5kIGFueSBvdGhlciBwcm92aWRlZCB1cGRhdGVzXHJcbiAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNldChpZCwge1xyXG4gICAgICAgIC4uLmNvbnZlcnNpb24sXHJcbiAgICAgICAgLi4udXBkYXRlcyxcclxuICAgICAgICBsYXN0UGluZzogRGF0ZS5ub3coKVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIHJldHVybiB0cnVlO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlbW92ZXMgYW4gYWN0aXZlIGNvbnZlcnNpb24gZnJvbSB0aGUgcmVnaXN0cnkuXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBpZCAtIFVuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgY29udmVyc2lvblxyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjb252ZXJzaW9uIHdhcyBmb3VuZCBhbmQgcmVtb3ZlZFxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLnJlbW92ZUNvbnZlcnNpb24gPSBmdW5jdGlvbihpZCkge1xyXG4gICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGlkKTtcclxuICAgIGlmICghY29udmVyc2lvbikge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gSWYgdGhlIGNvbnZlcnNpb24gaGFzIGEgY2xlYW51cCBmdW5jdGlvbiwgY2FsbCBpdFxyXG4gICAgaWYgKHR5cGVvZiBjb252ZXJzaW9uLmNsZWFudXAgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uLmNsZWFudXAoKTtcclxuICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0NvbnZlcnRlclJlZ2lzdHJ5XSBFcnJvciBjbGVhbmluZyB1cCBjb252ZXJzaW9uICR7aWR9OmAsIGNsZWFudXBFcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBSZW1vdmUgdGhlIGNvbnZlcnNpb25cclxuICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZGVsZXRlKGlkKTtcclxuICAgIGNvbnNvbGUubG9nKGBbQ29udmVydGVyUmVnaXN0cnldIFJlbW92ZWQgY29udmVyc2lvbiAke2lkfS4gVG90YWwgYWN0aXZlOiAke3RoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2l6ZX1gKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHRydWU7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0cyBhbiBhY3RpdmUgY29udmVyc2lvbiBmcm9tIHRoZSByZWdpc3RyeS5cclxuICogQHBhcmFtIHtzdHJpbmd9IGlkIC0gVW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBjb252ZXJzaW9uXHJcbiAqIEByZXR1cm5zIHtPYmplY3R8bnVsbH0gLSBUaGUgY29udmVyc2lvbiBkYXRhIG9yIG51bGwgaWYgbm90IGZvdW5kXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuZ2V0Q29udmVyc2lvbiA9IGZ1bmN0aW9uKGlkKSB7XHJcbiAgICByZXR1cm4gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoaWQpIHx8IG51bGw7XHJcbn07XHJcblxyXG4vKipcclxuICogQ2xlYW5zIHVwIHJlc291cmNlcyB1c2VkIGJ5IHRoZSByZWdpc3RyeS5cclxuICogVGhpcyBzaG91bGQgYmUgY2FsbGVkIHdoZW4gdGhlIGFwcGxpY2F0aW9uIGlzIHNodXR0aW5nIGRvd24uXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuY2xlYW51cCA9IGZ1bmN0aW9uKCkge1xyXG4gICAgLy8gQ2xlYXIgdGhlIHZhbGlkYXRpb24gaW50ZXJ2YWxcclxuICAgIGlmICh0aGlzLnZhbGlkYXRpb25JbnRlcnZhbCkge1xyXG4gICAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy52YWxpZGF0aW9uSW50ZXJ2YWwpO1xyXG4gICAgICAgIHRoaXMudmFsaWRhdGlvbkludGVydmFsID0gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gQ2xlYW4gdXAgYWxsIGFjdGl2ZSBjb252ZXJzaW9uc1xyXG4gICAgY29uc3QgY29udmVyc2lvbkNvdW50ID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zaXplO1xyXG4gICAgaWYgKGNvbnZlcnNpb25Db3VudCA+IDApIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW0NvbnZlcnRlclJlZ2lzdHJ5XSBDbGVhbmluZyB1cCAke2NvbnZlcnNpb25Db3VudH0gYWN0aXZlIGNvbnZlcnNpb25zYCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgQXJyYXkuZnJvbSh0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmVudHJpZXMoKSkuZm9yRWFjaCgoW2lkLCBjb252XSkgPT4ge1xyXG4gICAgICAgICAgICAvLyBJZiB0aGUgY29udmVyc2lvbiBoYXMgYSBjbGVhbnVwIGZ1bmN0aW9uLCBjYWxsIGl0XHJcbiAgICAgICAgICAgIGlmICh0eXBlb2YgY29udi5jbGVhbnVwID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnYuY2xlYW51cCgpO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0NvbnZlcnRlclJlZ2lzdHJ5XSBFcnJvciBjbGVhbmluZyB1cCBjb252ZXJzaW9uICR7aWR9OmAsIGNsZWFudXBFcnJvcik7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDbGVhciB0aGUgbWFwXHJcbiAgICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5jbGVhcigpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZygnW0NvbnZlcnRlclJlZ2lzdHJ5XSBDbGVhbnVwIGNvbXBsZXRlJyk7XHJcbn07XHJcblxyXG4vKipcclxuICogUmVnaXN0ZXIgYSBjb252ZXJ0ZXIgZm9yIGEgc3BlY2lmaWMgZmlsZSB0eXBlXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIC0gRmlsZSB0eXBlIChleHRlbnNpb24gd2l0aG91dCBkb3QpXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBjb252ZXJ0ZXIgLSBDb252ZXJ0ZXIgaW1wbGVtZW50YXRpb25cclxuICovXHJcbkNvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5yZWdpc3RlciA9IGZ1bmN0aW9uKHR5cGUsIGNvbnZlcnRlcikge1xyXG4gICAgdGhpcy5jb252ZXJ0ZXJzW3R5cGVdID0gY29udmVydGVyO1xyXG4gICAgY29uc29sZS5sb2coYFJlZ2lzdGVyZWQgY29udmVydGVyIGZvciAke3R5cGV9YCk7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0IGNvbnZlcnRlciBieSBmaWxlIGV4dGVuc2lvblxyXG4gKiBAcGFyYW0ge3N0cmluZ30gZXh0ZW5zaW9uIC0gRmlsZSBleHRlbnNpb24gKHdpdGggb3Igd2l0aG91dCBkb3QpXHJcbiAqIEByZXR1cm5zIHtPYmplY3R8bnVsbH0gQ29udmVydGVyIG9yIG51bGwgaWYgbm90IGZvdW5kXHJcbiAqL1xyXG5Db252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuZ2V0Q29udmVydGVyQnlFeHRlbnNpb24gPSBmdW5jdGlvbihleHRlbnNpb24pIHtcclxuICAgIC8vIE5vcm1hbGl6ZSBleHRlbnNpb24gKHJlbW92ZSBkb3QsIGxvd2VyY2FzZSlcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRFeHQgPSBleHRlbnNpb24udG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9eXFwuLywgJycpO1xyXG4gICAgcmV0dXJuIHRoaXMuY29udmVydGVyc1tub3JtYWxpemVkRXh0XSB8fCBudWxsO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEdldCBjb252ZXJ0ZXIgYnkgTUlNRSB0eXBlXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBtaW1lVHlwZSAtIE1JTUUgdHlwZVxyXG4gKiBAcmV0dXJucyB7T2JqZWN0fG51bGx9IENvbnZlcnRlciBvciBudWxsIGlmIG5vdCBmb3VuZFxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLmdldENvbnZlcnRlckJ5TWltZVR5cGUgPSBmdW5jdGlvbihtaW1lVHlwZSkge1xyXG4gICAgLy8gRmluZCBjb252ZXJ0ZXIgdGhhdCBzdXBwb3J0cyB0aGlzIE1JTUUgdHlwZVxyXG4gICAgZm9yIChjb25zdCBbdHlwZSwgY29udmVydGVyXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNvbnZlcnRlcnMpKSB7XHJcbiAgICAgICAgaWYgKGNvbnZlcnRlci5jb25maWcgJiYgXHJcbiAgICAgICAgICAgIGNvbnZlcnRlci5jb25maWcubWltZVR5cGVzICYmIFxyXG4gICAgICAgICAgICBjb252ZXJ0ZXIuY29uZmlnLm1pbWVUeXBlcy5pbmNsdWRlcyhtaW1lVHlwZSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGNvbnZlcnRlcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBDb252ZXJ0IGNvbnRlbnQgdG8gbWFya2Rvd24gdXNpbmcgYXBwcm9wcmlhdGUgY29udmVydGVyXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIC0gRmlsZSB0eXBlXHJcbiAqIEBwYXJhbSB7QnVmZmVyfHN0cmluZ30gY29udGVudCAtIENvbnRlbnQgdG8gY29udmVydFxyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBDb252ZXJzaW9uIHJlc3VsdFxyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLmNvbnZlcnRUb01hcmtkb3duID0gYXN5bmMgZnVuY3Rpb24odHlwZSwgY29udGVudCwgb3B0aW9ucykge1xyXG4gICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XHJcbiAgICBjb25zdCBjb252ZXJ0ZXIgPSB0aGlzLmdldENvbnZlcnRlckJ5RXh0ZW5zaW9uKHR5cGUpO1xyXG4gICAgaWYgKCFjb252ZXJ0ZXIpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbnZlcnRlciBmb3VuZCBmb3IgdHlwZTogJHt0eXBlfWApO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gYXdhaXQgY29udmVydGVyLmNvbnZlcnQoY29udGVudCwgb3B0aW9ucy5uYW1lIHx8ICdmaWxlJywgb3B0aW9ucy5hcGlLZXksIG9wdGlvbnMpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFNldHVwIGFsbCBhdmFpbGFibGUgY29udmVydGVyc1xyXG4gKi9cclxuQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLnNldHVwQ29udmVydGVycyA9IGZ1bmN0aW9uKCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICAvLyBJbXBvcnQgY29udmVydGVycyBmcm9tIHRoZSBuZXcgbG9jYXRpb25cclxuICAgICAgICBjb25zdCBDc3ZDb252ZXJ0ZXIgPSByZXF1aXJlKCcuL2RhdGEvQ3N2Q29udmVydGVyJyk7XHJcbiAgICAgICAgY29uc3QgWGxzeENvbnZlcnRlciA9IHJlcXVpcmUoJy4vZGF0YS9YbHN4Q29udmVydGVyJyk7XHJcbiAgICAgICAgY29uc3QgTWVkaWFDb252ZXJ0ZXIgPSByZXF1aXJlKCcuL211bHRpbWVkaWEvTWVkaWFDb252ZXJ0ZXInKTtcclxuICAgICAgICBjb25zdCBQZGZGYWN0b3J5ID0gcmVxdWlyZSgnLi9kb2N1bWVudC9QZGZDb252ZXJ0ZXJGYWN0b3J5Jyk7XHJcbiAgICAgICAgY29uc3QgRG9jeENvbnZlcnRlciA9IHJlcXVpcmUoJy4vZG9jdW1lbnQvRG9jeENvbnZlcnRlcicpO1xyXG4gICAgICAgIGNvbnN0IFBwdHhDb252ZXJ0ZXIgPSByZXF1aXJlKCcuL2RvY3VtZW50L1BwdHhDb252ZXJ0ZXInKTtcclxuICAgICAgICBjb25zdCBVcmxDb252ZXJ0ZXIgPSByZXF1aXJlKCcuL3dlYi9VcmxDb252ZXJ0ZXInKTtcclxuICAgICAgICBjb25zdCBQYXJlbnRVcmxDb252ZXJ0ZXIgPSByZXF1aXJlKCcuL3dlYi9QYXJlbnRVcmxDb252ZXJ0ZXInKTtcclxuXHJcbiAgICAgICAgLy8gSW1wb3J0IHNpbmdsZXRvbiBzZXJ2aWNlIGluc3RhbmNlc1xyXG4gICAgICAgIGNvbnN0IGZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UgPSByZXF1aXJlKCcuLi9zdG9yYWdlL0ZpbGVQcm9jZXNzb3JTZXJ2aWNlJyk7XHJcbiAgICAgICAgY29uc3QgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UgPSByZXF1aXJlKCcuLi9zdG9yYWdlL0ZpbGVTdG9yYWdlU2VydmljZScpO1xyXG4gICAgICAgIGNvbnN0IGRlZXBncmFtU2VydmljZUluc3RhbmNlID0gcmVxdWlyZSgnLi4vYWkvRGVlcGdyYW1TZXJ2aWNlJyk7XHJcblxyXG4gICAgICAgIC8vIENyZWF0ZSBpbnN0YW5jZXMgb2YgY29udmVydGVyIGNsYXNzZXMsIHBhc3Npbmcgc2luZ2xldG9uIGRlcGVuZGVuY2llc1xyXG4gICAgICAgIGNvbnN0IGNzdkNvbnZlcnRlckluc3RhbmNlID0gbmV3IENzdkNvbnZlcnRlcigpO1xyXG4gICAgICAgIGNvbnN0IHhsc3hDb252ZXJ0ZXJJbnN0YW5jZSA9IG5ldyBYbHN4Q29udmVydGVyKCk7XHJcbiAgICAgICAgLy8gUGFzcyB0aGUgc2luZ2xldG9uIGluc3RhbmNlcyB0byB0aGUgY29uc3RydWN0b3JzXHJcbiAgICAgICAgY29uc3QgbWVkaWFDb252ZXJ0ZXJJbnN0YW5jZSA9IG5ldyBNZWRpYUNvbnZlcnRlcih0aGlzLCBmaWxlUHJvY2Vzc29yU2VydmljZUluc3RhbmNlLCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZSk7XHJcbiAgICAgICAgY29uc3QgcGRmQ29udmVydGVyRmFjdG9yeSA9IG5ldyBQZGZGYWN0b3J5KCk7XHJcbiAgICAgICAgY29uc3QgZG9jeENvbnZlcnRlckluc3RhbmNlID0gbmV3IERvY3hDb252ZXJ0ZXIoKTtcclxuICAgICAgICBjb25zdCBwcHR4Q29udmVydGVySW5zdGFuY2UgPSBuZXcgUHB0eENvbnZlcnRlcigpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEluc3RhbnRpYXRlIFVSTCBjb252ZXJ0ZXJzIHdpdGggc2luZ2xldG9uIGRlcGVuZGVuY2llcyAob3IgbW9ja3MgaWYgYXBwcm9wcmlhdGUpXHJcbiAgICAgICAgLy8gTm90ZTogVVJMIGNvbnZlcnRlcnMgbWlnaHQgbm90IG5lZWQgdGhlIGZ1bGwgZmlsZSBzZXJ2aWNlcywgdXNpbmcgbW9ja3MgbWlnaHQgc3RpbGwgYmUgb2theSBoZXJlXHJcbiAgICAgICAgLy8gVXNpbmcgc2luZ2xldG9ucyBmb3IgY29uc2lzdGVuY3ksIGJ1dCBjb3VsZCByZXZlcnQgdG8gbW9ja3MgaWYgbmVlZGVkLlxyXG4gICAgICAgIGNvbnN0IHVybENvbnZlcnRlckluc3RhbmNlID0gbmV3IFVybENvbnZlcnRlcihmaWxlUHJvY2Vzc29yU2VydmljZUluc3RhbmNlLCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZSk7XHJcbiAgICAgICAgY29uc3QgcGFyZW50VXJsQ29udmVydGVySW5zdGFuY2UgPSBuZXcgUGFyZW50VXJsQ29udmVydGVyKGZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UsIGZpbGVTdG9yYWdlU2VydmljZUluc3RhbmNlKTtcclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBhZGFwdGVyIGZvciBET0NYIGNvbnZlcnRlciB1c2luZyB0aGUgYWN0dWFsIGltcGxlbWVudGF0aW9uXHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcignZG9jeCcsIHtcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0RvY3hBZGFwdGVyXSBDb252ZXJ0aW5nIERPQ1ggZmlsZTogJHtuYW1lfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBjb250ZW50IGlzIGEgQnVmZmVyXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoY29udGVudCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdET0NYIGNvbnRlbnQgbXVzdCBiZSBhIEJ1ZmZlcicpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgdGhlIGFjdHVhbCBEb2N4Q29udmVydGVyIGltcGxlbWVudGF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jeENvbnZlcnRlckluc3RhbmNlLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZU5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwaUtleVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSB3ZSBoYXZlIGNvbnRlbnRcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXJlc3VsdCB8fCB0eXBlb2YgcmVzdWx0ICE9PSAnc3RyaW5nJyB8fCByZXN1bHQudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0RPQ1ggY29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHJlc3VsdCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2RvY3gnXHJcbiAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0RvY3hBZGFwdGVyXSBFcnJvciBjb252ZXJ0aW5nIERPQ1g6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYERPQ1ggY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdmFsaWRhdGU6IChjb250ZW50KSA9PiBCdWZmZXIuaXNCdWZmZXIoY29udGVudCkgJiYgY29udGVudC5sZW5ndGggPiAwLFxyXG4gICAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdET0NYIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy5kb2N4JywgJy5kb2MnXSxcclxuICAgICAgICAgICAgICAgIG1pbWVUeXBlczogWydhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQud29yZHByb2Nlc3NpbmdtbC5kb2N1bWVudCcsICdhcHBsaWNhdGlvbi9tc3dvcmQnXSxcclxuICAgICAgICAgICAgICAgIG1heFNpemU6IDEwMCAqIDEwMjQgKiAxMDI0IC8vIDEwME1CXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIFBQVFggY29udmVydGVyIHVzaW5nIHRoZSBhY3R1YWwgaW1wbGVtZW50YXRpb25cclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdwcHR4Jywge1xyXG4gICAgICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbUHB0eEFkYXB0ZXJdIENvbnZlcnRpbmcgUFBUWCBmaWxlOiAke25hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIGNvbnRlbnQgaXMgYSBCdWZmZXJcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihjb250ZW50KSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1BQVFggY29udGVudCBtdXN0IGJlIGEgQnVmZmVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSB0aGUgYWN0dWFsIFBwdHhDb252ZXJ0ZXIgaW1wbGVtZW50YXRpb25cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwcHR4Q29udmVydGVySW5zdGFuY2UuY29udmVydFRvTWFya2Rvd24oY29udGVudCwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxlTmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXBpS2V5XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHdlIGhhdmUgY29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcmVzdWx0IHx8IHR5cGVvZiByZXN1bHQgIT09ICdzdHJpbmcnIHx8IHJlc3VsdC50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUFBUWCBjb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQnKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogcmVzdWx0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncHB0eCdcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbUHB0eEFkYXB0ZXJdIEVycm9yIGNvbnZlcnRpbmcgUFBUWDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUFBUWCBjb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB2YWxpZGF0ZTogKGNvbnRlbnQpID0+IEJ1ZmZlci5pc0J1ZmZlcihjb250ZW50KSAmJiBjb250ZW50Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ1BQVFggQ29udmVydGVyJyxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnBwdHgnLCAnLnBwdCddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5wcmVzZW50YXRpb25tbC5wcmVzZW50YXRpb24nLCAnYXBwbGljYXRpb24vdm5kLm1zLXBvd2VycG9pbnQnXSxcclxuICAgICAgICAgICAgICAgIG1heFNpemU6IDEwMCAqIDEwMjQgKiAxMDI0IC8vIDEwME1CXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIHRoZSBDU1YgY29udmVydGVyXHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcignY3N2Jywge1xyXG4gICAgICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQ3N2QWRhcHRlcl0gQ29udmVydGluZyBDU1YgZmlsZTogJHtuYW1lfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENvbnZlcnQgdGhlIGNvbnRlbnQgdG8gc3RyaW5nXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29udGVudFN0ciA9IGNvbnRlbnQudG9TdHJpbmcoKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgdGhlIGFjdHVhbCBDc3ZDb252ZXJ0ZXIgaW1wbGVtZW50YXRpb25cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjc3ZDb252ZXJ0ZXJJbnN0YW5jZS5jb252ZXJ0VG9NYXJrZG93bihjb250ZW50U3RyLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG5hbWUgLy8gUGFzcyB0aGUgb3JpZ2luYWwgZmlsZW5hbWVcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgd2UgaGF2ZSBjb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQgfHwgdHlwZW9mIHJlc3VsdCAhPT0gJ3N0cmluZycgfHwgcmVzdWx0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDU1YgY29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50Jyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHJlc3VsdCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2NzdidcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbQ3N2QWRhcHRlcl0gRXJyb3IgY29udmVydGluZyBDU1Y6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENTViBjb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB2YWxpZGF0ZTogKGNvbnRlbnQpID0+IEJ1ZmZlci5pc0J1ZmZlcihjb250ZW50KSAmJiBjb250ZW50Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICAgICAgbmFtZTogJ0NTViBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICAgICAgZXh0ZW5zaW9uczogWycuY3N2J10sXHJcbiAgICAgICAgICAgICAgICBtaW1lVHlwZXM6IFsndGV4dC9jc3YnXSxcclxuICAgICAgICAgICAgICAgIG1heFNpemU6IDEwMCAqIDEwMjQgKiAxMDI0IC8vIDEwME1CXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBhZGFwdGVyIGZvciB0aGUgWExTWCBjb252ZXJ0ZXJcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCd4bHN4Jywge1xyXG4gICAgICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbWGxzeEFkYXB0ZXJdIENvbnZlcnRpbmcgRXhjZWwgZmlsZTogJHtuYW1lfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBjb250ZW50IGlzIGEgQnVmZmVyXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoY29udGVudCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeGNlbCBjb250ZW50IG11c3QgYmUgYSBCdWZmZXInKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gUmVhZCB0aGUgRXhjZWwgZmlsZSB1c2luZyB4bHN4IGxpYnJhcnlcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB4bHN4ID0gcmVxdWlyZSgneGxzeCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIGxldCB3b3JrYm9vaztcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgYSB0ZW1wb3JhcnkgZmlsZSB0byByZWFkIHRoZSBFeGNlbCBjb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3MgPSByZXF1aXJlKCdvcycpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gcGF0aC5qb2luKG9zLnRtcGRpcigpLCBgeGxzeF9jb252ZXJzaW9uXyR7RGF0ZS5ub3coKX1gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMuZW5zdXJlRGlyKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcEZpbGUgPSBwYXRoLmpvaW4odGVtcERpciwgYCR7bmFtZX1fJHtEYXRlLm5vdygpfS54bHN4YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZSh0ZW1wRmlsZSwgY29udGVudCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBSZWFkIHRoZSBFeGNlbCBmaWxlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdvcmtib29rID0geGxzeC5yZWFkRmlsZSh0ZW1wRmlsZSwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2VsbERhdGVzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4uKG9wdGlvbnMueGxzeE9wdGlvbnMgfHwge30pXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBmaWxlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChyZWFkRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1hsc3hBZGFwdGVyXSBGYWlsZWQgdG8gcmVhZCBFeGNlbCBmaWxlOiAke25hbWV9YCwgcmVhZEVycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcmVhZCBFeGNlbCBmaWxlOiAke3JlYWRFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgdGhlIGFjdHVhbCBYbHN4Q29udmVydGVyIGltcGxlbWVudGF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgeGxzeENvbnZlcnRlckluc3RhbmNlLmNvbnZlcnRUb01hcmtkb3duKHdvcmtib29rLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG5hbWUgLy8gUGFzcyB0aGUgb3JpZ2luYWwgZmlsZW5hbWVcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgd2UgaGF2ZSBjb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXN1bHQgfHwgdHlwZW9mIHJlc3VsdCAhPT0gJ3N0cmluZycgfHwgcmVzdWx0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeGNlbCBjb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQnKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogcmVzdWx0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAneGxzeCdcclxuICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeEFkYXB0ZXJdIEVycm9yIGNvbnZlcnRpbmcgRXhjZWw6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4Y2VsIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpICYmIGNvbnRlbnQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnRXhjZWwgQ29udmVydGVyJyxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnhsc3gnLCAnLnhscyddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JywgJ2FwcGxpY2F0aW9uL3ZuZC5tcy1leGNlbCddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAwICogMTAyNCAqIDEwMjQgLy8gMTAwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIG1lZGlhIGNvbnZlcnRlcnMgKGF1ZGlvIGFuZCB2aWRlbylcclxuICAgICAgICBjb25zdCBtZWRpYUFkYXB0ZXIgPSB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtNZWRpYUFkYXB0ZXJdIENvbnZlcnRpbmcgbWVkaWEgZmlsZTogJHtuYW1lfWApO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgY29udGVudCBpcyBhIEJ1ZmZlclxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTWVkaWEgY29udGVudCBtdXN0IGJlIGEgQnVmZmVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgYSB0ZW1wb3JhcnkgZmlsZSB0byBwcm9jZXNzIHRoZSBtZWRpYVxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZS5jcmVhdGVUZW1wRGlyKCdtZWRpYV9jb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcEZpbGUgPSBwYXRoLmpvaW4odGVtcERpciwgYCR7bmFtZX1fJHtEYXRlLm5vdygpfSR7cGF0aC5leHRuYW1lKG5hbWUpIHx8ICcubXA0J31gKTtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUodGVtcEZpbGUsIGNvbnRlbnQpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBHZXQgZGVlcGdyYW0gQVBJIGtleSBmcm9tIG9wdGlvbnMgb3Igc2V0dGluZ3NcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBkZWVwZ3JhbUFwaUtleSA9IG9wdGlvbnMuZGVlcGdyYW1BcGlLZXkgfHwgJyc7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIC8vIFByb2Nlc3MgdGhlIG1lZGlhIGZpbGUgdXNpbmcgTWVkaWFDb252ZXJ0ZXJcclxuICAgICAgICAgICAgICAgICAgICAvLyBTaW11bGF0ZSBhbiBldmVudCBvYmplY3QgZm9yIHRoZSBoYW5kbGVyXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbW9ja0V2ZW50ID0geyBzZW5kZXI6IHsgZ2V0T3duZXJCcm93c2VyV2luZG93OiAoKSA9PiBudWxsIH0gfTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgbWVkaWFDb252ZXJ0ZXJJbnN0YW5jZS5oYW5kbGVDb252ZXJ0KG1vY2tFdmVudCwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aDogdGVtcEZpbGUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2NyaWJlOiBvcHRpb25zLnRyYW5zY3JpYmUgIT09IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVlcGdyYW1BcGlLZXk6IGRlZXBncmFtQXBpS2V5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFuZ3VhZ2U6IG9wdGlvbnMubGFuZ3VhZ2UgfHwgJ2VuJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlOiBvcHRpb25zLnRpdGxlIHx8IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBfdGVtcERpcjogdGVtcERpciAvLyBQYXNzIHRlbXBEaXIgZm9yIGNsZWFudXBcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBNZWRpYSBjb252ZXJzaW9uIGlzIGhhbmRsZWQgYXN5bmNocm9ub3VzbHksIHNvIHdlIHJldHVybiBhIHBsYWNlaG9sZGVyXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVGhlIGFjdHVhbCBjb250ZW50IHdpbGwgYmUgYXZhaWxhYmxlIHZpYSB0aGUgY29udmVyc2lvbiBwcm9ncmVzcyBldmVudHNcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb252ZXJzaW9uSWQ6IHJlc3VsdC5jb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFzeW5jOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnbWVkaWEnXHJcbiAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW01lZGlhQWRhcHRlcl0gRXJyb3IgY29udmVydGluZyBtZWRpYTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWVkaWEgY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdmFsaWRhdGU6IChjb250ZW50KSA9PiBCdWZmZXIuaXNCdWZmZXIoY29udGVudCkgJiYgY29udGVudC5sZW5ndGggPiAwLFxyXG4gICAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdNZWRpYSBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICAgICAgZXh0ZW5zaW9uczogWycubXAzJywgJy53YXYnLCAnLm9nZycsICcubTRhJywgJy5mbGFjJywgJy5tcDQnLCAnLm1vdicsICcuYXZpJywgJy5ta3YnLCAnLndlYm0nXSxcclxuICAgICAgICAgICAgICAgIG1pbWVUeXBlczogW1xyXG4gICAgICAgICAgICAgICAgICAgICdhdWRpby9tcGVnJywgJ2F1ZGlvL21wMycsICdhdWRpby93YXYnLCAnYXVkaW8vb2dnJywgJ2F1ZGlvL200YScsICdhdWRpby9mbGFjJyxcclxuICAgICAgICAgICAgICAgICAgICAndmlkZW8vbXA0JywgJ3ZpZGVvL3dlYm0nLCAndmlkZW8vcXVpY2t0aW1lJywgJ3ZpZGVvL3gtbXN2aWRlbycsICd2aWRlby94LW1hdHJvc2thJ1xyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIG1heFNpemU6IDUwMCAqIDEwMjQgKiAxMDI0IC8vIDUwME1CXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICAvLyBSZWdpc3RlciBhbGwgbWVkaWEgZm9ybWF0cyB0byB1c2UgdGhlIHNhbWUgY29udmVydGVyXHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcignbXAzJywgbWVkaWFBZGFwdGVyKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCd3YXYnLCBtZWRpYUFkYXB0ZXIpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ29nZycsIG1lZGlhQWRhcHRlcik7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcignbTRhJywgbWVkaWFBZGFwdGVyKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdmbGFjJywgbWVkaWFBZGFwdGVyKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdtcDQnLCBtZWRpYUFkYXB0ZXIpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ21vdicsIG1lZGlhQWRhcHRlcik7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlcignYXZpJywgbWVkaWFBZGFwdGVyKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdta3YnLCBtZWRpYUFkYXB0ZXIpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3dlYm0nLCBtZWRpYUFkYXB0ZXIpO1xyXG5cclxuICAgICAgICAvLyBSZWdpc3RlciBwcHQgZXh0ZW5zaW9uIHRvIHVzZSB0aGUgc2FtZSBjb252ZXJ0ZXIgYXMgcHB0eFxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3BwdCcsIHRoaXMuY29udmVydGVyc1sncHB0eCddKTtcclxuXHJcbiAgICAgICAgLy8gUmVnaXN0ZXIgdGhlIFBERiBmYWN0b3J5IGFkYXB0ZXIgd2l0aCBwcm9wZXIgaW1wbGVtZW50YXRpb25cclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCdwZGYnLCB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coXCJbUGRmQWRhcHRlcl0gQ29udmVydGluZyBQREYgZG9jdW1lbnRcIik7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIHRlbXAgZGlyZWN0b3J5IGZvciBjb252ZXJzaW9uIHVzaW5nIHRoZSBzaW5nbGV0b24gc2VydmljZVxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZS5jcmVhdGVUZW1wRGlyKCdwZGZfY29udmVyc2lvbicpOyBcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBFbnN1cmUgdGhlIGRpcmVjdG9yeSBleGlzdHNcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5lbnN1cmVEaXIodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcEZpbGUgPSBwYXRoLmpvaW4odGVtcERpciwgYGRvY3VtZW50XyR7RGF0ZS5ub3coKX0ucGRmYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gV3JpdGUgYnVmZmVyIHRvIHRlbXAgZmlsZVxyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZSh0ZW1wRmlsZSwgY29udGVudCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVmVyaWZ5IHRoZSBmaWxlIHdhcyB3cml0dGVuIHN1Y2Nlc3NmdWxseVxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghKGF3YWl0IGZzLnBhdGhFeGlzdHModGVtcEZpbGUpKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byB3cml0ZSB0ZW1wb3JhcnkgUERGIGZpbGU6ICR7dGVtcEZpbGV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIERldGVybWluZSBpZiBPQ1Igc2hvdWxkIGJlIHVzZWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRGV0ZXJtaW5lIGlmIE9DUiBzaG91bGQgYmUgdXNlZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB1c2VPY3IgPSBvcHRpb25zLnVzZU9jciA9PT0gdHJ1ZSAmJiBvcHRpb25zLm1pc3RyYWxBcGlLZXk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgYXBwcm9wcmlhdGUgY29udmVydGVyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxldCByZXN1bHQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh1c2VPY3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbQ29udmVydGVyUmVnaXN0cnldIFVzaW5nIE1pc3RyYWwgT0NSIGNvbnZlcnRlciBmb3IgUERGIGNvbnZlcnNpb24nKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVzZSBNaXN0cmFsIE9DUiBjb252ZXJ0ZXIgLSByZXF1aXJlIGl0IGRpcmVjdGx5IHRvIGVuc3VyZSBpdCdzIGluIHNjb3BlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRydWUgZm9yIHNraXBIYW5kbGVyU2V0dXAgdG8gYXZvaWQgZHVwbGljYXRlIElQQyBoYW5kbGVyIHJlZ2lzdHJhdGlvblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyBzaW5nbGV0b24gc2VydmljZXNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IE1pc3RyYWxQZGZDb252ZXJ0ZXJDbGFzcyA9IHJlcXVpcmUoJy4vZG9jdW1lbnQvTWlzdHJhbFBkZkNvbnZlcnRlcicpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWlzdHJhbENvbnZlcnRlciA9IG5ldyBNaXN0cmFsUGRmQ29udmVydGVyQ2xhc3MoZmlsZVByb2Nlc3NvclNlcnZpY2VJbnN0YW5jZSwgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UsIG51bGwsIHRydWUpOyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFNldCB0aGUgQVBJIGtleVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWlzdHJhbENvbnZlcnRlci5hcGlLZXkgPSBvcHRpb25zLm1pc3RyYWxBcGlLZXk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW0NvbnZlcnRlclJlZ2lzdHJ5XSBNaXN0cmFsIEFQSSBrZXkgc2V0IGZvciBPQ1IgY29udmVyc2lvbicpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCBtaXN0cmFsQ29udmVydGVyLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpS2V5OiBvcHRpb25zLm1pc3RyYWxBcGlLZXlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHN0YW5kYXJkIGNvbnZlcnRlciAtIHJlcXVpcmUgaXQgZGlyZWN0bHkgdG8gZW5zdXJlIGl0J3MgaW4gc2NvcGVcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdHJ1ZSBmb3Igc2tpcEhhbmRsZXJTZXR1cCB0byBhdm9pZCBkdXBsaWNhdGUgSVBDIGhhbmRsZXIgcmVnaXN0cmF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHNpbmdsZXRvbiBzZXJ2aWNlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tDb252ZXJ0ZXJSZWdpc3RyeV0gVXNpbmcgc3RhbmRhcmQgUERGIGNvbnZlcnRlcicpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgU3RhbmRhcmRQZGZDb252ZXJ0ZXJDbGFzcyA9IHJlcXVpcmUoJy4vZG9jdW1lbnQvU3RhbmRhcmRQZGZDb252ZXJ0ZXInKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YW5kYXJkQ29udmVydGVyID0gbmV3IFN0YW5kYXJkUGRmQ29udmVydGVyQ2xhc3MoZmlsZVByb2Nlc3NvclNlcnZpY2VJbnN0YW5jZSwgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UsIHRydWUpOyBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHN0YW5kYXJkQ29udmVydGVyLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBuYW1lXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRW5zdXJlIHJlc3VsdCBoYXMgc3VjY2VzcyBmbGFnIGFuZCBjb250ZW50XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihyZXN1bHQuZXJyb3IgfHwgJ1BERiBjb252ZXJzaW9uIGZhaWxlZCB3aXRoIG5vIHNwZWNpZmljIGVycm9yJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghcmVzdWx0LmNvbnRlbnQgfHwgdHlwZW9mIHJlc3VsdC5jb250ZW50ICE9PSAnc3RyaW5nJyB8fCByZXN1bHQuY29udGVudC50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1BERiBjb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQnKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBSZS10aHJvdyBlcnJvclxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQZGZBZGFwdGVyXSBFcnJvciBjb252ZXJ0aW5nIFBERjogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUERGIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoY29udGVudCkgPT4gQnVmZmVyLmlzQnVmZmVyKGNvbnRlbnQpICYmIGNvbnRlbnQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnUERGIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy5wZGYnXSxcclxuICAgICAgICAgICAgICAgIG1pbWVUeXBlczogWydhcHBsaWNhdGlvbi9wZGYnXSxcclxuICAgICAgICAgICAgICAgIG1heFNpemU6IDEwMCAqIDEwMjQgKiAxMDI0IC8vIDEwME1CXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBhZGFwdGVyIGZvciBVUkwgY29udmVydGVyIHVzaW5nIHRoZSBhY3R1YWwgaW1wbGVtZW50YXRpb25cclxuICAgICAgICB0aGlzLnJlZ2lzdGVyKCd1cmwnLCB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICAgIC8vIFVSTCBjb252ZXJ0ZXIgZXhwZWN0cyB0aGUgY29udGVudCB0byBiZSB0aGUgVVJMIHN0cmluZ1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW1VybEFkYXB0ZXJdIENvbnZlcnRpbmcgVVJMOiAke2NvbnRlbnR9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIHRlbXBvcmFyeSBkaXJlY3RvcnkgZm9yIHRoZSBjb252ZXJzaW9uIHVzaW5nIHRoZSBzaW5nbGV0b24gc2VydmljZVxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBmaWxlU3RvcmFnZVNlcnZpY2VJbnN0YW5jZS5jcmVhdGVUZW1wRGlyKCd1cmxfY29udmVyc2lvbicpOyBcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBMYXVuY2ggYSBicm93c2VyIGluc3RhbmNlIGZvciB0aGUgY29udmVyc2lvblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHB1cHBldGVlciA9IHJlcXVpcmUoJ3B1cHBldGVlcicpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJyb3dzZXIgPSBhd2FpdCBwdXBwZXRlZXIubGF1bmNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaGVhZGxlc3M6ICduZXcnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhcmdzOiBbJy0tbm8tc2FuZGJveCcsICctLWRpc2FibGUtc2V0dWlkLXNhbmRib3gnXVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEZldGNoIG1ldGFkYXRhXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgdXJsQ29udmVydGVySW5zdGFuY2UuZmV0Y2hNZXRhZGF0YShjb250ZW50LCBicm93c2VyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgY29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBleHRyYWN0ZWRDb250ZW50ID0gYXdhaXQgdXJsQ29udmVydGVySW5zdGFuY2UuZXh0cmFjdENvbnRlbnQoY29udGVudCwgb3B0aW9ucywgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBQcm9jZXNzIGltYWdlcyBpZiByZXF1ZXN0ZWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZUltYWdlcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdXJsQ29udmVydGVySW5zdGFuY2UucHJvY2Vzc0ltYWdlcyhleHRyYWN0ZWRDb250ZW50LCB0ZW1wRGlyLCBjb250ZW50LCBicm93c2VyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgbWFya2Rvd25cclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFya2Rvd24gPSB1cmxDb252ZXJ0ZXJJbnN0YW5jZS5nZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCBleHRyYWN0ZWRDb250ZW50LCBudWxsLCBvcHRpb25zKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsb3NlIGJyb3dzZXJcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcG9yYXJ5IGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IG1hcmtkb3duLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICd1cmwnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xvc2UgYnJvd3NlciBvbiBlcnJvclxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wb3JhcnkgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFJlLXRocm93IGVycm9yXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1VybEFkYXB0ZXJdIEVycm9yIGNvbnZlcnRpbmcgVVJMOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVUkwgY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdmFsaWRhdGU6IChjb250ZW50KSA9PiB0eXBlb2YgY29udGVudCA9PT0gJ3N0cmluZycgJiYgY29udGVudC5sZW5ndGggPiAwLFxyXG4gICAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdVUkwgQ29udmVydGVyJyxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnVybCcsICcuaHRtbCcsICcuaHRtJ10sXHJcbiAgICAgICAgICAgICAgICBtaW1lVHlwZXM6IFsndGV4dC9odG1sJywgJ2FwcGxpY2F0aW9uL3gtdXJsJ10sXHJcbiAgICAgICAgICAgICAgICBtYXhTaXplOiAxMCAqIDEwMjQgKiAxMDI0IC8vIDEwTUJcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGFkYXB0ZXIgZm9yIFBhcmVudFVSTCBjb252ZXJ0ZXIgdXNpbmcgdGhlIGFjdHVhbCBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAgIHRoaXMucmVnaXN0ZXIoJ3BhcmVudHVybCcsIHtcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgICAgLy8gRm9yIFVSTCBjb252ZXJ0ZXJzLCBjb250ZW50IGlzIHRoZSBVUkwgc3RyaW5nIGl0c2VsZlxyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW1BhcmVudFVybEFkYXB0ZXJdIENvbnZlcnRpbmcgc2l0ZTogJHtjb250ZW50fWApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSB0ZW1wb3JhcnkgZGlyZWN0b3J5IGZvciB0aGUgY29udmVyc2lvbiB1c2luZyB0aGUgc2luZ2xldG9uIHNlcnZpY2VcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgZmlsZVN0b3JhZ2VTZXJ2aWNlSW5zdGFuY2UuY3JlYXRlVGVtcERpcigncGFyZW50X3VybF9jb252ZXJzaW9uJyk7IFxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIExhdW5jaCBhIGJyb3dzZXIgaW5zdGFuY2UgZm9yIHRoZSBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcHVwcGV0ZWVyID0gcmVxdWlyZSgncHVwcGV0ZWVyJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYnJvd3NlciA9IGF3YWl0IHB1cHBldGVlci5sYXVuY2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBoZWFkbGVzczogJ25ldycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFyZ3M6IFsnLS1uby1zYW5kYm94JywgJy0tZGlzYWJsZS1zZXR1aWQtc2FuZGJveCddXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRGlzY292ZXIgc2l0ZW1hcFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzaXRlbWFwID0gYXdhaXQgcGFyZW50VXJsQ29udmVydGVySW5zdGFuY2UuZGlzY292ZXJTaXRlbWFwKGNvbnRlbnQsIG9wdGlvbnMsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUHJvY2VzcyBlYWNoIHBhZ2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF4UGFnZXMgPSBvcHRpb25zLm1heFBhZ2VzIHx8IE1hdGgubWluKHNpdGVtYXAucGFnZXMubGVuZ3RoLCAxMCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VzVG9Qcm9jZXNzID0gc2l0ZW1hcC5wYWdlcy5zbGljZSgwLCBtYXhQYWdlcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHByb2Nlc3NlZFBhZ2VzID0gW107XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHBhZ2Ugb2YgcGFnZXNUb1Byb2Nlc3MpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFByb2Nlc3MgcGFnZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFnZUNvbnRlbnQgPSBhd2FpdCBwYXJlbnRVcmxDb252ZXJ0ZXJJbnN0YW5jZS5wcm9jZXNzUGFnZShcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYWdlLnVybCwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucywgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJvd3NlciwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGVtcERpclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQWRkIHRvIHByb2Nlc3NlZCBwYWdlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2VkUGFnZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBwYWdlLnVybCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogcGFnZS50aXRsZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBwYWdlQ29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIGNvbWJpbmVkIG1hcmtkb3duXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duID0gcGFyZW50VXJsQ29udmVydGVySW5zdGFuY2UuZ2VuZXJhdGVDb21iaW5lZE1hcmtkb3duKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2l0ZW1hcCwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9jZXNzZWRQYWdlcywgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbG9zZSBicm93c2VyXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXBvcmFyeSBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBtYXJrZG93bixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IG5hbWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAncGFyZW50dXJsJ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENsb3NlIGJyb3dzZXIgb24gZXJyb3JcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcG9yYXJ5IGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBSZS10aHJvdyBlcnJvclxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQYXJlbnRVcmxBZGFwdGVyXSBFcnJvciBjb252ZXJ0aW5nIHNpdGU6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNpdGUgY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdmFsaWRhdGU6IChjb250ZW50KSA9PiB0eXBlb2YgY29udGVudCA9PT0gJ3N0cmluZycgJiYgY29udGVudC5sZW5ndGggPiAwLFxyXG4gICAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgICAgIG5hbWU6ICdXZWJzaXRlIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy51cmwnLCAnLmh0bWwnLCAnLmh0bSddLFxyXG4gICAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ3RleHQvaHRtbCcsICdhcHBsaWNhdGlvbi94LXVybCddLFxyXG4gICAgICAgICAgICAgICAgbWF4U2l6ZTogMTAgKiAxMDI0ICogMTAyNCAvLyAxME1CXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCByZWdpc3RlcmVkVHlwZXMgPSBPYmplY3Qua2V5cyh0aGlzLmNvbnZlcnRlcnMpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgQ29udmVydGVycyByZWdpc3RlcmVkIHN1Y2Nlc3NmdWxseTogJHtyZWdpc3RlcmVkVHlwZXMubGVuZ3RofSB0eXBlc2ApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OLIFJlZ2lzdGVyZWQgdHlwZXM6ICR7cmVnaXN0ZXJlZFR5cGVzLmpvaW4oJywgJyl9YCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBzZXR0aW5nIHVwIGNvbnZlcnRlcnM6JywgZXJyb3IpO1xyXG4gICAgICAgIC8vIEFkZCBkZXRhaWxlZCBlcnJvciBsb2dnaW5nXHJcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZGV0YWlsczonLCB7XHJcbiAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcclxuICAgICAgICAgICAgbmFtZTogZXJyb3IubmFtZVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFRocm93IHRoZSBlcnJvciB0byBiZSBoYW5kbGVkIGJ5IHRoZSBjYWxsZXJcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBzZXQgdXAgY29udmVydGVyczogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgfVxyXG59O1xyXG5cclxuLy8gQ3JlYXRlIGFuZCBleHBvcnQgc2luZ2xldG9uIGluc3RhbmNlXHJcbnZhciByZWdpc3RyeSA9IG5ldyBDb252ZXJ0ZXJSZWdpc3RyeSgpO1xyXG5tb2R1bGUuZXhwb3J0cyA9IHJlZ2lzdHJ5O1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxFQUFFLEdBQUdDLE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDOUIsTUFBTUMsSUFBSSxHQUFHRCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU07RUFBRUU7QUFBUSxDQUFDLEdBQUdGLE9BQU8sQ0FBQyxVQUFVLENBQUM7O0FBRXZDO0FBQ0E7QUFDQTtBQUNBLFNBQVNHLGlCQUFpQkEsQ0FBQSxFQUFHO0VBQ3pCLElBQUksQ0FBQ0MsVUFBVSxHQUFHLENBQUMsQ0FBQztFQUNwQixJQUFJLENBQUNDLGlCQUFp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