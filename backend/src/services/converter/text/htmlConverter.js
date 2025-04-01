/**
 * HTML Converter Module
 * 
 * Converts HTML files to Markdown format with robust content extraction.
 * This module handles the conversion of HTML files to Markdown format,
 * including content extraction, image processing, and metadata handling.
 * 
 * Related files:
 * - ../web/utils/htmlToMarkdown.js: Core HTML to Markdown conversion logic
 * - ../../../utils/metadataExtractor.js: Extracts metadata from HTML
 * - ./docxConverter.js: Uses similar HTML to Markdown conversion for DOCX files
 */

import { JSDOM } from 'jsdom';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { htmlToMarkdown, cleanMarkdown } from '../web/utils/htmlToMarkdown.js';
import { extractMetadata, formatMetadata } from '../../../utils/metadataExtractor.js';

/**
 * Converts an HTML buffer to Markdown format
 * @param {Buffer} buffer - The HTML file buffer
 * @param {string} originalName - Original filename for context
 * @param {Object} [options] - Conversion options
 * @returns {Promise<{content: string, images: Array}>} Markdown content and images
 */
export async function convertHtmlToMarkdown(buffer, originalName, options = {}) {
  const startTime = Date.now();
  
  try {
    console.log(`🔄 Converting HTML to Markdown: ${originalName}`);
    
    // Validate input
    if (!buffer) {
      console.error('❌ Invalid input: buffer is missing');
      throw new Error('Invalid input: HTML data is missing');
    }
    
    // Convert buffer to string
    const htmlContent = buffer.toString('utf-8');
    
    if (!htmlContent || htmlContent.trim() === '') {
      console.error('❌ Empty HTML content');
      throw new Error('HTML content is empty');
    }
    
    // Create a DOM from the HTML
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;
    
    // Get base name for folder structure
    const baseName = path.basename(originalName, path.extname(originalName));
    
    // Extract images if requested
    const images = [];
    if (options.includeImages !== false) {
      document.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src');
        const alt = img.getAttribute('alt') || '';
        const title = img.getAttribute('title') || '';
        
        if (src) {
          // Skip data URLs and external URLs for now
          if (src.startsWith('data:') || src.startsWith('http')) {
            return;
          }
          
          // For local images, we'll need to handle them separately
          // This would require the original HTML file location to resolve relative paths
          const imageName = `${baseName}-${uuidv4().slice(0, 8)}${path.extname(src) || '.png'}`;
          
          images.push({
            name: imageName,
            originalSrc: src,
            alt,
            title,
            path: `images/${baseName}/${imageName}`
          });
          
          // Update the src attribute to point to the new location
          img.setAttribute('src', `images/${baseName}/${imageName}`);
        }
      });
    }
    
    // Extract metadata if requested
    let metadata = {};
    if (options.includeMeta !== false) {
      // Extract title
      const titleElement = document.querySelector('title');
      if (titleElement) {
        metadata.title = titleElement.textContent.trim();
      }
      
      // Extract meta tags
      document.querySelectorAll('meta').forEach(meta => {
        const name = meta.getAttribute('name') || meta.getAttribute('property');
        const content = meta.getAttribute('content');
        
        if (name && content) {
          metadata[name] = content;
        }
      });
    }
    
    // Convert HTML to Markdown
    console.log('🔄 Processing HTML content');
    let markdownContent = htmlToMarkdown(document.body);
    
    // Clean up the Markdown
    markdownContent = cleanMarkdown(markdownContent);
    
    // Create enhanced frontmatter and content
    // Remove temp_ prefix from title if present
    let cleanTitle = baseName;
    if (cleanTitle.startsWith('temp_')) {
      // Extract original filename by removing 'temp_timestamp_' prefix
      cleanTitle = cleanTitle.replace(/^temp_\d+_/, '');
    }
    
    // Use title from metadata if available
    if (metadata.title) {
      cleanTitle = metadata.title;
    }
    
    const markdown = [
      '---',
      `title: ${cleanTitle}`,
      `imagesFolder: images/${baseName}`,
      'created: ' + new Date().toISOString(),
      `originalName: ${originalName}`,
      `conversionTime: ${Date.now() - startTime}ms`,
      `imageCount: ${images.length}`,
      '---',
      '',
      '<!-- HTML Conversion Result -->',
      '',
      markdownContent
    ].join('\n');
    
    console.log('✅ HTML conversion successful:', {
      contentLength: markdownContent.length,
      imageCount: images.length,
      conversionTime: Date.now() - startTime
    });
    
    // Return the result
    return {
      success: true,
      content: markdown,
      images: images
    };
    
  } catch (error) {
    console.error('Error converting HTML:', error);
    throw new Error(`HTML conversion failed: ${error.message}`);
  }
}

/**
 * Default export for the HTML converter
 * Follows the same pattern as other converters for consistency
 */
export default {
  convert: convertHtmlToMarkdown
};
