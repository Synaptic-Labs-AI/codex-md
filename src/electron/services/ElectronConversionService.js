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
    
    // Import PDF converter
    const pdfConverterModule = await import('../../../backend/src/services/converter/pdf/PdfConverterFactory.js');
    if (pdfConverterModule.default) {
      registerConverter('pdf', pdfConverterModule.default);
      console.log('✅ Registered PDF converter factory');
    }
    
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
      
      // Determine if we're handling binary content (audio/video/pdf)
      const isAudioVideo = options.isTemporary && (options.type === 'audio' || options.type === 'video');
      const isPdf = options.type === 'pdf';
      
      // Get file details based on input type
      // For binary content, use the name from options
      const isBinaryBuffer = Buffer.isBuffer(filePath) || (options.isTemporary && (isAudioVideo || isPdf));
      
      console.log('📄 File input details:', {
        isBuffer: Buffer.isBuffer(filePath),
        isTemporary: options.isTemporary,
        isAudioVideo,
        isPdf,
        isBinaryBuffer,
        originalFileName: options.originalFileName,
        name: options.name,
        type: options.type
      });
      
      // Use options.originalFileName or options.name for binary content, otherwise extract from filePath
      const fileName = isBinaryBuffer
        ? (options.originalFileName || options.name || 'unnamed')
        : path.basename(filePath);
      
      // Determine file type from name or options
      const fileType = isBinaryBuffer
        ? (options.type || (options.originalFileName ? path.extname(options.originalFileName).slice(1).toLowerCase() : 'bin'))
        : path.extname(fileName).slice(1).toLowerCase();
      
      console.log(`📄 Determined file details: fileName=${fileName}, fileType=${fileType}`);
      const cleanedFileName = cleanTemporaryFilename(fileName);
      const finalBaseName = path.basename(cleanedFileName, path.extname(cleanedFileName));
      let fileContent;

      // Handle binary content (audio/video/pdf)
      const isBinaryContent = (isAudioVideo || isPdf) && options.isTemporary;
      
      if (isBinaryContent) {
        console.log(`Processing binary content as ${options.type}: ${fileName}`);
        fileContent = filePath; // filePath is actually the buffer
      } else if (typeof filePath === 'string') {
        // For file paths, validate file exists and read it
        try {
          const fileStats = await this.fileSystem.getStats(filePath);
          if (!fileStats.success) {
            throw new Error(`File not found or inaccessible: ${filePath}`);
          }
          
          // Read file asynchronously
          fileContent = await readFileAsync(filePath);
        } catch (error) {
          console.error(`Error reading file: ${filePath}`, error);
          throw new Error(`File not found or inaccessible: ${filePath}`);
        }
      } else {
        // If filePath is not a string and not binary content, it's invalid
        throw new Error('Invalid input: Expected a file path or buffer');
      }
      
      progressTracker.update(10);
      
      // Use the shared converters module directly
      const conversionResult = await convertToMarkdown(fileType, fileContent, {
        name: fileName,
        apiKey: options.apiKey,
        useOcr: options.useOcr,
        mistralApiKey: options.mistralApiKey,
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
