"use strict";

/**
 * MarkdownGenerator.js
 * Generates markdown content from PDF metadata and OCR results
 */

class MarkdownGenerator {
  constructor() {
    // Initialize generator
  }

  /**
   * Generate markdown from PDF metadata and OCR result
   * @param {Object} metadata - PDF metadata
   * @param {Object} ocrResult - OCR result
   * @param {Object} options - Conversion options
   * @returns {string} Markdown content
   */
  generateMarkdown(metadata, ocrResult, options = {}) {
    console.log('[MarkdownGenerator] Generating markdown from OCR result');
    try {
      // Start with header and metadata section
      const markdown = this.generateHeader(metadata, options);

      // Add OCR information section
      this.addOcrInformation(markdown, ocrResult);

      // Add content for each page
      this.addPageContent(markdown, ocrResult);
      console.log('[MarkdownGenerator] Markdown generation complete');
      return markdown.join('\n');
    } catch (error) {
      console.error('[MarkdownGenerator] Error generating markdown:', error);

      // Create a fallback markdown with error information
      return this.generateFallbackMarkdown(metadata, ocrResult, error);
    }
  }

  /**
   * Generate markdown header with metadata
   * @param {Object} metadata - PDF metadata
   * @param {Object} options - Conversion options
   * @returns {Array} Array of markdown lines
   */
  generateHeader(metadata, options = {}) {
    // Start with title from options, metadata, or default
    const title = options.title || metadata?.title || 'PDF Document';
    const markdown = [];

    // Create standardized frontmatter using metadata utility
    const {
      createStandardFrontmatter
    } = require('../../../../converters/utils/metadata');
    const frontmatter = createStandardFrontmatter({
      title: title,
      fileType: 'pdf'
    });
    markdown.push(frontmatter.trim());
    markdown.push('');

    // Add title as heading
    markdown.push(`# ${title}`);
    markdown.push('');

    // Add metadata section if available
    if (metadata) {
      markdown.push('## Document Information');
      markdown.push('');
      markdown.push('| Property | Value |');
      markdown.push('| --- | --- |');
      if (metadata.title) {
        markdown.push(`| Title | ${metadata.title} |`);
      }
      if (metadata.author) {
        markdown.push(`| Author | ${metadata.author} |`);
      }
      if (metadata.subject) {
        markdown.push(`| Subject | ${metadata.subject} |`);
      }
      if (metadata.keywords) {
        markdown.push(`| Keywords | ${metadata.keywords} |`);
      }
      if (metadata.creator) {
        markdown.push(`| Creator | ${metadata.creator} |`);
      }
      if (metadata.producer) {
        markdown.push(`| Producer | ${metadata.producer} |`);
      }
      if (metadata.creationDate) {
        markdown.push(`| Creation Date | ${metadata.creationDate} |`);
      }
      if (metadata.modificationDate) {
        markdown.push(`| Modification Date | ${metadata.modificationDate} |`);
      }
      if (metadata.pageCount) {
        markdown.push(`| Page Count | ${metadata.pageCount} |`);
      }
      markdown.push('');
    }
    return markdown;
  }

  /**
   * Add OCR information section
   * @param {Array} markdown - Markdown lines array
   * @param {Object} ocrResult - OCR result
   */
  addOcrInformation(markdown, ocrResult) {
    // Add OCR section header
    markdown.push('## OCR Information');
    markdown.push('');
    markdown.push('This document was processed using Mistral OCR technology.');

    // Add OCR model and language information if available
    if (ocrResult && ocrResult.documentInfo) {
      const docInfo = ocrResult.documentInfo;
      markdown.push('');
      markdown.push('| Property | Value |');
      markdown.push('| --- | --- |');
      if (docInfo.model && docInfo.model !== 'unknown') {
        markdown.push(`| Model | ${docInfo.model} |`);
      }
      if (docInfo.language && docInfo.language !== 'unknown') {
        markdown.push(`| Language | ${docInfo.language} |`);
      }
      if (docInfo.processingTime) {
        markdown.push(`| Processing Time | ${docInfo.processingTime}s |`);
      }
      if (docInfo.overallConfidence) {
        const confidencePercent = Math.round(docInfo.overallConfidence * 100);
        markdown.push(`| Overall Confidence | ${confidencePercent}% |`);
      }

      // Add usage information if available
      if (docInfo.usage) {
        if (docInfo.usage.total_tokens) {
          markdown.push(`| Total Tokens | ${docInfo.usage.total_tokens} |`);
        }
        if (docInfo.usage.prompt_tokens) {
          markdown.push(`| Prompt Tokens | ${docInfo.usage.prompt_tokens} |`);
        }
        if (docInfo.usage.completion_tokens) {
          markdown.push(`| Completion Tokens | ${docInfo.usage.completion_tokens} |`);
        }
      }

      // Add error information if present
      if (docInfo.error) {
        markdown.push(`| Error | ${docInfo.error} |`);
      }
    }
    markdown.push('');
  }

