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
        // Increase timeout for parent URL conversions which can take longer
        const maxAttempts = conversionResult.type === 'parenturl' ? 240 : 60; // 120s for parenturl, 30s for others

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsIlBhdGhVdGlscyIsInByb21pc2lmeSIsImZzIiwicmVhZEZpbGVBc3luYyIsInJlYWRGaWxlIiwiaW5zdGFuY2UiLCJGaWxlU3lzdGVtU2VydmljZSIsIkNvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIiwiZ2V0RmlsZVR5cGUiLCJnZXRGaWxlSGFuZGxpbmdJbmZvIiwiSEFORExJTkdfVFlQRVMiLCJDT05WRVJURVJfQ09ORklHIiwiUHJvZ3Jlc3NUcmFja2VyIiwiY29udmVydFRvTWFya2Rvd24iLCJyZWdpc3RlckNvbnZlcnRlciIsInJlZ2lzdGVyQ29udmVydGVyRmFjdG9yeSIsImNvbnNvbGUiLCJsb2ciLCJoYW5kbGluZ1R5cGVzIiwiZmlsZUNvbmZpZyIsIk1vZHVsZVJlc29sdmVyIiwidW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJpbml0aWFsaXplIiwiY2F0Y2giLCJlcnJvciIsImdldENvbnZlcnRlclJlZ2lzdHJ5UGF0aCIsInJlc29sdmVNb2R1bGVQYXRoIiwidGltZSIsImNvbnZlcnRlclJlZ2lzdHJ5UGF0aCIsImVudmlyb25tZW50IiwicHJvY2VzcyIsImVudiIsIk5PREVfRU5WIiwiYXBwUGF0aCIsImdldEFwcFBhdGgiLCJjdXJyZW50RGlyIiwiX19kaXJuYW1lIiwiaXNQYWNrYWdlZCIsImZpbGVFeGlzdHMiLCJleGlzdHNTeW5jIiwiZGlybmFtZSIsInJlYWRkaXJTeW5jIiwic2VydmljZXMiLCJqb2luIiwiY29udmVyc2lvbiIsImRhdGEiLCJjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSIsInNhZmVSZXF1aXJlIiwia2V5cyIsIk9iamVjdCIsImhhc0NvbnZlcnRlclJlZ2lzdHJ5IiwiaGFzRGVmYXVsdEV4cG9ydCIsImV4cG9ydFR5cGVzIiwiZW50cmllcyIsIm1hcCIsImtleSIsInZhbHVlIiwibmFtZSIsIm1lc3NhZ2UiLCJzdGFjayIsImNvZGUiLCJkaXJlY3RFcnJvciIsIkVycm9yIiwiY29udmVydGVyUmVnaXN0cnkiLCJDb252ZXJ0ZXJSZWdpc3RyeSIsImRlZmF1bHQiLCJoYXNDb252ZXJ0ZXJzIiwiY29udmVydGVycyIsImhhc0NvbnZlcnRUb01hcmtkb3duIiwiaGFzR2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJnZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiIsImhhc0dldENvbnZlcnRlckJ5TWltZVR5cGUiLCJnZXRDb252ZXJ0ZXJCeU1pbWVUeXBlIiwiYXZhaWxhYmxlQ29udmVydGVycyIsInRpbWVFbmQiLCJnbG9iYWwiLCJ0eXBlIiwiaGFzU3RhY2siLCJFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJmaWxlU3lzdGVtIiwicmVzdWx0TWFuYWdlciIsInByb2dyZXNzVXBkYXRlSW50ZXJ2YWwiLCJkZWZhdWx0T3V0cHV0RGlyIiwiZ2V0UGF0aCIsImNvbnZlcnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJ0aW1lTGFiZWwiLCJEYXRlIiwibm93IiwidHJhY2UiLCJzdGFydFRpbWUiLCJvdXRwdXREaXIiLCJpbnB1dFR5cGUiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImlucHV0TGVuZ3RoIiwibGVuZ3RoIiwidW5kZWZpbmVkIiwiZmlsZVR5cGUiLCJoYXNCdWZmZXJJbk9wdGlvbnMiLCJidWZmZXIiLCJidWZmZXJMZW5ndGgiLCJhcGlLZXkiLCJtaXN0cmFsQXBpS2V5IiwiY29udmVydGVyUmVnaXN0cnlMb2FkZWQiLCJ1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZCIsImhhc0NvbnZlcnRGaWxlIiwiY29udmVydEZpbGUiLCJwcm9ncmVzc1RyYWNrZXIiLCJvblByb2dyZXNzIiwiaXNUZW1wb3JhcnkiLCJpc1VybCIsImlzUGFyZW50VXJsIiwiY29udmVyc2lvblJlc3VsdCIsInN1Y2Nlc3MiLCJhc3luYyIsImNvbnZlcnNpb25JZCIsImZpbmFsUmVzdWx0IiwiYXR0ZW1wdHMiLCJtYXhBdHRlbXB0cyIsImdldENvbnZlcnNpb24iLCJ3YXJuIiwic3RhdHVzIiwicmVzdWx0IiwicGluZ0NvbnZlcnNpb24iLCJyZXRyaWV2ZWQiLCJpc1RyYW5zY3JpcHRpb24iLCJ0cmFuc2NyaXB0aW9uRXJyb3IiLCJpc1RyYW5zY3JpcHRpb25FcnJvciIsIlByb21pc2UiLCJyZXNvbHZlIiwic2V0VGltZW91dCIsImNvbnRlbnQiLCJmaWxlQ2F0ZWdvcnkiLCJjYXRlZ29yeSIsImhhc011bHRpcGxlRmlsZXMiLCJBcnJheSIsImlzQXJyYXkiLCJmaWxlcyIsImlzTXVsdGlwbGVGaWxlc1Jlc3VsdCIsInRvdGFsRmlsZXMiLCJvdXRwdXREaXJlY3RvcnkiLCJvdXRwdXRQYXRoIiwiaW5kZXhGaWxlIiwic3VtbWFyeSIsIm9yaWdpbmFsRmlsZU5hbWUiLCJtZXRhZGF0YSIsImZyb21NZXRhZGF0YSIsImZyb21SZXN1bHQiLCJmcm9tUmVzdWx0TmFtZSIsImZyb21PcHRpb25zIiwiZnJvbU9wdGlvbnNOYW1lIiwicmVzb2x2ZWQiLCJtZXRhZGF0YUtleXMiLCJyZXN1bHRLZXlzIiwiaGFzT3JpZ2luYWxGaWxlTmFtZSIsImVuaGFuY2VkTWV0YWRhdGEiLCJzYXZlQ29udmVyc2lvblJlc3VsdCIsImltYWdlcyIsInBhZ2VDb3VudCIsInNsaWRlQ291bnQiLCJmaWxlIiwiZXJyb3JJbmZvIiwiY29udmVydGVyc0xvYWRlZCIsImVycm9yTWVzc2FnZSIsImRldGFpbHMiLCJzZXR1cE91dHB1dERpcmVjdG9yeSIsImRpclRvU2V0dXAiLCJjcmVhdGVEaXJlY3RvcnkiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanNcclxuICogSGFuZGxlcyBkb2N1bWVudCBjb252ZXJzaW9uIHVzaW5nIG5hdGl2ZSBmaWxlIHN5c3RlbSBvcGVyYXRpb25zIGluIEVsZWN0cm9uLlxyXG4gKiBDb29yZGluYXRlcyBjb252ZXJzaW9uIHByb2Nlc3NlcyBhbmQgZGVsZWdhdGVzIHRvIHRoZSBzaGFyZWQgY29udmVyc2lvbiB1dGlsaXRpZXMuXHJcbiAqXHJcbiAqIElNUE9SVEFOVDogV2hlbiBkZXRlcm1pbmluZyBmaWxlIHR5cGVzIGZvciBjb252ZXJzaW9uLCB3ZSBleHRyYWN0IHRoZSBmaWxlIGV4dGVuc2lvblxyXG4gKiBkaXJlY3RseSByYXRoZXIgdGhhbiB1c2luZyB0aGUgY2F0ZWdvcnkgZnJvbSBnZXRGaWxlVHlwZS4gVGhpcyBlbnN1cmVzIHRoYXQgd2UgdXNlXHJcbiAqIHRoZSBzcGVjaWZpYyBjb252ZXJ0ZXIgcmVnaXN0ZXJlZCBmb3IgZWFjaCBmaWxlIHR5cGUgKGUuZy4sICdwZGYnLCAnZG9jeCcsICdwcHR4JylcclxuICogcmF0aGVyIHRoYW4gdHJ5aW5nIHRvIHVzZSBhIGNvbnZlcnRlciBmb3IgdGhlIGNhdGVnb3J5ICgnZG9jdW1lbnRzJykuXHJcbiAqXHJcbiAqIFNwZWNpYWwgaGFuZGxpbmcgaXMgaW1wbGVtZW50ZWQgZm9yIGRhdGEgZmlsZXMgKENTViwgWExTWCkgdG8gZW5zdXJlIHRoZXkgdXNlIHRoZVxyXG4gKiBjb3JyZWN0IGNvbnZlcnRlciBiYXNlZCBvbiBmaWxlIGV4dGVuc2lvbi4gSWYgdGhlIGV4dGVuc2lvbiBjYW4ndCBiZSBkZXRlcm1pbmVkLFxyXG4gKiB3ZSBkZWZhdWx0IHRvICdjc3YnIHJhdGhlciB0aGFuIHVzaW5nIHRoZSBjYXRlZ29yeSAnZGF0YScuXHJcbiAqXHJcbiAqIEZvciBDU1YgZmlsZXMgc2VudCBhcyB0ZXh0IGNvbnRlbnQsIHdlIGRldGVjdCBDU1YgY29udGVudCBieSBjaGVja2luZyBmb3IgY29tbWFzLCB0YWJzLFxyXG4gKiBhbmQgbmV3bGluZXMsIGFuZCBwcm9jZXNzIGl0IGRpcmVjdGx5IHJhdGhlciB0aGFuIHRyZWF0aW5nIGl0IGFzIGEgZmlsZSBwYXRoLiBUaGlzIGZpeGVzXHJcbiAqIHRoZSBcIkZpbGUgbm90IGZvdW5kIG9yIGluYWNjZXNzaWJsZVwiIGVycm9yIHRoYXQgb2NjdXJyZWQgd2hlbiB0aGUgc3lzdGVtIHRyaWVkIHRvIGludGVycHJldFxyXG4gKiBDU1YgY29udGVudCBhcyBhIGZpbGUgcGF0aC5cclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgeyBQYXRoVXRpbHMgfSA9IHJlcXVpcmUoJy4uL3V0aWxzL3BhdGhzJyk7XHJcbmNvbnN0IHsgcHJvbWlzaWZ5IH0gPSByZXF1aXJlKCd1dGlsJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcclxuY29uc3QgcmVhZEZpbGVBc3luYyA9IHByb21pc2lmeShmcy5yZWFkRmlsZSk7XHJcbmNvbnN0IHsgaW5zdGFuY2U6IEZpbGVTeXN0ZW1TZXJ2aWNlIH0gPSByZXF1aXJlKCcuL0ZpbGVTeXN0ZW1TZXJ2aWNlJyk7IC8vIEltcG9ydCBpbnN0YW5jZVxyXG5jb25zdCBDb252ZXJzaW9uUmVzdWx0TWFuYWdlciA9IHJlcXVpcmUoJy4vQ29udmVyc2lvblJlc3VsdE1hbmFnZXInKTtcclxuLy8gSW1wb3J0IGxvY2FsIHV0aWxpdGllc1xyXG5jb25zdCB7IFxyXG4gIGdldEZpbGVUeXBlLFxyXG4gIGdldEZpbGVIYW5kbGluZ0luZm8sXHJcbiAgSEFORExJTkdfVFlQRVMsXHJcbiAgQ09OVkVSVEVSX0NPTkZJR1xyXG59ID0gcmVxdWlyZSgnLi4vdXRpbHMvZmlsZXMnKTtcclxuY29uc3QgeyBcclxuICBQcm9ncmVzc1RyYWNrZXIsIFxyXG4gIGNvbnZlcnRUb01hcmtkb3duLCBcclxuICByZWdpc3RlckNvbnZlcnRlcixcclxuICByZWdpc3RlckNvbnZlcnRlckZhY3RvcnlcclxufSA9IHJlcXVpcmUoJy4uL3V0aWxzL2NvbnZlcnNpb24nKTtcclxuXHJcbi8vIExvZyBhdmFpbGFibGUgZmlsZSBoYW5kbGluZyBjYXBhYmlsaXRpZXNcclxuY29uc29sZS5sb2coJ/Cfk4QgSW5pdGlhbGl6ZWQgd2l0aCBmaWxlIGhhbmRsaW5nOicsIHtcclxuICBoYW5kbGluZ1R5cGVzOiBIQU5ETElOR19UWVBFUyxcclxuICBmaWxlQ29uZmlnOiBDT05WRVJURVJfQ09ORklHXHJcbn0pO1xyXG5cclxuLy8gSW1wb3J0IE1vZHVsZVJlc29sdmVyIGFuZCBVbmlmaWVkQ29udmVydGVyRmFjdG9yeVxyXG5jb25zdCB7IE1vZHVsZVJlc29sdmVyIH0gPSByZXF1aXJlKCcuLi91dGlscy9tb2R1bGVSZXNvbHZlcicpO1xyXG5jb25zdCB1bmlmaWVkQ29udmVydGVyRmFjdG9yeSA9IHJlcXVpcmUoJy4uL2NvbnZlcnRlcnMvVW5pZmllZENvbnZlcnRlckZhY3RvcnknKTtcclxuXHJcbi8vIEluaXRpYWxpemUgdGhlIGNvbnZlcnRlciBmYWN0b3J5XHJcbnVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmluaXRpYWxpemUoKS5jYXRjaChlcnJvciA9PiB7XHJcbiAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBpbml0aWFsaXplIGNvbnZlcnRlciBmYWN0b3J5OicsIGVycm9yKTtcclxufSk7XHJcblxyXG4vLyBGdW5jdGlvbiB0byBnZXQgY29ycmVjdCBjb252ZXJ0ZXIgcmVnaXN0cnkgcGF0aCB1c2luZyBNb2R1bGVSZXNvbHZlclxyXG5jb25zdCBnZXRDb252ZXJ0ZXJSZWdpc3RyeVBhdGggPSAoKSA9PiB7XHJcbiAgY29uc29sZS5sb2coJ/Cfk4IgR2V0dGluZyBjb252ZXJ0ZXIgcmVnaXN0cnkgcGF0aCB1c2luZyBNb2R1bGVSZXNvbHZlcicpO1xyXG4gIHJldHVybiBNb2R1bGVSZXNvbHZlci5yZXNvbHZlTW9kdWxlUGF0aCgnQ29udmVydGVyUmVnaXN0cnkuanMnLCAnc2VydmljZXMvY29udmVyc2lvbicpO1xyXG59O1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBjb252ZXJ0ZXJzIHVzaW5nIE1vZHVsZVJlc29sdmVyXHJcbihmdW5jdGlvbigpIHtcclxuICB0cnkge1xyXG4gICAgY29uc29sZS5sb2coJ/CflIQgW1ZFUkJPU0VdIFN0YXJ0aW5nIGNvbnZlcnRlcnMgaW5pdGlhbGl6YXRpb24nKTtcclxuICAgIGNvbnNvbGUudGltZSgn8J+VkiBbVkVSQk9TRV0gQ29udmVydGVycyBpbml0aWFsaXphdGlvbiB0aW1lJyk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBVc2luZyBNb2R1bGVSZXNvbHZlciB0byBmaW5kIENvbnZlcnRlclJlZ2lzdHJ5LmpzJyk7XHJcbiAgICBjb25zdCBjb252ZXJ0ZXJSZWdpc3RyeVBhdGggPSBnZXRDb252ZXJ0ZXJSZWdpc3RyeVBhdGgoKTtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBMb2FkaW5nIGNvbnZlcnRlciByZWdpc3RyeSBmcm9tIHBhdGg6JywgY29udmVydGVyUmVnaXN0cnlQYXRoKTtcclxuICAgIFxyXG4gICAgLy8gTG9nIGVudmlyb25tZW50IGRldGFpbHNcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBFbnZpcm9ubWVudCBkZXRhaWxzOicsIHtcclxuICAgICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICd1bmtub3duJyxcclxuICAgICAgYXBwUGF0aDogYXBwLmdldEFwcFBhdGgoKSxcclxuICAgICAgY3VycmVudERpcjogX19kaXJuYW1lLFxyXG4gICAgICBpc1BhY2thZ2VkOiBhcHAuaXNQYWNrYWdlZFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIENoZWNrIGlmIHRoZSBmaWxlIGV4aXN0c1xyXG4gICAgY29uc3QgZmlsZUV4aXN0cyA9IGZzLmV4aXN0c1N5bmMoY29udmVydGVyUmVnaXN0cnlQYXRoKTtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBSZWdpc3RyeSBmaWxlIGV4aXN0cyBjaGVjazonLCBmaWxlRXhpc3RzKTtcclxuICAgIFxyXG4gICAgaWYgKCFmaWxlRXhpc3RzKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gUmVnaXN0cnkgZmlsZSBkb2VzIG5vdCBleGlzdCBhdCBwYXRoOicsIGNvbnZlcnRlclJlZ2lzdHJ5UGF0aCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5OCIFtWRVJCT1NFXSBEaXJlY3RvcnkgY29udGVudHM6Jywge1xyXG4gICAgICAgIGRpcm5hbWU6IGZzLmV4aXN0c1N5bmMoX19kaXJuYW1lKSA/IGZzLnJlYWRkaXJTeW5jKF9fZGlybmFtZSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgYXBwUGF0aDogZnMuZXhpc3RzU3luYyhhcHAuZ2V0QXBwUGF0aCgpKSA/IGZzLnJlYWRkaXJTeW5jKGFwcC5nZXRBcHBQYXRoKCkpIDogJ2RpcmVjdG9yeSBub3QgZm91bmQnLFxyXG4gICAgICAgIHNlcnZpY2VzOiBmcy5leGlzdHNTeW5jKHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicpKSA/XHJcbiAgICAgICAgICBmcy5yZWFkZGlyU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nKSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgY29udmVyc2lvbjogZnMuZXhpc3RzU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnY29udmVyc2lvbicpKSA/XHJcbiAgICAgICAgICBmcy5yZWFkZGlyU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnY29udmVyc2lvbicpKSA6ICdkaXJlY3Rvcnkgbm90IGZvdW5kJyxcclxuICAgICAgICBkYXRhOiBmcy5leGlzdHNTeW5jKHBhdGguam9pbihfX2Rpcm5hbWUsICdjb252ZXJzaW9uL2RhdGEnKSkgP1xyXG4gICAgICAgICAgZnMucmVhZGRpclN5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJ2NvbnZlcnNpb24vZGF0YScpKSA6ICdkaXJlY3Rvcnkgbm90IGZvdW5kJ1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gVXNlIE1vZHVsZVJlc29sdmVyIHRvIHNhZmVseSByZXF1aXJlIHRoZSBjb252ZXJ0ZXIgcmVnaXN0cnlcclxuICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBVc2luZyBNb2R1bGVSZXNvbHZlci5zYWZlUmVxdWlyZSBmb3IgQ29udmVydGVyUmVnaXN0cnknKTtcclxuICAgIFxyXG4gICAgbGV0IGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlO1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVXNlIG91ciBNb2R1bGVSZXNvbHZlciB0byBsb2FkIHRoZSBtb2R1bGVcclxuICAgICAgY29udmVydGVyUmVnaXN0cnlNb2R1bGUgPSBNb2R1bGVSZXNvbHZlci5zYWZlUmVxdWlyZSgnQ29udmVydGVyUmVnaXN0cnkuanMnLCAnc2VydmljZXMvY29udmVyc2lvbicpO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+TpiBbVkVSQk9TRV0gTW9kdWxlUmVzb2x2ZXIgc3VjY2Vzc2Z1bC4gTW9kdWxlIHN0cnVjdHVyZTonLCB7XHJcbiAgICAgICAga2V5czogT2JqZWN0LmtleXMoY29udmVydGVyUmVnaXN0cnlNb2R1bGUpLFxyXG4gICAgICAgIGhhc0NvbnZlcnRlclJlZ2lzdHJ5OiAnQ29udmVydGVyUmVnaXN0cnknIGluIGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlLFxyXG4gICAgICAgIGhhc0RlZmF1bHRFeHBvcnQ6ICdkZWZhdWx0JyBpbiBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSxcclxuICAgICAgICBleHBvcnRUeXBlczogT2JqZWN0LmVudHJpZXMoY29udmVydGVyUmVnaXN0cnlNb2R1bGUpLm1hcCgoW2tleSwgdmFsdWVdKSA9PlxyXG4gICAgICAgICAgYCR7a2V5fTogJHt0eXBlb2YgdmFsdWV9JHt2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnID8gYCB3aXRoIGtleXMgWyR7T2JqZWN0LmtleXModmFsdWUpLmpvaW4oJywgJyl9XWAgOiAnJ31gXHJcbiAgICAgICAgKVxyXG4gICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gTW9kdWxlIGxvYWRpbmcgZmFpbGVkIHdpdGggZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gRXJyb3IgZGV0YWlsczonLCB7XHJcbiAgICAgICAgbmFtZTogZXJyb3IubmFtZSxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcclxuICAgICAgICBjb2RlOiBlcnJvci5jb2RlLFxyXG4gICAgICAgIHBhdGg6IGNvbnZlcnRlclJlZ2lzdHJ5UGF0aFxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIFRyeSBmYWxsYmFjayB0byBkaXJlY3QgcmVxdWlyZSBhcyBhIGxhc3QgcmVzb3J0XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ/CflIQgW1ZFUkJPU0VdIFRyeWluZyBkaXJlY3QgcmVxdWlyZSBhcyBmYWxsYmFjaycpO1xyXG4gICAgICAgIGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlID0gcmVxdWlyZShjb252ZXJ0ZXJSZWdpc3RyeVBhdGgpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgW1ZFUkJPU0VdIERpcmVjdCByZXF1aXJlIHN1Y2Nlc3NmdWwnKTtcclxuICAgICAgfSBjYXRjaCAoZGlyZWN0RXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIEFsbCBtb2R1bGUgbG9hZGluZyBhdHRlbXB0cyBmYWlsZWQ6JywgZGlyZWN0RXJyb3IubWVzc2FnZSk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgbG9hZCBDb252ZXJ0ZXJSZWdpc3RyeTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGNvbnN0IGNvbnZlcnRlclJlZ2lzdHJ5ID0gY29udmVydGVyUmVnaXN0cnlNb2R1bGUuQ29udmVydGVyUmVnaXN0cnkgfHwgY29udmVydGVyUmVnaXN0cnlNb2R1bGUuZGVmYXVsdCB8fCBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZTtcclxuICAgIFxyXG4gICAgLy8gTG9nIGRldGFpbGVkIGluZm9ybWF0aW9uIGFib3V0IHRoZSBjb252ZXJ0ZXIgcmVnaXN0cnlcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBDb252ZXJ0ZXIgcmVnaXN0cnkgc3RydWN0dXJlOicsIHtcclxuICAgICAgaGFzQ29udmVydGVyczogISEoY29udmVydGVyUmVnaXN0cnkgJiYgY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycyksXHJcbiAgICAgIGhhc0NvbnZlcnRUb01hcmtkb3duOiB0eXBlb2YgY29udmVydGVyUmVnaXN0cnk/LmNvbnZlcnRUb01hcmtkb3duID09PSAnZnVuY3Rpb24nLFxyXG4gICAgICBoYXNHZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbjogdHlwZW9mIGNvbnZlcnRlclJlZ2lzdHJ5Py5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiA9PT0gJ2Z1bmN0aW9uJyxcclxuICAgICAgaGFzR2V0Q29udmVydGVyQnlNaW1lVHlwZTogdHlwZW9mIGNvbnZlcnRlclJlZ2lzdHJ5Py5nZXRDb252ZXJ0ZXJCeU1pbWVUeXBlID09PSAnZnVuY3Rpb24nLFxyXG4gICAgICBhdmFpbGFibGVDb252ZXJ0ZXJzOiBjb252ZXJ0ZXJSZWdpc3RyeSAmJiBjb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzID9cclxuICAgICAgICBPYmplY3Qua2V5cyhjb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzKSA6ICdub25lJ1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIFJlZ2lzdGVyIHRoZSBjb252ZXJ0ZXIgZmFjdG9yeVxyXG4gICAgcmVnaXN0ZXJDb252ZXJ0ZXJGYWN0b3J5KCdjb252ZXJ0ZXJSZWdpc3RyeScsIGNvbnZlcnRlclJlZ2lzdHJ5KTtcclxuICAgIFxyXG4gICAgY29uc29sZS50aW1lRW5kKCfwn5WSIFtWRVJCT1NFXSBDb252ZXJ0ZXJzIGluaXRpYWxpemF0aW9uIHRpbWUnKTtcclxuICAgIGNvbnNvbGUubG9nKCfinIUgW1ZFUkJPU0VdIENvbnZlcnRlcnMgcmVnaXN0ZXJlZCBzdWNjZXNzZnVsbHknKTtcclxuICAgIFxyXG4gICAgLy8gU3RvcmUgaW4gZ2xvYmFsIGZvciBlcnJvciBjaGVja2luZ1xyXG4gICAgZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5ID0gY29udmVydGVyUmVnaXN0cnk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUudGltZUVuZCgn8J+VkiBbVkVSQk9TRV0gQ29udmVydGVycyBpbml0aWFsaXphdGlvbiB0aW1lJyk7XHJcbiAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIEZhaWxlZCB0byByZWdpc3RlciBjb252ZXJ0ZXJzOicsIGVycm9yKTtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gRXJyb3IgZGV0YWlsczonLCBlcnJvci5zdGFjayk7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gRXJyb3Igb2JqZWN0OicsIHtcclxuICAgICAgbmFtZTogZXJyb3IubmFtZSxcclxuICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcclxuICAgICAgY29kZTogZXJyb3IuY29kZSxcclxuICAgICAgdHlwZTogdHlwZW9mIGVycm9yLFxyXG4gICAgICBoYXNTdGFjazogISFlcnJvci5zdGFja1xyXG4gICAgfSk7XHJcbiAgfVxyXG59KSgpO1xyXG5cclxuY2xhc3MgRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZSB7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmZpbGVTeXN0ZW0gPSBGaWxlU3lzdGVtU2VydmljZTtcclxuICAgIHRoaXMucmVzdWx0TWFuYWdlciA9IENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyO1xyXG4gICAgdGhpcy5wcm9ncmVzc1VwZGF0ZUludGVydmFsID0gMjUwOyAvLyBVcGRhdGUgcHJvZ3Jlc3MgZXZlcnkgMjUwbXNcclxuICAgIHRoaXMuZGVmYXVsdE91dHB1dERpciA9IHBhdGguam9pbihhcHAuZ2V0UGF0aCgndXNlckRhdGEnKSwgJ2NvbnZlcnNpb25zJyk7XHJcbiAgICBjb25zb2xlLmxvZygnRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZSBpbml0aWFsaXplZCB3aXRoIGRlZmF1bHQgb3V0cHV0IGRpcmVjdG9yeTonLCB0aGlzLmRlZmF1bHRPdXRwdXREaXIpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ29udmVydHMgYSBmaWxlIHRvIG1hcmtkb3duIGZvcm1hdFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfEJ1ZmZlcn0gZmlsZVBhdGggLSBQYXRoIHRvIHRoZSBmaWxlIG9yIGZpbGUgY29udGVudCBhcyBidWZmZXJcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IC0gQ29udmVyc2lvbiByZXN1bHRcclxuICAgKi9cclxuICBhc3luYyBjb252ZXJ0KGZpbGVQYXRoLCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmNvbnZlcnQgY2FsbGVkJyk7XHJcbiAgICAvLyBVc2UgYSB1bmlxdWUgbGFiZWwgZm9yIGVhY2ggY29udmVyc2lvbiB0byBhdm9pZCBkdXBsaWNhdGUgbGFiZWwgd2FybmluZ3NcclxuICAgIGNvbnN0IHRpbWVMYWJlbCA9IGDwn5WSIFtWRVJCT1NFXSBUb3RhbCBjb252ZXJzaW9uIHRpbWUgJHtEYXRlLm5vdygpfWA7XHJcbiAgICBjb25zb2xlLnRpbWUodGltZUxhYmVsKTtcclxuICAgIGNvbnNvbGUudHJhY2UoJ/CflIQgW1ZFUkJPU0VdIENvbnZlcnQgbWV0aG9kIHN0YWNrIHRyYWNlJyk7XHJcbiAgICBcclxuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFZhbGlkYXRlIG91dHB1dCBkaXJlY3RvcnlcclxuICAgICAgaWYgKCFvcHRpb25zLm91dHB1dERpcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gTm8gb3V0cHV0IGRpcmVjdG9yeSBwcm92aWRlZCEnKTtcclxuICAgICAgICBjb25zb2xlLnRpbWVFbmQodGltZUxhYmVsKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ091dHB1dCBkaXJlY3RvcnkgaXMgcmVxdWlyZWQgZm9yIGNvbnZlcnNpb24nKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coJ/Cfk6UgW1ZFUkJPU0VdIFJlY2VpdmVkIGNvbnZlcnNpb24gcmVxdWVzdDonLCB7XHJcbiAgICAgICAgaW5wdXRUeXBlOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpID8gJ0J1ZmZlcicgOiB0eXBlb2YgZmlsZVBhdGgsXHJcbiAgICAgICAgaW5wdXRMZW5ndGg6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCkgPyBmaWxlUGF0aC5sZW5ndGggOiB1bmRlZmluZWQsXHJcbiAgICAgICAgZmlsZVR5cGU6IG9wdGlvbnMuZmlsZVR5cGUsIC8vIExvZyB0aGUgZmlsZVR5cGUgd2UgcmVjZWl2ZWQgZnJvbSBmcm9udGVuZFxyXG4gICAgICAgIGhhc0J1ZmZlckluT3B0aW9uczogISFvcHRpb25zLmJ1ZmZlcixcclxuICAgICAgICBidWZmZXJMZW5ndGg6IG9wdGlvbnMuYnVmZmVyID8gb3B0aW9ucy5idWZmZXIubGVuZ3RoIDogdW5kZWZpbmVkLFxyXG4gICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICBidWZmZXI6IG9wdGlvbnMuYnVmZmVyID8gYEJ1ZmZlcigke29wdGlvbnMuYnVmZmVyLmxlbmd0aH0pYCA6IHVuZGVmaW5lZCxcclxuICAgICAgICAgIGFwaUtleTogb3B0aW9ucy5hcGlLZXkgPyAn4pyTJyA6ICfinJcnLFxyXG4gICAgICAgICAgbWlzdHJhbEFwaUtleTogb3B0aW9ucy5taXN0cmFsQXBpS2V5ID8gJ+KckycgOiAn4pyXJ1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gQ29udmVyc2lvbiBlbnZpcm9ubWVudDonLCB7XHJcbiAgICAgICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICd1bmtub3duJyxcclxuICAgICAgICBpc1BhY2thZ2VkOiBhcHAuaXNQYWNrYWdlZCxcclxuICAgICAgICBhcHBQYXRoOiBhcHAuZ2V0QXBwUGF0aCgpLFxyXG4gICAgICAgIGNvbnZlcnRlclJlZ2lzdHJ5TG9hZGVkOiAhIWdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSxcclxuICAgICAgICB1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZDogISF1bmlmaWVkQ29udmVydGVyRmFjdG9yeSxcclxuICAgICAgICBoYXNDb252ZXJ0RmlsZTogdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPyB0eXBlb2YgdW5pZmllZENvbnZlcnRlckZhY3RvcnkuY29udmVydEZpbGUgPT09ICdmdW5jdGlvbicgOiBmYWxzZVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIElmIHdlIGhhdmUgYSBidWZmZXIgaW4gb3B0aW9ucywgdXNlIHRoYXQgaW5zdGVhZCBvZiB0aGUgaW5wdXRcclxuICAgICAgaWYgKG9wdGlvbnMuYnVmZmVyICYmIEJ1ZmZlci5pc0J1ZmZlcihvcHRpb25zLmJ1ZmZlcikpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+TpiBVc2luZyBidWZmZXIgZnJvbSBvcHRpb25zIGluc3RlYWQgb2YgaW5wdXQnKTtcclxuICAgICAgICBmaWxlUGF0aCA9IG9wdGlvbnMuYnVmZmVyO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDcmVhdGUgYSBwcm9ncmVzcyB0cmFja2VyXHJcbiAgICAgIGNvbnN0IHByb2dyZXNzVHJhY2tlciA9IG5ldyBQcm9ncmVzc1RyYWNrZXIob3B0aW9ucy5vblByb2dyZXNzLCB0aGlzLnByb2dyZXNzVXBkYXRlSW50ZXJ2YWwpO1xyXG4gICAgICBcclxuICAgICAgLy8gVXNlIHRoZSBmaWxlVHlwZSBwcm92aWRlZCBieSB0aGUgZnJvbnRlbmQgLSBubyByZWRldGVybWluYXRpb25cclxuICAgICAgY29uc3QgZmlsZVR5cGUgPSBvcHRpb25zLmZpbGVUeXBlO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coJ/CflIQgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIFByb2Nlc3Npbmc6Jywge1xyXG4gICAgICAgIHR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIGlzQnVmZmVyOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpLFxyXG4gICAgICAgIGlzVGVtcG9yYXJ5OiBvcHRpb25zLmlzVGVtcG9yYXJ5LFxyXG4gICAgICAgIGlzVXJsOiBvcHRpb25zLnR5cGUgPT09ICd1cmwnIHx8IG9wdGlvbnMudHlwZSA9PT0gJ3BhcmVudHVybCcsXHJcbiAgICAgICAgaXNQYXJlbnRVcmw6IG9wdGlvbnMudHlwZSA9PT0gJ3BhcmVudHVybCdcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBEZWxlZ2F0ZSB0byBVbmlmaWVkQ29udmVydGVyRmFjdG9yeSB3aXRoIHRoZSBmaWxlVHlwZSBmcm9tIGZyb250ZW5kXHJcbiAgICAgIGNvbnN0IGNvbnZlcnNpb25SZXN1bHQgPSBhd2FpdCB1bmlmaWVkQ29udmVydGVyRmFjdG9yeS5jb252ZXJ0RmlsZShmaWxlUGF0aCwge1xyXG4gICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgZmlsZVR5cGUsXHJcbiAgICAgICAgcHJvZ3Jlc3NUcmFja2VyXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgaWYgKCFjb252ZXJzaW9uUmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoY29udmVyc2lvblJlc3VsdC5lcnJvciB8fCAnQ29udmVyc2lvbiBmYWlsZWQnKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgaWYgdGhpcyBpcyBhbiBhc3luY2hyb25vdXMgY29udmVyc2lvbiAoaGFzIGFzeW5jOiB0cnVlIGFuZCBjb252ZXJzaW9uSWQpXHJcbiAgICAgIGlmIChjb252ZXJzaW9uUmVzdWx0LmFzeW5jID09PSB0cnVlICYmIGNvbnZlcnNpb25SZXN1bHQuY29udmVyc2lvbklkKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCflIQgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIEhhbmRsaW5nIGFzeW5jIGNvbnZlcnNpb24gd2l0aCBJRDogJHtjb252ZXJzaW9uUmVzdWx0LmNvbnZlcnNpb25JZH1gKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBHZXQgdGhlIGNvbnZlcnRlciByZWdpc3RyeVxyXG4gICAgICAgIGNvbnN0IGNvbnZlcnRlclJlZ2lzdHJ5ID0gZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gICAgICAgIGlmICghY29udmVydGVyUmVnaXN0cnkpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVydGVyIHJlZ2lzdHJ5IG5vdCBhdmFpbGFibGUgZm9yIGFzeW5jIGNvbnZlcnNpb24nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUG9sbCBmb3IgdGhlIGNvbnZlcnNpb24gcmVzdWx0XHJcbiAgICAgICAgbGV0IGZpbmFsUmVzdWx0ID0gbnVsbDtcclxuICAgICAgICBsZXQgYXR0ZW1wdHMgPSAwO1xyXG4gICAgICAgIC8vIEluY3JlYXNlIHRpbWVvdXQgZm9yIHBhcmVudCBVUkwgY29udmVyc2lvbnMgd2hpY2ggY2FuIHRha2UgbG9uZ2VyXHJcbiAgICAgICAgY29uc3QgbWF4QXR0ZW1wdHMgPSBjb252ZXJzaW9uUmVzdWx0LnR5cGUgPT09ICdwYXJlbnR1cmwnID8gMjQwIDogNjA7IC8vIDEyMHMgZm9yIHBhcmVudHVybCwgMzBzIGZvciBvdGhlcnNcclxuICAgICAgICBcclxuICAgICAgICB3aGlsZSAoYXR0ZW1wdHMgPCBtYXhBdHRlbXB0cykge1xyXG4gICAgICAgICAgLy8gR2V0IHRoZSBjb252ZXJzaW9uIGZyb20gdGhlIHJlZ2lzdHJ5XHJcbiAgICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gY29udmVydGVyUmVnaXN0cnkuZ2V0Q29udmVyc2lvbihjb252ZXJzaW9uUmVzdWx0LmNvbnZlcnNpb25JZCk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGlmICghY29udmVyc2lvbikge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gQ29udmVyc2lvbiAke2NvbnZlcnNpb25SZXN1bHQuY29udmVyc2lvbklkfSBub3QgZm91bmQgaW4gcmVnaXN0cnlgKTtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBjb252ZXJzaW9uIGlzIGNvbXBsZXRlXHJcbiAgICAgICAgICBpZiAoY29udmVyc2lvbi5zdGF0dXMgPT09ICdjb21wbGV0ZWQnICYmIGNvbnZlcnNpb24ucmVzdWx0KSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinIUgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIEFzeW5jIGNvbnZlcnNpb24gJHtjb252ZXJzaW9uUmVzdWx0LmNvbnZlcnNpb25JZH0gY29tcGxldGVkYCk7XHJcbiAgICAgICAgICAgIGZpbmFsUmVzdWx0ID0gY29udmVyc2lvbi5yZXN1bHQ7XHJcbiAgICAgICAgICAgIC8vIE1hcmsgdGhlIGNvbnZlcnNpb24gYXMgcmV0cmlldmVkIHNvIGl0IGNhbiBiZSBjbGVhbmVkIHVwXHJcbiAgICAgICAgICAgIGNvbnZlcnRlclJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25SZXN1bHQuY29udmVyc2lvbklkLCB7IHJldHJpZXZlZDogdHJ1ZSB9KTtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBjb252ZXJzaW9uIGZhaWxlZFxyXG4gICAgICAgICAgaWYgKGNvbnZlcnNpb24uc3RhdHVzID09PSAnZmFpbGVkJykge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIEFzeW5jIGNvbnZlcnNpb24gJHtjb252ZXJzaW9uUmVzdWx0LmNvbnZlcnNpb25JZH0gZmFpbGVkOiAke2NvbnZlcnNpb24uZXJyb3IgfHwgJ1Vua25vd24gZXJyb3InfWApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gSWYgdGhpcyBpcyBhIHRyYW5zY3JpcHRpb24gY29udmVyc2lvbiwgd2Ugd2FudCB0byB0aHJvdyBhIHNwZWNpZmljIGVycm9yXHJcbiAgICAgICAgICAgIC8vIHRoYXQgd2lsbCBiZSBjYXVnaHQgYW5kIGhhbmRsZWQgZGlmZmVyZW50bHkgYnkgdGhlIFVJXHJcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uUmVzdWx0LmlzVHJhbnNjcmlwdGlvbikge1xyXG4gICAgICAgICAgICAgIGNvbnN0IHRyYW5zY3JpcHRpb25FcnJvciA9IG5ldyBFcnJvcihjb252ZXJzaW9uLmVycm9yIHx8ICdUcmFuc2NyaXB0aW9uIGZhaWxlZCcpO1xyXG4gICAgICAgICAgICAgIHRyYW5zY3JpcHRpb25FcnJvci5pc1RyYW5zY3JpcHRpb25FcnJvciA9IHRydWU7XHJcbiAgICAgICAgICAgICAgdGhyb3cgdHJhbnNjcmlwdGlvbkVycm9yO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihjb252ZXJzaW9uLmVycm9yIHx8ICdBc3luYyBjb252ZXJzaW9uIGZhaWxlZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIFdhaXQgYmVmb3JlIGNoZWNraW5nIGFnYWluXHJcbiAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNTAwKSk7XHJcbiAgICAgICAgICBhdHRlbXB0cysrO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBJZiB3ZSBkaWRuJ3QgZ2V0IGEgcmVzdWx0IGFmdGVyIGFsbCBhdHRlbXB0cywgdGhyb3cgYW4gZXJyb3JcclxuICAgICAgICBpZiAoIWZpbmFsUmVzdWx0KSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEFzeW5jIGNvbnZlcnNpb24gJHtjb252ZXJzaW9uUmVzdWx0LmNvbnZlcnNpb25JZH0gdGltZWQgb3V0IG9yIHdhcyBub3QgZm91bmRgKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gVXNlIHRoZSBmaW5hbCByZXN1bHQgYXMgdGhlIGNvbnRlbnRcclxuICAgICAgICBpZiAoIWZpbmFsUmVzdWx0KSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FzeW5jIGNvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBVcGRhdGUgdGhlIGNvbnZlcnNpb25SZXN1bHQgd2l0aCB0aGUgZmluYWwgY29udGVudFxyXG4gICAgICAgIGNvbnZlcnNpb25SZXN1bHQuY29udGVudCA9IGZpbmFsUmVzdWx0O1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIFVwZGF0ZWQgY29udmVyc2lvblJlc3VsdC5jb250ZW50IHdpdGggZmluYWwgcmVzdWx0IChsZW5ndGg6ICR7ZmluYWxSZXN1bHQubGVuZ3RofSlgKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBGb3Igc3luY2hyb25vdXMgY29udmVyc2lvbnMsIGV4dHJhY3QgY29udGVudCBmcm9tIHJlc3VsdFxyXG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBjb252ZXJzaW9uUmVzdWx0LmNvbnRlbnQgfHwgJyc7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFjb250ZW50KSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gVXNlIGNhdGVnb3J5IGZyb20gZnJvbnRlbmQgaWYgYXZhaWxhYmxlXHJcbiAgICAgIC8vIEZvciBVUkwgY29udmVyc2lvbnMsIGRlZmF1bHQgdG8gJ3dlYicgY2F0ZWdvcnlcclxuICAgICAgY29uc3QgZmlsZUNhdGVnb3J5ID0gb3B0aW9ucy5jYXRlZ29yeSB8fCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25SZXN1bHQuY2F0ZWdvcnkgfHwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAob3B0aW9ucy50eXBlID09PSAndXJsJyB8fCBvcHRpb25zLnR5cGUgPT09ICdwYXJlbnR1cmwnID8gJ3dlYicgOiAndGV4dCcpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgaWYgdGhlIGNvbnZlcnNpb24gcmVzdWx0IGhhcyBtdWx0aXBsZSBmaWxlcyAoZm9yIHBhcmVudHVybCBzZXBhcmF0ZSBtb2RlKVxyXG4gICAgICBjb25zdCBoYXNNdWx0aXBsZUZpbGVzID0gQXJyYXkuaXNBcnJheShjb252ZXJzaW9uUmVzdWx0LmZpbGVzKSAmJiBjb252ZXJzaW9uUmVzdWx0LmZpbGVzLmxlbmd0aCA+IDA7XHJcbiAgICAgIGNvbnN0IGlzTXVsdGlwbGVGaWxlc1Jlc3VsdCA9IGNvbnZlcnNpb25SZXN1bHQudHlwZSA9PT0gJ211bHRpcGxlX2ZpbGVzJztcclxuICAgICAgXHJcbiAgICAgIGlmIChoYXNNdWx0aXBsZUZpbGVzKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4EgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIENvbnZlcnNpb24gcmVzdWx0IGhhcyAke2NvbnZlcnNpb25SZXN1bHQuZmlsZXMubGVuZ3RofSBmaWxlc2ApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAoaXNNdWx0aXBsZUZpbGVzUmVzdWx0KSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4EgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIE11bHRpcGxlIGZpbGVzIHJlc3VsdDogJHtjb252ZXJzaW9uUmVzdWx0LnRvdGFsRmlsZXN9IGZpbGVzIGluICR7Y29udmVyc2lvblJlc3VsdC5vdXRwdXREaXJlY3Rvcnl9YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gRm9yIG11bHRpcGxlIGZpbGVzIHJlc3VsdCwgcmV0dXJuIHRoZSBkaXJlY3RvcnkgaW5mb3JtYXRpb24gZGlyZWN0bHlcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgIG91dHB1dFBhdGg6IGNvbnZlcnNpb25SZXN1bHQub3V0cHV0RGlyZWN0b3J5LFxyXG4gICAgICAgICAgaW5kZXhGaWxlOiBjb252ZXJzaW9uUmVzdWx0LmluZGV4RmlsZSxcclxuICAgICAgICAgIGZpbGVzOiBjb252ZXJzaW9uUmVzdWx0LmZpbGVzLFxyXG4gICAgICAgICAgdG90YWxGaWxlczogY29udmVyc2lvblJlc3VsdC50b3RhbEZpbGVzLFxyXG4gICAgICAgICAgc3VtbWFyeTogY29udmVyc2lvblJlc3VsdC5zdW1tYXJ5LFxyXG4gICAgICAgICAgdHlwZTogJ211bHRpcGxlX2ZpbGVzJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFNhdmUgdGhlIGNvbnZlcnNpb24gcmVzdWx0IHVzaW5nIHRoZSBDb252ZXJzaW9uUmVzdWx0TWFuYWdlclxyXG4gICAgICAvLyBFbnN1cmUgd2UncmUgY29uc2lzdGVudGx5IHVzaW5nIHRoZSBvcmlnaW5hbCBmaWxlbmFtZVxyXG4gICAgICAvLyBQcmlvcml0eTogY29udmVydGVyJ3MgbWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSA+IGNvbnZlcnNpb25SZXN1bHQgZmllbGRzID4gb3B0aW9ucyBmaWVsZHNcclxuICAgICAgY29uc3Qgb3JpZ2luYWxGaWxlTmFtZSA9IChjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhICYmIGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSkgfHxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvblJlc3VsdC5vcmlnaW5hbEZpbGVOYW1lIHx8XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25SZXN1bHQubmFtZSB8fFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucy5uYW1lO1xyXG5cclxuICAgICAgLy8gQWRkIGVuaGFuY2VkIGxvZ2dpbmcgZm9yIFhMU1gvQ1NWIGZpbGVzIHRvIHRyYWNrIGZpbGVuYW1lIGhhbmRsaW5nXHJcbiAgICAgIGlmIChmaWxlVHlwZSA9PT0gJ3hsc3gnIHx8IGZpbGVUeXBlID09PSAnY3N2Jykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OKIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBFeGNlbC9DU1Ygb3JpZ2luYWxGaWxlTmFtZSByZXNvbHV0aW9uOmAsIHtcclxuICAgICAgICAgIGZyb21NZXRhZGF0YTogY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSAmJiBjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgICAgICBmcm9tUmVzdWx0OiBjb252ZXJzaW9uUmVzdWx0Lm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgICAgICBmcm9tUmVzdWx0TmFtZTogY29udmVyc2lvblJlc3VsdC5uYW1lLFxyXG4gICAgICAgICAgZnJvbU9wdGlvbnM6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICAgIGZyb21PcHRpb25zTmFtZTogb3B0aW9ucy5uYW1lLFxyXG4gICAgICAgICAgcmVzb2x2ZWQ6IG9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgICAgICBtZXRhZGF0YUtleXM6IGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEgPyBPYmplY3Qua2V5cyhjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhKSA6IFtdLFxyXG4gICAgICAgICAgcmVzdWx0S2V5czogT2JqZWN0LmtleXMoY29udmVyc2lvblJlc3VsdClcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc29sZS5sb2coYPCfk6YgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIFVzaW5nIGZpbGVuYW1lIGZvciByZXN1bHQ6ICR7b3JpZ2luYWxGaWxlTmFtZX1gKTtcclxuXHJcbiAgICAgIC8vIExvZyBtZXRhZGF0YSBmcm9tIHRoZSBjb252ZXJzaW9uIHJlc3VsdCBmb3IgZGVidWdnaW5nXHJcbiAgICAgIGlmIChjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCflI0gW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIENvbnZlcnNpb24gcmVzdWx0IG1ldGFkYXRhOmAsIHtcclxuICAgICAgICAgIGtleXM6IE9iamVjdC5rZXlzKGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEpLFxyXG4gICAgICAgICAgaGFzT3JpZ2luYWxGaWxlTmFtZTogJ29yaWdpbmFsRmlsZU5hbWUnIGluIGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEsXHJcbiAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWVcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gRm9yIFhMU1ggYW5kIENTViBmaWxlcywgc3BlY2lmaWNhbGx5IGVuc3VyZSB0aGUgbWV0YWRhdGEgY29udGFpbnMgdGhlIG9yaWdpbmFsRmlsZU5hbWVcclxuICAgICAgbGV0IGVuaGFuY2VkTWV0YWRhdGEgPSB7XHJcbiAgICAgICAgLi4uKGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEgfHwge30pLFxyXG4gICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG9yaWdpbmFsRmlsZU5hbWUgLy8gRW5zdXJlIG9yaWdpbmFsIGZpbGVuYW1lIGlzIGluIG1ldGFkYXRhXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBGb3IgWExTWC9DU1YgZmlsZXMsIGRvdWJsZS1jaGVjayB0aGUgbWV0YWRhdGEgc3RydWN0dXJlXHJcbiAgICAgIGlmIChmaWxlVHlwZSA9PT0gJ3hsc3gnIHx8IGZpbGVUeXBlID09PSAnY3N2Jykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OKIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBFbmhhbmNlZCBtZXRhZGF0YSBmb3IgJHtmaWxlVHlwZX06YCwgZW5oYW5jZWRNZXRhZGF0YSk7XHJcblxyXG4gICAgICAgIC8vIExvZyBhZGRpdGlvbmFsIGRlYnVnZ2luZyBpbmZvXHJcbiAgICAgICAgaWYgKCFlbmhhbmNlZE1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUpIHtcclxuICAgICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBvcmlnaW5hbEZpbGVOYW1lIG1pc3NpbmcgaW4gbWV0YWRhdGEgZXZlbiBhZnRlciBzZXR0aW5nIGl0IWApO1xyXG4gICAgICAgICAgLy8gRm9yY2Ugc2V0IGl0IGFzIGEgbGFzdCByZXNvcnRcclxuICAgICAgICAgIGVuaGFuY2VkTWV0YWRhdGEgPSB7IC4uLmVuaGFuY2VkTWV0YWRhdGEsIG9yaWdpbmFsRmlsZU5hbWUgfTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucmVzdWx0TWFuYWdlci5zYXZlQ29udmVyc2lvblJlc3VsdCh7XHJcbiAgICAgICAgY29udGVudDogY29udmVyc2lvblJlc3VsdC5jb250ZW50LCAvLyBVc2UgY29udmVyc2lvblJlc3VsdC5jb250ZW50IGRpcmVjdGx5XHJcbiAgICAgICAgbWV0YWRhdGE6IGVuaGFuY2VkTWV0YWRhdGEsIC8vIFVzZSBvdXIgZW5oYW5jZWQgbWV0YWRhdGFcclxuICAgICAgICBpbWFnZXM6IGNvbnZlcnNpb25SZXN1bHQuaW1hZ2VzIHx8IFtdLFxyXG4gICAgICAgIGZpbGVzOiBjb252ZXJzaW9uUmVzdWx0LmZpbGVzLFxyXG4gICAgICAgIG5hbWU6IG9yaWdpbmFsRmlsZU5hbWUsIC8vIFVzZSB0aGUgb3JpZ2luYWwgZmlsZW5hbWUgY29uc2lzdGVudGx5XHJcbiAgICAgICAgdHlwZTogY29udmVyc2lvblJlc3VsdC50eXBlIHx8IGZpbGVUeXBlLFxyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZSwgLy8gQWx3YXlzIHVzZSB0aGUgZmlsZVR5cGUgZnJvbSBmcm9udGVuZFxyXG4gICAgICAgIG91dHB1dERpcjogb3B0aW9ucy5vdXRwdXREaXIsXHJcbiAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG9yaWdpbmFsRmlsZU5hbWUsIC8vIEFkZCBpdCB0byBvcHRpb25zIHRvb1xyXG4gICAgICAgICAgY2F0ZWdvcnk6IGZpbGVDYXRlZ29yeSxcclxuICAgICAgICAgIHBhZ2VDb3VudDogY29udmVyc2lvblJlc3VsdC5wYWdlQ291bnQsXHJcbiAgICAgICAgICBzbGlkZUNvdW50OiBjb252ZXJzaW9uUmVzdWx0LnNsaWRlQ291bnQsXHJcbiAgICAgICAgICBoYXNNdWx0aXBsZUZpbGVzXHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGDinIUgRmlsZSBjb252ZXJzaW9uIGNvbXBsZXRlZCBpbiAke0RhdGUubm93KCkgLSBzdGFydFRpbWV9bXM6YCwge1xyXG4gICAgICAgIGZpbGU6IGZpbGVQYXRoLFxyXG4gICAgICAgIG91dHB1dFBhdGg6IHJlc3VsdC5vdXRwdXRQYXRoXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gRW5kIHRpbWVyIGZvciBzdWNjZXNzZnVsIGNvbnZlcnNpb25cclxuICAgICAgY29uc29sZS50aW1lRW5kKHRpbWVMYWJlbCk7XHJcblxyXG4gICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICBcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUudGltZUVuZCh0aW1lTGFiZWwpO1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIENvbnZlcnNpb24gZXJyb3IgY2F1Z2h0IGluIEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuY29udmVydCcpO1xyXG4gICAgICBcclxuICAgICAgLy8gQWx3YXlzIGluY2x1ZGUgZmlsZVR5cGUgaW4gZXJyb3IgcmVzdWx0c1xyXG4gICAgICBjb25zdCBmaWxlVHlwZSA9IG9wdGlvbnMuZmlsZVR5cGUgfHwgJ3Vua25vd24nO1xyXG4gICAgICBcclxuICAgICAgLy8gRGV0YWlsZWQgZXJyb3IgbG9nZ2luZ1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gRXJyb3IgZGV0YWlsczonLCB7XHJcbiAgICAgICAgbmFtZTogZXJyb3IubmFtZSxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcclxuICAgICAgICBjb2RlOiBlcnJvci5jb2RlLFxyXG4gICAgICAgIHR5cGU6IHR5cGVvZiBlcnJvclxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGNvbnZlcnRlciByZWdpc3RyeSBzdGF0ZVxyXG4gICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gQ29udmVydGVyIHJlZ2lzdHJ5IHN0YXRlIGF0IGVycm9yIHRpbWU6Jywge1xyXG4gICAgICAgIGNvbnZlcnRlclJlZ2lzdHJ5TG9hZGVkOiAhIWdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSxcclxuICAgICAgICBoYXNDb252ZXJ0ZXJzOiAhIShnbG9iYWwuY29udmVydGVyUmVnaXN0cnkgJiYgZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5LmNvbnZlcnRlcnMpLFxyXG4gICAgICAgIGF2YWlsYWJsZUNvbnZlcnRlcnM6IGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSAmJiBnbG9iYWwuY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycyA/IFxyXG4gICAgICAgICAgT2JqZWN0LmtleXMoZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5LmNvbnZlcnRlcnMpIDogJ25vbmUnLFxyXG4gICAgICAgIHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5TG9hZGVkOiAhIXVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LFxyXG4gICAgICAgIGhhc0NvbnZlcnRGaWxlOiB1bmlmaWVkQ29udmVydGVyRmFjdG9yeSA/IHR5cGVvZiB1bmlmaWVkQ29udmVydGVyRmFjdG9yeS5jb252ZXJ0RmlsZSA9PT0gJ2Z1bmN0aW9uJyA6IGZhbHNlXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgZXJyb3JJbmZvID0ge1xyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZSwgLy8gQWx3YXlzIGluY2x1ZGUgZmlsZVR5cGVcclxuICAgICAgICB0eXBlOiBvcHRpb25zLnR5cGUsXHJcbiAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICAgIGlzQnVmZmVyOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpLFxyXG4gICAgICAgIGJ1ZmZlckxlbmd0aDogQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSA/IGZpbGVQYXRoLmxlbmd0aCA6IHVuZGVmaW5lZCxcclxuICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSxcclxuICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXHJcbiAgICAgICAgY29udmVydGVyc0xvYWRlZDogISFnbG9iYWwuY29udmVydGVyUmVnaXN0cnkgLy8gQ2hlY2sgaWYgY29udmVydGVycyB3ZXJlIGxvYWRlZFxyXG4gICAgICB9O1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBDb252ZXJzaW9uIGZhaWxlZDonLCBlcnJvckluZm8pO1xyXG4gICAgICBcclxuICAgICAgLy8gQ29uc3RydWN0IGEgdXNlci1mcmllbmRseSBlcnJvciBtZXNzYWdlXHJcbiAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCkgXHJcbiAgICAgICAgPyBgRmFpbGVkIHRvIGNvbnZlcnQgJHtvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgJ2ZpbGUnfTogJHtlcnJvci5tZXNzYWdlfWBcclxuICAgICAgICA6IGBGYWlsZWQgdG8gY29udmVydCAke2ZpbGVQYXRofTogJHtlcnJvci5tZXNzYWdlfWA7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvck1lc3NhZ2UsXHJcbiAgICAgICAgZGV0YWlsczogZXJyb3JJbmZvLFxyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZSAvLyBFeHBsaWNpdGx5IGluY2x1ZGUgZmlsZVR5cGUgaW4gZXJyb3IgcmVzdWx0XHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTZXRzIHVwIHRoZSBvdXRwdXQgZGlyZWN0b3J5IGZvciBjb252ZXJzaW9uc1xyXG4gICAqL1xyXG4gIGFzeW5jIHNldHVwT3V0cHV0RGlyZWN0b3J5KG91dHB1dERpcikge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgZGlyVG9TZXR1cCA9IG91dHB1dERpciB8fCB0aGlzLmRlZmF1bHRPdXRwdXREaXI7XHJcbiAgICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS5jcmVhdGVEaXJlY3RvcnkoZGlyVG9TZXR1cCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5OBIE91dHB1dCBkaXJlY3RvcnkgcmVhZHk6JywgZGlyVG9TZXR1cCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIHNldCB1cCBvdXRwdXQgZGlyZWN0b3J5OicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IG5ldyBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlKCk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTTtFQUFFQztBQUFJLENBQUMsR0FBR0QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUNuQyxNQUFNO0VBQUVFO0FBQVUsQ0FBQyxHQUFHRixPQUFPLENBQUMsZ0JBQWdCLENBQUM7QUFDL0MsTUFBTTtFQUFFRztBQUFVLENBQUMsR0FBR0gsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUNyQyxNQUFNSSxFQUFFLEdBQUdKLE9BQU8sQ0FBQyxJQUFJLENB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