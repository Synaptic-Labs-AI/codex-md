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
const { PathUtils } = require('../utils/paths');
const { promisify } = require('util');
const fs = require('fs');
const readFileAsync = promisify(fs.readFile);
const { instance: FileSystemService } = require('./FileSystemService'); // Import instance
const ConversionResultManager = require('./ConversionResultManager');
// Import local utilities
const { 
  getFileType,
  getFileHandlingInfo,
  HANDLING_TYPES,
  CONVERTER_CONFIG
} = require('../utils/files');
const { 
  ProgressTracker, 
  convertToMarkdown, 
  registerConverter,
  registerConverterFactory
} = require('../utils/conversion');

// Log available file handling capabilities
console.log('📄 Initialized with file handling:', {
  handlingTypes: HANDLING_TYPES,
  fileConfig: CONVERTER_CONFIG
});

// Import ModuleResolver and UnifiedConverterFactory
const { ModuleResolver } = require('../utils/moduleResolver');
const unifiedConverterFactory = require('../converters/UnifiedConverterFactory');

// Initialize the converter factory
unifiedConverterFactory.initialize().catch(error => {
  console.error('❌ Failed to initialize converter factory:', error);
});

// Function to get correct converter registry path using ModuleResolver
const getConverterRegistryPath = () => {
  console.log('📂 Getting converter registry path using ModuleResolver');
  return ModuleResolver.resolveModulePath('ConverterRegistry.js', 'services/conversion');
};

