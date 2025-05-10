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
    '/resources/app.asar/src/electron/': '/resources/app.asar/build/electron/',
  };

  // Only install the override once
  if (!Module._originalResolveFilename) {
    // Store the original for restoration if needed
    Module._originalResolveFilename = originalResolveFilename;

    // Replace with our patched version
    Module._resolveFilename = function(request, parent, isMain, options) {
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
        if (typeof request === 'string' &&
            request.includes('src') &&
            request.includes('ConverterRegistry.js')) {
          const buildPath = request.replace(/src[\\\/]electron/, 'build/electron')
                                 .replace(/src\\electron/, 'build\\electron');
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

const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs-extra');
const { PathUtils } = require('./utils/paths');
const logger = require('./utils/logger');
const ElectronConversionService = require('./services/ElectronConversionService');
const { createMacMenu } = require('./features/menu');
const { setupBasicHandlers, setupWindowHandlers, cleanupWindowHandlers } = require('./ipc/handlers');
const TrayManager = require('./features/tray');
const NotificationManager = require('./features/notifications');
const UpdateManager = require('./features/updater');
const { createStore } = require('./utils/storeFactory');
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
        const configResult = await deepgramService.handleConfigure(null, { apiKey: deepgramApiKey });
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
    const iconPath = PathUtils.normalizePath(
        process.env.NODE_ENV === 'development'
            ? path.join(__dirname, '../frontend/static/logo.png')
            : path.join(app.getAppPath(), 'frontend/static/logo.png')
    );
    
    if (loggerInitialized) {
        await logger.debug('Icon path', { iconPath });

        // Verify icon exists
        try {
            const iconExists = await fs.pathExists(iconPath);
            await logger.debug('Icon file check', { exists: iconExists, path: iconPath });
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
        const appPath = PathUtils.normalizePath(
            process.env.NODE_ENV === 'development'
                ? path.join(__dirname, '../frontend/dist/index.html')
                : path.join(app.getAppPath(), 'frontend/dist/index.html')
        );
        
        // Enable dev tools in production for debugging if needed
        mainWindow.webContents.openDevTools();
        
        // Log the path being loaded
        console.log('Loading app from path:', appPath);
        
        // Use file:// protocol for loading the main HTML file
        // This is the standard approach for Electron apps
        mainWindow.loadURL(
            url.format({
                pathname: appPath,
                protocol: 'file:',
                slashes: true
            })
        );
        
        // Log any page load errors
        mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            console.error('Failed to load app:', errorCode, errorDescription);
            
            // Attempt to reload with a slight delay as a fallback
            if (errorCode !== -3) { // Ignore aborted loads
                console.log('Attempting fallback load after delay...');
                setTimeout(() => {
                    mainWindow.loadURL(
                        url.format({
                            pathname: appPath,
                            protocol: 'file:',
                            slashes: true
                        })
                    );
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
        const { Menu } = require('electron');
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            {
                label: 'File',
                submenu: [
                    {
                        label: 'New Conversion',
                        accelerator: 'CmdOrCtrl+N',
                        click: () => mainWindow?.webContents.send('menu:new-conversion')
                    },
                    { type: 'separator' },
                    { role: 'quit' }
                ]
            },
            {
                label: 'View',
                submenu: [
                    { role: 'reload' },
                    { role: 'toggleDevTools' },
                    { type: 'separator' },
                    { role: 'togglefullscreen' }
                ]
            }
        ]));
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
            callback({ error: -2 });
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
                await logger.debug('File protocol request', { url: request.url, filePath });
            }
            console.log('File protocol request:', filePath);
            
            // Special handling for Windows absolute paths with drive letters
            if (process.platform === 'win32' && filePath.match(/^\/[A-Za-z]:\//)) {
                // Remove the leading slash before the drive letter
                filePath = filePath.replace(/^\/([A-Za-z]:\/.*?)$/, '$1');
                
                if (loggerInitialized) {
                    await logger.debug('Normalized Windows path', { filePath });
                }
                console.log('Normalized Windows path:', filePath);
            }
            
            // Special case for index.html to avoid SvelteKit routing issues
            if (filePath.endsWith('index.html') || filePath.endsWith('\\index.html')) {
                const indexPath = process.env.NODE_ENV === 'development'
                    ? path.join(__dirname, '../frontend/dist/index.html')
                    : path.join(app.getAppPath(), 'frontend/dist/index.html');
                    
                const safePath = PathUtils.normalizePath(decodeURI(indexPath));
                
                if (loggerInitialized) {
                    await logger.logAssetLoading('index.html', safePath);
                    
                    // Check if file exists
                    try {
                        const exists = await fs.pathExists(safePath);
                        await logger.debug('Index file exists check', { exists, path: safePath });
                        
                        if (!exists) {
                            // List alternative paths to check
                            const alternativePaths = [
                                path.join(app.getAppPath(), 'frontend/dist/index.html'),
                                path.join(process.resourcesPath || '', 'frontend/dist/index.html'),
                                path.join(app.getPath('exe'), '../resources/frontend/dist/index.html')
                            ];
                            
                            await logger.debug('Alternative index.html paths', { alternativePaths });
                            
                            // Check each alternative path
                            for (const altPath of alternativePaths) {
                                try {
                                    const altExists = await fs.pathExists(altPath);
                                    await logger.debug('Alternative path exists', { path: altPath, exists: altExists });
                                } catch (err) {
                                    await logger.error(`Error checking alternative path: ${altPath}`, err);
                                }
                            }
                            
                            // List dist directory contents
                            try {
                                const distDir = path.dirname(safePath);
                                if (await fs.pathExists(distDir)) {
                                    const files = await fs.readdir(distDir);
                                    await logger.debug('Dist directory contents', { directory: distDir, files });
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
                const staticPath = process.env.NODE_ENV === 'development'
                    ? path.join(__dirname, '../frontend/static', staticFile)
                    : path.join(app.getAppPath(), 'frontend/static', staticFile);
                    
                const safePath = PathUtils.normalizePath(decodeURI(staticPath));
                
                if (loggerInitialized) {
                    await logger.logAssetLoading(filePath, safePath);
                    
                    // Check if file exists
                    try {
                        const exists = await fs.pathExists(safePath);
                        await logger.debug('Static asset exists check', { exists, path: safePath });
                        
                        if (!exists) {
                            // Try fallback locations
                            const altPaths = [
                                path.join(app.getAppPath(), 'resources/static', staticFile),
                                path.join(app.getAppPath(), 'resources/frontend/dist/static', staticFile),
                                path.join(process.resourcesPath || '', 'static', staticFile),
                                path.join(process.resourcesPath || '', 'frontend/dist/static', staticFile),
                                path.join(app.getPath('exe'), '../resources/static', staticFile)
                            ];
                            
                            await logger.debug('Alternative static asset paths', { file: staticFile, paths: altPaths });
                            
                            // Check each alternative path
                            for (const altPath of altPaths) {
                                try {
                                    const altExists = await fs.pathExists(altPath);
                                    await logger.debug('Alternative path exists', { path: altPath, exists: altExists });
                                    
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
                const assetPath = process.env.NODE_ENV === 'development'
                    ? path.join(__dirname, '../frontend/dist/assets', assetFile)
                    : path.join(app.getAppPath(), 'frontend/dist/assets', assetFile);
                    
                const safePath = PathUtils.normalizePath(decodeURI(assetPath));
                
                if (loggerInitialized) {
                    await logger.logAssetLoading(filePath, safePath);
                    
                    // Check if file exists
                    try {
                        const exists = await fs.pathExists(safePath);
                        await logger.debug('Asset exists check', { exists, path: safePath });
                        
                        if (!exists) {
                            // Try fallback locations
                            const altPaths = [
                                path.join(app.getAppPath(), 'frontend/dist/assets', assetFile),
                                path.join(app.getAppPath(), 'resources/frontend/dist/assets', assetFile),
                                path.join(process.resourcesPath || '', 'frontend/dist/assets', assetFile)
                            ];
                            
                            await logger.debug('Alternative asset paths', { file: assetFile, paths: altPaths });
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
                const distPath = process.env.NODE_ENV === 'development'
                    ? path.join(__dirname, '../frontend/dist', filePath)
                    : path.join(app.getAppPath(), 'frontend/dist', filePath);
                    
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
            callback({ error: -2 }); // Failed to load
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
process.on('uncaughtException', async (error) => {
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
