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
    console.time('🕒 [VERBOSE] Total conversion time');
    console.trace('🔄 [VERBOSE] Convert method stack trace');
    const startTime = Date.now();
    try {
      // Validate output directory
      if (!options.outputDir) {
        console.error('❌ [VERBOSE] No output directory provided!');
        console.timeEnd('🕒 [VERBOSE] Total conversion time');
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
      const result = await this.resultManager.saveConversionResult({
        content: content,
        metadata: conversionResult.metadata || {},
        images: conversionResult.images || [],
        files: conversionResult.files,
        name: conversionResult.name || options.originalFileName || options.name,
        type: conversionResult.type || fileType,
        fileType: fileType,
        // Always use the fileType from frontend
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
      console.timeEnd('🕒 [VERBOSE] Total conversion time');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsIlBhdGhVdGlscyIsInByb21pc2lmeSIsImZzIiwicmVhZEZpbGVBc3luYyIsInJlYWRGaWxlIiwiaW5zdGFuY2UiLCJGaWxlU3lzdGVtU2VydmljZSIsIkNvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIiwiZ2V0RmlsZVR5cGUiLCJnZXRGaWxlSGFuZGxpbmdJbmZvIiwiSEFORExJTkdfVFlQRVMiLCJDT05WRVJURVJfQ09ORklHIiwiUHJvZ3Jlc3NUcmFja2VyIiwiY29udmVydFRvTWFya2Rvd24iLCJyZWdpc3RlckNvbnZlcnRlciIsInJlZ2lzdGVyQ29udmVydGVyRmFjdG9yeSIsImNvbnNvbGUiLCJsb2ciLCJoYW5kbGluZ1R5cGVzIiwiZmlsZUNvbmZpZyIsIk1vZHVsZVJlc29sdmVyIiwidW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJpbml0aWFsaXplIiwiY2F0Y2giLCJlcnJvciIsImdldENvbnZlcnRlclJlZ2lzdHJ5UGF0aCIsInJlc29sdmVNb2R1bGVQYXRoIiwidGltZSIsImNvbnZlcnRlclJlZ2lzdHJ5UGF0aCIsImVudmlyb25tZW50IiwicHJvY2VzcyIsImVudiIsIk5PREVfRU5WIiwiYXBwUGF0aCIsImdldEFwcFBhdGgiLCJjdXJyZW50RGlyIiwiX19kaXJuYW1lIiwiaXNQYWNrYWdlZCIsImZpbGVFeGlzdHMiLCJleGlzdHNTeW5jIiwiZGlybmFtZSIsInJlYWRkaXJTeW5jIiwic2VydmljZXMiLCJqb2luIiwiY29udmVyc2lvbiIsImRhdGEiLCJjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSIsInNhZmVSZXF1aXJlIiwia2V5cyIsIk9iamVjdCIsImhhc0NvbnZlcnRlclJlZ2lzdHJ5IiwiaGFzRGVmYXVsdEV4cG9ydCIsImV4cG9ydFR5cGVzIiwiZW50cmllcyIsIm1hcCIsImtleSIsInZhbHVlIiwibmFtZSIsIm1lc3NhZ2UiLCJzdGFjayIsImNvZGUiLCJkaXJlY3RFcnJvciIsIkVycm9yIiwiY29udmVydGVyUmVnaXN0cnkiLCJDb252ZXJ0ZXJSZWdpc3RyeSIsImRlZmF1bHQiLCJoYXNDb252ZXJ0ZXJzIiwiY29udmVydGVycyIsImhhc0NvbnZlcnRUb01hcmtkb3duIiwiaGFzR2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJnZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiIsImhhc0dldENvbnZlcnRlckJ5TWltZVR5cGUiLCJnZXRDb252ZXJ0ZXJCeU1pbWVUeXBlIiwiYXZhaWxhYmxlQ29udmVydGVycyIsInRpbWVFbmQiLCJnbG9iYWwiLCJ0eXBlIiwiaGFzU3RhY2siLCJFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJmaWxlU3lzdGVtIiwicmVzdWx0TWFuYWdlciIsInByb2dyZXNzVXBkYXRlSW50ZXJ2YWwiLCJkZWZhdWx0T3V0cHV0RGlyIiwiZ2V0UGF0aCIsImNvbnZlcnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJ0cmFjZSIsInN0YXJ0VGltZSIsIkRhdGUiLCJub3ciLCJvdXRwdXREaXIiLCJpbnB1dFR5cGUiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImlucHV0TGVuZ3RoIiwibGVuZ3RoIiwidW5kZWZpbmVkIiwiZmlsZVR5cGUiLCJoYXNCdWZmZXJJbk9wdGlvbnMiLCJidWZmZXIiLCJidWZmZXJMZW5ndGgiLCJhcGlLZXkiLCJtaXN0cmFsQXBpS2V5IiwiY29udmVydGVyUmVnaXN0cnlMb2FkZWQiLCJ1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZCIsImhhc0NvbnZlcnRGaWxlIiwiY29udmVydEZpbGUiLCJwcm9ncmVzc1RyYWNrZXIiLCJvblByb2dyZXNzIiwiaXNUZW1wb3JhcnkiLCJpc1VybCIsImlzUGFyZW50VXJsIiwiY29udmVyc2lvblJlc3VsdCIsInN1Y2Nlc3MiLCJjb250ZW50IiwiZmlsZUNhdGVnb3J5IiwiY2F0ZWdvcnkiLCJoYXNNdWx0aXBsZUZpbGVzIiwiQXJyYXkiLCJpc0FycmF5IiwiZmlsZXMiLCJyZXN1bHQiLCJzYXZlQ29udmVyc2lvblJlc3VsdCIsIm1ldGFkYXRhIiwiaW1hZ2VzIiwib3JpZ2luYWxGaWxlTmFtZSIsInBhZ2VDb3VudCIsInNsaWRlQ291bnQiLCJmaWxlIiwib3V0cHV0UGF0aCIsImVycm9ySW5mbyIsImNvbnZlcnRlcnNMb2FkZWQiLCJlcnJvck1lc3NhZ2UiLCJkZXRhaWxzIiwic2V0dXBPdXRwdXREaXJlY3RvcnkiLCJkaXJUb1NldHVwIiwiY3JlYXRlRGlyZWN0b3J5IiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9FbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmpzXHJcbiAqIEhhbmRsZXMgZG9jdW1lbnQgY29udmVyc2lvbiB1c2luZyBuYXRpdmUgZmlsZSBzeXN0ZW0gb3BlcmF0aW9ucyBpbiBFbGVjdHJvbi5cclxuICogQ29vcmRpbmF0ZXMgY29udmVyc2lvbiBwcm9jZXNzZXMgYW5kIGRlbGVnYXRlcyB0byB0aGUgc2hhcmVkIGNvbnZlcnNpb24gdXRpbGl0aWVzLlxyXG4gKlxyXG4gKiBJTVBPUlRBTlQ6IFdoZW4gZGV0ZXJtaW5pbmcgZmlsZSB0eXBlcyBmb3IgY29udmVyc2lvbiwgd2UgZXh0cmFjdCB0aGUgZmlsZSBleHRlbnNpb25cclxuICogZGlyZWN0bHkgcmF0aGVyIHRoYW4gdXNpbmcgdGhlIGNhdGVnb3J5IGZyb20gZ2V0RmlsZVR5cGUuIFRoaXMgZW5zdXJlcyB0aGF0IHdlIHVzZVxyXG4gKiB0aGUgc3BlY2lmaWMgY29udmVydGVyIHJlZ2lzdGVyZWQgZm9yIGVhY2ggZmlsZSB0eXBlIChlLmcuLCAncGRmJywgJ2RvY3gnLCAncHB0eCcpXHJcbiAqIHJhdGhlciB0aGFuIHRyeWluZyB0byB1c2UgYSBjb252ZXJ0ZXIgZm9yIHRoZSBjYXRlZ29yeSAoJ2RvY3VtZW50cycpLlxyXG4gKlxyXG4gKiBTcGVjaWFsIGhhbmRsaW5nIGlzIGltcGxlbWVudGVkIGZvciBkYXRhIGZpbGVzIChDU1YsIFhMU1gpIHRvIGVuc3VyZSB0aGV5IHVzZSB0aGVcclxuICogY29ycmVjdCBjb252ZXJ0ZXIgYmFzZWQgb24gZmlsZSBleHRlbnNpb24uIElmIHRoZSBleHRlbnNpb24gY2FuJ3QgYmUgZGV0ZXJtaW5lZCxcclxuICogd2UgZGVmYXVsdCB0byAnY3N2JyByYXRoZXIgdGhhbiB1c2luZyB0aGUgY2F0ZWdvcnkgJ2RhdGEnLlxyXG4gKlxyXG4gKiBGb3IgQ1NWIGZpbGVzIHNlbnQgYXMgdGV4dCBjb250ZW50LCB3ZSBkZXRlY3QgQ1NWIGNvbnRlbnQgYnkgY2hlY2tpbmcgZm9yIGNvbW1hcywgdGFicyxcclxuICogYW5kIG5ld2xpbmVzLCBhbmQgcHJvY2VzcyBpdCBkaXJlY3RseSByYXRoZXIgdGhhbiB0cmVhdGluZyBpdCBhcyBhIGZpbGUgcGF0aC4gVGhpcyBmaXhlc1xyXG4gKiB0aGUgXCJGaWxlIG5vdCBmb3VuZCBvciBpbmFjY2Vzc2libGVcIiBlcnJvciB0aGF0IG9jY3VycmVkIHdoZW4gdGhlIHN5c3RlbSB0cmllZCB0byBpbnRlcnByZXRcclxuICogQ1NWIGNvbnRlbnQgYXMgYSBmaWxlIHBhdGguXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgeyBhcHAgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbmNvbnN0IHsgUGF0aFV0aWxzIH0gPSByZXF1aXJlKCcuLi91dGlscy9wYXRocycpO1xyXG5jb25zdCB7IHByb21pc2lmeSB9ID0gcmVxdWlyZSgndXRpbCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XHJcbmNvbnN0IHJlYWRGaWxlQXN5bmMgPSBwcm9taXNpZnkoZnMucmVhZEZpbGUpO1xyXG5jb25zdCB7IGluc3RhbmNlOiBGaWxlU3lzdGVtU2VydmljZSB9ID0gcmVxdWlyZSgnLi9GaWxlU3lzdGVtU2VydmljZScpOyAvLyBJbXBvcnQgaW5zdGFuY2VcclxuY29uc3QgQ29udmVyc2lvblJlc3VsdE1hbmFnZXIgPSByZXF1aXJlKCcuL0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyJyk7XHJcbi8vIEltcG9ydCBsb2NhbCB1dGlsaXRpZXNcclxuY29uc3QgeyBcclxuICBnZXRGaWxlVHlwZSxcclxuICBnZXRGaWxlSGFuZGxpbmdJbmZvLFxyXG4gIEhBTkRMSU5HX1RZUEVTLFxyXG4gIENPTlZFUlRFUl9DT05GSUdcclxufSA9IHJlcXVpcmUoJy4uL3V0aWxzL2ZpbGVzJyk7XHJcbmNvbnN0IHsgXHJcbiAgUHJvZ3Jlc3NUcmFja2VyLCBcclxuICBjb252ZXJ0VG9NYXJrZG93biwgXHJcbiAgcmVnaXN0ZXJDb252ZXJ0ZXIsXHJcbiAgcmVnaXN0ZXJDb252ZXJ0ZXJGYWN0b3J5XHJcbn0gPSByZXF1aXJlKCcuLi91dGlscy9jb252ZXJzaW9uJyk7XHJcblxyXG4vLyBMb2cgYXZhaWxhYmxlIGZpbGUgaGFuZGxpbmcgY2FwYWJpbGl0aWVzXHJcbmNvbnNvbGUubG9nKCfwn5OEIEluaXRpYWxpemVkIHdpdGggZmlsZSBoYW5kbGluZzonLCB7XHJcbiAgaGFuZGxpbmdUeXBlczogSEFORExJTkdfVFlQRVMsXHJcbiAgZmlsZUNvbmZpZzogQ09OVkVSVEVSX0NPTkZJR1xyXG59KTtcclxuXHJcbi8vIEltcG9ydCBNb2R1bGVSZXNvbHZlciBhbmQgVW5pZmllZENvbnZlcnRlckZhY3RvcnlcclxuY29uc3QgeyBNb2R1bGVSZXNvbHZlciB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvbW9kdWxlUmVzb2x2ZXInKTtcclxuY29uc3QgdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPSByZXF1aXJlKCcuLi9jb252ZXJ0ZXJzL1VuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5Jyk7XHJcblxyXG4vLyBJbml0aWFsaXplIHRoZSBjb252ZXJ0ZXIgZmFjdG9yeVxyXG51bmlmaWVkQ29udmVydGVyRmFjdG9yeS5pbml0aWFsaXplKCkuY2F0Y2goZXJyb3IgPT4ge1xyXG4gIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBjb252ZXJ0ZXIgZmFjdG9yeTonLCBlcnJvcik7XHJcbn0pO1xyXG5cclxuLy8gRnVuY3Rpb24gdG8gZ2V0IGNvcnJlY3QgY29udmVydGVyIHJlZ2lzdHJ5IHBhdGggdXNpbmcgTW9kdWxlUmVzb2x2ZXJcclxuY29uc3QgZ2V0Q29udmVydGVyUmVnaXN0cnlQYXRoID0gKCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCfwn5OCIEdldHRpbmcgY29udmVydGVyIHJlZ2lzdHJ5IHBhdGggdXNpbmcgTW9kdWxlUmVzb2x2ZXInKTtcclxuICByZXR1cm4gTW9kdWxlUmVzb2x2ZXIucmVzb2x2ZU1vZHVsZVBhdGgoJ0NvbnZlcnRlclJlZ2lzdHJ5LmpzJywgJ3NlcnZpY2VzL2NvbnZlcnNpb24nKTtcclxufTtcclxuXHJcbi8vIEluaXRpYWxpemUgY29udmVydGVycyB1c2luZyBNb2R1bGVSZXNvbHZlclxyXG4oZnVuY3Rpb24oKSB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBTdGFydGluZyBjb252ZXJ0ZXJzIGluaXRpYWxpemF0aW9uJyk7XHJcbiAgICBjb25zb2xlLnRpbWUoJ/CflZIgW1ZFUkJPU0VdIENvbnZlcnRlcnMgaW5pdGlhbGl6YXRpb24gdGltZScpO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZygn8J+UhCBbVkVSQk9TRV0gVXNpbmcgTW9kdWxlUmVzb2x2ZXIgdG8gZmluZCBDb252ZXJ0ZXJSZWdpc3RyeS5qcycpO1xyXG4gICAgY29uc3QgY29udmVydGVyUmVnaXN0cnlQYXRoID0gZ2V0Q29udmVydGVyUmVnaXN0cnlQYXRoKCk7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gTG9hZGluZyBjb252ZXJ0ZXIgcmVnaXN0cnkgZnJvbSBwYXRoOicsIGNvbnZlcnRlclJlZ2lzdHJ5UGF0aCk7XHJcbiAgICBcclxuICAgIC8vIExvZyBlbnZpcm9ubWVudCBkZXRhaWxzXHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gRW52aXJvbm1lbnQgZGV0YWlsczonLCB7XHJcbiAgICAgIGVudmlyb25tZW50OiBwcm9jZXNzLmVudi5OT0RFX0VOViB8fCAndW5rbm93bicsXHJcbiAgICAgIGFwcFBhdGg6IGFwcC5nZXRBcHBQYXRoKCksXHJcbiAgICAgIGN1cnJlbnREaXI6IF9fZGlybmFtZSxcclxuICAgICAgaXNQYWNrYWdlZDogYXBwLmlzUGFja2FnZWRcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBDaGVjayBpZiB0aGUgZmlsZSBleGlzdHNcclxuICAgIGNvbnN0IGZpbGVFeGlzdHMgPSBmcy5leGlzdHNTeW5jKGNvbnZlcnRlclJlZ2lzdHJ5UGF0aCk7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gUmVnaXN0cnkgZmlsZSBleGlzdHMgY2hlY2s6JywgZmlsZUV4aXN0cyk7XHJcbiAgICBcclxuICAgIGlmICghZmlsZUV4aXN0cykge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIFJlZ2lzdHJ5IGZpbGUgZG9lcyBub3QgZXhpc3QgYXQgcGF0aDonLCBjb252ZXJ0ZXJSZWdpc3RyeVBhdGgpO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+TgiBbVkVSQk9TRV0gRGlyZWN0b3J5IGNvbnRlbnRzOicsIHtcclxuICAgICAgICBkaXJuYW1lOiBmcy5leGlzdHNTeW5jKF9fZGlybmFtZSkgPyBmcy5yZWFkZGlyU3luYyhfX2Rpcm5hbWUpIDogJ2RpcmVjdG9yeSBub3QgZm91bmQnLFxyXG4gICAgICAgIGFwcFBhdGg6IGZzLmV4aXN0c1N5bmMoYXBwLmdldEFwcFBhdGgoKSkgPyBmcy5yZWFkZGlyU3luYyhhcHAuZ2V0QXBwUGF0aCgpKSA6ICdkaXJlY3Rvcnkgbm90IGZvdW5kJyxcclxuICAgICAgICBzZXJ2aWNlczogZnMuZXhpc3RzU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nKSkgP1xyXG4gICAgICAgICAgZnMucmVhZGRpclN5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJykpIDogJ2RpcmVjdG9yeSBub3QgZm91bmQnLFxyXG4gICAgICAgIGNvbnZlcnNpb246IGZzLmV4aXN0c1N5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJ2NvbnZlcnNpb24nKSkgP1xyXG4gICAgICAgICAgZnMucmVhZGRpclN5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJ2NvbnZlcnNpb24nKSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgZGF0YTogZnMuZXhpc3RzU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnY29udmVyc2lvbi9kYXRhJykpID9cclxuICAgICAgICAgIGZzLnJlYWRkaXJTeW5jKHBhdGguam9pbihfX2Rpcm5hbWUsICdjb252ZXJzaW9uL2RhdGEnKSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCdcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFVzZSBNb2R1bGVSZXNvbHZlciB0byBzYWZlbHkgcmVxdWlyZSB0aGUgY29udmVydGVyIHJlZ2lzdHJ5XHJcbiAgICBjb25zb2xlLmxvZygn8J+UhCBbVkVSQk9TRV0gVXNpbmcgTW9kdWxlUmVzb2x2ZXIuc2FmZVJlcXVpcmUgZm9yIENvbnZlcnRlclJlZ2lzdHJ5Jyk7XHJcbiAgICBcclxuICAgIGxldCBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZTtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFVzZSBvdXIgTW9kdWxlUmVzb2x2ZXIgdG8gbG9hZCB0aGUgbW9kdWxlXHJcbiAgICAgIGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlID0gTW9kdWxlUmVzb2x2ZXIuc2FmZVJlcXVpcmUoJ0NvbnZlcnRlclJlZ2lzdHJ5LmpzJywgJ3NlcnZpY2VzL2NvbnZlcnNpb24nKTtcclxuICAgICAgY29uc29sZS5sb2coJ/Cfk6YgW1ZFUkJPU0VdIE1vZHVsZVJlc29sdmVyIHN1Y2Nlc3NmdWwuIE1vZHVsZSBzdHJ1Y3R1cmU6Jywge1xyXG4gICAgICAgIGtleXM6IE9iamVjdC5rZXlzKGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlKSxcclxuICAgICAgICBoYXNDb252ZXJ0ZXJSZWdpc3RyeTogJ0NvbnZlcnRlclJlZ2lzdHJ5JyBpbiBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSxcclxuICAgICAgICBoYXNEZWZhdWx0RXhwb3J0OiAnZGVmYXVsdCcgaW4gY29udmVydGVyUmVnaXN0cnlNb2R1bGUsXHJcbiAgICAgICAgZXhwb3J0VHlwZXM6IE9iamVjdC5lbnRyaWVzKGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlKS5tYXAoKFtrZXksIHZhbHVlXSkgPT5cclxuICAgICAgICAgIGAke2tleX06ICR7dHlwZW9mIHZhbHVlfSR7dmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyA/IGAgd2l0aCBrZXlzIFske09iamVjdC5rZXlzKHZhbHVlKS5qb2luKCcsICcpfV1gIDogJyd9YFxyXG4gICAgICAgIClcclxuICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIE1vZHVsZSBsb2FkaW5nIGZhaWxlZCB3aXRoIGVycm9yOicsIGVycm9yKTtcclxuICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIEVycm9yIGRldGFpbHM6Jywge1xyXG4gICAgICAgIG5hbWU6IGVycm9yLm5hbWUsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcclxuICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXHJcbiAgICAgICAgY29kZTogZXJyb3IuY29kZSxcclxuICAgICAgICBwYXRoOiBjb252ZXJ0ZXJSZWdpc3RyeVBhdGhcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBUcnkgZmFsbGJhY2sgdG8gZGlyZWN0IHJlcXVpcmUgYXMgYSBsYXN0IHJlc29ydFxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBUcnlpbmcgZGlyZWN0IHJlcXVpcmUgYXMgZmFsbGJhY2snKTtcclxuICAgICAgICBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSA9IHJlcXVpcmUoY29udmVydGVyUmVnaXN0cnlQYXRoKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIFtWRVJCT1NFXSBEaXJlY3QgcmVxdWlyZSBzdWNjZXNzZnVsJyk7XHJcbiAgICAgIH0gY2F0Y2ggKGRpcmVjdEVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBBbGwgbW9kdWxlIGxvYWRpbmcgYXR0ZW1wdHMgZmFpbGVkOicsIGRpcmVjdEVycm9yLm1lc3NhZ2UpO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IGxvYWQgQ29udmVydGVyUmVnaXN0cnk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICBjb25zdCBjb252ZXJ0ZXJSZWdpc3RyeSA9IGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlLkNvbnZlcnRlclJlZ2lzdHJ5IHx8IGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlLmRlZmF1bHQgfHwgY29udmVydGVyUmVnaXN0cnlNb2R1bGU7XHJcbiAgICBcclxuICAgIC8vIExvZyBkZXRhaWxlZCBpbmZvcm1hdGlvbiBhYm91dCB0aGUgY29udmVydGVyIHJlZ2lzdHJ5XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gQ29udmVydGVyIHJlZ2lzdHJ5IHN0cnVjdHVyZTonLCB7XHJcbiAgICAgIGhhc0NvbnZlcnRlcnM6ICEhKGNvbnZlcnRlclJlZ2lzdHJ5ICYmIGNvbnZlcnRlclJlZ2lzdHJ5LmNvbnZlcnRlcnMpLFxyXG4gICAgICBoYXNDb252ZXJ0VG9NYXJrZG93bjogdHlwZW9mIGNvbnZlcnRlclJlZ2lzdHJ5Py5jb252ZXJ0VG9NYXJrZG93biA9PT0gJ2Z1bmN0aW9uJyxcclxuICAgICAgaGFzR2V0Q29udmVydGVyQnlFeHRlbnNpb246IHR5cGVvZiBjb252ZXJ0ZXJSZWdpc3RyeT8uZ2V0Q29udmVydGVyQnlFeHRlbnNpb24gPT09ICdmdW5jdGlvbicsXHJcbiAgICAgIGhhc0dldENvbnZlcnRlckJ5TWltZVR5cGU6IHR5cGVvZiBjb252ZXJ0ZXJSZWdpc3RyeT8uZ2V0Q29udmVydGVyQnlNaW1lVHlwZSA9PT0gJ2Z1bmN0aW9uJyxcclxuICAgICAgYXZhaWxhYmxlQ29udmVydGVyczogY29udmVydGVyUmVnaXN0cnkgJiYgY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycyA/XHJcbiAgICAgICAgT2JqZWN0LmtleXMoY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycykgOiAnbm9uZSdcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBSZWdpc3RlciB0aGUgY29udmVydGVyIGZhY3RvcnlcclxuICAgIHJlZ2lzdGVyQ29udmVydGVyRmFjdG9yeSgnY29udmVydGVyUmVnaXN0cnknLCBjb252ZXJ0ZXJSZWdpc3RyeSk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUudGltZUVuZCgn8J+VkiBbVkVSQk9TRV0gQ29udmVydGVycyBpbml0aWFsaXphdGlvbiB0aW1lJyk7XHJcbiAgICBjb25zb2xlLmxvZygn4pyFIFtWRVJCT1NFXSBDb252ZXJ0ZXJzIHJlZ2lzdGVyZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICBcclxuICAgIC8vIFN0b3JlIGluIGdsb2JhbCBmb3IgZXJyb3IgY2hlY2tpbmdcclxuICAgIGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSA9IGNvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLnRpbWVFbmQoJ/CflZIgW1ZFUkJPU0VdIENvbnZlcnRlcnMgaW5pdGlhbGl6YXRpb24gdGltZScpO1xyXG4gICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBGYWlsZWQgdG8gcmVnaXN0ZXIgY29udmVydGVyczonLCBlcnJvcik7XHJcbiAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIEVycm9yIGRldGFpbHM6JywgZXJyb3Iuc3RhY2spO1xyXG4gICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIEVycm9yIG9iamVjdDonLCB7XHJcbiAgICAgIG5hbWU6IGVycm9yLm5hbWUsXHJcbiAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgIGNvZGU6IGVycm9yLmNvZGUsXHJcbiAgICAgIHR5cGU6IHR5cGVvZiBlcnJvcixcclxuICAgICAgaGFzU3RhY2s6ICEhZXJyb3Iuc3RhY2tcclxuICAgIH0pO1xyXG4gIH1cclxufSkoKTtcclxuXHJcbmNsYXNzIEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2Uge1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5maWxlU3lzdGVtID0gRmlsZVN5c3RlbVNlcnZpY2U7XHJcbiAgICB0aGlzLnJlc3VsdE1hbmFnZXIgPSBDb252ZXJzaW9uUmVzdWx0TWFuYWdlcjtcclxuICAgIHRoaXMucHJvZ3Jlc3NVcGRhdGVJbnRlcnZhbCA9IDI1MDsgLy8gVXBkYXRlIHByb2dyZXNzIGV2ZXJ5IDI1MG1zXHJcbiAgICB0aGlzLmRlZmF1bHRPdXRwdXREaXIgPSBwYXRoLmpvaW4oYXBwLmdldFBhdGgoJ3VzZXJEYXRhJyksICdjb252ZXJzaW9ucycpO1xyXG4gICAgY29uc29sZS5sb2coJ0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UgaW5pdGlhbGl6ZWQgd2l0aCBkZWZhdWx0IG91dHB1dCBkaXJlY3Rvcnk6JywgdGhpcy5kZWZhdWx0T3V0cHV0RGlyKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENvbnZlcnRzIGEgZmlsZSB0byBtYXJrZG93biBmb3JtYXRcclxuICAgKiBAcGFyYW0ge3N0cmluZ3xCdWZmZXJ9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgZmlsZSBvciBmaWxlIGNvbnRlbnQgYXMgYnVmZmVyXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSAtIENvbnZlcnNpb24gcmVzdWx0XHJcbiAgICovXHJcbiAgYXN5bmMgY29udmVydChmaWxlUGF0aCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UhCBbVkVSQk9TRV0gRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZS5jb252ZXJ0IGNhbGxlZCcpO1xyXG4gICAgY29uc29sZS50aW1lKCfwn5WSIFtWRVJCT1NFXSBUb3RhbCBjb252ZXJzaW9uIHRpbWUnKTtcclxuICAgIGNvbnNvbGUudHJhY2UoJ/CflIQgW1ZFUkJPU0VdIENvbnZlcnQgbWV0aG9kIHN0YWNrIHRyYWNlJyk7XHJcbiAgICBcclxuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFZhbGlkYXRlIG91dHB1dCBkaXJlY3RvcnlcclxuICAgICAgaWYgKCFvcHRpb25zLm91dHB1dERpcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gTm8gb3V0cHV0IGRpcmVjdG9yeSBwcm92aWRlZCEnKTtcclxuICAgICAgICBjb25zb2xlLnRpbWVFbmQoJ/CflZIgW1ZFUkJPU0VdIFRvdGFsIGNvbnZlcnNpb24gdGltZScpO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignT3V0cHV0IGRpcmVjdG9yeSBpcyByZXF1aXJlZCBmb3IgY29udmVyc2lvbicpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZygn8J+TpSBbVkVSQk9TRV0gUmVjZWl2ZWQgY29udmVyc2lvbiByZXF1ZXN0OicsIHtcclxuICAgICAgICBpbnB1dFR5cGU6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCkgPyAnQnVmZmVyJyA6IHR5cGVvZiBmaWxlUGF0aCxcclxuICAgICAgICBpbnB1dExlbmd0aDogQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSA/IGZpbGVQYXRoLmxlbmd0aCA6IHVuZGVmaW5lZCxcclxuICAgICAgICBmaWxlVHlwZTogb3B0aW9ucy5maWxlVHlwZSwgLy8gTG9nIHRoZSBmaWxlVHlwZSB3ZSByZWNlaXZlZCBmcm9tIGZyb250ZW5kXHJcbiAgICAgICAgaGFzQnVmZmVySW5PcHRpb25zOiAhIW9wdGlvbnMuYnVmZmVyLFxyXG4gICAgICAgIGJ1ZmZlckxlbmd0aDogb3B0aW9ucy5idWZmZXIgPyBvcHRpb25zLmJ1ZmZlci5sZW5ndGggOiB1bmRlZmluZWQsXHJcbiAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgIGJ1ZmZlcjogb3B0aW9ucy5idWZmZXIgPyBgQnVmZmVyKCR7b3B0aW9ucy5idWZmZXIubGVuZ3RofSlgIDogdW5kZWZpbmVkLFxyXG4gICAgICAgICAgYXBpS2V5OiBvcHRpb25zLmFwaUtleSA/ICfinJMnIDogJ+KclycsXHJcbiAgICAgICAgICBtaXN0cmFsQXBpS2V5OiBvcHRpb25zLm1pc3RyYWxBcGlLZXkgPyAn4pyTJyA6ICfinJcnXHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBDb252ZXJzaW9uIGVudmlyb25tZW50OicsIHtcclxuICAgICAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgIGlzUGFja2FnZWQ6IGFwcC5pc1BhY2thZ2VkLFxyXG4gICAgICAgIGFwcFBhdGg6IGFwcC5nZXRBcHBQYXRoKCksXHJcbiAgICAgICAgY29udmVydGVyUmVnaXN0cnlMb2FkZWQ6ICEhZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5LFxyXG4gICAgICAgIHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5TG9hZGVkOiAhIXVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LFxyXG4gICAgICAgIGhhc0NvbnZlcnRGaWxlOiB1bmlmaWVkQ29udmVydGVyRmFjdG9yeSA/IHR5cGVvZiB1bmlmaWVkQ29udmVydGVyRmFjdG9yeS5jb252ZXJ0RmlsZSA9PT0gJ2Z1bmN0aW9uJyA6IGZhbHNlXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gSWYgd2UgaGF2ZSBhIGJ1ZmZlciBpbiBvcHRpb25zLCB1c2UgdGhhdCBpbnN0ZWFkIG9mIHRoZSBpbnB1dFxyXG4gICAgICBpZiAob3B0aW9ucy5idWZmZXIgJiYgQnVmZmVyLmlzQnVmZmVyKG9wdGlvbnMuYnVmZmVyKSkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5OmIFVzaW5nIGJ1ZmZlciBmcm9tIG9wdGlvbnMgaW5zdGVhZCBvZiBpbnB1dCcpO1xyXG4gICAgICAgIGZpbGVQYXRoID0gb3B0aW9ucy5idWZmZXI7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIENyZWF0ZSBhIHByb2dyZXNzIHRyYWNrZXJcclxuICAgICAgY29uc3QgcHJvZ3Jlc3NUcmFja2VyID0gbmV3IFByb2dyZXNzVHJhY2tlcihvcHRpb25zLm9uUHJvZ3Jlc3MsIHRoaXMucHJvZ3Jlc3NVcGRhdGVJbnRlcnZhbCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBVc2UgdGhlIGZpbGVUeXBlIHByb3ZpZGVkIGJ5IHRoZSBmcm9udGVuZCAtIG5vIHJlZGV0ZXJtaW5hdGlvblxyXG4gICAgICBjb25zdCBmaWxlVHlwZSA9IG9wdGlvbnMuZmlsZVR5cGU7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZygn8J+UhCBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gUHJvY2Vzc2luZzonLCB7XHJcbiAgICAgICAgdHlwZTogZmlsZVR5cGUsXHJcbiAgICAgICAgaXNCdWZmZXI6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCksXHJcbiAgICAgICAgaXNUZW1wb3Jhcnk6IG9wdGlvbnMuaXNUZW1wb3JhcnksXHJcbiAgICAgICAgaXNVcmw6IG9wdGlvbnMudHlwZSA9PT0gJ3VybCcgfHwgb3B0aW9ucy50eXBlID09PSAncGFyZW50dXJsJyxcclxuICAgICAgICBpc1BhcmVudFVybDogb3B0aW9ucy50eXBlID09PSAncGFyZW50dXJsJ1xyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIERlbGVnYXRlIHRvIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5IHdpdGggdGhlIGZpbGVUeXBlIGZyb20gZnJvbnRlbmRcclxuICAgICAgY29uc3QgY29udmVyc2lvblJlc3VsdCA9IGF3YWl0IHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmNvbnZlcnRGaWxlKGZpbGVQYXRoLCB7XHJcbiAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICBmaWxlVHlwZSxcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXJcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoIWNvbnZlcnNpb25SZXN1bHQuc3VjY2Vzcykge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihjb252ZXJzaW9uUmVzdWx0LmVycm9yIHx8ICdDb252ZXJzaW9uIGZhaWxlZCcpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBFeHRyYWN0IGNvbnRlbnQgZnJvbSByZXN1bHRcclxuICAgICAgY29uc3QgY29udGVudCA9IGNvbnZlcnNpb25SZXN1bHQuY29udGVudCB8fCAnJztcclxuICAgICAgXHJcbiAgICAgIGlmICghY29udGVudCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50Jyk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFVzZSBjYXRlZ29yeSBmcm9tIGZyb250ZW5kIGlmIGF2YWlsYWJsZVxyXG4gICAgICBjb25zdCBmaWxlQ2F0ZWdvcnkgPSBvcHRpb25zLmNhdGVnb3J5IHx8IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvblJlc3VsdC5jYXRlZ29yeSB8fCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICd0ZXh0JztcclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGlmIHRoZSBjb252ZXJzaW9uIHJlc3VsdCBoYXMgbXVsdGlwbGUgZmlsZXMgKGZvciBwYXJlbnR1cmwpXHJcbiAgICAgIGNvbnN0IGhhc011bHRpcGxlRmlsZXMgPSBBcnJheS5pc0FycmF5KGNvbnZlcnNpb25SZXN1bHQuZmlsZXMpICYmIGNvbnZlcnNpb25SZXN1bHQuZmlsZXMubGVuZ3RoID4gMDtcclxuICAgICAgXHJcbiAgICAgIGlmIChoYXNNdWx0aXBsZUZpbGVzKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4EgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIENvbnZlcnNpb24gcmVzdWx0IGhhcyAke2NvbnZlcnNpb25SZXN1bHQuZmlsZXMubGVuZ3RofSBmaWxlc2ApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBTYXZlIHRoZSBjb252ZXJzaW9uIHJlc3VsdCB1c2luZyB0aGUgQ29udmVyc2lvblJlc3VsdE1hbmFnZXJcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5yZXN1bHRNYW5hZ2VyLnNhdmVDb252ZXJzaW9uUmVzdWx0KHtcclxuICAgICAgICBjb250ZW50OiBjb250ZW50LFxyXG4gICAgICAgIG1ldGFkYXRhOiBjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhIHx8IHt9LFxyXG4gICAgICAgIGltYWdlczogY29udmVyc2lvblJlc3VsdC5pbWFnZXMgfHwgW10sXHJcbiAgICAgICAgZmlsZXM6IGNvbnZlcnNpb25SZXN1bHQuZmlsZXMsXHJcbiAgICAgICAgbmFtZTogY29udmVyc2lvblJlc3VsdC5uYW1lIHx8IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBvcHRpb25zLm5hbWUsXHJcbiAgICAgICAgdHlwZTogY29udmVyc2lvblJlc3VsdC50eXBlIHx8IGZpbGVUeXBlLFxyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZSwgLy8gQWx3YXlzIHVzZSB0aGUgZmlsZVR5cGUgZnJvbSBmcm9udGVuZFxyXG4gICAgICAgIG91dHB1dERpcjogb3B0aW9ucy5vdXRwdXREaXIsXHJcbiAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgIGNhdGVnb3J5OiBmaWxlQ2F0ZWdvcnksXHJcbiAgICAgICAgICBwYWdlQ291bnQ6IGNvbnZlcnNpb25SZXN1bHQucGFnZUNvdW50LFxyXG4gICAgICAgICAgc2xpZGVDb3VudDogY29udmVyc2lvblJlc3VsdC5zbGlkZUNvdW50LFxyXG4gICAgICAgICAgaGFzTXVsdGlwbGVGaWxlc1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhg4pyFIEZpbGUgY29udmVyc2lvbiBjb21wbGV0ZWQgaW4gJHtEYXRlLm5vdygpIC0gc3RhcnRUaW1lfW1zOmAsIHtcclxuICAgICAgICBmaWxlOiBmaWxlUGF0aCxcclxuICAgICAgICBvdXRwdXRQYXRoOiByZXN1bHQub3V0cHV0UGF0aFxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS50aW1lRW5kKCfwn5WSIFtWRVJCT1NFXSBUb3RhbCBjb252ZXJzaW9uIHRpbWUnKTtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBDb252ZXJzaW9uIGVycm9yIGNhdWdodCBpbiBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmNvbnZlcnQnKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEFsd2F5cyBpbmNsdWRlIGZpbGVUeXBlIGluIGVycm9yIHJlc3VsdHNcclxuICAgICAgY29uc3QgZmlsZVR5cGUgPSBvcHRpb25zLmZpbGVUeXBlIHx8ICd1bmtub3duJztcclxuICAgICAgXHJcbiAgICAgIC8vIERldGFpbGVkIGVycm9yIGxvZ2dpbmdcclxuICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIEVycm9yIGRldGFpbHM6Jywge1xyXG4gICAgICAgIG5hbWU6IGVycm9yLm5hbWUsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcclxuICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXHJcbiAgICAgICAgY29kZTogZXJyb3IuY29kZSxcclxuICAgICAgICB0eXBlOiB0eXBlb2YgZXJyb3JcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBjb252ZXJ0ZXIgcmVnaXN0cnkgc3RhdGVcclxuICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIENvbnZlcnRlciByZWdpc3RyeSBzdGF0ZSBhdCBlcnJvciB0aW1lOicsIHtcclxuICAgICAgICBjb252ZXJ0ZXJSZWdpc3RyeUxvYWRlZDogISFnbG9iYWwuY29udmVydGVyUmVnaXN0cnksXHJcbiAgICAgICAgaGFzQ29udmVydGVyczogISEoZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5ICYmIGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzKSxcclxuICAgICAgICBhdmFpbGFibGVDb252ZXJ0ZXJzOiBnbG9iYWwuY29udmVydGVyUmVnaXN0cnkgJiYgZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5LmNvbnZlcnRlcnMgPyBcclxuICAgICAgICAgIE9iamVjdC5rZXlzKGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzKSA6ICdub25lJyxcclxuICAgICAgICB1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZDogISF1bmlmaWVkQ29udmVydGVyRmFjdG9yeSxcclxuICAgICAgICBoYXNDb252ZXJ0RmlsZTogdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPyB0eXBlb2YgdW5pZmllZENvbnZlcnRlckZhY3RvcnkuY29udmVydEZpbGUgPT09ICdmdW5jdGlvbicgOiBmYWxzZVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGVycm9ySW5mbyA9IHtcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUsIC8vIEFsd2F5cyBpbmNsdWRlIGZpbGVUeXBlXHJcbiAgICAgICAgdHlwZTogb3B0aW9ucy50eXBlLFxyXG4gICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICBpc0J1ZmZlcjogQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSxcclxuICAgICAgICBidWZmZXJMZW5ndGg6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCkgPyBmaWxlUGF0aC5sZW5ndGggOiB1bmRlZmluZWQsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxyXG4gICAgICAgIGNvbnZlcnRlcnNMb2FkZWQ6ICEhZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5IC8vIENoZWNrIGlmIGNvbnZlcnRlcnMgd2VyZSBsb2FkZWRcclxuICAgICAgfTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gQ29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3JJbmZvKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENvbnN0cnVjdCBhIHVzZXItZnJpZW5kbHkgZXJyb3IgbWVzc2FnZVxyXG4gICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpIFxyXG4gICAgICAgID8gYEZhaWxlZCB0byBjb252ZXJ0ICR7b3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8ICdmaWxlJ306ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgICAgOiBgRmFpbGVkIHRvIGNvbnZlcnQgJHtmaWxlUGF0aH06ICR7ZXJyb3IubWVzc2FnZX1gO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICAgIGRldGFpbHM6IGVycm9ySW5mbyxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUgLy8gRXhwbGljaXRseSBpbmNsdWRlIGZpbGVUeXBlIGluIGVycm9yIHJlc3VsdFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2V0cyB1cCB0aGUgb3V0cHV0IGRpcmVjdG9yeSBmb3IgY29udmVyc2lvbnNcclxuICAgKi9cclxuICBhc3luYyBzZXR1cE91dHB1dERpcmVjdG9yeShvdXRwdXREaXIpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGRpclRvU2V0dXAgPSBvdXRwdXREaXIgfHwgdGhpcy5kZWZhdWx0T3V0cHV0RGlyO1xyXG4gICAgICBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0uY3JlYXRlRGlyZWN0b3J5KGRpclRvU2V0dXApO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+TgSBPdXRwdXQgZGlyZWN0b3J5IHJlYWR5OicsIGRpclRvU2V0dXApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBzZXQgdXAgb3V0cHV0IGRpcmVjdG9yeTonLCBlcnJvcik7XHJcbiAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBuZXcgRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZSgpOyJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTTtFQUFFQztBQUFJLENBQUMsR0FBR0QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUNuQyxNQUFNO0VBQUVFO0FBQVUsQ0FBQyxHQUFHRixPQUFPLENBQUMs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