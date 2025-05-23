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
const { formatMetadata, cleanMetadata } = require('../../../utils/markdown');

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
    async handleConvert(event, { filePath, buffer, options = {} }) {
        try {
            const conversionId = this.generateConversionId();
            const window = event?.sender?.getOwnerBrowserWindow?.() || null;
            
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
            
            // Notify client that conversion has started (only if we have a valid window)
            if (window && window.webContents) {
                window.webContents.send('docx:conversion-started', { conversionId });
            }
            
            let content;
            
            if (buffer) {
                content = Buffer.from(buffer);
            } else if (filePath) {
                this.updateConversionStatus(conversionId, 'reading_file', { progress: 10 });
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
            
            return { content: result };
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
    async handlePreview(event, { filePath, buffer, options = {} }) {
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
            
            return { content: result };
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
            
            this.updateConversionStatus(conversionId, 'extracting_content', { progress: 30 });
            
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
                styleMap: [
                    "p[style-name='Heading 1'] => # $1",
                    "p[style-name='Heading 2'] => ## $1",
                    "p[style-name='Heading 3'] => ### $1",
                    "p[style-name='Heading 4'] => #### $1",
                    "p[style-name='Heading 5'] => ##### $1",
                    "p[style-name='Heading 6'] => ###### $1",
                    "r[style-name='Strong'] => **$1**",
                    "r[style-name='Emphasis'] => *$1*",
                    "p[style-name='Quote'] => > $1",
                    "p[style-name='List Paragraph'] => * $1",
                    "table => $1",
                    "tr => $1",
                    "td => $1"
                ]
            };
            
            // Extract document metadata
            const metadata = await this.extractMetadata(content);
            
            // Convert DOCX to HTML
            const result = await mammoth.convertToHtml({ buffer: content }, mammothOptions);
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
                replacement: function(content, node) {
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
            
            // Get the title from metadata or filename
            const fileTitle = metadata.title || path.basename(fileName, path.extname(fileName));
            
            // Create standardized frontmatter using metadata utility
            const { createStandardFrontmatter } = require('../../../converters/utils/metadata');
            const frontmatter = createStandardFrontmatter({
                title: fileTitle,
                fileType: 'docx'
            });
            
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
            const result = await mammoth.extractRawText({ buffer: content });
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
