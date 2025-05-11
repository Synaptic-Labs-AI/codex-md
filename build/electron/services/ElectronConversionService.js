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

      // Extract content from result
      const content = conversionResult.content || '';
      if (!content) {
        throw new Error('Conversion produced empty content');
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
        content: content,
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsIlBhdGhVdGlscyIsInByb21pc2lmeSIsImZzIiwicmVhZEZpbGVBc3luYyIsInJlYWRGaWxlIiwiaW5zdGFuY2UiLCJGaWxlU3lzdGVtU2VydmljZSIsIkNvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIiwiZ2V0RmlsZVR5cGUiLCJnZXRGaWxlSGFuZGxpbmdJbmZvIiwiSEFORExJTkdfVFlQRVMiLCJDT05WRVJURVJfQ09ORklHIiwiUHJvZ3Jlc3NUcmFja2VyIiwiY29udmVydFRvTWFya2Rvd24iLCJyZWdpc3RlckNvbnZlcnRlciIsInJlZ2lzdGVyQ29udmVydGVyRmFjdG9yeSIsImNvbnNvbGUiLCJsb2ciLCJoYW5kbGluZ1R5cGVzIiwiZmlsZUNvbmZpZyIsIk1vZHVsZVJlc29sdmVyIiwidW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJpbml0aWFsaXplIiwiY2F0Y2giLCJlcnJvciIsImdldENvbnZlcnRlclJlZ2lzdHJ5UGF0aCIsInJlc29sdmVNb2R1bGVQYXRoIiwidGltZSIsImNvbnZlcnRlclJlZ2lzdHJ5UGF0aCIsImVudmlyb25tZW50IiwicHJvY2VzcyIsImVudiIsIk5PREVfRU5WIiwiYXBwUGF0aCIsImdldEFwcFBhdGgiLCJjdXJyZW50RGlyIiwiX19kaXJuYW1lIiwiaXNQYWNrYWdlZCIsImZpbGVFeGlzdHMiLCJleGlzdHNTeW5jIiwiZGlybmFtZSIsInJlYWRkaXJTeW5jIiwic2VydmljZXMiLCJqb2luIiwiY29udmVyc2lvbiIsImRhdGEiLCJjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSIsInNhZmVSZXF1aXJlIiwia2V5cyIsIk9iamVjdCIsImhhc0NvbnZlcnRlclJlZ2lzdHJ5IiwiaGFzRGVmYXVsdEV4cG9ydCIsImV4cG9ydFR5cGVzIiwiZW50cmllcyIsIm1hcCIsImtleSIsInZhbHVlIiwibmFtZSIsIm1lc3NhZ2UiLCJzdGFjayIsImNvZGUiLCJkaXJlY3RFcnJvciIsIkVycm9yIiwiY29udmVydGVyUmVnaXN0cnkiLCJDb252ZXJ0ZXJSZWdpc3RyeSIsImRlZmF1bHQiLCJoYXNDb252ZXJ0ZXJzIiwiY29udmVydGVycyIsImhhc0NvbnZlcnRUb01hcmtkb3duIiwiaGFzR2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJnZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiIsImhhc0dldENvbnZlcnRlckJ5TWltZVR5cGUiLCJnZXRDb252ZXJ0ZXJCeU1pbWVUeXBlIiwiYXZhaWxhYmxlQ29udmVydGVycyIsInRpbWVFbmQiLCJnbG9iYWwiLCJ0eXBlIiwiaGFzU3RhY2siLCJFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJmaWxlU3lzdGVtIiwicmVzdWx0TWFuYWdlciIsInByb2dyZXNzVXBkYXRlSW50ZXJ2YWwiLCJkZWZhdWx0T3V0cHV0RGlyIiwiZ2V0UGF0aCIsImNvbnZlcnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJ0aW1lTGFiZWwiLCJEYXRlIiwibm93IiwidHJhY2UiLCJzdGFydFRpbWUiLCJvdXRwdXREaXIiLCJpbnB1dFR5cGUiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImlucHV0TGVuZ3RoIiwibGVuZ3RoIiwidW5kZWZpbmVkIiwiZmlsZVR5cGUiLCJoYXNCdWZmZXJJbk9wdGlvbnMiLCJidWZmZXIiLCJidWZmZXJMZW5ndGgiLCJhcGlLZXkiLCJtaXN0cmFsQXBpS2V5IiwiY29udmVydGVyUmVnaXN0cnlMb2FkZWQiLCJ1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZCIsImhhc0NvbnZlcnRGaWxlIiwiY29udmVydEZpbGUiLCJwcm9ncmVzc1RyYWNrZXIiLCJvblByb2dyZXNzIiwiaXNUZW1wb3JhcnkiLCJpc1VybCIsImlzUGFyZW50VXJsIiwiY29udmVyc2lvblJlc3VsdCIsInN1Y2Nlc3MiLCJjb250ZW50IiwiZmlsZUNhdGVnb3J5IiwiY2F0ZWdvcnkiLCJoYXNNdWx0aXBsZUZpbGVzIiwiQXJyYXkiLCJpc0FycmF5IiwiZmlsZXMiLCJvcmlnaW5hbEZpbGVOYW1lIiwibWV0YWRhdGEiLCJmcm9tTWV0YWRhdGEiLCJmcm9tUmVzdWx0IiwiZnJvbVJlc3VsdE5hbWUiLCJmcm9tT3B0aW9ucyIsImZyb21PcHRpb25zTmFtZSIsInJlc29sdmVkIiwibWV0YWRhdGFLZXlzIiwicmVzdWx0S2V5cyIsImhhc09yaWdpbmFsRmlsZU5hbWUiLCJlbmhhbmNlZE1ldGFkYXRhIiwid2FybiIsInJlc3VsdCIsInNhdmVDb252ZXJzaW9uUmVzdWx0IiwiaW1hZ2VzIiwicGFnZUNvdW50Iiwic2xpZGVDb3VudCIsImZpbGUiLCJvdXRwdXRQYXRoIiwiZXJyb3JJbmZvIiwiY29udmVydGVyc0xvYWRlZCIsImVycm9yTWVzc2FnZSIsImRldGFpbHMiLCJzZXR1cE91dHB1dERpcmVjdG9yeSIsImRpclRvU2V0dXAiLCJjcmVhdGVEaXJlY3RvcnkiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanNcclxuICogSGFuZGxlcyBkb2N1bWVudCBjb252ZXJzaW9uIHVzaW5nIG5hdGl2ZSBmaWxlIHN5c3RlbSBvcGVyYXRpb25zIGluIEVsZWN0cm9uLlxyXG4gKiBDb29yZGluYXRlcyBjb252ZXJzaW9uIHByb2Nlc3NlcyBhbmQgZGVsZWdhdGVzIHRvIHRoZSBzaGFyZWQgY29udmVyc2lvbiB1dGlsaXRpZXMuXHJcbiAqXHJcbiAqIElNUE9SVEFOVDogV2hlbiBkZXRlcm1pbmluZyBmaWxlIHR5cGVzIGZvciBjb252ZXJzaW9uLCB3ZSBleHRyYWN0IHRoZSBmaWxlIGV4dGVuc2lvblxyXG4gKiBkaXJlY3RseSByYXRoZXIgdGhhbiB1c2luZyB0aGUgY2F0ZWdvcnkgZnJvbSBnZXRGaWxlVHlwZS4gVGhpcyBlbnN1cmVzIHRoYXQgd2UgdXNlXHJcbiAqIHRoZSBzcGVjaWZpYyBjb252ZXJ0ZXIgcmVnaXN0ZXJlZCBmb3IgZWFjaCBmaWxlIHR5cGUgKGUuZy4sICdwZGYnLCAnZG9jeCcsICdwcHR4JylcclxuICogcmF0aGVyIHRoYW4gdHJ5aW5nIHRvIHVzZSBhIGNvbnZlcnRlciBmb3IgdGhlIGNhdGVnb3J5ICgnZG9jdW1lbnRzJykuXHJcbiAqXHJcbiAqIFNwZWNpYWwgaGFuZGxpbmcgaXMgaW1wbGVtZW50ZWQgZm9yIGRhdGEgZmlsZXMgKENTViwgWExTWCkgdG8gZW5zdXJlIHRoZXkgdXNlIHRoZVxyXG4gKiBjb3JyZWN0IGNvbnZlcnRlciBiYXNlZCBvbiBmaWxlIGV4dGVuc2lvbi4gSWYgdGhlIGV4dGVuc2lvbiBjYW4ndCBiZSBkZXRlcm1pbmVkLFxyXG4gKiB3ZSBkZWZhdWx0IHRvICdjc3YnIHJhdGhlciB0aGFuIHVzaW5nIHRoZSBjYXRlZ29yeSAnZGF0YScuXHJcbiAqXHJcbiAqIEZvciBDU1YgZmlsZXMgc2VudCBhcyB0ZXh0IGNvbnRlbnQsIHdlIGRldGVjdCBDU1YgY29udGVudCBieSBjaGVja2luZyBmb3IgY29tbWFzLCB0YWJzLFxyXG4gKiBhbmQgbmV3bGluZXMsIGFuZCBwcm9jZXNzIGl0IGRpcmVjdGx5IHJhdGhlciB0aGFuIHRyZWF0aW5nIGl0IGFzIGEgZmlsZSBwYXRoLiBUaGlzIGZpeGVzXHJcbiAqIHRoZSBcIkZpbGUgbm90IGZvdW5kIG9yIGluYWNjZXNzaWJsZVwiIGVycm9yIHRoYXQgb2NjdXJyZWQgd2hlbiB0aGUgc3lzdGVtIHRyaWVkIHRvIGludGVycHJldFxyXG4gKiBDU1YgY29udGVudCBhcyBhIGZpbGUgcGF0aC5cclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgeyBQYXRoVXRpbHMgfSA9IHJlcXVpcmUoJy4uL3V0aWxzL3BhdGhzJyk7XHJcbmNvbnN0IHsgcHJvbWlzaWZ5IH0gPSByZXF1aXJlKCd1dGlsJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcclxuY29uc3QgcmVhZEZpbGVBc3luYyA9IHByb21pc2lmeShmcy5yZWFkRmlsZSk7XHJcbmNvbnN0IHsgaW5zdGFuY2U6IEZpbGVTeXN0ZW1TZXJ2aWNlIH0gPSByZXF1aXJlKCcuL0ZpbGVTeXN0ZW1TZXJ2aWNlJyk7IC8vIEltcG9ydCBpbnN0YW5jZVxyXG5jb25zdCBDb252ZXJzaW9uUmVzdWx0TWFuYWdlciA9IHJlcXVpcmUoJy4vQ29udmVyc2lvblJlc3VsdE1hbmFnZXInKTtcclxuLy8gSW1wb3J0IGxvY2FsIHV0aWxpdGllc1xyXG5jb25zdCB7IFxyXG4gIGdldEZpbGVUeXBlLFxyXG4gIGdldEZpbGVIYW5kbGluZ0luZm8sXHJcbiAgSEFORExJTkdfVFlQRVMsXHJcbiAgQ09OVkVSVEVSX0NPTkZJR1xyXG59ID0gcmVxdWlyZSgnLi4vdXRpbHMvZmlsZXMnKTtcclxuY29uc3QgeyBcclxuICBQcm9ncmVzc1RyYWNrZXIsIFxyXG4gIGNvbnZlcnRUb01hcmtkb3duLCBcclxuICByZWdpc3RlckNvbnZlcnRlcixcclxuICByZWdpc3RlckNvbnZlcnRlckZhY3RvcnlcclxufSA9IHJlcXVpcmUoJy4uL3V0aWxzL2NvbnZlcnNpb24nKTtcclxuXHJcbi8vIExvZyBhdmFpbGFibGUgZmlsZSBoYW5kbGluZyBjYXBhYmlsaXRpZXNcclxuY29uc29sZS5sb2coJ/Cfk4QgSW5pdGlhbGl6ZWQgd2l0aCBmaWxlIGhhbmRsaW5nOicsIHtcclxuICBoYW5kbGluZ1R5cGVzOiBIQU5ETElOR19UWVBFUyxcclxuICBmaWxlQ29uZmlnOiBDT05WRVJURVJfQ09ORklHXHJcbn0pO1xyXG5cclxuLy8gSW1wb3J0IE1vZHVsZVJlc29sdmVyIGFuZCBVbmlmaWVkQ29udmVydGVyRmFjdG9yeVxyXG5jb25zdCB7IE1vZHVsZVJlc29sdmVyIH0gPSByZXF1aXJlKCcuLi91dGlscy9tb2R1bGVSZXNvbHZlcicpO1xyXG5jb25zdCB1bmlmaWVkQ29udmVydGVyRmFjdG9yeSA9IHJlcXVpcmUoJy4uL2NvbnZlcnRlcnMvVW5pZmllZENvbnZlcnRlckZhY3RvcnknKTtcclxuXHJcbi8vIEluaXRpYWxpemUgdGhlIGNvbnZlcnRlciBmYWN0b3J5XHJcbnVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmluaXRpYWxpemUoKS5jYXRjaChlcnJvciA9PiB7XHJcbiAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBpbml0aWFsaXplIGNvbnZlcnRlciBmYWN0b3J5OicsIGVycm9yKTtcclxufSk7XHJcblxyXG4vLyBGdW5jdGlvbiB0byBnZXQgY29ycmVjdCBjb252ZXJ0ZXIgcmVnaXN0cnkgcGF0aCB1c2luZyBNb2R1bGVSZXNvbHZlclxyXG5jb25zdCBnZXRDb252ZXJ0ZXJSZWdpc3RyeVBhdGggPSAoKSA9PiB7XHJcbiAgY29uc29sZS5sb2coJ/Cfk4IgR2V0dGluZyBjb252ZXJ0ZXIgcmVnaXN0cnkgcGF0aCB1c2luZyBNb2R1bGVSZXNvbHZlcicpO1xyXG4gIHJldHVybiBNb2R1bGVSZXNvbHZlci5yZXNvbHZlTW9kdWxlUGF0aCgnQ29udmVydGVyUmVnaXN0cnkuanMnLCAnc2VydmljZXMvY29udmVyc2lvbicpO1xyXG59O1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBjb252ZXJ0ZXJzIHVzaW5nIE1vZHVsZVJlc29sdmVyXHJcbihmdW5jdGlvbigpIHtcclxuICB0cnkge1xyXG4gICAgY29uc29sZS5sb2coJ/CflIQgW1ZFUkJPU0VdIFN0YXJ0aW5nIGNvbnZlcnRlcnMgaW5pdGlhbGl6YXRpb24nKTtcclxuICAgIGNvbnNvbGUudGltZSgn8J+VkiBbVkVSQk9TRV0gQ29udmVydGVycyBpbml0aWFsaXphdGlvbiB0aW1lJyk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBVc2luZyBNb2R1bGVSZXNvbHZlciB0byBmaW5kIENvbnZlcnRlclJlZ2lzdHJ5LmpzJyk7XHJcbiAgICBjb25zdCBjb252ZXJ0ZXJSZWdpc3RyeVBhdGggPSBnZXRDb252ZXJ0ZXJSZWdpc3RyeVBhdGgoKTtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBMb2FkaW5nIGNvbnZlcnRlciByZWdpc3RyeSBmcm9tIHBhdGg6JywgY29udmVydGVyUmVnaXN0cnlQYXRoKTtcclxuICAgIFxyXG4gICAgLy8gTG9nIGVudmlyb25tZW50IGRldGFpbHNcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBFbnZpcm9ubWVudCBkZXRhaWxzOicsIHtcclxuICAgICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICd1bmtub3duJyxcclxuICAgICAgYXBwUGF0aDogYXBwLmdldEFwcFBhdGgoKSxcclxuICAgICAgY3VycmVudERpcjogX19kaXJuYW1lLFxyXG4gICAgICBpc1BhY2thZ2VkOiBhcHAuaXNQYWNrYWdlZFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIENoZWNrIGlmIHRoZSBmaWxlIGV4aXN0c1xyXG4gICAgY29uc3QgZmlsZUV4aXN0cyA9IGZzLmV4aXN0c1N5bmMoY29udmVydGVyUmVnaXN0cnlQYXRoKTtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBSZWdpc3RyeSBmaWxlIGV4aXN0cyBjaGVjazonLCBmaWxlRXhpc3RzKTtcclxuICAgIFxyXG4gICAgaWYgKCFmaWxlRXhpc3RzKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gUmVnaXN0cnkgZmlsZSBkb2VzIG5vdCBleGlzdCBhdCBwYXRoOicsIGNvbnZlcnRlclJlZ2lzdHJ5UGF0aCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5OCIFtWRVJCT1NFXSBEaXJlY3RvcnkgY29udGVudHM6Jywge1xyXG4gICAgICAgIGRpcm5hbWU6IGZzLmV4aXN0c1N5bmMoX19kaXJuYW1lKSA/IGZzLnJlYWRkaXJTeW5jKF9fZGlybmFtZSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgYXBwUGF0aDogZnMuZXhpc3RzU3luYyhhcHAuZ2V0QXBwUGF0aCgpKSA/IGZzLnJlYWRkaXJTeW5jKGFwcC5nZXRBcHBQYXRoKCkpIDogJ2RpcmVjdG9yeSBub3QgZm91bmQnLFxyXG4gICAgICAgIHNlcnZpY2VzOiBmcy5leGlzdHNTeW5jKHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicpKSA/XHJcbiAgICAgICAgICBmcy5yZWFkZGlyU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nKSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgY29udmVyc2lvbjogZnMuZXhpc3RzU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnY29udmVyc2lvbicpKSA/XHJcbiAgICAgICAgICBmcy5yZWFkZGlyU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnY29udmVyc2lvbicpKSA6ICdkaXJlY3Rvcnkgbm90IGZvdW5kJyxcclxuICAgICAgICBkYXRhOiBmcy5leGlzdHNTeW5jKHBhdGguam9pbihfX2Rpcm5hbWUsICdjb252ZXJzaW9uL2RhdGEnKSkgP1xyXG4gICAgICAgICAgZnMucmVhZGRpclN5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJ2NvbnZlcnNpb24vZGF0YScpKSA6ICdkaXJlY3Rvcnkgbm90IGZvdW5kJ1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gVXNlIE1vZHVsZVJlc29sdmVyIHRvIHNhZmVseSByZXF1aXJlIHRoZSBjb252ZXJ0ZXIgcmVnaXN0cnlcclxuICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBVc2luZyBNb2R1bGVSZXNvbHZlci5zYWZlUmVxdWlyZSBmb3IgQ29udmVydGVyUmVnaXN0cnknKTtcclxuICAgIFxyXG4gICAgbGV0IGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlO1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVXNlIG91ciBNb2R1bGVSZXNvbHZlciB0byBsb2FkIHRoZSBtb2R1bGVcclxuICAgICAgY29udmVydGVyUmVnaXN0cnlNb2R1bGUgPSBNb2R1bGVSZXNvbHZlci5zYWZlUmVxdWlyZSgnQ29udmVydGVyUmVnaXN0cnkuanMnLCAnc2VydmljZXMvY29udmVyc2lvbicpO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+TpiBbVkVSQk9TRV0gTW9kdWxlUmVzb2x2ZXIgc3VjY2Vzc2Z1bC4gTW9kdWxlIHN0cnVjdHVyZTonLCB7XHJcbiAgICAgICAga2V5czogT2JqZWN0LmtleXMoY29udmVydGVyUmVnaXN0cnlNb2R1bGUpLFxyXG4gICAgICAgIGhhc0NvbnZlcnRlclJlZ2lzdHJ5OiAnQ29udmVydGVyUmVnaXN0cnknIGluIGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlLFxyXG4gICAgICAgIGhhc0RlZmF1bHRFeHBvcnQ6ICdkZWZhdWx0JyBpbiBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSxcclxuICAgICAgICBleHBvcnRUeXBlczogT2JqZWN0LmVudHJpZXMoY29udmVydGVyUmVnaXN0cnlNb2R1bGUpLm1hcCgoW2tleSwgdmFsdWVdKSA9PlxyXG4gICAgICAgICAgYCR7a2V5fTogJHt0eXBlb2YgdmFsdWV9JHt2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnID8gYCB3aXRoIGtleXMgWyR7T2JqZWN0LmtleXModmFsdWUpLmpvaW4oJywgJyl9XWAgOiAnJ31gXHJcbiAgICAgICAgKVxyXG4gICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gTW9kdWxlIGxvYWRpbmcgZmFpbGVkIHdpdGggZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gRXJyb3IgZGV0YWlsczonLCB7XHJcbiAgICAgICAgbmFtZTogZXJyb3IubmFtZSxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcclxuICAgICAgICBjb2RlOiBlcnJvci5jb2RlLFxyXG4gICAgICAgIHBhdGg6IGNvbnZlcnRlclJlZ2lzdHJ5UGF0aFxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIFRyeSBmYWxsYmFjayB0byBkaXJlY3QgcmVxdWlyZSBhcyBhIGxhc3QgcmVzb3J0XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ/CflIQgW1ZFUkJPU0VdIFRyeWluZyBkaXJlY3QgcmVxdWlyZSBhcyBmYWxsYmFjaycpO1xyXG4gICAgICAgIGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlID0gcmVxdWlyZShjb252ZXJ0ZXJSZWdpc3RyeVBhdGgpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgW1ZFUkJPU0VdIERpcmVjdCByZXF1aXJlIHN1Y2Nlc3NmdWwnKTtcclxuICAgICAgfSBjYXRjaCAoZGlyZWN0RXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIEFsbCBtb2R1bGUgbG9hZGluZyBhdHRlbXB0cyBmYWlsZWQ6JywgZGlyZWN0RXJyb3IubWVzc2FnZSk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgbG9hZCBDb252ZXJ0ZXJSZWdpc3RyeTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGNvbnN0IGNvbnZlcnRlclJlZ2lzdHJ5ID0gY29udmVydGVyUmVnaXN0cnlNb2R1bGUuQ29udmVydGVyUmVnaXN0cnkgfHwgY29udmVydGVyUmVnaXN0cnlNb2R1bGUuZGVmYXVsdCB8fCBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZTtcclxuICAgIFxyXG4gICAgLy8gTG9nIGRldGFpbGVkIGluZm9ybWF0aW9uIGFib3V0IHRoZSBjb252ZXJ0ZXIgcmVnaXN0cnlcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBDb252ZXJ0ZXIgcmVnaXN0cnkgc3RydWN0dXJlOicsIHtcclxuICAgICAgaGFzQ29udmVydGVyczogISEoY29udmVydGVyUmVnaXN0cnkgJiYgY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycyksXHJcbiAgICAgIGhhc0NvbnZlcnRUb01hcmtkb3duOiB0eXBlb2YgY29udmVydGVyUmVnaXN0cnk/LmNvbnZlcnRUb01hcmtkb3duID09PSAnZnVuY3Rpb24nLFxyXG4gICAgICBoYXNHZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbjogdHlwZW9mIGNvbnZlcnRlclJlZ2lzdHJ5Py5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiA9PT0gJ2Z1bmN0aW9uJyxcclxuICAgICAgaGFzR2V0Q29udmVydGVyQnlNaW1lVHlwZTogdHlwZW9mIGNvbnZlcnRlclJlZ2lzdHJ5Py5nZXRDb252ZXJ0ZXJCeU1pbWVUeXBlID09PSAnZnVuY3Rpb24nLFxyXG4gICAgICBhdmFpbGFibGVDb252ZXJ0ZXJzOiBjb252ZXJ0ZXJSZWdpc3RyeSAmJiBjb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzID9cclxuICAgICAgICBPYmplY3Qua2V5cyhjb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzKSA6ICdub25lJ1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIFJlZ2lzdGVyIHRoZSBjb252ZXJ0ZXIgZmFjdG9yeVxyXG4gICAgcmVnaXN0ZXJDb252ZXJ0ZXJGYWN0b3J5KCdjb252ZXJ0ZXJSZWdpc3RyeScsIGNvbnZlcnRlclJlZ2lzdHJ5KTtcclxuICAgIFxyXG4gICAgY29uc29sZS50aW1lRW5kKCfwn5WSIFtWRVJCT1NFXSBDb252ZXJ0ZXJzIGluaXRpYWxpemF0aW9uIHRpbWUnKTtcclxuICAgIGNvbnNvbGUubG9nKCfinIUgW1ZFUkJPU0VdIENvbnZlcnRlcnMgcmVnaXN0ZXJlZCBzdWNjZXNzZnVsbHknKTtcclxuICAgIFxyXG4gICAgLy8gU3RvcmUgaW4gZ2xvYmFsIGZvciBlcnJvciBjaGVja2luZ1xyXG4gICAgZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5ID0gY29udmVydGVyUmVnaXN0cnk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUudGltZUVuZCgn8J+VkiBbVkVSQk9TRV0gQ29udmVydGVycyBpbml0aWFsaXphdGlvbiB0aW1lJyk7XHJcbiAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIEZhaWxlZCB0byByZWdpc3RlciBjb252ZXJ0ZXJzOicsIGVycm9yKTtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gRXJyb3IgZGV0YWlsczonLCBlcnJvci5zdGFjayk7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gRXJyb3Igb2JqZWN0OicsIHtcclxuICAgICAgbmFtZTogZXJyb3IubmFtZSxcclxuICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcclxuICAgICAgY29kZTogZXJyb3IuY29kZSxcclxuICAgICAgdHlwZTogdHlwZW9mIGVycm9yLFxyXG4gICAgICBoYXNTdGFjazogISFlcnJvci5zdGFja1xyXG4gICAgfSk7XHJcbiAgfVxyXG59KSgpO1xyXG5cclxuY2xhc3MgRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZSB7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmZpbGVTeXN0ZW0gPSBGaWxlU3lzdGVtU2VydmljZTtcclxuICAgIHRoaXMucmVzdWx0TWFuYWdlciA9IENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyO1xyXG4gICAgdGhpcy5wcm9ncmVzc1VwZGF0ZUludGVydmFsID0gMjUwOyAvLyBVcGRhdGUgcHJvZ3Jlc3MgZXZlcnkgMjUwbXNcclxuICAgIHRoaXMuZGVmYXVsdE91dHB1dERpciA9IHBhdGguam9pbihhcHAuZ2V0UGF0aCgndXNlckRhdGEnKSwgJ2NvbnZlcnNpb25zJyk7XHJcbiAgICBjb25zb2xlLmxvZygnRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZSBpbml0aWFsaXplZCB3aXRoIGRlZmF1bHQgb3V0cHV0IGRpcmVjdG9yeTonLCB0aGlzLmRlZmF1bHRPdXRwdXREaXIpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ29udmVydHMgYSBmaWxlIHRvIG1hcmtkb3duIGZvcm1hdFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfEJ1ZmZlcn0gZmlsZVBhdGggLSBQYXRoIHRvIHRoZSBmaWxlIG9yIGZpbGUgY29udGVudCBhcyBidWZmZXJcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IC0gQ29udmVyc2lvbiByZXN1bHRcclxuICAgKi9cclxuICBhc3luYyBjb252ZXJ0KGZpbGVQYXRoLCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmNvbnZlcnQgY2FsbGVkJyk7XHJcbiAgICAvLyBVc2UgYSB1bmlxdWUgbGFiZWwgZm9yIGVhY2ggY29udmVyc2lvbiB0byBhdm9pZCBkdXBsaWNhdGUgbGFiZWwgd2FybmluZ3NcclxuICAgIGNvbnN0IHRpbWVMYWJlbCA9IGDwn5WSIFtWRVJCT1NFXSBUb3RhbCBjb252ZXJzaW9uIHRpbWUgJHtEYXRlLm5vdygpfWA7XHJcbiAgICBjb25zb2xlLnRpbWUodGltZUxhYmVsKTtcclxuICAgIGNvbnNvbGUudHJhY2UoJ/CflIQgW1ZFUkJPU0VdIENvbnZlcnQgbWV0aG9kIHN0YWNrIHRyYWNlJyk7XHJcbiAgICBcclxuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFZhbGlkYXRlIG91dHB1dCBkaXJlY3RvcnlcclxuICAgICAgaWYgKCFvcHRpb25zLm91dHB1dERpcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gTm8gb3V0cHV0IGRpcmVjdG9yeSBwcm92aWRlZCEnKTtcclxuICAgICAgICBjb25zb2xlLnRpbWVFbmQodGltZUxhYmVsKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ091dHB1dCBkaXJlY3RvcnkgaXMgcmVxdWlyZWQgZm9yIGNvbnZlcnNpb24nKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coJ/Cfk6UgW1ZFUkJPU0VdIFJlY2VpdmVkIGNvbnZlcnNpb24gcmVxdWVzdDonLCB7XHJcbiAgICAgICAgaW5wdXRUeXBlOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpID8gJ0J1ZmZlcicgOiB0eXBlb2YgZmlsZVBhdGgsXHJcbiAgICAgICAgaW5wdXRMZW5ndGg6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCkgPyBmaWxlUGF0aC5sZW5ndGggOiB1bmRlZmluZWQsXHJcbiAgICAgICAgZmlsZVR5cGU6IG9wdGlvbnMuZmlsZVR5cGUsIC8vIExvZyB0aGUgZmlsZVR5cGUgd2UgcmVjZWl2ZWQgZnJvbSBmcm9udGVuZFxyXG4gICAgICAgIGhhc0J1ZmZlckluT3B0aW9uczogISFvcHRpb25zLmJ1ZmZlcixcclxuICAgICAgICBidWZmZXJMZW5ndGg6IG9wdGlvbnMuYnVmZmVyID8gb3B0aW9ucy5idWZmZXIubGVuZ3RoIDogdW5kZWZpbmVkLFxyXG4gICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICBidWZmZXI6IG9wdGlvbnMuYnVmZmVyID8gYEJ1ZmZlcigke29wdGlvbnMuYnVmZmVyLmxlbmd0aH0pYCA6IHVuZGVmaW5lZCxcclxuICAgICAgICAgIGFwaUtleTogb3B0aW9ucy5hcGlLZXkgPyAn4pyTJyA6ICfinJcnLFxyXG4gICAgICAgICAgbWlzdHJhbEFwaUtleTogb3B0aW9ucy5taXN0cmFsQXBpS2V5ID8gJ+KckycgOiAn4pyXJ1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gQ29udmVyc2lvbiBlbnZpcm9ubWVudDonLCB7XHJcbiAgICAgICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICd1bmtub3duJyxcclxuICAgICAgICBpc1BhY2thZ2VkOiBhcHAuaXNQYWNrYWdlZCxcclxuICAgICAgICBhcHBQYXRoOiBhcHAuZ2V0QXBwUGF0aCgpLFxyXG4gICAgICAgIGNvbnZlcnRlclJlZ2lzdHJ5TG9hZGVkOiAhIWdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSxcclxuICAgICAgICB1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZDogISF1bmlmaWVkQ29udmVydGVyRmFjdG9yeSxcclxuICAgICAgICBoYXNDb252ZXJ0RmlsZTogdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPyB0eXBlb2YgdW5pZmllZENvbnZlcnRlckZhY3RvcnkuY29udmVydEZpbGUgPT09ICdmdW5jdGlvbicgOiBmYWxzZVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIElmIHdlIGhhdmUgYSBidWZmZXIgaW4gb3B0aW9ucywgdXNlIHRoYXQgaW5zdGVhZCBvZiB0aGUgaW5wdXRcclxuICAgICAgaWYgKG9wdGlvbnMuYnVmZmVyICYmIEJ1ZmZlci5pc0J1ZmZlcihvcHRpb25zLmJ1ZmZlcikpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+TpiBVc2luZyBidWZmZXIgZnJvbSBvcHRpb25zIGluc3RlYWQgb2YgaW5wdXQnKTtcclxuICAgICAgICBmaWxlUGF0aCA9IG9wdGlvbnMuYnVmZmVyO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDcmVhdGUgYSBwcm9ncmVzcyB0cmFja2VyXHJcbiAgICAgIGNvbnN0IHByb2dyZXNzVHJhY2tlciA9IG5ldyBQcm9ncmVzc1RyYWNrZXIob3B0aW9ucy5vblByb2dyZXNzLCB0aGlzLnByb2dyZXNzVXBkYXRlSW50ZXJ2YWwpO1xyXG4gICAgICBcclxuICAgICAgLy8gVXNlIHRoZSBmaWxlVHlwZSBwcm92aWRlZCBieSB0aGUgZnJvbnRlbmQgLSBubyByZWRldGVybWluYXRpb25cclxuICAgICAgY29uc3QgZmlsZVR5cGUgPSBvcHRpb25zLmZpbGVUeXBlO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coJ/CflIQgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIFByb2Nlc3Npbmc6Jywge1xyXG4gICAgICAgIHR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIGlzQnVmZmVyOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpLFxyXG4gICAgICAgIGlzVGVtcG9yYXJ5OiBvcHRpb25zLmlzVGVtcG9yYXJ5LFxyXG4gICAgICAgIGlzVXJsOiBvcHRpb25zLnR5cGUgPT09ICd1cmwnIHx8IG9wdGlvbnMudHlwZSA9PT0gJ3BhcmVudHVybCcsXHJcbiAgICAgICAgaXNQYXJlbnRVcmw6IG9wdGlvbnMudHlwZSA9PT0gJ3BhcmVudHVybCdcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBEZWxlZ2F0ZSB0byBVbmlmaWVkQ29udmVydGVyRmFjdG9yeSB3aXRoIHRoZSBmaWxlVHlwZSBmcm9tIGZyb250ZW5kXHJcbiAgICAgIGNvbnN0IGNvbnZlcnNpb25SZXN1bHQgPSBhd2FpdCB1bmlmaWVkQ29udmVydGVyRmFjdG9yeS5jb252ZXJ0RmlsZShmaWxlUGF0aCwge1xyXG4gICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgZmlsZVR5cGUsXHJcbiAgICAgICAgcHJvZ3Jlc3NUcmFja2VyXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgaWYgKCFjb252ZXJzaW9uUmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoY29udmVyc2lvblJlc3VsdC5lcnJvciB8fCAnQ29udmVyc2lvbiBmYWlsZWQnKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gRXh0cmFjdCBjb250ZW50IGZyb20gcmVzdWx0XHJcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBjb252ZXJzaW9uUmVzdWx0LmNvbnRlbnQgfHwgJyc7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoIWNvbnRlbnQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudCcpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBVc2UgY2F0ZWdvcnkgZnJvbSBmcm9udGVuZCBpZiBhdmFpbGFibGVcclxuICAgICAgY29uc3QgZmlsZUNhdGVnb3J5ID0gb3B0aW9ucy5jYXRlZ29yeSB8fCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25SZXN1bHQuY2F0ZWdvcnkgfHwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAndGV4dCc7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBpZiB0aGUgY29udmVyc2lvbiByZXN1bHQgaGFzIG11bHRpcGxlIGZpbGVzIChmb3IgcGFyZW50dXJsKVxyXG4gICAgICBjb25zdCBoYXNNdWx0aXBsZUZpbGVzID0gQXJyYXkuaXNBcnJheShjb252ZXJzaW9uUmVzdWx0LmZpbGVzKSAmJiBjb252ZXJzaW9uUmVzdWx0LmZpbGVzLmxlbmd0aCA+IDA7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoaGFzTXVsdGlwbGVGaWxlcykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OBIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBDb252ZXJzaW9uIHJlc3VsdCBoYXMgJHtjb252ZXJzaW9uUmVzdWx0LmZpbGVzLmxlbmd0aH0gZmlsZXNgKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gU2F2ZSB0aGUgY29udmVyc2lvbiByZXN1bHQgdXNpbmcgdGhlIENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXHJcbiAgICAgIC8vIEVuc3VyZSB3ZSdyZSBjb25zaXN0ZW50bHkgdXNpbmcgdGhlIG9yaWdpbmFsIGZpbGVuYW1lXHJcbiAgICAgIC8vIFByaW9yaXR5OiBjb252ZXJ0ZXIncyBtZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lID4gY29udmVyc2lvblJlc3VsdCBmaWVsZHMgPiBvcHRpb25zIGZpZWxkc1xyXG4gICAgICBjb25zdCBvcmlnaW5hbEZpbGVOYW1lID0gKGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEgJiYgY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lKSB8fFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb252ZXJzaW9uUmVzdWx0Lm9yaWdpbmFsRmlsZU5hbWUgfHxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvblJlc3VsdC5uYW1lIHx8XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zLm5hbWU7XHJcblxyXG4gICAgICAvLyBBZGQgZW5oYW5jZWQgbG9nZ2luZyBmb3IgWExTWC9DU1YgZmlsZXMgdG8gdHJhY2sgZmlsZW5hbWUgaGFuZGxpbmdcclxuICAgICAgaWYgKGZpbGVUeXBlID09PSAneGxzeCcgfHwgZmlsZVR5cGUgPT09ICdjc3YnKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4ogW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIEV4Y2VsL0NTViBvcmlnaW5hbEZpbGVOYW1lIHJlc29sdXRpb246YCwge1xyXG4gICAgICAgICAgZnJvbU1ldGFkYXRhOiBjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhICYmIGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICAgIGZyb21SZXN1bHQ6IGNvbnZlcnNpb25SZXN1bHQub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICAgIGZyb21SZXN1bHROYW1lOiBjb252ZXJzaW9uUmVzdWx0Lm5hbWUsXHJcbiAgICAgICAgICBmcm9tT3B0aW9uczogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICAgICAgZnJvbU9wdGlvbnNOYW1lOiBvcHRpb25zLm5hbWUsXHJcbiAgICAgICAgICByZXNvbHZlZDogb3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICAgIG1ldGFkYXRhS2V5czogY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSA/IE9iamVjdC5rZXlzKGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEpIDogW10sXHJcbiAgICAgICAgICByZXN1bHRLZXlzOiBPYmplY3Qua2V5cyhjb252ZXJzaW9uUmVzdWx0KVxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TpiBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gVXNpbmcgZmlsZW5hbWUgZm9yIHJlc3VsdDogJHtvcmlnaW5hbEZpbGVOYW1lfWApO1xyXG5cclxuICAgICAgLy8gTG9nIG1ldGFkYXRhIGZyb20gdGhlIGNvbnZlcnNpb24gcmVzdWx0IGZvciBkZWJ1Z2dpbmdcclxuICAgICAgaWYgKGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+UjSBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gQ29udmVyc2lvbiByZXN1bHQgbWV0YWRhdGE6YCwge1xyXG4gICAgICAgICAga2V5czogT2JqZWN0LmtleXMoY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSksXHJcbiAgICAgICAgICBoYXNPcmlnaW5hbEZpbGVOYW1lOiAnb3JpZ2luYWxGaWxlTmFtZScgaW4gY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSxcclxuICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBGb3IgWExTWCBhbmQgQ1NWIGZpbGVzLCBzcGVjaWZpY2FsbHkgZW5zdXJlIHRoZSBtZXRhZGF0YSBjb250YWlucyB0aGUgb3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgICBsZXQgZW5oYW5jZWRNZXRhZGF0YSA9IHtcclxuICAgICAgICAuLi4oY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSB8fCB7fSksXHJcbiAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogb3JpZ2luYWxGaWxlTmFtZSAvLyBFbnN1cmUgb3JpZ2luYWwgZmlsZW5hbWUgaXMgaW4gbWV0YWRhdGFcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIEZvciBYTFNYL0NTViBmaWxlcywgZG91YmxlLWNoZWNrIHRoZSBtZXRhZGF0YSBzdHJ1Y3R1cmVcclxuICAgICAgaWYgKGZpbGVUeXBlID09PSAneGxzeCcgfHwgZmlsZVR5cGUgPT09ICdjc3YnKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4ogW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIEVuaGFuY2VkIG1ldGFkYXRhIGZvciAke2ZpbGVUeXBlfTpgLCBlbmhhbmNlZE1ldGFkYXRhKTtcclxuXHJcbiAgICAgICAgLy8gTG9nIGFkZGl0aW9uYWwgZGVidWdnaW5nIGluZm9cclxuICAgICAgICBpZiAoIWVuaGFuY2VkTWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSkge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIG9yaWdpbmFsRmlsZU5hbWUgbWlzc2luZyBpbiBtZXRhZGF0YSBldmVuIGFmdGVyIHNldHRpbmcgaXQhYCk7XHJcbiAgICAgICAgICAvLyBGb3JjZSBzZXQgaXQgYXMgYSBsYXN0IHJlc29ydFxyXG4gICAgICAgICAgZW5oYW5jZWRNZXRhZGF0YSA9IHsgLi4uZW5oYW5jZWRNZXRhZGF0YSwgb3JpZ2luYWxGaWxlTmFtZSB9O1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5yZXN1bHRNYW5hZ2VyLnNhdmVDb252ZXJzaW9uUmVzdWx0KHtcclxuICAgICAgICBjb250ZW50OiBjb250ZW50LFxyXG4gICAgICAgIG1ldGFkYXRhOiBlbmhhbmNlZE1ldGFkYXRhLCAvLyBVc2Ugb3VyIGVuaGFuY2VkIG1ldGFkYXRhXHJcbiAgICAgICAgaW1hZ2VzOiBjb252ZXJzaW9uUmVzdWx0LmltYWdlcyB8fCBbXSxcclxuICAgICAgICBmaWxlczogY29udmVyc2lvblJlc3VsdC5maWxlcyxcclxuICAgICAgICBuYW1lOiBvcmlnaW5hbEZpbGVOYW1lLCAvLyBVc2UgdGhlIG9yaWdpbmFsIGZpbGVuYW1lIGNvbnNpc3RlbnRseVxyXG4gICAgICAgIHR5cGU6IGNvbnZlcnNpb25SZXN1bHQudHlwZSB8fCBmaWxlVHlwZSxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUsIC8vIEFsd2F5cyB1c2UgdGhlIGZpbGVUeXBlIGZyb20gZnJvbnRlbmRcclxuICAgICAgICBvdXRwdXREaXI6IG9wdGlvbnMub3V0cHV0RGlyLFxyXG4gICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcmlnaW5hbEZpbGVOYW1lLCAvLyBBZGQgaXQgdG8gb3B0aW9ucyB0b29cclxuICAgICAgICAgIGNhdGVnb3J5OiBmaWxlQ2F0ZWdvcnksXHJcbiAgICAgICAgICBwYWdlQ291bnQ6IGNvbnZlcnNpb25SZXN1bHQucGFnZUNvdW50LFxyXG4gICAgICAgICAgc2xpZGVDb3VudDogY29udmVyc2lvblJlc3VsdC5zbGlkZUNvdW50LFxyXG4gICAgICAgICAgaGFzTXVsdGlwbGVGaWxlc1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhg4pyFIEZpbGUgY29udmVyc2lvbiBjb21wbGV0ZWQgaW4gJHtEYXRlLm5vdygpIC0gc3RhcnRUaW1lfW1zOmAsIHtcclxuICAgICAgICBmaWxlOiBmaWxlUGF0aCxcclxuICAgICAgICBvdXRwdXRQYXRoOiByZXN1bHQub3V0cHV0UGF0aFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIEVuZCB0aW1lciBmb3Igc3VjY2Vzc2Z1bCBjb252ZXJzaW9uXHJcbiAgICAgIGNvbnNvbGUudGltZUVuZCh0aW1lTGFiZWwpO1xyXG5cclxuICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLnRpbWVFbmQodGltZUxhYmVsKTtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBDb252ZXJzaW9uIGVycm9yIGNhdWdodCBpbiBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmNvbnZlcnQnKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEFsd2F5cyBpbmNsdWRlIGZpbGVUeXBlIGluIGVycm9yIHJlc3VsdHNcclxuICAgICAgY29uc3QgZmlsZVR5cGUgPSBvcHRpb25zLmZpbGVUeXBlIHx8ICd1bmtub3duJztcclxuICAgICAgXHJcbiAgICAgIC8vIERldGFpbGVkIGVycm9yIGxvZ2dpbmdcclxuICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIEVycm9yIGRldGFpbHM6Jywge1xyXG4gICAgICAgIG5hbWU6IGVycm9yLm5hbWUsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcclxuICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXHJcbiAgICAgICAgY29kZTogZXJyb3IuY29kZSxcclxuICAgICAgICB0eXBlOiB0eXBlb2YgZXJyb3JcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBjb252ZXJ0ZXIgcmVnaXN0cnkgc3RhdGVcclxuICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIENvbnZlcnRlciByZWdpc3RyeSBzdGF0ZSBhdCBlcnJvciB0aW1lOicsIHtcclxuICAgICAgICBjb252ZXJ0ZXJSZWdpc3RyeUxvYWRlZDogISFnbG9iYWwuY29udmVydGVyUmVnaXN0cnksXHJcbiAgICAgICAgaGFzQ29udmVydGVyczogISEoZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5ICYmIGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzKSxcclxuICAgICAgICBhdmFpbGFibGVDb252ZXJ0ZXJzOiBnbG9iYWwuY29udmVydGVyUmVnaXN0cnkgJiYgZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5LmNvbnZlcnRlcnMgPyBcclxuICAgICAgICAgIE9iamVjdC5rZXlzKGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzKSA6ICdub25lJyxcclxuICAgICAgICB1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZDogISF1bmlmaWVkQ29udmVydGVyRmFjdG9yeSxcclxuICAgICAgICBoYXNDb252ZXJ0RmlsZTogdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPyB0eXBlb2YgdW5pZmllZENvbnZlcnRlckZhY3RvcnkuY29udmVydEZpbGUgPT09ICdmdW5jdGlvbicgOiBmYWxzZVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGVycm9ySW5mbyA9IHtcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUsIC8vIEFsd2F5cyBpbmNsdWRlIGZpbGVUeXBlXHJcbiAgICAgICAgdHlwZTogb3B0aW9ucy50eXBlLFxyXG4gICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICBpc0J1ZmZlcjogQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSxcclxuICAgICAgICBidWZmZXJMZW5ndGg6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCkgPyBmaWxlUGF0aC5sZW5ndGggOiB1bmRlZmluZWQsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxyXG4gICAgICAgIGNvbnZlcnRlcnNMb2FkZWQ6ICEhZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5IC8vIENoZWNrIGlmIGNvbnZlcnRlcnMgd2VyZSBsb2FkZWRcclxuICAgICAgfTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gQ29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3JJbmZvKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENvbnN0cnVjdCBhIHVzZXItZnJpZW5kbHkgZXJyb3IgbWVzc2FnZVxyXG4gICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpIFxyXG4gICAgICAgID8gYEZhaWxlZCB0byBjb252ZXJ0ICR7b3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8ICdmaWxlJ306ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgICAgOiBgRmFpbGVkIHRvIGNvbnZlcnQgJHtmaWxlUGF0aH06ICR7ZXJyb3IubWVzc2FnZX1gO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICAgIGRldGFpbHM6IGVycm9ySW5mbyxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUgLy8gRXhwbGljaXRseSBpbmNsdWRlIGZpbGVUeXBlIGluIGVycm9yIHJlc3VsdFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2V0cyB1cCB0aGUgb3V0cHV0IGRpcmVjdG9yeSBmb3IgY29udmVyc2lvbnNcclxuICAgKi9cclxuICBhc3luYyBzZXR1cE91dHB1dERpcmVjdG9yeShvdXRwdXREaXIpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGRpclRvU2V0dXAgPSBvdXRwdXREaXIgfHwgdGhpcy5kZWZhdWx0T3V0cHV0RGlyO1xyXG4gICAgICBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0uY3JlYXRlRGlyZWN0b3J5KGRpclRvU2V0dXApO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+TgSBPdXRwdXQgZGlyZWN0b3J5IHJlYWR5OicsIGRpclRvU2V0dXApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBzZXQgdXAgb3V0cHV0IGRpcmVjdG9yeTonLCBlcnJvcik7XHJcbiAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBuZXcgRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZSgpOyJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTTtFQUFFQztBQUFJLENBQUMsR0FBR0QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUNuQyxNQUFNO0VBQUVFO0FBQVUsQ0FBQyxHQUFHRixPQUFPLENBQUMsZ0JBQWdCLENBQUM7QUFDL0MsTUFBTTtFQUFFRztBQUFVLENBQUMsR0FBR0gsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUNyQyxNQUFNSSxFQUFFLEdBQUdKLE9BQU8sQ0FBQyxJQUFJLENBQUM7QUFDeEIsTUFBTUssYUFBYSxHQUFHRixTQUFTLENBQUNDLEVBQUUsQ0FBQ0UsUUFBUSxDQUFDO0FBQzVDLE1BQU07RUFBRUMsUUFBUSxFQUFFQztBQUFrQixDQUFDLEdBQUdSLE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUM7QUFDeEUsTUFBTVMsdUJBQXVCLEdBQUdULE9BQU8sQ0FBQywyQkFBMkIsQ0FBQztBQUNwRTtBQUNBLE1BQU07RUFDSlUsV0FBVztFQUNYQyxtQkFBbUI7RUFDbkJDLGNBQWM7RUFDZEM7QUFDRixDQUFDLEdBQUdiLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQztBQUM3QixNQUFNO0VBQ0pjLGVBQWU7RUFDZkMsaUJBQWlCO0VBQ2pCQyxpQkFBaUI7RUFDakJDO0FB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