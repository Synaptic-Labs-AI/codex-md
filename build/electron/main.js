"use strict";

console.log(`[DEBUG] Running Node.js version in main process: ${process.versions.node}`);
/**
 * Electron Main Process
 * Entry point for the Electron application.
 *
 * Handles:
 * - Window management
 * - IPC communication setup
 * - Protocol registration
 * - App lifecycle
 */

/**
 * MODULE RESOLUTION FIX:
 * This patch intercepts Node.js module loading to fix path resolution issues in packaged apps.
 * It ensures "src" paths correctly resolve to "build" paths for compiled code.
 * Specifically fixes the ConverterRegistry.js module loading in the PDF converter.
 */
try {
  // Access the Node.js module system
  const Module = require('module');
  const originalResolveFilename = Module._resolveFilename;

  // Create path mappings for the resolver
  const pathMappings = {
    // Map specific src paths to build paths
    '\\resources\\app.asar\\src\\electron\\': '\\resources\\app.asar\\build\\electron\\',
    '/resources/app.asar/src/electron/': '/resources/app.asar/build/electron/'
  };

  // Only install the override once
  if (!Module._originalResolveFilename) {
    // Store the original for restoration if needed
    Module._originalResolveFilename = originalResolveFilename;

    // Replace with our patched version
    Module._resolveFilename = function (request, parent, isMain, options) {
      try {
        // Check if the request matches any of our problematic patterns
        let modifiedRequest = request;

        // Apply pattern replacements
        for (const [pattern, replacement] of Object.entries(pathMappings)) {
          if (typeof request === 'string' && request.includes(pattern)) {
            const newPath = request.replace(pattern, replacement);
            console.log(`🔄 [ModuleRedirect] ${request} -> ${newPath}`);
            modifiedRequest = newPath;
            break;
          }
        }

        // Special handling for ConverterRegistry.js
        if (typeof request === 'string' && request.includes('src') && request.includes('ConverterRegistry.js')) {
          const buildPath = request.replace(/src[\\\/]electron/, 'build/electron').replace(/src\\electron/, 'build\\electron');
          console.log(`⚠️ [ModuleRedirect] ConverterRegistry.js special handling: ${buildPath}`);
          modifiedRequest = buildPath;
        }

        // Call the original resolver with our possibly modified path
        return originalResolveFilename.call(this, modifiedRequest, parent, isMain, options);
      } catch (error) {
        console.warn(`⚠️ [ModuleRedirect] Error in resolver override: ${error.message}`);
        // Fall back to original behavior
        return originalResolveFilename.call(this, request, parent, isMain, options);
      }
    };
    console.log('🔧 [ModuleRedirect] Node.js module resolution override installed');
  }
} catch (error) {
  console.warn('⚠️ [ModuleRedirect] Failed to install module resolution override:', error.message);
}
const {
  app,
  BrowserWindow,
  protocol
} = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs-extra');
const {
  PathUtils
} = require('./utils/paths');
const logger = require('./utils/logger');
const ElectronConversionService = require('./services/ElectronConversionService');
const {
  createMacMenu
} = require('./features/menu');
const {
  setupBasicHandlers,
  setupWindowHandlers,
  cleanupWindowHandlers
} = require('./ipc/handlers');
const TrayManager = require('./features/tray');
const NotificationManager = require('./features/notifications');
const UpdateManager = require('./features/updater');
const {
  createStore
} = require('./utils/storeFactory');
const ApiKeyService = require('./services/ApiKeyService'); // Import ApiKeyService
// Create settings store for retrieving Deepgram API key
const settingsStore = createStore('settings');

// Keep a global reference of objects
let mainWindow;
let appInitialized = false;
let trayManager = null;
let notificationManager = null;
let updateManager = null;
let loggerInitialized = false;

/**
 * Load API keys and set them as environment variables
 * This ensures API keys are available to converters that need them
 */
async function loadApiKeysToEnvironment() {
  try {
    console.log('Loading API keys to environment variables...');

    // Get API keys from ApiKeyService
    const mistralApiKey = ApiKeyService.getApiKey('mistral');
    const deepgramApiKey = ApiKeyService.getApiKey('deepgram');

    // Set API keys as environment variables
    if (mistralApiKey) {
      process.env.MISTRAL_API_KEY = mistralApiKey;
      console.log('✅ Mistral API key loaded into environment');
    } else {
      console.log('⚠️ No Mistral API key found in store');
    }
    if (deepgramApiKey) {
      process.env.DEEPGRAM_API_KEY = deepgramApiKey;
      console.log('✅ Deepgram API key loaded into environment');
    } else {
      console.log('⚠️ No Deepgram API key found in store');
    }
  } catch (error) {
    console.error('❌ Failed to load API keys:', error);
  }
}

// Initialize tray store
const trayStore = createStore('tray-manager', {
  encryptionKey: process.env.STORE_ENCRYPTION_KEY
});

/**
 * Initialize logger
 * @returns {Promise<boolean>} Whether logger was successfully initialized
 */
async function initializeLogger() {
  try {
    await logger.initialize();
    loggerInitialized = true;
    console.log('✅ Logger initialized');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize logger:', error);
    return false;
  }
}

/**
 * Setup notifications with error handling
 */
async function setupNotifications() {
  try {
    notificationManager = new NotificationManager();
    if (loggerInitialized) {
      await logger.log('Notifications initialized');
    }
    console.log('✅ Notifications initialized');
    return true;
  } catch (error) {
    if (loggerInitialized) {
      await logger.error('Failed to setup notifications', error);
    }
    console.error('❌ Failed to setup notifications:', error);
    notificationManager = null;
    return false;
  }
}

/**
 * Setup system tray with error handling
 */
function setupTray() {
  if (!mainWindow) {
    console.warn('⚠️ Cannot setup tray without main window');
    return;
  }
  try {
    trayManager = new TrayManager(mainWindow, trayStore);
    console.log('✅ Tray initialized successfully');
  } catch (error) {
    console.error('❌ Failed to create tray:', error);
    // Non-fatal error, continue execution
  }
}

/**
 * Create and setup window with error handling
 * @returns {Electron.BrowserWindow|null} The created window or null if failed
 */
async function createAndSetupWindow() {
  try {
    console.log('Creating main window...');
    const window = await createMainWindow();
    if (!window) {
      console.error('❌ Window creation failed: window is null');
      return null;
    }
    console.log('Window created successfully, waiting for initialization...');

    // Wait a moment for the window to initialize fully
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('Setting up window handlers...');
    // Setup window handlers
    await setupWindowHandlers(window);
    console.log('✅ Window handlers registered successfully');
    return window;
  } catch (error) {
    console.error('❌ Failed to create and setup window:', error);
    return null;
  }
}

/**
 * Initialize core application services and handlers
 * Must complete before window creation
 */
async function initializeApp() {
  try {
    // Initialize API Key Service early
    const apiKeyServiceInstance = ApiKeyService; // Assuming singleton export
    // Try to configure Deepgram on startup if key exists
    const deepgramApiKey = settingsStore.get('transcription.deepgramApiKey');
    if (deepgramApiKey) {
      console.log('[Startup] Found stored Deepgram API key, attempting to configure DeepgramService...');
      try {
        // Import the DeepgramService
        const deepgramService = require('./services/ai/DeepgramService');
        // Configure with the API key
        const configResult = await deepgramService.handleConfigure(null, {
          apiKey: deepgramApiKey
        });
        if (configResult.success) {
          console.log('[Startup] DeepgramService configured successfully on startup.');
        } else {
          console.warn('[Startup] DeepgramService configuration failed on startup.');
        }
      } catch (configError) {
        console.error('[Startup] Error configuring DeepgramService on startup:', configError);
      }
    } else {
      console.log('[Startup] No stored Deepgram API key found.');
    }

    // Initialize update manager
    updateManager = new UpdateManager();
    updateManager.initialize();
    console.log('✅ Update manager initialized');

    // Setup basic IPC handlers first
    console.log('📡 Registering basic IPC handlers...');
    setupBasicHandlers(app);
    console.log('✅ Basic IPC handlers registered successfully');

    // Initialize core services
    await ElectronConversionService.setupOutputDirectory();
    console.log('✅ Conversion service initialized');

    // Setup notifications (non-fatal if it fails)
    if (!setupNotifications()) {
      console.warn('⚠️ Notifications unavailable - continuing without notifications');
    }
    appInitialized = true;
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize app:', error);
    return false;
  }
}

/**
 * Create the main application window
 * Only called after initialization is complete
 */
async function createMainWindow() {
  if (!appInitialized) {
    const error = new Error('Cannot create window before app initialization');
    if (loggerInitialized) {
      await logger.error('Window creation error', error);
    }
    throw error;
  }
  if (loggerInitialized) {
    await logger.log('Creating main window');

    // Log app paths for debugging
    const appPaths = {
      appPath: app.getAppPath(),
      appData: app.getPath('appData'),
      userData: app.getPath('userData'),
      exe: app.getPath('exe'),
      module: app.getPath('module'),
      cwd: process.cwd(),
      resourcesPath: process.resourcesPath || 'undefined'
    };
    await logger.debug('Application paths', appPaths);
  }

  // Get platform-specific icon path
  const iconPath = PathUtils.normalizePath(process.env.NODE_ENV === 'development' ? path.join(__dirname, '../frontend/static/logo.png') : path.join(app.getAppPath(), 'frontend/static/logo.png'));
  if (loggerInitialized) {
    await logger.debug('Icon path', {
      iconPath
    });

    // Verify icon exists
    try {
      const iconExists = await fs.pathExists(iconPath);
      await logger.debug('Icon file check', {
        exists: iconExists,
        path: iconPath
      });
      if (!iconExists) {
        await logger.warn(`Icon file does not exist: ${iconPath}`);
      }
    } catch (error) {
      await logger.error('Error checking icon file', error);
    }
  }

  // Configure window for platform
  const windowConfig = {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PathUtils.normalizePath(path.join(__dirname, 'preload.js'))
    },
    show: false // Don't show the window until it's ready
  };

  // Platform-specific window settings
  if (process.platform === 'darwin') {
    windowConfig.titleBarStyle = 'hiddenInset';
  } else if (process.platform === 'win32') {
    windowConfig.frame = true;
  }
  if (loggerInitialized) {
    await logger.logWindowCreation(windowConfig);
  }
  try {
    mainWindow = new BrowserWindow(windowConfig);
    if (loggerInitialized) {
      await logger.log('BrowserWindow created successfully');
    }
  } catch (error) {
    if (loggerInitialized) {
      await logger.error('Failed to create BrowserWindow', error);
    }
    throw error;
  }

  // Show window when it's ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    if (loggerInitialized) {
      logger.log('Window ready to show event fired');
    }
    mainWindow.show();
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    // Dev mode - load from dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Production - load local files using platform-safe paths
    const appPath = PathUtils.normalizePath(process.env.NODE_ENV === 'development' ? path.join(__dirname, '../frontend/dist/index.html') : path.join(app.getAppPath(), 'frontend/dist/index.html'));

    // Enable dev tools in production for debugging if needed
    mainWindow.webContents.openDevTools();

    // Log the path being loaded
    console.log('Loading app from path:', appPath);

    // Use file:// protocol for loading the main HTML file
    // This is the standard approach for Electron apps
    mainWindow.loadURL(url.format({
      pathname: appPath,
      protocol: 'file:',
      slashes: true
    }));

    // Log any page load errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('Failed to load app:', errorCode, errorDescription);

      // Attempt to reload with a slight delay as a fallback
      if (errorCode !== -3) {
        // Ignore aborted loads
        console.log('Attempting fallback load after delay...');
        setTimeout(() => {
          mainWindow.loadURL(url.format({
            pathname: appPath,
            protocol: 'file:',
            slashes: true
          }));
        }, 1000);
      }
    });
  }

  // Set platform-specific application menu
  if (process.platform === 'darwin') {
    createMacMenu();
    // Make mainWindow available globally for menu actions
    global.mainWindow = mainWindow;
  } else {
    // For Windows and Linux, use a simpler menu or default
    const {
      Menu
    } = require('electron');
    Menu.setApplicationMenu(Menu.buildFromTemplate([{
      label: 'File',
      submenu: [{
        label: 'New Conversion',
        accelerator: 'CmdOrCtrl+N',
        click: () => mainWindow?.webContents.send('menu:new-conversion')
      }, {
        type: 'separator'
      }, {
        role: 'quit'
      }]
    }, {
      label: 'View',
      submenu: [{
        role: 'reload'
      }, {
        role: 'toggleDevTools'
      }, {
        type: 'separator'
      }, {
        role: 'togglefullscreen'
      }]
    }]));
  }

  // Window event handlers
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Notify renderer process that app is ready
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('app:ready', true);
    console.log('✅ Sent app:ready event to renderer');
  });
  return mainWindow;
}

