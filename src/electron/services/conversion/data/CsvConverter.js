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
const { parse } = require('csv-parse/sync');
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
    async handleConvert(event, { filePath, options = {} }) {
        try {
            const content = await this.fileProcessor.handleFileRead(null, {
                filePath,
                encoding: options.encoding || 'utf8'
            });

            const result = await this.convertToMarkdown(content.content, options);
            return { content: result };
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
    async handlePreview(event, { filePath, options = {} }) {
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

            return { content: result };
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
            const records = parse(content, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                ...options.csvOptions
            });

            if (records.length === 0) {
                return '> No data found in CSV file.';
            }

            const headers = Object.keys(records[0]);
            if (headers.length === 0) {
                return '> No columns found in CSV file.';
            }

            // Build markdown table
            let markdown = [];

            // Add title if provided
            if (options.title) {
                markdown.push(`# ${options.title}\n`);
            }

            // Add metadata
            markdown.push(`> CSV Data${options.preview ? ' (Preview)' : ''}\n`);
            markdown.push(`> - Columns: ${headers.length}`);
            markdown.push(`> - Rows: ${records.length}`);
            markdown.push('');

            // Build table header
            markdown.push('| ' + headers.join(' | ') + ' |');
            markdown.push('| ' + headers.map(() => '---').join(' | ') + ' |');

            // Build table rows
            records.forEach(record => {
                const row = headers.map(header => {
                    const cell = record[header] || '';
                    // Escape pipe characters and handle line breaks
                    return cell.toString().replace(/\|/g, '\\|').replace(/\n/g, '<br>');
                });
                markdown.push('| ' + row.join(' | ') + ' |');
            });

            return markdown.join('\n');
        } catch (error) {
            console.error('[CsvConverter] Markdown conversion failed:', error);
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
