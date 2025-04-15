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
        
        // Create converter instances - pass true for skipHandlerSetup
        // This prevents duplicate IPC handler registration when used through the factory
        this.standardConverter = new StandardPdfConverter(fileProcessor, fileStorage, true);
        this.mistralConverter = new MistralPdfConverter(fileProcessor, fileStorage, openAIProxy, true);
    }

    /**
     * Get appropriate converter for PDF file
     * @param {string} filePath - Path to PDF file
     * @param {Object} options - Conversion options
     * @returns {Object} Appropriate PDF converter with convert method
     */
    async getConverter(filePath, options = {}) {
        console.log('[PdfConverterFactory] Getting converter for PDF file');
        
        // Create a wrapper object that exposes the convert method
        const createConverterWrapper = (converter) => {
            return {
                convert: async (content, name, apiKey, options) => {
                    console.log(`[PdfConverterFactory] Using ${converter.name} for conversion`);
                    return await converter.convertToMarkdown(content, {
                        ...options,
                        name,
                        apiKey
                    });
                }
            };
        };
        // Check if OCR is explicitly enabled in options
        console.log('[PdfConverterFactory] Checking if OCR is enabled in options:', options);
        console.log(`[PdfConverterFactory] options.useOcr = ${options.useOcr} (type: ${typeof options.useOcr})`);
        
        if (options.useOcr) {
            console.log('[PdfConverterFactory] Using OCR converter (enabled in settings)');
            
            // Check if OCR is available
            const ocrAvailable = await this.isOcrAvailable();
            console.log(`[PdfConverterFactory] OCR available: ${ocrAvailable}`);
            
            if (!ocrAvailable) {
                console.log('[PdfConverterFactory] OCR not available despite being enabled, using standard converter');
                return createConverterWrapper(this.standardConverter);
            }
            
            console.log('[PdfConverterFactory] OCR is available, using Mistral converter');
            return createConverterWrapper(this.mistralConverter);
        } else {
            console.log('[PdfConverterFactory] OCR is not enabled in options, checking other conditions');
        }
        
        // If force option is specified, use the requested converter
        if (options.forceOcr) {
            console.log('[PdfConverterFactory] Using OCR converter (forced)');
            return createConverterWrapper(this.mistralConverter);
        }
        
        if (options.forceStandard) {
            console.log('[PdfConverterFactory] Using standard converter (forced)');
            return createConverterWrapper(this.standardConverter);
        }
        
        // Check if OCR is available
        const ocrAvailable = await this.isOcrAvailable();
        if (!ocrAvailable) {
            console.log('[PdfConverterFactory] OCR not available, using standard converter');
            return createConverterWrapper(this.standardConverter);
        }
        
        // Analyze PDF to determine if OCR is needed
        const needsOcr = await this.analyzeNeedsOcr(filePath);
        if (needsOcr) {
            console.log('[PdfConverterFactory] PDF analysis suggests OCR is needed');
            return createConverterWrapper(this.mistralConverter);
        }
        
        console.log('[PdfConverterFactory] Using standard converter based on analysis');
        return createConverterWrapper(this.standardConverter);
    }

    /**
     * Check if OCR is available
     * @returns {Promise<boolean>} True if OCR is available
     */
    async isOcrAvailable() {
        try {
            console.log('[PdfConverterFactory] Checking OCR availability');
            
            // Check if mistralConverter is initialized
            if (!this.mistralConverter) {
                console.error('[PdfConverterFactory] MistralPdfConverter not initialized');
                return false;
            }
            
            // Check if API key is available
            if (!this.mistralConverter.apiKey) {
                console.log('[PdfConverterFactory] No Mistral API key found in converter');
                return false;
            }
            
            console.log('[PdfConverterFactory] Calling handleCheckApiKey');
            const result = await this.mistralConverter.handleCheckApiKey();
            console.log('[PdfConverterFactory] OCR availability check result:', result);
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
            console.log('[PdfConverterFactory] Converting PDF with options:', {
                useOcr: options.useOcr,
                hasMistralApiKey: !!options.mistralApiKey,
                forceOcr: options.forceOcr,
                forceStandard: options.forceStandard
            });
            
            // If Mistral API key is provided in options, set it on the converter
            if (options.mistralApiKey && this.mistralConverter) {
                console.log('[PdfConverterFactory] Setting Mistral API key from options');
                this.mistralConverter.apiKey = options.mistralApiKey;
            }
            
            const converter = await this.getConverter(filePath, options);
            
            // Log which converter we're using
            console.log(`[PdfConverterFactory] Using converter: ${converter.name}`);
            
            // Use the appropriate conversion method
            return await converter.handleConvert(event, { filePath, options });
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
