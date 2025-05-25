"use strict";

/**
 * StandardPdfConverter.js
 * Handles conversion of PDF files to markdown using standard text extraction.
 * 
 * This converter:
 * - Uses pdf-lib and pdf-parse for PDF processing
 * - Extracts text and metadata from PDF documents
 * - Generates page thumbnails when requested
 * - Creates structured markdown output
 * 
 * Related Files:
 * - BasePdfConverter.js: Parent class with common PDF functionality
 * - MistralPdfConverter.js: Alternative OCR-based converter
 * - FileStorageService.js: For temporary file management
 * - PdfConverterFactory.js: Factory for selecting appropriate converter
 */

const path = require('path');
const fs = require('fs-extra');
const {
  PDFDocument
} = require('pdf-lib');
const pdfParse = require('pdf-parse');
const {
  v4: uuidv4
} = require('uuid');
const BasePdfConverter = require('./BasePdfConverter');
class StandardPdfConverter extends BasePdfConverter {
  constructor(fileProcessor, fileStorage, skipHandlerSetup = false) {
    super(fileProcessor, fileStorage);
    this.name = 'Standard PDF Converter';
    this.description = 'Converts PDF files to markdown using standard text extraction';
    this.skipHandlerSetup = skipHandlerSetup;

    // Log whether handlers will be set up
    if (skipHandlerSetup) {
      console.log('[StandardPdfConverter] Skipping handler setup (skipHandlerSetup=true)');
    } else {
      // Instead of delaying setupIpcHandlers through BaseService (which is causing duplicate registrations),
      // we'll ensure we only set up handlers explicitly when skipHandlerSetup is false
      // This will override BaseService's setTimeout approach
      this.setupIpcHandlers();
    }
  }

  /**
   * Set up IPC handlers for PDF conversion
   */
  setupIpcHandlers() {
    // If skipHandlerSetup was specified, don't register handlers
    if (this.skipHandlerSetup) {
      console.log('[StandardPdfConverter] Skipping IPC handler setup due to skipHandlerSetup flag');
      return;
    }

    // Use try-catch to handle cases where handlers are already registered
    try {
      this.registerHandler('convert:pdf:standard', this.handleConvert.bind(this));
      this.registerHandler('convert:pdf:standard:metadata', this.handleGetMetadata.bind(this));
      this.registerHandler('convert:pdf:standard:thumbnail', this.handleGenerateThumbnail.bind(this));
    } catch (error) {
      // If a handler is already registered, log the error but don't crash
      console.warn(`[StandardPdfConverter] Error in setupIpcHandlers: ${error.message}`);
    }
  }

  /**
   * Handle PDF conversion request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Conversion request details
   */
  async handleConvert(event, {
    filePath,
    options = {}
  }) {
    try {
      const conversionId = this.generateConversionId();
      const window = event?.sender?.getOwnerBrowserWindow?.() || null;

      // Create temp directory for this conversion
      const tempDir = await this.fileStorage.createTempDir('pdf_conversion');
      this.activeConversions.set(conversionId, {
        id: conversionId,
        status: 'starting',
        progress: 0,
        filePath,
        tempDir,
        window
      });

      // Notify client that conversion has started (only if we have a valid window)
      if (window && window.webContents) {
        window.webContents.send('pdf:conversion-started', {
          conversionId
        });
      }

      // Start conversion process
      this.processConversion(conversionId, filePath, options).catch(error => {
        console.error(`[StandardPdfConverter] Conversion failed for ${conversionId}:`, error);
        this.updateConversionStatus(conversionId, 'failed', {
          error: error.message
        });

        // Clean up temp directory
        fs.remove(tempDir).catch(err => {
          console.error(`[StandardPdfConverter] Failed to clean up temp directory: ${tempDir}`, err);
        });
      });
      return {
        conversionId
      };
    } catch (error) {
      console.error('[StandardPdfConverter] Failed to start conversion:', error);
      throw error;
    }
  }

  /**
   * Handle PDF metadata request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Metadata request details
   */
  async handleGetMetadata(event, {
    filePath
  }) {
    try {
      const metadata = await this.extractMetadata(filePath);
      return metadata;
    } catch (error) {
      console.error('[StandardPdfConverter] Failed to get metadata:', error);
      throw error;
    }
  }

  /**
   * Handle PDF thumbnail generation request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Thumbnail request details
   */
  async handleGenerateThumbnail(event, {
    filePath,
    pageNumber = 1,
    options = {}
  }) {
    console.log(`[StandardPdfConverter] Thumbnail generation disabled for page ${pageNumber}`);
    // Return a placeholder response since thumbnails are not generated
    return {
      data: '',
      pageNumber,
      disabled: true
    };
  }

  /**
   * Process PDF conversion
   * @param {string} conversionId - Conversion identifier
   * @param {string} filePath - Path to PDF file
   * @param {Object} options - Conversion options
   */
  async processConversion(conversionId, filePath, options) {
    try {
      const conversion = this.activeConversions.get(conversionId);
      if (!conversion) {
        throw new Error('Conversion not found');
      }
      const tempDir = conversion.tempDir;

      // Extract metadata
      this.updateConversionStatus(conversionId, 'extracting_metadata', {
        progress: 5
      });
      const metadata = await this.extractMetadata(filePath);

      // Extract text
      this.updateConversionStatus(conversionId, 'extracting_text', {
        progress: 10
      });
      const pdfData = await fs.readFile(filePath);
      const pdfContent = await pdfParse(pdfData);

      // Process pages
      this.updateConversionStatus(conversionId, 'processing_pages', {
        progress: 30
      });
      const maxPages = options.maxPages || metadata.pageCount;
      const pages = await this.extractPages(filePath, pdfContent, Math.min(maxPages, metadata.pageCount));

      // Generate thumbnails if requested
      let thumbnails = [];
      if (options.includeImages) {
        this.updateConversionStatus(conversionId, 'generating_thumbnails', {
          progress: 50
        });
        thumbnails = await this.generateThumbnails(filePath, tempDir, Math.min(maxPages, metadata.pageCount));
      }

      // Generate markdown
      this.updateConversionStatus(conversionId, 'generating_markdown', {
        progress: 80
      });
      const markdown = this.generateMarkdown(metadata, pages, thumbnails, options);

      // Clean up temp directory
      await fs.remove(tempDir);
      this.updateConversionStatus(conversionId, 'completed', {
        progress: 100,
        result: markdown
      });
      return markdown;
    } catch (error) {
      console.error('[StandardPdfConverter] Conversion processing failed:', error);
      throw error;
    }
  }

