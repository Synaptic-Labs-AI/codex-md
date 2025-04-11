/**
 * BaseService.js
 * Foundation class for all Electron main process services.
 * Provides common IPC handling setup and standardized error handling.
 */

const { ipcMain } = require('electron');

class BaseService {
    constructor() {
        this.serviceName = this.constructor.name;
        this.setupErrorHandling();
        
        // Delay IPC handler setup to allow subclasses to set skipHandlerSetup flag
        // We use setTimeout to ensure this runs after the constructor chain completes
        setTimeout(() => {
            if (!this.skipHandlerSetup) {
                this.setupIpcHandlers();
            }
        }, 0);
    }

    /**
     * Sets up IPC handlers for the service.
     * Should be implemented by child classes to register specific handlers.
     */
    setupIpcHandlers() {
        // Override in subclasses
        console.log(`[${this.serviceName}] IPC handlers not implemented`);
    }

    /**
     * Sets up standardized error handling for the service.
     * Ensures errors are properly logged and propagated.
     */
    setupErrorHandling() {
        process.on('uncaughtException', (error) => {
            console.error(`[${this.serviceName}] Uncaught Exception:`, error);
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error(`[${this.serviceName}] Unhandled Rejection:`, reason);
        });
    }

    /**
     * Helper method to register an IPC handler with error handling.
     * @param {string} channel - The IPC channel to listen on
     * @param {Function} handler - The handler function
     */
    registerHandler(channel, handler) {
        // Check if this channel already has a handler to prevent duplicate registration
        try {
            // We can't directly check for handler existence, so we'll use a workaround
            // by checking the registered channels on ipcMain (undocumented but works)
            const eventNames = ipcMain._eventsCount > 0 && ipcMain._events && Object.keys(ipcMain._events);
            const isHandlerRegistered = eventNames && eventNames.includes(`handle-${channel}`);
            
            if (isHandlerRegistered) {
                console.log(`[${this.serviceName}] Handler for ${channel} already registered, skipping`);
                return;
            }
            
            // Register the handler if it doesn't exist
            ipcMain.handle(channel, async (event, ...args) => {
                try {
                    return await handler(event, ...args);
                } catch (error) {
                    console.error(`[${this.serviceName}] Error in ${channel}:`, error);
                    throw error; // Propagate to renderer
                }
            });
            console.log(`[${this.serviceName}] Registered handler for: ${channel}`);
        } catch (error) {
            console.error(`[${this.serviceName}] Error registering handler for ${channel}:`, error);
            // Attempt to register anyway, in case the error was in our check logic
            ipcMain.handle(channel, async (event, ...args) => {
                try {
                    return await handler(event, ...args);
                } catch (error) {
                    console.error(`[${this.serviceName}] Error in ${channel}:`, error);
                    throw error; // Propagate to renderer
                }
            });
        }
    }

    /**
     * Helper method to unregister an IPC handler.
     * @param {string} channel - The IPC channel to unregister
     */
    unregisterHandler(channel) {
        ipcMain.removeHandler(channel);
        console.log(`[${this.serviceName}] Unregistered handler for: ${channel}`);
    }
}

module.exports = BaseService;
