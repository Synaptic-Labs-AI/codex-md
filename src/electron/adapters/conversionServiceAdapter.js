/**
 * ConversionServiceAdapter.js
 * 
 * Enhanced adapter for the backend ConversionService that bridges between Electron and backend.
 * Handles module loading and method execution for conversion operations.
 * Provides special handling for platform-specific functionality while delegating to backend
 * for most conversions.
 * 
 * Related files:
 * - backend/src/services/ConversionService.js: Original implementation
 * - src/electron/services/ElectronConversionService.js: Consumer of this adapter
 * - src/electron/adapters/BaseModuleAdapter.js: Base adapter class
 * - src/electron/services/PageMarkerService.js: Page marker service
 * - src/electron/services/BrowserService.js: Browser service for URL conversions
 */

const BaseModuleAdapter = require('./BaseModuleAdapter');
const PageMarkerService = require('../services/PageMarkerService');
const BrowserService = require('../services/BrowserService');
const path = require('path');

// Import specialized adapters for platform-specific functionality
const { convertPdfToMarkdown } = require('./pdfConverterAdapter');
const { convertVideoToMarkdown } = require('./videoConverterAdapter');
const { convertAudioToMarkdown } = require('./audioConverterAdapter');
const { convertUrl } = require('./urlConverterAdapter');
const { convertParentUrl } = require('./parentUrlConverterAdapter');
const { convertXlsxToMarkdown } = require('./xlsxConverterAdapter');

// Default browser options with modern browser settings
const defaultBrowserOptions = {
  includeImages: true,
  includeMeta: true,
  handleDynamicContent: true,
  waitForContent: true,
  maxWaitTime: 45000,
  got: {
    headers: {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    },
    timeout: 30000,
    retry: {
      limit: 2,
      methods: ['GET'],
      statusCodes: [408, 429, 500, 502, 503, 504]
    }
  }
};

class ConversionServiceAdapter extends BaseModuleAdapter {
  constructor() {
    super(
      'src/services/ConversionService.js',
      null, // No default export
      {
        // Named exports configuration
        ConversionService: true
      },
      false // Don't validate default export
    );
    
    // Initialize specialized converters map
    this.specializedConverters = {
      'pdf': convertPdfToMarkdown,
      'video': convertVideoToMarkdown,
      'mp4': convertVideoToMarkdown,
      'webm': convertVideoToMarkdown,
      'avi': convertVideoToMarkdown,
      'audio': convertAudioToMarkdown,
      'mp3': convertAudioToMarkdown,
      'wav': convertAudioToMarkdown,
      'url': convertUrl,
      'parenturl': convertParentUrl,
      'xlsx': convertXlsxToMarkdown,
      'xls': convertXlsxToMarkdown
    };
    
    console.log('🔄 [ConversionServiceAdapter] Initializing adapter for backend ConversionService');
    console.log('📋 [ConversionServiceAdapter] Registered specialized converters:', Object.keys(this.specializedConverters));
  }
  
  /**
   * Get file category for a specific file type
   * @param {string} type - The file type or category
   * @param {string} fileType - The file extension
   * @returns {string} The category name
   */
  getFileCategory(type, fileType) {
    // Simple logic based on file extension
    const normalizedType = type?.toLowerCase();
    const normalizedFileType = fileType?.toLowerCase();
    
    // Handle presentation files
    if (normalizedFileType === 'pptx' || normalizedFileType === 'ppt') {
      return 'text';
    }
    
    // Audio types
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(normalizedFileType)) {
      return 'multimedia';
    }
    
    // Video types
    if (['mp4', 'webm', 'avi', 'mov'].includes(normalizedFileType)) {
      return 'multimedia';
    }
    
    // Document types
    if (['pdf', 'docx', 'pptx', 'ppt'].includes(normalizedFileType)) {
      return 'text';
    }
    
    // Data files
    if (['csv', 'xlsx', 'xls'].includes(normalizedFileType)) {
      return 'data';
    }
    
    // Web content
    if (['url', 'parenturl'].includes(normalizedType)) {
      return 'web';
    }
    
