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
      const window = event.sender.getOwnerBrowserWindow();

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

      // Notify client that conversion has started
      window.webContents.send('pdf:conversion-started', {
        conversionId
      });

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
    // Start with header
    const markdown = this.generateMarkdownHeader(metadata, options);

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

      // Get current datetime
      const now = new Date();
      const convertedDate = now.toISOString().split('.')[0].replace('T', ' ');

      // Get the title from metadata or filename
      const fileTitle = metadata.title || options.name || 'PDF Document';

      // Create standardized frontmatter
      const frontmatter = ['---', `title: ${fileTitle}`, `converted: ${convertedDate}`, 'type: pdf', '---', ''].join('\n');

      // Generate markdown content
      const markdownContent = this.generateMarkdown(metadata, pages, thumbnails, options);

      // Combine frontmatter and content
      const finalMarkdown = frontmatter + markdownContent;

      // Clean up temp directory
      await fs.remove(tempDir);
      return {
        success: true,
        content: finalMarkdown,
        type: 'pdf',
        name: options.name || 'document.pdf',
        metadata: metadata
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiUERGRG9jdW1lbnQiLCJwZGZQYXJzZSIsInY0IiwidXVpZHY0IiwiQmFzZVBkZkNvbnZlcnRlciIsIlN0YW5kYXJkUGRmQ29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJza2lwSGFuZGxlclNldHVwIiwibmFtZSIsImRlc2NyaXB0aW9uIiwiY29uc29sZSIsImxvZyIsInNldHVwSXBjSGFuZGxlcnMiLCJyZWdpc3RlckhhbmRsZXIiLCJoYW5kbGVDb252ZXJ0IiwiYmluZCIsImhhbmRsZUdldE1ldGFkYXRhIiwiaGFuZGxlR2VuZXJhdGVUaHVtYm5haWwiLCJlcnJvciIsIndhcm4iLCJtZXNzYWdlIiwiZXZlbnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJjb252ZXJzaW9uSWQiLCJnZW5lcmF0ZUNvbnZlcnNpb25JZCIsIndpbmRvdyIsInNlbmRlciIsImdldE93bmVyQnJvd3NlcldpbmRvdyIsInRlbXBEaXIiLCJjcmVhdGVUZW1wRGlyIiwiYWN0aXZlQ29udmVyc2lvbnMiLCJzZXQiLCJpZCIsInN0YXR1cyIsInByb2dyZXNzIiwid2ViQ29udGVudHMiLCJzZW5kIiwicHJvY2Vzc0NvbnZlcnNpb24iLCJjYXRjaCIsInVwZGF0ZUNvbnZlcnNpb25TdGF0dXMiLCJyZW1vdmUiLCJlcnIiLCJtZXRhZGF0YSIsImV4dHJhY3RNZXRhZGF0YSIsInBhZ2VOdW1iZXIiLCJkYXRhIiwiZGlzYWJsZWQiLCJjb252ZXJzaW9uIiwiZ2V0IiwiRXJyb3IiLCJwZGZEYXRhIiwicmVhZEZpbGUiLCJwZGZDb250ZW50IiwibWF4UGFnZXMiLCJwYWdlQ291bnQiLCJwYWdlcyIsImV4dHJhY3RQYWdlcyIsIk1hdGgiLCJtaW4iLCJ0aHVtYm5haWxzIiwiaW5jbHVkZUltYWdlcyIsImdlbmVyYXRlVGh1bWJuYWlscyIsIm1hcmtkb3duIiwiZ2VuZXJhdGVNYXJrZG93biIsInJlc3VsdCIsInBkZkRvYyIsImxvYWQiLCJzdGF0cyIsInN0YXQiLCJmaWxlbmFtZSIsImJhc2VuYW1lIiwiZ2V0UGFnZUNvdW50IiwiZmlsZVNpemUiLCJzaXplIiwiaW5mbyIsIkNyZWF0aW9uRGF0ZSIsImNyZWF0aW9uRGF0ZSIsImZvcm1hdFBkZkRhdGUiLCJNb2REYXRlIiwibW9kaWZpY2F0aW9uRGF0ZSIsIkF1dGhvciIsImF1dGhvciIsIlRpdGxlIiwidGl0bGUiLCJTdWJqZWN0Iiwic3ViamVjdCIsIktleXdvcmRzIiwia2V5d29yZHMiLCJDcmVhdG9yIiwiY3JlYXRvciIsIlByb2R1Y2VyIiwicHJvZHVjZXIiLCJkYXRlU3RyaW5nIiwic3RhcnRzV2l0aCIsInN1YnN0cmluZyIsInllYXIiLCJtb250aCIsImRheSIsInRvdGFsUGFnZXMiLCJ0ZXh0UGVyUGFnZSIsImNlaWwiLCJ0ZXh0IiwibGVuZ3RoIiwiaSIsInBhZ2UiLCJnZXRQYWdlIiwid2lkdGgiLCJoZWlnaHQiLCJnZXRTaXplIiwic3RhcnRJbmRleCIsImVuZEluZGV4IiwidHJpbSIsInB1c2giLCJvdXRwdXREaXIiLCJnZW5lcmF0ZVBhZ2VUaHVtYm5haWwiLCJvdXRwdXRQYXRoIiwiUHJvbWlzZSIsInJlc29sdmUiLCJnZW5lcmF0ZU1hcmtkb3duSGVhZGVyIiwiZm9yRWFjaCIsImpvaW4iLCJjb252ZXJ0VG9NYXJrZG93biIsImNvbnRlbnQiLCJta2R0ZW1wIiwidG1wZGlyIiwidGVtcEZpbGUiLCJ3cml0ZUZpbGUiLCJ0ZW1wSW1hZ2VzRGlyIiwibWtkaXIiLCJyZWN1cnNpdmUiLCJub3ciLCJEYXRlIiwiY29udmVydGVkRGF0ZSIsInRvSVNPU3RyaW5nIiwic3BsaXQiLCJyZXBsYWNlIiwiZmlsZVRpdGxlIiwiZnJvbnRtYXR0ZXIiLCJtYXJrZG93bkNvbnRlbnQiLCJmaW5hbE1hcmtkb3duIiwic3VjY2VzcyIsInR5cGUiLCJnZXRJbmZvIiwiZXh0ZW5zaW9ucyIsInN1cHBvcnRlZEV4dGVuc2lvbnMiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vZG9jdW1lbnQvU3RhbmRhcmRQZGZDb252ZXJ0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFN0YW5kYXJkUGRmQ29udmVydGVyLmpzXHJcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiBQREYgZmlsZXMgdG8gbWFya2Rvd24gdXNpbmcgc3RhbmRhcmQgdGV4dCBleHRyYWN0aW9uLlxyXG4gKiBcclxuICogVGhpcyBjb252ZXJ0ZXI6XHJcbiAqIC0gVXNlcyBwZGYtbGliIGFuZCBwZGYtcGFyc2UgZm9yIFBERiBwcm9jZXNzaW5nXHJcbiAqIC0gRXh0cmFjdHMgdGV4dCBhbmQgbWV0YWRhdGEgZnJvbSBQREYgZG9jdW1lbnRzXHJcbiAqIC0gR2VuZXJhdGVzIHBhZ2UgdGh1bWJuYWlscyB3aGVuIHJlcXVlc3RlZFxyXG4gKiAtIENyZWF0ZXMgc3RydWN0dXJlZCBtYXJrZG93biBvdXRwdXRcclxuICogXHJcbiAqIFJlbGF0ZWQgRmlsZXM6XHJcbiAqIC0gQmFzZVBkZkNvbnZlcnRlci5qczogUGFyZW50IGNsYXNzIHdpdGggY29tbW9uIFBERiBmdW5jdGlvbmFsaXR5XHJcbiAqIC0gTWlzdHJhbFBkZkNvbnZlcnRlci5qczogQWx0ZXJuYXRpdmUgT0NSLWJhc2VkIGNvbnZlcnRlclxyXG4gKiAtIEZpbGVTdG9yYWdlU2VydmljZS5qczogRm9yIHRlbXBvcmFyeSBmaWxlIG1hbmFnZW1lbnRcclxuICogLSBQZGZDb252ZXJ0ZXJGYWN0b3J5LmpzOiBGYWN0b3J5IGZvciBzZWxlY3RpbmcgYXBwcm9wcmlhdGUgY29udmVydGVyXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCB7IFBERkRvY3VtZW50IH0gPSByZXF1aXJlKCdwZGYtbGliJyk7XHJcbmNvbnN0IHBkZlBhcnNlID0gcmVxdWlyZSgncGRmLXBhcnNlJyk7XHJcbmNvbnN0IHsgdjQ6IHV1aWR2NCB9ID0gcmVxdWlyZSgndXVpZCcpO1xyXG5jb25zdCBCYXNlUGRmQ29udmVydGVyID0gcmVxdWlyZSgnLi9CYXNlUGRmQ29udmVydGVyJyk7XHJcblxyXG5jbGFzcyBTdGFuZGFyZFBkZkNvbnZlcnRlciBleHRlbmRzIEJhc2VQZGZDb252ZXJ0ZXIge1xyXG4gICAgY29uc3RydWN0b3IoZmlsZVByb2Nlc3NvciwgZmlsZVN0b3JhZ2UsIHNraXBIYW5kbGVyU2V0dXAgPSBmYWxzZSkge1xyXG4gICAgICAgIHN1cGVyKGZpbGVQcm9jZXNzb3IsIGZpbGVTdG9yYWdlKTtcclxuICAgICAgICB0aGlzLm5hbWUgPSAnU3RhbmRhcmQgUERGIENvbnZlcnRlcic7XHJcbiAgICAgICAgdGhpcy5kZXNjcmlwdGlvbiA9ICdDb252ZXJ0cyBQREYgZmlsZXMgdG8gbWFya2Rvd24gdXNpbmcgc3RhbmRhcmQgdGV4dCBleHRyYWN0aW9uJztcclxuICAgICAgICB0aGlzLnNraXBIYW5kbGVyU2V0dXAgPSBza2lwSGFuZGxlclNldHVwO1xyXG5cclxuICAgICAgICAvLyBMb2cgd2hldGhlciBoYW5kbGVycyB3aWxsIGJlIHNldCB1cFxyXG4gICAgICAgIGlmIChza2lwSGFuZGxlclNldHVwKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbU3RhbmRhcmRQZGZDb252ZXJ0ZXJdIFNraXBwaW5nIGhhbmRsZXIgc2V0dXAgKHNraXBIYW5kbGVyU2V0dXA9dHJ1ZSknKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAvLyBJbnN0ZWFkIG9mIGRlbGF5aW5nIHNldHVwSXBjSGFuZGxlcnMgdGhyb3VnaCBCYXNlU2VydmljZSAod2hpY2ggaXMgY2F1c2luZyBkdXBsaWNhdGUgcmVnaXN0cmF0aW9ucyksXHJcbiAgICAgICAgICAgIC8vIHdlJ2xsIGVuc3VyZSB3ZSBvbmx5IHNldCB1cCBoYW5kbGVycyBleHBsaWNpdGx5IHdoZW4gc2tpcEhhbmRsZXJTZXR1cCBpcyBmYWxzZVxyXG4gICAgICAgICAgICAvLyBUaGlzIHdpbGwgb3ZlcnJpZGUgQmFzZVNlcnZpY2UncyBzZXRUaW1lb3V0IGFwcHJvYWNoXHJcbiAgICAgICAgICAgIHRoaXMuc2V0dXBJcGNIYW5kbGVycygpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIFBERiBjb252ZXJzaW9uXHJcbiAgICAgKi9cclxuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgLy8gSWYgc2tpcEhhbmRsZXJTZXR1cCB3YXMgc3BlY2lmaWVkLCBkb24ndCByZWdpc3RlciBoYW5kbGVyc1xyXG4gICAgICAgIGlmICh0aGlzLnNraXBIYW5kbGVyU2V0dXApIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tTdGFuZGFyZFBkZkNvbnZlcnRlcl0gU2tpcHBpbmcgSVBDIGhhbmRsZXIgc2V0dXAgZHVlIHRvIHNraXBIYW5kbGVyU2V0dXAgZmxhZycpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBVc2UgdHJ5LWNhdGNoIHRvIGhhbmRsZSBjYXNlcyB3aGVyZSBoYW5kbGVycyBhcmUgYWxyZWFkeSByZWdpc3RlcmVkXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6cGRmOnN0YW5kYXJkJywgdGhpcy5oYW5kbGVDb252ZXJ0LmJpbmQodGhpcykpO1xyXG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpwZGY6c3RhbmRhcmQ6bWV0YWRhdGEnLCB0aGlzLmhhbmRsZUdldE1ldGFkYXRhLmJpbmQodGhpcykpO1xyXG4gICAgICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpwZGY6c3RhbmRhcmQ6dGh1bWJuYWlsJywgdGhpcy5oYW5kbGVHZW5lcmF0ZVRodW1ibmFpbC5iaW5kKHRoaXMpKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAvLyBJZiBhIGhhbmRsZXIgaXMgYWxyZWFkeSByZWdpc3RlcmVkLCBsb2cgdGhlIGVycm9yIGJ1dCBkb24ndCBjcmFzaFxyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYFtTdGFuZGFyZFBkZkNvbnZlcnRlcl0gRXJyb3IgaW4gc2V0dXBJcGNIYW5kbGVyczogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBQREYgY29udmVyc2lvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ29udmVyc2lvbiByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlQ29udmVydChldmVudCwgeyBmaWxlUGF0aCwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uSWQgPSB0aGlzLmdlbmVyYXRlQ29udmVyc2lvbklkKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHdpbmRvdyA9IGV2ZW50LnNlbmRlci5nZXRPd25lckJyb3dzZXJXaW5kb3coKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSB0ZW1wIGRpcmVjdG9yeSBmb3IgdGhpcyBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ3BkZl9jb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNldChjb252ZXJzaW9uSWQsIHtcclxuICAgICAgICAgICAgICAgIGlkOiBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdzdGFydGluZycsXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMCxcclxuICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxyXG4gICAgICAgICAgICAgICAgdGVtcERpcixcclxuICAgICAgICAgICAgICAgIHdpbmRvd1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIC8vIE5vdGlmeSBjbGllbnQgdGhhdCBjb252ZXJzaW9uIGhhcyBzdGFydGVkXHJcbiAgICAgICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwZGY6Y29udmVyc2lvbi1zdGFydGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBTdGFydCBjb252ZXJzaW9uIHByb2Nlc3NcclxuICAgICAgICAgICAgdGhpcy5wcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIGZpbGVQYXRoLCBvcHRpb25zKS5jYXRjaChlcnJvciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbU3RhbmRhcmRQZGZDb252ZXJ0ZXJdIENvbnZlcnNpb24gZmFpbGVkIGZvciAke2NvbnZlcnNpb25JZH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2ZhaWxlZCcsIHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICBmcy5yZW1vdmUodGVtcERpcikuY2F0Y2goZXJyID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbU3RhbmRhcmRQZGZDb252ZXJ0ZXJdIEZhaWxlZCB0byBjbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeTogJHt0ZW1wRGlyfWAsIGVycik7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4geyBjb252ZXJzaW9uSWQgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbU3RhbmRhcmRQZGZDb252ZXJ0ZXJdIEZhaWxlZCB0byBzdGFydCBjb252ZXJzaW9uOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIFBERiBtZXRhZGF0YSByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gTWV0YWRhdGEgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUdldE1ldGFkYXRhKGV2ZW50LCB7IGZpbGVQYXRoIH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHRoaXMuZXh0cmFjdE1ldGFkYXRhKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgcmV0dXJuIG1ldGFkYXRhO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tTdGFuZGFyZFBkZkNvbnZlcnRlcl0gRmFpbGVkIHRvIGdldCBtZXRhZGF0YTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBQREYgdGh1bWJuYWlsIGdlbmVyYXRpb24gcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFRodW1ibmFpbCByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlR2VuZXJhdGVUaHVtYm5haWwoZXZlbnQsIHsgZmlsZVBhdGgsIHBhZ2VOdW1iZXIgPSAxLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbU3RhbmRhcmRQZGZDb252ZXJ0ZXJdIFRodW1ibmFpbCBnZW5lcmF0aW9uIGRpc2FibGVkIGZvciBwYWdlICR7cGFnZU51bWJlcn1gKTtcclxuICAgICAgICAvLyBSZXR1cm4gYSBwbGFjZWhvbGRlciByZXNwb25zZSBzaW5jZSB0aHVtYm5haWxzIGFyZSBub3QgZ2VuZXJhdGVkXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgZGF0YTogJycsXHJcbiAgICAgICAgICAgIHBhZ2VOdW1iZXIsXHJcbiAgICAgICAgICAgIGRpc2FibGVkOiB0cnVlXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgUERGIGNvbnZlcnNpb25cclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIGlkZW50aWZpZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gUERGIGZpbGVcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgZmlsZVBhdGgsIG9wdGlvbnMpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcclxuICAgICAgICAgICAgaWYgKCFjb252ZXJzaW9uKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbnZlcnNpb24gbm90IGZvdW5kJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBjb252ZXJzaW9uLnRlbXBEaXI7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IG1ldGFkYXRhXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdleHRyYWN0aW5nX21ldGFkYXRhJywgeyBwcm9ncmVzczogNSB9KTtcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB0aGlzLmV4dHJhY3RNZXRhZGF0YShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IHRleHRcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2V4dHJhY3RpbmdfdGV4dCcsIHsgcHJvZ3Jlc3M6IDEwIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBwZGZEYXRhID0gYXdhaXQgZnMucmVhZEZpbGUoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICBjb25zdCBwZGZDb250ZW50ID0gYXdhaXQgcGRmUGFyc2UocGRmRGF0YSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBQcm9jZXNzIHBhZ2VzXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdwcm9jZXNzaW5nX3BhZ2VzJywgeyBwcm9ncmVzczogMzAgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1heFBhZ2VzID0gb3B0aW9ucy5tYXhQYWdlcyB8fCBtZXRhZGF0YS5wYWdlQ291bnQ7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhZ2VzID0gYXdhaXQgdGhpcy5leHRyYWN0UGFnZXMoZmlsZVBhdGgsIHBkZkNvbnRlbnQsIE1hdGgubWluKG1heFBhZ2VzLCBtZXRhZGF0YS5wYWdlQ291bnQpKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIHRodW1ibmFpbHMgaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgICAgIGxldCB0aHVtYm5haWxzID0gW107XHJcbiAgICAgICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGVJbWFnZXMpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdnZW5lcmF0aW5nX3RodW1ibmFpbHMnLCB7IHByb2dyZXNzOiA1MCB9KTtcclxuICAgICAgICAgICAgICAgIHRodW1ibmFpbHMgPSBhd2FpdCB0aGlzLmdlbmVyYXRlVGh1bWJuYWlscyhmaWxlUGF0aCwgdGVtcERpciwgTWF0aC5taW4obWF4UGFnZXMsIG1ldGFkYXRhLnBhZ2VDb3VudCkpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBtYXJrZG93blxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZ2VuZXJhdGluZ19tYXJrZG93bicsIHsgcHJvZ3Jlc3M6IDgwIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBtYXJrZG93biA9IHRoaXMuZ2VuZXJhdGVNYXJrZG93bihtZXRhZGF0YSwgcGFnZXMsIHRodW1ibmFpbHMsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2NvbXBsZXRlZCcsIHsgXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMTAwLFxyXG4gICAgICAgICAgICAgICAgcmVzdWx0OiBtYXJrZG93blxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiBtYXJrZG93bjtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbU3RhbmRhcmRQZGZDb252ZXJ0ZXJdIENvbnZlcnNpb24gcHJvY2Vzc2luZyBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBFeHRyYWN0IG1ldGFkYXRhIGZyb20gUERGIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gUERGIGZpbGVcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IFBERiBtZXRhZGF0YVxyXG4gICAgICovXHJcbiAgICBhc3luYyBleHRyYWN0TWV0YWRhdGEoZmlsZVBhdGgpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBwZGZEYXRhID0gYXdhaXQgZnMucmVhZEZpbGUoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICBjb25zdCBwZGZEb2MgPSBhd2FpdCBQREZEb2N1bWVudC5sb2FkKHBkZkRhdGEpO1xyXG4gICAgICAgICAgICBjb25zdCBwZGZDb250ZW50ID0gYXdhaXQgcGRmUGFyc2UocGRmRGF0YSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBtZXRhZGF0YVxyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IHtcclxuICAgICAgICAgICAgICAgIGZpbGVuYW1lOiBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKSxcclxuICAgICAgICAgICAgICAgIHBhZ2VDb3VudDogcGRmRG9jLmdldFBhZ2VDb3VudCgpLFxyXG4gICAgICAgICAgICAgICAgZmlsZVNpemU6IHN0YXRzLnNpemUsXHJcbiAgICAgICAgICAgICAgICAuLi5wZGZDb250ZW50LmluZm9cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEZvcm1hdCBkYXRlc1xyXG4gICAgICAgICAgICBpZiAobWV0YWRhdGEuQ3JlYXRpb25EYXRlKSB7XHJcbiAgICAgICAgICAgICAgICBtZXRhZGF0YS5jcmVhdGlvbkRhdGUgPSB0aGlzLmZvcm1hdFBkZkRhdGUobWV0YWRhdGEuQ3JlYXRpb25EYXRlKTtcclxuICAgICAgICAgICAgICAgIGRlbGV0ZSBtZXRhZGF0YS5DcmVhdGlvbkRhdGU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChtZXRhZGF0YS5Nb2REYXRlKSB7XHJcbiAgICAgICAgICAgICAgICBtZXRhZGF0YS5tb2RpZmljYXRpb25EYXRlID0gdGhpcy5mb3JtYXRQZGZEYXRlKG1ldGFkYXRhLk1vZERhdGUpO1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIG1ldGFkYXRhLk1vZERhdGU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFJlbmFtZSBzdGFuZGFyZCBmaWVsZHNcclxuICAgICAgICAgICAgaWYgKG1ldGFkYXRhLkF1dGhvcikge1xyXG4gICAgICAgICAgICAgICAgbWV0YWRhdGEuYXV0aG9yID0gbWV0YWRhdGEuQXV0aG9yO1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIG1ldGFkYXRhLkF1dGhvcjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKG1ldGFkYXRhLlRpdGxlKSB7XHJcbiAgICAgICAgICAgICAgICBtZXRhZGF0YS50aXRsZSA9IG1ldGFkYXRhLlRpdGxlO1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIG1ldGFkYXRhLlRpdGxlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAobWV0YWRhdGEuU3ViamVjdCkge1xyXG4gICAgICAgICAgICAgICAgbWV0YWRhdGEuc3ViamVjdCA9IG1ldGFkYXRhLlN1YmplY3Q7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgbWV0YWRhdGEuU3ViamVjdDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKG1ldGFkYXRhLktleXdvcmRzKSB7XHJcbiAgICAgICAgICAgICAgICBtZXRhZGF0YS5rZXl3b3JkcyA9IG1ldGFkYXRhLktleXdvcmRzO1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIG1ldGFkYXRhLktleXdvcmRzO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAobWV0YWRhdGEuQ3JlYXRvcikge1xyXG4gICAgICAgICAgICAgICAgbWV0YWRhdGEuY3JlYXRvciA9IG1ldGFkYXRhLkNyZWF0b3I7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgbWV0YWRhdGEuQ3JlYXRvcjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKG1ldGFkYXRhLlByb2R1Y2VyKSB7XHJcbiAgICAgICAgICAgICAgICBtZXRhZGF0YS5wcm9kdWNlciA9IG1ldGFkYXRhLlByb2R1Y2VyO1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIG1ldGFkYXRhLlByb2R1Y2VyO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gbWV0YWRhdGE7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1N0YW5kYXJkUGRmQ29udmVydGVyXSBGYWlsZWQgdG8gZXh0cmFjdCBtZXRhZGF0YTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEZvcm1hdCBQREYgZGF0ZSBzdHJpbmdcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRlU3RyaW5nIC0gUERGIGRhdGUgc3RyaW5nXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGb3JtYXR0ZWQgZGF0ZVxyXG4gICAgICovXHJcbiAgICBmb3JtYXRQZGZEYXRlKGRhdGVTdHJpbmcpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBQREYgZGF0ZXMgY2FuIGJlIGluIGZvcm1hdDogRDpZWVlZTU1EREhIbW1TU09ISCdtbSdcclxuICAgICAgICAgICAgaWYgKGRhdGVTdHJpbmcuc3RhcnRzV2l0aCgnRDonKSkge1xyXG4gICAgICAgICAgICAgICAgZGF0ZVN0cmluZyA9IGRhdGVTdHJpbmcuc3Vic3RyaW5nKDIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBUcnkgdG8gcGFyc2UgdGhlIGRhdGVcclxuICAgICAgICAgICAgY29uc3QgeWVhciA9IGRhdGVTdHJpbmcuc3Vic3RyaW5nKDAsIDQpO1xyXG4gICAgICAgICAgICBjb25zdCBtb250aCA9IGRhdGVTdHJpbmcuc3Vic3RyaW5nKDQsIDYpO1xyXG4gICAgICAgICAgICBjb25zdCBkYXkgPSBkYXRlU3RyaW5nLnN1YnN0cmluZyg2LCA4KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiBgJHt5ZWFyfS0ke21vbnRofS0ke2RheX1gO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBkYXRlU3RyaW5nO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEV4dHJhY3QgcGFnZXMgZnJvbSBQREYgY29udGVudFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBQREYgZmlsZVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHBkZkNvbnRlbnQgLSBQREYgY29udGVudCBmcm9tIHBkZi1wYXJzZVxyXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IG1heFBhZ2VzIC0gTWF4aW11bSBwYWdlcyB0byBleHRyYWN0XHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheT59IEFycmF5IG9mIHBhZ2Ugb2JqZWN0c1xyXG4gICAgICovXHJcbiAgICBhc3luYyBleHRyYWN0UGFnZXMoZmlsZVBhdGgsIHBkZkNvbnRlbnQsIG1heFBhZ2VzKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgcGRmRGF0YSA9IGF3YWl0IGZzLnJlYWRGaWxlKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgY29uc3QgcGRmRG9jID0gYXdhaXQgUERGRG9jdW1lbnQubG9hZChwZGZEYXRhKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IHBhZ2VzID0gW107XHJcbiAgICAgICAgICAgIGNvbnN0IHRvdGFsUGFnZXMgPSBwZGZEb2MuZ2V0UGFnZUNvdW50KCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBTcGxpdCB0ZXh0IGludG8gcGFnZXMgKHBkZi1wYXJzZSBnaXZlcyB1cyBhbGwgdGV4dClcclxuICAgICAgICAgICAgLy8gVGhpcyBpcyBhIHNpbXBsZSBhcHByb2FjaCBhbmQgbWlnaHQgbm90IGJlIHBlcmZlY3RcclxuICAgICAgICAgICAgY29uc3QgdGV4dFBlclBhZ2UgPSBNYXRoLmNlaWwocGRmQ29udGVudC50ZXh0Lmxlbmd0aCAvIHRvdGFsUGFnZXMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbih0b3RhbFBhZ2VzLCBtYXhQYWdlcyk7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcGFnZSA9IHBkZkRvYy5nZXRQYWdlKGkpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgeyB3aWR0aCwgaGVpZ2h0IH0gPSBwYWdlLmdldFNpemUoKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhcnRJbmRleCA9IGkgKiB0ZXh0UGVyUGFnZTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGVuZEluZGV4ID0gTWF0aC5taW4oKGkgKyAxKSAqIHRleHRQZXJQYWdlLCBwZGZDb250ZW50LnRleHQubGVuZ3RoKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHRleHQgPSBwZGZDb250ZW50LnRleHQuc3Vic3RyaW5nKHN0YXJ0SW5kZXgsIGVuZEluZGV4KS50cmltKCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHBhZ2VzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VOdW1iZXI6IGkgKyAxLFxyXG4gICAgICAgICAgICAgICAgICAgIHdpZHRoLFxyXG4gICAgICAgICAgICAgICAgICAgIGhlaWdodCxcclxuICAgICAgICAgICAgICAgICAgICB0ZXh0XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHBhZ2VzO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tTdGFuZGFyZFBkZkNvbnZlcnRlcl0gRmFpbGVkIHRvIGV4dHJhY3QgcGFnZXM6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSB0aHVtYm5haWxzIGZvciBQREYgcGFnZXNcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gUERGIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBvdXRwdXREaXIgLSBPdXRwdXQgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gcGFnZUNvdW50IC0gTnVtYmVyIG9mIHBhZ2VzXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheT59IEFycmF5IG9mIHRodW1ibmFpbCBpbmZvIG9iamVjdHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgZ2VuZXJhdGVUaHVtYm5haWxzKGZpbGVQYXRoLCBvdXRwdXREaXIsIHBhZ2VDb3VudCkge1xyXG4gICAgICAgIC8vIFRoaXMgZnVuY3Rpb25hbGl0eSBoYXMgYmVlbiByZW1vdmVkIHRvIGVsaW1pbmF0ZSB0aGUgY2FudmFzIGRlcGVuZGVuY3lcclxuICAgICAgICBjb25zb2xlLmxvZyhgW1N0YW5kYXJkUGRmQ29udmVydGVyXSBUaHVtYm5haWwgZ2VuZXJhdGlvbiBkaXNhYmxlZGApO1xyXG4gICAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIGEgc2luZ2xlIHBhZ2UgdGh1bWJuYWlsXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIFBERiBmaWxlXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gb3V0cHV0UGF0aCAtIE91dHB1dCBwYXRoIGZvciB0aHVtYm5haWxcclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBwYWdlTnVtYmVyIC0gUGFnZSBudW1iZXJcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gVGh1bWJuYWlsIG9wdGlvbnNcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxyXG4gICAgICovXHJcbiAgICBhc3luYyBnZW5lcmF0ZVBhZ2VUaHVtYm5haWwoZmlsZVBhdGgsIG91dHB1dFBhdGgsIHBhZ2VOdW1iZXIsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgICAgIC8vIFRoaXMgZnVuY3Rpb25hbGl0eSBoYXMgYmVlbiByZW1vdmVkIHRvIGVsaW1pbmF0ZSB0aGUgY2FudmFzIGRlcGVuZGVuY3lcclxuICAgICAgICBjb25zb2xlLmxvZyhgW1N0YW5kYXJkUGRmQ29udmVydGVyXSBUaHVtYm5haWwgZ2VuZXJhdGlvbiBkaXNhYmxlZCBmb3IgcGFnZSAke3BhZ2VOdW1iZXJ9YCk7XHJcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgbWFya2Rvd24gZnJvbSBQREYgbWV0YWRhdGEgYW5kIHBhZ2VzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gbWV0YWRhdGEgLSBQREYgbWV0YWRhdGFcclxuICAgICAqIEBwYXJhbSB7QXJyYXl9IHBhZ2VzIC0gQXJyYXkgb2YgcGFnZSBvYmplY3RzXHJcbiAgICAgKiBAcGFyYW0ge0FycmF5fSB0aHVtYm5haWxzIC0gQXJyYXkgb2YgdGh1bWJuYWlsIGluZm8gb2JqZWN0cyAoYWx3YXlzIGVtcHR5IG5vdyB0aGF0IHRodW1ibmFpbCBnZW5lcmF0aW9uIGlzIGRpc2FibGVkKVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IE1hcmtkb3duIGNvbnRlbnRcclxuICAgICAqL1xyXG4gICAgZ2VuZXJhdGVNYXJrZG93bihtZXRhZGF0YSwgcGFnZXMsIHRodW1ibmFpbHMsIG9wdGlvbnMpIHtcclxuICAgICAgICAvLyBTdGFydCB3aXRoIGhlYWRlclxyXG4gICAgICAgIGNvbnN0IG1hcmtkb3duID0gdGhpcy5nZW5lcmF0ZU1hcmtkb3duSGVhZGVyKG1ldGFkYXRhLCBvcHRpb25zKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgY29udGVudCBmb3IgZWFjaCBwYWdlXHJcbiAgICAgICAgcGFnZXMuZm9yRWFjaCgocGFnZSkgPT4ge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjIyBQYWdlICR7cGFnZS5wYWdlTnVtYmVyfWApO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIE5vIHRodW1ibmFpbHMgYXJlIGFkZGVkIHNpbmNlIHRodW1ibmFpbCBnZW5lcmF0aW9uIGlzIGRpc2FibGVkXHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBBZGQgcGFnZSB0ZXh0XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2gocGFnZS50ZXh0KTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ29udmVydCBQREYgY29udGVudCB0byBtYXJrZG93biAtIGRpcmVjdCBtZXRob2QgZm9yIENvbnZlcnRlclJlZ2lzdHJ5XHJcbiAgICAgKiBAcGFyYW0ge0J1ZmZlcn0gY29udGVudCAtIFBERiBjb250ZW50IGFzIGJ1ZmZlclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBGaWxlIG5hbWVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhcGlLZXkgLSBBUEkga2V5IChub3QgdXNlZCBmb3Igc3RhbmRhcmQgY29udmVyc2lvbilcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBDb252ZXJzaW9uIHJlc3VsdFxyXG4gICAgICovXHJcbiAgICBhc3luYyBjb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCBvcHRpb25zID0ge30pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1N0YW5kYXJkUGRmQ29udmVydGVyXSBDb252ZXJ0aW5nIFBERjogJHtvcHRpb25zLm5hbWUgfHwgJ3VubmFtZWQnfWApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGZpbGUgdG8gcHJvY2Vzc1xyXG4gICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgZnMubWtkdGVtcChwYXRoLmpvaW4ocmVxdWlyZSgnb3MnKS50bXBkaXIoKSwgJ3BkZi1jb252ZXJzaW9uLScpKTtcclxuICAgICAgICAgICAgY29uc3QgdGVtcEZpbGUgPSBwYXRoLmpvaW4odGVtcERpciwgYCR7b3B0aW9ucy5uYW1lIHx8ICdkb2N1bWVudCd9LnBkZmApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gV3JpdGUgYnVmZmVyIHRvIHRlbXAgZmlsZVxyXG4gICAgICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUodGVtcEZpbGUsIGNvbnRlbnQpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBtZXRhZGF0YVxyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHRoaXMuZXh0cmFjdE1ldGFkYXRhKHRlbXBGaWxlKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgdGV4dFxyXG4gICAgICAgICAgICBjb25zdCBwZGZDb250ZW50ID0gYXdhaXQgcGRmUGFyc2UoY29udGVudCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBQcm9jZXNzIHBhZ2VzXHJcbiAgICAgICAgICAgIGNvbnN0IG1heFBhZ2VzID0gb3B0aW9ucy5tYXhQYWdlcyB8fCBtZXRhZGF0YS5wYWdlQ291bnQ7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhZ2VzID0gYXdhaXQgdGhpcy5leHRyYWN0UGFnZXModGVtcEZpbGUsIHBkZkNvbnRlbnQsIE1hdGgubWluKG1heFBhZ2VzLCBtZXRhZGF0YS5wYWdlQ291bnQpKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIHRodW1ibmFpbHMgaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgICAgIGxldCB0aHVtYm5haWxzID0gW107XHJcbiAgICAgICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGVJbWFnZXMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbU3RhbmRhcmRQZGZDb252ZXJ0ZXJdIEdlbmVyYXRpbmcgdGh1bWJuYWlscyBmb3IgZGlyZWN0IGNvbnZlcnNpb24nKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHRlbXBJbWFnZXNEaXIgPSBwYXRoLmpvaW4odGVtcERpciwgJ3RodW1ibmFpbHMnKTtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGZzLm1rZGlyKHRlbXBJbWFnZXNEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG4gICAgICAgICAgICAgICAgdGh1bWJuYWlscyA9IGF3YWl0IHRoaXMuZ2VuZXJhdGVUaHVtYm5haWxzKHRlbXBGaWxlLCB0ZW1wSW1hZ2VzRGlyLCBNYXRoLm1pbihtYXhQYWdlcywgbWV0YWRhdGEucGFnZUNvdW50KSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdldCBjdXJyZW50IGRhdGV0aW1lXHJcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnRlZERhdGUgPSBub3cudG9JU09TdHJpbmcoKS5zcGxpdCgnLicpWzBdLnJlcGxhY2UoJ1QnLCAnICcpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IHRoZSB0aXRsZSBmcm9tIG1ldGFkYXRhIG9yIGZpbGVuYW1lXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVUaXRsZSA9IG1ldGFkYXRhLnRpdGxlIHx8IG9wdGlvbnMubmFtZSB8fCAnUERGIERvY3VtZW50JztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgZnJvbnRtYXR0ZXJcclxuICAgICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBbXHJcbiAgICAgICAgICAgICAgICAnLS0tJyxcclxuICAgICAgICAgICAgICAgIGB0aXRsZTogJHtmaWxlVGl0bGV9YCxcclxuICAgICAgICAgICAgICAgIGBjb252ZXJ0ZWQ6ICR7Y29udmVydGVkRGF0ZX1gLFxyXG4gICAgICAgICAgICAgICAgJ3R5cGU6IHBkZicsXHJcbiAgICAgICAgICAgICAgICAnLS0tJyxcclxuICAgICAgICAgICAgICAgICcnXHJcbiAgICAgICAgICAgIF0uam9pbignXFxuJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBtYXJrZG93biBjb250ZW50XHJcbiAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duQ29udGVudCA9IHRoaXMuZ2VuZXJhdGVNYXJrZG93bihtZXRhZGF0YSwgcGFnZXMsIHRodW1ibmFpbHMsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ29tYmluZSBmcm9udG1hdHRlciBhbmQgY29udGVudFxyXG4gICAgICAgICAgICBjb25zdCBmaW5hbE1hcmtkb3duID0gZnJvbnRtYXR0ZXIgKyBtYXJrZG93bkNvbnRlbnQ7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIGNvbnRlbnQ6IGZpbmFsTWFya2Rvd24sXHJcbiAgICAgICAgICAgICAgICB0eXBlOiAncGRmJyxcclxuICAgICAgICAgICAgICAgIG5hbWU6IG9wdGlvbnMubmFtZSB8fCAnZG9jdW1lbnQucGRmJyxcclxuICAgICAgICAgICAgICAgIG1ldGFkYXRhOiBtZXRhZGF0YVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tTdGFuZGFyZFBkZkNvbnZlcnRlcl0gRGlyZWN0IGNvbnZlcnNpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgZXJyb3I6IGBQREYgY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gLFxyXG4gICAgICAgICAgICAgICAgY29udGVudDogYCMgQ29udmVyc2lvbiBFcnJvclxcblxcbkZhaWxlZCB0byBjb252ZXJ0IFBERjogJHtlcnJvci5tZXNzYWdlfWBcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgY29udmVydGVyIGluZm9ybWF0aW9uXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBnZXRJbmZvKCkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIG5hbWU6IHRoaXMubmFtZSxcclxuICAgICAgICAgICAgZXh0ZW5zaW9uczogdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLFxyXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogdGhpcy5kZXNjcmlwdGlvbixcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgICAgdGl0bGU6ICdPcHRpb25hbCBkb2N1bWVudCB0aXRsZScsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlSW1hZ2VzOiAnV2hldGhlciB0byBpbmNsdWRlIHBhZ2UgaW1hZ2VzIChkZWZhdWx0OiBmYWxzZSknLFxyXG4gICAgICAgICAgICAgICAgbWF4UGFnZXM6ICdNYXhpbXVtIHBhZ2VzIHRvIGNvbnZlcnQgKGRlZmF1bHQ6IGFsbCknXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFN0YW5kYXJkUGRmQ29udmVydGVyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1DLEVBQUUsR0FBR0QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUM5QixNQUFNO0VBQUVFO0FBQVksQ0FBQyxHQUFHRixPQUFPLENBQUMsU0FBUyxDQUFDO0FBQzFDLE1BQU1HLFFBQVEsR0FBR0gsT0FBTyxDQUFDLFdBQVcsQ0FBQztBQUNyQyxNQUFNO0VBQUVJLEVBQUUsRUFBRUM7QUFBTyxDQUFDLEdBQUdMLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDdEMsTUFBTU0sZ0JBQWdCLEdBQUdOLE9BQU8sQ0FBQyxvQkFBb0IsQ0FBQztBQUV0RCxNQUFNTyxvQkFBb0IsU0FBU0QsZ0JBQWdCLENBQUM7RUFDaERFLFdBQVdBLENBQUNDLGFBQWEsRUFBRUMsV0FBVyxFQUFFQyxnQkFBZ0IsR0FBRyxLQUFLLEVBQUU7SUFDOUQsS0FBSyxDQUFDRixhQUFhLEVBQUVDLFdBQVcsQ0FBQztJQUNqQyxJQUFJLENBQUNFLElBQUksR0FBRyx3QkFBd0I7SUFDcEMsSUFBSSxDQUFDQyxXQUFXLEdBQUcsK0RBQStEO0lBQ2xGLElBQUksQ0FBQ0YsZ0JBQWdCLEdBQUdBLGdCQUFnQjs7SUFFeEM7SUFDQSxJQUFJQSxnQkFBZ0IsRUFBRTtNQUNsQkcsT0FBTyxDQUFDQyxHQUFHLENBQUMsdUVB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