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

      // Store original filename in metadata for later reference
      options.metadata = options.metadata || {};
      options.metadata.originalFileName = fileName;
      console.log(`[CsvConverter] Stored originalFileName in metadata: ${fileName}`);

      // Get current datetime
      const now = new Date();
      const convertedDate = now.toISOString().split('.')[0].replace('T', ' ');

      // Build markdown with YAML frontmatter
      let markdown = [];

      // Add standardized frontmatter
      markdown.push('---');
      markdown.push(`title: ${fileTitle}`);
      markdown.push(`converted: ${convertedDate}`);
      markdown.push('type: csv');
      markdown.push('---');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsInBhcnNlIiwiQmFzZVNlcnZpY2UiLCJDc3ZDb252ZXJ0ZXIiLCJjb25zdHJ1Y3RvciIsImZpbGVQcm9jZXNzb3IiLCJzdXBwb3J0ZWRFeHRlbnNpb25zIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUNvbnZlcnQiLCJiaW5kIiwiaGFuZGxlUHJldmlldyIsImV2ZW50IiwiZmlsZVBhdGgiLCJvcHRpb25zIiwiY29uc29sZSIsImxvZyIsIkpTT04iLCJzdHJpbmdpZnkiLCJjb250ZW50IiwiZW5jb2RpbmciLCJoYW5kbGVGaWxlUmVhZCIsImxlbmd0aCIsInJlYWRFcnJvciIsImVycm9yIiwiRXJyb3IiLCJtZXNzYWdlIiwidHJpbSIsInN1YnN0cmluZyIsInJlc3VsdCIsImNvbnZlcnRUb01hcmtkb3duIiwicmVzcG9uc2UiLCJsaW5lcyIsInNwbGl0Iiwic2xpY2UiLCJqb2luIiwicHJldmlldyIsIndhcm4iLCJoYXNEZWxpbWl0ZXJzIiwiaW5jbHVkZXMiLCJyZWNvcmRzIiwiY29sdW1ucyIsInNraXBfZW1wdHlfbGluZXMiLCJyZWxheF9jb2x1bW5fY291bnQiLCJjc3ZPcHRpb25zIiwicGFyc2VFcnJvciIsImhlYWRlcnMiLCJPYmplY3QiLCJrZXlzIiwiZmlsZU5hbWUiLCJvcmlnaW5hbEZpbGVOYW1lIiwibmFtZSIsImZpbGVUaXRsZSIsInJlcGxhY2UiLCJtZXRhZGF0YSIsIm5vdyIsIkRhdGUiLCJjb252ZXJ0ZWREYXRlIiwidG9JU09TdHJpbmciLCJtYXJrZG93biIsInB1c2giLCJtYXAiLCJmb3JFYWNoIiwicmVjb3JkIiwiaW5kZXgiLCJyb3ciLCJoZWFkZXIiLCJjZWxsIiwidW5kZWZpbmVkIiwidG9TdHJpbmciLCJjZWxsRXJyb3IiLCJyb3dFcnJvciIsInN0YWNrIiwic3VwcG9ydHNGaWxlIiwiZXh0IiwiZXh0bmFtZSIsInRvTG93ZXJDYXNlIiwiZ2V0SW5mbyIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsInRpdGxlIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL2RhdGEvQ3N2Q29udmVydGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBDc3ZDb252ZXJ0ZXIuanNcclxuICogSGFuZGxlcyBjb252ZXJzaW9uIG9mIENTViBmaWxlcyB0byBtYXJrZG93biBmb3JtYXQgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogXHJcbiAqIFRoaXMgY29udmVydGVyOlxyXG4gKiAtIFBhcnNlcyBDU1YgZmlsZXMgdXNpbmcgY3N2LXBhcnNlL3N5bmNcclxuICogLSBFeHRyYWN0cyB0YWJsZSBkYXRhIGFuZCBtZXRhZGF0YVxyXG4gKiAtIEdlbmVyYXRlcyBtYXJrZG93biB0YWJsZXNcclxuICogLSBIYW5kbGVzIGxhcmdlIGZpbGVzIGVmZmljaWVudGx5XHJcbiAqIFxyXG4gKiBSZWxhdGVkIEZpbGVzOlxyXG4gKiAtIEJhc2VTZXJ2aWNlLmpzOiBQYXJlbnQgY2xhc3MgcHJvdmlkaW5nIElQQyBoYW5kbGluZ1xyXG4gKiAtIEZpbGVQcm9jZXNzb3JTZXJ2aWNlLmpzOiBVc2VkIGZvciBmaWxlIG9wZXJhdGlvbnNcclxuICogLSBDb252ZXJzaW9uU2VydmljZS5qczogUmVnaXN0ZXJzIGFuZCB1c2VzIHRoaXMgY29udmVydGVyXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgeyBwYXJzZSB9ID0gcmVxdWlyZSgnY3N2LXBhcnNlL3N5bmMnKTtcclxuY29uc3QgQmFzZVNlcnZpY2UgPSByZXF1aXJlKCcuLi8uLi9CYXNlU2VydmljZScpO1xyXG5cclxuY2xhc3MgQ3N2Q29udmVydGVyIGV4dGVuZHMgQmFzZVNlcnZpY2Uge1xyXG4gICAgY29uc3RydWN0b3IoZmlsZVByb2Nlc3Nvcikge1xyXG4gICAgICAgIHN1cGVyKCk7XHJcbiAgICAgICAgdGhpcy5maWxlUHJvY2Vzc29yID0gZmlsZVByb2Nlc3NvcjtcclxuICAgICAgICB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMgPSBbJy5jc3YnXTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIENTViBjb252ZXJzaW9uXHJcbiAgICAgKi9cclxuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6Y3N2JywgdGhpcy5oYW5kbGVDb252ZXJ0LmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OmNzdjpwcmV2aWV3JywgdGhpcy5oYW5kbGVQcmV2aWV3LmJpbmQodGhpcykpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIENTViBjb252ZXJzaW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb252ZXJzaW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDb252ZXJ0KGV2ZW50LCB7IGZpbGVQYXRoLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQ3N2Q29udmVydGVyXSBDb252ZXJ0aW5nIGZpbGU6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQ3N2Q29udmVydGVyXSBPcHRpb25zOmAsIEpTT04uc3RyaW5naWZ5KG9wdGlvbnMsIG51bGwsIDIpKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFkZCBlcnJvciBoYW5kbGluZyBmb3IgZmlsZSByZWFkaW5nXHJcbiAgICAgICAgICAgIGxldCBjb250ZW50O1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIFJlYWRpbmcgZmlsZSB3aXRoIGVuY29kaW5nOiAke29wdGlvbnMuZW5jb2RpbmcgfHwgJ3V0ZjgnfWApO1xyXG4gICAgICAgICAgICAgICAgY29udGVudCA9IGF3YWl0IHRoaXMuZmlsZVByb2Nlc3Nvci5oYW5kbGVGaWxlUmVhZChudWxsLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgZW5jb2Rpbmc6IG9wdGlvbnMuZW5jb2RpbmcgfHwgJ3V0ZjgnXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQ3N2Q29udmVydGVyXSBGaWxlIHJlYWQgc3VjY2Vzc2Z1bCwgY29udGVudCBsZW5ndGg6ICR7Y29udGVudD8uY29udGVudD8ubGVuZ3RoIHx8IDB9IGJ5dGVzYCk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKHJlYWRFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0NzdkNvbnZlcnRlcl0gRmFpbGVkIHRvIHJlYWQgQ1NWIGZpbGU6ICR7ZmlsZVBhdGh9YCwgcmVhZEVycm9yKTtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHJlYWQgQ1NWIGZpbGU6ICR7cmVhZEVycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIGNvbnRlbnRcclxuICAgICAgICAgICAgaWYgKCFjb250ZW50IHx8ICFjb250ZW50LmNvbnRlbnQgfHwgY29udGVudC5jb250ZW50LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtDc3ZDb252ZXJ0ZXJdIEVtcHR5IG9yIGludmFsaWQgQ1NWIGZpbGU6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NTViBmaWxlIGlzIGVtcHR5IG9yIGNvbnRhaW5zIG5vIHZhbGlkIGNvbnRlbnQnKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIFN0YXJ0aW5nIG1hcmtkb3duIGNvbnZlcnNpb24gZm9yIENTViBjb250ZW50YCk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQ3N2Q29udmVydGVyXSBGaXJzdCAxMDAgY2hhcnMgb2YgY29udGVudDogJHtjb250ZW50LmNvbnRlbnQuc3Vic3RyaW5nKDAsIDEwMCl9Li4uYCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQuY29udGVudCwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSByZXN1bHRcclxuICAgICAgICAgICAgaWYgKCFyZXN1bHQgfHwgcmVzdWx0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtDc3ZDb252ZXJ0ZXJdIENvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudDogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ1NWIGNvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0NzdkNvbnZlcnRlcl0gQ29udmVyc2lvbiBzdWNjZXNzZnVsLCBtYXJrZG93biBsZW5ndGg6ICR7cmVzdWx0Lmxlbmd0aH0gYnl0ZXNgKTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIEZpcnN0IDEwMCBjaGFycyBvZiBtYXJrZG93bjogJHtyZXN1bHQuc3Vic3RyaW5nKDAsIDEwMCl9Li4uYCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBSZXR1cm4gd2l0aCBwcm9wZXIgc3RydWN0dXJlXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0geyBjb250ZW50OiByZXN1bHQgfTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIFJldHVybmluZyByZXNwb25zZSB3aXRoIGNvbnRlbnQgcHJvcGVydHlgKTtcclxuICAgICAgICAgICAgcmV0dXJuIHJlc3BvbnNlO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tDc3ZDb252ZXJ0ZXJdIENvbnZlcnNpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIENTViBwcmV2aWV3IHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBQcmV2aWV3IHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVQcmV2aWV3KGV2ZW50LCB7IGZpbGVQYXRoLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIFJlYWQgZmlyc3QgMTAgbGluZXMgZm9yIHByZXZpZXdcclxuICAgICAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuZmlsZVByb2Nlc3Nvci5oYW5kbGVGaWxlUmVhZChudWxsLCB7XHJcbiAgICAgICAgICAgICAgICBmaWxlUGF0aCxcclxuICAgICAgICAgICAgICAgIGVuY29kaW5nOiBvcHRpb25zLmVuY29kaW5nIHx8ICd1dGY4J1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5jb250ZW50LnNwbGl0KCdcXG4nKS5zbGljZSgwLCAxMCkuam9pbignXFxuJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29udmVydFRvTWFya2Rvd24obGluZXMsIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICBwcmV2aWV3OiB0cnVlXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHsgY29udGVudDogcmVzdWx0IH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0NzdkNvbnZlcnRlcl0gUHJldmlldyBnZW5lcmF0aW9uIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENvbnZlcnQgQ1NWIGNvbnRlbnQgdG8gbWFya2Rvd25cclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb250ZW50IC0gQ1NWIGNvbnRlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQ3N2Q29udmVydGVyXSBjb252ZXJ0VG9NYXJrZG93biBjYWxsZWQgd2l0aCBjb250ZW50IGxlbmd0aDogJHtjb250ZW50Py5sZW5ndGggfHwgMH0gYnl0ZXNgKTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIGNvbnZlcnRUb01hcmtkb3duIG9wdGlvbnM6YCwgSlNPTi5zdHJpbmdpZnkob3B0aW9ucywgbnVsbCwgMikpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgaW5wdXQgY29udGVudFxyXG4gICAgICAgICAgICBpZiAoIWNvbnRlbnQgfHwgY29udGVudC50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ1tDc3ZDb252ZXJ0ZXJdIEVtcHR5IGNvbnRlbnQgcHJvdmlkZWQgZm9yIGNvbnZlcnNpb24nKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiAnPiBObyBkYXRhIGZvdW5kIGluIENTViBmaWxlLic7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIGNvbnRlbnQgaGFzIGF0IGxlYXN0IG9uZSBsaW5lIHdpdGggY29tbWEgb3IgdGFiXHJcbiAgICAgICAgICAgIGNvbnN0IGhhc0RlbGltaXRlcnMgPSBjb250ZW50LmluY2x1ZGVzKCcsJykgfHwgY29udGVudC5pbmNsdWRlcygnXFx0Jyk7XHJcbiAgICAgICAgICAgIGlmICghaGFzRGVsaW1pdGVycykge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdbQ3N2Q29udmVydGVyXSBDb250ZW50IGFwcGVhcnMgdG8gbGFjayBwcm9wZXIgQ1NWIGRlbGltaXRlcnMnKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiAnPiBGaWxlIGRvZXMgbm90IGFwcGVhciB0byBiZSBhIHZhbGlkIENTViAobm8gZGVsaW1pdGVycyBmb3VuZCkuJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRW5oYW5jZWQgcGFyc2luZyB3aXRoIGJldHRlciBlcnJvciBoYW5kbGluZ1xyXG4gICAgICAgICAgICBsZXQgcmVjb3JkcztcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbQ3N2Q29udmVydGVyXSBQYXJzaW5nIENTViB3aXRoIG9wdGlvbnM6YCwge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbnM6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgc2tpcF9lbXB0eV9saW5lczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICB0cmltOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlbGF4X2NvbHVtbl9jb3VudDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAuLi4ob3B0aW9ucy5jc3ZPcHRpb25zIHx8IHt9KVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHJlY29yZHMgPSBwYXJzZShjb250ZW50LCB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBza2lwX2VtcHR5X2xpbmVzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIHRyaW06IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgcmVsYXhfY29sdW1uX2NvdW50OiB0cnVlLCAvLyBIYW5kbGUgaW5jb25zaXN0ZW50IGNvbHVtbiBjb3VudHNcclxuICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLmNzdk9wdGlvbnNcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0NzdkNvbnZlcnRlcl0gQ1NWIHBhcnNpbmcgc3VjY2Vzc2Z1bCwgZm91bmQgJHtyZWNvcmRzPy5sZW5ndGggfHwgMH0gcmVjb3Jkc2ApO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChwYXJzZUVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbQ3N2Q29udmVydGVyXSBDU1YgcGFyc2luZyBmYWlsZWQ6JywgcGFyc2VFcnJvcik7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbQ3N2Q29udmVydGVyXSBGaXJzdCAyMDAgY2hhcmFjdGVycyBvZiBwcm9ibGVtYXRpYyBjb250ZW50OicsIGNvbnRlbnQuc3Vic3RyaW5nKDAsIDIwMCkpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGA+IEVycm9yIHBhcnNpbmcgQ1NWOiAke3BhcnNlRXJyb3IubWVzc2FnZX1cXG5cXG5cXGBcXGBcXGBcXG5GaXJzdCAxMDAgY2hhcmFjdGVycyBvZiBjb250ZW50OlxcbiR7Y29udGVudC5zdWJzdHJpbmcoMCwgMTAwKX0uLi5cXG5cXGBcXGBcXGBgO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBIYW5kbGUgZW1wdHkgcmVjb3Jkc1xyXG4gICAgICAgICAgICBpZiAoIXJlY29yZHMgfHwgcmVjb3Jkcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignW0NzdkNvbnZlcnRlcl0gTm8gcmVjb3JkcyBmb3VuZCBhZnRlciBwYXJzaW5nJyk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gJz4gTm8gZGF0YSBmb3VuZCBpbiBDU1YgZmlsZS4nO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBIYW5kbGUgbWlzc2luZyBoZWFkZXJzXHJcbiAgICAgICAgICAgIGlmICghcmVjb3Jkc1swXSkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdbQ3N2Q29udmVydGVyXSBGaXJzdCByZWNvcmQgaXMgdW5kZWZpbmVkJyk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gJz4gQ1NWIGZpbGUgaGFzIGludmFsaWQgc3RydWN0dXJlLic7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGhlYWRlcnMgPSBPYmplY3Qua2V5cyhyZWNvcmRzWzBdKTtcclxuICAgICAgICAgICAgaWYgKGhlYWRlcnMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ1tDc3ZDb252ZXJ0ZXJdIE5vIGNvbHVtbnMgZm91bmQgaW4gcGFyc2VkIGRhdGEnKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiAnPiBObyBjb2x1bW5zIGZvdW5kIGluIENTViBmaWxlLic7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8gR2V0IHRoZSBvcmlnaW5hbCBmaWxlbmFtZSB3aXRob3V0IGV4dGVuc2lvblxyXG4gICAgICAgICAgICBjb25zdCBmaWxlTmFtZSA9IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBvcHRpb25zLm5hbWUgfHwgJ2Nzdi1kYXRhJztcclxuICAgICAgICAgICAgY29uc3QgZmlsZVRpdGxlID0gZmlsZU5hbWUucmVwbGFjZSgvXFwuW14vLl0rJC8sICcnKTsgLy8gUmVtb3ZlIGZpbGUgZXh0ZW5zaW9uIGlmIHByZXNlbnRcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIFVzaW5nIHRpdGxlIGZvciBjb252ZXJzaW9uOiAke2ZpbGVUaXRsZX0gKGZyb20gJHtmaWxlTmFtZX0pYCk7XHJcblxyXG4gICAgICAgICAgICAvLyBTdG9yZSBvcmlnaW5hbCBmaWxlbmFtZSBpbiBtZXRhZGF0YSBmb3IgbGF0ZXIgcmVmZXJlbmNlXHJcbiAgICAgICAgICAgIG9wdGlvbnMubWV0YWRhdGEgPSBvcHRpb25zLm1ldGFkYXRhIHx8IHt9O1xyXG4gICAgICAgICAgICBvcHRpb25zLm1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUgPSBmaWxlTmFtZTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtDc3ZDb252ZXJ0ZXJdIFN0b3JlZCBvcmlnaW5hbEZpbGVOYW1lIGluIG1ldGFkYXRhOiAke2ZpbGVOYW1lfWApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IGN1cnJlbnQgZGF0ZXRpbWVcclxuICAgICAgICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgICAgICAgICAgY29uc3QgY29udmVydGVkRGF0ZSA9IG5vdy50b0lTT1N0cmluZygpLnNwbGl0KCcuJylbMF0ucmVwbGFjZSgnVCcsICcgJyk7XHJcblxyXG4gICAgICAgICAgICAvLyBCdWlsZCBtYXJrZG93biB3aXRoIFlBTUwgZnJvbnRtYXR0ZXJcclxuICAgICAgICAgICAgbGV0IG1hcmtkb3duID0gW107XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBBZGQgc3RhbmRhcmRpemVkIGZyb250bWF0dGVyXHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJy0tLScpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGB0aXRsZTogJHtmaWxlVGl0bGV9YCk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYGNvbnZlcnRlZDogJHtjb252ZXJ0ZWREYXRlfWApO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCd0eXBlOiBjc3YnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnLS0tJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG5cclxuICAgICAgICAgICAgLy8gQWRkIHRhYmxlIG1ldGFkYXRhIGFzIGEgbm90ZVxyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IENTViBEYXRhJHtvcHRpb25zLnByZXZpZXcgPyAnIChQcmV2aWV3KScgOiAnJ31gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgPiAtIENvbHVtbnM6ICR7aGVhZGVycy5sZW5ndGh9YCk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYD4gLSBSb3dzOiAke3JlY29yZHMubGVuZ3RofWApO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuXHJcbiAgICAgICAgICAgIC8vIEJ1aWxkIHRhYmxlIGhlYWRlclxyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCd8ICcgKyBoZWFkZXJzLmpvaW4oJyB8ICcpICsgJyB8Jyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ3wgJyArIGhlYWRlcnMubWFwKCgpID0+ICctLS0nKS5qb2luKCcgfCAnKSArICcgfCcpO1xyXG5cclxuICAgICAgICAgICAgLy8gQnVpbGQgdGFibGUgcm93cyB3aXRoIGVuaGFuY2VkIGVycm9yIGhhbmRsaW5nXHJcbiAgICAgICAgICAgIHJlY29yZHMuZm9yRWFjaCgocmVjb3JkLCBpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCByb3cgPSBoZWFkZXJzLm1hcChoZWFkZXIgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY2VsbCA9IHJlY29yZFtoZWFkZXJdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gSGFuZGxlIG51bGwvdW5kZWZpbmVkIHZhbHVlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNlbGwgPT09IG51bGwgfHwgY2VsbCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICcnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRXNjYXBlIHBpcGUgY2hhcmFjdGVycyBhbmQgaGFuZGxlIGxpbmUgYnJlYWtzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gY2VsbC50b1N0cmluZygpLnJlcGxhY2UoL1xcfC9nLCAnXFxcXHwnKS5yZXBsYWNlKC9cXG4vZywgJzxicj4nKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoY2VsbEVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtDc3ZDb252ZXJ0ZXJdIEVycm9yIHByb2Nlc3NpbmcgY2VsbCBpbiBjb2x1bW4gXCIke2hlYWRlcn1cIiBhdCByb3cgJHtpbmRleH06YCwgY2VsbEVycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ3wgJyArIHJvdy5qb2luKCcgfCAnKSArICcgfCcpO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAocm93RXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtDc3ZDb252ZXJ0ZXJdIEVycm9yIHByb2Nlc3Npbmcgcm93ICR7aW5kZXh9OmAsIHJvd0Vycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICAvLyBTa2lwIHByb2JsZW1hdGljIHJvd3MgaW5zdGVhZCBvZiBmYWlsaW5nIHRoZSBlbnRpcmUgY29udmVyc2lvblxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0NzdkNvbnZlcnRlcl0gTWFya2Rvd24gZ2VuZXJhdGlvbiBjb21wbGV0ZSwgbGVuZ3RoOiAke3Jlc3VsdC5sZW5ndGh9IGJ5dGVzYCk7XHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0NzdkNvbnZlcnRlcl0gTWFya2Rvd24gY29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbQ3N2Q29udmVydGVyXSBFcnJvciBkZXRhaWxzOicsIGVycm9yLnN0YWNrIHx8IGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgdGhpcyBjb252ZXJ0ZXIgc3VwcG9ydHMgdGhlIGdpdmVuIGZpbGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gZmlsZVxyXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXHJcbiAgICAgKi9cclxuICAgIHN1cHBvcnRzRmlsZShmaWxlUGF0aCkge1xyXG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcclxuICAgICAgICByZXR1cm4gdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLmluY2x1ZGVzKGV4dCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgY29udmVydGVyIGluZm9ybWF0aW9uXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBnZXRJbmZvKCkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIG5hbWU6ICdDU1YgQ29udmVydGVyJyxcclxuICAgICAgICAgICAgZXh0ZW5zaW9uczogdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLFxyXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbnZlcnRzIENTViBmaWxlcyB0byBtYXJrZG93biB0YWJsZXMnLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgICBlbmNvZGluZzogJ0ZpbGUgZW5jb2RpbmcgKGRlZmF1bHQ6IHV0ZjgpJyxcclxuICAgICAgICAgICAgICAgIHRpdGxlOiAnT3B0aW9uYWwgdGFibGUgdGl0bGUnLFxyXG4gICAgICAgICAgICAgICAgY3N2T3B0aW9uczogJ0FkZGl0aW9uYWwgQ1NWIHBhcnNpbmcgb3B0aW9ucydcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQ3N2Q29udmVydGVyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNO0VBQUVDO0FBQU0sQ0FBQyxHQUFHRCxPQUFPLENBQUMsZ0JBQWdCLENBQUM7QUFDM0MsTUFBTUUsV0FBVyxHQUFHRixPQUFPLENBQUMsbUJBQW1CLENBQUM7QUFFaEQsTUFBTUcsWUFBWSxTQUFTRCxXQUFXLENBQUM7RUFDbkNFLFdBQVdBLENBQUNDLGFBQWEsRUFBRTtJQUN2QixLQUFLLENBQUMsQ0FBQztJQUNQLElBQUksQ0FBQ0EsYUFBYSxHQUFHQSxhQUFhO0lBQ2xDLElBQUksQ0FBQ0MsbUJBQW1CLEdBQUcsQ0FBQyxNQUFNLENBQUM7RUFDdkM7O0VBRUE7QUFDSjtBQUNBO0VBQ0lDLGdCQUFnQkEsQ0FBQSxFQUFHO0lBQ2YsSUFBSSxDQUFDQyxlQUFlLENBQUMsYUFBYSxFQUFFLElBQUksQ0FBQ0MsYUFBYSxDQUFDQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDbEUsSUFBSSxDQUFDRixlQUFlLENBQUMscUJBQXFCLEVBQUUsSUFBSSxDQUFDRyxhQUFhLENBQUNELElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztFQUM5RTs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTUQsYUFBYUEsQ0FBQ0csS0FBSyxFQUFFO0lBQUVDLFFBQVE7SUFBRUMsT0FBTyxHQUFHLENBQUM7RUFBRSxDQUFD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