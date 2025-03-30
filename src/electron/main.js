/**
 * Main process entry point for the Electron application.
 * Handles window management, IPC communication, and native system integration.
 * 
 * Related files:
 * - preload.js: Bridges main and renderer processes securely
 * - ipc/handlers.js: IPC main process handlers
 * - ipc/types.js: TypeScript definitions for IPC messages
 * - features/tray.js: System tray integration
 * - features/notifications.js: Native notifications
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const crypto = require('crypto');
const machineId = require('node-machine-id');
const { setupIPCHandlers } = require('./ipc/handlers');
const { IPCChannels } = require('./ipc/types');
const TrayManager = require('./features/tray');
const NotificationManager = require('./features/notifications');
const BrowserService = require('./services/BrowserService');
const { createStore } = require('./utils/storeFactory');

// Generate machine-specific encryption key for the store
const generateStoreKey = async () => {
  const id = await machineId.machineId();
  return crypto.createHash('sha256').update(id).digest('hex');
};

// Initialize store for settings persistence and managers
let store;
let trayManager;
let notificationManager;

/**
 * Creates the main application window with secure configurations
 * @returns {Electron.BrowserWindow} The created window instance
 */
function createWindow() {
  // Ensure store is initialized before creating window
  if (!store) {
    throw new Error('Store must be initialized before creating window');
  }

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true, // Required for security
      nodeIntegration: false, // Disabled for security
      sandbox: true, // Enable sandbox for additional security
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // In development, load Svelte dev server
  // In production, load built Svelte app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../frontend/build/index.html'));
  }

  return mainWindow;
}

// Initialize app when ready
app.whenReady().then(async () => {
  try {
    // First initialize the store with error handling
    const encryptionKey = await generateStoreKey();
    process.env.STORE_ENCRYPTION_KEY = encryptionKey;
    store = createStore('app-settings', { encryptionKey });
    
    // Set up default settings if they don't exist
    if (!store.has('tempDirectory')) {
      // Create a temp directory in the app's user data folder
      const tempDir = path.join(app.getPath('userData'), 'temp');
      store.set('tempDirectory', tempDir);
      console.log('Set default temp directory:', tempDir);
    }
    
    // Clear any Puppeteer environment variables that might interfere with proper installation
    delete process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;

    // Initialize the browser service
    console.log('Initializing browser service...');
    try {
      await BrowserService.initialize();
      console.log('Browser service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize browser service:', error);
      // Non-fatal error, continue app initialization but log the full error
      console.error('Full error details:', error);
    }

    // Then create the window
    const mainWindow = createWindow();
    
    // Setup IPC handlers
    setupIPCHandlers(app, mainWindow);
    
    // Initialize desktop features
    trayManager = new TrayManager(mainWindow, store);
    notificationManager = new NotificationManager();
    
    // Make notification manager available to IPC handlers
    global.notificationManager = notificationManager;

    // Handle window creation on macOS when clicking dock icon
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });

    // Handle squirrel events for Windows installer
    if (require('electron-squirrel-startup')) app.quit();
  } catch (error) {
    console.error('Failed to initialize app:', error);
    app.quit();
  }
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up resources when quitting
app.on('will-quit', async () => {
  if (trayManager) {
    trayManager.destroy();
  }
  
  // Close the browser service
  try {
    console.log('Closing browser service...');
    await BrowserService.close();
  } catch (error) {
    console.error('Error closing browser service:', error);
  }
});

// Handle any uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
