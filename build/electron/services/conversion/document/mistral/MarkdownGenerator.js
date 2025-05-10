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

    // Add title
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
      ocrResult.pages.forEach((page, index) => {
        // Use page number if available, otherwise use index + 1
        const pageNumber = page.pageNumber || index + 1;
        markdown.push(`## Page ${pageNumber}`);
        markdown.push('');

        // Add page confidence if available
        if (page.confidence) {
          const confidencePercent = Math.round(page.confidence * 100);
          markdown.push(`> OCR Confidence: ${confidencePercent}%`);
          markdown.push('');
        }

        // Add page dimensions if available
        if (page.width && page.height) {
          markdown.push(`> Dimensions: ${page.width} × ${page.height}`);
          markdown.push('');
        }

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
        if (pageContent && pageContent.trim()) {
          markdown.push(pageContent);
        } else {
          markdown.push('*No text content was extracted from this page.*');
        }
        markdown.push('');
      });
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
    // Get current datetime
    const now = new Date();
    const convertedDate = now.toISOString().split('.')[0].replace('T', ' ');

    // Get the title from metadata or filename
    const fileTitle = metadata?.title || options.name || 'PDF Document';

    // Create standardized frontmatter
    return ['---', `title: ${fileTitle}`, `converted: ${convertedDate}`, 'type: pdf-ocr', '---', ''].join('\n');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJNYXJrZG93bkdlbmVyYXRvciIsImNvbnN0cnVjdG9yIiwiZ2VuZXJhdGVNYXJrZG93biIsIm1ldGFkYXRhIiwib2NyUmVzdWx0Iiwib3B0aW9ucyIsImNvbnNvbGUiLCJsb2ciLCJtYXJrZG93biIsImdlbmVyYXRlSGVhZGVyIiwiYWRkT2NySW5mb3JtYXRpb24iLCJhZGRQYWdlQ29udGVudCIsImpvaW4iLCJlcnJvciIsImdlbmVyYXRlRmFsbGJhY2tNYXJrZG93biIsInRpdGxlIiwicHVzaCIsImF1dGhvciIsInN1YmplY3QiLCJrZXl3b3JkcyIsImNyZWF0b3IiLCJwcm9kdWNlciIsImNyZWF0aW9uRGF0ZSIsIm1vZGlmaWNhdGlvbkRhdGUiLCJwYWdlQ291bnQiLCJkb2N1bWVudEluZm8iLCJkb2NJbmZvIiwibW9kZWwiLCJsYW5ndWFnZSIsInByb2Nlc3NpbmdUaW1lIiwib3ZlcmFsbENvbmZpZGVuY2UiLCJjb25maWRlbmNlUGVyY2VudCIsIk1hdGgiLCJyb3VuZCIsInVzYWdlIiwidG90YWxfdG9rZW5zIiwicHJvbXB0X3Rva2VucyIsImNvbXBsZXRpb25fdG9rZW5zIiwicGFnZXMiLCJsZW5ndGgiLCJmb3JFYWNoIiwicGFnZSIsImluZGV4IiwicGFnZU51bWJlciIsImNvbmZpZGVuY2UiLCJ3aWR0aCIsImhlaWdodCIsInBhZ2VDb250ZW50IiwidGV4dCIsInRyaW0iLCJjb250ZW50IiwiYmxvY2tzIiwiQXJyYXkiLCJpc0FycmF5IiwidGV4dEJsb2NrcyIsIl9wcm9jZXNzQmxvY2tzIiwiZWxlbWVudHMiLCJtYXAiLCJlbGVtZW50IiwidHlwZSIsImZpbHRlciIsImJsb2NrIiwiZmFsbGJhY2tNYXJrZG93biIsIm1lc3NhZ2UiLCJnZW5lcmF0ZUZyb250bWF0dGVyIiwibm93IiwiRGF0ZSIsImNvbnZlcnRlZERhdGUiLCJ0b0lTT1N0cmluZyIsInNwbGl0IiwicmVwbGFjZSIsImZpbGVUaXRsZSIsIm5hbWUiLCJnZW5lcmF0ZUNvbXBsZXRlRG9jdW1lbnQiLCJmcm9udG1hdHRlciIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9taXN0cmFsL01hcmtkb3duR2VuZXJhdG9yLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBNYXJrZG93bkdlbmVyYXRvci5qc1xyXG4gKiBHZW5lcmF0ZXMgbWFya2Rvd24gY29udGVudCBmcm9tIFBERiBtZXRhZGF0YSBhbmQgT0NSIHJlc3VsdHNcclxuICovXHJcblxyXG5jbGFzcyBNYXJrZG93bkdlbmVyYXRvciB7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICAvLyBJbml0aWFsaXplIGdlbmVyYXRvclxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2VuZXJhdGUgbWFya2Rvd24gZnJvbSBQREYgbWV0YWRhdGEgYW5kIE9DUiByZXN1bHRcclxuICAgKiBAcGFyYW0ge09iamVjdH0gbWV0YWRhdGEgLSBQREYgbWV0YWRhdGFcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb2NyUmVzdWx0IC0gT0NSIHJlc3VsdFxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gTWFya2Rvd24gY29udGVudFxyXG4gICAqL1xyXG4gIGdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIG9jclJlc3VsdCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICBjb25zb2xlLmxvZygnW01hcmtkb3duR2VuZXJhdG9yXSBHZW5lcmF0aW5nIG1hcmtkb3duIGZyb20gT0NSIHJlc3VsdCcpO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBTdGFydCB3aXRoIGhlYWRlciBhbmQgbWV0YWRhdGEgc2VjdGlvblxyXG4gICAgICBjb25zdCBtYXJrZG93biA9IHRoaXMuZ2VuZXJhdGVIZWFkZXIobWV0YWRhdGEsIG9wdGlvbnMpO1xyXG4gICAgICBcclxuICAgICAgLy8gQWRkIE9DUiBpbmZvcm1hdGlvbiBzZWN0aW9uXHJcbiAgICAgIHRoaXMuYWRkT2NySW5mb3JtYXRpb24obWFya2Rvd24sIG9jclJlc3VsdCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBBZGQgY29udGVudCBmb3IgZWFjaCBwYWdlXHJcbiAgICAgIHRoaXMuYWRkUGFnZUNvbnRlbnQobWFya2Rvd24sIG9jclJlc3VsdCk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZygnW01hcmtkb3duR2VuZXJhdG9yXSBNYXJrZG93biBnZW5lcmF0aW9uIGNvbXBsZXRlJyk7XHJcbiAgICAgIHJldHVybiBtYXJrZG93bi5qb2luKCdcXG4nKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNYXJrZG93bkdlbmVyYXRvcl0gRXJyb3IgZ2VuZXJhdGluZyBtYXJrZG93bjonLCBlcnJvcik7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgYSBmYWxsYmFjayBtYXJrZG93biB3aXRoIGVycm9yIGluZm9ybWF0aW9uXHJcbiAgICAgIHJldHVybiB0aGlzLmdlbmVyYXRlRmFsbGJhY2tNYXJrZG93bihtZXRhZGF0YSwgb2NyUmVzdWx0LCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZW5lcmF0ZSBtYXJrZG93biBoZWFkZXIgd2l0aCBtZXRhZGF0YVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBtZXRhZGF0YSAtIFBERiBtZXRhZGF0YVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge0FycmF5fSBBcnJheSBvZiBtYXJrZG93biBsaW5lc1xyXG4gICAqL1xyXG4gIGdlbmVyYXRlSGVhZGVyKG1ldGFkYXRhLCBvcHRpb25zID0ge30pIHtcclxuICAgIC8vIFN0YXJ0IHdpdGggdGl0bGUgZnJvbSBvcHRpb25zLCBtZXRhZGF0YSwgb3IgZGVmYXVsdFxyXG4gICAgY29uc3QgdGl0bGUgPSBvcHRpb25zLnRpdGxlIHx8IG1ldGFkYXRhPy50aXRsZSB8fCAnUERGIERvY3VtZW50JztcclxuICAgIFxyXG4gICAgY29uc3QgbWFya2Rvd24gPSBbXTtcclxuICAgIFxyXG4gICAgLy8gQWRkIHRpdGxlXHJcbiAgICBtYXJrZG93bi5wdXNoKGAjICR7dGl0bGV9YCk7XHJcbiAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgIFxyXG4gICAgLy8gQWRkIG1ldGFkYXRhIHNlY3Rpb24gaWYgYXZhaWxhYmxlXHJcbiAgICBpZiAobWV0YWRhdGEpIHtcclxuICAgICAgbWFya2Rvd24ucHVzaCgnIyMgRG9jdW1lbnQgSW5mb3JtYXRpb24nKTtcclxuICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgIG1hcmtkb3duLnB1c2goJ3wgUHJvcGVydHkgfCBWYWx1ZSB8Jyk7XHJcbiAgICAgIG1hcmtkb3duLnB1c2goJ3wgLS0tIHwgLS0tIHwnKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS50aXRsZSkge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgVGl0bGUgfCAke21ldGFkYXRhLnRpdGxlfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5hdXRob3IpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IEF1dGhvciB8ICR7bWV0YWRhdGEuYXV0aG9yfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5zdWJqZWN0KSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBTdWJqZWN0IHwgJHttZXRhZGF0YS5zdWJqZWN0fSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5rZXl3b3Jkcykge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgS2V5d29yZHMgfCAke21ldGFkYXRhLmtleXdvcmRzfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5jcmVhdG9yKSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBDcmVhdG9yIHwgJHttZXRhZGF0YS5jcmVhdG9yfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5wcm9kdWNlcikge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgUHJvZHVjZXIgfCAke21ldGFkYXRhLnByb2R1Y2VyfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5jcmVhdGlvbkRhdGUpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IENyZWF0aW9uIERhdGUgfCAke21ldGFkYXRhLmNyZWF0aW9uRGF0ZX0gfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAobWV0YWRhdGEubW9kaWZpY2F0aW9uRGF0ZSkge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgTW9kaWZpY2F0aW9uIERhdGUgfCAke21ldGFkYXRhLm1vZGlmaWNhdGlvbkRhdGV9IHxgKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgaWYgKG1ldGFkYXRhLnBhZ2VDb3VudCkge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgUGFnZSBDb3VudCB8ICR7bWV0YWRhdGEucGFnZUNvdW50fSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gbWFya2Rvd247XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBBZGQgT0NSIGluZm9ybWF0aW9uIHNlY3Rpb25cclxuICAgKiBAcGFyYW0ge0FycmF5fSBtYXJrZG93biAtIE1hcmtkb3duIGxpbmVzIGFycmF5XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9jclJlc3VsdCAtIE9DUiByZXN1bHRcclxuICAgKi9cclxuICBhZGRPY3JJbmZvcm1hdGlvbihtYXJrZG93biwgb2NyUmVzdWx0KSB7XHJcbiAgICAvLyBBZGQgT0NSIHNlY3Rpb24gaGVhZGVyXHJcbiAgICBtYXJrZG93bi5wdXNoKCcjIyBPQ1IgSW5mb3JtYXRpb24nKTtcclxuICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgbWFya2Rvd24ucHVzaCgnVGhpcyBkb2N1bWVudCB3YXMgcHJvY2Vzc2VkIHVzaW5nIE1pc3RyYWwgT0NSIHRlY2hub2xvZ3kuJyk7XHJcbiAgICBcclxuICAgIC8vIEFkZCBPQ1IgbW9kZWwgYW5kIGxhbmd1YWdlIGluZm9ybWF0aW9uIGlmIGF2YWlsYWJsZVxyXG4gICAgaWYgKG9jclJlc3VsdCAmJiBvY3JSZXN1bHQuZG9jdW1lbnRJbmZvKSB7XHJcbiAgICAgIGNvbnN0IGRvY0luZm8gPSBvY3JSZXN1bHQuZG9jdW1lbnRJbmZvO1xyXG4gICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgbWFya2Rvd24ucHVzaCgnfCBQcm9wZXJ0eSB8IFZhbHVlIHwnKTtcclxuICAgICAgbWFya2Rvd24ucHVzaCgnfCAtLS0gfCAtLS0gfCcpO1xyXG4gICAgICBcclxuICAgICAgaWYgKGRvY0luZm8ubW9kZWwgJiYgZG9jSW5mby5tb2RlbCAhPT0gJ3Vua25vd24nKSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBNb2RlbCB8ICR7ZG9jSW5mby5tb2RlbH0gfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAoZG9jSW5mby5sYW5ndWFnZSAmJiBkb2NJbmZvLmxhbmd1YWdlICE9PSAndW5rbm93bicpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IExhbmd1YWdlIHwgJHtkb2NJbmZvLmxhbmd1YWdlfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChkb2NJbmZvLnByb2Nlc3NpbmdUaW1lKSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBQcm9jZXNzaW5nIFRpbWUgfCAke2RvY0luZm8ucHJvY2Vzc2luZ1RpbWV9cyB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChkb2NJbmZvLm92ZXJhbGxDb25maWRlbmNlKSB7XHJcbiAgICAgICAgY29uc3QgY29uZmlkZW5jZVBlcmNlbnQgPSBNYXRoLnJvdW5kKGRvY0luZm8ub3ZlcmFsbENvbmZpZGVuY2UgKiAxMDApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgT3ZlcmFsbCBDb25maWRlbmNlIHwgJHtjb25maWRlbmNlUGVyY2VudH0lIHxgKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gQWRkIHVzYWdlIGluZm9ybWF0aW9uIGlmIGF2YWlsYWJsZVxyXG4gICAgICBpZiAoZG9jSW5mby51c2FnZSkge1xyXG4gICAgICAgIGlmIChkb2NJbmZvLnVzYWdlLnRvdGFsX3Rva2Vucykge1xyXG4gICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBUb3RhbCBUb2tlbnMgfCAke2RvY0luZm8udXNhZ2UudG90YWxfdG9rZW5zfSB8YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChkb2NJbmZvLnVzYWdlLnByb21wdF90b2tlbnMpIHtcclxuICAgICAgICAgIG1hcmtkb3duLnB1c2goYHwgUHJvbXB0IFRva2VucyB8ICR7ZG9jSW5mby51c2FnZS5wcm9tcHRfdG9rZW5zfSB8YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChkb2NJbmZvLnVzYWdlLmNvbXBsZXRpb25fdG9rZW5zKSB7XHJcbiAgICAgICAgICBtYXJrZG93bi5wdXNoKGB8IENvbXBsZXRpb24gVG9rZW5zIHwgJHtkb2NJbmZvLnVzYWdlLmNvbXBsZXRpb25fdG9rZW5zfSB8YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBBZGQgZXJyb3IgaW5mb3JtYXRpb24gaWYgcHJlc2VudFxyXG4gICAgICBpZiAoZG9jSW5mby5lcnJvcikge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRXJyb3IgfCAke2RvY0luZm8uZXJyb3J9IHxgKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEFkZCBjb250ZW50IGZvciBlYWNoIHBhZ2VcclxuICAgKiBAcGFyYW0ge0FycmF5fSBtYXJrZG93biAtIE1hcmtkb3duIGxpbmVzIGFycmF5XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9jclJlc3VsdCAtIE9DUiByZXN1bHRcclxuICAgKi9cclxuICBhZGRQYWdlQ29udGVudChtYXJrZG93biwgb2NyUmVzdWx0KSB7XHJcbiAgICAvLyBBZGQgY29udGVudCBmb3IgZWFjaCBwYWdlXHJcbiAgICBpZiAob2NyUmVzdWx0ICYmIG9jclJlc3VsdC5wYWdlcyAmJiBvY3JSZXN1bHQucGFnZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICBvY3JSZXN1bHQucGFnZXMuZm9yRWFjaCgocGFnZSwgaW5kZXgpID0+IHtcclxuICAgICAgICAvLyBVc2UgcGFnZSBudW1iZXIgaWYgYXZhaWxhYmxlLCBvdGhlcndpc2UgdXNlIGluZGV4ICsgMVxyXG4gICAgICAgIGNvbnN0IHBhZ2VOdW1iZXIgPSBwYWdlLnBhZ2VOdW1iZXIgfHwgaW5kZXggKyAxO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYCMjIFBhZ2UgJHtwYWdlTnVtYmVyfWApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBwYWdlIGNvbmZpZGVuY2UgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgaWYgKHBhZ2UuY29uZmlkZW5jZSkge1xyXG4gICAgICAgICAgY29uc3QgY29uZmlkZW5jZVBlcmNlbnQgPSBNYXRoLnJvdW5kKHBhZ2UuY29uZmlkZW5jZSAqIDEwMCk7XHJcbiAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IE9DUiBDb25maWRlbmNlOiAke2NvbmZpZGVuY2VQZXJjZW50fSVgKTtcclxuICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgcGFnZSBkaW1lbnNpb25zIGlmIGF2YWlsYWJsZVxyXG4gICAgICAgIGlmIChwYWdlLndpZHRoICYmIHBhZ2UuaGVpZ2h0KSB7XHJcbiAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IERpbWVuc2lvbnM6ICR7cGFnZS53aWR0aH0gw5cgJHtwYWdlLmhlaWdodH1gKTtcclxuICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgcGFnZSB0ZXh0IHdpdGggYmV0dGVyIGhhbmRsaW5nIG9mIGRpZmZlcmVudCBjb250ZW50IGZvcm1hdHNcclxuICAgICAgICBsZXQgcGFnZUNvbnRlbnQgPSAnJztcclxuICAgICAgICBcclxuICAgICAgICBpZiAocGFnZS50ZXh0ICYmIHBhZ2UudGV4dC50cmltKCkpIHtcclxuICAgICAgICAgIHBhZ2VDb250ZW50ID0gcGFnZS50ZXh0O1xyXG4gICAgICAgIH0gZWxzZSBpZiAocGFnZS5jb250ZW50ICYmIHR5cGVvZiBwYWdlLmNvbnRlbnQgPT09ICdzdHJpbmcnICYmIHBhZ2UuY29udGVudC50cmltKCkpIHtcclxuICAgICAgICAgIHBhZ2VDb250ZW50ID0gcGFnZS5jb250ZW50O1xyXG4gICAgICAgIH0gZWxzZSBpZiAocGFnZS5ibG9ja3MgJiYgQXJyYXkuaXNBcnJheShwYWdlLmJsb2NrcykgJiYgcGFnZS5ibG9ja3MubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgLy8gSWYgYmxvY2tzIGFyZSBhdmFpbGFibGUsIHByb2Nlc3MgdGhlbSBpbnRvIHRleHRcclxuICAgICAgICAgIGNvbnN0IHRleHRCbG9ja3MgPSB0aGlzLl9wcm9jZXNzQmxvY2tzKHBhZ2UuYmxvY2tzKTtcclxuICAgICAgICAgIHBhZ2VDb250ZW50ID0gdGV4dEJsb2Nrcy5qb2luKCdcXG5cXG4nKTtcclxuICAgICAgICB9IGVsc2UgaWYgKHBhZ2UuZWxlbWVudHMgJiYgQXJyYXkuaXNBcnJheShwYWdlLmVsZW1lbnRzKSAmJiBwYWdlLmVsZW1lbnRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgIC8vIElmIGVsZW1lbnRzIGFyZSBhdmFpbGFibGUsIHByb2Nlc3MgdGhlbSBpbnRvIHRleHRcclxuICAgICAgICAgIGNvbnN0IGVsZW1lbnRzID0gcGFnZS5lbGVtZW50cy5tYXAoZWxlbWVudCA9PiB7XHJcbiAgICAgICAgICAgIGlmIChlbGVtZW50LnR5cGUgPT09ICd0ZXh0JyAmJiBlbGVtZW50LnRleHQpIHtcclxuICAgICAgICAgICAgICByZXR1cm4gZWxlbWVudC50ZXh0O1xyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKGVsZW1lbnQuY29udGVudCkge1xyXG4gICAgICAgICAgICAgIHJldHVybiBlbGVtZW50LmNvbnRlbnQ7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuICcnO1xyXG4gICAgICAgICAgfSkuZmlsdGVyKHRleHQgPT4gdGV4dC50cmltKCkubGVuZ3RoID4gMCk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIHBhZ2VDb250ZW50ID0gZWxlbWVudHMuam9pbignXFxuXFxuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChwYWdlQ29udGVudCAmJiBwYWdlQ29udGVudC50cmltKCkpIHtcclxuICAgICAgICAgIG1hcmtkb3duLnB1c2gocGFnZUNvbnRlbnQpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBtYXJrZG93bi5wdXNoKCcqTm8gdGV4dCBjb250ZW50IHdhcyBleHRyYWN0ZWQgZnJvbSB0aGlzIHBhZ2UuKicpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgfSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBtYXJrZG93bi5wdXNoKCdObyB0ZXh0IGNvbnRlbnQgd2FzIGV4dHJhY3RlZCBmcm9tIHRoaXMgZG9jdW1lbnQuJyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBJZiB3ZSBoYXZlIGEgcmF3IHRleHQgZmllbGQgYXQgdGhlIGRvY3VtZW50IGxldmVsLCB1c2UgdGhhdFxyXG4gICAgICBpZiAob2NyUmVzdWx0ICYmIG9jclJlc3VsdC50ZXh0ICYmIHR5cGVvZiBvY3JSZXN1bHQudGV4dCA9PT0gJ3N0cmluZycgJiYgb2NyUmVzdWx0LnRleHQudHJpbSgpKSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgRG9jdW1lbnQgQ29udGVudCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2gob2NyUmVzdWx0LnRleHQpO1xyXG4gICAgICB9IGVsc2UgaWYgKG9jclJlc3VsdCAmJiBvY3JSZXN1bHQuY29udGVudCAmJiB0eXBlb2Ygb2NyUmVzdWx0LmNvbnRlbnQgPT09ICdzdHJpbmcnICYmIG9jclJlc3VsdC5jb250ZW50LnRyaW0oKSkge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIERvY3VtZW50IENvbnRlbnQnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKG9jclJlc3VsdC5jb250ZW50KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUHJvY2VzcyBibG9ja3MgaW50byB0ZXh0IChzaW1wbGUgcGxhY2Vob2xkZXIgLSBhY3R1YWwgaW1wbGVtZW50YXRpb24gaW4gT2NyUHJvY2Vzc29yKVxyXG4gICAqIEBwYXJhbSB7QXJyYXl9IGJsb2NrcyAtIENvbnRlbnQgYmxvY2tzXHJcbiAgICogQHJldHVybnMge0FycmF5fSBBcnJheSBvZiB0ZXh0IGJsb2Nrc1xyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgX3Byb2Nlc3NCbG9ja3MoYmxvY2tzKSB7XHJcbiAgICAvLyBUaGlzIGlzIGp1c3QgYSBwbGFjZWhvbGRlciAtIGFjdHVhbCBpbXBsZW1lbnRhdGlvbiBzaG91bGQgYmUgaW4gT2NyUHJvY2Vzc29yXHJcbiAgICAvLyBUaGlzIHNpbXBseSByZXR1cm5zIGFueSB0ZXh0IGNvbnRlbnQgZnJvbSBibG9ja3NcclxuICAgIHJldHVybiBibG9ja3NcclxuICAgICAgLm1hcChibG9jayA9PiBibG9jay50ZXh0IHx8IGJsb2NrLmNvbnRlbnQgfHwgJycpXHJcbiAgICAgIC5maWx0ZXIodGV4dCA9PiB0ZXh0LnRyaW0oKS5sZW5ndGggPiAwKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdlbmVyYXRlIGZhbGxiYWNrIG1hcmtkb3duIHdoZW4gYW4gZXJyb3Igb2NjdXJzXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gUERGIG1ldGFkYXRhXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9jclJlc3VsdCAtIE9DUiByZXN1bHRcclxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIHRoYXQgb2NjdXJyZWRcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGYWxsYmFjayBtYXJrZG93biBjb250ZW50XHJcbiAgICovXHJcbiAgZ2VuZXJhdGVGYWxsYmFja01hcmtkb3duKG1ldGFkYXRhLCBvY3JSZXN1bHQsIGVycm9yKSB7XHJcbiAgICBjb25zdCBmYWxsYmFja01hcmtkb3duID0gW1xyXG4gICAgICAnIyBPQ1IgQ29udmVyc2lvbiBSZXN1bHQnLFxyXG4gICAgICAnJyxcclxuICAgICAgJyMjIEVycm9yIEluZm9ybWF0aW9uJyxcclxuICAgICAgJycsXHJcbiAgICAgIGBBbiBlcnJvciBvY2N1cnJlZCBkdXJpbmcgbWFya2Rvd24gZ2VuZXJhdGlvbjogJHtlcnJvci5tZXNzYWdlfWAsXHJcbiAgICAgICcnLFxyXG4gICAgICAnIyMgRG9jdW1lbnQgSW5mb3JtYXRpb24nLFxyXG4gICAgICAnJ1xyXG4gICAgXTtcclxuICAgIFxyXG4gICAgLy8gQWRkIGFueSBtZXRhZGF0YSB3ZSBoYXZlXHJcbiAgICBpZiAobWV0YWRhdGEpIHtcclxuICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcjIyMgTWV0YWRhdGEnKTtcclxuICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS50aXRsZSkge1xyXG4gICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgKipUaXRsZToqKiAke21ldGFkYXRhLnRpdGxlfWApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChtZXRhZGF0YS5hdXRob3IpIHtcclxuICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCoqQXV0aG9yOioqICR7bWV0YWRhdGEuYXV0aG9yfWApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChtZXRhZGF0YS5zdWJqZWN0KSB7XHJcbiAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKGAqKlN1YmplY3Q6KiogJHttZXRhZGF0YS5zdWJqZWN0fWApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChtZXRhZGF0YS5rZXl3b3Jkcykge1xyXG4gICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgKipLZXl3b3JkczoqKiAke21ldGFkYXRhLmtleXdvcmRzfWApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChtZXRhZGF0YS5jcmVhdG9yKSB7XHJcbiAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKGAqKkNyZWF0b3I6KiogJHttZXRhZGF0YS5jcmVhdG9yfWApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChtZXRhZGF0YS5wcm9kdWNlcikge1xyXG4gICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgKipQcm9kdWNlcjoqKiAke21ldGFkYXRhLnByb2R1Y2VyfWApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChtZXRhZGF0YS5jcmVhdGlvbkRhdGUpIHtcclxuICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCoqQ3JlYXRpb24gRGF0ZToqKiAke21ldGFkYXRhLmNyZWF0aW9uRGF0ZX1gKTtcclxuICAgICAgfVxyXG4gICAgICBpZiAobWV0YWRhdGEubW9kaWZpY2F0aW9uRGF0ZSkge1xyXG4gICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgKipNb2RpZmljYXRpb24gRGF0ZToqKiAke21ldGFkYXRhLm1vZGlmaWNhdGlvbkRhdGV9YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIEFkZCBhbnkgcmF3IE9DUiByZXN1bHQgdGV4dCBpZiBhdmFpbGFibGVcclxuICAgIGlmIChvY3JSZXN1bHQpIHtcclxuICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcjIyMgT0NSIFJlc3VsdCcpO1xyXG4gICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICBcclxuICAgICAgaWYgKG9jclJlc3VsdC50ZXh0KSB7XHJcbiAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKG9jclJlc3VsdC50ZXh0KTtcclxuICAgICAgfSBlbHNlIGlmIChvY3JSZXN1bHQuY29udGVudCkge1xyXG4gICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChvY3JSZXN1bHQuY29udGVudCk7XHJcbiAgICAgIH0gZWxzZSBpZiAob2NyUmVzdWx0LnBhZ2VzICYmIG9jclJlc3VsdC5wYWdlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgb2NyUmVzdWx0LnBhZ2VzLmZvckVhY2goKHBhZ2UsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCMjIyMgUGFnZSAke2luZGV4ICsgMX1gKTtcclxuICAgICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2gocGFnZS50ZXh0IHx8IHBhZ2UuY29udGVudCB8fCAnKk5vIGNvbnRlbnQgYXZhaWxhYmxlKicpO1xyXG4gICAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICB9KTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goJypObyBPQ1IgY29udGVudCBhdmFpbGFibGUqJyk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGZhbGxiYWNrTWFya2Rvd24uam9pbignXFxuJyk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGUgc3RhbmRhcmRpemVkIGZyb250bWF0dGVyXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gUERGIG1ldGFkYXRhXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGcm9udG1hdHRlciBjb250ZW50XHJcbiAgICovXHJcbiAgZ2VuZXJhdGVGcm9udG1hdHRlcihtZXRhZGF0YSwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICAvLyBHZXQgY3VycmVudCBkYXRldGltZVxyXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgIGNvbnN0IGNvbnZlcnRlZERhdGUgPSBub3cudG9JU09TdHJpbmcoKS5zcGxpdCgnLicpWzBdLnJlcGxhY2UoJ1QnLCAnICcpO1xyXG4gICAgXHJcbiAgICAvLyBHZXQgdGhlIHRpdGxlIGZyb20gbWV0YWRhdGEgb3IgZmlsZW5hbWVcclxuICAgIGNvbnN0IGZpbGVUaXRsZSA9IG1ldGFkYXRhPy50aXRsZSB8fCBvcHRpb25zLm5hbWUgfHwgJ1BERiBEb2N1bWVudCc7XHJcbiAgICBcclxuICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgZnJvbnRtYXR0ZXJcclxuICAgIHJldHVybiBbXHJcbiAgICAgICctLS0nLFxyXG4gICAgICBgdGl0bGU6ICR7ZmlsZVRpdGxlfWAsXHJcbiAgICAgIGBjb252ZXJ0ZWQ6ICR7Y29udmVydGVkRGF0ZX1gLFxyXG4gICAgICAndHlwZTogcGRmLW9jcicsXHJcbiAgICAgICctLS0nLFxyXG4gICAgICAnJ1xyXG4gICAgXS5qb2luKCdcXG4nKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdlbmVyYXRlIGNvbXBsZXRlIGRvY3VtZW50IHdpdGggZnJvbnRtYXR0ZXIgYW5kIGNvbnRlbnRcclxuICAgKiBAcGFyYW0ge09iamVjdH0gbWV0YWRhdGEgLSBQREYgbWV0YWRhdGFcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb2NyUmVzdWx0IC0gT0NSIHJlc3VsdFxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gQ29tcGxldGUgbWFya2Rvd24gZG9jdW1lbnRcclxuICAgKi9cclxuICBnZW5lcmF0ZUNvbXBsZXRlRG9jdW1lbnQobWV0YWRhdGEsIG9jclJlc3VsdCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuZ2VuZXJhdGVGcm9udG1hdHRlcihtZXRhZGF0YSwgb3B0aW9ucyk7XHJcbiAgICBjb25zdCBjb250ZW50ID0gdGhpcy5nZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCBvY3JSZXN1bHQsIG9wdGlvbnMpO1xyXG4gICAgXHJcbiAgICByZXR1cm4gZnJvbnRtYXR0ZXIgKyBjb250ZW50O1xyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBNYXJrZG93bkdlbmVyYXRvcjsiXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsaUJBQWlCLENBQUM7RUFDdEJDLFdBQVdBLENBQUEsRUFBRztJQUNa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