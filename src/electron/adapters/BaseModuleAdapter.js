/**
 * BaseModuleAdapter.js
 * 
 * Base class for ES module adapters that provides consistent module loading
 * and error handling patterns for all converters.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

class BaseModuleAdapter {
  /**
   * Constructor for the base adapter
   * @param {string} modulePath - Relative path to the ES module from the backend root
   * @param {string|null} [exportName=null] - Name of the export to use from the module, or null if only using named exports
   * @param {Object} [namedExports={}] - Configuration for named exports
   * @param {boolean} [validateDefaultExport=true] - Whether to validate the default export
   */
  constructor(modulePath, exportName = null, namedExports = {}, validateDefaultExport = true) {
    this.modulePath = modulePath;
    this.exportName = exportName;
    this.namedExports = namedExports;
    this.validateDefaultExport = validateDefaultExport;
    this.modulePromise = this.loadModule();
    this.isLoaded = false;
    
    // Initialize the adapter
    this.initialize();
  }
  
  /**
   * Initialize the adapter by loading the module
   */
  initialize() {
    this.modulePromise
      .then(() => {
        this.isLoaded = true;
        console.log(`✅ [BaseModuleAdapter] Successfully loaded module: ${this.modulePath}`);
      })
      .catch(error => {
        console.error(`❌ [BaseModuleAdapter] Failed to load module: ${this.modulePath}`, error);
      });
  }
  
  /**
   * Load the ES module
   * @returns {Promise<any>} - Promise that resolves to the loaded module
   */
  async loadModule() {
    console.log(`🔍 [BaseModuleAdapter] Attempting to load module: ${this.modulePath}`);
    try {
      // Get the absolute path to the backend module
      const backendRoot = path.resolve(__dirname, '../../../backend');
      const modulePath = path.join(backendRoot, this.modulePath);
      
      console.log(`📂 [BaseModuleAdapter] Resolved module path: ${modulePath}`);
      
      // Check if the file exists
      if (!fs.existsSync(modulePath)) {
        console.error(`❌ [BaseModuleAdapter] Module file not found at: ${modulePath}`);
        throw new Error(`Module not found at: ${modulePath}`);
      }
      
      // Convert the path to a file URL
      const fileUrl = pathToFileURL(modulePath).href;
      console.log(`🔗 [BaseModuleAdapter] Loading module from URL: ${fileUrl}`);
      
      // Log Node.js version and module type
      console.log(`ℹ️ [BaseModuleAdapter] Node.js version: ${process.version}`);
      console.log(`ℹ️ [BaseModuleAdapter] Module type: ${require.main?.filename ? 'CommonJS' : 'ES Module'}`);
      
      // Import the ES module dynamically using the file URL
      console.log(`⏳ [BaseModuleAdapter] Starting dynamic import...`);
      const module = await import(fileUrl);
      console.log(`✅ [BaseModuleAdapter] Dynamic import successful`);
      
      // Log available exports
      console.log(`📋 [BaseModuleAdapter] Available exports:`, Object.keys(module));
      
      // Check if the requested export exists (only if validateDefaultExport is true and exportName is not null)
      if (this.validateDefaultExport && this.exportName !== null && !module[this.exportName]) {
        console.error(`❌ [BaseModuleAdapter] Export '${this.exportName}' not found in module`);
        throw new Error(`Export '${this.exportName}' not found in module: ${this.modulePath}`);
      }
      
      console.log(`✅ [BaseModuleAdapter] Successfully loaded module: ${this.modulePath}`);
      return module;
    } catch (error) {
      console.error(`❌ [BaseModuleAdapter] Failed to load module: ${this.modulePath}`, error);
      console.error(`🔍 [BaseModuleAdapter] Error details:`, {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code
      });
      throw error;
    }
  }
  
  /**
   * Execute a method from the loaded module's default export
   * @param {string} methodName - Name of the method to execute
   * @param {Array} args - Arguments to pass to the method
   * @returns {Promise<any>} - Result of the method execution
   */
  async executeMethod(methodName, args = []) {
    console.log(`⏳ [BaseModuleAdapter] Executing method '${methodName}' from ${this.exportName}`);
    try {
      // Wait for the module to load
      const module = await this.modulePromise;
      
      // Get the export from the module
      const exportedObject = module[this.exportName];
      
      // Check if the method exists
      if (!exportedObject || typeof exportedObject[methodName] !== 'function') {
        console.error(`❌ [BaseModuleAdapter] Method '${methodName}' not found in export '${this.exportName}'`);
        throw new Error(`Method '${methodName}' not found in export '${this.exportName}'`);
      }
      
      // Execute the method
      console.log(`🔄 [BaseModuleAdapter] Calling ${this.exportName}.${methodName} with ${args.length} arguments`);
      const result = await exportedObject[methodName](...args);
      console.log(`✅ [BaseModuleAdapter] Method '${methodName}' executed successfully`);
      return result;
    } catch (error) {
      console.error(`❌ [BaseModuleAdapter] Error executing method '${methodName}':`, error);
      console.error(`🔍 [BaseModuleAdapter] Error details:`, {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      // No fallback - throw the error to be handled by the caller
      throw new Error(`Failed to execute ${methodName}: ${error.message}`);
    }
  }

  /**
   * Execute a method from a named export
   * @param {string} exportName - Name of the export
   * @param {Array} args - Arguments to pass to the method
   * @returns {Promise<any>} - Result of the method execution
   */
  async executeMethodFromExport(exportName, args = []) {
    console.log(`⏳ [BaseModuleAdapter] Executing named export '${exportName}'`);
    try {
      // Wait for the module to load
      const module = await this.modulePromise;
      
      // Check if the named export is configured
      if (!this.namedExports[exportName]) {
        console.error(`❌ [BaseModuleAdapter] Named export '${exportName}' not configured`);
        throw new Error(`Named export '${exportName}' not configured`);
      }
      
      // Get the named export
      const exportedFunction = module[exportName];
      
      // Check if the export exists and is a function
      if (typeof exportedFunction !== 'function') {
        console.error(`❌ [BaseModuleAdapter] Named export '${exportName}' is not a function`);
        throw new Error(`Named export '${exportName}' is not a function`);
      }
      
      // Execute the function
      console.log(`🔄 [BaseModuleAdapter] Calling named export '${exportName}' with ${args.length} arguments`);
      const result = await exportedFunction(...args);
      console.log(`✅ [BaseModuleAdapter] Named export '${exportName}' executed successfully`);
      return result;
    } catch (error) {
      console.error(`❌ [BaseModuleAdapter] Error executing named export '${exportName}':`, error);
      console.error(`🔍 [BaseModuleAdapter] Error details:`, {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      throw new Error(`Failed to execute named export ${exportName}: ${error.message}`);
    }
  }
  
  /**
   * Diagnose the environment for troubleshooting
   */
  static async diagnoseEnvironment() {
    console.log(`🔍 [DIAGNOSTICS] Node.js version: ${process.version}`);
    console.log(`🔍 [DIAGNOSTICS] Platform: ${process.platform}`);
    console.log(`🔍 [DIAGNOSTICS] Architecture: ${process.arch}`);
    console.log(`🔍 [DIAGNOSTICS] Process ID: ${process.pid}`);
    console.log(`🔍 [DIAGNOSTICS] Working directory: ${process.cwd()}`);
    
    // Check if we can access the backend directory
    const backendPath = path.resolve(__dirname, '../../../backend');
    try {
      const stats = fs.statSync(backendPath);
      console.log(`✅ [DIAGNOSTICS] Backend directory exists: ${backendPath}`);
      console.log(`📊 [DIAGNOSTICS] Backend directory stats:`, {
        isDirectory: stats.isDirectory(),
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      });
      
      // List key files
      const files = fs.readdirSync(backendPath);
      console.log(`📋 [DIAGNOSTICS] Backend directory contents:`, files);
      
      // Check for PDF converter specifically
      const pdfConverterPath = path.join(backendPath, 'src/services/converter/text/pdfConverter.js');
      if (fs.existsSync(pdfConverterPath)) {
        console.log(`✅ [DIAGNOSTICS] PDF converter exists: ${pdfConverterPath}`);
        const content = fs.readFileSync(pdfConverterPath, 'utf8');
        console.log(`📊 [DIAGNOSTICS] PDF converter file size: ${content.length} bytes`);
      } else {
        console.error(`❌ [DIAGNOSTICS] PDF converter not found: ${pdfConverterPath}`);
      }
    } catch (error) {
      console.error(`❌ [DIAGNOSTICS] Error accessing backend directory:`, error);
    }
    
    // Check ES module support
    try {
      console.log(`🔍 [DIAGNOSTICS] Testing dynamic import...`);
      const testModule = await import('path');
      console.log(`✅ [DIAGNOSTICS] Dynamic import successful`);
    } catch (error) {
      console.error(`❌ [DIAGNOSTICS] Dynamic import failed:`, error);
    }
  }
}

module.exports = BaseModuleAdapter;
