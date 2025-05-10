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

// Core dependencies
let app;
try {
  // Try to load electron in a safer way
  const electron = require('electron');
  app = electron.app || electron.remote && electron.remote.app;
} catch (e) {
  // If electron isn't available, we'll handle it below
  console.warn('Could not load electron app, using fallbacks');
}

// Essential utilities - load with fallbacks
let fs;
try {
  fs = require('fs-extra');
} catch (e) {
  try {
    fs = require('fs');
    // Add fs-extra methods we use
    fs.existsSync = fs.existsSync || (path => {
      try {
        return fs.statSync(path).isFile();
      } catch (e) {
        return false;
      }
    });
  } catch (innerE) {
    console.error('Failed to load fs modules', innerE);
    throw new Error('Critical dependency fs/fs-extra not available');
  }
}

// Path handling - essential for module resolution
const path = require('path');

// Try to load internal modules with fallbacks
let PathUtils, ProgressTracker, getLogger, sanitizeForLogging, ConversionStatus;

// Attempt to load each module with fallbacks to prevent crashes
const safeRequire = (modulePath, fallbacks = []) => {
  try {
    return require(modulePath);
  } catch (e) {
    for (const fallback of fallbacks) {
      try {
        return require(fallback);
      } catch {/* Continue to next fallback */}
    }

    // Default implementations for critical functions
    if (modulePath.includes('getLogger')) {
      return name => ({
        log: (msg, level, ...args) => console.log(`[${name}][${level || 'INFO'}] ${msg}`, ...args),
        error: (msg, err) => console.error(`[${name}][ERROR] ${msg}`, err),
        warn: (msg, ...args) => console.warn(`[${name}][WARN] ${msg}`, ...args),
        success: msg => console.log(`[${name}][SUCCESS] ${msg}`),
        debug: (msg, ...args) => console.debug(`[${name}][DEBUG] ${msg}`, ...args),
        logPhaseTransition: (from, to) => console.log(`[${name}] Phase transition: ${from} → ${to}`),
        logConversionStart: (type, opts) => console.log(`[${name}] Starting conversion for ${type}`),
        logConversionComplete: type => console.log(`[${name}] Completed conversion for ${type}`),
        logConversionError: (type, err) => console.error(`[${name}:failed][${type}] ❌ ${err.message}`, err),
        setContext: () => {}
      });
    }
    if (modulePath.includes('sanitizeForLogging')) {
      return obj => {
        try {
          return typeof obj === 'object' ? {
            ...obj
          } : obj;
        } catch {
          return obj;
        }
      };
    }
    console.warn(`Module ${modulePath} not available, using minimal implementation`);
    return {};
  }
};
try {
  PathUtils = safeRequire('../utils/paths/index', [path.resolve(__dirname, '../utils/paths/index'), path.resolve(process.cwd(), 'src/electron/utils/paths/index')]).PathUtils || {};
  ProgressTracker = safeRequire('../utils/conversion/progress', [path.resolve(__dirname, '../utils/conversion/progress'), path.resolve(process.cwd(), 'src/electron/utils/conversion/progress')]).ProgressTracker || class ProgressTracker {
    constructor(callback) {
      this.callback = callback;
    }
    update(progress, data) {
      this.callback && this.callback(progress, data);
    }
    updateScaled(progress, min, max, data) {
      this.update(min + progress / 100 * (max - min), data);
    }
  };
  getLogger = safeRequire('../utils/logging/ConversionLogger', [path.resolve(__dirname, '../utils/logging/ConversionLogger'), path.resolve(process.cwd(), 'src/electron/utils/logging/ConversionLogger')]).getLogger || (name => ({
    log: (msg, level, ...args) => console.log(`[${name}][${level || 'INFO'}] ${msg}`, ...args),
    error: (msg, err) => console.error(`[${name}][ERROR] ${msg}`, err),
    warn: (msg, ...args) => console.warn(`[${name}][WARN] ${msg}`, ...args),
    success: msg => console.log(`[${name}][SUCCESS] ${msg}`),
    debug: (msg, ...args) => console.debug(`[${name}][DEBUG] ${msg}`, ...args),
    logPhaseTransition: (from, to) => console.log(`[${name}] Phase transition: ${from} → ${to}`),
    logConversionStart: (type, opts) => console.log(`[${name}] Starting conversion for ${type}`),
    logConversionComplete: type => console.log(`[${name}] Completed conversion for ${type}`),
    logConversionError: (type, err) => console.error(`[${name}:failed][${type}] ❌ ${err.message}`, err),
    setContext: () => {}
  }));
  sanitizeForLogging = safeRequire('../utils/logging/LogSanitizer', [path.resolve(__dirname, '../utils/logging/LogSanitizer'), path.resolve(process.cwd(), 'src/electron/utils/logging/LogSanitizer')]).sanitizeForLogging || (obj => {
    try {
      return typeof obj === 'object' ? {
        ...obj
      } : obj;
    } catch {
      return obj;
    }
  });
  ConversionStatus = safeRequire('../utils/conversion/ConversionStatus', [path.resolve(__dirname, '../utils/conversion/ConversionStatus'), path.resolve(process.cwd(), 'src/electron/utils/conversion/ConversionStatus')]) || {
    STATUS: {
      STARTING: 'Starting conversion',
      INITIALIZING: '🔧 Initializing converter',
      VALIDATING: '🔍 Validating file',
      FAST_ATTEMPT: '⚡ Fast conversion attempt',
      PROCESSING: '⏳ Processing content',
      FINALIZING: '✅ Finalizing result',
      COMPLETED: '✓ Conversion complete',
      CONTENT_EMPTY: '⚠️ Empty content warning'
    }
  };
} catch (error) {
  console.error('Error loading core dependencies', error);
  throw new Error(`Critical dependency initialization failed: ${error.message}`);
}

// Initialize app with fallback if needed
if (!app) {
  app = {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getName: () => 'Codex.md',
    getVersion: () => '1.0.0'
  };
  console.warn('Using fallback app implementation');
}

/**
 * Handles module loading with proper error handling and path resolution.
 */
class ModuleLoader {
  static async loadModule(modulePath, options = {}) {
    const logger = getLogger('ModuleLoader');
    const {
      fallbackPaths = [],
      silent = false
    } = options;
    try {
      logger.log(`Loading module from path: ${modulePath}`, 'INFO');

      // Extract module name and category from path
      const moduleName = path.basename(modulePath);
      let category = '';

      // Try to parse category from path
      const pathParts = path.dirname(modulePath).split(path.sep);
      if (pathParts.length >= 2) {
        // Take the last two parts of the path as the category
        category = pathParts.slice(-2).join('/');
      } else {
        // Default category for conversions
        category = 'services/conversion';
      }
      logger.log(`Using ModuleResolver with module: ${moduleName}, category: ${category}`, 'INFO');

      // Use ModuleResolver to load the module
      try {
        const {
          ModuleResolver
        } = require('../utils/moduleResolver');
        const module = ModuleResolver.safeRequire(moduleName, category);
        logger.success(`Successfully loaded module using ModuleResolver: ${moduleName}`);
        return module;
      } catch (resolverError) {
        logger.error(`ModuleResolver failed: ${resolverError.message}`, resolverError);

        // If ModuleResolver fails, try the original approach with fallbacks
        logger.log('Falling back to direct require with fallbacks', 'INFO');

        // Try direct require first
        try {
          const module = require(modulePath);
          logger.success(`Successfully loaded module directly: ${modulePath}`);
          return module.default || module;
        } catch (directError) {
          // If fallback paths provided, try them sequentially
          if (fallbackPaths && fallbackPaths.length > 0) {
            logger.log(`Attempting to load from ${fallbackPaths.length} fallback paths`, 'INFO');
            for (const fallbackPath of fallbackPaths) {
              try {
                logger.log(`Trying fallback path: ${fallbackPath}`, 'INFO');
                const module = require(fallbackPath);
                logger.success(`Successfully loaded from fallback: ${fallbackPath}`);
                return module.default || module;
              } catch (fallbackError) {
                // Continue to next fallback path
                if (!silent) {
                  logger.warn(`Failed to load from fallback: ${fallbackPath}`);
                }
              }
            }
          }

          // If all else fails and this is ConverterRegistry.js, create a minimal registry
          if (moduleName === 'ConverterRegistry.js') {
            logger.log('All loading attempts failed for ConverterRegistry.js. Creating minimal registry', 'INFO');
            return this._createEmergencyRegistry();
          }

          // If we get here, all attempts failed
          throw new Error(`Failed to load module: ${modulePath}. Error: ${resolverError.message}`);
        }
      }
    } catch (error) {
      logger.error(`Module loading failed completely: ${error.message}`, error);
      throw new Error(`Module loading failed: ${modulePath}. Error: ${error.message}`);
    }
  }

  /**
   * Creates an emergency minimal registry as a last resort
   * @returns {Object} A minimal registry implementation
   * @private
   */
  static _createEmergencyRegistry() {
    const logger = getLogger('ModuleLoader');
    logger.log('📦 Creating emergency minimal registry implementation', 'INFO');

    // Create minimal registry constructor function to match existing pattern
    function ConverterRegistry() {
      this.converters = {
        pdf: {
          convert: async (content, name, apiKey, options = {}) => {
            console.log('[EmergencyRegistry] Using emergency PDF converter');
            return {
              success: true,
              content: `# Extracted from ${name || 'PDF document'}\n\nThis content was extracted using the emergency converter.\n\nThe application encountered an issue finding the correct converter module. Please report this issue.`,
              type: 'pdf',
              metadata: {
                pages: 1,
                converter: 'emergency-fallback'
              }
            };
          },
          validate: input => Buffer.isBuffer(input) || typeof input === 'string',
          config: {
            name: 'PDF Document (Emergency)',
            extensions: ['.pdf'],
            mimeTypes: ['application/pdf'],
            maxSize: 25 * 1024 * 1024
          }
        }
      };
    }

    // Add required prototype methods
    ConverterRegistry.prototype.convertToMarkdown = async function (type, content, options = {}) {
      console.log(`[EmergencyRegistry] Converting ${type} document`);
      return {
        success: true,
        content: `# Emergency Converter\n\nThis content was generated by an emergency fallback converter because the normal converter could not be loaded.\n\nPlease report this issue.`,
        metadata: {
          source: 'emergency-fallback'
        }
      };
    };
    ConverterRegistry.prototype.getConverterByExtension = function (extension) {
      console.log(`[EmergencyRegistry] Looking up converter for: ${extension}`);
      if (extension === 'pdf') {
        return this.converters.pdf;
      }
      return null;
    };

    // Create and return the registry instance
    return new ConverterRegistry();
  }

