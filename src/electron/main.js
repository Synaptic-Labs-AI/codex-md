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
        path.join(__dirname, '../../frontend/static/logo.png')
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
            path.join(__dirname, '../frontend/dist/index.html')
        );
        
        mainWindow.loadURL(
            url.format({
                pathname: appPath,
                protocol: 'file:',
                slashes: true
            })
        );
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
// Register protocols with platform-safe paths
protocol.registerFileProtocol('media', (request, callback) => {
    const filePath = request.url.replace('media://', '');
    const safePath = PathUtils.normalizePath(decodeURI(filePath));
    callback(safePath);
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
