/**
 * StandardPdfConverter.js
 * Handles conversion of PDF files to markdown using standard text extraction.
 * 
 * This converter:
 * - Uses pdf-lib and pdf-parse for PDF processing
 * - Extracts text and metadata from PDF documents
 * - Generates page thumbnails when requested
 * - Creates structured markdown output
 * 
 * Related Files:
 * - BasePdfConverter.js: Parent class with common PDF functionality
 * - MistralPdfConverter.js: Alternative OCR-based converter
 * - FileStorageService.js: For temporary file management
 * - PdfConverterFactory.js: Factory for selecting appropriate converter
 */

const path = require('path');
const fs = require('fs-extra');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');
const BasePdfConverter = require('./BasePdfConverter');

class StandardPdfConverter extends BasePdfConverter {
    constructor(fileProcessor, fileStorage, skipHandlerSetup = false) {
        super(fileProcessor, fileStorage);
        this.name = 'Standard PDF Converter';
        this.description = 'Converts PDF files to markdown using standard text extraction';
        this.skipHandlerSetup = skipHandlerSetup;
        
        // Log whether handlers will be set up
        if (skipHandlerSetup) {
            console.log('[StandardPdfConverter] Skipping handler setup (skipHandlerSetup=true)');
        }
    }

    /**
     * Set up IPC handlers for PDF conversion
     */
    setupIpcHandlers() {
        this.registerHandler('convert:pdf:standard', this.handleConvert.bind(this));
        this.registerHandler('convert:pdf:standard:metadata', this.handleGetMetadata.bind(this));
        this.registerHandler('convert:pdf:standard:thumbnail', this.handleGenerateThumbnail.bind(this));
    }

    /**
     * Handle PDF conversion request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Conversion request details
     */
    async handleConvert(event, { filePath, options = {} }) {
        try {
            const conversionId = this.generateConversionId();
            const window = event.sender.getOwnerBrowserWindow();
            
            // Create temp directory for this conversion
            const tempDir = await this.fileStorage.createTempDir('pdf_conversion');
            
            this.activeConversions.set(conversionId, {
                id: conversionId,
                status: 'starting',
                progress: 0,
                filePath,
                tempDir,
                window
            });

            // Notify client that conversion has started
            window.webContents.send('pdf:conversion-started', { conversionId });

            // Start conversion process
            this.processConversion(conversionId, filePath, options).catch(error => {
                console.error(`[StandardPdfConverter] Conversion failed for ${conversionId}:`, error);
                this.updateConversionStatus(conversionId, 'failed', { error: error.message });
                
                // Clean up temp directory
                fs.remove(tempDir).catch(err => {
                    console.error(`[StandardPdfConverter] Failed to clean up temp directory: ${tempDir}`, err);
                });
            });

            return { conversionId };
        } catch (error) {
            console.error('[StandardPdfConverter] Failed to start conversion:', error);
            throw error;
        }
    }

    /**
     * Handle PDF metadata request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Metadata request details
     */
    async handleGetMetadata(event, { filePath }) {
        try {
            const metadata = await this.extractMetadata(filePath);
            return metadata;
        } catch (error) {
            console.error('[StandardPdfConverter] Failed to get metadata:', error);
            throw error;
        }
    }

    /**
     * Handle PDF thumbnail generation request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Thumbnail request details
     */
    async handleGenerateThumbnail(event, { filePath, pageNumber = 1, options = {} }) {
        try {
            const tempDir = await this.fileStorage.createTempDir('pdf_thumbnail');
            const thumbnailPath = path.join(tempDir, `page_${pageNumber}.png`);
            
            await this.generatePageThumbnail(filePath, thumbnailPath, pageNumber, options);
            
            // Read the thumbnail as base64
            const thumbnailData = await fs.readFile(thumbnailPath, { encoding: 'base64' });
            
            // Clean up temp directory
            await fs.remove(tempDir);
            
            return {
                data: `data:image/png;base64,${thumbnailData}`,
                pageNumber
            };
        } catch (error) {
            console.error('[StandardPdfConverter] Failed to generate thumbnail:', error);
            throw error;
        }
    }

