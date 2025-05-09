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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiQmFzZVNlcnZpY2UiLCJmb3JtYXRNZXRhZGF0YSIsImNsZWFuTWV0YWRhdGEiLCJvZmZpY2VwYXJzZXIiLCJQcHR4Q29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJzdXBwb3J0ZWRFeHRlbnNpb25zIiwiYWN0aXZlQ29udmVyc2lvbnMiLCJNYXAiLCJzZXR1cElwY0hhbmRsZXJzIiwicmVnaXN0ZXJIYW5kbGVyIiwiaGFuZGxlQ29udmVydCIsImJpbmQiLCJoYW5kbGVQcmV2aWV3IiwiZ2VuZXJhdGVDb252ZXJzaW9uSWQiLCJEYXRlIiwibm93IiwiTWF0aCIsInJhbmRvbSIsInRvU3RyaW5nIiwic3Vic3RyIiwidXBkYXRlQ29udmVyc2lvblN0YXR1cyIsImNvbnZlcnNpb25JZCIsInN0YXR1cyIsImRldGFpbHMiLCJjb252ZXJzaW9uIiwiZ2V0IiwiT2JqZWN0IiwiYXNzaWduIiwid2luZG93Iiwid2ViQ29udGVudHMiLCJzZW5kIiwiZXZlbnQiLCJmaWxlUGF0aCIsImJ1ZmZlciIsIm9wdGlvbnMiLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJ0ZW1wRGlyIiwiY3JlYXRlVGVtcERpciIsInNldCIsImlkIiwicHJvZ3Jlc3MiLCJjb250ZW50IiwiQnVmZmVyIiwiZnJvbSIsImZpbGVSZXN1bHQiLCJoYW5kbGVGaWxlUmVhZCIsImFzQmluYXJ5IiwiRXJyb3IiLCJyZXN1bHQiLCJwcm9jZXNzQ29udmVyc2lvbiIsImZpbGVOYW1lIiwib3JpZ2luYWxGaWxlTmFtZSIsIm5hbWUiLCJiYXNlbmFtZSIsImVycm9yIiwiY29uc29sZSIsImNvbnZlcnRUb01hcmtkb3duIiwiaXNQcmV2aWV3IiwicmVtb3ZlIiwiY2F0Y2giLCJlcnIiLCJta2R0ZW1wIiwiam9pbiIsInRtcGRpciIsInRlbXBGaWxlIiwid3JpdGVGaWxlIiwicGFyc2VyQ29uZmlnIiwibmV3bGluZURlbGltaXRlciIsImlnbm9yZU5vdGVzIiwicHV0Tm90ZXNBdExhc3QiLCJvdXRwdXRFcnJvclRvQ29uc29sZSIsImV4dHJhY3RlZFRleHQiLCJwYXJzZU9mZmljZUFzeW5jIiwic2xpZGVzIiwicHJvY2Vzc0V4dHJhY3RlZFRleHQiLCJzdGF0cyIsInN0YXQiLCJtZXRhZGF0YSIsInRpdGxlIiwiZXh0bmFtZSIsImF1dGhvciIsImRhdGUiLCJ0b0lTT1N0cmluZyIsInNwbGl0Iiwic3ViamVjdCIsInNsaWRlQ291bnQiLCJsZW5ndGgiLCJmaWxlU2l6ZSIsInNpemUiLCJtYXJrZG93bkNvbnRlbnQiLCJmb3JFYWNoIiwic2xpZGUiLCJpbmRleCIsIm5vdGVzIiwiY29udmVydGVkRGF0ZSIsInJlcGxhY2UiLCJmaWxlVGl0bGUiLCJmcm9udG1hdHRlciIsInNsaWRlVGV4dHMiLCJmaWx0ZXIiLCJ0ZXh0IiwidHJpbSIsIm1hcCIsInNsaWRlVGV4dCIsImxpbmVzIiwibm90ZXNJbmRleCIsImluZGV4T2YiLCJzdWJzdHJpbmciLCJzdXBwb3J0c0ZpbGUiLCJleHQiLCJ0b0xvd2VyQ2FzZSIsImluY2x1ZGVzIiwiZ2V0SW5mbyIsImV4dGVuc2lvbnMiLCJkZXNjcmlwdGlvbiIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9QcHR4Q29udmVydGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBQcHR4Q29udmVydGVyLmpzXHJcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiBQUFRYIGZpbGVzIHRvIG1hcmtkb3duIGZvcm1hdCBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBcclxuICogVGhpcyBjb252ZXJ0ZXI6XHJcbiAqIC0gUGFyc2VzIFBQVFggZmlsZXMgdXNpbmcgb2ZmaWNlcGFyc2VyXHJcbiAqIC0gRXh0cmFjdHMgdGV4dCwgc2xpZGVzLCBhbmQgbm90ZXNcclxuICogLSBHZW5lcmF0ZXMgY2xlYW4gbWFya2Rvd24gb3V0cHV0IHdpdGggc2xpZGUgc3RydWN0dXJlXHJcbiAqIFxyXG4gKiBSZWxhdGVkIEZpbGVzOlxyXG4gKiAtIEJhc2VTZXJ2aWNlLmpzOiBQYXJlbnQgY2xhc3MgcHJvdmlkaW5nIElQQyBoYW5kbGluZ1xyXG4gKiAtIEZpbGVQcm9jZXNzb3JTZXJ2aWNlLmpzOiBVc2VkIGZvciBmaWxlIG9wZXJhdGlvbnNcclxuICogLSBDb252ZXJzaW9uU2VydmljZS5qczogUmVnaXN0ZXJzIGFuZCB1c2VzIHRoaXMgY29udmVydGVyXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL0Jhc2VTZXJ2aWNlJyk7XHJcbmNvbnN0IHsgZm9ybWF0TWV0YWRhdGEsIGNsZWFuTWV0YWRhdGEgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL3V0aWxzL21hcmtkb3duJyk7XHJcbmNvbnN0IG9mZmljZXBhcnNlciA9IHJlcXVpcmUoJ29mZmljZXBhcnNlcicpO1xyXG5cclxuY2xhc3MgUHB0eENvbnZlcnRlciBleHRlbmRzIEJhc2VTZXJ2aWNlIHtcclxuICAgIGNvbnN0cnVjdG9yKGZpbGVQcm9jZXNzb3IsIGZpbGVTdG9yYWdlKSB7XHJcbiAgICAgICAgc3VwZXIoKTtcclxuICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yO1xyXG4gICAgICAgIHRoaXMuZmlsZVN0b3JhZ2UgPSBmaWxlU3RvcmFnZTtcclxuICAgICAgICB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMgPSBbJy5wcHR4JywgJy5wcHQnXTtcclxuICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zID0gbmV3IE1hcCgpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIFBQVFggY29udmVyc2lvblxyXG4gICAgICovXHJcbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnBwdHgnLCB0aGlzLmhhbmRsZUNvbnZlcnQuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6cHB0eDpwcmV2aWV3JywgdGhpcy5oYW5kbGVQcmV2aWV3LmJpbmQodGhpcykpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIGEgdW5pcXVlIGNvbnZlcnNpb24gSURcclxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IFVuaXF1ZSBjb252ZXJzaW9uIElEXHJcbiAgICAgKi9cclxuICAgIGdlbmVyYXRlQ29udmVyc2lvbklkKCkge1xyXG4gICAgICAgIHJldHVybiBgcHB0eF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyKDIsIDkpfWA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogVXBkYXRlIGNvbnZlcnNpb24gc3RhdHVzIGFuZCBub3RpZnkgcmVuZGVyZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIGlkZW50aWZpZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzdGF0dXMgLSBOZXcgc3RhdHVzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gZGV0YWlscyAtIEFkZGl0aW9uYWwgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICB1cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgc3RhdHVzLCBkZXRhaWxzID0ge30pIHtcclxuICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcclxuICAgICAgICBpZiAoY29udmVyc2lvbikge1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uLnN0YXR1cyA9IHN0YXR1cztcclxuICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihjb252ZXJzaW9uLCBkZXRhaWxzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uLndpbmRvdykge1xyXG4gICAgICAgICAgICAgICAgY29udmVyc2lvbi53aW5kb3cud2ViQ29udGVudHMuc2VuZCgncHB0eDpjb252ZXJzaW9uLXByb2dyZXNzJywge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25JZCxcclxuICAgICAgICAgICAgICAgICAgICBzdGF0dXMsXHJcbiAgICAgICAgICAgICAgICAgICAgLi4uZGV0YWlsc1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIFBQVFggY29udmVyc2lvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ29udmVyc2lvbiByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlQ29udmVydChldmVudCwgeyBmaWxlUGF0aCwgYnVmZmVyLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb25JZCA9IHRoaXMuZ2VuZXJhdGVDb252ZXJzaW9uSWQoKTtcclxuICAgICAgICAgICAgY29uc3Qgd2luZG93ID0gZXZlbnQuc2VuZGVyLmdldE93bmVyQnJvd3NlcldpbmRvdygpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ3JlYXRlIHRlbXAgZGlyZWN0b3J5IGZvciB0aGlzIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IHRoaXMuZmlsZVN0b3JhZ2UuY3JlYXRlVGVtcERpcigncHB0eF9jb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNldChjb252ZXJzaW9uSWQsIHtcclxuICAgICAgICAgICAgICAgIGlkOiBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdzdGFydGluZycsXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMCxcclxuICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxyXG4gICAgICAgICAgICAgICAgdGVtcERpcixcclxuICAgICAgICAgICAgICAgIHdpbmRvd1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIE5vdGlmeSBjbGllbnQgdGhhdCBjb252ZXJzaW9uIGhhcyBzdGFydGVkXHJcbiAgICAgICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwcHR4OmNvbnZlcnNpb24tc3RhcnRlZCcsIHsgY29udmVyc2lvbklkIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgbGV0IGNvbnRlbnQ7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoYnVmZmVyKSB7XHJcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gQnVmZmVyLmZyb20oYnVmZmVyKTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChmaWxlUGF0aCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ3JlYWRpbmdfZmlsZScsIHsgcHJvZ3Jlc3M6IDEwIH0pO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZmlsZVJlc3VsdCA9IGF3YWl0IHRoaXMuZmlsZVByb2Nlc3Nvci5oYW5kbGVGaWxlUmVhZChudWxsLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgYXNCaW5hcnk6IHRydWVcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgY29udGVudCA9IGZpbGVSZXN1bHQuY29udGVudDtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gZmlsZSBwYXRoIG9yIGJ1ZmZlciBwcm92aWRlZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBTdGFydCBjb252ZXJzaW9uIHByb2Nlc3NcclxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIGNvbnRlbnQsIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICBmaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IG9wdGlvbnMubmFtZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoIHx8ICdwcmVzZW50YXRpb24ucHB0eCcpXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHsgY29udGVudDogcmVzdWx0IH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BwdHhDb252ZXJ0ZXJdIENvbnZlcnNpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIFBQVFggcHJldmlldyByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gUHJldmlldyByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlUHJldmlldyhldmVudCwgeyBmaWxlUGF0aCwgYnVmZmVyLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGxldCBjb250ZW50O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGJ1ZmZlcikge1xyXG4gICAgICAgICAgICAgICAgY29udGVudCA9IEJ1ZmZlci5mcm9tKGJ1ZmZlcik7XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZmlsZVBhdGgpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZpbGVSZXN1bHQgPSBhd2FpdCB0aGlzLmZpbGVQcm9jZXNzb3IuaGFuZGxlRmlsZVJlYWQobnVsbCwge1xyXG4gICAgICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxyXG4gICAgICAgICAgICAgICAgICAgIGFzQmluYXJ5OiB0cnVlXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBmaWxlUmVzdWx0LmNvbnRlbnQ7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIGZpbGUgcGF0aCBvciBidWZmZXIgcHJvdmlkZWQnKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCB7XHJcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgaXNQcmV2aWV3OiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgZmlsZU5hbWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBvcHRpb25zLm5hbWUgfHwgcGF0aC5iYXNlbmFtZShmaWxlUGF0aCB8fCAncHJlc2VudGF0aW9uLnBwdHgnKVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnRlbnQ6IHJlc3VsdCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcHR4Q29udmVydGVyXSBQcmV2aWV3IGdlbmVyYXRpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgUFBUWCBjb252ZXJzaW9uXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge0J1ZmZlcn0gY29udGVudCAtIFBQVFggY29udGVudCBhcyBidWZmZXJcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgY29udGVudCwgb3B0aW9ucykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgICAgICBpZiAoIWNvbnZlcnNpb24pIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVyc2lvbiBub3QgZm91bmQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2V4dHJhY3RpbmdfY29udGVudCcsIHsgcHJvZ3Jlc3M6IDMwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBkb2N1bWVudCBjb250ZW50IGFuZCBtZXRhZGF0YVxyXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2NvbXBsZXRlZCcsIHsgXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMTAwLFxyXG4gICAgICAgICAgICAgICAgcmVzdWx0XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24udGVtcERpcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGNvbnZlcnNpb24udGVtcERpcikuY2F0Y2goZXJyID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbUHB0eENvbnZlcnRlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIHRlbXAgZGlyZWN0b3J5OiAke2NvbnZlcnNpb24udGVtcERpcn1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BwdHhDb252ZXJ0ZXJdIENvbnZlcnNpb24gcHJvY2Vzc2luZyBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XHJcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uICYmIGNvbnZlcnNpb24udGVtcERpcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGNvbnZlcnNpb24udGVtcERpcikuY2F0Y2goZXJyID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbUHB0eENvbnZlcnRlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIHRlbXAgZGlyZWN0b3J5OiAke2NvbnZlcnNpb24udGVtcERpcn1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENvbnZlcnQgUFBUWCBjb250ZW50IHRvIG1hcmtkb3duXHJcbiAgICAgKiBAcGFyYW0ge0J1ZmZlcn0gY29udGVudCAtIFBQVFggY29udGVudCBhcyBidWZmZXJcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGNvbnZlcnRUb01hcmtkb3duKGNvbnRlbnQsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gb3B0aW9ucy5maWxlTmFtZSB8fCAncHJlc2VudGF0aW9uLnBwdHgnO1xyXG4gICAgICAgICAgICBjb25zdCBpc1ByZXZpZXcgPSBvcHRpb25zLmlzUHJldmlldyB8fCBmYWxzZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBmaWxlIHRvIHByb2Nlc3NcclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IGZzLm1rZHRlbXAocGF0aC5qb2luKHJlcXVpcmUoJ29zJykudG1wZGlyKCksICdwcHR4LWNvbnZlcnNpb24tJykpO1xyXG4gICAgICAgICAgICBjb25zdCB0ZW1wRmlsZSA9IHBhdGguam9pbih0ZW1wRGlyLCBgJHtvcHRpb25zLm5hbWUgfHwgJ3ByZXNlbnRhdGlvbid9LnBwdHhgKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFdyaXRlIGJ1ZmZlciB0byB0ZW1wIGZpbGVcclxuICAgICAgICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKHRlbXBGaWxlLCBjb250ZW50KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENvbmZpZ3VyZSBvZmZpY2VwYXJzZXIgb3B0aW9uc1xyXG4gICAgICAgICAgICBjb25zdCBwYXJzZXJDb25maWcgPSB7XHJcbiAgICAgICAgICAgICAgICBuZXdsaW5lRGVsaW1pdGVyOiAnXFxuJyxcclxuICAgICAgICAgICAgICAgIGlnbm9yZU5vdGVzOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIHB1dE5vdGVzQXRMYXN0OiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIG91dHB1dEVycm9yVG9Db25zb2xlOiBmYWxzZVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCB0ZXh0IHVzaW5nIG9mZmljZXBhcnNlclxyXG4gICAgICAgICAgICBjb25zdCBleHRyYWN0ZWRUZXh0ID0gYXdhaXQgb2ZmaWNlcGFyc2VyLnBhcnNlT2ZmaWNlQXN5bmModGVtcEZpbGUsIHBhcnNlckNvbmZpZyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBQcm9jZXNzIHRoZSBleHRyYWN0ZWQgdGV4dCB0byBjcmVhdGUgc2xpZGVzXHJcbiAgICAgICAgICAgIGNvbnN0IHNsaWRlcyA9IHRoaXMucHJvY2Vzc0V4dHJhY3RlZFRleHQoZXh0cmFjdGVkVGV4dCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZXQgZmlsZSBzdGF0cyBmb3IgbWV0YWRhdGFcclxuICAgICAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KHRlbXBGaWxlKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgYmFzaWMgbWV0YWRhdGFcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSB7XHJcbiAgICAgICAgICAgICAgICB0aXRsZTogcGF0aC5iYXNlbmFtZShmaWxlTmFtZSwgcGF0aC5leHRuYW1lKGZpbGVOYW1lKSksXHJcbiAgICAgICAgICAgICAgICBhdXRob3I6ICcnLFxyXG4gICAgICAgICAgICAgICAgZGF0ZTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF0sXHJcbiAgICAgICAgICAgICAgICBzdWJqZWN0OiAnJyxcclxuICAgICAgICAgICAgICAgIHNsaWRlQ291bnQ6IHNsaWRlcy5sZW5ndGgsXHJcbiAgICAgICAgICAgICAgICBmaWxlU2l6ZTogc3RhdHMuc2l6ZVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgbWFya2Rvd24gY29udGVudFxyXG4gICAgICAgICAgICBsZXQgbWFya2Rvd25Db250ZW50ID0gJyc7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBQcm9jZXNzIGVhY2ggc2xpZGVcclxuICAgICAgICAgICAgc2xpZGVzLmZvckVhY2goKHNsaWRlLCBpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd25Db250ZW50ICs9IGAjIyBTbGlkZSAke2luZGV4ICsgMX06ICR7c2xpZGUudGl0bGUgfHwgJ1VudGl0bGVkIFNsaWRlJ31cXG5cXG5gO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBBZGQgc2xpZGUgY29udGVudFxyXG4gICAgICAgICAgICAgICAgaWYgKHNsaWRlLmNvbnRlbnQgJiYgc2xpZGUuY29udGVudC5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd25Db250ZW50ICs9IGAke3NsaWRlLmNvbnRlbnR9XFxuXFxuYDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQWRkIHNsaWRlIG5vdGVzIGlmIGF2YWlsYWJsZVxyXG4gICAgICAgICAgICAgICAgaWYgKHNsaWRlLm5vdGVzICYmIHNsaWRlLm5vdGVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bkNvbnRlbnQgKz0gYD4gKipOb3RlczoqKiAke3NsaWRlLm5vdGVzfVxcblxcbmA7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEFkZCBzZXBhcmF0b3IgYmV0d2VlbiBzbGlkZXNcclxuICAgICAgICAgICAgICAgIG1hcmtkb3duQ29udGVudCArPSBgLS0tXFxuXFxuYDtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZXQgY3VycmVudCBkYXRldGltZVxyXG4gICAgICAgICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xyXG4gICAgICAgICAgICBjb25zdCBjb252ZXJ0ZWREYXRlID0gbm93LnRvSVNPU3RyaW5nKCkuc3BsaXQoJy4nKVswXS5yZXBsYWNlKCdUJywgJyAnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdldCB0aGUgdGl0bGUgZnJvbSBtZXRhZGF0YSBvciBmaWxlbmFtZVxyXG4gICAgICAgICAgICBjb25zdCBmaWxlVGl0bGUgPSBtZXRhZGF0YS50aXRsZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVOYW1lLCBwYXRoLmV4dG5hbWUoZmlsZU5hbWUpKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgZnJvbnRtYXR0ZXJcclxuICAgICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBbXHJcbiAgICAgICAgICAgICAgICAnLS0tJyxcclxuICAgICAgICAgICAgICAgIGB0aXRsZTogJHtmaWxlVGl0bGV9YCxcclxuICAgICAgICAgICAgICAgIGBjb252ZXJ0ZWQ6ICR7Y29udmVydGVkRGF0ZX1gLFxyXG4gICAgICAgICAgICAgICAgJ3R5cGU6IHBwdHgnLFxyXG4gICAgICAgICAgICAgICAgJy0tLScsXHJcbiAgICAgICAgICAgICAgICAnJ1xyXG4gICAgICAgICAgICBdLmpvaW4oJ1xcbicpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ29tYmluZSBmcm9udG1hdHRlciBhbmQgY29udGVudFxyXG4gICAgICAgICAgICByZXR1cm4gZnJvbnRtYXR0ZXIgKyBtYXJrZG93bkNvbnRlbnQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BwdHhDb252ZXJ0ZXJdIE1hcmtkb3duIGNvbnZlcnNpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgZXh0cmFjdGVkIHRleHQgaW50byBzbGlkZXNcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBleHRyYWN0ZWRUZXh0IC0gVGV4dCBleHRyYWN0ZWQgZnJvbSBQUFRYXHJcbiAgICAgKiBAcmV0dXJucyB7QXJyYXl9IEFycmF5IG9mIHNsaWRlIG9iamVjdHNcclxuICAgICAqL1xyXG4gICAgcHJvY2Vzc0V4dHJhY3RlZFRleHQoZXh0cmFjdGVkVGV4dCkge1xyXG4gICAgICAgIC8vIFNwbGl0IHRoZSB0ZXh0IGJ5IHNsaWRlIG1hcmtlcnMgb3Igb3RoZXIgcGF0dGVybnNcclxuICAgICAgICAvLyBUaGlzIGlzIGEgc2ltcGxlIGltcGxlbWVudGF0aW9uIGFuZCBtaWdodCBuZWVkIHJlZmluZW1lbnQgYmFzZWQgb24gYWN0dWFsIG91dHB1dFxyXG4gICAgICAgIGNvbnN0IHNsaWRlVGV4dHMgPSBleHRyYWN0ZWRUZXh0LnNwbGl0KC8oPzpTbGlkZSBcXGQrOj8pL2kpLmZpbHRlcih0ZXh0ID0+IHRleHQudHJpbSgpLmxlbmd0aCA+IDApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBzbGlkZVRleHRzLm1hcChzbGlkZVRleHQgPT4ge1xyXG4gICAgICAgICAgICAvLyBUcnkgdG8gZXh0cmFjdCBhIHRpdGxlIGZyb20gdGhlIGZpcnN0IGxpbmVcclxuICAgICAgICAgICAgY29uc3QgbGluZXMgPSBzbGlkZVRleHQudHJpbSgpLnNwbGl0KCdcXG4nKTtcclxuICAgICAgICAgICAgY29uc3QgdGl0bGUgPSBsaW5lc1swXSB8fCAnVW50aXRsZWQgU2xpZGUnO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlcmUgYXJlIG5vdGVzIChpbmRpY2F0ZWQgYnkgXCJOb3RlczpcIiBvciBzaW1pbGFyKVxyXG4gICAgICAgICAgICBjb25zdCBub3Rlc0luZGV4ID0gc2xpZGVUZXh0LmluZGV4T2YoJ05vdGVzOicpO1xyXG4gICAgICAgICAgICBsZXQgY29udGVudCA9ICcnO1xyXG4gICAgICAgICAgICBsZXQgbm90ZXMgPSAnJztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChub3Rlc0luZGV4ID4gLTEpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBzbGlkZVRleHQuc3Vic3RyaW5nKDAsIG5vdGVzSW5kZXgpLnRyaW0oKTtcclxuICAgICAgICAgICAgICAgIG5vdGVzID0gc2xpZGVUZXh0LnN1YnN0cmluZyhub3Rlc0luZGV4ICsgNikudHJpbSgpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgY29udGVudCA9IHNsaWRlVGV4dC50cmltKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICB0aXRsZTogdGl0bGUsXHJcbiAgICAgICAgICAgICAgICBjb250ZW50OiBjb250ZW50LFxyXG4gICAgICAgICAgICAgICAgbm90ZXM6IG5vdGVzXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVjayBpZiB0aGlzIGNvbnZlcnRlciBzdXBwb3J0cyB0aGUgZ2l2ZW4gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBmaWxlXHJcbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBzdXBwb3J0ZWRcclxuICAgICAqL1xyXG4gICAgc3VwcG9ydHNGaWxlKGZpbGVQYXRoKSB7XHJcbiAgICAgICAgY29uc3QgZXh0ID0gcGF0aC5leHRuYW1lKGZpbGVQYXRoKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgIHJldHVybiB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMuaW5jbHVkZXMoZXh0KTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IENvbnZlcnRlciBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGdldEluZm8oKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgbmFtZTogJ1BQVFggQ29udmVydGVyJyxcclxuICAgICAgICAgICAgZXh0ZW5zaW9uczogdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLFxyXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbnZlcnRzIFBQVFggZmlsZXMgdG8gbWFya2Rvd24nLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgICB0aXRsZTogJ09wdGlvbmFsIHByZXNlbnRhdGlvbiB0aXRsZScsXHJcbiAgICAgICAgICAgICAgICBpc1ByZXZpZXc6ICdXaGV0aGVyIHRvIGdlbmVyYXRlIGEgcHJldmlldyAoZGVmYXVsdDogZmFsc2UpJ1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBQcHR4Q29udmVydGVyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTUMsRUFBRSxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQzlCLE1BQU1FLFdBQVcsR0FBR0YsT0FBTyxDQUFDLG1CQUFtQixDQUFDO0FBQ2hELE1BQU07RUFBRUcsY0FBYztFQUFFQztBQUFjLENBQUMsR0FBR0osT0FBTyxDQUFDLHlCQUF5QixDQUFDO0FBQzVFLE1BQU1LLFlBQVksR0FBR0wsT0FBTyxDQUFDLGNBQWMsQ0FBQztBQUU1QyxNQUFNTSxhQUFhLFNBQVNKLFdBQVcsQ0FBQztFQUNwQ0ssV0FBV0EsQ0FBQ0MsYUFBYSxFQUFFQyxXQUFXLEVBQUU7SUFDcEMsS0FBSyxDQUFDLENBQUM7SUFDUCxJQUFJLENBQUNELGFBQWEsR0FBR0EsYUFBYTtJQUNsQyxJQUFJLENBQUNDLFdBQVcsR0FBR0EsV0FBVztJQUM5QixJQUFJLENBQUNDLG1CQUFtQixHQUFHLENBQUMsT0FB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