"use strict";

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
const {
  Readable
} = require('stream');
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
  async handleFileRead(event, {
    filePath,
    encoding = 'utf8',
    chunked = false
  }) {
    try {
      const operationId = this.generateOperationId();
      this.activeOperations.set(operationId, {
        type: 'read',
        active: true
      });
      const stats = await fs.stat(filePath);
      if (chunked && stats.size > 1024 * 1024) {
        // > 1MB
        return this.handleLargeFileRead(event, filePath, operationId, encoding);
      } else {
        const content = await fs.readFile(filePath, encoding);
        this.activeOperations.delete(operationId);
        return {
          content,
          size: stats.size
        };
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
  async handleFileWrite(event, {
    filePath,
    content,
    encoding = 'utf8'
  }) {
    try {
      const operationId = this.generateOperationId();
      this.activeOperations.set(operationId, {
        type: 'write',
        active: true
      });
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, content, encoding);
      this.activeOperations.delete(operationId);
      return {
        success: true,
        path: filePath
      };
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
  async handleFileCheck(event, {
    filePath
  }) {
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
        return {
          exists: false
        };
      }
      throw error;
    }
  }

  /**
   * Handle operation cancellation request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Cancellation details
   */
  async handleCancel(event, {
    operationId
  }) {
    const operation = this.activeOperations.get(operationId);
    if (operation) {
      operation.active = false;
      this.activeOperations.delete(operationId);
      return {
        success: true
      };
    }
    return {
      success: false,
      error: 'Operation not found'
    };
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
      const stream = fs.createReadStream(filePath, {
        encoding
      });
      stream.on('data', chunk => {
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
      stream.on('error', error => {
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

// Create and export the singleton instance
const fileProcessorServiceInstance = new FileProcessorService();
module.exports = fileProcessorServiceInstance;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiQmFzZVNlcnZpY2UiLCJSZWFkYWJsZSIsIkZpbGVQcm9jZXNzb3JTZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJhY3RpdmVPcGVyYXRpb25zIiwiTWFwIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUZpbGVSZWFkIiwiYmluZCIsImhhbmRsZUZpbGVXcml0ZSIsImhhbmRsZUZpbGVDaGVjayIsImhhbmRsZUNhbmNlbCIsImV2ZW50IiwiZmlsZVBhdGgiLCJlbmNvZGluZyIsImNodW5rZWQiLCJvcGVyYXRpb25JZCIsImdlbmVyYXRlT3BlcmF0aW9uSWQiLCJzZXQiLCJ0eXBlIiwiYWN0aXZlIiwic3RhdHMiLCJzdGF0Iiwic2l6ZSIsImhhbmRsZUxhcmdlRmlsZVJlYWQiLCJjb250ZW50IiwicmVhZEZpbGUiLCJkZWxldGUiLCJlcnJvciIsImNvbnNvbGUiLCJlbnN1cmVEaXIiLCJkaXJuYW1lIiwid3JpdGVGaWxlIiwic3VjY2VzcyIsImV4aXN0cyIsImlzRGlyZWN0b3J5IiwibW9kaWZpZWRUaW1lIiwibXRpbWVNcyIsImNvZGUiLCJvcGVyYXRpb24iLCJnZXQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsImNodW5rcyIsInRvdGFsU2l6ZSIsInN0cmVhbSIsImNyZWF0ZVJlYWRTdHJlYW0iLCJvbiIsImNodW5rIiwiZGVzdHJveSIsIkVycm9yIiwicHVzaCIsImxlbmd0aCIsInNlbmRlciIsInNlbmQiLCJieXRlc1Byb2Nlc3NlZCIsImpvaW4iLCJEYXRlIiwibm93IiwiTWF0aCIsInJhbmRvbSIsInRvU3RyaW5nIiwic3Vic3RyIiwiY2xlYW51cCIsImNsZWFyIiwiZmlsZVByb2Nlc3NvclNlcnZpY2VJbnN0YW5jZSIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvc3RvcmFnZS9GaWxlUHJvY2Vzc29yU2VydmljZS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogRmlsZVByb2Nlc3NvclNlcnZpY2UuanNcclxuICogSGFuZGxlcyBmaWxlIHJlYWRpbmcsIHdyaXRpbmcsIGFuZCBwcm9jZXNzaW5nIG9wZXJhdGlvbnMgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogXHJcbiAqIFRoaXMgc2VydmljZSBwcm92aWRlcyBhIHVuaWZpZWQgaW50ZXJmYWNlIGZvcjpcclxuICogLSBGaWxlIHJlYWRpbmcgYW5kIHdyaXRpbmcgd2l0aCBlcnJvciBoYW5kbGluZ1xyXG4gKiAtIEZpbGUgZm9ybWF0IGRldGVjdGlvbiBhbmQgdmFsaWRhdGlvblxyXG4gKiAtIFN0cmVhbSBwcm9jZXNzaW5nIGZvciBsYXJnZSBmaWxlc1xyXG4gKiBcclxuICogUmVsYXRlZCBGaWxlczpcclxuICogLSBCYXNlU2VydmljZS5qczogUGFyZW50IGNsYXNzIHByb3ZpZGluZyBJUEMgaGFuZGxpbmdcclxuICogLSBGaWxlU3RvcmFnZVNlcnZpY2UuanM6IEZvciB0ZW1wb3JhcnkgZmlsZSBtYW5hZ2VtZW50XHJcbiAqIC0gQ29udmVyc2lvblNlcnZpY2UuanM6IFVzZXMgdGhpcyBzZXJ2aWNlIGZvciBmaWxlIG9wZXJhdGlvbnNcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbmNvbnN0IEJhc2VTZXJ2aWNlID0gcmVxdWlyZSgnLi4vQmFzZVNlcnZpY2UnKTtcclxuY29uc3QgeyBSZWFkYWJsZSB9ID0gcmVxdWlyZSgnc3RyZWFtJyk7XHJcblxyXG5jbGFzcyBGaWxlUHJvY2Vzc29yU2VydmljZSBleHRlbmRzIEJhc2VTZXJ2aWNlIHtcclxuICAgIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgICAgIHN1cGVyKCk7XHJcbiAgICAgICAgdGhpcy5hY3RpdmVPcGVyYXRpb25zID0gbmV3IE1hcCgpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogU2V0IHVwIElQQyBoYW5kbGVycyBmb3IgZmlsZSBvcGVyYXRpb25zXHJcbiAgICAgKi9cclxuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2ZpbGU6cmVhZCcsIHRoaXMuaGFuZGxlRmlsZVJlYWQuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2ZpbGU6d3JpdGUnLCB0aGlzLmhhbmRsZUZpbGVXcml0ZS5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignZmlsZTpjaGVjaycsIHRoaXMuaGFuZGxlRmlsZUNoZWNrLmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdmaWxlOmNhbmNlbCcsIHRoaXMuaGFuZGxlQ2FuY2VsLmJpbmQodGhpcykpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIGZpbGUgcmVhZCByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gUmVhZCByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlRmlsZVJlYWQoZXZlbnQsIHsgZmlsZVBhdGgsIGVuY29kaW5nID0gJ3V0ZjgnLCBjaHVua2VkID0gZmFsc2UgfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG9wZXJhdGlvbklkID0gdGhpcy5nZW5lcmF0ZU9wZXJhdGlvbklkKCk7XHJcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlT3BlcmF0aW9ucy5zZXQob3BlcmF0aW9uSWQsIHsgdHlwZTogJ3JlYWQnLCBhY3RpdmU6IHRydWUgfSk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQoZmlsZVBhdGgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNodW5rZWQgJiYgc3RhdHMuc2l6ZSA+IDEwMjQgKiAxMDI0KSB7IC8vID4gMU1CXHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVMYXJnZUZpbGVSZWFkKGV2ZW50LCBmaWxlUGF0aCwgb3BlcmF0aW9uSWQsIGVuY29kaW5nKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCwgZW5jb2RpbmcpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5hY3RpdmVPcGVyYXRpb25zLmRlbGV0ZShvcGVyYXRpb25JZCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyBjb250ZW50LCBzaXplOiBzdGF0cy5zaXplIH07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRmlsZVByb2Nlc3NvclNlcnZpY2VdIEZpbGUgcmVhZCBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgZmlsZSB3cml0ZSByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gV3JpdGUgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUZpbGVXcml0ZShldmVudCwgeyBmaWxlUGF0aCwgY29udGVudCwgZW5jb2RpbmcgPSAndXRmOCcgfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG9wZXJhdGlvbklkID0gdGhpcy5nZW5lcmF0ZU9wZXJhdGlvbklkKCk7XHJcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlT3BlcmF0aW9ucy5zZXQob3BlcmF0aW9uSWQsIHsgdHlwZTogJ3dyaXRlJywgYWN0aXZlOiB0cnVlIH0pO1xyXG5cclxuICAgICAgICAgICAgYXdhaXQgZnMuZW5zdXJlRGlyKHBhdGguZGlybmFtZShmaWxlUGF0aCkpO1xyXG4gICAgICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZVBhdGgsIGNvbnRlbnQsIGVuY29kaW5nKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlT3BlcmF0aW9ucy5kZWxldGUob3BlcmF0aW9uSWQpO1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBwYXRoOiBmaWxlUGF0aCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGaWxlUHJvY2Vzc29yU2VydmljZV0gRmlsZSB3cml0ZSBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgZmlsZSBjaGVjayByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ2hlY2sgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUZpbGVDaGVjayhldmVudCwgeyBmaWxlUGF0aCB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIGV4aXN0czogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIHNpemU6IHN0YXRzLnNpemUsXHJcbiAgICAgICAgICAgICAgICBpc0RpcmVjdG9yeTogc3RhdHMuaXNEaXJlY3RvcnkoKSxcclxuICAgICAgICAgICAgICAgIG1vZGlmaWVkVGltZTogc3RhdHMubXRpbWVNc1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGlmIChlcnJvci5jb2RlID09PSAnRU5PRU5UJykge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgZXhpc3RzOiBmYWxzZSB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBvcGVyYXRpb24gY2FuY2VsbGF0aW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDYW5jZWxsYXRpb24gZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDYW5jZWwoZXZlbnQsIHsgb3BlcmF0aW9uSWQgfSkge1xyXG4gICAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IHRoaXMuYWN0aXZlT3BlcmF0aW9ucy5nZXQob3BlcmF0aW9uSWQpO1xyXG4gICAgICAgIGlmIChvcGVyYXRpb24pIHtcclxuICAgICAgICAgICAgb3BlcmF0aW9uLmFjdGl2ZSA9IGZhbHNlO1xyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZU9wZXJhdGlvbnMuZGVsZXRlKG9wZXJhdGlvbklkKTtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdPcGVyYXRpb24gbm90IGZvdW5kJyB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIHJlYWRpbmcgb2YgbGFyZ2UgZmlsZXMgaW4gY2h1bmtzXHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IG9wZXJhdGlvbklkIC0gT3BlcmF0aW9uIGlkZW50aWZpZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBlbmNvZGluZyAtIEZpbGUgZW5jb2RpbmdcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlTGFyZ2VGaWxlUmVhZChldmVudCwgZmlsZVBhdGgsIG9wZXJhdGlvbklkLCBlbmNvZGluZykge1xyXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IHRoaXMuYWN0aXZlT3BlcmF0aW9ucy5nZXQob3BlcmF0aW9uSWQpO1xyXG4gICAgICAgICAgICBjb25zdCBjaHVua3MgPSBbXTtcclxuICAgICAgICAgICAgbGV0IHRvdGFsU2l6ZSA9IDA7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBzdHJlYW0gPSBmcy5jcmVhdGVSZWFkU3RyZWFtKGZpbGVQYXRoLCB7IGVuY29kaW5nIH0pO1xyXG5cclxuICAgICAgICAgICAgc3RyZWFtLm9uKCdkYXRhJywgKGNodW5rKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIW9wZXJhdGlvbi5hY3RpdmUpIHtcclxuICAgICAgICAgICAgICAgICAgICBzdHJlYW0uZGVzdHJveSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoJ09wZXJhdGlvbiBjYW5jZWxsZWQnKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIGNodW5rcy5wdXNoKGNodW5rKTtcclxuICAgICAgICAgICAgICAgIHRvdGFsU2l6ZSArPSBjaHVuay5sZW5ndGg7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gTm90aWZ5IHByb2dyZXNzXHJcbiAgICAgICAgICAgICAgICBldmVudC5zZW5kZXIuc2VuZCgnZmlsZTpwcm9ncmVzcycsIHtcclxuICAgICAgICAgICAgICAgICAgICBvcGVyYXRpb25JZCxcclxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAncmVhZCcsXHJcbiAgICAgICAgICAgICAgICAgICAgYnl0ZXNQcm9jZXNzZWQ6IHRvdGFsU2l6ZVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgc3RyZWFtLm9uKCdlbmQnLCAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmFjdGl2ZU9wZXJhdGlvbnMuZGVsZXRlKG9wZXJhdGlvbklkKTtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IGNodW5rcy5qb2luKCcnKSxcclxuICAgICAgICAgICAgICAgICAgICBzaXplOiB0b3RhbFNpemVcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHN0cmVhbS5vbignZXJyb3InLCAoZXJyb3IpID0+IHtcclxuICAgICAgICAgICAgICAgIHRoaXMuYWN0aXZlT3BlcmF0aW9ucy5kZWxldGUob3BlcmF0aW9uSWQpO1xyXG4gICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSB1bmlxdWUgb3BlcmF0aW9uIGlkZW50aWZpZXJcclxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IFVuaXF1ZSBvcGVyYXRpb24gSURcclxuICAgICAqL1xyXG4gICAgZ2VuZXJhdGVPcGVyYXRpb25JZCgpIHtcclxuICAgICAgICByZXR1cm4gYG9wXyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHIoMiwgOSl9YDtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENsZWFuIHVwIGFsbCBhY3RpdmUgb3BlcmF0aW9uc1xyXG4gICAgICovXHJcbiAgICBjbGVhbnVwKCkge1xyXG4gICAgICAgIHRoaXMuYWN0aXZlT3BlcmF0aW9ucy5jbGVhcigpO1xyXG4gICAgfVxyXG59XHJcblxyXG4vLyBDcmVhdGUgYW5kIGV4cG9ydCB0aGUgc2luZ2xldG9uIGluc3RhbmNlXHJcbmNvbnN0IGZpbGVQcm9jZXNzb3JTZXJ2aWNlSW5zdGFuY2UgPSBuZXcgRmlsZVByb2Nlc3NvclNlcnZpY2UoKTtcclxubW9kdWxlLmV4cG9ydHMgPSBmaWxlUHJvY2Vzc29yU2VydmljZUluc3RhbmNlO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTUMsRUFBRSxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQzlCLE1BQU1FLFdBQVcsR0FBR0YsT0FBTyxDQUFDLGdCQUFnQixDQUFDO0FBQzdDLE1BQU07RUFBRUc7QUFBUyxDQUFDLEdBQUdILE9BQU8sQ0FBQyxRQUFRLENBQUM7QUFFdEMsTUFBTUksb0JBQW9CLFNBQVNGLFdBQVcsQ0FBQztFQUMzQ0csV0FBV0EsQ0FBQSxFQUFHO0lBQ1YsS0FBSyxDQUFDLENBQUM7SUFDUCxJQUFJLENBQUNDLGdCQUFnQixHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDO0VBQ3JDOztF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