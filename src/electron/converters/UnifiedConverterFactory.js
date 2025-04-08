/**
 * UnifiedConverterFactory.js
 * 
 * Central factory for all file type conversions in the Electron main process.
 * Handles routing to appropriate converters based on file extension.
 * Standardizes the conversion interface across all file types.
 * Simplifies progress tracking and error handling.
 * 
 * This factory consolidates the functionality previously spread across multiple adapter files
 * and provides a single entry point for all conversion operations.
 * 
 * Related files:
 * - src/electron/services/ElectronConversionService.js: Uses this factory for conversions
 * - src/electron/ipc/handlers/conversion/index.js: Exposes conversion to renderer process
 * - backend/src/services/converter/ConverterRegistry.js: Backend converter implementations
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const ApiKeyService = require('../services/ApiKeyService');
const PageMarkerService = require('../services/PageMarkerService');
// Import shared utilities
const { getFileType } = require('@codex-md/shared/utils/files');
const { ProgressTracker } = require('@codex-md/shared/utils/conversion');

// Backend services - will be initialized asynchronously
let converterRegistry = null;

// Initialize backend services
(async function loadBackendServices() {
  try {
    // Import converter registry - the only import we need now
    const converterRegistryModule = await import('../../../backend/src/services/converter/ConverterRegistry.js');
    converterRegistry = converterRegistryModule.ConverterRegistry;
    console.log('✅ Successfully loaded backend converter registry');
  } catch (error) {
    console.error('❌ Failed to load backend services:', error);
    console.error('Some conversion functionality may be limited');
  }
})();

/**
 * Categorize file types for better organization
 */
const FILE_TYPE_CATEGORIES = {
  // Audio files
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  
  // Video files
  mp4: 'video',
  webm: 'video',
  avi: 'video',
  mov: 'video',
  
  // Document files
  pdf: 'document',
  docx: 'document',
  pptx: 'document',
  
  // Data files
  xlsx: 'data',
  csv: 'data',
  
  // Web content
  url: 'web',
  parenturl: 'web',
};

class UnifiedConverterFactory {
  constructor() {
    console.log('UnifiedConverterFactory initialized');
  }

  /**
   * Get the appropriate converter for a file type
   * @param {string} fileType - File extension without the dot
   * @returns {Object|null} - Converter info or null if not supported
   */
  getConverter(fileType) {
    if (!fileType) return null;
    
    // Normalize file type (remove dot, lowercase)
    const normalizedType = fileType.toLowerCase().replace(/^\./, '');
    
    // Check if converter registry is available
    if (!converterRegistry) {
      console.warn(`Converter registry not available yet, cannot check for converter for: ${fileType}`);
      return null;
    }
    
    // Special handling for URL types
    if (normalizedType === 'url' || normalizedType === 'parenturl') {
      console.log(`🔗 [UnifiedConverterFactory] Using direct URL converter for: ${normalizedType}`);
      
      // For URL types, we want to use the converter directly by type, not by extension
      const converter = converterRegistry.converters[normalizedType];
      if (converter) {
        return {
          converter: {
            ...converter,
            type: normalizedType
          },
          type: normalizedType,
          category: 'web'
        };
      }
    }
    
    // For all other types, get converter from registry by extension
    const converter = converterRegistry.getConverterByExtension(normalizedType);
    if (converter) {
      // Get category for the file type
      const category = FILE_TYPE_CATEGORIES[normalizedType] || 'document';
      
      return {
        converter,
        type: normalizedType,
        category
      };
    }
    
    console.warn(`No converter found for file type: ${fileType}`);
    return null;
  }