  /**
   * Add content for each page
   * @param {Array} markdown - Markdown lines array
   * @param {Object} ocrResult - OCR result
   */
  addPageContent(markdown, ocrResult) {
    // Add content for each page
    if (ocrResult && ocrResult.pages && ocrResult.pages.length > 0) {
      // Process each page in sequence but don't add page headers at this point
      const allPageContents = ocrResult.pages.map((page, index) => {
        // Use page number if available, otherwise use index + 1
        const pageNumber = page.pageNumber || index + 1;
        const pageMarkdown = [];

        // Add page text with better handling of different content formats
        let pageContent = '';
        if (page.text && page.text.trim()) {
          pageContent = page.text;
        } else if (page.content && typeof page.content === 'string' && page.content.trim()) {
          pageContent = page.content;
        } else if (page.blocks && Array.isArray(page.blocks) && page.blocks.length > 0) {
          // If blocks are available, process them into text
          const textBlocks = this._processBlocks(page.blocks);
          pageContent = textBlocks.join('\n\n');
        } else if (page.elements && Array.isArray(page.elements) && page.elements.length > 0) {
          // If elements are available, process them into text
          const elements = page.elements.map(element => {
            if (element.type === 'text' && element.text) {
              return element.text;
            } else if (element.content) {
              return element.content;
            }
            return '';
          }).filter(text => text.trim().length > 0);
          pageContent = elements.join('\n\n');
        }

        // Add content if available, otherwise indicate no content
        if (pageContent && pageContent.trim()) {
          pageMarkdown.push(pageContent);
        } else {
          pageMarkdown.push('*No text content was extracted from this page.*');
        }
        return {
          number: pageNumber,
          content: pageMarkdown.join('\n\n'),
          isEmpty: !pageContent || !pageContent.trim()
        };
      });

      // Combine all non-empty page contents first
      const nonEmptyPages = allPageContents.filter(page => !page.isEmpty);
      if (nonEmptyPages.length > 0) {
        // Add combined content
        markdown.push(nonEmptyPages.map(page => page.content).join('\n\n'));
        markdown.push('');

        // Then add the page markers at the bottom
        nonEmptyPages.forEach(page => {
          markdown.push(`---\n[Page ${page.number}]`);
          markdown.push('');
        });
      } else {
        // If all pages were empty, show a global message
        markdown.push('No text content was extracted from this document.');
        markdown.push('');
      }
    } else {
      markdown.push('No text content was extracted from this document.');

      // If we have a raw text field at the document level, use that
      if (ocrResult && ocrResult.text && typeof ocrResult.text === 'string' && ocrResult.text.trim()) {
        markdown.push('');
        markdown.push('## Document Content');
        markdown.push('');
        markdown.push(ocrResult.text);
      } else if (ocrResult && ocrResult.content && typeof ocrResult.content === 'string' && ocrResult.content.trim()) {
        markdown.push('');
        markdown.push('## Document Content');
        markdown.push('');
        markdown.push(ocrResult.content);
      }
    }
  }

  /**
   * Process blocks into text (simple placeholder - actual implementation in OcrProcessor)
   * @param {Array} blocks - Content blocks
   * @returns {Array} Array of text blocks
   * @private
   */
  _processBlocks(blocks) {
    // This is just a placeholder - actual implementation should be in OcrProcessor
    // This simply returns any text content from blocks
    return blocks.map(block => block.text || block.content || '').filter(text => text.trim().length > 0);
  }

  /**
   * Generate fallback markdown when an error occurs
   * @param {Object} metadata - PDF metadata
   * @param {Object} ocrResult - OCR result
   * @param {Error} error - Error that occurred
   * @returns {string} Fallback markdown content
   */
  generateFallbackMarkdown(metadata, ocrResult, error) {
    const fallbackMarkdown = ['# OCR Conversion Result', '', '## Error Information', '', `An error occurred during markdown generation: ${error.message}`, '', '## Document Information', ''];

    // Add any metadata we have
    if (metadata) {
      fallbackMarkdown.push('### Metadata');
      fallbackMarkdown.push('');
      if (metadata.title) {
        fallbackMarkdown.push(`**Title:** ${metadata.title}`);
      }
      if (metadata.author) {
        fallbackMarkdown.push(`**Author:** ${metadata.author}`);
      }
      if (metadata.subject) {
        fallbackMarkdown.push(`**Subject:** ${metadata.subject}`);
      }
      if (metadata.keywords) {
        fallbackMarkdown.push(`**Keywords:** ${metadata.keywords}`);
      }
      if (metadata.creator) {
        fallbackMarkdown.push(`**Creator:** ${metadata.creator}`);
      }
      if (metadata.producer) {
        fallbackMarkdown.push(`**Producer:** ${metadata.producer}`);
      }
      if (metadata.creationDate) {
        fallbackMarkdown.push(`**Creation Date:** ${metadata.creationDate}`);
      }
      if (metadata.modificationDate) {
        fallbackMarkdown.push(`**Modification Date:** ${metadata.modificationDate}`);
      }
      fallbackMarkdown.push('');
    }

    // Add any raw OCR result text if available
    if (ocrResult) {
      fallbackMarkdown.push('### OCR Result');
      fallbackMarkdown.push('');
      if (ocrResult.text) {
        fallbackMarkdown.push(ocrResult.text);
      } else if (ocrResult.content) {
        fallbackMarkdown.push(ocrResult.content);
      } else if (ocrResult.pages && ocrResult.pages.length > 0) {
        ocrResult.pages.forEach((page, index) => {
          fallbackMarkdown.push(`#### Page ${index + 1}`);
          fallbackMarkdown.push('');
          fallbackMarkdown.push(page.text || page.content || '*No content available*');
          fallbackMarkdown.push('');
        });
      } else {
        fallbackMarkdown.push('*No OCR content available*');
      }
    }
    return fallbackMarkdown.join('\n');
  }

  /**
   * Create standardized frontmatter
   * @param {Object} metadata - PDF metadata
   * @param {Object} options - Conversion options
   * @returns {string} Frontmatter content
   */
  generateFrontmatter(metadata, options = {}) {
    // Get the title from metadata or filename
    const fileTitle = metadata?.title || options.name || 'PDF Document';

    // Use the centralized metadata utility for consistent frontmatter
    const {
      createStandardFrontmatter
    } = require('../../../../converters/utils/metadata');
    const frontmatter = createStandardFrontmatter({
      title: fileTitle,
      fileType: 'pdf'
    });
    return frontmatter;
  }

