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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwibWFtbW90aCIsIkJhc2VTZXJ2aWNlIiwiZm9ybWF0TWV0YWRhdGEiLCJjbGVhbk1ldGFkYXRhIiwiRG9jeENvbnZlcnRlciIsImNvbnN0cnVjdG9yIiwiZmlsZVByb2Nlc3NvciIsImZpbGVTdG9yYWdlIiwic3VwcG9ydGVkRXh0ZW5zaW9ucyIsImFjdGl2ZUNvbnZlcnNpb25zIiwiTWFwIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUNvbnZlcnQiLCJiaW5kIiwiaGFuZGxlUHJldmlldyIsImdlbmVyYXRlQ29udmVyc2lvbklkIiwiRGF0ZSIsIm5vdyIsIk1hdGgiLCJyYW5kb20iLCJ0b1N0cmluZyIsInN1YnN0ciIsInVwZGF0ZUNvbnZlcnNpb25TdGF0dXMiLCJjb252ZXJzaW9uSWQiLCJzdGF0dXMiLCJkZXRhaWxzIiwiY29udmVyc2lvbiIsImdldCIsIk9iamVjdCIsImFzc2lnbiIsIndpbmRvdyIsIndlYkNvbnRlbnRzIiwic2VuZCIsImV2ZW50IiwiZmlsZVBhdGgiLCJidWZmZXIiLCJvcHRpb25zIiwic2VuZGVyIiwiZ2V0T3duZXJCcm93c2VyV2luZG93IiwidGVtcERpciIsImNyZWF0ZVRlbXBEaXIiLCJzZXQiLCJpZCIsInByb2dyZXNzIiwiY29udGVudCIsIkJ1ZmZlciIsImZyb20iLCJmaWxlUmVzdWx0IiwiaGFuZGxlRmlsZVJlYWQiLCJhc0JpbmFyeSIsIkVycm9yIiwicmVzdWx0IiwicHJvY2Vzc0NvbnZlcnNpb24iLCJmaWxlTmFtZSIsIm9yaWdpbmFsRmlsZU5hbWUiLCJuYW1lIiwiYmFzZW5hbWUiLCJlcnJvciIsImNvbnNvbGUiLCJjb252ZXJ0VG9NYXJrZG93biIsImlzUHJldmlldyIsInJlbW92ZSIsImNhdGNoIiwiZXJyIiwibWFtbW90aE9wdGlvbnMiLCJzdHlsZU1hcCIsIm1ldGFkYXRhIiwiZXh0cmFjdE1ldGFkYXRhIiwiY29udmVydFRvSHRtbCIsImh0bWwiLCJ2YWx1ZSIsIndhcm5pbmdzIiwibWVzc2FnZXMiLCJsZW5ndGgiLCJ3YXJuIiwiVHVybmRvd25TZXJ2aWNlIiwidHVybmRvd25TZXJ2aWNlIiwiaGVhZGluZ1N0eWxlIiwiY29kZUJsb2NrU3R5bGUiLCJlbURlbGltaXRlciIsImJ1bGxldExpc3RNYXJrZXIiLCJhZGRSdWxlIiwiZmlsdGVyIiwicmVwbGFjZW1lbnQiLCJub2RlIiwicm93cyIsIm1hcmtkb3duIiwiaGVhZGVyQ2VsbHMiLCJBcnJheSIsImNlbGxzIiwibWFwIiwiY2VsbCIsInRleHRDb250ZW50IiwidHJpbSIsImpvaW4iLCJpIiwibWFya2Rvd25Db250ZW50IiwidHVybmRvd24iLCJjb252ZXJ0ZWREYXRlIiwidG9JU09TdHJpbmciLCJzcGxpdCIsInJlcGxhY2UiLCJmaWxlVGl0bGUiLCJ0aXRsZSIsImV4dG5hbWUiLCJmcm9udG1hdHRlciIsImV4dHJhY3RSYXdUZXh0IiwidGV4dCIsInRpdGxlTWF0Y2giLCJtYXRjaCIsImF1dGhvciIsImRhdGUiLCJzdWJqZWN0Iiwia2V5d29yZHMiLCJwYWdlQ291bnQiLCJlc3RpbWF0ZVBhZ2VDb3VudCIsImNoYXJzUGVyUGFnZSIsIm1heCIsImNlaWwiLCJzdXBwb3J0c0ZpbGUiLCJleHQiLCJ0b0xvd2VyQ2FzZSIsImluY2x1ZGVzIiwiZ2V0SW5mbyIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9Eb2N4Q29udmVydGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBEb2N4Q29udmVydGVyLmpzXHJcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiBET0NYIGZpbGVzIHRvIG1hcmtkb3duIGZvcm1hdCBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBcclxuICogVGhpcyBjb252ZXJ0ZXI6XHJcbiAqIC0gUGFyc2VzIERPQ1ggZmlsZXMgdXNpbmcgbWFtbW90aFxyXG4gKiAtIEV4dHJhY3RzIHRleHQsIGZvcm1hdHRpbmcsIGFuZCBzdHJ1Y3R1cmVcclxuICogLSBHZW5lcmF0ZXMgY2xlYW4gbWFya2Rvd24gb3V0cHV0XHJcbiAqIFxyXG4gKiBSZWxhdGVkIEZpbGVzOlxyXG4gKiAtIEJhc2VTZXJ2aWNlLmpzOiBQYXJlbnQgY2xhc3MgcHJvdmlkaW5nIElQQyBoYW5kbGluZ1xyXG4gKiAtIEZpbGVQcm9jZXNzb3JTZXJ2aWNlLmpzOiBVc2VkIGZvciBmaWxlIG9wZXJhdGlvbnNcclxuICogLSBDb252ZXJzaW9uU2VydmljZS5qczogUmVnaXN0ZXJzIGFuZCB1c2VzIHRoaXMgY29udmVydGVyXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCBtYW1tb3RoID0gcmVxdWlyZSgnbWFtbW90aCcpO1xyXG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL0Jhc2VTZXJ2aWNlJyk7XHJcbmNvbnN0IHsgZm9ybWF0TWV0YWRhdGEsIGNsZWFuTWV0YWRhdGEgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL3V0aWxzL21hcmtkb3duJyk7XHJcblxyXG5jbGFzcyBEb2N4Q29udmVydGVyIGV4dGVuZHMgQmFzZVNlcnZpY2Uge1xyXG4gICAgY29uc3RydWN0b3IoZmlsZVByb2Nlc3NvciwgZmlsZVN0b3JhZ2UpIHtcclxuICAgICAgICBzdXBlcigpO1xyXG4gICAgICAgIHRoaXMuZmlsZVByb2Nlc3NvciA9IGZpbGVQcm9jZXNzb3I7XHJcbiAgICAgICAgdGhpcy5maWxlU3RvcmFnZSA9IGZpbGVTdG9yYWdlO1xyXG4gICAgICAgIHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyA9IFsnLmRvY3gnLCAnLmRvYyddO1xyXG4gICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMgPSBuZXcgTWFwKCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogU2V0IHVwIElQQyBoYW5kbGVycyBmb3IgRE9DWCBjb252ZXJzaW9uXHJcbiAgICAgKi9cclxuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6ZG9jeCcsIHRoaXMuaGFuZGxlQ29udmVydC5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpkb2N4OnByZXZpZXcnLCB0aGlzLmhhbmRsZVByZXZpZXcuYmluZCh0aGlzKSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgYSB1bmlxdWUgY29udmVyc2lvbiBJRFxyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gVW5pcXVlIGNvbnZlcnNpb24gSURcclxuICAgICAqL1xyXG4gICAgZ2VuZXJhdGVDb252ZXJzaW9uSWQoKSB7XHJcbiAgICAgICAgcmV0dXJuIGBkb2N4XyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHIoMiwgOSl9YDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBVcGRhdGUgY29udmVyc2lvbiBzdGF0dXMgYW5kIG5vdGlmeSByZW5kZXJlclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHN0YXR1cyAtIE5ldyBzdGF0dXNcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBkZXRhaWxzIC0gQWRkaXRpb25hbCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIHVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCBzdGF0dXMsIGRldGFpbHMgPSB7fSkge1xyXG4gICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgIGlmIChjb252ZXJzaW9uKSB7XHJcbiAgICAgICAgICAgIGNvbnZlcnNpb24uc3RhdHVzID0gc3RhdHVzO1xyXG4gICAgICAgICAgICBPYmplY3QuYXNzaWduKGNvbnZlcnNpb24sIGRldGFpbHMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24ud2luZG93KSB7XHJcbiAgICAgICAgICAgICAgICBjb252ZXJzaW9uLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdkb2N4OmNvbnZlcnNpb24tcHJvZ3Jlc3MnLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvbklkLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cyxcclxuICAgICAgICAgICAgICAgICAgICAuLi5kZXRhaWxzXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgRE9DWCBjb252ZXJzaW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb252ZXJzaW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDb252ZXJ0KGV2ZW50LCB7IGZpbGVQYXRoLCBidWZmZXIsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbklkID0gdGhpcy5nZW5lcmF0ZUNvbnZlcnNpb25JZCgpO1xyXG4gICAgICAgICAgICBjb25zdCB3aW5kb3cgPSBldmVudC5zZW5kZXIuZ2V0T3duZXJCcm93c2VyV2luZG93KCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDcmVhdGUgdGVtcCBkaXJlY3RvcnkgZm9yIHRoaXMgY29udmVyc2lvblxyXG4gICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgdGhpcy5maWxlU3RvcmFnZS5jcmVhdGVUZW1wRGlyKCdkb2N4X2NvbnZlcnNpb24nKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2V0KGNvbnZlcnNpb25JZCwge1xyXG4gICAgICAgICAgICAgICAgaWQ6IGNvbnZlcnNpb25JZCxcclxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3N0YXJ0aW5nJyxcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAwLFxyXG4gICAgICAgICAgICAgICAgZmlsZVBhdGgsXHJcbiAgICAgICAgICAgICAgICB0ZW1wRGlyLFxyXG4gICAgICAgICAgICAgICAgd2luZG93XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gTm90aWZ5IGNsaWVudCB0aGF0IGNvbnZlcnNpb24gaGFzIHN0YXJ0ZWRcclxuICAgICAgICAgICAgd2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ2RvY3g6Y29udmVyc2lvbi1zdGFydGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBsZXQgY29udGVudDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChidWZmZXIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBCdWZmZXIuZnJvbShidWZmZXIpO1xyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKGZpbGVQYXRoKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAncmVhZGluZ19maWxlJywgeyBwcm9ncmVzczogMTAgfSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBmaWxlUmVzdWx0ID0gYXdhaXQgdGhpcy5maWxlUHJvY2Vzc29yLmhhbmRsZUZpbGVSZWFkKG51bGwsIHtcclxuICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBhc0JpbmFyeTogdHJ1ZVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gZmlsZVJlc3VsdC5jb250ZW50O1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBmaWxlIHBhdGggb3IgYnVmZmVyIHByb3ZpZGVkJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFN0YXJ0IGNvbnZlcnNpb24gcHJvY2Vzc1xyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgY29udGVudCwge1xyXG4gICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGggfHwgJ2RvY3VtZW50LmRvY3gnKVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnRlbnQ6IHJlc3VsdCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tEb2N4Q29udmVydGVyXSBDb252ZXJzaW9uIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBET0NYIHByZXZpZXcgcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFByZXZpZXcgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZVByZXZpZXcoZXZlbnQsIHsgZmlsZVBhdGgsIGJ1ZmZlciwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBsZXQgY29udGVudDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChidWZmZXIpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBCdWZmZXIuZnJvbShidWZmZXIpO1xyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKGZpbGVQYXRoKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBmaWxlUmVzdWx0ID0gYXdhaXQgdGhpcy5maWxlUHJvY2Vzc29yLmhhbmRsZUZpbGVSZWFkKG51bGwsIHtcclxuICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBhc0JpbmFyeTogdHJ1ZVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gZmlsZVJlc3VsdC5jb250ZW50O1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBmaWxlIHBhdGggb3IgYnVmZmVyIHByb3ZpZGVkJyk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29udmVydFRvTWFya2Rvd24oY29udGVudCwge1xyXG4gICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgIGlzUHJldmlldzogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGggfHwgJ2RvY3VtZW50LmRvY3gnKVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnRlbnQ6IHJlc3VsdCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tEb2N4Q29udmVydGVyXSBQcmV2aWV3IGdlbmVyYXRpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgRE9DWCBjb252ZXJzaW9uXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge0J1ZmZlcn0gY29udGVudCAtIERPQ1ggY29udGVudCBhcyBidWZmZXJcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgY29udGVudCwgb3B0aW9ucykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgICAgICBpZiAoIWNvbnZlcnNpb24pIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVyc2lvbiBub3QgZm91bmQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2V4dHJhY3RpbmdfY29udGVudCcsIHsgcHJvZ3Jlc3M6IDMwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBkb2N1bWVudCBjb250ZW50IGFuZCBtZXRhZGF0YVxyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2NvbXBsZXRlZCcsIHsgXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMTAwLFxyXG4gICAgICAgICAgICAgICAgcmVzdWx0XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24udGVtcERpcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGNvbnZlcnNpb24udGVtcERpcikuY2F0Y2goZXJyID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbRG9jeENvbnZlcnRlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIHRlbXAgZGlyZWN0b3J5OiAke2NvbnZlcnNpb24udGVtcERpcn1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0RvY3hDb252ZXJ0ZXJdIENvbnZlcnNpb24gcHJvY2Vzc2luZyBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XHJcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uICYmIGNvbnZlcnNpb24udGVtcERpcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGNvbnZlcnNpb24udGVtcERpcikuY2F0Y2goZXJyID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbRG9jeENvbnZlcnRlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIHRlbXAgZGlyZWN0b3J5OiAke2NvbnZlcnNpb24udGVtcERpcn1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENvbnZlcnQgRE9DWCBjb250ZW50IHRvIG1hcmtkb3duXHJcbiAgICAgKiBAcGFyYW0ge0J1ZmZlcn0gY29udGVudCAtIERPQ1ggY29udGVudCBhcyBidWZmZXJcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gb3B0aW9ucy5maWxlTmFtZSB8fCAnZG9jdW1lbnQuZG9jeCc7XHJcbiAgICAgICAgICAgIGNvbnN0IGlzUHJldmlldyA9IG9wdGlvbnMuaXNQcmV2aWV3IHx8IGZhbHNlO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ29uZmlndXJlIE1hbW1vdGggb3B0aW9uc1xyXG4gICAgICAgICAgICBjb25zdCBtYW1tb3RoT3B0aW9ucyA9IHtcclxuICAgICAgICAgICAgICAgIHN0eWxlTWFwOiBbXHJcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0hlYWRpbmcgMSddID0+ICMgJDFcIixcclxuICAgICAgICAgICAgICAgICAgICBcInBbc3R5bGUtbmFtZT0nSGVhZGluZyAyJ10gPT4gIyMgJDFcIixcclxuICAgICAgICAgICAgICAgICAgICBcInBbc3R5bGUtbmFtZT0nSGVhZGluZyAzJ10gPT4gIyMjICQxXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0hlYWRpbmcgNCddID0+ICMjIyMgJDFcIixcclxuICAgICAgICAgICAgICAgICAgICBcInBbc3R5bGUtbmFtZT0nSGVhZGluZyA1J10gPT4gIyMjIyMgJDFcIixcclxuICAgICAgICAgICAgICAgICAgICBcInBbc3R5bGUtbmFtZT0nSGVhZGluZyA2J10gPT4gIyMjIyMjICQxXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgXCJyW3N0eWxlLW5hbWU9J1N0cm9uZyddID0+ICoqJDEqKlwiLFxyXG4gICAgICAgICAgICAgICAgICAgIFwicltzdHlsZS1uYW1lPSdFbXBoYXNpcyddID0+ICokMSpcIixcclxuICAgICAgICAgICAgICAgICAgICBcInBbc3R5bGUtbmFtZT0nUXVvdGUnXSA9PiA+ICQxXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgXCJwW3N0eWxlLW5hbWU9J0xpc3QgUGFyYWdyYXBoJ10gPT4gKiAkMVwiLFxyXG4gICAgICAgICAgICAgICAgICAgIFwidGFibGUgPT4gJDFcIixcclxuICAgICAgICAgICAgICAgICAgICBcInRyID0+ICQxXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgXCJ0ZCA9PiAkMVwiXHJcbiAgICAgICAgICAgICAgICBdXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGRvY3VtZW50IG1ldGFkYXRhXHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgdGhpcy5leHRyYWN0TWV0YWRhdGEoY29udGVudCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDb252ZXJ0IERPQ1ggdG8gSFRNTFxyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBtYW1tb3RoLmNvbnZlcnRUb0h0bWwoeyBidWZmZXI6IGNvbnRlbnQgfSwgbWFtbW90aE9wdGlvbnMpO1xyXG4gICAgICAgICAgICBjb25zdCBodG1sID0gcmVzdWx0LnZhbHVlO1xyXG4gICAgICAgICAgICBjb25zdCB3YXJuaW5ncyA9IHJlc3VsdC5tZXNzYWdlcztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICh3YXJuaW5ncy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ1tEb2N4Q29udmVydGVyXSBDb252ZXJzaW9uIHdhcm5pbmdzOicsIHdhcm5pbmdzKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ29udmVydCBIVE1MIHRvIE1hcmtkb3duXHJcbiAgICAgICAgICAgIGNvbnN0IFR1cm5kb3duU2VydmljZSA9IHJlcXVpcmUoJ3R1cm5kb3duJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHR1cm5kb3duU2VydmljZSA9IG5ldyBUdXJuZG93blNlcnZpY2Uoe1xyXG4gICAgICAgICAgICAgICAgaGVhZGluZ1N0eWxlOiAnYXR4JyxcclxuICAgICAgICAgICAgICAgIGNvZGVCbG9ja1N0eWxlOiAnZmVuY2VkJyxcclxuICAgICAgICAgICAgICAgIGVtRGVsaW1pdGVyOiAnKicsXHJcbiAgICAgICAgICAgICAgICBidWxsZXRMaXN0TWFya2VyOiAnLSdcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDdXN0b21pemUgdHVybmRvd25cclxuICAgICAgICAgICAgdHVybmRvd25TZXJ2aWNlLmFkZFJ1bGUoJ3RhYmxlcycsIHtcclxuICAgICAgICAgICAgICAgIGZpbHRlcjogJ3RhYmxlJyxcclxuICAgICAgICAgICAgICAgIHJlcGxhY2VtZW50OiBmdW5jdGlvbihjb250ZW50LCBub2RlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSGVhZGVycyBhcmUgdGhlIGZpcnN0IHJvd1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJvd3MgPSBub2RlLnJvd3M7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgbGV0IG1hcmtkb3duID0gJ1xcblxcbic7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gUHJvY2VzcyBoZWFkZXIgcm93XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaGVhZGVyQ2VsbHMgPSBBcnJheS5mcm9tKHJvd3NbMF0uY2VsbHMpO1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duICs9ICd8ICcgKyBoZWFkZXJDZWxscy5tYXAoY2VsbCA9PiBjZWxsLnRleHRDb250ZW50LnRyaW0oKSkuam9pbignIHwgJykgKyAnIHxcXG4nO1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duICs9ICd8ICcgKyBoZWFkZXJDZWxscy5tYXAoKCkgPT4gJy0tLScpLmpvaW4oJyB8ICcpICsgJyB8XFxuJztcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBQcm9jZXNzIGRhdGEgcm93c1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAxOyBpIDwgcm93cy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjZWxscyA9IEFycmF5LmZyb20ocm93c1tpXS5jZWxscyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtkb3duICs9ICd8ICcgKyBjZWxscy5tYXAoY2VsbCA9PiBjZWxsLnRleHRDb250ZW50LnRyaW0oKSkuam9pbignIHwgJykgKyAnIHxcXG4nO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWFya2Rvd247XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ29udmVydCBIVE1MIHRvIG1hcmtkb3duXHJcbiAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duQ29udGVudCA9IHR1cm5kb3duU2VydmljZS50dXJuZG93bihodG1sKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdldCBjdXJyZW50IGRhdGV0aW1lXHJcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnRlZERhdGUgPSBub3cudG9JU09TdHJpbmcoKS5zcGxpdCgnLicpWzBdLnJlcGxhY2UoJ1QnLCAnICcpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IHRoZSB0aXRsZSBmcm9tIG1ldGFkYXRhIG9yIGZpbGVuYW1lXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVUaXRsZSA9IG1ldGFkYXRhLnRpdGxlIHx8IHBhdGguYmFzZW5hbWUoZmlsZU5hbWUsIHBhdGguZXh0bmFtZShmaWxlTmFtZSkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBmcm9udG1hdHRlclxyXG4gICAgICAgICAgICBjb25zdCBmcm9udG1hdHRlciA9IFtcclxuICAgICAgICAgICAgICAgICctLS0nLFxyXG4gICAgICAgICAgICAgICAgYHRpdGxlOiAke2ZpbGVUaXRsZX1gLFxyXG4gICAgICAgICAgICAgICAgYGNvbnZlcnRlZDogJHtjb252ZXJ0ZWREYXRlfWAsXHJcbiAgICAgICAgICAgICAgICAndHlwZTogZG9jeCcsXHJcbiAgICAgICAgICAgICAgICAnLS0tJyxcclxuICAgICAgICAgICAgICAgICcnXHJcbiAgICAgICAgICAgIF0uam9pbignXFxuJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDb21iaW5lIGZyb250bWF0dGVyIGFuZCBjb250ZW50XHJcbiAgICAgICAgICAgIHJldHVybiBmcm9udG1hdHRlciArIG1hcmtkb3duQ29udGVudDtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRG9jeENvbnZlcnRlcl0gTWFya2Rvd24gY29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogRXh0cmFjdCBtZXRhZGF0YSBmcm9tIERPQ1ggZG9jdW1lbnRcclxuICAgICAqIEBwYXJhbSB7QnVmZmVyfSBjb250ZW50IC0gRE9DWCBjb250ZW50IGFzIGJ1ZmZlclxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gRG9jdW1lbnQgbWV0YWRhdGFcclxuICAgICAqL1xyXG4gICAgYXN5bmMgZXh0cmFjdE1ldGFkYXRhKGNvbnRlbnQpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBVc2UgbWFtbW90aCB0byBleHRyYWN0IG1ldGFkYXRhXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG1hbW1vdGguZXh0cmFjdFJhd1RleHQoeyBidWZmZXI6IGNvbnRlbnQgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHRleHQgPSByZXN1bHQudmFsdWU7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBUcnkgdG8gZXh0cmFjdCB0aXRsZSBmcm9tIGZpcnN0IGhlYWRpbmdcclxuICAgICAgICAgICAgbGV0IHRpdGxlID0gJyc7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpdGxlTWF0Y2ggPSB0ZXh0Lm1hdGNoKC9eKC4rKSg/Olxccj9cXG4pLyk7XHJcbiAgICAgICAgICAgIGlmICh0aXRsZU1hdGNoKSB7XHJcbiAgICAgICAgICAgICAgICB0aXRsZSA9IHRpdGxlTWF0Y2hbMV0udHJpbSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBSZXR1cm4gYmFzaWMgbWV0YWRhdGFcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIHRpdGxlLFxyXG4gICAgICAgICAgICAgICAgYXV0aG9yOiAnJyxcclxuICAgICAgICAgICAgICAgIGRhdGU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdLFxyXG4gICAgICAgICAgICAgICAgc3ViamVjdDogJycsXHJcbiAgICAgICAgICAgICAgICBrZXl3b3JkczogJycsXHJcbiAgICAgICAgICAgICAgICBwYWdlQ291bnQ6IHRoaXMuZXN0aW1hdGVQYWdlQ291bnQodGV4dClcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRG9jeENvbnZlcnRlcl0gRmFpbGVkIHRvIGV4dHJhY3QgbWV0YWRhdGE6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgdGl0bGU6ICcnLFxyXG4gICAgICAgICAgICAgICAgYXV0aG9yOiAnJyxcclxuICAgICAgICAgICAgICAgIGRhdGU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdLFxyXG4gICAgICAgICAgICAgICAgc3ViamVjdDogJycsXHJcbiAgICAgICAgICAgICAgICBrZXl3b3JkczogJycsXHJcbiAgICAgICAgICAgICAgICBwYWdlQ291bnQ6IDFcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogRXN0aW1hdGUgcGFnZSBjb3VudCBiYXNlZCBvbiB0ZXh0IGxlbmd0aFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHRleHQgLSBEb2N1bWVudCB0ZXh0XHJcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyfSBFc3RpbWF0ZWQgcGFnZSBjb3VudFxyXG4gICAgICovXHJcbiAgICBlc3RpbWF0ZVBhZ2VDb3VudCh0ZXh0KSB7XHJcbiAgICAgICAgLy8gUm91Z2ggZXN0aW1hdGU6IDMwMDAgY2hhcmFjdGVycyBwZXIgcGFnZVxyXG4gICAgICAgIGNvbnN0IGNoYXJzUGVyUGFnZSA9IDMwMDA7XHJcbiAgICAgICAgcmV0dXJuIE1hdGgubWF4KDEsIE1hdGguY2VpbCh0ZXh0Lmxlbmd0aCAvIGNoYXJzUGVyUGFnZSkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgdGhpcyBjb252ZXJ0ZXIgc3VwcG9ydHMgdGhlIGdpdmVuIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gZmlsZVxyXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXHJcbiAgICAgKi9cclxuICAgIHN1cHBvcnRzRmlsZShmaWxlUGF0aCkge1xyXG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICByZXR1cm4gdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLmluY2x1ZGVzKGV4dCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgY29udmVydGVyIGluZm9ybWF0aW9uXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBnZXRJbmZvKCkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIG5hbWU6ICdET0NYIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbnM6IHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyxcclxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb252ZXJ0cyBET0NYIGZpbGVzIHRvIG1hcmtkb3duJyxcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgICAgdGl0bGU6ICdPcHRpb25hbCBkb2N1bWVudCB0aXRsZScsXHJcbiAgICAgICAgICAgICAgICBpc1ByZXZpZXc6ICdXaGV0aGVyIHRvIGdlbmVyYXRlIGEgcHJldmlldyAoZGVmYXVsdDogZmFsc2UpJ1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBEb2N4Q29udmVydGVyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTUMsRUFBRSxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQzlCLE1BQU1FLE9BQU8sR0FBR0YsT0FBTyxDQUFDLFNBQVMsQ0FBQztBQUNsQyxNQUFNRyxXQUFXLEdBQUdILE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQztBQUNoRCxNQUFNO0VBQUVJLGNBQWM7RUFBRUM7QUFBYyxDQUFDLEdBQUdMLE9BQU8sQ0FBQyx5QkFBeUIsQ0FBQztBQUU1RSxNQUFNTSxhQUFhLFNBQVNILFdBQVcsQ0FBQztFQUNwQ0ksV0FBV0EsQ0FBQ0MsYUFBYSxFQUFFQyxXQUFXLEVBQUU7SUFDcEMsS0FBSyxDQUFDLENBQUM7SUFDUCxJQUFJLENBQUNELGFBQWEsR0FBR0EsYUFBYTtJQUNsQyxJQUFJLENBQUNDLFdBQVcsR0FBR0EsV0FBVztJQUM5QixJQUFJLENBQUNDLG1CQUFtQixHQUFHLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQztJQUM1QyxJQUFJLENBQUNDLGlCQUFpQixHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDO0VBQ3RDOztFQUVBO0FBQ0o7QUFDQTtFQUNJQyxnQkFBZ0JBLENBQUEsRUFBRztJQUNmLElBQUksQ0FBQ0MsZUFBZSxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUNDLGFBQWEsQ0FBQ0MsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ25FLElBQUksQ0FBQ0YsZUFBZSxDQUFDLHNCQUFzQixFQUFFLElBQUksQ0FBQ0csYUFBYSxDQUFDRCxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7RUFDL0U7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7RUFDSUUsb0JBQW9CQSxDQUFBLEVBQUc7SUFDbkIsT0FBTyxRQUFRQyxJQUFJLENBQUNDLEdBQUcsQ0FBQyxDQUFDLElBQUlDLElBQUksQ0FBQ0MsTUFBTSxDQUFDLENBQUMsQ0FBQ0MsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDQyxNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFO0VBQzFFOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNJQyxzQkFBc0JBLENBQUNDLFlBQVksRUFBRUMsTUFBTSxFQUFFQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLEVBQUU7SUFDdkQsTUFBTUMsVUFBVSxHQUFHLElBQUksQ0FBQ2xCLGlCQUFpQixDQUFDbUIsR0FBRyxDQUFDSixZQUFZLENBQUM7SUFDM0QsSUFBSUcsVUFBVSxFQUFFO01BQ1pBLFVBQVUsQ0FBQ0YsTUFBTSxHQUFHQSxNQUFNO01BQzFCSSxNQUFNLENBQUNDLE1BQU0sQ0FBQ0gsVUFBVSxFQUFFRCxPQUFPLENBQUM7TUFFbEMsSUFBSUMsVUFBVSxDQUFDSSxNQUFNLEVBQUU7UUFDbkJKLFVBQVUsQ0FBQ0ksTUFBTSxDQUFDQyxXQUFXLENBQUNDLElBQUksQ0FBQywwQkFBMEIsRUFBRTtVQUMzRFQsWUFBWTtVQUNaQyxNQUFNO1VBQ04sR0FBR0M7UUFDUCxDQUFDLENBQUM7TUFDTjtJQUNKO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJLE1BQU1iLGFBQWFBLENBQUNxQixLQUFLLEVBQUU7SUFBRUMsUUFBUTtJQUFFQyxNQUFNO0lBQUVDLE9BQU8sR0FBRyxDQUFDO0VBQUUsQ0FBQyxFQUFFO0lBQzNELElBQUk7TUFDQSxNQUFNYixZQUFZLEdBQUcsSUFBSSxDQUFDUixvQkFBb0IsQ0FBQyxDQUFDO01BQ2hELE1BQU1lLE1BQU0sR0FBR0csS0FBSyxDQUFDSSxNQUFNLENBQUNDLHFCQUFxQixDQUFDLENBQUM7O01BRW5EO01BQ0EsTUFBTUMsT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDakMsV0FBVyxDQUFDa0MsYUFBYSxDQUFDLGlCQUFpQixDQUFDO01BRXZFLElBQUksQ0FBQ2hDLGlCQUFpQixDQUFDaUMsR0FBRyxDQUFDbEIsWUFBWSxFQUFFO1FBQ3JDbUIsRUFBRSxFQUFFbkIsWUFBWTtRQUNoQkMsTUFBTSxFQUFFLFVBQVU7UUFDbEJtQixRQUFRLEVBQUUsQ0FBQztRQUNYVCxRQUFRO1FBQ1JLLE9BQU87UUFDUFQ7TUFDSixDQUFDLENBQUM7O01BRUY7TUFDQUEsTUFBTSxDQUFDQyxXQUFXLENBQUNDLElBQUksQ0FBQyx5QkFBeUIsRUFBRTtRQUFFVDtNQUFhLENBQUMsQ0FBQztNQUVwRSxJQUFJcUIsT0FBTztNQUVYLElBQUlULE1BQU0sRUFBRTtRQUNSUyxPQUFPLEdBQUdDLE1BQU0sQ0FBQ0MsSUFBSSxDQUFDWCxNQUFNLENBQUM7TUFDakMsQ0FBQyxNQUFNLElBQUlELFFBQVEsRUFBRTtRQUNqQixJQUFJLENBQUNaLHNCQUFzQixDQUFDQyxZQUFZLEVBQUUsY0FBYyxFQUFFO1VBQUVvQixRQUFRLEVBQUU7UUFBRyxDQUFDLENBQUM7UUFDM0UsTUFBTUksVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDMUMsYUFBYSxDQUFDMkMsY0FBYyxDQUFDLElBQUksRUFBRTtVQUM3RGQsUUFBUTtVQUNSZSxRQUFRLEVBQUU7UUFDZCxDQUFDLENBQUM7UUFDRkwsT0FBTyxHQUFHRyxVQUFVLENBQUNILE9BQU87TUFDaEMsQ0FBQyxNQUFNO1FBQ0gsTUFBTSxJQUFJTSxLQUFLLENBQUMsaUNBQWlDLENBQUM7TUFDdEQ7O01BRUE7TUFDQSxNQUFNQyxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUNDLGlCQUFpQixDQUFDN0IsWUFBWSxFQUFFcUIsT0FBTyxFQUFFO1FBQy9ELEdBQUdSLE9BQU87UUFDVmlCLFFBQVEsRUFBRWpCLE9BQU8sQ0FBQ2tCLGdCQUFnQixJQUFJbEIsT0FBTyxDQUFDbUIsSUFBSSxJQUFJM0QsSUFBSSxDQUFDNEQsUUFBUSxDQUFDdEIsUUFBUSxJQUFJLGVBQWU7TUFDbkcsQ0FBQyxDQUFDO01BRUYsT0FBTztRQUFFVSxPQUFPLEVBQUVPO01BQU8sQ0FBQztJQUM5QixDQUFDLENBQUMsT0FBT00sS0FBSyxFQUFFO01BQ1pDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLG9DQUFvQyxFQUFFQSxLQUFLLENBQUM7TUFDMUQsTUFBTUEsS0FBSztJQUNmO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJLE1BQU0zQyxhQUFhQSxDQUFDbUIsS0FBSyxFQUFFO0lBQUVDLFFBQVE7SUFBRUMsTUFBTTtJQUFFQyxPQUFPLEdBQUcsQ0FBQztFQUFFLENBQUMsRUFBRTtJQUMzRCxJQUFJO01BQ0EsSUFBSVEsT0FBTztNQUVYLElBQUlULE1BQU0sRUFBRTtRQUNSUyxPQUFPLEdBQUdDLE1BQU0sQ0FBQ0MsSUFBSSxDQUFDWCxNQUFNLENBQUM7TUFDakMsQ0FBQyxNQUFNLElBQUlELFFBQVEsRUFBRTtRQUNqQixNQUFNYSxVQUFVLEdBQUcsTUFBTSxJQUFJLENBQUMxQyxhQUFhLENBQUMyQyxjQUFjLENBQUMsSUFBSSxFQUFFO1VBQzdEZCxRQUFRO1VBQ1JlLFFBQVEsRUFBRTtRQUNkLENBQUMsQ0FBQztRQUNGTCxPQUFPLEdBQUdHLFVBQVUsQ0FBQ0gsT0FBTztNQUNoQyxDQUFDLE1BQU07UUFDSCxNQUFNLElBQUlNLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQztNQUN0RDtNQUVBLE1BQU1DLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQ1EsaUJBQWlCLENBQUNmLE9BQU8sRUFBRTtRQUNqRCxHQUFHUixPQUFPO1FBQ1Z3QixTQUFTLEVBQUUsSUFBSTtRQUNmUCxRQUFRLEVBQUVqQixPQUFPLENBQUNrQixnQkFBZ0IsSUFBSWxCLE9BQU8sQ0FBQ21CLElBQUksSUFBSTNELElBQUksQ0FBQzRELFFBQVEsQ0FBQ3RCLFFBQVEsSUFBSSxlQUFlO01BQ25HLENBQUMsQ0FBQztNQUVGLE9BQU87UUFBRVUsT0FBTyxFQUFFTztNQUFPLENBQUM7SUFDOUIsQ0FBQyxDQUFDLE9BQU9NLEtBQUssRUFBRTtNQUNaQyxPQUFPLENBQUNELEtBQUssQ0FBQyw0Q0FBNEMsRUFBRUEsS0FBSyxDQUFDO01BQ2xFLE1BQU1BLEtBQUs7SUFDZjtFQUNKOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTUwsaUJBQWlCQSxDQUFDN0IsWUFBWSxFQUFFcUIsT0FBTyxFQUFFUixPQUFPLEVBQUU7SUFDcEQsSUFBSTtNQUNBLE1BQU1WLFVBQVUsR0FBRyxJQUFJLENBQUNsQixpQkFBaUIsQ0FBQ21CLEdBQUcsQ0FBQ0osWUFBWSxDQUFDO01BQzNELElBQUksQ0FBQ0csVUFBVSxFQUFFO1FBQ2IsTUFBTSxJQUFJd0IsS0FBSyxDQUFDLHNCQUFzQixDQUFDO01BQzNDO01BRUEsSUFBSSxDQUFDNUIsc0JBQXNCLENBQUNDLFlBQVksRUFBRSxvQkFBb0IsRUFBRTtRQUFFb0IsUUFBUSxFQUFFO01BQUcsQ0FBQyxDQUFDOztNQUVqRjtNQUNBLE1BQU1RLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQ1EsaUJBQWlCLENBQUNmLE9BQU8sRUFBRVIsT0FBTyxDQUFDO01BRTdELElBQUksQ0FBQ2Qsc0JBQXNCLENBQUNDLFlBQVksRUFBRSxXQUFXLEVBQUU7UUFDbkRvQixRQUFRLEVBQUUsR0FBRztRQUNiUTtNQUNKLENBQUMsQ0FBQzs7TUFFRjtNQUNBLElBQUl6QixVQUFVLENBQUNhLE9BQU8sRUFBRTtRQUNwQixNQUFNekMsRUFBRSxDQUFDK0QsTUFBTSxDQUFDbkMsVUFBVSxDQUFDYSxPQUFPLENBQUMsQ0FBQ3VCLEtBQUssQ0FBQ0MsR0FBRyxJQUFJO1VBQzdDTCxPQUFPLENBQUNELEtBQUssQ0FBQyxzREFBc0QvQixVQUFVLENBQUNhLE9BQU8sRUFBRSxFQUFFd0IsR0FBRyxDQUFDO1FBQ2xHLENBQUMsQ0FBQztNQUNOO01BRUEsT0FBT1osTUFBTTtJQUNqQixDQUFDLENBQUMsT0FBT00sS0FBSyxFQUFFO01BQ1pDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLCtDQUErQyxFQUFFQSxLQUFLLENBQUM7O01BRXJFO01BQ0EsTUFBTS9CLFVBQVUsR0FBRyxJQUFJLENBQUNsQixpQkFBaUIsQ0FBQ21CLEdBQUcsQ0FBQ0osWUFBWSxDQUFDO01BQzNELElBQUlHLFVBQVUsSUFBSUEsVUFBVSxDQUFDYSxPQUFPLEVBQUU7UUFDbEMsTUFBTXpDLEVBQUUsQ0FBQytELE1BQU0sQ0FBQ25DLFVBQVUsQ0FBQ2EsT0FBTyxDQUFDLENBQUN1QixLQUFLLENBQUNDLEdBQUcsSUFBSTtVQUM3Q0wsT0FBTyxDQUFDRCxLQUFLLENBQUMsc0RBQXNEL0IsVUFBVSxDQUFDYSxPQUFPLEVBQUUsRUFBRXdCLEdBQUcsQ0FBQztRQUNsRyxDQUFDLENBQUM7TUFDTjtNQUVBLE1BQU1OLEtBQUs7SUFDZjtFQUNKOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNJLE1BQU1FLGlCQUFpQkEsQ0FBQ2YsT0FBTyxFQUFFUixPQUFPLEdBQUcsQ0FBQyxDQUFDLEVBQUU7SUFDM0MsSUFBSTtNQUNBLE1BQU1pQixRQUFRLEdBQUdqQixPQUFPLENBQUNpQixRQUFRLElBQUksZUFBZTtNQUNwRCxNQUFNTyxTQUFTLEdBQUd4QixPQUFPLENBQUN3QixTQUFTLElBQUksS0FBSzs7TUFFNUM7TUFDQSxNQUFNSSxjQUFjLEdBQUc7UUFDbkJDLFFBQVEsRUFBRSxDQUNOLG1DQUFtQyxFQUNuQyxvQ0FBb0MsRUFDcEMscUNBQXFDLEVBQ3JDLHNDQUFzQyxFQUN0Qyx1Q0FBdUMsRUFDdkMsd0NBQXdDLEVBQ3hDLGtDQUFrQyxFQUNsQyxrQ0FBa0MsRUFDbEMsK0JBQStCLEVBQy9CLHdDQUF3QyxFQUN4QyxhQUFhLEVBQ2IsVUFBVSxFQUNWLFVBQVU7TUFFbEIsQ0FBQzs7TUFFRDtNQUNBLE1BQU1DLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQ0MsZUFBZSxDQUFDdkIsT0FBTyxDQUFDOztNQUVwRDtNQUNBLE1BQU1PLE1BQU0sR0FBRyxNQUFNcEQsT0FBTyxDQUFDcUUsYUFBYSxDQUFDO1FBQUVqQyxNQUFNLEVBQUVTO01BQVEsQ0FBQyxFQUFFb0IsY0FBYyxDQUFDO01BQy9FLE1BQU1LLElBQUksR0FBR2xCLE1BQU0sQ0FBQ21CLEtBQUs7TUFDekIsTUFBTUMsUUFBUSxHQUFHcEIsTUFBTSxDQUFDcUIsUUFBUTtNQUVoQyxJQUFJRCxRQUFRLENBQUNFLE1BQU0sR0FBRyxDQUFDLEVBQUU7UUFDckJmLE9BQU8sQ0FBQ2dCLElBQUksQ0FBQyxzQ0FBc0MsRUFBRUgsUUFBUSxDQUFDO01BQ2xFOztNQUVBO01BQ0EsTUFBTUksZUFBZSxHQUFHOUUsT0FBTyxDQUFDLFVBQVUsQ0FBQztNQUMzQyxNQUFNK0UsZUFBZSxHQUFHLElBQUlELGVBQWUsQ0FBQztRQUN4Q0UsWUFBWSxFQUFFLEtBQUs7UUFDbkJDLGNBQWMsRUFBRSxRQUFRO1FBQ3hCQyxXQUFXLEVBQUUsR0FBRztRQUNoQkMsZ0JBQWdCLEVBQUU7TUFDdEIsQ0FBQyxDQUFDOztNQUVGO01BQ0FKLGVBQWUsQ0FBQ0ssT0FBTyxDQUFDLFFBQVEsRUFBRTtRQUM5QkMsTUFBTSxFQUFFLE9BQU87UUFDZkMsV0FBVyxFQUFFLFNBQUFBLENBQVN2QyxPQUFPLEVBQUV3QyxJQUFJLEVBQUU7VUFDakM7VUFDQSxNQUFNQyxJQUFJLEdBQUdELElBQUksQ0FBQ0MsSUFBSTtVQUN0QixJQUFJQSxJQUFJLENBQUNaLE1BQU0sS0FBSyxDQUFDLEVBQUUsT0FBTyxFQUFFO1VBRWhDLElBQUlhLFFBQVEsR0FBRyxNQUFNOztVQUVyQjtVQUNBLE1BQU1DLFdBQVcsR0FBR0MsS0FBSyxDQUFDMUMsSUFBSSxDQUFDdUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDSSxLQUFLLENBQUM7VUFDN0NILFFBQVEsSUFBSSxJQUFJLEdBQUdDLFdBQVcsQ0FBQ0csR0FBRyxDQUFDQyxJQUFJLElBQUlBLElBQUksQ0FBQ0MsV0FBVyxDQUFDQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUNDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxNQUFNO1VBQ3hGUixRQUFRLElBQUksSUFBSSxHQUFHQyxXQUFXLENBQUNHLEdBQUcsQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFDSSxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsTUFBTTs7VUFFcEU7VUFDQSxLQUFLLElBQUlDLENBQUMsR0FBRyxDQUFDLEVBQUVBLENBQUMsR0FBR1YsSUFBSSxDQUFDWixNQUFNLEVBQUVzQixDQUFDLEVBQUUsRUFBRTtZQUNsQyxNQUFNTixLQUFLLEdBQUdELEtBQUssQ0FBQzFDLElBQUksQ0FBQ3VDLElBQUksQ0FBQ1UsQ0FBQyxDQUFDLENBQUNOLEtBQUssQ0FBQztZQUN2Q0gsUUFBUSxJQUFJLElBQUksR0FBR0csS0FBSyxDQUFDQyxHQUFHLENBQUNDLElBQUksSUFBSUEsSUFBSSxDQUFDQyxXQUFXLENBQUNDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQ0MsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLE1BQU07VUFDdEY7VUFFQSxPQUFPUixRQUFRO1FBQ25CO01BQ0osQ0FBQyxDQUFDOztNQUVGO01BQ0EsTUFBTVUsZUFBZSxHQUFHcEIsZUFBZSxDQUFDcUIsUUFBUSxDQUFDNUIsSUFBSSxDQUFDOztNQUV0RDtNQUNBLE1BQU1wRCxHQUFHLEdBQUcsSUFBSUQsSUFBSSxDQUFDLENBQUM7TUFDdEIsTUFBTWtGLGFBQWEsR0FBR2pGLEdBQUcsQ0FBQ2tGLFdBQVcsQ0FBQyxDQUFDLENBQUNDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQ0MsT0FBTyxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUM7O01BRXZFO01BQ0EsTUFBTUMsU0FBUyxHQUFHcEMsUUFBUSxDQUFDcUMsS0FBSyxJQUFJM0csSUFBSSxDQUFDNEQsUUFBUSxDQUFDSCxRQUFRLEVBQUV6RCxJQUFJLENBQUM0RyxPQUFPLENBQUNuRCxRQUFRLENBQUMsQ0FBQzs7TUFFbkY7TUFDQSxNQUFNb0QsV0FBVyxHQUFHLENBQ2hCLEtBQUssRUFDTCxVQUFVSCxTQUFTLEVBQUUsRUFDckIsY0FBY0osYUFBYSxFQUFFLEVBQzdCLFlBQVksRUFDWixLQUFLLEVBQ0wsRUFBRSxDQUNMLENBQUNKLElBQUksQ0FBQyxJQUFJLENBQUM7O01BRVo7TUFDQSxPQUFPVyxXQUFXLEdBQUdULGVBQWU7SUFDeEMsQ0FBQyxDQUFDLE9BQU92QyxLQUFLLEVBQUU7TUFDWkMsT0FBTyxDQUFDRCxLQUFLLENBQUMsNkNBQTZDLEVBQUVBLEtBQUssQ0FBQztNQUNuRSxNQUFNQSxLQUFLO0lBQ2Y7RUFDSjs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTVUsZUFBZUEsQ0FBQ3ZCLE9BQU8sRUFBRTtJQUMzQixJQUFJO01BQ0E7TUFDQSxNQUFNTyxNQUFNLEdBQUcsTUFBTXBELE9BQU8sQ0FBQzJHLGNBQWMsQ0FBQztRQUFFdkUsTUFBTSxFQUFFUztNQUFRLENBQUMsQ0FBQztNQUNoRSxNQUFNK0QsSUFBSSxHQUFHeEQsTUFBTSxDQUFDbUIsS0FBSzs7TUFFekI7TUFDQSxJQUFJaUMsS0FBSyxHQUFHLEVBQUU7TUFDZCxNQUFNSyxVQUFVLEdBQUdELElBQUksQ0FBQ0UsS0FBSyxDQUFDLGdCQUFnQixDQUFDO01BQy9DLElBQUlELFVBQVUsRUFBRTtRQUNaTCxLQUFLLEdBQUdLLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQ2YsSUFBSSxDQUFDLENBQUM7TUFDaEM7O01BRUE7TUFDQSxPQUFPO1FBQ0hVLEtBQUs7UUFDTE8sTUFBTSxFQUFFLEVBQUU7UUFDVkMsSUFBSSxFQUFFLElBQUkvRixJQUFJLENBQUMsQ0FBQyxDQUFDbUYsV0FBVyxDQUFDLENBQUMsQ0FBQ0MsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUM1Q1ksT0FBTyxFQUFFLEVBQUU7UUFDWEMsUUFBUSxFQUFFLEVBQUU7UUFDWkMsU0FBUyxFQUFFLElBQUksQ0FBQ0MsaUJBQWlCLENBQUNSLElBQUk7TUFDMUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxPQUFPbEQsS0FBSyxFQUFFO01BQ1pDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLDZDQUE2QyxFQUFFQSxLQUFLLENBQUM7TUFDbkUsT0FBTztRQUNIOEMsS0FBSyxFQUFFLEVBQUU7UUFDVE8sTUFBTSxFQUFFLEVBQUU7UUFDVkMsSUFBSSxFQUFFLElBQUkvRixJQUFJLENBQUMsQ0FBQyxDQUFDbUYsV0FBVyxDQUFDLENBQUMsQ0FBQ0MsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUM1Q1ksT0FBTyxFQUFFLEVBQUU7UUFDWEMsUUFBUSxFQUFFLEVBQUU7UUFDWkMsU0FBUyxFQUFFO01BQ2YsQ0FBQztJQUNMO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJQyxpQkFBaUJBLENBQUNSLElBQUksRUFBRTtJQUNwQjtJQUNBLE1BQU1TLFlBQVksR0FBRyxJQUFJO0lBQ3pCLE9BQU9sRyxJQUFJLENBQUNtRyxHQUFHLENBQUMsQ0FBQyxFQUFFbkcsSUFBSSxDQUFDb0csSUFBSSxDQUFDWCxJQUFJLENBQUNsQyxNQUFNLEdBQUcyQyxZQUFZLENBQUMsQ0FBQztFQUM3RDs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0lHLFlBQVlBLENBQUNyRixRQUFRLEVBQUU7SUFDbkIsTUFBTXNGLEdBQUcsR0FBRzVILElBQUksQ0FBQzRHLE9BQU8sQ0FBQ3RFLFFBQVEsQ0FBQyxDQUFDdUYsV0FBVyxDQUFDLENBQUM7SUFDaEQsT0FBTyxJQUFJLENBQUNsSCxtQkFBbUIsQ0FBQ21ILFFBQVEsQ0FBQ0YsR0FBRyxDQUFDO0VBQ2pEOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0VBQ0lHLE9BQU9BLENBQUEsRUFBRztJQUNOLE9BQU87TUFDSHBFLElBQUksRUFBRSxnQkFBZ0I7TUFDdEJxRSxVQUFVLEVBQUUsSUFBSSxDQUFDckgsbUJBQW1CO01BQ3BDc0gsV0FBVyxFQUFFLGlDQUFpQztNQUM5Q3pGLE9BQU8sRUFBRTtRQUNMbUUsS0FBSyxFQUFFLHlCQUF5QjtRQUNoQzNDLFNBQVMsRUFBRTtNQUNmO0lBQ0osQ0FBQztFQUNMO0FBQ0o7QUFFQWtFLE1BQU0sQ0FBQ0MsT0FBTyxHQUFHNUgsYUFBYSIsImlnbm9yZUxpc3QiOltdfQ==