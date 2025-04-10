/**
 * MistralPdfConverter.js
 * Handles conversion of PDF files to markdown using Mistral OCR.
 * 
 * This converter:
 * - Uses Mistral AI for OCR processing of PDF documents
 * - Handles scanned documents and images within PDFs
 * - Extracts text that standard PDF parsers might miss
 * - Creates structured markdown with high-quality text extraction
 * 
 * Related Files:
 * - BasePdfConverter.js: Parent class with common PDF functionality
 * - StandardPdfConverter.js: Alternative text-based converter
 * - FileStorageService.js: For temporary file management
 * - PdfConverterFactory.js: Factory for selecting appropriate converter
 */

const path = require('path');
const fs = require('fs-extra');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');
const BasePdfConverter = require('./BasePdfConverter');

class MistralPdfConverter extends BasePdfConverter {
    constructor(fileProcessor, fileStorage, openAIProxy) {
        super(fileProcessor, fileStorage);
        this.openAIProxy = openAIProxy;
        this.name = 'Mistral PDF Converter';
        this.description = 'Converts PDF files to markdown using Mistral OCR';
        this.apiEndpoint = process.env.MISTRAL_API_ENDPOINT || 'https://api.mistral.ai/v1/ocr';
        this.apiKey = process.env.MISTRAL_API_KEY;
    }

    /**
     * Set up IPC handlers for PDF conversion
     */
    setupIpcHandlers() {
        this.registerHandler('convert:pdf:ocr', this.handleConvert.bind(this));
        this.registerHandler('convert:pdf:ocr:metadata', this.handleGetMetadata.bind(this));
        this.registerHandler('convert:pdf:ocr:check', this.handleCheckApiKey.bind(this));
    }

    /**
     * Handle PDF conversion request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Conversion request details
     */
    async handleConvert(event, { filePath, options = {} }) {
        try {
            // Check if API key is available
            if (!this.apiKey) {
                throw new Error('Mistral API key not configured');
            }
            
            const conversionId = this.generateConversionId();
            const window = event.sender.getOwnerBrowserWindow();
            
            // Create temp directory for this conversion
            const tempDir = await this.fileStorage.createTempDir('pdf_ocr_conversion');
            
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
                console.error(`[MistralPdfConverter] Conversion failed for ${conversionId}:`, error);
                this.updateConversionStatus(conversionId, 'failed', { error: error.message });
                
                // Clean up temp directory
                fs.remove(tempDir).catch(err => {
                    console.error(`[MistralPdfConverter] Failed to clean up temp directory: ${tempDir}`, err);
                });
            });

            return { conversionId };
        } catch (error) {
            console.error('[MistralPdfConverter] Failed to start conversion:', error);
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
            // For metadata, we can use the standard PDF parser
            const standardConverter = new (require('./StandardPdfConverter'))(
                this.fileProcessor,
                this.fileStorage
            );
            
            const metadata = await standardConverter.extractMetadata(filePath);
            return metadata;
        } catch (error) {
            console.error('[MistralPdfConverter] Failed to get metadata:', error);
            throw error;
        }
    }

    /**
     * Handle API key check request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     */
    async handleCheckApiKey(event) {
        try {
            if (!this.apiKey) {
                return { valid: false, error: 'API key not configured' };
            }
            
            // Make a simple request to check if the API key is valid
            const response = await fetch(`${this.apiEndpoint}/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                return { valid: true };
            } else {
                const error = await response.json();
                return { valid: false, error: error.error?.message || 'Invalid API key' };
            }
        } catch (error) {
            console.error('[MistralPdfConverter] API key check failed:', error);
            return { valid: false, error: error.message };
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
            const standardConverter = new (require('./StandardPdfConverter'))(
                this.fileProcessor,
                this.fileStorage
            );
            const metadata = await standardConverter.extractMetadata(filePath);
            
            // Process with OCR
            this.updateConversionStatus(conversionId, 'processing_ocr', { progress: 10 });
            const ocrResult = await this.processWithOcr(filePath, options);
            
            // Generate markdown
            this.updateConversionStatus(conversionId, 'generating_markdown', { progress: 90 });
            const markdown = this.generateMarkdown(metadata, ocrResult, options);
            
            // Clean up temp directory
            await fs.remove(tempDir);
            
            this.updateConversionStatus(conversionId, 'completed', { 
                progress: 100,
                result: markdown
            });
            
            return markdown;
        } catch (error) {
            console.error('[MistralPdfConverter] Conversion processing failed:', error);
            throw error;
        }
    }

    /**
     * Process PDF with Mistral OCR
     * @param {string} filePath - Path to PDF file
     * @param {Object} options - Conversion options
     * @returns {Promise<Object>} OCR result
     */
    async processWithOcr(filePath, options) {
        try {
            const form = new FormData();
            
            // Add file
            form.append('file', fs.createReadStream(filePath));
            
            // Add options
            form.append('model', options.model || 'mistral-large-ocr');
            
            if (options.language) {
                form.append('language', options.language);
            }
            
            // Make API request
            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    ...form.getHeaders()
                },
                body: form
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || `OCR request failed with status ${response.status}`);
            }
            
            const result = await response.json();
            return this.processOcrResult(result);
        } catch (error) {
            console.error('[MistralPdfConverter] OCR processing failed:', error);
            throw error;
        }
    }

    /**
     * Process OCR result
     * @param {Object} result - OCR API result
     * @returns {Object} Processed result
     */
    processOcrResult(result) {
        // This is a placeholder for processing the OCR result
        // The actual implementation would depend on the Mistral API response format
        
        // For now, we'll assume a simple format with pages
        const pages = result.pages || [];
        
        return {
            pages: pages.map(page => ({
                pageNumber: page.page_number,
                text: page.text,
                confidence: page.confidence
            }))
        };
    }

    /**
     * Generate markdown from PDF metadata and OCR result
     * @param {Object} metadata - PDF metadata
     * @param {Object} ocrResult - OCR result
     * @param {Object} options - Conversion options
     * @returns {string} Markdown content
     */
    generateMarkdown(metadata, ocrResult, options) {
        // Start with header
        const markdown = this.generateMarkdownHeader(metadata, options);
        
        // Add OCR information
        markdown.push('## OCR Information');
        markdown.push('');
        markdown.push('This document was processed using Mistral OCR technology.');
        markdown.push('');
        
        // Add content for each page
        if (ocrResult.pages && ocrResult.pages.length > 0) {
            ocrResult.pages.forEach(page => {
                markdown.push(`## Page ${page.pageNumber}`);
                markdown.push('');
                
                if (page.confidence) {
                    markdown.push(`> OCR Confidence: ${Math.round(page.confidence * 100)}%`);
                    markdown.push('');
                }
                
                // Add page text
                markdown.push(page.text);
                markdown.push('');
            });
        } else {
            markdown.push('No text content was extracted from this document.');
        }
        
        return markdown.join('\n');
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
                model: 'OCR model to use (default: mistral-large-ocr)',
                language: 'Language hint for OCR (optional)',
                maxPages: 'Maximum pages to convert (default: all)'
            }
        };
    }
}

module.exports = MistralPdfConverter;
