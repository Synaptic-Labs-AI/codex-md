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
      const window = event.sender.getOwnerBrowserWindow();

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

      // Notify client that conversion has started
      window.webContents.send('docx:conversion-started', {
        conversionId
      });
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

      // Get current datetime
      const now = new Date();
      const convertedDate = now.toISOString().split('.')[0].replace('T', ' ');

      // Get the title from metadata or filename
      const fileTitle = metadata.title || path.basename(fileName, path.extname(fileName));

      // Create standardized frontmatter
      const frontmatter = ['---', `title: ${fileTitle}`, `converted: ${convertedDate}`, 'type: docx', '---', ''].join('\n');

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwibWFtbW90aCIsIkJhc2VTZXJ2aWNlIiwiZm9ybWF0TWV0YWRhdGEiLCJjbGVhbk1ldGFkYXRhIiwiRG9jeENvbnZlcnRlciIsImNvbnN0cnVjdG9yIiwiZmlsZVByb2Nlc3NvciIsImZpbGVTdG9yYWdlIiwic3VwcG9ydGVkRXh0ZW5zaW9ucyIsImFjdGl2ZUNvbnZlcnNpb25zIiwiTWFwIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUNvbnZlcnQiLCJiaW5kIiwiaGFuZGxlUHJldmlldyIsImdlbmVyYXRlQ29udmVyc2lvbklkIiwiRGF0ZSIsIm5vdyIsIk1hdGgiLCJyYW5kb20iLCJ0b1N0cmluZyIsInN1YnN0ciIsInVwZGF0ZUNvbnZlcnNpb25TdGF0dXMiLCJjb252ZXJzaW9uSWQiLCJzdGF0dXMiLCJkZXRhaWxzIiwiY29udmVyc2lvbiIsImdldCIsIk9iamVjdCIsImFzc2lnbiIsIndpbmRvdyIsIndlYkNvbnRlbnRzIiwic2VuZCIsImV2ZW50IiwiZmlsZVBhdGgiLCJidWZmZXIiLCJvcHRpb25zIiwic2VuZGVyIiwiZ2V0T3duZXJCcm93c2VyV2luZG93IiwidGVtcERpciIsImNyZWF0ZVRlbXBEaXIiLCJzZXQiLCJpZCIsInByb2dyZXNzIiwiY29udGVudCIsIkJ1ZmZlciIsImZyb20iLCJmaWxlUmVzdWx0IiwiaGFuZGxlRmlsZVJlYWQiLCJhc0JpbmFyeSIsIkVycm9yIiwicmVzdWx0IiwicHJvY2Vzc0NvbnZlcnNpb24iLCJmaWxlTmFtZSIsIm9yaWdpbmFsRmlsZU5hbWUiLCJuYW1lIiwiYmFzZW5hbWUiLCJlcnJvciIsImNvbnNvbGUiLCJjb252ZXJ0VG9NYXJrZG93biIsImlzUHJldmlldyIsInJlbW92ZSIsImNhdGNoIiwiZXJyIiwibWFtbW90aE9wdGlvbnMiLCJzdHlsZU1hcCIsIm1ldGFkYXRhIiwiZXh0cmFjdE1ldGFkYXRhIiwiY29udmVydFRvSHRtbCIsImh0bWwiLCJ2YWx1ZSIsIndhcm5pbmdzIiwibWVzc2FnZXMiLCJsZW5ndGgiLCJ3YXJuIiwiVHVybmRvd25TZXJ2aWNlIiwidHVybmRvd25TZXJ2aWNlIiwiaGVhZGluZ1N0eWxlIiwiY29kZUJsb2NrU3R5bGUiLCJlbURlbGltaXRlciIsImJ1bGxldExpc3RNYXJrZXIiLCJhZGRSdWxlIiwiZmlsdGVyIiwicmVwbGFjZW1lbnQiLCJub2RlIiwicm93cyIsIm1hcmtkb3duIiwiaGVhZGVyQ2VsbHMiLCJBcnJheSIsImNlbGxzIiwibWFwIiwiY2VsbCIsInRleHRDb250ZW50IiwidHJpbSIsImpvaW4iLCJpIiwibWFya2Rvd25Db250ZW50IiwidHVybmRvd24iLCJjb252ZXJ0ZWREYXRlIiwidG9JU09TdHJpbmciLCJzcGxpdCIsInJlcGxhY2UiLCJmaWxlVGl0bGUiLCJ0aXRsZSIsImV4dG5hbWUiLCJmcm9udG1hdHRlciIsImV4dHJhY3RSYXdUZXh0IiwidGV4dCIsInRpdGxlTWF0Y2giLCJtYXRjaCIsImF1dGhvciIsImRhdGUiLCJzdWJqZWN0Iiwia2V5d29yZHMiLCJwYWdlQ291bnQiLCJlc3RpbWF0ZVBhZ2VDb3VudCIsImNoYXJzUGVyUGFnZSIsIm1heCIsImNlaWwiLCJzdXBwb3J0c0ZpbGUiLCJleHQiLCJ0b0xvd2VyQ2FzZSIsImluY2x1ZGVzIiwiZ2V0SW5mbyIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9Eb2N4Q29udmVydGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRG9jeENvbnZlcnRlci5qc1xuICogSGFuZGxlcyBjb252ZXJzaW9uIG9mIERPQ1ggZmlsZXMgdG8gbWFya2Rvd24gZm9ybWF0IGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXG4gKiBcbiAqIFRoaXMgY29udmVydGVyOlxuICogLSBQYXJzZXMgRE9DWCBmaWxlcyB1c2luZyBtYW1tb3RoXG4gKiAtIEV4dHJhY3RzIHRleHQsIGZvcm1hdHRpbmcsIGFuZCBzdHJ1Y3R1cmVcbiAqIC0gR2VuZXJhdGVzIGNsZWFuIG1hcmtkb3duIG91dHB1dFxuICogXG4gKiBSZWxhdGVkIEZpbGVzOlxuICogLSBCYXNlU2VydmljZS5qczogUGFyZW50IGNsYXNzIHByb3ZpZGluZyBJUEMgaGFuZGxpbmdcbiAqIC0gRmlsZVByb2Nlc3NvclNlcnZpY2UuanM6IFVzZWQgZm9yIGZpbGUgb3BlcmF0aW9uc1xuICogLSBDb252ZXJzaW9uU2VydmljZS5qczogUmVnaXN0ZXJzIGFuZCB1c2VzIHRoaXMgY29udmVydGVyXG4gKi9cblxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcbmNvbnN0IG1hbW1vdGggPSByZXF1aXJlKCdtYW1tb3RoJyk7XG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL0Jhc2VTZXJ2aWNlJyk7XG5jb25zdCB7IGZvcm1hdE1ldGFkYXRhLCBjbGVhbk1ldGFkYXRhIH0gPSByZXF1aXJlKCcuLi8uLi8uLi91dGlscy9tYXJrZG93bicpO1xuXG5jbGFzcyBEb2N4Q29udmVydGVyIGV4dGVuZHMgQmFzZVNlcnZpY2Uge1xuICAgIGNvbnN0cnVjdG9yKGZpbGVQcm9jZXNzb3IsIGZpbGVTdG9yYWdlKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMuZmlsZVByb2Nlc3NvciA9IGZpbGVQcm9jZXNzb3I7XG4gICAgICAgIHRoaXMuZmlsZVN0b3JhZ2UgPSBmaWxlU3RvcmFnZTtcbiAgICAgICAgdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zID0gWycuZG9jeCcsICcuZG9jJ107XG4gICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMgPSBuZXcgTWFwKCk7XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIERPQ1ggY29udmVyc2lvblxuICAgICAqL1xuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OmRvY3gnLCB0aGlzLmhhbmRsZUNvbnZlcnQuYmluZCh0aGlzKSk7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OmRvY3g6cHJldmlldycsIHRoaXMuaGFuZGxlUHJldmlldy5iaW5kKHRoaXMpKTtcbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogR2VuZXJhdGUgYSB1bmlxdWUgY29udmVyc2lvbiBJRFxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IFVuaXF1ZSBjb252ZXJzaW9uIElEXG4gICAgICovXG4gICAgZ2VuZXJhdGVDb252ZXJzaW9uSWQoKSB7XG4gICAgICAgIHJldHVybiBgZG9jeF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyKDIsIDkpfWA7XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIFVwZGF0ZSBjb252ZXJzaW9uIHN0YXR1cyBhbmQgbm90aWZ5IHJlbmRlcmVyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzdGF0dXMgLSBOZXcgc3RhdHVzXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGRldGFpbHMgLSBBZGRpdGlvbmFsIGRldGFpbHNcbiAgICAgKi9cbiAgICB1cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgc3RhdHVzLCBkZXRhaWxzID0ge30pIHtcbiAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XG4gICAgICAgIGlmIChjb252ZXJzaW9uKSB7XG4gICAgICAgICAgICBjb252ZXJzaW9uLnN0YXR1cyA9IHN0YXR1cztcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oY29udmVyc2lvbiwgZGV0YWlscyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uLndpbmRvdykge1xuICAgICAgICAgICAgICAgIGNvbnZlcnNpb24ud2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ2RvY3g6Y29udmVyc2lvbi1wcm9ncmVzcycsIHtcbiAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvbklkLFxuICAgICAgICAgICAgICAgICAgICBzdGF0dXMsXG4gICAgICAgICAgICAgICAgICAgIC4uLmRldGFpbHNcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvKipcbiAgICAgKiBIYW5kbGUgRE9DWCBjb252ZXJzaW9uIHJlcXVlc3RcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIENvbnZlcnNpb24gcmVxdWVzdCBkZXRhaWxzXG4gICAgICovXG4gICAgYXN5bmMgaGFuZGxlQ29udmVydChldmVudCwgeyBmaWxlUGF0aCwgYnVmZmVyLCBvcHRpb25zID0ge30gfSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbklkID0gdGhpcy5nZW5lcmF0ZUNvbnZlcnNpb25JZCgpO1xuICAgICAgICAgICAgY29uc3Qgd2luZG93ID0gZXZlbnQuc2VuZGVyLmdldE93bmVyQnJvd3NlcldpbmRvdygpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDcmVhdGUgdGVtcCBkaXJlY3RvcnkgZm9yIHRoaXMgY29udmVyc2lvblxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IHRoaXMuZmlsZVN0b3JhZ2UuY3JlYXRlVGVtcERpcignZG9jeF9jb252ZXJzaW9uJyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2V0KGNvbnZlcnNpb25JZCwge1xuICAgICAgICAgICAgICAgIGlkOiBjb252ZXJzaW9uSWQsXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnc3RhcnRpbmcnLFxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAwLFxuICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxuICAgICAgICAgICAgICAgIHRlbXBEaXIsXG4gICAgICAgICAgICAgICAgd2luZG93XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gTm90aWZ5IGNsaWVudCB0aGF0IGNvbnZlcnNpb24gaGFzIHN0YXJ0ZWRcbiAgICAgICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdkb2N4OmNvbnZlcnNpb24tc3RhcnRlZCcsIHsgY29udmVyc2lvbklkIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBsZXQgY29udGVudDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGJ1ZmZlcikge1xuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBCdWZmZXIuZnJvbShidWZmZXIpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChmaWxlUGF0aCkge1xuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdyZWFkaW5nX2ZpbGUnLCB7IHByb2dyZXNzOiAxMCB9KTtcbiAgICAgICAgICAgICAgICBjb25zdCBmaWxlUmVzdWx0ID0gYXdhaXQgdGhpcy5maWxlUHJvY2Vzc29yLmhhbmRsZUZpbGVSZWFkKG51bGwsIHtcbiAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIGFzQmluYXJ5OiB0cnVlXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IGZpbGVSZXN1bHQuY29udGVudDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBmaWxlIHBhdGggb3IgYnVmZmVyIHByb3ZpZGVkJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFN0YXJ0IGNvbnZlcnNpb24gcHJvY2Vzc1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIGNvbnRlbnQsIHtcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGggfHwgJ2RvY3VtZW50LmRvY3gnKVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnRlbnQ6IHJlc3VsdCB9O1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0RvY3hDb252ZXJ0ZXJdIENvbnZlcnNpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSGFuZGxlIERPQ1ggcHJldmlldyByZXF1ZXN0XG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBQcmV2aWV3IHJlcXVlc3QgZGV0YWlsc1xuICAgICAqL1xuICAgIGFzeW5jIGhhbmRsZVByZXZpZXcoZXZlbnQsIHsgZmlsZVBhdGgsIGJ1ZmZlciwgb3B0aW9ucyA9IHt9IH0pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGxldCBjb250ZW50O1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoYnVmZmVyKSB7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IEJ1ZmZlci5mcm9tKGJ1ZmZlcik7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGZpbGVQYXRoKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZmlsZVJlc3VsdCA9IGF3YWl0IHRoaXMuZmlsZVByb2Nlc3Nvci5oYW5kbGVGaWxlUmVhZChudWxsLCB7XG4gICAgICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxuICAgICAgICAgICAgICAgICAgICBhc0JpbmFyeTogdHJ1ZVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBmaWxlUmVzdWx0LmNvbnRlbnQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gZmlsZSBwYXRoIG9yIGJ1ZmZlciBwcm92aWRlZCcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIHtcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgICAgICAgIGlzUHJldmlldzogdHJ1ZSxcbiAgICAgICAgICAgICAgICBmaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IG9wdGlvbnMubmFtZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoIHx8ICdkb2N1bWVudC5kb2N4JylcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4geyBjb250ZW50OiByZXN1bHQgfTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tEb2N4Q29udmVydGVyXSBQcmV2aWV3IGdlbmVyYXRpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIFByb2Nlc3MgRE9DWCBjb252ZXJzaW9uXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxuICAgICAqIEBwYXJhbSB7QnVmZmVyfSBjb250ZW50IC0gRE9DWCBjb250ZW50IGFzIGJ1ZmZlclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXG4gICAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gTWFya2Rvd24gY29udGVudFxuICAgICAqL1xuICAgIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgY29udGVudCwgb3B0aW9ucykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XG4gICAgICAgICAgICBpZiAoIWNvbnZlcnNpb24pIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbnZlcnNpb24gbm90IGZvdW5kJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdleHRyYWN0aW5nX2NvbnRlbnQnLCB7IHByb2dyZXNzOiAzMCB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRXh0cmFjdCBkb2N1bWVudCBjb250ZW50IGFuZCBtZXRhZGF0YVxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCBvcHRpb25zKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2NvbXBsZXRlZCcsIHsgXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDEwMCxcbiAgICAgICAgICAgICAgICByZXN1bHRcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24udGVtcERpcikge1xuICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZShjb252ZXJzaW9uLnRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtEb2N4Q29udmVydGVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3Rvcnk6ICR7Y29udmVyc2lvbi50ZW1wRGlyfWAsIGVycik7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRG9jeENvbnZlcnRlcl0gQ29udmVyc2lvbiBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uICYmIGNvbnZlcnNpb24udGVtcERpcikge1xuICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZShjb252ZXJzaW9uLnRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtEb2N4Q29udmVydGVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3Rvcnk6ICR7Y29udmVyc2lvbi50ZW1wRGlyfWAsIGVycik7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29udmVydCBET0NYIGNvbnRlbnQgdG8gbWFya2Rvd25cbiAgICAgKiBAcGFyYW0ge0J1ZmZlcn0gY29udGVudCAtIERPQ1ggY29udGVudCBhcyBidWZmZXJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IE1hcmtkb3duIGNvbnRlbnRcbiAgICAgKi9cbiAgICBhc3luYyBjb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCBvcHRpb25zID0ge30pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gb3B0aW9ucy5maWxlTmFtZSB8fCAnZG9jdW1lbnQuZG9jeCc7XG4gICAgICAgICAgICBjb25zdCBpc1ByZXZpZXcgPSBvcHRpb25zLmlzUHJldmlldyB8fCBmYWxzZTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ29uZmlndXJlIE1hbW1vdGggb3B0aW9uc1xuICAgICAgICAgICAgY29uc3QgbWFtbW90aE9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgc3R5bGVNYXA6IFtcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0hlYWRpbmcgMSddID0+ICMgJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0hlYWRpbmcgMiddID0+ICMjICQxXCIsXG4gICAgICAgICAgICAgICAgICAgIFwicFtzdHlsZS1uYW1lPSdIZWFkaW5nIDMnXSA9PiAjIyMgJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0hlYWRpbmcgNCddID0+ICMjIyMgJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0hlYWRpbmcgNSddID0+ICMjIyMjICQxXCIsXG4gICAgICAgICAgICAgICAgICAgIFwicFtzdHlsZS1uYW1lPSdIZWFkaW5nIDYnXSA9PiAjIyMjIyMgJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJyW3N0eWxlLW5hbWU9J1N0cm9uZyddID0+ICoqJDEqKlwiLFxuICAgICAgICAgICAgICAgICAgICBcInJbc3R5bGUtbmFtZT0nRW1waGFzaXMnXSA9PiAqJDEqXCIsXG4gICAgICAgICAgICAgICAgICAgIFwicFtzdHlsZS1uYW1lPSdRdW90ZSddID0+ID4gJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0xpc3QgUGFyYWdyYXBoJ10gPT4gKiAkMVwiLFxuICAgICAgICAgICAgICAgICAgICBcInRhYmxlID0+ICQxXCIsXG4gICAgICAgICAgICAgICAgICAgIFwidHIgPT4gJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJ0ZCA9PiAkMVwiXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRXh0cmFjdCBkb2N1bWVudCBtZXRhZGF0YVxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB0aGlzLmV4dHJhY3RNZXRhZGF0YShjb250ZW50KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ29udmVydCBET0NYIHRvIEhUTUxcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG1hbW1vdGguY29udmVydFRvSHRtbCh7IGJ1ZmZlcjogY29udGVudCB9LCBtYW1tb3RoT3B0aW9ucyk7XG4gICAgICAgICAgICBjb25zdCBodG1sID0gcmVzdWx0LnZhbHVlO1xuICAgICAgICAgICAgY29uc3Qgd2FybmluZ3MgPSByZXN1bHQubWVzc2FnZXM7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICh3YXJuaW5ncy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdbRG9jeENvbnZlcnRlcl0gQ29udmVyc2lvbiB3YXJuaW5nczonLCB3YXJuaW5ncyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENvbnZlcnQgSFRNTCB0byBNYXJrZG93blxuICAgICAgICAgICAgY29uc3QgVHVybmRvd25TZXJ2aWNlID0gcmVxdWlyZSgndHVybmRvd24nKTtcbiAgICAgICAgICAgIGNvbnN0IHR1cm5kb3duU2VydmljZSA9IG5ldyBUdXJuZG93blNlcnZpY2Uoe1xuICAgICAgICAgICAgICAgIGhlYWRpbmdTdHlsZTogJ2F0eCcsXG4gICAgICAgICAgICAgICAgY29kZUJsb2NrU3R5bGU6ICdmZW5jZWQnLFxuICAgICAgICAgICAgICAgIGVtRGVsaW1pdGVyOiAnKicsXG4gICAgICAgICAgICAgICAgYnVsbGV0TGlzdE1hcmtlcjogJy0nXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3VzdG9taXplIHR1cm5kb3duXG4gICAgICAgICAgICB0dXJuZG93blNlcnZpY2UuYWRkUnVsZSgndGFibGVzJywge1xuICAgICAgICAgICAgICAgIGZpbHRlcjogJ3RhYmxlJyxcbiAgICAgICAgICAgICAgICByZXBsYWNlbWVudDogZnVuY3Rpb24oY29udGVudCwgbm9kZSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBIZWFkZXJzIGFyZSB0aGUgZmlyc3Qgcm93XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJvd3MgPSBub2RlLnJvd3M7XG4gICAgICAgICAgICAgICAgICAgIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgcmV0dXJuICcnO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgbGV0IG1hcmtkb3duID0gJ1xcblxcbic7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyBQcm9jZXNzIGhlYWRlciByb3dcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaGVhZGVyQ2VsbHMgPSBBcnJheS5mcm9tKHJvd3NbMF0uY2VsbHMpO1xuICAgICAgICAgICAgICAgICAgICBtYXJrZG93biArPSAnfCAnICsgaGVhZGVyQ2VsbHMubWFwKGNlbGwgPT4gY2VsbC50ZXh0Q29udGVudC50cmltKCkpLmpvaW4oJyB8ICcpICsgJyB8XFxuJztcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24gKz0gJ3wgJyArIGhlYWRlckNlbGxzLm1hcCgoKSA9PiAnLS0tJykuam9pbignIHwgJykgKyAnIHxcXG4nO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gUHJvY2VzcyBkYXRhIHJvd3NcbiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDE7IGkgPCByb3dzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjZWxscyA9IEFycmF5LmZyb20ocm93c1tpXS5jZWxscyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBtYXJrZG93biArPSAnfCAnICsgY2VsbHMubWFwKGNlbGwgPT4gY2VsbC50ZXh0Q29udGVudC50cmltKCkpLmpvaW4oJyB8ICcpICsgJyB8XFxuJztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1hcmtkb3duO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDb252ZXJ0IEhUTUwgdG8gbWFya2Rvd25cbiAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duQ29udGVudCA9IHR1cm5kb3duU2VydmljZS50dXJuZG93bihodG1sKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gR2V0IGN1cnJlbnQgZGF0ZXRpbWVcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICBjb25zdCBjb252ZXJ0ZWREYXRlID0gbm93LnRvSVNPU3RyaW5nKCkuc3BsaXQoJy4nKVswXS5yZXBsYWNlKCdUJywgJyAnKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gR2V0IHRoZSB0aXRsZSBmcm9tIG1ldGFkYXRhIG9yIGZpbGVuYW1lXG4gICAgICAgICAgICBjb25zdCBmaWxlVGl0bGUgPSBtZXRhZGF0YS50aXRsZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVOYW1lLCBwYXRoLmV4dG5hbWUoZmlsZU5hbWUpKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBmcm9udG1hdHRlclxuICAgICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBbXG4gICAgICAgICAgICAgICAgJy0tLScsXG4gICAgICAgICAgICAgICAgYHRpdGxlOiAke2ZpbGVUaXRsZX1gLFxuICAgICAgICAgICAgICAgIGBjb252ZXJ0ZWQ6ICR7Y29udmVydGVkRGF0ZX1gLFxuICAgICAgICAgICAgICAgICd0eXBlOiBkb2N4JyxcbiAgICAgICAgICAgICAgICAnLS0tJyxcbiAgICAgICAgICAgICAgICAnJ1xuICAgICAgICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ29tYmluZSBmcm9udG1hdHRlciBhbmQgY29udGVudFxuICAgICAgICAgICAgcmV0dXJuIGZyb250bWF0dGVyICsgbWFya2Rvd25Db250ZW50O1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0RvY3hDb252ZXJ0ZXJdIE1hcmtkb3duIGNvbnZlcnNpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIEV4dHJhY3QgbWV0YWRhdGEgZnJvbSBET0NYIGRvY3VtZW50XG4gICAgICogQHBhcmFtIHtCdWZmZXJ9IGNvbnRlbnQgLSBET0NYIGNvbnRlbnQgYXMgYnVmZmVyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gRG9jdW1lbnQgbWV0YWRhdGFcbiAgICAgKi9cbiAgICBhc3luYyBleHRyYWN0TWV0YWRhdGEoY29udGVudCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gVXNlIG1hbW1vdGggdG8gZXh0cmFjdCBtZXRhZGF0YVxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgbWFtbW90aC5leHRyYWN0UmF3VGV4dCh7IGJ1ZmZlcjogY29udGVudCB9KTtcbiAgICAgICAgICAgIGNvbnN0IHRleHQgPSByZXN1bHQudmFsdWU7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFRyeSB0byBleHRyYWN0IHRpdGxlIGZyb20gZmlyc3QgaGVhZGluZ1xuICAgICAgICAgICAgbGV0IHRpdGxlID0gJyc7XG4gICAgICAgICAgICBjb25zdCB0aXRsZU1hdGNoID0gdGV4dC5tYXRjaCgvXiguKykoPzpcXHI/XFxuKS8pO1xuICAgICAgICAgICAgaWYgKHRpdGxlTWF0Y2gpIHtcbiAgICAgICAgICAgICAgICB0aXRsZSA9IHRpdGxlTWF0Y2hbMV0udHJpbSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBSZXR1cm4gYmFzaWMgbWV0YWRhdGFcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdGl0bGUsXG4gICAgICAgICAgICAgICAgYXV0aG9yOiAnJyxcbiAgICAgICAgICAgICAgICBkYXRlOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXSxcbiAgICAgICAgICAgICAgICBzdWJqZWN0OiAnJyxcbiAgICAgICAgICAgICAgICBrZXl3b3JkczogJycsXG4gICAgICAgICAgICAgICAgcGFnZUNvdW50OiB0aGlzLmVzdGltYXRlUGFnZUNvdW50KHRleHQpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0RvY3hDb252ZXJ0ZXJdIEZhaWxlZCB0byBleHRyYWN0IG1ldGFkYXRhOicsIGVycm9yKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdGl0bGU6ICcnLFxuICAgICAgICAgICAgICAgIGF1dGhvcjogJycsXG4gICAgICAgICAgICAgICAgZGF0ZTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF0sXG4gICAgICAgICAgICAgICAgc3ViamVjdDogJycsXG4gICAgICAgICAgICAgICAga2V5d29yZHM6ICcnLFxuICAgICAgICAgICAgICAgIHBhZ2VDb3VudDogMVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvKipcbiAgICAgKiBFc3RpbWF0ZSBwYWdlIGNvdW50IGJhc2VkIG9uIHRleHQgbGVuZ3RoXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHRleHQgLSBEb2N1bWVudCB0ZXh0XG4gICAgICogQHJldHVybnMge251bWJlcn0gRXN0aW1hdGVkIHBhZ2UgY291bnRcbiAgICAgKi9cbiAgICBlc3RpbWF0ZVBhZ2VDb3VudCh0ZXh0KSB7XG4gICAgICAgIC8vIFJvdWdoIGVzdGltYXRlOiAzMDAwIGNoYXJhY3RlcnMgcGVyIHBhZ2VcbiAgICAgICAgY29uc3QgY2hhcnNQZXJQYWdlID0gMzAwMDtcbiAgICAgICAgcmV0dXJuIE1hdGgubWF4KDEsIE1hdGguY2VpbCh0ZXh0Lmxlbmd0aCAvIGNoYXJzUGVyUGFnZSkpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrIGlmIHRoaXMgY29udmVydGVyIHN1cHBvcnRzIHRoZSBnaXZlbiBmaWxlXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBmaWxlXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXG4gICAgICovXG4gICAgc3VwcG9ydHNGaWxlKGZpbGVQYXRoKSB7XG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucy5pbmNsdWRlcyhleHQpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xuICAgICAqL1xuICAgIGdldEluZm8oKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBuYW1lOiAnRE9DWCBDb252ZXJ0ZXInLFxuICAgICAgICAgICAgZXh0ZW5zaW9uczogdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb252ZXJ0cyBET0NYIGZpbGVzIHRvIG1hcmtkb3duJyxcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICB0aXRsZTogJ09wdGlvbmFsIGRvY3VtZW50IHRpdGxlJyxcbiAgICAgICAgICAgICAgICBpc1ByZXZpZXc6ICdXaGV0aGVyIHRvIGdlbmVyYXRlIGEgcHJldmlldyAoZGVmYXVsdDogZmFsc2UpJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBEb2N4Q29udmVydGVyO1xuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1DLEVBQUUsR0FBR0QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUM5QixNQUFNRSxPQUFPLEdBQUdGLE9BQU8sQ0FBQyxTQUFTLENBQUM7QUFDbEMsTUFBTUcsV0FB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