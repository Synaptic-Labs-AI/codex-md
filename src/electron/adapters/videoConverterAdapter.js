/**
 * Video Converter Adapter
 * 
 * Adapts the backend video converter for use in the Electron main process.
 * Uses the BaseModuleAdapter for consistent module loading and error handling.
 * Adds word-based page number markers to the transcribed content.
 * 
 * Related files:
 * - backend/src/services/converter/multimedia/videoConverter.js: Original implementation
 * - src/electron/services/ElectronConversionService.js: Service using this adapter
 * - src/electron/adapters/BaseModuleAdapter.js: Base adapter class
 * - src/electron/services/ApiKeyService.js: API key management
 * - src/electron/services/PageMarkerService.js: Service for adding page markers
 */
const BaseModuleAdapter = require('./BaseModuleAdapter');
const ApiKeyService = require('../services/ApiKeyService');
const PageMarkerService = require('../services/PageMarkerService');
const StreamingFileService = require('../services/StreamingFileService');

// Create the video converter adapter
class VideoConverterAdapter extends BaseModuleAdapter {
  constructor() {
    super(
      'src/services/converter/multimedia/videoConverter.js',
      'default',
      {},
      false // Set validateDefaultExport to false for class-based exports
    );
    this.converterInstance = null;
  }
  
  /**
   * Initialize the video converter instance
   * @returns {Promise<void>}
   */
  async initializeConverter() {
    const module = await this.modulePromise;
    const VideoConverter = module.default;
    this.converterInstance = new VideoConverter();
  }
  
  /**
   * Convert video to Markdown with page markers
   * @param {Buffer} input - Video file buffer
   * @param {string} originalName - Original filename
   * @returns {Promise<{content: string, images: Array, pageCount: number}>}
   */
  async convertVideoToMarkdown(filePath, originalName, options = {}) {
    try {
      // Initialize converter if not already done
      if (!this.converterInstance) {
        await this.initializeConverter();
      }
      
      // Get API key from secure storage
      const apiKey = await ApiKeyService.getApiKey('openai');
      if (!apiKey) {
        throw new Error('OpenAI API key is required for video transcription');
      }
      
      console.log(`🎬 [VideoConverter] Processing video file: ${originalName}`);
      
      // Create a progress callback that handles both phases
      const progressCallback = (progress) => {
        console.log(`📊 [VideoConverter] Processing video: ${Math.round(progress)}%`);
        
        // Pass progress to the caller if provided
        if (options && options.onProgress) {
          options.onProgress(progress);
        }
      };
      
      // Add a method to report the current phase
      progressCallback.reportPhase = (phase) => {
        console.log(`📊 [VideoConverter] Current phase: ${phase}`);
      };
      
      // Stream and process the video file (0-50% progress)
      const { buffer, type } = await StreamingFileService.processVideoFile(filePath, {
        onProgress: progressCallback
      });
      
      console.log('🚀 [VideoConverterAdapter] Executing backend conversion method');
      
      // Call the convertToMarkdown method on the converter instance
      const result = await this.converterInstance.convertToMarkdown(buffer, {
        name: originalName,
        apiKey,
        mimeType: `video/${type}`,
        onProgress: progressCallback
      });
      
      // Include metadata from the converter in the result
      if (result.metadata) {
        result.metadata = { ...result.metadata };
      }
      
      console.log(`✅ [VideoConverter] Transcription successful:`, {
        hasContent: !!result?.content,
        contentLength: result?.content?.length || 0
      });
      
      // Validate the result
      if (!result || !result.content || result.content.trim() === '') {
        console.error(`❌ [VideoConverter] Empty transcription result`);
        throw new Error('Video transcription produced empty content');
      }
      
      // Log the result structure
      console.log(`🔍 [VideoConverter] Result structure:`, {
        hasContent: !!result?.content,
        hasSuccess: 'success' in result,
        contentLength: result?.content?.length || 0,
        resultKeys: Object.keys(result || {})
      });
      
      // Calculate page breaks based on word count
      console.log(`📄 [VideoConverter] Calculating word-based page breaks`);
      const pageBreaks = PageMarkerService.calculateWordBasedPageBreaks(result.content);
      
      if (pageBreaks.length > 0) {
        // Insert page markers
        result.content = PageMarkerService.insertPageMarkers(result.content, pageBreaks);
        
        // Add page count to metadata
        result.pageCount = pageBreaks.length + 1;
        
        console.log(`📄 [VideoConverter] Added ${result.pageCount} word-based page markers`);
      } else {
        // Single page document
        result.pageCount = 1;
        console.log(`📄 [VideoConverter] Transcription appears to be a single page`);
      }
      
      return result;
    } catch (error) {
      console.error('Video conversion failed:', error);
      return {
        success: false,
        error: error.message || 'Video conversion failed'
      };
    }
  }
}

// Create and export a singleton instance
const videoConverterAdapter = new VideoConverterAdapter();

module.exports = {
  convertVideoToMarkdown: (...args) => videoConverterAdapter.convertVideoToMarkdown(...args),
  videoConverterAdapter
};
