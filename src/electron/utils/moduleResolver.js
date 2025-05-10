/**
 * moduleResolver.js
 * A utility for resolving module paths across different environments (development vs production)
 * Specifically designed to handle path differences in Electron's packaged apps
 */

const path = require('path');
const fs = require('fs-extra');
const electron = require('electron');

// Handle app access in both main and renderer process
const app = electron.app || (electron.remote && electron.remote.app);

class ModuleResolver {
  /**
   * Resolves a module path by trying multiple possible locations
   * @param {string} moduleName - The filename of the module (e.g. 'ConverterRegistry.js')
   * @param {string} category - The category path (e.g. 'services/conversion')
   * @returns {string} The resolved path to the module
   */
  static resolveModulePath(moduleName, category) {
    // Get logger for verbose logging
    let logger;
    try {
      logger = require('../utils/logger');
    } catch (e) {
      logger = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        debug: console.debug
      };
    }

    logger.log(`🔍 [ModuleResolver] Resolving path for ${moduleName} in ${category}`);

    let appPath;
    try {
      // Get app path in a safe way that works in both packaged and development
      appPath = app ? app.getAppPath() : process.cwd();
    } catch (e) {
      logger.warn(`⚠️ [ModuleResolver] Error getting app path: ${e.message}`);
      appPath = process.cwd();
    }

    // Build comprehensive search paths
    const searchPaths = [
      // Build paths (preferred)
      path.join(appPath, 'build/electron', category, moduleName),

      // Source paths
      path.join(appPath, 'src/electron', category, moduleName),

      // Resource paths for packaged app
      path.join(process.resourcesPath || '', 'app/build/electron', category, moduleName),
      path.join(process.resourcesPath || '', 'app/src/electron', category, moduleName),

      // External modules directory (created by after-pack.js)
      path.join(process.resourcesPath || '', 'modules/build/electron', category, moduleName),
      path.join(process.resourcesPath || '', 'modules/src/electron', category, moduleName),

      // Relative paths from current module
      path.join(__dirname, '..', category, moduleName),
      path.join(__dirname, '../..', category, moduleName),

      // Direct paths for known problematic modules
      category === 'services/conversion' && moduleName === 'ConverterRegistry.js'
        ? path.join(appPath, 'build/electron/services/conversion/ConverterRegistry.js')
        : null,
      category === 'services/conversion' && moduleName === 'ConverterRegistry.js'
        ? path.join(appPath, 'src/electron/services/conversion/ConverterRegistry.js')
        : null,

      // Asar-specific paths
      path.join(appPath.replace('app.asar', 'app'), 'build/electron', category, moduleName),
      path.join(appPath.replace('app.asar', 'app'), 'src/electron', category, moduleName),

      // Modules fallback when packaged
      path.join(appPath.replace('app.asar', 'modules'), 'build/electron', category, moduleName),
      path.join(appPath.replace('app.asar', 'modules'), 'src/electron', category, moduleName),

      // Extreme fallback for the specific problem path we've seen
      category === 'services/conversion' && moduleName === 'ConverterRegistry.js'
        ? 'C:\\Users\\Joseph\\Documents\\Code\\codex-md\\dist\\win-unpacked\\resources\\app.asar\\build\\electron\\services\\conversion\\ConverterRegistry.js'
        : null,

      // Check for the external modules directory in various locations
      category === 'services/conversion' && moduleName === 'ConverterRegistry.js'
        ? 'C:\\Users\\Joseph\\Documents\\Code\\codex-md\\dist\\win-unpacked\\resources\\modules\\build\\electron\\services\\conversion\\ConverterRegistry.js'
        : null,
    ].filter(Boolean); // Remove null entries
    
    // Find first existing path
    for (const searchPath of searchPaths) {
      try {
        const exists = fs.existsSync(searchPath);
        if (exists) {
          logger.log(`✅ [ModuleResolver] Found module at: ${searchPath}`);
          return searchPath;
        }
      } catch (error) {
        logger.warn(`⚠️ [ModuleResolver] Error checking path ${searchPath}: ${error.message}`);
      }
    }
    
