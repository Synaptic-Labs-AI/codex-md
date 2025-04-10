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

/**
 * Handles module loading with proper error handling and path resolution.
 */
class ModuleLoader {
  static async loadModule(modulePath) {
    try {
      const module = require(modulePath);
      return module.default || module;
    } catch (error) {
      console.error(`Failed to load module: ${modulePath}`, error);
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
    console.log('🔄 Starting converter initialization...');
    try {
      const paths = ModuleLoader.getModulePaths();
      console.log('🔍 Using converter paths:', paths);
      
      const registry = await ModuleLoader.loadModule(paths.registry);
      console.log('✅ Successfully loaded converter registry');
      
      // Validate registry
      if (!this._validateRegistry(registry)) {
        throw new Error('Invalid converter registry');
      }

      this._converterRegistry = registry;
      this._initialized = true;
      
      console.log('✅ Converter initialization complete');
      return this._converterRegistry;
    } catch (error) {
      this._initPromise = null;
      console.error('❌ Converter initialization failed:', error);
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
    console.log('UnifiedConverterFactory initialized');
    this._initializer = ConverterInitializer.getInstance();
    this._converterRegistry = null;
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
    console.log(`🔍 Getting converter for type: ${fileType}`);
    
    const registry = await this._ensureInitialized();
    
    if (!fileType) {
      throw new Error('File type is required');
    }

    // Normalize file type (remove dot, lowercase)
    const normalizedType = fileType.toLowerCase().replace(/^\./, '');

    // Get URL converter directly from registry if available
    if (normalizedType === 'url' || normalizedType === 'parenturl') {
      console.log(`🔗 Using direct URL converter for: ${normalizedType}`);
      
      const converter = registry.converters?.[normalizedType];
      if (converter) {
        console.log(`✅ Found ${normalizedType} converter`);
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
      console.log(`🔄 Attempting convertToMarkdown fallback for ${normalizedType}`);
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
    const startTime = Date.now();
    
    try {
      // Use the fileType provided by the frontend
      const fileType = options.fileType;
      if (!fileType) {
        throw new Error('fileType is required in options');
      }
      
      // Determine if this is a URL or a file
      const isUrl = fileType === 'url' || fileType === 'parenturl';
      
      // Get file details - handle URLs differently
      let fileName;
      
      if (Buffer.isBuffer(filePath)) {
        // For buffer inputs, use filename from options
        fileName = options.originalFileName;
        
        if (!fileName) {
          throw new Error('originalFileName is required when passing buffer input');
        }
      } else if (isUrl) {
        // For URLs, create a filename from the URL
        try {
          const urlObj = new URL(filePath);
          fileName = urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname : '');
        } catch (e) {
          // If URL parsing fails, use the raw string
          fileName = filePath;
        }
      } else {
        // For regular files, extract details from the path
        fileName = path.basename(filePath);
      }
      
      console.log(`🔄 [UnifiedConverterFactory] Converting file:`, {
        type: fileType,
        isUrl: isUrl,
        isBuffer: Buffer.isBuffer(filePath),
        fileName,
        options: {
          hasApiKey: !!options.apiKey,
          hasMistralKey: !!options.mistralApiKey,
          outputDir: options.outputDir ? 'specified' : 'default'
        }
      });
      
      // Get the appropriate converter with async/await
      let converterInfo = await this.getConverter(fileType);
      
      // Special handling for URL types in production mode
      if (!converterInfo && (fileType === 'url' || fileType === 'parenturl')) {
        console.log(`🔄 [UnifiedConverterFactory] Special handling for ${fileType} in production mode`);
        
        // Create a direct converter for URL types
        converterInfo = await this.createDirectUrlConverter(fileType);
        
        if (converterInfo) {
          console.log(`✅ [UnifiedConverterFactory] Created direct converter for ${fileType}`);
        }
      }
      
      // If converter not found, try again after a short delay
      if (!converterInfo) {
        console.log(`⏳ Retrying to get converter for ${fileType} after delay...`);
        // Wait a bit and try again
        await new Promise(resolve => setTimeout(resolve, 500));
        converterInfo = await this.getConverter(fileType);
        
        // Try special handling again if needed
        if (!converterInfo && (fileType === 'url' || fileType === 'parenturl')) {
          console.log(`🔄 [UnifiedConverterFactory] Second attempt at special handling for ${fileType}`);
          converterInfo = await this.createDirectUrlConverter(fileType);
        }
        
        // If still not found, try one more time with a longer delay
        if (!converterInfo) {
          console.log(`⏳ Final attempt to get converter for ${fileType} after longer delay...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          converterInfo = await this.getConverter(fileType);
          
          // Final attempt at special handling
          if (!converterInfo && (fileType === 'url' || fileType === 'parenturl')) {
            console.log(`🔄 [UnifiedConverterFactory] Final attempt at special handling for ${fileType}`);
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

      // Log converter status
      console.log(`🔍 [UnifiedConverterFactory] Converter info:`, {
        hasRegistry: !!registry,
        converterType: converterInfo?.type || 'none',
        category: converterInfo?.category || 'unknown',
        hasConverter: !!converterInfo?.converter
      });
      
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
      
      console.log(`✅ [UnifiedConverterFactory] Conversion completed in ${Date.now() - startTime}ms:`, {
        type: fileType,
        fileName,
        isUrl: isUrl,
        isBuffer: Buffer.isBuffer(filePath),
        success: !!result.success,
        timing: `${Date.now() - startTime}ms`
      });
      
      return result;
      
    } catch (error) {
      // Always include fileType in error results
      const fileType = options.fileType || 'unknown';
      const fileName = options.originalFileName || 'unknown';
      
      const errorDetails = {
        fileType, // Always include fileType
        fileName,
        isBuffer: Buffer.isBuffer(filePath),
        error: error.message,
        stack: error.stack
      };
      console.error('❌ [UnifiedConverterFactory] Conversion failed:', errorDetails);
      
      return {
        success: false,
        error: error.message,
        fileType: fileType, // Explicitly include fileType
        type: fileType,
        name: fileName,
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
    console.log(`🔧 [UnifiedConverterFactory] Creating direct URL converter for ${fileType}`);
    
    const registry = await this._ensureInitialized();
    if (!registry.convertToMarkdown) {
      console.error(`❌ [UnifiedConverterFactory] Cannot create direct URL converter: convertToMarkdown not available`);
      return null;
    }
    
    return {
      converter: {
        convert: async (content, name, apiKey, options) => {
          console.log(`🔄 [UnifiedConverterFactory] Using direct URL converter for ${fileType}`);
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
          maxSize: 10 * 1024 * 1024 // 10MB
        }
      },
      type: fileType,
      category: 'web'
    };
  }

  /**
   * Standardize conversion result to ensure consistent format
   * @param {Object} result - Raw conversion result
   * @param {string} fileType - File type
   * @param {string} fileName - File name
   * @param {string} category - File category
   * @returns {Object} - Standardized result
   */
  standardizeResult(result, fileType, fileName, category) {
    // Ensure the result has all required properties
    return {
      success: result.success !== false,
      content: result.content || '',
      type: result.type || fileType,
      fileType: fileType, // Explicitly include fileType
      name: result.name || fileName,
      category: result.category || category,
      metadata: {
        ...(result.metadata || {}),
        converter: result.converter || 'unknown'
      },
      images: result.images || [],
      ...result
    };
  }

  /**
   * Unified conversion handler for all file types
   * @private
   */
  async handleConversion(filePath, options) {
    console.log(`🔄 [VERBOSE] handleConversion called for ${options.fileType}`);
    console.time(`🕒 [VERBOSE] Total conversion time for ${options.fileType}`);
    
    const { progressTracker, fileType, fileName, converterInfo, isUrl } = options;
    
    // Validate converterInfo
    if (!converterInfo) {
      console.error(`❌ [VERBOSE] No converter info available for ${fileType}`);
      console.timeEnd(`🕒 [VERBOSE] Total conversion time for ${fileType}`);
      throw new Error(`No converter info available for ${fileType}`);
    }
    
    // Log converter info for debugging
    console.log(`🔍 [VERBOSE] Using converter for ${fileType}:`, {
      converterType: converterInfo.type,
      category: converterInfo.category,
      hasConverter: !!converterInfo.converter,
      converterMethods: converterInfo.converter ? Object.keys(converterInfo.converter) : 'none',
      hasConvertMethod: converterInfo.converter ? typeof converterInfo.converter.convert === 'function' : false,
      hasValidateMethod: converterInfo.converter ? typeof converterInfo.converter.validate === 'function' : false
    });
    
    const { converter, category } = converterInfo;
    
    // Validate converter
    if (!converter) {
      console.error(`❌ [VERBOSE] Converter object missing for ${fileType}`);
      console.timeEnd(`🕒 [VERBOSE] Total conversion time for ${fileType}`);
      throw new Error(`Converter object missing for ${fileType}`);
    }
    
    // Log detailed converter structure
    console.log(`🔍 [VERBOSE] Converter structure for ${fileType}:`, {
      methods: Object.keys(converter),
      convertType: typeof converter.convert,
      validateType: typeof converter.validate,
      hasConfig: !!converter.config,
      configKeys: converter.config ? Object.keys(converter.config) : 'none'
    });
    
    if (progressTracker) {
      progressTracker.update(10, { status: `reading_${fileType}` });
    }
    
    try {
      // Handle URL and parent URL differently since they don't need file reading
      if (isUrl) {
        if (progressTracker) {
          progressTracker.update(20, { status: `processing_${fileType}` });
        }
        
        console.log(`🔗 [UnifiedConverterFactory] Processing URL: ${filePath}`);
        console.log(`🔗 [UnifiedConverterFactory] Using converter method:`, {
          hasConvertMethod: typeof converter.convert === 'function',
          useDirectConverter: true
        });
        
        // Log the converter and options being used
        console.log(`🔗 [UnifiedConverterFactory] URL conversion options:`, {
          fileType,
          name: fileName,
          hasApiKey: !!options.apiKey,
          hasMistralKey: !!options.mistralApiKey
        });
        
        // For URLs, filePath is actually the URL string
        let result;
        
        try {
          // Try using the converter's convert method first
          if (typeof converter.convert === 'function') {
            console.log(`🔗 [UnifiedConverterFactory] Using converter.convert for ${fileType}`);
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
            console.log(`🔗 [UnifiedConverterFactory] Using registry.convertToMarkdown for ${fileType}`);
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
          console.error(`❌ [UnifiedConverterFactory] Error in URL conversion:`, error);
          
          // Try the alternative method as a fallback
    const registry = await this._ensureInitialized();
          if (typeof converter.convert === 'function' && typeof registry.convertToMarkdown === 'function') {
            console.log(`🔄 [UnifiedConverterFactory] Trying alternative conversion method as fallback`);
            
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
              console.error(`❌ [UnifiedConverterFactory] Fallback conversion also failed:`, fallbackError);
              throw error; // Throw the original error
            }
          } else {
            throw error; // Re-throw if no fallback is available
          }
        }
        
        if (progressTracker) {
          progressTracker.update(95, { status: 'finalizing' });
        }
        
        return this.standardizeResult(result, fileType, fileName, category);
      }
      
      // Read file content if not already a buffer
      const fileContent = Buffer.isBuffer(filePath) ? filePath : fs.readFileSync(filePath);
      
      if (progressTracker) {
        progressTracker.update(20, { status: `converting_${fileType}` });
      }
      
      // Special handling for PDF files to include OCR options
      if (fileType === 'pdf') {
        console.log('🔄 [UnifiedConverterFactory] Converting PDF with options:', {
          useOcr: options.useOcr,
          hasMistralApiKey: !!options.mistralApiKey,
          preservePageInfo: true
        });
        
        // Add more detailed logging for OCR settings
        if (options.useOcr) {
          console.log('🔍 [UnifiedConverterFactory] OCR is enabled for this conversion');
          if (options.mistralApiKey) {
            console.log('🔑 [UnifiedConverterFactory] Mistral API key is present');
          } else {
            console.warn('⚠️ [UnifiedConverterFactory] OCR is enabled but Mistral API key is missing');
          }
        }
      }
      
      // Use the converter's convert method
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
      
      return this.standardizeResult(result, fileType, fileName, category);
    } catch (error) {
      console.error(`❌ [UnifiedConverterFactory] ${fileType.toUpperCase()} conversion error:`, error);
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
  console.log('🔄 Initializing UnifiedConverterFactory...');
  try {
    await this._ensureInitialized();
    console.log('✅ UnifiedConverterFactory initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ UnifiedConverterFactory initialization failed:', error);
    throw error;
  }
};

// Export singleton instance and module functions
module.exports = unifiedConverterFactory;
module.exports.unifiedConverterFactory = unifiedConverterFactory;
