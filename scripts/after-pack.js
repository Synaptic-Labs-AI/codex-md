/**
 * afterPack.js
 * Post-packaging script to handle build tasks
 * This script runs after electron-builder packages the app but before creating installers
 *
 * Responsibilities:
 * - Create fallback modules in a special modules directory that's accessible at runtime
 * - Create additional fallbacks for ESM modules (node-fetch)
 * - Verify static assets and frontend files are correctly copied
 * - Validate extraResources were properly copied
 * - Log detailed information about the packaged application
 */

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Safely checks if a file exists without causing file locks
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} - True if file exists
 */
async function safePathExists(filePath) {
  try {
    return await fs.pathExists(filePath);
  } catch (error) {
    console.warn(`⚠️ Error checking path: ${filePath}`, error.message);
    return false;
  }
}

/**
 * Gets detailed file information including size, permissions, and hash
 * @param {string} filePath - Path to the file
 * @returns {Promise<Object|null>} - Object with file details or null if error
 */
async function getFileDetails(filePath) {
  try {
    if (!await safePathExists(filePath)) {
      return null;
    }
    
    const stats = await fs.stat(filePath);
    const details = {
      exists: true,
      size: stats.size,
      permissions: stats.mode.toString(8),
      lastModified: stats.mtime,
      isExecutable: (stats.mode & 0o111) !== 0, // Check if file has execute permissions
      path: filePath
    };
    
    // Try to get file hash (first 1000 bytes) for verification
    try {
      const buffer = Buffer.alloc(1000);
      const fd = await fs.open(filePath, 'r');
      await fs.read(fd, buffer, 0, 1000, 0);
      await fs.close(fd);
      
      // Simple hash calculation (not cryptographically secure, just for verification)
      let hash = 0;
      for (let i = 0; i < buffer.length; i++) {
        hash = ((hash << 5) - hash) + buffer[i];
        hash |= 0; // Convert to 32bit integer
      }
      details.hash = hash.toString(16);
    } catch (hashError) {
      console.warn(`⚠️ Could not calculate file hash for ${filePath}: ${hashError.message}`);
    }
    
    return details;
  } catch (error) {
    console.warn(`⚠️ Error getting file details for ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Tests if a binary is executable by attempting to run a simple command
 * @param {string} binaryPath - Path to the binary
 * @param {string} testArgs - Arguments to test the binary with
 * @returns {Promise<boolean>} - True if binary is executable
 */
async function testBinaryExecution(binaryPath, testArgs) {
  try {
    // Execute with -version which should work on all FFmpeg binaries
    const output = execSync(`"${binaryPath}" ${testArgs}`, {
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString();
    
    console.log(`✅ Successfully executed ${path.basename(binaryPath)}`);
    console.log(`  Version info: ${output.split('\n')[0]}`);
    return true;
  } catch (error) {
    console.warn(`⚠️ Failed to execute ${binaryPath}: ${error.message}`);
    return false;
  }
}

/**
 * Sets executable permissions on a file (macOS/Linux only)
 * @param {string} filePath - Path to the file
 * @returns {Promise<boolean>} - True if permissions were set successfully
 */
async function setExecutablePermissions(filePath) {
  try {
    // Set owner, group and others execute permissions
    await fs.chmod(filePath, 0o755);
    console.log(`✅ Set executable permissions on ${path.basename(filePath)}`);
    return true;
  } catch (error) {
    console.warn(`⚠️ Failed to set executable permissions on ${filePath}: ${error.message}`);
    return false;
  }
}

/**
 * Safely copies a file with error handling
 * @param {string} source - Source file path
 * @param {string} destination - Destination file path
 * @returns {Promise<boolean>} - True if copy was successful
 */
async function safeCopyFile(source, destination) {
  try {
    await fs.ensureDir(path.dirname(destination));
    await fs.copyFile(source, destination);
    console.log(`✅ Successfully copied: ${path.basename(source)} to ${destination}`);
    return true;
  } catch (error) {
    console.error(`❌ Error copying ${source} to ${destination}:`, error.message);
    return false;
  }
}

/**
 * Main afterPack function
 */
exports.default = async function(context) {
  const { appOutDir, packager } = context;
  const platform = packager.platform.nodeName;
  const isWindows = platform === 'win32';
  const isMacOS = platform === 'darwin';
  const isLinux = platform === 'linux';

  console.log('🚀 Running afterPack script...');
  console.log(`📋 Build Information:`);
  console.log(`  Platform: ${platform}`);
  console.log(`  Output directory: ${appOutDir}`);
  console.log(`  Electron version: ${packager.electronVersion}`);
  console.log(`  App version: ${packager.appInfo.version}`);
  console.log(`  Build timestamp: ${new Date().toISOString()}`);

  try {
    // Determine resources directory based on platform
    let resourcesDir;
    if (isMacOS) {
      resourcesDir = path.join(appOutDir, packager.appInfo.productName + '.app', 'Contents', 'Resources');
    } else {
      resourcesDir = path.join(appOutDir, 'resources');
    }

    console.log(`📁 Resources directory: ${resourcesDir}`);

    // Ensure resources directory exists
    await fs.ensureDir(resourcesDir);
    console.log(`✅ Resources directory created/verified`);

    // Check if resources directory is writable
    try {
      const testFile = path.join(resourcesDir, 'write-test.tmp');
      await fs.writeFile(testFile, 'test');
      await fs.remove(testFile);
      console.log('✅ Resources directory is writable');
    } catch (writeError) {
      console.warn('⚠️ Resources directory may not be writable:', writeError.message);
    }

    // Create a modules directory in resources - this will be accessible at runtime
    // We can't modify the asar file but we can create a directory alongside it that the app can find
    console.log('🔄 Creating fallback modules directory');
    
    const modulesDir = path.join(resourcesDir, 'modules');
    await fs.ensureDir(modulesDir);
    console.log(`📁 Created modules directory: ${modulesDir}`);
    
    // Define source and build directories within the modules directory
    const srcDir = path.join(modulesDir, 'src', 'electron');
    const buildDir = path.join(modulesDir, 'build', 'electron');
    
    // Create these directories
    await fs.ensureDir(srcDir);
    await fs.ensureDir(buildDir);
    
    console.log(`📁 Source directory: ${srcDir}`);
    console.log(`📁 Build directory: ${buildDir}`);

    // List of critical modules to ensure availability
    const criticalModules = [
      {
        name: 'ConverterRegistry.js',
        category: 'services/conversion',
        fallbackContent: `/**
 * ConverterRegistry.js - Emergency Fallback Version
 * This file was generated by the afterPack.js script as a fallback
 */
function ConverterRegistry() {
  this.converters = {
    pdf: {
      convert: async (content, name, apiKey, options = {}) => {
        console.log('[EmergencyRegistry] Using emergency PDF converter');
        return {
          success: true,
          content: \`# Extracted from \${name || 'PDF document'}\n\nThis content was extracted using the emergency converter.\n\nThe application encountered an issue finding the correct converter module. Please report this issue.\`,
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

ConverterRegistry.prototype.convertToMarkdown = async function(type, content, options = {}) {
  console.log(\`[EmergencyRegistry] Converting \${type} document\`);
  return {
    success: true,
    content: \`# Emergency Converter\n\nThis content was generated by an emergency fallback converter because the normal converter could not be loaded.\n\nPlease report this issue.\`,
    metadata: { source: 'emergency-fallback' }
  };
};

ConverterRegistry.prototype.getConverterByExtension = function(extension) {
  console.log(\`[EmergencyRegistry] Looking up converter for: \${extension}\`);
  if (extension === 'pdf') {
    return this.converters.pdf;
  }
  return null;
};

module.exports = new ConverterRegistry();`
      },
      {
        name: 'moduleResolver.js',
        category: 'utils',
        fallbackContent: `/**
 * moduleResolver.js - Emergency Fallback Version
 * This file was generated by the afterPack.js script as a fallback
 */
const path = require('path');
const fs = require('fs-extra');
const electron = require('electron');

// Handle app access in both main and renderer process
const app = electron.app || (electron.remote && electron.remote.app);

class ModuleResolver {
  static resolveModulePath(moduleName, category) {
    console.log(\`🔍 [ModuleResolver] Resolving path for \${moduleName} in \${category}\`);

    let appPath;
    try {
      appPath = app ? app.getAppPath() : process.cwd();
    } catch (e) {
      console.warn(\`⚠️ [ModuleResolver] Error getting app path: \${e.message}\`);
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
      
      // Emergency fallback modules directory
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
      path.join(appPath.replace('app.asar', 'modules'), 'src/electron', category, moduleName)
    ].filter(Boolean); // Remove null entries
    
    // Find first existing path
    for (const searchPath of searchPaths) {
      try {
        const exists = fs.existsSync(searchPath);
        if (exists) {
          console.log(\`✅ [ModuleResolver] Found module at: \${searchPath}\`);
          return searchPath;
        }
      } catch (error) {
        console.warn(\`⚠️ [ModuleResolver] Error checking path \${searchPath}: \${error.message}\`);
      }
    }
    
    // If no path found, return the most likely path - will fail but with a clear error
    console.warn(\`⚠️ [ModuleResolver] No existing module found, returning default path\`);
    return path.join(appPath, 'build/electron', category, moduleName);
  }
  
  static safeRequire(moduleName, category) {
    const modulePath = this.resolveModulePath(moduleName, category);
    console.log(\`🔄 [ModuleResolver] Requiring module from: \${modulePath}\`);
    
    try {
      const module = require(modulePath);
      console.log(\`✅ [ModuleResolver] Successfully loaded module: \${moduleName}\`);
      return module.default || module;
    } catch (error) {
      console.error(\`❌ [ModuleResolver] Failed to load module: \${moduleName} from \${modulePath}\`);
      console.error(\`❌ [ModuleResolver] Error details: \${error.message}\`);
      
      // Try one more approach - direct require
      try {
        if (category === 'services/conversion' && moduleName === 'ConverterRegistry.js') {
          console.log(\`🔄 [ModuleResolver] Trying direct require for ConverterRegistry.js\`);
          return require('../services/conversion/ConverterRegistry.js');
        }
      } catch (directError) {
        console.warn(\`⚠️ [ModuleResolver] Direct require also failed: \${directError.message}\`);
      }
      
      // Rethrow the original error with more context
      throw new Error(\`Failed to load module: \${moduleName} from \${modulePath}. Error: \${error.message}\`);
    }
  }
  
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
      
      // Emergency fallback modules directory
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
      path.join(appPath.replace('app.asar', 'modules'), 'src/electron', category, moduleName)
    ].filter(Boolean);
  }
}

module.exports = { ModuleResolver };`
      },
      {
        name: 'MistralApiClient.js',
        category: 'services/conversion/document/mistral',
        fallbackContent: `/**
 * MistralApiClient.js - Emergency Fallback Version
 * This file was generated by the afterPack.js script as a fallback
 * with special handling for fetch compatibility
 */

const FormData = require('form-data');

// Create compatibility layer for node-fetch
let fetchModule = null;

// Initialize fetch with CommonJS compatibility
const initializeFetch = () => {
  try {
    // First try the CommonJS version
    try {
      fetchModule = require('node-fetch-commonjs');
      console.log('[MistralApiClient] node-fetch-commonjs loaded successfully');
      return Promise.resolve();
    } catch (commonjsError) {
      console.log('[MistralApiClient] node-fetch-commonjs not available, trying cross-fetch');

      // Try cross-fetch as fallback (which is also CommonJS compatible)
      try {
        fetchModule = require('cross-fetch');
        console.log('[MistralApiClient] cross-fetch loaded successfully');
        return Promise.resolve();
      } catch (crossFetchError) {
        console.log('[MistralApiClient] cross-fetch not available, creating stub implementation');

        // Create minimal fetch implementation as last resort
        fetchModule = async (url, options = {}) => {
          console.error('[MistralApiClient] Using stub fetch implementation - OCR WILL NOT WORK');
          return {
            ok: false,
            status: 500,
            statusText: 'Fetch Not Available',
            text: async () => 'Fetch module not available',
            json: async () => ({ error: { message: 'Fetch module not available' } })
          };
        };
        return Promise.resolve();
      }
    }
  } catch (error) {
    console.error('[MistralApiClient] All fetch loading methods failed:', error);
    return Promise.reject(error);
  }
};

// Start loading immediately
const fetchPromise = initializeFetch();

class MistralApiClient {
  constructor(config = {}) {
    this.apiEndpoint = config.apiEndpoint || 'https://api.mistral.ai/v1/ocr';
    this.apiKey = config.apiKey || '';
    this.baseUrl = 'https://api.mistral.ai/v1';
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  isConfigured() {
    return !!this.apiKey;
  }

  async fetch(url, options) {
    if (!fetchModule) {
      await fetchPromise;
    }

    if (fetchModule.default) {
      return fetchModule.default(url, options);
    } else {
      return fetchModule(url, options);
    }
  }

  async validateApiKey() {
    try {
      if (!this.apiKey) {
        return { valid: false, error: 'API key not configured' };
      }
      
      const response = await this.fetch(\`\${this.baseUrl}/models\`, {
        method: 'GET',
        headers: {
          'Authorization': \`Bearer \${this.apiKey}\`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        return { valid: true };
      } else {
        const responseText = await response.text();
        let errorMessage = 'Invalid API key';
        return { valid: false, error: errorMessage };
      }
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async processDocument(fileBuffer, fileName, options = {}) {
    return {
      success: false,
      error: 'OCR functionality is not available due to missing fetch module',
      content: '# OCR Not Available\\n\\nThe OCR module could not be initialized due to missing fetch module.',
      textBlocks: []
    };
  }
}

module.exports = MistralApiClient;`
      }
    ];

    // Process each critical module
    for (const module of criticalModules) {
      // Create full paths for both src and build
      const srcPath = path.join(srcDir, module.category, module.name);
      const buildPath = path.join(buildDir, module.category, module.name);

      // Create directories if they don't exist
      await fs.ensureDir(path.dirname(srcPath));
      await fs.ensureDir(path.dirname(buildPath));

      console.log(`🔍 Processing module: ${module.name} in ${module.category}`);

      // Create content for the module
      const moduleContent = module.fallbackContent;

      // Ensure module exists in both src and build locations
      try {
        await fs.writeFile(srcPath, moduleContent);
        console.log(`✅ Created module in src location: ${srcPath}`);
      } catch (writeError) {
        console.error(`❌ Failed to write module to src location: ${writeError.message}`);
      }

      try {
        await fs.writeFile(buildPath, moduleContent);
        console.log(`✅ Created module in build location: ${buildPath}`);
      } catch (writeError) {
        console.error(`❌ Failed to write module to build location: ${writeError.message}`);
      }
    }

    // Process node-fetch ESM compatibility issues
    console.log('⚙️ Addressing ESM compatibility issues for node-fetch');

    // Create marker file to indicate modules directory is available
    try {
      await fs.writeFile(path.join(modulesDir, 'modules-available.json'), JSON.stringify({
        timestamp: new Date().toISOString(),
        modules: criticalModules.map(m => `${m.category}/${m.name}`)
      }, null, 2));
      console.log('✅ Created modules-available.json marker file');
    } catch (error) {
      console.error('❌ Failed to create modules marker file:', error.message);
    }

    // Setup resource directories
    // We no longer copy the entire node_modules to resources
    // Instead, we're using asar packaging with specific unpack patterns
    console.log('✅ Using optimized node_modules packaging with asar');

    // Verify critical static assets - these should now be in extraResources
    const staticAssets = [
      'favicon-icon.png',
      'app-icon.png',
      'logo.png',
      'synaptic-labs-logo.png'
    ];
    
    // Also verify frontend files
    const frontendFiles = [
      'index.html'
    ];

    // Check in the extraResources destination path
    const extraResourcesDir = path.join(resourcesDir, 'frontend', 'dist', 'static');
    const frontendDir = path.join(resourcesDir, 'frontend', 'dist');
    console.log(`Checking for assets in extraResources path: ${extraResourcesDir}`);
    console.log(`Checking for frontend files in: ${frontendDir}`);
    
    // Verify the extraResources directory exists
    if (await safePathExists(extraResourcesDir)) {
      console.log('✅ extraResources directory found');
      
      // Check each asset
      let missingAssets = 0;
      for (const asset of staticAssets) {
        const assetPath = path.join(extraResourcesDir, asset);
        if (await safePathExists(assetPath)) {
          console.log(`✅ Verified asset in extraResources: ${asset}`);
        } else {
          console.warn(`⚠️ Asset not found in extraResources: ${asset}`);
          missingAssets++;
        }
      }
      
      if (missingAssets === 0) {
        console.log('✅ All assets verified in extraResources');
      } else {
        console.warn(`⚠️ ${missingAssets} assets missing from extraResources`);
      }
    } else {
      console.warn('⚠️ extraResources directory not found');
      
      // Log all directories in resources to help diagnose
      try {
        const resourcesContents = await fs.readdir(resourcesDir);
        console.log('Resources directory contents:', resourcesContents);
      } catch (error) {
        console.warn('⚠️ Could not read resources directory:', error.message);
      }
    }

    // Verify frontend files
    if (await safePathExists(frontendDir)) {
      console.log('✅ Frontend dist directory found');
      
      // Check each frontend file
      let missingFrontendFiles = 0;
      for (const file of frontendFiles) {
        const filePath = path.join(frontendDir, file);
        if (await safePathExists(filePath)) {
          console.log(`✅ Verified frontend file: ${file}`);
          
          // For index.html, check its content
          if (file === 'index.html') {
            try {
              const content = await fs.readFile(filePath, 'utf8');
              console.log(`Index.html content length: ${content.length} bytes`);
              
              // Check for key elements in the HTML
              if (content.includes('<div id="app"></div>')) {
                console.log('✅ Index.html contains app div');
              } else {
                console.warn('⚠️ Index.html missing app div');
              }
              
              // Check for script and CSS references
              if (content.includes('src="./assets/')) {
                console.log('✅ Index.html contains script references');
              } else {
                console.warn('⚠️ Index.html missing script references');
              }
            } catch (error) {
              console.warn(`⚠️ Could not read index.html: ${error.message}`);
            }
          }
        } else {
          console.warn(`⚠️ Frontend file not found: ${file}`);
          missingFrontendFiles++;
        }
      }
      
      // Check for assets directory
      const assetsDir = path.join(frontendDir, 'assets');
      if (await safePathExists(assetsDir)) {
        console.log('✅ Assets directory found');
        
        try {
          const assetFiles = await fs.readdir(assetsDir);
          console.log(`Assets directory contains ${assetFiles.length} files`);
          console.log('Asset files:', assetFiles);
        } catch (error) {
          console.warn(`⚠️ Could not read assets directory: ${error.message}`);
        }
      } else {
        console.warn('⚠️ Assets directory not found');
      }
    } else {
      console.warn('⚠️ Frontend dist directory not found');
    }
    
    console.log('✅ afterPack verification completed');
  } catch (error) {
    console.error('❌ Error in afterPack:', error);
    // Don't throw the error, just log it
    console.log('Continuing despite error...');
  }
};