"use strict";

/**
 * FileWatcherService.js
 * Provides file system watching capabilities with lock management.
 * 
 * This service monitors file and directory changes, manages file locks
 * to prevent concurrent access issues, and emits events when files
 * are added, changed, or removed.
 * 
 * Related files:
 * - FileSystemService.js: Core file operations
 * - ipc/handlers/filewatcher/index.js: IPC handlers for file watching
 */

const chokidar = require('chokidar');
const path = require('path');
const lockfile = require('proper-lockfile');
const {
  app
} = require('electron');
const {
  instance: FileSystemService
} = require('./FileSystemService'); // Import instance

class FileWatcherService {
  constructor() {
    this.watchers = new Map(); // Map of path -> watcher
    this.locks = new Map(); // Map of path -> lock info
    this.lockTimeout = 30000; // 30 seconds default lock timeout
    this.listeners = new Set(); // Event listeners
    this.watchOptions = {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      },
      ignorePermissionErrors: true
    };
  }

  /**
   * Start watching a file or directory
   * @param {string|string[]} paths - Path(s) to watch
   * @param {Object} options - Watch options
   * @param {boolean} [options.recursive=true] - Watch subdirectories
   * @param {string[]} [options.ignore=[]] - Paths to ignore
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async watch(paths, options = {}) {
    try {
      const watchPaths = Array.isArray(paths) ? paths : [paths];
      const watchId = this.generateWatchId(watchPaths);
      if (this.watchers.has(watchId)) {
        return {
          success: false,
          error: 'Already watching these paths'
        };
      }

      // Validate paths
      for (const watchPath of watchPaths) {
        // Assuming FileSystemService instance has getStats method
        const stats = await FileSystemService.getStats(watchPath);
        if (!stats.success) {
          return {
            success: false,
            error: `Invalid path: ${watchPath}`
          };
        }
      }

      // Configure watcher
      const watchOptions = {
        ...this.watchOptions,
        ignored: options.ignore || [],
        depth: options.recursive !== false ? undefined : 0
      };

      // Create watcher
      const watcher = chokidar.watch(watchPaths, watchOptions);

      // Set up event handlers
      watcher.on('add', filePath => this.emitEvent('add', filePath));
      watcher.on('change', filePath => this.emitEvent('change', filePath));
      watcher.on('unlink', filePath => this.emitEvent('unlink', filePath));
      watcher.on('error', error => this.emitEvent('error', '', error.toString()));

      // Store watcher
      this.watchers.set(watchId, {
        watcher,
        paths: watchPaths,
        options
      });
      return {
        success: true,
        watchId
      };
    } catch (error) {
      console.error('File watch error:', error);
      return {
        success: false,
        error: `Failed to start watching: ${error.message}`
      };
    }
  }

  /**
   * Stop watching path(s)
   * @param {string} watchId - Watch ID to stop
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async unwatch(watchId) {
    try {
      if (!this.watchers.has(watchId)) {
        return {
          success: false,
          error: 'Not watching this path'
        };
      }
      const {
        watcher
      } = this.watchers.get(watchId);
      await watcher.close();
      this.watchers.delete(watchId);
      return {
        success: true
      };
    } catch (error) {
      console.error('File unwatch error:', error);
      return {
        success: false,
        error: `Failed to stop watching: ${error.message}`
      };
    }
  }

  /**
   * Acquire a lock on a file
   * @param {string} filePath - Path to lock
   * @param {Object} options - Lock options
   * @param {number} [options.timeout=30000] - Lock timeout in ms
   * @param {boolean} [options.wait=false] - Wait for lock if already locked
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async acquireLock(filePath, options = {}) {
    try {
      const timeout = options.timeout || this.lockTimeout;
      // Assuming FileSystemService instance has validatePath method
      const validPath = await FileSystemService.validatePath(filePath);

      // Check if already locked by us
      if (this.locks.has(validPath)) {
        return {
          success: false,
          error: 'File already locked by this process'
        };
      }

      // Try to acquire lock
      const release = await lockfile.lock(validPath, {
        stale: timeout,
        retries: options.wait ? 5 : 0,
        retryWait: 1000
      });

      // Store lock info
      this.locks.set(validPath, {
        acquired: Date.now(),
        timeout,
        release
      });
      return {
        success: true
      };
    } catch (error) {
      console.error('File lock error:', error);

      // Check if file is locked by another process
      if (error.code === 'ELOCKED') {
        return {
          success: false,
          error: 'File is locked by another process'
        };
      }
      return {
        success: false,
        error: `Failed to lock file: ${error.message}`
      };
    }
  }

  /**
   * Release a lock on a file
   * @param {string} filePath - Path to unlock
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async releaseLock(filePath) {
    try {
      // Assuming FileSystemService instance has validatePath method
      const validPath = await FileSystemService.validatePath(filePath);
      if (!this.locks.has(validPath)) {
        return {
          success: false,
          error: 'File not locked by this process'
        };
      }
      const {
        release
      } = this.locks.get(validPath);
      await release();
      this.locks.delete(validPath);
      return {
        success: true
      };
    } catch (error) {
      console.error('File unlock error:', error);
      return {
        success: false,
        error: `Failed to unlock file: ${error.message}`
      };
    }
  }

  /**
   * Check if a file is locked
   * @param {string} filePath - Path to check
   * @returns {Promise<{success: boolean, locked: boolean, error?: string}>}
   */
  async isLocked(filePath) {
    try {
      // Assuming FileSystemService instance has validatePath method
      const validPath = await FileSystemService.validatePath(filePath);

      // Check if locked by us
      if (this.locks.has(validPath)) {
        return {
          success: true,
          locked: true,
          lockedBy: 'self'
        };
      }

      // Check if locked by another process
      const locked = await lockfile.check(validPath);
      return {
        success: true,
        locked,
        lockedBy: locked ? 'other' : null
      };
    } catch (error) {
      console.error('File lock check error:', error);
      return {
        success: false,
        error: `Failed to check lock: ${error.message}`
      };
    }
  }

  /**
   * Add an event listener
   * @param {Function} listener - Event listener function
   * @returns {boolean} Success
   */
  addListener(listener) {
    if (typeof listener !== 'function') {
      return false;
    }
    this.listeners.add(listener);
    return true;
  }

  /**
   * Remove an event listener
   * @param {Function} listener - Event listener function
   * @returns {boolean} Success
   */
  removeListener(listener) {
    return this.listeners.delete(listener);
  }

  /**
   * Emit a file event to all listeners
   * @private
   * @param {string} event - Event type ('add', 'change', 'unlink', 'error')
   * @param {string} filePath - Affected file path
   * @param {string} [error] - Error message if event is 'error'
   */
  emitEvent(event, filePath, error) {
    const eventData = {
      event,
      path: filePath,
      timestamp: Date.now()
    };
    if (event === 'error' && error) {
      eventData.error = error;
    }
    this.listeners.forEach(listener => {
      try {
        listener(eventData);
      } catch (err) {
        console.error('Error in file watcher listener:', err);
      }
    });
  }

  /**
   * Generate a unique watch ID for a set of paths
   * @private
   * @param {string[]} paths - Paths to watch
   * @returns {string} Watch ID
   */
  generateWatchId(paths) {
    const sortedPaths = [...paths].sort();
    return sortedPaths.join('|');
  }

  /**
   * Clean up all watchers and locks
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Close all watchers
    for (const [watchId, {
      watcher
    }] of this.watchers.entries()) {
      try {
        await watcher.close();
      } catch (error) {
        console.error(`Error closing watcher ${watchId}:`, error);
      }
    }
    this.watchers.clear();

    // Release all locks
    for (const [filePath, {
      release
    }] of this.locks.entries()) {
      try {
        await release();
      } catch (error) {
        console.error(`Error releasing lock on ${filePath}:`, error);
      }
    }
    this.locks.clear();
  }
}
module.exports = new FileWatcherService();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjaG9raWRhciIsInJlcXVpcmUiLCJwYXRoIiwibG9ja2ZpbGUiLCJhcHAiLCJpbnN0YW5jZSIsIkZpbGVTeXN0ZW1TZXJ2aWNlIiwiRmlsZVdhdGNoZXJTZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJ3YXRjaGVycyIsIk1hcCIsImxvY2tzIiwibG9ja1RpbWVvdXQiLCJsaXN0ZW5lcnMiLCJTZXQiLCJ3YXRjaE9wdGlvbnMiLCJwZXJzaXN0ZW50IiwiaWdub3JlSW5pdGlhbCIsImF3YWl0V3JpdGVGaW5pc2giLCJzdGFiaWxpdHlUaHJlc2hvbGQiLCJwb2xsSW50ZXJ2YWwiLCJpZ25vcmVQZXJtaXNzaW9uRXJyb3JzIiwid2F0Y2giLCJwYXRocyIsIm9wdGlvbnMiLCJ3YXRjaFBhdGhzIiwiQXJyYXkiLCJpc0FycmF5Iiwid2F0Y2hJZCIsImdlbmVyYXRlV2F0Y2hJZCIsImhhcyIsInN1Y2Nlc3MiLCJlcnJvciIsIndhdGNoUGF0aCIsInN0YXRzIiwiZ2V0U3RhdHMiLCJpZ25vcmVkIiwiaWdub3JlIiwiZGVwdGgiLCJyZWN1cnNpdmUiLCJ1bmRlZmluZWQiLCJ3YXRjaGVyIiwib24iLCJmaWxlUGF0aCIsImVtaXRFdmVudCIsInRvU3RyaW5nIiwic2V0IiwiY29uc29sZSIsIm1lc3NhZ2UiLCJ1bndhdGNoIiwiZ2V0IiwiY2xvc2UiLCJkZWxldGUiLCJhY3F1aXJlTG9jayIsInRpbWVvdXQiLCJ2YWxpZFBhdGgiLCJ2YWxpZGF0ZVBhdGgiLCJyZWxlYXNlIiwibG9jayIsInN0YWxlIiwicmV0cmllcyIsIndhaXQiLCJyZXRyeVdhaXQiLCJhY3F1aXJlZCIsIkRhdGUiLCJub3ciLCJjb2RlIiwicmVsZWFzZUxvY2siLCJpc0xvY2tlZCIsImxvY2tlZCIsImxvY2tlZEJ5IiwiY2hlY2siLCJhZGRMaXN0ZW5lciIsImxpc3RlbmVyIiwiYWRkIiwicmVtb3ZlTGlzdGVuZXIiLCJldmVudCIsImV2ZW50RGF0YSIsInRpbWVzdGFtcCIsImZvckVhY2giLCJlcnIiLCJzb3J0ZWRQYXRocyIsInNvcnQiLCJqb2luIiwiY2xlYW51cCIsImVudHJpZXMiLCJjbGVhciIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvRmlsZVdhdGNoZXJTZXJ2aWNlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBGaWxlV2F0Y2hlclNlcnZpY2UuanNcclxuICogUHJvdmlkZXMgZmlsZSBzeXN0ZW0gd2F0Y2hpbmcgY2FwYWJpbGl0aWVzIHdpdGggbG9jayBtYW5hZ2VtZW50LlxyXG4gKiBcclxuICogVGhpcyBzZXJ2aWNlIG1vbml0b3JzIGZpbGUgYW5kIGRpcmVjdG9yeSBjaGFuZ2VzLCBtYW5hZ2VzIGZpbGUgbG9ja3NcclxuICogdG8gcHJldmVudCBjb25jdXJyZW50IGFjY2VzcyBpc3N1ZXMsIGFuZCBlbWl0cyBldmVudHMgd2hlbiBmaWxlc1xyXG4gKiBhcmUgYWRkZWQsIGNoYW5nZWQsIG9yIHJlbW92ZWQuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIEZpbGVTeXN0ZW1TZXJ2aWNlLmpzOiBDb3JlIGZpbGUgb3BlcmF0aW9uc1xyXG4gKiAtIGlwYy9oYW5kbGVycy9maWxld2F0Y2hlci9pbmRleC5qczogSVBDIGhhbmRsZXJzIGZvciBmaWxlIHdhdGNoaW5nXHJcbiAqL1xyXG5cclxuY29uc3QgY2hva2lkYXIgPSByZXF1aXJlKCdjaG9raWRhcicpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCBsb2NrZmlsZSA9IHJlcXVpcmUoJ3Byb3Blci1sb2NrZmlsZScpO1xyXG5jb25zdCB7IGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgeyBpbnN0YW5jZTogRmlsZVN5c3RlbVNlcnZpY2UgfSA9IHJlcXVpcmUoJy4vRmlsZVN5c3RlbVNlcnZpY2UnKTsgLy8gSW1wb3J0IGluc3RhbmNlXHJcblxyXG5jbGFzcyBGaWxlV2F0Y2hlclNlcnZpY2Uge1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy53YXRjaGVycyA9IG5ldyBNYXAoKTsgLy8gTWFwIG9mIHBhdGggLT4gd2F0Y2hlclxyXG4gICAgdGhpcy5sb2NrcyA9IG5ldyBNYXAoKTsgLy8gTWFwIG9mIHBhdGggLT4gbG9jayBpbmZvXHJcbiAgICB0aGlzLmxvY2tUaW1lb3V0ID0gMzAwMDA7IC8vIDMwIHNlY29uZHMgZGVmYXVsdCBsb2NrIHRpbWVvdXRcclxuICAgIHRoaXMubGlzdGVuZXJzID0gbmV3IFNldCgpOyAvLyBFdmVudCBsaXN0ZW5lcnNcclxuICAgIHRoaXMud2F0Y2hPcHRpb25zID0ge1xyXG4gICAgICBwZXJzaXN0ZW50OiB0cnVlLFxyXG4gICAgICBpZ25vcmVJbml0aWFsOiBmYWxzZSxcclxuICAgICAgYXdhaXRXcml0ZUZpbmlzaDoge1xyXG4gICAgICAgIHN0YWJpbGl0eVRocmVzaG9sZDogMjAwMCxcclxuICAgICAgICBwb2xsSW50ZXJ2YWw6IDEwMFxyXG4gICAgICB9LFxyXG4gICAgICBpZ25vcmVQZXJtaXNzaW9uRXJyb3JzOiB0cnVlXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU3RhcnQgd2F0Y2hpbmcgYSBmaWxlIG9yIGRpcmVjdG9yeVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfHN0cmluZ1tdfSBwYXRocyAtIFBhdGgocykgdG8gd2F0Y2hcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIFdhdGNoIG9wdGlvbnNcclxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLnJlY3Vyc2l2ZT10cnVlXSAtIFdhdGNoIHN1YmRpcmVjdG9yaWVzXHJcbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW29wdGlvbnMuaWdub3JlPVtdXSAtIFBhdGhzIHRvIGlnbm9yZVxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzdWNjZXNzOiBib29sZWFuLCBlcnJvcj86IHN0cmluZ30+fVxyXG4gICAqL1xyXG4gIGFzeW5jIHdhdGNoKHBhdGhzLCBvcHRpb25zID0ge30pIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHdhdGNoUGF0aHMgPSBBcnJheS5pc0FycmF5KHBhdGhzKSA/IHBhdGhzIDogW3BhdGhzXTtcclxuICAgICAgY29uc3Qgd2F0Y2hJZCA9IHRoaXMuZ2VuZXJhdGVXYXRjaElkKHdhdGNoUGF0aHMpO1xyXG4gICAgICBcclxuICAgICAgaWYgKHRoaXMud2F0Y2hlcnMuaGFzKHdhdGNoSWQpKSB7XHJcbiAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSwgXHJcbiAgICAgICAgICBlcnJvcjogJ0FscmVhZHkgd2F0Y2hpbmcgdGhlc2UgcGF0aHMnIFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFZhbGlkYXRlIHBhdGhzXHJcbiAgICAgIGZvciAoY29uc3Qgd2F0Y2hQYXRoIG9mIHdhdGNoUGF0aHMpIHtcclxuICAgICAgICAvLyBBc3N1bWluZyBGaWxlU3lzdGVtU2VydmljZSBpbnN0YW5jZSBoYXMgZ2V0U3RhdHMgbWV0aG9kXHJcbiAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBGaWxlU3lzdGVtU2VydmljZS5nZXRTdGF0cyh3YXRjaFBhdGgpO1xyXG4gICAgICAgIGlmICghc3RhdHMuc3VjY2Vzcykge1xyXG4gICAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICAgICAgZXJyb3I6IGBJbnZhbGlkIHBhdGg6ICR7d2F0Y2hQYXRofWAgXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gQ29uZmlndXJlIHdhdGNoZXJcclxuICAgICAgY29uc3Qgd2F0Y2hPcHRpb25zID0ge1xyXG4gICAgICAgIC4uLnRoaXMud2F0Y2hPcHRpb25zLFxyXG4gICAgICAgIGlnbm9yZWQ6IG9wdGlvbnMuaWdub3JlIHx8IFtdLFxyXG4gICAgICAgIGRlcHRoOiBvcHRpb25zLnJlY3Vyc2l2ZSAhPT0gZmFsc2UgPyB1bmRlZmluZWQgOiAwXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBDcmVhdGUgd2F0Y2hlclxyXG4gICAgICBjb25zdCB3YXRjaGVyID0gY2hva2lkYXIud2F0Y2god2F0Y2hQYXRocywgd2F0Y2hPcHRpb25zKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFNldCB1cCBldmVudCBoYW5kbGVyc1xyXG4gICAgICB3YXRjaGVyLm9uKCdhZGQnLCAoZmlsZVBhdGgpID0+IHRoaXMuZW1pdEV2ZW50KCdhZGQnLCBmaWxlUGF0aCkpO1xyXG4gICAgICB3YXRjaGVyLm9uKCdjaGFuZ2UnLCAoZmlsZVBhdGgpID0+IHRoaXMuZW1pdEV2ZW50KCdjaGFuZ2UnLCBmaWxlUGF0aCkpO1xyXG4gICAgICB3YXRjaGVyLm9uKCd1bmxpbmsnLCAoZmlsZVBhdGgpID0+IHRoaXMuZW1pdEV2ZW50KCd1bmxpbmsnLCBmaWxlUGF0aCkpO1xyXG4gICAgICB3YXRjaGVyLm9uKCdlcnJvcicsIChlcnJvcikgPT4gdGhpcy5lbWl0RXZlbnQoJ2Vycm9yJywgJycsIGVycm9yLnRvU3RyaW5nKCkpKTtcclxuXHJcbiAgICAgIC8vIFN0b3JlIHdhdGNoZXJcclxuICAgICAgdGhpcy53YXRjaGVycy5zZXQod2F0Y2hJZCwge1xyXG4gICAgICAgIHdhdGNoZXIsXHJcbiAgICAgICAgcGF0aHM6IHdhdGNoUGF0aHMsXHJcbiAgICAgICAgb3B0aW9uc1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIHJldHVybiB7IFxyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgd2F0Y2hJZFxyXG4gICAgICB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmlsZSB3YXRjaCBlcnJvcjonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGBGYWlsZWQgdG8gc3RhcnQgd2F0Y2hpbmc6ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTdG9wIHdhdGNoaW5nIHBhdGgocylcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gd2F0Y2hJZCAtIFdhdGNoIElEIHRvIHN0b3BcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBzdHJpbmd9Pn1cclxuICAgKi9cclxuICBhc3luYyB1bndhdGNoKHdhdGNoSWQpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICghdGhpcy53YXRjaGVycy5oYXMod2F0Y2hJZCkpIHtcclxuICAgICAgICByZXR1cm4geyBcclxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICAgIGVycm9yOiAnTm90IHdhdGNoaW5nIHRoaXMgcGF0aCcgXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgeyB3YXRjaGVyIH0gPSB0aGlzLndhdGNoZXJzLmdldCh3YXRjaElkKTtcclxuICAgICAgYXdhaXQgd2F0Y2hlci5jbG9zZSgpO1xyXG4gICAgICB0aGlzLndhdGNoZXJzLmRlbGV0ZSh3YXRjaElkKTtcclxuXHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZpbGUgdW53YXRjaCBlcnJvcjonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGBGYWlsZWQgdG8gc3RvcCB3YXRjaGluZzogJHtlcnJvci5tZXNzYWdlfWBcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEFjcXVpcmUgYSBsb2NrIG9uIGEgZmlsZVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gbG9ja1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gTG9jayBvcHRpb25zXHJcbiAgICogQHBhcmFtIHtudW1iZXJ9IFtvcHRpb25zLnRpbWVvdXQ9MzAwMDBdIC0gTG9jayB0aW1lb3V0IGluIG1zXHJcbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy53YWl0PWZhbHNlXSAtIFdhaXQgZm9yIGxvY2sgaWYgYWxyZWFkeSBsb2NrZWRcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBzdHJpbmd9Pn1cclxuICAgKi9cclxuICBhc3luYyBhY3F1aXJlTG9jayhmaWxlUGF0aCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB0aW1lb3V0ID0gb3B0aW9ucy50aW1lb3V0IHx8IHRoaXMubG9ja1RpbWVvdXQ7XHJcbiAgICAgIC8vIEFzc3VtaW5nIEZpbGVTeXN0ZW1TZXJ2aWNlIGluc3RhbmNlIGhhcyB2YWxpZGF0ZVBhdGggbWV0aG9kXHJcbiAgICAgIGNvbnN0IHZhbGlkUGF0aCA9IGF3YWl0IEZpbGVTeXN0ZW1TZXJ2aWNlLnZhbGlkYXRlUGF0aChmaWxlUGF0aCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBpZiBhbHJlYWR5IGxvY2tlZCBieSB1c1xyXG4gICAgICBpZiAodGhpcy5sb2Nrcy5oYXModmFsaWRQYXRoKSkge1xyXG4gICAgICAgIHJldHVybiB7IFxyXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsIFxyXG4gICAgICAgICAgZXJyb3I6ICdGaWxlIGFscmVhZHkgbG9ja2VkIGJ5IHRoaXMgcHJvY2VzcycgXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gVHJ5IHRvIGFjcXVpcmUgbG9ja1xyXG4gICAgICBjb25zdCByZWxlYXNlID0gYXdhaXQgbG9ja2ZpbGUubG9jayh2YWxpZFBhdGgsIHtcclxuICAgICAgICBzdGFsZTogdGltZW91dCxcclxuICAgICAgICByZXRyaWVzOiBvcHRpb25zLndhaXQgPyA1IDogMCxcclxuICAgICAgICByZXRyeVdhaXQ6IDEwMDBcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBTdG9yZSBsb2NrIGluZm9cclxuICAgICAgdGhpcy5sb2Nrcy5zZXQodmFsaWRQYXRoLCB7XHJcbiAgICAgICAgYWNxdWlyZWQ6IERhdGUubm93KCksXHJcbiAgICAgICAgdGltZW91dCxcclxuICAgICAgICByZWxlYXNlXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmlsZSBsb2NrIGVycm9yOicsIGVycm9yKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGlmIGZpbGUgaXMgbG9ja2VkIGJ5IGFub3RoZXIgcHJvY2Vzc1xyXG4gICAgICBpZiAoZXJyb3IuY29kZSA9PT0gJ0VMT0NLRUQnKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgZXJyb3I6ICdGaWxlIGlzIGxvY2tlZCBieSBhbm90aGVyIHByb2Nlc3MnXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYEZhaWxlZCB0byBsb2NrIGZpbGU6ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSZWxlYXNlIGEgbG9jayBvbiBhIGZpbGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIHVubG9ja1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzdWNjZXNzOiBib29sZWFuLCBlcnJvcj86IHN0cmluZ30+fVxyXG4gICAqL1xyXG4gIGFzeW5jIHJlbGVhc2VMb2NrKGZpbGVQYXRoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBBc3N1bWluZyBGaWxlU3lzdGVtU2VydmljZSBpbnN0YW5jZSBoYXMgdmFsaWRhdGVQYXRoIG1ldGhvZFxyXG4gICAgICBjb25zdCB2YWxpZFBhdGggPSBhd2FpdCBGaWxlU3lzdGVtU2VydmljZS52YWxpZGF0ZVBhdGgoZmlsZVBhdGgpO1xyXG4gICAgICBcclxuICAgICAgaWYgKCF0aGlzLmxvY2tzLmhhcyh2YWxpZFBhdGgpKSB7XHJcbiAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSwgXHJcbiAgICAgICAgICBlcnJvcjogJ0ZpbGUgbm90IGxvY2tlZCBieSB0aGlzIHByb2Nlc3MnIFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHsgcmVsZWFzZSB9ID0gdGhpcy5sb2Nrcy5nZXQodmFsaWRQYXRoKTtcclxuICAgICAgYXdhaXQgcmVsZWFzZSgpO1xyXG4gICAgICB0aGlzLmxvY2tzLmRlbGV0ZSh2YWxpZFBhdGgpO1xyXG5cclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmlsZSB1bmxvY2sgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBgRmFpbGVkIHRvIHVubG9jayBmaWxlOiAke2Vycm9yLm1lc3NhZ2V9YFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2hlY2sgaWYgYSBmaWxlIGlzIGxvY2tlZFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gY2hlY2tcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgbG9ja2VkOiBib29sZWFuLCBlcnJvcj86IHN0cmluZ30+fVxyXG4gICAqL1xyXG4gIGFzeW5jIGlzTG9ja2VkKGZpbGVQYXRoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBBc3N1bWluZyBGaWxlU3lzdGVtU2VydmljZSBpbnN0YW5jZSBoYXMgdmFsaWRhdGVQYXRoIG1ldGhvZFxyXG4gICAgICBjb25zdCB2YWxpZFBhdGggPSBhd2FpdCBGaWxlU3lzdGVtU2VydmljZS52YWxpZGF0ZVBhdGgoZmlsZVBhdGgpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgaWYgbG9ja2VkIGJ5IHVzXHJcbiAgICAgIGlmICh0aGlzLmxvY2tzLmhhcyh2YWxpZFBhdGgpKSB7XHJcbiAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLCBcclxuICAgICAgICAgIGxvY2tlZDogdHJ1ZSxcclxuICAgICAgICAgIGxvY2tlZEJ5OiAnc2VsZidcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiBsb2NrZWQgYnkgYW5vdGhlciBwcm9jZXNzXHJcbiAgICAgIGNvbnN0IGxvY2tlZCA9IGF3YWl0IGxvY2tmaWxlLmNoZWNrKHZhbGlkUGF0aCk7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICBsb2NrZWQsXHJcbiAgICAgICAgbG9ja2VkQnk6IGxvY2tlZCA/ICdvdGhlcicgOiBudWxsXHJcbiAgICAgIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdGaWxlIGxvY2sgY2hlY2sgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBgRmFpbGVkIHRvIGNoZWNrIGxvY2s6ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBBZGQgYW4gZXZlbnQgbGlzdGVuZXJcclxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBsaXN0ZW5lciAtIEV2ZW50IGxpc3RlbmVyIGZ1bmN0aW9uXHJcbiAgICogQHJldHVybnMge2Jvb2xlYW59IFN1Y2Nlc3NcclxuICAgKi9cclxuICBhZGRMaXN0ZW5lcihsaXN0ZW5lcikge1xyXG4gICAgaWYgKHR5cGVvZiBsaXN0ZW5lciAhPT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICB0aGlzLmxpc3RlbmVycy5hZGQobGlzdGVuZXIpO1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSZW1vdmUgYW4gZXZlbnQgbGlzdGVuZXJcclxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBsaXN0ZW5lciAtIEV2ZW50IGxpc3RlbmVyIGZ1bmN0aW9uXHJcbiAgICogQHJldHVybnMge2Jvb2xlYW59IFN1Y2Nlc3NcclxuICAgKi9cclxuICByZW1vdmVMaXN0ZW5lcihsaXN0ZW5lcikge1xyXG4gICAgcmV0dXJuIHRoaXMubGlzdGVuZXJzLmRlbGV0ZShsaXN0ZW5lcik7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBFbWl0IGEgZmlsZSBldmVudCB0byBhbGwgbGlzdGVuZXJzXHJcbiAgICogQHByaXZhdGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXZlbnQgLSBFdmVudCB0eXBlICgnYWRkJywgJ2NoYW5nZScsICd1bmxpbmsnLCAnZXJyb3InKVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIEFmZmVjdGVkIGZpbGUgcGF0aFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZXJyb3JdIC0gRXJyb3IgbWVzc2FnZSBpZiBldmVudCBpcyAnZXJyb3InXHJcbiAgICovXHJcbiAgZW1pdEV2ZW50KGV2ZW50LCBmaWxlUGF0aCwgZXJyb3IpIHtcclxuICAgIGNvbnN0IGV2ZW50RGF0YSA9IHtcclxuICAgICAgZXZlbnQsXHJcbiAgICAgIHBhdGg6IGZpbGVQYXRoLFxyXG4gICAgICB0aW1lc3RhbXA6IERhdGUubm93KClcclxuICAgIH07XHJcblxyXG4gICAgaWYgKGV2ZW50ID09PSAnZXJyb3InICYmIGVycm9yKSB7XHJcbiAgICAgIGV2ZW50RGF0YS5lcnJvciA9IGVycm9yO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMubGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXIgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGxpc3RlbmVyKGV2ZW50RGF0YSk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGZpbGUgd2F0Y2hlciBsaXN0ZW5lcjonLCBlcnIpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdlbmVyYXRlIGEgdW5pcXVlIHdhdGNoIElEIGZvciBhIHNldCBvZiBwYXRoc1xyXG4gICAqIEBwcml2YXRlXHJcbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aHMgLSBQYXRocyB0byB3YXRjaFxyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFdhdGNoIElEXHJcbiAgICovXHJcbiAgZ2VuZXJhdGVXYXRjaElkKHBhdGhzKSB7XHJcbiAgICBjb25zdCBzb3J0ZWRQYXRocyA9IFsuLi5wYXRoc10uc29ydCgpO1xyXG4gICAgcmV0dXJuIHNvcnRlZFBhdGhzLmpvaW4oJ3wnKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENsZWFuIHVwIGFsbCB3YXRjaGVycyBhbmQgbG9ja3NcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cclxuICAgKi9cclxuICBhc3luYyBjbGVhbnVwKCkge1xyXG4gICAgLy8gQ2xvc2UgYWxsIHdhdGNoZXJzXHJcbiAgICBmb3IgKGNvbnN0IFt3YXRjaElkLCB7IHdhdGNoZXIgfV0gb2YgdGhpcy53YXRjaGVycy5lbnRyaWVzKCkpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCB3YXRjaGVyLmNsb3NlKCk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgY2xvc2luZyB3YXRjaGVyICR7d2F0Y2hJZH06YCwgZXJyb3IpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICB0aGlzLndhdGNoZXJzLmNsZWFyKCk7XHJcblxyXG4gICAgLy8gUmVsZWFzZSBhbGwgbG9ja3NcclxuICAgIGZvciAoY29uc3QgW2ZpbGVQYXRoLCB7IHJlbGVhc2UgfV0gb2YgdGhpcy5sb2Nrcy5lbnRyaWVzKCkpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCByZWxlYXNlKCk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgcmVsZWFzaW5nIGxvY2sgb24gJHtmaWxlUGF0aH06YCwgZXJyb3IpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICB0aGlzLmxvY2tzLmNsZWFyKCk7XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IG5ldyBGaWxlV2F0Y2hlclNlcnZpY2UoKTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxRQUFRLEdBQUdDLE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDcEMsTUFBTUMsSUFBSSxHQUFHRCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1FLFFBQVEsR0FBR0YsT0FBTyxDQUFDLGlCQUFpQixDQUFDO0FBQzNDLE1BQU07RUFBRUc7QUFBSSxDQUFDLEdBQUdILE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDbkMsTUFBTTtFQUFFSSxRQUFRLEVBQUVDO0FBQWtCLENBQUMsR0FBR0wsT0FBTyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FB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