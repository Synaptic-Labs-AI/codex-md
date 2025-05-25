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

      // Get the title from metadata or filename
      const fileTitle = metadata.title || path.basename(fileName, path.extname(fileName));

      // Create standardized frontmatter using metadata utility
      const {
        createStandardFrontmatter
      } = require('../../../converters/utils/metadata');
      const frontmatter = createStandardFrontmatter({
        title: fileTitle,
        fileType: 'pptx'
      });

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiQmFzZVNlcnZpY2UiLCJmb3JtYXRNZXRhZGF0YSIsImNsZWFuTWV0YWRhdGEiLCJvZmZpY2VwYXJzZXIiLCJQcHR4Q29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJzdXBwb3J0ZWRFeHRlbnNpb25zIiwiYWN0aXZlQ29udmVyc2lvbnMiLCJNYXAiLCJzZXR1cElwY0hhbmRsZXJzIiwicmVnaXN0ZXJIYW5kbGVyIiwiaGFuZGxlQ29udmVydCIsImJpbmQiLCJoYW5kbGVQcmV2aWV3IiwiZ2VuZXJhdGVDb252ZXJzaW9uSWQiLCJEYXRlIiwibm93IiwiTWF0aCIsInJhbmRvbSIsInRvU3RyaW5nIiwic3Vic3RyIiwidXBkYXRlQ29udmVyc2lvblN0YXR1cyIsImNvbnZlcnNpb25JZCIsInN0YXR1cyIsImRldGFpbHMiLCJjb252ZXJzaW9uIiwiZ2V0IiwiT2JqZWN0IiwiYXNzaWduIiwid2luZG93Iiwid2ViQ29udGVudHMiLCJzZW5kIiwiZXZlbnQiLCJmaWxlUGF0aCIsImJ1ZmZlciIsIm9wdGlvbnMiLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJ0ZW1wRGlyIiwiY3JlYXRlVGVtcERpciIsInNldCIsImlkIiwicHJvZ3Jlc3MiLCJjb250ZW50IiwiQnVmZmVyIiwiZnJvbSIsImZpbGVSZXN1bHQiLCJoYW5kbGVGaWxlUmVhZCIsImFzQmluYXJ5IiwiRXJyb3IiLCJyZXN1bHQiLCJwcm9jZXNzQ29udmVyc2lvbiIsImZpbGVOYW1lIiwib3JpZ2luYWxGaWxlTmFtZSIsIm5hbWUiLCJiYXNlbmFtZSIsImVycm9yIiwiY29uc29sZSIsImNvbnZlcnRUb01hcmtkb3duIiwiaXNQcmV2aWV3IiwicmVtb3ZlIiwiY2F0Y2giLCJlcnIiLCJta2R0ZW1wIiwiam9pbiIsInRtcGRpciIsInRlbXBGaWxlIiwid3JpdGVGaWxlIiwicGFyc2VyQ29uZmlnIiwibmV3bGluZURlbGltaXRlciIsImlnbm9yZU5vdGVzIiwicHV0Tm90ZXNBdExhc3QiLCJvdXRwdXRFcnJvclRvQ29uc29sZSIsImV4dHJhY3RlZFRleHQiLCJwYXJzZU9mZmljZUFzeW5jIiwic2xpZGVzIiwicHJvY2Vzc0V4dHJhY3RlZFRleHQiLCJzdGF0cyIsInN0YXQiLCJtZXRhZGF0YSIsInRpdGxlIiwiZXh0bmFtZSIsImF1dGhvciIsImRhdGUiLCJ0b0lTT1N0cmluZyIsInNwbGl0Iiwic3ViamVjdCIsInNsaWRlQ291bnQiLCJsZW5ndGgiLCJmaWxlU2l6ZSIsInNpemUiLCJtYXJrZG93bkNvbnRlbnQiLCJmb3JFYWNoIiwic2xpZGUiLCJpbmRleCIsIm5vdGVzIiwiZmlsZVRpdGxlIiwiY3JlYXRlU3RhbmRhcmRGcm9udG1hdHRlciIsImZyb250bWF0dGVyIiwiZmlsZVR5cGUiLCJzbGlkZVRleHRzIiwiZmlsdGVyIiwidGV4dCIsInRyaW0iLCJtYXAiLCJzbGlkZVRleHQiLCJsaW5lcyIsIm5vdGVzSW5kZXgiLCJpbmRleE9mIiwic3Vic3RyaW5nIiwic3VwcG9ydHNGaWxlIiwiZXh0IiwidG9Mb3dlckNhc2UiLCJpbmNsdWRlcyIsImdldEluZm8iLCJleHRlbnNpb25zIiwiZGVzY3JpcHRpb24iLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vZG9jdW1lbnQvUHB0eENvbnZlcnRlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFBwdHhDb252ZXJ0ZXIuanNcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiBQUFRYIGZpbGVzIHRvIG1hcmtkb3duIGZvcm1hdCBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxuICogXG4gKiBUaGlzIGNvbnZlcnRlcjpcbiAqIC0gUGFyc2VzIFBQVFggZmlsZXMgdXNpbmcgb2ZmaWNlcGFyc2VyXG4gKiAtIEV4dHJhY3RzIHRleHQsIHNsaWRlcywgYW5kIG5vdGVzXG4gKiAtIEdlbmVyYXRlcyBjbGVhbiBtYXJrZG93biBvdXRwdXQgd2l0aCBzbGlkZSBzdHJ1Y3R1cmVcbiAqIFxuICogUmVsYXRlZCBGaWxlczpcbiAqIC0gQmFzZVNlcnZpY2UuanM6IFBhcmVudCBjbGFzcyBwcm92aWRpbmcgSVBDIGhhbmRsaW5nXG4gKiAtIEZpbGVQcm9jZXNzb3JTZXJ2aWNlLmpzOiBVc2VkIGZvciBmaWxlIG9wZXJhdGlvbnNcbiAqIC0gQ29udmVyc2lvblNlcnZpY2UuanM6IFJlZ2lzdGVycyBhbmQgdXNlcyB0aGlzIGNvbnZlcnRlclxuICovXG5cbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL0Jhc2VTZXJ2aWNlJyk7XG5jb25zdCB7IGZvcm1hdE1ldGFkYXRhLCBjbGVhbk1ldGFkYXRhIH0gPSByZXF1aXJlKCcuLi8uLi8uLi91dGlscy9tYXJrZG93bicpO1xuY29uc3Qgb2ZmaWNlcGFyc2VyID0gcmVxdWlyZSgnb2ZmaWNlcGFyc2VyJyk7XG5cbmNsYXNzIFBwdHhDb252ZXJ0ZXIgZXh0ZW5kcyBCYXNlU2VydmljZSB7XG4gICAgY29uc3RydWN0b3IoZmlsZVByb2Nlc3NvciwgZmlsZVN0b3JhZ2UpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy5maWxlUHJvY2Vzc29yID0gZmlsZVByb2Nlc3NvcjtcbiAgICAgICAgdGhpcy5maWxlU3RvcmFnZSA9IGZpbGVTdG9yYWdlO1xuICAgICAgICB0aGlzLnN1cHBvcnRlZEV4dGVuc2lvbnMgPSBbJy5wcHR4JywgJy5wcHQnXTtcbiAgICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucyA9IG5ldyBNYXAoKTtcbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogU2V0IHVwIElQQyBoYW5kbGVycyBmb3IgUFBUWCBjb252ZXJzaW9uXG4gICAgICovXG4gICAgc2V0dXBJcGNIYW5kbGVycygpIHtcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6cHB0eCcsIHRoaXMuaGFuZGxlQ29udmVydC5iaW5kKHRoaXMpKTtcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6cHB0eDpwcmV2aWV3JywgdGhpcy5oYW5kbGVQcmV2aWV3LmJpbmQodGhpcykpO1xuICAgIH1cbiAgICBcbiAgICAvKipcbiAgICAgKiBHZW5lcmF0ZSBhIHVuaXF1ZSBjb252ZXJzaW9uIElEXG4gICAgICogQHJldHVybnMge3N0cmluZ30gVW5pcXVlIGNvbnZlcnNpb24gSURcbiAgICAgKi9cbiAgICBnZW5lcmF0ZUNvbnZlcnNpb25JZCgpIHtcbiAgICAgICAgcmV0dXJuIGBwcHR4XyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHIoMiwgOSl9YDtcbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogVXBkYXRlIGNvbnZlcnNpb24gc3RhdHVzIGFuZCBub3RpZnkgcmVuZGVyZXJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHN0YXR1cyAtIE5ldyBzdGF0dXNcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gZGV0YWlscyAtIEFkZGl0aW9uYWwgZGV0YWlsc1xuICAgICAqL1xuICAgIHVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCBzdGF0dXMsIGRldGFpbHMgPSB7fSkge1xuICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcbiAgICAgICAgaWYgKGNvbnZlcnNpb24pIHtcbiAgICAgICAgICAgIGNvbnZlcnNpb24uc3RhdHVzID0gc3RhdHVzO1xuICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihjb252ZXJzaW9uLCBkZXRhaWxzKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24ud2luZG93KSB7XG4gICAgICAgICAgICAgICAgY29udmVyc2lvbi53aW5kb3cud2ViQ29udGVudHMuc2VuZCgncHB0eDpjb252ZXJzaW9uLXByb2dyZXNzJywge1xuICAgICAgICAgICAgICAgICAgICBjb252ZXJzaW9uSWQsXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cyxcbiAgICAgICAgICAgICAgICAgICAgLi4uZGV0YWlsc1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIEhhbmRsZSBQUFRYIGNvbnZlcnNpb24gcmVxdWVzdFxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ29udmVyc2lvbiByZXF1ZXN0IGRldGFpbHNcbiAgICAgKi9cbiAgICBhc3luYyBoYW5kbGVDb252ZXJ0KGV2ZW50LCB7IGZpbGVQYXRoLCBidWZmZXIsIG9wdGlvbnMgPSB7fSB9KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uSWQgPSB0aGlzLmdlbmVyYXRlQ29udmVyc2lvbklkKCk7XG4gICAgICAgICAgICBjb25zdCB3aW5kb3cgPSBldmVudD8uc2VuZGVyPy5nZXRPd25lckJyb3dzZXJXaW5kb3c/LigpIHx8IG51bGw7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENyZWF0ZSB0ZW1wIGRpcmVjdG9yeSBmb3IgdGhpcyBjb252ZXJzaW9uXG4gICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgdGhpcy5maWxlU3RvcmFnZS5jcmVhdGVUZW1wRGlyKCdwcHR4X2NvbnZlcnNpb24nKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zZXQoY29udmVyc2lvbklkLCB7XG4gICAgICAgICAgICAgICAgaWQ6IGNvbnZlcnNpb25JZCxcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdzdGFydGluZycsXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDAsXG4gICAgICAgICAgICAgICAgZmlsZVBhdGgsXG4gICAgICAgICAgICAgICAgdGVtcERpcixcbiAgICAgICAgICAgICAgICB3aW5kb3dcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBOb3RpZnkgY2xpZW50IHRoYXQgY29udmVyc2lvbiBoYXMgc3RhcnRlZCAob25seSBpZiB3ZSBoYXZlIGEgdmFsaWQgd2luZG93KVxuICAgICAgICAgICAgaWYgKHdpbmRvdyAmJiB3aW5kb3cud2ViQ29udGVudHMpIHtcbiAgICAgICAgICAgICAgICB3aW5kb3cud2ViQ29udGVudHMuc2VuZCgncHB0eDpjb252ZXJzaW9uLXN0YXJ0ZWQnLCB7IGNvbnZlcnNpb25JZCB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgbGV0IGNvbnRlbnQ7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChidWZmZXIpIHtcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gQnVmZmVyLmZyb20oYnVmZmVyKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZmlsZVBhdGgpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAncmVhZGluZ19maWxlJywgeyBwcm9ncmVzczogMTAgfSk7XG4gICAgICAgICAgICAgICAgY29uc3QgZmlsZVJlc3VsdCA9IGF3YWl0IHRoaXMuZmlsZVByb2Nlc3Nvci5oYW5kbGVGaWxlUmVhZChudWxsLCB7XG4gICAgICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxuICAgICAgICAgICAgICAgICAgICBhc0JpbmFyeTogdHJ1ZVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBmaWxlUmVzdWx0LmNvbnRlbnQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gZmlsZSBwYXRoIG9yIGJ1ZmZlciBwcm92aWRlZCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBTdGFydCBjb252ZXJzaW9uIHByb2Nlc3NcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCBjb250ZW50LCB7XG4gICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcbiAgICAgICAgICAgICAgICBmaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8IG9wdGlvbnMubmFtZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoIHx8ICdwcmVzZW50YXRpb24ucHB0eCcpXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHsgY29udGVudDogcmVzdWx0IH07XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUHB0eENvbnZlcnRlcl0gQ29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBIYW5kbGUgUFBUWCBwcmV2aWV3IHJlcXVlc3RcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFByZXZpZXcgcmVxdWVzdCBkZXRhaWxzXG4gICAgICovXG4gICAgYXN5bmMgaGFuZGxlUHJldmlldyhldmVudCwgeyBmaWxlUGF0aCwgYnVmZmVyLCBvcHRpb25zID0ge30gfSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgbGV0IGNvbnRlbnQ7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChidWZmZXIpIHtcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gQnVmZmVyLmZyb20oYnVmZmVyKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZmlsZVBhdGgpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBmaWxlUmVzdWx0ID0gYXdhaXQgdGhpcy5maWxlUHJvY2Vzc29yLmhhbmRsZUZpbGVSZWFkKG51bGwsIHtcbiAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIGFzQmluYXJ5OiB0cnVlXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IGZpbGVSZXN1bHQuY29udGVudDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBmaWxlIHBhdGggb3IgYnVmZmVyIHByb3ZpZGVkJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuY29udmVydFRvTWFya2Rvd24oY29udGVudCwge1xuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgICAgICAgICAgaXNQcmV2aWV3OiB0cnVlLFxuICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGggfHwgJ3ByZXNlbnRhdGlvbi5wcHR4JylcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4geyBjb250ZW50OiByZXN1bHQgfTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQcHR4Q29udmVydGVyXSBQcmV2aWV3IGdlbmVyYXRpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIFByb2Nlc3MgUFBUWCBjb252ZXJzaW9uXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxuICAgICAqIEBwYXJhbSB7QnVmZmVyfSBjb250ZW50IC0gUFBUWCBjb250ZW50IGFzIGJ1ZmZlclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXG4gICAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gTWFya2Rvd24gY29udGVudFxuICAgICAqL1xuICAgIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgY29udGVudCwgb3B0aW9ucykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XG4gICAgICAgICAgICBpZiAoIWNvbnZlcnNpb24pIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbnZlcnNpb24gbm90IGZvdW5kJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdleHRyYWN0aW5nX2NvbnRlbnQnLCB7IHByb2dyZXNzOiAzMCB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRXh0cmFjdCBkb2N1bWVudCBjb250ZW50IGFuZCBtZXRhZGF0YVxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCBvcHRpb25zKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2NvbXBsZXRlZCcsIHsgXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDEwMCxcbiAgICAgICAgICAgICAgICByZXN1bHRcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24udGVtcERpcikge1xuICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZShjb252ZXJzaW9uLnRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQcHR4Q29udmVydGVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3Rvcnk6ICR7Y29udmVyc2lvbi50ZW1wRGlyfWAsIGVycik7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUHB0eENvbnZlcnRlcl0gQ29udmVyc2lvbiBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uICYmIGNvbnZlcnNpb24udGVtcERpcikge1xuICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZShjb252ZXJzaW9uLnRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQcHR4Q29udmVydGVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3Rvcnk6ICR7Y29udmVyc2lvbi50ZW1wRGlyfWAsIGVycik7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29udmVydCBQUFRYIGNvbnRlbnQgdG8gbWFya2Rvd25cbiAgICAgKiBAcGFyYW0ge0J1ZmZlcn0gY29udGVudCAtIFBQVFggY29udGVudCBhcyBidWZmZXJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IE1hcmtkb3duIGNvbnRlbnRcbiAgICAgKi9cbiAgICBhc3luYyBjb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCBvcHRpb25zID0ge30pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gb3B0aW9ucy5maWxlTmFtZSB8fCAncHJlc2VudGF0aW9uLnBwdHgnO1xuICAgICAgICAgICAgY29uc3QgaXNQcmV2aWV3ID0gb3B0aW9ucy5pc1ByZXZpZXcgfHwgZmFsc2U7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBmaWxlIHRvIHByb2Nlc3NcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBmcy5ta2R0ZW1wKHBhdGguam9pbihyZXF1aXJlKCdvcycpLnRtcGRpcigpLCAncHB0eC1jb252ZXJzaW9uLScpKTtcbiAgICAgICAgICAgIGNvbnN0IHRlbXBGaWxlID0gcGF0aC5qb2luKHRlbXBEaXIsIGAke29wdGlvbnMubmFtZSB8fCAncHJlc2VudGF0aW9uJ30ucHB0eGApO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBXcml0ZSBidWZmZXIgdG8gdGVtcCBmaWxlXG4gICAgICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUodGVtcEZpbGUsIGNvbnRlbnQpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDb25maWd1cmUgb2ZmaWNlcGFyc2VyIG9wdGlvbnNcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlckNvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICBuZXdsaW5lRGVsaW1pdGVyOiAnXFxuJyxcbiAgICAgICAgICAgICAgICBpZ25vcmVOb3RlczogZmFsc2UsXG4gICAgICAgICAgICAgICAgcHV0Tm90ZXNBdExhc3Q6IGZhbHNlLFxuICAgICAgICAgICAgICAgIG91dHB1dEVycm9yVG9Db25zb2xlOiBmYWxzZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRXh0cmFjdCB0ZXh0IHVzaW5nIG9mZmljZXBhcnNlclxuICAgICAgICAgICAgY29uc3QgZXh0cmFjdGVkVGV4dCA9IGF3YWl0IG9mZmljZXBhcnNlci5wYXJzZU9mZmljZUFzeW5jKHRlbXBGaWxlLCBwYXJzZXJDb25maWcpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBQcm9jZXNzIHRoZSBleHRyYWN0ZWQgdGV4dCB0byBjcmVhdGUgc2xpZGVzXG4gICAgICAgICAgICBjb25zdCBzbGlkZXMgPSB0aGlzLnByb2Nlc3NFeHRyYWN0ZWRUZXh0KGV4dHJhY3RlZFRleHQpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBHZXQgZmlsZSBzdGF0cyBmb3IgbWV0YWRhdGFcbiAgICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdCh0ZW1wRmlsZSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgYmFzaWMgbWV0YWRhdGFcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0ge1xuICAgICAgICAgICAgICAgIHRpdGxlOiBwYXRoLmJhc2VuYW1lKGZpbGVOYW1lLCBwYXRoLmV4dG5hbWUoZmlsZU5hbWUpKSxcbiAgICAgICAgICAgICAgICBhdXRob3I6ICcnLFxuICAgICAgICAgICAgICAgIGRhdGU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdLFxuICAgICAgICAgICAgICAgIHN1YmplY3Q6ICcnLFxuICAgICAgICAgICAgICAgIHNsaWRlQ291bnQ6IHNsaWRlcy5sZW5ndGgsXG4gICAgICAgICAgICAgICAgZmlsZVNpemU6IHN0YXRzLnNpemVcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duIGNvbnRlbnRcbiAgICAgICAgICAgIGxldCBtYXJrZG93bkNvbnRlbnQgPSAnJztcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gUHJvY2VzcyBlYWNoIHNsaWRlXG4gICAgICAgICAgICBzbGlkZXMuZm9yRWFjaCgoc2xpZGUsIGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgICAgbWFya2Rvd25Db250ZW50ICs9IGAjIyBTbGlkZSAke2luZGV4ICsgMX06ICR7c2xpZGUudGl0bGUgfHwgJ1VudGl0bGVkIFNsaWRlJ31cXG5cXG5gO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIEFkZCBzbGlkZSBjb250ZW50XG4gICAgICAgICAgICAgICAgaWYgKHNsaWRlLmNvbnRlbnQgJiYgc2xpZGUuY29udGVudC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duQ29udGVudCArPSBgJHtzbGlkZS5jb250ZW50fVxcblxcbmA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIEFkZCBzbGlkZSBub3RlcyBpZiBhdmFpbGFibGVcbiAgICAgICAgICAgICAgICBpZiAoc2xpZGUubm90ZXMgJiYgc2xpZGUubm90ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bkNvbnRlbnQgKz0gYD4gKipOb3RlczoqKiAke3NsaWRlLm5vdGVzfVxcblxcbmA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIEFkZCBzZXBhcmF0b3IgYmV0d2VlbiBzbGlkZXNcbiAgICAgICAgICAgICAgICBtYXJrZG93bkNvbnRlbnQgKz0gYC0tLVxcblxcbmA7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcbiAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gR2V0IHRoZSB0aXRsZSBmcm9tIG1ldGFkYXRhIG9yIGZpbGVuYW1lXG4gICAgICAgICAgICBjb25zdCBmaWxlVGl0bGUgPSBtZXRhZGF0YS50aXRsZSB8fCBwYXRoLmJhc2VuYW1lKGZpbGVOYW1lLCBwYXRoLmV4dG5hbWUoZmlsZU5hbWUpKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBmcm9udG1hdHRlciB1c2luZyBtZXRhZGF0YSB1dGlsaXR5XG4gICAgICAgICAgICBjb25zdCB7IGNyZWF0ZVN0YW5kYXJkRnJvbnRtYXR0ZXIgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL2NvbnZlcnRlcnMvdXRpbHMvbWV0YWRhdGEnKTtcbiAgICAgICAgICAgIGNvbnN0IGZyb250bWF0dGVyID0gY3JlYXRlU3RhbmRhcmRGcm9udG1hdHRlcih7XG4gICAgICAgICAgICAgICAgdGl0bGU6IGZpbGVUaXRsZSxcbiAgICAgICAgICAgICAgICBmaWxlVHlwZTogJ3BwdHgnXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ29tYmluZSBmcm9udG1hdHRlciBhbmQgY29udGVudFxuICAgICAgICAgICAgcmV0dXJuIGZyb250bWF0dGVyICsgbWFya2Rvd25Db250ZW50O1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BwdHhDb252ZXJ0ZXJdIE1hcmtkb3duIGNvbnZlcnNpb24gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIFByb2Nlc3MgZXh0cmFjdGVkIHRleHQgaW50byBzbGlkZXNcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZXh0cmFjdGVkVGV4dCAtIFRleHQgZXh0cmFjdGVkIGZyb20gUFBUWFxuICAgICAqIEByZXR1cm5zIHtBcnJheX0gQXJyYXkgb2Ygc2xpZGUgb2JqZWN0c1xuICAgICAqL1xuICAgIHByb2Nlc3NFeHRyYWN0ZWRUZXh0KGV4dHJhY3RlZFRleHQpIHtcbiAgICAgICAgLy8gU3BsaXQgdGhlIHRleHQgYnkgc2xpZGUgbWFya2VycyBvciBvdGhlciBwYXR0ZXJuc1xuICAgICAgICAvLyBUaGlzIGlzIGEgc2ltcGxlIGltcGxlbWVudGF0aW9uIGFuZCBtaWdodCBuZWVkIHJlZmluZW1lbnQgYmFzZWQgb24gYWN0dWFsIG91dHB1dFxuICAgICAgICBjb25zdCBzbGlkZVRleHRzID0gZXh0cmFjdGVkVGV4dC5zcGxpdCgvKD86U2xpZGUgXFxkKzo/KS9pKS5maWx0ZXIodGV4dCA9PiB0ZXh0LnRyaW0oKS5sZW5ndGggPiAwKTtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiBzbGlkZVRleHRzLm1hcChzbGlkZVRleHQgPT4ge1xuICAgICAgICAgICAgLy8gVHJ5IHRvIGV4dHJhY3QgYSB0aXRsZSBmcm9tIHRoZSBmaXJzdCBsaW5lXG4gICAgICAgICAgICBjb25zdCBsaW5lcyA9IHNsaWRlVGV4dC50cmltKCkuc3BsaXQoJ1xcbicpO1xuICAgICAgICAgICAgY29uc3QgdGl0bGUgPSBsaW5lc1swXSB8fCAnVW50aXRsZWQgU2xpZGUnO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDaGVjayBpZiB0aGVyZSBhcmUgbm90ZXMgKGluZGljYXRlZCBieSBcIk5vdGVzOlwiIG9yIHNpbWlsYXIpXG4gICAgICAgICAgICBjb25zdCBub3Rlc0luZGV4ID0gc2xpZGVUZXh0LmluZGV4T2YoJ05vdGVzOicpO1xuICAgICAgICAgICAgbGV0IGNvbnRlbnQgPSAnJztcbiAgICAgICAgICAgIGxldCBub3RlcyA9ICcnO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAobm90ZXNJbmRleCA+IC0xKSB7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IHNsaWRlVGV4dC5zdWJzdHJpbmcoMCwgbm90ZXNJbmRleCkudHJpbSgpO1xuICAgICAgICAgICAgICAgIG5vdGVzID0gc2xpZGVUZXh0LnN1YnN0cmluZyhub3Rlc0luZGV4ICsgNikudHJpbSgpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gc2xpZGVUZXh0LnRyaW0oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0aXRsZTogdGl0bGUsXG4gICAgICAgICAgICAgICAgY29udGVudDogY29udGVudCxcbiAgICAgICAgICAgICAgICBub3Rlczogbm90ZXNcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrIGlmIHRoaXMgY29udmVydGVyIHN1cHBvcnRzIHRoZSBnaXZlbiBmaWxlXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBmaWxlXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXG4gICAgICovXG4gICAgc3VwcG9ydHNGaWxlKGZpbGVQYXRoKSB7XG4gICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3VwcG9ydGVkRXh0ZW5zaW9ucy5pbmNsdWRlcyhleHQpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xuICAgICAqL1xuICAgIGdldEluZm8oKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBuYW1lOiAnUFBUWCBDb252ZXJ0ZXInLFxuICAgICAgICAgICAgZXh0ZW5zaW9uczogdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb252ZXJ0cyBQUFRYIGZpbGVzIHRvIG1hcmtkb3duJyxcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICB0aXRsZTogJ09wdGlvbmFsIHByZXNlbnRhdGlvbiB0aXRsZScsXG4gICAgICAgICAgICAgICAgaXNQcmV2aWV3OiAnV2hldGhlciB0byBnZW5lcmF0ZSBhIHByZXZpZXcgKGRlZmF1bHQ6IGZhbHNlKSdcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gUHB0eENvbnZlcnRlcjtcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDOUIsTUFBTUUsV0FBVyxHQUFHRixPQUFPLENBQUMsbUJBQW1CLENBQUM7QUFDaEQsTUFBTTtFQUFFRyxjQUFjO0VBQUVDO0FBQWMsQ0FBQyxHQUFHSixPQUFPLENBQUMseUJBQXlCLENBQUM7QUFDNUUsTUFBTUssWUFBWSxHQUFHTCxPQUFPLENBQUMsY0FBYyxDQUFDO0FBRTVDLE1BQU1NLGFBQWEsU0FBU0osV0FBVyxDQUFDO0VBQ3BDSyxXQUFXQSxDQUFDQyxhQUFhLEVBQUVDLFdBQVcsRUFBRTtJQUNwQyxLQUFLLENBQUMsQ0FBQztJQUNQLElBQUksQ0FBQ0QsYUFBYSxHQUFHQSxhQUFhO0lBQ2xDLElBQUksQ0FBQ0MsV0FBVyxHQUFHQSxXQUFXO0lBQzlCLElBQUksQ0FBQ0MsbUJBQW1CLEdBQUcsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDO0lBQzVDLElBQUksQ0FBQ0MsaUJBQWlCLEdBQUcsSUFBSUMsR0FBRyxDQUFDLENBQUM7RUFDdEM7O0VBRUE7QUFDSjtBQUNBO0VBQ0lDLGdCQUFnQkEsQ0FBQSxFQUFHO0lBQ2YsSUFBSSxDQUFDQyxlQUFlLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQ0MsYUFBYSxDQUFDQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDbkUsSUFBSSxDQUFDRixlQUFlLENBQUMsc0JBQXNCLEVBQUUsSUFBSSxDQUFDRyxhQUFhLENBQUNELElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztFQUMvRTs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtFQUNJRSxvQkFBb0JBLENBQUEsRUFBRztJQUNuQixPQUFPLFFBQVFDLElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUMsSUFBSUMsSUFBSSxDQUFDQyxNQUFNLENBQUMsQ0FBQyxDQUFDQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUNDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUU7RUFDMUU7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0lDLHNCQUFzQkEsQ0FBQ0MsWUFBWSxFQUFFQyxNQUFNLEVBQUVDLE9BQU8sR0FBRyxDQUFDLENBQUMsRUFBRTtJQUN2RCxNQUFNQyxVQUFVLEdBQUcsSUFBSSxDQUFDbEIsaUJBQWlCLENBQUNtQixHQUFHLENBQUNKLFlBQVksQ0FBQztJQUMzRCxJQUFJRyxVQUFVLEVBQUU7TUFDWkEsVUFBVSxDQUFDRixNQUFNLEdBQUdBLE1BQU07TUFDMUJJLE1BQU0sQ0FBQ0MsTUFBTSxDQUFDSCxVQUFVLEVBQUVELE9BQU8sQ0FBQztNQUVsQyxJQUFJQyxVQUFVLENBQUNJLE1BQU0sRUFBRTtRQUNuQkosVUFBVSxDQUFDSSxNQUFNLENBQUNDLFdBQVcsQ0FBQ0MsSUFBSSxDQUFDLDBCQUEwQixFQUFFO1VBQzNEVCxZQUFZO1VBQ1pDLE1BQU07VUFDTixHQUFHQztRQUNQLENBQUMsQ0FBQztNQUNOO0lBQ0o7RUFDSjs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTWIsYUFBYUEsQ0FBQ3FCLEtBQUssRUFBRTtJQUFFQyxRQUFRO0lBQUVDLE1BQU07SUFBRUMsT0FBTyxHQUFHLENBQUM7RUFBRSxDQUFDLEVBQUU7SUFDM0QsSUFBSTtNQUNBLE1BQU1iLFlBQVksR0FBRyxJQUFJLENBQUNSLG9CQUFvQixDQUFDLENBQUM7TUFDaEQsTUFBTWUsTUFBTSxHQUFHRyxLQUFLLEVBQUVJLE1BQU0sRUFBRUMscUJBQXFCLEdBQUcsQ0FBQyxJQUFJLElBQUk7O01BRS9EO01BQ0EsTUFBTUMsT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDakMsV0FBVyxDQUFDa0MsYUFBYSxDQUFDLGlCQUFpQixDQUFDO01BRXZFLElBQUksQ0FBQ2hDLGlCQUFpQixDQUFDaUMsR0FBRyxDQUFDbEIsWUFBWSxFQUFFO1FBQ3JDbUIsRUFBRSxFQUFFbkIsWUFBWTtRQUNoQkMsTUFBTSxFQUFFLFVBQVU7UUFDbEJtQixRQUFRLEVBQUUsQ0FBQztRQUNYVCxRQUFRO1FBQ1JLLE9BQU87UUFDUFQ7TUFDSixDQUFDLENBQUM7O01BRUY7TUFDQSxJQUFJQSxNQUFNLElBQUlBLE1BQU0sQ0FBQ0MsV0FBVyxFQUFFO1FBQzlCRCxNQUFNLENBQUNDLFdBQVcsQ0FBQ0MsSUFBSSxDQUFDLHlCQUF5QixFQUFFO1VBQUVUO1FBQWEsQ0FBQyxDQUFDO01BQ3hFO01BRUEsSUFBSXFCLE9BQU87TUFFWCxJQUFJVCxNQUFNLEVBQUU7UUFDUlMsT0FBTyxHQUFHQyxNQUFNLENBQUNDLElBQUksQ0FBQ1gsTUFBTSxDQUFDO01BQ2pDLENBQUMsTUFBTSxJQUFJRCxRQUFRLEVBQUU7UUFDakIsSUFBSSxDQUFDWixzQkFBc0IsQ0FBQ0MsWUFBWSxFQUFFLGNBQWMsRUFBRTtVQUFFb0IsUUFBUSxFQUFFO1FBQUcsQ0FBQyxDQUFDO1FBQzNFLE1BQU1JLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQzFDLGFBQWEsQ0FBQzJDLGNBQWMsQ0FBQyxJQUFJLEVBQUU7VUFDN0RkLFFBQVE7VUFDUmUsUUFBUSxFQUFFO1FBQ2QsQ0FBQyxDQUFDO1FBQ0ZMLE9BQU8sR0FBR0csVUFBVSxDQUFDSCxPQUFPO01BQ2hDLENBQUMsTUFBTTtRQUNILE1BQU0sSUFBSU0sS0FBSyxDQUFDLGlDQUFpQyxDQUFDO01BQ3REOztNQUVBO01BQ0EsTUFBTUMsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDQyxpQkFBaUIsQ0FBQzdCLFlBQVksRUFBRXFCLE9BQU8sRUFBRTtRQUMvRCxHQUFHUixPQUFPO1FBQ1ZpQixRQUFRLEVBQUVqQixPQUFPLENBQUNrQixnQkFBZ0IsSUFBSWxCLE9BQU8sQ0FBQ21CLElBQUksSUFBSTNELElBQUksQ0FBQzRELFFBQVEsQ0FBQ3RCLFFBQVEsSUFBSSxtQkFBbUI7TUFDdkcsQ0FBQyxDQUFDO01BRUYsT0FBTztRQUFFVSxPQUFPLEVBQUVPO01BQU8sQ0FBQztJQUM5QixDQUFDLENBQUMsT0FBT00sS0FBSyxFQUFFO01BQ1pDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLG9DQUFvQyxFQUFFQSxLQUFLLENBQUM7TUFDMUQsTUFBTUEsS0FBSztJQUNmO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJLE1BQU0zQyxhQUFhQSxDQUFDbUIsS0FBSyxFQUFFO0lBQUVDLFFBQVE7SUFBRUMsTUFBTTtJQUFFQyxPQUFPLEdBQUcsQ0FBQztFQUFFLENBQUMsRUFBRTtJQUMzRCxJQUFJO01BQ0EsSUFBSVEsT0FBTztNQUVYLElBQUlULE1BQU0sRUFBRTtRQUNSUyxPQUFPLEdBQUdDLE1BQU0sQ0FBQ0MsSUFBSSxDQUFDWCxNQUFNLENBQUM7TUFDakMsQ0FBQyxNQUFNLElBQUlELFFBQVEsRUFBRTtRQUNqQixNQUFNYSxVQUFVLEdBQUcsTUFBTSxJQUFJLENBQUMxQyxhQUFhLENBQUMyQyxjQUFjLENBQUMsSUFBSSxFQUFFO1VBQzdEZCxRQUFRO1VBQ1JlLFFBQVEsRUFBRTtRQUNkLENBQUMsQ0FBQztRQUNGTCxPQUFPLEdBQUdHLFVBQVUsQ0FBQ0gsT0FBTztNQUNoQyxDQUFDLE1BQU07UUFDSCxNQUFNLElBQUlNLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQztNQUN0RDtNQUVBLE1BQU1DLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQ1EsaUJBQWlCLENBQUNmLE9BQU8sRUFBRTtRQUNqRCxHQUFHUixPQUFPO1FBQ1Z3QixTQUFTLEVBQUUsSUFBSTtRQUNmUCxRQUFRLEVBQUVqQixPQUFPLENBQUNrQixnQkFBZ0IsSUFBSWxCLE9BQU8sQ0FBQ21CLElBQUksSUFBSTNELElBQUksQ0FBQzRELFFBQVEsQ0FBQ3RCLFFBQVEsSUFBSSxtQkFBbUI7TUFDdkcsQ0FBQyxDQUFDO01BRUYsT0FBTztRQUFFVSxPQUFPLEVBQUVPO01BQU8sQ0FBQztJQUM5QixDQUFDLENBQUMsT0FBT00sS0FBSyxFQUFFO01BQ1pDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLDRDQUE0QyxFQUFFQSxLQUFLLENBQUM7TUFDbEUsTUFBTUEsS0FBSztJQUNmO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDSSxNQUFNTCxpQkFBaUJBLENBQUM3QixZQUFZLEVBQUVxQixPQUFPLEVBQUVSLE9BQU8sRUFBRTtJQUNwRCxJQUFJO01BQ0EsTUFBTVYsVUFBVSxHQUFHLElBQUksQ0FBQ2xCLGlCQUFpQixDQUFDbUIsR0FBRyxDQUFDSixZQUFZLENBQUM7TUFDM0QsSUFBSSxDQUFDRyxVQUFVLEVBQUU7UUFDYixNQUFNLElBQUl3QixLQUFLLENBQUMsc0JBQXNCLENBQUM7TUFDM0M7TUFFQSxJQUFJLENBQUM1QixzQkFBc0IsQ0FBQ0MsWUFBWSxFQUFFLG9CQUFvQixFQUFFO1FBQUVvQixRQUFRLEVBQUU7TUFBRyxDQUFDLENBQUM7O01BRWpGO01BQ0EsTUFBTVEsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDUSxpQkFBaUIsQ0FBQ2YsT0FBTyxFQUFFUixPQUFPLENBQUM7TUFFN0QsSUFBSSxDQUFDZCxzQkFBc0IsQ0FBQ0MsWUFBWSxFQUFFLFdBQVcsRUFBRTtRQUNuRG9CLFFBQVEsRUFBRSxHQUFHO1FBQ2JRO01BQ0osQ0FBQyxDQUFDOztNQUVGO01BQ0EsSUFBSXpCLFVBQVUsQ0FBQ2EsT0FBTyxFQUFFO1FBQ3BCLE1BQU16QyxFQUFFLENBQUMrRCxNQUFNLENBQUNuQyxVQUFVLENBQUNhLE9BQU8sQ0FBQyxDQUFDdUIsS0FBSyxDQUFDQyxHQUFHLElBQUk7VUFDN0NMLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLHNEQUFzRC9CLFVBQVUsQ0FBQ2EsT0FBTyxFQUFFLEVBQUV3QixHQUFHLENBQUM7UUFDbEcsQ0FBQyxDQUFDO01BQ047TUFFQSxPQUFPWixNQUFNO0lBQ2pCLENBQUMsQ0FBQyxPQUFPTSxLQUFLLEVBQUU7TUFDWkMsT0FBTyxDQUFDRCxLQUFLLENBQUMsK0NBQStDLEVBQUVBLEtBQUssQ0FBQzs7TUFFckU7TUFDQSxNQUFNL0IsVUFBVSxHQUFHLElBQUksQ0FBQ2xCLGlCQUFpQixDQUFDbUIsR0FBRyxDQUFDSixZQUFZLENBQUM7TUFDM0QsSUFBSUcsVUFBVSxJQUFJQSxVQUFVLENBQUNhLE9BQU8sRUFBRTtRQUNsQyxNQUFNekMsRUFBRSxDQUFDK0QsTUFBTSxDQUFDbkMsVUFBVSxDQUFDYSxPQUFPLENBQUMsQ0FBQ3VCLEtBQUssQ0FBQ0MsR0FBRyxJQUFJO1VBQzdDTCxPQUFPLENBQUNELEtBQUssQ0FBQyxzREFBc0QvQixVQUFVLENBQUNhLE9BQU8sRUFBRSxFQUFFd0IsR0FBRyxDQUFDO1FBQ2xHLENBQUMsQ0FBQztNQUNOO01BRUEsTUFBTU4sS0FBSztJQUNmO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTUUsaUJBQWlCQSxDQUFDZixPQUFPLEVBQUVSLE9BQU8sR0FBRyxDQUFDLENBQUMsRUFBRTtJQUMzQyxJQUFJO01BQ0EsTUFBTWlCLFFBQVEsR0FBR2pCLE9BQU8sQ0FBQ2lCLFFBQVEsSUFBSSxtQkFBbUI7TUFDeEQsTUFBTU8sU0FBUyxHQUFHeEIsT0FBTyxDQUFDd0IsU0FBUyxJQUFJLEtBQUs7O01BRTVDO01BQ0EsTUFBTXJCLE9BQU8sR0FBRyxNQUFNekMsRUFBRSxDQUFDa0UsT0FBTyxDQUFDcEUsSUFBSSxDQUFDcUUsSUFBSSxDQUFDcEUsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDcUUsTUFBTSxDQUFDLENBQUMsRUFBRSxrQkFBa0IsQ0FBQyxDQUFDO01BQ3ZGLE1BQU1DLFFBQVEsR0FBR3ZFLElBQUksQ0FBQ3FFLElBQUksQ0FBQzFCLE9BQU8sRUFBRSxHQUFHSCxPQUFPLENBQUNtQixJQUFJLElBQUksY0FBYyxPQUFPLENBQUM7O01BRTdFO01BQ0EsTUFBTXpELEVBQUUsQ0FBQ3NFLFNBQVMsQ0FBQ0QsUUFBUSxFQUFFdkIsT0FBTyxDQUFDOztNQUVyQztNQUNBLE1BQU15QixZQUFZLEdBQUc7UUFDakJDLGdCQUFnQixFQUFFLElBQUk7UUFDdEJDLFdBQVcsRUFBRSxLQUFLO1FBQ2xCQyxjQUFjLEVBQUUsS0FBSztRQUNyQkMsb0JBQW9CLEVBQUU7TUFDMUIsQ0FBQzs7TUFFRDtNQUNBLE1BQU1DLGFBQWEsR0FBRyxNQUFNeEUsWUFBWSxDQUFDeUUsZ0JBQWdCLENBQUNSLFFBQVEsRUFBRUUsWUFBWSxDQUFDOztNQUVqRjtNQUNBLE1BQU1PLE1BQU0sR0FBRyxJQUFJLENBQUNDLG9CQUFvQixDQUFDSCxhQUFhLENBQUM7O01BRXZEO01BQ0EsTUFBTUksS0FBSyxHQUFHLE1BQU1oRixFQUFFLENBQUNpRixJQUFJLENBQUNaLFFBQVEsQ0FBQzs7TUFFckM7TUFDQSxNQUFNYSxRQUFRLEdBQUc7UUFDYkMsS0FBSyxFQUFFckYsSUFBSSxDQUFDNEQsUUFBUSxDQUFDSCxRQUFRLEVBQUV6RCxJQUFJLENBQUNzRixPQUFPLENBQUM3QixRQUFRLENBQUMsQ0FBQztRQUN0RDhCLE1BQU0sRUFBRSxFQUFFO1FBQ1ZDLElBQUksRUFBRSxJQUFJcEUsSUFBSSxDQUFDLENBQUMsQ0FBQ3FFLFdBQVcsQ0FBQyxDQUFDLENBQUNDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDNUNDLE9BQU8sRUFBRSxFQUFFO1FBQ1hDLFVBQVUsRUFBRVosTUFBTSxDQUFDYSxNQUFNO1FBQ3pCQyxRQUFRLEVBQUVaLEtBQUssQ0FBQ2E7TUFDcEIsQ0FBQzs7TUFFRDtNQUNBLElBQUlDLGVBQWUsR0FBRyxFQUFFOztNQUV4QjtNQUNBaEIsTUFBTSxDQUFDaUIsT0FBTyxDQUFDLENBQUNDLEtBQUssRUFBRUMsS0FBSyxLQUFLO1FBQzdCSCxlQUFlLElBQUksWUFBWUcsS0FBSyxHQUFHLENBQUMsS0FBS0QsS0FBSyxDQUFDYixLQUFLLElBQUksZ0JBQWdCLE1BQU07O1FBRWxGO1FBQ0EsSUFBSWEsS0FBSyxDQUFDbEQsT0FBTyxJQUFJa0QsS0FBSyxDQUFDbEQsT0FBTyxDQUFDNkMsTUFBTSxHQUFHLENBQUMsRUFBRTtVQUMzQ0csZUFBZSxJQUFJLEdBQUdFLEtBQUssQ0FBQ2xELE9BQU8sTUFBTTtRQUM3Qzs7UUFFQTtRQUNBLElBQUlrRCxLQUFLLENBQUNFLEtBQUssSUFBSUYsS0FBSyxDQUFDRSxLQUFLLENBQUNQLE1BQU0sR0FBRyxDQUFDLEVBQUU7VUFDdkNHLGVBQWUsSUFBSSxnQkFBZ0JFLEtBQUssQ0FBQ0UsS0FBSyxNQUFNO1FBQ3hEOztRQUVBO1FBQ0FKLGVBQWUsSUFBSSxTQUFTO01BQ2hDLENBQUMsQ0FBQzs7TUFFRjtNQUNBLE1BQU05RixFQUFFLENBQUMrRCxNQUFNLENBQUN0QixPQUFPLENBQUM7O01BRXhCO01BQ0EsTUFBTTBELFNBQVMsR0FBR2pCLFFBQVEsQ0FBQ0MsS0FBSyxJQUFJckYsSUFBSSxDQUFDNEQsUUFBUSxDQUFDSCxRQUFRLEVBQUV6RCxJQUFJLENBQUNzRixPQUFPLENBQUM3QixRQUFRLENBQUMsQ0FBQzs7TUFFbkY7TUFDQSxNQUFNO1FBQUU2QztNQUEwQixDQUFDLEdBQUdyRyxPQUFPLENBQUMsb0NBQW9DLENBQUM7TUFDbkYsTUFBTXNHLFdBQVcsR0FBR0QseUJBQXlCLENBQUM7UUFDMUNqQixLQUFLLEVBQUVnQixTQUFTO1FBQ2hCRyxRQUFRLEVBQUU7TUFDZCxDQUFDLENBQUM7O01BRUY7TUFDQSxPQUFPRCxXQUFXLEdBQUdQLGVBQWU7SUFDeEMsQ0FBQyxDQUFDLE9BQU9uQyxLQUFLLEVBQUU7TUFDWkMsT0FBTyxDQUFDRCxLQUFLLENBQUMsNkNBQTZDLEVBQUVBLEtBQUssQ0FBQztNQUNuRSxNQUFNQSxLQUFLO0lBQ2Y7RUFDSjs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0lvQixvQkFBb0JBLENBQUNILGFBQWEsRUFBRTtJQUNoQztJQUNBO0lBQ0EsTUFBTTJCLFVBQVUsR0FBRzNCLGFBQWEsQ0FBQ1ksS0FBSyxDQUFDLGtCQUFrQixDQUFDLENBQUNnQixNQUFNLENBQUNDLElBQUksSUFBSUEsSUFBSSxDQUFDQyxJQUFJLENBQUMsQ0FBQyxDQUFDZixNQUFNLEdBQUcsQ0FBQyxDQUFDO0lBRWpHLE9BQU9ZLFVBQVUsQ0FBQ0ksR0FBRyxDQUFDQyxTQUFTLElBQUk7TUFDL0I7TUFDQSxNQUFNQyxLQUFLLEdBQUdELFNBQVMsQ0FBQ0YsSUFBSSxDQUFDLENBQUMsQ0FBQ2xCLEtBQUssQ0FBQyxJQUFJLENBQUM7TUFDMUMsTUFBTUwsS0FBSyxHQUFHMEIsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLGdCQUFnQjs7TUFFMUM7TUFDQSxNQUFNQyxVQUFVLEdBQUdGLFNBQVMsQ0FBQ0csT0FBTyxDQUFDLFFBQVEsQ0FBQztNQUM5QyxJQUFJakUsT0FBTyxHQUFHLEVBQUU7TUFDaEIsSUFBSW9ELEtBQUssR0FBRyxFQUFFO01BRWQsSUFBSVksVUFBVSxHQUFHLENBQUMsQ0FBQyxFQUFFO1FBQ2pCaEUsT0FBTyxHQUFHOEQsU0FBUyxDQUFDSSxTQUFTLENBQUMsQ0FBQyxFQUFFRixVQUFVLENBQUMsQ0FBQ0osSUFBSSxDQUFDLENBQUM7UUFDbkRSLEtBQUssR0FBR1UsU0FBUyxDQUFDSSxTQUFTLENBQUNGLFVBQVUsR0FBRyxDQUFDLENBQUMsQ0FBQ0osSUFBSSxDQUFDLENBQUM7TUFDdEQsQ0FBQyxNQUFNO1FBQ0g1RCxPQUFPLEdBQUc4RCxTQUFTLENBQUNGLElBQUksQ0FBQyxDQUFDO01BQzlCO01BRUEsT0FBTztRQUNIdkIsS0FBSyxFQUFFQSxLQUFLO1FBQ1pyQyxPQUFPLEVBQUVBLE9BQU87UUFDaEJvRCxLQUFLLEVBQUVBO01BQ1gsQ0FBQztJQUNMLENBQUMsQ0FBQztFQUNOOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7RUFDSWUsWUFBWUEsQ0FBQzdFLFFBQVEsRUFBRTtJQUNuQixNQUFNOEUsR0FBRyxHQUFHcEgsSUFBSSxDQUFDc0YsT0FBTyxDQUFDaEQsUUFBUSxDQUFDLENBQUMrRSxXQUFXLENBQUMsQ0FBQztJQUNoRCxPQUFPLElBQUksQ0FBQzFHLG1CQUFtQixDQUFDMkcsUUFBUSxDQUFDRixHQUFHLENBQUM7RUFDakQ7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7RUFDSUcsT0FBT0EsQ0FBQSxFQUFHO0lBQ04sT0FBTztNQUNINUQsSUFBSSxFQUFFLGdCQUFnQjtNQUN0QjZELFVBQVUsRUFBRSxJQUFJLENBQUM3RyxtQkFBbUI7TUFDcEM4RyxXQUFXLEVBQUUsaUNBQWlDO01BQzlDakYsT0FBTyxFQUFFO1FBQ0w2QyxLQUFLLEVBQUUsNkJBQTZCO1FBQ3BDckIsU0FBUyxFQUFFO01BQ2Y7SUFDSixDQUFDO0VBQ0w7QUFDSjtBQUVBMEQsTUFBTSxDQUFDQyxPQUFPLEdBQUdwSCxhQUFhIiwiaWdub3JlTGlzdCI6W119