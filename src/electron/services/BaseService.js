/**
 * BaseService.js
 * Foundation class for all Electron main process services.
 * Provides common IPC handling setup and standardized error handling.
 */

const { ipcMain } = require('electron');

// Global error handlers container to avoid duplicates
const errorHandlers = {
    uncaughtException: new Map(),
    unhandledRejection: new Map()
};

// Set higher max listeners to avoid warnings
process.setMaxListeners(20);

class BaseService {
    constructor() {
        this.serviceName = this.constructor.name;
        this.setupErrorHandling();

        // Maintain a list of registered handlers for this instance
        this._registeredHandlers = new Set();

        // We're removing the automatic setTimeout-based setupIpcHandlers call here
        // Instead, subclasses will explicitly call setupIpcHandlers when appropriate
        // This helps prevent duplicate handler registrations
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
        // Only register handlers once per service name to avoid duplicates
        if (!errorHandlers.uncaughtException.has(this.serviceName)) {
            const uncaughtHandler = (error) => {
                console.error(`[${this.serviceName}] Uncaught Exception:`, error);
            };
            errorHandlers.uncaughtException.set(this.serviceName, uncaughtHandler);
            process.on('uncaughtException', uncaughtHandler);
        }

        if (!errorHandlers.unhandledRejection.has(this.serviceName)) {
            const rejectionHandler = (reason) => {
                console.error(`[${this.serviceName}] Unhandled Rejection:`, reason);
            };
            errorHandlers.unhandledRejection.set(this.serviceName, rejectionHandler);
            process.on('unhandledRejection', rejectionHandler);
        }
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
