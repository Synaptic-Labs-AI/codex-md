/**
 * FileStorageService.js
 * Manages temporary file storage and cleanup in the Electron main process.
 * 
 * This service handles:
 * - Creating temporary directories for file processing
 * - Managing file lifecycle during conversion
 * - Cleaning up temporary files
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - ConversionService.js: Uses this service for temporary file storage
 */

const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const BaseService = require('../BaseService');

class FileStorageService extends BaseService {
    constructor() {
        super();
        this.tempDir = path.join(os.tmpdir(), 'codexmd-temp');
        this.setupStorage();
    }

    /**
     * Set up IPC handlers for storage operations
     */
    setupIpcHandlers() {
        this.registerHandler('storage:create-temp', this.handleCreateTemp.bind(this));
        this.registerHandler('storage:cleanup', this.handleCleanup.bind(this));
        this.registerHandler('storage:get-temp-path', this.handleGetTempPath.bind(this));
    }

    /**
     * Initialize storage system
     */
    async setupStorage() {
        try {
            await fs.ensureDir(this.tempDir);
            console.log('[FileStorageService] Temporary directory created:', this.tempDir);
            
            // Clean up any existing temporary files on startup
            await this.cleanup();
        } catch (error) {
            console.error('[FileStorageService] Setup failed:', error);
            throw error;
        }
    }

    /**
     * Handle temporary directory creation request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Creation request details
     * @returns {Promise<string>} Path to created directory
     */
    async handleCreateTemp(event, { prefix = 'conversion' } = {}) {
        try {
            const timestamp = Date.now();
            const uniqueDir = path.join(this.tempDir, `${prefix}_${timestamp}`);
            await fs.ensureDir(uniqueDir);
            return uniqueDir;
        } catch (error) {
            console.error('[FileStorageService] Failed to create temp directory:', error);
            throw error;
        }
    }

    /**
     * Handle cleanup request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Cleanup request details
     */
    async handleCleanup(event, { olderThan } = {}) {
        try {
            await this.cleanup(olderThan);
            return { success: true };
        } catch (error) {
            console.error('[FileStorageService] Cleanup failed:', error);
            throw error;
        }
    }

    /**
     * Handle request for temporary path
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Path request details
     */
    async handleGetTempPath(event, { filename }) {
        return path.join(this.tempDir, filename);
    }

    /**
     * Clean up temporary files
     * @param {number} olderThan - Optional timestamp to clean files older than
     */
    async cleanup(olderThan = 0) {
        try {
            const contents = await fs.readdir(this.tempDir);
            const now = Date.now();

            for (const item of contents) {
                try {
                    const itemPath = path.join(this.tempDir, item);
                    const stats = await fs.stat(itemPath);

                    if (!olderThan || now - stats.mtimeMs > olderThan) {
                        await fs.remove(itemPath);
                        console.log('[FileStorageService] Removed:', itemPath);
                    }
                } catch (error) {
                    // Log but continue with other files
                    console.error('[FileStorageService] Error processing file:', item, error);
                }
            }
        } catch (error) {
            console.error('[FileStorageService] Cleanup operation failed:', error);
            throw error;
        }
    }

    /**
     * Create a temporary file with given content
     * @param {string} content - File content
     * @param {string} extension - File extension
     * @returns {Promise<string>} Path to created file
     */
    async createTempFile(content, extension) {
        const filename = `temp_${Date.now()}${extension}`;
        const filepath = path.join(this.tempDir, filename);
        
        await fs.writeFile(filepath, content);
        return filepath;
    }

    /**
     * Create a temporary directory
     * @param {string} prefix - Directory name prefix
     * @returns {Promise<string>} Path to created directory
     */
    async createTempDir(prefix = 'temp') {
        const dirname = `${prefix}_${Date.now()}`;
        const dirpath = path.join(this.tempDir, dirname);
        
        await fs.ensureDir(dirpath);
        return dirpath;
    }
}

module.exports = FileStorageService;
