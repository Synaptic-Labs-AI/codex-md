/**
 * ProtocolHandler.js
 * 
 * Manages custom protocol handling for the application.
 * Registers and handles custom URL protocols like codex-md://
 * for deep linking and file operations.
 */

const { app, protocol } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs-extra');
const logger = require('../utils/logger');

class ProtocolHandler {
    constructor(windowManager) {
        this.windowManager = windowManager;
        this.protocolName = 'codex-md';
        this.isRegistered = false;
        
        // Bind methods
        this.handleUrl = this.handleUrl.bind(this);
    }
    
    /**
     * Initialize the protocol handler
     * @returns {Promise<boolean>} Whether initialization was successful
     */
    async initialize() {
        try {
            // Set the app as the default handler for our custom protocol
            if (process.defaultApp) {
                // Development - specify path to app
                if (process.argv.length >= 2) {
                    app.setAsDefaultProtocolClient(this.protocolName, process.execPath, [path.resolve(process.argv[1])]);
                }
            } else {
                // Production - normal registration
                app.setAsDefaultProtocolClient(this.protocolName);
            }
            
            console.log(`✅ Set as default handler for ${this.protocolName}:// protocol`);
            
            // Handle open-url events (macOS)
            app.on('open-url', (event, url) => {
                event.preventDefault();
                this.handleUrl(url);
            });
            
            // Handle second-instance events (Windows)
            app.on('second-instance', (event, commandLine, workingDirectory) => {
                // Find URL in command line arguments
                const urlArg = commandLine.find(arg => arg.startsWith(`${this.protocolName}://`));
                if (urlArg) {
                    this.handleUrl(urlArg);
                }
                
                // Focus the main window
                const mainWindow = this.windowManager.getMainWindow();
                if (mainWindow) {
                    if (mainWindow.isMinimized()) {
                        mainWindow.restore();
                    }
                    mainWindow.focus();
                }
            });
            
            return true;
        } catch (error) {
            console.error(`❌ Failed to initialize protocol handler: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Register custom file protocol handlers
     * @returns {Promise<boolean>} Whether registration was successful
     */
    async registerProtocols() {
        try {
            if (this.isRegistered) {
                console.log('Protocols already registered');
                return true;
            }
            
            // Register protocol handler for serving local files
            protocol.registerFileProtocol('local-file', (request, callback) => {
                const filePath = request.url.replace('local-file://', '');
                callback({ path: filePath });
            });
            
            console.log('✅ Registered local-file:// protocol');
            
            this.isRegistered = true;
            return true;
        } catch (error) {
            console.error(`❌ Failed to register protocols: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Handle a custom protocol URL
     * @param {string} urlString - URL to handle
     */
    async handleUrl(urlString) {
        try {
            console.log(`Handling URL: ${urlString}`);
            
            // Ensure the main window exists
            const mainWindow = await this.windowManager.ensureMainWindow();
            if (!mainWindow) {
                console.error('❌ Cannot handle URL without main window');
                return;
            }
            
            // Parse the URL
            const urlObj = new URL(urlString);
            const protocol = urlObj.protocol;
            const hostname = urlObj.hostname;
            const pathname = urlObj.pathname;
            const searchParams = urlObj.searchParams;
            
            // Handle different URL types
            if (protocol === `${this.protocolName}:`) {
                // Handle based on hostname/path
                switch (hostname) {
                    case 'open':
                        // Handle file opening
                        const filePath = decodeURIComponent(pathname);
                        console.log(`Opening file: ${filePath}`);
                        mainWindow.webContents.send('protocol:open-file', { filePath });
                        break;
                    
                    case 'convert':
                        // Handle conversion request
                        const fileToConvert = decodeURIComponent(pathname);
                        const format = searchParams.get('format') || 'markdown';
                        console.log(`Converting file: ${fileToConvert} to ${format}`);
                        mainWindow.webContents.send('protocol:convert-file', { filePath: fileToConvert, format });
                        break;
                    
                    default:
                        // Handle unknown commands by passing to renderer
                        console.log(`Unknown protocol command: ${hostname}`);
                        mainWindow.webContents.send('protocol:unknown', { url: urlString });
                        break;
                }
            }
        } catch (error) {
            console.error(`❌ Error handling URL: ${error.message}`);
            if (logger.isInitialized) {
                await logger.error('Protocol URL handling error', {
                    url: urlString,
                    error: error.message,
                    stack: error.stack
                });
            }
        }
    }
}

module.exports = ProtocolHandler;