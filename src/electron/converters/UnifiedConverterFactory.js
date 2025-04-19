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

const { app } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const { PathUtils } = require('../utils/paths/index');
const { ProgressTracker } = require('../utils/conversion/progress');
const { getLogger } = require('../utils/logging/ConversionLogger');
const { sanitizeForLogging } = require('../utils/logging/LogSanitizer');
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
    const basePath = isDev ?
      path.resolve(process.cwd(), 'src/electron/services/conversion') :
      path.resolve(app.getAppPath(), 'src/electron/services/conversion');

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
    this.logger.logPhaseTransition(
      ConversionStatus.STATUS.STARTING,
      ConversionStatus.STATUS.INITIALIZING
    );

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
      
      this.logger.logPhaseTransition(
        ConversionStatus.STATUS.INITIALIZING,
        ConversionStatus.STATUS.COMPLETED
      );

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
  parenturl: 'web',
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
    this.logger.setContext({ fileType });
    
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
            validate: (input) => typeof input === 'string' && input.length > 0,
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

      this.logger.logPhaseTransition(
        ConversionStatus.STATUS.STARTING,
        ConversionStatus.STATUS.VALIDATING
      );
      
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
      const progressTracker = options.onProgress ? 
        new ProgressTracker(options.onProgress, 250) : null;
      
      if (progressTracker) {
        progressTracker.update(5, { status: 'initializing', fileType: fileType });
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
        progressTracker.update(100, { status: 'completed' });
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
        validate: (input) => typeof input === 'string' && input.length > 0,
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
    // Handle null or undefined result
    if (!result) {
      result = {};
    }
    
    // Sanitize any buffer or complex objects in the result
    const sanitizedResult = sanitizeForLogging(result);
    
    // First spread the result, then override with explicit properties
    // This ensures explicit properties take precedence over any in the spread
    const standardized = {
      ...sanitizedResult,
      // Then override with explicit properties to ensure they take precedence
      success: result.success !== false,
      type: result.type || fileType,
      fileType: fileType, // Explicitly include fileType
      name: result.name || fileName,
      category: result.category || category,
      metadata: {
        ...(result.metadata || {}),
        converter: result.converter || 'unknown'
      },
      images: result.images || [],
      // Set content last to ensure it's not overridden
      content: result.content || ''
    };
    
    // Ensure content is not null or undefined
    if (!standardized.content) {
      this.logger.logPhaseTransition(
        ConversionStatus.STATUS.PROCESSING,
        ConversionStatus.STATUS.CONTENT_EMPTY
      );

      standardized.content = `# Conversion Result\n\nThe ${fileType} file was processed, but no content was generated. This is normal for certain types of files (e.g., multimedia files without transcription).`;
    }
    
    return standardized;
  }

  async handleConversion(filePath, options) {
    const { progressTracker, fileType, fileName, converterInfo, isUrl } = options;
    
    try {
      // Validate converterInfo
      if (!converterInfo) {
        this.logger.error(`No converter info available for ${fileType}`);
        throw new Error(`No converter info available for ${fileType}`);
      }

      this.logger.logPhaseTransition(
        ConversionStatus.STATUS.VALIDATING,
        ConversionStatus.STATUS.FAST_ATTEMPT
      );
      
      // Handle URL and parent URL differently since they don't need file reading
      if (isUrl) {
        if (progressTracker) {
          progressTracker.update(20, { status: `processing_${fileType}` });
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
              onProgress: (progress) => {
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
              onProgress: (progress) => {
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
                onProgress: (progress) => {
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
          progressTracker.update(95, { status: 'finalizing' });
        }
        
        this.logger.logPhaseTransition(
          ConversionStatus.STATUS.PROCESSING,
          ConversionStatus.STATUS.FINALIZING
        );

        return this.standardizeResult(result, fileType, fileName, category);
      }
      
      // Read file content if not already a buffer
      const fileContent = Buffer.isBuffer(filePath) ? filePath : fs.readFileSync(filePath);
      
      if (progressTracker) {
        progressTracker.update(20, { status: `converting_${fileType}` });
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
      if (fileType === 'mp3' || fileType === 'wav' || fileType === 'mp4' || fileType === 'mov' || 
          fileType === 'ogg' || fileType === 'webm' || fileType === 'avi' || 
          fileType === 'flac' || fileType === 'm4a') {
        this.logger.info(`Converting multimedia file (${fileType})`);
        
        // Remove mistralApiKey from options for multimedia files to prevent incorrect routing
        if (options.mistralApiKey) {
          this.logger.info('Removing Mistral API key from multimedia conversion options');
          const { mistralApiKey, ...cleanOptions } = options;
          options = cleanOptions;
        }
      }

      this.logger.logPhaseTransition(
        ConversionStatus.STATUS.FAST_ATTEMPT,
        ConversionStatus.STATUS.PROCESSING
      );
      
      // Use the converter's convert method
      const { converter, category } = converterInfo;
      const result = await converter.convert(fileContent, fileName, options.apiKey, {
        ...options,
        name: fileName,
        onProgress: (progress) => {
          if (progressTracker) {
            progressTracker.updateScaled(progress, 20, 90, { 
              status: typeof progress === 'object' ? progress.status : `converting_${fileType}` 
            });
          }
        }
      });
      
      if (progressTracker) {
        progressTracker.update(95, { status: 'finalizing' });
      }
      
      this.logger.logPhaseTransition(
        ConversionStatus.STATUS.PROCESSING,
        ConversionStatus.STATUS.FINALIZING
      );

      return this.standardizeResult(result, fileType, fileName, category);
    } catch (error) {
      this.logger.logConversionError(fileType, error);
      return {
        success: false,
        error: `${fileType.toUpperCase()} conversion failed: ${error.message}`,
        content: `# Conversion Error\n\nFailed to convert ${fileType.toUpperCase()} file: ${error.message}`,
        type: fileType,
        fileType: fileType, // Explicitly include fileType
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
unifiedConverterFactory.initialize = async function() {
  this.logger.logPhaseTransition(
    ConversionStatus.STATUS.STARTING,
    ConversionStatus.STATUS.INITIALIZING
  );
  
  try {
    await this._ensureInitialized();
    this.logger.logPhaseTransition(
      ConversionStatus.STATUS.INITIALIZING,
      ConversionStatus.STATUS.COMPLETED
    );
    return true;
  } catch (error) {
    this.logger.logConversionError('init', error);
    throw error;
  }
};

// Export singleton instance and module functions
module.exports = unifiedConverterFactory;
module.exports.unifiedConverterFactory = unifiedConverterFactory;
