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
            const response = { content: result };
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
                    relax_column_count: true, // Handle inconsistent column counts
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
