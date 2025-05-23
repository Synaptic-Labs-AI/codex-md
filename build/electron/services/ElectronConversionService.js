"use strict";

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
const {
  app
} = require('electron');
const {
  PathUtils
} = require('../utils/paths');
const {
  promisify
} = require('util');
const fs = require('fs');
const readFileAsync = promisify(fs.readFile);
const {
  instance: FileSystemService
} = require('./FileSystemService'); // Import instance
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
const {
  ModuleResolver
} = require('../utils/moduleResolver');
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
(function () {
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
        services: fs.existsSync(path.join(__dirname, '..')) ? fs.readdirSync(path.join(__dirname, '..')) : 'directory not found',
        conversion: fs.existsSync(path.join(__dirname, 'conversion')) ? fs.readdirSync(path.join(__dirname, 'conversion')) : 'directory not found',
        data: fs.existsSync(path.join(__dirname, 'conversion/data')) ? fs.readdirSync(path.join(__dirname, 'conversion/data')) : 'directory not found'
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
        exportTypes: Object.entries(converterRegistryModule).map(([key, value]) => `${key}: ${typeof value}${value && typeof value === 'object' ? ` with keys [${Object.keys(value).join(', ')}]` : ''}`)
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
      availableConverters: converterRegistry && converterRegistry.converters ? Object.keys(converterRegistry.converters) : 'none'
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
        fileType: options.fileType,
        // Log the fileType we received from frontend
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
            converterRegistry.pingConversion(conversionResult.conversionId, {
              retrieved: true
            });
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
      const fileCategory = options.category || conversionResult.category || 'text';

      // Check if the conversion result has multiple files (for parenturl)
      const hasMultipleFiles = Array.isArray(conversionResult.files) && conversionResult.files.length > 0;
      if (hasMultipleFiles) {
        console.log(`📁 [ElectronConversionService] Conversion result has ${conversionResult.files.length} files`);
      }

      // Save the conversion result using the ConversionResultManager
      // Ensure we're consistently using the original filename
      // Priority: converter's metadata.originalFileName > conversionResult fields > options fields
      const originalFileName = conversionResult.metadata && conversionResult.metadata.originalFileName || conversionResult.originalFileName || conversionResult.name || options.originalFileName || options.name;

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
          enhancedMetadata = {
            ...enhancedMetadata,
            originalFileName
          };
        }
      }
      const result = await this.resultManager.saveConversionResult({
        content: conversionResult.content,
        // Use conversionResult.content directly
        metadata: enhancedMetadata,
        // Use our enhanced metadata
        images: conversionResult.images || [],
        files: conversionResult.files,
        name: originalFileName,
        // Use the original filename consistently
        type: conversionResult.type || fileType,
        fileType: fileType,
        // Always use the fileType from frontend
        outputDir: options.outputDir,
        options: {
          ...options,
          originalFileName: originalFileName,
          // Add it to options too
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
        availableConverters: global.converterRegistry && global.converterRegistry.converters ? Object.keys(global.converterRegistry.converters) : 'none',
        unifiedConverterFactoryLoaded: !!unifiedConverterFactory,
        hasConvertFile: unifiedConverterFactory ? typeof unifiedConverterFactory.convertFile === 'function' : false
      });
      const errorInfo = {
        fileType: fileType,
        // Always include fileType
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
      const errorMessage = Buffer.isBuffer(filePath) ? `Failed to convert ${options.originalFileName || 'file'}: ${error.message}` : `Failed to convert ${filePath}: ${error.message}`;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsIlBhdGhVdGlscyIsInByb21pc2lmeSIsImZzIiwicmVhZEZpbGVBc3luYyIsInJlYWRGaWxlIiwiaW5zdGFuY2UiLCJGaWxlU3lzdGVtU2VydmljZSIsIkNvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIiwiZ2V0RmlsZVR5cGUiLCJnZXRGaWxlSGFuZGxpbmdJbmZvIiwiSEFORExJTkdfVFlQRVMiLCJDT05WRVJURVJfQ09ORklHIiwiUHJvZ3Jlc3NUcmFja2VyIiwiY29udmVydFRvTWFya2Rvd24iLCJyZWdpc3RlckNvbnZlcnRlciIsInJlZ2lzdGVyQ29udmVydGVyRmFjdG9yeSIsImNvbnNvbGUiLCJsb2ciLCJoYW5kbGluZ1R5cGVzIiwiZmlsZUNvbmZpZyIsIk1vZHVsZVJlc29sdmVyIiwidW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJpbml0aWFsaXplIiwiY2F0Y2giLCJlcnJvciIsImdldENvbnZlcnRlclJlZ2lzdHJ5UGF0aCIsInJlc29sdmVNb2R1bGVQYXRoIiwidGltZSIsImNvbnZlcnRlclJlZ2lzdHJ5UGF0aCIsImVudmlyb25tZW50IiwicHJvY2VzcyIsImVudiIsIk5PREVfRU5WIiwiYXBwUGF0aCIsImdldEFwcFBhdGgiLCJjdXJyZW50RGlyIiwiX19kaXJuYW1lIiwiaXNQYWNrYWdlZCIsImZpbGVFeGlzdHMiLCJleGlzdHNTeW5jIiwiZGlybmFtZSIsInJlYWRkaXJTeW5jIiwic2VydmljZXMiLCJqb2luIiwiY29udmVyc2lvbiIsImRhdGEiLCJjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSIsInNhZmVSZXF1aXJlIiwia2V5cyIsIk9iamVjdCIsImhhc0NvbnZlcnRlclJlZ2lzdHJ5IiwiaGFzRGVmYXVsdEV4cG9ydCIsImV4cG9ydFR5cGVzIiwiZW50cmllcyIsIm1hcCIsImtleSIsInZhbHVlIiwibmFtZSIsIm1lc3NhZ2UiLCJzdGFjayIsImNvZGUiLCJkaXJlY3RFcnJvciIsIkVycm9yIiwiY29udmVydGVyUmVnaXN0cnkiLCJDb252ZXJ0ZXJSZWdpc3RyeSIsImRlZmF1bHQiLCJoYXNDb252ZXJ0ZXJzIiwiY29udmVydGVycyIsImhhc0NvbnZlcnRUb01hcmtkb3duIiwiaGFzR2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJnZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiIsImhhc0dldENvbnZlcnRlckJ5TWltZVR5cGUiLCJnZXRDb252ZXJ0ZXJCeU1pbWVUeXBlIiwiYXZhaWxhYmxlQ29udmVydGVycyIsInRpbWVFbmQiLCJnbG9iYWwiLCJ0eXBlIiwiaGFzU3RhY2siLCJFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJmaWxlU3lzdGVtIiwicmVzdWx0TWFuYWdlciIsInByb2dyZXNzVXBkYXRlSW50ZXJ2YWwiLCJkZWZhdWx0T3V0cHV0RGlyIiwiZ2V0UGF0aCIsImNvbnZlcnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJ0aW1lTGFiZWwiLCJEYXRlIiwibm93IiwidHJhY2UiLCJzdGFydFRpbWUiLCJvdXRwdXREaXIiLCJpbnB1dFR5cGUiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImlucHV0TGVuZ3RoIiwibGVuZ3RoIiwidW5kZWZpbmVkIiwiZmlsZVR5cGUiLCJoYXNCdWZmZXJJbk9wdGlvbnMiLCJidWZmZXIiLCJidWZmZXJMZW5ndGgiLCJhcGlLZXkiLCJtaXN0cmFsQXBpS2V5IiwiY29udmVydGVyUmVnaXN0cnlMb2FkZWQiLCJ1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZCIsImhhc0NvbnZlcnRGaWxlIiwiY29udmVydEZpbGUiLCJwcm9ncmVzc1RyYWNrZXIiLCJvblByb2dyZXNzIiwiaXNUZW1wb3JhcnkiLCJpc1VybCIsImlzUGFyZW50VXJsIiwiY29udmVyc2lvblJlc3VsdCIsInN1Y2Nlc3MiLCJhc3luYyIsImNvbnZlcnNpb25JZCIsImZpbmFsUmVzdWx0IiwiYXR0ZW1wdHMiLCJtYXhBdHRlbXB0cyIsImdldENvbnZlcnNpb24iLCJ3YXJuIiwic3RhdHVzIiwicmVzdWx0IiwicGluZ0NvbnZlcnNpb24iLCJyZXRyaWV2ZWQiLCJpc1RyYW5zY3JpcHRpb24iLCJ0cmFuc2NyaXB0aW9uRXJyb3IiLCJpc1RyYW5zY3JpcHRpb25FcnJvciIsIlByb21pc2UiLCJyZXNvbHZlIiwic2V0VGltZW91dCIsImNvbnRlbnQiLCJmaWxlQ2F0ZWdvcnkiLCJjYXRlZ29yeSIsImhhc011bHRpcGxlRmlsZXMiLCJBcnJheSIsImlzQXJyYXkiLCJmaWxlcyIsIm9yaWdpbmFsRmlsZU5hbWUiLCJtZXRhZGF0YSIsImZyb21NZXRhZGF0YSIsImZyb21SZXN1bHQiLCJmcm9tUmVzdWx0TmFtZSIsImZyb21PcHRpb25zIiwiZnJvbU9wdGlvbnNOYW1lIiwicmVzb2x2ZWQiLCJtZXRhZGF0YUtleXMiLCJyZXN1bHRLZXlzIiwiaGFzT3JpZ2luYWxGaWxlTmFtZSIsImVuaGFuY2VkTWV0YWRhdGEiLCJzYXZlQ29udmVyc2lvblJlc3VsdCIsImltYWdlcyIsInBhZ2VDb3VudCIsInNsaWRlQ291bnQiLCJmaWxlIiwib3V0cHV0UGF0aCIsImVycm9ySW5mbyIsImNvbnZlcnRlcnNMb2FkZWQiLCJlcnJvck1lc3NhZ2UiLCJkZXRhaWxzIiwic2V0dXBPdXRwdXREaXJlY3RvcnkiLCJkaXJUb1NldHVwIiwiY3JlYXRlRGlyZWN0b3J5IiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9FbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmpzXHJcbiAqIEhhbmRsZXMgZG9jdW1lbnQgY29udmVyc2lvbiB1c2luZyBuYXRpdmUgZmlsZSBzeXN0ZW0gb3BlcmF0aW9ucyBpbiBFbGVjdHJvbi5cclxuICogQ29vcmRpbmF0ZXMgY29udmVyc2lvbiBwcm9jZXNzZXMgYW5kIGRlbGVnYXRlcyB0byB0aGUgc2hhcmVkIGNvbnZlcnNpb24gdXRpbGl0aWVzLlxyXG4gKlxyXG4gKiBJTVBPUlRBTlQ6IFdoZW4gZGV0ZXJtaW5pbmcgZmlsZSB0eXBlcyBmb3IgY29udmVyc2lvbiwgd2UgZXh0cmFjdCB0aGUgZmlsZSBleHRlbnNpb25cclxuICogZGlyZWN0bHkgcmF0aGVyIHRoYW4gdXNpbmcgdGhlIGNhdGVnb3J5IGZyb20gZ2V0RmlsZVR5cGUuIFRoaXMgZW5zdXJlcyB0aGF0IHdlIHVzZVxyXG4gKiB0aGUgc3BlY2lmaWMgY29udmVydGVyIHJlZ2lzdGVyZWQgZm9yIGVhY2ggZmlsZSB0eXBlIChlLmcuLCAncGRmJywgJ2RvY3gnLCAncHB0eCcpXHJcbiAqIHJhdGhlciB0aGFuIHRyeWluZyB0byB1c2UgYSBjb252ZXJ0ZXIgZm9yIHRoZSBjYXRlZ29yeSAoJ2RvY3VtZW50cycpLlxyXG4gKlxyXG4gKiBTcGVjaWFsIGhhbmRsaW5nIGlzIGltcGxlbWVudGVkIGZvciBkYXRhIGZpbGVzIChDU1YsIFhMU1gpIHRvIGVuc3VyZSB0aGV5IHVzZSB0aGVcclxuICogY29ycmVjdCBjb252ZXJ0ZXIgYmFzZWQgb24gZmlsZSBleHRlbnNpb24uIElmIHRoZSBleHRlbnNpb24gY2FuJ3QgYmUgZGV0ZXJtaW5lZCxcclxuICogd2UgZGVmYXVsdCB0byAnY3N2JyByYXRoZXIgdGhhbiB1c2luZyB0aGUgY2F0ZWdvcnkgJ2RhdGEnLlxyXG4gKlxyXG4gKiBGb3IgQ1NWIGZpbGVzIHNlbnQgYXMgdGV4dCBjb250ZW50LCB3ZSBkZXRlY3QgQ1NWIGNvbnRlbnQgYnkgY2hlY2tpbmcgZm9yIGNvbW1hcywgdGFicyxcclxuICogYW5kIG5ld2xpbmVzLCBhbmQgcHJvY2VzcyBpdCBkaXJlY3RseSByYXRoZXIgdGhhbiB0cmVhdGluZyBpdCBhcyBhIGZpbGUgcGF0aC4gVGhpcyBmaXhlc1xyXG4gKiB0aGUgXCJGaWxlIG5vdCBmb3VuZCBvciBpbmFjY2Vzc2libGVcIiBlcnJvciB0aGF0IG9jY3VycmVkIHdoZW4gdGhlIHN5c3RlbSB0cmllZCB0byBpbnRlcnByZXRcclxuICogQ1NWIGNvbnRlbnQgYXMgYSBmaWxlIHBhdGguXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgeyBhcHAgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbmNvbnN0IHsgUGF0aFV0aWxzIH0gPSByZXF1aXJlKCcuLi91dGlscy9wYXRocycpO1xyXG5jb25zdCB7IHByb21pc2lmeSB9ID0gcmVxdWlyZSgndXRpbCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XHJcbmNvbnN0IHJlYWRGaWxlQXN5bmMgPSBwcm9taXNpZnkoZnMucmVhZEZpbGUpO1xyXG5jb25zdCB7IGluc3RhbmNlOiBGaWxlU3lzdGVtU2VydmljZSB9ID0gcmVxdWlyZSgnLi9GaWxlU3lzdGVtU2VydmljZScpOyAvLyBJbXBvcnQgaW5zdGFuY2VcclxuY29uc3QgQ29udmVyc2lvblJlc3VsdE1hbmFnZXIgPSByZXF1aXJlKCcuL0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyJyk7XHJcbi8vIEltcG9ydCBsb2NhbCB1dGlsaXRpZXNcclxuY29uc3QgeyBcclxuICBnZXRGaWxlVHlwZSxcclxuICBnZXRGaWxlSGFuZGxpbmdJbmZvLFxyXG4gIEhBTkRMSU5HX1RZUEVTLFxyXG4gIENPTlZFUlRFUl9DT05GSUdcclxufSA9IHJlcXVpcmUoJy4uL3V0aWxzL2ZpbGVzJyk7XHJcbmNvbnN0IHsgXHJcbiAgUHJvZ3Jlc3NUcmFja2VyLCBcclxuICBjb252ZXJ0VG9NYXJrZG93biwgXHJcbiAgcmVnaXN0ZXJDb252ZXJ0ZXIsXHJcbiAgcmVnaXN0ZXJDb252ZXJ0ZXJGYWN0b3J5XHJcbn0gPSByZXF1aXJlKCcuLi91dGlscy9jb252ZXJzaW9uJyk7XHJcblxyXG4vLyBMb2cgYXZhaWxhYmxlIGZpbGUgaGFuZGxpbmcgY2FwYWJpbGl0aWVzXHJcbmNvbnNvbGUubG9nKCfwn5OEIEluaXRpYWxpemVkIHdpdGggZmlsZSBoYW5kbGluZzonLCB7XHJcbiAgaGFuZGxpbmdUeXBlczogSEFORExJTkdfVFlQRVMsXHJcbiAgZmlsZUNvbmZpZzogQ09OVkVSVEVSX0NPTkZJR1xyXG59KTtcclxuXHJcbi8vIEltcG9ydCBNb2R1bGVSZXNvbHZlciBhbmQgVW5pZmllZENvbnZlcnRlckZhY3RvcnlcclxuY29uc3QgeyBNb2R1bGVSZXNvbHZlciB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvbW9kdWxlUmVzb2x2ZXInKTtcclxuY29uc3QgdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPSByZXF1aXJlKCcuLi9jb252ZXJ0ZXJzL1VuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5Jyk7XHJcblxyXG4vLyBJbml0aWFsaXplIHRoZSBjb252ZXJ0ZXIgZmFjdG9yeVxyXG51bmlmaWVkQ29udmVydGVyRmFjdG9yeS5pbml0aWFsaXplKCkuY2F0Y2goZXJyb3IgPT4ge1xyXG4gIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBjb252ZXJ0ZXIgZmFjdG9yeTonLCBlcnJvcik7XHJcbn0pO1xyXG5cclxuLy8gRnVuY3Rpb24gdG8gZ2V0IGNvcnJlY3QgY29udmVydGVyIHJlZ2lzdHJ5IHBhdGggdXNpbmcgTW9kdWxlUmVzb2x2ZXJcclxuY29uc3QgZ2V0Q29udmVydGVyUmVnaXN0cnlQYXRoID0gKCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCfwn5OCIEdldHRpbmcgY29udmVydGVyIHJlZ2lzdHJ5IHBhdGggdXNpbmcgTW9kdWxlUmVzb2x2ZXInKTtcclxuICByZXR1cm4gTW9kdWxlUmVzb2x2ZXIucmVzb2x2ZU1vZHVsZVBhdGgoJ0NvbnZlcnRlclJlZ2lzdHJ5LmpzJywgJ3NlcnZpY2VzL2NvbnZlcnNpb24nKTtcclxufTtcclxuXHJcbi8vIEluaXRpYWxpemUgY29udmVydGVycyB1c2luZyBNb2R1bGVSZXNvbHZlclxyXG4oZnVuY3Rpb24oKSB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBTdGFydGluZyBjb252ZXJ0ZXJzIGluaXRpYWxpemF0aW9uJyk7XHJcbiAgICBjb25zb2xlLnRpbWUoJ/CflZIgW1ZFUkJPU0VdIENvbnZlcnRlcnMgaW5pdGlhbGl6YXRpb24gdGltZScpO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZygn8J+UhCBbVkVSQk9TRV0gVXNpbmcgTW9kdWxlUmVzb2x2ZXIgdG8gZmluZCBDb252ZXJ0ZXJSZWdpc3RyeS5qcycpO1xyXG4gICAgY29uc3QgY29udmVydGVyUmVnaXN0cnlQYXRoID0gZ2V0Q29udmVydGVyUmVnaXN0cnlQYXRoKCk7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gTG9hZGluZyBjb252ZXJ0ZXIgcmVnaXN0cnkgZnJvbSBwYXRoOicsIGNvbnZlcnRlclJlZ2lzdHJ5UGF0aCk7XHJcbiAgICBcclxuICAgIC8vIExvZyBlbnZpcm9ubWVudCBkZXRhaWxzXHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gRW52aXJvbm1lbnQgZGV0YWlsczonLCB7XHJcbiAgICAgIGVudmlyb25tZW50OiBwcm9jZXNzLmVudi5OT0RFX0VOViB8fCAndW5rbm93bicsXHJcbiAgICAgIGFwcFBhdGg6IGFwcC5nZXRBcHBQYXRoKCksXHJcbiAgICAgIGN1cnJlbnREaXI6IF9fZGlybmFtZSxcclxuICAgICAgaXNQYWNrYWdlZDogYXBwLmlzUGFja2FnZWRcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBDaGVjayBpZiB0aGUgZmlsZSBleGlzdHNcclxuICAgIGNvbnN0IGZpbGVFeGlzdHMgPSBmcy5leGlzdHNTeW5jKGNvbnZlcnRlclJlZ2lzdHJ5UGF0aCk7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gUmVnaXN0cnkgZmlsZSBleGlzdHMgY2hlY2s6JywgZmlsZUV4aXN0cyk7XHJcbiAgICBcclxuICAgIGlmICghZmlsZUV4aXN0cykge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIFJlZ2lzdHJ5IGZpbGUgZG9lcyBub3QgZXhpc3QgYXQgcGF0aDonLCBjb252ZXJ0ZXJSZWdpc3RyeVBhdGgpO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+TgiBbVkVSQk9TRV0gRGlyZWN0b3J5IGNvbnRlbnRzOicsIHtcclxuICAgICAgICBkaXJuYW1lOiBmcy5leGlzdHNTeW5jKF9fZGlybmFtZSkgPyBmcy5yZWFkZGlyU3luYyhfX2Rpcm5hbWUpIDogJ2RpcmVjdG9yeSBub3QgZm91bmQnLFxyXG4gICAgICAgIGFwcFBhdGg6IGZzLmV4aXN0c1N5bmMoYXBwLmdldEFwcFBhdGgoKSkgPyBmcy5yZWFkZGlyU3luYyhhcHAuZ2V0QXBwUGF0aCgpKSA6ICdkaXJlY3Rvcnkgbm90IGZvdW5kJyxcclxuICAgICAgICBzZXJ2aWNlczogZnMuZXhpc3RzU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nKSkgP1xyXG4gICAgICAgICAgZnMucmVhZGRpclN5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJykpIDogJ2RpcmVjdG9yeSBub3QgZm91bmQnLFxyXG4gICAgICAgIGNvbnZlcnNpb246IGZzLmV4aXN0c1N5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJ2NvbnZlcnNpb24nKSkgP1xyXG4gICAgICAgICAgZnMucmVhZGRpclN5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJ2NvbnZlcnNpb24nKSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgZGF0YTogZnMuZXhpc3RzU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnY29udmVyc2lvbi9kYXRhJykpID9cclxuICAgICAgICAgIGZzLnJlYWRkaXJTeW5jKHBhdGguam9pbihfX2Rpcm5hbWUsICdjb252ZXJzaW9uL2RhdGEnKSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCdcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFVzZSBNb2R1bGVSZXNvbHZlciB0byBzYWZlbHkgcmVxdWlyZSB0aGUgY29udmVydGVyIHJlZ2lzdHJ5XHJcbiAgICBjb25zb2xlLmxvZygn8J+UhCBbVkVSQk9TRV0gVXNpbmcgTW9kdWxlUmVzb2x2ZXIuc2FmZVJlcXVpcmUgZm9yIENvbnZlcnRlclJlZ2lzdHJ5Jyk7XHJcbiAgICBcclxuICAgIGxldCBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZTtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFVzZSBvdXIgTW9kdWxlUmVzb2x2ZXIgdG8gbG9hZCB0aGUgbW9kdWxlXHJcbiAgICAgIGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlID0gTW9kdWxlUmVzb2x2ZXIuc2FmZVJlcXVpcmUoJ0NvbnZlcnRlclJlZ2lzdHJ5LmpzJywgJ3NlcnZpY2VzL2NvbnZlcnNpb24nKTtcclxuICAgICAgY29uc29sZS5sb2coJ/Cfk6YgW1ZFUkJPU0VdIE1vZHVsZVJlc29sdmVyIHN1Y2Nlc3NmdWwuIE1vZHVsZSBzdHJ1Y3R1cmU6Jywge1xyXG4gICAgICAgIGtleXM6IE9iamVjdC5rZXlzKGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlKSxcclxuICAgICAgICBoYXNDb252ZXJ0ZXJSZWdpc3RyeTogJ0NvbnZlcnRlclJlZ2lzdHJ5JyBpbiBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSxcclxuICAgICAgICBoYXNEZWZhdWx0RXhwb3J0OiAnZGVmYXVsdCcgaW4gY29udmVydGVyUmVnaXN0cnlNb2R1bGUsXHJcbiAgICAgICAgZXhwb3J0VHlwZXM6IE9iamVjdC5lbnRyaWVzKGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlKS5tYXAoKFtrZXksIHZhbHVlXSkgPT5cclxuICAgICAgICAgIGAke2tleX06ICR7dHlwZW9mIHZhbHVlfSR7dmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyA/IGAgd2l0aCBrZXlzIFske09iamVjdC5rZXlzKHZhbHVlKS5qb2luKCcsICcpfV1gIDogJyd9YFxyXG4gICAgICAgIClcclxuICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIE1vZHVsZSBsb2FkaW5nIGZhaWxlZCB3aXRoIGVycm9yOicsIGVycm9yKTtcclxuICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIEVycm9yIGRldGFpbHM6Jywge1xyXG4gICAgICAgIG5hbWU6IGVycm9yLm5hbWUsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcclxuICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXHJcbiAgICAgICAgY29kZTogZXJyb3IuY29kZSxcclxuICAgICAgICBwYXRoOiBjb252ZXJ0ZXJSZWdpc3RyeVBhdGhcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBUcnkgZmFsbGJhY2sgdG8gZGlyZWN0IHJlcXVpcmUgYXMgYSBsYXN0IHJlc29ydFxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBUcnlpbmcgZGlyZWN0IHJlcXVpcmUgYXMgZmFsbGJhY2snKTtcclxuICAgICAgICBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSA9IHJlcXVpcmUoY29udmVydGVyUmVnaXN0cnlQYXRoKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIFtWRVJCT1NFXSBEaXJlY3QgcmVxdWlyZSBzdWNjZXNzZnVsJyk7XHJcbiAgICAgIH0gY2F0Y2ggKGRpcmVjdEVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBBbGwgbW9kdWxlIGxvYWRpbmcgYXR0ZW1wdHMgZmFpbGVkOicsIGRpcmVjdEVycm9yLm1lc3NhZ2UpO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IGxvYWQgQ29udmVydGVyUmVnaXN0cnk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBjb25zdCBjb252ZXJ0ZXJSZWdpc3RyeSA9IGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlLkNvbnZlcnRlclJlZ2lzdHJ5IHx8IGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlLmRlZmF1bHQgfHwgY29udmVydGVyUmVnaXN0cnlNb2R1bGU7XHJcbiAgICBcclxuICAgIC8vIExvZyBkZXRhaWxlZCBpbmZvcm1hdGlvbiBhYm91dCB0aGUgY29udmVydGVyIHJlZ2lzdHJ5XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gQ29udmVydGVyIHJlZ2lzdHJ5IHN0cnVjdHVyZTonLCB7XHJcbiAgICAgIGhhc0NvbnZlcnRlcnM6ICEhKGNvbnZlcnRlclJlZ2lzdHJ5ICYmIGNvbnZlcnRlclJlZ2lzdHJ5LmNvbnZlcnRlcnMpLFxyXG4gICAgICBoYXNDb252ZXJ0VG9NYXJrZG93bjogdHlwZW9mIGNvbnZlcnRlclJlZ2lzdHJ5Py5jb252ZXJ0VG9NYXJrZG93biA9PT0gJ2Z1bmN0aW9uJyxcclxuICAgICAgaGFzR2V0Q29udmVydGVyQnlFeHRlbnNpb246IHR5cGVvZiBjb252ZXJ0ZXJSZWdpc3RyeT8uZ2V0Q29udmVydGVyQnlFeHRlbnNpb24gPT09ICdmdW5jdGlvbicsXHJcbiAgICAgIGhhc0dldENvbnZlcnRlckJ5TWltZVR5cGU6IHR5cGVvZiBjb252ZXJ0ZXJSZWdpc3RyeT8uZ2V0Q29udmVydGVyQnlNaW1lVHlwZSA9PT0gJ2Z1bmN0aW9uJyxcclxuICAgICAgYXZhaWxhYmxlQ29udmVydGVyczogY29udmVydGVyUmVnaXN0cnkgJiYgY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycyA/XHJcbiAgICAgICAgT2JqZWN0LmtleXMoY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycykgOiAnbm9uZSdcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBSZWdpc3RlciB0aGUgY29udmVydGVyIGZhY3RvcnlcclxuICAgIHJlZ2lzdGVyQ29udmVydGVyRmFjdG9yeSgnY29udmVydGVyUmVnaXN0cnknLCBjb252ZXJ0ZXJSZWdpc3RyeSk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUudGltZUVuZCgn8J+VkiBbVkVSQk9TRV0gQ29udmVydGVycyBpbml0aWFsaXphdGlvbiB0aW1lJyk7XHJcbiAgICBjb25zb2xlLmxvZygn4pyFIFtWRVJCT1NFXSBDb252ZXJ0ZXJzIHJlZ2lzdGVyZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICBcclxuICAgIC8vIFN0b3JlIGluIGdsb2JhbCBmb3IgZXJyb3IgY2hlY2tpbmdcclxuICAgIGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSA9IGNvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLnRpbWVFbmQoJ/CflZIgW1ZFUkJPU0VdIENvbnZlcnRlcnMgaW5pdGlhbGl6YXRpb24gdGltZScpO1xyXG4gICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBGYWlsZWQgdG8gcmVnaXN0ZXIgY29udmVydGVyczonLCBlcnJvcik7XHJcbiAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIEVycm9yIGRldGFpbHM6JywgZXJyb3Iuc3RhY2spO1xyXG4gICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIEVycm9yIG9iamVjdDonLCB7XHJcbiAgICAgIG5hbWU6IGVycm9yLm5hbWUsXHJcbiAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgIGNvZGU6IGVycm9yLmNvZGUsXHJcbiAgICAgIHR5cGU6IHR5cGVvZiBlcnJvcixcclxuICAgICAgaGFzU3RhY2s6ICEhZXJyb3Iuc3RhY2tcclxuICAgIH0pO1xyXG4gIH1cclxufSkoKTtcclxuXHJcbmNsYXNzIEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2Uge1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5maWxlU3lzdGVtID0gRmlsZVN5c3RlbVNlcnZpY2U7XHJcbiAgICB0aGlzLnJlc3VsdE1hbmFnZXIgPSBDb252ZXJzaW9uUmVzdWx0TWFuYWdlcjtcclxuICAgIHRoaXMucHJvZ3Jlc3NVcGRhdGVJbnRlcnZhbCA9IDI1MDsgLy8gVXBkYXRlIHByb2dyZXNzIGV2ZXJ5IDI1MG1zXHJcbiAgICB0aGlzLmRlZmF1bHRPdXRwdXREaXIgPSBwYXRoLmpvaW4oYXBwLmdldFBhdGgoJ3VzZXJEYXRhJyksICdjb252ZXJzaW9ucycpO1xyXG4gICAgY29uc29sZS5sb2coJ0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UgaW5pdGlhbGl6ZWQgd2l0aCBkZWZhdWx0IG91dHB1dCBkaXJlY3Rvcnk6JywgdGhpcy5kZWZhdWx0T3V0cHV0RGlyKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENvbnZlcnRzIGEgZmlsZSB0byBtYXJrZG93biBmb3JtYXRcclxuICAgKiBAcGFyYW0ge3N0cmluZ3xCdWZmZXJ9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgZmlsZSBvciBmaWxlIGNvbnRlbnQgYXMgYnVmZmVyXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSAtIENvbnZlcnNpb24gcmVzdWx0XHJcbiAgICovXHJcbiAgYXN5bmMgY29udmVydChmaWxlUGF0aCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UhCBbVkVSQk9TRV0gRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZS5jb252ZXJ0IGNhbGxlZCcpO1xyXG4gICAgLy8gVXNlIGEgdW5pcXVlIGxhYmVsIGZvciBlYWNoIGNvbnZlcnNpb24gdG8gYXZvaWQgZHVwbGljYXRlIGxhYmVsIHdhcm5pbmdzXHJcbiAgICBjb25zdCB0aW1lTGFiZWwgPSBg8J+VkiBbVkVSQk9TRV0gVG90YWwgY29udmVyc2lvbiB0aW1lICR7RGF0ZS5ub3coKX1gO1xyXG4gICAgY29uc29sZS50aW1lKHRpbWVMYWJlbCk7XHJcbiAgICBjb25zb2xlLnRyYWNlKCfwn5SEIFtWRVJCT1NFXSBDb252ZXJ0IG1ldGhvZCBzdGFjayB0cmFjZScpO1xyXG4gICAgXHJcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBWYWxpZGF0ZSBvdXRwdXQgZGlyZWN0b3J5XHJcbiAgICAgIGlmICghb3B0aW9ucy5vdXRwdXREaXIpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIE5vIG91dHB1dCBkaXJlY3RvcnkgcHJvdmlkZWQhJyk7XHJcbiAgICAgICAgY29uc29sZS50aW1lRW5kKHRpbWVMYWJlbCk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdPdXRwdXQgZGlyZWN0b3J5IGlzIHJlcXVpcmVkIGZvciBjb252ZXJzaW9uJyk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5OlIFtWRVJCT1NFXSBSZWNlaXZlZCBjb252ZXJzaW9uIHJlcXVlc3Q6Jywge1xyXG4gICAgICAgIGlucHV0VHlwZTogQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSA/ICdCdWZmZXInIDogdHlwZW9mIGZpbGVQYXRoLFxyXG4gICAgICAgIGlucHV0TGVuZ3RoOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpID8gZmlsZVBhdGgubGVuZ3RoIDogdW5kZWZpbmVkLFxyXG4gICAgICAgIGZpbGVUeXBlOiBvcHRpb25zLmZpbGVUeXBlLCAvLyBMb2cgdGhlIGZpbGVUeXBlIHdlIHJlY2VpdmVkIGZyb20gZnJvbnRlbmRcclxuICAgICAgICBoYXNCdWZmZXJJbk9wdGlvbnM6ICEhb3B0aW9ucy5idWZmZXIsXHJcbiAgICAgICAgYnVmZmVyTGVuZ3RoOiBvcHRpb25zLmJ1ZmZlciA/IG9wdGlvbnMuYnVmZmVyLmxlbmd0aCA6IHVuZGVmaW5lZCxcclxuICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgYnVmZmVyOiBvcHRpb25zLmJ1ZmZlciA/IGBCdWZmZXIoJHtvcHRpb25zLmJ1ZmZlci5sZW5ndGh9KWAgOiB1bmRlZmluZWQsXHJcbiAgICAgICAgICBhcGlLZXk6IG9wdGlvbnMuYXBpS2V5ID8gJ+KckycgOiAn4pyXJyxcclxuICAgICAgICAgIG1pc3RyYWxBcGlLZXk6IG9wdGlvbnMubWlzdHJhbEFwaUtleSA/ICfinJMnIDogJ+KclydcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIENvbnZlcnNpb24gZW52aXJvbm1lbnQ6Jywge1xyXG4gICAgICAgIGVudmlyb25tZW50OiBwcm9jZXNzLmVudi5OT0RFX0VOViB8fCAndW5rbm93bicsXHJcbiAgICAgICAgaXNQYWNrYWdlZDogYXBwLmlzUGFja2FnZWQsXHJcbiAgICAgICAgYXBwUGF0aDogYXBwLmdldEFwcFBhdGgoKSxcclxuICAgICAgICBjb252ZXJ0ZXJSZWdpc3RyeUxvYWRlZDogISFnbG9iYWwuY29udmVydGVyUmVnaXN0cnksXHJcbiAgICAgICAgdW5pZmllZENvbnZlcnRlckZhY3RvcnlMb2FkZWQ6ICEhdW5pZmllZENvbnZlcnRlckZhY3RvcnksXHJcbiAgICAgICAgaGFzQ29udmVydEZpbGU6IHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5ID8gdHlwZW9mIHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmNvbnZlcnRGaWxlID09PSAnZnVuY3Rpb24nIDogZmFsc2VcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBJZiB3ZSBoYXZlIGEgYnVmZmVyIGluIG9wdGlvbnMsIHVzZSB0aGF0IGluc3RlYWQgb2YgdGhlIGlucHV0XHJcbiAgICAgIGlmIChvcHRpb25zLmJ1ZmZlciAmJiBCdWZmZXIuaXNCdWZmZXIob3B0aW9ucy5idWZmZXIpKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ/Cfk6YgVXNpbmcgYnVmZmVyIGZyb20gb3B0aW9ucyBpbnN0ZWFkIG9mIGlucHV0Jyk7XHJcbiAgICAgICAgZmlsZVBhdGggPSBvcHRpb25zLmJ1ZmZlcjtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gQ3JlYXRlIGEgcHJvZ3Jlc3MgdHJhY2tlclxyXG4gICAgICBjb25zdCBwcm9ncmVzc1RyYWNrZXIgPSBuZXcgUHJvZ3Jlc3NUcmFja2VyKG9wdGlvbnMub25Qcm9ncmVzcywgdGhpcy5wcm9ncmVzc1VwZGF0ZUludGVydmFsKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFVzZSB0aGUgZmlsZVR5cGUgcHJvdmlkZWQgYnkgdGhlIGZyb250ZW5kIC0gbm8gcmVkZXRlcm1pbmF0aW9uXHJcbiAgICAgIGNvbnN0IGZpbGVUeXBlID0gb3B0aW9ucy5maWxlVHlwZTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SEIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBQcm9jZXNzaW5nOicsIHtcclxuICAgICAgICB0eXBlOiBmaWxlVHlwZSxcclxuICAgICAgICBpc0J1ZmZlcjogQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSxcclxuICAgICAgICBpc1RlbXBvcmFyeTogb3B0aW9ucy5pc1RlbXBvcmFyeSxcclxuICAgICAgICBpc1VybDogb3B0aW9ucy50eXBlID09PSAndXJsJyB8fCBvcHRpb25zLnR5cGUgPT09ICdwYXJlbnR1cmwnLFxyXG4gICAgICAgIGlzUGFyZW50VXJsOiBvcHRpb25zLnR5cGUgPT09ICdwYXJlbnR1cmwnXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gRGVsZWdhdGUgdG8gVW5pZmllZENvbnZlcnRlckZhY3Rvcnkgd2l0aCB0aGUgZmlsZVR5cGUgZnJvbSBmcm9udGVuZFxyXG4gICAgICBjb25zdCBjb252ZXJzaW9uUmVzdWx0ID0gYXdhaXQgdW5pZmllZENvbnZlcnRlckZhY3RvcnkuY29udmVydEZpbGUoZmlsZVBhdGgsIHtcclxuICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgIGZpbGVUeXBlLFxyXG4gICAgICAgIHByb2dyZXNzVHJhY2tlclxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGlmICghY29udmVyc2lvblJlc3VsdC5zdWNjZXNzKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGNvbnZlcnNpb25SZXN1bHQuZXJyb3IgfHwgJ0NvbnZlcnNpb24gZmFpbGVkJyk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGlmIHRoaXMgaXMgYW4gYXN5bmNocm9ub3VzIGNvbnZlcnNpb24gKGhhcyBhc3luYzogdHJ1ZSBhbmQgY29udmVyc2lvbklkKVxyXG4gICAgICBpZiAoY29udmVyc2lvblJlc3VsdC5hc3luYyA9PT0gdHJ1ZSAmJiBjb252ZXJzaW9uUmVzdWx0LmNvbnZlcnNpb25JZCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5SEIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBIYW5kbGluZyBhc3luYyBjb252ZXJzaW9uIHdpdGggSUQ6ICR7Y29udmVyc2lvblJlc3VsdC5jb252ZXJzaW9uSWR9YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gR2V0IHRoZSBjb252ZXJ0ZXIgcmVnaXN0cnlcclxuICAgICAgICBjb25zdCBjb252ZXJ0ZXJSZWdpc3RyeSA9IGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeTtcclxuICAgICAgICBpZiAoIWNvbnZlcnRlclJlZ2lzdHJ5KSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbnZlcnRlciByZWdpc3RyeSBub3QgYXZhaWxhYmxlIGZvciBhc3luYyBjb252ZXJzaW9uJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFBvbGwgZm9yIHRoZSBjb252ZXJzaW9uIHJlc3VsdFxyXG4gICAgICAgIGxldCBmaW5hbFJlc3VsdCA9IG51bGw7XHJcbiAgICAgICAgbGV0IGF0dGVtcHRzID0gMDtcclxuICAgICAgICBjb25zdCBtYXhBdHRlbXB0cyA9IDYwOyAvLyAzMCBzZWNvbmRzICg1MDBtcyAqIDYwKVxyXG4gICAgICAgIFxyXG4gICAgICAgIHdoaWxlIChhdHRlbXB0cyA8IG1heEF0dGVtcHRzKSB7XHJcbiAgICAgICAgICAvLyBHZXQgdGhlIGNvbnZlcnNpb24gZnJvbSB0aGUgcmVnaXN0cnlcclxuICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSBjb252ZXJ0ZXJSZWdpc3RyeS5nZXRDb252ZXJzaW9uKGNvbnZlcnNpb25SZXN1bHQuY29udmVyc2lvbklkKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgaWYgKCFjb252ZXJzaW9uKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBDb252ZXJzaW9uICR7Y29udmVyc2lvblJlc3VsdC5jb252ZXJzaW9uSWR9IG5vdCBmb3VuZCBpbiByZWdpc3RyeWApO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGNvbnZlcnNpb24gaXMgY29tcGxldGVcclxuICAgICAgICAgIGlmIChjb252ZXJzaW9uLnN0YXR1cyA9PT0gJ2NvbXBsZXRlZCcgJiYgY29udmVyc2lvbi5yZXN1bHQpIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYOKchSBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gQXN5bmMgY29udmVyc2lvbiAke2NvbnZlcnNpb25SZXN1bHQuY29udmVyc2lvbklkfSBjb21wbGV0ZWRgKTtcclxuICAgICAgICAgICAgZmluYWxSZXN1bHQgPSBjb252ZXJzaW9uLnJlc3VsdDtcclxuICAgICAgICAgICAgLy8gTWFyayB0aGUgY29udmVyc2lvbiBhcyByZXRyaWV2ZWQgc28gaXQgY2FuIGJlIGNsZWFuZWQgdXBcclxuICAgICAgICAgICAgY29udmVydGVyUmVnaXN0cnkucGluZ0NvbnZlcnNpb24oY29udmVyc2lvblJlc3VsdC5jb252ZXJzaW9uSWQsIHsgcmV0cmlldmVkOiB0cnVlIH0pO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGNvbnZlcnNpb24gZmFpbGVkXHJcbiAgICAgICAgICBpZiAoY29udmVyc2lvbi5zdGF0dXMgPT09ICdmYWlsZWQnKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gQXN5bmMgY29udmVyc2lvbiAke2NvbnZlcnNpb25SZXN1bHQuY29udmVyc2lvbklkfSBmYWlsZWQ6ICR7Y29udmVyc2lvbi5lcnJvciB8fCAnVW5rbm93biBlcnJvcid9YCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBJZiB0aGlzIGlzIGEgdHJhbnNjcmlwdGlvbiBjb252ZXJzaW9uLCB3ZSB3YW50IHRvIHRocm93IGEgc3BlY2lmaWMgZXJyb3JcclxuICAgICAgICAgICAgLy8gdGhhdCB3aWxsIGJlIGNhdWdodCBhbmQgaGFuZGxlZCBkaWZmZXJlbnRseSBieSB0aGUgVUlcclxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb25SZXN1bHQuaXNUcmFuc2NyaXB0aW9uKSB7XHJcbiAgICAgICAgICAgICAgY29uc3QgdHJhbnNjcmlwdGlvbkVycm9yID0gbmV3IEVycm9yKGNvbnZlcnNpb24uZXJyb3IgfHwgJ1RyYW5zY3JpcHRpb24gZmFpbGVkJyk7XHJcbiAgICAgICAgICAgICAgdHJhbnNjcmlwdGlvbkVycm9yLmlzVHJhbnNjcmlwdGlvbkVycm9yID0gdHJ1ZTtcclxuICAgICAgICAgICAgICB0aHJvdyB0cmFuc2NyaXB0aW9uRXJyb3I7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGNvbnZlcnNpb24uZXJyb3IgfHwgJ0FzeW5jIGNvbnZlcnNpb24gZmFpbGVkJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gV2FpdCBiZWZvcmUgY2hlY2tpbmcgYWdhaW5cclxuICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCA1MDApKTtcclxuICAgICAgICAgIGF0dGVtcHRzKys7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIElmIHdlIGRpZG4ndCBnZXQgYSByZXN1bHQgYWZ0ZXIgYWxsIGF0dGVtcHRzLCB0aHJvdyBhbiBlcnJvclxyXG4gICAgICAgIGlmICghZmluYWxSZXN1bHQpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQXN5bmMgY29udmVyc2lvbiAke2NvbnZlcnNpb25SZXN1bHQuY29udmVyc2lvbklkfSB0aW1lZCBvdXQgb3Igd2FzIG5vdCBmb3VuZGApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBVc2UgdGhlIGZpbmFsIHJlc3VsdCBhcyB0aGUgY29udGVudFxyXG4gICAgICAgIGlmICghZmluYWxSZXN1bHQpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQXN5bmMgY29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50Jyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFVwZGF0ZSB0aGUgY29udmVyc2lvblJlc3VsdCB3aXRoIHRoZSBmaW5hbCBjb250ZW50XHJcbiAgICAgICAgY29udmVyc2lvblJlc3VsdC5jb250ZW50ID0gZmluYWxSZXN1bHQ7XHJcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gVXBkYXRlZCBjb252ZXJzaW9uUmVzdWx0LmNvbnRlbnQgd2l0aCBmaW5hbCByZXN1bHQgKGxlbmd0aDogJHtmaW5hbFJlc3VsdC5sZW5ndGh9KWApO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIEZvciBzeW5jaHJvbm91cyBjb252ZXJzaW9ucywgZXh0cmFjdCBjb250ZW50IGZyb20gcmVzdWx0XHJcbiAgICAgICAgY29uc3QgY29udGVudCA9IGNvbnZlcnNpb25SZXN1bHQuY29udGVudCB8fCAnJztcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWNvbnRlbnQpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50Jyk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBVc2UgY2F0ZWdvcnkgZnJvbSBmcm9udGVuZCBpZiBhdmFpbGFibGVcclxuICAgICAgY29uc3QgZmlsZUNhdGVnb3J5ID0gb3B0aW9ucy5jYXRlZ29yeSB8fCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25SZXN1bHQuY2F0ZWdvcnkgfHwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAndGV4dCc7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBpZiB0aGUgY29udmVyc2lvbiByZXN1bHQgaGFzIG11bHRpcGxlIGZpbGVzIChmb3IgcGFyZW50dXJsKVxyXG4gICAgICBjb25zdCBoYXNNdWx0aXBsZUZpbGVzID0gQXJyYXkuaXNBcnJheShjb252ZXJzaW9uUmVzdWx0LmZpbGVzKSAmJiBjb252ZXJzaW9uUmVzdWx0LmZpbGVzLmxlbmd0aCA+IDA7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoaGFzTXVsdGlwbGVGaWxlcykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OBIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBDb252ZXJzaW9uIHJlc3VsdCBoYXMgJHtjb252ZXJzaW9uUmVzdWx0LmZpbGVzLmxlbmd0aH0gZmlsZXNgKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gU2F2ZSB0aGUgY29udmVyc2lvbiByZXN1bHQgdXNpbmcgdGhlIENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXHJcbiAgICAgIC8vIEVuc3VyZSB3ZSdyZSBjb25zaXN0ZW50bHkgdXNpbmcgdGhlIG9yaWdpbmFsIGZpbGVuYW1lXHJcbiAgICAgIC8vIFByaW9yaXR5OiBjb252ZXJ0ZXIncyBtZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lID4gY29udmVyc2lvblJlc3VsdCBmaWVsZHMgPiBvcHRpb25zIGZpZWxkc1xyXG4gICAgICBjb25zdCBvcmlnaW5hbEZpbGVOYW1lID0gKGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEgJiYgY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lKSB8fFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb252ZXJzaW9uUmVzdWx0Lm9yaWdpbmFsRmlsZU5hbWUgfHxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvblJlc3VsdC5uYW1lIHx8XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zLm5hbWU7XHJcblxyXG4gICAgICAvLyBBZGQgZW5oYW5jZWQgbG9nZ2luZyBmb3IgWExTWC9DU1YgZmlsZXMgdG8gdHJhY2sgZmlsZW5hbWUgaGFuZGxpbmdcclxuICAgICAgaWYgKGZpbGVUeXBlID09PSAneGxzeCcgfHwgZmlsZVR5cGUgPT09ICdjc3YnKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4ogW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIEV4Y2VsL0NTViBvcmlnaW5hbEZpbGVOYW1lIHJlc29sdXRpb246YCwge1xyXG4gICAgICAgICAgZnJvbU1ldGFkYXRhOiBjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhICYmIGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICAgIGZyb21SZXN1bHQ6IGNvbnZlcnNpb25SZXN1bHQub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICAgIGZyb21SZXN1bHROYW1lOiBjb252ZXJzaW9uUmVzdWx0Lm5hbWUsXHJcbiAgICAgICAgICBmcm9tT3B0aW9uczogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICAgICAgZnJvbU9wdGlvbnNOYW1lOiBvcHRpb25zLm5hbWUsXHJcbiAgICAgICAgICByZXNvbHZlZDogb3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICAgIG1ldGFkYXRhS2V5czogY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSA/IE9iamVjdC5rZXlzKGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEpIDogW10sXHJcbiAgICAgICAgICByZXN1bHRLZXlzOiBPYmplY3Qua2V5cyhjb252ZXJzaW9uUmVzdWx0KVxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TpiBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gVXNpbmcgZmlsZW5hbWUgZm9yIHJlc3VsdDogJHtvcmlnaW5hbEZpbGVOYW1lfWApO1xyXG5cclxuICAgICAgLy8gTG9nIG1ldGFkYXRhIGZyb20gdGhlIGNvbnZlcnNpb24gcmVzdWx0IGZvciBkZWJ1Z2dpbmdcclxuICAgICAgaWYgKGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+UjSBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gQ29udmVyc2lvbiByZXN1bHQgbWV0YWRhdGE6YCwge1xyXG4gICAgICAgICAga2V5czogT2JqZWN0LmtleXMoY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSksXHJcbiAgICAgICAgICBoYXNPcmlnaW5hbEZpbGVOYW1lOiAnb3JpZ2luYWxGaWxlTmFtZScgaW4gY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSxcclxuICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBGb3IgWExTWCBhbmQgQ1NWIGZpbGVzLCBzcGVjaWZpY2FsbHkgZW5zdXJlIHRoZSBtZXRhZGF0YSBjb250YWlucyB0aGUgb3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgICBsZXQgZW5oYW5jZWRNZXRhZGF0YSA9IHtcclxuICAgICAgICAuLi4oY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSB8fCB7fSksXHJcbiAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogb3JpZ2luYWxGaWxlTmFtZSAvLyBFbnN1cmUgb3JpZ2luYWwgZmlsZW5hbWUgaXMgaW4gbWV0YWRhdGFcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIEZvciBYTFNYL0NTViBmaWxlcywgZG91YmxlLWNoZWNrIHRoZSBtZXRhZGF0YSBzdHJ1Y3R1cmVcclxuICAgICAgaWYgKGZpbGVUeXBlID09PSAneGxzeCcgfHwgZmlsZVR5cGUgPT09ICdjc3YnKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4ogW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIEVuaGFuY2VkIG1ldGFkYXRhIGZvciAke2ZpbGVUeXBlfTpgLCBlbmhhbmNlZE1ldGFkYXRhKTtcclxuXHJcbiAgICAgICAgLy8gTG9nIGFkZGl0aW9uYWwgZGVidWdnaW5nIGluZm9cclxuICAgICAgICBpZiAoIWVuaGFuY2VkTWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSkge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIG9yaWdpbmFsRmlsZU5hbWUgbWlzc2luZyBpbiBtZXRhZGF0YSBldmVuIGFmdGVyIHNldHRpbmcgaXQhYCk7XHJcbiAgICAgICAgICAvLyBGb3JjZSBzZXQgaXQgYXMgYSBsYXN0IHJlc29ydFxyXG4gICAgICAgICAgZW5oYW5jZWRNZXRhZGF0YSA9IHsgLi4uZW5oYW5jZWRNZXRhZGF0YSwgb3JpZ2luYWxGaWxlTmFtZSB9O1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5yZXN1bHRNYW5hZ2VyLnNhdmVDb252ZXJzaW9uUmVzdWx0KHtcclxuICAgICAgICBjb250ZW50OiBjb252ZXJzaW9uUmVzdWx0LmNvbnRlbnQsIC8vIFVzZSBjb252ZXJzaW9uUmVzdWx0LmNvbnRlbnQgZGlyZWN0bHlcclxuICAgICAgICBtZXRhZGF0YTogZW5oYW5jZWRNZXRhZGF0YSwgLy8gVXNlIG91ciBlbmhhbmNlZCBtZXRhZGF0YVxyXG4gICAgICAgIGltYWdlczogY29udmVyc2lvblJlc3VsdC5pbWFnZXMgfHwgW10sXHJcbiAgICAgICAgZmlsZXM6IGNvbnZlcnNpb25SZXN1bHQuZmlsZXMsXHJcbiAgICAgICAgbmFtZTogb3JpZ2luYWxGaWxlTmFtZSwgLy8gVXNlIHRoZSBvcmlnaW5hbCBmaWxlbmFtZSBjb25zaXN0ZW50bHlcclxuICAgICAgICB0eXBlOiBjb252ZXJzaW9uUmVzdWx0LnR5cGUgfHwgZmlsZVR5cGUsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLCAvLyBBbHdheXMgdXNlIHRoZSBmaWxlVHlwZSBmcm9tIGZyb250ZW5kXHJcbiAgICAgICAgb3V0cHV0RGlyOiBvcHRpb25zLm91dHB1dERpcixcclxuICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogb3JpZ2luYWxGaWxlTmFtZSwgLy8gQWRkIGl0IHRvIG9wdGlvbnMgdG9vXHJcbiAgICAgICAgICBjYXRlZ29yeTogZmlsZUNhdGVnb3J5LFxyXG4gICAgICAgICAgcGFnZUNvdW50OiBjb252ZXJzaW9uUmVzdWx0LnBhZ2VDb3VudCxcclxuICAgICAgICAgIHNsaWRlQ291bnQ6IGNvbnZlcnNpb25SZXN1bHQuc2xpZGVDb3VudCxcclxuICAgICAgICAgIGhhc011bHRpcGxlRmlsZXNcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coYOKchSBGaWxlIGNvbnZlcnNpb24gY29tcGxldGVkIGluICR7RGF0ZS5ub3coKSAtIHN0YXJ0VGltZX1tczpgLCB7XHJcbiAgICAgICAgZmlsZTogZmlsZVBhdGgsXHJcbiAgICAgICAgb3V0cHV0UGF0aDogcmVzdWx0Lm91dHB1dFBhdGhcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBFbmQgdGltZXIgZm9yIHN1Y2Nlc3NmdWwgY29udmVyc2lvblxyXG4gICAgICBjb25zb2xlLnRpbWVFbmQodGltZUxhYmVsKTtcclxuXHJcbiAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS50aW1lRW5kKHRpbWVMYWJlbCk7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gQ29udmVyc2lvbiBlcnJvciBjYXVnaHQgaW4gRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZS5jb252ZXJ0Jyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBBbHdheXMgaW5jbHVkZSBmaWxlVHlwZSBpbiBlcnJvciByZXN1bHRzXHJcbiAgICAgIGNvbnN0IGZpbGVUeXBlID0gb3B0aW9ucy5maWxlVHlwZSB8fCAndW5rbm93bic7XHJcbiAgICAgIFxyXG4gICAgICAvLyBEZXRhaWxlZCBlcnJvciBsb2dnaW5nXHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBFcnJvciBkZXRhaWxzOicsIHtcclxuICAgICAgICBuYW1lOiBlcnJvci5uYW1lLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxyXG4gICAgICAgIGNvZGU6IGVycm9yLmNvZGUsXHJcbiAgICAgICAgdHlwZTogdHlwZW9mIGVycm9yXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgY29udmVydGVyIHJlZ2lzdHJ5IHN0YXRlXHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBDb252ZXJ0ZXIgcmVnaXN0cnkgc3RhdGUgYXQgZXJyb3IgdGltZTonLCB7XHJcbiAgICAgICAgY29udmVydGVyUmVnaXN0cnlMb2FkZWQ6ICEhZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5LFxyXG4gICAgICAgIGhhc0NvbnZlcnRlcnM6ICEhKGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSAmJiBnbG9iYWwuY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycyksXHJcbiAgICAgICAgYXZhaWxhYmxlQ29udmVydGVyczogZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5ICYmIGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzID8gXHJcbiAgICAgICAgICBPYmplY3Qua2V5cyhnbG9iYWwuY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycykgOiAnbm9uZScsXHJcbiAgICAgICAgdW5pZmllZENvbnZlcnRlckZhY3RvcnlMb2FkZWQ6ICEhdW5pZmllZENvbnZlcnRlckZhY3RvcnksXHJcbiAgICAgICAgaGFzQ29udmVydEZpbGU6IHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5ID8gdHlwZW9mIHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmNvbnZlcnRGaWxlID09PSAnZnVuY3Rpb24nIDogZmFsc2VcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBlcnJvckluZm8gPSB7XHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLCAvLyBBbHdheXMgaW5jbHVkZSBmaWxlVHlwZVxyXG4gICAgICAgIHR5cGU6IG9wdGlvbnMudHlwZSxcclxuICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgICAgaXNCdWZmZXI6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCksXHJcbiAgICAgICAgYnVmZmVyTGVuZ3RoOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpID8gZmlsZVBhdGgubGVuZ3RoIDogdW5kZWZpbmVkLFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcclxuICAgICAgICBjb252ZXJ0ZXJzTG9hZGVkOiAhIWdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSAvLyBDaGVjayBpZiBjb252ZXJ0ZXJzIHdlcmUgbG9hZGVkXHJcbiAgICAgIH07XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIENvbnZlcnNpb24gZmFpbGVkOicsIGVycm9ySW5mbyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDb25zdHJ1Y3QgYSB1c2VyLWZyaWVuZGx5IGVycm9yIG1lc3NhZ2VcclxuICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSBcclxuICAgICAgICA/IGBGYWlsZWQgdG8gY29udmVydCAke29wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCAnZmlsZSd9OiAke2Vycm9yLm1lc3NhZ2V9YFxyXG4gICAgICAgIDogYEZhaWxlZCB0byBjb252ZXJ0ICR7ZmlsZVBhdGh9OiAke2Vycm9yLm1lc3NhZ2V9YDtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcclxuICAgICAgICBkZXRhaWxzOiBlcnJvckluZm8sXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlIC8vIEV4cGxpY2l0bHkgaW5jbHVkZSBmaWxlVHlwZSBpbiBlcnJvciByZXN1bHRcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNldHMgdXAgdGhlIG91dHB1dCBkaXJlY3RvcnkgZm9yIGNvbnZlcnNpb25zXHJcbiAgICovXHJcbiAgYXN5bmMgc2V0dXBPdXRwdXREaXJlY3Rvcnkob3V0cHV0RGlyKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBkaXJUb1NldHVwID0gb3V0cHV0RGlyIHx8IHRoaXMuZGVmYXVsdE91dHB1dERpcjtcclxuICAgICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLmNyZWF0ZURpcmVjdG9yeShkaXJUb1NldHVwKTtcclxuICAgICAgY29uc29sZS5sb2coJ/Cfk4EgT3V0cHV0IGRpcmVjdG9yeSByZWFkeTonLCBkaXJUb1NldHVwKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gc2V0IHVwIG91dHB1dCBkaXJlY3Rvcnk6JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gbmV3IEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UoKTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNO0VBQUVDO0FBQUksQ0FBQyxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ25DLE1BQU07RUFBRUU7QUFBVSxDQUFDLEdBQUdGLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQztBQUMvQyxNQUFNO0VBQUVHO0FBQVUsQ0FBQyxHQUFHSCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQ3JDLE1BQU1JLEVBQUUsR0FBR0osT0FBTyxDQUFDLElBQUksQ0FBQztBQUN4QixNQUFNSyxhQUFhLEdBQUdGLFNBQVMsQ0FBQ0MsRUFBRSxDQUFDRSxRQUFRLENBQUM7QUFDNUMsTUFBTTtFQUFFQyxRQUFRLEVBQUVDO0FBQWtCLENBQUMsR0FBR1IsT0FBTyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQztBQUN4RSxNQUFNUyx1QkFBdUIsR0FBR1QsT0FBTyxDQUFDLDJCQUEyQixDQUFDO0FBQ3BFO0FBQ0EsTUFBTTtFQUNKVSxXQUFXO0VBQ1hDLG1CQUFtQjtFQUNuQkMsY0FBYztFQUNkQztBQUNGLENBQUMsR0FBR2IsT0FBTyxDQUFDLGdCQUFnQixDQUFDO0FBQzdCLE1BQU07RUFDSmMsZUFBZTtFQUNmQyxpQkFBaUI7RUFDakJDLGlCQUFpQjtFQUNqQkM7QUFDRixDQUFDLEdBQUdqQixPQUFPLENBQUMscUJBQXFCLENBQUM7O0FBRWxDO0FBQ0FrQixPQUFPLENBQUNDLEdBQUcsQ0FBQyxvQ0FBb0MsRUFBRTtFQUNoREMsYUFBYSxFQUFFUixjQUFjO0VBQzdCUyxVQUFVLEVBQUVSO0FBQ2QsQ0FBQyxDQUFDOztBQUVGO0FBQ0EsTUFBTTtFQUFFUztBQUFlLENBQUMsR0FBR3RCLE9BQU8sQ0FBQyx5QkFBeUIsQ0FBQztBQUM3RCxNQUFNdUIsdUJBQXVCLEdBQUd2QixPQUFPLENBQUMsdUNBQXVDLENBQUM7O0FBRWhGO0FBQ0F1Qix1QkFBdUIsQ0FBQ0MsVUFBVSxDQUFDLENBQUMsQ0FBQ0MsS0FBSyxDQUFDQyxLQUFLLElBQUk7RUFDbERSLE9BQU8sQ0FBQ1EsS0FBSyxDQUFDLDJDQUEyQyxFQUFFQSxLQUFLLENBQUM7QUFDbkUsQ0FBQyxDQUFDOztBQUVGO0FBQ0EsTUFBTUMsd0JBQXdCLEdBQUdBLENBQUEsS0FBTTtFQUNyQ1QsT0FBTyxDQUFDQyxHQUFHLENBQUMseURBQXlELENBQUM7RUFDdEUsT0FBT0csY0FBYyxDQUFDTSxpQkFBaUIsQ0FBQyxzQkFBc0IsRUFBRSxxQkFBcUIsQ0FBQztBQUN4RixDQUFDOztBQUVEO0FBQ0EsQ0FBQyxZQUFXO0VBQ1YsSUFBSTtJQUNGVixPQUFPLENBQUNDLEdBQUcsQ0FBQyxpREFBaUQsQ0FBQztJQUM5REQsT0FBTyxDQUFDVyxJQUFJLENBQUMsNkNBQTZDLENBQUM7SUFFM0RYLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLGdFQUFnRSxDQUFDO0lBQzdFLE1BQU1XLHFCQUFxQixHQUFHSCx3QkFBd0IsQ0FBQyxDQUFDO0lBQ3hEVCxPQUFPLENBQUNDLEdBQUcsQ0FBQyxvREFBb0QsRUFBRVcscUJBQXFCLENBQUM7O0lBRXhGO0lBQ0FaLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLG1DQUFtQyxFQUFFO01BQy9DWSxXQUFXLEVBQUVDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDQyxRQUFRLElBQUksU0FBUztNQUM5Q0MsT0FBTyxFQUFFbEMsR0FBRyxDQUFDbUMsVUFBVSxDQUFDLENBQUM7TUFDekJDLFVBQVUsRUFBRUMsU0FBUztNQUNyQkMsVUFBVSxFQUFFdEMsR0FBRyxDQUFDc0M7SUFDbEIsQ0FBQyxDQUFDOztJQUVGO0lBQ0EsTUFBTUMsVUFBVSxHQUFHcEMsRUFBRSxDQUFDcUMsVUFBVSxDQUFDWCxxQkFBcUIsQ0FBQztJQUN2RFosT0FBTyxDQUFDQyxHQUFHLENBQUMsMENBQTBDLEVBQUVxQixVQUFVLENBQUM7SUFFbkUsSUFBSSxDQUFDQSxVQUFVLEVBQUU7TUFDZnRCLE9BQU8sQ0FBQ1EsS0FBSyxDQUFDLG1EQUFtRCxFQUFFSSxxQkFBcUIsQ0FBQztNQUN6RlosT0FBTyxDQUFDQyxHQUFHLENBQUMsa0NBQWtDLEVBQUU7UUFDOUN1QixPQUFPLEVBQUV0QyxFQUFFLENBQUNxQyxVQUFVLENBQUNILFNBQVMsQ0FBQyxHQUFHbEMsRUFBRSxDQUFDdUMsV0FBVyxDQUFDTCxTQUFTLENBQUMsR0FBRyxxQkFBcUI7UUFDckZILE9BQU8sRUFBRS9CLEVBQUUsQ0FBQ3FDLFVBQVUsQ0FBQ3hDLEdBQUcsQ0FBQ21DLFVBQVUsQ0FBQyxDQUFDLENBQUMsR0FBR2hDLEVBQUUsQ0FBQ3VDLFdBQVcsQ0FBQzFDLEdBQUcsQ0FBQ21DLFVBQVUsQ0FBQyxDQUFDLENBQUMsR0FBRyxxQkFBcUI7UUFDbkdRLFFBQVEsRUFBRXhDLEVBQUUsQ0FBQ3FDLFVBQVUsQ0FBQzFDLElBQUksQ0FBQzhDLElBQUksQ0FBQ1AsU0FBUyxFQUFFLElBQUksQ0FBQyxDQUFDLEdBQ2pEbEMsRUFBRSxDQUFDdUMsV0FBVyxDQUFDNUMsSUFBSSxDQUFDOEMsSUFBSSxDQUFDUCxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxxQkFBcUI7UUFDcEVRLFVBQVUsRUFBRTFDLEVBQUUsQ0FBQ3FDLFVBQVUsQ0FBQzFDLElBQUksQ0FBQzhDLElBQUksQ0FBQ1AsU0FBUyxFQUFFLFlBQVksQ0FBQyxDQUFDLEdBQzNEbEMsRUFBRSxDQUFDdUMsV0FBVyxDQUFDNUMsSUFBSSxDQUFDOEMsSUFBSSxDQUFDUCxTQUFTLEVBQUUsWUFBWSxDQUFDLENBQUMsR0FBRyxxQkFBcUI7UUFDNUVTLElBQUksRUFBRTNDLEVBQUUsQ0FBQ3FDLFVBQVUsQ0FBQzFDLElBQUksQ0FBQzhDLElBQUksQ0FBQ1AsU0FBUyxFQUFFLGlCQUFpQixDQUFDLENBQUMsR0FDMURsQyxFQUFFLENBQUN1QyxXQUFXLENBQUM1QyxJQUFJLENBQUM4QyxJQUFJLENBQUNQLFNBQVMsRUFBRSxpQkFBaUIsQ0FBQyxDQUFDLEdBQUc7TUFDOUQsQ0FBQyxDQUFDO0lBQ0o7O0lBRUE7SUFDQXBCLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHFFQUFxRSxDQUFDO0lBRWxGLElBQUk2Qix1QkFBdUI7SUFDM0IsSUFBSTtNQUNGO01BQ0FBLHVCQUF1QixHQUFHMUIsY0FBYyxDQUFDMkIsV0FBVyxDQUFDLHNCQUFzQixFQUFFLHFCQUFxQixDQUFDO01BQ25HL0IsT0FBTyxDQUFDQyxHQUFHLENBQUMsMkRBQTJELEVBQUU7UUFDdkUrQixJQUFJLEVBQUVDLE1BQU0sQ0FBQ0QsSUFBSSxDQUFDRix1QkFBdUIsQ0FBQztRQUMxQ0ksb0JBQW9CLEVBQUUsbUJBQW1CLElBQUlKLHVCQUF1QjtRQUNwRUssZ0JBQWdCLEVBQUUsU0FBUyxJQUFJTCx1QkFBdUI7UUFDdERNLFdBQVcsRUFBRUgsTUFBTSxDQUFDSSxPQUFPLENBQUNQLHVCQUF1QixDQUFDLENBQUNRLEdBQUcsQ0FBQyxDQUFDLENBQUNDLEdBQUcsRUFBRUMsS0FBSyxDQUFDLEtBQ3BFLEdBQUdELEdBQUcsS0FBSyxPQUFPQyxLQUFLLEdBQUdBLEtBQUssSUFBSSxPQUFPQSxLQUFLLEtBQUssUUFBUSxHQUFHLGVBQWVQLE1BQU0sQ0FBQ0QsSUFBSSxDQUFDUSxLQUFLLENBQUMsQ0FBQ2IsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsRUFBRSxFQUNySDtNQUNGLENBQUMsQ0FBQztJQUNKLENBQUMsQ0FBQyxPQUFPbkIsS0FBSyxFQUFFO01BQ2RSLE9BQU8sQ0FBQ1EsS0FBSyxDQUFDLCtDQUErQyxFQUFFQSxLQUFLLENBQUM7TUFDckVSLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDZCQUE2QixFQUFFO1FBQ3pDd0MsSUFBSSxFQUFFakMsS0FBSyxDQUFDaUMsSUFBSTtRQUNoQkMsT0FBTyxFQUFFbEMsS0FBSyxDQUFDa0MsT0FBTztRQUN0QkMsS0FBSyxFQUFFbkMsS0FBSyxDQUFDbUMsS0FBSztRQUNsQkMsSUFBSSxFQUFFcEMsS0FBSyxDQUFDb0MsSUFBSTtRQUNoQi9ELElBQUksRUFBRStCO01BQ1IsQ0FBQyxDQUFDOztNQUVGO01BQ0EsSUFBSTtRQUNGWixPQUFPLENBQUNDLEdBQUcsQ0FBQyxnREFBZ0QsQ0FBQztRQUM3RDZCLHVCQUF1QixHQUFHaEQsT0FBTyxDQUFDOEIscUJBQXFCLENBQUM7UUFDeERaLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHVDQUF1QyxDQUFDO01BQ3RELENBQUMsQ0FBQyxPQUFPNEMsV0FBVyxFQUFFO1FBQ3BCN0MsT0FBTyxDQUFDUSxLQUFLLENBQUMsaURBQWlELEVBQUVxQyxXQUFXLENBQUNILE9BQU8sQ0FBQztRQUNyRixNQUFNLElBQUlJLEtBQUssQ0FBQyxxQ0FBcUN0QyxLQUFLLENBQUNrQyxPQUFPLEVBQUUsQ0FBQztNQUN2RTtJQUNGO0lBRUEsTUFBTUssaUJBQWlCLEdBQUdqQix1QkFBdUIsQ0FBQ2tCLGlCQUFpQixJQUFJbEIsdUJBQXVCLENBQUNtQixPQUFPLElBQUluQix1QkFBdUI7O0lBRWpJO0lBQ0E5QixPQUFPLENBQUNDLEdBQUcsQ0FBQyw0Q0FBNEMsRUFBRTtNQUN4RGlELGFBQWEsRUFBRSxDQUFDLEVBQUVILGlCQUFpQixJQUFJQSxpQkFBaUIsQ0FBQ0ksVUFBVSxDQUFDO01BQ3BFQyxvQkFBb0IsRUFBRSxPQUFPTCxpQkFBaUIsRUFBRWxELGlCQUFpQixLQUFLLFVBQVU7TUFDaEZ3RCwwQkFBMEIsRUFBRSxPQUFPTixpQkFBaUIsRUFBRU8sdUJBQXVCLEtBQUssVUFBVTtNQUM1RkMseUJBQXlCLEVBQUUsT0FBT1IsaUJBQWlCLEVBQUVTLHNCQUFzQixLQUFLLFVBQVU7TUFDMUZDLG1CQUFtQixFQUFFVixpQkFBaUIsSUFBSUEsaUJBQWlCLENBQUNJLFVBQVUsR0FDcEVsQixNQUFNLENBQUNELElBQUksQ0FBQ2UsaUJBQWlCLENBQUNJLFVBQVUsQ0FBQyxHQUFHO0lBQ2hELENBQUMsQ0FBQzs7SUFFRjtJQUNBcEQsd0JBQXdCLENBQUMsbUJBQW1CLEVBQUVnRCxpQkFBaUIsQ0FBQztJQUVoRS9DLE9BQU8sQ0FBQzBELE9BQU8sQ0FBQyw2Q0FBNkMsQ0FBQztJQUM5RDFELE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLGdEQUFnRCxDQUFDOztJQUU3RDtJQUNBMEQsTUFBTSxDQUFDWixpQkFBaUIsR0FBR0EsaUJBQWlCO0VBQzlDLENBQUMsQ0FBQyxPQUFPdkMsS0FBSyxFQUFFO0lBQ2RSLE9BQU8sQ0FBQzBELE9BQU8sQ0FBQyw2Q0FBNkMsQ0FBQztJQUM5RDFELE9BQU8sQ0FBQ1EsS0FBSyxDQUFDLDRDQUE0QyxFQUFFQSxLQUFLLENBQUM7SUFDbEVSLE9BQU8sQ0FBQ1EsS0FBSyxDQUFDLDRCQUE0QixFQUFFQSxLQUFLLENBQUNtQyxLQUFLLENBQUM7SUFDeEQzQyxPQUFPLENBQUNDLEdBQUcsQ0FBQyw0QkFBNEIsRUFBRTtNQUN4Q3dDLElBQUksRUFBRWpDLEtBQUssQ0FBQ2lDLElBQUk7TUFDaEJDLE9BQU8sRUFBRWxDLEtBQUssQ0FBQ2tDLE9BQU87TUFDdEJFLElBQUksRUFBRXBDLEtBQUssQ0FBQ29DLElBQUk7TUFDaEJnQixJQUFJLEVBQUUsT0FBT3BELEtBQUs7TUFDbEJxRCxRQUFRLEVBQUUsQ0FBQyxDQUFDckQsS0FBSyxDQUFDbUM7SUFDcEIsQ0FBQyxDQUFDO0VBQ0o7QUFDRixDQUFDLEVBQUUsQ0FBQztBQUVKLE1BQU1tQix5QkFBeUIsQ0FBQztFQUM5QkMsV0FBV0EsQ0FBQSxFQUFHO0lBQ1osSUFBSSxDQUFDQyxVQUFVLEdBQUcxRSxpQkFBaUI7SUFDbkMsSUFBSSxDQUFDMkUsYUFBYSxHQUFHMUUsdUJBQXVCO0lBQzVDLElBQUksQ0FBQzJFLHNCQUFzQixHQUFHLEdBQUcsQ0FBQyxDQUFDO0lBQ25DLElBQUksQ0FBQ0MsZ0JBQWdCLEdBQUd0RixJQUFJLENBQUM4QyxJQUFJLENBQUM1QyxHQUFHLENBQUNxRixPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsYUFBYSxDQUFDO0lBQ3pFcEUsT0FBTyxDQUFDQyxHQUFHLENBQUMsc0VBQXNFLEVBQUUsSUFBSSxDQUFDa0UsZ0JBQWdCLENBQUM7RUFDNUc7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsTUFBTUUsT0FBT0EsQ0FBQ0MsUUFBUSxFQUFFQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLEVBQUU7SUFDcEN2RSxPQUFPLENBQUNDLEdBQUcsQ0FBQyx1REFBdUQsQ0FBQztJQUNwRTtJQUNBLE1BQU11RSxTQUFTLEdBQUcsc0NBQXNDQyxJQUFJLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUU7SUFDcEUxRSxPQUFPLENBQUNXLElBQUksQ0FBQzZELFNBQVMsQ0FBQztJQUN2QnhFLE9BQU8sQ0FBQzJFLEtBQUssQ0FBQyx5Q0FBeUMsQ0FBQztJQUV4RCxNQUFNQyxTQUFTLEdBQUdILElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUM7SUFFNUIsSUFBSTtNQUNGO01BQ0EsSUFBSSxDQUFDSCxPQUFPLENBQUNNLFNBQVMsRUFBRTtRQUN0QjdFLE9BQU8sQ0FBQ1EsS0FBSyxDQUFDLDJDQUEyQyxDQUFDO1FBQzFEUixPQUFPLENBQUMwRCxPQUFPLENBQUNjLFNBQVMsQ0FBQztRQUMxQixNQUFNLElBQUkxQixLQUFLLENBQUMsNkNBQTZDLENBQUM7TUFDaEU7TUFFQTlDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDJDQUEyQyxFQUFFO1FBQ3ZENkUsU0FBUyxFQUFFQyxNQUFNLENBQUNDLFFBQVEsQ0FBQ1YsUUFBUSxDQUFDLEdBQUcsUUFBUSxHQUFHLE9BQU9BLFFBQVE7UUFDakVXLFdBQVcsRUFBRUYsTUFBTSxDQUFDQyxRQUFRLENBQUNWLFFBQVEsQ0FBQyxHQUFHQSxRQUFRLENBQUNZLE1BQU0sR0FBR0MsU0FBUztRQUNwRUMsUUFBUSxFQUFFYixPQUFPLENBQUNhLFFBQVE7UUFBRTtRQUM1QkMsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDZCxPQUFPLENBQUNlLE1BQU07UUFDcENDLFlBQVksRUFBRWhCLE9BQU8sQ0FBQ2UsTUFBTSxHQUFHZixPQUFPLENBQUNlLE1BQU0sQ0FBQ0osTUFBTSxHQUFHQyxTQUFTO1FBQ2hFWixPQUFPLEVBQUU7VUFDUCxHQUFHQSxPQUFPO1VBQ1ZlLE1BQU0sRUFBRWYsT0FBTyxDQUFDZSxNQUFNLEdBQUcsVUFBVWYsT0FBTyxDQUFDZSxNQUFNLENBQUNKLE1BQU0sR0FBRyxHQUFHQyxTQUFTO1VBQ3ZFSyxNQUFNLEVBQUVqQixPQUFPLENBQUNpQixNQUFNLEdBQUcsR0FBRyxHQUFHLEdBQUc7VUFDbENDLGFBQWEsRUFBRWxCLE9BQU8sQ0FBQ2tCLGFBQWEsR0FBRyxHQUFHLEdBQUc7UUFDL0M7TUFDRixDQUFDLENBQUM7TUFFRnpGLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHNDQUFzQyxFQUFFO1FBQ2xEWSxXQUFXLEVBQUVDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDQyxRQUFRLElBQUksU0FBUztRQUM5Q0ssVUFBVSxFQUFFdEMsR0FBRyxDQUFDc0MsVUFBVTtRQUMxQkosT0FBTyxFQUFFbEMsR0FBRyxDQUFDbUMsVUFBVSxDQUFDLENBQUM7UUFDekJ3RSx1QkFBdUIsRUFBRSxDQUFDLENBQUMvQixNQUFNLENBQUNaLGlCQUFpQjtRQUNuRDRDLDZCQUE2QixFQUFFLENBQUMsQ0FBQ3RGLHVCQUF1QjtRQUN4RHVGLGNBQWMsRUFBRXZGLHVCQUF1QixHQUFHLE9BQU9BLHVCQUF1QixDQUFDd0YsV0FBVyxLQUFLLFVBQVUsR0FBRztNQUN4RyxDQUFDLENBQUM7O01BRUY7TUFDQSxJQUFJdEIsT0FBTyxDQUFDZSxNQUFNLElBQUlQLE1BQU0sQ0FBQ0MsUUFBUSxDQUFDVCxPQUFPLENBQUNlLE1BQU0sQ0FBQyxFQUFFO1FBQ3JEdEYsT0FBTyxDQUFDQyxHQUFHLENBQUMsK0NBQStDLENBQUM7UUFDNURxRSxRQUFRLEdBQUdDLE9BQU8sQ0FBQ2UsTUFBTTtNQUMzQjs7TUFFQTtNQUNBLE1BQU1RLGVBQWUsR0FBRyxJQUFJbEcsZUFBZSxDQUFDMkUsT0FBTyxDQUFDd0IsVUFBVSxFQUFFLElBQUksQ0FBQzdCLHNCQUFzQixDQUFDOztNQUU1RjtNQUNBLE1BQU1rQixRQUFRLEdBQUdiLE9BQU8sQ0FBQ2EsUUFBUTtNQUVqQ3BGLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDRDQUE0QyxFQUFFO1FBQ3hEMkQsSUFBSSxFQUFFd0IsUUFBUTtRQUNkSixRQUFRLEVBQUVELE1BQU0sQ0FBQ0MsUUFBUSxDQUFDVixRQUFRLENBQUM7UUFDbkMwQixXQUFXLEVBQUV6QixPQUFPLENBQUN5QixXQUFXO1FBQ2hDQyxLQUFLLEVBQUUxQixPQUFPLENBQUNYLElBQUksS0FBSyxLQUFLLElBQUlXLE9BQU8sQ0FBQ1gsSUFBSSxLQUFLLFdBQVc7UUFDN0RzQyxXQUFXLEVBQUUzQixPQUFPLENBQUNYLElBQUksS0FBSztNQUNoQyxDQUFDLENBQUM7O01BRUY7TUFDQSxNQUFNdUMsZ0JBQWdCLEdBQUcsTUFBTTlGLHVCQUF1QixDQUFDd0YsV0FBVyxDQUFDdkIsUUFBUSxFQUFFO1FBQzNFLEdBQUdDLE9BQU87UUFDVmEsUUFBUTtRQUNSVTtNQUNGLENBQUMsQ0FBQztNQUVGLElBQUksQ0FBQ0ssZ0JBQWdCLENBQUNDLE9BQU8sRUFBRTtRQUM3QixNQUFNLElBQUl0RCxLQUFLLENBQUNxRCxnQkFBZ0IsQ0FBQzNGLEtBQUssSUFBSSxtQkFBbUIsQ0FBQztNQUNoRTs7TUFFQTtNQUNBLElBQUkyRixnQkFBZ0IsQ0FBQ0UsS0FBSyxLQUFLLElBQUksSUFBSUYsZ0JBQWdCLENBQUNHLFlBQVksRUFBRTtRQUNwRXRHLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHFFQUFxRWtHLGdCQUFnQixDQUFDRyxZQUFZLEVBQUUsQ0FBQzs7UUFFakg7UUFDQSxNQUFNdkQsaUJBQWlCLEdBQUdZLE1BQU0sQ0FBQ1osaUJBQWlCO1FBQ2xELElBQUksQ0FBQ0EsaUJBQWlCLEVBQUU7VUFDdEIsTUFBTSxJQUFJRCxLQUFLLENBQUMsdURBQXVELENBQUM7UUFDMUU7O1FBRUE7UUFDQSxJQUFJeUQsV0FBVyxHQUFHLElBQUk7UUFDdEIsSUFBSUMsUUFBUSxHQUFHLENBQUM7UUFDaEIsTUFBTUMsV0FBVyxHQUFHLEVBQUUsQ0FBQyxDQUFDOztRQUV4QixPQUFPRCxRQUFRLEdBQUdDLFdBQVcsRUFBRTtVQUM3QjtVQUNBLE1BQU03RSxVQUFVLEdBQUdtQixpQkFBaUIsQ0FBQzJELGFBQWEsQ0FBQ1AsZ0JBQWdCLENBQUNHLFlBQVksQ0FBQztVQUVqRixJQUFJLENBQUMxRSxVQUFVLEVBQUU7WUFDZjVCLE9BQU8sQ0FBQzJHLElBQUksQ0FBQyw2Q0FBNkNSLGdCQUFnQixDQUFDRyxZQUFZLHdCQUF3QixDQUFDO1lBQ2hIO1VBQ0Y7O1VBRUE7VUFDQSxJQUFJMUUsVUFBVSxDQUFDZ0YsTUFBTSxLQUFLLFdBQVcsSUFBSWhGLFVBQVUsQ0FBQ2lGLE1BQU0sRUFBRTtZQUMxRDdHLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLGtEQUFrRGtHLGdCQUFnQixDQUFDRyxZQUFZLFlBQVksQ0FBQztZQUN4R0MsV0FBVyxHQUFHM0UsVUFBVSxDQUFDaUYsTUFBTTtZQUMvQjtZQUNBOUQsaUJBQWlCLENBQUMrRCxjQUFjLENBQUNYLGdCQUFnQixDQUFDRyxZQUFZLEVBQUU7Y0FBRVMsU0FBUyxFQUFFO1lBQUssQ0FBQyxDQUFDO1lBQ3BGO1VBQ0Y7O1VBRUE7VUFDQSxJQUFJbkYsVUFBVSxDQUFDZ0YsTUFBTSxLQUFLLFFBQVEsRUFBRTtZQUNsQzVHLE9BQU8sQ0FBQ1EsS0FBSyxDQUFDLGtEQUFrRDJGLGdCQUFnQixDQUFDRyxZQUFZLFlBQVkxRSxVQUFVLENBQUNwQixLQUFLLElBQUksZUFBZSxFQUFFLENBQUM7O1lBRS9JO1lBQ0E7WUFDQSxJQUFJMkYsZ0JBQWdCLENBQUNhLGVBQWUsRUFBRTtjQUNwQyxNQUFNQyxrQkFBa0IsR0FBRyxJQUFJbkUsS0FBSyxDQUFDbEIsVUFBVSxDQUFDcEIsS0FBSyxJQUFJLHNCQUFzQixDQUFDO2NBQ2hGeUcsa0JBQWtCLENBQUNDLG9CQUFvQixHQUFHLElBQUk7Y0FDOUMsTUFBTUQsa0JBQWtCO1lBQzFCLENBQUMsTUFBTTtjQUNMLE1BQU0sSUFBSW5FLEtBQUssQ0FBQ2xCLFVBQVUsQ0FBQ3BCLEtBQUssSUFBSSx5QkFBeUIsQ0FBQztZQUNoRTtVQUNGOztVQUVBO1VBQ0EsTUFBTSxJQUFJMkcsT0FBTyxDQUFDQyxPQUFPLElBQUlDLFVBQVUsQ0FBQ0QsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1VBQ3REWixRQUFRLEVBQUU7UUFDWjs7UUFFQTtRQUNBLElBQUksQ0FBQ0QsV0FBVyxFQUFFO1VBQ2hCLE1BQU0sSUFBSXpELEtBQUssQ0FBQyxvQkFBb0JxRCxnQkFBZ0IsQ0FBQ0csWUFBWSw2QkFBNkIsQ0FBQztRQUNqRzs7UUFFQTtRQUNBLElBQUksQ0FBQ0MsV0FBVyxFQUFFO1VBQ2hCLE1BQU0sSUFBSXpELEtBQUssQ0FBQyx5Q0FBeUMsQ0FBQztRQUM1RDs7UUFFQTtRQUNBcUQsZ0JBQWdCLENBQUNtQixPQUFPLEdBQUdmLFdBQVc7UUFDdEN2RyxPQUFPLENBQUNDLEdBQUcsQ0FBQyw2RkFBNkZzRyxXQUFXLENBQUNyQixNQUFNLEdBQUcsQ0FBQztNQUNqSSxDQUFDLE1BQU07UUFDTDtRQUNBLE1BQU1vQyxPQUFPLEdBQUduQixnQkFBZ0IsQ0FBQ21CLE9BQU8sSUFBSSxFQUFFO1FBRTlDLElBQUksQ0FBQ0EsT0FBTyxFQUFFO1VBQ1osTUFBTSxJQUFJeEUsS0FBSyxDQUFDLG1DQUFtQyxDQUFDO1FBQ3REO01BQ0Y7O01BRUE7TUFDQSxNQUFNeUUsWUFBWSxHQUFHaEQsT0FBTyxDQUFDaUQsUUFBUSxJQUNsQnJCLGdCQUFnQixDQUFDcUIsUUFBUSxJQUN6QixNQUFNOztNQUV6QjtNQUNBLE1BQU1DLGdCQUFnQixHQUFHQyxLQUFLLENBQUNDLE9BQU8sQ0FBQ3hCLGdCQUFnQixDQUFDeUIsS0FBSyxDQUFDLElBQUl6QixnQkFBZ0IsQ0FBQ3lCLEtBQUssQ0FBQzFDLE1BQU0sR0FBRyxDQUFDO01BRW5HLElBQUl1QyxnQkFBZ0IsRUFBRTtRQUNwQnpILE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHdEQUF3RGtHLGdCQUFnQixDQUFDeUIsS0FBSyxDQUFDMUMsTUFBTSxRQUFRLENBQUM7TUFDNUc7O01BRUE7TUFDQTtNQUNBO01BQ0EsTUFBTTJDLGdCQUFnQixHQUFJMUIsZ0JBQWdCLENBQUMyQixRQUFRLElBQUkzQixnQkFBZ0IsQ0FBQzJCLFFBQVEsQ0FBQ0QsZ0JBQWdCLElBQ3pFMUIsZ0JBQWdCLENBQUMwQixnQkFBZ0IsSUFDakMxQixnQkFBZ0IsQ0FBQzFELElBQUksSUFDckI4QixPQUFPLENBQUNzRCxnQkFBZ0IsSUFDeEJ0RCxPQUFPLENBQUM5QixJQUFJOztNQUVwQztNQUNBLElBQUkyQyxRQUFRLEtBQUssTUFBTSxJQUFJQSxRQUFRLEtBQUssS0FBSyxFQUFFO1FBQzdDcEYsT0FBTyxDQUFDQyxHQUFHLENBQUMsdUVBQXVFLEVBQUU7VUFDbkY4SCxZQUFZLEVBQUU1QixnQkFBZ0IsQ0FBQzJCLFFBQVEsSUFBSTNCLGdCQUFnQixDQUFDMkIsUUFBUSxDQUFDRCxnQkFBZ0I7VUFDckZHLFVBQVUsRUFBRTdCLGdCQUFnQixDQUFDMEIsZ0JBQWdCO1VBQzdDSSxjQUFjLEVBQUU5QixnQkFBZ0IsQ0FBQzFELElBQUk7VUFDckN5RixXQUFXLEVBQUUzRCxPQUFPLENBQUNzRCxnQkFBZ0I7VUFDckNNLGVBQWUsRUFBRTVELE9BQU8sQ0FBQzlCLElBQUk7VUFDN0IyRixRQUFRLEVBQUVQLGdCQUFnQjtVQUMxQlEsWUFBWSxFQUFFbEMsZ0JBQWdCLENBQUMyQixRQUFRLEdBQUc3RixNQUFNLENBQUNELElBQUksQ0FBQ21FLGdCQUFnQixDQUFDMkIsUUFBUSxDQUFDLEdBQUcsRUFBRTtVQUNyRlEsVUFBVSxFQUFFckcsTUFBTSxDQUFDRCxJQUFJLENBQUNtRSxnQkFBZ0I7UUFDMUMsQ0FBQyxDQUFDO01BQ0o7TUFFQW5HLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLDZEQUE2RDRILGdCQUFnQixFQUFFLENBQUM7O01BRTVGO01BQ0EsSUFBSTFCLGdCQUFnQixDQUFDMkIsUUFBUSxFQUFFO1FBQzdCOUgsT0FBTyxDQUFDQyxHQUFHLENBQUMsNERBQTRELEVBQUU7VUFDeEUrQixJQUFJLEVBQUVDLE1BQU0sQ0FBQ0QsSUFBSSxDQUFDbUUsZ0JBQWdCLENBQUMyQixRQUFRLENBQUM7VUFDNUNTLG1CQUFtQixFQUFFLGtCQUFrQixJQUFJcEMsZ0JBQWdCLENBQUMyQixRQUFRO1VBQ3BFRCxnQkFBZ0IsRUFBRTFCLGdCQUFnQixDQUFDMkIsUUFBUSxDQUFDRDtRQUM5QyxDQUFDLENBQUM7TUFDSjs7TUFFQTtNQUNBLElBQUlXLGdCQUFnQixHQUFHO1FBQ3JCLElBQUlyQyxnQkFBZ0IsQ0FBQzJCLFFBQVEsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUNwQ0QsZ0JBQWdCLEVBQUVBLGdCQUFnQixDQUFDO01BQ3JDLENBQUM7O01BRUQ7TUFDQSxJQUFJekMsUUFBUSxLQUFLLE1BQU0sSUFBSUEsUUFBUSxLQUFLLEtBQUssRUFBRTtRQUM3Q3BGLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHdEQUF3RG1GLFFBQVEsR0FBRyxFQUFFb0QsZ0JBQWdCLENBQUM7O1FBRWxHO1FBQ0EsSUFBSSxDQUFDQSxnQkFBZ0IsQ0FBQ1gsZ0JBQWdCLEVBQUU7VUFDdEM3SCxPQUFPLENBQUMyRyxJQUFJLENBQUMsNEZBQTRGLENBQUM7VUFDMUc7VUFDQTZCLGdCQUFnQixHQUFHO1lBQUUsR0FBR0EsZ0JBQWdCO1lBQUVYO1VBQWlCLENBQUM7UUFDOUQ7TUFDRjtNQUVBLE1BQU1oQixNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUM1QyxhQUFhLENBQUN3RSxvQkFBb0IsQ0FBQztRQUMzRG5CLE9BQU8sRUFBRW5CLGdCQUFnQixDQUFDbUIsT0FBTztRQUFFO1FBQ25DUSxRQUFRLEVBQUVVLGdCQUFnQjtRQUFFO1FBQzVCRSxNQUFNLEVBQUV2QyxnQkFBZ0IsQ0FBQ3VDLE1BQU0sSUFBSSxFQUFFO1FBQ3JDZCxLQUFLLEVBQUV6QixnQkFBZ0IsQ0FBQ3lCLEtBQUs7UUFDN0JuRixJQUFJLEVBQUVvRixnQkFBZ0I7UUFBRTtRQUN4QmpFLElBQUksRUFBRXVDLGdCQUFnQixDQUFDdkMsSUFBSSxJQUFJd0IsUUFBUTtRQUN2Q0EsUUFBUSxFQUFFQSxRQUFRO1FBQUU7UUFDcEJQLFNBQVMsRUFBRU4sT0FBTyxDQUFDTSxTQUFTO1FBQzVCTixPQUFPLEVBQUU7VUFDUCxHQUFHQSxPQUFPO1VBQ1ZzRCxnQkFBZ0IsRUFBRUEsZ0JBQWdCO1VBQUU7VUFDcENMLFFBQVEsRUFBRUQsWUFBWTtVQUN0Qm9CLFNBQVMsRUFBRXhDLGdCQUFnQixDQUFDd0MsU0FBUztVQUNyQ0MsVUFBVSxFQUFFekMsZ0JBQWdCLENBQUN5QyxVQUFVO1VBQ3ZDbkI7UUFDRjtNQUNGLENBQUMsQ0FBQztNQUVGekgsT0FBTyxDQUFDQyxHQUFHLENBQUMsa0NBQWtDd0UsSUFBSSxDQUFDQyxHQUFHLENBQUMsQ0FBQyxHQUFHRSxTQUFTLEtBQUssRUFBRTtRQUN6RWlFLElBQUksRUFBRXZFLFFBQVE7UUFDZHdFLFVBQVUsRUFBRWpDLE1BQU0sQ0FBQ2lDO01BQ3JCLENBQUMsQ0FBQzs7TUFFRjtNQUNBOUksT0FBTyxDQUFDMEQsT0FBTyxDQUFDYyxTQUFTLENBQUM7TUFFMUIsT0FBT3FDLE1BQU07SUFFZixDQUFDLENBQUMsT0FBT3JHLEtBQUssRUFBRTtNQUNkUixPQUFPLENBQUMwRCxPQUFPLENBQUNjLFNBQVMsQ0FBQztNQUMxQnhFLE9BQU8sQ0FBQ1EsS0FBSyxDQUFDLDBFQUEwRSxDQUFDOztNQUV6RjtNQUNBLE1BQU00RSxRQUFRLEdBQUdiLE9BQU8sQ0FBQ2EsUUFBUSxJQUFJLFNBQVM7O01BRTlDO01BQ0FwRixPQUFPLENBQUNDLEdBQUcsQ0FBQyw2QkFBNkIsRUFBRTtRQUN6Q3dDLElBQUksRUFBRWpDLEtBQUssQ0FBQ2lDLElBQUk7UUFDaEJDLE9BQU8sRUFBRWxDLEtBQUssQ0FBQ2tDLE9BQU87UUFDdEJDLEtBQUssRUFBRW5DLEtBQUssQ0FBQ21DLEtBQUs7UUFDbEJDLElBQUksRUFBRXBDLEtBQUssQ0FBQ29DLElBQUk7UUFDaEJnQixJQUFJLEVBQUUsT0FBT3BEO01BQ2YsQ0FBQyxDQUFDOztNQUVGO01BQ0FSLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLHNEQUFzRCxFQUFFO1FBQ2xFeUYsdUJBQXVCLEVBQUUsQ0FBQyxDQUFDL0IsTUFBTSxDQUFDWixpQkFBaUI7UUFDbkRHLGFBQWEsRUFBRSxDQUFDLEVBQUVTLE1BQU0sQ0FBQ1osaUJBQWlCLElBQUlZLE1BQU0sQ0FBQ1osaUJBQWlCLENBQUNJLFVBQVUsQ0FBQztRQUNsRk0sbUJBQW1CLEVBQUVFLE1BQU0sQ0FBQ1osaUJBQWlCLElBQUlZLE1BQU0sQ0FBQ1osaUJBQWlCLENBQUNJLFVBQVUsR0FDbEZsQixNQUFNLENBQUNELElBQUksQ0FBQzJCLE1BQU0sQ0FBQ1osaUJBQWlCLENBQUNJLFVBQVUsQ0FBQyxHQUFHLE1BQU07UUFDM0R3Qyw2QkFBNkIsRUFBRSxDQUFDLENBQUN0Rix1QkFBdUI7UUFDeER1RixjQUFjLEVBQUV2Rix1QkFBdUIsR0FBRyxPQUFPQSx1QkFBdUIsQ0FBQ3dGLFdBQVcsS0FBSyxVQUFVLEdBQUc7TUFDeEcsQ0FBQyxDQUFDO01BRUYsTUFBTWtELFNBQVMsR0FBRztRQUNoQjNELFFBQVEsRUFBRUEsUUFBUTtRQUFFO1FBQ3BCeEIsSUFBSSxFQUFFVyxPQUFPLENBQUNYLElBQUk7UUFDbEJpRSxnQkFBZ0IsRUFBRXRELE9BQU8sQ0FBQ3NELGdCQUFnQjtRQUMxQzdDLFFBQVEsRUFBRUQsTUFBTSxDQUFDQyxRQUFRLENBQUNWLFFBQVEsQ0FBQztRQUNuQ2lCLFlBQVksRUFBRVIsTUFBTSxDQUFDQyxRQUFRLENBQUNWLFFBQVEsQ0FBQyxHQUFHQSxRQUFRLENBQUNZLE1BQU0sR0FBR0MsU0FBUztRQUNyRTNFLEtBQUssRUFBRUEsS0FBSyxDQUFDa0MsT0FBTztRQUNwQkMsS0FBSyxFQUFFbkMsS0FBSyxDQUFDbUMsS0FBSztRQUNsQnFHLGdCQUFnQixFQUFFLENBQUMsQ0FBQ3JGLE1BQU0sQ0FBQ1osaUJBQWlCLENBQUM7TUFDL0MsQ0FBQztNQUVEL0MsT0FBTyxDQUFDUSxLQUFLLENBQUMsZ0NBQWdDLEVBQUV1SSxTQUFTLENBQUM7O01BRTFEO01BQ0EsTUFBTUUsWUFBWSxHQUFHbEUsTUFBTSxDQUFDQyxRQUFRLENBQUNWLFFBQVEsQ0FBQyxHQUMxQyxxQkFBcUJDLE9BQU8sQ0FBQ3NELGdCQUFnQixJQUFJLE1BQU0sS0FBS3JILEtBQUssQ0FBQ2tDLE9BQU8sRUFBRSxHQUMzRSxxQkFBcUI0QixRQUFRLEtBQUs5RCxLQUFLLENBQUNrQyxPQUFPLEVBQUU7TUFFckQsT0FBTztRQUNMMEQsT0FBTyxFQUFFLEtBQUs7UUFDZDVGLEtBQUssRUFBRXlJLFlBQVk7UUFDbkJDLE9BQU8sRUFBRUgsU0FBUztRQUNsQjNELFFBQVEsRUFBRUEsUUFBUSxDQUFDO01BQ3JCLENBQUM7SUFDSDtFQUNGOztFQUVBO0FBQ0Y7QUFDQTtFQUNFLE1BQU0rRCxvQkFBb0JBLENBQUN0RSxTQUFTLEVBQUU7SUFDcEMsSUFBSTtNQUNGLE1BQU11RSxVQUFVLEdBQUd2RSxTQUFTLElBQUksSUFBSSxDQUFDVixnQkFBZ0I7TUFDckQsTUFBTSxJQUFJLENBQUNILFVBQVUsQ0FBQ3FGLGVBQWUsQ0FBQ0QsVUFBVSxDQUFDO01BQ2pEcEosT0FBTyxDQUFDQyxHQUFHLENBQUMsNEJBQTRCLEVBQUVtSixVQUFVLENBQUM7SUFDdkQsQ0FBQyxDQUFDLE9BQU81SSxLQUFLLEVBQUU7TUFDZFIsT0FBTyxDQUFDUSxLQUFLLENBQUMsc0NBQXNDLEVBQUVBLEtBQUssQ0FBQztNQUM1RCxNQUFNQSxLQUFLO0lBQ2I7RUFDRjtBQUNGO0FBRUE4SSxNQUFNLENBQUNDLE9BQU8sR0FBRyxJQUFJekYseUJBQXlCLENBQUMsQ0FBQyIsImlnbm9yZUxpc3QiOltdfQ==