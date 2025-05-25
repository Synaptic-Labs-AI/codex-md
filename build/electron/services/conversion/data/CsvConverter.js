"use strict";

/**
 * CsvConverter.js
 * Handles conversion of CSV files to markdown format in the Electron main process.
 * 
 * This converter:
 * - Parses CSV files using csv-parse/sync
 * - Extracts table data and metadata
 * - Generates markdown tables
 * - Handles large files efficiently
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - FileProcessorService.js: Used for file operations
 * - ConversionService.js: Registers and uses this converter
 */

const path = require('path');
const {
  parse
} = require('csv-parse/sync');
const BaseService = require('../../BaseService');
class CsvConverter extends BaseService {
  constructor(fileProcessor) {
    super();
    this.fileProcessor = fileProcessor;
    this.supportedExtensions = ['.csv'];
  }

  /**
   * Set up IPC handlers for CSV conversion
   */
  setupIpcHandlers() {
    this.registerHandler('convert:csv', this.handleConvert.bind(this));
    this.registerHandler('convert:csv:preview', this.handlePreview.bind(this));
  }

  /**
   * Handle CSV conversion request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Conversion request details
   */
  async handleConvert(event, {
    filePath,
    options = {}
  }) {
    try {
      console.log(`[CsvConverter] Converting file: ${filePath}`);
      console.log(`[CsvConverter] Options:`, JSON.stringify(options, null, 2));

      // Add error handling for file reading
      let content;
      try {
        console.log(`[CsvConverter] Reading file with encoding: ${options.encoding || 'utf8'}`);
        content = await this.fileProcessor.handleFileRead(null, {
          filePath,
          encoding: options.encoding || 'utf8'
        });
        console.log(`[CsvConverter] File read successful, content length: ${content?.content?.length || 0} bytes`);
      } catch (readError) {
        console.error(`[CsvConverter] Failed to read CSV file: ${filePath}`, readError);
        throw new Error(`Failed to read CSV file: ${readError.message}`);
      }

      // Validate content
      if (!content || !content.content || content.content.trim() === '') {
        console.error(`[CsvConverter] Empty or invalid CSV file: ${filePath}`);
        throw new Error('CSV file is empty or contains no valid content');
      }
      console.log(`[CsvConverter] Starting markdown conversion for CSV content`);
      console.log(`[CsvConverter] First 100 chars of content: ${content.content.substring(0, 100)}...`);
      const result = await this.convertToMarkdown(content.content, options);

      // Validate result
      if (!result || result.trim() === '') {
        console.error(`[CsvConverter] Conversion produced empty content: ${filePath}`);
        throw new Error('CSV conversion produced empty content');
      }
      console.log(`[CsvConverter] Conversion successful, markdown length: ${result.length} bytes`);
      console.log(`[CsvConverter] First 100 chars of markdown: ${result.substring(0, 100)}...`);

      // Return with proper structure
      const response = {
        content: result
      };
      console.log(`[CsvConverter] Returning response with content property`);
      return response;
    } catch (error) {
      console.error('[CsvConverter] Conversion failed:', error);
      throw error;
    }
  }

  /**
   * Handle CSV preview request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Preview request details
   */
  async handlePreview(event, {
    filePath,
    options = {}
  }) {
    try {
      // Read first 10 lines for preview
      const content = await this.fileProcessor.handleFileRead(null, {
        filePath,
        encoding: options.encoding || 'utf8'
      });
      const lines = content.content.split('\n').slice(0, 10).join('\n');
      const result = await this.convertToMarkdown(lines, {
        ...options,
        preview: true
      });
      return {
        content: result
      };
    } catch (error) {
      console.error('[CsvConverter] Preview generation failed:', error);
      throw error;
    }
  }

  /**
   * Convert CSV content to markdown
   * @param {string} content - CSV content
   * @param {Object} options - Conversion options
   * @returns {Promise<string>} Markdown content
   */
  async convertToMarkdown(content, options = {}) {
    try {
      console.log(`[CsvConverter] convertToMarkdown called with content length: ${content?.length || 0} bytes`);
      console.log(`[CsvConverter] convertToMarkdown options:`, JSON.stringify(options, null, 2));

      // Validate input content
      if (!content || content.trim() === '') {
        console.warn('[CsvConverter] Empty content provided for conversion');
        return '> No data found in CSV file.';
      }

      // Check if content has at least one line with comma or tab
      const hasDelimiters = content.includes(',') || content.includes('\t');
      if (!hasDelimiters) {
        console.warn('[CsvConverter] Content appears to lack proper CSV delimiters');
        return '> File does not appear to be a valid CSV (no delimiters found).';
      }

      // Enhanced parsing with better error handling
      let records;
      try {
        console.log(`[CsvConverter] Parsing CSV with options:`, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
          ...(options.csvOptions || {})
        });
        records = parse(content, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
          // Handle inconsistent column counts
          ...options.csvOptions
        });
        console.log(`[CsvConverter] CSV parsing successful, found ${records?.length || 0} records`);
      } catch (parseError) {
        console.error('[CsvConverter] CSV parsing failed:', parseError);
        console.error('[CsvConverter] First 200 characters of problematic content:', content.substring(0, 200));
        return `> Error parsing CSV: ${parseError.message}\n\n\`\`\`\nFirst 100 characters of content:\n${content.substring(0, 100)}...\n\`\`\``;
      }

      // Handle empty records
      if (!records || records.length === 0) {
        console.warn('[CsvConverter] No records found after parsing');
        return '> No data found in CSV file.';
      }

      // Handle missing headers
      if (!records[0]) {
        console.warn('[CsvConverter] First record is undefined');
        return '> CSV file has invalid structure.';
      }
      const headers = Object.keys(records[0]);
      if (headers.length === 0) {
        console.warn('[CsvConverter] No columns found in parsed data');
        return '> No columns found in CSV file.';
      }
      // Get the original filename without extension
      const fileName = options.originalFileName || options.name || 'csv-data';
      const fileTitle = fileName.replace(/\.[^/.]+$/, ''); // Remove file extension if present
      console.log(`[CsvConverter] Using title for conversion: ${fileTitle} (from ${fileName})`);

      // Build markdown with YAML frontmatter
      let markdown = [];

      // Create standardized frontmatter using metadata utility
      const {
        createStandardFrontmatter
      } = require('../../../converters/utils/metadata');
      const frontmatter = createStandardFrontmatter({
        title: fileTitle,
        fileType: 'csv'
      });
      markdown.push(frontmatter.trim());
      markdown.push('');

