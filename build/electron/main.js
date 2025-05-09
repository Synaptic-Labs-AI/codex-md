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
// Import the singleton instance by destructuring the exported object
const {
  instance: openAIProxyServiceInstance
} = require('./services/ai/OpenAIProxyService');

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
    // OpenAIProxyService instance is already created via singleton pattern

    // Attempt to configure the shared OpenAI Proxy instance on startup if key exists
    const storedOpenAIKey = apiKeyServiceInstance.getApiKey('openai');
    if (storedOpenAIKey) {
      console.log('[Startup] Found stored OpenAI key, attempting to configure OpenAIProxyService...');
      try {
        const configureResult = await openAIProxyServiceInstance.handleConfigure(null, {
          apiKey: storedOpenAIKey
        });
        if (configureResult.success) {
          console.log('[Startup] OpenAIProxyService configured successfully on startup.');
        } else {
          console.warn('[Startup] OpenAIProxyService configuration failed on startup.');
        }
      } catch (configError) {
        console.error('[Startup] Error configuring OpenAIProxyService on startup:', configError);
      }
    } else {
      console.log('[Startup] No stored OpenAI key found.');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjb25zb2xlIiwibG9nIiwicHJvY2VzcyIsInZlcnNpb25zIiwibm9kZSIsImFwcCIsIkJyb3dzZXJXaW5kb3ciLCJwcm90b2NvbCIsInJlcXVpcmUiLCJwYXRoIiwidXJsIiwiZnMiLCJQYXRoVXRpbHMiLCJsb2dnZXIiLCJFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlIiwiY3JlYXRlTWFjTWVudSIsInNldHVwQmFzaWNIYW5kbGVycyIsInNldHVwV2luZG93SGFuZGxlcnMiLCJjbGVhbnVwV2luZG93SGFuZGxlcnMiLCJUcmF5TWFuYWdlciIsIk5vdGlmaWNhdGlvbk1hbmFnZXIiLCJVcGRhdGVNYW5hZ2VyIiwiY3JlYXRlU3RvcmUiLCJBcGlLZXlTZXJ2aWNlIiwiaW5zdGFuY2UiLCJvcGVuQUlQcm94eVNlcnZpY2VJbnN0YW5jZSIsIm1haW5XaW5kb3ciLCJhcHBJbml0aWFsaXplZCIsInRyYXlNYW5hZ2VyIiwibm90aWZpY2F0aW9uTWFuYWdlciIsInVwZGF0ZU1hbmFnZXIiLCJsb2dnZXJJbml0aWFsaXplZCIsInRyYXlTdG9yZSIsImVuY3J5cHRpb25LZXkiLCJlbnYiLCJTVE9SRV9FTkNSWVBUSU9OX0tFWSIsImluaXRpYWxpemVMb2dnZXIiLCJpbml0aWFsaXplIiwiZXJyb3IiLCJzZXR1cE5vdGlmaWNhdGlvbnMiLCJzZXR1cFRyYXkiLCJ3YXJuIiwiY3JlYXRlQW5kU2V0dXBXaW5kb3ciLCJ3aW5kb3ciLCJjcmVhdGVNYWluV2luZG93IiwiUHJvbWlzZSIsInJlc29sdmUiLCJzZXRUaW1lb3V0IiwiaW5pdGlhbGl6ZUFwcCIsImFwaUtleVNlcnZpY2VJbnN0YW5jZSIsInN0b3JlZE9wZW5BSUtleSIsImdldEFwaUtleSIsImNvbmZpZ3VyZVJlc3VsdCIsImhhbmRsZUNvbmZpZ3VyZSIsImFwaUtleSIsInN1Y2Nlc3MiLCJjb25maWdFcnJvciIsInNldHVwT3V0cHV0RGlyZWN0b3J5IiwiRXJyb3IiLCJhcHBQYXRocyIsImFwcFBhdGgiLCJnZXRBcHBQYXRoIiwiYXBwRGF0YSIsImdldFBhdGgiLCJ1c2VyRGF0YSIsImV4ZSIsIm1vZHVsZSIsImN3ZCIsInJlc291cmNlc1BhdGgiLCJkZWJ1ZyIsImljb25QYXRoIiwibm9ybWFsaXplUGF0aCIsIk5PREVfRU5WIiwiam9pbiIsIl9fZGlybmFtZSIsImljb25FeGlzdHMiLCJwYXRoRXhpc3RzIiwiZXhpc3RzIiwid2luZG93Q29uZmlnIiwid2lkdGgiLCJoZWlnaHQiLCJtaW5XaWR0aCIsIm1pbkhlaWdodCIsImljb24iLCJ3ZWJQcmVmZXJlbmNlcyIsIm5vZGVJbnRlZ3JhdGlvbiIsImNvbnRleHRJc29sYXRpb24iLCJwcmVsb2FkIiwic2hvdyIsInBsYXRmb3JtIiwidGl0bGVCYXJTdHlsZSIsImZyYW1lIiwibG9nV2luZG93Q3JlYXRpb24iLCJvbmNlIiwibG9hZFVSTCIsIndlYkNvbnRlbnRzIiwib3BlbkRldlRvb2xzIiwiZm9ybWF0IiwicGF0aG5hbWUiLCJzbGFzaGVzIiwib24iLCJldmVudCIsImVycm9yQ29kZSIsImVycm9yRGVzY3JpcHRpb24iLCJnbG9iYWwiLCJNZW51Iiwic2V0QXBwbGljYXRpb25NZW51IiwiYnVpbGRGcm9tVGVtcGxhdGUiLCJsYWJlbCIsInN1Ym1lbnUiLCJhY2NlbGVyYXRvciIsImNsaWNrIiwic2VuZCIsInR5cGUiLCJyb2xlIiwicmVnaXN0ZXJNZWRpYVByb3RvY29sIiwicmVnaXN0ZXJGaWxlUHJvdG9jb2wiLCJyZXF1ZXN0IiwiY2FsbGJhY2siLCJmaWxlUGF0aCIsInJlcGxhY2UiLCJzYWZlUGF0aCIsImRlY29kZVVSSSIsIm1hdGNoIiwiZW5kc1dpdGgiLCJpbmRleFBhdGgiLCJsb2dBc3NldExvYWRpbmciLCJhbHRlcm5hdGl2ZVBhdGhzIiwiYWx0UGF0aCIsImFsdEV4aXN0cyIsImVyciIsImRpc3REaXIiLCJkaXJuYW1lIiwiZmlsZXMiLCJyZWFkZGlyIiwiZGlyZWN0b3J5IiwiaW5jbHVkZXMiLCJzdGF0aWNGaWxlIiwiYmFzZW5hbWUiLCJzdGF0aWNQYXRoIiwiYWx0UGF0aHMiLCJmaWxlIiwicGF0aHMiLCJhc3NldEZpbGUiLCJzdWJzdHJpbmciLCJsYXN0SW5kZXhPZiIsImFzc2V0UGF0aCIsImRpc3RQYXRoIiwibG9nUHJvdG9jb2xFcnJvciIsImV4ZWNQYXRoIiwid2hlblJlYWR5IiwidGhlbiIsImxvZ1N0YXJ0dXAiLCJxdWl0IiwiZGVzdHJveSIsImxvZ0Vycm9yIiwibWVzc2FnZSIsInNlbmRFcnJvciJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9lbGVjdHJvbi9tYWluLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImNvbnNvbGUubG9nKGBbREVCVUddIFJ1bm5pbmcgTm9kZS5qcyB2ZXJzaW9uIGluIG1haW4gcHJvY2VzczogJHtwcm9jZXNzLnZlcnNpb25zLm5vZGV9YCk7XHJcbi8qKlxyXG4gKiBFbGVjdHJvbiBNYWluIFByb2Nlc3NcclxuICogRW50cnkgcG9pbnQgZm9yIHRoZSBFbGVjdHJvbiBhcHBsaWNhdGlvbi5cclxuICogXHJcbiAqIEhhbmRsZXM6XHJcbiAqIC0gV2luZG93IG1hbmFnZW1lbnRcclxuICogLSBJUEMgY29tbXVuaWNhdGlvbiBzZXR1cFxyXG4gKiAtIFByb3RvY29sIHJlZ2lzdHJhdGlvblxyXG4gKiAtIEFwcCBsaWZlY3ljbGVcclxuICovXHJcblxyXG5jb25zdCB7IGFwcCwgQnJvd3NlcldpbmRvdywgcHJvdG9jb2wgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IHVybCA9IHJlcXVpcmUoJ3VybCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbmNvbnN0IHsgUGF0aFV0aWxzIH0gPSByZXF1aXJlKCcuL3V0aWxzL3BhdGhzJyk7XHJcbmNvbnN0IGxvZ2dlciA9IHJlcXVpcmUoJy4vdXRpbHMvbG9nZ2VyJyk7XHJcbmNvbnN0IEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UgPSByZXF1aXJlKCcuL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UnKTtcclxuY29uc3QgeyBjcmVhdGVNYWNNZW51IH0gPSByZXF1aXJlKCcuL2ZlYXR1cmVzL21lbnUnKTtcclxuY29uc3QgeyBzZXR1cEJhc2ljSGFuZGxlcnMsIHNldHVwV2luZG93SGFuZGxlcnMsIGNsZWFudXBXaW5kb3dIYW5kbGVycyB9ID0gcmVxdWlyZSgnLi9pcGMvaGFuZGxlcnMnKTtcclxuY29uc3QgVHJheU1hbmFnZXIgPSByZXF1aXJlKCcuL2ZlYXR1cmVzL3RyYXknKTtcclxuY29uc3QgTm90aWZpY2F0aW9uTWFuYWdlciA9IHJlcXVpcmUoJy4vZmVhdHVyZXMvbm90aWZpY2F0aW9ucycpO1xyXG5jb25zdCBVcGRhdGVNYW5hZ2VyID0gcmVxdWlyZSgnLi9mZWF0dXJlcy91cGRhdGVyJyk7XHJcbmNvbnN0IHsgY3JlYXRlU3RvcmUgfSA9IHJlcXVpcmUoJy4vdXRpbHMvc3RvcmVGYWN0b3J5Jyk7XHJcbmNvbnN0IEFwaUtleVNlcnZpY2UgPSByZXF1aXJlKCcuL3NlcnZpY2VzL0FwaUtleVNlcnZpY2UnKTsgLy8gSW1wb3J0IEFwaUtleVNlcnZpY2VcclxuLy8gSW1wb3J0IHRoZSBzaW5nbGV0b24gaW5zdGFuY2UgYnkgZGVzdHJ1Y3R1cmluZyB0aGUgZXhwb3J0ZWQgb2JqZWN0XHJcbmNvbnN0IHsgaW5zdGFuY2U6IG9wZW5BSVByb3h5U2VydmljZUluc3RhbmNlIH0gPSByZXF1aXJlKCcuL3NlcnZpY2VzL2FpL09wZW5BSVByb3h5U2VydmljZScpOyBcclxuXHJcbi8vIEtlZXAgYSBnbG9iYWwgcmVmZXJlbmNlIG9mIG9iamVjdHNcclxubGV0IG1haW5XaW5kb3c7XHJcbmxldCBhcHBJbml0aWFsaXplZCA9IGZhbHNlO1xyXG5sZXQgdHJheU1hbmFnZXIgPSBudWxsO1xyXG5sZXQgbm90aWZpY2F0aW9uTWFuYWdlciA9IG51bGw7XHJcbmxldCB1cGRhdGVNYW5hZ2VyID0gbnVsbDtcclxubGV0IGxvZ2dlckluaXRpYWxpemVkID0gZmFsc2U7XHJcblxyXG4vLyBJbml0aWFsaXplIHRyYXkgc3RvcmVcclxuY29uc3QgdHJheVN0b3JlID0gY3JlYXRlU3RvcmUoJ3RyYXktbWFuYWdlcicsIHtcclxuICAgIGVuY3J5cHRpb25LZXk6IHByb2Nlc3MuZW52LlNUT1JFX0VOQ1JZUFRJT05fS0VZXHJcbn0pO1xyXG5cclxuLyoqXHJcbiAqIEluaXRpYWxpemUgbG9nZ2VyXHJcbiAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIGxvZ2dlciB3YXMgc3VjY2Vzc2Z1bGx5IGluaXRpYWxpemVkXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBpbml0aWFsaXplTG9nZ2VyKCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCBsb2dnZXIuaW5pdGlhbGl6ZSgpO1xyXG4gICAgICAgIGxvZ2dlckluaXRpYWxpemVkID0gdHJ1ZTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIExvZ2dlciBpbml0aWFsaXplZCcpO1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGluaXRpYWxpemUgbG9nZ2VyOicsIGVycm9yKTtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBTZXR1cCBub3RpZmljYXRpb25zIHdpdGggZXJyb3IgaGFuZGxpbmdcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIHNldHVwTm90aWZpY2F0aW9ucygpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgbm90aWZpY2F0aW9uTWFuYWdlciA9IG5ldyBOb3RpZmljYXRpb25NYW5hZ2VyKCk7XHJcbiAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2coJ05vdGlmaWNhdGlvbnMgaW5pdGlhbGl6ZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBOb3RpZmljYXRpb25zIGluaXRpYWxpemVkJyk7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBzZXR1cCBub3RpZmljYXRpb25zJywgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIHNldHVwIG5vdGlmaWNhdGlvbnM6JywgZXJyb3IpO1xyXG4gICAgICAgIG5vdGlmaWNhdGlvbk1hbmFnZXIgPSBudWxsO1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIFNldHVwIHN5c3RlbSB0cmF5IHdpdGggZXJyb3IgaGFuZGxpbmdcclxuICovXHJcbmZ1bmN0aW9uIHNldHVwVHJheSgpIHtcclxuICAgIGlmICghbWFpbldpbmRvdykge1xyXG4gICAgICAgIGNvbnNvbGUud2Fybign4pqg77iPIENhbm5vdCBzZXR1cCB0cmF5IHdpdGhvdXQgbWFpbiB3aW5kb3cnKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgICB0cmF5TWFuYWdlciA9IG5ldyBUcmF5TWFuYWdlcihtYWluV2luZG93LCB0cmF5U3RvcmUpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgVHJheSBpbml0aWFsaXplZCBzdWNjZXNzZnVsbHknKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBjcmVhdGUgdHJheTonLCBlcnJvcik7XHJcbiAgICAgICAgLy8gTm9uLWZhdGFsIGVycm9yLCBjb250aW51ZSBleGVjdXRpb25cclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIENyZWF0ZSBhbmQgc2V0dXAgd2luZG93IHdpdGggZXJyb3IgaGFuZGxpbmdcclxuICogQHJldHVybnMge0VsZWN0cm9uLkJyb3dzZXJXaW5kb3d8bnVsbH0gVGhlIGNyZWF0ZWQgd2luZG93IG9yIG51bGwgaWYgZmFpbGVkXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVBbmRTZXR1cFdpbmRvdygpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ0NyZWF0aW5nIG1haW4gd2luZG93Li4uJyk7XHJcbiAgICAgICAgY29uc3Qgd2luZG93ID0gYXdhaXQgY3JlYXRlTWFpbldpbmRvdygpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghd2luZG93KSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBXaW5kb3cgY3JlYXRpb24gZmFpbGVkOiB3aW5kb3cgaXMgbnVsbCcpO1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc29sZS5sb2coJ1dpbmRvdyBjcmVhdGVkIHN1Y2Nlc3NmdWxseSwgd2FpdGluZyBmb3IgaW5pdGlhbGl6YXRpb24uLi4nKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBXYWl0IGEgbW9tZW50IGZvciB0aGUgd2luZG93IHRvIGluaXRpYWxpemUgZnVsbHlcclxuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwMCkpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKCdTZXR0aW5nIHVwIHdpbmRvdyBoYW5kbGVycy4uLicpO1xyXG4gICAgICAgIC8vIFNldHVwIHdpbmRvdyBoYW5kbGVyc1xyXG4gICAgICAgIGF3YWl0IHNldHVwV2luZG93SGFuZGxlcnMod2luZG93KTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIFdpbmRvdyBoYW5kbGVycyByZWdpc3RlcmVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiB3aW5kb3c7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gY3JlYXRlIGFuZCBzZXR1cCB3aW5kb3c6JywgZXJyb3IpO1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogSW5pdGlhbGl6ZSBjb3JlIGFwcGxpY2F0aW9uIHNlcnZpY2VzIGFuZCBoYW5kbGVyc1xyXG4gKiBNdXN0IGNvbXBsZXRlIGJlZm9yZSB3aW5kb3cgY3JlYXRpb25cclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGluaXRpYWxpemVBcHAoKSB7XHJcbiAgdHJ5IHtcclxuICAgIC8vIEluaXRpYWxpemUgQVBJIEtleSBTZXJ2aWNlIGVhcmx5XHJcbiAgICBjb25zdCBhcGlLZXlTZXJ2aWNlSW5zdGFuY2UgPSBBcGlLZXlTZXJ2aWNlOyAvLyBBc3N1bWluZyBzaW5nbGV0b24gZXhwb3J0XHJcbiAgICAvLyBPcGVuQUlQcm94eVNlcnZpY2UgaW5zdGFuY2UgaXMgYWxyZWFkeSBjcmVhdGVkIHZpYSBzaW5nbGV0b24gcGF0dGVyblxyXG5cclxuICAgIC8vIEF0dGVtcHQgdG8gY29uZmlndXJlIHRoZSBzaGFyZWQgT3BlbkFJIFByb3h5IGluc3RhbmNlIG9uIHN0YXJ0dXAgaWYga2V5IGV4aXN0c1xyXG4gICAgY29uc3Qgc3RvcmVkT3BlbkFJS2V5ID0gYXBpS2V5U2VydmljZUluc3RhbmNlLmdldEFwaUtleSgnb3BlbmFpJyk7XHJcbiAgICBpZiAoc3RvcmVkT3BlbkFJS2V5KSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdbU3RhcnR1cF0gRm91bmQgc3RvcmVkIE9wZW5BSSBrZXksIGF0dGVtcHRpbmcgdG8gY29uZmlndXJlIE9wZW5BSVByb3h5U2VydmljZS4uLicpO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGNvbmZpZ3VyZVJlc3VsdCA9IGF3YWl0IG9wZW5BSVByb3h5U2VydmljZUluc3RhbmNlLmhhbmRsZUNvbmZpZ3VyZShudWxsLCB7IGFwaUtleTogc3RvcmVkT3BlbkFJS2V5IH0pO1xyXG4gICAgICAgIGlmIChjb25maWd1cmVSZXN1bHQuc3VjY2Vzcykge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coJ1tTdGFydHVwXSBPcGVuQUlQcm94eVNlcnZpY2UgY29uZmlndXJlZCBzdWNjZXNzZnVsbHkgb24gc3RhcnR1cC4nKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKCdbU3RhcnR1cF0gT3BlbkFJUHJveHlTZXJ2aWNlIGNvbmZpZ3VyYXRpb24gZmFpbGVkIG9uIHN0YXJ0dXAuJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChjb25maWdFcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tTdGFydHVwXSBFcnJvciBjb25maWd1cmluZyBPcGVuQUlQcm94eVNlcnZpY2Ugb24gc3RhcnR1cDonLCBjb25maWdFcnJvcik7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdbU3RhcnR1cF0gTm8gc3RvcmVkIE9wZW5BSSBrZXkgZm91bmQuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gSW5pdGlhbGl6ZSB1cGRhdGUgbWFuYWdlclxyXG4gICAgdXBkYXRlTWFuYWdlciA9IG5ldyBVcGRhdGVNYW5hZ2VyKCk7XHJcbiAgICAgICAgdXBkYXRlTWFuYWdlci5pbml0aWFsaXplKCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBVcGRhdGUgbWFuYWdlciBpbml0aWFsaXplZCcpO1xyXG5cclxuICAgICAgICAvLyBTZXR1cCBiYXNpYyBJUEMgaGFuZGxlcnMgZmlyc3RcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+ToSBSZWdpc3RlcmluZyBiYXNpYyBJUEMgaGFuZGxlcnMuLi4nKTtcclxuICAgICAgICBzZXR1cEJhc2ljSGFuZGxlcnMoYXBwKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIEJhc2ljIElQQyBoYW5kbGVycyByZWdpc3RlcmVkIHN1Y2Nlc3NmdWxseScpO1xyXG5cclxuICAgICAgICAvLyBJbml0aWFsaXplIGNvcmUgc2VydmljZXNcclxuICAgICAgICBhd2FpdCBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLnNldHVwT3V0cHV0RGlyZWN0b3J5KCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBDb252ZXJzaW9uIHNlcnZpY2UgaW5pdGlhbGl6ZWQnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBTZXR1cCBub3RpZmljYXRpb25zIChub24tZmF0YWwgaWYgaXQgZmFpbHMpXHJcbiAgICAgICAgaWYgKCFzZXR1cE5vdGlmaWNhdGlvbnMoKSkge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oJ+KaoO+4jyBOb3RpZmljYXRpb25zIHVuYXZhaWxhYmxlIC0gY29udGludWluZyB3aXRob3V0IG5vdGlmaWNhdGlvbnMnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGFwcEluaXRpYWxpemVkID0gdHJ1ZTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBpbml0aWFsaXplIGFwcDonLCBlcnJvcik7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogQ3JlYXRlIHRoZSBtYWluIGFwcGxpY2F0aW9uIHdpbmRvd1xyXG4gKiBPbmx5IGNhbGxlZCBhZnRlciBpbml0aWFsaXphdGlvbiBpcyBjb21wbGV0ZVxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlTWFpbldpbmRvdygpIHtcclxuICAgIGlmICghYXBwSW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignQ2Fubm90IGNyZWF0ZSB3aW5kb3cgYmVmb3JlIGFwcCBpbml0aWFsaXphdGlvbicpO1xyXG4gICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoJ1dpbmRvdyBjcmVhdGlvbiBlcnJvcicsIGVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZygnQ3JlYXRpbmcgbWFpbiB3aW5kb3cnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBMb2cgYXBwIHBhdGhzIGZvciBkZWJ1Z2dpbmdcclxuICAgICAgICBjb25zdCBhcHBQYXRocyA9IHtcclxuICAgICAgICAgICAgYXBwUGF0aDogYXBwLmdldEFwcFBhdGgoKSxcclxuICAgICAgICAgICAgYXBwRGF0YTogYXBwLmdldFBhdGgoJ2FwcERhdGEnKSxcclxuICAgICAgICAgICAgdXNlckRhdGE6IGFwcC5nZXRQYXRoKCd1c2VyRGF0YScpLFxyXG4gICAgICAgICAgICBleGU6IGFwcC5nZXRQYXRoKCdleGUnKSxcclxuICAgICAgICAgICAgbW9kdWxlOiBhcHAuZ2V0UGF0aCgnbW9kdWxlJyksXHJcbiAgICAgICAgICAgIGN3ZDogcHJvY2Vzcy5jd2QoKSxcclxuICAgICAgICAgICAgcmVzb3VyY2VzUGF0aDogcHJvY2Vzcy5yZXNvdXJjZXNQYXRoIHx8ICd1bmRlZmluZWQnXHJcbiAgICAgICAgfTtcclxuICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0FwcGxpY2F0aW9uIHBhdGhzJywgYXBwUGF0aHMpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEdldCBwbGF0Zm9ybS1zcGVjaWZpYyBpY29uIHBhdGhcclxuICAgIGNvbnN0IGljb25QYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoXHJcbiAgICAgICAgcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCdcclxuICAgICAgICAgICAgPyBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vZnJvbnRlbmQvc3RhdGljL2xvZ28ucG5nJylcclxuICAgICAgICAgICAgOiBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ2Zyb250ZW5kL3N0YXRpYy9sb2dvLnBuZycpXHJcbiAgICApO1xyXG4gICAgXHJcbiAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0ljb24gcGF0aCcsIHsgaWNvblBhdGggfSk7XHJcblxyXG4gICAgICAgIC8vIFZlcmlmeSBpY29uIGV4aXN0c1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGljb25FeGlzdHMgPSBhd2FpdCBmcy5wYXRoRXhpc3RzKGljb25QYXRoKTtcclxuICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdJY29uIGZpbGUgY2hlY2snLCB7IGV4aXN0czogaWNvbkV4aXN0cywgcGF0aDogaWNvblBhdGggfSk7XHJcbiAgICAgICAgICAgIGlmICghaWNvbkV4aXN0cykge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLndhcm4oYEljb24gZmlsZSBkb2VzIG5vdCBleGlzdDogJHtpY29uUGF0aH1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcignRXJyb3IgY2hlY2tpbmcgaWNvbiBmaWxlJywgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBDb25maWd1cmUgd2luZG93IGZvciBwbGF0Zm9ybVxyXG4gICAgY29uc3Qgd2luZG93Q29uZmlnID0ge1xyXG4gICAgICAgIHdpZHRoOiAxMjAwLFxyXG4gICAgICAgIGhlaWdodDogODAwLFxyXG4gICAgICAgIG1pbldpZHRoOiA4MDAsXHJcbiAgICAgICAgbWluSGVpZ2h0OiA2MDAsXHJcbiAgICAgICAgaWNvbjogaWNvblBhdGgsXHJcbiAgICAgICAgd2ViUHJlZmVyZW5jZXM6IHtcclxuICAgICAgICAgICAgbm9kZUludGVncmF0aW9uOiBmYWxzZSxcclxuICAgICAgICAgICAgY29udGV4dElzb2xhdGlvbjogdHJ1ZSxcclxuICAgICAgICAgICAgcHJlbG9hZDogUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgocGF0aC5qb2luKF9fZGlybmFtZSwgJ3ByZWxvYWQuanMnKSlcclxuICAgICAgICB9LFxyXG4gICAgICAgIHNob3c6IGZhbHNlIC8vIERvbid0IHNob3cgdGhlIHdpbmRvdyB1bnRpbCBpdCdzIHJlYWR5XHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFBsYXRmb3JtLXNwZWNpZmljIHdpbmRvdyBzZXR0aW5nc1xyXG4gICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XHJcbiAgICAgICAgd2luZG93Q29uZmlnLnRpdGxlQmFyU3R5bGUgPSAnaGlkZGVuSW5zZXQnO1xyXG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XHJcbiAgICAgICAgd2luZG93Q29uZmlnLmZyYW1lID0gdHJ1ZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZ1dpbmRvd0NyZWF0aW9uKHdpbmRvd0NvbmZpZyk7XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgICBtYWluV2luZG93ID0gbmV3IEJyb3dzZXJXaW5kb3cod2luZG93Q29uZmlnKTtcclxuICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZygnQnJvd3NlcldpbmRvdyBjcmVhdGVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgICAgIH1cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcignRmFpbGVkIHRvIGNyZWF0ZSBCcm93c2VyV2luZG93JywgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gU2hvdyB3aW5kb3cgd2hlbiBpdCdzIHJlYWR5IHRvIGF2b2lkIHdoaXRlIGZsYXNoXHJcbiAgICBtYWluV2luZG93Lm9uY2UoJ3JlYWR5LXRvLXNob3cnLCAoKSA9PiB7XHJcbiAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgIGxvZ2dlci5sb2coJ1dpbmRvdyByZWFkeSB0byBzaG93IGV2ZW50IGZpcmVkJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIG1haW5XaW5kb3cuc2hvdygpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTG9hZCB0aGUgYXBwXHJcbiAgICBpZiAocHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCcpIHtcclxuICAgICAgICAvLyBEZXYgbW9kZSAtIGxvYWQgZnJvbSBkZXYgc2VydmVyXHJcbiAgICAgICAgbWFpbldpbmRvdy5sb2FkVVJMKCdodHRwOi8vbG9jYWxob3N0OjUxNzMnKTtcclxuICAgICAgICBtYWluV2luZG93LndlYkNvbnRlbnRzLm9wZW5EZXZUb29scygpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBQcm9kdWN0aW9uIC0gbG9hZCBsb2NhbCBmaWxlcyB1c2luZyBwbGF0Zm9ybS1zYWZlIHBhdGhzXHJcbiAgICAgICAgY29uc3QgYXBwUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKFxyXG4gICAgICAgICAgICBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50J1xyXG4gICAgICAgICAgICAgICAgPyBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vZnJvbnRlbmQvZGlzdC9pbmRleC5odG1sJylcclxuICAgICAgICAgICAgICAgIDogcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdmcm9udGVuZC9kaXN0L2luZGV4Lmh0bWwnKVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gRW5hYmxlIGRldiB0b29scyBpbiBwcm9kdWN0aW9uIGZvciBkZWJ1Z2dpbmcgaWYgbmVlZGVkXHJcbiAgICAgICAgbWFpbldpbmRvdy53ZWJDb250ZW50cy5vcGVuRGV2VG9vbHMoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBMb2cgdGhlIHBhdGggYmVpbmcgbG9hZGVkXHJcbiAgICAgICAgY29uc29sZS5sb2coJ0xvYWRpbmcgYXBwIGZyb20gcGF0aDonLCBhcHBQYXRoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBVc2UgZmlsZTovLyBwcm90b2NvbCBmb3IgbG9hZGluZyB0aGUgbWFpbiBIVE1MIGZpbGVcclxuICAgICAgICAvLyBUaGlzIGlzIHRoZSBzdGFuZGFyZCBhcHByb2FjaCBmb3IgRWxlY3Ryb24gYXBwc1xyXG4gICAgICAgIG1haW5XaW5kb3cubG9hZFVSTChcclxuICAgICAgICAgICAgdXJsLmZvcm1hdCh7XHJcbiAgICAgICAgICAgICAgICBwYXRobmFtZTogYXBwUGF0aCxcclxuICAgICAgICAgICAgICAgIHByb3RvY29sOiAnZmlsZTonLFxyXG4gICAgICAgICAgICAgICAgc2xhc2hlczogdHJ1ZVxyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgICk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gTG9nIGFueSBwYWdlIGxvYWQgZXJyb3JzXHJcbiAgICAgICAgbWFpbldpbmRvdy53ZWJDb250ZW50cy5vbignZGlkLWZhaWwtbG9hZCcsIChldmVudCwgZXJyb3JDb2RlLCBlcnJvckRlc2NyaXB0aW9uKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBsb2FkIGFwcDonLCBlcnJvckNvZGUsIGVycm9yRGVzY3JpcHRpb24pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQXR0ZW1wdCB0byByZWxvYWQgd2l0aCBhIHNsaWdodCBkZWxheSBhcyBhIGZhbGxiYWNrXHJcbiAgICAgICAgICAgIGlmIChlcnJvckNvZGUgIT09IC0zKSB7IC8vIElnbm9yZSBhYm9ydGVkIGxvYWRzXHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnQXR0ZW1wdGluZyBmYWxsYmFjayBsb2FkIGFmdGVyIGRlbGF5Li4uJyk7XHJcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBtYWluV2luZG93LmxvYWRVUkwoXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybC5mb3JtYXQoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aG5hbWU6IGFwcFBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm90b2NvbDogJ2ZpbGU6JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNsYXNoZXM6IHRydWVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgICAgfSwgMTAwMCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBTZXQgcGxhdGZvcm0tc3BlY2lmaWMgYXBwbGljYXRpb24gbWVudVxyXG4gICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XHJcbiAgICAgICAgY3JlYXRlTWFjTWVudSgpO1xyXG4gICAgICAgIC8vIE1ha2UgbWFpbldpbmRvdyBhdmFpbGFibGUgZ2xvYmFsbHkgZm9yIG1lbnUgYWN0aW9uc1xyXG4gICAgICAgIGdsb2JhbC5tYWluV2luZG93ID0gbWFpbldpbmRvdztcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gRm9yIFdpbmRvd3MgYW5kIExpbnV4LCB1c2UgYSBzaW1wbGVyIG1lbnUgb3IgZGVmYXVsdFxyXG4gICAgICAgIGNvbnN0IHsgTWVudSB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuICAgICAgICBNZW51LnNldEFwcGxpY2F0aW9uTWVudShNZW51LmJ1aWxkRnJvbVRlbXBsYXRlKFtcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdGaWxlJyxcclxuICAgICAgICAgICAgICAgIHN1Ym1lbnU6IFtcclxuICAgICAgICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnTmV3IENvbnZlcnNpb24nLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhY2NlbGVyYXRvcjogJ0NtZE9yQ3RybCtOJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2xpY2s6ICgpID0+IG1haW5XaW5kb3c/LndlYkNvbnRlbnRzLnNlbmQoJ21lbnU6bmV3LWNvbnZlcnNpb24nKVxyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgeyB0eXBlOiAnc2VwYXJhdG9yJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHsgcm9sZTogJ3F1aXQnIH1cclxuICAgICAgICAgICAgICAgIF1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdWaWV3JyxcclxuICAgICAgICAgICAgICAgIHN1Ym1lbnU6IFtcclxuICAgICAgICAgICAgICAgICAgICB7IHJvbGU6ICdyZWxvYWQnIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgeyByb2xlOiAndG9nZ2xlRGV2VG9vbHMnIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgeyB0eXBlOiAnc2VwYXJhdG9yJyB9LFxyXG4gICAgICAgICAgICAgICAgICAgIHsgcm9sZTogJ3RvZ2dsZWZ1bGxzY3JlZW4nIH1cclxuICAgICAgICAgICAgICAgIF1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIF0pKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBXaW5kb3cgZXZlbnQgaGFuZGxlcnNcclxuICAgIG1haW5XaW5kb3cub24oJ2Nsb3NlZCcsICgpID0+IHtcclxuICAgICAgICBtYWluV2luZG93ID0gbnVsbDtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE5vdGlmeSByZW5kZXJlciBwcm9jZXNzIHRoYXQgYXBwIGlzIHJlYWR5XHJcbiAgICBtYWluV2luZG93LndlYkNvbnRlbnRzLm9uKCdkaWQtZmluaXNoLWxvYWQnLCAoKSA9PiB7XHJcbiAgICAgICAgbWFpbldpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdhcHA6cmVhZHknLCB0cnVlKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIFNlbnQgYXBwOnJlYWR5IGV2ZW50IHRvIHJlbmRlcmVyJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4gbWFpbldpbmRvdztcclxufVxyXG5cclxuLyoqXHJcbiAqIFJlZ2lzdGVyIG1lZGlhIHByb3RvY29sIGhhbmRsZXIgd2l0aCBsb2dnaW5nXHJcbiAqL1xyXG5mdW5jdGlvbiByZWdpc3Rlck1lZGlhUHJvdG9jb2woKSB7XHJcbiAgICBwcm90b2NvbC5yZWdpc3RlckZpbGVQcm90b2NvbCgnbWVkaWEnLCBhc3luYyAocmVxdWVzdCwgY2FsbGJhY2spID0+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHJlcXVlc3QudXJsLnJlcGxhY2UoJ21lZGlhOi8vJywgJycpO1xyXG4gICAgICAgICAgICBjb25zdCBzYWZlUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKGRlY29kZVVSSShmaWxlUGF0aCkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nKGBNZWRpYSBwcm90b2NvbCBzZXJ2aW5nOiAke3NhZmVQYXRofWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdNZWRpYSBwcm90b2NvbCBzZXJ2aW5nOicsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgY2FsbGJhY2soc2FmZVBhdGgpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKGBNZWRpYSBwcm90b2NvbCBoYW5kbGVyIGVycm9yOiAke3JlcXVlc3QudXJsfWAsIGVycm9yKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBtZWRpYSBwcm90b2NvbCBoYW5kbGVyOicsIGVycm9yKTtcclxuICAgICAgICAgICAgY2FsbGJhY2soeyBlcnJvcjogLTIgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgIGxvZ2dlci5sb2coJ01lZGlhIHByb3RvY29sIGhhbmRsZXIgcmVnaXN0ZXJlZCcpO1xyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogUmVnaXN0ZXIgZW5oYW5jZWQgZmlsZSBwcm90b2NvbCBoYW5kbGVyIHdpdGggbG9nZ2luZ1xyXG4gKi9cclxuZnVuY3Rpb24gcmVnaXN0ZXJGaWxlUHJvdG9jb2woKSB7XHJcbiAgICBwcm90b2NvbC5yZWdpc3RlckZpbGVQcm90b2NvbCgnZmlsZScsIGFzeW5jIChyZXF1ZXN0LCBjYWxsYmFjaykgPT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGxldCBmaWxlUGF0aCA9IHJlcXVlc3QudXJsLnJlcGxhY2UoJ2ZpbGU6Ly8nLCAnJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnRmlsZSBwcm90b2NvbCByZXF1ZXN0JywgeyB1cmw6IHJlcXVlc3QudXJsLCBmaWxlUGF0aCB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnRmlsZSBwcm90b2NvbCByZXF1ZXN0OicsIGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIFdpbmRvd3MgYWJzb2x1dGUgcGF0aHMgd2l0aCBkcml2ZSBsZXR0ZXJzXHJcbiAgICAgICAgICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInICYmIGZpbGVQYXRoLm1hdGNoKC9eXFwvW0EtWmEtel06XFwvLykpIHtcclxuICAgICAgICAgICAgICAgIC8vIFJlbW92ZSB0aGUgbGVhZGluZyBzbGFzaCBiZWZvcmUgdGhlIGRyaXZlIGxldHRlclxyXG4gICAgICAgICAgICAgICAgZmlsZVBhdGggPSBmaWxlUGF0aC5yZXBsYWNlKC9eXFwvKFtBLVphLXpdOlxcLy4qPykkLywgJyQxJyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnTm9ybWFsaXplZCBXaW5kb3dzIHBhdGgnLCB7IGZpbGVQYXRoIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ05vcm1hbGl6ZWQgV2luZG93cyBwYXRoOicsIGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gU3BlY2lhbCBjYXNlIGZvciBpbmRleC5odG1sIHRvIGF2b2lkIFN2ZWx0ZUtpdCByb3V0aW5nIGlzc3Vlc1xyXG4gICAgICAgICAgICBpZiAoZmlsZVBhdGguZW5kc1dpdGgoJ2luZGV4Lmh0bWwnKSB8fCBmaWxlUGF0aC5lbmRzV2l0aCgnXFxcXGluZGV4Lmh0bWwnKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaW5kZXhQYXRoID0gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCdcclxuICAgICAgICAgICAgICAgICAgICA/IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9mcm9udGVuZC9kaXN0L2luZGV4Lmh0bWwnKVxyXG4gICAgICAgICAgICAgICAgICAgIDogcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdmcm9udGVuZC9kaXN0L2luZGV4Lmh0bWwnKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNhZmVQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoZGVjb2RlVVJJKGluZGV4UGF0aCkpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nQXNzZXRMb2FkaW5nKCdpbmRleC5odG1sJywgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIGZpbGUgZXhpc3RzXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXhpc3RzID0gYXdhaXQgZnMucGF0aEV4aXN0cyhzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnSW5kZXggZmlsZSBleGlzdHMgY2hlY2snLCB7IGV4aXN0cywgcGF0aDogc2FmZVBhdGggfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWV4aXN0cykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gTGlzdCBhbHRlcm5hdGl2ZSBwYXRocyB0byBjaGVja1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWx0ZXJuYXRpdmVQYXRocyA9IFtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ2Zyb250ZW5kL2Rpc3QvaW5kZXguaHRtbCcpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihwcm9jZXNzLnJlc291cmNlc1BhdGggfHwgJycsICdmcm9udGVuZC9kaXN0L2luZGV4Lmh0bWwnKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4oYXBwLmdldFBhdGgoJ2V4ZScpLCAnLi4vcmVzb3VyY2VzL2Zyb250ZW5kL2Rpc3QvaW5kZXguaHRtbCcpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBdO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0FsdGVybmF0aXZlIGluZGV4Lmh0bWwgcGF0aHMnLCB7IGFsdGVybmF0aXZlUGF0aHMgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGVhY2ggYWx0ZXJuYXRpdmUgcGF0aFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBhbHRQYXRoIG9mIGFsdGVybmF0aXZlUGF0aHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhbHRFeGlzdHMgPSBhd2FpdCBmcy5wYXRoRXhpc3RzKGFsdFBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0FsdGVybmF0aXZlIHBhdGggZXhpc3RzJywgeyBwYXRoOiBhbHRQYXRoLCBleGlzdHM6IGFsdEV4aXN0cyB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKGBFcnJvciBjaGVja2luZyBhbHRlcm5hdGl2ZSBwYXRoOiAke2FsdFBhdGh9YCwgZXJyKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIExpc3QgZGlzdCBkaXJlY3RvcnkgY29udGVudHNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlzdERpciA9IHBhdGguZGlybmFtZShzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGF3YWl0IGZzLnBhdGhFeGlzdHMoZGlzdERpcikpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZmlsZXMgPSBhd2FpdCBmcy5yZWFkZGlyKGRpc3REaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZGVidWcoJ0Rpc3QgZGlyZWN0b3J5IGNvbnRlbnRzJywgeyBkaXJlY3Rvcnk6IGRpc3REaXIsIGZpbGVzIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcignRXJyb3IgcmVhZGluZyBkaXN0IGRpcmVjdG9yeScsIGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmVycm9yKCdFcnJvciBjaGVja2luZyBpbmRleC5odG1sIGV4aXN0ZW5jZScsIGVycik7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU2VydmluZyBpbmRleC5odG1sIGZyb206Jywgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgY2FsbGJhY2soc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBIYW5kbGUgc3RhdGljIGFzc2V0cyBmcm9tIGZyb250ZW5kL3N0YXRpY1xyXG4gICAgICAgICAgICBpZiAoZmlsZVBhdGguaW5jbHVkZXMoJy9zdGF0aWMvJykgfHwgZmlsZVBhdGguaW5jbHVkZXMoJ1xcXFxzdGF0aWNcXFxcJykpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRpY0ZpbGUgPSBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRpY1BhdGggPSBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50J1xyXG4gICAgICAgICAgICAgICAgICAgID8gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Zyb250ZW5kL3N0YXRpYycsIHN0YXRpY0ZpbGUpXHJcbiAgICAgICAgICAgICAgICAgICAgOiBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ2Zyb250ZW5kL3N0YXRpYycsIHN0YXRpY0ZpbGUpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2FmZVBhdGggPSBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChkZWNvZGVVUkkoc3RhdGljUGF0aCkpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nQXNzZXRMb2FkaW5nKGZpbGVQYXRoLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgZmlsZSBleGlzdHNcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBleGlzdHMgPSBhd2FpdCBmcy5wYXRoRXhpc3RzKHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdTdGF0aWMgYXNzZXQgZXhpc3RzIGNoZWNrJywgeyBleGlzdHMsIHBhdGg6IHNhZmVQYXRoIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFleGlzdHMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyeSBmYWxsYmFjayBsb2NhdGlvbnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFsdFBhdGhzID0gW1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAncmVzb3VyY2VzL3N0YXRpYycsIHN0YXRpY0ZpbGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAncmVzb3VyY2VzL2Zyb250ZW5kL2Rpc3Qvc3RhdGljJywgc3RhdGljRmlsZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKHByb2Nlc3MucmVzb3VyY2VzUGF0aCB8fCAnJywgJ3N0YXRpYycsIHN0YXRpY0ZpbGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihwcm9jZXNzLnJlc291cmNlc1BhdGggfHwgJycsICdmcm9udGVuZC9kaXN0L3N0YXRpYycsIHN0YXRpY0ZpbGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihhcHAuZ2V0UGF0aCgnZXhlJyksICcuLi9yZXNvdXJjZXMvc3RhdGljJywgc3RhdGljRmlsZSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnQWx0ZXJuYXRpdmUgc3RhdGljIGFzc2V0IHBhdGhzJywgeyBmaWxlOiBzdGF0aWNGaWxlLCBwYXRoczogYWx0UGF0aHMgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGVhY2ggYWx0ZXJuYXRpdmUgcGF0aFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBhbHRQYXRoIG9mIGFsdFBhdGhzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWx0RXhpc3RzID0gYXdhaXQgZnMucGF0aEV4aXN0cyhhbHRQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdBbHRlcm5hdGl2ZSBwYXRoIGV4aXN0cycsIHsgcGF0aDogYWx0UGF0aCwgZXhpc3RzOiBhbHRFeGlzdHMgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoYWx0RXhpc3RzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nKGBGb3VuZCBhbHRlcm5hdGl2ZSBwYXRoIGZvciAke3N0YXRpY0ZpbGV9OiAke2FsdFBhdGh9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayhhbHRQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoYEVycm9yIGNoZWNraW5nIGFsdGVybmF0aXZlIHBhdGg6ICR7YWx0UGF0aH1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoYEVycm9yIGNoZWNraW5nIGV4aXN0ZW5jZSBvZiBzdGF0aWMgYXNzZXQ6ICR7c3RhdGljRmlsZX1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NlcnZpbmcgc3RhdGljIGFzc2V0IGZyb206Jywgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgY2FsbGJhY2soc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBIYW5kbGUgVml0ZS9TdmVsdGUgYXNzZXRzXHJcbiAgICAgICAgICAgIGlmIChmaWxlUGF0aC5pbmNsdWRlcygnL2Fzc2V0cy8nKSB8fCBmaWxlUGF0aC5pbmNsdWRlcygnXFxcXGFzc2V0c1xcXFwnKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYXNzZXRGaWxlID0gZmlsZVBhdGguc3Vic3RyaW5nKGZpbGVQYXRoLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGFzc2V0UGF0aCA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnXHJcbiAgICAgICAgICAgICAgICAgICAgPyBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vZnJvbnRlbmQvZGlzdC9hc3NldHMnLCBhc3NldEZpbGUpXHJcbiAgICAgICAgICAgICAgICAgICAgOiBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ2Zyb250ZW5kL2Rpc3QvYXNzZXRzJywgYXNzZXRGaWxlKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNhZmVQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoZGVjb2RlVVJJKGFzc2V0UGF0aCkpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nQXNzZXRMb2FkaW5nKGZpbGVQYXRoLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgZmlsZSBleGlzdHNcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBleGlzdHMgPSBhd2FpdCBmcy5wYXRoRXhpc3RzKHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmRlYnVnKCdBc3NldCBleGlzdHMgY2hlY2snLCB7IGV4aXN0cywgcGF0aDogc2FmZVBhdGggfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWV4aXN0cykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVHJ5IGZhbGxiYWNrIGxvY2F0aW9uc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWx0UGF0aHMgPSBbXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdmcm9udGVuZC9kaXN0L2Fzc2V0cycsIGFzc2V0RmlsZSksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdyZXNvdXJjZXMvZnJvbnRlbmQvZGlzdC9hc3NldHMnLCBhc3NldEZpbGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihwcm9jZXNzLnJlc291cmNlc1BhdGggfHwgJycsICdmcm9udGVuZC9kaXN0L2Fzc2V0cycsIGFzc2V0RmlsZSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5kZWJ1ZygnQWx0ZXJuYXRpdmUgYXNzZXQgcGF0aHMnLCB7IGZpbGU6IGFzc2V0RmlsZSwgcGF0aHM6IGFsdFBhdGhzIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5lcnJvcihgRXJyb3IgY2hlY2tpbmcgZXhpc3RlbmNlIG9mIGFzc2V0OiAke2Fzc2V0RmlsZX1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1NlcnZpbmcgVml0ZSBhc3NldCBmcm9tOicsIHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHNhZmVQYXRoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gU3BlY2lhbCBjYXNlIGZvciBkaXJlY3QgZmlsZSByZXF1ZXN0cyB3aXRoIG5vIHBhdGggKGp1c3QgYSBmaWxlbmFtZSlcclxuICAgICAgICAgICAgaWYgKCFmaWxlUGF0aC5pbmNsdWRlcygnLycpICYmICFmaWxlUGF0aC5pbmNsdWRlcygnXFxcXCcpICYmIGZpbGVQYXRoLmluY2x1ZGVzKCcuJykpIHtcclxuICAgICAgICAgICAgICAgIGlmIChsb2dnZXJJbml0aWFsaXplZCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2coJ0RldGVjdGVkIGRpcmVjdCBmaWxlIHJlcXVlc3Qgd2l0aCBubyBwYXRoJyk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnRGV0ZWN0ZWQgZGlyZWN0IGZpbGUgcmVxdWVzdCB3aXRoIG5vIHBhdGgnKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gVHJ5IHRvIGZpbmQgdGhlIGZpbGUgaW4gdGhlIGRpc3QgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICBjb25zdCBkaXN0UGF0aCA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnXHJcbiAgICAgICAgICAgICAgICAgICAgPyBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vZnJvbnRlbmQvZGlzdCcsIGZpbGVQYXRoKVxyXG4gICAgICAgICAgICAgICAgICAgIDogcGF0aC5qb2luKGFwcC5nZXRBcHBQYXRoKCksICdmcm9udGVuZC9kaXN0JywgZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2FmZVBhdGggPSBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChkZWNvZGVVUkkoZGlzdFBhdGgpKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgbG9nZ2VyLmxvZ0Fzc2V0TG9hZGluZyhmaWxlUGF0aCwgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnU2VydmluZyBkaXJlY3QgZmlsZSBmcm9tIGRpc3Q6Jywgc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgY2FsbGJhY2soc2FmZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBIYW5kbGUgb3RoZXIgZmlsZTovLyByZXF1ZXN0cyBub3JtYWxseVxyXG4gICAgICAgICAgICBjb25zdCBzYWZlUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKGRlY29kZVVSSShmaWxlUGF0aCkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGxvZ2dlckluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBsb2dnZXIubG9nQXNzZXRMb2FkaW5nKGZpbGVQYXRoLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTZXJ2aW5nIHN0YW5kYXJkIGZpbGUgZnJvbTonLCBzYWZlUGF0aCk7XHJcbiAgICAgICAgICAgIGNhbGxiYWNrKHNhZmVQYXRoKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGxvZ2dlci5sb2dQcm90b2NvbEVycm9yKHJlcXVlc3QudXJsLCBlcnJvcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGZpbGUgcHJvdG9jb2wgaGFuZGxlcjonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIGNhbGxiYWNrKHsgZXJyb3I6IC0yIH0pOyAvLyBGYWlsZWQgdG8gbG9hZFxyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICBsb2dnZXIubG9nKCdGaWxlIHByb3RvY29sIGhhbmRsZXIgcmVnaXN0ZXJlZCcpO1xyXG4gICAgfVxyXG59XHJcblxyXG4vLyBEaXJlY3QgY29uc29sZSBvdXRwdXQgZm9yIGRlYnVnZ2luZ1xyXG5jb25zb2xlLmxvZygnPT09PT09IEVMRUNUUk9OIEFQUCBTVEFSVElORyA9PT09PT0nKTtcclxuY29uc29sZS5sb2coJ1dvcmtpbmcgZGlyZWN0b3J5OicsIHByb2Nlc3MuY3dkKCkpO1xyXG5jb25zb2xlLmxvZygnQXBwIHBhdGg6JywgYXBwLmdldEFwcFBhdGgoKSk7XHJcbmNvbnNvbGUubG9nKCdSZXNvdXJjZSBwYXRoOicsIHByb2Nlc3MucmVzb3VyY2VzUGF0aCk7XHJcbmNvbnNvbGUubG9nKCdFeGVjdXRhYmxlIHBhdGg6JywgcHJvY2Vzcy5leGVjUGF0aCk7XHJcbmNvbnNvbGUubG9nKCdOT0RFX0VOVjonLCBwcm9jZXNzLmVudi5OT0RFX0VOVik7XHJcbmNvbnNvbGUubG9nKCc9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0nKTtcclxuXHJcbi8vIEFwcCBzdGFydHVwIHNlcXVlbmNlXHJcbmFwcC53aGVuUmVhZHkoKS50aGVuKGFzeW5jICgpID0+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ0FwcCByZWFkeSBldmVudCBmaXJlZCcpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEluaXRpYWxpemUgbG9nZ2VyIGZpcnN0IHRoaW5nXHJcbiAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZUxvZ2dlcigpO1xyXG4gICAgICAgIGF3YWl0IGxvZ2dlci5sb2dTdGFydHVwKCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmVnaXN0ZXIgcHJvdG9jb2wgaGFuZGxlcnNcclxuICAgICAgICBjb25zb2xlLmxvZygnUmVnaXN0ZXJpbmcgcHJvdG9jb2wgaGFuZGxlcnMnKTtcclxuICAgICAgICByZWdpc3Rlck1lZGlhUHJvdG9jb2woKTtcclxuICAgICAgICByZWdpc3RlckZpbGVQcm90b2NvbCgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEluaXRpYWxpemUgYXBwIGJlZm9yZSBjcmVhdGluZyB3aW5kb3dcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+agCBTdGFydGluZyBhcHAgaW5pdGlhbGl6YXRpb24uLi4nKTtcclxuICAgICAgICBjb25zdCBzdWNjZXNzID0gYXdhaXQgaW5pdGlhbGl6ZUFwcCgpO1xyXG4gICAgICAgIGlmICghc3VjY2Vzcykge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgQXBwIGluaXRpYWxpemF0aW9uIGZhaWxlZCcpO1xyXG4gICAgICAgICAgICBhcHAucXVpdCgpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBDcmVhdGUgYW5kIHNldHVwIHdpbmRvd1xyXG4gICAgICAgIG1haW5XaW5kb3cgPSBhd2FpdCBjcmVhdGVBbmRTZXR1cFdpbmRvdygpO1xyXG4gICAgICAgIGlmICghbWFpbldpbmRvdykge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGNyZWF0ZSBtYWluIHdpbmRvdycpO1xyXG4gICAgICAgICAgICBhcHAucXVpdCgpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBTZXR1cCB0cmF5IGFmdGVyIHdpbmRvdyBjcmVhdGlvblxyXG4gICAgICAgIHNldHVwVHJheSgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgTWFpbiB3aW5kb3cgY3JlYXRlZCBhbmQgaW5pdGlhbGl6ZWQnKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIENyaXRpY2FsIHN0YXJ0dXAgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICAgIGFwcC5xdWl0KCk7XHJcbiAgICB9XHJcbn0pO1xyXG5cclxuLy8gSGFuZGxlIG1hY09TIGFjdGl2YXRpb25cclxuYXBwLm9uKCdhY3RpdmF0ZScsIGFzeW5jICgpID0+IHtcclxuICAgIGlmIChtYWluV2luZG93ID09PSBudWxsICYmIGFwcEluaXRpYWxpemVkKSB7XHJcbiAgICAgICAgLy8gQ3JlYXRlIGFuZCBzZXR1cCBuZXcgd2luZG93XHJcbiAgICAgICAgbWFpbldpbmRvdyA9IGF3YWl0IGNyZWF0ZUFuZFNldHVwV2luZG93KCk7XHJcbiAgICAgICAgaWYgKCFtYWluV2luZG93KSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gcmVzdG9yZSB3aW5kb3cgb24gYWN0aXZhdGUnKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBSZS1zZXR1cCB0cmF5IHdpdGggbmV3IHdpbmRvd1xyXG4gICAgICAgIHNldHVwVHJheSgpO1xyXG4gICAgfVxyXG59KTtcclxuXHJcbi8vIEhhbmRsZSB3aW5kb3cgY2xvc2VcclxuYXBwLm9uKCd3aW5kb3ctYWxsLWNsb3NlZCcsICgpID0+IHtcclxuICAgIC8vIENsZWFuIHVwIHdpbmRvdy1zcGVjaWZpYyBoYW5kbGVyc1xyXG4gICAgaWYgKHR5cGVvZiBjbGVhbnVwV2luZG93SGFuZGxlcnMgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICBjbGVhbnVwV2luZG93SGFuZGxlcnMoKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDbGVhbiB1cCB0cmF5XHJcbiAgICBpZiAodHJheU1hbmFnZXIpIHtcclxuICAgICAgICB0cmF5TWFuYWdlci5kZXN0cm95KCk7XHJcbiAgICAgICAgdHJheU1hbmFnZXIgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBRdWl0IGZvciBub24tbWFjT1MgcGxhdGZvcm1zXHJcbiAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSAhPT0gJ2RhcndpbicpIHtcclxuICAgICAgICBhcHAucXVpdCgpO1xyXG4gICAgfVxyXG59KTtcclxuXHJcbi8vIENsZWFuIHVwIG9uIHF1aXRcclxuYXBwLm9uKCd3aWxsLXF1aXQnLCAoKSA9PiB7XHJcbiAgICBpZiAodHJheU1hbmFnZXIpIHtcclxuICAgICAgICB0cmF5TWFuYWdlci5kZXN0cm95KCk7XHJcbiAgICAgICAgdHJheU1hbmFnZXIgPSBudWxsO1xyXG4gICAgfVxyXG4gICAgbm90aWZpY2F0aW9uTWFuYWdlciA9IG51bGw7XHJcbiAgICB1cGRhdGVNYW5hZ2VyID0gbnVsbDtcclxufSk7XHJcblxyXG4vLyBIYW5kbGUgZmF0YWwgZXJyb3JzXHJcbnByb2Nlc3Mub24oJ3VuY2F1Z2h0RXhjZXB0aW9uJywgYXN5bmMgKGVycm9yKSA9PiB7XHJcbiAgICBjb25zb2xlLmVycm9yKCfinYwgVW5jYXVnaHQgZXhjZXB0aW9uOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgLy8gTG9nIHRvIGZpbGUgaWYgbG9nZ2VyIGlzIGluaXRpYWxpemVkXHJcbiAgICBpZiAobG9nZ2VySW5pdGlhbGl6ZWQpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBhd2FpdCBsb2dnZXIuZXJyb3IoJ1VuY2F1Z2h0IGV4Y2VwdGlvbicsIGVycm9yKTtcclxuICAgICAgICB9IGNhdGNoIChsb2dFcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGxvZyB1bmNhdWdodCBleGNlcHRpb246JywgbG9nRXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gVHJ5IHRvIHNlbmQgdG8gcmVuZGVyZXJcclxuICAgIGlmIChtYWluV2luZG93Py53ZWJDb250ZW50cykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIG1haW5XaW5kb3cud2ViQ29udGVudHMuc2VuZCgnYXBwOmVycm9yJywgZXJyb3IubWVzc2FnZSk7XHJcbiAgICAgICAgfSBjYXRjaCAoc2VuZEVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gc2VuZCBlcnJvciB0byB3aW5kb3c6Jywgc2VuZEVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn0pO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUFBLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLG9EQUFvREMsT0FBTyxDQUFDQyxRQUFRLENBQUNDLElBQUksRUFBRSxDQUFDO0FBQ3hGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU07RUFBRUMsR0FB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