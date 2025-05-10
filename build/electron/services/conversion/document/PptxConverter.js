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
      window.webContents.send('pptx:conversion-started', {
        conversionId
      });
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiQmFzZVNlcnZpY2UiLCJmb3JtYXRNZXRhZGF0YSIsImNsZWFuTWV0YWRhdGEiLCJvZmZpY2VwYXJzZXIiLCJQcHR4Q29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJzdXBwb3J0ZWRFeHRlbnNpb25zIiwiYWN0aXZlQ29udmVyc2lvbnMiLCJNYXAiLCJzZXR1cElwY0hhbmRsZXJzIiwicmVnaXN0ZXJIYW5kbGVyIiwiaGFuZGxlQ29udmVydCIsImJpbmQiLCJoYW5kbGVQcmV2aWV3IiwiZ2VuZXJhdGVDb252ZXJzaW9uSWQiLCJEYXRlIiwibm93IiwiTWF0aCIsInJhbmRvbSIsInRvU3RyaW5nIiwic3Vic3RyIiwidXBkYXRlQ29udmVyc2lvblN0YXR1cyIsImNvbnZlcnNpb25JZCIsInN0YXR1cyIsImRldGFpbHMiLCJjb252ZXJzaW9uIiwiZ2V0IiwiT2JqZWN0IiwiYXNzaWduIiwid2luZG93Iiwid2ViQ29udGVudHMiLCJzZW5kIiwiZXZlbnQiLCJmaWxlUGF0aCIsImJ1ZmZlciIsIm9wdGlvbnMiLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJ0ZW1wRGlyIiwiY3JlYXRlVGVtcERpciIsInNldCIsImlkIiwicHJvZ3Jlc3MiLCJjb250ZW50IiwiQnVmZmVyIiwiZnJvbSIsImZpbGVSZXN1bHQiLCJoYW5kbGVGaWxlUmVhZCIsImFzQmluYXJ5IiwiRXJyb3IiLCJyZXN1bHQiLCJwcm9jZXNzQ29udmVyc2lvbiIsImZpbGVOYW1lIiwib3JpZ2luYWxGaWxlTmFtZSIsIm5hbWUiLCJiYXNlbmFtZSIsImVycm9yIiwiY29uc29sZSIsImNvbnZlcnRUb01hcmtkb3duIiwiaXNQcmV2aWV3IiwicmVtb3ZlIiwiY2F0Y2giLCJlcnIiLCJta2R0ZW1wIiwiam9pbiIsInRtcGRpciIsInRlbXBGaWxlIiwid3JpdGVGaWxlIiwicGFyc2VyQ29uZmlnIiwibmV3bGluZURlbGltaXRlciIsImlnbm9yZU5vdGVzIiwicHV0Tm90ZXNBdExhc3QiLCJvdXRwdXRFcnJvclRvQ29uc29sZSIsImV4dHJhY3RlZFRleHQiLCJwYXJzZU9mZmljZUFzeW5jIiwic2xpZGVzIiwicHJvY2Vzc0V4dHJhY3RlZFRleHQiLCJzdGF0cyIsInN0YXQiLCJtZXRhZGF0YSIsInRpdGxlIiwiZXh0bmFtZSIsImF1dGhvciIsImRhdGUiLCJ0b0lTT1N0cmluZyIsInNwbGl0Iiwic3ViamVjdCIsInNsaWRlQ291bnQiLCJsZW5ndGgiLCJmaWxlU2l6ZSIsInNpemUiLCJtYXJrZG93bkNvbnRlbnQiLCJmb3JFYWNoIiwic2xpZGUiLCJpbmRleCIsIm5vdGVzIiwiY29udmVydGVkRGF0ZSIsInJlcGxhY2UiLCJmaWxlVGl0bGUiLCJmcm9udG1hdHRlciIsInNsaWRlVGV4dHMiLCJmaWx0ZXIiLCJ0ZXh0IiwidHJpbSIsIm1hcCIsInNsaWRlVGV4dCIsImxpbmVzIiwibm90ZXNJbmRleCIsImluZGV4T2YiLCJzdWJzdHJpbmciLCJzdXBwb3J0c0ZpbGUiLCJleHQiLCJ0b0xvd2VyQ2FzZSIsImluY2x1ZGVzIiwiZ2V0SW5mbyIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9QcHR4Q29udmVydGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUHB0eENvbnZlcnRlci5qc1xuICogSGFuZGxlcyBjb252ZXJzaW9uIG9mIFBQVFggZmlsZXMgdG8gbWFya2Rvd24gZm9ybWF0IGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXG4gKiBcbiAqIFRoaXMgY29udmVydGVyOlxuICogLSBQYXJzZXMgUFBUWCBmaWxlcyB1c2luZyBvZmZpY2VwYXJzZXJcbiAqIC0gRXh0cmFjdHMgdGV4dCwgc2xpZGVzLCBhbmQgbm90ZXNcbiAqIC0gR2VuZXJhdGVzIGNsZWFuIG1hcmtkb3duIG91dHB1dCB3aXRoIHNsaWRlIHN0cnVjdHVyZVxuICogXG4gKiBSZWxhdGVkIEZpbGVzOlxuICogLSBCYXNlU2VydmljZS5qczogUGFyZW50IGNsYXNzIHByb3ZpZGluZyBJUEMgaGFuZGxpbmdcbiAqIC0gRmlsZVByb2Nlc3NvclNlcnZpY2UuanM6IFVzZWQgZm9yIGZpbGUgb3BlcmF0aW9uc1xuICogLSBDb252ZXJzaW9uU2VydmljZS5qczogUmVnaXN0ZXJzIGFuZCB1c2VzIHRoaXMgY29udmVydGVyXG4gKi9cblxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcbmNvbnN0IEJhc2VTZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vQmFzZVNlcnZpY2UnKTtcbmNvbnN0IHsgZm9ybWF0TWV0YWRhdGEsIGNsZWFuTWV0YWRhdGEgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL3V0aWxzL21hcmtkb3duJyk7XG5jb25zdCBvZmZpY2VwYXJzZXIgPSByZXF1aXJlKCdvZmZpY2VwYXJzZXInKTtcblxuY2xhc3MgUHB0eENvbnZlcnRlciBleHRlbmRzIEJhc2VTZXJ2aWNlIHtcbiAgICBjb25zdHJ1Y3RvcihmaWxlUHJvY2Vzc29yLCBmaWxlU3RvcmFnZSkge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yO1xuICAgICAgICB0aGlzLmZpbGVTdG9yYWdlID0gZmlsZVN0b3JhZ2U7XG4gICAgICAgIHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucyA9IFsnLnBwdHgnLCAnLnBwdCddO1xuICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zID0gbmV3IE1hcCgpO1xuICAgIH1cbiAgICBcbiAgICAvKipcbiAgICAgKiBTZXQgdXAgSVBDIGhhbmRsZXJzIGZvciBQUFRYIGNvbnZlcnNpb25cbiAgICAgKi9cbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpwcHR4JywgdGhpcy5oYW5kbGVDb252ZXJ0LmJpbmQodGhpcykpO1xuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpwcHR4OnByZXZpZXcnLCB0aGlzLmhhbmRsZVByZXZpZXcuYmluZCh0aGlzKSk7XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlIGEgdW5pcXVlIGNvbnZlcnNpb24gSURcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBVbmlxdWUgY29udmVyc2lvbiBJRFxuICAgICAqL1xuICAgIGdlbmVyYXRlQ29udmVyc2lvbklkKCkge1xuICAgICAgICByZXR1cm4gYHBwdHhfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cigyLCA5KX1gO1xuICAgIH1cbiAgICBcbiAgICAvKipcbiAgICAgKiBVcGRhdGUgY29udmVyc2lvbiBzdGF0dXMgYW5kIG5vdGlmeSByZW5kZXJlclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIGlkZW50aWZpZXJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RhdHVzIC0gTmV3IHN0YXR1c1xuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBkZXRhaWxzIC0gQWRkaXRpb25hbCBkZXRhaWxzXG4gICAgICovXG4gICAgdXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsIHN0YXR1cywgZGV0YWlscyA9IHt9KSB7XG4gICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xuICAgICAgICBpZiAoY29udmVyc2lvbikge1xuICAgICAgICAgICAgY29udmVyc2lvbi5zdGF0dXMgPSBzdGF0dXM7XG4gICAgICAgICAgICBPYmplY3QuYXNzaWduKGNvbnZlcnNpb24sIGRldGFpbHMpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoY29udmVyc2lvbi53aW5kb3cpIHtcbiAgICAgICAgICAgICAgICBjb252ZXJzaW9uLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwcHR4OmNvbnZlcnNpb24tcHJvZ3Jlc3MnLCB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25JZCxcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLFxuICAgICAgICAgICAgICAgICAgICAuLi5kZXRhaWxzXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogSGFuZGxlIFBQVFggY29udmVyc2lvbiByZXF1ZXN0XG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb252ZXJzaW9uIHJlcXVlc3QgZGV0YWlsc1xuICAgICAqL1xuICAgIGFzeW5jIGhhbmRsZUNvbnZlcnQoZXZlbnQsIHsgZmlsZVBhdGgsIGJ1ZmZlciwgb3B0aW9ucyA9IHt9IH0pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb25JZCA9IHRoaXMuZ2VuZXJhdGVDb252ZXJzaW9uSWQoKTtcbiAgICAgICAgICAgIGNvbnN0IHdpbmRvdyA9IGV2ZW50LnNlbmRlci5nZXRPd25lckJyb3dzZXJXaW5kb3coKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3JlYXRlIHRlbXAgZGlyZWN0b3J5IGZvciB0aGlzIGNvbnZlcnNpb25cbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ3BwdHhfY29udmVyc2lvbicpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNldChjb252ZXJzaW9uSWQsIHtcbiAgICAgICAgICAgICAgICBpZDogY29udmVyc2lvbklkLFxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3N0YXJ0aW5nJyxcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMCxcbiAgICAgICAgICAgICAgICBmaWxlUGF0aCxcbiAgICAgICAgICAgICAgICB0ZW1wRGlyLFxuICAgICAgICAgICAgICAgIHdpbmRvd1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIE5vdGlmeSBjbGllbnQgdGhhdCBjb252ZXJzaW9uIGhhcyBzdGFydGVkXG4gICAgICAgICAgICB3aW5kb3cud2ViQ29udGVudHMuc2VuZCgncHB0eDpjb252ZXJzaW9uLXN0YXJ0ZWQnLCB7IGNvbnZlcnNpb25JZCB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgbGV0IGNvbnRlbnQ7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChidWZmZXIpIHtcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gQnVmZmVyLmZyb20oYnVmZmVyKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZmlsZVBhdGgpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAncmVhZGluZ19maWxlJywgeyBwcm9ncmVzczogMTAgfSk7XG4gICAgICAgICAgICAgICAgY29uc3QgZmlsZVJlc3VsdCA9IGF3YWl0IHRoaXMuZmlsZVByb2Nlc3Nvci5oYW5kbGVGaWxlUmVhZChudWxsLCB7XG4gICAgICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxuICAgICAgICAgICAgICAgICAgICBhc0JpbmFyeTogdHJ1ZVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBmaWxlUmVzdWx0LmNvbnRlbnQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gZmlsZSBwYXRoIG9yIGJ1ZmZlciBwcm92aWRlZCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBTdGFydCBjb252ZXJzaW9uIHByb2Nlc3NcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCBjb250ZW50LCB7XG4gICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcbiAgICAgICAgICAgICAgICBmaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IG9wdGlvbnMubmFtZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoIHx8ICdwcmVzZW50YXRpb24ucHB0eCcpXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHsgY29udGVudDogcmVzdWx0IH07XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUHB0eENvbnZlcnRlcl0gQ29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBIYW5kbGUgUFBUWCBwcmV2aWV3IHJlcXVlc3RcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFByZXZpZXcgcmVxdWVzdCBkZXRhaWxzXG4gICAgICovXG4gICAgYXN5bmMgaGFuZGxlUHJldmlldyhldmVudCwgeyBmaWxlUGF0aCwgYnVmZmVyLCBvcHRpb25zID0ge30gfSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgbGV0IGNvbnRlbnQ7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChidWZmZXIpIHtcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gQnVmZmVyLmZyb20oYnVmZmVyKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZmlsZVBhdGgpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBmaWxlUmVzdWx0ID0gYXdhaXQgdGhpcy5maWxlUHJvY2Vzc29yLmhhbmRsZUZpbGVSZWFkKG51bGwsIHtcbiAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIGFzQmluYXJ5OiB0cnVlXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IGZpbGVSZXN1bHQuY29udGVudDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBmaWxlIHBhdGggb3IgYnVmZmVyIHByb3ZpZGVkJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29udmVydFRvTWFya2Rvd24oY29udGVudCwge1xuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgICAgICAgICAgaXNQcmV2aWV3OiB0cnVlLFxuICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGggfHwgJ3ByZXNlbnRhdGlvbi5wcHR4JylcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4geyBjb250ZW50OiByZXN1bHQgfTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcHR4Q29udmVydGVyXSBQcmV2aWV3IGdlbmVyYXRpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIFByb2Nlc3MgUFBUWCBjb252ZXJzaW9uXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxuICAgICAqIEBwYXJhbSB7QnVmZmVyfSBjb250ZW50IC0gUFBUWCBjb250ZW50IGFzIGJ1ZmZlclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXG4gICAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gTWFya2Rvd24gY29udGVudFxuICAgICAqL1xuICAgIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgY29udGVudCwgb3B0aW9ucykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XG4gICAgICAgICAgICBpZiAoIWNvbnZlcnNpb24pIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbnZlcnNpb24gbm90IGZvdW5kJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdleHRyYWN0aW5nX2NvbnRlbnQnLCB7IHByb2dyZXNzOiAzMCB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRXh0cmFjdCBkb2N1bWVudCBjb250ZW50IGFuZCBtZXRhZGF0YVxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCBvcHRpb25zKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2NvbXBsZXRlZCcsIHsgXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDEwMCxcbiAgICAgICAgICAgICAgICByZXN1bHRcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24udGVtcERpcikge1xuICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZShjb252ZXJzaW9uLnRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQcHR4Q29udmVydGVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3Rvcnk6ICR7Y29udmVyc2lvbi50ZW1wRGlyfWAsIGVycik7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUHB0eENvbnZlcnRlcl0gQ29udmVyc2lvbiBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uICYmIGNvbnZlcnNpb24udGVtcERpcikge1xuICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZShjb252ZXJzaW9uLnRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQcHR4Q29udmVydGVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3Rvcnk6ICR7Y29udmVyc2lvbi50ZW1wRGlyfWAsIGVycik7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29udmVydCBQUFRYIGNvbnRlbnQgdG8gbWFya2Rvd25cbiAgICAgKiBAcGFyYW0ge0J1ZmZlcn0gY29udGVudCAtIFBQVFggY29udGVudCBhcyBidWZmZXJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IE1hcmtkb3duIGNvbnRlbnRcbiAgICAgKi9cbiAgICBhc3luYyBjb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCBvcHRpb25zID0ge30pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gb3B0aW9ucy5maWxlTmFtZSB8fCAncHJlc2VudGF0aW9uLnBwdHgnO1xuICAgICAgICAgICAgY29uc3QgaXNQcmV2aWV3ID0gb3B0aW9ucy5pc1ByZXZpZXcgfHwgZmFsc2U7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBmaWxlIHRvIHByb2Nlc3NcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBmcy5ta2R0ZW1wKHBhdGguam9pbihyZXF1aXJlKCdvcycpLnRtcGRpcigpLCAncHB0eC1jb252ZXJzaW9uLScpKTtcbiAgICAgICAgICAgIGNvbnN0IHRlbXBGaWxlID0gcGF0aC5qb2luKHRlbXBEaXIsIGAke29wdGlvbnMubmFtZSB8fCAncHJlc2VudGF0aW9uJ30ucHB0eGApO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBXcml0ZSBidWZmZXIgdG8gdGVtcCBmaWxlXG4gICAgICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUodGVtcEZpbGUsIGNvbnRlbnQpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDb25maWd1cmUgb2ZmaWNlcGFyc2VyIG9wdGlvbnNcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlckNvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICBuZXdsaW5lRGVsaW1pdGVyOiAnXFxuJyxcbiAgICAgICAgICAgICAgICBpZ25vcmVOb3RlczogZmFsc2UsXG4gICAgICAgICAgICAgICAgcHV0Tm90ZXNBdExhc3Q6IGZhbHNlLFxuICAgICAgICAgICAgICAgIG91dHB1dEVycm9yVG9Db25zb2xlOiBmYWxzZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRXh0cmFjdCB0ZXh0IHVzaW5nIG9mZmljZXBhcnNlclxuICAgICAgICAgICAgY29uc3QgZXh0cmFjdGVkVGV4dCA9IGF3YWl0IG9mZmljZXBhcnNlci5wYXJzZU9mZmljZUFzeW5jKHRlbXBGaWxlLCBwYXJzZXJDb25maWcpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBQcm9jZXNzIHRoZSBleHRyYWN0ZWQgdGV4dCB0byBjcmVhdGUgc2xpZGVzXG4gICAgICAgICAgICBjb25zdCBzbGlkZXMgPSB0aGlzLnByb2Nlc3NFeHRyYWN0ZWRUZXh0KGV4dHJhY3RlZFRleHQpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBHZXQgZmlsZSBzdGF0cyBmb3IgbWV0YWRhdGFcbiAgICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdCh0ZW1wRmlsZSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgYmFzaWMgbWV0YWRhdGFcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0ge1xuICAgICAgICAgICAgICAgIHRpdGxlOiBwYXRoLmJhc2VuYW1lKGZpbGVOYW1lLCBwYXRoLmV4dG5hbWUoZmlsZU5hbWUpKSxcbiAgICAgICAgICAgICAgICBhdXRob3I6ICcnLFxuICAgICAgICAgICAgICAgIGRhdGU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdLFxuICAgICAgICAgICAgICAgIHN1YmplY3Q6ICcnLFxuICAgICAgICAgICAgICAgIHNsaWRlQ291bnQ6IHNsaWRlcy5sZW5ndGgsXG4gICAgICAgICAgICAgICAgZmlsZVNpemU6IHN0YXRzLnNpemVcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duIGNvbnRlbnRcbiAgICAgICAgICAgIGxldCBtYXJrZG93bkNvbnRlbnQgPSAnJztcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gUHJvY2VzcyBlYWNoIHNsaWRlXG4gICAgICAgICAgICBzbGlkZXMuZm9yRWFjaCgoc2xpZGUsIGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgICAgbWFya2Rvd25Db250ZW50ICs9IGAjIyBTbGlkZSAke2luZGV4ICsgMX06ICR7c2xpZGUudGl0bGUgfHwgJ1VudGl0bGVkIFNsaWRlJ31cXG5cXG5gO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIEFkZCBzbGlkZSBjb250ZW50XG4gICAgICAgICAgICAgICAgaWYgKHNsaWRlLmNvbnRlbnQgJiYgc2xpZGUuY29udGVudC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duQ29udGVudCArPSBgJHtzbGlkZS5jb250ZW50fVxcblxcbmA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIEFkZCBzbGlkZSBub3RlcyBpZiBhdmFpbGFibGVcbiAgICAgICAgICAgICAgICBpZiAoc2xpZGUubm90ZXMgJiYgc2xpZGUubm90ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bkNvbnRlbnQgKz0gYD4gKipOb3RlczoqKiAke3NsaWRlLm5vdGVzfVxcblxcbmA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIEFkZCBzZXBhcmF0b3IgYmV0d2VlbiBzbGlkZXNcbiAgICAgICAgICAgICAgICBtYXJrZG93bkNvbnRlbnQgKz0gYC0tLVxcblxcbmA7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcbiAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gR2V0IGN1cnJlbnQgZGF0ZXRpbWVcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgICBjb25zdCBjb252ZXJ0ZWREYXRlID0gbm93LnRvSVNPU3RyaW5nKCkuc3BsaXQoJy4nKVswXS5yZXBsYWNlKCdUJywgJyAnKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gR2V0IHRoZSB0aXRsZSBmcm9tIG1ldGFkYXRhIG9yIGZpbGVuYW1lXG4gICAgICAgICAgICBjb25zdCBmaWxlVGl0bGUgPSBtZXRhZGF0YS50aXRsZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVOYW1lLCBwYXRoLmV4dG5hbWUoZmlsZU5hbWUpKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBmcm9udG1hdHRlclxuICAgICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBbXG4gICAgICAgICAgICAgICAgJy0tLScsXG4gICAgICAgICAgICAgICAgYHRpdGxlOiAke2ZpbGVUaXRsZX1gLFxuICAgICAgICAgICAgICAgIGBjb252ZXJ0ZWQ6ICR7Y29udmVydGVkRGF0ZX1gLFxuICAgICAgICAgICAgICAgICd0eXBlOiBwcHR4JyxcbiAgICAgICAgICAgICAgICAnLS0tJyxcbiAgICAgICAgICAgICAgICAnJ1xuICAgICAgICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ29tYmluZSBmcm9udG1hdHRlciBhbmQgY29udGVudFxuICAgICAgICAgICAgcmV0dXJuIGZyb250bWF0dGVyICsgbWFya2Rvd25Db250ZW50O1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BwdHhDb252ZXJ0ZXJdIE1hcmtkb3duIGNvbnZlcnNpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIFByb2Nlc3MgZXh0cmFjdGVkIHRleHQgaW50byBzbGlkZXNcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZXh0cmFjdGVkVGV4dCAtIFRleHQgZXh0cmFjdGVkIGZyb20gUFBUWFxuICAgICAqIEByZXR1cm5zIHtBcnJheX0gQXJyYXkgb2Ygc2xpZGUgb2JqZWN0c1xuICAgICAqL1xuICAgIHByb2Nlc3NFeHRyYWN0ZWRUZXh0KGV4dHJhY3RlZFRleHQpIHtcbiAgICAgICAgLy8gU3BsaXQgdGhlIHRleHQgYnkgc2xpZGUgbWFya2VycyBvciBvdGhlciBwYXR0ZXJuc1xuICAgICAgICAvLyBUaGlzIGlzIGEgc2ltcGxlIGltcGxlbWVudGF0aW9uIGFuZCBtaWdodCBuZWVkIHJlZmluZW1lbnQgYmFzZWQgb24gYWN0dWFsIG91dHB1dFxuICAgICAgICBjb25zdCBzbGlkZVRleHRzID0gZXh0cmFjdGVkVGV4dC5zcGxpdCgvKD86U2xpZGUgXFxkKzo/KS9pKS5maWx0ZXIodGV4dCA9PiB0ZXh0LnRyaW0oKS5sZW5ndGggPiAwKTtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBzbGlkZVRleHRzLm1hcChzbGlkZVRleHQgPT4ge1xuICAgICAgICAgICAgLy8gVHJ5IHRvIGV4dHJhY3QgYSB0aXRsZSBmcm9tIHRoZSBmaXJzdCBsaW5lXG4gICAgICAgICAgICBjb25zdCBsaW5lcyA9IHNsaWRlVGV4dC50cmltKCkuc3BsaXQoJ1xcbicpO1xuICAgICAgICAgICAgY29uc3QgdGl0bGUgPSBsaW5lc1swXSB8fCAnVW50aXRsZWQgU2xpZGUnO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDaGVjayBpZiB0aGVyZSBhcmUgbm90ZXMgKGluZGljYXRlZCBieSBcIk5vdGVzOlwiIG9yIHNpbWlsYXIpXG4gICAgICAgICAgICBjb25zdCBub3Rlc0luZGV4ID0gc2xpZGVUZXh0LmluZGV4T2YoJ05vdGVzOicpO1xuICAgICAgICAgICAgbGV0IGNvbnRlbnQgPSAnJztcbiAgICAgICAgICAgIGxldCBub3RlcyA9ICcnO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAobm90ZXNJbmRleCA+IC0xKSB7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IHNsaWRlVGV4dC5zdWJzdHJpbmcoMCwgbm90ZXNJbmRleCkudHJpbSgpO1xuICAgICAgICAgICAgICAgIG5vdGVzID0gc2xpZGVUZXh0LnN1YnN0cmluZyhub3Rlc0luZGV4ICsgNikudHJpbSgpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gc2xpZGVUZXh0LnRyaW0oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0aXRsZTogdGl0bGUsXG4gICAgICAgICAgICAgICAgY29udGVudDogY29udGVudCxcbiAgICAgICAgICAgICAgICBub3Rlczogbm90ZXNcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrIGlmIHRoaXMgY29udmVydGVyIHN1cHBvcnRzIHRoZSBnaXZlbiBmaWxlXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBmaWxlXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXG4gICAgICovXG4gICAgc3VwcG9ydHNGaWxlKGZpbGVQYXRoKSB7XG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucy5pbmNsdWRlcyhleHQpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xuICAgICAqL1xuICAgIGdldEluZm8oKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBuYW1lOiAnUFBUWCBDb252ZXJ0ZXInLFxuICAgICAgICAgICAgZXh0ZW5zaW9uczogdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb252ZXJ0cyBQUFRYIGZpbGVzIHRvIG1hcmtkb3duJyxcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICB0aXRsZTogJ09wdGlvbmFsIHByZXNlbnRhdGlvbiB0aXRsZScsXG4gICAgICAgICAgICAgICAgaXNQcmV2aWV3OiAnV2hldGhlciB0byBnZW5lcmF0ZSBhIHByZXZpZXcgKGRlZmF1bHQ6IGZhbHNlKSdcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gUHB0eENvbnZlcnRlcjtcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDOUIsTUFBTUUsV0FBVyxHQUFHRixPQUFPLENBQUMsbUJBQW1CLENBQUM7QUFDaEQsTUFBTTtFQUFFRyxjQUFjO0VBQUVDO0FBQWMsQ0FBQyxHQUFHSixPQUFPLENBQUMseUJBQXlCLENBQUM7QUFDNUUsTUFBTUssWUFBWSxHQUFHTCxPQUFPLENBQUMsY0FBYyxDQUFDO0FBRTVDLE1BQU1NLGFB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