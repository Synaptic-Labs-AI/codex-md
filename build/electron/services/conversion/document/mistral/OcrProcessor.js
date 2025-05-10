"use strict";

/**
 * OcrProcessor.js
 * Processes OCR results from Mistral API and converts them to structured data
 */

class OcrProcessor {
  constructor() {
    // Initialize processor
  }

  /**
   * Process OCR result from Mistral API
   * @param {Object} result - Raw OCR API result
   * @returns {Object} Processed result with structured content
   */
  processResult(result) {
    console.log('[OcrProcessor] Processing OCR result');
    try {
      if (!result) {
        throw new Error('Empty OCR result received');
      }

      // Log the structure of the result for debugging
      console.log('[OcrProcessor] OCR result structure:', Object.keys(result).join(', '));

      // Extract document-level information
      const documentInfo = {
        model: result.model || 'unknown',
        language: result.language || 'unknown',
        processingTime: result.processing_time || 0,
        overallConfidence: result.confidence || 0,
        usage: result.usage || null
      };

      // Process pages based on Mistral OCR API response format
      let pages = this._extractPages(result);
      console.log(`[OcrProcessor] Processing ${pages.length} pages from OCR result`);
      const processedPages = pages.map((page, index) => this._processPage(page, index));
      console.log(`[OcrProcessor] OCR result processing complete for ${processedPages.length} pages`);
      return {
        documentInfo,
        pages: processedPages
      };
    } catch (error) {
      console.error('[OcrProcessor] Error processing OCR result:', error);

      // Provide detailed error information
      console.error('[OcrProcessor] OCR result that caused error:', result ? JSON.stringify(result, null, 2).substring(0, 500) + '...' : 'undefined');

      // Fallback to basic processing if an error occurs
      return this._createFallbackResult(result, error);
    }
  }

  /**
   * Extract pages array from result with format handling
   * @param {Object} result - OCR result
   * @returns {Array} Array of page objects
   * @private
   */
  _extractPages(result) {
    // Handle different response formats
    if (result.pages && Array.isArray(result.pages)) {
      // Standard format with pages array
      return result.pages;
    } else if (result.data && Array.isArray(result.data)) {
      // Alternative format with data array
      return result.data;
    } else if (result.content && typeof result.content === 'string') {
      // Simple format with just content string
      return [{
        page_number: 1,
        text: result.content,
        confidence: result.confidence || 0
      }];
    } else if (result.text && typeof result.text === 'string') {
      // Another simple format with just text
      return [{
        page_number: 1,
        text: result.text,
        confidence: result.confidence || 0
      }];
    }

    // If no recognized format, return empty array
    return [];
  }

  /**
   * Process a single page
   * @param {Object} page - Page data from OCR
   * @param {number} index - Page index for fallback numbering
   * @returns {Object} Processed page
   * @private
   */
  _processPage(page, index) {
    // Basic page information with fallbacks
    const pageNumber = page.page_number || page.pageNumber || index + 1;
    const processedPage = {
      pageNumber,
      confidence: page.confidence || 0,
      width: page.width || page.dimensions?.width || 0,
      height: page.height || page.dimensions?.height || 0,
      text: ''
    };

    // Process structured content if available
    if (page.blocks && Array.isArray(page.blocks)) {
      // Process blocks (paragraphs, headings, lists, tables, etc.)
      const textBlocks = this.processContentBlocks(page.blocks);
      processedPage.text = textBlocks.join('\n\n');
    } else if (page.elements && Array.isArray(page.elements)) {
      // Alternative structure with elements instead of blocks
      const elements = page.elements.map(element => {
        if (element.type === 'text' && element.text) {
          return element.text;
        } else if (element.content) {
          return element.content;
        }
        return '';
      }).filter(text => text.trim().length > 0);
      processedPage.text = elements.join('\n\n');
    } else if (page.content && typeof page.content === 'string') {
      // Simple content field
      processedPage.text = page.content;
    } else if (page.text) {
      // Fallback to raw text if structured content is not available
      processedPage.text = page.text;
    }
    return processedPage;
  }

  /**
   * Create fallback result when processing fails
   * @param {Object} result - Original result
   * @param {Error} error - Error that occurred during processing
   * @returns {Object} Fallback result
   * @private
   */
  _createFallbackResult(result, error) {
    let pages = [];
    try {
      // Attempt to extract any usable information
      if (result && result.pages && Array.isArray(result.pages)) {
        pages = result.pages;
      } else if (result && result.data && Array.isArray(result.data)) {
        pages = result.data;
      } else if (result && typeof result === 'string') {
        // Handle case where result might be a string
        pages = [{
          text: result
        }];
      } else if (result && result.text && typeof result.text === 'string') {
        pages = [{
          text: result.text
        }];
      }
    } catch (fallbackError) {
      console.error('[OcrProcessor] Fallback processing also failed:', fallbackError);
      pages = [];
    }
    return {
      documentInfo: {
        model: result?.model || 'unknown',
        language: result?.language || 'unknown',
        error: error.message
      },
      pages: pages.map((page, index) => ({
        pageNumber: page.page_number || page.pageNumber || index + 1,
        text: page.text || page.content || '',
        confidence: page.confidence || 0
      }))
    };
  }