  /**
   * Generate complete document with frontmatter and content
   * @param {Object} metadata - PDF metadata
   * @param {Object} ocrResult - OCR result
   * @param {Object} options - Conversion options
   * @returns {string} Complete markdown document
   */
  generateCompleteDocument(metadata, ocrResult, options = {}) {
    const frontmatter = this.generateFrontmatter(metadata, options);
    const content = this.generateMarkdown(metadata, ocrResult, options);
    return frontmatter + content;
  }
}
module.exports = MarkdownGenerator;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJNYXJrZG93bkdlbmVyYXRvciIsImNvbnN0cnVjdG9yIiwiZ2VuZXJhdGVNYXJrZG93biIsIm1ldGFkYXRhIiwib2NyUmVzdWx0Iiwib3B0aW9ucyIsImNvbnNvbGUiLCJsb2ciLCJtYXJrZG93biIsImdlbmVyYXRlSGVhZGVyIiwiYWRkT2NySW5mb3JtYXRpb24iLCJhZGRQYWdlQ29udGVudCIsImpvaW4iLCJlcnJvciIsImdlbmVyYXRlRmFsbGJhY2tNYXJrZG93biIsInRpdGxlIiwiY3JlYXRlU3RhbmRhcmRGcm9udG1hdHRlciIsInJlcXVpcmUiLCJmcm9udG1hdHRlciIsImZpbGVUeXBlIiwicHVzaCIsInRyaW0iLCJhdXRob3IiLCJzdWJqZWN0Iiwia2V5d29yZHMiLCJjcmVhdG9yIiwicHJvZHVjZXIiLCJjcmVhdGlvbkRhdGUiLCJtb2RpZmljYXRpb25EYXRlIiwicGFnZUNvdW50IiwiZG9jdW1lbnRJbmZvIiwiZG9jSW5mbyIsIm1vZGVsIiwibGFuZ3VhZ2UiLCJwcm9jZXNzaW5nVGltZSIsIm92ZXJhbGxDb25maWRlbmNlIiwiY29uZmlkZW5jZVBlcmNlbnQiLCJNYXRoIiwicm91bmQiLCJ1c2FnZSIsInRvdGFsX3Rva2VucyIsInByb21wdF90b2tlbnMiLCJjb21wbGV0aW9uX3Rva2VucyIsInBhZ2VzIiwibGVuZ3RoIiwiYWxsUGFnZUNvbnRlbnRzIiwibWFwIiwicGFnZSIsImluZGV4IiwicGFnZU51bWJlciIsInBhZ2VNYXJrZG93biIsInBhZ2VDb250ZW50IiwidGV4dCIsImNvbnRlbnQiLCJibG9ja3MiLCJBcnJheSIsImlzQXJyYXkiLCJ0ZXh0QmxvY2tzIiwiX3Byb2Nlc3NCbG9ja3MiLCJlbGVtZW50cyIsImVsZW1lbnQiLCJ0eXBlIiwiZmlsdGVyIiwibnVtYmVyIiwiaXNFbXB0eSIsIm5vbkVtcHR5UGFnZXMiLCJmb3JFYWNoIiwiYmxvY2siLCJmYWxsYmFja01hcmtkb3duIiwibWVzc2FnZSIsImdlbmVyYXRlRnJvbnRtYXR0ZXIiLCJmaWxlVGl0bGUiLCJuYW1lIiwiZ2VuZXJhdGVDb21wbGV0ZURvY3VtZW50IiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL2RvY3VtZW50L21pc3RyYWwvTWFya2Rvd25HZW5lcmF0b3IuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIE1hcmtkb3duR2VuZXJhdG9yLmpzXHJcbiAqIEdlbmVyYXRlcyBtYXJrZG93biBjb250ZW50IGZyb20gUERGIG1ldGFkYXRhIGFuZCBPQ1IgcmVzdWx0c1xyXG4gKi9cclxuXHJcbmNsYXNzIE1hcmtkb3duR2VuZXJhdG9yIHtcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIC8vIEluaXRpYWxpemUgZ2VuZXJhdG9yXHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZW5lcmF0ZSBtYXJrZG93biBmcm9tIFBERiBtZXRhZGF0YSBhbmQgT0NSIHJlc3VsdFxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBtZXRhZGF0YSAtIFBERiBtZXRhZGF0YVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvY3JSZXN1bHQgLSBPQ1IgcmVzdWx0XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBjb250ZW50XHJcbiAgICovXHJcbiAgZ2VuZXJhdGVNYXJrZG93bihtZXRhZGF0YSwgb2NyUmVzdWx0LCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnNvbGUubG9nKCdbTWFya2Rvd25HZW5lcmF0b3JdIEdlbmVyYXRpbmcgbWFya2Rvd24gZnJvbSBPQ1IgcmVzdWx0Jyk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFN0YXJ0IHdpdGggaGVhZGVyIGFuZCBtZXRhZGF0YSBzZWN0aW9uXHJcbiAgICAgIGNvbnN0IG1hcmtkb3duID0gdGhpcy5nZW5lcmF0ZUhlYWRlcihtZXRhZGF0YSwgb3B0aW9ucyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBBZGQgT0NSIGluZm9ybWF0aW9uIHNlY3Rpb25cclxuICAgICAgdGhpcy5hZGRPY3JJbmZvcm1hdGlvbihtYXJrZG93biwgb2NyUmVzdWx0KTtcclxuICAgICAgXHJcbiAgICAgIC8vIEFkZCBjb250ZW50IGZvciBlYWNoIHBhZ2VcclxuICAgICAgdGhpcy5hZGRQYWdlQ29udGVudChtYXJrZG93biwgb2NyUmVzdWx0KTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKCdbTWFya2Rvd25HZW5lcmF0b3JdIE1hcmtkb3duIGdlbmVyYXRpb24gY29tcGxldGUnKTtcclxuICAgICAgcmV0dXJuIG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignW01hcmtkb3duR2VuZXJhdG9yXSBFcnJvciBnZW5lcmF0aW5nIG1hcmtkb3duOicsIGVycm9yKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSBhIGZhbGxiYWNrIG1hcmtkb3duIHdpdGggZXJyb3IgaW5mb3JtYXRpb25cclxuICAgICAgcmV0dXJuIHRoaXMuZ2VuZXJhdGVGYWxsYmFja01hcmtkb3duKG1ldGFkYXRhLCBvY3JSZXN1bHQsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdlbmVyYXRlIG1hcmtkb3duIGhlYWRlciB3aXRoIG1ldGFkYXRhXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gUERGIG1ldGFkYXRhXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgKiBAcmV0dXJucyB7QXJyYXl9IEFycmF5IG9mIG1hcmtkb3duIGxpbmVzXHJcbiAgICovXHJcbiAgZ2VuZXJhdGVIZWFkZXIobWV0YWRhdGEsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgLy8gU3RhcnQgd2l0aCB0aXRsZSBmcm9tIG9wdGlvbnMsIG1ldGFkYXRhLCBvciBkZWZhdWx0XHJcbiAgICBjb25zdCB0aXRsZSA9IG9wdGlvbnMudGl0bGUgfHwgbWV0YWRhdGE/LnRpdGxlIHx8ICdQREYgRG9jdW1lbnQnO1xyXG4gICAgXHJcbiAgICBjb25zdCBtYXJrZG93biA9IFtdO1xyXG4gICAgXHJcbiAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGZyb250bWF0dGVyIHVzaW5nIG1ldGFkYXRhIHV0aWxpdHlcclxuICAgIGNvbnN0IHsgY3JlYXRlU3RhbmRhcmRGcm9udG1hdHRlciB9ID0gcmVxdWlyZSgnLi4vLi4vLi4vLi4vY29udmVydGVycy91dGlscy9tZXRhZGF0YScpO1xyXG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBjcmVhdGVTdGFuZGFyZEZyb250bWF0dGVyKHtcclxuICAgICAgICB0aXRsZTogdGl0bGUsXHJcbiAgICAgICAgZmlsZVR5cGU6ICdwZGYnXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbWFya2Rvd24ucHVzaChmcm9udG1hdHRlci50cmltKCkpO1xyXG4gICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICBcclxuICAgIC8vIEFkZCB0aXRsZSBhcyBoZWFkaW5nXHJcbiAgICBtYXJrZG93bi5wdXNoKGAjICR7dGl0bGV9YCk7XHJcbiAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgIFxyXG4gICAgLy8gQWRkIG1ldGFkYXRhIHNlY3Rpb24gaWYgYXZhaWxhYmxlXHJcbiAgICBpZiAobWV0YWRhdGEpIHtcclxuICAgICAgbWFya2Rvd24ucHVzaCgnIyMgRG9jdW1lbnQgSW5mb3JtYXRpb24nKTtcclxuICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgIG1hcmtkb3duLnB1c2goJ3wgUHJvcGVydHkgfCBWYWx1ZSB8Jyk7XHJcbiAgICAgIG1hcmtkb3duLnB1c2goJ3wgLS0tIHwgLS0tIHwnKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS50aXRsZSkge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgVGl0bGUgfCAke21ldGFkYXRhLnRpdGxlfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5hdXRob3IpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IEF1dGhvciB8ICR7bWV0YWRhdGEuYXV0aG9yfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5zdWJqZWN0KSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBTdWJqZWN0IHwgJHttZXRhZGF0YS5zdWJqZWN0fSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5rZXl3b3Jkcykge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgS2V5d29yZHMgfCAke21ldGFkYXRhLmtleXdvcmRzfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5jcmVhdG9yKSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBDcmVhdG9yIHwgJHttZXRhZGF0YS5jcmVhdG9yfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5wcm9kdWNlcikge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgUHJvZHVjZXIgfCAke21ldGFkYXRhLnByb2R1Y2VyfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5jcmVhdGlvbkRhdGUpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IENyZWF0aW9uIERhdGUgfCAke21ldGFkYXRhLmNyZWF0aW9uRGF0ZX0gfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAobWV0YWRhdGEubW9kaWZpY2F0aW9uRGF0ZSkge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgTW9kaWZpY2F0aW9uIERhdGUgfCAke21ldGFkYXRhLm1vZGlmaWNhdGlvbkRhdGV9IHxgKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgaWYgKG1ldGFkYXRhLnBhZ2VDb3VudCkge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgUGFnZSBDb3VudCB8ICR7bWV0YWRhdGEucGFnZUNvdW50fSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gbWFya2Rvd247XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBBZGQgT0NSIGluZm9ybWF0aW9uIHNlY3Rpb25cclxuICAgKiBAcGFyYW0ge0FycmF5fSBtYXJrZG93biAtIE1hcmtkb3duIGxpbmVzIGFycmF5XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9jclJlc3VsdCAtIE9DUiByZXN1bHRcclxuICAgKi9cclxuICBhZGRPY3JJbmZvcm1hdGlvbihtYXJrZG93biwgb2NyUmVzdWx0KSB7XHJcbiAgICAvLyBBZGQgT0NSIHNlY3Rpb24gaGVhZGVyXHJcbiAgICBtYXJrZG93bi5wdXNoKCcjIyBPQ1IgSW5mb3JtYXRpb24nKTtcclxuICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgbWFya2Rvd24ucHVzaCgnVGhpcyBkb2N1bWVudCB3YXMgcHJvY2Vzc2VkIHVzaW5nIE1pc3RyYWwgT0NSIHRlY2hub2xvZ3kuJyk7XHJcbiAgICBcclxuICAgIC8vIEFkZCBPQ1IgbW9kZWwgYW5kIGxhbmd1YWdlIGluZm9ybWF0aW9uIGlmIGF2YWlsYWJsZVxyXG4gICAgaWYgKG9jclJlc3VsdCAmJiBvY3JSZXN1bHQuZG9jdW1lbnRJbmZvKSB7XHJcbiAgICAgIGNvbnN0IGRvY0luZm8gPSBvY3JSZXN1bHQuZG9jdW1lbnRJbmZvO1xyXG4gICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgbWFya2Rvd24ucHVzaCgnfCBQcm9wZXJ0eSB8IFZhbHVlIHwnKTtcclxuICAgICAgbWFya2Rvd24ucHVzaCgnfCAtLS0gfCAtLS0gfCcpO1xyXG4gICAgICBcclxuICAgICAgaWYgKGRvY0luZm8ubW9kZWwgJiYgZG9jSW5mby5tb2RlbCAhPT0gJ3Vua25vd24nKSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBNb2RlbCB8ICR7ZG9jSW5mby5tb2RlbH0gfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAoZG9jSW5mby5sYW5ndWFnZSAmJiBkb2NJbmZvLmxhbmd1YWdlICE9PSAndW5rbm93bicpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IExhbmd1YWdlIHwgJHtkb2NJbmZvLmxhbmd1YWdlfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChkb2NJbmZvLnByb2Nlc3NpbmdUaW1lKSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBQcm9jZXNzaW5nIFRpbWUgfCAke2RvY0luZm8ucHJvY2Vzc2luZ1RpbWV9cyB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChkb2NJbmZvLm92ZXJhbGxDb25maWRlbmNlKSB7XHJcbiAgICAgICAgY29uc3QgY29uZmlkZW5jZVBlcmNlbnQgPSBNYXRoLnJvdW5kKGRvY0luZm8ub3ZlcmFsbENvbmZpZGVuY2UgKiAxMDApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgT3ZlcmFsbCBDb25maWRlbmNlIHwgJHtjb25maWRlbmNlUGVyY2VudH0lIHxgKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gQWRkIHVzYWdlIGluZm9ybWF0aW9uIGlmIGF2YWlsYWJsZVxyXG4gICAgICBpZiAoZG9jSW5mby51c2FnZSkge1xyXG4gICAgICAgIGlmIChkb2NJbmZvLnVzYWdlLnRvdGFsX3Rva2Vucykge1xyXG4gICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBUb3RhbCBUb2tlbnMgfCAke2RvY0luZm8udXNhZ2UudG90YWxfdG9rZW5zfSB8YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChkb2NJbmZvLnVzYWdlLnByb21wdF90b2tlbnMpIHtcclxuICAgICAgICAgIG1hcmtkb3duLnB1c2goYHwgUHJvbXB0IFRva2VucyB8ICR7ZG9jSW5mby51c2FnZS5wcm9tcHRfdG9rZW5zfSB8YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChkb2NJbmZvLnVzYWdlLmNvbXBsZXRpb25fdG9rZW5zKSB7XHJcbiAgICAgICAgICBtYXJrZG93bi5wdXNoKGB8IENvbXBsZXRpb24gVG9rZW5zIHwgJHtkb2NJbmZvLnVzYWdlLmNvbXBsZXRpb25fdG9rZW5zfSB8YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBBZGQgZXJyb3IgaW5mb3JtYXRpb24gaWYgcHJlc2VudFxyXG4gICAgICBpZiAoZG9jSW5mby5lcnJvcikge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRXJyb3IgfCAke2RvY0luZm8uZXJyb3J9IHxgKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEFkZCBjb250ZW50IGZvciBlYWNoIHBhZ2VcclxuICAgKiBAcGFyYW0ge0FycmF5fSBtYXJrZG93biAtIE1hcmtkb3duIGxpbmVzIGFycmF5XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9jclJlc3VsdCAtIE9DUiByZXN1bHRcclxuICAgKi9cclxuICBhZGRQYWdlQ29udGVudChtYXJrZG93biwgb2NyUmVzdWx0KSB7XHJcbiAgICAvLyBBZGQgY29udGVudCBmb3IgZWFjaCBwYWdlXHJcbiAgICBpZiAob2NyUmVzdWx0ICYmIG9jclJlc3VsdC5wYWdlcyAmJiBvY3JSZXN1bHQucGFnZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAvLyBQcm9jZXNzIGVhY2ggcGFnZSBpbiBzZXF1ZW5jZSBidXQgZG9uJ3QgYWRkIHBhZ2UgaGVhZGVycyBhdCB0aGlzIHBvaW50XHJcbiAgICAgIGNvbnN0IGFsbFBhZ2VDb250ZW50cyA9IG9jclJlc3VsdC5wYWdlcy5tYXAoKHBhZ2UsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgLy8gVXNlIHBhZ2UgbnVtYmVyIGlmIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIHVzZSBpbmRleCArIDFcclxuICAgICAgICBjb25zdCBwYWdlTnVtYmVyID0gcGFnZS5wYWdlTnVtYmVyIHx8IGluZGV4ICsgMTtcclxuICAgICAgICBjb25zdCBwYWdlTWFya2Rvd24gPSBbXTtcclxuXHJcbiAgICAgICAgLy8gQWRkIHBhZ2UgdGV4dCB3aXRoIGJldHRlciBoYW5kbGluZyBvZiBkaWZmZXJlbnQgY29udGVudCBmb3JtYXRzXHJcbiAgICAgICAgbGV0IHBhZ2VDb250ZW50ID0gJyc7XHJcblxyXG4gICAgICAgIGlmIChwYWdlLnRleHQgJiYgcGFnZS50ZXh0LnRyaW0oKSkge1xyXG4gICAgICAgICAgcGFnZUNvbnRlbnQgPSBwYWdlLnRleHQ7XHJcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlLmNvbnRlbnQgJiYgdHlwZW9mIHBhZ2UuY29udGVudCA9PT0gJ3N0cmluZycgJiYgcGFnZS5jb250ZW50LnRyaW0oKSkge1xyXG4gICAgICAgICAgcGFnZUNvbnRlbnQgPSBwYWdlLmNvbnRlbnQ7XHJcbiAgICAgICAgfSBlbHNlIGlmIChwYWdlLmJsb2NrcyAmJiBBcnJheS5pc0FycmF5KHBhZ2UuYmxvY2tzKSAmJiBwYWdlLmJsb2Nrcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAvLyBJZiBibG9ja3MgYXJlIGF2YWlsYWJsZSwgcHJvY2VzcyB0aGVtIGludG8gdGV4dFxyXG4gICAgICAgICAgY29uc3QgdGV4dEJsb2NrcyA9IHRoaXMuX3Byb2Nlc3NCbG9ja3MocGFnZS5ibG9ja3MpO1xyXG4gICAgICAgICAgcGFnZUNvbnRlbnQgPSB0ZXh0QmxvY2tzLmpvaW4oJ1xcblxcbicpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAocGFnZS5lbGVtZW50cyAmJiBBcnJheS5pc0FycmF5KHBhZ2UuZWxlbWVudHMpICYmIHBhZ2UuZWxlbWVudHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgLy8gSWYgZWxlbWVudHMgYXJlIGF2YWlsYWJsZSwgcHJvY2VzcyB0aGVtIGludG8gdGV4dFxyXG4gICAgICAgICAgY29uc3QgZWxlbWVudHMgPSBwYWdlLmVsZW1lbnRzLm1hcChlbGVtZW50ID0+IHtcclxuICAgICAgICAgICAgaWYgKGVsZW1lbnQudHlwZSA9PT0gJ3RleHQnICYmIGVsZW1lbnQudGV4dCkge1xyXG4gICAgICAgICAgICAgIHJldHVybiBlbGVtZW50LnRleHQ7XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZWxlbWVudC5jb250ZW50KSB7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQuY29udGVudDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gJyc7XHJcbiAgICAgICAgICB9KS5maWx0ZXIodGV4dCA9PiB0ZXh0LnRyaW0oKS5sZW5ndGggPiAwKTtcclxuXHJcbiAgICAgICAgICBwYWdlQ29udGVudCA9IGVsZW1lbnRzLmpvaW4oJ1xcblxcbicpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQWRkIGNvbnRlbnQgaWYgYXZhaWxhYmxlLCBvdGhlcndpc2UgaW5kaWNhdGUgbm8gY29udGVudFxyXG4gICAgICAgIGlmIChwYWdlQ29udGVudCAmJiBwYWdlQ29udGVudC50cmltKCkpIHtcclxuICAgICAgICAgIHBhZ2VNYXJrZG93bi5wdXNoKHBhZ2VDb250ZW50KTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgcGFnZU1hcmtkb3duLnB1c2goJypObyB0ZXh0IGNvbnRlbnQgd2FzIGV4dHJhY3RlZCBmcm9tIHRoaXMgcGFnZS4qJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgbnVtYmVyOiBwYWdlTnVtYmVyLFxyXG4gICAgICAgICAgY29udGVudDogcGFnZU1hcmtkb3duLmpvaW4oJ1xcblxcbicpLFxyXG4gICAgICAgICAgaXNFbXB0eTogIXBhZ2VDb250ZW50IHx8ICFwYWdlQ29udGVudC50cmltKClcclxuICAgICAgICB9O1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIENvbWJpbmUgYWxsIG5vbi1lbXB0eSBwYWdlIGNvbnRlbnRzIGZpcnN0XHJcbiAgICAgIGNvbnN0IG5vbkVtcHR5UGFnZXMgPSBhbGxQYWdlQ29udGVudHMuZmlsdGVyKHBhZ2UgPT4gIXBhZ2UuaXNFbXB0eSk7XHJcblxyXG4gICAgICBpZiAobm9uRW1wdHlQYWdlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgLy8gQWRkIGNvbWJpbmVkIGNvbnRlbnRcclxuICAgICAgICBtYXJrZG93bi5wdXNoKG5vbkVtcHR5UGFnZXMubWFwKHBhZ2UgPT4gcGFnZS5jb250ZW50KS5qb2luKCdcXG5cXG4nKSk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcblxyXG4gICAgICAgIC8vIFRoZW4gYWRkIHRoZSBwYWdlIG1hcmtlcnMgYXQgdGhlIGJvdHRvbVxyXG4gICAgICAgIG5vbkVtcHR5UGFnZXMuZm9yRWFjaChwYWdlID0+IHtcclxuICAgICAgICAgIG1hcmtkb3duLnB1c2goYC0tLVxcbltQYWdlICR7cGFnZS5udW1iZXJ9XWApO1xyXG4gICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gSWYgYWxsIHBhZ2VzIHdlcmUgZW1wdHksIHNob3cgYSBnbG9iYWwgbWVzc2FnZVxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJ05vIHRleHQgY29udGVudCB3YXMgZXh0cmFjdGVkIGZyb20gdGhpcyBkb2N1bWVudC4nKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgbWFya2Rvd24ucHVzaCgnTm8gdGV4dCBjb250ZW50IHdhcyBleHRyYWN0ZWQgZnJvbSB0aGlzIGRvY3VtZW50LicpO1xyXG5cclxuICAgICAgLy8gSWYgd2UgaGF2ZSBhIHJhdyB0ZXh0IGZpZWxkIGF0IHRoZSBkb2N1bWVudCBsZXZlbCwgdXNlIHRoYXRcclxuICAgICAgaWYgKG9jclJlc3VsdCAmJiBvY3JSZXN1bHQudGV4dCAmJiB0eXBlb2Ygb2NyUmVzdWx0LnRleHQgPT09ICdzdHJpbmcnICYmIG9jclJlc3VsdC50ZXh0LnRyaW0oKSkge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIERvY3VtZW50IENvbnRlbnQnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKG9jclJlc3VsdC50ZXh0KTtcclxuICAgICAgfSBlbHNlIGlmIChvY3JSZXN1bHQgJiYgb2NyUmVzdWx0LmNvbnRlbnQgJiYgdHlwZW9mIG9jclJlc3VsdC5jb250ZW50ID09PSAnc3RyaW5nJyAmJiBvY3JSZXN1bHQuY29udGVudC50cmltKCkpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBEb2N1bWVudCBDb250ZW50Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChvY3JSZXN1bHQuY29udGVudCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFByb2Nlc3MgYmxvY2tzIGludG8gdGV4dCAoc2ltcGxlIHBsYWNlaG9sZGVyIC0gYWN0dWFsIGltcGxlbWVudGF0aW9uIGluIE9jclByb2Nlc3NvcilcclxuICAgKiBAcGFyYW0ge0FycmF5fSBibG9ja3MgLSBDb250ZW50IGJsb2Nrc1xyXG4gICAqIEByZXR1cm5zIHtBcnJheX0gQXJyYXkgb2YgdGV4dCBibG9ja3NcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIF9wcm9jZXNzQmxvY2tzKGJsb2Nrcykge1xyXG4gICAgLy8gVGhpcyBpcyBqdXN0IGEgcGxhY2Vob2xkZXIgLSBhY3R1YWwgaW1wbGVtZW50YXRpb24gc2hvdWxkIGJlIGluIE9jclByb2Nlc3NvclxyXG4gICAgLy8gVGhpcyBzaW1wbHkgcmV0dXJucyBhbnkgdGV4dCBjb250ZW50IGZyb20gYmxvY2tzXHJcbiAgICByZXR1cm4gYmxvY2tzXHJcbiAgICAgIC5tYXAoYmxvY2sgPT4gYmxvY2sudGV4dCB8fCBibG9jay5jb250ZW50IHx8ICcnKVxyXG4gICAgICAuZmlsdGVyKHRleHQgPT4gdGV4dC50cmltKCkubGVuZ3RoID4gMCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZW5lcmF0ZSBmYWxsYmFjayBtYXJrZG93biB3aGVuIGFuIGVycm9yIG9jY3Vyc1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBtZXRhZGF0YSAtIFBERiBtZXRhZGF0YVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvY3JSZXN1bHQgLSBPQ1IgcmVzdWx0XHJcbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBFcnJvciB0aGF0IG9jY3VycmVkXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gRmFsbGJhY2sgbWFya2Rvd24gY29udGVudFxyXG4gICAqL1xyXG4gIGdlbmVyYXRlRmFsbGJhY2tNYXJrZG93bihtZXRhZGF0YSwgb2NyUmVzdWx0LCBlcnJvcikge1xyXG4gICAgY29uc3QgZmFsbGJhY2tNYXJrZG93biA9IFtcclxuICAgICAgJyMgT0NSIENvbnZlcnNpb24gUmVzdWx0JyxcclxuICAgICAgJycsXHJcbiAgICAgICcjIyBFcnJvciBJbmZvcm1hdGlvbicsXHJcbiAgICAgICcnLFxyXG4gICAgICBgQW4gZXJyb3Igb2NjdXJyZWQgZHVyaW5nIG1hcmtkb3duIGdlbmVyYXRpb246ICR7ZXJyb3IubWVzc2FnZX1gLFxyXG4gICAgICAnJyxcclxuICAgICAgJyMjIERvY3VtZW50IEluZm9ybWF0aW9uJyxcclxuICAgICAgJydcclxuICAgIF07XHJcbiAgICBcclxuICAgIC8vIEFkZCBhbnkgbWV0YWRhdGEgd2UgaGF2ZVxyXG4gICAgaWYgKG1ldGFkYXRhKSB7XHJcbiAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaCgnIyMjIE1ldGFkYXRhJyk7XHJcbiAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAobWV0YWRhdGEudGl0bGUpIHtcclxuICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCoqVGl0bGU6KiogJHttZXRhZGF0YS50aXRsZX1gKTtcclxuICAgICAgfVxyXG4gICAgICBpZiAobWV0YWRhdGEuYXV0aG9yKSB7XHJcbiAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKGAqKkF1dGhvcjoqKiAke21ldGFkYXRhLmF1dGhvcn1gKTtcclxuICAgICAgfVxyXG4gICAgICBpZiAobWV0YWRhdGEuc3ViamVjdCkge1xyXG4gICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgKipTdWJqZWN0OioqICR7bWV0YWRhdGEuc3ViamVjdH1gKTtcclxuICAgICAgfVxyXG4gICAgICBpZiAobWV0YWRhdGEua2V5d29yZHMpIHtcclxuICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCoqS2V5d29yZHM6KiogJHttZXRhZGF0YS5rZXl3b3Jkc31gKTtcclxuICAgICAgfVxyXG4gICAgICBpZiAobWV0YWRhdGEuY3JlYXRvcikge1xyXG4gICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgKipDcmVhdG9yOioqICR7bWV0YWRhdGEuY3JlYXRvcn1gKTtcclxuICAgICAgfVxyXG4gICAgICBpZiAobWV0YWRhdGEucHJvZHVjZXIpIHtcclxuICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCoqUHJvZHVjZXI6KiogJHttZXRhZGF0YS5wcm9kdWNlcn1gKTtcclxuICAgICAgfVxyXG4gICAgICBpZiAobWV0YWRhdGEuY3JlYXRpb25EYXRlKSB7XHJcbiAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKGAqKkNyZWF0aW9uIERhdGU6KiogJHttZXRhZGF0YS5jcmVhdGlvbkRhdGV9YCk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG1ldGFkYXRhLm1vZGlmaWNhdGlvbkRhdGUpIHtcclxuICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCoqTW9kaWZpY2F0aW9uIERhdGU6KiogJHttZXRhZGF0YS5tb2RpZmljYXRpb25EYXRlfWApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goJycpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBBZGQgYW55IHJhdyBPQ1IgcmVzdWx0IHRleHQgaWYgYXZhaWxhYmxlXHJcbiAgICBpZiAob2NyUmVzdWx0KSB7XHJcbiAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaCgnIyMjIE9DUiBSZXN1bHQnKTtcclxuICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChvY3JSZXN1bHQudGV4dCkge1xyXG4gICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChvY3JSZXN1bHQudGV4dCk7XHJcbiAgICAgIH0gZWxzZSBpZiAob2NyUmVzdWx0LmNvbnRlbnQpIHtcclxuICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2gob2NyUmVzdWx0LmNvbnRlbnQpO1xyXG4gICAgICB9IGVsc2UgaWYgKG9jclJlc3VsdC5wYWdlcyAmJiBvY3JSZXN1bHQucGFnZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIG9jclJlc3VsdC5wYWdlcy5mb3JFYWNoKChwYWdlLCBpbmRleCkgPT4ge1xyXG4gICAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKGAjIyMjIFBhZ2UgJHtpbmRleCArIDF9YCk7XHJcbiAgICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKHBhZ2UudGV4dCB8fCBwYWdlLmNvbnRlbnQgfHwgJypObyBjb250ZW50IGF2YWlsYWJsZSonKTtcclxuICAgICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcqTm8gT0NSIGNvbnRlbnQgYXZhaWxhYmxlKicpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBmYWxsYmFja01hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlIHN0YW5kYXJkaXplZCBmcm9udG1hdHRlclxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBtZXRhZGF0YSAtIFBERiBtZXRhZGF0YVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gRnJvbnRtYXR0ZXIgY29udGVudFxyXG4gICAqL1xyXG4gIGdlbmVyYXRlRnJvbnRtYXR0ZXIobWV0YWRhdGEsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgLy8gR2V0IHRoZSB0aXRsZSBmcm9tIG1ldGFkYXRhIG9yIGZpbGVuYW1lXHJcbiAgICBjb25zdCBmaWxlVGl0bGUgPSBtZXRhZGF0YT8udGl0bGUgfHwgb3B0aW9ucy5uYW1lIHx8ICdQREYgRG9jdW1lbnQnO1xyXG5cclxuICAgIC8vIFVzZSB0aGUgY2VudHJhbGl6ZWQgbWV0YWRhdGEgdXRpbGl0eSBmb3IgY29uc2lzdGVudCBmcm9udG1hdHRlclxyXG4gICAgY29uc3QgeyBjcmVhdGVTdGFuZGFyZEZyb250bWF0dGVyIH0gPSByZXF1aXJlKCcuLi8uLi8uLi8uLi9jb252ZXJ0ZXJzL3V0aWxzL21ldGFkYXRhJyk7XHJcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IGNyZWF0ZVN0YW5kYXJkRnJvbnRtYXR0ZXIoe1xyXG4gICAgICAgIHRpdGxlOiBmaWxlVGl0bGUsXHJcbiAgICAgICAgZmlsZVR5cGU6ICdwZGYnXHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4gZnJvbnRtYXR0ZXI7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZW5lcmF0ZSBjb21wbGV0ZSBkb2N1bWVudCB3aXRoIGZyb250bWF0dGVyIGFuZCBjb250ZW50XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gUERGIG1ldGFkYXRhXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9jclJlc3VsdCAtIE9DUiByZXN1bHRcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IENvbXBsZXRlIG1hcmtkb3duIGRvY3VtZW50XHJcbiAgICovXHJcbiAgZ2VuZXJhdGVDb21wbGV0ZURvY3VtZW50KG1ldGFkYXRhLCBvY3JSZXN1bHQsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSB0aGlzLmdlbmVyYXRlRnJvbnRtYXR0ZXIobWV0YWRhdGEsIG9wdGlvbnMpO1xyXG4gICAgY29uc3QgY29udGVudCA9IHRoaXMuZ2VuZXJhdGVNYXJrZG93bihtZXRhZGF0YSwgb2NyUmVzdWx0LCBvcHRpb25zKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIGZyb250bWF0dGVyICsgY29udGVudDtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTWFya2Rvd25HZW5lcmF0b3I7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxpQkFBaUIsQ0FBQztFQUN0QkMsV0FBV0EsQ0FBQSxFQUFHO0lBQ1o7RUFBQTs7RUFHRjtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNFQyxnQkFBZ0JBLENBQUNDLFFBQVEsRUFBRUMsU0FBUyxFQUFFQyxPQUFPLEdB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