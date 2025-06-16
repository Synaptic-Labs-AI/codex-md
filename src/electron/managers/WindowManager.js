/**
 * WindowManager.js
 * 
 * Manages the application's window(s), handling creation,
 * initialization, positioning, and lifecycle.
 * 
 * This module extracts window management logic from main.js to
 * provide a more modular architecture.
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { PathUtils } = require('../utils/paths');
const logger = require('../utils/logger');
const { setupWindowHandlers, cleanupWindowHandlers } = require('../ipc/handlers');

class WindowManager {
    constructor() {
        this.mainWindow = null;
        this.isInitialized = false;
    }

    /**
     * Initialize the window manager
     * @returns {Promise<boolean>} Success status
     */
    async initialize() {
        this.isInitialized = true;
        return true;
    }

    /**
     * Create and setup the main application window
     * @returns {Promise<Electron.BrowserWindow|null>} Created window or null on failure
     */
    async createMainWindow() {
        try {
            if (!this.isInitialized) {
                console.warn('WindowManager not initialized. Initializing now...');
                await this.initialize();
            }

            console.log('Creating main window...');
            const window = await this._createWindow();
            
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
            
            this.mainWindow = window;
            return window;
        } catch (error) {
            console.error('❌ Failed to create and setup window:', error);
            return null;
        }
    }

    /**
     * Internal method to create a window with the proper configuration
     * @private
     * @returns {Promise<Electron.BrowserWindow>} Created window
     */
    async _createWindow() {
        try {
            if (logger.isInitialized) {
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
                    ? path.join(__dirname, '../../frontend/static/logo.png')
                    : path.join(app.getAppPath(), 'frontend/static/logo.png')
            );
            
            if (logger.isInitialized) {
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
                    preload: PathUtils.normalizePath(path.join(__dirname, '../preload.js'))
                },
                show: false // Don't show the window until it's ready
            };

            // Platform-specific window settings
            if (process.platform === 'darwin') {
                windowConfig.titleBarStyle = 'hiddenInset';
            } else if (process.platform === 'win32') {
                windowConfig.frame = true;
            }
            
            if (logger.isInitialized) {
                await logger.logWindowCreation(windowConfig);
            }

            try {
                const window = new BrowserWindow(windowConfig);
                if (logger.isInitialized) {
                    await logger.log('BrowserWindow created successfully');
                }
            
                // Show window when it's ready to avoid white flash
                window.once('ready-to-show', () => {
                    if (logger.isInitialized) {
                        logger.log('Window ready to show event fired');
                    }
                    window.show();
                });

                // Load the app
                if (process.env.NODE_ENV === 'development') {
                    // Dev mode - load from dev server
                    window.loadURL('http://localhost:5173');
                    // window.webContents.openDevTools(); // Commented out to prevent auto-opening
                } else {                    // Production - load local files using platform-safe paths
                    const appPath = PathUtils.normalizePath(
                        process.env.NODE_ENV === 'development'
                            ? path.join(__dirname, '../../frontend/dist/index.html')
                            : path.join(app.getAppPath(), 'frontend/dist/index.html')
                    );
                    
                    // Log the path being loaded
                    console.log('Loading app from path:', appPath);
                    
                    try {
                        // Load file using file:// protocol
                        window.loadFile(appPath);
                    } catch (loadError) {
                        console.error('Error loading app:', loadError);
                        if (logger.isInitialized) {
                            await logger.error('Failed to load app from path', { path: appPath, error: loadError });
                        }
                        
                        // Fallback to URL loading if file loading fails
                        try {
                            const fileUrl = url.format({
                                pathname: appPath,
                                protocol: 'file:',
                                slashes: true
                            });
                            console.log('Falling back to URL loading:', fileUrl);
                            window.loadURL(fileUrl);
                        } catch (urlError) {
                            console.error('Error loading app via URL:', urlError);
                            if (logger.isInitialized) {
                                await logger.error('Failed to load app via URL', { url: fileUrl, error: urlError });
                            }
                            throw urlError;
                        }
                    }
                }

                // Set up window close event handler
                window.on('closed', () => {
                    if (logger.isInitialized) {
                        logger.log('Window closed event fired');
                    }
                    
                    // Clean up window handlers
                    cleanupWindowHandlers();
                    
                    if (this.mainWindow === window) {
                        this.mainWindow = null;
                    }
                });

                return window;
            } catch (error) {
                if (logger.isInitialized) {
                    await logger.error('Failed to create BrowserWindow', error);
                }
                throw error;
            }
        } catch (error) {
            console.error('Error creating window:', error);
            throw error;
        }
    }

    /**
     * Ensure the main window exists and is visible, creating it if necessary
     * @returns {Promise<Electron.BrowserWindow|null>} Main window or null on failure
     */
    async ensureMainWindow() {
        if (this.mainWindow) {
            // If window exists but is minimized, restore it
            if (this.mainWindow.isMinimized()) {
                this.mainWindow.restore();
            }
            
            // Focus the window
            this.mainWindow.focus();
            return this.mainWindow;
        }
        
        // Create new window if one doesn't exist
        return await this.createMainWindow();
    }

    /**
     * Get the main window instance
     * @returns {Electron.BrowserWindow|null} Main window or null if not created
     */
    getMainWindow() {
        return this.mainWindow;
    }

    /**
     * Close all windows and clean up
     */
    cleanup() {
        if (this.mainWindow) {
            this.mainWindow.close();
            this.mainWindow = null;
        }
    }
}

// Export a singleton instance
module.exports = new WindowManager();