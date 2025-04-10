/**
 * PdfConverterFactory.js
 * Factory for creating appropriate PDF converters based on file and options.
 * 
 * This factory:
 * - Analyzes PDF files to determine the best conversion approach
 * - Creates instances of appropriate PDF converters
 * - Provides a unified interface for PDF conversion
 * - Handles fallback between different conversion methods
 * 
 * Related Files:
 * - BasePdfConverter.js: Base class for PDF converters
 * - StandardPdfConverter.js: Text-based PDF converter
 * - MistralPdfConverter.js: OCR-based PDF converter
 * - ConversionService.js: Uses this factory for PDF conversion
 */

const path = require('path');
const fs = require('fs-extra');
const StandardPdfConverter = require('./StandardPdfConverter');
const MistralPdfConverter = require('./MistralPdfConverter');

class PdfConverterFactory {
    constructor(fileProcessor, fileStorage, openAIProxy) {
        this.fileProcessor = fileProcessor;
        this.fileStorage = fileStorage;
        this.openAIProxy = openAIProxy;
        this.supportedExtensions = ['.pdf'];
        
        // Create converter instances
        this.standardConverter = new StandardPdfConverter(fileProcessor, fileStorage);
        this.mistralConverter = new MistralPdfConverter(fileProcessor, fileStorage, openAIProxy);
    }

    /**
     * Get appropriate converter for PDF file
     * @param {string} filePath - Path to PDF file
     * @param {Object} options - Conversion options
     * @returns {BasePdfConverter} Appropriate PDF converter
     */
    async getConverter(filePath, options = {}) {
        // If force option is specified, use the requested converter
        if (options.forceOcr) {
            console.log('[PdfConverterFactory] Using OCR converter (forced)');
            return this.mistralConverter;
        }
        
        if (options.forceStandard) {
            console.log('[PdfConverterFactory] Using standard converter (forced)');
            return this.standardConverter;
        }
        
        // Check if OCR is available
        const ocrAvailable = await this.isOcrAvailable();
        if (!ocrAvailable) {
            console.log('[PdfConverterFactory] OCR not available, using standard converter');
            return this.standardConverter;
        }
        
        // Analyze PDF to determine if OCR is needed
        const needsOcr = await this.analyzeNeedsOcr(filePath);
        if (needsOcr) {
            console.log('[PdfConverterFactory] PDF analysis suggests OCR is needed');
            return this.mistralConverter;
        }
        
        console.log('[PdfConverterFactory] Using standard converter based on analysis');
        return this.standardConverter;
    }

    /**
     * Check if OCR is available
     * @returns {Promise<boolean>} True if OCR is available
     */
    async isOcrAvailable() {
        try {
            const result = await this.mistralConverter.handleCheckApiKey();
            return result.valid;
        } catch (error) {
            console.error('[PdfConverterFactory] Error checking OCR availability:', error);
            return false;
        }
    }

    /**
     * Analyze PDF to determine if OCR is needed
     * @param {string} filePath - Path to PDF file
     * @returns {Promise<boolean>} True if OCR is recommended
     */
    async analyzeNeedsOcr(filePath) {
        try {
            // Extract text using standard converter
            const pdfData = await fs.readFile(filePath);
            const pdfParse = require('pdf-parse');
            const data = await pdfParse(pdfData);
            
            // Check if text extraction yielded meaningful results
            const textLength = data.text.trim().length;
            const pageCount = data.numpages;
            
            // Calculate average text per page
            const avgTextPerPage = textLength / pageCount;
            
            // If very little text was extracted, OCR might be needed
            if (avgTextPerPage < 100) {
                console.log(`[PdfConverterFactory] Low text content detected (${avgTextPerPage.toFixed(2)} chars/page), suggesting OCR`);
                return true;
            }
            
            // Check for scanned document indicators
            const hasScannedIndicators = this.checkForScannedIndicators(data.text);
            if (hasScannedIndicators) {
                console.log('[PdfConverterFactory] Scanned document indicators detected, suggesting OCR');
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('[PdfConverterFactory] Error analyzing PDF:', error);
            // If analysis fails, default to standard converter
            return false;
        }
    }

    /**
     * Check for indicators that a document is scanned
     * @param {string} text - Extracted text
     * @returns {boolean} True if scanned indicators are found
     */
    checkForScannedIndicators(text) {
        // Common indicators in scanned documents
        const indicators = [
            'scanned',
            'scan',
            'ocr',
            'image',
            'digitized',
            'digitised'
        ];
        
        const lowerText = text.toLowerCase();
        return indicators.some(indicator => lowerText.includes(indicator));
    }

    /**
     * Convert PDF file to markdown
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Conversion request
     * @returns {Promise<Object>} Conversion result
     */
    async convertPdf(event, { filePath, options = {} }) {
        try {
            const converter = await this.getConverter(filePath, options);
            
            // Use the appropriate conversion method
            if (converter === this.mistralConverter) {
                return await converter.handleConvert(event, { filePath, options });
            } else {
                return await converter.handleConvert(event, { filePath, options });
            }
        } catch (error) {
            console.error('[PdfConverterFactory] Conversion failed:', error);
            throw error;
        }
    }

    /**
     * Get PDF metadata
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Metadata request
     * @returns {Promise<Object>} PDF metadata
     */
    async getPdfMetadata(event, { filePath }) {
        try {
            // For metadata, we can always use the standard converter
            return await this.standardConverter.handleGetMetadata(event, { filePath });
        } catch (error) {
            console.error('[PdfConverterFactory] Failed to get metadata:', error);
            throw error;
        }
    }

    /**
     * Check if this factory supports the given file
     * @param {string} filePath - Path to file
     * @returns {boolean} True if supported
     */
    supportsFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.supportedExtensions.includes(ext);
    }

    /**
     * Get factory information
     * @returns {Object} Factory details
     */
    getInfo() {
        return {
            name: 'PDF Converter Factory',
            extensions: this.supportedExtensions,
            description: 'Factory for PDF converters with automatic selection',
            converters: [
                this.standardConverter.getInfo(),
                this.mistralConverter.getInfo()
            ],
            options: {
                forceOcr: 'Force use of OCR converter',
                forceStandard: 'Force use of standard converter'
            }
        };
    }
}

module.exports = PdfConverterFactory;
