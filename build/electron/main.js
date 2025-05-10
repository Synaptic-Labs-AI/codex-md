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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjb25zb2xlIiwibG9nIiwicHJvY2VzcyIsInZlcnNpb25zIiwibm9kZSIsIk1vZHVsZSIsInJlcXVpcmUiLCJvcmlnaW5hbFJlc29sdmVGaWxlbmFtZSIsIl9yZXNvbHZlRmlsZW5hbWUiLCJwYXRoTWFwcGluZ3MiLCJfb3JpZ2luYWxSZXNvbHZlRmlsZW5hbWUiLCJyZXF1ZXN0IiwicGFyZW50IiwiaXNNYWluIiwib3B0aW9ucyIsIm1vZGlmaWVkUmVxdWVzdCIsInBhdHRlcm4iLCJyZXBsYWNlbWVudCIsIk9iamVjdCIsImVudHJpZXMiLCJpbmNsdWRlcyIsIm5ld1BhdGgiLCJyZXBsYWNlIiwiYnVpbGRQYXRoIiwiY2FsbCIsImVycm9yIiwid2FybiIsIm1lc3NhZ2UiLCJhcHAiLCJCcm93c2VyV2luZG93IiwicHJvdG9jb2wiLCJwYXRoIiwidXJsIiwiZnMiLCJQYXRoVXRpbHMiLCJsb2dnZXIiLCJFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIiwiY3JlYXRlTWFjTWVudSIsInNldHVwQmFzaWNIYW5kbGVycyIsInNldHVwV2luZG93SGFuZGxlcnMiLCJjbGVhbnVwV2luZG93SGFuZGxlcnMiLCJUcmF5TWFuYWdlciIsIk5vdGlmaWNhdGlvbk1hbmFnZXIiLCJVcGRhdGVNYW5hZ2VyIiwiY3JlYXRlU3RvcmUiLCJBcGlLZXlTZXJ2aWNlIiwic2V0dGluZ3NTdG9yZSIsIm1haW5XaW5kb3ciLCJhcHBJbml0aWFsaXplZCIsInRyYXlNYW5hZ2VyIiwibm90aWZpY2F0aW9uTWFuYWdlciIsInVwZGF0ZU1hbmFnZXIiLCJsb2dnZXJJbml0aWFsaXplZCIsInRyYXlTdG9yZSIsImVuY3J5cHRpb25LZXkiLCJlbnYiLCJTVE9SRV9FTkNSWVBUSU9OX0tFWSIsImluaXRpYWxpemVMb2dnZXIiLCJpbml0aWFsaXplIiwic2V0dXBOb3RpZmljYXRpb25zIiwic2V0dXBUcmF5IiwiY3JlYXRlQW5kU2V0dXBXaW5kb3ciLCJ3aW5kb3ciLCJjcmVhdGVNYWluV2luZG93IiwiUHJvbWlzZSIsInJlc29sdmUiLCJzZXRUaW1lb3V0IiwiaW5pdGlhbGl6ZUFwcCIsImFwaUtleVNlcnZpY2VJbnN0YW5jZSIsImRlZXBncmFtQXBpS2V5IiwiZ2V0IiwiZGVlcGdyYW1TZXJ2aWNlIiwiY29uZmlnUmVzdWx0IiwiaGFuZGxlQ29uZmlndXJlIiwiYXBpS2V5Iiwic3VjY2VzcyIsImNvbmZpZ0Vycm9yIiwic2V0dXBPdXRwdXREaXJlY3RvcnkiLCJFcnJvciIsImFwcFBhdGhzIiwiYXBwUGF0aCIsImdldEFwcFBhdGgiLCJhcHBEYXRhIiwiZ2V0UGF0aCIsInVzZXJEYXRhIiwiZXhlIiwibW9kdWxlIiwiY3dkIiwicmVzb3VyY2VzUGF0aCIsImRlYnVnIiwiaWNvblBhdGgiLCJub3JtYWxpemVQYXRoIiwiTk9ERV9FTlYiLCJqb2luIiwiX19kaXJuYW1lIiwiaWNvbkV4aXN0cyIsInBhdGhFeGlzdHMiLCJleGlzdHMiLCJ3aW5kb3dDb25maWciLCJ3aWR0aCIsImhlaWdodCIsIm1pbldpZHRoIiwibWluSGVpZ2h0IiwiaWNvbiIsIndlYlByZWZlcmVuY2VzIiwibm9kZUludGVncmF0aW9uIiwiY29udGV4dElzb2xhdGlvbiIsInByZWxvYWQiLCJzaG93IiwicGxhdGZvcm0iLCJ0aXRsZUJhclN0eWxlIiwiZnJhbWUiLCJsb2dXaW5kb3dDcmVhdGlvbiIsIm9uY2UiLCJsb2FkVVJMIiwid2ViQ29udGVudHMiLCJvcGVuRGV2VG9vbHMiLCJmb3JtYXQiLCJwYXRobmFtZSIsInNsYXNoZXMiLCJvbiIsImV2ZW50IiwiZXJyb3JDb2RlIiwiZXJyb3JEZXNjcmlwdGlvbiIsImdsb2JhbCIsIk1lbnUiLCJzZXRBcHBsaWNhdGlvbk1lbnUiLCJidWlsZEZyb21UZW1wbGF0ZSIsImxhYmVsIiwic3VibWVudSIsImFjY2VsZXJhdG9yIiwiY2xpY2siLCJzZW5kIiwidHlwZSIsInJvbGUiLCJyZWdpc3Rlck1lZGlhUHJvdG9jb2wiLCJyZWdpc3RlckZpbGVQcm90b2NvbCIsImNhbGxiYWNrIiwiZmlsZVBhdGgiLCJzYWZlUGF0aCIsImRlY29kZVVSSSIsIm1hdGNoIiwiZW5kc1dpdGgiLCJpbmRleFBhdGgiLCJsb2dBc3NldExvYWRpbmciLCJhbHRlcm5hdGl2ZVBhdGhzIiwiYWx0UGF0aCIsImFsdEV4aXN0cyIsImVyciIsImRpc3REaXIiLCJkaXJuYW1lIiwiZmlsZXMiLCJyZWFkZGlyIiwiZGlyZWN0b3J5Iiwic3RhdGljRmlsZSIsImJhc2VuYW1lIiwic3RhdGljUGF0aCIsImFsdFBhdGhzIiwiZmlsZSIsInBhdGhzIiwiYXNzZXRGaWxlIiwic3Vic3RyaW5nIiwibGFzdEluZGV4T2YiLCJhc3NldFBhdGgiLCJkaXN0UGF0aCIsImxvZ1Byb3RvY29sRXJyb3IiLCJleGVjUGF0aCIsIndoZW5SZWFkeSIsInRoZW4iLCJsb2dTdGFydHVwIiwicXVpdCIsImRlc3Ryb3kiLCJsb2dFcnJvciIsInNlbmRFcnJvciJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9lbGVjdHJvbi9tYWluLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImNvbnNvbGUubG9nKGBbREVCVUddIFJ1bm5pbmcgTm9kZS5qcyB2ZXJzaW9uIGluIG1haW4gcHJvY2VzczogJHtwcm9jZXNzLnZlcnNpb25zLm5vZGV9YCk7XHJcbi8qKlxyXG4gKiBFbGVjdHJvbiBNYWluIFByb2Nlc3NcclxuICogRW50cnkgcG9pbnQgZm9yIHRoZSBFbGVjdHJvbiBhcHBsaWNhdGlvbi5cclxuICpcclxuICogSGFuZGxlczpcclxuICogLSBXaW5kb3cgbWFuYWdlbWVudFxyXG4gKiAtIElQQyBjb21tdW5pY2F0aW9uIHNldHVwXHJcbiAqIC0gUHJvdG9jb2wgcmVnaXN0cmF0aW9uXHJcbiAqIC0gQXBwIGxpZmVjeWNsZVxyXG4gKi9cclxuXHJcbi8qKlxyXG4gKiBNT0RVTEUgUkVTT0xVVElPTiBGSVg6XHJcbiAqIFRoaXMgcGF0Y2ggaW50ZXJjZXB0cyBOb2RlLmpzIG1vZHVsZSBsb2FkaW5nIHRvIGZpeCBwYXRoIHJlc29sdXRpb24gaXNzdWVzIGluIHBhY2thZ2VkIGFwcHMuXHJcbiAqIEl0IGVuc3VyZXMgXCJzcmNcIiBwYXRocyBjb3JyZWN0bHkgcmVzb2x2ZSB0byBcImJ1aWxkXCIgcGF0aHMgZm9yIGNvbXBpbGVkIGNvZGUuXHJcbiAqIFNwZWNpZmljYWxseSBmaXhlcyB0aGUgQ29udmVydGVyUmVnaXN0cnkuanMgbW9kdWxlIGxvYWRpbmcgaW4gdGhlIFBERiBjb252ZXJ0ZXIuXHJcbiAqL1xyXG50cnkge1xyXG4gIC8vIEFjY2VzcyB0aGUgTm9kZS5qcyBtb2R1bGUgc3lzdGVtXHJcbiAgY29uc3QgTW9kdWxlID0gcmVxdWlyZSgnbW9kdWxlJyk7XHJcbiAgY29uc3Qgb3JpZ2luYWxSZXNvbHZlRmlsZW5hbWUgPSBNb2R1bGUuX3Jlc29sdmVGaWxlbmFtZTtcclxuXHJcbiAgLy8gQ3JlYXRlIHBhdGggbWFwcGluZ3MgZm9yIHRoZSByZXNvbHZlclxyXG4gIGNvbnN0IHBhdGhNYXBwaW5ncyA9IHtcclxuICAgIC8vIE1hcCBzcGVjaWZpYyBzcmMgcGF0aHMgdG8gYnVpbGQgcGF0aHNcclxuICAgICdcXFxccmVzb3VyY2VzXFxcXGFwcC5hc2FyXFxcXHNyY1xcXFxlbGVjdHJvblxcXFwnOiAnXFxcXHJlc291cmNlc1xcXFxhcHAuYXNhclxcXFxidWlsZFxcXFxlbGVjdHJvblxcXFwnLFxyXG4gICAgJy9yZXNvdXJjZXMvYXBwLmFzYXIvc3JjL2VsZWN0cm9uLyc6ICcvcmVzb3VyY2VzL2FwcC5hc2FyL2J1aWxkL2VsZWN0cm9uLycsXHJcbiAgfTtcclxuXHJcbiAgLy8gT25seSBpbnN0YWxsIHRoZSBvdmVycmlkZSBvbmNlXHJcbiAgaWYgKCFNb2R1bGUuX29yaWdpbmFsUmVzb2x2ZUZpbGVuYW1lKSB7XHJcbiAgICAvLyBTdG9yZSB0aGUgb3JpZ2luYWwgZm9yIHJlc3RvcmF0aW9uIGlmIG5lZWRlZFxyXG4gICAgTW9kdWxlLl9vcmlnaW5hbFJlc29sdmVGaWxlbmFtZSA9IG9yaWdpbmFsUmVzb2x2ZUZpbGVuYW1lO1xyXG5cclxuICAgIC8vIFJlcGxhY2Ugd2l0aCBvdXIgcGF0Y2hlZCB2ZXJzaW9uXHJcbiAgICBNb2R1bGUuX3Jlc29sdmVGaWxlbmFtZSA9IGZ1bmN0aW9uKHJlcXVlc3QsIHBhcmVudCwgaXNNYWluLCBvcHRpb25zKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHJlcXVlc3QgbWF0Y2hlcyBhbnkgb2Ygb3VyIHByb2JsZW1hdGljIHBhdHRlcm5zXHJcbiAgICAgICAgbGV0IG1vZGlmaWVkUmVxdWVzdCA9IHJlcXVlc3Q7XHJcblxyXG4gICAgICAgIC8vIEFwcGx5IHBhdHRlcm4gcmVwbGFjZW1lbnRzXHJcbiAgICAgICAgZm9yIChjb25zdCBbcGF0dGVybiwgcmVwbGFjZW1lbnRdIG9mIE9iamVjdC5lbnRyaWVzKHBhdGhNYXBwaW5ncykpIHtcclxuICAgICAgICAgIGlmICh0eXBlb2YgcmVxdWVzdCA9PT0gJ3N0cmluZycgJiYgcmVxdWVzdC5pbmNsdWRlcyhwYXR0ZXJuKSkge1xyXG4gICAgICAgICAgICBjb25zdCBuZXdQYXRoID0gcmVxdWVzdC5yZXBsYWNlKHBhdHRlcm4sIHJlcGxhY2VtZW50KTtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYPCflIQgW01vZHVsZVJlZGlyZWN0XSAke3JlcXVlc3R9IC0+ICR7bmV3UGF0aH1gKTtcclxuICAgICAgICAgICAgbW9kaWZpZWRSZXF1ZXN0ID0gbmV3UGF0aDtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBDb252ZXJ0ZXJSZWdpc3RyeS5qc1xyXG4gICAgICAgIGlmICh0eXBlb2YgcmVxdWVzdCA9PT0gJ3N0cmluZycgJiZcclxuICAgICAgICAgICAgcmVxdWVzdC5pbmNsdWRlcygnc3JjJykgJiZcclxuICAgICAgICAgICAgcmVxdWVzdC5pbmNsdWRlcygnQ29udmVydGVyUmVnaXN0cnkuanMnKSkge1xyXG4gICAgICAgICAgY29uc3QgYnVpbGRQYXRoID0gcmVxdWVzdC5yZXBsYWNlKC9zcmNbXFxcXFxcL11lbGVjdHJvbi8sICdidWlsZC9lbGVjdHJvbicpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC9zcmNcXFxcZWxlY3Ryb24vLCAnYnVpbGRcXFxcZWxlY3Ryb24nKTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGDimqDvuI8gW01vZHVsZVJlZGlyZWN0XSBDb252ZXJ0ZXJSZWdpc3RyeS5qcyBzcGVjaWFsIGhhbmRsaW5nOiAke2J1aWxkUGF0aH1gKTtcclxuICAgICAgICAgIG1vZGlmaWVkUmVxdWVzdCA9IGJ1aWxkUGF0aDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIENhbGwgdGhlIG9yaWdpbmFsIHJlc29sdmVyIHdpdGggb3VyIHBvc3NpYmx5IG1vZGlmaWVkIHBhdGhcclxuICAgICAgICByZXR1cm4gb3JpZ2luYWxSZXNvbHZlRmlsZW5hbWUuY2FsbCh0aGlzLCBtb2RpZmllZFJlcXVlc3QsIHBhcmVudCwgaXNNYWluLCBvcHRpb25zKTtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbTW9kdWxlUmVkaXJlY3RdIEVycm9yIGluIHJlc29sdmVyIG92ZXJyaWRlOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgLy8gRmFsbCBiYWNrIHRvIG9yaWdpbmFsIGJlaGF2aW9yXHJcbiAgICAgICAgcmV0dXJuIG9yaWdpbmFsUmVzb2x2ZUZpbGVuYW1lLmNhbGwodGhpcywgcmVxdWVzdCwgcGFyZW50LCBpc01haW4sIG9wdGlvbnMpO1xyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnNvbGUubG9nKCfwn5SnIFtNb2R1bGVSZWRpcmVjdF0gTm9kZS5qcyBtb2R1bGUgcmVzb2x1dGlvbiBvdmVycmlkZSBpbnN0YWxsZWQnKTtcclxuICB9XHJcbn0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgY29uc29sZS53YXJuKCfimqDvuI8gW01vZHVsZVJlZGlyZWN0XSBGYWlsZWQgdG8gaW5zdGFsbCBtb2R1bGUgcmVzb2x1dGlvbiBvdmVycmlkZTonLCBlcnJvci5tZXNzYWdlKTtcclxufVxyXG5cclxuY29uc3QgeyBhcHAsIEJyb3dzZXJXaW5kb3csIHByb3RvY29sIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB1cmwgPSByZXF1aXJlKCd1cmwnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCB7IFBhdGhVdGlscyB9ID0gcmVxdWlyZSgnLi91dGlscy9wYXRocycpO1xyXG5jb25zdCBsb2dnZXIgPSByZXF1aXJlKCcuL3V0aWxzL2xvZ2dlcicpO1xyXG5jb25zdCBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlID0gcmVxdWlyZSgnLi9zZXJ2aWNlcy9FbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlJyk7XHJcbmNvbnN0IHsgY3JlYXRlTWFjTWVudSB9ID0gcmVxdWlyZSgnLi9mZWF0dXJlcy9tZW51Jyk7XHJcbmNvbnN0IHsgc2V0dXBCYXNpY0hhbmRsZXJzLCBzZXR1cFdpbmRvd0hhbmRsZXJzLCBjbGVhbnVwV2luZG93SGFuZGxlcnMgfSA9IHJlcXVpcmUoJy4vaXBjL2hhbmRsZXJzJyk7XHJcbmNvbnN0IFRyYXlNYW5hZ2VyID0gcmVxdWlyZSgnLi9mZWF0dXJlcy90cmF5Jyk7XHJcbmNvbnN0IE5vdGlmaWNhdGlvbk1hbmFnZXIgPSByZXF1aXJlKCcuL2ZlYXR1cmVzL25vdGlmaWNhdGlvbnMnKTtcclxuY29uc3QgVXBkYXRlTWFuYWdlciA9IHJlcXVpcmUoJy4vZmVhdHVyZXMvdXBkYXRlcicpO1xyXG5jb25zdCB7IGNyZWF0ZVN0b3JlIH0gPSByZXF1aXJlKCcuL3V0aWxzL3N0b3JlRmFjdG9yeScpO1xyXG5jb25zdCBBcGlLZXlTZXJ2aWNlID0gcmVxdWlyZSgnLi9zZXJ2aWNlcy9BcGlLZXlTZXJ2aWNlJyk7IC8vIEltcG9ydCBBcGlLZXlTZXJ2aWNlXHJcbi8vIENyZWF0ZSBzZXR0aW5ncyBzdG9yZSBmb3IgcmV0cmlldmluZyBEZWVwZ3JhbSBBUEkga2V5XHJcbmNvbnN0IHNldHRpbmdzU3RvcmUgPSBjcmVhdGVTdG9yZSgnc2V0dGluZ3MnKTtcclxuXHJcbi8vIEtlZXAgYSBnbG9iYWwgcmVmZXJlbmNlIG9mIG9iamVjdHNcclxubGV0IG1haW5XaW5kb3c7XHJcbmxldCBhcHBJbml0aWFsaXplZCA9IGZhbHNlO1xyXG5sZXQgdHJheU1hbmFnZXIgPSBudWxsO1xyXG5sZXQgbm90aWZpY2F0aW9uTWFuYWdlciA9IG51bGw7XHJcbmxldCB1cGRhdGVNYW5hZ2VyID0gbnVsbDtcclxubGV0IGxvZ2dlckluaXRpYWxpemVkID0gZmFsc2U7XHJcblxyXG4vLyBJbml0aWFsaXplIHRyYXkgc3RvcmVcclxuY29uc3QgdHJheVN0b3JlID0gY3JlYXRlU3RvcmUoJ3RyYXktbWFuYWdlcicsIHtcclxuICAgIGVuY3J5cHRpb25LZXk6IHByb2Nlc3MuZW52LlNUT1JFX0VOQ1JZUFRJT05fS0VZXHJcbn0pO1xyXG5cclxuLyoqXHJcbiAqIEluaXRpYWxpemUgbG9nZ2VyXHJcbiAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIGxvZ2dlciB3YXMgc3VjY2Vzc2Z1bGx5IGluaXRpYWxpemVkXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBpbml0aWFsaXplTG9nZ2VyKCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCBsb2dnZXIuaW5pdGlhbGl6ZSgpO1xyXG4gICAgICAgIGxvZ2dlckluaXRpYWxpemVkID0gdHJ1ZTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIExvZ2dlciBpbml0aWFsaXplZCcpO1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGluaXRpYWxpemUgbG9nZ2VyOicsIGVycm9yKTtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBTZXR1cCBub3RpZmljYXRpb25zIHdpdGggZXJyb3IgaGFuZGxpbmdcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIHNldHVwTm90aWZpY2F0aW9ucygpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgbm90aWZpY2F0aW9uTWFuYWdlciA9IG5ldyBOb3RpZmljYXRpb25NYW5hZ2VyKCk7XHJcbiAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2coJ05vdGlmaWNhdGlvbnMgaW5pdGlhbGl6ZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBOb3RpZmljYXRpb25zIGluaXRpYWxpemVkJyk7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBzZXR1cCBub3RpZmljYXRpb25zJywgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIHNldHVwIG5vdGlmaWNhdGlvbnM6JywgZXJyb3IpO1xyXG4gICAgICAgIG5vdGlmaWNhdGlvbk1hbmFnZXIgPSBudWxsO1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIFNldHVwIHN5c3RlbSB0cmF5IHdpdGggZXJyb3IgaGFuZGxpbmdcclxuICovXHJcbmZ1bmN0aW9uIHNldHVwVHJheSgpIHtcclxuICAgIGlmICghbWFpbldpbmRvdykge1xyXG4gICAgICAgIGNvbnNvbGUud2Fybign4pqg77iPIENhbm5vdCBzZXR1cCB0cmF5IHdpdGhvdXQgbWFpbiB3aW5kb3cnKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgICB0cmF5TWFuYWdlciA9IG5ldyBUcmF5TWFuYWdlcihtYWluV2luZG93LCB0cmF5U3RvcmUpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgVHJheSBpbml0aWFsaXplZCBzdWNjZXNzZnVsbHknKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBjcmVhdGUgdHJheTonLCBlcnJvcik7XHJcbiAgICAgICAgLy8gTm9uLWZhdGFsIGVycm9yLCBjb250aW51ZSBleGVjdXRpb25cclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIENyZWF0ZSBhbmQgc2V0dXAgd2luZG93IHdpdGggZXJyb3IgaGFuZGxpbmdcclxuICogQHJldHVybnMge0VsZWN0cm9uLkJyb3dzZXJXaW5kb3d8bnVsbH0gVGhlIGNyZWF0ZWQgd2luZG93IG9yIG51bGwgaWYgZmFpbGVkXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVBbmRTZXR1cFdpbmRvdygpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ0NyZWF0aW5nIG1haW4gd2luZG93Li4uJyk7XHJcbiAgICAgICAgY29uc3Qgd2luZG93ID0gYXdhaXQgY3JlYXRlTWFpbldpbmRvdygpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghd2luZG93KSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBXaW5kb3cgY3JlYXRpb24gZmFpbGVkOiB3aW5kb3cgaXMgbnVsbCcpO1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc29sZS5sb2coJ1dpbmRvdyBjcmVhdGVkIHN1Y2Nlc3NmdWxseSwgd2FpdGluZyBmb3IgaW5pdGlhbGl6YXRpb24uLi4nKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBXYWl0IGEgbW9tZW50IGZvciB0aGUgd2luZG93IHRvIGluaXRpYWxpemUgZnVsbHlcclxuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwMCkpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKCdTZXR0aW5nIHVwIHdpbmRvdyBoYW5kbGVycy4uLicpO1xyXG4gICAgICAgIC8vIFNldHVwIHdpbmRvdyBoYW5kbGVyc1xyXG4gICAgICAgIGF3YWl0IHNldHVwV2luZG93SGFuZGxlcnMod2luZG93KTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIFdpbmRvdyBoYW5kbGVycyByZWdpc3RlcmVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiB3aW5kb3c7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gY3JlYXRlIGFuZCBzZXR1cCB3aW5kb3c6JywgZXJyb3IpO1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogSW5pdGlhbGl6ZSBjb3JlIGFwcGxpY2F0aW9uIHNlcnZpY2VzIGFuZCBoYW5kbGVyc1xyXG4gKiBNdXN0IGNvbXBsZXRlIGJlZm9yZSB3aW5kb3cgY3JlYXRpb25cclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGluaXRpYWxpemVBcHAoKSB7XHJcbiAgdHJ5IHtcclxuICAgIC8vIEluaXRpYWxpemUgQVBJIEtleSBTZXJ2aWNlIGVhcmx5XHJcbiAgICBjb25zdCBhcGlLZXlTZXJ2aWNlSW5zdGFuY2UgPSBBcGlLZXlTZXJ2aWNlOyAvLyBBc3N1bWluZyBzaW5nbGV0b24gZXhwb3J0XHJcbiAgICAvLyBUcnkgdG8gY29uZmlndXJlIERlZXBncmFtIG9uIHN0YXJ0dXAgaWYga2V5IGV4aXN0c1xyXG4gICAgY29uc3QgZGVlcGdyYW1BcGlLZXkgPSBzZXR0aW5nc1N0b3JlLmdldCgndHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleScpO1xyXG4gICAgaWYgKGRlZXBncmFtQXBpS2V5KSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdbU3RhcnR1cF0gRm91bmQgc3RvcmVkIERlZXBncmFtIEFQSSBrZXksIGF0dGVtcHRpbmcgdG8gY29uZmlndXJlIERlZXBncmFtU2VydmljZS4uLicpO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIEltcG9ydCB0aGUgRGVlcGdyYW1TZXJ2aWNlXHJcbiAgICAgICAgY29uc3QgZGVlcGdyYW1TZXJ2aWNlID0gcmVxdWlyZSgnLi9zZXJ2aWNlcy9haS9EZWVwZ3JhbVNlcnZpY2UnKTtcclxuICAgICAgICAvLyBDb25maWd1cmUgd2l0aCB0aGUgQVBJIGtleVxyXG4gICAgICAgIGNvbnN0IGNvbmZpZ1Jlc3VsdCA9IGF3YWl0IGRlZXBncmFtU2VydmljZS5oYW5kbGVDb25maWd1cmUobnVsbCwgeyBhcGlLZXk6IGRlZXBncmFtQXBpS2V5IH0pO1xyXG4gICAgICAgIGlmIChjb25maWdSZXN1bHQuc3VjY2Vzcykge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coJ1tTdGFydHVwXSBEZWVwZ3JhbVNlcnZpY2UgY29uZmlndXJlZCBzdWNjZXNzZnVsbHkgb24gc3RhcnR1cC4nKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKCdbU3RhcnR1cF0gRGVlcGdyYW1TZXJ2aWNlIGNvbmZpZ3VyYXRpb24gZmFpbGVkIG9uIHN0YXJ0dXAuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChjb25maWdFcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tTdGFydHVwXSBFcnJvciBjb25maWd1cmluZyBEZWVwZ3JhbVNlcnZpY2Ugb24gc3RhcnR1cDonLCBjb25maWdFcnJvcik7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdbU3RhcnR1cF0gTm8gc3RvcmVkIERlZXBncmFtIEFQSSBrZXkgZm91bmQuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gSW5pdGlhbGl6ZSB1cGRhdGUgbWFuYWdlclxyXG4gICAgdXBkYXRlTWFuYWdlciA9IG5ldyBVcGRhdGVNYW5hZ2VyKCk7XHJcbiAgICAgICAgdXBkYXRlTWFuYWdlci5pbml0aWFsaXplKCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBVcGRhdGUgbWFuYWdlciBpbml0aWFsaXplZCcpO1xyXG5cclxuICAgICAgICAvLyBTZXR1cCBiYXNpYyBJUEMgaGFuZGxlcnMgZmlyc3RcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+ToSBSZWdpc3RlcmluZyBiYXNpYyBJUEMgaGFuZGxlcnMuLi4nKTtcclxuICAgICAgICBzZXR1cEJhc2ljSGFuZGxlcnMoYXBwKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIEJhc2ljIElQQyBoYW5kbGVycyByZWdpc3RlcmVkIHN1Y2Nlc3NmdWxseScpO1xyXG5cclxuICAgICAgICAvLyBJbml0aWFsaXplIGNvcmUgc2VydmljZXNcclxuICAgICAgICBhd2FpdCBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLnNldHVwT3V0cHV0RGlyZWN0b3J5KCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBDb252ZXJzaW9uIHNlcnZpY2UgaW5pdGlhbGl6ZWQnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBTZXR1cCBub3RpZmljYXRpb25zIChub24tZmF0YWwgaWYgaXQgZmFpbHMpXHJcbiAgICAgICAgaWYgKCFzZXR1cE5vdGlmaWNhdGlvbnMoKSkge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oJ+KaoO+4jyBOb3RpZmljYXRpb25zIHVuYXZhaWxhYmxlIC0gY29udGludWluZyB3aXRob3V0IG5vdGlmaWNhdGlvbnMnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGFwcEluaXRpYWxpemVkID0gdHJ1ZTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBpbml0aWFsaXplIGFwcDonLCBlcnJvcik7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogQ3JlYXRlIHRoZSBtYWluIGFwcGxpY2F0aW9uIHdpbmRvd1xyXG4gKiBPbmx5IGNhbGxlZCBhZnRlciBpbml0aWFsaXphdGlvbiBpcyBjb21wbGV0ZVxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlTWFpbldpbmRvdygpIHtcclxuICAgIGlmICghYXBwSW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignQ2Fubm90IGNyZWF0ZSB3aW5kb3cgYmVmb3JlIGFwcCBpbml0aWFsaXphdGlvbicpO1xyXG4gICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoJ1dpbmRvdyBjcmVhdGlvbiBlcnJvcicsIGVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZygnQ3JlYXRpbmcgbWFpbiB3aW5kb3cnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBMb2cgYXBwIHBhdGhzIGZvciBkZWJ1Z2dpbmdcclxuICAgICAgICBjb25zdCBhcHBQYXRocyA9IHtcclxuICAgICAgICAgICAgYXBwUGF0aDogYXBwLmdldEFwcFBhdGgoKSxcclxuICAgICAgICAgICAgYXBwRGF0YTogYXBwLmdldFBhdGgoJ2FwcERhdGEnKSxcclxuICAgICAgICAgICAgdXNlckRhdGE6IGFwcC5nZXRQYXRoKCd1c2VyRGF0YScpLFxyXG4gICAgICAgICAgICBleGU6IGFwcC5nZXRQYXRoKCdleGUnKSxcclxuICAgICAgICAgICAgbW9kdWxlOiBhcHAuZ2V0UGF0aCgnbW9kdWxlJyksXHJcbiAgICAgICAgICAgIGN3ZDogcHJvY2Vzcy5jd2QoKSxcclxuICAgICAgICAgICAgcmVzb3VyY2VzUGF0aDogcHJvY2Vzcy5yZXNvdXJjZXNQYXRoIHx8ICd1bmRlZmluZWQnXHJcbiAgICAgICAgfTtcclxuICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0FwcGxpY2F0aW9uIHBhdGhzJywgYXBwUGF0aHMpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEdldCBwbGF0Zm9ybS1zcGVjaWZpYyBpY29uIHBhdGhcclxuICAgIGNvbnN0IGljb25QYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoXHJcbiAgICAgICAgcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCdcclxuICAgICAgICAgICAgPyBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vZnJvbnRlbmQvc3RhdGljL2xvZ28ucG5nJylcclxuICAgICAgICAgICAgOiBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ2Zyb250ZW5kL3N0YXRpYy9sb2dvLnBuZycpXHJcbiAgICApO1xyXG4gICAgXHJcbiAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0ljb24gcGF0aCcsIHsgaWNvblBhdGggfSk7XHJcblxyXG4gICAgICAgIC8vIFZlcmlmeSBpY29uIGV4aXN0c1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGljb25FeGlzdHMgPSBhd2FpdCBmcy5wYXRoRXhpc3RzKGljb25QYXRoKTtcclxuICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdJY29uIGZpbGUgY2hlY2snLCB7IGV4aXN0czogaWNvbkV4aXN0cywgcGF0aDogaWNvblBhdGggfSk7XHJcbiAgICAgICAgICAgIGlmICghaWNvbkV4aXN0cykge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLndhcm4oYEljb24gZmlsZSBkb2VzIG5vdCBleGlzdDogJHtpY29uUGF0aH1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcignRXJyb3IgY2hlY2tpbmcgaWNvbiBmaWxlJywgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBDb25maWd1cmUgd2luZG93IGZvciBwbGF0Zm9ybVxyXG4gICAgY29uc3Qgd2luZG93Q29uZmlnID0ge1xyXG4gICAgICAgIHdpZHRoOiAxMjAwLFxyXG4gICAgICAgIGhlaWdodDogODAwLFxyXG4gICAgICAgIG1pbldpZHRoOiA4MDAsXHJcbiAgICAgICAgbWluSGVpZ2h0OiA2MDAsXHJcbiAgICAgICAgaWNvbjogaWNvblBhdGgsXHJcbiAgICAgICAgd2ViUHJlZmVyZW5jZXM6IHtcclxuICAgICAgICAgICAgbm9kZUludGVncmF0aW9uOiBmYWxzZSxcclxuICAgICAgICAgICAgY29udGV4dElzb2xhdGlvbjogdHJ1ZSxcclxuICAgICAgICAgICAgcHJlbG9hZDogUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgocGF0aC5qb2luKF9fZGlybmFtZSwgJ3ByZWxvYWQuanMnKSlcclxuICAgICAgICB9LFxyXG4gICAgICAgIHNob3c6IGZhbHNlIC8vIERvbid0IHNob3cgdGhlIHdpbmRvdyB1bnRpbCBpdCdzIHJlYWR5XHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFBsYXRmb3JtLXNwZWNpZmljIHdpbmRvdyBzZXR0aW5nc1xyXG4gICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XHJcbiAgICAgICAgd2luZG93Q29uZmlnLnRpdGxlQmFyU3R5bGUgPSAnaGlkZGVuSW5zZXQnO1xyXG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XHJcbiAgICAgICAgd2luZG93Q29uZmlnLmZyYW1lID0gdHJ1ZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZ1dpbmRvd0NyZWF0aW9uKHdpbmRvd0NvbmZpZyk7XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgICBtYWluV2luZG93ID0gbmV3IEJyb3dzZXJXaW5kb3cod2luZG93Q29uZmlnKTtcclxuICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZygnQnJvd3NlcldpbmRvdyBjcmVhdGVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgICAgIH1cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcignRmFpbGVkIHRvIGNyZWF0ZSBCcm93c2VyV2luZG93JywgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gU2hvdyB3aW5kb3cgd2hlbiBpdCdzIHJlYWR5IHRvIGF2b2lkIHdoaXRlIGZsYXNoXHJcbiAgICBtYWluV2luZG93Lm9uY2UoJ3JlYWR5LXRvLXNob3cnLCAoKSA9PiB7XHJcbiAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGxvZ2dlci5sb2coJ1dpbmRvdyByZWFkeSB0byBzaG93IGV2ZW50IGZpcmVkJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIG1haW5XaW5kb3cuc2hvdygpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTG9hZCB0aGUgYXBwXHJcbiAgICBpZiAocHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCcpIHtcclxuICAgICAgICAvLyBEZXYgbW9kZSAtIGxvYWQgZnJvbSBkZXYgc2VydmVyXHJcbiAgICAgICAgbWFpbldpbmRvdy5sb2FkVVJMKCdodHRwOi8vbG9jYWxob3N0OjUxNzMnKTtcclxuICAgICAgICBtYWluV2luZG93LndlYkNvbnRlbnRzLm9wZW5EZXZUb29scygpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBQcm9kdWN0aW9uIC0gbG9hZCBsb2NhbCBmaWxlcyB1c2luZyBwbGF0Zm9ybS1zYWZlIHBhdGhzXHJcbiAgICAgICAgY29uc3QgYXBwUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKFxyXG4gICAgICAgICAgICBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50J1xyXG4gICAgICAgICAgICAgICAgPyBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vZnJvbnRlbmQvZGlzdC9pbmRleC5odG1sJylcclxuICAgICAgICAgICAgICAgIDogcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdmcm9udGVuZC9kaXN0L2luZGV4Lmh0bWwnKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gRW5hYmxlIGRldiB0b29scyBpbiBwcm9kdWN0aW9uIGZvciBkZWJ1Z2dpbmcgaWYgbmVlZGVkXHJcbiAgICAgICAgbWFpbldpbmRvdy53ZWJDb250ZW50cy5vcGVuRGV2VG9vbHMoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBMb2cgdGhlIHBhdGggYmVpbmcgbG9hZGVkXHJcbiAgICAgICAgY29uc29sZS5sb2coJ0xvYWRpbmcgYXBwIGZyb20gcGF0aDonLCBhcHBQYXRoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBVc2UgZmlsZTovLyBwcm90b2NvbCBmb3IgbG9hZGluZyB0aGUgbWFpbiBIVE1MIGZpbGVcclxuICAgICAgICAvLyBUaGlzIGlzIHRoZSBzdGFuZGFyZCBhcHByb2FjaCBmb3IgRWxlY3Ryb24gYXBwc1xyXG4gICAgICAgIG1haW5XaW5kb3cubG9hZFVSTChcclxuICAgICAgICAgICAgdXJsLmZvcm1hdCh7XHJcbiAgICAgICAgICAgICAgICBwYXRobmFtZTogYXBwUGF0aCxcclxuICAgICAgICAgICAgICAgIHByb3RvY29sOiAnZmlsZTonLFxyXG4gICAgICAgICAgICAgICAgc2xhc2hlczogdHJ1ZVxyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gTG9nIGFueSBwYWdlIGxvYWQgZXJyb3JzXHJcbiAgICAgICAgbWFpbldpbmRvdy53ZWJDb250ZW50cy5vbignZGlkLWZhaWwtbG9hZCcsIChldmVudCwgZXJyb3JDb2RlLCBlcnJvckRlc2NyaXB0aW9uKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBsb2FkIGFwcDonLCBlcnJvckNvZGUsIGVycm9yRGVzY3JpcHRpb24pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQXR0ZW1wdCB0byByZWxvYWQgd2l0aCBhIHNsaWdodCBkZWxheSBhcyBhIGZhbGxiYWNrXHJcbiAgICAgICAgICAgIGlmIChlcnJvckNvZGUgIT09IC0zKSB7IC8vIElnbm9yZSBhYm9ydGVkIGxvYWRzXHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnQXR0ZW1wdGluZyBmYWxsYmFjayBsb2FkIGFmdGVyIGRlbGF5Li4uJyk7XHJcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBtYWluV2luZG93LmxvYWRVUkwoXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybC5mb3JtYXQoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aG5hbWU6IGFwcFBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm90b2NvbDogJ2ZpbGU6JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNsYXNoZXM6IHRydWVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgICAgfSwgMTAwMCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBTZXQgcGxhdGZvcm0tc3BlY2lmaWMgYXBwbGljYXRpb24gbWVudVxyXG4gICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XHJcbiAgICAgICAgY3JlYXRlTWFjTWVudSgpO1xyXG4gICAgICAgIC8vIE1ha2UgbWFpbldpbmRvdyBhdmFpbGFibGUgZ2xvYmFsbHkgZm9yIG1lbnUgYWN0aW9uc1xyXG4gICAgICAgIGdsb2JhbC5tYWluV2luZG93ID0gbWFpbldpbmRvdztcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gRm9yIFdpbmRvd3MgYW5kIExpbnV4LCB1c2UgYSBzaW1wbGVyIG1lbnUgb3IgZGVmYXVsdFxyXG4gICAgICAgIGNvbnN0IHsgTWVudSB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuICAgICAgICBNZW51LnNldEFwcGxpY2F0aW9uTWVudShNZW51LmJ1aWxkRnJvbVRlbXBsYXRlKFtcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdGaWxlJyxcclxuICAgICAgICAgICAgICAgIHN1Ym1lbnU6IFtcclxuICAgICAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnTmV3IENvbnZlcnNpb24nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhY2NlbGVyYXRvcjogJ0NtZE9yQ3RybCtOJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2xpY2s6ICgpID0+IG1haW5XaW5kb3c/LndlYkNvbnRlbnRzLnNlbmQoJ21lbnU6bmV3LWNvbnZlcnNpb24nKVxyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgeyB0eXBlOiAnc2VwYXJhdG9yJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHsgcm9sZTogJ3F1aXQnIH1cclxuICAgICAgICAgICAgICAgIF1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdWaWV3JyxcclxuICAgICAgICAgICAgICAgIHN1Ym1lbnU6IFtcclxuICAgICAgICAgICAgICAgICAgICB7IHJvbGU6ICdyZWxvYWQnIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgeyByb2xlOiAndG9nZ2xlRGV2VG9vbHMnIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgeyB0eXBlOiAnc2VwYXJhdG9yJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHsgcm9sZTogJ3RvZ2dsZWZ1bGxzY3JlZW4nIH1cclxuICAgICAgICAgICAgICAgIF1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIF0pKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBXaW5kb3cgZXZlbnQgaGFuZGxlcnNcclxuICAgIG1haW5XaW5kb3cub24oJ2Nsb3NlZCcsICgpID0+IHtcclxuICAgICAgICBtYWluV2luZG93ID0gbnVsbDtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE5vdGlmeSByZW5kZXJlciBwcm9jZXNzIHRoYXQgYXBwIGlzIHJlYWR5XHJcbiAgICBtYWluV2luZG93LndlYkNvbnRlbnRzLm9uKCdkaWQtZmluaXNoLWxvYWQnLCAoKSA9PiB7XHJcbiAgICAgICAgbWFpbldpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdhcHA6cmVhZHknLCB0cnVlKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIFNlbnQgYXBwOnJlYWR5IGV2ZW50IHRvIHJlbmRlcmVyJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4gbWFpbldpbmRvdztcclxufVxyXG5cclxuLyoqXHJcbiAqIFJlZ2lzdGVyIG1lZGlhIHByb3RvY29sIGhhbmRsZXIgd2l0aCBsb2dnaW5nXHJcbiAqL1xyXG5mdW5jdGlvbiByZWdpc3Rlck1lZGlhUHJvdG9jb2woKSB7XHJcbiAgICBwcm90b2NvbC5yZWdpc3RlckZpbGVQcm90b2NvbCgnbWVkaWEnLCBhc3luYyAocmVxdWVzdCwgY2FsbGJhY2spID0+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHJlcXVlc3QudXJsLnJlcGxhY2UoJ21lZGlhOi8vJywgJycpO1xyXG4gICAgICAgICAgICBjb25zdCBzYWZlUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKGRlY29kZVVSSShmaWxlUGF0aCkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nKGBNZWRpYSBwcm90b2NvbCBzZXJ2aW5nOiAke3NhZmVQYXRofWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdNZWRpYSBwcm90b2NvbCBzZXJ2aW5nOicsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgY2FsbGJhY2soc2FmZVBhdGgpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKGBNZWRpYSBwcm90b2NvbCBoYW5kbGVyIGVycm9yOiAke3JlcXVlc3QudXJsfWAsIGVycm9yKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBtZWRpYSBwcm90b2NvbCBoYW5kbGVyOicsIGVycm9yKTtcclxuICAgICAgICAgICAgY2FsbGJhY2soeyBlcnJvcjogLTIgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgIGxvZ2dlci5sb2coJ01lZGlhIHByb3RvY29sIGhhbmRsZXIgcmVnaXN0ZXJlZCcpO1xyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogUmVnaXN0ZXIgZW5oYW5jZWQgZmlsZSBwcm90b2NvbCBoYW5kbGVyIHdpdGggbG9nZ2luZ1xyXG4gKi9cclxuZnVuY3Rpb24gcmVnaXN0ZXJGaWxlUHJvdG9jb2woKSB7XHJcbiAgICBwcm90b2NvbC5yZWdpc3RlckZpbGVQcm90b2NvbCgnZmlsZScsIGFzeW5jIChyZXF1ZXN0LCBjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGxldCBmaWxlUGF0aCA9IHJlcXVlc3QudXJsLnJlcGxhY2UoJ2ZpbGU6Ly8nLCAnJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnRmlsZSBwcm90b2NvbCByZXF1ZXN0JywgeyB1cmw6IHJlcXVlc3QudXJsLCBmaWxlUGF0aCB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRmlsZSBwcm90b2NvbCByZXF1ZXN0OicsIGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIFdpbmRvd3MgYWJzb2x1dGUgcGF0aHMgd2l0aCBkcml2ZSBsZXR0ZXJzXHJcbiAgICAgICAgICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInICYmIGZpbGVQYXRoLm1hdGNoKC9eXFwvW0EtWmEtel06XFwvLykpIHtcclxuICAgICAgICAgICAgICAgIC8vIFJlbW92ZSB0aGUgbGVhZGluZyBzbGFzaCBiZWZvcmUgdGhlIGRyaXZlIGxldHRlclxyXG4gICAgICAgICAgICAgICAgZmlsZVBhdGggPSBmaWxlUGF0aC5yZXBsYWNlKC9eXFwvKFtBLVphLXpdOlxcLy4qPykkLywgJyQxJyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnTm9ybWFsaXplZCBXaW5kb3dzIHBhdGgnLCB7IGZpbGVQYXRoIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ05vcm1hbGl6ZWQgV2luZG93cyBwYXRoOicsIGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gU3BlY2lhbCBjYXNlIGZvciBpbmRleC5odG1sIHRvIGF2b2lkIFN2ZWx0ZUtpdCByb3V0aW5nIGlzc3Vlc1xyXG4gICAgICAgICAgICBpZiAoZmlsZVBhdGguZW5kc1dpdGgoJ2luZGV4Lmh0bWwnKSB8fCBmaWxlUGF0aC5lbmRzV2l0aCgnXFxcXGluZGV4Lmh0bWwnKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaW5kZXhQYXRoID0gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCdcclxuICAgICAgICAgICAgICAgICAgICA/IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9mcm9udGVuZC9kaXN0L2luZGV4Lmh0bWwnKVxyXG4gICAgICAgICAgICAgICAgICAgIDogcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdmcm9udGVuZC9kaXN0L2luZGV4Lmh0bWwnKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNhZmVQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoZGVjb2RlVVJJKGluZGV4UGF0aCkpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nQXNzZXRMb2FkaW5nKCdpbmRleC5odG1sJywgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIGZpbGUgZXhpc3RzXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXhpc3RzID0gYXdhaXQgZnMucGF0aEV4aXN0cyhzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnSW5kZXggZmlsZSBleGlzdHMgY2hlY2snLCB7IGV4aXN0cywgcGF0aDogc2FmZVBhdGggfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWV4aXN0cykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gTGlzdCBhbHRlcm5hdGl2ZSBwYXRocyB0byBjaGVja1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWx0ZXJuYXRpdmVQYXRocyA9IFtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ2Zyb250ZW5kL2Rpc3QvaW5kZXguaHRtbCcpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihwcm9jZXNzLnJlc291cmNlc1BhdGggfHwgJycsICdmcm9udGVuZC9kaXN0L2luZGV4Lmh0bWwnKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4oYXBwLmdldFBhdGgoJ2V4ZScpLCAnLi4vcmVzb3VyY2VzL2Zyb250ZW5kL2Rpc3QvaW5kZXguaHRtbCcpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0FsdGVybmF0aXZlIGluZGV4Lmh0bWwgcGF0aHMnLCB7IGFsdGVybmF0aXZlUGF0aHMgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGVhY2ggYWx0ZXJuYXRpdmUgcGF0aFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBhbHRQYXRoIG9mIGFsdGVybmF0aXZlUGF0aHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhbHRFeGlzdHMgPSBhd2FpdCBmcy5wYXRoRXhpc3RzKGFsdFBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0FsdGVybmF0aXZlIHBhdGggZXhpc3RzJywgeyBwYXRoOiBhbHRQYXRoLCBleGlzdHM6IGFsdEV4aXN0cyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKGBFcnJvciBjaGVja2luZyBhbHRlcm5hdGl2ZSBwYXRoOiAke2FsdFBhdGh9YCwgZXJyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIExpc3QgZGlzdCBkaXJlY3RvcnkgY29udGVudHNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlzdERpciA9IHBhdGguZGlybmFtZShzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGF3YWl0IGZzLnBhdGhFeGlzdHMoZGlzdERpcikpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZmlsZXMgPSBhd2FpdCBmcy5yZWFkZGlyKGRpc3REaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0Rpc3QgZGlyZWN0b3J5IGNvbnRlbnRzJywgeyBkaXJlY3Rvcnk6IGRpc3REaXIsIGZpbGVzIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcignRXJyb3IgcmVhZGluZyBkaXN0IGRpcmVjdG9yeScsIGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKCdFcnJvciBjaGVja2luZyBpbmRleC5odG1sIGV4aXN0ZW5jZScsIGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU2VydmluZyBpbmRleC5odG1sIGZyb206Jywgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgY2FsbGJhY2soc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBIYW5kbGUgc3RhdGljIGFzc2V0cyBmcm9tIGZyb250ZW5kL3N0YXRpY1xyXG4gICAgICAgICAgICBpZiAoZmlsZVBhdGguaW5jbHVkZXMoJy9zdGF0aWMvJykgfHwgZmlsZVBhdGguaW5jbHVkZXMoJ1xcXFxzdGF0aWNcXFxcJykpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRpY0ZpbGUgPSBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRpY1BhdGggPSBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50J1xyXG4gICAgICAgICAgICAgICAgICAgID8gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Zyb250ZW5kL3N0YXRpYycsIHN0YXRpY0ZpbGUpXHJcbiAgICAgICAgICAgICAgICAgICAgOiBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ2Zyb250ZW5kL3N0YXRpYycsIHN0YXRpY0ZpbGUpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2FmZVBhdGggPSBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChkZWNvZGVVUkkoc3RhdGljUGF0aCkpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nQXNzZXRMb2FkaW5nKGZpbGVQYXRoLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgZmlsZSBleGlzdHNcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBleGlzdHMgPSBhd2FpdCBmcy5wYXRoRXhpc3RzKHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdTdGF0aWMgYXNzZXQgZXhpc3RzIGNoZWNrJywgeyBleGlzdHMsIHBhdGg6IHNhZmVQYXRoIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFleGlzdHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyeSBmYWxsYmFjayBsb2NhdGlvbnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFsdFBhdGhzID0gW1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAncmVzb3VyY2VzL3N0YXRpYycsIHN0YXRpY0ZpbGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAncmVzb3VyY2VzL2Zyb250ZW5kL2Rpc3Qvc3RhdGljJywgc3RhdGljRmlsZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKHByb2Nlc3MucmVzb3VyY2VzUGF0aCB8fCAnJywgJ3N0YXRpYycsIHN0YXRpY0ZpbGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihwcm9jZXNzLnJlc291cmNlc1BhdGggfHwgJycsICdmcm9udGVuZC9kaXN0L3N0YXRpYycsIHN0YXRpY0ZpbGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihhcHAuZ2V0UGF0aCgnZXhlJyksICcuLi9yZXNvdXJjZXMvc3RhdGljJywgc3RhdGljRmlsZSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnQWx0ZXJuYXRpdmUgc3RhdGljIGFzc2V0IHBhdGhzJywgeyBmaWxlOiBzdGF0aWNGaWxlLCBwYXRoczogYWx0UGF0aHMgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGVhY2ggYWx0ZXJuYXRpdmUgcGF0aFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBhbHRQYXRoIG9mIGFsdFBhdGhzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWx0RXhpc3RzID0gYXdhaXQgZnMucGF0aEV4aXN0cyhhbHRQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdBbHRlcm5hdGl2ZSBwYXRoIGV4aXN0cycsIHsgcGF0aDogYWx0UGF0aCwgZXhpc3RzOiBhbHRFeGlzdHMgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoYWx0RXhpc3RzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nKGBGb3VuZCBhbHRlcm5hdGl2ZSBwYXRoIGZvciAke3N0YXRpY0ZpbGV9OiAke2FsdFBhdGh9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayhhbHRQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoYEVycm9yIGNoZWNraW5nIGFsdGVybmF0aXZlIHBhdGg6ICR7YWx0UGF0aH1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoYEVycm9yIGNoZWNraW5nIGV4aXN0ZW5jZSBvZiBzdGF0aWMgYXNzZXQ6ICR7c3RhdGljRmlsZX1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NlcnZpbmcgc3RhdGljIGFzc2V0IGZyb206Jywgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgY2FsbGJhY2soc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBIYW5kbGUgVml0ZS9TdmVsdGUgYXNzZXRzXHJcbiAgICAgICAgICAgIGlmIChmaWxlUGF0aC5pbmNsdWRlcygnL2Fzc2V0cy8nKSB8fCBmaWxlUGF0aC5pbmNsdWRlcygnXFxcXGFzc2V0c1xcXFwnKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYXNzZXRGaWxlID0gZmlsZVBhdGguc3Vic3RyaW5nKGZpbGVQYXRoLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGFzc2V0UGF0aCA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnXHJcbiAgICAgICAgICAgICAgICAgICAgPyBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vZnJvbnRlbmQvZGlzdC9hc3NldHMnLCBhc3NldEZpbGUpXHJcbiAgICAgICAgICAgICAgICAgICAgOiBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ2Zyb250ZW5kL2Rpc3QvYXNzZXRzJywgYXNzZXRGaWxlKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNhZmVQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoZGVjb2RlVVJJKGFzc2V0UGF0aCkpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nQXNzZXRMb2FkaW5nKGZpbGVQYXRoLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgZmlsZSBleGlzdHNcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBleGlzdHMgPSBhd2FpdCBmcy5wYXRoRXhpc3RzKHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdBc3NldCBleGlzdHMgY2hlY2snLCB7IGV4aXN0cywgcGF0aDogc2FmZVBhdGggfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWV4aXN0cykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJ5IGZhbGxiYWNrIGxvY2F0aW9uc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWx0UGF0aHMgPSBbXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdmcm9udGVuZC9kaXN0L2Fzc2V0cycsIGFzc2V0RmlsZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdyZXNvdXJjZXMvZnJvbnRlbmQvZGlzdC9hc3NldHMnLCBhc3NldEZpbGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihwcm9jZXNzLnJlc291cmNlc1BhdGggfHwgJycsICdmcm9udGVuZC9kaXN0L2Fzc2V0cycsIGFzc2V0RmlsZSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnQWx0ZXJuYXRpdmUgYXNzZXQgcGF0aHMnLCB7IGZpbGU6IGFzc2V0RmlsZSwgcGF0aHM6IGFsdFBhdGhzIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcihgRXJyb3IgY2hlY2tpbmcgZXhpc3RlbmNlIG9mIGFzc2V0OiAke2Fzc2V0RmlsZX1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NlcnZpbmcgVml0ZSBhc3NldCBmcm9tOicsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gU3BlY2lhbCBjYXNlIGZvciBkaXJlY3QgZmlsZSByZXF1ZXN0cyB3aXRoIG5vIHBhdGggKGp1c3QgYSBmaWxlbmFtZSlcclxuICAgICAgICAgICAgaWYgKCFmaWxlUGF0aC5pbmNsdWRlcygnLycpICYmICFmaWxlUGF0aC5pbmNsdWRlcygnXFxcXCcpICYmIGZpbGVQYXRoLmluY2x1ZGVzKCcuJykpIHtcclxuICAgICAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2coJ0RldGVjdGVkIGRpcmVjdCBmaWxlIHJlcXVlc3Qgd2l0aCBubyBwYXRoJyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnRGV0ZWN0ZWQgZGlyZWN0IGZpbGUgcmVxdWVzdCB3aXRoIG5vIHBhdGgnKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gVHJ5IHRvIGZpbmQgdGhlIGZpbGUgaW4gdGhlIGRpc3QgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICBjb25zdCBkaXN0UGF0aCA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnXHJcbiAgICAgICAgICAgICAgICAgICAgPyBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vZnJvbnRlbmQvZGlzdCcsIGZpbGVQYXRoKVxyXG4gICAgICAgICAgICAgICAgICAgIDogcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdmcm9udGVuZC9kaXN0JywgZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2FmZVBhdGggPSBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChkZWNvZGVVUkkoZGlzdFBhdGgpKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZ0Fzc2V0TG9hZGluZyhmaWxlUGF0aCwgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU2VydmluZyBkaXJlY3QgZmlsZSBmcm9tIGRpc3Q6Jywgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgY2FsbGJhY2soc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBIYW5kbGUgb3RoZXIgZmlsZTovLyByZXF1ZXN0cyBub3JtYWxseVxyXG4gICAgICAgICAgICBjb25zdCBzYWZlUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKGRlY29kZVVSSShmaWxlUGF0aCkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nQXNzZXRMb2FkaW5nKGZpbGVQYXRoLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTZXJ2aW5nIHN0YW5kYXJkIGZpbGUgZnJvbTonLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgIGNhbGxiYWNrKHNhZmVQYXRoKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2dQcm90b2NvbEVycm9yKHJlcXVlc3QudXJsLCBlcnJvcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGZpbGUgcHJvdG9jb2wgaGFuZGxlcjonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIGNhbGxiYWNrKHsgZXJyb3I6IC0yIH0pOyAvLyBGYWlsZWQgdG8gbG9hZFxyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICBsb2dnZXIubG9nKCdGaWxlIHByb3RvY29sIGhhbmRsZXIgcmVnaXN0ZXJlZCcpO1xyXG4gICAgfVxyXG59XHJcblxyXG4vLyBEaXJlY3QgY29uc29sZSBvdXRwdXQgZm9yIGRlYnVnZ2luZ1xyXG5jb25zb2xlLmxvZygnPT09PT09IEVMRUNUUk9OIEFQUCBTVEFSVElORyA9PT09PT0nKTtcclxuY29uc29sZS5sb2coJ1dvcmtpbmcgZGlyZWN0b3J5OicsIHByb2Nlc3MuY3dkKCkpO1xyXG5jb25zb2xlLmxvZygnQXBwIHBhdGg6JywgYXBwLmdldEFwcFBhdGgoKSk7XHJcbmNvbnNvbGUubG9nKCdSZXNvdXJjZSBwYXRoOicsIHByb2Nlc3MucmVzb3VyY2VzUGF0aCk7XHJcbmNvbnNvbGUubG9nKCdFeGVjdXRhYmxlIHBhdGg6JywgcHJvY2Vzcy5leGVjUGF0aCk7XHJcbmNvbnNvbGUubG9nKCdOT0RFX0VOVjonLCBwcm9jZXNzLmVudi5OT0RFX0VOVik7XHJcbmNvbnNvbGUubG9nKCc9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0nKTtcclxuXHJcbi8vIEFwcCBzdGFydHVwIHNlcXVlbmNlXHJcbmFwcC53aGVuUmVhZHkoKS50aGVuKGFzeW5jICgpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ0FwcCByZWFkeSBldmVudCBmaXJlZCcpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEluaXRpYWxpemUgbG9nZ2VyIGZpcnN0IHRoaW5nXHJcbiAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZUxvZ2dlcigpO1xyXG4gICAgICAgIGF3YWl0IGxvZ2dlci5sb2dTdGFydHVwKCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmVnaXN0ZXIgcHJvdG9jb2wgaGFuZGxlcnNcclxuICAgICAgICBjb25zb2xlLmxvZygnUmVnaXN0ZXJpbmcgcHJvdG9jb2wgaGFuZGxlcnMnKTtcclxuICAgICAgICByZWdpc3Rlck1lZGlhUHJvdG9jb2woKTtcclxuICAgICAgICByZWdpc3RlckZpbGVQcm90b2NvbCgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEluaXRpYWxpemUgYXBwIGJlZm9yZSBjcmVhdGluZyB3aW5kb3dcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+agCBTdGFydGluZyBhcHAgaW5pdGlhbGl6YXRpb24uLi4nKTtcclxuICAgICAgICBjb25zdCBzdWNjZXNzID0gYXdhaXQgaW5pdGlhbGl6ZUFwcCgpO1xyXG4gICAgICAgIGlmICghc3VjY2Vzcykge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgQXBwIGluaXRpYWxpemF0aW9uIGZhaWxlZCcpO1xyXG4gICAgICAgICAgICBhcHAucXVpdCgpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBDcmVhdGUgYW5kIHNldHVwIHdpbmRvd1xyXG4gICAgICAgIG1haW5XaW5kb3cgPSBhd2FpdCBjcmVhdGVBbmRTZXR1cFdpbmRvdygpO1xyXG4gICAgICAgIGlmICghbWFpbldpbmRvdykge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGNyZWF0ZSBtYWluIHdpbmRvdycpO1xyXG4gICAgICAgICAgICBhcHAucXVpdCgpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBTZXR1cCB0cmF5IGFmdGVyIHdpbmRvdyBjcmVhdGlvblxyXG4gICAgICAgIHNldHVwVHJheSgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgTWFpbiB3aW5kb3cgY3JlYXRlZCBhbmQgaW5pdGlhbGl6ZWQnKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIENyaXRpY2FsIHN0YXJ0dXAgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICAgIGFwcC5xdWl0KCk7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuLy8gSGFuZGxlIG1hY09TIGFjdGl2YXRpb25cclxuYXBwLm9uKCdhY3RpdmF0ZScsIGFzeW5jICgpID0+IHtcclxuICAgIGlmIChtYWluV2luZG93ID09PSBudWxsICYmIGFwcEluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgLy8gQ3JlYXRlIGFuZCBzZXR1cCBuZXcgd2luZG93XHJcbiAgICAgICAgbWFpbldpbmRvdyA9IGF3YWl0IGNyZWF0ZUFuZFNldHVwV2luZG93KCk7XHJcbiAgICAgICAgaWYgKCFtYWluV2luZG93KSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gcmVzdG9yZSB3aW5kb3cgb24gYWN0aXZhdGUnKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBSZS1zZXR1cCB0cmF5IHdpdGggbmV3IHdpbmRvd1xyXG4gICAgICAgIHNldHVwVHJheSgpO1xyXG4gICAgfVxyXG59KTtcclxuXHJcbi8vIEhhbmRsZSB3aW5kb3cgY2xvc2VcclxuYXBwLm9uKCd3aW5kb3ctYWxsLWNsb3NlZCcsICgpID0+IHtcclxuICAgIC8vIENsZWFuIHVwIHdpbmRvdy1zcGVjaWZpYyBoYW5kbGVyc1xyXG4gICAgaWYgKHR5cGVvZiBjbGVhbnVwV2luZG93SGFuZGxlcnMgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICBjbGVhbnVwV2luZG93SGFuZGxlcnMoKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDbGVhbiB1cCB0cmF5XHJcbiAgICBpZiAodHJheU1hbmFnZXIpIHtcclxuICAgICAgICB0cmF5TWFuYWdlci5kZXN0cm95KCk7XHJcbiAgICAgICAgdHJheU1hbmFnZXIgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBRdWl0IGZvciBub24tbWFjT1MgcGxhdGZvcm1zXHJcbiAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSAhPT0gJ2RhcndpbicpIHtcclxuICAgICAgICBhcHAucXVpdCgpO1xyXG4gICAgfVxyXG59KTtcclxuXHJcbi8vIENsZWFuIHVwIG9uIHF1aXRcclxuYXBwLm9uKCd3aWxsLXF1aXQnLCAoKSA9PiB7XHJcbiAgICBpZiAodHJheU1hbmFnZXIpIHtcclxuICAgICAgICB0cmF5TWFuYWdlci5kZXN0cm95KCk7XHJcbiAgICAgICAgdHJheU1hbmFnZXIgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgbm90aWZpY2F0aW9uTWFuYWdlciA9IG51bGw7XHJcbiAgICB1cGRhdGVNYW5hZ2VyID0gbnVsbDtcclxufSk7XHJcblxyXG4vLyBIYW5kbGUgZmF0YWwgZXJyb3JzXHJcbnByb2Nlc3Mub24oJ3VuY2F1Z2h0RXhjZXB0aW9uJywgYXN5bmMgKGVycm9yKSA9PiB7XHJcbiAgICBjb25zb2xlLmVycm9yKCfinYwgVW5jYXVnaHQgZXhjZXB0aW9uOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgLy8gTG9nIHRvIGZpbGUgaWYgbG9nZ2VyIGlzIGluaXRpYWxpemVkXHJcbiAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoJ1VuY2F1Z2h0IGV4Y2VwdGlvbicsIGVycm9yKTtcclxuICAgICAgICB9IGNhdGNoIChsb2dFcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGxvZyB1bmNhdWdodCBleGNlcHRpb246JywgbG9nRXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gVHJ5IHRvIHNlbmQgdG8gcmVuZGVyZXJcclxuICAgIGlmIChtYWluV2luZG93Py53ZWJDb250ZW50cykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIG1haW5XaW5kb3cud2ViQ29udGVudHMuc2VuZCgnYXBwOmVycm9yJywgZXJyb3IubWVzc2FnZSk7XHJcbiAgICAgICAgfSBjYXRjaCAoc2VuZEVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gc2VuZCBlcnJvciB0byB3aW5kb3c6Jywgc2VuZEVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUFBLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLG9EQUFvREMsT0FBTyxDQUFDQyxRQUFRLENBQUNDLElBQUksRUFBRSxDQUFDO0FBQ3hGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7RUFDRjtFQUNBLE1BQU1DLE1BQU0sR0FBR0MsT0FBTyxDQUFDLFFBQVEsQ0FBQztFQUNoQyxNQUFNQyx1QkFBdUIsR0FBR0YsTUFBTSxDQUFDRyxnQkFBZ0I7O0VBRXZEO0VBQ0EsTUFBTUMsWUFBWSxHQUFHO0lBQ25CO0lBQ0Esd0NBQXdDLEVBQUUsMENBQTBDO0lBQ3BGLG1DQUFtQyxFQUFFO0VBQ3ZDLENBQUM7O0VBRUQ7RUFDQSxJQUFJLENBQUNKLE1BQU0sQ0FBQ0ssd0JBQXdCLEVBQUU7SUFDcEM7SUFDQUwsTUFBTSxDQUFDSyx3QkFBd0IsR0FBR0gsdUJBQXVCOztJQUV6RDtJQUNBRixNQUFNLENBQUNHLGdCQUFnQixHQUFHLFVBQVNHLE9BQU8sRUFBRUMsTUFBTSxFQUFFQyxNQUFNLEVBQUVDLE9BQU8sRUFBRTtNQUNuRSxJQUFJO1FBQ0Y7UUFDQSxJQUFJQyxlQUFlLEdBQUdKLE9BQU87O1FBRTdCO1FBQ0EsS0FBSyxNQUFNLENBQUNLLE9BQU8sRUFBRUMsV0FBVyxDQUFDLElBQUlDLE1BQU0sQ0FBQ0MsT0FBTyxDQUFDVixZ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