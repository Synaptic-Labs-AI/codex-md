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
const BasePdfConverter = require('./BasePdfConverter');
const mistral = require('./mistral');

class MistralPdfConverter extends BasePdfConverter {
  constructor(fileProcessor, fileStorage, unusedParam, skipHandlerSetup = false) {
    super(fileProcessor, fileStorage);
    this.name = 'Mistral PDF Converter';
    this.description = 'Converts PDF files to markdown using Mistral OCR';
    this.skipHandlerSetup = skipHandlerSetup;
    
    // Initialize modular components
    this.apiClient = new mistral.MistralApiClient({
      apiEndpoint: process.env.MISTRAL_API_ENDPOINT,
      apiKey: process.env.MISTRAL_API_KEY
    });
    
    this.ocrProcessor = new mistral.OcrProcessor();
    this.markdownGenerator = new mistral.MarkdownGenerator();
    this.conversionManager = new mistral.ConversionManager({
      fileProcessor,
      fileStorage
    });
    
    // Set the API key in the conversion manager
    this.conversionManager.setApiKey(process.env.MISTRAL_API_KEY);
    
    // Log whether handlers will be set up
    if (skipHandlerSetup) {
      console.log('[MistralPdfConverter] Skipping handler setup (skipHandlerSetup=true)');
    } else {
      this.setupIpcHandlers();
    }
  }

  /**
   * Set up IPC handlers for PDF conversion
   */
  setupIpcHandlers() {
    console.log('[MistralPdfConverter] Setting up IPC handlers');
    this.registerHandler('convert:pdf:ocr', this.handleConvert.bind(this));
    this.registerHandler('convert:pdf:ocr:metadata', this.handleGetMetadata.bind(this));
    this.registerHandler('convert:pdf:ocr:check', this.handleCheckApiKey.bind(this));
    console.log('[MistralPdfConverter] IPC handlers registered');
  }

  /**
   * Set API key for Mistral API
   * @param {string} apiKey - API key
   */
  setApiKey(apiKey) {
    this.apiClient.setApiKey(apiKey);
    this.conversionManager.setApiKey(apiKey);
  }

  /**
   * Get the API key
   * @returns {string|null} API key or null if not set
   */
  get apiKey() {
    return this.apiClient.apiKey;
  }

  /**
   * Handle PDF conversion request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Conversion request details
   */
  async handleConvert(event, { filePath, options = {} }) {
    try {
      console.log('[MistralPdfConverter] handleConvert called with options:', {
        hasApiKey: !!this.apiClient.apiKey,
        hasOptionsApiKey: !!options.mistralApiKey,
        fileName: options.name || path.basename(filePath)
      });
      
      // Use API key from options if available
      if (options.mistralApiKey) {
        console.log('[MistralPdfConverter] Using API key from options');
        this.setApiKey(options.mistralApiKey);
      }
      
      // Start the conversion using the ConversionManager
      return await this.conversionManager.startConversion({
        filePath,
        options,
        window: event.sender.getOwnerBrowserWindow()
      });
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
   * @param {Object} options - Options including API key
   */
  async handleCheckApiKey(event, options = {}) {
    try {
      // If API key provided in options, use it for the check
      const apiKey = options?.apiKey || this.apiClient.apiKey;
      return await this.conversionManager.checkApiKey(apiKey);
    } catch (error) {
      console.error('[MistralPdfConverter] API key check failed:', error);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Convert PDF content to markdown - direct method for ConverterRegistry
   * @param {Buffer} content - PDF content as buffer
   * @param {Object} options - Conversion options
   * @returns {Promise<Object>} Conversion result
   */
  async convertToMarkdown(content, options = {}) {
    try {
      console.log(`[MistralPdfConverter] Converting PDF with OCR: ${options.name || 'unnamed'}`);
      
      // Use API key from options if provided
      if (options.apiKey || options.mistralApiKey) {
        const apiKey = options.apiKey || options.mistralApiKey;
        this.setApiKey(apiKey);
      }
      
      // Use the ConversionManager to handle the actual conversion
      return await this.conversionManager.convertToMarkdown(content, options);
    } catch (error) {
      console.error('[MistralPdfConverter] Direct conversion failed:', error);
      
      // Create a more detailed error message
      const errorDetails = error.response ?
        `API response: ${JSON.stringify(error.response.data || {})}` :
        error.message;
      
      return {
        success: false,
        error: `PDF OCR conversion failed: ${error.message}`,
        errorDetails: errorDetails,
        content: `# Conversion Error\n\nFailed to convert PDF with OCR: ${error.message}\n\n## Error Details\n\n${errorDetails}`
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
        model: 'OCR model to use (default: mistral-ocr-latest)',
        language: 'Language hint for OCR (optional)',
        maxPages: 'Maximum pages to convert (default: all)'
      }
    };
  }
}

module.exports = MistralPdfConverter;