  /**
   * Extract metadata from PDF file
   * @param {string} filePath - Path to PDF file
   * @returns {Promise<Object>} PDF metadata
   */
  async extractMetadata(filePath) {
    try {
      const pdfData = await fs.readFile(filePath);
      const pdfDoc = await PDFDocument.load(pdfData);
      const pdfContent = await pdfParse(pdfData);
      const stats = await fs.stat(filePath);

      // Extract metadata
      const metadata = {
        filename: path.basename(filePath),
        pageCount: pdfDoc.getPageCount(),
        fileSize: stats.size,
        ...pdfContent.info
      };

      // Format dates
      if (metadata.CreationDate) {
        metadata.creationDate = this.formatPdfDate(metadata.CreationDate);
        delete metadata.CreationDate;
      }
      if (metadata.ModDate) {
        metadata.modificationDate = this.formatPdfDate(metadata.ModDate);
        delete metadata.ModDate;
      }

      // Rename standard fields
      if (metadata.Author) {
        metadata.author = metadata.Author;
        delete metadata.Author;
      }
      if (metadata.Title) {
        metadata.title = metadata.Title;
        delete metadata.Title;
      }
      if (metadata.Subject) {
        metadata.subject = metadata.Subject;
        delete metadata.Subject;
      }
      if (metadata.Keywords) {
        metadata.keywords = metadata.Keywords;
        delete metadata.Keywords;
      }
      if (metadata.Creator) {
        metadata.creator = metadata.Creator;
        delete metadata.Creator;
      }
      if (metadata.Producer) {
        metadata.producer = metadata.Producer;
        delete metadata.Producer;
      }
      return metadata;
    } catch (error) {
      console.error('[StandardPdfConverter] Failed to extract metadata:', error);
      throw error;
    }
  }

  /**
   * Format PDF date string
   * @param {string} dateString - PDF date string
   * @returns {string} Formatted date
   */
  formatPdfDate(dateString) {
    try {
      // PDF dates can be in format: D:YYYYMMDDHHmmSSOHH'mm'
      if (dateString.startsWith('D:')) {
        dateString = dateString.substring(2);
      }

      // Try to parse the date
      const year = dateString.substring(0, 4);
      const month = dateString.substring(4, 6);
      const day = dateString.substring(6, 8);
      return `${year}-${month}-${day}`;
    } catch (error) {
      return dateString;
    }
  }

  /**
   * Extract pages from PDF content
   * @param {string} filePath - Path to PDF file
   * @param {Object} pdfContent - PDF content from pdf-parse
   * @param {number} maxPages - Maximum pages to extract
   * @returns {Promise<Array>} Array of page objects
   */
  async extractPages(filePath, pdfContent, maxPages) {
    try {
      const pdfData = await fs.readFile(filePath);
      const pdfDoc = await PDFDocument.load(pdfData);
      const pages = [];
      const totalPages = pdfDoc.getPageCount();

      // Split text into pages (pdf-parse gives us all text)
      // This is a simple approach and might not be perfect
      const textPerPage = Math.ceil(pdfContent.text.length / totalPages);
      for (let i = 0; i < Math.min(totalPages, maxPages); i++) {
        const page = pdfDoc.getPage(i);
        const {
          width,
          height
        } = page.getSize();
        const startIndex = i * textPerPage;
        const endIndex = Math.min((i + 1) * textPerPage, pdfContent.text.length);
        const text = pdfContent.text.substring(startIndex, endIndex).trim();
        pages.push({
          pageNumber: i + 1,
          width,
          height,
          text
        });
      }
      return pages;
    } catch (error) {
      console.error('[StandardPdfConverter] Failed to extract pages:', error);
      throw error;
    }
  }

  /**
   * Generate thumbnails for PDF pages
   * @param {string} filePath - Path to PDF file
   * @param {string} outputDir - Output directory
   * @param {number} pageCount - Number of pages
   * @returns {Promise<Array>} Array of thumbnail info objects
   */
  async generateThumbnails(filePath, outputDir, pageCount) {
    // This functionality has been removed to eliminate the canvas dependency
    console.log(`[StandardPdfConverter] Thumbnail generation disabled`);
    return [];
  }

  /**
   * Generate a single page thumbnail
   * @param {string} filePath - Path to PDF file
   * @param {string} outputPath - Output path for thumbnail
   * @param {number} pageNumber - Page number
   * @param {Object} options - Thumbnail options
   * @returns {Promise<void>}
   */
  async generatePageThumbnail(filePath, outputPath, pageNumber, options = {}) {
    // This functionality has been removed to eliminate the canvas dependency
    console.log(`[StandardPdfConverter] Thumbnail generation disabled for page ${pageNumber}`);
    return Promise.resolve();
  }

  /**
   * Generate markdown from PDF metadata and pages
   * @param {Object} metadata - PDF metadata
   * @param {Array} pages - Array of page objects
   * @param {Array} thumbnails - Array of thumbnail info objects (always empty now that thumbnail generation is disabled)
   * @param {Object} options - Conversion options
   * @returns {string} Markdown content
   */
  generateMarkdown(metadata, pages, thumbnails, options) {
    // Start with empty markdown array (no header - handled by standardized frontmatter)
    const markdown = [];

    // Add content for each page
    pages.forEach(page => {
      markdown.push(`## Page ${page.pageNumber}`);
      markdown.push('');

      // No thumbnails are added since thumbnail generation is disabled

      // Add page text
      markdown.push(page.text);
      markdown.push('');
    });
    return markdown.join('\n');
  }

  /**
   * Convert PDF content to markdown - direct method for ConverterRegistry
   * @param {Buffer} content - PDF content as buffer
   * @param {string} name - File name
   * @param {string} apiKey - API key (not used for standard conversion)
   * @param {Object} options - Conversion options
   * @returns {Promise<Object>} Conversion result
   */
  async convertToMarkdown(content, options = {}) {
    try {
      console.log(`[StandardPdfConverter] Converting PDF: ${options.name || 'unnamed'}`);

      // Create a temporary file to process
      const tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'pdf-conversion-'));
      const tempFile = path.join(tempDir, `${options.name || 'document'}.pdf`);

      // Write buffer to temp file
      await fs.writeFile(tempFile, content);

      // Extract metadata
      const metadata = await this.extractMetadata(tempFile);

      // Extract text
      const pdfContent = await pdfParse(content);

      // Process pages
      const maxPages = options.maxPages || metadata.pageCount;
      const pages = await this.extractPages(tempFile, pdfContent, Math.min(maxPages, metadata.pageCount));

      // Generate thumbnails if requested
      let thumbnails = [];
      if (options.includeImages) {
        console.log('[StandardPdfConverter] Generating thumbnails for direct conversion');
        const tempImagesDir = path.join(tempDir, 'thumbnails');
        await fs.mkdir(tempImagesDir, {
          recursive: true
        });
        thumbnails = await this.generateThumbnails(tempFile, tempImagesDir, Math.min(maxPages, metadata.pageCount));
      }

      // Get the title from metadata or filename - clean the filename to remove .pdf extension
      const cleanFileName = options.name ? options.name.replace(/\.pdf$/i, '') : 'PDF Document';
      const fileTitle = metadata.title || cleanFileName;

      // Create standardized frontmatter using metadata utility
      const {
        createStandardFrontmatter
      } = require('../../../converters/utils/metadata');
      const frontmatter = createStandardFrontmatter({
        title: fileTitle,
        fileType: 'pdf'
      });

      // Generate markdown content
      const markdownContent = this.generateMarkdown(metadata, pages, thumbnails, options);