  /**
   * Process content blocks from OCR result
   * @param {Array} blocks - Content blocks from OCR
   * @returns {Array} Processed text blocks
   */
  processContentBlocks(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return [];
    }
    return blocks.map(block => {
      try {
        // Handle case where block might be a string
        if (typeof block === 'string') {
          return block;
        }

        // Handle case where block might have direct text content
        if (!block.type && block.text) {
          return block.text;
        }

        // Process different types of blocks
        switch (block.type?.toLowerCase()) {
          case 'heading':
            return this.processHeading(block);
          case 'paragraph':
          case 'text':
            return this.processParagraph(block);
          case 'list':
          case 'bullet_list':
          case 'numbered_list':
            return this.processList(block);
          case 'table':
            return this.processTable(block);
          case 'image':
          case 'figure':
            return this.processImage(block);
          case 'code':
          case 'code_block':
            return this.processCodeBlock(block);
          case 'quote':
          case 'blockquote':
            return this.processQuote(block);
          default:
            // For unknown block types, just return the text if available
            return block.text || block.content || '';
        }
      } catch (error) {
        console.error('[OcrProcessor] Error processing content block:', error);
        // Return empty string if processing fails
        return '';
      }
    }).filter(text => text.trim().length > 0); // Filter out empty blocks
  }

  /**
   * Process heading block
   * @param {Object} block - Heading block
   * @returns {string} Markdown heading
   */
  processHeading(block) {
    const level = block.level || 1;
    const headingMarkers = '#'.repeat(Math.min(level, 6));
    return `${headingMarkers} ${block.text || ''}`;
  }

  /**
   * Process paragraph block
   * @param {Object} block - Paragraph block
   * @returns {string} Paragraph text
   */
  processParagraph(block) {
    return block.text || '';
  }

  /**
   * Process list block
   * @param {Object} block - List block
   * @returns {string} Markdown list
   */
  processList(block) {
    if (!block.items || !Array.isArray(block.items) || block.items.length === 0) {
      return '';
    }
    const listType = block.ordered ? 'ordered' : 'unordered';
    return block.items.map((item, index) => {
      if (listType === 'ordered') {
        return `${index + 1}. ${item.text || ''}`;
      } else {
        return `- ${item.text || ''}`;
      }
    }).join('\n');
  }

  /**
   * Process table block
   * @param {Object} block - Table block
   * @returns {string} Markdown table
   */
  processTable(block) {
    if (!block.rows || !Array.isArray(block.rows) || block.rows.length === 0) {
      return '';
    }
    const tableRows = block.rows.map(row => {
      if (!row.cells || !Array.isArray(row.cells)) {
        return '| |';
      }
      const cells = row.cells.map(cell => cell.text || '').join(' | ');
      return `| ${cells} |`;
    });

    // Insert header separator after the first row
    if (tableRows.length > 1) {
      const headerRow = tableRows[0];
      const separatorCount = (headerRow.match(/\|/g) || []).length - 1;
      const separator = `|${' --- |'.repeat(separatorCount)}`;
      tableRows.splice(1, 0, separator);
    }
    return tableRows.join('\n');
  }

  /**
   * Process image block
   * @param {Object} block - Image block
   * @returns {string} Markdown image reference
   */
  processImage(block) {
    const caption = block.caption || block.alt || 'Image';
    const source = block.src || block.source || block.url || 'image-reference';
    return `![${caption}](${source})`;
  }

  /**
   * Process code block
   * @param {Object} block - Code block
   * @returns {string} Markdown code block
   */
  processCodeBlock(block) {
    const language = block.language || '';
    const code = block.text || block.content || block.code || '';
    return `\`\`\`${language}\n${code}\n\`\`\``;
  }

  /**
   * Process quote block
   * @param {Object} block - Quote block
   * @returns {string} Markdown quote
   */
  processQuote(block) {
    const text = block.text || block.content || '';
    // Split by newlines and add > to each line
    return text.split('\n').map(line => `> ${line}`).join('\n');
  }
}
module.exports = OcrProcessor;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJPY3JQcm9jZXNzb3IiLCJjb25zdHJ1Y3RvciIsInByb2Nlc3NSZXN1bHQiLCJyZXN1bHQiLCJjb25zb2xlIiwibG9nIiwiRXJyb3IiLCJPYmplY3QiLCJrZXlzIiwiam9pbiIsImRvY3VtZW50SW5mbyIsIm1vZGVsIiwibGFuZ3VhZ2UiLCJwcm9jZXNzaW5nVGltZSIsInByb2Nlc3NpbmdfdGltZSIsIm92ZXJhbGxDb25maWRlbmNlIiwiY29uZmlkZW5jZSIsInVzYWdlIiwicGFnZXMiLCJfZXh0cmFjdFBhZ2VzIiwibGVuZ3RoIiwicHJvY2Vzc2VkUGFnZXMiLCJtYXAiLCJwYWdlIiwiaW5kZXgiLCJfcHJvY2Vzc1BhZ2UiLCJlcnJvciIsIkpTT04iLCJzdHJpbmdpZnkiLCJzdWJzdHJpbmciLCJfY3JlYXRlRmFsbGJhY2tSZXN1bHQiLCJBcnJheSIsImlzQXJyYXkiLCJkYXRhIiwiY29udGVudCIsInBhZ2VfbnVtYmVyIiwidGV4dCIsInBhZ2VOdW1iZXIiLCJwcm9jZXNzZWRQYWdlIiwid2lkdGgiLCJkaW1lbnNpb25zIiwiaGVpZ2h0IiwiYmxvY2tzIiwidGV4dEJsb2NrcyIsInByb2Nlc3NDb250ZW50QmxvY2tzIiwiZWxlbWVudHMiLCJlbGVtZW50IiwidHlwZSIsImZpbHRlciIsInRyaW0iLCJmYWxsYmFja0Vycm9yIiwibWVzc2FnZSIsImJsb2NrIiwidG9Mb3dlckNhc2UiLCJwcm9jZXNzSGVhZGluZyIsInByb2Nlc3NQYXJhZ3JhcGgiLCJwcm9jZXNzTGlzdCIsInByb2Nlc3NUYWJsZSIsInByb2Nlc3NJbWFnZSIsInByb2Nlc3NDb2RlQmxvY2siLCJwcm9jZXNzUXVvdGUiLCJsZXZlbCIsImhlYWRpbmdNYXJrZXJzIiwicmVwZWF0IiwiTWF0aCIsIm1pbiIsIml0ZW1zIiwibGlzdFR5cGUiLCJvcmRlcmVkIiwiaXRlbSIsInJvd3MiLCJ0YWJsZVJvd3MiLCJyb3ciLCJjZWxscyIsImNlbGwiLCJoZWFkZXJSb3ciLCJzZXBhcmF0b3JDb3VudCIsIm1hdGNoIiwic2VwYXJhdG9yIiwic3BsaWNlIiwiY2FwdGlvbiIsImFsdCIsInNvdXJjZSIsInNyYyIsInVybCIsImNvZGUiLCJzcGxpdCIsImxpbmUiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vZG9jdW1lbnQvbWlzdHJhbC9PY3JQcm9jZXNzb3IuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIE9jclByb2Nlc3Nvci5qc1xyXG4gKiBQcm9jZXNzZXMgT0NSIHJlc3VsdHMgZnJvbSBNaXN0cmFsIEFQSSBhbmQgY29udmVydHMgdGhlbSB0byBzdHJ1Y3R1cmVkIGRhdGFcclxuICovXHJcblxyXG5jbGFzcyBPY3JQcm9jZXNzb3Ige1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgLy8gSW5pdGlhbGl6ZSBwcm9jZXNzb3JcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFByb2Nlc3MgT0NSIHJlc3VsdCBmcm9tIE1pc3RyYWwgQVBJXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IHJlc3VsdCAtIFJhdyBPQ1IgQVBJIHJlc3VsdFxyXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IFByb2Nlc3NlZCByZXN1bHQgd2l0aCBzdHJ1Y3R1cmVkIGNvbnRlbnRcclxuICAgKi9cclxuICBwcm9jZXNzUmVzdWx0KHJlc3VsdCkge1xyXG4gICAgY29uc29sZS5sb2coJ1tPY3JQcm9jZXNzb3JdIFByb2Nlc3NpbmcgT0NSIHJlc3VsdCcpO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICBpZiAoIXJlc3VsdCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRW1wdHkgT0NSIHJlc3VsdCByZWNlaXZlZCcpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBMb2cgdGhlIHN0cnVjdHVyZSBvZiB0aGUgcmVzdWx0IGZvciBkZWJ1Z2dpbmdcclxuICAgICAgY29uc29sZS5sb2coJ1tPY3JQcm9jZXNzb3JdIE9DUiByZXN1bHQgc3RydWN0dXJlOicsXHJcbiAgICAgICAgT2JqZWN0LmtleXMocmVzdWx0KS5qb2luKCcsICcpKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEV4dHJhY3QgZG9jdW1lbnQtbGV2ZWwgaW5mb3JtYXRpb25cclxuICAgICAgY29uc3QgZG9jdW1lbnRJbmZvID0ge1xyXG4gICAgICAgIG1vZGVsOiByZXN1bHQubW9kZWwgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgIGxhbmd1YWdlOiByZXN1bHQubGFuZ3VhZ2UgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgIHByb2Nlc3NpbmdUaW1lOiByZXN1bHQucHJvY2Vzc2luZ190aW1lIHx8IDAsXHJcbiAgICAgICAgb3ZlcmFsbENvbmZpZGVuY2U6IHJlc3VsdC5jb25maWRlbmNlIHx8IDAsXHJcbiAgICAgICAgdXNhZ2U6IHJlc3VsdC51c2FnZSB8fCBudWxsXHJcbiAgICAgIH07XHJcbiAgICAgIFxyXG4gICAgICAvLyBQcm9jZXNzIHBhZ2VzIGJhc2VkIG9uIE1pc3RyYWwgT0NSIEFQSSByZXNwb25zZSBmb3JtYXRcclxuICAgICAgbGV0IHBhZ2VzID0gdGhpcy5fZXh0cmFjdFBhZ2VzKHJlc3VsdCk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhgW09jclByb2Nlc3Nvcl0gUHJvY2Vzc2luZyAke3BhZ2VzLmxlbmd0aH0gcGFnZXMgZnJvbSBPQ1IgcmVzdWx0YCk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBwcm9jZXNzZWRQYWdlcyA9IHBhZ2VzLm1hcCgocGFnZSwgaW5kZXgpID0+IHRoaXMuX3Byb2Nlc3NQYWdlKHBhZ2UsIGluZGV4KSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhgW09jclByb2Nlc3Nvcl0gT0NSIHJlc3VsdCBwcm9jZXNzaW5nIGNvbXBsZXRlIGZvciAke3Byb2Nlc3NlZFBhZ2VzLmxlbmd0aH0gcGFnZXNgKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgZG9jdW1lbnRJbmZvLFxyXG4gICAgICAgIHBhZ2VzOiBwcm9jZXNzZWRQYWdlc1xyXG4gICAgICB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignW09jclByb2Nlc3Nvcl0gRXJyb3IgcHJvY2Vzc2luZyBPQ1IgcmVzdWx0OicsIGVycm9yKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFByb3ZpZGUgZGV0YWlsZWQgZXJyb3IgaW5mb3JtYXRpb25cclxuICAgICAgY29uc29sZS5lcnJvcignW09jclByb2Nlc3Nvcl0gT0NSIHJlc3VsdCB0aGF0IGNhdXNlZCBlcnJvcjonLFxyXG4gICAgICAgIHJlc3VsdCA/IEpTT04uc3RyaW5naWZ5KHJlc3VsdCwgbnVsbCwgMikuc3Vic3RyaW5nKDAsIDUwMCkgKyAnLi4uJyA6ICd1bmRlZmluZWQnKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEZhbGxiYWNrIHRvIGJhc2ljIHByb2Nlc3NpbmcgaWYgYW4gZXJyb3Igb2NjdXJzXHJcbiAgICAgIHJldHVybiB0aGlzLl9jcmVhdGVGYWxsYmFja1Jlc3VsdChyZXN1bHQsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEV4dHJhY3QgcGFnZXMgYXJyYXkgZnJvbSByZXN1bHQgd2l0aCBmb3JtYXQgaGFuZGxpbmdcclxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVzdWx0IC0gT0NSIHJlc3VsdFxyXG4gICAqIEByZXR1cm5zIHtBcnJheX0gQXJyYXkgb2YgcGFnZSBvYmplY3RzXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBfZXh0cmFjdFBhZ2VzKHJlc3VsdCkge1xyXG4gICAgLy8gSGFuZGxlIGRpZmZlcmVudCByZXNwb25zZSBmb3JtYXRzXHJcbiAgICBpZiAocmVzdWx0LnBhZ2VzICYmIEFycmF5LmlzQXJyYXkocmVzdWx0LnBhZ2VzKSkge1xyXG4gICAgICAvLyBTdGFuZGFyZCBmb3JtYXQgd2l0aCBwYWdlcyBhcnJheVxyXG4gICAgICByZXR1cm4gcmVzdWx0LnBhZ2VzO1xyXG4gICAgfSBlbHNlIGlmIChyZXN1bHQuZGF0YSAmJiBBcnJheS5pc0FycmF5KHJlc3VsdC5kYXRhKSkge1xyXG4gICAgICAvLyBBbHRlcm5hdGl2ZSBmb3JtYXQgd2l0aCBkYXRhIGFycmF5XHJcbiAgICAgIHJldHVybiByZXN1bHQuZGF0YTtcclxuICAgIH0gZWxzZSBpZiAocmVzdWx0LmNvbnRlbnQgJiYgdHlwZW9mIHJlc3VsdC5jb250ZW50ID09PSAnc3RyaW5nJykge1xyXG4gICAgICAvLyBTaW1wbGUgZm9ybWF0IHdpdGgganVzdCBjb250ZW50IHN0cmluZ1xyXG4gICAgICByZXR1cm4gW3tcclxuICAgICAgICBwYWdlX251bWJlcjogMSxcclxuICAgICAgICB0ZXh0OiByZXN1bHQuY29udGVudCxcclxuICAgICAgICBjb25maWRlbmNlOiByZXN1bHQuY29uZmlkZW5jZSB8fCAwXHJcbiAgICAgIH1dO1xyXG4gICAgfSBlbHNlIGlmIChyZXN1bHQudGV4dCAmJiB0eXBlb2YgcmVzdWx0LnRleHQgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIC8vIEFub3RoZXIgc2ltcGxlIGZvcm1hdCB3aXRoIGp1c3QgdGV4dFxyXG4gICAgICByZXR1cm4gW3tcclxuICAgICAgICBwYWdlX251bWJlcjogMSxcclxuICAgICAgICB0ZXh0OiByZXN1bHQudGV4dCxcclxuICAgICAgICBjb25maWRlbmNlOiByZXN1bHQuY29uZmlkZW5jZSB8fCAwXHJcbiAgICAgIH1dO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBJZiBubyByZWNvZ25pemVkIGZvcm1hdCwgcmV0dXJuIGVtcHR5IGFycmF5XHJcbiAgICByZXR1cm4gW107XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQcm9jZXNzIGEgc2luZ2xlIHBhZ2VcclxuICAgKiBAcGFyYW0ge09iamVjdH0gcGFnZSAtIFBhZ2UgZGF0YSBmcm9tIE9DUlxyXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleCAtIFBhZ2UgaW5kZXggZm9yIGZhbGxiYWNrIG51bWJlcmluZ1xyXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IFByb2Nlc3NlZCBwYWdlXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBfcHJvY2Vzc1BhZ2UocGFnZSwgaW5kZXgpIHtcclxuICAgIC8vIEJhc2ljIHBhZ2UgaW5mb3JtYXRpb24gd2l0aCBmYWxsYmFja3NcclxuICAgIGNvbnN0IHBhZ2VOdW1iZXIgPSBwYWdlLnBhZ2VfbnVtYmVyIHx8IHBhZ2UucGFnZU51bWJlciB8fCBpbmRleCArIDE7XHJcbiAgICBjb25zdCBwcm9jZXNzZWRQYWdlID0ge1xyXG4gICAgICBwYWdlTnVtYmVyLFxyXG4gICAgICBjb25maWRlbmNlOiBwYWdlLmNvbmZpZGVuY2UgfHwgMCxcclxuICAgICAgd2lkdGg6IHBhZ2Uud2lkdGggfHwgcGFnZS5kaW1lbnNpb25zPy53aWR0aCB8fCAwLFxyXG4gICAgICBoZWlnaHQ6IHBhZ2UuaGVpZ2h0IHx8IHBhZ2UuZGltZW5zaW9ucz8uaGVpZ2h0IHx8IDAsXHJcbiAgICAgIHRleHQ6ICcnXHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICAvLyBQcm9jZXNzIHN0cnVjdHVyZWQgY29udGVudCBpZiBhdmFpbGFibGVcclxuICAgIGlmIChwYWdlLmJsb2NrcyAmJiBBcnJheS5pc0FycmF5KHBhZ2UuYmxvY2tzKSkge1xyXG4gICAgICAvLyBQcm9jZXNzIGJsb2NrcyAocGFyYWdyYXBocywgaGVhZGluZ3MsIGxpc3RzLCB0YWJsZXMsIGV0Yy4pXHJcbiAgICAgIGNvbnN0IHRleHRCbG9ja3MgPSB0aGlzLnByb2Nlc3NDb250ZW50QmxvY2tzKHBhZ2UuYmxvY2tzKTtcclxuICAgICAgcHJvY2Vzc2VkUGFnZS50ZXh0ID0gdGV4dEJsb2Nrcy5qb2luKCdcXG5cXG4nKTtcclxuICAgIH0gZWxzZSBpZiAocGFnZS5lbGVtZW50cyAmJiBBcnJheS5pc0FycmF5KHBhZ2UuZWxlbWVudHMpKSB7XHJcbiAgICAgIC8vIEFsdGVybmF0aXZlIHN0cnVjdHVyZSB3aXRoIGVsZW1lbnRzIGluc3RlYWQgb2YgYmxvY2tzXHJcbiAgICAgIGNvbnN0IGVsZW1lbnRzID0gcGFnZS5lbGVtZW50cy5tYXAoZWxlbWVudCA9PiB7XHJcbiAgICAgICAgaWYgKGVsZW1lbnQudHlwZSA9PT0gJ3RleHQnICYmIGVsZW1lbnQudGV4dCkge1xyXG4gICAgICAgICAgcmV0dXJuIGVsZW1lbnQudGV4dDtcclxuICAgICAgICB9IGVsc2UgaWYgKGVsZW1lbnQuY29udGVudCkge1xyXG4gICAgICAgICAgcmV0dXJuIGVsZW1lbnQuY29udGVudDtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuICcnO1xyXG4gICAgICB9KS5maWx0ZXIodGV4dCA9PiB0ZXh0LnRyaW0oKS5sZW5ndGggPiAwKTtcclxuICAgICAgXHJcbiAgICAgIHByb2Nlc3NlZFBhZ2UudGV4dCA9IGVsZW1lbnRzLmpvaW4oJ1xcblxcbicpO1xyXG4gICAgfSBlbHNlIGlmIChwYWdlLmNvbnRlbnQgJiYgdHlwZW9mIHBhZ2UuY29udGVudCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgLy8gU2ltcGxlIGNvbnRlbnQgZmllbGRcclxuICAgICAgcHJvY2Vzc2VkUGFnZS50ZXh0ID0gcGFnZS5jb250ZW50O1xyXG4gICAgfSBlbHNlIGlmIChwYWdlLnRleHQpIHtcclxuICAgICAgLy8gRmFsbGJhY2sgdG8gcmF3IHRleHQgaWYgc3RydWN0dXJlZCBjb250ZW50IGlzIG5vdCBhdmFpbGFibGVcclxuICAgICAgcHJvY2Vzc2VkUGFnZS50ZXh0ID0gcGFnZS50ZXh0O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gcHJvY2Vzc2VkUGFnZTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENyZWF0ZSBmYWxsYmFjayByZXN1bHQgd2hlbiBwcm9jZXNzaW5nIGZhaWxzXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IHJlc3VsdCAtIE9yaWdpbmFsIHJlc3VsdFxyXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgdGhhdCBvY2N1cnJlZCBkdXJpbmcgcHJvY2Vzc2luZ1xyXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IEZhbGxiYWNrIHJlc3VsdFxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgX2NyZWF0ZUZhbGxiYWNrUmVzdWx0KHJlc3VsdCwgZXJyb3IpIHtcclxuICAgIGxldCBwYWdlcyA9IFtdO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBBdHRlbXB0IHRvIGV4dHJhY3QgYW55IHVzYWJsZSBpbmZvcm1hdGlvblxyXG4gICAgICBpZiAocmVzdWx0ICYmIHJlc3VsdC5wYWdlcyAmJiBBcnJheS5pc0FycmF5KHJlc3VsdC5wYWdlcykpIHtcclxuICAgICAgICBwYWdlcyA9IHJlc3VsdC5wYWdlcztcclxuICAgICAgfSBlbHNlIGlmIChyZXN1bHQgJiYgcmVzdWx0LmRhdGEgJiYgQXJyYXkuaXNBcnJheShyZXN1bHQuZGF0YSkpIHtcclxuICAgICAgICBwYWdlcyA9IHJlc3VsdC5kYXRhO1xyXG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdCAmJiB0eXBlb2YgcmVzdWx0ID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgIC8vIEhhbmRsZSBjYXNlIHdoZXJlIHJlc3VsdCBtaWdodCBiZSBhIHN0cmluZ1xyXG4gICAgICAgIHBhZ2VzID0gW3sgdGV4dDogcmVzdWx0IH1dO1xyXG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdCAmJiByZXN1bHQudGV4dCAmJiB0eXBlb2YgcmVzdWx0LnRleHQgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgcGFnZXMgPSBbeyB0ZXh0OiByZXN1bHQudGV4dCB9XTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZmFsbGJhY2tFcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdbT2NyUHJvY2Vzc29yXSBGYWxsYmFjayBwcm9jZXNzaW5nIGFsc28gZmFpbGVkOicsIGZhbGxiYWNrRXJyb3IpO1xyXG4gICAgICBwYWdlcyA9IFtdO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBkb2N1bWVudEluZm86IHtcclxuICAgICAgICBtb2RlbDogcmVzdWx0Py5tb2RlbCB8fCAndW5rbm93bicsXHJcbiAgICAgICAgbGFuZ3VhZ2U6IHJlc3VsdD8ubGFuZ3VhZ2UgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlXHJcbiAgICAgIH0sXHJcbiAgICAgIHBhZ2VzOiBwYWdlcy5tYXAoKHBhZ2UsIGluZGV4KSA9PiAoe1xyXG4gICAgICAgIHBhZ2VOdW1iZXI6IHBhZ2UucGFnZV9udW1iZXIgfHwgcGFnZS5wYWdlTnVtYmVyIHx8IGluZGV4ICsgMSxcclxuICAgICAgICB0ZXh0OiBwYWdlLnRleHQgfHwgcGFnZS5jb250ZW50IHx8ICcnLFxyXG4gICAgICAgIGNvbmZpZGVuY2U6IHBhZ2UuY29uZmlkZW5jZSB8fCAwXHJcbiAgICAgIH0pKVxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFByb2Nlc3MgY29udGVudCBibG9ja3MgZnJvbSBPQ1IgcmVzdWx0XHJcbiAgICogQHBhcmFtIHtBcnJheX0gYmxvY2tzIC0gQ29udGVudCBibG9ja3MgZnJvbSBPQ1JcclxuICAgKiBAcmV0dXJucyB7QXJyYXl9IFByb2Nlc3NlZCB0ZXh0IGJsb2Nrc1xyXG4gICAqL1xyXG4gIHByb2Nlc3NDb250ZW50QmxvY2tzKGJsb2Nrcykge1xyXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGJsb2NrcykgfHwgYmxvY2tzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiBibG9ja3MubWFwKGJsb2NrID0+IHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBIYW5kbGUgY2FzZSB3aGVyZSBibG9jayBtaWdodCBiZSBhIHN0cmluZ1xyXG4gICAgICAgIGlmICh0eXBlb2YgYmxvY2sgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICByZXR1cm4gYmxvY2s7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEhhbmRsZSBjYXNlIHdoZXJlIGJsb2NrIG1pZ2h0IGhhdmUgZGlyZWN0IHRleHQgY29udGVudFxyXG4gICAgICAgIGlmICghYmxvY2sudHlwZSAmJiBibG9jay50ZXh0KSB7XHJcbiAgICAgICAgICByZXR1cm4gYmxvY2sudGV4dDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUHJvY2VzcyBkaWZmZXJlbnQgdHlwZXMgb2YgYmxvY2tzXHJcbiAgICAgICAgc3dpdGNoIChibG9jay50eXBlPy50b0xvd2VyQ2FzZSgpKSB7XHJcbiAgICAgICAgICBjYXNlICdoZWFkaW5nJzpcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc0hlYWRpbmcoYmxvY2spO1xyXG4gICAgICAgICAgY2FzZSAncGFyYWdyYXBoJzpcclxuICAgICAgICAgIGNhc2UgJ3RleHQnOlxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzUGFyYWdyYXBoKGJsb2NrKTtcclxuICAgICAgICAgIGNhc2UgJ2xpc3QnOlxyXG4gICAgICAgICAgY2FzZSAnYnVsbGV0X2xpc3QnOlxyXG4gICAgICAgICAgY2FzZSAnbnVtYmVyZWRfbGlzdCc6XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NMaXN0KGJsb2NrKTtcclxuICAgICAgICAgIGNhc2UgJ3RhYmxlJzpcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc1RhYmxlKGJsb2NrKTtcclxuICAgICAgICAgIGNhc2UgJ2ltYWdlJzpcclxuICAgICAgICAgIGNhc2UgJ2ZpZ3VyZSc6XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NJbWFnZShibG9jayk7XHJcbiAgICAgICAgICBjYXNlICdjb2RlJzpcclxuICAgICAgICAgIGNhc2UgJ2NvZGVfYmxvY2snOlxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzQ29kZUJsb2NrKGJsb2NrKTtcclxuICAgICAgICAgIGNhc2UgJ3F1b3RlJzpcclxuICAgICAgICAgIGNhc2UgJ2Jsb2NrcXVvdGUnOlxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzUXVvdGUoYmxvY2spO1xyXG4gICAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgICAgLy8gRm9yIHVua25vd24gYmxvY2sgdHlwZXMsIGp1c3QgcmV0dXJuIHRoZSB0ZXh0IGlmIGF2YWlsYWJsZVxyXG4gICAgICAgICAgICByZXR1cm4gYmxvY2sudGV4dCB8fCBibG9jay5jb250ZW50IHx8ICcnO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdbT2NyUHJvY2Vzc29yXSBFcnJvciBwcm9jZXNzaW5nIGNvbnRlbnQgYmxvY2s6JywgZXJyb3IpO1xyXG4gICAgICAgIC8vIFJldHVybiBlbXB0eSBzdHJpbmcgaWYgcHJvY2Vzc2luZyBmYWlsc1xyXG4gICAgICAgIHJldHVybiAnJztcclxuICAgICAgfVxyXG4gICAgfSkuZmlsdGVyKHRleHQgPT4gdGV4dC50cmltKCkubGVuZ3RoID4gMCk7IC8vIEZpbHRlciBvdXQgZW1wdHkgYmxvY2tzXHJcbiAgfVxyXG4gIFxyXG4gIC8qKlxyXG4gICAqIFByb2Nlc3MgaGVhZGluZyBibG9ja1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBibG9jayAtIEhlYWRpbmcgYmxvY2tcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBoZWFkaW5nXHJcbiAgICovXHJcbiAgcHJvY2Vzc0hlYWRpbmcoYmxvY2spIHtcclxuICAgIGNvbnN0IGxldmVsID0gYmxvY2subGV2ZWwgfHwgMTtcclxuICAgIGNvbnN0IGhlYWRpbmdNYXJrZXJzID0gJyMnLnJlcGVhdChNYXRoLm1pbihsZXZlbCwgNikpO1xyXG4gICAgcmV0dXJuIGAke2hlYWRpbmdNYXJrZXJzfSAke2Jsb2NrLnRleHQgfHwgJyd9YDtcclxuICB9XHJcbiAgXHJcbiAgLyoqXHJcbiAgICogUHJvY2VzcyBwYXJhZ3JhcGggYmxvY2tcclxuICAgKiBAcGFyYW0ge09iamVjdH0gYmxvY2sgLSBQYXJhZ3JhcGggYmxvY2tcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBQYXJhZ3JhcGggdGV4dFxyXG4gICAqL1xyXG4gIHByb2Nlc3NQYXJhZ3JhcGgoYmxvY2spIHtcclxuICAgIHJldHVybiBibG9jay50ZXh0IHx8ICcnO1xyXG4gIH1cclxuICBcclxuICAvKipcclxuICAgKiBQcm9jZXNzIGxpc3QgYmxvY2tcclxuICAgKiBAcGFyYW0ge09iamVjdH0gYmxvY2sgLSBMaXN0IGJsb2NrXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gTWFya2Rvd24gbGlzdFxyXG4gICAqL1xyXG4gIHByb2Nlc3NMaXN0KGJsb2NrKSB7XHJcbiAgICBpZiAoIWJsb2NrLml0ZW1zIHx8ICFBcnJheS5pc0FycmF5KGJsb2NrLml0ZW1zKSB8fCBibG9jay5pdGVtcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgcmV0dXJuICcnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBjb25zdCBsaXN0VHlwZSA9IGJsb2NrLm9yZGVyZWQgPyAnb3JkZXJlZCcgOiAndW5vcmRlcmVkJztcclxuICAgIFxyXG4gICAgcmV0dXJuIGJsb2NrLml0ZW1zLm1hcCgoaXRlbSwgaW5kZXgpID0+IHtcclxuICAgICAgaWYgKGxpc3RUeXBlID09PSAnb3JkZXJlZCcpIHtcclxuICAgICAgICByZXR1cm4gYCR7aW5kZXggKyAxfS4gJHtpdGVtLnRleHQgfHwgJyd9YDtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICByZXR1cm4gYC0gJHtpdGVtLnRleHQgfHwgJyd9YDtcclxuICAgICAgfVxyXG4gICAgfSkuam9pbignXFxuJyk7XHJcbiAgfVxyXG4gIFxyXG4gIC8qKlxyXG4gICAqIFByb2Nlc3MgdGFibGUgYmxvY2tcclxuICAgKiBAcGFyYW0ge09iamVjdH0gYmxvY2sgLSBUYWJsZSBibG9ja1xyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IE1hcmtkb3duIHRhYmxlXHJcbiAgICovXHJcbiAgcHJvY2Vzc1RhYmxlKGJsb2NrKSB7XHJcbiAgICBpZiAoIWJsb2NrLnJvd3MgfHwgIUFycmF5LmlzQXJyYXkoYmxvY2sucm93cykgfHwgYmxvY2sucm93cy5sZW5ndGggPT09IDApIHtcclxuICAgICAgcmV0dXJuICcnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBjb25zdCB0YWJsZVJvd3MgPSBibG9jay5yb3dzLm1hcChyb3cgPT4ge1xyXG4gICAgICBpZiAoIXJvdy5jZWxscyB8fCAhQXJyYXkuaXNBcnJheShyb3cuY2VsbHMpKSB7XHJcbiAgICAgICAgcmV0dXJuICd8IHwnO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBjZWxscyA9IHJvdy5jZWxscy5tYXAoY2VsbCA9PiBjZWxsLnRleHQgfHwgJycpLmpvaW4oJyB8ICcpO1xyXG4gICAgICByZXR1cm4gYHwgJHtjZWxsc30gfGA7XHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gSW5zZXJ0IGhlYWRlciBzZXBhcmF0b3IgYWZ0ZXIgdGhlIGZpcnN0IHJvd1xyXG4gICAgaWYgKHRhYmxlUm93cy5sZW5ndGggPiAxKSB7XHJcbiAgICAgIGNvbnN0IGhlYWRlclJvdyA9IHRhYmxlUm93c1swXTtcclxuICAgICAgY29uc3Qgc2VwYXJhdG9yQ291bnQgPSAoaGVhZGVyUm93Lm1hdGNoKC9cXHwvZykgfHwgW10pLmxlbmd0aCAtIDE7XHJcbiAgICAgIGNvbnN0IHNlcGFyYXRvciA9IGB8JHsnIC0tLSB8Jy5yZXBlYXQoc2VwYXJhdG9yQ291bnQpfWA7XHJcbiAgICAgIHRhYmxlUm93cy5zcGxpY2UoMSwgMCwgc2VwYXJhdG9yKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHRhYmxlUm93cy5qb2luKCdcXG4nKTtcclxuICB9XHJcbiAgXHJcbiAgLyoqXHJcbiAgICogUHJvY2VzcyBpbWFnZSBibG9ja1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBibG9jayAtIEltYWdlIGJsb2NrXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gTWFya2Rvd24gaW1hZ2UgcmVmZXJlbmNlXHJcbiAgICovXHJcbiAgcHJvY2Vzc0ltYWdlKGJsb2NrKSB7XHJcbiAgICBjb25zdCBjYXB0aW9uID0gYmxvY2suY2FwdGlvbiB8fCBibG9jay5hbHQgfHwgJ0ltYWdlJztcclxuICAgIGNvbnN0IHNvdXJjZSA9IGJsb2NrLnNyYyB8fCBibG9jay5zb3VyY2UgfHwgYmxvY2sudXJsIHx8ICdpbWFnZS1yZWZlcmVuY2UnO1xyXG4gICAgcmV0dXJuIGAhWyR7Y2FwdGlvbn1dKCR7c291cmNlfSlgO1xyXG4gIH1cclxuICBcclxuICAvKipcclxuICAgKiBQcm9jZXNzIGNvZGUgYmxvY2tcclxuICAgKiBAcGFyYW0ge09iamVjdH0gYmxvY2sgLSBDb2RlIGJsb2NrXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gTWFya2Rvd24gY29kZSBibG9ja1xyXG4gICAqL1xyXG4gIHByb2Nlc3NDb2RlQmxvY2soYmxvY2spIHtcclxuICAgIGNvbnN0IGxhbmd1YWdlID0gYmxvY2subGFuZ3VhZ2UgfHwgJyc7XHJcbiAgICBjb25zdCBjb2RlID0gYmxvY2sudGV4dCB8fCBibG9jay5jb250ZW50IHx8IGJsb2NrLmNvZGUgfHwgJyc7XHJcbiAgICByZXR1cm4gYFxcYFxcYFxcYCR7bGFuZ3VhZ2V9XFxuJHtjb2RlfVxcblxcYFxcYFxcYGA7XHJcbiAgfVxyXG4gIFxyXG4gIC8qKlxyXG4gICAqIFByb2Nlc3MgcXVvdGUgYmxvY2tcclxuICAgKiBAcGFyYW0ge09iamVjdH0gYmxvY2sgLSBRdW90ZSBibG9ja1xyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IE1hcmtkb3duIHF1b3RlXHJcbiAgICovXHJcbiAgcHJvY2Vzc1F1b3RlKGJsb2NrKSB7XHJcbiAgICBjb25zdCB0ZXh0ID0gYmxvY2sudGV4dCB8fCBibG9jay5jb250ZW50IHx8ICcnO1xyXG4gICAgLy8gU3BsaXQgYnkgbmV3bGluZXMgYW5kIGFkZCA+IHRvIGVhY2ggbGluZVxyXG4gICAgcmV0dXJuIHRleHQuc3BsaXQoJ1xcbicpLm1hcChsaW5lID0+IGA+ICR7bGluZX1gKS5qb2luKCdcXG4nKTtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gT2NyUHJvY2Vzc29yOyJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxZQUFZLENBQUM7RUFDakJDLFdBQVdBLENBQUEsRUFBRztJQUNaO0VBQUE7O0VBR0Y7QUFDRjtBQUNBO0FBQ0E7QUFDQTtFQUNFQyxhQUFhQSxDQUFDQyxNQUFNLEVBQUU7SUFDcEJDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHNDQUFzQyxDQUFDO0lBRW5ELElBQUk7TUFDRixJQUFJLENBQUNGLE1BQU0sRUFBRTtRQUNYLE1BQU0sSUFBSUcsS0FBSyxDQUFDLDJCQUEyQixDQUFDO01BQzlDOztNQUVBO01BQ0FGLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHNDQUFzQyxFQUNoREUsTUFBTSxDQUFDQyxJQUFJLENBQUNMLE1BQU0sQ0FBQyxDQUFDTSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7O01BRWpDO01BQ0EsTUFBTUMsWUFBWSxHQUFHO1FBQ25CQyxLQUFLLEVBQUVSLE1BQU0sQ0FBQ1EsS0FBSyxJQUFJLFNBQVM7UUFDaENDLFFBQVEsRUFBRVQsTUFBTSxDQUFDUyxRQUFRLElBQUksU0FBUztRQUN0Q0MsY0FBYyxFQUFFVixNQUFNLENBQUNXLGVBQWUsSUFBSSxDQUFDO1FBQzNDQyxpQkFBaUIsRUFBRVosTUFBTSxDQUFDYSxVQUFVLElBQUksQ0FBQztRQUN6Q0MsS0FBSyxFQUFFZCxNQUFNLENBQUNjLEtBQUssSUFBSTtNQUN6QixDQUFDOztNQUVEO01BQ0EsSUFBSUMsS0FBSyxHQUFHLElBQUksQ0FBQ0MsYUFBYSxDQUFDaEIsTUFBTSxDQUFDO01BRXRDQyxPQUFPLENBQUNDLEdBQUcsQ0FBQyw2QkFBNkJhLEtBQUssQ0FBQ0UsTUFBTSx3QkFBd0IsQ0FBQztNQUU5RSxNQUFNQyxjQUFjLEdBQUdILEtBQUssQ0FBQ0ksR0FBRyxDQUFDLENBQUNDLElBQUksRUFBRUMsS0FBSyxLQUFLLElBQUksQ0FBQ0MsWUFBWSxDQUFDRixJQUFJLEVBQUVDLEtBQUssQ0FBQyxDQUFDO01BRWpGcEIsT0FBTyxDQUFDQyxHQUFHLENBQUMscURBQXFEZ0IsY0FBYyxDQUFDRCxNQUFNLFFBQVEsQ0FBQztNQUUvRixPQUFPO1FBQ0xWLFlBQVk7UUFDWlEsS0FBSyxFQUFFRztNQUNULENBQUM7SUFDSCxDQUFDLENBQUMsT0FBT0ssS0FBSyxFQUFFO01BQ2R0QixPQUFPLENBQUNzQixLQUFLLENBQUMsNkNBQTZDLEVBQUVBLEtBQUssQ0FBQzs7TUFFbkU7TUFDQXRCLE9BQU8sQ0FBQ3NCLEtBQUssQ0FBQyw4Q0FBOEMsRUFDMUR2QixNQUFNLEdBQUd3QixJQUFJLENBQUNDLFNBQVMsQ0FBQ3pCLE1BQU0sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMwQixTQUFTLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxHQUFHLEtBQUssR0FBRyxXQUFXLENBQUM7O01BRW5GO01BQ0EsT0FBTyxJQUFJLENBQUNDLHFCQUFxQixDQUFDM0IsTUFBTSxFQUFFdUIsS0FBSyxDQUFDO0lBQ2xEO0VBQ0Y7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0VQLGFBQWFBLENBQUNoQixNQUFNLEVBQUU7SUFDcEI7SUFDQSxJQUFJQSxNQUFNLENBQUNlLEtBQUssSUFBSWEsS0FBSyxDQUFDQyxPQUFPLENBQUM3QixNQUFNLENBQUNlLEtBQUssQ0FBQyxFQUFFO01BQy9DO01BQ0EsT0FBT2YsTUFBTSxDQUFDZSxLQUFLO0lBQ3JCLENBQUMsTUFBTSxJQUFJZixNQUFNLENBQUM4QixJQUFJLElBQUlGLEtBQUssQ0FBQ0MsT0FBTyxDQUFDN0IsTUFBTSxDQUFDOEIsSUFBSSxDQUFDLEVBQUU7TUFDcEQ7TUFDQSxPQUFPOUIsTUFBTSxDQUFDOEIsSUFBSTtJQUNwQixDQUFDLE1BQU0sSUFBSTlCLE1BQU0sQ0FBQytCLE9BQU8sSUFBSSxPQUFPL0IsTUFBTSxDQUFDK0IsT0FBTyxLQUFLLFFBQVEsRUFBRTtNQUMvRDtNQUNBLE9BQU8sQ0FBQztRQUNOQyxXQUFXLEVBQUUsQ0FBQztRQUNkQyxJQUFJLEVBQUVqQyxNQUFNLENBQUMrQixPQUFPO1FBQ3BCbEIsVUFBVSxFQUFFYixNQUFNLENBQUNhLFVBQVUsSUFBSTtNQUNuQyxDQUFDLENBQUM7SUFDSixDQUFDLE1BQU0sSUFBSWIsTUFBTSxDQUFDaUMsSUFBSSxJQUFJLE9BQU9qQyxNQUFNLENBQUNpQyxJQUFJLEtBQUssUUFBUSxFQUFFO01BQ3pEO01BQ0EsT0FBTyxDQUFDO1FBQ05ELFdBQVcsRUFBRSxDQUFDO1FBQ2RDLElBQUksRUFBRWpDLE1BQU0sQ0FBQ2lDLElBQUk7UUFDakJwQixVQUFVLEVBQUViLE1BQU0sQ0FBQ2EsVUFBVSxJQUFJO01BQ25DLENBQUMsQ0FBQztJQUNKOztJQUVBO0lBQ0EsT0FBTyxFQUFFO0VBQ1g7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDRVMsWUFBWUEsQ0FBQ0YsSUFBSSxFQUFFQyxLQUFLLEVBQUU7SUFDeEI7SUFDQSxNQUFNYSxVQUFVLEdBQUdkLElBQUksQ0FBQ1ksV0FBVyxJQUFJWixJQUFJLENBQUNjLFVBQVUsSUFBSWIsS0FBSyxHQUFHLENBQUM7SUFDbkUsTUFBTWMsYUFBYSxHQUFHO01BQ3BCRCxVQUFVO01BQ1ZyQixVQUFVLEVBQUVPLElBQUksQ0FBQ1AsVUFBVSxJQUFJLENBQUM7TUFDaEN1QixLQUFLLEVBQUVoQixJQUFJLENBQUNnQixLQUFLLElBQUloQixJQUFJLENBQUNpQixVQUFVLEVBQUVELEtBQUssSUFBSSxDQUFDO01BQ2hERSxNQUFNLEVBQUVsQixJQUFJLENBQUNrQixNQUFNLElBQUlsQixJQUFJLENBQUNpQixVQUFVLEVBQUVDLE1BQU0sSUFBSSxDQUFDO01BQ25ETCxJQUFJLEVBQUU7SUFDUixDQUFDOztJQUVEO0lBQ0EsSUFBSWIsSUFBSSxDQUFDbUIsTUFBTSxJQUFJWCxLQUFLLENBQUNDLE9BQU8sQ0FBQ1QsSUFBSSxDQUFDbUIsTUFBTSxDQUFDLEVBQUU7TUFDN0M7TUFDQSxNQUFNQyxVQUFVLEdBQUcsSUFBSSxDQUFDQyxvQkFBb0IsQ0FBQ3JCLElBQUksQ0FBQ21CLE1BQU0sQ0FBQztNQUN6REosYUFBYSxDQUFDRixJQUFJLEdBQUdPLFVBQVUsQ0FBQ2xDLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDOUMsQ0FBQyxNQUFNLElBQUljLElBQUksQ0FBQ3NCLFFBQVEsSUFBSWQsS0FBSyxDQUFDQyxPQUFPLENBQUNULElBQUksQ0FBQ3NCLFFBQVEsQ0FBQyxFQUFFO01BQ3hEO01BQ0EsTUFBTUEsUUFBUSxHQUFHdEIsSUFBSSxDQUFDc0IsUUFBUSxDQUFDdkIsR0FBRyxDQUFDd0IsT0FBTyxJQUFJO1FBQzVDLElBQUlBLE9BQU8sQ0FBQ0MsSUFBSSxLQUFLLE1BQU0sSUFBSUQsT0FBTyxDQUFDVixJQUFJLEVBQUU7VUFDM0MsT0FBT1UsT0FBTyxDQUFDVixJQUFJO1FBQ3JCLENBQUMsTUFBTSxJQUFJVSxPQUFPLENBQUNaLE9BQU8sRUFBRTtVQUMxQixPQUFPWSxPQUFPLENBQUNaLE9BQU87UUFDeEI7UUFDQSxPQUFPLEVBQUU7TUFDWCxDQUFDLENBQUMsQ0FBQ2MsTUFBTSxDQUFDWixJQUFJLElBQUlBLElBQUksQ0FBQ2EsSUFBSSxDQUFDLENBQUMsQ0FBQzdCLE1BQU0sR0FBRyxDQUFDLENBQUM7TUFFekNrQixhQUFhLENBQUNGLElBQUksR0FBR1MsUUFBUSxDQUFDcEMsSUFBSSxDQUFDLE1BQU0sQ0FBQztJQUM1QyxDQUFDLE1BQU0sSUFBSWMsSUFBSSxDQUFDVyxPQUFPLElBQUksT0FBT1gsSUFBSSxDQUFDVyxPQUFPLEtBQUssUUFBUSxFQUFFO01BQzNEO01BQ0FJLGFBQWEsQ0FBQ0YsSUFBSSxHQUFHYixJQUFJLENBQUNXLE9BQU87SUFDbkMsQ0FBQyxNQUFNLElBQUlYLElBQUksQ0FBQ2EsSUFBSSxFQUFFO01BQ3BCO01BQ0FFLGFBQWEsQ0FBQ0YsSUFBSSxHQUFHYixJQUFJLENBQUNhLElBQUk7SUFDaEM7SUFFQSxPQUFPRSxhQUFhO0VBQ3RCOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0VSLHFCQUFxQkEsQ0FBQzNCLE1BQU0sRUFBRXVCLEtBQUssRUFBRTtJQUNuQyxJQUFJUixLQUFLLEdBQUcsRUFBRTtJQUVkLElBQUk7TUFDRjtNQUNBLElBQUlmLE1BQU0sSUFBSUEsTUFBTSxDQUFDZSxLQUFLLElBQUlhLEtBQUssQ0FBQ0MsT0FBTyxDQUFDN0IsTUFBTSxDQUFDZSxLQUFLLENBQUMsRUFBRTtRQUN6REEsS0FBSyxHQUFHZixNQUFNLENBQUNlLEtBQUs7TUFDdEIsQ0FBQyxNQUFNLElBQUlmLE1BQU0sSUFBSUEsTUFBTSxDQUFDOEIsSUFBSSxJQUFJRixLQUFLLENBQUNDLE9BQU8sQ0FBQzdCLE1BQU0sQ0FBQzhCLElBQUksQ0FBQyxFQUFFO1FBQzlEZixLQUFLLEdBQUdmLE1BQU0sQ0FBQzhCLElBQUk7TUFDckIsQ0FBQyxNQUFNLElBQUk5QixNQUFNLElBQUksT0FBT0EsTUFBTSxLQUFLLFFBQVEsRUFBRTtRQUMvQztRQUNBZSxLQUFLLEdBQUcsQ0FBQztVQUFFa0IsSUFBSSxFQUFFakM7UUFBTyxDQUFDLENBQUM7TUFDNUIsQ0FBQyxNQUFNLElBQUlBLE1BQU0sSUFBSUEsTUFBTSxDQUFDaUMsSUFBSSxJQUFJLE9BQU9qQyxNQUFNLENBQUNpQyxJQUFJLEtBQUssUUFBUSxFQUFFO1FBQ25FbEIsS0FBSyxHQUFHLENBQUM7VUFBRWtCLElBQUksRUFBRWpDLE1BQU0sQ0FBQ2lDO1FBQUssQ0FBQyxDQUFDO01BQ2pDO0lBQ0YsQ0FBQyxDQUFDLE9BQU9jLGFBQWEsRUFBRTtNQUN0QjlDLE9BQU8sQ0FBQ3NCLEtBQUssQ0FBQyxpREFBaUQsRUFBRXdCLGFBQWEsQ0FBQztNQUMvRWhDLEtBQUssR0FBRyxFQUFFO0lBQ1o7SUFFQSxPQUFPO01BQ0xSLFlBQVksRUFBRTtRQUNaQyxLQUFLLEVBQUVSLE1BQU0sRUFBRVEsS0FBSyxJQUFJLFNBQVM7UUFDakNDLFFBQVEsRUFBRVQsTUFBTSxFQUFFUyxRQUFRLElBQUksU0FBUztRQUN2Q2MsS0FBSyxFQUFFQSxLQUFLLENBQUN5QjtNQUNmLENBQUM7TUFDRGpDLEtBQUssRUFBRUEsS0FBSyxDQUFDSSxHQUFHLENBQUMsQ0FBQ0MsSUFBSSxFQUFFQyxLQUFLLE1BQU07UUFDakNhLFVBQVUsRUFBRWQsSUFBSSxDQUFDWSxXQUFXLElBQUlaLElBQUksQ0FBQ2MsVUFBVSxJQUFJYixLQUFLLEdBQUcsQ0FBQztRQUM1RFksSUFBSSxFQUFFYixJQUFJLENBQUNhLElBQUksSUFBSWIsSUFBSSxDQUFDVyxPQUFPLElBQUksRUFBRTtRQUNyQ2xCLFVBQVUsRUFBRU8sSUFBSSxDQUFDUCxVQUFVLElBQUk7TUFDakMsQ0FBQyxDQUFDO0lBQ0osQ0FBQztFQUNIOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7RUFDRTRCLG9CQUFvQkEsQ0FBQ0YsTUFBTSxFQUFFO0lBQzNCLElBQUksQ0FBQ1gsS0FBSyxDQUFDQyxPQUFPLENBQUNVLE1BQU0sQ0FBQyxJQUFJQSxNQUFNLENBQUN0QixNQUFNLEtBQUssQ0FBQyxFQUFFO01BQ2pELE9BQU8sRUFBRTtJQUNYO0lBRUEsT0FBT3NCLE1BQU0sQ0FBQ3BCLEdBQUcsQ0FBQzhCLEtBQUssSUFBSTtNQUN6QixJQUFJO1FBQ0Y7UUFDQSxJQUFJLE9BQU9BLEtBQUssS0FBSyxRQUFRLEVBQUU7VUFDN0IsT0FBT0EsS0FBSztRQUNkOztRQUVBO1FBQ0EsSUFBSSxDQUFDQSxLQUFLLENBQUNMLElBQUksSUFBSUssS0FBSyxDQUFDaEIsSUFBSSxFQUFFO1VBQzdCLE9BQU9nQixLQUFLLENBQUNoQixJQUFJO1FBQ25COztRQUVBO1FBQ0EsUUFBUWdCLEtBQUssQ0FBQ0wsSUFBSSxFQUFFTSxXQUFXLENBQUMsQ0FBQztVQUMvQixLQUFLLFNBQVM7WUFDWixPQUFPLElBQUksQ0FBQ0MsY0FBYyxDQUFDRixLQUFLLENBQUM7VUFDbkMsS0FBSyxXQUFXO1VBQ2hCLEtBQUssTUFBTTtZQUNULE9BQU8sSUFBSSxDQUFDRyxnQkFBZ0IsQ0FBQ0gsS0FBSyxDQUFDO1VBQ3JDLEtBQUssTUFBTTtVQUNYLEtBQUssYUFBYTtVQUNsQixLQUFLLGVBQWU7WUFDbEIsT0FBTyxJQUFJLENBQUNJLFdBQVcsQ0FBQ0osS0FBSyxDQUFDO1VBQ2hDLEtBQUssT0FBTztZQUNWLE9BQU8sSUFBSSxDQUFDSyxZQUFZLENBQUNMLEtBQUssQ0FBQztVQUNqQyxLQUFLLE9BQU87VUFDWixLQUFLLFFBQVE7WUFDWCxPQUFPLElBQUksQ0FBQ00sWUFBWSxDQUFDTixLQUFLLENBQUM7VUFDakMsS0FBSyxNQUFNO1VBQ1gsS0FBSyxZQUFZO1lBQ2YsT0FBTyxJQUFJLENBQUNPLGdCQUFnQixDQUFDUCxLQUFLLENBQUM7VUFDckMsS0FBSyxPQUFPO1VBQ1osS0FBSyxZQUFZO1lBQ2YsT0FBTyxJQUFJLENBQUNRLFlBQVksQ0FBQ1IsS0FBSyxDQUFDO1VBQ2pDO1lBQ0U7WUFDQSxPQUFPQSxLQUFLLENBQUNoQixJQUFJLElBQUlnQixLQUFLLENBQUNsQixPQUFPLElBQUksRUFBRTtRQUM1QztNQUNGLENBQUMsQ0FBQyxPQUFPUixLQUFLLEVBQUU7UUFDZHRCLE9BQU8sQ0FBQ3NCLEtBQUssQ0FBQyxnREFBZ0QsRUFBRUEsS0FBSyxDQUFDO1FBQ3RFO1FBQ0EsT0FBTyxFQUFFO01BQ1g7SUFDRixDQUFDLENBQUMsQ0FBQ3NCLE1BQU0sQ0FBQ1osSUFBSSxJQUFJQSxJQUFJLENBQUNhLElBQUksQ0FBQyxDQUFDLENBQUM3QixNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztFQUM3Qzs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VrQyxjQUFjQSxDQUFDRixLQUFLLEVBQUU7SUFDcEIsTUFBTVMsS0FBSyxHQUFHVCxLQUFLLENBQUNTLEtBQUssSUFBSSxDQUFDO0lBQzlCLE1BQU1DLGNBQWMsR0FBRyxHQUFHLENBQUNDLE1BQU0sQ0FBQ0MsSUFBSSxDQUFDQyxHQUFHLENBQUNKLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQztJQUNyRCxPQUFPLEdBQUdDLGNBQWMsSUFBSVYsS0FBSyxDQUFDaEIsSUFBSSxJQUFJLEVBQUUsRUFBRTtFQUNoRDs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VtQixnQkFBZ0JBLENBQUNILEtBQUssRUFBRTtJQUN0QixPQUFPQSxLQUFLLENBQUNoQixJQUFJLElBQUksRUFBRTtFQUN6Qjs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VvQixXQUFXQSxDQUFDSixLQUFLLEVBQUU7SUFDakIsSUFBSSxDQUFDQSxLQUFLLENBQUNjLEtBQUssSUFBSSxDQUFDbkMsS0FBSyxDQUFDQyxPQUFPLENBQUNvQixLQUFLLENBQUNjLEtBQUssQ0FBQyxJQUFJZCxLQUFLLENBQUNjLEtBQUssQ0FBQzlDLE1BQU0sS0FBSyxDQUFDLEVBQUU7TUFDM0UsT0FBTyxFQUFFO0lBQ1g7SUFFQSxNQUFNK0MsUUFBUSxHQUFHZixLQUFLLENBQUNnQixPQUFPLEdBQUcsU0FBUyxHQUFHLFdBQVc7SUFFeEQsT0FBT2hCLEtBQUssQ0FBQ2MsS0FBSyxDQUFDNUMsR0FBRyxDQUFDLENBQUMrQyxJQUFJLEVBQUU3QyxLQUFLLEtBQUs7TUFDdEMsSUFBSTJDLFFBQVEsS0FBSyxTQUFTLEVBQUU7UUFDMUIsT0FBTyxHQUFHM0MsS0FBSyxHQUFHLENBQUMsS0FBSzZDLElBQUksQ0FBQ2pDLElBQUksSUFBSSxFQUFFLEVBQUU7TUFDM0MsQ0FBQyxNQUFNO1FBQ0wsT0FBTyxLQUFLaUMsSUFBSSxDQUFDakMsSUFBSSxJQUFJLEVBQUUsRUFBRTtNQUMvQjtJQUNGLENBQUMsQ0FBQyxDQUFDM0IsSUFBSSxDQUFDLElBQUksQ0FBQztFQUNmOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7RUFDRWdELFlBQVlBLENBQUNMLEtBQUssRUFBRTtJQUNsQixJQUFJLENBQUNBLEtBQUssQ0FBQ2tCLElBQUksSUFBSSxDQUFDdkMsS0FBSyxDQUFDQyxPQUFPLENBQUNvQixLQUFLLENBQUNrQixJQUFJLENBQUMsSUFBSWxCLEtBQUssQ0FBQ2tCLElBQUksQ0FBQ2xELE1BQU0sS0FBSyxDQUFDLEVBQUU7TUFDeEUsT0FBTyxFQUFFO0lBQ1g7SUFFQSxNQUFNbUQsU0FBUyxHQUFHbkIsS0FBSyxDQUFDa0IsSUFBSSxDQUFDaEQsR0FBRyxDQUFDa0QsR0FBRyxJQUFJO01BQ3RDLElBQUksQ0FBQ0EsR0FBRyxDQUFDQyxLQUFLLElBQUksQ0FBQzFDLEtBQUssQ0FBQ0MsT0FBTyxDQUFDd0MsR0FBRyxDQUFDQyxLQUFLLENBQUMsRUFBRTtRQUMzQyxPQUFPLEtBQUs7TUFDZDtNQUVBLE1BQU1BLEtBQUssR0FBR0QsR0FBRyxDQUFDQyxLQUFLLENBQUNuRCxHQUFHLENBQUNvRCxJQUFJLElBQUlBLElBQUksQ0FBQ3RDLElBQUksSUFBSSxFQUFFLENBQUMsQ0FBQzNCLElBQUksQ0FBQyxLQUFLLENBQUM7TUFDaEUsT0FBTyxLQUFLZ0UsS0FBSyxJQUFJO0lBQ3ZCLENBQUMsQ0FBQzs7SUFFRjtJQUNBLElBQUlGLFNBQVMsQ0FBQ25ELE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFDeEIsTUFBTXVELFNBQVMsR0FBR0osU0FBUyxDQUFDLENBQUMsQ0FBQztNQUM5QixNQUFNSyxjQUFjLEdBQUcsQ0FBQ0QsU0FBUyxDQUFDRSxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxFQUFFekQsTUFBTSxHQUFHLENBQUM7TUFDaEUsTUFBTTBELFNBQVMsR0FBRyxJQUFJLFFBQVEsQ0FBQ2YsTUFBTSxDQUFDYSxjQUFjLENBQUMsRUFBRTtNQUN2REwsU0FBUyxDQUFDUSxNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRUQsU0FBUyxDQUFDO0lBQ25DO0lBRUEsT0FBT1AsU0FBUyxDQUFDOUQsSUFBSSxDQUFDLElBQUksQ0FBQztFQUM3Qjs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VpRCxZQUFZQSxDQUFDTixLQUFLLEVBQUU7SUFDbEIsTUFBTTRCLE9BQU8sR0FBRzVCLEtBQUssQ0FBQzRCLE9BQU8sSUFBSTVCLEtBQUssQ0FBQzZCLEdBQUcsSUFBSSxPQUFPO0lBQ3JELE1BQU1DLE1BQU0sR0FBRzlCLEtBQUssQ0FBQytCLEdBQUcsSUFBSS9CLEtBQUssQ0FBQzhCLE1BQU0sSUFBSTlCLEtBQUssQ0FBQ2dDLEdBQUcsSUFBSSxpQkFBaUI7SUFDMUUsT0FBTyxLQUFLSixPQUFPLEtBQUtFLE1BQU0sR0FBRztFQUNuQzs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0V2QixnQkFBZ0JBLENBQUNQLEtBQUssRUFBRTtJQUN0QixNQUFNeEMsUUFBUSxHQUFHd0MsS0FBSyxDQUFDeEMsUUFBUSxJQUFJLEVBQUU7SUFDckMsTUFBTXlFLElBQUksR0FBR2pDLEtBQUssQ0FBQ2hCLElBQUksSUFBSWdCLEtBQUssQ0FBQ2xCLE9BQU8sSUFBSWtCLEtBQUssQ0FBQ2lDLElBQUksSUFBSSxFQUFFO0lBQzVELE9BQU8sU0FBU3pFLFFBQVEsS0FBS3lFLElBQUksVUFBVTtFQUM3Qzs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0V6QixZQUFZQSxDQUFDUixLQUFLLEVBQUU7SUFDbEIsTUFBTWhCLElBQUksR0FBR2dCLEtBQUssQ0FBQ2hCLElBQUksSUFBSWdCLEtBQUssQ0FBQ2xCLE9BQU8sSUFBSSxFQUFFO0lBQzlDO0lBQ0EsT0FBT0UsSUFBSSxDQUFDa0QsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDaEUsR0FBRyxDQUFDaUUsSUFBSSxJQUFJLEtBQUtBLElBQUksRUFBRSxDQUFDLENBQUM5RSxJQUFJLENBQUMsSUFBSSxDQUFDO0VBQzdEO0FBQ0Y7QUFFQStFLE1BQU0sQ0FBQ0MsT0FBTyxHQUFHekYsWUFBWSIsImlnbm9yZUxpc3QiOltdfQ==