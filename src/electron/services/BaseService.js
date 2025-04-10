/**
 * BaseService.js
 * Foundation class for all Electron main process services.
 * Provides common IPC handling setup and standardized error handling.
 */

const { ipcMain } = require('electron');

class BaseService {
    constructor() {
        this.serviceName = this.constructor.name;
        this.setupIpcHandlers();
        this.setupErrorHandling();
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
        ipcMain.handle(channel, async (event, ...args) => {
            try {
                return await handler(event, ...args);
            } catch (error) {
                console.error(`[${this.serviceName}] Error in ${channel}:`, error);
                throw error; // Propagate to renderer
            }
        });
        console.log(`[${this.serviceName}] Registered handler for: ${channel}`);
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
