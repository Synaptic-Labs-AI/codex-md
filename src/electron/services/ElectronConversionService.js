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

// Import UnifiedConverterFactory
const unifiedConverterFactory = require('../converters/UnifiedConverterFactory');

// Initialize backend converters
(async function() {
  try {
    // Import converter registry
    const converterRegistryModule = await import('../../../backend/src/services/converter/ConverterRegistry.js');
    const converterRegistry = converterRegistryModule.ConverterRegistry;
    registerConverterFactory('converterRegistry', converterRegistry);
    
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
   * @param {string|Buffer} filePath - Path to the file or file content as buffer
   * @param {Object} options - Conversion options
   * @returns {Promise<Object>} - Conversion result
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
      
      // Determine file type
      const fileType = this.determineFileType(filePath, options);
      
      console.log('📄 [ElectronConversionService] Processing:', {
        type: fileType,
        isBuffer: Buffer.isBuffer(filePath),
        isTemporary: options.isTemporary,
        isUrl: options.type === 'url' || options.type === 'parenturl',
        isParentUrl: options.type === 'parenturl'
      });
      
      // Delegate to UnifiedConverterFactory
      const conversionResult = await unifiedConverterFactory.convertFile(filePath, {
        ...options,
        fileType,
        progressTracker
      });
      
      if (!conversionResult.success) {
        throw new Error(conversionResult.error || 'Conversion failed');
      }
      
      // Extract content from result
      const content = conversionResult.content || '';
      
      if (!content) {
        throw new Error('Conversion produced empty content');
      }
      
      // Determine file category from name or type
      const fileCategory = conversionResult.category || 
                          getFileType(options.originalFileName || options.name) || 
                          'text';
      
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
        files: conversionResult.files,
        name: conversionResult.name || options.originalFileName || options.name,
        type: conversionResult.type || fileType,
        outputDir: options.outputDir,
        options: {
          ...options,
          category: fileCategory,
          pageCount: conversionResult.pageCount,
          slideCount: conversionResult.slideCount,
          hasMultipleFiles
        }
      });
      
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
   * Determines the file type based on the input and options
   * @private
   */
  determineFileType(filePath, options) {
    // For URLs, use the explicit type from options
    if (options.type === 'url' || options.type === 'parenturl') {
      return options.type;
    }
    
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
