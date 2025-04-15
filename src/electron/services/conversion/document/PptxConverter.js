/**
 * PptxConverter.js
 * Handles conversion of PPTX files to markdown format in the Electron main process.
 * 
 * This converter:
 * - Parses PPTX files using officeparser
 * - Extracts text, slides, and notes
 * - Generates clean markdown output with slide structure
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - FileProcessorService.js: Used for file operations
 * - ConversionService.js: Registers and uses this converter
 */

const path = require('path');
const fs = require('fs-extra');
const BaseService = require('../../BaseService');
const { formatMetadata, cleanMetadata } = require('../../../utils/markdown');
const officeparser = require('officeparser');

class PptxConverter extends BaseService {
    constructor(fileProcessor, fileStorage) {
        super();
        this.fileProcessor = fileProcessor;
        this.fileStorage = fileStorage;
        this.supportedExtensions = ['.pptx', '.ppt'];
        this.activeConversions = new Map();
    }
    
    /**
     * Set up IPC handlers for PPTX conversion
     */
    setupIpcHandlers() {
        this.registerHandler('convert:pptx', this.handleConvert.bind(this));
        this.registerHandler('convert:pptx:preview', this.handlePreview.bind(this));
    }
    
    /**
     * Generate a unique conversion ID
     * @returns {string} Unique conversion ID
     */
    generateConversionId() {
        return `pptx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
                conversion.window.webContents.send('pptx:conversion-progress', {
                    conversionId,
                    status,
                    ...details
                });
            }
        }
    }
    
    /**
     * Handle PPTX conversion request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Conversion request details
     */
    async handleConvert(event, { filePath, buffer, options = {} }) {
        try {
            const conversionId = this.generateConversionId();
            const window = event.sender.getOwnerBrowserWindow();
            
            // Create temp directory for this conversion
            const tempDir = await this.fileStorage.createTempDir('pptx_conversion');
            
            this.activeConversions.set(conversionId, {
                id: conversionId,
                status: 'starting',
                progress: 0,
                filePath,
                tempDir,
                window
            });
            
            // Notify client that conversion has started
            window.webContents.send('pptx:conversion-started', { conversionId });
            
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
                fileName: options.originalFileName || options.name || path.basename(filePath || 'presentation.pptx')
            });
            
            return { content: result };
        } catch (error) {
            console.error('[PptxConverter] Conversion failed:', error);
            throw error;
        }
    }

    /**
     * Handle PPTX preview request
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
                fileName: options.originalFileName || options.name || path.basename(filePath || 'presentation.pptx')
            });
            
            return { content: result };
        } catch (error) {
            console.error('[PptxConverter] Preview generation failed:', error);
            throw error;
        }
    }
    
    /**
     * Process PPTX conversion
     * @param {string} conversionId - Conversion identifier
     * @param {Buffer} content - PPTX content as buffer
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
                    console.error(`[PptxConverter] Failed to clean up temp directory: ${conversion.tempDir}`, err);
                });
            }
            
            return result;
        } catch (error) {
            console.error('[PptxConverter] Conversion processing failed:', error);
            
            // Clean up temp directory
            const conversion = this.activeConversions.get(conversionId);
            if (conversion && conversion.tempDir) {
                await fs.remove(conversion.tempDir).catch(err => {
                    console.error(`[PptxConverter] Failed to clean up temp directory: ${conversion.tempDir}`, err);
                });
            }
            
            throw error;
        }
    }

    /**
     * Convert PPTX content to markdown
     * @param {Buffer} content - PPTX content as buffer
     * @param {Object} options - Conversion options
     * @returns {Promise<string>} Markdown content
     */
    async convertToMarkdown(content, options = {}) {
        try {
            const fileName = options.fileName || 'presentation.pptx';
            const isPreview = options.isPreview || false;
            
            // Create a temporary file to process
            const tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'pptx-conversion-'));
            const tempFile = path.join(tempDir, `${options.name || 'presentation'}.pptx`);
            
            // Write buffer to temp file
            await fs.writeFile(tempFile, content);
            
            // Configure officeparser options
            const parserConfig = {
                newlineDelimiter: '\n',
                ignoreNotes: false,
                putNotesAtLast: false,
                outputErrorToConsole: false
            };
            
            // Extract text using officeparser
            const extractedText = await officeparser.parseOfficeAsync(tempFile, parserConfig);
            
            // Process the extracted text to create slides
            const slides = this.processExtractedText(extractedText);
            
            // Get file stats for metadata
            const stats = await fs.stat(tempFile);
            
            // Extract basic metadata
            const metadata = {
                title: path.basename(fileName, path.extname(fileName)),
                author: '',
                date: new Date().toISOString().split('T')[0],
                subject: '',
                slideCount: slides.length,
                fileSize: stats.size
            };
            
            // Generate markdown content
            let markdownContent = '';
            
            // Process each slide
            slides.forEach((slide, index) => {
                markdownContent += `## Slide ${index + 1}: ${slide.title || 'Untitled Slide'}\n\n`;
                
                // Add slide content
                if (slide.content && slide.content.length > 0) {
                    markdownContent += `${slide.content}\n\n`;
                }
                
                // Add slide notes if available
                if (slide.notes && slide.notes.length > 0) {
                    markdownContent += `> **Notes:** ${slide.notes}\n\n`;
                }
                
                // Add separator between slides
                markdownContent += `---\n\n`;
            });
            
            // Clean up temp directory
            await fs.remove(tempDir);
            
            // Get current datetime
            const now = new Date();
            const convertedDate = now.toISOString().split('.')[0].replace('T', ' ');
            
            // Get the title from metadata or filename
            const fileTitle = metadata.title || path.basename(fileName, path.extname(fileName));
            
            // Create standardized frontmatter
            const frontmatter = [
                '---',
                `title: ${fileTitle}`,
                `converted: ${convertedDate}`,
                'type: pptx',
                '---',
                ''
            ].join('\n');
            
            // Combine frontmatter and content
            return frontmatter + markdownContent;
        } catch (error) {
            console.error('[PptxConverter] Markdown conversion failed:', error);
            throw error;
        }
    }
    
    /**
     * Process extracted text into slides
     * @param {string} extractedText - Text extracted from PPTX
     * @returns {Array} Array of slide objects
     */
    processExtractedText(extractedText) {
        // Split the text by slide markers or other patterns
        // This is a simple implementation and might need refinement based on actual output
        const slideTexts = extractedText.split(/(?:Slide \d+:?)/i).filter(text => text.trim().length > 0);
        
        return slideTexts.map(slideText => {
            // Try to extract a title from the first line
            const lines = slideText.trim().split('\n');
            const title = lines[0] || 'Untitled Slide';
            
            // Check if there are notes (indicated by "Notes:" or similar)
            const notesIndex = slideText.indexOf('Notes:');
            let content = '';
            let notes = '';
            
            if (notesIndex > -1) {
                content = slideText.substring(0, notesIndex).trim();
                notes = slideText.substring(notesIndex + 6).trim();
            } else {
                content = slideText.trim();
            }
            
            return {
                title: title,
                content: content,
                notes: notes
            };
        });
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
            name: 'PPTX Converter',
            extensions: this.supportedExtensions,
            description: 'Converts PPTX files to markdown',
            options: {
                title: 'Optional presentation title',
                isPreview: 'Whether to generate a preview (default: false)'
            }
        };
    }
}

module.exports = PptxConverter;
