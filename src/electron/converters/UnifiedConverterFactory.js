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
 * - backend/src/services/converter/textConverterFactory.js: Backend converter implementations
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
let textConverterFactory = null;
let audioConverter = null;
let videoConverter = null;
let pdfConverter = null;
let urlConverter = null;
let parentUrlConverter = null;

// Initialize backend services
(async function loadBackendServices() {
  try {
    // Import text converter factory
    const textConverterModule = await import('../../../backend/src/services/converter/textConverterFactory.js');
    textConverterFactory = textConverterModule.textConverterFactory;
    console.log('✅ Successfully loaded backend text converter factory');
    
    // Import audio converter
    const audioConverterModule = await import('../../../backend/src/services/converter/multimedia/audioconverter.js');
    audioConverter = audioConverterModule.default;
    console.log('✅ Successfully loaded backend audio converter');
    
    // Import video converter
    const videoConverterModule = await import('../../../backend/src/services/converter/multimedia/videoConverter.js');
    videoConverter = videoConverterModule.default;
    console.log('✅ Successfully loaded backend video converter');
    
    // Import PDF converter
    const pdfConverterModule = await import('../../../backend/src/services/converter/pdf/PdfConverterFactory.js');
    pdfConverter = pdfConverterModule.default;
    console.log('✅ Successfully loaded backend PDF converter');
    
    // Import URL converter
    const urlConverterModule = await import('../../../backend/src/services/converter/web/urlConverter.js');
    urlConverter = urlConverterModule.urlConverter;
    console.log('✅ Successfully loaded backend URL converter');
    
    // Import parent URL converter
    const parentUrlConverterModule = await import('../../../backend/src/services/converter/web/parentUrlConverter.js');
    parentUrlConverter = parentUrlConverterModule.convertParentUrlToMarkdown;
    console.log('✅ Successfully loaded backend parent URL converter');
  } catch (error) {
    console.error('❌ Failed to load backend services:', error);
    console.error('Some conversion functionality may be limited');
  }
})();

class UnifiedConverterFactory {
  constructor() {
    // Initialize converter registry
    this.converters = {
      // Media files
      mp3: { handler: this.handleAudioConversion.bind(this), type: 'audio' },
      wav: { handler: this.handleAudioConversion.bind(this), type: 'audio' },
      ogg: { handler: this.handleAudioConversion.bind(this), type: 'audio' },
      flac: { handler: this.handleAudioConversion.bind(this), type: 'audio' },
      
      // Video files
      mp4: { handler: this.handleVideoConversion.bind(this), type: 'video' },
      webm: { handler: this.handleVideoConversion.bind(this), type: 'video' },
      avi: { handler: this.handleVideoConversion.bind(this), type: 'video' },
      mov: { handler: this.handleVideoConversion.bind(this), type: 'video' },
      
      // Document files - handled by textConverterFactory
      pdf: { handler: this.handleGenericConversion.bind(this), type: 'document' },
      docx: { handler: this.handleGenericConversion.bind(this), type: 'document' },
      pptx: { handler: this.handleGenericConversion.bind(this), type: 'document' },
      
      // Data files
      xlsx: { handler: this.handleGenericConversion.bind(this), type: 'data' },
      csv: { handler: this.handleGenericConversion.bind(this), type: 'data' },
      
      // Web content
      url: { handler: this.handleUrlConversion.bind(this), type: 'web' },
      parenturl: { handler: this.handleParentUrlConversion.bind(this), type: 'web' },
    };
    
    console.log('UnifiedConverterFactory initialized with converters for:', Object.keys(this.converters));
  }

