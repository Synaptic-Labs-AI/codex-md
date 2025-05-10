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

      // Enhanced logging for debugging the API response structure
      console.log('[OcrProcessor] OCR result structure:', Object.keys(result).join(', '));

      // Log detailed information about usage_info if available
      if (result.usage_info) {
        console.log('[OcrProcessor] Usage info:', JSON.stringify(result.usage_info));
      }

      // Log model information
      console.log('[OcrProcessor] Model:', result.model || 'Not specified');

      // Log first page structure for debugging (up to 500 chars)
      if (result.pages && result.pages.length > 0) {
        const firstPage = result.pages[0];
        console.log('[OcrProcessor] First page keys:', Object.keys(firstPage).join(', '));
        if (firstPage.markdown) {
          console.log('[OcrProcessor] First page markdown sample:', firstPage.markdown.substring(0, 500) + (firstPage.markdown.length > 500 ? '...' : ''));
        }
      }

      // Extract document-level information
      const documentInfo = {
        model: result.model || 'unknown',
        language: result.language || 'unknown',
        processingTime: result.processing_time || 0,
        overallConfidence: result.confidence || 0,
        usage: result.usage_info || result.usage || null
      };

      // Process pages based on Mistral OCR API response format
      let pages = this._extractPages(result);
      console.log(`[OcrProcessor] Processing ${pages.length} pages from OCR result`);
      const processedPages = pages.map((page, index) => this._processPage(page, index));

      // Check if we successfully extracted text from any pages
      const pagesWithText = processedPages.filter(page => page.text && page.text.trim().length > 0);
      console.log(`[OcrProcessor] Successfully extracted text from ${pagesWithText.length} of ${processedPages.length} pages`);
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
      // Standard format with pages array (used by current Mistral API)

      // Log detailed structure of the first page if available (for debugging)
      if (result.pages.length > 0) {
        console.log('[OcrProcessor] Page structure sample:', Object.keys(result.pages[0]).join(', '));
      }
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

    // If no recognized format, try to handle object-like result
    if (typeof result === 'object' && result !== null) {
      console.log('[OcrProcessor] No standard pages array found, attempting to create a fallback page');

      // Create a single page from whatever data we can find
      const fallbackPage = {
        page_number: 1,
        confidence: 0
      };

      // Try to find text content in common locations
      if (result.markdown && typeof result.markdown === 'string') {
        fallbackPage.markdown = result.markdown;
      } else if (result.text && typeof result.text === 'string') {
        fallbackPage.text = result.text;
      } else if (result.content && typeof result.content === 'string') {
        fallbackPage.content = result.content;
      }

      // If we found any text content, return as single page
      if (fallbackPage.markdown || fallbackPage.text || fallbackPage.content) {
        console.log('[OcrProcessor] Created fallback page with content');
        return [fallbackPage];
      }
    }

    // If no recognized format, return empty array
    console.log('[OcrProcessor] Could not extract any pages from result');
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
    const pageNumber = page.page_number || page.pageNumber || page.index || index + 1;
    const processedPage = {
      pageNumber,
      confidence: page.confidence || 0,
      // Remove width/height as they're not needed in the final output
      text: ''
    };

    // Handle new Mistral OCR API response format (2024) which uses markdown
    if (page.markdown && typeof page.markdown === 'string' && page.markdown.trim()) {
      processedPage.text = page.markdown.trim();
      console.log(`[OcrProcessor] Using markdown content for page ${pageNumber} (length: ${processedPage.text.length})`);
      return processedPage;
    }

    // Check for raw content first - it's often the most complete
    let rawTextContent = '';

    // Look for raw text in multiple possible locations
    if (page.text && typeof page.text === 'string' && page.text.trim()) {
      rawTextContent = page.text.trim();
    } else if (page.raw_text && typeof page.raw_text === 'string' && page.raw_text.trim()) {
      rawTextContent = page.raw_text.trim();
    } else if (page.content && typeof page.content === 'string' && page.content.trim()) {
      rawTextContent = page.content.trim();
    } else if (page.textContent && typeof page.textContent === 'string' && page.textContent.trim()) {
      rawTextContent = page.textContent.trim();
    }

    // If raw text was found, use it
    if (rawTextContent) {
      processedPage.text = rawTextContent;
      console.log(`[OcrProcessor] Using raw text for page ${pageNumber} (length: ${rawTextContent.length})`);

      // We found usable text, so return the page
      if (processedPage.text.length > 0) {
        return processedPage;
      }
    }

    // If no raw text was found, try structured content
    console.log(`[OcrProcessor] No raw text for page ${pageNumber}, checking structured content`);

    // Process structured content if available
    if (page.blocks && Array.isArray(page.blocks)) {
      // Process blocks (paragraphs, headings, lists, tables, etc.)
      const textBlocks = this.processContentBlocks(page.blocks);
      processedPage.text = textBlocks.join('\n\n');
      console.log(`[OcrProcessor] Extracted ${textBlocks.length} blocks for page ${pageNumber}`);
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
      console.log(`[OcrProcessor] Extracted ${elements.length} elements for page ${pageNumber}`);
    }

    // Check for ocr_text which might be provided in some APIs
    if (!processedPage.text && page.ocr_text && typeof page.ocr_text === 'string' && page.ocr_text.trim()) {
      processedPage.text = page.ocr_text.trim();
      console.log(`[OcrProcessor] Using OCR text for page ${pageNumber}`);
    }

    // If there are lines but no joined text, process the lines
    if (!processedPage.text && page.lines && Array.isArray(page.lines)) {
      const lineTexts = page.lines.map(line => {
        if (typeof line === 'string') {
          return line;
        } else if (line.text) {
          return line.text;
        } else if (line.content) {
          return line.content;
        }
        return '';
      }).filter(line => line.trim().length > 0);
      if (lineTexts.length > 0) {
        processedPage.text = lineTexts.join('\n');
        console.log(`[OcrProcessor] Extracted ${lineTexts.length} lines for page ${pageNumber}`);
      }
    }

    // Check if the page contains any images but no text
    const hasImages = this._checkForImages(page);
    if (hasImages && !processedPage.text) {
      // Mark as potentially an image-only page
      processedPage.isImageOnly = true;
      console.log(`[OcrProcessor] Page ${pageNumber} appears to contain images but no text`);
    }

    // Log completion
    console.log(`[OcrProcessor] Page ${pageNumber} processing complete: ${processedPage.text ? `${processedPage.text.length} chars` : 'no text'}`);
    return processedPage;
  }

  /**
   * Check if a page contains images but no text
   * @param {Object} page - Page data
   * @returns {boolean} Whether the page likely contains images
   * @private
   */
  _checkForImages(page) {
    // Look for image indicators in blocks
    if (page.blocks && Array.isArray(page.blocks)) {
      return page.blocks.some(block => block.type === 'image' || block.type === 'figure' || block.blockType === 'image');
    }

    // Look for image indicators in elements
    if (page.elements && Array.isArray(page.elements)) {
      return page.elements.some(element => element.type === 'image' || element.type === 'figure');
    }

    // Check if page explicitly has images property
    if (page.images && Array.isArray(page.images) && page.images.length > 0) {
      return true;
    }

    // Check if page has hasImages flag
    if (page.hasImages === true) {
      return true;
    }
    return false;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJPY3JQcm9jZXNzb3IiLCJjb25zdHJ1Y3RvciIsInByb2Nlc3NSZXN1bHQiLCJyZXN1bHQiLCJjb25zb2xlIiwibG9nIiwiRXJyb3IiLCJPYmplY3QiLCJrZXlzIiwiam9pbiIsInVzYWdlX2luZm8iLCJKU09OIiwic3RyaW5naWZ5IiwibW9kZWwiLCJwYWdlcyIsImxlbmd0aCIsImZpcnN0UGFnZSIsIm1hcmtkb3duIiwic3Vic3RyaW5nIiwiZG9jdW1lbnRJbmZvIiwibGFuZ3VhZ2UiLCJwcm9jZXNzaW5nVGltZSIsInByb2Nlc3NpbmdfdGltZSIsIm92ZXJhbGxDb25maWRlbmNlIiwiY29uZmlkZW5jZSIsInVzYWdlIiwiX2V4dHJhY3RQYWdlcyIsInByb2Nlc3NlZFBhZ2VzIiwibWFwIiwicGFnZSIsImluZGV4IiwiX3Byb2Nlc3NQYWdlIiwicGFnZXNXaXRoVGV4dCIsImZpbHRlciIsInRleHQiLCJ0cmltIiwiZXJyb3IiLCJfY3JlYXRlRmFsbGJhY2tSZXN1bHQiLCJBcnJheSIsImlzQXJyYXkiLCJkYXRhIiwiY29udGVudCIsInBhZ2VfbnVtYmVyIiwiZmFsbGJhY2tQYWdlIiwicGFnZU51bWJlciIsInByb2Nlc3NlZFBhZ2UiLCJyYXdUZXh0Q29udGVudCIsInJhd190ZXh0IiwidGV4dENvbnRlbnQiLCJibG9ja3MiLCJ0ZXh0QmxvY2tzIiwicHJvY2Vzc0NvbnRlbnRCbG9ja3MiLCJlbGVtZW50cyIsImVsZW1lbnQiLCJ0eXBlIiwib2NyX3RleHQiLCJsaW5lcyIsImxpbmVUZXh0cyIsImxpbmUiLCJoYXNJbWFnZXMiLCJfY2hlY2tGb3JJbWFnZXMiLCJpc0ltYWdlT25seSIsInNvbWUiLCJibG9jayIsImJsb2NrVHlwZSIsImltYWdlcyIsImZhbGxiYWNrRXJyb3IiLCJtZXNzYWdlIiwidG9Mb3dlckNhc2UiLCJwcm9jZXNzSGVhZGluZyIsInByb2Nlc3NQYXJhZ3JhcGgiLCJwcm9jZXNzTGlzdCIsInByb2Nlc3NUYWJsZSIsInByb2Nlc3NJbWFnZSIsInByb2Nlc3NDb2RlQmxvY2siLCJwcm9jZXNzUXVvdGUiLCJsZXZlbCIsImhlYWRpbmdNYXJrZXJzIiwicmVwZWF0IiwiTWF0aCIsIm1pbiIsIml0ZW1zIiwibGlzdFR5cGUiLCJvcmRlcmVkIiwiaXRlbSIsInJvd3MiLCJ0YWJsZVJvd3MiLCJyb3ciLCJjZWxscyIsImNlbGwiLCJoZWFkZXJSb3ciLCJzZXBhcmF0b3JDb3VudCIsIm1hdGNoIiwic2VwYXJhdG9yIiwic3BsaWNlIiwiY2FwdGlvbiIsImFsdCIsInNvdXJjZSIsInNyYyIsInVybCIsImNvZGUiLCJzcGxpdCIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9taXN0cmFsL09jclByb2Nlc3Nvci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogT2NyUHJvY2Vzc29yLmpzXHJcbiAqIFByb2Nlc3NlcyBPQ1IgcmVzdWx0cyBmcm9tIE1pc3RyYWwgQVBJIGFuZCBjb252ZXJ0cyB0aGVtIHRvIHN0cnVjdHVyZWQgZGF0YVxyXG4gKi9cclxuXHJcbmNsYXNzIE9jclByb2Nlc3NvciB7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICAvLyBJbml0aWFsaXplIHByb2Nlc3NvclxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUHJvY2VzcyBPQ1IgcmVzdWx0IGZyb20gTWlzdHJhbCBBUElcclxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVzdWx0IC0gUmF3IE9DUiBBUEkgcmVzdWx0XHJcbiAgICogQHJldHVybnMge09iamVjdH0gUHJvY2Vzc2VkIHJlc3VsdCB3aXRoIHN0cnVjdHVyZWQgY29udGVudFxyXG4gICAqL1xyXG4gIHByb2Nlc3NSZXN1bHQocmVzdWx0KSB7XHJcbiAgICBjb25zb2xlLmxvZygnW09jclByb2Nlc3Nvcl0gUHJvY2Vzc2luZyBPQ1IgcmVzdWx0Jyk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgaWYgKCFyZXN1bHQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0VtcHR5IE9DUiByZXN1bHQgcmVjZWl2ZWQnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gRW5oYW5jZWQgbG9nZ2luZyBmb3IgZGVidWdnaW5nIHRoZSBBUEkgcmVzcG9uc2Ugc3RydWN0dXJlXHJcbiAgICAgIGNvbnNvbGUubG9nKCdbT2NyUHJvY2Vzc29yXSBPQ1IgcmVzdWx0IHN0cnVjdHVyZTonLFxyXG4gICAgICAgIE9iamVjdC5rZXlzKHJlc3VsdCkuam9pbignLCAnKSk7XHJcblxyXG4gICAgICAvLyBMb2cgZGV0YWlsZWQgaW5mb3JtYXRpb24gYWJvdXQgdXNhZ2VfaW5mbyBpZiBhdmFpbGFibGVcclxuICAgICAgaWYgKHJlc3VsdC51c2FnZV9pbmZvKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1tPY3JQcm9jZXNzb3JdIFVzYWdlIGluZm86JywgSlNPTi5zdHJpbmdpZnkocmVzdWx0LnVzYWdlX2luZm8pKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gTG9nIG1vZGVsIGluZm9ybWF0aW9uXHJcbiAgICAgIGNvbnNvbGUubG9nKCdbT2NyUHJvY2Vzc29yXSBNb2RlbDonLCByZXN1bHQubW9kZWwgfHwgJ05vdCBzcGVjaWZpZWQnKTtcclxuXHJcbiAgICAgIC8vIExvZyBmaXJzdCBwYWdlIHN0cnVjdHVyZSBmb3IgZGVidWdnaW5nICh1cCB0byA1MDAgY2hhcnMpXHJcbiAgICAgIGlmIChyZXN1bHQucGFnZXMgJiYgcmVzdWx0LnBhZ2VzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zdCBmaXJzdFBhZ2UgPSByZXN1bHQucGFnZXNbMF07XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1tPY3JQcm9jZXNzb3JdIEZpcnN0IHBhZ2Uga2V5czonLCBPYmplY3Qua2V5cyhmaXJzdFBhZ2UpLmpvaW4oJywgJykpO1xyXG5cclxuICAgICAgICBpZiAoZmlyc3RQYWdlLm1hcmtkb3duKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZygnW09jclByb2Nlc3Nvcl0gRmlyc3QgcGFnZSBtYXJrZG93biBzYW1wbGU6JyxcclxuICAgICAgICAgICAgZmlyc3RQYWdlLm1hcmtkb3duLnN1YnN0cmluZygwLCA1MDApICsgKGZpcnN0UGFnZS5tYXJrZG93bi5sZW5ndGggPiA1MDAgPyAnLi4uJyA6ICcnKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBFeHRyYWN0IGRvY3VtZW50LWxldmVsIGluZm9ybWF0aW9uXHJcbiAgICAgIGNvbnN0IGRvY3VtZW50SW5mbyA9IHtcclxuICAgICAgICBtb2RlbDogcmVzdWx0Lm1vZGVsIHx8ICd1bmtub3duJyxcclxuICAgICAgICBsYW5ndWFnZTogcmVzdWx0Lmxhbmd1YWdlIHx8ICd1bmtub3duJyxcclxuICAgICAgICBwcm9jZXNzaW5nVGltZTogcmVzdWx0LnByb2Nlc3NpbmdfdGltZSB8fCAwLFxyXG4gICAgICAgIG92ZXJhbGxDb25maWRlbmNlOiByZXN1bHQuY29uZmlkZW5jZSB8fCAwLFxyXG4gICAgICAgIHVzYWdlOiByZXN1bHQudXNhZ2VfaW5mbyB8fCByZXN1bHQudXNhZ2UgfHwgbnVsbFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgLy8gUHJvY2VzcyBwYWdlcyBiYXNlZCBvbiBNaXN0cmFsIE9DUiBBUEkgcmVzcG9uc2UgZm9ybWF0XHJcbiAgICAgIGxldCBwYWdlcyA9IHRoaXMuX2V4dHJhY3RQYWdlcyhyZXN1bHQpO1xyXG5cclxuICAgICAgY29uc29sZS5sb2coYFtPY3JQcm9jZXNzb3JdIFByb2Nlc3NpbmcgJHtwYWdlcy5sZW5ndGh9IHBhZ2VzIGZyb20gT0NSIHJlc3VsdGApO1xyXG5cclxuICAgICAgY29uc3QgcHJvY2Vzc2VkUGFnZXMgPSBwYWdlcy5tYXAoKHBhZ2UsIGluZGV4KSA9PiB0aGlzLl9wcm9jZXNzUGFnZShwYWdlLCBpbmRleCkpO1xyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgd2Ugc3VjY2Vzc2Z1bGx5IGV4dHJhY3RlZCB0ZXh0IGZyb20gYW55IHBhZ2VzXHJcbiAgICAgIGNvbnN0IHBhZ2VzV2l0aFRleHQgPSBwcm9jZXNzZWRQYWdlcy5maWx0ZXIocGFnZSA9PiBwYWdlLnRleHQgJiYgcGFnZS50ZXh0LnRyaW0oKS5sZW5ndGggPiAwKTtcclxuICAgICAgY29uc29sZS5sb2coYFtPY3JQcm9jZXNzb3JdIFN1Y2Nlc3NmdWxseSBleHRyYWN0ZWQgdGV4dCBmcm9tICR7cGFnZXNXaXRoVGV4dC5sZW5ndGh9IG9mICR7cHJvY2Vzc2VkUGFnZXMubGVuZ3RofSBwYWdlc2ApO1xyXG5cclxuICAgICAgY29uc29sZS5sb2coYFtPY3JQcm9jZXNzb3JdIE9DUiByZXN1bHQgcHJvY2Vzc2luZyBjb21wbGV0ZSBmb3IgJHtwcm9jZXNzZWRQYWdlcy5sZW5ndGh9IHBhZ2VzYCk7XHJcblxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIGRvY3VtZW50SW5mbyxcclxuICAgICAgICBwYWdlczogcHJvY2Vzc2VkUGFnZXNcclxuICAgICAgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tPY3JQcm9jZXNzb3JdIEVycm9yIHByb2Nlc3NpbmcgT0NSIHJlc3VsdDonLCBlcnJvcik7XHJcblxyXG4gICAgICAvLyBQcm92aWRlIGRldGFpbGVkIGVycm9yIGluZm9ybWF0aW9uXHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tPY3JQcm9jZXNzb3JdIE9DUiByZXN1bHQgdGhhdCBjYXVzZWQgZXJyb3I6JyxcclxuICAgICAgICByZXN1bHQgPyBKU09OLnN0cmluZ2lmeShyZXN1bHQsIG51bGwsIDIpLnN1YnN0cmluZygwLCA1MDApICsgJy4uLicgOiAndW5kZWZpbmVkJyk7XHJcblxyXG4gICAgICAvLyBGYWxsYmFjayB0byBiYXNpYyBwcm9jZXNzaW5nIGlmIGFuIGVycm9yIG9jY3Vyc1xyXG4gICAgICByZXR1cm4gdGhpcy5fY3JlYXRlRmFsbGJhY2tSZXN1bHQocmVzdWx0LCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBFeHRyYWN0IHBhZ2VzIGFycmF5IGZyb20gcmVzdWx0IHdpdGggZm9ybWF0IGhhbmRsaW5nXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IHJlc3VsdCAtIE9DUiByZXN1bHRcclxuICAgKiBAcmV0dXJucyB7QXJyYXl9IEFycmF5IG9mIHBhZ2Ugb2JqZWN0c1xyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgX2V4dHJhY3RQYWdlcyhyZXN1bHQpIHtcclxuICAgIC8vIEhhbmRsZSBkaWZmZXJlbnQgcmVzcG9uc2UgZm9ybWF0c1xyXG4gICAgaWYgKHJlc3VsdC5wYWdlcyAmJiBBcnJheS5pc0FycmF5KHJlc3VsdC5wYWdlcykpIHtcclxuICAgICAgLy8gU3RhbmRhcmQgZm9ybWF0IHdpdGggcGFnZXMgYXJyYXkgKHVzZWQgYnkgY3VycmVudCBNaXN0cmFsIEFQSSlcclxuXHJcbiAgICAgIC8vIExvZyBkZXRhaWxlZCBzdHJ1Y3R1cmUgb2YgdGhlIGZpcnN0IHBhZ2UgaWYgYXZhaWxhYmxlIChmb3IgZGVidWdnaW5nKVxyXG4gICAgICBpZiAocmVzdWx0LnBhZ2VzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnW09jclByb2Nlc3Nvcl0gUGFnZSBzdHJ1Y3R1cmUgc2FtcGxlOicsXHJcbiAgICAgICAgICBPYmplY3Qua2V5cyhyZXN1bHQucGFnZXNbMF0pLmpvaW4oJywgJykpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gcmVzdWx0LnBhZ2VzO1xyXG4gICAgfSBlbHNlIGlmIChyZXN1bHQuZGF0YSAmJiBBcnJheS5pc0FycmF5KHJlc3VsdC5kYXRhKSkge1xyXG4gICAgICAvLyBBbHRlcm5hdGl2ZSBmb3JtYXQgd2l0aCBkYXRhIGFycmF5XHJcbiAgICAgIHJldHVybiByZXN1bHQuZGF0YTtcclxuICAgIH0gZWxzZSBpZiAocmVzdWx0LmNvbnRlbnQgJiYgdHlwZW9mIHJlc3VsdC5jb250ZW50ID09PSAnc3RyaW5nJykge1xyXG4gICAgICAvLyBTaW1wbGUgZm9ybWF0IHdpdGgganVzdCBjb250ZW50IHN0cmluZ1xyXG4gICAgICByZXR1cm4gW3tcclxuICAgICAgICBwYWdlX251bWJlcjogMSxcclxuICAgICAgICB0ZXh0OiByZXN1bHQuY29udGVudCxcclxuICAgICAgICBjb25maWRlbmNlOiByZXN1bHQuY29uZmlkZW5jZSB8fCAwXHJcbiAgICAgIH1dO1xyXG4gICAgfSBlbHNlIGlmIChyZXN1bHQudGV4dCAmJiB0eXBlb2YgcmVzdWx0LnRleHQgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIC8vIEFub3RoZXIgc2ltcGxlIGZvcm1hdCB3aXRoIGp1c3QgdGV4dFxyXG4gICAgICByZXR1cm4gW3tcclxuICAgICAgICBwYWdlX251bWJlcjogMSxcclxuICAgICAgICB0ZXh0OiByZXN1bHQudGV4dCxcclxuICAgICAgICBjb25maWRlbmNlOiByZXN1bHQuY29uZmlkZW5jZSB8fCAwXHJcbiAgICAgIH1dO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIElmIG5vIHJlY29nbml6ZWQgZm9ybWF0LCB0cnkgdG8gaGFuZGxlIG9iamVjdC1saWtlIHJlc3VsdFxyXG4gICAgaWYgKHR5cGVvZiByZXN1bHQgPT09ICdvYmplY3QnICYmIHJlc3VsdCAhPT0gbnVsbCkge1xyXG4gICAgICBjb25zb2xlLmxvZygnW09jclByb2Nlc3Nvcl0gTm8gc3RhbmRhcmQgcGFnZXMgYXJyYXkgZm91bmQsIGF0dGVtcHRpbmcgdG8gY3JlYXRlIGEgZmFsbGJhY2sgcGFnZScpO1xyXG5cclxuICAgICAgLy8gQ3JlYXRlIGEgc2luZ2xlIHBhZ2UgZnJvbSB3aGF0ZXZlciBkYXRhIHdlIGNhbiBmaW5kXHJcbiAgICAgIGNvbnN0IGZhbGxiYWNrUGFnZSA9IHtcclxuICAgICAgICBwYWdlX251bWJlcjogMSxcclxuICAgICAgICBjb25maWRlbmNlOiAwXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBUcnkgdG8gZmluZCB0ZXh0IGNvbnRlbnQgaW4gY29tbW9uIGxvY2F0aW9uc1xyXG4gICAgICBpZiAocmVzdWx0Lm1hcmtkb3duICYmIHR5cGVvZiByZXN1bHQubWFya2Rvd24gPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgZmFsbGJhY2tQYWdlLm1hcmtkb3duID0gcmVzdWx0Lm1hcmtkb3duO1xyXG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdC50ZXh0ICYmIHR5cGVvZiByZXN1bHQudGV4dCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICBmYWxsYmFja1BhZ2UudGV4dCA9IHJlc3VsdC50ZXh0O1xyXG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdC5jb250ZW50ICYmIHR5cGVvZiByZXN1bHQuY29udGVudCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICBmYWxsYmFja1BhZ2UuY29udGVudCA9IHJlc3VsdC5jb250ZW50O1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBJZiB3ZSBmb3VuZCBhbnkgdGV4dCBjb250ZW50LCByZXR1cm4gYXMgc2luZ2xlIHBhZ2VcclxuICAgICAgaWYgKGZhbGxiYWNrUGFnZS5tYXJrZG93biB8fCBmYWxsYmFja1BhZ2UudGV4dCB8fCBmYWxsYmFja1BhZ2UuY29udGVudCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdbT2NyUHJvY2Vzc29yXSBDcmVhdGVkIGZhbGxiYWNrIHBhZ2Ugd2l0aCBjb250ZW50Jyk7XHJcbiAgICAgICAgcmV0dXJuIFtmYWxsYmFja1BhZ2VdO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gSWYgbm8gcmVjb2duaXplZCBmb3JtYXQsIHJldHVybiBlbXB0eSBhcnJheVxyXG4gICAgY29uc29sZS5sb2coJ1tPY3JQcm9jZXNzb3JdIENvdWxkIG5vdCBleHRyYWN0IGFueSBwYWdlcyBmcm9tIHJlc3VsdCcpO1xyXG4gICAgcmV0dXJuIFtdO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUHJvY2VzcyBhIHNpbmdsZSBwYWdlXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IHBhZ2UgLSBQYWdlIGRhdGEgZnJvbSBPQ1JcclxuICAgKiBAcGFyYW0ge251bWJlcn0gaW5kZXggLSBQYWdlIGluZGV4IGZvciBmYWxsYmFjayBudW1iZXJpbmdcclxuICAgKiBAcmV0dXJucyB7T2JqZWN0fSBQcm9jZXNzZWQgcGFnZVxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgX3Byb2Nlc3NQYWdlKHBhZ2UsIGluZGV4KSB7XHJcbiAgICAvLyBCYXNpYyBwYWdlIGluZm9ybWF0aW9uIHdpdGggZmFsbGJhY2tzXHJcbiAgICBjb25zdCBwYWdlTnVtYmVyID0gcGFnZS5wYWdlX251bWJlciB8fCBwYWdlLnBhZ2VOdW1iZXIgfHwgcGFnZS5pbmRleCB8fCBpbmRleCArIDE7XHJcbiAgICBjb25zdCBwcm9jZXNzZWRQYWdlID0ge1xyXG4gICAgICBwYWdlTnVtYmVyLFxyXG4gICAgICBjb25maWRlbmNlOiBwYWdlLmNvbmZpZGVuY2UgfHwgMCxcclxuICAgICAgLy8gUmVtb3ZlIHdpZHRoL2hlaWdodCBhcyB0aGV5J3JlIG5vdCBuZWVkZWQgaW4gdGhlIGZpbmFsIG91dHB1dFxyXG4gICAgICB0ZXh0OiAnJ1xyXG4gICAgfTtcclxuXHJcbiAgICAvLyBIYW5kbGUgbmV3IE1pc3RyYWwgT0NSIEFQSSByZXNwb25zZSBmb3JtYXQgKDIwMjQpIHdoaWNoIHVzZXMgbWFya2Rvd25cclxuICAgIGlmIChwYWdlLm1hcmtkb3duICYmIHR5cGVvZiBwYWdlLm1hcmtkb3duID09PSAnc3RyaW5nJyAmJiBwYWdlLm1hcmtkb3duLnRyaW0oKSkge1xyXG4gICAgICBwcm9jZXNzZWRQYWdlLnRleHQgPSBwYWdlLm1hcmtkb3duLnRyaW0oKTtcclxuICAgICAgY29uc29sZS5sb2coYFtPY3JQcm9jZXNzb3JdIFVzaW5nIG1hcmtkb3duIGNvbnRlbnQgZm9yIHBhZ2UgJHtwYWdlTnVtYmVyfSAobGVuZ3RoOiAke3Byb2Nlc3NlZFBhZ2UudGV4dC5sZW5ndGh9KWApO1xyXG4gICAgICByZXR1cm4gcHJvY2Vzc2VkUGFnZTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDaGVjayBmb3IgcmF3IGNvbnRlbnQgZmlyc3QgLSBpdCdzIG9mdGVuIHRoZSBtb3N0IGNvbXBsZXRlXHJcbiAgICBsZXQgcmF3VGV4dENvbnRlbnQgPSAnJztcclxuXHJcbiAgICAvLyBMb29rIGZvciByYXcgdGV4dCBpbiBtdWx0aXBsZSBwb3NzaWJsZSBsb2NhdGlvbnNcclxuICAgIGlmIChwYWdlLnRleHQgJiYgdHlwZW9mIHBhZ2UudGV4dCA9PT0gJ3N0cmluZycgJiYgcGFnZS50ZXh0LnRyaW0oKSkge1xyXG4gICAgICByYXdUZXh0Q29udGVudCA9IHBhZ2UudGV4dC50cmltKCk7XHJcbiAgICB9IGVsc2UgaWYgKHBhZ2UucmF3X3RleHQgJiYgdHlwZW9mIHBhZ2UucmF3X3RleHQgPT09ICdzdHJpbmcnICYmIHBhZ2UucmF3X3RleHQudHJpbSgpKSB7XHJcbiAgICAgIHJhd1RleHRDb250ZW50ID0gcGFnZS5yYXdfdGV4dC50cmltKCk7XHJcbiAgICB9IGVsc2UgaWYgKHBhZ2UuY29udGVudCAmJiB0eXBlb2YgcGFnZS5jb250ZW50ID09PSAnc3RyaW5nJyAmJiBwYWdlLmNvbnRlbnQudHJpbSgpKSB7XHJcbiAgICAgIHJhd1RleHRDb250ZW50ID0gcGFnZS5jb250ZW50LnRyaW0oKTtcclxuICAgIH0gZWxzZSBpZiAocGFnZS50ZXh0Q29udGVudCAmJiB0eXBlb2YgcGFnZS50ZXh0Q29udGVudCA9PT0gJ3N0cmluZycgJiYgcGFnZS50ZXh0Q29udGVudC50cmltKCkpIHtcclxuICAgICAgcmF3VGV4dENvbnRlbnQgPSBwYWdlLnRleHRDb250ZW50LnRyaW0oKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBJZiByYXcgdGV4dCB3YXMgZm91bmQsIHVzZSBpdFxyXG4gICAgaWYgKHJhd1RleHRDb250ZW50KSB7XHJcbiAgICAgIHByb2Nlc3NlZFBhZ2UudGV4dCA9IHJhd1RleHRDb250ZW50O1xyXG4gICAgICBjb25zb2xlLmxvZyhgW09jclByb2Nlc3Nvcl0gVXNpbmcgcmF3IHRleHQgZm9yIHBhZ2UgJHtwYWdlTnVtYmVyfSAobGVuZ3RoOiAke3Jhd1RleHRDb250ZW50Lmxlbmd0aH0pYCk7XHJcblxyXG4gICAgICAvLyBXZSBmb3VuZCB1c2FibGUgdGV4dCwgc28gcmV0dXJuIHRoZSBwYWdlXHJcbiAgICAgIGlmIChwcm9jZXNzZWRQYWdlLnRleHQubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIHJldHVybiBwcm9jZXNzZWRQYWdlO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gSWYgbm8gcmF3IHRleHQgd2FzIGZvdW5kLCB0cnkgc3RydWN0dXJlZCBjb250ZW50XHJcbiAgICBjb25zb2xlLmxvZyhgW09jclByb2Nlc3Nvcl0gTm8gcmF3IHRleHQgZm9yIHBhZ2UgJHtwYWdlTnVtYmVyfSwgY2hlY2tpbmcgc3RydWN0dXJlZCBjb250ZW50YCk7XHJcblxyXG4gICAgLy8gUHJvY2VzcyBzdHJ1Y3R1cmVkIGNvbnRlbnQgaWYgYXZhaWxhYmxlXHJcbiAgICBpZiAocGFnZS5ibG9ja3MgJiYgQXJyYXkuaXNBcnJheShwYWdlLmJsb2NrcykpIHtcclxuICAgICAgLy8gUHJvY2VzcyBibG9ja3MgKHBhcmFncmFwaHMsIGhlYWRpbmdzLCBsaXN0cywgdGFibGVzLCBldGMuKVxyXG4gICAgICBjb25zdCB0ZXh0QmxvY2tzID0gdGhpcy5wcm9jZXNzQ29udGVudEJsb2NrcyhwYWdlLmJsb2Nrcyk7XHJcbiAgICAgIHByb2Nlc3NlZFBhZ2UudGV4dCA9IHRleHRCbG9ja3Muam9pbignXFxuXFxuJyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBbT2NyUHJvY2Vzc29yXSBFeHRyYWN0ZWQgJHt0ZXh0QmxvY2tzLmxlbmd0aH0gYmxvY2tzIGZvciBwYWdlICR7cGFnZU51bWJlcn1gKTtcclxuICAgIH0gZWxzZSBpZiAocGFnZS5lbGVtZW50cyAmJiBBcnJheS5pc0FycmF5KHBhZ2UuZWxlbWVudHMpKSB7XHJcbiAgICAgIC8vIEFsdGVybmF0aXZlIHN0cnVjdHVyZSB3aXRoIGVsZW1lbnRzIGluc3RlYWQgb2YgYmxvY2tzXHJcbiAgICAgIGNvbnN0IGVsZW1lbnRzID0gcGFnZS5lbGVtZW50cy5tYXAoZWxlbWVudCA9PiB7XHJcbiAgICAgICAgaWYgKGVsZW1lbnQudHlwZSA9PT0gJ3RleHQnICYmIGVsZW1lbnQudGV4dCkge1xyXG4gICAgICAgICAgcmV0dXJuIGVsZW1lbnQudGV4dDtcclxuICAgICAgICB9IGVsc2UgaWYgKGVsZW1lbnQuY29udGVudCkge1xyXG4gICAgICAgICAgcmV0dXJuIGVsZW1lbnQuY29udGVudDtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuICcnO1xyXG4gICAgICB9KS5maWx0ZXIodGV4dCA9PiB0ZXh0LnRyaW0oKS5sZW5ndGggPiAwKTtcclxuXHJcbiAgICAgIHByb2Nlc3NlZFBhZ2UudGV4dCA9IGVsZW1lbnRzLmpvaW4oJ1xcblxcbicpO1xyXG4gICAgICBjb25zb2xlLmxvZyhgW09jclByb2Nlc3Nvcl0gRXh0cmFjdGVkICR7ZWxlbWVudHMubGVuZ3RofSBlbGVtZW50cyBmb3IgcGFnZSAke3BhZ2VOdW1iZXJ9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ2hlY2sgZm9yIG9jcl90ZXh0IHdoaWNoIG1pZ2h0IGJlIHByb3ZpZGVkIGluIHNvbWUgQVBJc1xyXG4gICAgaWYgKCFwcm9jZXNzZWRQYWdlLnRleHQgJiYgcGFnZS5vY3JfdGV4dCAmJiB0eXBlb2YgcGFnZS5vY3JfdGV4dCA9PT0gJ3N0cmluZycgJiYgcGFnZS5vY3JfdGV4dC50cmltKCkpIHtcclxuICAgICAgcHJvY2Vzc2VkUGFnZS50ZXh0ID0gcGFnZS5vY3JfdGV4dC50cmltKCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBbT2NyUHJvY2Vzc29yXSBVc2luZyBPQ1IgdGV4dCBmb3IgcGFnZSAke3BhZ2VOdW1iZXJ9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gSWYgdGhlcmUgYXJlIGxpbmVzIGJ1dCBubyBqb2luZWQgdGV4dCwgcHJvY2VzcyB0aGUgbGluZXNcclxuICAgIGlmICghcHJvY2Vzc2VkUGFnZS50ZXh0ICYmIHBhZ2UubGluZXMgJiYgQXJyYXkuaXNBcnJheShwYWdlLmxpbmVzKSkge1xyXG4gICAgICBjb25zdCBsaW5lVGV4dHMgPSBwYWdlLmxpbmVzLm1hcChsaW5lID0+IHtcclxuICAgICAgICBpZiAodHlwZW9mIGxpbmUgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICByZXR1cm4gbGluZTtcclxuICAgICAgICB9IGVsc2UgaWYgKGxpbmUudGV4dCkge1xyXG4gICAgICAgICAgcmV0dXJuIGxpbmUudGV4dDtcclxuICAgICAgICB9IGVsc2UgaWYgKGxpbmUuY29udGVudCkge1xyXG4gICAgICAgICAgcmV0dXJuIGxpbmUuY29udGVudDtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuICcnO1xyXG4gICAgICB9KS5maWx0ZXIobGluZSA9PiBsaW5lLnRyaW0oKS5sZW5ndGggPiAwKTtcclxuXHJcbiAgICAgIGlmIChsaW5lVGV4dHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIHByb2Nlc3NlZFBhZ2UudGV4dCA9IGxpbmVUZXh0cy5qb2luKCdcXG4nKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW09jclByb2Nlc3Nvcl0gRXh0cmFjdGVkICR7bGluZVRleHRzLmxlbmd0aH0gbGluZXMgZm9yIHBhZ2UgJHtwYWdlTnVtYmVyfWApO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ2hlY2sgaWYgdGhlIHBhZ2UgY29udGFpbnMgYW55IGltYWdlcyBidXQgbm8gdGV4dFxyXG4gICAgY29uc3QgaGFzSW1hZ2VzID0gdGhpcy5fY2hlY2tGb3JJbWFnZXMocGFnZSk7XHJcbiAgICBpZiAoaGFzSW1hZ2VzICYmICFwcm9jZXNzZWRQYWdlLnRleHQpIHtcclxuICAgICAgLy8gTWFyayBhcyBwb3RlbnRpYWxseSBhbiBpbWFnZS1vbmx5IHBhZ2VcclxuICAgICAgcHJvY2Vzc2VkUGFnZS5pc0ltYWdlT25seSA9IHRydWU7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBbT2NyUHJvY2Vzc29yXSBQYWdlICR7cGFnZU51bWJlcn0gYXBwZWFycyB0byBjb250YWluIGltYWdlcyBidXQgbm8gdGV4dGApO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIExvZyBjb21wbGV0aW9uXHJcbiAgICBjb25zb2xlLmxvZyhgW09jclByb2Nlc3Nvcl0gUGFnZSAke3BhZ2VOdW1iZXJ9IHByb2Nlc3NpbmcgY29tcGxldGU6ICR7cHJvY2Vzc2VkUGFnZS50ZXh0ID8gYCR7cHJvY2Vzc2VkUGFnZS50ZXh0Lmxlbmd0aH0gY2hhcnNgIDogJ25vIHRleHQnfWApO1xyXG5cclxuICAgIHJldHVybiBwcm9jZXNzZWRQYWdlO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2hlY2sgaWYgYSBwYWdlIGNvbnRhaW5zIGltYWdlcyBidXQgbm8gdGV4dFxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBwYWdlIC0gUGFnZSBkYXRhXHJcbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIHBhZ2UgbGlrZWx5IGNvbnRhaW5zIGltYWdlc1xyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgX2NoZWNrRm9ySW1hZ2VzKHBhZ2UpIHtcclxuICAgIC8vIExvb2sgZm9yIGltYWdlIGluZGljYXRvcnMgaW4gYmxvY2tzXHJcbiAgICBpZiAocGFnZS5ibG9ja3MgJiYgQXJyYXkuaXNBcnJheShwYWdlLmJsb2NrcykpIHtcclxuICAgICAgcmV0dXJuIHBhZ2UuYmxvY2tzLnNvbWUoYmxvY2sgPT5cclxuICAgICAgICBibG9jay50eXBlID09PSAnaW1hZ2UnIHx8XHJcbiAgICAgICAgYmxvY2sudHlwZSA9PT0gJ2ZpZ3VyZScgfHxcclxuICAgICAgICBibG9jay5ibG9ja1R5cGUgPT09ICdpbWFnZSdcclxuICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBMb29rIGZvciBpbWFnZSBpbmRpY2F0b3JzIGluIGVsZW1lbnRzXHJcbiAgICBpZiAocGFnZS5lbGVtZW50cyAmJiBBcnJheS5pc0FycmF5KHBhZ2UuZWxlbWVudHMpKSB7XHJcbiAgICAgIHJldHVybiBwYWdlLmVsZW1lbnRzLnNvbWUoZWxlbWVudCA9PlxyXG4gICAgICAgIGVsZW1lbnQudHlwZSA9PT0gJ2ltYWdlJyB8fFxyXG4gICAgICAgIGVsZW1lbnQudHlwZSA9PT0gJ2ZpZ3VyZSdcclxuICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDaGVjayBpZiBwYWdlIGV4cGxpY2l0bHkgaGFzIGltYWdlcyBwcm9wZXJ0eVxyXG4gICAgaWYgKHBhZ2UuaW1hZ2VzICYmIEFycmF5LmlzQXJyYXkocGFnZS5pbWFnZXMpICYmIHBhZ2UuaW1hZ2VzLmxlbmd0aCA+IDApIHtcclxuICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ2hlY2sgaWYgcGFnZSBoYXMgaGFzSW1hZ2VzIGZsYWdcclxuICAgIGlmIChwYWdlLmhhc0ltYWdlcyA9PT0gdHJ1ZSkge1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGUgZmFsbGJhY2sgcmVzdWx0IHdoZW4gcHJvY2Vzc2luZyBmYWlsc1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXN1bHQgLSBPcmlnaW5hbCByZXN1bHRcclxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIHRoYXQgb2NjdXJyZWQgZHVyaW5nIHByb2Nlc3NpbmdcclxuICAgKiBAcmV0dXJucyB7T2JqZWN0fSBGYWxsYmFjayByZXN1bHRcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIF9jcmVhdGVGYWxsYmFja1Jlc3VsdChyZXN1bHQsIGVycm9yKSB7XHJcbiAgICBsZXQgcGFnZXMgPSBbXTtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gQXR0ZW1wdCB0byBleHRyYWN0IGFueSB1c2FibGUgaW5mb3JtYXRpb25cclxuICAgICAgaWYgKHJlc3VsdCAmJiByZXN1bHQucGFnZXMgJiYgQXJyYXkuaXNBcnJheShyZXN1bHQucGFnZXMpKSB7XHJcbiAgICAgICAgcGFnZXMgPSByZXN1bHQucGFnZXM7XHJcbiAgICAgIH0gZWxzZSBpZiAocmVzdWx0ICYmIHJlc3VsdC5kYXRhICYmIEFycmF5LmlzQXJyYXkocmVzdWx0LmRhdGEpKSB7XHJcbiAgICAgICAgcGFnZXMgPSByZXN1bHQuZGF0YTtcclxuICAgICAgfSBlbHNlIGlmIChyZXN1bHQgJiYgdHlwZW9mIHJlc3VsdCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICAvLyBIYW5kbGUgY2FzZSB3aGVyZSByZXN1bHQgbWlnaHQgYmUgYSBzdHJpbmdcclxuICAgICAgICBwYWdlcyA9IFt7IHRleHQ6IHJlc3VsdCB9XTtcclxuICAgICAgfSBlbHNlIGlmIChyZXN1bHQgJiYgcmVzdWx0LnRleHQgJiYgdHlwZW9mIHJlc3VsdC50ZXh0ID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgIHBhZ2VzID0gW3sgdGV4dDogcmVzdWx0LnRleHQgfV07XHJcbiAgICAgIH1cclxuICAgIH0gY2F0Y2ggKGZhbGxiYWNrRXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignW09jclByb2Nlc3Nvcl0gRmFsbGJhY2sgcHJvY2Vzc2luZyBhbHNvIGZhaWxlZDonLCBmYWxsYmFja0Vycm9yKTtcclxuICAgICAgcGFnZXMgPSBbXTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgZG9jdW1lbnRJbmZvOiB7XHJcbiAgICAgICAgbW9kZWw6IHJlc3VsdD8ubW9kZWwgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgIGxhbmd1YWdlOiByZXN1bHQ/Lmxhbmd1YWdlIHx8ICd1bmtub3duJyxcclxuICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZVxyXG4gICAgICB9LFxyXG4gICAgICBwYWdlczogcGFnZXMubWFwKChwYWdlLCBpbmRleCkgPT4gKHtcclxuICAgICAgICBwYWdlTnVtYmVyOiBwYWdlLnBhZ2VfbnVtYmVyIHx8IHBhZ2UucGFnZU51bWJlciB8fCBpbmRleCArIDEsXHJcbiAgICAgICAgdGV4dDogcGFnZS50ZXh0IHx8IHBhZ2UuY29udGVudCB8fCAnJyxcclxuICAgICAgICBjb25maWRlbmNlOiBwYWdlLmNvbmZpZGVuY2UgfHwgMFxyXG4gICAgICB9KSlcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQcm9jZXNzIGNvbnRlbnQgYmxvY2tzIGZyb20gT0NSIHJlc3VsdFxyXG4gICAqIEBwYXJhbSB7QXJyYXl9IGJsb2NrcyAtIENvbnRlbnQgYmxvY2tzIGZyb20gT0NSXHJcbiAgICogQHJldHVybnMge0FycmF5fSBQcm9jZXNzZWQgdGV4dCBibG9ja3NcclxuICAgKi9cclxuICBwcm9jZXNzQ29udGVudEJsb2NrcyhibG9ja3MpIHtcclxuICAgIGlmICghQXJyYXkuaXNBcnJheShibG9ja3MpIHx8IGJsb2Nrcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gYmxvY2tzLm1hcChibG9jayA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gSGFuZGxlIGNhc2Ugd2hlcmUgYmxvY2sgbWlnaHQgYmUgYSBzdHJpbmdcclxuICAgICAgICBpZiAodHlwZW9mIGJsb2NrID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgcmV0dXJuIGJsb2NrO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBIYW5kbGUgY2FzZSB3aGVyZSBibG9jayBtaWdodCBoYXZlIGRpcmVjdCB0ZXh0IGNvbnRlbnRcclxuICAgICAgICBpZiAoIWJsb2NrLnR5cGUgJiYgYmxvY2sudGV4dCkge1xyXG4gICAgICAgICAgcmV0dXJuIGJsb2NrLnRleHQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFByb2Nlc3MgZGlmZmVyZW50IHR5cGVzIG9mIGJsb2Nrc1xyXG4gICAgICAgIHN3aXRjaCAoYmxvY2sudHlwZT8udG9Mb3dlckNhc2UoKSkge1xyXG4gICAgICAgICAgY2FzZSAnaGVhZGluZyc6XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NIZWFkaW5nKGJsb2NrKTtcclxuICAgICAgICAgIGNhc2UgJ3BhcmFncmFwaCc6XHJcbiAgICAgICAgICBjYXNlICd0ZXh0JzpcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc1BhcmFncmFwaChibG9jayk7XHJcbiAgICAgICAgICBjYXNlICdsaXN0JzpcclxuICAgICAgICAgIGNhc2UgJ2J1bGxldF9saXN0JzpcclxuICAgICAgICAgIGNhc2UgJ251bWJlcmVkX2xpc3QnOlxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzTGlzdChibG9jayk7XHJcbiAgICAgICAgICBjYXNlICd0YWJsZSc6XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NUYWJsZShibG9jayk7XHJcbiAgICAgICAgICBjYXNlICdpbWFnZSc6XHJcbiAgICAgICAgICBjYXNlICdmaWd1cmUnOlxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzSW1hZ2UoYmxvY2spO1xyXG4gICAgICAgICAgY2FzZSAnY29kZSc6XHJcbiAgICAgICAgICBjYXNlICdjb2RlX2Jsb2NrJzpcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc0NvZGVCbG9jayhibG9jayk7XHJcbiAgICAgICAgICBjYXNlICdxdW90ZSc6XHJcbiAgICAgICAgICBjYXNlICdibG9ja3F1b3RlJzpcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc1F1b3RlKGJsb2NrKTtcclxuICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgIC8vIEZvciB1bmtub3duIGJsb2NrIHR5cGVzLCBqdXN0IHJldHVybiB0aGUgdGV4dCBpZiBhdmFpbGFibGVcclxuICAgICAgICAgICAgcmV0dXJuIGJsb2NrLnRleHQgfHwgYmxvY2suY29udGVudCB8fCAnJztcclxuICAgICAgICB9XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignW09jclByb2Nlc3Nvcl0gRXJyb3IgcHJvY2Vzc2luZyBjb250ZW50IGJsb2NrOicsIGVycm9yKTtcclxuICAgICAgICAvLyBSZXR1cm4gZW1wdHkgc3RyaW5nIGlmIHByb2Nlc3NpbmcgZmFpbHNcclxuICAgICAgICByZXR1cm4gJyc7XHJcbiAgICAgIH1cclxuICAgIH0pLmZpbHRlcih0ZXh0ID0+IHRleHQudHJpbSgpLmxlbmd0aCA+IDApOyAvLyBGaWx0ZXIgb3V0IGVtcHR5IGJsb2Nrc1xyXG4gIH1cclxuICBcclxuICAvKipcclxuICAgKiBQcm9jZXNzIGhlYWRpbmcgYmxvY2tcclxuICAgKiBAcGFyYW0ge09iamVjdH0gYmxvY2sgLSBIZWFkaW5nIGJsb2NrXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gTWFya2Rvd24gaGVhZGluZ1xyXG4gICAqL1xyXG4gIHByb2Nlc3NIZWFkaW5nKGJsb2NrKSB7XHJcbiAgICBjb25zdCBsZXZlbCA9IGJsb2NrLmxldmVsIHx8IDE7XHJcbiAgICBjb25zdCBoZWFkaW5nTWFya2VycyA9ICcjJy5yZXBlYXQoTWF0aC5taW4obGV2ZWwsIDYpKTtcclxuICAgIHJldHVybiBgJHtoZWFkaW5nTWFya2Vyc30gJHtibG9jay50ZXh0IHx8ICcnfWA7XHJcbiAgfVxyXG4gIFxyXG4gIC8qKlxyXG4gICAqIFByb2Nlc3MgcGFyYWdyYXBoIGJsb2NrXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IGJsb2NrIC0gUGFyYWdyYXBoIGJsb2NrXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gUGFyYWdyYXBoIHRleHRcclxuICAgKi9cclxuICBwcm9jZXNzUGFyYWdyYXBoKGJsb2NrKSB7XHJcbiAgICByZXR1cm4gYmxvY2sudGV4dCB8fCAnJztcclxuICB9XHJcbiAgXHJcbiAgLyoqXHJcbiAgICogUHJvY2VzcyBsaXN0IGJsb2NrXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IGJsb2NrIC0gTGlzdCBibG9ja1xyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IE1hcmtkb3duIGxpc3RcclxuICAgKi9cclxuICBwcm9jZXNzTGlzdChibG9jaykge1xyXG4gICAgaWYgKCFibG9jay5pdGVtcyB8fCAhQXJyYXkuaXNBcnJheShibG9jay5pdGVtcykgfHwgYmxvY2suaXRlbXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIHJldHVybiAnJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgY29uc3QgbGlzdFR5cGUgPSBibG9jay5vcmRlcmVkID8gJ29yZGVyZWQnIDogJ3Vub3JkZXJlZCc7XHJcbiAgICBcclxuICAgIHJldHVybiBibG9jay5pdGVtcy5tYXAoKGl0ZW0sIGluZGV4KSA9PiB7XHJcbiAgICAgIGlmIChsaXN0VHlwZSA9PT0gJ29yZGVyZWQnKSB7XHJcbiAgICAgICAgcmV0dXJuIGAke2luZGV4ICsgMX0uICR7aXRlbS50ZXh0IHx8ICcnfWA7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuIGAtICR7aXRlbS50ZXh0IHx8ICcnfWA7XHJcbiAgICAgIH1cclxuICAgIH0pLmpvaW4oJ1xcbicpO1xyXG4gIH1cclxuICBcclxuICAvKipcclxuICAgKiBQcm9jZXNzIHRhYmxlIGJsb2NrXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IGJsb2NrIC0gVGFibGUgYmxvY2tcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biB0YWJsZVxyXG4gICAqL1xyXG4gIHByb2Nlc3NUYWJsZShibG9jaykge1xyXG4gICAgaWYgKCFibG9jay5yb3dzIHx8ICFBcnJheS5pc0FycmF5KGJsb2NrLnJvd3MpIHx8IGJsb2NrLnJvd3MubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIHJldHVybiAnJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgY29uc3QgdGFibGVSb3dzID0gYmxvY2sucm93cy5tYXAocm93ID0+IHtcclxuICAgICAgaWYgKCFyb3cuY2VsbHMgfHwgIUFycmF5LmlzQXJyYXkocm93LmNlbGxzKSkge1xyXG4gICAgICAgIHJldHVybiAnfCB8JztcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgY29uc3QgY2VsbHMgPSByb3cuY2VsbHMubWFwKGNlbGwgPT4gY2VsbC50ZXh0IHx8ICcnKS5qb2luKCcgfCAnKTtcclxuICAgICAgcmV0dXJuIGB8ICR7Y2VsbHN9IHxgO1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIEluc2VydCBoZWFkZXIgc2VwYXJhdG9yIGFmdGVyIHRoZSBmaXJzdCByb3dcclxuICAgIGlmICh0YWJsZVJvd3MubGVuZ3RoID4gMSkge1xyXG4gICAgICBjb25zdCBoZWFkZXJSb3cgPSB0YWJsZVJvd3NbMF07XHJcbiAgICAgIGNvbnN0IHNlcGFyYXRvckNvdW50ID0gKGhlYWRlclJvdy5tYXRjaCgvXFx8L2cpIHx8IFtdKS5sZW5ndGggLSAxO1xyXG4gICAgICBjb25zdCBzZXBhcmF0b3IgPSBgfCR7JyAtLS0gfCcucmVwZWF0KHNlcGFyYXRvckNvdW50KX1gO1xyXG4gICAgICB0YWJsZVJvd3Muc3BsaWNlKDEsIDAsIHNlcGFyYXRvcik7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiB0YWJsZVJvd3Muam9pbignXFxuJyk7XHJcbiAgfVxyXG4gIFxyXG4gIC8qKlxyXG4gICAqIFByb2Nlc3MgaW1hZ2UgYmxvY2tcclxuICAgKiBAcGFyYW0ge09iamVjdH0gYmxvY2sgLSBJbWFnZSBibG9ja1xyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IE1hcmtkb3duIGltYWdlIHJlZmVyZW5jZVxyXG4gICAqL1xyXG4gIHByb2Nlc3NJbWFnZShibG9jaykge1xyXG4gICAgY29uc3QgY2FwdGlvbiA9IGJsb2NrLmNhcHRpb24gfHwgYmxvY2suYWx0IHx8ICdJbWFnZSc7XHJcbiAgICBjb25zdCBzb3VyY2UgPSBibG9jay5zcmMgfHwgYmxvY2suc291cmNlIHx8IGJsb2NrLnVybCB8fCAnaW1hZ2UtcmVmZXJlbmNlJztcclxuICAgIHJldHVybiBgIVske2NhcHRpb259XSgke3NvdXJjZX0pYDtcclxuICB9XHJcbiAgXHJcbiAgLyoqXHJcbiAgICogUHJvY2VzcyBjb2RlIGJsb2NrXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IGJsb2NrIC0gQ29kZSBibG9ja1xyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IE1hcmtkb3duIGNvZGUgYmxvY2tcclxuICAgKi9cclxuICBwcm9jZXNzQ29kZUJsb2NrKGJsb2NrKSB7XHJcbiAgICBjb25zdCBsYW5ndWFnZSA9IGJsb2NrLmxhbmd1YWdlIHx8ICcnO1xyXG4gICAgY29uc3QgY29kZSA9IGJsb2NrLnRleHQgfHwgYmxvY2suY29udGVudCB8fCBibG9jay5jb2RlIHx8ICcnO1xyXG4gICAgcmV0dXJuIGBcXGBcXGBcXGAke2xhbmd1YWdlfVxcbiR7Y29kZX1cXG5cXGBcXGBcXGBgO1xyXG4gIH1cclxuICBcclxuICAvKipcclxuICAgKiBQcm9jZXNzIHF1b3RlIGJsb2NrXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IGJsb2NrIC0gUXVvdGUgYmxvY2tcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBxdW90ZVxyXG4gICAqL1xyXG4gIHByb2Nlc3NRdW90ZShibG9jaykge1xyXG4gICAgY29uc3QgdGV4dCA9IGJsb2NrLnRleHQgfHwgYmxvY2suY29udGVudCB8fCAnJztcclxuICAgIC8vIFNwbGl0IGJ5IG5ld2xpbmVzIGFuZCBhZGQgPiB0byBlYWNoIGxpbmVcclxuICAgIHJldHVybiB0ZXh0LnNwbGl0KCdcXG4nKS5tYXAobGluZSA9PiBgPiAke2xpbmV9YCkuam9pbignXFxuJyk7XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IE9jclByb2Nlc3NvcjsiXSwibWFw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