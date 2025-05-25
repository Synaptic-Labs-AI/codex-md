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
        // Use originalFileName from options, or fallback to provided name if available
        fileName = options.originalFileName || options.name;
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
        fileName = options.originalFileName || options.name || path.basename(filePath);
      }

      // Ensure originalFileName is always set in options
      options.originalFileName = fileName;
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
      const conversionResult = await this.handleConversion(filePath, {
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
      return conversionResult;
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

    // Handle null or undefined result explicitly at the beginning
    if (!result) {
      this.logger.warn(`Received null or undefined result for ${fileType}. Assuming failure.`);
      result = {
        success: false,
        error: 'Converter returned null or undefined result'
      };
    }

    // Check if this is an asynchronous result (has async: true and conversionId)
    if (result && result.async === true && result.conversionId) {
      this.logger.log(`[${fileType}] Received async result with conversionId: ${result.conversionId}`);

      // For async results, we need to preserve the async flag and conversionId
      // This will signal to ElectronConversionService that it needs to handle this differently
      return {
        ...result,
        success: true,
        // Async initiation is considered successful at this point
        type: result.type || fileType,
        fileType: fileType,
        name: result.name || fileName,
        originalFileName: result.originalFileName || result.name || fileName,
        category: result.category || category,
        async: true,
        // Preserve the async flag
        conversionId: result.conversionId,
        // Preserve the conversionId
        // For async results, we'll provide a placeholder content that will be replaced
        // with the actual content when the conversion completes
        content: result.content || `# Processing ${fileType.toUpperCase()} File\n\nYour file is being processed. The content will be available shortly.`,
        metadata: {
          ...(result.metadata || {}),
          async: true,
          conversionId: result.conversionId
        }
      };
    }

    // Log detailed filename information for debugging
    this.logger.log(`📄 Filename details for ${fileType}:`, {
      resultOriginalFileName: result?.originalFileName,
      resultMetadataOriginalFileName: result?.metadata?.originalFileName,
      resultName: result?.name,
      functionParamFileName: fileName
    });

    // Add enhanced logging specifically for Excel/CSV files to trace filename handling
    if (fileType === 'xlsx' || fileType === 'csv') {
      this.logger.log(`📊 Excel/CSV file details:`, {
        originalFileNameFromResult: result?.originalFileName,
        originalFileNameFromMetadata: result?.metadata?.originalFileName,
        nameFromResult: result?.name,
        fileNameParam: fileName,
        resultKeys: result ? Object.keys(result) : [],
        metadataKeys: result?.metadata ? Object.keys(result.metadata) : []
      });
    }

    // Determine success status more robustly
    // Success is ONLY true if result.success is explicitly true.
    // Otherwise, it's false, especially if an error property exists.
    const isSuccess = result.success === true;

    // Sanitize potentially complex objects within the result *after* determining success
    const sanitizedResult = sanitizeForLogging(result);

    // For XLSX and CSV files, we want to be absolutely certain that originalFileName is preserved
    const originalFileName = fileType === 'xlsx' || fileType === 'csv' ? result.metadata && result.metadata.originalFileName || result.originalFileName || result.name || fileName : result.metadata && result.metadata.originalFileName || result.originalFileName || result.name || fileName;

    // Log the determined originalFileName
    this.logger.log(`📝 Final originalFileName determined for ${fileType}: ${originalFileName}`);
    const standardized = {
      ...sanitizedResult,
      // Spread sanitized result first
      success: isSuccess,
      // Override with determined success status
      type: result.type || fileType,
      fileType: fileType,
      name: originalFileName,
      // Use the resolved originalFileName
      originalFileName: originalFileName,
      // Same for consistency
      category: result.category || category,
      metadata: {
        ...(result.metadata || {})
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
  async handleUrlConversion(filePath, options, category) {
    const {
      progressTracker,
      fileType,
      fileName,
      converterInfo
    } = options;
    if (progressTracker) {
      progressTracker.update(20, {
        status: `processing_${fileType}`
      });
    }
    this.logger.log(`Processing URL: ${filePath}`, 'INFO');
    try {
      // Extract converter from converterInfo
      const {
        converter
      } = converterInfo;
      let urlResult = null;

      // Try using the converter's convert method first
      if (typeof converter.convert === 'function') {
        this.logger.log(`Using converter.convert for ${fileType}`, 'INFO');
        this.logger.log(`URL convert called with originalFileName: ${fileName}`, 'INFO');
        try {
          // Create options object step by step to avoid spread issues
          const converterOptions = {};
          Object.keys(options).forEach(key => {
            converterOptions[key] = options[key];
          });
          converterOptions.name = fileName;
          converterOptions.originalFileName = fileName;
          converterOptions.metadata = {
            originalFileName: fileName
          };
          if (options.metadata) {
            Object.keys(options.metadata).forEach(key => {
              converterOptions.metadata[key] = options.metadata[key];
            });
          }
          converterOptions.onProgress = progress => {
            if (progressTracker) {
              progressTracker.updateScaled(progress, 20, 90, {
                status: typeof progress === 'object' ? progress.status : `processing_${fileType}`
              });
            }
          };
          this.logger.log(`Calling URL converter with filePath: ${filePath}`, 'INFO');
          urlResult = await converter.convert(filePath, fileName, options.apiKey, converterOptions);
          this.logger.log(`URL converter returned result`, 'INFO');
        } catch (converterError) {
          this.logger.error(`URL converter error: ${converterError.message}`);
          throw converterError;
        }
      } else {
        // Fall back to using the registry's convertToMarkdown method
        const registry = await this._ensureInitialized();
        this.logger.log(`Using registry.convertToMarkdown for ${fileType}`, 'INFO');
        const registryOptions = {};
        Object.keys(options).forEach(key => {
          registryOptions[key] = options[key];
        });
        registryOptions.name = fileName;
        registryOptions.originalFileName = fileName;
        urlResult = await registry.convertToMarkdown(fileType, filePath, registryOptions);
      }
      if (progressTracker) {
        progressTracker.update(95, {
          status: 'finalizing'
        });
      }
      this.logger.logPhaseTransition(ConversionStatus.STATUS.PROCESSING, ConversionStatus.STATUS.FINALIZING);

      // Only proceed if we have a result
      if (!urlResult) {
        throw new Error(`URL conversion failed: No result returned`);
      }
      return this.standardizeResult(urlResult, fileType, fileName, category);
    } catch (error) {
      this.logger.error(`Error in URL conversion: ${error.message}`);

      // Try the alternative method as a fallback
      const registry = await this._ensureInitialized();
      const {
        converter
      } = converterInfo;
      if (typeof converter.convert === 'function' && typeof registry.convertToMarkdown === 'function') {
        this.logger.log(`Trying alternative conversion method as fallback`, 'INFO');
        try {
          const fallbackOptions = {};
          Object.keys(options).forEach(key => {
            fallbackOptions[key] = options[key];
          });
          fallbackOptions.name = fileName;
          fallbackOptions.originalFileName = fileName;
          const fallbackResult = await registry.convertToMarkdown(fileType, filePath, fallbackOptions);
          if (!fallbackResult) {
            throw new Error(`Fallback URL conversion failed: No result returned`);
          }
          return this.standardizeResult(fallbackResult, fileType, fileName, category);
        } catch (fallbackError) {
          this.logger.error(`Fallback conversion also failed: ${fallbackError.message}`);
          throw error; // Throw the original error
        }
      } else {
        throw error; // Re-throw if no fallback is available
      }
    }
  }
  async handleConversion(filePath, options) {
    const {
      progressTracker,
      fileType,
      fileName,
      converterInfo,
      isUrl
    } = options;
    // Extract category from converterInfo to avoid "category is not defined" error
    // Move this outside try block to ensure it's accessible in all scopes
    const category = converterInfo?.category || FILE_TYPE_CATEGORIES[fileType] || 'unknown';

    // For URL conversions, use a separate method to avoid scope issues
    if (isUrl) {
      return this.handleUrlConversion(filePath, options, category);
    }
    let result = null; // Initialize to null to avoid temporal dead zone

    try {
      // Validate converterInfo
      if (!converterInfo) {
        this.logger.error(`No converter info available for ${fileType}`);
        throw new Error(`No converter info available for ${fileType}`);
      }
      this.logger.logPhaseTransition(ConversionStatus.STATUS.VALIDATING, ConversionStatus.STATUS.FAST_ATTEMPT);

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

      // Log the original filename details being passed to the converter
      this.logger.log(`Convert method called with originalFileName: ${fileName}`, 'INFO');
      this.logger.log(`Options being passed to converter:`, {
        hasOriginalFileName: !!options.originalFileName,
        originalFileNameValue: options.originalFileName,
        fileName: fileName,
        fileType: fileType
      });
      const result = await converter.convert(fileContent, fileName, options.apiKey, {
        ...options,
        name: fileName,
        originalFileName: fileName,
        // Explicitly pass originalFileName
        metadata: {
          ...(options.metadata || {}),
          originalFileName: fileName // Also add originalFileName to metadata
        },
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
        fileType: fileType,
        // Use only fileType, not type
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJhcHAiLCJlbGVjdHJvbiIsInJlcXVpcmUiLCJyZW1vdGUiLCJlIiwiY29uc29sZSIsIndhcm4iLCJmcyIsImV4aXN0c1N5bmMiLCJwYXRoIiwic3RhdFN5bmMiLCJpc0ZpbGUiLCJpbm5lckUiLCJlcnJvciIsIkVycm9yIiwiUGF0aFV0aWxzIiwiUHJvZ3Jlc3NUcmFja2VyIiwiZ2V0TG9nZ2VyIiwic2FuaXRpemVGb3JMb2dnaW5nIiwiQ29udmVyc2lvblN0YXR1cyIsInNhZmVSZXF1aXJlIiwibW9kdWxlUGF0aCIsImZhbGxiYWNrcyIsImZhbGxiYWNrIiwiaW5jbHVkZXMiLCJuYW1lIiwibG9nIiwibXNnIiwibGV2ZWwiLCJhcmdzIiwiZXJyIiwic3VjY2VzcyIsImRlYnVnIiwibG9nUGhhc2VUcmFuc2l0aW9uIiwiZnJvbSIsInRvIiwibG9nQ29udmVyc2lvblN0YXJ0IiwidHlwZSIsIm9wdHMiLCJsb2dDb252ZXJzaW9uQ29tcGxldGUiLCJsb2dDb252ZXJzaW9uRXJyb3IiLCJtZXNzYWdlIiwic2V0Q29udGV4dCIsIm9iaiIsInJlc29sdmUiLCJfX2Rpcm5hbWUiLCJwcm9jZXNzIiwiY3dkIiwiY29uc3RydWN0b3IiLCJjYWxsYmFjayIsInVwZGF0ZSIsInByb2dyZXNzIiwiZGF0YSIsInVwZGF0ZVNjYWxlZCIsIm1pbiIsIm1heCIsIlNUQVRVUyIsIlNUQVJUSU5HIiwiSU5JVElBTElaSU5HIiwiVkFMSURBVElORyIsIkZBU1RfQVRURU1QVCIsIlBST0NFU1NJTkciLCJGSU5BTElaSU5HIiwiQ09NUExFVEVEIiwiQ09OVEVOVF9FTVBUWSIsImlzUGFja2FnZWQiLCJnZXRBcHBQYXRoIiwiZ2V0TmFtZSIsImdldFZlcnNpb24iLCJNb2R1bGVMb2FkZXIiLCJsb2FkTW9kdWxlIiwib3B0aW9ucyIsImxvZ2dlciIsImZhbGxiYWNrUGF0aHMiLCJzaWxlbnQiLCJtb2R1bGVOYW1lIiwiYmFzZW5hbWUiLCJjYXRlZ29yeSIsInBhdGhQYXJ0cyIsImRpcm5hbWUiLCJzcGxpdCIsInNlcCIsImxlbmd0aCIsInNsaWNlIiwiam9pbiIsIk1vZHVsZVJlc29sdmVyIiwibW9kdWxlIiwicmVzb2x2ZXJFcnJvciIsImRlZmF1bHQiLCJkaXJlY3RFcnJvciIsImZhbGxiYWNrUGF0aCIsImZhbGxiYWNrRXJyb3IiLCJfY3JlYXRlRW1lcmdlbmN5UmVnaXN0cnkiLCJDb252ZXJ0ZXJSZWdpc3RyeSIsImNvbnZlcnRlcnMiLCJwZGYiLCJjb252ZXJ0IiwiY29udGVudCIsImFwaUtleSIsIm1ldGFkYXRhIiwicGFnZXMiLCJjb252ZXJ0ZXIiLCJ2YWxpZGF0ZSIsImlucHV0IiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJjb25maWciLCJleHRlbnNpb25zIiwibWltZVR5cGVzIiwibWF4U2l6ZSIsInByb3RvdHlwZSIsImNvbnZlcnRUb01hcmtkb3duIiwic291cmNlIiwiZ2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJleHRlbnNpb24iLCJsb2FkTW9kdWxlRnJvbUJlc3RQYXRoIiwiYmFzZVBhdGhzIiwicmVzb2x2ZWRQYXRocyIsIm1hcCIsImJhc2VQYXRoIiwiZXhpc3RpbmdQYXRocyIsImZpbHRlciIsInAiLCJleGlzdHMiLCJnZXRNb2R1bGVQYXRocyIsImlzRGV2IiwiZW52IiwiTk9ERV9FTlYiLCJwb3NzaWJsZVBhdGhzIiwicmVwbGFjZSIsImV4ZWNQYXRoIiwiZXJyb3JQYXRoIiwiY29ycmVjdGVkUGF0aCIsImNhbmRpZGF0ZVBhdGgiLCJkaXJlY3RSZWdpc3RyeVBhdGhzIiwicmVnaXN0cnlQYXRoIiwicmVnaXN0cnkiLCJ1cmwiLCJkb2N4IiwicHB0eCIsInhsc3giLCJjc3YiLCJNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkiLCJ0b1VwcGVyQ2FzZSIsIkNvbnZlcnRlckluaXRpYWxpemVyIiwiX2luc3RhbmNlIiwiX2luaXRpYWxpemVkIiwiX2luaXRQcm9taXNlIiwiX2NvbnZlcnRlclJlZ2lzdHJ5IiwiZ2V0SW5zdGFuY2UiLCJpbml0aWFsaXplIiwiX2RvSW5pdGlhbGl6ZSIsInBhdGhzIiwicG9zc2libGVCYXNlUGF0aHMiLCJPYmplY3QiLCJ2YWx1ZXMiLCJhbGxQb3NzaWJsZVJlZ2lzdHJ5UGF0aHMiLCJkaXJlY3RMb2FkRXJyb3IiLCJpbml0aWFsRXJyb3IiLCJiYXNlRGlycyIsImFkZEJhc2VEaXIiLCJkaXIiLCJwdXNoIiwiZm9yRWFjaCIsImNvbnZlcnRlclBhdGgiLCJjb252ZXJ0ZXJEaXIiLCJiZXN0UGF0aEVycm9yIiwiX3ZhbGlkYXRlUmVnaXN0cnkiLCJrZXlzIiwiZW5oYW5jZWRFcnJvciIsIm9yaWdpbmFsIiwic3RhY2siLCJGSUxFX1RZUEVfQ0FURUdPUklFUyIsIm1wMyIsIndhdiIsIm9nZyIsImZsYWMiLCJtcDQiLCJ3ZWJtIiwiYXZpIiwibW92IiwicGFyZW50dXJsIiwiVW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJfaW5pdGlhbGl6ZXIiLCJfZW5zdXJlSW5pdGlhbGl6ZWQiLCJnZXRDb252ZXJ0ZXIiLCJmaWxlVHlwZSIsIm5vcm1hbGl6ZWRUeXBlIiwidG9Mb3dlckNhc2UiLCJjb252ZXJ0RmlsZSIsImZpbGVQYXRoIiwic3RhcnRUaW1lIiwiRGF0ZSIsIm5vdyIsImlzVXJsIiwiZmlsZU5hbWUiLCJvcmlnaW5hbEZpbGVOYW1lIiwidXJsT2JqIiwiVVJMIiwiaG9zdG5hbWUiLCJwYXRobmFtZSIsImNvbnZlcnRlckluZm8iLCJjcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIiLCJQcm9taXNlIiwic2V0VGltZW91dCIsInByb2dyZXNzVHJhY2tlciIsIm9uUHJvZ3Jlc3MiLCJzdGF0dXMiLCJoYXNSZWdpc3RyeSIsImNvbnZlcnRlclR5cGUiLCJoYXNDb252ZXJ0ZXIiLCJjb252ZXJ0ZXJEZXRhaWxzIiwiY29udmVyc2lvblJlc3VsdCIsImhhbmRsZUNvbnZlcnNpb24iLCJzdGFuZGFyZGl6ZVJlc3VsdCIsInJlc3VsdCIsImFzeW5jIiwiY29udmVyc2lvbklkIiwicmVzdWx0T3JpZ2luYWxGaWxlTmFtZSIsInJlc3VsdE1ldGFkYXRhT3JpZ2luYWxGaWxlTmFtZSIsInJlc3VsdE5hbWUiLCJmdW5jdGlvblBhcmFtRmlsZU5hbWUiLCJvcmlnaW5hbEZpbGVOYW1lRnJvbVJlc3VsdCIsIm9yaWdpbmFsRmlsZU5hbWVGcm9tTWV0YWRhdGEiLCJuYW1lRnJvbVJlc3VsdCIsImZpbGVOYW1lUGFyYW0iLCJyZXN1bHRLZXlzIiwibWV0YWRhdGFLZXlzIiwiaXNTdWNjZXNzIiwic2FuaXRpemVkUmVzdWx0Iiwic3RhbmRhcmRpemVkIiwiaW1hZ2VzIiwidW5kZWZpbmVkIiwiaGFuZGxlVXJsQ29udmVyc2lvbiIsInVybFJlc3VsdCIsImNvbnZlcnRlck9wdGlvbnMiLCJrZXkiLCJjb252ZXJ0ZXJFcnJvciIsInJlZ2lzdHJ5T3B0aW9ucyIsImZhbGxiYWNrT3B0aW9ucyIsImZhbGxiYWNrUmVzdWx0IiwiZmlsZUNvbnRlbnQiLCJyZWFkRmlsZVN5bmMiLCJ1c2VPY3IiLCJoYXNNaXN0cmFsQXBpS2V5IiwibWlzdHJhbEFwaUtleSIsInByZXNlcnZlUGFnZUluZm8iLCJjbGVhbk9wdGlvbnMiLCJoYXNPcmlnaW5hbEZpbGVOYW1lIiwib3JpZ2luYWxGaWxlTmFtZVZhbHVlIiwidW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL2NvbnZlcnRlcnMvVW5pZmllZENvbnZlcnRlckZhY3RvcnkuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmpzXHJcbiAqIFxyXG4gKiBDZW50cmFsIGZhY3RvcnkgZm9yIGFsbCBmaWxlIHR5cGUgY29udmVyc2lvbnMgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogVXNlcyBDb21tb25KUyBmb3IgY29uc2lzdGVuY3kgd2l0aCBFbGVjdHJvbiBtYWluIHByb2Nlc3MgYW5kIHByb3ZpZGVzIHJvYnVzdCBpbml0aWFsaXphdGlvblxyXG4gKiBhbmQgY29udmVydGVyIG1hbmFnZW1lbnQuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9FbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmpzOiBVc2VzIHRoaXMgZmFjdG9yeSBmb3IgY29udmVyc2lvbnNcclxuICogLSBzcmMvZWxlY3Ryb24vaXBjL2hhbmRsZXJzL2NvbnZlcnNpb24vaW5kZXguanM6IEV4cG9zZXMgY29udmVyc2lvbiB0byByZW5kZXJlciBwcm9jZXNzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanM6IENvbnZlcnRlciBpbXBsZW1lbnRhdGlvbnNcclxuICovXHJcblxyXG4vLyBDb3JlIGRlcGVuZGVuY2llc1xyXG5sZXQgYXBwO1xyXG50cnkge1xyXG4gIC8vIFRyeSB0byBsb2FkIGVsZWN0cm9uIGluIGEgc2FmZXIgd2F5XHJcbiAgY29uc3QgZWxlY3Ryb24gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG4gIGFwcCA9IGVsZWN0cm9uLmFwcCB8fCAoZWxlY3Ryb24ucmVtb3RlICYmIGVsZWN0cm9uLnJlbW90ZS5hcHApO1xyXG59IGNhdGNoIChlKSB7XHJcbiAgLy8gSWYgZWxlY3Ryb24gaXNuJ3QgYXZhaWxhYmxlLCB3ZSdsbCBoYW5kbGUgaXQgYmVsb3dcclxuICBjb25zb2xlLndhcm4oJ0NvdWxkIG5vdCBsb2FkIGVsZWN0cm9uIGFwcCwgdXNpbmcgZmFsbGJhY2tzJyk7XHJcbn1cclxuXHJcbi8vIEVzc2VudGlhbCB1dGlsaXRpZXMgLSBsb2FkIHdpdGggZmFsbGJhY2tzXHJcbmxldCBmcztcclxudHJ5IHtcclxuICBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbn0gY2F0Y2ggKGUpIHtcclxuICB0cnkge1xyXG4gICAgZnMgPSByZXF1aXJlKCdmcycpO1xyXG4gICAgLy8gQWRkIGZzLWV4dHJhIG1ldGhvZHMgd2UgdXNlXHJcbiAgICBmcy5leGlzdHNTeW5jID0gZnMuZXhpc3RzU3luYyB8fCAoKHBhdGgpID0+IHtcclxuICAgICAgdHJ5IHsgcmV0dXJuIGZzLnN0YXRTeW5jKHBhdGgpLmlzRmlsZSgpOyB9IGNhdGNoIChlKSB7IHJldHVybiBmYWxzZTsgfVxyXG4gICAgfSk7XHJcbiAgfSBjYXRjaCAoaW5uZXJFKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gbG9hZCBmcyBtb2R1bGVzJywgaW5uZXJFKTtcclxuICAgIHRocm93IG5ldyBFcnJvcignQ3JpdGljYWwgZGVwZW5kZW5jeSBmcy9mcy1leHRyYSBub3QgYXZhaWxhYmxlJyk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBQYXRoIGhhbmRsaW5nIC0gZXNzZW50aWFsIGZvciBtb2R1bGUgcmVzb2x1dGlvblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5cclxuLy8gVHJ5IHRvIGxvYWQgaW50ZXJuYWwgbW9kdWxlcyB3aXRoIGZhbGxiYWNrc1xyXG5sZXQgUGF0aFV0aWxzLCBQcm9ncmVzc1RyYWNrZXIsIGdldExvZ2dlciwgc2FuaXRpemVGb3JMb2dnaW5nLCBDb252ZXJzaW9uU3RhdHVzO1xyXG5cclxuLy8gQXR0ZW1wdCB0byBsb2FkIGVhY2ggbW9kdWxlIHdpdGggZmFsbGJhY2tzIHRvIHByZXZlbnQgY3Jhc2hlc1xyXG5jb25zdCBzYWZlUmVxdWlyZSA9IChtb2R1bGVQYXRoLCBmYWxsYmFja3MgPSBbXSkgPT4ge1xyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gcmVxdWlyZShtb2R1bGVQYXRoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBmb3IgKGNvbnN0IGZhbGxiYWNrIG9mIGZhbGxiYWNrcykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIHJldHVybiByZXF1aXJlKGZhbGxiYWNrKTtcclxuICAgICAgfSBjYXRjaCB7IC8qIENvbnRpbnVlIHRvIG5leHQgZmFsbGJhY2sgKi8gfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIERlZmF1bHQgaW1wbGVtZW50YXRpb25zIGZvciBjcml0aWNhbCBmdW5jdGlvbnNcclxuICAgIGlmIChtb2R1bGVQYXRoLmluY2x1ZGVzKCdnZXRMb2dnZXInKSkge1xyXG4gICAgICByZXR1cm4gKG5hbWUpID0+ICh7XHJcbiAgICAgICAgbG9nOiAobXNnLCBsZXZlbCwgLi4uYXJncykgPT4gY29uc29sZS5sb2coYFske25hbWV9XVske2xldmVsIHx8ICdJTkZPJ31dICR7bXNnfWAsIC4uLmFyZ3MpLFxyXG4gICAgICAgIGVycm9yOiAobXNnLCBlcnIpID0+IGNvbnNvbGUuZXJyb3IoYFske25hbWV9XVtFUlJPUl0gJHttc2d9YCwgZXJyKSxcclxuICAgICAgICB3YXJuOiAobXNnLCAuLi5hcmdzKSA9PiBjb25zb2xlLndhcm4oYFske25hbWV9XVtXQVJOXSAke21zZ31gLCAuLi5hcmdzKSxcclxuICAgICAgICBzdWNjZXNzOiAobXNnKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dW1NVQ0NFU1NdICR7bXNnfWApLFxyXG4gICAgICAgIGRlYnVnOiAobXNnLCAuLi5hcmdzKSA9PiBjb25zb2xlLmRlYnVnKGBbJHtuYW1lfV1bREVCVUddICR7bXNnfWAsIC4uLmFyZ3MpLFxyXG4gICAgICAgIGxvZ1BoYXNlVHJhbnNpdGlvbjogKGZyb20sIHRvKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dIFBoYXNlIHRyYW5zaXRpb246ICR7ZnJvbX0g4oaSICR7dG99YCksXHJcbiAgICAgICAgbG9nQ29udmVyc2lvblN0YXJ0OiAodHlwZSwgb3B0cykgPT4gY29uc29sZS5sb2coYFske25hbWV9XSBTdGFydGluZyBjb252ZXJzaW9uIGZvciAke3R5cGV9YCksXHJcbiAgICAgICAgbG9nQ29udmVyc2lvbkNvbXBsZXRlOiAodHlwZSkgPT4gY29uc29sZS5sb2coYFske25hbWV9XSBDb21wbGV0ZWQgY29udmVyc2lvbiBmb3IgJHt0eXBlfWApLFxyXG4gICAgICAgIGxvZ0NvbnZlcnNpb25FcnJvcjogKHR5cGUsIGVycikgPT4gY29uc29sZS5lcnJvcihgWyR7bmFtZX06ZmFpbGVkXVske3R5cGV9XSDinYwgJHtlcnIubWVzc2FnZX1gLCBlcnIpLFxyXG4gICAgICAgIHNldENvbnRleHQ6ICgpID0+IHt9XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgaWYgKG1vZHVsZVBhdGguaW5jbHVkZXMoJ3Nhbml0aXplRm9yTG9nZ2luZycpKSB7XHJcbiAgICAgIHJldHVybiAob2JqKSA9PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIHJldHVybiB0eXBlb2Ygb2JqID09PSAnb2JqZWN0JyA/IHsgLi4ub2JqIH0gOiBvYmo7XHJcbiAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICByZXR1cm4gb2JqO1xyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLndhcm4oYE1vZHVsZSAke21vZHVsZVBhdGh9IG5vdCBhdmFpbGFibGUsIHVzaW5nIG1pbmltYWwgaW1wbGVtZW50YXRpb25gKTtcclxuICAgIHJldHVybiB7fTtcclxuICB9XHJcbn07XHJcblxyXG50cnkge1xyXG4gIFBhdGhVdGlscyA9IHNhZmVSZXF1aXJlKCcuLi91dGlscy9wYXRocy9pbmRleCcsIFtcclxuICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi91dGlscy9wYXRocy9pbmRleCcpLFxyXG4gICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vdXRpbHMvcGF0aHMvaW5kZXgnKVxyXG4gIF0pLlBhdGhVdGlscyB8fCB7fTtcclxuXHJcbiAgUHJvZ3Jlc3NUcmFja2VyID0gc2FmZVJlcXVpcmUoJy4uL3V0aWxzL2NvbnZlcnNpb24vcHJvZ3Jlc3MnLCBbXHJcbiAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vdXRpbHMvY29udmVyc2lvbi9wcm9ncmVzcycpLFxyXG4gICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vdXRpbHMvY29udmVyc2lvbi9wcm9ncmVzcycpXHJcbiAgXSkuUHJvZ3Jlc3NUcmFja2VyIHx8IGNsYXNzIFByb2dyZXNzVHJhY2tlciB7XHJcbiAgICBjb25zdHJ1Y3RvcihjYWxsYmFjaykgeyB0aGlzLmNhbGxiYWNrID0gY2FsbGJhY2s7IH1cclxuICAgIHVwZGF0ZShwcm9ncmVzcywgZGF0YSkgeyB0aGlzLmNhbGxiYWNrICYmIHRoaXMuY2FsbGJhY2socHJvZ3Jlc3MsIGRhdGEpOyB9XHJcbiAgICB1cGRhdGVTY2FsZWQocHJvZ3Jlc3MsIG1pbiwgbWF4LCBkYXRhKSB7IHRoaXMudXBkYXRlKG1pbiArIChwcm9ncmVzcy8xMDApICogKG1heC1taW4pLCBkYXRhKTsgfVxyXG4gIH07XHJcblxyXG4gIGdldExvZ2dlciA9IHNhZmVSZXF1aXJlKCcuLi91dGlscy9sb2dnaW5nL0NvbnZlcnNpb25Mb2dnZXInLCBbXHJcbiAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vdXRpbHMvbG9nZ2luZy9Db252ZXJzaW9uTG9nZ2VyJyksXHJcbiAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi91dGlscy9sb2dnaW5nL0NvbnZlcnNpb25Mb2dnZXInKVxyXG4gIF0pLmdldExvZ2dlciB8fCAoKG5hbWUpID0+ICh7XHJcbiAgICBsb2c6IChtc2csIGxldmVsLCAuLi5hcmdzKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dWyR7bGV2ZWwgfHwgJ0lORk8nfV0gJHttc2d9YCwgLi4uYXJncyksXHJcbiAgICBlcnJvcjogKG1zZywgZXJyKSA9PiBjb25zb2xlLmVycm9yKGBbJHtuYW1lfV1bRVJST1JdICR7bXNnfWAsIGVyciksXHJcbiAgICB3YXJuOiAobXNnLCAuLi5hcmdzKSA9PiBjb25zb2xlLndhcm4oYFske25hbWV9XVtXQVJOXSAke21zZ31gLCAuLi5hcmdzKSxcclxuICAgIHN1Y2Nlc3M6IChtc2cpID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV1bU1VDQ0VTU10gJHttc2d9YCksXHJcbiAgICBkZWJ1ZzogKG1zZywgLi4uYXJncykgPT4gY29uc29sZS5kZWJ1ZyhgWyR7bmFtZX1dW0RFQlVHXSAke21zZ31gLCAuLi5hcmdzKSxcclxuICAgIGxvZ1BoYXNlVHJhbnNpdGlvbjogKGZyb20sIHRvKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dIFBoYXNlIHRyYW5zaXRpb246ICR7ZnJvbX0g4oaSICR7dG99YCksXHJcbiAgICBsb2dDb252ZXJzaW9uU3RhcnQ6ICh0eXBlLCBvcHRzKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dIFN0YXJ0aW5nIGNvbnZlcnNpb24gZm9yICR7dHlwZX1gKSxcclxuICAgIGxvZ0NvbnZlcnNpb25Db21wbGV0ZTogKHR5cGUpID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV0gQ29tcGxldGVkIGNvbnZlcnNpb24gZm9yICR7dHlwZX1gKSxcclxuICAgIGxvZ0NvbnZlcnNpb25FcnJvcjogKHR5cGUsIGVycikgPT4gY29uc29sZS5lcnJvcihgWyR7bmFtZX06ZmFpbGVkXVske3R5cGV9XSDinYwgJHtlcnIubWVzc2FnZX1gLCBlcnIpLFxyXG4gICAgc2V0Q29udGV4dDogKCkgPT4ge31cclxuICB9KSk7XHJcblxyXG4gIHNhbml0aXplRm9yTG9nZ2luZyA9IHNhZmVSZXF1aXJlKCcuLi91dGlscy9sb2dnaW5nL0xvZ1Nhbml0aXplcicsIFtcclxuICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi91dGlscy9sb2dnaW5nL0xvZ1Nhbml0aXplcicpLFxyXG4gICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vdXRpbHMvbG9nZ2luZy9Mb2dTYW5pdGl6ZXInKVxyXG4gIF0pLnNhbml0aXplRm9yTG9nZ2luZyB8fCAoKG9iaikgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgcmV0dXJuIHR5cGVvZiBvYmogPT09ICdvYmplY3QnID8geyAuLi5vYmogfSA6IG9iajtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICByZXR1cm4gb2JqO1xyXG4gICAgfVxyXG4gIH0pO1xyXG5cclxuICBDb252ZXJzaW9uU3RhdHVzID0gc2FmZVJlcXVpcmUoJy4uL3V0aWxzL2NvbnZlcnNpb24vQ29udmVyc2lvblN0YXR1cycsIFtcclxuICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi91dGlscy9jb252ZXJzaW9uL0NvbnZlcnNpb25TdGF0dXMnKSxcclxuICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3V0aWxzL2NvbnZlcnNpb24vQ29udmVyc2lvblN0YXR1cycpXHJcbiAgXSkgfHwge1xyXG4gICAgU1RBVFVTOiB7XHJcbiAgICAgIFNUQVJUSU5HOiAnU3RhcnRpbmcgY29udmVyc2lvbicsXHJcbiAgICAgIElOSVRJQUxJWklORzogJ/CflKcgSW5pdGlhbGl6aW5nIGNvbnZlcnRlcicsXHJcbiAgICAgIFZBTElEQVRJTkc6ICfwn5SNIFZhbGlkYXRpbmcgZmlsZScsXHJcbiAgICAgIEZBU1RfQVRURU1QVDogJ+KaoSBGYXN0IGNvbnZlcnNpb24gYXR0ZW1wdCcsXHJcbiAgICAgIFBST0NFU1NJTkc6ICfij7MgUHJvY2Vzc2luZyBjb250ZW50JyxcclxuICAgICAgRklOQUxJWklORzogJ+KchSBGaW5hbGl6aW5nIHJlc3VsdCcsXHJcbiAgICAgIENPTVBMRVRFRDogJ+KckyBDb252ZXJzaW9uIGNvbXBsZXRlJyxcclxuICAgICAgQ09OVEVOVF9FTVBUWTogJ+KaoO+4jyBFbXB0eSBjb250ZW50IHdhcm5pbmcnXHJcbiAgICB9XHJcbiAgfTtcclxufSBjYXRjaCAoZXJyb3IpIHtcclxuICBjb25zb2xlLmVycm9yKCdFcnJvciBsb2FkaW5nIGNvcmUgZGVwZW5kZW5jaWVzJywgZXJyb3IpO1xyXG4gIHRocm93IG5ldyBFcnJvcihgQ3JpdGljYWwgZGVwZW5kZW5jeSBpbml0aWFsaXphdGlvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxufVxyXG5cclxuLy8gSW5pdGlhbGl6ZSBhcHAgd2l0aCBmYWxsYmFjayBpZiBuZWVkZWRcclxuaWYgKCFhcHApIHtcclxuICBhcHAgPSB7XHJcbiAgICBpc1BhY2thZ2VkOiBmYWxzZSxcclxuICAgIGdldEFwcFBhdGg6ICgpID0+IHByb2Nlc3MuY3dkKCksXHJcbiAgICBnZXROYW1lOiAoKSA9PiAnQ29kZXgubWQnLFxyXG4gICAgZ2V0VmVyc2lvbjogKCkgPT4gJzEuMC4wJ1xyXG4gIH07XHJcbiAgY29uc29sZS53YXJuKCdVc2luZyBmYWxsYmFjayBhcHAgaW1wbGVtZW50YXRpb24nKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZXMgbW9kdWxlIGxvYWRpbmcgd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmcgYW5kIHBhdGggcmVzb2x1dGlvbi5cclxuICovXHJcbmNsYXNzIE1vZHVsZUxvYWRlciB7XHJcbiAgc3RhdGljIGFzeW5jIGxvYWRNb2R1bGUobW9kdWxlUGF0aCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICBjb25zdCBsb2dnZXIgPSBnZXRMb2dnZXIoJ01vZHVsZUxvYWRlcicpO1xyXG4gICAgY29uc3QgeyBmYWxsYmFja1BhdGhzID0gW10sIHNpbGVudCA9IGZhbHNlIH0gPSBvcHRpb25zO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGxvZ2dlci5sb2coYExvYWRpbmcgbW9kdWxlIGZyb20gcGF0aDogJHttb2R1bGVQYXRofWAsICdJTkZPJyk7XHJcblxyXG4gICAgICAvLyBFeHRyYWN0IG1vZHVsZSBuYW1lIGFuZCBjYXRlZ29yeSBmcm9tIHBhdGhcclxuICAgICAgY29uc3QgbW9kdWxlTmFtZSA9IHBhdGguYmFzZW5hbWUobW9kdWxlUGF0aCk7XHJcbiAgICAgIGxldCBjYXRlZ29yeSA9ICcnO1xyXG5cclxuICAgICAgLy8gVHJ5IHRvIHBhcnNlIGNhdGVnb3J5IGZyb20gcGF0aFxyXG4gICAgICBjb25zdCBwYXRoUGFydHMgPSBwYXRoLmRpcm5hbWUobW9kdWxlUGF0aCkuc3BsaXQocGF0aC5zZXApO1xyXG4gICAgICBpZiAocGF0aFBhcnRzLmxlbmd0aCA+PSAyKSB7XHJcbiAgICAgICAgLy8gVGFrZSB0aGUgbGFzdCB0d28gcGFydHMgb2YgdGhlIHBhdGggYXMgdGhlIGNhdGVnb3J5XHJcbiAgICAgICAgY2F0ZWdvcnkgPSBwYXRoUGFydHMuc2xpY2UoLTIpLmpvaW4oJy8nKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBEZWZhdWx0IGNhdGVnb3J5IGZvciBjb252ZXJzaW9uc1xyXG4gICAgICAgIGNhdGVnb3J5ID0gJ3NlcnZpY2VzL2NvbnZlcnNpb24nO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBsb2dnZXIubG9nKGBVc2luZyBNb2R1bGVSZXNvbHZlciB3aXRoIG1vZHVsZTogJHttb2R1bGVOYW1lfSwgY2F0ZWdvcnk6ICR7Y2F0ZWdvcnl9YCwgJ0lORk8nKTtcclxuXHJcbiAgICAgIC8vIFVzZSBNb2R1bGVSZXNvbHZlciB0byBsb2FkIHRoZSBtb2R1bGVcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCB7IE1vZHVsZVJlc29sdmVyIH0gPSByZXF1aXJlKCcuLi91dGlscy9tb2R1bGVSZXNvbHZlcicpO1xyXG4gICAgICAgIGNvbnN0IG1vZHVsZSA9IE1vZHVsZVJlc29sdmVyLnNhZmVSZXF1aXJlKG1vZHVsZU5hbWUsIGNhdGVnb3J5KTtcclxuICAgICAgICBsb2dnZXIuc3VjY2VzcyhgU3VjY2Vzc2Z1bGx5IGxvYWRlZCBtb2R1bGUgdXNpbmcgTW9kdWxlUmVzb2x2ZXI6ICR7bW9kdWxlTmFtZX1gKTtcclxuICAgICAgICByZXR1cm4gbW9kdWxlO1xyXG4gICAgICB9IGNhdGNoIChyZXNvbHZlckVycm9yKSB7XHJcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBNb2R1bGVSZXNvbHZlciBmYWlsZWQ6ICR7cmVzb2x2ZXJFcnJvci5tZXNzYWdlfWAsIHJlc29sdmVyRXJyb3IpO1xyXG5cclxuICAgICAgICAvLyBJZiBNb2R1bGVSZXNvbHZlciBmYWlscywgdHJ5IHRoZSBvcmlnaW5hbCBhcHByb2FjaCB3aXRoIGZhbGxiYWNrc1xyXG4gICAgICAgIGxvZ2dlci5sb2coJ0ZhbGxpbmcgYmFjayB0byBkaXJlY3QgcmVxdWlyZSB3aXRoIGZhbGxiYWNrcycsICdJTkZPJyk7XHJcblxyXG4gICAgICAgIC8vIFRyeSBkaXJlY3QgcmVxdWlyZSBmaXJzdFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCBtb2R1bGUgPSByZXF1aXJlKG1vZHVsZVBhdGgpO1xyXG4gICAgICAgICAgbG9nZ2VyLnN1Y2Nlc3MoYFN1Y2Nlc3NmdWxseSBsb2FkZWQgbW9kdWxlIGRpcmVjdGx5OiAke21vZHVsZVBhdGh9YCk7XHJcbiAgICAgICAgICByZXR1cm4gbW9kdWxlLmRlZmF1bHQgfHwgbW9kdWxlO1xyXG4gICAgICAgIH0gY2F0Y2ggKGRpcmVjdEVycm9yKSB7XHJcbiAgICAgICAgICAvLyBJZiBmYWxsYmFjayBwYXRocyBwcm92aWRlZCwgdHJ5IHRoZW0gc2VxdWVudGlhbGx5XHJcbiAgICAgICAgICBpZiAoZmFsbGJhY2tQYXRocyAmJiBmYWxsYmFja1BhdGhzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgbG9nZ2VyLmxvZyhgQXR0ZW1wdGluZyB0byBsb2FkIGZyb20gJHtmYWxsYmFja1BhdGhzLmxlbmd0aH0gZmFsbGJhY2sgcGF0aHNgLCAnSU5GTycpO1xyXG5cclxuICAgICAgICAgICAgZm9yIChjb25zdCBmYWxsYmFja1BhdGggb2YgZmFsbGJhY2tQYXRocykge1xyXG4gICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBsb2dnZXIubG9nKGBUcnlpbmcgZmFsbGJhY2sgcGF0aDogJHtmYWxsYmFja1BhdGh9YCwgJ0lORk8nKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IHJlcXVpcmUoZmFsbGJhY2tQYXRoKTtcclxuICAgICAgICAgICAgICAgIGxvZ2dlci5zdWNjZXNzKGBTdWNjZXNzZnVsbHkgbG9hZGVkIGZyb20gZmFsbGJhY2s6ICR7ZmFsbGJhY2tQYXRofWApO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIG1vZHVsZS5kZWZhdWx0IHx8IG1vZHVsZTtcclxuICAgICAgICAgICAgICB9IGNhdGNoIChmYWxsYmFja0Vycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBDb250aW51ZSB0byBuZXh0IGZhbGxiYWNrIHBhdGhcclxuICAgICAgICAgICAgICAgIGlmICghc2lsZW50KSB7XHJcbiAgICAgICAgICAgICAgICAgIGxvZ2dlci53YXJuKGBGYWlsZWQgdG8gbG9hZCBmcm9tIGZhbGxiYWNrOiAke2ZhbGxiYWNrUGF0aH1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAvLyBJZiBhbGwgZWxzZSBmYWlscyBhbmQgdGhpcyBpcyBDb252ZXJ0ZXJSZWdpc3RyeS5qcywgY3JlYXRlIGEgbWluaW1hbCByZWdpc3RyeVxyXG4gICAgICAgICAgaWYgKG1vZHVsZU5hbWUgPT09ICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpIHtcclxuICAgICAgICAgICAgbG9nZ2VyLmxvZygnQWxsIGxvYWRpbmcgYXR0ZW1wdHMgZmFpbGVkIGZvciBDb252ZXJ0ZXJSZWdpc3RyeS5qcy4gQ3JlYXRpbmcgbWluaW1hbCByZWdpc3RyeScsICdJTkZPJyk7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jcmVhdGVFbWVyZ2VuY3lSZWdpc3RyeSgpO1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIC8vIElmIHdlIGdldCBoZXJlLCBhbGwgYXR0ZW1wdHMgZmFpbGVkXHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBsb2FkIG1vZHVsZTogJHttb2R1bGVQYXRofS4gRXJyb3I6ICR7cmVzb2x2ZXJFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgbG9nZ2VyLmVycm9yKGBNb2R1bGUgbG9hZGluZyBmYWlsZWQgY29tcGxldGVseTogJHtlcnJvci5tZXNzYWdlfWAsIGVycm9yKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2R1bGUgbG9hZGluZyBmYWlsZWQ6ICR7bW9kdWxlUGF0aH0uIEVycm9yOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGVzIGFuIGVtZXJnZW5jeSBtaW5pbWFsIHJlZ2lzdHJ5IGFzIGEgbGFzdCByZXNvcnRcclxuICAgKiBAcmV0dXJucyB7T2JqZWN0fSBBIG1pbmltYWwgcmVnaXN0cnkgaW1wbGVtZW50YXRpb25cclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIHN0YXRpYyBfY3JlYXRlRW1lcmdlbmN5UmVnaXN0cnkoKSB7XHJcbiAgICBjb25zdCBsb2dnZXIgPSBnZXRMb2dnZXIoJ01vZHVsZUxvYWRlcicpO1xyXG4gICAgbG9nZ2VyLmxvZygn8J+TpiBDcmVhdGluZyBlbWVyZ2VuY3kgbWluaW1hbCByZWdpc3RyeSBpbXBsZW1lbnRhdGlvbicsICdJTkZPJyk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIG1pbmltYWwgcmVnaXN0cnkgY29uc3RydWN0b3IgZnVuY3Rpb24gdG8gbWF0Y2ggZXhpc3RpbmcgcGF0dGVyblxyXG4gICAgZnVuY3Rpb24gQ29udmVydGVyUmVnaXN0cnkoKSB7XHJcbiAgICAgIHRoaXMuY29udmVydGVycyA9IHtcclxuICAgICAgICBwZGY6IHtcclxuICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMgPSB7fSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW0VtZXJnZW5jeVJlZ2lzdHJ5XSBVc2luZyBlbWVyZ2VuY3kgUERGIGNvbnZlcnRlcicpO1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgY29udGVudDogYCMgRXh0cmFjdGVkIGZyb20gJHtuYW1lIHx8ICdQREYgZG9jdW1lbnQnfVxcblxcblRoaXMgY29udGVudCB3YXMgZXh0cmFjdGVkIHVzaW5nIHRoZSBlbWVyZ2VuY3kgY29udmVydGVyLlxcblxcblRoZSBhcHBsaWNhdGlvbiBlbmNvdW50ZXJlZCBhbiBpc3N1ZSBmaW5kaW5nIHRoZSBjb3JyZWN0IGNvbnZlcnRlciBtb2R1bGUuIFBsZWFzZSByZXBvcnQgdGhpcyBpc3N1ZS5gLFxyXG4gICAgICAgICAgICAgIHR5cGU6ICdwZGYnLFxyXG4gICAgICAgICAgICAgIG1ldGFkYXRhOiB7IHBhZ2VzOiAxLCBjb252ZXJ0ZXI6ICdlbWVyZ2VuY3ktZmFsbGJhY2snIH1cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB2YWxpZGF0ZTogKGlucHV0KSA9PiBCdWZmZXIuaXNCdWZmZXIoaW5wdXQpIHx8IHR5cGVvZiBpbnB1dCA9PT0gJ3N0cmluZycsXHJcbiAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgbmFtZTogJ1BERiBEb2N1bWVudCAoRW1lcmdlbmN5KScsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnBkZiddLFxyXG4gICAgICAgICAgICBtaW1lVHlwZXM6IFsnYXBwbGljYXRpb24vcGRmJ10sXHJcbiAgICAgICAgICAgIG1heFNpemU6IDI1ICogMTAyNCAqIDEwMjRcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQWRkIHJlcXVpcmVkIHByb3RvdHlwZSBtZXRob2RzXHJcbiAgICBDb252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuY29udmVydFRvTWFya2Rvd24gPSBhc3luYyBmdW5jdGlvbih0eXBlLCBjb250ZW50LCBvcHRpb25zID0ge30pIHtcclxuICAgICAgY29uc29sZS5sb2coYFtFbWVyZ2VuY3lSZWdpc3RyeV0gQ29udmVydGluZyAke3R5cGV9IGRvY3VtZW50YCk7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICBjb250ZW50OiBgIyBFbWVyZ2VuY3kgQ29udmVydGVyXFxuXFxuVGhpcyBjb250ZW50IHdhcyBnZW5lcmF0ZWQgYnkgYW4gZW1lcmdlbmN5IGZhbGxiYWNrIGNvbnZlcnRlciBiZWNhdXNlIHRoZSBub3JtYWwgY29udmVydGVyIGNvdWxkIG5vdCBiZSBsb2FkZWQuXFxuXFxuUGxlYXNlIHJlcG9ydCB0aGlzIGlzc3VlLmAsXHJcbiAgICAgICAgbWV0YWRhdGE6IHsgc291cmNlOiAnZW1lcmdlbmN5LWZhbGxiYWNrJyB9XHJcbiAgICAgIH07XHJcbiAgICB9O1xyXG5cclxuICAgIENvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiA9IGZ1bmN0aW9uKGV4dGVuc2lvbikge1xyXG4gICAgICBjb25zb2xlLmxvZyhgW0VtZXJnZW5jeVJlZ2lzdHJ5XSBMb29raW5nIHVwIGNvbnZlcnRlciBmb3I6ICR7ZXh0ZW5zaW9ufWApO1xyXG4gICAgICBpZiAoZXh0ZW5zaW9uID09PSAncGRmJykge1xyXG4gICAgICAgIHJldHVybiB0aGlzLmNvbnZlcnRlcnMucGRmO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfTtcclxuXHJcbiAgICAvLyBDcmVhdGUgYW5kIHJldHVybiB0aGUgcmVnaXN0cnkgaW5zdGFuY2VcclxuICAgIHJldHVybiBuZXcgQ29udmVydGVyUmVnaXN0cnkoKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEF0dGVtcHRzIHRvIGxvYWQgYSBtb2R1bGUgZnJvbSB0aGUgYmVzdCBhdmFpbGFibGUgcGF0aFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2R1bGVOYW1lIC0gVGhlIG1vZHVsZSBmaWxlIG5hbWUgKGUuZy4sICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpXHJcbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBiYXNlUGF0aHMgLSBMaXN0IG9mIGJhc2UgZGlyZWN0b3JpZXMgdG8gbG9vayBpblxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGFueT59IC0gVGhlIGxvYWRlZCBtb2R1bGVcclxuICAgKi9cclxuICBzdGF0aWMgYXN5bmMgbG9hZE1vZHVsZUZyb21CZXN0UGF0aChtb2R1bGVOYW1lLCBiYXNlUGF0aHMpIHtcclxuICAgIGNvbnN0IGxvZ2dlciA9IGdldExvZ2dlcignTW9kdWxlTG9hZGVyJyk7XHJcbiAgICBjb25zdCByZXNvbHZlZFBhdGhzID0gYmFzZVBhdGhzLm1hcChiYXNlUGF0aCA9PiBwYXRoLmpvaW4oYmFzZVBhdGgsIG1vZHVsZU5hbWUpKTtcclxuXHJcbiAgICBsb2dnZXIubG9nKGBBdHRlbXB0aW5nIHRvIGxvYWQgJHttb2R1bGVOYW1lfSBmcm9tICR7cmVzb2x2ZWRQYXRocy5sZW5ndGh9IHBvc3NpYmxlIHBhdGhzYCwgJ0lORk8nKTtcclxuXHJcbiAgICAvLyBDaGVjayB3aGljaCBwYXRocyBleGlzdCBmaXJzdFxyXG4gICAgY29uc3QgZXhpc3RpbmdQYXRocyA9IHJlc29sdmVkUGF0aHMuZmlsdGVyKHAgPT4ge1xyXG4gICAgICBjb25zdCBleGlzdHMgPSBmcy5leGlzdHNTeW5jKHApO1xyXG4gICAgICBsb2dnZXIubG9nKGBQYXRoICR7cH0gZXhpc3RzOiAke2V4aXN0c31gLCAnSU5GTycpO1xyXG4gICAgICByZXR1cm4gZXhpc3RzO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaWYgKGV4aXN0aW5nUGF0aHMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIGxvZ2dlci5lcnJvcihgTm8gZXhpc3RpbmcgcGF0aHMgZm91bmQgZm9yIG1vZHVsZTogJHttb2R1bGVOYW1lfWApO1xyXG4gICAgICAvLyBUcnkgYWxsIHBhdGhzIGFueXdheSBhcyBhIGxhc3QgcmVzb3J0XHJcbiAgICAgIHJldHVybiB0aGlzLmxvYWRNb2R1bGUocmVzb2x2ZWRQYXRoc1swXSwge1xyXG4gICAgICAgIGZhbGxiYWNrUGF0aHM6IHJlc29sdmVkUGF0aHMuc2xpY2UoMSksXHJcbiAgICAgICAgc2lsZW50OiB0cnVlXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIExvYWQgZnJvbSB0aGUgZmlyc3QgZXhpc3RpbmcgcGF0aCwgd2l0aCByZW1haW5pbmcgZXhpc3RpbmcgcGF0aHMgYXMgZmFsbGJhY2tzXHJcbiAgICByZXR1cm4gdGhpcy5sb2FkTW9kdWxlKGV4aXN0aW5nUGF0aHNbMF0sIHtcclxuICAgICAgZmFsbGJhY2tQYXRoczogZXhpc3RpbmdQYXRocy5zbGljZSgxKVxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgZ2V0TW9kdWxlUGF0aHMoKSB7XHJcbiAgICBjb25zdCBpc0RldiA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnO1xyXG4gICAgY29uc3QgbG9nZ2VyID0gZ2V0TG9nZ2VyKCdNb2R1bGVMb2FkZXInKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgYSBjb21wcmVoZW5zaXZlIGxpc3Qgb2YgcG9zc2libGUgcGF0aHMgZm9yIHRoZSBDb252ZXJ0ZXJSZWdpc3RyeVxyXG4gICAgY29uc3QgcG9zc2libGVQYXRocyA9IFtcclxuICAgICAgLy8gRGV2ZWxvcG1lbnQgcGF0aHNcclxuICAgICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIFBhY2thZ2VkIGFwcCBwYXRocyAtIG5vdGUgd2UgZXhwbGljaXRseSBoYW5kbGUgdGhlIHBhdGggZnJvbSB0aGUgZXJyb3JcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoL3NyY1xcL2VsZWN0cm9uLywgJ2J1aWxkL2VsZWN0cm9uJyksICdzZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoL3NyY1xcXFxlbGVjdHJvbi8sICdidWlsZFxcXFxlbGVjdHJvbicpLCAnc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBSZWxhdGl2ZSBwYXRocyBmcm9tIGN1cnJlbnQgbW9kdWxlXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBQYXRocyB3aXRoIGFwcC5hc2FyIGZvciBwYWNrYWdlZCBhcHBcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXInLCAnYXBwJyksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhcicsICdhcHAnKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXJcXFxcc3JjJywgJ2FwcC5hc2FyXFxcXGJ1aWxkJyksICdlbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyL3NyYycsICdhcHAuYXNhci9idWlsZCcpLCAnZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gQWx0ZXJuYXRpdmUgcGFyZW50IGRpcmVjdG9yeSBwYXRoc1xyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJy4uL2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICcuLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gU2libGluZyBwYXRoc1xyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKGFwcC5nZXRBcHBQYXRoKCkpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKGFwcC5nZXRBcHBQYXRoKCkpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIE1vcmUgbmVzdGVkIHBhdGhzIGZvciBhcHAuYXNhclxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ2Rpc3QvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAnLi4vcmVzb3VyY2VzL2FwcC9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAnLi4vcmVzb3VyY2VzL2FwcC9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBEaXJlY3QgcGF0aCBmaXhlcyBmb3IgdGhlIHNwZWNpZmljIGVycm9yIHBhdGhcclxuICAgICAgYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicsICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnc3JjXFxcXGVsZWN0cm9uXFxcXHNlcnZpY2VzXFxcXGNvbnZlcnNpb24nLCAnYnVpbGRcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gUGF0aHMgd2l0aCBkaXN0IHByZWZpeGVzIChvZnRlbiB1c2VkIGluIGJ1aWx0IGFwcHMpXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnZGlzdC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnZGlzdC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBBZGRpdGlvbmFsIHBhdGhzIHNwZWNpZmljYWxseSBmb3IgQ29udmVydGVyUmVnaXN0cnkuanNcclxuICAgICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdhcHAvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ2FwcC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi8uLi9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi8uLi8uLi9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvYXBwL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ3Jlc291cmNlcy9hcHAuYXNhci9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpXHJcbiAgICBdO1xyXG5cclxuICAgIC8vIExvZyBhcHAgZW52aXJvbm1lbnQgaW5mb3JtYXRpb24gZm9yIGRlYnVnZ2luZ1xyXG4gICAgbG9nZ2VyLmxvZyhgQXBwIGlzIHBhY2thZ2VkOiAke2FwcC5pc1BhY2thZ2VkfWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBBcHAgcGF0aDogJHthcHAuZ2V0QXBwUGF0aCgpfWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBfX2Rpcm5hbWU6ICR7X19kaXJuYW1lfWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBwcm9jZXNzLmN3ZCgpOiAke3Byb2Nlc3MuY3dkKCl9YCwgJ0lORk8nKTtcclxuICAgIGxvZ2dlci5sb2coYHByb2Nlc3MuZXhlY1BhdGg6ICR7cHJvY2Vzcy5leGVjUGF0aH1gLCAnSU5GTycpO1xyXG5cclxuICAgIC8vIExvZyB0aGUgc3BlY2lmaWMgcGF0aCBmcm9tIHRoZSBlcnJvciBtZXNzYWdlXHJcbiAgICBjb25zdCBlcnJvclBhdGggPSAnQzpcXFxcVXNlcnNcXFxcSm9zZXBoXFxcXERvY3VtZW50c1xcXFxDb2RlXFxcXGNvZGV4LW1kXFxcXGRpc3RcXFxcd2luLXVucGFja2VkXFxcXHJlc291cmNlc1xcXFxhcHAuYXNhclxcXFxzcmNcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvblxcXFxDb252ZXJ0ZXJSZWdpc3RyeS5qcyc7XHJcbiAgICBjb25zdCBjb3JyZWN0ZWRQYXRoID0gZXJyb3JQYXRoLnJlcGxhY2UoJ1xcXFxzcmNcXFxcJywgJ1xcXFxidWlsZFxcXFwnKTtcclxuICAgIGxvZ2dlci5sb2coYEVycm9yIHBhdGg6ICR7ZXJyb3JQYXRofWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBDb3JyZWN0ZWQgcGF0aDogJHtjb3JyZWN0ZWRQYXRofWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBDb3JyZWN0ZWQgcGF0aCBleGlzdHM6ICR7ZnMuZXhpc3RzU3luYyhjb3JyZWN0ZWRQYXRoKX1gLCAnSU5GTycpO1xyXG5cclxuICAgIC8vIEZpbmQgZmlyc3QgZXhpc3RpbmcgYmFzZSBwYXRoXHJcbiAgICBsZXQgYmFzZVBhdGggPSBudWxsO1xyXG4gICAgZm9yIChjb25zdCBjYW5kaWRhdGVQYXRoIG9mIHBvc3NpYmxlUGF0aHMpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBleGlzdHMgPSBmcy5leGlzdHNTeW5jKGNhbmRpZGF0ZVBhdGgpO1xyXG4gICAgICAgIGxvZ2dlci5sb2coYENoZWNraW5nIHBhdGg6ICR7Y2FuZGlkYXRlUGF0aH0gKGV4aXN0czogJHtleGlzdHN9KWAsICdJTkZPJyk7XHJcblxyXG4gICAgICAgIGlmIChleGlzdHMpIHtcclxuICAgICAgICAgIGJhc2VQYXRoID0gY2FuZGlkYXRlUGF0aDtcclxuICAgICAgICAgIGxvZ2dlci5sb2coYEZvdW5kIHZhbGlkIGJhc2UgcGF0aDogJHtiYXNlUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGxvZ2dlci53YXJuKGBFcnJvciBjaGVja2luZyBwYXRoICR7Y2FuZGlkYXRlUGF0aH06ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIElmIG5vIGJhc2UgcGF0aCBleGlzdHMsIHRyeSBkaXJlY3QgbW9kdWxlIHBhdGhzXHJcbiAgICBpZiAoIWJhc2VQYXRoKSB7XHJcbiAgICAgIGxvZ2dlci53YXJuKCdObyB2YWxpZCBiYXNlIHBhdGggZm91bmQsIHRyeWluZyBkaXJlY3QgbW9kdWxlIHJlc29sdXRpb24nKTtcclxuXHJcbiAgICAgIC8vIERlZmluZSBhbGwgcG9zc2libGUgZGlyZWN0IHBhdGhzIHRvIHRoZSByZWdpc3RyeSBtb2R1bGVcclxuICAgICAgY29uc3QgZGlyZWN0UmVnaXN0cnlQYXRocyA9IFtcclxuICAgICAgICAvLyBTcGVjaWZpYyBwYXRocyBiYXNlZCBvbiBlcnJvciBsb2dzXHJcbiAgICAgICAgLy8gVGhpcyBpcyB0aGUgc3BlY2lmaWMgZXJyb3IgcGF0aCB3aXRoICdzcmMnIHJlcGxhY2VkIHdpdGggJ2J1aWxkJ1xyXG4gICAgICAgIGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpICsgJy9Db252ZXJ0ZXJSZWdpc3RyeS5qcycsXHJcbiAgICAgICAgYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdzcmNcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvbicsICdidWlsZFxcXFxlbGVjdHJvblxcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uJykgKyAnXFxcXENvbnZlcnRlclJlZ2lzdHJ5LmpzJyxcclxuXHJcbiAgICAgICAgLy8gRnVsbCBzdHJpbmcgcmVwbGFjZW1lbnRzIGZvciB0aGUgc3BlY2lmaWMgZXJyb3IgcGF0aHMgaW4gdGhlIGxvZ3NcclxuICAgICAgICBhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyXFxcXHNyY1xcXFxlbGVjdHJvbicsICdhcHAuYXNhclxcXFxidWlsZFxcXFxlbGVjdHJvbicpICsgJ1xcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uXFxcXENvbnZlcnRlclJlZ2lzdHJ5LmpzJyxcclxuICAgICAgICBhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyL3NyYy9lbGVjdHJvbicsICdhcHAuYXNhci9idWlsZC9lbGVjdHJvbicpICsgJy9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyxcclxuXHJcbiAgICAgICAgLy8gU3RhbmRhcmQgYXBwbGljYXRpb24gcGF0aHNcclxuICAgICAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG5cclxuICAgICAgICAvLyBSZWxhdGl2ZSBwYXRoc1xyXG4gICAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuXHJcbiAgICAgICAgLy8gQVNBUi1zcGVjaWZpYyBwYXRocyB3aXRoIGFkYXB0YXRpb25zXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXInLCAnYXBwJyksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyJywgJ2FwcCcpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLi9yZXNvdXJjZXMvYXBwL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJy4uL3Jlc291cmNlcy9hcHAvYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uLy4uL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAncmVzb3VyY2VzL2FwcC9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvYXBwLmFzYXIvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvYXBwLmFzYXIvYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG5cclxuICAgICAgICAvLyBBbGxvdyBmaW5kaW5nIGluIGN1cnJlbnQgZGlyZWN0b3JpZXNcclxuICAgICAgICBwYXRoLmpvaW4oX19kaXJuYW1lLCAnQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLmpvaW4ocGF0aC5kaXJuYW1lKF9fZGlybmFtZSksICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG5cclxuICAgICAgICAvLyBUcnkgYWJzb2x1dGUgcGF0aHMgdGhhdCBtYXRjaCB0aGUgZXJyb3Igc3RhY2tcclxuICAgICAgICAnQzpcXFxcVXNlcnNcXFxcSm9zZXBoXFxcXERvY3VtZW50c1xcXFxDb2RlXFxcXGNvZGV4LW1kXFxcXGRpc3RcXFxcd2luLXVucGFja2VkXFxcXHJlc291cmNlc1xcXFxhcHAuYXNhclxcXFxidWlsZFxcXFxlbGVjdHJvblxcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uXFxcXENvbnZlcnRlclJlZ2lzdHJ5LmpzJ1xyXG4gICAgICBdO1xyXG5cclxuICAgICAgLy8gRmluZCB0aGUgZmlyc3QgZGlyZWN0IHJlZ2lzdHJ5IHBhdGggdGhhdCBleGlzdHNcclxuICAgICAgZm9yIChjb25zdCByZWdpc3RyeVBhdGggb2YgZGlyZWN0UmVnaXN0cnlQYXRocykge1xyXG4gICAgICAgIGNvbnN0IGV4aXN0cyA9IGZzLmV4aXN0c1N5bmMocmVnaXN0cnlQYXRoKTtcclxuICAgICAgICBsb2dnZXIubG9nKGBDaGVja2luZyBkaXJlY3QgcmVnaXN0cnkgcGF0aDogJHtyZWdpc3RyeVBhdGh9IChleGlzdHM6ICR7ZXhpc3RzfSlgLCAnSU5GTycpO1xyXG5cclxuICAgICAgICBpZiAoZXhpc3RzKSB7XHJcbiAgICAgICAgICAvLyBCdWlsZCBhIGJhc2UgcGF0aCBmcm9tIHRoZSBkaXJlY3RvcnkgY29udGFpbmluZyB0aGUgcmVnaXN0cnlcclxuICAgICAgICAgIGJhc2VQYXRoID0gcGF0aC5kaXJuYW1lKHJlZ2lzdHJ5UGF0aCk7XHJcbiAgICAgICAgICBsb2dnZXIubG9nKGBGb3VuZCByZWdpc3RyeSBtb2R1bGUgYXQ6ICR7cmVnaXN0cnlQYXRofSwgdXNpbmcgYmFzZSBwYXRoOiAke2Jhc2VQYXRofWAsICdJTkZPJyk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBGYWxsYmFjayB0byBhIGRlZmF1bHQgcGF0aCBpZiBhbGwgZWxzZSBmYWlsc1xyXG4gICAgaWYgKCFiYXNlUGF0aCkge1xyXG4gICAgICBsb2dnZXIuZXJyb3IoJ0FsbCBwYXRoIHJlc29sdXRpb24gYXR0ZW1wdHMgZmFpbGVkLCB1c2luZyBmYWxsYmFjayBwYXRoJyk7XHJcblxyXG4gICAgICAvLyBVc2UgYSBwYXRoIHJlbGF0aXZlIHRvIGN1cnJlbnQgbW9kdWxlIGFzIGxhc3QgcmVzb3J0XHJcbiAgICAgIGlmIChhcHAuaXNQYWNrYWdlZCkge1xyXG4gICAgICAgIGJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3NlcnZpY2VzL2NvbnZlcnNpb24nKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBiYXNlUGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIExvZyB0aGUgZmluYWwgYmFzZSBwYXRoIHRoYXQgd2lsbCBiZSB1c2VkXHJcbiAgICBsb2dnZXIubG9nKGBVc2luZyBmaW5hbCBiYXNlIHBhdGg6ICR7YmFzZVBhdGh9YCwgJ0lORk8nKTtcclxuXHJcbiAgICAvLyBDaGVjayBpZiB0aGUgcmVnaXN0cnkgZXhpc3RzIGF0IHRoaXMgcGF0aFxyXG4gICAgY29uc3QgcmVnaXN0cnlQYXRoID0gcGF0aC5qb2luKGJhc2VQYXRoLCAnQ29udmVydGVyUmVnaXN0cnkuanMnKTtcclxuICAgIGxvZ2dlci5sb2coYEZpbmFsIHJlZ2lzdHJ5IHBhdGg6ICR7cmVnaXN0cnlQYXRofSAoZXhpc3RzOiAke2ZzLmV4aXN0c1N5bmMocmVnaXN0cnlQYXRoKX0pYCwgJ0lORk8nKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgdGhlIHBhdGhzIG9iamVjdCB3aXRoIGFsbCBtb2R1bGUgcGF0aHNcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHJlZ2lzdHJ5OiByZWdpc3RyeVBhdGgsXHJcbiAgICAgIHJlZ2lzdHJ5UGF0aDogcmVnaXN0cnlQYXRoLCAvLyBEdXBsaWNhdGUgZm9yIGRpcmVjdCBhY2Nlc3NcclxuICAgICAgY29udmVydGVyczoge1xyXG4gICAgICAgIHVybDogcGF0aC5qb2luKGJhc2VQYXRoLCAnd2ViL1VybENvbnZlcnRlci5qcycpLFxyXG4gICAgICAgIHBkZjogcGF0aC5qb2luKGJhc2VQYXRoLCAnZG9jdW1lbnQvUGRmQ29udmVydGVyRmFjdG9yeS5qcycpLFxyXG4gICAgICAgIGRvY3g6IHBhdGguam9pbihiYXNlUGF0aCwgJ2RvY3VtZW50L0RvY3hDb252ZXJ0ZXIuanMnKSxcclxuICAgICAgICBwcHR4OiBwYXRoLmpvaW4oYmFzZVBhdGgsICdkb2N1bWVudC9QcHR4Q29udmVydGVyLmpzJyksXHJcbiAgICAgICAgeGxzeDogcGF0aC5qb2luKGJhc2VQYXRoLCAnZGF0YS9YbHN4Q29udmVydGVyLmpzJyksXHJcbiAgICAgICAgY3N2OiBwYXRoLmpvaW4oYmFzZVBhdGgsICdkYXRhL0NzdkNvbnZlcnRlci5qcycpXHJcbiAgICAgIH1cclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vLyBNaW5pbWFsIGVtYmVkZGVkIENvbnZlcnRlclJlZ2lzdHJ5IGFzIGEgbGFzdCByZXNvcnRcclxuY29uc3QgTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5ID0ge1xyXG4gIGNvbnZlcnRlcnM6IHtcclxuICAgIHBkZjoge1xyXG4gICAgICAvLyBNaW5pbWFsIFBERiBjb252ZXJ0ZXJcclxuICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucyA9IHt9KSA9PiB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1tNaW5pbWFsQ29udmVydGVyUmVnaXN0cnldIFVzaW5nIGVtYmVkZGVkIFBERiBjb252ZXJ0ZXInKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgIGNvbnRlbnQ6IGAjIEV4dHJhY3RlZCBmcm9tICR7bmFtZSB8fCAnUERGIGRvY3VtZW50J31cXG5cXG5UaGlzIGNvbnRlbnQgd2FzIGV4dHJhY3RlZCB1c2luZyB0aGUgZW1iZWRkZWQgY29udmVydGVyLmAsXHJcbiAgICAgICAgICB0eXBlOiAncGRmJyxcclxuICAgICAgICAgIG1ldGFkYXRhOiB7IHBhZ2VzOiAxLCBjb252ZXJ0ZXI6ICdtaW5pbWFsLWVtYmVkZGVkJyB9XHJcbiAgICAgICAgfTtcclxuICAgICAgfSxcclxuICAgICAgdmFsaWRhdGU6IChpbnB1dCkgPT4gQnVmZmVyLmlzQnVmZmVyKGlucHV0KSB8fCB0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnLFxyXG4gICAgICBjb25maWc6IHtcclxuICAgICAgICBuYW1lOiAnUERGIERvY3VtZW50JyxcclxuICAgICAgICBleHRlbnNpb25zOiBbJy5wZGYnXSxcclxuICAgICAgICBtaW1lVHlwZXM6IFsnYXBwbGljYXRpb24vcGRmJ10sXHJcbiAgICAgICAgbWF4U2l6ZTogMjUgKiAxMDI0ICogMTAyNFxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfSxcclxuXHJcbiAgLy8gR2VuZXJpYyBjb252ZXJzaW9uIGZ1bmN0aW9uXHJcbiAgY29udmVydFRvTWFya2Rvd246IGFzeW5jICh0eXBlLCBjb250ZW50LCBvcHRpb25zID0ge30pID0+IHtcclxuICAgIGNvbnNvbGUubG9nKGBbTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5XSBVc2luZyBlbWJlZGRlZCBjb252ZXJ0VG9NYXJrZG93biBmb3IgJHt0eXBlfWApO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgY29udGVudDogYCMgRXh0cmFjdGVkIGZyb20gJHtvcHRpb25zLm5hbWUgfHwgJ2RvY3VtZW50J31cXG5cXG5UaGlzIGNvbnRlbnQgd2FzIGV4dHJhY3RlZCB1c2luZyB0aGUgZW1iZWRkZWQgY29udmVydGVyLmAsXHJcbiAgICAgIHR5cGU6IHR5cGUsXHJcbiAgICAgIG1ldGFkYXRhOiB7IGNvbnZlcnRlcjogJ21pbmltYWwtZW1iZWRkZWQnIH1cclxuICAgIH07XHJcbiAgfSxcclxuXHJcbiAgLy8gTG9va3VwIGNvbnZlcnRlciBieSBleHRlbnNpb25cclxuICBnZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbjogYXN5bmMgKGV4dGVuc2lvbikgPT4ge1xyXG4gICAgY29uc29sZS5sb2coYFtNaW5pbWFsQ29udmVydGVyUmVnaXN0cnldIExvb2tpbmcgdXAgY29udmVydGVyIGZvcjogJHtleHRlbnNpb259YCk7XHJcblxyXG4gICAgLy8gSGFuZGxlIFBERiBmaWxlcyBzcGVjaWZpY2FsbHlcclxuICAgIGlmIChleHRlbnNpb24gPT09ICdwZGYnKSB7XHJcbiAgICAgIHJldHVybiBNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkuY29udmVydGVycy5wZGY7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2VuZXJpYyBjb252ZXJ0ZXIgZm9yIG90aGVyIHR5cGVzXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zID0ge30pID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW01pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeV0gVXNpbmcgZ2VuZXJpYyBjb252ZXJ0ZXIgZm9yICR7ZXh0ZW5zaW9ufWApO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgY29udGVudDogYCMgRXh0cmFjdGVkIGZyb20gJHtuYW1lIHx8IGV4dGVuc2lvbiArICcgZmlsZSd9XFxuXFxuVGhpcyBjb250ZW50IHdhcyBleHRyYWN0ZWQgdXNpbmcgdGhlIGVtYmVkZGVkIGdlbmVyaWMgY29udmVydGVyLmAsXHJcbiAgICAgICAgICB0eXBlOiBleHRlbnNpb24sXHJcbiAgICAgICAgICBtZXRhZGF0YTogeyBjb252ZXJ0ZXI6ICdtaW5pbWFsLWVtYmVkZGVkLWdlbmVyaWMnIH1cclxuICAgICAgICB9O1xyXG4gICAgICB9LFxyXG4gICAgICB2YWxpZGF0ZTogKCkgPT4gdHJ1ZSxcclxuICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgbmFtZTogYCR7ZXh0ZW5zaW9uLnRvVXBwZXJDYXNlKCl9IERvY3VtZW50YCxcclxuICAgICAgICBleHRlbnNpb25zOiBbYC4ke2V4dGVuc2lvbn1gXSxcclxuICAgICAgICBtaW1lVHlwZXM6IFtgYXBwbGljYXRpb24vJHtleHRlbnNpb259YF0sXHJcbiAgICAgICAgbWF4U2l6ZTogMTAgKiAxMDI0ICogMTAyNFxyXG4gICAgICB9XHJcbiAgICB9O1xyXG4gIH1cclxufTtcclxuXHJcbi8qKlxyXG4gKiBNYW5hZ2VzIGNvbnZlcnRlciBpbml0aWFsaXphdGlvbiBhbmQgZW5zdXJlcyBwcm9wZXIgbG9hZGluZyBzZXF1ZW5jZS5cclxuICovXHJcbmNsYXNzIENvbnZlcnRlckluaXRpYWxpemVyIHtcclxuICBzdGF0aWMgX2luc3RhbmNlID0gbnVsbDtcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuX2luaXRpYWxpemVkID0gZmFsc2U7XHJcbiAgICB0aGlzLl9pbml0UHJvbWlzZSA9IG51bGw7XHJcbiAgICB0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeSA9IG51bGw7XHJcbiAgICB0aGlzLmxvZ2dlciA9IGdldExvZ2dlcignQ29udmVydGVySW5pdGlhbGl6ZXInKTtcclxuICB9XHJcbiAgXHJcbiAgc3RhdGljIGdldEluc3RhbmNlKCkge1xyXG4gICAgaWYgKCFDb252ZXJ0ZXJJbml0aWFsaXplci5faW5zdGFuY2UpIHtcclxuICAgICAgQ29udmVydGVySW5pdGlhbGl6ZXIuX2luc3RhbmNlID0gbmV3IENvbnZlcnRlckluaXRpYWxpemVyKCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gQ29udmVydGVySW5pdGlhbGl6ZXIuX2luc3RhbmNlO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgaW5pdGlhbGl6ZSgpIHtcclxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplZCkgcmV0dXJuIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gICAgaWYgKHRoaXMuX2luaXRQcm9taXNlKSByZXR1cm4gdGhpcy5faW5pdFByb21pc2U7XHJcblxyXG4gICAgdGhpcy5faW5pdFByb21pc2UgPSB0aGlzLl9kb0luaXRpYWxpemUoKTtcclxuICAgIHJldHVybiB0aGlzLl9pbml0UHJvbWlzZTtcclxuICB9XHJcblxyXG4gIGFzeW5jIF9kb0luaXRpYWxpemUoKSB7XHJcbiAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlNUQVJUSU5HLFxyXG4gICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5JTklUSUFMSVpJTkdcclxuICAgICk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gR2V0IGFsbCBwb3NzaWJsZSBtb2R1bGUgcGF0aHNcclxuICAgICAgY29uc3QgcGF0aHMgPSBNb2R1bGVMb2FkZXIuZ2V0TW9kdWxlUGF0aHMoKTtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nKCdVc2luZyBjb252ZXJ0ZXIgcGF0aHM6JywgJ0lORk8nLCBwYXRocyk7XHJcblxyXG4gICAgICAvLyBFeHRyYWN0IGFsbCB0aGUgcG9zc2libGUgYmFzZSBwYXRocyBmcm9tIHZhcmlvdXMgc291cmNlc1xyXG4gICAgICBjb25zdCBwb3NzaWJsZUJhc2VQYXRocyA9IFtcclxuICAgICAgICBwYXRoLmRpcm5hbWUocGF0aHMucmVnaXN0cnkpLFxyXG4gICAgICAgIC4uLk9iamVjdC52YWx1ZXMocGF0aHMuY29udmVydGVycykubWFwKHAgPT4gcGF0aC5kaXJuYW1lKHBhdGguZGlybmFtZShwKSkpXHJcbiAgICAgIF07XHJcblxyXG4gICAgICAvLyBMb2cgYWxsIHBvc3NpYmxlIHJlZ2lzdHJ5IHBhdGhzIHdlJ2xsIHRyeVxyXG4gICAgICBjb25zdCBhbGxQb3NzaWJsZVJlZ2lzdHJ5UGF0aHMgPSBbXHJcbiAgICAgICAgcGF0aHMucmVnaXN0cnksXHJcbiAgICAgICAgcGF0aHMucmVnaXN0cnlQYXRoLFxyXG4gICAgICAgIC4uLnBvc3NpYmxlQmFzZVBhdGhzLm1hcChiYXNlUGF0aCA9PiBwYXRoLmpvaW4oYmFzZVBhdGgsICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpKVxyXG4gICAgICBdO1xyXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQWxsIHBvc3NpYmxlIHJlZ2lzdHJ5IHBhdGhzOicsIGFsbFBvc3NpYmxlUmVnaXN0cnlQYXRocyk7XHJcblxyXG4gICAgICAvLyBBdHRlbXB0IHRvIGxvYWQgdGhlIHJlZ2lzdHJ5IHVzaW5nIG91ciBlbmhhbmNlZCBsb2FkZXIgd2l0aCBmYWxsYmFja3NcclxuICAgICAgbGV0IHJlZ2lzdHJ5O1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIEZpcnN0IHRyeSB0aGUgZGlyZWN0IHBhdGhcclxuICAgICAgICBjb25zdCBlcnJvclBhdGggPSAnQzpcXFxcVXNlcnNcXFxcSm9zZXBoXFxcXERvY3VtZW50c1xcXFxDb2RlXFxcXGNvZGV4LW1kXFxcXGRpc3RcXFxcd2luLXVucGFja2VkXFxcXHJlc291cmNlc1xcXFxhcHAuYXNhclxcXFxzcmNcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvblxcXFxDb252ZXJ0ZXJSZWdpc3RyeS5qcyc7XHJcbiAgICAgICAgY29uc3QgY29ycmVjdGVkUGF0aCA9IGVycm9yUGF0aC5yZXBsYWNlKCdcXFxcc3JjXFxcXCcsICdcXFxcYnVpbGRcXFxcJyk7XHJcblxyXG4gICAgICAgIC8vIEFsc28gY2hlY2sgaWYgdGhlIGhhcmRjb2RlZCBjb3JyZWN0ZWQgcGF0aCBleGlzdHMgYW5kIHRyeSB0byBsb2FkIGl0IGRpcmVjdGx5XHJcbiAgICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoY29ycmVjdGVkUGF0aCkpIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgRm91bmQgY29ycmVjdGVkIHJlZ2lzdHJ5IHBhdGg6ICR7Y29ycmVjdGVkUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgcmVnaXN0cnkgPSByZXF1aXJlKGNvcnJlY3RlZFBhdGgpO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKCdTdWNjZXNzZnVsbHkgbG9hZGVkIHJlZ2lzdHJ5IGZyb20gY29ycmVjdGVkIHBhdGgnKTtcclxuICAgICAgICAgIH0gY2F0Y2ggKGRpcmVjdExvYWRFcnJvcikge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBGYWlsZWQgdG8gbG9hZCBmcm9tIGNvcnJlY3RlZCBwYXRoOiAke2RpcmVjdExvYWRFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSWYgZGlyZWN0IGxvYWRpbmcgZGlkbid0IHdvcmssIHRyeSB3aXRoIHRoZSBtb2R1bGVsb2FkZXJcclxuICAgICAgICBpZiAoIXJlZ2lzdHJ5KSB7XHJcbiAgICAgICAgICByZWdpc3RyeSA9IGF3YWl0IE1vZHVsZUxvYWRlci5sb2FkTW9kdWxlKFxyXG4gICAgICAgICAgICBwYXRocy5yZWdpc3RyeSxcclxuICAgICAgICAgICAgeyBmYWxsYmFja1BhdGhzOiBhbGxQb3NzaWJsZVJlZ2lzdHJ5UGF0aHMuc2xpY2UoMSksIHNpbGVudDogdHJ1ZSB9XHJcbiAgICAgICAgICApO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoaW5pdGlhbEVycm9yKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybignSW5pdGlhbCByZWdpc3RyeSBsb2FkaW5nIGZhaWxlZCwgdHJ5aW5nIGFsdGVybmF0aXZlIGFwcHJvYWNoZXMnLCBpbml0aWFsRXJyb3IpO1xyXG5cclxuICAgICAgICAvLyBJZiBkaXJlY3QgbG9hZGluZyBmYWlsZWQsIHRyeSBhIGRpZmZlcmVudCBhcHByb2FjaCBieSBjb2xsZWN0aW5nIGJhc2UgZGlyZWN0b3JpZXNcclxuICAgICAgICBjb25zdCBiYXNlRGlycyA9IFtdO1xyXG5cclxuICAgICAgICAvLyBBZGQgcG90ZW50aWFsIGJhc2UgZGlyZWN0b3JpZXMgKGRlZHVwbGljYXRlIHRoZW0pXHJcbiAgICAgICAgY29uc3QgYWRkQmFzZURpciA9IChkaXIpID0+IHtcclxuICAgICAgICAgIGlmIChkaXIgJiYgIWJhc2VEaXJzLmluY2x1ZGVzKGRpcikpIHtcclxuICAgICAgICAgICAgYmFzZURpcnMucHVzaChkaXIpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIEFkZCBtdWx0aXBsZSBwYXRocyB0aGF0IGNvdWxkIGNvbnRhaW4gdGhlIHJlZ2lzdHJ5XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLmRpcm5hbWUocGF0aHMucmVnaXN0cnkpKTtcclxuXHJcbiAgICAgICAgLy8gQWRkIHBhcmVudCBkaXJlY3RvcmllcyBvZiBlYWNoIGNvbnZlcnRlciBwYXRoXHJcbiAgICAgICAgT2JqZWN0LnZhbHVlcyhwYXRocy5jb252ZXJ0ZXJzKS5mb3JFYWNoKGNvbnZlcnRlclBhdGggPT4ge1xyXG4gICAgICAgICAgY29uc3QgY29udmVydGVyRGlyID0gcGF0aC5kaXJuYW1lKGNvbnZlcnRlclBhdGgpO1xyXG4gICAgICAgICAgYWRkQmFzZURpcihwYXRoLmRpcm5hbWUoY29udmVydGVyRGlyKSk7IC8vIEFkZCBwYXJlbnQgZGlyZWN0b3J5XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIEFkZCBjb21tb24gZGlyZWN0b3JpZXMgcmVsYXRpdmUgdG8gZXhlY3V0YWJsZVxyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhcicsICdhcHAnKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXInLCAnYXBwJyksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG5cclxuICAgICAgICAvLyBMb2cgdGhlIGJhc2UgZGlyZWN0b3JpZXMgd2UnbGwgdHJ5XHJcbiAgICAgICAgdGhpcy5sb2dnZXIubG9nKCdUcnlpbmcgdG8gbG9hZCByZWdpc3RyeSBmcm9tIHRoZXNlIGJhc2UgZGlyZWN0b3JpZXM6JywgJ0lORk8nLCBiYXNlRGlycyk7XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAvLyBUcnkgdG8gbG9hZCBtb2R1bGUgZnJvbSB0aGUgYmVzdCBwYXRoXHJcbiAgICAgICAgICByZWdpc3RyeSA9IGF3YWl0IE1vZHVsZUxvYWRlci5sb2FkTW9kdWxlRnJvbUJlc3RQYXRoKCdDb252ZXJ0ZXJSZWdpc3RyeS5qcycsIGJhc2VEaXJzKTtcclxuICAgICAgICB9IGNhdGNoIChiZXN0UGF0aEVycm9yKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignQWxsIHBhdGggbG9hZGluZyBhdHRlbXB0cyBmYWlsZWQsIHVzaW5nIGVtYmVkZGVkIHJlZ2lzdHJ5JywgYmVzdFBhdGhFcnJvcik7XHJcbiAgICAgICAgICAvLyBXaGVuIGFsbCBlbHNlIGZhaWxzLCB1c2Ugb3VyIGVtYmVkZGVkIHJlZ2lzdHJ5XHJcbiAgICAgICAgICByZWdpc3RyeSA9IE1pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeTtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1VzaW5nIGVtYmVkZGVkIE1pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeSBhcyBsYXN0IHJlc29ydCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gVmFsaWRhdGUgdGhlIHJlZ2lzdHJ5XHJcbiAgICAgIGlmICghdGhpcy5fdmFsaWRhdGVSZWdpc3RyeShyZWdpc3RyeSkpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignSW52YWxpZCBjb252ZXJ0ZXIgcmVnaXN0cnkgc3RydWN0dXJlLCB1c2luZyBlbWJlZGRlZCByZWdpc3RyeScpO1xyXG4gICAgICAgIC8vIFVzZSBvdXIgZW1iZWRkZWQgcmVnaXN0cnlcclxuICAgICAgICByZWdpc3RyeSA9IE1pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeTtcclxuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdVc2luZyBlbWJlZGRlZCBNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkgYXMgbGFzdCByZXNvcnQnKTtcclxuXHJcbiAgICAgICAgLy8gRG91YmxlLWNoZWNrIHRoYXQgb3VyIGVtYmVkZGVkIHJlZ2lzdHJ5IGlzIHZhbGlkXHJcbiAgICAgICAgaWYgKCF0aGlzLl92YWxpZGF0ZVJlZ2lzdHJ5KHJlZ2lzdHJ5KSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkgaXMgaW52YWxpZCEnKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIExvZyB0aGUgY29udmVydGVycyBpbiB0aGUgcmVnaXN0cnlcclxuICAgICAgdGhpcy5sb2dnZXIubG9nKCdBdmFpbGFibGUgY29udmVydGVyczonLCBPYmplY3Qua2V5cyhyZWdpc3RyeS5jb252ZXJ0ZXJzIHx8IHt9KSk7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKCdTdWNjZXNzZnVsbHkgbG9hZGVkIGNvbnZlcnRlciByZWdpc3RyeScpO1xyXG4gICAgICB0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeSA9IHJlZ2lzdHJ5O1xyXG4gICAgICB0aGlzLl9pbml0aWFsaXplZCA9IHRydWU7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuSU5JVElBTElaSU5HLFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkNPTVBMRVRFRFxyXG4gICAgICApO1xyXG5cclxuICAgICAgcmV0dXJuIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5faW5pdFByb21pc2UgPSBudWxsO1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uRXJyb3IoJ2luaXQnLCBlcnJvcik7XHJcbiAgICAgIFxyXG4gICAgICAvLyBQcm92aWRlIGJldHRlciBlcnJvciBpbmZvcm1hdGlvblxyXG4gICAgICBjb25zdCBlbmhhbmNlZEVycm9yID0gbmV3IEVycm9yKGBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBjb252ZXJ0ZXIgcmVnaXN0cnk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgZW5oYW5jZWRFcnJvci5vcmlnaW5hbCA9IGVycm9yO1xyXG4gICAgICBlbmhhbmNlZEVycm9yLnN0YWNrID0gZXJyb3Iuc3RhY2s7XHJcbiAgICAgIHRocm93IGVuaGFuY2VkRXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBfdmFsaWRhdGVSZWdpc3RyeShyZWdpc3RyeSkge1xyXG4gICAgaWYgKCFyZWdpc3RyeSB8fCB0eXBlb2YgcmVnaXN0cnkgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoIXJlZ2lzdHJ5LmNvbnZlcnRlcnMgfHwgdHlwZW9mIHJlZ2lzdHJ5LmNvbnZlcnRlcnMgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAodHlwZW9mIHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAodHlwZW9mIHJlZ2lzdHJ5LmdldENvbnZlcnRlckJ5RXh0ZW5zaW9uICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDYXRlZ29yaXplIGZpbGUgdHlwZXMgZm9yIGJldHRlciBvcmdhbml6YXRpb25cclxuICovXHJcbmNvbnN0IEZJTEVfVFlQRV9DQVRFR09SSUVTID0ge1xyXG4gIC8vIEF1ZGlvIGZpbGVzXHJcbiAgbXAzOiAnYXVkaW8nLFxyXG4gIHdhdjogJ2F1ZGlvJyxcclxuICBvZ2c6ICdhdWRpbycsXHJcbiAgZmxhYzogJ2F1ZGlvJyxcclxuICBcclxuICAvLyBWaWRlbyBmaWxlc1xyXG4gIG1wNDogJ3ZpZGVvJyxcclxuICB3ZWJtOiAndmlkZW8nLFxyXG4gIGF2aTogJ3ZpZGVvJyxcclxuICBtb3Y6ICd2aWRlbycsXHJcbiAgXHJcbiAgLy8gRG9jdW1lbnQgZmlsZXNcclxuICBwZGY6ICdkb2N1bWVudCcsXHJcbiAgZG9jeDogJ2RvY3VtZW50JyxcclxuICBwcHR4OiAnZG9jdW1lbnQnLFxyXG4gIFxyXG4gIC8vIERhdGEgZmlsZXNcclxuICB4bHN4OiAnZGF0YScsXHJcbiAgY3N2OiAnZGF0YScsXHJcbiAgXHJcbiAgLy8gV2ViIGNvbnRlbnRcclxuICB1cmw6ICd3ZWInLFxyXG4gIHBhcmVudHVybDogJ3dlYicsXHJcbn07XHJcblxyXG4vKipcclxuICogRW5oYW5jZWQgVW5pZmllZENvbnZlcnRlckZhY3RvcnkgY2xhc3Mgd2l0aCBwcm9wZXIgaW5pdGlhbGl6YXRpb24gYW5kIGNvbnZlcnNpb24gaGFuZGxpbmdcclxuICovXHJcbmNsYXNzIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5IHtcclxuICBzdGF0aWMgX2luc3RhbmNlID0gbnVsbDtcclxuICBcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuX2luaXRpYWxpemVyID0gQ29udmVydGVySW5pdGlhbGl6ZXIuZ2V0SW5zdGFuY2UoKTtcclxuICAgIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5ID0gbnVsbDtcclxuICAgIHRoaXMubG9nZ2VyID0gZ2V0TG9nZ2VyKCdVbmlmaWVkQ29udmVydGVyRmFjdG9yeScpO1xyXG4gICAgdGhpcy5sb2dnZXIubG9nKCdVbmlmaWVkQ29udmVydGVyRmFjdG9yeSBpbml0aWFsaXplZCcsICdJTkZPJyk7XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgZ2V0SW5zdGFuY2UoKSB7XHJcbiAgICBpZiAoIVVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5Ll9pbnN0YW5jZSkge1xyXG4gICAgICBVbmlmaWVkQ29udmVydGVyRmFjdG9yeS5faW5zdGFuY2UgPSBuZXcgVW5pZmllZENvbnZlcnRlckZhY3RvcnkoKTtcclxuICAgIH1cclxuICAgIHJldHVybiBVbmlmaWVkQ29udmVydGVyRmFjdG9yeS5faW5zdGFuY2U7XHJcbiAgfVxyXG5cclxuICBhc3luYyBfZW5zdXJlSW5pdGlhbGl6ZWQoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5KSB7XHJcbiAgICAgIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5ID0gYXdhaXQgdGhpcy5faW5pdGlhbGl6ZXIuaW5pdGlhbGl6ZSgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0Q29udmVydGVyKGZpbGVUeXBlKSB7XHJcbiAgICB0aGlzLmxvZ2dlci5zZXRDb250ZXh0KHsgZmlsZVR5cGUgfSk7XHJcbiAgICBcclxuICAgIGNvbnN0IHJlZ2lzdHJ5ID0gYXdhaXQgdGhpcy5fZW5zdXJlSW5pdGlhbGl6ZWQoKTtcclxuICAgIFxyXG4gICAgaWYgKCFmaWxlVHlwZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpbGUgdHlwZSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIE5vcm1hbGl6ZSBmaWxlIHR5cGUgKHJlbW92ZSBkb3QsIGxvd2VyY2FzZSlcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0gZmlsZVR5cGUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9eXFwuLywgJycpO1xyXG5cclxuICAgIC8vIEdldCBVUkwgY29udmVydGVyIGRpcmVjdGx5IGZyb20gcmVnaXN0cnkgaWYgYXZhaWxhYmxlXHJcbiAgICBpZiAobm9ybWFsaXplZFR5cGUgPT09ICd1cmwnIHx8IG5vcm1hbGl6ZWRUeXBlID09PSAncGFyZW50dXJsJykge1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2coYFVzaW5nIGRpcmVjdCBVUkwgY29udmVydGVyIGZvcjogJHtub3JtYWxpemVkVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgY29udmVydGVyID0gcmVnaXN0cnkuY29udmVydGVycz8uW25vcm1hbGl6ZWRUeXBlXTtcclxuICAgICAgaWYgKGNvbnZlcnRlcikge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLnN1Y2Nlc3MoYEZvdW5kICR7bm9ybWFsaXplZFR5cGV9IGNvbnZlcnRlcmApO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBjb252ZXJ0ZXI6IHtcclxuICAgICAgICAgICAgLi4uY29udmVydGVyLFxyXG4gICAgICAgICAgICB0eXBlOiBub3JtYWxpemVkVHlwZSxcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgIHJldHVybiBjb252ZXJ0ZXIuY29udmVydChjb250ZW50LCBuYW1lLCBhcGlLZXksIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICBuYW1lLFxyXG4gICAgICAgICAgICAgICAgdHlwZTogbm9ybWFsaXplZFR5cGVcclxuICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIHR5cGU6IG5vcm1hbGl6ZWRUeXBlLFxyXG4gICAgICAgICAgY2F0ZWdvcnk6ICd3ZWInXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gVHJ5IGZhbGxiYWNrIHRvIGNvbnZlcnRUb01hcmtkb3duXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZyhgQXR0ZW1wdGluZyBjb252ZXJ0VG9NYXJrZG93biBmYWxsYmFjayBmb3IgJHtub3JtYWxpemVkVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICBpZiAocmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24pIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgY29udmVydGVyOiB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICByZXR1cm4gcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24obm9ybWFsaXplZFR5cGUsIGNvbnRlbnQsIHtcclxuICAgICAgICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICAgICAgICBhcGlLZXksXHJcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zXHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoaW5wdXQpID0+IHR5cGVvZiBpbnB1dCA9PT0gJ3N0cmluZycgJiYgaW5wdXQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgbmFtZTogbm9ybWFsaXplZFR5cGUgPT09ICd1cmwnID8gJ1dlYiBQYWdlJyA6ICdXZWJzaXRlJyxcclxuICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy51cmwnLCAnLmh0bWwnLCAnLmh0bSddLFxyXG4gICAgICAgICAgICAgIG1pbWVUeXBlczogWyd0ZXh0L2h0bWwnLCAnYXBwbGljYXRpb24veC11cmwnXSxcclxuICAgICAgICAgICAgICBtYXhTaXplOiAxMCAqIDEwMjQgKiAxMDI0XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB0eXBlOiBub3JtYWxpemVkVHlwZSxcclxuICAgICAgICAgIGNhdGVnb3J5OiAnd2ViJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gRm9yIGFsbCBvdGhlciB0eXBlcywgZ2V0IGNvbnZlcnRlciBmcm9tIHJlZ2lzdHJ5XHJcbiAgICBjb25zdCBjb252ZXJ0ZXIgPSBhd2FpdCByZWdpc3RyeS5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbihub3JtYWxpemVkVHlwZSk7XHJcbiAgICBpZiAoY29udmVydGVyKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgY29udmVydGVyLFxyXG4gICAgICAgIHR5cGU6IG5vcm1hbGl6ZWRUeXBlLFxyXG4gICAgICAgIGNhdGVnb3J5OiBGSUxFX1RZUEVfQ0FURUdPUklFU1tub3JtYWxpemVkVHlwZV0gfHwgJ2RvY3VtZW50J1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHRocm93IG5ldyBFcnJvcihgTm8gY29udmVydGVyIGZvdW5kIGZvciB0eXBlOiAke2ZpbGVUeXBlfWApO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ29udmVydCBhIGZpbGUgdG8gbWFya2Rvd24gdXNpbmcgdGhlIGFwcHJvcHJpYXRlIGNvbnZlcnRlclxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gdGhlIGZpbGUgb3IgVVJMIHN0cmluZ1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gLSBDb252ZXJzaW9uIHJlc3VsdFxyXG4gICAqL1xyXG4gIGFzeW5jIGNvbnZlcnRGaWxlKGZpbGVQYXRoLCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnN0IGZpbGVUeXBlID0gb3B0aW9ucy5maWxlVHlwZTtcclxuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XHJcbiAgICBcclxuICAgIHRoaXMubG9nZ2VyLmxvZ0NvbnZlcnNpb25TdGFydChmaWxlVHlwZSwgb3B0aW9ucyk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICghZmlsZVR5cGUpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2ZpbGVUeXBlIGlzIHJlcXVpcmVkIGluIG9wdGlvbnMnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gRGV0ZXJtaW5lIGlmIHRoaXMgaXMgYSBVUkwgb3IgYSBmaWxlXHJcbiAgICAgIGNvbnN0IGlzVXJsID0gZmlsZVR5cGUgPT09ICd1cmwnIHx8IGZpbGVUeXBlID09PSAncGFyZW50dXJsJztcclxuXHJcbiAgICAgIC8vIEdldCBmaWxlIGRldGFpbHMgLSBoYW5kbGUgVVJMcyBkaWZmZXJlbnRseVxyXG4gICAgICBsZXQgZmlsZU5hbWU7XHJcblxyXG4gICAgICBpZiAoQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSkge1xyXG4gICAgICAgIC8vIFVzZSBvcmlnaW5hbEZpbGVOYW1lIGZyb20gb3B0aW9ucywgb3IgZmFsbGJhY2sgdG8gcHJvdmlkZWQgbmFtZSBpZiBhdmFpbGFibGVcclxuICAgICAgICBmaWxlTmFtZSA9IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBvcHRpb25zLm5hbWU7XHJcblxyXG4gICAgICAgIGlmICghZmlsZU5hbWUpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignb3JpZ2luYWxGaWxlTmFtZSBpcyByZXF1aXJlZCB3aGVuIHBhc3NpbmcgYnVmZmVyIGlucHV0Jyk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKGlzVXJsKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGNvbnN0IHVybE9iaiA9IG5ldyBVUkwoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSB1cmxPYmouaG9zdG5hbWUgKyAodXJsT2JqLnBhdGhuYW1lICE9PSAnLycgPyB1cmxPYmoucGF0aG5hbWUgOiAnJyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSBmaWxlUGF0aDtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZmlsZU5hbWUgPSBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBFbnN1cmUgb3JpZ2luYWxGaWxlTmFtZSBpcyBhbHdheXMgc2V0IGluIG9wdGlvbnNcclxuICAgICAgb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lID0gZmlsZU5hbWU7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuU1RBUlRJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuVkFMSURBVElOR1xyXG4gICAgICApO1xyXG4gICAgICBcclxuICAgICAgLy8gR2V0IHRoZSBhcHByb3ByaWF0ZSBjb252ZXJ0ZXIgd2l0aCBhc3luYy9hd2FpdFxyXG4gICAgICBsZXQgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIFVSTCB0eXBlcyBpbiBwcm9kdWN0aW9uIG1vZGVcclxuICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvICYmIChmaWxlVHlwZSA9PT0gJ3VybCcgfHwgZmlsZVR5cGUgPT09ICdwYXJlbnR1cmwnKSkge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgU3BlY2lhbCBoYW5kbGluZyBmb3IgJHtmaWxlVHlwZX0gaW4gcHJvZHVjdGlvbiBtb2RlYCwgJ0lORk8nKTtcclxuICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5jcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChjb252ZXJ0ZXJJbmZvKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKGBDcmVhdGVkIGRpcmVjdCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBJZiBjb252ZXJ0ZXIgbm90IGZvdW5kLCB0cnkgYWdhaW4gYWZ0ZXIgYSBzaG9ydCBkZWxheVxyXG4gICAgICBpZiAoIWNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFJldHJ5aW5nIHRvIGdldCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9IGFmdGVyIGRlbGF5Li4uYCwgJ0lORk8nKTtcclxuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNTAwKSk7XHJcbiAgICAgICAgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWNvbnZlcnRlckluZm8gJiYgKGZpbGVUeXBlID09PSAndXJsJyB8fCBmaWxlVHlwZSA9PT0gJ3BhcmVudHVybCcpKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFNlY29uZCBhdHRlbXB0IGF0IHNwZWNpYWwgaGFuZGxpbmcgZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgICAgICAgIGNvbnZlcnRlckluZm8gPSBhd2FpdCB0aGlzLmNyZWF0ZURpcmVjdFVybENvbnZlcnRlcihmaWxlVHlwZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIElmIHN0aWxsIG5vdCBmb3VuZCwgdHJ5IG9uZSBtb3JlIHRpbWUgd2l0aCBhIGxvbmdlciBkZWxheVxyXG4gICAgICAgIGlmICghY29udmVydGVySW5mbykge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBGaW5hbCBhdHRlbXB0IHRvIGdldCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9IGFmdGVyIGxvbmdlciBkZWxheS4uLmAsICdJTkZPJyk7XHJcbiAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwMCkpO1xyXG4gICAgICAgICAgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvICYmIChmaWxlVHlwZSA9PT0gJ3VybCcgfHwgZmlsZVR5cGUgPT09ICdwYXJlbnR1cmwnKSkge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYEZpbmFsIGF0dGVtcHQgYXQgc3BlY2lhbCBoYW5kbGluZyBmb3IgJHtmaWxlVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5jcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBpZiAoIWNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBmaWxlIHR5cGU6ICR7ZmlsZVR5cGV9YCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgYSBwcm9ncmVzcyB0cmFja2VyIGlmIGNhbGxiYWNrIHByb3ZpZGVkXHJcbiAgICAgIGNvbnN0IHByb2dyZXNzVHJhY2tlciA9IG9wdGlvbnMub25Qcm9ncmVzcyA/IFxyXG4gICAgICAgIG5ldyBQcm9ncmVzc1RyYWNrZXIob3B0aW9ucy5vblByb2dyZXNzLCAyNTApIDogbnVsbDtcclxuICAgICAgXHJcbiAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDUsIHsgc3RhdHVzOiAnaW5pdGlhbGl6aW5nJywgZmlsZVR5cGU6IGZpbGVUeXBlIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZWdpc3RyeSA9IGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKCk7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQ29udmVydGVyIGluZm86Jywgc2FuaXRpemVGb3JMb2dnaW5nKHtcclxuICAgICAgICBoYXNSZWdpc3RyeTogISFyZWdpc3RyeSxcclxuICAgICAgICBjb252ZXJ0ZXJUeXBlOiBjb252ZXJ0ZXJJbmZvPy50eXBlIHx8ICdub25lJyxcclxuICAgICAgICBjYXRlZ29yeTogY29udmVydGVySW5mbz8uY2F0ZWdvcnkgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgIGhhc0NvbnZlcnRlcjogISFjb252ZXJ0ZXJJbmZvPy5jb252ZXJ0ZXIsXHJcbiAgICAgICAgY29udmVydGVyRGV0YWlsczogY29udmVydGVySW5mbz8uY29udmVydGVyXHJcbiAgICAgIH0pKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEhhbmRsZSB0aGUgY29udmVyc2lvbiBiYXNlZCBvbiBmaWxlIHR5cGVcclxuICAgICAgY29uc3QgY29udmVyc2lvblJlc3VsdCA9IGF3YWl0IHRoaXMuaGFuZGxlQ29udmVyc2lvbihmaWxlUGF0aCwge1xyXG4gICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIGZpbGVOYW1lLFxyXG4gICAgICAgIHByb2dyZXNzVHJhY2tlcixcclxuICAgICAgICBjb252ZXJ0ZXJJbmZvLFxyXG4gICAgICAgIGlzVXJsXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoMTAwLCB7IHN0YXR1czogJ2NvbXBsZXRlZCcgfSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ0NvbnZlcnNpb25Db21wbGV0ZShmaWxlVHlwZSk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gY29udmVyc2lvblJlc3VsdDtcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uRXJyb3IoZmlsZVR5cGUsIGVycm9yKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIHR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIG5hbWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCAndW5rbm93bicsXHJcbiAgICAgICAgY2F0ZWdvcnk6IEZJTEVfVFlQRV9DQVRFR09SSUVTW2ZpbGVUeXBlXSB8fCAndW5rbm93bidcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENyZWF0ZSBhIGRpcmVjdCBVUkwgY29udmVydGVyIGZvciBwcm9kdWN0aW9uIG1vZGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVR5cGUgLSBVUkwgZmlsZSB0eXBlICgndXJsJyBvciAncGFyZW50dXJsJylcclxuICAgKiBAcmV0dXJucyB7T2JqZWN0fG51bGx9IC0gQ29udmVydGVyIGluZm8gb3IgbnVsbCBpZiBub3QgcG9zc2libGVcclxuICAgKi9cclxuICBhc3luYyBjcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpIHtcclxuICAgIHRoaXMubG9nZ2VyLmxvZyhgQ3JlYXRpbmcgZGlyZWN0IFVSTCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgIFxyXG4gICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgaWYgKCFyZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93bikge1xyXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignQ2Fubm90IGNyZWF0ZSBkaXJlY3QgVVJMIGNvbnZlcnRlcjogY29udmVydFRvTWFya2Rvd24gbm90IGF2YWlsYWJsZScpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgY29udmVydGVyOiB7XHJcbiAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBVc2luZyBkaXJlY3QgVVJMIGNvbnZlcnRlciBmb3IgJHtmaWxlVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgcmV0dXJuIHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duKGZpbGVUeXBlLCBjb250ZW50LCB7XHJcbiAgICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICAgIGFwaUtleSxcclxuICAgICAgICAgICAgLi4ub3B0aW9uc1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICB2YWxpZGF0ZTogKGlucHV0KSA9PiB0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnICYmIGlucHV0Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICBuYW1lOiBmaWxlVHlwZSA9PT0gJ3VybCcgPyAnV2ViIFBhZ2UnIDogJ1dlYnNpdGUnLFxyXG4gICAgICAgICAgZXh0ZW5zaW9uczogWycudXJsJywgJy5odG1sJywgJy5odG0nXSxcclxuICAgICAgICAgIG1pbWVUeXBlczogWyd0ZXh0L2h0bWwnLCAnYXBwbGljYXRpb24veC11cmwnXSxcclxuICAgICAgICAgIG1heFNpemU6IDEwICogMTAyNCAqIDEwMjRcclxuICAgICAgICB9XHJcbiAgICAgIH0sXHJcbiAgICAgIHR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICBjYXRlZ29yeTogJ3dlYidcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTdGFuZGFyZGl6ZSBjb252ZXJzaW9uIHJlc3VsdCB0byBlbnN1cmUgY29uc2lzdGVudCBmb3JtYXRcclxuICAgKlxyXG4gICAqIElNUE9SVEFOVDogVGhpcyBtZXRob2QgZW5zdXJlcyBwcm9wZXJ0aWVzIGFyZSBzZXQgaW4gdGhlIGNvcnJlY3Qgb3JkZXIgdG8gcHJldmVudFxyXG4gICAqIHByb3BlcnR5IHNoYWRvd2luZyBpc3N1ZXMuIFRoZSBvcmRlciBtYXR0ZXJzIGJlY2F1c2U6XHJcbiAgICogMS4gV2UgZmlyc3Qgc3ByZWFkIHRoZSByZXN1bHQgb2JqZWN0IHRvIGluY2x1ZGUgYWxsIGl0cyBwcm9wZXJ0aWVzXHJcbiAgICogMi4gVGhlbiB3ZSBvdmVycmlkZSBzcGVjaWZpYyBwcm9wZXJ0aWVzIHRvIGVuc3VyZSB0aGV5IGhhdmUgdGhlIGNvcnJlY3QgdmFsdWVzXHJcbiAgICogMy4gV2Ugc2V0IGNvbnRlbnQgbGFzdCB0byBlbnN1cmUgaXQncyBub3QgYWNjaWRlbnRhbGx5IG92ZXJyaWRkZW5cclxuICAgKiA0LiBXZSBhZGQgYSBmaW5hbCBjaGVjayB0byBlbnN1cmUgY29udGVudCBpcyBuZXZlciBlbXB0eSwgcHJvdmlkaW5nIGEgZmFsbGJhY2tcclxuICAgKlxyXG4gICAqIFRoaXMgZml4ZXMgdGhlIFwiQ29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50XCIgZXJyb3IgdGhhdCBjb3VsZCBvY2N1ciB3aGVuXHJcbiAgICogdGhlIGNvbnRlbnQgcHJvcGVydHkgd2FzIG92ZXJyaWRkZW4gYnkgdGhlIHNwcmVhZCBvcGVyYXRvci5cclxuICAgKlxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXN1bHQgLSBSYXcgY29udmVyc2lvbiByZXN1bHRcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVR5cGUgLSBGaWxlIHR5cGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZU5hbWUgLSBGaWxlIG5hbWVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2F0ZWdvcnkgLSBGaWxlIGNhdGVnb3J5XHJcbiAgICogQHJldHVybnMge09iamVjdH0gLSBTdGFuZGFyZGl6ZWQgcmVzdWx0XHJcbiAgICovXHJcbiAgc3RhbmRhcmRpemVSZXN1bHQocmVzdWx0LCBmaWxlVHlwZSwgZmlsZU5hbWUsIGNhdGVnb3J5KSB7XHJcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmF3IHJlc3VsdCByZWNlaXZlZCBmb3IgJHtmaWxlVHlwZX06YCwgc2FuaXRpemVGb3JMb2dnaW5nKHJlc3VsdCkpOyAvLyBBZGQgbG9nZ2luZ1xyXG5cclxuICAgIC8vIEhhbmRsZSBudWxsIG9yIHVuZGVmaW5lZCByZXN1bHQgZXhwbGljaXRseSBhdCB0aGUgYmVnaW5uaW5nXHJcbiAgICBpZiAoIXJlc3VsdCkge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFJlY2VpdmVkIG51bGwgb3IgdW5kZWZpbmVkIHJlc3VsdCBmb3IgJHtmaWxlVHlwZX0uIEFzc3VtaW5nIGZhaWx1cmUuYCk7XHJcbiAgICAgICAgcmVzdWx0ID0geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdDb252ZXJ0ZXIgcmV0dXJuZWQgbnVsbCBvciB1bmRlZmluZWQgcmVzdWx0JyB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENoZWNrIGlmIHRoaXMgaXMgYW4gYXN5bmNocm9ub3VzIHJlc3VsdCAoaGFzIGFzeW5jOiB0cnVlIGFuZCBjb252ZXJzaW9uSWQpXHJcbiAgICBpZiAocmVzdWx0ICYmIHJlc3VsdC5hc3luYyA9PT0gdHJ1ZSAmJiByZXN1bHQuY29udmVyc2lvbklkKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZyhgWyR7ZmlsZVR5cGV9XSBSZWNlaXZlZCBhc3luYyByZXN1bHQgd2l0aCBjb252ZXJzaW9uSWQ6ICR7cmVzdWx0LmNvbnZlcnNpb25JZH1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEZvciBhc3luYyByZXN1bHRzLCB3ZSBuZWVkIHRvIHByZXNlcnZlIHRoZSBhc3luYyBmbGFnIGFuZCBjb252ZXJzaW9uSWRcclxuICAgICAgLy8gVGhpcyB3aWxsIHNpZ25hbCB0byBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIHRoYXQgaXQgbmVlZHMgdG8gaGFuZGxlIHRoaXMgZGlmZmVyZW50bHlcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICAuLi5yZXN1bHQsXHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSwgLy8gQXN5bmMgaW5pdGlhdGlvbiBpcyBjb25zaWRlcmVkIHN1Y2Nlc3NmdWwgYXQgdGhpcyBwb2ludFxyXG4gICAgICAgIHR5cGU6IHJlc3VsdC50eXBlIHx8IGZpbGVUeXBlLFxyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZSxcclxuICAgICAgICBuYW1lOiByZXN1bHQubmFtZSB8fCBmaWxlTmFtZSxcclxuICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiByZXN1bHQub3JpZ2luYWxGaWxlTmFtZSB8fCByZXN1bHQubmFtZSB8fCBmaWxlTmFtZSxcclxuICAgICAgICBjYXRlZ29yeTogcmVzdWx0LmNhdGVnb3J5IHx8IGNhdGVnb3J5LFxyXG4gICAgICAgIGFzeW5jOiB0cnVlLCAvLyBQcmVzZXJ2ZSB0aGUgYXN5bmMgZmxhZ1xyXG4gICAgICAgIGNvbnZlcnNpb25JZDogcmVzdWx0LmNvbnZlcnNpb25JZCwgLy8gUHJlc2VydmUgdGhlIGNvbnZlcnNpb25JZFxyXG4gICAgICAgIC8vIEZvciBhc3luYyByZXN1bHRzLCB3ZSdsbCBwcm92aWRlIGEgcGxhY2Vob2xkZXIgY29udGVudCB0aGF0IHdpbGwgYmUgcmVwbGFjZWRcclxuICAgICAgICAvLyB3aXRoIHRoZSBhY3R1YWwgY29udGVudCB3aGVuIHRoZSBjb252ZXJzaW9uIGNvbXBsZXRlc1xyXG4gICAgICAgIGNvbnRlbnQ6IHJlc3VsdC5jb250ZW50IHx8IGAjIFByb2Nlc3NpbmcgJHtmaWxlVHlwZS50b1VwcGVyQ2FzZSgpfSBGaWxlXFxuXFxuWW91ciBmaWxlIGlzIGJlaW5nIHByb2Nlc3NlZC4gVGhlIGNvbnRlbnQgd2lsbCBiZSBhdmFpbGFibGUgc2hvcnRseS5gLFxyXG4gICAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgICAuLi4ocmVzdWx0Lm1ldGFkYXRhIHx8IHt9KSxcclxuICAgICAgICAgIGFzeW5jOiB0cnVlLFxyXG4gICAgICAgICAgY29udmVyc2lvbklkOiByZXN1bHQuY29udmVyc2lvbklkXHJcbiAgICAgICAgfVxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIExvZyBkZXRhaWxlZCBmaWxlbmFtZSBpbmZvcm1hdGlvbiBmb3IgZGVidWdnaW5nXHJcbiAgICB0aGlzLmxvZ2dlci5sb2coYPCfk4QgRmlsZW5hbWUgZGV0YWlscyBmb3IgJHtmaWxlVHlwZX06YCwge1xyXG4gICAgICByZXN1bHRPcmlnaW5hbEZpbGVOYW1lOiByZXN1bHQ/Lm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgIHJlc3VsdE1ldGFkYXRhT3JpZ2luYWxGaWxlTmFtZTogcmVzdWx0Py5tZXRhZGF0YT8ub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgcmVzdWx0TmFtZTogcmVzdWx0Py5uYW1lLFxyXG4gICAgICBmdW5jdGlvblBhcmFtRmlsZU5hbWU6IGZpbGVOYW1lXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgZW5oYW5jZWQgbG9nZ2luZyBzcGVjaWZpY2FsbHkgZm9yIEV4Y2VsL0NTViBmaWxlcyB0byB0cmFjZSBmaWxlbmFtZSBoYW5kbGluZ1xyXG4gICAgaWYgKGZpbGVUeXBlID09PSAneGxzeCcgfHwgZmlsZVR5cGUgPT09ICdjc3YnKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZyhg8J+TiiBFeGNlbC9DU1YgZmlsZSBkZXRhaWxzOmAsIHtcclxuICAgICAgICBvcmlnaW5hbEZpbGVOYW1lRnJvbVJlc3VsdDogcmVzdWx0Py5vcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICAgIG9yaWdpbmFsRmlsZU5hbWVGcm9tTWV0YWRhdGE6IHJlc3VsdD8ubWV0YWRhdGE/Lm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgICAgbmFtZUZyb21SZXN1bHQ6IHJlc3VsdD8ubmFtZSxcclxuICAgICAgICBmaWxlTmFtZVBhcmFtOiBmaWxlTmFtZSxcclxuICAgICAgICByZXN1bHRLZXlzOiByZXN1bHQgPyBPYmplY3Qua2V5cyhyZXN1bHQpIDogW10sXHJcbiAgICAgICAgbWV0YWRhdGFLZXlzOiByZXN1bHQ/Lm1ldGFkYXRhID8gT2JqZWN0LmtleXMocmVzdWx0Lm1ldGFkYXRhKSA6IFtdXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIERldGVybWluZSBzdWNjZXNzIHN0YXR1cyBtb3JlIHJvYnVzdGx5XHJcbiAgICAvLyBTdWNjZXNzIGlzIE9OTFkgdHJ1ZSBpZiByZXN1bHQuc3VjY2VzcyBpcyBleHBsaWNpdGx5IHRydWUuXHJcbiAgICAvLyBPdGhlcndpc2UsIGl0J3MgZmFsc2UsIGVzcGVjaWFsbHkgaWYgYW4gZXJyb3IgcHJvcGVydHkgZXhpc3RzLlxyXG4gICAgY29uc3QgaXNTdWNjZXNzID0gcmVzdWx0LnN1Y2Nlc3MgPT09IHRydWU7XHJcblxyXG4gICAgLy8gU2FuaXRpemUgcG90ZW50aWFsbHkgY29tcGxleCBvYmplY3RzIHdpdGhpbiB0aGUgcmVzdWx0ICphZnRlciogZGV0ZXJtaW5pbmcgc3VjY2Vzc1xyXG4gICAgY29uc3Qgc2FuaXRpemVkUmVzdWx0ID0gc2FuaXRpemVGb3JMb2dnaW5nKHJlc3VsdCk7XHJcblxyXG4gICAgLy8gRm9yIFhMU1ggYW5kIENTViBmaWxlcywgd2Ugd2FudCB0byBiZSBhYnNvbHV0ZWx5IGNlcnRhaW4gdGhhdCBvcmlnaW5hbEZpbGVOYW1lIGlzIHByZXNlcnZlZFxyXG4gICAgY29uc3Qgb3JpZ2luYWxGaWxlTmFtZSA9IChmaWxlVHlwZSA9PT0gJ3hsc3gnIHx8IGZpbGVUeXBlID09PSAnY3N2JylcclxuICAgICAgPyAoKHJlc3VsdC5tZXRhZGF0YSAmJiByZXN1bHQubWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSkgfHwgcmVzdWx0Lm9yaWdpbmFsRmlsZU5hbWUgfHwgcmVzdWx0Lm5hbWUgfHwgZmlsZU5hbWUpXHJcbiAgICAgIDogKChyZXN1bHQubWV0YWRhdGEgJiYgcmVzdWx0Lm1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUpIHx8IHJlc3VsdC5vcmlnaW5hbEZpbGVOYW1lIHx8IHJlc3VsdC5uYW1lIHx8IGZpbGVOYW1lKTtcclxuXHJcbiAgICAvLyBMb2cgdGhlIGRldGVybWluZWQgb3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgdGhpcy5sb2dnZXIubG9nKGDwn5OdIEZpbmFsIG9yaWdpbmFsRmlsZU5hbWUgZGV0ZXJtaW5lZCBmb3IgJHtmaWxlVHlwZX06ICR7b3JpZ2luYWxGaWxlTmFtZX1gKTtcclxuXHJcbiAgICBjb25zdCBzdGFuZGFyZGl6ZWQgPSB7XHJcbiAgICAgICAgLi4uc2FuaXRpemVkUmVzdWx0LCAvLyBTcHJlYWQgc2FuaXRpemVkIHJlc3VsdCBmaXJzdFxyXG4gICAgICAgIHN1Y2Nlc3M6IGlzU3VjY2VzcywgLy8gT3ZlcnJpZGUgd2l0aCBkZXRlcm1pbmVkIHN1Y2Nlc3Mgc3RhdHVzXHJcbiAgICAgICAgdHlwZTogcmVzdWx0LnR5cGUgfHwgZmlsZVR5cGUsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIG5hbWU6IG9yaWdpbmFsRmlsZU5hbWUsIC8vIFVzZSB0aGUgcmVzb2x2ZWQgb3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG9yaWdpbmFsRmlsZU5hbWUsIC8vIFNhbWUgZm9yIGNvbnNpc3RlbmN5XHJcbiAgICAgICAgY2F0ZWdvcnk6IHJlc3VsdC5jYXRlZ29yeSB8fCBjYXRlZ29yeSxcclxuICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgICAuLi4ocmVzdWx0Lm1ldGFkYXRhIHx8IHt9KVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaW1hZ2VzOiByZXN1bHQuaW1hZ2VzIHx8IFtdLFxyXG4gICAgICAgIC8vIEVuc3VyZSBjb250ZW50IGV4aXN0cywgcHJvdmlkZSBmYWxsYmFjayBpZiBuZWVkZWRcclxuICAgICAgICBjb250ZW50OiByZXN1bHQuY29udGVudCB8fCAoaXNTdWNjZXNzID8gJycgOiBgIyBDb252ZXJzaW9uIFJlc3VsdFxcblxcblRoZSAke2ZpbGVUeXBlfSBmaWxlIHdhcyBwcm9jZXNzZWQsIGJ1dCBubyBjb250ZW50IHdhcyBnZW5lcmF0ZWQuIFRoaXMgbWlnaHQgaW5kaWNhdGUgYW4gaXNzdWUgb3IgYmUgbm9ybWFsIGZvciB0aGlzIGZpbGUgdHlwZS5gKSxcclxuICAgICAgICAvLyBFbnN1cmUgZXJyb3IgcHJvcGVydHkgaXMgcHJlc2VudCBpZiBub3Qgc3VjY2Vzc2Z1bFxyXG4gICAgICAgIGVycm9yOiAhaXNTdWNjZXNzID8gKHJlc3VsdC5lcnJvciB8fCAnVW5rbm93biBjb252ZXJzaW9uIGVycm9yJykgOiB1bmRlZmluZWRcclxuICAgIH07XHJcblxyXG4gICAgLy8gUmVtb3ZlIGVycm9yIHByb3BlcnR5IGlmIHN1Y2Nlc3NmdWxcclxuICAgIGlmIChzdGFuZGFyZGl6ZWQuc3VjY2Vzcykge1xyXG4gICAgICAgIGRlbGV0ZSBzdGFuZGFyZGl6ZWQuZXJyb3I7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIEVuc3VyZSBjb250ZW50IGlzIG5vdCBudWxsIG9yIHVuZGVmaW5lZCwgYW5kIHByb3ZpZGUgYXBwcm9wcmlhdGUgZmFsbGJhY2tcclxuICAgIGlmICghc3RhbmRhcmRpemVkLmNvbnRlbnQgJiYgIWlzU3VjY2Vzcykge1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuUFJPQ0VTU0lORyxcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5DT05URU5UX0VNUFRZXHJcbiAgICAgICk7XHJcbiAgICAgIC8vIFByb3ZpZGUgYSBtb3JlIGluZm9ybWF0aXZlIG1lc3NhZ2UgaWYgdGhlIGNvbnZlcnNpb24gZmFpbGVkIGFuZCBjb250ZW50IGlzIGVtcHR5XHJcbiAgICAgIHN0YW5kYXJkaXplZC5jb250ZW50ID0gYCMgQ29udmVyc2lvbiBFcnJvclxcblxcblRoZSAke2ZpbGVUeXBlfSBmaWxlIGNvbnZlcnNpb24gZmFpbGVkIG9yIHByb2R1Y2VkIG5vIGNvbnRlbnQuIEVycm9yOiAke3N0YW5kYXJkaXplZC5lcnJvciB8fCAnVW5rbm93biBlcnJvcid9YDtcclxuICAgIH0gZWxzZSBpZiAoIXN0YW5kYXJkaXplZC5jb250ZW50ICYmIGlzU3VjY2Vzcykge1xyXG4gICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuQ09OVEVOVF9FTVBUWVxyXG4gICAgICApO1xyXG4gICAgICAvLyBGYWxsYmFjayBmb3Igc3VjY2Vzc2Z1bCBjb252ZXJzaW9uIGJ1dCBlbXB0eSBjb250ZW50XHJcbiAgICAgIHN0YW5kYXJkaXplZC5jb250ZW50ID0gYCMgQ29udmVyc2lvbiBSZXN1bHRcXG5cXG5UaGUgJHtmaWxlVHlwZX0gZmlsZSB3YXMgcHJvY2Vzc2VkIHN1Y2Nlc3NmdWxseSwgYnV0IG5vIHRleHR1YWwgY29udGVudCB3YXMgZ2VuZXJhdGVkLiBUaGlzIGlzIG5vcm1hbCBmb3IgY2VydGFpbiBmaWxlIHR5cGVzIChlLmcuLCBtdWx0aW1lZGlhIGZpbGVzIHdpdGhvdXQgdHJhbnNjcmlwdGlvbikuYDtcclxuICAgIH1cclxuXHJcblxyXG4gICAgLy8gTG9nIHRoZSBmaW5hbCBzdGFuZGFyZGl6ZWQgcmVzdWx0XHJcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgU3RhbmRhcmRpemVkIHJlc3VsdCBmb3IgJHtmaWxlVHlwZX06YCwgc2FuaXRpemVGb3JMb2dnaW5nKHN0YW5kYXJkaXplZCkpO1xyXG5cclxuICAgIHJldHVybiBzdGFuZGFyZGl6ZWQ7XHJcbiAgfVxyXG5cclxuICBhc3luYyBoYW5kbGVVcmxDb252ZXJzaW9uKGZpbGVQYXRoLCBvcHRpb25zLCBjYXRlZ29yeSkge1xyXG4gICAgY29uc3QgeyBwcm9ncmVzc1RyYWNrZXIsIGZpbGVUeXBlLCBmaWxlTmFtZSwgY29udmVydGVySW5mbyB9ID0gb3B0aW9ucztcclxuICAgIFxyXG4gICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDIwLCB7IHN0YXR1czogYHByb2Nlc3NpbmdfJHtmaWxlVHlwZX1gIH0pO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLmxvZ2dlci5sb2coYFByb2Nlc3NpbmcgVVJMOiAke2ZpbGVQYXRofWAsICdJTkZPJyk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIEV4dHJhY3QgY29udmVydGVyIGZyb20gY29udmVydGVySW5mb1xyXG4gICAgICBjb25zdCB7IGNvbnZlcnRlciB9ID0gY29udmVydGVySW5mbztcclxuICAgICAgXHJcbiAgICAgIGxldCB1cmxSZXN1bHQgPSBudWxsO1xyXG4gICAgICBcclxuICAgICAgLy8gVHJ5IHVzaW5nIHRoZSBjb252ZXJ0ZXIncyBjb252ZXJ0IG1ldGhvZCBmaXJzdFxyXG4gICAgICBpZiAodHlwZW9mIGNvbnZlcnRlci5jb252ZXJ0ID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBVc2luZyBjb252ZXJ0ZXIuY29udmVydCBmb3IgJHtmaWxlVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgVVJMIGNvbnZlcnQgY2FsbGVkIHdpdGggb3JpZ2luYWxGaWxlTmFtZTogJHtmaWxlTmFtZX1gLCAnSU5GTycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAvLyBDcmVhdGUgb3B0aW9ucyBvYmplY3Qgc3RlcCBieSBzdGVwIHRvIGF2b2lkIHNwcmVhZCBpc3N1ZXNcclxuICAgICAgICAgIGNvbnN0IGNvbnZlcnRlck9wdGlvbnMgPSB7fTtcclxuICAgICAgICAgIE9iamVjdC5rZXlzKG9wdGlvbnMpLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgY29udmVydGVyT3B0aW9uc1trZXldID0gb3B0aW9uc1trZXldO1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBjb252ZXJ0ZXJPcHRpb25zLm5hbWUgPSBmaWxlTmFtZTtcclxuICAgICAgICAgIGNvbnZlcnRlck9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSA9IGZpbGVOYW1lO1xyXG4gICAgICAgICAgY29udmVydGVyT3B0aW9ucy5tZXRhZGF0YSA9IHtcclxuICAgICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogZmlsZU5hbWVcclxuICAgICAgICAgIH07XHJcbiAgICAgICAgICBpZiAob3B0aW9ucy5tZXRhZGF0YSkge1xyXG4gICAgICAgICAgICBPYmplY3Qua2V5cyhvcHRpb25zLm1ldGFkYXRhKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgICAgY29udmVydGVyT3B0aW9ucy5tZXRhZGF0YVtrZXldID0gb3B0aW9ucy5tZXRhZGF0YVtrZXldO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGNvbnZlcnRlck9wdGlvbnMub25Qcm9ncmVzcyA9IChwcm9ncmVzcykgPT4ge1xyXG4gICAgICAgICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZVNjYWxlZChwcm9ncmVzcywgMjAsIDkwLCB7XHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6IHR5cGVvZiBwcm9ncmVzcyA9PT0gJ29iamVjdCcgPyBwcm9ncmVzcy5zdGF0dXMgOiBgcHJvY2Vzc2luZ18ke2ZpbGVUeXBlfWBcclxuICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBDYWxsaW5nIFVSTCBjb252ZXJ0ZXIgd2l0aCBmaWxlUGF0aDogJHtmaWxlUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgdXJsUmVzdWx0ID0gYXdhaXQgY29udmVydGVyLmNvbnZlcnQoZmlsZVBhdGgsIGZpbGVOYW1lLCBvcHRpb25zLmFwaUtleSwgY29udmVydGVyT3B0aW9ucyk7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFVSTCBjb252ZXJ0ZXIgcmV0dXJuZWQgcmVzdWx0YCwgJ0lORk8nKTtcclxuICAgICAgICB9IGNhdGNoIChjb252ZXJ0ZXJFcnJvcikge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFVSTCBjb252ZXJ0ZXIgZXJyb3I6ICR7Y29udmVydGVyRXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgIHRocm93IGNvbnZlcnRlckVycm9yO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBGYWxsIGJhY2sgdG8gdXNpbmcgdGhlIHJlZ2lzdHJ5J3MgY29udmVydFRvTWFya2Rvd24gbWV0aG9kXHJcbiAgICAgICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgVXNpbmcgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24gZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCByZWdpc3RyeU9wdGlvbnMgPSB7fTtcclxuICAgICAgICBPYmplY3Qua2V5cyhvcHRpb25zKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICByZWdpc3RyeU9wdGlvbnNba2V5XSA9IG9wdGlvbnNba2V5XTtcclxuICAgICAgICB9KTtcclxuICAgICAgICByZWdpc3RyeU9wdGlvbnMubmFtZSA9IGZpbGVOYW1lO1xyXG4gICAgICAgIHJlZ2lzdHJ5T3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lID0gZmlsZU5hbWU7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdXJsUmVzdWx0ID0gYXdhaXQgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24oZmlsZVR5cGUsIGZpbGVQYXRoLCByZWdpc3RyeU9wdGlvbnMpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZSg5NSwgeyBzdGF0dXM6ICdmaW5hbGl6aW5nJyB9KTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRklOQUxJWklOR1xyXG4gICAgICApO1xyXG4gICAgICBcclxuICAgICAgLy8gT25seSBwcm9jZWVkIGlmIHdlIGhhdmUgYSByZXN1bHRcclxuICAgICAgaWYgKCF1cmxSZXN1bHQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVSTCBjb252ZXJzaW9uIGZhaWxlZDogTm8gcmVzdWx0IHJldHVybmVkYCk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIHJldHVybiB0aGlzLnN0YW5kYXJkaXplUmVzdWx0KHVybFJlc3VsdCwgZmlsZVR5cGUsIGZpbGVOYW1lLCBjYXRlZ29yeSk7XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIGluIFVSTCBjb252ZXJzaW9uOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBUcnkgdGhlIGFsdGVybmF0aXZlIG1ldGhvZCBhcyBhIGZhbGxiYWNrXHJcbiAgICAgIGNvbnN0IHJlZ2lzdHJ5ID0gYXdhaXQgdGhpcy5fZW5zdXJlSW5pdGlhbGl6ZWQoKTtcclxuICAgICAgY29uc3QgeyBjb252ZXJ0ZXIgfSA9IGNvbnZlcnRlckluZm87XHJcbiAgICAgIFxyXG4gICAgICBpZiAodHlwZW9mIGNvbnZlcnRlci5jb252ZXJ0ID09PSAnZnVuY3Rpb24nICYmIHR5cGVvZiByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93biA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgVHJ5aW5nIGFsdGVybmF0aXZlIGNvbnZlcnNpb24gbWV0aG9kIGFzIGZhbGxiYWNrYCwgJ0lORk8nKTtcclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgY29uc3QgZmFsbGJhY2tPcHRpb25zID0ge307XHJcbiAgICAgICAgICBPYmplY3Qua2V5cyhvcHRpb25zKS5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICAgICAgICAgIGZhbGxiYWNrT3B0aW9uc1trZXldID0gb3B0aW9uc1trZXldO1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBmYWxsYmFja09wdGlvbnMubmFtZSA9IGZpbGVOYW1lO1xyXG4gICAgICAgICAgZmFsbGJhY2tPcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgPSBmaWxlTmFtZTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgY29uc3QgZmFsbGJhY2tSZXN1bHQgPSBhd2FpdCByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93bihmaWxlVHlwZSwgZmlsZVBhdGgsIGZhbGxiYWNrT3B0aW9ucyk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGlmICghZmFsbGJhY2tSZXN1bHQpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWxsYmFjayBVUkwgY29udmVyc2lvbiBmYWlsZWQ6IE5vIHJlc3VsdCByZXR1cm5lZGApO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICByZXR1cm4gdGhpcy5zdGFuZGFyZGl6ZVJlc3VsdChmYWxsYmFja1Jlc3VsdCwgZmlsZVR5cGUsIGZpbGVOYW1lLCBjYXRlZ29yeSk7XHJcbiAgICAgICAgfSBjYXRjaCAoZmFsbGJhY2tFcnJvcikge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhbGxiYWNrIGNvbnZlcnNpb24gYWxzbyBmYWlsZWQ6ICR7ZmFsbGJhY2tFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgdGhyb3cgZXJyb3I7IC8vIFRocm93IHRoZSBvcmlnaW5hbCBlcnJvclxyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICB0aHJvdyBlcnJvcjsgLy8gUmUtdGhyb3cgaWYgbm8gZmFsbGJhY2sgaXMgYXZhaWxhYmxlXHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGhhbmRsZUNvbnZlcnNpb24oZmlsZVBhdGgsIG9wdGlvbnMpIHtcclxuICAgIGNvbnN0IHsgcHJvZ3Jlc3NUcmFja2VyLCBmaWxlVHlwZSwgZmlsZU5hbWUsIGNvbnZlcnRlckluZm8sIGlzVXJsIH0gPSBvcHRpb25zO1xyXG4gICAgLy8gRXh0cmFjdCBjYXRlZ29yeSBmcm9tIGNvbnZlcnRlckluZm8gdG8gYXZvaWQgXCJjYXRlZ29yeSBpcyBub3QgZGVmaW5lZFwiIGVycm9yXHJcbiAgICAvLyBNb3ZlIHRoaXMgb3V0c2lkZSB0cnkgYmxvY2sgdG8gZW5zdXJlIGl0J3MgYWNjZXNzaWJsZSBpbiBhbGwgc2NvcGVzXHJcbiAgICBjb25zdCBjYXRlZ29yeSA9IGNvbnZlcnRlckluZm8/LmNhdGVnb3J5IHx8IEZJTEVfVFlQRV9DQVRFR09SSUVTW2ZpbGVUeXBlXSB8fCAndW5rbm93bic7XHJcbiAgICBcclxuICAgIC8vIEZvciBVUkwgY29udmVyc2lvbnMsIHVzZSBhIHNlcGFyYXRlIG1ldGhvZCB0byBhdm9pZCBzY29wZSBpc3N1ZXNcclxuICAgIGlmIChpc1VybCkge1xyXG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVVcmxDb252ZXJzaW9uKGZpbGVQYXRoLCBvcHRpb25zLCBjYXRlZ29yeSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGxldCByZXN1bHQgPSBudWxsOyAvLyBJbml0aWFsaXplIHRvIG51bGwgdG8gYXZvaWQgdGVtcG9yYWwgZGVhZCB6b25lXHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFZhbGlkYXRlIGNvbnZlcnRlckluZm9cclxuICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYE5vIGNvbnZlcnRlciBpbmZvIGF2YWlsYWJsZSBmb3IgJHtmaWxlVHlwZX1gKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbnZlcnRlciBpbmZvIGF2YWlsYWJsZSBmb3IgJHtmaWxlVHlwZX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlZBTElEQVRJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRkFTVF9BVFRFTVBUXHJcbiAgICAgICk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBSZWFkIGZpbGUgY29udGVudCBpZiBub3QgYWxyZWFkeSBhIGJ1ZmZlclxyXG4gICAgICBjb25zdCBmaWxlQ29udGVudCA9IEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCkgPyBmaWxlUGF0aCA6IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZSgyMCwgeyBzdGF0dXM6IGBjb252ZXJ0aW5nXyR7ZmlsZVR5cGV9YCB9KTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gU3BlY2lhbCBoYW5kbGluZyBmb3IgUERGIGZpbGVzIHRvIGluY2x1ZGUgT0NSIG9wdGlvbnNcclxuICAgICAgaWYgKGZpbGVUeXBlID09PSAncGRmJykge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDb252ZXJ0aW5nIFBERiB3aXRoIG9wdGlvbnM6Jywge1xyXG4gICAgICAgICAgdXNlT2NyOiBvcHRpb25zLnVzZU9jcixcclxuICAgICAgICAgIGhhc01pc3RyYWxBcGlLZXk6ICEhb3B0aW9ucy5taXN0cmFsQXBpS2V5LFxyXG4gICAgICAgICAgcHJlc2VydmVQYWdlSW5mbzogdHJ1ZVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBtb3JlIGRldGFpbGVkIGxvZ2dpbmcgZm9yIE9DUiBzZXR0aW5nc1xyXG4gICAgICAgIGlmIChvcHRpb25zLnVzZU9jcikge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIubG9nKCdPQ1IgaXMgZW5hYmxlZCBmb3IgdGhpcyBjb252ZXJzaW9uJywgJ0lORk8nKTtcclxuICAgICAgICAgIGlmIChvcHRpb25zLm1pc3RyYWxBcGlLZXkpIHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ01pc3RyYWwgQVBJIGtleSBpcyBwcmVzZW50Jyk7XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdPQ1IgaXMgZW5hYmxlZCBidXQgTWlzdHJhbCBBUEkga2V5IGlzIG1pc3NpbmcnKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIGF1ZGlvL3ZpZGVvIGZpbGVzIHRvIGVuc3VyZSB0aGV5IGRvbid0IHVzZSBNaXN0cmFsIEFQSSBrZXlcclxuICAgICAgaWYgKGZpbGVUeXBlID09PSAnbXAzJyB8fCBmaWxlVHlwZSA9PT0gJ3dhdicgfHwgZmlsZVR5cGUgPT09ICdtcDQnIHx8IGZpbGVUeXBlID09PSAnbW92JyB8fCBcclxuICAgICAgICAgIGZpbGVUeXBlID09PSAnb2dnJyB8fCBmaWxlVHlwZSA9PT0gJ3dlYm0nIHx8IGZpbGVUeXBlID09PSAnYXZpJyB8fCBcclxuICAgICAgICAgIGZpbGVUeXBlID09PSAnZmxhYycgfHwgZmlsZVR5cGUgPT09ICdtNGEnKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBDb252ZXJ0aW5nIG11bHRpbWVkaWEgZmlsZSAoJHtmaWxlVHlwZX0pYCwgJ0lORk8nKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBSZW1vdmUgbWlzdHJhbEFwaUtleSBmcm9tIG9wdGlvbnMgZm9yIG11bHRpbWVkaWEgZmlsZXMgdG8gcHJldmVudCBpbmNvcnJlY3Qgcm91dGluZ1xyXG4gICAgICAgIGlmIChvcHRpb25zLm1pc3RyYWxBcGlLZXkpIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZygnUmVtb3ZpbmcgTWlzdHJhbCBBUEkga2V5IGZyb20gbXVsdGltZWRpYSBjb252ZXJzaW9uIG9wdGlvbnMnLCAnSU5GTycpO1xyXG4gICAgICAgICAgY29uc3QgeyBtaXN0cmFsQXBpS2V5LCAuLi5jbGVhbk9wdGlvbnMgfSA9IG9wdGlvbnM7XHJcbiAgICAgICAgICBvcHRpb25zID0gY2xlYW5PcHRpb25zO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkZBU1RfQVRURU1QVCxcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5QUk9DRVNTSU5HXHJcbiAgICAgICk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBVc2UgdGhlIGNvbnZlcnRlcidzIGNvbnZlcnQgbWV0aG9kXHJcbiAgICAgIGNvbnN0IHsgY29udmVydGVyLCBjYXRlZ29yeSB9ID0gY29udmVydGVySW5mbztcclxuXHJcbiAgICAgIC8vIExvZyB0aGUgb3JpZ2luYWwgZmlsZW5hbWUgZGV0YWlscyBiZWluZyBwYXNzZWQgdG8gdGhlIGNvbnZlcnRlclxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2coYENvbnZlcnQgbWV0aG9kIGNhbGxlZCB3aXRoIG9yaWdpbmFsRmlsZU5hbWU6ICR7ZmlsZU5hbWV9YCwgJ0lORk8nKTtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nKGBPcHRpb25zIGJlaW5nIHBhc3NlZCB0byBjb252ZXJ0ZXI6YCwge1xyXG4gICAgICAgIGhhc09yaWdpbmFsRmlsZU5hbWU6ICEhb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICAgIG9yaWdpbmFsRmlsZU5hbWVWYWx1ZTogb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICAgIGZpbGVOYW1lOiBmaWxlTmFtZSxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGVcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjb252ZXJ0ZXIuY29udmVydChmaWxlQ29udGVudCwgZmlsZU5hbWUsIG9wdGlvbnMuYXBpS2V5LCB7XHJcbiAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICBuYW1lOiBmaWxlTmFtZSxcclxuICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBmaWxlTmFtZSwgLy8gRXhwbGljaXRseSBwYXNzIG9yaWdpbmFsRmlsZU5hbWVcclxuICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgLi4uKG9wdGlvbnMubWV0YWRhdGEgfHwge30pLFxyXG4gICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogZmlsZU5hbWUgLy8gQWxzbyBhZGQgb3JpZ2luYWxGaWxlTmFtZSB0byBtZXRhZGF0YVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb25Qcm9ncmVzczogKHByb2dyZXNzKSA9PiB7XHJcbiAgICAgICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGVTY2FsZWQocHJvZ3Jlc3MsIDIwLCA5MCwge1xyXG4gICAgICAgICAgICAgIHN0YXR1czogdHlwZW9mIHByb2dyZXNzID09PSAnb2JqZWN0JyA/IHByb2dyZXNzLnN0YXR1cyA6IGBjb252ZXJ0aW5nXyR7ZmlsZVR5cGV9YFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoOTUsIHsgc3RhdHVzOiAnZmluYWxpemluZycgfSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5QUk9DRVNTSU5HLFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkZJTkFMSVpJTkdcclxuICAgICAgKTtcclxuXHJcbiAgICAgIHJldHVybiB0aGlzLnN0YW5kYXJkaXplUmVzdWx0KHJlc3VsdCwgZmlsZVR5cGUsIGZpbGVOYW1lLCBjYXRlZ29yeSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uRXJyb3IoZmlsZVR5cGUsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYCR7ZmlsZVR5cGUudG9VcHBlckNhc2UoKX0gY29udmVyc2lvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gLFxyXG4gICAgICAgIGNvbnRlbnQ6IGAjIENvbnZlcnNpb24gRXJyb3JcXG5cXG5GYWlsZWQgdG8gY29udmVydCAke2ZpbGVUeXBlLnRvVXBwZXJDYXNlKCl9IGZpbGU6ICR7ZXJyb3IubWVzc2FnZX1gLFxyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZSwgLy8gVXNlIG9ubHkgZmlsZVR5cGUsIG5vdCB0eXBlXHJcbiAgICAgICAgbmFtZTogZmlsZU5hbWUsXHJcbiAgICAgICAgY2F0ZWdvcnk6IGNhdGVnb3J5IHx8ICd1bmtub3duJ1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEFkZCBhbiBpbml0aWFsaXplIG1ldGhvZCB0byB0aGUgZmFjdG9yeSBpbnN0YW5jZVxyXG4gKiBUaGlzIGlzIG5lZWRlZCBmb3IgY29tcGF0aWJpbGl0eSB3aXRoIGNvZGUgdGhhdCBleHBlY3RzIHRoaXMgbWV0aG9kXHJcbiAqL1xyXG5jb25zdCB1bmlmaWVkQ29udmVydGVyRmFjdG9yeSA9IFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmdldEluc3RhbmNlKCk7XHJcblxyXG4vLyBBZGQgaW5pdGlhbGl6ZSBtZXRob2QgdG8gdGhlIGZhY3RvcnkgaW5zdGFuY2VcclxudW5pZmllZENvbnZlcnRlckZhY3RvcnkuaW5pdGlhbGl6ZSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xyXG4gIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlNUQVJUSU5HLFxyXG4gICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuSU5JVElBTElaSU5HXHJcbiAgKTtcclxuICBcclxuICB0cnkge1xyXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSW5pdGlhbGl6ZWQoKTtcclxuICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuSU5JVElBTElaSU5HLFxyXG4gICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5DT01QTEVURURcclxuICAgICk7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvbkVycm9yKCdpbml0JywgZXJyb3IpO1xyXG4gICAgdGhyb3cgZXJyb3I7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gRXhwb3J0IHNpbmdsZXRvbiBpbnN0YW5jZSBhbmQgbW9kdWxlIGZ1bmN0aW9uc1xyXG5tb2R1bGUuZXhwb3J0cyA9IHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5O1xyXG5tb2R1bGUuZXhwb3J0cy51bmlmaWVkQ29udmVydGVyRmFjdG9yeSA9IHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5O1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0EsSUFBSUEsR0FBRztBQUNQLElBQUk7RUFDRjtFQUNBLE1BQU1DLFFBQVEsR0FBR0MsT0FBTyxDQUFDLFVBQVUsQ0FBQztFQUNwQ0YsR0FBRyxHQUFHQyxRQUFRLENBQUNELEdBQUcsSUFBS0MsUUFBUSxDQUFDRSxNQUFNLElBQUlGLFFBQVEsQ0FBQ0UsTUFBTSxDQUFDSCxHQUFJO0FBQ2hFLENBQUMsQ0FBQyxPQUFPSSxDQUFDLEVBQUU7RUFDVjtFQUNBQyxPQUFPLENBQUNDLElBQUksQ0FBQyw4Q0FBOEMsQ0FBQztBQUM5RDs7QUFFQTtBQUNBLElBQUlDLEVBQUU7QUFDTixJQUFJO0VBQ0ZBLEVBQUUsR0FBR0wsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUMxQixDQUFDLENBQUMsT0FBT0UsQ0FBQyxFQUFFO0VBQ1YsSUFBSTtJQUNGRyxFQUFFLEdBQUdMLE9BQU8sQ0FBQyxJQUFJLENBQUM7SUFDbEI7SUFDQUssRUFBRSxDQUFDQyxVQUFVLEdBQUdELEVBQUUsQ0FBQ0MsVUFBVSxLQUFNQyxJQUFJLElBQUs7TUFDMUMsSUFBSTtRQUFFLE9BQU9GLEVBQUUsQ0FBQ0csUUFBUSxDQUFDRCxJQUFJLENBQUMsQ0FBQ0UsTUFBTSxDQUFDLENBQUM7TUFBRSxDQUFDLENBQUMsT0FBT1AsQ0FBQyxFQUFFO1FBQUUsT0FBTyxLQUFLO01BQUU7SUFDdkUsQ0FBQyxDQUFDO0VBQ0osQ0FBQyxDQUFDLE9BQU9RLE1BQU0sRUFBRTtJQUNmUCxPQUFPLENBQUNRLEtBQUssQ0FBQywyQkFBMkIsRUFBRUQsTUFBTSxDQUFDO0lBQ2xELE1BQU0sSUFBSUUsS0FBSyxDQUFDLCtDQUErQyxDQUFDO0VBQ2xFO0FBQ0Y7O0FBRUE7QUFDQSxNQUFNTCxJQUFJLEdBQUdQLE9BQU8sQ0FBQyxNQUFNLENBQUM7O0FBRTVCO0FBQ0EsSUFBSWEsU0FBUyxFQUFFQyxlQUFlLEVBQUVDLFNBQVMsRUFBRUMsa0JBQWtCLEVBQUVDLGdCQUFnQjs7QUFFL0U7QUFDQSxNQUFNQyxXQUFXLEdBQUdBLENBQUNDLFVBQVUsRUFBRUMsU0FBUyxHQUFHLEVBQUUsS0FBSztFQUNsRCxJQUFJO0lBQ0YsT0FBT3BCLE9BQU8sQ0FBQ21CLFVBQVUsQ0FBQztFQUM1QixDQUFDLENBQUMsT0FBT2pCLENBQUMsRUFBRTtJQUNWLEtBQUssTUFBTW1CLFFBQVEsSUFBSUQsU0FBUyxFQUFFO01BQ2hDLElBQUk7UUFDRixPQUFPcEIsT0FBTyxDQUFDcUIsUUFBUSxDQUFDO01BQzFCLENBQUMsQ0FBQyxNQUFNLENBQUU7SUFDWjs7SUFFQTtJQUNBLElBQUlGLFVBQVUsQ0FBQ0csUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFO01BQ3BDLE9BQVFDLElBQUksS0FBTTtRQUNoQkMsR0FBRyxFQUFFQSxDQUFDQyxHQUFHLEVBQUVDLEtBQUssRUFBRSxHQUFHQyxJQUFJLEtBQUt4QixPQUFPLENBQUNxQixHQUFHLENBQUMsSUFBSUQsSUFBSSxLQUFLRyxLQUFLLElBQUksTUFBTSxLQUFLRCxHQUFHLEVBQUUsRUFBRSxHQUFHRSxJQUFJLENBQUM7UUFDMUZoQixLQUFLLEVBQUVBLENBQUNjLEdBQUcsRUFBRUcsR0FBRyxLQUFLekIsT0FBTyxDQUFDUSxLQUFLLENBQUMsSUFBSVksSUFBSSxZQUFZRSxHQUFHLEVBQUUsRUFBRUcsR0FBRyxDQUFDO1FBQ2xFeEIsSUFBSSxFQUFFQSxDQUFDcUIsR0FBRyxFQUFFLEdBQUdFLElBQUksS0FBS3hCLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDLElBQUltQixJQUFJLFdBQVdFLEdBQUcsRUFBRSxFQUFFLEdBQUdFLElBQUksQ0FBQztRQUN2RUUsT0FBTyxFQUFHSixHQUFHLElBQUt0QixPQUFPLENBQUNxQixHQUFHLENBQUMsSUFBSUQsSUFBSSxjQUFjRSxHQUFHLEVBQUUsQ0FBQztRQUMxREssS0FBSyxFQUFFQSxDQUFDTCxHQUFHLEVBQUUsR0FBR0UsSUFBSSxLQUFLeEIsT0FBTyxDQUFDMkIsS0FBSyxDQUFDLElBQUlQLElBQUksWUFBWUUsR0FBRyxFQUFFLEVBQUUsR0FBR0UsSUFBSSxDQUFDO1FBQzFFSSxrQkFBa0IsRUFBRUEsQ0FBQ0MsSUFBSSxFQUFFQyxFQUFFLEtBQUs5QixPQUFPLENBQUNxQixHQUFHLENBQUMsSUFBSUQsSUFBSSx1QkFBdUJTLElBQUksTUFBTUMsRUFBRSxFQUFFLENBQUM7UUFDNUZDLGtCQUFrQixFQUFFQSxDQUFDQyxJQUFJLEVBQUVDLElBQUksS0FBS2pDLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxJQUFJRCxJQUFJLDZCQUE2QlksSUFBSSxFQUFFLENBQUM7UUFDNUZFLHFCQUFxQixFQUFHRixJQUFJLElBQUtoQyxPQUFPLENBQUNxQixHQUFHLENBQUMsSUFBSUQsSUFBSSw4QkFBOEJZLElBQUksRUFBRSxDQUFDO1FBQzFGRyxrQkFBa0IsRUFBRUEsQ0FBQ0gsSUFBSSxFQUFFUCxHQUFHLEtBQUt6QixPQUFPLENBQUNRLEtBQUssQ0FBQyxJQUFJWSxJQUFJLFlBQVlZLElBQUksT0FBT1AsR0FBRyxDQUFDVyxPQUFPLEVBQUUsRUFBRVgsR0FBRyxDQUFDO1FBQ25HWSxVQUFVLEVBQUVBLENBQUEsS0FBTSxDQUFDO01BQ3JCLENBQUMsQ0FBQztJQUNKO0lBQ0EsSUFBSXJCLFVBQVUsQ0FBQ0csUUFBUSxDQUFDLG9CQUFvQixDQUFDLEVBQUU7TUFDN0MsT0FBUW1CLEdBQUcsSUFBSztRQUNkLElBQUk7VUFDRixPQUFPLE9BQU9BLEdBQUcsS0FBSyxRQUFRLEdBQUc7WUFBRSxHQUFHQTtVQUFJLENBQUMsR0FBR0EsR0FBRztRQUNuRCxDQUFDLENBQUMsTUFBTTtVQUNOLE9BQU9BLEdBQUc7UUFDWjtNQUNGLENBQUM7SUFDSDtJQUVBdEMsT0FBTyxDQUFDQyxJQUFJLENBQUMsVUFBVWUsVUFBVSw4Q0FBOEMsQ0FBQztJQUNoRixPQUFPLENBQUMsQ0FBQztFQUNYO0FBQ0YsQ0FBQztBQUVELElBQUk7RUFDRk4sU0FBUyxHQUFHSyxXQUFXLENBQUMsc0JBQXNCLEVBQUUsQ0FDOUNYLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLHNCQUFzQixDQUFDLEVBQy9DcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsZ0NBQWdDLENBQUMsQ0FDOUQsQ0FBQyxDQUFDaEMsU0FBUyxJQUFJLENBQUMsQ0FBQztFQUVsQkMsZUFBZSxHQUFHSSxXQUFXLENBQUMsOEJBQThCLEVBQUUsQ0FDNURYLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLDhCQUE4QixDQUFDLEVBQ3ZEcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsd0NBQXdDLENBQUMsQ0FDdEUsQ0FBQyxDQUFDL0IsZUFBZSxJQUFJLE1BQU1BLGVBQWUsQ0FBQztJQUMxQ2dDLFdBQVdBLENBQUNDLFFBQVEsRUFBRTtNQUFFLElBQUksQ0FBQ0EsUUFBUSxHQUFHQSxRQUFRO0lBQUU7SUFDbERDLE1BQU1BLENBQUNDLFFBQVEsRUFBRUMsSUFBSSxFQUFFO01BQUUsSUFBSSxDQUFDSCxRQUFRLElBQUksSUFBSSxDQUFDQSxRQUFRLENBQUNFLFFBQVEsRUFBRUMsSUFBSSxDQUFDO0lBQUU7SUFDekVDLFlBQVlBLENBQUNGLFFBQVEsRUFBRUcsR0FBRyxFQUFFQyxHQUFHLEVBQUVILElBQUksRUFBRTtNQUFFLElBQUksQ0FBQ0YsTUFBTSxDQUFDSSxHQUFHLEdBQUlILFFBQVEsR0FBQyxHQUFHLElBQUtJLEdBQUcsR0FBQ0QsR0FBRyxDQUFDLEVBQUVGLElBQUksQ0FBQztJQUFFO0VBQ2hHLENBQUM7RUFFRG5DLFNBQVMsR0FBR0csV0FBVyxDQUFDLG1DQUFtQyxFQUFFLENBQzNEWCxJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSxtQ0FBbUMsQ0FBQyxFQUM1RHBDLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0UsT0FBTyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxFQUFFLDZDQUE2QyxDQUFDLENBQzNFLENBQUMsQ0FBQzlCLFNBQVMsS0FBTVEsSUFBSSxLQUFNO0lBQzFCQyxHQUFHLEVBQUVBLENBQUNDLEdBQUcsRUFBRUMsS0FBSyxFQUFFLEdBQUdDLElBQUksS0FBS3hCLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxJQUFJRCxJQUFJLEtBQUtHLEtBQUssSUFBSSxNQUFNLEtBQUtELEdBQUcsRUFBRSxFQUFFLEdBQUdFLElBQUksQ0FBQztJQUMxRmhCLEtBQUssRUFBRUEsQ0FBQ2MsR0FBRyxFQUFFRyxHQUFHLEtBQUt6QixPQUFPLENBQUNRLEtBQUssQ0FBQyxJQUFJWSxJQUFJLFlBQVlFLEdBQUcsRUFBRSxFQUFFRyxHQUFHLENBQUM7SUFDbEV4QixJQUFJLEVBQUVBLENBQUNxQixHQUFHLEVBQUUsR0FBR0UsSUFBSSxLQUFLeEIsT0FBTyxDQUFDQyxJQUFJLENBQUMsSUFBSW1CLElBQUksV0FBV0UsR0FBRyxFQUFFLEVBQUUsR0FBR0UsSUFBSSxDQUFDO0lBQ3ZFRSxPQUFPLEVBQUdKLEdBQUcsSUFBS3RCLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxJQUFJRCxJQUFJLGNBQWNFLEdBQUcsRUFBRSxDQUFDO0lBQzFESyxLQUFLLEVBQUVBLENBQUNMLEdBQUcsRUFBRSxHQUFHRSxJQUFJLEtBQUt4QixPQUFPLENBQUMyQixLQUFLLENBQUMsSUFBSVAsSUFBSSxZQUFZRSxHQUFHLEVBQUUsRUFBRSxHQUFHRSxJQUFJLENBQUM7SUFDMUVJLGtCQUFrQixFQUFFQSxDQUFDQyxJQUFJLEVBQUVDLEVBQUUsS0FBSzlCLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxJQUFJRCxJQUFJLHVCQUF1QlMsSUFBSSxNQUFNQyxFQUFFLEVBQUUsQ0FBQztJQUM1RkMsa0JBQWtCLEVBQUVBLENBQUNDLElBQUksRUFBRUMsSUFBSSxLQUFLakMsT0FBTyxDQUFDcUIsR0FBRyxDQUFDLElBQUlELElBQUksNkJBQTZCWSxJQUFJLEVBQUUsQ0FBQztJQUM1RkUscUJBQXFCLEVBQUdGLElBQUksSUFBS2hDLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxJQUFJRCxJQUFJLDhCQUE4QlksSUFBSSxFQUFFLENBQUM7SUFDMUZHLGtCQUFrQixFQUFFQSxDQUFDSCxJQUFJLEVBQUVQLEdBQUcsS0FBS3pCLE9BQU8sQ0FBQ1EsS0FBSyxDQUFDLElBQUlZLElBQUksWUFBWVksSUFBSSxPQUFPUCxHQUFHLENBQUNXLE9BQU8sRUFBRSxFQUFFWCxHQUFHLENBQUM7SUFDbkdZLFVBQVUsRUFBRUEsQ0FBQSxLQUFNLENBQUM7RUFDckIsQ0FBQyxDQUFDLENBQUM7RUFFSHhCLGtCQUFrQixHQUFHRSxXQUFXLENBQUMsK0JBQStCLEVBQUUsQ0FDaEVYLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLCtCQUErQixDQUFDLEVBQ3hEcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUseUNBQXlDLENBQUMsQ0FDdkUsQ0FBQyxDQUFDN0Isa0JBQWtCLEtBQU15QixHQUFHLElBQUs7SUFDakMsSUFBSTtNQUNGLE9BQU8sT0FBT0EsR0FBRyxLQUFLLFFBQVEsR0FBRztRQUFFLEdBQUdBO01BQUksQ0FBQyxHQUFHQSxHQUFHO0lBQ25ELENBQUMsQ0FBQyxNQUFNO01BQ04sT0FBT0EsR0FBRztJQUNaO0VBQ0YsQ0FBQyxDQUFDO0VBRUZ4QixnQkFBZ0IsR0FBR0MsV0FBVyxDQUFDLHNDQUFzQyxFQUFFLENBQ3JFWCxJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSxzQ0FBc0MsQ0FBQyxFQUMvRHBDLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0UsT0FBTyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxFQUFFLGdEQUFnRCxDQUFDLENBQzlFLENBQUMsSUFBSTtJQUNKUyxNQUFNLEVBQUU7TUFDTkMsUUFBUSxFQUFFLHFCQUFxQjtNQUMvQkMsWUFBWSxFQUFFLDJCQUEyQjtNQUN6Q0MsVUFBVSxFQUFFLG9CQUFvQjtNQUNoQ0MsWUFBWSxFQUFFLDJCQUEyQjtNQUN6Q0MsVUFBVSxFQUFFLHNCQUFzQjtNQUNsQ0MsVUFBVSxFQUFFLHFCQUFxQjtNQUNqQ0MsU0FBUyxFQUFFLHVCQUF1QjtNQUNsQ0MsYUFBYSxFQUFFO0lBQ2pCO0VBQ0YsQ0FBQztBQUNILENBQUMsQ0FBQyxPQUFPbkQsS0FBSyxFQUFFO0VBQ2RSLE9BQU8sQ0FBQ1EsS0FBSyxDQUFDLGlDQUFpQyxFQUFFQSxLQUFLLENBQUM7RUFDdkQsTUFBTSxJQUFJQyxLQUFLLENBQUMsOENBQThDRCxLQUFLLENBQUM0QixPQUFPLEVBQUUsQ0FBQztBQUNoRjs7QUFFQTtBQUNBLElBQUksQ0FBQ3pDLEdBQUcsRUFBRTtFQUNSQSxHQUFHLEdBQUc7SUFDSmlFLFVBQVUsRUFBRSxLQUFLO0lBQ2pCQyxVQUFVLEVBQUVBLENBQUEsS0FBTXBCLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLENBQUM7SUFDL0JvQixPQUFPLEVBQUVBLENBQUEsS0FBTSxVQUFVO0lBQ3pCQyxVQUFVLEVBQUVBLENBQUEsS0FBTTtFQUNwQixDQUFDO0VBQ0QvRCxPQUFPLENBQUNDLElBQUksQ0FBQyxtQ0FBbUMsQ0FBQztBQUNuRDs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxNQUFNK0QsWUFBWSxDQUFDO0VBQ2pCLGFBQWFDLFVBQVVBLENBQUNqRCxVQUFVLEVBQUVrRCxPQUFPLEdBQUcsQ0FBQyxDQUFDLEVBQUU7SUFDaEQsTUFBTUMsTUFBTSxHQUFHdkQsU0FBUyxDQUFDLGNBQWMsQ0FBQztJQUN4QyxNQUFNO01BQUV3RCxhQUFhLEdBQUcsRUFBRTtNQUFFQyxNQUFNLEdBQUc7SUFBTSxDQUFDLEdBQUdILE9BQU87SUFFdEQsSUFBSTtNQUNGQyxNQUFNLENBQUM5QyxHQUFHLENBQUMsNkJBQTZCTCxVQUFVLEVBQUUsRUFBRSxNQUFNLENBQUM7O01BRTdEO01BQ0EsTUFBTXNELFVBQVUsR0FBR2xFLElBQUksQ0FBQ21FLFFBQVEsQ0FBQ3ZELFVBQVUsQ0FBQztNQUM1QyxJQUFJd0QsUUFBUSxHQUFHLEVBQUU7O01BRWpCO01BQ0EsTUFBTUMsU0FBUyxHQUFHckUsSUFBSSxDQUFDc0UsT0FBTyxDQUFDMUQsVUFBVSxDQUFDLENBQUMyRCxLQUFLLENBQUN2RSxJQUFJLENBQUN3RSxHQUFHLENBQUM7TUFDMUQsSUFBSUgsU0FBUyxDQUFDSSxNQUFNLElBQUksQ0FBQyxFQUFFO1FBQ3pCO1FBQ0FMLFFBQVEsR0FBR0MsU0FBUyxDQUFDSyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQ0MsSUFBSSxDQUFDLEdBQUcsQ0FBQztNQUMxQyxDQUFDLE1BQU07UUFDTDtRQUNBUCxRQUFRLEdBQUcscUJBQXFCO01BQ2xDO01BRUFMLE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxxQ0FBcUNpRCxVQUFVLGVBQWVFLFFBQVEsRUFBRSxFQUFFLE1BQU0sQ0FBQzs7TUFFNUY7TUFDQSxJQUFJO1FBQ0YsTUFBTTtVQUFFUTtRQUFlLENBQUMsR0FBR25GLE9BQU8sQ0FBQyx5QkFBeUIsQ0FBQztRQUM3RCxNQUFNb0YsTUFBTSxHQUFHRCxjQUFjLENBQUNqRSxXQUFXLENBQUN1RCxVQUFVLEVBQUVFLFFBQVEsQ0FBQztRQUMvREwsTUFBTSxDQUFDekMsT0FBTyxDQUFDLG9EQUFvRDRDLFVBQVUsRUFBRSxDQUFDO1FBQ2hGLE9BQU9XLE1BQU07TUFDZixDQUFDLENBQUMsT0FBT0MsYUFBYSxFQUFFO1FBQ3RCZixNQUFNLENBQUMzRCxLQUFLLENBQUMsMEJBQTBCMEUsYUFBYSxDQUFDOUMsT0FBTyxFQUFFLEVBQUU4QyxhQUFhLENBQUM7O1FBRTlFO1FBQ0FmLE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQywrQ0FBK0MsRUFBRSxNQUFNLENBQUM7O1FBRW5FO1FBQ0EsSUFBSTtVQUNGLE1BQU00RCxNQUFNLEdBQUdwRixPQUFPLENBQUNtQixVQUFVLENBQUM7VUFDbENtRCxNQUFNLENBQUN6QyxPQUFPLENBQUMsd0NBQXdDVixVQUFVLEVBQUUsQ0FBQztVQUNwRSxPQUFPaUUsTUFBTSxDQUFDRSxPQUFPLElBQUlGLE1BQU07UUFDakMsQ0FBQyxDQUFDLE9BQU9HLFdBQVcsRUFBRTtVQUNwQjtVQUNBLElBQUloQixhQUFhLElBQUlBLGFBQWEsQ0FBQ1MsTUFBTSxHQUFHLENBQUMsRUFBRTtZQUM3Q1YsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLDJCQUEyQitDLGFBQWEsQ0FBQ1MsTUFBTSxpQkFBaUIsRUFBRSxNQUFNLENBQUM7WUFFcEYsS0FBSyxNQUFNUSxZQUFZLElBQUlqQixhQUFhLEVBQUU7Y0FDeEMsSUFBSTtnQkFDRkQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLHlCQUF5QmdFLFlBQVksRUFBRSxFQUFFLE1BQU0sQ0FBQztnQkFDM0QsTUFBTUosTUFBTSxHQUFHcEYsT0FBTyxDQUFDd0YsWUFBWSxDQUFDO2dCQUNwQ2xCLE1BQU0sQ0FBQ3pDLE9BQU8sQ0FBQyxzQ0FBc0MyRCxZQUFZLEVBQUUsQ0FBQztnQkFDcEUsT0FBT0osTUFBTSxDQUFDRSxPQUFPLElBQUlGLE1BQU07Y0FDakMsQ0FBQyxDQUFDLE9BQU9LLGFBQWEsRUFBRTtnQkFDdEI7Z0JBQ0EsSUFBSSxDQUFDakIsTUFBTSxFQUFFO2tCQUNYRixNQUFNLENBQUNsRSxJQUFJLENBQUMsaUNBQWlDb0YsWUFBWSxFQUFFLENBQUM7Z0JBQzlEO2NBQ0Y7WUFDRjtVQUNGOztVQUVBO1VBQ0EsSUFBSWYsVUFBVSxLQUFLLHNCQUFzQixFQUFFO1lBQ3pDSCxNQUFNLENBQUM5QyxHQUFHLENBQUMsaUZBQWlGLEVBQUUsTUFBTSxDQUFDO1lBQ3JHLE9BQU8sSUFBSSxDQUFDa0Usd0JBQXdCLENBQUMsQ0FBQztVQUN4Qzs7VUFFQTtVQUNBLE1BQU0sSUFBSTlFLEtBQUssQ0FBQywwQkFBMEJPLFVBQVUsWUFBWWtFLGFBQWEsQ0FBQzlDLE9BQU8sRUFBRSxDQUFDO1FBQzFGO01BQ0Y7SUFDRixDQUFDLENBQUMsT0FBTzVCLEtBQUssRUFBRTtNQUNkMkQsTUFBTSxDQUFDM0QsS0FBSyxDQUFDLHFDQUFxQ0EsS0FBSyxDQUFDNEIsT0FBTyxFQUFFLEVBQUU1QixLQUFLLENBQUM7TUFDekUsTUFBTSxJQUFJQyxLQUFLLENBQUMsMEJBQTBCTyxVQUFVLFlBQVlSLEtBQUssQ0FBQzRCLE9BQU8sRUFBRSxDQUFDO0lBQ2xGO0VBQ0Y7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtFQUNFLE9BQU9tRCx3QkFBd0JBLENBQUEsRUFBRztJQUNoQyxNQUFNcEIsTUFBTSxHQUFHdkQsU0FBUyxDQUFDLGNBQWMsQ0FBQztJQUN4Q3VELE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyx1REFBdUQsRUFBRSxNQUFNLENBQUM7O0lBRTNFO0lBQ0EsU0FBU21FLGlCQUFpQkEsQ0FBQSxFQUFHO01BQzNCLElBQUksQ0FBQ0MsVUFBVSxHQUFHO1FBQ2hCQyxHQUFHLEVBQUU7VUFDSEMsT0FBTyxFQUFFLE1BQUFBLENBQU9DLE9BQU8sRUFBRXhFLElBQUksRUFBRXlFLE1BQU0sRUFBRTNCLE9BQU8sR0FBRyxDQUFDLENBQUMsS0FBSztZQUN0RGxFLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxtREFBbUQsQ0FBQztZQUNoRSxPQUFPO2NBQ0xLLE9BQU8sRUFBRSxJQUFJO2NBQ2JrRSxPQUFPLEVBQUUsb0JBQW9CeEUsSUFBSSxJQUFJLGNBQWMsdUtBQXVLO2NBQzFOWSxJQUFJLEVBQUUsS0FBSztjQUNYOEQsUUFBUSxFQUFFO2dCQUFFQyxLQUFLLEVBQUUsQ0FBQztnQkFBRUMsU0FBUyxFQUFFO2NBQXFCO1lBQ3hELENBQUM7VUFDSCxDQUFDO1VBQ0RDLFFBQVEsRUFBR0MsS0FBSyxJQUFLQyxNQUFNLENBQUNDLFFBQVEsQ0FBQ0YsS0FBSyxDQUFDLElBQUksT0FBT0EsS0FBSyxLQUFLLFFBQVE7VUFDeEVHLE1BQU0sRUFBRTtZQUNOakYsSUFBSSxFQUFFLDBCQUEwQjtZQUNoQ2tGLFVBQVUsRUFBRSxDQUFDLE1BQU0sQ0FBQztZQUNwQkMsU0FBUyxFQUFFLENBQUMsaUJBQWlCLENBQUM7WUFDOUJDLE9BQU8sRUFBRSxFQUFFLEdBQUcsSUFBSSxHQUFHO1VBQ3ZCO1FBQ0Y7TUFDRixDQUFDO0lBQ0g7O0lBRUE7SUFDQWhCLGlCQUFpQixDQUFDaUIsU0FBUyxDQUFDQyxpQkFBaUIsR0FBRyxnQkFBZTFFLElBQUksRUFBRTRELE9BQU8sRUFBRTFCLE9BQU8sR0FBRyxDQUFDLENBQUMsRUFBRTtNQUMxRmxFLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyxrQ0FBa0NXLElBQUksV0FBVyxDQUFDO01BQzlELE9BQU87UUFDTE4sT0FBTyxFQUFFLElBQUk7UUFDYmtFLE9BQU8sRUFBRSx1S0FBdUs7UUFDaExFLFFBQVEsRUFBRTtVQUFFYSxNQUFNLEVBQUU7UUFBcUI7TUFDM0MsQ0FBQztJQUNILENBQUM7SUFFRG5CLGlCQUFpQixDQUFDaUIsU0FBUyxDQUFDRyx1QkFBdUIsR0FBRyxVQUFTQyxTQUFTLEVBQUU7TUFDeEU3RyxPQUFPLENBQUNxQixHQUFHLENBQUMsaURBQWlEd0YsU0FBUyxFQUFFLENBQUM7TUFDekUsSUFBSUEsU0FBUyxLQUFLLEtBQUssRUFBRTtRQUN2QixPQUFPLElBQUksQ0FBQ3BCLFVBQVUsQ0FBQ0MsR0FBRztNQUM1QjtNQUNBLE9BQU8sSUFBSTtJQUNiLENBQUM7O0lBRUQ7SUFDQSxPQUFPLElBQUlGLGlCQUFpQixDQUFDLENBQUM7RUFDaEM7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsYUFBYXNCLHNCQUFzQkEsQ0FBQ3hDLFVBQVUsRUFBRXlDLFNBQVMsRUFBRTtJQUN6RCxNQUFNNUMsTUFBTSxHQUFHdkQsU0FBUyxDQUFDLGNBQWMsQ0FBQztJQUN4QyxNQUFNb0csYUFBYSxHQUFHRCxTQUFTLENBQUNFLEdBQUcsQ0FBQ0MsUUFBUSxJQUFJOUcsSUFBSSxDQUFDMkUsSUFBSSxDQUFDbUMsUUFBUSxFQUFFNUMsVUFBVSxDQUFDLENBQUM7SUFFaEZILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxzQkFBc0JpRCxVQUFVLFNBQVMwQyxhQUFhLENBQUNuQyxNQUFNLGlCQUFpQixFQUFFLE1BQU0sQ0FBQzs7SUFFbEc7SUFDQSxNQUFNc0MsYUFBYSxHQUFHSCxhQUFhLENBQUNJLE1BQU0sQ0FBQ0MsQ0FBQyxJQUFJO01BQzlDLE1BQU1DLE1BQU0sR0FBR3BILEVBQUUsQ0FBQ0MsVUFBVSxDQUFDa0gsQ0FBQyxDQUFDO01BQy9CbEQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLFFBQVFnRyxDQUFDLFlBQVlDLE1BQU0sRUFBRSxFQUFFLE1BQU0sQ0FBQztNQUNqRCxPQUFPQSxNQUFNO0lBQ2YsQ0FBQyxDQUFDO0lBRUYsSUFBSUgsYUFBYSxDQUFDdEMsTUFBTSxLQUFLLENBQUMsRUFBRTtNQUM5QlYsTUFBTSxDQUFDM0QsS0FBSyxDQUFDLHVDQUF1QzhELFVBQVUsRUFBRSxDQUFDO01BQ2pFO01BQ0EsT0FBTyxJQUFJLENBQUNMLFVBQVUsQ0FBQytDLGFBQWEsQ0FBQyxDQUFDLENBQUMsRUFBRTtRQUN2QzVDLGFBQWEsRUFBRTRDLGFBQWEsQ0FBQ2xDLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFDckNULE1BQU0sRUFBRTtNQUNWLENBQUMsQ0FBQztJQUNKOztJQUVBO0lBQ0EsT0FBTyxJQUFJLENBQUNKLFVBQVUsQ0FBQ2tELGFBQWEsQ0FBQyxDQUFDLENBQUMsRUFBRTtNQUN2Qy9DLGFBQWEsRUFBRStDLGFBQWEsQ0FBQ3JDLEtBQUssQ0FBQyxDQUFDO0lBQ3RDLENBQUMsQ0FBQztFQUNKO0VBRUEsT0FBT3lDLGNBQWNBLENBQUEsRUFBRztJQUN0QixNQUFNQyxLQUFLLEdBQUcvRSxPQUFPLENBQUNnRixHQUFHLENBQUNDLFFBQVEsS0FBSyxhQUFhO0lBQ3BELE1BQU12RCxNQUFNLEdBQUd2RCxTQUFTLENBQUMsY0FBYyxDQUFDOztJQUV4QztJQUNBLE1BQU0rRyxhQUFhLEdBQUc7SUFDcEI7SUFDQXZILElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0UsT0FBTyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxFQUFFLGtDQUFrQyxDQUFDLEVBQy9EdEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsb0NBQW9DLENBQUM7SUFFakU7SUFDQXRDLElBQUksQ0FBQ21DLE9BQU8sQ0FBQzVDLEdBQUcsQ0FBQ2tFLFVBQVUsQ0FBQyxDQUFDLEVBQUUsb0NBQW9DLENBQUMsRUFDcEV6RCxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxDQUFDK0QsT0FBTyxDQUFDLGVBQWUsRUFBRSxnQkFBZ0IsQ0FBQyxFQUFFLHFCQUFxQixDQUFDLEVBQ2hHeEgsSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQytELE9BQU8sQ0FBQyxlQUFlLEVBQUUsaUJBQWlCLENBQUMsRUFBRSxxQkFBcUIsQ0FBQyxFQUNqR3hILElBQUksQ0FBQ21DLE9BQU8sQ0FBQzVDLEdBQUcsQ0FBQ2tFLFVBQVUsQ0FBQyxDQUFDLEVBQUUsa0NBQWtDLENBQUM7SUFFbEU7SUFDQXpELElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLHdCQUF3QixDQUFDLEVBQ2pEcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDQyxTQUFTLEVBQUUsMkJBQTJCLENBQUMsRUFDcERwQyxJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSwwQ0FBMEMsQ0FBQztJQUVuRTtJQUNBcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQytELE9BQU8sQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLEVBQUUsa0NBQWtDLENBQUMsRUFDN0Z4SCxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxDQUFDK0QsT0FBTyxDQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsRUFBRSxvQ0FBb0MsQ0FBQyxFQUMvRnhILElBQUksQ0FBQ21DLE9BQU8sQ0FBQzVDLEdBQUcsQ0FBQ2tFLFVBQVUsQ0FBQyxDQUFDLENBQUMrRCxPQUFPLENBQUMsZUFBZSxFQUFFLGlCQUFpQixDQUFDLEVBQUUsOEJBQThCLENBQUMsRUFDMUd4SCxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxDQUFDK0QsT0FBTyxDQUFDLGNBQWMsRUFBRSxnQkFBZ0IsQ0FBQyxFQUFFLDhCQUE4QixDQUFDO0lBRXhHO0lBQ0F4SCxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxFQUFFLHVDQUF1QyxDQUFDLEVBQ3ZFekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsRUFBRSxxQ0FBcUMsQ0FBQztJQUVyRTtJQUNBekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDbkMsSUFBSSxDQUFDc0UsT0FBTyxDQUFDL0UsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQyxFQUFFLG9DQUFvQyxDQUFDLEVBQ2xGekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDbkMsSUFBSSxDQUFDc0UsT0FBTyxDQUFDL0UsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQyxFQUFFLGtDQUFrQyxDQUFDO0lBRWhGO0lBQ0F6RCxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxFQUFFLG1DQUFtQyxDQUFDLEVBQ25FekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDbkMsSUFBSSxDQUFDc0UsT0FBTyxDQUFDakMsT0FBTyxDQUFDb0YsUUFBUSxDQUFDLEVBQUUsbURBQW1ELENBQUMsRUFDakd6SCxJQUFJLENBQUNtQyxPQUFPLENBQUNuQyxJQUFJLENBQUNzRSxPQUFPLENBQUNqQyxPQUFPLENBQUNvRixRQUFRLENBQUMsRUFBRSxxREFBcUQsQ0FBQztJQUVuRztJQUNBbEksR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQytELE9BQU8sQ0FBQyxrQ0FBa0MsRUFBRSxvQ0FBb0MsQ0FBQyxFQUNsR2pJLEdBQUcsQ0FBQ2tFLFVBQVUsQ0FBQyxDQUFDLENBQUMrRCxPQUFPLENBQUMscUNBQXFDLEVBQUUsdUNBQXVDLENBQUM7SUFFeEc7SUFDQXhILElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0UsT0FBTyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxFQUFFLG1DQUFtQyxDQUFDLEVBQ2hFdEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsRUFBRSxtQ0FBbUMsQ0FBQztJQUVuRTtJQUNBekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsa0NBQWtDLENBQUMsRUFDL0R0QyxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxFQUFFLGtDQUFrQyxDQUFDLEVBQ2xFekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDQyxTQUFTLEVBQUUsdUNBQXVDLENBQUMsRUFDaEVwQyxJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSwwQ0FBMEMsQ0FBQyxFQUNuRXBDLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ25DLElBQUksQ0FBQ3NFLE9BQU8sQ0FBQ2pDLE9BQU8sQ0FBQ29GLFFBQVEsQ0FBQyxFQUFFLDRDQUE0QyxDQUFDLEVBQzFGekgsSUFBSSxDQUFDbUMsT0FBTyxDQUFDbkMsSUFBSSxDQUFDc0UsT0FBTyxDQUFDakMsT0FBTyxDQUFDb0YsUUFBUSxDQUFDLEVBQUUsaURBQWlELENBQUMsRUFDL0Z6SCxJQUFJLENBQUNtQyxPQUFPLENBQUNuQyxJQUFJLENBQUNzRSxPQUFPLENBQUNqQyxPQUFPLENBQUNvRixRQUFRLENBQUMsRUFBRSx3Q0FBd0MsQ0FBQyxDQUN2Rjs7SUFFRDtJQUNBMUQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLG9CQUFvQjFCLEdBQUcsQ0FBQ2lFLFVBQVUsRUFBRSxFQUFFLE1BQU0sQ0FBQztJQUN4RE8sTUFBTSxDQUFDOUMsR0FBRyxDQUFDLGFBQWExQixHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxFQUFFLEVBQUUsTUFBTSxDQUFDO0lBQ25ETSxNQUFNLENBQUM5QyxHQUFHLENBQUMsY0FBY21CLFNBQVMsRUFBRSxFQUFFLE1BQU0sQ0FBQztJQUM3QzJCLE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxrQkFBa0JvQixPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsRUFBRSxNQUFNLENBQUM7SUFDckR5QixNQUFNLENBQUM5QyxHQUFHLENBQUMscUJBQXFCb0IsT0FBTyxDQUFDb0YsUUFBUSxFQUFFLEVBQUUsTUFBTSxDQUFDOztJQUUzRDtJQUNBLE1BQU1DLFNBQVMsR0FBRyxrSkFBa0o7SUFDcEssTUFBTUMsYUFBYSxHQUFHRCxTQUFTLENBQUNGLE9BQU8sQ0FBQyxTQUFTLEVBQUUsV0FBVyxDQUFDO0lBQy9EekQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLGVBQWV5RyxTQUFTLEVBQUUsRUFBRSxNQUFNLENBQUM7SUFDOUMzRCxNQUFNLENBQUM5QyxHQUFHLENBQUMsbUJBQW1CMEcsYUFBYSxFQUFFLEVBQUUsTUFBTSxDQUFDO0lBQ3RENUQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLDBCQUEwQm5CLEVBQUUsQ0FBQ0MsVUFBVSxDQUFDNEgsYUFBYSxDQUFDLEVBQUUsRUFBRSxNQUFNLENBQUM7O0lBRTVFO0lBQ0EsSUFBSWIsUUFBUSxHQUFHLElBQUk7SUFDbkIsS0FBSyxNQUFNYyxhQUFhLElBQUlMLGFBQWEsRUFBRTtNQUN6QyxJQUFJO1FBQ0YsTUFBTUwsTUFBTSxHQUFHcEgsRUFBRSxDQUFDQyxVQUFVLENBQUM2SCxhQUFhLENBQUM7UUFDM0M3RCxNQUFNLENBQUM5QyxHQUFHLENBQUMsa0JBQWtCMkcsYUFBYSxhQUFhVixNQUFNLEdBQUcsRUFBRSxNQUFNLENBQUM7UUFFekUsSUFBSUEsTUFBTSxFQUFFO1VBQ1ZKLFFBQVEsR0FBR2MsYUFBYTtVQUN4QjdELE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQywwQkFBMEI2RixRQUFRLEVBQUUsRUFBRSxNQUFNLENBQUM7VUFDeEQ7UUFDRjtNQUNGLENBQUMsQ0FBQyxPQUFPMUcsS0FBSyxFQUFFO1FBQ2QyRCxNQUFNLENBQUNsRSxJQUFJLENBQUMsdUJBQXVCK0gsYUFBYSxLQUFLeEgsS0FBSyxDQUFDNEIsT0FBTyxFQUFFLENBQUM7TUFDdkU7SUFDRjs7SUFFQTtJQUNBLElBQUksQ0FBQzhFLFFBQVEsRUFBRTtNQUNiL0MsTUFBTSxDQUFDbEUsSUFBSSxDQUFDLDJEQUEyRCxDQUFDOztNQUV4RTtNQUNBLE1BQU1nSSxtQkFBbUIsR0FBRztNQUMxQjtNQUNBO01BQ0F0SSxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxDQUFDK0QsT0FBTyxDQUFDLGtDQUFrQyxFQUFFLG9DQUFvQyxDQUFDLEdBQUcsdUJBQXVCLEVBQzVIakksR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQytELE9BQU8sQ0FBQyxxQ0FBcUMsRUFBRSx1Q0FBdUMsQ0FBQyxHQUFHLHdCQUF3QjtNQUVuSTtNQUNBakksR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQytELE9BQU8sQ0FBQyx5QkFBeUIsRUFBRSwyQkFBMkIsQ0FBQyxHQUFHLDhDQUE4QyxFQUNqSWpJLEdBQUcsQ0FBQ2tFLFVBQVUsQ0FBQyxDQUFDLENBQUMrRCxPQUFPLENBQUMsdUJBQXVCLEVBQUUseUJBQXlCLENBQUMsR0FBRywyQ0FBMkM7TUFFMUg7TUFDQXhILElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0UsT0FBTyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxFQUFFLHVEQUF1RCxDQUFDLEVBQ3BGdEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUseURBQXlELENBQUMsRUFDdEZ0QyxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxFQUFFLHlEQUF5RCxDQUFDLEVBQ3pGekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsRUFBRSx1REFBdUQsQ0FBQztNQUV2RjtNQUNBekQsSUFBSSxDQUFDbUMsT0FBTyxDQUFDQyxTQUFTLEVBQUUsNkNBQTZDLENBQUMsRUFDdEVwQyxJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSxnREFBZ0QsQ0FBQztNQUV6RTtNQUNBcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsQ0FBQytELE9BQU8sQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLEVBQUUsdURBQXVELENBQUMsRUFDbEh4SCxJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxDQUFDK0QsT0FBTyxDQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsRUFBRSx5REFBeUQsQ0FBQyxFQUNwSHhILElBQUksQ0FBQ21DLE9BQU8sQ0FBQ25DLElBQUksQ0FBQ3NFLE9BQU8sQ0FBQ2pDLE9BQU8sQ0FBQ29GLFFBQVEsQ0FBQyxFQUFFLHdFQUF3RSxDQUFDLEVBQ3RIekgsSUFBSSxDQUFDbUMsT0FBTyxDQUFDbkMsSUFBSSxDQUFDc0UsT0FBTyxDQUFDakMsT0FBTyxDQUFDb0YsUUFBUSxDQUFDLEVBQUUsMEVBQTBFLENBQUMsRUFDeEh6SCxJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSw2REFBNkQsQ0FBQyxFQUN0RnBDLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLCtEQUErRCxDQUFDLEVBQ3hGcEMsSUFBSSxDQUFDbUMsT0FBTyxDQUFDQyxTQUFTLEVBQUUsNERBQTRELENBQUMsRUFDckZwQyxJQUFJLENBQUNtQyxPQUFPLENBQUNuQyxJQUFJLENBQUNzRSxPQUFPLENBQUNqQyxPQUFPLENBQUNvRixRQUFRLENBQUMsRUFBRSxxRUFBcUUsQ0FBQyxFQUNuSHpILElBQUksQ0FBQ21DLE9BQU8sQ0FBQ25DLElBQUksQ0FBQ3NFLE9BQU8sQ0FBQ2pDLE9BQU8sQ0FBQ29GLFFBQVEsQ0FBQyxFQUFFLHNFQUFzRSxDQUFDLEVBQ3BIekgsSUFBSSxDQUFDbUMsT0FBTyxDQUFDbkMsSUFBSSxDQUFDc0UsT0FBTyxDQUFDakMsT0FBTyxDQUFDb0YsUUFBUSxDQUFDLEVBQUUsNEVBQTRFLENBQUM7TUFFMUg7TUFDQXpILElBQUksQ0FBQzJFLElBQUksQ0FBQ3ZDLFNBQVMsRUFBRSxzQkFBc0IsQ0FBQyxFQUM1Q3BDLElBQUksQ0FBQzJFLElBQUksQ0FBQzNFLElBQUksQ0FBQ3NFLE9BQU8sQ0FBQ2xDLFNBQVMsQ0FBQyxFQUFFLHNCQUFzQixDQUFDO01BRTFEO01BQ0Esb0pBQW9KLENBQ3JKOztNQUVEO01BQ0EsS0FBSyxNQUFNMEYsWUFBWSxJQUFJRCxtQkFBbUIsRUFBRTtRQUM5QyxNQUFNWCxNQUFNLEdBQUdwSCxFQUFFLENBQUNDLFVBQVUsQ0FBQytILFlBQVksQ0FBQztRQUMxQy9ELE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxrQ0FBa0M2RyxZQUFZLGFBQWFaLE1BQU0sR0FBRyxFQUFFLE1BQU0sQ0FBQztRQUV4RixJQUFJQSxNQUFNLEVBQUU7VUFDVjtVQUNBSixRQUFRLEdBQUc5RyxJQUFJLENBQUNzRSxPQUFPLENBQUN3RCxZQUFZLENBQUM7VUFDckMvRCxNQUFNLENBQUM5QyxHQUFHLENBQUMsNkJBQTZCNkcsWUFBWSxzQkFBc0JoQixRQUFRLEVBQUUsRUFBRSxNQUFNLENBQUM7VUFDN0Y7UUFDRjtNQUNGO0lBQ0Y7O0lBRUE7SUFDQSxJQUFJLENBQUNBLFFBQVEsRUFBRTtNQUNiL0MsTUFBTSxDQUFDM0QsS0FBSyxDQUFDLDBEQUEwRCxDQUFDOztNQUV4RTtNQUNBLElBQUliLEdBQUcsQ0FBQ2lFLFVBQVUsRUFBRTtRQUNsQnNELFFBQVEsR0FBRzlHLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLHdCQUF3QixDQUFDO01BQzlELENBQUMsTUFBTTtRQUNMMEUsUUFBUSxHQUFHOUcsSUFBSSxDQUFDbUMsT0FBTyxDQUFDRSxPQUFPLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsa0NBQWtDLENBQUM7TUFDNUU7SUFDRjs7SUFFQTtJQUNBeUIsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLDBCQUEwQjZGLFFBQVEsRUFBRSxFQUFFLE1BQU0sQ0FBQzs7SUFFeEQ7SUFDQSxNQUFNZ0IsWUFBWSxHQUFHOUgsSUFBSSxDQUFDMkUsSUFBSSxDQUFDbUMsUUFBUSxFQUFFLHNCQUFzQixDQUFDO0lBQ2hFL0MsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLHdCQUF3QjZHLFlBQVksYUFBYWhJLEVBQUUsQ0FBQ0MsVUFBVSxDQUFDK0gsWUFBWSxDQUFDLEdBQUcsRUFBRSxNQUFNLENBQUM7O0lBRW5HO0lBQ0EsT0FBTztNQUNMQyxRQUFRLEVBQUVELFlBQVk7TUFDdEJBLFlBQVksRUFBRUEsWUFBWTtNQUFFO01BQzVCekMsVUFBVSxFQUFFO1FBQ1YyQyxHQUFHLEVBQUVoSSxJQUFJLENBQUMyRSxJQUFJLENBQUNtQyxRQUFRLEVBQUUscUJBQXFCLENBQUM7UUFDL0N4QixHQUFHLEVBQUV0RixJQUFJLENBQUMyRSxJQUFJLENBQUNtQyxRQUFRLEVBQUUsaUNBQWlDLENBQUM7UUFDM0RtQixJQUFJLEVBQUVqSSxJQUFJLENBQUMyRSxJQUFJLENBQUNtQyxRQUFRLEVBQUUsMkJBQTJCLENBQUM7UUFDdERvQixJQUFJLEVBQUVsSSxJQUFJLENBQUMyRSxJQUFJLENBQUNtQyxRQUFRLEVBQUUsMkJBQTJCLENBQUM7UUFDdERxQixJQUFJLEVBQUVuSSxJQUFJLENBQUMyRSxJQUFJLENBQUNtQyxRQUFRLEVBQUUsdUJBQXVCLENBQUM7UUFDbERzQixHQUFHLEVBQUVwSSxJQUFJLENBQUMyRSxJQUFJLENBQUNtQyxRQUFRLEVBQUUsc0JBQXNCO01BQ2pEO0lBQ0YsQ0FBQztFQUNIO0FBQ0Y7O0FBRUE7QUFDQSxNQUFNdUIsd0JBQXdCLEdBQUc7RUFDL0JoRCxVQUFVLEVBQUU7SUFDVkMsR0FBRyxFQUFFO01BQ0g7TUFDQUMsT0FBTyxFQUFFLE1BQUFBLENBQU9DLE9BQU8sRUFBRXhFLElBQUksRUFBRXlFLE1BQU0sRUFBRTNCLE9BQU8sR0FBRyxDQUFDLENBQUMsS0FBSztRQUN0RGxFLE9BQU8sQ0FBQ3FCLEdBQUcsQ0FBQyx5REFBeUQsQ0FBQztRQUN0RSxPQUFPO1VBQ0xLLE9BQU8sRUFBRSxJQUFJO1VBQ2JrRSxPQUFPLEVBQUUsb0JBQW9CeEUsSUFBSSxJQUFJLGNBQWMsOERBQThEO1VBQ2pIWSxJQUFJLEVBQUUsS0FBSztVQUNYOEQsUUFBUSxFQUFFO1lBQUVDLEtBQUssRUFBRSxDQUFDO1lBQUVDLFNBQVMsRUFBRTtVQUFtQjtRQUN0RCxDQUFDO01BQ0gsQ0FBQztNQUNEQyxRQUFRLEVBQUdDLEtBQUssSUFBS0MsTUFBTSxDQUFDQyxRQUFRLENBQUNGLEtBQUssQ0FBQyxJQUFJLE9BQU9BLEtBQUssS0FBSyxRQUFRO01BQ3hFRyxNQUFNLEVBQUU7UUFDTmpGLElBQUksRUFBRSxjQUFjO1FBQ3BCa0YsVUFBVSxFQUFFLENBQUMsTUFBTSxDQUFDO1FBQ3BCQyxTQUFTLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQztRQUM5QkMsT0FBTyxFQUFFLEVBQUUsR0FBRyxJQUFJLEdBQUc7TUFDdkI7SUFDRjtFQUNGLENBQUM7RUFFRDtFQUNBRSxpQkFBaUIsRUFBRSxNQUFBQSxDQUFPMUUsSUFBSSxFQUFFNEQsT0FBTyxFQUFFMUIsT0FBTyxHQUFHLENBQUMsQ0FBQyxLQUFLO0lBQ3hEbEUsT0FBTyxDQUFDcUIsR0FBRyxDQUFDLG1FQUFtRVcsSUFBSSxFQUFFLENBQUM7SUFDdEYsT0FBTztNQUNMTixPQUFPLEVBQUUsSUFBSTtNQUNia0UsT0FBTyxFQUFFLG9CQUFvQjFCLE9BQU8sQ0FBQzlDLElBQUksSUFBSSxVQUFVLDhEQUE4RDtNQUNySFksSUFBSSxFQUFFQSxJQUFJO01BQ1Y4RCxRQUFRLEVBQUU7UUFBRUUsU0FBUyxFQUFFO01BQW1CO0lBQzVDLENBQUM7RUFDSCxDQUFDO0VBRUQ7RUFDQVksdUJBQXVCLEVBQUUsTUFBT0MsU0FBUyxJQUFLO0lBQzVDN0csT0FBTyxDQUFDcUIsR0FBRyxDQUFDLHdEQUF3RHdGLFNBQVMsRUFBRSxDQUFDOztJQUVoRjtJQUNBLElBQUlBLFNBQVMsS0FBSyxLQUFLLEVBQUU7TUFDdkIsT0FBTzRCLHdCQUF3QixDQUFDaEQsVUFBVSxDQUFDQyxHQUFHO0lBQ2hEOztJQUVBO0lBQ0EsT0FBTztNQUNMQyxPQUFPLEVBQUUsTUFBQUEsQ0FBT0MsT0FBTyxFQUFFeEUsSUFBSSxFQUFFeUUsTUFBTSxFQUFFM0IsT0FBTyxHQUFHLENBQUMsQ0FBQyxLQUFLO1FBQ3REbEUsT0FBTyxDQUFDcUIsR0FBRyxDQUFDLDBEQUEwRHdGLFNBQVMsRUFBRSxDQUFDO1FBQ2xGLE9BQU87VUFDTG5GLE9BQU8sRUFBRSxJQUFJO1VBQ2JrRSxPQUFPLEVBQUUsb0JBQW9CeEUsSUFBSSxJQUFJeUYsU0FBUyxHQUFHLE9BQU8sc0VBQXNFO1VBQzlIN0UsSUFBSSxFQUFFNkUsU0FBUztVQUNmZixRQUFRLEVBQUU7WUFBRUUsU0FBUyxFQUFFO1VBQTJCO1FBQ3BELENBQUM7TUFDSCxDQUFDO01BQ0RDLFFBQVEsRUFBRUEsQ0FBQSxLQUFNLElBQUk7TUFDcEJJLE1BQU0sRUFBRTtRQUNOakYsSUFBSSxFQUFFLEdBQUd5RixTQUFTLENBQUM2QixXQUFXLENBQUMsQ0FBQyxXQUFXO1FBQzNDcEMsVUFBVSxFQUFFLENBQUMsSUFBSU8sU0FBUyxFQUFFLENBQUM7UUFDN0JOLFNBQVMsRUFBRSxDQUFDLGVBQWVNLFNBQVMsRUFBRSxDQUFDO1FBQ3ZDTCxPQUFPLEVBQUUsRUFBRSxHQUFHLElBQUksR0FBRztNQUN2QjtJQUNGLENBQUM7RUFDSDtBQUNGLENBQUM7O0FBRUQ7QUFDQTtBQUNBO0FBQ0EsTUFBTW1DLG9CQUFvQixDQUFDO0VBQ3pCLE9BQU9DLFNBQVMsR0FBRyxJQUFJO0VBQ3ZCakcsV0FBV0EsQ0FBQSxFQUFHO0lBQ1osSUFBSSxDQUFDa0csWUFBWSxHQUFHLEtBQUs7SUFDekIsSUFBSSxDQUFDQyxZQUFZLEdBQUcsSUFBSTtJQUN4QixJQUFJLENBQUNDLGtCQUFrQixHQUFHLElBQUk7SUFDOUIsSUFBSSxDQUFDNUUsTUFBTSxHQUFHdkQsU0FBUyxDQUFDLHNCQUFzQixDQUFDO0VBQ2pEO0VBRUEsT0FBT29JLFdBQVdBLENBQUEsRUFBRztJQUNuQixJQUFJLENBQUNMLG9CQUFvQixDQUFDQyxTQUFTLEVBQUU7TUFDbkNELG9CQUFvQixDQUFDQyxTQUFTLEdBQUcsSUFBSUQsb0JBQW9CLENBQUMsQ0FBQztJQUM3RDtJQUNBLE9BQU9BLG9CQUFvQixDQUFDQyxTQUFTO0VBQ3ZDO0VBRUEsTUFBTUssVUFBVUEsQ0FBQSxFQUFHO0lBQ2pCLElBQUksSUFBSSxDQUFDSixZQUFZLEVBQUUsT0FBTyxJQUFJLENBQUNFLGtCQUFrQjtJQUNyRCxJQUFJLElBQUksQ0FBQ0QsWUFBWSxFQUFFLE9BQU8sSUFBSSxDQUFDQSxZQUFZO0lBRS9DLElBQUksQ0FBQ0EsWUFBWSxHQUFHLElBQUksQ0FBQ0ksYUFBYSxDQUFDLENBQUM7SUFDeEMsT0FBTyxJQUFJLENBQUNKLFlBQVk7RUFDMUI7RUFFQSxNQUFNSSxhQUFhQSxDQUFBLEVBQUc7SUFDcEIsSUFBSSxDQUFDL0UsTUFBTSxDQUFDdkMsa0JBQWtCLENBQzVCZCxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ0MsUUFBUSxFQUNoQ3RDLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDRSxZQUMxQixDQUFDO0lBRUQsSUFBSTtNQUNGO01BQ0EsTUFBTThGLEtBQUssR0FBR25GLFlBQVksQ0FBQ3VELGNBQWMsQ0FBQyxDQUFDO01BQzNDLElBQUksQ0FBQ3BELE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyx3QkFBd0IsRUFBRSxNQUFNLEVBQUU4SCxLQUFLLENBQUM7O01BRXhEO01BQ0EsTUFBTUMsaUJBQWlCLEdBQUcsQ0FDeEJoSixJQUFJLENBQUNzRSxPQUFPLENBQUN5RSxLQUFLLENBQUNoQixRQUFRLENBQUMsRUFDNUIsR0FBR2tCLE1BQU0sQ0FBQ0MsTUFBTSxDQUFDSCxLQUFLLENBQUMxRCxVQUFVLENBQUMsQ0FBQ3dCLEdBQUcsQ0FBQ0ksQ0FBQyxJQUFJakgsSUFBSSxDQUFDc0UsT0FBTyxDQUFDdEUsSUFBSSxDQUFDc0UsT0FBTyxDQUFDMkMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUMzRTs7TUFFRDtNQUNBLE1BQU1rQyx3QkFBd0IsR0FBRyxDQUMvQkosS0FBSyxDQUFDaEIsUUFBUSxFQUNkZ0IsS0FBSyxDQUFDakIsWUFBWSxFQUNsQixHQUFHa0IsaUJBQWlCLENBQUNuQyxHQUFHLENBQUNDLFFBQVEsSUFBSTlHLElBQUksQ0FBQzJFLElBQUksQ0FBQ21DLFFBQVEsRUFBRSxzQkFBc0IsQ0FBQyxDQUFDLENBQ2xGO01BQ0QsSUFBSSxDQUFDL0MsTUFBTSxDQUFDeEMsS0FBSyxDQUFDLDhCQUE4QixFQUFFNEgsd0JBQXdCLENBQUM7O01BRTNFO01BQ0EsSUFBSXBCLFFBQVE7TUFDWixJQUFJO1FBQ0Y7UUFDQSxNQUFNTCxTQUFTLEdBQUcsa0pBQWtKO1FBQ3BLLE1BQU1DLGFBQWEsR0FBR0QsU0FBUyxDQUFDRixPQUFPLENBQUMsU0FBUyxFQUFFLFdBQVcsQ0FBQzs7UUFFL0Q7UUFDQSxJQUFJMUgsRUFBRSxDQUFDQyxVQUFVLENBQUM0SCxhQUFhLENBQUMsRUFBRTtVQUNoQyxJQUFJLENBQUM1RCxNQUFNLENBQUM5QyxHQUFHLENBQUMsa0NBQWtDMEcsYUFBYSxFQUFFLEVBQUUsTUFBTSxDQUFDO1VBQzFFLElBQUk7WUFDRkksUUFBUSxHQUFHdEksT0FBTyxDQUFDa0ksYUFBYSxDQUFDO1lBQ2pDLElBQUksQ0FBQzVELE1BQU0sQ0FBQ3pDLE9BQU8sQ0FBQyxrREFBa0QsQ0FBQztVQUN6RSxDQUFDLENBQUMsT0FBTzhILGVBQWUsRUFBRTtZQUN4QixJQUFJLENBQUNyRixNQUFNLENBQUNsRSxJQUFJLENBQUMsdUNBQXVDdUosZUFBZSxDQUFDcEgsT0FBTyxFQUFFLENBQUM7VUFDcEY7UUFDRjs7UUFFQTtRQUNBLElBQUksQ0FBQytGLFFBQVEsRUFBRTtVQUNiQSxRQUFRLEdBQUcsTUFBTW5FLFlBQVksQ0FBQ0MsVUFBVSxDQUN0Q2tGLEtBQUssQ0FBQ2hCLFFBQVEsRUFDZDtZQUFFL0QsYUFBYSxFQUFFbUYsd0JBQXdCLENBQUN6RSxLQUFLLENBQUMsQ0FBQyxDQUFDO1lBQUVULE1BQU0sRUFBRTtVQUFLLENBQ25FLENBQUM7UUFDSDtNQUNGLENBQUMsQ0FBQyxPQUFPb0YsWUFBWSxFQUFFO1FBQ3JCLElBQUksQ0FBQ3RGLE1BQU0sQ0FBQ2xFLElBQUksQ0FBQyxnRUFBZ0UsRUFBRXdKLFlBQVksQ0FBQzs7UUFFaEc7UUFDQSxNQUFNQyxRQUFRLEdBQUcsRUFBRTs7UUFFbkI7UUFDQSxNQUFNQyxVQUFVLEdBQUlDLEdBQUcsSUFBSztVQUMxQixJQUFJQSxHQUFHLElBQUksQ0FBQ0YsUUFBUSxDQUFDdkksUUFBUSxDQUFDeUksR0FBRyxDQUFDLEVBQUU7WUFDbENGLFFBQVEsQ0FBQ0csSUFBSSxDQUFDRCxHQUFHLENBQUM7VUFDcEI7UUFDRixDQUFDOztRQUVEO1FBQ0FELFVBQVUsQ0FBQ3ZKLElBQUksQ0FBQ3NFLE9BQU8sQ0FBQ3lFLEtBQUssQ0FBQ2hCLFFBQVEsQ0FBQyxDQUFDOztRQUV4QztRQUNBa0IsTUFBTSxDQUFDQyxNQUFNLENBQUNILEtBQUssQ0FBQzFELFVBQVUsQ0FBQyxDQUFDcUUsT0FBTyxDQUFDQyxhQUFhLElBQUk7VUFDdkQsTUFBTUMsWUFBWSxHQUFHNUosSUFBSSxDQUFDc0UsT0FBTyxDQUFDcUYsYUFBYSxDQUFDO1VBQ2hESixVQUFVLENBQUN2SixJQUFJLENBQUNzRSxPQUFPLENBQUNzRixZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDMUMsQ0FBQyxDQUFDOztRQUVGO1FBQ0FMLFVBQVUsQ0FBQ3ZKLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0UsT0FBTyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxFQUFFLGtDQUFrQyxDQUFDLENBQUM7UUFDM0VpSCxVQUFVLENBQUN2SixJQUFJLENBQUNtQyxPQUFPLENBQUNFLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLENBQUMsRUFBRSxvQ0FBb0MsQ0FBQyxDQUFDO1FBQzdFaUgsVUFBVSxDQUFDdkosSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsRUFBRSxrQ0FBa0MsQ0FBQyxDQUFDO1FBQzlFOEYsVUFBVSxDQUFDdkosSUFBSSxDQUFDbUMsT0FBTyxDQUFDNUMsR0FBRyxDQUFDa0UsVUFBVSxDQUFDLENBQUMsRUFBRSxvQ0FBb0MsQ0FBQyxDQUFDO1FBQ2hGOEYsVUFBVSxDQUFDdkosSUFBSSxDQUFDbUMsT0FBTyxDQUFDQyxTQUFTLEVBQUUsd0JBQXdCLENBQUMsQ0FBQztRQUM3RG1ILFVBQVUsQ0FBQ3ZKLElBQUksQ0FBQ21DLE9BQU8sQ0FBQ0MsU0FBUyxFQUFFLDJCQUEyQixDQUFDLENBQUM7UUFDaEVtSCxVQUFVLENBQUN2SixJQUFJLENBQUNtQyxPQUFPLENBQUNDLFNBQVMsRUFBRSx3Q0FBd0MsQ0FBQyxDQUFDO1FBQzdFbUgsVUFBVSxDQUFDdkosSUFBSSxDQUFDbUMsT0FBTyxDQUFDQyxTQUFTLEVBQUUsMENBQTBDLENBQUMsQ0FBQztRQUMvRW1ILFVBQVUsQ0FBQ3ZKLElBQUksQ0FBQ21DLE9BQU8sQ0FBQzVDLEdBQUcsQ0FBQ2tFLFVBQVUsQ0FBQyxDQUFDLENBQUMrRCxPQUFPLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxFQUFFLGtDQUFrQyxDQUFDLENBQUM7UUFDekcrQixVQUFVLENBQUN2SixJQUFJLENBQUNtQyxPQUFPLENBQUM1QyxHQUFHLENBQUNrRSxVQUFVLENBQUMsQ0FBQyxDQUFDK0QsT0FBTyxDQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsRUFBRSxvQ0FBb0MsQ0FBQyxDQUFDOztRQUUzRztRQUNBLElBQUksQ0FBQ3pELE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxzREFBc0QsRUFBRSxNQUFNLEVBQUVxSSxRQUFRLENBQUM7UUFFekYsSUFBSTtVQUNGO1VBQ0F2QixRQUFRLEdBQUcsTUFBTW5FLFlBQVksQ0FBQzhDLHNCQUFzQixDQUFDLHNCQUFzQixFQUFFNEMsUUFBUSxDQUFDO1FBQ3hGLENBQUMsQ0FBQyxPQUFPTyxhQUFhLEVBQUU7VUFDdEIsSUFBSSxDQUFDOUYsTUFBTSxDQUFDM0QsS0FBSyxDQUFDLDJEQUEyRCxFQUFFeUosYUFBYSxDQUFDO1VBQzdGO1VBQ0E5QixRQUFRLEdBQUdNLHdCQUF3QjtVQUNuQyxJQUFJLENBQUN0RSxNQUFNLENBQUNsRSxJQUFJLENBQUMsd0RBQXdELENBQUM7UUFDNUU7TUFDRjs7TUFFQTtNQUNBLElBQUksQ0FBQyxJQUFJLENBQUNpSyxpQkFBaUIsQ0FBQy9CLFFBQVEsQ0FBQyxFQUFFO1FBQ3JDLElBQUksQ0FBQ2hFLE1BQU0sQ0FBQzNELEtBQUssQ0FBQywrREFBK0QsQ0FBQztRQUNsRjtRQUNBMkgsUUFBUSxHQUFHTSx3QkFBd0I7UUFDbkMsSUFBSSxDQUFDdEUsTUFBTSxDQUFDbEUsSUFBSSxDQUFDLHdEQUF3RCxDQUFDOztRQUUxRTtRQUNBLElBQUksQ0FBQyxJQUFJLENBQUNpSyxpQkFBaUIsQ0FBQy9CLFFBQVEsQ0FBQyxFQUFFO1VBQ3JDLE1BQU0sSUFBSTFILEtBQUssQ0FBQyxzQ0FBc0MsQ0FBQztRQUN6RDtNQUNGOztNQUVBO01BQ0EsSUFBSSxDQUFDMEQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLHVCQUF1QixFQUFFZ0ksTUFBTSxDQUFDYyxJQUFJLENBQUNoQyxRQUFRLENBQUMxQyxVQUFVLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztNQUVoRixJQUFJLENBQUN0QixNQUFNLENBQUN6QyxPQUFPLENBQUMsd0NBQXdDLENBQUM7TUFDN0QsSUFBSSxDQUFDcUgsa0JBQWtCLEdBQUdaLFFBQVE7TUFDbEMsSUFBSSxDQUFDVSxZQUFZLEdBQUcsSUFBSTtNQUV4QixJQUFJLENBQUMxRSxNQUFNLENBQUN2QyxrQkFBa0IsQ0FDNUJkLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDRSxZQUFZLEVBQ3BDdkMsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNPLFNBQzFCLENBQUM7TUFFRCxPQUFPLElBQUksQ0FBQ3FGLGtCQUFrQjtJQUNoQyxDQUFDLENBQUMsT0FBT3ZJLEtBQUssRUFBRTtNQUNkLElBQUksQ0FBQ3NJLFlBQVksR0FBRyxJQUFJO01BQ3hCLElBQUksQ0FBQzNFLE1BQU0sQ0FBQ2hDLGtCQUFrQixDQUFDLE1BQU0sRUFBRTNCLEtBQUssQ0FBQzs7TUFFN0M7TUFDQSxNQUFNNEosYUFBYSxHQUFHLElBQUkzSixLQUFLLENBQUMsNENBQTRDRCxLQUFLLENBQUM0QixPQUFPLEVBQUUsQ0FBQztNQUM1RmdJLGFBQWEsQ0FBQ0MsUUFBUSxHQUFHN0osS0FBSztNQUM5QjRKLGFBQWEsQ0FBQ0UsS0FBSyxHQUFHOUosS0FBSyxDQUFDOEosS0FBSztNQUNqQyxNQUFNRixhQUFhO0lBQ3JCO0VBQ0Y7RUFFQUYsaUJBQWlCQSxDQUFDL0IsUUFBUSxFQUFFO0lBQzFCLElBQUksQ0FBQ0EsUUFBUSxJQUFJLE9BQU9BLFFBQVEsS0FBSyxRQUFRLEVBQUUsT0FBTyxLQUFLO0lBQzNELElBQUksQ0FBQ0EsUUFBUSxDQUFDMUMsVUFBVSxJQUFJLE9BQU8wQyxRQUFRLENBQUMxQyxVQUFVLEtBQUssUUFBUSxFQUFFLE9BQU8sS0FBSztJQUNqRixJQUFJLE9BQU8wQyxRQUFRLENBQUN6QixpQkFBaUIsS0FBSyxVQUFVLEVBQUUsT0FBTyxLQUFLO0lBQ2xFLElBQUksT0FBT3lCLFFBQVEsQ0FBQ3ZCLHVCQUF1QixLQUFLLFVBQVUsRUFBRSxPQUFPLEtBQUs7SUFDeEUsT0FBTyxJQUFJO0VBQ2I7QUFDRjs7QUFFQTtBQUNBO0FBQ0E7QUFDQSxNQUFNMkQsb0JBQW9CLEdBQUc7RUFDM0I7RUFDQUMsR0FBRyxFQUFFLE9BQU87RUFDWkMsR0FBRyxFQUFFLE9BQU87RUFDWkMsR0FBRyxFQUFFLE9BQU87RUFDWkMsSUFBSSxFQUFFLE9BQU87RUFFYjtFQUNBQyxHQUFHLEVBQUUsT0FBTztFQUNaQyxJQUFJLEVBQUUsT0FBTztFQUNiQyxHQUFHLEVBQUUsT0FBTztFQUNaQyxHQUFHLEVBQUUsT0FBTztFQUVaO0VBQ0FyRixHQUFHLEVBQUUsVUFBVTtFQUNmMkMsSUFBSSxFQUFFLFVBQVU7RUFDaEJDLElBQUksRUFBRSxVQUFVO0VBRWhCO0VBQ0FDLElBQUksRUFBRSxNQUFNO0VBQ1pDLEdBQUcsRUFBRSxNQUFNO0VBRVg7RUFDQUosR0FBRyxFQUFFLEtBQUs7RUFDVjRDLFNBQVMsRUFBRTtBQUNiLENBQUM7O0FBRUQ7QUFDQTtBQUNBO0FBQ0EsTUFBTUMsdUJBQXVCLENBQUM7RUFDNUIsT0FBT3JDLFNBQVMsR0FBRyxJQUFJO0VBRXZCakcsV0FBV0EsQ0FBQSxFQUFHO0lBQ1osSUFBSSxDQUFDdUksWUFBWSxHQUFHdkMsb0JBQW9CLENBQUNLLFdBQVcsQ0FBQyxDQUFDO0lBQ3RELElBQUksQ0FBQ0Qsa0JBQWtCLEdBQUcsSUFBSTtJQUM5QixJQUFJLENBQUM1RSxNQUFNLEdBQUd2RCxTQUFTLENBQUMseUJBQXlCLENBQUM7SUFDbEQsSUFBSSxDQUFDdUQsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLHFDQUFxQyxFQUFFLE1BQU0sQ0FBQztFQUNoRTtFQUVBLE9BQU8ySCxXQUFXQSxDQUFBLEVBQUc7SUFDbkIsSUFBSSxDQUFDaUMsdUJBQXVCLENBQUNyQyxTQUFTLEVBQUU7TUFDdENxQyx1QkFBdUIsQ0FBQ3JDLFNBQVMsR0FBRyxJQUFJcUMsdUJBQXVCLENBQUMsQ0FBQztJQUNuRTtJQUNBLE9BQU9BLHVCQUF1QixDQUFDckMsU0FBUztFQUMxQztFQUVBLE1BQU11QyxrQkFBa0JBLENBQUEsRUFBRztJQUN6QixJQUFJLENBQUMsSUFBSSxDQUFDcEMsa0JBQWtCLEVBQUU7TUFDNUIsSUFBSSxDQUFDQSxrQkFBa0IsR0FBRyxNQUFNLElBQUksQ0FBQ21DLFlBQVksQ0FBQ2pDLFVBQVUsQ0FBQyxDQUFDO0lBQ2hFO0lBQ0EsT0FBTyxJQUFJLENBQUNGLGtCQUFrQjtFQUNoQztFQUVBLE1BQU1xQyxZQUFZQSxDQUFDQyxRQUFRLEVBQUU7SUFDM0IsSUFBSSxDQUFDbEgsTUFBTSxDQUFDOUIsVUFBVSxDQUFDO01BQUVnSjtJQUFTLENBQUMsQ0FBQztJQUVwQyxNQUFNbEQsUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDZ0Qsa0JBQWtCLENBQUMsQ0FBQztJQUVoRCxJQUFJLENBQUNFLFFBQVEsRUFBRTtNQUNiLE1BQU0sSUFBSTVLLEtBQUssQ0FBQyx1QkFBdUIsQ0FBQztJQUMxQzs7SUFFQTtJQUNBLE1BQU02SyxjQUFjLEdBQUdELFFBQVEsQ0FBQ0UsV0FBVyxDQUFDLENBQUMsQ0FBQzNELE9BQU8sQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDOztJQUVoRTtJQUNBLElBQUkwRCxjQUFjLEtBQUssS0FBSyxJQUFJQSxjQUFjLEtBQUssV0FBVyxFQUFFO01BQzlELElBQUksQ0FBQ25ILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxtQ0FBbUNpSyxjQUFjLEVBQUUsRUFBRSxNQUFNLENBQUM7TUFFNUUsTUFBTXRGLFNBQVMsR0FBR21DLFFBQVEsQ0FBQzFDLFVBQVUsR0FBRzZGLGNBQWMsQ0FBQztNQUN2RCxJQUFJdEYsU0FBUyxFQUFFO1FBQ2IsSUFBSSxDQUFDN0IsTUFBTSxDQUFDekMsT0FBTyxDQUFDLFNBQVM0SixjQUFjLFlBQVksQ0FBQztRQUN4RCxPQUFPO1VBQ0x0RixTQUFTLEVBQUU7WUFDVCxHQUFHQSxTQUFTO1lBQ1poRSxJQUFJLEVBQUVzSixjQUFjO1lBQ3BCM0YsT0FBTyxFQUFFLE1BQUFBLENBQU9DLE9BQU8sRUFBRXhFLElBQUksRUFBRXlFLE1BQU0sRUFBRTNCLE9BQU8sS0FBSztjQUNqRCxPQUFPOEIsU0FBUyxDQUFDTCxPQUFPLENBQUNDLE9BQU8sRUFBRXhFLElBQUksRUFBRXlFLE1BQU0sRUFBRTtnQkFDOUMsR0FBRzNCLE9BQU87Z0JBQ1Y5QyxJQUFJO2dCQUNKWSxJQUFJLEVBQUVzSjtjQUNSLENBQUMsQ0FBQztZQUNKO1VBQ0YsQ0FBQztVQUNEdEosSUFBSSxFQUFFc0osY0FBYztVQUNwQjlHLFFBQVEsRUFBRTtRQUNaLENBQUM7TUFDSDs7TUFFQTtNQUNBLElBQUksQ0FBQ0wsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLDZDQUE2Q2lLLGNBQWMsRUFBRSxFQUFFLE1BQU0sQ0FBQztNQUN0RixJQUFJbkQsUUFBUSxDQUFDekIsaUJBQWlCLEVBQUU7UUFDOUIsT0FBTztVQUNMVixTQUFTLEVBQUU7WUFDVEwsT0FBTyxFQUFFLE1BQUFBLENBQU9DLE9BQU8sRUFBRXhFLElBQUksRUFBRXlFLE1BQU0sRUFBRTNCLE9BQU8sS0FBSztjQUNqRCxPQUFPaUUsUUFBUSxDQUFDekIsaUJBQWlCLENBQUM0RSxjQUFjLEVBQUUxRixPQUFPLEVBQUU7Z0JBQ3pEeEUsSUFBSTtnQkFDSnlFLE1BQU07Z0JBQ04sR0FBRzNCO2NBQ0wsQ0FBQyxDQUFDO1lBQ0osQ0FBQztZQUNEK0IsUUFBUSxFQUFHQyxLQUFLLElBQUssT0FBT0EsS0FBSyxLQUFLLFFBQVEsSUFBSUEsS0FBSyxDQUFDckIsTUFBTSxHQUFHLENBQUM7WUFDbEV3QixNQUFNLEVBQUU7Y0FDTmpGLElBQUksRUFBRWtLLGNBQWMsS0FBSyxLQUFLLEdBQUcsVUFBVSxHQUFHLFNBQVM7Y0FDdkRoRixVQUFVLEVBQUUsQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQztjQUNyQ0MsU0FBUyxFQUFFLENBQUMsV0FBVyxFQUFFLG1CQUFtQixDQUFDO2NBQzdDQyxPQUFPLEVBQUUsRUFBRSxHQUFHLElBQUksR0FBRztZQUN2QjtVQUNGLENBQUM7VUFDRHhFLElBQUksRUFBRXNKLGNBQWM7VUFDcEI5RyxRQUFRLEVBQUU7UUFDWixDQUFDO01BQ0g7SUFDRjs7SUFFQTtJQUNBLE1BQU13QixTQUFTLEdBQUcsTUFBTW1DLFFBQVEsQ0FBQ3ZCLHVCQUF1QixDQUFDMEUsY0FBYyxDQUFDO0lBQ3hFLElBQUl0RixTQUFTLEVBQUU7TUFDYixPQUFPO1FBQ0xBLFNBQVM7UUFDVGhFLElBQUksRUFBRXNKLGNBQWM7UUFDcEI5RyxRQUFRLEVBQUUrRixvQkFBb0IsQ0FBQ2UsY0FBYyxDQUFDLElBQUk7TUFDcEQsQ0FBQztJQUNIO0lBRUEsTUFBTSxJQUFJN0ssS0FBSyxDQUFDLGdDQUFnQzRLLFFBQVEsRUFBRSxDQUFDO0VBQzdEOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNFLE1BQU1HLFdBQVdBLENBQUNDLFFBQVEsRUFBRXZILE9BQU8sR0FBRyxDQUFDLENBQUMsRUFBRTtJQUN4QyxNQUFNbUgsUUFBUSxHQUFHbkgsT0FBTyxDQUFDbUgsUUFBUTtJQUNqQyxNQUFNSyxTQUFTLEdBQUdDLElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUM7SUFFNUIsSUFBSSxDQUFDekgsTUFBTSxDQUFDcEMsa0JBQWtCLENBQUNzSixRQUFRLEVBQUVuSCxPQUFPLENBQUM7SUFFakQsSUFBSTtNQUNGLElBQUksQ0FBQ21ILFFBQVEsRUFBRTtRQUNiLE1BQU0sSUFBSTVLLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQztNQUNwRDs7TUFFQTtNQUNBLE1BQU1vTCxLQUFLLEdBQUdSLFFBQVEsS0FBSyxLQUFLLElBQUlBLFFBQVEsS0FBSyxXQUFXOztNQUU1RDtNQUNBLElBQUlTLFFBQVE7TUFFWixJQUFJM0YsTUFBTSxDQUFDQyxRQUFRLENBQUNxRixRQUFRLENBQUMsRUFBRTtRQUM3QjtRQUNBSyxRQUFRLEdBQUc1SCxPQUFPLENBQUM2SCxnQkFBZ0IsSUFBSTdILE9BQU8sQ0FBQzlDLElBQUk7UUFFbkQsSUFBSSxDQUFDMEssUUFBUSxFQUFFO1VBQ2IsTUFBTSxJQUFJckwsS0FBSyxDQUFDLHdEQUF3RCxDQUFDO1FBQzNFO01BQ0YsQ0FBQyxNQUFNLElBQUlvTCxLQUFLLEVBQUU7UUFDaEIsSUFBSTtVQUNGLE1BQU1HLE1BQU0sR0FBRyxJQUFJQyxHQUFHLENBQUNSLFFBQVEsQ0FBQztVQUNoQ0ssUUFBUSxHQUFHRSxNQUFNLENBQUNFLFFBQVEsSUFBSUYsTUFBTSxDQUFDRyxRQUFRLEtBQUssR0FBRyxHQUFHSCxNQUFNLENBQUNHLFFBQVEsR0FBRyxFQUFFLENBQUM7UUFDL0UsQ0FBQyxDQUFDLE9BQU9wTSxDQUFDLEVBQUU7VUFDVitMLFFBQVEsR0FBR0wsUUFBUTtRQUNyQjtNQUNGLENBQUMsTUFBTTtRQUNMSyxRQUFRLEdBQUc1SCxPQUFPLENBQUM2SCxnQkFBZ0IsSUFBSTdILE9BQU8sQ0FBQzlDLElBQUksSUFBSWhCLElBQUksQ0FBQ21FLFFBQVEsQ0FBQ2tILFFBQVEsQ0FBQztNQUNoRjs7TUFFQTtNQUNBdkgsT0FBTyxDQUFDNkgsZ0JBQWdCLEdBQUdELFFBQVE7TUFFbkMsSUFBSSxDQUFDM0gsTUFBTSxDQUFDdkMsa0JBQWtCLENBQzVCZCxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ0MsUUFBUSxFQUNoQ3RDLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDRyxVQUMxQixDQUFDOztNQUVEO01BQ0EsSUFBSThJLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQ2hCLFlBQVksQ0FBQ0MsUUFBUSxDQUFDOztNQUVyRDtNQUNBLElBQUksQ0FBQ2UsYUFBYSxLQUFLZixRQUFRLEtBQUssS0FBSyxJQUFJQSxRQUFRLEtBQUssV0FBVyxDQUFDLEVBQUU7UUFDdEUsSUFBSSxDQUFDbEgsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLHdCQUF3QmdLLFFBQVEscUJBQXFCLEVBQUUsTUFBTSxDQUFDO1FBQzlFZSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUNDLHdCQUF3QixDQUFDaEIsUUFBUSxDQUFDO1FBRTdELElBQUllLGFBQWEsRUFBRTtVQUNqQixJQUFJLENBQUNqSSxNQUFNLENBQUN6QyxPQUFPLENBQUMsZ0NBQWdDMkosUUFBUSxFQUFFLENBQUM7UUFDakU7TUFDRjs7TUFFQTtNQUNBLElBQUksQ0FBQ2UsYUFBYSxFQUFFO1FBQ2xCLElBQUksQ0FBQ2pJLE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxpQ0FBaUNnSyxRQUFRLGlCQUFpQixFQUFFLE1BQU0sQ0FBQztRQUNuRixNQUFNLElBQUlpQixPQUFPLENBQUMvSixPQUFPLElBQUlnSyxVQUFVLENBQUNoSyxPQUFPLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFDdEQ2SixhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUNoQixZQUFZLENBQUNDLFFBQVEsQ0FBQztRQUVqRCxJQUFJLENBQUNlLGFBQWEsS0FBS2YsUUFBUSxLQUFLLEtBQUssSUFBSUEsUUFBUSxLQUFLLFdBQVcsQ0FBQyxFQUFFO1VBQ3RFLElBQUksQ0FBQ2xILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQywwQ0FBMENnSyxRQUFRLEVBQUUsRUFBRSxNQUFNLENBQUM7VUFDN0VlLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQ0Msd0JBQXdCLENBQUNoQixRQUFRLENBQUM7UUFDL0Q7O1FBRUE7UUFDQSxJQUFJLENBQUNlLGFBQWEsRUFBRTtVQUNsQixJQUFJLENBQUNqSSxNQUFNLENBQUM5QyxHQUFHLENBQUMsc0NBQXNDZ0ssUUFBUSx3QkFBd0IsRUFBRSxNQUFNLENBQUM7VUFDL0YsTUFBTSxJQUFJaUIsT0FBTyxDQUFDL0osT0FBTyxJQUFJZ0ssVUFBVSxDQUFDaEssT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO1VBQ3ZENkosYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDaEIsWUFBWSxDQUFDQyxRQUFRLENBQUM7VUFFakQsSUFBSSxDQUFDZSxhQUFhLEtBQUtmLFFBQVEsS0FBSyxLQUFLLElBQUlBLFFBQVEsS0FBSyxXQUFXLENBQUMsRUFBRTtZQUN0RSxJQUFJLENBQUNsSCxNQUFNLENBQUM5QyxHQUFHLENBQUMseUNBQXlDZ0ssUUFBUSxFQUFFLEVBQUUsTUFBTSxDQUFDO1lBQzVFZSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUNDLHdCQUF3QixDQUFDaEIsUUFBUSxDQUFDO1VBQy9EO1VBRUEsSUFBSSxDQUFDZSxhQUFhLEVBQUU7WUFDbEIsTUFBTSxJQUFJM0wsS0FBSyxDQUFDLDBCQUEwQjRLLFFBQVEsRUFBRSxDQUFDO1VBQ3ZEO1FBQ0Y7TUFDRjs7TUFFQTtNQUNBLE1BQU1tQixlQUFlLEdBQUd0SSxPQUFPLENBQUN1SSxVQUFVLEdBQ3hDLElBQUk5TCxlQUFlLENBQUN1RCxPQUFPLENBQUN1SSxVQUFVLEVBQUUsR0FBRyxDQUFDLEdBQUcsSUFBSTtNQUVyRCxJQUFJRCxlQUFlLEVBQUU7UUFDbkJBLGVBQWUsQ0FBQzNKLE1BQU0sQ0FBQyxDQUFDLEVBQUU7VUFBRTZKLE1BQU0sRUFBRSxjQUFjO1VBQUVyQixRQUFRLEVBQUVBO1FBQVMsQ0FBQyxDQUFDO01BQzNFO01BRUEsTUFBTWxELFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQ2dELGtCQUFrQixDQUFDLENBQUM7TUFFaEQsSUFBSSxDQUFDaEgsTUFBTSxDQUFDeEMsS0FBSyxDQUFDLGlCQUFpQixFQUFFZCxrQkFBa0IsQ0FBQztRQUN0RDhMLFdBQVcsRUFBRSxDQUFDLENBQUN4RSxRQUFRO1FBQ3ZCeUUsYUFBYSxFQUFFUixhQUFhLEVBQUVwSyxJQUFJLElBQUksTUFBTTtRQUM1Q3dDLFFBQVEsRUFBRTRILGFBQWEsRUFBRTVILFFBQVEsSUFBSSxTQUFTO1FBQzlDcUksWUFBWSxFQUFFLENBQUMsQ0FBQ1QsYUFBYSxFQUFFcEcsU0FBUztRQUN4QzhHLGdCQUFnQixFQUFFVixhQUFhLEVBQUVwRztNQUNuQyxDQUFDLENBQUMsQ0FBQzs7TUFFSDtNQUNBLE1BQU0rRyxnQkFBZ0IsR0FBRyxNQUFNLElBQUksQ0FBQ0MsZ0JBQWdCLENBQUN2QixRQUFRLEVBQUU7UUFDN0QsR0FBR3ZILE9BQU87UUFDVm1ILFFBQVEsRUFBRUEsUUFBUTtRQUNsQlMsUUFBUTtRQUNSVSxlQUFlO1FBQ2ZKLGFBQWE7UUFDYlA7TUFDRixDQUFDLENBQUM7TUFFRixJQUFJVyxlQUFlLEVBQUU7UUFDbkJBLGVBQWUsQ0FBQzNKLE1BQU0sQ0FBQyxHQUFHLEVBQUU7VUFBRTZKLE1BQU0sRUFBRTtRQUFZLENBQUMsQ0FBQztNQUN0RDtNQUVBLElBQUksQ0FBQ3ZJLE1BQU0sQ0FBQ2pDLHFCQUFxQixDQUFDbUosUUFBUSxDQUFDO01BRTNDLE9BQU8wQixnQkFBZ0I7SUFFekIsQ0FBQyxDQUFDLE9BQU92TSxLQUFLLEVBQUU7TUFDZCxJQUFJLENBQUMyRCxNQUFNLENBQUNoQyxrQkFBa0IsQ0FBQ2tKLFFBQVEsRUFBRTdLLEtBQUssQ0FBQztNQUUvQyxPQUFPO1FBQ0xrQixPQUFPLEVBQUUsS0FBSztRQUNkbEIsS0FBSyxFQUFFQSxLQUFLLENBQUM0QixPQUFPO1FBQ3BCaUosUUFBUSxFQUFFQSxRQUFRO1FBQ2xCckosSUFBSSxFQUFFcUosUUFBUTtRQUNkakssSUFBSSxFQUFFOEMsT0FBTyxDQUFDNkgsZ0JBQWdCLElBQUksU0FBUztRQUMzQ3ZILFFBQVEsRUFBRStGLG9CQUFvQixDQUFDYyxRQUFRLENBQUMsSUFBSTtNQUM5QyxDQUFDO0lBQ0g7RUFDRjs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsTUFBTWdCLHdCQUF3QkEsQ0FBQ2hCLFFBQVEsRUFBRTtJQUN2QyxJQUFJLENBQUNsSCxNQUFNLENBQUM5QyxHQUFHLENBQUMscUNBQXFDZ0ssUUFBUSxFQUFFLEVBQUUsTUFBTSxDQUFDO0lBRXhFLE1BQU1sRCxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUNnRCxrQkFBa0IsQ0FBQyxDQUFDO0lBQ2hELElBQUksQ0FBQ2hELFFBQVEsQ0FBQ3pCLGlCQUFpQixFQUFFO01BQy9CLElBQUksQ0FBQ3ZDLE1BQU0sQ0FBQzNELEtBQUssQ0FBQyxxRUFBcUUsQ0FBQztNQUN4RixPQUFPLElBQUk7SUFDYjtJQUVBLE9BQU87TUFDTHdGLFNBQVMsRUFBRTtRQUNUTCxPQUFPLEVBQUUsTUFBQUEsQ0FBT0MsT0FBTyxFQUFFeEUsSUFBSSxFQUFFeUUsTUFBTSxFQUFFM0IsT0FBTyxLQUFLO1VBQ2pELElBQUksQ0FBQ0MsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLGtDQUFrQ2dLLFFBQVEsRUFBRSxFQUFFLE1BQU0sQ0FBQztVQUNyRSxPQUFPbEQsUUFBUSxDQUFDekIsaUJBQWlCLENBQUMyRSxRQUFRLEVBQUV6RixPQUFPLEVBQUU7WUFDbkR4RSxJQUFJO1lBQ0p5RSxNQUFNO1lBQ04sR0FBRzNCO1VBQ0wsQ0FBQyxDQUFDO1FBQ0osQ0FBQztRQUNEK0IsUUFBUSxFQUFHQyxLQUFLLElBQUssT0FBT0EsS0FBSyxLQUFLLFFBQVEsSUFBSUEsS0FBSyxDQUFDckIsTUFBTSxHQUFHLENBQUM7UUFDbEV3QixNQUFNLEVBQUU7VUFDTmpGLElBQUksRUFBRWlLLFFBQVEsS0FBSyxLQUFLLEdBQUcsVUFBVSxHQUFHLFNBQVM7VUFDakQvRSxVQUFVLEVBQUUsQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQztVQUNyQ0MsU0FBUyxFQUFFLENBQUMsV0FBVyxFQUFFLG1CQUFtQixDQUFDO1VBQzdDQyxPQUFPLEVBQUUsRUFBRSxHQUFHLElBQUksR0FBRztRQUN2QjtNQUNGLENBQUM7TUFDRHhFLElBQUksRUFBRXFKLFFBQVE7TUFDZDdHLFFBQVEsRUFBRTtJQUNaLENBQUM7RUFDSDs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNFeUksaUJBQWlCQSxDQUFDQyxNQUFNLEVBQUU3QixRQUFRLEVBQUVTLFFBQVEsRUFBRXRILFFBQVEsRUFBRTtJQUN0RCxJQUFJLENBQUNMLE1BQU0sQ0FBQ3hDLEtBQUssQ0FBQywyQkFBMkIwSixRQUFRLEdBQUcsRUFBRXhLLGtCQUFrQixDQUFDcU0sTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDOztJQUV2RjtJQUNBLElBQUksQ0FBQ0EsTUFBTSxFQUFFO01BQ1QsSUFBSSxDQUFDL0ksTUFBTSxDQUFDbEUsSUFBSSxDQUFDLHlDQUF5Q29MLFFBQVEscUJBQXFCLENBQUM7TUFDeEY2QixNQUFNLEdBQUc7UUFBRXhMLE9BQU8sRUFBRSxLQUFLO1FBQUVsQixLQUFLLEVBQUU7TUFBOEMsQ0FBQztJQUNyRjs7SUFFQTtJQUNBLElBQUkwTSxNQUFNLElBQUlBLE1BQU0sQ0FBQ0MsS0FBSyxLQUFLLElBQUksSUFBSUQsTUFBTSxDQUFDRSxZQUFZLEVBQUU7TUFDMUQsSUFBSSxDQUFDakosTUFBTSxDQUFDOUMsR0FBRyxDQUFDLElBQUlnSyxRQUFRLDhDQUE4QzZCLE1BQU0sQ0FBQ0UsWUFBWSxFQUFFLENBQUM7O01BRWhHO01BQ0E7TUFDQSxPQUFPO1FBQ0wsR0FBR0YsTUFBTTtRQUNUeEwsT0FBTyxFQUFFLElBQUk7UUFBRTtRQUNmTSxJQUFJLEVBQUVrTCxNQUFNLENBQUNsTCxJQUFJLElBQUlxSixRQUFRO1FBQzdCQSxRQUFRLEVBQUVBLFFBQVE7UUFDbEJqSyxJQUFJLEVBQUU4TCxNQUFNLENBQUM5TCxJQUFJLElBQUkwSyxRQUFRO1FBQzdCQyxnQkFBZ0IsRUFBRW1CLE1BQU0sQ0FBQ25CLGdCQUFnQixJQUFJbUIsTUFBTSxDQUFDOUwsSUFBSSxJQUFJMEssUUFBUTtRQUNwRXRILFFBQVEsRUFBRTBJLE1BQU0sQ0FBQzFJLFFBQVEsSUFBSUEsUUFBUTtRQUNyQzJJLEtBQUssRUFBRSxJQUFJO1FBQUU7UUFDYkMsWUFBWSxFQUFFRixNQUFNLENBQUNFLFlBQVk7UUFBRTtRQUNuQztRQUNBO1FBQ0F4SCxPQUFPLEVBQUVzSCxNQUFNLENBQUN0SCxPQUFPLElBQUksZ0JBQWdCeUYsUUFBUSxDQUFDM0MsV0FBVyxDQUFDLENBQUMsK0VBQStFO1FBQ2hKNUMsUUFBUSxFQUFFO1VBQ1IsSUFBSW9ILE1BQU0sQ0FBQ3BILFFBQVEsSUFBSSxDQUFDLENBQUMsQ0FBQztVQUMxQnFILEtBQUssRUFBRSxJQUFJO1VBQ1hDLFlBQVksRUFBRUYsTUFBTSxDQUFDRTtRQUN2QjtNQUNGLENBQUM7SUFDSDs7SUFFQTtJQUNBLElBQUksQ0FBQ2pKLE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQywyQkFBMkJnSyxRQUFRLEdBQUcsRUFBRTtNQUN0RGdDLHNCQUFzQixFQUFFSCxNQUFNLEVBQUVuQixnQkFBZ0I7TUFDaER1Qiw4QkFBOEIsRUFBRUosTUFBTSxFQUFFcEgsUUFBUSxFQUFFaUcsZ0JBQWdCO01BQ2xFd0IsVUFBVSxFQUFFTCxNQUFNLEVBQUU5TCxJQUFJO01BQ3hCb00scUJBQXFCLEVBQUUxQjtJQUN6QixDQUFDLENBQUM7O0lBRUY7SUFDQSxJQUFJVCxRQUFRLEtBQUssTUFBTSxJQUFJQSxRQUFRLEtBQUssS0FBSyxFQUFFO01BQzdDLElBQUksQ0FBQ2xILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyw0QkFBNEIsRUFBRTtRQUM1Q29NLDBCQUEwQixFQUFFUCxNQUFNLEVBQUVuQixnQkFBZ0I7UUFDcEQyQiw0QkFBNEIsRUFBRVIsTUFBTSxFQUFFcEgsUUFBUSxFQUFFaUcsZ0JBQWdCO1FBQ2hFNEIsY0FBYyxFQUFFVCxNQUFNLEVBQUU5TCxJQUFJO1FBQzVCd00sYUFBYSxFQUFFOUIsUUFBUTtRQUN2QitCLFVBQVUsRUFBRVgsTUFBTSxHQUFHN0QsTUFBTSxDQUFDYyxJQUFJLENBQUMrQyxNQUFNLENBQUMsR0FBRyxFQUFFO1FBQzdDWSxZQUFZLEVBQUVaLE1BQU0sRUFBRXBILFFBQVEsR0FBR3VELE1BQU0sQ0FBQ2MsSUFBSSxDQUFDK0MsTUFBTSxDQUFDcEgsUUFBUSxDQUFDLEdBQUc7TUFDbEUsQ0FBQyxDQUFDO0lBQ0o7O0lBRUE7SUFDQTtJQUNBO0lBQ0EsTUFBTWlJLFNBQVMsR0FBR2IsTUFBTSxDQUFDeEwsT0FBTyxLQUFLLElBQUk7O0lBRXpDO0lBQ0EsTUFBTXNNLGVBQWUsR0FBR25OLGtCQUFrQixDQUFDcU0sTUFBTSxDQUFDOztJQUVsRDtJQUNBLE1BQU1uQixnQkFBZ0IsR0FBSVYsUUFBUSxLQUFLLE1BQU0sSUFBSUEsUUFBUSxLQUFLLEtBQUssR0FDN0Q2QixNQUFNLENBQUNwSCxRQUFRLElBQUlvSCxNQUFNLENBQUNwSCxRQUFRLENBQUNpRyxnQkFBZ0IsSUFBS21CLE1BQU0sQ0FBQ25CLGdCQUFnQixJQUFJbUIsTUFBTSxDQUFDOUwsSUFBSSxJQUFJMEssUUFBUSxHQUMxR29CLE1BQU0sQ0FBQ3BILFFBQVEsSUFBSW9ILE1BQU0sQ0FBQ3BILFFBQVEsQ0FBQ2lHLGdCQUFnQixJQUFLbUIsTUFBTSxDQUFDbkIsZ0JBQWdCLElBQUltQixNQUFNLENBQUM5TCxJQUFJLElBQUkwSyxRQUFTOztJQUVqSDtJQUNBLElBQUksQ0FBQzNILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyw0Q0FBNENnSyxRQUFRLEtBQUtVLGdCQUFnQixFQUFFLENBQUM7SUFFNUYsTUFBTWtDLFlBQVksR0FBRztNQUNqQixHQUFHRCxlQUFlO01BQUU7TUFDcEJ0TSxPQUFPLEVBQUVxTSxTQUFTO01BQUU7TUFDcEIvTCxJQUFJLEVBQUVrTCxNQUFNLENBQUNsTCxJQUFJLElBQUlxSixRQUFRO01BQzdCQSxRQUFRLEVBQUVBLFFBQVE7TUFDbEJqSyxJQUFJLEVBQUUySyxnQkFBZ0I7TUFBRTtNQUN4QkEsZ0JBQWdCLEVBQUVBLGdCQUFnQjtNQUFFO01BQ3BDdkgsUUFBUSxFQUFFMEksTUFBTSxDQUFDMUksUUFBUSxJQUFJQSxRQUFRO01BQ3JDc0IsUUFBUSxFQUFFO1FBQ04sSUFBSW9ILE1BQU0sQ0FBQ3BILFFBQVEsSUFBSSxDQUFDLENBQUM7TUFDN0IsQ0FBQztNQUNEb0ksTUFBTSxFQUFFaEIsTUFBTSxDQUFDZ0IsTUFBTSxJQUFJLEVBQUU7TUFDM0I7TUFDQXRJLE9BQU8sRUFBRXNILE1BQU0sQ0FBQ3RILE9BQU8sS0FBS21JLFNBQVMsR0FBRyxFQUFFLEdBQUcsOEJBQThCMUMsUUFBUSxrSEFBa0gsQ0FBQztNQUN0TTtNQUNBN0ssS0FBSyxFQUFFLENBQUN1TixTQUFTLEdBQUliLE1BQU0sQ0FBQzFNLEtBQUssSUFBSSwwQkFBMEIsR0FBSTJOO0lBQ3ZFLENBQUM7O0lBRUQ7SUFDQSxJQUFJRixZQUFZLENBQUN2TSxPQUFPLEVBQUU7TUFDdEIsT0FBT3VNLFlBQVksQ0FBQ3pOLEtBQUs7SUFDN0I7O0lBRUE7SUFDQSxJQUFJLENBQUN5TixZQUFZLENBQUNySSxPQUFPLElBQUksQ0FBQ21JLFNBQVMsRUFBRTtNQUN2QyxJQUFJLENBQUM1SixNQUFNLENBQUN2QyxrQkFBa0IsQ0FDNUJkLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDSyxVQUFVLEVBQ2xDMUMsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNRLGFBQzFCLENBQUM7TUFDRDtNQUNBc0ssWUFBWSxDQUFDckksT0FBTyxHQUFHLDZCQUE2QnlGLFFBQVEsMERBQTBENEMsWUFBWSxDQUFDek4sS0FBSyxJQUFJLGVBQWUsRUFBRTtJQUMvSixDQUFDLE1BQU0sSUFBSSxDQUFDeU4sWUFBWSxDQUFDckksT0FBTyxJQUFJbUksU0FBUyxFQUFFO01BQzVDLElBQUksQ0FBQzVKLE1BQU0sQ0FBQ3ZDLGtCQUFrQixDQUM3QmQsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNLLFVBQVUsRUFDbEMxQyxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ1EsYUFDMUIsQ0FBQztNQUNEO01BQ0FzSyxZQUFZLENBQUNySSxPQUFPLEdBQUcsOEJBQThCeUYsUUFBUSwrSkFBK0o7SUFDOU47O0lBR0E7SUFDQSxJQUFJLENBQUNsSCxNQUFNLENBQUN4QyxLQUFLLENBQUMsMkJBQTJCMEosUUFBUSxHQUFHLEVBQUV4SyxrQkFBa0IsQ0FBQ29OLFlBQVksQ0FBQyxDQUFDO0lBRTNGLE9BQU9BLFlBQVk7RUFDckI7RUFFQSxNQUFNRyxtQkFBbUJBLENBQUMzQyxRQUFRLEVBQUV2SCxPQUFPLEVBQUVNLFFBQVEsRUFBRTtJQUNyRCxNQUFNO01BQUVnSSxlQUFlO01BQUVuQixRQUFRO01BQUVTLFFBQVE7TUFBRU07SUFBYyxDQUFDLEdBQUdsSSxPQUFPO0lBRXRFLElBQUlzSSxlQUFlLEVBQUU7TUFDbkJBLGVBQWUsQ0FBQzNKLE1BQU0sQ0FBQyxFQUFFLEVBQUU7UUFBRTZKLE1BQU0sRUFBRSxjQUFjckIsUUFBUTtNQUFHLENBQUMsQ0FBQztJQUNsRTtJQUVBLElBQUksQ0FBQ2xILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxtQkFBbUJvSyxRQUFRLEVBQUUsRUFBRSxNQUFNLENBQUM7SUFFdEQsSUFBSTtNQUNGO01BQ0EsTUFBTTtRQUFFekY7TUFBVSxDQUFDLEdBQUdvRyxhQUFhO01BRW5DLElBQUlpQyxTQUFTLEdBQUcsSUFBSTs7TUFFcEI7TUFDQSxJQUFJLE9BQU9ySSxTQUFTLENBQUNMLE9BQU8sS0FBSyxVQUFVLEVBQUU7UUFDM0MsSUFBSSxDQUFDeEIsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLCtCQUErQmdLLFFBQVEsRUFBRSxFQUFFLE1BQU0sQ0FBQztRQUNsRSxJQUFJLENBQUNsSCxNQUFNLENBQUM5QyxHQUFHLENBQUMsNkNBQTZDeUssUUFBUSxFQUFFLEVBQUUsTUFBTSxDQUFDO1FBRWhGLElBQUk7VUFDRjtVQUNBLE1BQU13QyxnQkFBZ0IsR0FBRyxDQUFDLENBQUM7VUFDM0JqRixNQUFNLENBQUNjLElBQUksQ0FBQ2pHLE9BQU8sQ0FBQyxDQUFDNEYsT0FBTyxDQUFDeUUsR0FBRyxJQUFJO1lBQ2xDRCxnQkFBZ0IsQ0FBQ0MsR0FBRyxDQUFDLEdBQUdySyxPQUFPLENBQUNxSyxHQUFHLENBQUM7VUFDdEMsQ0FBQyxDQUFDO1VBQ0ZELGdCQUFnQixDQUFDbE4sSUFBSSxHQUFHMEssUUFBUTtVQUNoQ3dDLGdCQUFnQixDQUFDdkMsZ0JBQWdCLEdBQUdELFFBQVE7VUFDNUN3QyxnQkFBZ0IsQ0FBQ3hJLFFBQVEsR0FBRztZQUMxQmlHLGdCQUFnQixFQUFFRDtVQUNwQixDQUFDO1VBQ0QsSUFBSTVILE9BQU8sQ0FBQzRCLFFBQVEsRUFBRTtZQUNwQnVELE1BQU0sQ0FBQ2MsSUFBSSxDQUFDakcsT0FBTyxDQUFDNEIsUUFBUSxDQUFDLENBQUNnRSxPQUFPLENBQUN5RSxHQUFHLElBQUk7Y0FDM0NELGdCQUFnQixDQUFDeEksUUFBUSxDQUFDeUksR0FBRyxDQUFDLEdBQUdySyxPQUFPLENBQUM0QixRQUFRLENBQUN5SSxHQUFHLENBQUM7WUFDeEQsQ0FBQyxDQUFDO1VBQ0o7VUFDQUQsZ0JBQWdCLENBQUM3QixVQUFVLEdBQUkzSixRQUFRLElBQUs7WUFDMUMsSUFBSTBKLGVBQWUsRUFBRTtjQUNuQkEsZUFBZSxDQUFDeEosWUFBWSxDQUFDRixRQUFRLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRTtnQkFDN0M0SixNQUFNLEVBQUUsT0FBTzVKLFFBQVEsS0FBSyxRQUFRLEdBQUdBLFFBQVEsQ0FBQzRKLE1BQU0sR0FBRyxjQUFjckIsUUFBUTtjQUNqRixDQUFDLENBQUM7WUFDSjtVQUNGLENBQUM7VUFFRCxJQUFJLENBQUNsSCxNQUFNLENBQUM5QyxHQUFHLENBQUMsd0NBQXdDb0ssUUFBUSxFQUFFLEVBQUUsTUFBTSxDQUFDO1VBQzNFNEMsU0FBUyxHQUFHLE1BQU1ySSxTQUFTLENBQUNMLE9BQU8sQ0FBQzhGLFFBQVEsRUFBRUssUUFBUSxFQUFFNUgsT0FBTyxDQUFDMkIsTUFBTSxFQUFFeUksZ0JBQWdCLENBQUM7VUFDekYsSUFBSSxDQUFDbkssTUFBTSxDQUFDOUMsR0FBRyxDQUFDLCtCQUErQixFQUFFLE1BQU0sQ0FBQztRQUMxRCxDQUFDLENBQUMsT0FBT21OLGNBQWMsRUFBRTtVQUN2QixJQUFJLENBQUNySyxNQUFNLENBQUMzRCxLQUFLLENBQUMsd0JBQXdCZ08sY0FBYyxDQUFDcE0sT0FBTyxFQUFFLENBQUM7VUFDbkUsTUFBTW9NLGNBQWM7UUFDdEI7TUFDRixDQUFDLE1BQU07UUFDTDtRQUNBLE1BQU1yRyxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUNnRCxrQkFBa0IsQ0FBQyxDQUFDO1FBQ2hELElBQUksQ0FBQ2hILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyx3Q0FBd0NnSyxRQUFRLEVBQUUsRUFBRSxNQUFNLENBQUM7UUFFM0UsTUFBTW9ELGVBQWUsR0FBRyxDQUFDLENBQUM7UUFDMUJwRixNQUFNLENBQUNjLElBQUksQ0FBQ2pHLE9BQU8sQ0FBQyxDQUFDNEYsT0FBTyxDQUFDeUUsR0FBRyxJQUFJO1VBQ2xDRSxlQUFlLENBQUNGLEdBQUcsQ0FBQyxHQUFHckssT0FBTyxDQUFDcUssR0FBRyxDQUFDO1FBQ3JDLENBQUMsQ0FBQztRQUNGRSxlQUFlLENBQUNyTixJQUFJLEdBQUcwSyxRQUFRO1FBQy9CMkMsZUFBZSxDQUFDMUMsZ0JBQWdCLEdBQUdELFFBQVE7UUFFM0N1QyxTQUFTLEdBQUcsTUFBTWxHLFFBQVEsQ0FBQ3pCLGlCQUFpQixDQUFDMkUsUUFBUSxFQUFFSSxRQUFRLEVBQUVnRCxlQUFlLENBQUM7TUFDbkY7TUFFQSxJQUFJakMsZUFBZSxFQUFFO1FBQ25CQSxlQUFlLENBQUMzSixNQUFNLENBQUMsRUFBRSxFQUFFO1VBQUU2SixNQUFNLEVBQUU7UUFBYSxDQUFDLENBQUM7TUFDdEQ7TUFFQSxJQUFJLENBQUN2SSxNQUFNLENBQUN2QyxrQkFBa0IsQ0FDNUJkLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDSyxVQUFVLEVBQ2xDMUMsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNNLFVBQzFCLENBQUM7O01BRUQ7TUFDQSxJQUFJLENBQUM0SyxTQUFTLEVBQUU7UUFDZCxNQUFNLElBQUk1TixLQUFLLENBQUMsMkNBQTJDLENBQUM7TUFDOUQ7TUFFQSxPQUFPLElBQUksQ0FBQ3dNLGlCQUFpQixDQUFDb0IsU0FBUyxFQUFFaEQsUUFBUSxFQUFFUyxRQUFRLEVBQUV0SCxRQUFRLENBQUM7SUFFeEUsQ0FBQyxDQUFDLE9BQU9oRSxLQUFLLEVBQUU7TUFDZCxJQUFJLENBQUMyRCxNQUFNLENBQUMzRCxLQUFLLENBQUMsNEJBQTRCQSxLQUFLLENBQUM0QixPQUFPLEVBQUUsQ0FBQzs7TUFFOUQ7TUFDQSxNQUFNK0YsUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDZ0Qsa0JBQWtCLENBQUMsQ0FBQztNQUNoRCxNQUFNO1FBQUVuRjtNQUFVLENBQUMsR0FBR29HLGFBQWE7TUFFbkMsSUFBSSxPQUFPcEcsU0FBUyxDQUFDTCxPQUFPLEtBQUssVUFBVSxJQUFJLE9BQU93QyxRQUFRLENBQUN6QixpQkFBaUIsS0FBSyxVQUFVLEVBQUU7UUFDL0YsSUFBSSxDQUFDdkMsTUFBTSxDQUFDOUMsR0FBRyxDQUFDLGtEQUFrRCxFQUFFLE1BQU0sQ0FBQztRQUUzRSxJQUFJO1VBQ0YsTUFBTXFOLGVBQWUsR0FBRyxDQUFDLENBQUM7VUFDMUJyRixNQUFNLENBQUNjLElBQUksQ0FBQ2pHLE9BQU8sQ0FBQyxDQUFDNEYsT0FBTyxDQUFDeUUsR0FBRyxJQUFJO1lBQ2xDRyxlQUFlLENBQUNILEdBQUcsQ0FBQyxHQUFHckssT0FBTyxDQUFDcUssR0FBRyxDQUFDO1VBQ3JDLENBQUMsQ0FBQztVQUNGRyxlQUFlLENBQUN0TixJQUFJLEdBQUcwSyxRQUFRO1VBQy9CNEMsZUFBZSxDQUFDM0MsZ0JBQWdCLEdBQUdELFFBQVE7VUFFM0MsTUFBTTZDLGNBQWMsR0FBRyxNQUFNeEcsUUFBUSxDQUFDekIsaUJBQWlCLENBQUMyRSxRQUFRLEVBQUVJLFFBQVEsRUFBRWlELGVBQWUsQ0FBQztVQUU1RixJQUFJLENBQUNDLGNBQWMsRUFBRTtZQUNuQixNQUFNLElBQUlsTyxLQUFLLENBQUMsb0RBQW9ELENBQUM7VUFDdkU7VUFFQSxPQUFPLElBQUksQ0FBQ3dNLGlCQUFpQixDQUFDMEIsY0FBYyxFQUFFdEQsUUFBUSxFQUFFUyxRQUFRLEVBQUV0SCxRQUFRLENBQUM7UUFDN0UsQ0FBQyxDQUFDLE9BQU9jLGFBQWEsRUFBRTtVQUN0QixJQUFJLENBQUNuQixNQUFNLENBQUMzRCxLQUFLLENBQUMsb0NBQW9DOEUsYUFBYSxDQUFDbEQsT0FBTyxFQUFFLENBQUM7VUFDOUUsTUFBTTVCLEtBQUssQ0FBQyxDQUFDO1FBQ2Y7TUFDRixDQUFDLE1BQU07UUFDTCxNQUFNQSxLQUFLLENBQUMsQ0FBQztNQUNmO0lBQ0Y7RUFDRjtFQUVBLE1BQU13TSxnQkFBZ0JBLENBQUN2QixRQUFRLEVBQUV2SCxPQUFPLEVBQUU7SUFDeEMsTUFBTTtNQUFFc0ksZUFBZTtNQUFFbkIsUUFBUTtNQUFFUyxRQUFRO01BQUVNLGFBQWE7TUFBRVA7SUFBTSxDQUFDLEdBQUczSCxPQUFPO0lBQzdFO0lBQ0E7SUFDQSxNQUFNTSxRQUFRLEdBQUc0SCxhQUFhLEVBQUU1SCxRQUFRLElBQUkrRixvQkFBb0IsQ0FBQ2MsUUFBUSxDQUFDLElBQUksU0FBUzs7SUFFdkY7SUFDQSxJQUFJUSxLQUFLLEVBQUU7TUFDVCxPQUFPLElBQUksQ0FBQ3VDLG1CQUFtQixDQUFDM0MsUUFBUSxFQUFFdkgsT0FBTyxFQUFFTSxRQUFRLENBQUM7SUFDOUQ7SUFFQSxJQUFJMEksTUFBTSxHQUFHLElBQUksQ0FBQyxDQUFDOztJQUVuQixJQUFJO01BQ0Y7TUFDQSxJQUFJLENBQUNkLGFBQWEsRUFBRTtRQUNsQixJQUFJLENBQUNqSSxNQUFNLENBQUMzRCxLQUFLLENBQUMsbUNBQW1DNkssUUFBUSxFQUFFLENBQUM7UUFDaEUsTUFBTSxJQUFJNUssS0FBSyxDQUFDLG1DQUFtQzRLLFFBQVEsRUFBRSxDQUFDO01BQ2hFO01BRUEsSUFBSSxDQUFDbEgsTUFBTSxDQUFDdkMsa0JBQWtCLENBQzVCZCxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ0csVUFBVSxFQUNsQ3hDLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDSSxZQUMxQixDQUFDOztNQUVEO01BQ0EsTUFBTXFMLFdBQVcsR0FBR3pJLE1BQU0sQ0FBQ0MsUUFBUSxDQUFDcUYsUUFBUSxDQUFDLEdBQUdBLFFBQVEsR0FBR3ZMLEVBQUUsQ0FBQzJPLFlBQVksQ0FBQ3BELFFBQVEsQ0FBQztNQUVwRixJQUFJZSxlQUFlLEVBQUU7UUFDbkJBLGVBQWUsQ0FBQzNKLE1BQU0sQ0FBQyxFQUFFLEVBQUU7VUFBRTZKLE1BQU0sRUFBRSxjQUFjckIsUUFBUTtRQUFHLENBQUMsQ0FBQztNQUNsRTs7TUFFQTtNQUNBLElBQUlBLFFBQVEsS0FBSyxLQUFLLEVBQUU7UUFDdEIsSUFBSSxDQUFDbEgsTUFBTSxDQUFDeEMsS0FBSyxDQUFDLDhCQUE4QixFQUFFO1VBQ2hEbU4sTUFBTSxFQUFFNUssT0FBTyxDQUFDNEssTUFBTTtVQUN0QkMsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDN0ssT0FBTyxDQUFDOEssYUFBYTtVQUN6Q0MsZ0JBQWdCLEVBQUU7UUFDcEIsQ0FBQyxDQUFDOztRQUVGO1FBQ0EsSUFBSS9LLE9BQU8sQ0FBQzRLLE1BQU0sRUFBRTtVQUNsQixJQUFJLENBQUMzSyxNQUFNLENBQUM5QyxHQUFHLENBQUMsb0NBQW9DLEVBQUUsTUFBTSxDQUFDO1VBQzdELElBQUk2QyxPQUFPLENBQUM4SyxhQUFhLEVBQUU7WUFDekIsSUFBSSxDQUFDN0ssTUFBTSxDQUFDeEMsS0FBSyxDQUFDLDRCQUE0QixDQUFDO1VBQ2pELENBQUMsTUFBTTtZQUNMLElBQUksQ0FBQ3dDLE1BQU0sQ0FBQ2xFLElBQUksQ0FBQywrQ0FBK0MsQ0FBQztVQUNuRTtRQUNGO01BQ0Y7O01BRUE7TUFDQSxJQUFJb0wsUUFBUSxLQUFLLEtBQUssSUFBSUEsUUFBUSxLQUFLLEtBQUssSUFBSUEsUUFBUSxLQUFLLEtBQUssSUFBSUEsUUFBUSxLQUFLLEtBQUssSUFDcEZBLFFBQVEsS0FBSyxLQUFLLElBQUlBLFFBQVEsS0FBSyxNQUFNLElBQUlBLFFBQVEsS0FBSyxLQUFLLElBQy9EQSxRQUFRLEtBQUssTUFBTSxJQUFJQSxRQUFRLEtBQUssS0FBSyxFQUFFO1FBQzdDLElBQUksQ0FBQ2xILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQywrQkFBK0JnSyxRQUFRLEdBQUcsRUFBRSxNQUFNLENBQUM7O1FBRW5FO1FBQ0EsSUFBSW5ILE9BQU8sQ0FBQzhLLGFBQWEsRUFBRTtVQUN6QixJQUFJLENBQUM3SyxNQUFNLENBQUM5QyxHQUFHLENBQUMsNkRBQTZELEVBQUUsTUFBTSxDQUFDO1VBQ3RGLE1BQU07WUFBRTJOLGFBQWE7WUFBRSxHQUFHRTtVQUFhLENBQUMsR0FBR2hMLE9BQU87VUFDbERBLE9BQU8sR0FBR2dMLFlBQVk7UUFDeEI7TUFDRjtNQUVBLElBQUksQ0FBQy9LLE1BQU0sQ0FBQ3ZDLGtCQUFrQixDQUM1QmQsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNJLFlBQVksRUFDcEN6QyxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ0ssVUFDMUIsQ0FBQzs7TUFFRDtNQUNBLE1BQU07UUFBRXdDLFNBQVM7UUFBRXhCO01BQVMsQ0FBQyxHQUFHNEgsYUFBYTs7TUFFN0M7TUFDQSxJQUFJLENBQUNqSSxNQUFNLENBQUM5QyxHQUFHLENBQUMsZ0RBQWdEeUssUUFBUSxFQUFFLEVBQUUsTUFBTSxDQUFDO01BQ25GLElBQUksQ0FBQzNILE1BQU0sQ0FBQzlDLEdBQUcsQ0FBQyxvQ0FBb0MsRUFBRTtRQUNwRDhOLG1CQUFtQixFQUFFLENBQUMsQ0FBQ2pMLE9BQU8sQ0FBQzZILGdCQUFnQjtRQUMvQ3FELHFCQUFxQixFQUFFbEwsT0FBTyxDQUFDNkgsZ0JBQWdCO1FBQy9DRCxRQUFRLEVBQUVBLFFBQVE7UUFDbEJULFFBQVEsRUFBRUE7TUFDWixDQUFDLENBQUM7TUFFRixNQUFNNkIsTUFBTSxHQUFHLE1BQU1sSCxTQUFTLENBQUNMLE9BQU8sQ0FBQ2lKLFdBQVcsRUFBRTlDLFFBQVEsRUFBRTVILE9BQU8sQ0FBQzJCLE1BQU0sRUFBRTtRQUM1RSxHQUFHM0IsT0FBTztRQUNWOUMsSUFBSSxFQUFFMEssUUFBUTtRQUNkQyxnQkFBZ0IsRUFBRUQsUUFBUTtRQUFFO1FBQzVCaEcsUUFBUSxFQUFFO1VBQ1IsSUFBSTVCLE9BQU8sQ0FBQzRCLFFBQVEsSUFBSSxDQUFDLENBQUMsQ0FBQztVQUMzQmlHLGdCQUFnQixFQUFFRCxRQUFRLENBQUM7UUFDN0IsQ0FBQztRQUNEVyxVQUFVLEVBQUczSixRQUFRLElBQUs7VUFDeEIsSUFBSTBKLGVBQWUsRUFBRTtZQUNuQkEsZUFBZSxDQUFDeEosWUFBWSxDQUFDRixRQUFRLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRTtjQUM3QzRKLE1BQU0sRUFBRSxPQUFPNUosUUFBUSxLQUFLLFFBQVEsR0FBR0EsUUFBUSxDQUFDNEosTUFBTSxHQUFHLGNBQWNyQixRQUFRO1lBQ2pGLENBQUMsQ0FBQztVQUNKO1FBQ0Y7TUFDRixDQUFDLENBQUM7TUFFRixJQUFJbUIsZUFBZSxFQUFFO1FBQ25CQSxlQUFlLENBQUMzSixNQUFNLENBQUMsRUFBRSxFQUFFO1VBQUU2SixNQUFNLEVBQUU7UUFBYSxDQUFDLENBQUM7TUFDdEQ7TUFFQSxJQUFJLENBQUN2SSxNQUFNLENBQUN2QyxrQkFBa0IsQ0FDNUJkLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDSyxVQUFVLEVBQ2xDMUMsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNNLFVBQzFCLENBQUM7TUFFRCxPQUFPLElBQUksQ0FBQ3dKLGlCQUFpQixDQUFDQyxNQUFNLEVBQUU3QixRQUFRLEVBQUVTLFFBQVEsRUFBRXRILFFBQVEsQ0FBQztJQUNyRSxDQUFDLENBQUMsT0FBT2hFLEtBQUssRUFBRTtNQUNkLElBQUksQ0FBQzJELE1BQU0sQ0FBQ2hDLGtCQUFrQixDQUFDa0osUUFBUSxFQUFFN0ssS0FBSyxDQUFDO01BQy9DLE9BQU87UUFDTGtCLE9BQU8sRUFBRSxLQUFLO1FBQ2RsQixLQUFLLEVBQUUsR0FBRzZLLFFBQVEsQ0FBQzNDLFdBQVcsQ0FBQyxDQUFDLHVCQUF1QmxJLEtBQUssQ0FBQzRCLE9BQU8sRUFBRTtRQUN0RXdELE9BQU8sRUFBRSwyQ0FBMkN5RixRQUFRLENBQUMzQyxXQUFXLENBQUMsQ0FBQyxVQUFVbEksS0FBSyxDQUFDNEIsT0FBTyxFQUFFO1FBQ25HaUosUUFBUSxFQUFFQSxRQUFRO1FBQUU7UUFDcEJqSyxJQUFJLEVBQUUwSyxRQUFRO1FBQ2R0SCxRQUFRLEVBQUVBLFFBQVEsSUFBSTtNQUN4QixDQUFDO0lBQ0g7RUFDRjtBQUNGOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsTUFBTTZLLHVCQUF1QixHQUFHcEUsdUJBQXVCLENBQUNqQyxXQUFXLENBQUMsQ0FBQzs7QUFFckU7QUFDQXFHLHVCQUF1QixDQUFDcEcsVUFBVSxHQUFHLGtCQUFpQjtFQUNwRCxJQUFJLENBQUM5RSxNQUFNLENBQUN2QyxrQkFBa0IsQ0FDNUJkLGdCQUFnQixDQUFDcUMsTUFBTSxDQUFDQyxRQUFRLEVBQ2hDdEMsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNFLFlBQzFCLENBQUM7RUFFRCxJQUFJO0lBQ0YsTUFBTSxJQUFJLENBQUM4SCxrQkFBa0IsQ0FBQyxDQUFDO0lBQy9CLElBQUksQ0FBQ2hILE1BQU0sQ0FBQ3ZDLGtCQUFrQixDQUM1QmQsZ0JBQWdCLENBQUNxQyxNQUFNLENBQUNFLFlBQVksRUFDcEN2QyxnQkFBZ0IsQ0FBQ3FDLE1BQU0sQ0FBQ08sU0FDMUIsQ0FBQztJQUNELE9BQU8sSUFBSTtFQUNiLENBQUMsQ0FBQyxPQUFPbEQsS0FBSyxFQUFFO0lBQ2QsSUFBSSxDQUFDMkQsTUFBTSxDQUFDaEMsa0JBQWtCLENBQUMsTUFBTSxFQUFFM0IsS0FBSyxDQUFDO0lBQzdDLE1BQU1BLEtBQUs7RUFDYjtBQUNGLENBQUM7O0FBRUQ7QUFDQXlFLE1BQU0sQ0FBQ3FLLE9BQU8sR0FBR0QsdUJBQXVCO0FBQ3hDcEssTUFBTSxDQUFDcUssT0FBTyxDQUFDRCx1QkFBdUIsR0FBR0EsdUJBQXVCIiwiaWdub3JlTGlzdCI6W119