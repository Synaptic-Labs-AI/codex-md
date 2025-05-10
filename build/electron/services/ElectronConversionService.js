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
      console.log(`📦 [ElectronConversionService] Using filename for result: ${originalFileName}`);

      // Log metadata from the conversion result for debugging
      if (conversionResult.metadata) {
        console.log(`🔍 [ElectronConversionService] Conversion result metadata:`, {
          keys: Object.keys(conversionResult.metadata),
          hasOriginalFileName: 'originalFileName' in conversionResult.metadata,
          originalFileName: conversionResult.metadata.originalFileName
        });
      }
      const result = await this.resultManager.saveConversionResult({
        content: content,
        metadata: {
          ...(conversionResult.metadata || {}),
          originalFileName: originalFileName // Ensure original filename is in metadata
        },
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsIlBhdGhVdGlscyIsInByb21pc2lmeSIsImZzIiwicmVhZEZpbGVBc3luYyIsInJlYWRGaWxlIiwiaW5zdGFuY2UiLCJGaWxlU3lzdGVtU2VydmljZSIsIkNvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIiwiZ2V0RmlsZVR5cGUiLCJnZXRGaWxlSGFuZGxpbmdJbmZvIiwiSEFORExJTkdfVFlQRVMiLCJDT05WRVJURVJfQ09ORklHIiwiUHJvZ3Jlc3NUcmFja2VyIiwiY29udmVydFRvTWFya2Rvd24iLCJyZWdpc3RlckNvbnZlcnRlciIsInJlZ2lzdGVyQ29udmVydGVyRmFjdG9yeSIsImNvbnNvbGUiLCJsb2ciLCJoYW5kbGluZ1R5cGVzIiwiZmlsZUNvbmZpZyIsIk1vZHVsZVJlc29sdmVyIiwidW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJpbml0aWFsaXplIiwiY2F0Y2giLCJlcnJvciIsImdldENvbnZlcnRlclJlZ2lzdHJ5UGF0aCIsInJlc29sdmVNb2R1bGVQYXRoIiwidGltZSIsImNvbnZlcnRlclJlZ2lzdHJ5UGF0aCIsImVudmlyb25tZW50IiwicHJvY2VzcyIsImVudiIsIk5PREVfRU5WIiwiYXBwUGF0aCIsImdldEFwcFBhdGgiLCJjdXJyZW50RGlyIiwiX19kaXJuYW1lIiwiaXNQYWNrYWdlZCIsImZpbGVFeGlzdHMiLCJleGlzdHNTeW5jIiwiZGlybmFtZSIsInJlYWRkaXJTeW5jIiwic2VydmljZXMiLCJqb2luIiwiY29udmVyc2lvbiIsImRhdGEiLCJjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSIsInNhZmVSZXF1aXJlIiwia2V5cyIsIk9iamVjdCIsImhhc0NvbnZlcnRlclJlZ2lzdHJ5IiwiaGFzRGVmYXVsdEV4cG9ydCIsImV4cG9ydFR5cGVzIiwiZW50cmllcyIsIm1hcCIsImtleSIsInZhbHVlIiwibmFtZSIsIm1lc3NhZ2UiLCJzdGFjayIsImNvZGUiLCJkaXJlY3RFcnJvciIsIkVycm9yIiwiY29udmVydGVyUmVnaXN0cnkiLCJDb252ZXJ0ZXJSZWdpc3RyeSIsImRlZmF1bHQiLCJoYXNDb252ZXJ0ZXJzIiwiY29udmVydGVycyIsImhhc0NvbnZlcnRUb01hcmtkb3duIiwiaGFzR2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJnZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiIsImhhc0dldENvbnZlcnRlckJ5TWltZVR5cGUiLCJnZXRDb252ZXJ0ZXJCeU1pbWVUeXBlIiwiYXZhaWxhYmxlQ29udmVydGVycyIsInRpbWVFbmQiLCJnbG9iYWwiLCJ0eXBlIiwiaGFzU3RhY2siLCJFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJmaWxlU3lzdGVtIiwicmVzdWx0TWFuYWdlciIsInByb2dyZXNzVXBkYXRlSW50ZXJ2YWwiLCJkZWZhdWx0T3V0cHV0RGlyIiwiZ2V0UGF0aCIsImNvbnZlcnQiLCJmaWxlUGF0aCIsIm9wdGlvbnMiLCJ0aW1lTGFiZWwiLCJEYXRlIiwibm93IiwidHJhY2UiLCJzdGFydFRpbWUiLCJvdXRwdXREaXIiLCJpbnB1dFR5cGUiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImlucHV0TGVuZ3RoIiwibGVuZ3RoIiwidW5kZWZpbmVkIiwiZmlsZVR5cGUiLCJoYXNCdWZmZXJJbk9wdGlvbnMiLCJidWZmZXIiLCJidWZmZXJMZW5ndGgiLCJhcGlLZXkiLCJtaXN0cmFsQXBpS2V5IiwiY29udmVydGVyUmVnaXN0cnlMb2FkZWQiLCJ1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZCIsImhhc0NvbnZlcnRGaWxlIiwiY29udmVydEZpbGUiLCJwcm9ncmVzc1RyYWNrZXIiLCJvblByb2dyZXNzIiwiaXNUZW1wb3JhcnkiLCJpc1VybCIsImlzUGFyZW50VXJsIiwiY29udmVyc2lvblJlc3VsdCIsInN1Y2Nlc3MiLCJjb250ZW50IiwiZmlsZUNhdGVnb3J5IiwiY2F0ZWdvcnkiLCJoYXNNdWx0aXBsZUZpbGVzIiwiQXJyYXkiLCJpc0FycmF5IiwiZmlsZXMiLCJvcmlnaW5hbEZpbGVOYW1lIiwibWV0YWRhdGEiLCJoYXNPcmlnaW5hbEZpbGVOYW1lIiwicmVzdWx0Iiwic2F2ZUNvbnZlcnNpb25SZXN1bHQiLCJpbWFnZXMiLCJwYWdlQ291bnQiLCJzbGlkZUNvdW50IiwiZmlsZSIsIm91dHB1dFBhdGgiLCJlcnJvckluZm8iLCJjb252ZXJ0ZXJzTG9hZGVkIiwiZXJyb3JNZXNzYWdlIiwiZGV0YWlscyIsInNldHVwT3V0cHV0RGlyZWN0b3J5IiwiZGlyVG9TZXR1cCIsImNyZWF0ZURpcmVjdG9yeSIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZS5qc1xyXG4gKiBIYW5kbGVzIGRvY3VtZW50IGNvbnZlcnNpb24gdXNpbmcgbmF0aXZlIGZpbGUgc3lzdGVtIG9wZXJhdGlvbnMgaW4gRWxlY3Ryb24uXHJcbiAqIENvb3JkaW5hdGVzIGNvbnZlcnNpb24gcHJvY2Vzc2VzIGFuZCBkZWxlZ2F0ZXMgdG8gdGhlIHNoYXJlZCBjb252ZXJzaW9uIHV0aWxpdGllcy5cclxuICpcclxuICogSU1QT1JUQU5UOiBXaGVuIGRldGVybWluaW5nIGZpbGUgdHlwZXMgZm9yIGNvbnZlcnNpb24sIHdlIGV4dHJhY3QgdGhlIGZpbGUgZXh0ZW5zaW9uXHJcbiAqIGRpcmVjdGx5IHJhdGhlciB0aGFuIHVzaW5nIHRoZSBjYXRlZ29yeSBmcm9tIGdldEZpbGVUeXBlLiBUaGlzIGVuc3VyZXMgdGhhdCB3ZSB1c2VcclxuICogdGhlIHNwZWNpZmljIGNvbnZlcnRlciByZWdpc3RlcmVkIGZvciBlYWNoIGZpbGUgdHlwZSAoZS5nLiwgJ3BkZicsICdkb2N4JywgJ3BwdHgnKVxyXG4gKiByYXRoZXIgdGhhbiB0cnlpbmcgdG8gdXNlIGEgY29udmVydGVyIGZvciB0aGUgY2F0ZWdvcnkgKCdkb2N1bWVudHMnKS5cclxuICpcclxuICogU3BlY2lhbCBoYW5kbGluZyBpcyBpbXBsZW1lbnRlZCBmb3IgZGF0YSBmaWxlcyAoQ1NWLCBYTFNYKSB0byBlbnN1cmUgdGhleSB1c2UgdGhlXHJcbiAqIGNvcnJlY3QgY29udmVydGVyIGJhc2VkIG9uIGZpbGUgZXh0ZW5zaW9uLiBJZiB0aGUgZXh0ZW5zaW9uIGNhbid0IGJlIGRldGVybWluZWQsXHJcbiAqIHdlIGRlZmF1bHQgdG8gJ2NzdicgcmF0aGVyIHRoYW4gdXNpbmcgdGhlIGNhdGVnb3J5ICdkYXRhJy5cclxuICpcclxuICogRm9yIENTViBmaWxlcyBzZW50IGFzIHRleHQgY29udGVudCwgd2UgZGV0ZWN0IENTViBjb250ZW50IGJ5IGNoZWNraW5nIGZvciBjb21tYXMsIHRhYnMsXHJcbiAqIGFuZCBuZXdsaW5lcywgYW5kIHByb2Nlc3MgaXQgZGlyZWN0bHkgcmF0aGVyIHRoYW4gdHJlYXRpbmcgaXQgYXMgYSBmaWxlIHBhdGguIFRoaXMgZml4ZXNcclxuICogdGhlIFwiRmlsZSBub3QgZm91bmQgb3IgaW5hY2Nlc3NpYmxlXCIgZXJyb3IgdGhhdCBvY2N1cnJlZCB3aGVuIHRoZSBzeXN0ZW0gdHJpZWQgdG8gaW50ZXJwcmV0XHJcbiAqIENTViBjb250ZW50IGFzIGEgZmlsZSBwYXRoLlxyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IHsgYXBwIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCB7IFBhdGhVdGlscyB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvcGF0aHMnKTtcclxuY29uc3QgeyBwcm9taXNpZnkgfSA9IHJlcXVpcmUoJ3V0aWwnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcycpO1xyXG5jb25zdCByZWFkRmlsZUFzeW5jID0gcHJvbWlzaWZ5KGZzLnJlYWRGaWxlKTtcclxuY29uc3QgeyBpbnN0YW5jZTogRmlsZVN5c3RlbVNlcnZpY2UgfSA9IHJlcXVpcmUoJy4vRmlsZVN5c3RlbVNlcnZpY2UnKTsgLy8gSW1wb3J0IGluc3RhbmNlXHJcbmNvbnN0IENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyID0gcmVxdWlyZSgnLi9Db252ZXJzaW9uUmVzdWx0TWFuYWdlcicpO1xyXG4vLyBJbXBvcnQgbG9jYWwgdXRpbGl0aWVzXHJcbmNvbnN0IHsgXHJcbiAgZ2V0RmlsZVR5cGUsXHJcbiAgZ2V0RmlsZUhhbmRsaW5nSW5mbyxcclxuICBIQU5ETElOR19UWVBFUyxcclxuICBDT05WRVJURVJfQ09ORklHXHJcbn0gPSByZXF1aXJlKCcuLi91dGlscy9maWxlcycpO1xyXG5jb25zdCB7IFxyXG4gIFByb2dyZXNzVHJhY2tlciwgXHJcbiAgY29udmVydFRvTWFya2Rvd24sIFxyXG4gIHJlZ2lzdGVyQ29udmVydGVyLFxyXG4gIHJlZ2lzdGVyQ29udmVydGVyRmFjdG9yeVxyXG59ID0gcmVxdWlyZSgnLi4vdXRpbHMvY29udmVyc2lvbicpO1xyXG5cclxuLy8gTG9nIGF2YWlsYWJsZSBmaWxlIGhhbmRsaW5nIGNhcGFiaWxpdGllc1xyXG5jb25zb2xlLmxvZygn8J+ThCBJbml0aWFsaXplZCB3aXRoIGZpbGUgaGFuZGxpbmc6Jywge1xyXG4gIGhhbmRsaW5nVHlwZXM6IEhBTkRMSU5HX1RZUEVTLFxyXG4gIGZpbGVDb25maWc6IENPTlZFUlRFUl9DT05GSUdcclxufSk7XHJcblxyXG4vLyBJbXBvcnQgTW9kdWxlUmVzb2x2ZXIgYW5kIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5XHJcbmNvbnN0IHsgTW9kdWxlUmVzb2x2ZXIgfSA9IHJlcXVpcmUoJy4uL3V0aWxzL21vZHVsZVJlc29sdmVyJyk7XHJcbmNvbnN0IHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5ID0gcmVxdWlyZSgnLi4vY29udmVydGVycy9VbmlmaWVkQ29udmVydGVyRmFjdG9yeScpO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSB0aGUgY29udmVydGVyIGZhY3RvcnlcclxudW5pZmllZENvbnZlcnRlckZhY3RvcnkuaW5pdGlhbGl6ZSgpLmNhdGNoKGVycm9yID0+IHtcclxuICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGluaXRpYWxpemUgY29udmVydGVyIGZhY3Rvcnk6JywgZXJyb3IpO1xyXG59KTtcclxuXHJcbi8vIEZ1bmN0aW9uIHRvIGdldCBjb3JyZWN0IGNvbnZlcnRlciByZWdpc3RyeSBwYXRoIHVzaW5nIE1vZHVsZVJlc29sdmVyXHJcbmNvbnN0IGdldENvbnZlcnRlclJlZ2lzdHJ5UGF0aCA9ICgpID0+IHtcclxuICBjb25zb2xlLmxvZygn8J+TgiBHZXR0aW5nIGNvbnZlcnRlciByZWdpc3RyeSBwYXRoIHVzaW5nIE1vZHVsZVJlc29sdmVyJyk7XHJcbiAgcmV0dXJuIE1vZHVsZVJlc29sdmVyLnJlc29sdmVNb2R1bGVQYXRoKCdDb252ZXJ0ZXJSZWdpc3RyeS5qcycsICdzZXJ2aWNlcy9jb252ZXJzaW9uJyk7XHJcbn07XHJcblxyXG4vLyBJbml0aWFsaXplIGNvbnZlcnRlcnMgdXNpbmcgTW9kdWxlUmVzb2x2ZXJcclxuKGZ1bmN0aW9uKCkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UhCBbVkVSQk9TRV0gU3RhcnRpbmcgY29udmVydGVycyBpbml0aWFsaXphdGlvbicpO1xyXG4gICAgY29uc29sZS50aW1lKCfwn5WSIFtWRVJCT1NFXSBDb252ZXJ0ZXJzIGluaXRpYWxpemF0aW9uIHRpbWUnKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ/CflIQgW1ZFUkJPU0VdIFVzaW5nIE1vZHVsZVJlc29sdmVyIHRvIGZpbmQgQ29udmVydGVyUmVnaXN0cnkuanMnKTtcclxuICAgIGNvbnN0IGNvbnZlcnRlclJlZ2lzdHJ5UGF0aCA9IGdldENvbnZlcnRlclJlZ2lzdHJ5UGF0aCgpO1xyXG4gICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIExvYWRpbmcgY29udmVydGVyIHJlZ2lzdHJ5IGZyb20gcGF0aDonLCBjb252ZXJ0ZXJSZWdpc3RyeVBhdGgpO1xyXG4gICAgXHJcbiAgICAvLyBMb2cgZW52aXJvbm1lbnQgZGV0YWlsc1xyXG4gICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIEVudmlyb25tZW50IGRldGFpbHM6Jywge1xyXG4gICAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgfHwgJ3Vua25vd24nLFxyXG4gICAgICBhcHBQYXRoOiBhcHAuZ2V0QXBwUGF0aCgpLFxyXG4gICAgICBjdXJyZW50RGlyOiBfX2Rpcm5hbWUsXHJcbiAgICAgIGlzUGFja2FnZWQ6IGFwcC5pc1BhY2thZ2VkXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gQ2hlY2sgaWYgdGhlIGZpbGUgZXhpc3RzXHJcbiAgICBjb25zdCBmaWxlRXhpc3RzID0gZnMuZXhpc3RzU3luYyhjb252ZXJ0ZXJSZWdpc3RyeVBhdGgpO1xyXG4gICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIFJlZ2lzdHJ5IGZpbGUgZXhpc3RzIGNoZWNrOicsIGZpbGVFeGlzdHMpO1xyXG4gICAgXHJcbiAgICBpZiAoIWZpbGVFeGlzdHMpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBSZWdpc3RyeSBmaWxlIGRvZXMgbm90IGV4aXN0IGF0IHBhdGg6JywgY29udmVydGVyUmVnaXN0cnlQYXRoKTtcclxuICAgICAgY29uc29sZS5sb2coJ/Cfk4IgW1ZFUkJPU0VdIERpcmVjdG9yeSBjb250ZW50czonLCB7XHJcbiAgICAgICAgZGlybmFtZTogZnMuZXhpc3RzU3luYyhfX2Rpcm5hbWUpID8gZnMucmVhZGRpclN5bmMoX19kaXJuYW1lKSA6ICdkaXJlY3Rvcnkgbm90IGZvdW5kJyxcclxuICAgICAgICBhcHBQYXRoOiBmcy5leGlzdHNTeW5jKGFwcC5nZXRBcHBQYXRoKCkpID8gZnMucmVhZGRpclN5bmMoYXBwLmdldEFwcFBhdGgoKSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgc2VydmljZXM6IGZzLmV4aXN0c1N5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJykpID9cclxuICAgICAgICAgIGZzLnJlYWRkaXJTeW5jKHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicpKSA6ICdkaXJlY3Rvcnkgbm90IGZvdW5kJyxcclxuICAgICAgICBjb252ZXJzaW9uOiBmcy5leGlzdHNTeW5jKHBhdGguam9pbihfX2Rpcm5hbWUsICdjb252ZXJzaW9uJykpID9cclxuICAgICAgICAgIGZzLnJlYWRkaXJTeW5jKHBhdGguam9pbihfX2Rpcm5hbWUsICdjb252ZXJzaW9uJykpIDogJ2RpcmVjdG9yeSBub3QgZm91bmQnLFxyXG4gICAgICAgIGRhdGE6IGZzLmV4aXN0c1N5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJ2NvbnZlcnNpb24vZGF0YScpKSA/XHJcbiAgICAgICAgICBmcy5yZWFkZGlyU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnY29udmVyc2lvbi9kYXRhJykpIDogJ2RpcmVjdG9yeSBub3QgZm91bmQnXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBVc2UgTW9kdWxlUmVzb2x2ZXIgdG8gc2FmZWx5IHJlcXVpcmUgdGhlIGNvbnZlcnRlciByZWdpc3RyeVxyXG4gICAgY29uc29sZS5sb2coJ/CflIQgW1ZFUkJPU0VdIFVzaW5nIE1vZHVsZVJlc29sdmVyLnNhZmVSZXF1aXJlIGZvciBDb252ZXJ0ZXJSZWdpc3RyeScpO1xyXG4gICAgXHJcbiAgICBsZXQgY29udmVydGVyUmVnaXN0cnlNb2R1bGU7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBVc2Ugb3VyIE1vZHVsZVJlc29sdmVyIHRvIGxvYWQgdGhlIG1vZHVsZVxyXG4gICAgICBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSA9IE1vZHVsZVJlc29sdmVyLnNhZmVSZXF1aXJlKCdDb252ZXJ0ZXJSZWdpc3RyeS5qcycsICdzZXJ2aWNlcy9jb252ZXJzaW9uJyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5OmIFtWRVJCT1NFXSBNb2R1bGVSZXNvbHZlciBzdWNjZXNzZnVsLiBNb2R1bGUgc3RydWN0dXJlOicsIHtcclxuICAgICAgICBrZXlzOiBPYmplY3Qua2V5cyhjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSksXHJcbiAgICAgICAgaGFzQ29udmVydGVyUmVnaXN0cnk6ICdDb252ZXJ0ZXJSZWdpc3RyeScgaW4gY29udmVydGVyUmVnaXN0cnlNb2R1bGUsXHJcbiAgICAgICAgaGFzRGVmYXVsdEV4cG9ydDogJ2RlZmF1bHQnIGluIGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlLFxyXG4gICAgICAgIGV4cG9ydFR5cGVzOiBPYmplY3QuZW50cmllcyhjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSkubWFwKChba2V5LCB2YWx1ZV0pID0+XHJcbiAgICAgICAgICBgJHtrZXl9OiAke3R5cGVvZiB2YWx1ZX0ke3ZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgPyBgIHdpdGgga2V5cyBbJHtPYmplY3Qua2V5cyh2YWx1ZSkuam9pbignLCAnKX1dYCA6ICcnfWBcclxuICAgICAgICApXHJcbiAgICAgIH0pO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBNb2R1bGUgbG9hZGluZyBmYWlsZWQgd2l0aCBlcnJvcjonLCBlcnJvcik7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBFcnJvciBkZXRhaWxzOicsIHtcclxuICAgICAgICBuYW1lOiBlcnJvci5uYW1lLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxyXG4gICAgICAgIGNvZGU6IGVycm9yLmNvZGUsXHJcbiAgICAgICAgcGF0aDogY29udmVydGVyUmVnaXN0cnlQYXRoXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gVHJ5IGZhbGxiYWNrIHRvIGRpcmVjdCByZXF1aXJlIGFzIGEgbGFzdCByZXNvcnRcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+UhCBbVkVSQk9TRV0gVHJ5aW5nIGRpcmVjdCByZXF1aXJlIGFzIGZhbGxiYWNrJyk7XHJcbiAgICAgICAgY29udmVydGVyUmVnaXN0cnlNb2R1bGUgPSByZXF1aXJlKGNvbnZlcnRlclJlZ2lzdHJ5UGF0aCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBbVkVSQk9TRV0gRGlyZWN0IHJlcXVpcmUgc3VjY2Vzc2Z1bCcpO1xyXG4gICAgICB9IGNhdGNoIChkaXJlY3RFcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gQWxsIG1vZHVsZSBsb2FkaW5nIGF0dGVtcHRzIGZhaWxlZDonLCBkaXJlY3RFcnJvci5tZXNzYWdlKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBsb2FkIENvbnZlcnRlclJlZ2lzdHJ5OiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgY29uc3QgY29udmVydGVyUmVnaXN0cnkgPSBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZS5Db252ZXJ0ZXJSZWdpc3RyeSB8fCBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZS5kZWZhdWx0IHx8IGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlO1xyXG4gICAgXHJcbiAgICAvLyBMb2cgZGV0YWlsZWQgaW5mb3JtYXRpb24gYWJvdXQgdGhlIGNvbnZlcnRlciByZWdpc3RyeVxyXG4gICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIENvbnZlcnRlciByZWdpc3RyeSBzdHJ1Y3R1cmU6Jywge1xyXG4gICAgICBoYXNDb252ZXJ0ZXJzOiAhIShjb252ZXJ0ZXJSZWdpc3RyeSAmJiBjb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzKSxcclxuICAgICAgaGFzQ29udmVydFRvTWFya2Rvd246IHR5cGVvZiBjb252ZXJ0ZXJSZWdpc3RyeT8uY29udmVydFRvTWFya2Rvd24gPT09ICdmdW5jdGlvbicsXHJcbiAgICAgIGhhc0dldENvbnZlcnRlckJ5RXh0ZW5zaW9uOiB0eXBlb2YgY29udmVydGVyUmVnaXN0cnk/LmdldENvbnZlcnRlckJ5RXh0ZW5zaW9uID09PSAnZnVuY3Rpb24nLFxyXG4gICAgICBoYXNHZXRDb252ZXJ0ZXJCeU1pbWVUeXBlOiB0eXBlb2YgY29udmVydGVyUmVnaXN0cnk/LmdldENvbnZlcnRlckJ5TWltZVR5cGUgPT09ICdmdW5jdGlvbicsXHJcbiAgICAgIGF2YWlsYWJsZUNvbnZlcnRlcnM6IGNvbnZlcnRlclJlZ2lzdHJ5ICYmIGNvbnZlcnRlclJlZ2lzdHJ5LmNvbnZlcnRlcnMgP1xyXG4gICAgICAgIE9iamVjdC5rZXlzKGNvbnZlcnRlclJlZ2lzdHJ5LmNvbnZlcnRlcnMpIDogJ25vbmUnXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gUmVnaXN0ZXIgdGhlIGNvbnZlcnRlciBmYWN0b3J5XHJcbiAgICByZWdpc3RlckNvbnZlcnRlckZhY3RvcnkoJ2NvbnZlcnRlclJlZ2lzdHJ5JywgY29udmVydGVyUmVnaXN0cnkpO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLnRpbWVFbmQoJ/CflZIgW1ZFUkJPU0VdIENvbnZlcnRlcnMgaW5pdGlhbGl6YXRpb24gdGltZScpO1xyXG4gICAgY29uc29sZS5sb2coJ+KchSBbVkVSQk9TRV0gQ29udmVydGVycyByZWdpc3RlcmVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgXHJcbiAgICAvLyBTdG9yZSBpbiBnbG9iYWwgZm9yIGVycm9yIGNoZWNraW5nXHJcbiAgICBnbG9iYWwuY29udmVydGVyUmVnaXN0cnkgPSBjb252ZXJ0ZXJSZWdpc3RyeTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS50aW1lRW5kKCfwn5WSIFtWRVJCT1NFXSBDb252ZXJ0ZXJzIGluaXRpYWxpemF0aW9uIHRpbWUnKTtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gRmFpbGVkIHRvIHJlZ2lzdGVyIGNvbnZlcnRlcnM6JywgZXJyb3IpO1xyXG4gICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBFcnJvciBkZXRhaWxzOicsIGVycm9yLnN0YWNrKTtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBFcnJvciBvYmplY3Q6Jywge1xyXG4gICAgICBuYW1lOiBlcnJvci5uYW1lLFxyXG4gICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICBjb2RlOiBlcnJvci5jb2RlLFxyXG4gICAgICB0eXBlOiB0eXBlb2YgZXJyb3IsXHJcbiAgICAgIGhhc1N0YWNrOiAhIWVycm9yLnN0YWNrXHJcbiAgICB9KTtcclxuICB9XHJcbn0pKCk7XHJcblxyXG5jbGFzcyBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIHtcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuZmlsZVN5c3RlbSA9IEZpbGVTeXN0ZW1TZXJ2aWNlO1xyXG4gICAgdGhpcy5yZXN1bHRNYW5hZ2VyID0gQ29udmVyc2lvblJlc3VsdE1hbmFnZXI7XHJcbiAgICB0aGlzLnByb2dyZXNzVXBkYXRlSW50ZXJ2YWwgPSAyNTA7IC8vIFVwZGF0ZSBwcm9ncmVzcyBldmVyeSAyNTBtc1xyXG4gICAgdGhpcy5kZWZhdWx0T3V0cHV0RGlyID0gcGF0aC5qb2luKGFwcC5nZXRQYXRoKCd1c2VyRGF0YScpLCAnY29udmVyc2lvbnMnKTtcclxuICAgIGNvbnNvbGUubG9nKCdFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIGluaXRpYWxpemVkIHdpdGggZGVmYXVsdCBvdXRwdXQgZGlyZWN0b3J5OicsIHRoaXMuZGVmYXVsdE91dHB1dERpcik7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDb252ZXJ0cyBhIGZpbGUgdG8gbWFya2Rvd24gZm9ybWF0XHJcbiAgICogQHBhcmFtIHtzdHJpbmd8QnVmZmVyfSBmaWxlUGF0aCAtIFBhdGggdG8gdGhlIGZpbGUgb3IgZmlsZSBjb250ZW50IGFzIGJ1ZmZlclxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gLSBDb252ZXJzaW9uIHJlc3VsdFxyXG4gICAqL1xyXG4gIGFzeW5jIGNvbnZlcnQoZmlsZVBhdGgsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgY29uc29sZS5sb2coJ/CflIQgW1ZFUkJPU0VdIEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuY29udmVydCBjYWxsZWQnKTtcclxuICAgIC8vIFVzZSBhIHVuaXF1ZSBsYWJlbCBmb3IgZWFjaCBjb252ZXJzaW9uIHRvIGF2b2lkIGR1cGxpY2F0ZSBsYWJlbCB3YXJuaW5nc1xyXG4gICAgY29uc3QgdGltZUxhYmVsID0gYPCflZIgW1ZFUkJPU0VdIFRvdGFsIGNvbnZlcnNpb24gdGltZSAke0RhdGUubm93KCl9YDtcclxuICAgIGNvbnNvbGUudGltZSh0aW1lTGFiZWwpO1xyXG4gICAgY29uc29sZS50cmFjZSgn8J+UhCBbVkVSQk9TRV0gQ29udmVydCBtZXRob2Qgc3RhY2sgdHJhY2UnKTtcclxuICAgIFxyXG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVmFsaWRhdGUgb3V0cHV0IGRpcmVjdG9yeVxyXG4gICAgICBpZiAoIW9wdGlvbnMub3V0cHV0RGlyKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBObyBvdXRwdXQgZGlyZWN0b3J5IHByb3ZpZGVkIScpO1xyXG4gICAgICAgIGNvbnNvbGUudGltZUVuZCh0aW1lTGFiZWwpO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignT3V0cHV0IGRpcmVjdG9yeSBpcyByZXF1aXJlZCBmb3IgY29udmVyc2lvbicpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZygn8J+TpSBbVkVSQk9TRV0gUmVjZWl2ZWQgY29udmVyc2lvbiByZXF1ZXN0OicsIHtcclxuICAgICAgICBpbnB1dFR5cGU6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCkgPyAnQnVmZmVyJyA6IHR5cGVvZiBmaWxlUGF0aCxcclxuICAgICAgICBpbnB1dExlbmd0aDogQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSA/IGZpbGVQYXRoLmxlbmd0aCA6IHVuZGVmaW5lZCxcclxuICAgICAgICBmaWxlVHlwZTogb3B0aW9ucy5maWxlVHlwZSwgLy8gTG9nIHRoZSBmaWxlVHlwZSB3ZSByZWNlaXZlZCBmcm9tIGZyb250ZW5kXHJcbiAgICAgICAgaGFzQnVmZmVySW5PcHRpb25zOiAhIW9wdGlvbnMuYnVmZmVyLFxyXG4gICAgICAgIGJ1ZmZlckxlbmd0aDogb3B0aW9ucy5idWZmZXIgPyBvcHRpb25zLmJ1ZmZlci5sZW5ndGggOiB1bmRlZmluZWQsXHJcbiAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgIGJ1ZmZlcjogb3B0aW9ucy5idWZmZXIgPyBgQnVmZmVyKCR7b3B0aW9ucy5idWZmZXIubGVuZ3RofSlgIDogdW5kZWZpbmVkLFxyXG4gICAgICAgICAgYXBpS2V5OiBvcHRpb25zLmFwaUtleSA/ICfinJMnIDogJ+KclycsXHJcbiAgICAgICAgICBtaXN0cmFsQXBpS2V5OiBvcHRpb25zLm1pc3RyYWxBcGlLZXkgPyAn4pyTJyA6ICfinJcnXHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBDb252ZXJzaW9uIGVudmlyb25tZW50OicsIHtcclxuICAgICAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgIGlzUGFja2FnZWQ6IGFwcC5pc1BhY2thZ2VkLFxyXG4gICAgICAgIGFwcFBhdGg6IGFwcC5nZXRBcHBQYXRoKCksXHJcbiAgICAgICAgY29udmVydGVyUmVnaXN0cnlMb2FkZWQ6ICEhZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5LFxyXG4gICAgICAgIHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5TG9hZGVkOiAhIXVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LFxyXG4gICAgICAgIGhhc0NvbnZlcnRGaWxlOiB1bmlmaWVkQ29udmVydGVyRmFjdG9yeSA/IHR5cGVvZiB1bmlmaWVkQ29udmVydGVyRmFjdG9yeS5jb252ZXJ0RmlsZSA9PT0gJ2Z1bmN0aW9uJyA6IGZhbHNlXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gSWYgd2UgaGF2ZSBhIGJ1ZmZlciBpbiBvcHRpb25zLCB1c2UgdGhhdCBpbnN0ZWFkIG9mIHRoZSBpbnB1dFxyXG4gICAgICBpZiAob3B0aW9ucy5idWZmZXIgJiYgQnVmZmVyLmlzQnVmZmVyKG9wdGlvbnMuYnVmZmVyKSkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5OmIFVzaW5nIGJ1ZmZlciBmcm9tIG9wdGlvbnMgaW5zdGVhZCBvZiBpbnB1dCcpO1xyXG4gICAgICAgIGZpbGVQYXRoID0gb3B0aW9ucy5idWZmZXI7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIENyZWF0ZSBhIHByb2dyZXNzIHRyYWNrZXJcclxuICAgICAgY29uc3QgcHJvZ3Jlc3NUcmFja2VyID0gbmV3IFByb2dyZXNzVHJhY2tlcihvcHRpb25zLm9uUHJvZ3Jlc3MsIHRoaXMucHJvZ3Jlc3NVcGRhdGVJbnRlcnZhbCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBVc2UgdGhlIGZpbGVUeXBlIHByb3ZpZGVkIGJ5IHRoZSBmcm9udGVuZCAtIG5vIHJlZGV0ZXJtaW5hdGlvblxyXG4gICAgICBjb25zdCBmaWxlVHlwZSA9IG9wdGlvbnMuZmlsZVR5cGU7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZygn8J+UhCBbRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZV0gUHJvY2Vzc2luZzonLCB7XHJcbiAgICAgICAgdHlwZTogZmlsZVR5cGUsXHJcbiAgICAgICAgaXNCdWZmZXI6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCksXHJcbiAgICAgICAgaXNUZW1wb3Jhcnk6IG9wdGlvbnMuaXNUZW1wb3JhcnksXHJcbiAgICAgICAgaXNVcmw6IG9wdGlvbnMudHlwZSA9PT0gJ3VybCcgfHwgb3B0aW9ucy50eXBlID09PSAncGFyZW50dXJsJyxcclxuICAgICAgICBpc1BhcmVudFVybDogb3B0aW9ucy50eXBlID09PSAncGFyZW50dXJsJ1xyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIERlbGVnYXRlIHRvIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5IHdpdGggdGhlIGZpbGVUeXBlIGZyb20gZnJvbnRlbmRcclxuICAgICAgY29uc3QgY29udmVyc2lvblJlc3VsdCA9IGF3YWl0IHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmNvbnZlcnRGaWxlKGZpbGVQYXRoLCB7XHJcbiAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICBmaWxlVHlwZSxcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXJcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoIWNvbnZlcnNpb25SZXN1bHQuc3VjY2Vzcykge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihjb252ZXJzaW9uUmVzdWx0LmVycm9yIHx8ICdDb252ZXJzaW9uIGZhaWxlZCcpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBFeHRyYWN0IGNvbnRlbnQgZnJvbSByZXN1bHRcclxuICAgICAgY29uc3QgY29udGVudCA9IGNvbnZlcnNpb25SZXN1bHQuY29udGVudCB8fCAnJztcclxuICAgICAgXHJcbiAgICAgIGlmICghY29udGVudCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50Jyk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFVzZSBjYXRlZ29yeSBmcm9tIGZyb250ZW5kIGlmIGF2YWlsYWJsZVxyXG4gICAgICBjb25zdCBmaWxlQ2F0ZWdvcnkgPSBvcHRpb25zLmNhdGVnb3J5IHx8IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvblJlc3VsdC5jYXRlZ29yeSB8fCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICd0ZXh0JztcclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGlmIHRoZSBjb252ZXJzaW9uIHJlc3VsdCBoYXMgbXVsdGlwbGUgZmlsZXMgKGZvciBwYXJlbnR1cmwpXHJcbiAgICAgIGNvbnN0IGhhc011bHRpcGxlRmlsZXMgPSBBcnJheS5pc0FycmF5KGNvbnZlcnNpb25SZXN1bHQuZmlsZXMpICYmIGNvbnZlcnNpb25SZXN1bHQuZmlsZXMubGVuZ3RoID4gMDtcclxuICAgICAgXHJcbiAgICAgIGlmIChoYXNNdWx0aXBsZUZpbGVzKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4EgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIENvbnZlcnNpb24gcmVzdWx0IGhhcyAke2NvbnZlcnNpb25SZXN1bHQuZmlsZXMubGVuZ3RofSBmaWxlc2ApO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBTYXZlIHRoZSBjb252ZXJzaW9uIHJlc3VsdCB1c2luZyB0aGUgQ29udmVyc2lvblJlc3VsdE1hbmFnZXJcclxuICAgICAgLy8gRW5zdXJlIHdlJ3JlIGNvbnNpc3RlbnRseSB1c2luZyB0aGUgb3JpZ2luYWwgZmlsZW5hbWVcclxuICAgICAgLy8gUHJpb3JpdHk6IGNvbnZlcnRlcidzIG1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUgPiBjb252ZXJzaW9uUmVzdWx0IGZpZWxkcyA+IG9wdGlvbnMgZmllbGRzXHJcbiAgICAgIGNvbnN0IG9yaWdpbmFsRmlsZU5hbWUgPSAoY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSAmJiBjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUpIHx8XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25SZXN1bHQub3JpZ2luYWxGaWxlTmFtZSB8fFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb252ZXJzaW9uUmVzdWx0Lm5hbWUgfHxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lIHx8XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnMubmFtZTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OmIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBVc2luZyBmaWxlbmFtZSBmb3IgcmVzdWx0OiAke29yaWdpbmFsRmlsZU5hbWV9YCk7XHJcblxyXG4gICAgICAvLyBMb2cgbWV0YWRhdGEgZnJvbSB0aGUgY29udmVyc2lvbiByZXN1bHQgZm9yIGRlYnVnZ2luZ1xyXG4gICAgICBpZiAoY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5SNIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBDb252ZXJzaW9uIHJlc3VsdCBtZXRhZGF0YTpgLCB7XHJcbiAgICAgICAgICBrZXlzOiBPYmplY3Qua2V5cyhjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhKSxcclxuICAgICAgICAgIGhhc09yaWdpbmFsRmlsZU5hbWU6ICdvcmlnaW5hbEZpbGVOYW1lJyBpbiBjb252ZXJzaW9uUmVzdWx0Lm1ldGFkYXRhLFxyXG4gICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucmVzdWx0TWFuYWdlci5zYXZlQ29udmVyc2lvblJlc3VsdCh7XHJcbiAgICAgICAgY29udGVudDogY29udGVudCxcclxuICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgLi4uKGNvbnZlcnNpb25SZXN1bHQubWV0YWRhdGEgfHwge30pLFxyXG4gICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogb3JpZ2luYWxGaWxlTmFtZSAvLyBFbnN1cmUgb3JpZ2luYWwgZmlsZW5hbWUgaXMgaW4gbWV0YWRhdGFcclxuICAgICAgICB9LFxyXG4gICAgICAgIGltYWdlczogY29udmVyc2lvblJlc3VsdC5pbWFnZXMgfHwgW10sXHJcbiAgICAgICAgZmlsZXM6IGNvbnZlcnNpb25SZXN1bHQuZmlsZXMsXHJcbiAgICAgICAgbmFtZTogb3JpZ2luYWxGaWxlTmFtZSwgLy8gVXNlIHRoZSBvcmlnaW5hbCBmaWxlbmFtZSBjb25zaXN0ZW50bHlcclxuICAgICAgICB0eXBlOiBjb252ZXJzaW9uUmVzdWx0LnR5cGUgfHwgZmlsZVR5cGUsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLCAvLyBBbHdheXMgdXNlIHRoZSBmaWxlVHlwZSBmcm9tIGZyb250ZW5kXHJcbiAgICAgICAgb3V0cHV0RGlyOiBvcHRpb25zLm91dHB1dERpcixcclxuICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogb3JpZ2luYWxGaWxlTmFtZSwgLy8gQWRkIGl0IHRvIG9wdGlvbnMgdG9vXHJcbiAgICAgICAgICBjYXRlZ29yeTogZmlsZUNhdGVnb3J5LFxyXG4gICAgICAgICAgcGFnZUNvdW50OiBjb252ZXJzaW9uUmVzdWx0LnBhZ2VDb3VudCxcclxuICAgICAgICAgIHNsaWRlQ291bnQ6IGNvbnZlcnNpb25SZXN1bHQuc2xpZGVDb3VudCxcclxuICAgICAgICAgIGhhc011bHRpcGxlRmlsZXNcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coYOKchSBGaWxlIGNvbnZlcnNpb24gY29tcGxldGVkIGluICR7RGF0ZS5ub3coKSAtIHN0YXJ0VGltZX1tczpgLCB7XHJcbiAgICAgICAgZmlsZTogZmlsZVBhdGgsXHJcbiAgICAgICAgb3V0cHV0UGF0aDogcmVzdWx0Lm91dHB1dFBhdGhcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBFbmQgdGltZXIgZm9yIHN1Y2Nlc3NmdWwgY29udmVyc2lvblxyXG4gICAgICBjb25zb2xlLnRpbWVFbmQodGltZUxhYmVsKTtcclxuXHJcbiAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS50aW1lRW5kKHRpbWVMYWJlbCk7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gQ29udmVyc2lvbiBlcnJvciBjYXVnaHQgaW4gRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZS5jb252ZXJ0Jyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBBbHdheXMgaW5jbHVkZSBmaWxlVHlwZSBpbiBlcnJvciByZXN1bHRzXHJcbiAgICAgIGNvbnN0IGZpbGVUeXBlID0gb3B0aW9ucy5maWxlVHlwZSB8fCAndW5rbm93bic7XHJcbiAgICAgIFxyXG4gICAgICAvLyBEZXRhaWxlZCBlcnJvciBsb2dnaW5nXHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBFcnJvciBkZXRhaWxzOicsIHtcclxuICAgICAgICBuYW1lOiBlcnJvci5uYW1lLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxyXG4gICAgICAgIGNvZGU6IGVycm9yLmNvZGUsXHJcbiAgICAgICAgdHlwZTogdHlwZW9mIGVycm9yXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgY29udmVydGVyIHJlZ2lzdHJ5IHN0YXRlXHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBDb252ZXJ0ZXIgcmVnaXN0cnkgc3RhdGUgYXQgZXJyb3IgdGltZTonLCB7XHJcbiAgICAgICAgY29udmVydGVyUmVnaXN0cnlMb2FkZWQ6ICEhZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5LFxyXG4gICAgICAgIGhhc0NvbnZlcnRlcnM6ICEhKGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSAmJiBnbG9iYWwuY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycyksXHJcbiAgICAgICAgYXZhaWxhYmxlQ29udmVydGVyczogZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5ICYmIGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzID8gXHJcbiAgICAgICAgICBPYmplY3Qua2V5cyhnbG9iYWwuY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycykgOiAnbm9uZScsXHJcbiAgICAgICAgdW5pZmllZENvbnZlcnRlckZhY3RvcnlMb2FkZWQ6ICEhdW5pZmllZENvbnZlcnRlckZhY3RvcnksXHJcbiAgICAgICAgaGFzQ29udmVydEZpbGU6IHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5ID8gdHlwZW9mIHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmNvbnZlcnRGaWxlID09PSAnZnVuY3Rpb24nIDogZmFsc2VcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBlcnJvckluZm8gPSB7XHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLCAvLyBBbHdheXMgaW5jbHVkZSBmaWxlVHlwZVxyXG4gICAgICAgIHR5cGU6IG9wdGlvbnMudHlwZSxcclxuICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgICAgaXNCdWZmZXI6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCksXHJcbiAgICAgICAgYnVmZmVyTGVuZ3RoOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpID8gZmlsZVBhdGgubGVuZ3RoIDogdW5kZWZpbmVkLFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcclxuICAgICAgICBjb252ZXJ0ZXJzTG9hZGVkOiAhIWdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSAvLyBDaGVjayBpZiBjb252ZXJ0ZXJzIHdlcmUgbG9hZGVkXHJcbiAgICAgIH07XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIENvbnZlcnNpb24gZmFpbGVkOicsIGVycm9ySW5mbyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDb25zdHJ1Y3QgYSB1c2VyLWZyaWVuZGx5IGVycm9yIG1lc3NhZ2VcclxuICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSBcclxuICAgICAgICA/IGBGYWlsZWQgdG8gY29udmVydCAke29wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCAnZmlsZSd9OiAke2Vycm9yLm1lc3NhZ2V9YFxyXG4gICAgICAgIDogYEZhaWxlZCB0byBjb252ZXJ0ICR7ZmlsZVBhdGh9OiAke2Vycm9yLm1lc3NhZ2V9YDtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcclxuICAgICAgICBkZXRhaWxzOiBlcnJvckluZm8sXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlIC8vIEV4cGxpY2l0bHkgaW5jbHVkZSBmaWxlVHlwZSBpbiBlcnJvciByZXN1bHRcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNldHMgdXAgdGhlIG91dHB1dCBkaXJlY3RvcnkgZm9yIGNvbnZlcnNpb25zXHJcbiAgICovXHJcbiAgYXN5bmMgc2V0dXBPdXRwdXREaXJlY3Rvcnkob3V0cHV0RGlyKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBkaXJUb1NldHVwID0gb3V0cHV0RGlyIHx8IHRoaXMuZGVmYXVsdE91dHB1dERpcjtcclxuICAgICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLmNyZWF0ZURpcmVjdG9yeShkaXJUb1NldHVwKTtcclxuICAgICAgY29uc29sZS5sb2coJ/Cfk4EgT3V0cHV0IGRpcmVjdG9yeSByZWFkeTonLCBkaXJUb1NldHVwKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gc2V0IHVwIG91dHB1dCBkaXJlY3Rvcnk6JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gbmV3IEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UoKTsiXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU07RUFBRUM7QUFBSSxDQUFDLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDbkMsTUFBTTtFQUFFRTtBQUFVLENBQUMsR0FBR0YsT0FBTyxDQUFDLGdCQUFnQixDQUFDO0FBQy9DLE1BQU07RUFBRUc7QUFBVSxDQUFDLEdBQUdILE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDckMsTUFBTUksRUFBRSxHQUFHSixPQUFPLENBQUMsSUFBSSxDQUFDO0FBQ3hCLE1BQU1LLGFBQWEsR0FBR0YsU0FBUyxDQUFDQyxFQUFFLENBQUNFLFFBQVEsQ0FBQztBQUM1QyxNQUFNO0VBQUVDLFFBQVEsRUFBRUM7QUFBa0IsQ0FBQyxHQUFHUixPQUFPLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDO0FBQ3hFLE1BQU1TLHVCQUF1QixHQUFHVCxPQUFPLENBQUMsMkJBQTJCLENBQUM7QUFDcEU7QUFDQSxNQUFNO0VBQ0pVLFdBQVc7RUFDWEMsbUJBQW1CO0VBQ25CQyxjQUFjO0VBQ2RD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