    // If no path found, return the most likely path - will fail but with a clear error
    logger.warn(`⚠️ [ModuleResolver] No existing module found, returning default path`);
    return path.join(appPath, 'build/electron', category, moduleName);
  }
  
  /**
   * Safely requires a module by resolving its path first
   * @param {string} moduleName - The filename of the module (e.g. 'ConverterRegistry.js')
   * @param {string} category - The category path (e.g. 'services/conversion')
   * @returns {any} The loaded module
   * @throws {Error} If the module cannot be loaded
   */
  static safeRequire(moduleName, category) {
    // Get logger for verbose logging
    let logger;
    try {
      logger = require('../utils/logger');
    } catch (e) {
      logger = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        debug: console.debug
      };
    }
    
    const modulePath = this.resolveModulePath(moduleName, category);
    logger.log(`🔄 [ModuleResolver] Requiring module from: ${modulePath}`);
    
    try {
      const module = require(modulePath);
      logger.log(`✅ [ModuleResolver] Successfully loaded module: ${moduleName}`);
      return module.default || module;
    } catch (error) {
      logger.error(`❌ [ModuleResolver] Failed to load module: ${moduleName} from ${modulePath}`);
      logger.error(`❌ [ModuleResolver] Error details: ${error.message}`);
      
      // Try one more approach - direct require
      try {
        if (category === 'services/conversion' && moduleName === 'ConverterRegistry.js') {
          logger.log(`🔄 [ModuleResolver] Trying direct require for ConverterRegistry.js`);
          return require('../services/conversion/ConverterRegistry.js');
        }
      } catch (directError) {
        logger.warn(`⚠️ [ModuleResolver] Direct require also failed: ${directError.message}`);
      }
      
      // Rethrow the original error with more context
      throw new Error(`Failed to load module: ${moduleName} from ${modulePath}. Error: ${error.message}`);
    }
  }
  
  /**
   * Get all the search paths for a module without loading it
   * @param {string} moduleName - The filename of the module
   * @param {string} category - The category path
   * @returns {Array<string>} Array of possible paths
   */
  static getAllPaths(moduleName, category) {
    let appPath;
    try {
      appPath = app ? app.getAppPath() : process.cwd();
    } catch (e) {
      appPath = process.cwd();
    }

    return [
      // Build paths (preferred)
      path.join(appPath, 'build/electron', category, moduleName),

      // Source paths
      path.join(appPath, 'src/electron', category, moduleName),

      // Resource paths for packaged app
      path.join(process.resourcesPath || '', 'app/build/electron', category, moduleName),
      path.join(process.resourcesPath || '', 'app/src/electron', category, moduleName),

      // External modules directory (created by after-pack.js)
      path.join(process.resourcesPath || '', 'modules/build/electron', category, moduleName),
      path.join(process.resourcesPath || '', 'modules/src/electron', category, moduleName),

      // Relative paths from current module
      path.join(__dirname, '..', category, moduleName),
      path.join(__dirname, '../..', category, moduleName),

      // Asar-specific paths
      path.join(appPath.replace('app.asar', 'app'), 'build/electron', category, moduleName),
      path.join(appPath.replace('app.asar', 'app'), 'src/electron', category, moduleName),

      // Modules fallback when packaged
      path.join(appPath.replace('app.asar', 'modules'), 'build/electron', category, moduleName),
      path.join(appPath.replace('app.asar', 'modules'), 'src/electron', category, moduleName),

      // Hardcoded fallbacks for Windows
      category === 'services/conversion' && moduleName === 'ConverterRegistry.js'
        ? 'C:\\Users\\Joseph\\Documents\\Code\\codex-md\\dist\\win-unpacked\\resources\\modules\\build\\electron\\services\\conversion\\ConverterRegistry.js'
        : null
    ].filter(Boolean);
  }
}

module.exports = { ModuleResolver };