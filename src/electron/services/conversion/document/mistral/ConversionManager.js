/**
 * ConversionManager.js
 * Manages PDF to markdown conversion workflow using Mistral OCR
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const MistralApiClient = require('./MistralApiClient');
const OcrProcessor = require('./OcrProcessor');
const MarkdownGenerator = require('./MarkdownGenerator');

class ConversionManager {
  constructor({ fileProcessor, fileStorage }) {
    this.fileProcessor = fileProcessor;
    this.fileStorage = fileStorage;
    this.mistralApiClient = new MistralApiClient();
    this.ocrProcessor = new OcrProcessor();
    this.markdownGenerator = new MarkdownGenerator();
    
    // Conversion progress tracking
    this.activeConversions = new Map();
  }

  /**
   * Set Mistral API key
   * @param {string} apiKey - Mistral API key
   */
  setApiKey(apiKey) {
    this.mistralApiClient.setApiKey(apiKey);
  }

  /**
   * Generate a unique conversion ID
   * @returns {string} Unique ID
   */
  generateConversionId() {
    return uuidv4();
  }

  /**
   * Start a conversion process
   * @param {Object} params - Conversion parameters
   * @param {string} params.filePath - Path to the PDF file
   * @param {Object} params.options - Conversion options
   * @param {Electron.BrowserWindow} params.window - Electron browser window
   * @returns {Promise<Object>} Conversion information
   */
  async startConversion({ filePath, options = {}, window = null }) {
    try {
      console.log('[ConversionManager] Starting conversion with options:', {
        hasApiKey: !!this.mistralApiClient.apiKey,
        hasOptionsApiKey: !!options.mistralApiKey,
        fileName: options.name || path.basename(filePath)
      });
      
      // Use API key from options if available
      if (options.mistralApiKey) {
        console.log('[ConversionManager] Using API key from options');
        this.setApiKey(options.mistralApiKey);
      }
      
      // Check if API key is available
      if (!this.mistralApiClient.isConfigured()) {
        throw new Error('Mistral API key not configured');
      }
      
      const conversionId = this.generateConversionId();
      
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

      // Notify client that conversion has started (only if we have a valid window)
      if (window && window.webContents) {
        window.webContents.send('pdf:conversion-started', { conversionId });
      }

      // Start conversion process in background
      this.processConversion(conversionId, filePath, options).catch(error => {
        console.error(`[ConversionManager] Conversion failed for ${conversionId}:`, error);
        this.updateConversionStatus(conversionId, 'failed', { error: error.message });
        
        // Clean up temp directory
        fs.remove(tempDir).catch(err => {
          console.error(`[ConversionManager] Failed to clean up temp directory: ${tempDir}`, err);
        });
      });

      return { conversionId };
    } catch (error) {
      console.error('[ConversionManager] Failed to start conversion:', error);
      throw error;
    }
  }

  /**
   * Update conversion status and notify client
   * @param {string} conversionId - Conversion ID
   * @param {string} status - New status
   * @param {Object} data - Additional data
   */
  updateConversionStatus(conversionId, status, data = {}) {
    const conversion = this.activeConversions.get(conversionId);
    if (!conversion) {
      console.warn(`[ConversionManager] Cannot update status for unknown conversion: ${conversionId}`);
      return;
    }
    
    // Update conversion status
    conversion.status = status;
    
    // Update progress if provided
    if (data.progress !== undefined) {
      conversion.progress = data.progress;
    }
    
    // Merge additional data
    Object.assign(conversion, data);
    
    // Notify client of status change
    if (conversion.window && !conversion.window.isDestroyed()) {
      conversion.window.webContents.send('pdf:conversion-status', {
        conversionId,
        status,
        progress: conversion.progress,
        ...data
      });
      
      // If conversion is completed or failed, also send specific event
      if (status === 'completed') {
        conversion.window.webContents.send('pdf:conversion-completed', {
          conversionId,
          result: data.result
        });
      } else if (status === 'failed') {
        conversion.window.webContents.send('pdf:conversion-failed', {
          conversionId,
          error: data.error
        });
      }
    }
  }

  /**
   * Process PDF conversion
   * @param {string} conversionId - Conversion identifier
   * @param {string} filePath - Path to PDF file
   * @param {Object} options - Conversion options
   * @returns {Promise<string>} Generated markdown
   */
  async processConversion(conversionId, filePath, options) {
    try {
      const conversion = this.activeConversions.get(conversionId);
      if (!conversion) {
        throw new Error('Conversion not found');
      }
      
      const tempDir = conversion.tempDir;
      
      // Extract metadata using standard PDF extractor
      this.updateConversionStatus(conversionId, 'extracting_metadata', { progress: 5 });
      
      const StandardPdfConverter = require('../StandardPdfConverter');
      const standardConverter = new StandardPdfConverter(
        this.fileProcessor,
        this.fileStorage
      );
      const metadata = await standardConverter.extractMetadata(filePath);
      
      // Process with OCR
      this.updateConversionStatus(conversionId, 'processing_ocr', { progress: 10 });
      
      // Read file as buffer
      const fileBuffer = await fs.readFile(filePath);
      
      // Process with Mistral OCR API
      const apiResult = await this.mistralApiClient.processDocument(
        fileBuffer,
        path.basename(filePath),
        {
          model: "mistral-ocr-latest",
          language: options.language
        }
      );
      
      // Process OCR results
      this.updateConversionStatus(conversionId, 'processing_results', { progress: 70 });
      const ocrResult = this.ocrProcessor.processResult(apiResult);
      
      // Generate markdown
      this.updateConversionStatus(conversionId, 'generating_markdown', { progress: 90 });
      const markdown = this.markdownGenerator.generateCompleteDocument(metadata, ocrResult, options);
      
      // Clean up temp directory
      await fs.remove(tempDir);
      
      // Update conversion status to completed
      this.updateConversionStatus(conversionId, 'completed', { 
        progress: 100,
        result: markdown
      });
      
      return markdown;
    } catch (error) {
      console.error('[ConversionManager] Conversion processing failed:', error);
      throw error;
    }
  }

  /**
   * Check if Mistral API key is valid
   * @param {string} apiKey - API key to check
   * @returns {Promise<Object>} Validation result
   */
  async checkApiKey(apiKey) {
    try {
      // Temporarily set API key if provided
      if (apiKey) {
        this.mistralApiClient.setApiKey(apiKey);
      }
      
      return await this.mistralApiClient.validateApiKey();
    } catch (error) {
      console.error('[ConversionManager] API key check failed:', error);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Convert PDF content to markdown (direct method for ConverterRegistry)
   * @param {Buffer} content - PDF content as buffer
   * @param {Object} options - Conversion options
   * @returns {Promise<Object>} Conversion result
   */
  async convertToMarkdown(content, options = {}) {
    let tempDir = null;
    
    try {
      console.log(`[ConversionManager] Converting PDF with OCR: ${options.name || 'unnamed'}`);
      
      // Check if API key is available from multiple sources
      if (options.apiKey) {
        this.setApiKey(options.apiKey);
      }
      
      if (!this.mistralApiClient.isConfigured()) {
        throw new Error('Mistral API key not configured');
      }
      
      // Create a temporary file to process
      tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'pdf-ocr-conversion-'));
      const tempFile = path.join(tempDir, `${options.name || 'document'}.pdf`);
      
      // Write buffer to temp file
      await fs.writeFile(tempFile, content);
      
      // Extract metadata using standard methods
      const StandardPdfConverter = require('../StandardPdfConverter');
      const standardConverter = new StandardPdfConverter();
      const metadata = await standardConverter.extractMetadata(tempFile);
      
      // Log metadata for debugging
      console.log('[ConversionManager] Extracted metadata:', {
        title: metadata.title,
        author: metadata.author,
        pageCount: metadata.pageCount
      });
      
      // Process with Mistral OCR API
      console.log('[ConversionManager] Processing PDF with OCR');
      const apiResult = await this.mistralApiClient.processDocument(
        content,
        options.name || 'document.pdf',
        {
          model: "mistral-ocr-latest",
          language: options.language
        }
      );
      
      // Process OCR results
      const ocrResult = this.ocrProcessor.processResult(apiResult);
      
      // Generate markdown
      const finalMarkdown = this.markdownGenerator.generateCompleteDocument(metadata, ocrResult, options);
      
      // Create result object with enhanced information
      const result = {
        success: true,
        content: finalMarkdown,
        type: 'pdf',
        name: options.name || 'document.pdf',
        metadata: metadata,
        ocrInfo: {
          model: ocrResult?.documentInfo?.model || 'unknown',
          language: ocrResult?.documentInfo?.language || 'unknown',
          pageCount: ocrResult?.pages?.length || 0,
          confidence: ocrResult?.documentInfo?.overallConfidence || 0
        }
      };
      
      // Clean up temp directory
      if (tempDir) {
        await fs.remove(tempDir)
          .catch(err => console.error('[ConversionManager] Error cleaning up temp directory:', err));
        tempDir = null;
      }
      
      return result;
    } catch (error) {
      console.error('[ConversionManager] Direct conversion failed:', error);
      
      // Clean up temp directory if it exists
      if (tempDir) {
        try {
          await fs.remove(tempDir);
        } catch (cleanupError) {
          console.error('[ConversionManager] Error cleaning up temp directory:', cleanupError);
        }
      }
      
      // Create a more detailed error message
      const errorDetails = error.response ?
        `API response: ${JSON.stringify(error.response.data || {})}` :
        error.message;
      
      // Check if this is a 500 Internal Server Error
      let errorMessage = error.message;
      let troubleshootingInfo = '';
      
      if (error.message.includes('500') || error.message.includes('Internal Server Error')) {
        console.error('[ConversionManager] Detected 500 Internal Server Error');
        
        // Add troubleshooting information for 500 errors
        troubleshootingInfo = `
## Troubleshooting 500 Internal Server Error

This error may be caused by:

1. **File Size Limit**: The PDF file may exceed Mistral's 50MB size limit.
2. **API Service Issues**: Mistral's API may be experiencing temporary issues.
3. **Rate Limiting**: You may have exceeded the API rate limits.
4. **Malformed Request**: The request format may not match Mistral's API requirements.

### Suggested Actions:
- Try with a smaller PDF file
- Check if your Mistral API key has sufficient permissions
- Try again later if it's a temporary service issue
- Verify your API subscription status
`;
      }
      
      return {
        success: false,
        error: `PDF OCR conversion failed: ${errorMessage}`,
        errorDetails: errorDetails,
        content: `# Conversion Error\n\nFailed to convert PDF with OCR: ${errorMessage}\n\n## Error Details\n\n${errorDetails}\n\n${troubleshootingInfo}`
      };
    }
  }
}

module.exports = ConversionManager;