  /**
   * Get the appropriate converter for a file type
   * @param {string} fileType - File extension without the dot
   * @returns {Object|null} - Converter handler or null if not supported
   */
  getConverter(fileType) {
    if (!fileType) return null;
    
    // Normalize file type (remove dot, lowercase)
    const normalizedType = fileType.toLowerCase().replace(/^\./, '');
    
    // Return the converter if we have a direct match
    if (this.converters[normalizedType]) {
      return this.converters[normalizedType];
    }
    
    // Try to find a converter using textConverterFactory if available
    if (textConverterFactory) {
      const backendConverter = textConverterFactory.getConverterByExtension(normalizedType);
      if (backendConverter) {
        return {
          handler: this.handleGenericConversion.bind(this),
          type: 'document'
        };
      }
    } else {
      console.warn(`Text converter factory not available yet, cannot check for converter for: ${fileType}`);
    }
    
    console.warn(`No converter found for file type: ${fileType}`);
    return null;
  }

  /**
   * Convert a file to markdown using the appropriate converter
   * @param {string} filePath - Path to the file
   * @param {Object} options - Conversion options
   * @returns {Promise<Object>} - Conversion result
   */
  async convertFile(filePath, options = {}) {
    const startTime = Date.now();
    
    try {
      // Get file details
      const fileName = path.basename(filePath);
      const fileExt = path.extname(fileName).slice(1).toLowerCase();
      
      console.log(`🔄 [UnifiedConverterFactory] Converting file:`, {
        path: filePath,
        type: fileExt,
        options: {
          hasApiKey: !!options.apiKey,
          outputDir: options.outputDir ? 'specified' : 'default'
        }
      });
      
      // Get the appropriate converter
      const converter = this.getConverter(fileExt);
      if (!converter) {
        throw new Error(`Unsupported file type: ${fileExt}`);
      }
      
      // Create a progress tracker if callback provided
      const progressTracker = options.onProgress ? 
        new ProgressTracker(options.onProgress, 250) : null;
      
      if (progressTracker) {
        progressTracker.update(5, { status: 'initializing', fileType: fileExt });
      }
      
      // Call the appropriate handler
      const result = await converter.handler(filePath, {
        ...options,
        fileType: fileExt,
        fileName,
        progressTracker
      });
      
      if (progressTracker) {
        progressTracker.update(100, { status: 'completed' });
      }
      
      console.log(`✅ [UnifiedConverterFactory] Conversion completed in ${Date.now() - startTime}ms:`, {
        path: filePath,
        type: fileExt,
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
   * Handle audio file conversion
   * @private
   */
  async handleAudioConversion(filePath, options) {
    const { progressTracker, fileName } = options;
    
    if (progressTracker) {
      progressTracker.update(10, { status: 'preparing_audio' });
    }
    
    // Check if audio converter is available
    if (!audioConverter) {
      console.error('Audio converter not available');
      return {
        success: false,
        error: 'Audio converter not available. Backend services may still be initializing.'
      };
    }
    
    try {
      // Read the file
      const fileContent = fs.readFileSync(filePath);
      
      // Create a new instance of the audio converter
      const converter = new audioConverter();
      
      // Convert the audio
      const result = await converter.convertToMarkdown(fileContent, {
        name: fileName,
        apiKey: options.apiKey
      });
      
      if (progressTracker) {
        progressTracker.update(95, { status: 'finalizing' });
      }
      
      return result;
    } catch (error) {
      console.error('Audio conversion error:', error);
      return {
        success: false,
        error: `Audio conversion failed: ${error.message}`
      };
    }
  }

  /**
   * Handle video file conversion
   * @private
   */
  async handleVideoConversion(filePath, options) {
    const { progressTracker, fileName } = options;
    
    if (progressTracker) {
      progressTracker.update(10, { status: 'preparing_video' });
    }
    
    // Check if video converter is available
    if (!videoConverter) {
      console.error('Video converter not available');
      return {
        success: false,
        error: 'Video converter not available. Backend services may still be initializing.'
      };
    }
    
    try {
      // Read the file
      const fileContent = fs.readFileSync(filePath);
      
      // Create a new instance of the video converter
      const converter = new videoConverter();
      
      // Convert the video
      const result = await converter.convertToMarkdown(fileContent, {
        name: fileName,
        apiKey: options.apiKey,
        onProgress: (progress) => {
          if (progressTracker) {
            progressTracker.updateScaled(progress, 10, 90, { status: 'transcribing_video' });
          }
        }
      });
      
      if (progressTracker) {
        progressTracker.update(95, { status: 'finalizing' });
      }
      
      return result;
    } catch (error) {
      console.error('Video conversion error:', error);
      return {
        success: false,
        error: `Video conversion failed: ${error.message}`
      };
    }
  }

  /**
   * Handle generic file conversion using textConverterFactory
   * @private
   */
  async handleGenericConversion(filePath, options) {
    const { progressTracker, fileType, fileName } = options;
    
    if (progressTracker) {
      progressTracker.update(10, { status: 'reading_file' });
    }
    
    // Check if text converter factory is available
    if (!textConverterFactory) {
      console.error('Text converter factory not available');
      return {
        success: false,
        error: 'Text converter factory not available. Backend services may still be initializing.'
      };
    }
    
    try {
      // Read the file
      const fileContent = fs.readFileSync(filePath);
      
      if (progressTracker) {
        progressTracker.update(20, { status: 'converting' });
      }
      
      // Use the text converter factory
      const result = await textConverterFactory.convertToMarkdown(fileType, fileContent, {
        name: fileName,
        apiKey: options.apiKey
      });
      
      if (progressTracker) {
        progressTracker.update(90, { status: 'finalizing' });
      }
      
      return result;
    } catch (error) {
      console.error('Generic conversion error:', error);
      return {
        success: false,
        error: `Conversion failed: ${error.message}`
      };
    }
  }

  /**
   * Handle URL conversion
   * @private
   */
  async handleUrlConversion(urlString, options) {
    const { progressTracker } = options;
    
    if (progressTracker) {
      progressTracker.update(10, { status: 'fetching_url' });
    }
    
    // Check if URL converter is available
    if (!urlConverter) {
      console.error('URL converter not available');
      return {
        success: false,
        error: 'URL converter not available. Backend services may still be initializing.'
      };
    }
    
    try {
      // Use the URL converter
      const result = await urlConverter.convertToMarkdown(urlString, {
        ...options,
        onProgress: (progress) => {
          if (progressTracker) {
            progressTracker.updateScaled(progress, 10, 90, { status: 'processing_url' });
          }
        }
      });
      
      if (progressTracker) {
        progressTracker.update(95, { status: 'finalizing' });
      }
      
      return result;
    } catch (error) {
      console.error('URL conversion error:', error);
      return {
        success: false,
        error: `URL conversion failed: ${error.message}`
      };
    }
  }

  /**
   * Handle parent URL (website) conversion
   * @private
   */
  async handleParentUrlConversion(urlString, options) {
    const { progressTracker } = options;
    
    if (progressTracker) {
      progressTracker.update(10, { status: 'analyzing_website' });
    }
    
    // Check if parent URL converter is available
    if (!parentUrlConverter) {
      console.error('Parent URL converter not available');
      return {
        success: false,
        error: 'Parent URL converter not available. Backend services may still be initializing.'
      };
    }
    
    try {
      // Use the parent URL converter
      const result = await parentUrlConverter(urlString, {
        ...options,
        onProgress: (progress) => {
          if (progressTracker) {
            progressTracker.updateScaled(progress, 10, 90, { 
              status: typeof progress === 'object' ? progress.status : 'processing_website'
            });
          }
        }
      });
      
      if (progressTracker) {
        progressTracker.update(95, { status: 'finalizing' });
      }
      
      return result;
    } catch (error) {
      console.error('Parent URL conversion error:', error);
      return {
        success: false,
        error: `Parent URL conversion failed: ${error.message}`
      };
    }
  }
}

// Create and export a singleton instance
const unifiedConverterFactory = new UnifiedConverterFactory();

module.exports = unifiedConverterFactory;