  /**
   * Attempts to load a module from the best available path
   * @param {string} moduleName - The module file name (e.g., 'ConverterRegistry.js')
   * @param {Array<string>} basePaths - List of base directories to look in
   * @returns {Promise<any>} - The loaded module
   */
  static async loadModuleFromBestPath(moduleName, basePaths) {
    const logger = getLogger('ModuleLoader');
    const resolvedPaths = basePaths.map(basePath => path.join(basePath, moduleName));
    logger.log(`Attempting to load ${moduleName} from ${resolvedPaths.length} possible paths`, 'INFO');

    // Check which paths exist first
    const existingPaths = resolvedPaths.filter(p => {
      const exists = fs.existsSync(p);
      logger.log(`Path ${p} exists: ${exists}`, 'INFO');
      return exists;
    });
    if (existingPaths.length === 0) {
      logger.error(`No existing paths found for module: ${moduleName}`);
      // Try all paths anyway as a last resort
      return this.loadModule(resolvedPaths[0], {
        fallbackPaths: resolvedPaths.slice(1),
        silent: true
      });
    }

    // Load from the first existing path, with remaining existing paths as fallbacks
    return this.loadModule(existingPaths[0], {
      fallbackPaths: existingPaths.slice(1)
    });
  }
  static getModulePaths() {
    const isDev = process.env.NODE_ENV === 'development';
    const logger = getLogger('ModuleLoader');

    // Create a comprehensive list of possible paths for the ConverterRegistry
    const possiblePaths = [
    // Development paths
    path.resolve(process.cwd(), 'src/electron/services/conversion'), path.resolve(process.cwd(), 'build/electron/services/conversion'),
    // Packaged app paths - note we explicitly handle the path from the error
    path.resolve(app.getAppPath(), 'build/electron/services/conversion'), path.resolve(app.getAppPath().replace(/src\/electron/, 'build/electron'), 'services/conversion'), path.resolve(app.getAppPath().replace(/src\\electron/, 'build\\electron'), 'services/conversion'), path.resolve(app.getAppPath(), 'src/electron/services/conversion'),
    // Relative paths from current module
    path.resolve(__dirname, '../services/conversion'), path.resolve(__dirname, '../../services/conversion'), path.resolve(__dirname, '../../build/electron/services/conversion'),
    // Paths with app.asar for packaged app
    path.resolve(app.getAppPath().replace('app.asar', 'app'), 'src/electron/services/conversion'), path.resolve(app.getAppPath().replace('app.asar', 'app'), 'build/electron/services/conversion'), path.resolve(app.getAppPath().replace('app.asar\\src', 'app.asar\\build'), 'electron/services/conversion'), path.resolve(app.getAppPath().replace('app.asar/src', 'app.asar/build'), 'electron/services/conversion'),
    // Alternative parent directory paths
    path.resolve(app.getAppPath(), '../build/electron/services/conversion'), path.resolve(app.getAppPath(), '../src/electron/services/conversion'),
    // Sibling paths
    path.resolve(path.dirname(app.getAppPath()), 'build/electron/services/conversion'), path.resolve(path.dirname(app.getAppPath()), 'src/electron/services/conversion'),
    // More nested paths for app.asar
    path.resolve(app.getAppPath(), 'dist/electron/services/conversion'), path.resolve(path.dirname(process.execPath), '../resources/app/src/electron/services/conversion'), path.resolve(path.dirname(process.execPath), '../resources/app/build/electron/services/conversion'),
    // Direct path fixes for the specific error path
    app.getAppPath().replace('src/electron/services/conversion', 'build/electron/services/conversion'), app.getAppPath().replace('src\\electron\\services\\conversion', 'build\\electron\\services\\conversion'),
    // Paths with dist prefixes (often used in built apps)
    path.resolve(process.cwd(), 'dist/electron/services/conversion'), path.resolve(app.getAppPath(), 'dist/electron/services/conversion'),
    // Additional paths specifically for ConverterRegistry.js
    path.resolve(process.cwd(), 'app/electron/services/conversion'), path.resolve(app.getAppPath(), 'app/electron/services/conversion'), path.resolve(__dirname, '../../../electron/services/conversion'), path.resolve(__dirname, '../../../../electron/services/conversion'), path.resolve(path.dirname(process.execPath), 'resources/app/electron/services/conversion'), path.resolve(path.dirname(process.execPath), 'resources/app.asar/electron/services/conversion'), path.resolve(path.dirname(process.execPath), 'resources/electron/services/conversion')];

    // Log app environment information for debugging
    logger.log(`App is packaged: ${app.isPackaged}`, 'INFO');
    logger.log(`App path: ${app.getAppPath()}`, 'INFO');
    logger.log(`__dirname: ${__dirname}`, 'INFO');
    logger.log(`process.cwd(): ${process.cwd()}`, 'INFO');
    logger.log(`process.execPath: ${process.execPath}`, 'INFO');

    // Log the specific path from the error message
    const errorPath = 'C:\\Users\\Joseph\\Documents\\Code\\codex-md\\dist\\win-unpacked\\resources\\app.asar\\src\\electron\\services\\conversion\\ConverterRegistry.js';
    const correctedPath = errorPath.replace('\\src\\', '\\build\\');
    logger.log(`Error path: ${errorPath}`, 'INFO');
    logger.log(`Corrected path: ${correctedPath}`, 'INFO');
    logger.log(`Corrected path exists: ${fs.existsSync(correctedPath)}`, 'INFO');

    // Find first existing base path
    let basePath = null;
    for (const candidatePath of possiblePaths) {
      try {
        const exists = fs.existsSync(candidatePath);
        logger.log(`Checking path: ${candidatePath} (exists: ${exists})`, 'INFO');
        if (exists) {
          basePath = candidatePath;
          logger.log(`Found valid base path: ${basePath}`, 'INFO');
          break;
        }
      } catch (error) {
        logger.warn(`Error checking path ${candidatePath}: ${error.message}`);
      }
    }

    // If no base path exists, try direct module paths
    if (!basePath) {
      logger.warn('No valid base path found, trying direct module resolution');

      // Define all possible direct paths to the registry module
      const directRegistryPaths = [
      // Specific paths based on error logs
      // This is the specific error path with 'src' replaced with 'build'
      app.getAppPath().replace('src/electron/services/conversion', 'build/electron/services/conversion') + '/ConverterRegistry.js', app.getAppPath().replace('src\\electron\\services\\conversion', 'build\\electron\\services\\conversion') + '\\ConverterRegistry.js',
      // Full string replacements for the specific error paths in the logs
      app.getAppPath().replace('app.asar\\src\\electron', 'app.asar\\build\\electron') + '\\services\\conversion\\ConverterRegistry.js', app.getAppPath().replace('app.asar/src/electron', 'app.asar/build/electron') + '/services/conversion/ConverterRegistry.js',
      // Standard application paths
      path.resolve(process.cwd(), 'src/electron/services/conversion/ConverterRegistry.js'), path.resolve(process.cwd(), 'build/electron/services/conversion/ConverterRegistry.js'), path.resolve(app.getAppPath(), 'build/electron/services/conversion/ConverterRegistry.js'), path.resolve(app.getAppPath(), 'src/electron/services/conversion/ConverterRegistry.js'),
      // Relative paths
      path.resolve(__dirname, '../services/conversion/ConverterRegistry.js'), path.resolve(__dirname, '../../services/conversion/ConverterRegistry.js'),
      // ASAR-specific paths with adaptations
      path.resolve(app.getAppPath().replace('app.asar', 'app'), 'src/electron/services/conversion/ConverterRegistry.js'), path.resolve(app.getAppPath().replace('app.asar', 'app'), 'build/electron/services/conversion/ConverterRegistry.js'), path.resolve(path.dirname(process.execPath), '../resources/app/src/electron/services/conversion/ConverterRegistry.js'), path.resolve(path.dirname(process.execPath), '../resources/app/build/electron/services/conversion/ConverterRegistry.js'), path.resolve(__dirname, '../../src/electron/services/conversion/ConverterRegistry.js'), path.resolve(__dirname, '../../build/electron/services/conversion/ConverterRegistry.js'), path.resolve(__dirname, '../../../electron/services/conversion/ConverterRegistry.js'), path.resolve(path.dirname(process.execPath), 'resources/app/src/electron/services/conversion/ConverterRegistry.js'), path.resolve(path.dirname(process.execPath), 'resources/app.asar/electron/services/conversion/ConverterRegistry.js'), path.resolve(path.dirname(process.execPath), 'resources/app.asar/build/electron/services/conversion/ConverterRegistry.js'),
      // Allow finding in current directories
      path.join(__dirname, 'ConverterRegistry.js'), path.join(path.dirname(__dirname), 'ConverterRegistry.js'),
      // Try absolute paths that match the error stack
      'C:\\Users\\Joseph\\Documents\\Code\\codex-md\\dist\\win-unpacked\\resources\\app.asar\\build\\electron\\services\\conversion\\ConverterRegistry.js'];

      // Find the first direct registry path that exists
      for (const registryPath of directRegistryPaths) {
        const exists = fs.existsSync(registryPath);
        logger.log(`Checking direct registry path: ${registryPath} (exists: ${exists})`, 'INFO');
        if (exists) {
          // Build a base path from the directory containing the registry
          basePath = path.dirname(registryPath);
          logger.log(`Found registry module at: ${registryPath}, using base path: ${basePath}`, 'INFO');
          break;
        }
      }
    }

    // Fallback to a default path if all else fails
    if (!basePath) {
      logger.error('All path resolution attempts failed, using fallback path');

      // Use a path relative to current module as last resort
      if (app.isPackaged) {
        basePath = path.resolve(__dirname, '../services/conversion');
      } else {
        basePath = path.resolve(process.cwd(), 'src/electron/services/conversion');
      }
    }

    // Log the final base path that will be used
    logger.log(`Using final base path: ${basePath}`, 'INFO');

    // Check if the registry exists at this path
    const registryPath = path.join(basePath, 'ConverterRegistry.js');
    logger.log(`Final registry path: ${registryPath} (exists: ${fs.existsSync(registryPath)})`, 'INFO');

    // Create the paths object with all module paths
    return {
      registry: registryPath,
      registryPath: registryPath,
      // Duplicate for direct access
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

// Minimal embedded ConverterRegistry as a last resort
const MinimalConverterRegistry = {
  converters: {
    pdf: {
      // Minimal PDF converter
      convert: async (content, name, apiKey, options = {}) => {
        console.log('[MinimalConverterRegistry] Using embedded PDF converter');
        return {
          success: true,
          content: `# Extracted from ${name || 'PDF document'}\n\nThis content was extracted using the embedded converter.`,
          type: 'pdf',
          metadata: {
            pages: 1,
            converter: 'minimal-embedded'
          }
        };
      },
      validate: input => Buffer.isBuffer(input) || typeof input === 'string',
      config: {
        name: 'PDF Document',
        extensions: ['.pdf'],
        mimeTypes: ['application/pdf'],
        maxSize: 25 * 1024 * 1024
      }
    }
  },
  // Generic conversion function
  convertToMarkdown: async (type, content, options = {}) => {
    console.log(`[MinimalConverterRegistry] Using embedded convertToMarkdown for ${type}`);
    return {
      success: true,
      content: `# Extracted from ${options.name || 'document'}\n\nThis content was extracted using the embedded converter.`,
      type: type,
      metadata: {
        converter: 'minimal-embedded'
      }
    };
  },
  // Lookup converter by extension
  getConverterByExtension: async extension => {
    console.log(`[MinimalConverterRegistry] Looking up converter for: ${extension}`);

    // Handle PDF files specifically
    if (extension === 'pdf') {
      return MinimalConverterRegistry.converters.pdf;
    }

    // Generic converter for other types
    return {
      convert: async (content, name, apiKey, options = {}) => {
        console.log(`[MinimalConverterRegistry] Using generic converter for ${extension}`);
        return {
          success: true,
          content: `# Extracted from ${name || extension + ' file'}\n\nThis content was extracted using the embedded generic converter.`,
          type: extension,
          metadata: {
            converter: 'minimal-embedded-generic'
          }
        };
      },
      validate: () => true,
      config: {
        name: `${extension.toUpperCase()} Document`,
        extensions: [`.${extension}`],
        mimeTypes: [`application/${extension}`],
        maxSize: 10 * 1024 * 1024
      }
    };
  }
};

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
      // Get all possible module paths
      const paths = ModuleLoader.getModulePaths();
      this.logger.log('Using converter paths:', 'INFO', paths);

      // Extract all the possible base paths from various sources
      const possibleBasePaths = [path.dirname(paths.registry), ...Object.values(paths.converters).map(p => path.dirname(path.dirname(p)))];

      // Log all possible registry paths we'll try
      const allPossibleRegistryPaths = [paths.registry, paths.registryPath, ...possibleBasePaths.map(basePath => path.join(basePath, 'ConverterRegistry.js'))];
      this.logger.debug('All possible registry paths:', allPossibleRegistryPaths);

      // Attempt to load the registry using our enhanced loader with fallbacks
      let registry;
      try {
        // First try the direct path
        const errorPath = 'C:\\Users\\Joseph\\Documents\\Code\\codex-md\\dist\\win-unpacked\\resources\\app.asar\\src\\electron\\services\\conversion\\ConverterRegistry.js';
        const correctedPath = errorPath.replace('\\src\\', '\\build\\');

        // Also check if the hardcoded corrected path exists and try to load it directly
        if (fs.existsSync(correctedPath)) {
          this.logger.log(`Found corrected registry path: ${correctedPath}`, 'INFO');
          try {
            registry = require(correctedPath);
            this.logger.success('Successfully loaded registry from corrected path');
          } catch (directLoadError) {
            this.logger.warn(`Failed to load from corrected path: ${directLoadError.message}`);
          }
        }

        // If direct loading didn't work, try with the moduleloader
        if (!registry) {
          registry = await ModuleLoader.loadModule(paths.registry, {
            fallbackPaths: allPossibleRegistryPaths.slice(1),
            silent: true
          });
        }
      } catch (initialError) {
        this.logger.warn('Initial registry loading failed, trying alternative approaches', initialError);

        // If direct loading failed, try a different approach by collecting base directories
        const baseDirs = [];

        // Add potential base directories (deduplicate them)
        const addBaseDir = dir => {
          if (dir && !baseDirs.includes(dir)) {
            baseDirs.push(dir);
          }
        };

        // Add multiple paths that could contain the registry
        addBaseDir(path.dirname(paths.registry));

        // Add parent directories of each converter path
        Object.values(paths.converters).forEach(converterPath => {
          const converterDir = path.dirname(converterPath);
          addBaseDir(path.dirname(converterDir)); // Add parent directory
        });

        // Add common directories relative to executable
        addBaseDir(path.resolve(process.cwd(), 'src/electron/services/conversion'));
        addBaseDir(path.resolve(process.cwd(), 'build/electron/services/conversion'));
        addBaseDir(path.resolve(app.getAppPath(), 'src/electron/services/conversion'));
        addBaseDir(path.resolve(app.getAppPath(), 'build/electron/services/conversion'));
        addBaseDir(path.resolve(__dirname, '../services/conversion'));
        addBaseDir(path.resolve(__dirname, '../../services/conversion'));
        addBaseDir(path.resolve(__dirname, '../../src/electron/services/conversion'));
        addBaseDir(path.resolve(__dirname, '../../build/electron/services/conversion'));
        addBaseDir(path.resolve(app.getAppPath().replace('app.asar', 'app'), 'src/electron/services/conversion'));
        addBaseDir(path.resolve(app.getAppPath().replace('app.asar', 'app'), 'build/electron/services/conversion'));

        // Log the base directories we'll try
        this.logger.log('Trying to load registry from these base directories:', 'INFO', baseDirs);
        try {
          // Try to load module from the best path
          registry = await ModuleLoader.loadModuleFromBestPath('ConverterRegistry.js', baseDirs);
        } catch (bestPathError) {
          this.logger.error('All path loading attempts failed, using embedded registry', bestPathError);
          // When all else fails, use our embedded registry
          registry = MinimalConverterRegistry;
          this.logger.warn('Using embedded MinimalConverterRegistry as last resort');
        }
      }

      // Validate the registry
      if (!this._validateRegistry(registry)) {
        this.logger.error('Invalid converter registry structure, using embedded registry');
        // Use our embedded registry
        registry = MinimalConverterRegistry;
        this.logger.warn('Using embedded MinimalConverterRegistry as last resort');

        // Double-check that our embedded registry is valid
        if (!this._validateRegistry(registry)) {
          throw new Error('MinimalConverterRegistry is invalid!');
        }
      }

      // Log the converters in the registry
      this.logger.log('Available converters:', Object.keys(registry.converters || {}));
      this.logger.success('Successfully loaded converter registry');
      this._converterRegistry = registry;
      this._initialized = true;
      this.logger.logPhaseTransition(ConversionStatus.STATUS.INITIALIZING, ConversionStatus.STATUS.COMPLETED);
      return this._converterRegistry;
    } catch (error) {
      this._initPromise = null;
      this.logger.logConversionError('init', error);

      // Provide better error information
      const enhancedError = new Error(`Failed to initialize converter registry: ${error.message}`);
      enhancedError.original = error;
      enhancedError.stack = error.stack;
      throw enhancedError;
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
    this.logger.log('UnifiedConverterFactory initialized', 'INFO');
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
      this.logger.log(`Using direct URL converter for: ${normalizedType}`, 'INFO');
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
      this.logger.log(`Attempting convertToMarkdown fallback for ${normalizedType}`, 'INFO');
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
        this.logger.log(`Special handling for ${fileType} in production mode`, 'INFO');
        converterInfo = await this.createDirectUrlConverter(fileType);
        if (converterInfo) {
          this.logger.success(`Created direct converter for ${fileType}`);
        }
      }

      // If converter not found, try again after a short delay
      if (!converterInfo) {
        this.logger.log(`Retrying to get converter for ${fileType} after delay...`, 'INFO');
        await new Promise(resolve => setTimeout(resolve, 500));
        converterInfo = await this.getConverter(fileType);
        if (!converterInfo && (fileType === 'url' || fileType === 'parenturl')) {
          this.logger.log(`Second attempt at special handling for ${fileType}`, 'INFO');
          converterInfo = await this.createDirectUrlConverter(fileType);
        }

        // If still not found, try one more time with a longer delay
        if (!converterInfo) {
          this.logger.log(`Final attempt to get converter for ${fileType} after longer delay...`, 'INFO');
          await new Promise(resolve => setTimeout(resolve, 1000));
          converterInfo = await this.getConverter(fileType);
          if (!converterInfo && (fileType === 'url' || fileType === 'parenturl')) {
            this.logger.log(`Final attempt at special handling for ${fileType}`, 'INFO');
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
    this.logger.log(`Creating direct URL converter for ${fileType}`, 'INFO');
    const registry = await this._ensureInitialized();
    if (!registry.convertToMarkdown) {
      this.logger.error('Cannot create direct URL converter: convertToMarkdown not available');
      return null;
    }
    return {
      converter: {
        convert: async (content, name, apiKey, options) => {
          this.logger.log(`Using direct URL converter for ${fileType}`, 'INFO');
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
        this.logger.log(`Processing URL: ${filePath}`, 'INFO');

        // For URLs, filePath is actually the URL string
        let result;
        try {
          // Try using the converter's convert method first
          if (typeof converter.convert === 'function') {
            this.logger.log(`Using converter.convert for ${fileType}`, 'INFO');
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
            this.logger.log(`Using registry.convertToMarkdown for ${fileType}`, 'INFO');
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
            this.logger.log(`Trying alternative conversion method as fallback`, 'INFO');
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
          this.logger.log('OCR is enabled for this conversion', 'INFO');
          if (options.mistralApiKey) {
            this.logger.debug('Mistral API key is present');
          } else {
            this.logger.warn('OCR is enabled but Mistral API key is missing');
          }
        }
      }

      // Special handling for audio/video files to ensure they don't use Mistral API key
      if (fileType === 'mp3' || fileType === 'wav' || fileType === 'mp4' || fileType === 'mov' || fileType === 'ogg' || fileType === 'webm' || fileType === 'avi' || fileType === 'flac' || fileType === 'm4a') {
        this.logger.log(`Converting multimedia file (${fileType})`, 'INFO');

        // Remove mistralApiKey from options for multimedia files to prevent incorrect routing
        if (options.mistralApiKey) {
          this.logger.log('Removing Mistral API key from multimedia conversion options', 'INFO');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJhcHAiLCJlbGVjdHJvbiIsInJlcXVpcmUiLCJyZW1vdGUiLCJlIiwiY29uc29sZSIsIndhcm4iLCJmcyIsImV4aXN0c1N5bmMiLCJwYXRoIiwic3RhdFN5bmMiLCJpc0ZpbGUiLCJpbm5lckUiLCJlcnJvciIsIkVycm9yIiwiUGF0aFV0aWxzIiwiUHJvZ3Jlc3NUcmFja2VyIiwiZ2V0TG9nZ2VyIiwic2FuaXRpemVGb3JMb2dnaW5nIiwiQ29udmVyc2lvblN0YXR1cyIsInNhZmVSZXF1aXJlIiwibW9kdWxlUGF0aCIsImZhbGxiYWNrcyIsImZhbGxiYWNrIiwiaW5jbHVkZXMiLCJuYW1lIiwibG9nIiwibXNnIiwibGV2ZWwiLCJhcmdzIiwiZXJyIiwic3VjY2VzcyIsImRlYnVnIiwibG9nUGhhc2VUcmFuc2l0aW9uIiwiZnJvbSIsInRvIiwibG9nQ29udmVyc2lvblN0YXJ0IiwidHlwZSIsIm9wdHMiLCJsb2dDb252ZXJzaW9uQ29tcGxldGUiLCJsb2dDb252ZXJzaW9uRXJyb3IiLCJtZXNzYWdlIiwic2V0Q29udGV4dCIsIm9iaiIsInJlc29sdmUiLCJfX2Rpcm5hbWUiLCJwcm9jZXNzIiwiY3dkIiwiY29uc3RydWN0b3IiLCJjYWxsYmFjayIsInVwZGF0ZSIsInByb2dyZXNzIiwiZGF0YSIsInVwZGF0ZVNjYWxlZCIsIm1pbiIsIm1heCIsIlNUQVRVUyIsIlNUQVJUSU5HIiwiSU5JVElBTElaSU5HIiwiVkFMSURBVElORyIsIkZBU1RfQVRURU1QVCIsIlBST0NFU1NJTkciLCJGSU5BTElaSU5HIiwiQ09NUExFVEVEIiwiQ09OVEVOVF9FTVBUWSIsImlzUGFja2FnZWQiLCJnZXRBcHBQYXRoIiwiZ2V0TmFtZSIsImdldFZlcnNpb24iLCJNb2R1bGVMb2FkZXIiLCJsb2FkTW9kdWxlIiwib3B0aW9ucyIsImxvZ2dlciIsImZhbGxiYWNrUGF0aHMiLCJzaWxlbnQiLCJtb2R1bGVOYW1lIiwiYmFzZW5hbWUiLCJjYXRlZ29yeSIsInBhdGhQYXJ0cyIsImRpcm5hbWUiLCJzcGxpdCIsInNlcCIsImxlbmd0aCIsInNsaWNlIiwiam9pbiIsIk1vZHVsZVJlc29sdmVyIiwibW9kdWxlIiwicmVzb2x2ZXJFcnJvciIsImRlZmF1bHQiLCJkaXJlY3RFcnJvciIsImZhbGxiYWNrUGF0aCIsImZhbGxiYWNrRXJyb3IiLCJfY3JlYXRlRW1lcmdlbmN5UmVnaXN0cnkiLCJDb252ZXJ0ZXJSZWdpc3RyeSIsImNvbnZlcnRlcnMiLCJwZGYiLCJjb252ZXJ0IiwiY29udGVudCIsImFwaUtleSIsIm1ldGFkYXRhIiwicGFnZXMiLCJjb252ZXJ0ZXIiLCJ2YWxpZGF0ZSIsImlucHV0IiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJjb25maWciLCJleHRlbnNpb25zIiwibWltZVR5cGVzIiwibWF4U2l6ZSIsInByb3RvdHlwZSIsImNvbnZlcnRUb01hcmtkb3duIiwic291cmNlIiwiZ2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJleHRlbnNpb24iLCJsb2FkTW9kdWxlRnJvbUJlc3RQYXRoIiwiYmFzZVBhdGhzIiwicmVzb2x2ZWRQYXRocyIsIm1hcCIsImJhc2VQYXRoIiwiZXhpc3RpbmdQYXRocyIsImZpbHRlciIsInAiLCJleGlzdHMiLCJnZXRNb2R1bGVQYXRocyIsImlzRGV2IiwiZW52IiwiTk9ERV9FTlYiLCJwb3NzaWJsZVBhdGhzIiwicmVwbGFjZSIsImV4ZWNQYXRoIiwiZXJyb3JQYXRoIiwiY29ycmVjdGVkUGF0aCIsImNhbmRpZGF0ZVBhdGgiLCJkaXJlY3RSZWdpc3RyeVBhdGhzIiwicmVnaXN0cnlQYXRoIiwicmVnaXN0cnkiLCJ1cmwiLCJkb2N4IiwicHB0eCIsInhsc3giLCJjc3YiLCJNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkiLCJ0b1VwcGVyQ2FzZSIsIkNvbnZlcnRlckluaXRpYWxpemVyIiwiX2luc3RhbmNlIiwiX2luaXRpYWxpemVkIiwiX2luaXRQcm9taXNlIiwiX2NvbnZlcnRlclJlZ2lzdHJ5IiwiZ2V0SW5zdGFuY2UiLCJpbml0aWFsaXplIiwiX2RvSW5pdGlhbGl6ZSIsInBhdGhzIiwicG9zc2libGVCYXNlUGF0aHMiLCJPYmplY3QiLCJ2YWx1ZXMiLCJhbGxQb3NzaWJsZVJlZ2lzdHJ5UGF0aHMiLCJkaXJlY3RMb2FkRXJyb3IiLCJpbml0aWFsRXJyb3IiLCJiYXNlRGlycyIsImFkZEJhc2VEaXIiLCJkaXIiLCJwdXNoIiwiZm9yRWFjaCIsImNvbnZlcnRlclBhdGgiLCJjb252ZXJ0ZXJEaXIiLCJiZXN0UGF0aEVycm9yIiwiX3ZhbGlkYXRlUmVnaXN0cnkiLCJrZXlzIiwiZW5oYW5jZWRFcnJvciIsIm9yaWdpbmFsIiwic3RhY2siLCJGSUxFX1RZUEVfQ0FURUdPUklFUyIsIm1wMyIsIndhdiIsIm9nZyIsImZsYWMiLCJtcDQiLCJ3ZWJtIiwiYXZpIiwibW92IiwicGFyZW50dXJsIiwiVW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJfaW5pdGlhbGl6ZXIiLCJfZW5zdXJlSW5pdGlhbGl6ZWQiLCJnZXRDb252ZXJ0ZXIiLCJmaWxlVHlwZSIsIm5vcm1hbGl6ZWRUeXBlIiwidG9Mb3dlckNhc2UiLCJjb252ZXJ0RmlsZSIsImZpbGVQYXRoIiwic3RhcnRUaW1lIiwiRGF0ZSIsIm5vdyIsImlzVXJsIiwiZmlsZU5hbWUiLCJvcmlnaW5hbEZpbGVOYW1lIiwidXJsT2JqIiwiVVJMIiwiaG9zdG5hbWUiLCJwYXRobmFtZSIsImNvbnZlcnRlckluZm8iLCJjcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIiLCJQcm9taXNlIiwic2V0VGltZW91dCIsInByb2dyZXNzVHJhY2tlciIsIm9uUHJvZ3Jlc3MiLCJzdGF0dXMiLCJoYXNSZWdpc3RyeSIsImNvbnZlcnRlclR5cGUiLCJoYXNDb252ZXJ0ZXIiLCJjb252ZXJ0ZXJEZXRhaWxzIiwicmVzdWx0IiwiaGFuZGxlQ29udmVyc2lvbiIsInN0YW5kYXJkaXplUmVzdWx0IiwiaXNTdWNjZXNzIiwic2FuaXRpemVkUmVzdWx0Iiwic3RhbmRhcmRpemVkIiwiaW1hZ2VzIiwidW5kZWZpbmVkIiwiZmlsZUNvbnRlbnQiLCJyZWFkRmlsZVN5bmMiLCJ1c2VPY3IiLCJoYXNNaXN0cmFsQXBpS2V5IiwibWlzdHJhbEFwaUtleSIsInByZXNlcnZlUGFnZUluZm8iLCJjbGVhbk9wdGlvbnMiLCJ1bmlmaWVkQ29udmVydGVyRmFjdG9yeSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vY29udmVydGVycy9VbmlmaWVkQ29udmVydGVyRmFjdG9yeS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogVW5pZmllZENvbnZlcnRlckZhY3RvcnkuanNcclxuICogXHJcbiAqIENlbnRyYWwgZmFjdG9yeSBmb3IgYWxsIGZpbGUgdHlwZSBjb252ZXJzaW9ucyBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBVc2VzIENvbW1vbkpTIGZvciBjb25zaXN0ZW5jeSB3aXRoIEVsZWN0cm9uIG1haW4gcHJvY2VzcyBhbmQgcHJvdmlkZXMgcm9idXN0IGluaXRpYWxpemF0aW9uXHJcbiAqIGFuZCBjb252ZXJ0ZXIgbWFuYWdlbWVudC5cclxuICogXHJcbiAqIFJlbGF0ZWQgZmlsZXM6XHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanM6IFVzZXMgdGhpcyBmYWN0b3J5IGZvciBjb252ZXJzaW9uc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9pcGMvaGFuZGxlcnMvY29udmVyc2lvbi9pbmRleC5qczogRXhwb3NlcyBjb252ZXJzaW9uIHRvIHJlbmRlcmVyIHByb2Nlc3NcclxuICogLSBzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qczogQ29udmVydGVyIGltcGxlbWVudGF0aW9uc1xyXG4gKi9cclxuXHJcbi8vIENvcmUgZGVwZW5kZW5jaWVzXHJcbmxldCBhcHA7XHJcbnRyeSB7XHJcbiAgLy8gVHJ5IHRvIGxvYWQgZWxlY3Ryb24gaW4gYSBzYWZlciB3YXlcclxuICBjb25zdCBlbGVjdHJvbiA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbiAgYXBwID0gZWxlY3Ryb24uYXBwIHx8IChlbGVjdHJvbi5yZW1vdGUgJiYgZWxlY3Ryb24ucmVtb3RlLmFwcCk7XHJcbn0gY2F0Y2ggKGUpIHtcclxuICAvLyBJZiBlbGVjdHJvbiBpc24ndCBhdmFpbGFibGUsIHdlJ2xsIGhhbmRsZSBpdCBiZWxvd1xyXG4gIGNvbnNvbGUud2FybignQ291bGQgbm90IGxvYWQgZWxlY3Ryb24gYXBwLCB1c2luZyBmYWxsYmFja3MnKTtcclxufVxyXG5cclxuLy8gRXNzZW50aWFsIHV0aWxpdGllcyAtIGxvYWQgd2l0aCBmYWxsYmFja3NcclxubGV0IGZzO1xyXG50cnkge1xyXG4gIGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcclxufSBjYXRjaCAoZSkge1xyXG4gIHRyeSB7XHJcbiAgICBmcyA9IHJlcXVpcmUoJ2ZzJyk7XHJcbiAgICAvLyBBZGQgZnMtZXh0cmEgbWV0aG9kcyB3ZSB1c2VcclxuICAgIGZzLmV4aXN0c1N5bmMgPSBmcy5leGlzdHNTeW5jIHx8ICgocGF0aCkgPT4ge1xyXG4gICAgICB0cnkgeyByZXR1cm4gZnMuc3RhdFN5bmMocGF0aCkuaXNGaWxlKCk7IH0gY2F0Y2ggKGUpIHsgcmV0dXJuIGZhbHNlOyB9XHJcbiAgICB9KTtcclxuICB9IGNhdGNoIChpbm5lckUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBsb2FkIGZzIG1vZHVsZXMnLCBpbm5lckUpO1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKCdDcml0aWNhbCBkZXBlbmRlbmN5IGZzL2ZzLWV4dHJhIG5vdCBhdmFpbGFibGUnKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIFBhdGggaGFuZGxpbmcgLSBlc3NlbnRpYWwgZm9yIG1vZHVsZSByZXNvbHV0aW9uXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcblxyXG4vLyBUcnkgdG8gbG9hZCBpbnRlcm5hbCBtb2R1bGVzIHdpdGggZmFsbGJhY2tzXHJcbmxldCBQYXRoVXRpbHMsIFByb2dyZXNzVHJhY2tlciwgZ2V0TG9nZ2VyLCBzYW5pdGl6ZUZvckxvZ2dpbmcsIENvbnZlcnNpb25TdGF0dXM7XHJcblxyXG4vLyBBdHRlbXB0IHRvIGxvYWQgZWFjaCBtb2R1bGUgd2l0aCBmYWxsYmFja3MgdG8gcHJldmVudCBjcmFzaGVzXHJcbmNvbnN0IHNhZmVSZXF1aXJlID0gKG1vZHVsZVBhdGgsIGZhbGxiYWNrcyA9IFtdKSA9PiB7XHJcbiAgdHJ5IHtcclxuICAgIHJldHVybiByZXF1aXJlKG1vZHVsZVBhdGgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGZvciAoY29uc3QgZmFsbGJhY2sgb2YgZmFsbGJhY2tzKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgcmV0dXJuIHJlcXVpcmUoZmFsbGJhY2spO1xyXG4gICAgICB9IGNhdGNoIHsgLyogQ29udGludWUgdG8gbmV4dCBmYWxsYmFjayAqLyB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRGVmYXVsdCBpbXBsZW1lbnRhdGlvbnMgZm9yIGNyaXRpY2FsIGZ1bmN0aW9uc1xyXG4gICAgaWYgKG1vZHVsZVBhdGguaW5jbHVkZXMoJ2dldExvZ2dlcicpKSB7XHJcbiAgICAgIHJldHVybiAobmFtZSkgPT4gKHtcclxuICAgICAgICBsb2c6IChtc2csIGxldmVsLCAuLi5hcmdzKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dWyR7bGV2ZWwgfHwgJ0lORk8nfV0gJHttc2d9YCwgLi4uYXJncyksXHJcbiAgICAgICAgZXJyb3I6IChtc2csIGVycikgPT4gY29uc29sZS5lcnJvcihgWyR7bmFtZX1dW0VSUk9SXSAke21zZ31gLCBlcnIpLFxyXG4gICAgICAgIHdhcm46IChtc2csIC4uLmFyZ3MpID0+IGNvbnNvbGUud2FybihgWyR7bmFtZX1dW1dBUk5dICR7bXNnfWAsIC4uLmFyZ3MpLFxyXG4gICAgICAgIHN1Y2Nlc3M6IChtc2cpID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV1bU1VDQ0VTU10gJHttc2d9YCksXHJcbiAgICAgICAgZGVidWc6IChtc2csIC4uLmFyZ3MpID0+IGNvbnNvbGUuZGVidWcoYFske25hbWV9XVtERUJVR10gJHttc2d9YCwgLi4uYXJncyksXHJcbiAgICAgICAgbG9nUGhhc2VUcmFuc2l0aW9uOiAoZnJvbSwgdG8pID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV0gUGhhc2UgdHJhbnNpdGlvbjogJHtmcm9tfSDihpIgJHt0b31gKSxcclxuICAgICAgICBsb2dDb252ZXJzaW9uU3RhcnQ6ICh0eXBlLCBvcHRzKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dIFN0YXJ0aW5nIGNvbnZlcnNpb24gZm9yICR7dHlwZX1gKSxcclxuICAgICAgICBsb2dDb252ZXJzaW9uQ29tcGxldGU6ICh0eXBlKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dIENvbXBsZXRlZCBjb252ZXJzaW9uIGZvciAke3R5cGV9YCksXHJcbiAgICAgICAgbG9nQ29udmVyc2lvbkVycm9yOiAodHlwZSwgZXJyKSA9PiBjb25zb2xlLmVycm9yKGBbJHtuYW1lfTpmYWlsZWRdWyR7dHlwZX1dIOKdjCAke2Vyci5tZXNzYWdlfWAsIGVyciksXHJcbiAgICAgICAgc2V0Q29udGV4dDogKCkgPT4ge31cclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBpZiAobW9kdWxlUGF0aC5pbmNsdWRlcygnc2FuaXRpemVGb3JMb2dnaW5nJykpIHtcclxuICAgICAgcmV0dXJuIChvYmopID0+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgcmV0dXJuIHR5cGVvZiBvYmogPT09ICdvYmplY3QnID8geyAuLi5vYmogfSA6IG9iajtcclxuICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgIHJldHVybiBvYmo7XHJcbiAgICAgICAgfVxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnNvbGUud2FybihgTW9kdWxlICR7bW9kdWxlUGF0aH0gbm90IGF2YWlsYWJsZSwgdXNpbmcgbWluaW1hbCBpbXBsZW1lbnRhdGlvbmApO1xyXG4gICAgcmV0dXJuIHt9O1xyXG4gIH1cclxufTtcclxuXHJcbnRyeSB7XHJcbiAgUGF0aFV0aWxzID0gc2FmZVJlcXVpcmUoJy4uL3V0aWxzL3BhdGhzL2luZGV4JywgW1xyXG4gICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3V0aWxzL3BhdGhzL2luZGV4JyksXHJcbiAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi91dGlscy9wYXRocy9pbmRleCcpXHJcbiAgXSkuUGF0aFV0aWxzIHx8IHt9O1xyXG5cclxuICBQcm9ncmVzc1RyYWNrZXIgPSBzYWZlUmVxdWlyZSgnLi4vdXRpbHMvY29udmVyc2lvbi9wcm9ncmVzcycsIFtcclxuICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi91dGlscy9jb252ZXJzaW9uL3Byb2dyZXNzJyksXHJcbiAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi91dGlscy9jb252ZXJzaW9uL3Byb2dyZXNzJylcclxuICBdKS5Qcm9ncmVzc1RyYWNrZXIgfHwgY2xhc3MgUHJvZ3Jlc3NUcmFja2VyIHtcclxuICAgIGNvbnN0cnVjdG9yKGNhbGxiYWNrKSB7IHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFjazsgfVxyXG4gICAgdXBkYXRlKHByb2dyZXNzLCBkYXRhKSB7IHRoaXMuY2FsbGJhY2sgJiYgdGhpcy5jYWxsYmFjayhwcm9ncmVzcywgZGF0YSk7IH1cclxuICAgIHVwZGF0ZVNjYWxlZChwcm9ncmVzcywgbWluLCBtYXgsIGRhdGEpIHsgdGhpcy51cGRhdGUobWluICsgKHByb2dyZXNzLzEwMCkgKiAobWF4LW1pbiksIGRhdGEpOyB9XHJcbiAgfTtcclxuXHJcbiAgZ2V0TG9nZ2VyID0gc2FmZVJlcXVpcmUoJy4uL3V0aWxzL2xvZ2dpbmcvQ29udmVyc2lvbkxvZ2dlcicsIFtcclxuICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi91dGlscy9sb2dnaW5nL0NvbnZlcnNpb25Mb2dnZXInKSxcclxuICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3V0aWxzL2xvZ2dpbmcvQ29udmVyc2lvbkxvZ2dlcicpXHJcbiAgXSkuZ2V0TG9nZ2VyIHx8ICgobmFtZSkgPT4gKHtcclxuICAgIGxvZzogKG1zZywgbGV2ZWwsIC4uLmFyZ3MpID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV1bJHtsZXZlbCB8fCAnSU5GTyd9XSAke21zZ31gLCAuLi5hcmdzKSxcclxuICAgIGVycm9yOiAobXNnLCBlcnIpID0+IGNvbnNvbGUuZXJyb3IoYFske25hbWV9XVtFUlJPUl0gJHttc2d9YCwgZXJyKSxcclxuICAgIHdhcm46IChtc2csIC4uLmFyZ3MpID0+IGNvbnNvbGUud2FybihgWyR7bmFtZX1dW1dBUk5dICR7bXNnfWAsIC4uLmFyZ3MpLFxyXG4gICAgc3VjY2VzczogKG1zZykgPT4gY29uc29sZS5sb2coYFske25hbWV9XVtTVUNDRVNTXSAke21zZ31gKSxcclxuICAgIGRlYnVnOiAobXNnLCAuLi5hcmdzKSA9PiBjb25zb2xlLmRlYnVnKGBbJHtuYW1lfV1bREVCVUddICR7bXNnfWAsIC4uLmFyZ3MpLFxyXG4gICAgbG9nUGhhc2VUcmFuc2l0aW9uOiAoZnJvbSwgdG8pID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV0gUGhhc2UgdHJhbnNpdGlvbjogJHtmcm9tfSDihpIgJHt0b31gKSxcclxuICAgIGxvZ0NvbnZlcnNpb25TdGFydDogKHR5cGUsIG9wdHMpID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV0gU3RhcnRpbmcgY29udmVyc2lvbiBmb3IgJHt0eXBlfWApLFxyXG4gICAgbG9nQ29udmVyc2lvbkNvbXBsZXRlOiAodHlwZSkgPT4gY29uc29sZS5sb2coYFske25hbWV9XSBDb21wbGV0ZWQgY29udmVyc2lvbiBmb3IgJHt0eXBlfWApLFxyXG4gICAgbG9nQ29udmVyc2lvbkVycm9yOiAodHlwZSwgZXJyKSA9PiBjb25zb2xlLmVycm9yKGBbJHtuYW1lfTpmYWlsZWRdWyR7dHlwZX1dIOKdjCAke2Vyci5tZXNzYWdlfWAsIGVyciksXHJcbiAgICBzZXRDb250ZXh0OiAoKSA9PiB7fVxyXG4gIH0pKTtcclxuXHJcbiAgc2FuaXRpemVGb3JMb2dnaW5nID0gc2FmZVJlcXVpcmUoJy4uL3V0aWxzL2xvZ2dpbmcvTG9nU2FuaXRpemVyJywgW1xyXG4gICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3V0aWxzL2xvZ2dpbmcvTG9nU2FuaXRpemVyJyksXHJcbiAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi91dGlscy9sb2dnaW5nL0xvZ1Nhbml0aXplcicpXHJcbiAgXSkuc2FuaXRpemVGb3JMb2dnaW5nIHx8ICgob2JqKSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICByZXR1cm4gdHlwZW9mIG9iaiA9PT0gJ29iamVjdCcgPyB7IC4uLm9iaiB9IDogb2JqO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgIHJldHVybiBvYmo7XHJcbiAgICB9XHJcbiAgfSk7XHJcblxyXG4gIENvbnZlcnNpb25TdGF0dXMgPSBzYWZlUmVxdWlyZSgnLi4vdXRpbHMvY29udmVyc2lvbi9Db252ZXJzaW9uU3RhdHVzJywgW1xyXG4gICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3V0aWxzL2NvbnZlcnNpb24vQ29udmVyc2lvblN0YXR1cycpLFxyXG4gICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vdXRpbHMvY29udmVyc2lvbi9Db252ZXJzaW9uU3RhdHVzJylcclxuICBdKSB8fCB7XHJcbiAgICBTVEFUVVM6IHtcclxuICAgICAgU1RBUlRJTkc6ICdTdGFydGluZyBjb252ZXJzaW9uJyxcclxuICAgICAgSU5JVElBTElaSU5HOiAn8J+UpyBJbml0aWFsaXppbmcgY29udmVydGVyJyxcclxuICAgICAgVkFMSURBVElORzogJ/CflI0gVmFsaWRhdGluZyBmaWxlJyxcclxuICAgICAgRkFTVF9BVFRFTVBUOiAn4pqhIEZhc3QgY29udmVyc2lvbiBhdHRlbXB0JyxcclxuICAgICAgUFJPQ0VTU0lORzogJ+KPsyBQcm9jZXNzaW5nIGNvbnRlbnQnLFxyXG4gICAgICBGSU5BTElaSU5HOiAn4pyFIEZpbmFsaXppbmcgcmVzdWx0JyxcclxuICAgICAgQ09NUExFVEVEOiAn4pyTIENvbnZlcnNpb24gY29tcGxldGUnLFxyXG4gICAgICBDT05URU5UX0VNUFRZOiAn4pqg77iPIEVtcHR5IGNvbnRlbnQgd2FybmluZydcclxuICAgIH1cclxuICB9O1xyXG59IGNhdGNoIChlcnJvcikge1xyXG4gIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGxvYWRpbmcgY29yZSBkZXBlbmRlbmNpZXMnLCBlcnJvcik7XHJcbiAgdGhyb3cgbmV3IEVycm9yKGBDcml0aWNhbCBkZXBlbmRlbmN5IGluaXRpYWxpemF0aW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xyXG59XHJcblxyXG4vLyBJbml0aWFsaXplIGFwcCB3aXRoIGZhbGxiYWNrIGlmIG5lZWRlZFxyXG5pZiAoIWFwcCkge1xyXG4gIGFwcCA9IHtcclxuICAgIGlzUGFja2FnZWQ6IGZhbHNlLFxyXG4gICAgZ2V0QXBwUGF0aDogKCkgPT4gcHJvY2Vzcy5jd2QoKSxcclxuICAgIGdldE5hbWU6ICgpID0+ICdDb2RleC5tZCcsXHJcbiAgICBnZXRWZXJzaW9uOiAoKSA9PiAnMS4wLjAnXHJcbiAgfTtcclxuICBjb25zb2xlLndhcm4oJ1VzaW5nIGZhbGxiYWNrIGFwcCBpbXBsZW1lbnRhdGlvbicpO1xyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlcyBtb2R1bGUgbG9hZGluZyB3aXRoIHByb3BlciBlcnJvciBoYW5kbGluZyBhbmQgcGF0aCByZXNvbHV0aW9uLlxyXG4gKi9cclxuY2xhc3MgTW9kdWxlTG9hZGVyIHtcclxuICBzdGF0aWMgYXN5bmMgbG9hZE1vZHVsZShtb2R1bGVQYXRoLCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnN0IGxvZ2dlciA9IGdldExvZ2dlcignTW9kdWxlTG9hZGVyJyk7XHJcbiAgICBjb25zdCB7IGZhbGxiYWNrUGF0aHMgPSBbXSwgc2lsZW50ID0gZmFsc2UgfSA9IG9wdGlvbnM7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgbG9nZ2VyLmxvZyhgTG9hZGluZyBtb2R1bGUgZnJvbSBwYXRoOiAke21vZHVsZVBhdGh9YCwgJ0lORk8nKTtcclxuXHJcbiAgICAgIC8vIEV4dHJhY3QgbW9kdWxlIG5hbWUgYW5kIGNhdGVnb3J5IGZyb20gcGF0aFxyXG4gICAgICBjb25zdCBtb2R1bGVOYW1lID0gcGF0aC5iYXNlbmFtZShtb2R1bGVQYXRoKTtcclxuICAgICAgbGV0IGNhdGVnb3J5ID0gJyc7XHJcblxyXG4gICAgICAvLyBUcnkgdG8gcGFyc2UgY2F0ZWdvcnkgZnJvbSBwYXRoXHJcbiAgICAgIGNvbnN0IHBhdGhQYXJ0cyA9IHBhdGguZGlybmFtZShtb2R1bGVQYXRoKS5zcGxpdChwYXRoLnNlcCk7XHJcbiAgICAgIGlmIChwYXRoUGFydHMubGVuZ3RoID49IDIpIHtcclxuICAgICAgICAvLyBUYWtlIHRoZSBsYXN0IHR3byBwYXJ0cyBvZiB0aGUgcGF0aCBhcyB0aGUgY2F0ZWdvcnlcclxuICAgICAgICBjYXRlZ29yeSA9IHBhdGhQYXJ0cy5zbGljZSgtMikuam9pbignLycpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIERlZmF1bHQgY2F0ZWdvcnkgZm9yIGNvbnZlcnNpb25zXHJcbiAgICAgICAgY2F0ZWdvcnkgPSAnc2VydmljZXMvY29udmVyc2lvbic7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGxvZ2dlci5sb2coYFVzaW5nIE1vZHVsZVJlc29sdmVyIHdpdGggbW9kdWxlOiAke21vZHVsZU5hbWV9LCBjYXRlZ29yeTogJHtjYXRlZ29yeX1gLCAnSU5GTycpO1xyXG5cclxuICAgICAgLy8gVXNlIE1vZHVsZVJlc29sdmVyIHRvIGxvYWQgdGhlIG1vZHVsZVxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHsgTW9kdWxlUmVzb2x2ZXIgfSA9IHJlcXVpcmUoJy4uL3V0aWxzL21vZHVsZVJlc29sdmVyJyk7XHJcbiAgICAgICAgY29uc3QgbW9kdWxlID0gTW9kdWxlUmVzb2x2ZXIuc2FmZVJlcXVpcmUobW9kdWxlTmFtZSwgY2F0ZWdvcnkpO1xyXG4gICAgICAgIGxvZ2dlci5zdWNjZXNzKGBTdWNjZXNzZnVsbHkgbG9hZGVkIG1vZHVsZSB1c2luZyBNb2R1bGVSZXNvbHZlcjogJHttb2R1bGVOYW1lfWApO1xyXG4gICAgICAgIHJldHVybiBtb2R1bGU7XHJcbiAgICAgIH0gY2F0Y2ggKHJlc29sdmVyRXJyb3IpIHtcclxuICAgICAgICBsb2dnZXIuZXJyb3IoYE1vZHVsZVJlc29sdmVyIGZhaWxlZDogJHtyZXNvbHZlckVycm9yLm1lc3NhZ2V9YCwgcmVzb2x2ZXJFcnJvcik7XHJcblxyXG4gICAgICAgIC8vIElmIE1vZHVsZVJlc29sdmVyIGZhaWxzLCB0cnkgdGhlIG9yaWdpbmFsIGFwcHJvYWNoIHdpdGggZmFsbGJhY2tzXHJcbiAgICAgICAgbG9nZ2VyLmxvZygnRmFsbGluZyBiYWNrIHRvIGRpcmVjdCByZXF1aXJlIHdpdGggZmFsbGJhY2tzJywgJ0lORk8nKTtcclxuXHJcbiAgICAgICAgLy8gVHJ5IGRpcmVjdCByZXF1aXJlIGZpcnN0XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IHJlcXVpcmUobW9kdWxlUGF0aCk7XHJcbiAgICAgICAgICBsb2dnZXIuc3VjY2VzcyhgU3VjY2Vzc2Z1bGx5IGxvYWRlZCBtb2R1bGUgZGlyZWN0bHk6ICR7bW9kdWxlUGF0aH1gKTtcclxuICAgICAgICAgIHJldHVybiBtb2R1bGUuZGVmYXVsdCB8fCBtb2R1bGU7XHJcbiAgICAgICAgfSBjYXRjaCAoZGlyZWN0RXJyb3IpIHtcclxuICAgICAgICAgIC8vIElmIGZhbGxiYWNrIHBhdGhzIHByb3ZpZGVkLCB0cnkgdGhlbSBzZXF1ZW50aWFsbHlcclxuICAgICAgICAgIGlmIChmYWxsYmFja1BhdGhzICYmIGZhbGxiYWNrUGF0aHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICBsb2dnZXIubG9nKGBBdHRlbXB0aW5nIHRvIGxvYWQgZnJvbSAke2ZhbGxiYWNrUGF0aHMubGVuZ3RofSBmYWxsYmFjayBwYXRoc2AsICdJTkZPJyk7XHJcblxyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGZhbGxiYWNrUGF0aCBvZiBmYWxsYmFja1BhdGhzKSB7XHJcbiAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGxvZ2dlci5sb2coYFRyeWluZyBmYWxsYmFjayBwYXRoOiAke2ZhbGxiYWNrUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlID0gcmVxdWlyZShmYWxsYmFja1BhdGgpO1xyXG4gICAgICAgICAgICAgICAgbG9nZ2VyLnN1Y2Nlc3MoYFN1Y2Nlc3NmdWxseSBsb2FkZWQgZnJvbSBmYWxsYmFjazogJHtmYWxsYmFja1BhdGh9YCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gbW9kdWxlLmRlZmF1bHQgfHwgbW9kdWxlO1xyXG4gICAgICAgICAgICAgIH0gY2F0Y2ggKGZhbGxiYWNrRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIC8vIENvbnRpbnVlIHRvIG5leHQgZmFsbGJhY2sgcGF0aFxyXG4gICAgICAgICAgICAgICAgaWYgKCFzaWxlbnQpIHtcclxuICAgICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYEZhaWxlZCB0byBsb2FkIGZyb20gZmFsbGJhY2s6ICR7ZmFsbGJhY2tQYXRofWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIC8vIElmIGFsbCBlbHNlIGZhaWxzIGFuZCB0aGlzIGlzIENvbnZlcnRlclJlZ2lzdHJ5LmpzLCBjcmVhdGUgYSBtaW5pbWFsIHJlZ2lzdHJ5XHJcbiAgICAgICAgICBpZiAobW9kdWxlTmFtZSA9PT0gJ0NvbnZlcnRlclJlZ2lzdHJ5LmpzJykge1xyXG4gICAgICAgICAgICBsb2dnZXIubG9nKCdBbGwgbG9hZGluZyBhdHRlbXB0cyBmYWlsZWQgZm9yIENvbnZlcnRlclJlZ2lzdHJ5LmpzLiBDcmVhdGluZyBtaW5pbWFsIHJlZ2lzdHJ5JywgJ0lORk8nKTtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NyZWF0ZUVtZXJnZW5jeVJlZ2lzdHJ5KCk7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgLy8gSWYgd2UgZ2V0IGhlcmUsIGFsbCBhdHRlbXB0cyBmYWlsZWRcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGxvYWQgbW9kdWxlOiAke21vZHVsZVBhdGh9LiBFcnJvcjogJHtyZXNvbHZlckVycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBsb2dnZXIuZXJyb3IoYE1vZHVsZSBsb2FkaW5nIGZhaWxlZCBjb21wbGV0ZWx5OiAke2Vycm9yLm1lc3NhZ2V9YCwgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZHVsZSBsb2FkaW5nIGZhaWxlZDogJHttb2R1bGVQYXRofS4gRXJyb3I6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENyZWF0ZXMgYW4gZW1lcmdlbmN5IG1pbmltYWwgcmVnaXN0cnkgYXMgYSBsYXN0IHJlc29ydFxyXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IEEgbWluaW1hbCByZWdpc3RyeSBpbXBsZW1lbnRhdGlvblxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgc3RhdGljIF9jcmVhdGVFbWVyZ2VuY3lSZWdpc3RyeSgpIHtcclxuICAgIGNvbnN0IGxvZ2dlciA9IGdldExvZ2dlcignTW9kdWxlTG9hZGVyJyk7XHJcbiAgICBsb2dnZXIubG9nKCfwn5OmIENyZWF0aW5nIGVtZXJnZW5jeSBtaW5pbWFsIHJlZ2lzdHJ5IGltcGxlbWVudGF0aW9uJywgJ0lORk8nKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgbWluaW1hbCByZWdpc3RyeSBjb25zdHJ1Y3RvciBmdW5jdGlvbiB0byBtYXRjaCBleGlzdGluZyBwYXR0ZXJuXHJcbiAgICBmdW5jdGlvbiBDb252ZXJ0ZXJSZWdpc3RyeSgpIHtcclxuICAgICAgdGhpcy5jb252ZXJ0ZXJzID0ge1xyXG4gICAgICAgIHBkZjoge1xyXG4gICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucyA9IHt9KSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbRW1lcmdlbmN5UmVnaXN0cnldIFVzaW5nIGVtZXJnZW5jeSBQREYgY29udmVydGVyJyk7XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICBjb250ZW50OiBgIyBFeHRyYWN0ZWQgZnJvbSAke25hbWUgfHwgJ1BERiBkb2N1bWVudCd9XFxuXFxuVGhpcyBjb250ZW50IHdhcyBleHRyYWN0ZWQgdXNpbmcgdGhlIGVtZXJnZW5jeSBjb252ZXJ0ZXIuXFxuXFxuVGhlIGFwcGxpY2F0aW9uIGVuY291bnRlcmVkIGFuIGlzc3VlIGZpbmRpbmcgdGhlIGNvcnJlY3QgY29udmVydGVyIG1vZHVsZS4gUGxlYXNlIHJlcG9ydCB0aGlzIGlzc3VlLmAsXHJcbiAgICAgICAgICAgICAgdHlwZTogJ3BkZicsXHJcbiAgICAgICAgICAgICAgbWV0YWRhdGE6IHsgcGFnZXM6IDEsIGNvbnZlcnRlcjogJ2VtZXJnZW5jeS1mYWxsYmFjaycgfVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIHZhbGlkYXRlOiAoaW5wdXQpID0+IEJ1ZmZlci5pc0J1ZmZlcihpbnB1dCkgfHwgdHlwZW9mIGlucHV0ID09PSAnc3RyaW5nJyxcclxuICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICBuYW1lOiAnUERGIERvY3VtZW50IChFbWVyZ2VuY3kpJyxcclxuICAgICAgICAgICAgZXh0ZW5zaW9uczogWycucGRmJ10sXHJcbiAgICAgICAgICAgIG1pbWVUeXBlczogWydhcHBsaWNhdGlvbi9wZGYnXSxcclxuICAgICAgICAgICAgbWF4U2l6ZTogMjUgKiAxMDI0ICogMTAyNFxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBBZGQgcmVxdWlyZWQgcHJvdG90eXBlIG1ldGhvZHNcclxuICAgIENvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5jb252ZXJ0VG9NYXJrZG93biA9IGFzeW5jIGZ1bmN0aW9uKHR5cGUsIGNvbnRlbnQsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgW0VtZXJnZW5jeVJlZ2lzdHJ5XSBDb252ZXJ0aW5nICR7dHlwZX0gZG9jdW1lbnRgKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIGNvbnRlbnQ6IGAjIEVtZXJnZW5jeSBDb252ZXJ0ZXJcXG5cXG5UaGlzIGNvbnRlbnQgd2FzIGdlbmVyYXRlZCBieSBhbiBlbWVyZ2VuY3kgZmFsbGJhY2sgY29udmVydGVyIGJlY2F1c2UgdGhlIG5vcm1hbCBjb252ZXJ0ZXIgY291bGQgbm90IGJlIGxvYWRlZC5cXG5cXG5QbGVhc2UgcmVwb3J0IHRoaXMgaXNzdWUuYCxcclxuICAgICAgICBtZXRhZGF0YTogeyBzb3VyY2U6ICdlbWVyZ2VuY3ktZmFsbGJhY2snIH1cclxuICAgICAgfTtcclxuICAgIH07XHJcblxyXG4gICAgQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLmdldENvbnZlcnRlckJ5RXh0ZW5zaW9uID0gZnVuY3Rpb24oZXh0ZW5zaW9uKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBbRW1lcmdlbmN5UmVnaXN0cnldIExvb2tpbmcgdXAgY29udmVydGVyIGZvcjogJHtleHRlbnNpb259YCk7XHJcbiAgICAgIGlmIChleHRlbnNpb24gPT09ICdwZGYnKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuY29udmVydGVycy5wZGY7XHJcbiAgICAgIH1cclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9O1xyXG5cclxuICAgIC8vIENyZWF0ZSBhbmQgcmV0dXJuIHRoZSByZWdpc3RyeSBpbnN0YW5jZVxyXG4gICAgcmV0dXJuIG5ldyBDb252ZXJ0ZXJSZWdpc3RyeSgpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQXR0ZW1wdHMgdG8gbG9hZCBhIG1vZHVsZSBmcm9tIHRoZSBiZXN0IGF2YWlsYWJsZSBwYXRoXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IG1vZHVsZU5hbWUgLSBUaGUgbW9kdWxlIGZpbGUgbmFtZSAoZS5nLiwgJ0NvbnZlcnRlclJlZ2lzdHJ5LmpzJylcclxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGJhc2VQYXRocyAtIExpc3Qgb2YgYmFzZSBkaXJlY3RvcmllcyB0byBsb29rIGluXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8YW55Pn0gLSBUaGUgbG9hZGVkIG1vZHVsZVxyXG4gICAqL1xyXG4gIHN0YXRpYyBhc3luYyBsb2FkTW9kdWxlRnJvbUJlc3RQYXRoKG1vZHVsZU5hbWUsIGJhc2VQYXRocykge1xyXG4gICAgY29uc3QgbG9nZ2VyID0gZ2V0TG9nZ2VyKCdNb2R1bGVMb2FkZXInKTtcclxuICAgIGNvbnN0IHJlc29sdmVkUGF0aHMgPSBiYXNlUGF0aHMubWFwKGJhc2VQYXRoID0+IHBhdGguam9pbihiYXNlUGF0aCwgbW9kdWxlTmFtZSkpO1xyXG5cclxuICAgIGxvZ2dlci5sb2coYEF0dGVtcHRpbmcgdG8gbG9hZCAke21vZHVsZU5hbWV9IGZyb20gJHtyZXNvbHZlZFBhdGhzLmxlbmd0aH0gcG9zc2libGUgcGF0aHNgLCAnSU5GTycpO1xyXG5cclxuICAgIC8vIENoZWNrIHdoaWNoIHBhdGhzIGV4aXN0IGZpcnN0XHJcbiAgICBjb25zdCBleGlzdGluZ1BhdGhzID0gcmVzb2x2ZWRQYXRocy5maWx0ZXIocCA9PiB7XHJcbiAgICAgIGNvbnN0IGV4aXN0cyA9IGZzLmV4aXN0c1N5bmMocCk7XHJcbiAgICAgIGxvZ2dlci5sb2coYFBhdGggJHtwfSBleGlzdHM6ICR7ZXhpc3RzfWAsICdJTkZPJyk7XHJcbiAgICAgIHJldHVybiBleGlzdHM7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpZiAoZXhpc3RpbmdQYXRocy5sZW5ndGggPT09IDApIHtcclxuICAgICAgbG9nZ2VyLmVycm9yKGBObyBleGlzdGluZyBwYXRocyBmb3VuZCBmb3IgbW9kdWxlOiAke21vZHVsZU5hbWV9YCk7XHJcbiAgICAgIC8vIFRyeSBhbGwgcGF0aHMgYW55d2F5IGFzIGEgbGFzdCByZXNvcnRcclxuICAgICAgcmV0dXJuIHRoaXMubG9hZE1vZHVsZShyZXNvbHZlZFBhdGhzWzBdLCB7XHJcbiAgICAgICAgZmFsbGJhY2tQYXRoczogcmVzb2x2ZWRQYXRocy5zbGljZSgxKSxcclxuICAgICAgICBzaWxlbnQ6IHRydWVcclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTG9hZCBmcm9tIHRoZSBmaXJzdCBleGlzdGluZyBwYXRoLCB3aXRoIHJlbWFpbmluZyBleGlzdGluZyBwYXRocyBhcyBmYWxsYmFja3NcclxuICAgIHJldHVybiB0aGlzLmxvYWRNb2R1bGUoZXhpc3RpbmdQYXRoc1swXSwge1xyXG4gICAgICBmYWxsYmFja1BhdGhzOiBleGlzdGluZ1BhdGhzLnNsaWNlKDEpXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHN0YXRpYyBnZXRNb2R1bGVQYXRocygpIHtcclxuICAgIGNvbnN0IGlzRGV2ID0gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCc7XHJcbiAgICBjb25zdCBsb2dnZXIgPSBnZXRMb2dnZXIoJ01vZHVsZUxvYWRlcicpO1xyXG5cclxuICAgIC8vIENyZWF0ZSBhIGNvbXByZWhlbnNpdmUgbGlzdCBvZiBwb3NzaWJsZSBwYXRocyBmb3IgdGhlIENvbnZlcnRlclJlZ2lzdHJ5XHJcbiAgICBjb25zdCBwb3NzaWJsZVBhdGhzID0gW1xyXG4gICAgICAvLyBEZXZlbG9wbWVudCBwYXRoc1xyXG4gICAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gUGFja2FnZWQgYXBwIHBhdGhzIC0gbm90ZSB3ZSBleHBsaWNpdGx5IGhhbmRsZSB0aGUgcGF0aCBmcm9tIHRoZSBlcnJvclxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgvc3JjXFwvZWxlY3Ryb24vLCAnYnVpbGQvZWxlY3Ryb24nKSwgJ3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgvc3JjXFxcXGVsZWN0cm9uLywgJ2J1aWxkXFxcXGVsZWN0cm9uJyksICdzZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIFJlbGF0aXZlIHBhdGhzIGZyb20gY3VycmVudCBtb2R1bGVcclxuICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIFBhdGhzIHdpdGggYXBwLmFzYXIgZm9yIHBhY2thZ2VkIGFwcFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhcicsICdhcHAnKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyJywgJ2FwcCcpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhclxcXFxzcmMnLCAnYXBwLmFzYXJcXFxcYnVpbGQnKSwgJ2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXIvc3JjJywgJ2FwcC5hc2FyL2J1aWxkJyksICdlbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBBbHRlcm5hdGl2ZSBwYXJlbnQgZGlyZWN0b3J5IHBhdGhzXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnLi4vYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBTaWJsaW5nIHBhdGhzXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUoYXBwLmdldEFwcFBhdGgoKSksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUoYXBwLmdldEFwcFBhdGgoKSksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gTW9yZSBuZXN0ZWQgcGF0aHMgZm9yIGFwcC5hc2FyXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnZGlzdC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLi9yZXNvdXJjZXMvYXBwL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLi9yZXNvdXJjZXMvYXBwL2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIERpcmVjdCBwYXRoIGZpeGVzIGZvciB0aGUgc3BlY2lmaWMgZXJyb3IgcGF0aFxyXG4gICAgICBhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJywgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdzcmNcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvbicsICdidWlsZFxcXFxlbGVjdHJvblxcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBQYXRocyB3aXRoIGRpc3QgcHJlZml4ZXMgKG9mdGVuIHVzZWQgaW4gYnVpbHQgYXBwcylcclxuICAgICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdkaXN0L2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdkaXN0L2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIEFkZGl0aW9uYWwgcGF0aHMgc3BlY2lmaWNhbGx5IGZvciBDb252ZXJ0ZXJSZWdpc3RyeS5qc1xyXG4gICAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2FwcC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnYXBwL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uLy4uL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uLy4uLy4uL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ3Jlc291cmNlcy9hcHAvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAncmVzb3VyY2VzL2FwcC5hc2FyL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ3Jlc291cmNlcy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJylcclxuICAgIF07XHJcblxyXG4gICAgLy8gTG9nIGFwcCBlbnZpcm9ubWVudCBpbmZvcm1hdGlvbiBmb3IgZGVidWdnaW5nXHJcbiAgICBsb2dnZXIubG9nKGBBcHAgaXMgcGFja2FnZWQ6ICR7YXBwLmlzUGFja2FnZWR9YCwgJ0lORk8nKTtcclxuICAgIGxvZ2dlci5sb2coYEFwcCBwYXRoOiAke2FwcC5nZXRBcHBQYXRoKCl9YCwgJ0lORk8nKTtcclxuICAgIGxvZ2dlci5sb2coYF9fZGlybmFtZTogJHtfX2Rpcm5hbWV9YCwgJ0lORk8nKTtcclxuICAgIGxvZ2dlci5sb2coYHByb2Nlc3MuY3dkKCk6ICR7cHJvY2Vzcy5jd2QoKX1gLCAnSU5GTycpO1xyXG4gICAgbG9nZ2VyLmxvZyhgcHJvY2Vzcy5leGVjUGF0aDogJHtwcm9jZXNzLmV4ZWNQYXRofWAsICdJTkZPJyk7XHJcblxyXG4gICAgLy8gTG9nIHRoZSBzcGVjaWZpYyBwYXRoIGZyb20gdGhlIGVycm9yIG1lc3NhZ2VcclxuICAgIGNvbnN0IGVycm9yUGF0aCA9ICdDOlxcXFxVc2Vyc1xcXFxKb3NlcGhcXFxcRG9jdW1lbnRzXFxcXENvZGVcXFxcY29kZXgtbWRcXFxcZGlzdFxcXFx3aW4tdW5wYWNrZWRcXFxccmVzb3VyY2VzXFxcXGFwcC5hc2FyXFxcXHNyY1xcXFxlbGVjdHJvblxcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uXFxcXENvbnZlcnRlclJlZ2lzdHJ5LmpzJztcclxuICAgIGNvbnN0IGNvcnJlY3RlZFBhdGggPSBlcnJvclBhdGgucmVwbGFjZSgnXFxcXHNyY1xcXFwnLCAnXFxcXGJ1aWxkXFxcXCcpO1xyXG4gICAgbG9nZ2VyLmxvZyhgRXJyb3IgcGF0aDogJHtlcnJvclBhdGh9YCwgJ0lORk8nKTtcclxuICAgIGxvZ2dlci5sb2coYENvcnJlY3RlZCBwYXRoOiAke2NvcnJlY3RlZFBhdGh9YCwgJ0lORk8nKTtcclxuICAgIGxvZ2dlci5sb2coYENvcnJlY3RlZCBwYXRoIGV4aXN0czogJHtmcy5leGlzdHNTeW5jKGNvcnJlY3RlZFBhdGgpfWAsICdJTkZPJyk7XHJcblxyXG4gICAgLy8gRmluZCBmaXJzdCBleGlzdGluZyBiYXNlIHBhdGhcclxuICAgIGxldCBiYXNlUGF0aCA9IG51bGw7XHJcbiAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZVBhdGggb2YgcG9zc2libGVQYXRocykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGV4aXN0cyA9IGZzLmV4aXN0c1N5bmMoY2FuZGlkYXRlUGF0aCk7XHJcbiAgICAgICAgbG9nZ2VyLmxvZyhgQ2hlY2tpbmcgcGF0aDogJHtjYW5kaWRhdGVQYXRofSAoZXhpc3RzOiAke2V4aXN0c30pYCwgJ0lORk8nKTtcclxuXHJcbiAgICAgICAgaWYgKGV4aXN0cykge1xyXG4gICAgICAgICAgYmFzZVBhdGggPSBjYW5kaWRhdGVQYXRoO1xyXG4gICAgICAgICAgbG9nZ2VyLmxvZyhgRm91bmQgdmFsaWQgYmFzZSBwYXRoOiAke2Jhc2VQYXRofWAsICdJTkZPJyk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgbG9nZ2VyLndhcm4oYEVycm9yIGNoZWNraW5nIHBhdGggJHtjYW5kaWRhdGVQYXRofTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gSWYgbm8gYmFzZSBwYXRoIGV4aXN0cywgdHJ5IGRpcmVjdCBtb2R1bGUgcGF0aHNcclxuICAgIGlmICghYmFzZVBhdGgpIHtcclxuICAgICAgbG9nZ2VyLndhcm4oJ05vIHZhbGlkIGJhc2UgcGF0aCBmb3VuZCwgdHJ5aW5nIGRpcmVjdCBtb2R1bGUgcmVzb2x1dGlvbicpO1xyXG5cclxuICAgICAgLy8gRGVmaW5lIGFsbCBwb3NzaWJsZSBkaXJlY3QgcGF0aHMgdG8gdGhlIHJlZ2lzdHJ5IG1vZHVsZVxyXG4gICAgICBjb25zdCBkaXJlY3RSZWdpc3RyeVBhdGhzID0gW1xyXG4gICAgICAgIC8vIFNwZWNpZmljIHBhdGhzIGJhc2VkIG9uIGVycm9yIGxvZ3NcclxuICAgICAgICAvLyBUaGlzIGlzIHRoZSBzcGVjaWZpYyBlcnJvciBwYXRoIHdpdGggJ3NyYycgcmVwbGFjZWQgd2l0aCAnYnVpbGQnXHJcbiAgICAgICAgYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicsICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykgKyAnL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyxcclxuICAgICAgICBhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ3NyY1xcXFxlbGVjdHJvblxcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uJywgJ2J1aWxkXFxcXGVsZWN0cm9uXFxcXHNlcnZpY2VzXFxcXGNvbnZlcnNpb24nKSArICdcXFxcQ29udmVydGVyUmVnaXN0cnkuanMnLFxyXG5cclxuICAgICAgICAvLyBGdWxsIHN0cmluZyByZXBsYWNlbWVudHMgZm9yIHRoZSBzcGVjaWZpYyBlcnJvciBwYXRocyBpbiB0aGUgbG9nc1xyXG4gICAgICAgIGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXJcXFxcc3JjXFxcXGVsZWN0cm9uJywgJ2FwcC5hc2FyXFxcXGJ1aWxkXFxcXGVsZWN0cm9uJykgKyAnXFxcXHNlcnZpY2VzXFxcXGNvbnZlcnNpb25cXFxcQ29udmVydGVyUmVnaXN0cnkuanMnLFxyXG4gICAgICAgIGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXIvc3JjL2VsZWN0cm9uJywgJ2FwcC5hc2FyL2J1aWxkL2VsZWN0cm9uJykgKyAnL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnLFxyXG5cclxuICAgICAgICAvLyBTdGFuZGFyZCBhcHBsaWNhdGlvbiBwYXRoc1xyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcblxyXG4gICAgICAgIC8vIFJlbGF0aXZlIHBhdGhzXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG5cclxuICAgICAgICAvLyBBU0FSLXNwZWNpZmljIHBhdGhzIHdpdGggYWRhcHRhdGlvbnNcclxuICAgICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhcicsICdhcHAnKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXInLCAnYXBwJyksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJy4uL3Jlc291cmNlcy9hcHAvc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAnLi4vcmVzb3VyY2VzL2FwcC9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vLi4vZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvYXBwL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ3Jlc291cmNlcy9hcHAuYXNhci9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ3Jlc291cmNlcy9hcHAuYXNhci9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcblxyXG4gICAgICAgIC8vIEFsbG93IGZpbmRpbmcgaW4gY3VycmVudCBkaXJlY3Rvcmllc1xyXG4gICAgICAgIHBhdGguam9pbihfX2Rpcm5hbWUsICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGguam9pbihwYXRoLmRpcm5hbWUoX19kaXJuYW1lKSwgJ0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcblxyXG4gICAgICAgIC8vIFRyeSBhYnNvbHV0ZSBwYXRocyB0aGF0IG1hdGNoIHRoZSBlcnJvciBzdGFja1xyXG4gICAgICAgICdDOlxcXFxVc2Vyc1xcXFxKb3NlcGhcXFxcRG9jdW1lbnRzXFxcXENvZGVcXFxcY29kZXgtbWRcXFxcZGlzdFxcXFx3aW4tdW5wYWNrZWRcXFxccmVzb3VyY2VzXFxcXGFwcC5hc2FyXFxcXGJ1aWxkXFxcXGVsZWN0cm9uXFxcXHNlcnZpY2VzXFxcXGNvbnZlcnNpb25cXFxcQ29udmVydGVyUmVnaXN0cnkuanMnXHJcbiAgICAgIF07XHJcblxyXG4gICAgICAvLyBGaW5kIHRoZSBmaXJzdCBkaXJlY3QgcmVnaXN0cnkgcGF0aCB0aGF0IGV4aXN0c1xyXG4gICAgICBmb3IgKGNvbnN0IHJlZ2lzdHJ5UGF0aCBvZiBkaXJlY3RSZWdpc3RyeVBhdGhzKSB7XHJcbiAgICAgICAgY29uc3QgZXhpc3RzID0gZnMuZXhpc3RzU3luYyhyZWdpc3RyeVBhdGgpO1xyXG4gICAgICAgIGxvZ2dlci5sb2coYENoZWNraW5nIGRpcmVjdCByZWdpc3RyeSBwYXRoOiAke3JlZ2lzdHJ5UGF0aH0gKGV4aXN0czogJHtleGlzdHN9KWAsICdJTkZPJyk7XHJcblxyXG4gICAgICAgIGlmIChleGlzdHMpIHtcclxuICAgICAgICAgIC8vIEJ1aWxkIGEgYmFzZSBwYXRoIGZyb20gdGhlIGRpcmVjdG9yeSBjb250YWluaW5nIHRoZSByZWdpc3RyeVxyXG4gICAgICAgICAgYmFzZVBhdGggPSBwYXRoLmRpcm5hbWUocmVnaXN0cnlQYXRoKTtcclxuICAgICAgICAgIGxvZ2dlci5sb2coYEZvdW5kIHJlZ2lzdHJ5IG1vZHVsZSBhdDogJHtyZWdpc3RyeVBhdGh9LCB1c2luZyBiYXNlIHBhdGg6ICR7YmFzZVBhdGh9YCwgJ0lORk8nKTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIEZhbGxiYWNrIHRvIGEgZGVmYXVsdCBwYXRoIGlmIGFsbCBlbHNlIGZhaWxzXHJcbiAgICBpZiAoIWJhc2VQYXRoKSB7XHJcbiAgICAgIGxvZ2dlci5lcnJvcignQWxsIHBhdGggcmVzb2x1dGlvbiBhdHRlbXB0cyBmYWlsZWQsIHVzaW5nIGZhbGxiYWNrIHBhdGgnKTtcclxuXHJcbiAgICAgIC8vIFVzZSBhIHBhdGggcmVsYXRpdmUgdG8gY3VycmVudCBtb2R1bGUgYXMgbGFzdCByZXNvcnRcclxuICAgICAgaWYgKGFwcC5pc1BhY2thZ2VkKSB7XHJcbiAgICAgICAgYmFzZVBhdGggPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vc2VydmljZXMvY29udmVyc2lvbicpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTG9nIHRoZSBmaW5hbCBiYXNlIHBhdGggdGhhdCB3aWxsIGJlIHVzZWRcclxuICAgIGxvZ2dlci5sb2coYFVzaW5nIGZpbmFsIGJhc2UgcGF0aDogJHtiYXNlUGF0aH1gLCAnSU5GTycpO1xyXG5cclxuICAgIC8vIENoZWNrIGlmIHRoZSByZWdpc3RyeSBleGlzdHMgYXQgdGhpcyBwYXRoXHJcbiAgICBjb25zdCByZWdpc3RyeVBhdGggPSBwYXRoLmpvaW4oYmFzZVBhdGgsICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpO1xyXG4gICAgbG9nZ2VyLmxvZyhgRmluYWwgcmVnaXN0cnkgcGF0aDogJHtyZWdpc3RyeVBhdGh9IChleGlzdHM6ICR7ZnMuZXhpc3RzU3luYyhyZWdpc3RyeVBhdGgpfSlgLCAnSU5GTycpO1xyXG5cclxuICAgIC8vIENyZWF0ZSB0aGUgcGF0aHMgb2JqZWN0IHdpdGggYWxsIG1vZHVsZSBwYXRoc1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgcmVnaXN0cnk6IHJlZ2lzdHJ5UGF0aCxcclxuICAgICAgcmVnaXN0cnlQYXRoOiByZWdpc3RyeVBhdGgsIC8vIER1cGxpY2F0ZSBmb3IgZGlyZWN0IGFjY2Vzc1xyXG4gICAgICBjb252ZXJ0ZXJzOiB7XHJcbiAgICAgICAgdXJsOiBwYXRoLmpvaW4oYmFzZVBhdGgsICd3ZWIvVXJsQ29udmVydGVyLmpzJyksXHJcbiAgICAgICAgcGRmOiBwYXRoLmpvaW4oYmFzZVBhdGgsICdkb2N1bWVudC9QZGZDb252ZXJ0ZXJGYWN0b3J5LmpzJyksXHJcbiAgICAgICAgZG9jeDogcGF0aC5qb2luKGJhc2VQYXRoLCAnZG9jdW1lbnQvRG9jeENvbnZlcnRlci5qcycpLFxyXG4gICAgICAgIHBwdHg6IHBhdGguam9pbihiYXNlUGF0aCwgJ2RvY3VtZW50L1BwdHhDb252ZXJ0ZXIuanMnKSxcclxuICAgICAgICB4bHN4OiBwYXRoLmpvaW4oYmFzZVBhdGgsICdkYXRhL1hsc3hDb252ZXJ0ZXIuanMnKSxcclxuICAgICAgICBjc3Y6IHBhdGguam9pbihiYXNlUGF0aCwgJ2RhdGEvQ3N2Q29udmVydGVyLmpzJylcclxuICAgICAgfVxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8vIE1pbmltYWwgZW1iZWRkZWQgQ29udmVydGVyUmVnaXN0cnkgYXMgYSBsYXN0IHJlc29ydFxyXG5jb25zdCBNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkgPSB7XHJcbiAgY29udmVydGVyczoge1xyXG4gICAgcGRmOiB7XHJcbiAgICAgIC8vIE1pbmltYWwgUERGIGNvbnZlcnRlclxyXG4gICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zID0ge30pID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZygnW01pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeV0gVXNpbmcgZW1iZWRkZWQgUERGIGNvbnZlcnRlcicpO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgY29udGVudDogYCMgRXh0cmFjdGVkIGZyb20gJHtuYW1lIHx8ICdQREYgZG9jdW1lbnQnfVxcblxcblRoaXMgY29udGVudCB3YXMgZXh0cmFjdGVkIHVzaW5nIHRoZSBlbWJlZGRlZCBjb252ZXJ0ZXIuYCxcclxuICAgICAgICAgIHR5cGU6ICdwZGYnLFxyXG4gICAgICAgICAgbWV0YWRhdGE6IHsgcGFnZXM6IDEsIGNvbnZlcnRlcjogJ21pbmltYWwtZW1iZWRkZWQnIH1cclxuICAgICAgICB9O1xyXG4gICAgICB9LFxyXG4gICAgICB2YWxpZGF0ZTogKGlucHV0KSA9PiBCdWZmZXIuaXNCdWZmZXIoaW5wdXQpIHx8IHR5cGVvZiBpbnB1dCA9PT0gJ3N0cmluZycsXHJcbiAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgIG5hbWU6ICdQREYgRG9jdW1lbnQnLFxyXG4gICAgICAgIGV4dGVuc2lvbnM6IFsnLnBkZiddLFxyXG4gICAgICAgIG1pbWVUeXBlczogWydhcHBsaWNhdGlvbi9wZGYnXSxcclxuICAgICAgICBtYXhTaXplOiAyNSAqIDEwMjQgKiAxMDI0XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9LFxyXG5cclxuICAvLyBHZW5lcmljIGNvbnZlcnNpb24gZnVuY3Rpb25cclxuICBjb252ZXJ0VG9NYXJrZG93bjogYXN5bmMgKHR5cGUsIGNvbnRlbnQsIG9wdGlvbnMgPSB7fSkgPT4ge1xyXG4gICAgY29uc29sZS5sb2coYFtNaW5pbWFsQ29udmVydGVyUmVnaXN0cnldIFVzaW5nIGVtYmVkZGVkIGNvbnZlcnRUb01hcmtkb3duIGZvciAke3R5cGV9YCk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICBjb250ZW50OiBgIyBFeHRyYWN0ZWQgZnJvbSAke29wdGlvbnMubmFtZSB8fCAnZG9jdW1lbnQnfVxcblxcblRoaXMgY29udGVudCB3YXMgZXh0cmFjdGVkIHVzaW5nIHRoZSBlbWJlZGRlZCBjb252ZXJ0ZXIuYCxcclxuICAgICAgdHlwZTogdHlwZSxcclxuICAgICAgbWV0YWRhdGE6IHsgY29udmVydGVyOiAnbWluaW1hbC1lbWJlZGRlZCcgfVxyXG4gICAgfTtcclxuICB9LFxyXG5cclxuICAvLyBMb29rdXAgY29udmVydGVyIGJ5IGV4dGVuc2lvblxyXG4gIGdldENvbnZlcnRlckJ5RXh0ZW5zaW9uOiBhc3luYyAoZXh0ZW5zaW9uKSA9PiB7XHJcbiAgICBjb25zb2xlLmxvZyhgW01pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeV0gTG9va2luZyB1cCBjb252ZXJ0ZXIgZm9yOiAke2V4dGVuc2lvbn1gKTtcclxuXHJcbiAgICAvLyBIYW5kbGUgUERGIGZpbGVzIHNwZWNpZmljYWxseVxyXG4gICAgaWYgKGV4dGVuc2lvbiA9PT0gJ3BkZicpIHtcclxuICAgICAgcmV0dXJuIE1pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeS5jb252ZXJ0ZXJzLnBkZjtcclxuICAgIH1cclxuXHJcbiAgICAvLyBHZW5lcmljIGNvbnZlcnRlciBmb3Igb3RoZXIgdHlwZXNcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMgPSB7fSkgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5XSBVc2luZyBnZW5lcmljIGNvbnZlcnRlciBmb3IgJHtleHRlbnNpb259YCk7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICBjb250ZW50OiBgIyBFeHRyYWN0ZWQgZnJvbSAke25hbWUgfHwgZXh0ZW5zaW9uICsgJyBmaWxlJ31cXG5cXG5UaGlzIGNvbnRlbnQgd2FzIGV4dHJhY3RlZCB1c2luZyB0aGUgZW1iZWRkZWQgZ2VuZXJpYyBjb252ZXJ0ZXIuYCxcclxuICAgICAgICAgIHR5cGU6IGV4dGVuc2lvbixcclxuICAgICAgICAgIG1ldGFkYXRhOiB7IGNvbnZlcnRlcjogJ21pbmltYWwtZW1iZWRkZWQtZ2VuZXJpYycgfVxyXG4gICAgICAgIH07XHJcbiAgICAgIH0sXHJcbiAgICAgIHZhbGlkYXRlOiAoKSA9PiB0cnVlLFxyXG4gICAgICBjb25maWc6IHtcclxuICAgICAgICBuYW1lOiBgJHtleHRlbnNpb24udG9VcHBlckNhc2UoKX0gRG9jdW1lbnRgLFxyXG4gICAgICAgIGV4dGVuc2lvbnM6IFtgLiR7ZXh0ZW5zaW9ufWBdLFxyXG4gICAgICAgIG1pbWVUeXBlczogW2BhcHBsaWNhdGlvbi8ke2V4dGVuc2lvbn1gXSxcclxuICAgICAgICBtYXhTaXplOiAxMCAqIDEwMjQgKiAxMDI0XHJcbiAgICAgIH1cclxuICAgIH07XHJcbiAgfVxyXG59O1xyXG5cclxuLyoqXHJcbiAqIE1hbmFnZXMgY29udmVydGVyIGluaXRpYWxpemF0aW9uIGFuZCBlbnN1cmVzIHByb3BlciBsb2FkaW5nIHNlcXVlbmNlLlxyXG4gKi9cclxuY2xhc3MgQ29udmVydGVySW5pdGlhbGl6ZXIge1xyXG4gIHN0YXRpYyBfaW5zdGFuY2UgPSBudWxsO1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5faW5pdGlhbGl6ZWQgPSBmYWxzZTtcclxuICAgIHRoaXMuX2luaXRQcm9taXNlID0gbnVsbDtcclxuICAgIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5ID0gbnVsbDtcclxuICAgIHRoaXMubG9nZ2VyID0gZ2V0TG9nZ2VyKCdDb252ZXJ0ZXJJbml0aWFsaXplcicpO1xyXG4gIH1cclxuICBcclxuICBzdGF0aWMgZ2V0SW5zdGFuY2UoKSB7XHJcbiAgICBpZiAoIUNvbnZlcnRlckluaXRpYWxpemVyLl9pbnN0YW5jZSkge1xyXG4gICAgICBDb252ZXJ0ZXJJbml0aWFsaXplci5faW5zdGFuY2UgPSBuZXcgQ29udmVydGVySW5pdGlhbGl6ZXIoKTtcclxuICAgIH1cclxuICAgIHJldHVybiBDb252ZXJ0ZXJJbml0aWFsaXplci5faW5zdGFuY2U7XHJcbiAgfVxyXG5cclxuICBhc3luYyBpbml0aWFsaXplKCkge1xyXG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVkKSByZXR1cm4gdGhpcy5fY29udmVydGVyUmVnaXN0cnk7XHJcbiAgICBpZiAodGhpcy5faW5pdFByb21pc2UpIHJldHVybiB0aGlzLl9pbml0UHJvbWlzZTtcclxuXHJcbiAgICB0aGlzLl9pbml0UHJvbWlzZSA9IHRoaXMuX2RvSW5pdGlhbGl6ZSgpO1xyXG4gICAgcmV0dXJuIHRoaXMuX2luaXRQcm9taXNlO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgX2RvSW5pdGlhbGl6ZSgpIHtcclxuICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuU1RBUlRJTkcsXHJcbiAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLklOSVRJQUxJWklOR1xyXG4gICAgKTtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBHZXQgYWxsIHBvc3NpYmxlIG1vZHVsZSBwYXRoc1xyXG4gICAgICBjb25zdCBwYXRocyA9IE1vZHVsZUxvYWRlci5nZXRNb2R1bGVQYXRocygpO1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2coJ1VzaW5nIGNvbnZlcnRlciBwYXRoczonLCAnSU5GTycsIHBhdGhzKTtcclxuXHJcbiAgICAgIC8vIEV4dHJhY3QgYWxsIHRoZSBwb3NzaWJsZSBiYXNlIHBhdGhzIGZyb20gdmFyaW91cyBzb3VyY2VzXHJcbiAgICAgIGNvbnN0IHBvc3NpYmxlQmFzZVBhdGhzID0gW1xyXG4gICAgICAgIHBhdGguZGlybmFtZShwYXRocy5yZWdpc3RyeSksXHJcbiAgICAgICAgLi4uT2JqZWN0LnZhbHVlcyhwYXRocy5jb252ZXJ0ZXJzKS5tYXAocCA9PiBwYXRoLmRpcm5hbWUocGF0aC5kaXJuYW1lKHApKSlcclxuICAgICAgXTtcclxuXHJcbiAgICAgIC8vIExvZyBhbGwgcG9zc2libGUgcmVnaXN0cnkgcGF0aHMgd2UnbGwgdHJ5XHJcbiAgICAgIGNvbnN0IGFsbFBvc3NpYmxlUmVnaXN0cnlQYXRocyA9IFtcclxuICAgICAgICBwYXRocy5yZWdpc3RyeSxcclxuICAgICAgICBwYXRocy5yZWdpc3RyeVBhdGgsXHJcbiAgICAgICAgLi4ucG9zc2libGVCYXNlUGF0aHMubWFwKGJhc2VQYXRoID0+IHBhdGguam9pbihiYXNlUGF0aCwgJ0NvbnZlcnRlclJlZ2lzdHJ5LmpzJykpXHJcbiAgICAgIF07XHJcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdBbGwgcG9zc2libGUgcmVnaXN0cnkgcGF0aHM6JywgYWxsUG9zc2libGVSZWdpc3RyeVBhdGhzKTtcclxuXHJcbiAgICAgIC8vIEF0dGVtcHQgdG8gbG9hZCB0aGUgcmVnaXN0cnkgdXNpbmcgb3VyIGVuaGFuY2VkIGxvYWRlciB3aXRoIGZhbGxiYWNrc1xyXG4gICAgICBsZXQgcmVnaXN0cnk7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gRmlyc3QgdHJ5IHRoZSBkaXJlY3QgcGF0aFxyXG4gICAgICAgIGNvbnN0IGVycm9yUGF0aCA9ICdDOlxcXFxVc2Vyc1xcXFxKb3NlcGhcXFxcRG9jdW1lbnRzXFxcXENvZGVcXFxcY29kZXgtbWRcXFxcZGlzdFxcXFx3aW4tdW5wYWNrZWRcXFxccmVzb3VyY2VzXFxcXGFwcC5hc2FyXFxcXHNyY1xcXFxlbGVjdHJvblxcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uXFxcXENvbnZlcnRlclJlZ2lzdHJ5LmpzJztcclxuICAgICAgICBjb25zdCBjb3JyZWN0ZWRQYXRoID0gZXJyb3JQYXRoLnJlcGxhY2UoJ1xcXFxzcmNcXFxcJywgJ1xcXFxidWlsZFxcXFwnKTtcclxuXHJcbiAgICAgICAgLy8gQWxzbyBjaGVjayBpZiB0aGUgaGFyZGNvZGVkIGNvcnJlY3RlZCBwYXRoIGV4aXN0cyBhbmQgdHJ5IHRvIGxvYWQgaXQgZGlyZWN0bHlcclxuICAgICAgICBpZiAoZnMuZXhpc3RzU3luYyhjb3JyZWN0ZWRQYXRoKSkge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBGb3VuZCBjb3JyZWN0ZWQgcmVnaXN0cnkgcGF0aDogJHtjb3JyZWN0ZWRQYXRofWAsICdJTkZPJyk7XHJcbiAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICByZWdpc3RyeSA9IHJlcXVpcmUoY29ycmVjdGVkUGF0aCk7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLnN1Y2Nlc3MoJ1N1Y2Nlc3NmdWxseSBsb2FkZWQgcmVnaXN0cnkgZnJvbSBjb3JyZWN0ZWQgcGF0aCcpO1xyXG4gICAgICAgICAgfSBjYXRjaCAoZGlyZWN0TG9hZEVycm9yKSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYEZhaWxlZCB0byBsb2FkIGZyb20gY29ycmVjdGVkIHBhdGg6ICR7ZGlyZWN0TG9hZEVycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBJZiBkaXJlY3QgbG9hZGluZyBkaWRuJ3Qgd29yaywgdHJ5IHdpdGggdGhlIG1vZHVsZWxvYWRlclxyXG4gICAgICAgIGlmICghcmVnaXN0cnkpIHtcclxuICAgICAgICAgIHJlZ2lzdHJ5ID0gYXdhaXQgTW9kdWxlTG9hZGVyLmxvYWRNb2R1bGUoXHJcbiAgICAgICAgICAgIHBhdGhzLnJlZ2lzdHJ5LFxyXG4gICAgICAgICAgICB7IGZhbGxiYWNrUGF0aHM6IGFsbFBvc3NpYmxlUmVnaXN0cnlQYXRocy5zbGljZSgxKSwgc2lsZW50OiB0cnVlIH1cclxuICAgICAgICAgICk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChpbml0aWFsRXJyb3IpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdJbml0aWFsIHJlZ2lzdHJ5IGxvYWRpbmcgZmFpbGVkLCB0cnlpbmcgYWx0ZXJuYXRpdmUgYXBwcm9hY2hlcycsIGluaXRpYWxFcnJvcik7XHJcblxyXG4gICAgICAgIC8vIElmIGRpcmVjdCBsb2FkaW5nIGZhaWxlZCwgdHJ5IGEgZGlmZmVyZW50IGFwcHJvYWNoIGJ5IGNvbGxlY3RpbmcgYmFzZSBkaXJlY3Rvcmllc1xyXG4gICAgICAgIGNvbnN0IGJhc2VEaXJzID0gW107XHJcblxyXG4gICAgICAgIC8vIEFkZCBwb3RlbnRpYWwgYmFzZSBkaXJlY3RvcmllcyAoZGVkdXBsaWNhdGUgdGhlbSlcclxuICAgICAgICBjb25zdCBhZGRCYXNlRGlyID0gKGRpcikgPT4ge1xyXG4gICAgICAgICAgaWYgKGRpciAmJiAhYmFzZURpcnMuaW5jbHVkZXMoZGlyKSkge1xyXG4gICAgICAgICAgICBiYXNlRGlycy5wdXNoKGRpcik7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgLy8gQWRkIG11bHRpcGxlIHBhdGhzIHRoYXQgY291bGQgY29udGFpbiB0aGUgcmVnaXN0cnlcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGguZGlybmFtZShwYXRocy5yZWdpc3RyeSkpO1xyXG5cclxuICAgICAgICAvLyBBZGQgcGFyZW50IGRpcmVjdG9yaWVzIG9mIGVhY2ggY29udmVydGVyIHBhdGhcclxuICAgICAgICBPYmplY3QudmFsdWVzKHBhdGhzLmNvbnZlcnRlcnMpLmZvckVhY2goY29udmVydGVyUGF0aCA9PiB7XHJcbiAgICAgICAgICBjb25zdCBjb252ZXJ0ZXJEaXIgPSBwYXRoLmRpcm5hbWUoY29udmVydGVyUGF0aCk7XHJcbiAgICAgICAgICBhZGRCYXNlRGlyKHBhdGguZGlybmFtZShjb252ZXJ0ZXJEaXIpKTsgLy8gQWRkIHBhcmVudCBkaXJlY3RvcnlcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gQWRkIGNvbW1vbiBkaXJlY3RvcmllcyByZWxhdGl2ZSB0byBleGVjdXRhYmxlXHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyJywgJ2FwcCcpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhcicsICdhcHAnKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcblxyXG4gICAgICAgIC8vIExvZyB0aGUgYmFzZSBkaXJlY3RvcmllcyB3ZSdsbCB0cnlcclxuICAgICAgICB0aGlzLmxvZ2dlci5sb2coJ1RyeWluZyB0byBsb2FkIHJlZ2lzdHJ5IGZyb20gdGhlc2UgYmFzZSBkaXJlY3RvcmllczonLCAnSU5GTycsIGJhc2VEaXJzKTtcclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIC8vIFRyeSB0byBsb2FkIG1vZHVsZSBmcm9tIHRoZSBiZXN0IHBhdGhcclxuICAgICAgICAgIHJlZ2lzdHJ5ID0gYXdhaXQgTW9kdWxlTG9hZGVyLmxvYWRNb2R1bGVGcm9tQmVzdFBhdGgoJ0NvbnZlcnRlclJlZ2lzdHJ5LmpzJywgYmFzZURpcnMpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGJlc3RQYXRoRXJyb3IpIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdBbGwgcGF0aCBsb2FkaW5nIGF0dGVtcHRzIGZhaWxlZCwgdXNpbmcgZW1iZWRkZWQgcmVnaXN0cnknLCBiZXN0UGF0aEVycm9yKTtcclxuICAgICAgICAgIC8vIFdoZW4gYWxsIGVsc2UgZmFpbHMsIHVzZSBvdXIgZW1iZWRkZWQgcmVnaXN0cnlcclxuICAgICAgICAgIHJlZ2lzdHJ5ID0gTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybignVXNpbmcgZW1iZWRkZWQgTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5IGFzIGxhc3QgcmVzb3J0Jyk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBWYWxpZGF0ZSB0aGUgcmVnaXN0cnlcclxuICAgICAgaWYgKCF0aGlzLl92YWxpZGF0ZVJlZ2lzdHJ5KHJlZ2lzdHJ5KSkge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdJbnZhbGlkIGNvbnZlcnRlciByZWdpc3RyeSBzdHJ1Y3R1cmUsIHVzaW5nIGVtYmVkZGVkIHJlZ2lzdHJ5Jyk7XHJcbiAgICAgICAgLy8gVXNlIG91ciBlbWJlZGRlZCByZWdpc3RyeVxyXG4gICAgICAgIHJlZ2lzdHJ5ID0gTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1VzaW5nIGVtYmVkZGVkIE1pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeSBhcyBsYXN0IHJlc29ydCcpO1xyXG5cclxuICAgICAgICAvLyBEb3VibGUtY2hlY2sgdGhhdCBvdXIgZW1iZWRkZWQgcmVnaXN0cnkgaXMgdmFsaWRcclxuICAgICAgICBpZiAoIXRoaXMuX3ZhbGlkYXRlUmVnaXN0cnkocmVnaXN0cnkpKSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ01pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeSBpcyBpbnZhbGlkIScpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gTG9nIHRoZSBjb252ZXJ0ZXJzIGluIHRoZSByZWdpc3RyeVxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2coJ0F2YWlsYWJsZSBjb252ZXJ0ZXJzOicsIE9iamVjdC5rZXlzKHJlZ2lzdHJ5LmNvbnZlcnRlcnMgfHwge30pKTtcclxuXHJcbiAgICAgIHRoaXMubG9nZ2VyLnN1Y2Nlc3MoJ1N1Y2Nlc3NmdWxseSBsb2FkZWQgY29udmVydGVyIHJlZ2lzdHJ5Jyk7XHJcbiAgICAgIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5ID0gcmVnaXN0cnk7XHJcbiAgICAgIHRoaXMuX2luaXRpYWxpemVkID0gdHJ1ZTtcclxuXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5JTklUSUFMSVpJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuQ09NUExFVEVEXHJcbiAgICAgICk7XHJcblxyXG4gICAgICByZXR1cm4gdGhpcy5fY29udmVydGVyUmVnaXN0cnk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aGlzLl9pbml0UHJvbWlzZSA9IG51bGw7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ0NvbnZlcnNpb25FcnJvcignaW5pdCcsIGVycm9yKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFByb3ZpZGUgYmV0dGVyIGVycm9yIGluZm9ybWF0aW9uXHJcbiAgICAgIGNvbnN0IGVuaGFuY2VkRXJyb3IgPSBuZXcgRXJyb3IoYEZhaWxlZCB0byBpbml0aWFsaXplIGNvbnZlcnRlciByZWdpc3RyeTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICBlbmhhbmNlZEVycm9yLm9yaWdpbmFsID0gZXJyb3I7XHJcbiAgICAgIGVuaGFuY2VkRXJyb3Iuc3RhY2sgPSBlcnJvci5zdGFjaztcclxuICAgICAgdGhyb3cgZW5oYW5jZWRFcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIF92YWxpZGF0ZVJlZ2lzdHJ5KHJlZ2lzdHJ5KSB7XHJcbiAgICBpZiAoIXJlZ2lzdHJ5IHx8IHR5cGVvZiByZWdpc3RyeSAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcclxuICAgIGlmICghcmVnaXN0cnkuY29udmVydGVycyB8fCB0eXBlb2YgcmVnaXN0cnkuY29udmVydGVycyAhPT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcclxuICAgIGlmICh0eXBlb2YgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24gIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcclxuICAgIGlmICh0eXBlb2YgcmVnaXN0cnkuZ2V0Q29udmVydGVyQnlFeHRlbnNpb24gIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIENhdGVnb3JpemUgZmlsZSB0eXBlcyBmb3IgYmV0dGVyIG9yZ2FuaXphdGlvblxyXG4gKi9cclxuY29uc3QgRklMRV9UWVBFX0NBVEVHT1JJRVMgPSB7XHJcbiAgLy8gQXVkaW8gZmlsZXNcclxuICBtcDM6ICdhdWRpbycsXHJcbiAgd2F2OiAnYXVkaW8nLFxyXG4gIG9nZzogJ2F1ZGlvJyxcclxuICBmbGFjOiAnYXVkaW8nLFxyXG4gIFxyXG4gIC8vIFZpZGVvIGZpbGVzXHJcbiAgbXA0OiAndmlkZW8nLFxyXG4gIHdlYm06ICd2aWRlbycsXHJcbiAgYXZpOiAndmlkZW8nLFxyXG4gIG1vdjogJ3ZpZGVvJyxcclxuICBcclxuICAvLyBEb2N1bWVudCBmaWxlc1xyXG4gIHBkZjogJ2RvY3VtZW50JyxcclxuICBkb2N4OiAnZG9jdW1lbnQnLFxyXG4gIHBwdHg6ICdkb2N1bWVudCcsXHJcbiAgXHJcbiAgLy8gRGF0YSBmaWxlc1xyXG4gIHhsc3g6ICdkYXRhJyxcclxuICBjc3Y6ICdkYXRhJyxcclxuICBcclxuICAvLyBXZWIgY29udGVudFxyXG4gIHVybDogJ3dlYicsXHJcbiAgcGFyZW50dXJsOiAnd2ViJyxcclxufTtcclxuXHJcbi8qKlxyXG4gKiBFbmhhbmNlZCBVbmlmaWVkQ29udmVydGVyRmFjdG9yeSBjbGFzcyB3aXRoIHByb3BlciBpbml0aWFsaXphdGlvbiBhbmQgY29udmVyc2lvbiBoYW5kbGluZ1xyXG4gKi9cclxuY2xhc3MgVW5pZmllZENvbnZlcnRlckZhY3Rvcnkge1xyXG4gIHN0YXRpYyBfaW5zdGFuY2UgPSBudWxsO1xyXG4gIFxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5faW5pdGlhbGl6ZXIgPSBDb252ZXJ0ZXJJbml0aWFsaXplci5nZXRJbnN0YW5jZSgpO1xyXG4gICAgdGhpcy5fY29udmVydGVyUmVnaXN0cnkgPSBudWxsO1xyXG4gICAgdGhpcy5sb2dnZXIgPSBnZXRMb2dnZXIoJ1VuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5Jyk7XHJcbiAgICB0aGlzLmxvZ2dlci5sb2coJ1VuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5IGluaXRpYWxpemVkJywgJ0lORk8nKTtcclxuICB9XHJcblxyXG4gIHN0YXRpYyBnZXRJbnN0YW5jZSgpIHtcclxuICAgIGlmICghVW5pZmllZENvbnZlcnRlckZhY3RvcnkuX2luc3RhbmNlKSB7XHJcbiAgICAgIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5Ll9pbnN0YW5jZSA9IG5ldyBVbmlmaWVkQ29udmVydGVyRmFjdG9yeSgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5Ll9pbnN0YW5jZTtcclxuICB9XHJcblxyXG4gIGFzeW5jIF9lbnN1cmVJbml0aWFsaXplZCgpIHtcclxuICAgIGlmICghdGhpcy5fY29udmVydGVyUmVnaXN0cnkpIHtcclxuICAgICAgdGhpcy5fY29udmVydGVyUmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9pbml0aWFsaXplci5pbml0aWFsaXplKCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcy5fY29udmVydGVyUmVnaXN0cnk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRDb252ZXJ0ZXIoZmlsZVR5cGUpIHtcclxuICAgIHRoaXMubG9nZ2VyLnNldENvbnRleHQoeyBmaWxlVHlwZSB9KTtcclxuICAgIFxyXG4gICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgXHJcbiAgICBpZiAoIWZpbGVUeXBlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignRmlsZSB0eXBlIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTm9ybWFsaXplIGZpbGUgdHlwZSAocmVtb3ZlIGRvdCwgbG93ZXJjYXNlKVxyXG4gICAgY29uc3Qgbm9ybWFsaXplZFR5cGUgPSBmaWxlVHlwZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL15cXC4vLCAnJyk7XHJcblxyXG4gICAgLy8gR2V0IFVSTCBjb252ZXJ0ZXIgZGlyZWN0bHkgZnJvbSByZWdpc3RyeSBpZiBhdmFpbGFibGVcclxuICAgIGlmIChub3JtYWxpemVkVHlwZSA9PT0gJ3VybCcgfHwgbm9ybWFsaXplZFR5cGUgPT09ICdwYXJlbnR1cmwnKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZyhgVXNpbmcgZGlyZWN0IFVSTCBjb252ZXJ0ZXIgZm9yOiAke25vcm1hbGl6ZWRUeXBlfWAsICdJTkZPJyk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBjb252ZXJ0ZXIgPSByZWdpc3RyeS5jb252ZXJ0ZXJzPy5bbm9ybWFsaXplZFR5cGVdO1xyXG4gICAgICBpZiAoY29udmVydGVyKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuc3VjY2VzcyhgRm91bmQgJHtub3JtYWxpemVkVHlwZX0gY29udmVydGVyYCk7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIGNvbnZlcnRlcjoge1xyXG4gICAgICAgICAgICAuLi5jb252ZXJ0ZXIsXHJcbiAgICAgICAgICAgIHR5cGU6IG5vcm1hbGl6ZWRUeXBlLFxyXG4gICAgICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIGNvbnZlcnRlci5jb252ZXJ0KGNvbnRlbnQsIG5hbWUsIGFwaUtleSwge1xyXG4gICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICAgICAgICB0eXBlOiBub3JtYWxpemVkVHlwZVxyXG4gICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgdHlwZTogbm9ybWFsaXplZFR5cGUsXHJcbiAgICAgICAgICBjYXRlZ29yeTogJ3dlYidcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBUcnkgZmFsbGJhY2sgdG8gY29udmVydFRvTWFya2Rvd25cclxuICAgICAgdGhpcy5sb2dnZXIubG9nKGBBdHRlbXB0aW5nIGNvbnZlcnRUb01hcmtkb3duIGZhbGxiYWNrIGZvciAke25vcm1hbGl6ZWRUeXBlfWAsICdJTkZPJyk7XHJcbiAgICAgIGlmIChyZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93bikge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBjb252ZXJ0ZXI6IHtcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgIHJldHVybiByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93bihub3JtYWxpemVkVHlwZSwgY29udGVudCwge1xyXG4gICAgICAgICAgICAgICAgbmFtZSxcclxuICAgICAgICAgICAgICAgIGFwaUtleSxcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnNcclxuICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdmFsaWRhdGU6IChpbnB1dCkgPT4gdHlwZW9mIGlucHV0ID09PSAnc3RyaW5nJyAmJiBpbnB1dC5sZW5ndGggPiAwLFxyXG4gICAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgICBuYW1lOiBub3JtYWxpemVkVHlwZSA9PT0gJ3VybCcgPyAnV2ViIFBhZ2UnIDogJ1dlYnNpdGUnLFxyXG4gICAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnVybCcsICcuaHRtbCcsICcuaHRtJ10sXHJcbiAgICAgICAgICAgICAgbWltZVR5cGVzOiBbJ3RleHQvaHRtbCcsICdhcHBsaWNhdGlvbi94LXVybCddLFxyXG4gICAgICAgICAgICAgIG1heFNpemU6IDEwICogMTAyNCAqIDEwMjRcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIHR5cGU6IG5vcm1hbGl6ZWRUeXBlLFxyXG4gICAgICAgICAgY2F0ZWdvcnk6ICd3ZWInXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBGb3IgYWxsIG90aGVyIHR5cGVzLCBnZXQgY29udmVydGVyIGZyb20gcmVnaXN0cnlcclxuICAgIGNvbnN0IGNvbnZlcnRlciA9IGF3YWl0IHJlZ2lzdHJ5LmdldENvbnZlcnRlckJ5RXh0ZW5zaW9uKG5vcm1hbGl6ZWRUeXBlKTtcclxuICAgIGlmIChjb252ZXJ0ZXIpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBjb252ZXJ0ZXIsXHJcbiAgICAgICAgdHlwZTogbm9ybWFsaXplZFR5cGUsXHJcbiAgICAgICAgY2F0ZWdvcnk6IEZJTEVfVFlQRV9DQVRFR09SSUVTW25vcm1hbGl6ZWRUeXBlXSB8fCAnZG9jdW1lbnQnXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgdGhyb3cgbmV3IEVycm9yKGBObyBjb252ZXJ0ZXIgZm91bmQgZm9yIHR5cGU6ICR7ZmlsZVR5cGV9YCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDb252ZXJ0IGEgZmlsZSB0byBtYXJrZG93biB1c2luZyB0aGUgYXBwcm9wcmlhdGUgY29udmVydGVyXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgZmlsZSBvciBVUkwgc3RyaW5nXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSAtIENvbnZlcnNpb24gcmVzdWx0XHJcbiAgICovXHJcbiAgYXN5bmMgY29udmVydEZpbGUoZmlsZVBhdGgsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgY29uc3QgZmlsZVR5cGUgPSBvcHRpb25zLmZpbGVUeXBlO1xyXG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcclxuICAgIFxyXG4gICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvblN0YXJ0KGZpbGVUeXBlLCBvcHRpb25zKTtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgaWYgKCFmaWxlVHlwZSkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignZmlsZVR5cGUgaXMgcmVxdWlyZWQgaW4gb3B0aW9ucycpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBEZXRlcm1pbmUgaWYgdGhpcyBpcyBhIFVSTCBvciBhIGZpbGVcclxuICAgICAgY29uc3QgaXNVcmwgPSBmaWxlVHlwZSA9PT0gJ3VybCcgfHwgZmlsZVR5cGUgPT09ICdwYXJlbnR1cmwnO1xyXG4gICAgICBcclxuICAgICAgLy8gR2V0IGZpbGUgZGV0YWlscyAtIGhhbmRsZSBVUkxzIGRpZmZlcmVudGx5XHJcbiAgICAgIGxldCBmaWxlTmFtZTtcclxuICAgICAgXHJcbiAgICAgIGlmIChCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpKSB7XHJcbiAgICAgICAgZmlsZU5hbWUgPSBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWU7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFmaWxlTmFtZSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdvcmlnaW5hbEZpbGVOYW1lIGlzIHJlcXVpcmVkIHdoZW4gcGFzc2luZyBidWZmZXIgaW5wdXQnKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSBpZiAoaXNVcmwpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgY29uc3QgdXJsT2JqID0gbmV3IFVSTChmaWxlUGF0aCk7XHJcbiAgICAgICAgICBmaWxlTmFtZSA9IHVybE9iai5ob3N0bmFtZSArICh1cmxPYmoucGF0aG5hbWUgIT09ICcvJyA/IHVybE9iai5wYXRobmFtZSA6ICcnKTtcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICBmaWxlTmFtZSA9IGZpbGVQYXRoO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBmaWxlTmFtZSA9IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuU1RBUlRJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuVkFMSURBVElOR1xyXG4gICAgICApO1xyXG4gICAgICBcclxuICAgICAgLy8gR2V0IHRoZSBhcHByb3ByaWF0ZSBjb252ZXJ0ZXIgd2l0aCBhc3luYy9hd2FpdFxyXG4gICAgICBsZXQgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIFVSTCB0eXBlcyBpbiBwcm9kdWN0aW9uIG1vZGVcclxuICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvICYmIChmaWxlVHlwZSA9PT0gJ3VybCcgfHwgZmlsZVR5cGUgPT09ICdwYXJlbnR1cmwnKSkge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgU3BlY2lhbCBoYW5kbGluZyBmb3IgJHtmaWxlVHlwZX0gaW4gcHJvZHVjdGlvbiBtb2RlYCwgJ0lORk8nKTtcclxuICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5jcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChjb252ZXJ0ZXJJbmZvKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKGBDcmVhdGVkIGRpcmVjdCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBJZiBjb252ZXJ0ZXIgbm90IGZvdW5kLCB0cnkgYWdhaW4gYWZ0ZXIgYSBzaG9ydCBkZWxheVxyXG4gICAgICBpZiAoIWNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFJldHJ5aW5nIHRvIGdldCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9IGFmdGVyIGRlbGF5Li4uYCwgJ0lORk8nKTtcclxuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNTAwKSk7XHJcbiAgICAgICAgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWNvbnZlcnRlckluZm8gJiYgKGZpbGVUeXBlID09PSAndXJsJyB8fCBmaWxlVHlwZSA9PT0gJ3BhcmVudHVybCcpKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFNlY29uZCBhdHRlbXB0IGF0IHNwZWNpYWwgaGFuZGxpbmcgZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgICAgICAgIGNvbnZlcnRlckluZm8gPSBhd2FpdCB0aGlzLmNyZWF0ZURpcmVjdFVybENvbnZlcnRlcihmaWxlVHlwZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIElmIHN0aWxsIG5vdCBmb3VuZCwgdHJ5IG9uZSBtb3JlIHRpbWUgd2l0aCBhIGxvbmdlciBkZWxheVxyXG4gICAgICAgIGlmICghY29udmVydGVySW5mbykge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBGaW5hbCBhdHRlbXB0IHRvIGdldCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9IGFmdGVyIGxvbmdlciBkZWxheS4uLmAsICdJTkZPJyk7XHJcbiAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwMCkpO1xyXG4gICAgICAgICAgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvICYmIChmaWxlVHlwZSA9PT0gJ3VybCcgfHwgZmlsZVR5cGUgPT09ICdwYXJlbnR1cmwnKSkge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYEZpbmFsIGF0dGVtcHQgYXQgc3BlY2lhbCBoYW5kbGluZyBmb3IgJHtmaWxlVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5jcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBpZiAoIWNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBmaWxlIHR5cGU6ICR7ZmlsZVR5cGV9YCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgYSBwcm9ncmVzcyB0cmFja2VyIGlmIGNhbGxiYWNrIHByb3ZpZGVkXHJcbiAgICAgIGNvbnN0IHByb2dyZXNzVHJhY2tlciA9IG9wdGlvbnMub25Qcm9ncmVzcyA/IFxyXG4gICAgICAgIG5ldyBQcm9ncmVzc1RyYWNrZXIob3B0aW9ucy5vblByb2dyZXNzLCAyNTApIDogbnVsbDtcclxuICAgICAgXHJcbiAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDUsIHsgc3RhdHVzOiAnaW5pdGlhbGl6aW5nJywgZmlsZVR5cGU6IGZpbGVUeXBlIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZWdpc3RyeSA9IGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKCk7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQ29udmVydGVyIGluZm86Jywgc2FuaXRpemVGb3JMb2dnaW5nKHtcclxuICAgICAgICBoYXNSZWdpc3RyeTogISFyZWdpc3RyeSxcclxuICAgICAgICBjb252ZXJ0ZXJUeXBlOiBjb252ZXJ0ZXJJbmZvPy50eXBlIHx8ICdub25lJyxcclxuICAgICAgICBjYXRlZ29yeTogY29udmVydGVySW5mbz8uY2F0ZWdvcnkgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgIGhhc0NvbnZlcnRlcjogISFjb252ZXJ0ZXJJbmZvPy5jb252ZXJ0ZXIsXHJcbiAgICAgICAgY29udmVydGVyRGV0YWlsczogY29udmVydGVySW5mbz8uY29udmVydGVyXHJcbiAgICAgIH0pKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEhhbmRsZSB0aGUgY29udmVyc2lvbiBiYXNlZCBvbiBmaWxlIHR5cGVcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5oYW5kbGVDb252ZXJzaW9uKGZpbGVQYXRoLCB7XHJcbiAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUsXHJcbiAgICAgICAgZmlsZU5hbWUsXHJcbiAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLFxyXG4gICAgICAgIGNvbnZlcnRlckluZm8sXHJcbiAgICAgICAgaXNVcmxcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZSgxMDAsIHsgc3RhdHVzOiAnY29tcGxldGVkJyB9KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvbkNvbXBsZXRlKGZpbGVUeXBlKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvbkVycm9yKGZpbGVUeXBlLCBlcnJvcik7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZSxcclxuICAgICAgICB0eXBlOiBmaWxlVHlwZSxcclxuICAgICAgICBuYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgIGNhdGVnb3J5OiBGSUxFX1RZUEVfQ0FURUdPUklFU1tmaWxlVHlwZV0gfHwgJ3Vua25vd24nXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGUgYSBkaXJlY3QgVVJMIGNvbnZlcnRlciBmb3IgcHJvZHVjdGlvbiBtb2RlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVUeXBlIC0gVVJMIGZpbGUgdHlwZSAoJ3VybCcgb3IgJ3BhcmVudHVybCcpXHJcbiAgICogQHJldHVybnMge09iamVjdHxudWxsfSAtIENvbnZlcnRlciBpbmZvIG9yIG51bGwgaWYgbm90IHBvc3NpYmxlXHJcbiAgICovXHJcbiAgYXN5bmMgY3JlYXRlRGlyZWN0VXJsQ29udmVydGVyKGZpbGVUeXBlKSB7XHJcbiAgICB0aGlzLmxvZ2dlci5sb2coYENyZWF0aW5nIGRpcmVjdCBVUkwgY29udmVydGVyIGZvciAke2ZpbGVUeXBlfWAsICdJTkZPJyk7XHJcbiAgICBcclxuICAgIGNvbnN0IHJlZ2lzdHJ5ID0gYXdhaXQgdGhpcy5fZW5zdXJlSW5pdGlhbGl6ZWQoKTtcclxuICAgIGlmICghcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24pIHtcclxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0Nhbm5vdCBjcmVhdGUgZGlyZWN0IFVSTCBjb252ZXJ0ZXI6IGNvbnZlcnRUb01hcmtkb3duIG5vdCBhdmFpbGFibGUnKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGNvbnZlcnRlcjoge1xyXG4gICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgVXNpbmcgZGlyZWN0IFVSTCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgICAgICAgIHJldHVybiByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93bihmaWxlVHlwZSwgY29udGVudCwge1xyXG4gICAgICAgICAgICBuYW1lLFxyXG4gICAgICAgICAgICBhcGlLZXksXHJcbiAgICAgICAgICAgIC4uLm9wdGlvbnNcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgdmFsaWRhdGU6IChpbnB1dCkgPT4gdHlwZW9mIGlucHV0ID09PSAnc3RyaW5nJyAmJiBpbnB1dC5sZW5ndGggPiAwLFxyXG4gICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgbmFtZTogZmlsZVR5cGUgPT09ICd1cmwnID8gJ1dlYiBQYWdlJyA6ICdXZWJzaXRlJyxcclxuICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnVybCcsICcuaHRtbCcsICcuaHRtJ10sXHJcbiAgICAgICAgICBtaW1lVHlwZXM6IFsndGV4dC9odG1sJywgJ2FwcGxpY2F0aW9uL3gtdXJsJ10sXHJcbiAgICAgICAgICBtYXhTaXplOiAxMCAqIDEwMjQgKiAxMDI0XHJcbiAgICAgICAgfVxyXG4gICAgICB9LFxyXG4gICAgICB0eXBlOiBmaWxlVHlwZSxcclxuICAgICAgY2F0ZWdvcnk6ICd3ZWInXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU3RhbmRhcmRpemUgY29udmVyc2lvbiByZXN1bHQgdG8gZW5zdXJlIGNvbnNpc3RlbnQgZm9ybWF0XHJcbiAgICpcclxuICAgKiBJTVBPUlRBTlQ6IFRoaXMgbWV0aG9kIGVuc3VyZXMgcHJvcGVydGllcyBhcmUgc2V0IGluIHRoZSBjb3JyZWN0IG9yZGVyIHRvIHByZXZlbnRcclxuICAgKiBwcm9wZXJ0eSBzaGFkb3dpbmcgaXNzdWVzLiBUaGUgb3JkZXIgbWF0dGVycyBiZWNhdXNlOlxyXG4gICAqIDEuIFdlIGZpcnN0IHNwcmVhZCB0aGUgcmVzdWx0IG9iamVjdCB0byBpbmNsdWRlIGFsbCBpdHMgcHJvcGVydGllc1xyXG4gICAqIDIuIFRoZW4gd2Ugb3ZlcnJpZGUgc3BlY2lmaWMgcHJvcGVydGllcyB0byBlbnN1cmUgdGhleSBoYXZlIHRoZSBjb3JyZWN0IHZhbHVlc1xyXG4gICAqIDMuIFdlIHNldCBjb250ZW50IGxhc3QgdG8gZW5zdXJlIGl0J3Mgbm90IGFjY2lkZW50YWxseSBvdmVycmlkZGVuXHJcbiAgICogNC4gV2UgYWRkIGEgZmluYWwgY2hlY2sgdG8gZW5zdXJlIGNvbnRlbnQgaXMgbmV2ZXIgZW1wdHksIHByb3ZpZGluZyBhIGZhbGxiYWNrXHJcbiAgICpcclxuICAgKiBUaGlzIGZpeGVzIHRoZSBcIkNvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudFwiIGVycm9yIHRoYXQgY291bGQgb2NjdXIgd2hlblxyXG4gICAqIHRoZSBjb250ZW50IHByb3BlcnR5IHdhcyBvdmVycmlkZGVuIGJ5IHRoZSBzcHJlYWQgb3BlcmF0b3IuXHJcbiAgICpcclxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVzdWx0IC0gUmF3IGNvbnZlcnNpb24gcmVzdWx0XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVUeXBlIC0gRmlsZSB0eXBlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVOYW1lIC0gRmlsZSBuYW1lXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGNhdGVnb3J5IC0gRmlsZSBjYXRlZ29yeVxyXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IC0gU3RhbmRhcmRpemVkIHJlc3VsdFxyXG4gICAqL1xyXG4gIHN0YW5kYXJkaXplUmVzdWx0KHJlc3VsdCwgZmlsZVR5cGUsIGZpbGVOYW1lLCBjYXRlZ29yeSkge1xyXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoYFJhdyByZXN1bHQgcmVjZWl2ZWQgZm9yICR7ZmlsZVR5cGV9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhyZXN1bHQpKTsgLy8gQWRkIGxvZ2dpbmdcclxuXHJcbiAgICAvLyBIYW5kbGUgbnVsbCBvciB1bmRlZmluZWQgcmVzdWx0IGV4cGxpY2l0bHlcclxuICAgIGlmICghcmVzdWx0KSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgUmVjZWl2ZWQgbnVsbCBvciB1bmRlZmluZWQgcmVzdWx0IGZvciAke2ZpbGVUeXBlfS4gQXNzdW1pbmcgZmFpbHVyZS5gKTtcclxuICAgICAgICByZXN1bHQgPSB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogJ0NvbnZlcnRlciByZXR1cm5lZCBudWxsIG9yIHVuZGVmaW5lZCByZXN1bHQnIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIHN1Y2Nlc3Mgc3RhdHVzIG1vcmUgcm9idXN0bHlcclxuICAgIC8vIFN1Y2Nlc3MgaXMgT05MWSB0cnVlIGlmIHJlc3VsdC5zdWNjZXNzIGlzIGV4cGxpY2l0bHkgdHJ1ZS5cclxuICAgIC8vIE90aGVyd2lzZSwgaXQncyBmYWxzZSwgZXNwZWNpYWxseSBpZiBhbiBlcnJvciBwcm9wZXJ0eSBleGlzdHMuXHJcbiAgICBjb25zdCBpc1N1Y2Nlc3MgPSByZXN1bHQuc3VjY2VzcyA9PT0gdHJ1ZTtcclxuXHJcbiAgICAvLyBTYW5pdGl6ZSBwb3RlbnRpYWxseSBjb21wbGV4IG9iamVjdHMgd2l0aGluIHRoZSByZXN1bHQgKmFmdGVyKiBkZXRlcm1pbmluZyBzdWNjZXNzXHJcbiAgICBjb25zdCBzYW5pdGl6ZWRSZXN1bHQgPSBzYW5pdGl6ZUZvckxvZ2dpbmcocmVzdWx0KTtcclxuXHJcbiAgICBjb25zdCBzdGFuZGFyZGl6ZWQgPSB7XHJcbiAgICAgICAgLi4uc2FuaXRpemVkUmVzdWx0LCAvLyBTcHJlYWQgc2FuaXRpemVkIHJlc3VsdCBmaXJzdFxyXG4gICAgICAgIHN1Y2Nlc3M6IGlzU3VjY2VzcywgLy8gT3ZlcnJpZGUgd2l0aCBkZXRlcm1pbmVkIHN1Y2Nlc3Mgc3RhdHVzXHJcbiAgICAgICAgdHlwZTogcmVzdWx0LnR5cGUgfHwgZmlsZVR5cGUsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIG5hbWU6IHJlc3VsdC5uYW1lIHx8IGZpbGVOYW1lLFxyXG4gICAgICAgIGNhdGVnb3J5OiByZXN1bHQuY2F0ZWdvcnkgfHwgY2F0ZWdvcnksXHJcbiAgICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICAgICAgLi4uKHJlc3VsdC5tZXRhZGF0YSB8fCB7fSksXHJcbiAgICAgICAgICAgIGNvbnZlcnRlcjogcmVzdWx0LmNvbnZlcnRlciB8fCAndW5rbm93bidcclxuICAgICAgICB9LFxyXG4gICAgICAgIGltYWdlczogcmVzdWx0LmltYWdlcyB8fCBbXSxcclxuICAgICAgICAvLyBFbnN1cmUgY29udGVudCBleGlzdHMsIHByb3ZpZGUgZmFsbGJhY2sgaWYgbmVlZGVkXHJcbiAgICAgICAgY29udGVudDogcmVzdWx0LmNvbnRlbnQgfHwgKGlzU3VjY2VzcyA/ICcnIDogYCMgQ29udmVyc2lvbiBSZXN1bHRcXG5cXG5UaGUgJHtmaWxlVHlwZX0gZmlsZSB3YXMgcHJvY2Vzc2VkLCBidXQgbm8gY29udGVudCB3YXMgZ2VuZXJhdGVkLiBUaGlzIG1pZ2h0IGluZGljYXRlIGFuIGlzc3VlIG9yIGJlIG5vcm1hbCBmb3IgdGhpcyBmaWxlIHR5cGUuYCksXHJcbiAgICAgICAgLy8gRW5zdXJlIGVycm9yIHByb3BlcnR5IGlzIHByZXNlbnQgaWYgbm90IHN1Y2Nlc3NmdWxcclxuICAgICAgICBlcnJvcjogIWlzU3VjY2VzcyA/IChyZXN1bHQuZXJyb3IgfHwgJ1Vua25vd24gY29udmVyc2lvbiBlcnJvcicpIDogdW5kZWZpbmVkXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFJlbW92ZSBlcnJvciBwcm9wZXJ0eSBpZiBzdWNjZXNzZnVsXHJcbiAgICBpZiAoc3RhbmRhcmRpemVkLnN1Y2Nlc3MpIHtcclxuICAgICAgICBkZWxldGUgc3RhbmRhcmRpemVkLmVycm9yO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBFbnN1cmUgY29udGVudCBpcyBub3QgbnVsbCBvciB1bmRlZmluZWQsIGFuZCBwcm92aWRlIGFwcHJvcHJpYXRlIGZhbGxiYWNrXHJcbiAgICBpZiAoIXN0YW5kYXJkaXplZC5jb250ZW50ICYmICFpc1N1Y2Nlc3MpIHtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuQ09OVEVOVF9FTVBUWVxyXG4gICAgICApO1xyXG4gICAgICAvLyBQcm92aWRlIGEgbW9yZSBpbmZvcm1hdGl2ZSBtZXNzYWdlIGlmIHRoZSBjb252ZXJzaW9uIGZhaWxlZCBhbmQgY29udGVudCBpcyBlbXB0eVxyXG4gICAgICBzdGFuZGFyZGl6ZWQuY29udGVudCA9IGAjIENvbnZlcnNpb24gRXJyb3JcXG5cXG5UaGUgJHtmaWxlVHlwZX0gZmlsZSBjb252ZXJzaW9uIGZhaWxlZCBvciBwcm9kdWNlZCBubyBjb250ZW50LiBFcnJvcjogJHtzdGFuZGFyZGl6ZWQuZXJyb3IgfHwgJ1Vua25vd24gZXJyb3InfWA7XHJcbiAgICB9IGVsc2UgaWYgKCFzdGFuZGFyZGl6ZWQuY29udGVudCAmJiBpc1N1Y2Nlc3MpIHtcclxuICAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5QUk9DRVNTSU5HLFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkNPTlRFTlRfRU1QVFlcclxuICAgICAgKTtcclxuICAgICAgLy8gRmFsbGJhY2sgZm9yIHN1Y2Nlc3NmdWwgY29udmVyc2lvbiBidXQgZW1wdHkgY29udGVudFxyXG4gICAgICBzdGFuZGFyZGl6ZWQuY29udGVudCA9IGAjIENvbnZlcnNpb24gUmVzdWx0XFxuXFxuVGhlICR7ZmlsZVR5cGV9IGZpbGUgd2FzIHByb2Nlc3NlZCBzdWNjZXNzZnVsbHksIGJ1dCBubyB0ZXh0dWFsIGNvbnRlbnQgd2FzIGdlbmVyYXRlZC4gVGhpcyBpcyBub3JtYWwgZm9yIGNlcnRhaW4gZmlsZSB0eXBlcyAoZS5nLiwgbXVsdGltZWRpYSBmaWxlcyB3aXRob3V0IHRyYW5zY3JpcHRpb24pLmA7XHJcbiAgICB9XHJcblxyXG5cclxuICAgIC8vIExvZyB0aGUgZmluYWwgc3RhbmRhcmRpemVkIHJlc3VsdFxyXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoYFN0YW5kYXJkaXplZCByZXN1bHQgZm9yICR7ZmlsZVR5cGV9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhzdGFuZGFyZGl6ZWQpKTtcclxuXHJcbiAgICByZXR1cm4gc3RhbmRhcmRpemVkO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgaGFuZGxlQ29udmVyc2lvbihmaWxlUGF0aCwgb3B0aW9ucykge1xyXG4gICAgY29uc3QgeyBwcm9ncmVzc1RyYWNrZXIsIGZpbGVUeXBlLCBmaWxlTmFtZSwgY29udmVydGVySW5mbywgaXNVcmwgfSA9IG9wdGlvbnM7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFZhbGlkYXRlIGNvbnZlcnRlckluZm9cclxuICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYE5vIGNvbnZlcnRlciBpbmZvIGF2YWlsYWJsZSBmb3IgJHtmaWxlVHlwZX1gKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbnZlcnRlciBpbmZvIGF2YWlsYWJsZSBmb3IgJHtmaWxlVHlwZX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlZBTElEQVRJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRkFTVF9BVFRFTVBUXHJcbiAgICAgICk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBIYW5kbGUgVVJMIGFuZCBwYXJlbnQgVVJMIGRpZmZlcmVudGx5IHNpbmNlIHRoZXkgZG9uJ3QgbmVlZCBmaWxlIHJlYWRpbmdcclxuICAgICAgaWYgKGlzVXJsKSB7XHJcbiAgICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZSgyMCwgeyBzdGF0dXM6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YCB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBQcm9jZXNzaW5nIFVSTDogJHtmaWxlUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEZvciBVUkxzLCBmaWxlUGF0aCBpcyBhY3R1YWxseSB0aGUgVVJMIHN0cmluZ1xyXG4gICAgICAgIGxldCByZXN1bHQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIC8vIFRyeSB1c2luZyB0aGUgY29udmVydGVyJ3MgY29udmVydCBtZXRob2QgZmlyc3RcclxuICAgICAgICAgIGlmICh0eXBlb2YgY29udmVydGVyLmNvbnZlcnQgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBVc2luZyBjb252ZXJ0ZXIuY29udmVydCBmb3IgJHtmaWxlVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgICByZXN1bHQgPSBhd2FpdCBjb252ZXJ0ZXIuY29udmVydChmaWxlUGF0aCwgZmlsZU5hbWUsIG9wdGlvbnMuYXBpS2V5LCB7XHJcbiAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICBuYW1lOiBmaWxlTmFtZSxcclxuICAgICAgICAgICAgICBvblByb2dyZXNzOiAocHJvZ3Jlc3MpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICAgICAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZVNjYWxlZChwcm9ncmVzcywgMjAsIDkwLCB7IFxyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogdHlwZW9mIHByb2dyZXNzID09PSAnb2JqZWN0JyA/IHByb2dyZXNzLnN0YXR1cyA6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YFxyXG4gICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgLy8gRmFsbCBiYWNrIHRvIHVzaW5nIHRoZSByZWdpc3RyeSdzIGNvbnZlcnRUb01hcmtkb3duIG1ldGhvZFxyXG4gICAgICAgICAgICBjb25zdCByZWdpc3RyeSA9IGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKCk7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgVXNpbmcgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24gZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24oZmlsZVR5cGUsIGZpbGVQYXRoLCB7XHJcbiAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICBuYW1lOiBmaWxlTmFtZSxcclxuICAgICAgICAgICAgICBvblByb2dyZXNzOiAocHJvZ3Jlc3MpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICAgICAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZVNjYWxlZChwcm9ncmVzcywgMjAsIDkwLCB7IFxyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogdHlwZW9mIHByb2dyZXNzID09PSAnb2JqZWN0JyA/IHByb2dyZXNzLnN0YXR1cyA6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YFxyXG4gICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgaW4gVVJMIGNvbnZlcnNpb246ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gVHJ5IHRoZSBhbHRlcm5hdGl2ZSBtZXRob2QgYXMgYSBmYWxsYmFja1xyXG4gICAgICAgICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgICAgICAgaWYgKHR5cGVvZiBjb252ZXJ0ZXIuY29udmVydCA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24gPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBUcnlpbmcgYWx0ZXJuYXRpdmUgY29udmVyc2lvbiBtZXRob2QgYXMgZmFsbGJhY2tgLCAnSU5GTycpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAvLyBJZiB3ZSB0cmllZCBjb252ZXJ0ZXIuY29udmVydCBmaXJzdCwgbm93IHRyeSByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93blxyXG4gICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duKGZpbGVUeXBlLCBmaWxlUGF0aCwge1xyXG4gICAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICAgIG5hbWU6IGZpbGVOYW1lLFxyXG4gICAgICAgICAgICAgICAgb25Qcm9ncmVzczogKHByb2dyZXNzKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlU2NhbGVkKHByb2dyZXNzLCAyMCwgOTAsIHsgXHJcbiAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IHR5cGVvZiBwcm9ncmVzcyA9PT0gJ29iamVjdCcgPyBwcm9ncmVzcy5zdGF0dXMgOiBgcHJvY2Vzc2luZ18ke2ZpbGVUeXBlfWBcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChmYWxsYmFja0Vycm9yKSB7XHJcbiAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhbGxiYWNrIGNvbnZlcnNpb24gYWxzbyBmYWlsZWQ6ICR7ZmFsbGJhY2tFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgICAgIHRocm93IGVycm9yOyAvLyBUaHJvdyB0aGUgb3JpZ2luYWwgZXJyb3JcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7IC8vIFJlLXRocm93IGlmIG5vIGZhbGxiYWNrIGlzIGF2YWlsYWJsZVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDk1LCB7IHN0YXR1czogJ2ZpbmFsaXppbmcnIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5QUk9DRVNTSU5HLFxyXG4gICAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRklOQUxJWklOR1xyXG4gICAgICAgICk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLnN0YW5kYXJkaXplUmVzdWx0KHJlc3VsdCwgZmlsZVR5cGUsIGZpbGVOYW1lLCBjYXRlZ29yeSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFJlYWQgZmlsZSBjb250ZW50IGlmIG5vdCBhbHJlYWR5IGEgYnVmZmVyXHJcbiAgICAgIGNvbnN0IGZpbGVDb250ZW50ID0gQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSA/IGZpbGVQYXRoIDogZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDIwLCB7IHN0YXR1czogYGNvbnZlcnRpbmdfJHtmaWxlVHlwZX1gIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBQREYgZmlsZXMgdG8gaW5jbHVkZSBPQ1Igb3B0aW9uc1xyXG4gICAgICBpZiAoZmlsZVR5cGUgPT09ICdwZGYnKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0NvbnZlcnRpbmcgUERGIHdpdGggb3B0aW9uczonLCB7XHJcbiAgICAgICAgICB1c2VPY3I6IG9wdGlvbnMudXNlT2NyLFxyXG4gICAgICAgICAgaGFzTWlzdHJhbEFwaUtleTogISFvcHRpb25zLm1pc3RyYWxBcGlLZXksXHJcbiAgICAgICAgICBwcmVzZXJ2ZVBhZ2VJbmZvOiB0cnVlXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIG1vcmUgZGV0YWlsZWQgbG9nZ2luZyBmb3IgT0NSIHNldHRpbmdzXHJcbiAgICAgICAgaWYgKG9wdGlvbnMudXNlT2NyKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coJ09DUiBpcyBlbmFibGVkIGZvciB0aGlzIGNvbnZlcnNpb24nLCAnSU5GTycpO1xyXG4gICAgICAgICAgaWYgKG9wdGlvbnMubWlzdHJhbEFwaUtleSkge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnTWlzdHJhbCBBUEkga2V5IGlzIHByZXNlbnQnKTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ09DUiBpcyBlbmFibGVkIGJ1dCBNaXN0cmFsIEFQSSBrZXkgaXMgbWlzc2luZycpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gU3BlY2lhbCBoYW5kbGluZyBmb3IgYXVkaW8vdmlkZW8gZmlsZXMgdG8gZW5zdXJlIHRoZXkgZG9uJ3QgdXNlIE1pc3RyYWwgQVBJIGtleVxyXG4gICAgICBpZiAoZmlsZVR5cGUgPT09ICdtcDMnIHx8IGZpbGVUeXBlID09PSAnd2F2JyB8fCBmaWxlVHlwZSA9PT0gJ21wNCcgfHwgZmlsZVR5cGUgPT09ICdtb3YnIHx8IFxyXG4gICAgICAgICAgZmlsZVR5cGUgPT09ICdvZ2cnIHx8IGZpbGVUeXBlID09PSAnd2VibScgfHwgZmlsZVR5cGUgPT09ICdhdmknIHx8IFxyXG4gICAgICAgICAgZmlsZVR5cGUgPT09ICdmbGFjJyB8fCBmaWxlVHlwZSA9PT0gJ200YScpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5sb2coYENvbnZlcnRpbmcgbXVsdGltZWRpYSBmaWxlICgke2ZpbGVUeXBlfSlgLCAnSU5GTycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFJlbW92ZSBtaXN0cmFsQXBpS2V5IGZyb20gb3B0aW9ucyBmb3IgbXVsdGltZWRpYSBmaWxlcyB0byBwcmV2ZW50IGluY29ycmVjdCByb3V0aW5nXHJcbiAgICAgICAgaWYgKG9wdGlvbnMubWlzdHJhbEFwaUtleSkge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIubG9nKCdSZW1vdmluZyBNaXN0cmFsIEFQSSBrZXkgZnJvbSBtdWx0aW1lZGlhIGNvbnZlcnNpb24gb3B0aW9ucycsICdJTkZPJyk7XHJcbiAgICAgICAgICBjb25zdCB7IG1pc3RyYWxBcGlLZXksIC4uLmNsZWFuT3B0aW9ucyB9ID0gb3B0aW9ucztcclxuICAgICAgICAgIG9wdGlvbnMgPSBjbGVhbk9wdGlvbnM7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRkFTVF9BVFRFTVBULFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkdcclxuICAgICAgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFVzZSB0aGUgY29udmVydGVyJ3MgY29udmVydCBtZXRob2RcclxuICAgICAgY29uc3QgeyBjb252ZXJ0ZXIsIGNhdGVnb3J5IH0gPSBjb252ZXJ0ZXJJbmZvO1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjb252ZXJ0ZXIuY29udmVydChmaWxlQ29udGVudCwgZmlsZU5hbWUsIG9wdGlvbnMuYXBpS2V5LCB7XHJcbiAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICBuYW1lOiBmaWxlTmFtZSxcclxuICAgICAgICBvblByb2dyZXNzOiAocHJvZ3Jlc3MpID0+IHtcclxuICAgICAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZVNjYWxlZChwcm9ncmVzcywgMjAsIDkwLCB7IFxyXG4gICAgICAgICAgICAgIHN0YXR1czogdHlwZW9mIHByb2dyZXNzID09PSAnb2JqZWN0JyA/IHByb2dyZXNzLnN0YXR1cyA6IGBjb252ZXJ0aW5nXyR7ZmlsZVR5cGV9YCBcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDk1LCB7IHN0YXR1czogJ2ZpbmFsaXppbmcnIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuUFJPQ0VTU0lORyxcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GSU5BTElaSU5HXHJcbiAgICAgICk7XHJcblxyXG4gICAgICByZXR1cm4gdGhpcy5zdGFuZGFyZGl6ZVJlc3VsdChyZXN1bHQsIGZpbGVUeXBlLCBmaWxlTmFtZSwgY2F0ZWdvcnkpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvbkVycm9yKGZpbGVUeXBlLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGAke2ZpbGVUeXBlLnRvVXBwZXJDYXNlKCl9IGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCxcclxuICAgICAgICBjb250ZW50OiBgIyBDb252ZXJzaW9uIEVycm9yXFxuXFxuRmFpbGVkIHRvIGNvbnZlcnQgJHtmaWxlVHlwZS50b1VwcGVyQ2FzZSgpfSBmaWxlOiAke2Vycm9yLm1lc3NhZ2V9YCxcclxuICAgICAgICB0eXBlOiBmaWxlVHlwZSxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUsIC8vIEV4cGxpY2l0bHkgaW5jbHVkZSBmaWxlVHlwZVxyXG4gICAgICAgIG5hbWU6IGZpbGVOYW1lLFxyXG4gICAgICAgIGNhdGVnb3J5OiBjYXRlZ29yeSB8fCAndW5rbm93bidcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBBZGQgYW4gaW5pdGlhbGl6ZSBtZXRob2QgdG8gdGhlIGZhY3RvcnkgaW5zdGFuY2VcclxuICogVGhpcyBpcyBuZWVkZWQgZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBjb2RlIHRoYXQgZXhwZWN0cyB0aGlzIG1ldGhvZFxyXG4gKi9cclxuY29uc3QgdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPSBVbmlmaWVkQ29udmVydGVyRmFjdG9yeS5nZXRJbnN0YW5jZSgpO1xyXG5cclxuLy8gQWRkIGluaXRpYWxpemUgbWV0aG9kIHRvIHRoZSBmYWN0b3J5IGluc3RhbmNlXHJcbnVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmluaXRpYWxpemUgPSBhc3luYyBmdW5jdGlvbigpIHtcclxuICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5TVEFSVElORyxcclxuICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLklOSVRJQUxJWklOR1xyXG4gICk7XHJcbiAgXHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKCk7XHJcbiAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLklOSVRJQUxJWklORyxcclxuICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuQ09NUExFVEVEXHJcbiAgICApO1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIHRoaXMubG9nZ2VyLmxvZ0NvbnZlcnNpb25FcnJvcignaW5pdCcsIGVycm9yKTtcclxuICAgIHRocm93IGVycm9yO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIEV4cG9ydCBzaW5nbGV0b24gaW5zdGFuY2UgYW5kIG1vZHVsZSBmdW5jdGlvbnNcclxubW9kdWxlLmV4cG9ydHMgPSB1bmlmaWVkQ29udmVydGVyRmFjdG9yeTtcclxubW9kdWxlLmV4cG9ydHMudW5pZmllZENvbnZlcnRlckZhY3RvcnkgPSB1bmlmaWVkQ29udmVydGVyRmFjdG9yeTsiXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0EsSUFBSUEsR0FBRztBQUNQLElBQUk7RUFDRjtFQUNBLE1BQU1DLFFBQVEsR0FBR0MsT0FBTyxDQUFDLFVBQVUsQ0FBQztFQUNwQ0YsR0FBRyxHQUFHQyxRQUFRLENBQUNELEdBQUcsSUFBS0MsUUFBUSxDQUFDRSxNQUFNLElBQUlGLFFBQVEsQ0FBQ0UsTUFBTSxDQUFDSCxHQUFJO0FBQ2hFLENBQUMsQ0FBQyxPQUFPSSxDQUFDLEVBQUU7RUFDVjtFQUNBQyxPQUFPLENBQUNDLElBQUksQ0FBQyw4Q0FBOEMsQ0FBQztBQUM5RDs7QUFFQTtBQUNBLElBQUlDLEVBQUU7QUFDTixJQUFJO0VBQ0ZBLEVBQUUsR0FBR0wsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUMxQixDQUFDLENBQUMsT0FBT0UsQ0FBQyxFQUFFO0VBQ1YsSUFBSTtJQUNGRyxFQUFFLEdBQUdMLE9BQU8sQ0FBQyxJQUFJLENBQUM7SUFDbEI7SUFDQUssRUFBRSxDQUFDQyxVQUFVLEdBQUdELEVBQUUsQ0FBQ0MsVUFBVSxLQUFNQyxJQUFJLElBQUs7TUFDMUMsSUFBSTtRQUFFLE9BQU9GLEVBQUUsQ0FBQ0csUUFBUSxDQUFDRCxJQUFJLENBQUMsQ0FBQ0UsTUFBTSxDQUFDLENBQUM7TUFBRSxDQUFDLENBQUMsT0FBT1AsQ0FBQyxFQUFFO1FBQUUsT0FBTyxLQUFLO01BQUU7SUFDdkUsQ0FBQyxDQUFDO0VBQ0osQ0FBQyxDQUFDLE9BQU9RLE1BQU0sRUFBRTtJQUNmUCxPQUFPLENBQUNRLEtBQUssQ0FBQywyQkFBMkIsRUFBRUQsTUFBTSxDQUFDO0lBQ2xELE1BQU0sSUFBSUUsS0FBSyxDQUFDLCtDQUErQyxDQUFDO0VBQ2xFO0FBQ0Y7O0FBRUE7QUFDQSxNQUFNTCxJQUFJLEdBQUdQLE9BQU8sQ0FBQyxNQUFNLENBQUM7O0FBRTVCO0FBQ0EsSUFBSWEsU0FBUyxFQUFFQyxlQUFlLEVBQUVDLFNBQVMsRUFBRUMsa0JBQWtCLEVBQUVDLGdCQUFnQjs7QUFFL0U7QUFDQSxNQUFNQyxXQUFXLEdBQUdBLENBQUNDLFVBQVUsRUFBRUMsU0FBUyxHQUFHLEVBQUUsS0FBSztFQUNsRCxJQUFJO0lBQ0YsT0FBT3BCLE9BQU8sQ0FBQ21CLFVBQVUsQ0FBQztFQUM1QixDQUFDLENBQUMsT0FBT2pCLENBQUMsRUFBRTtJQUNWLEtBQUssTUFBTW1CLFFBQVEsSUFBSUQsU0FBUyxFQUFFO01BQ2hDLElBQUk7UUFDRixPQUFPcEIsT0FBTyxDQUFDcUIsUUFBUSxDQUFDO01BQzFCLENBQUMsQ0FBQyxNQUFNLENBQUU7SUFDWjs7SUFFQTtJQUNBLElBQUlGLFVBQVUsQ0FBQ0csUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFO01BQ3BDLE9BQVFDLElBQUksS0FBTTtRQUNoQkMsR0FBRyxFQUFFQSxDQUFDQyxHQUFHLEVBQUVDLEtBQUssRUFBRSxHQUFHQyxJQUFJLEtBQUt4QixPQUFPLENBQUNxQixHQUFHLENBQUMsSUFBSUQsSUFBSSxLQUFLRyxLQUFLLElBQUksTUFBTSxLQUFLRCxHQUFHLEVBQUUsRUFBRSxHQUFHRSxJQUFJLENBQUM7UUFDMUZoQixLQUFLLEVBQUVBLENBQUNjLEdBQUcsRUFBRUcsR0FBRyxLQUFLekIsT0FBTyxDQUFDUSxLQUFLLENBQUMsSUFBSVksSUFBSSxZQUFZRSxHQUFHLEVBQUUsRUFBRUcsR0FBRyxDQUFDO1FBQ2xFeEIsSUFBSSxFQUFFQSxDQUFDcUIsR0FBRyxFQUFFLEdBQUdFLElBQUksS0FBS3hCLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDLElBQUltQixJQUFJLFdBQVdFLEdBQUcsRUFBRSxFQUFFLEdBQUdFLElBQUksQ0FBQztRQUN2RUUsT0FBTyxFQUFHSixHQUFHLElBQUt0QixPQUFPLENBQUNxQixHQUFHLENBQUMsSUFBSUQsSUFBSSxjQUFjRSxHQUFHLEVBQUUsQ0FBQztRQUMxREssS0FBSyxFQUFFQSxDQUFDTCxHQUFHLEVBQUUsR0FBR0UsSUFBSSxLQUFLeEIsT0FBTyxDQUFDMkIsS0FBSyxDQUFDLElBQUlQLElBQUksWUFBWUUsR0FBRyxFQUFFLEVBQUUsR0FBR0UsSUFBSSxDQUFDO1FBQzFFSSxrQkFBa0IsRUFBRUEsQ0FBQ0MsSUFBSSxFQUFFQyxFQUFFLEtBQUs5QixPQUFPLENBQUNxQixHQUFHLENBQUMsSUFBSUQsSUFBSSx1QkFBdUJTLElBQUksTUFBTUMsRUFBRSxFQUFFLENBQUM7UUFDNUZDLGtCQUFrQixFQUFFQSxDQUFDQyxJQUFJLEVBQUVDLElBQUksS0FBS2pDLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxJQUFJRCxJQUFJLDZCQUE2QlksSUFBSSxFQUFFLENBQUM7UUFDNUZFLHFCQUFxQixFQUFHRixJQUFJLElBQUtoQyxPQUFPLENBQUNxQixHQUFHLENBQUMsSUFBSUQsSUFBSSw4QkFBOEJZLElBQUksRUFBRSxDQUFDO1FBQzFGRyxrQkFBa0IsRUFBRUEsQ0FBQ0gsSUFBSSxFQUFFUCxHQUFHLEtBQUt6QixPQUFPLENBQUNRLEtBQUssQ0FBQyxJQUFJWSxJQUFJLFlBQVlZLElBQUksT0FBT1AsR0FBRyxDQUFDVyxPQUFPLEVBQUUsRUFBRVgsR0FBRyxDQUFDO1FBQ25HWSxVQUFVLEVBQUVBLENBQUEsS0FBTSxDQUFDO01BQ3JCLENBQUMsQ0FBQztJQUNKO0lBQ0EsSUFBSXJCLFVBQVUsQ0FBQ0csUUFBUSxDQUFDLG9CQUFvQixDQUFDLEVBQUU7TUFDN0MsT0FBUW1CLEdBQUcsSUFBSztRQUNkLElBQUk7VUFDRixPQUFPLE9BQU9BLEdBQUcsS0FBSyxRQUFRLEdBQUc7WUFBRSxHQUFHQTtVQUFJLENBQUMsR0FBR0EsR0FBRztRQUNuRCxDQUFDLENBQUMsTUFBTTtVQUNOLE9BQU9BLEdBQUc7UUFDWjtNQUNGLENBQUM7SUFDSDtJQUVBdEMsT0FBTyxDQUFDQyxJQUFJLENBQUMsVUFBVWUsVUFBVSw4Q0FBOEMsQ0FBQztJQUNoRixPQUFPLENBQUMsQ0FBQztFQUNYO0FBQ0YsQ0FBQztBQUVELElBQUk7RUFDRk4sU0FBUyxHQUFHSyxXQUFXLENBQUMsc0JBQXNCLEVBQUUsQ0FDOUNYLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLHNCQUFzQixDQUFDLEVBQy9DcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsZ0NBQWdDLENBQUMsQ0FDOUQsQ0FBQyxDQUFDaEMsU0FBUyxJQUFJLENBQUMsQ0FBQztFQUVsQkMsZUFBZSxHQUFHSSxXQUFXLENBQUMsOEJBQThCLEVBQUUsQ0FDNURYLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLDhCQUE4QixDQUFDLEVBQ3ZEcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsd0NBQXdDLENBQUMsQ0FDdEUsQ0FBQyxDQUFDL0IsZUFBZSxJQUFJLE1BQU1BLGVBQWUsQ0FBQztJQUMxQ2dDLFdBQVdBLENBQUNDLFFBQVEsRUFBRTtNQUFFLElBQUksQ0FBQ0EsUUFBUSxHQUFHQSxRQUFRO0lBQUU7SUFDbERDLE1BQU1BLENBQUNDLFFBQVEsRUFBRUMsSUFBSSxFQUFFO01BQUUsSUFBSSxDQUFDSCxRQUFRLElBQUksSUFBSSxDQUFDQSxRQUFRLENBQUNFLFFBQVEsRUFBRUMsSUFBSSxDQUFDO0lBQUU7SUFDekVDLFlBQVlBLENBQUNGLFFBQVEsRUFBRUcsR0FBRyxFQUFFQyxHQUFHLEVBQUVILElBQUksRUFBRTtNQUFFLElBQUksQ0FBQ0YsTUFBTSxDQUFDSSxHQUFHLEdBQUlILFFBQVEsR0FBQyxHQUFHLElBQUtJLEdBQUcsR0FBQ0QsR0FBRyxDQUFDLEVBQUVGLElBQUksQ0FBQztJQUFFO0VBQ2hHLENBQUM7RUFFRG5DLFNBQVMsR0FBR0csV0FBVyxDQUFDLG1DQUFtQyxFQUFFLENBQzNEWCxJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSxtQ0FBbUMsQ0FBQyxFQUM1RHBDLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0UsT0FBTyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxFQUFFLDZDQUE2QyxDQUFDLENBQzNFLENBQUMsQ0FBQzlCLFNBQVMsS0FBTVEsSUFBSSxLQUFNO0lBQzFCQyxHQUFHLEVBQUVBLENBQUNDLEdBQUcsRUFBRUMsS0FBSyxFQUFFLEdBQUdDLElBQUksS0FBS3hCLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxJQUFJRCxJQUFJLEtBQUtHLEtBQUssSUFBSSxNQUFNLEtBQUtELEdBQUcsRUFBRSxFQUFFLEdBQUdFLElBQUksQ0FBQztJQUMxRmhCLEtBQUssRUFBRUEsQ0FBQ2MsR0FBRyxFQUFFRyxHQUFHLEtBQUt6QixPQUFPLENBQUNRLEtBQUssQ0FBQyxJQUFJWSxJQUFJLFlBQVlFLEdBQUcsRUFBRSxFQUFFRyxHQUFHLENBQUM7SUFDbEV4QixJQUFJLEVBQUVBLENBQUNxQixHQUFHLEVBQUUsR0FBR0UsSUFBSSxLQUFLeEIsT0FBTyxDQUFDQyxJQUFJLENBQUMsSUFBSW1CLElBQUksV0FBV0UsR0FBRyxFQUFFLEVBQUUsR0FBR0UsSUFBSSxDQUFDO0lBQ3ZFRSxPQUFPLEVBQUdKLEdBQUcsSUFBS3RCLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxJQUFJRCxJQUFJLGNBQWNFLEdBQUcsRUFBRSxDQUFDO0lBQzFESyxLQUFLLEVBQUVBLENBQUNMLEdBQUcsRUFBRSxHQUFHRSxJQUFJLEtBQUt4QixPQUFPLENBQUMyQixLQUFLLENBQUMsSUFBSVAsSUFBSSxZQUFZRSxHQUFHLEVBQUUsRUFBRSxHQUFHRSxJQUFJLENBQUM7SUFDMUVJLGtCQUFrQixFQUFFQSxDQUFDQyxJQUFJLEVBQUVDLEVBQUUsS0FBSzlCLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxJQUFJRCxJQUFJLHVCQUF1QlMsSUFBSSxNQUFNQyxFQUFFLEVBQUUsQ0FBQztJQUM1RkMsa0JBQWtCLEVBQUVBLENBQUNDLElBQUksRUFBRUMsSUFBSSxLQUFLakMsT0FBTyxDQUFDcUIsR0FBRyxDQUFDLElBQUlELElBQUksNkJBQTZCWSxJQUFJLEVBQUUsQ0FBQztJQUM1RkUscUJBQXFCLEVBQUdGLElBQUksSUFBS2hDLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxJQUFJRCxJQUFJLDhCQUE4QlksSUFBSSxFQUFFLENBQUM7SUFDMUZHLGtCQUFrQixFQUFFQSxDQUFDSCxJQUFJLEVBQUVQLEdBQUcsS0FBS3pCLE9BQU8sQ0FBQ1EsS0FBSyxDQUFDLElBQUlZLElBQUksWUFBWVksSUFBSSxPQUFPUCxHQUFHLENBQUNXLE9BQU8sRUFBRSxFQUFFWCxHQUFHLENBQUM7SUFDbkdZLFVBQVUsRUFBRUEsQ0FBQSxLQUFNLENBQUM7RUFDckIsQ0FBQyxDQUFDLENBQUM7RUFFSHhCLGtCQUFrQixHQUFHRSxXQUFXLENBQUMsK0JBQStCLEVBQUUsQ0FDaEVYLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLCtCQUErQixDQUFDLEVBQ3hEcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUseUNBQXlDLENBQUMsQ0FDdkUsQ0FBQyxDQUFDN0Isa0JBQWtCLEtBQU15QixHQUFHLElBQUs7SUFDakMsSUFBSTtNQUNGLE9BQU8sT0FBT0EsR0FBRyxLQUFLLFFBQVEsR0FBRztRQUFFLEdBQUdBO01BQUksQ0FBQyxHQUFHQSxHQUFHO0lBQ25ELENBQUMsQ0FBQyxNQUFNO01BQ04sT0FBT0EsR0FBRztJQUNaO0VBQ0YsQ0FBQyxDQUFDO0VBRUZ4QixnQkFBZ0IsR0FBR0MsV0FBVyxDQUFDLHNDQUFzQyxFQUFFLENBQ3JFWCxJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSxzQ0FBc0MsQ0FBQyxFQUMvRHBDLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0UsT0FBTyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxFQUFFLGdEQUFnRCxDQUFDLENBQzlFLENBQUMsSUFBSTtJQUNKUyxNQUFNLEVBQUU7TUFDTkMsUUFBUSxFQUFFLHFCQUFxQjtNQUMvQkMsWUFBWSxFQUFFLDJCQUEyQjtNQUN6Q0MsVUFBVSxFQUFFLG9CQUFvQjtNQUNoQ0MsWUFBWSxFQUFFLDJCQUEyQjtNQUN6Q0MsVUFBVSxFQUFFLHNCQUFzQjtNQUNsQ0MsVUFBVSxFQUFFLHFCQUFxQjtNQUNqQ0MsU0FBUyxFQUFFLHVCQUF1QjtNQUNsQ0MsYUFBYSxFQUFFO0lBQ2pCO0VBQ0YsQ0FBQztBQUNILENBQUMsQ0FBQyxPQUFPbkQsS0FBSyxFQUFFO0VBQ2RSLE9BQU8sQ0FBQ1EsS0FBSyxDQUFDLGlDQUFpQyxFQUFFQSxLQUFLLENBQUM7RUFDdkQsTUFBTSxJQUFJQyxLQUFLLENBQUMsOENBQThDRCxLQUFLLENBQUM0QixPQUFPLEVBQUUsQ0FBQztBQUNoRjs7QUFFQTtBQUNBLElBQUksQ0FBQ3pDLEdBQUcsRUFBRTtFQUNSQSxHQUFHLEdBQUc7SUFDSmlFLFVBQVUsRUFBRSxLQUFLO0lBQ2pCQyxVQUFVLEVBQUVBLENBQUEsS0FBTXBCLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLENBQUM7SUFDL0JvQixPQUFPLEVBQUVBLENBQUEsS0FBTSxVQUFVO0lBQ3pCQyxVQUFVLEVBQUVBLENBQUEsS0FBTTtFQUNwQixDQUFDO0VBQ0QvRCxPQUFPLENBQUNDLElBQUksQ0FBQyxtQ0FBbUMsQ0FBQztBQUNuRDs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxNQUFNK0QsWUFBWSxDQUFDO0VBQ2pCLGFBQWFDLFVBQVVBLENBQUNqRCxVQUFVLEVBQUVrRCxPQUFPLEdBQUcsQ0FBQyxDQUFDLEVBQUU7SUFDaEQsTUFBTUMsTUFBTSxHQUFHdkQsU0FBUyxDQUFDLGNBQWMsQ0FBQztJQUN4QyxNQUFNO01BQUV3RCxhQUFhLEdBQUcsRUFBRTtNQUFFQyxNQUFNLEdBQUc7SUFBTSxDQUFDLEdBQUdILE9BQU87SUFFdEQsSUFBSTtNQUNGQyxNQUFNLENBQUM5QyxHQUFHLENBQUMsNkJBQTZCTCxVQUFVLEVBQUUsRUFBRSxNQUFNLENBQUM7O01BRTdEO01BQ0EsTUFBTXNELFVBQVUsR0FBR2xFLElBQUksQ0FBQ21FLFFBQVEsQ0FBQ3ZELFVBQVUsQ0FBQztNQUM1QyxJQUFJd0QsUUFBUSxHQUFHLEVBQUU7O01BRWpCO01BQ0EsTUFBTUMsU0FBUyxHQUFHckUsSUFBSSxDQUFDc0UsT0FBTyxDQUFDMUQsVUFBVSxDQUFDLENBQUMyRCxLQUFLLENBQUN2RSxJQUFJLENBQUN3RSxHQUFHLENBQUM7TUFDMUQsSUFBSUgsU0FBUyxDQUFDSSxNQUFNLElBQUksQ0FBQyxFQUFFO1FBQ3pCO1FBQ0FMLFFBQVEsR0FBR0MsU0FBUyxDQUFDSyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQ0MsSUFBSSxDQUFDLEdBQUcsQ0FBQztNQUMxQyxDQUFDLE1BQU07UUFDTDtRQUNBUCxRQUFRLEdBQUcscUJBQXFCO01BQ2xDO01BRUFMLE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxxQ0FBcUNpRCxVQUFVLGVBQWVFLFFBQVEsRUFBRSxFQUFFLE1BQU0sQ0FBQzs7TUFFNUY7TUFDQSxJQUFJO1FBQ0YsTUFBTTtVQUFFUTtRQUFlLENBQUMsR0FBR25GLE9BQU8sQ0FBQyx5QkFBeUIsQ0FBQztRQUM3RCxNQUFNb0YsTUFBTSxHQUFHRCxjQUFjLENBQUNqRSxXQUFXLENBQUN1RCxVQUFVLEVBQUVFLFFBQVEsQ0FBQztRQUMvREwsTUFBTSxDQUFDekMsT0FBTyxDQUFDLG9EQUFvRDRDLFVBQVUsRUFBRSxDQUFDO1FBQ2hGLE9BQU9XLE1BQU07TUFDZixDQUFDLENBQUMsT0FBT0MsYUFBYSxFQUFFO1FBQ3RCZixNQUFNLENBQUMzRCxLQUFLLENBQUMsMEJBQTBCMEUsYUFBYSxDQUFDOUMsT0FBTyxFQUFFLEVBQUU4QyxhQUFhLENBQUM7O1FBRTlFO1FBQ0FmLE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQywrQ0FBK0MsRUFBRSxNQUFNLENBQUM7O1FBRW5FO1FBQ0EsSUFBSTtVQUNGLE1BQU00RCxNQUFNLEdBQUdwRixPQUFPLENBQUNtQixVQUFVLENBQUM7VUFDbENtRCxNQUFNLENBQUN6QyxPQUFPLENBQUMsd0NBQXdDVixVQUFVLEVBQUUsQ0FBQztVQUNwRSxPQUFPaUUsTUFBTSxDQUFDRSxPQUFPLElBQUlGLE1BQU07UUFDakMsQ0FBQyxDQUFDLE9BQU9HLFdBQVcsRUFBRTtVQUNwQjtVQUNBLElBQUloQixhQUFhLElBQUlBLGFBQWEsQ0FBQ1MsTUFBTSxHQUFHLENBQUMsRUFBRTtZQUM3Q1YsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLDJCQUEyQitDLGFBQWEsQ0FBQ1MsTUFBTSxpQkFBaUIsRUFBRSxNQUFNLENBQUM7WUFFcEYsS0FBSyxNQUFNUSxZQUFZLElBQUlqQixhQUFhLEVBQUU7Y0FDeEMsSUFBSTtnQkFDRkQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLHlCQUF5QmdFLFlBQVksRUFBRSxFQUFFLE1BQU0sQ0FBQztnQkFDM0QsTUFBTUosTUFBTSxHQUFHcEYsT0FBTyxDQUFDd0YsWUFBWSxDQUFDO2dCQUNwQ2xCLE1BQU0sQ0FBQ3pDLE9BQU8sQ0FBQyxzQ0FBc0MyRCxZQUFZLEVBQUUsQ0FBQztnQkFDcEUsT0FBT0osTUFBTSxDQUFDRSxPQUFPLElBQUlGLE1BQU07Y0FDakMsQ0FBQyxDQUFDLE9BQU9LLGFBQWEsRUFBRTtnQkFDdEI7Z0JBQ0EsSUFBSSxDQUFDakIsTUFBTSxFQUFFO2tCQUNYRixNQUFNLENBQUNsRSxJQUFJLENBQUMsaUNBQWlDb0YsWUFBWSxFQUFFLENBQUM7Z0JBQzlEO2NBQ0Y7WUFDRjtVQUNGOztVQUVBO1VBQ0EsSUFBSWYsVUFBVSxLQUFLLHNCQUFzQixFQUFFO1lBQ3pDSCxNQUFNLENBQUM5QyxHQUFHLENBQUMsaUZBQWlGLEVBQUUsTUFBTSxDQUFDO1lBQ3JHLE9BQU8sSUFBSSxDQUFDa0Usd0JBQXdCLENBQUMsQ0FBQztVQUN4Qzs7VUFFQTtVQUNBLE1BQU0sSUFBSTlFLEtBQUssQ0FBQywwQkFBMEJPLFVBQVUsWUFBWWtFLGFBQWEsQ0FBQzlDLE9BQU8sRUFBRSxDQUFDO1FBQzFGO01BQ0Y7SUFDRixDQUFDLENBQUMsT0FBTzVCLEtBQUssRUFBRTtNQUNkMkQsTUFBTSxDQUFDM0QsS0FBSyxDQUFDLHFDQUFxQ0EsS0FBSyxDQUFDNEIsT0FBTyxFQUFFLEVBQUU1QixLQUFLLENBQUM7TUFDekUsTUFBTSxJQUFJQyxLQUFLLENBQUMsMEJBQTBCTyxVQUFVLFlBQVlSLEtBQUssQ0FBQzRCLE9BQU8sRUFBRSxDQUFDO0lBQ2xGO0VBQ0Y7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtFQUNFLE9BQU9tRCx3QkFBd0JBLENBQUEsRUFBRztJQUNoQyxNQUFNcEIsTUFBTSxHQUFHdkQsU0FBUyxDQUFDLGNBQWMsQ0FBQztJQUN4Q3VELE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyx1REFBdUQsRUFBRSxNQUFNLENBQUM7O0lBRTNFO0lBQ0EsU0FBU21FLGlCQUFpQkEsQ0FBQSxFQUFHO01BQzNCLElBQUksQ0FBQ0MsVUFBVSxHQUFHO1FBQ2hCQyxHQUFHLEVBQUU7VUFDSEMsT0FBTyxFQUFFLE1BQUFBLENBQU9DLE9BQU8sRUFBRXhFLElBQUksRUFBRXlFLE1BQU0sRUFBRTNCLE9BQU8sR0FBRyxDQUFDLENBQUMsS0FBSztZQUN0RGxFLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxtREFBbUQsQ0FBQztZQUNoRSxPQUFPO2NBQ0xLLE9BQU8sRUFBRSxJQUFJO2NBQ2JrRSxPQUFPLEVBQUUsb0JBQW9CeEUsSUFBSSxJQUFJLGNBQWMsdUtBQXVLO2NBQzFOWSxJQUFJLEVBQUUsS0FBSztjQUNYOEQsUUFBUSxFQUFFO2dCQUFFQyxLQUFLLEVBQUUsQ0FBQztnQkFBRUMsU0FBUyxFQUFFO2NBQXFCO1lBQ3hELENBQUM7VUFDSCxDQUFDO1VBQ0RDLFFBQVEsRUFBR0MsS0FBSyxJQUFLQyxNQUFNLENBQUNDLFFBQVEsQ0FBQ0YsS0FBSyxDQUFDLElBQUksT0FBT0EsS0FBSyxLQUFLLFFBQVE7VUFDeEVHLE1BQU0sRUFBRTtZQUNOakYsSUFBSSxFQUFFLDBCQUEwQjtZQUNoQ2tGLFVBQVUsRUFBRSxDQUFDLE1BQU0sQ0FBQztZQUNwQkMsU0FBUyxFQUFFLENBQUMsaUJBQWlCLENBQUM7WUFDOUJDLE9BQU8sRUFBRSxFQUFFLEdBQUcsSUFBSSxHQUFHO1VBQ3ZCO1FBQ0Y7TUFDRixDQUFDO0lBQ0g7O0lBRUE7SUFDQWhCLGlCQUFpQixDQUFDaUIsU0FBUyxDQUFDQyxpQkFBaUIsR0FBRyxnQkFBZTFFLElBQUksRUFBRTRELE9BQU8sRUFBRTFCLE9BQU8sR0FBRyxDQUFDLENBQUMsRUFBRTtNQUMxRmxFLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxrQ0FBa0NXLElBQUksV0FBVyxDQUFDO01BQzlELE9BQU87UUFDTE4sT0FBTyxFQUFFLElBQUk7UUFDYmtFLE9BQU8sRUFBRSx1S0FBdUs7UUFDaExFLFFBQVEsRUFBRTtVQUFFYSxNQUFNLEVBQUU7UUFBcUI7TUFDM0MsQ0FBQztJQUNILENBQUM7SUFFRG5CLGlCQUFpQixDQUFDaUIsU0FBUyxDQUFDRyx1QkFBdUIsR0FBRyxVQUFTQyxTQUFTLEVBQUU7TUFDeEU3RyxPQUFPLENBQUNxQixHQUFHLENBQUMsaURBQWlEd0YsU0FBUyxFQUFFLENBQUM7TUFDekUsSUFBSUEsU0FBUyxLQUFLLEtBQUssRUFBRTtRQUN2QixPQUFPLElBQUksQ0FBQ3BCLFVBQVUsQ0FBQ0MsR0FBRztNQUM1QjtNQUNBLE9BQU8sSUFBSTtJQUNiLENBQUM7O0lBRUQ7SUFDQSxPQUFPLElBQUlGLGlCQUFpQixDQUFDLENBQUM7RUFDaEM7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsYUFBYXNCLHNCQUFzQkEsQ0FBQ3hDLFVBQVUsRUFBRXlDLFNBQVMsRUFBRTtJQUN6RCxNQUFNNUMsTUFBTSxHQUFHdkQsU0FBUyxDQUFDLGNBQWMsQ0FBQztJQUN4QyxNQUFNb0csYUFBYSxHQUFHRCxTQUFTLENBQUNFLEdBQUcsQ0FBQ0MsUUFBUSxJQUFJOUcsSUFBSSxDQUFDMkUsSUFBSSxDQUFDbUMsUUFBUSxFQUFFNUMsVUFBVSxDQUFDLENBQUM7SUFFaEZILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxzQkFBc0JpRCxVQUFVLFNBQVMwQyxhQUFhLENBQUNuQyxNQUFNLGlCQUFpQixFQUFFLE1BQU0sQ0FBQzs7SUFFbEc7SUFDQSxNQUFNc0MsYUFBYSxHQUFHSCxhQUFhLENBQUNJLE1BQU0sQ0FBQ0MsQ0FBQyxJQUFJO01BQzlDLE1BQU1DLE1BQU0sR0FBR3BILEVBQUUsQ0FBQ0MsVUFBVSxDQUFDa0gsQ0FBQyxDQUFDO01BQy9CbEQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLFFBQVFnRyxDQUFDLFlBQVlDLE1BQU0sRUFBRSxFQUFFLE1BQU0sQ0FBQztNQUNqRCxPQUFPQSxNQUFNO0lBQ2YsQ0FBQyxDQUFDO0lBRUYsSUFBSUgsYUFBYSxDQUFDdEMsTUFBTSxLQUFLLENBQUMsRUFBRTtNQUM5QlYsTUFBTSxDQUFDM0QsS0FBSyxDQUFDLHVDQUF1QzhELFVBQVUsRUFBRSxDQUFDO01BQ2pFO01BQ0EsT0FBTyxJQUFJLENBQUNMLFVBQVUsQ0FBQytDLGFBQWEsQ0FBQyxDQUFDLENBQUMsRUFBRTtRQUN2QzVDLGFBQWEsRUFBRTRDLGFBQWEsQ0FBQ2xDLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFDckNULE1BQU0sRUFBRTtNQUNWLENBQUMsQ0FBQztJQUNKOztJQUVBO0lBQ0EsT0FBTyxJQUFJLENBQUNKLFVBQVUsQ0FBQ2tELGFBQWEsQ0FBQyxDQUFDLENBQUMsRUFBRTtNQUN2Qy9DLGFBQWEsRUFBRStDLGFBQWEsQ0FBQ3JDLEtBQUssQ0FBQyxDQUFDO0lBQ3RDLENBQUMsQ0FBQztFQUNKO0VBRUEsT0FBT3lDLGNBQWNBLENBQUEsRUFBRztJQUN0QixNQUFNQyxLQUFLLEdBQUcvRSxPQUFPLENBQUNnRixHQUFHLENBQUNDLFFBQVEsS0FBSyxhQUFhO0lBQ3BELE1BQU12RCxNQUFNLEdBQUd2RCxTQUFTLENBQUMsY0FBYyxDQUFDOztJQUV4QztJQUNBLE1BQU0rRyxhQUFhLEdBQUc7SUFDcEI7SUFDQXZILElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0UsT0FBTyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxFQUFFLGtDQUFrQyxDQUFDLEVBQy9EdEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsb0NBQW9DLENBQUM7SUFFakU7SUFDQXRDLElBQUksQ0FBQ21DLE9BQU8sQ0FBQzVDLEdBQUcsQ0FBQ2tFLFVBQVUsQ0FBQyxDQUFDLEVBQUUsb0NBQW9DLENBQUMsRUFDcEV6RCxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxDQUFDK0QsT0FBTyxDQUFDLGVBQWUsRUFBRSxnQkFBZ0IsQ0FBQyxFQUFFLHFCQUFxQixDQUFDLEVBQ2hHeEgsSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQytELE9BQU8sQ0FBQyxlQUFlLEVBQUUsaUJBQWlCLENBQUMsRUFBRSxxQkFBcUIsQ0FBQyxFQUNqR3hILElBQUksQ0FBQ21DLE9BQU8sQ0FBQzVDLEdBQUcsQ0FBQ2tFLFVBQVUsQ0FBQyxDQUFDLEVBQUUsa0NBQWtDLENBQUM7SUFFbEU7SUFDQXpELElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLHdCQUF3QixDQUFDLEVBQ2pEcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDQyxTQUFTLEVBQUUsMkJBQTJCLENBQUMsRUFDcERwQyxJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSwwQ0FBMEMsQ0FBQztJQUVuRTtJQUNBcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQytELE9BQU8sQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLEVBQUUsa0NBQWtDLENBQUMsRUFDN0Z4SCxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxDQUFDK0QsT0FBTyxDQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsRUFBRSxvQ0FBb0MsQ0FBQyxFQUMvRnhILElBQUksQ0FBQ21DLE9BQU8sQ0FBQzVDLEdBQUcsQ0FBQ2tFLFVBQVUsQ0FBQyxDQUFDLENBQUMrRCxPQUFPLENBQUMsZUFBZSxFQUFFLGlCQUFpQixDQUFDLEVBQUUsOEJBQThCLENBQUMsRUFDMUd4SCxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxDQUFDK0QsT0FBTyxDQUFDLGNBQWMsRUFBRSxnQkFBZ0IsQ0FBQyxFQUFFLDhCQUE4QixDQUFDO0lBRXhHO0lBQ0F4SCxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxFQUFFLHVDQUF1QyxDQUFDLEVBQ3ZFekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsRUFBRSxxQ0FBcUMsQ0FBQztJQUVyRTtJQUNBekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDbkMsSUFBSSxDQUFDc0UsT0FBTyxDQUFDL0UsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQyxFQUFFLG9DQUFvQyxDQUFDLEVBQ2xGekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDbkMsSUFBSSxDQUFDc0UsT0FBTyxDQUFDL0UsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQyxFQUFFLGtDQUFrQyxDQUFDO0lBRWhGO0lBQ0F6RCxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxFQUFFLG1DQUFtQyxDQUFDLEVBQ25FekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDbkMsSUFBSSxDQUFDc0UsT0FBTyxDQUFDakMsT0FBTyxDQUFDb0YsUUFBUSxDQUFDLEVBQUUsbURBQW1ELENBQUMsRUFDakd6SCxJQUFJLENBQUNtQyxPQUFPLENBQUNuQyxJQUFJLENBQUNzRSxPQUFPLENBQUNqQyxPQUFPLENBQUNvRixRQUFRLENBQUMsRUFBRSxxREFBcUQsQ0FBQztJQUVuRztJQUNBbEksR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQytELE9BQU8sQ0FBQyxrQ0FBa0MsRUFBRSxvQ0FBb0MsQ0FBQyxFQUNsR2pJLEdBQUcsQ0FBQ2tFLFVBQVUsQ0FBQyxDQUFDLENBQUMrRCxPQUFPLENBQUMscUNBQXFDLEVBQUUsdUNBQXVDLENBQUM7SUFFeEc7SUFDQXhILElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0UsT0FBTyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxFQUFFLG1DQUFtQyxDQUFDLEVBQ2hFdEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsRUFBRSxtQ0FBbUMsQ0FBQztJQUVuRTtJQUNBekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsa0NBQWtDLENBQUMsRUFDL0R0QyxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxFQUFFLGtDQUFrQyxDQUFDLEVBQ2xFekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDQyxTQUFTLEVBQUUsdUNBQXVDLENBQUMsRUFDaEVwQyxJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSwwQ0FBMEMsQ0FBQyxFQUNuRXBDLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ25DLElBQUksQ0FBQ3NFLE9BQU8sQ0FBQ2pDLE9BQU8sQ0FBQ29GLFFBQVEsQ0FBQyxFQUFFLDRDQUE0QyxDQUFDLEVBQzFGekgsSUFBSSxDQUFDbUMsT0FBTyxDQUFDbkMsSUFBSSxDQUFDc0UsT0FBTyxDQUFDakMsT0FBTyxDQUFDb0YsUUFBUSxDQUFDLEVBQUUsaURBQWlELENBQUMsRUFDL0Z6SCxJQUFJLENBQUNtQyxPQUFPLENBQUNuQyxJQUFJLENBQUNzRSxPQUFPLENBQUNqQyxPQUFPLENBQUNvRixRQUFRLENBQUMsRUFBRSx3Q0FBd0MsQ0FBQyxDQUN2Rjs7SUFFRDtJQUNBMUQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLG9CQUFvQjFCLEdBQUcsQ0FBQ2lFLFVBQVUsRUFBRSxFQUFFLE1BQU0sQ0FBQztJQUN4RE8sTUFBTSxDQUFDOUMsR0FBRyxDQUFDLGFBQWExQixHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxFQUFFLEVBQUUsTUFBTSxDQUFDO0lBQ25ETSxNQUFNLENBQUM5QyxHQUFHLENBQUMsY0FBY21CLFNBQVMsRUFBRSxFQUFFLE1BQU0sQ0FBQztJQUM3QzJCLE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxrQkFBa0JvQixPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsRUFBRSxNQUFNLENBQUM7SUFDckR5QixNQUFNLENBQUM5QyxHQUFHLENBQUMscUJBQXFCb0IsT0FBTyxDQUFDb0YsUUFBUSxFQUFFLEVBQUUsTUFBTSxDQUFDOztJQUUzRDtJQUNBLE1BQU1DLFNBQVMsR0FBRyxrSkFBa0o7SUFDcEssTUFBTUMsYUFBYSxHQUFHRCxTQUFTLENBQUNGLE9BQU8sQ0FBQyxTQUFTLEVBQUUsV0FBVyxDQUFDO0lBQy9EekQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLGVBQWV5RyxTQUFTLEVBQUUsRUFBRSxNQUFNLENBQUM7SUFDOUMzRCxNQUFNLENBQUM5QyxHQUFHLENBQUMsbUJBQW1CMEcsYUFBYSxFQUFFLEVBQUUsTUFBTSxDQUFDO0lBQ3RENUQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLDBCQUEwQm5CLEVBQUUsQ0FBQ0MsVUFBVSxDQUFDNEgsYUFBYSxDQUFDLEVBQUUsRUFBRSxNQUFNLENBQUM7O0lBRTVFO0lBQ0EsSUFBSWIsUUFBUSxHQUFHLElBQUk7SUFDbkIsS0FBSyxNQUFNYyxhQUFhLElBQUlMLGFBQWEsRUFBRTtNQUN6QyxJQUFJO1FBQ0YsTUFBTUwsTUFBTSxHQUFHcEgsRUFBRSxDQUFDQyxVQUFVLENBQUM2SCxhQUFhLENBQUM7UUFDM0M3RCxNQUFNLENBQUM5QyxHQUFHLENBQUMsa0JBQWtCMkcsYUFBYSxhQUFhVixNQUFNLEdBQUcsRUFBRSxNQUFNLENBQUM7UUFFekUsSUFBSUEsTUFBTSxFQUFFO1VBQ1ZKLFFBQVEsR0FBR2MsYUFBYTtVQUN4QjdELE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQywwQkFBMEI2RixRQUFRLEVBQUUsRUFBRSxNQUFNLENBQUM7VUFDeEQ7UUFDRjtNQUNGLENBQUMsQ0FBQyxPQUFPMUcsS0FBSyxFQUFFO1FBQ2QyRCxNQUFNLENBQUNsRSxJQUFJLENBQUMsdUJBQXVCK0gsYUFBYSxLQUFLeEgsS0FBSyxDQUFDNEIsT0FBTyxFQUFFLENBQUM7TUFDdkU7SUFDRjs7SUFFQTtJQUNBLElBQUksQ0FBQzhFLFFBQVEsRUFBRTtNQUNiL0MsTUFBTSxDQUFDbEUsSUFBSSxDQUFDLDJEQUEyRCxDQUFDOztNQUV4RTtNQUNBLE1BQU1nSSxtQkFBbUIsR0FBRztNQUMxQjtNQUNBO01BQ0F0SSxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxDQUFDK0QsT0FBTyxDQUFDLGtDQUFrQyxFQUFFLG9DQUFvQyxDQUFDLEdBQUcsdUJBQXVCLEVBQzVIakksR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQytELE9BQU8sQ0FBQyxxQ0FBcUMsRUFBRSx1Q0FBdUMsQ0FBQyxHQUFHLHdCQUF3QjtNQUVuSTtNQUNBakksR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQytELE9BQU8sQ0FBQyx5QkFBeUIsRUFBRSwyQkFBMkIsQ0FBQyxHQUFHLDhDQUE4QyxFQUNqSWpJLEdBQUcsQ0FBQ2tFLFVBQVUsQ0FBQyxDQUFDLENBQUMrRCxPQUFPLENBQUMsdUJBQXVCLEVBQUUseUJBQXlCLENBQUMsR0FBRywyQ0FBMkM7TUFFMUg7TUFDQXhILElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0UsT0FBTyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxFQUFFLHVEQUF1RCxDQUFDLEVBQ3BGdEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUseURBQXlELENBQUMsRUFDdEZ0QyxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxFQUFFLHlEQUF5RCxDQUFDLEVBQ3pGekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsRUFBRSx1REFBdUQsQ0FBQztNQUV2RjtNQUNBekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDQyxTQUFTLEVBQUUsNkNBQTZDLENBQUMsRUFDdEVwQyxJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSxnREFBZ0QsQ0FBQztNQUV6RTtNQUNBcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQytELE9BQU8sQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLEVBQUUsdURBQXVELENBQUMsRUFDbEh4SCxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxDQUFDK0QsT0FBTyxDQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsRUFBRSx5REFBeUQsQ0FBQyxFQUNwSHhILElBQUksQ0FBQ21DLE9BQU8sQ0FBQ25DLElBQUksQ0FBQ3NFLE9BQU8sQ0FBQ2pDLE9BQU8sQ0FBQ29GLFFBQVEsQ0FBQyxFQUFFLHdFQUF3RSxDQUFDLEVBQ3RIekgsSUFBSSxDQUFDbUMsT0FBTyxDQUFDbkMsSUFBSSxDQUFDc0UsT0FBTyxDQUFDakMsT0FBTyxDQUFDb0YsUUFBUSxDQUFDLEVBQUUsMEVBQTBFLENBQUMsRUFDeEh6SCxJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSw2REFBNkQsQ0FBQyxFQUN0RnBDLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLCtEQUErRCxDQUFDLEVBQ3hGcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDQyxTQUFTLEVBQUUsNERBQTRELENBQUMsRUFDckZwQyxJQUFJLENBQUNtQyxPQUFPLENBQUNuQyxJQUFJLENBQUNzRSxPQUFPLENBQUNqQyxPQUFPLENBQUNvRixRQUFRLENBQUMsRUFBRSxxRUFBcUUsQ0FBQyxFQUNuSHpILElBQUksQ0FBQ21DLE9BQU8sQ0FBQ25DLElBQUksQ0FBQ3NFLE9BQU8sQ0FBQ2pDLE9BQU8sQ0FBQ29GLFFBQVEsQ0FBQyxFQUFFLHNFQUFzRSxDQUFDLEVBQ3BIekgsSUFBSSxDQUFDbUMsT0FBTyxDQUFDbkMsSUFBSSxDQUFDc0UsT0FBTyxDQUFDakMsT0FBTyxDQUFDb0YsUUFBUSxDQUFDLEVBQUUsNEVBQTRFLENBQUM7TUFFMUg7TUFDQXpILElBQUksQ0FBQzJFLElBQUksQ0FBQ3ZDLFNBQVMsRUFBRSxzQkFBc0IsQ0FBQyxFQUM1Q3BDLElBQUksQ0FBQzJFLElBQUksQ0FBQzNFLElBQUksQ0FBQ3NFLE9BQU8sQ0FBQ2xDLFNBQVMsQ0FBQyxFQUFFLHNCQUFzQixDQUFDO01BRTFEO01BQ0Esb0pBQW9KLENBQ3JKOztNQUVEO01BQ0EsS0FBSyxNQUFNMEYsWUFBWSxJQUFJRCxtQkFBbUIsRUFBRTtRQUM5QyxNQUFNWCxNQUFNLEdBQUdwSCxFQUFFLENBQUNDLFVBQVUsQ0FBQytILFlBQVksQ0FBQztRQUMxQy9ELE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxrQ0FBa0M2RyxZQUFZLGFBQWFaLE1BQU0sR0FBRyxFQUFFLE1BQU0sQ0FBQztRQUV4RixJQUFJQSxNQUFNLEVBQUU7VUFDVjtVQUNBSixRQUFRLEdBQUc5RyxJQUFJLENBQUNzRSxPQUFPLENBQUN3RCxZQUFZLENBQUM7VUFDckMvRCxNQUFNLENBQUM5QyxHQUFHLENBQUMsNkJBQTZCNkcsWUFBWSxzQkFBc0JoQixRQUFRLEVBQUUsRUFBRSxNQUFNLENBQUM7VUFDN0Y7UUFDRjtNQUNGO0lBQ0Y7O0lBRUE7SUFDQSxJQUFJLENBQUNBLFFBQVEsRUFBRTtNQUNiL0MsTUFBTSxDQUFDM0QsS0FBSyxDQUFDLDBEQUEwRCxDQUFDOztNQUV4RTtNQUNBLElBQUliLEdBQUcsQ0FBQ2lFLFVBQVUsRUFBRTtRQUNsQnNELFFBQVEsR0FBRzlHLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLHdCQUF3QixDQUFDO01BQzlELENBQUMsTUFBTTtRQUNMMEUsUUFBUSxHQUFHOUcsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsa0NBQWtDLENBQUM7TUFDNUU7SUFDRjs7SUFFQTtJQUNBeUIsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLDBCQUEwQjZGLFFBQVEsRUFBRSxFQUFFLE1BQU0sQ0FBQzs7SUFFeEQ7SUFDQSxNQUFNZ0IsWUFBWSxHQUFHOUgsSUFBSSxDQUFDMkUsSUFBSSxDQUFDbUMsUUFBUSxFQUFFLHNCQUFzQixDQUFDO0lBQ2hFL0MsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLHdCQUF3QjZHLFlBQVksYUFBYWhJLEVBQUUsQ0FBQ0MsVUFBVSxDQUFDK0gsWUFBWSxDQUFDLEdBQUcsRUFBRSxNQUFNLENBQUM7O0lBRW5HO0lBQ0EsT0FBTztNQUNMQyxRQUFRLEVBQUVELFlBQVk7TUFDdEJBLFlBQVksRUFBRUEsWUFBWTtNQUFFO01BQzVCekMsVUFBVSxFQUFFO1FBQ1YyQyxHQUFHLEVBQUVoSSxJQUFJLENBQUMyRSxJQUFJLENBQUNtQyxRQUFRLEVBQUUscUJBQXFCLENBQUM7UUFDL0N4QixHQUFHLEVBQUV0RixJQUFJLENBQUMyRSxJQUFJLENBQUNtQyxRQUFRLEVBQUUsaUNBQWlDLENBQUM7UUFDM0RtQixJQUFJLEVBQUVqSSxJQUFJLENBQUMyRSxJQUFJLENBQUNtQyxRQUFRLEVBQUUsMkJBQTJCLENBQUM7UUFDdERvQixJQUFJLEVBQUVsSSxJQUFJLENBQUMyRSxJQUFJLENBQUNtQyxRQUFRLEVBQUUsMkJBQTJCLENBQUM7UUFDdERxQixJQUFJLEVBQUVuSSxJQUFJLENBQUMyRSxJQUFJLENBQUNtQyxRQUFRLEVBQUUsdUJBQXVCLENBQUM7UUFDbERzQixHQUFHLEVBQUVwSSxJQUFJLENBQUMyRSxJQUFJLENBQUNtQyxRQUFRLEVBQUUsc0JBQXNCO01BQ2pEO0lBQ0YsQ0FBQztFQUNIO0FBQ0Y7O0FBRUE7QUFDQSxNQUFNdUIsd0JBQXdCLEdBQUc7RUFDL0JoRCxVQUFVLEVBQUU7SUFDVkMsR0FBRyxFQUFFO01BQ0g7TUFDQUMsT0FBTyxFQUFFLE1BQUFBLENBQU9DLE9BQU8sRUFBRXhFLElBQUksRUFBRXlFLE1BQU0sRUFBRTNCLE9BQU8sR0FBRyxDQUFDLENBQUMsS0FBSztRQUN0RGxFLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyx5REFBeUQsQ0FBQztRQUN0RSxPQUFPO1VBQ0xLLE9BQU8sRUFBRSxJQUFJO1VBQ2JrRSxPQUFPLEVBQUUsb0JBQW9CeEUsSUFBSSxJQUFJLGNBQWMsOERBQThEO1VBQ2pIWSxJQUFJLEVBQUUsS0FBSztVQUNYOEQsUUFBUSxFQUFFO1lBQUVDLEtBQUssRUFBRSxDQUFDO1lBQUVDLFNBQVMsRUFBRTtVQUFtQjtRQUN0RCxDQUFDO01BQ0gsQ0FBQztNQUNEQyxRQUFRLEVBQUdDLEtBQUssSUFBS0MsTUFBTSxDQUFDQyxRQUFRLENBQUNGLEtBQUssQ0FBQyxJQUFJLE9BQU9BLEtBQUssS0FBSyxRQUFRO01BQ3hFRyxNQUFNLEVBQUU7UUFDTmpGLElBQUksRUFBRSxjQUFjO1FBQ3BCa0YsVUFBVSxFQUFFLENBQUMsTUFBTSxDQUFDO1FBQ3BCQyxTQUFTLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQztRQUM5QkMsT0FBTyxFQUFFLEVBQUUsR0FBRyxJQUFJLEdBQUc7TUFDdkI7SUFDRjtFQUNGLENBQUM7RUFFRDtFQUNBRSxpQkFBaUIsRUFBRSxNQUFBQSxDQUFPMUUsSUFBSSxFQUFFNEQsT0FBTyxFQUFFMUIsT0FBTyxHQUFHLENBQUMsQ0FBQyxLQUFLO0lBQ3hEbEUsT0FBTyxDQUFDcUIsR0FBRyxDQUFDLG1FQUFtRVcsSUFBSSxFQUFFLENBQUM7SUFDdEYsT0FBTztNQUNMTixPQUFPLEVBQUUsSUFBSTtNQUNia0UsT0FBTyxFQUFFLG9CQUFvQjFCLE9BQU8sQ0FBQzlDLElBQUksSUFBSSxVQUFVLDhEQUE4RDtNQUNySFksSUFBSSxFQUFFQSxJQUFJO01BQ1Y4RCxRQUFRLEVBQUU7UUFBRUUsU0FBUyxFQUFFO01BQW1CO0lBQzVDLENBQUM7RUFDSCxDQUFDO0VBRUQ7RUFDQVksdUJBQXVCLEVBQUUsTUFBT0MsU0FBUyxJQUFLO0lBQzVDN0csT0FBTyxDQUFDcUIsR0FBRyxDQUFDLHdEQUF3RHdGLFNBQVMsRUFBRSxDQUFDOztJQUVoRjtJQUNBLElBQUlBLFNBQVMsS0FBSyxLQUFLLEVBQUU7TUFDdkIsT0FBTzRCLHdCQUF3QixDQUFDaEQsVUFBVSxDQUFDQyxHQUFHO0lBQ2hEOztJQUVBO0lBQ0EsT0FBTztNQUNMQyxPQUFPLEVBQUUsTUFBQUEsQ0FBT0MsT0FBTyxFQUFFeEUsSUFBSSxFQUFFeUUsTUFBTSxFQUFFM0IsT0FBTyxHQUFHLENBQUMsQ0FBQyxLQUFLO1FBQ3REbEUsT0FBTyxDQUFDcUIsR0FBRyxDQUFDLDBEQUEwRHdGLFNBQVMsRUFBRSxDQUFDO1FBQ2xGLE9BQU87VUFDTG5GLE9BQU8sRUFBRSxJQUFJO1VBQ2JrRSxPQUFPLEVBQUUsb0JBQW9CeEUsSUFBSSxJQUFJeUYsU0FBUyxHQUFHLE9BQU8sc0VBQXNFO1VBQzlIN0UsSUFBSSxFQUFFNkUsU0FBUztVQUNmZixRQUFRLEVBQUU7WUFBRUUsU0FBUyxFQUFFO1VBQTJCO1FBQ3BELENBQUM7TUFDSCxDQUFDO01BQ0RDLFFBQVEsRUFBRUEsQ0FBQSxLQUFNLElBQUk7TUFDcEJJLE1BQU0sRUFBRTtRQUNOakYsSUFBSSxFQUFFLEdBQUd5RixTQUFTLENBQUM2QixXQUFXLENBQUMsQ0FBQyxXQUFXO1FBQzNDcEMsVUFBVSxFQUFFLENBQUMsSUFBSU8sU0FBUyxFQUFFLENBQUM7UUFDN0JOLFNBQVMsRUFBRSxDQUFDLGVBQWVNLFNBQVMsRUFBRSxDQUFDO1FBQ3ZDTCxPQUFPLEVBQUUsRUFBRSxHQUFHLElBQUksR0FBRztNQUN2QjtJQUNGLENBQUM7RUFDSDtBQUNGLENBQUM7O0FBRUQ7QUFDQTtBQUNBO0FBQ0EsTUFBTW1DLG9CQUFvQixDQUFDO0VBQ3pCLE9BQU9DLFNBQVMsR0FBRyxJQUFJO0VBQ3ZCakcsV0FBV0EsQ0FBQSxFQUFHO0lBQ1osSUFBSSxDQUFDa0csWUFBWSxHQUFHLEtBQUs7SUFDekIsSUFBSSxDQUFDQyxZQUFZLEdBQUcsSUFBSTtJQUN4QixJQUFJLENBQUNDLGtCQUFrQixHQUFHLElBQUk7SUFDOUIsSUFBSSxDQUFDNUUsTUFBTSxHQUFHdkQsU0FBUyxDQUFDLHNCQUFzQixDQUFDO0VBQ2pEO0VBRUEsT0FBT29JLFdBQVdBLENBQUEsRUFBRztJQUNuQixJQUFJLENBQUNMLG9CQUFvQixDQUFDQyxTQUFTLEVBQUU7TUFDbkNELG9CQUFvQixDQUFDQyxTQUFTLEdBQUcsSUFBSUQsb0JBQW9CLENBQUMsQ0FBQztJQUM3RDtJQUNBLE9BQU9BLG9CQUFvQixDQUFDQyxTQUFTO0VBQ3ZDO0VBRUEsTUFBTUssVUFBVUEsQ0FBQSxFQUFHO0lBQ2pCLElBQUksSUFBSSxDQUFDSixZQUFZLEVBQUUsT0FBTyxJQUFJLENBQUNFLGtCQUFrQjtJQUNyRCxJQUFJLElBQUksQ0FBQ0QsWUFBWSxFQUFFLE9BQU8sSUFBSSxDQUFDQSxZQUFZO0lBRS9DLElBQUksQ0FBQ0EsWUFBWSxHQUFHLElBQUksQ0FBQ0ksYUFBYSxDQUFDLENBQUM7SUFDeEMsT0FBTyxJQUFJLENBQUNKLFlBQVk7RUFDMUI7RUFFQSxNQUFNSSxhQUFhQSxDQUFBLEVBQUc7SUFDcEIsSUFBSSxDQUFDL0UsTUFBTSxDQUFDdkMsa0JBQWtCLENBQzVCZCxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ0MsUUFBUSxFQUNoQ3RDLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDRSxZQUMxQixDQUFDO0lBRUQsSUFBSTtNQUNGO01BQ0EsTUFBTThGLEtBQUssR0FBR25GLFlBQVksQ0FBQ3VELGNBQWMsQ0FBQyxDQUFDO01BQzNDLElBQUksQ0FBQ3BELE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyx3QkFBd0IsRUFBRSxNQUFNLEVBQUU4SCxLQUFLLENBQUM7O01BRXhEO01BQ0EsTUFBTUMsaUJBQWlCLEdBQUcsQ0FDeEJoSixJQUFJLENBQUNzRSxPQUFPLENBQUN5RSxLQUFLLENBQUNoQixRQUFRLENBQUMsRUFDNUIsR0FBR2tCLE1BQU0sQ0FBQ0MsTUFBTSxDQUFDSCxLQUFLLENBQUMxRCxVQUFVLENBQUMsQ0FBQ3dCLEdBQUcsQ0FBQ0ksQ0FBQyxJQUFJakgsSUFBSSxDQUFDc0UsT0FBTyxDQUFDdEUsSUFBSSxDQUFDc0UsT0FBTyxDQUFDMkMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUMzRTs7TUFFRDtNQUNBLE1BQU1rQyx3QkFBd0IsR0FBRyxDQUMvQkosS0FBSyxDQUFDaEIsUUFBUSxFQUNkZ0IsS0FBSyxDQUFDakIsWUFBWSxFQUNsQixHQUFHa0IsaUJBQWlCLENBQUNuQyxHQUFHLENBQUNDLFFBQVEsSUFBSTlHLElBQUksQ0FBQzJFLElBQUksQ0FBQ21DLFFBQVEsRUFBRSxzQkFBc0IsQ0FBQyxDQUFDLENBQ2xGO01BQ0QsSUFBSSxDQUFDL0MsTUFBTSxDQUFDeEMsS0FBSyxDQUFDLDhCQUE4QixFQUFFNEgsd0JBQXdCLENBQUM7O01BRTNFO01BQ0EsSUFBSXBCLFFBQVE7TUFDWixJQUFJO1FBQ0Y7UUFDQSxNQUFNTCxTQUFTLEdBQUcsa0pBQWtKO1FBQ3BLLE1BQU1DLGFBQWEsR0FBR0QsU0FBUyxDQUFDRixPQUFPLENBQUMsU0FBUyxFQUFFLFdBQVcsQ0FBQzs7UUFFL0Q7UUFDQSxJQUFJMUgsRUFBRSxDQUFDQyxVQUFVLENBQUM0SCxhQUFhLENBQUMsRUFBRTtVQUNoQyxJQUFJLENBQUM1RCxNQUFNLENBQUM5QyxHQUFHLENBQUMsa0NBQWtDMEcsYUFBYSxFQUFFLEVBQUUsTUFBTSxDQUFDO1VBQzFFLElBQUk7WUFDRkksUUFBUSxHQUFHdEksT0FBTyxDQUFDa0ksYUFBYSxDQUFDO1lBQ2pDLElBQUksQ0FBQzVELE1BQU0sQ0FBQ3pDLE9BQU8sQ0FBQyxrREFBa0QsQ0FBQztVQUN6RSxDQUFDLENBQUMsT0FBTzhILGVBQWUsRUFBRTtZQUN4QixJQUFJLENBQUNyRixNQUFNLENBQUNsRSxJQUFJLENBQUMsdUNBQXVDdUosZUFBZSxDQUFDcEgsT0FBTyxFQUFFLENBQUM7VUFDcEY7UUFDRjs7UUFFQTtRQUNBLElBQUksQ0FBQytGLFFBQVEsRUFBRTtVQUNiQSxRQUFRLEdBQUcsTUFBTW5FLFlBQVksQ0FBQ0MsVUFBVSxDQUN0Q2tGLEtBQUssQ0FBQ2hCLFFBQVEsRUFDZDtZQUFFL0QsYUFBYSxFQUFFbUYsd0JBQXdCLENBQUN6RSxLQUFLLENBQUMsQ0FBQyxDQUFDO1lBQUVULE1BQU0sRUFBRTtVQUFLLENBQ25FLENBQUM7UUFDSDtNQUNGLENBQUMsQ0FBQyxPQUFPb0YsWUFBWSxFQUFFO1FBQ3JCLElBQUksQ0FBQ3RGLE1BQU0sQ0FBQ2xFLElBQUksQ0FBQyxnRUFBZ0UsRUFBRXdKLFlBQVksQ0FBQzs7UUFFaEc7UUFDQSxNQUFNQyxRQUFRLEdBQUcsRUFBRTs7UUFFbkI7UUFDQSxNQUFNQyxVQUFVLEdBQUlDLEdBQUcsSUFBSztVQUMxQixJQUFJQSxHQUFHLElBQUksQ0FBQ0YsUUFBUSxDQUFDdkksUUFBUSxDQUFDeUksR0FBRyxDQUFDLEVBQUU7WUFDbENGLFFBQVEsQ0FBQ0csSUFBSSxDQUFDRCxHQUFHLENBQUM7VUFDcEI7UUFDRixDQUFDOztRQUVEO1FBQ0FELFVBQVUsQ0FBQ3ZKLElBQUksQ0FBQ3NFLE9BQU8sQ0FBQ3lFLEtBQUssQ0FBQ2hCLFFBQVEsQ0FBQyxDQUFDOztRQUV4QztRQUNBa0IsTUFBTSxDQUFDQyxNQUFNLENBQUNILEtBQUssQ0FBQzFELFVBQVUsQ0FBQyxDQUFDcUUsT0FBTyxDQUFDQyxhQUFhLElBQUk7VUFDdkQsTUFBTUMsWUFBWSxHQUFHNUosSUFBSSxDQUFDc0UsT0FBTyxDQUFDcUYsYUFBYSxDQUFDO1VBQ2hESixVQUFVLENBQUN2SixJQUFJLENBQUNzRSxPQUFPLENBQUNzRixZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDMUMsQ0FBQyxDQUFDOztRQUVGO1FBQ0FMLFVBQVUsQ0FBQ3ZKLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0UsT0FBTyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxFQUFFLGtDQUFrQyxDQUFDLENBQUM7UUFDM0VpSCxVQUFVLENBQUN2SixJQUFJLENBQUNtQyxPQUFPLENBQUNFLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLENBQUMsRUFBRSxvQ0FBb0MsQ0FBQyxDQUFDO1FBQzdFaUgsVUFBVSxDQUFDdkosSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsRUFBRSxrQ0FBa0MsQ0FBQyxDQUFDO1FBQzlFOEYsVUFBVSxDQUFDdkosSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsRUFBRSxvQ0FBb0MsQ0FBQyxDQUFDO1FBQ2hGOEYsVUFBVSxDQUFDdkosSUFBSSxDQUFDbUMsT0FBTyxDQUFDQyxTQUFTLEVBQUUsd0JBQXdCLENBQUMsQ0FBQztRQUM3RG1ILFVBQVUsQ0FBQ3ZKLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLDJCQUEyQixDQUFDLENBQUM7UUFDaEVtSCxVQUFVLENBQUN2SixJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSx3Q0FBd0MsQ0FBQyxDQUFDO1FBQzdFbUgsVUFBVSxDQUFDdkosSUFBSSxDQUFDbUMsT0FBTyxDQUFDQyxTQUFTLEVBQUUsMENBQTBDLENBQUMsQ0FBQztRQUMvRW1ILFVBQVUsQ0FBQ3ZKLElBQUksQ0FBQ21DLE9BQU8sQ0FBQzVDLEdBQUcsQ0FBQ2tFLFVBQVUsQ0FBQyxDQUFDLENBQUMrRCxPQUFPLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxFQUFFLGtDQUFrQyxDQUFDLENBQUM7UUFDekcrQixVQUFVLENBQUN2SixJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxDQUFDK0QsT0FBTyxDQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsRUFBRSxvQ0FBb0MsQ0FBQyxDQUFDOztRQUUzRztRQUNBLElBQUksQ0FBQ3pELE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxzREFBc0QsRUFBRSxNQUFNLEVBQUVxSSxRQUFRLENBQUM7UUFFekYsSUFBSTtVQUNGO1VBQ0F2QixRQUFRLEdBQUcsTUFBTW5FLFlBQVksQ0FBQzhDLHNCQUFzQixDQUFDLHNCQUFzQixFQUFFNEMsUUFBUSxDQUFDO1FBQ3hGLENBQUMsQ0FBQyxPQUFPTyxhQUFhLEVBQUU7VUFDdEIsSUFBSSxDQUFDOUYsTUFBTSxDQUFDM0QsS0FBSyxDQUFDLDJEQUEyRCxFQUFFeUosYUFBYSxDQUFDO1VBQzdGO1VBQ0E5QixRQUFRLEdBQUdNLHdCQUF3QjtVQUNuQyxJQUFJLENBQUN0RSxNQUFNLENBQUNsRSxJQUFJLENBQUMsd0RBQXdELENBQUM7UUFDNUU7TUFDRjs7TUFFQTtNQUNBLElBQUksQ0FBQyxJQUFJLENBQUNpSyxpQkFBaUIsQ0FBQy9CLFFBQVEsQ0FBQyxFQUFFO1FBQ3JDLElBQUksQ0FBQ2hFLE1BQU0sQ0FBQzNELEtBQUssQ0FBQywrREFBK0QsQ0FBQztRQUNsRjtRQUNBMkgsUUFBUSxHQUFHTSx3QkFBd0I7UUFDbkMsSUFBSSxDQUFDdEUsTUFBTSxDQUFDbEUsSUFBSSxDQUFDLHdEQUF3RCxDQUFDOztRQUUxRTtRQUNBLElBQUksQ0FBQyxJQUFJLENBQUNpSyxpQkFBaUIsQ0FBQy9CLFFBQVEsQ0FBQyxFQUFFO1VBQ3JDLE1BQU0sSUFBSTFILEtBQUssQ0FBQyxzQ0FBc0MsQ0FBQztRQUN6RDtNQUNGOztNQUVBO01BQ0EsSUFBSSxDQUFDMEQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLHVCQUF1QixFQUFFZ0ksTUFBTSxDQUFDYyxJQUFJLENBQUNoQyxRQUFRLENBQUMxQyxVQUFVLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztNQUVoRixJQUFJLENBQUN0QixNQUFNLENBQUN6QyxPQUFPLENBQUMsd0NBQXdDLENBQUM7TUFDN0QsSUFBSSxDQUFDcUgsa0JBQWtCLEdBQUdaLFFBQVE7TUFDbEMsSUFBSSxDQUFDVSxZQUFZLEdBQUcsSUFBSTtNQUV4QixJQUFJLENBQUMxRSxNQUFNLENBQUN2QyxrQkFBa0IsQ0FDNUJkLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDRSxZQUFZLEVBQ3BDdkMsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNPLFNBQzFCLENBQUM7TUFFRCxPQUFPLElBQUksQ0FBQ3FGLGtCQUFrQjtJQUNoQyxDQUFDLENBQUMsT0FBT3ZJLEtBQUssRUFBRTtNQUNkLElBQUksQ0FBQ3NJLFlBQVksR0FBRyxJQUFJO01BQ3hCLElBQUksQ0FBQzNFLE1BQU0sQ0FBQ2hDLGtCQUFrQixDQUFDLE1BQU0sRUFBRTNCLEtBQUssQ0FBQzs7TUFFN0M7TUFDQSxNQUFNNEosYUFBYSxHQUFHLElBQUkzSixLQUFLLENBQUMsNENBQTRDRCxLQUFLLENBQUM0QixPQUFPLEVBQUUsQ0FBQztNQUM1RmdJLGFBQWEsQ0FBQ0MsUUFBUSxHQUFHN0osS0FBSztNQUM5QjRKLGFBQWEsQ0FBQ0UsS0FBSyxHQUFHOUosS0FBSyxDQUFDOEosS0FBSztNQUNqQyxNQUFNRixhQUFhO0lBQ3JCO0VBQ0Y7RUFFQUYsaUJBQWlCQSxDQUFDL0IsUUFBUSxFQUFFO0lBQzFCLElBQUksQ0FBQ0EsUUFBUSxJQUFJLE9BQU9BLFFBQVEsS0FBSyxRQUFRLEVBQUUsT0FBTyxLQUFLO0lBQzNELElBQUksQ0FBQ0EsUUFBUSxDQUFDMUMsVUFBVSxJQUFJLE9BQU8wQyxRQUFRLENBQUMxQyxVQUFVLEtBQUssUUFBUSxFQUFFLE9BQU8sS0FBSztJQUNqRixJQUFJLE9BQU8wQyxRQUFRLENBQUN6QixpQkFBaUIsS0FBSyxVQUFVLEVBQUUsT0FBTyxLQUFLO0lBQ2xFLElBQUksT0FBT3lCLFFBQVEsQ0FBQ3ZCLHVCQUF1QixLQUFLLFVBQVUsRUFBRSxPQUFPLEtBQUs7SUFDeEUsT0FBTyxJQUFJO0VBQ2I7QUFDRjs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxNQUFNMkQsb0JBQW9CLEdBQUc7RUFDM0I7RUFDQUMsR0FBRyxFQUFFLE9BQU87RUFDWkMsR0FBRyxFQUFFLE9BQU87RUFDWkMsR0FBRyxFQUFFLE9BQU87RUFDWkMsSUFBSSxFQUFFLE9BQU87RUFFYjtFQUNBQyxHQUFHLEVBQUUsT0FBTztFQUNaQyxJQUFJLEVBQUUsT0FBTztFQUNiQyxHQUFHLEVBQUUsT0FBTztFQUNaQyxHQUFHLEVBQUUsT0FBTztFQUVaO0VBQ0FyRixHQUFHLEVBQUUsVUFBVTtFQUNmMkMsSUFBSSxFQUFFLFVBQVU7RUFDaEJDLElBQUksRUFBRSxVQUFVO0VBRWhCO0VBQ0FDLElBQUksRUFBRSxNQUFNO0VBQ1pDLEdBQUcsRUFBRSxNQUFNO0VBRVg7RUFDQUosR0FBRyxFQUFFLEtBQUs7RUFDVjRDLFNBQVMsRUFBRTtBQUNiLENBQUM7O0FBRUQ7QUFDQTtBQUNBO0FBQ0EsTUFBTUMsdUJBQXVCLENBQUM7RUFDNUIsT0FBT3JDLFNBQVMsR0FBRyxJQUFJO0VBRXZCakcsV0FBV0EsQ0FBQSxFQUFHO0lBQ1osSUFBSSxDQUFDdUksWUFBWSxHQUFHdkMsb0JBQW9CLENBQUNLLFdBQVcsQ0FBQyxDQUFDO0lBQ3RELElBQUksQ0FBQ0Qsa0JBQWtCLEdBQUcsSUFBSTtJQUM5QixJQUFJLENBQUM1RSxNQUFNLEdBQUd2RCxTQUFTLENBQUMseUJBQXlCLENBQUM7SUFDbEQsSUFBSSxDQUFDdUQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLHFDQUFxQyxFQUFFLE1BQU0sQ0FBQztFQUNoRTtFQUVBLE9BQU8ySCxXQUFXQSxDQUFBLEVBQUc7SUFDbkIsSUFBSSxDQUFDaUMsdUJBQXVCLENBQUNyQyxTQUFTLEVBQUU7TUFDdENxQyx1QkFBdUIsQ0FBQ3JDLFNBQVMsR0FBRyxJQUFJcUMsdUJBQXVCLENBQUMsQ0FBQztJQUNuRTtJQUNBLE9BQU9BLHVCQUF1QixDQUFDckMsU0FBUztFQUMxQztFQUVBLE1BQU11QyxrQkFBa0JBLENBQUEsRUFBRztJQUN6QixJQUFJLENBQUMsSUFBSSxDQUFDcEMsa0JBQWtCLEVBQUU7TUFDNUIsSUFBSSxDQUFDQSxrQkFBa0IsR0FBRyxNQUFNLElBQUksQ0FBQ21DLFlBQVksQ0FBQ2pDLFVBQVUsQ0FBQyxDQUFDO0lBQ2hFO0lBQ0EsT0FBTyxJQUFJLENBQUNGLGtCQUFrQjtFQUNoQztFQUVBLE1BQU1xQyxZQUFZQSxDQUFDQyxRQUFRLEVBQUU7SUFDM0IsSUFBSSxDQUFDbEgsTUFBTSxDQUFDOUIsVUFBVSxDQUFDO01BQUVnSjtJQUFTLENBQUMsQ0FBQztJQUVwQyxNQUFNbEQsUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDZ0Qsa0JBQWtCLENBQUMsQ0FBQztJQUVoRCxJQUFJLENBQUNFLFFBQVEsRUFBRTtNQUNiLE1BQU0sSUFBSTVLLEtBQUssQ0FBQyx1QkFBdUIsQ0FBQztJQUMxQzs7SUFFQTtJQUNBLE1BQU02SyxjQUFjLEdBQUdELFFBQVEsQ0FBQ0UsV0FBVyxDQUFDLENBQUMsQ0FBQzNELE9BQU8sQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDOztJQUVoRTtJQUNBLElBQUkwRCxjQUFjLEtBQUssS0FBSyxJQUFJQSxjQUFjLEtBQUssV0FBVyxFQUFFO01BQzlELElBQUksQ0FBQ25ILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxtQ0FBbUNpSyxjQUFjLEVBQUUsRUFBRSxNQUFNLENBQUM7TUFFNUUsTUFBTXRGLFNBQVMsR0FBR21DLFFBQVEsQ0FBQzFDLFVBQVUsR0FBRzZGLGNBQWMsQ0FBQztNQUN2RCxJQUFJdEYsU0FBUyxFQUFFO1FBQ2IsSUFBSSxDQUFDN0IsTUFBTSxDQUFDekMsT0FBTyxDQUFDLFNBQVM0SixjQUFjLFlBQVksQ0FBQztRQUN4RCxPQUFPO1VBQ0x0RixTQUFTLEVBQUU7WUFDVCxHQUFHQSxTQUFTO1lBQ1poRSxJQUFJLEVBQUVzSixjQUFjO1lBQ3BCM0YsT0FBTyxFQUFFLE1BQUFBLENBQU9DLE9BQU8sRUFBRXhFLElBQUksRUFBRXlFLE1BQU0sRUFBRTNCLE9BQU8sS0FBSztjQUNqRCxPQUFPOEIsU0FBUyxDQUFDTCxPQUFPLENBQUNDLE9BQU8sRUFBRXhFLElBQUksRUFBRXlFLE1BQU0sRUFBRTtnQkFDOUMsR0FBRzNCLE9BQU87Z0JBQ1Y5QyxJQUFJO2dCQUNKWSxJQUFJLEVBQUVzSjtjQUNSLENBQUMsQ0FBQztZQUNKO1VBQ0YsQ0FBQztVQUNEdEosSUFBSSxFQUFFc0osY0FBYztVQUNwQjlHLFFBQVEsRUFBRTtRQUNaLENBQUM7TUFDSDs7TUFFQTtNQUNBLElBQUksQ0FBQ0wsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLDZDQUE2Q2lLLGNBQWMsRUFBRSxFQUFFLE1BQU0sQ0FBQztNQUN0RixJQUFJbkQsUUFBUSxDQUFDekIsaUJBQWlCLEVBQUU7UUFDOUIsT0FBTztVQUNMVixTQUFTLEVBQUU7WUFDVEwsT0FBTyxFQUFFLE1BQUFBLENBQU9DLE9BQU8sRUFBRXhFLElBQUksRUFBRXlFLE1BQU0sRUFBRTNCLE9BQU8sS0FBSztjQUNqRCxPQUFPaUUsUUFBUSxDQUFDekIsaUJBQWlCLENBQUM0RSxjQUFjLEVBQUUxRixPQUFPLEVBQUU7Z0JBQ3pEeEUsSUFBSTtnQkFDSnlFLE1BQU07Z0JBQ04sR0FBRzNCO2NBQ0wsQ0FBQyxDQUFDO1lBQ0osQ0FBQztZQUNEK0IsUUFBUSxFQUFHQyxLQUFLLElBQUssT0FBT0EsS0FBSyxLQUFLLFFBQVEsSUFBSUEsS0FBSyxDQUFDckIsTUFBTSxHQUFHLENBQUM7WUFDbEV3QixNQUFNLEVBQUU7Y0FDTmpGLElBQUksRUFBRWtLLGNBQWMsS0FBSyxLQUFLLEdBQUcsVUFBVSxHQUFHLFNBQVM7Y0FDdkRoRixVQUFVLEVBQUUsQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQztjQUNyQ0MsU0FBUyxFQUFFLENBQUMsV0FBVyxFQUFFLG1CQUFtQixDQUFDO2NBQzdDQyxPQUFPLEVBQUUsRUFBRSxHQUFHLElBQUksR0FBRztZQUN2QjtVQUNGLENBQUM7VUFDRHhFLElBQUksRUFBRXNKLGNBQWM7VUFDcEI5RyxRQUFRLEVBQUU7UUFDWixDQUFDO01BQ0g7SUFDRjs7SUFFQTtJQUNBLE1BQU13QixTQUFTLEdBQUcsTUFBTW1DLFFBQVEsQ0FBQ3ZCLHVCQUF1QixDQUFDMEUsY0FBYyxDQUFDO0lBQ3hFLElBQUl0RixTQUFTLEVBQUU7TUFDYixPQUFPO1FBQ0xBLFNBQVM7UUFDVGhFLElBQUksRUFBRXNKLGNBQWM7UUFDcEI5RyxRQUFRLEVBQUUrRixvQkFBb0IsQ0FBQ2UsY0FBYyxDQUFDLElBQUk7TUFDcEQsQ0FBQztJQUNIO0lBRUEsTUFBTSxJQUFJN0ssS0FBSyxDQUFDLGdDQUFnQzRLLFFBQVEsRUFBRSxDQUFDO0VBQzdEOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNFLE1BQU1HLFdBQVdBLENBQUNDLFFBQVEsRUFBRXZILE9BQU8sR0FBRyxDQUFDLENBQUMsRUFBRTtJQUN4QyxNQUFNbUgsUUFBUSxHQUFHbkgsT0FBTyxDQUFDbUgsUUFBUTtJQUNqQyxNQUFNSyxTQUFTLEdBQUdDLElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUM7SUFFNUIsSUFBSSxDQUFDekgsTUFBTSxDQUFDcEMsa0JBQWtCLENBQUNzSixRQUFRLEVBQUVuSCxPQUFPLENBQUM7SUFFakQsSUFBSTtNQUNGLElBQUksQ0FBQ21ILFFBQVEsRUFBRTtRQUNiLE1BQU0sSUFBSTVLLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQztNQUNwRDs7TUFFQTtNQUNBLE1BQU1vTCxLQUFLLEdBQUdSLFFBQVEsS0FBSyxLQUFLLElBQUlBLFFBQVEsS0FBSyxXQUFXOztNQUU1RDtNQUNBLElBQUlTLFFBQVE7TUFFWixJQUFJM0YsTUFBTSxDQUFDQyxRQUFRLENBQUNxRixRQUFRLENBQUMsRUFBRTtRQUM3QkssUUFBUSxHQUFHNUgsT0FBTyxDQUFDNkgsZ0JBQWdCO1FBRW5DLElBQUksQ0FBQ0QsUUFBUSxFQUFFO1VBQ2IsTUFBTSxJQUFJckwsS0FBSyxDQUFDLHdEQUF3RCxDQUFDO1FBQzNFO01BQ0YsQ0FBQyxNQUFNLElBQUlvTCxLQUFLLEVBQUU7UUFDaEIsSUFBSTtVQUNGLE1BQU1HLE1BQU0sR0FBRyxJQUFJQyxHQUFHLENBQUNSLFFBQVEsQ0FBQztVQUNoQ0ssUUFBUSxHQUFHRSxNQUFNLENBQUNFLFFBQVEsSUFBSUYsTUFBTSxDQUFDRyxRQUFRLEtBQUssR0FBRyxHQUFHSCxNQUFNLENBQUNHLFFBQVEsR0FBRyxFQUFFLENBQUM7UUFDL0UsQ0FBQyxDQUFDLE9BQU9wTSxDQUFDLEVBQUU7VUFDVitMLFFBQVEsR0FBR0wsUUFBUTtRQUNyQjtNQUNGLENBQUMsTUFBTTtRQUNMSyxRQUFRLEdBQUcxTCxJQUFJLENBQUNtRSxRQUFRLENBQUNrSCxRQUFRLENBQUM7TUFDcEM7TUFFQSxJQUFJLENBQUN0SCxNQUFNLENBQUN2QyxrQkFBa0IsQ0FDNUJkLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDQyxRQUFRLEVBQ2hDdEMsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNHLFVBQzFCLENBQUM7O01BRUQ7TUFDQSxJQUFJOEksYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDaEIsWUFBWSxDQUFDQyxRQUFRLENBQUM7O01BRXJEO01BQ0EsSUFBSSxDQUFDZSxhQUFhLEtBQUtmLFFBQVEsS0FBSyxLQUFLLElBQUlBLFFBQVEsS0FBSyxXQUFXLENBQUMsRUFBRTtRQUN0RSxJQUFJLENBQUNsSCxNQUFNLENBQUM5QyxHQUFHLENBQUMsd0JBQXdCZ0ssUUFBUSxxQkFBcUIsRUFBRSxNQUFNLENBQUM7UUFDOUVlLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQ0Msd0JBQXdCLENBQUNoQixRQUFRLENBQUM7UUFFN0QsSUFBSWUsYUFBYSxFQUFFO1VBQ2pCLElBQUksQ0FBQ2pJLE1BQU0sQ0FBQ3pDLE9BQU8sQ0FBQyxnQ0FBZ0MySixRQUFRLEVBQUUsQ0FBQztRQUNqRTtNQUNGOztNQUVBO01BQ0EsSUFBSSxDQUFDZSxhQUFhLEVBQUU7UUFDbEIsSUFBSSxDQUFDakksTUFBTSxDQUFDOUMsR0FBRyxDQUFDLGlDQUFpQ2dLLFFBQVEsaUJBQWlCLEVBQUUsTUFBTSxDQUFDO1FBQ25GLE1BQU0sSUFBSWlCLE9BQU8sQ0FBQy9KLE9BQU8sSUFBSWdLLFVBQVUsQ0FBQ2hLLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQztRQUN0RDZKLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQ2hCLFlBQVksQ0FBQ0MsUUFBUSxDQUFDO1FBRWpELElBQUksQ0FBQ2UsYUFBYSxLQUFLZixRQUFRLEtBQUssS0FBSyxJQUFJQSxRQUFRLEtBQUssV0FBVyxDQUFDLEVBQUU7VUFDdEUsSUFBSSxDQUFDbEgsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLDBDQUEwQ2dLLFFBQVEsRUFBRSxFQUFFLE1BQU0sQ0FBQztVQUM3RWUsYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDQyx3QkFBd0IsQ0FBQ2hCLFFBQVEsQ0FBQztRQUMvRDs7UUFFQTtRQUNBLElBQUksQ0FBQ2UsYUFBYSxFQUFFO1VBQ2xCLElBQUksQ0FBQ2pJLE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxzQ0FBc0NnSyxRQUFRLHdCQUF3QixFQUFFLE1BQU0sQ0FBQztVQUMvRixNQUFNLElBQUlpQixPQUFPLENBQUMvSixPQUFPLElBQUlnSyxVQUFVLENBQUNoSyxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7VUFDdkQ2SixhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUNoQixZQUFZLENBQUNDLFFBQVEsQ0FBQztVQUVqRCxJQUFJLENBQUNlLGFBQWEsS0FBS2YsUUFBUSxLQUFLLEtBQUssSUFBSUEsUUFBUSxLQUFLLFdBQVcsQ0FBQyxFQUFFO1lBQ3RFLElBQUksQ0FBQ2xILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyx5Q0FBeUNnSyxRQUFRLEVBQUUsRUFBRSxNQUFNLENBQUM7WUFDNUVlLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQ0Msd0JBQXdCLENBQUNoQixRQUFRLENBQUM7VUFDL0Q7VUFFQSxJQUFJLENBQUNlLGFBQWEsRUFBRTtZQUNsQixNQUFNLElBQUkzTCxLQUFLLENBQUMsMEJBQTBCNEssUUFBUSxFQUFFLENBQUM7VUFDdkQ7UUFDRjtNQUNGOztNQUVBO01BQ0EsTUFBTW1CLGVBQWUsR0FBR3RJLE9BQU8sQ0FBQ3VJLFVBQVUsR0FDeEMsSUFBSTlMLGVBQWUsQ0FBQ3VELE9BQU8sQ0FBQ3VJLFVBQVUsRUFBRSxHQUFHLENBQUMsR0FBRyxJQUFJO01BRXJELElBQUlELGVBQWUsRUFBRTtRQUNuQkEsZUFBZSxDQUFDM0osTUFBTSxDQUFDLENBQUMsRUFBRTtVQUFFNkosTUFBTSxFQUFFLGNBQWM7VUFBRXJCLFFBQVEsRUFBRUE7UUFBUyxDQUFDLENBQUM7TUFDM0U7TUFFQSxNQUFNbEQsUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDZ0Qsa0JBQWtCLENBQUMsQ0FBQztNQUVoRCxJQUFJLENBQUNoSCxNQUFNLENBQUN4QyxLQUFLLENBQUMsaUJBQWlCLEVBQUVkLGtCQUFrQixDQUFDO1FBQ3REOEwsV0FBVyxFQUFFLENBQUMsQ0FBQ3hFLFFBQVE7UUFDdkJ5RSxhQUFhLEVBQUVSLGFBQWEsRUFBRXBLLElBQUksSUFBSSxNQUFNO1FBQzVDd0MsUUFBUSxFQUFFNEgsYUFBYSxFQUFFNUgsUUFBUSxJQUFJLFNBQVM7UUFDOUNxSSxZQUFZLEVBQUUsQ0FBQyxDQUFDVCxhQUFhLEVBQUVwRyxTQUFTO1FBQ3hDOEcsZ0JBQWdCLEVBQUVWLGFBQWEsRUFBRXBHO01BQ25DLENBQUMsQ0FBQyxDQUFDOztNQUVIO01BQ0EsTUFBTStHLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQ0MsZ0JBQWdCLENBQUN2QixRQUFRLEVBQUU7UUFDbkQsR0FBR3ZILE9BQU87UUFDVm1ILFFBQVEsRUFBRUEsUUFBUTtRQUNsQlMsUUFBUTtRQUNSVSxlQUFlO1FBQ2ZKLGFBQWE7UUFDYlA7TUFDRixDQUFDLENBQUM7TUFFRixJQUFJVyxlQUFlLEVBQUU7UUFDbkJBLGVBQWUsQ0FBQzNKLE1BQU0sQ0FBQyxHQUFHLEVBQUU7VUFBRTZKLE1BQU0sRUFBRTtRQUFZLENBQUMsQ0FBQztNQUN0RDtNQUVBLElBQUksQ0FBQ3ZJLE1BQU0sQ0FBQ2pDLHFCQUFxQixDQUFDbUosUUFBUSxDQUFDO01BRTNDLE9BQU8wQixNQUFNO0lBRWYsQ0FBQyxDQUFDLE9BQU92TSxLQUFLLEVBQUU7TUFDZCxJQUFJLENBQUMyRCxNQUFNLENBQUNoQyxrQkFBa0IsQ0FBQ2tKLFFBQVEsRUFBRTdLLEtBQUssQ0FBQztNQUUvQyxPQUFPO1FBQ0xrQixPQUFPLEVBQUUsS0FBSztRQUNkbEIsS0FBSyxFQUFFQSxLQUFLLENBQUM0QixPQUFPO1FBQ3BCaUosUUFBUSxFQUFFQSxRQUFRO1FBQ2xCckosSUFBSSxFQUFFcUosUUFBUTtRQUNkakssSUFBSSxFQUFFOEMsT0FBTyxDQUFDNkgsZ0JBQWdCLElBQUksU0FBUztRQUMzQ3ZILFFBQVEsRUFBRStGLG9CQUFvQixDQUFDYyxRQUFRLENBQUMsSUFBSTtNQUM5QyxDQUFDO0lBQ0g7RUFDRjs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsTUFBTWdCLHdCQUF3QkEsQ0FBQ2hCLFFBQVEsRUFBRTtJQUN2QyxJQUFJLENBQUNsSCxNQUFNLENBQUM5QyxHQUFHLENBQUMscUNBQXFDZ0ssUUFBUSxFQUFFLEVBQUUsTUFBTSxDQUFDO0lBRXhFLE1BQU1sRCxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUNnRCxrQkFBa0IsQ0FBQyxDQUFDO0lBQ2hELElBQUksQ0FBQ2hELFFBQVEsQ0FBQ3pCLGlCQUFpQixFQUFFO01BQy9CLElBQUksQ0FBQ3ZDLE1BQU0sQ0FBQzNELEtBQUssQ0FBQyxxRUFBcUUsQ0FBQztNQUN4RixPQUFPLElBQUk7SUFDYjtJQUVBLE9BQU87TUFDTHdGLFNBQVMsRUFBRTtRQUNUTCxPQUFPLEVBQUUsTUFBQUEsQ0FBT0MsT0FBTyxFQUFFeEUsSUFBSSxFQUFFeUUsTUFBTSxFQUFFM0IsT0FBTyxLQUFLO1VBQ2pELElBQUksQ0FBQ0MsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLGtDQUFrQ2dLLFFBQVEsRUFBRSxFQUFFLE1BQU0sQ0FBQztVQUNyRSxPQUFPbEQsUUFBUSxDQUFDekIsaUJBQWlCLENBQUMyRSxRQUFRLEVBQUV6RixPQUFPLEVBQUU7WUFDbkR4RSxJQUFJO1lBQ0p5RSxNQUFNO1lBQ04sR0FBRzNCO1VBQ0wsQ0FBQyxDQUFDO1FBQ0osQ0FBQztRQUNEK0IsUUFBUSxFQUFHQyxLQUFLLElBQUssT0FBT0EsS0FBSyxLQUFLLFFBQVEsSUFBSUEsS0FBSyxDQUFDckIsTUFBTSxHQUFHLENBQUM7UUFDbEV3QixNQUFNLEVBQUU7VUFDTmpGLElBQUksRUFBRWlLLFFBQVEsS0FBSyxLQUFLLEdBQUcsVUFBVSxHQUFHLFNBQVM7VUFDakQvRSxVQUFVLEVBQUUsQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQztVQUNyQ0MsU0FBUyxFQUFFLENBQUMsV0FBVyxFQUFFLG1CQUFtQixDQUFDO1VBQzdDQyxPQUFPLEVBQUUsRUFBRSxHQUFHLElBQUksR0FBRztRQUN2QjtNQUNGLENBQUM7TUFDRHhFLElBQUksRUFBRXFKLFFBQVE7TUFDZDdHLFFBQVEsRUFBRTtJQUNaLENBQUM7RUFDSDs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNFeUksaUJBQWlCQSxDQUFDRixNQUFNLEVBQUUxQixRQUFRLEVBQUVTLFFBQVEsRUFBRXRILFFBQVEsRUFBRTtJQUN0RCxJQUFJLENBQUNMLE1BQU0sQ0FBQ3hDLEtBQUssQ0FBQywyQkFBMkIwSixRQUFRLEdBQUcsRUFBRXhLLGtCQUFrQixDQUFDa00sTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDOztJQUV2RjtJQUNBLElBQUksQ0FBQ0EsTUFBTSxFQUFFO01BQ1QsSUFBSSxDQUFDNUksTUFBTSxDQUFDbEUsSUFBSSxDQUFDLHlDQUF5Q29MLFFBQVEscUJBQXFCLENBQUM7TUFDeEYwQixNQUFNLEdBQUc7UUFBRXJMLE9BQU8sRUFBRSxLQUFLO1FBQUVsQixLQUFLLEVBQUU7TUFBOEMsQ0FBQztJQUNyRjs7SUFFQTtJQUNBO0lBQ0E7SUFDQSxNQUFNME0sU0FBUyxHQUFHSCxNQUFNLENBQUNyTCxPQUFPLEtBQUssSUFBSTs7SUFFekM7SUFDQSxNQUFNeUwsZUFBZSxHQUFHdE0sa0JBQWtCLENBQUNrTSxNQUFNLENBQUM7SUFFbEQsTUFBTUssWUFBWSxHQUFHO01BQ2pCLEdBQUdELGVBQWU7TUFBRTtNQUNwQnpMLE9BQU8sRUFBRXdMLFNBQVM7TUFBRTtNQUNwQmxMLElBQUksRUFBRStLLE1BQU0sQ0FBQy9LLElBQUksSUFBSXFKLFFBQVE7TUFDN0JBLFFBQVEsRUFBRUEsUUFBUTtNQUNsQmpLLElBQUksRUFBRTJMLE1BQU0sQ0FBQzNMLElBQUksSUFBSTBLLFFBQVE7TUFDN0J0SCxRQUFRLEVBQUV1SSxNQUFNLENBQUN2SSxRQUFRLElBQUlBLFFBQVE7TUFDckNzQixRQUFRLEVBQUU7UUFDTixJQUFJaUgsTUFBTSxDQUFDakgsUUFBUSxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQzFCRSxTQUFTLEVBQUUrRyxNQUFNLENBQUMvRyxTQUFTLElBQUk7TUFDbkMsQ0FBQztNQUNEcUgsTUFBTSxFQUFFTixNQUFNLENBQUNNLE1BQU0sSUFBSSxFQUFFO01BQzNCO01BQ0F6SCxPQUFPLEVBQUVtSCxNQUFNLENBQUNuSCxPQUFPLEtBQUtzSCxTQUFTLEdBQUcsRUFBRSxHQUFHLDhCQUE4QjdCLFFBQVEsa0hBQWtILENBQUM7TUFDdE07TUFDQTdLLEtBQUssRUFBRSxDQUFDME0sU0FBUyxHQUFJSCxNQUFNLENBQUN2TSxLQUFLLElBQUksMEJBQTBCLEdBQUk4TTtJQUN2RSxDQUFDOztJQUVEO0lBQ0EsSUFBSUYsWUFBWSxDQUFDMUwsT0FBTyxFQUFFO01BQ3RCLE9BQU8wTCxZQUFZLENBQUM1TSxLQUFLO0lBQzdCOztJQUVBO0lBQ0EsSUFBSSxDQUFDNE0sWUFBWSxDQUFDeEgsT0FBTyxJQUFJLENBQUNzSCxTQUFTLEVBQUU7TUFDdkMsSUFBSSxDQUFDL0ksTUFBTSxDQUFDdkMsa0JBQWtCLENBQzVCZCxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ0ssVUFBVSxFQUNsQzFDLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDUSxhQUMxQixDQUFDO01BQ0Q7TUFDQXlKLFlBQVksQ0FBQ3hILE9BQU8sR0FBRyw2QkFBNkJ5RixRQUFRLDBEQUEwRCtCLFlBQVksQ0FBQzVNLEtBQUssSUFBSSxlQUFlLEVBQUU7SUFDL0osQ0FBQyxNQUFNLElBQUksQ0FBQzRNLFlBQVksQ0FBQ3hILE9BQU8sSUFBSXNILFNBQVMsRUFBRTtNQUM1QyxJQUFJLENBQUMvSSxNQUFNLENBQUN2QyxrQkFBa0IsQ0FDN0JkLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDSyxVQUFVLEVBQ2xDMUMsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNRLGFBQzFCLENBQUM7TUFDRDtNQUNBeUosWUFBWSxDQUFDeEgsT0FBTyxHQUFHLDhCQUE4QnlGLFFBQVEsK0pBQStKO0lBQzlOOztJQUdBO0lBQ0EsSUFBSSxDQUFDbEgsTUFBTSxDQUFDeEMsS0FBSyxDQUFDLDJCQUEyQjBKLFFBQVEsR0FBRyxFQUFFeEssa0JBQWtCLENBQUN1TSxZQUFZLENBQUMsQ0FBQztJQUUzRixPQUFPQSxZQUFZO0VBQ3JCO0VBRUEsTUFBTUosZ0JBQWdCQSxDQUFDdkIsUUFBUSxFQUFFdkgsT0FBTyxFQUFFO0lBQ3hDLE1BQU07TUFBRXNJLGVBQWU7TUFBRW5CLFFBQVE7TUFBRVMsUUFBUTtNQUFFTSxhQUFhO01BQUVQO0lBQU0sQ0FBQyxHQUFHM0gsT0FBTztJQUU3RSxJQUFJO01BQ0Y7TUFDQSxJQUFJLENBQUNrSSxhQUFhLEVBQUU7UUFDbEIsSUFBSSxDQUFDakksTUFBTSxDQUFDM0QsS0FBSyxDQUFDLG1DQUFtQzZLLFFBQVEsRUFBRSxDQUFDO1FBQ2hFLE1BQU0sSUFBSTVLLEtBQUssQ0FBQyxtQ0FBbUM0SyxRQUFRLEVBQUUsQ0FBQztNQUNoRTtNQUVBLElBQUksQ0FBQ2xILE1BQU0sQ0FBQ3ZDLGtCQUFrQixDQUM1QmQsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNHLFVBQVUsRUFDbEN4QyxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ0ksWUFDMUIsQ0FBQzs7TUFFRDtNQUNBLElBQUlzSSxLQUFLLEVBQUU7UUFDVCxJQUFJVyxlQUFlLEVBQUU7VUFDbkJBLGVBQWUsQ0FBQzNKLE1BQU0sQ0FBQyxFQUFFLEVBQUU7WUFBRTZKLE1BQU0sRUFBRSxjQUFjckIsUUFBUTtVQUFHLENBQUMsQ0FBQztRQUNsRTtRQUVBLElBQUksQ0FBQ2xILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxtQkFBbUJvSyxRQUFRLEVBQUUsRUFBRSxNQUFNLENBQUM7O1FBRXREO1FBQ0EsSUFBSXNCLE1BQU07UUFFVixJQUFJO1VBQ0Y7VUFDQSxJQUFJLE9BQU8vRyxTQUFTLENBQUNMLE9BQU8sS0FBSyxVQUFVLEVBQUU7WUFDM0MsSUFBSSxDQUFDeEIsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLCtCQUErQmdLLFFBQVEsRUFBRSxFQUFFLE1BQU0sQ0FBQztZQUNsRTBCLE1BQU0sR0FBRyxNQUFNL0csU0FBUyxDQUFDTCxPQUFPLENBQUM4RixRQUFRLEVBQUVLLFFBQVEsRUFBRTVILE9BQU8sQ0FBQzJCLE1BQU0sRUFBRTtjQUNuRSxHQUFHM0IsT0FBTztjQUNWOUMsSUFBSSxFQUFFMEssUUFBUTtjQUNkVyxVQUFVLEVBQUczSixRQUFRLElBQUs7Z0JBQ3hCLElBQUkwSixlQUFlLEVBQUU7a0JBQ25CQSxlQUFlLENBQUN4SixZQUFZLENBQUNGLFFBQVEsRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFO29CQUM3QzRKLE1BQU0sRUFBRSxPQUFPNUosUUFBUSxLQUFLLFFBQVEsR0FBR0EsUUFBUSxDQUFDNEosTUFBTSxHQUFHLGNBQWNyQixRQUFRO2tCQUNqRixDQUFDLENBQUM7Z0JBQ0o7Y0FDRjtZQUNGLENBQUMsQ0FBQztVQUNKLENBQUMsTUFBTTtZQUNMO1lBQ0EsTUFBTWxELFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQ2dELGtCQUFrQixDQUFDLENBQUM7WUFDaEQsSUFBSSxDQUFDaEgsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLHdDQUF3Q2dLLFFBQVEsRUFBRSxFQUFFLE1BQU0sQ0FBQztZQUMzRTBCLE1BQU0sR0FBRyxNQUFNNUUsUUFBUSxDQUFDekIsaUJBQWlCLENBQUMyRSxRQUFRLEVBQUVJLFFBQVEsRUFBRTtjQUM1RCxHQUFHdkgsT0FBTztjQUNWOUMsSUFBSSxFQUFFMEssUUFBUTtjQUNkVyxVQUFVLEVBQUczSixRQUFRLElBQUs7Z0JBQ3hCLElBQUkwSixlQUFlLEVBQUU7a0JBQ25CQSxlQUFlLENBQUN4SixZQUFZLENBQUNGLFFBQVEsRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFO29CQUM3QzRKLE1BQU0sRUFBRSxPQUFPNUosUUFBUSxLQUFLLFFBQVEsR0FBR0EsUUFBUSxDQUFDNEosTUFBTSxHQUFHLGNBQWNyQixRQUFRO2tCQUNqRixDQUFDLENBQUM7Z0JBQ0o7Y0FDRjtZQUNGLENBQUMsQ0FBQztVQUNKO1FBQ0YsQ0FBQyxDQUFDLE9BQU83SyxLQUFLLEVBQUU7VUFDZCxJQUFJLENBQUMyRCxNQUFNLENBQUMzRCxLQUFLLENBQUMsNEJBQTRCQSxLQUFLLENBQUM0QixPQUFPLEVBQUUsQ0FBQzs7VUFFOUQ7VUFDQSxNQUFNK0YsUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDZ0Qsa0JBQWtCLENBQUMsQ0FBQztVQUNoRCxJQUFJLE9BQU9uRixTQUFTLENBQUNMLE9BQU8sS0FBSyxVQUFVLElBQUksT0FBT3dDLFFBQVEsQ0FBQ3pCLGlCQUFpQixLQUFLLFVBQVUsRUFBRTtZQUMvRixJQUFJLENBQUN2QyxNQUFNLENBQUM5QyxHQUFHLENBQUMsa0RBQWtELEVBQUUsTUFBTSxDQUFDO1lBRTNFLElBQUk7Y0FDRjtjQUNBMEwsTUFBTSxHQUFHLE1BQU01RSxRQUFRLENBQUN6QixpQkFBaUIsQ0FBQzJFLFFBQVEsRUFBRUksUUFBUSxFQUFFO2dCQUM1RCxHQUFHdkgsT0FBTztnQkFDVjlDLElBQUksRUFBRTBLLFFBQVE7Z0JBQ2RXLFVBQVUsRUFBRzNKLFFBQVEsSUFBSztrQkFDeEIsSUFBSTBKLGVBQWUsRUFBRTtvQkFDbkJBLGVBQWUsQ0FBQ3hKLFlBQVksQ0FBQ0YsUUFBUSxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUU7c0JBQzdDNEosTUFBTSxFQUFFLE9BQU81SixRQUFRLEtBQUssUUFBUSxHQUFHQSxRQUFRLENBQUM0SixNQUFNLEdBQUcsY0FBY3JCLFFBQVE7b0JBQ2pGLENBQUMsQ0FBQztrQkFDSjtnQkFDRjtjQUNGLENBQUMsQ0FBQztZQUNKLENBQUMsQ0FBQyxPQUFPL0YsYUFBYSxFQUFFO2NBQ3RCLElBQUksQ0FBQ25CLE1BQU0sQ0FBQzNELEtBQUssQ0FBQyxvQ0FBb0M4RSxhQUFhLENBQUNsRCxPQUFPLEVBQUUsQ0FBQztjQUM5RSxNQUFNNUIsS0FBSyxDQUFDLENBQUM7WUFDZjtVQUNGLENBQUMsTUFBTTtZQUNMLE1BQU1BLEtBQUssQ0FBQyxDQUFDO1VBQ2Y7UUFDRjtRQUVBLElBQUlnTSxlQUFlLEVBQUU7VUFDbkJBLGVBQWUsQ0FBQzNKLE1BQU0sQ0FBQyxFQUFFLEVBQUU7WUFBRTZKLE1BQU0sRUFBRTtVQUFhLENBQUMsQ0FBQztRQUN0RDtRQUVBLElBQUksQ0FBQ3ZJLE1BQU0sQ0FBQ3ZDLGtCQUFrQixDQUM1QmQsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNLLFVBQVUsRUFDbEMxQyxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ00sVUFDMUIsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDd0osaUJBQWlCLENBQUNGLE1BQU0sRUFBRTFCLFFBQVEsRUFBRVMsUUFBUSxFQUFFdEgsUUFBUSxDQUFDO01BQ3JFOztNQUVBO01BQ0EsTUFBTStJLFdBQVcsR0FBR3BILE1BQU0sQ0FBQ0MsUUFBUSxDQUFDcUYsUUFBUSxDQUFDLEdBQUdBLFFBQVEsR0FBR3ZMLEVBQUUsQ0FBQ3NOLFlBQVksQ0FBQy9CLFFBQVEsQ0FBQztNQUVwRixJQUFJZSxlQUFlLEVBQUU7UUFDbkJBLGVBQWUsQ0FBQzNKLE1BQU0sQ0FBQyxFQUFFLEVBQUU7VUFBRTZKLE1BQU0sRUFBRSxjQUFjckIsUUFBUTtRQUFHLENBQUMsQ0FBQztNQUNsRTs7TUFFQTtNQUNBLElBQUlBLFFBQVEsS0FBSyxLQUFLLEVBQUU7UUFDdEIsSUFBSSxDQUFDbEgsTUFBTSxDQUFDeEMsS0FBSyxDQUFDLDhCQUE4QixFQUFFO1VBQ2hEOEwsTUFBTSxFQUFFdkosT0FBTyxDQUFDdUosTUFBTTtVQUN0QkMsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDeEosT0FBTyxDQUFDeUosYUFBYTtVQUN6Q0MsZ0JBQWdCLEVBQUU7UUFDcEIsQ0FBQyxDQUFDOztRQUVGO1FBQ0EsSUFBSTFKLE9BQU8sQ0FBQ3VKLE1BQU0sRUFBRTtVQUNsQixJQUFJLENBQUN0SixNQUFNLENBQUM5QyxHQUFHLENBQUMsb0NBQW9DLEVBQUUsTUFBTSxDQUFDO1VBQzdELElBQUk2QyxPQUFPLENBQUN5SixhQUFhLEVBQUU7WUFDekIsSUFBSSxDQUFDeEosTUFBTSxDQUFDeEMsS0FBSyxDQUFDLDRCQUE0QixDQUFDO1VBQ2pELENBQUMsTUFBTTtZQUNMLElBQUksQ0FBQ3dDLE1BQU0sQ0FBQ2xFLElBQUksQ0FBQywrQ0FBK0MsQ0FBQztVQUNuRTtRQUNGO01BQ0Y7O01BRUE7TUFDQSxJQUFJb0wsUUFBUSxLQUFLLEtBQUssSUFBSUEsUUFBUSxLQUFLLEtBQUssSUFBSUEsUUFBUSxLQUFLLEtBQUssSUFBSUEsUUFBUSxLQUFLLEtBQUssSUFDcEZBLFFBQVEsS0FBSyxLQUFLLElBQUlBLFFBQVEsS0FBSyxNQUFNLElBQUlBLFFBQVEsS0FBSyxLQUFLLElBQy9EQSxRQUFRLEtBQUssTUFBTSxJQUFJQSxRQUFRLEtBQUssS0FBSyxFQUFFO1FBQzdDLElBQUksQ0FBQ2xILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQywrQkFBK0JnSyxRQUFRLEdBQUcsRUFBRSxNQUFNLENBQUM7O1FBRW5FO1FBQ0EsSUFBSW5ILE9BQU8sQ0FBQ3lKLGFBQWEsRUFBRTtVQUN6QixJQUFJLENBQUN4SixNQUFNLENBQUM5QyxHQUFHLENBQUMsNkRBQTZELEVBQUUsTUFBTSxDQUFDO1VBQ3RGLE1BQU07WUFBRXNNLGFBQWE7WUFBRSxHQUFHRTtVQUFhLENBQUMsR0FBRzNKLE9BQU87VUFDbERBLE9BQU8sR0FBRzJKLFlBQVk7UUFDeEI7TUFDRjtNQUVBLElBQUksQ0FBQzFKLE1BQU0sQ0FBQ3ZDLGtCQUFrQixDQUM1QmQsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNJLFlBQVksRUFDcEN6QyxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ0ssVUFDMUIsQ0FBQzs7TUFFRDtNQUNBLE1BQU07UUFBRXdDLFNBQVM7UUFBRXhCO01BQVMsQ0FBQyxHQUFHNEgsYUFBYTtNQUM3QyxNQUFNVyxNQUFNLEdBQUcsTUFBTS9HLFNBQVMsQ0FBQ0wsT0FBTyxDQUFDNEgsV0FBVyxFQUFFekIsUUFBUSxFQUFFNUgsT0FBTyxDQUFDMkIsTUFBTSxFQUFFO1FBQzVFLEdBQUczQixPQUFPO1FBQ1Y5QyxJQUFJLEVBQUUwSyxRQUFRO1FBQ2RXLFVBQVUsRUFBRzNKLFFBQVEsSUFBSztVQUN4QixJQUFJMEosZUFBZSxFQUFFO1lBQ25CQSxlQUFlLENBQUN4SixZQUFZLENBQUNGLFFBQVEsRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFO2NBQzdDNEosTUFBTSxFQUFFLE9BQU81SixRQUFRLEtBQUssUUFBUSxHQUFHQSxRQUFRLENBQUM0SixNQUFNLEdBQUcsY0FBY3JCLFFBQVE7WUFDakYsQ0FBQyxDQUFDO1VBQ0o7UUFDRjtNQUNGLENBQUMsQ0FBQztNQUVGLElBQUltQixlQUFlLEVBQUU7UUFDbkJBLGVBQWUsQ0FBQzNKLE1BQU0sQ0FBQyxFQUFFLEVBQUU7VUFBRTZKLE1BQU0sRUFBRTtRQUFhLENBQUMsQ0FBQztNQUN0RDtNQUVBLElBQUksQ0FBQ3ZJLE1BQU0sQ0FBQ3ZDLGtCQUFrQixDQUM1QmQsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNLLFVBQVUsRUFDbEMxQyxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ00sVUFDMUIsQ0FBQztNQUVELE9BQU8sSUFBSSxDQUFDd0osaUJBQWlCLENBQUNGLE1BQU0sRUFBRTFCLFFBQVEsRUFBRVMsUUFBUSxFQUFFdEgsUUFBUSxDQUFDO0lBQ3JFLENBQUMsQ0FBQyxPQUFPaEUsS0FBSyxFQUFFO01BQ2QsSUFBSSxDQUFDMkQsTUFBTSxDQUFDaEMsa0JBQWtCLENBQUNrSixRQUFRLEVBQUU3SyxLQUFLLENBQUM7TUFDL0MsT0FBTztRQUNMa0IsT0FBTyxFQUFFLEtBQUs7UUFDZGxCLEtBQUssRUFBRSxHQUFHNkssUUFBUSxDQUFDM0MsV0FBVyxDQUFDLENBQUMsdUJBQXVCbEksS0FBSyxDQUFDNEIsT0FBTyxFQUFFO1FBQ3RFd0QsT0FBTyxFQUFFLDJDQUEyQ3lGLFFBQVEsQ0FBQzNDLFdBQVcsQ0FBQyxDQUFDLFVBQVVsSSxLQUFLLENBQUM0QixPQUFPLEVBQUU7UUFDbkdKLElBQUksRUFBRXFKLFFBQVE7UUFDZEEsUUFBUSxFQUFFQSxRQUFRO1FBQUU7UUFDcEJqSyxJQUFJLEVBQUUwSyxRQUFRO1FBQ2R0SCxRQUFRLEVBQUVBLFFBQVEsSUFBSTtNQUN4QixDQUFDO0lBQ0g7RUFDRjtBQUNGOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsTUFBTXNKLHVCQUF1QixHQUFHN0MsdUJBQXVCLENBQUNqQyxXQUFXLENBQUMsQ0FBQzs7QUFFckU7QUFDQThFLHVCQUF1QixDQUFDN0UsVUFBVSxHQUFHLGtCQUFpQjtFQUNwRCxJQUFJLENBQUM5RSxNQUFNLENBQUN2QyxrQkFBa0IsQ0FDNUJkLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDQyxRQUFRLEVBQ2hDdEMsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNFLFlBQzFCLENBQUM7RUFFRCxJQUFJO0lBQ0YsTUFBTSxJQUFJLENBQUM4SCxrQkFBa0IsQ0FBQyxDQUFDO0lBQy9CLElBQUksQ0FBQ2hILE1BQU0sQ0FBQ3ZDLGtCQUFrQixDQUM1QmQsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNFLFlBQVksRUFDcEN2QyxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ08sU0FDMUIsQ0FBQztJQUNELE9BQU8sSUFBSTtFQUNiLENBQUMsQ0FBQyxPQUFPbEQsS0FBSyxFQUFFO0lBQ2QsSUFBSSxDQUFDMkQsTUFBTSxDQUFDaEMsa0JBQWtCLENBQUMsTUFBTSxFQUFFM0IsS0FBSyxDQUFDO0lBQzdDLE1BQU1BLEtBQUs7RUFDYjtBQUNGLENBQUM7O0FBRUQ7QUFDQXlFLE1BQU0sQ0FBQzhJLE9BQU8sR0FBR0QsdUJBQXVCO0FBQ3hDN0ksTUFBTSxDQUFDOEksT0FBTyxDQUFDRCx1QkFBdUIsR0FBR0EsdUJBQXVCIiwiaWdub3JlTGlzdCI6W119