/**
 * ElectronConversionService.js
 * Handles document conversion using native file system operations in Electron.
 * Coordinates conversion processes and delegates to the shared conversion utilities.
 *
 * IMPORTANT: When determining file types for conversion, we extract the file extension
 * directly rather than using the category from getFileType. This ensures that we use
 * the specific converter registered for each file type (e.g., 'pdf', 'docx', 'pptx')
 * rather than trying to use a converter for the category ('documents').
 *
 * Special handling is implemented for data files (CSV, XLSX) to ensure they use the
 * correct converter based on file extension. If the extension can't be determined,
 * we default to 'csv' rather than using the category 'data'.
 *
 * For CSV files sent as text content, we detect CSV content by checking for commas, tabs,
 * and newlines, and process it directly rather than treating it as a file path. This fixes
 * the "File not found or inaccessible" error that occurred when the system tried to interpret
 * CSV content as a file path.
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
      
      // For URLs, use the explicit type from options
      // For files, use the file extension directly instead of the category
      const fileType = options.type === 'url' || options.type === 'parenturl'
        ? options.type
        : (() => {
            // Special handling for data files
            if (options.type === 'data') {
              // Try to get the file extension from the filename
              const fileName = options.originalFileName || options.name;
              if (fileName) {
                const extension = fileName.split('.').pop().toLowerCase();
                if (extension === 'csv' || extension === 'xlsx' || extension === 'xls') {
                  console.log(`📊 [ElectronConversionService] Detected data file type: ${extension}`);
                  return extension;
                }
              }
              
              // If we can't determine the specific data file type, default to CSV
              // This is safer than using 'data' which isn't a registered converter
              console.log(`📊 [ElectronConversionService] Using default 'csv' for data file with unknown extension`);
              return 'csv';
            }
            
            // For other files, try to get the file extension directly
            const fileName = options.originalFileName || options.name;
            if (fileName) {
              const extension = fileName.split('.').pop().toLowerCase();
              if (extension && extension !== fileName) {
                return extension;
              }
            }
            
            // If we can't get the extension, fall back to the category
            return getFileType({
              name: fileName,
              type: options.type,
              path: typeof filePath === 'string' ? filePath : undefined
            });
          })();
      
      console.log('📄 [ElectronConversionService] Processing:', {
        type: fileType,
        isBuffer: Buffer.isBuffer(filePath),
        isTemporary: options.isTemporary,
        isUrl: options.type === 'url' || options.type === 'parenturl',
        isParentUrl: options.type === 'parenturl',
        options: options.type === 'parenturl' ? {
          maxDepth: options.maxDepth,
          maxPages: options.maxPages,
          includeImages: options.includeImages,
          includeMeta: options.includeMeta
        } : undefined
      });
      let fileContent;
      
      // Handle content based on input type
      if (options.isTemporary && Buffer.isBuffer(filePath)) {
        console.log(`Processing binary content as ${fileType}`);
        fileContent = filePath; // filePath is actually the buffer
      } else if (options.type === 'url' || options.type === 'parenturl') {
        console.log(`Processing ${options.type === 'parenturl' ? 'parent URL' : 'URL'}: ${filePath}`);
        fileContent = filePath;
      } else if (typeof filePath === 'string') {
        // Special handling for data files
        if (options.type === 'data') {
          // Determine the specific data file type based on the filename and content
          const fileName = options.originalFileName || options.name || '';
          const fileExtension = fileName.split('.').pop().toLowerCase();
          
          // Check if this is CSV content
          const isCSVContent = (filePath.includes(',') || filePath.includes('\t')) &&
                              filePath.includes('\n');
          
          if (isCSVContent || fileExtension === 'csv') {
            console.log('Detected CSV content, processing directly');
            fileContent = filePath;
            
            // Use the csv converter instead of data
            if (fileType === 'data') {
              console.log('Changing fileType from "data" to "csv" for CSV content');
              fileType = 'csv';
            }
          } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
            console.log(`Detected Excel file (${fileExtension}), using xlsx converter`);
            
            // For XLSX files, we still need to validate the file path
            try {
              const fileStats = await this.fileSystem.getStats(filePath);
              if (!fileStats.success) {
                throw new Error(`File not found or inaccessible: ${filePath}`);
              }
              
              fileContent = await readFileAsync(filePath);
              
              // Use the xlsx converter instead of data
              if (fileType === 'data') {
                console.log('Changing fileType from "data" to "xlsx" for Excel content');
                fileType = 'xlsx';
              }
            } catch (error) {
              console.error(`Error reading Excel file: ${filePath}`, error);
              throw new Error(`File not found or inaccessible: ${filePath}`);
            }
          } else {
            // For other data files or unknown formats, try to read as a file
            try {
              const fileStats = await this.fileSystem.getStats(filePath);
              if (!fileStats.success) {
                throw new Error(`File not found or inaccessible: ${filePath}`);
              }
              
              fileContent = await readFileAsync(filePath);
            } catch (error) {
              console.error(`Error reading file: ${filePath}`, error);
              throw new Error(`File not found or inaccessible: ${filePath}`);
            }
          }
        } else {
          // For non-data files, validate file exists and read it
          try {
            const fileStats = await this.fileSystem.getStats(filePath);
            if (!fileStats.success) {
              throw new Error(`File not found or inaccessible: ${filePath}`);
            }
            
            // Read file with appropriate encoding
            fileContent = await readFileAsync(filePath);
          } catch (error) {
            console.error(`Error reading file: ${filePath}`, error);
            throw new Error(`File not found or inaccessible: ${filePath}`);
          }
        }
      } else {
        // If filePath is not a string and not binary content, it's invalid
        throw new Error('Invalid input: Expected a file path or buffer');
      }
      
      progressTracker.update(10);
      
      // Prepare conversion options
      const conversionOptions = {
        name: options.originalFileName || options.name,
        apiKey: options.apiKey,
        useOcr: options.useOcr,
        mistralApiKey: options.mistralApiKey,
        onProgress: (progress) => progressTracker.update(progress)
      };
      
      // Add parenturl specific options if needed
      if (fileType === 'parenturl') {
        Object.assign(conversionOptions, {
          maxDepth: options.maxDepth || 3,
          maxPages: options.maxPages || 100,
          includeImages: options.includeImages ?? true,
          includeMeta: options.includeMeta ?? true
        });
        
        console.log('🌐 [ElectronConversionService] Using parentUrl options:', {
          maxDepth: conversionOptions.maxDepth,
          maxPages: conversionOptions.maxPages,
          includeImages: conversionOptions.includeImages,
          includeMeta: conversionOptions.includeMeta
        });
      }
      
      // Use the shared converters module directly
      const conversionResult = await convertToMarkdown(fileType, fileContent, conversionOptions);
      
      progressTracker.update(90);
      
      // Extract content from result
      const content = conversionResult.content || (conversionResult.buffer ? conversionResult.buffer.toString() : '');
      
      if (!content) {
        throw new Error('Conversion produced empty content');
      }
      
      // Determine file category from name or type
      // Use the category for file organization, which is fine
      const fileCategory = getFileType(options.originalFileName || options.name) || 'text';
      
      // Check if the conversion result has multiple files (for parenturl)
      const hasMultipleFiles = Array.isArray(conversionResult.files) && conversionResult.files.length > 0;
      
      if (hasMultipleFiles) {
        console.log(`📁 [ElectronConversionService] Conversion result has ${conversionResult.files.length} files`);
      }
      
      // Save the conversion result using the ConversionResultManager
      const result = await this.resultManager.saveConversionResult({
        content: content,
        metadata: conversionResult.metadata || {},
        images: conversionResult.images || [],
        files: conversionResult.files, // Pass the files array if it exists
        name: options.originalFileName || options.name,
        type: fileType,
        outputDir: options.outputDir,
        options: {
          ...options,
          category: fileCategory,
          pageCount: conversionResult.pageCount,
          slideCount: conversionResult.slideCount,
          hasMultipleFiles // Flag to indicate if this is a multi-file conversion
        }
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
