/**
 * AppLifecycleManager.js
 * 
 * Manages the lifecycle of the Electron application.
 * Handles events such as app start, ready, window-all-closed,
 * activate, and will-quit.
 */

const { app } = require('electron');
const path = require('path');
const logger = require('../utils/logger');
const { setupBasicHandlers } = require('../ipc/handlers');
const ElectronConversionService = require('../services/ElectronConversionService');
const TrayManager = require('../features/tray');
const NotificationManager = require('../features/notifications');
const UpdateManager = require('../features/updater');
const { createStore } = require('../utils/storeFactory');

// For macOS
const { createMacMenu } = require('../features/menu');

class AppLifecycleManager {
    constructor(windowManager) {
        this.windowManager = windowManager;
        this.trayManager = null;
        this.notificationManager = null;
        this.updateManager = null;
        this.isInitialized = false;
        
        // Initialize stores
        this.trayStore = createStore('tray-manager', {
            encryptionKey: process.env.STORE_ENCRYPTION_KEY
        });
        this.settingsStore = createStore('settings');
        
        // Bind app event handlers
        this.handleReady = this.handleReady.bind(this);
        this.handleWindowAllClosed = this.handleWindowAllClosed.bind(this);
        this.handleActivate = this.handleActivate.bind(this);
        this.handleWillQuit = this.handleWillQuit.bind(this);
        
        // Setup app event listeners
        this._setupEventListeners();
    }
    
    /**
     * Setup app event listeners
     * @private
     */
    _setupEventListeners() {
        app.on('ready', this.handleReady);
        app.on('window-all-closed', this.handleWindowAllClosed);
        app.on('activate', this.handleActivate);
        app.on('will-quit', this.handleWillQuit);
    }
    
    /**
     * Initialize logger
     * @returns {Promise<boolean>} Whether logger was successfully initialized
     */
    async _initializeLogger() {
        try {
            await logger.initialize();
            console.log('✅ Logger initialized');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize logger:', error);
            return false;
        }
    }
    
    /**
     * Setup notifications with error handling
     * @returns {Promise<boolean>} Whether notifications were successfully initialized
     */
    async _setupNotifications() {
        try {
            this.notificationManager = new NotificationManager();
            if (logger.isInitialized) {
                await logger.log('Notifications initialized');
            }
            console.log('✅ Notifications initialized');
            return true;
        } catch (error) {
            if (logger.isInitialized) {
                await logger.error('Failed to setup notifications', error);
            }
            console.error('❌ Failed to setup notifications:', error);
            this.notificationManager = null;
            return false;
        }
    }
    
    /**
     * Setup system tray with error handling
     * @returns {Promise<boolean>} Whether tray was successfully initialized
     */
    async _setupTray() {
        const mainWindow = this.windowManager.getMainWindow();
        if (!mainWindow) {
            console.warn('⚠️ Cannot setup tray without main window');
            return false;
        }

        try {
            this.trayManager = new TrayManager(mainWindow, this.trayStore);
            console.log('✅ Tray initialized successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to create tray:', error);
            this.trayManager = null;
            // Non-fatal error, continue execution
            return false;
        }
    }
    
    /**
     * Initialize Deepgram with API key if available
     * @returns {Promise<boolean>} Whether deepgram was initialized
     */
    async _initializeDeepgram() {
        try {
            // Try to configure Deepgram on startup if key exists
            const deepgramApiKey = this.settingsStore.get('transcription.deepgramApiKey');
            if (deepgramApiKey) {
                console.log('[Startup] Found stored Deepgram API key, attempting to configure DeepgramService...');
                try {
                    // Import the DeepgramService
                    const deepgramService = require('../services/ai/DeepgramService');
                    // Configure with the API key
                    const configResult = await deepgramService.handleConfigure(null, { apiKey: deepgramApiKey });
                    if (configResult.success) {
                        console.log('[Startup] DeepgramService configured successfully on startup.');
                        return true;
                    } else {
                        console.warn('[Startup] DeepgramService configuration failed on startup.');
                        return false;
                    }
                } catch (configError) {
                    console.error('[Startup] Error configuring DeepgramService on startup:', configError);
                    return false;
                }
            } else {
                console.log('[Startup] No stored Deepgram API key found.');
                return true; // No key is not an error
            }
        } catch (error) {
            console.error('Error initializing Deepgram:', error);
            return false;
        }
    }
    
    /**
     * Initialize the application with all required services
     * @returns {Promise<boolean>} Whether initialization was successful
     */
    async initialize() {
        try {
            if (this.isInitialized) {
                console.log('AppLifecycleManager already initialized');
                return true;
            }
            
            // Initialize logger
            await this._initializeLogger();
            
            // Initialize API Key Service
            const ApiKeyService = require('../services/ApiKeyService');
            const apiKeyServiceInstance = ApiKeyService;
            
            // Initialize Deepgram
            await this._initializeDeepgram();
            
            // Initialize update manager
            this.updateManager = new UpdateManager();
            await this.updateManager.initialize();
            console.log('✅ Update manager initialized');
            
            // Setup basic IPC handlers
            console.log('📡 Registering basic IPC handlers...');
            setupBasicHandlers(app);
            console.log('✅ Basic IPC handlers registered successfully');
            
            // Initialize core services
            await ElectronConversionService.setupOutputDirectory();
            console.log('✅ Conversion service initialized');
            
            // Setup notifications (non-fatal if it fails)
            if (!await this._setupNotifications()) {
                console.warn('⚠️ Notifications unavailable - continuing without notifications');
            }
            
            this.isInitialized = true;
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize app:', error);
            return false;
        }
    }
    
    /**
     * Handle app ready event
     */
    async handleReady() {
        try {
            // Initialize app
            const initSuccess = await this.initialize();
            if (!initSuccess) {
                console.error('❌ App initialization failed');
                app.quit();
                return;
            }
            
            // Create main window
            const window = await this.windowManager.createMainWindow();
            if (!window) {
                console.error('❌ Failed to create main window');
                app.quit();
                return;
            }
            
            // Setup tray after window is created
            await this._setupTray();
            
            // Create menu for macOS
            if (process.platform === 'darwin') {
                createMacMenu();
            }
            
            console.log('✅ App ready and initialized successfully');
        } catch (error) {
            console.error('❌ Error during app ready:', error);
            app.quit();
        }
    }
    
    /**
     * Handle window-all-closed event
     */
    handleWindowAllClosed() {
        // On macOS applications keep their menu bar active until Cmd + Q
        if (process.platform !== 'darwin') {
            app.quit();
        }
    }
    
    /**
     * Handle activate event (macOS)
     */
    async handleActivate() {
        try {
            // On macOS, re-create window when dock icon is clicked
            const window = await this.windowManager.ensureMainWindow();
            if (!window) {
                console.error('❌ Failed to create/restore main window on activate');
            }
        } catch (error) {
            console.error('❌ Error during activate:', error);
        }
    }
    
    /**
     * Handle will-quit event
     */
    async handleWillQuit() {
        try {
            // Clean up resources before quitting
            
            // Clean up tray
            if (this.trayManager) {
                this.trayManager.destroy();
                this.trayManager = null;
            }
            
            // Clean up other resources if needed
            
            console.log('✅ App cleanup completed before quit');
        } catch (error) {
            console.error('❌ Error during will-quit cleanup:', error);
        }
    }
}

module.exports = AppLifecycleManager;