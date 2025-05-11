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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwibWFtbW90aCIsIkJhc2VTZXJ2aWNlIiwiZm9ybWF0TWV0YWRhdGEiLCJjbGVhbk1ldGFkYXRhIiwiRG9jeENvbnZlcnRlciIsImNvbnN0cnVjdG9yIiwiZmlsZVByb2Nlc3NvciIsImZpbGVTdG9yYWdlIiwic3VwcG9ydGVkRXh0ZW5zaW9ucyIsImFjdGl2ZUNvbnZlcnNpb25zIiwiTWFwIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUNvbnZlcnQiLCJiaW5kIiwiaGFuZGxlUHJldmlldyIsImdlbmVyYXRlQ29udmVyc2lvbklkIiwiRGF0ZSIsIm5vdyIsIk1hdGgiLCJyYW5kb20iLCJ0b1N0cmluZyIsInN1YnN0ciIsInVwZGF0ZUNvbnZlcnNpb25TdGF0dXMiLCJjb252ZXJzaW9uSWQiLCJzdGF0dXMiLCJkZXRhaWxzIiwiY29udmVyc2lvbiIsImdldCIsIk9iamVjdCIsImFzc2lnbiIsIndpbmRvdyIsIndlYkNvbnRlbnRzIiwic2VuZCIsImV2ZW50IiwiZmlsZVBhdGgiLCJidWZmZXIiLCJvcHRpb25zIiwic2VuZGVyIiwiZ2V0T3duZXJCcm93c2VyV2luZG93IiwidGVtcERpciIsImNyZWF0ZVRlbXBEaXIiLCJzZXQiLCJpZCIsInByb2dyZXNzIiwiY29udGVudCIsIkJ1ZmZlciIsImZyb20iLCJmaWxlUmVzdWx0IiwiaGFuZGxlRmlsZVJlYWQiLCJhc0JpbmFyeSIsIkVycm9yIiwicmVzdWx0IiwicHJvY2Vzc0NvbnZlcnNpb24iLCJmaWxlTmFtZSIsIm9yaWdpbmFsRmlsZU5hbWUiLCJuYW1lIiwiYmFzZW5hbWUiLCJlcnJvciIsImNvbnNvbGUiLCJjb252ZXJ0VG9NYXJrZG93biIsImlzUHJldmlldyIsInJlbW92ZSIsImNhdGNoIiwiZXJyIiwibWFtbW90aE9wdGlvbnMiLCJzdHlsZU1hcCIsIm1ldGFkYXRhIiwiZXh0cmFjdE1ldGFkYXRhIiwiY29udmVydFRvSHRtbCIsImh0bWwiLCJ2YWx1ZSIsIndhcm5pbmdzIiwibWVzc2FnZXMiLCJsZW5ndGgiLCJ3YXJuIiwiVHVybmRvd25TZXJ2aWNlIiwidHVybmRvd25TZXJ2aWNlIiwiaGVhZGluZ1N0eWxlIiwiY29kZUJsb2NrU3R5bGUiLCJlbURlbGltaXRlciIsImJ1bGxldExpc3RNYXJrZXIiLCJhZGRSdWxlIiwiZmlsdGVyIiwicmVwbGFjZW1lbnQiLCJub2RlIiwicm93cyIsIm1hcmtkb3duIiwiaGVhZGVyQ2VsbHMiLCJBcnJheSIsImNlbGxzIiwibWFwIiwiY2VsbCIsInRleHRDb250ZW50IiwidHJpbSIsImpvaW4iLCJpIiwibWFya2Rvd25Db250ZW50IiwidHVybmRvd24iLCJjb252ZXJ0ZWREYXRlIiwidG9JU09TdHJpbmciLCJzcGxpdCIsInJlcGxhY2UiLCJmaWxlVGl0bGUiLCJ0aXRsZSIsImV4dG5hbWUiLCJmcm9udG1hdHRlciIsImV4dHJhY3RSYXdUZXh0IiwidGV4dCIsInRpdGxlTWF0Y2giLCJtYXRjaCIsImF1dGhvciIsImRhdGUiLCJzdWJqZWN0Iiwia2V5d29yZHMiLCJwYWdlQ291bnQiLCJlc3RpbWF0ZVBhZ2VDb3VudCIsImNoYXJzUGVyUGFnZSIsIm1heCIsImNlaWwiLCJzdXBwb3J0c0ZpbGUiLCJleHQiLCJ0b0xvd2VyQ2FzZSIsImluY2x1ZGVzIiwiZ2V0SW5mbyIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9Eb2N4Q29udmVydGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRG9jeENvbnZlcnRlci5qc1xuICogSGFuZGxlcyBjb252ZXJzaW9uIG9mIERPQ1ggZmlsZXMgdG8gbWFya2Rvd24gZm9ybWF0IGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXG4gKiBcbiAqIFRoaXMgY29udmVydGVyOlxuICogLSBQYXJzZXMgRE9DWCBmaWxlcyB1c2luZyBtYW1tb3RoXG4gKiAtIEV4dHJhY3RzIHRleHQsIGZvcm1hdHRpbmcsIGFuZCBzdHJ1Y3R1cmVcbiAqIC0gR2VuZXJhdGVzIGNsZWFuIG1hcmtkb3duIG91dHB1dFxuICogXG4gKiBSZWxhdGVkIEZpbGVzOlxuICogLSBCYXNlU2VydmljZS5qczogUGFyZW50IGNsYXNzIHByb3ZpZGluZyBJUEMgaGFuZGxpbmdcbiAqIC0gRmlsZVByb2Nlc3NvclNlcnZpY2UuanM6IFVzZWQgZm9yIGZpbGUgb3BlcmF0aW9uc1xuICogLSBDb252ZXJzaW9uU2VydmljZS5qczogUmVnaXN0ZXJzIGFuZCB1c2VzIHRoaXMgY29udmVydGVyXG4gKi9cblxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcbmNvbnN0IG1hbW1vdGggPSByZXF1aXJlKCdtYW1tb3RoJyk7XG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL0Jhc2VTZXJ2aWNlJyk7XG5jb25zdCB7IGZvcm1hdE1ldGFkYXRhLCBjbGVhbk1ldGFkYXRhIH0gPSByZXF1aXJlKCcuLi8uLi8uLi91dGlscy9tYXJrZG93bicpO1xuXG5jbGFzcyBEb2N4Q29udmVydGVyIGV4dGVuZHMgQmFzZVNlcnZpY2Uge1xuICAgIGNvbnN0cnVjdG9yKGZpbGVQcm9jZXNzb3IsIGZpbGVTdG9yYWdlKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMuZmlsZVByb2Nlc3NvciA9IGZpbGVQcm9jZXNzb3I7XG4gICAgICAgIHRoaXMuZmlsZVN0b3JhZ2UgPSBmaWxlU3RvcmFnZTtcbiAgICAgICAgdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zID0gWycuZG9jeCcsICcuZG9jJ107XG4gICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMgPSBuZXcgTWFwKCk7XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIERPQ1ggY29udmVyc2lvblxuICAgICAqL1xuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OmRvY3gnLCB0aGlzLmhhbmRsZUNvbnZlcnQuYmluZCh0aGlzKSk7XG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OmRvY3g6cHJldmlldycsIHRoaXMuaGFuZGxlUHJldmlldy5iaW5kKHRoaXMpKTtcbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogR2VuZXJhdGUgYSB1bmlxdWUgY29udmVyc2lvbiBJRFxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IFVuaXF1ZSBjb252ZXJzaW9uIElEXG4gICAgICovXG4gICAgZ2VuZXJhdGVDb252ZXJzaW9uSWQoKSB7XG4gICAgICAgIHJldHVybiBgZG9jeF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyKDIsIDkpfWA7XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIFVwZGF0ZSBjb252ZXJzaW9uIHN0YXR1cyBhbmQgbm90aWZ5IHJlbmRlcmVyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzdGF0dXMgLSBOZXcgc3RhdHVzXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGRldGFpbHMgLSBBZGRpdGlvbmFsIGRldGFpbHNcbiAgICAgKi9cbiAgICB1cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgc3RhdHVzLCBkZXRhaWxzID0ge30pIHtcbiAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XG4gICAgICAgIGlmIChjb252ZXJzaW9uKSB7XG4gICAgICAgICAgICBjb252ZXJzaW9uLnN0YXR1cyA9IHN0YXR1cztcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oY29udmVyc2lvbiwgZGV0YWlscyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uLndpbmRvdykge1xuICAgICAgICAgICAgICAgIGNvbnZlcnNpb24ud2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ2RvY3g6Y29udmVyc2lvbi1wcm9ncmVzcycsIHtcbiAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvbklkLFxuICAgICAgICAgICAgICAgICAgICBzdGF0dXMsXG4gICAgICAgICAgICAgICAgICAgIC4uLmRldGFpbHNcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvKipcbiAgICAgKiBIYW5kbGUgRE9DWCBjb252ZXJzaW9uIHJlcXVlc3RcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIENvbnZlcnNpb24gcmVxdWVzdCBkZXRhaWxzXG4gICAgICovXG4gICAgYXN5bmMgaGFuZGxlQ29udmVydChldmVudCwgeyBmaWxlUGF0aCwgYnVmZmVyLCBvcHRpb25zID0ge30gfSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbklkID0gdGhpcy5nZW5lcmF0ZUNvbnZlcnNpb25JZCgpO1xuICAgICAgICAgICAgY29uc3Qgd2luZG93ID0gZXZlbnQ/LnNlbmRlcj8uZ2V0T3duZXJCcm93c2VyV2luZG93Py4oKSB8fCBudWxsO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDcmVhdGUgdGVtcCBkaXJlY3RvcnkgZm9yIHRoaXMgY29udmVyc2lvblxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IHRoaXMuZmlsZVN0b3JhZ2UuY3JlYXRlVGVtcERpcignZG9jeF9jb252ZXJzaW9uJyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2V0KGNvbnZlcnNpb25JZCwge1xuICAgICAgICAgICAgICAgIGlkOiBjb252ZXJzaW9uSWQsXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnc3RhcnRpbmcnLFxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAwLFxuICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxuICAgICAgICAgICAgICAgIHRlbXBEaXIsXG4gICAgICAgICAgICAgICAgd2luZG93XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gTm90aWZ5IGNsaWVudCB0aGF0IGNvbnZlcnNpb24gaGFzIHN0YXJ0ZWQgKG9ubHkgaWYgd2UgaGF2ZSBhIHZhbGlkIHdpbmRvdylcbiAgICAgICAgICAgIGlmICh3aW5kb3cgJiYgd2luZG93LndlYkNvbnRlbnRzKSB7XG4gICAgICAgICAgICAgICAgd2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ2RvY3g6Y29udmVyc2lvbi1zdGFydGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGxldCBjb250ZW50O1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoYnVmZmVyKSB7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IEJ1ZmZlci5mcm9tKGJ1ZmZlcik7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGZpbGVQYXRoKSB7XG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ3JlYWRpbmdfZmlsZScsIHsgcHJvZ3Jlc3M6IDEwIH0pO1xuICAgICAgICAgICAgICAgIGNvbnN0IGZpbGVSZXN1bHQgPSBhd2FpdCB0aGlzLmZpbGVQcm9jZXNzb3IuaGFuZGxlRmlsZVJlYWQobnVsbCwge1xuICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgYXNCaW5hcnk6IHRydWVcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gZmlsZVJlc3VsdC5jb250ZW50O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIGZpbGUgcGF0aCBvciBidWZmZXIgcHJvdmlkZWQnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gU3RhcnQgY29udmVyc2lvbiBwcm9jZXNzXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgY29udGVudCwge1xuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgICAgICAgICAgZmlsZU5hbWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBvcHRpb25zLm5hbWUgfHwgcGF0aC5iYXNlbmFtZShmaWxlUGF0aCB8fCAnZG9jdW1lbnQuZG9jeCcpXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHsgY29udGVudDogcmVzdWx0IH07XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRG9jeENvbnZlcnRlcl0gQ29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBIYW5kbGUgRE9DWCBwcmV2aWV3IHJlcXVlc3RcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFByZXZpZXcgcmVxdWVzdCBkZXRhaWxzXG4gICAgICovXG4gICAgYXN5bmMgaGFuZGxlUHJldmlldyhldmVudCwgeyBmaWxlUGF0aCwgYnVmZmVyLCBvcHRpb25zID0ge30gfSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgbGV0IGNvbnRlbnQ7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChidWZmZXIpIHtcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gQnVmZmVyLmZyb20oYnVmZmVyKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZmlsZVBhdGgpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBmaWxlUmVzdWx0ID0gYXdhaXQgdGhpcy5maWxlUHJvY2Vzc29yLmhhbmRsZUZpbGVSZWFkKG51bGwsIHtcbiAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIGFzQmluYXJ5OiB0cnVlXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IGZpbGVSZXN1bHQuY29udGVudDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBmaWxlIHBhdGggb3IgYnVmZmVyIHByb3ZpZGVkJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29udmVydFRvTWFya2Rvd24oY29udGVudCwge1xuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgICAgICAgICAgaXNQcmV2aWV3OiB0cnVlLFxuICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGggfHwgJ2RvY3VtZW50LmRvY3gnKVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnRlbnQ6IHJlc3VsdCB9O1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0RvY3hDb252ZXJ0ZXJdIFByZXZpZXcgZ2VuZXJhdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogUHJvY2VzcyBET0NYIGNvbnZlcnNpb25cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXG4gICAgICogQHBhcmFtIHtCdWZmZXJ9IGNvbnRlbnQgLSBET0NYIGNvbnRlbnQgYXMgYnVmZmVyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBNYXJrZG93biBjb250ZW50XG4gICAgICovXG4gICAgYXN5bmMgcHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCBjb250ZW50LCBvcHRpb25zKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcbiAgICAgICAgICAgIGlmICghY29udmVyc2lvbikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVyc2lvbiBub3QgZm91bmQnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2V4dHJhY3RpbmdfY29udGVudCcsIHsgcHJvZ3Jlc3M6IDMwIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGRvY3VtZW50IGNvbnRlbnQgYW5kIG1ldGFkYXRhXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIG9wdGlvbnMpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnY29tcGxldGVkJywgeyBcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMTAwLFxuICAgICAgICAgICAgICAgIHJlc3VsdFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XG4gICAgICAgICAgICBpZiAoY29udmVyc2lvbi50ZW1wRGlyKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGNvbnZlcnNpb24udGVtcERpcikuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0RvY3hDb252ZXJ0ZXJdIEZhaWxlZCB0byBjbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeTogJHtjb252ZXJzaW9uLnRlbXBEaXJ9YCwgZXJyKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tEb2N4Q29udmVydGVyXSBDb252ZXJzaW9uIHByb2Nlc3NpbmcgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24gJiYgY29udmVyc2lvbi50ZW1wRGlyKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGNvbnZlcnNpb24udGVtcERpcikuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0RvY3hDb252ZXJ0ZXJdIEZhaWxlZCB0byBjbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeTogJHtjb252ZXJzaW9uLnRlbXBEaXJ9YCwgZXJyKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb252ZXJ0IERPQ1ggY29udGVudCB0byBtYXJrZG93blxuICAgICAqIEBwYXJhbSB7QnVmZmVyfSBjb250ZW50IC0gRE9DWCBjb250ZW50IGFzIGJ1ZmZlclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXG4gICAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gTWFya2Rvd24gY29udGVudFxuICAgICAqL1xuICAgIGFzeW5jIGNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIG9wdGlvbnMgPSB7fSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZmlsZU5hbWUgPSBvcHRpb25zLmZpbGVOYW1lIHx8ICdkb2N1bWVudC5kb2N4JztcbiAgICAgICAgICAgIGNvbnN0IGlzUHJldmlldyA9IG9wdGlvbnMuaXNQcmV2aWV3IHx8IGZhbHNlO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDb25maWd1cmUgTWFtbW90aCBvcHRpb25zXG4gICAgICAgICAgICBjb25zdCBtYW1tb3RoT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBzdHlsZU1hcDogW1xuICAgICAgICAgICAgICAgICAgICBcInBbc3R5bGUtbmFtZT0nSGVhZGluZyAxJ10gPT4gIyAkMVwiLFxuICAgICAgICAgICAgICAgICAgICBcInBbc3R5bGUtbmFtZT0nSGVhZGluZyAyJ10gPT4gIyMgJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0hlYWRpbmcgMyddID0+ICMjIyAkMVwiLFxuICAgICAgICAgICAgICAgICAgICBcInBbc3R5bGUtbmFtZT0nSGVhZGluZyA0J10gPT4gIyMjIyAkMVwiLFxuICAgICAgICAgICAgICAgICAgICBcInBbc3R5bGUtbmFtZT0nSGVhZGluZyA1J10gPT4gIyMjIyMgJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0hlYWRpbmcgNiddID0+ICMjIyMjIyAkMVwiLFxuICAgICAgICAgICAgICAgICAgICBcInJbc3R5bGUtbmFtZT0nU3Ryb25nJ10gPT4gKiokMSoqXCIsXG4gICAgICAgICAgICAgICAgICAgIFwicltzdHlsZS1uYW1lPSdFbXBoYXNpcyddID0+ICokMSpcIixcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J1F1b3RlJ10gPT4gPiAkMVwiLFxuICAgICAgICAgICAgICAgICAgICBcInBbc3R5bGUtbmFtZT0nTGlzdCBQYXJhZ3JhcGgnXSA9PiAqICQxXCIsXG4gICAgICAgICAgICAgICAgICAgIFwidGFibGUgPT4gJDFcIixcbiAgICAgICAgICAgICAgICAgICAgXCJ0ciA9PiAkMVwiLFxuICAgICAgICAgICAgICAgICAgICBcInRkID0+ICQxXCJcbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGRvY3VtZW50IG1ldGFkYXRhXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHRoaXMuZXh0cmFjdE1ldGFkYXRhKGNvbnRlbnQpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDb252ZXJ0IERPQ1ggdG8gSFRNTFxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgbWFtbW90aC5jb252ZXJ0VG9IdG1sKHsgYnVmZmVyOiBjb250ZW50IH0sIG1hbW1vdGhPcHRpb25zKTtcbiAgICAgICAgICAgIGNvbnN0IGh0bWwgPSByZXN1bHQudmFsdWU7XG4gICAgICAgICAgICBjb25zdCB3YXJuaW5ncyA9IHJlc3VsdC5tZXNzYWdlcztcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHdhcm5pbmdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ1tEb2N4Q29udmVydGVyXSBDb252ZXJzaW9uIHdhcm5pbmdzOicsIHdhcm5pbmdzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ29udmVydCBIVE1MIHRvIE1hcmtkb3duXG4gICAgICAgICAgICBjb25zdCBUdXJuZG93blNlcnZpY2UgPSByZXF1aXJlKCd0dXJuZG93bicpO1xuICAgICAgICAgICAgY29uc3QgdHVybmRvd25TZXJ2aWNlID0gbmV3IFR1cm5kb3duU2VydmljZSh7XG4gICAgICAgICAgICAgICAgaGVhZGluZ1N0eWxlOiAnYXR4JyxcbiAgICAgICAgICAgICAgICBjb2RlQmxvY2tTdHlsZTogJ2ZlbmNlZCcsXG4gICAgICAgICAgICAgICAgZW1EZWxpbWl0ZXI6ICcqJyxcbiAgICAgICAgICAgICAgICBidWxsZXRMaXN0TWFya2VyOiAnLSdcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDdXN0b21pemUgdHVybmRvd25cbiAgICAgICAgICAgIHR1cm5kb3duU2VydmljZS5hZGRSdWxlKCd0YWJsZXMnLCB7XG4gICAgICAgICAgICAgICAgZmlsdGVyOiAndGFibGUnLFxuICAgICAgICAgICAgICAgIHJlcGxhY2VtZW50OiBmdW5jdGlvbihjb250ZW50LCBub2RlKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIEhlYWRlcnMgYXJlIHRoZSBmaXJzdCByb3dcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgcm93cyA9IG5vZGUucm93cztcbiAgICAgICAgICAgICAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gJyc7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBsZXQgbWFya2Rvd24gPSAnXFxuXFxuJztcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIFByb2Nlc3MgaGVhZGVyIHJvd1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBoZWFkZXJDZWxscyA9IEFycmF5LmZyb20ocm93c1swXS5jZWxscyk7XG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duICs9ICd8ICcgKyBoZWFkZXJDZWxscy5tYXAoY2VsbCA9PiBjZWxsLnRleHRDb250ZW50LnRyaW0oKSkuam9pbignIHwgJykgKyAnIHxcXG4nO1xuICAgICAgICAgICAgICAgICAgICBtYXJrZG93biArPSAnfCAnICsgaGVhZGVyQ2VsbHMubWFwKCgpID0+ICctLS0nKS5qb2luKCcgfCAnKSArICcgfFxcbic7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyBQcm9jZXNzIGRhdGEgcm93c1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMTsgaSA8IHJvd3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNlbGxzID0gQXJyYXkuZnJvbShyb3dzW2ldLmNlbGxzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtkb3duICs9ICd8ICcgKyBjZWxscy5tYXAoY2VsbCA9PiBjZWxsLnRleHRDb250ZW50LnRyaW0oKSkuam9pbignIHwgJykgKyAnIHxcXG4nO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWFya2Rvd247XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENvbnZlcnQgSFRNTCB0byBtYXJrZG93blxuICAgICAgICAgICAgY29uc3QgbWFya2Rvd25Db250ZW50ID0gdHVybmRvd25TZXJ2aWNlLnR1cm5kb3duKGh0bWwpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBHZXQgY3VycmVudCBkYXRldGltZVxuICAgICAgICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnRlZERhdGUgPSBub3cudG9JU09TdHJpbmcoKS5zcGxpdCgnLicpWzBdLnJlcGxhY2UoJ1QnLCAnICcpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBHZXQgdGhlIHRpdGxlIGZyb20gbWV0YWRhdGEgb3IgZmlsZW5hbWVcbiAgICAgICAgICAgIGNvbnN0IGZpbGVUaXRsZSA9IG1ldGFkYXRhLnRpdGxlIHx8IHBhdGguYmFzZW5hbWUoZmlsZU5hbWUsIHBhdGguZXh0bmFtZShmaWxlTmFtZSkpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGZyb250bWF0dGVyXG4gICAgICAgICAgICBjb25zdCBmcm9udG1hdHRlciA9IFtcbiAgICAgICAgICAgICAgICAnLS0tJyxcbiAgICAgICAgICAgICAgICBgdGl0bGU6ICR7ZmlsZVRpdGxlfWAsXG4gICAgICAgICAgICAgICAgYGNvbnZlcnRlZDogJHtjb252ZXJ0ZWREYXRlfWAsXG4gICAgICAgICAgICAgICAgJ3R5cGU6IGRvY3gnLFxuICAgICAgICAgICAgICAgICctLS0nLFxuICAgICAgICAgICAgICAgICcnXG4gICAgICAgICAgICBdLmpvaW4oJ1xcbicpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDb21iaW5lIGZyb250bWF0dGVyIGFuZCBjb250ZW50XG4gICAgICAgICAgICByZXR1cm4gZnJvbnRtYXR0ZXIgKyBtYXJrZG93bkNvbnRlbnQ7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRG9jeENvbnZlcnRlcl0gTWFya2Rvd24gY29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogRXh0cmFjdCBtZXRhZGF0YSBmcm9tIERPQ1ggZG9jdW1lbnRcbiAgICAgKiBAcGFyYW0ge0J1ZmZlcn0gY29udGVudCAtIERPQ1ggY29udGVudCBhcyBidWZmZXJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBEb2N1bWVudCBtZXRhZGF0YVxuICAgICAqL1xuICAgIGFzeW5jIGV4dHJhY3RNZXRhZGF0YShjb250ZW50KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBVc2UgbWFtbW90aCB0byBleHRyYWN0IG1ldGFkYXRhXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBtYW1tb3RoLmV4dHJhY3RSYXdUZXh0KHsgYnVmZmVyOiBjb250ZW50IH0pO1xuICAgICAgICAgICAgY29uc3QgdGV4dCA9IHJlc3VsdC52YWx1ZTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gVHJ5IHRvIGV4dHJhY3QgdGl0bGUgZnJvbSBmaXJzdCBoZWFkaW5nXG4gICAgICAgICAgICBsZXQgdGl0bGUgPSAnJztcbiAgICAgICAgICAgIGNvbnN0IHRpdGxlTWF0Y2ggPSB0ZXh0Lm1hdGNoKC9eKC4rKSg/Olxccj9cXG4pLyk7XG4gICAgICAgICAgICBpZiAodGl0bGVNYXRjaCkge1xuICAgICAgICAgICAgICAgIHRpdGxlID0gdGl0bGVNYXRjaFsxXS50cmltKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFJldHVybiBiYXNpYyBtZXRhZGF0YVxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0aXRsZSxcbiAgICAgICAgICAgICAgICBhdXRob3I6ICcnLFxuICAgICAgICAgICAgICAgIGRhdGU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdLFxuICAgICAgICAgICAgICAgIHN1YmplY3Q6ICcnLFxuICAgICAgICAgICAgICAgIGtleXdvcmRzOiAnJyxcbiAgICAgICAgICAgICAgICBwYWdlQ291bnQ6IHRoaXMuZXN0aW1hdGVQYWdlQ291bnQodGV4dClcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRG9jeENvbnZlcnRlcl0gRmFpbGVkIHRvIGV4dHJhY3QgbWV0YWRhdGE6JywgZXJyb3IpO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0aXRsZTogJycsXG4gICAgICAgICAgICAgICAgYXV0aG9yOiAnJyxcbiAgICAgICAgICAgICAgICBkYXRlOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXSxcbiAgICAgICAgICAgICAgICBzdWJqZWN0OiAnJyxcbiAgICAgICAgICAgICAgICBrZXl3b3JkczogJycsXG4gICAgICAgICAgICAgICAgcGFnZUNvdW50OiAxXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIEVzdGltYXRlIHBhZ2UgY291bnQgYmFzZWQgb24gdGV4dCBsZW5ndGhcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdGV4dCAtIERvY3VtZW50IHRleHRcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBFc3RpbWF0ZWQgcGFnZSBjb3VudFxuICAgICAqL1xuICAgIGVzdGltYXRlUGFnZUNvdW50KHRleHQpIHtcbiAgICAgICAgLy8gUm91Z2ggZXN0aW1hdGU6IDMwMDAgY2hhcmFjdGVycyBwZXIgcGFnZVxuICAgICAgICBjb25zdCBjaGFyc1BlclBhZ2UgPSAzMDAwO1xuICAgICAgICByZXR1cm4gTWF0aC5tYXgoMSwgTWF0aC5jZWlsKHRleHQubGVuZ3RoIC8gY2hhcnNQZXJQYWdlKSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2hlY2sgaWYgdGhpcyBjb252ZXJ0ZXIgc3VwcG9ydHMgdGhlIGdpdmVuIGZpbGVcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIGZpbGVcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBzdXBwb3J0ZWRcbiAgICAgKi9cbiAgICBzdXBwb3J0c0ZpbGUoZmlsZVBhdGgpIHtcbiAgICAgICAgY29uc3QgZXh0ID0gcGF0aC5leHRuYW1lKGZpbGVQYXRoKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICByZXR1cm4gdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLmluY2x1ZGVzKGV4dCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGNvbnZlcnRlciBpbmZvcm1hdGlvblxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IENvbnZlcnRlciBkZXRhaWxzXG4gICAgICovXG4gICAgZ2V0SW5mbygpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIG5hbWU6ICdET0NYIENvbnZlcnRlcicsXG4gICAgICAgICAgICBleHRlbnNpb25zOiB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbnZlcnRzIERPQ1ggZmlsZXMgdG8gbWFya2Rvd24nLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICAgIHRpdGxlOiAnT3B0aW9uYWwgZG9jdW1lbnQgdGl0bGUnLFxuICAgICAgICAgICAgICAgIGlzUHJldmlldzogJ1doZXRoZXIgdG8gZ2VuZXJhdGUgYSBwcmV2aWV3IChkZWZhdWx0OiBmYWxzZSknXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IERvY3hDb252ZXJ0ZXI7XG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FB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