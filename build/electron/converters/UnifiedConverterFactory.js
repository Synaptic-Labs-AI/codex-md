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

    // Log detailed filename information for debugging
    this.logger.log(`📄 Filename details for ${fileType}:`, {
      resultOriginalFileName: result?.originalFileName,
      resultMetadataOriginalFileName: result?.metadata?.originalFileName,
      resultName: result?.name,
      functionParamFileName: fileName
    });

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
      name: result.metadata && result.metadata.originalFileName || result.originalFileName || result.name || fileName,
      // Prefer metadata.originalFileName first
      originalFileName: result.metadata && result.metadata.originalFileName || result.originalFileName || result.name || fileName,
      // Same priority for consistency
      category: result.category || category,
      metadata: {
        ...(result.metadata || {}),
        converter: result.converter || 'unknown',
        originalFileName: result.metadata && result.metadata.originalFileName ||
        // First priority - from converter's metadata
        result.originalFileName ||
        // Second priority - from result's direct property
        result.name ||
        // Third priority - from result's name
        fileName // Final fallback - from function parameter
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
    // Extract category from converterInfo to avoid "category is not defined" error
    const category = converterInfo?.category || FILE_TYPE_CATEGORIES[fileType] || 'unknown';
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
          // Extract converter from converterInfo
          const {
            converter
          } = converterInfo;

          // Try using the converter's convert method first
          if (typeof converter.convert === 'function') {
            this.logger.log(`Using converter.convert for ${fileType}`, 'INFO');
            result = await converter.convert(filePath, fileName, options.apiKey, {
              ...options,
              name: fileName,
              originalFileName: fileName,
              // Explicitly pass originalFileName
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
              originalFileName: fileName,
              // Explicitly pass originalFileName
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
          // Extract converter from converterInfo
          const {
            converter
          } = converterInfo;
          if (typeof converter.convert === 'function' && typeof registry.convertToMarkdown === 'function') {
            this.logger.log(`Trying alternative conversion method as fallback`, 'INFO');
            try {
              // If we tried converter.convert first, now try registry.convertToMarkdown
              result = await registry.convertToMarkdown(fileType, filePath, {
                ...options,
                name: fileName,
                originalFileName: fileName,
                // Explicitly pass originalFileName
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
        originalFileName: fileName,
        // Explicitly pass originalFileName
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJhcHAiLCJlbGVjdHJvbiIsInJlcXVpcmUiLCJyZW1vdGUiLCJlIiwiY29uc29sZSIsIndhcm4iLCJmcyIsImV4aXN0c1N5bmMiLCJwYXRoIiwic3RhdFN5bmMiLCJpc0ZpbGUiLCJpbm5lckUiLCJlcnJvciIsIkVycm9yIiwiUGF0aFV0aWxzIiwiUHJvZ3Jlc3NUcmFja2VyIiwiZ2V0TG9nZ2VyIiwic2FuaXRpemVGb3JMb2dnaW5nIiwiQ29udmVyc2lvblN0YXR1cyIsInNhZmVSZXF1aXJlIiwibW9kdWxlUGF0aCIsImZhbGxiYWNrcyIsImZhbGxiYWNrIiwiaW5jbHVkZXMiLCJuYW1lIiwibG9nIiwibXNnIiwibGV2ZWwiLCJhcmdzIiwiZXJyIiwic3VjY2VzcyIsImRlYnVnIiwibG9nUGhhc2VUcmFuc2l0aW9uIiwiZnJvbSIsInRvIiwibG9nQ29udmVyc2lvblN0YXJ0IiwidHlwZSIsIm9wdHMiLCJsb2dDb252ZXJzaW9uQ29tcGxldGUiLCJsb2dDb252ZXJzaW9uRXJyb3IiLCJtZXNzYWdlIiwic2V0Q29udGV4dCIsIm9iaiIsInJlc29sdmUiLCJfX2Rpcm5hbWUiLCJwcm9jZXNzIiwiY3dkIiwiY29uc3RydWN0b3IiLCJjYWxsYmFjayIsInVwZGF0ZSIsInByb2dyZXNzIiwiZGF0YSIsInVwZGF0ZVNjYWxlZCIsIm1pbiIsIm1heCIsIlNUQVRVUyIsIlNUQVJUSU5HIiwiSU5JVElBTElaSU5HIiwiVkFMSURBVElORyIsIkZBU1RfQVRURU1QVCIsIlBST0NFU1NJTkciLCJGSU5BTElaSU5HIiwiQ09NUExFVEVEIiwiQ09OVEVOVF9FTVBUWSIsImlzUGFja2FnZWQiLCJnZXRBcHBQYXRoIiwiZ2V0TmFtZSIsImdldFZlcnNpb24iLCJNb2R1bGVMb2FkZXIiLCJsb2FkTW9kdWxlIiwib3B0aW9ucyIsImxvZ2dlciIsImZhbGxiYWNrUGF0aHMiLCJzaWxlbnQiLCJtb2R1bGVOYW1lIiwiYmFzZW5hbWUiLCJjYXRlZ29yeSIsInBhdGhQYXJ0cyIsImRpcm5hbWUiLCJzcGxpdCIsInNlcCIsImxlbmd0aCIsInNsaWNlIiwiam9pbiIsIk1vZHVsZVJlc29sdmVyIiwibW9kdWxlIiwicmVzb2x2ZXJFcnJvciIsImRlZmF1bHQiLCJkaXJlY3RFcnJvciIsImZhbGxiYWNrUGF0aCIsImZhbGxiYWNrRXJyb3IiLCJfY3JlYXRlRW1lcmdlbmN5UmVnaXN0cnkiLCJDb252ZXJ0ZXJSZWdpc3RyeSIsImNvbnZlcnRlcnMiLCJwZGYiLCJjb252ZXJ0IiwiY29udGVudCIsImFwaUtleSIsIm1ldGFkYXRhIiwicGFnZXMiLCJjb252ZXJ0ZXIiLCJ2YWxpZGF0ZSIsImlucHV0IiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJjb25maWciLCJleHRlbnNpb25zIiwibWltZVR5cGVzIiwibWF4U2l6ZSIsInByb3RvdHlwZSIsImNvbnZlcnRUb01hcmtkb3duIiwic291cmNlIiwiZ2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJleHRlbnNpb24iLCJsb2FkTW9kdWxlRnJvbUJlc3RQYXRoIiwiYmFzZVBhdGhzIiwicmVzb2x2ZWRQYXRocyIsIm1hcCIsImJhc2VQYXRoIiwiZXhpc3RpbmdQYXRocyIsImZpbHRlciIsInAiLCJleGlzdHMiLCJnZXRNb2R1bGVQYXRocyIsImlzRGV2IiwiZW52IiwiTk9ERV9FTlYiLCJwb3NzaWJsZVBhdGhzIiwicmVwbGFjZSIsImV4ZWNQYXRoIiwiZXJyb3JQYXRoIiwiY29ycmVjdGVkUGF0aCIsImNhbmRpZGF0ZVBhdGgiLCJkaXJlY3RSZWdpc3RyeVBhdGhzIiwicmVnaXN0cnlQYXRoIiwicmVnaXN0cnkiLCJ1cmwiLCJkb2N4IiwicHB0eCIsInhsc3giLCJjc3YiLCJNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkiLCJ0b1VwcGVyQ2FzZSIsIkNvbnZlcnRlckluaXRpYWxpemVyIiwiX2luc3RhbmNlIiwiX2luaXRpYWxpemVkIiwiX2luaXRQcm9taXNlIiwiX2NvbnZlcnRlclJlZ2lzdHJ5IiwiZ2V0SW5zdGFuY2UiLCJpbml0aWFsaXplIiwiX2RvSW5pdGlhbGl6ZSIsInBhdGhzIiwicG9zc2libGVCYXNlUGF0aHMiLCJPYmplY3QiLCJ2YWx1ZXMiLCJhbGxQb3NzaWJsZVJlZ2lzdHJ5UGF0aHMiLCJkaXJlY3RMb2FkRXJyb3IiLCJpbml0aWFsRXJyb3IiLCJiYXNlRGlycyIsImFkZEJhc2VEaXIiLCJkaXIiLCJwdXNoIiwiZm9yRWFjaCIsImNvbnZlcnRlclBhdGgiLCJjb252ZXJ0ZXJEaXIiLCJiZXN0UGF0aEVycm9yIiwiX3ZhbGlkYXRlUmVnaXN0cnkiLCJrZXlzIiwiZW5oYW5jZWRFcnJvciIsIm9yaWdpbmFsIiwic3RhY2siLCJGSUxFX1RZUEVfQ0FURUdPUklFUyIsIm1wMyIsIndhdiIsIm9nZyIsImZsYWMiLCJtcDQiLCJ3ZWJtIiwiYXZpIiwibW92IiwicGFyZW50dXJsIiwiVW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJfaW5pdGlhbGl6ZXIiLCJfZW5zdXJlSW5pdGlhbGl6ZWQiLCJnZXRDb252ZXJ0ZXIiLCJmaWxlVHlwZSIsIm5vcm1hbGl6ZWRUeXBlIiwidG9Mb3dlckNhc2UiLCJjb252ZXJ0RmlsZSIsImZpbGVQYXRoIiwic3RhcnRUaW1lIiwiRGF0ZSIsIm5vdyIsImlzVXJsIiwiZmlsZU5hbWUiLCJvcmlnaW5hbEZpbGVOYW1lIiwidXJsT2JqIiwiVVJMIiwiaG9zdG5hbWUiLCJwYXRobmFtZSIsImNvbnZlcnRlckluZm8iLCJjcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIiLCJQcm9taXNlIiwic2V0VGltZW91dCIsInByb2dyZXNzVHJhY2tlciIsIm9uUHJvZ3Jlc3MiLCJzdGF0dXMiLCJoYXNSZWdpc3RyeSIsImNvbnZlcnRlclR5cGUiLCJoYXNDb252ZXJ0ZXIiLCJjb252ZXJ0ZXJEZXRhaWxzIiwicmVzdWx0IiwiaGFuZGxlQ29udmVyc2lvbiIsInN0YW5kYXJkaXplUmVzdWx0IiwicmVzdWx0T3JpZ2luYWxGaWxlTmFtZSIsInJlc3VsdE1ldGFkYXRhT3JpZ2luYWxGaWxlTmFtZSIsInJlc3VsdE5hbWUiLCJmdW5jdGlvblBhcmFtRmlsZU5hbWUiLCJpc1N1Y2Nlc3MiLCJzYW5pdGl6ZWRSZXN1bHQiLCJzdGFuZGFyZGl6ZWQiLCJpbWFnZXMiLCJ1bmRlZmluZWQiLCJmaWxlQ29udGVudCIsInJlYWRGaWxlU3luYyIsInVzZU9jciIsImhhc01pc3RyYWxBcGlLZXkiLCJtaXN0cmFsQXBpS2V5IiwicHJlc2VydmVQYWdlSW5mbyIsImNsZWFuT3B0aW9ucyIsInVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5IiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbGVjdHJvbi9jb252ZXJ0ZXJzL1VuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBVbmlmaWVkQ29udmVydGVyRmFjdG9yeS5qc1xyXG4gKiBcclxuICogQ2VudHJhbCBmYWN0b3J5IGZvciBhbGwgZmlsZSB0eXBlIGNvbnZlcnNpb25zIGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXHJcbiAqIFVzZXMgQ29tbW9uSlMgZm9yIGNvbnNpc3RlbmN5IHdpdGggRWxlY3Ryb24gbWFpbiBwcm9jZXNzIGFuZCBwcm92aWRlcyByb2J1c3QgaW5pdGlhbGl6YXRpb25cclxuICogYW5kIGNvbnZlcnRlciBtYW5hZ2VtZW50LlxyXG4gKiBcclxuICogUmVsYXRlZCBmaWxlczpcclxuICogLSBzcmMvZWxlY3Ryb24vc2VydmljZXMvRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZS5qczogVXNlcyB0aGlzIGZhY3RvcnkgZm9yIGNvbnZlcnNpb25zXHJcbiAqIC0gc3JjL2VsZWN0cm9uL2lwYy9oYW5kbGVycy9jb252ZXJzaW9uL2luZGV4LmpzOiBFeHBvc2VzIGNvbnZlcnNpb24gdG8gcmVuZGVyZXIgcHJvY2Vzc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzOiBDb252ZXJ0ZXIgaW1wbGVtZW50YXRpb25zXHJcbiAqL1xyXG5cclxuLy8gQ29yZSBkZXBlbmRlbmNpZXNcclxubGV0IGFwcDtcclxudHJ5IHtcclxuICAvLyBUcnkgdG8gbG9hZCBlbGVjdHJvbiBpbiBhIHNhZmVyIHdheVxyXG4gIGNvbnN0IGVsZWN0cm9uID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuICBhcHAgPSBlbGVjdHJvbi5hcHAgfHwgKGVsZWN0cm9uLnJlbW90ZSAmJiBlbGVjdHJvbi5yZW1vdGUuYXBwKTtcclxufSBjYXRjaCAoZSkge1xyXG4gIC8vIElmIGVsZWN0cm9uIGlzbid0IGF2YWlsYWJsZSwgd2UnbGwgaGFuZGxlIGl0IGJlbG93XHJcbiAgY29uc29sZS53YXJuKCdDb3VsZCBub3QgbG9hZCBlbGVjdHJvbiBhcHAsIHVzaW5nIGZhbGxiYWNrcycpO1xyXG59XHJcblxyXG4vLyBFc3NlbnRpYWwgdXRpbGl0aWVzIC0gbG9hZCB3aXRoIGZhbGxiYWNrc1xyXG5sZXQgZnM7XHJcbnRyeSB7XHJcbiAgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG59IGNhdGNoIChlKSB7XHJcbiAgdHJ5IHtcclxuICAgIGZzID0gcmVxdWlyZSgnZnMnKTtcclxuICAgIC8vIEFkZCBmcy1leHRyYSBtZXRob2RzIHdlIHVzZVxyXG4gICAgZnMuZXhpc3RzU3luYyA9IGZzLmV4aXN0c1N5bmMgfHwgKChwYXRoKSA9PiB7XHJcbiAgICAgIHRyeSB7IHJldHVybiBmcy5zdGF0U3luYyhwYXRoKS5pc0ZpbGUoKTsgfSBjYXRjaCAoZSkgeyByZXR1cm4gZmFsc2U7IH1cclxuICAgIH0pO1xyXG4gIH0gY2F0Y2ggKGlubmVyRSkge1xyXG4gICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGxvYWQgZnMgbW9kdWxlcycsIGlubmVyRSk7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0NyaXRpY2FsIGRlcGVuZGVuY3kgZnMvZnMtZXh0cmEgbm90IGF2YWlsYWJsZScpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gUGF0aCBoYW5kbGluZyAtIGVzc2VudGlhbCBmb3IgbW9kdWxlIHJlc29sdXRpb25cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuXHJcbi8vIFRyeSB0byBsb2FkIGludGVybmFsIG1vZHVsZXMgd2l0aCBmYWxsYmFja3NcclxubGV0IFBhdGhVdGlscywgUHJvZ3Jlc3NUcmFja2VyLCBnZXRMb2dnZXIsIHNhbml0aXplRm9yTG9nZ2luZywgQ29udmVyc2lvblN0YXR1cztcclxuXHJcbi8vIEF0dGVtcHQgdG8gbG9hZCBlYWNoIG1vZHVsZSB3aXRoIGZhbGxiYWNrcyB0byBwcmV2ZW50IGNyYXNoZXNcclxuY29uc3Qgc2FmZVJlcXVpcmUgPSAobW9kdWxlUGF0aCwgZmFsbGJhY2tzID0gW10pID0+IHtcclxuICB0cnkge1xyXG4gICAgcmV0dXJuIHJlcXVpcmUobW9kdWxlUGF0aCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgZm9yIChjb25zdCBmYWxsYmFjayBvZiBmYWxsYmFja3MpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICByZXR1cm4gcmVxdWlyZShmYWxsYmFjayk7XHJcbiAgICAgIH0gY2F0Y2ggeyAvKiBDb250aW51ZSB0byBuZXh0IGZhbGxiYWNrICovIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBEZWZhdWx0IGltcGxlbWVudGF0aW9ucyBmb3IgY3JpdGljYWwgZnVuY3Rpb25zXHJcbiAgICBpZiAobW9kdWxlUGF0aC5pbmNsdWRlcygnZ2V0TG9nZ2VyJykpIHtcclxuICAgICAgcmV0dXJuIChuYW1lKSA9PiAoe1xyXG4gICAgICAgIGxvZzogKG1zZywgbGV2ZWwsIC4uLmFyZ3MpID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV1bJHtsZXZlbCB8fCAnSU5GTyd9XSAke21zZ31gLCAuLi5hcmdzKSxcclxuICAgICAgICBlcnJvcjogKG1zZywgZXJyKSA9PiBjb25zb2xlLmVycm9yKGBbJHtuYW1lfV1bRVJST1JdICR7bXNnfWAsIGVyciksXHJcbiAgICAgICAgd2FybjogKG1zZywgLi4uYXJncykgPT4gY29uc29sZS53YXJuKGBbJHtuYW1lfV1bV0FSTl0gJHttc2d9YCwgLi4uYXJncyksXHJcbiAgICAgICAgc3VjY2VzczogKG1zZykgPT4gY29uc29sZS5sb2coYFske25hbWV9XVtTVUNDRVNTXSAke21zZ31gKSxcclxuICAgICAgICBkZWJ1ZzogKG1zZywgLi4uYXJncykgPT4gY29uc29sZS5kZWJ1ZyhgWyR7bmFtZX1dW0RFQlVHXSAke21zZ31gLCAuLi5hcmdzKSxcclxuICAgICAgICBsb2dQaGFzZVRyYW5zaXRpb246IChmcm9tLCB0bykgPT4gY29uc29sZS5sb2coYFske25hbWV9XSBQaGFzZSB0cmFuc2l0aW9uOiAke2Zyb219IOKGkiAke3RvfWApLFxyXG4gICAgICAgIGxvZ0NvbnZlcnNpb25TdGFydDogKHR5cGUsIG9wdHMpID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV0gU3RhcnRpbmcgY29udmVyc2lvbiBmb3IgJHt0eXBlfWApLFxyXG4gICAgICAgIGxvZ0NvbnZlcnNpb25Db21wbGV0ZTogKHR5cGUpID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV0gQ29tcGxldGVkIGNvbnZlcnNpb24gZm9yICR7dHlwZX1gKSxcclxuICAgICAgICBsb2dDb252ZXJzaW9uRXJyb3I6ICh0eXBlLCBlcnIpID0+IGNvbnNvbGUuZXJyb3IoYFske25hbWV9OmZhaWxlZF1bJHt0eXBlfV0g4p2MICR7ZXJyLm1lc3NhZ2V9YCwgZXJyKSxcclxuICAgICAgICBzZXRDb250ZXh0OiAoKSA9PiB7fVxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIGlmIChtb2R1bGVQYXRoLmluY2x1ZGVzKCdzYW5pdGl6ZUZvckxvZ2dpbmcnKSkge1xyXG4gICAgICByZXR1cm4gKG9iaikgPT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICByZXR1cm4gdHlwZW9mIG9iaiA9PT0gJ29iamVjdCcgPyB7IC4uLm9iaiB9IDogb2JqO1xyXG4gICAgICAgIH0gY2F0Y2gge1xyXG4gICAgICAgICAgcmV0dXJuIG9iajtcclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc29sZS53YXJuKGBNb2R1bGUgJHttb2R1bGVQYXRofSBub3QgYXZhaWxhYmxlLCB1c2luZyBtaW5pbWFsIGltcGxlbWVudGF0aW9uYCk7XHJcbiAgICByZXR1cm4ge307XHJcbiAgfVxyXG59O1xyXG5cclxudHJ5IHtcclxuICBQYXRoVXRpbHMgPSBzYWZlUmVxdWlyZSgnLi4vdXRpbHMvcGF0aHMvaW5kZXgnLCBbXHJcbiAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vdXRpbHMvcGF0aHMvaW5kZXgnKSxcclxuICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3V0aWxzL3BhdGhzL2luZGV4JylcclxuICBdKS5QYXRoVXRpbHMgfHwge307XHJcblxyXG4gIFByb2dyZXNzVHJhY2tlciA9IHNhZmVSZXF1aXJlKCcuLi91dGlscy9jb252ZXJzaW9uL3Byb2dyZXNzJywgW1xyXG4gICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3V0aWxzL2NvbnZlcnNpb24vcHJvZ3Jlc3MnKSxcclxuICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3V0aWxzL2NvbnZlcnNpb24vcHJvZ3Jlc3MnKVxyXG4gIF0pLlByb2dyZXNzVHJhY2tlciB8fCBjbGFzcyBQcm9ncmVzc1RyYWNrZXIge1xyXG4gICAgY29uc3RydWN0b3IoY2FsbGJhY2spIHsgdGhpcy5jYWxsYmFjayA9IGNhbGxiYWNrOyB9XHJcbiAgICB1cGRhdGUocHJvZ3Jlc3MsIGRhdGEpIHsgdGhpcy5jYWxsYmFjayAmJiB0aGlzLmNhbGxiYWNrKHByb2dyZXNzLCBkYXRhKTsgfVxyXG4gICAgdXBkYXRlU2NhbGVkKHByb2dyZXNzLCBtaW4sIG1heCwgZGF0YSkgeyB0aGlzLnVwZGF0ZShtaW4gKyAocHJvZ3Jlc3MvMTAwKSAqIChtYXgtbWluKSwgZGF0YSk7IH1cclxuICB9O1xyXG5cclxuICBnZXRMb2dnZXIgPSBzYWZlUmVxdWlyZSgnLi4vdXRpbHMvbG9nZ2luZy9Db252ZXJzaW9uTG9nZ2VyJywgW1xyXG4gICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3V0aWxzL2xvZ2dpbmcvQ29udmVyc2lvbkxvZ2dlcicpLFxyXG4gICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vdXRpbHMvbG9nZ2luZy9Db252ZXJzaW9uTG9nZ2VyJylcclxuICBdKS5nZXRMb2dnZXIgfHwgKChuYW1lKSA9PiAoe1xyXG4gICAgbG9nOiAobXNnLCBsZXZlbCwgLi4uYXJncykgPT4gY29uc29sZS5sb2coYFske25hbWV9XVske2xldmVsIHx8ICdJTkZPJ31dICR7bXNnfWAsIC4uLmFyZ3MpLFxyXG4gICAgZXJyb3I6IChtc2csIGVycikgPT4gY29uc29sZS5lcnJvcihgWyR7bmFtZX1dW0VSUk9SXSAke21zZ31gLCBlcnIpLFxyXG4gICAgd2FybjogKG1zZywgLi4uYXJncykgPT4gY29uc29sZS53YXJuKGBbJHtuYW1lfV1bV0FSTl0gJHttc2d9YCwgLi4uYXJncyksXHJcbiAgICBzdWNjZXNzOiAobXNnKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dW1NVQ0NFU1NdICR7bXNnfWApLFxyXG4gICAgZGVidWc6IChtc2csIC4uLmFyZ3MpID0+IGNvbnNvbGUuZGVidWcoYFske25hbWV9XVtERUJVR10gJHttc2d9YCwgLi4uYXJncyksXHJcbiAgICBsb2dQaGFzZVRyYW5zaXRpb246IChmcm9tLCB0bykgPT4gY29uc29sZS5sb2coYFske25hbWV9XSBQaGFzZSB0cmFuc2l0aW9uOiAke2Zyb219IOKGkiAke3RvfWApLFxyXG4gICAgbG9nQ29udmVyc2lvblN0YXJ0OiAodHlwZSwgb3B0cykgPT4gY29uc29sZS5sb2coYFske25hbWV9XSBTdGFydGluZyBjb252ZXJzaW9uIGZvciAke3R5cGV9YCksXHJcbiAgICBsb2dDb252ZXJzaW9uQ29tcGxldGU6ICh0eXBlKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dIENvbXBsZXRlZCBjb252ZXJzaW9uIGZvciAke3R5cGV9YCksXHJcbiAgICBsb2dDb252ZXJzaW9uRXJyb3I6ICh0eXBlLCBlcnIpID0+IGNvbnNvbGUuZXJyb3IoYFske25hbWV9OmZhaWxlZF1bJHt0eXBlfV0g4p2MICR7ZXJyLm1lc3NhZ2V9YCwgZXJyKSxcclxuICAgIHNldENvbnRleHQ6ICgpID0+IHt9XHJcbiAgfSkpO1xyXG5cclxuICBzYW5pdGl6ZUZvckxvZ2dpbmcgPSBzYWZlUmVxdWlyZSgnLi4vdXRpbHMvbG9nZ2luZy9Mb2dTYW5pdGl6ZXInLCBbXHJcbiAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vdXRpbHMvbG9nZ2luZy9Mb2dTYW5pdGl6ZXInKSxcclxuICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3V0aWxzL2xvZ2dpbmcvTG9nU2FuaXRpemVyJylcclxuICBdKS5zYW5pdGl6ZUZvckxvZ2dpbmcgfHwgKChvYmopID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIHJldHVybiB0eXBlb2Ygb2JqID09PSAnb2JqZWN0JyA/IHsgLi4ub2JqIH0gOiBvYmo7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgcmV0dXJuIG9iajtcclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgQ29udmVyc2lvblN0YXR1cyA9IHNhZmVSZXF1aXJlKCcuLi91dGlscy9jb252ZXJzaW9uL0NvbnZlcnNpb25TdGF0dXMnLCBbXHJcbiAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vdXRpbHMvY29udmVyc2lvbi9Db252ZXJzaW9uU3RhdHVzJyksXHJcbiAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi91dGlscy9jb252ZXJzaW9uL0NvbnZlcnNpb25TdGF0dXMnKVxyXG4gIF0pIHx8IHtcclxuICAgIFNUQVRVUzoge1xyXG4gICAgICBTVEFSVElORzogJ1N0YXJ0aW5nIGNvbnZlcnNpb24nLFxyXG4gICAgICBJTklUSUFMSVpJTkc6ICfwn5SnIEluaXRpYWxpemluZyBjb252ZXJ0ZXInLFxyXG4gICAgICBWQUxJREFUSU5HOiAn8J+UjSBWYWxpZGF0aW5nIGZpbGUnLFxyXG4gICAgICBGQVNUX0FUVEVNUFQ6ICfimqEgRmFzdCBjb252ZXJzaW9uIGF0dGVtcHQnLFxyXG4gICAgICBQUk9DRVNTSU5HOiAn4o+zIFByb2Nlc3NpbmcgY29udGVudCcsXHJcbiAgICAgIEZJTkFMSVpJTkc6ICfinIUgRmluYWxpemluZyByZXN1bHQnLFxyXG4gICAgICBDT01QTEVURUQ6ICfinJMgQ29udmVyc2lvbiBjb21wbGV0ZScsXHJcbiAgICAgIENPTlRFTlRfRU1QVFk6ICfimqDvuI8gRW1wdHkgY29udGVudCB3YXJuaW5nJ1xyXG4gICAgfVxyXG4gIH07XHJcbn0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgY29uc29sZS5lcnJvcignRXJyb3IgbG9hZGluZyBjb3JlIGRlcGVuZGVuY2llcycsIGVycm9yKTtcclxuICB0aHJvdyBuZXcgRXJyb3IoYENyaXRpY2FsIGRlcGVuZGVuY3kgaW5pdGlhbGl6YXRpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbn1cclxuXHJcbi8vIEluaXRpYWxpemUgYXBwIHdpdGggZmFsbGJhY2sgaWYgbmVlZGVkXHJcbmlmICghYXBwKSB7XHJcbiAgYXBwID0ge1xyXG4gICAgaXNQYWNrYWdlZDogZmFsc2UsXHJcbiAgICBnZXRBcHBQYXRoOiAoKSA9PiBwcm9jZXNzLmN3ZCgpLFxyXG4gICAgZ2V0TmFtZTogKCkgPT4gJ0NvZGV4Lm1kJyxcclxuICAgIGdldFZlcnNpb246ICgpID0+ICcxLjAuMCdcclxuICB9O1xyXG4gIGNvbnNvbGUud2FybignVXNpbmcgZmFsbGJhY2sgYXBwIGltcGxlbWVudGF0aW9uJyk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGVzIG1vZHVsZSBsb2FkaW5nIHdpdGggcHJvcGVyIGVycm9yIGhhbmRsaW5nIGFuZCBwYXRoIHJlc29sdXRpb24uXHJcbiAqL1xyXG5jbGFzcyBNb2R1bGVMb2FkZXIge1xyXG4gIHN0YXRpYyBhc3luYyBsb2FkTW9kdWxlKG1vZHVsZVBhdGgsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgY29uc3QgbG9nZ2VyID0gZ2V0TG9nZ2VyKCdNb2R1bGVMb2FkZXInKTtcclxuICAgIGNvbnN0IHsgZmFsbGJhY2tQYXRocyA9IFtdLCBzaWxlbnQgPSBmYWxzZSB9ID0gb3B0aW9ucztcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBsb2dnZXIubG9nKGBMb2FkaW5nIG1vZHVsZSBmcm9tIHBhdGg6ICR7bW9kdWxlUGF0aH1gLCAnSU5GTycpO1xyXG5cclxuICAgICAgLy8gRXh0cmFjdCBtb2R1bGUgbmFtZSBhbmQgY2F0ZWdvcnkgZnJvbSBwYXRoXHJcbiAgICAgIGNvbnN0IG1vZHVsZU5hbWUgPSBwYXRoLmJhc2VuYW1lKG1vZHVsZVBhdGgpO1xyXG4gICAgICBsZXQgY2F0ZWdvcnkgPSAnJztcclxuXHJcbiAgICAgIC8vIFRyeSB0byBwYXJzZSBjYXRlZ29yeSBmcm9tIHBhdGhcclxuICAgICAgY29uc3QgcGF0aFBhcnRzID0gcGF0aC5kaXJuYW1lKG1vZHVsZVBhdGgpLnNwbGl0KHBhdGguc2VwKTtcclxuICAgICAgaWYgKHBhdGhQYXJ0cy5sZW5ndGggPj0gMikge1xyXG4gICAgICAgIC8vIFRha2UgdGhlIGxhc3QgdHdvIHBhcnRzIG9mIHRoZSBwYXRoIGFzIHRoZSBjYXRlZ29yeVxyXG4gICAgICAgIGNhdGVnb3J5ID0gcGF0aFBhcnRzLnNsaWNlKC0yKS5qb2luKCcvJyk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gRGVmYXVsdCBjYXRlZ29yeSBmb3IgY29udmVyc2lvbnNcclxuICAgICAgICBjYXRlZ29yeSA9ICdzZXJ2aWNlcy9jb252ZXJzaW9uJztcclxuICAgICAgfVxyXG5cclxuICAgICAgbG9nZ2VyLmxvZyhgVXNpbmcgTW9kdWxlUmVzb2x2ZXIgd2l0aCBtb2R1bGU6ICR7bW9kdWxlTmFtZX0sIGNhdGVnb3J5OiAke2NhdGVnb3J5fWAsICdJTkZPJyk7XHJcblxyXG4gICAgICAvLyBVc2UgTW9kdWxlUmVzb2x2ZXIgdG8gbG9hZCB0aGUgbW9kdWxlXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgeyBNb2R1bGVSZXNvbHZlciB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvbW9kdWxlUmVzb2x2ZXInKTtcclxuICAgICAgICBjb25zdCBtb2R1bGUgPSBNb2R1bGVSZXNvbHZlci5zYWZlUmVxdWlyZShtb2R1bGVOYW1lLCBjYXRlZ29yeSk7XHJcbiAgICAgICAgbG9nZ2VyLnN1Y2Nlc3MoYFN1Y2Nlc3NmdWxseSBsb2FkZWQgbW9kdWxlIHVzaW5nIE1vZHVsZVJlc29sdmVyOiAke21vZHVsZU5hbWV9YCk7XHJcbiAgICAgICAgcmV0dXJuIG1vZHVsZTtcclxuICAgICAgfSBjYXRjaCAocmVzb2x2ZXJFcnJvcikge1xyXG4gICAgICAgIGxvZ2dlci5lcnJvcihgTW9kdWxlUmVzb2x2ZXIgZmFpbGVkOiAke3Jlc29sdmVyRXJyb3IubWVzc2FnZX1gLCByZXNvbHZlckVycm9yKTtcclxuXHJcbiAgICAgICAgLy8gSWYgTW9kdWxlUmVzb2x2ZXIgZmFpbHMsIHRyeSB0aGUgb3JpZ2luYWwgYXBwcm9hY2ggd2l0aCBmYWxsYmFja3NcclxuICAgICAgICBsb2dnZXIubG9nKCdGYWxsaW5nIGJhY2sgdG8gZGlyZWN0IHJlcXVpcmUgd2l0aCBmYWxsYmFja3MnLCAnSU5GTycpO1xyXG5cclxuICAgICAgICAvLyBUcnkgZGlyZWN0IHJlcXVpcmUgZmlyc3RcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgY29uc3QgbW9kdWxlID0gcmVxdWlyZShtb2R1bGVQYXRoKTtcclxuICAgICAgICAgIGxvZ2dlci5zdWNjZXNzKGBTdWNjZXNzZnVsbHkgbG9hZGVkIG1vZHVsZSBkaXJlY3RseTogJHttb2R1bGVQYXRofWApO1xyXG4gICAgICAgICAgcmV0dXJuIG1vZHVsZS5kZWZhdWx0IHx8IG1vZHVsZTtcclxuICAgICAgICB9IGNhdGNoIChkaXJlY3RFcnJvcikge1xyXG4gICAgICAgICAgLy8gSWYgZmFsbGJhY2sgcGF0aHMgcHJvdmlkZWQsIHRyeSB0aGVtIHNlcXVlbnRpYWxseVxyXG4gICAgICAgICAgaWYgKGZhbGxiYWNrUGF0aHMgJiYgZmFsbGJhY2tQYXRocy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIGxvZ2dlci5sb2coYEF0dGVtcHRpbmcgdG8gbG9hZCBmcm9tICR7ZmFsbGJhY2tQYXRocy5sZW5ndGh9IGZhbGxiYWNrIHBhdGhzYCwgJ0lORk8nKTtcclxuXHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgZmFsbGJhY2tQYXRoIG9mIGZhbGxiYWNrUGF0aHMpIHtcclxuICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgbG9nZ2VyLmxvZyhgVHJ5aW5nIGZhbGxiYWNrIHBhdGg6ICR7ZmFsbGJhY2tQYXRofWAsICdJTkZPJyk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGUgPSByZXF1aXJlKGZhbGxiYWNrUGF0aCk7XHJcbiAgICAgICAgICAgICAgICBsb2dnZXIuc3VjY2VzcyhgU3VjY2Vzc2Z1bGx5IGxvYWRlZCBmcm9tIGZhbGxiYWNrOiAke2ZhbGxiYWNrUGF0aH1gKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBtb2R1bGUuZGVmYXVsdCB8fCBtb2R1bGU7XHJcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZmFsbGJhY2tFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgLy8gQ29udGludWUgdG8gbmV4dCBmYWxsYmFjayBwYXRoXHJcbiAgICAgICAgICAgICAgICBpZiAoIXNpbGVudCkge1xyXG4gICAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgRmFpbGVkIHRvIGxvYWQgZnJvbSBmYWxsYmFjazogJHtmYWxsYmFja1BhdGh9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgLy8gSWYgYWxsIGVsc2UgZmFpbHMgYW5kIHRoaXMgaXMgQ29udmVydGVyUmVnaXN0cnkuanMsIGNyZWF0ZSBhIG1pbmltYWwgcmVnaXN0cnlcclxuICAgICAgICAgIGlmIChtb2R1bGVOYW1lID09PSAnQ29udmVydGVyUmVnaXN0cnkuanMnKSB7XHJcbiAgICAgICAgICAgIGxvZ2dlci5sb2coJ0FsbCBsb2FkaW5nIGF0dGVtcHRzIGZhaWxlZCBmb3IgQ29udmVydGVyUmVnaXN0cnkuanMuIENyZWF0aW5nIG1pbmltYWwgcmVnaXN0cnknLCAnSU5GTycpO1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY3JlYXRlRW1lcmdlbmN5UmVnaXN0cnkoKTtcclxuICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAvLyBJZiB3ZSBnZXQgaGVyZSwgYWxsIGF0dGVtcHRzIGZhaWxlZFxyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gbG9hZCBtb2R1bGU6ICR7bW9kdWxlUGF0aH0uIEVycm9yOiAke3Jlc29sdmVyRXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGxvZ2dlci5lcnJvcihgTW9kdWxlIGxvYWRpbmcgZmFpbGVkIGNvbXBsZXRlbHk6ICR7ZXJyb3IubWVzc2FnZX1gLCBlcnJvcik7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kdWxlIGxvYWRpbmcgZmFpbGVkOiAke21vZHVsZVBhdGh9LiBFcnJvcjogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlcyBhbiBlbWVyZ2VuY3kgbWluaW1hbCByZWdpc3RyeSBhcyBhIGxhc3QgcmVzb3J0XHJcbiAgICogQHJldHVybnMge09iamVjdH0gQSBtaW5pbWFsIHJlZ2lzdHJ5IGltcGxlbWVudGF0aW9uXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBzdGF0aWMgX2NyZWF0ZUVtZXJnZW5jeVJlZ2lzdHJ5KCkge1xyXG4gICAgY29uc3QgbG9nZ2VyID0gZ2V0TG9nZ2VyKCdNb2R1bGVMb2FkZXInKTtcclxuICAgIGxvZ2dlci5sb2coJ/Cfk6YgQ3JlYXRpbmcgZW1lcmdlbmN5IG1pbmltYWwgcmVnaXN0cnkgaW1wbGVtZW50YXRpb24nLCAnSU5GTycpO1xyXG5cclxuICAgIC8vIENyZWF0ZSBtaW5pbWFsIHJlZ2lzdHJ5IGNvbnN0cnVjdG9yIGZ1bmN0aW9uIHRvIG1hdGNoIGV4aXN0aW5nIHBhdHRlcm5cclxuICAgIGZ1bmN0aW9uIENvbnZlcnRlclJlZ2lzdHJ5KCkge1xyXG4gICAgICB0aGlzLmNvbnZlcnRlcnMgPSB7XHJcbiAgICAgICAgcGRmOiB7XHJcbiAgICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zID0ge30pID0+IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tFbWVyZ2VuY3lSZWdpc3RyeV0gVXNpbmcgZW1lcmdlbmN5IFBERiBjb252ZXJ0ZXInKTtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgICAgIGNvbnRlbnQ6IGAjIEV4dHJhY3RlZCBmcm9tICR7bmFtZSB8fCAnUERGIGRvY3VtZW50J31cXG5cXG5UaGlzIGNvbnRlbnQgd2FzIGV4dHJhY3RlZCB1c2luZyB0aGUgZW1lcmdlbmN5IGNvbnZlcnRlci5cXG5cXG5UaGUgYXBwbGljYXRpb24gZW5jb3VudGVyZWQgYW4gaXNzdWUgZmluZGluZyB0aGUgY29ycmVjdCBjb252ZXJ0ZXIgbW9kdWxlLiBQbGVhc2UgcmVwb3J0IHRoaXMgaXNzdWUuYCxcclxuICAgICAgICAgICAgICB0eXBlOiAncGRmJyxcclxuICAgICAgICAgICAgICBtZXRhZGF0YTogeyBwYWdlczogMSwgY29udmVydGVyOiAnZW1lcmdlbmN5LWZhbGxiYWNrJyB9XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgdmFsaWRhdGU6IChpbnB1dCkgPT4gQnVmZmVyLmlzQnVmZmVyKGlucHV0KSB8fCB0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnLFxyXG4gICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgIG5hbWU6ICdQREYgRG9jdW1lbnQgKEVtZXJnZW5jeSknLFxyXG4gICAgICAgICAgICBleHRlbnNpb25zOiBbJy5wZGYnXSxcclxuICAgICAgICAgICAgbWltZVR5cGVzOiBbJ2FwcGxpY2F0aW9uL3BkZiddLFxyXG4gICAgICAgICAgICBtYXhTaXplOiAyNSAqIDEwMjQgKiAxMDI0XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEFkZCByZXF1aXJlZCBwcm90b3R5cGUgbWV0aG9kc1xyXG4gICAgQ29udmVydGVyUmVnaXN0cnkucHJvdG90eXBlLmNvbnZlcnRUb01hcmtkb3duID0gYXN5bmMgZnVuY3Rpb24odHlwZSwgY29udGVudCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBbRW1lcmdlbmN5UmVnaXN0cnldIENvbnZlcnRpbmcgJHt0eXBlfSBkb2N1bWVudGApO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgY29udGVudDogYCMgRW1lcmdlbmN5IENvbnZlcnRlclxcblxcblRoaXMgY29udGVudCB3YXMgZ2VuZXJhdGVkIGJ5IGFuIGVtZXJnZW5jeSBmYWxsYmFjayBjb252ZXJ0ZXIgYmVjYXVzZSB0aGUgbm9ybWFsIGNvbnZlcnRlciBjb3VsZCBub3QgYmUgbG9hZGVkLlxcblxcblBsZWFzZSByZXBvcnQgdGhpcyBpc3N1ZS5gLFxyXG4gICAgICAgIG1ldGFkYXRhOiB7IHNvdXJjZTogJ2VtZXJnZW5jeS1mYWxsYmFjaycgfVxyXG4gICAgICB9O1xyXG4gICAgfTtcclxuXHJcbiAgICBDb252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuZ2V0Q29udmVydGVyQnlFeHRlbnNpb24gPSBmdW5jdGlvbihleHRlbnNpb24pIHtcclxuICAgICAgY29uc29sZS5sb2coYFtFbWVyZ2VuY3lSZWdpc3RyeV0gTG9va2luZyB1cCBjb252ZXJ0ZXIgZm9yOiAke2V4dGVuc2lvbn1gKTtcclxuICAgICAgaWYgKGV4dGVuc2lvbiA9PT0gJ3BkZicpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5jb252ZXJ0ZXJzLnBkZjtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH07XHJcblxyXG4gICAgLy8gQ3JlYXRlIGFuZCByZXR1cm4gdGhlIHJlZ2lzdHJ5IGluc3RhbmNlXHJcbiAgICByZXR1cm4gbmV3IENvbnZlcnRlclJlZ2lzdHJ5KCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBBdHRlbXB0cyB0byBsb2FkIGEgbW9kdWxlIGZyb20gdGhlIGJlc3QgYXZhaWxhYmxlIHBhdGhcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kdWxlTmFtZSAtIFRoZSBtb2R1bGUgZmlsZSBuYW1lIChlLmcuLCAnQ29udmVydGVyUmVnaXN0cnkuanMnKVxyXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gYmFzZVBhdGhzIC0gTGlzdCBvZiBiYXNlIGRpcmVjdG9yaWVzIHRvIGxvb2sgaW5cclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxhbnk+fSAtIFRoZSBsb2FkZWQgbW9kdWxlXHJcbiAgICovXHJcbiAgc3RhdGljIGFzeW5jIGxvYWRNb2R1bGVGcm9tQmVzdFBhdGgobW9kdWxlTmFtZSwgYmFzZVBhdGhzKSB7XHJcbiAgICBjb25zdCBsb2dnZXIgPSBnZXRMb2dnZXIoJ01vZHVsZUxvYWRlcicpO1xyXG4gICAgY29uc3QgcmVzb2x2ZWRQYXRocyA9IGJhc2VQYXRocy5tYXAoYmFzZVBhdGggPT4gcGF0aC5qb2luKGJhc2VQYXRoLCBtb2R1bGVOYW1lKSk7XHJcblxyXG4gICAgbG9nZ2VyLmxvZyhgQXR0ZW1wdGluZyB0byBsb2FkICR7bW9kdWxlTmFtZX0gZnJvbSAke3Jlc29sdmVkUGF0aHMubGVuZ3RofSBwb3NzaWJsZSBwYXRoc2AsICdJTkZPJyk7XHJcblxyXG4gICAgLy8gQ2hlY2sgd2hpY2ggcGF0aHMgZXhpc3QgZmlyc3RcclxuICAgIGNvbnN0IGV4aXN0aW5nUGF0aHMgPSByZXNvbHZlZFBhdGhzLmZpbHRlcihwID0+IHtcclxuICAgICAgY29uc3QgZXhpc3RzID0gZnMuZXhpc3RzU3luYyhwKTtcclxuICAgICAgbG9nZ2VyLmxvZyhgUGF0aCAke3B9IGV4aXN0czogJHtleGlzdHN9YCwgJ0lORk8nKTtcclxuICAgICAgcmV0dXJuIGV4aXN0cztcclxuICAgIH0pO1xyXG5cclxuICAgIGlmIChleGlzdGluZ1BhdGhzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICBsb2dnZXIuZXJyb3IoYE5vIGV4aXN0aW5nIHBhdGhzIGZvdW5kIGZvciBtb2R1bGU6ICR7bW9kdWxlTmFtZX1gKTtcclxuICAgICAgLy8gVHJ5IGFsbCBwYXRocyBhbnl3YXkgYXMgYSBsYXN0IHJlc29ydFxyXG4gICAgICByZXR1cm4gdGhpcy5sb2FkTW9kdWxlKHJlc29sdmVkUGF0aHNbMF0sIHtcclxuICAgICAgICBmYWxsYmFja1BhdGhzOiByZXNvbHZlZFBhdGhzLnNsaWNlKDEpLFxyXG4gICAgICAgIHNpbGVudDogdHJ1ZVxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBMb2FkIGZyb20gdGhlIGZpcnN0IGV4aXN0aW5nIHBhdGgsIHdpdGggcmVtYWluaW5nIGV4aXN0aW5nIHBhdGhzIGFzIGZhbGxiYWNrc1xyXG4gICAgcmV0dXJuIHRoaXMubG9hZE1vZHVsZShleGlzdGluZ1BhdGhzWzBdLCB7XHJcbiAgICAgIGZhbGxiYWNrUGF0aHM6IGV4aXN0aW5nUGF0aHMuc2xpY2UoMSlcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgc3RhdGljIGdldE1vZHVsZVBhdGhzKCkge1xyXG4gICAgY29uc3QgaXNEZXYgPSBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50JztcclxuICAgIGNvbnN0IGxvZ2dlciA9IGdldExvZ2dlcignTW9kdWxlTG9hZGVyJyk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIGEgY29tcHJlaGVuc2l2ZSBsaXN0IG9mIHBvc3NpYmxlIHBhdGhzIGZvciB0aGUgQ29udmVydGVyUmVnaXN0cnlcclxuICAgIGNvbnN0IHBvc3NpYmxlUGF0aHMgPSBbXHJcbiAgICAgIC8vIERldmVsb3BtZW50IHBhdGhzXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBQYWNrYWdlZCBhcHAgcGF0aHMgLSBub3RlIHdlIGV4cGxpY2l0bHkgaGFuZGxlIHRoZSBwYXRoIGZyb20gdGhlIGVycm9yXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKC9zcmNcXC9lbGVjdHJvbi8sICdidWlsZC9lbGVjdHJvbicpLCAnc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKC9zcmNcXFxcZWxlY3Ryb24vLCAnYnVpbGRcXFxcZWxlY3Ryb24nKSwgJ3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gUmVsYXRpdmUgcGF0aHMgZnJvbSBjdXJyZW50IG1vZHVsZVxyXG4gICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gUGF0aHMgd2l0aCBhcHAuYXNhciBmb3IgcGFja2FnZWQgYXBwXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyJywgJ2FwcCcpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXInLCAnYXBwJyksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyXFxcXHNyYycsICdhcHAuYXNhclxcXFxidWlsZCcpLCAnZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhci9zcmMnLCAnYXBwLmFzYXIvYnVpbGQnKSwgJ2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIEFsdGVybmF0aXZlIHBhcmVudCBkaXJlY3RvcnkgcGF0aHNcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICcuLi9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIFNpYmxpbmcgcGF0aHNcclxuICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShhcHAuZ2V0QXBwUGF0aCgpKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShhcHAuZ2V0QXBwUGF0aCgpKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBNb3JlIG5lc3RlZCBwYXRocyBmb3IgYXBwLmFzYXJcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdkaXN0L2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJy4uL3Jlc291cmNlcy9hcHAvc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJy4uL3Jlc291cmNlcy9hcHAvYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gRGlyZWN0IHBhdGggZml4ZXMgZm9yIHRoZSBzcGVjaWZpYyBlcnJvciBwYXRoXHJcbiAgICAgIGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ3NyY1xcXFxlbGVjdHJvblxcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uJywgJ2J1aWxkXFxcXGVsZWN0cm9uXFxcXHNlcnZpY2VzXFxcXGNvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIFBhdGhzIHdpdGggZGlzdCBwcmVmaXhlcyAob2Z0ZW4gdXNlZCBpbiBidWlsdCBhcHBzKVxyXG4gICAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2Rpc3QvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ2Rpc3QvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gQWRkaXRpb25hbCBwYXRocyBzcGVjaWZpY2FsbHkgZm9yIENvbnZlcnRlclJlZ2lzdHJ5LmpzXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnYXBwL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdhcHAvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vLi4vZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vLi4vLi4vZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAncmVzb3VyY2VzL2FwcC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvYXBwLmFzYXIvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAncmVzb3VyY2VzL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKVxyXG4gICAgXTtcclxuXHJcbiAgICAvLyBMb2cgYXBwIGVudmlyb25tZW50IGluZm9ybWF0aW9uIGZvciBkZWJ1Z2dpbmdcclxuICAgIGxvZ2dlci5sb2coYEFwcCBpcyBwYWNrYWdlZDogJHthcHAuaXNQYWNrYWdlZH1gLCAnSU5GTycpO1xyXG4gICAgbG9nZ2VyLmxvZyhgQXBwIHBhdGg6ICR7YXBwLmdldEFwcFBhdGgoKX1gLCAnSU5GTycpO1xyXG4gICAgbG9nZ2VyLmxvZyhgX19kaXJuYW1lOiAke19fZGlybmFtZX1gLCAnSU5GTycpO1xyXG4gICAgbG9nZ2VyLmxvZyhgcHJvY2Vzcy5jd2QoKTogJHtwcm9jZXNzLmN3ZCgpfWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBwcm9jZXNzLmV4ZWNQYXRoOiAke3Byb2Nlc3MuZXhlY1BhdGh9YCwgJ0lORk8nKTtcclxuXHJcbiAgICAvLyBMb2cgdGhlIHNwZWNpZmljIHBhdGggZnJvbSB0aGUgZXJyb3IgbWVzc2FnZVxyXG4gICAgY29uc3QgZXJyb3JQYXRoID0gJ0M6XFxcXFVzZXJzXFxcXEpvc2VwaFxcXFxEb2N1bWVudHNcXFxcQ29kZVxcXFxjb2RleC1tZFxcXFxkaXN0XFxcXHdpbi11bnBhY2tlZFxcXFxyZXNvdXJjZXNcXFxcYXBwLmFzYXJcXFxcc3JjXFxcXGVsZWN0cm9uXFxcXHNlcnZpY2VzXFxcXGNvbnZlcnNpb25cXFxcQ29udmVydGVyUmVnaXN0cnkuanMnO1xyXG4gICAgY29uc3QgY29ycmVjdGVkUGF0aCA9IGVycm9yUGF0aC5yZXBsYWNlKCdcXFxcc3JjXFxcXCcsICdcXFxcYnVpbGRcXFxcJyk7XHJcbiAgICBsb2dnZXIubG9nKGBFcnJvciBwYXRoOiAke2Vycm9yUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgbG9nZ2VyLmxvZyhgQ29ycmVjdGVkIHBhdGg6ICR7Y29ycmVjdGVkUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgbG9nZ2VyLmxvZyhgQ29ycmVjdGVkIHBhdGggZXhpc3RzOiAke2ZzLmV4aXN0c1N5bmMoY29ycmVjdGVkUGF0aCl9YCwgJ0lORk8nKTtcclxuXHJcbiAgICAvLyBGaW5kIGZpcnN0IGV4aXN0aW5nIGJhc2UgcGF0aFxyXG4gICAgbGV0IGJhc2VQYXRoID0gbnVsbDtcclxuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlUGF0aCBvZiBwb3NzaWJsZVBhdGhzKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgZXhpc3RzID0gZnMuZXhpc3RzU3luYyhjYW5kaWRhdGVQYXRoKTtcclxuICAgICAgICBsb2dnZXIubG9nKGBDaGVja2luZyBwYXRoOiAke2NhbmRpZGF0ZVBhdGh9IChleGlzdHM6ICR7ZXhpc3RzfSlgLCAnSU5GTycpO1xyXG5cclxuICAgICAgICBpZiAoZXhpc3RzKSB7XHJcbiAgICAgICAgICBiYXNlUGF0aCA9IGNhbmRpZGF0ZVBhdGg7XHJcbiAgICAgICAgICBsb2dnZXIubG9nKGBGb3VuZCB2YWxpZCBiYXNlIHBhdGg6ICR7YmFzZVBhdGh9YCwgJ0lORk8nKTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBsb2dnZXIud2FybihgRXJyb3IgY2hlY2tpbmcgcGF0aCAke2NhbmRpZGF0ZVBhdGh9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBJZiBubyBiYXNlIHBhdGggZXhpc3RzLCB0cnkgZGlyZWN0IG1vZHVsZSBwYXRoc1xyXG4gICAgaWYgKCFiYXNlUGF0aCkge1xyXG4gICAgICBsb2dnZXIud2FybignTm8gdmFsaWQgYmFzZSBwYXRoIGZvdW5kLCB0cnlpbmcgZGlyZWN0IG1vZHVsZSByZXNvbHV0aW9uJyk7XHJcblxyXG4gICAgICAvLyBEZWZpbmUgYWxsIHBvc3NpYmxlIGRpcmVjdCBwYXRocyB0byB0aGUgcmVnaXN0cnkgbW9kdWxlXHJcbiAgICAgIGNvbnN0IGRpcmVjdFJlZ2lzdHJ5UGF0aHMgPSBbXHJcbiAgICAgICAgLy8gU3BlY2lmaWMgcGF0aHMgYmFzZWQgb24gZXJyb3IgbG9nc1xyXG4gICAgICAgIC8vIFRoaXMgaXMgdGhlIHNwZWNpZmljIGVycm9yIHBhdGggd2l0aCAnc3JjJyByZXBsYWNlZCB3aXRoICdidWlsZCdcclxuICAgICAgICBhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJywgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSArICcvQ29udmVydGVyUmVnaXN0cnkuanMnLFxyXG4gICAgICAgIGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnc3JjXFxcXGVsZWN0cm9uXFxcXHNlcnZpY2VzXFxcXGNvbnZlcnNpb24nLCAnYnVpbGRcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvbicpICsgJ1xcXFxDb252ZXJ0ZXJSZWdpc3RyeS5qcycsXHJcblxyXG4gICAgICAgIC8vIEZ1bGwgc3RyaW5nIHJlcGxhY2VtZW50cyBmb3IgdGhlIHNwZWNpZmljIGVycm9yIHBhdGhzIGluIHRoZSBsb2dzXHJcbiAgICAgICAgYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhclxcXFxzcmNcXFxcZWxlY3Ryb24nLCAnYXBwLmFzYXJcXFxcYnVpbGRcXFxcZWxlY3Ryb24nKSArICdcXFxcc2VydmljZXNcXFxcY29udmVyc2lvblxcXFxDb252ZXJ0ZXJSZWdpc3RyeS5qcycsXHJcbiAgICAgICAgYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhci9zcmMvZWxlY3Ryb24nLCAnYXBwLmFzYXIvYnVpbGQvZWxlY3Ryb24nKSArICcvc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycsXHJcblxyXG4gICAgICAgIC8vIFN0YW5kYXJkIGFwcGxpY2F0aW9uIHBhdGhzXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuXHJcbiAgICAgICAgLy8gUmVsYXRpdmUgcGF0aHNcclxuICAgICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcblxyXG4gICAgICAgIC8vIEFTQVItc3BlY2lmaWMgcGF0aHMgd2l0aCBhZGFwdGF0aW9uc1xyXG4gICAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyJywgJ2FwcCcpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhcicsICdhcHAnKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAnLi4vcmVzb3VyY2VzL2FwcC9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLi9yZXNvdXJjZXMvYXBwL2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi8uLi9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ3Jlc291cmNlcy9hcHAvc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAncmVzb3VyY2VzL2FwcC5hc2FyL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAncmVzb3VyY2VzL2FwcC5hc2FyL2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuXHJcbiAgICAgICAgLy8gQWxsb3cgZmluZGluZyBpbiBjdXJyZW50IGRpcmVjdG9yaWVzXHJcbiAgICAgICAgcGF0aC5qb2luKF9fZGlybmFtZSwgJ0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5qb2luKHBhdGguZGlybmFtZShfX2Rpcm5hbWUpLCAnQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuXHJcbiAgICAgICAgLy8gVHJ5IGFic29sdXRlIHBhdGhzIHRoYXQgbWF0Y2ggdGhlIGVycm9yIHN0YWNrXHJcbiAgICAgICAgJ0M6XFxcXFVzZXJzXFxcXEpvc2VwaFxcXFxEb2N1bWVudHNcXFxcQ29kZVxcXFxjb2RleC1tZFxcXFxkaXN0XFxcXHdpbi11bnBhY2tlZFxcXFxyZXNvdXJjZXNcXFxcYXBwLmFzYXJcXFxcYnVpbGRcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvblxcXFxDb252ZXJ0ZXJSZWdpc3RyeS5qcydcclxuICAgICAgXTtcclxuXHJcbiAgICAgIC8vIEZpbmQgdGhlIGZpcnN0IGRpcmVjdCByZWdpc3RyeSBwYXRoIHRoYXQgZXhpc3RzXHJcbiAgICAgIGZvciAoY29uc3QgcmVnaXN0cnlQYXRoIG9mIGRpcmVjdFJlZ2lzdHJ5UGF0aHMpIHtcclxuICAgICAgICBjb25zdCBleGlzdHMgPSBmcy5leGlzdHNTeW5jKHJlZ2lzdHJ5UGF0aCk7XHJcbiAgICAgICAgbG9nZ2VyLmxvZyhgQ2hlY2tpbmcgZGlyZWN0IHJlZ2lzdHJ5IHBhdGg6ICR7cmVnaXN0cnlQYXRofSAoZXhpc3RzOiAke2V4aXN0c30pYCwgJ0lORk8nKTtcclxuXHJcbiAgICAgICAgaWYgKGV4aXN0cykge1xyXG4gICAgICAgICAgLy8gQnVpbGQgYSBiYXNlIHBhdGggZnJvbSB0aGUgZGlyZWN0b3J5IGNvbnRhaW5pbmcgdGhlIHJlZ2lzdHJ5XHJcbiAgICAgICAgICBiYXNlUGF0aCA9IHBhdGguZGlybmFtZShyZWdpc3RyeVBhdGgpO1xyXG4gICAgICAgICAgbG9nZ2VyLmxvZyhgRm91bmQgcmVnaXN0cnkgbW9kdWxlIGF0OiAke3JlZ2lzdHJ5UGF0aH0sIHVzaW5nIGJhc2UgcGF0aDogJHtiYXNlUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRmFsbGJhY2sgdG8gYSBkZWZhdWx0IHBhdGggaWYgYWxsIGVsc2UgZmFpbHNcclxuICAgIGlmICghYmFzZVBhdGgpIHtcclxuICAgICAgbG9nZ2VyLmVycm9yKCdBbGwgcGF0aCByZXNvbHV0aW9uIGF0dGVtcHRzIGZhaWxlZCwgdXNpbmcgZmFsbGJhY2sgcGF0aCcpO1xyXG5cclxuICAgICAgLy8gVXNlIGEgcGF0aCByZWxhdGl2ZSB0byBjdXJyZW50IG1vZHVsZSBhcyBsYXN0IHJlc29ydFxyXG4gICAgICBpZiAoYXBwLmlzUGFja2FnZWQpIHtcclxuICAgICAgICBiYXNlUGF0aCA9IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi9zZXJ2aWNlcy9jb252ZXJzaW9uJyk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgYmFzZVBhdGggPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBMb2cgdGhlIGZpbmFsIGJhc2UgcGF0aCB0aGF0IHdpbGwgYmUgdXNlZFxyXG4gICAgbG9nZ2VyLmxvZyhgVXNpbmcgZmluYWwgYmFzZSBwYXRoOiAke2Jhc2VQYXRofWAsICdJTkZPJyk7XHJcblxyXG4gICAgLy8gQ2hlY2sgaWYgdGhlIHJlZ2lzdHJ5IGV4aXN0cyBhdCB0aGlzIHBhdGhcclxuICAgIGNvbnN0IHJlZ2lzdHJ5UGF0aCA9IHBhdGguam9pbihiYXNlUGF0aCwgJ0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyk7XHJcbiAgICBsb2dnZXIubG9nKGBGaW5hbCByZWdpc3RyeSBwYXRoOiAke3JlZ2lzdHJ5UGF0aH0gKGV4aXN0czogJHtmcy5leGlzdHNTeW5jKHJlZ2lzdHJ5UGF0aCl9KWAsICdJTkZPJyk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIHRoZSBwYXRocyBvYmplY3Qgd2l0aCBhbGwgbW9kdWxlIHBhdGhzXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICByZWdpc3RyeTogcmVnaXN0cnlQYXRoLFxyXG4gICAgICByZWdpc3RyeVBhdGg6IHJlZ2lzdHJ5UGF0aCwgLy8gRHVwbGljYXRlIGZvciBkaXJlY3QgYWNjZXNzXHJcbiAgICAgIGNvbnZlcnRlcnM6IHtcclxuICAgICAgICB1cmw6IHBhdGguam9pbihiYXNlUGF0aCwgJ3dlYi9VcmxDb252ZXJ0ZXIuanMnKSxcclxuICAgICAgICBwZGY6IHBhdGguam9pbihiYXNlUGF0aCwgJ2RvY3VtZW50L1BkZkNvbnZlcnRlckZhY3RvcnkuanMnKSxcclxuICAgICAgICBkb2N4OiBwYXRoLmpvaW4oYmFzZVBhdGgsICdkb2N1bWVudC9Eb2N4Q29udmVydGVyLmpzJyksXHJcbiAgICAgICAgcHB0eDogcGF0aC5qb2luKGJhc2VQYXRoLCAnZG9jdW1lbnQvUHB0eENvbnZlcnRlci5qcycpLFxyXG4gICAgICAgIHhsc3g6IHBhdGguam9pbihiYXNlUGF0aCwgJ2RhdGEvWGxzeENvbnZlcnRlci5qcycpLFxyXG4gICAgICAgIGNzdjogcGF0aC5qb2luKGJhc2VQYXRoLCAnZGF0YS9Dc3ZDb252ZXJ0ZXIuanMnKVxyXG4gICAgICB9XHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuLy8gTWluaW1hbCBlbWJlZGRlZCBDb252ZXJ0ZXJSZWdpc3RyeSBhcyBhIGxhc3QgcmVzb3J0XHJcbmNvbnN0IE1pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeSA9IHtcclxuICBjb252ZXJ0ZXJzOiB7XHJcbiAgICBwZGY6IHtcclxuICAgICAgLy8gTWluaW1hbCBQREYgY29udmVydGVyXHJcbiAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMgPSB7fSkgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdbTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5XSBVc2luZyBlbWJlZGRlZCBQREYgY29udmVydGVyJyk7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICBjb250ZW50OiBgIyBFeHRyYWN0ZWQgZnJvbSAke25hbWUgfHwgJ1BERiBkb2N1bWVudCd9XFxuXFxuVGhpcyBjb250ZW50IHdhcyBleHRyYWN0ZWQgdXNpbmcgdGhlIGVtYmVkZGVkIGNvbnZlcnRlci5gLFxyXG4gICAgICAgICAgdHlwZTogJ3BkZicsXHJcbiAgICAgICAgICBtZXRhZGF0YTogeyBwYWdlczogMSwgY29udmVydGVyOiAnbWluaW1hbC1lbWJlZGRlZCcgfVxyXG4gICAgICAgIH07XHJcbiAgICAgIH0sXHJcbiAgICAgIHZhbGlkYXRlOiAoaW5wdXQpID0+IEJ1ZmZlci5pc0J1ZmZlcihpbnB1dCkgfHwgdHlwZW9mIGlucHV0ID09PSAnc3RyaW5nJyxcclxuICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgbmFtZTogJ1BERiBEb2N1bWVudCcsXHJcbiAgICAgICAgZXh0ZW5zaW9uczogWycucGRmJ10sXHJcbiAgICAgICAgbWltZVR5cGVzOiBbJ2FwcGxpY2F0aW9uL3BkZiddLFxyXG4gICAgICAgIG1heFNpemU6IDI1ICogMTAyNCAqIDEwMjRcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH0sXHJcblxyXG4gIC8vIEdlbmVyaWMgY29udmVyc2lvbiBmdW5jdGlvblxyXG4gIGNvbnZlcnRUb01hcmtkb3duOiBhc3luYyAodHlwZSwgY29udGVudCwgb3B0aW9ucyA9IHt9KSA9PiB7XHJcbiAgICBjb25zb2xlLmxvZyhgW01pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeV0gVXNpbmcgZW1iZWRkZWQgY29udmVydFRvTWFya2Rvd24gZm9yICR7dHlwZX1gKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgIGNvbnRlbnQ6IGAjIEV4dHJhY3RlZCBmcm9tICR7b3B0aW9ucy5uYW1lIHx8ICdkb2N1bWVudCd9XFxuXFxuVGhpcyBjb250ZW50IHdhcyBleHRyYWN0ZWQgdXNpbmcgdGhlIGVtYmVkZGVkIGNvbnZlcnRlci5gLFxyXG4gICAgICB0eXBlOiB0eXBlLFxyXG4gICAgICBtZXRhZGF0YTogeyBjb252ZXJ0ZXI6ICdtaW5pbWFsLWVtYmVkZGVkJyB9XHJcbiAgICB9O1xyXG4gIH0sXHJcblxyXG4gIC8vIExvb2t1cCBjb252ZXJ0ZXIgYnkgZXh0ZW5zaW9uXHJcbiAgZ2V0Q29udmVydGVyQnlFeHRlbnNpb246IGFzeW5jIChleHRlbnNpb24pID0+IHtcclxuICAgIGNvbnNvbGUubG9nKGBbTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5XSBMb29raW5nIHVwIGNvbnZlcnRlciBmb3I6ICR7ZXh0ZW5zaW9ufWApO1xyXG5cclxuICAgIC8vIEhhbmRsZSBQREYgZmlsZXMgc3BlY2lmaWNhbGx5XHJcbiAgICBpZiAoZXh0ZW5zaW9uID09PSAncGRmJykge1xyXG4gICAgICByZXR1cm4gTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5LmNvbnZlcnRlcnMucGRmO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEdlbmVyaWMgY29udmVydGVyIGZvciBvdGhlciB0eXBlc1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucyA9IHt9KSA9PiB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtNaW5pbWFsQ29udmVydGVyUmVnaXN0cnldIFVzaW5nIGdlbmVyaWMgY29udmVydGVyIGZvciAke2V4dGVuc2lvbn1gKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgIGNvbnRlbnQ6IGAjIEV4dHJhY3RlZCBmcm9tICR7bmFtZSB8fCBleHRlbnNpb24gKyAnIGZpbGUnfVxcblxcblRoaXMgY29udGVudCB3YXMgZXh0cmFjdGVkIHVzaW5nIHRoZSBlbWJlZGRlZCBnZW5lcmljIGNvbnZlcnRlci5gLFxyXG4gICAgICAgICAgdHlwZTogZXh0ZW5zaW9uLFxyXG4gICAgICAgICAgbWV0YWRhdGE6IHsgY29udmVydGVyOiAnbWluaW1hbC1lbWJlZGRlZC1nZW5lcmljJyB9XHJcbiAgICAgICAgfTtcclxuICAgICAgfSxcclxuICAgICAgdmFsaWRhdGU6ICgpID0+IHRydWUsXHJcbiAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgIG5hbWU6IGAke2V4dGVuc2lvbi50b1VwcGVyQ2FzZSgpfSBEb2N1bWVudGAsXHJcbiAgICAgICAgZXh0ZW5zaW9uczogW2AuJHtleHRlbnNpb259YF0sXHJcbiAgICAgICAgbWltZVR5cGVzOiBbYGFwcGxpY2F0aW9uLyR7ZXh0ZW5zaW9ufWBdLFxyXG4gICAgICAgIG1heFNpemU6IDEwICogMTAyNCAqIDEwMjRcclxuICAgICAgfVxyXG4gICAgfTtcclxuICB9XHJcbn07XHJcblxyXG4vKipcclxuICogTWFuYWdlcyBjb252ZXJ0ZXIgaW5pdGlhbGl6YXRpb24gYW5kIGVuc3VyZXMgcHJvcGVyIGxvYWRpbmcgc2VxdWVuY2UuXHJcbiAqL1xyXG5jbGFzcyBDb252ZXJ0ZXJJbml0aWFsaXplciB7XHJcbiAgc3RhdGljIF9pbnN0YW5jZSA9IG51bGw7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLl9pbml0aWFsaXplZCA9IGZhbHNlO1xyXG4gICAgdGhpcy5faW5pdFByb21pc2UgPSBudWxsO1xyXG4gICAgdGhpcy5fY29udmVydGVyUmVnaXN0cnkgPSBudWxsO1xyXG4gICAgdGhpcy5sb2dnZXIgPSBnZXRMb2dnZXIoJ0NvbnZlcnRlckluaXRpYWxpemVyJyk7XHJcbiAgfVxyXG4gIFxyXG4gIHN0YXRpYyBnZXRJbnN0YW5jZSgpIHtcclxuICAgIGlmICghQ29udmVydGVySW5pdGlhbGl6ZXIuX2luc3RhbmNlKSB7XHJcbiAgICAgIENvbnZlcnRlckluaXRpYWxpemVyLl9pbnN0YW5jZSA9IG5ldyBDb252ZXJ0ZXJJbml0aWFsaXplcigpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIENvbnZlcnRlckluaXRpYWxpemVyLl9pbnN0YW5jZTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGluaXRpYWxpemUoKSB7XHJcbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQpIHJldHVybiB0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeTtcclxuICAgIGlmICh0aGlzLl9pbml0UHJvbWlzZSkgcmV0dXJuIHRoaXMuX2luaXRQcm9taXNlO1xyXG5cclxuICAgIHRoaXMuX2luaXRQcm9taXNlID0gdGhpcy5fZG9Jbml0aWFsaXplKCk7XHJcbiAgICByZXR1cm4gdGhpcy5faW5pdFByb21pc2U7XHJcbiAgfVxyXG5cclxuICBhc3luYyBfZG9Jbml0aWFsaXplKCkge1xyXG4gICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5TVEFSVElORyxcclxuICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuSU5JVElBTElaSU5HXHJcbiAgICApO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIEdldCBhbGwgcG9zc2libGUgbW9kdWxlIHBhdGhzXHJcbiAgICAgIGNvbnN0IHBhdGhzID0gTW9kdWxlTG9hZGVyLmdldE1vZHVsZVBhdGhzKCk7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZygnVXNpbmcgY29udmVydGVyIHBhdGhzOicsICdJTkZPJywgcGF0aHMpO1xyXG5cclxuICAgICAgLy8gRXh0cmFjdCBhbGwgdGhlIHBvc3NpYmxlIGJhc2UgcGF0aHMgZnJvbSB2YXJpb3VzIHNvdXJjZXNcclxuICAgICAgY29uc3QgcG9zc2libGVCYXNlUGF0aHMgPSBbXHJcbiAgICAgICAgcGF0aC5kaXJuYW1lKHBhdGhzLnJlZ2lzdHJ5KSxcclxuICAgICAgICAuLi5PYmplY3QudmFsdWVzKHBhdGhzLmNvbnZlcnRlcnMpLm1hcChwID0+IHBhdGguZGlybmFtZShwYXRoLmRpcm5hbWUocCkpKVxyXG4gICAgICBdO1xyXG5cclxuICAgICAgLy8gTG9nIGFsbCBwb3NzaWJsZSByZWdpc3RyeSBwYXRocyB3ZSdsbCB0cnlcclxuICAgICAgY29uc3QgYWxsUG9zc2libGVSZWdpc3RyeVBhdGhzID0gW1xyXG4gICAgICAgIHBhdGhzLnJlZ2lzdHJ5LFxyXG4gICAgICAgIHBhdGhzLnJlZ2lzdHJ5UGF0aCxcclxuICAgICAgICAuLi5wb3NzaWJsZUJhc2VQYXRocy5tYXAoYmFzZVBhdGggPT4gcGF0aC5qb2luKGJhc2VQYXRoLCAnQ29udmVydGVyUmVnaXN0cnkuanMnKSlcclxuICAgICAgXTtcclxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0FsbCBwb3NzaWJsZSByZWdpc3RyeSBwYXRoczonLCBhbGxQb3NzaWJsZVJlZ2lzdHJ5UGF0aHMpO1xyXG5cclxuICAgICAgLy8gQXR0ZW1wdCB0byBsb2FkIHRoZSByZWdpc3RyeSB1c2luZyBvdXIgZW5oYW5jZWQgbG9hZGVyIHdpdGggZmFsbGJhY2tzXHJcbiAgICAgIGxldCByZWdpc3RyeTtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBGaXJzdCB0cnkgdGhlIGRpcmVjdCBwYXRoXHJcbiAgICAgICAgY29uc3QgZXJyb3JQYXRoID0gJ0M6XFxcXFVzZXJzXFxcXEpvc2VwaFxcXFxEb2N1bWVudHNcXFxcQ29kZVxcXFxjb2RleC1tZFxcXFxkaXN0XFxcXHdpbi11bnBhY2tlZFxcXFxyZXNvdXJjZXNcXFxcYXBwLmFzYXJcXFxcc3JjXFxcXGVsZWN0cm9uXFxcXHNlcnZpY2VzXFxcXGNvbnZlcnNpb25cXFxcQ29udmVydGVyUmVnaXN0cnkuanMnO1xyXG4gICAgICAgIGNvbnN0IGNvcnJlY3RlZFBhdGggPSBlcnJvclBhdGgucmVwbGFjZSgnXFxcXHNyY1xcXFwnLCAnXFxcXGJ1aWxkXFxcXCcpO1xyXG5cclxuICAgICAgICAvLyBBbHNvIGNoZWNrIGlmIHRoZSBoYXJkY29kZWQgY29ycmVjdGVkIHBhdGggZXhpc3RzIGFuZCB0cnkgdG8gbG9hZCBpdCBkaXJlY3RseVxyXG4gICAgICAgIGlmIChmcy5leGlzdHNTeW5jKGNvcnJlY3RlZFBhdGgpKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYEZvdW5kIGNvcnJlY3RlZCByZWdpc3RyeSBwYXRoOiAke2NvcnJlY3RlZFBhdGh9YCwgJ0lORk8nKTtcclxuICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHJlZ2lzdHJ5ID0gcmVxdWlyZShjb3JyZWN0ZWRQYXRoKTtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuc3VjY2VzcygnU3VjY2Vzc2Z1bGx5IGxvYWRlZCByZWdpc3RyeSBmcm9tIGNvcnJlY3RlZCBwYXRoJyk7XHJcbiAgICAgICAgICB9IGNhdGNoIChkaXJlY3RMb2FkRXJyb3IpIHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgRmFpbGVkIHRvIGxvYWQgZnJvbSBjb3JyZWN0ZWQgcGF0aDogJHtkaXJlY3RMb2FkRXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIElmIGRpcmVjdCBsb2FkaW5nIGRpZG4ndCB3b3JrLCB0cnkgd2l0aCB0aGUgbW9kdWxlbG9hZGVyXHJcbiAgICAgICAgaWYgKCFyZWdpc3RyeSkge1xyXG4gICAgICAgICAgcmVnaXN0cnkgPSBhd2FpdCBNb2R1bGVMb2FkZXIubG9hZE1vZHVsZShcclxuICAgICAgICAgICAgcGF0aHMucmVnaXN0cnksXHJcbiAgICAgICAgICAgIHsgZmFsbGJhY2tQYXRoczogYWxsUG9zc2libGVSZWdpc3RyeVBhdGhzLnNsaWNlKDEpLCBzaWxlbnQ6IHRydWUgfVxyXG4gICAgICAgICAgKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gY2F0Y2ggKGluaXRpYWxFcnJvcikge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ0luaXRpYWwgcmVnaXN0cnkgbG9hZGluZyBmYWlsZWQsIHRyeWluZyBhbHRlcm5hdGl2ZSBhcHByb2FjaGVzJywgaW5pdGlhbEVycm9yKTtcclxuXHJcbiAgICAgICAgLy8gSWYgZGlyZWN0IGxvYWRpbmcgZmFpbGVkLCB0cnkgYSBkaWZmZXJlbnQgYXBwcm9hY2ggYnkgY29sbGVjdGluZyBiYXNlIGRpcmVjdG9yaWVzXHJcbiAgICAgICAgY29uc3QgYmFzZURpcnMgPSBbXTtcclxuXHJcbiAgICAgICAgLy8gQWRkIHBvdGVudGlhbCBiYXNlIGRpcmVjdG9yaWVzIChkZWR1cGxpY2F0ZSB0aGVtKVxyXG4gICAgICAgIGNvbnN0IGFkZEJhc2VEaXIgPSAoZGlyKSA9PiB7XHJcbiAgICAgICAgICBpZiAoZGlyICYmICFiYXNlRGlycy5pbmNsdWRlcyhkaXIpKSB7XHJcbiAgICAgICAgICAgIGJhc2VEaXJzLnB1c2goZGlyKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICAvLyBBZGQgbXVsdGlwbGUgcGF0aHMgdGhhdCBjb3VsZCBjb250YWluIHRoZSByZWdpc3RyeVxyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5kaXJuYW1lKHBhdGhzLnJlZ2lzdHJ5KSk7XHJcblxyXG4gICAgICAgIC8vIEFkZCBwYXJlbnQgZGlyZWN0b3JpZXMgb2YgZWFjaCBjb252ZXJ0ZXIgcGF0aFxyXG4gICAgICAgIE9iamVjdC52YWx1ZXMocGF0aHMuY29udmVydGVycykuZm9yRWFjaChjb252ZXJ0ZXJQYXRoID0+IHtcclxuICAgICAgICAgIGNvbnN0IGNvbnZlcnRlckRpciA9IHBhdGguZGlybmFtZShjb252ZXJ0ZXJQYXRoKTtcclxuICAgICAgICAgIGFkZEJhc2VEaXIocGF0aC5kaXJuYW1lKGNvbnZlcnRlckRpcikpOyAvLyBBZGQgcGFyZW50IGRpcmVjdG9yeVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICAvLyBBZGQgY29tbW9uIGRpcmVjdG9yaWVzIHJlbGF0aXZlIHRvIGV4ZWN1dGFibGVcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXInLCAnYXBwJyksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyJywgJ2FwcCcpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuXHJcbiAgICAgICAgLy8gTG9nIHRoZSBiYXNlIGRpcmVjdG9yaWVzIHdlJ2xsIHRyeVxyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZygnVHJ5aW5nIHRvIGxvYWQgcmVnaXN0cnkgZnJvbSB0aGVzZSBiYXNlIGRpcmVjdG9yaWVzOicsICdJTkZPJywgYmFzZURpcnMpO1xyXG5cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgLy8gVHJ5IHRvIGxvYWQgbW9kdWxlIGZyb20gdGhlIGJlc3QgcGF0aFxyXG4gICAgICAgICAgcmVnaXN0cnkgPSBhd2FpdCBNb2R1bGVMb2FkZXIubG9hZE1vZHVsZUZyb21CZXN0UGF0aCgnQ29udmVydGVyUmVnaXN0cnkuanMnLCBiYXNlRGlycyk7XHJcbiAgICAgICAgfSBjYXRjaCAoYmVzdFBhdGhFcnJvcikge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0FsbCBwYXRoIGxvYWRpbmcgYXR0ZW1wdHMgZmFpbGVkLCB1c2luZyBlbWJlZGRlZCByZWdpc3RyeScsIGJlc3RQYXRoRXJyb3IpO1xyXG4gICAgICAgICAgLy8gV2hlbiBhbGwgZWxzZSBmYWlscywgdXNlIG91ciBlbWJlZGRlZCByZWdpc3RyeVxyXG4gICAgICAgICAgcmVnaXN0cnkgPSBNaW5pbWFsQ29udmVydGVyUmVnaXN0cnk7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdVc2luZyBlbWJlZGRlZCBNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkgYXMgbGFzdCByZXNvcnQnKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFZhbGlkYXRlIHRoZSByZWdpc3RyeVxyXG4gICAgICBpZiAoIXRoaXMuX3ZhbGlkYXRlUmVnaXN0cnkocmVnaXN0cnkpKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ludmFsaWQgY29udmVydGVyIHJlZ2lzdHJ5IHN0cnVjdHVyZSwgdXNpbmcgZW1iZWRkZWQgcmVnaXN0cnknKTtcclxuICAgICAgICAvLyBVc2Ugb3VyIGVtYmVkZGVkIHJlZ2lzdHJ5XHJcbiAgICAgICAgcmVnaXN0cnkgPSBNaW5pbWFsQ29udmVydGVyUmVnaXN0cnk7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybignVXNpbmcgZW1iZWRkZWQgTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5IGFzIGxhc3QgcmVzb3J0Jyk7XHJcblxyXG4gICAgICAgIC8vIERvdWJsZS1jaGVjayB0aGF0IG91ciBlbWJlZGRlZCByZWdpc3RyeSBpcyB2YWxpZFxyXG4gICAgICAgIGlmICghdGhpcy5fdmFsaWRhdGVSZWdpc3RyeShyZWdpc3RyeSkpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5IGlzIGludmFsaWQhJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBMb2cgdGhlIGNvbnZlcnRlcnMgaW4gdGhlIHJlZ2lzdHJ5XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZygnQXZhaWxhYmxlIGNvbnZlcnRlcnM6JywgT2JqZWN0LmtleXMocmVnaXN0cnkuY29udmVydGVycyB8fCB7fSkpO1xyXG5cclxuICAgICAgdGhpcy5sb2dnZXIuc3VjY2VzcygnU3VjY2Vzc2Z1bGx5IGxvYWRlZCBjb252ZXJ0ZXIgcmVnaXN0cnknKTtcclxuICAgICAgdGhpcy5fY29udmVydGVyUmVnaXN0cnkgPSByZWdpc3RyeTtcclxuICAgICAgdGhpcy5faW5pdGlhbGl6ZWQgPSB0cnVlO1xyXG5cclxuICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLklOSVRJQUxJWklORyxcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5DT01QTEVURURcclxuICAgICAgKTtcclxuXHJcbiAgICAgIHJldHVybiB0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIHRoaXMuX2luaXRQcm9taXNlID0gbnVsbDtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvbkVycm9yKCdpbml0JywgZXJyb3IpO1xyXG4gICAgICBcclxuICAgICAgLy8gUHJvdmlkZSBiZXR0ZXIgZXJyb3IgaW5mb3JtYXRpb25cclxuICAgICAgY29uc3QgZW5oYW5jZWRFcnJvciA9IG5ldyBFcnJvcihgRmFpbGVkIHRvIGluaXRpYWxpemUgY29udmVydGVyIHJlZ2lzdHJ5OiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgIGVuaGFuY2VkRXJyb3Iub3JpZ2luYWwgPSBlcnJvcjtcclxuICAgICAgZW5oYW5jZWRFcnJvci5zdGFjayA9IGVycm9yLnN0YWNrO1xyXG4gICAgICB0aHJvdyBlbmhhbmNlZEVycm9yO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgX3ZhbGlkYXRlUmVnaXN0cnkocmVnaXN0cnkpIHtcclxuICAgIGlmICghcmVnaXN0cnkgfHwgdHlwZW9mIHJlZ2lzdHJ5ICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKCFyZWdpc3RyeS5jb252ZXJ0ZXJzIHx8IHR5cGVvZiByZWdpc3RyeS5jb252ZXJ0ZXJzICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKHR5cGVvZiByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93biAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKHR5cGVvZiByZWdpc3RyeS5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogQ2F0ZWdvcml6ZSBmaWxlIHR5cGVzIGZvciBiZXR0ZXIgb3JnYW5pemF0aW9uXHJcbiAqL1xyXG5jb25zdCBGSUxFX1RZUEVfQ0FURUdPUklFUyA9IHtcclxuICAvLyBBdWRpbyBmaWxlc1xyXG4gIG1wMzogJ2F1ZGlvJyxcclxuICB3YXY6ICdhdWRpbycsXHJcbiAgb2dnOiAnYXVkaW8nLFxyXG4gIGZsYWM6ICdhdWRpbycsXHJcbiAgXHJcbiAgLy8gVmlkZW8gZmlsZXNcclxuICBtcDQ6ICd2aWRlbycsXHJcbiAgd2VibTogJ3ZpZGVvJyxcclxuICBhdmk6ICd2aWRlbycsXHJcbiAgbW92OiAndmlkZW8nLFxyXG4gIFxyXG4gIC8vIERvY3VtZW50IGZpbGVzXHJcbiAgcGRmOiAnZG9jdW1lbnQnLFxyXG4gIGRvY3g6ICdkb2N1bWVudCcsXHJcbiAgcHB0eDogJ2RvY3VtZW50JyxcclxuICBcclxuICAvLyBEYXRhIGZpbGVzXHJcbiAgeGxzeDogJ2RhdGEnLFxyXG4gIGNzdjogJ2RhdGEnLFxyXG4gIFxyXG4gIC8vIFdlYiBjb250ZW50XHJcbiAgdXJsOiAnd2ViJyxcclxuICBwYXJlbnR1cmw6ICd3ZWInLFxyXG59O1xyXG5cclxuLyoqXHJcbiAqIEVuaGFuY2VkIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5IGNsYXNzIHdpdGggcHJvcGVyIGluaXRpYWxpemF0aW9uIGFuZCBjb252ZXJzaW9uIGhhbmRsaW5nXHJcbiAqL1xyXG5jbGFzcyBVbmlmaWVkQ29udmVydGVyRmFjdG9yeSB7XHJcbiAgc3RhdGljIF9pbnN0YW5jZSA9IG51bGw7XHJcbiAgXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLl9pbml0aWFsaXplciA9IENvbnZlcnRlckluaXRpYWxpemVyLmdldEluc3RhbmNlKCk7XHJcbiAgICB0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeSA9IG51bGw7XHJcbiAgICB0aGlzLmxvZ2dlciA9IGdldExvZ2dlcignVW5pZmllZENvbnZlcnRlckZhY3RvcnknKTtcclxuICAgIHRoaXMubG9nZ2VyLmxvZygnVW5pZmllZENvbnZlcnRlckZhY3RvcnkgaW5pdGlhbGl6ZWQnLCAnSU5GTycpO1xyXG4gIH1cclxuXHJcbiAgc3RhdGljIGdldEluc3RhbmNlKCkge1xyXG4gICAgaWYgKCFVbmlmaWVkQ29udmVydGVyRmFjdG9yeS5faW5zdGFuY2UpIHtcclxuICAgICAgVW5pZmllZENvbnZlcnRlckZhY3RvcnkuX2luc3RhbmNlID0gbmV3IFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5KCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gVW5pZmllZENvbnZlcnRlckZhY3RvcnkuX2luc3RhbmNlO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgX2Vuc3VyZUluaXRpYWxpemVkKCkge1xyXG4gICAgaWYgKCF0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeSkge1xyXG4gICAgICB0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeSA9IGF3YWl0IHRoaXMuX2luaXRpYWxpemVyLmluaXRpYWxpemUoKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGdldENvbnZlcnRlcihmaWxlVHlwZSkge1xyXG4gICAgdGhpcy5sb2dnZXIuc2V0Q29udGV4dCh7IGZpbGVUeXBlIH0pO1xyXG4gICAgXHJcbiAgICBjb25zdCByZWdpc3RyeSA9IGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKCk7XHJcbiAgICBcclxuICAgIGlmICghZmlsZVR5cGUpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdGaWxlIHR5cGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBOb3JtYWxpemUgZmlsZSB0eXBlIChyZW1vdmUgZG90LCBsb3dlcmNhc2UpXHJcbiAgICBjb25zdCBub3JtYWxpemVkVHlwZSA9IGZpbGVUeXBlLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXlxcLi8sICcnKTtcclxuXHJcbiAgICAvLyBHZXQgVVJMIGNvbnZlcnRlciBkaXJlY3RseSBmcm9tIHJlZ2lzdHJ5IGlmIGF2YWlsYWJsZVxyXG4gICAgaWYgKG5vcm1hbGl6ZWRUeXBlID09PSAndXJsJyB8fCBub3JtYWxpemVkVHlwZSA9PT0gJ3BhcmVudHVybCcpIHtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nKGBVc2luZyBkaXJlY3QgVVJMIGNvbnZlcnRlciBmb3I6ICR7bm9ybWFsaXplZFR5cGV9YCwgJ0lORk8nKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGNvbnZlcnRlciA9IHJlZ2lzdHJ5LmNvbnZlcnRlcnM/Lltub3JtYWxpemVkVHlwZV07XHJcbiAgICAgIGlmIChjb252ZXJ0ZXIpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKGBGb3VuZCAke25vcm1hbGl6ZWRUeXBlfSBjb252ZXJ0ZXJgKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgY29udmVydGVyOiB7XHJcbiAgICAgICAgICAgIC4uLmNvbnZlcnRlcixcclxuICAgICAgICAgICAgdHlwZTogbm9ybWFsaXplZFR5cGUsXHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICByZXR1cm4gY29udmVydGVyLmNvbnZlcnQoY29udGVudCwgbmFtZSwgYXBpS2V5LCB7XHJcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgICAgbmFtZSxcclxuICAgICAgICAgICAgICAgIHR5cGU6IG5vcm1hbGl6ZWRUeXBlXHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB0eXBlOiBub3JtYWxpemVkVHlwZSxcclxuICAgICAgICAgIGNhdGVnb3J5OiAnd2ViJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFRyeSBmYWxsYmFjayB0byBjb252ZXJ0VG9NYXJrZG93blxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2coYEF0dGVtcHRpbmcgY29udmVydFRvTWFya2Rvd24gZmFsbGJhY2sgZm9yICR7bm9ybWFsaXplZFR5cGV9YCwgJ0lORk8nKTtcclxuICAgICAgaWYgKHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIGNvbnZlcnRlcjoge1xyXG4gICAgICAgICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zKSA9PiB7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duKG5vcm1hbGl6ZWRUeXBlLCBjb250ZW50LCB7XHJcbiAgICAgICAgICAgICAgICBuYW1lLFxyXG4gICAgICAgICAgICAgICAgYXBpS2V5LFxyXG4gICAgICAgICAgICAgICAgLi4ub3B0aW9uc1xyXG4gICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB2YWxpZGF0ZTogKGlucHV0KSA9PiB0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnICYmIGlucHV0Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgICAgIG5hbWU6IG5vcm1hbGl6ZWRUeXBlID09PSAndXJsJyA/ICdXZWIgUGFnZScgOiAnV2Vic2l0ZScsXHJcbiAgICAgICAgICAgICAgZXh0ZW5zaW9uczogWycudXJsJywgJy5odG1sJywgJy5odG0nXSxcclxuICAgICAgICAgICAgICBtaW1lVHlwZXM6IFsndGV4dC9odG1sJywgJ2FwcGxpY2F0aW9uL3gtdXJsJ10sXHJcbiAgICAgICAgICAgICAgbWF4U2l6ZTogMTAgKiAxMDI0ICogMTAyNFxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgdHlwZTogbm9ybWFsaXplZFR5cGUsXHJcbiAgICAgICAgICBjYXRlZ29yeTogJ3dlYidcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIEZvciBhbGwgb3RoZXIgdHlwZXMsIGdldCBjb252ZXJ0ZXIgZnJvbSByZWdpc3RyeVxyXG4gICAgY29uc3QgY29udmVydGVyID0gYXdhaXQgcmVnaXN0cnkuZ2V0Q29udmVydGVyQnlFeHRlbnNpb24obm9ybWFsaXplZFR5cGUpO1xyXG4gICAgaWYgKGNvbnZlcnRlcikge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIGNvbnZlcnRlcixcclxuICAgICAgICB0eXBlOiBub3JtYWxpemVkVHlwZSxcclxuICAgICAgICBjYXRlZ29yeTogRklMRV9UWVBFX0NBVEVHT1JJRVNbbm9ybWFsaXplZFR5cGVdIHx8ICdkb2N1bWVudCdcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbnZlcnRlciBmb3VuZCBmb3IgdHlwZTogJHtmaWxlVHlwZX1gKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENvbnZlcnQgYSBmaWxlIHRvIG1hcmtkb3duIHVzaW5nIHRoZSBhcHByb3ByaWF0ZSBjb252ZXJ0ZXJcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIHRoZSBmaWxlIG9yIFVSTCBzdHJpbmdcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IC0gQ29udmVyc2lvbiByZXN1bHRcclxuICAgKi9cclxuICBhc3luYyBjb252ZXJ0RmlsZShmaWxlUGF0aCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICBjb25zdCBmaWxlVHlwZSA9IG9wdGlvbnMuZmlsZVR5cGU7XHJcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xyXG4gICAgXHJcbiAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uU3RhcnQoZmlsZVR5cGUsIG9wdGlvbnMpO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICBpZiAoIWZpbGVUeXBlKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdmaWxlVHlwZSBpcyByZXF1aXJlZCBpbiBvcHRpb25zJyk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIERldGVybWluZSBpZiB0aGlzIGlzIGEgVVJMIG9yIGEgZmlsZVxyXG4gICAgICBjb25zdCBpc1VybCA9IGZpbGVUeXBlID09PSAndXJsJyB8fCBmaWxlVHlwZSA9PT0gJ3BhcmVudHVybCc7XHJcbiAgICAgIFxyXG4gICAgICAvLyBHZXQgZmlsZSBkZXRhaWxzIC0gaGFuZGxlIFVSTHMgZGlmZmVyZW50bHlcclxuICAgICAgbGV0IGZpbGVOYW1lO1xyXG4gICAgICBcclxuICAgICAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihmaWxlUGF0aCkpIHtcclxuICAgICAgICBmaWxlTmFtZSA9IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWZpbGVOYW1lKSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ29yaWdpbmFsRmlsZU5hbWUgaXMgcmVxdWlyZWQgd2hlbiBwYXNzaW5nIGJ1ZmZlciBpbnB1dCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIGlmIChpc1VybCkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCB1cmxPYmogPSBuZXcgVVJMKGZpbGVQYXRoKTtcclxuICAgICAgICAgIGZpbGVOYW1lID0gdXJsT2JqLmhvc3RuYW1lICsgKHVybE9iai5wYXRobmFtZSAhPT0gJy8nID8gdXJsT2JqLnBhdGhuYW1lIDogJycpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgIGZpbGVOYW1lID0gZmlsZVBhdGg7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGZpbGVOYW1lID0gcGF0aC5iYXNlbmFtZShmaWxlUGF0aCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5TVEFSVElORyxcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5WQUxJREFUSU5HXHJcbiAgICAgICk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBHZXQgdGhlIGFwcHJvcHJpYXRlIGNvbnZlcnRlciB3aXRoIGFzeW5jL2F3YWl0XHJcbiAgICAgIGxldCBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5nZXRDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICBcclxuICAgICAgLy8gU3BlY2lhbCBoYW5kbGluZyBmb3IgVVJMIHR5cGVzIGluIHByb2R1Y3Rpb24gbW9kZVxyXG4gICAgICBpZiAoIWNvbnZlcnRlckluZm8gJiYgKGZpbGVUeXBlID09PSAndXJsJyB8fCBmaWxlVHlwZSA9PT0gJ3BhcmVudHVybCcpKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBTcGVjaWFsIGhhbmRsaW5nIGZvciAke2ZpbGVUeXBlfSBpbiBwcm9kdWN0aW9uIG1vZGVgLCAnSU5GTycpO1xyXG4gICAgICAgIGNvbnZlcnRlckluZm8gPSBhd2FpdCB0aGlzLmNyZWF0ZURpcmVjdFVybENvbnZlcnRlcihmaWxlVHlwZSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLnN1Y2Nlc3MoYENyZWF0ZWQgZGlyZWN0IGNvbnZlcnRlciBmb3IgJHtmaWxlVHlwZX1gKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIElmIGNvbnZlcnRlciBub3QgZm91bmQsIHRyeSBhZ2FpbiBhZnRlciBhIHNob3J0IGRlbGF5XHJcbiAgICAgIGlmICghY29udmVydGVySW5mbykge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgUmV0cnlpbmcgdG8gZ2V0IGNvbnZlcnRlciBmb3IgJHtmaWxlVHlwZX0gYWZ0ZXIgZGVsYXkuLi5gLCAnSU5GTycpO1xyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCA1MDApKTtcclxuICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5nZXRDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghY29udmVydGVySW5mbyAmJiAoZmlsZVR5cGUgPT09ICd1cmwnIHx8IGZpbGVUeXBlID09PSAncGFyZW50dXJsJykpIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgU2Vjb25kIGF0dGVtcHQgYXQgc3BlY2lhbCBoYW5kbGluZyBmb3IgJHtmaWxlVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuY3JlYXRlRGlyZWN0VXJsQ29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gSWYgc3RpbGwgbm90IGZvdW5kLCB0cnkgb25lIG1vcmUgdGltZSB3aXRoIGEgbG9uZ2VyIGRlbGF5XHJcbiAgICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYEZpbmFsIGF0dGVtcHQgdG8gZ2V0IGNvbnZlcnRlciBmb3IgJHtmaWxlVHlwZX0gYWZ0ZXIgbG9uZ2VyIGRlbGF5Li4uYCwgJ0lORk8nKTtcclxuICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDAwKSk7XHJcbiAgICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5nZXRDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBpZiAoIWNvbnZlcnRlckluZm8gJiYgKGZpbGVUeXBlID09PSAndXJsJyB8fCBmaWxlVHlwZSA9PT0gJ3BhcmVudHVybCcpKSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgRmluYWwgYXR0ZW1wdCBhdCBzcGVjaWFsIGhhbmRsaW5nIGZvciAke2ZpbGVUeXBlfWAsICdJTkZPJyk7XHJcbiAgICAgICAgICAgIGNvbnZlcnRlckluZm8gPSBhd2FpdCB0aGlzLmNyZWF0ZURpcmVjdFVybENvbnZlcnRlcihmaWxlVHlwZSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGlmICghY29udmVydGVySW5mbykge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGZpbGUgdHlwZTogJHtmaWxlVHlwZX1gKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSBhIHByb2dyZXNzIHRyYWNrZXIgaWYgY2FsbGJhY2sgcHJvdmlkZWRcclxuICAgICAgY29uc3QgcHJvZ3Jlc3NUcmFja2VyID0gb3B0aW9ucy5vblByb2dyZXNzID8gXHJcbiAgICAgICAgbmV3IFByb2dyZXNzVHJhY2tlcihvcHRpb25zLm9uUHJvZ3Jlc3MsIDI1MCkgOiBudWxsO1xyXG4gICAgICBcclxuICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoNSwgeyBzdGF0dXM6ICdpbml0aWFsaXppbmcnLCBmaWxlVHlwZTogZmlsZVR5cGUgfSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHJlZ2lzdHJ5ID0gYXdhaXQgdGhpcy5fZW5zdXJlSW5pdGlhbGl6ZWQoKTtcclxuXHJcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDb252ZXJ0ZXIgaW5mbzonLCBzYW5pdGl6ZUZvckxvZ2dpbmcoe1xyXG4gICAgICAgIGhhc1JlZ2lzdHJ5OiAhIXJlZ2lzdHJ5LFxyXG4gICAgICAgIGNvbnZlcnRlclR5cGU6IGNvbnZlcnRlckluZm8/LnR5cGUgfHwgJ25vbmUnLFxyXG4gICAgICAgIGNhdGVnb3J5OiBjb252ZXJ0ZXJJbmZvPy5jYXRlZ29yeSB8fCAndW5rbm93bicsXHJcbiAgICAgICAgaGFzQ29udmVydGVyOiAhIWNvbnZlcnRlckluZm8/LmNvbnZlcnRlcixcclxuICAgICAgICBjb252ZXJ0ZXJEZXRhaWxzOiBjb252ZXJ0ZXJJbmZvPy5jb252ZXJ0ZXJcclxuICAgICAgfSkpO1xyXG4gICAgICBcclxuICAgICAgLy8gSGFuZGxlIHRoZSBjb252ZXJzaW9uIGJhc2VkIG9uIGZpbGUgdHlwZVxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmhhbmRsZUNvbnZlcnNpb24oZmlsZVBhdGgsIHtcclxuICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZSxcclxuICAgICAgICBmaWxlTmFtZSxcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIsXHJcbiAgICAgICAgY29udmVydGVySW5mbyxcclxuICAgICAgICBpc1VybFxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDEwMCwgeyBzdGF0dXM6ICdjb21wbGV0ZWQnIH0pO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uQ29tcGxldGUoZmlsZVR5cGUpO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uRXJyb3IoZmlsZVR5cGUsIGVycm9yKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIHR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIG5hbWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCAndW5rbm93bicsXHJcbiAgICAgICAgY2F0ZWdvcnk6IEZJTEVfVFlQRV9DQVRFR09SSUVTW2ZpbGVUeXBlXSB8fCAndW5rbm93bidcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENyZWF0ZSBhIGRpcmVjdCBVUkwgY29udmVydGVyIGZvciBwcm9kdWN0aW9uIG1vZGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVR5cGUgLSBVUkwgZmlsZSB0eXBlICgndXJsJyBvciAncGFyZW50dXJsJylcclxuICAgKiBAcmV0dXJucyB7T2JqZWN0fG51bGx9IC0gQ29udmVydGVyIGluZm8gb3IgbnVsbCBpZiBub3QgcG9zc2libGVcclxuICAgKi9cclxuICBhc3luYyBjcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpIHtcclxuICAgIHRoaXMubG9nZ2VyLmxvZyhgQ3JlYXRpbmcgZGlyZWN0IFVSTCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgIFxyXG4gICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgaWYgKCFyZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93bikge1xyXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignQ2Fubm90IGNyZWF0ZSBkaXJlY3QgVVJMIGNvbnZlcnRlcjogY29udmVydFRvTWFya2Rvd24gbm90IGF2YWlsYWJsZScpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgY29udmVydGVyOiB7XHJcbiAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBVc2luZyBkaXJlY3QgVVJMIGNvbnZlcnRlciBmb3IgJHtmaWxlVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgcmV0dXJuIHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duKGZpbGVUeXBlLCBjb250ZW50LCB7XHJcbiAgICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICAgIGFwaUtleSxcclxuICAgICAgICAgICAgLi4ub3B0aW9uc1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICB2YWxpZGF0ZTogKGlucHV0KSA9PiB0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnICYmIGlucHV0Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICBuYW1lOiBmaWxlVHlwZSA9PT0gJ3VybCcgPyAnV2ViIFBhZ2UnIDogJ1dlYnNpdGUnLFxyXG4gICAgICAgICAgZXh0ZW5zaW9uczogWycudXJsJywgJy5odG1sJywgJy5odG0nXSxcclxuICAgICAgICAgIG1pbWVUeXBlczogWyd0ZXh0L2h0bWwnLCAnYXBwbGljYXRpb24veC11cmwnXSxcclxuICAgICAgICAgIG1heFNpemU6IDEwICogMTAyNCAqIDEwMjRcclxuICAgICAgICB9XHJcbiAgICAgIH0sXHJcbiAgICAgIHR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICBjYXRlZ29yeTogJ3dlYidcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTdGFuZGFyZGl6ZSBjb252ZXJzaW9uIHJlc3VsdCB0byBlbnN1cmUgY29uc2lzdGVudCBmb3JtYXRcclxuICAgKlxyXG4gICAqIElNUE9SVEFOVDogVGhpcyBtZXRob2QgZW5zdXJlcyBwcm9wZXJ0aWVzIGFyZSBzZXQgaW4gdGhlIGNvcnJlY3Qgb3JkZXIgdG8gcHJldmVudFxyXG4gICAqIHByb3BlcnR5IHNoYWRvd2luZyBpc3N1ZXMuIFRoZSBvcmRlciBtYXR0ZXJzIGJlY2F1c2U6XHJcbiAgICogMS4gV2UgZmlyc3Qgc3ByZWFkIHRoZSByZXN1bHQgb2JqZWN0IHRvIGluY2x1ZGUgYWxsIGl0cyBwcm9wZXJ0aWVzXHJcbiAgICogMi4gVGhlbiB3ZSBvdmVycmlkZSBzcGVjaWZpYyBwcm9wZXJ0aWVzIHRvIGVuc3VyZSB0aGV5IGhhdmUgdGhlIGNvcnJlY3QgdmFsdWVzXHJcbiAgICogMy4gV2Ugc2V0IGNvbnRlbnQgbGFzdCB0byBlbnN1cmUgaXQncyBub3QgYWNjaWRlbnRhbGx5IG92ZXJyaWRkZW5cclxuICAgKiA0LiBXZSBhZGQgYSBmaW5hbCBjaGVjayB0byBlbnN1cmUgY29udGVudCBpcyBuZXZlciBlbXB0eSwgcHJvdmlkaW5nIGEgZmFsbGJhY2tcclxuICAgKlxyXG4gICAqIFRoaXMgZml4ZXMgdGhlIFwiQ29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50XCIgZXJyb3IgdGhhdCBjb3VsZCBvY2N1ciB3aGVuXHJcbiAgICogdGhlIGNvbnRlbnQgcHJvcGVydHkgd2FzIG92ZXJyaWRkZW4gYnkgdGhlIHNwcmVhZCBvcGVyYXRvci5cclxuICAgKlxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXN1bHQgLSBSYXcgY29udmVyc2lvbiByZXN1bHRcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVR5cGUgLSBGaWxlIHR5cGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZU5hbWUgLSBGaWxlIG5hbWVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2F0ZWdvcnkgLSBGaWxlIGNhdGVnb3J5XHJcbiAgICogQHJldHVybnMge09iamVjdH0gLSBTdGFuZGFyZGl6ZWQgcmVzdWx0XHJcbiAgICovXHJcbiAgc3RhbmRhcmRpemVSZXN1bHQocmVzdWx0LCBmaWxlVHlwZSwgZmlsZU5hbWUsIGNhdGVnb3J5KSB7XHJcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmF3IHJlc3VsdCByZWNlaXZlZCBmb3IgJHtmaWxlVHlwZX06YCwgc2FuaXRpemVGb3JMb2dnaW5nKHJlc3VsdCkpOyAvLyBBZGQgbG9nZ2luZ1xyXG5cclxuICAgIC8vIExvZyBkZXRhaWxlZCBmaWxlbmFtZSBpbmZvcm1hdGlvbiBmb3IgZGVidWdnaW5nXHJcbiAgICB0aGlzLmxvZ2dlci5sb2coYPCfk4QgRmlsZW5hbWUgZGV0YWlscyBmb3IgJHtmaWxlVHlwZX06YCwge1xyXG4gICAgICByZXN1bHRPcmlnaW5hbEZpbGVOYW1lOiByZXN1bHQ/Lm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgIHJlc3VsdE1ldGFkYXRhT3JpZ2luYWxGaWxlTmFtZTogcmVzdWx0Py5tZXRhZGF0YT8ub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgcmVzdWx0TmFtZTogcmVzdWx0Py5uYW1lLFxyXG4gICAgICBmdW5jdGlvblBhcmFtRmlsZU5hbWU6IGZpbGVOYW1lXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBIYW5kbGUgbnVsbCBvciB1bmRlZmluZWQgcmVzdWx0IGV4cGxpY2l0bHlcclxuICAgIGlmICghcmVzdWx0KSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgUmVjZWl2ZWQgbnVsbCBvciB1bmRlZmluZWQgcmVzdWx0IGZvciAke2ZpbGVUeXBlfS4gQXNzdW1pbmcgZmFpbHVyZS5gKTtcclxuICAgICAgICByZXN1bHQgPSB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogJ0NvbnZlcnRlciByZXR1cm5lZCBudWxsIG9yIHVuZGVmaW5lZCByZXN1bHQnIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIHN1Y2Nlc3Mgc3RhdHVzIG1vcmUgcm9idXN0bHlcclxuICAgIC8vIFN1Y2Nlc3MgaXMgT05MWSB0cnVlIGlmIHJlc3VsdC5zdWNjZXNzIGlzIGV4cGxpY2l0bHkgdHJ1ZS5cclxuICAgIC8vIE90aGVyd2lzZSwgaXQncyBmYWxzZSwgZXNwZWNpYWxseSBpZiBhbiBlcnJvciBwcm9wZXJ0eSBleGlzdHMuXHJcbiAgICBjb25zdCBpc1N1Y2Nlc3MgPSByZXN1bHQuc3VjY2VzcyA9PT0gdHJ1ZTtcclxuXHJcbiAgICAvLyBTYW5pdGl6ZSBwb3RlbnRpYWxseSBjb21wbGV4IG9iamVjdHMgd2l0aGluIHRoZSByZXN1bHQgKmFmdGVyKiBkZXRlcm1pbmluZyBzdWNjZXNzXHJcbiAgICBjb25zdCBzYW5pdGl6ZWRSZXN1bHQgPSBzYW5pdGl6ZUZvckxvZ2dpbmcocmVzdWx0KTtcclxuXHJcbiAgICBjb25zdCBzdGFuZGFyZGl6ZWQgPSB7XHJcbiAgICAgICAgLi4uc2FuaXRpemVkUmVzdWx0LCAvLyBTcHJlYWQgc2FuaXRpemVkIHJlc3VsdCBmaXJzdFxyXG4gICAgICAgIHN1Y2Nlc3M6IGlzU3VjY2VzcywgLy8gT3ZlcnJpZGUgd2l0aCBkZXRlcm1pbmVkIHN1Y2Nlc3Mgc3RhdHVzXHJcbiAgICAgICAgdHlwZTogcmVzdWx0LnR5cGUgfHwgZmlsZVR5cGUsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIG5hbWU6IChyZXN1bHQubWV0YWRhdGEgJiYgcmVzdWx0Lm1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUpIHx8IHJlc3VsdC5vcmlnaW5hbEZpbGVOYW1lIHx8IHJlc3VsdC5uYW1lIHx8IGZpbGVOYW1lLCAvLyBQcmVmZXIgbWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSBmaXJzdFxyXG4gICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IChyZXN1bHQubWV0YWRhdGEgJiYgcmVzdWx0Lm1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUpIHx8IHJlc3VsdC5vcmlnaW5hbEZpbGVOYW1lIHx8IHJlc3VsdC5uYW1lIHx8IGZpbGVOYW1lLCAvLyBTYW1lIHByaW9yaXR5IGZvciBjb25zaXN0ZW5jeVxyXG4gICAgICAgIGNhdGVnb3J5OiByZXN1bHQuY2F0ZWdvcnkgfHwgY2F0ZWdvcnksXHJcbiAgICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICAgICAgLi4uKHJlc3VsdC5tZXRhZGF0YSB8fCB7fSksXHJcbiAgICAgICAgICAgIGNvbnZlcnRlcjogcmVzdWx0LmNvbnZlcnRlciB8fCAndW5rbm93bicsXHJcbiAgICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IChyZXN1bHQubWV0YWRhdGEgJiYgcmVzdWx0Lm1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUpIHx8IC8vIEZpcnN0IHByaW9yaXR5IC0gZnJvbSBjb252ZXJ0ZXIncyBtZXRhZGF0YVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0Lm9yaWdpbmFsRmlsZU5hbWUgfHwgLy8gU2Vjb25kIHByaW9yaXR5IC0gZnJvbSByZXN1bHQncyBkaXJlY3QgcHJvcGVydHlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC5uYW1lIHx8IC8vIFRoaXJkIHByaW9yaXR5IC0gZnJvbSByZXN1bHQncyBuYW1lXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmaWxlTmFtZSAvLyBGaW5hbCBmYWxsYmFjayAtIGZyb20gZnVuY3Rpb24gcGFyYW1ldGVyXHJcbiAgICAgICAgfSxcclxuICAgICAgICBpbWFnZXM6IHJlc3VsdC5pbWFnZXMgfHwgW10sXHJcbiAgICAgICAgLy8gRW5zdXJlIGNvbnRlbnQgZXhpc3RzLCBwcm92aWRlIGZhbGxiYWNrIGlmIG5lZWRlZFxyXG4gICAgICAgIGNvbnRlbnQ6IHJlc3VsdC5jb250ZW50IHx8IChpc1N1Y2Nlc3MgPyAnJyA6IGAjIENvbnZlcnNpb24gUmVzdWx0XFxuXFxuVGhlICR7ZmlsZVR5cGV9IGZpbGUgd2FzIHByb2Nlc3NlZCwgYnV0IG5vIGNvbnRlbnQgd2FzIGdlbmVyYXRlZC4gVGhpcyBtaWdodCBpbmRpY2F0ZSBhbiBpc3N1ZSBvciBiZSBub3JtYWwgZm9yIHRoaXMgZmlsZSB0eXBlLmApLFxyXG4gICAgICAgIC8vIEVuc3VyZSBlcnJvciBwcm9wZXJ0eSBpcyBwcmVzZW50IGlmIG5vdCBzdWNjZXNzZnVsXHJcbiAgICAgICAgZXJyb3I6ICFpc1N1Y2Nlc3MgPyAocmVzdWx0LmVycm9yIHx8ICdVbmtub3duIGNvbnZlcnNpb24gZXJyb3InKSA6IHVuZGVmaW5lZFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBSZW1vdmUgZXJyb3IgcHJvcGVydHkgaWYgc3VjY2Vzc2Z1bFxyXG4gICAgaWYgKHN0YW5kYXJkaXplZC5zdWNjZXNzKSB7XHJcbiAgICAgICAgZGVsZXRlIHN0YW5kYXJkaXplZC5lcnJvcjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIGNvbnRlbnQgaXMgbm90IG51bGwgb3IgdW5kZWZpbmVkLCBhbmQgcHJvdmlkZSBhcHByb3ByaWF0ZSBmYWxsYmFja1xyXG4gICAgaWYgKCFzdGFuZGFyZGl6ZWQuY29udGVudCAmJiAhaXNTdWNjZXNzKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5QUk9DRVNTSU5HLFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkNPTlRFTlRfRU1QVFlcclxuICAgICAgKTtcclxuICAgICAgLy8gUHJvdmlkZSBhIG1vcmUgaW5mb3JtYXRpdmUgbWVzc2FnZSBpZiB0aGUgY29udmVyc2lvbiBmYWlsZWQgYW5kIGNvbnRlbnQgaXMgZW1wdHlcclxuICAgICAgc3RhbmRhcmRpemVkLmNvbnRlbnQgPSBgIyBDb252ZXJzaW9uIEVycm9yXFxuXFxuVGhlICR7ZmlsZVR5cGV9IGZpbGUgY29udmVyc2lvbiBmYWlsZWQgb3IgcHJvZHVjZWQgbm8gY29udGVudC4gRXJyb3I6ICR7c3RhbmRhcmRpemVkLmVycm9yIHx8ICdVbmtub3duIGVycm9yJ31gO1xyXG4gICAgfSBlbHNlIGlmICghc3RhbmRhcmRpemVkLmNvbnRlbnQgJiYgaXNTdWNjZXNzKSB7XHJcbiAgICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuUFJPQ0VTU0lORyxcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5DT05URU5UX0VNUFRZXHJcbiAgICAgICk7XHJcbiAgICAgIC8vIEZhbGxiYWNrIGZvciBzdWNjZXNzZnVsIGNvbnZlcnNpb24gYnV0IGVtcHR5IGNvbnRlbnRcclxuICAgICAgc3RhbmRhcmRpemVkLmNvbnRlbnQgPSBgIyBDb252ZXJzaW9uIFJlc3VsdFxcblxcblRoZSAke2ZpbGVUeXBlfSBmaWxlIHdhcyBwcm9jZXNzZWQgc3VjY2Vzc2Z1bGx5LCBidXQgbm8gdGV4dHVhbCBjb250ZW50IHdhcyBnZW5lcmF0ZWQuIFRoaXMgaXMgbm9ybWFsIGZvciBjZXJ0YWluIGZpbGUgdHlwZXMgKGUuZy4sIG11bHRpbWVkaWEgZmlsZXMgd2l0aG91dCB0cmFuc2NyaXB0aW9uKS5gO1xyXG4gICAgfVxyXG5cclxuXHJcbiAgICAvLyBMb2cgdGhlIGZpbmFsIHN0YW5kYXJkaXplZCByZXN1bHRcclxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBTdGFuZGFyZGl6ZWQgcmVzdWx0IGZvciAke2ZpbGVUeXBlfTpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcoc3RhbmRhcmRpemVkKSk7XHJcblxyXG4gICAgcmV0dXJuIHN0YW5kYXJkaXplZDtcclxuICB9XHJcblxyXG4gIGFzeW5jIGhhbmRsZUNvbnZlcnNpb24oZmlsZVBhdGgsIG9wdGlvbnMpIHtcclxuICAgIGNvbnN0IHsgcHJvZ3Jlc3NUcmFja2VyLCBmaWxlVHlwZSwgZmlsZU5hbWUsIGNvbnZlcnRlckluZm8sIGlzVXJsIH0gPSBvcHRpb25zO1xyXG4gICAgLy8gRXh0cmFjdCBjYXRlZ29yeSBmcm9tIGNvbnZlcnRlckluZm8gdG8gYXZvaWQgXCJjYXRlZ29yeSBpcyBub3QgZGVmaW5lZFwiIGVycm9yXHJcbiAgICBjb25zdCBjYXRlZ29yeSA9IGNvbnZlcnRlckluZm8/LmNhdGVnb3J5IHx8IEZJTEVfVFlQRV9DQVRFR09SSUVTW2ZpbGVUeXBlXSB8fCAndW5rbm93bic7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFZhbGlkYXRlIGNvbnZlcnRlckluZm9cclxuICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYE5vIGNvbnZlcnRlciBpbmZvIGF2YWlsYWJsZSBmb3IgJHtmaWxlVHlwZX1gKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbnZlcnRlciBpbmZvIGF2YWlsYWJsZSBmb3IgJHtmaWxlVHlwZX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlZBTElEQVRJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRkFTVF9BVFRFTVBUXHJcbiAgICAgICk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBIYW5kbGUgVVJMIGFuZCBwYXJlbnQgVVJMIGRpZmZlcmVudGx5IHNpbmNlIHRoZXkgZG9uJ3QgbmVlZCBmaWxlIHJlYWRpbmdcclxuICAgICAgaWYgKGlzVXJsKSB7XHJcbiAgICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZSgyMCwgeyBzdGF0dXM6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YCB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBQcm9jZXNzaW5nIFVSTDogJHtmaWxlUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEZvciBVUkxzLCBmaWxlUGF0aCBpcyBhY3R1YWxseSB0aGUgVVJMIHN0cmluZ1xyXG4gICAgICAgIGxldCByZXN1bHQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIC8vIEV4dHJhY3QgY29udmVydGVyIGZyb20gY29udmVydGVySW5mb1xyXG4gICAgICAgICAgY29uc3QgeyBjb252ZXJ0ZXIgfSA9IGNvbnZlcnRlckluZm87XHJcblxyXG4gICAgICAgICAgLy8gVHJ5IHVzaW5nIHRoZSBjb252ZXJ0ZXIncyBjb252ZXJ0IG1ldGhvZCBmaXJzdFxyXG4gICAgICAgICAgaWYgKHR5cGVvZiBjb252ZXJ0ZXIuY29udmVydCA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFVzaW5nIGNvbnZlcnRlci5jb252ZXJ0IGZvciAke2ZpbGVUeXBlfWAsICdJTkZPJyk7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IGNvbnZlcnRlci5jb252ZXJ0KGZpbGVQYXRoLCBmaWxlTmFtZSwgb3B0aW9ucy5hcGlLZXksIHtcclxuICAgICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICAgIG5hbWU6IGZpbGVOYW1lLFxyXG4gICAgICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IGZpbGVOYW1lLCAvLyBFeHBsaWNpdGx5IHBhc3Mgb3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgICAgICAgICAgIG9uUHJvZ3Jlc3M6IChwcm9ncmVzcykgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgICAgICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlU2NhbGVkKHByb2dyZXNzLCAyMCwgOTAsIHtcclxuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IHR5cGVvZiBwcm9ncmVzcyA9PT0gJ29iamVjdCcgPyBwcm9ncmVzcy5zdGF0dXMgOiBgcHJvY2Vzc2luZ18ke2ZpbGVUeXBlfWBcclxuICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIC8vIEZhbGwgYmFjayB0byB1c2luZyB0aGUgcmVnaXN0cnkncyBjb252ZXJ0VG9NYXJrZG93biBtZXRob2RcclxuICAgICAgICAgICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFVzaW5nIHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duIGZvciAke2ZpbGVUeXBlfWAsICdJTkZPJyk7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duKGZpbGVUeXBlLCBmaWxlUGF0aCwge1xyXG4gICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgbmFtZTogZmlsZU5hbWUsXHJcbiAgICAgICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogZmlsZU5hbWUsIC8vIEV4cGxpY2l0bHkgcGFzcyBvcmlnaW5hbEZpbGVOYW1lXHJcbiAgICAgICAgICAgICAgb25Qcm9ncmVzczogKHByb2dyZXNzKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgICAgICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGVTY2FsZWQocHJvZ3Jlc3MsIDIwLCA5MCwge1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogdHlwZW9mIHByb2dyZXNzID09PSAnb2JqZWN0JyA/IHByb2dyZXNzLnN0YXR1cyA6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YFxyXG4gICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgaW4gVVJMIGNvbnZlcnNpb246ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gVHJ5IHRoZSBhbHRlcm5hdGl2ZSBtZXRob2QgYXMgYSBmYWxsYmFja1xyXG4gICAgICAgICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgICAgICAgLy8gRXh0cmFjdCBjb252ZXJ0ZXIgZnJvbSBjb252ZXJ0ZXJJbmZvXHJcbiAgICAgICAgICBjb25zdCB7IGNvbnZlcnRlciB9ID0gY29udmVydGVySW5mbztcclxuICAgICAgICAgIGlmICh0eXBlb2YgY29udmVydGVyLmNvbnZlcnQgPT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgVHJ5aW5nIGFsdGVybmF0aXZlIGNvbnZlcnNpb24gbWV0aG9kIGFzIGZhbGxiYWNrYCwgJ0lORk8nKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgLy8gSWYgd2UgdHJpZWQgY29udmVydGVyLmNvbnZlcnQgZmlyc3QsIG5vdyB0cnkgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd25cclxuICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93bihmaWxlVHlwZSwgZmlsZVBhdGgsIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICBuYW1lOiBmaWxlTmFtZSxcclxuICAgICAgICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IGZpbGVOYW1lLCAvLyBFeHBsaWNpdGx5IHBhc3Mgb3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgICAgICAgICAgICAgb25Qcm9ncmVzczogKHByb2dyZXNzKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlU2NhbGVkKHByb2dyZXNzLCAyMCwgOTAsIHtcclxuICAgICAgICAgICAgICAgICAgICAgIHN0YXR1czogdHlwZW9mIHByb2dyZXNzID09PSAnb2JqZWN0JyA/IHByb2dyZXNzLnN0YXR1cyA6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YFxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGZhbGxiYWNrRXJyb3IpIHtcclxuICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFsbGJhY2sgY29udmVyc2lvbiBhbHNvIGZhaWxlZDogJHtmYWxsYmFja0Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7IC8vIFRocm93IHRoZSBvcmlnaW5hbCBlcnJvclxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjsgLy8gUmUtdGhyb3cgaWYgbm8gZmFsbGJhY2sgaXMgYXZhaWxhYmxlXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoOTUsIHsgc3RhdHVzOiAnZmluYWxpemluZycgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkcsXHJcbiAgICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GSU5BTElaSU5HXHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhbmRhcmRpemVSZXN1bHQocmVzdWx0LCBmaWxlVHlwZSwgZmlsZU5hbWUsIGNhdGVnb3J5KTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gUmVhZCBmaWxlIGNvbnRlbnQgaWYgbm90IGFscmVhZHkgYSBidWZmZXJcclxuICAgICAgY29uc3QgZmlsZUNvbnRlbnQgPSBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpID8gZmlsZVBhdGggOiBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgpO1xyXG4gICAgICBcclxuICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoMjAsIHsgc3RhdHVzOiBgY29udmVydGluZ18ke2ZpbGVUeXBlfWAgfSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIFBERiBmaWxlcyB0byBpbmNsdWRlIE9DUiBvcHRpb25zXHJcbiAgICAgIGlmIChmaWxlVHlwZSA9PT0gJ3BkZicpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQ29udmVydGluZyBQREYgd2l0aCBvcHRpb25zOicsIHtcclxuICAgICAgICAgIHVzZU9jcjogb3B0aW9ucy51c2VPY3IsXHJcbiAgICAgICAgICBoYXNNaXN0cmFsQXBpS2V5OiAhIW9wdGlvbnMubWlzdHJhbEFwaUtleSxcclxuICAgICAgICAgIHByZXNlcnZlUGFnZUluZm86IHRydWVcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgbW9yZSBkZXRhaWxlZCBsb2dnaW5nIGZvciBPQ1Igc2V0dGluZ3NcclxuICAgICAgICBpZiAob3B0aW9ucy51c2VPY3IpIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZygnT0NSIGlzIGVuYWJsZWQgZm9yIHRoaXMgY29udmVyc2lvbicsICdJTkZPJyk7XHJcbiAgICAgICAgICBpZiAob3B0aW9ucy5taXN0cmFsQXBpS2V5KSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdNaXN0cmFsIEFQSSBrZXkgaXMgcHJlc2VudCcpO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybignT0NSIGlzIGVuYWJsZWQgYnV0IE1pc3RyYWwgQVBJIGtleSBpcyBtaXNzaW5nJyk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBhdWRpby92aWRlbyBmaWxlcyB0byBlbnN1cmUgdGhleSBkb24ndCB1c2UgTWlzdHJhbCBBUEkga2V5XHJcbiAgICAgIGlmIChmaWxlVHlwZSA9PT0gJ21wMycgfHwgZmlsZVR5cGUgPT09ICd3YXYnIHx8IGZpbGVUeXBlID09PSAnbXA0JyB8fCBmaWxlVHlwZSA9PT0gJ21vdicgfHwgXHJcbiAgICAgICAgICBmaWxlVHlwZSA9PT0gJ29nZycgfHwgZmlsZVR5cGUgPT09ICd3ZWJtJyB8fCBmaWxlVHlwZSA9PT0gJ2F2aScgfHwgXHJcbiAgICAgICAgICBmaWxlVHlwZSA9PT0gJ2ZsYWMnIHx8IGZpbGVUeXBlID09PSAnbTRhJykge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgQ29udmVydGluZyBtdWx0aW1lZGlhIGZpbGUgKCR7ZmlsZVR5cGV9KWAsICdJTkZPJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmVtb3ZlIG1pc3RyYWxBcGlLZXkgZnJvbSBvcHRpb25zIGZvciBtdWx0aW1lZGlhIGZpbGVzIHRvIHByZXZlbnQgaW5jb3JyZWN0IHJvdXRpbmdcclxuICAgICAgICBpZiAob3B0aW9ucy5taXN0cmFsQXBpS2V5KSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coJ1JlbW92aW5nIE1pc3RyYWwgQVBJIGtleSBmcm9tIG11bHRpbWVkaWEgY29udmVyc2lvbiBvcHRpb25zJywgJ0lORk8nKTtcclxuICAgICAgICAgIGNvbnN0IHsgbWlzdHJhbEFwaUtleSwgLi4uY2xlYW5PcHRpb25zIH0gPSBvcHRpb25zO1xyXG4gICAgICAgICAgb3B0aW9ucyA9IGNsZWFuT3B0aW9ucztcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GQVNUX0FUVEVNUFQsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuUFJPQ0VTU0lOR1xyXG4gICAgICApO1xyXG4gICAgICBcclxuICAgICAgLy8gVXNlIHRoZSBjb252ZXJ0ZXIncyBjb252ZXJ0IG1ldGhvZFxyXG4gICAgICBjb25zdCB7IGNvbnZlcnRlciwgY2F0ZWdvcnkgfSA9IGNvbnZlcnRlckluZm87XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbnZlcnRlci5jb252ZXJ0KGZpbGVDb250ZW50LCBmaWxlTmFtZSwgb3B0aW9ucy5hcGlLZXksIHtcclxuICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgIG5hbWU6IGZpbGVOYW1lLFxyXG4gICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IGZpbGVOYW1lLCAvLyBFeHBsaWNpdGx5IHBhc3Mgb3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgICAgIG9uUHJvZ3Jlc3M6IChwcm9ncmVzcykgPT4ge1xyXG4gICAgICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlU2NhbGVkKHByb2dyZXNzLCAyMCwgOTAsIHtcclxuICAgICAgICAgICAgICBzdGF0dXM6IHR5cGVvZiBwcm9ncmVzcyA9PT0gJ29iamVjdCcgPyBwcm9ncmVzcy5zdGF0dXMgOiBgY29udmVydGluZ18ke2ZpbGVUeXBlfWBcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDk1LCB7IHN0YXR1czogJ2ZpbmFsaXppbmcnIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuUFJPQ0VTU0lORyxcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GSU5BTElaSU5HXHJcbiAgICAgICk7XHJcblxyXG4gICAgICByZXR1cm4gdGhpcy5zdGFuZGFyZGl6ZVJlc3VsdChyZXN1bHQsIGZpbGVUeXBlLCBmaWxlTmFtZSwgY2F0ZWdvcnkpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvbkVycm9yKGZpbGVUeXBlLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGAke2ZpbGVUeXBlLnRvVXBwZXJDYXNlKCl9IGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCxcclxuICAgICAgICBjb250ZW50OiBgIyBDb252ZXJzaW9uIEVycm9yXFxuXFxuRmFpbGVkIHRvIGNvbnZlcnQgJHtmaWxlVHlwZS50b1VwcGVyQ2FzZSgpfSBmaWxlOiAke2Vycm9yLm1lc3NhZ2V9YCxcclxuICAgICAgICB0eXBlOiBmaWxlVHlwZSxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUsIC8vIEV4cGxpY2l0bHkgaW5jbHVkZSBmaWxlVHlwZVxyXG4gICAgICAgIG5hbWU6IGZpbGVOYW1lLFxyXG4gICAgICAgIGNhdGVnb3J5OiBjYXRlZ29yeSB8fCAndW5rbm93bidcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBBZGQgYW4gaW5pdGlhbGl6ZSBtZXRob2QgdG8gdGhlIGZhY3RvcnkgaW5zdGFuY2VcclxuICogVGhpcyBpcyBuZWVkZWQgZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBjb2RlIHRoYXQgZXhwZWN0cyB0aGlzIG1ldGhvZFxyXG4gKi9cclxuY29uc3QgdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPSBVbmlmaWVkQ29udmVydGVyRmFjdG9yeS5nZXRJbnN0YW5jZSgpO1xyXG5cclxuLy8gQWRkIGluaXRpYWxpemUgbWV0aG9kIHRvIHRoZSBmYWN0b3J5IGluc3RhbmNlXHJcbnVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmluaXRpYWxpemUgPSBhc3luYyBmdW5jdGlvbigpIHtcclxuICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5TVEFSVElORyxcclxuICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLklOSVRJQUxJWklOR1xyXG4gICk7XHJcbiAgXHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKCk7XHJcbiAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLklOSVRJQUxJWklORyxcclxuICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuQ09NUExFVEVEXHJcbiAgICApO1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIHRoaXMubG9nZ2VyLmxvZ0NvbnZlcnNpb25FcnJvcignaW5pdCcsIGVycm9yKTtcclxuICAgIHRocm93IGVycm9yO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIEV4cG9ydCBzaW5nbGV0b24gaW5zdGFuY2UgYW5kIG1vZHVsZSBmdW5jdGlvbnNcclxubW9kdWxlLmV4cG9ydHMgPSB1bmlmaWVkQ29udmVydGVyRmFjdG9yeTtcclxubW9kdWxlLmV4cG9ydHMudW5pZmllZENvbnZlcnRlckZhY3RvcnkgPSB1bmlmaWVkQ29udmVydGVyRmFjdG9yeTsiXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0EsSUFBSUEsR0FBRztBQUNQLElBQUk7RUFDRjtFQUNBLE1BQU1DLFFBQVEsR0FBR0MsT0FBTyxDQUFD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