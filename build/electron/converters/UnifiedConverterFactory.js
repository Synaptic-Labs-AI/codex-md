"use strict";

/**
 * UnifiedConverterFactory.js
 * 
 * Central factory for all file type conversions in the Electron main process.
 * Uses CommonJS for consistency with Electron main process and provides robust initialization
 * and converter management.
 * 
 * Related files:
 * - src/electron/services/ElectronConversionService.js: Uses this factory for conversions
 * - src/electron/ipc/handlers/conversion/index.js: Exposes conversion to renderer process
 * - src/electron/services/conversion/ConverterRegistry.js: Converter implementations
 */

const {
  app
} = require('electron');
const fs = require('fs-extra');
const path = require('path');
const {
  PathUtils
} = require('../utils/paths/index');
const {
  ProgressTracker
} = require('../utils/conversion/progress');
const {
  getLogger
} = require('../utils/logging/ConversionLogger');
const {
  sanitizeForLogging
} = require('../utils/logging/LogSanitizer');
const ConversionStatus = require('../utils/conversion/ConversionStatus');

/**
 * Handles module loading with proper error handling and path resolution.
 */
class ModuleLoader {
  static async loadModule(modulePath) {
    const logger = getLogger('ModuleLoader');
    try {
      const module = require(modulePath);
      return module.default || module;
    } catch (error) {
      logger.error(`Failed to load module: ${modulePath}`, error);
      throw error;
    }
  }
  static getModulePaths() {
    const isDev = process.env.NODE_ENV === 'development';
    const basePath = isDev ? path.resolve(process.cwd(), 'src/electron/services/conversion') : path.resolve(app.getAppPath(), 'src/electron/services/conversion');
    return {
      registry: path.join(basePath, 'ConverterRegistry.js'),
      converters: {
        url: path.join(basePath, 'web/UrlConverter.js'),
        pdf: path.join(basePath, 'document/PdfConverterFactory.js'),
        docx: path.join(basePath, 'document/DocxConverter.js'),
        pptx: path.join(basePath, 'document/PptxConverter.js'),
        xlsx: path.join(basePath, 'data/XlsxConverter.js'),
        csv: path.join(basePath, 'data/CsvConverter.js')
      }
    };
  }
}

/**
 * Manages converter initialization and ensures proper loading sequence.
 */
class ConverterInitializer {
  static _instance = null;
  constructor() {
    this._initialized = false;
    this._initPromise = null;
    this._converterRegistry = null;
    this.logger = getLogger('ConverterInitializer');
  }
  static getInstance() {
    if (!ConverterInitializer._instance) {
      ConverterInitializer._instance = new ConverterInitializer();
    }
    return ConverterInitializer._instance;
  }
  async initialize() {
    if (this._initialized) return this._converterRegistry;
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInitialize();
    return this._initPromise;
  }
  async _doInitialize() {
    this.logger.logPhaseTransition(ConversionStatus.STATUS.STARTING, ConversionStatus.STATUS.INITIALIZING);
    try {
      const paths = ModuleLoader.getModulePaths();
      this.logger.info('Using converter paths:', paths);
      const registry = await ModuleLoader.loadModule(paths.registry);
      this.logger.success('Successfully loaded converter registry');
      if (!this._validateRegistry(registry)) {
        throw new Error('Invalid converter registry');
      }
      this._converterRegistry = registry;
      this._initialized = true;
      this.logger.logPhaseTransition(ConversionStatus.STATUS.INITIALIZING, ConversionStatus.STATUS.COMPLETED);
      return this._converterRegistry;
    } catch (error) {
      this._initPromise = null;
      this.logger.logConversionError('init', error);
      throw error;
    }
  }
  _validateRegistry(registry) {
    if (!registry || typeof registry !== 'object') return false;
    if (!registry.converters || typeof registry.converters !== 'object') return false;
    if (typeof registry.convertToMarkdown !== 'function') return false;
    if (typeof registry.getConverterByExtension !== 'function') return false;
    return true;
  }
}

/**
 * Categorize file types for better organization
 */
const FILE_TYPE_CATEGORIES = {
  // Audio files
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  // Video files
  mp4: 'video',
  webm: 'video',
  avi: 'video',
  mov: 'video',
  // Document files
  pdf: 'document',
  docx: 'document',
  pptx: 'document',
  // Data files
  xlsx: 'data',
  csv: 'data',
  // Web content
  url: 'web',
  parenturl: 'web'
};

/**
 * Enhanced UnifiedConverterFactory class with proper initialization and conversion handling
 */
class UnifiedConverterFactory {
  static _instance = null;
  constructor() {
    this._initializer = ConverterInitializer.getInstance();
    this._converterRegistry = null;
    this.logger = getLogger('UnifiedConverterFactory');
    this.logger.info('UnifiedConverterFactory initialized');
  }
  static getInstance() {
    if (!UnifiedConverterFactory._instance) {
      UnifiedConverterFactory._instance = new UnifiedConverterFactory();
    }
    return UnifiedConverterFactory._instance;
  }
  async _ensureInitialized() {
    if (!this._converterRegistry) {
      this._converterRegistry = await this._initializer.initialize();
    }
    return this._converterRegistry;
  }
  async getConverter(fileType) {
    this.logger.setContext({
      fileType
    });
    const registry = await this._ensureInitialized();
    if (!fileType) {
      throw new Error('File type is required');
    }

    // Normalize file type (remove dot, lowercase)
    const normalizedType = fileType.toLowerCase().replace(/^\./, '');

    // Get URL converter directly from registry if available
    if (normalizedType === 'url' || normalizedType === 'parenturl') {
      this.logger.info(`Using direct URL converter for: ${normalizedType}`);
      const converter = registry.converters?.[normalizedType];
      if (converter) {
        this.logger.success(`Found ${normalizedType} converter`);
        return {
          converter: {
            ...converter,
            type: normalizedType,
            convert: async (content, name, apiKey, options) => {
              return converter.convert(content, name, apiKey, {
                ...options,
                name,
                type: normalizedType
              });
            }
          },
          type: normalizedType,
          category: 'web'
        };
      }

      // Try fallback to convertToMarkdown
      this.logger.info(`Attempting convertToMarkdown fallback for ${normalizedType}`);
      if (registry.convertToMarkdown) {
        return {
          converter: {
            convert: async (content, name, apiKey, options) => {
              return registry.convertToMarkdown(normalizedType, content, {
                name,
                apiKey,
                ...options
              });
            },
            validate: input => typeof input === 'string' && input.length > 0,
            config: {
              name: normalizedType === 'url' ? 'Web Page' : 'Website',
              extensions: ['.url', '.html', '.htm'],
              mimeTypes: ['text/html', 'application/x-url'],
              maxSize: 10 * 1024 * 1024
            }
          },
          type: normalizedType,
          category: 'web'
        };
      }
    }

    // For all other types, get converter from registry
    const converter = await registry.getConverterByExtension(normalizedType);
    if (converter) {
      return {
        converter,
        type: normalizedType,
        category: FILE_TYPE_CATEGORIES[normalizedType] || 'document'
      };
    }
    throw new Error(`No converter found for type: ${fileType}`);
  }

