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
      const markdown = [];

      // Create standardized frontmatter using metadata utility
      const {
        createStandardFrontmatter
      } = require('../../../converters/utils/metadata');
      const frontmatter = createStandardFrontmatter({
        title: fileTitle,
        fileType: 'xlsx'
      });
      markdown.push(frontmatter.trim());
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsInhsc3giLCJCYXNlU2VydmljZSIsIlhsc3hDb252ZXJ0ZXIiLCJjb25zdHJ1Y3RvciIsImZpbGVQcm9jZXNzb3IiLCJzdXBwb3J0ZWRFeHRlbnNpb25zIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUNvbnZlcnQiLCJiaW5kIiwiaGFuZGxlUHJldmlldyIsImhhbmRsZUdldEluZm8iLCJldmVudCIsImZpbGVQYXRoIiwib3B0aW9ucyIsImNvbnNvbGUiLCJsb2ciLCJ3b3JrYm9vayIsInJlYWRGaWxlIiwiY2VsbERhdGVzIiwieGxzeE9wdGlvbnMiLCJyZWFkRXJyb3IiLCJlcnJvciIsIkVycm9yIiwibWVzc2FnZSIsIlNoZWV0TmFtZXMiLCJsZW5ndGgiLCJyZXN1bHQiLCJjb252ZXJ0VG9NYXJrZG93biIsImluY2x1ZGVBbGxTaGVldHMiLCJ0cmltIiwiY29udGVudCIsInByZXZpZXciLCJtYXhSb3dzIiwic2hlZXRzIiwicHJvcGVydGllcyIsIlByb3BzIiwiYWN0aXZlU2hlZXQiLCJXb3JrYm9vayIsIlNoZWV0cyIsIm5hbWUiLCJKU09OIiwic3RyaW5naWZ5IiwiQXJyYXkiLCJpc0FycmF5IiwiaGFzU2hlZXROYW1lcyIsImZpbGVOYW1lIiwib3JpZ2luYWxGaWxlTmFtZSIsImZpbGVUaXRsZSIsInJlcGxhY2UiLCJtYXJrZG93biIsImNyZWF0ZVN0YW5kYXJkRnJvbnRtYXR0ZXIiLCJmcm9udG1hdHRlciIsInRpdGxlIiwiZmlsZVR5cGUiLCJwdXNoIiwiZGVmYXVsdFNoZWV0Iiwic2hlZXQiLCJUaXRsZSIsIkF1dGhvciIsIkNyZWF0ZWREYXRlIiwic2hlZXROYW1lIiwiZGF0YSIsInV0aWxzIiwic2hlZXRfdG9fanNvbiIsImhlYWRlciIsInNoZWV0RXJyb3IiLCJyYW5nZSIsImRlY29kZV9yYW5nZSIsImUiLCJjIiwicyIsInIiLCJ3YXJuIiwiaGVhZGVycyIsIm1hcCIsImgiLCJ0b1N0cmluZyIsImpvaW4iLCJpIiwiTWF0aCIsIm1pbiIsInJvdyIsImRlYnVnIiwiZm9ybWF0dGVkUm93IiwiXyIsImluZGV4IiwiY2VsbCIsImZvcm1hdENlbGwiLCJjZWxsRXJyb3IiLCJyb3dFcnJvciIsInN0YWNrIiwidmFsdWUiLCJ1bmRlZmluZWQiLCJEYXRlIiwidG9JU09TdHJpbmciLCJzcGxpdCIsInN0ciIsInN1cHBvcnRzRmlsZSIsImV4dCIsImV4dG5hbWUiLCJ0b0xvd2VyQ2FzZSIsImluY2x1ZGVzIiwiZ2V0SW5mbyIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kYXRhL1hsc3hDb252ZXJ0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFhsc3hDb252ZXJ0ZXIuanNcclxuICogSGFuZGxlcyBjb252ZXJzaW9uIG9mIEV4Y2VsIGZpbGVzIHRvIG1hcmtkb3duIGZvcm1hdCBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBcclxuICogVGhpcyBjb252ZXJ0ZXI6XHJcbiAqIC0gUmVhZHMgRXhjZWwgZmlsZXMgdXNpbmcgeGxzeCBwYWNrYWdlXHJcbiAqIC0gU3VwcG9ydHMgbXVsdGlwbGUgc2hlZXRzXHJcbiAqIC0gSGFuZGxlcyBjZWxsIGZvcm1hdHRpbmdcclxuICogLSBHZW5lcmF0ZXMgbWFya2Rvd24gdGFibGVzIHdpdGggbWV0YWRhdGFcclxuICogXHJcbiAqIFJlbGF0ZWQgRmlsZXM6XHJcbiAqIC0gQmFzZVNlcnZpY2UuanM6IFBhcmVudCBjbGFzcyBwcm92aWRpbmcgSVBDIGhhbmRsaW5nXHJcbiAqIC0gRmlsZVByb2Nlc3NvclNlcnZpY2UuanM6IFVzZWQgZm9yIGZpbGUgb3BlcmF0aW9uc1xyXG4gKiAtIENvbnZlcnNpb25TZXJ2aWNlLmpzOiBSZWdpc3RlcnMgYW5kIHVzZXMgdGhpcyBjb252ZXJ0ZXJcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB4bHN4ID0gcmVxdWlyZSgneGxzeCcpO1xyXG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL0Jhc2VTZXJ2aWNlJyk7XHJcblxyXG5jbGFzcyBYbHN4Q29udmVydGVyIGV4dGVuZHMgQmFzZVNlcnZpY2Uge1xyXG4gICAgY29uc3RydWN0b3IoZmlsZVByb2Nlc3Nvcikge1xyXG4gICAgICAgIHN1cGVyKCk7XHJcbiAgICAgICAgdGhpcy5maWxlUHJvY2Vzc29yID0gZmlsZVByb2Nlc3NvcjtcclxuICAgICAgICB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMgPSBbJy54bHN4JywgJy54bHMnLCAnLnhsc20nXTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIEV4Y2VsIGNvbnZlcnNpb25cclxuICAgICAqL1xyXG4gICAgc2V0dXBJcGNIYW5kbGVycygpIHtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDp4bHN4JywgdGhpcy5oYW5kbGVDb252ZXJ0LmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0Onhsc3g6cHJldmlldycsIHRoaXMuaGFuZGxlUHJldmlldy5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDp4bHN4OmluZm8nLCB0aGlzLmhhbmRsZUdldEluZm8uYmluZCh0aGlzKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgRXhjZWwgY29udmVyc2lvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ29udmVyc2lvbiByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlQ29udmVydChldmVudCwgeyBmaWxlUGF0aCwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1hsc3hDb252ZXJ0ZXJdIENvbnZlcnRpbmcgZmlsZTogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFkZCBlcnJvciBoYW5kbGluZyBmb3IgZmlsZSByZWFkaW5nXHJcbiAgICAgICAgICAgIGxldCB3b3JrYm9vaztcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIHdvcmtib29rID0geGxzeC5yZWFkRmlsZShmaWxlUGF0aCwge1xyXG4gICAgICAgICAgICAgICAgICAgIGNlbGxEYXRlczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAuLi5vcHRpb25zLnhsc3hPcHRpb25zXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSBjYXRjaCAocmVhZEVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeENvbnZlcnRlcl0gRmFpbGVkIHRvIHJlYWQgRXhjZWwgZmlsZTogJHtmaWxlUGF0aH1gLCByZWFkRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcmVhZCBFeGNlbCBmaWxlOiAke3JlYWRFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSB3b3JrYm9vayBzdHJ1Y3R1cmVcclxuICAgICAgICAgICAgaWYgKCF3b3JrYm9vayB8fCAhd29ya2Jvb2suU2hlZXROYW1lcyB8fCB3b3JrYm9vay5TaGVldE5hbWVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1hsc3hDb252ZXJ0ZXJdIEludmFsaWQgd29ya2Jvb2sgc3RydWN0dXJlOiAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEV4Y2VsIGZpbGUgc3RydWN0dXJlOiBObyBzaGVldHMgZm91bmQnKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb252ZXJ0VG9NYXJrZG93bih3b3JrYm9vaywge1xyXG4gICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVBbGxTaGVldHM6IHRydWVcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoIXJlc3VsdCB8fCByZXN1bHQudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1hsc3hDb252ZXJ0ZXJdIENvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudDogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRXhjZWwgY29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50Jyk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnRlbnQ6IHJlc3VsdCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBDb252ZXJzaW9uIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBFeGNlbCBwcmV2aWV3IHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBQcmV2aWV3IHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVQcmV2aWV3KGV2ZW50LCB7IGZpbGVQYXRoLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHdvcmtib29rID0geGxzeC5yZWFkRmlsZShmaWxlUGF0aCwge1xyXG4gICAgICAgICAgICAgICAgY2VsbERhdGVzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgLi4ub3B0aW9ucy54bHN4T3B0aW9uc1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIC8vIENvbnZlcnQgb25seSB0aGUgZmlyc3Qgc2hlZXQgZm9yIHByZXZpZXdcclxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb252ZXJ0VG9NYXJrZG93bih3b3JrYm9vaywge1xyXG4gICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgIHByZXZpZXc6IHRydWUsXHJcbiAgICAgICAgICAgICAgICBtYXhSb3dzOiAxMCxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVBbGxTaGVldHM6IGZhbHNlXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHsgY29udGVudDogcmVzdWx0IH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1hsc3hDb252ZXJ0ZXJdIFByZXZpZXcgZ2VuZXJhdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgRXhjZWwgZmlsZSBpbmZvIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBJbmZvIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVHZXRJbmZvKGV2ZW50LCB7IGZpbGVQYXRoIH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCB3b3JrYm9vayA9IHhsc3gucmVhZEZpbGUoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgc2hlZXRzOiB3b3JrYm9vay5TaGVldE5hbWVzLFxyXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczogd29ya2Jvb2suUHJvcHMgfHwge30sXHJcbiAgICAgICAgICAgICAgICBhY3RpdmVTaGVldDogd29ya2Jvb2suV29ya2Jvb2s/LlNoZWV0cz8uWzBdPy5uYW1lIHx8IHdvcmtib29rLlNoZWV0TmFtZXNbMF1cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbWGxzeENvbnZlcnRlcl0gSW5mbyByZXRyaWV2YWwgZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ29udmVydCBFeGNlbCB3b3JrYm9vayB0byBtYXJrZG93blxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHdvcmtib29rIC0gWExTWCB3b3JrYm9vayBvYmplY3RcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGNvbnZlcnRUb01hcmtkb3duKHdvcmtib29rLCBvcHRpb25zID0ge30pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1hsc3hDb252ZXJ0ZXJdIGNvbnZlcnRUb01hcmtkb3duIGNhbGxlZCB3aXRoIG9wdGlvbnM6YCwgSlNPTi5zdHJpbmdpZnkob3B0aW9ucywgbnVsbCwgMikpO1xyXG5cclxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgd29ya2Jvb2sgc3RydWN0dXJlXHJcbiAgICAgICAgICAgIGlmICghd29ya2Jvb2spIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBJbnZhbGlkIHdvcmtib29rOiB3b3JrYm9vayBpcyBudWxsIG9yIHVuZGVmaW5lZCcpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuICc+IEVycm9yOiBJbnZhbGlkIEV4Y2VsIHdvcmtib29rIHN0cnVjdHVyZS4nO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoIXdvcmtib29rLlNoZWV0TmFtZXMgfHwgIUFycmF5LmlzQXJyYXkod29ya2Jvb2suU2hlZXROYW1lcykgfHwgd29ya2Jvb2suU2hlZXROYW1lcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBJbnZhbGlkIHdvcmtib29rOiBubyBzaGVldHMgZm91bmQnLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgaGFzU2hlZXROYW1lczogISF3b3JrYm9vay5TaGVldE5hbWVzLFxyXG4gICAgICAgICAgICAgICAgICAgIGlzQXJyYXk6IEFycmF5LmlzQXJyYXkod29ya2Jvb2suU2hlZXROYW1lcyksXHJcbiAgICAgICAgICAgICAgICAgICAgbGVuZ3RoOiB3b3JrYm9vay5TaGVldE5hbWVzID8gd29ya2Jvb2suU2hlZXROYW1lcy5sZW5ndGggOiAwXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIHJldHVybiAnPiBFcnJvcjogTm8gc2hlZXRzIGZvdW5kIGluIEV4Y2VsIHdvcmtib29rLic7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIEdldCB0aGUgb3JpZ2luYWwgZmlsZW5hbWUgd2l0aG91dCBleHRlbnNpb25cclxuICAgICAgICAgICAgY29uc3QgZmlsZU5hbWUgPSBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lIHx8ICdleGNlbC1kYXRhJztcclxuICAgICAgICAgICAgY29uc3QgZmlsZVRpdGxlID0gZmlsZU5hbWUucmVwbGFjZSgvXFwuW14vLl0rJC8sICcnKTsgLy8gUmVtb3ZlIGZpbGUgZXh0ZW5zaW9uIGlmIHByZXNlbnRcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4Q29udmVydGVyXSBVc2luZyB0aXRsZSBmb3IgY29udmVyc2lvbjogJHtmaWxlVGl0bGV9IChmcm9tICR7ZmlsZU5hbWV9KWApO1xyXG5cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duID0gW107XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGZyb250bWF0dGVyIHVzaW5nIG1ldGFkYXRhIHV0aWxpdHlcclxuICAgICAgICAgICAgY29uc3QgeyBjcmVhdGVTdGFuZGFyZEZyb250bWF0dGVyIH0gPSByZXF1aXJlKCcuLi8uLi8uLi9jb252ZXJ0ZXJzL3V0aWxzL21ldGFkYXRhJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IGZyb250bWF0dGVyID0gY3JlYXRlU3RhbmRhcmRGcm9udG1hdHRlcih7XHJcbiAgICAgICAgICAgICAgICB0aXRsZTogZmlsZVRpdGxlLFxyXG4gICAgICAgICAgICAgICAgZmlsZVR5cGU6ICd4bHN4J1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goZnJvbnRtYXR0ZXIudHJpbSgpKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBTYWZlbHkgZGV0ZXJtaW5lIHdoaWNoIHNoZWV0cyB0byBwcm9jZXNzXHJcbiAgICAgICAgICAgIGxldCBzaGVldHM7XHJcbiAgICAgICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGVBbGxTaGVldHMpIHtcclxuICAgICAgICAgICAgICAgIHNoZWV0cyA9IHdvcmtib29rLlNoZWV0TmFtZXM7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW1hsc3hDb252ZXJ0ZXJdIFByb2Nlc3NpbmcgYWxsICR7c2hlZXRzLmxlbmd0aH0gc2hlZXRzYCk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0U2hlZXQgPSB3b3JrYm9vay5TaGVldE5hbWVzWzBdO1xyXG4gICAgICAgICAgICAgICAgc2hlZXRzID0gW29wdGlvbnMuc2hlZXQgfHwgZGVmYXVsdFNoZWV0XTtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbWGxzeENvbnZlcnRlcl0gUHJvY2Vzc2luZyBzaW5nbGUgc2hlZXQ6ICR7c2hlZXRzWzBdfWApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBBZGQgZG9jdW1lbnQgcHJvcGVydGllcyBhcyBub3Rlc1xyXG4gICAgICAgICAgICBpZiAod29ya2Jvb2suUHJvcHMpIHtcclxuICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJz4gRXhjZWwgRG9jdW1lbnQgUHJvcGVydGllcycpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHdvcmtib29rLlByb3BzLlRpdGxlKSBtYXJrZG93bi5wdXNoKGA+IC0gVGl0bGU6ICR7d29ya2Jvb2suUHJvcHMuVGl0bGV9YCk7XHJcbiAgICAgICAgICAgICAgICBpZiAod29ya2Jvb2suUHJvcHMuQXV0aG9yKSBtYXJrZG93bi5wdXNoKGA+IC0gQXV0aG9yOiAke3dvcmtib29rLlByb3BzLkF1dGhvcn1gKTtcclxuICAgICAgICAgICAgICAgIGlmICh3b3JrYm9vay5Qcm9wcy5DcmVhdGVkRGF0ZSkgbWFya2Rvd24ucHVzaChgPiAtIENyZWF0ZWQ6ICR7d29ya2Jvb2suUHJvcHMuQ3JlYXRlZERhdGV9YCk7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gUHJvY2VzcyBlYWNoIHNoZWV0XHJcbiAgICAgICAgICAgIGZvciAoY29uc3Qgc2hlZXROYW1lIG9mIHNoZWV0cykge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4Q29udmVydGVyXSBQcm9jZXNzaW5nIHNoZWV0OiAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gVmFsaWRhdGUgc2hlZXQgZXhpc3RzXHJcbiAgICAgICAgICAgICAgICBpZiAoIXdvcmtib29rLlNoZWV0cyB8fCAhd29ya2Jvb2suU2hlZXRzW3NoZWV0TmFtZV0pIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeENvbnZlcnRlcl0gU2hlZXQgbm90IGZvdW5kOiAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjIyAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCc+IEVycm9yOiBTaGVldCBkYXRhIG5vdCBmb3VuZC5cXG4nKTtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2hlZXQgPSB3b3JrYm9vay5TaGVldHNbc2hlZXROYW1lXTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gU2FmZWx5IGNvbnZlcnQgc2hlZXQgdG8gSlNPTiB3aXRoIGVycm9yIGhhbmRsaW5nXHJcbiAgICAgICAgICAgICAgICBsZXQgZGF0YTtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YSA9IHhsc3gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4Q29udmVydGVyXSBDb252ZXJ0ZWQgc2hlZXQgdG8gSlNPTiwgcm93czogJHtkYXRhLmxlbmd0aH1gKTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKHNoZWV0RXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeENvbnZlcnRlcl0gRXJyb3IgY29udmVydGluZyBzaGVldCB0byBKU09OOiAke3NoZWV0TmFtZX1gLCBzaGVldEVycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjIyAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IEVycm9yIGNvbnZlcnRpbmcgc2hlZXQ6ICR7c2hlZXRFcnJvci5tZXNzYWdlfVxcbmApO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmICghZGF0YSB8fCBkYXRhLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbWGxzeENvbnZlcnRlcl0gTm8gZGF0YSBmb3VuZCBpbiBzaGVldDogJHtzaGVldE5hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIyMgJHtzaGVldE5hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnPiBObyBkYXRhIGZvdW5kIGluIHRoaXMgc2hlZXQuXFxuJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQWRkIHNoZWV0IHRpdGxlXHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjIyAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQWRkIHNoZWV0IG1ldGFkYXRhXHJcbiAgICAgICAgICAgICAgICBjb25zdCByYW5nZSA9IHhsc3gudXRpbHMuZGVjb2RlX3JhbmdlKHNoZWV0WychcmVmJ10gfHwgJ0ExJyk7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IEV4Y2VsIFNoZWV0JHtvcHRpb25zLnByZXZpZXcgPyAnIChQcmV2aWV3KScgOiAnJ31gKTtcclxuICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYD4gLSBDb2x1bW5zOiAke3JhbmdlLmUuYyAtIHJhbmdlLnMuYyArIDF9YCk7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IC0gUm93czogJHtyYW5nZS5lLnIgLSByYW5nZS5zLnIgKyAxfWApO1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgd2UgaGF2ZSBkYXRhIGFuZCBoZWFkZXJzXHJcbiAgICAgICAgICAgICAgICBpZiAoIWRhdGFbMF0gfHwgIUFycmF5LmlzQXJyYXkoZGF0YVswXSkpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtYbHN4Q29udmVydGVyXSBTaGVldCAke3NoZWV0TmFtZX0gaGFzIG5vIGhlYWRlcnMgb3IgaW52YWxpZCBkYXRhIHN0cnVjdHVyZWApO1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJz4gTm8gdmFsaWQgZGF0YSBzdHJ1Y3R1cmUgZm91bmQgaW4gdGhpcyBzaGVldC5cXG4nKTtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAvLyBHZXQgaGVhZGVycyAoZmlyc3Qgcm93KSB3aXRoIGFkZGl0aW9uYWwgbG9nZ2luZ1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4Q29udmVydGVyXSBGaXJzdCByb3cgZGF0YTpgLCBKU09OLnN0cmluZ2lmeShkYXRhWzBdKSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBoZWFkZXJzID0gZGF0YVswXS5tYXAoaCA9PiAoaCB8fCAnJykudG9TdHJpbmcoKSk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQnVpbGQgdGFibGUgaGVhZGVyXHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCd8ICcgKyBoZWFkZXJzLm1hcChoID0+IGggfHwgJyAnKS5qb2luKCcgfCAnKSArICcgfCcpO1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnfCAnICsgaGVhZGVycy5tYXAoKCkgPT4gJy0tLScpLmpvaW4oJyB8ICcpICsgJyB8Jyk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQnVpbGQgdGFibGUgcm93c1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbWF4Um93cyA9IG9wdGlvbnMubWF4Um93cyB8fCBkYXRhLmxlbmd0aDtcclxuICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAxOyBpIDwgTWF0aC5taW4oZGF0YS5sZW5ndGgsIG1heFJvd3MgKyAxKTsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgcm93ID0gZGF0YVtpXTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXJvdykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmRlYnVnKGBbWGxzeENvbnZlcnRlcl0gRW1wdHkgcm93IGF0IGluZGV4ICR7aX0gaW4gc2hlZXQgJHtzaGVldE5hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAvLyBBZGQgYWRkaXRpb25hbCBlcnJvciBoYW5kbGluZyBmb3Igcm93IHByb2Nlc3NpbmdcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmb3JtYXR0ZWRSb3cgPSBoZWFkZXJzLm1hcCgoXywgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY2VsbCA9IHJvd1tpbmRleF07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZm9ybWF0Q2VsbChjZWxsKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGNlbGxFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgW1hsc3hDb252ZXJ0ZXJdIEVycm9yIGZvcm1hdHRpbmcgY2VsbCBhdCBpbmRleCAke2luZGV4fTpgLCBjZWxsRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ3wgJyArIGZvcm1hdHRlZFJvdy5qb2luKCcgfCAnKSArICcgfCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKHJvd0Vycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtYbHN4Q29udmVydGVyXSBFcnJvciBwcm9jZXNzaW5nIHJvdyBhdCBpbmRleCAke2l9OmAsIHJvd0Vycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gU2tpcCBwcm9ibGVtYXRpYyByb3dzIGluc3RlYWQgb2YgZmFpbGluZyB0aGUgZW50aXJlIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTsgLy8gQWRkIHNwYWNlIGJldHdlZW4gc2hlZXRzXHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1hsc3hDb252ZXJ0ZXJdIE1hcmtkb3duIGdlbmVyYXRpb24gY29tcGxldGUsIGxlbmd0aDogJHtyZXN1bHQubGVuZ3RofSBieXRlc2ApO1xyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBNYXJrZG93biBjb252ZXJzaW9uIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBFcnJvciBkZXRhaWxzOicsIGVycm9yLnN0YWNrIHx8IGVycm9yKTtcclxuICAgICAgICAgICAgLy8gUmV0dXJuIGEgbWVhbmluZ2Z1bCBlcnJvciBtZXNzYWdlIGluc3RlYWQgb2YgdGhyb3dpbmdcclxuICAgICAgICAgICAgcmV0dXJuIGA+IEVycm9yIGNvbnZlcnRpbmcgRXhjZWwgZmlsZTogJHtlcnJvci5tZXNzYWdlfWA7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRm9ybWF0IGNlbGwgdmFsdWUgZm9yIG1hcmtkb3duXHJcbiAgICAgKiBAcGFyYW0geyp9IHZhbHVlIC0gQ2VsbCB2YWx1ZVxyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gRm9ybWF0dGVkIGNlbGwgdmFsdWVcclxuICAgICAqL1xyXG4gICAgZm9ybWF0Q2VsbCh2YWx1ZSkge1xyXG4gICAgICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAnJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0ciA9IHZhbHVlLnRvU3RyaW5nKCk7XHJcbiAgICAgICAgICAgIHJldHVybiBzdHIucmVwbGFjZSgvXFx8L2csICdcXFxcfCcpLnJlcGxhY2UoL1xcbi9nLCAnPGJyPicpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBFcnJvciBmb3JtYXR0aW5nIGNlbGw6JywgZXJyb3IsICdWYWx1ZSB0eXBlOicsIHR5cGVvZiB2YWx1ZSk7XHJcbiAgICAgICAgICAgIHJldHVybiAnJztcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVjayBpZiB0aGlzIGNvbnZlcnRlciBzdXBwb3J0cyB0aGUgZ2l2ZW4gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBmaWxlXHJcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBzdXBwb3J0ZWRcclxuICAgICAqL1xyXG4gICAgc3VwcG9ydHNGaWxlKGZpbGVQYXRoKSB7XHJcbiAgICAgICAgY29uc3QgZXh0ID0gcGF0aC5leHRuYW1lKGZpbGVQYXRoKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgIHJldHVybiB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMuaW5jbHVkZXMoZXh0KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IENvbnZlcnRlciBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGdldEluZm8oKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgbmFtZTogJ0V4Y2VsIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbnM6IHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyxcclxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb252ZXJ0cyBFeGNlbCBmaWxlcyB0byBtYXJrZG93biB0YWJsZXMnLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgICBzaGVldDogJ1NwZWNpZmljIHNoZWV0IHRvIGNvbnZlcnQnLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZUFsbFNoZWV0czogJ0NvbnZlcnQgYWxsIHNoZWV0cyAoZGVmYXVsdDogdHJ1ZSknLFxyXG4gICAgICAgICAgICAgICAgbWF4Um93czogJ01heGltdW0gcm93cyB0byBjb252ZXJ0IHBlciBzaGVldCcsXHJcbiAgICAgICAgICAgICAgICB0aXRsZTogJ09wdGlvbmFsIGRvY3VtZW50IHRpdGxlJyxcclxuICAgICAgICAgICAgICAgIHhsc3hPcHRpb25zOiAnQWRkaXRpb25hbCBYTFNYIHBhcnNpbmcgb3B0aW9ucydcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gWGxzeENvbnZlcnRlcjtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNB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