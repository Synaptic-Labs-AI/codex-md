"use strict";

/**
 * XlsxConverter.js
 * Handles conversion of Excel files to markdown format in the Electron main process.
 * 
 * This converter:
 * - Reads Excel files using xlsx package
 * - Supports multiple sheets
 * - Handles cell formatting
 * - Generates markdown tables with metadata
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - FileProcessorService.js: Used for file operations
 * - ConversionService.js: Registers and uses this converter
 */

const path = require('path');
const xlsx = require('xlsx');
const BaseService = require('../../BaseService');
class XlsxConverter extends BaseService {
  constructor(fileProcessor) {
    super();
    this.fileProcessor = fileProcessor;
    this.supportedExtensions = ['.xlsx', '.xls', '.xlsm'];
  }

  /**
   * Set up IPC handlers for Excel conversion
   */
  setupIpcHandlers() {
    this.registerHandler('convert:xlsx', this.handleConvert.bind(this));
    this.registerHandler('convert:xlsx:preview', this.handlePreview.bind(this));
    this.registerHandler('convert:xlsx:info', this.handleGetInfo.bind(this));
  }

  /**
   * Handle Excel conversion request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Conversion request details
   */
  async handleConvert(event, {
    filePath,
    options = {}
  }) {
    try {
      console.log(`[XlsxConverter] Converting file: ${filePath}`);

      // Add error handling for file reading
      let workbook;
      try {
        workbook = xlsx.readFile(filePath, {
          cellDates: true,
          ...options.xlsxOptions
        });
      } catch (readError) {
        console.error(`[XlsxConverter] Failed to read Excel file: ${filePath}`, readError);
        throw new Error(`Failed to read Excel file: ${readError.message}`);
      }

      // Validate workbook structure
      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        console.error(`[XlsxConverter] Invalid workbook structure: ${filePath}`);
        throw new Error('Invalid Excel file structure: No sheets found');
      }
      const result = await this.convertToMarkdown(workbook, {
        ...options,
        includeAllSheets: true
      });
      if (!result || result.trim() === '') {
        console.error(`[XlsxConverter] Conversion produced empty content: ${filePath}`);
        throw new Error('Excel conversion produced empty content');
      }
      return {
        content: result
      };
    } catch (error) {
      console.error('[XlsxConverter] Conversion failed:', error);
      throw error;
    }
  }

  /**
   * Handle Excel preview request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Preview request details
   */
  async handlePreview(event, {
    filePath,
    options = {}
  }) {
    try {
      const workbook = xlsx.readFile(filePath, {
        cellDates: true,
        ...options.xlsxOptions
      });

      // Convert only the first sheet for preview
      const result = await this.convertToMarkdown(workbook, {
        ...options,
        preview: true,
        maxRows: 10,
        includeAllSheets: false
      });
      return {
        content: result
      };
    } catch (error) {
      console.error('[XlsxConverter] Preview generation failed:', error);
      throw error;
    }
  }

  /**
   * Handle Excel file info request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Info request details
   */
  async handleGetInfo(event, {
    filePath
  }) {
    try {
      const workbook = xlsx.readFile(filePath);
      return {
        sheets: workbook.SheetNames,
        properties: workbook.Props || {},
        activeSheet: workbook.Workbook?.Sheets?.[0]?.name || workbook.SheetNames[0]
      };
    } catch (error) {
      console.error('[XlsxConverter] Info retrieval failed:', error);
      throw error;
    }
  }

  /**
   * Convert Excel workbook to markdown
   * @param {Object} workbook - XLSX workbook object
   * @param {Object} options - Conversion options
   * @returns {Promise<string>} Markdown content
   */
  async convertToMarkdown(workbook, options = {}) {
    try {
      console.log(`[XlsxConverter] convertToMarkdown called with options:`, JSON.stringify(options, null, 2));

      // Validate workbook structure
      if (!workbook) {
        console.error('[XlsxConverter] Invalid workbook: workbook is null or undefined');
        return '> Error: Invalid Excel workbook structure.';
      }
      if (!workbook.SheetNames || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
        console.error('[XlsxConverter] Invalid workbook: no sheets found', {
          hasSheetNames: !!workbook.SheetNames,
          isArray: Array.isArray(workbook.SheetNames),
          length: workbook.SheetNames ? workbook.SheetNames.length : 0
        });
        return '> Error: No sheets found in Excel workbook.';
      }

      // Get the original filename without extension
      const fileName = options.originalFileName || options.name || 'excel-data';
      const fileTitle = fileName.replace(/\.[^/.]+$/, ''); // Remove file extension if present
      console.log(`[XlsxConverter] Using title for conversion: ${fileTitle} (from ${fileName})`);

      // Store original filename in metadata for later reference
      options.metadata = options.metadata || {};
      options.metadata.originalFileName = fileName;
      console.log(`[XlsxConverter] Stored originalFileName in metadata: ${fileName}`);

      // Get current datetime
      const now = new Date();
      const convertedDate = now.toISOString().split('.')[0].replace('T', ' ');
      const markdown = [];

      // Add standardized frontmatter
      markdown.push('---');
      markdown.push(`title: ${fileTitle}`);
      markdown.push(`converted: ${convertedDate}`);
      markdown.push('type: xlsx');
      markdown.push('---');
      markdown.push('');

      // Safely determine which sheets to process
      let sheets;
      if (options.includeAllSheets) {
        sheets = workbook.SheetNames;
        console.log(`[XlsxConverter] Processing all ${sheets.length} sheets`);
      } else {
        const defaultSheet = workbook.SheetNames[0];
        sheets = [options.sheet || defaultSheet];
        console.log(`[XlsxConverter] Processing single sheet: ${sheets[0]}`);
      }

      // Add document properties as notes
      if (workbook.Props) {
        markdown.push('> Excel Document Properties');
        if (workbook.Props.Title) markdown.push(`> - Title: ${workbook.Props.Title}`);
        if (workbook.Props.Author) markdown.push(`> - Author: ${workbook.Props.Author}`);
        if (workbook.Props.CreatedDate) markdown.push(`> - Created: ${workbook.Props.CreatedDate}`);
        markdown.push('');
      }

      // Process each sheet
      for (const sheetName of sheets) {
        console.log(`[XlsxConverter] Processing sheet: ${sheetName}`);

        // Validate sheet exists
        if (!workbook.Sheets || !workbook.Sheets[sheetName]) {
          console.error(`[XlsxConverter] Sheet not found: ${sheetName}`);
          markdown.push(`## ${sheetName}`);
          markdown.push('> Error: Sheet data not found.\n');
          continue;
        }
        const sheet = workbook.Sheets[sheetName];

        // Safely convert sheet to JSON with error handling
        let data;
        try {
          data = xlsx.utils.sheet_to_json(sheet, {
            header: 1
          });
          console.log(`[XlsxConverter] Converted sheet to JSON, rows: ${data.length}`);
        } catch (sheetError) {
          console.error(`[XlsxConverter] Error converting sheet to JSON: ${sheetName}`, sheetError);
          markdown.push(`## ${sheetName}`);
          markdown.push(`> Error converting sheet: ${sheetError.message}\n`);
          continue;
        }
        if (!data || data.length === 0) {
          console.log(`[XlsxConverter] No data found in sheet: ${sheetName}`);
          markdown.push(`## ${sheetName}`);
          markdown.push('> No data found in this sheet.\n');
          continue;
        }

        // Add sheet title
        markdown.push(`## ${sheetName}`);

        // Add sheet metadata
        const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
        markdown.push(`> Excel Sheet${options.preview ? ' (Preview)' : ''}`);
        markdown.push(`> - Columns: ${range.e.c - range.s.c + 1}`);
        markdown.push(`> - Rows: ${range.e.r - range.s.r + 1}`);
        markdown.push('');

        // Check if we have data and headers
        if (!data[0] || !Array.isArray(data[0])) {
          console.warn(`[XlsxConverter] Sheet ${sheetName} has no headers or invalid data structure`);
          markdown.push('> No valid data structure found in this sheet.\n');
          continue;
        }

        // Get headers (first row) with additional logging
        console.log(`[XlsxConverter] First row data:`, JSON.stringify(data[0]));
        const headers = data[0].map(h => (h || '').toString());

        // Build table header
        markdown.push('| ' + headers.map(h => h || ' ').join(' | ') + ' |');
        markdown.push('| ' + headers.map(() => '---').join(' | ') + ' |');

        // Build table rows
        const maxRows = options.maxRows || data.length;
        for (let i = 1; i < Math.min(data.length, maxRows + 1); i++) {
          const row = data[i];
          if (!row) {
            console.debug(`[XlsxConverter] Empty row at index ${i} in sheet ${sheetName}`);
            continue;
          }
          // Add additional error handling for row processing
          try {
            const formattedRow = headers.map((_, index) => {
              try {
                const cell = row[index];
                return this.formatCell(cell);
              } catch (cellError) {
                console.warn(`[XlsxConverter] Error formatting cell at index ${index}:`, cellError);
                return '';
              }
            });
            markdown.push('| ' + formattedRow.join(' | ') + ' |');
          } catch (rowError) {
            console.error(`[XlsxConverter] Error processing row at index ${i}:`, rowError);
            // Skip problematic rows instead of failing the entire conversion
          }
        }
        markdown.push(''); // Add space between sheets
      }
      const result = markdown.join('\n');
      console.log(`[XlsxConverter] Markdown generation complete, length: ${result.length} bytes`);
      return result;
    } catch (error) {
      console.error('[XlsxConverter] Markdown conversion failed:', error);
      console.error('[XlsxConverter] Error details:', error.stack || error);
      // Return a meaningful error message instead of throwing
      return `> Error converting Excel file: ${error.message}`;
    }
  }

  /**
   * Format cell value for markdown
   * @param {*} value - Cell value
   * @returns {string} Formatted cell value
   */
  formatCell(value) {
    if (value === null || value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return value.toISOString().split('T')[0];
    }
    try {
      const str = value.toString();
      return str.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
    } catch (error) {
      console.error('[XlsxConverter] Error formatting cell:', error, 'Value type:', typeof value);
      return '';
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
      name: 'Excel Converter',
      extensions: this.supportedExtensions,
      description: 'Converts Excel files to markdown tables',
      options: {
        sheet: 'Specific sheet to convert',
        includeAllSheets: 'Convert all sheets (default: true)',
        maxRows: 'Maximum rows to convert per sheet',
        title: 'Optional document title',
        xlsxOptions: 'Additional XLSX parsing options'
      }
    };
  }
}
module.exports = XlsxConverter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsInhsc3giLCJCYXNlU2VydmljZSIsIlhsc3hDb252ZXJ0ZXIiLCJjb25zdHJ1Y3RvciIsImZpbGVQcm9jZXNzb3IiLCJzdXBwb3J0ZWRFeHRlbnNpb25zIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUNvbnZlcnQiLCJiaW5kIiwiaGFuZGxlUHJldmlldyIsImhhbmRsZUdldEluZm8iLCJldmVudCIsImZpbGVQYXRoIiwib3B0aW9ucyIsImNvbnNvbGUiLCJsb2ciLCJ3b3JrYm9vayIsInJlYWRGaWxlIiwiY2VsbERhdGVzIiwieGxzeE9wdGlvbnMiLCJyZWFkRXJyb3IiLCJlcnJvciIsIkVycm9yIiwibWVzc2FnZSIsIlNoZWV0TmFtZXMiLCJsZW5ndGgiLCJyZXN1bHQiLCJjb252ZXJ0VG9NYXJrZG93biIsImluY2x1ZGVBbGxTaGVldHMiLCJ0cmltIiwiY29udGVudCIsInByZXZpZXciLCJtYXhSb3dzIiwic2hlZXRzIiwicHJvcGVydGllcyIsIlByb3BzIiwiYWN0aXZlU2hlZXQiLCJXb3JrYm9vayIsIlNoZWV0cyIsIm5hbWUiLCJKU09OIiwic3RyaW5naWZ5IiwiQXJyYXkiLCJpc0FycmF5IiwiaGFzU2hlZXROYW1lcyIsImZpbGVOYW1lIiwib3JpZ2luYWxGaWxlTmFtZSIsImZpbGVUaXRsZSIsInJlcGxhY2UiLCJtZXRhZGF0YSIsIm5vdyIsIkRhdGUiLCJjb252ZXJ0ZWREYXRlIiwidG9JU09TdHJpbmciLCJzcGxpdCIsIm1hcmtkb3duIiwicHVzaCIsImRlZmF1bHRTaGVldCIsInNoZWV0IiwiVGl0bGUiLCJBdXRob3IiLCJDcmVhdGVkRGF0ZSIsInNoZWV0TmFtZSIsImRhdGEiLCJ1dGlscyIsInNoZWV0X3RvX2pzb24iLCJoZWFkZXIiLCJzaGVldEVycm9yIiwicmFuZ2UiLCJkZWNvZGVfcmFuZ2UiLCJlIiwiYyIsInMiLCJyIiwid2FybiIsImhlYWRlcnMiLCJtYXAiLCJoIiwidG9TdHJpbmciLCJqb2luIiwiaSIsIk1hdGgiLCJtaW4iLCJyb3ciLCJkZWJ1ZyIsImZvcm1hdHRlZFJvdyIsIl8iLCJpbmRleCIsImNlbGwiLCJmb3JtYXRDZWxsIiwiY2VsbEVycm9yIiwicm93RXJyb3IiLCJzdGFjayIsInZhbHVlIiwidW5kZWZpbmVkIiwic3RyIiwic3VwcG9ydHNGaWxlIiwiZXh0IiwiZXh0bmFtZSIsInRvTG93ZXJDYXNlIiwiaW5jbHVkZXMiLCJnZXRJbmZvIiwiZXh0ZW5zaW9ucyIsImRlc2NyaXB0aW9uIiwidGl0bGUiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vZGF0YS9YbHN4Q29udmVydGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBYbHN4Q29udmVydGVyLmpzXHJcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiBFeGNlbCBmaWxlcyB0byBtYXJrZG93biBmb3JtYXQgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogXHJcbiAqIFRoaXMgY29udmVydGVyOlxyXG4gKiAtIFJlYWRzIEV4Y2VsIGZpbGVzIHVzaW5nIHhsc3ggcGFja2FnZVxyXG4gKiAtIFN1cHBvcnRzIG11bHRpcGxlIHNoZWV0c1xyXG4gKiAtIEhhbmRsZXMgY2VsbCBmb3JtYXR0aW5nXHJcbiAqIC0gR2VuZXJhdGVzIG1hcmtkb3duIHRhYmxlcyB3aXRoIG1ldGFkYXRhXHJcbiAqIFxyXG4gKiBSZWxhdGVkIEZpbGVzOlxyXG4gKiAtIEJhc2VTZXJ2aWNlLmpzOiBQYXJlbnQgY2xhc3MgcHJvdmlkaW5nIElQQyBoYW5kbGluZ1xyXG4gKiAtIEZpbGVQcm9jZXNzb3JTZXJ2aWNlLmpzOiBVc2VkIGZvciBmaWxlIG9wZXJhdGlvbnNcclxuICogLSBDb252ZXJzaW9uU2VydmljZS5qczogUmVnaXN0ZXJzIGFuZCB1c2VzIHRoaXMgY29udmVydGVyXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgeGxzeCA9IHJlcXVpcmUoJ3hsc3gnKTtcclxuY29uc3QgQmFzZVNlcnZpY2UgPSByZXF1aXJlKCcuLi8uLi9CYXNlU2VydmljZScpO1xyXG5cclxuY2xhc3MgWGxzeENvbnZlcnRlciBleHRlbmRzIEJhc2VTZXJ2aWNlIHtcclxuICAgIGNvbnN0cnVjdG9yKGZpbGVQcm9jZXNzb3IpIHtcclxuICAgICAgICBzdXBlcigpO1xyXG4gICAgICAgIHRoaXMuZmlsZVByb2Nlc3NvciA9IGZpbGVQcm9jZXNzb3I7XHJcbiAgICAgICAgdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zID0gWycueGxzeCcsICcueGxzJywgJy54bHNtJ107XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTZXQgdXAgSVBDIGhhbmRsZXJzIGZvciBFeGNlbCBjb252ZXJzaW9uXHJcbiAgICAgKi9cclxuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6eGxzeCcsIHRoaXMuaGFuZGxlQ29udmVydC5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDp4bHN4OnByZXZpZXcnLCB0aGlzLmhhbmRsZVByZXZpZXcuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6eGxzeDppbmZvJywgdGhpcy5oYW5kbGVHZXRJbmZvLmJpbmQodGhpcykpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIEV4Y2VsIGNvbnZlcnNpb24gcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIENvbnZlcnNpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUNvbnZlcnQoZXZlbnQsIHsgZmlsZVBhdGgsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4Q29udmVydGVyXSBDb252ZXJ0aW5nIGZpbGU6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBBZGQgZXJyb3IgaGFuZGxpbmcgZm9yIGZpbGUgcmVhZGluZ1xyXG4gICAgICAgICAgICBsZXQgd29ya2Jvb2s7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICB3b3JrYm9vayA9IHhsc3gucmVhZEZpbGUoZmlsZVBhdGgsIHtcclxuICAgICAgICAgICAgICAgICAgICBjZWxsRGF0ZXM6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgLi4ub3B0aW9ucy54bHN4T3B0aW9uc1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKHJlYWRFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1hsc3hDb252ZXJ0ZXJdIEZhaWxlZCB0byByZWFkIEV4Y2VsIGZpbGU6ICR7ZmlsZVBhdGh9YCwgcmVhZEVycm9yKTtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHJlYWQgRXhjZWwgZmlsZTogJHtyZWFkRXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgd29ya2Jvb2sgc3RydWN0dXJlXHJcbiAgICAgICAgICAgIGlmICghd29ya2Jvb2sgfHwgIXdvcmtib29rLlNoZWV0TmFtZXMgfHwgd29ya2Jvb2suU2hlZXROYW1lcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtYbHN4Q29udmVydGVyXSBJbnZhbGlkIHdvcmtib29rIHN0cnVjdHVyZTogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBFeGNlbCBmaWxlIHN0cnVjdHVyZTogTm8gc2hlZXRzIGZvdW5kJyk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29udmVydFRvTWFya2Rvd24od29ya2Jvb2ssIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlQWxsU2hlZXRzOiB0cnVlXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgaWYgKCFyZXN1bHQgfHwgcmVzdWx0LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtYbHN4Q29udmVydGVyXSBDb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQ6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0V4Y2VsIGNvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudCcpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICByZXR1cm4geyBjb250ZW50OiByZXN1bHQgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbWGxzeENvbnZlcnRlcl0gQ29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgRXhjZWwgcHJldmlldyByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gUHJldmlldyByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlUHJldmlldyhldmVudCwgeyBmaWxlUGF0aCwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCB3b3JrYm9vayA9IHhsc3gucmVhZEZpbGUoZmlsZVBhdGgsIHtcclxuICAgICAgICAgICAgICAgIGNlbGxEYXRlczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMueGxzeE9wdGlvbnNcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBDb252ZXJ0IG9ubHkgdGhlIGZpcnN0IHNoZWV0IGZvciBwcmV2aWV3XHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29udmVydFRvTWFya2Rvd24od29ya2Jvb2ssIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICBwcmV2aWV3OiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgbWF4Um93czogMTAsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlQWxsU2hlZXRzOiBmYWxzZVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnRlbnQ6IHJlc3VsdCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBQcmV2aWV3IGdlbmVyYXRpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIEV4Y2VsIGZpbGUgaW5mbyByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gSW5mbyByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlR2V0SW5mbyhldmVudCwgeyBmaWxlUGF0aCB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3Qgd29ya2Jvb2sgPSB4bHN4LnJlYWRGaWxlKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIHNoZWV0czogd29ya2Jvb2suU2hlZXROYW1lcyxcclxuICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IHdvcmtib29rLlByb3BzIHx8IHt9LFxyXG4gICAgICAgICAgICAgICAgYWN0aXZlU2hlZXQ6IHdvcmtib29rLldvcmtib29rPy5TaGVldHM/LlswXT8ubmFtZSB8fCB3b3JrYm9vay5TaGVldE5hbWVzWzBdXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1hsc3hDb252ZXJ0ZXJdIEluZm8gcmV0cmlldmFsIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENvbnZlcnQgRXhjZWwgd29ya2Jvb2sgdG8gbWFya2Rvd25cclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSB3b3JrYm9vayAtIFhMU1ggd29ya2Jvb2sgb2JqZWN0XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gTWFya2Rvd24gY29udGVudFxyXG4gICAgICovXHJcbiAgICBhc3luYyBjb252ZXJ0VG9NYXJrZG93bih3b3JrYm9vaywgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4Q29udmVydGVyXSBjb252ZXJ0VG9NYXJrZG93biBjYWxsZWQgd2l0aCBvcHRpb25zOmAsIEpTT04uc3RyaW5naWZ5KG9wdGlvbnMsIG51bGwsIDIpKTtcclxuXHJcbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIHdvcmtib29rIHN0cnVjdHVyZVxyXG4gICAgICAgICAgICBpZiAoIXdvcmtib29rKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbWGxzeENvbnZlcnRlcl0gSW52YWxpZCB3b3JrYm9vazogd29ya2Jvb2sgaXMgbnVsbCBvciB1bmRlZmluZWQnKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiAnPiBFcnJvcjogSW52YWxpZCBFeGNlbCB3b3JrYm9vayBzdHJ1Y3R1cmUuJztcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKCF3b3JrYm9vay5TaGVldE5hbWVzIHx8ICFBcnJheS5pc0FycmF5KHdvcmtib29rLlNoZWV0TmFtZXMpIHx8IHdvcmtib29rLlNoZWV0TmFtZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbWGxzeENvbnZlcnRlcl0gSW52YWxpZCB3b3JrYm9vazogbm8gc2hlZXRzIGZvdW5kJywge1xyXG4gICAgICAgICAgICAgICAgICAgIGhhc1NoZWV0TmFtZXM6ICEhd29ya2Jvb2suU2hlZXROYW1lcyxcclxuICAgICAgICAgICAgICAgICAgICBpc0FycmF5OiBBcnJheS5pc0FycmF5KHdvcmtib29rLlNoZWV0TmFtZXMpLFxyXG4gICAgICAgICAgICAgICAgICAgIGxlbmd0aDogd29ya2Jvb2suU2hlZXROYW1lcyA/IHdvcmtib29rLlNoZWV0TmFtZXMubGVuZ3RoIDogMFxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gJz4gRXJyb3I6IE5vIHNoZWV0cyBmb3VuZCBpbiBFeGNlbCB3b3JrYm9vay4nO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBHZXQgdGhlIG9yaWdpbmFsIGZpbGVuYW1lIHdpdGhvdXQgZXh0ZW5zaW9uXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IG9wdGlvbnMubmFtZSB8fCAnZXhjZWwtZGF0YSc7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVUaXRsZSA9IGZpbGVOYW1lLnJlcGxhY2UoL1xcLlteLy5dKyQvLCAnJyk7IC8vIFJlbW92ZSBmaWxlIGV4dGVuc2lvbiBpZiBwcmVzZW50XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbWGxzeENvbnZlcnRlcl0gVXNpbmcgdGl0bGUgZm9yIGNvbnZlcnNpb246ICR7ZmlsZVRpdGxlfSAoZnJvbSAke2ZpbGVOYW1lfSlgKTtcclxuXHJcbiAgICAgICAgICAgIC8vIFN0b3JlIG9yaWdpbmFsIGZpbGVuYW1lIGluIG1ldGFkYXRhIGZvciBsYXRlciByZWZlcmVuY2VcclxuICAgICAgICAgICAgb3B0aW9ucy5tZXRhZGF0YSA9IG9wdGlvbnMubWV0YWRhdGEgfHwge307XHJcbiAgICAgICAgICAgIG9wdGlvbnMubWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSA9IGZpbGVOYW1lO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1hsc3hDb252ZXJ0ZXJdIFN0b3JlZCBvcmlnaW5hbEZpbGVOYW1lIGluIG1ldGFkYXRhOiAke2ZpbGVOYW1lfWApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IGN1cnJlbnQgZGF0ZXRpbWVcclxuICAgICAgICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgICAgICAgICAgY29uc3QgY29udmVydGVkRGF0ZSA9IG5vdy50b0lTT1N0cmluZygpLnNwbGl0KCcuJylbMF0ucmVwbGFjZSgnVCcsICcgJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBtYXJrZG93biA9IFtdO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIHN0YW5kYXJkaXplZCBmcm9udG1hdHRlclxyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCctLS0nKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgdGl0bGU6ICR7ZmlsZVRpdGxlfWApO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGBjb252ZXJ0ZWQ6ICR7Y29udmVydGVkRGF0ZX1gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgndHlwZTogeGxzeCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCctLS0nKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBTYWZlbHkgZGV0ZXJtaW5lIHdoaWNoIHNoZWV0cyB0byBwcm9jZXNzXHJcbiAgICAgICAgICAgIGxldCBzaGVldHM7XHJcbiAgICAgICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGVBbGxTaGVldHMpIHtcclxuICAgICAgICAgICAgICAgIHNoZWV0cyA9IHdvcmtib29rLlNoZWV0TmFtZXM7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW1hsc3hDb252ZXJ0ZXJdIFByb2Nlc3NpbmcgYWxsICR7c2hlZXRzLmxlbmd0aH0gc2hlZXRzYCk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0U2hlZXQgPSB3b3JrYm9vay5TaGVldE5hbWVzWzBdO1xyXG4gICAgICAgICAgICAgICAgc2hlZXRzID0gW29wdGlvbnMuc2hlZXQgfHwgZGVmYXVsdFNoZWV0XTtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbWGxzeENvbnZlcnRlcl0gUHJvY2Vzc2luZyBzaW5nbGUgc2hlZXQ6ICR7c2hlZXRzWzBdfWApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBBZGQgZG9jdW1lbnQgcHJvcGVydGllcyBhcyBub3Rlc1xyXG4gICAgICAgICAgICBpZiAod29ya2Jvb2suUHJvcHMpIHtcclxuICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJz4gRXhjZWwgRG9jdW1lbnQgUHJvcGVydGllcycpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHdvcmtib29rLlByb3BzLlRpdGxlKSBtYXJrZG93bi5wdXNoKGA+IC0gVGl0bGU6ICR7d29ya2Jvb2suUHJvcHMuVGl0bGV9YCk7XHJcbiAgICAgICAgICAgICAgICBpZiAod29ya2Jvb2suUHJvcHMuQXV0aG9yKSBtYXJrZG93bi5wdXNoKGA+IC0gQXV0aG9yOiAke3dvcmtib29rLlByb3BzLkF1dGhvcn1gKTtcclxuICAgICAgICAgICAgICAgIGlmICh3b3JrYm9vay5Qcm9wcy5DcmVhdGVkRGF0ZSkgbWFya2Rvd24ucHVzaChgPiAtIENyZWF0ZWQ6ICR7d29ya2Jvb2suUHJvcHMuQ3JlYXRlZERhdGV9YCk7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gUHJvY2VzcyBlYWNoIHNoZWV0XHJcbiAgICAgICAgICAgIGZvciAoY29uc3Qgc2hlZXROYW1lIG9mIHNoZWV0cykge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4Q29udmVydGVyXSBQcm9jZXNzaW5nIHNoZWV0OiAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gVmFsaWRhdGUgc2hlZXQgZXhpc3RzXHJcbiAgICAgICAgICAgICAgICBpZiAoIXdvcmtib29rLlNoZWV0cyB8fCAhd29ya2Jvb2suU2hlZXRzW3NoZWV0TmFtZV0pIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeENvbnZlcnRlcl0gU2hlZXQgbm90IGZvdW5kOiAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjIyAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCc+IEVycm9yOiBTaGVldCBkYXRhIG5vdCBmb3VuZC5cXG4nKTtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2hlZXQgPSB3b3JrYm9vay5TaGVldHNbc2hlZXROYW1lXTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gU2FmZWx5IGNvbnZlcnQgc2hlZXQgdG8gSlNPTiB3aXRoIGVycm9yIGhhbmRsaW5nXHJcbiAgICAgICAgICAgICAgICBsZXQgZGF0YTtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YSA9IHhsc3gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4Q29udmVydGVyXSBDb252ZXJ0ZWQgc2hlZXQgdG8gSlNPTiwgcm93czogJHtkYXRhLmxlbmd0aH1gKTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKHNoZWV0RXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeENvbnZlcnRlcl0gRXJyb3IgY29udmVydGluZyBzaGVldCB0byBKU09OOiAke3NoZWV0TmFtZX1gLCBzaGVldEVycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjIyAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IEVycm9yIGNvbnZlcnRpbmcgc2hlZXQ6ICR7c2hlZXRFcnJvci5tZXNzYWdlfVxcbmApO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmICghZGF0YSB8fCBkYXRhLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbWGxzeENvbnZlcnRlcl0gTm8gZGF0YSBmb3VuZCBpbiBzaGVldDogJHtzaGVldE5hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIyMgJHtzaGVldE5hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnPiBObyBkYXRhIGZvdW5kIGluIHRoaXMgc2hlZXQuXFxuJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQWRkIHNoZWV0IHRpdGxlXHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjIyAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQWRkIHNoZWV0IG1ldGFkYXRhXHJcbiAgICAgICAgICAgICAgICBjb25zdCByYW5nZSA9IHhsc3gudXRpbHMuZGVjb2RlX3JhbmdlKHNoZWV0WychcmVmJ10gfHwgJ0ExJyk7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IEV4Y2VsIFNoZWV0JHtvcHRpb25zLnByZXZpZXcgPyAnIChQcmV2aWV3KScgOiAnJ31gKTtcclxuICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYD4gLSBDb2x1bW5zOiAke3JhbmdlLmUuYyAtIHJhbmdlLnMuYyArIDF9YCk7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IC0gUm93czogJHtyYW5nZS5lLnIgLSByYW5nZS5zLnIgKyAxfWApO1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgd2UgaGF2ZSBkYXRhIGFuZCBoZWFkZXJzXHJcbiAgICAgICAgICAgICAgICBpZiAoIWRhdGFbMF0gfHwgIUFycmF5LmlzQXJyYXkoZGF0YVswXSkpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtYbHN4Q29udmVydGVyXSBTaGVldCAke3NoZWV0TmFtZX0gaGFzIG5vIGhlYWRlcnMgb3IgaW52YWxpZCBkYXRhIHN0cnVjdHVyZWApO1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJz4gTm8gdmFsaWQgZGF0YSBzdHJ1Y3R1cmUgZm91bmQgaW4gdGhpcyBzaGVldC5cXG4nKTtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAvLyBHZXQgaGVhZGVycyAoZmlyc3Qgcm93KSB3aXRoIGFkZGl0aW9uYWwgbG9nZ2luZ1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4Q29udmVydGVyXSBGaXJzdCByb3cgZGF0YTpgLCBKU09OLnN0cmluZ2lmeShkYXRhWzBdKSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBoZWFkZXJzID0gZGF0YVswXS5tYXAoaCA9PiAoaCB8fCAnJykudG9TdHJpbmcoKSk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQnVpbGQgdGFibGUgaGVhZGVyXHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCd8ICcgKyBoZWFkZXJzLm1hcChoID0+IGggfHwgJyAnKS5qb2luKCcgfCAnKSArICcgfCcpO1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnfCAnICsgaGVhZGVycy5tYXAoKCkgPT4gJy0tLScpLmpvaW4oJyB8ICcpICsgJyB8Jyk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQnVpbGQgdGFibGUgcm93c1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbWF4Um93cyA9IG9wdGlvbnMubWF4Um93cyB8fCBkYXRhLmxlbmd0aDtcclxuICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAxOyBpIDwgTWF0aC5taW4oZGF0YS5sZW5ndGgsIG1heFJvd3MgKyAxKTsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgcm93ID0gZGF0YVtpXTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXJvdykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmRlYnVnKGBbWGxzeENvbnZlcnRlcl0gRW1wdHkgcm93IGF0IGluZGV4ICR7aX0gaW4gc2hlZXQgJHtzaGVldE5hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAvLyBBZGQgYWRkaXRpb25hbCBlcnJvciBoYW5kbGluZyBmb3Igcm93IHByb2Nlc3NpbmdcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmb3JtYXR0ZWRSb3cgPSBoZWFkZXJzLm1hcCgoXywgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY2VsbCA9IHJvd1tpbmRleF07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZm9ybWF0Q2VsbChjZWxsKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGNlbGxFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgW1hsc3hDb252ZXJ0ZXJdIEVycm9yIGZvcm1hdHRpbmcgY2VsbCBhdCBpbmRleCAke2luZGV4fTpgLCBjZWxsRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ3wgJyArIGZvcm1hdHRlZFJvdy5qb2luKCcgfCAnKSArICcgfCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKHJvd0Vycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtYbHN4Q29udmVydGVyXSBFcnJvciBwcm9jZXNzaW5nIHJvdyBhdCBpbmRleCAke2l9OmAsIHJvd0Vycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gU2tpcCBwcm9ibGVtYXRpYyByb3dzIGluc3RlYWQgb2YgZmFpbGluZyB0aGUgZW50aXJlIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTsgLy8gQWRkIHNwYWNlIGJldHdlZW4gc2hlZXRzXHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1hsc3hDb252ZXJ0ZXJdIE1hcmtkb3duIGdlbmVyYXRpb24gY29tcGxldGUsIGxlbmd0aDogJHtyZXN1bHQubGVuZ3RofSBieXRlc2ApO1xyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBNYXJrZG93biBjb252ZXJzaW9uIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBFcnJvciBkZXRhaWxzOicsIGVycm9yLnN0YWNrIHx8IGVycm9yKTtcclxuICAgICAgICAgICAgLy8gUmV0dXJuIGEgbWVhbmluZ2Z1bCBlcnJvciBtZXNzYWdlIGluc3RlYWQgb2YgdGhyb3dpbmdcclxuICAgICAgICAgICAgcmV0dXJuIGA+IEVycm9yIGNvbnZlcnRpbmcgRXhjZWwgZmlsZTogJHtlcnJvci5tZXNzYWdlfWA7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRm9ybWF0IGNlbGwgdmFsdWUgZm9yIG1hcmtkb3duXHJcbiAgICAgKiBAcGFyYW0geyp9IHZhbHVlIC0gQ2VsbCB2YWx1ZVxyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gRm9ybWF0dGVkIGNlbGwgdmFsdWVcclxuICAgICAqL1xyXG4gICAgZm9ybWF0Q2VsbCh2YWx1ZSkge1xyXG4gICAgICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAnJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0ciA9IHZhbHVlLnRvU3RyaW5nKCk7XHJcbiAgICAgICAgICAgIHJldHVybiBzdHIucmVwbGFjZSgvXFx8L2csICdcXFxcfCcpLnJlcGxhY2UoL1xcbi9nLCAnPGJyPicpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBFcnJvciBmb3JtYXR0aW5nIGNlbGw6JywgZXJyb3IsICdWYWx1ZSB0eXBlOicsIHR5cGVvZiB2YWx1ZSk7XHJcbiAgICAgICAgICAgIHJldHVybiAnJztcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVjayBpZiB0aGlzIGNvbnZlcnRlciBzdXBwb3J0cyB0aGUgZ2l2ZW4gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBmaWxlXHJcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBzdXBwb3J0ZWRcclxuICAgICAqL1xyXG4gICAgc3VwcG9ydHNGaWxlKGZpbGVQYXRoKSB7XHJcbiAgICAgICAgY29uc3QgZXh0ID0gcGF0aC5leHRuYW1lKGZpbGVQYXRoKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgIHJldHVybiB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMuaW5jbHVkZXMoZXh0KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IENvbnZlcnRlciBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGdldEluZm8oKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgbmFtZTogJ0V4Y2VsIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbnM6IHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyxcclxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb252ZXJ0cyBFeGNlbCBmaWxlcyB0byBtYXJrZG93biB0YWJsZXMnLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgICBzaGVldDogJ1NwZWNpZmljIHNoZWV0IHRvIGNvbnZlcnQnLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZUFsbFNoZWV0czogJ0NvbnZlcnQgYWxsIHNoZWV0cyAoZGVmYXVsdDogdHJ1ZSknLFxyXG4gICAgICAgICAgICAgICAgbWF4Um93czogJ01heGltdW0gcm93cyB0byBjb252ZXJ0IHBlciBzaGVldCcsXHJcbiAgICAgICAgICAgICAgICB0aXRsZTogJ09wdGlvbmFsIGRvY3VtZW50IHRpdGxlJyxcclxuICAgICAgICAgICAgICAgIHhsc3hPcHRpb25zOiAnQWRkaXRpb25hbCBYTFNYIHBhcnNpbmcgb3B0aW9ucydcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gWGxzeENvbnZlcnRlcjtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTUMsSUFBSSxHQUFHRCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1FLFdBQVcsR0FBR0YsT0FBTyxDQUFDLG1CQUFtQixDQUFDO0FBRWhELE1BQU1HLGFBQWEsU0FBU0QsV0FBVyxDQUFDO0VBQ3BDRSxXQUFXQSxDQUFDQyxhQUFhLEVBQUU7SUFDdkIsS0FBSyxDQUFDLENBQUM7SUFDUCxJQUFJLENBQUNBLGFBQWEsR0FBR0EsYUFBYTtJQUNsQyxJQUFJLENBQUNDLG1CQUFtQixHQUFHLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUM7RUFDekQ7O0VBRUE7QUFDSjtBQUNBO0VBQ0lDLGdCQUFnQkEsQ0FBQSxFQUFHO0lBQ2YsSUFBSSxDQUFDQyxlQUFlLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQ0MsYUFBYSxDQUFDQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDbkUsSUFBSSxDQUFDRixlQUFlLENBQUMsc0JBQXNCLEVBQUUsSUFBSSxDQUFDRyxhQUFhLENBQUNELElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMzRSxJQUFJLENBQUNGLGVBQWUsQ0FBQyxt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