    // Default to text for unknown types
    return 'text';
  }
  
  /**
   * Convert content to Markdown
   * @param {Object} data - Conversion data
   * @param {string} data.type - Content type (pdf, docx, url, etc.)
   * @param {Buffer|string} data.content - Content to convert
   * @param {string} data.name - File name
   * @param {string} [data.apiKey] - API key for services that require it
   * @param {Object} [data.options] - Conversion options
   * @returns {Promise<Object>} Conversion result
   */
  async convert(data) {
    console.log(`🔄 [ConversionServiceAdapter] Converting ${data.type} to Markdown`);
    console.log(`📊 [ConversionServiceAdapter] Content stats:`, {
      type: data.type,
      name: data.name,
      contentType: typeof data.content,
      isBuffer: Buffer.isBuffer(data.content),
      contentLength: data.content ? (Buffer.isBuffer(data.content) ? data.content.length : (typeof data.content === 'string' ? data.content.length : 'unknown')) : 'null',
      hasApiKey: !!data.apiKey,
      options: data.options ? Object.keys(data.options) : []
    });
    
    try {
      const normalizedType = data.type.toLowerCase();
      
      // Check if we have a specialized converter for this type
      if (this.specializedConverters[normalizedType]) {
        console.log(`🔄 [ConversionServiceAdapter] Using specialized converter for ${normalizedType}`);
        
        // Handle URL types
        if (normalizedType === 'url') {
          return await this.specializedConverters.url(data.content, data.options);
        }
        
        // Handle parent URL types
        if (normalizedType === 'parenturl') {
          return await this.specializedConverters.parenturl(data.content, data.options);
        }
        
        // Handle PDF files
        if (normalizedType === 'pdf') {
          return await this.specializedConverters.pdf(data.content, data.name, data.apiKey);
        }
        
        // Handle video files
        if (normalizedType === 'video' || ['mp4', 'webm', 'avi'].includes(normalizedType)) {
          // For video files, we need the file path rather than the content
          if (data.filePath) {
            return await this.specializedConverters.video(data.filePath, data.name);
          } else {
            console.log(`⚠️ [ConversionServiceAdapter] No file path provided for video, using backend converter`);
          }
        }
        
        // Handle audio files
        if (normalizedType === 'audio' || ['mp3', 'wav'].includes(normalizedType)) {
          return await this.specializedConverters.audio(data.content, data.name);
        }
        
        // Handle XLSX files
        if (normalizedType === 'xlsx' || normalizedType === 'xls') {
          return await this.specializedConverters.xlsx(data.content, data.name, data.apiKey);
        }
      }
      
      // For all other types, use the backend ConversionService
      console.log(`🔄 [ConversionServiceAdapter] Using backend ConversionService for ${normalizedType}`);
      
      // Create a new instance of the ConversionService class
      const ConversionServiceClass = await this.executeMethodFromExport('ConversionService', []);
      const conversionService = new ConversionServiceClass();
      
      // Call the convert method
      const result = await conversionService.convert(data);
      
      // Process the result if needed (e.g., add page markers)
      if (result && result.content) {
        // Add page markers for document types if not already present
        if (['docx', 'html', 'htm'].includes(normalizedType) && !result.content.includes('<!-- PAGE BREAK -->')) {
          console.log(`📄 [ConversionServiceAdapter] Adding page markers for ${normalizedType}`);
          
          // Calculate page breaks based on word count
          const pageBreaks = PageMarkerService.calculateWordBasedPageBreaks(result.content);
          
          if (pageBreaks.length > 0) {
            // Insert page markers
            result.content = PageMarkerService.insertPageMarkers(result.content, pageBreaks);
            
            // Add page count to result
            result.pageCount = pageBreaks.length + 1;
            
            console.log(`📄 [ConversionServiceAdapter] Added ${result.pageCount} page markers`);
          } else {
            // Single page document
            result.pageCount = 1;
          }
        }
      }
      
      return result;
    } catch (error) {
      console.error(`❌ [ConversionServiceAdapter] Conversion error:`, error);
      throw error;
    }
  }
  
  /**
   * Convert multiple items in batch
   * @param {Array<Object>} items - Array of items to convert
   * @returns {Promise<Object>} Batch conversion result
   */
  async convertBatch(items) {
    console.log(`🔄 [ConversionServiceAdapter] Converting batch of ${items.length} items`);
    
    try {
      // Create a new instance of the ConversionService class
      const ConversionServiceClass = await this.executeMethodFromExport('ConversionService', []);
      const conversionService = new ConversionServiceClass();
      
      // Call the convertBatch method
      return await conversionService.convertBatch(items);
    } catch (error) {
      console.error(`❌ [ConversionServiceAdapter] Batch conversion error:`, error);
      throw error;
    }
  }
}

// Create and export a singleton instance
const conversionServiceAdapter = new ConversionServiceAdapter();

module.exports = conversionServiceAdapter;
