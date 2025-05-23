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
      // For URL conversions, default to 'web' category
      const fileCategory = options.category || conversionResult.category || (options.type === 'url' || options.type === 'parenturl' ? 'web' : 'text');

      // Check if the conversion result has multiple files (for parenturl separate mode)
      const hasMultipleFiles = Array.isArray(conversionResult.files) && conversionResult.files.length > 0;
      const isMultipleFilesResult = conversionResult.type === 'multiple_files';
      if (hasMultipleFiles) {
        console.log(`📁 [ElectronConversionService] Conversion result has ${conversionResult.files.length} files`);
      }
      if (isMultipleFilesResult) {
        console.log(`📁 [ElectronConversionService] Multiple files result: ${conversionResult.totalFiles} files in ${conversionResult.outputDirectory}`);

        // For multiple files result, return the directory information directly
        return {
          success: true,
          outputPath: conversionResult.outputDirectory,
          indexFile: conversionResult.indexFile,
          files: conversionResult.files,
          totalFiles: conversionResult.totalFiles,
          summary: conversionResult.summary,
          type: 'multiple_files'
        };
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsIlBhdGhVdGlscyIsInByb21pc2lmeSIsImZzIiwicmVhZEZpbGVBc3luYyIsInJlYWRGaWxlIiwiaW5zdGFuY2UiLCJGaWxlU3lzdGVtU2VydmljZSIsIkNvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIiwiZ2V0RmlsZVR5cGUiLCJnZXRGaWxlSGFuZGxpbmdJbmZvIiwiSEFORExJTkdfVFlQRVMiLCJDT05WRVJURVJfQ09ORklHIiwiUHJvZ3Jlc3NUcmFja2VyIiwiY29udmVydFRvTWFya2Rvd24iLCJyZWdpc3RlckNvbnZlcnRlciIsInJlZ2lzdGVyQ29udmVydGVyRmFjdG9yeSIsImNvbnNvbGUiLCJsb2ciLCJoYW5kbGluZ1R5cGVzIiwiZmlsZUNvbmZpZyIsIk1vZHVsZVJlc29sdmVyIiwidW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJpbml0aWFsaXplIiwiY2F0Y2giLCJlcnJvciIsImdldENvbnZlcnRlclJlZ2lzdHJ5UGF0aCIsInJlc29sdmVNb2R1bGVQYXRoIiwidGltZSIsImNvbnZlcnRlclJlZ2lzdHJ5UGF0aCIsImVudmlyb25tZW50IiwicHJvY2VzcyIsImVudiIsIk5PREVfRU5WIiwiYXBwUGF0aCIsImdldEFwcFBhdGgiLCJjdXJyZW50RGlyIiwiX19kaXJuYW1lIiwiaXNQYWNrYWdlZCIsImZpbGVFeGlzdHMiLCJleGlzdHNTeW5jIiwiZGlybmFtZSIsInJlYWRkaXJTeW5jIiwic2VydmljZXMiLCJqb2luIiwiY29udmVyc2lvbiIsImRhdGEiLCJjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSIsInNhZmVSZXF1aXJlIiwia2V5cyIsIk9iamVjdCIsImhhc0NvbnZlcnRlclJlZ2lzdHJ5IiwiaGFzRGVmYXVsdEV4cG9ydCIsImV4cG9ydFR5cGVzIiwiZW50cmllcyIsIm1hcCIsImtleSIsInZhbHVlIiwibmFtZSIsIm1lc3NhZ2UiLCJzdGFjayIsImNvZGUiLCJkaXJlY3RFcnJvciIsIkVycm9yIiwiY29udmVydGVyUmVnaXN0cnkiLCJDb252ZXJ0ZXJSZWdpc3RyeSIsImRlZmF1bHQiLCJoYXNDb252ZXJ0ZXJzIiwiY29udmVydGVycyIsImhhc0NvbnZlcnRUb01hcmtkb3duIiwiaGFzR2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJnZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiIsImhhc0dldENvbnZlcnRlckJ5TWltZVR5cGUiLCJnZXRDb252ZXJ0ZXJCeU1pbWVUeXBlIiwiYXZhaWxhYmxlQ29udmVydGVycyIsInRpbWVFbmQiLCJnbG9iYWwiLCJ0eXBlIiwiaGFzU3RhY2siLCJFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJmaWxlU3lzdGVtIiwicmVzdWx0TWFuYWdlciIsInByb2dyZXNzVXBkYXRlSW50ZXJ2YWwiLCJkZWZhdWx0T3V0cHV0RGlyIiwiZ2V0UGF0aCIsImNvbnZlcnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJ0aW1lTGFiZWwiLCJEYXRlIiwibm93IiwidHJhY2UiLCJzdGFydFRpbWUiLCJvdXRwdXREaXIiLCJpbnB1dFR5cGUiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImlucHV0TGVuZ3RoIiwibGVuZ3RoIiwidW5kZWZpbmVkIiwiZmlsZVR5cGUiLCJoYXNCdWZmZXJJbk9wdGlvbnMiLCJidWZmZXIiLCJidWZmZXJMZW5ndGgiLCJhcGlLZXkiLCJtaXN0cmFsQXBpS2V5IiwiY29udmVydGVyUmVnaXN0cnlMb2FkZWQiLCJ1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZCIsImhhc0NvbnZlcnRGaWxlIiwiY29udmVydEZpbGUiLCJwcm9ncmVzc1RyYWNrZXIiLCJvblByb2dyZXNzIiwiaXNUZW1wb3JhcnkiLCJpc1VybCIsImlzUGFyZW50VXJsIiwiY29udmVyc2lvblJlc3VsdCIsInN1Y2Nlc3MiLCJhc3luYyIsImNvbnZlcnNpb25JZCIsImZpbmFsUmVzdWx0IiwiYXR0ZW1wdHMiLCJtYXhBdHRlbXB0cyIsImdldENvbnZlcnNpb24iLCJ3YXJuIiwic3RhdHVzIiwicmVzdWx0IiwicGluZ0NvbnZlcnNpb24iLCJyZXRyaWV2ZWQiLCJpc1RyYW5zY3JpcHRpb24iLCJ0cmFuc2NyaXB0aW9uRXJyb3IiLCJpc1RyYW5zY3JpcHRpb25FcnJvciIsIlByb21pc2UiLCJyZXNvbHZlIiwic2V0VGltZW91dCIsImNvbnRlbnQiLCJmaWxlQ2F0ZWdvcnkiLCJjYXRlZ29yeSIsImhhc011bHRpcGxlRmlsZXMiLCJBcnJheSIsImlzQXJyYXkiLCJmaWxlcyIsImlzTXVsdGlwbGVGaWxlc1Jlc3VsdCIsInRvdGFsRmlsZXMiLCJvdXRwdXREaXJlY3RvcnkiLCJvdXRwdXRQYXRoIiwiaW5kZXhGaWxlIiwic3VtbWFyeSIsIm9yaWdpbmFsRmlsZU5hbWUiLCJtZXRhZGF0YSIsImZyb21NZXRhZGF0YSIsImZyb21SZXN1bHQiLCJmcm9tUmVzdWx0TmFtZSIsImZyb21PcHRpb25zIiwiZnJvbU9wdGlvbnNOYW1lIiwicmVzb2x2ZWQiLCJtZXRhZGF0YUtleXMiLCJyZXN1bHRLZXlzIiwiaGFzT3JpZ2luYWxGaWxlTmFtZSIsImVuaGFuY2VkTWV0YWRhdGEiLCJzYXZlQ29udmVyc2lvblJlc3VsdCIsImltYWdlcyIsInBhZ2VDb3VudCIsInNsaWRlQ291bnQiLCJmaWxlIiwiZXJyb3JJbmZvIiwiY29udmVydGVyc0xvYWRlZCIsImVycm9yTWVzc2FnZSIsImRldGFpbHMiLCJzZXR1cE91dHB1dERpcmVjdG9yeSIsImRpclRvU2V0dXAiLCJjcmVhdGVEaXJlY3RvcnkiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanNcclxuICogSGFuZGxlcyBkb2N1bWVudCBjb252ZXJzaW9uIHVzaW5nIG5hdGl2ZSBmaWxlIHN5c3RlbSBvcGVyYXRpb25zIGluIEVsZWN0cm9uLlxyXG4gKiBDb29yZGluYXRlcyBjb252ZXJzaW9uIHByb2Nlc3NlcyBhbmQgZGVsZWdhdGVzIHRvIHRoZSBzaGFyZWQgY29udmVyc2lvbiB1dGlsaXRpZXMuXHJcbiAqXHJcbiAqIElNUE9SVEFOVDogV2hlbiBkZXRlcm1pbmluZyBmaWxlIHR5cGVzIGZvciBjb252ZXJzaW9uLCB3ZSBleHRyYWN0IHRoZSBmaWxlIGV4dGVuc2lvblxyXG4gKiBkaXJlY3RseSByYXRoZXIgdGhhbiB1c2luZyB0aGUgY2F0ZWdvcnkgZnJvbSBnZXRGaWxlVHlwZS4gVGhpcyBlbnN1cmVzIHRoYXQgd2UgdXNlXHJcbiAqIHRoZSBzcGVjaWZpYyBjb252ZXJ0ZXIgcmVnaXN0ZXJlZCBmb3IgZWFjaCBmaWxlIHR5cGUgKGUuZy4sICdwZGYnLCAnZG9jeCcsICdwcHR4JylcclxuICogcmF0aGVyIHRoYW4gdHJ5aW5nIHRvIHVzZSBhIGNvbnZlcnRlciBmb3IgdGhlIGNhdGVnb3J5ICgnZG9jdW1lbnRzJykuXHJcbiAqXHJcbiAqIFNwZWNpYWwgaGFuZGxpbmcgaXMgaW1wbGVtZW50ZWQgZm9yIGRhdGEgZmlsZXMgKENTViwgWExTWCkgdG8gZW5zdXJlIHRoZXkgdXNlIHRoZVxyXG4gKiBjb3JyZWN0IGNvbnZlcnRlciBiYXNlZCBvbiBmaWxlIGV4dGVuc2lvbi4gSWYgdGhlIGV4dGVuc2lvbiBjYW4ndCBiZSBkZXRlcm1pbmVkLFxyXG4gKiB3ZSBkZWZhdWx0IHRvICdjc3YnIHJhdGhlciB0aGFuIHVzaW5nIHRoZSBjYXRlZ29yeSAnZGF0YScuXHJcbiAqXHJcbiAqIEZvciBDU1YgZmlsZXMgc2VudCBhcyB0ZXh0IGNvbnRlbnQsIHdlIGRldGVjdCBDU1YgY29udGVudCBieSBjaGVja2luZyBmb3IgY29tbWFzLCB0YWJzLFxyXG4gKiBhbmQgbmV3bGluZXMsIGFuZCBwcm9jZXNzIGl0IGRpcmVjdGx5IHJhdGhlciB0aGFuIHRyZWF0aW5nIGl0IGFzIGEgZmlsZSBwYXRoLiBUaGlzIGZpeGVzXHJcbiAqIHRoZSBcIkZpbGUgbm90IGZvdW5kIG9yIGluYWNjZXNzaWJsZVwiIGVycm9yIHRoYXQgb2NjdXJyZWQgd2hlbiB0aGUgc3lzdGVtIHRyaWVkIHRvIGludGVycHJldFxyXG4gKiBDU1YgY29udGVudCBhcyBhIGZpbGUgcGF0aC5cclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgeyBQYXRoVXRpbHMgfSA9IHJlcXVpcmUoJy4uL3V0aWxzL3BhdGhzJyk7XHJcbmNvbnN0IHsgcHJvbWlzaWZ5IH0gPSByZXF1aXJlKCd1dGlsJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcclxuY29uc3QgcmVhZEZpbGVBc3luYyA9IHByb21pc2lmeShmcy5yZWFkRmlsZSk7XHJcbmNvbnN0IHsgaW5zdGFuY2U6IEZpbGVTeXN0ZW1TZXJ2aWNlIH0gPSByZXF1aXJlKCcuL0ZpbGVTeXN0ZW1TZXJ2aWNlJyk7IC8vIEltcG9ydCBpbnN0YW5jZVxyXG5jb25zdCBDb252ZXJzaW9uUmVzdWx0TWFuYWdlciA9IHJlcXVpcmUoJy4vQ29udmVyc2lvblJlc3VsdE1hbmFnZXInKTtcclxuLy8gSW1wb3J0IGxvY2FsIHV0aWxpdGllc1xyXG5jb25zdCB7IFxyXG4gIGdldEZpbGVUeXBlLFxyXG4gIGdldEZpbGVIYW5kbGluZ0luZm8sXHJcbiAgSEFORExJTkdfVFlQRVMsXHJcbiAgQ09OVkVSVEVSX0NPTkZJR1xyXG59ID0gcmVxdWlyZSgnLi4vdXRpbHMvZmlsZXMnKTtcclxuY29uc3QgeyBcclxuICBQcm9ncmVzc1RyYWNrZXIsIFxyXG4gIGNvbnZlcnRUb01hcmtkb3duLCBcclxuICByZWdpc3RlckNvbnZlcnRlcixcclxuICByZWdpc3RlckNvbnZlcnRlckZhY3RvcnlcclxufSA9IHJlcXVpcmUoJy4uL3V0aWxzL2NvbnZlcnNpb24nKTtcclxuXHJcbi8vIExvZyBhdmFpbGFibGUgZmlsZSBoYW5kbGluZyBjYXBhYmlsaXRpZXNcclxuY29uc29sZS5sb2coJ/Cfk4QgSW5pdGlhbGl6ZWQgd2l0aCBmaWxlIGhhbmRsaW5nOicsIHtcclxuICBoYW5kbGluZ1R5cGVzOiBIQU5ETElOR19UWVBFUyxcclxuICBmaWxlQ29uZmlnOiBDT05WRVJURVJfQ09ORklHXHJcbn0pO1xyXG5cclxuLy8gSW1wb3J0IE1vZHVsZVJlc29sdmVyIGFuZCBVbmlmaWVkQ29udmVydGVyRmFjdG9yeVxyXG5jb25zdCB7IE1vZHVsZVJlc29sdmVyIH0gPSByZXF1aXJlKCcuLi91dGlscy9tb2R1bGVSZXNvbHZlcicpO1xyXG5jb25zdCB1bmlmaWVkQ29udmVydGVyRmFjdG9yeSA9IHJlcXVpcmUoJy4uL2NvbnZlcnRlcnMvVW5pZmllZENvbnZlcnRlckZhY3RvcnknKTtcclxuXHJcbi8vIEluaXRpYWxpemUgdGhlIGNvbnZlcnRlciBmYWN0b3J5XHJcbnVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmluaXRpYWxpemUoKS5jYXRjaChlcnJvciA9PiB7XHJcbiAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBpbml0aWFsaXplIGNvbnZlcnRlciBmYWN0b3J5OicsIGVycm9yKTtcclxufSk7XHJcblxyXG4vLyBGdW5jdGlvbiB0byBnZXQgY29ycmVjdCBjb252ZXJ0ZXIgcmVnaXN0cnkgcGF0aCB1c2luZyBNb2R1bGVSZXNvbHZlclxyXG5jb25zdCBnZXRDb252ZXJ0ZXJSZWdpc3RyeVBhdGggPSAoKSA9PiB7XHJcbiAgY29uc29sZS5sb2coJ/Cfk4IgR2V0dGluZyBjb252ZXJ0ZXIgcmVnaXN0cnkgcGF0aCB1c2luZyBNb2R1bGVSZXNvbHZlcicpO1xyXG4gIHJldHVybiBNb2R1bGVSZXNvbHZlci5yZXNvbHZlTW9kdWxlUGF0aCgnQ29udmVydGVyUmVnaXN0cnkuanMnLCAnc2VydmljZXMvY29udmVyc2lvbicpO1xyXG59O1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBjb252ZXJ0ZXJzIHVzaW5nIE1vZHVsZVJlc29sdmVyXHJcbihmdW5jdGlvbigpIHtcclxuICB0cnkge1xyXG4gICAgY29uc29sZS5sb2coJ/CflIQgW1ZFUkJPU0VdIFN0YXJ0aW5nIGNvbnZlcnRlcnMgaW5pdGlhbGl6YXRpb24nKTtcclxuICAgIGNvbnNvbGUudGltZSgn8J+VkiBbVkVSQk9TRV0gQ29udmVydGVycyBpbml0aWFsaXphdGlvbiB0aW1lJyk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBVc2luZyBNb2R1bGVSZXNvbHZlciB0byBmaW5kIENvbnZlcnRlclJlZ2lzdHJ5LmpzJyk7XHJcbiAgICBjb25zdCBjb252ZXJ0ZXJSZWdpc3RyeVBhdGggPSBnZXRDb252ZXJ0ZXJSZWdpc3RyeVBhdGgoKTtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBMb2FkaW5nIGNvbnZlcnRlciByZWdpc3RyeSBmcm9tIHBhdGg6JywgY29udmVydGVyUmVnaXN0cnlQYXRoKTtcclxuICAgIFxyXG4gICAgLy8gTG9nIGVudmlyb25tZW50IGRldGFpbHNcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBFbnZpcm9ubWVudCBkZXRhaWxzOicsIHtcclxuICAgICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICd1bmtub3duJyxcclxuICAgICAgYXBwUGF0aDogYXBwLmdldEFwcFBhdGgoKSxcclxuICAgICAgY3VycmVudERpcjogX19kaXJuYW1lLFxyXG4gICAgICBpc1BhY2thZ2VkOiBhcHAuaXNQYWNrYWdlZFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIENoZWNrIGlmIHRoZSBmaWxlIGV4aXN0c1xyXG4gICAgY29uc3QgZmlsZUV4aXN0cyA9IGZzLmV4aXN0c1N5bmMoY29udmVydGVyUmVnaXN0cnlQYXRoKTtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBSZWdpc3RyeSBmaWxlIGV4aXN0cyBjaGVjazonLCBmaWxlRXhpc3RzKTtcclxuICAgIFxyXG4gICAgaWYgKCFmaWxlRXhpc3RzKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gUmVnaXN0cnkgZmlsZSBkb2VzIG5vdCBleGlzdCBhdCBwYXRoOicsIGNvbnZlcnRlclJlZ2lzdHJ5UGF0aCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5OCIFtWRVJCT1NFXSBEaXJlY3RvcnkgY29udGVudHM6Jywge1xyXG4gICAgICAgIGRpcm5hbWU6IGZzLmV4aXN0c1N5bmMoX19kaXJuYW1lKSA/IGZzLnJlYWRkaXJTeW5jKF9fZGlybmFtZSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgYXBwUGF0aDogZnMuZXhpc3RzU3luYyhhcHAuZ2V0QXBwUGF0aCgpKSA/IGZzLnJlYWRkaXJTeW5jKGFwcC5nZXRBcHBQYXRoKCkpIDogJ2RpcmVjdG9yeSBub3QgZm91bmQnLFxyXG4gICAgICAgIHNlcnZpY2VzOiBmcy5leGlzdHNTeW5jKHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicpKSA/XHJcbiAgICAgICAgICBmcy5yZWFkZGlyU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nKSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgY29udmVyc2lvbjogZnMuZXhpc3RzU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnY29udmVyc2lvbicpKSA/XHJcbiAgICAgICAgICBmcy5yZWFkZGlyU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnY29udmVyc2lvbicpKSA6ICdkaXJlY3Rvcnkgbm90IGZvdW5kJyxcclxuICAgICAgICBkYXRhOiBmcy5leGlzdHNTeW5jKHBhdGguam9pbihfX2Rpcm5hbWUsICdjb252ZXJzaW9uL2RhdGEnKSkgP1xyXG4gICAgICAgICAgZnMucmVhZGRpclN5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJ2NvbnZlcnNpb24vZGF0YScpKSA6ICdkaXJlY3Rvcnkgbm90IGZvdW5kJ1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gVXNlIE1vZHVsZVJlc29sdmVyIHRvIHNhZmVseSByZXF1aXJlIHRoZSBjb252ZXJ0ZXIgcmVnaXN0cnlcclxuICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBVc2luZyBNb2R1bGVSZXNvbHZlci5zYWZlUmVxdWlyZSBmb3IgQ29udmVydGVyUmVnaXN0cnknKTtcclxuICAgIFxyXG4gICAgbGV0IGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlO1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVXNlIG91ciBNb2R1bGVSZXNvbHZlciB0byBsb2FkIHRoZSBtb2R1bGVcclxuICAgICAgY29udmVydGVyUmVnaXN0cnlNb2R1bGUgPSBNb2R1bGVSZXNvbHZlci5zYWZlUmVxdWlyZSgnQ29udmVydGVyUmVnaXN0cnkuanMnLCAnc2VydmljZXMvY29udmVyc2lvbicpO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+TpiBbVkVSQk9TRV0gTW9kdWxlUmVzb2x2ZXIgc3VjY2Vzc2Z1bC4gTW9kdWxlIHN0cnVjdHVyZTonLCB7XHJcbiAgICAgICAga2V5czogT2JqZWN0LmtleXMoY29udmVydGVyUmVnaXN0cnlNb2R1bGUpLFxyXG4gICAgICAgIGhhc0NvbnZlcnRlclJlZ2lzdHJ5OiAnQ29udmVydGVyUmVnaXN0cnknIGluIGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlLFxyXG4gICAgICAgIGhhc0RlZmF1bHRFeHBvcnQ6ICdkZWZhdWx0JyBpbiBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSxcclxuICAgICAgICBleHBvcnRUeXBlczogT2JqZWN0LmVudHJpZXMoY29udmVydGVyUmVnaXN0cnlNb2R1bGUpLm1hcCgoW2tleSwgdmFsdWVdKSA9PlxyXG4gICAgICAgICAgYCR7a2V5fTogJHt0eXBlb2YgdmFsdWV9JHt2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnID8gYCB3aXRoIGtleXMgWyR7T2JqZWN0LmtleXModmFsdWUpLmpvaW4oJywgJyl9XWAgOiAnJ31gXHJcbiAgICAgICAgKVxyXG4gICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gTW9kdWxlIGxvYWRpbmcgZmFpbGVkIHdpdGggZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gRXJyb3IgZGV0YWlsczonLCB7XHJcbiAgICAgICAgbmFtZTogZXJyb3IubmFtZSxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcclxuICAgICAgICBjb2RlOiBlcnJvci5jb2RlLFxyXG4gICAgICAgIHBhdGg6IGNvbnZlcnRlclJlZ2lzdHJ5UGF0aFxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIFRyeSBmYWxsYmFjayB0byBkaXJlY3QgcmVxdWlyZSBhcyBhIGxhc3QgcmVzb3J0XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ/CflIQgW1ZFUkJPU0VdIFRyeWluZyBkaXJlY3QgcmVxdWlyZSBhcyBmYWxsYmFjaycpO1xyXG4gICAgICAgIGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlID0gcmVxdWlyZShjb252ZXJ0ZXJSZWdpc3RyeVBhdGgpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgW1ZFUkJPU0VdIERpcmVjdCByZXF1aXJlIHN1Y2Nlc3NmdWwnKTtcclxuICAgICAgfSBjYXRjaCAoZGlyZWN0RXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIEFsbCBtb2R1bGUgbG9hZGluZyBhdHRlbXB0cyBmYWlsZWQ6JywgZGlyZWN0RXJyb3IubWVzc2FnZSk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgbG9hZCBDb252ZXJ0ZXJSZWdpc3RyeTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGNvbnN0IGNvbnZlcnRlclJlZ2lzdHJ5ID0gY29udmVydGVyUmVnaXN0cnlNb2R1bGUuQ29udmVydGVyUmVnaXN0cnkgfHwgY29udmVydGVyUmVnaXN0cnlNb2R1bGUuZGVmYXVsdCB8fCBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZTtcclxuICAgIFxyXG4gICAgLy8gTG9nIGRldGFpbGVkIGluZm9ybWF0aW9uIGFib3V0IHRoZSBjb252ZXJ0ZXIgcmVnaXN0cnlcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBDb252ZXJ0ZXIgcmVnaXN0cnkgc3RydWN0dXJlOicsIHtcclxuICAgICAgaGFzQ29udmVydGVyczogISEoY29udmVydGVyUmVnaXN0cnkgJiYgY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycyksXHJcbiAgICAgIGhhc0NvbnZlcnRUb01hcmtkb3duOiB0eXBlb2YgY29udmVydGVyUmVnaXN0cnk/LmNvbnZlcnRUb01hcmtkb3duID09PSAnZnVuY3Rpb24nLFxyXG4gICAgICBoYXNHZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbjogdHlwZW9mIGNvbnZlcnRlclJlZ2lzdHJ5Py5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiA9PT0gJ2Z1bmN0aW9uJyxcclxuICAgICAgaGFzR2V0Q29udmVydGVyQnlNaW1lVHlwZTogdHlwZW9mIGNvbnZlcnRlclJlZ2lzdHJ5Py5nZXRDb252ZXJ0ZXJCeU1pbWVUeXBlID09PSAnZnVuY3Rpb24nLFxyXG4gICAgICBhdmFpbGFibGVDb252ZXJ0ZXJzOiBjb252ZXJ0ZXJSZWdpc3RyeSAmJiBjb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzID9cclxuICAgICAgICBPYmplY3Qua2V5cyhjb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzKSA6ICdub25lJ1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIFJlZ2lzdGVyIHRoZSBjb252ZXJ0ZXIgZmFjdG9yeVxyXG4gICAgcmVnaXN0ZXJDb252ZXJ0ZXJGYWN0b3J5KCdjb252ZXJ0ZXJSZWdpc3RyeScsIGNvbnZlcnRlclJlZ2lzdHJ5KTtcclxuICAgIFxyXG4gICAgY29uc29sZS50aW1lRW5kKCfwn5WSIFtWRVJCT1NFXSBDb252ZXJ0ZXJzIGluaXRpYWxpemF0aW9uIHRpbWUnKTtcclxuICAgIGNvbnNvbGUubG9nKCfinIUgW1ZFUkJPU0VdIENvbnZlcnRlcnMgcmVnaXN0ZXJlZCBzdWNjZXNzZnVsbHknKTtcclxuICAgIFxyXG4gICAgLy8gU3RvcmUgaW4gZ2xvYmFsIGZvciBlcnJvciBjaGVja2luZ1xyXG4gICAgZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5ID0gY29udmVydGVyUmVnaXN0cnk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUudGltZUVuZCgn8J+VkiBbVkVSQk9TRV0gQ29udmVydGVycyBpbml0aWFsaXphdGlvbiB0aW1lJyk7XHJcbiAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIEZhaWxlZCB0byByZWdpc3RlciBjb252ZXJ0ZXJzOicsIGVycm9yKTtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gRXJyb3IgZGV0YWlsczonLCBlcnJvci5zdGFjayk7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gRXJyb3Igb2JqZWN0OicsIHtcclxuICAgICAgbmFtZTogZXJyb3IubmFtZSxcclxuICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcclxuICAgICAgY29kZTogZXJyb3IuY29kZSxcclxuICAgICAgdHlwZTogdHlwZW9mIGVycm9yLFxyXG4gICAgICBoYXNTdGFjazogISFlcnJvci5zdGFja1xyXG4gICAgfSk7XHJcbiAgfVxyXG59KSgpO1xyXG5cclxuY2xhc3MgRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZSB7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmZpbGVTeXN0ZW0gPSBGaWxlU3lzdGVtU2VydmljZTtcclxuICAgIHRoaXMucmVzdWx0TWFuYWdlciA9IENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyO1xyXG4gICAgdGhpcy5wcm9ncmVzc1VwZGF0ZUludGVydmFsID0gMjUwOyAvLyBVcGRhdGUgcHJvZ3Jlc3MgZXZlcnkgMjUwbXNcclxuICAgIHRoaXMuZGVmYXVsdE91dHB1dERpciA9IHBhdGguam9pbihhcHAuZ2V0UGF0aCgndXNlckRhdGEnKSwgJ2NvbnZlcnNpb25zJyk7XHJcbiAgICBjb25zb2xlLmxvZygnRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZSBpbml0aWFsaXplZCB3aXRoIGRlZmF1bHQgb3V0cHV0IGRpcmVjdG9yeTonLCB0aGlzLmRlZmF1bHRPdXRwdXREaXIpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ29udmVydHMgYSBmaWxlIHRvIG1hcmtkb3duIGZvcm1hdFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfEJ1ZmZlcn0gZmlsZVBhdGggLSBQYXRoIHRvIHRoZSBmaWxlIG9yIGZpbGUgY29udGVudCBhcyBidWZmZXJcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IC0gQ29udmVyc2lvbiByZXN1bHRcclxuICAgKi9cclxuICBhc3luYyBjb252ZXJ0KGZpbGVQYXRoLCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmNvbnZlcnQgY2FsbGVkJyk7XHJcbiAgICAvLyBVc2UgYSB1bmlxdWUgbGFiZWwgZm9yIGVhY2ggY29udmVyc2lvbiB0byBhdm9pZCBkdXBsaWNhdGUgbGFiZWwgd2FybmluZ3NcclxuICAgIGNvbnN0IHRpbWVMYWJlbCA9IGDwn5WSIFtWRVJCT1NFXSBUb3RhbCBjb252ZXJzaW9uIHRpbWUgJHtEYXRlLm5vdygpfWA7XHJcbiAgICBjb25zb2xlLnRpbWUodGltZUxhYmVsKTtcclxuICAgIGNvbnNvbGUudHJhY2UoJ/CflIQgW1ZFUkJPU0VdIENvbnZlcnQgbWV0aG9kIHN0YWNrIHRyYWNlJyk7XHJcbiAgICBcclxuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFZhbGlkYXRlIG91dHB1dCBkaXJlY3RvcnlcclxuICAgICAgaWYgKCFvcHRpb25zLm91dHB1dERpcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gTm8gb3V0cHV0IGRpcmVjdG9yeSBwcm92aWRlZCEnKTtcclxuICAgICAgICBjb25zb2xlLnRpbWVFbmQodGltZUxhYmVsKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ091dHB1dCBkaXJlY3RvcnkgaXMgcmVxdWlyZWQgZm9yIGNvbnZlcnNpb24nKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coJ/Cfk6UgW1ZFUkJPU0VdIFJlY2VpdmVkIGNvbnZlcnNpb24gcmVxdWVzdDonLCB7XHJcbiAgICAgICAgaW5wdXRUeXBlOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpID8gJ0J1ZmZlcicgOiB0eXBlb2YgZmlsZVBhdGgsXHJcbiAgICAgICAgaW5wdXRMZW5ndGg6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCkgPyBmaWxlUGF0aC5sZW5ndGggOiB1bmRlZmluZWQsXHJcbiAgICAgICAgZmlsZVR5cGU6IG9wdGlvbnMuZmlsZVR5cGUsIC8vIExvZyB0aGUgZmlsZVR5cGUgd2UgcmVjZWl2ZWQgZnJvbSBmcm9udGVuZFxyXG4gICAgICAgIGhhc0J1ZmZlckluT3B0aW9uczogISFvcHRpb25zLmJ1ZmZlcixcclxuICAgICAgICBidWZmZXJMZW5ndGg6IG9wdGlvbnMuYnVmZmVyID8gb3B0aW9ucy5idWZmZXIubGVuZ3RoIDogdW5kZWZpbmVkLFxyXG4gICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICBidWZmZXI6IG9wdGlvbnMuYnVmZmVyID8gYEJ1ZmZlcigke29wdGlvbnMuYnVmZmVyLmxlbmd0aH0pYCA6IHVuZGVmaW5lZCxcclxuICAgICAgICAgIGFwaUtleTogb3B0aW9ucy5hcGlLZXkgPyAn4pyTJyA6ICfinJcnLFxyXG4gICAgICAgICAgbWlzdHJhbEFwaUtleTogb3B0aW9ucy5taXN0cmFsQXBpS2V5ID8gJ+KckycgOiAn4pyXJ1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gQ29udmVyc2lvbiBlbnZpcm9ubWVudDonLCB7XHJcbiAgICAgICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICd1bmtub3duJyxcclxuICAgICAgICBpc1BhY2thZ2VkOiBhcHAuaXNQYWNrYWdlZCxcclxuICAgICAgICBhcHBQYXRoOiBhcHAuZ2V0QXBwUGF0aCgpLFxyXG4gICAgICAgIGNvbnZlcnRlclJlZ2lzdHJ5TG9hZGVkOiAhIWdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSxcclxuICAgICAgICB1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZDogISF1bmlmaWVkQ29udmVydGVyRmFjdG9yeSxcclxuICAgICAgICBoYXNDb252ZXJ0RmlsZTogdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPyB0eXBlb2YgdW5pZmllZENvbnZlcnRlckZhY3RvcnkuY29udmVydEZpbGUgPT09ICdmdW5jdGlvbicgOiBmYWxzZVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIElmIHdlIGhhdmUgYSBidWZmZXIgaW4gb3B0aW9ucywgdXNlIHRoYXQgaW5zdGVhZCBvZiB0aGUgaW5wdXRcclxuICAgICAgaWYgKG9wdGlvbnMuYnVmZmVyICYmIEJ1ZmZlci5pc0J1ZmZlcihvcHRpb25zLmJ1ZmZlcikpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+TpiBVc2luZyBidWZmZXIgZnJvbSBvcHRpb25zIGluc3RlYWQgb2YgaW5wdXQnKTtcclxuICAgICAgICBmaWxlUGF0aCA9IG9wdGlvbnMuYnVmZmVyO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDcmVhdGUgYSBwcm9ncmVzcyB0cmFja2VyXHJcbiAgICAgIGNvbnN0IHByb2dyZXNzVHJhY2tlciA9IG5ldyBQcm9ncmVzc1RyYWNrZXIob3B0aW9ucy5vblByb2dyZXNzLCB0aGlzLnByb2dyZXNzVXBkYXRlSW50ZXJ2YWwpO1xyXG4gICAgICBcclxuICAgICAgLy8gVXNlIHRoZSBmaWxlVHlwZSBwcm92aWRlZCBieSB0aGUgZnJvbnRlbmQgLSBubyByZWRldGVybWluYXRpb25cclxuICAgICAgY29uc3QgZmlsZVR5cGUgPSBvcHRpb25zLmZpbGVUeXBlO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coJ/CflIQgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIFByb2Nlc3Npbmc6Jywge1xyXG4gICAgICAgIHR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIGlzQnVmZmVyOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpLFxyXG4gICAgICAgIGlzVGVtcG9yYXJ5OiBvcHRpb25zLmlzVGVtcG9yYXJ5LFxyXG4gICAgICAgIGlzVXJsOiBvcHRpb25zLnR5cGUgPT09ICd1cmwnIHx8IG9wdGlvbnMudHlwZSA9PT0gJ3BhcmVudHVybCcsXHJcbiAgICAgICAgaXNQYXJlbnRVcmw6IG9wdGlvbnMudHlwZSA9PT0gJ3BhcmVudHVybCdcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBEZWxlZ2F0ZSB0byBVbmlmaWVkQ29udmVydGVyRmFjdG9yeSB3aXRoIHRoZSBmaWxlVHlwZSBmcm9tIGZyb250ZW5kXHJcbiAgICAgIGNvbnN0IGNvbnZlcnNpb25SZXN1bHQgPSBhd2FpdCB1bmlmaWVkQ29udmVydGVyRmFjdG9yeS5jb252ZXJ0RmlsZShmaWxlUGF0aCwge1xyXG4gICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgZmlsZVR5cGUsXHJcbiAgICAgICAgcHJvZ3Jlc3NUcmFja2VyXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgaWYgKCFjb252ZXJzaW9uUmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoY29udmVyc2lvblJlc3VsdC5lcnJvciB8fCAnQ29udmVyc2lvbiBmYWlsZWQnKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgaWYgdGhpcyBpcyBhbiBhc3luY2hyb25vdXMgY29udmVyc2lvbiAoaGFzIGFzeW5jOiB0cnVlIGFuZCBjb252ZXJzaW9uSWQpXHJcbiAgICAgIGlmIChjb252ZXJzaW9uUmVzdWx0LmFzeW5jID09PSB0cnVlICYmIGNvbnZlcnNpb25SZXN1bHQuY29udmVyc2lvbklkKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCflIQgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIEhhbmRsaW5nIGFzeW5jIGNvbnZlcnNpb24gd2l0aCBJRDogJHtjb252ZXJzaW9uUmVzdWx0LmNvbnZlcnNpb25JZH1gKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBHZXQgdGhlIGNvbnZlcnRlciByZWdpc3RyeVxyXG4gICAgICAgIGNvbnN0IGNvbnZlcnRlclJlZ2lzdHJ5ID0gZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gICAgICAgIGlmICghY29udmVydGVyUmVnaXN0cnkpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVydGVyIHJlZ2lzdHJ5IG5vdCBhdmFpbGFibGUgZm9yIGFzeW5jIGNvbnZlcnNpb24nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUG9sbCBmb3IgdGhlIGNvbnZlcnNpb24gcmVzdWx0XHJcbiAgICAgICAgbGV0IGZpbmFsUmVzdWx0ID0gbnVsbDtcclxuICAgICAgICBsZXQgYXR0ZW1wdHMgPSAwO1xyXG4gICAgICAgIGNvbnN0IG1heEF0dGVtcHRzID0gNjA7IC8vIDMwIHNlY29uZHMgKDUwMG1zICogNjApXHJcbiAgICAgICAgXHJcbiAgICAgICAgd2hpbGUgKGF0dGVtcHRzIDwgbWF4QXR0ZW1wdHMpIHtcclxuICAgICAgICAgIC8vIEdldCB0aGUgY29udmVyc2lvbiBmcm9tIHRoZSByZWdpc3RyeVxyXG4gICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IGNvbnZlcnRlclJlZ2lzdHJ5LmdldENvbnZlcnNpb24oY29udmVyc2lvblJlc3VsdC5jb252ZXJzaW9uSWQpO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBpZiAoIWNvbnZlcnNpb24pIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIENvbnZlcnNpb24gJHtjb252ZXJzaW9uUmVzdWx0LmNvbnZlcnNpb25JZH0gbm90IGZvdW5kIGluIHJlZ2lzdHJ5YCk7XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgY29udmVyc2lvbiBpcyBjb21wbGV0ZVxyXG4gICAgICAgICAgaWYgKGNvbnZlcnNpb24uc3RhdHVzID09PSAnY29tcGxldGVkJyAmJiBjb252ZXJzaW9uLnJlc3VsdCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg4pyFIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBBc3luYyBjb252ZXJzaW9uICR7Y29udmVyc2lvblJlc3VsdC5jb252ZXJzaW9uSWR9IGNvbXBsZXRlZGApO1xyXG4gICAgICAgICAgICBmaW5hbFJlc3VsdCA9IGNvbnZlcnNpb24ucmVzdWx0O1xyXG4gICAgICAgICAgICAvLyBNYXJrIHRoZSBjb252ZXJzaW9uIGFzIHJldHJpZXZlZCBzbyBpdCBjYW4gYmUgY2xlYW5lZCB1cFxyXG4gICAgICAgICAgICBjb252ZXJ0ZXJSZWdpc3RyeS5waW5nQ29udmVyc2lvbihjb252ZXJzaW9uUmVzdWx0LmNvbnZlcnNpb25JZCwgeyByZXRyaWV2ZWQ6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgY29udmVyc2lvbiBmYWlsZWRcclxuICAgICAgICAgIGlmIChjb252ZXJzaW9uLnN0YXR1cyA9PT0gJ2ZhaWxlZCcpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBBc3luYyBjb252ZXJzaW9uICR7Y29udmVyc2lvblJlc3VsdC5jb252ZXJzaW9uSWR9IGZhaWxlZDogJHtjb252ZXJzaW9uLmVycm9yIHx8ICdVbmtub3duIGVycm9yJ31gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIElmIHRoaXMgaXMgYSB0cmFuc2NyaXB0aW9uIGNvbnZlcnNpb24sIHdlIHdhbnQgdG8gdGhyb3cgYSBzcGVjaWZpYyBlcnJvclxyXG4gICAgICAgICAgICAvLyB0aGF0IHdpbGwgYmUgY2F1Z2h0IGFuZCBoYW5kbGVkIGRpZmZlcmVudGx5IGJ5IHRoZSBVSVxyXG4gICAgICAgICAgICBpZiAoY29udmVyc2lvblJlc3VsdC5pc1RyYW5zY3JpcHRpb24pIHtcclxuICAgICAgICAgICAgICBjb25zdCB0cmFuc2NyaXB0aW9uRXJyb3IgPSBuZXcgRXJyb3IoY29udmVyc2lvbi5lcnJvciB8fCAnVHJhbnNjcmlwdGlvbiBmYWlsZWQnKTtcclxuICAgICAgICAgICAgICB0cmFuc2NyaXB0aW9uRXJyb3IuaXNUcmFuc2NyaXB0aW9uRXJyb3IgPSB0cnVlO1xyXG4gICAgICAgICAgICAgIHRocm93IHRyYW5zY3JpcHRpb25FcnJvcjtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoY29udmVyc2lvbi5lcnJvciB8fCAnQXN5bmMgY29udmVyc2lvbiBmYWlsZWQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBXYWl0IGJlZm9yZSBjaGVja2luZyBhZ2FpblxyXG4gICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDUwMCkpO1xyXG4gICAgICAgICAgYXR0ZW1wdHMrKztcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gSWYgd2UgZGlkbid0IGdldCBhIHJlc3VsdCBhZnRlciBhbGwgYXR0ZW1wdHMsIHRocm93IGFuIGVycm9yXHJcbiAgICAgICAgaWYgKCFmaW5hbFJlc3VsdCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBc3luYyBjb252ZXJzaW9uICR7Y29udmVyc2lvblJlc3VsdC5jb252ZXJzaW9uSWR9IHRpbWVkIG91dCBvciB3YXMgbm90IGZvdW5kYCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFVzZSB0aGUgZmluYWwgcmVzdWx0IGFzIHRoZSBjb250ZW50XHJcbiAgICAgICAgaWYgKCFmaW5hbFJlc3VsdCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdBc3luYyBjb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gVXBkYXRlIHRoZSBjb252ZXJzaW9uUmVzdWx0IHdpdGggdGhlIGZpbmFsIGNvbnRlbnRcclxuICAgICAgICBjb252ZXJzaW9uUmVzdWx0LmNvbnRlbnQgPSBmaW5hbFJlc3VsdDtcclxuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBVcGRhdGVkIGNvbnZlcnNpb25SZXN1bHQuY29udGVudCB3aXRoIGZpbmFsIHJlc3VsdCAobGVuZ3RoOiAke2ZpbmFsUmVzdWx0Lmxlbmd0aH0pYCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gRm9yIHN5bmNocm9ub3VzIGNvbnZlcnNpb25zLCBleHRyYWN0IGNvbnRlbnQgZnJvbSByZXN1bHRcclxuICAgICAgICBjb25zdCBjb250ZW50ID0gY29udmVyc2lvblJlc3VsdC5jb250ZW50IHx8ICcnO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghY29udGVudCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb252ZXJzaW9uIHByb2R1Y2VkIGVtcHR5IGNvbnRlbnQnKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFVzZSBjYXRlZ29yeSBmcm9tIGZyb250ZW5kIGlmIGF2YWlsYWJsZVxyXG4gICAgICAvLyBGb3IgVVJMIGNvbnZlcnNpb25zLCBkZWZhdWx0IHRvICd3ZWInIGNhdGVnb3J5XHJcbiAgICAgIGNvbnN0IGZpbGVDYXRlZ29yeSA9IG9wdGlvbnMuY2F0ZWdvcnkgfHwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICBjb252ZXJzaW9uUmVzdWx0LmNhdGVnb3J5IHx8IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgKG9wdGlvbnMudHlwZSA9PT0gJ3VybCcgfHwgb3B0aW9ucy50eXBlID09PSAncGFyZW50dXJsJyA/ICd3ZWInIDogJ3RleHQnKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGlmIHRoZSBjb252ZXJzaW9uIHJlc3VsdCBoYXMgbXVsdGlwbGUgZmlsZXMgKGZvciBwYXJlbnR1cmwgc2VwYXJhdGUgbW9kZSlcclxuICAgICAgY29uc3QgaGFzTXVsdGlwbGVGaWxlcyA9IEFycmF5LmlzQXJyYXkoY29udmVyc2lvblJlc3VsdC5maWxlcykgJiYgY29udmVyc2lvblJlc3VsdC5maWxlcy5sZW5ndGggPiAwO1xyXG4gICAgICBjb25zdCBpc011bHRpcGxlRmlsZXNSZXN1bHQgPSBjb252ZXJzaW9uUmVzdWx0LnR5cGUgPT09ICdtdWx0aXBsZV9maWxlcyc7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoaGFzTXVsdGlwbGVGaWxlcykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OBIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBDb252ZXJzaW9uIHJlc3VsdCBoYXMgJHtjb252ZXJzaW9uUmVzdWx0LmZpbGVzLmxlbmd0aH0gZmlsZXNgKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgaWYgKGlzTXVsdGlwbGVGaWxlc1Jlc3VsdCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OBIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBNdWx0aXBsZSBmaWxlcyByZXN1bHQ6ICR7Y29udmVyc2lvblJlc3VsdC50b3RhbEZpbGVzfSBmaWxlcyBpbiAke2NvbnZlcnNpb25SZXN1bHQub3V0cHV0RGlyZWN0b3J5fWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEZvciBtdWx0aXBsZSBmaWxlcyByZXN1bHQsIHJldHVybiB0aGUgZGlyZWN0b3J5IGluZm9ybWF0aW9uIGRpcmVjdGx5XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICBvdXRwdXRQYXRoOiBjb252ZXJzaW9uUmVzdWx0Lm91dHB1dERpcmVjdG9yeSxcclxuICAgICAgICAgIGluZGV4RmlsZTogY29udmVyc2lvblJlc3VsdC5pbmRleEZpbGUsXHJcbiAgICAgICAgICBmaWxlczogY29udmVyc2lvblJlc3VsdC5maWxlcyxcclxuICAgICAgICAgIHRvdGFsRmlsZXM6IGNvbnZlcnNpb25SZXN1bHQudG90YWxGaWxlcyxcclxuICAgICAgICAgIHN1bW1hcnk6IGNvbnZlcnNpb25SZXN1bHQuc3VtbWFyeSxcclxuICAgICAgICAgIHR5cGU6ICdtdWx0aXBsZV9maWxlcydcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBTYXZlIHRoZSBjb252ZXJzaW9uIHJlc3VsdCB1c2luZyB0aGUgQ29udmVyc2lvblJlc3VsdE1hbmFnZXJcclxuICAgICAgLy8gRW5zdXJlIHdlJ3JlIGNvbnNpc3RlbnRseSB1c2luZyB0aGUgb3JpZ2luYWwgZmlsZW5hbWVcclxuICAgICAgLy8gUHJpb3JpdHk6IGNvbnZlcnRlcidzIG1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUgPiBjb252ZXJzaW9uUmVzdWx0IGZpZWxkcyA+IG9wdGlvbnMgZmllbGRzXHJcbiAgICAgIGNvbnN0IG9yaWdpbmFsRmlsZU5hbWUgPSAoY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSAmJiBjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUpIHx8XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25SZXN1bHQub3JpZ2luYWxGaWxlTmFtZSB8fFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb252ZXJzaW9uUmVzdWx0Lm5hbWUgfHxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnMubmFtZTtcclxuXHJcbiAgICAgIC8vIEFkZCBlbmhhbmNlZCBsb2dnaW5nIGZvciBYTFNYL0NTViBmaWxlcyB0byB0cmFjayBmaWxlbmFtZSBoYW5kbGluZ1xyXG4gICAgICBpZiAoZmlsZVR5cGUgPT09ICd4bHN4JyB8fCBmaWxlVHlwZSA9PT0gJ2NzdicpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+TiiBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gRXhjZWwvQ1NWIG9yaWdpbmFsRmlsZU5hbWUgcmVzb2x1dGlvbjpgLCB7XHJcbiAgICAgICAgICBmcm9tTWV0YWRhdGE6IGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEgJiYgY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICAgICAgZnJvbVJlc3VsdDogY29udmVyc2lvblJlc3VsdC5vcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICAgICAgZnJvbVJlc3VsdE5hbWU6IGNvbnZlcnNpb25SZXN1bHQubmFtZSxcclxuICAgICAgICAgIGZyb21PcHRpb25zOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgICAgICBmcm9tT3B0aW9uc05hbWU6IG9wdGlvbnMubmFtZSxcclxuICAgICAgICAgIHJlc29sdmVkOiBvcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICAgICAgbWV0YWRhdGFLZXlzOiBjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhID8gT2JqZWN0LmtleXMoY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSkgOiBbXSxcclxuICAgICAgICAgIHJlc3VsdEtleXM6IE9iamVjdC5rZXlzKGNvbnZlcnNpb25SZXN1bHQpXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OmIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBVc2luZyBmaWxlbmFtZSBmb3IgcmVzdWx0OiAke29yaWdpbmFsRmlsZU5hbWV9YCk7XHJcblxyXG4gICAgICAvLyBMb2cgbWV0YWRhdGEgZnJvbSB0aGUgY29udmVyc2lvbiByZXN1bHQgZm9yIGRlYnVnZ2luZ1xyXG4gICAgICBpZiAoY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5SNIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBDb252ZXJzaW9uIHJlc3VsdCBtZXRhZGF0YTpgLCB7XHJcbiAgICAgICAgICBrZXlzOiBPYmplY3Qua2V5cyhjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhKSxcclxuICAgICAgICAgIGhhc09yaWdpbmFsRmlsZU5hbWU6ICdvcmlnaW5hbEZpbGVOYW1lJyBpbiBjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhLFxyXG4gICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIEZvciBYTFNYIGFuZCBDU1YgZmlsZXMsIHNwZWNpZmljYWxseSBlbnN1cmUgdGhlIG1ldGFkYXRhIGNvbnRhaW5zIHRoZSBvcmlnaW5hbEZpbGVOYW1lXHJcbiAgICAgIGxldCBlbmhhbmNlZE1ldGFkYXRhID0ge1xyXG4gICAgICAgIC4uLihjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhIHx8IHt9KSxcclxuICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcmlnaW5hbEZpbGVOYW1lIC8vIEVuc3VyZSBvcmlnaW5hbCBmaWxlbmFtZSBpcyBpbiBtZXRhZGF0YVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgLy8gRm9yIFhMU1gvQ1NWIGZpbGVzLCBkb3VibGUtY2hlY2sgdGhlIG1ldGFkYXRhIHN0cnVjdHVyZVxyXG4gICAgICBpZiAoZmlsZVR5cGUgPT09ICd4bHN4JyB8fCBmaWxlVHlwZSA9PT0gJ2NzdicpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+TiiBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gRW5oYW5jZWQgbWV0YWRhdGEgZm9yICR7ZmlsZVR5cGV9OmAsIGVuaGFuY2VkTWV0YWRhdGEpO1xyXG5cclxuICAgICAgICAvLyBMb2cgYWRkaXRpb25hbCBkZWJ1Z2dpbmcgaW5mb1xyXG4gICAgICAgIGlmICghZW5oYW5jZWRNZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lKSB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gb3JpZ2luYWxGaWxlTmFtZSBtaXNzaW5nIGluIG1ldGFkYXRhIGV2ZW4gYWZ0ZXIgc2V0dGluZyBpdCFgKTtcclxuICAgICAgICAgIC8vIEZvcmNlIHNldCBpdCBhcyBhIGxhc3QgcmVzb3J0XHJcbiAgICAgICAgICBlbmhhbmNlZE1ldGFkYXRhID0geyAuLi5lbmhhbmNlZE1ldGFkYXRhLCBvcmlnaW5hbEZpbGVOYW1lIH07XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJlc3VsdE1hbmFnZXIuc2F2ZUNvbnZlcnNpb25SZXN1bHQoe1xyXG4gICAgICAgIGNvbnRlbnQ6IGNvbnZlcnNpb25SZXN1bHQuY29udGVudCwgLy8gVXNlIGNvbnZlcnNpb25SZXN1bHQuY29udGVudCBkaXJlY3RseVxyXG4gICAgICAgIG1ldGFkYXRhOiBlbmhhbmNlZE1ldGFkYXRhLCAvLyBVc2Ugb3VyIGVuaGFuY2VkIG1ldGFkYXRhXHJcbiAgICAgICAgaW1hZ2VzOiBjb252ZXJzaW9uUmVzdWx0LmltYWdlcyB8fCBbXSxcclxuICAgICAgICBmaWxlczogY29udmVyc2lvblJlc3VsdC5maWxlcyxcclxuICAgICAgICBuYW1lOiBvcmlnaW5hbEZpbGVOYW1lLCAvLyBVc2UgdGhlIG9yaWdpbmFsIGZpbGVuYW1lIGNvbnNpc3RlbnRseVxyXG4gICAgICAgIHR5cGU6IGNvbnZlcnNpb25SZXN1bHQudHlwZSB8fCBmaWxlVHlwZSxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUsIC8vIEFsd2F5cyB1c2UgdGhlIGZpbGVUeXBlIGZyb20gZnJvbnRlbmRcclxuICAgICAgICBvdXRwdXREaXI6IG9wdGlvbnMub3V0cHV0RGlyLFxyXG4gICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcmlnaW5hbEZpbGVOYW1lLCAvLyBBZGQgaXQgdG8gb3B0aW9ucyB0b29cclxuICAgICAgICAgIGNhdGVnb3J5OiBmaWxlQ2F0ZWdvcnksXHJcbiAgICAgICAgICBwYWdlQ291bnQ6IGNvbnZlcnNpb25SZXN1bHQucGFnZUNvdW50LFxyXG4gICAgICAgICAgc2xpZGVDb3VudDogY29udmVyc2lvblJlc3VsdC5zbGlkZUNvdW50LFxyXG4gICAgICAgICAgaGFzTXVsdGlwbGVGaWxlc1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhg4pyFIEZpbGUgY29udmVyc2lvbiBjb21wbGV0ZWQgaW4gJHtEYXRlLm5vdygpIC0gc3RhcnRUaW1lfW1zOmAsIHtcclxuICAgICAgICBmaWxlOiBmaWxlUGF0aCxcclxuICAgICAgICBvdXRwdXRQYXRoOiByZXN1bHQub3V0cHV0UGF0aFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIEVuZCB0aW1lciBmb3Igc3VjY2Vzc2Z1bCBjb252ZXJzaW9uXHJcbiAgICAgIGNvbnNvbGUudGltZUVuZCh0aW1lTGFiZWwpO1xyXG5cclxuICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLnRpbWVFbmQodGltZUxhYmVsKTtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBDb252ZXJzaW9uIGVycm9yIGNhdWdodCBpbiBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmNvbnZlcnQnKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEFsd2F5cyBpbmNsdWRlIGZpbGVUeXBlIGluIGVycm9yIHJlc3VsdHNcclxuICAgICAgY29uc3QgZmlsZVR5cGUgPSBvcHRpb25zLmZpbGVUeXBlIHx8ICd1bmtub3duJztcclxuICAgICAgXHJcbiAgICAgIC8vIERldGFpbGVkIGVycm9yIGxvZ2dpbmdcclxuICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIEVycm9yIGRldGFpbHM6Jywge1xyXG4gICAgICAgIG5hbWU6IGVycm9yLm5hbWUsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcclxuICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXHJcbiAgICAgICAgY29kZTogZXJyb3IuY29kZSxcclxuICAgICAgICB0eXBlOiB0eXBlb2YgZXJyb3JcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBjb252ZXJ0ZXIgcmVnaXN0cnkgc3RhdGVcclxuICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIENvbnZlcnRlciByZWdpc3RyeSBzdGF0ZSBhdCBlcnJvciB0aW1lOicsIHtcclxuICAgICAgICBjb252ZXJ0ZXJSZWdpc3RyeUxvYWRlZDogISFnbG9iYWwuY29udmVydGVyUmVnaXN0cnksXHJcbiAgICAgICAgaGFzQ29udmVydGVyczogISEoZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5ICYmIGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzKSxcclxuICAgICAgICBhdmFpbGFibGVDb252ZXJ0ZXJzOiBnbG9iYWwuY29udmVydGVyUmVnaXN0cnkgJiYgZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5LmNvbnZlcnRlcnMgPyBcclxuICAgICAgICAgIE9iamVjdC5rZXlzKGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzKSA6ICdub25lJyxcclxuICAgICAgICB1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZDogISF1bmlmaWVkQ29udmVydGVyRmFjdG9yeSxcclxuICAgICAgICBoYXNDb252ZXJ0RmlsZTogdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPyB0eXBlb2YgdW5pZmllZENvbnZlcnRlckZhY3RvcnkuY29udmVydEZpbGUgPT09ICdmdW5jdGlvbicgOiBmYWxzZVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGVycm9ySW5mbyA9IHtcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUsIC8vIEFsd2F5cyBpbmNsdWRlIGZpbGVUeXBlXHJcbiAgICAgICAgdHlwZTogb3B0aW9ucy50eXBlLFxyXG4gICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICBpc0J1ZmZlcjogQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSxcclxuICAgICAgICBidWZmZXJMZW5ndGg6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCkgPyBmaWxlUGF0aC5sZW5ndGggOiB1bmRlZmluZWQsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxyXG4gICAgICAgIGNvbnZlcnRlcnNMb2FkZWQ6ICEhZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5IC8vIENoZWNrIGlmIGNvbnZlcnRlcnMgd2VyZSBsb2FkZWRcclxuICAgICAgfTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gQ29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3JJbmZvKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENvbnN0cnVjdCBhIHVzZXItZnJpZW5kbHkgZXJyb3IgbWVzc2FnZVxyXG4gICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpIFxyXG4gICAgICAgID8gYEZhaWxlZCB0byBjb252ZXJ0ICR7b3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8ICdmaWxlJ306ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgICAgOiBgRmFpbGVkIHRvIGNvbnZlcnQgJHtmaWxlUGF0aH06ICR7ZXJyb3IubWVzc2FnZX1gO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICAgIGRldGFpbHM6IGVycm9ySW5mbyxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUgLy8gRXhwbGljaXRseSBpbmNsdWRlIGZpbGVUeXBlIGluIGVycm9yIHJlc3VsdFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2V0cyB1cCB0aGUgb3V0cHV0IGRpcmVjdG9yeSBmb3IgY29udmVyc2lvbnNcclxuICAgKi9cclxuICBhc3luYyBzZXR1cE91dHB1dERpcmVjdG9yeShvdXRwdXREaXIpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGRpclRvU2V0dXAgPSBvdXRwdXREaXIgfHwgdGhpcy5kZWZhdWx0T3V0cHV0RGlyO1xyXG4gICAgICBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0uY3JlYXRlRGlyZWN0b3J5KGRpclRvU2V0dXApO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+TgSBPdXRwdXQgZGlyZWN0b3J5IHJlYWR5OicsIGRpclRvU2V0dXApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBzZXQgdXAgb3V0cHV0IGRpcmVjdG9yeTonLCBlcnJvcik7XHJcbiAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBuZXcgRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZSgpO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU07RUFBRUM7QUFBSSxDQUFDLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDbkMsTUFBTTtFQUFFRTtBQUFVLENBQUMsR0FBR0YsT0FBTyxDQUFDLGdCQUFnQixDQUFDO0FBQy9DLE1BQU07RUFBRUc7QUFBVSxDQUFDLEdBQUdILE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDckMsTUFBTUksRUFBRSxHQUFHSixPQUFPLENBQUMsSUFBSSxDQUFDO0FBQ3hCLE1BQU1LLGFBQWEsR0FBR0YsU0FBUyxDQUFDQyxFQUFFLENBQUNFLFFBQVEsQ0FBQztBQUM1QyxNQUFNO0VBQUVDLFFBQVEsRUFBRUM7QUFBa0IsQ0FBQyxHQUFHUixPQUFPLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDO0FB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