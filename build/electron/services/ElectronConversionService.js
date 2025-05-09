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
const FileSystemService = require('./FileSystemService');
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

// Import UnifiedConverterFactory
const unifiedConverterFactory = require('../converters/UnifiedConverterFactory');

// Initialize the converter factory
unifiedConverterFactory.initialize().catch(error => {
  console.error('❌ Failed to initialize converter factory:', error);
});

// Function to get correct converter registry path for CommonJS
const getConverterRegistryPath = () => {
  // In development
  if (process.env.NODE_ENV === 'development') {
    return path.join(__dirname, 'conversion/ConverterRegistry.js');
  }
  // In production
  return path.join(app.getAppPath(), 'src/electron/services/conversion/ConverterRegistry.js');
};

// Initialize converters using CommonJS require
(function () {
  try {
    console.log('🔄 [VERBOSE] Starting converters initialization');
    console.time('🕒 [VERBOSE] Converters initialization time');
    const converterRegistryPath = getConverterRegistryPath();
    console.log('🔍 [VERBOSE] Loading converter registry from path:', converterRegistryPath);
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

    // Use CommonJS require instead of dynamic import
    console.log('🔄 [VERBOSE] Using CommonJS require for converter registry');
    let converterRegistryModule;
    try {
      // Try the primary path first
      converterRegistryModule = require(converterRegistryPath);
      console.log('📦 [VERBOSE] Require successful. Module structure:', {
        keys: Object.keys(converterRegistryModule),
        hasConverterRegistry: 'ConverterRegistry' in converterRegistryModule,
        hasDefaultExport: 'default' in converterRegistryModule,
        exportTypes: Object.entries(converterRegistryModule).map(([key, value]) => `${key}: ${typeof value}${value && typeof value === 'object' ? ` with keys [${Object.keys(value).join(', ')}]` : ''}`)
      });
    } catch (requireError) {
      console.error('❌ [VERBOSE] Require failed with error:', requireError);
      console.log('🔍 [VERBOSE] Require error details:', {
        name: requireError.name,
        message: requireError.message,
        stack: requireError.stack,
        code: requireError.code,
        path: converterRegistryPath
      });

      // Try the direct path as a fallback
      console.log('🔄 [VERBOSE] Trying direct path as fallback');
      try {
        converterRegistryModule = require(path.join(__dirname, 'conversion', 'ConverterRegistry.js'));
        console.log('✅ [VERBOSE] Direct path require successful');
      } catch (directError) {
        console.error('❌ [VERBOSE] Direct path require also failed:', directError.message);
        throw new Error(`Could not load ConverterRegistry: ${requireError.message}`);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsIlBhdGhVdGlscyIsInByb21pc2lmeSIsImZzIiwicmVhZEZpbGVBc3luYyIsInJlYWRGaWxlIiwiRmlsZVN5c3RlbVNlcnZpY2UiLCJDb252ZXJzaW9uUmVzdWx0TWFuYWdlciIsImdldEZpbGVUeXBlIiwiZ2V0RmlsZUhhbmRsaW5nSW5mbyIsIkhBTkRMSU5HX1RZUEVTIiwiQ09OVkVSVEVSX0NPTkZJRyIsIlByb2dyZXNzVHJhY2tlciIsImNvbnZlcnRUb01hcmtkb3duIiwicmVnaXN0ZXJDb252ZXJ0ZXIiLCJyZWdpc3RlckNvbnZlcnRlckZhY3RvcnkiLCJjb25zb2xlIiwibG9nIiwiaGFuZGxpbmdUeXBlcyIsImZpbGVDb25maWciLCJ1bmlmaWVkQ29udmVydGVyRmFjdG9yeSIsImluaXRpYWxpemUiLCJjYXRjaCIsImVycm9yIiwiZ2V0Q29udmVydGVyUmVnaXN0cnlQYXRoIiwicHJvY2VzcyIsImVudiIsIk5PREVfRU5WIiwiam9pbiIsIl9fZGlybmFtZSIsImdldEFwcFBhdGgiLCJ0aW1lIiwiY29udmVydGVyUmVnaXN0cnlQYXRoIiwiZW52aXJvbm1lbnQiLCJhcHBQYXRoIiwiY3VycmVudERpciIsImlzUGFja2FnZWQiLCJmaWxlRXhpc3RzIiwiZXhpc3RzU3luYyIsImRpcm5hbWUiLCJyZWFkZGlyU3luYyIsInNlcnZpY2VzIiwiY29udmVyc2lvbiIsImRhdGEiLCJjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSIsImtleXMiLCJPYmplY3QiLCJoYXNDb252ZXJ0ZXJSZWdpc3RyeSIsImhhc0RlZmF1bHRFeHBvcnQiLCJleHBvcnRUeXBlcyIsImVudHJpZXMiLCJtYXAiLCJrZXkiLCJ2YWx1ZSIsInJlcXVpcmVFcnJvciIsIm5hbWUiLCJtZXNzYWdlIiwic3RhY2siLCJjb2RlIiwiZGlyZWN0RXJyb3IiLCJFcnJvciIsImNvbnZlcnRlclJlZ2lzdHJ5IiwiQ29udmVydGVyUmVnaXN0cnkiLCJkZWZhdWx0IiwiaGFzQ29udmVydGVycyIsImNvbnZlcnRlcnMiLCJoYXNDb252ZXJ0VG9NYXJrZG93biIsImhhc0dldENvbnZlcnRlckJ5RXh0ZW5zaW9uIiwiZ2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJoYXNHZXRDb252ZXJ0ZXJCeU1pbWVUeXBlIiwiZ2V0Q29udmVydGVyQnlNaW1lVHlwZSIsImF2YWlsYWJsZUNvbnZlcnRlcnMiLCJ0aW1lRW5kIiwiZ2xvYmFsIiwidHlwZSIsImhhc1N0YWNrIiwiRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZSIsImNvbnN0cnVjdG9yIiwiZmlsZVN5c3RlbSIsInJlc3VsdE1hbmFnZXIiLCJwcm9ncmVzc1VwZGF0ZUludGVydmFsIiwiZGVmYXVsdE91dHB1dERpciIsImdldFBhdGgiLCJjb252ZXJ0IiwiZmlsZVBhdGgiLCJvcHRpb25zIiwidHJhY2UiLCJzdGFydFRpbWUiLCJEYXRlIiwibm93Iiwib3V0cHV0RGlyIiwiaW5wdXRUeXBlIiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJpbnB1dExlbmd0aCIsImxlbmd0aCIsInVuZGVmaW5lZCIsImZpbGVUeXBlIiwiaGFzQnVmZmVySW5PcHRpb25zIiwiYnVmZmVyIiwiYnVmZmVyTGVuZ3RoIiwiYXBpS2V5IiwibWlzdHJhbEFwaUtleSIsImNvbnZlcnRlclJlZ2lzdHJ5TG9hZGVkIiwidW5pZmllZENvbnZlcnRlckZhY3RvcnlMb2FkZWQiLCJoYXNDb252ZXJ0RmlsZSIsImNvbnZlcnRGaWxlIiwicHJvZ3Jlc3NUcmFja2VyIiwib25Qcm9ncmVzcyIsImlzVGVtcG9yYXJ5IiwiaXNVcmwiLCJpc1BhcmVudFVybCIsImNvbnZlcnNpb25SZXN1bHQiLCJzdWNjZXNzIiwiY29udGVudCIsImZpbGVDYXRlZ29yeSIsImNhdGVnb3J5IiwiaGFzTXVsdGlwbGVGaWxlcyIsIkFycmF5IiwiaXNBcnJheSIsImZpbGVzIiwicmVzdWx0Iiwic2F2ZUNvbnZlcnNpb25SZXN1bHQiLCJtZXRhZGF0YSIsImltYWdlcyIsIm9yaWdpbmFsRmlsZU5hbWUiLCJwYWdlQ291bnQiLCJzbGlkZUNvdW50IiwiZmlsZSIsIm91dHB1dFBhdGgiLCJlcnJvckluZm8iLCJjb252ZXJ0ZXJzTG9hZGVkIiwiZXJyb3JNZXNzYWdlIiwiZGV0YWlscyIsInNldHVwT3V0cHV0RGlyZWN0b3J5IiwiZGlyVG9TZXR1cCIsImNyZWF0ZURpcmVjdG9yeSIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZS5qc1xyXG4gKiBIYW5kbGVzIGRvY3VtZW50IGNvbnZlcnNpb24gdXNpbmcgbmF0aXZlIGZpbGUgc3lzdGVtIG9wZXJhdGlvbnMgaW4gRWxlY3Ryb24uXHJcbiAqIENvb3JkaW5hdGVzIGNvbnZlcnNpb24gcHJvY2Vzc2VzIGFuZCBkZWxlZ2F0ZXMgdG8gdGhlIHNoYXJlZCBjb252ZXJzaW9uIHV0aWxpdGllcy5cclxuICpcclxuICogSU1QT1JUQU5UOiBXaGVuIGRldGVybWluaW5nIGZpbGUgdHlwZXMgZm9yIGNvbnZlcnNpb24sIHdlIGV4dHJhY3QgdGhlIGZpbGUgZXh0ZW5zaW9uXHJcbiAqIGRpcmVjdGx5IHJhdGhlciB0aGFuIHVzaW5nIHRoZSBjYXRlZ29yeSBmcm9tIGdldEZpbGVUeXBlLiBUaGlzIGVuc3VyZXMgdGhhdCB3ZSB1c2VcclxuICogdGhlIHNwZWNpZmljIGNvbnZlcnRlciByZWdpc3RlcmVkIGZvciBlYWNoIGZpbGUgdHlwZSAoZS5nLiwgJ3BkZicsICdkb2N4JywgJ3BwdHgnKVxyXG4gKiByYXRoZXIgdGhhbiB0cnlpbmcgdG8gdXNlIGEgY29udmVydGVyIGZvciB0aGUgY2F0ZWdvcnkgKCdkb2N1bWVudHMnKS5cclxuICpcclxuICogU3BlY2lhbCBoYW5kbGluZyBpcyBpbXBsZW1lbnRlZCBmb3IgZGF0YSBmaWxlcyAoQ1NWLCBYTFNYKSB0byBlbnN1cmUgdGhleSB1c2UgdGhlXHJcbiAqIGNvcnJlY3QgY29udmVydGVyIGJhc2VkIG9uIGZpbGUgZXh0ZW5zaW9uLiBJZiB0aGUgZXh0ZW5zaW9uIGNhbid0IGJlIGRldGVybWluZWQsXHJcbiAqIHdlIGRlZmF1bHQgdG8gJ2NzdicgcmF0aGVyIHRoYW4gdXNpbmcgdGhlIGNhdGVnb3J5ICdkYXRhJy5cclxuICpcclxuICogRm9yIENTViBmaWxlcyBzZW50IGFzIHRleHQgY29udGVudCwgd2UgZGV0ZWN0IENTViBjb250ZW50IGJ5IGNoZWNraW5nIGZvciBjb21tYXMsIHRhYnMsXHJcbiAqIGFuZCBuZXdsaW5lcywgYW5kIHByb2Nlc3MgaXQgZGlyZWN0bHkgcmF0aGVyIHRoYW4gdHJlYXRpbmcgaXQgYXMgYSBmaWxlIHBhdGguIFRoaXMgZml4ZXNcclxuICogdGhlIFwiRmlsZSBub3QgZm91bmQgb3IgaW5hY2Nlc3NpYmxlXCIgZXJyb3IgdGhhdCBvY2N1cnJlZCB3aGVuIHRoZSBzeXN0ZW0gdHJpZWQgdG8gaW50ZXJwcmV0XHJcbiAqIENTViBjb250ZW50IGFzIGEgZmlsZSBwYXRoLlxyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IHsgYXBwIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCB7IFBhdGhVdGlscyB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvcGF0aHMnKTtcclxuY29uc3QgeyBwcm9taXNpZnkgfSA9IHJlcXVpcmUoJ3V0aWwnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcycpO1xyXG5jb25zdCByZWFkRmlsZUFzeW5jID0gcHJvbWlzaWZ5KGZzLnJlYWRGaWxlKTtcclxuY29uc3QgRmlsZVN5c3RlbVNlcnZpY2UgPSByZXF1aXJlKCcuL0ZpbGVTeXN0ZW1TZXJ2aWNlJyk7XHJcbmNvbnN0IENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyID0gcmVxdWlyZSgnLi9Db252ZXJzaW9uUmVzdWx0TWFuYWdlcicpO1xyXG4vLyBJbXBvcnQgbG9jYWwgdXRpbGl0aWVzXHJcbmNvbnN0IHsgXHJcbiAgZ2V0RmlsZVR5cGUsXHJcbiAgZ2V0RmlsZUhhbmRsaW5nSW5mbyxcclxuICBIQU5ETElOR19UWVBFUyxcclxuICBDT05WRVJURVJfQ09ORklHXHJcbn0gPSByZXF1aXJlKCcuLi91dGlscy9maWxlcycpO1xyXG5jb25zdCB7IFxyXG4gIFByb2dyZXNzVHJhY2tlciwgXHJcbiAgY29udmVydFRvTWFya2Rvd24sIFxyXG4gIHJlZ2lzdGVyQ29udmVydGVyLFxyXG4gIHJlZ2lzdGVyQ29udmVydGVyRmFjdG9yeVxyXG59ID0gcmVxdWlyZSgnLi4vdXRpbHMvY29udmVyc2lvbicpO1xyXG5cclxuLy8gTG9nIGF2YWlsYWJsZSBmaWxlIGhhbmRsaW5nIGNhcGFiaWxpdGllc1xyXG5jb25zb2xlLmxvZygn8J+ThCBJbml0aWFsaXplZCB3aXRoIGZpbGUgaGFuZGxpbmc6Jywge1xyXG4gIGhhbmRsaW5nVHlwZXM6IEhBTkRMSU5HX1RZUEVTLFxyXG4gIGZpbGVDb25maWc6IENPTlZFUlRFUl9DT05GSUdcclxufSk7XHJcblxyXG4vLyBJbXBvcnQgVW5pZmllZENvbnZlcnRlckZhY3RvcnlcclxuY29uc3QgdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPSByZXF1aXJlKCcuLi9jb252ZXJ0ZXJzL1VuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5Jyk7XHJcblxyXG4vLyBJbml0aWFsaXplIHRoZSBjb252ZXJ0ZXIgZmFjdG9yeVxyXG51bmlmaWVkQ29udmVydGVyRmFjdG9yeS5pbml0aWFsaXplKCkuY2F0Y2goZXJyb3IgPT4ge1xyXG4gIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBjb252ZXJ0ZXIgZmFjdG9yeTonLCBlcnJvcik7XHJcbn0pO1xyXG5cclxuLy8gRnVuY3Rpb24gdG8gZ2V0IGNvcnJlY3QgY29udmVydGVyIHJlZ2lzdHJ5IHBhdGggZm9yIENvbW1vbkpTXHJcbmNvbnN0IGdldENvbnZlcnRlclJlZ2lzdHJ5UGF0aCA9ICgpID0+IHtcclxuICAvLyBJbiBkZXZlbG9wbWVudFxyXG4gIGlmIChwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50Jykge1xyXG4gICAgcmV0dXJuIHBhdGguam9pbihfX2Rpcm5hbWUsICdjb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyk7XHJcbiAgfVxyXG4gIC8vIEluIHByb2R1Y3Rpb25cclxuICByZXR1cm4gcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpO1xyXG59O1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBjb252ZXJ0ZXJzIHVzaW5nIENvbW1vbkpTIHJlcXVpcmVcclxuKGZ1bmN0aW9uKCkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UhCBbVkVSQk9TRV0gU3RhcnRpbmcgY29udmVydGVycyBpbml0aWFsaXphdGlvbicpO1xyXG4gICAgY29uc29sZS50aW1lKCfwn5WSIFtWRVJCT1NFXSBDb252ZXJ0ZXJzIGluaXRpYWxpemF0aW9uIHRpbWUnKTtcclxuICAgIFxyXG4gICAgY29uc3QgY29udmVydGVyUmVnaXN0cnlQYXRoID0gZ2V0Q29udmVydGVyUmVnaXN0cnlQYXRoKCk7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gTG9hZGluZyBjb252ZXJ0ZXIgcmVnaXN0cnkgZnJvbSBwYXRoOicsIGNvbnZlcnRlclJlZ2lzdHJ5UGF0aCk7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gRW52aXJvbm1lbnQgZGV0YWlsczonLCB7XHJcbiAgICAgIGVudmlyb25tZW50OiBwcm9jZXNzLmVudi5OT0RFX0VOViB8fCAndW5rbm93bicsXHJcbiAgICAgIGFwcFBhdGg6IGFwcC5nZXRBcHBQYXRoKCksXHJcbiAgICAgIGN1cnJlbnREaXI6IF9fZGlybmFtZSxcclxuICAgICAgaXNQYWNrYWdlZDogYXBwLmlzUGFja2FnZWRcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBDaGVjayBpZiB0aGUgZmlsZSBleGlzdHNcclxuICAgIGNvbnN0IGZpbGVFeGlzdHMgPSBmcy5leGlzdHNTeW5jKGNvbnZlcnRlclJlZ2lzdHJ5UGF0aCk7XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gUmVnaXN0cnkgZmlsZSBleGlzdHMgY2hlY2s6JywgZmlsZUV4aXN0cyk7XHJcbiAgICBcclxuICAgIGlmICghZmlsZUV4aXN0cykge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIFJlZ2lzdHJ5IGZpbGUgZG9lcyBub3QgZXhpc3QgYXQgcGF0aDonLCBjb252ZXJ0ZXJSZWdpc3RyeVBhdGgpO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+TgiBbVkVSQk9TRV0gRGlyZWN0b3J5IGNvbnRlbnRzOicsIHtcclxuICAgICAgICBkaXJuYW1lOiBmcy5leGlzdHNTeW5jKF9fZGlybmFtZSkgPyBmcy5yZWFkZGlyU3luYyhfX2Rpcm5hbWUpIDogJ2RpcmVjdG9yeSBub3QgZm91bmQnLFxyXG4gICAgICAgIGFwcFBhdGg6IGZzLmV4aXN0c1N5bmMoYXBwLmdldEFwcFBhdGgoKSkgPyBmcy5yZWFkZGlyU3luYyhhcHAuZ2V0QXBwUGF0aCgpKSA6ICdkaXJlY3Rvcnkgbm90IGZvdW5kJyxcclxuICAgICAgICBzZXJ2aWNlczogZnMuZXhpc3RzU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nKSkgP1xyXG4gICAgICAgICAgZnMucmVhZGRpclN5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJykpIDogJ2RpcmVjdG9yeSBub3QgZm91bmQnLFxyXG4gICAgICAgIGNvbnZlcnNpb246IGZzLmV4aXN0c1N5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJ2NvbnZlcnNpb24nKSkgP1xyXG4gICAgICAgICAgZnMucmVhZGRpclN5bmMocGF0aC5qb2luKF9fZGlybmFtZSwgJ2NvbnZlcnNpb24nKSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgZGF0YTogZnMuZXhpc3RzU3luYyhwYXRoLmpvaW4oX19kaXJuYW1lLCAnY29udmVyc2lvbi9kYXRhJykpID9cclxuICAgICAgICAgIGZzLnJlYWRkaXJTeW5jKHBhdGguam9pbihfX2Rpcm5hbWUsICdjb252ZXJzaW9uL2RhdGEnKSkgOiAnZGlyZWN0b3J5IG5vdCBmb3VuZCdcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFVzZSBDb21tb25KUyByZXF1aXJlIGluc3RlYWQgb2YgZHluYW1pYyBpbXBvcnRcclxuICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBVc2luZyBDb21tb25KUyByZXF1aXJlIGZvciBjb252ZXJ0ZXIgcmVnaXN0cnknKTtcclxuICAgIFxyXG4gICAgbGV0IGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlO1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVHJ5IHRoZSBwcmltYXJ5IHBhdGggZmlyc3RcclxuICAgICAgY29udmVydGVyUmVnaXN0cnlNb2R1bGUgPSByZXF1aXJlKGNvbnZlcnRlclJlZ2lzdHJ5UGF0aCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5OmIFtWRVJCT1NFXSBSZXF1aXJlIHN1Y2Nlc3NmdWwuIE1vZHVsZSBzdHJ1Y3R1cmU6Jywge1xyXG4gICAgICAgIGtleXM6IE9iamVjdC5rZXlzKGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlKSxcclxuICAgICAgICBoYXNDb252ZXJ0ZXJSZWdpc3RyeTogJ0NvbnZlcnRlclJlZ2lzdHJ5JyBpbiBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSxcclxuICAgICAgICBoYXNEZWZhdWx0RXhwb3J0OiAnZGVmYXVsdCcgaW4gY29udmVydGVyUmVnaXN0cnlNb2R1bGUsXHJcbiAgICAgICAgZXhwb3J0VHlwZXM6IE9iamVjdC5lbnRyaWVzKGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlKS5tYXAoKFtrZXksIHZhbHVlXSkgPT5cclxuICAgICAgICAgIGAke2tleX06ICR7dHlwZW9mIHZhbHVlfSR7dmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyA/IGAgd2l0aCBrZXlzIFske09iamVjdC5rZXlzKHZhbHVlKS5qb2luKCcsICcpfV1gIDogJyd9YFxyXG4gICAgICAgIClcclxuICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChyZXF1aXJlRXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBSZXF1aXJlIGZhaWxlZCB3aXRoIGVycm9yOicsIHJlcXVpcmVFcnJvcik7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBSZXF1aXJlIGVycm9yIGRldGFpbHM6Jywge1xyXG4gICAgICAgIG5hbWU6IHJlcXVpcmVFcnJvci5uYW1lLFxyXG4gICAgICAgIG1lc3NhZ2U6IHJlcXVpcmVFcnJvci5tZXNzYWdlLFxyXG4gICAgICAgIHN0YWNrOiByZXF1aXJlRXJyb3Iuc3RhY2ssXHJcbiAgICAgICAgY29kZTogcmVxdWlyZUVycm9yLmNvZGUsXHJcbiAgICAgICAgcGF0aDogY29udmVydGVyUmVnaXN0cnlQYXRoXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gVHJ5IHRoZSBkaXJlY3QgcGF0aCBhcyBhIGZhbGxiYWNrXHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SEIFtWRVJCT1NFXSBUcnlpbmcgZGlyZWN0IHBhdGggYXMgZmFsbGJhY2snKTtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZSA9IHJlcXVpcmUocGF0aC5qb2luKF9fZGlybmFtZSwgJ2NvbnZlcnNpb24nLCAnQ29udmVydGVyUmVnaXN0cnkuanMnKSk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBbVkVSQk9TRV0gRGlyZWN0IHBhdGggcmVxdWlyZSBzdWNjZXNzZnVsJyk7XHJcbiAgICAgIH0gY2F0Y2ggKGRpcmVjdEVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBEaXJlY3QgcGF0aCByZXF1aXJlIGFsc28gZmFpbGVkOicsIGRpcmVjdEVycm9yLm1lc3NhZ2UpO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IGxvYWQgQ29udmVydGVyUmVnaXN0cnk6ICR7cmVxdWlyZUVycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgY29uc3QgY29udmVydGVyUmVnaXN0cnkgPSBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZS5Db252ZXJ0ZXJSZWdpc3RyeSB8fCBjb252ZXJ0ZXJSZWdpc3RyeU1vZHVsZS5kZWZhdWx0IHx8IGNvbnZlcnRlclJlZ2lzdHJ5TW9kdWxlO1xyXG4gICAgXHJcbiAgICAvLyBMb2cgZGV0YWlsZWQgaW5mb3JtYXRpb24gYWJvdXQgdGhlIGNvbnZlcnRlciByZWdpc3RyeVxyXG4gICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIENvbnZlcnRlciByZWdpc3RyeSBzdHJ1Y3R1cmU6Jywge1xyXG4gICAgICBoYXNDb252ZXJ0ZXJzOiAhIShjb252ZXJ0ZXJSZWdpc3RyeSAmJiBjb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzKSxcclxuICAgICAgaGFzQ29udmVydFRvTWFya2Rvd246IHR5cGVvZiBjb252ZXJ0ZXJSZWdpc3RyeT8uY29udmVydFRvTWFya2Rvd24gPT09ICdmdW5jdGlvbicsXHJcbiAgICAgIGhhc0dldENvbnZlcnRlckJ5RXh0ZW5zaW9uOiB0eXBlb2YgY29udmVydGVyUmVnaXN0cnk/LmdldENvbnZlcnRlckJ5RXh0ZW5zaW9uID09PSAnZnVuY3Rpb24nLFxyXG4gICAgICBoYXNHZXRDb252ZXJ0ZXJCeU1pbWVUeXBlOiB0eXBlb2YgY29udmVydGVyUmVnaXN0cnk/LmdldENvbnZlcnRlckJ5TWltZVR5cGUgPT09ICdmdW5jdGlvbicsXHJcbiAgICAgIGF2YWlsYWJsZUNvbnZlcnRlcnM6IGNvbnZlcnRlclJlZ2lzdHJ5ICYmIGNvbnZlcnRlclJlZ2lzdHJ5LmNvbnZlcnRlcnMgP1xyXG4gICAgICAgIE9iamVjdC5rZXlzKGNvbnZlcnRlclJlZ2lzdHJ5LmNvbnZlcnRlcnMpIDogJ25vbmUnXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gUmVnaXN0ZXIgdGhlIGNvbnZlcnRlciBmYWN0b3J5XHJcbiAgICByZWdpc3RlckNvbnZlcnRlckZhY3RvcnkoJ2NvbnZlcnRlclJlZ2lzdHJ5JywgY29udmVydGVyUmVnaXN0cnkpO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLnRpbWVFbmQoJ/CflZIgW1ZFUkJPU0VdIENvbnZlcnRlcnMgaW5pdGlhbGl6YXRpb24gdGltZScpO1xyXG4gICAgY29uc29sZS5sb2coJ+KchSBbVkVSQk9TRV0gQ29udmVydGVycyByZWdpc3RlcmVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgXHJcbiAgICAvLyBTdG9yZSBpbiBnbG9iYWwgZm9yIGVycm9yIGNoZWNraW5nXHJcbiAgICBnbG9iYWwuY29udmVydGVyUmVnaXN0cnkgPSBjb252ZXJ0ZXJSZWdpc3RyeTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS50aW1lRW5kKCfwn5WSIFtWRVJCT1NFXSBDb252ZXJ0ZXJzIGluaXRpYWxpemF0aW9uIHRpbWUnKTtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gRmFpbGVkIHRvIHJlZ2lzdGVyIGNvbnZlcnRlcnM6JywgZXJyb3IpO1xyXG4gICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBFcnJvciBkZXRhaWxzOicsIGVycm9yLnN0YWNrKTtcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBFcnJvciBvYmplY3Q6Jywge1xyXG4gICAgICBuYW1lOiBlcnJvci5uYW1lLFxyXG4gICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICBjb2RlOiBlcnJvci5jb2RlLFxyXG4gICAgICB0eXBlOiB0eXBlb2YgZXJyb3IsXHJcbiAgICAgIGhhc1N0YWNrOiAhIWVycm9yLnN0YWNrXHJcbiAgICB9KTtcclxuICB9XHJcbn0pKCk7XHJcblxyXG5jbGFzcyBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIHtcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuZmlsZVN5c3RlbSA9IEZpbGVTeXN0ZW1TZXJ2aWNlO1xyXG4gICAgdGhpcy5yZXN1bHRNYW5hZ2VyID0gQ29udmVyc2lvblJlc3VsdE1hbmFnZXI7XHJcbiAgICB0aGlzLnByb2dyZXNzVXBkYXRlSW50ZXJ2YWwgPSAyNTA7IC8vIFVwZGF0ZSBwcm9ncmVzcyBldmVyeSAyNTBtc1xyXG4gICAgdGhpcy5kZWZhdWx0T3V0cHV0RGlyID0gcGF0aC5qb2luKGFwcC5nZXRQYXRoKCd1c2VyRGF0YScpLCAnY29udmVyc2lvbnMnKTtcclxuICAgIGNvbnNvbGUubG9nKCdFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIGluaXRpYWxpemVkIHdpdGggZGVmYXVsdCBvdXRwdXQgZGlyZWN0b3J5OicsIHRoaXMuZGVmYXVsdE91dHB1dERpcik7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDb252ZXJ0cyBhIGZpbGUgdG8gbWFya2Rvd24gZm9ybWF0XHJcbiAgICogQHBhcmFtIHtzdHJpbmd8QnVmZmVyfSBmaWxlUGF0aCAtIFBhdGggdG8gdGhlIGZpbGUgb3IgZmlsZSBjb250ZW50IGFzIGJ1ZmZlclxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gLSBDb252ZXJzaW9uIHJlc3VsdFxyXG4gICAqL1xyXG4gIGFzeW5jIGNvbnZlcnQoZmlsZVBhdGgsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgY29uc29sZS5sb2coJ/CflIQgW1ZFUkJPU0VdIEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuY29udmVydCBjYWxsZWQnKTtcclxuICAgIGNvbnNvbGUudGltZSgn8J+VkiBbVkVSQk9TRV0gVG90YWwgY29udmVyc2lvbiB0aW1lJyk7XHJcbiAgICBjb25zb2xlLnRyYWNlKCfwn5SEIFtWRVJCT1NFXSBDb252ZXJ0IG1ldGhvZCBzdGFjayB0cmFjZScpO1xyXG4gICAgXHJcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBWYWxpZGF0ZSBvdXRwdXQgZGlyZWN0b3J5XHJcbiAgICAgIGlmICghb3B0aW9ucy5vdXRwdXREaXIpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIE5vIG91dHB1dCBkaXJlY3RvcnkgcHJvdmlkZWQhJyk7XHJcbiAgICAgICAgY29uc29sZS50aW1lRW5kKCfwn5WSIFtWRVJCT1NFXSBUb3RhbCBjb252ZXJzaW9uIHRpbWUnKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ091dHB1dCBkaXJlY3RvcnkgaXMgcmVxdWlyZWQgZm9yIGNvbnZlcnNpb24nKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coJ/Cfk6UgW1ZFUkJPU0VdIFJlY2VpdmVkIGNvbnZlcnNpb24gcmVxdWVzdDonLCB7XHJcbiAgICAgICAgaW5wdXRUeXBlOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpID8gJ0J1ZmZlcicgOiB0eXBlb2YgZmlsZVBhdGgsXHJcbiAgICAgICAgaW5wdXRMZW5ndGg6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCkgPyBmaWxlUGF0aC5sZW5ndGggOiB1bmRlZmluZWQsXHJcbiAgICAgICAgZmlsZVR5cGU6IG9wdGlvbnMuZmlsZVR5cGUsIC8vIExvZyB0aGUgZmlsZVR5cGUgd2UgcmVjZWl2ZWQgZnJvbSBmcm9udGVuZFxyXG4gICAgICAgIGhhc0J1ZmZlckluT3B0aW9uczogISFvcHRpb25zLmJ1ZmZlcixcclxuICAgICAgICBidWZmZXJMZW5ndGg6IG9wdGlvbnMuYnVmZmVyID8gb3B0aW9ucy5idWZmZXIubGVuZ3RoIDogdW5kZWZpbmVkLFxyXG4gICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICBidWZmZXI6IG9wdGlvbnMuYnVmZmVyID8gYEJ1ZmZlcigke29wdGlvbnMuYnVmZmVyLmxlbmd0aH0pYCA6IHVuZGVmaW5lZCxcclxuICAgICAgICAgIGFwaUtleTogb3B0aW9ucy5hcGlLZXkgPyAn4pyTJyA6ICfinJcnLFxyXG4gICAgICAgICAgbWlzdHJhbEFwaUtleTogb3B0aW9ucy5taXN0cmFsQXBpS2V5ID8gJ+KckycgOiAn4pyXJ1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gQ29udmVyc2lvbiBlbnZpcm9ubWVudDonLCB7XHJcbiAgICAgICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICd1bmtub3duJyxcclxuICAgICAgICBpc1BhY2thZ2VkOiBhcHAuaXNQYWNrYWdlZCxcclxuICAgICAgICBhcHBQYXRoOiBhcHAuZ2V0QXBwUGF0aCgpLFxyXG4gICAgICAgIGNvbnZlcnRlclJlZ2lzdHJ5TG9hZGVkOiAhIWdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSxcclxuICAgICAgICB1bmlmaWVkQ29udmVydGVyRmFjdG9yeUxvYWRlZDogISF1bmlmaWVkQ29udmVydGVyRmFjdG9yeSxcclxuICAgICAgICBoYXNDb252ZXJ0RmlsZTogdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPyB0eXBlb2YgdW5pZmllZENvbnZlcnRlckZhY3RvcnkuY29udmVydEZpbGUgPT09ICdmdW5jdGlvbicgOiBmYWxzZVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIElmIHdlIGhhdmUgYSBidWZmZXIgaW4gb3B0aW9ucywgdXNlIHRoYXQgaW5zdGVhZCBvZiB0aGUgaW5wdXRcclxuICAgICAgaWYgKG9wdGlvbnMuYnVmZmVyICYmIEJ1ZmZlci5pc0J1ZmZlcihvcHRpb25zLmJ1ZmZlcikpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+TpiBVc2luZyBidWZmZXIgZnJvbSBvcHRpb25zIGluc3RlYWQgb2YgaW5wdXQnKTtcclxuICAgICAgICBmaWxlUGF0aCA9IG9wdGlvbnMuYnVmZmVyO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDcmVhdGUgYSBwcm9ncmVzcyB0cmFja2VyXHJcbiAgICAgIGNvbnN0IHByb2dyZXNzVHJhY2tlciA9IG5ldyBQcm9ncmVzc1RyYWNrZXIob3B0aW9ucy5vblByb2dyZXNzLCB0aGlzLnByb2dyZXNzVXBkYXRlSW50ZXJ2YWwpO1xyXG4gICAgICBcclxuICAgICAgLy8gVXNlIHRoZSBmaWxlVHlwZSBwcm92aWRlZCBieSB0aGUgZnJvbnRlbmQgLSBubyByZWRldGVybWluYXRpb25cclxuICAgICAgY29uc3QgZmlsZVR5cGUgPSBvcHRpb25zLmZpbGVUeXBlO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coJ/CflIQgW0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2VdIFByb2Nlc3Npbmc6Jywge1xyXG4gICAgICAgIHR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIGlzQnVmZmVyOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpLFxyXG4gICAgICAgIGlzVGVtcG9yYXJ5OiBvcHRpb25zLmlzVGVtcG9yYXJ5LFxyXG4gICAgICAgIGlzVXJsOiBvcHRpb25zLnR5cGUgPT09ICd1cmwnIHx8IG9wdGlvbnMudHlwZSA9PT0gJ3BhcmVudHVybCcsXHJcbiAgICAgICAgaXNQYXJlbnRVcmw6IG9wdGlvbnMudHlwZSA9PT0gJ3BhcmVudHVybCdcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBEZWxlZ2F0ZSB0byBVbmlmaWVkQ29udmVydGVyRmFjdG9yeSB3aXRoIHRoZSBmaWxlVHlwZSBmcm9tIGZyb250ZW5kXHJcbiAgICAgIGNvbnN0IGNvbnZlcnNpb25SZXN1bHQgPSBhd2FpdCB1bmlmaWVkQ29udmVydGVyRmFjdG9yeS5jb252ZXJ0RmlsZShmaWxlUGF0aCwge1xyXG4gICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgZmlsZVR5cGUsXHJcbiAgICAgICAgcHJvZ3Jlc3NUcmFja2VyXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgaWYgKCFjb252ZXJzaW9uUmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoY29udmVyc2lvblJlc3VsdC5lcnJvciB8fCAnQ29udmVyc2lvbiBmYWlsZWQnKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gRXh0cmFjdCBjb250ZW50IGZyb20gcmVzdWx0XHJcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBjb252ZXJzaW9uUmVzdWx0LmNvbnRlbnQgfHwgJyc7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoIWNvbnRlbnQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudCcpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBVc2UgY2F0ZWdvcnkgZnJvbSBmcm9udGVuZCBpZiBhdmFpbGFibGVcclxuICAgICAgY29uc3QgZmlsZUNhdGVnb3J5ID0gb3B0aW9ucy5jYXRlZ29yeSB8fCBcclxuICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25SZXN1bHQuY2F0ZWdvcnkgfHwgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAndGV4dCc7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBpZiB0aGUgY29udmVyc2lvbiByZXN1bHQgaGFzIG11bHRpcGxlIGZpbGVzIChmb3IgcGFyZW50dXJsKVxyXG4gICAgICBjb25zdCBoYXNNdWx0aXBsZUZpbGVzID0gQXJyYXkuaXNBcnJheShjb252ZXJzaW9uUmVzdWx0LmZpbGVzKSAmJiBjb252ZXJzaW9uUmVzdWx0LmZpbGVzLmxlbmd0aCA+IDA7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoaGFzTXVsdGlwbGVGaWxlcykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OBIFtFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlXSBDb252ZXJzaW9uIHJlc3VsdCBoYXMgJHtjb252ZXJzaW9uUmVzdWx0LmZpbGVzLmxlbmd0aH0gZmlsZXNgKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gU2F2ZSB0aGUgY29udmVyc2lvbiByZXN1bHQgdXNpbmcgdGhlIENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucmVzdWx0TWFuYWdlci5zYXZlQ29udmVyc2lvblJlc3VsdCh7XHJcbiAgICAgICAgY29udGVudDogY29udGVudCxcclxuICAgICAgICBtZXRhZGF0YTogY29udmVyc2lvblJlc3VsdC5tZXRhZGF0YSB8fCB7fSxcclxuICAgICAgICBpbWFnZXM6IGNvbnZlcnNpb25SZXN1bHQuaW1hZ2VzIHx8IFtdLFxyXG4gICAgICAgIGZpbGVzOiBjb252ZXJzaW9uUmVzdWx0LmZpbGVzLFxyXG4gICAgICAgIG5hbWU6IGNvbnZlcnNpb25SZXN1bHQubmFtZSB8fCBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lLFxyXG4gICAgICAgIHR5cGU6IGNvbnZlcnNpb25SZXN1bHQudHlwZSB8fCBmaWxlVHlwZSxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUsIC8vIEFsd2F5cyB1c2UgdGhlIGZpbGVUeXBlIGZyb20gZnJvbnRlbmRcclxuICAgICAgICBvdXRwdXREaXI6IG9wdGlvbnMub3V0cHV0RGlyLFxyXG4gICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICBjYXRlZ29yeTogZmlsZUNhdGVnb3J5LFxyXG4gICAgICAgICAgcGFnZUNvdW50OiBjb252ZXJzaW9uUmVzdWx0LnBhZ2VDb3VudCxcclxuICAgICAgICAgIHNsaWRlQ291bnQ6IGNvbnZlcnNpb25SZXN1bHQuc2xpZGVDb3VudCxcclxuICAgICAgICAgIGhhc011bHRpcGxlRmlsZXNcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coYOKchSBGaWxlIGNvbnZlcnNpb24gY29tcGxldGVkIGluICR7RGF0ZS5ub3coKSAtIHN0YXJ0VGltZX1tczpgLCB7XHJcbiAgICAgICAgZmlsZTogZmlsZVBhdGgsXHJcbiAgICAgICAgb3V0cHV0UGF0aDogcmVzdWx0Lm91dHB1dFBhdGhcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICBcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUudGltZUVuZCgn8J+VkiBbVkVSQk9TRV0gVG90YWwgY29udmVyc2lvbiB0aW1lJyk7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gQ29udmVyc2lvbiBlcnJvciBjYXVnaHQgaW4gRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZS5jb252ZXJ0Jyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBBbHdheXMgaW5jbHVkZSBmaWxlVHlwZSBpbiBlcnJvciByZXN1bHRzXHJcbiAgICAgIGNvbnN0IGZpbGVUeXBlID0gb3B0aW9ucy5maWxlVHlwZSB8fCAndW5rbm93bic7XHJcbiAgICAgIFxyXG4gICAgICAvLyBEZXRhaWxlZCBlcnJvciBsb2dnaW5nXHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBFcnJvciBkZXRhaWxzOicsIHtcclxuICAgICAgICBuYW1lOiBlcnJvci5uYW1lLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxyXG4gICAgICAgIGNvZGU6IGVycm9yLmNvZGUsXHJcbiAgICAgICAgdHlwZTogdHlwZW9mIGVycm9yXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgY29udmVydGVyIHJlZ2lzdHJ5IHN0YXRlXHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBDb252ZXJ0ZXIgcmVnaXN0cnkgc3RhdGUgYXQgZXJyb3IgdGltZTonLCB7XHJcbiAgICAgICAgY29udmVydGVyUmVnaXN0cnlMb2FkZWQ6ICEhZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5LFxyXG4gICAgICAgIGhhc0NvbnZlcnRlcnM6ICEhKGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSAmJiBnbG9iYWwuY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycyksXHJcbiAgICAgICAgYXZhaWxhYmxlQ29udmVydGVyczogZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5ICYmIGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzID8gXHJcbiAgICAgICAgICBPYmplY3Qua2V5cyhnbG9iYWwuY29udmVydGVyUmVnaXN0cnkuY29udmVydGVycykgOiAnbm9uZScsXHJcbiAgICAgICAgdW5pZmllZENvbnZlcnRlckZhY3RvcnlMb2FkZWQ6ICEhdW5pZmllZENvbnZlcnRlckZhY3RvcnksXHJcbiAgICAgICAgaGFzQ29udmVydEZpbGU6IHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5ID8gdHlwZW9mIHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmNvbnZlcnRGaWxlID09PSAnZnVuY3Rpb24nIDogZmFsc2VcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBlcnJvckluZm8gPSB7XHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLCAvLyBBbHdheXMgaW5jbHVkZSBmaWxlVHlwZVxyXG4gICAgICAgIHR5cGU6IG9wdGlvbnMudHlwZSxcclxuICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgICAgaXNCdWZmZXI6IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCksXHJcbiAgICAgICAgYnVmZmVyTGVuZ3RoOiBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpID8gZmlsZVBhdGgubGVuZ3RoIDogdW5kZWZpbmVkLFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcclxuICAgICAgICBjb252ZXJ0ZXJzTG9hZGVkOiAhIWdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeSAvLyBDaGVjayBpZiBjb252ZXJ0ZXJzIHdlcmUgbG9hZGVkXHJcbiAgICAgIH07XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIENvbnZlcnNpb24gZmFpbGVkOicsIGVycm9ySW5mbyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDb25zdHJ1Y3QgYSB1c2VyLWZyaWVuZGx5IGVycm9yIG1lc3NhZ2VcclxuICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSBcclxuICAgICAgICA/IGBGYWlsZWQgdG8gY29udmVydCAke29wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCAnZmlsZSd9OiAke2Vycm9yLm1lc3NhZ2V9YFxyXG4gICAgICAgIDogYEZhaWxlZCB0byBjb252ZXJ0ICR7ZmlsZVBhdGh9OiAke2Vycm9yLm1lc3NhZ2V9YDtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcclxuICAgICAgICBkZXRhaWxzOiBlcnJvckluZm8sXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlIC8vIEV4cGxpY2l0bHkgaW5jbHVkZSBmaWxlVHlwZSBpbiBlcnJvciByZXN1bHRcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNldHMgdXAgdGhlIG91dHB1dCBkaXJlY3RvcnkgZm9yIGNvbnZlcnNpb25zXHJcbiAgICovXHJcbiAgYXN5bmMgc2V0dXBPdXRwdXREaXJlY3Rvcnkob3V0cHV0RGlyKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBkaXJUb1NldHVwID0gb3V0cHV0RGlyIHx8IHRoaXMuZGVmYXVsdE91dHB1dERpcjtcclxuICAgICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLmNyZWF0ZURpcmVjdG9yeShkaXJUb1NldHVwKTtcclxuICAgICAgY29uc29sZS5sb2coJ/Cfk4EgT3V0cHV0IGRpcmVjdG9yeSByZWFkeTonLCBkaXJUb1NldHVwKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gc2V0IHVwIG91dHB1dCBkaXJlY3Rvcnk6JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gbmV3IEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UoKTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNO0VBQUVDO0FBQUksQ0FBQyxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ25DLE1BQU07RUFBRUU7QUFBVSxDQUFDLEdBQUdGLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQztBQUMvQyxNQUFNO0VBQUVHO0FBQVUsQ0FBQyxHQUFHSCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQ3JDLE1BQU1JLEVBQUUsR0FBR0osT0FBTyxDQUFDLElBQUksQ0FBQztBQUN4QixNQUFNSyxhQUFhLEdBQUdGLFNBQVMsQ0FBQ0MsRUFBRSxDQUFDRSxRQUFRLENBQUM7QUFDNUMsTUFBTUMsaUJBQWlCLEdBQUdQLE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQztBQUN4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