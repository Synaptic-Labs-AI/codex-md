"use strict";

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
        const {
          pageNumber,
          position,
          url
        } = breakInfo;

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
          pageBreaks.push({
            pageNumber,
            position
          });
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
      return {
        pageCount
      };
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
      return {
        slideCount
      };
    }
    return {
      ...metadata,
      slideCount
    };
  }
}
module.exports = PageMarkerService;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJQYWdlTWFya2VyU2VydmljZSIsImZvcm1hdFBhZ2VNYXJrZXIiLCJwYWdlTnVtYmVyIiwidXJsIiwibWFya2VyVHlwZSIsImluc2VydFBhZ2VNYXJrZXJzIiwiY29udGVudCIsInBhZ2VCcmVha3MiLCJjb25zb2xlIiwiZXJyb3IiLCJBcnJheSIsImlzQXJyYXkiLCJsZW5ndGgiLCJ3YXJuIiwic29ydGVkQnJlYWtzIiwic29ydCIsImEiLCJiIiwicG9zaXRpb24iLCJyZXN1bHQiLCJicmVha0luZm8iLCJtYXJrZXIiLCJzbGljZSIsImNhbGN1bGF0ZVdvcmRCYXNlZFBhZ2VCcmVha3MiLCJ3b3Jkc1BlclBhZ2UiLCJ0cmltIiwicGFyYWdyYXBocyIsInNwbGl0Iiwid29yZENvdW50IiwicGFyYWdyYXBoIiwicGFyYWdyYXBoV29yZHMiLCJmaWx0ZXIiLCJ3b3JkIiwicHVzaCIsImxvZyIsImFkZFBhZ2VNZXRhZGF0YSIsIm1ldGFkYXRhIiwicGFnZUNvdW50IiwiYWRkU2xpZGVNZXRhZGF0YSIsInNsaWRlQ291bnQiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL1BhZ2VNYXJrZXJTZXJ2aWNlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBQYWdlTWFya2VyU2VydmljZS5qc1xyXG4gKiBcclxuICogUHJvdmlkZXMgdXRpbGl0aWVzIGZvciBhZGRpbmcgcGFnZSBtYXJrZXJzIHRvIGNvbnZlcnRlZCBjb250ZW50LlxyXG4gKiBIYW5kbGVzIGRpZmZlcmVudCBkb2N1bWVudCB0eXBlcyBhbmQgZm9ybWF0cyBwYWdlIG1hcmtlcnMgY29uc2lzdGVudGx5LlxyXG4gKiBcclxuICogUmVsYXRlZCBmaWxlczpcclxuICogLSBzcmMvZWxlY3Ryb24vYWRhcHRlcnMvcGRmQ29udmVydGVyQWRhcHRlci5qczogVXNlcyB0aGlzIHNlcnZpY2UgZm9yIFBERiBwYWdlIG1hcmtlcnNcclxuICogLSBzcmMvZWxlY3Ryb24vYWRhcHRlcnMvZG9jeENvbnZlcnRlckFkYXB0ZXIuanM6IFVzZXMgdGhpcyBzZXJ2aWNlIGZvciBET0NYIHBhZ2UgbWFya2Vyc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9hZGFwdGVycy9wcHR4Q29udmVydGVyQWRhcHRlci5qczogVXNlcyB0aGlzIHNlcnZpY2UgZm9yIFBQVFggc2xpZGUgbWFya2Vyc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9hZGFwdGVycy9hdWRpb0NvbnZlcnRlckFkYXB0ZXIuanM6IFVzZXMgdGhpcyBzZXJ2aWNlIGZvciBhdWRpbyB3b3JkLWJhc2VkIHBhZ2UgbWFya2Vyc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9hZGFwdGVycy92aWRlb0NvbnZlcnRlckFkYXB0ZXIuanM6IFVzZXMgdGhpcyBzZXJ2aWNlIGZvciB2aWRlbyB3b3JkLWJhc2VkIHBhZ2UgbWFya2Vyc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9hZGFwdGVycy9wYXJlbnRVcmxDb252ZXJ0ZXJBZGFwdGVyLmpzOiBVc2VzIHRoaXMgc2VydmljZSBmb3IgcGFyZW50IFVSTCBwYWdlIG1hcmtlcnNcclxuICovXHJcblxyXG5jbGFzcyBQYWdlTWFya2VyU2VydmljZSB7XHJcbiAgLyoqXHJcbiAgICogRm9ybWF0IGEgcGFnZSBtYXJrZXJcclxuICAgKiBAcGFyYW0ge251bWJlcn0gcGFnZU51bWJlciAtIFRoZSBwYWdlIG51bWJlclxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbdXJsXSAtIE9wdGlvbmFsIFVSTCBmb3IgcGFyZW50IFVSTCBwYWdlc1xyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbbWFya2VyVHlwZT0nUGFnZSddIC0gVHlwZSBvZiBtYXJrZXIgKCdQYWdlJyBvciAnU2xpZGUnKVxyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEZvcm1hdHRlZCBwYWdlIG1hcmtlclxyXG4gICAqL1xyXG4gIHN0YXRpYyBmb3JtYXRQYWdlTWFya2VyKHBhZ2VOdW1iZXIsIHVybCA9IG51bGwsIG1hcmtlclR5cGUgPSAnUGFnZScpIHtcclxuICAgIGlmICh1cmwpIHtcclxuICAgICAgcmV0dXJuIGBcXG5cXG5bJHttYXJrZXJUeXBlfSAke3BhZ2VOdW1iZXJ9OiAke3VybH1dXFxuXFxuYDtcclxuICAgIH1cclxuICAgIHJldHVybiBgXFxuXFxuWyR7bWFya2VyVHlwZX0gJHtwYWdlTnVtYmVyfV1cXG5cXG5gO1xyXG4gIH1cclxuICBcclxuICAvKipcclxuICAgKiBJbnNlcnQgcGFnZSBtYXJrZXJzIGludG8gY29udGVudFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb250ZW50IC0gVGhlIGNvbnRlbnQgdG8gcHJvY2Vzc1xyXG4gICAqIEBwYXJhbSB7QXJyYXk8e3BhZ2VOdW1iZXI6IG51bWJlciwgcG9zaXRpb246IG51bWJlciwgdXJsPzogc3RyaW5nfT59IHBhZ2VCcmVha3MgLSBBcnJheSBvZiBwYWdlIGJyZWFrIHBvc2l0aW9uc1xyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbbWFya2VyVHlwZT0nUGFnZSddIC0gVHlwZSBvZiBtYXJrZXIgKCdQYWdlJyBvciAnU2xpZGUnKVxyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IENvbnRlbnQgd2l0aCBwYWdlIG1hcmtlcnNcclxuICAgKi9cclxuICBzdGF0aWMgaW5zZXJ0UGFnZU1hcmtlcnMoY29udGVudCwgcGFnZUJyZWFrcywgbWFya2VyVHlwZSA9ICdQYWdlJykge1xyXG4gICAgLy8gVmFsaWRhdGUgaW5wdXRzXHJcbiAgICBpZiAoIWNvbnRlbnQgfHwgdHlwZW9mIGNvbnRlbnQgIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBbUGFnZU1hcmtlclNlcnZpY2VdIEludmFsaWQgY29udGVudCBmb3IgcGFnZSBtYXJrZXJzOiAke3R5cGVvZiBjb250ZW50fWApO1xyXG4gICAgICByZXR1cm4gY29udGVudCB8fCAnJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHBhZ2VCcmVha3MpIHx8IHBhZ2VCcmVha3MubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFtQYWdlTWFya2VyU2VydmljZV0gTm8gcGFnZSBicmVha3MgcHJvdmlkZWQgZm9yIGluc2VydFBhZ2VNYXJrZXJzYCk7XHJcbiAgICAgIHJldHVybiBjb250ZW50O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBTb3J0IHBhZ2UgYnJlYWtzIGJ5IHBvc2l0aW9uIChkZXNjZW5kaW5nKVxyXG4gICAgICBjb25zdCBzb3J0ZWRCcmVha3MgPSBbLi4ucGFnZUJyZWFrc10uc29ydCgoYSwgYikgPT4gYi5wb3NpdGlvbiAtIGEucG9zaXRpb24pO1xyXG4gICAgICBcclxuICAgICAgLy8gSW5zZXJ0IG1hcmtlcnMgZnJvbSBlbmQgdG8gYmVnaW5uaW5nIHRvIGF2b2lkIHBvc2l0aW9uIHNoaWZ0c1xyXG4gICAgICBsZXQgcmVzdWx0ID0gY29udGVudDtcclxuICAgICAgZm9yIChjb25zdCBicmVha0luZm8gb2Ygc29ydGVkQnJlYWtzKSB7XHJcbiAgICAgICAgLy8gVmFsaWRhdGUgZWFjaCBwYWdlIGJyZWFrIG9iamVjdFxyXG4gICAgICAgIGlmICghYnJlYWtJbmZvIHx8IHR5cGVvZiBicmVha0luZm8gIT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbUGFnZU1hcmtlclNlcnZpY2VdIEludmFsaWQgcGFnZSBicmVhayBvYmplY3Q6ICR7YnJlYWtJbmZvfWApO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IHsgcGFnZU51bWJlciwgcG9zaXRpb24sIHVybCB9ID0gYnJlYWtJbmZvO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFNraXAgaW52YWxpZCBwb3NpdGlvbnNcclxuICAgICAgICBpZiAodHlwZW9mIHBvc2l0aW9uICE9PSAnbnVtYmVyJyB8fCBwb3NpdGlvbiA8IDAgfHwgcG9zaXRpb24gPiByZXN1bHQubGVuZ3RoKSB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbUGFnZU1hcmtlclNlcnZpY2VdIEludmFsaWQgcG9zaXRpb246ICR7cG9zaXRpb259YCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ3JlYXRlIGFuZCBpbnNlcnQgdGhlIG1hcmtlclxyXG4gICAgICAgIGNvbnN0IG1hcmtlciA9IHRoaXMuZm9ybWF0UGFnZU1hcmtlcihwYWdlTnVtYmVyLCB1cmwsIG1hcmtlclR5cGUpO1xyXG4gICAgICAgIHJlc3VsdCA9IHJlc3VsdC5zbGljZSgwLCBwb3NpdGlvbikgKyBtYXJrZXIgKyByZXN1bHQuc2xpY2UocG9zaXRpb24pO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihg4p2MIFtQYWdlTWFya2VyU2VydmljZV0gRXJyb3IgaW5zZXJ0aW5nIHBhZ2UgbWFya2VyczpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBjb250ZW50O1xyXG4gICAgfVxyXG4gIH1cclxuICBcclxuICAvKipcclxuICAgKiBDYWxjdWxhdGUgcGFnZSBicmVha3MgYmFzZWQgb24gd29yZCBjb3VudFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb250ZW50IC0gVGhlIGNvbnRlbnQgdG8gcHJvY2Vzc1xyXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB3b3Jkc1BlclBhZ2UgLSBXb3JkcyBwZXIgcGFnZSAoZGVmYXVsdDogMjc1KVxyXG4gICAqIEByZXR1cm5zIHtBcnJheTx7cGFnZU51bWJlcjogbnVtYmVyLCBwb3NpdGlvbjogbnVtYmVyfT59IFBhZ2UgYnJlYWsgcG9zaXRpb25zXHJcbiAgICovXHJcbiAgc3RhdGljIGNhbGN1bGF0ZVdvcmRCYXNlZFBhZ2VCcmVha3MoY29udGVudCwgd29yZHNQZXJQYWdlID0gMjc1KSB7XHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCFjb250ZW50IHx8IHR5cGVvZiBjb250ZW50ICE9PSAnc3RyaW5nJykge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGDinYwgW1BhZ2VNYXJrZXJTZXJ2aWNlXSBJbnZhbGlkIGNvbnRlbnQgZm9yIHdvcmQtYmFzZWQgcGFnaW5hdGlvbjogJHt0eXBlb2YgY29udGVudH1gKTtcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoY29udGVudC50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFtQYWdlTWFya2VyU2VydmljZV0gRW1wdHkgY29udGVudCBmb3Igd29yZC1iYXNlZCBwYWdpbmF0aW9uYCk7XHJcbiAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcGFnZUJyZWFrcyA9IFtdO1xyXG4gICAgICBjb25zdCBwYXJhZ3JhcGhzID0gY29udGVudC5zcGxpdCgvXFxuXFxuKy8pO1xyXG4gICAgICBcclxuICAgICAgbGV0IHdvcmRDb3VudCA9IDA7XHJcbiAgICAgIGxldCBwb3NpdGlvbiA9IDA7XHJcbiAgICAgIGxldCBwYWdlTnVtYmVyID0gMTtcclxuICAgICAgXHJcbiAgICAgIGZvciAoY29uc3QgcGFyYWdyYXBoIG9mIHBhcmFncmFwaHMpIHtcclxuICAgICAgICAvLyBTa2lwIGVtcHR5IHBhcmFncmFwaHNcclxuICAgICAgICBpZiAoIXBhcmFncmFwaCB8fCBwYXJhZ3JhcGgudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgICAgcG9zaXRpb24gKz0gMjsgLy8gKzIgZm9yIHBhcmFncmFwaCBicmVha1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFNhZmVseSBjYWxjdWxhdGUgd29yZCBjb3VudFxyXG4gICAgICAgIGNvbnN0IHBhcmFncmFwaFdvcmRzID0gcGFyYWdyYXBoLnRyaW0oKS5zcGxpdCgvXFxzKy8pLmZpbHRlcih3b3JkID0+IHdvcmQubGVuZ3RoID4gMCkubGVuZ3RoO1xyXG4gICAgICAgIHdvcmRDb3VudCArPSBwYXJhZ3JhcGhXb3JkcztcclxuICAgICAgICBcclxuICAgICAgICAvLyBJZiB3ZSd2ZSBleGNlZWRlZCB0aGUgd29yZHMgcGVyIHBhZ2UgdGhyZXNob2xkXHJcbiAgICAgICAgaWYgKHdvcmRDb3VudCA+PSB3b3Jkc1BlclBhZ2UpIHtcclxuICAgICAgICAgIC8vIEFkZCBhIHBhZ2UgYnJlYWsgYWZ0ZXIgdGhpcyBwYXJhZ3JhcGhcclxuICAgICAgICAgIHBvc2l0aW9uICs9IHBhcmFncmFwaC5sZW5ndGg7XHJcbiAgICAgICAgICBwYWdlTnVtYmVyKys7XHJcbiAgICAgICAgICBwYWdlQnJlYWtzLnB1c2goeyBwYWdlTnVtYmVyLCBwb3NpdGlvbiB9KTtcclxuICAgICAgICAgIHdvcmRDb3VudCA9IDA7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHBvc2l0aW9uICs9IHBhcmFncmFwaC5sZW5ndGggKyAyOyAvLyArMiBmb3IgcGFyYWdyYXBoIGJyZWFrXHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OKIFtQYWdlTWFya2VyU2VydmljZV0gQ2FsY3VsYXRlZCAke3BhZ2VCcmVha3MubGVuZ3RofSB3b3JkLWJhc2VkIHBhZ2UgYnJlYWtzYCk7XHJcbiAgICAgIHJldHVybiBwYWdlQnJlYWtzO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihg4p2MIFtQYWdlTWFya2VyU2VydmljZV0gRXJyb3IgY2FsY3VsYXRpbmcgd29yZC1iYXNlZCBwYWdlIGJyZWFrczpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuICB9XHJcbiAgXHJcbiAgLyoqXHJcbiAgICogQWRkIHBhZ2UgY291bnQgdG8gbWV0YWRhdGFcclxuICAgKiBAcGFyYW0ge09iamVjdH0gbWV0YWRhdGEgLSBUaGUgbWV0YWRhdGEgb2JqZWN0XHJcbiAgICogQHBhcmFtIHtudW1iZXJ9IHBhZ2VDb3VudCAtIFRoZSB0b3RhbCBwYWdlIGNvdW50XHJcbiAgICogQHJldHVybnMge09iamVjdH0gVXBkYXRlZCBtZXRhZGF0YVxyXG4gICAqL1xyXG4gIHN0YXRpYyBhZGRQYWdlTWV0YWRhdGEobWV0YWRhdGEsIHBhZ2VDb3VudCkge1xyXG4gICAgaWYgKCFtZXRhZGF0YSB8fCB0eXBlb2YgbWV0YWRhdGEgIT09ICdvYmplY3QnKSB7XHJcbiAgICAgIHJldHVybiB7IHBhZ2VDb3VudCB9O1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgLi4ubWV0YWRhdGEsXHJcbiAgICAgIHBhZ2VDb3VudFxyXG4gICAgfTtcclxuICB9XHJcbiAgXHJcbiAgLyoqXHJcbiAgICogQWRkIHNsaWRlIGNvdW50IHRvIG1ldGFkYXRhXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gVGhlIG1ldGFkYXRhIG9iamVjdFxyXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBzbGlkZUNvdW50IC0gVGhlIHRvdGFsIHNsaWRlIGNvdW50XHJcbiAgICogQHJldHVybnMge09iamVjdH0gVXBkYXRlZCBtZXRhZGF0YVxyXG4gICAqL1xyXG4gIHN0YXRpYyBhZGRTbGlkZU1ldGFkYXRhKG1ldGFkYXRhLCBzbGlkZUNvdW50KSB7XHJcbiAgICBpZiAoIW1ldGFkYXRhIHx8IHR5cGVvZiBtZXRhZGF0YSAhPT0gJ29iamVjdCcpIHtcclxuICAgICAgcmV0dXJuIHsgc2xpZGVDb3VudCB9O1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgLi4ubWV0YWRhdGEsXHJcbiAgICAgIHNsaWRlQ291bnRcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0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