  /**
   * Convert a file to markdown using the appropriate converter
   * @param {string} filePath - Path to the file or URL string
   * @param {Object} options - Conversion options
   * @returns {Promise<Object>} - Conversion result
   */
  async convertFile(filePath, options = {}) {
    const fileType = options.fileType;
    const startTime = Date.now();
    this.logger.logConversionStart(fileType, options);
    try {
      if (!fileType) {
        throw new Error('fileType is required in options');
      }

      // Determine if this is a URL or a file
      const isUrl = fileType === 'url' || fileType === 'parenturl';

      // Get file details - handle URLs differently
      let fileName;
      if (Buffer.isBuffer(filePath)) {
        fileName = options.originalFileName;
        if (!fileName) {
          throw new Error('originalFileName is required when passing buffer input');
        }
      } else if (isUrl) {
        try {
          const urlObj = new URL(filePath);
          fileName = urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname : '');
        } catch (e) {
          fileName = filePath;
        }
      } else {
        fileName = path.basename(filePath);
      }
      this.logger.logPhaseTransition(ConversionStatus.STATUS.STARTING, ConversionStatus.STATUS.VALIDATING);

      // Get the appropriate converter with async/await
      let converterInfo = await this.getConverter(fileType);

      // Special handling for URL types in production mode
      if (!converterInfo && (fileType === 'url' || fileType === 'parenturl')) {
        this.logger.info(`Special handling for ${fileType} in production mode`);
        converterInfo = await this.createDirectUrlConverter(fileType);
        if (converterInfo) {
          this.logger.success(`Created direct converter for ${fileType}`);
        }
      }

      // If converter not found, try again after a short delay
      if (!converterInfo) {
        this.logger.info(`Retrying to get converter for ${fileType} after delay...`);
        await new Promise(resolve => setTimeout(resolve, 500));
        converterInfo = await this.getConverter(fileType);
        if (!converterInfo && (fileType === 'url' || fileType === 'parenturl')) {
          this.logger.info(`Second attempt at special handling for ${fileType}`);
          converterInfo = await this.createDirectUrlConverter(fileType);
        }

        // If still not found, try one more time with a longer delay
        if (!converterInfo) {
          this.logger.info(`Final attempt to get converter for ${fileType} after longer delay...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          converterInfo = await this.getConverter(fileType);
          if (!converterInfo && (fileType === 'url' || fileType === 'parenturl')) {
            this.logger.info(`Final attempt at special handling for ${fileType}`);
            converterInfo = await this.createDirectUrlConverter(fileType);
          }
          if (!converterInfo) {
            throw new Error(`Unsupported file type: ${fileType}`);
          }
        }
      }

      // Create a progress tracker if callback provided
      const progressTracker = options.onProgress ? new ProgressTracker(options.onProgress, 250) : null;
      if (progressTracker) {
        progressTracker.update(5, {
          status: 'initializing',
          fileType: fileType
        });
      }
      const registry = await this._ensureInitialized();
      this.logger.debug('Converter info:', sanitizeForLogging({
        hasRegistry: !!registry,
        converterType: converterInfo?.type || 'none',
        category: converterInfo?.category || 'unknown',
        hasConverter: !!converterInfo?.converter,
        converterDetails: converterInfo?.converter
      }));

      // Handle the conversion based on file type
      const result = await this.handleConversion(filePath, {
        ...options,
        fileType: fileType,
        fileName,
        progressTracker,
        converterInfo,
        isUrl
      });
      if (progressTracker) {
        progressTracker.update(100, {
          status: 'completed'
        });
      }
      this.logger.logConversionComplete(fileType);
      return result;
    } catch (error) {
      this.logger.logConversionError(fileType, error);
      return {
        success: false,
        error: error.message,
        fileType: fileType,
        type: fileType,
        name: options.originalFileName || 'unknown',
        category: FILE_TYPE_CATEGORIES[fileType] || 'unknown'
      };
    }
  }

  /**
   * Create a direct URL converter for production mode
   * @param {string} fileType - URL file type ('url' or 'parenturl')
   * @returns {Object|null} - Converter info or null if not possible
   */
  async createDirectUrlConverter(fileType) {
    this.logger.info(`Creating direct URL converter for ${fileType}`);
    const registry = await this._ensureInitialized();
    if (!registry.convertToMarkdown) {
      this.logger.error('Cannot create direct URL converter: convertToMarkdown not available');
      return null;
    }
    return {
      converter: {
        convert: async (content, name, apiKey, options) => {
          this.logger.info(`Using direct URL converter for ${fileType}`);
          return registry.convertToMarkdown(fileType, content, {
            name,
            apiKey,
            ...options
          });
        },
        validate: input => typeof input === 'string' && input.length > 0,
        config: {
          name: fileType === 'url' ? 'Web Page' : 'Website',
          extensions: ['.url', '.html', '.htm'],
          mimeTypes: ['text/html', 'application/x-url'],
          maxSize: 10 * 1024 * 1024
        }
      },
      type: fileType,
      category: 'web'
    };
  }

  /**
   * Standardize conversion result to ensure consistent format
   *
   * IMPORTANT: This method ensures properties are set in the correct order to prevent
   * property shadowing issues. The order matters because:
   * 1. We first spread the result object to include all its properties
   * 2. Then we override specific properties to ensure they have the correct values
   * 3. We set content last to ensure it's not accidentally overridden
   * 4. We add a final check to ensure content is never empty, providing a fallback
   *
   * This fixes the "Conversion produced empty content" error that could occur when
   * the content property was overridden by the spread operator.
   *
   * @param {Object} result - Raw conversion result
   * @param {string} fileType - File type
   * @param {string} fileName - File name
   * @param {string} category - File category
   * @returns {Object} - Standardized result
   */
  standardizeResult(result, fileType, fileName, category) {
    this.logger.debug(`Raw result received for ${fileType}:`, sanitizeForLogging(result)); // Add logging

    // Handle null or undefined result explicitly
    if (!result) {
      this.logger.warn(`Received null or undefined result for ${fileType}. Assuming failure.`);
      result = {
        success: false,
        error: 'Converter returned null or undefined result'
      };
    }

    // Determine success status more robustly
    // Success is ONLY true if result.success is explicitly true.
    // Otherwise, it's false, especially if an error property exists.
    const isSuccess = result.success === true;

    // Sanitize potentially complex objects within the result *after* determining success
    const sanitizedResult = sanitizeForLogging(result);
    const standardized = {
      ...sanitizedResult,
      // Spread sanitized result first
      success: isSuccess,
      // Override with determined success status
      type: result.type || fileType,
      fileType: fileType,
      name: result.name || fileName,
      category: result.category || category,
      metadata: {
        ...(result.metadata || {}),
        converter: result.converter || 'unknown'
      },
      images: result.images || [],
      // Ensure content exists, provide fallback if needed
      content: result.content || (isSuccess ? '' : `# Conversion Result\n\nThe ${fileType} file was processed, but no content was generated. This might indicate an issue or be normal for this file type.`),
      // Ensure error property is present if not successful
      error: !isSuccess ? result.error || 'Unknown conversion error' : undefined
    };

    // Remove error property if successful
    if (standardized.success) {
      delete standardized.error;
    }

    // Ensure content is not null or undefined, and provide appropriate fallback
    if (!standardized.content && !isSuccess) {
      this.logger.logPhaseTransition(ConversionStatus.STATUS.PROCESSING, ConversionStatus.STATUS.CONTENT_EMPTY);
      // Provide a more informative message if the conversion failed and content is empty
      standardized.content = `# Conversion Error\n\nThe ${fileType} file conversion failed or produced no content. Error: ${standardized.error || 'Unknown error'}`;
    } else if (!standardized.content && isSuccess) {
      this.logger.logPhaseTransition(ConversionStatus.STATUS.PROCESSING, ConversionStatus.STATUS.CONTENT_EMPTY);
      // Fallback for successful conversion but empty content
      standardized.content = `# Conversion Result\n\nThe ${fileType} file was processed successfully, but no textual content was generated. This is normal for certain file types (e.g., multimedia files without transcription).`;
    }

    // Log the final standardized result
    this.logger.debug(`Standardized result for ${fileType}:`, sanitizeForLogging(standardized));
    return standardized;
  }
  async handleConversion(filePath, options) {
    const {
      progressTracker,
      fileType,
      fileName,
      converterInfo,
      isUrl
    } = options;
    try {
      // Validate converterInfo
      if (!converterInfo) {
        this.logger.error(`No converter info available for ${fileType}`);
        throw new Error(`No converter info available for ${fileType}`);
      }
      this.logger.logPhaseTransition(ConversionStatus.STATUS.VALIDATING, ConversionStatus.STATUS.FAST_ATTEMPT);

      // Handle URL and parent URL differently since they don't need file reading
      if (isUrl) {
        if (progressTracker) {
          progressTracker.update(20, {
            status: `processing_${fileType}`
          });
        }
        this.logger.info(`Processing URL: ${filePath}`);

        // For URLs, filePath is actually the URL string
        let result;
        try {
          // Try using the converter's convert method first
          if (typeof converter.convert === 'function') {
            this.logger.info(`Using converter.convert for ${fileType}`);
            result = await converter.convert(filePath, fileName, options.apiKey, {
              ...options,
              name: fileName,
              onProgress: progress => {
                if (progressTracker) {
                  progressTracker.updateScaled(progress, 20, 90, {
                    status: typeof progress === 'object' ? progress.status : `processing_${fileType}`
                  });
                }
              }
            });
          } else {
            // Fall back to using the registry's convertToMarkdown method
            const registry = await this._ensureInitialized();
            this.logger.info(`Using registry.convertToMarkdown for ${fileType}`);
            result = await registry.convertToMarkdown(fileType, filePath, {
              ...options,
              name: fileName,
              onProgress: progress => {
                if (progressTracker) {
                  progressTracker.updateScaled(progress, 20, 90, {
                    status: typeof progress === 'object' ? progress.status : `processing_${fileType}`
                  });
                }
              }
            });
          }
        } catch (error) {
          this.logger.error(`Error in URL conversion: ${error.message}`);

          // Try the alternative method as a fallback
          const registry = await this._ensureInitialized();
          if (typeof converter.convert === 'function' && typeof registry.convertToMarkdown === 'function') {
            this.logger.info(`Trying alternative conversion method as fallback`);
            try {
              // If we tried converter.convert first, now try registry.convertToMarkdown
              result = await registry.convertToMarkdown(fileType, filePath, {
                ...options,
                name: fileName,
                onProgress: progress => {
                  if (progressTracker) {
                    progressTracker.updateScaled(progress, 20, 90, {
                      status: typeof progress === 'object' ? progress.status : `processing_${fileType}`
                    });
                  }
                }
              });
            } catch (fallbackError) {
              this.logger.error(`Fallback conversion also failed: ${fallbackError.message}`);
              throw error; // Throw the original error
            }
          } else {
            throw error; // Re-throw if no fallback is available
          }
        }
        if (progressTracker) {
          progressTracker.update(95, {
            status: 'finalizing'
          });
        }
        this.logger.logPhaseTransition(ConversionStatus.STATUS.PROCESSING, ConversionStatus.STATUS.FINALIZING);
        return this.standardizeResult(result, fileType, fileName, category);
      }

      // Read file content if not already a buffer
      const fileContent = Buffer.isBuffer(filePath) ? filePath : fs.readFileSync(filePath);
      if (progressTracker) {
        progressTracker.update(20, {
          status: `converting_${fileType}`
        });
      }

      // Special handling for PDF files to include OCR options
      if (fileType === 'pdf') {
        this.logger.debug('Converting PDF with options:', {
          useOcr: options.useOcr,
          hasMistralApiKey: !!options.mistralApiKey,
          preservePageInfo: true
        });

        // Add more detailed logging for OCR settings
        if (options.useOcr) {
          this.logger.info('OCR is enabled for this conversion');
          if (options.mistralApiKey) {
            this.logger.debug('Mistral API key is present');
          } else {
            this.logger.warn('OCR is enabled but Mistral API key is missing');
          }
        }
      }

      // Special handling for audio/video files to ensure they don't use Mistral API key
      if (fileType === 'mp3' || fileType === 'wav' || fileType === 'mp4' || fileType === 'mov' || fileType === 'ogg' || fileType === 'webm' || fileType === 'avi' || fileType === 'flac' || fileType === 'm4a') {
        this.logger.info(`Converting multimedia file (${fileType})`);

        // Remove mistralApiKey from options for multimedia files to prevent incorrect routing
        if (options.mistralApiKey) {
          this.logger.info('Removing Mistral API key from multimedia conversion options');
          const {
            mistralApiKey,
            ...cleanOptions
          } = options;
          options = cleanOptions;
        }
      }
      this.logger.logPhaseTransition(ConversionStatus.STATUS.FAST_ATTEMPT, ConversionStatus.STATUS.PROCESSING);

      // Use the converter's convert method
      const {
        converter,
        category
      } = converterInfo;
      const result = await converter.convert(fileContent, fileName, options.apiKey, {
        ...options,
        name: fileName,
        onProgress: progress => {
          if (progressTracker) {
            progressTracker.updateScaled(progress, 20, 90, {
              status: typeof progress === 'object' ? progress.status : `converting_${fileType}`
            });
          }
        }
      });
      if (progressTracker) {
        progressTracker.update(95, {
          status: 'finalizing'
        });
      }
      this.logger.logPhaseTransition(ConversionStatus.STATUS.PROCESSING, ConversionStatus.STATUS.FINALIZING);
      return this.standardizeResult(result, fileType, fileName, category);
    } catch (error) {
      this.logger.logConversionError(fileType, error);
      return {
        success: false,
        error: `${fileType.toUpperCase()} conversion failed: ${error.message}`,
        content: `# Conversion Error\n\nFailed to convert ${fileType.toUpperCase()} file: ${error.message}`,
        type: fileType,
        fileType: fileType,
        // Explicitly include fileType
        name: fileName,
        category: category || 'unknown'
      };
    }
  }
}

/**
 * Add an initialize method to the factory instance
 * This is needed for compatibility with code that expects this method
 */
const unifiedConverterFactory = UnifiedConverterFactory.getInstance();

// Add initialize method to the factory instance
unifiedConverterFactory.initialize = async function () {
  this.logger.logPhaseTransition(ConversionStatus.STATUS.STARTING, ConversionStatus.STATUS.INITIALIZING);
  try {
    await this._ensureInitialized();
    this.logger.logPhaseTransition(ConversionStatus.STATUS.INITIALIZING, ConversionStatus.STATUS.COMPLETED);
    return true;
  } catch (error) {
    this.logger.logConversionError('init', error);
    throw error;
  }
};

// Export singleton instance and module functions
module.exports = unifiedConverterFactory;
module.exports.unifiedConverterFactory = unifiedConverterFactory;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJhcHAiLCJyZXF1aXJlIiwiZnMiLCJwYXRoIiwiUGF0aFV0aWxzIiwiUHJvZ3Jlc3NUcmFja2VyIiwiZ2V0TG9nZ2VyIiwic2FuaXRpemVGb3JMb2dnaW5nIiwiQ29udmVyc2lvblN0YXR1cyIsIk1vZHVsZUxvYWRlciIsImxvYWRNb2R1bGUiLCJtb2R1bGVQYXRoIiwibG9nZ2VyIiwibW9kdWxlIiwiZGVmYXVsdCIsImVycm9yIiwiZ2V0TW9kdWxlUGF0aHMiLCJpc0RldiIsInByb2Nlc3MiLCJlbnYiLCJOT0RFX0VOViIsImJhc2VQYXRoIiwicmVzb2x2ZSIsImN3ZCIsImdldEFwcFBhdGgiLCJyZWdpc3RyeSIsImpvaW4iLCJjb252ZXJ0ZXJzIiwidXJsIiwicGRmIiwiZG9jeCIsInBwdHgiLCJ4bHN4IiwiY3N2IiwiQ29udmVydGVySW5pdGlhbGl6ZXIiLCJfaW5zdGFuY2UiLCJjb25zdHJ1Y3RvciIsIl9pbml0aWFsaXplZCIsIl9pbml0UHJvbWlzZSIsIl9jb252ZXJ0ZXJSZWdpc3RyeSIsImdldEluc3RhbmNlIiwiaW5pdGlhbGl6ZSIsIl9kb0luaXRpYWxpemUiLCJsb2dQaGFzZVRyYW5zaXRpb24iLCJTVEFUVVMiLCJTVEFSVElORyIsIklOSVRJQUxJWklORyIsInBhdGhzIiwiaW5mbyIsInN1Y2Nlc3MiLCJfdmFsaWRhdGVSZWdpc3RyeSIsIkVycm9yIiwiQ09NUExFVEVEIiwibG9nQ29udmVyc2lvbkVycm9yIiwiY29udmVydFRvTWFya2Rvd24iLCJnZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiIsIkZJTEVfVFlQRV9DQVRFR09SSUVTIiwibXAzIiwid2F2Iiwib2dnIiwiZmxhYyIsIm1wNCIsIndlYm0iLCJhdmkiLCJtb3YiLCJwYXJlbnR1cmwiLCJVbmlmaWVkQ29udmVydGVyRmFjdG9yeSIsIl9pbml0aWFsaXplciIsIl9lbnN1cmVJbml0aWFsaXplZCIsImdldENvbnZlcnRlciIsImZpbGVUeXBlIiwic2V0Q29udGV4dCIsIm5vcm1hbGl6ZWRUeXBlIiwidG9Mb3dlckNhc2UiLCJyZXBsYWNlIiwiY29udmVydGVyIiwidHlwZSIsImNvbnZlcnQiLCJjb250ZW50IiwibmFtZSIsImFwaUtleSIsIm9wdGlvbnMiLCJjYXRlZ29yeSIsInZhbGlkYXRlIiwiaW5wdXQiLCJsZW5ndGgiLCJjb25maWciLCJleHRlbnNpb25zIiwibWltZVR5cGVzIiwibWF4U2l6ZSIsImNvbnZlcnRGaWxlIiwiZmlsZVBhdGgiLCJzdGFydFRpbWUiLCJEYXRlIiwibm93IiwibG9nQ29udmVyc2lvblN0YXJ0IiwiaXNVcmwiLCJmaWxlTmFtZSIsIkJ1ZmZlciIsImlzQnVmZmVyIiwib3JpZ2luYWxGaWxlTmFtZSIsInVybE9iaiIsIlVSTCIsImhvc3RuYW1lIiwicGF0aG5hbWUiLCJlIiwiYmFzZW5hbWUiLCJWQUxJREFUSU5HIiwiY29udmVydGVySW5mbyIsImNyZWF0ZURpcmVjdFVybENvbnZlcnRlciIsIlByb21pc2UiLCJzZXRUaW1lb3V0IiwicHJvZ3Jlc3NUcmFja2VyIiwib25Qcm9ncmVzcyIsInVwZGF0ZSIsInN0YXR1cyIsImRlYnVnIiwiaGFzUmVnaXN0cnkiLCJjb252ZXJ0ZXJUeXBlIiwiaGFzQ29udmVydGVyIiwiY29udmVydGVyRGV0YWlscyIsInJlc3VsdCIsImhhbmRsZUNvbnZlcnNpb24iLCJsb2dDb252ZXJzaW9uQ29tcGxldGUiLCJtZXNzYWdlIiwic3RhbmRhcmRpemVSZXN1bHQiLCJ3YXJuIiwiaXNTdWNjZXNzIiwic2FuaXRpemVkUmVzdWx0Iiwic3RhbmRhcmRpemVkIiwibWV0YWRhdGEiLCJpbWFnZXMiLCJ1bmRlZmluZWQiLCJQUk9DRVNTSU5HIiwiQ09OVEVOVF9FTVBUWSIsIkZBU1RfQVRURU1QVCIsInByb2dyZXNzIiwidXBkYXRlU2NhbGVkIiwiZmFsbGJhY2tFcnJvciIsIkZJTkFMSVpJTkciLCJmaWxlQ29udGVudCIsInJlYWRGaWxlU3luYyIsInVzZU9jciIsImhhc01pc3RyYWxBcGlLZXkiLCJtaXN0cmFsQXBpS2V5IiwicHJlc2VydmVQYWdlSW5mbyIsImNsZWFuT3B0aW9ucyIsInRvVXBwZXJDYXNlIiwidW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL2NvbnZlcnRlcnMvVW5pZmllZENvbnZlcnRlckZhY3RvcnkuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmpzXHJcbiAqIFxyXG4gKiBDZW50cmFsIGZhY3RvcnkgZm9yIGFsbCBmaWxlIHR5cGUgY29udmVyc2lvbnMgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogVXNlcyBDb21tb25KUyBmb3IgY29uc2lzdGVuY3kgd2l0aCBFbGVjdHJvbiBtYWluIHByb2Nlc3MgYW5kIHByb3ZpZGVzIHJvYnVzdCBpbml0aWFsaXphdGlvblxyXG4gKiBhbmQgY29udmVydGVyIG1hbmFnZW1lbnQuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9FbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmpzOiBVc2VzIHRoaXMgZmFjdG9yeSBmb3IgY29udmVyc2lvbnNcclxuICogLSBzcmMvZWxlY3Ryb24vaXBjL2hhbmRsZXJzL2NvbnZlcnNpb24vaW5kZXguanM6IEV4cG9zZXMgY29udmVyc2lvbiB0byByZW5kZXJlciBwcm9jZXNzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanM6IENvbnZlcnRlciBpbXBsZW1lbnRhdGlvbnNcclxuICovXHJcblxyXG5jb25zdCB7IGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IFBhdGhVdGlscyB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvcGF0aHMvaW5kZXgnKTtcclxuY29uc3QgeyBQcm9ncmVzc1RyYWNrZXIgfSA9IHJlcXVpcmUoJy4uL3V0aWxzL2NvbnZlcnNpb24vcHJvZ3Jlc3MnKTtcclxuY29uc3QgeyBnZXRMb2dnZXIgfSA9IHJlcXVpcmUoJy4uL3V0aWxzL2xvZ2dpbmcvQ29udmVyc2lvbkxvZ2dlcicpO1xyXG5jb25zdCB7IHNhbml0aXplRm9yTG9nZ2luZyB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvbG9nZ2luZy9Mb2dTYW5pdGl6ZXInKTtcclxuY29uc3QgQ29udmVyc2lvblN0YXR1cyA9IHJlcXVpcmUoJy4uL3V0aWxzL2NvbnZlcnNpb24vQ29udmVyc2lvblN0YXR1cycpO1xyXG5cclxuLyoqXHJcbiAqIEhhbmRsZXMgbW9kdWxlIGxvYWRpbmcgd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmcgYW5kIHBhdGggcmVzb2x1dGlvbi5cclxuICovXHJcbmNsYXNzIE1vZHVsZUxvYWRlciB7XHJcbiAgc3RhdGljIGFzeW5jIGxvYWRNb2R1bGUobW9kdWxlUGF0aCkge1xyXG4gICAgY29uc3QgbG9nZ2VyID0gZ2V0TG9nZ2VyKCdNb2R1bGVMb2FkZXInKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IG1vZHVsZSA9IHJlcXVpcmUobW9kdWxlUGF0aCk7XHJcbiAgICAgIHJldHVybiBtb2R1bGUuZGVmYXVsdCB8fCBtb2R1bGU7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBsb2FkIG1vZHVsZTogJHttb2R1bGVQYXRofWAsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgZ2V0TW9kdWxlUGF0aHMoKSB7XHJcbiAgICBjb25zdCBpc0RldiA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnO1xyXG4gICAgY29uc3QgYmFzZVBhdGggPSBpc0RldiA/XHJcbiAgICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSA6XHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICByZWdpc3RyeTogcGF0aC5qb2luKGJhc2VQYXRoLCAnQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgY29udmVydGVyczoge1xyXG4gICAgICAgIHVybDogcGF0aC5qb2luKGJhc2VQYXRoLCAnd2ViL1VybENvbnZlcnRlci5qcycpLFxyXG4gICAgICAgIHBkZjogcGF0aC5qb2luKGJhc2VQYXRoLCAnZG9jdW1lbnQvUGRmQ29udmVydGVyRmFjdG9yeS5qcycpLFxyXG4gICAgICAgIGRvY3g6IHBhdGguam9pbihiYXNlUGF0aCwgJ2RvY3VtZW50L0RvY3hDb252ZXJ0ZXIuanMnKSxcclxuICAgICAgICBwcHR4OiBwYXRoLmpvaW4oYmFzZVBhdGgsICdkb2N1bWVudC9QcHR4Q29udmVydGVyLmpzJyksXHJcbiAgICAgICAgeGxzeDogcGF0aC5qb2luKGJhc2VQYXRoLCAnZGF0YS9YbHN4Q29udmVydGVyLmpzJyksXHJcbiAgICAgICAgY3N2OiBwYXRoLmpvaW4oYmFzZVBhdGgsICdkYXRhL0NzdkNvbnZlcnRlci5qcycpXHJcbiAgICAgIH1cclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogTWFuYWdlcyBjb252ZXJ0ZXIgaW5pdGlhbGl6YXRpb24gYW5kIGVuc3VyZXMgcHJvcGVyIGxvYWRpbmcgc2VxdWVuY2UuXHJcbiAqL1xyXG5jbGFzcyBDb252ZXJ0ZXJJbml0aWFsaXplciB7XHJcbiAgc3RhdGljIF9pbnN0YW5jZSA9IG51bGw7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLl9pbml0aWFsaXplZCA9IGZhbHNlO1xyXG4gICAgdGhpcy5faW5pdFByb21pc2UgPSBudWxsO1xyXG4gICAgdGhpcy5fY29udmVydGVyUmVnaXN0cnkgPSBudWxsO1xyXG4gICAgdGhpcy5sb2dnZXIgPSBnZXRMb2dnZXIoJ0NvbnZlcnRlckluaXRpYWxpemVyJyk7XHJcbiAgfVxyXG4gIFxyXG4gIHN0YXRpYyBnZXRJbnN0YW5jZSgpIHtcclxuICAgIGlmICghQ29udmVydGVySW5pdGlhbGl6ZXIuX2luc3RhbmNlKSB7XHJcbiAgICAgIENvbnZlcnRlckluaXRpYWxpemVyLl9pbnN0YW5jZSA9IG5ldyBDb252ZXJ0ZXJJbml0aWFsaXplcigpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIENvbnZlcnRlckluaXRpYWxpemVyLl9pbnN0YW5jZTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGluaXRpYWxpemUoKSB7XHJcbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQpIHJldHVybiB0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeTtcclxuICAgIGlmICh0aGlzLl9pbml0UHJvbWlzZSkgcmV0dXJuIHRoaXMuX2luaXRQcm9taXNlO1xyXG5cclxuICAgIHRoaXMuX2luaXRQcm9taXNlID0gdGhpcy5fZG9Jbml0aWFsaXplKCk7XHJcbiAgICByZXR1cm4gdGhpcy5faW5pdFByb21pc2U7XHJcbiAgfVxyXG5cclxuICBhc3luYyBfZG9Jbml0aWFsaXplKCkge1xyXG4gICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5TVEFSVElORyxcclxuICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuSU5JVElBTElaSU5HXHJcbiAgICApO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHBhdGhzID0gTW9kdWxlTG9hZGVyLmdldE1vZHVsZVBhdGhzKCk7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1VzaW5nIGNvbnZlcnRlciBwYXRoczonLCBwYXRocyk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZWdpc3RyeSA9IGF3YWl0IE1vZHVsZUxvYWRlci5sb2FkTW9kdWxlKHBhdGhzLnJlZ2lzdHJ5KTtcclxuICAgICAgdGhpcy5sb2dnZXIuc3VjY2VzcygnU3VjY2Vzc2Z1bGx5IGxvYWRlZCBjb252ZXJ0ZXIgcmVnaXN0cnknKTtcclxuICAgICAgXHJcbiAgICAgIGlmICghdGhpcy5fdmFsaWRhdGVSZWdpc3RyeShyZWdpc3RyeSkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgY29udmVydGVyIHJlZ2lzdHJ5Jyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5ID0gcmVnaXN0cnk7XHJcbiAgICAgIHRoaXMuX2luaXRpYWxpemVkID0gdHJ1ZTtcclxuICAgICAgXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5JTklUSUFMSVpJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuQ09NUExFVEVEXHJcbiAgICAgICk7XHJcblxyXG4gICAgICByZXR1cm4gdGhpcy5fY29udmVydGVyUmVnaXN0cnk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aGlzLl9pbml0UHJvbWlzZSA9IG51bGw7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ0NvbnZlcnNpb25FcnJvcignaW5pdCcsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBfdmFsaWRhdGVSZWdpc3RyeShyZWdpc3RyeSkge1xyXG4gICAgaWYgKCFyZWdpc3RyeSB8fCB0eXBlb2YgcmVnaXN0cnkgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoIXJlZ2lzdHJ5LmNvbnZlcnRlcnMgfHwgdHlwZW9mIHJlZ2lzdHJ5LmNvbnZlcnRlcnMgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAodHlwZW9mIHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAodHlwZW9mIHJlZ2lzdHJ5LmdldENvbnZlcnRlckJ5RXh0ZW5zaW9uICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDYXRlZ29yaXplIGZpbGUgdHlwZXMgZm9yIGJldHRlciBvcmdhbml6YXRpb25cclxuICovXHJcbmNvbnN0IEZJTEVfVFlQRV9DQVRFR09SSUVTID0ge1xyXG4gIC8vIEF1ZGlvIGZpbGVzXHJcbiAgbXAzOiAnYXVkaW8nLFxyXG4gIHdhdjogJ2F1ZGlvJyxcclxuICBvZ2c6ICdhdWRpbycsXHJcbiAgZmxhYzogJ2F1ZGlvJyxcclxuICBcclxuICAvLyBWaWRlbyBmaWxlc1xyXG4gIG1wNDogJ3ZpZGVvJyxcclxuICB3ZWJtOiAndmlkZW8nLFxyXG4gIGF2aTogJ3ZpZGVvJyxcclxuICBtb3Y6ICd2aWRlbycsXHJcbiAgXHJcbiAgLy8gRG9jdW1lbnQgZmlsZXNcclxuICBwZGY6ICdkb2N1bWVudCcsXHJcbiAgZG9jeDogJ2RvY3VtZW50JyxcclxuICBwcHR4OiAnZG9jdW1lbnQnLFxyXG4gIFxyXG4gIC8vIERhdGEgZmlsZXNcclxuICB4bHN4OiAnZGF0YScsXHJcbiAgY3N2OiAnZGF0YScsXHJcbiAgXHJcbiAgLy8gV2ViIGNvbnRlbnRcclxuICB1cmw6ICd3ZWInLFxyXG4gIHBhcmVudHVybDogJ3dlYicsXHJcbn07XHJcblxyXG4vKipcclxuICogRW5oYW5jZWQgVW5pZmllZENvbnZlcnRlckZhY3RvcnkgY2xhc3Mgd2l0aCBwcm9wZXIgaW5pdGlhbGl6YXRpb24gYW5kIGNvbnZlcnNpb24gaGFuZGxpbmdcclxuICovXHJcbmNsYXNzIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5IHtcclxuICBzdGF0aWMgX2luc3RhbmNlID0gbnVsbDtcclxuICBcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuX2luaXRpYWxpemVyID0gQ29udmVydGVySW5pdGlhbGl6ZXIuZ2V0SW5zdGFuY2UoKTtcclxuICAgIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5ID0gbnVsbDtcclxuICAgIHRoaXMubG9nZ2VyID0gZ2V0TG9nZ2VyKCdVbmlmaWVkQ29udmVydGVyRmFjdG9yeScpO1xyXG4gICAgdGhpcy5sb2dnZXIuaW5mbygnVW5pZmllZENvbnZlcnRlckZhY3RvcnkgaW5pdGlhbGl6ZWQnKTtcclxuICB9XHJcblxyXG4gIHN0YXRpYyBnZXRJbnN0YW5jZSgpIHtcclxuICAgIGlmICghVW5pZmllZENvbnZlcnRlckZhY3RvcnkuX2luc3RhbmNlKSB7XHJcbiAgICAgIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5Ll9pbnN0YW5jZSA9IG5ldyBVbmlmaWVkQ29udmVydGVyRmFjdG9yeSgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5Ll9pbnN0YW5jZTtcclxuICB9XHJcblxyXG4gIGFzeW5jIF9lbnN1cmVJbml0aWFsaXplZCgpIHtcclxuICAgIGlmICghdGhpcy5fY29udmVydGVyUmVnaXN0cnkpIHtcclxuICAgICAgdGhpcy5fY29udmVydGVyUmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9pbml0aWFsaXplci5pbml0aWFsaXplKCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcy5fY29udmVydGVyUmVnaXN0cnk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRDb252ZXJ0ZXIoZmlsZVR5cGUpIHtcclxuICAgIHRoaXMubG9nZ2VyLnNldENvbnRleHQoeyBmaWxlVHlwZSB9KTtcclxuICAgIFxyXG4gICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgXHJcbiAgICBpZiAoIWZpbGVUeXBlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignRmlsZSB0eXBlIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTm9ybWFsaXplIGZpbGUgdHlwZSAocmVtb3ZlIGRvdCwgbG93ZXJjYXNlKVxyXG4gICAgY29uc3Qgbm9ybWFsaXplZFR5cGUgPSBmaWxlVHlwZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL15cXC4vLCAnJyk7XHJcblxyXG4gICAgLy8gR2V0IFVSTCBjb252ZXJ0ZXIgZGlyZWN0bHkgZnJvbSByZWdpc3RyeSBpZiBhdmFpbGFibGVcclxuICAgIGlmIChub3JtYWxpemVkVHlwZSA9PT0gJ3VybCcgfHwgbm9ybWFsaXplZFR5cGUgPT09ICdwYXJlbnR1cmwnKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFVzaW5nIGRpcmVjdCBVUkwgY29udmVydGVyIGZvcjogJHtub3JtYWxpemVkVHlwZX1gKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGNvbnZlcnRlciA9IHJlZ2lzdHJ5LmNvbnZlcnRlcnM/Lltub3JtYWxpemVkVHlwZV07XHJcbiAgICAgIGlmIChjb252ZXJ0ZXIpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKGBGb3VuZCAke25vcm1hbGl6ZWRUeXBlfSBjb252ZXJ0ZXJgKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgY29udmVydGVyOiB7XHJcbiAgICAgICAgICAgIC4uLmNvbnZlcnRlcixcclxuICAgICAgICAgICAgdHlwZTogbm9ybWFsaXplZFR5cGUsXHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICByZXR1cm4gY29udmVydGVyLmNvbnZlcnQoY29udGVudCwgbmFtZSwgYXBpS2V5LCB7XHJcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgbmFtZSxcclxuICAgICAgICAgICAgICAgIHR5cGU6IG5vcm1hbGl6ZWRUeXBlXHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB0eXBlOiBub3JtYWxpemVkVHlwZSxcclxuICAgICAgICAgIGNhdGVnb3J5OiAnd2ViJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFRyeSBmYWxsYmFjayB0byBjb252ZXJ0VG9NYXJrZG93blxyXG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKGBBdHRlbXB0aW5nIGNvbnZlcnRUb01hcmtkb3duIGZhbGxiYWNrIGZvciAke25vcm1hbGl6ZWRUeXBlfWApO1xyXG4gICAgICBpZiAocmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24pIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgY29udmVydGVyOiB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICByZXR1cm4gcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24obm9ybWFsaXplZFR5cGUsIGNvbnRlbnQsIHtcclxuICAgICAgICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICAgICAgICBhcGlLZXksXHJcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zXHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoaW5wdXQpID0+IHR5cGVvZiBpbnB1dCA9PT0gJ3N0cmluZycgJiYgaW5wdXQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgbmFtZTogbm9ybWFsaXplZFR5cGUgPT09ICd1cmwnID8gJ1dlYiBQYWdlJyA6ICdXZWJzaXRlJyxcclxuICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy51cmwnLCAnLmh0bWwnLCAnLmh0bSddLFxyXG4gICAgICAgICAgICAgIG1pbWVUeXBlczogWyd0ZXh0L2h0bWwnLCAnYXBwbGljYXRpb24veC11cmwnXSxcclxuICAgICAgICAgICAgICBtYXhTaXplOiAxMCAqIDEwMjQgKiAxMDI0XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB0eXBlOiBub3JtYWxpemVkVHlwZSxcclxuICAgICAgICAgIGNhdGVnb3J5OiAnd2ViJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gRm9yIGFsbCBvdGhlciB0eXBlcywgZ2V0IGNvbnZlcnRlciBmcm9tIHJlZ2lzdHJ5XHJcbiAgICBjb25zdCBjb252ZXJ0ZXIgPSBhd2FpdCByZWdpc3RyeS5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbihub3JtYWxpemVkVHlwZSk7XHJcbiAgICBpZiAoY29udmVydGVyKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgY29udmVydGVyLFxyXG4gICAgICAgIHR5cGU6IG5vcm1hbGl6ZWRUeXBlLFxyXG4gICAgICAgIGNhdGVnb3J5OiBGSUxFX1RZUEVfQ0FURUdPUklFU1tub3JtYWxpemVkVHlwZV0gfHwgJ2RvY3VtZW50J1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHRocm93IG5ldyBFcnJvcihgTm8gY29udmVydGVyIGZvdW5kIGZvciB0eXBlOiAke2ZpbGVUeXBlfWApO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ29udmVydCBhIGZpbGUgdG8gbWFya2Rvd24gdXNpbmcgdGhlIGFwcHJvcHJpYXRlIGNvbnZlcnRlclxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gdGhlIGZpbGUgb3IgVVJMIHN0cmluZ1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gLSBDb252ZXJzaW9uIHJlc3VsdFxyXG4gICAqL1xyXG4gIGFzeW5jIGNvbnZlcnRGaWxlKGZpbGVQYXRoLCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnN0IGZpbGVUeXBlID0gb3B0aW9ucy5maWxlVHlwZTtcclxuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XHJcbiAgICBcclxuICAgIHRoaXMubG9nZ2VyLmxvZ0NvbnZlcnNpb25TdGFydChmaWxlVHlwZSwgb3B0aW9ucyk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICghZmlsZVR5cGUpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2ZpbGVUeXBlIGlzIHJlcXVpcmVkIGluIG9wdGlvbnMnKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gRGV0ZXJtaW5lIGlmIHRoaXMgaXMgYSBVUkwgb3IgYSBmaWxlXHJcbiAgICAgIGNvbnN0IGlzVXJsID0gZmlsZVR5cGUgPT09ICd1cmwnIHx8IGZpbGVUeXBlID09PSAncGFyZW50dXJsJztcclxuICAgICAgXHJcbiAgICAgIC8vIEdldCBmaWxlIGRldGFpbHMgLSBoYW5kbGUgVVJMcyBkaWZmZXJlbnRseVxyXG4gICAgICBsZXQgZmlsZU5hbWU7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSkge1xyXG4gICAgICAgIGZpbGVOYW1lID0gb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghZmlsZU5hbWUpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignb3JpZ2luYWxGaWxlTmFtZSBpcyByZXF1aXJlZCB3aGVuIHBhc3NpbmcgYnVmZmVyIGlucHV0Jyk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKGlzVXJsKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGNvbnN0IHVybE9iaiA9IG5ldyBVUkwoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSB1cmxPYmouaG9zdG5hbWUgKyAodXJsT2JqLnBhdGhuYW1lICE9PSAnLycgPyB1cmxPYmoucGF0aG5hbWUgOiAnJyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSBmaWxlUGF0aDtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZmlsZU5hbWUgPSBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlNUQVJUSU5HLFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlZBTElEQVRJTkdcclxuICAgICAgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEdldCB0aGUgYXBwcm9wcmlhdGUgY29udmVydGVyIHdpdGggYXN5bmMvYXdhaXRcclxuICAgICAgbGV0IGNvbnZlcnRlckluZm8gPSBhd2FpdCB0aGlzLmdldENvbnZlcnRlcihmaWxlVHlwZSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBVUkwgdHlwZXMgaW4gcHJvZHVjdGlvbiBtb2RlXHJcbiAgICAgIGlmICghY29udmVydGVySW5mbyAmJiAoZmlsZVR5cGUgPT09ICd1cmwnIHx8IGZpbGVUeXBlID09PSAncGFyZW50dXJsJykpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTcGVjaWFsIGhhbmRsaW5nIGZvciAke2ZpbGVUeXBlfSBpbiBwcm9kdWN0aW9uIG1vZGVgKTtcclxuICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5jcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChjb252ZXJ0ZXJJbmZvKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKGBDcmVhdGVkIGRpcmVjdCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBJZiBjb252ZXJ0ZXIgbm90IGZvdW5kLCB0cnkgYWdhaW4gYWZ0ZXIgYSBzaG9ydCBkZWxheVxyXG4gICAgICBpZiAoIWNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZXRyeWluZyB0byBnZXQgY29udmVydGVyIGZvciAke2ZpbGVUeXBlfSBhZnRlciBkZWxheS4uLmApO1xyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCA1MDApKTtcclxuICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5nZXRDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghY29udmVydGVySW5mbyAmJiAoZmlsZVR5cGUgPT09ICd1cmwnIHx8IGZpbGVUeXBlID09PSAncGFyZW50dXJsJykpIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFNlY29uZCBhdHRlbXB0IGF0IHNwZWNpYWwgaGFuZGxpbmcgZm9yICR7ZmlsZVR5cGV9YCk7XHJcbiAgICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5jcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBJZiBzdGlsbCBub3QgZm91bmQsIHRyeSBvbmUgbW9yZSB0aW1lIHdpdGggYSBsb25nZXIgZGVsYXlcclxuICAgICAgICBpZiAoIWNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZpbmFsIGF0dGVtcHQgdG8gZ2V0IGNvbnZlcnRlciBmb3IgJHtmaWxlVHlwZX0gYWZ0ZXIgbG9uZ2VyIGRlbGF5Li4uYCk7XHJcbiAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwMCkpO1xyXG4gICAgICAgICAgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvICYmIChmaWxlVHlwZSA9PT0gJ3VybCcgfHwgZmlsZVR5cGUgPT09ICdwYXJlbnR1cmwnKSkge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBGaW5hbCBhdHRlbXB0IGF0IHNwZWNpYWwgaGFuZGxpbmcgZm9yICR7ZmlsZVR5cGV9YCk7XHJcbiAgICAgICAgICAgIGNvbnZlcnRlckluZm8gPSBhd2FpdCB0aGlzLmNyZWF0ZURpcmVjdFVybENvbnZlcnRlcihmaWxlVHlwZSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGlmICghY29udmVydGVySW5mbykge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGZpbGUgdHlwZTogJHtmaWxlVHlwZX1gKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSBhIHByb2dyZXNzIHRyYWNrZXIgaWYgY2FsbGJhY2sgcHJvdmlkZWRcclxuICAgICAgY29uc3QgcHJvZ3Jlc3NUcmFja2VyID0gb3B0aW9ucy5vblByb2dyZXNzID8gXHJcbiAgICAgICAgbmV3IFByb2dyZXNzVHJhY2tlcihvcHRpb25zLm9uUHJvZ3Jlc3MsIDI1MCkgOiBudWxsO1xyXG4gICAgICBcclxuICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoNSwgeyBzdGF0dXM6ICdpbml0aWFsaXppbmcnLCBmaWxlVHlwZTogZmlsZVR5cGUgfSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHJlZ2lzdHJ5ID0gYXdhaXQgdGhpcy5fZW5zdXJlSW5pdGlhbGl6ZWQoKTtcclxuXHJcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDb252ZXJ0ZXIgaW5mbzonLCBzYW5pdGl6ZUZvckxvZ2dpbmcoe1xyXG4gICAgICAgIGhhc1JlZ2lzdHJ5OiAhIXJlZ2lzdHJ5LFxyXG4gICAgICAgIGNvbnZlcnRlclR5cGU6IGNvbnZlcnRlckluZm8/LnR5cGUgfHwgJ25vbmUnLFxyXG4gICAgICAgIGNhdGVnb3J5OiBjb252ZXJ0ZXJJbmZvPy5jYXRlZ29yeSB8fCAndW5rbm93bicsXHJcbiAgICAgICAgaGFzQ29udmVydGVyOiAhIWNvbnZlcnRlckluZm8/LmNvbnZlcnRlcixcclxuICAgICAgICBjb252ZXJ0ZXJEZXRhaWxzOiBjb252ZXJ0ZXJJbmZvPy5jb252ZXJ0ZXJcclxuICAgICAgfSkpO1xyXG4gICAgICBcclxuICAgICAgLy8gSGFuZGxlIHRoZSBjb252ZXJzaW9uIGJhc2VkIG9uIGZpbGUgdHlwZVxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmhhbmRsZUNvbnZlcnNpb24oZmlsZVBhdGgsIHtcclxuICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZSxcclxuICAgICAgICBmaWxlTmFtZSxcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIsXHJcbiAgICAgICAgY29udmVydGVySW5mbyxcclxuICAgICAgICBpc1VybFxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDEwMCwgeyBzdGF0dXM6ICdjb21wbGV0ZWQnIH0pO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uQ29tcGxldGUoZmlsZVR5cGUpO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uRXJyb3IoZmlsZVR5cGUsIGVycm9yKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIHR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIG5hbWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCAndW5rbm93bicsXHJcbiAgICAgICAgY2F0ZWdvcnk6IEZJTEVfVFlQRV9DQVRFR09SSUVTW2ZpbGVUeXBlXSB8fCAndW5rbm93bidcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENyZWF0ZSBhIGRpcmVjdCBVUkwgY29udmVydGVyIGZvciBwcm9kdWN0aW9uIG1vZGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVR5cGUgLSBVUkwgZmlsZSB0eXBlICgndXJsJyBvciAncGFyZW50dXJsJylcclxuICAgKiBAcmV0dXJucyB7T2JqZWN0fG51bGx9IC0gQ29udmVydGVyIGluZm8gb3IgbnVsbCBpZiBub3QgcG9zc2libGVcclxuICAgKi9cclxuICBhc3luYyBjcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpIHtcclxuICAgIHRoaXMubG9nZ2VyLmluZm8oYENyZWF0aW5nIGRpcmVjdCBVUkwgY29udmVydGVyIGZvciAke2ZpbGVUeXBlfWApO1xyXG4gICAgXHJcbiAgICBjb25zdCByZWdpc3RyeSA9IGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKCk7XHJcbiAgICBpZiAoIXJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdDYW5ub3QgY3JlYXRlIGRpcmVjdCBVUkwgY29udmVydGVyOiBjb252ZXJ0VG9NYXJrZG93biBub3QgYXZhaWxhYmxlJyk7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBjb252ZXJ0ZXI6IHtcclxuICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBVc2luZyBkaXJlY3QgVVJMIGNvbnZlcnRlciBmb3IgJHtmaWxlVHlwZX1gKTtcclxuICAgICAgICAgIHJldHVybiByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93bihmaWxlVHlwZSwgY29udGVudCwge1xyXG4gICAgICAgICAgICBuYW1lLFxyXG4gICAgICAgICAgICBhcGlLZXksXHJcbiAgICAgICAgICAgIC4uLm9wdGlvbnNcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgdmFsaWRhdGU6IChpbnB1dCkgPT4gdHlwZW9mIGlucHV0ID09PSAnc3RyaW5nJyAmJiBpbnB1dC5sZW5ndGggPiAwLFxyXG4gICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgbmFtZTogZmlsZVR5cGUgPT09ICd1cmwnID8gJ1dlYiBQYWdlJyA6ICdXZWJzaXRlJyxcclxuICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnVybCcsICcuaHRtbCcsICcuaHRtJ10sXHJcbiAgICAgICAgICBtaW1lVHlwZXM6IFsndGV4dC9odG1sJywgJ2FwcGxpY2F0aW9uL3gtdXJsJ10sXHJcbiAgICAgICAgICBtYXhTaXplOiAxMCAqIDEwMjQgKiAxMDI0XHJcbiAgICAgICAgfVxyXG4gICAgICB9LFxyXG4gICAgICB0eXBlOiBmaWxlVHlwZSxcclxuICAgICAgY2F0ZWdvcnk6ICd3ZWInXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU3RhbmRhcmRpemUgY29udmVyc2lvbiByZXN1bHQgdG8gZW5zdXJlIGNvbnNpc3RlbnQgZm9ybWF0XHJcbiAgICpcclxuICAgKiBJTVBPUlRBTlQ6IFRoaXMgbWV0aG9kIGVuc3VyZXMgcHJvcGVydGllcyBhcmUgc2V0IGluIHRoZSBjb3JyZWN0IG9yZGVyIHRvIHByZXZlbnRcclxuICAgKiBwcm9wZXJ0eSBzaGFkb3dpbmcgaXNzdWVzLiBUaGUgb3JkZXIgbWF0dGVycyBiZWNhdXNlOlxyXG4gICAqIDEuIFdlIGZpcnN0IHNwcmVhZCB0aGUgcmVzdWx0IG9iamVjdCB0byBpbmNsdWRlIGFsbCBpdHMgcHJvcGVydGllc1xyXG4gICAqIDIuIFRoZW4gd2Ugb3ZlcnJpZGUgc3BlY2lmaWMgcHJvcGVydGllcyB0byBlbnN1cmUgdGhleSBoYXZlIHRoZSBjb3JyZWN0IHZhbHVlc1xyXG4gICAqIDMuIFdlIHNldCBjb250ZW50IGxhc3QgdG8gZW5zdXJlIGl0J3Mgbm90IGFjY2lkZW50YWxseSBvdmVycmlkZGVuXHJcbiAgICogNC4gV2UgYWRkIGEgZmluYWwgY2hlY2sgdG8gZW5zdXJlIGNvbnRlbnQgaXMgbmV2ZXIgZW1wdHksIHByb3ZpZGluZyBhIGZhbGxiYWNrXHJcbiAgICpcclxuICAgKiBUaGlzIGZpeGVzIHRoZSBcIkNvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudFwiIGVycm9yIHRoYXQgY291bGQgb2NjdXIgd2hlblxyXG4gICAqIHRoZSBjb250ZW50IHByb3BlcnR5IHdhcyBvdmVycmlkZGVuIGJ5IHRoZSBzcHJlYWQgb3BlcmF0b3IuXHJcbiAgICpcclxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVzdWx0IC0gUmF3IGNvbnZlcnNpb24gcmVzdWx0XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVUeXBlIC0gRmlsZSB0eXBlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVOYW1lIC0gRmlsZSBuYW1lXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGNhdGVnb3J5IC0gRmlsZSBjYXRlZ29yeVxyXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IC0gU3RhbmRhcmRpemVkIHJlc3VsdFxyXG4gICAqL1xyXG4gIHN0YW5kYXJkaXplUmVzdWx0KHJlc3VsdCwgZmlsZVR5cGUsIGZpbGVOYW1lLCBjYXRlZ29yeSkge1xyXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoYFJhdyByZXN1bHQgcmVjZWl2ZWQgZm9yICR7ZmlsZVR5cGV9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhyZXN1bHQpKTsgLy8gQWRkIGxvZ2dpbmdcclxuXHJcbiAgICAvLyBIYW5kbGUgbnVsbCBvciB1bmRlZmluZWQgcmVzdWx0IGV4cGxpY2l0bHlcclxuICAgIGlmICghcmVzdWx0KSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgUmVjZWl2ZWQgbnVsbCBvciB1bmRlZmluZWQgcmVzdWx0IGZvciAke2ZpbGVUeXBlfS4gQXNzdW1pbmcgZmFpbHVyZS5gKTtcclxuICAgICAgICByZXN1bHQgPSB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogJ0NvbnZlcnRlciByZXR1cm5lZCBudWxsIG9yIHVuZGVmaW5lZCByZXN1bHQnIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIHN1Y2Nlc3Mgc3RhdHVzIG1vcmUgcm9idXN0bHlcclxuICAgIC8vIFN1Y2Nlc3MgaXMgT05MWSB0cnVlIGlmIHJlc3VsdC5zdWNjZXNzIGlzIGV4cGxpY2l0bHkgdHJ1ZS5cclxuICAgIC8vIE90aGVyd2lzZSwgaXQncyBmYWxzZSwgZXNwZWNpYWxseSBpZiBhbiBlcnJvciBwcm9wZXJ0eSBleGlzdHMuXHJcbiAgICBjb25zdCBpc1N1Y2Nlc3MgPSByZXN1bHQuc3VjY2VzcyA9PT0gdHJ1ZTtcclxuXHJcbiAgICAvLyBTYW5pdGl6ZSBwb3RlbnRpYWxseSBjb21wbGV4IG9iamVjdHMgd2l0aGluIHRoZSByZXN1bHQgKmFmdGVyKiBkZXRlcm1pbmluZyBzdWNjZXNzXHJcbiAgICBjb25zdCBzYW5pdGl6ZWRSZXN1bHQgPSBzYW5pdGl6ZUZvckxvZ2dpbmcocmVzdWx0KTtcclxuXHJcbiAgICBjb25zdCBzdGFuZGFyZGl6ZWQgPSB7XHJcbiAgICAgICAgLi4uc2FuaXRpemVkUmVzdWx0LCAvLyBTcHJlYWQgc2FuaXRpemVkIHJlc3VsdCBmaXJzdFxyXG4gICAgICAgIHN1Y2Nlc3M6IGlzU3VjY2VzcywgLy8gT3ZlcnJpZGUgd2l0aCBkZXRlcm1pbmVkIHN1Y2Nlc3Mgc3RhdHVzXHJcbiAgICAgICAgdHlwZTogcmVzdWx0LnR5cGUgfHwgZmlsZVR5cGUsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIG5hbWU6IHJlc3VsdC5uYW1lIHx8IGZpbGVOYW1lLFxyXG4gICAgICAgIGNhdGVnb3J5OiByZXN1bHQuY2F0ZWdvcnkgfHwgY2F0ZWdvcnksXHJcbiAgICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICAgICAgLi4uKHJlc3VsdC5tZXRhZGF0YSB8fCB7fSksXHJcbiAgICAgICAgICAgIGNvbnZlcnRlcjogcmVzdWx0LmNvbnZlcnRlciB8fCAndW5rbm93bidcclxuICAgICAgICB9LFxyXG4gICAgICAgIGltYWdlczogcmVzdWx0LmltYWdlcyB8fCBbXSxcclxuICAgICAgICAvLyBFbnN1cmUgY29udGVudCBleGlzdHMsIHByb3ZpZGUgZmFsbGJhY2sgaWYgbmVlZGVkXHJcbiAgICAgICAgY29udGVudDogcmVzdWx0LmNvbnRlbnQgfHwgKGlzU3VjY2VzcyA/ICcnIDogYCMgQ29udmVyc2lvbiBSZXN1bHRcXG5cXG5UaGUgJHtmaWxlVHlwZX0gZmlsZSB3YXMgcHJvY2Vzc2VkLCBidXQgbm8gY29udGVudCB3YXMgZ2VuZXJhdGVkLiBUaGlzIG1pZ2h0IGluZGljYXRlIGFuIGlzc3VlIG9yIGJlIG5vcm1hbCBmb3IgdGhpcyBmaWxlIHR5cGUuYCksXHJcbiAgICAgICAgLy8gRW5zdXJlIGVycm9yIHByb3BlcnR5IGlzIHByZXNlbnQgaWYgbm90IHN1Y2Nlc3NmdWxcclxuICAgICAgICBlcnJvcjogIWlzU3VjY2VzcyA/IChyZXN1bHQuZXJyb3IgfHwgJ1Vua25vd24gY29udmVyc2lvbiBlcnJvcicpIDogdW5kZWZpbmVkXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFJlbW92ZSBlcnJvciBwcm9wZXJ0eSBpZiBzdWNjZXNzZnVsXHJcbiAgICBpZiAoc3RhbmRhcmRpemVkLnN1Y2Nlc3MpIHtcclxuICAgICAgICBkZWxldGUgc3RhbmRhcmRpemVkLmVycm9yO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBFbnN1cmUgY29udGVudCBpcyBub3QgbnVsbCBvciB1bmRlZmluZWQsIGFuZCBwcm92aWRlIGFwcHJvcHJpYXRlIGZhbGxiYWNrXHJcbiAgICBpZiAoIXN0YW5kYXJkaXplZC5jb250ZW50ICYmICFpc1N1Y2Nlc3MpIHtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuQ09OVEVOVF9FTVBUWVxyXG4gICAgICApO1xyXG4gICAgICAvLyBQcm92aWRlIGEgbW9yZSBpbmZvcm1hdGl2ZSBtZXNzYWdlIGlmIHRoZSBjb252ZXJzaW9uIGZhaWxlZCBhbmQgY29udGVudCBpcyBlbXB0eVxyXG4gICAgICBzdGFuZGFyZGl6ZWQuY29udGVudCA9IGAjIENvbnZlcnNpb24gRXJyb3JcXG5cXG5UaGUgJHtmaWxlVHlwZX0gZmlsZSBjb252ZXJzaW9uIGZhaWxlZCBvciBwcm9kdWNlZCBubyBjb250ZW50LiBFcnJvcjogJHtzdGFuZGFyZGl6ZWQuZXJyb3IgfHwgJ1Vua25vd24gZXJyb3InfWA7XHJcbiAgICB9IGVsc2UgaWYgKCFzdGFuZGFyZGl6ZWQuY29udGVudCAmJiBpc1N1Y2Nlc3MpIHtcclxuICAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5QUk9DRVNTSU5HLFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkNPTlRFTlRfRU1QVFlcclxuICAgICAgKTtcclxuICAgICAgLy8gRmFsbGJhY2sgZm9yIHN1Y2Nlc3NmdWwgY29udmVyc2lvbiBidXQgZW1wdHkgY29udGVudFxyXG4gICAgICBzdGFuZGFyZGl6ZWQuY29udGVudCA9IGAjIENvbnZlcnNpb24gUmVzdWx0XFxuXFxuVGhlICR7ZmlsZVR5cGV9IGZpbGUgd2FzIHByb2Nlc3NlZCBzdWNjZXNzZnVsbHksIGJ1dCBubyB0ZXh0dWFsIGNvbnRlbnQgd2FzIGdlbmVyYXRlZC4gVGhpcyBpcyBub3JtYWwgZm9yIGNlcnRhaW4gZmlsZSB0eXBlcyAoZS5nLiwgbXVsdGltZWRpYSBmaWxlcyB3aXRob3V0IHRyYW5zY3JpcHRpb24pLmA7XHJcbiAgICB9XHJcblxyXG5cclxuICAgIC8vIExvZyB0aGUgZmluYWwgc3RhbmRhcmRpemVkIHJlc3VsdFxyXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoYFN0YW5kYXJkaXplZCByZXN1bHQgZm9yICR7ZmlsZVR5cGV9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhzdGFuZGFyZGl6ZWQpKTtcclxuXHJcbiAgICByZXR1cm4gc3RhbmRhcmRpemVkO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgaGFuZGxlQ29udmVyc2lvbihmaWxlUGF0aCwgb3B0aW9ucykge1xyXG4gICAgY29uc3QgeyBwcm9ncmVzc1RyYWNrZXIsIGZpbGVUeXBlLCBmaWxlTmFtZSwgY29udmVydGVySW5mbywgaXNVcmwgfSA9IG9wdGlvbnM7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFZhbGlkYXRlIGNvbnZlcnRlckluZm9cclxuICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYE5vIGNvbnZlcnRlciBpbmZvIGF2YWlsYWJsZSBmb3IgJHtmaWxlVHlwZX1gKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbnZlcnRlciBpbmZvIGF2YWlsYWJsZSBmb3IgJHtmaWxlVHlwZX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlZBTElEQVRJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRkFTVF9BVFRFTVBUXHJcbiAgICAgICk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBIYW5kbGUgVVJMIGFuZCBwYXJlbnQgVVJMIGRpZmZlcmVudGx5IHNpbmNlIHRoZXkgZG9uJ3QgbmVlZCBmaWxlIHJlYWRpbmdcclxuICAgICAgaWYgKGlzVXJsKSB7XHJcbiAgICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZSgyMCwgeyBzdGF0dXM6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YCB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgUHJvY2Vzc2luZyBVUkw6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gRm9yIFVSTHMsIGZpbGVQYXRoIGlzIGFjdHVhbGx5IHRoZSBVUkwgc3RyaW5nXHJcbiAgICAgICAgbGV0IHJlc3VsdDtcclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgLy8gVHJ5IHVzaW5nIHRoZSBjb252ZXJ0ZXIncyBjb252ZXJ0IG1ldGhvZCBmaXJzdFxyXG4gICAgICAgICAgaWYgKHR5cGVvZiBjb252ZXJ0ZXIuY29udmVydCA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBVc2luZyBjb252ZXJ0ZXIuY29udmVydCBmb3IgJHtmaWxlVHlwZX1gKTtcclxuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgY29udmVydGVyLmNvbnZlcnQoZmlsZVBhdGgsIGZpbGVOYW1lLCBvcHRpb25zLmFwaUtleSwge1xyXG4gICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgbmFtZTogZmlsZU5hbWUsXHJcbiAgICAgICAgICAgICAgb25Qcm9ncmVzczogKHByb2dyZXNzKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgICAgICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGVTY2FsZWQocHJvZ3Jlc3MsIDIwLCA5MCwgeyBcclxuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IHR5cGVvZiBwcm9ncmVzcyA9PT0gJ29iamVjdCcgPyBwcm9ncmVzcy5zdGF0dXMgOiBgcHJvY2Vzc2luZ18ke2ZpbGVUeXBlfWBcclxuICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIC8vIEZhbGwgYmFjayB0byB1c2luZyB0aGUgcmVnaXN0cnkncyBjb252ZXJ0VG9NYXJrZG93biBtZXRob2RcclxuICAgICAgICAgICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBVc2luZyByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93biBmb3IgJHtmaWxlVHlwZX1gKTtcclxuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24oZmlsZVR5cGUsIGZpbGVQYXRoLCB7XHJcbiAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICBuYW1lOiBmaWxlTmFtZSxcclxuICAgICAgICAgICAgICBvblByb2dyZXNzOiAocHJvZ3Jlc3MpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICAgICAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZVNjYWxlZChwcm9ncmVzcywgMjAsIDkwLCB7IFxyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogdHlwZW9mIHByb2dyZXNzID09PSAnb2JqZWN0JyA/IHByb2dyZXNzLnN0YXR1cyA6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YFxyXG4gICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgaW4gVVJMIGNvbnZlcnNpb246ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gVHJ5IHRoZSBhbHRlcm5hdGl2ZSBtZXRob2QgYXMgYSBmYWxsYmFja1xyXG4gICAgICAgICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgICAgICAgaWYgKHR5cGVvZiBjb252ZXJ0ZXIuY29udmVydCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24gPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgVHJ5aW5nIGFsdGVybmF0aXZlIGNvbnZlcnNpb24gbWV0aG9kIGFzIGZhbGxiYWNrYCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgIC8vIElmIHdlIHRyaWVkIGNvbnZlcnRlci5jb252ZXJ0IGZpcnN0LCBub3cgdHJ5IHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duXHJcbiAgICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24oZmlsZVR5cGUsIGZpbGVQYXRoLCB7XHJcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgbmFtZTogZmlsZU5hbWUsXHJcbiAgICAgICAgICAgICAgICBvblByb2dyZXNzOiAocHJvZ3Jlc3MpID0+IHtcclxuICAgICAgICAgICAgICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgICAgICAgICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGVTY2FsZWQocHJvZ3Jlc3MsIDIwLCA5MCwgeyBcclxuICAgICAgICAgICAgICAgICAgICAgIHN0YXR1czogdHlwZW9mIHByb2dyZXNzID09PSAnb2JqZWN0JyA/IHByb2dyZXNzLnN0YXR1cyA6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YFxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGZhbGxiYWNrRXJyb3IpIHtcclxuICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFsbGJhY2sgY29udmVyc2lvbiBhbHNvIGZhaWxlZDogJHtmYWxsYmFja0Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7IC8vIFRocm93IHRoZSBvcmlnaW5hbCBlcnJvclxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjsgLy8gUmUtdGhyb3cgaWYgbm8gZmFsbGJhY2sgaXMgYXZhaWxhYmxlXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoOTUsIHsgc3RhdHVzOiAnZmluYWxpemluZycgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkcsXHJcbiAgICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GSU5BTElaSU5HXHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhbmRhcmRpemVSZXN1bHQocmVzdWx0LCBmaWxlVHlwZSwgZmlsZU5hbWUsIGNhdGVnb3J5KTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gUmVhZCBmaWxlIGNvbnRlbnQgaWYgbm90IGFscmVhZHkgYSBidWZmZXJcclxuICAgICAgY29uc3QgZmlsZUNvbnRlbnQgPSBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpID8gZmlsZVBhdGggOiBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgpO1xyXG4gICAgICBcclxuICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoMjAsIHsgc3RhdHVzOiBgY29udmVydGluZ18ke2ZpbGVUeXBlfWAgfSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIFBERiBmaWxlcyB0byBpbmNsdWRlIE9DUiBvcHRpb25zXHJcbiAgICAgIGlmIChmaWxlVHlwZSA9PT0gJ3BkZicpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQ29udmVydGluZyBQREYgd2l0aCBvcHRpb25zOicsIHtcclxuICAgICAgICAgIHVzZU9jcjogb3B0aW9ucy51c2VPY3IsXHJcbiAgICAgICAgICBoYXNNaXN0cmFsQXBpS2V5OiAhIW9wdGlvbnMubWlzdHJhbEFwaUtleSxcclxuICAgICAgICAgIHByZXNlcnZlUGFnZUluZm86IHRydWVcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgbW9yZSBkZXRhaWxlZCBsb2dnaW5nIGZvciBPQ1Igc2V0dGluZ3NcclxuICAgICAgICBpZiAob3B0aW9ucy51c2VPY3IpIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ09DUiBpcyBlbmFibGVkIGZvciB0aGlzIGNvbnZlcnNpb24nKTtcclxuICAgICAgICAgIGlmIChvcHRpb25zLm1pc3RyYWxBcGlLZXkpIHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ01pc3RyYWwgQVBJIGtleSBpcyBwcmVzZW50Jyk7XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdPQ1IgaXMgZW5hYmxlZCBidXQgTWlzdHJhbCBBUEkga2V5IGlzIG1pc3NpbmcnKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIGF1ZGlvL3ZpZGVvIGZpbGVzIHRvIGVuc3VyZSB0aGV5IGRvbid0IHVzZSBNaXN0cmFsIEFQSSBrZXlcclxuICAgICAgaWYgKGZpbGVUeXBlID09PSAnbXAzJyB8fCBmaWxlVHlwZSA9PT0gJ3dhdicgfHwgZmlsZVR5cGUgPT09ICdtcDQnIHx8IGZpbGVUeXBlID09PSAnbW92JyB8fCBcclxuICAgICAgICAgIGZpbGVUeXBlID09PSAnb2dnJyB8fCBmaWxlVHlwZSA9PT0gJ3dlYm0nIHx8IGZpbGVUeXBlID09PSAnYXZpJyB8fCBcclxuICAgICAgICAgIGZpbGVUeXBlID09PSAnZmxhYycgfHwgZmlsZVR5cGUgPT09ICdtNGEnKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29udmVydGluZyBtdWx0aW1lZGlhIGZpbGUgKCR7ZmlsZVR5cGV9KWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFJlbW92ZSBtaXN0cmFsQXBpS2V5IGZyb20gb3B0aW9ucyBmb3IgbXVsdGltZWRpYSBmaWxlcyB0byBwcmV2ZW50IGluY29ycmVjdCByb3V0aW5nXHJcbiAgICAgICAgaWYgKG9wdGlvbnMubWlzdHJhbEFwaUtleSkge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnUmVtb3ZpbmcgTWlzdHJhbCBBUEkga2V5IGZyb20gbXVsdGltZWRpYSBjb252ZXJzaW9uIG9wdGlvbnMnKTtcclxuICAgICAgICAgIGNvbnN0IHsgbWlzdHJhbEFwaUtleSwgLi4uY2xlYW5PcHRpb25zIH0gPSBvcHRpb25zO1xyXG4gICAgICAgICAgb3B0aW9ucyA9IGNsZWFuT3B0aW9ucztcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GQVNUX0FUVEVNUFQsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuUFJPQ0VTU0lOR1xyXG4gICAgICApO1xyXG4gICAgICBcclxuICAgICAgLy8gVXNlIHRoZSBjb252ZXJ0ZXIncyBjb252ZXJ0IG1ldGhvZFxyXG4gICAgICBjb25zdCB7IGNvbnZlcnRlciwgY2F0ZWdvcnkgfSA9IGNvbnZlcnRlckluZm87XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbnZlcnRlci5jb252ZXJ0KGZpbGVDb250ZW50LCBmaWxlTmFtZSwgb3B0aW9ucy5hcGlLZXksIHtcclxuICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgIG5hbWU6IGZpbGVOYW1lLFxyXG4gICAgICAgIG9uUHJvZ3Jlc3M6IChwcm9ncmVzcykgPT4ge1xyXG4gICAgICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlU2NhbGVkKHByb2dyZXNzLCAyMCwgOTAsIHsgXHJcbiAgICAgICAgICAgICAgc3RhdHVzOiB0eXBlb2YgcHJvZ3Jlc3MgPT09ICdvYmplY3QnID8gcHJvZ3Jlc3Muc3RhdHVzIDogYGNvbnZlcnRpbmdfJHtmaWxlVHlwZX1gIFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoOTUsIHsgc3RhdHVzOiAnZmluYWxpemluZycgfSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5QUk9DRVNTSU5HLFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkZJTkFMSVpJTkdcclxuICAgICAgKTtcclxuXHJcbiAgICAgIHJldHVybiB0aGlzLnN0YW5kYXJkaXplUmVzdWx0KHJlc3VsdCwgZmlsZVR5cGUsIGZpbGVOYW1lLCBjYXRlZ29yeSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uRXJyb3IoZmlsZVR5cGUsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYCR7ZmlsZVR5cGUudG9VcHBlckNhc2UoKX0gY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gLFxyXG4gICAgICAgIGNvbnRlbnQ6IGAjIENvbnZlcnNpb24gRXJyb3JcXG5cXG5GYWlsZWQgdG8gY29udmVydCAke2ZpbGVUeXBlLnRvVXBwZXJDYXNlKCl9IGZpbGU6ICR7ZXJyb3IubWVzc2FnZX1gLFxyXG4gICAgICAgIHR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZSwgLy8gRXhwbGljaXRseSBpbmNsdWRlIGZpbGVUeXBlXHJcbiAgICAgICAgbmFtZTogZmlsZU5hbWUsXHJcbiAgICAgICAgY2F0ZWdvcnk6IGNhdGVnb3J5IHx8ICd1bmtub3duJ1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEFkZCBhbiBpbml0aWFsaXplIG1ldGhvZCB0byB0aGUgZmFjdG9yeSBpbnN0YW5jZVxyXG4gKiBUaGlzIGlzIG5lZWRlZCBmb3IgY29tcGF0aWJpbGl0eSB3aXRoIGNvZGUgdGhhdCBleHBlY3RzIHRoaXMgbWV0aG9kXHJcbiAqL1xyXG5jb25zdCB1bmlmaWVkQ29udmVydGVyRmFjdG9yeSA9IFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmdldEluc3RhbmNlKCk7XHJcblxyXG4vLyBBZGQgaW5pdGlhbGl6ZSBtZXRob2QgdG8gdGhlIGZhY3RvcnkgaW5zdGFuY2VcclxudW5pZmllZENvbnZlcnRlckZhY3RvcnkuaW5pdGlhbGl6ZSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xyXG4gIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlNUQVJUSU5HLFxyXG4gICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuSU5JVElBTElaSU5HXHJcbiAgKTtcclxuICBcclxuICB0cnkge1xyXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSW5pdGlhbGl6ZWQoKTtcclxuICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuSU5JVElBTElaSU5HLFxyXG4gICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5DT01QTEVURURcclxuICAgICk7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvbkVycm9yKCdpbml0JywgZXJyb3IpO1xyXG4gICAgdGhyb3cgZXJyb3I7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gRXhwb3J0IHNpbmdsZXRvbiBpbnN0YW5jZSBhbmQgbW9kdWxlIGZ1bmN0aW9uc1xyXG5tb2R1bGUuZXhwb3J0cyA9IHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5O1xyXG5tb2R1bGUuZXhwb3J0cy51bmlmaWVkQ29udmVy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