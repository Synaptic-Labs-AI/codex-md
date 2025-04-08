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

const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');
const url = require('url');
const { utils } = require('@codex-md/shared');
const { PathUtils } = utils.paths;
const ElectronConversionService = require('./services/ElectronConversionService');
const { createMacMenu } = require('./features/menu');
const { setupBasicHandlers, setupWindowHandlers, cleanupWindowHandlers } = require('./ipc/handlers');
const TrayManager = require('./features/tray');
const NotificationManager = require('./features/notifications');
const UpdateManager = require('./features/updater');
const { createStore } = require('./utils/storeFactory');

// Keep a global reference of objects
let mainWindow;
let appInitialized = false;
let trayManager = null;
let notificationManager = null;
let updateManager = null;

// Initialize tray store
const trayStore = createStore('tray-manager', {
    encryptionKey: process.env.STORE_ENCRYPTION_KEY
});

/**
 * Setup notifications with error handling
 */
function setupNotifications() {
    try {
        notificationManager = new NotificationManager();
        console.log('✅ Notifications initialized');
        return true;
    } catch (error) {
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
        const window = createMainWindow();
        
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
function createMainWindow() {
    if (!appInitialized) {
        throw new Error('Cannot create window before app initialization');
    }

    // Get platform-specific icon path
    const iconPath = PathUtils.normalizePath(
        process.env.NODE_ENV === 'development'
            ? path.join(__dirname, '../frontend/static/logo.png')
            : path.join(app.getAppPath(), 'frontend/static/logo.png')
    );

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
        }
    };

    // Platform-specific window settings
    if (process.platform === 'darwin') {
        windowConfig.titleBarStyle = 'hiddenInset';
    } else if (process.platform === 'win32') {
        windowConfig.frame = true;
    }

    mainWindow = new BrowserWindow(windowConfig);

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

// App startup sequence
app.whenReady().then(async () => {
    try {
// Register standard protocols with enhanced error handling
protocol.registerFileProtocol('media', (request, callback) => {
    try {
        const filePath = request.url.replace('media://', '');
        const safePath = PathUtils.normalizePath(decodeURI(filePath));
        console.log('Media protocol serving:', safePath);
        callback(safePath);
    } catch (error) {
        console.error('Error in media protocol handler:', error);
        callback({ error: -2 });
    }
});

// Enhanced file protocol handler with proper ASAR-aware path resolution
protocol.registerFileProtocol('file', (request, callback) => {
    try {
        let filePath = request.url.replace('file://', '');
        console.log('File protocol request:', filePath);
        
        // Special handling for Windows absolute paths with drive letters
        if (process.platform === 'win32' && filePath.match(/^\/[A-Za-z]:\//)) {
            // Remove the leading slash before the drive letter
            filePath = filePath.replace(/^\/([A-Za-z]:\/.*?)$/, '$1');
            console.log('Normalized Windows path:', filePath);
        }
        
        // Handle static assets from frontend/static
        if (filePath.includes('/static/') || filePath.includes('\\static\\')) {
            const staticFile = path.basename(filePath);
            const staticPath = process.env.NODE_ENV === 'development'
                ? path.join(__dirname, '../frontend/static', staticFile)
                : path.join(app.getAppPath(), 'frontend/static', staticFile);
                
            const safePath = PathUtils.normalizePath(decodeURI(staticPath));
            console.log('Serving static asset from:', safePath);
            callback(safePath);
            return;
        }
        
        // Special case for SvelteKit _app/immutable paths (common in newer SvelteKit builds)
        if (filePath.includes('/_app/immutable/') || filePath.includes('\\_app\\immutable\\')) {
            console.log('Detected _app/immutable path pattern');
            
            // Extract the path after _app
            const appPath = filePath.replace(/^.*?_app[\/\\](.*)$/, '$1');
            
            // Map to the correct dist directory with ASAR awareness
            const distPath = process.env.NODE_ENV === 'development'
                ? path.join(__dirname, '../frontend/dist/_app', appPath)
                : path.join(app.getAppPath(), 'frontend/dist/_app', appPath);
                
            const safePath = PathUtils.normalizePath(decodeURI(distPath));
            console.log('Serving SvelteKit _app/immutable asset from:', safePath);
            callback(safePath);
            return;
        }
        
        // Handle SvelteKit assets in the dist directory
        if (filePath.includes('/immutable/') || 
            filePath.includes('\\immutable\\') || 
            filePath.includes('/_app/') || 
            filePath.includes('\\_app\\')) {
            
            console.log('Detected standard SvelteKit asset path pattern');
            
            // Determine if this is an immutable or _app path
            let assetPath;
            if (filePath.includes('/immutable/') || filePath.includes('\\immutable\\')) {
                assetPath = filePath.replace(/^.*?(immutable[\/\\].*)$/, '$1');
                console.log('Extracted immutable asset path:', assetPath);
            } else {
                assetPath = filePath.replace(/^.*?_app[\/\\](.*)$/, '$1');
                console.log('Extracted _app asset path:', assetPath);
            }
            
            // Map to the correct dist directory with ASAR awareness
            const distPath = process.env.NODE_ENV === 'development'
                ? path.join(__dirname, '../frontend/dist', assetPath)
                : path.join(app.getAppPath(), 'frontend/dist', assetPath);
                
            const safePath = PathUtils.normalizePath(decodeURI(distPath));
            console.log('Serving SvelteKit asset from:', safePath);
            callback(safePath);
            return;
        }
        
        // Special case for index.html to avoid SvelteKit routing issues
        if (filePath.endsWith('index.html') || filePath.endsWith('\\index.html')) {
            const indexPath = process.env.NODE_ENV === 'development'
                ? path.join(__dirname, '../frontend/dist/index.html')
                : path.join(app.getAppPath(), 'frontend/dist/index.html');
                
            const safePath = PathUtils.normalizePath(decodeURI(indexPath));
            console.log('Serving index.html from:', safePath);
            callback(safePath);
            return;
        }
        
        // Special case for direct file requests with no path (just a filename)
        // This handles cases where SvelteKit generates direct references to files in the root
        if (!filePath.includes('/') && !filePath.includes('\\') && filePath.includes('.')) {
            console.log('Detected direct file request with no path');
            
            // Try to find the file in the dist directory
            const distPath = process.env.NODE_ENV === 'development'
                ? path.join(__dirname, '../frontend/dist', filePath)
                : path.join(app.getAppPath(), 'frontend/dist', filePath);
                
            const safePath = PathUtils.normalizePath(decodeURI(distPath));
            console.log('Serving direct file from dist:', safePath);
            callback(safePath);
            return;
        }
        
        // Handle other file:// requests normally
        const safePath = PathUtils.normalizePath(decodeURI(filePath));
        console.log('Serving standard file from:', safePath);
        callback(safePath);
    } catch (error) {
        console.error('Error in file protocol handler:', error);
        callback({ error: -2 }); // Failed to load
    }
});

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
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    if (mainWindow?.webContents) {
        try {
            mainWindow.webContents.send('app:error', error.message);
        } catch (sendError) {
            console.error('❌ Failed to send error to window:', sendError);
        }
    }
});
