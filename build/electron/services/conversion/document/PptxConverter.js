"use strict";

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
const {
  formatMetadata,
  cleanMetadata
} = require('../../../utils/markdown');
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
  async handleConvert(event, {
    filePath,
    buffer,
    options = {}
  }) {
    try {
      const conversionId = this.generateConversionId();
      const window = event?.sender?.getOwnerBrowserWindow?.() || null;

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

      // Notify client that conversion has started (only if we have a valid window)
      if (window && window.webContents) {
        window.webContents.send('pptx:conversion-started', {
          conversionId
        });
      }
      let content;
      if (buffer) {
        content = Buffer.from(buffer);
      } else if (filePath) {
        this.updateConversionStatus(conversionId, 'reading_file', {
          progress: 10
        });
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
      return {
        content: result
      };
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
  async handlePreview(event, {
    filePath,
    buffer,
    options = {}
  }) {
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
      return {
        content: result
      };
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
      this.updateConversionStatus(conversionId, 'extracting_content', {
        progress: 30
      });

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
      const frontmatter = ['---', `title: ${fileTitle}`, `converted: ${convertedDate}`, 'type: pptx', '---', ''].join('\n');

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiQmFzZVNlcnZpY2UiLCJmb3JtYXRNZXRhZGF0YSIsImNsZWFuTWV0YWRhdGEiLCJvZmZpY2VwYXJzZXIiLCJQcHR4Q29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJzdXBwb3J0ZWRFeHRlbnNpb25zIiwiYWN0aXZlQ29udmVyc2lvbnMiLCJNYXAiLCJzZXR1cElwY0hhbmRsZXJzIiwicmVnaXN0ZXJIYW5kbGVyIiwiaGFuZGxlQ29udmVydCIsImJpbmQiLCJoYW5kbGVQcmV2aWV3IiwiZ2VuZXJhdGVDb252ZXJzaW9uSWQiLCJEYXRlIiwibm93IiwiTWF0aCIsInJhbmRvbSIsInRvU3RyaW5nIiwic3Vic3RyIiwidXBkYXRlQ29udmVyc2lvblN0YXR1cyIsImNvbnZlcnNpb25JZCIsInN0YXR1cyIsImRldGFpbHMiLCJjb252ZXJzaW9uIiwiZ2V0IiwiT2JqZWN0IiwiYXNzaWduIiwid2luZG93Iiwid2ViQ29udGVudHMiLCJzZW5kIiwiZXZlbnQiLCJmaWxlUGF0aCIsImJ1ZmZlciIsIm9wdGlvbnMiLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJ0ZW1wRGlyIiwiY3JlYXRlVGVtcERpciIsInNldCIsImlkIiwicHJvZ3Jlc3MiLCJjb250ZW50IiwiQnVmZmVyIiwiZnJvbSIsImZpbGVSZXN1bHQiLCJoYW5kbGVGaWxlUmVhZCIsImFzQmluYXJ5IiwiRXJyb3IiLCJyZXN1bHQiLCJwcm9jZXNzQ29udmVyc2lvbiIsImZpbGVOYW1lIiwib3JpZ2luYWxGaWxlTmFtZSIsIm5hbWUiLCJiYXNlbmFtZSIsImVycm9yIiwiY29uc29sZSIsImNvbnZlcnRUb01hcmtkb3duIiwiaXNQcmV2aWV3IiwicmVtb3ZlIiwiY2F0Y2giLCJlcnIiLCJta2R0ZW1wIiwiam9pbiIsInRtcGRpciIsInRlbXBGaWxlIiwid3JpdGVGaWxlIiwicGFyc2VyQ29uZmlnIiwibmV3bGluZURlbGltaXRlciIsImlnbm9yZU5vdGVzIiwicHV0Tm90ZXNBdExhc3QiLCJvdXRwdXRFcnJvclRvQ29uc29sZSIsImV4dHJhY3RlZFRleHQiLCJwYXJzZU9mZmljZUFzeW5jIiwic2xpZGVzIiwicHJvY2Vzc0V4dHJhY3RlZFRleHQiLCJzdGF0cyIsInN0YXQiLCJtZXRhZGF0YSIsInRpdGxlIiwiZXh0bmFtZSIsImF1dGhvciIsImRhdGUiLCJ0b0lTT1N0cmluZyIsInNwbGl0Iiwic3ViamVjdCIsInNsaWRlQ291bnQiLCJsZW5ndGgiLCJmaWxlU2l6ZSIsInNpemUiLCJtYXJrZG93bkNvbnRlbnQiLCJmb3JFYWNoIiwic2xpZGUiLCJpbmRleCIsIm5vdGVzIiwiY29udmVydGVkRGF0ZSIsInJlcGxhY2UiLCJmaWxlVGl0bGUiLCJmcm9udG1hdHRlciIsInNsaWRlVGV4dHMiLCJmaWx0ZXIiLCJ0ZXh0IiwidHJpbSIsIm1hcCIsInNsaWRlVGV4dCIsImxpbmVzIiwibm90ZXNJbmRleCIsImluZGV4T2YiLCJzdWJzdHJpbmciLCJzdXBwb3J0c0ZpbGUiLCJleHQiLCJ0b0xvd2VyQ2FzZSIsImluY2x1ZGVzIiwiZ2V0SW5mbyIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9QcHR4Q29udmVydGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUHB0eENvbnZlcnRlci5qc1xuICogSGFuZGxlcyBjb252ZXJzaW9uIG9mIFBQVFggZmlsZXMgdG8gbWFya2Rvd24gZm9ybWF0IGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXG4gKiBcbiAqIFRoaXMgY29udmVydGVyOlxuICogLSBQYXJzZXMgUFBUWCBmaWxlcyB1c2luZyBvZmZpY2VwYXJzZXJcbiAqIC0gRXh0cmFjdHMgdGV4dCwgc2xpZGVzLCBhbmQgbm90ZXNcbiAqIC0gR2VuZXJhdGVzIGNsZWFuIG1hcmtkb3duIG91dHB1dCB3aXRoIHNsaWRlIHN0cnVjdHVyZVxuICogXG4gKiBSZWxhdGVkIEZpbGVzOlxuICogLSBCYXNlU2VydmljZS5qczogUGFyZW50IGNsYXNzIHByb3ZpZGluZyBJUEMgaGFuZGxpbmdcbiAqIC0gRmlsZVByb2Nlc3NvclNlcnZpY2UuanM6IFVzZWQgZm9yIGZpbGUgb3BlcmF0aW9uc1xuICogLSBDb252ZXJzaW9uU2VydmljZS5qczogUmVnaXN0ZXJzIGFuZCB1c2VzIHRoaXMgY29udmVydGVyXG4gKi9cblxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcbmNvbnN0IEJhc2VTZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vQmFzZVNlcnZpY2UnKTtcbmNvbnN0IHsgZm9ybWF0TWV0YWRhdGEsIGNsZWFuTWV0YWRhdGEgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL3V0aWxzL21hcmtkb3duJyk7XG5jb25zdCBvZmZpY2VwYXJzZXIgPSByZXF1aXJlKCdvZmZpY2VwYXJzZXInKTtcblxuY2xhc3MgUHB0eENvbnZlcnRlciBleHRlbmRzIEJhc2VTZXJ2aWNlIHtcbiAgICBjb25zdHJ1Y3RvcihmaWxlUHJvY2Vzc29yLCBmaWxlU3RvcmFnZSkge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yO1xuICAgICAgICB0aGlzLmZpbGVTdG9yYWdlID0gZmlsZVN0b3JhZ2U7XG4gICAgICAgIHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyA9IFsnLnBwdHgnLCAnLnBwdCddO1xuICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zID0gbmV3IE1hcCgpO1xuICAgIH1cbiAgICBcbiAgICAvKipcbiAgICAgKiBTZXQgdXAgSVBDIGhhbmRsZXJzIGZvciBQUFRYIGNvbnZlcnNpb25cbiAgICAgKi9cbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpwcHR4JywgdGhpcy5oYW5kbGVDb252ZXJ0LmJpbmQodGhpcykpO1xuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpwcHR4OnByZXZpZXcnLCB0aGlzLmhhbmRsZVByZXZpZXcuYmluZCh0aGlzKSk7XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlIGEgdW5pcXVlIGNvbnZlcnNpb24gSURcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBVbmlxdWUgY29udmVyc2lvbiBJRFxuICAgICAqL1xuICAgIGdlbmVyYXRlQ29udmVyc2lvbklkKCkge1xuICAgICAgICByZXR1cm4gYHBwdHhfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cigyLCA5KX1gO1xuICAgIH1cbiAgICBcbiAgICAvKipcbiAgICAgKiBVcGRhdGUgY29udmVyc2lvbiBzdGF0dXMgYW5kIG5vdGlmeSByZW5kZXJlclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIGlkZW50aWZpZXJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RhdHVzIC0gTmV3IHN0YXR1c1xuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBkZXRhaWxzIC0gQWRkaXRpb25hbCBkZXRhaWxzXG4gICAgICovXG4gICAgdXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsIHN0YXR1cywgZGV0YWlscyA9IHt9KSB7XG4gICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xuICAgICAgICBpZiAoY29udmVyc2lvbikge1xuICAgICAgICAgICAgY29udmVyc2lvbi5zdGF0dXMgPSBzdGF0dXM7XG4gICAgICAgICAgICBPYmplY3QuYXNzaWduKGNvbnZlcnNpb24sIGRldGFpbHMpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoY29udmVyc2lvbi53aW5kb3cpIHtcbiAgICAgICAgICAgICAgICBjb252ZXJzaW9uLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwcHR4OmNvbnZlcnNpb24tcHJvZ3Jlc3MnLCB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25JZCxcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLFxuICAgICAgICAgICAgICAgICAgICAuLi5kZXRhaWxzXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogSGFuZGxlIFBQVFggY29udmVyc2lvbiByZXF1ZXN0XG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb252ZXJzaW9uIHJlcXVlc3QgZGV0YWlsc1xuICAgICAqL1xuICAgIGFzeW5jIGhhbmRsZUNvbnZlcnQoZXZlbnQsIHsgZmlsZVBhdGgsIGJ1ZmZlciwgb3B0aW9ucyA9IHt9IH0pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb25JZCA9IHRoaXMuZ2VuZXJhdGVDb252ZXJzaW9uSWQoKTtcbiAgICAgICAgICAgIGNvbnN0IHdpbmRvdyA9IGV2ZW50Py5zZW5kZXI/LmdldE93bmVyQnJvd3NlcldpbmRvdz8uKCkgfHwgbnVsbDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3JlYXRlIHRlbXAgZGlyZWN0b3J5IGZvciB0aGlzIGNvbnZlcnNpb25cbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ3BwdHhfY29udmVyc2lvbicpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNldChjb252ZXJzaW9uSWQsIHtcbiAgICAgICAgICAgICAgICBpZDogY29udmVyc2lvbklkLFxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3N0YXJ0aW5nJyxcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMCxcbiAgICAgICAgICAgICAgICBmaWxlUGF0aCxcbiAgICAgICAgICAgICAgICB0ZW1wRGlyLFxuICAgICAgICAgICAgICAgIHdpbmRvd1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIE5vdGlmeSBjbGllbnQgdGhhdCBjb252ZXJzaW9uIGhhcyBzdGFydGVkIChvbmx5IGlmIHdlIGhhdmUgYSB2YWxpZCB3aW5kb3cpXG4gICAgICAgICAgICBpZiAod2luZG93ICYmIHdpbmRvdy53ZWJDb250ZW50cykge1xuICAgICAgICAgICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwcHR4OmNvbnZlcnNpb24tc3RhcnRlZCcsIHsgY29udmVyc2lvbklkIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICBsZXQgY29udGVudDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGJ1ZmZlcikge1xuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBCdWZmZXIuZnJvbShidWZmZXIpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChmaWxlUGF0aCkge1xuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdyZWFkaW5nX2ZpbGUnLCB7IHByb2dyZXNzOiAxMCB9KTtcbiAgICAgICAgICAgICAgICBjb25zdCBmaWxlUmVzdWx0ID0gYXdhaXQgdGhpcy5maWxlUHJvY2Vzc29yLmhhbmRsZUZpbGVSZWFkKG51bGwsIHtcbiAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIGFzQmluYXJ5OiB0cnVlXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IGZpbGVSZXN1bHQuY29udGVudDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBmaWxlIHBhdGggb3IgYnVmZmVyIHByb3ZpZGVkJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFN0YXJ0IGNvbnZlcnNpb24gcHJvY2Vzc1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIGNvbnRlbnQsIHtcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGggfHwgJ3ByZXNlbnRhdGlvbi5wcHR4JylcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4geyBjb250ZW50OiByZXN1bHQgfTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcHR4Q29udmVydGVyXSBDb252ZXJzaW9uIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEhhbmRsZSBQUFRYIHByZXZpZXcgcmVxdWVzdFxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gUHJldmlldyByZXF1ZXN0IGRldGFpbHNcbiAgICAgKi9cbiAgICBhc3luYyBoYW5kbGVQcmV2aWV3KGV2ZW50LCB7IGZpbGVQYXRoLCBidWZmZXIsIG9wdGlvbnMgPSB7fSB9KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBsZXQgY29udGVudDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGJ1ZmZlcikge1xuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBCdWZmZXIuZnJvbShidWZmZXIpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChmaWxlUGF0aCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZpbGVSZXN1bHQgPSBhd2FpdCB0aGlzLmZpbGVQcm9jZXNzb3IuaGFuZGxlRmlsZVJlYWQobnVsbCwge1xuICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgYXNCaW5hcnk6IHRydWVcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gZmlsZVJlc3VsdC5jb250ZW50O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIGZpbGUgcGF0aCBvciBidWZmZXIgcHJvdmlkZWQnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCB7XG4gICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcbiAgICAgICAgICAgICAgICBpc1ByZXZpZXc6IHRydWUsXG4gICAgICAgICAgICAgICAgZmlsZU5hbWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBvcHRpb25zLm5hbWUgfHwgcGF0aC5iYXNlbmFtZShmaWxlUGF0aCB8fCAncHJlc2VudGF0aW9uLnBwdHgnKVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnRlbnQ6IHJlc3VsdCB9O1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BwdHhDb252ZXJ0ZXJdIFByZXZpZXcgZ2VuZXJhdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogUHJvY2VzcyBQUFRYIGNvbnZlcnNpb25cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXG4gICAgICogQHBhcmFtIHtCdWZmZXJ9IGNvbnRlbnQgLSBQUFRYIGNvbnRlbnQgYXMgYnVmZmVyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBNYXJrZG93biBjb250ZW50XG4gICAgICovXG4gICAgYXN5bmMgcHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCBjb250ZW50LCBvcHRpb25zKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcbiAgICAgICAgICAgIGlmICghY29udmVyc2lvbikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVyc2lvbiBub3QgZm91bmQnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2V4dHJhY3RpbmdfY29udGVudCcsIHsgcHJvZ3Jlc3M6IDMwIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGRvY3VtZW50IGNvbnRlbnQgYW5kIG1ldGFkYXRhXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIG9wdGlvbnMpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnY29tcGxldGVkJywgeyBcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMTAwLFxuICAgICAgICAgICAgICAgIHJlc3VsdFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XG4gICAgICAgICAgICBpZiAoY29udmVyc2lvbi50ZW1wRGlyKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGNvbnZlcnNpb24udGVtcERpcikuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BwdHhDb252ZXJ0ZXJdIEZhaWxlZCB0byBjbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeTogJHtjb252ZXJzaW9uLnRlbXBEaXJ9YCwgZXJyKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcHR4Q29udmVydGVyXSBDb252ZXJzaW9uIHByb2Nlc3NpbmcgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24gJiYgY29udmVyc2lvbi50ZW1wRGlyKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGNvbnZlcnNpb24udGVtcERpcikuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BwdHhDb252ZXJ0ZXJdIEZhaWxlZCB0byBjbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeTogJHtjb252ZXJzaW9uLnRlbXBEaXJ9YCwgZXJyKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb252ZXJ0IFBQVFggY29udGVudCB0byBtYXJrZG93blxuICAgICAqIEBwYXJhbSB7QnVmZmVyfSBjb250ZW50IC0gUFBUWCBjb250ZW50IGFzIGJ1ZmZlclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXG4gICAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gTWFya2Rvd24gY29udGVudFxuICAgICAqL1xuICAgIGFzeW5jIGNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIG9wdGlvbnMgPSB7fSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZmlsZU5hbWUgPSBvcHRpb25zLmZpbGVOYW1lIHx8ICdwcmVzZW50YXRpb24ucHB0eCc7XG4gICAgICAgICAgICBjb25zdCBpc1ByZXZpZXcgPSBvcHRpb25zLmlzUHJldmlldyB8fCBmYWxzZTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGZpbGUgdG8gcHJvY2Vzc1xuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IGZzLm1rZHRlbXAocGF0aC5qb2luKHJlcXVpcmUoJ29zJykudG1wZGlyKCksICdwcHR4LWNvbnZlcnNpb24tJykpO1xuICAgICAgICAgICAgY29uc3QgdGVtcEZpbGUgPSBwYXRoLmpvaW4odGVtcERpciwgYCR7b3B0aW9ucy5uYW1lIHx8ICdwcmVzZW50YXRpb24nfS5wcHR4YCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFdyaXRlIGJ1ZmZlciB0byB0ZW1wIGZpbGVcbiAgICAgICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZSh0ZW1wRmlsZSwgY29udGVudCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENvbmZpZ3VyZSBvZmZpY2VwYXJzZXIgb3B0aW9uc1xuICAgICAgICAgICAgY29uc3QgcGFyc2VyQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIG5ld2xpbmVEZWxpbWl0ZXI6ICdcXG4nLFxuICAgICAgICAgICAgICAgIGlnbm9yZU5vdGVzOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBwdXROb3Rlc0F0TGFzdDogZmFsc2UsXG4gICAgICAgICAgICAgICAgb3V0cHV0RXJyb3JUb0NvbnNvbGU6IGZhbHNlXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBFeHRyYWN0IHRleHQgdXNpbmcgb2ZmaWNlcGFyc2VyXG4gICAgICAgICAgICBjb25zdCBleHRyYWN0ZWRUZXh0ID0gYXdhaXQgb2ZmaWNlcGFyc2VyLnBhcnNlT2ZmaWNlQXN5bmModGVtcEZpbGUsIHBhcnNlckNvbmZpZyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFByb2Nlc3MgdGhlIGV4dHJhY3RlZCB0ZXh0IHRvIGNyZWF0ZSBzbGlkZXNcbiAgICAgICAgICAgIGNvbnN0IHNsaWRlcyA9IHRoaXMucHJvY2Vzc0V4dHJhY3RlZFRleHQoZXh0cmFjdGVkVGV4dCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEdldCBmaWxlIHN0YXRzIGZvciBtZXRhZGF0YVxuICAgICAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KHRlbXBGaWxlKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRXh0cmFjdCBiYXNpYyBtZXRhZGF0YVxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSB7XG4gICAgICAgICAgICAgICAgdGl0bGU6IHBhdGguYmFzZW5hbWUoZmlsZU5hbWUsIHBhdGguZXh0bmFtZShmaWxlTmFtZSkpLFxuICAgICAgICAgICAgICAgIGF1dGhvcjogJycsXG4gICAgICAgICAgICAgICAgZGF0ZTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF0sXG4gICAgICAgICAgICAgICAgc3ViamVjdDogJycsXG4gICAgICAgICAgICAgICAgc2xpZGVDb3VudDogc2xpZGVzLmxlbmd0aCxcbiAgICAgICAgICAgICAgICBmaWxlU2l6ZTogc3RhdHMuc2l6ZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgbWFya2Rvd24gY29udGVudFxuICAgICAgICAgICAgbGV0IG1hcmtkb3duQ29udGVudCA9ICcnO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBQcm9jZXNzIGVhY2ggc2xpZGVcbiAgICAgICAgICAgIHNsaWRlcy5mb3JFYWNoKChzbGlkZSwgaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICBtYXJrZG93bkNvbnRlbnQgKz0gYCMjIFNsaWRlICR7aW5kZXggKyAxfTogJHtzbGlkZS50aXRsZSB8fCAnVW50aXRsZWQgU2xpZGUnfVxcblxcbmA7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gQWRkIHNsaWRlIGNvbnRlbnRcbiAgICAgICAgICAgICAgICBpZiAoc2xpZGUuY29udGVudCAmJiBzbGlkZS5jb250ZW50Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd25Db250ZW50ICs9IGAke3NsaWRlLmNvbnRlbnR9XFxuXFxuYDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gQWRkIHNsaWRlIG5vdGVzIGlmIGF2YWlsYWJsZVxuICAgICAgICAgICAgICAgIGlmIChzbGlkZS5ub3RlcyAmJiBzbGlkZS5ub3Rlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duQ29udGVudCArPSBgPiAqKk5vdGVzOioqICR7c2xpZGUubm90ZXN9XFxuXFxuYDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gQWRkIHNlcGFyYXRvciBiZXR3ZWVuIHNsaWRlc1xuICAgICAgICAgICAgICAgIG1hcmtkb3duQ29udGVudCArPSBgLS0tXFxuXFxuYDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxuICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBHZXQgY3VycmVudCBkYXRldGltZVxuICAgICAgICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnRlZERhdGUgPSBub3cudG9JU09TdHJpbmcoKS5zcGxpdCgnLicpWzBdLnJlcGxhY2UoJ1QnLCAnICcpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBHZXQgdGhlIHRpdGxlIGZyb20gbWV0YWRhdGEgb3IgZmlsZW5hbWVcbiAgICAgICAgICAgIGNvbnN0IGZpbGVUaXRsZSA9IG1ldGFkYXRhLnRpdGxlIHx8IHBhdGguYmFzZW5hbWUoZmlsZU5hbWUsIHBhdGguZXh0bmFtZShmaWxlTmFtZSkpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGZyb250bWF0dGVyXG4gICAgICAgICAgICBjb25zdCBmcm9udG1hdHRlciA9IFtcbiAgICAgICAgICAgICAgICAnLS0tJyxcbiAgICAgICAgICAgICAgICBgdGl0bGU6ICR7ZmlsZVRpdGxlfWAsXG4gICAgICAgICAgICAgICAgYGNvbnZlcnRlZDogJHtjb252ZXJ0ZWREYXRlfWAsXG4gICAgICAgICAgICAgICAgJ3R5cGU6IHBwdHgnLFxuICAgICAgICAgICAgICAgICctLS0nLFxuICAgICAgICAgICAgICAgICcnXG4gICAgICAgICAgICBdLmpvaW4oJ1xcbicpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDb21iaW5lIGZyb250bWF0dGVyIGFuZCBjb250ZW50XG4gICAgICAgICAgICByZXR1cm4gZnJvbnRtYXR0ZXIgKyBtYXJrZG93bkNvbnRlbnQ7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUHB0eENvbnZlcnRlcl0gTWFya2Rvd24gY29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogUHJvY2VzcyBleHRyYWN0ZWQgdGV4dCBpbnRvIHNsaWRlc1xuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBleHRyYWN0ZWRUZXh0IC0gVGV4dCBleHRyYWN0ZWQgZnJvbSBQUFRYXG4gICAgICogQHJldHVybnMge0FycmF5fSBBcnJheSBvZiBzbGlkZSBvYmplY3RzXG4gICAgICovXG4gICAgcHJvY2Vzc0V4dHJhY3RlZFRleHQoZXh0cmFjdGVkVGV4dCkge1xuICAgICAgICAvLyBTcGxpdCB0aGUgdGV4dCBieSBzbGlkZSBtYXJrZXJzIG9yIG90aGVyIHBhdHRlcm5zXG4gICAgICAgIC8vIFRoaXMgaXMgYSBzaW1wbGUgaW1wbGVtZW50YXRpb24gYW5kIG1pZ2h0IG5lZWQgcmVmaW5lbWVudCBiYXNlZCBvbiBhY3R1YWwgb3V0cHV0XG4gICAgICAgIGNvbnN0IHNsaWRlVGV4dHMgPSBleHRyYWN0ZWRUZXh0LnNwbGl0KC8oPzpTbGlkZSBcXGQrOj8pL2kpLmZpbHRlcih0ZXh0ID0+IHRleHQudHJpbSgpLmxlbmd0aCA+IDApO1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHNsaWRlVGV4dHMubWFwKHNsaWRlVGV4dCA9PiB7XG4gICAgICAgICAgICAvLyBUcnkgdG8gZXh0cmFjdCBhIHRpdGxlIGZyb20gdGhlIGZpcnN0IGxpbmVcbiAgICAgICAgICAgIGNvbnN0IGxpbmVzID0gc2xpZGVUZXh0LnRyaW0oKS5zcGxpdCgnXFxuJyk7XG4gICAgICAgICAgICBjb25zdCB0aXRsZSA9IGxpbmVzWzBdIHx8ICdVbnRpdGxlZCBTbGlkZSc7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlIGFyZSBub3RlcyAoaW5kaWNhdGVkIGJ5IFwiTm90ZXM6XCIgb3Igc2ltaWxhcilcbiAgICAgICAgICAgIGNvbnN0IG5vdGVzSW5kZXggPSBzbGlkZVRleHQuaW5kZXhPZignTm90ZXM6Jyk7XG4gICAgICAgICAgICBsZXQgY29udGVudCA9ICcnO1xuICAgICAgICAgICAgbGV0IG5vdGVzID0gJyc7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChub3Rlc0luZGV4ID4gLTEpIHtcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gc2xpZGVUZXh0LnN1YnN0cmluZygwLCBub3Rlc0luZGV4KS50cmltKCk7XG4gICAgICAgICAgICAgICAgbm90ZXMgPSBzbGlkZVRleHQuc3Vic3RyaW5nKG5vdGVzSW5kZXggKyA2KS50cmltKCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBzbGlkZVRleHQudHJpbSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHRpdGxlOiB0aXRsZSxcbiAgICAgICAgICAgICAgICBjb250ZW50OiBjb250ZW50LFxuICAgICAgICAgICAgICAgIG5vdGVzOiBub3Rlc1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2hlY2sgaWYgdGhpcyBjb252ZXJ0ZXIgc3VwcG9ydHMgdGhlIGdpdmVuIGZpbGVcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIGZpbGVcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBzdXBwb3J0ZWRcbiAgICAgKi9cbiAgICBzdXBwb3J0c0ZpbGUoZmlsZVBhdGgpIHtcbiAgICAgICAgY29uc3QgZXh0ID0gcGF0aC5leHRuYW1lKGZpbGVQYXRoKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICByZXR1cm4gdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLmluY2x1ZGVzKGV4dCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGNvbnZlcnRlciBpbmZvcm1hdGlvblxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IENvbnZlcnRlciBkZXRhaWxzXG4gICAgICovXG4gICAgZ2V0SW5mbygpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIG5hbWU6ICdQUFRYIENvbnZlcnRlcicsXG4gICAgICAgICAgICBleHRlbnNpb25zOiB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbnZlcnRzIFBQVFggZmlsZXMgdG8gbWFya2Rvd24nLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICAgIHRpdGxlOiAnT3B0aW9uYWwgcHJlc2VudGF0aW9uIHRpdGxlJyxcbiAgICAgICAgICAgICAgICBpc1ByZXZpZXc6ICdXaGV0aGVyIHRvIGdlbmVyYXRlIGEgcHJldmlldyAoZGVmYXVsdDogZmFsc2UpJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBQcHR4Q29udmVydGVyO1xuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1DLEVBQUUsR0FBR0QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUM5QixNQUFNRSxXQUFXLEdBQUdGLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQztBQUNoRCxNQUFN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QUFJLENBQUMsQ0FBQyxDQUFDbEIsS0FBSyxDQUFDLElBQUksQ0FBQztNQUMxQyxNQUFNTCxLQUFLLEdBQUcwQixLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksZ0JBQWdCOztNQUUxQztNQUNBLE1BQU1DLFVBQVUsR0FBR0YsU0FBUyxDQUFDRyxPQUFPLENBQUMsUUFBUSxDQUFDO01BQzlDLElBQUlqRSxPQUFPLEdBQUcsRUFBRTtNQUNoQixJQUFJb0QsS0FBSyxHQUFHLEVBQUU7TUFFZCxJQUFJWSxVQUFVLEdBQUcsQ0FBQyxDQUFDLEVBQUU7UUFDakJoRSxPQUFPLEdBQUc4RCxTQUFTLENBQUNJLFNBQVMsQ0FBQyxDQUFDLEVBQUVGLFVBQVUsQ0FBQyxDQUFDSixJQUFJLENBQUMsQ0FBQztRQUNuRFIsS0FBSyxHQUFHVSxTQUFTLENBQUNJLFNBQVMsQ0FBQ0YsVUFBVSxHQUFHLENBQUMsQ0FBQyxDQUFDSixJQUFJLENBQUMsQ0FBQztNQUN0RCxDQUFDLE1BQU07UUFDSDVELE9BQU8sR0FBRzhELFNBQVMsQ0FBQ0YsSUFBSSxDQUFDLENBQUM7TUFDOUI7TUFFQSxPQUFPO1FBQ0h2QixLQUFLLEVBQUVBLEtBQUs7UUFDWnJDLE9BQU8sRUFBRUEsT0FBTztRQUNoQm9ELEtBQUssRUFBRUE7TUFDWCxDQUFDO0lBQ0wsQ0FBQyxDQUFDO0VBQ047O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJZSxZQUFZQSxDQUFDN0UsUUFBUSxFQUFFO0lBQ25CLE1BQU04RSxHQUFHLEdBQUdwSCxJQUFJLENBQUNzRixPQUFPLENBQUNoRCxRQUFRLENBQUMsQ0FBQytFLFdBQVcsQ0FBQyxDQUFDO0lBQ2hELE9BQU8sSUFBSSxDQUFDMUcsbUJBQW1CLENBQUMyRyxRQUFRLENBQUNGLEdBQUcsQ0FBQztFQUNqRDs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtFQUNJRyxPQUFPQSxDQUFBLEVBQUc7SUFDTixPQUFPO01BQ0g1RCxJQUFJLEVBQUUsZ0JBQWdCO01BQ3RCNkQsVUFBVSxFQUFFLElBQUksQ0FBQzdHLG1CQUFtQjtNQUNwQzhHLFdBQVcsRUFBRSxpQ0FBaUM7TUFDOUNqRixPQUFPLEVBQUU7UUFDTDZDLEtBQUssRUFBRSw2QkFBNkI7UUFDcENyQixTQUFTLEVBQUU7TUFDZjtJQUNKLENBQUM7RUFDTDtBQUNKO0FBRUEwRCxNQUFNLENBQUNDLE9BQU8sR0FBR3BILGFBQWEiLCJpZ25vcmVMaXN0IjpbXX0=