      // Combine frontmatter and content
      const finalMarkdown = frontmatter + markdownContent;

      // Clean up temp directory
      await fs.remove(tempDir);
      return {
        success: true,
        content: finalMarkdown
      };
    } catch (error) {
      console.error('[StandardPdfConverter] Direct conversion failed:', error);
      return {
        success: false,
        error: `PDF conversion failed: ${error.message}`,
        content: `# Conversion Error\n\nFailed to convert PDF: ${error.message}`
      };
    }
  }

  /**
   * Get converter information
   * @returns {Object} Converter details
   */
  getInfo() {
    return {
      name: this.name,
      extensions: this.supportedExtensions,
      description: this.description,
      options: {
        title: 'Optional document title',
        includeImages: 'Whether to include page images (default: false)',
        maxPages: 'Maximum pages to convert (default: all)'
      }
    };
  }
}
module.exports = StandardPdfConverter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiUERGRG9jdW1lbnQiLCJwZGZQYXJzZSIsInY0IiwidXVpZHY0IiwiQmFzZVBkZkNvbnZlcnRlciIsIlN0YW5kYXJkUGRmQ29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJza2lwSGFuZGxlclNldHVwIiwibmFtZSIsImRlc2NyaXB0aW9uIiwiY29uc29sZSIsImxvZyIsInNldHVwSXBjSGFuZGxlcnMiLCJyZWdpc3RlckhhbmRsZXIiLCJoYW5kbGVDb252ZXJ0IiwiYmluZCIsImhhbmRsZUdldE1ldGFkYXRhIiwiaGFuZGxlR2VuZXJhdGVUaHVtYm5haWwiLCJlcnJvciIsIndhcm4iLCJtZXNzYWdlIiwiZXZlbnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJjb252ZXJzaW9uSWQiLCJnZW5lcmF0ZUNvbnZlcnNpb25JZCIsIndpbmRvdyIsInNlbmRlciIsImdldE93bmVyQnJvd3NlcldpbmRvdyIsInRlbXBEaXIiLCJjcmVhdGVUZW1wRGlyIiwiYWN0aXZlQ29udmVyc2lvbnMiLCJzZXQiLCJpZCIsInN0YXR1cyIsInByb2dyZXNzIiwid2ViQ29udGVudHMiLCJzZW5kIiwicHJvY2Vzc0NvbnZlcnNpb24iLCJjYXRjaCIsInVwZGF0ZUNvbnZlcnNpb25TdGF0dXMiLCJyZW1vdmUiLCJlcnIiLCJtZXRhZGF0YSIsImV4dHJhY3RNZXRhZGF0YSIsInBhZ2VOdW1iZXIiLCJkYXRhIiwiZGlzYWJsZWQiLCJjb252ZXJzaW9uIiwiZ2V0IiwiRXJyb3IiLCJwZGZEYXRhIiwicmVhZEZpbGUiLCJwZGZDb250ZW50IiwibWF4UGFnZXMiLCJwYWdlQ291bnQiLCJwYWdlcyIsImV4dHJhY3RQYWdlcyIsIk1hdGgiLCJtaW4iLCJ0aHVtYm5haWxzIiwiaW5jbHVkZUltYWdlcyIsImdlbmVyYXRlVGh1bWJuYWlscyIsIm1hcmtkb3duIiwiZ2VuZXJhdGVNYXJrZG93biIsInJlc3VsdCIsInBkZkRvYyIsImxvYWQiLCJzdGF0cyIsInN0YXQiLCJmaWxlbmFtZSIsImJhc2VuYW1lIiwiZ2V0UGFnZUNvdW50IiwiZmlsZVNpemUiLCJzaXplIiwiaW5mbyIsIkNyZWF0aW9uRGF0ZSIsImNyZWF0aW9uRGF0ZSIsImZvcm1hdFBkZkRhdGUiLCJNb2REYXRlIiwibW9kaWZpY2F0aW9uRGF0ZSIsIkF1dGhvciIsImF1dGhvciIsIlRpdGxlIiwidGl0bGUiLCJTdWJqZWN0Iiwic3ViamVjdCIsIktleXdvcmRzIiwia2V5d29yZHMiLCJDcmVhdG9yIiwiY3JlYXRvciIsIlByb2R1Y2VyIiwicHJvZHVjZXIiLCJkYXRlU3RyaW5nIiwic3RhcnRzV2l0aCIsInN1YnN0cmluZyIsInllYXIiLCJtb250aCIsImRheSIsInRvdGFsUGFnZXMiLCJ0ZXh0UGVyUGFnZSIsImNlaWwiLCJ0ZXh0IiwibGVuZ3RoIiwiaSIsInBhZ2UiLCJnZXRQYWdlIiwid2lkdGgiLCJoZWlnaHQiLCJnZXRTaXplIiwic3RhcnRJbmRleCIsImVuZEluZGV4IiwidHJpbSIsInB1c2giLCJvdXRwdXREaXIiLCJnZW5lcmF0ZVBhZ2VUaHVtYm5haWwiLCJvdXRwdXRQYXRoIiwiUHJvbWlzZSIsInJlc29sdmUiLCJmb3JFYWNoIiwiam9pbiIsImNvbnZlcnRUb01hcmtkb3duIiwiY29udGVudCIsIm1rZHRlbXAiLCJ0bXBkaXIiLCJ0ZW1wRmlsZSIsIndyaXRlRmlsZSIsInRlbXBJbWFnZXNEaXIiLCJta2RpciIsInJlY3Vyc2l2ZSIsImNsZWFuRmlsZU5hbWUiLCJyZXBsYWNlIiwiZmlsZVRpdGxlIiwiY3JlYXRlU3RhbmRhcmRGcm9udG1hdHRlciIsImZyb250bWF0dGVyIiwiZmlsZVR5cGUiLCJtYXJrZG93bkNvbnRlbnQiLCJmaW5hbE1hcmtkb3duIiwic3VjY2VzcyIsImdldEluZm8iLCJleHRlbnNpb25zIiwic3VwcG9ydGVkRXh0ZW5zaW9ucyIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9TdGFuZGFyZFBkZkNvbnZlcnRlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogU3RhbmRhcmRQZGZDb252ZXJ0ZXIuanNcclxuICogSGFuZGxlcyBjb252ZXJzaW9uIG9mIFBERiBmaWxlcyB0byBtYXJrZG93biB1c2luZyBzdGFuZGFyZCB0ZXh0IGV4dHJhY3Rpb24uXHJcbiAqIFxyXG4gKiBUaGlzIGNvbnZlcnRlcjpcclxuICogLSBVc2VzIHBkZi1saWIgYW5kIHBkZi1wYXJzZSBmb3IgUERGIHByb2Nlc3NpbmdcclxuICogLSBFeHRyYWN0cyB0ZXh0IGFuZCBtZXRhZGF0YSBmcm9tIFBERiBkb2N1bWVudHNcclxuICogLSBHZW5lcmF0ZXMgcGFnZSB0aHVtYm5haWxzIHdoZW4gcmVxdWVzdGVkXHJcbiAqIC0gQ3JlYXRlcyBzdHJ1Y3R1cmVkIG1hcmtkb3duIG91dHB1dFxyXG4gKiBcclxuICogUmVsYXRlZCBGaWxlczpcclxuICogLSBCYXNlUGRmQ29udmVydGVyLmpzOiBQYXJlbnQgY2xhc3Mgd2l0aCBjb21tb24gUERGIGZ1bmN0aW9uYWxpdHlcclxuICogLSBNaXN0cmFsUGRmQ29udmVydGVyLmpzOiBBbHRlcm5hdGl2ZSBPQ1ItYmFzZWQgY29udmVydGVyXHJcbiAqIC0gRmlsZVN0b3JhZ2VTZXJ2aWNlLmpzOiBGb3IgdGVtcG9yYXJ5IGZpbGUgbWFuYWdlbWVudFxyXG4gKiAtIFBkZkNvbnZlcnRlckZhY3RvcnkuanM6IEZhY3RvcnkgZm9yIHNlbGVjdGluZyBhcHByb3ByaWF0ZSBjb252ZXJ0ZXJcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbmNvbnN0IHsgUERGRG9jdW1lbnQgfSA9IHJlcXVpcmUoJ3BkZi1saWInKTtcclxuY29uc3QgcGRmUGFyc2UgPSByZXF1aXJlKCdwZGYtcGFyc2UnKTtcclxuY29uc3QgeyB2NDogdXVpZHY0IH0gPSByZXF1aXJlKCd1dWlkJyk7XHJcbmNvbnN0IEJhc2VQZGZDb252ZXJ0ZXIgPSByZXF1aXJlKCcuL0Jhc2VQZGZDb252ZXJ0ZXInKTtcclxuXHJcbmNsYXNzIFN0YW5kYXJkUGRmQ29udmVydGVyIGV4dGVuZHMgQmFzZVBkZkNvbnZlcnRlciB7XHJcbiAgICBjb25zdHJ1Y3RvcihmaWxlUHJvY2Vzc29yLCBmaWxlU3RvcmFnZSwgc2tpcEhhbmRsZXJTZXR1cCA9IGZhbHNlKSB7XHJcbiAgICAgICAgc3VwZXIoZmlsZVByb2Nlc3NvciwgZmlsZVN0b3JhZ2UpO1xyXG4gICAgICAgIHRoaXMubmFtZSA9ICdTdGFuZGFyZCBQREYgQ29udmVydGVyJztcclxuICAgICAgICB0aGlzLmRlc2NyaXB0aW9uID0gJ0NvbnZlcnRzIFBERiBmaWxlcyB0byBtYXJrZG93biB1c2luZyBzdGFuZGFyZCB0ZXh0IGV4dHJhY3Rpb24nO1xyXG4gICAgICAgIHRoaXMuc2tpcEhhbmRsZXJTZXR1cCA9IHNraXBIYW5kbGVyU2V0dXA7XHJcblxyXG4gICAgICAgIC8vIExvZyB3aGV0aGVyIGhhbmRsZXJzIHdpbGwgYmUgc2V0IHVwXHJcbiAgICAgICAgaWYgKHNraXBIYW5kbGVyU2V0dXApIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tTdGFuZGFyZFBkZkNvbnZlcnRlcl0gU2tpcHBpbmcgaGFuZGxlciBzZXR1cCAoc2tpcEhhbmRsZXJTZXR1cD10cnVlKScpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIC8vIEluc3RlYWQgb2YgZGVsYXlpbmcgc2V0dXBJcGNIYW5kbGVycyB0aHJvdWdoIEJhc2VTZXJ2aWNlICh3aGljaCBpcyBjYXVzaW5nIGR1cGxpY2F0ZSByZWdpc3RyYXRpb25zKSxcclxuICAgICAgICAgICAgLy8gd2UnbGwgZW5zdXJlIHdlIG9ubHkgc2V0IHVwIGhhbmRsZXJzIGV4cGxpY2l0bHkgd2hlbiBza2lwSGFuZGxlclNldHVwIGlzIGZhbHNlXHJcbiAgICAgICAgICAgIC8vIFRoaXMgd2lsbCBvdmVycmlkZSBCYXNlU2VydmljZSdzIHNldFRpbWVvdXQgYXBwcm9hY2hcclxuICAgICAgICAgICAgdGhpcy5zZXR1cElwY0hhbmRsZXJzKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogU2V0IHVwIElQQyBoYW5kbGVycyBmb3IgUERGIGNvbnZlcnNpb25cclxuICAgICAqL1xyXG4gICAgc2V0dXBJcGNIYW5kbGVycygpIHtcclxuICAgICAgICAvLyBJZiBza2lwSGFuZGxlclNldHVwIHdhcyBzcGVjaWZpZWQsIGRvbid0IHJlZ2lzdGVyIGhhbmRsZXJzXHJcbiAgICAgICAgaWYgKHRoaXMuc2tpcEhhbmRsZXJTZXR1cCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW1N0YW5kYXJkUGRmQ29udmVydGVyXSBTa2lwcGluZyBJUEMgaGFuZGxlciBzZXR1cCBkdWUgdG8gc2tpcEhhbmRsZXJTZXR1cCBmbGFnJyk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFVzZSB0cnktY2F0Y2ggdG8gaGFuZGxlIGNhc2VzIHdoZXJlIGhhbmRsZXJzIGFyZSBhbHJlYWR5IHJlZ2lzdGVyZWRcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpwZGY6c3RhbmRhcmQnLCB0aGlzLmhhbmRsZUNvbnZlcnQuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnBkZjpzdGFuZGFyZDptZXRhZGF0YScsIHRoaXMuaGFuZGxlR2V0TWV0YWRhdGEuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnBkZjpzdGFuZGFyZDp0aHVtYm5haWwnLCB0aGlzLmhhbmRsZUdlbmVyYXRlVGh1bWJuYWlsLmJpbmQodGhpcykpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIC8vIElmIGEgaGFuZGxlciBpcyBhbHJlYWR5IHJlZ2lzdGVyZWQsIGxvZyB0aGUgZXJyb3IgYnV0IGRvbid0IGNyYXNoXHJcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgW1N0YW5kYXJkUGRmQ29udmVydGVyXSBFcnJvciBpbiBzZXR1cElwY0hhbmRsZXJzOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIFBERiBjb252ZXJzaW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb252ZXJzaW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDb252ZXJ0KGV2ZW50LCB7IGZpbGVQYXRoLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb25JZCA9IHRoaXMuZ2VuZXJhdGVDb252ZXJzaW9uSWQoKTtcclxuICAgICAgICAgICAgY29uc3Qgd2luZG93ID0gZXZlbnQ/LnNlbmRlcj8uZ2V0T3duZXJCcm93c2VyV2luZG93Py4oKSB8fCBudWxsO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ3JlYXRlIHRlbXAgZGlyZWN0b3J5IGZvciB0aGlzIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IHRoaXMuZmlsZVN0b3JhZ2UuY3JlYXRlVGVtcERpcigncGRmX2NvbnZlcnNpb24nKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2V0KGNvbnZlcnNpb25JZCwge1xyXG4gICAgICAgICAgICAgICAgaWQ6IGNvbnZlcnNpb25JZCxcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3N0YXJ0aW5nJyxcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAwLFxyXG4gICAgICAgICAgICAgICAgZmlsZVBhdGgsXHJcbiAgICAgICAgICAgICAgICB0ZW1wRGlyLFxyXG4gICAgICAgICAgICAgICAgd2luZG93XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgLy8gTm90aWZ5IGNsaWVudCB0aGF0IGNvbnZlcnNpb24gaGFzIHN0YXJ0ZWQgKG9ubHkgaWYgd2UgaGF2ZSBhIHZhbGlkIHdpbmRvdylcclxuICAgICAgICAgICAgaWYgKHdpbmRvdyAmJiB3aW5kb3cud2ViQ29udGVudHMpIHtcclxuICAgICAgICAgICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwZGY6Y29udmVyc2lvbi1zdGFydGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIFN0YXJ0IGNvbnZlcnNpb24gcHJvY2Vzc1xyXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgZmlsZVBhdGgsIG9wdGlvbnMpLmNhdGNoKGVycm9yID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtTdGFuZGFyZFBkZkNvbnZlcnRlcl0gQ29udmVyc2lvbiBmYWlsZWQgZm9yICR7Y29udmVyc2lvbklkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZmFpbGVkJywgeyBlcnJvcjogZXJyb3IubWVzc2FnZSB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgIGZzLnJlbW92ZSh0ZW1wRGlyKS5jYXRjaChlcnIgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtTdGFuZGFyZFBkZkNvbnZlcnRlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIHRlbXAgZGlyZWN0b3J5OiAke3RlbXBEaXJ9YCwgZXJyKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnZlcnNpb25JZCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tTdGFuZGFyZFBkZkNvbnZlcnRlcl0gRmFpbGVkIHRvIHN0YXJ0IGNvbnZlcnNpb246JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgUERGIG1ldGFkYXRhIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBNZXRhZGF0YSByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlR2V0TWV0YWRhdGEoZXZlbnQsIHsgZmlsZVBhdGggfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgdGhpcy5leHRyYWN0TWV0YWRhdGEoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICByZXR1cm4gbWV0YWRhdGE7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1N0YW5kYXJkUGRmQ29udmVydGVyXSBGYWlsZWQgdG8gZ2V0IG1ldGFkYXRhOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIFBERiB0aHVtYm5haWwgZ2VuZXJhdGlvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gVGh1bWJuYWlsIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVHZW5lcmF0ZVRodW1ibmFpbChldmVudCwgeyBmaWxlUGF0aCwgcGFnZU51bWJlciA9IDEsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtTdGFuZGFyZFBkZkNvbnZlcnRlcl0gVGh1bWJuYWlsIGdlbmVyYXRpb24gZGlzYWJsZWQgZm9yIHBhZ2UgJHtwYWdlTnVtYmVyfWApO1xyXG4gICAgICAgIC8vIFJldHVybiBhIHBsYWNlaG9sZGVyIHJlc3BvbnNlIHNpbmNlIHRodW1ibmFpbHMgYXJlIG5vdCBnZW5lcmF0ZWRcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBkYXRhOiAnJyxcclxuICAgICAgICAgICAgcGFnZU51bWJlcixcclxuICAgICAgICAgICAgZGlzYWJsZWQ6IHRydWVcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUHJvY2VzcyBQREYgY29udmVyc2lvblxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBQREYgZmlsZVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgcHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCBmaWxlUGF0aCwgb3B0aW9ucykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgICAgICBpZiAoIWNvbnZlcnNpb24pIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVyc2lvbiBub3QgZm91bmQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGNvbnZlcnNpb24udGVtcERpcjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgbWV0YWRhdGFcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2V4dHJhY3RpbmdfbWV0YWRhdGEnLCB7IHByb2dyZXNzOiA1IH0pO1xyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHRoaXMuZXh0cmFjdE1ldGFkYXRhKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgdGV4dFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZXh0cmFjdGluZ190ZXh0JywgeyBwcm9ncmVzczogMTAgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBkZkRhdGEgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBkZkNvbnRlbnQgPSBhd2FpdCBwZGZQYXJzZShwZGZEYXRhKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFByb2Nlc3MgcGFnZXNcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ3Byb2Nlc3NpbmdfcGFnZXMnLCB7IHByb2dyZXNzOiAzMCB9KTtcclxuICAgICAgICAgICAgY29uc3QgbWF4UGFnZXMgPSBvcHRpb25zLm1heFBhZ2VzIHx8IG1ldGFkYXRhLnBhZ2VDb3VudDtcclxuICAgICAgICAgICAgY29uc3QgcGFnZXMgPSBhd2FpdCB0aGlzLmV4dHJhY3RQYWdlcyhmaWxlUGF0aCwgcGRmQ29udGVudCwgTWF0aC5taW4obWF4UGFnZXMsIG1ldGFkYXRhLnBhZ2VDb3VudCkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgdGh1bWJuYWlscyBpZiByZXF1ZXN0ZWRcclxuICAgICAgICAgICAgbGV0IHRodW1ibmFpbHMgPSBbXTtcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZUltYWdlcykge1xyXG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2dlbmVyYXRpbmdfdGh1bWJuYWlscycsIHsgcHJvZ3Jlc3M6IDUwIH0pO1xyXG4gICAgICAgICAgICAgICAgdGh1bWJuYWlscyA9IGF3YWl0IHRoaXMuZ2VuZXJhdGVUaHVtYm5haWxzKGZpbGVQYXRoLCB0ZW1wRGlyLCBNYXRoLm1pbihtYXhQYWdlcywgbWV0YWRhdGEucGFnZUNvdW50KSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdnZW5lcmF0aW5nX21hcmtkb3duJywgeyBwcm9ncmVzczogODAgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duID0gdGhpcy5nZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCBwYWdlcywgdGh1bWJuYWlscywgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnY29tcGxldGVkJywgeyBcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAxMDAsXHJcbiAgICAgICAgICAgICAgICByZXN1bHQ6IG1hcmtkb3duXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIG1hcmtkb3duO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tTdGFuZGFyZFBkZkNvbnZlcnRlcl0gQ29udmVyc2lvbiBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEV4dHJhY3QgbWV0YWRhdGEgZnJvbSBQREYgZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBQREYgZmlsZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gUERGIG1ldGFkYXRhXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGV4dHJhY3RNZXRhZGF0YShmaWxlUGF0aCkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHBkZkRhdGEgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBkZkRvYyA9IGF3YWl0IFBERkRvY3VtZW50LmxvYWQocGRmRGF0YSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBkZkNvbnRlbnQgPSBhd2FpdCBwZGZQYXJzZShwZGZEYXRhKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IG1ldGFkYXRhXHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0ge1xyXG4gICAgICAgICAgICAgICAgZmlsZW5hbWU6IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpLFxyXG4gICAgICAgICAgICAgICAgcGFnZUNvdW50OiBwZGZEb2MuZ2V0UGFnZUNvdW50KCksXHJcbiAgICAgICAgICAgICAgICBmaWxlU2l6ZTogc3RhdHMuc2l6ZSxcclxuICAgICAgICAgICAgICAgIC4uLnBkZkNvbnRlbnQuaW5mb1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRm9ybWF0IGRhdGVzXHJcbiAgICAgICAgICAgIGlmIChtZXRhZGF0YS5DcmVhdGlvbkRhdGUpIHtcclxuICAgICAgICAgICAgICAgIG1ldGFkYXRhLmNyZWF0aW9uRGF0ZSA9IHRoaXMuZm9ybWF0UGRmRGF0ZShtZXRhZGF0YS5DcmVhdGlvbkRhdGUpO1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIG1ldGFkYXRhLkNyZWF0aW9uRGF0ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKG1ldGFkYXRhLk1vZERhdGUpIHtcclxuICAgICAgICAgICAgICAgIG1ldGFkYXRhLm1vZGlmaWNhdGlvbkRhdGUgPSB0aGlzLmZvcm1hdFBkZkRhdGUobWV0YWRhdGEuTW9kRGF0ZSk7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgbWV0YWRhdGEuTW9kRGF0ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gUmVuYW1lIHN0YW5kYXJkIGZpZWxkc1xyXG4gICAgICAgICAgICBpZiAobWV0YWRhdGEuQXV0aG9yKSB7XHJcbiAgICAgICAgICAgICAgICBtZXRhZGF0YS5hdXRob3IgPSBtZXRhZGF0YS5BdXRob3I7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgbWV0YWRhdGEuQXV0aG9yO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAobWV0YWRhdGEuVGl0bGUpIHtcclxuICAgICAgICAgICAgICAgIG1ldGFkYXRhLnRpdGxlID0gbWV0YWRhdGEuVGl0bGU7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgbWV0YWRhdGEuVGl0bGU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChtZXRhZGF0YS5TdWJqZWN0KSB7XHJcbiAgICAgICAgICAgICAgICBtZXRhZGF0YS5zdWJqZWN0ID0gbWV0YWRhdGEuU3ViamVjdDtcclxuICAgICAgICAgICAgICAgIGRlbGV0ZSBtZXRhZGF0YS5TdWJqZWN0O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAobWV0YWRhdGEuS2V5d29yZHMpIHtcclxuICAgICAgICAgICAgICAgIG1ldGFkYXRhLmtleXdvcmRzID0gbWV0YWRhdGEuS2V5d29yZHM7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgbWV0YWRhdGEuS2V5d29yZHM7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChtZXRhZGF0YS5DcmVhdG9yKSB7XHJcbiAgICAgICAgICAgICAgICBtZXRhZGF0YS5jcmVhdG9yID0gbWV0YWRhdGEuQ3JlYXRvcjtcclxuICAgICAgICAgICAgICAgIGRlbGV0ZSBtZXRhZGF0YS5DcmVhdG9yO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAobWV0YWRhdGEuUHJvZHVjZXIpIHtcclxuICAgICAgICAgICAgICAgIG1ldGFkYXRhLnByb2R1Y2VyID0gbWV0YWRhdGEuUHJvZHVjZXI7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgbWV0YWRhdGEuUHJvZHVjZXI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiBtZXRhZGF0YTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbU3RhbmRhcmRQZGZDb252ZXJ0ZXJdIEZhaWxlZCB0byBleHRyYWN0IG1ldGFkYXRhOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRm9ybWF0IFBERiBkYXRlIHN0cmluZ1xyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGVTdHJpbmcgLSBQREYgZGF0ZSBzdHJpbmdcclxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IEZvcm1hdHRlZCBkYXRlXHJcbiAgICAgKi9cclxuICAgIGZvcm1hdFBkZkRhdGUoZGF0ZVN0cmluZykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIFBERiBkYXRlcyBjYW4gYmUgaW4gZm9ybWF0OiBEOllZWVlNTURESEhtbVNTT0hIJ21tJ1xyXG4gICAgICAgICAgICBpZiAoZGF0ZVN0cmluZy5zdGFydHNXaXRoKCdEOicpKSB7XHJcbiAgICAgICAgICAgICAgICBkYXRlU3RyaW5nID0gZGF0ZVN0cmluZy5zdWJzdHJpbmcoMik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFRyeSB0byBwYXJzZSB0aGUgZGF0ZVxyXG4gICAgICAgICAgICBjb25zdCB5ZWFyID0gZGF0ZVN0cmluZy5zdWJzdHJpbmcoMCwgNCk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1vbnRoID0gZGF0ZVN0cmluZy5zdWJzdHJpbmcoNCwgNik7XHJcbiAgICAgICAgICAgIGNvbnN0IGRheSA9IGRhdGVTdHJpbmcuc3Vic3RyaW5nKDYsIDgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIGAke3llYXJ9LSR7bW9udGh9LSR7ZGF5fWA7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGRhdGVTdHJpbmc7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRXh0cmFjdCBwYWdlcyBmcm9tIFBERiBjb250ZW50XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIFBERiBmaWxlXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcGRmQ29udGVudCAtIFBERiBjb250ZW50IGZyb20gcGRmLXBhcnNlXHJcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbWF4UGFnZXMgLSBNYXhpbXVtIHBhZ2VzIHRvIGV4dHJhY3RcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5Pn0gQXJyYXkgb2YgcGFnZSBvYmplY3RzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGV4dHJhY3RQYWdlcyhmaWxlUGF0aCwgcGRmQ29udGVudCwgbWF4UGFnZXMpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBwZGZEYXRhID0gYXdhaXQgZnMucmVhZEZpbGUoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICBjb25zdCBwZGZEb2MgPSBhd2FpdCBQREZEb2N1bWVudC5sb2FkKHBkZkRhdGEpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgcGFnZXMgPSBbXTtcclxuICAgICAgICAgICAgY29uc3QgdG90YWxQYWdlcyA9IHBkZkRvYy5nZXRQYWdlQ291bnQoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFNwbGl0IHRleHQgaW50byBwYWdlcyAocGRmLXBhcnNlIGdpdmVzIHVzIGFsbCB0ZXh0KVxyXG4gICAgICAgICAgICAvLyBUaGlzIGlzIGEgc2ltcGxlIGFwcHJvYWNoIGFuZCBtaWdodCBub3QgYmUgcGVyZmVjdFxyXG4gICAgICAgICAgICBjb25zdCB0ZXh0UGVyUGFnZSA9IE1hdGguY2VpbChwZGZDb250ZW50LnRleHQubGVuZ3RoIC8gdG90YWxQYWdlcyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IE1hdGgubWluKHRvdGFsUGFnZXMsIG1heFBhZ2VzKTsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBwYWdlID0gcGRmRG9jLmdldFBhZ2UoaSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB7IHdpZHRoLCBoZWlnaHQgfSA9IHBhZ2UuZ2V0U2l6ZSgpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zdCBzdGFydEluZGV4ID0gaSAqIHRleHRQZXJQYWdlO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZW5kSW5kZXggPSBNYXRoLm1pbigoaSArIDEpICogdGV4dFBlclBhZ2UsIHBkZkNvbnRlbnQudGV4dC5sZW5ndGgpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgdGV4dCA9IHBkZkNvbnRlbnQudGV4dC5zdWJzdHJpbmcoc3RhcnRJbmRleCwgZW5kSW5kZXgpLnRyaW0oKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgcGFnZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgcGFnZU51bWJlcjogaSArIDEsXHJcbiAgICAgICAgICAgICAgICAgICAgd2lkdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgaGVpZ2h0LFxyXG4gICAgICAgICAgICAgICAgICAgIHRleHRcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gcGFnZXM7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1N0YW5kYXJkUGRmQ29udmVydGVyXSBGYWlsZWQgdG8gZXh0cmFjdCBwYWdlczonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIHRodW1ibmFpbHMgZm9yIFBERiBwYWdlc1xyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBQREYgZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IG91dHB1dERpciAtIE91dHB1dCBkaXJlY3RvcnlcclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBwYWdlQ291bnQgLSBOdW1iZXIgb2YgcGFnZXNcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5Pn0gQXJyYXkgb2YgdGh1bWJuYWlsIGluZm8gb2JqZWN0c1xyXG4gICAgICovXHJcbiAgICBhc3luYyBnZW5lcmF0ZVRodW1ibmFpbHMoZmlsZVBhdGgsIG91dHB1dERpciwgcGFnZUNvdW50KSB7XHJcbiAgICAgICAgLy8gVGhpcyBmdW5jdGlvbmFsaXR5IGhhcyBiZWVuIHJlbW92ZWQgdG8gZWxpbWluYXRlIHRoZSBjYW52YXMgZGVwZW5kZW5jeVxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbU3RhbmRhcmRQZGZDb252ZXJ0ZXJdIFRodW1ibmFpbCBnZW5lcmF0aW9uIGRpc2FibGVkYCk7XHJcbiAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgYSBzaW5nbGUgcGFnZSB0aHVtYm5haWxcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gUERGIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBvdXRwdXRQYXRoIC0gT3V0cHV0IHBhdGggZm9yIHRodW1ibmFpbFxyXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHBhZ2VOdW1iZXIgLSBQYWdlIG51bWJlclxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBUaHVtYm5haWwgb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGdlbmVyYXRlUGFnZVRodW1ibmFpbChmaWxlUGF0aCwgb3V0cHV0UGF0aCwgcGFnZU51bWJlciwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICAgICAgLy8gVGhpcyBmdW5jdGlvbmFsaXR5IGhhcyBiZWVuIHJlbW92ZWQgdG8gZWxpbWluYXRlIHRoZSBjYW52YXMgZGVwZW5kZW5jeVxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbU3RhbmRhcmRQZGZDb252ZXJ0ZXJdIFRodW1ibmFpbCBnZW5lcmF0aW9uIGRpc2FibGVkIGZvciBwYWdlICR7cGFnZU51bWJlcn1gKTtcclxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSBtYXJrZG93biBmcm9tIFBERiBtZXRhZGF0YSBhbmQgcGFnZXNcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBtZXRhZGF0YSAtIFBERiBtZXRhZGF0YVxyXG4gICAgICogQHBhcmFtIHtBcnJheX0gcGFnZXMgLSBBcnJheSBvZiBwYWdlIG9iamVjdHNcclxuICAgICAqIEBwYXJhbSB7QXJyYXl9IHRodW1ibmFpbHMgLSBBcnJheSBvZiB0aHVtYm5haWwgaW5mbyBvYmplY3RzIChhbHdheXMgZW1wdHkgbm93IHRoYXQgdGh1bWJuYWlsIGdlbmVyYXRpb24gaXMgZGlzYWJsZWQpXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gTWFya2Rvd24gY29udGVudFxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCBwYWdlcywgdGh1bWJuYWlscywgb3B0aW9ucykge1xyXG4gICAgICAgIC8vIFN0YXJ0IHdpdGggZW1wdHkgbWFya2Rvd24gYXJyYXkgKG5vIGhlYWRlciAtIGhhbmRsZWQgYnkgc3RhbmRhcmRpemVkIGZyb250bWF0dGVyKVxyXG4gICAgICAgIGNvbnN0IG1hcmtkb3duID0gW107XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIGNvbnRlbnQgZm9yIGVhY2ggcGFnZVxyXG4gICAgICAgIHBhZ2VzLmZvckVhY2goKHBhZ2UpID0+IHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIyMgUGFnZSAke3BhZ2UucGFnZU51bWJlcn1gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBObyB0aHVtYm5haWxzIGFyZSBhZGRlZCBzaW5jZSB0aHVtYm5haWwgZ2VuZXJhdGlvbiBpcyBkaXNhYmxlZFxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIHBhZ2UgdGV4dFxyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKHBhZ2UudGV4dCk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBtYXJrZG93bi5qb2luKCdcXG4nKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENvbnZlcnQgUERGIGNvbnRlbnQgdG8gbWFya2Rvd24gLSBkaXJlY3QgbWV0aG9kIGZvciBDb252ZXJ0ZXJSZWdpc3RyeVxyXG4gICAgICogQHBhcmFtIHtCdWZmZXJ9IGNvbnRlbnQgLSBQREYgY29udGVudCBhcyBidWZmZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gRmlsZSBuYW1lXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gYXBpS2V5IC0gQVBJIGtleSAobm90IHVzZWQgZm9yIHN0YW5kYXJkIGNvbnZlcnNpb24pXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gQ29udmVyc2lvbiByZXN1bHRcclxuICAgICAqL1xyXG4gICAgYXN5bmMgY29udmVydFRvTWFya2Rvd24oY29udGVudCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtTdGFuZGFyZFBkZkNvbnZlcnRlcl0gQ29udmVydGluZyBQREY6ICR7b3B0aW9ucy5uYW1lIHx8ICd1bm5hbWVkJ31gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBmaWxlIHRvIHByb2Nlc3NcclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IGZzLm1rZHRlbXAocGF0aC5qb2luKHJlcXVpcmUoJ29zJykudG1wZGlyKCksICdwZGYtY29udmVyc2lvbi0nKSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBGaWxlID0gcGF0aC5qb2luKHRlbXBEaXIsIGAke29wdGlvbnMubmFtZSB8fCAnZG9jdW1lbnQnfS5wZGZgKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFdyaXRlIGJ1ZmZlciB0byB0ZW1wIGZpbGVcclxuICAgICAgICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKHRlbXBGaWxlLCBjb250ZW50KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgbWV0YWRhdGFcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB0aGlzLmV4dHJhY3RNZXRhZGF0YSh0ZW1wRmlsZSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IHRleHRcclxuICAgICAgICAgICAgY29uc3QgcGRmQ29udGVudCA9IGF3YWl0IHBkZlBhcnNlKGNvbnRlbnQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gUHJvY2VzcyBwYWdlc1xyXG4gICAgICAgICAgICBjb25zdCBtYXhQYWdlcyA9IG9wdGlvbnMubWF4UGFnZXMgfHwgbWV0YWRhdGEucGFnZUNvdW50O1xyXG4gICAgICAgICAgICBjb25zdCBwYWdlcyA9IGF3YWl0IHRoaXMuZXh0cmFjdFBhZ2VzKHRlbXBGaWxlLCBwZGZDb250ZW50LCBNYXRoLm1pbihtYXhQYWdlcywgbWV0YWRhdGEucGFnZUNvdW50KSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSB0aHVtYm5haWxzIGlmIHJlcXVlc3RlZFxyXG4gICAgICAgICAgICBsZXQgdGh1bWJuYWlscyA9IFtdO1xyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy5pbmNsdWRlSW1hZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW1N0YW5kYXJkUGRmQ29udmVydGVyXSBHZW5lcmF0aW5nIHRodW1ibmFpbHMgZm9yIGRpcmVjdCBjb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB0ZW1wSW1hZ2VzRGlyID0gcGF0aC5qb2luKHRlbXBEaXIsICd0aHVtYm5haWxzJyk7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBmcy5ta2Rpcih0ZW1wSW1hZ2VzRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcclxuICAgICAgICAgICAgICAgIHRodW1ibmFpbHMgPSBhd2FpdCB0aGlzLmdlbmVyYXRlVGh1bWJuYWlscyh0ZW1wRmlsZSwgdGVtcEltYWdlc0RpciwgTWF0aC5taW4obWF4UGFnZXMsIG1ldGFkYXRhLnBhZ2VDb3VudCkpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZXQgdGhlIHRpdGxlIGZyb20gbWV0YWRhdGEgb3IgZmlsZW5hbWUgLSBjbGVhbiB0aGUgZmlsZW5hbWUgdG8gcmVtb3ZlIC5wZGYgZXh0ZW5zaW9uXHJcbiAgICAgICAgICAgIGNvbnN0IGNsZWFuRmlsZU5hbWUgPSBvcHRpb25zLm5hbWUgPyBvcHRpb25zLm5hbWUucmVwbGFjZSgvXFwucGRmJC9pLCAnJykgOiAnUERGIERvY3VtZW50JztcclxuICAgICAgICAgICAgY29uc3QgZmlsZVRpdGxlID0gbWV0YWRhdGEudGl0bGUgfHwgY2xlYW5GaWxlTmFtZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgZnJvbnRtYXR0ZXIgdXNpbmcgbWV0YWRhdGEgdXRpbGl0eVxyXG4gICAgICAgICAgICBjb25zdCB7IGNyZWF0ZVN0YW5kYXJkRnJvbnRtYXR0ZXIgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL2NvbnZlcnRlcnMvdXRpbHMvbWV0YWRhdGEnKTtcclxuICAgICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBjcmVhdGVTdGFuZGFyZEZyb250bWF0dGVyKHtcclxuICAgICAgICAgICAgICAgIHRpdGxlOiBmaWxlVGl0bGUsXHJcbiAgICAgICAgICAgICAgICBmaWxlVHlwZTogJ3BkZidcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBtYXJrZG93biBjb250ZW50XHJcbiAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duQ29udGVudCA9IHRoaXMuZ2VuZXJhdGVNYXJrZG93bihtZXRhZGF0YSwgcGFnZXMsIHRodW1ibmFpbHMsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ29tYmluZSBmcm9udG1hdHRlciBhbmQgY29udGVudFxyXG4gICAgICAgICAgICBjb25zdCBmaW5hbE1hcmtkb3duID0gZnJvbnRtYXR0ZXIgKyBtYXJrZG93bkNvbnRlbnQ7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIGNvbnRlbnQ6IGZpbmFsTWFya2Rvd25cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbU3RhbmRhcmRQZGZDb252ZXJ0ZXJdIERpcmVjdCBjb252ZXJzaW9uIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGVycm9yOiBgUERGIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCxcclxuICAgICAgICAgICAgICAgIGNvbnRlbnQ6IGAjIENvbnZlcnNpb24gRXJyb3JcXG5cXG5GYWlsZWQgdG8gY29udmVydCBQREY6ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGNvbnZlcnRlciBpbmZvcm1hdGlvblxyXG4gICAgICogQHJldHVybnMge09iamVjdH0gQ29udmVydGVyIGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgZ2V0SW5mbygpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBuYW1lOiB0aGlzLm5hbWUsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbnM6IHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyxcclxuICAgICAgICAgICAgZGVzY3JpcHRpb246IHRoaXMuZGVzY3JpcHRpb24sXHJcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICAgIHRpdGxlOiAnT3B0aW9uYWwgZG9jdW1lbnQgdGl0bGUnLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZUltYWdlczogJ1doZXRoZXIgdG8gaW5jbHVkZSBwYWdlIGltYWdlcyAoZGVmYXVsdDogZmFsc2UpJyxcclxuICAgICAgICAgICAgICAgIG1heFBhZ2VzOiAnTWF4aW11bSBwYWdlcyB0byBjb252ZXJ0IChkZWZhdWx0OiBhbGwpJ1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBTdGFuZGFyZFBkZkNvbnZlcnRlcjtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDOUIsTUFBTTtFQUFFRTtBQUFZLENBQUMsR0FBR0YsT0FBTyxDQUFDLFNBQVMsQ0FBQztBQUMxQyxNQUFNRyxRQUFRLEdBQUdILE9BQU8sQ0FBQyxXQUFXLENBQUM7QUFDckMsTUFBTTtFQUFFSSxFQUFFLEVBQUVDO0FBQU8sQ0FBQyxHQUFHTCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQ3RDLE1BQU1NLGdCQUFnQixHQUFHTixPQUFPLENBQUMsb0JBQW9CLENBQUM7QUFFdEQsTUFBTU8sb0JBQW9CLFNBQVNELGdCQUFnQixDQUFDO0VBQ2hERSxXQUFXQSxDQUFDQyxhQUFhLEVBQUVDLFdBQVcsRUFBRUMsZ0JBQWdCLEdBQUcsS0FBSyxFQUFFO0lBQzlELEtBQUssQ0FBQ0YsYUFBYSxFQUFFQyxXQUFXLENBQUM7SUFDakMsSUFBSSxDQUFDRSxJQUFJLEdBQUcsd0JBQXdCO0lBQ3BDLElBQUksQ0FBQ0MsV0FBVyxHQUFHLCtEQUErRDtJQUNsRixJQUFJLENBQUNGLGdCQUFnQixHQUFHQSxnQkFBZ0I7O0lBRXhDO0lBQ0EsSUFBSUEsZ0JBQWdCLEVBQUU7TUFDbEJHLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHVFQUF1RSxDQUFDO0lBQ3hGLENBQUMsTUFBTTtNQUNIO01BQ0E7TUFDQTtNQUNBLElBQUksQ0FB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