    /**
     * Process PDF conversion
     * @param {string} conversionId - Conversion identifier
     * @param {string} filePath - Path to PDF file
     * @param {Object} options - Conversion options
     */
    async processConversion(conversionId, filePath, options) {
        try {
            const conversion = this.activeConversions.get(conversionId);
            if (!conversion) {
                throw new Error('Conversion not found');
            }
            
            const tempDir = conversion.tempDir;
            
            // Extract metadata
            this.updateConversionStatus(conversionId, 'extracting_metadata', { progress: 5 });
            const metadata = await this.extractMetadata(filePath);
            
            // Extract text
            this.updateConversionStatus(conversionId, 'extracting_text', { progress: 10 });
            const pdfData = await fs.readFile(filePath);
            const pdfContent = await pdfParse(pdfData);
            
            // Process pages
            this.updateConversionStatus(conversionId, 'processing_pages', { progress: 30 });
            const maxPages = options.maxPages || metadata.pageCount;
            const pages = await this.extractPages(filePath, pdfContent, Math.min(maxPages, metadata.pageCount));
            
            // Generate thumbnails if requested
            let thumbnails = [];
            if (options.includeImages) {
                this.updateConversionStatus(conversionId, 'generating_thumbnails', { progress: 50 });
                thumbnails = await this.generateThumbnails(filePath, tempDir, Math.min(maxPages, metadata.pageCount));
            }
            
            // Generate markdown
            this.updateConversionStatus(conversionId, 'generating_markdown', { progress: 80 });
            const markdown = this.generateMarkdown(metadata, pages, thumbnails, options);
            
            // Clean up temp directory
            await fs.remove(tempDir);
            
            this.updateConversionStatus(conversionId, 'completed', { 
                progress: 100,
                result: markdown
            });
            
            return markdown;
        } catch (error) {
            console.error('[StandardPdfConverter] Conversion processing failed:', error);
            throw error;
        }
    }

    /**
     * Extract metadata from PDF file
     * @param {string} filePath - Path to PDF file
     * @returns {Promise<Object>} PDF metadata
     */
    async extractMetadata(filePath) {
        try {
            const pdfData = await fs.readFile(filePath);
            const pdfDoc = await PDFDocument.load(pdfData);
            const pdfContent = await pdfParse(pdfData);
            
            const stats = await fs.stat(filePath);
            
            // Extract metadata
            const metadata = {
                filename: path.basename(filePath),
                pageCount: pdfDoc.getPageCount(),
                fileSize: stats.size,
                ...pdfContent.info
            };
            
            // Format dates
            if (metadata.CreationDate) {
                metadata.creationDate = this.formatPdfDate(metadata.CreationDate);
                delete metadata.CreationDate;
            }
            
            if (metadata.ModDate) {
                metadata.modificationDate = this.formatPdfDate(metadata.ModDate);
                delete metadata.ModDate;
            }
            
            // Rename standard fields
            if (metadata.Author) {
                metadata.author = metadata.Author;
                delete metadata.Author;
            }
            
            if (metadata.Title) {
                metadata.title = metadata.Title;
                delete metadata.Title;
            }
            
            if (metadata.Subject) {
                metadata.subject = metadata.Subject;
                delete metadata.Subject;
            }
            
            if (metadata.Keywords) {
                metadata.keywords = metadata.Keywords;
                delete metadata.Keywords;
            }
            
            if (metadata.Creator) {
                metadata.creator = metadata.Creator;
                delete metadata.Creator;
            }
            
            if (metadata.Producer) {
                metadata.producer = metadata.Producer;
                delete metadata.Producer;
            }
            
            return metadata;
        } catch (error) {
            console.error('[StandardPdfConverter] Failed to extract metadata:', error);
            throw error;
        }
    }

    /**
     * Format PDF date string
     * @param {string} dateString - PDF date string
     * @returns {string} Formatted date
     */
    formatPdfDate(dateString) {
        try {
            // PDF dates can be in format: D:YYYYMMDDHHmmSSOHH'mm'
            if (dateString.startsWith('D:')) {
                dateString = dateString.substring(2);
            }
            
            // Try to parse the date
            const year = dateString.substring(0, 4);
            const month = dateString.substring(4, 6);
            const day = dateString.substring(6, 8);
            
            return `${year}-${month}-${day}`;
        } catch (error) {
            return dateString;
        }
    }