/**
 * Register media protocol handler with logging
 */
function registerMediaProtocol() {
  protocol.registerFileProtocol('media', async (request, callback) => {
    try {
      const filePath = request.url.replace('media://', '');
      const safePath = PathUtils.normalizePath(decodeURI(filePath));
      if (loggerInitialized) {
        await logger.log(`Media protocol serving: ${safePath}`);
      }
      console.log('Media protocol serving:', safePath);
      callback(safePath);
    } catch (error) {
      if (loggerInitialized) {
        await logger.error(`Media protocol handler error: ${request.url}`, error);
      }
      console.error('Error in media protocol handler:', error);
      callback({
        error: -2
      });
    }
  });
  if (loggerInitialized) {
    logger.log('Media protocol handler registered');
  }
}

/**
 * Register enhanced file protocol handler with logging
 */
function registerFileProtocol() {
  protocol.registerFileProtocol('file', async (request, callback) => {
    try {
      let filePath = request.url.replace('file://', '');
      if (loggerInitialized) {
        await logger.debug('File protocol request', {
          url: request.url,
          filePath
        });
      }
      console.log('File protocol request:', filePath);

      // Special handling for Windows absolute paths with drive letters
      if (process.platform === 'win32' && filePath.match(/^\/[A-Za-z]:\//)) {
        // Remove the leading slash before the drive letter
        filePath = filePath.replace(/^\/([A-Za-z]:\/.*?)$/, '$1');
        if (loggerInitialized) {
          await logger.debug('Normalized Windows path', {
            filePath
          });
        }
        console.log('Normalized Windows path:', filePath);
      }

      // Special case for index.html to avoid SvelteKit routing issues
      if (filePath.endsWith('index.html') || filePath.endsWith('\\index.html')) {
        const indexPath = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../frontend/dist/index.html') : path.join(app.getAppPath(), 'frontend/dist/index.html');
        const safePath = PathUtils.normalizePath(decodeURI(indexPath));
        if (loggerInitialized) {
          await logger.logAssetLoading('index.html', safePath);

          // Check if file exists
          try {
            const exists = await fs.pathExists(safePath);
            await logger.debug('Index file exists check', {
              exists,
              path: safePath
            });
            if (!exists) {
              // List alternative paths to check
              const alternativePaths = [path.join(app.getAppPath(), 'frontend/dist/index.html'), path.join(process.resourcesPath || '', 'frontend/dist/index.html'), path.join(app.getPath('exe'), '../resources/frontend/dist/index.html')];
              await logger.debug('Alternative index.html paths', {
                alternativePaths
              });

              // Check each alternative path
              for (const altPath of alternativePaths) {
                try {
                  const altExists = await fs.pathExists(altPath);
                  await logger.debug('Alternative path exists', {
                    path: altPath,
                    exists: altExists
                  });
                } catch (err) {
                  await logger.error(`Error checking alternative path: ${altPath}`, err);
                }
              }

              // List dist directory contents
              try {
                const distDir = path.dirname(safePath);
                if (await fs.pathExists(distDir)) {
                  const files = await fs.readdir(distDir);
                  await logger.debug('Dist directory contents', {
                    directory: distDir,
                    files
                  });
                }
              } catch (err) {
                await logger.error('Error reading dist directory', err);
              }
            }
          } catch (err) {
            await logger.error('Error checking index.html existence', err);
          }
        }
        console.log('Serving index.html from:', safePath);
        callback(safePath);
        return;
      }

      // Handle static assets from frontend/static
      if (filePath.includes('/static/') || filePath.includes('\\static\\')) {
        const staticFile = path.basename(filePath);
        const staticPath = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../frontend/static', staticFile) : path.join(app.getAppPath(), 'frontend/static', staticFile);
        const safePath = PathUtils.normalizePath(decodeURI(staticPath));
        if (loggerInitialized) {
          await logger.logAssetLoading(filePath, safePath);

          // Check if file exists
          try {
            const exists = await fs.pathExists(safePath);
            await logger.debug('Static asset exists check', {
              exists,
              path: safePath
            });
            if (!exists) {
              // Try fallback locations
              const altPaths = [path.join(app.getAppPath(), 'resources/static', staticFile), path.join(app.getAppPath(), 'resources/frontend/dist/static', staticFile), path.join(process.resourcesPath || '', 'static', staticFile), path.join(process.resourcesPath || '', 'frontend/dist/static', staticFile), path.join(app.getPath('exe'), '../resources/static', staticFile)];
              await logger.debug('Alternative static asset paths', {
                file: staticFile,
                paths: altPaths
              });

              // Check each alternative path
              for (const altPath of altPaths) {
                try {
                  const altExists = await fs.pathExists(altPath);
                  await logger.debug('Alternative path exists', {
                    path: altPath,
                    exists: altExists
                  });
                  if (altExists) {
                    await logger.log(`Found alternative path for ${staticFile}: ${altPath}`);
                    callback(altPath);
                    return;
                  }
                } catch (err) {
                  await logger.error(`Error checking alternative path: ${altPath}`, err);
                }
              }
            }
          } catch (err) {
            await logger.error(`Error checking existence of static asset: ${staticFile}`, err);
          }
        }
        console.log('Serving static asset from:', safePath);
        callback(safePath);
        return;
      }

      // Handle Vite/Svelte assets
      if (filePath.includes('/assets/') || filePath.includes('\\assets\\')) {
        const assetFile = filePath.substring(filePath.lastIndexOf('/') + 1);
        const assetPath = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../frontend/dist/assets', assetFile) : path.join(app.getAppPath(), 'frontend/dist/assets', assetFile);
        const safePath = PathUtils.normalizePath(decodeURI(assetPath));
        if (loggerInitialized) {
          await logger.logAssetLoading(filePath, safePath);

          // Check if file exists
          try {
            const exists = await fs.pathExists(safePath);
            await logger.debug('Asset exists check', {
              exists,
              path: safePath
            });
            if (!exists) {
              // Try fallback locations
              const altPaths = [path.join(app.getAppPath(), 'frontend/dist/assets', assetFile), path.join(app.getAppPath(), 'resources/frontend/dist/assets', assetFile), path.join(process.resourcesPath || '', 'frontend/dist/assets', assetFile)];
              await logger.debug('Alternative asset paths', {
                file: assetFile,
                paths: altPaths
              });
            }
          } catch (err) {
            await logger.error(`Error checking existence of asset: ${assetFile}`, err);
          }
        }
        console.log('Serving Vite asset from:', safePath);
        callback(safePath);
        return;
      }

      // Special case for direct file requests with no path (just a filename)
      if (!filePath.includes('/') && !filePath.includes('\\') && filePath.includes('.')) {
        if (loggerInitialized) {
          await logger.log('Detected direct file request with no path');
        }
        console.log('Detected direct file request with no path');

        // Try to find the file in the dist directory
        const distPath = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../frontend/dist', filePath) : path.join(app.getAppPath(), 'frontend/dist', filePath);
        const safePath = PathUtils.normalizePath(decodeURI(distPath));
        if (loggerInitialized) {
          await logger.logAssetLoading(filePath, safePath);
        }
        console.log('Serving direct file from dist:', safePath);
        callback(safePath);
        return;
      }

      // Handle other file:// requests normally
      const safePath = PathUtils.normalizePath(decodeURI(filePath));
      if (loggerInitialized) {
        await logger.logAssetLoading(filePath, safePath);
      }
      console.log('Serving standard file from:', safePath);
      callback(safePath);
    } catch (error) {
      if (loggerInitialized) {
        await logger.logProtocolError(request.url, error);
      }
      console.error('Error in file protocol handler:', error);
      callback({
        error: -2
      }); // Failed to load
    }
  });
  if (loggerInitialized) {
    logger.log('File protocol handler registered');
  }
}

// Direct console output for debugging
console.log('====== ELECTRON APP STARTING ======');
console.log('Working directory:', process.cwd());
console.log('App path:', app.getAppPath());
console.log('Resource path:', process.resourcesPath);
console.log('Executable path:', process.execPath);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('====================================');

// App startup sequence
app.whenReady().then(async () => {
  try {
    console.log('App ready event fired');

    // Initialize logger first thing
    await initializeLogger();
    await logger.logStartup();

    // Load API keys from store into environment variables
    await loadApiKeysToEnvironment();

    // Register protocol handlers
    console.log('Registering protocol handlers');
    registerMediaProtocol();
    registerFileProtocol();

    // Initialize app before creating window
    console.log('🚀 Starting app initialization...');
    const success = await initializeApp();
    if (!success) {
      console.error('❌ App initialization failed');
      app.quit();
      return;
    }

    // Create and setup window
    mainWindow = await createAndSetupWindow();
    if (!mainWindow) {
      console.error('❌ Failed to create main window');
      app.quit();
      return;
    }

    // Setup tray after window creation
    setupTray();
    console.log('✅ Main window created and initialized');
  } catch (error) {
    console.error('❌ Critical startup error:', error);
    app.quit();
  }
});

// Handle macOS activation
app.on('activate', async () => {
  if (mainWindow === null && appInitialized) {
    // Create and setup new window
    mainWindow = await createAndSetupWindow();
    if (!mainWindow) {
      console.error('❌ Failed to restore window on activate');
      return;
    }

    // Re-setup tray with new window
    setupTray();
  }
});

// Handle window close
app.on('window-all-closed', () => {
  // Clean up window-specific handlers
  if (typeof cleanupWindowHandlers === 'function') {
    cleanupWindowHandlers();
  }

  // Clean up tray
  if (trayManager) {
    trayManager.destroy();
    trayManager = null;
  }

  // Quit for non-macOS platforms
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up on quit
app.on('will-quit', () => {
  if (trayManager) {
    trayManager.destroy();
    trayManager = null;
  }
  notificationManager = null;
  updateManager = null;
});

// Handle fatal errors
process.on('uncaughtException', async error => {
  console.error('❌ Uncaught exception:', error);

  // Log to file if logger is initialized
  if (loggerInitialized) {
    try {
      await logger.error('Uncaught exception', error);
    } catch (logError) {
      console.error('❌ Failed to log uncaught exception:', logError);
    }
  }

  // Try to send to renderer
  if (mainWindow?.webContents) {
    try {
      mainWindow.webContents.send('app:error', error.message);
    } catch (sendError) {
      console.error('❌ Failed to send error to window:', sendError);
    }
  }
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjb25zb2xlIiwibG9nIiwicHJvY2VzcyIsInZlcnNpb25zIiwibm9kZSIsIk1vZHVsZSIsInJlcXVpcmUiLCJvcmlnaW5hbFJlc29sdmVGaWxlbmFtZSIsIl9yZXNvbHZlRmlsZW5hbWUiLCJwYXRoTWFwcGluZ3MiLCJfb3JpZ2luYWxSZXNvbHZlRmlsZW5hbWUiLCJyZXF1ZXN0IiwicGFyZW50IiwiaXNNYWluIiwib3B0aW9ucyIsIm1vZGlmaWVkUmVxdWVzdCIsInBhdHRlcm4iLCJyZXBsYWNlbWVudCIsIk9iamVjdCIsImVudHJpZXMiLCJpbmNsdWRlcyIsIm5ld1BhdGgiLCJyZXBsYWNlIiwiYnVpbGRQYXRoIiwiY2FsbCIsImVycm9yIiwid2FybiIsIm1lc3NhZ2UiLCJhcHAiLCJCcm93c2VyV2luZG93IiwicHJvdG9jb2wiLCJwYXRoIiwidXJsIiwiZnMiLCJQYXRoVXRpbHMiLCJsb2dnZXIiLCJFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIiwiY3JlYXRlTWFjTWVudSIsInNldHVwQmFzaWNIYW5kbGVycyIsInNldHVwV2luZG93SGFuZGxlcnMiLCJjbGVhbnVwV2luZG93SGFuZGxlcnMiLCJUcmF5TWFuYWdlciIsIk5vdGlmaWNhdGlvbk1hbmFnZXIiLCJVcGRhdGVNYW5hZ2VyIiwiY3JlYXRlU3RvcmUiLCJBcGlLZXlTZXJ2aWNlIiwic2V0dGluZ3NTdG9yZSIsIm1haW5XaW5kb3ciLCJhcHBJbml0aWFsaXplZCIsInRyYXlNYW5hZ2VyIiwibm90aWZpY2F0aW9uTWFuYWdlciIsInVwZGF0ZU1hbmFnZXIiLCJsb2dnZXJJbml0aWFsaXplZCIsImxvYWRBcGlLZXlzVG9FbnZpcm9ubWVudCIsIm1pc3RyYWxBcGlLZXkiLCJnZXRBcGlLZXkiLCJkZWVwZ3JhbUFwaUtleSIsImVudiIsIk1JU1RSQUxfQVBJX0tFWSIsIkRFRVBHUkFNX0FQSV9LRVkiLCJ0cmF5U3RvcmUiLCJlbmNyeXB0aW9uS2V5IiwiU1RPUkVfRU5DUllQVElPTl9LRVkiLCJpbml0aWFsaXplTG9nZ2VyIiwiaW5pdGlhbGl6ZSIsInNldHVwTm90aWZpY2F0aW9ucyIsInNldHVwVHJheSIsImNyZWF0ZUFuZFNldHVwV2luZG93Iiwid2luZG93IiwiY3JlYXRlTWFpbldpbmRvdyIsIlByb21pc2UiLCJyZXNvbHZlIiwic2V0VGltZW91dCIsImluaXRpYWxpemVBcHAiLCJhcGlLZXlTZXJ2aWNlSW5zdGFuY2UiLCJnZXQiLCJkZWVwZ3JhbVNlcnZpY2UiLCJjb25maWdSZXN1bHQiLCJoYW5kbGVDb25maWd1cmUiLCJhcGlLZXkiLCJzdWNjZXNzIiwiY29uZmlnRXJyb3IiLCJzZXR1cE91dHB1dERpcmVjdG9yeSIsIkVycm9yIiwiYXBwUGF0aHMiLCJhcHBQYXRoIiwiZ2V0QXBwUGF0aCIsImFwcERhdGEiLCJnZXRQYXRoIiwidXNlckRhdGEiLCJleGUiLCJtb2R1bGUiLCJjd2QiLCJyZXNvdXJjZXNQYXRoIiwiZGVidWciLCJpY29uUGF0aCIsIm5vcm1hbGl6ZVBhdGgiLCJOT0RFX0VOViIsImpvaW4iLCJfX2Rpcm5hbWUiLCJpY29uRXhpc3RzIiwicGF0aEV4aXN0cyIsImV4aXN0cyIsIndpbmRvd0NvbmZpZyIsIndpZHRoIiwiaGVpZ2h0IiwibWluV2lkdGgiLCJtaW5IZWlnaHQiLCJpY29uIiwid2ViUHJlZmVyZW5jZXMiLCJub2RlSW50ZWdyYXRpb24iLCJjb250ZXh0SXNvbGF0aW9uIiwicHJlbG9hZCIsInNob3ciLCJwbGF0Zm9ybSIsInRpdGxlQmFyU3R5bGUiLCJmcmFtZSIsImxvZ1dpbmRvd0NyZWF0aW9uIiwib25jZSIsImxvYWRVUkwiLCJ3ZWJDb250ZW50cyIsIm9wZW5EZXZUb29scyIsImZvcm1hdCIsInBhdGhuYW1lIiwic2xhc2hlcyIsIm9uIiwiZXZlbnQiLCJlcnJvckNvZGUiLCJlcnJvckRlc2NyaXB0aW9uIiwiZ2xvYmFsIiwiTWVudSIsInNldEFwcGxpY2F0aW9uTWVudSIsImJ1aWxkRnJvbVRlbXBsYXRlIiwibGFiZWwiLCJzdWJtZW51IiwiYWNjZWxlcmF0b3IiLCJjbGljayIsInNlbmQiLCJ0eXBlIiwicm9sZSIsInJlZ2lzdGVyTWVkaWFQcm90b2NvbCIsInJlZ2lzdGVyRmlsZVByb3RvY29sIiwiY2FsbGJhY2siLCJmaWxlUGF0aCIsInNhZmVQYXRoIiwiZGVjb2RlVVJJIiwibWF0Y2giLCJlbmRzV2l0aCIsImluZGV4UGF0aCIsImxvZ0Fzc2V0TG9hZGluZyIsImFsdGVybmF0aXZlUGF0aHMiLCJhbHRQYXRoIiwiYWx0RXhpc3RzIiwiZXJyIiwiZGlzdERpciIsImRpcm5hbWUiLCJmaWxlcyIsInJlYWRkaXIiLCJkaXJlY3RvcnkiLCJzdGF0aWNGaWxlIiwiYmFzZW5hbWUiLCJzdGF0aWNQYXRoIiwiYWx0UGF0aHMiLCJmaWxlIiwicGF0aHMiLCJhc3NldEZpbGUiLCJzdWJzdHJpbmciLCJsYXN0SW5kZXhPZiIsImFzc2V0UGF0aCIsImRpc3RQYXRoIiwibG9nUHJvdG9jb2xFcnJvciIsImV4ZWNQYXRoIiwid2hlblJlYWR5IiwidGhlbiIsImxvZ1N0YXJ0dXAiLCJxdWl0IiwiZGVzdHJveSIsImxvZ0Vycm9yIiwic2VuZEVycm9yIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL2VsZWN0cm9uL21haW4uanMiXSwic291cmNlc0NvbnRlbnQiOlsiY29uc29sZS5sb2coYFtERUJVR10gUnVubmluZyBOb2RlLmpzIHZlcnNpb24gaW4gbWFpbiBwcm9jZXNzOiAke3Byb2Nlc3MudmVyc2lvbnMubm9kZX1gKTtcclxuLyoqXHJcbiAqIEVsZWN0cm9uIE1haW4gUHJvY2Vzc1xyXG4gKiBFbnRyeSBwb2ludCBmb3IgdGhlIEVsZWN0cm9uIGFwcGxpY2F0aW9uLlxyXG4gKlxyXG4gKiBIYW5kbGVzOlxyXG4gKiAtIFdpbmRvdyBtYW5hZ2VtZW50XHJcbiAqIC0gSVBDIGNvbW11bmljYXRpb24gc2V0dXBcclxuICogLSBQcm90b2NvbCByZWdpc3RyYXRpb25cclxuICogLSBBcHAgbGlmZWN5Y2xlXHJcbiAqL1xyXG5cclxuLyoqXHJcbiAqIE1PRFVMRSBSRVNPTFVUSU9OIEZJWDpcclxuICogVGhpcyBwYXRjaCBpbnRlcmNlcHRzIE5vZGUuanMgbW9kdWxlIGxvYWRpbmcgdG8gZml4IHBhdGggcmVzb2x1dGlvbiBpc3N1ZXMgaW4gcGFja2FnZWQgYXBwcy5cclxuICogSXQgZW5zdXJlcyBcInNyY1wiIHBhdGhzIGNvcnJlY3RseSByZXNvbHZlIHRvIFwiYnVpbGRcIiBwYXRocyBmb3IgY29tcGlsZWQgY29kZS5cclxuICogU3BlY2lmaWNhbGx5IGZpeGVzIHRoZSBDb252ZXJ0ZXJSZWdpc3RyeS5qcyBtb2R1bGUgbG9hZGluZyBpbiB0aGUgUERGIGNvbnZlcnRlci5cclxuICovXHJcbnRyeSB7XHJcbiAgLy8gQWNjZXNzIHRoZSBOb2RlLmpzIG1vZHVsZSBzeXN0ZW1cclxuICBjb25zdCBNb2R1bGUgPSByZXF1aXJlKCdtb2R1bGUnKTtcclxuICBjb25zdCBvcmlnaW5hbFJlc29sdmVGaWxlbmFtZSA9IE1vZHVsZS5fcmVzb2x2ZUZpbGVuYW1lO1xyXG5cclxuICAvLyBDcmVhdGUgcGF0aCBtYXBwaW5ncyBmb3IgdGhlIHJlc29sdmVyXHJcbiAgY29uc3QgcGF0aE1hcHBpbmdzID0ge1xyXG4gICAgLy8gTWFwIHNwZWNpZmljIHNyYyBwYXRocyB0byBidWlsZCBwYXRoc1xyXG4gICAgJ1xcXFxyZXNvdXJjZXNcXFxcYXBwLmFzYXJcXFxcc3JjXFxcXGVsZWN0cm9uXFxcXCc6ICdcXFxccmVzb3VyY2VzXFxcXGFwcC5hc2FyXFxcXGJ1aWxkXFxcXGVsZWN0cm9uXFxcXCcsXHJcbiAgICAnL3Jlc291cmNlcy9hcHAuYXNhci9zcmMvZWxlY3Ryb24vJzogJy9yZXNvdXJjZXMvYXBwLmFzYXIvYnVpbGQvZWxlY3Ryb24vJyxcclxuICB9O1xyXG5cclxuICAvLyBPbmx5IGluc3RhbGwgdGhlIG92ZXJyaWRlIG9uY2VcclxuICBpZiAoIU1vZHVsZS5fb3JpZ2luYWxSZXNvbHZlRmlsZW5hbWUpIHtcclxuICAgIC8vIFN0b3JlIHRoZSBvcmlnaW5hbCBmb3IgcmVzdG9yYXRpb24gaWYgbmVlZGVkXHJcbiAgICBNb2R1bGUuX29yaWdpbmFsUmVzb2x2ZUZpbGVuYW1lID0gb3JpZ2luYWxSZXNvbHZlRmlsZW5hbWU7XHJcblxyXG4gICAgLy8gUmVwbGFjZSB3aXRoIG91ciBwYXRjaGVkIHZlcnNpb25cclxuICAgIE1vZHVsZS5fcmVzb2x2ZUZpbGVuYW1lID0gZnVuY3Rpb24ocmVxdWVzdCwgcGFyZW50LCBpc01haW4sIG9wdGlvbnMpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBDaGVjayBpZiB0aGUgcmVxdWVzdCBtYXRjaGVzIGFueSBvZiBvdXIgcHJvYmxlbWF0aWMgcGF0dGVybnNcclxuICAgICAgICBsZXQgbW9kaWZpZWRSZXF1ZXN0ID0gcmVxdWVzdDtcclxuXHJcbiAgICAgICAgLy8gQXBwbHkgcGF0dGVybiByZXBsYWNlbWVudHNcclxuICAgICAgICBmb3IgKGNvbnN0IFtwYXR0ZXJuLCByZXBsYWNlbWVudF0gb2YgT2JqZWN0LmVudHJpZXMocGF0aE1hcHBpbmdzKSkge1xyXG4gICAgICAgICAgaWYgKHR5cGVvZiByZXF1ZXN0ID09PSAnc3RyaW5nJyAmJiByZXF1ZXN0LmluY2x1ZGVzKHBhdHRlcm4pKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5ld1BhdGggPSByZXF1ZXN0LnJlcGxhY2UocGF0dGVybiwgcmVwbGFjZW1lbnQpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+UhCBbTW9kdWxlUmVkaXJlY3RdICR7cmVxdWVzdH0gLT4gJHtuZXdQYXRofWApO1xyXG4gICAgICAgICAgICBtb2RpZmllZFJlcXVlc3QgPSBuZXdQYXRoO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIENvbnZlcnRlclJlZ2lzdHJ5LmpzXHJcbiAgICAgICAgaWYgKHR5cGVvZiByZXF1ZXN0ID09PSAnc3RyaW5nJyAmJlxyXG4gICAgICAgICAgICByZXF1ZXN0LmluY2x1ZGVzKCdzcmMnKSAmJlxyXG4gICAgICAgICAgICByZXF1ZXN0LmluY2x1ZGVzKCdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpKSB7XHJcbiAgICAgICAgICBjb25zdCBidWlsZFBhdGggPSByZXF1ZXN0LnJlcGxhY2UoL3NyY1tcXFxcXFwvXWVsZWN0cm9uLywgJ2J1aWxkL2VsZWN0cm9uJylcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoL3NyY1xcXFxlbGVjdHJvbi8sICdidWlsZFxcXFxlbGVjdHJvbicpO1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYOKaoO+4jyBbTW9kdWxlUmVkaXJlY3RdIENvbnZlcnRlclJlZ2lzdHJ5LmpzIHNwZWNpYWwgaGFuZGxpbmc6ICR7YnVpbGRQYXRofWApO1xyXG4gICAgICAgICAgbW9kaWZpZWRSZXF1ZXN0ID0gYnVpbGRQYXRoO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2FsbCB0aGUgb3JpZ2luYWwgcmVzb2x2ZXIgd2l0aCBvdXIgcG9zc2libHkgbW9kaWZpZWQgcGF0aFxyXG4gICAgICAgIHJldHVybiBvcmlnaW5hbFJlc29sdmVGaWxlbmFtZS5jYWxsKHRoaXMsIG1vZGlmaWVkUmVxdWVzdCwgcGFyZW50LCBpc01haW4sIG9wdGlvbnMpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFtNb2R1bGVSZWRpcmVjdF0gRXJyb3IgaW4gcmVzb2x2ZXIgb3ZlcnJpZGU6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAvLyBGYWxsIGJhY2sgdG8gb3JpZ2luYWwgYmVoYXZpb3JcclxuICAgICAgICByZXR1cm4gb3JpZ2luYWxSZXNvbHZlRmlsZW5hbWUuY2FsbCh0aGlzLCByZXF1ZXN0LCBwYXJlbnQsIGlzTWFpbiwgb3B0aW9ucyk7XHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgY29uc29sZS5sb2coJ/CflKcgW01vZHVsZVJlZGlyZWN0XSBOb2RlLmpzIG1vZHVsZSByZXNvbHV0aW9uIG92ZXJyaWRlIGluc3RhbGxlZCcpO1xyXG4gIH1cclxufSBjYXRjaCAoZXJyb3IpIHtcclxuICBjb25zb2xlLndhcm4oJ+KaoO+4jyBbTW9kdWxlUmVkaXJlY3RdIEZhaWxlZCB0byBpbnN0YWxsIG1vZHVsZSByZXNvbHV0aW9uIG92ZXJyaWRlOicsIGVycm9yLm1lc3NhZ2UpO1xyXG59XHJcblxyXG5jb25zdCB7IGFwcCwgQnJvd3NlcldpbmRvdywgcHJvdG9jb2wgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IHVybCA9IHJlcXVpcmUoJ3VybCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbmNvbnN0IHsgUGF0aFV0aWxzIH0gPSByZXF1aXJlKCcuL3V0aWxzL3BhdGhzJyk7XHJcbmNvbnN0IGxvZ2dlciA9IHJlcXVpcmUoJy4vdXRpbHMvbG9nZ2VyJyk7XHJcbmNvbnN0IEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UgPSByZXF1aXJlKCcuL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UnKTtcclxuY29uc3QgeyBjcmVhdGVNYWNNZW51IH0gPSByZXF1aXJlKCcuL2ZlYXR1cmVzL21lbnUnKTtcclxuY29uc3QgeyBzZXR1cEJhc2ljSGFuZGxlcnMsIHNldHVwV2luZG93SGFuZGxlcnMsIGNsZWFudXBXaW5kb3dIYW5kbGVycyB9ID0gcmVxdWlyZSgnLi9pcGMvaGFuZGxlcnMnKTtcclxuY29uc3QgVHJheU1hbmFnZXIgPSByZXF1aXJlKCcuL2ZlYXR1cmVzL3RyYXknKTtcclxuY29uc3QgTm90aWZpY2F0aW9uTWFuYWdlciA9IHJlcXVpcmUoJy4vZmVhdHVyZXMvbm90aWZpY2F0aW9ucycpO1xyXG5jb25zdCBVcGRhdGVNYW5hZ2VyID0gcmVxdWlyZSgnLi9mZWF0dXJlcy91cGRhdGVyJyk7XHJcbmNvbnN0IHsgY3JlYXRlU3RvcmUgfSA9IHJlcXVpcmUoJy4vdXRpbHMvc3RvcmVGYWN0b3J5Jyk7XHJcbmNvbnN0IEFwaUtleVNlcnZpY2UgPSByZXF1aXJlKCcuL3NlcnZpY2VzL0FwaUtleVNlcnZpY2UnKTsgLy8gSW1wb3J0IEFwaUtleVNlcnZpY2VcclxuLy8gQ3JlYXRlIHNldHRpbmdzIHN0b3JlIGZvciByZXRyaWV2aW5nIERlZXBncmFtIEFQSSBrZXlcclxuY29uc3Qgc2V0dGluZ3NTdG9yZSA9IGNyZWF0ZVN0b3JlKCdzZXR0aW5ncycpO1xyXG5cclxuLy8gS2VlcCBhIGdsb2JhbCByZWZlcmVuY2Ugb2Ygb2JqZWN0c1xyXG5sZXQgbWFpbldpbmRvdztcclxubGV0IGFwcEluaXRpYWxpemVkID0gZmFsc2U7XHJcbmxldCB0cmF5TWFuYWdlciA9IG51bGw7XHJcbmxldCBub3RpZmljYXRpb25NYW5hZ2VyID0gbnVsbDtcclxubGV0IHVwZGF0ZU1hbmFnZXIgPSBudWxsO1xyXG5sZXQgbG9nZ2VySW5pdGlhbGl6ZWQgPSBmYWxzZTtcclxuXHJcbi8qKlxyXG4gKiBMb2FkIEFQSSBrZXlzIGFuZCBzZXQgdGhlbSBhcyBlbnZpcm9ubWVudCB2YXJpYWJsZXNcclxuICogVGhpcyBlbnN1cmVzIEFQSSBrZXlzIGFyZSBhdmFpbGFibGUgdG8gY29udmVydGVycyB0aGF0IG5lZWQgdGhlbVxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gbG9hZEFwaUtleXNUb0Vudmlyb25tZW50KCkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zb2xlLmxvZygnTG9hZGluZyBBUEkga2V5cyB0byBlbnZpcm9ubWVudCB2YXJpYWJsZXMuLi4nKTtcclxuXHJcbiAgICAvLyBHZXQgQVBJIGtleXMgZnJvbSBBcGlLZXlTZXJ2aWNlXHJcbiAgICBjb25zdCBtaXN0cmFsQXBpS2V5ID0gQXBpS2V5U2VydmljZS5nZXRBcGlLZXkoJ21pc3RyYWwnKTtcclxuICAgIGNvbnN0IGRlZXBncmFtQXBpS2V5ID0gQXBpS2V5U2VydmljZS5nZXRBcGlLZXkoJ2RlZXBncmFtJyk7XHJcblxyXG4gICAgLy8gU2V0IEFQSSBrZXlzIGFzIGVudmlyb25tZW50IHZhcmlhYmxlc1xyXG4gICAgaWYgKG1pc3RyYWxBcGlLZXkpIHtcclxuICAgICAgcHJvY2Vzcy5lbnYuTUlTVFJBTF9BUElfS0VZID0gbWlzdHJhbEFwaUtleTtcclxuICAgICAgY29uc29sZS5sb2coJ+KchSBNaXN0cmFsIEFQSSBrZXkgbG9hZGVkIGludG8gZW52aXJvbm1lbnQnKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfimqDvuI8gTm8gTWlzdHJhbCBBUEkga2V5IGZvdW5kIGluIHN0b3JlJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGRlZXBncmFtQXBpS2V5KSB7XHJcbiAgICAgIHByb2Nlc3MuZW52LkRFRVBHUkFNX0FQSV9LRVkgPSBkZWVwZ3JhbUFwaUtleTtcclxuICAgICAgY29uc29sZS5sb2coJ+KchSBEZWVwZ3JhbSBBUEkga2V5IGxvYWRlZCBpbnRvIGVudmlyb25tZW50Jyk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBjb25zb2xlLmxvZygn4pqg77iPIE5vIERlZXBncmFtIEFQSSBrZXkgZm91bmQgaW4gc3RvcmUnKTtcclxuICAgIH1cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBsb2FkIEFQSSBrZXlzOicsIGVycm9yKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEluaXRpYWxpemUgdHJheSBzdG9yZVxyXG5jb25zdCB0cmF5U3RvcmUgPSBjcmVhdGVTdG9yZSgndHJheS1tYW5hZ2VyJywge1xyXG4gICAgZW5jcnlwdGlvbktleTogcHJvY2Vzcy5lbnYuU1RPUkVfRU5DUllQVElPTl9LRVlcclxufSk7XHJcblxyXG4vKipcclxuICogSW5pdGlhbGl6ZSBsb2dnZXJcclxuICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgbG9nZ2VyIHdhcyBzdWNjZXNzZnVsbHkgaW5pdGlhbGl6ZWRcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGluaXRpYWxpemVMb2dnZXIoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IGxvZ2dlci5pbml0aWFsaXplKCk7XHJcbiAgICAgICAgbG9nZ2VySW5pdGlhbGl6ZWQgPSB0cnVlO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgTG9nZ2VyIGluaXRpYWxpemVkJyk7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBsb2dnZXI6JywgZXJyb3IpO1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIFNldHVwIG5vdGlmaWNhdGlvbnMgd2l0aCBlcnJvciBoYW5kbGluZ1xyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gc2V0dXBOb3RpZmljYXRpb25zKCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBub3RpZmljYXRpb25NYW5hZ2VyID0gbmV3IE5vdGlmaWNhdGlvbk1hbmFnZXIoKTtcclxuICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZygnTm90aWZpY2F0aW9ucyBpbml0aWFsaXplZCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIE5vdGlmaWNhdGlvbnMgaW5pdGlhbGl6ZWQnKTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcignRmFpbGVkIHRvIHNldHVwIG5vdGlmaWNhdGlvbnMnLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gc2V0dXAgbm90aWZpY2F0aW9uczonLCBlcnJvcik7XHJcbiAgICAgICAgbm90aWZpY2F0aW9uTWFuYWdlciA9IG51bGw7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogU2V0dXAgc3lzdGVtIHRyYXkgd2l0aCBlcnJvciBoYW5kbGluZ1xyXG4gKi9cclxuZnVuY3Rpb24gc2V0dXBUcmF5KCkge1xyXG4gICAgaWYgKCFtYWluV2luZG93KSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCfimqDvuI8gQ2Fubm90IHNldHVwIHRyYXkgd2l0aG91dCBtYWluIHdpbmRvdycpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICAgIHRyYXlNYW5hZ2VyID0gbmV3IFRyYXlNYW5hZ2VyKG1haW5XaW5kb3csIHRyYXlTdG9yZSk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBUcmF5IGluaXRpYWxpemVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGNyZWF0ZSB0cmF5OicsIGVycm9yKTtcclxuICAgICAgICAvLyBOb24tZmF0YWwgZXJyb3IsIGNvbnRpbnVlIGV4ZWN1dGlvblxyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogQ3JlYXRlIGFuZCBzZXR1cCB3aW5kb3cgd2l0aCBlcnJvciBoYW5kbGluZ1xyXG4gKiBAcmV0dXJucyB7RWxlY3Ryb24uQnJvd3NlcldpbmRvd3xudWxsfSBUaGUgY3JlYXRlZCB3aW5kb3cgb3IgbnVsbCBpZiBmYWlsZWRcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUFuZFNldHVwV2luZG93KCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zb2xlLmxvZygnQ3JlYXRpbmcgbWFpbiB3aW5kb3cuLi4nKTtcclxuICAgICAgICBjb25zdCB3aW5kb3cgPSBhd2FpdCBjcmVhdGVNYWluV2luZG93KCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCF3aW5kb3cpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIFdpbmRvdyBjcmVhdGlvbiBmYWlsZWQ6IHdpbmRvdyBpcyBudWxsJyk7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBjb25zb2xlLmxvZygnV2luZG93IGNyZWF0ZWQgc3VjY2Vzc2Z1bGx5LCB3YWl0aW5nIGZvciBpbml0aWFsaXphdGlvbi4uLicpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFdhaXQgYSBtb21lbnQgZm9yIHRoZSB3aW5kb3cgdG8gaW5pdGlhbGl6ZSBmdWxseVxyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDAwKSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc29sZS5sb2coJ1NldHRpbmcgdXAgd2luZG93IGhhbmRsZXJzLi4uJyk7XHJcbiAgICAgICAgLy8gU2V0dXAgd2luZG93IGhhbmRsZXJzXHJcbiAgICAgICAgYXdhaXQgc2V0dXBXaW5kb3dIYW5kbGVycyh3aW5kb3cpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgV2luZG93IGhhbmRsZXJzIHJlZ2lzdGVyZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHdpbmRvdztcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBjcmVhdGUgYW5kIHNldHVwIHdpbmRvdzonLCBlcnJvcik7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBJbml0aWFsaXplIGNvcmUgYXBwbGljYXRpb24gc2VydmljZXMgYW5kIGhhbmRsZXJzXHJcbiAqIE11c3QgY29tcGxldGUgYmVmb3JlIHdpbmRvdyBjcmVhdGlvblxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZUFwcCgpIHtcclxuICB0cnkge1xyXG4gICAgLy8gSW5pdGlhbGl6ZSBBUEkgS2V5IFNlcnZpY2UgZWFybHlcclxuICAgIGNvbnN0IGFwaUtleVNlcnZpY2VJbnN0YW5jZSA9IEFwaUtleVNlcnZpY2U7IC8vIEFzc3VtaW5nIHNpbmdsZXRvbiBleHBvcnRcclxuICAgIC8vIFRyeSB0byBjb25maWd1cmUgRGVlcGdyYW0gb24gc3RhcnR1cCBpZiBrZXkgZXhpc3RzXHJcbiAgICBjb25zdCBkZWVwZ3JhbUFwaUtleSA9IHNldHRpbmdzU3RvcmUuZ2V0KCd0cmFuc2NyaXB0aW9uLmRlZXBncmFtQXBpS2V5Jyk7XHJcbiAgICBpZiAoZGVlcGdyYW1BcGlLZXkpIHtcclxuICAgICAgY29uc29sZS5sb2coJ1tTdGFydHVwXSBGb3VuZCBzdG9yZWQgRGVlcGdyYW0gQVBJIGtleSwgYXR0ZW1wdGluZyB0byBjb25maWd1cmUgRGVlcGdyYW1TZXJ2aWNlLi4uJyk7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gSW1wb3J0IHRoZSBEZWVwZ3JhbVNlcnZpY2VcclxuICAgICAgICBjb25zdCBkZWVwZ3JhbVNlcnZpY2UgPSByZXF1aXJlKCcuL3NlcnZpY2VzL2FpL0RlZXBncmFtU2VydmljZScpO1xyXG4gICAgICAgIC8vIENvbmZpZ3VyZSB3aXRoIHRoZSBBUEkga2V5XHJcbiAgICAgICAgY29uc3QgY29uZmlnUmVzdWx0ID0gYXdhaXQgZGVlcGdyYW1TZXJ2aWNlLmhhbmRsZUNvbmZpZ3VyZShudWxsLCB7IGFwaUtleTogZGVlcGdyYW1BcGlLZXkgfSk7XHJcbiAgICAgICAgaWYgKGNvbmZpZ1Jlc3VsdC5zdWNjZXNzKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZygnW1N0YXJ0dXBdIERlZXBncmFtU2VydmljZSBjb25maWd1cmVkIHN1Y2Nlc3NmdWxseSBvbiBzdGFydHVwLicpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oJ1tTdGFydHVwXSBEZWVwZ3JhbVNlcnZpY2UgY29uZmlndXJhdGlvbiBmYWlsZWQgb24gc3RhcnR1cC4nKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gY2F0Y2ggKGNvbmZpZ0Vycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignW1N0YXJ0dXBdIEVycm9yIGNvbmZpZ3VyaW5nIERlZXBncmFtU2VydmljZSBvbiBzdGFydHVwOicsIGNvbmZpZ0Vycm9yKTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc29sZS5sb2coJ1tTdGFydHVwXSBObyBzdG9yZWQgRGVlcGdyYW0gQVBJIGtleSBmb3VuZC4nKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBJbml0aWFsaXplIHVwZGF0ZSBtYW5hZ2VyXHJcbiAgICB1cGRhdGVNYW5hZ2VyID0gbmV3IFVwZGF0ZU1hbmFnZXIoKTtcclxuICAgICAgICB1cGRhdGVNYW5hZ2VyLmluaXRpYWxpemUoKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIFVwZGF0ZSBtYW5hZ2VyIGluaXRpYWxpemVkJyk7XHJcblxyXG4gICAgICAgIC8vIFNldHVwIGJhc2ljIElQQyBoYW5kbGVycyBmaXJzdFxyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5OhIFJlZ2lzdGVyaW5nIGJhc2ljIElQQyBoYW5kbGVycy4uLicpO1xyXG4gICAgICAgIHNldHVwQmFzaWNIYW5kbGVycyhhcHApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgQmFzaWMgSVBDIGhhbmRsZXJzIHJlZ2lzdGVyZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcblxyXG4gICAgICAgIC8vIEluaXRpYWxpemUgY29yZSBzZXJ2aWNlc1xyXG4gICAgICAgIGF3YWl0IEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2Uuc2V0dXBPdXRwdXREaXJlY3RvcnkoKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIENvbnZlcnNpb24gc2VydmljZSBpbml0aWFsaXplZCcpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFNldHVwIG5vdGlmaWNhdGlvbnMgKG5vbi1mYXRhbCBpZiBpdCBmYWlscylcclxuICAgICAgICBpZiAoIXNldHVwTm90aWZpY2F0aW9ucygpKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybign4pqg77iPIE5vdGlmaWNhdGlvbnMgdW5hdmFpbGFibGUgLSBjb250aW51aW5nIHdpdGhvdXQgbm90aWZpY2F0aW9ucycpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgYXBwSW5pdGlhbGl6ZWQgPSB0cnVlO1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGluaXRpYWxpemUgYXBwOicsIGVycm9yKTtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDcmVhdGUgdGhlIG1haW4gYXBwbGljYXRpb24gd2luZG93XHJcbiAqIE9ubHkgY2FsbGVkIGFmdGVyIGluaXRpYWxpemF0aW9uIGlzIGNvbXBsZXRlXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVNYWluV2luZG93KCkge1xyXG4gICAgaWYgKCFhcHBJbml0aWFsaXplZCkge1xyXG4gICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCdDYW5ub3QgY3JlYXRlIHdpbmRvdyBiZWZvcmUgYXBwIGluaXRpYWxpemF0aW9uJyk7XHJcbiAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcignV2luZG93IGNyZWF0aW9uIGVycm9yJywgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICBhd2FpdCBsb2dnZXIubG9nKCdDcmVhdGluZyBtYWluIHdpbmRvdycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIExvZyBhcHAgcGF0aHMgZm9yIGRlYnVnZ2luZ1xyXG4gICAgICAgIGNvbnN0IGFwcFBhdGhzID0ge1xyXG4gICAgICAgICAgICBhcHBQYXRoOiBhcHAuZ2V0QXBwUGF0aCgpLFxyXG4gICAgICAgICAgICBhcHBEYXRhOiBhcHAuZ2V0UGF0aCgnYXBwRGF0YScpLFxyXG4gICAgICAgICAgICB1c2VyRGF0YTogYXBwLmdldFBhdGgoJ3VzZXJEYXRhJyksXHJcbiAgICAgICAgICAgIGV4ZTogYXBwLmdldFBhdGgoJ2V4ZScpLFxyXG4gICAgICAgICAgICBtb2R1bGU6IGFwcC5nZXRQYXRoKCdtb2R1bGUnKSxcclxuICAgICAgICAgICAgY3dkOiBwcm9jZXNzLmN3ZCgpLFxyXG4gICAgICAgICAgICByZXNvdXJjZXNQYXRoOiBwcm9jZXNzLnJlc291cmNlc1BhdGggfHwgJ3VuZGVmaW5lZCdcclxuICAgICAgICB9O1xyXG4gICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnQXBwbGljYXRpb24gcGF0aHMnLCBhcHBQYXRocyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2V0IHBsYXRmb3JtLXNwZWNpZmljIGljb24gcGF0aFxyXG4gICAgY29uc3QgaWNvblBhdGggPSBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChcclxuICAgICAgICBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50J1xyXG4gICAgICAgICAgICA/IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9mcm9udGVuZC9zdGF0aWMvbG9nby5wbmcnKVxyXG4gICAgICAgICAgICA6IHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAnZnJvbnRlbmQvc3RhdGljL2xvZ28ucG5nJylcclxuICAgICk7XHJcbiAgICBcclxuICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnSWNvbiBwYXRoJywgeyBpY29uUGF0aCB9KTtcclxuXHJcbiAgICAgICAgLy8gVmVyaWZ5IGljb24gZXhpc3RzXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgaWNvbkV4aXN0cyA9IGF3YWl0IGZzLnBhdGhFeGlzdHMoaWNvblBhdGgpO1xyXG4gICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0ljb24gZmlsZSBjaGVjaycsIHsgZXhpc3RzOiBpY29uRXhpc3RzLCBwYXRoOiBpY29uUGF0aCB9KTtcclxuICAgICAgICAgICAgaWYgKCFpY29uRXhpc3RzKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIud2FybihgSWNvbiBmaWxlIGRvZXMgbm90IGV4aXN0OiAke2ljb25QYXRofWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKCdFcnJvciBjaGVja2luZyBpY29uIGZpbGUnLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIENvbmZpZ3VyZSB3aW5kb3cgZm9yIHBsYXRmb3JtXHJcbiAgICBjb25zdCB3aW5kb3dDb25maWcgPSB7XHJcbiAgICAgICAgd2lkdGg6IDEyMDAsXHJcbiAgICAgICAgaGVpZ2h0OiA4MDAsXHJcbiAgICAgICAgbWluV2lkdGg6IDgwMCxcclxuICAgICAgICBtaW5IZWlnaHQ6IDYwMCxcclxuICAgICAgICBpY29uOiBpY29uUGF0aCxcclxuICAgICAgICB3ZWJQcmVmZXJlbmNlczoge1xyXG4gICAgICAgICAgICBub2RlSW50ZWdyYXRpb246IGZhbHNlLFxyXG4gICAgICAgICAgICBjb250ZXh0SXNvbGF0aW9uOiB0cnVlLFxyXG4gICAgICAgICAgICBwcmVsb2FkOiBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChwYXRoLmpvaW4oX19kaXJuYW1lLCAncHJlbG9hZC5qcycpKVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgc2hvdzogZmFsc2UgLy8gRG9uJ3Qgc2hvdyB0aGUgd2luZG93IHVudGlsIGl0J3MgcmVhZHlcclxuICAgIH07XHJcblxyXG4gICAgLy8gUGxhdGZvcm0tc3BlY2lmaWMgd2luZG93IHNldHRpbmdzXHJcbiAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2RhcndpbicpIHtcclxuICAgICAgICB3aW5kb3dDb25maWcudGl0bGVCYXJTdHlsZSA9ICdoaWRkZW5JbnNldCc7XHJcbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicpIHtcclxuICAgICAgICB3aW5kb3dDb25maWcuZnJhbWUgPSB0cnVlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICBhd2FpdCBsb2dnZXIubG9nV2luZG93Q3JlYXRpb24od2luZG93Q29uZmlnKTtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICAgIG1haW5XaW5kb3cgPSBuZXcgQnJvd3NlcldpbmRvdyh3aW5kb3dDb25maWcpO1xyXG4gICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nKCdCcm93c2VyV2luZG93IGNyZWF0ZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gY3JlYXRlIEJyb3dzZXJXaW5kb3cnLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBTaG93IHdpbmRvdyB3aGVuIGl0J3MgcmVhZHkgdG8gYXZvaWQgd2hpdGUgZmxhc2hcclxuICAgIG1haW5XaW5kb3cub25jZSgncmVhZHktdG8tc2hvdycsICgpID0+IHtcclxuICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgbG9nZ2VyLmxvZygnV2luZG93IHJlYWR5IHRvIHNob3cgZXZlbnQgZmlyZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgbWFpbldpbmRvdy5zaG93KCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMb2FkIHRoZSBhcHBcclxuICAgIGlmIChwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50Jykge1xyXG4gICAgICAgIC8vIERldiBtb2RlIC0gbG9hZCBmcm9tIGRldiBzZXJ2ZXJcclxuICAgICAgICBtYWluV2luZG93LmxvYWRVUkwoJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3MycpO1xyXG4gICAgICAgIG1haW5XaW5kb3cud2ViQ29udGVudHMub3BlbkRldlRvb2xzKCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIFByb2R1Y3Rpb24gLSBsb2FkIGxvY2FsIGZpbGVzIHVzaW5nIHBsYXRmb3JtLXNhZmUgcGF0aHNcclxuICAgICAgICBjb25zdCBhcHBQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoXHJcbiAgICAgICAgICAgIHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnXHJcbiAgICAgICAgICAgICAgICA/IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9mcm9udGVuZC9kaXN0L2luZGV4Lmh0bWwnKVxyXG4gICAgICAgICAgICAgICAgOiBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ2Zyb250ZW5kL2Rpc3QvaW5kZXguaHRtbCcpXHJcbiAgICAgICAgKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBFbmFibGUgZGV2IHRvb2xzIGluIHByb2R1Y3Rpb24gZm9yIGRlYnVnZ2luZyBpZiBuZWVkZWRcclxuICAgICAgICBtYWluV2luZG93LndlYkNvbnRlbnRzLm9wZW5EZXZUb29scygpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIExvZyB0aGUgcGF0aCBiZWluZyBsb2FkZWRcclxuICAgICAgICBjb25zb2xlLmxvZygnTG9hZGluZyBhcHAgZnJvbSBwYXRoOicsIGFwcFBhdGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFVzZSBmaWxlOi8vIHByb3RvY29sIGZvciBsb2FkaW5nIHRoZSBtYWluIEhUTUwgZmlsZVxyXG4gICAgICAgIC8vIFRoaXMgaXMgdGhlIHN0YW5kYXJkIGFwcHJvYWNoIGZvciBFbGVjdHJvbiBhcHBzXHJcbiAgICAgICAgbWFpbldpbmRvdy5sb2FkVVJMKFxyXG4gICAgICAgICAgICB1cmwuZm9ybWF0KHtcclxuICAgICAgICAgICAgICAgIHBhdGhuYW1lOiBhcHBQYXRoLFxyXG4gICAgICAgICAgICAgICAgcHJvdG9jb2w6ICdmaWxlOicsXHJcbiAgICAgICAgICAgICAgICBzbGFzaGVzOiB0cnVlXHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBMb2cgYW55IHBhZ2UgbG9hZCBlcnJvcnNcclxuICAgICAgICBtYWluV2luZG93LndlYkNvbnRlbnRzLm9uKCdkaWQtZmFpbC1sb2FkJywgKGV2ZW50LCBlcnJvckNvZGUsIGVycm9yRGVzY3JpcHRpb24pID0+IHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGxvYWQgYXBwOicsIGVycm9yQ29kZSwgZXJyb3JEZXNjcmlwdGlvbik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBBdHRlbXB0IHRvIHJlbG9hZCB3aXRoIGEgc2xpZ2h0IGRlbGF5IGFzIGEgZmFsbGJhY2tcclxuICAgICAgICAgICAgaWYgKGVycm9yQ29kZSAhPT0gLTMpIHsgLy8gSWdub3JlIGFib3J0ZWQgbG9hZHNcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdBdHRlbXB0aW5nIGZhbGxiYWNrIGxvYWQgYWZ0ZXIgZGVsYXkuLi4nKTtcclxuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIG1haW5XaW5kb3cubG9hZFVSTChcclxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsLmZvcm1hdCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRobmFtZTogYXBwUGF0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb3RvY29sOiAnZmlsZTonLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2xhc2hlczogdHJ1ZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgICB9LCAxMDAwKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFNldCBwbGF0Zm9ybS1zcGVjaWZpYyBhcHBsaWNhdGlvbiBtZW51XHJcbiAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2RhcndpbicpIHtcclxuICAgICAgICBjcmVhdGVNYWNNZW51KCk7XHJcbiAgICAgICAgLy8gTWFrZSBtYWluV2luZG93IGF2YWlsYWJsZSBnbG9iYWxseSBmb3IgbWVudSBhY3Rpb25zXHJcbiAgICAgICAgZ2xvYmFsLm1haW5XaW5kb3cgPSBtYWluV2luZG93O1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBGb3IgV2luZG93cyBhbmQgTGludXgsIHVzZSBhIHNpbXBsZXIgbWVudSBvciBkZWZhdWx0XHJcbiAgICAgICAgY29uc3QgeyBNZW51IH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG4gICAgICAgIE1lbnUuc2V0QXBwbGljYXRpb25NZW51KE1lbnUuYnVpbGRGcm9tVGVtcGxhdGUoW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0ZpbGUnLFxyXG4gICAgICAgICAgICAgICAgc3VibWVudTogW1xyXG4gICAgICAgICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdOZXcgQ29udmVyc2lvbicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjY2VsZXJhdG9yOiAnQ21kT3JDdHJsK04nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGljazogKCkgPT4gbWFpbldpbmRvdz8ud2ViQ29udGVudHMuc2VuZCgnbWVudTpuZXctY29udmVyc2lvbicpXHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICB7IHR5cGU6ICdzZXBhcmF0b3InIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgeyByb2xlOiAncXVpdCcgfVxyXG4gICAgICAgICAgICAgICAgXVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1ZpZXcnLFxyXG4gICAgICAgICAgICAgICAgc3VibWVudTogW1xyXG4gICAgICAgICAgICAgICAgICAgIHsgcm9sZTogJ3JlbG9hZCcgfSxcclxuICAgICAgICAgICAgICAgICAgICB7IHJvbGU6ICd0b2dnbGVEZXZUb29scycgfSxcclxuICAgICAgICAgICAgICAgICAgICB7IHR5cGU6ICdzZXBhcmF0b3InIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgeyByb2xlOiAndG9nZ2xlZnVsbHNjcmVlbicgfVxyXG4gICAgICAgICAgICAgICAgXVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgXSkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFdpbmRvdyBldmVudCBoYW5kbGVyc1xyXG4gICAgbWFpbldpbmRvdy5vbignY2xvc2VkJywgKCkgPT4ge1xyXG4gICAgICAgIG1haW5XaW5kb3cgPSBudWxsO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTm90aWZ5IHJlbmRlcmVyIHByb2Nlc3MgdGhhdCBhcHAgaXMgcmVhZHlcclxuICAgIG1haW5XaW5kb3cud2ViQ29udGVudHMub24oJ2RpZC1maW5pc2gtbG9hZCcsICgpID0+IHtcclxuICAgICAgICBtYWluV2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ2FwcDpyZWFkeScsIHRydWUpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgU2VudCBhcHA6cmVhZHkgZXZlbnQgdG8gcmVuZGVyZXInKTtcclxuICAgIH0pO1xyXG5cclxuICAgIHJldHVybiBtYWluV2luZG93O1xyXG59XHJcblxyXG4vKipcclxuICogUmVnaXN0ZXIgbWVkaWEgcHJvdG9jb2wgaGFuZGxlciB3aXRoIGxvZ2dpbmdcclxuICovXHJcbmZ1bmN0aW9uIHJlZ2lzdGVyTWVkaWFQcm90b2NvbCgpIHtcclxuICAgIHByb3RvY29sLnJlZ2lzdGVyRmlsZVByb3RvY29sKCdtZWRpYScsIGFzeW5jIChyZXF1ZXN0LCBjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVQYXRoID0gcmVxdWVzdC51cmwucmVwbGFjZSgnbWVkaWE6Ly8nLCAnJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHNhZmVQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoZGVjb2RlVVJJKGZpbGVQYXRoKSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2coYE1lZGlhIHByb3RvY29sIHNlcnZpbmc6ICR7c2FmZVBhdGh9YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ01lZGlhIHByb3RvY29sIHNlcnZpbmc6Jywgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICBjYWxsYmFjayhzYWZlUGF0aCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoYE1lZGlhIHByb3RvY29sIGhhbmRsZXIgZXJyb3I6ICR7cmVxdWVzdC51cmx9YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIG1lZGlhIHByb3RvY29sIGhhbmRsZXI6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICBjYWxsYmFjayh7IGVycm9yOiAtMiB9KTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgbG9nZ2VyLmxvZygnTWVkaWEgcHJvdG9jb2wgaGFuZGxlciByZWdpc3RlcmVkJyk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBSZWdpc3RlciBlbmhhbmNlZCBmaWxlIHByb3RvY29sIGhhbmRsZXIgd2l0aCBsb2dnaW5nXHJcbiAqL1xyXG5mdW5jdGlvbiByZWdpc3RlckZpbGVQcm90b2NvbCgpIHtcclxuICAgIHByb3RvY29sLnJlZ2lzdGVyRmlsZVByb3RvY29sKCdmaWxlJywgYXN5bmMgKHJlcXVlc3QsIGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgbGV0IGZpbGVQYXRoID0gcmVxdWVzdC51cmwucmVwbGFjZSgnZmlsZTovLycsICcnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdGaWxlIHByb3RvY29sIHJlcXVlc3QnLCB7IHVybDogcmVxdWVzdC51cmwsIGZpbGVQYXRoIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdGaWxlIHByb3RvY29sIHJlcXVlc3Q6JywgZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gU3BlY2lhbCBoYW5kbGluZyBmb3IgV2luZG93cyBhYnNvbHV0ZSBwYXRocyB3aXRoIGRyaXZlIGxldHRlcnNcclxuICAgICAgICAgICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicgJiYgZmlsZVBhdGgubWF0Y2goL15cXC9bQS1aYS16XTpcXC8vKSkge1xyXG4gICAgICAgICAgICAgICAgLy8gUmVtb3ZlIHRoZSBsZWFkaW5nIHNsYXNoIGJlZm9yZSB0aGUgZHJpdmUgbGV0dGVyXHJcbiAgICAgICAgICAgICAgICBmaWxlUGF0aCA9IGZpbGVQYXRoLnJlcGxhY2UoL15cXC8oW0EtWmEtel06XFwvLio/KSQvLCAnJDEnKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdOb3JtYWxpemVkIFdpbmRvd3MgcGF0aCcsIHsgZmlsZVBhdGggfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnTm9ybWFsaXplZCBXaW5kb3dzIHBhdGg6JywgZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBTcGVjaWFsIGNhc2UgZm9yIGluZGV4Lmh0bWwgdG8gYXZvaWQgU3ZlbHRlS2l0IHJvdXRpbmcgaXNzdWVzXHJcbiAgICAgICAgICAgIGlmIChmaWxlUGF0aC5lbmRzV2l0aCgnaW5kZXguaHRtbCcpIHx8IGZpbGVQYXRoLmVuZHNXaXRoKCdcXFxcaW5kZXguaHRtbCcpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBpbmRleFBhdGggPSBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50J1xyXG4gICAgICAgICAgICAgICAgICAgID8gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Zyb250ZW5kL2Rpc3QvaW5kZXguaHRtbCcpXHJcbiAgICAgICAgICAgICAgICAgICAgOiBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ2Zyb250ZW5kL2Rpc3QvaW5kZXguaHRtbCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2FmZVBhdGggPSBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChkZWNvZGVVUkkoaW5kZXhQYXRoKSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2dBc3NldExvYWRpbmcoJ2luZGV4Lmh0bWwnLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgZmlsZSBleGlzdHNcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBleGlzdHMgPSBhd2FpdCBmcy5wYXRoRXhpc3RzKHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdJbmRleCBmaWxlIGV4aXN0cyBjaGVjaycsIHsgZXhpc3RzLCBwYXRoOiBzYWZlUGF0aCB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZXhpc3RzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBMaXN0IGFsdGVybmF0aXZlIHBhdGhzIHRvIGNoZWNrXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhbHRlcm5hdGl2ZVBhdGhzID0gW1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAnZnJvbnRlbmQvZGlzdC9pbmRleC5odG1sJyksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKHByb2Nlc3MucmVzb3VyY2VzUGF0aCB8fCAnJywgJ2Zyb250ZW5kL2Rpc3QvaW5kZXguaHRtbCcpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihhcHAuZ2V0UGF0aCgnZXhlJyksICcuLi9yZXNvdXJjZXMvZnJvbnRlbmQvZGlzdC9pbmRleC5odG1sJylcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnQWx0ZXJuYXRpdmUgaW5kZXguaHRtbCBwYXRocycsIHsgYWx0ZXJuYXRpdmVQYXRocyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZWFjaCBhbHRlcm5hdGl2ZSBwYXRoXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGFsdFBhdGggb2YgYWx0ZXJuYXRpdmVQYXRocykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFsdEV4aXN0cyA9IGF3YWl0IGZzLnBhdGhFeGlzdHMoYWx0UGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnQWx0ZXJuYXRpdmUgcGF0aCBleGlzdHMnLCB7IHBhdGg6IGFsdFBhdGgsIGV4aXN0czogYWx0RXhpc3RzIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoYEVycm9yIGNoZWNraW5nIGFsdGVybmF0aXZlIHBhdGg6ICR7YWx0UGF0aH1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gTGlzdCBkaXN0IGRpcmVjdG9yeSBjb250ZW50c1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXN0RGlyID0gcGF0aC5kaXJuYW1lKHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoYXdhaXQgZnMucGF0aEV4aXN0cyhkaXN0RGlyKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmaWxlcyA9IGF3YWl0IGZzLnJlYWRkaXIoZGlzdERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnRGlzdCBkaXJlY3RvcnkgY29udGVudHMnLCB7IGRpcmVjdG9yeTogZGlzdERpciwgZmlsZXMgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKCdFcnJvciByZWFkaW5nIGRpc3QgZGlyZWN0b3J5JywgZXJyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGluZGV4Lmh0bWwgZXhpc3RlbmNlJywgZXJyKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTZXJ2aW5nIGluZGV4Lmh0bWwgZnJvbTonLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICBjYWxsYmFjayhzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEhhbmRsZSBzdGF0aWMgYXNzZXRzIGZyb20gZnJvbnRlbmQvc3RhdGljXHJcbiAgICAgICAgICAgIGlmIChmaWxlUGF0aC5pbmNsdWRlcygnL3N0YXRpYy8nKSB8fCBmaWxlUGF0aC5pbmNsdWRlcygnXFxcXHN0YXRpY1xcXFwnKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhdGljRmlsZSA9IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhdGljUGF0aCA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnXHJcbiAgICAgICAgICAgICAgICAgICAgPyBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vZnJvbnRlbmQvc3RhdGljJywgc3RhdGljRmlsZSlcclxuICAgICAgICAgICAgICAgICAgICA6IHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAnZnJvbnRlbmQvc3RhdGljJywgc3RhdGljRmlsZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zdCBzYWZlUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKGRlY29kZVVSSShzdGF0aWNQYXRoKSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2dBc3NldExvYWRpbmcoZmlsZVBhdGgsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBmaWxlIGV4aXN0c1xyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGV4aXN0cyA9IGF3YWl0IGZzLnBhdGhFeGlzdHMoc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ1N0YXRpYyBhc3NldCBleGlzdHMgY2hlY2snLCB7IGV4aXN0cywgcGF0aDogc2FmZVBhdGggfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWV4aXN0cykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJ5IGZhbGxiYWNrIGxvY2F0aW9uc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWx0UGF0aHMgPSBbXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdyZXNvdXJjZXMvc3RhdGljJywgc3RhdGljRmlsZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdyZXNvdXJjZXMvZnJvbnRlbmQvZGlzdC9zdGF0aWMnLCBzdGF0aWNGaWxlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4ocHJvY2Vzcy5yZXNvdXJjZXNQYXRoIHx8ICcnLCAnc3RhdGljJywgc3RhdGljRmlsZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKHByb2Nlc3MucmVzb3VyY2VzUGF0aCB8fCAnJywgJ2Zyb250ZW5kL2Rpc3Qvc3RhdGljJywgc3RhdGljRmlsZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKGFwcC5nZXRQYXRoKCdleGUnKSwgJy4uL3Jlc291cmNlcy9zdGF0aWMnLCBzdGF0aWNGaWxlKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdBbHRlcm5hdGl2ZSBzdGF0aWMgYXNzZXQgcGF0aHMnLCB7IGZpbGU6IHN0YXRpY0ZpbGUsIHBhdGhzOiBhbHRQYXRocyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgZWFjaCBhbHRlcm5hdGl2ZSBwYXRoXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGFsdFBhdGggb2YgYWx0UGF0aHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhbHRFeGlzdHMgPSBhd2FpdCBmcy5wYXRoRXhpc3RzKGFsdFBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0FsdGVybmF0aXZlIHBhdGggZXhpc3RzJywgeyBwYXRoOiBhbHRQYXRoLCBleGlzdHM6IGFsdEV4aXN0cyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhbHRFeGlzdHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2coYEZvdW5kIGFsdGVybmF0aXZlIHBhdGggZm9yICR7c3RhdGljRmlsZX06ICR7YWx0UGF0aH1gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrKGFsdFBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcihgRXJyb3IgY2hlY2tpbmcgYWx0ZXJuYXRpdmUgcGF0aDogJHthbHRQYXRofWAsIGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcihgRXJyb3IgY2hlY2tpbmcgZXhpc3RlbmNlIG9mIHN0YXRpYyBhc3NldDogJHtzdGF0aWNGaWxlfWAsIGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU2VydmluZyBzdGF0aWMgYXNzZXQgZnJvbTonLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICBjYWxsYmFjayhzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEhhbmRsZSBWaXRlL1N2ZWx0ZSBhc3NldHNcclxuICAgICAgICAgICAgaWYgKGZpbGVQYXRoLmluY2x1ZGVzKCcvYXNzZXRzLycpIHx8IGZpbGVQYXRoLmluY2x1ZGVzKCdcXFxcYXNzZXRzXFxcXCcpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBhc3NldEZpbGUgPSBmaWxlUGF0aC5zdWJzdHJpbmcoZmlsZVBhdGgubGFzdEluZGV4T2YoJy8nKSArIDEpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYXNzZXRQYXRoID0gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCdcclxuICAgICAgICAgICAgICAgICAgICA/IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9mcm9udGVuZC9kaXN0L2Fzc2V0cycsIGFzc2V0RmlsZSlcclxuICAgICAgICAgICAgICAgICAgICA6IHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAnZnJvbnRlbmQvZGlzdC9hc3NldHMnLCBhc3NldEZpbGUpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2FmZVBhdGggPSBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChkZWNvZGVVUkkoYXNzZXRQYXRoKSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2dBc3NldExvYWRpbmcoZmlsZVBhdGgsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBmaWxlIGV4aXN0c1xyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGV4aXN0cyA9IGF3YWl0IGZzLnBhdGhFeGlzdHMoc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0Fzc2V0IGV4aXN0cyBjaGVjaycsIHsgZXhpc3RzLCBwYXRoOiBzYWZlUGF0aCB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZXhpc3RzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBUcnkgZmFsbGJhY2sgbG9jYXRpb25zXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhbHRQYXRocyA9IFtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ2Zyb250ZW5kL2Rpc3QvYXNzZXRzJywgYXNzZXRGaWxlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ3Jlc291cmNlcy9mcm9udGVuZC9kaXN0L2Fzc2V0cycsIGFzc2V0RmlsZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKHByb2Nlc3MucmVzb3VyY2VzUGF0aCB8fCAnJywgJ2Zyb250ZW5kL2Rpc3QvYXNzZXRzJywgYXNzZXRGaWxlKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdBbHRlcm5hdGl2ZSBhc3NldCBwYXRocycsIHsgZmlsZTogYXNzZXRGaWxlLCBwYXRoczogYWx0UGF0aHMgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKGBFcnJvciBjaGVja2luZyBleGlzdGVuY2Ugb2YgYXNzZXQ6ICR7YXNzZXRGaWxlfWAsIGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU2VydmluZyBWaXRlIGFzc2V0IGZyb206Jywgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgY2FsbGJhY2soc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBTcGVjaWFsIGNhc2UgZm9yIGRpcmVjdCBmaWxlIHJlcXVlc3RzIHdpdGggbm8gcGF0aCAoanVzdCBhIGZpbGVuYW1lKVxyXG4gICAgICAgICAgICBpZiAoIWZpbGVQYXRoLmluY2x1ZGVzKCcvJykgJiYgIWZpbGVQYXRoLmluY2x1ZGVzKCdcXFxcJykgJiYgZmlsZVBhdGguaW5jbHVkZXMoJy4nKSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZygnRGV0ZWN0ZWQgZGlyZWN0IGZpbGUgcmVxdWVzdCB3aXRoIG5vIHBhdGgnKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdEZXRlY3RlZCBkaXJlY3QgZmlsZSByZXF1ZXN0IHdpdGggbm8gcGF0aCcpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBUcnkgdG8gZmluZCB0aGUgZmlsZSBpbiB0aGUgZGlzdCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgIGNvbnN0IGRpc3RQYXRoID0gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCdcclxuICAgICAgICAgICAgICAgICAgICA/IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9mcm9udGVuZC9kaXN0JywgZmlsZVBhdGgpXHJcbiAgICAgICAgICAgICAgICAgICAgOiBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ2Zyb250ZW5kL2Rpc3QnLCBmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zdCBzYWZlUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKGRlY29kZVVSSShkaXN0UGF0aCkpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nQXNzZXRMb2FkaW5nKGZpbGVQYXRoLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTZXJ2aW5nIGRpcmVjdCBmaWxlIGZyb20gZGlzdDonLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICBjYWxsYmFjayhzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEhhbmRsZSBvdGhlciBmaWxlOi8vIHJlcXVlc3RzIG5vcm1hbGx5XHJcbiAgICAgICAgICAgIGNvbnN0IHNhZmVQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoZGVjb2RlVVJJKGZpbGVQYXRoKSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2dBc3NldExvYWRpbmcoZmlsZVBhdGgsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1NlcnZpbmcgc3RhbmRhcmQgZmlsZSBmcm9tOicsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgY2FsbGJhY2soc2FmZVBhdGgpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZ1Byb3RvY29sRXJyb3IocmVxdWVzdC51cmwsIGVycm9yKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gZmlsZSBwcm90b2NvbCBoYW5kbGVyOicsIGVycm9yKTtcclxuICAgICAgICAgICAgY2FsbGJhY2soeyBlcnJvcjogLTIgfSk7IC8vIEZhaWxlZCB0byBsb2FkXHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgIGxvZ2dlci5sb2coJ0ZpbGUgcHJvdG9jb2wgaGFuZGxlciByZWdpc3RlcmVkJyk7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8vIERpcmVjdCBjb25zb2xlIG91dHB1dCBmb3IgZGVidWdnaW5nXHJcbmNvbnNvbGUubG9nKCc9PT09PT0gRUxFQ1RST04gQVBQIFNUQVJUSU5HID09PT09PScpO1xyXG5jb25zb2xlLmxvZygnV29ya2luZyBkaXJlY3Rvcnk6JywgcHJvY2Vzcy5jd2QoKSk7XHJcbmNvbnNvbGUubG9nKCdBcHAgcGF0aDonLCBhcHAuZ2V0QXBwUGF0aCgpKTtcclxuY29uc29sZS5sb2coJ1Jlc291cmNlIHBhdGg6JywgcHJvY2Vzcy5yZXNvdXJjZXNQYXRoKTtcclxuY29uc29sZS5sb2coJ0V4ZWN1dGFibGUgcGF0aDonLCBwcm9jZXNzLmV4ZWNQYXRoKTtcclxuY29uc29sZS5sb2coJ05PREVfRU5WOicsIHByb2Nlc3MuZW52Lk5PREVfRU5WKTtcclxuY29uc29sZS5sb2coJz09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PScpO1xyXG5cclxuLy8gQXBwIHN0YXJ0dXAgc2VxdWVuY2VcclxuYXBwLndoZW5SZWFkeSgpLnRoZW4oYXN5bmMgKCkgPT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zb2xlLmxvZygnQXBwIHJlYWR5IGV2ZW50IGZpcmVkJyk7XHJcblxyXG4gICAgICAgIC8vIEluaXRpYWxpemUgbG9nZ2VyIGZpcnN0IHRoaW5nXHJcbiAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZUxvZ2dlcigpO1xyXG4gICAgICAgIGF3YWl0IGxvZ2dlci5sb2dTdGFydHVwKCk7XHJcblxyXG4gICAgICAgIC8vIExvYWQgQVBJIGtleXMgZnJvbSBzdG9yZSBpbnRvIGVudmlyb25tZW50IHZhcmlhYmxlc1xyXG4gICAgICAgIGF3YWl0IGxvYWRBcGlLZXlzVG9FbnZpcm9ubWVudCgpO1xyXG5cclxuICAgICAgICAvLyBSZWdpc3RlciBwcm90b2NvbCBoYW5kbGVyc1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdSZWdpc3RlcmluZyBwcm90b2NvbCBoYW5kbGVycycpO1xyXG4gICAgICAgIHJlZ2lzdGVyTWVkaWFQcm90b2NvbCgpO1xyXG4gICAgICAgIHJlZ2lzdGVyRmlsZVByb3RvY29sKCk7XHJcblxyXG4gICAgICAgIC8vIEluaXRpYWxpemUgYXBwIGJlZm9yZSBjcmVhdGluZyB3aW5kb3dcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+agCBTdGFydGluZyBhcHAgaW5pdGlhbGl6YXRpb24uLi4nKTtcclxuICAgICAgICBjb25zdCBzdWNjZXNzID0gYXdhaXQgaW5pdGlhbGl6ZUFwcCgpO1xyXG4gICAgICAgIGlmICghc3VjY2Vzcykge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgQXBwIGluaXRpYWxpemF0aW9uIGZhaWxlZCcpO1xyXG4gICAgICAgICAgICBhcHAucXVpdCgpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBDcmVhdGUgYW5kIHNldHVwIHdpbmRvd1xyXG4gICAgICAgIG1haW5XaW5kb3cgPSBhd2FpdCBjcmVhdGVBbmRTZXR1cFdpbmRvdygpO1xyXG4gICAgICAgIGlmICghbWFpbldpbmRvdykge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGNyZWF0ZSBtYWluIHdpbmRvdycpO1xyXG4gICAgICAgICAgICBhcHAucXVpdCgpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBTZXR1cCB0cmF5IGFmdGVyIHdpbmRvdyBjcmVhdGlvblxyXG4gICAgICAgIHNldHVwVHJheSgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgTWFpbiB3aW5kb3cgY3JlYXRlZCBhbmQgaW5pdGlhbGl6ZWQnKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIENyaXRpY2FsIHN0YXJ0dXAgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICAgIGFwcC5xdWl0KCk7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuLy8gSGFuZGxlIG1hY09TIGFjdGl2YXRpb25cclxuYXBwLm9uKCdhY3RpdmF0ZScsIGFzeW5jICgpID0+IHtcclxuICAgIGlmIChtYWluV2luZG93ID09PSBudWxsICYmIGFwcEluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgLy8gQ3JlYXRlIGFuZCBzZXR1cCBuZXcgd2luZG93XHJcbiAgICAgICAgbWFpbldpbmRvdyA9IGF3YWl0IGNyZWF0ZUFuZFNldHVwV2luZG93KCk7XHJcbiAgICAgICAgaWYgKCFtYWluV2luZG93KSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gcmVzdG9yZSB3aW5kb3cgb24gYWN0aXZhdGUnKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBSZS1zZXR1cCB0cmF5IHdpdGggbmV3IHdpbmRvd1xyXG4gICAgICAgIHNldHVwVHJheSgpO1xyXG4gICAgfVxyXG59KTtcclxuXHJcbi8vIEhhbmRsZSB3aW5kb3cgY2xvc2VcclxuYXBwLm9uKCd3aW5kb3ctYWxsLWNsb3NlZCcsICgpID0+IHtcclxuICAgIC8vIENsZWFuIHVwIHdpbmRvdy1zcGVjaWZpYyBoYW5kbGVyc1xyXG4gICAgaWYgKHR5cGVvZiBjbGVhbnVwV2luZG93SGFuZGxlcnMgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICBjbGVhbnVwV2luZG93SGFuZGxlcnMoKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDbGVhbiB1cCB0cmF5XHJcbiAgICBpZiAodHJheU1hbmFnZXIpIHtcclxuICAgICAgICB0cmF5TWFuYWdlci5kZXN0cm95KCk7XHJcbiAgICAgICAgdHJheU1hbmFnZXIgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBRdWl0IGZvciBub24tbWFjT1MgcGxhdGZvcm1zXHJcbiAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSAhPT0gJ2RhcndpbicpIHtcclxuICAgICAgICBhcHAucXVpdCgpO1xyXG4gICAgfVxyXG59KTtcclxuXHJcbi8vIENsZWFuIHVwIG9uIHF1aXRcclxuYXBwLm9uKCd3aWxsLXF1aXQnLCAoKSA9PiB7XHJcbiAgICBpZiAodHJheU1hbmFnZXIpIHtcclxuICAgICAgICB0cmF5TWFuYWdlci5kZXN0cm95KCk7XHJcbiAgICAgICAgdHJheU1hbmFnZXIgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgbm90aWZpY2F0aW9uTWFuYWdlciA9IG51bGw7XHJcbiAgICB1cGRhdGVNYW5hZ2VyID0gbnVsbDtcclxufSk7XHJcblxyXG4vLyBIYW5kbGUgZmF0YWwgZXJyb3JzXHJcbnByb2Nlc3Mub24oJ3VuY2F1Z2h0RXhjZXB0aW9uJywgYXN5bmMgKGVycm9yKSA9PiB7XHJcbiAgICBjb25zb2xlLmVycm9yKCfinYwgVW5jYXVnaHQgZXhjZXB0aW9uOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgLy8gTG9nIHRvIGZpbGUgaWYgbG9nZ2VyIGlzIGluaXRpYWxpemVkXHJcbiAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoJ1VuY2F1Z2h0IGV4Y2VwdGlvbicsIGVycm9yKTtcclxuICAgICAgICB9IGNhdGNoIChsb2dFcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGxvZyB1bmNhdWdodCBleGNlcHRpb246JywgbG9nRXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gVHJ5IHRvIHNlbmQgdG8gcmVuZGVyZXJcclxuICAgIGlmIChtYWluV2luZG93Py53ZWJDb250ZW50cykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIG1haW5XaW5kb3cud2ViQ29udGVudHMuc2VuZCgnYXBwOmVycm9yJywgZXJyb3IubWVzc2FnZSk7XHJcbiAgICAgICAgfSBjYXRjaCAoc2VuZEVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gc2VuZCBlcnJvciB0byB3aW5kb3c6Jywgc2VuZEVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUFBLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLG9EQUFvREMsT0FBTyxDQUFDQyxRQUFRLENBQUNDLElBQUksRUFBRSxDQUFDO0FBQ3hGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7RUFDRjtFQUNBLE1BQU1DLE1BQU0sR0FBR0MsT0FBTyxDQUFDLFFBQVEsQ0FBQztFQUNoQyxNQUFNQyx1QkFBdUIsR0FBR0YsTUFBTSxDQUFDRyxnQkFBZ0I7O0VBRXZE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