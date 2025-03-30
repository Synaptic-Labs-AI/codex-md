/**
 * PageMarkerService.js
 * 
 * Provides utilities for adding page markers to converted content.
 * Handles different document types and formats page markers consistently.
 * 
 * Related files:
 * - src/electron/adapters/pdfConverterAdapter.js: Uses this service for PDF page markers
 * - src/electron/adapters/docxConverterAdapter.js: Uses this service for DOCX page markers
 * - src/electron/adapters/pptxConverterAdapter.js: Uses this service for PPTX slide markers
 * - src/electron/adapters/audioConverterAdapter.js: Uses this service for audio word-based page markers
 * - src/electron/adapters/videoConverterAdapter.js: Uses this service for video word-based page markers
 * - src/electron/adapters/parentUrlConverterAdapter.js: Uses this service for parent URL page markers
 */

class PageMarkerService {
  /**
   * Format a page marker
   * @param {number} pageNumber - The page number
   * @param {string} [url] - Optional URL for parent URL pages
   * @param {string} [markerType='Page'] - Type of marker ('Page' or 'Slide')
   * @returns {string} Formatted page marker
   */
  static formatPageMarker(pageNumber, url = null, markerType = 'Page') {
    if (url) {
      return `\n\n[${markerType} ${pageNumber}: ${url}]\n\n`;
    }
    return `\n\n[${markerType} ${pageNumber}]\n\n`;
  }
  
  /**
   * Insert page markers into content
   * @param {string} content - The content to process
   * @param {Array<{pageNumber: number, position: number, url?: string}>} pageBreaks - Array of page break positions
   * @param {string} [markerType='Page'] - Type of marker ('Page' or 'Slide')
   * @returns {string} Content with page markers
   */
  static insertPageMarkers(content, pageBreaks, markerType = 'Page') {
    // Validate inputs
    if (!content || typeof content !== 'string') {
      console.error(`❌ [PageMarkerService] Invalid content for page markers: ${typeof content}`);
      return content || '';
    }
    
    if (!Array.isArray(pageBreaks) || pageBreaks.length === 0) {
      console.warn(`⚠️ [PageMarkerService] No page breaks provided for insertPageMarkers`);
      return content;
    }
    
    try {
      // Sort page breaks by position (descending)
      const sortedBreaks = [...pageBreaks].sort((a, b) => b.position - a.position);
      
      // Insert markers from end to beginning to avoid position shifts
      let result = content;
      for (const breakInfo of sortedBreaks) {
        // Validate each page break object
        if (!breakInfo || typeof breakInfo !== 'object') {
          console.warn(`⚠️ [PageMarkerService] Invalid page break object: ${breakInfo}`);
          continue;
        }
        
        const { pageNumber, position, url } = breakInfo;
        
        // Skip invalid positions
        if (typeof position !== 'number' || position < 0 || position > result.length) {
          console.warn(`⚠️ [PageMarkerService] Invalid position: ${position}`);
          continue;
        }
        
        // Create and insert the marker
        const marker = this.formatPageMarker(pageNumber, url, markerType);
        result = result.slice(0, position) + marker + result.slice(position);
      }
      
      return result;
    } catch (error) {
      console.error(`❌ [PageMarkerService] Error inserting page markers:`, error);
      return content;
    }
  }
  
  /**
   * Calculate page breaks based on word count
   * @param {string} content - The content to process
   * @param {number} wordsPerPage - Words per page (default: 275)
   * @returns {Array<{pageNumber: number, position: number}>} Page break positions
   */
  static calculateWordBasedPageBreaks(content, wordsPerPage = 275) {
    // Validate input
    if (!content || typeof content !== 'string') {
      console.error(`❌ [PageMarkerService] Invalid content for word-based pagination: ${typeof content}`);
      return [];
    }
    
    if (content.trim() === '') {
      console.warn(`⚠️ [PageMarkerService] Empty content for word-based pagination`);
      return [];
    }
    
    try {
      const pageBreaks = [];
      const paragraphs = content.split(/\n\n+/);
      
      let wordCount = 0;
      let position = 0;
      let pageNumber = 1;
      
      for (const paragraph of paragraphs) {
        // Skip empty paragraphs
        if (!paragraph || paragraph.trim() === '') {
          position += 2; // +2 for paragraph break
          continue;
        }
        
        // Safely calculate word count
        const paragraphWords = paragraph.trim().split(/\s+/).filter(word => word.length > 0).length;
        wordCount += paragraphWords;
        
        // If we've exceeded the words per page threshold
        if (wordCount >= wordsPerPage) {
          // Add a page break after this paragraph
          position += paragraph.length;
          pageNumber++;
          pageBreaks.push({ pageNumber, position });
          wordCount = 0;
        }
        
        position += paragraph.length + 2; // +2 for paragraph break
      }
      
      console.log(`📊 [PageMarkerService] Calculated ${pageBreaks.length} word-based page breaks`);
      return pageBreaks;
    } catch (error) {
      console.error(`❌ [PageMarkerService] Error calculating word-based page breaks:`, error);
      return [];
    }
  }
  
  /**
   * Add page count to metadata
   * @param {Object} metadata - The metadata object
   * @param {number} pageCount - The total page count
   * @returns {Object} Updated metadata
   */
  static addPageMetadata(metadata, pageCount) {
    if (!metadata || typeof metadata !== 'object') {
      return { pageCount };
    }
    return {
      ...metadata,
      pageCount
    };
  }
  
  /**
   * Add slide count to metadata
   * @param {Object} metadata - The metadata object
   * @param {number} slideCount - The total slide count
   * @returns {Object} Updated metadata
   */
  static addSlideMetadata(metadata, slideCount) {
    if (!metadata || typeof metadata !== 'object') {
      return { slideCount };
    }
    return {
      ...metadata,
      slideCount
    };
  }
}

module.exports = PageMarkerService;