      // Add table metadata as a note
      markdown.push(`> CSV Data${options.preview ? ' (Preview)' : ''}`);
      markdown.push(`> - Columns: ${headers.length}`);
      markdown.push(`> - Rows: ${records.length}`);
      markdown.push('');

      // Build table header
      markdown.push('| ' + headers.join(' | ') + ' |');
      markdown.push('| ' + headers.map(() => '---').join(' | ') + ' |');

      // Build table rows with enhanced error handling
      records.forEach((record, index) => {
        try {
          const row = headers.map(header => {
            try {
              const cell = record[header];
              // Handle null/undefined values
              if (cell === null || cell === undefined) {
                return '';
              }
              // Escape pipe characters and handle line breaks
              return cell.toString().replace(/\|/g, '\\|').replace(/\n/g, '<br>');
            } catch (cellError) {
              console.warn(`[CsvConverter] Error processing cell in column "${header}" at row ${index}:`, cellError);
              return '';
            }
          });
          markdown.push('| ' + row.join(' | ') + ' |');
        } catch (rowError) {
          console.warn(`[CsvConverter] Error processing row ${index}:`, rowError);
          // Skip problematic rows instead of failing the entire conversion
        }
      });
      const result = markdown.join('\n');
      console.log(`[CsvConverter] Markdown generation complete, length: ${result.length} bytes`);
      return result;
    } catch (error) {
      console.error('[CsvConverter] Markdown conversion failed:', error);
      console.error('[CsvConverter] Error details:', error.stack || error);
      throw error;
    }
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
      name: 'CSV Converter',
      extensions: this.supportedExtensions,
      description: 'Converts CSV files to markdown tables',
      options: {
        encoding: 'File encoding (default: utf8)',
        title: 'Optional table title',
        csvOptions: 'Additional CSV parsing options'
      }
    };
  }
}
module.exports = CsvConverter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsInBhcnNlIiwiQmFzZVNlcnZpY2UiLCJDc3ZDb252ZXJ0ZXIiLCJjb25zdHJ1Y3RvciIsImZpbGVQcm9jZXNzb3IiLCJzdXBwb3J0ZWRFeHRlbnNpb25zIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUNvbnZlcnQiLCJiaW5kIiwiaGFuZGxlUHJldmlldyIsImV2ZW50IiwiZmlsZVBhdGgiLCJvcHRpb25zIiwiY29uc29sZSIsImxvZyIsIkpTT04iLCJzdHJpbmdpZnkiLCJjb250ZW50IiwiZW5jb2RpbmciLCJoYW5kbGVGaWxlUmVhZCIsImxlbmd0aCIsInJlYWRFcnJvciIsImVycm9yIiwiRXJyb3IiLCJtZXNzYWdlIiwidHJpbSIsInN1YnN0cmluZyIsInJlc3VsdCIsImNvbnZlcnRUb01hcmtkb3duIiwicmVzcG9uc2UiLCJsaW5lcyIsInNwbGl0Iiwic2xpY2UiLCJqb2luIiwicHJldmlldyIsIndhcm4iLCJoYXNEZWxpbWl0ZXJzIiwiaW5jbHVkZXMiLCJyZWNvcmRzIiwiY29sdW1ucyIsInNraXBfZW1wdHlfbGluZXMiLCJyZWxheF9jb2x1bW5fY291bnQiLCJjc3ZPcHRpb25zIiwicGFyc2VFcnJvciIsImhlYWRlcnMiLCJPYmplY3QiLCJrZXlzIiwiZmlsZU5hbWUiLCJvcmlnaW5hbEZpbGVOYW1lIiwibmFtZSIsImZpbGVUaXRsZSIsInJlcGxhY2UiLCJtYXJrZG93biIsImNyZWF0ZVN0YW5kYXJkRnJvbnRtYXR0ZXIiLCJmcm9udG1hdHRlciIsInRpdGxlIiwiZmlsZVR5cGUiLCJwdXNoIiwibWFwIiwiZm9yRWFjaCIsInJlY29yZCIsImluZGV4Iiwicm93IiwiaGVhZGVyIiwiY2VsbCIsInVuZGVmaW5lZCIsInRvU3RyaW5nIiwiY2VsbEVycm9yIiwicm93RXJyb3IiLCJzdGFjayIsInN1cHBvcnRzRmlsZSIsImV4dCIsImV4dG5hbWUiLCJ0b0xvd2VyQ2FzZSIsImdldEluZm8iLCJleHRlbnNpb25zIiwiZGVzY3JpcHRpb24iLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vZGF0YS9Dc3ZDb252ZXJ0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIENzdkNvbnZlcnRlci5qc1xyXG4gKiBIYW5kbGVzIGNvbnZlcnNpb24gb2YgQ1NWIGZpbGVzIHRvIG1hcmtkb3duIGZvcm1hdCBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBcclxuICogVGhpcyBjb252ZXJ0ZXI6XHJcbiAqIC0gUGFyc2VzIENTViBmaWxlcyB1c2luZyBjc3YtcGFyc2Uvc3luY1xyXG4gKiAtIEV4dHJhY3RzIHRhYmxlIGRhdGEgYW5kIG1ldGFkYXRhXHJcbiAqIC0gR2VuZXJhdGVzIG1hcmtkb3duIHRhYmxlc1xyXG4gKiAtIEhhbmRsZXMgbGFyZ2UgZmlsZXMgZWZmaWNpZW50bHlcclxuICogXHJcbiAqIFJlbGF0ZWQgRmlsZXM6XHJcbiAqIC0gQmFzZVNlcnZpY2UuanM6IFBhcmVudCBjbGFzcyBwcm92aWRpbmcgSVBDIGhhbmRsaW5nXHJcbiAqIC0gRmlsZVByb2Nlc3NvclNlcnZpY2UuanM6IFVzZWQgZm9yIGZpbGUgb3BlcmF0aW9uc1xyXG4gKiAtIENvbnZlcnNpb25TZXJ2aWNlLmpzOiBSZWdpc3RlcnMgYW5kIHVzZXMgdGhpcyBjb252ZXJ0ZXJcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IHBhcnNlIH0gPSByZXF1aXJlKCdjc3YtcGFyc2Uvc3luYycpO1xyXG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL0Jhc2VTZXJ2aWNlJyk7XHJcblxyXG5jbGFzcyBDc3ZDb252ZXJ0ZXIgZXh0ZW5kcyBCYXNlU2VydmljZSB7XHJcbiAgICBjb25zdHJ1Y3RvcihmaWxlUHJvY2Vzc29yKSB7XHJcbiAgICAgICAgc3VwZXIoKTtcclxuICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yO1xyXG4gICAgICAgIHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyA9IFsnLmNzdiddO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogU2V0IHVwIElQQyBoYW5kbGVycyBmb3IgQ1NWIGNvbnZlcnNpb25cclxuICAgICAqL1xyXG4gICAgc2V0dXBJcGNIYW5kbGVycygpIHtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpjc3YnLCB0aGlzLmhhbmRsZUNvbnZlcnQuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6Y3N2OnByZXZpZXcnLCB0aGlzLmhhbmRsZVByZXZpZXcuYmluZCh0aGlzKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgQ1NWIGNvbnZlcnNpb24gcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIENvbnZlcnNpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUNvbnZlcnQoZXZlbnQsIHsgZmlsZVBhdGgsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIENvbnZlcnRpbmcgZmlsZTogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIE9wdGlvbnM6YCwgSlNPTi5zdHJpbmdpZnkob3B0aW9ucywgbnVsbCwgMikpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIGVycm9yIGhhbmRsaW5nIGZvciBmaWxlIHJlYWRpbmdcclxuICAgICAgICAgICAgbGV0IGNvbnRlbnQ7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0NzdkNvbnZlcnRlcl0gUmVhZGluZyBmaWxlIHdpdGggZW5jb2Rpbmc6ICR7b3B0aW9ucy5lbmNvZGluZyB8fCAndXRmOCd9YCk7XHJcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gYXdhaXQgdGhpcy5maWxlUHJvY2Vzc29yLmhhbmRsZUZpbGVSZWFkKG51bGwsIHtcclxuICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBlbmNvZGluZzogb3B0aW9ucy5lbmNvZGluZyB8fCAndXRmOCdcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIEZpbGUgcmVhZCBzdWNjZXNzZnVsLCBjb250ZW50IGxlbmd0aDogJHtjb250ZW50Py5jb250ZW50Py5sZW5ndGggfHwgMH0gYnl0ZXNgKTtcclxuICAgICAgICAgICAgfSBjYXRjaCAocmVhZEVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbQ3N2Q29udmVydGVyXSBGYWlsZWQgdG8gcmVhZCBDU1YgZmlsZTogJHtmaWxlUGF0aH1gLCByZWFkRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcmVhZCBDU1YgZmlsZTogJHtyZWFkRXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgY29udGVudFxyXG4gICAgICAgICAgICBpZiAoIWNvbnRlbnQgfHwgIWNvbnRlbnQuY29udGVudCB8fCBjb250ZW50LmNvbnRlbnQudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0NzdkNvbnZlcnRlcl0gRW1wdHkgb3IgaW52YWxpZCBDU1YgZmlsZTogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ1NWIGZpbGUgaXMgZW1wdHkgb3IgY29udGFpbnMgbm8gdmFsaWQgY29udGVudCcpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0NzdkNvbnZlcnRlcl0gU3RhcnRpbmcgbWFya2Rvd24gY29udmVyc2lvbiBmb3IgQ1NWIGNvbnRlbnRgKTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIEZpcnN0IDEwMCBjaGFycyBvZiBjb250ZW50OiAke2NvbnRlbnQuY29udGVudC5zdWJzdHJpbmcoMCwgMTAwKX0uLi5gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29udmVydFRvTWFya2Rvd24oY29udGVudC5jb250ZW50LCBvcHRpb25zKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIHJlc3VsdFxyXG4gICAgICAgICAgICBpZiAoIXJlc3VsdCB8fCByZXN1bHQudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0NzdkNvbnZlcnRlcl0gQ29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50OiAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDU1YgY29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50Jyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQ3N2Q29udmVydGVyXSBDb252ZXJzaW9uIHN1Y2Nlc3NmdWwsIG1hcmtkb3duIGxlbmd0aDogJHtyZXN1bHQubGVuZ3RofSBieXRlc2ApO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0NzdkNvbnZlcnRlcl0gRmlyc3QgMTAwIGNoYXJzIG9mIG1hcmtkb3duOiAke3Jlc3VsdC5zdWJzdHJpbmcoMCwgMTAwKX0uLi5gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFJldHVybiB3aXRoIHByb3BlciBzdHJ1Y3R1cmVcclxuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSB7IGNvbnRlbnQ6IHJlc3VsdCB9O1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0NzdkNvbnZlcnRlcl0gUmV0dXJuaW5nIHJlc3BvbnNlIHdpdGggY29udGVudCBwcm9wZXJ0eWApO1xyXG4gICAgICAgICAgICByZXR1cm4gcmVzcG9uc2U7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0NzdkNvbnZlcnRlcl0gQ29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgQ1NWIHByZXZpZXcgcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFByZXZpZXcgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZVByZXZpZXcoZXZlbnQsIHsgZmlsZVBhdGgsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgLy8gUmVhZCBmaXJzdCAxMCBsaW5lcyBmb3IgcHJldmlld1xyXG4gICAgICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5maWxlUHJvY2Vzc29yLmhhbmRsZUZpbGVSZWFkKG51bGwsIHtcclxuICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxyXG4gICAgICAgICAgICAgICAgZW5jb2Rpbmc6IG9wdGlvbnMuZW5jb2RpbmcgfHwgJ3V0ZjgnXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgY29uc3QgbGluZXMgPSBjb250ZW50LmNvbnRlbnQuc3BsaXQoJ1xcbicpLnNsaWNlKDAsIDEwKS5qb2luKCdcXG4nKTtcclxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb252ZXJ0VG9NYXJrZG93bihsaW5lcywge1xyXG4gICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgIHByZXZpZXc6IHRydWVcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4geyBjb250ZW50OiByZXN1bHQgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbQ3N2Q29udmVydGVyXSBQcmV2aWV3IGdlbmVyYXRpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ29udmVydCBDU1YgY29udGVudCB0byBtYXJrZG93blxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnRlbnQgLSBDU1YgY29udGVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IE1hcmtkb3duIGNvbnRlbnRcclxuICAgICAqL1xyXG4gICAgYXN5bmMgY29udmVydFRvTWFya2Rvd24oY29udGVudCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIGNvbnZlcnRUb01hcmtkb3duIGNhbGxlZCB3aXRoIGNvbnRlbnQgbGVuZ3RoOiAke2NvbnRlbnQ/Lmxlbmd0aCB8fCAwfSBieXRlc2ApO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0NzdkNvbnZlcnRlcl0gY29udmVydFRvTWFya2Rvd24gb3B0aW9uczpgLCBKU09OLnN0cmluZ2lmeShvcHRpb25zLCBudWxsLCAyKSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSBpbnB1dCBjb250ZW50XHJcbiAgICAgICAgICAgIGlmICghY29udGVudCB8fCBjb250ZW50LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignW0NzdkNvbnZlcnRlcl0gRW1wdHkgY29udGVudCBwcm92aWRlZCBmb3IgY29udmVyc2lvbicpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuICc+IE5vIGRhdGEgZm91bmQgaW4gQ1NWIGZpbGUuJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgY29udGVudCBoYXMgYXQgbGVhc3Qgb25lIGxpbmUgd2l0aCBjb21tYSBvciB0YWJcclxuICAgICAgICAgICAgY29uc3QgaGFzRGVsaW1pdGVycyA9IGNvbnRlbnQuaW5jbHVkZXMoJywnKSB8fCBjb250ZW50LmluY2x1ZGVzKCdcXHQnKTtcclxuICAgICAgICAgICAgaWYgKCFoYXNEZWxpbWl0ZXJzKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ1tDc3ZDb252ZXJ0ZXJdIENvbnRlbnQgYXBwZWFycyB0byBsYWNrIHByb3BlciBDU1YgZGVsaW1pdGVycycpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuICc+IEZpbGUgZG9lcyBub3QgYXBwZWFyIHRvIGJlIGEgdmFsaWQgQ1NWIChubyBkZWxpbWl0ZXJzIGZvdW5kKS4nO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFbmhhbmNlZCBwYXJzaW5nIHdpdGggYmV0dGVyIGVycm9yIGhhbmRsaW5nXHJcbiAgICAgICAgICAgIGxldCByZWNvcmRzO1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIFBhcnNpbmcgQ1NWIHdpdGggb3B0aW9uczpgLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBza2lwX2VtcHR5X2xpbmVzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIHRyaW06IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgcmVsYXhfY29sdW1uX2NvdW50OiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIC4uLihvcHRpb25zLmNzdk9wdGlvbnMgfHwge30pXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgcmVjb3JkcyA9IHBhcnNlKGNvbnRlbnQsIHtcclxuICAgICAgICAgICAgICAgICAgICBjb2x1bW5zOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIHNraXBfZW1wdHlfbGluZXM6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgdHJpbTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICByZWxheF9jb2x1bW5fY291bnQ6IHRydWUsIC8vIEhhbmRsZSBpbmNvbnNpc3RlbnQgY29sdW1uIGNvdW50c1xyXG4gICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMuY3N2T3B0aW9uc1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQ3N2Q29udmVydGVyXSBDU1YgcGFyc2luZyBzdWNjZXNzZnVsLCBmb3VuZCAke3JlY29yZHM/Lmxlbmd0aCB8fCAwfSByZWNvcmRzYCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKHBhcnNlRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tDc3ZDb252ZXJ0ZXJdIENTViBwYXJzaW5nIGZhaWxlZDonLCBwYXJzZUVycm9yKTtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tDc3ZDb252ZXJ0ZXJdIEZpcnN0IDIwMCBjaGFyYWN0ZXJzIG9mIHByb2JsZW1hdGljIGNvbnRlbnQ6JywgY29udGVudC5zdWJzdHJpbmcoMCwgMjAwKSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYD4gRXJyb3IgcGFyc2luZyBDU1Y6ICR7cGFyc2VFcnJvci5tZXNzYWdlfVxcblxcblxcYFxcYFxcYFxcbkZpcnN0IDEwMCBjaGFyYWN0ZXJzIG9mIGNvbnRlbnQ6XFxuJHtjb250ZW50LnN1YnN0cmluZygwLCAxMDApfS4uLlxcblxcYFxcYFxcYGA7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIEhhbmRsZSBlbXB0eSByZWNvcmRzXHJcbiAgICAgICAgICAgIGlmICghcmVjb3JkcyB8fCByZWNvcmRzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdbQ3N2Q29udmVydGVyXSBObyByZWNvcmRzIGZvdW5kIGFmdGVyIHBhcnNpbmcnKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiAnPiBObyBkYXRhIGZvdW5kIGluIENTViBmaWxlLic7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIEhhbmRsZSBtaXNzaW5nIGhlYWRlcnNcclxuICAgICAgICAgICAgaWYgKCFyZWNvcmRzWzBdKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ1tDc3ZDb252ZXJ0ZXJdIEZpcnN0IHJlY29yZCBpcyB1bmRlZmluZWQnKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiAnPiBDU1YgZmlsZSBoYXMgaW52YWxpZCBzdHJ1Y3R1cmUuJztcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgaGVhZGVycyA9IE9iamVjdC5rZXlzKHJlY29yZHNbMF0pO1xyXG4gICAgICAgICAgICBpZiAoaGVhZGVycy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignW0NzdkNvbnZlcnRlcl0gTm8gY29sdW1ucyBmb3VuZCBpbiBwYXJzZWQgZGF0YScpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuICc+IE5vIGNvbHVtbnMgZm91bmQgaW4gQ1NWIGZpbGUuJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyBHZXQgdGhlIG9yaWdpbmFsIGZpbGVuYW1lIHdpdGhvdXQgZXh0ZW5zaW9uXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IG9wdGlvbnMubmFtZSB8fCAnY3N2LWRhdGEnO1xyXG4gICAgICAgICAgICBjb25zdCBmaWxlVGl0bGUgPSBmaWxlTmFtZS5yZXBsYWNlKC9cXC5bXi8uXSskLywgJycpOyAvLyBSZW1vdmUgZmlsZSBleHRlbnNpb24gaWYgcHJlc2VudFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0NzdkNvbnZlcnRlcl0gVXNpbmcgdGl0bGUgZm9yIGNvbnZlcnNpb246ICR7ZmlsZVRpdGxlfSAoZnJvbSAke2ZpbGVOYW1lfSlgKTtcclxuXHJcbiAgICAgICAgICAgIC8vIEJ1aWxkIG1hcmtkb3duIHdpdGggWUFNTCBmcm9udG1hdHRlclxyXG4gICAgICAgICAgICBsZXQgbWFya2Rvd24gPSBbXTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgZnJvbnRtYXR0ZXIgdXNpbmcgbWV0YWRhdGEgdXRpbGl0eVxyXG4gICAgICAgICAgICBjb25zdCB7IGNyZWF0ZVN0YW5kYXJkRnJvbnRtYXR0ZXIgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL2NvbnZlcnRlcnMvdXRpbHMvbWV0YWRhdGEnKTtcclxuICAgICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBjcmVhdGVTdGFuZGFyZEZyb250bWF0dGVyKHtcclxuICAgICAgICAgICAgICAgIHRpdGxlOiBmaWxlVGl0bGUsXHJcbiAgICAgICAgICAgICAgICBmaWxlVHlwZTogJ2NzdidcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGZyb250bWF0dGVyLnRyaW0oKSk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG5cclxuICAgICAgICAgICAgLy8gQWRkIHRhYmxlIG1ldGFkYXRhIGFzIGEgbm90ZVxyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IENTViBEYXRhJHtvcHRpb25zLnByZXZpZXcgPyAnIChQcmV2aWV3KScgOiAnJ31gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgPiAtIENvbHVtbnM6ICR7aGVhZGVycy5sZW5ndGh9YCk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYD4gLSBSb3dzOiAke3JlY29yZHMubGVuZ3RofWApO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuXHJcbiAgICAgICAgICAgIC8vIEJ1aWxkIHRhYmxlIGhlYWRlclxyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCd8ICcgKyBoZWFkZXJzLmpvaW4oJyB8ICcpICsgJyB8Jyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ3wgJyArIGhlYWRlcnMubWFwKCgpID0+ICctLS0nKS5qb2luKCcgfCAnKSArICcgfCcpO1xyXG5cclxuICAgICAgICAgICAgLy8gQnVpbGQgdGFibGUgcm93cyB3aXRoIGVuaGFuY2VkIGVycm9yIGhhbmRsaW5nXHJcbiAgICAgICAgICAgIHJlY29yZHMuZm9yRWFjaCgocmVjb3JkLCBpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCByb3cgPSBoZWFkZXJzLm1hcChoZWFkZXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY2VsbCA9IHJlY29yZFtoZWFkZXJdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gSGFuZGxlIG51bGwvdW5kZWZpbmVkIHZhbHVlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNlbGwgPT09IG51bGwgfHwgY2VsbCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICcnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRXNjYXBlIHBpcGUgY2hhcmFjdGVycyBhbmQgaGFuZGxlIGxpbmUgYnJlYWtzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gY2VsbC50b1N0cmluZygpLnJlcGxhY2UoL1xcfC9nLCAnXFxcXHwnKS5yZXBsYWNlKC9cXG4vZywgJzxicj4nKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoY2VsbEVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtDc3ZDb252ZXJ0ZXJdIEVycm9yIHByb2Nlc3NpbmcgY2VsbCBpbiBjb2x1bW4gXCIke2hlYWRlcn1cIiBhdCByb3cgJHtpbmRleH06YCwgY2VsbEVycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ3wgJyArIHJvdy5qb2luKCcgfCAnKSArICcgfCcpO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAocm93RXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtDc3ZDb252ZXJ0ZXJdIEVycm9yIHByb2Nlc3Npbmcgcm93ICR7aW5kZXh9OmAsIHJvd0Vycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICAvLyBTa2lwIHByb2JsZW1hdGljIHJvd3MgaW5zdGVhZCBvZiBmYWlsaW5nIHRoZSBlbnRpcmUgY29udmVyc2lvblxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0NzdkNvbnZlcnRlcl0gTWFya2Rvd24gZ2VuZXJhdGlvbiBjb21wbGV0ZSwgbGVuZ3RoOiAke3Jlc3VsdC5sZW5ndGh9IGJ5dGVzYCk7XHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0NzdkNvbnZlcnRlcl0gTWFya2Rvd24gY29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbQ3N2Q29udmVydGVyXSBFcnJvciBkZXRhaWxzOicsIGVycm9yLnN0YWNrIHx8IGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgdGhpcyBjb252ZXJ0ZXIgc3VwcG9ydHMgdGhlIGdpdmVuIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gZmlsZVxyXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXHJcbiAgICAgKi9cclxuICAgIHN1cHBvcnRzRmlsZShmaWxlUGF0aCkge1xyXG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICByZXR1cm4gdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLmluY2x1ZGVzKGV4dCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgY29udmVydGVyIGluZm9ybWF0aW9uXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBnZXRJbmZvKCkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIG5hbWU6ICdDU1YgQ29udmVydGVyJyxcclxuICAgICAgICAgICAgZXh0ZW5zaW9uczogdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLFxyXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbnZlcnRzIENTViBmaWxlcyB0byBtYXJrZG93biB0YWJsZXMnLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgICBlbmNvZGluZzogJ0ZpbGUgZW5jb2RpbmcgKGRlZmF1bHQ6IHV0ZjgpJyxcclxuICAgICAgICAgICAgICAgIHRpdGxlOiAnT3B0aW9uYWwgdGFibGUgdGl0bGUnLFxyXG4gICAgICAgICAgICAgICAgY3N2T3B0aW9uczogJ0FkZGl0aW9uYWwgQ1NWIHBhcnNpbmcgb3B0aW9ucydcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQ3N2Q29udmVydGVyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNO0VBQUVDO0FBQU0sQ0FBQyxHQUFHRCxPQUFPLENBQUMsZ0JBQWdCLENBQUM7QUFDM0MsTUFBTUUsV0FBVyxHQUFHRixPQUFPLENBQUMsbUJBQW1CLENBQUM7QUFFaEQsTUFBTUcsWUFBWSxTQUFTRCxXQUFXLENBQUM7RUFDbkNFLFdBQVdBLENBQUNDLGFBQWEsRUFBRTtJQUN2QixLQUFLLENBQUMsQ0FBQztJQUNQLElBQUksQ0FBQ0EsYUFBYSxHQUFHQSxhQUFhO0lBQ2xDLElBQUksQ0FBQ0MsbUJBQW1CLEdBQUcsQ0FBQyxNQUFNLENBQUM7RUFDdkM7O0VBRUE7QUFDSjtBQUNBO0VBQ0lDLGdCQUFnQkEsQ0FBQSxFQUFHO0lBQ2YsSUFBSSxDQUFDQyxlQUFlLENBQUMsYUFBYSxFQUFFLElBQUksQ0FBQ0MsYUFBYSxDQUFDQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDbEUsSUFBSSxDQUFDRixlQUFlLENBQUMscUJBQXFCLEVBQUUsSUFBSSxDQUFDRyxhQUFhLENBQUNELElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztFQUM5RTs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTUQsYUFBYUEsQ0FBQ0csS0FBSyxFQUFFO0lBQUVDLFFBQVE7SUFBRUMsT0FBTyxHQUFHLENBQUM7RUFBRSxDQUFDLEVBQUU7SUFDbkQsSUFBSTtNQUNBQyxPQUFPLENBQUNDLEdBQUcsQ0FBQyxtQ0FBbUNILFFBQVEsRUFBRSxDQUFDO01BQzFERSxPQUFPLENBQUNDLEdBQUcsQ0FBQyx5QkFBeUIsRUFBRUMsSUFBSSxDQUFDQyxTQUFTLENBQUNKLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7O01BRXhFO01BQ0EsSUFBSUssT0FBTztNQUNYLElBQUk7UUFDQUosT0FBTyxDQUFDQyxHQUFHLENBQUMsOENBQThDRixPQUFPLENBQUNNLFFBQVEsSUFBSSxNQUFNLEVBQUUsQ0FBQztRQUN2RkQsT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDZCxhQUFhLENBQUNnQixjQUFjLENBQUMsSUFBSSxFQUFFO1VBQ3BEUixRQUFRO1VBQ1JPLFFBQVEsRUFBRU4sT0FBTyxDQUFDTSxRQUFRLElBQUk7UUFDbEMsQ0FBQyxDQUFDO1FBQ0ZMLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHdEQUF3REcsT0FBTyxFQUFFQSxPQUFPLEVBQUVHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQztNQUM5RyxDQUFDLENBQUMsT0FBT0MsU0FBUyxFQUFFO1FBQ2hCUixPQUFPLENBQUNTLEtBQUssQ0FBQywyQ0FBMkNYLFFBQVEsRUFBRSxFQUFFVSxTQUFTLENBQUM7UUFDL0UsTUFBTSxJQUFJRSxLQUFLLENBQUMsNEJBQTRCRixTQUFTLENBQUNHLE9BQU8sRUFBRSxDQUFDO01BQ3BFOztNQUVBO01BQ0EsSUFBSSxDQUFDUCxPQUFPLElBQUksQ0FBQ0EsT0FBTyxDQUFDQSxPQUFPLElBQUlBLE9BQU8sQ0FBQ0EsT0FBTyxDQUFDUSxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtRQUMvRFosT0FBTyxDQUFDUyxLQUFLLENBQUMsNkNBQTZDWCxRQUFRLEVBQUUsQ0FBQztRQUN0RSxNQUFNLElBQUlZLEtBQUssQ0FBQyxnREFBZ0QsQ0FBQztNQUNyRTtNQUVBVixPQUFPLENBQUNDLEdBQUcsQ0FBQyw2REFBNkQsQ0FBQztNQUMxRUQsT0FBTyxDQUFDQyxHQUFHLENBQUMsOENBQThDRyxPQUFPLENBQUNBLE9BQU8sQ0FBQ1MsU0FBUyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsS0FBSyxDQUFDO01BRWpHLE1BQU1DLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQ0MsaUJBQWlCLENBQUNYLE9BQU8sQ0FBQ0EsT0FBTyxFQUFFTCxPQUFPLENBQUM7O01BRXJFO01BQ0EsSUFBSSxDQUFDZSxNQUFNLElBQUlBLE1BQU0sQ0FBQ0YsSUFBSSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7UUFDakNaLE9BQU8sQ0FBQ1MsS0FBSyxDQUFDLHFEQUFxRFgsUUFBUSxFQUFFLENBQUM7UUFDOUUsTUFBTSxJQUFJWSxLQUFLLENBQUMsdUNBQXVDLENBQUM7TUFDNUQ7TUFFQVYsT0FBTyxDQUFDQyxHQUFHLENBQUMsMERBQTBEYSxNQUFNLENBQUNQLE1BQU0sUUFBUSxDQUFDO01BQzVGUCxPQUFPLENBQUNDLEdBQUcsQ0FBQywrQ0FBK0NhLE1BQU0sQ0FBQ0QsU0FBUyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsS0FBSyxDQUFDOztNQUV6RjtNQUNBLE1BQU1HLFFBQVEsR0FBRztRQUFFWixPQUFPLEVBQUVVO01BQU8sQ0FBQztNQUNwQ2QsT0FBTyxDQUFDQyxHQUFHLENBQUMseURBQXlELENBQUM7TUFDdEUsT0FBT2UsUUFBUTtJQUNuQixDQUFDLENBQUMsT0FBT1AsS0FBSyxFQUFFO01BQ1pULE9BQU8sQ0FBQ1MsS0FBSyxDQUFDLG1DQUFtQyxFQUFFQSxLQUFLLENBQUM7TUFDekQsTUFBTUEsS0FBSztJQUNmO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJLE1BQU1iLGFBQWFBLENBQUNDLEtBQUssRUFBRTtJQUFFQyxRQUFRO0lBQUVDLE9BQU8sR0FBRyxDQUFDO0VBQUUsQ0FBQyxFQUFFO0lBQ25ELElBQUk7TUFDQTtNQUNBLE1BQU1LLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQ2QsYUFBYSxDQUFDZ0IsY0FBYyxDQUFDLElBQUksRUFBRTtRQUMxRFIsUUFBUTtRQUNSTyxRQUFRLEVBQUVOLE9BQU8sQ0FBQ00sUUFBUSxJQUFJO01BQ2xDLENBQUMsQ0FBQztNQUVGLE1BQU1ZLEtBQUssR0FBR2IsT0FBTyxDQUFDQSxPQUFPLENBQUNjLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQ0MsS0FBSyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQ0MsSUFBSSxDQUFDLElBQUksQ0FBQztNQUNqRSxNQUFNTixNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUNDLGlCQUFpQixDQUFDRSxLQUFLLEVBQUU7UUFDL0MsR0FBR2xCLE9BQU87UUFDVnNCLE9BQU8sRUFBRTtNQUNiLENBQUMsQ0FBQztNQUVGLE9BQU87UUFBRWpCLE9BQU8sRUFBRVU7TUFBTyxDQUFDO0lBQzlCLENBQUMsQ0FBQyxPQUFPTCxLQUFLLEVBQUU7TUFDWlQsT0FBTyxDQUFDUyxLQUFLLENBQUMsMkNBQTJDLEVBQUVBLEtBQUssQ0FBQztNQUNqRSxNQUFNQSxLQUFLO0lBQ2Y7RUFDSjs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDSSxNQUFNTSxpQkFBaUJBLENBQUNYLE9BQU8sRUFBRUwsT0FBTyxHQUFHLENBQUMsQ0FBQyxFQUFFO0lBQzNDLElBQUk7TUFDQUMsT0FBTyxDQUFDQyxHQUFHLENBQUMsZ0VBQWdFRyxPQUFPLEVBQUVHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQztNQUN6R1AsT0FBTyxDQUFDQyxHQUFHLENBQUMsMkNBQTJDLEVBQUVDLElBQUksQ0FBQ0MsU0FBUyxDQUFDSixPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDOztNQUUxRjtNQUNBLElBQUksQ0FBQ0ssT0FBTyxJQUFJQSxPQUFPLENBQUNRLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO1FBQ25DWixPQUFPLENBQUNzQixJQUFJLENBQUMsc0RBQXNELENBQUM7UUFDcEUsT0FBTyw4QkFBOEI7TUFDekM7O01BRUE7TUFDQSxNQUFNQyxhQUFhLEdBQUduQixPQUFPLENBQUNvQixRQUFRLENBQUMsR0FBRyxDQUFDLElBQUlwQixPQUFPLENBQUNvQixRQUFRLENBQUMsSUFBSSxDQUFDO01BQ3JFLElBQUksQ0FBQ0QsYUFBYSxFQUFFO1FBQ2hCdkIsT0FBTyxDQUFDc0IsSUFBSSxDQUFDLDhEQUE4RCxDQUFDO1FBQzVFLE9BQU8saUVBQWlFO01BQzVFOztNQUVBO01BQ0EsSUFBSUcsT0FBTztNQUNYLElBQUk7UUFDQXpCLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDBDQUEwQyxFQUFFO1VBQ3BEeUIsT0FBTyxFQUFFLElBQUk7VUFDYkMsZ0JBQWdCLEVBQUUsSUFBSTtVQUN0QmYsSUFBSSxFQUFFLElBQUk7VUFDVmdCLGtCQUFrQixFQUFFLElBQUk7VUFDeEIsSUFBSTdCLE9BQU8sQ0FBQzhCLFVBQVUsSUFBSSxDQUFDLENBQUM7UUFDaEMsQ0FBQyxDQUFDO1FBRUZKLE9BQU8sR0FBR3ZDLEtBQUssQ0FBQ2tCLE9BQU8sRUFBRTtVQUNyQnNCLE9BQU8sRUFBRSxJQUFJO1VBQ2JDLGdCQUFnQixFQUFFLElBQUk7VUFDdEJmLElBQUksRUFBRSxJQUFJO1VBQ1ZnQixrQkFBa0IsRUFBRSxJQUFJO1VBQUU7VUFDMUIsR0FBRzdCLE9BQU8sQ0FBQzhCO1FBQ2YsQ0FBQyxDQUFDO1FBRUY3QixPQUFPLENBQUNDLEdBQUcsQ0FBQyxnREFBZ0R3QixPQUFPLEVBQUVsQixNQUFNLElBQUksQ0FBQyxVQUFVLENBQUM7TUFDL0YsQ0FBQyxDQUFDLE9BQU91QixVQUFVLEVBQUU7UUFDakI5QixPQUFPLENBQUNTLEtBQUssQ0FBQyxvQ0FBb0MsRUFBRXFCLFVBQVUsQ0FBQztRQUMvRDlCLE9BQU8sQ0FBQ1MsS0FBSyxDQUFDLDZEQUE2RCxFQUFFTCxPQUFPLENBQUNTLFNBQVMsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFDdkcsT0FBTyx3QkFBd0JpQixVQUFVLENBQUNuQixPQUFPLGlEQUFpRFAsT0FBTyxDQUFDUyxTQUFTLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxhQUFhO01BQzVJOztNQUVBO01BQ0EsSUFBSSxDQUFDWSxPQUFPLElBQUlBLE9BQU8sQ0FBQ2xCLE1BQU0sS0FBSyxDQUFDLEVBQUU7UUFDbENQLE9BQU8sQ0FBQ3NCLElBQUksQ0FBQywrQ0FBK0MsQ0FBQztRQUM3RCxPQUFPLDhCQUE4QjtNQUN6Qzs7TUFFQTtNQUNBLElBQUksQ0FBQ0csT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFO1FBQ2J6QixPQUFPLENBQUNzQixJQUFJLENBQUMsMENBQTBDLENBQUM7UUFDeEQsT0FBTyxtQ0FBbUM7TUFDOUM7TUFFQSxNQUFNUyxPQUFPLEdBQUdDLE1BQU0sQ0FBQ0MsSUFBSSxDQUFDUixPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7TUFDdkMsSUFBSU0sT0FBTyxDQUFDeEIsTUFBTSxLQUFLLENBQUMsRUFBRTtRQUN0QlAsT0FBTyxDQUFDc0IsSUFBSSxDQUFDLGdEQUFnRCxDQUFDO1FBQzlELE9BQU8saUNBQWlDO01BQzVDO01BQ0E7TUFDQSxNQUFNWSxRQUFRLEdBQUduQyxPQUFPLENBQUNvQyxnQkFBZ0IsSUFBSXBDLE9BQU8sQ0FBQ3FDLElBQUksSUFBSSxVQUFVO01BQ3ZFLE1BQU1DLFNBQVMsR0FBR0gsUUFBUSxDQUFDSSxPQUFPLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7TUFDckR0QyxPQUFPLENBQUNDLEdBQUcsQ0FBQyw4Q0FBOENvQyxTQUFTLFVBQVVILFFBQVEsR0FBRyxDQUFDOztNQUV6RjtNQUNBLElBQUlLLFFBQVEsR0FBRyxFQUFFOztNQUVqQjtNQUNBLE1BQU07UUFBRUM7TUFBMEIsQ0FBQyxHQUFHdkQsT0FBTyxDQUFDLG9DQUFvQyxDQUFDO01BQ25GLE1BQU13RCxXQUFXLEdBQUdELHlCQUF5QixDQUFDO1FBQzFDRSxLQUFLLEVBQUVMLFNBQVM7UUFDaEJNLFFBQVEsRUFBRTtNQUNkLENBQUMsQ0FBQztNQUVGSixRQUFRLENBQUNLLElBQUksQ0FBQ0gsV0FBVyxDQUFDN0IsSUFBSSxDQUFDLENBQUMsQ0FBQztNQUNqQzJCLFFBQVEsQ0FBQ0ssSUFBSSxDQUFDLEVBQUUsQ0FBQzs7TUFFakI7TUFDQUwsUUFBUSxDQUFDSyxJQUFJLENBQUMsYUFBYTdDLE9BQU8sQ0FBQ3NCLE9BQU8sR0FBRyxZQUFZLEdBQUcsRUFBRSxFQUFFLENBQUM7TUFDakVrQixRQUFRLENBQUNLLElBQUksQ0FBQyxnQkFBZ0JiLE9BQU8sQ0FBQ3hCLE1BQU0sRUFBRSxDQUFDO01BQy9DZ0MsUUFBUSxDQUFDSyxJQUFJLENBQUMsYUFBYW5CLE9BQU8sQ0FBQ2xCLE1BQU0sRUFBRSxDQUFDO01BQzVDZ0MsUUFBUSxDQUFDSyxJQUFJLENBQUMsRUFBRSxDQUFDOztNQUVqQjtNQUNBTCxRQUFRLENBQUNLLElBQUksQ0FBQyxJQUFJLEdBQUdiLE9BQU8sQ0FBQ1gsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQztNQUNoRG1CLFFBQVEsQ0FBQ0ssSUFBSSxDQUFDLElBQUksR0FBR2IsT0FBTyxDQUFDYyxHQUFHLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQ3pCLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUM7O01BRWpFO01BQ0FLLE9BQU8sQ0FBQ3FCLE9BQU8sQ0FBQyxDQUFDQyxNQUFNLEVBQUVDLEtBQUssS0FBSztRQUMvQixJQUFJO1VBQ0EsTUFBTUMsR0FBRyxHQUFHbEIsT0FBTyxDQUFDYyxHQUFHLENBQUNLLE1BQU0sSUFBSTtZQUM5QixJQUFJO2NBQ0EsTUFBTUMsSUFBSSxHQUFHSixNQUFNLENBQUNHLE1BQU0sQ0FBQztjQUMzQjtjQUNBLElBQUlDLElBQUksS0FBSyxJQUFJLElBQUlBLElBQUksS0FBS0MsU0FBUyxFQUFFO2dCQUNyQyxPQUFPLEVBQUU7Y0FDYjtjQUNBO2NBQ0EsT0FBT0QsSUFBSSxDQUFDRSxRQUFRLENBQUMsQ0FBQyxDQUFDZixPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxDQUFDQSxPQUFPLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQztZQUN2RSxDQUFDLENBQUMsT0FBT2dCLFNBQVMsRUFBRTtjQUNoQnRELE9BQU8sQ0FBQ3NCLElBQUksQ0FBQyxtREFBbUQ0QixNQUFNLFlBQVlGLEtBQUssR0FBRyxFQUFFTSxTQUFTLENBQUM7Y0FDdEcsT0FBTyxFQUFFO1lBQ2I7VUFDSixDQUFDLENBQUM7VUFDRmYsUUFBUSxDQUFDSyxJQUFJLENBQUMsSUFBSSxHQUFHSyxHQUFHLENBQUM3QixJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDO1FBQ2hELENBQUMsQ0FBQyxPQUFPbUMsUUFBUSxFQUFFO1VBQ2Z2RCxPQUFPLENBQUNzQixJQUFJLENBQUMsdUNBQXVDMEIsS0FBSyxHQUFHLEVBQUVPLFFBQVEsQ0FBQztVQUN2RTtRQUNKO01BQ0osQ0FBQyxDQUFDO01BRUYsTUFBTXpDLE1BQU0sR0FBR3lCLFFBQVEsQ0FBQ25CLElBQUksQ0FBQyxJQUFJLENBQUM7TUFDbENwQixPQUFPLENBQUNDLEdBQUcsQ0FBQyx3REFBd0RhLE1BQU0sQ0FBQ1AsTUFBTSxRQUFRLENBQUM7TUFDMUYsT0FBT08sTUFBTTtJQUNqQixDQUFDLENBQUMsT0FBT0wsS0FBSyxFQUFFO01BQ1pULE9BQU8sQ0FBQ1MsS0FBSyxDQUFDLDRDQUE0QyxFQUFFQSxLQUFLLENBQUM7TUFDbEVULE9BQU8sQ0FBQ1MsS0FBSyxDQUFDLCtCQUErQixFQUFFQSxLQUFLLENBQUMrQyxLQUFLLElBQUkvQyxLQUFLLENBQUM7TUFDcEUsTUFBTUEsS0FBSztJQUNmO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJZ0QsWUFBWUEsQ0FBQzNELFFBQVEsRUFBRTtJQUNuQixNQUFNNEQsR0FBRyxHQUFHMUUsSUFBSSxDQUFDMkUsT0FBTyxDQUFDN0QsUUFBUSxDQUFDLENBQUM4RCxXQUFXLENBQUMsQ0FBQztJQUNoRCxPQUFPLElBQUksQ0FBQ3JFLG1CQUFtQixDQUFDaUMsUUFBUSxDQUFDa0MsR0FBRyxDQUFDO0VBQ2pEOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0VBQ0lHLE9BQU9BLENBQUEsRUFBRztJQUNOLE9BQU87TUFDSHpCLElBQUksRUFBRSxlQUFlO01BQ3JCMEIsVUFBVSxFQUFFLElBQUksQ0FBQ3ZFLG1CQUFtQjtNQUNwQ3dFLFdBQVcsRUFBRSx1Q0FBdUM7TUFDcERoRSxPQUFPLEVBQUU7UUFDTE0sUUFBUSxFQUFFLCtCQUErQjtRQUN6Q3FDLEtBQUssRUFBRSxzQkFBc0I7UUFDN0JiLFVBQVUsRUFBRTtNQUNoQjtJQUNKLENBQUM7RUFDTDtBQUNKO0FBRUFtQyxNQUFNLENBQUNDLE9BQU8sR0FBRzdFLFlBQVkiLCJpZ25vcmVMaXN0IjpbXX0=