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
      console.log('[OcrProcessor] OCR result structure:',
        Object.keys(result).join(', '));
      
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
      console.error('[OcrProcessor] OCR result that caused error:',
        result ? JSON.stringify(result, null, 2).substring(0, 500) + '...' : 'undefined');
      
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
        pages = [{ text: result }];
      } else if (result && result.text && typeof result.text === 'string') {
        pages = [{ text: result.text }];
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