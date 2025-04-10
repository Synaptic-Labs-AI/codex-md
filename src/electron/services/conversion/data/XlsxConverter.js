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
            const workbook = xlsx.readFile(filePath, {
                cellDates: true,
                ...options.xlsxOptions
            });

            const result = await this.convertToMarkdown(workbook, {
                ...options,
                includeAllSheets: true
            });

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
            const markdown = [];
            const sheets = options.includeAllSheets ? 
                workbook.SheetNames : 
                [options.sheet || workbook.SheetNames[0]];

            // Add title if provided
            if (options.title) {
                markdown.push(`# ${options.title}\n`);
            }

            // Add document properties
            if (workbook.Props) {
                markdown.push('> Excel Document Properties');
                if (workbook.Props.Title) markdown.push(`> - Title: ${workbook.Props.Title}`);
                if (workbook.Props.Author) markdown.push(`> - Author: ${workbook.Props.Author}`);
                if (workbook.Props.CreatedDate) markdown.push(`> - Created: ${workbook.Props.CreatedDate}`);
                markdown.push('');
            }

            // Process each sheet
            for (const sheetName of sheets) {
                const sheet = workbook.Sheets[sheetName];
                const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

                if (data.length === 0) {
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

                // Get headers (first row)
                const headers = data[0].map(h => (h || '').toString());

                // Build table header
                markdown.push('| ' + headers.map(h => h || ' ').join(' | ') + ' |');
                markdown.push('| ' + headers.map(() => '---').join(' | ') + ' |');

                // Build table rows
                const maxRows = options.maxRows || data.length;
                for (let i = 1; i < Math.min(data.length, maxRows + 1); i++) {
                    const row = data[i];
                    const formattedRow = headers.map((_, index) => {
                        const cell = row ? row[index] : '';
                        return this.formatCell(cell);
                    });
                    markdown.push('| ' + formattedRow.join(' | ') + ' |');
                }

                markdown.push(''); // Add space between sheets
            }

            return markdown.join('\n');
        } catch (error) {
            console.error('[XlsxConverter] Markdown conversion failed:', error);
            throw error;
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

        const str = value.toString();
        return str.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
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
