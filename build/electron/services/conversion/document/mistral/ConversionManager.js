"use strict";

/**
 * ConversionManager.js
 * Manages PDF to markdown conversion workflow using Mistral OCR
 */

const fs = require('fs-extra');
const path = require('path');
const {
  v4: uuidv4
} = require('uuid');
const MistralApiClient = require('./MistralApiClient');
const OcrProcessor = require('./OcrProcessor');
const MarkdownGenerator = require('./MarkdownGenerator');
class ConversionManager {
  constructor({
    fileProcessor,
    fileStorage
  }) {
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
  async startConversion({
    filePath,
    options = {},
    window
  }) {
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

      // Notify client that conversion has started
      window.webContents.send('pdf:conversion-started', {
        conversionId
      });

      // Start conversion process in background
      this.processConversion(conversionId, filePath, options).catch(error => {
        console.error(`[ConversionManager] Conversion failed for ${conversionId}:`, error);
        this.updateConversionStatus(conversionId, 'failed', {
          error: error.message
        });

        // Clean up temp directory
        fs.remove(tempDir).catch(err => {
          console.error(`[ConversionManager] Failed to clean up temp directory: ${tempDir}`, err);
        });
      });
      return {
        conversionId
      };
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
      this.updateConversionStatus(conversionId, 'extracting_metadata', {
        progress: 5
      });
      const StandardPdfConverter = require('../StandardPdfConverter');
      const standardConverter = new StandardPdfConverter(this.fileProcessor, this.fileStorage);
      const metadata = await standardConverter.extractMetadata(filePath);

      // Process with OCR
      this.updateConversionStatus(conversionId, 'processing_ocr', {
        progress: 10
      });

      // Read file as buffer
      const fileBuffer = await fs.readFile(filePath);

      // Process with Mistral OCR API
      const apiResult = await this.mistralApiClient.processDocument(fileBuffer, path.basename(filePath), {
        model: "mistral-ocr-latest",
        language: options.language
      });

      // Process OCR results
      this.updateConversionStatus(conversionId, 'processing_results', {
        progress: 70
      });
      const ocrResult = this.ocrProcessor.processResult(apiResult);

      // Generate markdown
      this.updateConversionStatus(conversionId, 'generating_markdown', {
        progress: 90
      });
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
      return {
        valid: false,
        error: error.message
      };
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
      const apiResult = await this.mistralApiClient.processDocument(content, options.name || 'document.pdf', {
        model: "mistral-ocr-latest",
        language: options.language
      });

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
        await fs.remove(tempDir).catch(err => console.error('[ConversionManager] Error cleaning up temp directory:', err));
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
      const errorDetails = error.response ? `API response: ${JSON.stringify(error.response.data || {})}` : error.message;

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJwYXRoIiwidjQiLCJ1dWlkdjQiLCJNaXN0cmFsQXBpQ2xpZW50IiwiT2NyUHJvY2Vzc29yIiwiTWFya2Rvd25HZW5lcmF0b3IiLCJDb252ZXJzaW9uTWFuYWdlciIsImNvbnN0cnVjdG9yIiwiZmlsZVByb2Nlc3NvciIsImZpbGVTdG9yYWdlIiwibWlzdHJhbEFwaUNsaWVudCIsIm9jclByb2Nlc3NvciIsIm1hcmtkb3duR2VuZXJhdG9yIiwiYWN0aXZlQ29udmVyc2lvbnMiLCJNYXAiLCJzZXRBcGlLZXkiLCJhcGlLZXkiLCJnZW5lcmF0ZUNvbnZlcnNpb25JZCIsInN0YXJ0Q29udmVyc2lvbiIsImZpbGVQYXRoIiwib3B0aW9ucyIsIndpbmRvdyIsImNvbnNvbGUiLCJsb2ciLCJoYXNBcGlLZXkiLCJoYXNPcHRpb25zQXBpS2V5IiwibWlzdHJhbEFwaUtleSIsImZpbGVOYW1lIiwibmFtZSIsImJhc2VuYW1lIiwiaXNDb25maWd1cmVkIiwiRXJyb3IiLCJjb252ZXJzaW9uSWQiLCJ0ZW1wRGlyIiwiY3JlYXRlVGVtcERpciIsInNldCIsImlkIiwic3RhdHVzIiwicHJvZ3Jlc3MiLCJ3ZWJDb250ZW50cyIsInNlbmQiLCJwcm9jZXNzQ29udmVyc2lvbiIsImNhdGNoIiwiZXJyb3IiLCJ1cGRhdGVDb252ZXJzaW9uU3RhdHVzIiwibWVzc2FnZSIsInJlbW92ZSIsImVyciIsImRhdGEiLCJjb252ZXJzaW9uIiwiZ2V0Iiwid2FybiIsInVuZGVmaW5lZCIsIk9iamVjdCIsImFzc2lnbiIsImlzRGVzdHJveWVkIiwicmVzdWx0IiwiU3RhbmRhcmRQZGZDb252ZXJ0ZXIiLCJzdGFuZGFyZENvbnZlcnRlciIsIm1ldGFkYXRhIiwiZXh0cmFjdE1ldGFkYXRhIiwiZmlsZUJ1ZmZlciIsInJlYWRGaWxlIiwiYXBpUmVzdWx0IiwicHJvY2Vzc0RvY3VtZW50IiwibW9kZWwiLCJsYW5ndWFnZSIsIm9jclJlc3VsdCIsInByb2Nlc3NSZXN1bHQiLCJtYXJrZG93biIsImdlbmVyYXRlQ29tcGxldGVEb2N1bWVudCIsImNoZWNrQXBpS2V5IiwidmFsaWRhdGVBcGlLZXkiLCJ2YWxpZCIsImNvbnZlcnRUb01hcmtkb3duIiwiY29udGVudCIsIm1rZHRlbXAiLCJqb2luIiwidG1wZGlyIiwidGVtcEZpbGUiLCJ3cml0ZUZpbGUiLCJ0aXRsZSIsImF1dGhvciIsInBhZ2VDb3VudCIsImZpbmFsTWFya2Rvd24iLCJzdWNjZXNzIiwidHlwZSIsIm9jckluZm8iLCJkb2N1bWVudEluZm8iLCJwYWdlcyIsImxlbmd0aCIsImNvbmZpZGVuY2UiLCJvdmVyYWxsQ29uZmlkZW5jZSIsImNsZWFudXBFcnJvciIsImVycm9yRGV0YWlscyIsInJlc3BvbnNlIiwiSlNPTiIsInN0cmluZ2lmeSIsImVycm9yTWVzc2FnZSIsInRyb3VibGVzaG9vdGluZ0luZm8iLCJpbmNsdWRlcyIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9taXN0cmFsL0NvbnZlcnNpb25NYW5hZ2VyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBDb252ZXJzaW9uTWFuYWdlci5qc1xyXG4gKiBNYW5hZ2VzIFBERiB0byBtYXJrZG93biBjb252ZXJzaW9uIHdvcmtmbG93IHVzaW5nIE1pc3RyYWwgT0NSXHJcbiAqL1xyXG5cclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IHY0OiB1dWlkdjQgfSA9IHJlcXVpcmUoJ3V1aWQnKTtcclxuXHJcbmNvbnN0IE1pc3RyYWxBcGlDbGllbnQgPSByZXF1aXJlKCcuL01pc3RyYWxBcGlDbGllbnQnKTtcclxuY29uc3QgT2NyUHJvY2Vzc29yID0gcmVxdWlyZSgnLi9PY3JQcm9jZXNzb3InKTtcclxuY29uc3QgTWFya2Rvd25HZW5lcmF0b3IgPSByZXF1aXJlKCcuL01hcmtkb3duR2VuZXJhdG9yJyk7XHJcblxyXG5jbGFzcyBDb252ZXJzaW9uTWFuYWdlciB7XHJcbiAgY29uc3RydWN0b3IoeyBmaWxlUHJvY2Vzc29yLCBmaWxlU3RvcmFnZSB9KSB7XHJcbiAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yO1xyXG4gICAgdGhpcy5maWxlU3RvcmFnZSA9IGZpbGVTdG9yYWdlO1xyXG4gICAgdGhpcy5taXN0cmFsQXBpQ2xpZW50ID0gbmV3IE1pc3RyYWxBcGlDbGllbnQoKTtcclxuICAgIHRoaXMub2NyUHJvY2Vzc29yID0gbmV3IE9jclByb2Nlc3NvcigpO1xyXG4gICAgdGhpcy5tYXJrZG93bkdlbmVyYXRvciA9IG5ldyBNYXJrZG93bkdlbmVyYXRvcigpO1xyXG4gICAgXHJcbiAgICAvLyBDb252ZXJzaW9uIHByb2dyZXNzIHRyYWNraW5nXHJcbiAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zID0gbmV3IE1hcCgpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2V0IE1pc3RyYWwgQVBJIGtleVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcGlLZXkgLSBNaXN0cmFsIEFQSSBrZXlcclxuICAgKi9cclxuICBzZXRBcGlLZXkoYXBpS2V5KSB7XHJcbiAgICB0aGlzLm1pc3RyYWxBcGlDbGllbnQuc2V0QXBpS2V5KGFwaUtleSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZW5lcmF0ZSBhIHVuaXF1ZSBjb252ZXJzaW9uIElEXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gVW5pcXVlIElEXHJcbiAgICovXHJcbiAgZ2VuZXJhdGVDb252ZXJzaW9uSWQoKSB7XHJcbiAgICByZXR1cm4gdXVpZHY0KCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTdGFydCBhIGNvbnZlcnNpb24gcHJvY2Vzc1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBwYXJhbXMgLSBDb252ZXJzaW9uIHBhcmFtZXRlcnNcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gcGFyYW1zLmZpbGVQYXRoIC0gUGF0aCB0byB0aGUgUERGIGZpbGVcclxuICAgKiBAcGFyYW0ge09iamVjdH0gcGFyYW1zLm9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgKiBAcGFyYW0ge0VsZWN0cm9uLkJyb3dzZXJXaW5kb3d9IHBhcmFtcy53aW5kb3cgLSBFbGVjdHJvbiBicm93c2VyIHdpbmRvd1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IENvbnZlcnNpb24gaW5mb3JtYXRpb25cclxuICAgKi9cclxuICBhc3luYyBzdGFydENvbnZlcnNpb24oeyBmaWxlUGF0aCwgb3B0aW9ucyA9IHt9LCB3aW5kb3cgfSkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coJ1tDb252ZXJzaW9uTWFuYWdlcl0gU3RhcnRpbmcgY29udmVyc2lvbiB3aXRoIG9wdGlvbnM6Jywge1xyXG4gICAgICAgIGhhc0FwaUtleTogISF0aGlzLm1pc3RyYWxBcGlDbGllbnQuYXBpS2V5LFxyXG4gICAgICAgIGhhc09wdGlvbnNBcGlLZXk6ICEhb3B0aW9ucy5taXN0cmFsQXBpS2V5LFxyXG4gICAgICAgIGZpbGVOYW1lOiBvcHRpb25zLm5hbWUgfHwgcGF0aC5iYXNlbmFtZShmaWxlUGF0aClcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBVc2UgQVBJIGtleSBmcm9tIG9wdGlvbnMgaWYgYXZhaWxhYmxlXHJcbiAgICAgIGlmIChvcHRpb25zLm1pc3RyYWxBcGlLZXkpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnW0NvbnZlcnNpb25NYW5hZ2VyXSBVc2luZyBBUEkga2V5IGZyb20gb3B0aW9ucycpO1xyXG4gICAgICAgIHRoaXMuc2V0QXBpS2V5KG9wdGlvbnMubWlzdHJhbEFwaUtleSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGlmIEFQSSBrZXkgaXMgYXZhaWxhYmxlXHJcbiAgICAgIGlmICghdGhpcy5taXN0cmFsQXBpQ2xpZW50LmlzQ29uZmlndXJlZCgpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNaXN0cmFsIEFQSSBrZXkgbm90IGNvbmZpZ3VyZWQnKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgY29uc3QgY29udmVyc2lvbklkID0gdGhpcy5nZW5lcmF0ZUNvbnZlcnNpb25JZCgpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ3JlYXRlIHRlbXAgZGlyZWN0b3J5IGZvciB0aGlzIGNvbnZlcnNpb25cclxuICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IHRoaXMuZmlsZVN0b3JhZ2UuY3JlYXRlVGVtcERpcigncGRmX29jcl9jb252ZXJzaW9uJyk7XHJcbiAgICAgIFxyXG4gICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNldChjb252ZXJzaW9uSWQsIHtcclxuICAgICAgICBpZDogY29udmVyc2lvbklkLFxyXG4gICAgICAgIHN0YXR1czogJ3N0YXJ0aW5nJyxcclxuICAgICAgICBwcm9ncmVzczogMCxcclxuICAgICAgICBmaWxlUGF0aCxcclxuICAgICAgICB0ZW1wRGlyLFxyXG4gICAgICAgIHdpbmRvd1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIE5vdGlmeSBjbGllbnQgdGhhdCBjb252ZXJzaW9uIGhhcyBzdGFydGVkXHJcbiAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwZGY6Y29udmVyc2lvbi1zdGFydGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XHJcblxyXG4gICAgICAvLyBTdGFydCBjb252ZXJzaW9uIHByb2Nlc3MgaW4gYmFja2dyb3VuZFxyXG4gICAgICB0aGlzLnByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgZmlsZVBhdGgsIG9wdGlvbnMpLmNhdGNoKGVycm9yID0+IHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBbQ29udmVyc2lvbk1hbmFnZXJdIENvbnZlcnNpb24gZmFpbGVkIGZvciAke2NvbnZlcnNpb25JZH06YCwgZXJyb3IpO1xyXG4gICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdmYWlsZWQnLCB7IGVycm9yOiBlcnJvci5tZXNzYWdlIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XHJcbiAgICAgICAgZnMucmVtb3ZlKHRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKGBbQ29udmVyc2lvbk1hbmFnZXJdIEZhaWxlZCB0byBjbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeTogJHt0ZW1wRGlyfWAsIGVycik7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgcmV0dXJuIHsgY29udmVyc2lvbklkIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdbQ29udmVyc2lvbk1hbmFnZXJdIEZhaWxlZCB0byBzdGFydCBjb252ZXJzaW9uOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBVcGRhdGUgY29udmVyc2lvbiBzdGF0dXMgYW5kIG5vdGlmeSBjbGllbnRcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBJRFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzdGF0dXMgLSBOZXcgc3RhdHVzXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IGRhdGEgLSBBZGRpdGlvbmFsIGRhdGFcclxuICAgKi9cclxuICB1cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgc3RhdHVzLCBkYXRhID0ge30pIHtcclxuICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgaWYgKCFjb252ZXJzaW9uKSB7XHJcbiAgICAgIGNvbnNvbGUud2FybihgW0NvbnZlcnNpb25NYW5hZ2VyXSBDYW5ub3QgdXBkYXRlIHN0YXR1cyBmb3IgdW5rbm93biBjb252ZXJzaW9uOiAke2NvbnZlcnNpb25JZH1gKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBVcGRhdGUgY29udmVyc2lvbiBzdGF0dXNcclxuICAgIGNvbnZlcnNpb24uc3RhdHVzID0gc3RhdHVzO1xyXG4gICAgXHJcbiAgICAvLyBVcGRhdGUgcHJvZ3Jlc3MgaWYgcHJvdmlkZWRcclxuICAgIGlmIChkYXRhLnByb2dyZXNzICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgY29udmVyc2lvbi5wcm9ncmVzcyA9IGRhdGEucHJvZ3Jlc3M7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIE1lcmdlIGFkZGl0aW9uYWwgZGF0YVxyXG4gICAgT2JqZWN0LmFzc2lnbihjb252ZXJzaW9uLCBkYXRhKTtcclxuICAgIFxyXG4gICAgLy8gTm90aWZ5IGNsaWVudCBvZiBzdGF0dXMgY2hhbmdlXHJcbiAgICBpZiAoY29udmVyc2lvbi53aW5kb3cgJiYgIWNvbnZlcnNpb24ud2luZG93LmlzRGVzdHJveWVkKCkpIHtcclxuICAgICAgY29udmVyc2lvbi53aW5kb3cud2ViQ29udGVudHMuc2VuZCgncGRmOmNvbnZlcnNpb24tc3RhdHVzJywge1xyXG4gICAgICAgIGNvbnZlcnNpb25JZCxcclxuICAgICAgICBzdGF0dXMsXHJcbiAgICAgICAgcHJvZ3Jlc3M6IGNvbnZlcnNpb24ucHJvZ3Jlc3MsXHJcbiAgICAgICAgLi4uZGF0YVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIElmIGNvbnZlcnNpb24gaXMgY29tcGxldGVkIG9yIGZhaWxlZCwgYWxzbyBzZW5kIHNwZWNpZmljIGV2ZW50XHJcbiAgICAgIGlmIChzdGF0dXMgPT09ICdjb21wbGV0ZWQnKSB7XHJcbiAgICAgICAgY29udmVyc2lvbi53aW5kb3cud2ViQ29udGVudHMuc2VuZCgncGRmOmNvbnZlcnNpb24tY29tcGxldGVkJywge1xyXG4gICAgICAgICAgY29udmVyc2lvbklkLFxyXG4gICAgICAgICAgcmVzdWx0OiBkYXRhLnJlc3VsdFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGVsc2UgaWYgKHN0YXR1cyA9PT0gJ2ZhaWxlZCcpIHtcclxuICAgICAgICBjb252ZXJzaW9uLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwZGY6Y29udmVyc2lvbi1mYWlsZWQnLCB7XHJcbiAgICAgICAgICBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICBlcnJvcjogZGF0YS5lcnJvclxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQcm9jZXNzIFBERiBjb252ZXJzaW9uXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gUERGIGZpbGVcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IEdlbmVyYXRlZCBtYXJrZG93blxyXG4gICAqL1xyXG4gIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgZmlsZVBhdGgsIG9wdGlvbnMpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgICBpZiAoIWNvbnZlcnNpb24pIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbnZlcnNpb24gbm90IGZvdW5kJyk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHRlbXBEaXIgPSBjb252ZXJzaW9uLnRlbXBEaXI7XHJcbiAgICAgIFxyXG4gICAgICAvLyBFeHRyYWN0IG1ldGFkYXRhIHVzaW5nIHN0YW5kYXJkIFBERiBleHRyYWN0b3JcclxuICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2V4dHJhY3RpbmdfbWV0YWRhdGEnLCB7IHByb2dyZXNzOiA1IH0pO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgU3RhbmRhcmRQZGZDb252ZXJ0ZXIgPSByZXF1aXJlKCcuLi9TdGFuZGFyZFBkZkNvbnZlcnRlcicpO1xyXG4gICAgICBjb25zdCBzdGFuZGFyZENvbnZlcnRlciA9IG5ldyBTdGFuZGFyZFBkZkNvbnZlcnRlcihcclxuICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IsXHJcbiAgICAgICAgdGhpcy5maWxlU3RvcmFnZVxyXG4gICAgICApO1xyXG4gICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHN0YW5kYXJkQ29udmVydGVyLmV4dHJhY3RNZXRhZGF0YShmaWxlUGF0aCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBQcm9jZXNzIHdpdGggT0NSXHJcbiAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdwcm9jZXNzaW5nX29jcicsIHsgcHJvZ3Jlc3M6IDEwIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gUmVhZCBmaWxlIGFzIGJ1ZmZlclxyXG4gICAgICBjb25zdCBmaWxlQnVmZmVyID0gYXdhaXQgZnMucmVhZEZpbGUoZmlsZVBhdGgpO1xyXG4gICAgICBcclxuICAgICAgLy8gUHJvY2VzcyB3aXRoIE1pc3RyYWwgT0NSIEFQSVxyXG4gICAgICBjb25zdCBhcGlSZXN1bHQgPSBhd2FpdCB0aGlzLm1pc3RyYWxBcGlDbGllbnQucHJvY2Vzc0RvY3VtZW50KFxyXG4gICAgICAgIGZpbGVCdWZmZXIsXHJcbiAgICAgICAgcGF0aC5iYXNlbmFtZShmaWxlUGF0aCksXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgbW9kZWw6IFwibWlzdHJhbC1vY3ItbGF0ZXN0XCIsXHJcbiAgICAgICAgICBsYW5ndWFnZTogb3B0aW9ucy5sYW5ndWFnZVxyXG4gICAgICAgIH1cclxuICAgICAgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFByb2Nlc3MgT0NSIHJlc3VsdHNcclxuICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ3Byb2Nlc3NpbmdfcmVzdWx0cycsIHsgcHJvZ3Jlc3M6IDcwIH0pO1xyXG4gICAgICBjb25zdCBvY3JSZXN1bHQgPSB0aGlzLm9jclByb2Nlc3Nvci5wcm9jZXNzUmVzdWx0KGFwaVJlc3VsdCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBHZW5lcmF0ZSBtYXJrZG93blxyXG4gICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZ2VuZXJhdGluZ19tYXJrZG93bicsIHsgcHJvZ3Jlc3M6IDkwIH0pO1xyXG4gICAgICBjb25zdCBtYXJrZG93biA9IHRoaXMubWFya2Rvd25HZW5lcmF0b3IuZ2VuZXJhdGVDb21wbGV0ZURvY3VtZW50KG1ldGFkYXRhLCBvY3JSZXN1bHQsIG9wdGlvbnMpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICBcclxuICAgICAgLy8gVXBkYXRlIGNvbnZlcnNpb24gc3RhdHVzIHRvIGNvbXBsZXRlZFxyXG4gICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnY29tcGxldGVkJywgeyBcclxuICAgICAgICBwcm9ncmVzczogMTAwLFxyXG4gICAgICAgIHJlc3VsdDogbWFya2Rvd25cclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gbWFya2Rvd247XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdbQ29udmVyc2lvbk1hbmFnZXJdIENvbnZlcnNpb24gcHJvY2Vzc2luZyBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENoZWNrIGlmIE1pc3RyYWwgQVBJIGtleSBpcyB2YWxpZFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcGlLZXkgLSBBUEkga2V5IHRvIGNoZWNrXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gVmFsaWRhdGlvbiByZXN1bHRcclxuICAgKi9cclxuICBhc3luYyBjaGVja0FwaUtleShhcGlLZXkpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFRlbXBvcmFyaWx5IHNldCBBUEkga2V5IGlmIHByb3ZpZGVkXHJcbiAgICAgIGlmIChhcGlLZXkpIHtcclxuICAgICAgICB0aGlzLm1pc3RyYWxBcGlDbGllbnQuc2V0QXBpS2V5KGFwaUtleSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLm1pc3RyYWxBcGlDbGllbnQudmFsaWRhdGVBcGlLZXkoKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tDb252ZXJzaW9uTWFuYWdlcl0gQVBJIGtleSBjaGVjayBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4geyB2YWxpZDogZmFsc2UsIGVycm9yOiBlcnJvci5tZXNzYWdlIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDb252ZXJ0IFBERiBjb250ZW50IHRvIG1hcmtkb3duIChkaXJlY3QgbWV0aG9kIGZvciBDb252ZXJ0ZXJSZWdpc3RyeSlcclxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gY29udGVudCAtIFBERiBjb250ZW50IGFzIGJ1ZmZlclxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gQ29udmVyc2lvbiByZXN1bHRcclxuICAgKi9cclxuICBhc3luYyBjb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCBvcHRpb25zID0ge30pIHtcclxuICAgIGxldCB0ZW1wRGlyID0gbnVsbDtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYFtDb252ZXJzaW9uTWFuYWdlcl0gQ29udmVydGluZyBQREYgd2l0aCBPQ1I6ICR7b3B0aW9ucy5uYW1lIHx8ICd1bm5hbWVkJ31gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGlmIEFQSSBrZXkgaXMgYXZhaWxhYmxlIGZyb20gbXVsdGlwbGUgc291cmNlc1xyXG4gICAgICBpZiAob3B0aW9ucy5hcGlLZXkpIHtcclxuICAgICAgICB0aGlzLnNldEFwaUtleShvcHRpb25zLmFwaUtleSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmICghdGhpcy5taXN0cmFsQXBpQ2xpZW50LmlzQ29uZmlndXJlZCgpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNaXN0cmFsIEFQSSBrZXkgbm90IGNvbmZpZ3VyZWQnKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGZpbGUgdG8gcHJvY2Vzc1xyXG4gICAgICB0ZW1wRGlyID0gYXdhaXQgZnMubWtkdGVtcChwYXRoLmpvaW4ocmVxdWlyZSgnb3MnKS50bXBkaXIoKSwgJ3BkZi1vY3ItY29udmVyc2lvbi0nKSk7XHJcbiAgICAgIGNvbnN0IHRlbXBGaWxlID0gcGF0aC5qb2luKHRlbXBEaXIsIGAke29wdGlvbnMubmFtZSB8fCAnZG9jdW1lbnQnfS5wZGZgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFdyaXRlIGJ1ZmZlciB0byB0ZW1wIGZpbGVcclxuICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKHRlbXBGaWxlLCBjb250ZW50KTtcclxuICAgICAgXHJcbiAgICAgIC8vIEV4dHJhY3QgbWV0YWRhdGEgdXNpbmcgc3RhbmRhcmQgbWV0aG9kc1xyXG4gICAgICBjb25zdCBTdGFuZGFyZFBkZkNvbnZlcnRlciA9IHJlcXVpcmUoJy4uL1N0YW5kYXJkUGRmQ29udmVydGVyJyk7XHJcbiAgICAgIGNvbnN0IHN0YW5kYXJkQ29udmVydGVyID0gbmV3IFN0YW5kYXJkUGRmQ29udmVydGVyKCk7XHJcbiAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgc3RhbmRhcmRDb252ZXJ0ZXIuZXh0cmFjdE1ldGFkYXRhKHRlbXBGaWxlKTtcclxuICAgICAgXHJcbiAgICAgIC8vIExvZyBtZXRhZGF0YSBmb3IgZGVidWdnaW5nXHJcbiAgICAgIGNvbnNvbGUubG9nKCdbQ29udmVyc2lvbk1hbmFnZXJdIEV4dHJhY3RlZCBtZXRhZGF0YTonLCB7XHJcbiAgICAgICAgdGl0bGU6IG1ldGFkYXRhLnRpdGxlLFxyXG4gICAgICAgIGF1dGhvcjogbWV0YWRhdGEuYXV0aG9yLFxyXG4gICAgICAgIHBhZ2VDb3VudDogbWV0YWRhdGEucGFnZUNvdW50XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gUHJvY2VzcyB3aXRoIE1pc3RyYWwgT0NSIEFQSVxyXG4gICAgICBjb25zb2xlLmxvZygnW0NvbnZlcnNpb25NYW5hZ2VyXSBQcm9jZXNzaW5nIFBERiB3aXRoIE9DUicpO1xyXG4gICAgICBjb25zdCBhcGlSZXN1bHQgPSBhd2FpdCB0aGlzLm1pc3RyYWxBcGlDbGllbnQucHJvY2Vzc0RvY3VtZW50KFxyXG4gICAgICAgIGNvbnRlbnQsXHJcbiAgICAgICAgb3B0aW9ucy5uYW1lIHx8ICdkb2N1bWVudC5wZGYnLFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIG1vZGVsOiBcIm1pc3RyYWwtb2NyLWxhdGVzdFwiLFxyXG4gICAgICAgICAgbGFuZ3VhZ2U6IG9wdGlvbnMubGFuZ3VhZ2VcclxuICAgICAgICB9XHJcbiAgICAgICk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBQcm9jZXNzIE9DUiByZXN1bHRzXHJcbiAgICAgIGNvbnN0IG9jclJlc3VsdCA9IHRoaXMub2NyUHJvY2Vzc29yLnByb2Nlc3NSZXN1bHQoYXBpUmVzdWx0KTtcclxuICAgICAgXHJcbiAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duXHJcbiAgICAgIGNvbnN0IGZpbmFsTWFya2Rvd24gPSB0aGlzLm1hcmtkb3duR2VuZXJhdG9yLmdlbmVyYXRlQ29tcGxldGVEb2N1bWVudChtZXRhZGF0YSwgb2NyUmVzdWx0LCBvcHRpb25zKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSByZXN1bHQgb2JqZWN0IHdpdGggZW5oYW5jZWQgaW5mb3JtYXRpb25cclxuICAgICAgY29uc3QgcmVzdWx0ID0ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgY29udGVudDogZmluYWxNYXJrZG93bixcclxuICAgICAgICB0eXBlOiAncGRmJyxcclxuICAgICAgICBuYW1lOiBvcHRpb25zLm5hbWUgfHwgJ2RvY3VtZW50LnBkZicsXHJcbiAgICAgICAgbWV0YWRhdGE6IG1ldGFkYXRhLFxyXG4gICAgICAgIG9jckluZm86IHtcclxuICAgICAgICAgIG1vZGVsOiBvY3JSZXN1bHQ/LmRvY3VtZW50SW5mbz8ubW9kZWwgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgICAgbGFuZ3VhZ2U6IG9jclJlc3VsdD8uZG9jdW1lbnRJbmZvPy5sYW5ndWFnZSB8fCAndW5rbm93bicsXHJcbiAgICAgICAgICBwYWdlQ291bnQ6IG9jclJlc3VsdD8ucGFnZXM/Lmxlbmd0aCB8fCAwLFxyXG4gICAgICAgICAgY29uZmlkZW5jZTogb2NyUmVzdWx0Py5kb2N1bWVudEluZm8/Lm92ZXJhbGxDb25maWRlbmNlIHx8IDBcclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcbiAgICAgIFxyXG4gICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICBpZiAodGVtcERpcikge1xyXG4gICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKVxyXG4gICAgICAgICAgLmNhdGNoKGVyciA9PiBjb25zb2xlLmVycm9yKCdbQ29udmVyc2lvbk1hbmFnZXJdIEVycm9yIGNsZWFuaW5nIHVwIHRlbXAgZGlyZWN0b3J5OicsIGVycikpO1xyXG4gICAgICAgIHRlbXBEaXIgPSBudWxsO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignW0NvbnZlcnNpb25NYW5hZ2VyXSBEaXJlY3QgY29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnkgaWYgaXQgZXhpc3RzXHJcbiAgICAgIGlmICh0ZW1wRGlyKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tDb252ZXJzaW9uTWFuYWdlcl0gRXJyb3IgY2xlYW5pbmcgdXAgdGVtcCBkaXJlY3Rvcnk6JywgY2xlYW51cEVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSBhIG1vcmUgZGV0YWlsZWQgZXJyb3IgbWVzc2FnZVxyXG4gICAgICBjb25zdCBlcnJvckRldGFpbHMgPSBlcnJvci5yZXNwb25zZSA/XHJcbiAgICAgICAgYEFQSSByZXNwb25zZTogJHtKU09OLnN0cmluZ2lmeShlcnJvci5yZXNwb25zZS5kYXRhIHx8IHt9KX1gIDpcclxuICAgICAgICBlcnJvci5tZXNzYWdlO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgaWYgdGhpcyBpcyBhIDUwMCBJbnRlcm5hbCBTZXJ2ZXIgRXJyb3JcclxuICAgICAgbGV0IGVycm9yTWVzc2FnZSA9IGVycm9yLm1lc3NhZ2U7XHJcbiAgICAgIGxldCB0cm91Ymxlc2hvb3RpbmdJbmZvID0gJyc7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoZXJyb3IubWVzc2FnZS5pbmNsdWRlcygnNTAwJykgfHwgZXJyb3IubWVzc2FnZS5pbmNsdWRlcygnSW50ZXJuYWwgU2VydmVyIEVycm9yJykpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdbQ29udmVyc2lvbk1hbmFnZXJdIERldGVjdGVkIDUwMCBJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdHJvdWJsZXNob290aW5nIGluZm9ybWF0aW9uIGZvciA1MDAgZXJyb3JzXHJcbiAgICAgICAgdHJvdWJsZXNob290aW5nSW5mbyA9IGBcclxuIyMgVHJvdWJsZXNob290aW5nIDUwMCBJbnRlcm5hbCBTZXJ2ZXIgRXJyb3JcclxuXHJcblRoaXMgZXJyb3IgbWF5IGJlIGNhdXNlZCBieTpcclxuXHJcbjEuICoqRmlsZSBTaXplIExpbWl0Kio6IFRoZSBQREYgZmlsZSBtYXkgZXhjZWVkIE1pc3RyYWwncyA1ME1CIHNpemUgbGltaXQuXHJcbjIuICoqQVBJIFNlcnZpY2UgSXNzdWVzKio6IE1pc3RyYWwncyBBUEkgbWF5IGJlIGV4cGVyaWVuY2luZyB0ZW1wb3JhcnkgaXNzdWVzLlxyXG4zLiAqKlJhdGUgTGltaXRpbmcqKjogWW91IG1heSBoYXZlIGV4Y2VlZGVkIHRoZSBBUEkgcmF0ZSBsaW1pdHMuXHJcbjQuICoqTWFsZm9ybWVkIFJlcXVlc3QqKjogVGhlIHJlcXVlc3QgZm9ybWF0IG1heSBub3QgbWF0Y2ggTWlzdHJhbCdzIEFQSSByZXF1aXJlbWVudHMuXHJcblxyXG4jIyMgU3VnZ2VzdGVkIEFjdGlvbnM6XHJcbi0gVHJ5IHdpdGggYSBzbWFsbGVyIFBERiBmaWxlXHJcbi0gQ2hlY2sgaWYgeW91ciBNaXN0cmFsIEFQSSBrZXkgaGFzIHN1ZmZpY2llbnQgcGVybWlzc2lvbnNcclxuLSBUcnkgYWdhaW4gbGF0ZXIgaWYgaXQncyBhIHRlbXBvcmFyeSBzZXJ2aWNlIGlzc3VlXHJcbi0gVmVyaWZ5IHlvdXIgQVBJIHN1YnNjcmlwdGlvbiBzdGF0dXNcclxuYDtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYFBERiBPQ1IgY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3JNZXNzYWdlfWAsXHJcbiAgICAgICAgZXJyb3JEZXRhaWxzOiBlcnJvckRldGFpbHMsXHJcbiAgICAgICAgY29udGVudDogYCMgQ29udmVyc2lvbiBFcnJvclxcblxcbkZhaWxlZCB0byBjb252ZXJ0IFBERiB3aXRoIE9DUjogJHtlcnJvck1lc3NhZ2V9XFxuXFxuIyMgRXJyb3IgRGV0YWlsc1xcblxcbiR7ZXJyb3JEZXRhaWxzfVxcblxcbiR7dHJvdWJsZXNob290aW5nSW5mb31gXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IENvbnZlcnNpb25NYW5hZ2VyOyJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxFQUFFLEdBQUdDLE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDOUIsTUFBTUMsSUFBSSxHQUFHRCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU07RUFBRUUsRUFBRSxFQUFFQztBQUFPLENBQUMsR0FBR0gsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUV0QyxNQUFNSSxnQkFBZ0IsR0FBR0osT0FBTyxDQUFDLG9CQUFvQixDQUFDO0FBQ3RELE1BQU1LLFlBQVksR0FBR0wsT0FBTyxDQUFDLGdCQUFnQixDQUFDO0FBQzlDLE1BQU1NLGlCQUFpQixHQUFHTixPQUFPLENBQUMscUJBQXFCLENBQUM7QUFFeEQsTUFBTU8saUJBQWlCLENBQUM7RUFDdEJDLFdBQVdBLENBQUM7SUFBRUMsYUFBYTtJQUFFQztFQUFZLENBQUMsRUFBRTtJQUMxQyxJQUFJLENBQUNELGFBQWEsR0FBR0Es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