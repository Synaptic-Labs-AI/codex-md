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
    window = null
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

      // Notify client that conversion has started (only if we have a valid window)
      if (window && window.webContents) {
        window.webContents.send('pdf:conversion-started', {
          conversionId
        });
      }

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJwYXRoIiwidjQiLCJ1dWlkdjQiLCJNaXN0cmFsQXBpQ2xpZW50IiwiT2NyUHJvY2Vzc29yIiwiTWFya2Rvd25HZW5lcmF0b3IiLCJDb252ZXJzaW9uTWFuYWdlciIsImNvbnN0cnVjdG9yIiwiZmlsZVByb2Nlc3NvciIsImZpbGVTdG9yYWdlIiwibWlzdHJhbEFwaUNsaWVudCIsIm9jclByb2Nlc3NvciIsIm1hcmtkb3duR2VuZXJhdG9yIiwiYWN0aXZlQ29udmVyc2lvbnMiLCJNYXAiLCJzZXRBcGlLZXkiLCJhcGlLZXkiLCJnZW5lcmF0ZUNvbnZlcnNpb25JZCIsInN0YXJ0Q29udmVyc2lvbiIsImZpbGVQYXRoIiwib3B0aW9ucyIsIndpbmRvdyIsImNvbnNvbGUiLCJsb2ciLCJoYXNBcGlLZXkiLCJoYXNPcHRpb25zQXBpS2V5IiwibWlzdHJhbEFwaUtleSIsImZpbGVOYW1lIiwibmFtZSIsImJhc2VuYW1lIiwiaXNDb25maWd1cmVkIiwiRXJyb3IiLCJjb252ZXJzaW9uSWQiLCJ0ZW1wRGlyIiwiY3JlYXRlVGVtcERpciIsInNldCIsImlkIiwic3RhdHVzIiwicHJvZ3Jlc3MiLCJ3ZWJDb250ZW50cyIsInNlbmQiLCJwcm9jZXNzQ29udmVyc2lvbiIsImNhdGNoIiwiZXJyb3IiLCJ1cGRhdGVDb252ZXJzaW9uU3RhdHVzIiwibWVzc2FnZSIsInJlbW92ZSIsImVyciIsImRhdGEiLCJjb252ZXJzaW9uIiwiZ2V0Iiwid2FybiIsInVuZGVmaW5lZCIsIk9iamVjdCIsImFzc2lnbiIsImlzRGVzdHJveWVkIiwicmVzdWx0IiwiU3RhbmRhcmRQZGZDb252ZXJ0ZXIiLCJzdGFuZGFyZENvbnZlcnRlciIsIm1ldGFkYXRhIiwiZXh0cmFjdE1ldGFkYXRhIiwiZmlsZUJ1ZmZlciIsInJlYWRGaWxlIiwiYXBpUmVzdWx0IiwicHJvY2Vzc0RvY3VtZW50IiwibW9kZWwiLCJsYW5ndWFnZSIsIm9jclJlc3VsdCIsInByb2Nlc3NSZXN1bHQiLCJtYXJrZG93biIsImdlbmVyYXRlQ29tcGxldGVEb2N1bWVudCIsImNoZWNrQXBpS2V5IiwidmFsaWRhdGVBcGlLZXkiLCJ2YWxpZCIsImNvbnZlcnRUb01hcmtkb3duIiwiY29udGVudCIsIm1rZHRlbXAiLCJqb2luIiwidG1wZGlyIiwidGVtcEZpbGUiLCJ3cml0ZUZpbGUiLCJ0aXRsZSIsImF1dGhvciIsInBhZ2VDb3VudCIsImZpbmFsTWFya2Rvd24iLCJzdWNjZXNzIiwidHlwZSIsIm9jckluZm8iLCJkb2N1bWVudEluZm8iLCJwYWdlcyIsImxlbmd0aCIsImNvbmZpZGVuY2UiLCJvdmVyYWxsQ29uZmlkZW5jZSIsImNsZWFudXBFcnJvciIsImVycm9yRGV0YWlscyIsInJlc3BvbnNlIiwiSlNPTiIsInN0cmluZ2lmeSIsImVycm9yTWVzc2FnZSIsInRyb3VibGVzaG9vdGluZ0luZm8iLCJpbmNsdWRlcyIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9taXN0cmFsL0NvbnZlcnNpb25NYW5hZ2VyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBDb252ZXJzaW9uTWFuYWdlci5qc1xyXG4gKiBNYW5hZ2VzIFBERiB0byBtYXJrZG93biBjb252ZXJzaW9uIHdvcmtmbG93IHVzaW5nIE1pc3RyYWwgT0NSXHJcbiAqL1xyXG5cclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IHY0OiB1dWlkdjQgfSA9IHJlcXVpcmUoJ3V1aWQnKTtcclxuXHJcbmNvbnN0IE1pc3RyYWxBcGlDbGllbnQgPSByZXF1aXJlKCcuL01pc3RyYWxBcGlDbGllbnQnKTtcclxuY29uc3QgT2NyUHJvY2Vzc29yID0gcmVxdWlyZSgnLi9PY3JQcm9jZXNzb3InKTtcclxuY29uc3QgTWFya2Rvd25HZW5lcmF0b3IgPSByZXF1aXJlKCcuL01hcmtkb3duR2VuZXJhdG9yJyk7XHJcblxyXG5jbGFzcyBDb252ZXJzaW9uTWFuYWdlciB7XHJcbiAgY29uc3RydWN0b3IoeyBmaWxlUHJvY2Vzc29yLCBmaWxlU3RvcmFnZSB9KSB7XHJcbiAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yO1xyXG4gICAgdGhpcy5maWxlU3RvcmFnZSA9IGZpbGVTdG9yYWdlO1xyXG4gICAgdGhpcy5taXN0cmFsQXBpQ2xpZW50ID0gbmV3IE1pc3RyYWxBcGlDbGllbnQoKTtcclxuICAgIHRoaXMub2NyUHJvY2Vzc29yID0gbmV3IE9jclByb2Nlc3NvcigpO1xyXG4gICAgdGhpcy5tYXJrZG93bkdlbmVyYXRvciA9IG5ldyBNYXJrZG93bkdlbmVyYXRvcigpO1xyXG4gICAgXHJcbiAgICAvLyBDb252ZXJzaW9uIHByb2dyZXNzIHRyYWNraW5nXHJcbiAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zID0gbmV3IE1hcCgpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2V0IE1pc3RyYWwgQVBJIGtleVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcGlLZXkgLSBNaXN0cmFsIEFQSSBrZXlcclxuICAgKi9cclxuICBzZXRBcGlLZXkoYXBpS2V5KSB7XHJcbiAgICB0aGlzLm1pc3RyYWxBcGlDbGllbnQuc2V0QXBpS2V5KGFwaUtleSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZW5lcmF0ZSBhIHVuaXF1ZSBjb252ZXJzaW9uIElEXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gVW5pcXVlIElEXHJcbiAgICovXHJcbiAgZ2VuZXJhdGVDb252ZXJzaW9uSWQoKSB7XHJcbiAgICByZXR1cm4gdXVpZHY0KCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTdGFydCBhIGNvbnZlcnNpb24gcHJvY2Vzc1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBwYXJhbXMgLSBDb252ZXJzaW9uIHBhcmFtZXRlcnNcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gcGFyYW1zLmZpbGVQYXRoIC0gUGF0aCB0byB0aGUgUERGIGZpbGVcclxuICAgKiBAcGFyYW0ge09iamVjdH0gcGFyYW1zLm9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgKiBAcGFyYW0ge0VsZWN0cm9uLkJyb3dzZXJXaW5kb3d9IHBhcmFtcy53aW5kb3cgLSBFbGVjdHJvbiBicm93c2VyIHdpbmRvd1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IENvbnZlcnNpb24gaW5mb3JtYXRpb25cclxuICAgKi9cclxuICBhc3luYyBzdGFydENvbnZlcnNpb24oeyBmaWxlUGF0aCwgb3B0aW9ucyA9IHt9LCB3aW5kb3cgPSBudWxsIH0pIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdbQ29udmVyc2lvbk1hbmFnZXJdIFN0YXJ0aW5nIGNvbnZlcnNpb24gd2l0aCBvcHRpb25zOicsIHtcclxuICAgICAgICBoYXNBcGlLZXk6ICEhdGhpcy5taXN0cmFsQXBpQ2xpZW50LmFwaUtleSxcclxuICAgICAgICBoYXNPcHRpb25zQXBpS2V5OiAhIW9wdGlvbnMubWlzdHJhbEFwaUtleSxcclxuICAgICAgICBmaWxlTmFtZTogb3B0aW9ucy5uYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gVXNlIEFQSSBrZXkgZnJvbSBvcHRpb25zIGlmIGF2YWlsYWJsZVxyXG4gICAgICBpZiAob3B0aW9ucy5taXN0cmFsQXBpS2V5KSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1tDb252ZXJzaW9uTWFuYWdlcl0gVXNpbmcgQVBJIGtleSBmcm9tIG9wdGlvbnMnKTtcclxuICAgICAgICB0aGlzLnNldEFwaUtleShvcHRpb25zLm1pc3RyYWxBcGlLZXkpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBpZiBBUEkga2V5IGlzIGF2YWlsYWJsZVxyXG4gICAgICBpZiAoIXRoaXMubWlzdHJhbEFwaUNsaWVudC5pc0NvbmZpZ3VyZWQoKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignTWlzdHJhbCBBUEkga2V5IG5vdCBjb25maWd1cmVkJyk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGNvbnZlcnNpb25JZCA9IHRoaXMuZ2VuZXJhdGVDb252ZXJzaW9uSWQoKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSB0ZW1wIGRpcmVjdG9yeSBmb3IgdGhpcyBjb252ZXJzaW9uXHJcbiAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ3BkZl9vY3JfY29udmVyc2lvbicpO1xyXG4gICAgICBcclxuICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zZXQoY29udmVyc2lvbklkLCB7XHJcbiAgICAgICAgaWQ6IGNvbnZlcnNpb25JZCxcclxuICAgICAgICBzdGF0dXM6ICdzdGFydGluZycsXHJcbiAgICAgICAgcHJvZ3Jlc3M6IDAsXHJcbiAgICAgICAgZmlsZVBhdGgsXHJcbiAgICAgICAgdGVtcERpcixcclxuICAgICAgICB3aW5kb3dcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBOb3RpZnkgY2xpZW50IHRoYXQgY29udmVyc2lvbiBoYXMgc3RhcnRlZCAob25seSBpZiB3ZSBoYXZlIGEgdmFsaWQgd2luZG93KVxyXG4gICAgICBpZiAod2luZG93ICYmIHdpbmRvdy53ZWJDb250ZW50cykge1xyXG4gICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwZGY6Y29udmVyc2lvbi1zdGFydGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFN0YXJ0IGNvbnZlcnNpb24gcHJvY2VzcyBpbiBiYWNrZ3JvdW5kXHJcbiAgICAgIHRoaXMucHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCBmaWxlUGF0aCwgb3B0aW9ucykuY2F0Y2goZXJyb3IgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFtDb252ZXJzaW9uTWFuYWdlcl0gQ29udmVyc2lvbiBmYWlsZWQgZm9yICR7Y29udmVyc2lvbklkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2ZhaWxlZCcsIHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICBmcy5yZW1vdmUodGVtcERpcikuY2F0Y2goZXJyID0+IHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtDb252ZXJzaW9uTWFuYWdlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIHRlbXAgZGlyZWN0b3J5OiAke3RlbXBEaXJ9YCwgZXJyKTtcclxuICAgICAgICB9KTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICByZXR1cm4geyBjb252ZXJzaW9uSWQgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tDb252ZXJzaW9uTWFuYWdlcl0gRmFpbGVkIHRvIHN0YXJ0IGNvbnZlcnNpb246JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFVwZGF0ZSBjb252ZXJzaW9uIHN0YXR1cyBhbmQgbm90aWZ5IGNsaWVudFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIElEXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHN0YXR1cyAtIE5ldyBzdGF0dXNcclxuICAgKiBAcGFyYW0ge09iamVjdH0gZGF0YSAtIEFkZGl0aW9uYWwgZGF0YVxyXG4gICAqL1xyXG4gIHVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCBzdGF0dXMsIGRhdGEgPSB7fSkge1xyXG4gICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XHJcbiAgICBpZiAoIWNvbnZlcnNpb24pIHtcclxuICAgICAgY29uc29sZS53YXJuKGBbQ29udmVyc2lvbk1hbmFnZXJdIENhbm5vdCB1cGRhdGUgc3RhdHVzIGZvciB1bmtub3duIGNvbnZlcnNpb246ICR7Y29udmVyc2lvbklkfWApO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFVwZGF0ZSBjb252ZXJzaW9uIHN0YXR1c1xyXG4gICAgY29udmVyc2lvbi5zdGF0dXMgPSBzdGF0dXM7XHJcbiAgICBcclxuICAgIC8vIFVwZGF0ZSBwcm9ncmVzcyBpZiBwcm92aWRlZFxyXG4gICAgaWYgKGRhdGEucHJvZ3Jlc3MgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBjb252ZXJzaW9uLnByb2dyZXNzID0gZGF0YS5wcm9ncmVzcztcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gTWVyZ2UgYWRkaXRpb25hbCBkYXRhXHJcbiAgICBPYmplY3QuYXNzaWduKGNvbnZlcnNpb24sIGRhdGEpO1xyXG4gICAgXHJcbiAgICAvLyBOb3RpZnkgY2xpZW50IG9mIHN0YXR1cyBjaGFuZ2VcclxuICAgIGlmIChjb252ZXJzaW9uLndpbmRvdyAmJiAhY29udmVyc2lvbi53aW5kb3cuaXNEZXN0cm95ZWQoKSkge1xyXG4gICAgICBjb252ZXJzaW9uLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwZGY6Y29udmVyc2lvbi1zdGF0dXMnLCB7XHJcbiAgICAgICAgY29udmVyc2lvbklkLFxyXG4gICAgICAgIHN0YXR1cyxcclxuICAgICAgICBwcm9ncmVzczogY29udmVyc2lvbi5wcm9ncmVzcyxcclxuICAgICAgICAuLi5kYXRhXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gSWYgY29udmVyc2lvbiBpcyBjb21wbGV0ZWQgb3IgZmFpbGVkLCBhbHNvIHNlbmQgc3BlY2lmaWMgZXZlbnRcclxuICAgICAgaWYgKHN0YXR1cyA9PT0gJ2NvbXBsZXRlZCcpIHtcclxuICAgICAgICBjb252ZXJzaW9uLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwZGY6Y29udmVyc2lvbi1jb21wbGV0ZWQnLCB7XHJcbiAgICAgICAgICBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICByZXN1bHQ6IGRhdGEucmVzdWx0XHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gZWxzZSBpZiAoc3RhdHVzID09PSAnZmFpbGVkJykge1xyXG4gICAgICAgIGNvbnZlcnNpb24ud2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ3BkZjpjb252ZXJzaW9uLWZhaWxlZCcsIHtcclxuICAgICAgICAgIGNvbnZlcnNpb25JZCxcclxuICAgICAgICAgIGVycm9yOiBkYXRhLmVycm9yXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFByb2Nlc3MgUERGIGNvbnZlcnNpb25cclxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBQREYgZmlsZVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gR2VuZXJhdGVkIG1hcmtkb3duXHJcbiAgICovXHJcbiAgYXN5bmMgcHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCBmaWxlUGF0aCwgb3B0aW9ucykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XHJcbiAgICAgIGlmICghY29udmVyc2lvbikge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVyc2lvbiBub3QgZm91bmQnKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgY29uc3QgdGVtcERpciA9IGNvbnZlcnNpb24udGVtcERpcjtcclxuICAgICAgXHJcbiAgICAgIC8vIEV4dHJhY3QgbWV0YWRhdGEgdXNpbmcgc3RhbmRhcmQgUERGIGV4dHJhY3RvclxyXG4gICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZXh0cmFjdGluZ19tZXRhZGF0YScsIHsgcHJvZ3Jlc3M6IDUgfSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBTdGFuZGFyZFBkZkNvbnZlcnRlciA9IHJlcXVpcmUoJy4uL1N0YW5kYXJkUGRmQ29udmVydGVyJyk7XHJcbiAgICAgIGNvbnN0IHN0YW5kYXJkQ29udmVydGVyID0gbmV3IFN0YW5kYXJkUGRmQ29udmVydGVyKFxyXG4gICAgICAgIHRoaXMuZmlsZVByb2Nlc3NvcixcclxuICAgICAgICB0aGlzLmZpbGVTdG9yYWdlXHJcbiAgICAgICk7XHJcbiAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgc3RhbmRhcmRDb252ZXJ0ZXIuZXh0cmFjdE1ldGFkYXRhKGZpbGVQYXRoKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFByb2Nlc3Mgd2l0aCBPQ1JcclxuICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ3Byb2Nlc3Npbmdfb2NyJywgeyBwcm9ncmVzczogMTAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBSZWFkIGZpbGUgYXMgYnVmZmVyXHJcbiAgICAgIGNvbnN0IGZpbGVCdWZmZXIgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBQcm9jZXNzIHdpdGggTWlzdHJhbCBPQ1IgQVBJXHJcbiAgICAgIGNvbnN0IGFwaVJlc3VsdCA9IGF3YWl0IHRoaXMubWlzdHJhbEFwaUNsaWVudC5wcm9jZXNzRG9jdW1lbnQoXHJcbiAgICAgICAgZmlsZUJ1ZmZlcixcclxuICAgICAgICBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICBtb2RlbDogXCJtaXN0cmFsLW9jci1sYXRlc3RcIixcclxuICAgICAgICAgIGxhbmd1YWdlOiBvcHRpb25zLmxhbmd1YWdlXHJcbiAgICAgICAgfVxyXG4gICAgICApO1xyXG4gICAgICBcclxuICAgICAgLy8gUHJvY2VzcyBPQ1IgcmVzdWx0c1xyXG4gICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAncHJvY2Vzc2luZ19yZXN1bHRzJywgeyBwcm9ncmVzczogNzAgfSk7XHJcbiAgICAgIGNvbnN0IG9jclJlc3VsdCA9IHRoaXMub2NyUHJvY2Vzc29yLnByb2Nlc3NSZXN1bHQoYXBpUmVzdWx0KTtcclxuICAgICAgXHJcbiAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duXHJcbiAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdnZW5lcmF0aW5nX21hcmtkb3duJywgeyBwcm9ncmVzczogOTAgfSk7XHJcbiAgICAgIGNvbnN0IG1hcmtkb3duID0gdGhpcy5tYXJrZG93bkdlbmVyYXRvci5nZW5lcmF0ZUNvbXBsZXRlRG9jdW1lbnQobWV0YWRhdGEsIG9jclJlc3VsdCwgb3B0aW9ucyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgIFxyXG4gICAgICAvLyBVcGRhdGUgY29udmVyc2lvbiBzdGF0dXMgdG8gY29tcGxldGVkXHJcbiAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdjb21wbGV0ZWQnLCB7IFxyXG4gICAgICAgIHByb2dyZXNzOiAxMDAsXHJcbiAgICAgICAgcmVzdWx0OiBtYXJrZG93blxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiBtYXJrZG93bjtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tDb252ZXJzaW9uTWFuYWdlcl0gQ29udmVyc2lvbiBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2hlY2sgaWYgTWlzdHJhbCBBUEkga2V5IGlzIHZhbGlkXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGFwaUtleSAtIEFQSSBrZXkgdG8gY2hlY2tcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBWYWxpZGF0aW9uIHJlc3VsdFxyXG4gICAqL1xyXG4gIGFzeW5jIGNoZWNrQXBpS2V5KGFwaUtleSkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVGVtcG9yYXJpbHkgc2V0IEFQSSBrZXkgaWYgcHJvdmlkZWRcclxuICAgICAgaWYgKGFwaUtleSkge1xyXG4gICAgICAgIHRoaXMubWlzdHJhbEFwaUNsaWVudC5zZXRBcGlLZXkoYXBpS2V5KTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMubWlzdHJhbEFwaUNsaWVudC52YWxpZGF0ZUFwaUtleSgpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignW0NvbnZlcnNpb25NYW5hZ2VyXSBBUEkga2V5IGNoZWNrIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7IHZhbGlkOiBmYWxzZSwgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENvbnZlcnQgUERGIGNvbnRlbnQgdG8gbWFya2Rvd24gKGRpcmVjdCBtZXRob2QgZm9yIENvbnZlcnRlclJlZ2lzdHJ5KVxyXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBjb250ZW50IC0gUERGIGNvbnRlbnQgYXMgYnVmZmVyXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBDb252ZXJzaW9uIHJlc3VsdFxyXG4gICAqL1xyXG4gIGFzeW5jIGNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgbGV0IHRlbXBEaXIgPSBudWxsO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgW0NvbnZlcnNpb25NYW5hZ2VyXSBDb252ZXJ0aW5nIFBERiB3aXRoIE9DUjogJHtvcHRpb25zLm5hbWUgfHwgJ3VubmFtZWQnfWApO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgaWYgQVBJIGtleSBpcyBhdmFpbGFibGUgZnJvbSBtdWx0aXBsZSBzb3VyY2VzXHJcbiAgICAgIGlmIChvcHRpb25zLmFwaUtleSkge1xyXG4gICAgICAgIHRoaXMuc2V0QXBpS2V5KG9wdGlvbnMuYXBpS2V5KTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgaWYgKCF0aGlzLm1pc3RyYWxBcGlDbGllbnQuaXNDb25maWd1cmVkKCkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ01pc3RyYWwgQVBJIGtleSBub3QgY29uZmlndXJlZCcpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgYSB0ZW1wb3JhcnkgZmlsZSB0byBwcm9jZXNzXHJcbiAgICAgIHRlbXBEaXIgPSBhd2FpdCBmcy5ta2R0ZW1wKHBhdGguam9pbihyZXF1aXJlKCdvcycpLnRtcGRpcigpLCAncGRmLW9jci1jb252ZXJzaW9uLScpKTtcclxuICAgICAgY29uc3QgdGVtcEZpbGUgPSBwYXRoLmpvaW4odGVtcERpciwgYCR7b3B0aW9ucy5uYW1lIHx8ICdkb2N1bWVudCd9LnBkZmApO1xyXG4gICAgICBcclxuICAgICAgLy8gV3JpdGUgYnVmZmVyIHRvIHRlbXAgZmlsZVxyXG4gICAgICBhd2FpdCBmcy53cml0ZUZpbGUodGVtcEZpbGUsIGNvbnRlbnQpO1xyXG4gICAgICBcclxuICAgICAgLy8gRXh0cmFjdCBtZXRhZGF0YSB1c2luZyBzdGFuZGFyZCBtZXRob2RzXHJcbiAgICAgIGNvbnN0IFN0YW5kYXJkUGRmQ29udmVydGVyID0gcmVxdWlyZSgnLi4vU3RhbmRhcmRQZGZDb252ZXJ0ZXInKTtcclxuICAgICAgY29uc3Qgc3RhbmRhcmRDb252ZXJ0ZXIgPSBuZXcgU3RhbmRhcmRQZGZDb252ZXJ0ZXIoKTtcclxuICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCBzdGFuZGFyZENvbnZlcnRlci5leHRyYWN0TWV0YWRhdGEodGVtcEZpbGUpO1xyXG4gICAgICBcclxuICAgICAgLy8gTG9nIG1ldGFkYXRhIGZvciBkZWJ1Z2dpbmdcclxuICAgICAgY29uc29sZS5sb2coJ1tDb252ZXJzaW9uTWFuYWdlcl0gRXh0cmFjdGVkIG1ldGFkYXRhOicsIHtcclxuICAgICAgICB0aXRsZTogbWV0YWRhdGEudGl0bGUsXHJcbiAgICAgICAgYXV0aG9yOiBtZXRhZGF0YS5hdXRob3IsXHJcbiAgICAgICAgcGFnZUNvdW50OiBtZXRhZGF0YS5wYWdlQ291bnRcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBQcm9jZXNzIHdpdGggTWlzdHJhbCBPQ1IgQVBJXHJcbiAgICAgIGNvbnNvbGUubG9nKCdbQ29udmVyc2lvbk1hbmFnZXJdIFByb2Nlc3NpbmcgUERGIHdpdGggT0NSJyk7XHJcbiAgICAgIGNvbnN0IGFwaVJlc3VsdCA9IGF3YWl0IHRoaXMubWlzdHJhbEFwaUNsaWVudC5wcm9jZXNzRG9jdW1lbnQoXHJcbiAgICAgICAgY29udGVudCxcclxuICAgICAgICBvcHRpb25zLm5hbWUgfHwgJ2RvY3VtZW50LnBkZicsXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgbW9kZWw6IFwibWlzdHJhbC1vY3ItbGF0ZXN0XCIsXHJcbiAgICAgICAgICBsYW5ndWFnZTogb3B0aW9ucy5sYW5ndWFnZVxyXG4gICAgICAgIH1cclxuICAgICAgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFByb2Nlc3MgT0NSIHJlc3VsdHNcclxuICAgICAgY29uc3Qgb2NyUmVzdWx0ID0gdGhpcy5vY3JQcm9jZXNzb3IucHJvY2Vzc1Jlc3VsdChhcGlSZXN1bHQpO1xyXG4gICAgICBcclxuICAgICAgLy8gR2VuZXJhdGUgbWFya2Rvd25cclxuICAgICAgY29uc3QgZmluYWxNYXJrZG93biA9IHRoaXMubWFya2Rvd25HZW5lcmF0b3IuZ2VuZXJhdGVDb21wbGV0ZURvY3VtZW50KG1ldGFkYXRhLCBvY3JSZXN1bHQsIG9wdGlvbnMpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ3JlYXRlIHJlc3VsdCBvYmplY3Qgd2l0aCBlbmhhbmNlZCBpbmZvcm1hdGlvblxyXG4gICAgICBjb25zdCByZXN1bHQgPSB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICBjb250ZW50OiBmaW5hbE1hcmtkb3duLFxyXG4gICAgICAgIHR5cGU6ICdwZGYnLFxyXG4gICAgICAgIG5hbWU6IG9wdGlvbnMubmFtZSB8fCAnZG9jdW1lbnQucGRmJyxcclxuICAgICAgICBtZXRhZGF0YTogbWV0YWRhdGEsXHJcbiAgICAgICAgb2NySW5mbzoge1xyXG4gICAgICAgICAgbW9kZWw6IG9jclJlc3VsdD8uZG9jdW1lbnRJbmZvPy5tb2RlbCB8fCAndW5rbm93bicsXHJcbiAgICAgICAgICBsYW5ndWFnZTogb2NyUmVzdWx0Py5kb2N1bWVudEluZm8/Lmxhbmd1YWdlIHx8ICd1bmtub3duJyxcclxuICAgICAgICAgIHBhZ2VDb3VudDogb2NyUmVzdWx0Py5wYWdlcz8ubGVuZ3RoIHx8IDAsXHJcbiAgICAgICAgICBjb25maWRlbmNlOiBvY3JSZXN1bHQ/LmRvY3VtZW50SW5mbz8ub3ZlcmFsbENvbmZpZGVuY2UgfHwgMFxyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuICAgICAgXHJcbiAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XHJcbiAgICAgIGlmICh0ZW1wRGlyKSB7XHJcbiAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpXHJcbiAgICAgICAgICAuY2F0Y2goZXJyID0+IGNvbnNvbGUuZXJyb3IoJ1tDb252ZXJzaW9uTWFuYWdlcl0gRXJyb3IgY2xlYW5pbmcgdXAgdGVtcCBkaXJlY3Rvcnk6JywgZXJyKSk7XHJcbiAgICAgICAgdGVtcERpciA9IG51bGw7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdbQ29udmVyc2lvbk1hbmFnZXJdIERpcmVjdCBjb252ZXJzaW9uIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeSBpZiBpdCBleGlzdHNcclxuICAgICAgaWYgKHRlbXBEaXIpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcignW0NvbnZlcnNpb25NYW5hZ2VyXSBFcnJvciBjbGVhbmluZyB1cCB0ZW1wIGRpcmVjdG9yeTonLCBjbGVhbnVwRXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gQ3JlYXRlIGEgbW9yZSBkZXRhaWxlZCBlcnJvciBtZXNzYWdlXHJcbiAgICAgIGNvbnN0IGVycm9yRGV0YWlscyA9IGVycm9yLnJlc3BvbnNlID9cclxuICAgICAgICBgQVBJIHJlc3BvbnNlOiAke0pTT04uc3RyaW5naWZ5KGVycm9yLnJlc3BvbnNlLmRhdGEgfHwge30pfWAgOlxyXG4gICAgICAgIGVycm9yLm1lc3NhZ2U7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBpZiB0aGlzIGlzIGEgNTAwIEludGVybmFsIFNlcnZlciBFcnJvclxyXG4gICAgICBsZXQgZXJyb3JNZXNzYWdlID0gZXJyb3IubWVzc2FnZTtcclxuICAgICAgbGV0IHRyb3VibGVzaG9vdGluZ0luZm8gPSAnJztcclxuICAgICAgXHJcbiAgICAgIGlmIChlcnJvci5tZXNzYWdlLmluY2x1ZGVzKCc1MDAnKSB8fCBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKCdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InKSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tDb252ZXJzaW9uTWFuYWdlcl0gRGV0ZWN0ZWQgNTAwIEludGVybmFsIFNlcnZlciBFcnJvcicpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCB0cm91Ymxlc2hvb3RpbmcgaW5mb3JtYXRpb24gZm9yIDUwMCBlcnJvcnNcclxuICAgICAgICB0cm91Ymxlc2hvb3RpbmdJbmZvID0gYFxyXG4jIyBUcm91Ymxlc2hvb3RpbmcgNTAwIEludGVybmFsIFNlcnZlciBFcnJvclxyXG5cclxuVGhpcyBlcnJvciBtYXkgYmUgY2F1c2VkIGJ5OlxyXG5cclxuMS4gKipGaWxlIFNpemUgTGltaXQqKjogVGhlIFBERiBmaWxlIG1heSBleGNlZWQgTWlzdHJhbCdzIDUwTUIgc2l6ZSBsaW1pdC5cclxuMi4gKipBUEkgU2VydmljZSBJc3N1ZXMqKjogTWlzdHJhbCdzIEFQSSBtYXkgYmUgZXhwZXJpZW5jaW5nIHRlbXBvcmFyeSBpc3N1ZXMuXHJcbjMuICoqUmF0ZSBMaW1pdGluZyoqOiBZb3UgbWF5IGhhdmUgZXhjZWVkZWQgdGhlIEFQSSByYXRlIGxpbWl0cy5cclxuNC4gKipNYWxmb3JtZWQgUmVxdWVzdCoqOiBUaGUgcmVxdWVzdCBmb3JtYXQgbWF5IG5vdCBtYXRjaCBNaXN0cmFsJ3MgQVBJIHJlcXVpcmVtZW50cy5cclxuXHJcbiMjIyBTdWdnZXN0ZWQgQWN0aW9uczpcclxuLSBUcnkgd2l0aCBhIHNtYWxsZXIgUERGIGZpbGVcclxuLSBDaGVjayBpZiB5b3VyIE1pc3RyYWwgQVBJIGtleSBoYXMgc3VmZmljaWVudCBwZXJtaXNzaW9uc1xyXG4tIFRyeSBhZ2FpbiBsYXRlciBpZiBpdCdzIGEgdGVtcG9yYXJ5IHNlcnZpY2UgaXNzdWVcclxuLSBWZXJpZnkgeW91ciBBUEkgc3Vic2NyaXB0aW9uIHN0YXR1c1xyXG5gO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBgUERGIE9DUiBjb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvck1lc3NhZ2V9YCxcclxuICAgICAgICBlcnJvckRldGFpbHM6IGVycm9yRGV0YWlscyxcclxuICAgICAgICBjb250ZW50OiBgIyBDb252ZXJzaW9uIEVycm9yXFxuXFxuRmFpbGVkIHRvIGNvbnZlcnQgUERGIHdpdGggT0NSOiAke2Vycm9yTWVzc2FnZX1cXG5cXG4jIyBFcnJvciBEZXRhaWxzXFxuXFxuJHtlcnJvckRldGFpbHN9XFxuXFxuJHt0cm91Ymxlc2hvb3RpbmdJbmZvfWBcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gQ29udmVyc2lvbk1hbmFnZXI7Il0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLEVBQUUsR0FBR0MsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUM5QixNQUFNQyxJQUFJLEdBQUdELE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTTtFQUFFRSxFQUFFLEVBQUVDO0FBQU8sQ0FBQyxHQUFHSCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBRXRDLE1BQU1JLGdCQUFnQixHQUFHSixPQUFPLENBQUMsb0JBQW9CLENBQUM7QUFDdEQsTUFBTUssWUFBWSxHQUFHTCxPQUFPLENBQUMsZ0JBQWdCLENBQUM7QUFDOUMsTUFBTU0saUJBQWlCLEdBQUdOLE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQztBQUV4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