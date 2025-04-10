/**
 * FileProcessorService.js
 * Handles file reading, writing, and processing operations in the Electron main process.
 * 
 * This service provides a unified interface for:
 * - File reading and writing with error handling
 * - File format detection and validation
 * - Stream processing for large files
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - FileStorageService.js: For temporary file management
 * - ConversionService.js: Uses this service for file operations
 */

const path = require('path');
const fs = require('fs-extra');
const BaseService = require('../BaseService');
const { Readable } = require('stream');

class FileProcessorService extends BaseService {
    constructor() {
        super();
        this.activeOperations = new Map();
    }

    /**
     * Set up IPC handlers for file operations
     */
    setupIpcHandlers() {
        this.registerHandler('file:read', this.handleFileRead.bind(this));
        this.registerHandler('file:write', this.handleFileWrite.bind(this));
        this.registerHandler('file:check', this.handleFileCheck.bind(this));
        this.registerHandler('file:cancel', this.handleCancel.bind(this));
    }

    /**
     * Handle file read request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Read request details
     */
    async handleFileRead(event, { filePath, encoding = 'utf8', chunked = false }) {
        try {
            const operationId = this.generateOperationId();
            this.activeOperations.set(operationId, { type: 'read', active: true });

            const stats = await fs.stat(filePath);
            
            if (chunked && stats.size > 1024 * 1024) { // > 1MB
                return this.handleLargeFileRead(event, filePath, operationId, encoding);
            } else {
                const content = await fs.readFile(filePath, encoding);
                this.activeOperations.delete(operationId);
                return { content, size: stats.size };
            }
        } catch (error) {
            console.error('[FileProcessorService] File read failed:', error);
            throw error;
        }
    }

    /**
     * Handle file write request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Write request details
     */
    async handleFileWrite(event, { filePath, content, encoding = 'utf8' }) {
        try {
            const operationId = this.generateOperationId();
            this.activeOperations.set(operationId, { type: 'write', active: true });

            await fs.ensureDir(path.dirname(filePath));
            await fs.writeFile(filePath, content, encoding);
            
            this.activeOperations.delete(operationId);
            return { success: true, path: filePath };
        } catch (error) {
            console.error('[FileProcessorService] File write failed:', error);
            throw error;
        }
    }

    /**
     * Handle file check request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Check request details
     */
    async handleFileCheck(event, { filePath }) {
        try {
            const stats = await fs.stat(filePath);
            return {
                exists: true,
                size: stats.size,
                isDirectory: stats.isDirectory(),
                modifiedTime: stats.mtimeMs
            };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { exists: false };
            }
            throw error;
        }
    }

    /**
     * Handle operation cancellation request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Cancellation details
     */
    async handleCancel(event, { operationId }) {
        const operation = this.activeOperations.get(operationId);
        if (operation) {
            operation.active = false;
            this.activeOperations.delete(operationId);
            return { success: true };
        }
        return { success: false, error: 'Operation not found' };
    }

    /**
     * Handle reading of large files in chunks
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {string} filePath - Path to file
     * @param {string} operationId - Operation identifier
     * @param {string} encoding - File encoding
     */
    async handleLargeFileRead(event, filePath, operationId, encoding) {
        return new Promise((resolve, reject) => {
            const operation = this.activeOperations.get(operationId);
            const chunks = [];
            let totalSize = 0;

            const stream = fs.createReadStream(filePath, { encoding });

            stream.on('data', (chunk) => {
                if (!operation.active) {
                    stream.destroy();
                    reject(new Error('Operation cancelled'));
                    return;
                }

                chunks.push(chunk);
                totalSize += chunk.length;

                // Notify progress
                event.sender.send('file:progress', {
                    operationId,
                    type: 'read',
                    bytesProcessed: totalSize
                });
            });

            stream.on('end', () => {
                this.activeOperations.delete(operationId);
                resolve({
                    content: chunks.join(''),
                    size: totalSize
                });
            });

            stream.on('error', (error) => {
                this.activeOperations.delete(operationId);
                reject(error);
            });
        });
    }

    /**
     * Generate unique operation identifier
     * @returns {string} Unique operation ID
     */
    generateOperationId() {
        return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Clean up all active operations
     */
    cleanup() {
        this.activeOperations.clear();
    }
}

module.exports = FileProcessorService;
