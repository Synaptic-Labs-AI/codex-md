/**
 * ElectronConversionService.js
 * Handles document conversion using native file system operations in Electron.
 * Coordinates conversion processes and delegates to the shared conversion utilities.
 */

const path = require('path');
const { app } = require('electron');
const { promisify } = require('util');
const fs = require('fs');
const readFileAsync = promisify(fs.readFile);
const FileSystemService = require('./FileSystemService');
const ConversionResultManager = require('./ConversionResultManager');
const sharedUtils = require('@codex-md/shared');
const { getFileType, cleanTemporaryFilename } = sharedUtils.utils.files;
const { 
  ProgressTracker, 
  convertToMarkdown, 
  registerConverter,
  registerConverterFactory
} = sharedUtils.utils.conversion;

// Initialize backend converters
(async function() {
  try {
    // Import backend converters
    const textConverterModule = await import('../../../backend/src/services/converter/textConverterFactory.js');
    const textConverterFactory = textConverterModule.textConverterFactory;
    registerConverterFactory('textFactory', textConverterFactory);
    
    // Import audio converter
    const audioConverterModule = await import('../../../backend/src/services/converter/multimedia/audioconverter.js');
    if (audioConverterModule.default) {
      registerConverter('audio', audioConverterModule.default);
      ['mp3', 'wav', 'ogg', 'flac'].forEach(format => {
        registerConverter(format, audioConverterModule.default);
      });
    }
    
    // Import video converter  
    const videoConverterModule = await import('../../../backend/src/services/converter/multimedia/videoConverter.js');
    if (videoConverterModule.default) {
      registerConverter('video', videoConverterModule.default);
      ['mp4', 'webm', 'avi', 'mov'].forEach(format => {
        registerConverter(format, videoConverterModule.default);
      });
    }
    
    console.log('✅ Backend converters registered successfully');
  } catch (error) {
    console.error('❌ Failed to register backend converters:', error);
  }
})();

class ElectronConversionService {
  constructor() {
    this.fileSystem = FileSystemService;
    this.resultManager = ConversionResultManager;
    this.progressUpdateInterval = 250; // Update progress every 250ms
    this.defaultOutputDir = path.join(app.getPath('userData'), 'conversions');
    console.log('ElectronConversionService initialized with default output directory:', this.defaultOutputDir);
  }

  /**
   * Converts a file to markdown format
   */
  async convert(filePath, options = {}) {
    const startTime = Date.now();
    
    try {
      // Create a progress tracker
      const progressTracker = new ProgressTracker(options.onProgress, this.progressUpdateInterval);
      progressTracker.update(5);
      
      // Determine if we're handling audio/video content
      const isAudioVideo = options.isTemporary && (options.type === 'audio' || options.type === 'video');
      
      // Get file details based on input type
      const fileName = isAudioVideo
        ? (options.name || 'unnamed')
        : path.basename(filePath);
      const fileType = isAudioVideo
        ? (options.name ? path.extname(options.name).slice(1).toLowerCase() : options.type || 'mp3')
        : path.extname(fileName).slice(1).toLowerCase();
      const cleanedFileName = cleanTemporaryFilename(fileName);
      const finalBaseName = path.basename(cleanedFileName, path.extname(cleanedFileName));
      let fileContent;

      if (isAudioVideo && options.isTemporary) {
        fileContent = filePath; // filePath is actually the buffer for audio/video
      } else {
        // Validate file exists
        const fileStats = await this.fileSystem.getStats(filePath);
        if (!fileStats.success) {
          throw new Error(`File not found or inaccessible: ${filePath}`);
        }
        
        // Read file asynchronously for non-audio/video files
        fileContent = await readFileAsync(filePath);
      }
      
      progressTracker.update(10);
      
      // Use the shared converters module directly
      const conversionResult = await convertToMarkdown(fileType, fileContent, {
        name: fileName,
        apiKey: options.apiKey,
        onProgress: (progress) => progressTracker.update(progress)
      });
      
      progressTracker.update(90);
      
      // Extract content from result
      const content = conversionResult.content || (conversionResult.buffer ? conversionResult.buffer.toString() : '');
      
      if (!content) {
        throw new Error('Conversion produced empty content');
      }
      
      // Determine file category
      const fileCategory = getFileType(fileName) || 'text';
      
      // Save the conversion result using the ConversionResultManager
      const result = await this.resultManager.saveConversionResult({
        content: content,
        metadata: {
          originalFile: cleanedFileName,
          type: fileType,
          category: fileCategory,
          ...(conversionResult.pageCount ? { pageCount: conversionResult.pageCount } : {}),
          ...(conversionResult.slideCount ? { slideCount: conversionResult.slideCount } : {}),
          ...(conversionResult.metadata || {})
        },
        images: conversionResult.images || [],
        name: finalBaseName,
        type: fileType,
        outputDir: options.outputDir,
        options
      });
      
      progressTracker.update(100);
      
      console.log(`✅ File conversion completed in ${Date.now() - startTime}ms:`, {
        file: filePath,
        outputPath: result.outputPath
      });
      
      return result;
      
    } catch (error) {
      console.error('❌ Conversion failed:', {
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
   * Sets up the output directory for conversions
   */
  async setupOutputDirectory(outputDir) {
    try {
      const dirToSetup = outputDir || this.defaultOutputDir;
      await this.fileSystem.createDirectory(dirToSetup);
      console.log('📁 Output directory ready:', dirToSetup);
    } catch (error) {
      console.error('❌ Failed to set up output directory:', error);
      throw error;
    }
  }
}

module.exports = new ElectronConversionService();