    /**
     * Extract pages from PDF content
     * @param {string} filePath - Path to PDF file
     * @param {Object} pdfContent - PDF content from pdf-parse
     * @param {number} maxPages - Maximum pages to extract
     * @returns {Promise<Array>} Array of page objects
     */
    async extractPages(filePath, pdfContent, maxPages) {
        try {
            const pdfData = await fs.readFile(filePath);
            const pdfDoc = await PDFDocument.load(pdfData);
            
            const pages = [];
            const totalPages = pdfDoc.getPageCount();
            
            // Split text into pages (pdf-parse gives us all text)
            // This is a simple approach and might not be perfect
            const textPerPage = Math.ceil(pdfContent.text.length / totalPages);
            
            for (let i = 0; i < Math.min(totalPages, maxPages); i++) {
                const page = pdfDoc.getPage(i);
                const { width, height } = page.getSize();
                
                const startIndex = i * textPerPage;
                const endIndex = Math.min((i + 1) * textPerPage, pdfContent.text.length);
                const text = pdfContent.text.substring(startIndex, endIndex).trim();
                
                pages.push({
                    pageNumber: i + 1,
                    width,
                    height,
                    text
                });
            }
            
            return pages;
        } catch (error) {
            console.error('[StandardPdfConverter] Failed to extract pages:', error);
            throw error;
        }
    }

    /**
     * Generate thumbnails for PDF pages
     * @param {string} filePath - Path to PDF file
     * @param {string} outputDir - Output directory
     * @param {number} pageCount - Number of pages
     * @returns {Promise<Array>} Array of thumbnail info objects
     */
    async generateThumbnails(filePath, outputDir, pageCount) {
        try {
            const thumbnails = [];
            console.log(`[StandardPdfConverter] Generating thumbnails for ${pageCount} pages`);
            
            // Load the PDF document
            const pdfData = await fs.readFile(filePath);
            const pdfDoc = await PDFDocument.load(pdfData);
            
            // Generate thumbnails for each page
            for (let i = 0; i < pageCount; i++) {
                const pageNumber = i + 1;
                const thumbnailPath = path.join(outputDir, `page_${pageNumber}.png`);
                
                try {
                    // Generate thumbnail for this page
                    await this.generatePageThumbnail(filePath, thumbnailPath, pageNumber);
                    
                    // Read the thumbnail as base64
                    const thumbnailData = await fs.readFile(thumbnailPath, { encoding: 'base64' });
                    
                    thumbnails.push({
                        pageNumber,
                        path: thumbnailPath,
                        data: `data:image/png;base64,${thumbnailData}`
                    });
                    
                    console.log(`[StandardPdfConverter] Generated thumbnail for page ${pageNumber}`);
                } catch (pageError) {
                    console.error(`[StandardPdfConverter] Failed to generate thumbnail for page ${pageNumber}:`, pageError);
                }
            }
            
            return thumbnails;
        } catch (error) {
            console.error('[StandardPdfConverter] Failed to generate thumbnails:', error);
            return [];
        }
    }

    /**
     * Generate a single page thumbnail
     * @param {string} filePath - Path to PDF file
     * @param {string} outputPath - Output path for thumbnail
     * @param {number} pageNumber - Page number
     * @param {Object} options - Thumbnail options
     * @returns {Promise<void>}
     */
    async generatePageThumbnail(filePath, outputPath, pageNumber, options = {}) {
        try {
            console.log(`[StandardPdfConverter] Generating thumbnail for page ${pageNumber}`);
            
            // Default options
            const width = options.width || 300;
            const height = options.height || 0; // Will be calculated to maintain aspect ratio
            const quality = options.quality || 0.8;
            
            // Import required modules
            const { createCanvas } = require('canvas');
            const pdfjsLib = require('@bundled-es-modules/pdfjs-dist');
            
            // Configure PDF.js
            pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('@bundled-es-modules/pdfjs-dist/build/pdf.worker.js');
            
            // Load the PDF document
            const data = await fs.readFile(filePath);
            const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
            
            // Get the requested page
            const page = await pdfDoc.getPage(pageNumber);
            
            // Get the original viewport
            const originalViewport = page.getViewport({ scale: 1.0 });
            
            // Calculate scale to fit the desired width
            const scale = width / originalViewport.width;
            
            // Create a viewport with the desired scale
            const viewport = page.getViewport({ scale });
            
            // Calculate height if not specified
            const finalHeight = height || Math.floor(viewport.height);
            
            // Create a canvas with the desired dimensions
            const canvas = createCanvas(width, finalHeight);
            const context = canvas.getContext('2d');
            
            // Set white background
            context.fillStyle = 'white';
            context.fillRect(0, 0, width, finalHeight);
            
            // Render the PDF page to the canvas
            await page.render({
                canvasContext: context,
                viewport
            }).promise;
            
            // Convert canvas to PNG buffer
            const buffer = canvas.toBuffer('image/png', { quality });
            
            // Write the buffer to the output file
            await fs.writeFile(outputPath, buffer);
            
            console.log(`[StandardPdfConverter] Thumbnail generated for page ${pageNumber} at ${outputPath}`);
        } catch (error) {
            console.error('[StandardPdfConverter] Failed to generate page thumbnail:', error);
            throw error;
        }
    }

