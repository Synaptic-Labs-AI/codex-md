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
const { 
  getFileType, 
  cleanTemporaryFilename, 
  getFileHandlingInfo,
  HANDLING_TYPES,
  CONVERTER_CONFIG
} = sharedUtils.utils.files;
const { 
  ProgressTracker, 
  convertToMarkdown, 
  registerConverter,
  registerConverterFactory
} = sharedUtils.utils.conversion;

// Log available file handling capabilities
console.log('📄 Initialized with file handling:', {
  handlingTypes: HANDLING_TYPES,
  fileConfig: CONVERTER_CONFIG
});

// Initialize backend converters
(async function() {
  try {
    // Import backend converters
    const textConverterModule = await import('../../../backend/src/services/converter/textConverterFactory.js');
    const textConverterFactory = textConverterModule.textConverterFactory;
    registerConverterFactory('textFactory', textConverterFactory);
    
    // Import Office document converters
    const docxConverterModule = await import('../../../backend/src/services/converter/text/docxConverter.js');
    if (docxConverterModule.default) {
      registerConverter('docx', docxConverterModule.default);
      console.log('✅ Registered DOCX converter');
    }
    
    const pptxConverterModule = await import('../../../backend/src/services/converter/text/pptxConverter.js');
    if (pptxConverterModule.default) {
      registerConverter('pptx', pptxConverterModule.default);
      console.log('✅ Registered PPTX converter');
    }
    
    // Import URL converters
    const urlConverterModule = await import('../../../backend/src/services/converter/web/urlConverter.js');
    if (urlConverterModule.urlConverter) {
      registerConverter('url', urlConverterModule.urlConverter);
      console.log('✅ Registered URL converter');
    }
    
    const parentUrlConverterModule = await import('../../../backend/src/services/converter/web/parentUrlConverter.js');
    if (parentUrlConverterModule.convertParentUrlToMarkdown) {
      registerConverter('parenturl', {
        convertToMarkdown: parentUrlConverterModule.convertParentUrlToMarkdown
      });
      console.log('✅ Registered Parent URL converter');
    }
    
    // Import data converters (CSV and XLSX)
    const csvConverterModule = await import('../../../backend/src/services/converter/data/csvConverter.js');
    if (csvConverterModule.default) {
      registerConverter('csv', csvConverterModule.default);
      console.log('✅ Registered CSV converter');
    }
    
    const xlsxConverterModule = await import('../../../backend/src/services/converter/data/xlsxConverter.js');
    if (xlsxConverterModule.default) {
      registerConverter('xlsx', xlsxConverterModule.default);
      console.log('✅ Registered XLSX converter');
    }
    
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
      // Validate output directory
      if (!options.outputDir) {
        console.error('❌ [ElectronConversionService] No output directory provided!');
        throw new Error('Output directory is required for conversion');
      }
      
      // Create a progress tracker
      const progressTracker = new ProgressTracker(options.onProgress, this.progressUpdateInterval);
      progressTracker.update(5);
      
      // Get file handling info from centralized system
      const fileInfo = getFileHandlingInfo({
        name: options.originalFileName || options.name,
        type: options.type,
        path: typeof filePath === 'string' ? filePath : undefined
      });
      
      console.log('📄 [ElectronConversionService] File input details:', {
        isBuffer: Buffer.isBuffer(filePath),
        isTemporary: options.isTemporary,
        fileInfo,
        originalFileName: options.originalFileName,
        name: options.name,
        type: options.type,
        outputDir: options.outputDir
      });
      
      const fileName = fileInfo.fileName;
      const fileType = fileInfo.fileType;
      
      console.log(`📄 Determined file details: fileName=${fileName}, fileType=${fileType}`);
      const cleanedFileName = cleanTemporaryFilename(fileName);
      const finalBaseName = path.basename(cleanedFileName, path.extname(cleanedFileName));
      let fileContent;

      // Handle content based on file type
      if (options.isTemporary && fileInfo.isBinary) {
        console.log(`Processing binary content as ${fileInfo.converter}: ${fileName}`);
        fileContent = filePath; // filePath is actually the buffer
      } else if (fileInfo.isWeb) {
        console.log(`Processing URL: ${filePath}`);
        fileContent = filePath; // filePath is the URL string
      } else if (typeof filePath === 'string') {
        // For file paths, validate file exists and read it
        try {
          const fileStats = await this.fileSystem.getStats(filePath);
          if (!fileStats.success) {
            throw new Error(`File not found or inaccessible: ${filePath}`);
          }
          
          // Read file based on handling type
          fileContent = await readFileAsync(
            filePath, 
            fileInfo.isBinary ? undefined : 'utf8'
          );
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
