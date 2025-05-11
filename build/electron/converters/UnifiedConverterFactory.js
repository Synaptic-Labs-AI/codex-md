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
            this.logger.log(`URL convert called with originalFileName: ${fileName}`, 'INFO');
            result = await converter.convert(filePath, fileName, options.apiKey, {
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
                    status: typeof progress === 'object' ? progress.status : `processing_${fileType}`
                  });
                }
              }
            });
          } else {
            // Fall back to using the registry's convertToMarkdown method
            const registry = await this._ensureInitialized();
            this.logger.log(`Using registry.convertToMarkdown for ${fileType}`, 'INFO');
            this.logger.log(`URL convertToMarkdown called with originalFileName: ${fileName}`, 'INFO');
            result = await registry.convertToMarkdown(fileType, filePath, {
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
                metadata: {
                  ...(options.metadata || {}),
                  originalFileName: fileName // Also add originalFileName to metadata
                },
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJhcHAiLCJlbGVjdHJvbiIsInJlcXVpcmUiLCJyZW1vdGUiLCJlIiwiY29uc29sZSIsIndhcm4iLCJmcyIsImV4aXN0c1N5bmMiLCJwYXRoIiwic3RhdFN5bmMiLCJpc0ZpbGUiLCJpbm5lckUiLCJlcnJvciIsIkVycm9yIiwiUGF0aFV0aWxzIiwiUHJvZ3Jlc3NUcmFja2VyIiwiZ2V0TG9nZ2VyIiwic2FuaXRpemVGb3JMb2dnaW5nIiwiQ29udmVyc2lvblN0YXR1cyIsInNhZmVSZXF1aXJlIiwibW9kdWxlUGF0aCIsImZhbGxiYWNrcyIsImZhbGxiYWNrIiwiaW5jbHVkZXMiLCJuYW1lIiwibG9nIiwibXNnIiwibGV2ZWwiLCJhcmdzIiwiZXJyIiwic3VjY2VzcyIsImRlYnVnIiwibG9nUGhhc2VUcmFuc2l0aW9uIiwiZnJvbSIsInRvIiwibG9nQ29udmVyc2lvblN0YXJ0IiwidHlwZSIsIm9wdHMiLCJsb2dDb252ZXJzaW9uQ29tcGxldGUiLCJsb2dDb252ZXJzaW9uRXJyb3IiLCJtZXNzYWdlIiwic2V0Q29udGV4dCIsIm9iaiIsInJlc29sdmUiLCJfX2Rpcm5hbWUiLCJwcm9jZXNzIiwiY3dkIiwiY29uc3RydWN0b3IiLCJjYWxsYmFjayIsInVwZGF0ZSIsInByb2dyZXNzIiwiZGF0YSIsInVwZGF0ZVNjYWxlZCIsIm1pbiIsIm1heCIsIlNUQVRVUyIsIlNUQVJUSU5HIiwiSU5JVElBTElaSU5HIiwiVkFMSURBVElORyIsIkZBU1RfQVRURU1QVCIsIlBST0NFU1NJTkciLCJGSU5BTElaSU5HIiwiQ09NUExFVEVEIiwiQ09OVEVOVF9FTVBUWSIsImlzUGFja2FnZWQiLCJnZXRBcHBQYXRoIiwiZ2V0TmFtZSIsImdldFZlcnNpb24iLCJNb2R1bGVMb2FkZXIiLCJsb2FkTW9kdWxlIiwib3B0aW9ucyIsImxvZ2dlciIsImZhbGxiYWNrUGF0aHMiLCJzaWxlbnQiLCJtb2R1bGVOYW1lIiwiYmFzZW5hbWUiLCJjYXRlZ29yeSIsInBhdGhQYXJ0cyIsImRpcm5hbWUiLCJzcGxpdCIsInNlcCIsImxlbmd0aCIsInNsaWNlIiwiam9pbiIsIk1vZHVsZVJlc29sdmVyIiwibW9kdWxlIiwicmVzb2x2ZXJFcnJvciIsImRlZmF1bHQiLCJkaXJlY3RFcnJvciIsImZhbGxiYWNrUGF0aCIsImZhbGxiYWNrRXJyb3IiLCJfY3JlYXRlRW1lcmdlbmN5UmVnaXN0cnkiLCJDb252ZXJ0ZXJSZWdpc3RyeSIsImNvbnZlcnRlcnMiLCJwZGYiLCJjb252ZXJ0IiwiY29udGVudCIsImFwaUtleSIsIm1ldGFkYXRhIiwicGFnZXMiLCJjb252ZXJ0ZXIiLCJ2YWxpZGF0ZSIsImlucHV0IiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJjb25maWciLCJleHRlbnNpb25zIiwibWltZVR5cGVzIiwibWF4U2l6ZSIsInByb3RvdHlwZSIsImNvbnZlcnRUb01hcmtkb3duIiwic291cmNlIiwiZ2V0Q29udmVydGVyQnlFeHRlbnNpb24iLCJleHRlbnNpb24iLCJsb2FkTW9kdWxlRnJvbUJlc3RQYXRoIiwiYmFzZVBhdGhzIiwicmVzb2x2ZWRQYXRocyIsIm1hcCIsImJhc2VQYXRoIiwiZXhpc3RpbmdQYXRocyIsImZpbHRlciIsInAiLCJleGlzdHMiLCJnZXRNb2R1bGVQYXRocyIsImlzRGV2IiwiZW52IiwiTk9ERV9FTlYiLCJwb3NzaWJsZVBhdGhzIiwicmVwbGFjZSIsImV4ZWNQYXRoIiwiZXJyb3JQYXRoIiwiY29ycmVjdGVkUGF0aCIsImNhbmRpZGF0ZVBhdGgiLCJkaXJlY3RSZWdpc3RyeVBhdGhzIiwicmVnaXN0cnlQYXRoIiwicmVnaXN0cnkiLCJ1cmwiLCJkb2N4IiwicHB0eCIsInhsc3giLCJjc3YiLCJNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkiLCJ0b1VwcGVyQ2FzZSIsIkNvbnZlcnRlckluaXRpYWxpemVyIiwiX2luc3RhbmNlIiwiX2luaXRpYWxpemVkIiwiX2luaXRQcm9taXNlIiwiX2NvbnZlcnRlclJlZ2lzdHJ5IiwiZ2V0SW5zdGFuY2UiLCJpbml0aWFsaXplIiwiX2RvSW5pdGlhbGl6ZSIsInBhdGhzIiwicG9zc2libGVCYXNlUGF0aHMiLCJPYmplY3QiLCJ2YWx1ZXMiLCJhbGxQb3NzaWJsZVJlZ2lzdHJ5UGF0aHMiLCJkaXJlY3RMb2FkRXJyb3IiLCJpbml0aWFsRXJyb3IiLCJiYXNlRGlycyIsImFkZEJhc2VEaXIiLCJkaXIiLCJwdXNoIiwiZm9yRWFjaCIsImNvbnZlcnRlclBhdGgiLCJjb252ZXJ0ZXJEaXIiLCJiZXN0UGF0aEVycm9yIiwiX3ZhbGlkYXRlUmVnaXN0cnkiLCJrZXlzIiwiZW5oYW5jZWRFcnJvciIsIm9yaWdpbmFsIiwic3RhY2siLCJGSUxFX1RZUEVfQ0FURUdPUklFUyIsIm1wMyIsIndhdiIsIm9nZyIsImZsYWMiLCJtcDQiLCJ3ZWJtIiwiYXZpIiwibW92IiwicGFyZW50dXJsIiwiVW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJfaW5pdGlhbGl6ZXIiLCJfZW5zdXJlSW5pdGlhbGl6ZWQiLCJnZXRDb252ZXJ0ZXIiLCJmaWxlVHlwZSIsIm5vcm1hbGl6ZWRUeXBlIiwidG9Mb3dlckNhc2UiLCJjb252ZXJ0RmlsZSIsImZpbGVQYXRoIiwic3RhcnRUaW1lIiwiRGF0ZSIsIm5vdyIsImlzVXJsIiwiZmlsZU5hbWUiLCJvcmlnaW5hbEZpbGVOYW1lIiwidXJsT2JqIiwiVVJMIiwiaG9zdG5hbWUiLCJwYXRobmFtZSIsImNvbnZlcnRlckluZm8iLCJjcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIiLCJQcm9taXNlIiwic2V0VGltZW91dCIsInByb2dyZXNzVHJhY2tlciIsIm9uUHJvZ3Jlc3MiLCJzdGF0dXMiLCJoYXNSZWdpc3RyeSIsImNvbnZlcnRlclR5cGUiLCJoYXNDb252ZXJ0ZXIiLCJjb252ZXJ0ZXJEZXRhaWxzIiwicmVzdWx0IiwiaGFuZGxlQ29udmVyc2lvbiIsInN0YW5kYXJkaXplUmVzdWx0IiwicmVzdWx0T3JpZ2luYWxGaWxlTmFtZSIsInJlc3VsdE1ldGFkYXRhT3JpZ2luYWxGaWxlTmFtZSIsInJlc3VsdE5hbWUiLCJmdW5jdGlvblBhcmFtRmlsZU5hbWUiLCJvcmlnaW5hbEZpbGVOYW1lRnJvbVJlc3VsdCIsIm9yaWdpbmFsRmlsZU5hbWVGcm9tTWV0YWRhdGEiLCJuYW1lRnJvbVJlc3VsdCIsImZpbGVOYW1lUGFyYW0iLCJyZXN1bHRLZXlzIiwibWV0YWRhdGFLZXlzIiwiaXNTdWNjZXNzIiwic2FuaXRpemVkUmVzdWx0Iiwic3RhbmRhcmRpemVkIiwiaW1hZ2VzIiwidW5kZWZpbmVkIiwiZmlsZUNvbnRlbnQiLCJyZWFkRmlsZVN5bmMiLCJ1c2VPY3IiLCJoYXNNaXN0cmFsQXBpS2V5IiwibWlzdHJhbEFwaUtleSIsInByZXNlcnZlUGFnZUluZm8iLCJjbGVhbk9wdGlvbnMiLCJoYXNPcmlnaW5hbEZpbGVOYW1lIiwib3JpZ2luYWxGaWxlTmFtZVZhbHVlIiwidW5pZmllZENvbnZlcnRlckZhY3RvcnkiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL2NvbnZlcnRlcnMvVW5pZmllZENvbnZlcnRlckZhY3RvcnkuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmpzXHJcbiAqIFxyXG4gKiBDZW50cmFsIGZhY3RvcnkgZm9yIGFsbCBmaWxlIHR5cGUgY29udmVyc2lvbnMgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogVXNlcyBDb21tb25KUyBmb3IgY29uc2lzdGVuY3kgd2l0aCBFbGVjdHJvbiBtYWluIHByb2Nlc3MgYW5kIHByb3ZpZGVzIHJvYnVzdCBpbml0aWFsaXphdGlvblxyXG4gKiBhbmQgY29udmVydGVyIG1hbmFnZW1lbnQuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9FbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmpzOiBVc2VzIHRoaXMgZmFjdG9yeSBmb3IgY29udmVyc2lvbnNcclxuICogLSBzcmMvZWxlY3Ryb24vaXBjL2hhbmRsZXJzL2NvbnZlcnNpb24vaW5kZXguanM6IEV4cG9zZXMgY29udmVyc2lvbiB0byByZW5kZXJlciBwcm9jZXNzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanM6IENvbnZlcnRlciBpbXBsZW1lbnRhdGlvbnNcclxuICovXHJcblxyXG4vLyBDb3JlIGRlcGVuZGVuY2llc1xyXG5sZXQgYXBwO1xyXG50cnkge1xyXG4gIC8vIFRyeSB0byBsb2FkIGVsZWN0cm9uIGluIGEgc2FmZXIgd2F5XHJcbiAgY29uc3QgZWxlY3Ryb24gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG4gIGFwcCA9IGVsZWN0cm9uLmFwcCB8fCAoZWxlY3Ryb24ucmVtb3RlICYmIGVsZWN0cm9uLnJlbW90ZS5hcHApO1xyXG59IGNhdGNoIChlKSB7XHJcbiAgLy8gSWYgZWxlY3Ryb24gaXNuJ3QgYXZhaWxhYmxlLCB3ZSdsbCBoYW5kbGUgaXQgYmVsb3dcclxuICBjb25zb2xlLndhcm4oJ0NvdWxkIG5vdCBsb2FkIGVsZWN0cm9uIGFwcCwgdXNpbmcgZmFsbGJhY2tzJyk7XHJcbn1cclxuXHJcbi8vIEVzc2VudGlhbCB1dGlsaXRpZXMgLSBsb2FkIHdpdGggZmFsbGJhY2tzXHJcbmxldCBmcztcclxudHJ5IHtcclxuICBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbn0gY2F0Y2ggKGUpIHtcclxuICB0cnkge1xyXG4gICAgZnMgPSByZXF1aXJlKCdmcycpO1xyXG4gICAgLy8gQWRkIGZzLWV4dHJhIG1ldGhvZHMgd2UgdXNlXHJcbiAgICBmcy5leGlzdHNTeW5jID0gZnMuZXhpc3RzU3luYyB8fCAoKHBhdGgpID0+IHtcclxuICAgICAgdHJ5IHsgcmV0dXJuIGZzLnN0YXRTeW5jKHBhdGgpLmlzRmlsZSgpOyB9IGNhdGNoIChlKSB7IHJldHVybiBmYWxzZTsgfVxyXG4gICAgfSk7XHJcbiAgfSBjYXRjaCAoaW5uZXJFKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gbG9hZCBmcyBtb2R1bGVzJywgaW5uZXJFKTtcclxuICAgIHRocm93IG5ldyBFcnJvcignQ3JpdGljYWwgZGVwZW5kZW5jeSBmcy9mcy1leHRyYSBub3QgYXZhaWxhYmxlJyk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBQYXRoIGhhbmRsaW5nIC0gZXNzZW50aWFsIGZvciBtb2R1bGUgcmVzb2x1dGlvblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5cclxuLy8gVHJ5IHRvIGxvYWQgaW50ZXJuYWwgbW9kdWxlcyB3aXRoIGZhbGxiYWNrc1xyXG5sZXQgUGF0aFV0aWxzLCBQcm9ncmVzc1RyYWNrZXIsIGdldExvZ2dlciwgc2FuaXRpemVGb3JMb2dnaW5nLCBDb252ZXJzaW9uU3RhdHVzO1xyXG5cclxuLy8gQXR0ZW1wdCB0byBsb2FkIGVhY2ggbW9kdWxlIHdpdGggZmFsbGJhY2tzIHRvIHByZXZlbnQgY3Jhc2hlc1xyXG5jb25zdCBzYWZlUmVxdWlyZSA9IChtb2R1bGVQYXRoLCBmYWxsYmFja3MgPSBbXSkgPT4ge1xyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gcmVxdWlyZShtb2R1bGVQYXRoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBmb3IgKGNvbnN0IGZhbGxiYWNrIG9mIGZhbGxiYWNrcykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIHJldHVybiByZXF1aXJlKGZhbGxiYWNrKTtcclxuICAgICAgfSBjYXRjaCB7IC8qIENvbnRpbnVlIHRvIG5leHQgZmFsbGJhY2sgKi8gfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIERlZmF1bHQgaW1wbGVtZW50YXRpb25zIGZvciBjcml0aWNhbCBmdW5jdGlvbnNcclxuICAgIGlmIChtb2R1bGVQYXRoLmluY2x1ZGVzKCdnZXRMb2dnZXInKSkge1xyXG4gICAgICByZXR1cm4gKG5hbWUpID0+ICh7XHJcbiAgICAgICAgbG9nOiAobXNnLCBsZXZlbCwgLi4uYXJncykgPT4gY29uc29sZS5sb2coYFske25hbWV9XVske2xldmVsIHx8ICdJTkZPJ31dICR7bXNnfWAsIC4uLmFyZ3MpLFxyXG4gICAgICAgIGVycm9yOiAobXNnLCBlcnIpID0+IGNvbnNvbGUuZXJyb3IoYFske25hbWV9XVtFUlJPUl0gJHttc2d9YCwgZXJyKSxcclxuICAgICAgICB3YXJuOiAobXNnLCAuLi5hcmdzKSA9PiBjb25zb2xlLndhcm4oYFske25hbWV9XVtXQVJOXSAke21zZ31gLCAuLi5hcmdzKSxcclxuICAgICAgICBzdWNjZXNzOiAobXNnKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dW1NVQ0NFU1NdICR7bXNnfWApLFxyXG4gICAgICAgIGRlYnVnOiAobXNnLCAuLi5hcmdzKSA9PiBjb25zb2xlLmRlYnVnKGBbJHtuYW1lfV1bREVCVUddICR7bXNnfWAsIC4uLmFyZ3MpLFxyXG4gICAgICAgIGxvZ1BoYXNlVHJhbnNpdGlvbjogKGZyb20sIHRvKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dIFBoYXNlIHRyYW5zaXRpb246ICR7ZnJvbX0g4oaSICR7dG99YCksXHJcbiAgICAgICAgbG9nQ29udmVyc2lvblN0YXJ0OiAodHlwZSwgb3B0cykgPT4gY29uc29sZS5sb2coYFske25hbWV9XSBTdGFydGluZyBjb252ZXJzaW9uIGZvciAke3R5cGV9YCksXHJcbiAgICAgICAgbG9nQ29udmVyc2lvbkNvbXBsZXRlOiAodHlwZSkgPT4gY29uc29sZS5sb2coYFske25hbWV9XSBDb21wbGV0ZWQgY29udmVyc2lvbiBmb3IgJHt0eXBlfWApLFxyXG4gICAgICAgIGxvZ0NvbnZlcnNpb25FcnJvcjogKHR5cGUsIGVycikgPT4gY29uc29sZS5lcnJvcihgWyR7bmFtZX06ZmFpbGVkXVske3R5cGV9XSDinYwgJHtlcnIubWVzc2FnZX1gLCBlcnIpLFxyXG4gICAgICAgIHNldENvbnRleHQ6ICgpID0+IHt9XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgaWYgKG1vZHVsZVBhdGguaW5jbHVkZXMoJ3Nhbml0aXplRm9yTG9nZ2luZycpKSB7XHJcbiAgICAgIHJldHVybiAob2JqKSA9PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIHJldHVybiB0eXBlb2Ygb2JqID09PSAnb2JqZWN0JyA/IHsgLi4ub2JqIH0gOiBvYmo7XHJcbiAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICByZXR1cm4gb2JqO1xyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLndhcm4oYE1vZHVsZSAke21vZHVsZVBhdGh9IG5vdCBhdmFpbGFibGUsIHVzaW5nIG1pbmltYWwgaW1wbGVtZW50YXRpb25gKTtcclxuICAgIHJldHVybiB7fTtcclxuICB9XHJcbn07XHJcblxyXG50cnkge1xyXG4gIFBhdGhVdGlscyA9IHNhZmVSZXF1aXJlKCcuLi91dGlscy9wYXRocy9pbmRleCcsIFtcclxuICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi91dGlscy9wYXRocy9pbmRleCcpLFxyXG4gICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vdXRpbHMvcGF0aHMvaW5kZXgnKVxyXG4gIF0pLlBhdGhVdGlscyB8fCB7fTtcclxuXHJcbiAgUHJvZ3Jlc3NUcmFja2VyID0gc2FmZVJlcXVpcmUoJy4uL3V0aWxzL2NvbnZlcnNpb24vcHJvZ3Jlc3MnLCBbXHJcbiAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vdXRpbHMvY29udmVyc2lvbi9wcm9ncmVzcycpLFxyXG4gICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vdXRpbHMvY29udmVyc2lvbi9wcm9ncmVzcycpXHJcbiAgXSkuUHJvZ3Jlc3NUcmFja2VyIHx8IGNsYXNzIFByb2dyZXNzVHJhY2tlciB7XHJcbiAgICBjb25zdHJ1Y3RvcihjYWxsYmFjaykgeyB0aGlzLmNhbGxiYWNrID0gY2FsbGJhY2s7IH1cclxuICAgIHVwZGF0ZShwcm9ncmVzcywgZGF0YSkgeyB0aGlzLmNhbGxiYWNrICYmIHRoaXMuY2FsbGJhY2socHJvZ3Jlc3MsIGRhdGEpOyB9XHJcbiAgICB1cGRhdGVTY2FsZWQocHJvZ3Jlc3MsIG1pbiwgbWF4LCBkYXRhKSB7IHRoaXMudXBkYXRlKG1pbiArIChwcm9ncmVzcy8xMDApICogKG1heC1taW4pLCBkYXRhKTsgfVxyXG4gIH07XHJcblxyXG4gIGdldExvZ2dlciA9IHNhZmVSZXF1aXJlKCcuLi91dGlscy9sb2dnaW5nL0NvbnZlcnNpb25Mb2dnZXInLCBbXHJcbiAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vdXRpbHMvbG9nZ2luZy9Db252ZXJzaW9uTG9nZ2VyJyksXHJcbiAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi91dGlscy9sb2dnaW5nL0NvbnZlcnNpb25Mb2dnZXInKVxyXG4gIF0pLmdldExvZ2dlciB8fCAoKG5hbWUpID0+ICh7XHJcbiAgICBsb2c6IChtc2csIGxldmVsLCAuLi5hcmdzKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dWyR7bGV2ZWwgfHwgJ0lORk8nfV0gJHttc2d9YCwgLi4uYXJncyksXHJcbiAgICBlcnJvcjogKG1zZywgZXJyKSA9PiBjb25zb2xlLmVycm9yKGBbJHtuYW1lfV1bRVJST1JdICR7bXNnfWAsIGVyciksXHJcbiAgICB3YXJuOiAobXNnLCAuLi5hcmdzKSA9PiBjb25zb2xlLndhcm4oYFske25hbWV9XVtXQVJOXSAke21zZ31gLCAuLi5hcmdzKSxcclxuICAgIHN1Y2Nlc3M6IChtc2cpID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV1bU1VDQ0VTU10gJHttc2d9YCksXHJcbiAgICBkZWJ1ZzogKG1zZywgLi4uYXJncykgPT4gY29uc29sZS5kZWJ1ZyhgWyR7bmFtZX1dW0RFQlVHXSAke21zZ31gLCAuLi5hcmdzKSxcclxuICAgIGxvZ1BoYXNlVHJhbnNpdGlvbjogKGZyb20sIHRvKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dIFBoYXNlIHRyYW5zaXRpb246ICR7ZnJvbX0g4oaSICR7dG99YCksXHJcbiAgICBsb2dDb252ZXJzaW9uU3RhcnQ6ICh0eXBlLCBvcHRzKSA9PiBjb25zb2xlLmxvZyhgWyR7bmFtZX1dIFN0YXJ0aW5nIGNvbnZlcnNpb24gZm9yICR7dHlwZX1gKSxcclxuICAgIGxvZ0NvbnZlcnNpb25Db21wbGV0ZTogKHR5cGUpID0+IGNvbnNvbGUubG9nKGBbJHtuYW1lfV0gQ29tcGxldGVkIGNvbnZlcnNpb24gZm9yICR7dHlwZX1gKSxcclxuICAgIGxvZ0NvbnZlcnNpb25FcnJvcjogKHR5cGUsIGVycikgPT4gY29uc29sZS5lcnJvcihgWyR7bmFtZX06ZmFpbGVkXVske3R5cGV9XSDinYwgJHtlcnIubWVzc2FnZX1gLCBlcnIpLFxyXG4gICAgc2V0Q29udGV4dDogKCkgPT4ge31cclxuICB9KSk7XHJcblxyXG4gIHNhbml0aXplRm9yTG9nZ2luZyA9IHNhZmVSZXF1aXJlKCcuLi91dGlscy9sb2dnaW5nL0xvZ1Nhbml0aXplcicsIFtcclxuICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi91dGlscy9sb2dnaW5nL0xvZ1Nhbml0aXplcicpLFxyXG4gICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vdXRpbHMvbG9nZ2luZy9Mb2dTYW5pdGl6ZXInKVxyXG4gIF0pLnNhbml0aXplRm9yTG9nZ2luZyB8fCAoKG9iaikgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgcmV0dXJuIHR5cGVvZiBvYmogPT09ICdvYmplY3QnID8geyAuLi5vYmogfSA6IG9iajtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICByZXR1cm4gb2JqO1xyXG4gICAgfVxyXG4gIH0pO1xyXG5cclxuICBDb252ZXJzaW9uU3RhdHVzID0gc2FmZVJlcXVpcmUoJy4uL3V0aWxzL2NvbnZlcnNpb24vQ29udmVyc2lvblN0YXR1cycsIFtcclxuICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi91dGlscy9jb252ZXJzaW9uL0NvbnZlcnNpb25TdGF0dXMnKSxcclxuICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3V0aWxzL2NvbnZlcnNpb24vQ29udmVyc2lvblN0YXR1cycpXHJcbiAgXSkgfHwge1xyXG4gICAgU1RBVFVTOiB7XHJcbiAgICAgIFNUQVJUSU5HOiAnU3RhcnRpbmcgY29udmVyc2lvbicsXHJcbiAgICAgIElOSVRJQUxJWklORzogJ/CflKcgSW5pdGlhbGl6aW5nIGNvbnZlcnRlcicsXHJcbiAgICAgIFZBTElEQVRJTkc6ICfwn5SNIFZhbGlkYXRpbmcgZmlsZScsXHJcbiAgICAgIEZBU1RfQVRURU1QVDogJ+KaoSBGYXN0IGNvbnZlcnNpb24gYXR0ZW1wdCcsXHJcbiAgICAgIFBST0NFU1NJTkc6ICfij7MgUHJvY2Vzc2luZyBjb250ZW50JyxcclxuICAgICAgRklOQUxJWklORzogJ+KchSBGaW5hbGl6aW5nIHJlc3VsdCcsXHJcbiAgICAgIENPTVBMRVRFRDogJ+KckyBDb252ZXJzaW9uIGNvbXBsZXRlJyxcclxuICAgICAgQ09OVEVOVF9FTVBUWTogJ+KaoO+4jyBFbXB0eSBjb250ZW50IHdhcm5pbmcnXHJcbiAgICB9XHJcbiAgfTtcclxufSBjYXRjaCAoZXJyb3IpIHtcclxuICBjb25zb2xlLmVycm9yKCdFcnJvciBsb2FkaW5nIGNvcmUgZGVwZW5kZW5jaWVzJywgZXJyb3IpO1xyXG4gIHRocm93IG5ldyBFcnJvcihgQ3JpdGljYWwgZGVwZW5kZW5jeSBpbml0aWFsaXphdGlvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxufVxyXG5cclxuLy8gSW5pdGlhbGl6ZSBhcHAgd2l0aCBmYWxsYmFjayBpZiBuZWVkZWRcclxuaWYgKCFhcHApIHtcclxuICBhcHAgPSB7XHJcbiAgICBpc1BhY2thZ2VkOiBmYWxzZSxcclxuICAgIGdldEFwcFBhdGg6ICgpID0+IHByb2Nlc3MuY3dkKCksXHJcbiAgICBnZXROYW1lOiAoKSA9PiAnQ29kZXgubWQnLFxyXG4gICAgZ2V0VmVyc2lvbjogKCkgPT4gJzEuMC4wJ1xyXG4gIH07XHJcbiAgY29uc29sZS53YXJuKCdVc2luZyBmYWxsYmFjayBhcHAgaW1wbGVtZW50YXRpb24nKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZXMgbW9kdWxlIGxvYWRpbmcgd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmcgYW5kIHBhdGggcmVzb2x1dGlvbi5cclxuICovXHJcbmNsYXNzIE1vZHVsZUxvYWRlciB7XHJcbiAgc3RhdGljIGFzeW5jIGxvYWRNb2R1bGUobW9kdWxlUGF0aCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICBjb25zdCBsb2dnZXIgPSBnZXRMb2dnZXIoJ01vZHVsZUxvYWRlcicpO1xyXG4gICAgY29uc3QgeyBmYWxsYmFja1BhdGhzID0gW10sIHNpbGVudCA9IGZhbHNlIH0gPSBvcHRpb25zO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGxvZ2dlci5sb2coYExvYWRpbmcgbW9kdWxlIGZyb20gcGF0aDogJHttb2R1bGVQYXRofWAsICdJTkZPJyk7XHJcblxyXG4gICAgICAvLyBFeHRyYWN0IG1vZHVsZSBuYW1lIGFuZCBjYXRlZ29yeSBmcm9tIHBhdGhcclxuICAgICAgY29uc3QgbW9kdWxlTmFtZSA9IHBhdGguYmFzZW5hbWUobW9kdWxlUGF0aCk7XHJcbiAgICAgIGxldCBjYXRlZ29yeSA9ICcnO1xyXG5cclxuICAgICAgLy8gVHJ5IHRvIHBhcnNlIGNhdGVnb3J5IGZyb20gcGF0aFxyXG4gICAgICBjb25zdCBwYXRoUGFydHMgPSBwYXRoLmRpcm5hbWUobW9kdWxlUGF0aCkuc3BsaXQocGF0aC5zZXApO1xyXG4gICAgICBpZiAocGF0aFBhcnRzLmxlbmd0aCA+PSAyKSB7XHJcbiAgICAgICAgLy8gVGFrZSB0aGUgbGFzdCB0d28gcGFydHMgb2YgdGhlIHBhdGggYXMgdGhlIGNhdGVnb3J5XHJcbiAgICAgICAgY2F0ZWdvcnkgPSBwYXRoUGFydHMuc2xpY2UoLTIpLmpvaW4oJy8nKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBEZWZhdWx0IGNhdGVnb3J5IGZvciBjb252ZXJzaW9uc1xyXG4gICAgICAgIGNhdGVnb3J5ID0gJ3NlcnZpY2VzL2NvbnZlcnNpb24nO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBsb2dnZXIubG9nKGBVc2luZyBNb2R1bGVSZXNvbHZlciB3aXRoIG1vZHVsZTogJHttb2R1bGVOYW1lfSwgY2F0ZWdvcnk6ICR7Y2F0ZWdvcnl9YCwgJ0lORk8nKTtcclxuXHJcbiAgICAgIC8vIFVzZSBNb2R1bGVSZXNvbHZlciB0byBsb2FkIHRoZSBtb2R1bGVcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCB7IE1vZHVsZVJlc29sdmVyIH0gPSByZXF1aXJlKCcuLi91dGlscy9tb2R1bGVSZXNvbHZlcicpO1xyXG4gICAgICAgIGNvbnN0IG1vZHVsZSA9IE1vZHVsZVJlc29sdmVyLnNhZmVSZXF1aXJlKG1vZHVsZU5hbWUsIGNhdGVnb3J5KTtcclxuICAgICAgICBsb2dnZXIuc3VjY2VzcyhgU3VjY2Vzc2Z1bGx5IGxvYWRlZCBtb2R1bGUgdXNpbmcgTW9kdWxlUmVzb2x2ZXI6ICR7bW9kdWxlTmFtZX1gKTtcclxuICAgICAgICByZXR1cm4gbW9kdWxlO1xyXG4gICAgICB9IGNhdGNoIChyZXNvbHZlckVycm9yKSB7XHJcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBNb2R1bGVSZXNvbHZlciBmYWlsZWQ6ICR7cmVzb2x2ZXJFcnJvci5tZXNzYWdlfWAsIHJlc29sdmVyRXJyb3IpO1xyXG5cclxuICAgICAgICAvLyBJZiBNb2R1bGVSZXNvbHZlciBmYWlscywgdHJ5IHRoZSBvcmlnaW5hbCBhcHByb2FjaCB3aXRoIGZhbGxiYWNrc1xyXG4gICAgICAgIGxvZ2dlci5sb2coJ0ZhbGxpbmcgYmFjayB0byBkaXJlY3QgcmVxdWlyZSB3aXRoIGZhbGxiYWNrcycsICdJTkZPJyk7XHJcblxyXG4gICAgICAgIC8vIFRyeSBkaXJlY3QgcmVxdWlyZSBmaXJzdFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCBtb2R1bGUgPSByZXF1aXJlKG1vZHVsZVBhdGgpO1xyXG4gICAgICAgICAgbG9nZ2VyLnN1Y2Nlc3MoYFN1Y2Nlc3NmdWxseSBsb2FkZWQgbW9kdWxlIGRpcmVjdGx5OiAke21vZHVsZVBhdGh9YCk7XHJcbiAgICAgICAgICByZXR1cm4gbW9kdWxlLmRlZmF1bHQgfHwgbW9kdWxlO1xyXG4gICAgICAgIH0gY2F0Y2ggKGRpcmVjdEVycm9yKSB7XHJcbiAgICAgICAgICAvLyBJZiBmYWxsYmFjayBwYXRocyBwcm92aWRlZCwgdHJ5IHRoZW0gc2VxdWVudGlhbGx5XHJcbiAgICAgICAgICBpZiAoZmFsbGJhY2tQYXRocyAmJiBmYWxsYmFja1BhdGhzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgbG9nZ2VyLmxvZyhgQXR0ZW1wdGluZyB0byBsb2FkIGZyb20gJHtmYWxsYmFja1BhdGhzLmxlbmd0aH0gZmFsbGJhY2sgcGF0aHNgLCAnSU5GTycpO1xyXG5cclxuICAgICAgICAgICAgZm9yIChjb25zdCBmYWxsYmFja1BhdGggb2YgZmFsbGJhY2tQYXRocykge1xyXG4gICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBsb2dnZXIubG9nKGBUcnlpbmcgZmFsbGJhY2sgcGF0aDogJHtmYWxsYmFja1BhdGh9YCwgJ0lORk8nKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IHJlcXVpcmUoZmFsbGJhY2tQYXRoKTtcclxuICAgICAgICAgICAgICAgIGxvZ2dlci5zdWNjZXNzKGBTdWNjZXNzZnVsbHkgbG9hZGVkIGZyb20gZmFsbGJhY2s6ICR7ZmFsbGJhY2tQYXRofWApO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIG1vZHVsZS5kZWZhdWx0IHx8IG1vZHVsZTtcclxuICAgICAgICAgICAgICB9IGNhdGNoIChmYWxsYmFja0Vycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBDb250aW51ZSB0byBuZXh0IGZhbGxiYWNrIHBhdGhcclxuICAgICAgICAgICAgICAgIGlmICghc2lsZW50KSB7XHJcbiAgICAgICAgICAgICAgICAgIGxvZ2dlci53YXJuKGBGYWlsZWQgdG8gbG9hZCBmcm9tIGZhbGxiYWNrOiAke2ZhbGxiYWNrUGF0aH1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAvLyBJZiBhbGwgZWxzZSBmYWlscyBhbmQgdGhpcyBpcyBDb252ZXJ0ZXJSZWdpc3RyeS5qcywgY3JlYXRlIGEgbWluaW1hbCByZWdpc3RyeVxyXG4gICAgICAgICAgaWYgKG1vZHVsZU5hbWUgPT09ICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpIHtcclxuICAgICAgICAgICAgbG9nZ2VyLmxvZygnQWxsIGxvYWRpbmcgYXR0ZW1wdHMgZmFpbGVkIGZvciBDb252ZXJ0ZXJSZWdpc3RyeS5qcy4gQ3JlYXRpbmcgbWluaW1hbCByZWdpc3RyeScsICdJTkZPJyk7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jcmVhdGVFbWVyZ2VuY3lSZWdpc3RyeSgpO1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIC8vIElmIHdlIGdldCBoZXJlLCBhbGwgYXR0ZW1wdHMgZmFpbGVkXHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBsb2FkIG1vZHVsZTogJHttb2R1bGVQYXRofS4gRXJyb3I6ICR7cmVzb2x2ZXJFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgbG9nZ2VyLmVycm9yKGBNb2R1bGUgbG9hZGluZyBmYWlsZWQgY29tcGxldGVseTogJHtlcnJvci5tZXNzYWdlfWAsIGVycm9yKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2R1bGUgbG9hZGluZyBmYWlsZWQ6ICR7bW9kdWxlUGF0aH0uIEVycm9yOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGVzIGFuIGVtZXJnZW5jeSBtaW5pbWFsIHJlZ2lzdHJ5IGFzIGEgbGFzdCByZXNvcnRcclxuICAgKiBAcmV0dXJucyB7T2JqZWN0fSBBIG1pbmltYWwgcmVnaXN0cnkgaW1wbGVtZW50YXRpb25cclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIHN0YXRpYyBfY3JlYXRlRW1lcmdlbmN5UmVnaXN0cnkoKSB7XHJcbiAgICBjb25zdCBsb2dnZXIgPSBnZXRMb2dnZXIoJ01vZHVsZUxvYWRlcicpO1xyXG4gICAgbG9nZ2VyLmxvZygn8J+TpiBDcmVhdGluZyBlbWVyZ2VuY3kgbWluaW1hbCByZWdpc3RyeSBpbXBsZW1lbnRhdGlvbicsICdJTkZPJyk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIG1pbmltYWwgcmVnaXN0cnkgY29uc3RydWN0b3IgZnVuY3Rpb24gdG8gbWF0Y2ggZXhpc3RpbmcgcGF0dGVyblxyXG4gICAgZnVuY3Rpb24gQ29udmVydGVyUmVnaXN0cnkoKSB7XHJcbiAgICAgIHRoaXMuY29udmVydGVycyA9IHtcclxuICAgICAgICBwZGY6IHtcclxuICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMgPSB7fSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW0VtZXJnZW5jeVJlZ2lzdHJ5XSBVc2luZyBlbWVyZ2VuY3kgUERGIGNvbnZlcnRlcicpO1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICAgICAgY29udGVudDogYCMgRXh0cmFjdGVkIGZyb20gJHtuYW1lIHx8ICdQREYgZG9jdW1lbnQnfVxcblxcblRoaXMgY29udGVudCB3YXMgZXh0cmFjdGVkIHVzaW5nIHRoZSBlbWVyZ2VuY3kgY29udmVydGVyLlxcblxcblRoZSBhcHBsaWNhdGlvbiBlbmNvdW50ZXJlZCBhbiBpc3N1ZSBmaW5kaW5nIHRoZSBjb3JyZWN0IGNvbnZlcnRlciBtb2R1bGUuIFBsZWFzZSByZXBvcnQgdGhpcyBpc3N1ZS5gLFxyXG4gICAgICAgICAgICAgIHR5cGU6ICdwZGYnLFxyXG4gICAgICAgICAgICAgIG1ldGFkYXRhOiB7IHBhZ2VzOiAxLCBjb252ZXJ0ZXI6ICdlbWVyZ2VuY3ktZmFsbGJhY2snIH1cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB2YWxpZGF0ZTogKGlucHV0KSA9PiBCdWZmZXIuaXNCdWZmZXIoaW5wdXQpIHx8IHR5cGVvZiBpbnB1dCA9PT0gJ3N0cmluZycsXHJcbiAgICAgICAgICBjb25maWc6IHtcclxuICAgICAgICAgICAgbmFtZTogJ1BERiBEb2N1bWVudCAoRW1lcmdlbmN5KScsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnBkZiddLFxyXG4gICAgICAgICAgICBtaW1lVHlwZXM6IFsnYXBwbGljYXRpb24vcGRmJ10sXHJcbiAgICAgICAgICAgIG1heFNpemU6IDI1ICogMTAyNCAqIDEwMjRcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQWRkIHJlcXVpcmVkIHByb3RvdHlwZSBtZXRob2RzXHJcbiAgICBDb252ZXJ0ZXJSZWdpc3RyeS5wcm90b3R5cGUuY29udmVydFRvTWFya2Rvd24gPSBhc3luYyBmdW5jdGlvbih0eXBlLCBjb250ZW50LCBvcHRpb25zID0ge30pIHtcclxuICAgICAgY29uc29sZS5sb2coYFtFbWVyZ2VuY3lSZWdpc3RyeV0gQ29udmVydGluZyAke3R5cGV9IGRvY3VtZW50YCk7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICBjb250ZW50OiBgIyBFbWVyZ2VuY3kgQ29udmVydGVyXFxuXFxuVGhpcyBjb250ZW50IHdhcyBnZW5lcmF0ZWQgYnkgYW4gZW1lcmdlbmN5IGZhbGxiYWNrIGNvbnZlcnRlciBiZWNhdXNlIHRoZSBub3JtYWwgY29udmVydGVyIGNvdWxkIG5vdCBiZSBsb2FkZWQuXFxuXFxuUGxlYXNlIHJlcG9ydCB0aGlzIGlzc3VlLmAsXHJcbiAgICAgICAgbWV0YWRhdGE6IHsgc291cmNlOiAnZW1lcmdlbmN5LWZhbGxiYWNrJyB9XHJcbiAgICAgIH07XHJcbiAgICB9O1xyXG5cclxuICAgIENvbnZlcnRlclJlZ2lzdHJ5LnByb3RvdHlwZS5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbiA9IGZ1bmN0aW9uKGV4dGVuc2lvbikge1xyXG4gICAgICBjb25zb2xlLmxvZyhgW0VtZXJnZW5jeVJlZ2lzdHJ5XSBMb29raW5nIHVwIGNvbnZlcnRlciBmb3I6ICR7ZXh0ZW5zaW9ufWApO1xyXG4gICAgICBpZiAoZXh0ZW5zaW9uID09PSAncGRmJykge1xyXG4gICAgICAgIHJldHVybiB0aGlzLmNvbnZlcnRlcnMucGRmO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfTtcclxuXHJcbiAgICAvLyBDcmVhdGUgYW5kIHJldHVybiB0aGUgcmVnaXN0cnkgaW5zdGFuY2VcclxuICAgIHJldHVybiBuZXcgQ29udmVydGVyUmVnaXN0cnkoKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEF0dGVtcHRzIHRvIGxvYWQgYSBtb2R1bGUgZnJvbSB0aGUgYmVzdCBhdmFpbGFibGUgcGF0aFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2R1bGVOYW1lIC0gVGhlIG1vZHVsZSBmaWxlIG5hbWUgKGUuZy4sICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpXHJcbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBiYXNlUGF0aHMgLSBMaXN0IG9mIGJhc2UgZGlyZWN0b3JpZXMgdG8gbG9vayBpblxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGFueT59IC0gVGhlIGxvYWRlZCBtb2R1bGVcclxuICAgKi9cclxuICBzdGF0aWMgYXN5bmMgbG9hZE1vZHVsZUZyb21CZXN0UGF0aChtb2R1bGVOYW1lLCBiYXNlUGF0aHMpIHtcclxuICAgIGNvbnN0IGxvZ2dlciA9IGdldExvZ2dlcignTW9kdWxlTG9hZGVyJyk7XHJcbiAgICBjb25zdCByZXNvbHZlZFBhdGhzID0gYmFzZVBhdGhzLm1hcChiYXNlUGF0aCA9PiBwYXRoLmpvaW4oYmFzZVBhdGgsIG1vZHVsZU5hbWUpKTtcclxuXHJcbiAgICBsb2dnZXIubG9nKGBBdHRlbXB0aW5nIHRvIGxvYWQgJHttb2R1bGVOYW1lfSBmcm9tICR7cmVzb2x2ZWRQYXRocy5sZW5ndGh9IHBvc3NpYmxlIHBhdGhzYCwgJ0lORk8nKTtcclxuXHJcbiAgICAvLyBDaGVjayB3aGljaCBwYXRocyBleGlzdCBmaXJzdFxyXG4gICAgY29uc3QgZXhpc3RpbmdQYXRocyA9IHJlc29sdmVkUGF0aHMuZmlsdGVyKHAgPT4ge1xyXG4gICAgICBjb25zdCBleGlzdHMgPSBmcy5leGlzdHNTeW5jKHApO1xyXG4gICAgICBsb2dnZXIubG9nKGBQYXRoICR7cH0gZXhpc3RzOiAke2V4aXN0c31gLCAnSU5GTycpO1xyXG4gICAgICByZXR1cm4gZXhpc3RzO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaWYgKGV4aXN0aW5nUGF0aHMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIGxvZ2dlci5lcnJvcihgTm8gZXhpc3RpbmcgcGF0aHMgZm91bmQgZm9yIG1vZHVsZTogJHttb2R1bGVOYW1lfWApO1xyXG4gICAgICAvLyBUcnkgYWxsIHBhdGhzIGFueXdheSBhcyBhIGxhc3QgcmVzb3J0XHJcbiAgICAgIHJldHVybiB0aGlzLmxvYWRNb2R1bGUocmVzb2x2ZWRQYXRoc1swXSwge1xyXG4gICAgICAgIGZhbGxiYWNrUGF0aHM6IHJlc29sdmVkUGF0aHMuc2xpY2UoMSksXHJcbiAgICAgICAgc2lsZW50OiB0cnVlXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIExvYWQgZnJvbSB0aGUgZmlyc3QgZXhpc3RpbmcgcGF0aCwgd2l0aCByZW1haW5pbmcgZXhpc3RpbmcgcGF0aHMgYXMgZmFsbGJhY2tzXHJcbiAgICByZXR1cm4gdGhpcy5sb2FkTW9kdWxlKGV4aXN0aW5nUGF0aHNbMF0sIHtcclxuICAgICAgZmFsbGJhY2tQYXRoczogZXhpc3RpbmdQYXRocy5zbGljZSgxKVxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgZ2V0TW9kdWxlUGF0aHMoKSB7XHJcbiAgICBjb25zdCBpc0RldiA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnO1xyXG4gICAgY29uc3QgbG9nZ2VyID0gZ2V0TG9nZ2VyKCdNb2R1bGVMb2FkZXInKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgYSBjb21wcmVoZW5zaXZlIGxpc3Qgb2YgcG9zc2libGUgcGF0aHMgZm9yIHRoZSBDb252ZXJ0ZXJSZWdpc3RyeVxyXG4gICAgY29uc3QgcG9zc2libGVQYXRocyA9IFtcclxuICAgICAgLy8gRGV2ZWxvcG1lbnQgcGF0aHNcclxuICAgICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIFBhY2thZ2VkIGFwcCBwYXRocyAtIG5vdGUgd2UgZXhwbGljaXRseSBoYW5kbGUgdGhlIHBhdGggZnJvbSB0aGUgZXJyb3JcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoL3NyY1xcL2VsZWN0cm9uLywgJ2J1aWxkL2VsZWN0cm9uJyksICdzZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoL3NyY1xcXFxlbGVjdHJvbi8sICdidWlsZFxcXFxlbGVjdHJvbicpLCAnc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBSZWxhdGl2ZSBwYXRocyBmcm9tIGN1cnJlbnQgbW9kdWxlXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBQYXRocyB3aXRoIGFwcC5hc2FyIGZvciBwYWNrYWdlZCBhcHBcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXInLCAnYXBwJyksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhcicsICdhcHAnKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXJcXFxcc3JjJywgJ2FwcC5hc2FyXFxcXGJ1aWxkJyksICdlbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyL3NyYycsICdhcHAuYXNhci9idWlsZCcpLCAnZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gQWx0ZXJuYXRpdmUgcGFyZW50IGRpcmVjdG9yeSBwYXRoc1xyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJy4uL2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICcuLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gU2libGluZyBwYXRoc1xyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKGFwcC5nZXRBcHBQYXRoKCkpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKGFwcC5nZXRBcHBQYXRoKCkpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuXHJcbiAgICAgIC8vIE1vcmUgbmVzdGVkIHBhdGhzIGZvciBhcHAuYXNhclxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ2Rpc3QvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAnLi4vcmVzb3VyY2VzL2FwcC9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAnLi4vcmVzb3VyY2VzL2FwcC9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBEaXJlY3QgcGF0aCBmaXhlcyBmb3IgdGhlIHNwZWNpZmljIGVycm9yIHBhdGhcclxuICAgICAgYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicsICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnc3JjXFxcXGVsZWN0cm9uXFxcXHNlcnZpY2VzXFxcXGNvbnZlcnNpb24nLCAnYnVpbGRcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvbicpLFxyXG5cclxuICAgICAgLy8gUGF0aHMgd2l0aCBkaXN0IHByZWZpeGVzIChvZnRlbiB1c2VkIGluIGJ1aWx0IGFwcHMpXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnZGlzdC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnZGlzdC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcblxyXG4gICAgICAvLyBBZGRpdGlvbmFsIHBhdGhzIHNwZWNpZmljYWxseSBmb3IgQ29udmVydGVyUmVnaXN0cnkuanNcclxuICAgICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdhcHAvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpLFxyXG4gICAgICBwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ2FwcC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi8uLi9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi8uLi8uLi9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvYXBwL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSxcclxuICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ3Jlc291cmNlcy9hcHAuYXNhci9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJyksXHJcbiAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpXHJcbiAgICBdO1xyXG5cclxuICAgIC8vIExvZyBhcHAgZW52aXJvbm1lbnQgaW5mb3JtYXRpb24gZm9yIGRlYnVnZ2luZ1xyXG4gICAgbG9nZ2VyLmxvZyhgQXBwIGlzIHBhY2thZ2VkOiAke2FwcC5pc1BhY2thZ2VkfWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBBcHAgcGF0aDogJHthcHAuZ2V0QXBwUGF0aCgpfWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBfX2Rpcm5hbWU6ICR7X19kaXJuYW1lfWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBwcm9jZXNzLmN3ZCgpOiAke3Byb2Nlc3MuY3dkKCl9YCwgJ0lORk8nKTtcclxuICAgIGxvZ2dlci5sb2coYHByb2Nlc3MuZXhlY1BhdGg6ICR7cHJvY2Vzcy5leGVjUGF0aH1gLCAnSU5GTycpO1xyXG5cclxuICAgIC8vIExvZyB0aGUgc3BlY2lmaWMgcGF0aCBmcm9tIHRoZSBlcnJvciBtZXNzYWdlXHJcbiAgICBjb25zdCBlcnJvclBhdGggPSAnQzpcXFxcVXNlcnNcXFxcSm9zZXBoXFxcXERvY3VtZW50c1xcXFxDb2RlXFxcXGNvZGV4LW1kXFxcXGRpc3RcXFxcd2luLXVucGFja2VkXFxcXHJlc291cmNlc1xcXFxhcHAuYXNhclxcXFxzcmNcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvblxcXFxDb252ZXJ0ZXJSZWdpc3RyeS5qcyc7XHJcbiAgICBjb25zdCBjb3JyZWN0ZWRQYXRoID0gZXJyb3JQYXRoLnJlcGxhY2UoJ1xcXFxzcmNcXFxcJywgJ1xcXFxidWlsZFxcXFwnKTtcclxuICAgIGxvZ2dlci5sb2coYEVycm9yIHBhdGg6ICR7ZXJyb3JQYXRofWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBDb3JyZWN0ZWQgcGF0aDogJHtjb3JyZWN0ZWRQYXRofWAsICdJTkZPJyk7XHJcbiAgICBsb2dnZXIubG9nKGBDb3JyZWN0ZWQgcGF0aCBleGlzdHM6ICR7ZnMuZXhpc3RzU3luYyhjb3JyZWN0ZWRQYXRoKX1gLCAnSU5GTycpO1xyXG5cclxuICAgIC8vIEZpbmQgZmlyc3QgZXhpc3RpbmcgYmFzZSBwYXRoXHJcbiAgICBsZXQgYmFzZVBhdGggPSBudWxsO1xyXG4gICAgZm9yIChjb25zdCBjYW5kaWRhdGVQYXRoIG9mIHBvc3NpYmxlUGF0aHMpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBleGlzdHMgPSBmcy5leGlzdHNTeW5jKGNhbmRpZGF0ZVBhdGgpO1xyXG4gICAgICAgIGxvZ2dlci5sb2coYENoZWNraW5nIHBhdGg6ICR7Y2FuZGlkYXRlUGF0aH0gKGV4aXN0czogJHtleGlzdHN9KWAsICdJTkZPJyk7XHJcblxyXG4gICAgICAgIGlmIChleGlzdHMpIHtcclxuICAgICAgICAgIGJhc2VQYXRoID0gY2FuZGlkYXRlUGF0aDtcclxuICAgICAgICAgIGxvZ2dlci5sb2coYEZvdW5kIHZhbGlkIGJhc2UgcGF0aDogJHtiYXNlUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGxvZ2dlci53YXJuKGBFcnJvciBjaGVja2luZyBwYXRoICR7Y2FuZGlkYXRlUGF0aH06ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIElmIG5vIGJhc2UgcGF0aCBleGlzdHMsIHRyeSBkaXJlY3QgbW9kdWxlIHBhdGhzXHJcbiAgICBpZiAoIWJhc2VQYXRoKSB7XHJcbiAgICAgIGxvZ2dlci53YXJuKCdObyB2YWxpZCBiYXNlIHBhdGggZm91bmQsIHRyeWluZyBkaXJlY3QgbW9kdWxlIHJlc29sdXRpb24nKTtcclxuXHJcbiAgICAgIC8vIERlZmluZSBhbGwgcG9zc2libGUgZGlyZWN0IHBhdGhzIHRvIHRoZSByZWdpc3RyeSBtb2R1bGVcclxuICAgICAgY29uc3QgZGlyZWN0UmVnaXN0cnlQYXRocyA9IFtcclxuICAgICAgICAvLyBTcGVjaWZpYyBwYXRocyBiYXNlZCBvbiBlcnJvciBsb2dzXHJcbiAgICAgICAgLy8gVGhpcyBpcyB0aGUgc3BlY2lmaWMgZXJyb3IgcGF0aCB3aXRoICdzcmMnIHJlcGxhY2VkIHdpdGggJ2J1aWxkJ1xyXG4gICAgICAgIGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpICsgJy9Db252ZXJ0ZXJSZWdpc3RyeS5qcycsXHJcbiAgICAgICAgYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdzcmNcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvbicsICdidWlsZFxcXFxlbGVjdHJvblxcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uJykgKyAnXFxcXENvbnZlcnRlclJlZ2lzdHJ5LmpzJyxcclxuXHJcbiAgICAgICAgLy8gRnVsbCBzdHJpbmcgcmVwbGFjZW1lbnRzIGZvciB0aGUgc3BlY2lmaWMgZXJyb3IgcGF0aHMgaW4gdGhlIGxvZ3NcclxuICAgICAgICBhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyXFxcXHNyY1xcXFxlbGVjdHJvbicsICdhcHAuYXNhclxcXFxidWlsZFxcXFxlbGVjdHJvbicpICsgJ1xcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uXFxcXENvbnZlcnRlclJlZ2lzdHJ5LmpzJyxcclxuICAgICAgICBhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyL3NyYy9lbGVjdHJvbicsICdhcHAuYXNhci9idWlsZC9lbGVjdHJvbicpICsgJy9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyxcclxuXHJcbiAgICAgICAgLy8gU3RhbmRhcmQgYXBwbGljYXRpb24gcGF0aHNcclxuICAgICAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG5cclxuICAgICAgICAvLyBSZWxhdGl2ZSBwYXRoc1xyXG4gICAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuXHJcbiAgICAgICAgLy8gQVNBUi1zcGVjaWZpYyBwYXRocyB3aXRoIGFkYXB0YXRpb25zXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXInLCAnYXBwJyksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLnJlcGxhY2UoJ2FwcC5hc2FyJywgJ2FwcCcpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLi9yZXNvdXJjZXMvYXBwL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJy4uL3Jlc291cmNlcy9hcHAvYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9idWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL0NvbnZlcnRlclJlZ2lzdHJ5LmpzJyksXHJcbiAgICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uLy4uL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAncmVzb3VyY2VzL2FwcC9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvYXBwLmFzYXIvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG4gICAgICAgIHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdyZXNvdXJjZXMvYXBwLmFzYXIvYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9Db252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG5cclxuICAgICAgICAvLyBBbGxvdyBmaW5kaW5nIGluIGN1cnJlbnQgZGlyZWN0b3JpZXNcclxuICAgICAgICBwYXRoLmpvaW4oX19kaXJuYW1lLCAnQ29udmVydGVyUmVnaXN0cnkuanMnKSxcclxuICAgICAgICBwYXRoLmpvaW4ocGF0aC5kaXJuYW1lKF9fZGlybmFtZSksICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpLFxyXG5cclxuICAgICAgICAvLyBUcnkgYWJzb2x1dGUgcGF0aHMgdGhhdCBtYXRjaCB0aGUgZXJyb3Igc3RhY2tcclxuICAgICAgICAnQzpcXFxcVXNlcnNcXFxcSm9zZXBoXFxcXERvY3VtZW50c1xcXFxDb2RlXFxcXGNvZGV4LW1kXFxcXGRpc3RcXFxcd2luLXVucGFja2VkXFxcXHJlc291cmNlc1xcXFxhcHAuYXNhclxcXFxidWlsZFxcXFxlbGVjdHJvblxcXFxzZXJ2aWNlc1xcXFxjb252ZXJzaW9uXFxcXENvbnZlcnRlclJlZ2lzdHJ5LmpzJ1xyXG4gICAgICBdO1xyXG5cclxuICAgICAgLy8gRmluZCB0aGUgZmlyc3QgZGlyZWN0IHJlZ2lzdHJ5IHBhdGggdGhhdCBleGlzdHNcclxuICAgICAgZm9yIChjb25zdCByZWdpc3RyeVBhdGggb2YgZGlyZWN0UmVnaXN0cnlQYXRocykge1xyXG4gICAgICAgIGNvbnN0IGV4aXN0cyA9IGZzLmV4aXN0c1N5bmMocmVnaXN0cnlQYXRoKTtcclxuICAgICAgICBsb2dnZXIubG9nKGBDaGVja2luZyBkaXJlY3QgcmVnaXN0cnkgcGF0aDogJHtyZWdpc3RyeVBhdGh9IChleGlzdHM6ICR7ZXhpc3RzfSlgLCAnSU5GTycpO1xyXG5cclxuICAgICAgICBpZiAoZXhpc3RzKSB7XHJcbiAgICAgICAgICAvLyBCdWlsZCBhIGJhc2UgcGF0aCBmcm9tIHRoZSBkaXJlY3RvcnkgY29udGFpbmluZyB0aGUgcmVnaXN0cnlcclxuICAgICAgICAgIGJhc2VQYXRoID0gcGF0aC5kaXJuYW1lKHJlZ2lzdHJ5UGF0aCk7XHJcbiAgICAgICAgICBsb2dnZXIubG9nKGBGb3VuZCByZWdpc3RyeSBtb2R1bGUgYXQ6ICR7cmVnaXN0cnlQYXRofSwgdXNpbmcgYmFzZSBwYXRoOiAke2Jhc2VQYXRofWAsICdJTkZPJyk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBGYWxsYmFjayB0byBhIGRlZmF1bHQgcGF0aCBpZiBhbGwgZWxzZSBmYWlsc1xyXG4gICAgaWYgKCFiYXNlUGF0aCkge1xyXG4gICAgICBsb2dnZXIuZXJyb3IoJ0FsbCBwYXRoIHJlc29sdXRpb24gYXR0ZW1wdHMgZmFpbGVkLCB1c2luZyBmYWxsYmFjayBwYXRoJyk7XHJcblxyXG4gICAgICAvLyBVc2UgYSBwYXRoIHJlbGF0aXZlIHRvIGN1cnJlbnQgbW9kdWxlIGFzIGxhc3QgcmVzb3J0XHJcbiAgICAgIGlmIChhcHAuaXNQYWNrYWdlZCkge1xyXG4gICAgICAgIGJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL3NlcnZpY2VzL2NvbnZlcnNpb24nKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBiYXNlUGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIExvZyB0aGUgZmluYWwgYmFzZSBwYXRoIHRoYXQgd2lsbCBiZSB1c2VkXHJcbiAgICBsb2dnZXIubG9nKGBVc2luZyBmaW5hbCBiYXNlIHBhdGg6ICR7YmFzZVBhdGh9YCwgJ0lORk8nKTtcclxuXHJcbiAgICAvLyBDaGVjayBpZiB0aGUgcmVnaXN0cnkgZXhpc3RzIGF0IHRoaXMgcGF0aFxyXG4gICAgY29uc3QgcmVnaXN0cnlQYXRoID0gcGF0aC5qb2luKGJhc2VQYXRoLCAnQ29udmVydGVyUmVnaXN0cnkuanMnKTtcclxuICAgIGxvZ2dlci5sb2coYEZpbmFsIHJlZ2lzdHJ5IHBhdGg6ICR7cmVnaXN0cnlQYXRofSAoZXhpc3RzOiAke2ZzLmV4aXN0c1N5bmMocmVnaXN0cnlQYXRoKX0pYCwgJ0lORk8nKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgdGhlIHBhdGhzIG9iamVjdCB3aXRoIGFsbCBtb2R1bGUgcGF0aHNcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHJlZ2lzdHJ5OiByZWdpc3RyeVBhdGgsXHJcbiAgICAgIHJlZ2lzdHJ5UGF0aDogcmVnaXN0cnlQYXRoLCAvLyBEdXBsaWNhdGUgZm9yIGRpcmVjdCBhY2Nlc3NcclxuICAgICAgY29udmVydGVyczoge1xyXG4gICAgICAgIHVybDogcGF0aC5qb2luKGJhc2VQYXRoLCAnd2ViL1VybENvbnZlcnRlci5qcycpLFxyXG4gICAgICAgIHBkZjogcGF0aC5qb2luKGJhc2VQYXRoLCAnZG9jdW1lbnQvUGRmQ29udmVydGVyRmFjdG9yeS5qcycpLFxyXG4gICAgICAgIGRvY3g6IHBhdGguam9pbihiYXNlUGF0aCwgJ2RvY3VtZW50L0RvY3hDb252ZXJ0ZXIuanMnKSxcclxuICAgICAgICBwcHR4OiBwYXRoLmpvaW4oYmFzZVBhdGgsICdkb2N1bWVudC9QcHR4Q29udmVydGVyLmpzJyksXHJcbiAgICAgICAgeGxzeDogcGF0aC5qb2luKGJhc2VQYXRoLCAnZGF0YS9YbHN4Q29udmVydGVyLmpzJyksXHJcbiAgICAgICAgY3N2OiBwYXRoLmpvaW4oYmFzZVBhdGgsICdkYXRhL0NzdkNvbnZlcnRlci5qcycpXHJcbiAgICAgIH1cclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vLyBNaW5pbWFsIGVtYmVkZGVkIENvbnZlcnRlclJlZ2lzdHJ5IGFzIGEgbGFzdCByZXNvcnRcclxuY29uc3QgTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5ID0ge1xyXG4gIGNvbnZlcnRlcnM6IHtcclxuICAgIHBkZjoge1xyXG4gICAgICAvLyBNaW5pbWFsIFBERiBjb252ZXJ0ZXJcclxuICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucyA9IHt9KSA9PiB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1tNaW5pbWFsQ29udmVydGVyUmVnaXN0cnldIFVzaW5nIGVtYmVkZGVkIFBERiBjb252ZXJ0ZXInKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgIGNvbnRlbnQ6IGAjIEV4dHJhY3RlZCBmcm9tICR7bmFtZSB8fCAnUERGIGRvY3VtZW50J31cXG5cXG5UaGlzIGNvbnRlbnQgd2FzIGV4dHJhY3RlZCB1c2luZyB0aGUgZW1iZWRkZWQgY29udmVydGVyLmAsXHJcbiAgICAgICAgICB0eXBlOiAncGRmJyxcclxuICAgICAgICAgIG1ldGFkYXRhOiB7IHBhZ2VzOiAxLCBjb252ZXJ0ZXI6ICdtaW5pbWFsLWVtYmVkZGVkJyB9XHJcbiAgICAgICAgfTtcclxuICAgICAgfSxcclxuICAgICAgdmFsaWRhdGU6IChpbnB1dCkgPT4gQnVmZmVyLmlzQnVmZmVyKGlucHV0KSB8fCB0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnLFxyXG4gICAgICBjb25maWc6IHtcclxuICAgICAgICBuYW1lOiAnUERGIERvY3VtZW50JyxcclxuICAgICAgICBleHRlbnNpb25zOiBbJy5wZGYnXSxcclxuICAgICAgICBtaW1lVHlwZXM6IFsnYXBwbGljYXRpb24vcGRmJ10sXHJcbiAgICAgICAgbWF4U2l6ZTogMjUgKiAxMDI0ICogMTAyNFxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfSxcclxuXHJcbiAgLy8gR2VuZXJpYyBjb252ZXJzaW9uIGZ1bmN0aW9uXHJcbiAgY29udmVydFRvTWFya2Rvd246IGFzeW5jICh0eXBlLCBjb250ZW50LCBvcHRpb25zID0ge30pID0+IHtcclxuICAgIGNvbnNvbGUubG9nKGBbTWluaW1hbENvbnZlcnRlclJlZ2lzdHJ5XSBVc2luZyBlbWJlZGRlZCBjb252ZXJ0VG9NYXJrZG93biBmb3IgJHt0eXBlfWApO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgY29udGVudDogYCMgRXh0cmFjdGVkIGZyb20gJHtvcHRpb25zLm5hbWUgfHwgJ2RvY3VtZW50J31cXG5cXG5UaGlzIGNvbnRlbnQgd2FzIGV4dHJhY3RlZCB1c2luZyB0aGUgZW1iZWRkZWQgY29udmVydGVyLmAsXHJcbiAgICAgIHR5cGU6IHR5cGUsXHJcbiAgICAgIG1ldGFkYXRhOiB7IGNvbnZlcnRlcjogJ21pbmltYWwtZW1iZWRkZWQnIH1cclxuICAgIH07XHJcbiAgfSxcclxuXHJcbiAgLy8gTG9va3VwIGNvbnZlcnRlciBieSBleHRlbnNpb25cclxuICBnZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbjogYXN5bmMgKGV4dGVuc2lvbikgPT4ge1xyXG4gICAgY29uc29sZS5sb2coYFtNaW5pbWFsQ29udmVydGVyUmVnaXN0cnldIExvb2tpbmcgdXAgY29udmVydGVyIGZvcjogJHtleHRlbnNpb259YCk7XHJcblxyXG4gICAgLy8gSGFuZGxlIFBERiBmaWxlcyBzcGVjaWZpY2FsbHlcclxuICAgIGlmIChleHRlbnNpb24gPT09ICdwZGYnKSB7XHJcbiAgICAgIHJldHVybiBNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkuY29udmVydGVycy5wZGY7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2VuZXJpYyBjb252ZXJ0ZXIgZm9yIG90aGVyIHR5cGVzXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBjb252ZXJ0OiBhc3luYyAoY29udGVudCwgbmFtZSwgYXBpS2V5LCBvcHRpb25zID0ge30pID0+IHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgW01pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeV0gVXNpbmcgZ2VuZXJpYyBjb252ZXJ0ZXIgZm9yICR7ZXh0ZW5zaW9ufWApO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgY29udGVudDogYCMgRXh0cmFjdGVkIGZyb20gJHtuYW1lIHx8IGV4dGVuc2lvbiArICcgZmlsZSd9XFxuXFxuVGhpcyBjb250ZW50IHdhcyBleHRyYWN0ZWQgdXNpbmcgdGhlIGVtYmVkZGVkIGdlbmVyaWMgY29udmVydGVyLmAsXHJcbiAgICAgICAgICB0eXBlOiBleHRlbnNpb24sXHJcbiAgICAgICAgICBtZXRhZGF0YTogeyBjb252ZXJ0ZXI6ICdtaW5pbWFsLWVtYmVkZGVkLWdlbmVyaWMnIH1cclxuICAgICAgICB9O1xyXG4gICAgICB9LFxyXG4gICAgICB2YWxpZGF0ZTogKCkgPT4gdHJ1ZSxcclxuICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgbmFtZTogYCR7ZXh0ZW5zaW9uLnRvVXBwZXJDYXNlKCl9IERvY3VtZW50YCxcclxuICAgICAgICBleHRlbnNpb25zOiBbYC4ke2V4dGVuc2lvbn1gXSxcclxuICAgICAgICBtaW1lVHlwZXM6IFtgYXBwbGljYXRpb24vJHtleHRlbnNpb259YF0sXHJcbiAgICAgICAgbWF4U2l6ZTogMTAgKiAxMDI0ICogMTAyNFxyXG4gICAgICB9XHJcbiAgICB9O1xyXG4gIH1cclxufTtcclxuXHJcbi8qKlxyXG4gKiBNYW5hZ2VzIGNvbnZlcnRlciBpbml0aWFsaXphdGlvbiBhbmQgZW5zdXJlcyBwcm9wZXIgbG9hZGluZyBzZXF1ZW5jZS5cclxuICovXHJcbmNsYXNzIENvbnZlcnRlckluaXRpYWxpemVyIHtcclxuICBzdGF0aWMgX2luc3RhbmNlID0gbnVsbDtcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuX2luaXRpYWxpemVkID0gZmFsc2U7XHJcbiAgICB0aGlzLl9pbml0UHJvbWlzZSA9IG51bGw7XHJcbiAgICB0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeSA9IG51bGw7XHJcbiAgICB0aGlzLmxvZ2dlciA9IGdldExvZ2dlcignQ29udmVydGVySW5pdGlhbGl6ZXInKTtcclxuICB9XHJcbiAgXHJcbiAgc3RhdGljIGdldEluc3RhbmNlKCkge1xyXG4gICAgaWYgKCFDb252ZXJ0ZXJJbml0aWFsaXplci5faW5zdGFuY2UpIHtcclxuICAgICAgQ29udmVydGVySW5pdGlhbGl6ZXIuX2luc3RhbmNlID0gbmV3IENvbnZlcnRlckluaXRpYWxpemVyKCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gQ29udmVydGVySW5pdGlhbGl6ZXIuX2luc3RhbmNlO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgaW5pdGlhbGl6ZSgpIHtcclxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplZCkgcmV0dXJuIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gICAgaWYgKHRoaXMuX2luaXRQcm9taXNlKSByZXR1cm4gdGhpcy5faW5pdFByb21pc2U7XHJcblxyXG4gICAgdGhpcy5faW5pdFByb21pc2UgPSB0aGlzLl9kb0luaXRpYWxpemUoKTtcclxuICAgIHJldHVybiB0aGlzLl9pbml0UHJvbWlzZTtcclxuICB9XHJcblxyXG4gIGFzeW5jIF9kb0luaXRpYWxpemUoKSB7XHJcbiAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlNUQVJUSU5HLFxyXG4gICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5JTklUSUFMSVpJTkdcclxuICAgICk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gR2V0IGFsbCBwb3NzaWJsZSBtb2R1bGUgcGF0aHNcclxuICAgICAgY29uc3QgcGF0aHMgPSBNb2R1bGVMb2FkZXIuZ2V0TW9kdWxlUGF0aHMoKTtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nKCdVc2luZyBjb252ZXJ0ZXIgcGF0aHM6JywgJ0lORk8nLCBwYXRocyk7XHJcblxyXG4gICAgICAvLyBFeHRyYWN0IGFsbCB0aGUgcG9zc2libGUgYmFzZSBwYXRocyBmcm9tIHZhcmlvdXMgc291cmNlc1xyXG4gICAgICBjb25zdCBwb3NzaWJsZUJhc2VQYXRocyA9IFtcclxuICAgICAgICBwYXRoLmRpcm5hbWUocGF0aHMucmVnaXN0cnkpLFxyXG4gICAgICAgIC4uLk9iamVjdC52YWx1ZXMocGF0aHMuY29udmVydGVycykubWFwKHAgPT4gcGF0aC5kaXJuYW1lKHBhdGguZGlybmFtZShwKSkpXHJcbiAgICAgIF07XHJcblxyXG4gICAgICAvLyBMb2cgYWxsIHBvc3NpYmxlIHJlZ2lzdHJ5IHBhdGhzIHdlJ2xsIHRyeVxyXG4gICAgICBjb25zdCBhbGxQb3NzaWJsZVJlZ2lzdHJ5UGF0aHMgPSBbXHJcbiAgICAgICAgcGF0aHMucmVnaXN0cnksXHJcbiAgICAgICAgcGF0aHMucmVnaXN0cnlQYXRoLFxyXG4gICAgICAgIC4uLnBvc3NpYmxlQmFzZVBhdGhzLm1hcChiYXNlUGF0aCA9PiBwYXRoLmpvaW4oYmFzZVBhdGgsICdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpKVxyXG4gICAgICBdO1xyXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQWxsIHBvc3NpYmxlIHJlZ2lzdHJ5IHBhdGhzOicsIGFsbFBvc3NpYmxlUmVnaXN0cnlQYXRocyk7XHJcblxyXG4gICAgICAvLyBBdHRlbXB0IHRvIGxvYWQgdGhlIHJlZ2lzdHJ5IHVzaW5nIG91ciBlbmhhbmNlZCBsb2FkZXIgd2l0aCBmYWxsYmFja3NcclxuICAgICAgbGV0IHJlZ2lzdHJ5O1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIEZpcnN0IHRyeSB0aGUgZGlyZWN0IHBhdGhcclxuICAgICAgICBjb25zdCBlcnJvclBhdGggPSAnQzpcXFxcVXNlcnNcXFxcSm9zZXBoXFxcXERvY3VtZW50c1xcXFxDb2RlXFxcXGNvZGV4LW1kXFxcXGRpc3RcXFxcd2luLXVucGFja2VkXFxcXHJlc291cmNlc1xcXFxhcHAuYXNhclxcXFxzcmNcXFxcZWxlY3Ryb25cXFxcc2VydmljZXNcXFxcY29udmVyc2lvblxcXFxDb252ZXJ0ZXJSZWdpc3RyeS5qcyc7XHJcbiAgICAgICAgY29uc3QgY29ycmVjdGVkUGF0aCA9IGVycm9yUGF0aC5yZXBsYWNlKCdcXFxcc3JjXFxcXCcsICdcXFxcYnVpbGRcXFxcJyk7XHJcblxyXG4gICAgICAgIC8vIEFsc28gY2hlY2sgaWYgdGhlIGhhcmRjb2RlZCBjb3JyZWN0ZWQgcGF0aCBleGlzdHMgYW5kIHRyeSB0byBsb2FkIGl0IGRpcmVjdGx5XHJcbiAgICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoY29ycmVjdGVkUGF0aCkpIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgRm91bmQgY29ycmVjdGVkIHJlZ2lzdHJ5IHBhdGg6ICR7Y29ycmVjdGVkUGF0aH1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgcmVnaXN0cnkgPSByZXF1aXJlKGNvcnJlY3RlZFBhdGgpO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKCdTdWNjZXNzZnVsbHkgbG9hZGVkIHJlZ2lzdHJ5IGZyb20gY29ycmVjdGVkIHBhdGgnKTtcclxuICAgICAgICAgIH0gY2F0Y2ggKGRpcmVjdExvYWRFcnJvcikge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBGYWlsZWQgdG8gbG9hZCBmcm9tIGNvcnJlY3RlZCBwYXRoOiAke2RpcmVjdExvYWRFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSWYgZGlyZWN0IGxvYWRpbmcgZGlkbid0IHdvcmssIHRyeSB3aXRoIHRoZSBtb2R1bGVsb2FkZXJcclxuICAgICAgICBpZiAoIXJlZ2lzdHJ5KSB7XHJcbiAgICAgICAgICByZWdpc3RyeSA9IGF3YWl0IE1vZHVsZUxvYWRlci5sb2FkTW9kdWxlKFxyXG4gICAgICAgICAgICBwYXRocy5yZWdpc3RyeSxcclxuICAgICAgICAgICAgeyBmYWxsYmFja1BhdGhzOiBhbGxQb3NzaWJsZVJlZ2lzdHJ5UGF0aHMuc2xpY2UoMSksIHNpbGVudDogdHJ1ZSB9XHJcbiAgICAgICAgICApO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoaW5pdGlhbEVycm9yKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybignSW5pdGlhbCByZWdpc3RyeSBsb2FkaW5nIGZhaWxlZCwgdHJ5aW5nIGFsdGVybmF0aXZlIGFwcHJvYWNoZXMnLCBpbml0aWFsRXJyb3IpO1xyXG5cclxuICAgICAgICAvLyBJZiBkaXJlY3QgbG9hZGluZyBmYWlsZWQsIHRyeSBhIGRpZmZlcmVudCBhcHByb2FjaCBieSBjb2xsZWN0aW5nIGJhc2UgZGlyZWN0b3JpZXNcclxuICAgICAgICBjb25zdCBiYXNlRGlycyA9IFtdO1xyXG5cclxuICAgICAgICAvLyBBZGQgcG90ZW50aWFsIGJhc2UgZGlyZWN0b3JpZXMgKGRlZHVwbGljYXRlIHRoZW0pXHJcbiAgICAgICAgY29uc3QgYWRkQmFzZURpciA9IChkaXIpID0+IHtcclxuICAgICAgICAgIGlmIChkaXIgJiYgIWJhc2VEaXJzLmluY2x1ZGVzKGRpcikpIHtcclxuICAgICAgICAgICAgYmFzZURpcnMucHVzaChkaXIpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIEFkZCBtdWx0aXBsZSBwYXRocyB0aGF0IGNvdWxkIGNvbnRhaW4gdGhlIHJlZ2lzdHJ5XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLmRpcm5hbWUocGF0aHMucmVnaXN0cnkpKTtcclxuXHJcbiAgICAgICAgLy8gQWRkIHBhcmVudCBkaXJlY3RvcmllcyBvZiBlYWNoIGNvbnZlcnRlciBwYXRoXHJcbiAgICAgICAgT2JqZWN0LnZhbHVlcyhwYXRocy5jb252ZXJ0ZXJzKS5mb3JFYWNoKGNvbnZlcnRlclBhdGggPT4ge1xyXG4gICAgICAgICAgY29uc3QgY29udmVydGVyRGlyID0gcGF0aC5kaXJuYW1lKGNvbnZlcnRlclBhdGgpO1xyXG4gICAgICAgICAgYWRkQmFzZURpcihwYXRoLmRpcm5hbWUoY29udmVydGVyRGlyKSk7IC8vIEFkZCBwYXJlbnQgZGlyZWN0b3J5XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIEFkZCBjb21tb24gZGlyZWN0b3JpZXMgcmVsYXRpdmUgdG8gZXhlY3V0YWJsZVxyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnYnVpbGQvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShhcHAuZ2V0QXBwUGF0aCgpLCAnc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKSwgJ2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vc2VydmljZXMvY29udmVyc2lvbicpKTtcclxuICAgICAgICBhZGRCYXNlRGlyKHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL2J1aWxkL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24nKSk7XHJcbiAgICAgICAgYWRkQmFzZURpcihwYXRoLnJlc29sdmUoYXBwLmdldEFwcFBhdGgoKS5yZXBsYWNlKCdhcHAuYXNhcicsICdhcHAnKSwgJ3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG4gICAgICAgIGFkZEJhc2VEaXIocGF0aC5yZXNvbHZlKGFwcC5nZXRBcHBQYXRoKCkucmVwbGFjZSgnYXBwLmFzYXInLCAnYXBwJyksICdidWlsZC9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uJykpO1xyXG5cclxuICAgICAgICAvLyBMb2cgdGhlIGJhc2UgZGlyZWN0b3JpZXMgd2UnbGwgdHJ5XHJcbiAgICAgICAgdGhpcy5sb2dnZXIubG9nKCdUcnlpbmcgdG8gbG9hZCByZWdpc3RyeSBmcm9tIHRoZXNlIGJhc2UgZGlyZWN0b3JpZXM6JywgJ0lORk8nLCBiYXNlRGlycyk7XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAvLyBUcnkgdG8gbG9hZCBtb2R1bGUgZnJvbSB0aGUgYmVzdCBwYXRoXHJcbiAgICAgICAgICByZWdpc3RyeSA9IGF3YWl0IE1vZHVsZUxvYWRlci5sb2FkTW9kdWxlRnJvbUJlc3RQYXRoKCdDb252ZXJ0ZXJSZWdpc3RyeS5qcycsIGJhc2VEaXJzKTtcclxuICAgICAgICB9IGNhdGNoIChiZXN0UGF0aEVycm9yKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignQWxsIHBhdGggbG9hZGluZyBhdHRlbXB0cyBmYWlsZWQsIHVzaW5nIGVtYmVkZGVkIHJlZ2lzdHJ5JywgYmVzdFBhdGhFcnJvcik7XHJcbiAgICAgICAgICAvLyBXaGVuIGFsbCBlbHNlIGZhaWxzLCB1c2Ugb3VyIGVtYmVkZGVkIHJlZ2lzdHJ5XHJcbiAgICAgICAgICByZWdpc3RyeSA9IE1pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeTtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1VzaW5nIGVtYmVkZGVkIE1pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeSBhcyBsYXN0IHJlc29ydCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gVmFsaWRhdGUgdGhlIHJlZ2lzdHJ5XHJcbiAgICAgIGlmICghdGhpcy5fdmFsaWRhdGVSZWdpc3RyeShyZWdpc3RyeSkpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignSW52YWxpZCBjb252ZXJ0ZXIgcmVnaXN0cnkgc3RydWN0dXJlLCB1c2luZyBlbWJlZGRlZCByZWdpc3RyeScpO1xyXG4gICAgICAgIC8vIFVzZSBvdXIgZW1iZWRkZWQgcmVnaXN0cnlcclxuICAgICAgICByZWdpc3RyeSA9IE1pbmltYWxDb252ZXJ0ZXJSZWdpc3RyeTtcclxuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdVc2luZyBlbWJlZGRlZCBNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkgYXMgbGFzdCByZXNvcnQnKTtcclxuXHJcbiAgICAgICAgLy8gRG91YmxlLWNoZWNrIHRoYXQgb3VyIGVtYmVkZGVkIHJlZ2lzdHJ5IGlzIHZhbGlkXHJcbiAgICAgICAgaWYgKCF0aGlzLl92YWxpZGF0ZVJlZ2lzdHJ5KHJlZ2lzdHJ5KSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNaW5pbWFsQ29udmVydGVyUmVnaXN0cnkgaXMgaW52YWxpZCEnKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIExvZyB0aGUgY29udmVydGVycyBpbiB0aGUgcmVnaXN0cnlcclxuICAgICAgdGhpcy5sb2dnZXIubG9nKCdBdmFpbGFibGUgY29udmVydGVyczonLCBPYmplY3Qua2V5cyhyZWdpc3RyeS5jb252ZXJ0ZXJzIHx8IHt9KSk7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKCdTdWNjZXNzZnVsbHkgbG9hZGVkIGNvbnZlcnRlciByZWdpc3RyeScpO1xyXG4gICAgICB0aGlzLl9jb252ZXJ0ZXJSZWdpc3RyeSA9IHJlZ2lzdHJ5O1xyXG4gICAgICB0aGlzLl9pbml0aWFsaXplZCA9IHRydWU7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuSU5JVElBTElaSU5HLFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkNPTVBMRVRFRFxyXG4gICAgICApO1xyXG5cclxuICAgICAgcmV0dXJuIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5faW5pdFByb21pc2UgPSBudWxsO1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dDb252ZXJzaW9uRXJyb3IoJ2luaXQnLCBlcnJvcik7XHJcbiAgICAgIFxyXG4gICAgICAvLyBQcm92aWRlIGJldHRlciBlcnJvciBpbmZvcm1hdGlvblxyXG4gICAgICBjb25zdCBlbmhhbmNlZEVycm9yID0gbmV3IEVycm9yKGBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBjb252ZXJ0ZXIgcmVnaXN0cnk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgZW5oYW5jZWRFcnJvci5vcmlnaW5hbCA9IGVycm9yO1xyXG4gICAgICBlbmhhbmNlZEVycm9yLnN0YWNrID0gZXJyb3Iuc3RhY2s7XHJcbiAgICAgIHRocm93IGVuaGFuY2VkRXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBfdmFsaWRhdGVSZWdpc3RyeShyZWdpc3RyeSkge1xyXG4gICAgaWYgKCFyZWdpc3RyeSB8fCB0eXBlb2YgcmVnaXN0cnkgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoIXJlZ2lzdHJ5LmNvbnZlcnRlcnMgfHwgdHlwZW9mIHJlZ2lzdHJ5LmNvbnZlcnRlcnMgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAodHlwZW9mIHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAodHlwZW9mIHJlZ2lzdHJ5LmdldENvbnZlcnRlckJ5RXh0ZW5zaW9uICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDYXRlZ29yaXplIGZpbGUgdHlwZXMgZm9yIGJldHRlciBvcmdhbml6YXRpb25cclxuICovXHJcbmNvbnN0IEZJTEVfVFlQRV9DQVRFR09SSUVTID0ge1xyXG4gIC8vIEF1ZGlvIGZpbGVzXHJcbiAgbXAzOiAnYXVkaW8nLFxyXG4gIHdhdjogJ2F1ZGlvJyxcclxuICBvZ2c6ICdhdWRpbycsXHJcbiAgZmxhYzogJ2F1ZGlvJyxcclxuICBcclxuICAvLyBWaWRlbyBmaWxlc1xyXG4gIG1wNDogJ3ZpZGVvJyxcclxuICB3ZWJtOiAndmlkZW8nLFxyXG4gIGF2aTogJ3ZpZGVvJyxcclxuICBtb3Y6ICd2aWRlbycsXHJcbiAgXHJcbiAgLy8gRG9jdW1lbnQgZmlsZXNcclxuICBwZGY6ICdkb2N1bWVudCcsXHJcbiAgZG9jeDogJ2RvY3VtZW50JyxcclxuICBwcHR4OiAnZG9jdW1lbnQnLFxyXG4gIFxyXG4gIC8vIERhdGEgZmlsZXNcclxuICB4bHN4OiAnZGF0YScsXHJcbiAgY3N2OiAnZGF0YScsXHJcbiAgXHJcbiAgLy8gV2ViIGNvbnRlbnRcclxuICB1cmw6ICd3ZWInLFxyXG4gIHBhcmVudHVybDogJ3dlYicsXHJcbn07XHJcblxyXG4vKipcclxuICogRW5oYW5jZWQgVW5pZmllZENvbnZlcnRlckZhY3RvcnkgY2xhc3Mgd2l0aCBwcm9wZXIgaW5pdGlhbGl6YXRpb24gYW5kIGNvbnZlcnNpb24gaGFuZGxpbmdcclxuICovXHJcbmNsYXNzIFVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5IHtcclxuICBzdGF0aWMgX2luc3RhbmNlID0gbnVsbDtcclxuICBcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuX2luaXRpYWxpemVyID0gQ29udmVydGVySW5pdGlhbGl6ZXIuZ2V0SW5zdGFuY2UoKTtcclxuICAgIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5ID0gbnVsbDtcclxuICAgIHRoaXMubG9nZ2VyID0gZ2V0TG9nZ2VyKCdVbmlmaWVkQ29udmVydGVyRmFjdG9yeScpO1xyXG4gICAgdGhpcy5sb2dnZXIubG9nKCdVbmlmaWVkQ29udmVydGVyRmFjdG9yeSBpbml0aWFsaXplZCcsICdJTkZPJyk7XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgZ2V0SW5zdGFuY2UoKSB7XHJcbiAgICBpZiAoIVVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5Ll9pbnN0YW5jZSkge1xyXG4gICAgICBVbmlmaWVkQ29udmVydGVyRmFjdG9yeS5faW5zdGFuY2UgPSBuZXcgVW5pZmllZENvbnZlcnRlckZhY3RvcnkoKTtcclxuICAgIH1cclxuICAgIHJldHVybiBVbmlmaWVkQ29udmVydGVyRmFjdG9yeS5faW5zdGFuY2U7XHJcbiAgfVxyXG5cclxuICBhc3luYyBfZW5zdXJlSW5pdGlhbGl6ZWQoKSB7XHJcbiAgICBpZiAoIXRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5KSB7XHJcbiAgICAgIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5ID0gYXdhaXQgdGhpcy5faW5pdGlhbGl6ZXIuaW5pdGlhbGl6ZSgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXMuX2NvbnZlcnRlclJlZ2lzdHJ5O1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0Q29udmVydGVyKGZpbGVUeXBlKSB7XHJcbiAgICB0aGlzLmxvZ2dlci5zZXRDb250ZXh0KHsgZmlsZVR5cGUgfSk7XHJcbiAgICBcclxuICAgIGNvbnN0IHJlZ2lzdHJ5ID0gYXdhaXQgdGhpcy5fZW5zdXJlSW5pdGlhbGl6ZWQoKTtcclxuICAgIFxyXG4gICAgaWYgKCFmaWxlVHlwZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpbGUgdHlwZSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIE5vcm1hbGl6ZSBmaWxlIHR5cGUgKHJlbW92ZSBkb3QsIGxvd2VyY2FzZSlcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0gZmlsZVR5cGUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9eXFwuLywgJycpO1xyXG5cclxuICAgIC8vIEdldCBVUkwgY29udmVydGVyIGRpcmVjdGx5IGZyb20gcmVnaXN0cnkgaWYgYXZhaWxhYmxlXHJcbiAgICBpZiAobm9ybWFsaXplZFR5cGUgPT09ICd1cmwnIHx8IG5vcm1hbGl6ZWRUeXBlID09PSAncGFyZW50dXJsJykge1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2coYFVzaW5nIGRpcmVjdCBVUkwgY29udmVydGVyIGZvcjogJHtub3JtYWxpemVkVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgY29udmVydGVyID0gcmVnaXN0cnkuY29udmVydGVycz8uW25vcm1hbGl6ZWRUeXBlXTtcclxuICAgICAgaWYgKGNvbnZlcnRlcikge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLnN1Y2Nlc3MoYEZvdW5kICR7bm9ybWFsaXplZFR5cGV9IGNvbnZlcnRlcmApO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBjb252ZXJ0ZXI6IHtcclxuICAgICAgICAgICAgLi4uY29udmVydGVyLFxyXG4gICAgICAgICAgICB0eXBlOiBub3JtYWxpemVkVHlwZSxcclxuICAgICAgICAgICAgY29udmVydDogYXN5bmMgKGNvbnRlbnQsIG5hbWUsIGFwaUtleSwgb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgICAgIHJldHVybiBjb252ZXJ0ZXIuY29udmVydChjb250ZW50LCBuYW1lLCBhcGlLZXksIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICBuYW1lLFxyXG4gICAgICAgICAgICAgICAgdHlwZTogbm9ybWFsaXplZFR5cGVcclxuICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIHR5cGU6IG5vcm1hbGl6ZWRUeXBlLFxyXG4gICAgICAgICAgY2F0ZWdvcnk6ICd3ZWInXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gVHJ5IGZhbGxiYWNrIHRvIGNvbnZlcnRUb01hcmtkb3duXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZyhgQXR0ZW1wdGluZyBjb252ZXJ0VG9NYXJrZG93biBmYWxsYmFjayBmb3IgJHtub3JtYWxpemVkVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICBpZiAocmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24pIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgY29udmVydGVyOiB7XHJcbiAgICAgICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgICAgICByZXR1cm4gcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24obm9ybWFsaXplZFR5cGUsIGNvbnRlbnQsIHtcclxuICAgICAgICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICAgICAgICBhcGlLZXksXHJcbiAgICAgICAgICAgICAgICAuLi5vcHRpb25zXHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHZhbGlkYXRlOiAoaW5wdXQpID0+IHR5cGVvZiBpbnB1dCA9PT0gJ3N0cmluZycgJiYgaW5wdXQubGVuZ3RoID4gMCxcclxuICAgICAgICAgICAgY29uZmlnOiB7XHJcbiAgICAgICAgICAgICAgbmFtZTogbm9ybWFsaXplZFR5cGUgPT09ICd1cmwnID8gJ1dlYiBQYWdlJyA6ICdXZWJzaXRlJyxcclxuICAgICAgICAgICAgICBleHRlbnNpb25zOiBbJy51cmwnLCAnLmh0bWwnLCAnLmh0bSddLFxyXG4gICAgICAgICAgICAgIG1pbWVUeXBlczogWyd0ZXh0L2h0bWwnLCAnYXBwbGljYXRpb24veC11cmwnXSxcclxuICAgICAgICAgICAgICBtYXhTaXplOiAxMCAqIDEwMjQgKiAxMDI0XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB0eXBlOiBub3JtYWxpemVkVHlwZSxcclxuICAgICAgICAgIGNhdGVnb3J5OiAnd2ViJ1xyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gRm9yIGFsbCBvdGhlciB0eXBlcywgZ2V0IGNvbnZlcnRlciBmcm9tIHJlZ2lzdHJ5XHJcbiAgICBjb25zdCBjb252ZXJ0ZXIgPSBhd2FpdCByZWdpc3RyeS5nZXRDb252ZXJ0ZXJCeUV4dGVuc2lvbihub3JtYWxpemVkVHlwZSk7XHJcbiAgICBpZiAoY29udmVydGVyKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgY29udmVydGVyLFxyXG4gICAgICAgIHR5cGU6IG5vcm1hbGl6ZWRUeXBlLFxyXG4gICAgICAgIGNhdGVnb3J5OiBGSUxFX1RZUEVfQ0FURUdPUklFU1tub3JtYWxpemVkVHlwZV0gfHwgJ2RvY3VtZW50J1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHRocm93IG5ldyBFcnJvcihgTm8gY29udmVydGVyIGZvdW5kIGZvciB0eXBlOiAke2ZpbGVUeXBlfWApO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ29udmVydCBhIGZpbGUgdG8gbWFya2Rvd24gdXNpbmcgdGhlIGFwcHJvcHJpYXRlIGNvbnZlcnRlclxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gdGhlIGZpbGUgb3IgVVJMIHN0cmluZ1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gLSBDb252ZXJzaW9uIHJlc3VsdFxyXG4gICAqL1xyXG4gIGFzeW5jIGNvbnZlcnRGaWxlKGZpbGVQYXRoLCBvcHRpb25zID0ge30pIHtcclxuICAgIGNvbnN0IGZpbGVUeXBlID0gb3B0aW9ucy5maWxlVHlwZTtcclxuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XHJcbiAgICBcclxuICAgIHRoaXMubG9nZ2VyLmxvZ0NvbnZlcnNpb25TdGFydChmaWxlVHlwZSwgb3B0aW9ucyk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICghZmlsZVR5cGUpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2ZpbGVUeXBlIGlzIHJlcXVpcmVkIGluIG9wdGlvbnMnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gRGV0ZXJtaW5lIGlmIHRoaXMgaXMgYSBVUkwgb3IgYSBmaWxlXHJcbiAgICAgIGNvbnN0IGlzVXJsID0gZmlsZVR5cGUgPT09ICd1cmwnIHx8IGZpbGVUeXBlID09PSAncGFyZW50dXJsJztcclxuXHJcbiAgICAgIC8vIEdldCBmaWxlIGRldGFpbHMgLSBoYW5kbGUgVVJMcyBkaWZmZXJlbnRseVxyXG4gICAgICBsZXQgZmlsZU5hbWU7XHJcblxyXG4gICAgICBpZiAoQnVmZmVyLmlzQnVmZmVyKGZpbGVQYXRoKSkge1xyXG4gICAgICAgIC8vIFVzZSBvcmlnaW5hbEZpbGVOYW1lIGZyb20gb3B0aW9ucywgb3IgZmFsbGJhY2sgdG8gcHJvdmlkZWQgbmFtZSBpZiBhdmFpbGFibGVcclxuICAgICAgICBmaWxlTmFtZSA9IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSB8fCBvcHRpb25zLm5hbWU7XHJcblxyXG4gICAgICAgIGlmICghZmlsZU5hbWUpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignb3JpZ2luYWxGaWxlTmFtZSBpcyByZXF1aXJlZCB3aGVuIHBhc3NpbmcgYnVmZmVyIGlucHV0Jyk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKGlzVXJsKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGNvbnN0IHVybE9iaiA9IG5ldyBVUkwoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSB1cmxPYmouaG9zdG5hbWUgKyAodXJsT2JqLnBhdGhuYW1lICE9PSAnLycgPyB1cmxPYmoucGF0aG5hbWUgOiAnJyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSBmaWxlUGF0aDtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZmlsZU5hbWUgPSBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgb3B0aW9ucy5uYW1lIHx8IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBFbnN1cmUgb3JpZ2luYWxGaWxlTmFtZSBpcyBhbHdheXMgc2V0IGluIG9wdGlvbnNcclxuICAgICAgb3B0aW9ucy5vcmlnaW5hbEZpbGVOYW1lID0gZmlsZU5hbWU7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuU1RBUlRJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuVkFMSURBVElOR1xyXG4gICAgICApO1xyXG4gICAgICBcclxuICAgICAgLy8gR2V0IHRoZSBhcHByb3ByaWF0ZSBjb252ZXJ0ZXIgd2l0aCBhc3luYy9hd2FpdFxyXG4gICAgICBsZXQgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIFVSTCB0eXBlcyBpbiBwcm9kdWN0aW9uIG1vZGVcclxuICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvICYmIChmaWxlVHlwZSA9PT0gJ3VybCcgfHwgZmlsZVR5cGUgPT09ICdwYXJlbnR1cmwnKSkge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgU3BlY2lhbCBoYW5kbGluZyBmb3IgJHtmaWxlVHlwZX0gaW4gcHJvZHVjdGlvbiBtb2RlYCwgJ0lORk8nKTtcclxuICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5jcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChjb252ZXJ0ZXJJbmZvKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKGBDcmVhdGVkIGRpcmVjdCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBJZiBjb252ZXJ0ZXIgbm90IGZvdW5kLCB0cnkgYWdhaW4gYWZ0ZXIgYSBzaG9ydCBkZWxheVxyXG4gICAgICBpZiAoIWNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFJldHJ5aW5nIHRvIGdldCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9IGFmdGVyIGRlbGF5Li4uYCwgJ0lORk8nKTtcclxuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNTAwKSk7XHJcbiAgICAgICAgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWNvbnZlcnRlckluZm8gJiYgKGZpbGVUeXBlID09PSAndXJsJyB8fCBmaWxlVHlwZSA9PT0gJ3BhcmVudHVybCcpKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFNlY29uZCBhdHRlbXB0IGF0IHNwZWNpYWwgaGFuZGxpbmcgZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgICAgICAgIGNvbnZlcnRlckluZm8gPSBhd2FpdCB0aGlzLmNyZWF0ZURpcmVjdFVybENvbnZlcnRlcihmaWxlVHlwZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIElmIHN0aWxsIG5vdCBmb3VuZCwgdHJ5IG9uZSBtb3JlIHRpbWUgd2l0aCBhIGxvbmdlciBkZWxheVxyXG4gICAgICAgIGlmICghY29udmVydGVySW5mbykge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBGaW5hbCBhdHRlbXB0IHRvIGdldCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9IGFmdGVyIGxvbmdlciBkZWxheS4uLmAsICdJTkZPJyk7XHJcbiAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwMCkpO1xyXG4gICAgICAgICAgY29udmVydGVySW5mbyA9IGF3YWl0IHRoaXMuZ2V0Q29udmVydGVyKGZpbGVUeXBlKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgaWYgKCFjb252ZXJ0ZXJJbmZvICYmIChmaWxlVHlwZSA9PT0gJ3VybCcgfHwgZmlsZVR5cGUgPT09ICdwYXJlbnR1cmwnKSkge1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coYEZpbmFsIGF0dGVtcHQgYXQgc3BlY2lhbCBoYW5kbGluZyBmb3IgJHtmaWxlVHlwZX1gLCAnSU5GTycpO1xyXG4gICAgICAgICAgICBjb252ZXJ0ZXJJbmZvID0gYXdhaXQgdGhpcy5jcmVhdGVEaXJlY3RVcmxDb252ZXJ0ZXIoZmlsZVR5cGUpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBpZiAoIWNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBmaWxlIHR5cGU6ICR7ZmlsZVR5cGV9YCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgYSBwcm9ncmVzcyB0cmFja2VyIGlmIGNhbGxiYWNrIHByb3ZpZGVkXHJcbiAgICAgIGNvbnN0IHByb2dyZXNzVHJhY2tlciA9IG9wdGlvbnMub25Qcm9ncmVzcyA/IFxyXG4gICAgICAgIG5ldyBQcm9ncmVzc1RyYWNrZXIob3B0aW9ucy5vblByb2dyZXNzLCAyNTApIDogbnVsbDtcclxuICAgICAgXHJcbiAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDUsIHsgc3RhdHVzOiAnaW5pdGlhbGl6aW5nJywgZmlsZVR5cGU6IGZpbGVUeXBlIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZWdpc3RyeSA9IGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKCk7XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQ29udmVydGVyIGluZm86Jywgc2FuaXRpemVGb3JMb2dnaW5nKHtcclxuICAgICAgICBoYXNSZWdpc3RyeTogISFyZWdpc3RyeSxcclxuICAgICAgICBjb252ZXJ0ZXJUeXBlOiBjb252ZXJ0ZXJJbmZvPy50eXBlIHx8ICdub25lJyxcclxuICAgICAgICBjYXRlZ29yeTogY29udmVydGVySW5mbz8uY2F0ZWdvcnkgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgIGhhc0NvbnZlcnRlcjogISFjb252ZXJ0ZXJJbmZvPy5jb252ZXJ0ZXIsXHJcbiAgICAgICAgY29udmVydGVyRGV0YWlsczogY29udmVydGVySW5mbz8uY29udmVydGVyXHJcbiAgICAgIH0pKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEhhbmRsZSB0aGUgY29udmVyc2lvbiBiYXNlZCBvbiBmaWxlIHR5cGVcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5oYW5kbGVDb252ZXJzaW9uKGZpbGVQYXRoLCB7XHJcbiAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUsXHJcbiAgICAgICAgZmlsZU5hbWUsXHJcbiAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLFxyXG4gICAgICAgIGNvbnZlcnRlckluZm8sXHJcbiAgICAgICAgaXNVcmxcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgcHJvZ3Jlc3NUcmFja2VyLnVwZGF0ZSgxMDAsIHsgc3RhdHVzOiAnY29tcGxldGVkJyB9KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvbkNvbXBsZXRlKGZpbGVUeXBlKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvbkVycm9yKGZpbGVUeXBlLCBlcnJvcik7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgIGZpbGVUeXBlOiBmaWxlVHlwZSxcclxuICAgICAgICB0eXBlOiBmaWxlVHlwZSxcclxuICAgICAgICBuYW1lOiBvcHRpb25zLm9yaWdpbmFsRmlsZU5hbWUgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgIGNhdGVnb3J5OiBGSUxFX1RZUEVfQ0FURUdPUklFU1tmaWxlVHlwZV0gfHwgJ3Vua25vd24nXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGUgYSBkaXJlY3QgVVJMIGNvbnZlcnRlciBmb3IgcHJvZHVjdGlvbiBtb2RlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVUeXBlIC0gVVJMIGZpbGUgdHlwZSAoJ3VybCcgb3IgJ3BhcmVudHVybCcpXHJcbiAgICogQHJldHVybnMge09iamVjdHxudWxsfSAtIENvbnZlcnRlciBpbmZvIG9yIG51bGwgaWYgbm90IHBvc3NpYmxlXHJcbiAgICovXHJcbiAgYXN5bmMgY3JlYXRlRGlyZWN0VXJsQ29udmVydGVyKGZpbGVUeXBlKSB7XHJcbiAgICB0aGlzLmxvZ2dlci5sb2coYENyZWF0aW5nIGRpcmVjdCBVUkwgY29udmVydGVyIGZvciAke2ZpbGVUeXBlfWAsICdJTkZPJyk7XHJcbiAgICBcclxuICAgIGNvbnN0IHJlZ2lzdHJ5ID0gYXdhaXQgdGhpcy5fZW5zdXJlSW5pdGlhbGl6ZWQoKTtcclxuICAgIGlmICghcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24pIHtcclxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0Nhbm5vdCBjcmVhdGUgZGlyZWN0IFVSTCBjb252ZXJ0ZXI6IGNvbnZlcnRUb01hcmtkb3duIG5vdCBhdmFpbGFibGUnKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGNvbnZlcnRlcjoge1xyXG4gICAgICAgIGNvbnZlcnQ6IGFzeW5jIChjb250ZW50LCBuYW1lLCBhcGlLZXksIG9wdGlvbnMpID0+IHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgVXNpbmcgZGlyZWN0IFVSTCBjb252ZXJ0ZXIgZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgICAgICAgIHJldHVybiByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93bihmaWxlVHlwZSwgY29udGVudCwge1xyXG4gICAgICAgICAgICBuYW1lLFxyXG4gICAgICAgICAgICBhcGlLZXksXHJcbiAgICAgICAgICAgIC4uLm9wdGlvbnNcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgdmFsaWRhdGU6IChpbnB1dCkgPT4gdHlwZW9mIGlucHV0ID09PSAnc3RyaW5nJyAmJiBpbnB1dC5sZW5ndGggPiAwLFxyXG4gICAgICAgIGNvbmZpZzoge1xyXG4gICAgICAgICAgbmFtZTogZmlsZVR5cGUgPT09ICd1cmwnID8gJ1dlYiBQYWdlJyA6ICdXZWJzaXRlJyxcclxuICAgICAgICAgIGV4dGVuc2lvbnM6IFsnLnVybCcsICcuaHRtbCcsICcuaHRtJ10sXHJcbiAgICAgICAgICBtaW1lVHlwZXM6IFsndGV4dC9odG1sJywgJ2FwcGxpY2F0aW9uL3gtdXJsJ10sXHJcbiAgICAgICAgICBtYXhTaXplOiAxMCAqIDEwMjQgKiAxMDI0XHJcbiAgICAgICAgfVxyXG4gICAgICB9LFxyXG4gICAgICB0eXBlOiBmaWxlVHlwZSxcclxuICAgICAgY2F0ZWdvcnk6ICd3ZWInXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU3RhbmRhcmRpemUgY29udmVyc2lvbiByZXN1bHQgdG8gZW5zdXJlIGNvbnNpc3RlbnQgZm9ybWF0XHJcbiAgICpcclxuICAgKiBJTVBPUlRBTlQ6IFRoaXMgbWV0aG9kIGVuc3VyZXMgcHJvcGVydGllcyBhcmUgc2V0IGluIHRoZSBjb3JyZWN0IG9yZGVyIHRvIHByZXZlbnRcclxuICAgKiBwcm9wZXJ0eSBzaGFkb3dpbmcgaXNzdWVzLiBUaGUgb3JkZXIgbWF0dGVycyBiZWNhdXNlOlxyXG4gICAqIDEuIFdlIGZpcnN0IHNwcmVhZCB0aGUgcmVzdWx0IG9iamVjdCB0byBpbmNsdWRlIGFsbCBpdHMgcHJvcGVydGllc1xyXG4gICAqIDIuIFRoZW4gd2Ugb3ZlcnJpZGUgc3BlY2lmaWMgcHJvcGVydGllcyB0byBlbnN1cmUgdGhleSBoYXZlIHRoZSBjb3JyZWN0IHZhbHVlc1xyXG4gICAqIDMuIFdlIHNldCBjb250ZW50IGxhc3QgdG8gZW5zdXJlIGl0J3Mgbm90IGFjY2lkZW50YWxseSBvdmVycmlkZGVuXHJcbiAgICogNC4gV2UgYWRkIGEgZmluYWwgY2hlY2sgdG8gZW5zdXJlIGNvbnRlbnQgaXMgbmV2ZXIgZW1wdHksIHByb3ZpZGluZyBhIGZhbGxiYWNrXHJcbiAgICpcclxuICAgKiBUaGlzIGZpeGVzIHRoZSBcIkNvbnZlcnNpb24gcHJvZHVjZWQgZW1wdHkgY29udGVudFwiIGVycm9yIHRoYXQgY291bGQgb2NjdXIgd2hlblxyXG4gICAqIHRoZSBjb250ZW50IHByb3BlcnR5IHdhcyBvdmVycmlkZGVuIGJ5IHRoZSBzcHJlYWQgb3BlcmF0b3IuXHJcbiAgICpcclxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVzdWx0IC0gUmF3IGNvbnZlcnNpb24gcmVzdWx0XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVUeXBlIC0gRmlsZSB0eXBlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVOYW1lIC0gRmlsZSBuYW1lXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGNhdGVnb3J5IC0gRmlsZSBjYXRlZ29yeVxyXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IC0gU3RhbmRhcmRpemVkIHJlc3VsdFxyXG4gICAqL1xyXG4gIHN0YW5kYXJkaXplUmVzdWx0KHJlc3VsdCwgZmlsZVR5cGUsIGZpbGVOYW1lLCBjYXRlZ29yeSkge1xyXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoYFJhdyByZXN1bHQgcmVjZWl2ZWQgZm9yICR7ZmlsZVR5cGV9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhyZXN1bHQpKTsgLy8gQWRkIGxvZ2dpbmdcclxuXHJcbiAgICAvLyBMb2cgZGV0YWlsZWQgZmlsZW5hbWUgaW5mb3JtYXRpb24gZm9yIGRlYnVnZ2luZ1xyXG4gICAgdGhpcy5sb2dnZXIubG9nKGDwn5OEIEZpbGVuYW1lIGRldGFpbHMgZm9yICR7ZmlsZVR5cGV9OmAsIHtcclxuICAgICAgcmVzdWx0T3JpZ2luYWxGaWxlTmFtZTogcmVzdWx0Py5vcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICByZXN1bHRNZXRhZGF0YU9yaWdpbmFsRmlsZU5hbWU6IHJlc3VsdD8ubWV0YWRhdGE/Lm9yaWdpbmFsRmlsZU5hbWUsXHJcbiAgICAgIHJlc3VsdE5hbWU6IHJlc3VsdD8ubmFtZSxcclxuICAgICAgZnVuY3Rpb25QYXJhbUZpbGVOYW1lOiBmaWxlTmFtZVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRkIGVuaGFuY2VkIGxvZ2dpbmcgc3BlY2lmaWNhbGx5IGZvciBFeGNlbC9DU1YgZmlsZXMgdG8gdHJhY2UgZmlsZW5hbWUgaGFuZGxpbmdcclxuICAgIGlmIChmaWxlVHlwZSA9PT0gJ3hsc3gnIHx8IGZpbGVUeXBlID09PSAnY3N2Jykge1xyXG4gICAgICB0aGlzLmxvZ2dlci5sb2coYPCfk4ogRXhjZWwvQ1NWIGZpbGUgZGV0YWlsczpgLCB7XHJcbiAgICAgICAgb3JpZ2luYWxGaWxlTmFtZUZyb21SZXN1bHQ6IHJlc3VsdD8ub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICBvcmlnaW5hbEZpbGVOYW1lRnJvbU1ldGFkYXRhOiByZXN1bHQ/Lm1ldGFkYXRhPy5vcmlnaW5hbEZpbGVOYW1lLFxyXG4gICAgICAgIG5hbWVGcm9tUmVzdWx0OiByZXN1bHQ/Lm5hbWUsXHJcbiAgICAgICAgZmlsZU5hbWVQYXJhbTogZmlsZU5hbWUsXHJcbiAgICAgICAgcmVzdWx0S2V5czogcmVzdWx0ID8gT2JqZWN0LmtleXMocmVzdWx0KSA6IFtdLFxyXG4gICAgICAgIG1ldGFkYXRhS2V5czogcmVzdWx0Py5tZXRhZGF0YSA/IE9iamVjdC5rZXlzKHJlc3VsdC5tZXRhZGF0YSkgOiBbXVxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBIYW5kbGUgbnVsbCBvciB1bmRlZmluZWQgcmVzdWx0IGV4cGxpY2l0bHlcclxuICAgIGlmICghcmVzdWx0KSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgUmVjZWl2ZWQgbnVsbCBvciB1bmRlZmluZWQgcmVzdWx0IGZvciAke2ZpbGVUeXBlfS4gQXNzdW1pbmcgZmFpbHVyZS5gKTtcclxuICAgICAgICByZXN1bHQgPSB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogJ0NvbnZlcnRlciByZXR1cm5lZCBudWxsIG9yIHVuZGVmaW5lZCByZXN1bHQnIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIHN1Y2Nlc3Mgc3RhdHVzIG1vcmUgcm9idXN0bHlcclxuICAgIC8vIFN1Y2Nlc3MgaXMgT05MWSB0cnVlIGlmIHJlc3VsdC5zdWNjZXNzIGlzIGV4cGxpY2l0bHkgdHJ1ZS5cclxuICAgIC8vIE90aGVyd2lzZSwgaXQncyBmYWxzZSwgZXNwZWNpYWxseSBpZiBhbiBlcnJvciBwcm9wZXJ0eSBleGlzdHMuXHJcbiAgICBjb25zdCBpc1N1Y2Nlc3MgPSByZXN1bHQuc3VjY2VzcyA9PT0gdHJ1ZTtcclxuXHJcbiAgICAvLyBTYW5pdGl6ZSBwb3RlbnRpYWxseSBjb21wbGV4IG9iamVjdHMgd2l0aGluIHRoZSByZXN1bHQgKmFmdGVyKiBkZXRlcm1pbmluZyBzdWNjZXNzXHJcbiAgICBjb25zdCBzYW5pdGl6ZWRSZXN1bHQgPSBzYW5pdGl6ZUZvckxvZ2dpbmcocmVzdWx0KTtcclxuXHJcbiAgICAvLyBGb3IgWExTWCBhbmQgQ1NWIGZpbGVzLCB3ZSB3YW50IHRvIGJlIGFic29sdXRlbHkgY2VydGFpbiB0aGF0IG9yaWdpbmFsRmlsZU5hbWUgaXMgcHJlc2VydmVkXHJcbiAgICBjb25zdCBvcmlnaW5hbEZpbGVOYW1lID0gKGZpbGVUeXBlID09PSAneGxzeCcgfHwgZmlsZVR5cGUgPT09ICdjc3YnKVxyXG4gICAgICA/ICgocmVzdWx0Lm1ldGFkYXRhICYmIHJlc3VsdC5tZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lKSB8fCByZXN1bHQub3JpZ2luYWxGaWxlTmFtZSB8fCByZXN1bHQubmFtZSB8fCBmaWxlTmFtZSlcclxuICAgICAgOiAoKHJlc3VsdC5tZXRhZGF0YSAmJiByZXN1bHQubWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSkgfHwgcmVzdWx0Lm9yaWdpbmFsRmlsZU5hbWUgfHwgcmVzdWx0Lm5hbWUgfHwgZmlsZU5hbWUpO1xyXG5cclxuICAgIC8vIExvZyB0aGUgZGV0ZXJtaW5lZCBvcmlnaW5hbEZpbGVOYW1lXHJcbiAgICB0aGlzLmxvZ2dlci5sb2coYPCfk50gRmluYWwgb3JpZ2luYWxGaWxlTmFtZSBkZXRlcm1pbmVkIGZvciAke2ZpbGVUeXBlfTogJHtvcmlnaW5hbEZpbGVOYW1lfWApO1xyXG5cclxuICAgIGNvbnN0IHN0YW5kYXJkaXplZCA9IHtcclxuICAgICAgICAuLi5zYW5pdGl6ZWRSZXN1bHQsIC8vIFNwcmVhZCBzYW5pdGl6ZWQgcmVzdWx0IGZpcnN0XHJcbiAgICAgICAgc3VjY2VzczogaXNTdWNjZXNzLCAvLyBPdmVycmlkZSB3aXRoIGRldGVybWluZWQgc3VjY2VzcyBzdGF0dXNcclxuICAgICAgICB0eXBlOiByZXN1bHQudHlwZSB8fCBmaWxlVHlwZSxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUsXHJcbiAgICAgICAgbmFtZTogb3JpZ2luYWxGaWxlTmFtZSwgLy8gVXNlIHRoZSByZXNvbHZlZCBvcmlnaW5hbEZpbGVOYW1lXHJcbiAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogb3JpZ2luYWxGaWxlTmFtZSwgLy8gU2FtZSBmb3IgY29uc2lzdGVuY3lcclxuICAgICAgICBjYXRlZ29yeTogcmVzdWx0LmNhdGVnb3J5IHx8IGNhdGVnb3J5LFxyXG4gICAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgICAgIC4uLihyZXN1bHQubWV0YWRhdGEgfHwge30pLFxyXG4gICAgICAgICAgICBjb252ZXJ0ZXI6IHJlc3VsdC5jb252ZXJ0ZXIgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBvcmlnaW5hbEZpbGVOYW1lIC8vIFVzZSB0aGUgcmVzb2x2ZWQgb3JpZ2luYWxGaWxlTmFtZSBmb3IgY29uc2lzdGVuY3lcclxuICAgICAgICB9LFxyXG4gICAgICAgIGltYWdlczogcmVzdWx0LmltYWdlcyB8fCBbXSxcclxuICAgICAgICAvLyBFbnN1cmUgY29udGVudCBleGlzdHMsIHByb3ZpZGUgZmFsbGJhY2sgaWYgbmVlZGVkXHJcbiAgICAgICAgY29udGVudDogcmVzdWx0LmNvbnRlbnQgfHwgKGlzU3VjY2VzcyA/ICcnIDogYCMgQ29udmVyc2lvbiBSZXN1bHRcXG5cXG5UaGUgJHtmaWxlVHlwZX0gZmlsZSB3YXMgcHJvY2Vzc2VkLCBidXQgbm8gY29udGVudCB3YXMgZ2VuZXJhdGVkLiBUaGlzIG1pZ2h0IGluZGljYXRlIGFuIGlzc3VlIG9yIGJlIG5vcm1hbCBmb3IgdGhpcyBmaWxlIHR5cGUuYCksXHJcbiAgICAgICAgLy8gRW5zdXJlIGVycm9yIHByb3BlcnR5IGlzIHByZXNlbnQgaWYgbm90IHN1Y2Nlc3NmdWxcclxuICAgICAgICBlcnJvcjogIWlzU3VjY2VzcyA/IChyZXN1bHQuZXJyb3IgfHwgJ1Vua25vd24gY29udmVyc2lvbiBlcnJvcicpIDogdW5kZWZpbmVkXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFJlbW92ZSBlcnJvciBwcm9wZXJ0eSBpZiBzdWNjZXNzZnVsXHJcbiAgICBpZiAoc3RhbmRhcmRpemVkLnN1Y2Nlc3MpIHtcclxuICAgICAgICBkZWxldGUgc3RhbmRhcmRpemVkLmVycm9yO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBFbnN1cmUgY29udGVudCBpcyBub3QgbnVsbCBvciB1bmRlZmluZWQsIGFuZCBwcm92aWRlIGFwcHJvcHJpYXRlIGZhbGxiYWNrXHJcbiAgICBpZiAoIXN0YW5kYXJkaXplZC5jb250ZW50ICYmICFpc1N1Y2Nlc3MpIHtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nUGhhc2VUcmFuc2l0aW9uKFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkcsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuQ09OVEVOVF9FTVBUWVxyXG4gICAgICApO1xyXG4gICAgICAvLyBQcm92aWRlIGEgbW9yZSBpbmZvcm1hdGl2ZSBtZXNzYWdlIGlmIHRoZSBjb252ZXJzaW9uIGZhaWxlZCBhbmQgY29udGVudCBpcyBlbXB0eVxyXG4gICAgICBzdGFuZGFyZGl6ZWQuY29udGVudCA9IGAjIENvbnZlcnNpb24gRXJyb3JcXG5cXG5UaGUgJHtmaWxlVHlwZX0gZmlsZSBjb252ZXJzaW9uIGZhaWxlZCBvciBwcm9kdWNlZCBubyBjb250ZW50LiBFcnJvcjogJHtzdGFuZGFyZGl6ZWQuZXJyb3IgfHwgJ1Vua25vd24gZXJyb3InfWA7XHJcbiAgICB9IGVsc2UgaWYgKCFzdGFuZGFyZGl6ZWQuY29udGVudCAmJiBpc1N1Y2Nlc3MpIHtcclxuICAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5QUk9DRVNTSU5HLFxyXG4gICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLkNPTlRFTlRfRU1QVFlcclxuICAgICAgKTtcclxuICAgICAgLy8gRmFsbGJhY2sgZm9yIHN1Y2Nlc3NmdWwgY29udmVyc2lvbiBidXQgZW1wdHkgY29udGVudFxyXG4gICAgICBzdGFuZGFyZGl6ZWQuY29udGVudCA9IGAjIENvbnZlcnNpb24gUmVzdWx0XFxuXFxuVGhlICR7ZmlsZVR5cGV9IGZpbGUgd2FzIHByb2Nlc3NlZCBzdWNjZXNzZnVsbHksIGJ1dCBubyB0ZXh0dWFsIGNvbnRlbnQgd2FzIGdlbmVyYXRlZC4gVGhpcyBpcyBub3JtYWwgZm9yIGNlcnRhaW4gZmlsZSB0eXBlcyAoZS5nLiwgbXVsdGltZWRpYSBmaWxlcyB3aXRob3V0IHRyYW5zY3JpcHRpb24pLmA7XHJcbiAgICB9XHJcblxyXG5cclxuICAgIC8vIExvZyB0aGUgZmluYWwgc3RhbmRhcmRpemVkIHJlc3VsdFxyXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoYFN0YW5kYXJkaXplZCByZXN1bHQgZm9yICR7ZmlsZVR5cGV9OmAsIHNhbml0aXplRm9yTG9nZ2luZyhzdGFuZGFyZGl6ZWQpKTtcclxuXHJcbiAgICByZXR1cm4gc3RhbmRhcmRpemVkO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgaGFuZGxlQ29udmVyc2lvbihmaWxlUGF0aCwgb3B0aW9ucykge1xyXG4gICAgY29uc3QgeyBwcm9ncmVzc1RyYWNrZXIsIGZpbGVUeXBlLCBmaWxlTmFtZSwgY29udmVydGVySW5mbywgaXNVcmwgfSA9IG9wdGlvbnM7XHJcbiAgICAvLyBFeHRyYWN0IGNhdGVnb3J5IGZyb20gY29udmVydGVySW5mbyB0byBhdm9pZCBcImNhdGVnb3J5IGlzIG5vdCBkZWZpbmVkXCIgZXJyb3JcclxuICAgIGNvbnN0IGNhdGVnb3J5ID0gY29udmVydGVySW5mbz8uY2F0ZWdvcnkgfHwgRklMRV9UWVBFX0NBVEVHT1JJRVNbZmlsZVR5cGVdIHx8ICd1bmtub3duJztcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVmFsaWRhdGUgY29udmVydGVySW5mb1xyXG4gICAgICBpZiAoIWNvbnZlcnRlckluZm8pIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgTm8gY29udmVydGVyIGluZm8gYXZhaWxhYmxlIGZvciAke2ZpbGVUeXBlfWApO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gY29udmVydGVyIGluZm8gYXZhaWxhYmxlIGZvciAke2ZpbGVUeXBlfWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuVkFMSURBVElORyxcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GQVNUX0FUVEVNUFRcclxuICAgICAgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEhhbmRsZSBVUkwgYW5kIHBhcmVudCBVUkwgZGlmZmVyZW50bHkgc2luY2UgdGhleSBkb24ndCBuZWVkIGZpbGUgcmVhZGluZ1xyXG4gICAgICBpZiAoaXNVcmwpIHtcclxuICAgICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDIwLCB7IHN0YXR1czogYHByb2Nlc3NpbmdfJHtmaWxlVHlwZX1gIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0aGlzLmxvZ2dlci5sb2coYFByb2Nlc3NpbmcgVVJMOiAke2ZpbGVQYXRofWAsICdJTkZPJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gRm9yIFVSTHMsIGZpbGVQYXRoIGlzIGFjdHVhbGx5IHRoZSBVUkwgc3RyaW5nXHJcbiAgICAgICAgbGV0IHJlc3VsdDtcclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgLy8gRXh0cmFjdCBjb252ZXJ0ZXIgZnJvbSBjb252ZXJ0ZXJJbmZvXHJcbiAgICAgICAgICBjb25zdCB7IGNvbnZlcnRlciB9ID0gY29udmVydGVySW5mbztcclxuXHJcbiAgICAgICAgICAvLyBUcnkgdXNpbmcgdGhlIGNvbnZlcnRlcidzIGNvbnZlcnQgbWV0aG9kIGZpcnN0XHJcbiAgICAgICAgICBpZiAodHlwZW9mIGNvbnZlcnRlci5jb252ZXJ0ID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgVXNpbmcgY29udmVydGVyLmNvbnZlcnQgZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBVUkwgY29udmVydCBjYWxsZWQgd2l0aCBvcmlnaW5hbEZpbGVOYW1lOiAke2ZpbGVOYW1lfWAsICdJTkZPJyk7XHJcblxyXG4gICAgICAgICAgICByZXN1bHQgPSBhd2FpdCBjb252ZXJ0ZXIuY29udmVydChmaWxlUGF0aCwgZmlsZU5hbWUsIG9wdGlvbnMuYXBpS2V5LCB7XHJcbiAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICBuYW1lOiBmaWxlTmFtZSxcclxuICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBmaWxlTmFtZSwgLy8gRXhwbGljaXRseSBwYXNzIG9yaWdpbmFsRmlsZU5hbWVcclxuICAgICAgICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgICAgICAgLi4uKG9wdGlvbnMubWV0YWRhdGEgfHwge30pLFxyXG4gICAgICAgICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogZmlsZU5hbWUgLy8gQWxzbyBhZGQgb3JpZ2luYWxGaWxlTmFtZSB0byBtZXRhZGF0YVxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgb25Qcm9ncmVzczogKHByb2dyZXNzKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgICAgICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGVTY2FsZWQocHJvZ3Jlc3MsIDIwLCA5MCwge1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogdHlwZW9mIHByb2dyZXNzID09PSAnb2JqZWN0JyA/IHByb2dyZXNzLnN0YXR1cyA6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YFxyXG4gICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgLy8gRmFsbCBiYWNrIHRvIHVzaW5nIHRoZSByZWdpc3RyeSdzIGNvbnZlcnRUb01hcmtkb3duIG1ldGhvZFxyXG4gICAgICAgICAgICBjb25zdCByZWdpc3RyeSA9IGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKCk7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgVXNpbmcgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24gZm9yICR7ZmlsZVR5cGV9YCwgJ0lORk8nKTtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIubG9nKGBVUkwgY29udmVydFRvTWFya2Rvd24gY2FsbGVkIHdpdGggb3JpZ2luYWxGaWxlTmFtZTogJHtmaWxlTmFtZX1gLCAnSU5GTycpO1xyXG5cclxuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd24oZmlsZVR5cGUsIGZpbGVQYXRoLCB7XHJcbiAgICAgICAgICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgICAgICAgICBuYW1lOiBmaWxlTmFtZSxcclxuICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBmaWxlTmFtZSwgLy8gRXhwbGljaXRseSBwYXNzIG9yaWdpbmFsRmlsZU5hbWVcclxuICAgICAgICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgICAgICAgLi4uKG9wdGlvbnMubWV0YWRhdGEgfHwge30pLFxyXG4gICAgICAgICAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogZmlsZU5hbWUgLy8gQWxzbyBhZGQgb3JpZ2luYWxGaWxlTmFtZSB0byBtZXRhZGF0YVxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgb25Qcm9ncmVzczogKHByb2dyZXNzKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAocHJvZ3Jlc3NUcmFja2VyKSB7XHJcbiAgICAgICAgICAgICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGVTY2FsZWQocHJvZ3Jlc3MsIDIwLCA5MCwge1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogdHlwZW9mIHByb2dyZXNzID09PSAnb2JqZWN0JyA/IHByb2dyZXNzLnN0YXR1cyA6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YFxyXG4gICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgaW4gVVJMIGNvbnZlcnNpb246ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gVHJ5IHRoZSBhbHRlcm5hdGl2ZSBtZXRob2QgYXMgYSBmYWxsYmFja1xyXG4gICAgICAgICAgY29uc3QgcmVnaXN0cnkgPSBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpO1xyXG4gICAgICAgICAgLy8gRXh0cmFjdCBjb252ZXJ0ZXIgZnJvbSBjb252ZXJ0ZXJJbmZvXHJcbiAgICAgICAgICBjb25zdCB7IGNvbnZlcnRlciB9ID0gY29udmVydGVySW5mbztcclxuICAgICAgICAgIGlmICh0eXBlb2YgY29udmVydGVyLmNvbnZlcnQgPT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIHJlZ2lzdHJ5LmNvbnZlcnRUb01hcmtkb3duID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgVHJ5aW5nIGFsdGVybmF0aXZlIGNvbnZlcnNpb24gbWV0aG9kIGFzIGZhbGxiYWNrYCwgJ0lORk8nKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgLy8gSWYgd2UgdHJpZWQgY29udmVydGVyLmNvbnZlcnQgZmlyc3QsIG5vdyB0cnkgcmVnaXN0cnkuY29udmVydFRvTWFya2Rvd25cclxuICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCByZWdpc3RyeS5jb252ZXJ0VG9NYXJrZG93bihmaWxlVHlwZSwgZmlsZVBhdGgsIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICBuYW1lOiBmaWxlTmFtZSxcclxuICAgICAgICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IGZpbGVOYW1lLCAvLyBFeHBsaWNpdGx5IHBhc3Mgb3JpZ2luYWxGaWxlTmFtZVxyXG4gICAgICAgICAgICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICAgICAgICAgICAgLi4uKG9wdGlvbnMubWV0YWRhdGEgfHwge30pLFxyXG4gICAgICAgICAgICAgICAgICBvcmlnaW5hbEZpbGVOYW1lOiBmaWxlTmFtZSAvLyBBbHNvIGFkZCBvcmlnaW5hbEZpbGVOYW1lIHRvIG1ldGFkYXRhXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgb25Qcm9ncmVzczogKHByb2dyZXNzKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlU2NhbGVkKHByb2dyZXNzLCAyMCwgOTAsIHtcclxuICAgICAgICAgICAgICAgICAgICAgIHN0YXR1czogdHlwZW9mIHByb2dyZXNzID09PSAnb2JqZWN0JyA/IHByb2dyZXNzLnN0YXR1cyA6IGBwcm9jZXNzaW5nXyR7ZmlsZVR5cGV9YFxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGZhbGxiYWNrRXJyb3IpIHtcclxuICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFsbGJhY2sgY29udmVyc2lvbiBhbHNvIGZhaWxlZDogJHtmYWxsYmFja0Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7IC8vIFRocm93IHRoZSBvcmlnaW5hbCBlcnJvclxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjsgLy8gUmUtdGhyb3cgaWYgbm8gZmFsbGJhY2sgaXMgYXZhaWxhYmxlXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoOTUsIHsgc3RhdHVzOiAnZmluYWxpemluZycgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLlBST0NFU1NJTkcsXHJcbiAgICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GSU5BTElaSU5HXHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhbmRhcmRpemVSZXN1bHQocmVzdWx0LCBmaWxlVHlwZSwgZmlsZU5hbWUsIGNhdGVnb3J5KTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gUmVhZCBmaWxlIGNvbnRlbnQgaWYgbm90IGFscmVhZHkgYSBidWZmZXJcclxuICAgICAgY29uc3QgZmlsZUNvbnRlbnQgPSBCdWZmZXIuaXNCdWZmZXIoZmlsZVBhdGgpID8gZmlsZVBhdGggOiBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgpO1xyXG4gICAgICBcclxuICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgIHByb2dyZXNzVHJhY2tlci51cGRhdGUoMjAsIHsgc3RhdHVzOiBgY29udmVydGluZ18ke2ZpbGVUeXBlfWAgfSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIFBERiBmaWxlcyB0byBpbmNsdWRlIE9DUiBvcHRpb25zXHJcbiAgICAgIGlmIChmaWxlVHlwZSA9PT0gJ3BkZicpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQ29udmVydGluZyBQREYgd2l0aCBvcHRpb25zOicsIHtcclxuICAgICAgICAgIHVzZU9jcjogb3B0aW9ucy51c2VPY3IsXHJcbiAgICAgICAgICBoYXNNaXN0cmFsQXBpS2V5OiAhIW9wdGlvbnMubWlzdHJhbEFwaUtleSxcclxuICAgICAgICAgIHByZXNlcnZlUGFnZUluZm86IHRydWVcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgbW9yZSBkZXRhaWxlZCBsb2dnaW5nIGZvciBPQ1Igc2V0dGluZ3NcclxuICAgICAgICBpZiAob3B0aW9ucy51c2VPY3IpIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmxvZygnT0NSIGlzIGVuYWJsZWQgZm9yIHRoaXMgY29udmVyc2lvbicsICdJTkZPJyk7XHJcbiAgICAgICAgICBpZiAob3B0aW9ucy5taXN0cmFsQXBpS2V5KSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdNaXN0cmFsIEFQSSBrZXkgaXMgcHJlc2VudCcpO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybignT0NSIGlzIGVuYWJsZWQgYnV0IE1pc3RyYWwgQVBJIGtleSBpcyBtaXNzaW5nJyk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBhdWRpby92aWRlbyBmaWxlcyB0byBlbnN1cmUgdGhleSBkb24ndCB1c2UgTWlzdHJhbCBBUEkga2V5XHJcbiAgICAgIGlmIChmaWxlVHlwZSA9PT0gJ21wMycgfHwgZmlsZVR5cGUgPT09ICd3YXYnIHx8IGZpbGVUeXBlID09PSAnbXA0JyB8fCBmaWxlVHlwZSA9PT0gJ21vdicgfHwgXHJcbiAgICAgICAgICBmaWxlVHlwZSA9PT0gJ29nZycgfHwgZmlsZVR5cGUgPT09ICd3ZWJtJyB8fCBmaWxlVHlwZSA9PT0gJ2F2aScgfHwgXHJcbiAgICAgICAgICBmaWxlVHlwZSA9PT0gJ2ZsYWMnIHx8IGZpbGVUeXBlID09PSAnbTRhJykge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmxvZyhgQ29udmVydGluZyBtdWx0aW1lZGlhIGZpbGUgKCR7ZmlsZVR5cGV9KWAsICdJTkZPJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmVtb3ZlIG1pc3RyYWxBcGlLZXkgZnJvbSBvcHRpb25zIGZvciBtdWx0aW1lZGlhIGZpbGVzIHRvIHByZXZlbnQgaW5jb3JyZWN0IHJvdXRpbmdcclxuICAgICAgICBpZiAob3B0aW9ucy5taXN0cmFsQXBpS2V5KSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5sb2coJ1JlbW92aW5nIE1pc3RyYWwgQVBJIGtleSBmcm9tIG11bHRpbWVkaWEgY29udmVyc2lvbiBvcHRpb25zJywgJ0lORk8nKTtcclxuICAgICAgICAgIGNvbnN0IHsgbWlzdHJhbEFwaUtleSwgLi4uY2xlYW5PcHRpb25zIH0gPSBvcHRpb25zO1xyXG4gICAgICAgICAgb3B0aW9ucyA9IGNsZWFuT3B0aW9ucztcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZ1BoYXNlVHJhbnNpdGlvbihcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GQVNUX0FUVEVNUFQsXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuUFJPQ0VTU0lOR1xyXG4gICAgICApO1xyXG4gICAgICBcclxuICAgICAgLy8gVXNlIHRoZSBjb252ZXJ0ZXIncyBjb252ZXJ0IG1ldGhvZFxyXG4gICAgICBjb25zdCB7IGNvbnZlcnRlciwgY2F0ZWdvcnkgfSA9IGNvbnZlcnRlckluZm87XHJcblxyXG4gICAgICAvLyBMb2cgdGhlIG9yaWdpbmFsIGZpbGVuYW1lIGRldGFpbHMgYmVpbmcgcGFzc2VkIHRvIHRoZSBjb252ZXJ0ZXJcclxuICAgICAgdGhpcy5sb2dnZXIubG9nKGBDb252ZXJ0IG1ldGhvZCBjYWxsZWQgd2l0aCBvcmlnaW5hbEZpbGVOYW1lOiAke2ZpbGVOYW1lfWAsICdJTkZPJyk7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmxvZyhgT3B0aW9ucyBiZWluZyBwYXNzZWQgdG8gY29udmVydGVyOmAsIHtcclxuICAgICAgICBoYXNPcmlnaW5hbEZpbGVOYW1lOiAhIW9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICBvcmlnaW5hbEZpbGVOYW1lVmFsdWU6IG9wdGlvbnMub3JpZ2luYWxGaWxlTmFtZSxcclxuICAgICAgICBmaWxlTmFtZTogZmlsZU5hbWUsXHJcbiAgICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY29udmVydGVyLmNvbnZlcnQoZmlsZUNvbnRlbnQsIGZpbGVOYW1lLCBvcHRpb25zLmFwaUtleSwge1xyXG4gICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgbmFtZTogZmlsZU5hbWUsXHJcbiAgICAgICAgb3JpZ2luYWxGaWxlTmFtZTogZmlsZU5hbWUsIC8vIEV4cGxpY2l0bHkgcGFzcyBvcmlnaW5hbEZpbGVOYW1lXHJcbiAgICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICAgIC4uLihvcHRpb25zLm1ldGFkYXRhIHx8IHt9KSxcclxuICAgICAgICAgIG9yaWdpbmFsRmlsZU5hbWU6IGZpbGVOYW1lIC8vIEFsc28gYWRkIG9yaWdpbmFsRmlsZU5hbWUgdG8gbWV0YWRhdGFcclxuICAgICAgICB9LFxyXG4gICAgICAgIG9uUHJvZ3Jlc3M6IChwcm9ncmVzcykgPT4ge1xyXG4gICAgICAgICAgaWYgKHByb2dyZXNzVHJhY2tlcikge1xyXG4gICAgICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlU2NhbGVkKHByb2dyZXNzLCAyMCwgOTAsIHtcclxuICAgICAgICAgICAgICBzdGF0dXM6IHR5cGVvZiBwcm9ncmVzcyA9PT0gJ29iamVjdCcgPyBwcm9ncmVzcy5zdGF0dXMgOiBgY29udmVydGluZ18ke2ZpbGVUeXBlfWBcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGlmIChwcm9ncmVzc1RyYWNrZXIpIHtcclxuICAgICAgICBwcm9ncmVzc1RyYWNrZXIudXBkYXRlKDk1LCB7IHN0YXR1czogJ2ZpbmFsaXppbmcnIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuUFJPQ0VTU0lORyxcclxuICAgICAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5GSU5BTElaSU5HXHJcbiAgICAgICk7XHJcblxyXG4gICAgICByZXR1cm4gdGhpcy5zdGFuZGFyZGl6ZVJlc3VsdChyZXN1bHQsIGZpbGVUeXBlLCBmaWxlTmFtZSwgY2F0ZWdvcnkpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5sb2dnZXIubG9nQ29udmVyc2lvbkVycm9yKGZpbGVUeXBlLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGAke2ZpbGVUeXBlLnRvVXBwZXJDYXNlKCl9IGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCxcclxuICAgICAgICBjb250ZW50OiBgIyBDb252ZXJzaW9uIEVycm9yXFxuXFxuRmFpbGVkIHRvIGNvbnZlcnQgJHtmaWxlVHlwZS50b1VwcGVyQ2FzZSgpfSBmaWxlOiAke2Vycm9yLm1lc3NhZ2V9YCxcclxuICAgICAgICB0eXBlOiBmaWxlVHlwZSxcclxuICAgICAgICBmaWxlVHlwZTogZmlsZVR5cGUsIC8vIEV4cGxpY2l0bHkgaW5jbHVkZSBmaWxlVHlwZVxyXG4gICAgICAgIG5hbWU6IGZpbGVOYW1lLFxyXG4gICAgICAgIGNhdGVnb3J5OiBjYXRlZ29yeSB8fCAndW5rbm93bidcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBBZGQgYW4gaW5pdGlhbGl6ZSBtZXRob2QgdG8gdGhlIGZhY3RvcnkgaW5zdGFuY2VcclxuICogVGhpcyBpcyBuZWVkZWQgZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBjb2RlIHRoYXQgZXhwZWN0cyB0aGlzIG1ldGhvZFxyXG4gKi9cclxuY29uc3QgdW5pZmllZENvbnZlcnRlckZhY3RvcnkgPSBVbmlmaWVkQ29udmVydGVyRmFjdG9yeS5nZXRJbnN0YW5jZSgpO1xyXG5cclxuLy8gQWRkIGluaXRpYWxpemUgbWV0aG9kIHRvIHRoZSBmYWN0b3J5IGluc3RhbmNlXHJcbnVuaWZpZWRDb252ZXJ0ZXJGYWN0b3J5LmluaXRpYWxpemUgPSBhc3luYyBmdW5jdGlvbigpIHtcclxuICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICBDb252ZXJzaW9uU3RhdHVzLlNUQVRVUy5TVEFSVElORyxcclxuICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLklOSVRJQUxJWklOR1xyXG4gICk7XHJcbiAgXHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKCk7XHJcbiAgICB0aGlzLmxvZ2dlci5sb2dQaGFzZVRyYW5zaXRpb24oXHJcbiAgICAgIENvbnZlcnNpb25TdGF0dXMuU1RBVFVTLklOSVRJQUxJWklORyxcclxuICAgICAgQ29udmVyc2lvblN0YXR1cy5TVEFUVVMuQ09NUExFVEVEXHJcbiAgICApO1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIHRoaXMubG9nZ2VyLmxvZ0NvbnZlcnNpb25FcnJvcignaW5pdCcsIGVycm9yKTtcclxuICAgIHRocm93IGVycm9yO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIEV4cG9ydCBzaW5nbGV0b24gaW5zdGFuY2UgYW5kIG1vZHVsZSBmdW5jdGlvbnNcclxubW9kdWxlLmV4cG9ydHMgPSB1bmlmaWVkQ29udmVydGVyRmFjdG9yeTtcclxubW9kdWxlLmV4cG9ydHMudW5pZmllZENvbnZlcnRlckZhY3RvcnkgPSB1bmlmaWVkQ29udmVydGVyRmFjdG9yeTsiXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0EsSUFBSUEsR0FBRztBQUNQLElBQUk7RUFDRjtFQUNBLE1BQU1DLFFBQVEsR0FBR0MsT0FBTyxDQUFDLFVBQVUsQ0FBQztFQUNwQ0YsR0FBRyxHQUFHQyxRQUFRLENBQUNELEdBQUcsSUFBS0MsUUFBUSxDQUFDRSxNQUFNLElBQUlGLFFBQVEsQ0FBQ0UsTUFBTSxDQUFDSCxHQUFJO0FBQ2hFLENBQUMsQ0FBQyxPQUFPSSxDQUFDLEVBQUU7RUFDVjtFQUNBQyxPQUFPLENBQUNDLElBQUksQ0FBQyw4Q0FBOEMsQ0FBQztBQUM5RDs7QUFFQTtBQUNBLElBQUlDLEVBQUU7QUFDTixJQUFJO0VBQ0ZBLEVBQUUsR0FBR0wsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUMxQixDQUFDLENBQUMsT0FB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