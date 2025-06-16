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
    // mainWindow.webContents.openDevTools(); // Commented out to prevent auto-opening
  } else {
    // Production - load local files using platform-safe paths
    const appPath = PathUtils.normalizePath(process.env.NODE_ENV === 'development' ? path.join(__dirname, '../frontend/dist/index.html') : path.join(app.getAppPath(), 'frontend/dist/index.html'));

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjb25zb2xlIiwibG9nIiwicHJvY2VzcyIsInZlcnNpb25zIiwibm9kZSIsIk1vZHVsZSIsInJlcXVpcmUiLCJvcmlnaW5hbFJlc29sdmVGaWxlbmFtZSIsIl9yZXNvbHZlRmlsZW5hbWUiLCJwYXRoTWFwcGluZ3MiLCJfb3JpZ2luYWxSZXNvbHZlRmlsZW5hbWUiLCJyZXF1ZXN0IiwicGFyZW50IiwiaXNNYWluIiwib3B0aW9ucyIsIm1vZGlmaWVkUmVxdWVzdCIsInBhdHRlcm4iLCJyZXBsYWNlbWVudCIsIk9iamVjdCIsImVudHJpZXMiLCJpbmNsdWRlcyIsIm5ld1BhdGgiLCJyZXBsYWNlIiwiYnVpbGRQYXRoIiwiY2FsbCIsImVycm9yIiwid2FybiIsIm1lc3NhZ2UiLCJhcHAiLCJCcm93c2VyV2luZG93IiwicHJvdG9jb2wiLCJwYXRoIiwidXJsIiwiZnMiLCJQYXRoVXRpbHMiLCJsb2dnZXIiLCJFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIiwiY3JlYXRlTWFjTWVudSIsInNldHVwQmFzaWNIYW5kbGVycyIsInNldHVwV2luZG93SGFuZGxlcnMiLCJjbGVhbnVwV2luZG93SGFuZGxlcnMiLCJUcmF5TWFuYWdlciIsIk5vdGlmaWNhdGlvbk1hbmFnZXIiLCJVcGRhdGVNYW5hZ2VyIiwiY3JlYXRlU3RvcmUiLCJBcGlLZXlTZXJ2aWNlIiwic2V0dGluZ3NTdG9yZSIsIm1haW5XaW5kb3ciLCJhcHBJbml0aWFsaXplZCIsInRyYXlNYW5hZ2VyIiwibm90aWZpY2F0aW9uTWFuYWdlciIsInVwZGF0ZU1hbmFnZXIiLCJsb2dnZXJJbml0aWFsaXplZCIsImxvYWRBcGlLZXlzVG9FbnZpcm9ubWVudCIsIm1pc3RyYWxBcGlLZXkiLCJnZXRBcGlLZXkiLCJkZWVwZ3JhbUFwaUtleSIsImVudiIsIk1JU1RSQUxfQVBJX0tFWSIsIkRFRVBHUkFNX0FQSV9LRVkiLCJ0cmF5U3RvcmUiLCJlbmNyeXB0aW9uS2V5IiwiU1RPUkVfRU5DUllQVElPTl9LRVkiLCJpbml0aWFsaXplTG9nZ2VyIiwiaW5pdGlhbGl6ZSIsInNldHVwTm90aWZpY2F0aW9ucyIsInNldHVwVHJheSIsImNyZWF0ZUFuZFNldHVwV2luZG93Iiwid2luZG93IiwiY3JlYXRlTWFpbldpbmRvdyIsIlByb21pc2UiLCJyZXNvbHZlIiwic2V0VGltZW91dCIsImluaXRpYWxpemVBcHAiLCJhcGlLZXlTZXJ2aWNlSW5zdGFuY2UiLCJnZXQiLCJkZWVwZ3JhbVNlcnZpY2UiLCJjb25maWdSZXN1bHQiLCJoYW5kbGVDb25maWd1cmUiLCJhcGlLZXkiLCJzdWNjZXNzIiwiY29uZmlnRXJyb3IiLCJzZXR1cE91dHB1dERpcmVjdG9yeSIsIkVycm9yIiwiYXBwUGF0aHMiLCJhcHBQYXRoIiwiZ2V0QXBwUGF0aCIsImFwcERhdGEiLCJnZXRQYXRoIiwidXNlckRhdGEiLCJleGUiLCJtb2R1bGUiLCJjd2QiLCJyZXNvdXJjZXNQYXRoIiwiZGVidWciLCJpY29uUGF0aCIsIm5vcm1hbGl6ZVBhdGgiLCJOT0RFX0VOViIsImpvaW4iLCJfX2Rpcm5hbWUiLCJpY29uRXhpc3RzIiwicGF0aEV4aXN0cyIsImV4aXN0cyIsIndpbmRvd0NvbmZpZyIsIndpZHRoIiwiaGVpZ2h0IiwibWluV2lkdGgiLCJtaW5IZWlnaHQiLCJpY29uIiwid2ViUHJlZmVyZW5jZXMiLCJub2RlSW50ZWdyYXRpb24iLCJjb250ZXh0SXNvbGF0aW9uIiwicHJlbG9hZCIsInNob3ciLCJwbGF0Zm9ybSIsInRpdGxlQmFyU3R5bGUiLCJmcmFtZSIsImxvZ1dpbmRvd0NyZWF0aW9uIiwib25jZSIsImxvYWRVUkwiLCJmb3JtYXQiLCJwYXRobmFtZSIsInNsYXNoZXMiLCJ3ZWJDb250ZW50cyIsIm9uIiwiZXZlbnQiLCJlcnJvckNvZGUiLCJlcnJvckRlc2NyaXB0aW9uIiwiZ2xvYmFsIiwiTWVudSIsInNldEFwcGxpY2F0aW9uTWVudSIsImJ1aWxkRnJvbVRlbXBsYXRlIiwibGFiZWwiLCJzdWJtZW51IiwiYWNjZWxlcmF0b3IiLCJjbGljayIsInNlbmQiLCJ0eXBlIiwicm9sZSIsInJlZ2lzdGVyTWVkaWFQcm90b2NvbCIsInJlZ2lzdGVyRmlsZVByb3RvY29sIiwiY2FsbGJhY2siLCJmaWxlUGF0aCIsInNhZmVQYXRoIiwiZGVjb2RlVVJJIiwibWF0Y2giLCJlbmRzV2l0aCIsImluZGV4UGF0aCIsImxvZ0Fzc2V0TG9hZGluZyIsImFsdGVybmF0aXZlUGF0aHMiLCJhbHRQYXRoIiwiYWx0RXhpc3RzIiwiZXJyIiwiZGlzdERpciIsImRpcm5hbWUiLCJmaWxlcyIsInJlYWRkaXIiLCJkaXJlY3RvcnkiLCJzdGF0aWNGaWxlIiwiYmFzZW5hbWUiLCJzdGF0aWNQYXRoIiwiYWx0UGF0aHMiLCJmaWxlIiwicGF0aHMiLCJhc3NldEZpbGUiLCJzdWJzdHJpbmciLCJsYXN0SW5kZXhPZiIsImFzc2V0UGF0aCIsImRpc3RQYXRoIiwibG9nUHJvdG9jb2xFcnJvciIsImV4ZWNQYXRoIiwid2hlblJlYWR5IiwidGhlbiIsImxvZ1N0YXJ0dXAiLCJxdWl0IiwiZGVzdHJveSIsImxvZ0Vycm9yIiwic2VuZEVycm9yIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL2VsZWN0cm9uL21haW4uanMiXSwic291cmNlc0NvbnRlbnQiOlsiY29uc29sZS5sb2coYFtERUJVR10gUnVubmluZyBOb2RlLmpzIHZlcnNpb24gaW4gbWFpbiBwcm9jZXNzOiAke3Byb2Nlc3MudmVyc2lvbnMubm9kZX1gKTtcclxuLyoqXHJcbiAqIEVsZWN0cm9uIE1haW4gUHJvY2Vzc1xyXG4gKiBFbnRyeSBwb2ludCBmb3IgdGhlIEVsZWN0cm9uIGFwcGxpY2F0aW9uLlxyXG4gKlxyXG4gKiBIYW5kbGVzOlxyXG4gKiAtIFdpbmRvdyBtYW5hZ2VtZW50XHJcbiAqIC0gSVBDIGNvbW11bmljYXRpb24gc2V0dXBcclxuICogLSBQcm90b2NvbCByZWdpc3RyYXRpb25cclxuICogLSBBcHAgbGlmZWN5Y2xlXHJcbiAqL1xyXG5cclxuLyoqXHJcbiAqIE1PRFVMRSBSRVNPTFVUSU9OIEZJWDpcclxuICogVGhpcyBwYXRjaCBpbnRlcmNlcHRzIE5vZGUuanMgbW9kdWxlIGxvYWRpbmcgdG8gZml4IHBhdGggcmVzb2x1dGlvbiBpc3N1ZXMgaW4gcGFja2FnZWQgYXBwcy5cclxuICogSXQgZW5zdXJlcyBcInNyY1wiIHBhdGhzIGNvcnJlY3RseSByZXNvbHZlIHRvIFwiYnVpbGRcIiBwYXRocyBmb3IgY29tcGlsZWQgY29kZS5cclxuICogU3BlY2lmaWNhbGx5IGZpeGVzIHRoZSBDb252ZXJ0ZXJSZWdpc3RyeS5qcyBtb2R1bGUgbG9hZGluZyBpbiB0aGUgUERGIGNvbnZlcnRlci5cclxuICovXHJcbnRyeSB7XHJcbiAgLy8gQWNjZXNzIHRoZSBOb2RlLmpzIG1vZHVsZSBzeXN0ZW1cclxuICBjb25zdCBNb2R1bGUgPSByZXF1aXJlKCdtb2R1bGUnKTtcclxuICBjb25zdCBvcmlnaW5hbFJlc29sdmVGaWxlbmFtZSA9IE1vZHVsZS5fcmVzb2x2ZUZpbGVuYW1lO1xyXG5cclxuICAvLyBDcmVhdGUgcGF0aCBtYXBwaW5ncyBmb3IgdGhlIHJlc29sdmVyXHJcbiAgY29uc3QgcGF0aE1hcHBpbmdzID0ge1xyXG4gICAgLy8gTWFwIHNwZWNpZmljIHNyYyBwYXRocyB0byBidWlsZCBwYXRoc1xyXG4gICAgJ1xcXFxyZXNvdXJjZXNcXFxcYXBwLmFzYXJcXFxcc3JjXFxcXGVsZWN0cm9uXFxcXCc6ICdcXFxccmVzb3VyY2VzXFxcXGFwcC5hc2FyXFxcXGJ1aWxkXFxcXGVsZWN0cm9uXFxcXCcsXHJcbiAgICAnL3Jlc291cmNlcy9hcHAuYXNhci9zcmMvZWxlY3Ryb24vJzogJy9yZXNvdXJjZXMvYXBwLmFzYXIvYnVpbGQvZWxlY3Ryb24vJyxcclxuICB9O1xyXG5cclxuICAvLyBPbmx5IGluc3RhbGwgdGhlIG92ZXJyaWRlIG9uY2VcclxuICBpZiAoIU1vZHVsZS5fb3JpZ2luYWxSZXNvbHZlRmlsZW5hbWUpIHtcclxuICAgIC8vIFN0b3JlIHRoZSBvcmlnaW5hbCBmb3IgcmVzdG9yYXRpb24gaWYgbmVlZGVkXHJcbiAgICBNb2R1bGUuX29yaWdpbmFsUmVzb2x2ZUZpbGVuYW1lID0gb3JpZ2luYWxSZXNvbHZlRmlsZW5hbWU7XHJcblxyXG4gICAgLy8gUmVwbGFjZSB3aXRoIG91ciBwYXRjaGVkIHZlcnNpb25cclxuICAgIE1vZHVsZS5fcmVzb2x2ZUZpbGVuYW1lID0gZnVuY3Rpb24ocmVxdWVzdCwgcGFyZW50LCBpc01haW4sIG9wdGlvbnMpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBDaGVjayBpZiB0aGUgcmVxdWVzdCBtYXRjaGVzIGFueSBvZiBvdXIgcHJvYmxlbWF0aWMgcGF0dGVybnNcclxuICAgICAgICBsZXQgbW9kaWZpZWRSZXF1ZXN0ID0gcmVxdWVzdDtcclxuXHJcbiAgICAgICAgLy8gQXBwbHkgcGF0dGVybiByZXBsYWNlbWVudHNcclxuICAgICAgICBmb3IgKGNvbnN0IFtwYXR0ZXJuLCByZXBsYWNlbWVudF0gb2YgT2JqZWN0LmVudHJpZXMocGF0aE1hcHBpbmdzKSkge1xyXG4gICAgICAgICAgaWYgKHR5cGVvZiByZXF1ZXN0ID09PSAnc3RyaW5nJyAmJiByZXF1ZXN0LmluY2x1ZGVzKHBhdHRlcm4pKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5ld1BhdGggPSByZXF1ZXN0LnJlcGxhY2UocGF0dGVybiwgcmVwbGFjZW1lbnQpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+UhCBbTW9kdWxlUmVkaXJlY3RdICR7cmVxdWVzdH0gLT4gJHtuZXdQYXRofWApO1xyXG4gICAgICAgICAgICBtb2RpZmllZFJlcXVlc3QgPSBuZXdQYXRoO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIENvbnZlcnRlclJlZ2lzdHJ5LmpzXHJcbiAgICAgICAgaWYgKHR5cGVvZiByZXF1ZXN0ID09PSAnc3RyaW5nJyAmJlxyXG4gICAgICAgICAgICByZXF1ZXN0LmluY2x1ZGVzKCdzcmMnKSAmJlxyXG4gICAgICAgICAgICByZXF1ZXN0LmluY2x1ZGVzKCdDb252ZXJ0ZXJSZWdpc3RyeS5qcycpKSB7XHJcbiAgICAgICAgICBjb25zdCBidWlsZFBhdGggPSByZXF1ZXN0LnJlcGxhY2UoL3NyY1tcXFxcXFwvXWVsZWN0cm9uLywgJ2J1aWxkL2VsZWN0cm9uJylcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoL3NyY1xcXFxlbGVjdHJvbi8sICdidWlsZFxcXFxlbGVjdHJvbicpO1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYOKaoO+4jyBbTW9kdWxlUmVkaXJlY3RdIENvbnZlcnRlclJlZ2lzdHJ5LmpzIHNwZWNpYWwgaGFuZGxpbmc6ICR7YnVpbGRQYXRofWApO1xyXG4gICAgICAgICAgbW9kaWZpZWRSZXF1ZXN0ID0gYnVpbGRQYXRoO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ2FsbCB0aGUgb3JpZ2luYWwgcmVzb2x2ZXIgd2l0aCBvdXIgcG9zc2libHkgbW9kaWZpZWQgcGF0aFxyXG4gICAgICAgIHJldHVybiBvcmlnaW5hbFJlc29sdmVGaWxlbmFtZS5jYWxsKHRoaXMsIG1vZGlmaWVkUmVxdWVzdCwgcGFyZW50LCBpc01haW4sIG9wdGlvbnMpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFtNb2R1bGVSZWRpcmVjdF0gRXJyb3IgaW4gcmVzb2x2ZXIgb3ZlcnJpZGU6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAvLyBGYWxsIGJhY2sgdG8gb3JpZ2luYWwgYmVoYXZpb3JcclxuICAgICAgICByZXR1cm4gb3JpZ2luYWxSZXNvbHZlRmlsZW5hbWUuY2FsbCh0aGlzLCByZXF1ZXN0LCBwYXJlbnQsIGlzTWFpbiwgb3B0aW9ucyk7XHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgY29uc29sZS5sb2coJ/CflKcgW01vZHVsZVJlZGlyZWN0XSBOb2RlLmpzIG1vZHVsZSByZXNvbHV0aW9uIG92ZXJyaWRlIGluc3RhbGxlZCcpO1xyXG4gIH1cclxufSBjYXRjaCAoZXJyb3IpIHtcclxuICBjb25zb2xlLndhcm4oJ+KaoO+4jyBbTW9kdWxlUmVkaXJlY3RdIEZhaWxlZCB0byBpbnN0YWxsIG1vZHVsZSByZXNvbHV0aW9uIG92ZXJyaWRlOicsIGVycm9yLm1lc3NhZ2UpO1xyXG59XHJcblxyXG5jb25zdCB7IGFwcCwgQnJvd3NlcldpbmRvdywgcHJvdG9jb2wgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IHVybCA9IHJlcXVpcmUoJ3VybCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbmNvbnN0IHsgUGF0aFV0aWxzIH0gPSByZXF1aXJlKCcuL3V0aWxzL3BhdGhzJyk7XHJcbmNvbnN0IGxvZ2dlciA9IHJlcXVpcmUoJy4vdXRpbHMvbG9nZ2VyJyk7XHJcbmNvbnN0IEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UgPSByZXF1aXJlKCcuL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UnKTtcclxuY29uc3QgeyBjcmVhdGVNYWNNZW51IH0gPSByZXF1aXJlKCcuL2ZlYXR1cmVzL21lbnUnKTtcclxuY29uc3QgeyBzZXR1cEJhc2ljSGFuZGxlcnMsIHNldHVwV2luZG93SGFuZGxlcnMsIGNsZWFudXBXaW5kb3dIYW5kbGVycyB9ID0gcmVxdWlyZSgnLi9pcGMvaGFuZGxlcnMnKTtcclxuY29uc3QgVHJheU1hbmFnZXIgPSByZXF1aXJlKCcuL2ZlYXR1cmVzL3RyYXknKTtcclxuY29uc3QgTm90aWZpY2F0aW9uTWFuYWdlciA9IHJlcXVpcmUoJy4vZmVhdHVyZXMvbm90aWZpY2F0aW9ucycpO1xyXG5jb25zdCBVcGRhdGVNYW5hZ2VyID0gcmVxdWlyZSgnLi9mZWF0dXJlcy91cGRhdGVyJyk7XHJcbmNvbnN0IHsgY3JlYXRlU3RvcmUgfSA9IHJlcXVpcmUoJy4vdXRpbHMvc3RvcmVGYWN0b3J5Jyk7XHJcbmNvbnN0IEFwaUtleVNlcnZpY2UgPSByZXF1aXJlKCcuL3NlcnZpY2VzL0FwaUtleVNlcnZpY2UnKTsgLy8gSW1wb3J0IEFwaUtleVNlcnZpY2VcclxuLy8gQ3JlYXRlIHNldHRpbmdzIHN0b3JlIGZvciByZXRyaWV2aW5nIERlZXBncmFtIEFQSSBrZXlcclxuY29uc3Qgc2V0dGluZ3NTdG9yZSA9IGNyZWF0ZVN0b3JlKCdzZXR0aW5ncycpO1xyXG5cclxuLy8gS2VlcCBhIGdsb2JhbCByZWZlcmVuY2Ugb2Ygb2JqZWN0c1xyXG5sZXQgbWFpbldpbmRvdztcclxubGV0IGFwcEluaXRpYWxpemVkID0gZmFsc2U7XHJcbmxldCB0cmF5TWFuYWdlciA9IG51bGw7XHJcbmxldCBub3RpZmljYXRpb25NYW5hZ2VyID0gbnVsbDtcclxubGV0IHVwZGF0ZU1hbmFnZXIgPSBudWxsO1xyXG5sZXQgbG9nZ2VySW5pdGlhbGl6ZWQgPSBmYWxzZTtcclxuXHJcbi8qKlxyXG4gKiBMb2FkIEFQSSBrZXlzIGFuZCBzZXQgdGhlbSBhcyBlbnZpcm9ubWVudCB2YXJpYWJsZXNcclxuICogVGhpcyBlbnN1cmVzIEFQSSBrZXlzIGFyZSBhdmFpbGFibGUgdG8gY29udmVydGVycyB0aGF0IG5lZWQgdGhlbVxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gbG9hZEFwaUtleXNUb0Vudmlyb25tZW50KCkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zb2xlLmxvZygnTG9hZGluZyBBUEkga2V5cyB0byBlbnZpcm9ubWVudCB2YXJpYWJsZXMuLi4nKTtcclxuXHJcbiAgICAvLyBHZXQgQVBJIGtleXMgZnJvbSBBcGlLZXlTZXJ2aWNlXHJcbiAgICBjb25zdCBtaXN0cmFsQXBpS2V5ID0gQXBpS2V5U2VydmljZS5nZXRBcGlLZXkoJ21pc3RyYWwnKTtcclxuICAgIGNvbnN0IGRlZXBncmFtQXBpS2V5ID0gQXBpS2V5U2VydmljZS5nZXRBcGlLZXkoJ2RlZXBncmFtJyk7XHJcblxyXG4gICAgLy8gU2V0IEFQSSBrZXlzIGFzIGVudmlyb25tZW50IHZhcmlhYmxlc1xyXG4gICAgaWYgKG1pc3RyYWxBcGlLZXkpIHtcclxuICAgICAgcHJvY2Vzcy5lbnYuTUlTVFJBTF9BUElfS0VZID0gbWlzdHJhbEFwaUtleTtcclxuICAgICAgY29uc29sZS5sb2coJ+KchSBNaXN0cmFsIEFQSSBrZXkgbG9hZGVkIGludG8gZW52aXJvbm1lbnQnKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfimqDvuI8gTm8gTWlzdHJhbCBBUEkga2V5IGZvdW5kIGluIHN0b3JlJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGRlZXBncmFtQXBpS2V5KSB7XHJcbiAgICAgIHByb2Nlc3MuZW52LkRFRVBHUkFNX0FQSV9LRVkgPSBkZWVwZ3JhbUFwaUtleTtcclxuICAgICAgY29uc29sZS5sb2coJ+KchSBEZWVwZ3JhbSBBUEkga2V5IGxvYWRlZCBpbnRvIGVudmlyb25tZW50Jyk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBjb25zb2xlLmxvZygn4pqg77iPIE5vIERlZXBncmFtIEFQSSBrZXkgZm91bmQgaW4gc3RvcmUnKTtcclxuICAgIH1cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBsb2FkIEFQSSBrZXlzOicsIGVycm9yKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEluaXRpYWxpemUgdHJheSBzdG9yZVxyXG5jb25zdCB0cmF5U3RvcmUgPSBjcmVhdGVTdG9yZSgndHJheS1tYW5hZ2VyJywge1xyXG4gICAgZW5jcnlwdGlvbktleTogcHJvY2Vzcy5lbnYuU1RPUkVfRU5DUllQVElPTl9LRVlcclxufSk7XHJcblxyXG4vKipcclxuICogSW5pdGlhbGl6ZSBsb2dnZXJcclxuICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgbG9nZ2VyIHdhcyBzdWNjZXNzZnVsbHkgaW5pdGlhbGl6ZWRcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGluaXRpYWxpemVMb2dnZXIoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IGxvZ2dlci5pbml0aWFsaXplKCk7XHJcbiAgICAgICAgbG9nZ2VySW5pdGlhbGl6ZWQgPSB0cnVlO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgTG9nZ2VyIGluaXRpYWxpemVkJyk7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBsb2dnZXI6JywgZXJyb3IpO1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIFNldHVwIG5vdGlmaWNhdGlvbnMgd2l0aCBlcnJvciBoYW5kbGluZ1xyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gc2V0dXBOb3RpZmljYXRpb25zKCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBub3RpZmljYXRpb25NYW5hZ2VyID0gbmV3IE5vdGlmaWNhdGlvbk1hbmFnZXIoKTtcclxuICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZygnTm90aWZpY2F0aW9ucyBpbml0aWFsaXplZCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIE5vdGlmaWNhdGlvbnMgaW5pdGlhbGl6ZWQnKTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcignRmFpbGVkIHRvIHNldHVwIG5vdGlmaWNhdGlvbnMnLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gc2V0dXAgbm90aWZpY2F0aW9uczonLCBlcnJvcik7XHJcbiAgICAgICAgbm90aWZpY2F0aW9uTWFuYWdlciA9IG51bGw7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogU2V0dXAgc3lzdGVtIHRyYXkgd2l0aCBlcnJvciBoYW5kbGluZ1xyXG4gKi9cclxuZnVuY3Rpb24gc2V0dXBUcmF5KCkge1xyXG4gICAgaWYgKCFtYWluV2luZG93KSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCfimqDvuI8gQ2Fubm90IHNldHVwIHRyYXkgd2l0aG91dCBtYWluIHdpbmRvdycpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICAgIHRyYXlNYW5hZ2VyID0gbmV3IFRyYXlNYW5hZ2VyKG1haW5XaW5kb3csIHRyYXlTdG9yZSk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBUcmF5IGluaXRpYWxpemVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGNyZWF0ZSB0cmF5OicsIGVycm9yKTtcclxuICAgICAgICAvLyBOb24tZmF0YWwgZXJyb3IsIGNvbnRpbnVlIGV4ZWN1dGlvblxyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogQ3JlYXRlIGFuZCBzZXR1cCB3aW5kb3cgd2l0aCBlcnJvciBoYW5kbGluZ1xyXG4gKiBAcmV0dXJucyB7RWxlY3Ryb24uQnJvd3NlcldpbmRvd3xudWxsfSBUaGUgY3JlYXRlZCB3aW5kb3cgb3IgbnVsbCBpZiBmYWlsZWRcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUFuZFNldHVwV2luZG93KCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zb2xlLmxvZygnQ3JlYXRpbmcgbWFpbiB3aW5kb3cuLi4nKTtcclxuICAgICAgICBjb25zdCB3aW5kb3cgPSBhd2FpdCBjcmVhdGVNYWluV2luZG93KCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCF3aW5kb3cpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIFdpbmRvdyBjcmVhdGlvbiBmYWlsZWQ6IHdpbmRvdyBpcyBudWxsJyk7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBjb25zb2xlLmxvZygnV2luZG93IGNyZWF0ZWQgc3VjY2Vzc2Z1bGx5LCB3YWl0aW5nIGZvciBpbml0aWFsaXphdGlvbi4uLicpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFdhaXQgYSBtb21lbnQgZm9yIHRoZSB3aW5kb3cgdG8gaW5pdGlhbGl6ZSBmdWxseVxyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDAwKSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc29sZS5sb2coJ1NldHRpbmcgdXAgd2luZG93IGhhbmRsZXJzLi4uJyk7XHJcbiAgICAgICAgLy8gU2V0dXAgd2luZG93IGhhbmRsZXJzXHJcbiAgICAgICAgYXdhaXQgc2V0dXBXaW5kb3dIYW5kbGVycyh3aW5kb3cpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgV2luZG93IGhhbmRsZXJzIHJlZ2lzdGVyZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHdpbmRvdztcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBjcmVhdGUgYW5kIHNldHVwIHdpbmRvdzonLCBlcnJvcik7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBJbml0aWFsaXplIGNvcmUgYXBwbGljYXRpb24gc2VydmljZXMgYW5kIGhhbmRsZXJzXHJcbiAqIE11c3QgY29tcGxldGUgYmVmb3JlIHdpbmRvdyBjcmVhdGlvblxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZUFwcCgpIHtcclxuICB0cnkge1xyXG4gICAgLy8gSW5pdGlhbGl6ZSBBUEkgS2V5IFNlcnZpY2UgZWFybHlcclxuICAgIGNvbnN0IGFwaUtleVNlcnZpY2VJbnN0YW5jZSA9IEFwaUtleVNlcnZpY2U7IC8vIEFzc3VtaW5nIHNpbmdsZXRvbiBleHBvcnRcclxuICAgIC8vIFRyeSB0byBjb25maWd1cmUgRGVlcGdyYW0gb24gc3RhcnR1cCBpZiBrZXkgZXhpc3RzXHJcbiAgICBjb25zdCBkZWVwZ3JhbUFwaUtleSA9IHNldHRpbmdzU3RvcmUuZ2V0KCd0cmFuc2NyaXB0aW9uLmRlZXBncmFtQXBpS2V5Jyk7XHJcbiAgICBpZiAoZGVlcGdyYW1BcGlLZXkpIHtcclxuICAgICAgY29uc29sZS5sb2coJ1tTdGFydHVwXSBGb3VuZCBzdG9yZWQgRGVlcGdyYW0gQVBJIGtleSwgYXR0ZW1wdGluZyB0byBjb25maWd1cmUgRGVlcGdyYW1TZXJ2aWNlLi4uJyk7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gSW1wb3J0IHRoZSBEZWVwZ3JhbVNlcnZpY2VcclxuICAgICAgICBjb25zdCBkZWVwZ3JhbVNlcnZpY2UgPSByZXF1aXJlKCcuL3NlcnZpY2VzL2FpL0RlZXBncmFtU2VydmljZScpO1xyXG4gICAgICAgIC8vIENvbmZpZ3VyZSB3aXRoIHRoZSBBUEkga2V5XHJcbiAgICAgICAgY29uc3QgY29uZmlnUmVzdWx0ID0gYXdhaXQgZGVlcGdyYW1TZXJ2aWNlLmhhbmRsZUNvbmZpZ3VyZShudWxsLCB7IGFwaUtleTogZGVlcGdyYW1BcGlLZXkgfSk7XHJcbiAgICAgICAgaWYgKGNvbmZpZ1Jlc3VsdC5zdWNjZXNzKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZygnW1N0YXJ0dXBdIERlZXBncmFtU2VydmljZSBjb25maWd1cmVkIHN1Y2Nlc3NmdWxseSBvbiBzdGFydHVwLicpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oJ1tTdGFydHVwXSBEZWVwZ3JhbVNlcnZpY2UgY29uZmlndXJhdGlvbiBmYWlsZWQgb24gc3RhcnR1cC4nKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gY2F0Y2ggKGNvbmZpZ0Vycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignW1N0YXJ0dXBdIEVycm9yIGNvbmZpZ3VyaW5nIERlZXBncmFtU2VydmljZSBvbiBzdGFydHVwOicsIGNvbmZpZ0Vycm9yKTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc29sZS5sb2coJ1tTdGFydHVwXSBObyBzdG9yZWQgRGVlcGdyYW0gQVBJIGtleSBmb3VuZC4nKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBJbml0aWFsaXplIHVwZGF0ZSBtYW5hZ2VyXHJcbiAgICB1cGRhdGVNYW5hZ2VyID0gbmV3IFVwZGF0ZU1hbmFnZXIoKTtcclxuICAgICAgICB1cGRhdGVNYW5hZ2VyLmluaXRpYWxpemUoKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIFVwZGF0ZSBtYW5hZ2VyIGluaXRpYWxpemVkJyk7XHJcblxyXG4gICAgICAgIC8vIFNldHVwIGJhc2ljIElQQyBoYW5kbGVycyBmaXJzdFxyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5OhIFJlZ2lzdGVyaW5nIGJhc2ljIElQQyBoYW5kbGVycy4uLicpO1xyXG4gICAgICAgIHNldHVwQmFzaWNIYW5kbGVycyhhcHApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgQmFzaWMgSVBDIGhhbmRsZXJzIHJlZ2lzdGVyZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcblxyXG4gICAgICAgIC8vIEluaXRpYWxpemUgY29yZSBzZXJ2aWNlc1xyXG4gICAgICAgIGF3YWl0IEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2Uuc2V0dXBPdXRwdXREaXJlY3RvcnkoKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIENvbnZlcnNpb24gc2VydmljZSBpbml0aWFsaXplZCcpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFNldHVwIG5vdGlmaWNhdGlvbnMgKG5vbi1mYXRhbCBpZiBpdCBmYWlscylcclxuICAgICAgICBpZiAoIXNldHVwTm90aWZpY2F0aW9ucygpKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybign4pqg77iPIE5vdGlmaWNhdGlvbnMgdW5hdmFpbGFibGUgLSBjb250aW51aW5nIHdpdGhvdXQgbm90aWZpY2F0aW9ucycpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgYXBwSW5pdGlhbGl6ZWQgPSB0cnVlO1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGluaXRpYWxpemUgYXBwOicsIGVycm9yKTtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDcmVhdGUgdGhlIG1haW4gYXBwbGljYXRpb24gd2luZG93XHJcbiAqIE9ubHkgY2FsbGVkIGFmdGVyIGluaXRpYWxpemF0aW9uIGlzIGNvbXBsZXRlXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVNYWluV2luZG93KCkge1xyXG4gICAgaWYgKCFhcHBJbml0aWFsaXplZCkge1xyXG4gICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCdDYW5ub3QgY3JlYXRlIHdpbmRvdyBiZWZvcmUgYXBwIGluaXRpYWxpemF0aW9uJyk7XHJcbiAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcignV2luZG93IGNyZWF0aW9uIGVycm9yJywgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICBhd2FpdCBsb2dnZXIubG9nKCdDcmVhdGluZyBtYWluIHdpbmRvdycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIExvZyBhcHAgcGF0aHMgZm9yIGRlYnVnZ2luZ1xyXG4gICAgICAgIGNvbnN0IGFwcFBhdGhzID0ge1xyXG4gICAgICAgICAgICBhcHBQYXRoOiBhcHAuZ2V0QXBwUGF0aCgpLFxyXG4gICAgICAgICAgICBhcHBEYXRhOiBhcHAuZ2V0UGF0aCgnYXBwRGF0YScpLFxyXG4gICAgICAgICAgICB1c2VyRGF0YTogYXBwLmdldFBhdGgoJ3VzZXJEYXRhJyksXHJcbiAgICAgICAgICAgIGV4ZTogYXBwLmdldFBhdGgoJ2V4ZScpLFxyXG4gICAgICAgICAgICBtb2R1bGU6IGFwcC5nZXRQYXRoKCdtb2R1bGUnKSxcclxuICAgICAgICAgICAgY3dkOiBwcm9jZXNzLmN3ZCgpLFxyXG4gICAgICAgICAgICByZXNvdXJjZXNQYXRoOiBwcm9jZXNzLnJlc291cmNlc1BhdGggfHwgJ3VuZGVmaW5lZCdcclxuICAgICAgICB9O1xyXG4gICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnQXBwbGljYXRpb24gcGF0aHMnLCBhcHBQYXRocyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2V0IHBsYXRmb3JtLXNwZWNpZmljIGljb24gcGF0aFxyXG4gICAgY29uc3QgaWNvblBhdGggPSBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChcclxuICAgICAgICBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50J1xyXG4gICAgICAgICAgICA/IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9mcm9udGVuZC9zdGF0aWMvbG9nby5wbmcnKVxyXG4gICAgICAgICAgICA6IHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAnZnJvbnRlbmQvc3RhdGljL2xvZ28ucG5nJylcclxuICAgICk7XHJcbiAgICBcclxuICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnSWNvbiBwYXRoJywgeyBpY29uUGF0aCB9KTtcclxuXHJcbiAgICAgICAgLy8gVmVyaWZ5IGljb24gZXhpc3RzXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgaWNvbkV4aXN0cyA9IGF3YWl0IGZzLnBhdGhFeGlzdHMoaWNvblBhdGgpO1xyXG4gICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0ljb24gZmlsZSBjaGVjaycsIHsgZXhpc3RzOiBpY29uRXhpc3RzLCBwYXRoOiBpY29uUGF0aCB9KTtcclxuICAgICAgICAgICAgaWYgKCFpY29uRXhpc3RzKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIud2FybihgSWNvbiBmaWxlIGRvZXMgbm90IGV4aXN0OiAke2ljb25QYXRofWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKCdFcnJvciBjaGVja2luZyBpY29uIGZpbGUnLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIENvbmZpZ3VyZSB3aW5kb3cgZm9yIHBsYXRmb3JtXHJcbiAgICBjb25zdCB3aW5kb3dDb25maWcgPSB7XHJcbiAgICAgICAgd2lkdGg6IDEyMDAsXHJcbiAgICAgICAgaGVpZ2h0OiA4MDAsXHJcbiAgICAgICAgbWluV2lkdGg6IDgwMCxcclxuICAgICAgICBtaW5IZWlnaHQ6IDYwMCxcclxuICAgICAgICBpY29uOiBpY29uUGF0aCxcclxuICAgICAgICB3ZWJQcmVmZXJlbmNlczoge1xyXG4gICAgICAgICAgICBub2RlSW50ZWdyYXRpb246IGZhbHNlLFxyXG4gICAgICAgICAgICBjb250ZXh0SXNvbGF0aW9uOiB0cnVlLFxyXG4gICAgICAgICAgICBwcmVsb2FkOiBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChwYXRoLmpvaW4oX19kaXJuYW1lLCAncHJlbG9hZC5qcycpKVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgc2hvdzogZmFsc2UgLy8gRG9uJ3Qgc2hvdyB0aGUgd2luZG93IHVudGlsIGl0J3MgcmVhZHlcclxuICAgIH07XHJcblxyXG4gICAgLy8gUGxhdGZvcm0tc3BlY2lmaWMgd2luZG93IHNldHRpbmdzXHJcbiAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2RhcndpbicpIHtcclxuICAgICAgICB3aW5kb3dDb25maWcudGl0bGVCYXJTdHlsZSA9ICdoaWRkZW5JbnNldCc7XHJcbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicpIHtcclxuICAgICAgICB3aW5kb3dDb25maWcuZnJhbWUgPSB0cnVlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICBhd2FpdCBsb2dnZXIubG9nV2luZG93Q3JlYXRpb24od2luZG93Q29uZmlnKTtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICAgIG1haW5XaW5kb3cgPSBuZXcgQnJvd3NlcldpbmRvdyh3aW5kb3dDb25maWcpO1xyXG4gICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nKCdCcm93c2VyV2luZG93IGNyZWF0ZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gY3JlYXRlIEJyb3dzZXJXaW5kb3cnLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBTaG93IHdpbmRvdyB3aGVuIGl0J3MgcmVhZHkgdG8gYXZvaWQgd2hpdGUgZmxhc2hcclxuICAgIG1haW5XaW5kb3cub25jZSgncmVhZHktdG8tc2hvdycsICgpID0+IHtcclxuICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgbG9nZ2VyLmxvZygnV2luZG93IHJlYWR5IHRvIHNob3cgZXZlbnQgZmlyZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgbWFpbldpbmRvdy5zaG93KCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMb2FkIHRoZSBhcHBcclxuICAgIGlmIChwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50Jykge1xyXG4gICAgICAgIC8vIERldiBtb2RlIC0gbG9hZCBmcm9tIGRldiBzZXJ2ZXJcclxuICAgICAgICBtYWluV2luZG93LmxvYWRVUkwoJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3MycpO1xyXG4gICAgICAgIC8vIG1haW5XaW5kb3cud2ViQ29udGVudHMub3BlbkRldlRvb2xzKCk7IC8vIENvbW1lbnRlZCBvdXQgdG8gcHJldmVudCBhdXRvLW9wZW5pbmdcclxuICAgIH0gZWxzZSB7ICAgICAgICAvLyBQcm9kdWN0aW9uIC0gbG9hZCBsb2NhbCBmaWxlcyB1c2luZyBwbGF0Zm9ybS1zYWZlIHBhdGhzXHJcbiAgICAgICAgY29uc3QgYXBwUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKFxyXG4gICAgICAgICAgICBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50J1xyXG4gICAgICAgICAgICAgICAgPyBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vZnJvbnRlbmQvZGlzdC9pbmRleC5odG1sJylcclxuICAgICAgICAgICAgICAgIDogcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdmcm9udGVuZC9kaXN0L2luZGV4Lmh0bWwnKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gTG9nIHRoZSBwYXRoIGJlaW5nIGxvYWRlZFxyXG4gICAgICAgIGNvbnNvbGUubG9nKCdMb2FkaW5nIGFwcCBmcm9tIHBhdGg6JywgYXBwUGF0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gVXNlIGZpbGU6Ly8gcHJvdG9jb2wgZm9yIGxvYWRpbmcgdGhlIG1haW4gSFRNTCBmaWxlXHJcbiAgICAgICAgLy8gVGhpcyBpcyB0aGUgc3RhbmRhcmQgYXBwcm9hY2ggZm9yIEVsZWN0cm9uIGFwcHNcclxuICAgICAgICBtYWluV2luZG93LmxvYWRVUkwoXHJcbiAgICAgICAgICAgIHVybC5mb3JtYXQoe1xyXG4gICAgICAgICAgICAgICAgcGF0aG5hbWU6IGFwcFBhdGgsXHJcbiAgICAgICAgICAgICAgICBwcm90b2NvbDogJ2ZpbGU6JyxcclxuICAgICAgICAgICAgICAgIHNsYXNoZXM6IHRydWVcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIExvZyBhbnkgcGFnZSBsb2FkIGVycm9yc1xyXG4gICAgICAgIG1haW5XaW5kb3cud2ViQ29udGVudHMub24oJ2RpZC1mYWlsLWxvYWQnLCAoZXZlbnQsIGVycm9yQ29kZSwgZXJyb3JEZXNjcmlwdGlvbikgPT4ge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gbG9hZCBhcHA6JywgZXJyb3JDb2RlLCBlcnJvckRlc2NyaXB0aW9uKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEF0dGVtcHQgdG8gcmVsb2FkIHdpdGggYSBzbGlnaHQgZGVsYXkgYXMgYSBmYWxsYmFja1xyXG4gICAgICAgICAgICBpZiAoZXJyb3JDb2RlICE9PSAtMykgeyAvLyBJZ25vcmUgYWJvcnRlZCBsb2Fkc1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0F0dGVtcHRpbmcgZmFsbGJhY2sgbG9hZCBhZnRlciBkZWxheS4uLicpO1xyXG4gICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFpbldpbmRvdy5sb2FkVVJMKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmwuZm9ybWF0KHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGhuYW1lOiBhcHBQYXRoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvdG9jb2w6ICdmaWxlOicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzbGFzaGVzOiB0cnVlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICAgIH0sIDEwMDApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gU2V0IHBsYXRmb3JtLXNwZWNpZmljIGFwcGxpY2F0aW9uIG1lbnVcclxuICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xyXG4gICAgICAgIGNyZWF0ZU1hY01lbnUoKTtcclxuICAgICAgICAvLyBNYWtlIG1haW5XaW5kb3cgYXZhaWxhYmxlIGdsb2JhbGx5IGZvciBtZW51IGFjdGlvbnNcclxuICAgICAgICBnbG9iYWwubWFpbldpbmRvdyA9IG1haW5XaW5kb3c7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIEZvciBXaW5kb3dzIGFuZCBMaW51eCwgdXNlIGEgc2ltcGxlciBtZW51IG9yIGRlZmF1bHRcclxuICAgICAgICBjb25zdCB7IE1lbnUgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbiAgICAgICAgTWVudS5zZXRBcHBsaWNhdGlvbk1lbnUoTWVudS5idWlsZEZyb21UZW1wbGF0ZShbXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIGxhYmVsOiAnRmlsZScsXHJcbiAgICAgICAgICAgICAgICBzdWJtZW51OiBbXHJcbiAgICAgICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ05ldyBDb252ZXJzaW9uJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYWNjZWxlcmF0b3I6ICdDbWRPckN0cmwrTicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsaWNrOiAoKSA9PiBtYWluV2luZG93Py53ZWJDb250ZW50cy5zZW5kKCdtZW51Om5ldy1jb252ZXJzaW9uJylcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHsgdHlwZTogJ3NlcGFyYXRvcicgfSxcclxuICAgICAgICAgICAgICAgICAgICB7IHJvbGU6ICdxdWl0JyB9XHJcbiAgICAgICAgICAgICAgICBdXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIGxhYmVsOiAnVmlldycsXHJcbiAgICAgICAgICAgICAgICBzdWJtZW51OiBbXHJcbiAgICAgICAgICAgICAgICAgICAgeyByb2xlOiAncmVsb2FkJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHsgcm9sZTogJ3RvZ2dsZURldlRvb2xzJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHsgdHlwZTogJ3NlcGFyYXRvcicgfSxcclxuICAgICAgICAgICAgICAgICAgICB7IHJvbGU6ICd0b2dnbGVmdWxsc2NyZWVuJyB9XHJcbiAgICAgICAgICAgICAgICBdXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBdKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gV2luZG93IGV2ZW50IGhhbmRsZXJzXHJcbiAgICBtYWluV2luZG93Lm9uKCdjbG9zZWQnLCAoKSA9PiB7XHJcbiAgICAgICAgbWFpbldpbmRvdyA9IG51bGw7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBOb3RpZnkgcmVuZGVyZXIgcHJvY2VzcyB0aGF0IGFwcCBpcyByZWFkeVxyXG4gICAgbWFpbldpbmRvdy53ZWJDb250ZW50cy5vbignZGlkLWZpbmlzaC1sb2FkJywgKCkgPT4ge1xyXG4gICAgICAgIG1haW5XaW5kb3cud2ViQ29udGVudHMuc2VuZCgnYXBwOnJlYWR5JywgdHJ1ZSk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBTZW50IGFwcDpyZWFkeSBldmVudCB0byByZW5kZXJlcicpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIG1haW5XaW5kb3c7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBSZWdpc3RlciBtZWRpYSBwcm90b2NvbCBoYW5kbGVyIHdpdGggbG9nZ2luZ1xyXG4gKi9cclxuZnVuY3Rpb24gcmVnaXN0ZXJNZWRpYVByb3RvY29sKCkge1xyXG4gICAgcHJvdG9jb2wucmVnaXN0ZXJGaWxlUHJvdG9jb2woJ21lZGlhJywgYXN5bmMgKHJlcXVlc3QsIGNhbGxiYWNrKSA9PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgZmlsZVBhdGggPSByZXF1ZXN0LnVybC5yZXBsYWNlKCdtZWRpYTovLycsICcnKTtcclxuICAgICAgICAgICAgY29uc3Qgc2FmZVBhdGggPSBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChkZWNvZGVVUkkoZmlsZVBhdGgpKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZyhgTWVkaWEgcHJvdG9jb2wgc2VydmluZzogJHtzYWZlUGF0aH1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnTWVkaWEgcHJvdG9jb2wgc2VydmluZzonLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgIGNhbGxiYWNrKHNhZmVQYXRoKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcihgTWVkaWEgcHJvdG9jb2wgaGFuZGxlciBlcnJvcjogJHtyZXF1ZXN0LnVybH1gLCBlcnJvcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gbWVkaWEgcHJvdG9jb2wgaGFuZGxlcjonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIGNhbGxiYWNrKHsgZXJyb3I6IC0yIH0pO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICBsb2dnZXIubG9nKCdNZWRpYSBwcm90b2NvbCBoYW5kbGVyIHJlZ2lzdGVyZWQnKTtcclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIFJlZ2lzdGVyIGVuaGFuY2VkIGZpbGUgcHJvdG9jb2wgaGFuZGxlciB3aXRoIGxvZ2dpbmdcclxuICovXHJcbmZ1bmN0aW9uIHJlZ2lzdGVyRmlsZVByb3RvY29sKCkge1xyXG4gICAgcHJvdG9jb2wucmVnaXN0ZXJGaWxlUHJvdG9jb2woJ2ZpbGUnLCBhc3luYyAocmVxdWVzdCwgY2FsbGJhY2spID0+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBsZXQgZmlsZVBhdGggPSByZXF1ZXN0LnVybC5yZXBsYWNlKCdmaWxlOi8vJywgJycpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0ZpbGUgcHJvdG9jb2wgcmVxdWVzdCcsIHsgdXJsOiByZXF1ZXN0LnVybCwgZmlsZVBhdGggfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ0ZpbGUgcHJvdG9jb2wgcmVxdWVzdDonLCBmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBXaW5kb3dzIGFic29sdXRlIHBhdGhzIHdpdGggZHJpdmUgbGV0dGVyc1xyXG4gICAgICAgICAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJyAmJiBmaWxlUGF0aC5tYXRjaCgvXlxcL1tBLVphLXpdOlxcLy8pKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBSZW1vdmUgdGhlIGxlYWRpbmcgc2xhc2ggYmVmb3JlIHRoZSBkcml2ZSBsZXR0ZXJcclxuICAgICAgICAgICAgICAgIGZpbGVQYXRoID0gZmlsZVBhdGgucmVwbGFjZSgvXlxcLyhbQS1aYS16XTpcXC8uKj8pJC8sICckMScpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ05vcm1hbGl6ZWQgV2luZG93cyBwYXRoJywgeyBmaWxlUGF0aCB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdOb3JtYWxpemVkIFdpbmRvd3MgcGF0aDonLCBmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFNwZWNpYWwgY2FzZSBmb3IgaW5kZXguaHRtbCB0byBhdm9pZCBTdmVsdGVLaXQgcm91dGluZyBpc3N1ZXNcclxuICAgICAgICAgICAgaWYgKGZpbGVQYXRoLmVuZHNXaXRoKCdpbmRleC5odG1sJykgfHwgZmlsZVBhdGguZW5kc1dpdGgoJ1xcXFxpbmRleC5odG1sJykpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGluZGV4UGF0aCA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnXHJcbiAgICAgICAgICAgICAgICAgICAgPyBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vZnJvbnRlbmQvZGlzdC9pbmRleC5odG1sJylcclxuICAgICAgICAgICAgICAgICAgICA6IHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAnZnJvbnRlbmQvZGlzdC9pbmRleC5odG1sJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zdCBzYWZlUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKGRlY29kZVVSSShpbmRleFBhdGgpKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZ0Fzc2V0TG9hZGluZygnaW5kZXguaHRtbCcsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBmaWxlIGV4aXN0c1xyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGV4aXN0cyA9IGF3YWl0IGZzLnBhdGhFeGlzdHMoc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0luZGV4IGZpbGUgZXhpc3RzIGNoZWNrJywgeyBleGlzdHMsIHBhdGg6IHNhZmVQYXRoIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFleGlzdHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIExpc3QgYWx0ZXJuYXRpdmUgcGF0aHMgdG8gY2hlY2tcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFsdGVybmF0aXZlUGF0aHMgPSBbXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdmcm9udGVuZC9kaXN0L2luZGV4Lmh0bWwnKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4ocHJvY2Vzcy5yZXNvdXJjZXNQYXRoIHx8ICcnLCAnZnJvbnRlbmQvZGlzdC9pbmRleC5odG1sJyksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKGFwcC5nZXRQYXRoKCdleGUnKSwgJy4uL3Jlc291cmNlcy9mcm9udGVuZC9kaXN0L2luZGV4Lmh0bWwnKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdBbHRlcm5hdGl2ZSBpbmRleC5odG1sIHBhdGhzJywgeyBhbHRlcm5hdGl2ZVBhdGhzIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBlYWNoIGFsdGVybmF0aXZlIHBhdGhcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgYWx0UGF0aCBvZiBhbHRlcm5hdGl2ZVBhdGhzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWx0RXhpc3RzID0gYXdhaXQgZnMucGF0aEV4aXN0cyhhbHRQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdBbHRlcm5hdGl2ZSBwYXRoIGV4aXN0cycsIHsgcGF0aDogYWx0UGF0aCwgZXhpc3RzOiBhbHRFeGlzdHMgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcihgRXJyb3IgY2hlY2tpbmcgYWx0ZXJuYXRpdmUgcGF0aDogJHthbHRQYXRofWAsIGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBMaXN0IGRpc3QgZGlyZWN0b3J5IGNvbnRlbnRzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpc3REaXIgPSBwYXRoLmRpcm5hbWUoc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhd2FpdCBmcy5wYXRoRXhpc3RzKGRpc3REaXIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZpbGVzID0gYXdhaXQgZnMucmVhZGRpcihkaXN0RGlyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdEaXN0IGRpcmVjdG9yeSBjb250ZW50cycsIHsgZGlyZWN0b3J5OiBkaXN0RGlyLCBmaWxlcyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoJ0Vycm9yIHJlYWRpbmcgZGlzdCBkaXJlY3RvcnknLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcignRXJyb3IgY2hlY2tpbmcgaW5kZXguaHRtbCBleGlzdGVuY2UnLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NlcnZpbmcgaW5kZXguaHRtbCBmcm9tOicsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gSGFuZGxlIHN0YXRpYyBhc3NldHMgZnJvbSBmcm9udGVuZC9zdGF0aWNcclxuICAgICAgICAgICAgaWYgKGZpbGVQYXRoLmluY2x1ZGVzKCcvc3RhdGljLycpIHx8IGZpbGVQYXRoLmluY2x1ZGVzKCdcXFxcc3RhdGljXFxcXCcpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0aWNGaWxlID0gcGF0aC5iYXNlbmFtZShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0aWNQYXRoID0gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCdcclxuICAgICAgICAgICAgICAgICAgICA/IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9mcm9udGVuZC9zdGF0aWMnLCBzdGF0aWNGaWxlKVxyXG4gICAgICAgICAgICAgICAgICAgIDogcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdmcm9udGVuZC9zdGF0aWMnLCBzdGF0aWNGaWxlKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNhZmVQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoZGVjb2RlVVJJKHN0YXRpY1BhdGgpKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZ0Fzc2V0TG9hZGluZyhmaWxlUGF0aCwgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIGZpbGUgZXhpc3RzXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXhpc3RzID0gYXdhaXQgZnMucGF0aEV4aXN0cyhzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnU3RhdGljIGFzc2V0IGV4aXN0cyBjaGVjaycsIHsgZXhpc3RzLCBwYXRoOiBzYWZlUGF0aCB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZXhpc3RzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBUcnkgZmFsbGJhY2sgbG9jYXRpb25zXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhbHRQYXRocyA9IFtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ3Jlc291cmNlcy9zdGF0aWMnLCBzdGF0aWNGaWxlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ3Jlc291cmNlcy9mcm9udGVuZC9kaXN0L3N0YXRpYycsIHN0YXRpY0ZpbGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihwcm9jZXNzLnJlc291cmNlc1BhdGggfHwgJycsICdzdGF0aWMnLCBzdGF0aWNGaWxlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4ocHJvY2Vzcy5yZXNvdXJjZXNQYXRoIHx8ICcnLCAnZnJvbnRlbmQvZGlzdC9zdGF0aWMnLCBzdGF0aWNGaWxlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4oYXBwLmdldFBhdGgoJ2V4ZScpLCAnLi4vcmVzb3VyY2VzL3N0YXRpYycsIHN0YXRpY0ZpbGUpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0FsdGVybmF0aXZlIHN0YXRpYyBhc3NldCBwYXRocycsIHsgZmlsZTogc3RhdGljRmlsZSwgcGF0aHM6IGFsdFBhdGhzIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBlYWNoIGFsdGVybmF0aXZlIHBhdGhcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgYWx0UGF0aCBvZiBhbHRQYXRocykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFsdEV4aXN0cyA9IGF3YWl0IGZzLnBhdGhFeGlzdHMoYWx0UGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnQWx0ZXJuYXRpdmUgcGF0aCBleGlzdHMnLCB7IHBhdGg6IGFsdFBhdGgsIGV4aXN0czogYWx0RXhpc3RzIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFsdEV4aXN0cykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZyhgRm91bmQgYWx0ZXJuYXRpdmUgcGF0aCBmb3IgJHtzdGF0aWNGaWxlfTogJHthbHRQYXRofWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2soYWx0UGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKGBFcnJvciBjaGVja2luZyBhbHRlcm5hdGl2ZSBwYXRoOiAke2FsdFBhdGh9YCwgZXJyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKGBFcnJvciBjaGVja2luZyBleGlzdGVuY2Ugb2Ygc3RhdGljIGFzc2V0OiAke3N0YXRpY0ZpbGV9YCwgZXJyKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTZXJ2aW5nIHN0YXRpYyBhc3NldCBmcm9tOicsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gSGFuZGxlIFZpdGUvU3ZlbHRlIGFzc2V0c1xyXG4gICAgICAgICAgICBpZiAoZmlsZVBhdGguaW5jbHVkZXMoJy9hc3NldHMvJykgfHwgZmlsZVBhdGguaW5jbHVkZXMoJ1xcXFxhc3NldHNcXFxcJykpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGFzc2V0RmlsZSA9IGZpbGVQYXRoLnN1YnN0cmluZyhmaWxlUGF0aC5sYXN0SW5kZXhPZignLycpICsgMSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBhc3NldFBhdGggPSBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50J1xyXG4gICAgICAgICAgICAgICAgICAgID8gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Zyb250ZW5kL2Rpc3QvYXNzZXRzJywgYXNzZXRGaWxlKVxyXG4gICAgICAgICAgICAgICAgICAgIDogcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdmcm9udGVuZC9kaXN0L2Fzc2V0cycsIGFzc2V0RmlsZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zdCBzYWZlUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKGRlY29kZVVSSShhc3NldFBhdGgpKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZ0Fzc2V0TG9hZGluZyhmaWxlUGF0aCwgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIGZpbGUgZXhpc3RzXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXhpc3RzID0gYXdhaXQgZnMucGF0aEV4aXN0cyhzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnQXNzZXQgZXhpc3RzIGNoZWNrJywgeyBleGlzdHMsIHBhdGg6IHNhZmVQYXRoIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFleGlzdHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyeSBmYWxsYmFjayBsb2NhdGlvbnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFsdFBhdGhzID0gW1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAnZnJvbnRlbmQvZGlzdC9hc3NldHMnLCBhc3NldEZpbGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAncmVzb3VyY2VzL2Zyb250ZW5kL2Rpc3QvYXNzZXRzJywgYXNzZXRGaWxlKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4ocHJvY2Vzcy5yZXNvdXJjZXNQYXRoIHx8ICcnLCAnZnJvbnRlbmQvZGlzdC9hc3NldHMnLCBhc3NldEZpbGUpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0FsdGVybmF0aXZlIGFzc2V0IHBhdGhzJywgeyBmaWxlOiBhc3NldEZpbGUsIHBhdGhzOiBhbHRQYXRocyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoYEVycm9yIGNoZWNraW5nIGV4aXN0ZW5jZSBvZiBhc3NldDogJHthc3NldEZpbGV9YCwgZXJyKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTZXJ2aW5nIFZpdGUgYXNzZXQgZnJvbTonLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICBjYWxsYmFjayhzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFNwZWNpYWwgY2FzZSBmb3IgZGlyZWN0IGZpbGUgcmVxdWVzdHMgd2l0aCBubyBwYXRoIChqdXN0IGEgZmlsZW5hbWUpXHJcbiAgICAgICAgICAgIGlmICghZmlsZVBhdGguaW5jbHVkZXMoJy8nKSAmJiAhZmlsZVBhdGguaW5jbHVkZXMoJ1xcXFwnKSAmJiBmaWxlUGF0aC5pbmNsdWRlcygnLicpKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nKCdEZXRlY3RlZCBkaXJlY3QgZmlsZSByZXF1ZXN0IHdpdGggbm8gcGF0aCcpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0RldGVjdGVkIGRpcmVjdCBmaWxlIHJlcXVlc3Qgd2l0aCBubyBwYXRoJyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFRyeSB0byBmaW5kIHRoZSBmaWxlIGluIHRoZSBkaXN0IGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgY29uc3QgZGlzdFBhdGggPSBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50J1xyXG4gICAgICAgICAgICAgICAgICAgID8gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Zyb250ZW5kL2Rpc3QnLCBmaWxlUGF0aClcclxuICAgICAgICAgICAgICAgICAgICA6IHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAnZnJvbnRlbmQvZGlzdCcsIGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNhZmVQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoZGVjb2RlVVJJKGRpc3RQYXRoKSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2dBc3NldExvYWRpbmcoZmlsZVBhdGgsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NlcnZpbmcgZGlyZWN0IGZpbGUgZnJvbSBkaXN0OicsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gSGFuZGxlIG90aGVyIGZpbGU6Ly8gcmVxdWVzdHMgbm9ybWFsbHlcclxuICAgICAgICAgICAgY29uc3Qgc2FmZVBhdGggPSBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChkZWNvZGVVUkkoZmlsZVBhdGgpKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZ0Fzc2V0TG9hZGluZyhmaWxlUGF0aCwgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnU2VydmluZyBzdGFuZGFyZCBmaWxlIGZyb206Jywgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICBjYWxsYmFjayhzYWZlUGF0aCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nUHJvdG9jb2xFcnJvcihyZXF1ZXN0LnVybCwgZXJyb3IpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBmaWxlIHByb3RvY29sIGhhbmRsZXI6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICBjYWxsYmFjayh7IGVycm9yOiAtMiB9KTsgLy8gRmFpbGVkIHRvIGxvYWRcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgbG9nZ2VyLmxvZygnRmlsZSBwcm90b2NvbCBoYW5kbGVyIHJlZ2lzdGVyZWQnKTtcclxuICAgIH1cclxufVxyXG5cclxuLy8gRGlyZWN0IGNvbnNvbGUgb3V0cHV0IGZvciBkZWJ1Z2dpbmdcclxuY29uc29sZS5sb2coJz09PT09PSBFTEVDVFJPTiBBUFAgU1RBUlRJTkcgPT09PT09Jyk7XHJcbmNvbnNvbGUubG9nKCdXb3JraW5nIGRpcmVjdG9yeTonLCBwcm9jZXNzLmN3ZCgpKTtcclxuY29uc29sZS5sb2coJ0FwcCBwYXRoOicsIGFwcC5nZXRBcHBQYXRoKCkpO1xyXG5jb25zb2xlLmxvZygnUmVzb3VyY2UgcGF0aDonLCBwcm9jZXNzLnJlc291cmNlc1BhdGgpO1xyXG5jb25zb2xlLmxvZygnRXhlY3V0YWJsZSBwYXRoOicsIHByb2Nlc3MuZXhlY1BhdGgpO1xyXG5jb25zb2xlLmxvZygnTk9ERV9FTlY6JywgcHJvY2Vzcy5lbnYuTk9ERV9FTlYpO1xyXG5jb25zb2xlLmxvZygnPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09Jyk7XHJcblxyXG4vLyBBcHAgc3RhcnR1cCBzZXF1ZW5jZVxyXG5hcHAud2hlblJlYWR5KCkudGhlbihhc3luYyAoKSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdBcHAgcmVhZHkgZXZlbnQgZmlyZWQnKTtcclxuXHJcbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBsb2dnZXIgZmlyc3QgdGhpbmdcclxuICAgICAgICBhd2FpdCBpbml0aWFsaXplTG9nZ2VyKCk7XHJcbiAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZ1N0YXJ0dXAoKTtcclxuXHJcbiAgICAgICAgLy8gTG9hZCBBUEkga2V5cyBmcm9tIHN0b3JlIGludG8gZW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbiAgICAgICAgYXdhaXQgbG9hZEFwaUtleXNUb0Vudmlyb25tZW50KCk7XHJcblxyXG4gICAgICAgIC8vIFJlZ2lzdGVyIHByb3RvY29sIGhhbmRsZXJzXHJcbiAgICAgICAgY29uc29sZS5sb2coJ1JlZ2lzdGVyaW5nIHByb3RvY29sIGhhbmRsZXJzJyk7XHJcbiAgICAgICAgcmVnaXN0ZXJNZWRpYVByb3RvY29sKCk7XHJcbiAgICAgICAgcmVnaXN0ZXJGaWxlUHJvdG9jb2woKTtcclxuXHJcbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBhcHAgYmVmb3JlIGNyZWF0aW5nIHdpbmRvd1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5qAIFN0YXJ0aW5nIGFwcCBpbml0aWFsaXphdGlvbi4uLicpO1xyXG4gICAgICAgIGNvbnN0IHN1Y2Nlc3MgPSBhd2FpdCBpbml0aWFsaXplQXBwKCk7XHJcbiAgICAgICAgaWYgKCFzdWNjZXNzKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBBcHAgaW5pdGlhbGl6YXRpb24gZmFpbGVkJyk7XHJcbiAgICAgICAgICAgIGFwcC5xdWl0KCk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIENyZWF0ZSBhbmQgc2V0dXAgd2luZG93XHJcbiAgICAgICAgbWFpbldpbmRvdyA9IGF3YWl0IGNyZWF0ZUFuZFNldHVwV2luZG93KCk7XHJcbiAgICAgICAgaWYgKCFtYWluV2luZG93KSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gY3JlYXRlIG1haW4gd2luZG93Jyk7XHJcbiAgICAgICAgICAgIGFwcC5xdWl0KCk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFNldHVwIHRyYXkgYWZ0ZXIgd2luZG93IGNyZWF0aW9uXHJcbiAgICAgICAgc2V0dXBUcmF5KCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBNYWluIHdpbmRvdyBjcmVhdGVkIGFuZCBpbml0aWFsaXplZCcpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgQ3JpdGljYWwgc3RhcnR1cCBlcnJvcjonLCBlcnJvcik7XHJcbiAgICAgICAgYXBwLnF1aXQoKTtcclxuICAgIH1cclxufSk7XHJcblxyXG4vLyBIYW5kbGUgbWFjT1MgYWN0aXZhdGlvblxyXG5hcHAub24oJ2FjdGl2YXRlJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgaWYgKG1haW5XaW5kb3cgPT09IG51bGwgJiYgYXBwSW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAvLyBDcmVhdGUgYW5kIHNldHVwIG5ldyB3aW5kb3dcclxuICAgICAgICBtYWluV2luZG93ID0gYXdhaXQgY3JlYXRlQW5kU2V0dXBXaW5kb3coKTtcclxuICAgICAgICBpZiAoIW1haW5XaW5kb3cpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byByZXN0b3JlIHdpbmRvdyBvbiBhY3RpdmF0ZScpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFJlLXNldHVwIHRyYXkgd2l0aCBuZXcgd2luZG93XHJcbiAgICAgICAgc2V0dXBUcmF5KCk7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuLy8gSGFuZGxlIHdpbmRvdyBjbG9zZVxyXG5hcHAub24oJ3dpbmRvdy1hbGwtY2xvc2VkJywgKCkgPT4ge1xyXG4gICAgLy8gQ2xlYW4gdXAgd2luZG93LXNwZWNpZmljIGhhbmRsZXJzXHJcbiAgICBpZiAodHlwZW9mIGNsZWFudXBXaW5kb3dIYW5kbGVycyA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgIGNsZWFudXBXaW5kb3dIYW5kbGVycygpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENsZWFuIHVwIHRyYXlcclxuICAgIGlmICh0cmF5TWFuYWdlcikge1xyXG4gICAgICAgIHRyYXlNYW5hZ2VyLmRlc3Ryb3koKTtcclxuICAgICAgICB0cmF5TWFuYWdlciA9IG51bGw7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFF1aXQgZm9yIG5vbi1tYWNPUyBwbGF0Zm9ybXNcclxuICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtICE9PSAnZGFyd2luJykge1xyXG4gICAgICAgIGFwcC5xdWl0KCk7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuLy8gQ2xlYW4gdXAgb24gcXVpdFxyXG5hcHAub24oJ3dpbGwtcXVpdCcsICgpID0+IHtcclxuICAgIGlmICh0cmF5TWFuYWdlcikge1xyXG4gICAgICAgIHRyYXlNYW5hZ2VyLmRlc3Ryb3koKTtcclxuICAgICAgICB0cmF5TWFuYWdlciA9IG51bGw7XHJcbiAgICB9XHJcbiAgICBub3RpZmljYXRpb25NYW5hZ2VyID0gbnVsbDtcclxuICAgIHVwZGF0ZU1hbmFnZXIgPSBudWxsO1xyXG59KTtcclxuXHJcbi8vIEhhbmRsZSBmYXRhbCBlcnJvcnNcclxucHJvY2Vzcy5vbigndW5jYXVnaHRFeGNlcHRpb24nLCBhc3luYyAoZXJyb3IpID0+IHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBVbmNhdWdodCBleGNlcHRpb246JywgZXJyb3IpO1xyXG4gICAgXHJcbiAgICAvLyBMb2cgdG8gZmlsZSBpZiBsb2dnZXIgaXMgaW5pdGlhbGl6ZWRcclxuICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcignVW5jYXVnaHQgZXhjZXB0aW9uJywgZXJyb3IpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGxvZ0Vycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gbG9nIHVuY2F1Z2h0IGV4Y2VwdGlvbjonLCBsb2dFcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBUcnkgdG8gc2VuZCB0byByZW5kZXJlclxyXG4gICAgaWYgKG1haW5XaW5kb3c/LndlYkNvbnRlbnRzKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgbWFpbldpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdhcHA6ZXJyb3InLCBlcnJvci5tZXNzYWdlKTtcclxuICAgICAgICB9IGNhdGNoIChzZW5kRXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBzZW5kIGVycm9yIHRvIHdpbmRvdzonLCBzZW5kRXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufSk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQUEsT0FBTyxDQUFDQyxHQUFHLENBQUMsb0RBQW9EQyxPQUFPLENBQUNDLFFBQVEsQ0FBQ0MsSUFBSSxFQUFFLENBQUM7QUFDeEY7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBSTtFQUNGO0VBQ0EsTUFBTUMsTUFBTSxHQUFHQyxPQUFPLENBQUMsUUFBUSxDQUFDO0VBQ2hDLE1BQU1DLHVCQUF1QixHQUFHRixNQUFNLENBQUNHLGdCQUFnQjs7RUFFdkQ7RUFDQSxNQUFNQyxZQUFZLEdBQUc7SUFDbkI7SUFDQSx3Q0FBd0MsRUFBRSwwQ0FBMEM7SUFDcEYsbUNBQW1DLEVBQUU7RUFDdkMsQ0FBQzs7RUFFRDtFQUNBLElBQUksQ0FBQ0osTUFB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