    /**
     * Generate markdown from PDF metadata and pages
     * @param {Object} metadata - PDF metadata
     * @param {Array} pages - Array of page objects
     * @param {Array} thumbnails - Array of thumbnail info objects
     * @param {Object} options - Conversion options
     * @returns {string} Markdown content
     */
    generateMarkdown(metadata, pages, thumbnails, options) {
        // Start with header
        const markdown = this.generateMarkdownHeader(metadata, options);
        
        // Add content for each page
        pages.forEach((page, index) => {
            markdown.push(`## Page ${page.pageNumber}`);
            markdown.push('');
            
            // Add thumbnail if available
            if (thumbnails[index]) {
                markdown.push(`![Page ${page.pageNumber}](${thumbnails[index].data})`);
                markdown.push('');
            }
            
            // Add page text
            markdown.push(page.text);
            markdown.push('');
        });
        
        return markdown.join('\n');
    }

    /**
     * Convert PDF content to markdown - direct method for ConverterRegistry
     * @param {Buffer} content - PDF content as buffer
     * @param {string} name - File name
     * @param {string} apiKey - API key (not used for standard conversion)
     * @param {Object} options - Conversion options
     * @returns {Promise<Object>} Conversion result
     */
    async convertToMarkdown(content, options = {}) {
        try {
            console.log(`[StandardPdfConverter] Converting PDF: ${options.name || 'unnamed'}`);
            
            // Create a temporary file to process
            const tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'pdf-conversion-'));
            const tempFile = path.join(tempDir, `${options.name || 'document'}.pdf`);
            
            // Write buffer to temp file
            await fs.writeFile(tempFile, content);
            
            // Extract metadata
            const metadata = await this.extractMetadata(tempFile);
            
            // Extract text
            const pdfContent = await pdfParse(content);
            
            // Process pages
            const maxPages = options.maxPages || metadata.pageCount;
            const pages = await this.extractPages(tempFile, pdfContent, Math.min(maxPages, metadata.pageCount));
            
            // Generate thumbnails if requested
            let thumbnails = [];
            if (options.includeImages) {
                console.log('[StandardPdfConverter] Generating thumbnails for direct conversion');
                const tempImagesDir = path.join(tempDir, 'thumbnails');
                await fs.mkdir(tempImagesDir, { recursive: true });
                thumbnails = await this.generateThumbnails(tempFile, tempImagesDir, Math.min(maxPages, metadata.pageCount));
            }
            
            // Get current datetime
            const now = new Date();
            const convertedDate = now.toISOString().split('.')[0].replace('T', ' ');
            
            // Get the title from metadata or filename
            const fileTitle = metadata.title || options.name || 'PDF Document';
            
            // Create standardized frontmatter
            const frontmatter = [
                '---',
                `title: ${fileTitle}`,
                `converted: ${convertedDate}`,
                'type: pdf',
                '---',
                ''
            ].join('\n');
            
            // Generate markdown content
            const markdownContent = this.generateMarkdown(metadata, pages, thumbnails, options);
            
            // Combine frontmatter and content
            const finalMarkdown = frontmatter + markdownContent;
            
            // Clean up temp directory
            await fs.remove(tempDir);
            
            return {
                success: true,
                content: finalMarkdown,
                type: 'pdf',
                name: options.name || 'document.pdf',
                metadata: metadata
            };
        } catch (error) {
            console.error('[StandardPdfConverter] Direct conversion failed:', error);
            return {
                success: false,
                error: `PDF conversion failed: ${error.message}`,
                content: `# Conversion Error\n\nFailed to convert PDF: ${error.message}`
            };
        }
    }

    /**
     * Get converter information
     * @returns {Object} Converter details
     */
    getInfo() {
        return {
            name: this.name,
            extensions: this.supportedExtensions,
            description: this.description,
            options: {
                title: 'Optional document title',
                includeImages: 'Whether to include page images (default: false)',
                maxPages: 'Maximum pages to convert (default: all)'
            }
        };
    }
}

module.exports = StandardPdfConverter;
