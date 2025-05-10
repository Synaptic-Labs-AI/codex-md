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
    // Get current datetime
    const now = new Date();
    const convertedDate = now.toISOString();

    // Get the title from metadata or filename
    const fileTitle = metadata?.title || options.name || 'PDF Document';

    // Extract filename without path
    const filename = options.name || options.originalFileName || '';

    // Get filesize if available
    const fileSize = options.fileSize || metadata.fileSize || '';

    // Create more comprehensive frontmatter
    const frontmatter = ['---', `title: ${fileTitle}`, `converted: ${convertedDate}`, 'type: pdf', 'fileType: pdf'];

    // Add filename if available
    if (filename) {
      frontmatter.push(`filename: ${filename}`);
    }

    // Add page count if available
    if (metadata.pageCount) {
      frontmatter.push(`pageCount: ${metadata.pageCount}`);
    }

    // Add filesize if available
    if (fileSize) {
      frontmatter.push(`fileSize: ${fileSize}`);
    }

    // Add PDF specific metadata if available
    if (metadata.PDFFormatVersion) {
      frontmatter.push(`PDFFormatVersion: ${metadata.PDFFormatVersion}`);
    }
    if (metadata.IsAcroFormPresent !== undefined) {
      frontmatter.push(`IsAcroFormPresent: ${metadata.IsAcroFormPresent}`);
    }
    if (metadata.IsXFAPresent !== undefined) {
      frontmatter.push(`IsXFAPresent: ${metadata.IsXFAPresent}`);
    }

    // Add creator if available
    if (metadata.creator) {
      frontmatter.push(`creator: ${metadata.creator}`);
    }

    // Specify converter type
    frontmatter.push('converter: mistral-ocr');

    // Add original filename if available
    if (options.originalFileName) {
      frontmatter.push(`originalFileName: ${options.originalFileName}`);
    }

    // Close frontmatter
    frontmatter.push('---', '');
    return frontmatter.join('\n');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJNYXJrZG93bkdlbmVyYXRvciIsImNvbnN0cnVjdG9yIiwiZ2VuZXJhdGVNYXJrZG93biIsIm1ldGFkYXRhIiwib2NyUmVzdWx0Iiwib3B0aW9ucyIsImNvbnNvbGUiLCJsb2ciLCJtYXJrZG93biIsImdlbmVyYXRlSGVhZGVyIiwiYWRkT2NySW5mb3JtYXRpb24iLCJhZGRQYWdlQ29udGVudCIsImpvaW4iLCJlcnJvciIsImdlbmVyYXRlRmFsbGJhY2tNYXJrZG93biIsInRpdGxlIiwicHVzaCIsImF1dGhvciIsInN1YmplY3QiLCJrZXl3b3JkcyIsImNyZWF0b3IiLCJwcm9kdWNlciIsImNyZWF0aW9uRGF0ZSIsIm1vZGlmaWNhdGlvbkRhdGUiLCJwYWdlQ291bnQiLCJkb2N1bWVudEluZm8iLCJkb2NJbmZvIiwibW9kZWwiLCJsYW5ndWFnZSIsInByb2Nlc3NpbmdUaW1lIiwib3ZlcmFsbENvbmZpZGVuY2UiLCJjb25maWRlbmNlUGVyY2VudCIsIk1hdGgiLCJyb3VuZCIsInVzYWdlIiwidG90YWxfdG9rZW5zIiwicHJvbXB0X3Rva2VucyIsImNvbXBsZXRpb25fdG9rZW5zIiwicGFnZXMiLCJsZW5ndGgiLCJhbGxQYWdlQ29udGVudHMiLCJtYXAiLCJwYWdlIiwiaW5kZXgiLCJwYWdlTnVtYmVyIiwicGFnZU1hcmtkb3duIiwicGFnZUNvbnRlbnQiLCJ0ZXh0IiwidHJpbSIsImNvbnRlbnQiLCJibG9ja3MiLCJBcnJheSIsImlzQXJyYXkiLCJ0ZXh0QmxvY2tzIiwiX3Byb2Nlc3NCbG9ja3MiLCJlbGVtZW50cyIsImVsZW1lbnQiLCJ0eXBlIiwiZmlsdGVyIiwibnVtYmVyIiwiaXNFbXB0eSIsIm5vbkVtcHR5UGFnZXMiLCJmb3JFYWNoIiwiYmxvY2siLCJmYWxsYmFja01hcmtkb3duIiwibWVzc2FnZSIsImdlbmVyYXRlRnJvbnRtYXR0ZXIiLCJub3ciLCJEYXRlIiwiY29udmVydGVkRGF0ZSIsInRvSVNPU3RyaW5nIiwiZmlsZVRpdGxlIiwibmFtZSIsImZpbGVuYW1lIiwib3JpZ2luYWxGaWxlTmFtZSIsImZpbGVTaXplIiwiZnJvbnRtYXR0ZXIiLCJQREZGb3JtYXRWZXJzaW9uIiwiSXNBY3JvRm9ybVByZXNlbnQiLCJ1bmRlZmluZWQiLCJJc1hGQVByZXNlbnQiLCJnZW5lcmF0ZUNvbXBsZXRlRG9jdW1lbnQiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vZG9jdW1lbnQvbWlzdHJhbC9NYXJrZG93bkdlbmVyYXRvci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogTWFya2Rvd25HZW5lcmF0b3IuanNcclxuICogR2VuZXJhdGVzIG1hcmtkb3duIGNvbnRlbnQgZnJvbSBQREYgbWV0YWRhdGEgYW5kIE9DUiByZXN1bHRzXHJcbiAqL1xyXG5cclxuY2xhc3MgTWFya2Rvd25HZW5lcmF0b3Ige1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgLy8gSW5pdGlhbGl6ZSBnZW5lcmF0b3JcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdlbmVyYXRlIG1hcmtkb3duIGZyb20gUERGIG1ldGFkYXRhIGFuZCBPQ1IgcmVzdWx0XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gUERGIG1ldGFkYXRhXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9jclJlc3VsdCAtIE9DUiByZXN1bHRcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IE1hcmtkb3duIGNvbnRlbnRcclxuICAgKi9cclxuICBnZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCBvY3JSZXN1bHQsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgY29uc29sZS5sb2coJ1tNYXJrZG93bkdlbmVyYXRvcl0gR2VuZXJhdGluZyBtYXJrZG93biBmcm9tIE9DUiByZXN1bHQnKTtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gU3RhcnQgd2l0aCBoZWFkZXIgYW5kIG1ldGFkYXRhIHNlY3Rpb25cclxuICAgICAgY29uc3QgbWFya2Rvd24gPSB0aGlzLmdlbmVyYXRlSGVhZGVyKG1ldGFkYXRhLCBvcHRpb25zKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEFkZCBPQ1IgaW5mb3JtYXRpb24gc2VjdGlvblxyXG4gICAgICB0aGlzLmFkZE9jckluZm9ybWF0aW9uKG1hcmtkb3duLCBvY3JSZXN1bHQpO1xyXG4gICAgICBcclxuICAgICAgLy8gQWRkIGNvbnRlbnQgZm9yIGVhY2ggcGFnZVxyXG4gICAgICB0aGlzLmFkZFBhZ2VDb250ZW50KG1hcmtkb3duLCBvY3JSZXN1bHQpO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coJ1tNYXJrZG93bkdlbmVyYXRvcl0gTWFya2Rvd24gZ2VuZXJhdGlvbiBjb21wbGV0ZScpO1xyXG4gICAgICByZXR1cm4gbWFya2Rvd24uam9pbignXFxuJyk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdbTWFya2Rvd25HZW5lcmF0b3JdIEVycm9yIGdlbmVyYXRpbmcgbWFya2Rvd246JywgZXJyb3IpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ3JlYXRlIGEgZmFsbGJhY2sgbWFya2Rvd24gd2l0aCBlcnJvciBpbmZvcm1hdGlvblxyXG4gICAgICByZXR1cm4gdGhpcy5nZW5lcmF0ZUZhbGxiYWNrTWFya2Rvd24obWV0YWRhdGEsIG9jclJlc3VsdCwgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2VuZXJhdGUgbWFya2Rvd24gaGVhZGVyIHdpdGggbWV0YWRhdGFcclxuICAgKiBAcGFyYW0ge09iamVjdH0gbWV0YWRhdGEgLSBQREYgbWV0YWRhdGFcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAqIEByZXR1cm5zIHtBcnJheX0gQXJyYXkgb2YgbWFya2Rvd24gbGluZXNcclxuICAgKi9cclxuICBnZW5lcmF0ZUhlYWRlcihtZXRhZGF0YSwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICAvLyBTdGFydCB3aXRoIHRpdGxlIGZyb20gb3B0aW9ucywgbWV0YWRhdGEsIG9yIGRlZmF1bHRcclxuICAgIGNvbnN0IHRpdGxlID0gb3B0aW9ucy50aXRsZSB8fCBtZXRhZGF0YT8udGl0bGUgfHwgJ1BERiBEb2N1bWVudCc7XHJcbiAgICBcclxuICAgIGNvbnN0IG1hcmtkb3duID0gW107XHJcbiAgICBcclxuICAgIC8vIEFkZCB0aXRsZVxyXG4gICAgbWFya2Rvd24ucHVzaChgIyAke3RpdGxlfWApO1xyXG4gICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICBcclxuICAgIC8vIEFkZCBtZXRhZGF0YSBzZWN0aW9uIGlmIGF2YWlsYWJsZVxyXG4gICAgaWYgKG1ldGFkYXRhKSB7XHJcbiAgICAgIG1hcmtkb3duLnB1c2goJyMjIERvY3VtZW50IEluZm9ybWF0aW9uJyk7XHJcbiAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICBtYXJrZG93bi5wdXNoKCd8IFByb3BlcnR5IHwgVmFsdWUgfCcpO1xyXG4gICAgICBtYXJrZG93bi5wdXNoKCd8IC0tLSB8IC0tLSB8Jyk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAobWV0YWRhdGEudGl0bGUpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFRpdGxlIHwgJHttZXRhZGF0YS50aXRsZX0gfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAobWV0YWRhdGEuYXV0aG9yKSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBBdXRob3IgfCAke21ldGFkYXRhLmF1dGhvcn0gfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAobWV0YWRhdGEuc3ViamVjdCkge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgU3ViamVjdCB8ICR7bWV0YWRhdGEuc3ViamVjdH0gfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAobWV0YWRhdGEua2V5d29yZHMpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IEtleXdvcmRzIHwgJHttZXRhZGF0YS5rZXl3b3Jkc30gfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAobWV0YWRhdGEuY3JlYXRvcikge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgQ3JlYXRvciB8ICR7bWV0YWRhdGEuY3JlYXRvcn0gfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAobWV0YWRhdGEucHJvZHVjZXIpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFByb2R1Y2VyIHwgJHttZXRhZGF0YS5wcm9kdWNlcn0gfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAobWV0YWRhdGEuY3JlYXRpb25EYXRlKSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBDcmVhdGlvbiBEYXRlIHwgJHttZXRhZGF0YS5jcmVhdGlvbkRhdGV9IHxgKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgaWYgKG1ldGFkYXRhLm1vZGlmaWNhdGlvbkRhdGUpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IE1vZGlmaWNhdGlvbiBEYXRlIHwgJHttZXRhZGF0YS5tb2RpZmljYXRpb25EYXRlfSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChtZXRhZGF0YS5wYWdlQ291bnQpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFBhZ2UgQ291bnQgfCAke21ldGFkYXRhLnBhZ2VDb3VudH0gfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIG1hcmtkb3duO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQWRkIE9DUiBpbmZvcm1hdGlvbiBzZWN0aW9uXHJcbiAgICogQHBhcmFtIHtBcnJheX0gbWFya2Rvd24gLSBNYXJrZG93biBsaW5lcyBhcnJheVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvY3JSZXN1bHQgLSBPQ1IgcmVzdWx0XHJcbiAgICovXHJcbiAgYWRkT2NySW5mb3JtYXRpb24obWFya2Rvd24sIG9jclJlc3VsdCkge1xyXG4gICAgLy8gQWRkIE9DUiBzZWN0aW9uIGhlYWRlclxyXG4gICAgbWFya2Rvd24ucHVzaCgnIyMgT0NSIEluZm9ybWF0aW9uJyk7XHJcbiAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgIG1hcmtkb3duLnB1c2goJ1RoaXMgZG9jdW1lbnQgd2FzIHByb2Nlc3NlZCB1c2luZyBNaXN0cmFsIE9DUiB0ZWNobm9sb2d5LicpO1xyXG4gICAgXHJcbiAgICAvLyBBZGQgT0NSIG1vZGVsIGFuZCBsYW5ndWFnZSBpbmZvcm1hdGlvbiBpZiBhdmFpbGFibGVcclxuICAgIGlmIChvY3JSZXN1bHQgJiYgb2NyUmVzdWx0LmRvY3VtZW50SW5mbykge1xyXG4gICAgICBjb25zdCBkb2NJbmZvID0gb2NyUmVzdWx0LmRvY3VtZW50SW5mbztcclxuICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgIG1hcmtkb3duLnB1c2goJ3wgUHJvcGVydHkgfCBWYWx1ZSB8Jyk7XHJcbiAgICAgIG1hcmtkb3duLnB1c2goJ3wgLS0tIHwgLS0tIHwnKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChkb2NJbmZvLm1vZGVsICYmIGRvY0luZm8ubW9kZWwgIT09ICd1bmtub3duJykge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgTW9kZWwgfCAke2RvY0luZm8ubW9kZWx9IHxgKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgaWYgKGRvY0luZm8ubGFuZ3VhZ2UgJiYgZG9jSW5mby5sYW5ndWFnZSAhPT0gJ3Vua25vd24nKSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBMYW5ndWFnZSB8ICR7ZG9jSW5mby5sYW5ndWFnZX0gfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAoZG9jSW5mby5wcm9jZXNzaW5nVGltZSkge1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgUHJvY2Vzc2luZyBUaW1lIHwgJHtkb2NJbmZvLnByb2Nlc3NpbmdUaW1lfXMgfGApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAoZG9jSW5mby5vdmVyYWxsQ29uZmlkZW5jZSkge1xyXG4gICAgICAgIGNvbnN0IGNvbmZpZGVuY2VQZXJjZW50ID0gTWF0aC5yb3VuZChkb2NJbmZvLm92ZXJhbGxDb25maWRlbmNlICogMTAwKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IE92ZXJhbGwgQ29uZmlkZW5jZSB8ICR7Y29uZmlkZW5jZVBlcmNlbnR9JSB8YCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIEFkZCB1c2FnZSBpbmZvcm1hdGlvbiBpZiBhdmFpbGFibGVcclxuICAgICAgaWYgKGRvY0luZm8udXNhZ2UpIHtcclxuICAgICAgICBpZiAoZG9jSW5mby51c2FnZS50b3RhbF90b2tlbnMpIHtcclxuICAgICAgICAgIG1hcmtkb3duLnB1c2goYHwgVG90YWwgVG9rZW5zIHwgJHtkb2NJbmZvLnVzYWdlLnRvdGFsX3Rva2Vuc30gfGApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZG9jSW5mby51c2FnZS5wcm9tcHRfdG9rZW5zKSB7XHJcbiAgICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFByb21wdCBUb2tlbnMgfCAke2RvY0luZm8udXNhZ2UucHJvbXB0X3Rva2Vuc30gfGApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZG9jSW5mby51c2FnZS5jb21wbGV0aW9uX3Rva2Vucykge1xyXG4gICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBDb21wbGV0aW9uIFRva2VucyB8ICR7ZG9jSW5mby51c2FnZS5jb21wbGV0aW9uX3Rva2Vuc30gfGApO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gQWRkIGVycm9yIGluZm9ybWF0aW9uIGlmIHByZXNlbnRcclxuICAgICAgaWYgKGRvY0luZm8uZXJyb3IpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IEVycm9yIHwgJHtkb2NJbmZvLmVycm9yfSB8YCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBBZGQgY29udGVudCBmb3IgZWFjaCBwYWdlXHJcbiAgICogQHBhcmFtIHtBcnJheX0gbWFya2Rvd24gLSBNYXJrZG93biBsaW5lcyBhcnJheVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvY3JSZXN1bHQgLSBPQ1IgcmVzdWx0XHJcbiAgICovXHJcbiAgYWRkUGFnZUNvbnRlbnQobWFya2Rvd24sIG9jclJlc3VsdCkge1xyXG4gICAgLy8gQWRkIGNvbnRlbnQgZm9yIGVhY2ggcGFnZVxyXG4gICAgaWYgKG9jclJlc3VsdCAmJiBvY3JSZXN1bHQucGFnZXMgJiYgb2NyUmVzdWx0LnBhZ2VzLmxlbmd0aCA+IDApIHtcclxuICAgICAgLy8gUHJvY2VzcyBlYWNoIHBhZ2UgaW4gc2VxdWVuY2UgYnV0IGRvbid0IGFkZCBwYWdlIGhlYWRlcnMgYXQgdGhpcyBwb2ludFxyXG4gICAgICBjb25zdCBhbGxQYWdlQ29udGVudHMgPSBvY3JSZXN1bHQucGFnZXMubWFwKChwYWdlLCBpbmRleCkgPT4ge1xyXG4gICAgICAgIC8vIFVzZSBwYWdlIG51bWJlciBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSB1c2UgaW5kZXggKyAxXHJcbiAgICAgICAgY29uc3QgcGFnZU51bWJlciA9IHBhZ2UucGFnZU51bWJlciB8fCBpbmRleCArIDE7XHJcbiAgICAgICAgY29uc3QgcGFnZU1hcmtkb3duID0gW107XHJcblxyXG4gICAgICAgIC8vIEFkZCBwYWdlIHRleHQgd2l0aCBiZXR0ZXIgaGFuZGxpbmcgb2YgZGlmZmVyZW50IGNvbnRlbnQgZm9ybWF0c1xyXG4gICAgICAgIGxldCBwYWdlQ29udGVudCA9ICcnO1xyXG5cclxuICAgICAgICBpZiAocGFnZS50ZXh0ICYmIHBhZ2UudGV4dC50cmltKCkpIHtcclxuICAgICAgICAgIHBhZ2VDb250ZW50ID0gcGFnZS50ZXh0O1xyXG4gICAgICAgIH0gZWxzZSBpZiAocGFnZS5jb250ZW50ICYmIHR5cGVvZiBwYWdlLmNvbnRlbnQgPT09ICdzdHJpbmcnICYmIHBhZ2UuY29udGVudC50cmltKCkpIHtcclxuICAgICAgICAgIHBhZ2VDb250ZW50ID0gcGFnZS5jb250ZW50O1xyXG4gICAgICAgIH0gZWxzZSBpZiAocGFnZS5ibG9ja3MgJiYgQXJyYXkuaXNBcnJheShwYWdlLmJsb2NrcykgJiYgcGFnZS5ibG9ja3MubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgLy8gSWYgYmxvY2tzIGFyZSBhdmFpbGFibGUsIHByb2Nlc3MgdGhlbSBpbnRvIHRleHRcclxuICAgICAgICAgIGNvbnN0IHRleHRCbG9ja3MgPSB0aGlzLl9wcm9jZXNzQmxvY2tzKHBhZ2UuYmxvY2tzKTtcclxuICAgICAgICAgIHBhZ2VDb250ZW50ID0gdGV4dEJsb2Nrcy5qb2luKCdcXG5cXG4nKTtcclxuICAgICAgICB9IGVsc2UgaWYgKHBhZ2UuZWxlbWVudHMgJiYgQXJyYXkuaXNBcnJheShwYWdlLmVsZW1lbnRzKSAmJiBwYWdlLmVsZW1lbnRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgIC8vIElmIGVsZW1lbnRzIGFyZSBhdmFpbGFibGUsIHByb2Nlc3MgdGhlbSBpbnRvIHRleHRcclxuICAgICAgICAgIGNvbnN0IGVsZW1lbnRzID0gcGFnZS5lbGVtZW50cy5tYXAoZWxlbWVudCA9PiB7XHJcbiAgICAgICAgICAgIGlmIChlbGVtZW50LnR5cGUgPT09ICd0ZXh0JyAmJiBlbGVtZW50LnRleHQpIHtcclxuICAgICAgICAgICAgICByZXR1cm4gZWxlbWVudC50ZXh0O1xyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKGVsZW1lbnQuY29udGVudCkge1xyXG4gICAgICAgICAgICAgIHJldHVybiBlbGVtZW50LmNvbnRlbnQ7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuICcnO1xyXG4gICAgICAgICAgfSkuZmlsdGVyKHRleHQgPT4gdGV4dC50cmltKCkubGVuZ3RoID4gMCk7XHJcblxyXG4gICAgICAgICAgcGFnZUNvbnRlbnQgPSBlbGVtZW50cy5qb2luKCdcXG5cXG4nKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIEFkZCBjb250ZW50IGlmIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIGluZGljYXRlIG5vIGNvbnRlbnRcclxuICAgICAgICBpZiAocGFnZUNvbnRlbnQgJiYgcGFnZUNvbnRlbnQudHJpbSgpKSB7XHJcbiAgICAgICAgICBwYWdlTWFya2Rvd24ucHVzaChwYWdlQ29udGVudCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIHBhZ2VNYXJrZG93bi5wdXNoKCcqTm8gdGV4dCBjb250ZW50IHdhcyBleHRyYWN0ZWQgZnJvbSB0aGlzIHBhZ2UuKicpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIG51bWJlcjogcGFnZU51bWJlcixcclxuICAgICAgICAgIGNvbnRlbnQ6IHBhZ2VNYXJrZG93bi5qb2luKCdcXG5cXG4nKSxcclxuICAgICAgICAgIGlzRW1wdHk6ICFwYWdlQ29udGVudCB8fCAhcGFnZUNvbnRlbnQudHJpbSgpXHJcbiAgICAgICAgfTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBDb21iaW5lIGFsbCBub24tZW1wdHkgcGFnZSBjb250ZW50cyBmaXJzdFxyXG4gICAgICBjb25zdCBub25FbXB0eVBhZ2VzID0gYWxsUGFnZUNvbnRlbnRzLmZpbHRlcihwYWdlID0+ICFwYWdlLmlzRW1wdHkpO1xyXG5cclxuICAgICAgaWYgKG5vbkVtcHR5UGFnZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIC8vIEFkZCBjb21iaW5lZCBjb250ZW50XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChub25FbXB0eVBhZ2VzLm1hcChwYWdlID0+IHBhZ2UuY29udGVudCkuam9pbignXFxuXFxuJykpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG5cclxuICAgICAgICAvLyBUaGVuIGFkZCB0aGUgcGFnZSBtYXJrZXJzIGF0IHRoZSBib3R0b21cclxuICAgICAgICBub25FbXB0eVBhZ2VzLmZvckVhY2gocGFnZSA9PiB7XHJcbiAgICAgICAgICBtYXJrZG93bi5wdXNoKGAtLS1cXG5bUGFnZSAke3BhZ2UubnVtYmVyfV1gKTtcclxuICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIElmIGFsbCBwYWdlcyB3ZXJlIGVtcHR5LCBzaG93IGEgZ2xvYmFsIG1lc3NhZ2VcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCdObyB0ZXh0IGNvbnRlbnQgd2FzIGV4dHJhY3RlZCBmcm9tIHRoaXMgZG9jdW1lbnQuJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIG1hcmtkb3duLnB1c2goJ05vIHRleHQgY29udGVudCB3YXMgZXh0cmFjdGVkIGZyb20gdGhpcyBkb2N1bWVudC4nKTtcclxuXHJcbiAgICAgIC8vIElmIHdlIGhhdmUgYSByYXcgdGV4dCBmaWVsZCBhdCB0aGUgZG9jdW1lbnQgbGV2ZWwsIHVzZSB0aGF0XHJcbiAgICAgIGlmIChvY3JSZXN1bHQgJiYgb2NyUmVzdWx0LnRleHQgJiYgdHlwZW9mIG9jclJlc3VsdC50ZXh0ID09PSAnc3RyaW5nJyAmJiBvY3JSZXN1bHQudGV4dC50cmltKCkpIHtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBEb2N1bWVudCBDb250ZW50Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChvY3JSZXN1bHQudGV4dCk7XHJcbiAgICAgIH0gZWxzZSBpZiAob2NyUmVzdWx0ICYmIG9jclJlc3VsdC5jb250ZW50ICYmIHR5cGVvZiBvY3JSZXN1bHQuY29udGVudCA9PT0gJ3N0cmluZycgJiYgb2NyUmVzdWx0LmNvbnRlbnQudHJpbSgpKSB7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgRG9jdW1lbnQgQ29udGVudCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2gob2NyUmVzdWx0LmNvbnRlbnQpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQcm9jZXNzIGJsb2NrcyBpbnRvIHRleHQgKHNpbXBsZSBwbGFjZWhvbGRlciAtIGFjdHVhbCBpbXBsZW1lbnRhdGlvbiBpbiBPY3JQcm9jZXNzb3IpXHJcbiAgICogQHBhcmFtIHtBcnJheX0gYmxvY2tzIC0gQ29udGVudCBibG9ja3NcclxuICAgKiBAcmV0dXJucyB7QXJyYXl9IEFycmF5IG9mIHRleHQgYmxvY2tzXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBfcHJvY2Vzc0Jsb2NrcyhibG9ja3MpIHtcclxuICAgIC8vIFRoaXMgaXMganVzdCBhIHBsYWNlaG9sZGVyIC0gYWN0dWFsIGltcGxlbWVudGF0aW9uIHNob3VsZCBiZSBpbiBPY3JQcm9jZXNzb3JcclxuICAgIC8vIFRoaXMgc2ltcGx5IHJldHVybnMgYW55IHRleHQgY29udGVudCBmcm9tIGJsb2Nrc1xyXG4gICAgcmV0dXJuIGJsb2Nrc1xyXG4gICAgICAubWFwKGJsb2NrID0+IGJsb2NrLnRleHQgfHwgYmxvY2suY29udGVudCB8fCAnJylcclxuICAgICAgLmZpbHRlcih0ZXh0ID0+IHRleHQudHJpbSgpLmxlbmd0aCA+IDApO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2VuZXJhdGUgZmFsbGJhY2sgbWFya2Rvd24gd2hlbiBhbiBlcnJvciBvY2N1cnNcclxuICAgKiBAcGFyYW0ge09iamVjdH0gbWV0YWRhdGEgLSBQREYgbWV0YWRhdGFcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb2NyUmVzdWx0IC0gT0NSIHJlc3VsdFxyXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgdGhhdCBvY2N1cnJlZFxyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEZhbGxiYWNrIG1hcmtkb3duIGNvbnRlbnRcclxuICAgKi9cclxuICBnZW5lcmF0ZUZhbGxiYWNrTWFya2Rvd24obWV0YWRhdGEsIG9jclJlc3VsdCwgZXJyb3IpIHtcclxuICAgIGNvbnN0IGZhbGxiYWNrTWFya2Rvd24gPSBbXHJcbiAgICAgICcjIE9DUiBDb252ZXJzaW9uIFJlc3VsdCcsXHJcbiAgICAgICcnLFxyXG4gICAgICAnIyMgRXJyb3IgSW5mb3JtYXRpb24nLFxyXG4gICAgICAnJyxcclxuICAgICAgYEFuIGVycm9yIG9jY3VycmVkIGR1cmluZyBtYXJrZG93biBnZW5lcmF0aW9uOiAke2Vycm9yLm1lc3NhZ2V9YCxcclxuICAgICAgJycsXHJcbiAgICAgICcjIyBEb2N1bWVudCBJbmZvcm1hdGlvbicsXHJcbiAgICAgICcnXHJcbiAgICBdO1xyXG4gICAgXHJcbiAgICAvLyBBZGQgYW55IG1ldGFkYXRhIHdlIGhhdmVcclxuICAgIGlmIChtZXRhZGF0YSkge1xyXG4gICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goJyMjIyBNZXRhZGF0YScpO1xyXG4gICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICBcclxuICAgICAgaWYgKG1ldGFkYXRhLnRpdGxlKSB7XHJcbiAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKGAqKlRpdGxlOioqICR7bWV0YWRhdGEudGl0bGV9YCk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG1ldGFkYXRhLmF1dGhvcikge1xyXG4gICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgKipBdXRob3I6KiogJHttZXRhZGF0YS5hdXRob3J9YCk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG1ldGFkYXRhLnN1YmplY3QpIHtcclxuICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCoqU3ViamVjdDoqKiAke21ldGFkYXRhLnN1YmplY3R9YCk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG1ldGFkYXRhLmtleXdvcmRzKSB7XHJcbiAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKGAqKktleXdvcmRzOioqICR7bWV0YWRhdGEua2V5d29yZHN9YCk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG1ldGFkYXRhLmNyZWF0b3IpIHtcclxuICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCoqQ3JlYXRvcjoqKiAke21ldGFkYXRhLmNyZWF0b3J9YCk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG1ldGFkYXRhLnByb2R1Y2VyKSB7XHJcbiAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKGAqKlByb2R1Y2VyOioqICR7bWV0YWRhdGEucHJvZHVjZXJ9YCk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG1ldGFkYXRhLmNyZWF0aW9uRGF0ZSkge1xyXG4gICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgKipDcmVhdGlvbiBEYXRlOioqICR7bWV0YWRhdGEuY3JlYXRpb25EYXRlfWApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChtZXRhZGF0YS5tb2RpZmljYXRpb25EYXRlKSB7XHJcbiAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKGAqKk1vZGlmaWNhdGlvbiBEYXRlOioqICR7bWV0YWRhdGEubW9kaWZpY2F0aW9uRGF0ZX1gKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gQWRkIGFueSByYXcgT0NSIHJlc3VsdCB0ZXh0IGlmIGF2YWlsYWJsZVxyXG4gICAgaWYgKG9jclJlc3VsdCkge1xyXG4gICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goJyMjIyBPQ1IgUmVzdWx0Jyk7XHJcbiAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAob2NyUmVzdWx0LnRleHQpIHtcclxuICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2gob2NyUmVzdWx0LnRleHQpO1xyXG4gICAgICB9IGVsc2UgaWYgKG9jclJlc3VsdC5jb250ZW50KSB7XHJcbiAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKG9jclJlc3VsdC5jb250ZW50KTtcclxuICAgICAgfSBlbHNlIGlmIChvY3JSZXN1bHQucGFnZXMgJiYgb2NyUmVzdWx0LnBhZ2VzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBvY3JSZXN1bHQucGFnZXMuZm9yRWFjaCgocGFnZSwgaW5kZXgpID0+IHtcclxuICAgICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgIyMjIyBQYWdlICR7aW5kZXggKyAxfWApO1xyXG4gICAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChwYWdlLnRleHQgfHwgcGFnZS5jb250ZW50IHx8ICcqTm8gY29udGVudCBhdmFpbGFibGUqJyk7XHJcbiAgICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaCgnKk5vIE9DUiBjb250ZW50IGF2YWlsYWJsZSonKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gZmFsbGJhY2tNYXJrZG93bi5qb2luKCdcXG4nKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENyZWF0ZSBzdGFuZGFyZGl6ZWQgZnJvbnRtYXR0ZXJcclxuICAgKiBAcGFyYW0ge09iamVjdH0gbWV0YWRhdGEgLSBQREYgbWV0YWRhdGFcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEZyb250bWF0dGVyIGNvbnRlbnRcclxuICAgKi9cclxuICBnZW5lcmF0ZUZyb250bWF0dGVyKG1ldGFkYXRhLCBvcHRpb25zID0ge30pIHtcclxuICAgIC8vIEdldCBjdXJyZW50IGRhdGV0aW1lXHJcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xyXG4gICAgY29uc3QgY29udmVydGVkRGF0ZSA9IG5vdy50b0lTT1N0cmluZygpO1xyXG5cclxuICAgIC8vIEdldCB0aGUgdGl0bGUgZnJvbSBtZXRhZGF0YSBvciBmaWxlbmFtZVxyXG4gICAgY29uc3QgZmlsZVRpdGxlID0gbWV0YWRhdGE/LnRpdGxlIHx8IG9wdGlvbnMubmFtZSB8fCAnUERGIERvY3VtZW50JztcclxuXHJcbiAgICAvLyBFeHRyYWN0IGZpbGVuYW1lIHdpdGhvdXQgcGF0aFxyXG4gICAgY29uc3QgZmlsZW5hbWUgPSBvcHRpb25zLm5hbWUgfHwgb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8ICcnO1xyXG5cclxuICAgIC8vIEdldCBmaWxlc2l6ZSBpZiBhdmFpbGFibGVcclxuICAgIGNvbnN0IGZpbGVTaXplID0gb3B0aW9ucy5maWxlU2l6ZSB8fCBtZXRhZGF0YS5maWxlU2l6ZSB8fCAnJztcclxuXHJcbiAgICAvLyBDcmVhdGUgbW9yZSBjb21wcmVoZW5zaXZlIGZyb250bWF0dGVyXHJcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IFtcclxuICAgICAgJy0tLScsXHJcbiAgICAgIGB0aXRsZTogJHtmaWxlVGl0bGV9YCxcclxuICAgICAgYGNvbnZlcnRlZDogJHtjb252ZXJ0ZWREYXRlfWAsXHJcbiAgICAgICd0eXBlOiBwZGYnLFxyXG4gICAgICAnZmlsZVR5cGU6IHBkZidcclxuICAgIF07XHJcblxyXG4gICAgLy8gQWRkIGZpbGVuYW1lIGlmIGF2YWlsYWJsZVxyXG4gICAgaWYgKGZpbGVuYW1lKSB7XHJcbiAgICAgIGZyb250bWF0dGVyLnB1c2goYGZpbGVuYW1lOiAke2ZpbGVuYW1lfWApO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEFkZCBwYWdlIGNvdW50IGlmIGF2YWlsYWJsZVxyXG4gICAgaWYgKG1ldGFkYXRhLnBhZ2VDb3VudCkge1xyXG4gICAgICBmcm9udG1hdHRlci5wdXNoKGBwYWdlQ291bnQ6ICR7bWV0YWRhdGEucGFnZUNvdW50fWApO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEFkZCBmaWxlc2l6ZSBpZiBhdmFpbGFibGVcclxuICAgIGlmIChmaWxlU2l6ZSkge1xyXG4gICAgICBmcm9udG1hdHRlci5wdXNoKGBmaWxlU2l6ZTogJHtmaWxlU2l6ZX1gKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBBZGQgUERGIHNwZWNpZmljIG1ldGFkYXRhIGlmIGF2YWlsYWJsZVxyXG4gICAgaWYgKG1ldGFkYXRhLlBERkZvcm1hdFZlcnNpb24pIHtcclxuICAgICAgZnJvbnRtYXR0ZXIucHVzaChgUERGRm9ybWF0VmVyc2lvbjogJHttZXRhZGF0YS5QREZGb3JtYXRWZXJzaW9ufWApO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXRhZGF0YS5Jc0Fjcm9Gb3JtUHJlc2VudCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIGZyb250bWF0dGVyLnB1c2goYElzQWNyb0Zvcm1QcmVzZW50OiAke21ldGFkYXRhLklzQWNyb0Zvcm1QcmVzZW50fWApO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXRhZGF0YS5Jc1hGQVByZXNlbnQgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBmcm9udG1hdHRlci5wdXNoKGBJc1hGQVByZXNlbnQ6ICR7bWV0YWRhdGEuSXNYRkFQcmVzZW50fWApO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEFkZCBjcmVhdG9yIGlmIGF2YWlsYWJsZVxyXG4gICAgaWYgKG1ldGFkYXRhLmNyZWF0b3IpIHtcclxuICAgICAgZnJvbnRtYXR0ZXIucHVzaChgY3JlYXRvcjogJHttZXRhZGF0YS5jcmVhdG9yfWApO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFNwZWNpZnkgY29udmVydGVyIHR5cGVcclxuICAgIGZyb250bWF0dGVyLnB1c2goJ2NvbnZlcnRlcjogbWlzdHJhbC1vY3InKTtcclxuXHJcbiAgICAvLyBBZGQgb3JpZ2luYWwgZmlsZW5hbWUgaWYgYXZhaWxhYmxlXHJcbiAgICBpZiAob3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lKSB7XHJcbiAgICAgIGZyb250bWF0dGVyLnB1c2goYG9yaWdpbmFsRmlsZU5hbWU6ICR7b3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lfWApO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENsb3NlIGZyb250bWF0dGVyXHJcbiAgICBmcm9udG1hdHRlci5wdXNoKCctLS0nLCAnJyk7XHJcblxyXG4gICAgcmV0dXJuIGZyb250bWF0dGVyLmpvaW4oJ1xcbicpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2VuZXJhdGUgY29tcGxldGUgZG9jdW1lbnQgd2l0aCBmcm9udG1hdHRlciBhbmQgY29udGVudFxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBtZXRhZGF0YSAtIFBERiBtZXRhZGF0YVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvY3JSZXN1bHQgLSBPQ1IgcmVzdWx0XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBDb21wbGV0ZSBtYXJrZG93biBkb2N1bWVudFxyXG4gICAqL1xyXG4gIGdlbmVyYXRlQ29tcGxldGVEb2N1bWVudChtZXRhZGF0YSwgb2NyUmVzdWx0LCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnN0IGZyb250bWF0dGVyID0gdGhpcy5nZW5lcmF0ZUZyb250bWF0dGVyKG1ldGFkYXRhLCBvcHRpb25zKTtcclxuICAgIGNvbnN0IGNvbnRlbnQgPSB0aGlzLmdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIG9jclJlc3VsdCwgb3B0aW9ucyk7XHJcbiAgICBcclxuICAgIHJldHVybiBmcm9udG1hdHRlciArIGNvbnRlbnQ7XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IE1hcmtkb3duR2VuZXJhdG9yOyJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxpQkFBaUIsQ0FBQztFQUN0QkMsV0FBV0EsQ0FBQSxFQUFHO0lBQ1o7RUFBQTs7RUFHRjtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNFQyxnQkFBZ0JBLENBQUNDLFFBQVEsRUFBRUMsU0FBUyxFQUFFQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLEVBQUU7SUFDbERDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHlEQUF5RCxDQUFDO0lBRXRFLElBQUk7TUFDRjtNQUNBLE1BQU1DLFFBQVEsR0FBRyxJQUFJLENBQUNDLGNBQWMsQ0FBQ04sUUFBUSxFQUFFRSxPQUFPLENBQUM7O01BRXZEO01BQ0EsSUFBSSxDQUFDSyxpQkFBaUIsQ0FBQ0YsUUFBUSxFQUFFSixTQUFTLENBQUM7O01BRTNDO01BQ0EsSUFBSSxDQUFDTyxjQUFjLENBQUNILFFBQVEsRUFBRUosU0FBUyxDQUFDO01BRXhDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxrREFBa0QsQ0FBQztNQUMvRCxPQUFPQyxRQUFRLENBQUNJLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDNUIsQ0FBQyxDQUFDLE9BQU9DLEtBQUssRUFBRTtNQUNkUCxPQUFPLENBQUNPLEtBQUssQ0FBQyxnREFBZ0QsRUFBRUEsS0FBSyxDQUFDOztNQUV0RTtNQUNBLE9BQU8sSUFBSSxDQUFDQyx3QkFBd0IsQ0FBQ1gsUUFBUSxFQUFFQyxTQUFTLEVB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