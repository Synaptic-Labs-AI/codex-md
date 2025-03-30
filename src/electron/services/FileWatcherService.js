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
const { app } = require('electron');
const FileSystemService = require('./FileSystemService');

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
      watcher.on('add', (filePath) => this.emitEvent('add', filePath));
      watcher.on('change', (filePath) => this.emitEvent('change', filePath));
      watcher.on('unlink', (filePath) => this.emitEvent('unlink', filePath));
      watcher.on('error', (error) => this.emitEvent('error', '', error.toString()));

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

      const { watcher } = this.watchers.get(watchId);
      await watcher.close();
      this.watchers.delete(watchId);

      return { success: true };
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

      return { success: true };
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
      const validPath = await FileSystemService.validatePath(filePath);
      
      if (!this.locks.has(validPath)) {
        return { 
          success: false, 
          error: 'File not locked by this process' 
        };
      }

      const { release } = this.locks.get(validPath);
      await release();
      this.locks.delete(validPath);

      return { success: true };
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
    for (const [watchId, { watcher }] of this.watchers.entries()) {
      try {
        await watcher.close();
      } catch (error) {
        console.error(`Error closing watcher ${watchId}:`, error);
      }
    }
    this.watchers.clear();

    // Release all locks
    for (const [filePath, { release }] of this.locks.entries()) {
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
