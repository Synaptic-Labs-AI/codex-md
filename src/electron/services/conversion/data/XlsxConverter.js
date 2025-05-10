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
    async handleConvert(event, { filePath, options = {} }) {
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

            return { content: result };
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
    async handlePreview(event, { filePath, options = {} }) {
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

            return { content: result };
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
    async handleGetInfo(event, { filePath }) {
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
                    data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
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
