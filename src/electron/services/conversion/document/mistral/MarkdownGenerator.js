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
    return blocks
      .map(block => block.text || block.content || '')
      .filter(text => text.trim().length > 0);
  }

  /**
   * Generate fallback markdown when an error occurs
   * @param {Object} metadata - PDF metadata
   * @param {Object} ocrResult - OCR result
   * @param {Error} error - Error that occurred
   * @returns {string} Fallback markdown content
   */
  generateFallbackMarkdown(metadata, ocrResult, error) {
    const fallbackMarkdown = [
      '# OCR Conversion Result',
      '',
      '## Error Information',
      '',
      `An error occurred during markdown generation: ${error.message}`,
      '',
      '## Document Information',
      ''
    ];
    
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
    return [
      '---',
      `title: ${fileTitle}`,
      `converted: ${convertedDate}`,
      'type: pdf-ocr',
      '---',
      ''
    ].join('\n');
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