// Initialize converters using ModuleResolver
(function() {
  try {
    console.log('🔄 [VERBOSE] Starting converters initialization');
    console.time('🕒 [VERBOSE] Converters initialization time');
    
    console.log('🔄 [VERBOSE] Using ModuleResolver to find ConverterRegistry.js');
    const converterRegistryPath = getConverterRegistryPath();
    console.log('🔍 [VERBOSE] Loading converter registry from path:', converterRegistryPath);
    
    // Log environment details
    console.log('🔍 [VERBOSE] Environment details:', {
      environment: process.env.NODE_ENV || 'unknown',
      appPath: app.getAppPath(),
      currentDir: __dirname,
      isPackaged: app.isPackaged
    });
    
    // Check if the file exists
    const fileExists = fs.existsSync(converterRegistryPath);
    console.log('🔍 [VERBOSE] Registry file exists check:', fileExists);
    
    if (!fileExists) {
      console.error('❌ [VERBOSE] Registry file does not exist at path:', converterRegistryPath);
      console.log('📂 [VERBOSE] Directory contents:', {
        dirname: fs.existsSync(__dirname) ? fs.readdirSync(__dirname) : 'directory not found',
        appPath: fs.existsSync(app.getAppPath()) ? fs.readdirSync(app.getAppPath()) : 'directory not found',
        services: fs.existsSync(path.join(__dirname, '..')) ?
          fs.readdirSync(path.join(__dirname, '..')) : 'directory not found',
        conversion: fs.existsSync(path.join(__dirname, 'conversion')) ?
          fs.readdirSync(path.join(__dirname, 'conversion')) : 'directory not found',
        data: fs.existsSync(path.join(__dirname, 'conversion/data')) ?
          fs.readdirSync(path.join(__dirname, 'conversion/data')) : 'directory not found'
      });
    }
    
    // Use ModuleResolver to safely require the converter registry
    console.log('🔄 [VERBOSE] Using ModuleResolver.safeRequire for ConverterRegistry');
    
    let converterRegistryModule;
    try {
      // Use our ModuleResolver to load the module
      converterRegistryModule = ModuleResolver.safeRequire('ConverterRegistry.js', 'services/conversion');
      console.log('📦 [VERBOSE] ModuleResolver successful. Module structure:', {
        keys: Object.keys(converterRegistryModule),
        hasConverterRegistry: 'ConverterRegistry' in converterRegistryModule,
        hasDefaultExport: 'default' in converterRegistryModule,
        exportTypes: Object.entries(converterRegistryModule).map(([key, value]) =>
          `${key}: ${typeof value}${value && typeof value === 'object' ? ` with keys [${Object.keys(value).join(', ')}]` : ''}`
        )
      });
    } catch (error) {
      console.error('❌ [VERBOSE] Module loading failed with error:', error);
      console.log('🔍 [VERBOSE] Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
        path: converterRegistryPath
      });
      
      // Try fallback to direct require as a last resort
      try {
        console.log('🔄 [VERBOSE] Trying direct require as fallback');
        converterRegistryModule = require(converterRegistryPath);
        console.log('✅ [VERBOSE] Direct require successful');
      } catch (directError) {
        console.error('❌ [VERBOSE] All module loading attempts failed:', directError.message);
        throw new Error(`Could not load ConverterRegistry: ${error.message}`);
      }
    }
    
    const converterRegistry = converterRegistryModule.ConverterRegistry || converterRegistryModule.default || converterRegistryModule;
    
    // Log detailed information about the converter registry
    console.log('🔍 [VERBOSE] Converter registry structure:', {
      hasConverters: !!(converterRegistry && converterRegistry.converters),
      hasConvertToMarkdown: typeof converterRegistry?.convertToMarkdown === 'function',
      hasGetConverterByExtension: typeof converterRegistry?.getConverterByExtension === 'function',
      hasGetConverterByMimeType: typeof converterRegistry?.getConverterByMimeType === 'function',
      availableConverters: converterRegistry && converterRegistry.converters ?
        Object.keys(converterRegistry.converters) : 'none'
    });
    
    // Register the converter factory
    registerConverterFactory('converterRegistry', converterRegistry);
    
    console.timeEnd('🕒 [VERBOSE] Converters initialization time');
    console.log('✅ [VERBOSE] Converters registered successfully');
    
    // Store in global for error checking
    global.converterRegistry = converterRegistry;
  } catch (error) {
    console.timeEnd('🕒 [VERBOSE] Converters initialization time');
    console.error('❌ [VERBOSE] Failed to register converters:', error);
    console.error('❌ [VERBOSE] Error details:', error.stack);
    console.log('🔍 [VERBOSE] Error object:', {
      name: error.name,
      message: error.message,
      code: error.code,
      type: typeof error,
      hasStack: !!error.stack
    });
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
    console.log('🔄 [VERBOSE] ElectronConversionService.convert called');
    // Use a unique label for each conversion to avoid duplicate label warnings
    const timeLabel = `🕒 [VERBOSE] Total conversion time ${Date.now()}`;
    console.time(timeLabel);
    console.trace('🔄 [VERBOSE] Convert method stack trace');
    
    const startTime = Date.now();
    
    try {
      // Validate output directory
      if (!options.outputDir) {
        console.error('❌ [VERBOSE] No output directory provided!');
        console.timeEnd(timeLabel);
        throw new Error('Output directory is required for conversion');
      }
      
      console.log('📥 [VERBOSE] Received conversion request:', {
        inputType: Buffer.isBuffer(filePath) ? 'Buffer' : typeof filePath,
        inputLength: Buffer.isBuffer(filePath) ? filePath.length : undefined,
        fileType: options.fileType, // Log the fileType we received from frontend
        hasBufferInOptions: !!options.buffer,
        bufferLength: options.buffer ? options.buffer.length : undefined,
        options: {
          ...options,
          buffer: options.buffer ? `Buffer(${options.buffer.length})` : undefined,
          apiKey: options.apiKey ? '✓' : '✗',
          mistralApiKey: options.mistralApiKey ? '✓' : '✗'
        }
      });
      
      console.log('🔍 [VERBOSE] Conversion environment:', {
        environment: process.env.NODE_ENV || 'unknown',
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        converterRegistryLoaded: !!global.converterRegistry,
        unifiedConverterFactoryLoaded: !!unifiedConverterFactory,
        hasConvertFile: unifiedConverterFactory ? typeof unifiedConverterFactory.convertFile === 'function' : false
      });

      // If we have a buffer in options, use that instead of the input
      if (options.buffer && Buffer.isBuffer(options.buffer)) {
        console.log('📦 Using buffer from options instead of input');
        filePath = options.buffer;
      }

      // Create a progress tracker
      const progressTracker = new ProgressTracker(options.onProgress, this.progressUpdateInterval);
      
      // Use the fileType provided by the frontend - no redetermination
      const fileType = options.fileType;
      
      console.log('🔄 [ElectronConversionService] Processing:', {
        type: fileType,
        isBuffer: Buffer.isBuffer(filePath),
        isTemporary: options.isTemporary,
        isUrl: options.type === 'url' || options.type === 'parenturl',
        isParentUrl: options.type === 'parenturl'
      });
      
      // Delegate to UnifiedConverterFactory with the fileType from frontend
      const conversionResult = await unifiedConverterFactory.convertFile(filePath, {
        ...options,
        fileType,
        progressTracker
      });
      
      if (!conversionResult.success) {
        throw new Error(conversionResult.error || 'Conversion failed');
      }
      
      // Check if this is an asynchronous conversion (has async: true and conversionId)
      if (conversionResult.async === true && conversionResult.conversionId) {
        console.log(`🔄 [ElectronConversionService] Handling async conversion with ID: ${conversionResult.conversionId}`);
        
        // Get the converter registry
        const converterRegistry = global.converterRegistry;
        if (!converterRegistry) {
          throw new Error('Converter registry not available for async conversion');
        }
        
        // Poll for the conversion result
        let finalResult = null;
        let attempts = 0;
        const maxAttempts = 60; // 30 seconds (500ms * 60)
        
        while (attempts < maxAttempts) {
          // Get the conversion from the registry
          const conversion = converterRegistry.getConversion(conversionResult.conversionId);
          
          if (!conversion) {
            console.warn(`⚠️ [ElectronConversionService] Conversion ${conversionResult.conversionId} not found in registry`);
            break;
          }
          
          // Check if the conversion is complete
          if (conversion.status === 'completed' && conversion.result) {
            console.log(`✅ [ElectronConversionService] Async conversion ${conversionResult.conversionId} completed`);
            finalResult = conversion.result;
            // Mark the conversion as retrieved so it can be cleaned up
            converterRegistry.pingConversion(conversionResult.conversionId, { retrieved: true });
            break;
          }
          
          // Check if the conversion failed
          if (conversion.status === 'failed') {
            console.error(`❌ [ElectronConversionService] Async conversion ${conversionResult.conversionId} failed: ${conversion.error || 'Unknown error'}`);
            
            // If this is a transcription conversion, we want to throw a specific error
            // that will be caught and handled differently by the UI
            if (conversionResult.isTranscription) {
              const transcriptionError = new Error(conversion.error || 'Transcription failed');
              transcriptionError.isTranscriptionError = true;
              throw transcriptionError;
            } else {
              throw new Error(conversion.error || 'Async conversion failed');
            }
          }
          
          // Wait before checking again
          await new Promise(resolve => setTimeout(resolve, 500));
          attempts++;
        }
        
        // If we didn't get a result after all attempts, throw an error
        if (!finalResult) {
          throw new Error(`Async conversion ${conversionResult.conversionId} timed out or was not found`);
        }
        
        // Use the final result as the content
        if (!finalResult) {
          throw new Error('Async conversion produced empty content');
        }
        
        // Update the conversionResult with the final content
        conversionResult.content = finalResult;
        console.log(`✅ [ElectronConversionService] Updated conversionResult.content with final result (length: ${finalResult.length})`);
      } else {
        // For synchronous conversions, extract content from result
        const content = conversionResult.content || '';
        
        if (!content) {
          throw new Error('Conversion produced empty content');
        }
      }
      
      // Use category from frontend if available
      const fileCategory = options.category || 
                         conversionResult.category || 
                         'text';
      
      // Check if the conversion result has multiple files (for parenturl)
      const hasMultipleFiles = Array.isArray(conversionResult.files) && conversionResult.files.length > 0;
      
      if (hasMultipleFiles) {
        console.log(`📁 [ElectronConversionService] Conversion result has ${conversionResult.files.length} files`);
      }
      
      // Save the conversion result using the ConversionResultManager
      // Ensure we're consistently using the original filename
      // Priority: converter's metadata.originalFileName > conversionResult fields > options fields
      const originalFileName = (conversionResult.metadata && conversionResult.metadata.originalFileName) ||
                              conversionResult.originalFileName ||
                              conversionResult.name ||
                              options.originalFileName ||
                              options.name;

      // Add enhanced logging for XLSX/CSV files to track filename handling
      if (fileType === 'xlsx' || fileType === 'csv') {
        console.log(`📊 [ElectronConversionService] Excel/CSV originalFileName resolution:`, {
          fromMetadata: conversionResult.metadata && conversionResult.metadata.originalFileName,
          fromResult: conversionResult.originalFileName,
          fromResultName: conversionResult.name,
          fromOptions: options.originalFileName,
          fromOptionsName: options.name,
          resolved: originalFileName,
          metadataKeys: conversionResult.metadata ? Object.keys(conversionResult.metadata) : [],
          resultKeys: Object.keys(conversionResult)
        });
      }

      console.log(`📦 [ElectronConversionService] Using filename for result: ${originalFileName}`);

      // Log metadata from the conversion result for debugging
      if (conversionResult.metadata) {
        console.log(`🔍 [ElectronConversionService] Conversion result metadata:`, {
          keys: Object.keys(conversionResult.metadata),
          hasOriginalFileName: 'originalFileName' in conversionResult.metadata,
          originalFileName: conversionResult.metadata.originalFileName
        });
      }

      // For XLSX and CSV files, specifically ensure the metadata contains the originalFileName
      let enhancedMetadata = {
        ...(conversionResult.metadata || {}),
        originalFileName: originalFileName // Ensure original filename is in metadata
      };

      // For XLSX/CSV files, double-check the metadata structure
      if (fileType === 'xlsx' || fileType === 'csv') {
        console.log(`📊 [ElectronConversionService] Enhanced metadata for ${fileType}:`, enhancedMetadata);

        // Log additional debugging info
        if (!enhancedMetadata.originalFileName) {
          console.warn(`⚠️ [ElectronConversionService] originalFileName missing in metadata even after setting it!`);
          // Force set it as a last resort
          enhancedMetadata = { ...enhancedMetadata, originalFileName };
        }
      }

      const result = await this.resultManager.saveConversionResult({
        content: conversionResult.content, // Use conversionResult.content directly
        metadata: enhancedMetadata, // Use our enhanced metadata
        images: conversionResult.images || [],
        files: conversionResult.files,
        name: originalFileName, // Use the original filename consistently
        type: conversionResult.type || fileType,
        fileType: fileType, // Always use the fileType from frontend
        outputDir: options.outputDir,
        options: {
          ...options,
          originalFileName: originalFileName, // Add it to options too
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

      // End timer for successful conversion
      console.timeEnd(timeLabel);

      return result;
      
    } catch (error) {
      console.timeEnd(timeLabel);
      console.error('❌ [VERBOSE] Conversion error caught in ElectronConversionService.convert');
      
      // Always include fileType in error results
      const fileType = options.fileType || 'unknown';
      
      // Detailed error logging
      console.log('🔍 [VERBOSE] Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
        type: typeof error
      });
      
      // Check converter registry state
      console.log('🔍 [VERBOSE] Converter registry state at error time:', {
        converterRegistryLoaded: !!global.converterRegistry,
        hasConverters: !!(global.converterRegistry && global.converterRegistry.converters),
        availableConverters: global.converterRegistry && global.converterRegistry.converters ? 
          Object.keys(global.converterRegistry.converters) : 'none',
        unifiedConverterFactoryLoaded: !!unifiedConverterFactory,
        hasConvertFile: unifiedConverterFactory ? typeof unifiedConverterFactory.convertFile === 'function' : false
      });
      
      const errorInfo = {
        fileType: fileType, // Always include fileType
        type: options.type,
        originalFileName: options.originalFileName,
        isBuffer: Buffer.isBuffer(filePath),
        bufferLength: Buffer.isBuffer(filePath) ? filePath.length : undefined,
        error: error.message,
        stack: error.stack,
        convertersLoaded: !!global.converterRegistry // Check if converters were loaded
      };
      
      console.error('❌ [VERBOSE] Conversion failed:', errorInfo);
      
      // Construct a user-friendly error message
      const errorMessage = Buffer.isBuffer(filePath) 
        ? `Failed to convert ${options.originalFileName || 'file'}: ${error.message}`
        : `Failed to convert ${filePath}: ${error.message}`;
      
      return {
        success: false,
        error: errorMessage,
        details: errorInfo,
        fileType: fileType // Explicitly include fileType in error result
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
