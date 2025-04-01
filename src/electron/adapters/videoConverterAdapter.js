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
      'videoConverter'
    );
    
    // Log available methods after initialization
    this.modulePromise.then(module => {
      console.log('🔍 [VideoConverter] Available methods:', Object.keys(module.videoConverter));
    }).catch(error => {
      console.error('❌ [VideoConverter] Failed to load module:', error);
    });
  }
  
  /**
   * Convert video to Markdown with page markers
   * @param {Buffer} input - Video file buffer
   * @param {string} originalName - Original filename
   * @returns {Promise<{content: string, images: Array, pageCount: number}>}
   */
  async convertVideoToMarkdown(filePath, originalName) {
    try {
      // Get API key from secure storage
      const apiKey = await ApiKeyService.getApiKey('openai');
      if (!apiKey) {
        throw new Error('OpenAI API key is required for video transcription');
      }
      
      console.log(`🎬 [VideoConverter] Processing video file: ${originalName}`);
      
      // Stream and process the video file
      const { buffer, type } = await StreamingFileService.processVideoFile(filePath, {
        onProgress: (progress) => {
          console.log(`📊 [VideoConverter] Reading video: ${Math.round(progress)}%`);
        }
      });
      
      // Call the backend video converter with options
      const result = await this.executeMethod('convertToMarkdown', [buffer, { 
        name: originalName,
        apiKey,
        mimeType: `video/${type}`
      }]);
      
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
