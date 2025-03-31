/**
 * Audio Converter Adapter
 * 
 * Adapts the backend audio converter for use in the Electron main process.
 * Uses the BaseModuleAdapter for consistent module loading and error handling.
 * Adds word-based page number markers to the transcribed content.
 * 
 * Related files:
 * - backend/src/services/converter/multimedia/audioconverter.js: Original implementation
 * - src/electron/services/ElectronConversionService.js: Service using this adapter
 * - src/electron/adapters/BaseModuleAdapter.js: Base adapter class
 * - src/electron/services/ApiKeyService.js: API key management
 * - src/electron/services/PageMarkerService.js: Service for adding page markers
 */
const BaseModuleAdapter = require('./BaseModuleAdapter');
const ApiKeyService = require('../services/ApiKeyService');
const PageMarkerService = require('../services/PageMarkerService');

// Create the audio converter adapter
class AudioConverterAdapter extends BaseModuleAdapter {
  constructor() {
    super(
      "src/services/converter/multimedia/audioconverter.js",
      "convertAudioToMarkdown"
    );
  }
  
  /**
   * Convert audio to Markdown with page markers
   * @param {Buffer} input - Audio file buffer
   * @param {string} originalName - Original filename
   * @returns {Promise<{content: string, images: Array, pageCount: number}>}
   */
  async convertAudioToMarkdown(input, originalName) {
    try {
      // Get API key from secure storage
      const apiKey = await ApiKeyService.getApiKey("openai");
      if (!apiKey) {
        throw new Error("OpenAI API key is required for audio transcription");
      }
      
      console.log(`🎵 [AudioConverter] Converting audio file: ${originalName}`);
      
      // Determine MIME type from file extension
      const fileExt = originalName.split(".").pop().toLowerCase();
      const mimeType = `audio/${fileExt}`;
      
      // Call the backend audio converter with options
      const result = await this.executeMethod("default", [input, {
        name: originalName,
        apiKey,
        mimeType
      }]);
      
      console.log(`✅ [AudioConverter] Transcription successful:`, {
        hasContent: !!result?.content,
        contentLength: result?.content?.length || 0
      });
      
      // Validate the result
      if (!result || !result.content || result.content.trim() === "") {
        console.error(`❌ [AudioConverter] Empty transcription result`);
        throw new Error("Audio transcription produced empty content");
      }
      
      // Calculate page breaks based on word count
      console.log(`📄 [AudioConverter] Calculating word-based page breaks`);
      const pageBreaks = PageMarkerService.calculateWordBasedPageBreaks(result.content);
      
      if (pageBreaks.length > 0) {
        // Insert page markers
        result.content = PageMarkerService.insertPageMarkers(result.content, pageBreaks);
        
        // Add page count to metadata
        result.pageCount = pageBreaks.length + 1;
        
        console.log(`📄 [AudioConverter] Added ${result.pageCount} word-based page markers`);
      } else {
        // Single page document
        result.pageCount = 1;
        console.log(`📄 [AudioConverter] Transcription appears to be a single page`);
      }
      
      return result;
    } catch (error) {
      console.error("Audio conversion failed:", error);
      return {
        success: false,
        error: error.message || "Audio conversion failed"
      };
    }
  }
}

// Create and export a singleton instance
const audioConverterAdapter = new AudioConverterAdapter();

module.exports = {
  convertAudioToMarkdown: (...args) => audioConverterAdapter.convertAudioToMarkdown(...args),
  audioConverterAdapter
};