  /**
   * Convert a file to markdown using the appropriate converter
   * @param {string} filePath - Path to the file or URL string
   * @param {Object} options - Conversion options
   * @returns {Promise<Object>} - Conversion result
   */
  async convertFile(filePath, options = {}) {
    const startTime = Date.now();
    
    try {
      // Determine if this is a URL or a file
      const isUrl = options.fileType === 'url' || options.fileType === 'parenturl';
      
      // Get file details - handle URLs differently
      let fileName, fileType;
      
      if (isUrl) {
        // For URLs, use the passed fileType and create a filename from the URL
        fileType = options.fileType; // 'url' or 'parenturl'
        
        // Create a reasonable filename from the URL
        try {
          const urlObj = new URL(filePath);
          fileName = urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname : '');
        } catch (e) {
          // If URL parsing fails, use the raw string
          fileName = filePath;
        }
      } else {
        // For regular files, extract details from the path
        fileName = path.basename(filePath);
        fileType = options.fileType || path.extname(fileName).slice(1).toLowerCase();
      }
      
      console.log(`🔄 [UnifiedConverterFactory] Converting file:`, {
        path: filePath,
        type: fileType,
        isUrl: isUrl,
        options: {
          hasApiKey: !!options.apiKey,
          outputDir: options.outputDir ? 'specified' : 'default'
        }
      });
      
      // Get the appropriate converter
      const converterInfo = this.getConverter(fileType);
      if (!converterInfo) {
        throw new Error(`Unsupported file type: ${fileType}`);
      }
      
      // Create a progress tracker if callback provided
      const progressTracker = options.onProgress ? 
        new ProgressTracker(options.onProgress, 250) : null;
      
      if (progressTracker) {
        progressTracker.update(5, { status: 'initializing', fileType: fileType });
      }
      
      // Handle the conversion based on file type
      const result = await this.handleConversion(filePath, {
        ...options,
        fileType: fileType,
        fileName,
        progressTracker,
        converterInfo,
        isUrl
      });
      
      if (progressTracker) {
        progressTracker.update(100, { status: 'completed' });
      }
      
      console.log(`✅ [UnifiedConverterFactory] Conversion completed in ${Date.now() - startTime}ms:`, {
        path: filePath,
        type: fileType,
        isUrl: isUrl,
        success: !!result.success
      });
      
      return result;
      
    } catch (error) {
      console.error('❌ [UnifiedConverterFactory] Conversion failed:', {
        file: filePath,
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Standardize conversion result to ensure consistent format
   * @param {Object} result - Raw conversion result
   * @param {string} fileType - File type
   * @param {string} fileName - File name
   * @param {string} category - File category
   * @returns {Object} - Standardized result
   */
  standardizeResult(result, fileType, fileName, category) {
    // Ensure the result has all required properties
    return {
      success: result.success !== false,
      content: result.content || '',
      type: result.type || fileType,
      name: result.name || fileName,
      category: result.category || category,
      metadata: {
        ...(result.metadata || {}),
        converter: result.converter || 'unknown'
      },
      images: result.images || [],
      ...result
    };
  }

  /**
   * Unified conversion handler for all file types
   * @private
   */
  async handleConversion(filePath, options) {
    const { progressTracker, fileType, fileName, converterInfo, isUrl } = options;
    const { converter, category } = converterInfo;
    
    if (progressTracker) {
      progressTracker.update(10, { status: `reading_${fileType}` });
    }
    
    try {
      // Handle URL and parent URL differently since they don't need file reading
      if (isUrl) {
        if (progressTracker) {
          progressTracker.update(20, { status: `processing_${fileType}` });
        }
        
        // For URLs, filePath is actually the URL string
        const result = await converterRegistry.convertToMarkdown(fileType, filePath, {
          ...options,
          name: fileName,
          onProgress: (progress) => {
            if (progressTracker) {
              progressTracker.updateScaled(progress, 20, 90, { 
                status: typeof progress === 'object' ? progress.status : `processing_${fileType}`
              });
            }
          }
        });
        
        if (progressTracker) {
          progressTracker.update(95, { status: 'finalizing' });
        }
        
        return this.standardizeResult(result, fileType, fileName, category);
      }
      
      // For all other file types, read the file first
      const fileContent = fs.readFileSync(filePath);
      
      if (progressTracker) {
        progressTracker.update(20, { status: `converting_${fileType}` });
      }
      
      // Special handling for PDF files to include OCR options
      if (fileType === 'pdf') {
        console.log('🔄 [UnifiedConverterFactory] Converting PDF with options:', {
          useOcr: options.useOcr,
          hasMistralApiKey: !!options.mistralApiKey,
          preservePageInfo: true
        });
      }
      
      // Use the converter registry for all file types
      const conversionOptions = {
        name: fileName,
        apiKey: options.apiKey,
        useOcr: options.useOcr,
        mistralApiKey: options.mistralApiKey,
        preservePageInfo: true,
        onProgress: (progress) => {
          if (progressTracker) {
            progressTracker.updateScaled(progress, 20, 90, { status: `converting_${fileType}` });
          }
        }
      };
      
      const result = await converterRegistry.convertToMarkdown(fileType, fileContent, conversionOptions);
      
      if (progressTracker) {
        progressTracker.update(95, { status: 'finalizing' });
      }
      
      return this.standardizeResult(result, fileType, fileName, category);
    } catch (error) {
      console.error(`❌ [UnifiedConverterFactory] ${fileType.toUpperCase()} conversion error:`, error);
      return {
        success: false,
        error: `${fileType.toUpperCase()} conversion failed: ${error.message}`,
        content: `# Conversion Error\n\nFailed to convert ${fileType.toUpperCase()} file: ${error.message}`,
        type: fileType,
        name: fileName,
        category: category || 'unknown'
      };
    }
  }
}

// Create and export a singleton instance
const unifiedConverterFactory = new UnifiedConverterFactory();

module.exports = unifiedConverterFactory;
