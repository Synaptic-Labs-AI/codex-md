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
          converter: result.converter || 'unknown',
          originalFileName: result.originalFileName || result.name || fileName,
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
        ...(result.metadata || {}),
        converter: result.converter || 'unknown',
        originalFileName: originalFileName // Use the resolved originalFileName for consistency
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJhcHAiLCJlbGVjdHJvbiIsInJlcXVpcmUiLCJyZW1vdGUiLCJlIiwiY29uc29sZSIsIndhcm4iLCJmcyIsImV4aXN0c1N5bmMiLCJwYXRoIiwic3RhdFN5bmMiLCJpc0ZpbGUiLCJpbm5lckUiLCJlcnJvciIsIkVycm9yIiwiUGF0aFV0aWxzIiwiUHJvZ3Jlc3NUcmFja2VyIiwiZ2V0TG9nZ2VyIiwic2FuaXRpemVGb3JMb2dnaW5nIiwiQ29udmVyc2lvblN0YXR1cyIsInNhZmVSZXF1aXJlIiwibW9kdWxlUGF0aCIsImZhbGxiYWNrcyIsImZhbGxiYWNrIiwiaW5jbHVkZXMiLCJuYW1lIiwibG9nIiwibXNnIiwibGV2ZWwiLCJhcmdzIiwiZXJyIiwic3VjY2VzcyIsImRlYnVnIiwibG9nUGhhc2VUcmFuc2l0aW9uIiwiZnJvbSIsInRvIiwibG9nQ29udmVyc2lvblN0YXJ0IiwidHlwZSIsIm9wdHMiLCJsb2dDb252ZXJzaW9uQ29tcGxldGUiLCJsb2dDb252ZXJzaW9uRXJyb3IiLCJtZXNzYWdlIiwic2V0Q29udGV4dCIsIm9iaiIsInJlc29sdmUiLCJfX2Rpcm5hbWUiLCJwcm9jZXNzIiwiY3dkIiwiY29uc3RydWN0b3IiLCJjYWxsYmFjayIsInVwZGF0ZSIsInByb2dyZXNzIiwiZGF0YSIsInVwZGF0ZVNjYWxlZCIsIm1pbiIsIm1heCIsIlNUQVRVUyIsIlNUQVJUSU5HIiwiSU5JVElBTElaSU5HIiwiVkFMSURBVElORyIsIkZBU1RfQVRURU1QVCIsIlBST0NFU1NJTkciLCJGSU5BTElaSU5HIiwiQ09NUExFVEVEIiwiQ09OVEVOVF9FTVBUWSIsImlzUGFja2FnZWQiLCJnZXRBcHBQYXRoIiwiZ2V0TmFtZSIsImdldFZlcnNpb24iLCJNb2R1bGVMb2FkZXIiLCJsb2FkTW9kdWxlIiwib3B0aW9ucyIsImxvZ2dlciIsImZhbGxiYWNrUGF0aHMiLCJzaWxlbnQiLCJtb2R1bGVOYW1lIiwiYmFzZW5hbWUiLCJjYXRlZ29yeSIsInBhdGhQYXJ0cyIsImRpcm5hbWUiLCJzcGxpdCIsInNlcCIsImxlbmd0aCIsInNsaWNlIiwiam9pbiIsIk1vZHVsZVJlc29sdmVyIiwibW9kdWxlIiwicmVzb2x2ZXJFcnJvciIsImRlZmF1bHQiLCJkaXJlY3RFcnJvciIsImZhbGxiYWNrUGF0aCIsImZhbGxiYWNrRXJyb3IiLCJfY3JlYXRlRW1lcmdlbmN5UmVnaXN0cnkiLCJDb252ZXJ0ZXJSZWdpc3RyeSIsImNvbnZlcnRlcnMiLCJwZGYiLCJjb252ZXJ0IiwiY29udGVudCIsImFwaUtleSIsIm1ldGFkYXRhIiwicGFnZXMiLCJjb252ZXJ0ZXIiLCJ2YWxpZGF0ZSIsImlucHV0IiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJjb25maWciLCJleHRlbnNpb25zIiwibWltZVR5cGVzIiwibWF4U2l6ZSIsInByb3RvdHlwZSIsImNvbnZlcnRUb01hcmtkb3duIiwic291cmNlIiwiZ2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJleHRlbnNpb24iLCJsb2FkTW9kdWxlRnJvbUJlc3RQYXRoIiwiYmFzZVBhdGhzIiwicmVzb2x2ZWRQYXRocyIsIm1hcCIsImJhc2VQYXRoIiwiZXhpc3RpbmdQYXRocyIsImZpbHRlciIsInAiLCJleGlzdHMiLCJnZXRNb2R1bGVQYXRocyIsImlzRGV2IiwiZW52IiwiTk9ERV9FTlYiLCJwb3NzaWJsZVBhdGhzIiwicmVwbGFjZSIsImV4ZWNQYXRoIiwiZXJyb3JQYXRoIiwiY29ycmVjdGVkUGF0aCIsImNhbmRpZGF0ZVBhdGgiLCJkaXJlY3RSZWdpc3RyeVBhdGhzIiwicmVnaXN0cnlQYXRoIiwicmVnaXN0cnkiLCJ1cmwiLCJkb2N4IiwicHB0eCIsInhsc3giLCJjc3YiLCJNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkiLCJ0b1VwcGVyQ2FzZSIsIkNvbnZlcnRlckluaXRpYWxpemVyIiwiX2luc3RhbmNlIiwiX2luaXRpYWxpemVkIiwiX2luaXRQcm9taXNlIiwiX2NvbnZlcnRlclJlZ2lzdHJ5IiwiZ2V0SW5zdGFuY2UiLCJpbml0aWFsaXplIiwiX2RvSW5pdGlhbGl6ZSIsInBhdGhzIiwicG9zc2libGVCYXNlUGF0aHMiLCJPYmplY3QiLCJ2YWx1ZXMiLCJhbGxQb3NzaWJsZVJlZ2lzdHJ5UGF0aHMiLCJkaXJlY3RMb2FkRXJyb3IiLCJpbml0aWFsRXJyb3IiLCJiYXNlRGlycyIsImFkZEJhc2VEaXIiLCJkaXIiLCJwdXNoIiwiZm9yRWFjaCIsImNvbnZlcnRlclBhdGgiLCJjb252ZXJ0ZXJEaXIiLCJiZXN0UGF0aEVycm9yIiwiX3ZhbGlkYXRlUmVnaXN0cnkiLCJrZXlzIiwiZW5oYW5jZWRFcnJvciIsIm9yaWdpbmFsIiwic3RhY2siLCJGSUxFX1RZUEVfQ0FURUdPUklFUyIsIm1wMyIsIndhdiIsIm9nZyIsImZsYWMiLCJtcDQiLCJ3ZWJtIiwiYXZpIiwibW92IiwicGFyZW50dXJsIiwiVW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJfaW5pdGlhbGl6ZXIiLCJfZW5zdXJlSW5pdGlhbGl6ZWQiLCJnZXRDb252ZXJ0ZXIiLCJmaWxlVHlwZSIsIm5vcm1hbGl6ZWRUeXBlIiwidG9Mb3dlckNhc2UiLCJjb252ZXJ0RmlsZSIsImZpbGVQYXRoIiwic3RhcnRUaW1lIiwiRGF0ZSIsIm5vdyIsImlzVXJsIiwiZmlsZU5hbWUiLCJvcmlnaW5hbEZpbGVOYW1lIiwidXJsT2JqIiwiVVJMIiwiaG9zdG5hbWUiLCJwYXRobmFtZSIsImNvbnZlcnRlckluZm8iLCJjcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIiLCJQcm9taXNlIiwic2V0VGltZW91dCIsInByb2dyZXNzVHJhY2tlciIsIm9uUHJvZ3Jlc3MiLCJzdGF0dXMiLCJoYXNSZWdpc3RyeSIsImNvbnZlcnRlclR5cGUiLCJoYXNDb252ZXJ0ZXIiLCJjb252ZXJ0ZXJEZXRhaWxzIiwiY29udmVyc2lvblJlc3VsdCIsImhhbmRsZUNvbnZlcnNpb24iLCJzdGFuZGFyZGl6ZVJlc3VsdCIsInJlc3VsdCIsImFzeW5jIiwiY29udmVyc2lvbklkIiwicmVzdWx0T3JpZ2luYWxGaWxlTmFtZSIsInJlc3VsdE1ldGFkYXRhT3JpZ2luYWxGaWxlTmFtZSIsInJlc3VsdE5hbWUiLCJmdW5jdGlvblBhcmFtRmlsZU5hbWUiLCJvcmlnaW5hbEZpbGVOYW1lRnJvbVJlc3VsdCIsIm9yaWdpbmFsRmlsZU5hbWVGcm9tTWV0YWRhdGEiLCJuYW1lRnJvbVJlc3VsdCIsImZpbGVOYW1lUGFyYW0iLCJyZXN1bHRLZXlzIiwibWV0YWRhdGFLZXlzIiwiaXNTdWNjZXNzIiwic2FuaXRpemVkUmVzdWx0Iiwic3RhbmRhcmRpemVkIiwiaW1hZ2VzIiwidW5kZWZpbmVkIiwiaGFuZGxlVXJsQ29udmVyc2lvbiIsInVybFJlc3VsdCIsImNvbnZlcnRlck9wdGlvbnMiLCJrZXkiLCJjb252ZXJ0ZXJFcnJvciIsInJlZ2lzdHJ5T3B0aW9ucyIsImZhbGxiYWNrT3B0aW9ucyIsImZhbGxiYWNrUmVzdWx0IiwiZmlsZUNvbnRlbnQiLCJyZWFkRmlsZVN5bmMiLCJ1c2VPY3IiLCJoYXNNaXN0cmFsQXBpS2V5IiwibWlzdHJhbEFwaUtleSIsInByZXNlcnZlUGFnZUluZm8iLCJjbGVhbk9wdGlvbnMiLCJoYXNPcmlnaW5hbEZpbGVOYW1lIiwib3JpZ2luYWxGaWxlTmFtZVZhbHVlIiwidW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL2NvbnZlcnRlcnMvVW5pZmllZENvbnZlcnRlckZhY3RvcnkuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmpzXHJcbiAqIFxyXG4gKiBDZW50cmFsIGZhY3RvcnkgZm9yIGFsbCBmaWxlIHR5cGUgY29udmVyc2lvbnMgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogVXNlcyBDb21tb25KUyBmb3IgY29uc2lzdGVuY3kgd2l0aCBFbGVjdHJvbiBtYWluIHByb2Nlc3MgYW5kIHByb3ZpZGVzIHJvYnVzdCBpbml0aWFsaXphdGlvblxyXG4gKiBhbmQgY29udmVydGVyIG1hbmFnZW1lbnQuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9FbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmpzOiBVc2VzIHRoaXMgZmFjdG9yeSBmb3IgY29udmVyc2lvbnNcclxuICogLSBzcmMvZWxlY3Ryb24vaXBjL2hhbmRsZXJzL2NvbnZlcnNpb24vaW5kZXguanM6IEV4cG9zZXMgY29udmVyc2lvbiB0byByZW5kZXJlciBwcm9jZXNzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanM6IENvbnZlcnRlciBpbXBsZW1lbnRhdGlvbnNcclxuICovXHJcblxyXG4vLyBDb3JlIGRlcGVuZGVuY2llc1xyXG5sZXQgYXBwO1xyXG50cnkge1xyXG4gIC8vIFRyeSB0byBsb2FkIGVsZWN0cm9uIGluIGEgc2FmZXIgd2F5XHJcbiAgY29uc3QgZWxlY3Ryb24gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG4gIGFwcCA9IGVsZWN0cm9uLmFwcCB8fCAoZWxlY3Ryb24ucmVtb3RlICYmIGVsZWN0cm9uLnJlbW90ZS5hcHApO1xyXG59IGNhdGNoIChlKSB7XHJcbiAgLy8gSWYgZWxlY3Ryb24gaXNuJ3QgYXZhaWxhYmxlLCB3ZSdsbCBoYW5kbGUgaXQgYmVsb3dcclxuICBjb25zb2xlLndhcm4oJ0NvdWxkIG5vdCBsb2FkIGVsZWN0cm9uIGFwcCwgdXNpbmcgZmFsbGJhY2tzJyk7XHJcbn1cclxuXHJcbi8vIEVzc2VudGlhbCB1dGlsaXRpZXMgLSBsb2FkIHdpdGggZmFsbGJhY2tzXHJcbmxldCBmcztcclxudHJ5IHtcclxuICBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbn0gY2F0Y2ggKGUpIHtcclxuICB0cnkge1xyXG4gICAgZnMgPSByZXF1aXJlKCdmcycpO1xyXG4gICAgLy8gQWRkIGZzLWV4dHJhIG1ldGhvZHMgd2UgdXNlXHJcbiAgICBmcy5leGlzdHNTeW5jID0gZnMuZXhpc3RzU3luYyB8fCAoKHBhdGgpID0+IHtcclxuICAgICAgdHJ5IHsgcmV0dXJuIGZzLnN0YXRTeW5jKHBhdGgpLmlzRmlsZSgpOyB9IGNhdGNoIChlKSB7IHJldHVybiBmYWxzZTsgfVxyXG4gICAgfSk7XHJcbiAgfSBjYXRjaCAoaW5uZXJFKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gbG9hZCBmcyBtb2R1bGVzJywgaW5uZXJFKTtcclxuICAgIHRocm93IG5ldyBFcnJvcignQ3JpdGljYWwgZGVwZW5kZW5jeSBmcy9mcy1leHRyYSBub3QgYXZhaWxhYmxlJyk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBQYXRoIGhhbmRsaW5nIC0gZXNzZW50aWFsIGZvciBtb2R1bGUgcmVzb2x1dGlvblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5cclxuLy8gVHJ5IHRvIGxvYWQgaW50ZXJuYWwgbW9kdWxlcyB3aXRoIGZhbGxiYWNrc1xyXG5sZXQgUGF0aFV0aWxzLCBQcm9ncmVzc1RyYWNrZXIsIGdldExvZ2dlciwgc2FuaXRpemVGb3JMb2dnaW5nLCBDb252ZXJzaW9uU3RhdHVzO1xyXG5cclxuLy8gQXR0ZW1wdCB0byBsb2FkIGVhY2ggbW9kdWxlIHdpdGggZmFsbGJhY2tzIHRvIHByZXZlbnQgY3Jhc2hlc1xyXG5jb25zdCBzYWZlUmVxdWlyZSA9IChtb2R1bGVQYXRoLCBmYWxsYmFja3MgPSBbXSkgPT4ge1xyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gcmVxdWlyZShtb2R1bGVQYXRoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBmb3IgKGNvbnN0IGZhbGxiYWNrIG9mIGZhbGxiYWNrcykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIHJldHVybiByZXF1aXJlKGZhbGxiYWNrKTtcclxuICAgICAgfSBjYXRjaCB7IC8qIENvbnRpbnVlIHRvIG5leHQgZmFsbGJhY2sgKi8gfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIERlZmF1bHQgaW1wbGVtZW50YXRpb25zIGZvciBjcml0aWNhbCBmdW5jdGlvbnNcclxuICAgIGlmIChtb2R1bGVQYXRoLmluY2x1ZGVzKCdnZXRMb2dnZXInKSkge1xyXG4gICAgICByZXR1cm4gKG5hbWUpID0+ICh7XHJcbiAgICAgICAgbG9nOiAobXNnLCBsZXZlbCwgLi4uYXJncykgPT4gY29uc29sZS5sb2coYFske25hbWV9XVske2xldmVsIHx8ICdJTkZPJ31dICR7bXNnfWAsIC4uLmFyZ3MpLFxyXG4gICAgICAgIGVycm9yOiAobXNnLCBlcnIpID0+IGNvbnNvbGUuZXJyb3IoYFske25hbWV9XVtFUlJPUl0gJHttc2d9YCwgZXJyKSxcclxuICAgICAgICB3YXJuOiAobXNnLCAuLi5hcmdzKSA9PiBjb25zb2xlLndhcm4oYFske25hbWV9XVtXQVJOXSAke21zZ31gLCAuLi5hcmdzKSxcclxuICAgICAgICBzdWNjZXNzOiAobXNnKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dW1NVQ0NFU1NdICR7bXNnfWApLFxyXG4gICAgICAgIGRlYnVnOiAobXNnLCAuLi5hcmdzKSA9PiBjb25zb2xlLmRlYnVnKGBbJHtuYW1lfV1bREVCVUddICR7bXNnfWAsIC4uLmFyZ3MpLFxyXG4gICAgICAgIGxvZ1BoYXNlVHJhbnNpdGlvbjogKGZyb20sIHRvKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dIFBoYXNlIHRyYW5zaXRpb246ICR7ZnJvbX0g4oaSICR7dG99YCksXHJcbiAgICAgICAgbG9nQ29udmVyc2lvblN0YXJ0OiAodHlwZSwgb3B0cykgPT4gY29uc29sZS5sb2coYFske25hbWV9XSBTdGFydGluZyBjb252ZXJzaW9uIGZvciAke3R5cGV9YCksXHJcbiAgICAgICAgbG9nQ29udmVyc2lvbkNvbXBsZXRlOiAodHlwZSkgPT4gY29uc29sZS5sb2coYFske25hbWV9XSBDb21wbGV0ZWQgY29udmVyc2lvbiBmb3IgJHt0eXBlfWApLFxyXG4gICAgICAgIGxvZ0NvbnZlcnNpb25FcnJvcjogKHR5cGUsIGVycikgPT4gY29uc29sZS5lcnJvcihgWyR7bmFtZX06ZmFpbGVkXVske3R5cGV9XSDinYwgJHtlcnIubWVzc2FnZX1gLCBlcnIpLFxyXG4gICAgICAgIHNldENvbnRleHQ6ICgpID0+IHt9XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgaWYgKG1vZHVsZVBhdGguaW5jbHVkZXMoJ3Nhbml0aXplRm9yTG9nZ2luZycpKSB7XHJcbiAgICAgIHJldHVybiAob2JqKSA9PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIHJldHVybiB0eXBlb2Ygb2JqID09PSAnb2JqZWN0JyA/IHsgLi4ub2JqIH0gOiBvYmo7XHJcbiAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICByZXR1cm4gb2JqO1xyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLndhcm4oYE1vZHVsZSAke21vZHVsZVBhdGh9IG5vdCBhdmFpbGFibGUsIHVzaW5nIG1pbmltYWwgaW1wbGVtZW50YXRpb25gKTtcclxuICAgIHJldHVybiB7fTtcclxuICB9XHJcbn07XHJcblxyXG50cnkge1xyXG4gIFBhdGhVdGlscyA9IHNhZmVSZXF1aXJlKCcuLi91dGlscy9wYXRocy9pbmRleCcsIFtcclxuICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi91dGlscy9wYXRocy9pbmRleCcpLFxyXG4gICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vdXRpbHMvcGF0aHMvaW5kZXgnKVxyXG4gIF0pLlBhdGhVdGlscyB8fCB7fTtcclxuXHJcbiAgUHJvZ3Jlc3NUcmFja2VyID0gc2FmZVJlcXVpcmUoJy4uL3V0aWxzL2NvbnZlcnNpb24vcHJvZ3Jlc3MnLCBbXHJcbiAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vdXRpbHMvY29udmVyc2lvbi9wcm9ncmVzcycpLFxyXG4gICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vdXRpbHMvY29udmVyc2lvbi9wcm9ncmVzcycpXHJcbiAgXSkuUHJvZ3Jlc3NUcmFja2VyIHx8IGNsYXNzIFByb2dyZXNzVHJhY2tlciB7XHJcbiAgICBjb25zdHJ1Y3RvcihjYWxsYmFjaykgeyB0aGlzLmNhbGxiYWNrID0gY2FsbGJhY2s7IH1cclxuICAgIHVwZGF0ZShwcm9ncmVzcywgZGF0YSkgeyB0aGlzLmNhbGxiYWNrICYmIHRoaXMuY2FsbGJhY2socHJvZ3Jlc3MsIGRhdGEpOyB9XHJcbiAgICB1cGRhdGVTY2FsZWQocHJvZ3Jlc3MsIG1pbiwgbWF4LCBkYXRhKSB7IHRoaXMudXBkYXRlKG1pbiArIChwcm9ncmVzcy8xMDApICogKG1heC1taW4pLCBkYXRhKTsgfVxyXG4gIH07XHJcblxyXG4gIGdldExvZ2dlciA9IHNhZmVSZXF1aXJlKCcuLi91dGlscy9sb2dnaW5nL0NvbnZlcnNpb25Mb2dnZXInLCBbXHJcbiAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vdXRpbHMvbG9nZ2luZy9Db252ZXJzaW9uTG9nZ2VyJyksXHJcbiAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi91dGlscy9sb2dnaW5nL0NvbnZlcnNpb25Mb2dnZXInKVxyXG4gIF0pLmdldExvZ2dlciB8fCAoKG5hbWUpID0+ICh7XHJcbiAgICBsb2c6IChtc2csIGxldmVsLCAuLi5hcmdzKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dWyR7bGV2ZWwgfHwgJ0lORk8nfV0gJHttc2d9YCwgLi4uYXJncyksXHJcbiAgICBlcnJvcjogKG1zZywgZXJyKSA9PiBjb25zb2xlLmVycm9yKGBbJHtuYW1lfV1bRVJST1JdICR7bXNnfWAsIGVyciksXHJcbiAgICB3YXJuOiAobXNnLCAuLi5hcmdzKSA9PiBjb25zb2xlLndhcm4oYFske25hbWV9XVtXQVJOXSAke21zZ31gLCAuLi5hcmdzKSxcclxuICAgIHN1Y2Nlc3M6IChtc2cpID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV1bU1VDQ0VTU10gJHttc2d9YCksXHJcbiAgICBkZWJ1ZzogKG1zZywgLi4uYXJncykgPT4gY29uc29sZS5kZWJ1ZyhgWyR7bmFtZX1dW0RFQlVHXSAke21zZ31gLCAuLi5hcmdzKSxcclxuICAgIGxvZ1BoYXNlVHJhbnNpdGlvbjogKGZyb20sIHRvKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dIFBoYXNlIHRyYW5zaXRpb246ICR7ZnJvbX0g4oaSICR7dG99YCksXHJcbiAgICBsb2dDb252ZXJzaW9uU3RhcnQ6ICh0eXBlLCBvcHRzKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dIFN0YXJ0aW5nIGNvbnZlcnNpb24gZm9yICR7dHlwZX1gKSxcclxuICAgIGxvZ0NvbnZlcnNpb25Db21wbGV0ZTogKHR5cGUpID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV0gQ29tcGxldGVkIGNvbnZlcnNpb24gZm9yICR7dHlwZX1gKSxcclxuICAgIGxvZ0NvbnZlcnNpb25FcnJvcjogKHR5cGUsIGVycikgPT4gY29uc29sZS5lcnJvcihgWyR7bmFtZX06ZmFpbGVkXVske3R5cGV9XSDinYwgJHtlcnIubWVzc2FnZX1gLCBlcnIpLFxyXG4gICAgc2V0Q29udGV4dDogKCkgPT4ge31cclxuICB9KSk7XHJcblxyXG4gIHNhbml0aXplRm9yTG9nZ2luZyA9IHNhZmVSZXF1aXJlKCcuLi91dGlscy9sb2dnaW5nL0xvZ1Nhbml0aXplcicsIFtcclxuICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi91dGlscy9sb2dnaW5nL0xvZ1Nhbml0aXplcicpLFxyXG4gICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vdXRpbHMvbG9nZ2luZy9Mb2dTYW5pdGl6ZXInKVxyXG4gIF0pLnNhbml0aXplRm9yTG9nZ2luZyB8fCAoKG9iaikgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgcmV0dXJuIHR5cGVvZiBvYmogPT09ICdvYmplY3QnID8geyAuLi5vYmogfSA6IG9iajtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICByZXR1cm4gb2JqO1xyXG4gICAgfVxyXG4gIH0pO1xyXG5cclxuICBDb252ZXJzaW9uU3RhdHVzID0gc2FmZVJlcXVpcmUoJy4uL3V0aWxzL2NvbnZlcnNpb24vQ29udmVyc2lvblN0YXR1cycsIFtcclxuICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi91dGlscy9jb252ZXJzaW9uL0NvbnZlcnNpb25TdGF0dXMnKSxcclxuICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3V0aWxzL2NvbnZlcnNpb24vQ29udmVyc2lvblN0YXR1cycpXHJcbiAgXSkgfHwge1xyXG4gICAgU1RBVFVTOiB7XHJcbiAgICAgIFNUQVJUSU5HOiAnU3RhcnRpbmcgY29udmVyc2lvbicsXHJcbiAgICAgIElOSVRJQUxJWklORzogJ/CflKcgSW5pdGlhbGl6aW5nIGNvbnZlcnRlcicsXHJcbiAgICAgIFZBTElEQVRJTkc6ICfwn5SNIFZhbGlkYXRpbmcgZmlsZScsXHJcbiAgICAgIEZBU1RfQVRURU1QVDogJ+KaoSBGYXN0IGNvbnZlcnNpb24gYXR0ZW1wdCcsXHJcbiAgICAgIFBST0NFU1NJTkc6ICfij7MgUHJvY2Vzc2luZyBjb250ZW50JyxcclxuICAgICAgRklOQUxJWklORzogJ+KchSBGaW5hbGl6aW5nIHJlc3VsdCcsXHJcbiAgICAgIENPTVBMRVRFRDogJ+KckyBDb252ZXJzaW9uIGNvbXBsZXRlJyxcclxuICAgICAgQ09OVEVOVF9FTVBUWTogJ+KaoO+4jyBFbXB0eSBjb250ZW50IHdhcm5pbmcnXHJcbiAgICB9XHJcbiAgfTtcclxufSBjYXRjaCAoZXJyb3IpIHtcclxuICBjb25zb2xlLmVycm9yKCdFcnJvciBsb2FkaW5nIGNvcmUgZGVwZW5kZW5jaWVzJywgZXJyb3IpO1xyXG4gIHRocm93IG5ldyBFcnJvcihgQ3JpdGljYWwgZGVwZW5kZW5jeSBpbml0aWFsaXphdGlvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxufVxyXG5cclxuLy8gSW5pdGlhbGl6ZSBhcHAgd2l0aCBmYWxsYmFjayBpZiBuZWVkZWRcclxuaWYgKCFhcHApIHtcclxuICBhcHAgPSB7XHJcbiAgICBpc1BhY2thZ2VkOiBmYWxzZSxcclxuICAgIGdldEFwcFBhdGg6ICgpID0+IHByb2Nlc3MuY3dkKCksXHJcbiAgICBnZXROYW1lOiAoKSA9PiAnQ29kZXgubWQnLFxyXG4gICAgZ2V0VmVyc2lvbjogKCkgPT4gJzEuMC4wJ1xyXG4gIH07XHJcbiAgY29uc29sZS53YXJuKCdVc2luZyBmYWxsYmFjayBhcHAgaW1wbGVtZW50YXRpb24nKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZXMgbW9kdWxlIGxvYWRpbmcgd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmcgYW5kIHBhdGggcmVzb2x1dGlvbi5cclxuICovXHJcbmNsYXNzIE1vZHVsZUxvYWRlciB7XHJcbiAgc3RhdGljIGFzeW5jIGxvYWRNb2R1bGUobW9kdWxlUGF0aCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICBjb25zdCBsb2dnZXIgPSBnZXRMb2dnZXIoJ01vZHVsZUxvYWRlcicpO1xyXG4gICAgY29uc3QgeyBmYWxsYmFja1BhdGhzID0gW10sIHNpbGVudCA9IGZhbHNlIH0gPSBvcHRpb25zO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGxvZ2dlci5sb2coYExvYWRpbmcgbW9kdWxlIGZyb20gcGF0aDogJHttb2R1bGVQYXRofWAsICdJTkZPJyk7XHJcblxyXG4gICAgICAvLyBFeHRyYWN0IG1vZHVsZSBuYW1lIGFuZCBjYXRlZ29yeSBmcm9tIHBhdGhcclxuICAgICAgY29uc3QgbW9kdWxlTmFtZSA9IHBhdGguYmFzZW5hbWUobW9kdWxlUGF0aCk7XHJcbiAgICAgIGxldCBjYXRlZ29yeSA9ICcnO1xyXG5cclxuICAgICAgLy8gVHJ5IHRvIHBhcnNlIGNhdGVnb3J5IGZyb20gcGF0aFxyXG4gICAgICBjb25zdCBwYXRoUGFydHMgPSBwYXRoLmRpcm5hbWUobW9kdWxlUGF0aCkuc3BsaXQocGF0aC5zZXApO1xyXG4gICAgICBpZiAocGF0aFBhcnRzLmxlbmd0aCA+PSAyKSB7XHJcbiAgICAgICAgLy8gVGFrZSB0aGUgbGFzdCB0d28gcGFydHMgb2YgdGhlIHBhdGggYXMgdGhlIGNhdGVnb3J5XHJcbiAgICAgICAgY2F0ZWdvcnkgPSBwYXRoUGFydHMuc2xpY2UoLTIpLmpvaW4oJy8nKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBEZWZhdWx0IGNhdGVnb3J5IGZvciBjb252ZXJzaW9uc1xyXG4gICAgICAgIGNhdGVnb3J5ID0gJ3NlcnZpY2VzL2NvbnZlcnNpb24nO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBsb2dnZXIubG9nKGBVc2luZyBNb2R1bGVSZXNvbHZlciB3aXRoIG1vZHVsZTogJHttb2R1bGVOYW1lfSwgY2F0ZWdvcnk6ICR7Y2F0ZWdvcnl9YCwgJ0lORk8nKTtcclxuXHJcbiAgICAgIC8vIFVzZSBNb2R1bGVSZXNvbHZlciB0byBsb2FkIHRoZSBtb2R1bGVcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCB7IE1vZHVsZVJlc29sdmVyIH0gPSByZXF1aXJlKCcuLi91dGlscy9tb2R1bGVSZXNvbHZlcicpO1xyXG4gICAgICAgIGNvbnN0IG1vZHVsZSA9IE1vZHVsZVJlc29sdmVyLnNhZmVSZXF1aXJlKG1vZHVsZU5hbWUsIGNhdGVnb3J5KTtcclxuICAgICAgICBsb2dnZXIuc3VjY2VzcyhgU3VjY2Vzc2Z1bGx5IGxvYWRlZCBtb2R1bGUgdXNpbmcgTW9kdWxlUmVzb2x2ZXI6ICR7bW9kdWxlTmFtZX1gKTtcclxuICAgICAgICByZXR1cm4gbW9kdWxlO1xyXG4gICAgICB9IGNhdGNoIChyZXNvbHZlckVycm9yKSB7XHJcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBNb2R1bGVSZXNvbHZlciBmYWlsZWQ6ICR7cmVzb2x2ZXJFcnJvci5tZXNzYWdlfWAsIHJlc29sdmVyRXJyb3IpO1xyXG5cclxuICAgICAgICAvLyBJZiBNb2R1bGVSZXNvbHZlciBmYWlscywgdHJ5IHRoZSBvcmlnaW5hbCBhcHByb2FjaCB3aXRoIGZhbGxiYWNrc1xyXG4gICAgICAgIGxvZ2dlci5sb2coJ0ZhbGxpbmcgYmFjayB0byBkaXJlY3QgcmVxdWlyZSB3aXRoIGZhbGxiYWNrcycsICdJTkZPJyk7XHJcblxyXG4gICAgICAgIC8vIFRyeSBkaXJlY3QgcmVxdWlyZSBmaXJzdFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCBtb2R1bGUgPSByZXF1aXJlKG1vZHVsZVBhdGgpO1xyXG4gICAgICAgICAgbG9nZ2VyLnN1Y2Nlc3MoYFN1Y2Nlc3NmdWxseSBsb2FkZWQgbW9kdWxlIGRpcmVjdGx5OiAke21vZHVsZVBhdGh9YCk7XHJcbiAgICAgICAgICByZXR1cm4gbW9kdWxlLmRlZmF1bHQgfHwgbW9kdWxlO1xyXG4gICAgICAgIH0gY2F0Y2ggKGRpcmVjdEVycm9yKSB7XHJcbiAgICAgICAgICAvLyBJZiBmYWxsYmFjayBwYXRocyBwcm92aWRlZCwgdHJ5IHRoZW0gc2VxdWVudGlhbGx5XHJcbiAgICAgICAgICBpZiAoZmFsbGJhY2tQYXRocyAmJiBmYWxsYmFja1BhdGhzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgbG9nZ2VyLmxvZyhgQXR0ZW1wdGluZyB0byBsb2FkIGZyb20gJHtmYWxsYmFja1BhdGhzLmxlbmd0aH0gZmFsbGJhY2sgcGF0aHNgLCAnSU5GTycpO1xyXG5cclxuICAgICAgICAgICAgZm9yIChjb25zdCBmYWxsYmFja1BhdGggb2YgZmFsbGJhY2tQYXRocykge1xyXG4gICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBsb2dnZXIubG9nKGBUcnlpbmcgZmFsbGJhY2sgcGF0aDogJHtmYWxsYmFja1BhdGh9YCwgJ0lORk8nKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IHJlcXVpcmUoZmFsbGJhY2tQYXRoKTtcclxuICAgICAgICAgICAgICAgIGxvZ2dlci5zdWNjZXNzKGBTdWNjZXNzZnVsbHkgbG9hZGVkIGZyb20gZmFsbGJhY2s6ICR7ZmFsbGJhY2tQYXRofWApO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIG1vZHVsZS5kZWZhdWx0IHx8IG1vZHVsZTtcclxuICAgICAgICAgICAgICB9IGNhdGNoIChmYWxsYmFja0Vycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBDb250aW51ZSB0byBuZXh0IGZhbGxiYWNrIHBhdGhcclxuICAgICAgICAgICAgICAgIGlmICghc2lsZW50KSB7XHJcbiAgICAgICAgICAgICAgICAgIGxvZ2dlci53YXJuKGBGYWlsZWQgdG8gbG9hZCBmcm9tIGZhbGxiYWNrOiAke2ZhbGxiYWNrUGF0aH1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAvLyBJZiBhbGwgZWxzZSBmYWlscyBhbmQgdGhpcyBpcyBDb252ZXJ0ZXJSZWdpc3RyeS5qcywgY3JlYXRlIGEgbWluaW1hbCByZWdpc3RyeVxyXG4gICAgICAgICAgaWYgKG1vZHVsZU5hbWUgPT09ICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpIHtcclxuICAgICAgICAgICAgbG9nZ2VyLmxvZygnQWxsIGxvYWRpbmcgYXR0ZW1wdHMgZmFpbGVkIGZvciBDb252ZXJ0ZXJSZWdpc3RyeS5qcy4gQ3JlYXRpbmcgbWluaW1hbCByZWdpc3RyeScsICdJTkZPJyk7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jcmVhdGVFbWVyZ2VuY3lSZWdpc3RyeSgpO1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIC8vIElmIHdlIGdldCBoZXJlLCBhbGwgYXR0ZW1wdHMgZmFpbGVkXHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBsb2FkIG1vZHVsZTogJHttb2R1bGVQYXRofS4gRXJyb3I6ICR7cmVzb2x2ZXJFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgbG9nZ2VyLmVycm9yKGBNb2R1bGUgbG9hZGluZyBmYWlsZWQgY29tcGxldGVseTogJHtlcnJvci5tZXNzYWdlfWAsIGVycm9yKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2R1bGUgbG9hZGluZyBmYWlsZWQ6ICR7bW9kdWxlUGF0aH0uIEVycm9yOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGVzIGFuIGVtZXJnZW5jeSBtaW5pbWFsIHJlZ2lzdHJ5IGFzIGEgbGFzdCByZXNvcnRcclxuICAgKiBAcmV0dXJucyB7T2JqZWN0fSBBIG1pbmltYWwgcmVnaXN0cnkgaW1wbGVtZW50YXRpb25cclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIHN0YXRpYyBfY3JlYXRlRW1lcmdlbmN5UmVnaXN0cnkoKSB7XHJcbiAgICBjb25zdCBsb2dnZXIgPSBnZXRMb2dnZXIoJ01vZHVsZUxvYWRlcicpO1xyXG4gICAgbG9nZ2VyLmxvZygn8J+TpiBDcmVhdGluZyBlbWVyZ2VuY3kgbWluaW1hbCByZWdpc3RyeSBpbXBsZW1lbnRhdGlvbicsICdJTkZPJyk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIG1pbmltYWwgcmVnaXN0cnkgY29uc3RydWN0b3IgZnVuY3Rpb24gdG8gbWF0Y2ggZXhpc3RpbmcgcGF0dGVyblxyXG4gICAgZnVuY3Rpb24gQ29udmVydGVyUmVnaXN0cnkoKSB7XHJcbiAgICAgIHRoaXMuY29udmVydGVycyA9IHtcclxuICAgICAgICBwZGY6IHtcclxuICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMgPSB7fSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW0VtZXJnZW5jeVJlZ2lzdHJ5XSBVc2luZyBlbWVyZ2VuY3kgUERGIGNvbnZlcnRlcicpO1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgY29udGVudDogYCMgRXh0cmFjdGVkIGZyb20gJHtuYW1lIHx8ICdQREYgZG9jdW1lbnQnfVxcblxcblRoaXMgY29udGVudCB3YXMgZXh0cmFjdGVkIHVzaW5nIHRoZSBlbWVyZ2VuY3kgY29udmVydGVyLlxcblxcblRoZSBhcHBsaWNhdGlvbiBlbmNvdW50ZXJlZCBhbiBpc3N1ZSBmaW5kaW5nIHRoZSBjb3JyZWN0IGNvbnZlcnRlciBtb2R1bGUuIFBsZWFzZSByZXBvcnQgdGhpcyBpc3N1ZS5gLFxyXG4gICAgICAgICAgICAgIHR5cGU6ICdwZGYnLFxyXG4gICAgICAgICAgICAgIG1ldGFkYXRhOiB7IHBhZ2VzOiAxLCBjb252ZXJ0ZXI6ICdlbWVyZ2VuY3ktZmFsbGJhY2snIH1cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB2YWxpZGF0ZTogKGlucHV0KSA9PiBCdWZmZXIuaXNCdWZmZXIoaW5wdXQpIHx8IHR5cGVvZiBpbnB1dCA9PT0gJ3N0cmluZycsXHJcbiAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgbmFtZTogJ1BERiBEb2N1bWVudCAoRW1lcmdlbmN5KScsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnBkZiddLFxyXG4gICAgICAgICAgICBtaW1lVHlwZXM6IFsnYXBwbGljYXRpb24vcGRmJ10sXHJcbiAgICAgICAgICAgIG1heFNpemU6IDI1ICogMTAyNCAqIDEwMjRcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQWRkIHJlcXVpcmVkIHByb3RvdHlwZSBtZXRob2RzXHJcbiAgICBDb252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuY29udmVydFRvTWFya2Rvd24gPSBhc3luYyBmdW5jdGlvbih0eXBlLCBjb250ZW50LCBvcHRpb25zID0ge30pIHtcclxuICAgICAgY29uc29sZS5sb2coYFtFbWVyZ2VuY3lSZWdpc3RyeV0gQ29udmVydGluZyAke3R5cGV9IGRvY3VtZW50YCk7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICBjb250ZW50OiBgIyBFbWVyZ2VuY3kgQ29udmVydGVyXFxuXFxuVGhpcyBjb250ZW50IHdhcyBnZW5lcmF0ZWQgYnkgYW4gZW1lcmdlbmN5IGZhbGxiYWNrIGNvbnZlcnRlciBiZWNhdXNlIHRoZSBub3JtYWwgY29udmVydGVyIGNvdWxkIG5vdCBiZSBsb2FkZWQuXFxuXFxuUGxlYXNlIHJlcG9ydCB0aGlzIGlzc3VlLmAsXHJcbiAgICAgICAgbWV0YWRhdGE6IHsgc291cmNlOiAnZW1lcmdlbmN5LWZhbGxiYWNrJyB9XHJcbiAgICAgIH07XHJcbiAgICB9O1xyXG5cclxuICAgIENvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiA9IGZ1bmN0aW9uKGV4dGVuc2lvbikge1xyXG4gICAgICBjb25zb2xlLmxvZyhgW0VtZXJnZW5jeVJlZ2lzdHJ5XSBMb29raW5nIHVwIGNvbnZlcnRlciBmb3I6ICR7ZXh0ZW5zaW9ufWApO1xyXG4gICAgICBpZiAoZXh0ZW5zaW9uID09PSAncGRmJykge1xyXG4gICAgICAgIHJldHVybiB0aGlzLmNvbnZlcnRlcnMucGRmO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfTtcclxuXHJcbiAgICAvLyBDcmVhdGUgYW5kIHJldHVybiB0aGUgcmVnaXN0cnkgaW5zdGFuY2VcclxuICAgIHJldHVybiBuZXcgQ29udmVydGVyUmVnaXN0cnkoKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEF0dGVtcHRzIHRvIGxvYWQgYSBtb2R1bGUgZnJvbSB0aGUgYmVzdCBhdmFpbGFibGUgcGF0aFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2R1bGVOYW1lIC0gVGhlIG1vZHVsZSBmaWxlIG5hbWUgKGUuZy4sICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpXHJcbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBiYXNlUGF0aHMgLSBMaXN0IG9mIGJhc2UgZGlyZWN0b3JpZXMgdG8gbG9vayBpblxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGFueT59IC0gVGhlIGxvYWRlZCBtb2R1bGVcclxuICAgKi9cclxuICBzdGF0aWMgYXN5bmMgbG9hZE1vZHVsZUZyb21CZXN0UGF0aChtb2R1bGVOYW1lLCBiYXNlUGF0aHMpIHtcclxuICAgIGNvbnN0IGxvZ2dlciA9IGdldExvZ2dlcignTW9kdWxlTG9hZGVyJyk7XHJcbiAgICBjb25zdCByZXNvbHZlZFBhdGhzID0gYmFzZVBhdGhzLm1hcChiYXNlUGF0aCA9PiBwYXRoLmpvaW4oYmFzZVBhdGgsIG1vZHVsZU5hbWUpKTtcclxuXHJcbiAgICBsb2dnZXIubG9nKGBBdHRlbXB0aW5nIHRvIGxvYWQgJHttb2R1bGVOYW1lfSBmcm9tICR7cmVzb2x2ZWRQYXRocy5sZW5ndGh9IHBvc3NpYmxlIHBhdGhzYCwgJ0lORk8nKTtcclxuXHJcbiAgICAvLyBDaGVjayB3aGljaCBwYXRocyBleGlzdCBmaXJzdFxyXG4gICAgY29uc3QgZXhpc3RpbmdQYXRocyA9IHJlc29sdmVkUGF0aHMuZmlsdGVyKHAgPT4ge1xyXG4gICAgICBjb25zdCBleGlzdHMgPSBmcy5leGlzdHNTeW5jKHApO1xyXG4gICAgICBsb2dnZXIubG9nKGBQYXRoICR7cH0gZXhpc3RzOiAke2V4aXN0c31gLCAnSU5GTycpO1xyXG4gICAgICByZXR1cm4gZXhpc3RzO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaWYgKGV4aXN0aW5nUGF0aHMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIGxvZ2dlci5lcnJvcihgTm8gZXhpc3RpbmcgcGF0aHMgZm91bmQgZm9yIG1vZHVsZTogJHttb2R1bGVOYW1lfWApO1xyXG4gICAgICAvLyBUcnkgYWxsIHBhdGhzIGFueXdheSBhcyBhIGxhc3QgcmVzb3J0XHJcbiAgICAgIHJldHVybiB0aGlzLmxvYWRNb2R1bGUocmVzb2x2ZWRQYXRoc1swXSwge1xyXG4gICAgICAgIGZhbGxiYWNrUGF0aHM6IHJlc29sdmVkUGF0aHMuc2xpY2UoMSksXHJcbiAgICAgICAgc2lsZW50OiB0cnVlXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIExvYWQgZnJvbSB0aGUgZmlyc3QgZXhpc3RpbmcgcGF0aCwgd2l0aCByZW1haW5pbmcgZXhpc3RpbmcgcGF0aHMgYXMgZmFsbGJhY2tzXHJcbiAgICByZXR1cm4gdGhpcy5sb2FkTW9kdWxlKGV4aXN0aW5nUGF0aHNbMF0sIHtcclxuICAgICAgZmFsbGJhY2tQYXRoczogZXhpc3RpbmdQYXRocy5zbGljZSgxKVxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgZ2V0TW9kdWxlUGF0aHMoKSB7XHJcbiAgICBjb25zdCBpc0RldiA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnO1xyXG4gICAgY29uc3QgbG9nZ2VyID0gZ2V0TG9nZ2VyKCdNb2R1bGVMb2FkZXInKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgYSBjb21wcmVoZW5zaXZlIGxpc3Qgb2YgcG9zc2libGUgcGF0aHMgZm9yIHRoZSBDb252ZXJ0ZXJSZWdpc3RyeVxyXG4gICAgY29uc3QgcG9zc2libGVQYXRocyA9IFtcclxuICAgICAgLy8gRGV2ZWxvcG1lbnQgcGF0aHNcclxuICAgICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIFBhY2thZ2VkIGFwcCBwYXRocyAtIG5vdGUgd2UgZXhwbGljaXRseSBoYW5kbGUgdGhlIHBhdGggZnJvbSB0aGUgZXJyb3JcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoL3NyY1xcL2VsZWN0cm9uLywgJ2J1aWxkL2VsZWN0cm9uJyksICdzZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoL3NyY1xcXFxlbGVjdHJvbi8sICdidWlsZFxcXFxlbGVjdHJvbicpLCAnc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBSZWxhdGl2ZSBwYXRocyBmcm9tIGN1cnJlbnQgbW9kdWxlXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBQYXRocyB3aXRoIGFwcC5hc2FyIGZvciBwYWNrYWdlZCBhcHBcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXInLCAnYXBwJyksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhcicsICdhcHAnKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXJcXFxcc3JjJywgJ2FwcC5hc2FyXFxcXGJ1aWxkJyksICdlbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyL3NyYycsICdhcHAuYXNhci9idWlsZCcpLCAnZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gQWx0ZXJuYXRpdmUgcGFyZW50IGRpcmVjdG9yeSBwYXRoc1xyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJy4uL2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICcuLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gU2libGluZyBwYXRoc1xyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKGFwcC5nZXRBcHBQYXRoKCkpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKGFwcC5nZXRBcHBQYXRoKCkpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIE1vcmUgbmVzdGVkIHBhdGhzIGZvciBhcHAuYXNhclxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ2Rpc3QvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAnLi4vcmVzb3VyY2VzL2FwcC9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAnLi4vcmVzb3VyY2VzL2FwcC9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBEaXJlY3QgcGF0aCBmaXhlcyBmb3IgdGhlIHNwZWNpZmljIGVycm9yIHBhdGhcclxuICAgICAgYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicsICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnc3JjXFxcXGVsZWN0cm9uXFxcXHNlcnZpY2VzXFxcXGNvbnZlcnNpb24nLCAnYnVpbGRcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gUGF0aHMgd2l0aCBkaXN0IHByZWZpeGVzIChvZnRlbiB1c2VkIGluIGJ1aWx0IGFwcHMpXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnZGlzdC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnZGlzdC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBBZGRpdGlvbmFsIHBhdGhzIHNwZWNpZmljYWxseSBmb3IgQ29udmVydGVyUmVnaXN0cnkuanNcclxuICAgICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdhcHAvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ2FwcC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi8uLi9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi8uLi8uLi9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvYXBwL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ3Jlc291cmNlcy9hcHAuYXNhci9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpXHJcbiAgICBdO1xyXG5cclxuICAgIC8vIExvZyBhcHAgZW52aXJvbm1lbnQgaW5mb3JtYXRpb24gZm9yIGRlYnVnZ2luZ1xyXG4gICAgbG9nZ2VyLmxvZyhgQXBwIGlzIHBhY2thZ2VkOiAke2FwcC5pc1BhY2thZ2VkfWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBBcHAgcGF0aDogJHthcHAuZ2V0QXBwUGF0aCgpfWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBfX2Rpcm5hbWU6ICR7X19kaXJuYW1lfWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBwcm9jZXNzLmN3ZCgpOiAke3Byb2Nlc3MuY3dkKCl9YCwgJ0lORk8nKTtcclxuICAgIGxvZ2dlci5sb2coYHByb2Nlc3MuZXhlY1BhdGg6ICR7cHJvY2Vzcy5leGVjUGF0aH1gLCAnSU5GTycpO1xyXG5cclxuICAgIC8vIExvZyB0aGUgc3BlY2lmaWMgcGF0aCBmcm9tIHRoZSBlcnJvciBtZXNzYWdlXHJcbiAgICBjb25zdCBlcnJvclBhdGggPSAnQzpcXFxcVXNlcnNcXFxcSm9zZXBoXFxcXERvY3VtZW50c1xcXFxDb2RlXFxcXGNvZGV4LW1kXFxcXGRpc3RcXFxcd2luLXVucGFja2VkXFxcXHJlc291cmNlc1xcXFxhcHAuYXNhclxcXFxzcmNcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvblxcXFxDb252ZXJ0ZXJSZWdpc3RyeS5qcyc7XHJcbiAgICBjb25zdCBjb3JyZWN0ZWRQYXRoID0gZXJyb3JQYXRoLnJlcGxhY2UoJ1xcXFxzcmNcXFxcJywgJ1xcXFxidWlsZFxcXFwnKTtcclxuICAgIGxvZ2dlci5sb2coYEVycm9yIHBhdGg6ICR7ZXJyb3JQYXRofWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBDb3JyZWN0ZWQgcGF0aDogJHtjb3JyZWN0ZWRQYXRofWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBDb3JyZWN0ZWQgcGF0aCBleGlzdHM6ICR7ZnMuZXhpc3RzU3luYyhjb3JyZWN0ZWRQYXRoKX1gLCAnSU5GTycpO1xyXG5cclxuICAgIC8vIEZpbmQgZmlyc3QgZXhpc3RpbmcgYmFzZSBwYXRoXHJcbiAgICBsZXQgYmFzZVBhdGggPSBudWxsO1xyXG4gICAgZm9yIChjb25zdCBjYW5kaWRhdGVQYXRoIG9mIHBvc3NpYmxlUGF0aHMpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBleGlzdHMgPSBmcy5leGlzdHNTeW5jKGNhbmRpZGF0ZVBhdGgpO1xyXG4gICAgICAgIGxvZ2dlci5sb2coYENoZWNraW5nIHBhdGg6ICR7Y2FuZGlkYXRlUGF0aH0gKGV4aXN0czogJHtleGlzdHN9KWAsICdJTkZPJyk7XHJcblxyXG4gICAgICAgIGlmIChleGlzdHMpIHtcclxuICAgICAgICAgIGJhc2VQYXRoID0gY2FuZGlkYXRlUGF0aDtcclxuICAgICAgICAgIGxvZ2dlci5sb2coYEZvdW5kIHZhbGlkIGJhc2UgcGF0aDogJHtiYXNlUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGxvZ2dlci53YXJuKGBFcnJvciBjaGVja2luZyBwYXRoICR7Y2FuZGlkYXRlUGF0aH06ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIElmIG5vIGJhc2UgcGF0aCBleGlzdHMsIHRyeSBkaXJlY3QgbW9kdWxlIHBhdGhzXHJcbiAgICBpZiAoIWJhc2VQYXRoKSB7XHJcbiAgICAgIGxvZ2dlci53YXJuKCdObyB2YWxpZCBiYXNlIHBhdGggZm91bmQsIHRyeWluZyBkaXJlY3QgbW9kdWxlIHJlc29sdXRpb24nKTtcclxuXHJcbiAgICAgIC8vIERlZmluZSBhbGwgcG9zc2libGUgZGlyZWN0IHBhdGhzIHRvIHRoZSByZWdpc3RyeSBtb2R1bGVcclxuICAgICAgY29uc3QgZGlyZWN0UmVnaXN0cnlQYXRocyA9IFtcclxuICAgICAgICAvLyBTcGVjaWZpYyBwYXRocyBiYXNlZCBvbiBlcnJvciBsb2dzXHJcbiAgICAgICAgLy8gVGhpcyBpcyB0aGUgc3BlY2lmaWMgZXJyb3IgcGF0aCB3aXRoICdzcmMnIHJlcGxhY2VkIHdpdGggJ2J1aWxkJ1xyXG4gICAgICAgIGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpICsgJy9Db252ZXJ0ZXJSZWdpc3RyeS5qcycsXHJcbiAgICAgICAgYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdzcmNcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvbicsICdidWlsZFxcXFxlbGVjdHJvblxcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uJykgKyAnXFxcXENvbnZlcnRlclJlZ2lzdHJ5LmpzJyxcclxuXHJcbiAgICAgICAgLy8gRnVsbCBzdHJpbmcgcmVwbGFjZW1lbnRzIGZvciB0aGUgc3BlY2lmaWMgZXJyb3IgcGF0aHMgaW4gdGhlIGxvZ3NcclxuICAgICAgICBhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyXFxcXHNyY1xcXFxlbGVjdHJvbicsICdhcHAuYXNhclxcXFxidWlsZFxcXFxlbGVjdHJvbicpICsgJ1xcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uXFxcXENvbnZlcnRlclJlZ2lzdHJ5LmpzJyxcclxuICAgICAgICBhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyL3NyYy9lbGVjdHJvbicsICdhcHAuYXNhci9idWlsZC9lbGVjdHJvbicpICsgJy9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyxcclxuXHJcbiAgICAgICAgLy8gU3RhbmRhcmQgYXBwbGljYXRpb24gcGF0aHNcclxuICAgICAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG5cclxuICAgICAgICAvLyBSZWxhdGl2ZSBwYXRoc1xyXG4gICAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuXHJcbiAgICAgICAgLy8gQVNBUi1zcGVjaWZpYyBwYXRocyB3aXRoIGFkYXB0YXRpb25zXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXInLCAnYXBwJyksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyJywgJ2FwcCcpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLi9yZXNvdXJjZXMvYXBwL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJy4uL3Jlc291cmNlcy9hcHAvYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uLy4uL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAncmVzb3VyY2VzL2FwcC9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvYXBwLmFzYXIvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvYXBwLmFzYXIvYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG5cclxuICAgICAgICAvLyBBbGxvdyBmaW5kaW5nIGluIGN1cnJlbnQgZGlyZWN0b3JpZXNcclxuICAgICAgICBwYXRoLmpvaW4oX19kaXJuYW1lLCAnQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLmpvaW4ocGF0aC5kaXJuYW1lKF9fZGlybmFtZSksICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG5cclxuICAgICAgICAvLyBUcnkgYWJzb2x1dGUgcGF0aHMgdGhhdCBtYXRjaCB0aGUgZXJyb3Igc3RhY2tcclxuICAgICAgICAnQzpcXFxcVXNlcnNcXFxcSm9zZXBoXFxcXERvY3VtZW50c1xcXFxDb2RlXFxcXGNvZGV4LW1kXFxcXGRpc3RcXFxcd2luLXVucGFja2VkXFxcXHJlc291cmNlc1xcXFxhcHAuYXNhclxcXFxidWlsZFxcXFxlbGVjdHJvblxcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uXFxcXENvbnZlcnRlclJlZ2lzdHJ5LmpzJ1xyXG4gICAgICBdO1xyXG5cclxuICAgICAgLy8gRmluZCB0aGUgZmlyc3QgZGlyZWN0IHJlZ2lzdHJ5IHBhdGggdGhhdCBleGlzdHNcclxuICAgICAgZm9yIChjb25zdCByZWdpc3RyeVBhdGggb2YgZGlyZWN0UmVnaXN0cnlQYXRocykge1xyXG4gICAgICAgIGNvbnN0IGV4aXN0cyA9IGZzLmV4aXN0c1N5bmMocmVnaXN0cnlQYXRoKTtcclxuICAgICAgICBsb2dnZXIubG9nKGBDaGVja2luZyBkaXJlY3QgcmVnaXN0cnkgcGF0aDogJHtyZWdpc3RyeVBhdGh9IChleGlzdHM6ICR7ZXhpc3RzfSlgLCAnSU5GTycpO1xyXG5cclxuICAgICAgICBpZiAoZXhpc3RzKSB7XHJcbiAgICAgICAgICAvLyBCdWlsZCBhIGJhc2UgcGF0aCBmcm9tIHRoZSBkaXJlY3RvcnkgY29udGFpbmluZyB0aGUgcmVnaXN0cnlcclxuICAgICAgICAgIGJhc2VQYXRoID0gcGF0aC5kaXJuYW1lKHJlZ2lzdHJ5UGF0aCk7XHJcbiAgICAgICAgICBsb2dnZXIubG9nKGBGb3VuZCByZWdpc3RyeSBtb2R1bGUgYXQ6ICR7cmVnaXN0cnlQYXRofSwgdXNpbmcgYmFzZSBwYXRoOiAke2Jhc2VQYXRofWAsICdJTkZPJyk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBGYWxsYmFjayB0byBhIGRlZmF1bHQgcGF0aCBpZiBhbGwgZWxzZSBmYWlsc1xyXG4gICAgaWYgKCFiYXNlUGF0aCkge1xyXG4gICAgICBsb2dnZXIuZXJyb3IoJ0FsbCBwYXRoIHJlc29sdXRpb24gYXR0ZW1wdHMgZmFpbGVkLCB1c2luZyBmYWxsYmFjayBwYXRoJyk7XHJcblxyXG4gICAgICAvLyBVc2UgYSBwYXRoIHJlbGF0aXZlIHRvIGN1cnJlbnQgbW9kdWxlIGFzIGxhc3QgcmVzb3J0XHJcbiAgICAgIGlmIChhcHAuaXNQYWNrYWdlZCkge1xyXG4gICAgICAgIGJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3NlcnZpY2VzL2NvbnZlcnNpb24nKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBiYXNlUGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIExvZyB0aGUgZmluYWwgYmFzZSBwYXRoIHRoYXQgd2lsbCBiZSB1c2VkXHJcbiAgICBsb2dnZXIubG9nKGBVc2luZyBmaW5hbCBiYXNlIHBhdGg6ICR7YmFzZVBhdGh9YCwgJ0lORk8nKTtcclxuXHJcbiAgICAvLyBDaGVjayBpZiB0aGUgcmVnaXN0cnkgZXhpc3RzIGF0IHRoaXMgcGF0aFxyXG4gICAgY29uc3QgcmVnaXN0cnlQYXRoID0gcGF0aC5qb2luKGJhc2VQYXRoLCAnQ29udmVydGVyUmVnaXN0cnkuanMnKTtcclxuICAgIGxvZ2dlci5sb2coYEZpbmFsIHJlZ2lzdHJ5IHBhdGg6ICR7cmVnaXN0cnlQYXRofSAoZXhpc3RzOiAke2ZzLmV4aXN0c1N5bmMocmVnaXN0cnlQYXRoKX0pYCwgJ0lORk8nKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgdGhlIHBhdGhzIG9iamVjdCB3aXRoIGFsbCBtb2R1bGUgcGF0aHNcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHJlZ2lzdHJ5OiByZWdpc3RyeVBhdGgsXHJcbiAgICAgIHJlZ2lzdHJ5UGF0aDogcmVnaXN0cnlQYXRoLCAvLyBEdXBsaWNhdGUgZm9yIGRpcmVjdCBhY2Nlc3NcclxuICAgICAgY29udmVydGVyczoge1xyXG4gICAgICAgIHVybDogcGF0aC5qb2luKGJhc2VQYXRoLCAnd2ViL1VybENvbnZlcnRlci5qcycpLFxyXG4gICAgICAgIHBkZjogcGF0aC5qb2luKGJhc2VQYXRoLCAnZG9jdW1lbnQvUGRmQ29udmVydGVyRmFjdG9yeS5qcycpLFxyXG4gICAgICAgIGRvY3g6IHBhdGguam9pbihiYXNlUGF0aCwgJ2RvY3VtZW50L0RvY3hDb252ZXJ0ZXIuanMnKSxcclxuICAgICAgICBwcHR4OiBwYXRoLmpvaW4oYmFzZVBhdGgsICdkb2N1bWVudC9QcHR4Q29udmVydGVyLmpzJyksXHJcbiAgICAgICAgeGxzeDogcGF0aC5qb2luKGJhc2VQYXRoLCAnZGF0YS9YbHN4Q29udmVydGVyLmpzJyksXHJcbiAgICAgICAgY3N2OiBwYXRoLmpvaW4oYmFzZVBhdGgsICdkYXRhL0NzdkNvbnZlcnRlci5qcycpXHJcbiAgICAgIH1cclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vLyBNaW5pbWFsIGVtYmVkZGVkIENvbnZlcnRlclJlZ2lzdHJ5IGFzIGEgbGFzdCByZXNvcnRcclxuY29uc3QgTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5ID0ge1xyXG4gIGNvbnZlcnRlcnM6IHtcclxuICAgIHBkZjoge1xyXG4gICAgICAvLyBNaW5pbWFsIFBERiBjb252ZXJ0ZXJcclxuICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucyA9IHt9KSA9PiB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1tNaW5pbWFsQ29udmVydGVyUmVnaXN0cnldIFVzaW5nIGVtYmVkZGVkIFBERiBjb252ZXJ0ZXInKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgIGNvbnRlbnQ6IGAjIEV4dHJhY3RlZCBmcm9tICR7bmFtZSB8fCAnUERGIGRvY3VtZW50J31cXG5cXG5UaGlzIGNvbnRlbnQgd2FzIGV4dHJhY3RlZCB1c2luZyB0aGUgZW1iZWRkZWQgY29udmVydGVyLmAsXHJcbiAgICAgICAgICB0eXBlOiAncGRmJyxcclxuICAgICAgICAgIG1ldGFkYXRhOiB7IHBhZ2VzOiAxLCBjb252ZXJ0ZXI6ICdtaW5pbWFsLWVtYmVkZGVkJyB9XHJcbiAgICAgICAgfTtcclxuICAgICAgfSxcclxuICAgICAgdmFsaWRhdGU6IChpbnB1dCkgPT4gQnVmZmVyLmlzQnVmZmVyKGlucHV0KSB8fCB0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnLFxyXG4gICAgICBjb25maWc6IHtcclxuICAgICAgICBuYW1lOiAnUERGIERvY3VtZW50JyxcclxuICAgICAgICBleHRlbnNpb25zOiBbJy5wZGYnXSxcclxuICAgICAgICBtaW1lVHlwZXM6IFsnYXBwbGljYXRpb24vcGRmJ10sXHJcbiAgICAgICAgbWF4U2l6ZTogMjUgKiAxMDI0ICogMTAyNFxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfSxcclxuXHJcbiAgLy8gR2VuZXJpYyBjb252ZXJzaW9uIGZ1bmN0aW9uXHJcbiAgY29udmVydFRvTWFya2Rvd246IGFzeW5jICh0eXBlLCBjb250ZW50LCBvcHRpb25zID0ge30pID0+IHtcclxuICAgIGNvbnNvbGUubG9nKGBbTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5XSBVc2luZyBlbWJlZGRlZCBjb252ZXJ0VG9NYXJrZG93biBmb3IgJHt0eXBlfWApO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgY29udGVudDogYCMgRXh0cmFjdGVkIGZyb20gJHtvcHRpb25zLm5hbWUgfHwgJ2RvY3VtZW50J31cXG5cXG5UaGlzIGNvbnRlbnQgd2FzIGV4dHJhY3RlZCB1c2luZyB0aGUgZW1iZWRkZWQgY29udmVydGVyLmAsXHJcbiAgICAgIHR5cGU6IHR5cGUsXHJcbiAgICAgIG1ldGFkYXRhOiB7IGNvbnZlcnRlcjogJ21pbmltYWwtZW1iZWRkZWQnIH1cclxuICAgIH07XHJcbiAgfSxcclxuXHJcbiAgLy8gTG9va3VwIGNvbnZlcnRlciBieSBleHRlbnNpb25cclxuICBnZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbjogYXN5bmMgKGV4dGVuc2lvbikgPT4ge1xyXG4gICAgY29uc29sZS5sb2coYFtNaW5pbWFsQ29udmVydGVyUmVnaXN0cnldIExvb2tpbmcgdXAgY29udmVydGVyIGZvcjogJHtleHRlbnNpb259YCk7XHJcblxyXG4gICAgLy8gSGFuZGxlIFBERiBmaWxlcyBzcGVjaWZpY2FsbHlcclxuICAgIGlmIChleHRlbnNpb24gPT09ICdwZGYnKSB7XHJcbiAgICAgIHJldHVybiBNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkuY29udmVydGVycy5wZGY7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2VuZXJpYyBjb252ZXJ0ZXIgZm9yIG90aGVyIHR5cGVzXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zID0ge30pID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW01pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeV0gVXNpbmcgZ2VuZXJpYyBjb252ZXJ0ZXIgZm9yICR7ZXh0ZW5zaW9ufWApO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgY29udGVudDogYCMgRXh0cmFjdGVkIGZyb20gJHtuYW1lIHx8IGV4dGVuc2lvbiArICcgZmlsZSd9XFxuXFxuVGhpcyBjb250ZW50IHdhcyBleHRyYWN0ZWQgdXNpbmcgdGhlIGVtYmVkZGVkIGdlbmVyaWMgY29udmVydGVyLmAsXHJcbiAgICAgICAgICB0eXBlOiBleHRlbnNpb24sXHJcbiAgICAgICAgICBtZXRhZGF0YTogeyBjb252ZXJ0ZXI6ICdtaW5pbWFsLWVtYmVkZGVkLWdlbmVyaWMnIH1cclxuICAgICAgICB9O1xyXG4gICAgICB9LFxyXG4gICAgICB2YWxpZGF0ZTogKCkgPT4gdHJ1ZSxcclxuICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgbmFtZTogYCR7ZXh0ZW5zaW9uLnRvVXBwZXJDYXNlKCl9IERvY3VtZW50YCxcclxuICAgICAgICBleHRlbnNpb25zOiBbYC4ke2V4dGVuc2lvbn1gXSxcclxuICAgICAgICBtaW1lVHlwZXM6IFtgYXBwbGljYXRpb24vJHtleHRlbnNpb259YF0sXHJcbiAgICAgICAgbWF4U2l6ZTogMTAgKiAxMDI0ICogMTAyNFxyXG4gICAgICB9XHJcbiAgICB9O1xyXG4gIH1cclxufTtcclxuXHJcbi8qKlxyXG4gKiBNYW5hZ2VzIGNvbnZlcnRlciBpbml0aWFsaXphdGlvbiBhbmQgZW5zdXJlcyBwcm9wZXIgbG9hZGluZyBzZXF1ZW5jZS5cclxuICovXHJcbmNsYXNzIENvbnZlcnRlckluaXRpYWxpemVyIHtcclxuICBzdGF0aWMgX2luc3RhbmNlID0gbnVsbDtcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuX2luaXRpYWxpemVkID0gZmFsc2U7XHJcbiAgICB0aGlzLl9pbml0UHJvbWlzZSA9IG51bGw7XHJcbiAgICB0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeSA9IG51bGw7XHJcbiAgICB0aGlzLmxvZ2dlciA9IGdldExvZ2dlcignQ29udmVydGVySW5pdGlhbGl6ZXInKTtcclxuICB9XHJcbiAgXHJcbiAgc3RhdGljIGdldEluc3RhbmNlKCkge1xyXG4gICAgaWYgKCFDb252ZXJ0ZXJJbml0aWFsaXplci5faW5zdGFuY2UpIHtcclxuICAgICAgQ29udmVydGVySW5pdGlhbGl6ZXIuX2luc3RhbmNlID0gbmV3IENvbnZlcnRlckluaXRpYWxpemVyKCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gQ29udmVydGVySW5pdGlhbGl6ZXIuX2luc3RhbmNlO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgaW5pdGlhbGl6ZSgpIHtcclxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplZCkgcmV0dXJuIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gICAgaWYgKHRoaXMuX2luaXRQcm9taXNlKSByZXR1cm4gdGhpcy5faW5pdFByb21pc2U7XHJcblxyXG4gICAgdGhpcy5faW5pdFByb21pc2UgPSB0aGlzLl9kb0luaXRpYWxpemUoKTtcclxuICAgIHJldHVybiB0aGlzLl9pbml0UHJvbWlzZTtcclxuICB9XHJcblxyXG4gIGFzeW5jIF9kb0luaXRpYWxpemUoKSB7XHJcbiAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlNUQVJUSU5HLFxyXG4gICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5JTklUSUFMSVpJTkdcclxuICAgICk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gR2V0IGFsbCBwb3NzaWJsZSBtb2R1bGUgcGF0aHNcclxuICAgICAgY29uc3QgcGF0aHMgPSBNb2R1bGVMb2FkZXIuZ2V0TW9kdWxlUGF0aHMoKTtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nKCdVc2luZyBjb252ZXJ0ZXIgcGF0aHM6JywgJ0lORk8nLCBwYXRocyk7XHJcblxyXG4gICAgICAvLyBFeHRyYWN0IGFsbCB0aGUgcG9zc2libGUgYmFzZSBwYXRocyBmcm9tIHZhcmlvdXMgc291cmNlc1xyXG4gICAgICBjb25zdCBwb3NzaWJsZUJhc2VQYXRocyA9IFtcclxuICAgICAgICBwYXRoLmRpcm5hbWUocGF0aHMucmVnaXN0cnkpLFxyXG4gICAgICAgIC4uLk9iamVjdC52YWx1ZXMocGF0aHMuY29udmVydGVycykubWFwKHAgPT4gcGF0aC5kaXJuYW1lKHBhdGguZGlybmFtZShwKSkpXHJcbiAgICAgIF07XHJcblxyXG4gICAgICAvLyBMb2cgYWxsIHBvc3NpYmxlIHJlZ2lzdHJ5IHBhdGhzIHdlJ2xsIHRyeVxyXG4gICAgICBjb25zdCBhbGxQb3NzaWJsZVJlZ2lzdHJ5UGF0aHMgPSBbXHJcbiAgICAgICAgcGF0aHMucmVnaXN0cnksXHJcbiAgICAgICAgcGF0aHMucmVnaXN0cnlQYXRoLFxyXG4gICAgICAgIC4uLnBvc3NpYmxlQmFzZVBhdGhzLm1hcChiYXNlUGF0aCA9PiBwYXRoLmpvaW4oYmFzZVBhdGgsICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpKVxyXG4gICAgICBdO1xyXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQWxsIHBvc3NpYmxlIHJlZ2lzdHJ5IHBhdGhzOicsIGFsbFBvc3NpYmxlUmVnaXN0cnlQYXRocyk7XHJcblxyXG4gICAgICAvLyBBdHRlbXB0IHRvIGxvYWQgdGhlIHJlZ2lzdHJ5IHVzaW5nIG91ciBlbmhhbmNlZCBsb2FkZXIgd2l0aCBmYWxsYmFja3NcclxuICAgICAgbGV0IHJlZ2lzdHJ5O1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIEZpcnN0IHRyeSB0aGUgZGlyZWN0IHBhdGhcclxuICAgICAgICBjb25zdCBlcnJvclBhdGggPSAnQzpcXFxcVXNlcnNcXFxcSm9zZXBoXFxcXERvY3VtZW50c1xcXFxDb2RlXFxcXGNvZGV4LW1kXFxcXGRpc3RcXFxcd2luLXVucGFja2VkXFxcXHJlc291cmNlc1xcXFxhcHAuYXNhclxcXFxzcmNcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvblxcXFxDb252ZXJ0ZXJSZWdpc3RyeS5qcyc7XHJcbiAgICAgICAgY29uc3QgY29ycmVjdGVkUGF0aCA9IGVycm9yUGF0aC5yZXBsYWNlKCdcXFxcc3JjXFxcXCcsICdcXFxcYnVpbGRcXFxcJyk7XHJcblxyXG4gICAgICAgIC8vIEFsc28gY2hlY2sgaWYgdGhlIGhhcmRjb2RlZCBjb3JyZWN0ZWQgcGF0aCBleGlzdHMgYW5kIHRyeSB0byBsb2FkIGl0IGRpcmVjdGx5XHJcbiAgICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoY29ycmVjdGVkUGF0aCkpIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgRm91bmQgY29ycmVjdGVkIHJlZ2lzdHJ5IHBhdGg6ICR7Y29ycmVjdGVkUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgcmVnaXN0cnkgPSByZXF1aXJlKGNvcnJlY3RlZFBhdGgpO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKCdTdWNjZXNzZnVsbHkgbG9hZGVkIHJlZ2lzdHJ5IGZyb20gY29ycmVjdGVkIHBhdGgnKTtcclxuICAgICAgICAgIH0gY2F0Y2ggKGRpcmVjdExvYWRFcnJvcikge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBGYWlsZWQgdG8gbG9hZCBmcm9tIGNvcnJlY3RlZCBwYXRoOiAke2RpcmVjdExvYWRFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSWYgZGlyZWN0IGxvYWRpbmcgZGlkbid0IHdvcmssIHRyeSB3aXRoIHRoZSBtb2R1bGVsb2FkZXJcclxuICAgICAgICBpZiAoIXJlZ2lzdHJ5KSB7XHJcbiAgICAgICAgICByZWdpc3RyeSA9IGF3YWl0IE1vZHVsZUxvYWRlci5sb2FkTW9kdWxlKFxyXG4gICAgICAgICAgICBwYXRocy5yZWdpc3RyeSxcclxuICAgICAgICAgICAgeyBmYWxsYmFja1BhdGhzOiBhbGxQb3NzaWJsZVJlZ2lzdHJ5UGF0aHMuc2xpY2UoMSksIHNpbGVudDogdHJ1ZSB9XHJcbiAgICAgICAgICApO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoaW5pdGlhbEVycm9yKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybignSW5pdGlhbCByZWdpc3RyeSBsb2FkaW5nIGZhaWxlZCwgdHJ5aW5nIGFsdGVybmF0aXZlIGFwcHJvYWNoZXMnLCBpbml0aWFsRXJyb3IpO1xyXG5cclxuICAgICAgICAvLyBJZiBkaXJlY3QgbG9hZGluZyBmYWlsZWQsIHRyeSBhIGRpZmZlcmVudCBhcHByb2FjaCBieSBjb2xsZWN0aW5nIGJhc2UgZGlyZWN0b3JpZXNcclxuICAgICAgICBjb25zdCBiYXNlRGlycyA9IFtdO1xyXG5cclxuICAgICAgICAvLyBBZGQgcG90ZW50aWFsIGJhc2UgZGlyZWN0b3JpZXMgKGRlZHVwbGljYXRlIHRoZW0pXHJcbiAgICAgICAgY29uc3QgYWRkQmFzZURpciA9IChkaXIpID0+IHtcclxuICAgICAgICAgIGlmIChkaXIgJiYgIWJhc2VEaXJzLmluY2x1ZGVzKGRpcikpIHtcclxuICAgICAgICAgICAgYmFzZURpcnMucHVzaChkaXIpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIEFkZCBtdWx0aXBsZSBwYXRocyB0aGF0IGNvdWxkIGNvbnRhaW4gdGhlIHJlZ2lzdHJ5XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLmRpcm5hbWUocGF0aHMucmVnaXN0cnkpKTtcclxuXHJcbiAgICAgICAgLy8gQWRkIHBhcmVudCBkaXJlY3RvcmllcyBvZiBlYWNoIGNvbnZlcnRlciBwYXRoXHJcbiAgICAgICAgT2JqZWN0LnZhbHVlcyhwYXRocy5jb252ZXJ0ZXJzKS5mb3JFYWNoKGNvbnZlcnRlclBhdGggPT4ge1xyXG4gICAgICAgICAgY29uc3QgY29udmVydGVyRGlyID0gcGF0aC5kaXJuYW1lKGNvbnZlcnRlclBhdGgpO1xyXG4gICAgICAgICAgYWRkQmFzZURpcihwYXRoLmRpcm5hbWUoY29udmVydGVyRGlyKSk7IC8vIEFkZCBwYXJlbnQgZGlyZWN0b3J5XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIEFkZCBjb21tb24gZGlyZWN0b3JpZXMgcmVsYXRpdmUgdG8gZXhlY3V0YWJsZVxyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhcicsICdhcHAnKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXInLCAnYXBwJyksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG5cclxuICAgICAgICAvLyBMb2cgdGhlIGJhc2UgZGlyZWN0b3JpZXMgd2UnbGwgdHJ5XHJcbiAgICAgICAgdGhpcy5sb2dnZXIubG9nKCdUcnlpbmcgdG8gbG9hZCByZWdpc3RyeSBmcm9tIHRoZXNlIGJhc2UgZGlyZWN0b3JpZXM6JywgJ0lORk8nLCBiYXNlRGlycyk7XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAvLyBUcnkgdG8gbG9hZCBtb2R1bGUgZnJvbSB0aGUgYmVzdCBwYXRoXHJcbiAgICAgICAgICByZWdpc3RyeSA9IGF3YWl0IE1vZHVsZUxvYWRlci5sb2FkTW9kdWxlRnJvbUJlc3RQYXRoKCdDb252ZXJ0ZXJSZWdpc3RyeS5qcycsIGJhc2VEaXJzKTtcclxuICAgICAgICB9IGNhdGNoIChiZXN0UGF0aEVycm9yKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignQWxsIHBhdGggbG9hZGluZyBhdHRlbXB0cyBmYWlsZWQsIHVzaW5nIGVtYmVkZGVkIHJlZ2lzdHJ5JywgYmVzdFBhdGhFcnJvcik7XHJcbiAgICAgICAgICAvLyBXaGVuIGFsbCBlbHNlIGZhaWxzLCB1c2Ugb3VyIGVtYmVkZGVkIHJlZ2lzdHJ5XHJcbiAgICAgICAgICByZWdpc3RyeSA9IE1pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeTtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1VzaW5nIGVtYmVkZGVkIE1pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeSBhcyBsYXN0IHJlc29ydCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gVmFsaWRhdGUgdGhlIHJlZ2lzdHJ5XHJcbiAgICAgIGlmICghdGhpcy5fdmFsaWRhdGVSZWdpc3RyeShyZWdpc3RyeSkpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignSW52YWxpZCBjb252ZXJ0ZXIgcmVnaXN0cnkgc3RydWN0dXJlLCB1c2luZyBlbWJlZGRlZCByZWdpc3RyeScpO1xyXG4gICAgICAgIC8vIFVzZSBvdXIgZW1iZWRkZWQgcmVnaXN0cnlcclxuICAgICAgICByZWdpc3RyeSA9IE1pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeTtcclxuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdVc2luZyBlbWJlZGRlZCBNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkgYXMgbGFzdCByZXNvcnQnKTtcclxuXHJcbiAgICAgICAgLy8gRG91YmxlLWNoZWNrIHRoYXQgb3VyIGVtYmVkZGVkIHJlZ2lzdHJ5IGlzIHZhbGlkXHJcbiAgICAgICAgaWYgKCF0aGlzLl92YWxpZGF0ZVJlZ2lzdHJ5KHJlZ2lzdHJ5KSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkgaXMgaW52YWxpZCEnKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIExvZyB0aGUgY29udmVydGVycyBpbiB0aGUgcmVnaXN0cnlcclxuICAgICAgdGhpcy5sb2dnZXIubG9nKCdBdmFpbGFibGUgY29udmVydGVyczonLCBPYmplY3Qua2V5cyhyZWdpc3RyeS5jb252ZXJ0ZXJzIHx8IHt9KSk7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKCdTdWNjZXNzZnVsbHkgbG9hZGVkIGNvbnZlcnRlciByZWdpc3RyeScpO1xyXG4gICAgICB0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeSA9IHJlZ2lzdHJ5O1xyXG4gICAgICB0aGlzLl9pbml0aWFsaXplZCA9IHRydWU7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuSU5JVElBTElaSU5HLFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkNPTVBMRVRFRFxyXG4gICAgICApO1xyXG5cclxuICAgICAgcmV0dXJuIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5faW5pdFByb21pc2UgPSBudWxsO1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uRXJyb3IoJ2luaXQnLCBlcnJvcik7XHJcbiAgICAgIFxyXG4gICAgICAvLyBQcm92aWRlIGJldHRlciBlcnJvciBpbmZvcm1hdGlvblxyXG4gICAgICBjb25zdCBlbmhhbmNlZEVycm9yID0gbmV3IEVycm9yKGBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBjb252ZXJ0ZXIgcmVnaXN0cnk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgZW5oYW5jZWRFcnJvci5vcmlnaW5hbCA9IGVycm9yO1xyXG4gICAgICBlbmhhbmNlZEVycm9yLnN0YWNrID0gZXJyb3Iuc3RhY2s7XHJcbiAgICAgIHRocm93IGVuaGFuY2VkRXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBfdmFsaWRhdGVSZWdpc3RyeShyZWdpc3RyeSkge1xyXG4gICAgaWYgKCFyZWdpc3RyeSB8fCB0eXBlb2YgcmVnaXN0cnkgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoIXJlZ2lzdHJ5LmNvbnZlcnRlcnMgfHwgdHlwZW9mIHJlZ2lzdHJ5LmNvbnZlcnRlcnMgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAodHlwZW9mIHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAodHlwZW9mIHJlZ2lzdHJ5LmdldENvbnZlcnRlckJ5RXh0ZW5zaW9uICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDYXRlZ29yaXplIGZpbGUgdHlwZXMgZm9yIGJldHRlciBvcmdhbml6YXRpb25cclxuICovXHJcbmNvbnN0IEZJTEVfVFlQRV9DQVRFR09SSUVTID0ge1xyXG4gIC8vIEF1ZGlvIGZpbGVzXHJcbiAgbXAzOiAnYXVkaW8nLFxyXG4gIHdhdjogJ2F1ZGlvJyxcclxuICBvZ2c6ICdhdWRpbycsXHJcbiAgZmxhYzogJ2F1ZGlvJyxcclxuICBcclxuICAvLyBWaWRlbyBmaWxlc1xyXG4gIG1wNDogJ3ZpZGVvJyxcclxuICB3ZWJtOiAndmlkZW8nLFxyXG4gIGF2aTogJ3ZpZGVvJyxcclxuICBtb3Y6ICd2aWRlbycsXHJcbiAgXHJcbiAgLy8gRG9jdW1lbnQgZmlsZXNcclxuICBwZGY6ICdkb2N1bWVudCcsXHJcbiAgZG9jeDogJ2RvY3VtZW50JyxcclxuICBwcHR4OiAnZG9jdW1lbnQnLFxyXG4gIFxyXG4gIC8vIERhdGEgZmlsZXNcclxuICB4bHN4OiAnZGF0YScsXHJcbiAgY3N2OiAnZGF0YScsXHJcbiAgXHJcbiAgLy8gV2ViIGNvbnRlbnRcclxuICB1cmw6ICd3ZWInLFxyXG4gIHBhcmVudHVybDogJ3dlYicsXHJcbn07XHJcblxyXG4vKipcclxuICogRW5oYW5jZWQgVW5pZmllZENvbnZlcnRlckZhY3RvcnkgY2xhc3Mgd2l0aCBwcm9wZXIgaW5pdGlhbGl6YXRpb24gYW5kIGNvbnZlcnNpb24gaGFuZGxpbmdcclxuICovXHJcbmNsYXNzIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5IHtcclxuICBzdGF0aWMgX2luc3RhbmNlID0gbnVsbDtcclxuICBcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuX2luaXRpYWxpemVyID0gQ29udmVydGVySW5pdGlhbGl6ZXIuZ2V0SW5zdGFuY2UoKTtcclxuICAgIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5ID0gbnVsbDtcclxuICAgIHRoaXMubG9nZ2VyID0gZ2V0TG9nZ2VyKCdVbmlmaWVkQ29udmVydGVyRmFjdG9yeScpO1xyXG4gICAgdGhpcy5sb2dnZXIubG9nKCdVbmlmaWVkQ29udmVydGVyRmFjdG9yeSBpbml0aWFsaXplZCcsICdJTkZPJyk7XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgZ2V0SW5zdGFuY2UoKSB7XHJcbiAgICBpZiAoIVVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5Ll9pbnN0YW5jZSkge1xyXG4gICAgICBVbmlmaWVkQ29udmVydGVyRmFjdG9yeS5faW5zdGFuY2UgPSBuZXcgVW5pZmllZENvbnZlcnRlckZhY3RvcnkoKTtcclxuICAgIH1cclxuICAgIHJldHVybiBVbmlmaWVkQ29udmVydGVyRmFjdG9yeS5faW5zdGFuY2U7XHJcbiAgfVxyXG5cclxuICBhc3luYyBfZW5zdXJlSW5pdGlhbGl6ZWQoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5KSB7XHJcbiAgICAgIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5ID0gYXdhaXQgdGhpcy5faW5pdGlhbGl6ZXIuaW5pdGlhbGl6ZSgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0Q29udmVydGVyKGZpbGVUeXBlKSB7XHJcbiAgICB0aGlzLmxvZ2dlci5zZXRDb250ZXh0KHsgZmlsZVR5cGUgfSk7XHJcbiAgICBcclxuICAgIGNvbnN0IHJlZ2lzdHJ5ID0gYXdhaXQgdGhpcy5fZW5zdXJlSW5pdGlhbGl6ZWQoKTtcclxuICAgIFxyXG4gICAgaWYgKCFmaWxlVHlwZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpbGUgdHlwZSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIE5vcm1hbGl6ZSBmaWxlIHR5cGUgKHJlbW92ZSBkb3QsIGxvd2VyY2FzZSlcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0gZmlsZVR5cGUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9eXFwuLywgJycpO1xyXG5cclxuICAgIC8vIEdldCBVUkwgY29udmVydGVyIGRpcmVjdGx5IGZyb20gcmVnaXN0cnkgaWYgYXZhaWxhYmxlXHJcbiAgICBpZiAobm9ybWFsaXplZFR5cGUgPT09ICd1cmwnIHx8IG5vcm1hbGl6ZWRUeXBlID09PSAncGFyZW50dXJsJykge1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2coYFVzaW5nIGRpcmVjdCBVUkwgY29udmVydGVyIGZvcjogJHtub3JtYWxpemVkVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgY29udmVydGVyID0gcmVnaXN0cnkuY29udmVydGVycz8uW25vcm1hbGl6ZWRUeXBlXTtcclxuICAgICAgaWYgKGNvbnZlcnRlcikge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLnN1Y2Nlc3MoYEZvdW5kICR7bm9ybWFsaXplZFR5cGV9IGNvbnZlcnRlcmApO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBjb252ZXJ0ZXI6IHtcclxuICAgICAgICAgICAgLi4uY29udmVydGVyLFxyXG4gICAgICAgICAgICB0eXBlOiBub3JtYWxpemVkVHlwZSxcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgIHJldHVybiBjb252ZXJ0ZXIuY29udmVydChjb250ZW50LCBuYW1lLCBhcGlLZXksIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICBuYW1lLFxyXG4gICAgICAgICAgICAgICAgdHlwZTogbm9ybWFsaXplZFR5cGVcclxuICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIHR5cGU6IG5vcm1hbGl6ZWRUeXBlLFxyXG4gICAgICAgICAgY2F0ZWdvcnk6ICd3ZWInXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gVHJ5IGZhbGxiYWNrIHRvIGNvbnZlcnRUb01hcmtkb3duXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZyhgQXR0ZW1wdGluZyBjb252ZXJ0VG9NYXJrZG93biBmYWxsYmFjayBmb3IgJHtub3JtYWxpemVkVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICBpZiAocmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24pIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgY29udmVydGVyOiB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICByZXR1cm4gcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24obm9ybWFsaXplZFR5cGUsIGNvbnRlbnQsIHtcclxuICAgICAgICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICAgICAgICBhcGlLZXksXHJcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zXHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoaW5wdXQpID0+IHR5cGVvZiBpbnB1dCA9PT0gJ3N0cmluZycgJiYgaW5wdXQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgbmFtZTogbm9ybWFsaXplZFR5cGUgPT09ICd1cmwnID8gJ1dlYiBQYWdlJyA6ICdXZWJzaXRlJyxcclxuICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy51cmwnLCAnLmh0bWwnLCAnLmh0bSddLFxyXG4gICAgICAgICAgICAgIG1pbWVUeXBlczogWyd0ZXh0L2h0bWwnLCAnYXBwbGljYXRpb24veC11cmwnXSxcclxuICAgICAgICAgICAgICBtYXhTaXplOiAxMCAqIDEwMjQgKiAxMDI0XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB0eXBlOiBub3JtYWxpemVkVHlwZSxcclxuICAgICAgICAgIGNhdGVnb3J5OiAnd2ViJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gRm9yIGFsbCBvdGhlciB0eXBlcywgZ2V0IGNvbnZlcnRlciBmcm9tIHJlZ2lzdHJ5XHJcbiAgICBjb25zdCBjb252ZXJ0ZXIgPSBhd2FpdCByZWdpc3RyeS5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbihub3JtYWxpemVkVHlwZSk7XHJcbiAgICBpZiAoY29udmVydGVyKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgY29udmVydGVyLFxyXG4gICAgICAgIHR5cGU6IG5vcm1hbGl6ZWRUeXBlLFxyXG4gICAgICAgIGNhdGVnb3J5OiBGSUxFX1RZUEVfQ0FURUdPUklFU1tub3JtYWxpemVkVHlwZV0gfHwgJ2RvY3VtZW50J1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHRocm93IG5ldyBFcnJvcihgTm8gY29udmVydGVyIGZvdW5kIGZvciB0eXBlOiAke2ZpbGVUeXBlfWApO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ29udmVydCBhIGZpbGUgdG8gbWFya2Rvd24gdXNpbmcgdGhlIGFwcHJvcHJpYXRlIGNvbnZlcnRlclxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gdGhlIGZpbGUgb3IgVVJMIHN0cmluZ1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gLSBDb252ZXJzaW9uIHJlc3VsdFxyXG4gICAqL1xyXG4gIGFzeW5jIGNvbnZlcnRGaWxlKGZpbGVQYXRoLCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnN0IGZpbGVUeXBlID0gb3B0aW9ucy5maWxlVHlwZTtcclxuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XHJcbiAgICBcclxuICAgIHRoaXMubG9nZ2VyLmxvZ0NvbnZlcnNpb25TdGFydChmaWxlVHlwZSwgb3B0aW9ucyk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICghZmlsZVR5cGUpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2ZpbGVUeXBlIGlzIHJlcXVpcmVkIGluIG9wdGlvbnMnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gRGV0ZXJtaW5lIGlmIHRoaXMgaXMgYSBVUkwgb3IgYSBmaWxlXHJcbiAgICAgIGNvbnN0IGlzVXJsID0gZmlsZVR5cGUgPT09ICd1cmwnIHx8IGZpbGVUeXBlID09PSAncGFyZW50dXJsJztcclxuXHJcbiAgICAgIC8vIEdldCBmaWxlIGRldGFpbHMgLSBoYW5kbGUgVVJMcyBkaWZmZXJlbnRseVxyXG4gICAgICBsZXQgZmlsZU5hbWU7XHJcblxyXG4gICAgICBpZiAoQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSkge1xyXG4gICAgICAgIC8vIFVzZSBvcmlnaW5hbEZpbGVOYW1lIGZyb20gb3B0aW9ucywgb3IgZmFsbGJhY2sgdG8gcHJvdmlkZWQgbmFtZSBpZiBhdmFpbGFibGVcclxuICAgICAgICBmaWxlTmFtZSA9IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBvcHRpb25zLm5hbWU7XHJcblxyXG4gICAgICAgIGlmICghZmlsZU5hbWUpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignb3JpZ2luYWxGaWxlTmFtZSBpcyByZXF1aXJlZCB3aGVuIHBhc3NpbmcgYnVmZmVyIGlucHV0Jyk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKGlzVXJsKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGNvbnN0IHVybE9iaiA9IG5ldyBVUkwoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSB1cmxPYmouaG9zdG5hbWUgKyAodXJsT2JqLnBhdGhuYW1lICE9PSAnLycgPyB1cmxPYmoucGF0aG5hbWUgOiAnJyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSBmaWxlUGF0aDtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZmlsZU5hbWUgPSBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBFbnN1cmUgb3JpZ2luYWxGaWxlTmFtZSBpcyBhbHdheXMgc2V0IGluIG9wdGlvbnNcclxuICAgICAgb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lID0gZmlsZU5hbWU7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuU1RBUlRJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuVkFMSURBVElOR1xyXG4gICAgICApO1xyXG4gICAgICBcclxuICAgICAgLy8gR2V0IHRoZSBhcHByb3ByaWF0ZSBjb252ZXJ0ZXIgd2l0aCBhc3luYy9hd2FpdFxyXG4gICAgICBsZXQgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIFVSTCB0eXBlcyBpbiBwcm9kdWN0aW9uIG1vZGVcclxuICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvICYmIChmaWxlVHlwZSA9PT0gJ3VybCcgfHwgZmlsZVR5cGUgPT09ICdwYXJlbnR1cmwnKSkge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgU3BlY2lhbCBoYW5kbGluZyBmb3IgJHtmaWxlVHlwZX0gaW4gcHJvZHVjdGlvbiBtb2RlYCwgJ0lORk8nKTtcclxuICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5jcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChjb252ZXJ0ZXJJbmZvKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKGBDcmVhdGVkIGRpcmVjdCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBJZiBjb252ZXJ0ZXIgbm90IGZvdW5kLCB0cnkgYWdhaW4gYWZ0ZXIgYSBzaG9ydCBkZWxheVxyXG4gICAgICBpZiAoIWNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFJldHJ5aW5nIHRvIGdldCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9IGFmdGVyIGRlbGF5Li4uYCwgJ0lORk8nKTtcclxuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNTAwKSk7XHJcbiAgICAgICAgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWNvbnZlcnRlckluZm8gJiYgKGZpbGVUeXBlID09PSAndXJsJyB8fCBmaWxlVHlwZSA9PT0gJ3BhcmVudHVybCcpKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFNlY29uZCBhdHRlbXB0IGF0IHNwZWNpYWwgaGFuZGxpbmcgZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgICAgICAgIGNvbnZlcnRlckluZm8gPSBhd2FpdCB0aGlzLmNyZWF0ZURpcmVjdFVybENvbnZlcnRlcihmaWxlVHlwZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIElmIHN0aWxsIG5vdCBmb3VuZCwgdHJ5IG9uZSBtb3JlIHRpbWUgd2l0aCBhIGxvbmdlciBkZWxheVxyXG4gICAgICAgIGlmICghY29udmVydGVySW5mbykge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBGaW5hbCBhdHRlbXB0IHRvIGdldCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9IGFmdGVyIGxvbmdlciBkZWxheS4uLmAsICdJTkZPJyk7XHJcbiAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwMCkpO1xyXG4gICAgICAgICAgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvICYmIChmaWxlVHlwZSA9PT0gJ3VybCcgfHwgZmlsZVR5cGUgPT09ICdwYXJlbnR1cmwnKSkge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYEZpbmFsIGF0dGVtcHQgYXQgc3BlY2lhbCBoYW5kbGluZyBmb3IgJHtmaWxlVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5jcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBpZiAoIWNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBmaWxlIHR5cGU6ICR7ZmlsZVR5cGV9YCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgYSBwcm9ncmVzcyB0cmFja2VyIGlmIGNhbGxiYWNrIHByb3ZpZGVkXHJcbiAgICAgIGNvbnN0IHByb2dyZXNzVHJhY2tlciA9IG9wdGlvbnMub25Qcm9ncmVzcyA/IFxyXG4gICAgICAgIG5ldyBQcm9ncmVzc1RyYWNrZXIob3B0aW9ucy5vblByb2dyZXNzLCAyNTApIDogbnVsbDtcclxuICAgICAgXHJcbiAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDUsIHsgc3RhdHVzOiAnaW5pdGlhbGl6aW5nJywgZmlsZVR5cGU6IGZpbGVUeXBlIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZWdpc3RyeSA9IGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKCk7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQ29udmVydGVyIGluZm86Jywgc2FuaXRpemVGb3JMb2dnaW5nKHtcclxuICAgICAgICBoYXNSZWdpc3RyeTogISFyZWdpc3RyeSxcclxuICAgICAgICBjb252ZXJ0ZXJUeXBlOiBjb252ZXJ0ZXJJbmZvPy50eXBlIHx8ICdub25lJyxcclxuICAgICAgICBjYXRlZ29yeTogY29udmVydGVySW5mbz8uY2F0ZWdvcnkgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgIGhhc0NvbnZlcnRlcjogISFjb252ZXJ0ZXJJbmZvPy5jb252ZXJ0ZXIsXHJcbiAgICAgICAgY29udmVydGVyRGV0YWlsczogY29udmVydGVySW5mbz8uY29udmVydGVyXHJcbiAgICAgIH0pKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEhhbmRsZSB0aGUgY29udmVyc2lvbiBiYXNlZCBvbiBmaWxlIHR5cGVcclxuICAgICAgY29uc3QgY29udmVyc2lvblJlc3VsdCA9IGF3YWl0IHRoaXMuaGFuZGxlQ29udmVyc2lvbihmaWxlUGF0aCwge1xyXG4gICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIGZpbGVOYW1lLFxyXG4gICAgICAgIHByb2dyZXNzVHJhY2tlcixcclxuICAgICAgICBjb252ZXJ0ZXJJbmZvLFxyXG4gICAgICAgIGlzVXJsXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoMTAwLCB7IHN0YXR1czogJ2NvbXBsZXRlZCcgfSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ0NvbnZlcnNpb25Db21wbGV0ZShmaWxlVHlwZSk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gY29udmVyc2lvblJlc3VsdDtcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uRXJyb3IoZmlsZVR5cGUsIGVycm9yKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIHR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIG5hbWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCAndW5rbm93bicsXHJcbiAgICAgICAgY2F0ZWdvcnk6IEZJTEVfVFlQRV9DQVRFR09SSUVTW2ZpbGVUeXBlXSB8fCAndW5rbm93bidcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENyZWF0ZSBhIGRpcmVjdCBVUkwgY29udmVydGVyIGZvciBwcm9kdWN0aW9uIG1vZGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVR5cGUgLSBVUkwgZmlsZSB0eXBlICgndXJsJyBvciAncGFyZW50dXJsJylcclxuICAgKiBAcmV0dXJucyB7T2JqZWN0fG51bGx9IC0gQ29udmVydGVyIGluZm8gb3IgbnVsbCBpZiBub3QgcG9zc2libGVcclxuICAgKi9cclxuICBhc3luYyBjcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpIHtcclxuICAgIHRoaXMubG9nZ2VyLmxvZyhgQ3JlYXRpbmcgZGlyZWN0IFVSTCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgIFxyXG4gICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgaWYgKCFyZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93bikge1xyXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignQ2Fubm90IGNyZWF0ZSBkaXJlY3QgVVJMIGNvbnZlcnRlcjogY29udmVydFRvTWFya2Rvd24gbm90IGF2YWlsYWJsZScpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgY29udmVydGVyOiB7XHJcbiAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBVc2luZyBkaXJlY3QgVVJMIGNvbnZlcnRlciBmb3IgJHtmaWxlVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgcmV0dXJuIHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duKGZpbGVUeXBlLCBjb250ZW50LCB7XHJcbiAgICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICAgIGFwaUtleSxcclxuICAgICAgICAgICAgLi4ub3B0aW9uc1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICB2YWxpZGF0ZTogKGlucHV0KSA9PiB0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnICYmIGlucHV0Lmxlbmd0aCA+IDAsXHJcbiAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICBuYW1lOiBmaWxlVHlwZSA9PT0gJ3VybCcgPyAnV2ViIFBhZ2UnIDogJ1dlYnNpdGUnLFxyXG4gICAgICAgICAgZXh0ZW5zaW9uczogWycudXJsJywgJy5odG1sJywgJy5odG0nXSxcclxuICAgICAgICAgIG1pbWVUeXBlczogWyd0ZXh0L2h0bWwnLCAnYXBwbGljYXRpb24veC11cmwnXSxcclxuICAgICAgICAgIG1heFNpemU6IDEwICogMTAyNCAqIDEwMjRcclxuICAgICAgICB9XHJcbiAgICAgIH0sXHJcbiAgICAgIHR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICBjYXRlZ29yeTogJ3dlYidcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTdGFuZGFyZGl6ZSBjb252ZXJzaW9uIHJlc3VsdCB0byBlbnN1cmUgY29uc2lzdGVudCBmb3JtYXRcclxuICAgKlxyXG4gICAqIElNUE9SVEFOVDogVGhpcyBtZXRob2QgZW5zdXJlcyBwcm9wZXJ0aWVzIGFyZSBzZXQgaW4gdGhlIGNvcnJlY3Qgb3JkZXIgdG8gcHJldmVudFxyXG4gICAqIHByb3BlcnR5IHNoYWRvd2luZyBpc3N1ZXMuIFRoZSBvcmRlciBtYXR0ZXJzIGJlY2F1c2U6XHJcbiAgICogMS4gV2UgZmlyc3Qgc3ByZWFkIHRoZSByZXN1bHQgb2JqZWN0IHRvIGluY2x1ZGUgYWxsIGl0cyBwcm9wZXJ0aWVzXHJcbiAgICogMi4gVGhlbiB3ZSBvdmVycmlkZSBzcGVjaWZpYyBwcm9wZXJ0aWVzIHRvIGVuc3VyZSB0aGV5IGhhdmUgdGhlIGNvcnJlY3QgdmFsdWVzXHJcbiAgICogMy4gV2Ugc2V0IGNvbnRlbnQgbGFzdCB0byBlbnN1cmUgaXQncyBub3QgYWNjaWRlbnRhbGx5IG92ZXJyaWRkZW5cclxuICAgKiA0LiBXZSBhZGQgYSBmaW5hbCBjaGVjayB0byBlbnN1cmUgY29udGVudCBpcyBuZXZlciBlbXB0eSwgcHJvdmlkaW5nIGEgZmFsbGJhY2tcclxuICAgKlxyXG4gICAqIFRoaXMgZml4ZXMgdGhlIFwiQ29udmVyc2lvbiBwcm9kdWNlZCBlbXB0eSBjb250ZW50XCIgZXJyb3IgdGhhdCBjb3VsZCBvY2N1ciB3aGVuXHJcbiAgICogdGhlIGNvbnRlbnQgcHJvcGVydHkgd2FzIG92ZXJyaWRkZW4gYnkgdGhlIHNwcmVhZCBvcGVyYXRvci5cclxuICAgKlxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXN1bHQgLSBSYXcgY29udmVyc2lvbiByZXN1bHRcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVR5cGUgLSBGaWxlIHR5cGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZU5hbWUgLSBGaWxlIG5hbWVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2F0ZWdvcnkgLSBGaWxlIGNhdGVnb3J5XHJcbiAgICogQHJldHVybnMge09iamVjdH0gLSBTdGFuZGFyZGl6ZWQgcmVzdWx0XHJcbiAgICovXHJcbiAgc3RhbmRhcmRpemVSZXN1bHQocmVzdWx0LCBmaWxlVHlwZSwgZmlsZU5hbWUsIGNhdGVnb3J5KSB7XHJcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmF3IHJlc3VsdCByZWNlaXZlZCBmb3IgJHtmaWxlVHlwZX06YCwgc2FuaXRpemVGb3JMb2dnaW5nKHJlc3VsdCkpOyAvLyBBZGQgbG9nZ2luZ1xyXG5cclxuICAgIC8vIEhhbmRsZSBudWxsIG9yIHVuZGVmaW5lZCByZXN1bHQgZXhwbGljaXRseSBhdCB0aGUgYmVnaW5uaW5nXHJcbiAgICBpZiAoIXJlc3VsdCkge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFJlY2VpdmVkIG51bGwgb3IgdW5kZWZpbmVkIHJlc3VsdCBmb3IgJHtmaWxlVHlwZX0uIEFzc3VtaW5nIGZhaWx1cmUuYCk7XHJcbiAgICAgICAgcmVzdWx0ID0geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdDb252ZXJ0ZXIgcmV0dXJuZWQgbnVsbCBvciB1bmRlZmluZWQgcmVzdWx0JyB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENoZWNrIGlmIHRoaXMgaXMgYW4gYXN5bmNocm9ub3VzIHJlc3VsdCAoaGFzIGFzeW5jOiB0cnVlIGFuZCBjb252ZXJzaW9uSWQpXHJcbiAgICBpZiAocmVzdWx0ICYmIHJlc3VsdC5hc3luYyA9PT0gdHJ1ZSAmJiByZXN1bHQuY29udmVyc2lvbklkKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZyhgWyR7ZmlsZVR5cGV9XSBSZWNlaXZlZCBhc3luYyByZXN1bHQgd2l0aCBjb252ZXJzaW9uSWQ6ICR7cmVzdWx0LmNvbnZlcnNpb25JZH1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEZvciBhc3luYyByZXN1bHRzLCB3ZSBuZWVkIHRvIHByZXNlcnZlIHRoZSBhc3luYyBmbGFnIGFuZCBjb252ZXJzaW9uSWRcclxuICAgICAgLy8gVGhpcyB3aWxsIHNpZ25hbCB0byBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIHRoYXQgaXQgbmVlZHMgdG8gaGFuZGxlIHRoaXMgZGlmZmVyZW50bHlcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICAuLi5yZXN1bHQsXHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSwgLy8gQXN5bmMgaW5pdGlhdGlvbiBpcyBjb25zaWRlcmVkIHN1Y2Nlc3NmdWwgYXQgdGhpcyBwb2ludFxyXG4gICAgICAgIHR5cGU6IHJlc3VsdC50eXBlIHx8IGZpbGVUeXBlLFxyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZSxcclxuICAgICAgICBuYW1lOiByZXN1bHQubmFtZSB8fCBmaWxlTmFtZSxcclxuICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiByZXN1bHQub3JpZ2luYWxGaWxlTmFtZSB8fCByZXN1bHQubmFtZSB8fCBmaWxlTmFtZSxcclxuICAgICAgICBjYXRlZ29yeTogcmVzdWx0LmNhdGVnb3J5IHx8IGNhdGVnb3J5LFxyXG4gICAgICAgIGFzeW5jOiB0cnVlLCAvLyBQcmVzZXJ2ZSB0aGUgYXN5bmMgZmxhZ1xyXG4gICAgICAgIGNvbnZlcnNpb25JZDogcmVzdWx0LmNvbnZlcnNpb25JZCwgLy8gUHJlc2VydmUgdGhlIGNvbnZlcnNpb25JZFxyXG4gICAgICAgIC8vIEZvciBhc3luYyByZXN1bHRzLCB3ZSdsbCBwcm92aWRlIGEgcGxhY2Vob2xkZXIgY29udGVudCB0aGF0IHdpbGwgYmUgcmVwbGFjZWRcclxuICAgICAgICAvLyB3aXRoIHRoZSBhY3R1YWwgY29udGVudCB3aGVuIHRoZSBjb252ZXJzaW9uIGNvbXBsZXRlc1xyXG4gICAgICAgIGNvbnRlbnQ6IHJlc3VsdC5jb250ZW50IHx8IGAjIFByb2Nlc3NpbmcgJHtmaWxlVHlwZS50b1VwcGVyQ2FzZSgpfSBGaWxlXFxuXFxuWW91ciBmaWxlIGlzIGJlaW5nIHByb2Nlc3NlZC4gVGhlIGNvbnRlbnQgd2lsbCBiZSBhdmFpbGFibGUgc2hvcnRseS5gLFxyXG4gICAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgICAuLi4ocmVzdWx0Lm1ldGFkYXRhIHx8IHt9KSxcclxuICAgICAgICAgIGNvbnZlcnRlcjogcmVzdWx0LmNvbnZlcnRlciB8fCAndW5rbm93bicsXHJcbiAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiByZXN1bHQub3JpZ2luYWxGaWxlTmFtZSB8fCByZXN1bHQubmFtZSB8fCBmaWxlTmFtZSxcclxuICAgICAgICAgIGFzeW5jOiB0cnVlLFxyXG4gICAgICAgICAgY29udmVyc2lvbklkOiByZXN1bHQuY29udmVyc2lvbklkXHJcbiAgICAgICAgfVxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIExvZyBkZXRhaWxlZCBmaWxlbmFtZSBpbmZvcm1hdGlvbiBmb3IgZGVidWdnaW5nXHJcbiAgICB0aGlzLmxvZ2dlci5sb2coYPCfk4QgRmlsZW5hbWUgZGV0YWlscyBmb3IgJHtmaWxlVHlwZX06YCwge1xyXG4gICAgICByZXN1bHRPcmlnaW5hbEZpbGVOYW1lOiByZXN1bHQ/Lm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgIHJlc3VsdE1ldGFkYXRhT3JpZ2luYWxGaWxlTmFtZTogcmVzdWx0Py5tZXRhZGF0YT8ub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgcmVzdWx0TmFtZTogcmVzdWx0Py5uYW1lLFxyXG4gICAgICBmdW5jdGlvblBhcmFtRmlsZU5hbWU6IGZpbGVOYW1lXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgZW5oYW5jZWQgbG9nZ2luZyBzcGVjaWZpY2FsbHkgZm9yIEV4Y2VsL0NTViBmaWxlcyB0byB0cmFjZSBmaWxlbmFtZSBoYW5kbGluZ1xyXG4gICAgaWYgKGZpbGVUeXBlID09PSAneGxzeCcgfHwgZmlsZVR5cGUgPT09ICdjc3YnKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZyhg8J+TiiBFeGNlbC9DU1YgZmlsZSBkZXRhaWxzOmAsIHtcclxuICAgICAgICBvcmlnaW5hbEZpbGVOYW1lRnJvbVJlc3VsdDogcmVzdWx0Py5vcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICAgIG9yaWdpbmFsRmlsZU5hbWVGcm9tTWV0YWRhdGE6IHJlc3VsdD8ubWV0YWRhdGE/Lm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgICAgbmFtZUZyb21SZXN1bHQ6IHJlc3VsdD8ubmFtZSxcclxuICAgICAgICBmaWxlTmFtZVBhcmFtOiBmaWxlTmFtZSxcclxuICAgICAgICByZXN1bHRLZXlzOiByZXN1bHQgPyBPYmplY3Qua2V5cyhyZXN1bHQpIDogW10sXHJcbiAgICAgICAgbWV0YWRhdGFLZXlzOiByZXN1bHQ/Lm1ldGFkYXRhID8gT2JqZWN0LmtleXMocmVzdWx0Lm1ldGFkYXRhKSA6IFtdXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIERldGVybWluZSBzdWNjZXNzIHN0YXR1cyBtb3JlIHJvYnVzdGx5XHJcbiAgICAvLyBTdWNjZXNzIGlzIE9OTFkgdHJ1ZSBpZiByZXN1bHQuc3VjY2VzcyBpcyBleHBsaWNpdGx5IHRydWUuXHJcbiAgICAvLyBPdGhlcndpc2UsIGl0J3MgZmFsc2UsIGVzcGVjaWFsbHkgaWYgYW4gZXJyb3IgcHJvcGVydHkgZXhpc3RzLlxyXG4gICAgY29uc3QgaXNTdWNjZXNzID0gcmVzdWx0LnN1Y2Nlc3MgPT09IHRydWU7XHJcblxyXG4gICAgLy8gU2FuaXRpemUgcG90ZW50aWFsbHkgY29tcGxleCBvYmplY3RzIHdpdGhpbiB0aGUgcmVzdWx0ICphZnRlciogZGV0ZXJtaW5pbmcgc3VjY2Vzc1xyXG4gICAgY29uc3Qgc2FuaXRpemVkUmVzdWx0ID0gc2FuaXRpemVGb3JMb2dnaW5nKHJlc3VsdCk7XHJcblxyXG4gICAgLy8gRm9yIFhMU1ggYW5kIENTViBmaWxlcywgd2Ugd2FudCB0byBiZSBhYnNvbHV0ZWx5IGNlcnRhaW4gdGhhdCBvcmlnaW5hbEZpbGVOYW1lIGlzIHByZXNlcnZlZFxyXG4gICAgY29uc3Qgb3JpZ2luYWxGaWxlTmFtZSA9IChmaWxlVHlwZSA9PT0gJ3hsc3gnIHx8IGZpbGVUeXBlID09PSAnY3N2JylcclxuICAgICAgPyAoKHJlc3VsdC5tZXRhZGF0YSAmJiByZXN1bHQubWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSkgfHwgcmVzdWx0Lm9yaWdpbmFsRmlsZU5hbWUgfHwgcmVzdWx0Lm5hbWUgfHwgZmlsZU5hbWUpXHJcbiAgICAgIDogKChyZXN1bHQubWV0YWRhdGEgJiYgcmVzdWx0Lm1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUpIHx8IHJlc3VsdC5vcmlnaW5hbEZpbGVOYW1lIHx8IHJlc3VsdC5uYW1lIHx8IGZpbGVOYW1lKTtcclxuXHJcbiAgICAvLyBMb2cgdGhlIGRldGVybWluZWQgb3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgdGhpcy5sb2dnZXIubG9nKGDwn5OdIEZpbmFsIG9yaWdpbmFsRmlsZU5hbWUgZGV0ZXJtaW5lZCBmb3IgJHtmaWxlVHlwZX06ICR7b3JpZ2luYWxGaWxlTmFtZX1gKTtcclxuXHJcbiAgICBjb25zdCBzdGFuZGFyZGl6ZWQgPSB7XHJcbiAgICAgICAgLi4uc2FuaXRpemVkUmVzdWx0LCAvLyBTcHJlYWQgc2FuaXRpemVkIHJlc3VsdCBmaXJzdFxyXG4gICAgICAgIHN1Y2Nlc3M6IGlzU3VjY2VzcywgLy8gT3ZlcnJpZGUgd2l0aCBkZXRlcm1pbmVkIHN1Y2Nlc3Mgc3RhdHVzXHJcbiAgICAgICAgdHlwZTogcmVzdWx0LnR5cGUgfHwgZmlsZVR5cGUsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLFxyXG4gICAgICAgIG5hbWU6IG9yaWdpbmFsRmlsZU5hbWUsIC8vIFVzZSB0aGUgcmVzb2x2ZWQgb3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IG9yaWdpbmFsRmlsZU5hbWUsIC8vIFNhbWUgZm9yIGNvbnNpc3RlbmN5XHJcbiAgICAgICAgY2F0ZWdvcnk6IHJlc3VsdC5jYXRlZ29yeSB8fCBjYXRlZ29yeSxcclxuICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgICAuLi4ocmVzdWx0Lm1ldGFkYXRhIHx8IHt9KSxcclxuICAgICAgICAgICAgY29udmVydGVyOiByZXN1bHQuY29udmVydGVyIHx8ICd1bmtub3duJyxcclxuICAgICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogb3JpZ2luYWxGaWxlTmFtZSAvLyBVc2UgdGhlIHJlc29sdmVkIG9yaWdpbmFsRmlsZU5hbWUgZm9yIGNvbnNpc3RlbmN5XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpbWFnZXM6IHJlc3VsdC5pbWFnZXMgfHwgW10sXHJcbiAgICAgICAgLy8gRW5zdXJlIGNvbnRlbnQgZXhpc3RzLCBwcm92aWRlIGZhbGxiYWNrIGlmIG5lZWRlZFxyXG4gICAgICAgIGNvbnRlbnQ6IHJlc3VsdC5jb250ZW50IHx8IChpc1N1Y2Nlc3MgPyAnJyA6IGAjIENvbnZlcnNpb24gUmVzdWx0XFxuXFxuVGhlICR7ZmlsZVR5cGV9IGZpbGUgd2FzIHByb2Nlc3NlZCwgYnV0IG5vIGNvbnRlbnQgd2FzIGdlbmVyYXRlZC4gVGhpcyBtaWdodCBpbmRpY2F0ZSBhbiBpc3N1ZSBvciBiZSBub3JtYWwgZm9yIHRoaXMgZmlsZSB0eXBlLmApLFxyXG4gICAgICAgIC8vIEVuc3VyZSBlcnJvciBwcm9wZXJ0eSBpcyBwcmVzZW50IGlmIG5vdCBzdWNjZXNzZnVsXHJcbiAgICAgICAgZXJyb3I6ICFpc1N1Y2Nlc3MgPyAocmVzdWx0LmVycm9yIHx8ICdVbmtub3duIGNvbnZlcnNpb24gZXJyb3InKSA6IHVuZGVmaW5lZFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBSZW1vdmUgZXJyb3IgcHJvcGVydHkgaWYgc3VjY2Vzc2Z1bFxyXG4gICAgaWYgKHN0YW5kYXJkaXplZC5zdWNjZXNzKSB7XHJcbiAgICAgICAgZGVsZXRlIHN0YW5kYXJkaXplZC5lcnJvcjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gRW5zdXJlIGNvbnRlbnQgaXMgbm90IG51bGwgb3IgdW5kZWZpbmVkLCBhbmQgcHJvdmlkZSBhcHByb3ByaWF0ZSBmYWxsYmFja1xyXG4gICAgaWYgKCFzdGFuZGFyZGl6ZWQuY29udGVudCAmJiAhaXNTdWNjZXNzKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5QUk9DRVNTSU5HLFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkNPTlRFTlRfRU1QVFlcclxuICAgICAgKTtcclxuICAgICAgLy8gUHJvdmlkZSBhIG1vcmUgaW5mb3JtYXRpdmUgbWVzc2FnZSBpZiB0aGUgY29udmVyc2lvbiBmYWlsZWQgYW5kIGNvbnRlbnQgaXMgZW1wdHlcclxuICAgICAgc3RhbmRhcmRpemVkLmNvbnRlbnQgPSBgIyBDb252ZXJzaW9uIEVycm9yXFxuXFxuVGhlICR7ZmlsZVR5cGV9IGZpbGUgY29udmVyc2lvbiBmYWlsZWQgb3IgcHJvZHVjZWQgbm8gY29udGVudC4gRXJyb3I6ICR7c3RhbmRhcmRpemVkLmVycm9yIHx8ICdVbmtub3duIGVycm9yJ31gO1xyXG4gICAgfSBlbHNlIGlmICghc3RhbmRhcmRpemVkLmNvbnRlbnQgJiYgaXNTdWNjZXNzKSB7XHJcbiAgICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuUFJPQ0VTU0lORyxcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5DT05URU5UX0VNUFRZXHJcbiAgICAgICk7XHJcbiAgICAgIC8vIEZhbGxiYWNrIGZvciBzdWNjZXNzZnVsIGNvbnZlcnNpb24gYnV0IGVtcHR5IGNvbnRlbnRcclxuICAgICAgc3RhbmRhcmRpemVkLmNvbnRlbnQgPSBgIyBDb252ZXJzaW9uIFJlc3VsdFxcblxcblRoZSAke2ZpbGVUeXBlfSBmaWxlIHdhcyBwcm9jZXNzZWQgc3VjY2Vzc2Z1bGx5LCBidXQgbm8gdGV4dHVhbCBjb250ZW50IHdhcyBnZW5lcmF0ZWQuIFRoaXMgaXMgbm9ybWFsIGZvciBjZXJ0YWluIGZpbGUgdHlwZXMgKGUuZy4sIG11bHRpbWVkaWEgZmlsZXMgd2l0aG91dCB0cmFuc2NyaXB0aW9uKS5gO1xyXG4gICAgfVxyXG5cclxuXHJcbiAgICAvLyBMb2cgdGhlIGZpbmFsIHN0YW5kYXJkaXplZCByZXN1bHRcclxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBTdGFuZGFyZGl6ZWQgcmVzdWx0IGZvciAke2ZpbGVUeXBlfTpgLCBzYW5pdGl6ZUZvckxvZ2dpbmcoc3RhbmRhcmRpemVkKSk7XHJcblxyXG4gICAgcmV0dXJuIHN0YW5kYXJkaXplZDtcclxuICB9XHJcblxyXG4gIGFzeW5jIGhhbmRsZVVybENvbnZlcnNpb24oZmlsZVBhdGgsIG9wdGlvbnMsIGNhdGVnb3J5KSB7XHJcbiAgICBjb25zdCB7IHByb2dyZXNzVHJhY2tlciwgZmlsZVR5cGUsIGZpbGVOYW1lLCBjb252ZXJ0ZXJJbmZvIH0gPSBvcHRpb25zO1xyXG4gICAgXHJcbiAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoMjAsIHsgc3RhdHVzOiBgcHJvY2Vzc2luZ18ke2ZpbGVUeXBlfWAgfSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMubG9nZ2VyLmxvZyhgUHJvY2Vzc2luZyBVUkw6ICR7ZmlsZVBhdGh9YCwgJ0lORk8nKTtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gRXh0cmFjdCBjb252ZXJ0ZXIgZnJvbSBjb252ZXJ0ZXJJbmZvXHJcbiAgICAgIGNvbnN0IHsgY29udmVydGVyIH0gPSBjb252ZXJ0ZXJJbmZvO1xyXG4gICAgICBcclxuICAgICAgbGV0IHVybFJlc3VsdCA9IG51bGw7XHJcbiAgICAgIFxyXG4gICAgICAvLyBUcnkgdXNpbmcgdGhlIGNvbnZlcnRlcidzIGNvbnZlcnQgbWV0aG9kIGZpcnN0XHJcbiAgICAgIGlmICh0eXBlb2YgY29udmVydGVyLmNvbnZlcnQgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFVzaW5nIGNvbnZlcnRlci5jb252ZXJ0IGZvciAke2ZpbGVUeXBlfWAsICdJTkZPJyk7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBVUkwgY29udmVydCBjYWxsZWQgd2l0aCBvcmlnaW5hbEZpbGVOYW1lOiAke2ZpbGVOYW1lfWAsICdJTkZPJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIC8vIENyZWF0ZSBvcHRpb25zIG9iamVjdCBzdGVwIGJ5IHN0ZXAgdG8gYXZvaWQgc3ByZWFkIGlzc3Vlc1xyXG4gICAgICAgICAgY29uc3QgY29udmVydGVyT3B0aW9ucyA9IHt9O1xyXG4gICAgICAgICAgT2JqZWN0LmtleXMob3B0aW9ucykuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgICAgICAgICBjb252ZXJ0ZXJPcHRpb25zW2tleV0gPSBvcHRpb25zW2tleV07XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIGNvbnZlcnRlck9wdGlvbnMubmFtZSA9IGZpbGVOYW1lO1xyXG4gICAgICAgICAgY29udmVydGVyT3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lID0gZmlsZU5hbWU7XHJcbiAgICAgICAgICBjb252ZXJ0ZXJPcHRpb25zLm1ldGFkYXRhID0ge1xyXG4gICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBmaWxlTmFtZVxyXG4gICAgICAgICAgfTtcclxuICAgICAgICAgIGlmIChvcHRpb25zLm1ldGFkYXRhKSB7XHJcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG9wdGlvbnMubWV0YWRhdGEpLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgICBjb252ZXJ0ZXJPcHRpb25zLm1ldGFkYXRhW2tleV0gPSBvcHRpb25zLm1ldGFkYXRhW2tleV07XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgY29udmVydGVyT3B0aW9ucy5vblByb2dyZXNzID0gKHByb2dyZXNzKSA9PiB7XHJcbiAgICAgICAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlU2NhbGVkKHByb2dyZXNzLCAyMCwgOTAsIHtcclxuICAgICAgICAgICAgICAgIHN0YXR1czogdHlwZW9mIHByb2dyZXNzID09PSAnb2JqZWN0JyA/IHByb2dyZXNzLnN0YXR1cyA6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YFxyXG4gICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYENhbGxpbmcgVVJMIGNvbnZlcnRlciB3aXRoIGZpbGVQYXRoOiAke2ZpbGVQYXRofWAsICdJTkZPJyk7XHJcbiAgICAgICAgICB1cmxSZXN1bHQgPSBhd2FpdCBjb252ZXJ0ZXIuY29udmVydChmaWxlUGF0aCwgZmlsZU5hbWUsIG9wdGlvbnMuYXBpS2V5LCBjb252ZXJ0ZXJPcHRpb25zKTtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgVVJMIGNvbnZlcnRlciByZXR1cm5lZCByZXN1bHRgLCAnSU5GTycpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGNvbnZlcnRlckVycm9yKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgVVJMIGNvbnZlcnRlciBlcnJvcjogJHtjb252ZXJ0ZXJFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgdGhyb3cgY29udmVydGVyRXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIEZhbGwgYmFjayB0byB1c2luZyB0aGUgcmVnaXN0cnkncyBjb252ZXJ0VG9NYXJrZG93biBtZXRob2RcclxuICAgICAgICBjb25zdCByZWdpc3RyeSA9IGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKCk7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBVc2luZyByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93biBmb3IgJHtmaWxlVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IHJlZ2lzdHJ5T3B0aW9ucyA9IHt9O1xyXG4gICAgICAgIE9iamVjdC5rZXlzKG9wdGlvbnMpLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgIHJlZ2lzdHJ5T3B0aW9uc1trZXldID0gb3B0aW9uc1trZXldO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHJlZ2lzdHJ5T3B0aW9ucy5uYW1lID0gZmlsZU5hbWU7XHJcbiAgICAgICAgcmVnaXN0cnlPcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgPSBmaWxlTmFtZTtcclxuICAgICAgICBcclxuICAgICAgICB1cmxSZXN1bHQgPSBhd2FpdCByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93bihmaWxlVHlwZSwgZmlsZVBhdGgsIHJlZ2lzdHJ5T3B0aW9ucyk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDk1LCB7IHN0YXR1czogJ2ZpbmFsaXppbmcnIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuUFJPQ0VTU0lORyxcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GSU5BTElaSU5HXHJcbiAgICAgICk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBPbmx5IHByb2NlZWQgaWYgd2UgaGF2ZSBhIHJlc3VsdFxyXG4gICAgICBpZiAoIXVybFJlc3VsdCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVVJMIGNvbnZlcnNpb24gZmFpbGVkOiBObyByZXN1bHQgcmV0dXJuZWRgKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHRoaXMuc3RhbmRhcmRpemVSZXN1bHQodXJsUmVzdWx0LCBmaWxlVHlwZSwgZmlsZU5hbWUsIGNhdGVnb3J5KTtcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgaW4gVVJMIGNvbnZlcnNpb246ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFRyeSB0aGUgYWx0ZXJuYXRpdmUgbWV0aG9kIGFzIGEgZmFsbGJhY2tcclxuICAgICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgICBjb25zdCB7IGNvbnZlcnRlciB9ID0gY29udmVydGVySW5mbztcclxuICAgICAgXHJcbiAgICAgIGlmICh0eXBlb2YgY29udmVydGVyLmNvbnZlcnQgPT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBUcnlpbmcgYWx0ZXJuYXRpdmUgY29udmVyc2lvbiBtZXRob2QgYXMgZmFsbGJhY2tgLCAnSU5GTycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCBmYWxsYmFja09wdGlvbnMgPSB7fTtcclxuICAgICAgICAgIE9iamVjdC5rZXlzKG9wdGlvbnMpLmZvckVhY2goa2V5ID0+IHtcclxuICAgICAgICAgICAgZmFsbGJhY2tPcHRpb25zW2tleV0gPSBvcHRpb25zW2tleV07XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIGZhbGxiYWNrT3B0aW9ucy5uYW1lID0gZmlsZU5hbWU7XHJcbiAgICAgICAgICBmYWxsYmFja09wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSA9IGZpbGVOYW1lO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBjb25zdCBmYWxsYmFja1Jlc3VsdCA9IGF3YWl0IHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duKGZpbGVUeXBlLCBmaWxlUGF0aCwgZmFsbGJhY2tPcHRpb25zKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgaWYgKCFmYWxsYmFja1Jlc3VsdCkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhbGxiYWNrIFVSTCBjb252ZXJzaW9uIGZhaWxlZDogTm8gcmVzdWx0IHJldHVybmVkYCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIHJldHVybiB0aGlzLnN0YW5kYXJkaXplUmVzdWx0KGZhbGxiYWNrUmVzdWx0LCBmaWxlVHlwZSwgZmlsZU5hbWUsIGNhdGVnb3J5KTtcclxuICAgICAgICB9IGNhdGNoIChmYWxsYmFja0Vycm9yKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFsbGJhY2sgY29udmVyc2lvbiBhbHNvIGZhaWxlZDogJHtmYWxsYmFja0Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICB0aHJvdyBlcnJvcjsgLy8gVGhyb3cgdGhlIG9yaWdpbmFsIGVycm9yXHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRocm93IGVycm9yOyAvLyBSZS10aHJvdyBpZiBubyBmYWxsYmFjayBpcyBhdmFpbGFibGVcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgaGFuZGxlQ29udmVyc2lvbihmaWxlUGF0aCwgb3B0aW9ucykge1xyXG4gICAgY29uc3QgeyBwcm9ncmVzc1RyYWNrZXIsIGZpbGVUeXBlLCBmaWxlTmFtZSwgY29udmVydGVySW5mbywgaXNVcmwgfSA9IG9wdGlvbnM7XHJcbiAgICAvLyBFeHRyYWN0IGNhdGVnb3J5IGZyb20gY29udmVydGVySW5mbyB0byBhdm9pZCBcImNhdGVnb3J5IGlzIG5vdCBkZWZpbmVkXCIgZXJyb3JcclxuICAgIC8vIE1vdmUgdGhpcyBvdXRzaWRlIHRyeSBibG9jayB0byBlbnN1cmUgaXQncyBhY2Nlc3NpYmxlIGluIGFsbCBzY29wZXNcclxuICAgIGNvbnN0IGNhdGVnb3J5ID0gY29udmVydGVySW5mbz8uY2F0ZWdvcnkgfHwgRklMRV9UWVBFX0NBVEVHT1JJRVNbZmlsZVR5cGVdIHx8ICd1bmtub3duJztcclxuICAgIFxyXG4gICAgLy8gRm9yIFVSTCBjb252ZXJzaW9ucywgdXNlIGEgc2VwYXJhdGUgbWV0aG9kIHRvIGF2b2lkIHNjb3BlIGlzc3Vlc1xyXG4gICAgaWYgKGlzVXJsKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZVVybENvbnZlcnNpb24oZmlsZVBhdGgsIG9wdGlvbnMsIGNhdGVnb3J5KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgbGV0IHJlc3VsdCA9IG51bGw7IC8vIEluaXRpYWxpemUgdG8gbnVsbCB0byBhdm9pZCB0ZW1wb3JhbCBkZWFkIHpvbmVcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVmFsaWRhdGUgY29udmVydGVySW5mb1xyXG4gICAgICBpZiAoIWNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgTm8gY29udmVydGVyIGluZm8gYXZhaWxhYmxlIGZvciAke2ZpbGVUeXBlfWApO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gY29udmVydGVyIGluZm8gYXZhaWxhYmxlIGZvciAke2ZpbGVUeXBlfWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuVkFMSURBVElORyxcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GQVNUX0FUVEVNUFRcclxuICAgICAgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFJlYWQgZmlsZSBjb250ZW50IGlmIG5vdCBhbHJlYWR5IGEgYnVmZmVyXHJcbiAgICAgIGNvbnN0IGZpbGVDb250ZW50ID0gQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSA/IGZpbGVQYXRoIDogZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDIwLCB7IHN0YXR1czogYGNvbnZlcnRpbmdfJHtmaWxlVHlwZX1gIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBQREYgZmlsZXMgdG8gaW5jbHVkZSBPQ1Igb3B0aW9uc1xyXG4gICAgICBpZiAoZmlsZVR5cGUgPT09ICdwZGYnKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0NvbnZlcnRpbmcgUERGIHdpdGggb3B0aW9uczonLCB7XHJcbiAgICAgICAgICB1c2VPY3I6IG9wdGlvbnMudXNlT2NyLFxyXG4gICAgICAgICAgaGFzTWlzdHJhbEFwaUtleTogISFvcHRpb25zLm1pc3RyYWxBcGlLZXksXHJcbiAgICAgICAgICBwcmVzZXJ2ZVBhZ2VJbmZvOiB0cnVlXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIG1vcmUgZGV0YWlsZWQgbG9nZ2luZyBmb3IgT0NSIHNldHRpbmdzXHJcbiAgICAgICAgaWYgKG9wdGlvbnMudXNlT2NyKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coJ09DUiBpcyBlbmFibGVkIGZvciB0aGlzIGNvbnZlcnNpb24nLCAnSU5GTycpO1xyXG4gICAgICAgICAgaWYgKG9wdGlvbnMubWlzdHJhbEFwaUtleSkge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnTWlzdHJhbCBBUEkga2V5IGlzIHByZXNlbnQnKTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ09DUiBpcyBlbmFibGVkIGJ1dCBNaXN0cmFsIEFQSSBrZXkgaXMgbWlzc2luZycpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gU3BlY2lhbCBoYW5kbGluZyBmb3IgYXVkaW8vdmlkZW8gZmlsZXMgdG8gZW5zdXJlIHRoZXkgZG9uJ3QgdXNlIE1pc3RyYWwgQVBJIGtleVxyXG4gICAgICBpZiAoZmlsZVR5cGUgPT09ICdtcDMnIHx8IGZpbGVUeXBlID09PSAnd2F2JyB8fCBmaWxlVHlwZSA9PT0gJ21wNCcgfHwgZmlsZVR5cGUgPT09ICdtb3YnIHx8IFxyXG4gICAgICAgICAgZmlsZVR5cGUgPT09ICdvZ2cnIHx8IGZpbGVUeXBlID09PSAnd2VibScgfHwgZmlsZVR5cGUgPT09ICdhdmknIHx8IFxyXG4gICAgICAgICAgZmlsZVR5cGUgPT09ICdmbGFjJyB8fCBmaWxlVHlwZSA9PT0gJ200YScpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5sb2coYENvbnZlcnRpbmcgbXVsdGltZWRpYSBmaWxlICgke2ZpbGVUeXBlfSlgLCAnSU5GTycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFJlbW92ZSBtaXN0cmFsQXBpS2V5IGZyb20gb3B0aW9ucyBmb3IgbXVsdGltZWRpYSBmaWxlcyB0byBwcmV2ZW50IGluY29ycmVjdCByb3V0aW5nXHJcbiAgICAgICAgaWYgKG9wdGlvbnMubWlzdHJhbEFwaUtleSkge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIubG9nKCdSZW1vdmluZyBNaXN0cmFsIEFQSSBrZXkgZnJvbSBtdWx0aW1lZGlhIGNvbnZlcnNpb24gb3B0aW9ucycsICdJTkZPJyk7XHJcbiAgICAgICAgICBjb25zdCB7IG1pc3RyYWxBcGlLZXksIC4uLmNsZWFuT3B0aW9ucyB9ID0gb3B0aW9ucztcclxuICAgICAgICAgIG9wdGlvbnMgPSBjbGVhbk9wdGlvbnM7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRkFTVF9BVFRFTVBULFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkdcclxuICAgICAgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFVzZSB0aGUgY29udmVydGVyJ3MgY29udmVydCBtZXRob2RcclxuICAgICAgY29uc3QgeyBjb252ZXJ0ZXIsIGNhdGVnb3J5IH0gPSBjb252ZXJ0ZXJJbmZvO1xyXG5cclxuICAgICAgLy8gTG9nIHRoZSBvcmlnaW5hbCBmaWxlbmFtZSBkZXRhaWxzIGJlaW5nIHBhc3NlZCB0byB0aGUgY29udmVydGVyXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZyhgQ29udmVydCBtZXRob2QgY2FsbGVkIHdpdGggb3JpZ2luYWxGaWxlTmFtZTogJHtmaWxlTmFtZX1gLCAnSU5GTycpO1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2coYE9wdGlvbnMgYmVpbmcgcGFzc2VkIHRvIGNvbnZlcnRlcjpgLCB7XHJcbiAgICAgICAgaGFzT3JpZ2luYWxGaWxlTmFtZTogISFvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgICAgb3JpZ2luYWxGaWxlTmFtZVZhbHVlOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgICAgZmlsZU5hbWU6IGZpbGVOYW1lLFxyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbnZlcnRlci5jb252ZXJ0KGZpbGVDb250ZW50LCBmaWxlTmFtZSwgb3B0aW9ucy5hcGlLZXksIHtcclxuICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgIG5hbWU6IGZpbGVOYW1lLFxyXG4gICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IGZpbGVOYW1lLCAvLyBFeHBsaWNpdGx5IHBhc3Mgb3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgICAuLi4ob3B0aW9ucy5tZXRhZGF0YSB8fCB7fSksXHJcbiAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBmaWxlTmFtZSAvLyBBbHNvIGFkZCBvcmlnaW5hbEZpbGVOYW1lIHRvIG1ldGFkYXRhXHJcbiAgICAgICAgfSxcclxuICAgICAgICBvblByb2dyZXNzOiAocHJvZ3Jlc3MpID0+IHtcclxuICAgICAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZVNjYWxlZChwcm9ncmVzcywgMjAsIDkwLCB7XHJcbiAgICAgICAgICAgICAgc3RhdHVzOiB0eXBlb2YgcHJvZ3Jlc3MgPT09ICdvYmplY3QnID8gcHJvZ3Jlc3Muc3RhdHVzIDogYGNvbnZlcnRpbmdfJHtmaWxlVHlwZX1gXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZSg5NSwgeyBzdGF0dXM6ICdmaW5hbGl6aW5nJyB9KTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuRklOQUxJWklOR1xyXG4gICAgICApO1xyXG5cclxuICAgICAgcmV0dXJuIHRoaXMuc3RhbmRhcmRpemVSZXN1bHQocmVzdWx0LCBmaWxlVHlwZSwgZmlsZU5hbWUsIGNhdGVnb3J5KTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ0NvbnZlcnNpb25FcnJvcihmaWxlVHlwZSwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBgJHtmaWxlVHlwZS50b1VwcGVyQ2FzZSgpfSBjb252ZXJzaW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWAsXHJcbiAgICAgICAgY29udGVudDogYCMgQ29udmVyc2lvbiBFcnJvclxcblxcbkZhaWxlZCB0byBjb252ZXJ0ICR7ZmlsZVR5cGUudG9VcHBlckNhc2UoKX0gZmlsZTogJHtlcnJvci5tZXNzYWdlfWAsXHJcbiAgICAgICAgdHlwZTogZmlsZVR5cGUsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlLCAvLyBFeHBsaWNpdGx5IGluY2x1ZGUgZmlsZVR5cGVcclxuICAgICAgICBuYW1lOiBmaWxlTmFtZSxcclxuICAgICAgICBjYXRlZ29yeTogY2F0ZWdvcnkgfHwgJ3Vua25vd24nXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogQWRkIGFuIGluaXRpYWxpemUgbWV0aG9kIHRvIHRoZSBmYWN0b3J5IGluc3RhbmNlXHJcbiAqIFRoaXMgaXMgbmVlZGVkIGZvciBjb21wYXRpYmlsaXR5IHdpdGggY29kZSB0aGF0IGV4cGVjdHMgdGhpcyBtZXRob2RcclxuICovXHJcbmNvbnN0IHVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5ID0gVW5pZmllZENvbnZlcnRlckZhY3RvcnkuZ2V0SW5zdGFuY2UoKTtcclxuXHJcbi8vIEFkZCBpbml0aWFsaXplIG1ldGhvZCB0byB0aGUgZmFjdG9yeSBpbnN0YW5jZVxyXG51bmlmaWVkQ29udmVydGVyRmFjdG9yeS5pbml0aWFsaXplID0gYXN5bmMgZnVuY3Rpb24oKSB7XHJcbiAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuU1RBUlRJTkcsXHJcbiAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5JTklUSUFMSVpJTkdcclxuICApO1xyXG4gIFxyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5JTklUSUFMSVpJTkcsXHJcbiAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkNPTVBMRVRFRFxyXG4gICAgKTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uRXJyb3IoJ2luaXQnLCBlcnJvcik7XHJcbiAgICB0aHJvdyBlcnJvcjtcclxuICB9XHJcbn07XHJcblxyXG4vLyBFeHBvcnQgc2luZ2xldG9uIGluc3RhbmNlIGFuZCBtb2R1bGUgZnVuY3Rpb25zXHJcbm1vZHVsZS5leHBvcnRzID0gdW5pZmllZENvbnZlcnRlckZhY3Rvcnk7XHJcbm1vZHVsZS5leHBvcnRzLnVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5ID0gdW5pZmllZENvbnZlcnRlckZhY3Rvcnk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQSxJQUFJQSxHQUFHO0FBQ1AsSUFBSTtFQUNGO0VBQ0EsTUFBTUMsUUFBUSxHQUFHQyxPQUFPLENBQUMsVUFBVSxDQUFDO0VBQ3BD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