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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsInhsc3giLCJCYXNlU2VydmljZSIsIlhsc3hDb252ZXJ0ZXIiLCJjb25zdHJ1Y3RvciIsImZpbGVQcm9jZXNzb3IiLCJzdXBwb3J0ZWRFeHRlbnNpb25zIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUNvbnZlcnQiLCJiaW5kIiwiaGFuZGxlUHJldmlldyIsImhhbmRsZUdldEluZm8iLCJldmVudCIsImZpbGVQYXRoIiwib3B0aW9ucyIsImNvbnNvbGUiLCJsb2ciLCJ3b3JrYm9vayIsInJlYWRGaWxlIiwiY2VsbERhdGVzIiwieGxzeE9wdGlvbnMiLCJyZWFkRXJyb3IiLCJlcnJvciIsIkVycm9yIiwibWVzc2FnZSIsIlNoZWV0TmFtZXMiLCJsZW5ndGgiLCJyZXN1bHQiLCJjb252ZXJ0VG9NYXJrZG93biIsImluY2x1ZGVBbGxTaGVldHMiLCJ0cmltIiwiY29udGVudCIsInByZXZpZXciLCJtYXhSb3dzIiwic2hlZXRzIiwicHJvcGVydGllcyIsIlByb3BzIiwiYWN0aXZlU2hlZXQiLCJXb3JrYm9vayIsIlNoZWV0cyIsIm5hbWUiLCJKU09OIiwic3RyaW5naWZ5IiwiQXJyYXkiLCJpc0FycmF5IiwiaGFzU2hlZXROYW1lcyIsImZpbGVOYW1lIiwib3JpZ2luYWxGaWxlTmFtZSIsImZpbGVUaXRsZSIsInJlcGxhY2UiLCJub3ciLCJEYXRlIiwiY29udmVydGVkRGF0ZSIsInRvSVNPU3RyaW5nIiwic3BsaXQiLCJtYXJrZG93biIsInB1c2giLCJkZWZhdWx0U2hlZXQiLCJzaGVldCIsIlRpdGxlIiwiQXV0aG9yIiwiQ3JlYXRlZERhdGUiLCJzaGVldE5hbWUiLCJkYXRhIiwidXRpbHMiLCJzaGVldF90b19qc29uIiwiaGVhZGVyIiwic2hlZXRFcnJvciIsInJhbmdlIiwiZGVjb2RlX3JhbmdlIiwiZSIsImMiLCJzIiwiciIsIndhcm4iLCJoZWFkZXJzIiwibWFwIiwiaCIsInRvU3RyaW5nIiwiam9pbiIsImkiLCJNYXRoIiwibWluIiwicm93IiwiZGVidWciLCJmb3JtYXR0ZWRSb3ciLCJfIiwiaW5kZXgiLCJjZWxsIiwiZm9ybWF0Q2VsbCIsImNlbGxFcnJvciIsInJvd0Vycm9yIiwic3RhY2siLCJ2YWx1ZSIsInVuZGVmaW5lZCIsInN0ciIsInN1cHBvcnRzRmlsZSIsImV4dCIsImV4dG5hbWUiLCJ0b0xvd2VyQ2FzZSIsImluY2x1ZGVzIiwiZ2V0SW5mbyIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsInRpdGxlIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL2RhdGEvWGxzeENvbnZlcnRlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogWGxzeENvbnZlcnRlci5qc1xyXG4gKiBIYW5kbGVzIGNvbnZlcnNpb24gb2YgRXhjZWwgZmlsZXMgdG8gbWFya2Rvd24gZm9ybWF0IGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXHJcbiAqIFxyXG4gKiBUaGlzIGNvbnZlcnRlcjpcclxuICogLSBSZWFkcyBFeGNlbCBmaWxlcyB1c2luZyB4bHN4IHBhY2thZ2VcclxuICogLSBTdXBwb3J0cyBtdWx0aXBsZSBzaGVldHNcclxuICogLSBIYW5kbGVzIGNlbGwgZm9ybWF0dGluZ1xyXG4gKiAtIEdlbmVyYXRlcyBtYXJrZG93biB0YWJsZXMgd2l0aCBtZXRhZGF0YVxyXG4gKiBcclxuICogUmVsYXRlZCBGaWxlczpcclxuICogLSBCYXNlU2VydmljZS5qczogUGFyZW50IGNsYXNzIHByb3ZpZGluZyBJUEMgaGFuZGxpbmdcclxuICogLSBGaWxlUHJvY2Vzc29yU2VydmljZS5qczogVXNlZCBmb3IgZmlsZSBvcGVyYXRpb25zXHJcbiAqIC0gQ29udmVyc2lvblNlcnZpY2UuanM6IFJlZ2lzdGVycyBhbmQgdXNlcyB0aGlzIGNvbnZlcnRlclxyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IHhsc3ggPSByZXF1aXJlKCd4bHN4Jyk7XHJcbmNvbnN0IEJhc2VTZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vQmFzZVNlcnZpY2UnKTtcclxuXHJcbmNsYXNzIFhsc3hDb252ZXJ0ZXIgZXh0ZW5kcyBCYXNlU2VydmljZSB7XHJcbiAgICBjb25zdHJ1Y3RvcihmaWxlUHJvY2Vzc29yKSB7XHJcbiAgICAgICAgc3VwZXIoKTtcclxuICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yO1xyXG4gICAgICAgIHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyA9IFsnLnhsc3gnLCAnLnhscycsICcueGxzbSddO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogU2V0IHVwIElQQyBoYW5kbGVycyBmb3IgRXhjZWwgY29udmVyc2lvblxyXG4gICAgICovXHJcbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0Onhsc3gnLCB0aGlzLmhhbmRsZUNvbnZlcnQuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6eGxzeDpwcmV2aWV3JywgdGhpcy5oYW5kbGVQcmV2aWV3LmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0Onhsc3g6aW5mbycsIHRoaXMuaGFuZGxlR2V0SW5mby5iaW5kKHRoaXMpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBFeGNlbCBjb252ZXJzaW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb252ZXJzaW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDb252ZXJ0KGV2ZW50LCB7IGZpbGVQYXRoLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbWGxzeENvbnZlcnRlcl0gQ29udmVydGluZyBmaWxlOiAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIGVycm9yIGhhbmRsaW5nIGZvciBmaWxlIHJlYWRpbmdcclxuICAgICAgICAgICAgbGV0IHdvcmtib29rO1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgd29ya2Jvb2sgPSB4bHN4LnJlYWRGaWxlKGZpbGVQYXRoLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2VsbERhdGVzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMueGxzeE9wdGlvbnNcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChyZWFkRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtYbHN4Q29udmVydGVyXSBGYWlsZWQgdG8gcmVhZCBFeGNlbCBmaWxlOiAke2ZpbGVQYXRofWAsIHJlYWRFcnJvcik7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byByZWFkIEV4Y2VsIGZpbGU6ICR7cmVhZEVycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIHdvcmtib29rIHN0cnVjdHVyZVxyXG4gICAgICAgICAgICBpZiAoIXdvcmtib29rIHx8ICF3b3JrYm9vay5TaGVldE5hbWVzIHx8IHdvcmtib29rLlNoZWV0TmFtZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeENvbnZlcnRlcl0gSW52YWxpZCB3b3JrYm9vayBzdHJ1Y3R1cmU6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgRXhjZWwgZmlsZSBzdHJ1Y3R1cmU6IE5vIHNoZWV0cyBmb3VuZCcpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnZlcnRUb01hcmtkb3duKHdvcmtib29rLCB7XHJcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZUFsbFNoZWV0czogdHJ1ZVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIGlmICghcmVzdWx0IHx8IHJlc3VsdC50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeENvbnZlcnRlcl0gQ29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50OiAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFeGNlbCBjb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQnKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHsgY29udGVudDogcmVzdWx0IH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1hsc3hDb252ZXJ0ZXJdIENvbnZlcnNpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIEV4Y2VsIHByZXZpZXcgcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFByZXZpZXcgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZVByZXZpZXcoZXZlbnQsIHsgZmlsZVBhdGgsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3Qgd29ya2Jvb2sgPSB4bHN4LnJlYWRGaWxlKGZpbGVQYXRoLCB7XHJcbiAgICAgICAgICAgICAgICBjZWxsRGF0ZXM6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLnhsc3hPcHRpb25zXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgLy8gQ29udmVydCBvbmx5IHRoZSBmaXJzdCBzaGVldCBmb3IgcHJldmlld1xyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnZlcnRUb01hcmtkb3duKHdvcmtib29rLCB7XHJcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgcHJldmlldzogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIG1heFJvd3M6IDEwLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZUFsbFNoZWV0czogZmFsc2VcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4geyBjb250ZW50OiByZXN1bHQgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbWGxzeENvbnZlcnRlcl0gUHJldmlldyBnZW5lcmF0aW9uIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBFeGNlbCBmaWxlIGluZm8gcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIEluZm8gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUdldEluZm8oZXZlbnQsIHsgZmlsZVBhdGggfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHdvcmtib29rID0geGxzeC5yZWFkRmlsZShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBzaGVldHM6IHdvcmtib29rLlNoZWV0TmFtZXMsXHJcbiAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB3b3JrYm9vay5Qcm9wcyB8fCB7fSxcclxuICAgICAgICAgICAgICAgIGFjdGl2ZVNoZWV0OiB3b3JrYm9vay5Xb3JrYm9vaz8uU2hlZXRzPy5bMF0/Lm5hbWUgfHwgd29ya2Jvb2suU2hlZXROYW1lc1swXVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBJbmZvIHJldHJpZXZhbCBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDb252ZXJ0IEV4Y2VsIHdvcmtib29rIHRvIG1hcmtkb3duXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gd29ya2Jvb2sgLSBYTFNYIHdvcmtib29rIG9iamVjdFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IE1hcmtkb3duIGNvbnRlbnRcclxuICAgICAqL1xyXG4gICAgYXN5bmMgY29udmVydFRvTWFya2Rvd24od29ya2Jvb2ssIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbWGxzeENvbnZlcnRlcl0gY29udmVydFRvTWFya2Rvd24gY2FsbGVkIHdpdGggb3B0aW9uczpgLCBKU09OLnN0cmluZ2lmeShvcHRpb25zLCBudWxsLCAyKSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSB3b3JrYm9vayBzdHJ1Y3R1cmVcclxuICAgICAgICAgICAgaWYgKCF3b3JrYm9vaykge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1hsc3hDb252ZXJ0ZXJdIEludmFsaWQgd29ya2Jvb2s6IHdvcmtib29rIGlzIG51bGwgb3IgdW5kZWZpbmVkJyk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gJz4gRXJyb3I6IEludmFsaWQgRXhjZWwgd29ya2Jvb2sgc3RydWN0dXJlLic7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICghd29ya2Jvb2suU2hlZXROYW1lcyB8fCAhQXJyYXkuaXNBcnJheSh3b3JrYm9vay5TaGVldE5hbWVzKSB8fCB3b3JrYm9vay5TaGVldE5hbWVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1hsc3hDb252ZXJ0ZXJdIEludmFsaWQgd29ya2Jvb2s6IG5vIHNoZWV0cyBmb3VuZCcsIHtcclxuICAgICAgICAgICAgICAgICAgICBoYXNTaGVldE5hbWVzOiAhIXdvcmtib29rLlNoZWV0TmFtZXMsXHJcbiAgICAgICAgICAgICAgICAgICAgaXNBcnJheTogQXJyYXkuaXNBcnJheSh3b3JrYm9vay5TaGVldE5hbWVzKSxcclxuICAgICAgICAgICAgICAgICAgICBsZW5ndGg6IHdvcmtib29rLlNoZWV0TmFtZXMgPyB3b3JrYm9vay5TaGVldE5hbWVzLmxlbmd0aCA6IDBcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuICc+IEVycm9yOiBObyBzaGVldHMgZm91bmQgaW4gRXhjZWwgd29ya2Jvb2suJztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IHRoZSBvcmlnaW5hbCBmaWxlbmFtZSB3aXRob3V0IGV4dGVuc2lvblxyXG4gICAgICAgICAgICBjb25zdCBmaWxlTmFtZSA9IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBvcHRpb25zLm5hbWUgfHwgJ2V4Y2VsLWRhdGEnO1xyXG4gICAgICAgICAgICBjb25zdCBmaWxlVGl0bGUgPSBmaWxlTmFtZS5yZXBsYWNlKC9cXC5bXi8uXSskLywgJycpOyAvLyBSZW1vdmUgZmlsZSBleHRlbnNpb24gaWYgcHJlc2VudFxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IGN1cnJlbnQgZGF0ZXRpbWVcclxuICAgICAgICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgICAgICAgICAgY29uc3QgY29udmVydGVkRGF0ZSA9IG5vdy50b0lTT1N0cmluZygpLnNwbGl0KCcuJylbMF0ucmVwbGFjZSgnVCcsICcgJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBtYXJrZG93biA9IFtdO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIHN0YW5kYXJkaXplZCBmcm9udG1hdHRlclxyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCctLS0nKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgdGl0bGU6ICR7ZmlsZVRpdGxlfWApO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGBjb252ZXJ0ZWQ6ICR7Y29udmVydGVkRGF0ZX1gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgndHlwZTogeGxzeCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCctLS0nKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBTYWZlbHkgZGV0ZXJtaW5lIHdoaWNoIHNoZWV0cyB0byBwcm9jZXNzXHJcbiAgICAgICAgICAgIGxldCBzaGVldHM7XHJcbiAgICAgICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGVBbGxTaGVldHMpIHtcclxuICAgICAgICAgICAgICAgIHNoZWV0cyA9IHdvcmtib29rLlNoZWV0TmFtZXM7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW1hsc3hDb252ZXJ0ZXJdIFByb2Nlc3NpbmcgYWxsICR7c2hlZXRzLmxlbmd0aH0gc2hlZXRzYCk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0U2hlZXQgPSB3b3JrYm9vay5TaGVldE5hbWVzWzBdO1xyXG4gICAgICAgICAgICAgICAgc2hlZXRzID0gW29wdGlvbnMuc2hlZXQgfHwgZGVmYXVsdFNoZWV0XTtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbWGxzeENvbnZlcnRlcl0gUHJvY2Vzc2luZyBzaW5nbGUgc2hlZXQ6ICR7c2hlZXRzWzBdfWApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBBZGQgZG9jdW1lbnQgcHJvcGVydGllcyBhcyBub3Rlc1xyXG4gICAgICAgICAgICBpZiAod29ya2Jvb2suUHJvcHMpIHtcclxuICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJz4gRXhjZWwgRG9jdW1lbnQgUHJvcGVydGllcycpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHdvcmtib29rLlByb3BzLlRpdGxlKSBtYXJrZG93bi5wdXNoKGA+IC0gVGl0bGU6ICR7d29ya2Jvb2suUHJvcHMuVGl0bGV9YCk7XHJcbiAgICAgICAgICAgICAgICBpZiAod29ya2Jvb2suUHJvcHMuQXV0aG9yKSBtYXJrZG93bi5wdXNoKGA+IC0gQXV0aG9yOiAke3dvcmtib29rLlByb3BzLkF1dGhvcn1gKTtcclxuICAgICAgICAgICAgICAgIGlmICh3b3JrYm9vay5Qcm9wcy5DcmVhdGVkRGF0ZSkgbWFya2Rvd24ucHVzaChgPiAtIENyZWF0ZWQ6ICR7d29ya2Jvb2suUHJvcHMuQ3JlYXRlZERhdGV9YCk7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gUHJvY2VzcyBlYWNoIHNoZWV0XHJcbiAgICAgICAgICAgIGZvciAoY29uc3Qgc2hlZXROYW1lIG9mIHNoZWV0cykge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4Q29udmVydGVyXSBQcm9jZXNzaW5nIHNoZWV0OiAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gVmFsaWRhdGUgc2hlZXQgZXhpc3RzXHJcbiAgICAgICAgICAgICAgICBpZiAoIXdvcmtib29rLlNoZWV0cyB8fCAhd29ya2Jvb2suU2hlZXRzW3NoZWV0TmFtZV0pIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeENvbnZlcnRlcl0gU2hlZXQgbm90IGZvdW5kOiAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjIyAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCc+IEVycm9yOiBTaGVldCBkYXRhIG5vdCBmb3VuZC5cXG4nKTtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2hlZXQgPSB3b3JrYm9vay5TaGVldHNbc2hlZXROYW1lXTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gU2FmZWx5IGNvbnZlcnQgc2hlZXQgdG8gSlNPTiB3aXRoIGVycm9yIGhhbmRsaW5nXHJcbiAgICAgICAgICAgICAgICBsZXQgZGF0YTtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YSA9IHhsc3gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4Q29udmVydGVyXSBDb252ZXJ0ZWQgc2hlZXQgdG8gSlNPTiwgcm93czogJHtkYXRhLmxlbmd0aH1gKTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKHNoZWV0RXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbWGxzeENvbnZlcnRlcl0gRXJyb3IgY29udmVydGluZyBzaGVldCB0byBKU09OOiAke3NoZWV0TmFtZX1gLCBzaGVldEVycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjIyAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IEVycm9yIGNvbnZlcnRpbmcgc2hlZXQ6ICR7c2hlZXRFcnJvci5tZXNzYWdlfVxcbmApO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGlmICghZGF0YSB8fCBkYXRhLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbWGxzeENvbnZlcnRlcl0gTm8gZGF0YSBmb3VuZCBpbiBzaGVldDogJHtzaGVldE5hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIyMgJHtzaGVldE5hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnPiBObyBkYXRhIGZvdW5kIGluIHRoaXMgc2hlZXQuXFxuJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQWRkIHNoZWV0IHRpdGxlXHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjIyAke3NoZWV0TmFtZX1gKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQWRkIHNoZWV0IG1ldGFkYXRhXHJcbiAgICAgICAgICAgICAgICBjb25zdCByYW5nZSA9IHhsc3gudXRpbHMuZGVjb2RlX3JhbmdlKHNoZWV0WychcmVmJ10gfHwgJ0ExJyk7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IEV4Y2VsIFNoZWV0JHtvcHRpb25zLnByZXZpZXcgPyAnIChQcmV2aWV3KScgOiAnJ31gKTtcclxuICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYD4gLSBDb2x1bW5zOiAke3JhbmdlLmUuYyAtIHJhbmdlLnMuYyArIDF9YCk7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IC0gUm93czogJHtyYW5nZS5lLnIgLSByYW5nZS5zLnIgKyAxfWApO1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgd2UgaGF2ZSBkYXRhIGFuZCBoZWFkZXJzXHJcbiAgICAgICAgICAgICAgICBpZiAoIWRhdGFbMF0gfHwgIUFycmF5LmlzQXJyYXkoZGF0YVswXSkpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtYbHN4Q29udmVydGVyXSBTaGVldCAke3NoZWV0TmFtZX0gaGFzIG5vIGhlYWRlcnMgb3IgaW52YWxpZCBkYXRhIHN0cnVjdHVyZWApO1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJz4gTm8gdmFsaWQgZGF0YSBzdHJ1Y3R1cmUgZm91bmQgaW4gdGhpcyBzaGVldC5cXG4nKTtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAvLyBHZXQgaGVhZGVycyAoZmlyc3Qgcm93KSB3aXRoIGFkZGl0aW9uYWwgbG9nZ2luZ1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtYbHN4Q29udmVydGVyXSBGaXJzdCByb3cgZGF0YTpgLCBKU09OLnN0cmluZ2lmeShkYXRhWzBdKSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBoZWFkZXJzID0gZGF0YVswXS5tYXAoaCA9PiAoaCB8fCAnJykudG9TdHJpbmcoKSk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQnVpbGQgdGFibGUgaGVhZGVyXHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCd8ICcgKyBoZWFkZXJzLm1hcChoID0+IGggfHwgJyAnKS5qb2luKCcgfCAnKSArICcgfCcpO1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnfCAnICsgaGVhZGVycy5tYXAoKCkgPT4gJy0tLScpLmpvaW4oJyB8ICcpICsgJyB8Jyk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQnVpbGQgdGFibGUgcm93c1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbWF4Um93cyA9IG9wdGlvbnMubWF4Um93cyB8fCBkYXRhLmxlbmd0aDtcclxuICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAxOyBpIDwgTWF0aC5taW4oZGF0YS5sZW5ndGgsIG1heFJvd3MgKyAxKTsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgcm93ID0gZGF0YVtpXTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXJvdykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmRlYnVnKGBbWGxzeENvbnZlcnRlcl0gRW1wdHkgcm93IGF0IGluZGV4ICR7aX0gaW4gc2hlZXQgJHtzaGVldE5hbWV9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAvLyBBZGQgYWRkaXRpb25hbCBlcnJvciBoYW5kbGluZyBmb3Igcm93IHByb2Nlc3NpbmdcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmb3JtYXR0ZWRSb3cgPSBoZWFkZXJzLm1hcCgoXywgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY2VsbCA9IHJvd1tpbmRleF07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZm9ybWF0Q2VsbChjZWxsKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGNlbGxFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgW1hsc3hDb252ZXJ0ZXJdIEVycm9yIGZvcm1hdHRpbmcgY2VsbCBhdCBpbmRleCAke2luZGV4fTpgLCBjZWxsRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ3wgJyArIGZvcm1hdHRlZFJvdy5qb2luKCcgfCAnKSArICcgfCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKHJvd0Vycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtYbHN4Q29udmVydGVyXSBFcnJvciBwcm9jZXNzaW5nIHJvdyBhdCBpbmRleCAke2l9OmAsIHJvd0Vycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gU2tpcCBwcm9ibGVtYXRpYyByb3dzIGluc3RlYWQgb2YgZmFpbGluZyB0aGUgZW50aXJlIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTsgLy8gQWRkIHNwYWNlIGJldHdlZW4gc2hlZXRzXHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1hsc3hDb252ZXJ0ZXJdIE1hcmtkb3duIGdlbmVyYXRpb24gY29tcGxldGUsIGxlbmd0aDogJHtyZXN1bHQubGVuZ3RofSBieXRlc2ApO1xyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBNYXJrZG93biBjb252ZXJzaW9uIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBFcnJvciBkZXRhaWxzOicsIGVycm9yLnN0YWNrIHx8IGVycm9yKTtcclxuICAgICAgICAgICAgLy8gUmV0dXJuIGEgbWVhbmluZ2Z1bCBlcnJvciBtZXNzYWdlIGluc3RlYWQgb2YgdGhyb3dpbmdcclxuICAgICAgICAgICAgcmV0dXJuIGA+IEVycm9yIGNvbnZlcnRpbmcgRXhjZWwgZmlsZTogJHtlcnJvci5tZXNzYWdlfWA7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRm9ybWF0IGNlbGwgdmFsdWUgZm9yIG1hcmtkb3duXHJcbiAgICAgKiBAcGFyYW0geyp9IHZhbHVlIC0gQ2VsbCB2YWx1ZVxyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gRm9ybWF0dGVkIGNlbGwgdmFsdWVcclxuICAgICAqL1xyXG4gICAgZm9ybWF0Q2VsbCh2YWx1ZSkge1xyXG4gICAgICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAnJztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0ciA9IHZhbHVlLnRvU3RyaW5nKCk7XHJcbiAgICAgICAgICAgIHJldHVybiBzdHIucmVwbGFjZSgvXFx8L2csICdcXFxcfCcpLnJlcGxhY2UoL1xcbi9nLCAnPGJyPicpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tYbHN4Q29udmVydGVyXSBFcnJvciBmb3JtYXR0aW5nIGNlbGw6JywgZXJyb3IsICdWYWx1ZSB0eXBlOicsIHR5cGVvZiB2YWx1ZSk7XHJcbiAgICAgICAgICAgIHJldHVybiAnJztcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVjayBpZiB0aGlzIGNvbnZlcnRlciBzdXBwb3J0cyB0aGUgZ2l2ZW4gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBmaWxlXHJcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBzdXBwb3J0ZWRcclxuICAgICAqL1xyXG4gICAgc3VwcG9ydHNGaWxlKGZpbGVQYXRoKSB7XHJcbiAgICAgICAgY29uc3QgZXh0ID0gcGF0aC5leHRuYW1lKGZpbGVQYXRoKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgIHJldHVybiB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMuaW5jbHVkZXMoZXh0KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IENvbnZlcnRlciBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGdldEluZm8oKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgbmFtZTogJ0V4Y2VsIENvbnZlcnRlcicsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbnM6IHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyxcclxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb252ZXJ0cyBFeGNlbCBmaWxlcyB0byBtYXJrZG93biB0YWJsZXMnLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgICBzaGVldDogJ1NwZWNpZmljIHNoZWV0IHRvIGNvbnZlcnQnLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZUFsbFNoZWV0czogJ0NvbnZlcnQgYWxsIHNoZWV0cyAoZGVmYXVsdDogdHJ1ZSknLFxyXG4gICAgICAgICAgICAgICAgbWF4Um93czogJ01heGltdW0gcm93cyB0byBjb252ZXJ0IHBlciBzaGVldCcsXHJcbiAgICAgICAgICAgICAgICB0aXRsZTogJ09wdGlvbmFsIGRvY3VtZW50IHRpdGxlJyxcclxuICAgICAgICAgICAgICAgIHhsc3hPcHRpb25zOiAnQWRkaXRpb25hbCBYTFNYIHBhcnNpbmcgb3B0aW9ucydcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gWGxzeENvbnZlcnRlcjtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8s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