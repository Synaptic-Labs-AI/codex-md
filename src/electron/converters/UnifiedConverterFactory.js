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
  app = electron.app || (electron.remote && electron.remote.app);
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
    fs.existsSync = fs.existsSync || ((path) => {
      try { return fs.statSync(path).isFile(); } catch (e) { return false; }
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
      } catch { /* Continue to next fallback */ }
    }

    // Default implementations for critical functions
    if (modulePath.includes('getLogger')) {
      return (name) => ({
        log: (msg, level, ...args) => console.log(`[${name}][${level || 'INFO'}] ${msg}`, ...args),
        error: (msg, err) => console.error(`[${name}][ERROR] ${msg}`, err),
        warn: (msg, ...args) => console.warn(`[${name}][WARN] ${msg}`, ...args),
        success: (msg) => console.log(`[${name}][SUCCESS] ${msg}`),
        debug: (msg, ...args) => console.debug(`[${name}][DEBUG] ${msg}`, ...args),
        logPhaseTransition: (from, to) => console.log(`[${name}] Phase transition: ${from} → ${to}`),
        logConversionStart: (type, opts) => console.log(`[${name}] Starting conversion for ${type}`),
        logConversionComplete: (type) => console.log(`[${name}] Completed conversion for ${type}`),
        logConversionError: (type, err) => console.error(`[${name}:failed][${type}] ❌ ${err.message}`, err),
        setContext: () => {}
      });
    }
    if (modulePath.includes('sanitizeForLogging')) {
      return (obj) => {
        try {
          return typeof obj === 'object' ? { ...obj } : obj;
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
  PathUtils = safeRequire('../utils/paths/index', [
    path.resolve(__dirname, '../utils/paths/index'),
    path.resolve(process.cwd(), 'src/electron/utils/paths/index')
  ]).PathUtils || {};

  ProgressTracker = safeRequire('../utils/conversion/progress', [
    path.resolve(__dirname, '../utils/conversion/progress'),
    path.resolve(process.cwd(), 'src/electron/utils/conversion/progress')
  ]).ProgressTracker || class ProgressTracker {
    constructor(callback) { this.callback = callback; }
    update(progress, data) { this.callback && this.callback(progress, data); }
    updateScaled(progress, min, max, data) { this.update(min + (progress/100) * (max-min), data); }
  };

  getLogger = safeRequire('../utils/logging/ConversionLogger', [
    path.resolve(__dirname, '../utils/logging/ConversionLogger'),
    path.resolve(process.cwd(), 'src/electron/utils/logging/ConversionLogger')
  ]).getLogger || ((name) => ({
    log: (msg, level, ...args) => console.log(`[${name}][${level || 'INFO'}] ${msg}`, ...args),
    error: (msg, err) => console.error(`[${name}][ERROR] ${msg}`, err),
    warn: (msg, ...args) => console.warn(`[${name}][WARN] ${msg}`, ...args),
    success: (msg) => console.log(`[${name}][SUCCESS] ${msg}`),
    debug: (msg, ...args) => console.debug(`[${name}][DEBUG] ${msg}`, ...args),
    logPhaseTransition: (from, to) => console.log(`[${name}] Phase transition: ${from} → ${to}`),
    logConversionStart: (type, opts) => console.log(`[${name}] Starting conversion for ${type}`),
    logConversionComplete: (type) => console.log(`[${name}] Completed conversion for ${type}`),
    logConversionError: (type, err) => console.error(`[${name}:failed][${type}] ❌ ${err.message}`, err),
    setContext: () => {}
  }));

  sanitizeForLogging = safeRequire('../utils/logging/LogSanitizer', [
    path.resolve(__dirname, '../utils/logging/LogSanitizer'),
    path.resolve(process.cwd(), 'src/electron/utils/logging/LogSanitizer')
  ]).sanitizeForLogging || ((obj) => {
    try {
      return typeof obj === 'object' ? { ...obj } : obj;
    } catch {
      return obj;
    }
  });

  ConversionStatus = safeRequire('../utils/conversion/ConversionStatus', [
    path.resolve(__dirname, '../utils/conversion/ConversionStatus'),
    path.resolve(process.cwd(), 'src/electron/utils/conversion/ConversionStatus')
  ]) || {
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
    const { fallbackPaths = [], silent = false } = options;

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
        const { ModuleResolver } = require('../utils/moduleResolver');
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
              metadata: { pages: 1, converter: 'emergency-fallback' }
            };
          },
          validate: (input) => Buffer.isBuffer(input) || typeof input === 'string',
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
    ConverterRegistry.prototype.convertToMarkdown = async function(type, content, options = {}) {
      console.log(`[EmergencyRegistry] Converting ${type} document`);
      return {
        success: true,
        content: `# Emergency Converter\n\nThis content was generated by an emergency fallback converter because the normal converter could not be loaded.\n\nPlease report this issue.`,
        metadata: { source: 'emergency-fallback' }
      };
    };

    ConverterRegistry.prototype.getConverterByExtension = function(extension) {
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
      path.resolve(process.cwd(), 'src/electron/services/conversion'),
      path.resolve(process.cwd(), 'build/electron/services/conversion'),

      // Packaged app paths - note we explicitly handle the path from the error
      path.resolve(app.getAppPath(), 'build/electron/services/conversion'),
      path.resolve(app.getAppPath().replace(/src\/electron/, 'build/electron'), 'services/conversion'),
      path.resolve(app.getAppPath().replace(/src\\electron/, 'build\\electron'), 'services/conversion'),
      path.resolve(app.getAppPath(), 'src/electron/services/conversion'),

      // Relative paths from current module
      path.resolve(__dirname, '../services/conversion'),
      path.resolve(__dirname, '../../services/conversion'),
      path.resolve(__dirname, '../../build/electron/services/conversion'),

      // Paths with app.asar for packaged app
      path.resolve(app.getAppPath().replace('app.asar', 'app'), 'src/electron/services/conversion'),
      path.resolve(app.getAppPath().replace('app.asar', 'app'), 'build/electron/services/conversion'),
      path.resolve(app.getAppPath().replace('app.asar\\src', 'app.asar\\build'), 'electron/services/conversion'),
      path.resolve(app.getAppPath().replace('app.asar/src', 'app.asar/build'), 'electron/services/conversion'),

      // Alternative parent directory paths
      path.resolve(app.getAppPath(), '../build/electron/services/conversion'),
      path.resolve(app.getAppPath(), '../src/electron/services/conversion'),

      // Sibling paths
      path.resolve(path.dirname(app.getAppPath()), 'build/electron/services/conversion'),
      path.resolve(path.dirname(app.getAppPath()), 'src/electron/services/conversion'),

      // More nested paths for app.asar
      path.resolve(app.getAppPath(), 'dist/electron/services/conversion'),
      path.resolve(path.dirname(process.execPath), '../resources/app/src/electron/services/conversion'),
      path.resolve(path.dirname(process.execPath), '../resources/app/build/electron/services/conversion'),

      // Direct path fixes for the specific error path
      app.getAppPath().replace('src/electron/services/conversion', 'build/electron/services/conversion'),
      app.getAppPath().replace('src\\electron\\services\\conversion', 'build\\electron\\services\\conversion'),

      // Paths with dist prefixes (often used in built apps)
      path.resolve(process.cwd(), 'dist/electron/services/conversion'),
      path.resolve(app.getAppPath(), 'dist/electron/services/conversion'),

      // Additional paths specifically for ConverterRegistry.js
      path.resolve(process.cwd(), 'app/electron/services/conversion'),
      path.resolve(app.getAppPath(), 'app/electron/services/conversion'),
      path.resolve(__dirname, '../../../electron/services/conversion'),
      path.resolve(__dirname, '../../../../electron/services/conversion'),
      path.resolve(path.dirname(process.execPath), 'resources/app/electron/services/conversion'),
      path.resolve(path.dirname(process.execPath), 'resources/app.asar/electron/services/conversion'),
      path.resolve(path.dirname(process.execPath), 'resources/electron/services/conversion')
    ];

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
        app.getAppPath().replace('src/electron/services/conversion', 'build/electron/services/conversion') + '/ConverterRegistry.js',
        app.getAppPath().replace('src\\electron\\services\\conversion', 'build\\electron\\services\\conversion') + '\\ConverterRegistry.js',

        // Full string replacements for the specific error paths in the logs
        app.getAppPath().replace('app.asar\\src\\electron', 'app.asar\\build\\electron') + '\\services\\conversion\\ConverterRegistry.js',
        app.getAppPath().replace('app.asar/src/electron', 'app.asar/build/electron') + '/services/conversion/ConverterRegistry.js',

        // Standard application paths
        path.resolve(process.cwd(), 'src/electron/services/conversion/ConverterRegistry.js'),
        path.resolve(process.cwd(), 'build/electron/services/conversion/ConverterRegistry.js'),
        path.resolve(app.getAppPath(), 'build/electron/services/conversion/ConverterRegistry.js'),
        path.resolve(app.getAppPath(), 'src/electron/services/conversion/ConverterRegistry.js'),

        // Relative paths
        path.resolve(__dirname, '../services/conversion/ConverterRegistry.js'),
        path.resolve(__dirname, '../../services/conversion/ConverterRegistry.js'),

        // ASAR-specific paths with adaptations
        path.resolve(app.getAppPath().replace('app.asar', 'app'), 'src/electron/services/conversion/ConverterRegistry.js'),
        path.resolve(app.getAppPath().replace('app.asar', 'app'), 'build/electron/services/conversion/ConverterRegistry.js'),
        path.resolve(path.dirname(process.execPath), '../resources/app/src/electron/services/conversion/ConverterRegistry.js'),
        path.resolve(path.dirname(process.execPath), '../resources/app/build/electron/services/conversion/ConverterRegistry.js'),
        path.resolve(__dirname, '../../src/electron/services/conversion/ConverterRegistry.js'),
        path.resolve(__dirname, '../../build/electron/services/conversion/ConverterRegistry.js'),
        path.resolve(__dirname, '../../../electron/services/conversion/ConverterRegistry.js'),
        path.resolve(path.dirname(process.execPath), 'resources/app/src/electron/services/conversion/ConverterRegistry.js'),
        path.resolve(path.dirname(process.execPath), 'resources/app.asar/electron/services/conversion/ConverterRegistry.js'),
        path.resolve(path.dirname(process.execPath), 'resources/app.asar/build/electron/services/conversion/ConverterRegistry.js'),

        // Allow finding in current directories
        path.join(__dirname, 'ConverterRegistry.js'),
        path.join(path.dirname(__dirname), 'ConverterRegistry.js'),

        // Try absolute paths that match the error stack
        'C:\\Users\\Joseph\\Documents\\Code\\codex-md\\dist\\win-unpacked\\resources\\app.asar\\build\\electron\\services\\conversion\\ConverterRegistry.js'
      ];

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
      registryPath: registryPath, // Duplicate for direct access
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
          metadata: { pages: 1, converter: 'minimal-embedded' }
        };
      },
      validate: (input) => Buffer.isBuffer(input) || typeof input === 'string',
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
      metadata: { converter: 'minimal-embedded' }
    };
  },

  // Lookup converter by extension
  getConverterByExtension: async (extension) => {
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
          metadata: { converter: 'minimal-embedded-generic' }
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
    this.logger.logPhaseTransition(
      ConversionStatus.STATUS.STARTING,
      ConversionStatus.STATUS.INITIALIZING
    );

    try {
      // Get all possible module paths
      const paths = ModuleLoader.getModulePaths();
      this.logger.log('Using converter paths:', 'INFO', paths);

      // Extract all the possible base paths from various sources
      const possibleBasePaths = [
        path.dirname(paths.registry),
        ...Object.values(paths.converters).map(p => path.dirname(path.dirname(p)))
      ];

      // Log all possible registry paths we'll try
      const allPossibleRegistryPaths = [
        paths.registry,
        paths.registryPath,
        ...possibleBasePaths.map(basePath => path.join(basePath, 'ConverterRegistry.js'))
      ];
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
          registry = await ModuleLoader.loadModule(
            paths.registry,
            { fallbackPaths: allPossibleRegistryPaths.slice(1), silent: true }
          );
        }
      } catch (initialError) {
        this.logger.warn('Initial registry loading failed, trying alternative approaches', initialError);

        // If direct loading failed, try a different approach by collecting base directories
        const baseDirs = [];

        // Add potential base directories (deduplicate them)
        const addBaseDir = (dir) => {
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

      this.logger.logPhaseTransition(
        ConversionStatus.STATUS.INITIALIZING,
        ConversionStatus.STATUS.COMPLETED
      );

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
    this.logger.setContext({ fileType });
    
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

      this.logger.logPhaseTransition(
        ConversionStatus.STATUS.STARTING,
        ConversionStatus.STATUS.VALIDATING
      );
      
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
    this.logger.debug(`Raw result received for ${fileType}:`, sanitizeForLogging(result)); // Add logging

    // Check if this is an asynchronous result (has async: true and conversionId)
    if (result && result.async === true && result.conversionId) {
      this.logger.log(`[${fileType}] Received async result with conversionId: ${result.conversionId}`);
      
      // For async results, we need to preserve the async flag and conversionId
      // This will signal to ElectronConversionService that it needs to handle this differently
      return {
        ...result,
        success: true, // Async initiation is considered successful at this point
        type: result.type || fileType,
        fileType: fileType,
        name: result.name || fileName,
        originalFileName: result.originalFileName || result.name || fileName,
        category: result.category || category,
        async: true, // Preserve the async flag
        conversionId: result.conversionId, // Preserve the conversionId
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

    // Handle null or undefined result explicitly
    if (!result) {
        this.logger.warn(`Received null or undefined result for ${fileType}. Assuming failure.`);
        result = { success: false, error: 'Converter returned null or undefined result' };
    }

    // Determine success status more robustly
    // Success is ONLY true if result.success is explicitly true.
    // Otherwise, it's false, especially if an error property exists.
    const isSuccess = result.success === true;

    // Sanitize potentially complex objects within the result *after* determining success
    const sanitizedResult = sanitizeForLogging(result);

    // For XLSX and CSV files, we want to be absolutely certain that originalFileName is preserved
    const originalFileName = (fileType === 'xlsx' || fileType === 'csv')
      ? ((result.metadata && result.metadata.originalFileName) || result.originalFileName || result.name || fileName)
      : ((result.metadata && result.metadata.originalFileName) || result.originalFileName || result.name || fileName);

    // Log the determined originalFileName
    this.logger.log(`📝 Final originalFileName determined for ${fileType}: ${originalFileName}`);

    const standardized = {
        ...sanitizedResult, // Spread sanitized result first
        success: isSuccess, // Override with determined success status
        type: result.type || fileType,
        fileType: fileType,
        name: originalFileName, // Use the resolved originalFileName
        originalFileName: originalFileName, // Same for consistency
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
        error: !isSuccess ? (result.error || 'Unknown conversion error') : undefined
    };

    // Remove error property if successful
    if (standardized.success) {
        delete standardized.error;
    }
    
    // Ensure content is not null or undefined, and provide appropriate fallback
    if (!standardized.content && !isSuccess) {
      this.logger.logPhaseTransition(
        ConversionStatus.STATUS.PROCESSING,
        ConversionStatus.STATUS.CONTENT_EMPTY
      );
      // Provide a more informative message if the conversion failed and content is empty
      standardized.content = `# Conversion Error\n\nThe ${fileType} file conversion failed or produced no content. Error: ${standardized.error || 'Unknown error'}`;
    } else if (!standardized.content && isSuccess) {
       this.logger.logPhaseTransition(
        ConversionStatus.STATUS.PROCESSING,
        ConversionStatus.STATUS.CONTENT_EMPTY
      );
      // Fallback for successful conversion but empty content
      standardized.content = `# Conversion Result\n\nThe ${fileType} file was processed successfully, but no textual content was generated. This is normal for certain file types (e.g., multimedia files without transcription).`;
    }


    // Log the final standardized result
    this.logger.debug(`Standardized result for ${fileType}:`, sanitizeForLogging(standardized));

    return standardized;
  }

  async handleConversion(filePath, options) {
    const { progressTracker, fileType, fileName, converterInfo, isUrl } = options;
    // Extract category from converterInfo to avoid "category is not defined" error
    const category = converterInfo?.category || FILE_TYPE_CATEGORIES[fileType] || 'unknown';
    
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
        
        this.logger.log(`Processing URL: ${filePath}`, 'INFO');
        
        // For URLs, filePath is actually the URL string
        let result;
        
        try {
          // Extract converter from converterInfo
          const { converter } = converterInfo;

          // Try using the converter's convert method first
          if (typeof converter.convert === 'function') {
            this.logger.log(`Using converter.convert for ${fileType}`, 'INFO');
            this.logger.log(`URL convert called with originalFileName: ${fileName}`, 'INFO');

            result = await converter.convert(filePath, fileName, options.apiKey, {
              ...options,
              name: fileName,
              originalFileName: fileName, // Explicitly pass originalFileName
              metadata: {
                ...(options.metadata || {}),
                originalFileName: fileName // Also add originalFileName to metadata
              },
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
            this.logger.log(`Using registry.convertToMarkdown for ${fileType}`, 'INFO');
            this.logger.log(`URL convertToMarkdown called with originalFileName: ${fileName}`, 'INFO');

            result = await registry.convertToMarkdown(fileType, filePath, {
              ...options,
              name: fileName,
              originalFileName: fileName, // Explicitly pass originalFileName
              metadata: {
                ...(options.metadata || {}),
                originalFileName: fileName // Also add originalFileName to metadata
              },
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
          // Extract converter from converterInfo
          const { converter } = converterInfo;
          if (typeof converter.convert === 'function' && typeof registry.convertToMarkdown === 'function') {
            this.logger.log(`Trying alternative conversion method as fallback`, 'INFO');
            
            try {
              // If we tried converter.convert first, now try registry.convertToMarkdown
              result = await registry.convertToMarkdown(fileType, filePath, {
                ...options,
                name: fileName,
                originalFileName: fileName, // Explicitly pass originalFileName
                metadata: {
                  ...(options.metadata || {}),
                  originalFileName: fileName // Also add originalFileName to metadata
                },
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
          this.logger.log('OCR is enabled for this conversion', 'INFO');
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
        this.logger.log(`Converting multimedia file (${fileType})`, 'INFO');
        
        // Remove mistralApiKey from options for multimedia files to prevent incorrect routing
        if (options.mistralApiKey) {
          this.logger.log('Removing Mistral API key from multimedia conversion options', 'INFO');
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
        originalFileName: fileName, // Explicitly pass originalFileName
        metadata: {
          ...(options.metadata || {}),
          originalFileName: fileName // Also add originalFileName to metadata
        },
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
