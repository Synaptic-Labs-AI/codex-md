"use strict";

/**
 * DocxConverter.js
 * Handles conversion of DOCX files to markdown format in the Electron main process.
 * 
 * This converter:
 * - Parses DOCX files using mammoth
 * - Extracts text, formatting, and structure
 * - Generates clean markdown output
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - FileProcessorService.js: Used for file operations
 * - ConversionService.js: Registers and uses this converter
 */

const path = require('path');
const fs = require('fs-extra');
const mammoth = require('mammoth');
const BaseService = require('../../BaseService');
const {
  formatMetadata,
  cleanMetadata
} = require('../../../utils/markdown');
class DocxConverter extends BaseService {
  constructor(fileProcessor, fileStorage) {
    super();
    this.fileProcessor = fileProcessor;
    this.fileStorage = fileStorage;
    this.supportedExtensions = ['.docx', '.doc'];
    this.activeConversions = new Map();
  }

  /**
   * Set up IPC handlers for DOCX conversion
   */
  setupIpcHandlers() {
    this.registerHandler('convert:docx', this.handleConvert.bind(this));
    this.registerHandler('convert:docx:preview', this.handlePreview.bind(this));
  }

  /**
   * Generate a unique conversion ID
   * @returns {string} Unique conversion ID
   */
  generateConversionId() {
    return `docx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update conversion status and notify renderer
   * @param {string} conversionId - Conversion identifier
   * @param {string} status - New status
   * @param {Object} details - Additional details
   */
  updateConversionStatus(conversionId, status, details = {}) {
    const conversion = this.activeConversions.get(conversionId);
    if (conversion) {
      conversion.status = status;
      Object.assign(conversion, details);
      if (conversion.window) {
        conversion.window.webContents.send('docx:conversion-progress', {
          conversionId,
          status,
          ...details
        });
      }
    }
  }

  /**
   * Handle DOCX conversion request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Conversion request details
   */
  async handleConvert(event, {
    filePath,
    buffer,
    options = {}
  }) {
    try {
      const conversionId = this.generateConversionId();
      const window = event?.sender?.getOwnerBrowserWindow?.() || null;

      // Create temp directory for this conversion
      const tempDir = await this.fileStorage.createTempDir('docx_conversion');
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
        window.webContents.send('docx:conversion-started', {
          conversionId
        });
      }
      let content;
      if (buffer) {
        content = Buffer.from(buffer);
      } else if (filePath) {
        this.updateConversionStatus(conversionId, 'reading_file', {
          progress: 10
        });
        const fileResult = await this.fileProcessor.handleFileRead(null, {
          filePath,
          asBinary: true
        });
        content = fileResult.content;
      } else {
        throw new Error('No file path or buffer provided');
      }

      // Start conversion process
      const result = await this.processConversion(conversionId, content, {
        ...options,
        fileName: options.originalFileName || options.name || path.basename(filePath || 'document.docx')
      });
      return {
        content: result
      };
    } catch (error) {
      console.error('[DocxConverter] Conversion failed:', error);
      throw error;
    }
  }

  /**
   * Handle DOCX preview request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Preview request details
   */
  async handlePreview(event, {
    filePath,
    buffer,
    options = {}
  }) {
    try {
      let content;
      if (buffer) {
        content = Buffer.from(buffer);
      } else if (filePath) {
        const fileResult = await this.fileProcessor.handleFileRead(null, {
          filePath,
          asBinary: true
        });
        content = fileResult.content;
      } else {
        throw new Error('No file path or buffer provided');
      }
      const result = await this.convertToMarkdown(content, {
        ...options,
        isPreview: true,
        fileName: options.originalFileName || options.name || path.basename(filePath || 'document.docx')
      });
      return {
        content: result
      };
    } catch (error) {
      console.error('[DocxConverter] Preview generation failed:', error);
      throw error;
    }
  }

  /**
   * Process DOCX conversion
   * @param {string} conversionId - Conversion identifier
   * @param {Buffer} content - DOCX content as buffer
   * @param {Object} options - Conversion options
   * @returns {Promise<string>} Markdown content
   */
  async processConversion(conversionId, content, options) {
    try {
      const conversion = this.activeConversions.get(conversionId);
      if (!conversion) {
        throw new Error('Conversion not found');
      }
      this.updateConversionStatus(conversionId, 'extracting_content', {
        progress: 30
      });

      // Extract document content and metadata
      const result = await this.convertToMarkdown(content, options);
      this.updateConversionStatus(conversionId, 'completed', {
        progress: 100,
        result
      });

      // Clean up temp directory
      if (conversion.tempDir) {
        await fs.remove(conversion.tempDir).catch(err => {
          console.error(`[DocxConverter] Failed to clean up temp directory: ${conversion.tempDir}`, err);
        });
      }
      return result;
    } catch (error) {
      console.error('[DocxConverter] Conversion processing failed:', error);

      // Clean up temp directory
      const conversion = this.activeConversions.get(conversionId);
      if (conversion && conversion.tempDir) {
        await fs.remove(conversion.tempDir).catch(err => {
          console.error(`[DocxConverter] Failed to clean up temp directory: ${conversion.tempDir}`, err);
        });
      }
      throw error;
    }
  }

  /**
   * Convert DOCX content to markdown
   * @param {Buffer} content - DOCX content as buffer
   * @param {Object} options - Conversion options
   * @returns {Promise<string>} Markdown content
   */
  async convertToMarkdown(content, options = {}) {
    try {
      const fileName = options.fileName || 'document.docx';
      const isPreview = options.isPreview || false;

      // Configure Mammoth options
      const mammothOptions = {
        styleMap: ["p[style-name='Heading 1'] => # $1", "p[style-name='Heading 2'] => ## $1", "p[style-name='Heading 3'] => ### $1", "p[style-name='Heading 4'] => #### $1", "p[style-name='Heading 5'] => ##### $1", "p[style-name='Heading 6'] => ###### $1", "r[style-name='Strong'] => **$1**", "r[style-name='Emphasis'] => *$1*", "p[style-name='Quote'] => > $1", "p[style-name='List Paragraph'] => * $1", "table => $1", "tr => $1", "td => $1"]
      };

      // Extract document metadata
      const metadata = await this.extractMetadata(content);

      // Convert DOCX to HTML
      const result = await mammoth.convertToHtml({
        buffer: content
      }, mammothOptions);
      const html = result.value;
      const warnings = result.messages;
      if (warnings.length > 0) {
        console.warn('[DocxConverter] Conversion warnings:', warnings);
      }

      // Convert HTML to Markdown
      const TurndownService = require('turndown');
      const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        bulletListMarker: '-'
      });

      // Customize turndown
      turndownService.addRule('tables', {
        filter: 'table',
        replacement: function (content, node) {
          // Headers are the first row
          const rows = node.rows;
          if (rows.length === 0) return '';
          let markdown = '\n\n';

          // Process header row
          const headerCells = Array.from(rows[0].cells);
          markdown += '| ' + headerCells.map(cell => cell.textContent.trim()).join(' | ') + ' |\n';
          markdown += '| ' + headerCells.map(() => '---').join(' | ') + ' |\n';

          // Process data rows
          for (let i = 1; i < rows.length; i++) {
            const cells = Array.from(rows[i].cells);
            markdown += '| ' + cells.map(cell => cell.textContent.trim()).join(' | ') + ' |\n';
          }
          return markdown;
        }
      });

      // Convert HTML to markdown
      const markdownContent = turndownService.turndown(html);

      // Get the title from metadata or filename
      const fileTitle = metadata.title || path.basename(fileName, path.extname(fileName));

      // Create standardized frontmatter using metadata utility
      const {
        createStandardFrontmatter
      } = require('../../../converters/utils/metadata');
      const frontmatter = createStandardFrontmatter({
        title: fileTitle,
        fileType: 'docx'
      });

      // Combine frontmatter and content
      return frontmatter + markdownContent;
    } catch (error) {
      console.error('[DocxConverter] Markdown conversion failed:', error);
      throw error;
    }
  }

  /**
   * Extract metadata from DOCX document
   * @param {Buffer} content - DOCX content as buffer
   * @returns {Promise<Object>} Document metadata
   */
  async extractMetadata(content) {
    try {
      // Use mammoth to extract metadata
      const result = await mammoth.extractRawText({
        buffer: content
      });
      const text = result.value;

      // Try to extract title from first heading
      let title = '';
      const titleMatch = text.match(/^(.+)(?:\r?\n)/);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }

      // Return basic metadata
      return {
        title,
        author: '',
        date: new Date().toISOString().split('T')[0],
        subject: '',
        keywords: '',
        pageCount: this.estimatePageCount(text)
      };
    } catch (error) {
      console.error('[DocxConverter] Failed to extract metadata:', error);
      return {
        title: '',
        author: '',
        date: new Date().toISOString().split('T')[0],
        subject: '',
        keywords: '',
        pageCount: 1
      };
    }
  }

  /**
   * Estimate page count based on text length
   * @param {string} text - Document text
   * @returns {number} Estimated page count
   */
  estimatePageCount(text) {
    // Rough estimate: 3000 characters per page
    const charsPerPage = 3000;
    return Math.max(1, Math.ceil(text.length / charsPerPage));
  }

  /**
   * Check if this converter supports the given file
   * @param {string} filePath - Path to file
   * @returns {boolean} True if supported
   */
  supportsFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  /**
   * Get converter information
   * @returns {Object} Converter details
   */
  getInfo() {
    return {
      name: 'DOCX Converter',
      extensions: this.supportedExtensions,
      description: 'Converts DOCX files to markdown',
      options: {
        title: 'Optional document title',
        isPreview: 'Whether to generate a preview (default: false)'
      }
    };
  }
}
module.exports = DocxConverter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwibWFtbW90aCIsIkJhc2VTZXJ2aWNlIiwiZm9ybWF0TWV0YWRhdGEiLCJjbGVhbk1ldGFkYXRhIiwiRG9jeENvbnZlcnRlciIsImNvbnN0cnVjdG9yIiwiZmlsZVByb2Nlc3NvciIsImZpbGVTdG9yYWdlIiwic3VwcG9ydGVkRXh0ZW5zaW9ucyIsImFjdGl2ZUNvbnZlcnNpb25zIiwiTWFwIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUNvbnZlcnQiLCJiaW5kIiwiaGFuZGxlUHJldmlldyIsImdlbmVyYXRlQ29udmVyc2lvbklkIiwiRGF0ZSIsIm5vdyIsIk1hdGgiLCJyYW5kb20iLCJ0b1N0cmluZyIsInN1YnN0ciIsInVwZGF0ZUNvbnZlcnNpb25TdGF0dXMiLCJjb252ZXJzaW9uSWQiLCJzdGF0dXMiLCJkZXRhaWxzIiwiY29udmVyc2lvbiIsImdldCIsIk9iamVjdCIsImFzc2lnbiIsIndpbmRvdyIsIndlYkNvbnRlbnRzIiwic2VuZCIsImV2ZW50IiwiZmlsZVBhdGgiLCJidWZmZXIiLCJvcHRpb25zIiwic2VuZGVyIiwiZ2V0T3duZXJCcm93c2VyV2luZG93IiwidGVtcERpciIsImNyZWF0ZVRlbXBEaXIiLCJzZXQiLCJpZCIsInByb2dyZXNzIiwiY29udGVudCIsIkJ1ZmZlciIsImZyb20iLCJmaWxlUmVzdWx0IiwiaGFuZGxlRmlsZVJlYWQiLCJhc0JpbmFyeSIsIkVycm9yIiwicmVzdWx0IiwicHJvY2Vzc0NvbnZlcnNpb24iLCJmaWxlTmFtZSIsIm9yaWdpbmFsRmlsZU5hbWUiLCJuYW1lIiwiYmFzZW5hbWUiLCJlcnJvciIsImNvbnNvbGUiLCJjb252ZXJ0VG9NYXJrZG93biIsImlzUHJldmlldyIsInJlbW92ZSIsImNhdGNoIiwiZXJyIiwibWFtbW90aE9wdGlvbnMiLCJzdHlsZU1hcCIsIm1ldGFkYXRhIiwiZXh0cmFjdE1ldGFkYXRhIiwiY29udmVydFRvSHRtbCIsImh0bWwiLCJ2YWx1ZSIsIndhcm5pbmdzIiwibWVzc2FnZXMiLCJsZW5ndGgiLCJ3YXJuIiwiVHVybmRvd25TZXJ2aWNlIiwidHVybmRvd25TZXJ2aWNlIiwiaGVhZGluZ1N0eWxlIiwiY29kZUJsb2NrU3R5bGUiLCJlbURlbGltaXRlciIsImJ1bGxldExpc3RNYXJrZXIiLCJhZGRSdWxlIiwiZmlsdGVyIiwicmVwbGFjZW1lbnQiLCJub2RlIiwicm93cyIsIm1hcmtkb3duIiwiaGVhZGVyQ2VsbHMiLCJBcnJheSIsImNlbGxzIiwibWFwIiwiY2VsbCIsInRleHRDb250ZW50IiwidHJpbSIsImpvaW4iLCJpIiwibWFya2Rvd25Db250ZW50IiwidHVybmRvd24iLCJmaWxlVGl0bGUiLCJ0aXRsZSIsImV4dG5hbWUiLCJjcmVhdGVTdGFuZGFyZEZyb250bWF0dGVyIiwiZnJvbnRtYXR0ZXIiLCJmaWxlVHlwZSIsImV4dHJhY3RSYXdUZXh0IiwidGV4dCIsInRpdGxlTWF0Y2giLCJtYXRjaCIsImF1dGhvciIsImRhdGUiLCJ0b0lTT1N0cmluZyIsInNwbGl0Iiwic3ViamVjdCIsImtleXdvcmRzIiwicGFnZUNvdW50IiwiZXN0aW1hdGVQYWdlQ291bnQiLCJjaGFyc1BlclBhZ2UiLCJtYXgiLCJjZWlsIiwic3VwcG9ydHNGaWxlIiwiZXh0IiwidG9Mb3dlckNhc2UiLCJpbmNsdWRlcyIsImdldEluZm8iLCJleHRlbnNpb25zIiwiZGVzY3JpcHRpb24iLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vZG9jdW1lbnQvRG9jeENvbnZlcnRlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIERvY3hDb252ZXJ0ZXIuanNcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiBET0NYIGZpbGVzIHRvIG1hcmtkb3duIGZvcm1hdCBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxuICogXG4gKiBUaGlzIGNvbnZlcnRlcjpcbiAqIC0gUGFyc2VzIERPQ1ggZmlsZXMgdXNpbmcgbWFtbW90aFxuICogLSBFeHRyYWN0cyB0ZXh0LCBmb3JtYXR0aW5nLCBhbmQgc3RydWN0dXJlXG4gKiAtIEdlbmVyYXRlcyBjbGVhbiBtYXJrZG93biBvdXRwdXRcbiAqIFxuICogUmVsYXRlZCBGaWxlczpcbiAqIC0gQmFzZVNlcnZpY2UuanM6IFBhcmVudCBjbGFzcyBwcm92aWRpbmcgSVBDIGhhbmRsaW5nXG4gKiAtIEZpbGVQcm9jZXNzb3JTZXJ2aWNlLmpzOiBVc2VkIGZvciBmaWxlIG9wZXJhdGlvbnNcbiAqIC0gQ29udmVyc2lvblNlcnZpY2UuanM6IFJlZ2lzdGVycyBhbmQgdXNlcyB0aGlzIGNvbnZlcnRlclxuICovXG5cbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XG5jb25zdCBtYW1tb3RoID0gcmVxdWlyZSgnbWFtbW90aCcpO1xuY29uc3QgQmFzZVNlcnZpY2UgPSByZXF1aXJlKCcuLi8uLi9CYXNlU2VydmljZScpO1xuY29uc3QgeyBmb3JtYXRNZXRhZGF0YSwgY2xlYW5NZXRhZGF0YSB9ID0gcmVxdWlyZSgnLi4vLi4vLi4vdXRpbHMvbWFya2Rvd24nKTtcblxuY2xhc3MgRG9jeENvbnZlcnRlciBleHRlbmRzIEJhc2VTZXJ2aWNlIHtcbiAgICBjb25zdHJ1Y3RvcihmaWxlUHJvY2Vzc29yLCBmaWxlU3RvcmFnZSkge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yO1xuICAgICAgICB0aGlzLmZpbGVTdG9yYWdlID0gZmlsZVN0b3JhZ2U7XG4gICAgICAgIHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyA9IFsnLmRvY3gnLCAnLmRvYyddO1xuICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zID0gbmV3IE1hcCgpO1xuICAgIH1cbiAgICBcbiAgICAvKipcbiAgICAgKiBTZXQgdXAgSVBDIGhhbmRsZXJzIGZvciBET0NYIGNvbnZlcnNpb25cbiAgICAgKi9cbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpkb2N4JywgdGhpcy5oYW5kbGVDb252ZXJ0LmJpbmQodGhpcykpO1xuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpkb2N4OnByZXZpZXcnLCB0aGlzLmhhbmRsZVByZXZpZXcuYmluZCh0aGlzKSk7XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlIGEgdW5pcXVlIGNvbnZlcnNpb24gSURcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBVbmlxdWUgY29udmVyc2lvbiBJRFxuICAgICAqL1xuICAgIGdlbmVyYXRlQ29udmVyc2lvbklkKCkge1xuICAgICAgICByZXR1cm4gYGRvY3hfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cigyLCA5KX1gO1xuICAgIH1cbiAgICBcbiAgICAvKipcbiAgICAgKiBVcGRhdGUgY29udmVyc2lvbiBzdGF0dXMgYW5kIG5vdGlmeSByZW5kZXJlclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIGlkZW50aWZpZXJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RhdHVzIC0gTmV3IHN0YXR1c1xuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBkZXRhaWxzIC0gQWRkaXRpb25hbCBkZXRhaWxzXG4gICAgICovXG4gICAgdXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsIHN0YXR1cywgZGV0YWlscyA9IHt9KSB7XG4gICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xuICAgICAgICBpZiAoY29udmVyc2lvbikge1xuICAgICAgICAgICAgY29udmVyc2lvbi5zdGF0dXMgPSBzdGF0dXM7XG4gICAgICAgICAgICBPYmplY3QuYXNzaWduKGNvbnZlcnNpb24sIGRldGFpbHMpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoY29udmVyc2lvbi53aW5kb3cpIHtcbiAgICAgICAgICAgICAgICBjb252ZXJzaW9uLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdkb2N4OmNvbnZlcnNpb24tcHJvZ3Jlc3MnLCB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25JZCxcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLFxuICAgICAgICAgICAgICAgICAgICAuLi5kZXRhaWxzXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogSGFuZGxlIERPQ1ggY29udmVyc2lvbiByZXF1ZXN0XG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb252ZXJzaW9uIHJlcXVlc3QgZGV0YWlsc1xuICAgICAqL1xuICAgIGFzeW5jIGhhbmRsZUNvbnZlcnQoZXZlbnQsIHsgZmlsZVBhdGgsIGJ1ZmZlciwgb3B0aW9ucyA9IHt9IH0pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb25JZCA9IHRoaXMuZ2VuZXJhdGVDb252ZXJzaW9uSWQoKTtcbiAgICAgICAgICAgIGNvbnN0IHdpbmRvdyA9IGV2ZW50Py5zZW5kZXI/LmdldE93bmVyQnJvd3NlcldpbmRvdz8uKCkgfHwgbnVsbDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3JlYXRlIHRlbXAgZGlyZWN0b3J5IGZvciB0aGlzIGNvbnZlcnNpb25cbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ2RvY3hfY29udmVyc2lvbicpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNldChjb252ZXJzaW9uSWQsIHtcbiAgICAgICAgICAgICAgICBpZDogY29udmVyc2lvbklkLFxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3N0YXJ0aW5nJyxcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMCxcbiAgICAgICAgICAgICAgICBmaWxlUGF0aCxcbiAgICAgICAgICAgICAgICB0ZW1wRGlyLFxuICAgICAgICAgICAgICAgIHdpbmRvd1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIE5vdGlmeSBjbGllbnQgdGhhdCBjb252ZXJzaW9uIGhhcyBzdGFydGVkIChvbmx5IGlmIHdlIGhhdmUgYSB2YWxpZCB3aW5kb3cpXG4gICAgICAgICAgICBpZiAod2luZG93ICYmIHdpbmRvdy53ZWJDb250ZW50cykge1xuICAgICAgICAgICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdkb2N4OmNvbnZlcnNpb24tc3RhcnRlZCcsIHsgY29udmVyc2lvbklkIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBsZXQgY29udGVudDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGJ1ZmZlcikge1xuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBCdWZmZXIuZnJvbShidWZmZXIpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChmaWxlUGF0aCkge1xuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdyZWFkaW5nX2ZpbGUnLCB7IHByb2dyZXNzOiAxMCB9KTtcbiAgICAgICAgICAgICAgICBjb25zdCBmaWxlUmVzdWx0ID0gYXdhaXQgdGhpcy5maWxlUHJvY2Vzc29yLmhhbmRsZUZpbGVSZWFkKG51bGwsIHtcbiAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIGFzQmluYXJ5OiB0cnVlXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IGZpbGVSZXN1bHQuY29udGVudDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBmaWxlIHBhdGggb3IgYnVmZmVyIHByb3ZpZGVkJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFN0YXJ0IGNvbnZlcnNpb24gcHJvY2Vzc1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIGNvbnRlbnQsIHtcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGggfHwgJ2RvY3VtZW50LmRvY3gnKVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnRlbnQ6IHJlc3VsdCB9O1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0RvY3hDb252ZXJ0ZXJdIENvbnZlcnNpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSGFuZGxlIERPQ1ggcHJldmlldyByZXF1ZXN0XG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBQcmV2aWV3IHJlcXVlc3QgZGV0YWlsc1xuICAgICAqL1xuICAgIGFzeW5jIGhhbmRsZVByZXZpZXcoZXZlbnQsIHsgZmlsZVBhdGgsIGJ1ZmZlciwgb3B0aW9ucyA9IHt9IH0pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGxldCBjb250ZW50O1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoYnVmZmVyKSB7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IEJ1ZmZlci5mcm9tKGJ1ZmZlcik7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGZpbGVQYXRoKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZmlsZVJlc3VsdCA9IGF3YWl0IHRoaXMuZmlsZVByb2Nlc3Nvci5oYW5kbGVGaWxlUmVhZChudWxsLCB7XG4gICAgICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxuICAgICAgICAgICAgICAgICAgICBhc0JpbmFyeTogdHJ1ZVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBmaWxlUmVzdWx0LmNvbnRlbnQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gZmlsZSBwYXRoIG9yIGJ1ZmZlciBwcm92aWRlZCcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIHtcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgICAgICAgIGlzUHJldmlldzogdHJ1ZSxcbiAgICAgICAgICAgICAgICBmaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IG9wdGlvbnMubmFtZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoIHx8ICdkb2N1bWVudC5kb2N4JylcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4geyBjb250ZW50OiByZXN1bHQgfTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tEb2N4Q29udmVydGVyXSBQcmV2aWV3IGdlbmVyYXRpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIFByb2Nlc3MgRE9DWCBjb252ZXJzaW9uXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxuICAgICAqIEBwYXJhbSB7QnVmZmVyfSBjb250ZW50IC0gRE9DWCBjb250ZW50IGFzIGJ1ZmZlclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXG4gICAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gTWFya2Rvd24gY29udGVudFxuICAgICAqL1xuICAgIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgY29udGVudCwgb3B0aW9ucykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XG4gICAgICAgICAgICBpZiAoIWNvbnZlcnNpb24pIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbnZlcnNpb24gbm90IGZvdW5kJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdleHRyYWN0aW5nX2NvbnRlbnQnLCB7IHByb2dyZXNzOiAzMCB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRXh0cmFjdCBkb2N1bWVudCBjb250ZW50IGFuZCBtZXRhZGF0YVxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCBvcHRpb25zKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2NvbXBsZXRlZCcsIHsgXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDEwMCxcbiAgICAgICAgICAgICAgICByZXN1bHRcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24udGVtcERpcikge1xuICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZShjb252ZXJzaW9uLnRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtEb2N4Q29udmVydGVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3Rvcnk6ICR7Y29udmVyc2lvbi50ZW1wRGlyfWAsIGVycik7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRG9jeENvbnZlcnRlcl0gQ29udmVyc2lvbiBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uICYmIGNvbnZlcnNpb24udGVtcERpcikge1xuICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZShjb252ZXJzaW9uLnRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtEb2N4Q29udmVydGVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3Rvcnk6ICR7Y29udmVyc2lvbi50ZW1wRGlyfWAsIGVycik7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29udmVydCBET0NYIGNvbnRlbnQgdG8gbWFya2Rvd25cbiAgICAgKiBAcGFyYW0ge0J1ZmZlcn0gY29udGVudCAtIERPQ1ggY29udGVudCBhcyBidWZmZXJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IE1hcmtkb3duIGNvbnRlbnRcbiAgICAgKi9cbiAgICBhc3luYyBjb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCBvcHRpb25zID0ge30pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gb3B0aW9ucy5maWxlTmFtZSB8fCAnZG9jdW1lbnQuZG9jeCc7XG4gICAgICAgICAgICBjb25zdCBpc1ByZXZpZXcgPSBvcHRpb25zLmlzUHJldmlldyB8fCBmYWxzZTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ29uZmlndXJlIE1hbW1vdGggb3B0aW9uc1xuICAgICAgICAgICAgY29uc3QgbWFtbW90aE9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgc3R5bGVNYXA6IFtcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0hlYWRpbmcgMSddID0+ICMgJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0hlYWRpbmcgMiddID0+ICMjICQxXCIsXG4gICAgICAgICAgICAgICAgICAgIFwicFtzdHlsZS1uYW1lPSdIZWFkaW5nIDMnXSA9PiAjIyMgJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0hlYWRpbmcgNCddID0+ICMjIyMgJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0hlYWRpbmcgNSddID0+ICMjIyMjICQxXCIsXG4gICAgICAgICAgICAgICAgICAgIFwicFtzdHlsZS1uYW1lPSdIZWFkaW5nIDYnXSA9PiAjIyMjIyMgJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJyW3N0eWxlLW5hbWU9J1N0cm9uZyddID0+ICoqJDEqKlwiLFxuICAgICAgICAgICAgICAgICAgICBcInJbc3R5bGUtbmFtZT0nRW1waGFzaXMnXSA9PiAqJDEqXCIsXG4gICAgICAgICAgICAgICAgICAgIFwicFtzdHlsZS1uYW1lPSdRdW90ZSddID0+ID4gJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0xpc3QgUGFyYWdyYXBoJ10gPT4gKiAkMVwiLFxuICAgICAgICAgICAgICAgICAgICBcInRhYmxlID0+ICQxXCIsXG4gICAgICAgICAgICAgICAgICAgIFwidHIgPT4gJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJ0ZCA9PiAkMVwiXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRXh0cmFjdCBkb2N1bWVudCBtZXRhZGF0YVxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB0aGlzLmV4dHJhY3RNZXRhZGF0YShjb250ZW50KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ29udmVydCBET0NYIHRvIEhUTUxcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG1hbW1vdGguY29udmVydFRvSHRtbCh7IGJ1ZmZlcjogY29udGVudCB9LCBtYW1tb3RoT3B0aW9ucyk7XG4gICAgICAgICAgICBjb25zdCBodG1sID0gcmVzdWx0LnZhbHVlO1xuICAgICAgICAgICAgY29uc3Qgd2FybmluZ3MgPSByZXN1bHQubWVzc2FnZXM7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh3YXJuaW5ncy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdbRG9jeENvbnZlcnRlcl0gQ29udmVyc2lvbiB3YXJuaW5nczonLCB3YXJuaW5ncyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENvbnZlcnQgSFRNTCB0byBNYXJrZG93blxuICAgICAgICAgICAgY29uc3QgVHVybmRvd25TZXJ2aWNlID0gcmVxdWlyZSgndHVybmRvd24nKTtcbiAgICAgICAgICAgIGNvbnN0IHR1cm5kb3duU2VydmljZSA9IG5ldyBUdXJuZG93blNlcnZpY2Uoe1xuICAgICAgICAgICAgICAgIGhlYWRpbmdTdHlsZTogJ2F0eCcsXG4gICAgICAgICAgICAgICAgY29kZUJsb2NrU3R5bGU6ICdmZW5jZWQnLFxuICAgICAgICAgICAgICAgIGVtRGVsaW1pdGVyOiAnKicsXG4gICAgICAgICAgICAgICAgYnVsbGV0TGlzdE1hcmtlcjogJy0nXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3VzdG9taXplIHR1cm5kb3duXG4gICAgICAgICAgICB0dXJuZG93blNlcnZpY2UuYWRkUnVsZSgndGFibGVzJywge1xuICAgICAgICAgICAgICAgIGZpbHRlcjogJ3RhYmxlJyxcbiAgICAgICAgICAgICAgICByZXBsYWNlbWVudDogZnVuY3Rpb24oY29udGVudCwgbm9kZSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBIZWFkZXJzIGFyZSB0aGUgZmlyc3Qgcm93XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJvd3MgPSBub2RlLnJvd3M7XG4gICAgICAgICAgICAgICAgICAgIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgcmV0dXJuICcnO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbGV0IG1hcmtkb3duID0gJ1xcblxcbic7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyBQcm9jZXNzIGhlYWRlciByb3dcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaGVhZGVyQ2VsbHMgPSBBcnJheS5mcm9tKHJvd3NbMF0uY2VsbHMpO1xuICAgICAgICAgICAgICAgICAgICBtYXJrZG93biArPSAnfCAnICsgaGVhZGVyQ2VsbHMubWFwKGNlbGwgPT4gY2VsbC50ZXh0Q29udGVudC50cmltKCkpLmpvaW4oJyB8ICcpICsgJyB8XFxuJztcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24gKz0gJ3wgJyArIGhlYWRlckNlbGxzLm1hcCgoKSA9PiAnLS0tJykuam9pbignIHwgJykgKyAnIHxcXG4nO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gUHJvY2VzcyBkYXRhIHJvd3NcbiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDE7IGkgPCByb3dzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjZWxscyA9IEFycmF5LmZyb20ocm93c1tpXS5jZWxscyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBtYXJrZG93biArPSAnfCAnICsgY2VsbHMubWFwKGNlbGwgPT4gY2VsbC50ZXh0Q29udGVudC50cmltKCkpLmpvaW4oJyB8ICcpICsgJyB8XFxuJztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1hcmtkb3duO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDb252ZXJ0IEhUTUwgdG8gbWFya2Rvd25cbiAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duQ29udGVudCA9IHR1cm5kb3duU2VydmljZS50dXJuZG93bihodG1sKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gR2V0IHRoZSB0aXRsZSBmcm9tIG1ldGFkYXRhIG9yIGZpbGVuYW1lXG4gICAgICAgICAgICBjb25zdCBmaWxlVGl0bGUgPSBtZXRhZGF0YS50aXRsZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVOYW1lLCBwYXRoLmV4dG5hbWUoZmlsZU5hbWUpKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBmcm9udG1hdHRlciB1c2luZyBtZXRhZGF0YSB1dGlsaXR5XG4gICAgICAgICAgICBjb25zdCB7IGNyZWF0ZVN0YW5kYXJkRnJvbnRtYXR0ZXIgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL2NvbnZlcnRlcnMvdXRpbHMvbWV0YWRhdGEnKTtcbiAgICAgICAgICAgIGNvbnN0IGZyb250bWF0dGVyID0gY3JlYXRlU3RhbmRhcmRGcm9udG1hdHRlcih7XG4gICAgICAgICAgICAgICAgdGl0bGU6IGZpbGVUaXRsZSxcbiAgICAgICAgICAgICAgICBmaWxlVHlwZTogJ2RvY3gnXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ29tYmluZSBmcm9udG1hdHRlciBhbmQgY29udGVudFxuICAgICAgICAgICAgcmV0dXJuIGZyb250bWF0dGVyICsgbWFya2Rvd25Db250ZW50O1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0RvY3hDb252ZXJ0ZXJdIE1hcmtkb3duIGNvbnZlcnNpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIEV4dHJhY3QgbWV0YWRhdGEgZnJvbSBET0NYIGRvY3VtZW50XG4gICAgICogQHBhcmFtIHtCdWZmZXJ9IGNvbnRlbnQgLSBET0NYIGNvbnRlbnQgYXMgYnVmZmVyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gRG9jdW1lbnQgbWV0YWRhdGFcbiAgICAgKi9cbiAgICBhc3luYyBleHRyYWN0TWV0YWRhdGEoY29udGVudCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gVXNlIG1hbW1vdGggdG8gZXh0cmFjdCBtZXRhZGF0YVxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgbWFtbW90aC5leHRyYWN0UmF3VGV4dCh7IGJ1ZmZlcjogY29udGVudCB9KTtcbiAgICAgICAgICAgIGNvbnN0IHRleHQgPSByZXN1bHQudmFsdWU7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFRyeSB0byBleHRyYWN0IHRpdGxlIGZyb20gZmlyc3QgaGVhZGluZ1xuICAgICAgICAgICAgbGV0IHRpdGxlID0gJyc7XG4gICAgICAgICAgICBjb25zdCB0aXRsZU1hdGNoID0gdGV4dC5tYXRjaCgvXiguKykoPzpcXHI/XFxuKS8pO1xuICAgICAgICAgICAgaWYgKHRpdGxlTWF0Y2gpIHtcbiAgICAgICAgICAgICAgICB0aXRsZSA9IHRpdGxlTWF0Y2hbMV0udHJpbSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBSZXR1cm4gYmFzaWMgbWV0YWRhdGFcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdGl0bGUsXG4gICAgICAgICAgICAgICAgYXV0aG9yOiAnJyxcbiAgICAgICAgICAgICAgICBkYXRlOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXSxcbiAgICAgICAgICAgICAgICBzdWJqZWN0OiAnJyxcbiAgICAgICAgICAgICAgICBrZXl3b3JkczogJycsXG4gICAgICAgICAgICAgICAgcGFnZUNvdW50OiB0aGlzLmVzdGltYXRlUGFnZUNvdW50KHRleHQpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0RvY3hDb252ZXJ0ZXJdIEZhaWxlZCB0byBleHRyYWN0IG1ldGFkYXRhOicsIGVycm9yKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdGl0bGU6ICcnLFxuICAgICAgICAgICAgICAgIGF1dGhvcjogJycsXG4gICAgICAgICAgICAgICAgZGF0ZTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF0sXG4gICAgICAgICAgICAgICAgc3ViamVjdDogJycsXG4gICAgICAgICAgICAgICAga2V5d29yZHM6ICcnLFxuICAgICAgICAgICAgICAgIHBhZ2VDb3VudDogMVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvKipcbiAgICAgKiBFc3RpbWF0ZSBwYWdlIGNvdW50IGJhc2VkIG9uIHRleHQgbGVuZ3RoXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHRleHQgLSBEb2N1bWVudCB0ZXh0XG4gICAgICogQHJldHVybnMge251bWJlcn0gRXN0aW1hdGVkIHBhZ2UgY291bnRcbiAgICAgKi9cbiAgICBlc3RpbWF0ZVBhZ2VDb3VudCh0ZXh0KSB7XG4gICAgICAgIC8vIFJvdWdoIGVzdGltYXRlOiAzMDAwIGNoYXJhY3RlcnMgcGVyIHBhZ2VcbiAgICAgICAgY29uc3QgY2hhcnNQZXJQYWdlID0gMzAwMDtcbiAgICAgICAgcmV0dXJuIE1hdGgubWF4KDEsIE1hdGguY2VpbCh0ZXh0Lmxlbmd0aCAvIGNoYXJzUGVyUGFnZSkpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrIGlmIHRoaXMgY29udmVydGVyIHN1cHBvcnRzIHRoZSBnaXZlbiBmaWxlXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBmaWxlXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXG4gICAgICovXG4gICAgc3VwcG9ydHNGaWxlKGZpbGVQYXRoKSB7XG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucy5pbmNsdWRlcyhleHQpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xuICAgICAqL1xuICAgIGdldEluZm8oKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBuYW1lOiAnRE9DWCBDb252ZXJ0ZXInLFxuICAgICAgICAgICAgZXh0ZW5zaW9uczogdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb252ZXJ0cyBET0NYIGZpbGVzIHRvIG1hcmtkb3duJyxcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICB0aXRsZTogJ09wdGlvbmFsIGRvY3VtZW50IHRpdGxlJyxcbiAgICAgICAgICAgICAgICBpc1ByZXZpZXc6ICdXaGV0aGVyIHRvIGdlbmVyYXRlIGEgcHJldmlldyAoZGVmYXVsdDogZmFsc2UpJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBEb2N4Q29udmVydGVyO1xuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1DLEVBQUUsR0FBR0QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUM5QixNQUFNRSxPQUFPLEdBQUdGLE9BQU8sQ0FBQyxTQUFTLENBQUM7QUFDbEMsTUFBTUcsV0FBVyxHQUFHSCxPQUFPLENBQUMsbUJBQW1CLENBQUM7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