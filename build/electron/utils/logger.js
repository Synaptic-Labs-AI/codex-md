"use strict";

/**
 * Logger Utility
 * Provides logging functionality with file output for diagnostics
 * 
 * This module creates and manages a log file for the application,
 * allowing detailed logging even when the UI isn't visible.
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const {
  app
} = require('electron');
class Logger {
  constructor() {
    this.logFile = null;
    this.logPath = '';
    this.initialized = false;
  }

  /**
   * Initialize the logger
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Get the app data directory
      const userDataPath = app.getPath('userData');
      const logsDir = path.join(userDataPath, 'logs');

      // Create logs directory if it doesn't exist
      await fs.ensureDir(logsDir);

      // Create a log file with timestamp
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-');
      this.logPath = path.join(logsDir, `app-${timestamp}.log`);

      // Write initial log header
      await fs.writeFile(this.logPath, `=== Codex MD Application Log ===\n`);
      await fs.appendFile(this.logPath, `Started: ${now.toLocaleString()}\n`);
      await fs.appendFile(this.logPath, `Platform: ${process.platform} (${os.release()})\n`);
      await fs.appendFile(this.logPath, `Node: ${process.version}\n`);
      await fs.appendFile(this.logPath, `Electron: ${process.versions.electron}\n`);
      await fs.appendFile(this.logPath, `User Data: ${userDataPath}\n`);
      await fs.appendFile(this.logPath, `================================\n\n`);
      this.initialized = true;
      this.log('Logger initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize logger:', error);
      // Fall back to console only logging
      this.logFile = null;
      return false;
    }
  }

  /**
   * Get the current timestamp
   * @returns {string} Formatted timestamp
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Write a log message to file and console
   * @param {string} message - Log message
   * @param {string} [level='INFO'] - Log level
   */
  async log(message, level = 'INFO') {
    const timestamp = this.getTimestamp();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;

    // Always output to console
    console.log(`${level}: ${message}`);

    // Write to file if initialized
    if (this.initialized) {
      try {
        await fs.appendFile(this.logPath, logMessage);
      } catch (error) {
        console.error('Failed to write to log file:', error);
      }
    }
  }

  /**
   * Log an error message
   * @param {string} message - Error message
   * @param {Error} [error] - Error object
   */
  async error(message, error) {
    let fullMessage = message;
    if (error) {
      fullMessage += `: ${error.message}`;
      if (error.stack) {
        fullMessage += `\nStack: ${error.stack}`;
      }
    }
    await this.log(fullMessage, 'ERROR');
  }

  /**
   * Log a warning message
   * @param {string} message - Warning message
   */
  async warn(message) {
    await this.log(message, 'WARN');
  }

  /**
   * Log detailed debug information
   * @param {string} message - Debug message
   * @param {Object} [data] - Additional data to log
   */
  async debug(message, data) {
    let fullMessage = message;
    if (data) {
      try {
        fullMessage += `\nData: ${JSON.stringify(data, null, 2)}`;
      } catch (error) {
        fullMessage += `\nData: [Cannot stringify data: ${error.message}]`;
      }
    }
    await this.log(fullMessage, 'DEBUG');
  }

  /**
   * Log app startup information
   */
  async logStartup() {
    await this.log('Application starting up', 'STARTUP');

    // Log key environment variables
    await this.debug('Environment', {
      NODE_ENV: process.env.NODE_ENV,
      cwd: process.cwd(),
      resourcesPath: process.resourcesPath,
      execPath: process.execPath,
      argv: process.argv
    });
  }

  /**
   * Log window creation information
   * @param {Object} windowConfig - Window configuration
   */
  async logWindowCreation(windowConfig) {
    await this.log('Creating main window', 'WINDOW');
    await this.debug('Window configuration', windowConfig);
  }

  /**
   * Log asset loading information
   * @param {string} assetPath - Path of the asset being loaded
   * @param {string} resolvedPath - Resolved filesystem path
   */
  async logAssetLoading(assetPath, resolvedPath) {
    await this.log(`Loading asset: ${assetPath}`, 'ASSET');
    await this.debug('Asset resolution', {
      requestedPath: assetPath,
      resolvedPath: resolvedPath
    });
  }

  /**
   * Log an error with file protocol resolution
   * @param {string} requestUrl - Requested URL
   * @param {Error} error - Error object
   */
  async logProtocolError(requestUrl, error) {
    await this.error(`Protocol error for ${requestUrl}`, error);
  }
}

// Create and export a singleton instance
const logger = new Logger();
module.exports = logger;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJwYXRoIiwib3MiLCJhcHAiLCJMb2dnZXIiLCJjb25zdHJ1Y3RvciIsImxvZ0ZpbGUiLCJsb2dQYXRoIiwiaW5pdGlhbGl6ZWQiLCJpbml0aWFsaXplIiwidXNlckRhdGFQYXRoIiwiZ2V0UGF0aCIsImxvZ3NEaXIiLCJqb2luIiwiZW5zdXJlRGlyIiwibm93IiwiRGF0ZSIsInRpbWVzdGFtcCIsInRvSVNPU3RyaW5nIiwicmVwbGFjZSIsIndyaXRlRmlsZSIsImFwcGVuZEZpbGUiLCJ0b0xvY2FsZVN0cmluZyIsInByb2Nlc3MiLCJwbGF0Zm9ybSIsInJlbGVhc2UiLCJ2ZXJzaW9uIiwidmVyc2lvbnMiLCJlbGVjdHJvbiIsImxvZyIsImVycm9yIiwiY29uc29sZSIsImdldFRpbWVzdGFtcCIsIm1lc3NhZ2UiLCJsZXZlbCIsImxvZ01lc3NhZ2UiLCJmdWxsTWVzc2FnZSIsInN0YWNrIiwid2FybiIsImRlYnVnIiwiZGF0YSIsIkpTT04iLCJzdHJpbmdpZnkiLCJsb2dTdGFydHVwIiwiTk9ERV9FTlYiLCJlbnYiLCJjd2QiLCJyZXNvdXJjZXNQYXRoIiwiZXhlY1BhdGgiLCJhcmd2IiwibG9nV2luZG93Q3JlYXRpb24iLCJ3aW5kb3dDb25maWciLCJsb2dBc3NldExvYWRpbmciLCJhc3NldFBhdGgiLCJyZXNvbHZlZFBhdGgiLCJyZXF1ZXN0ZWRQYXRoIiwibG9nUHJvdG9jb2xFcnJvciIsInJlcXVlc3RVcmwiLCJsb2dnZXIiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3V0aWxzL2xvZ2dlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIExvZ2dlciBVdGlsaXR5XG4gKiBQcm92aWRlcyBsb2dnaW5nIGZ1bmN0aW9uYWxpdHkgd2l0aCBmaWxlIG91dHB1dCBmb3IgZGlhZ25vc3RpY3NcbiAqIFxuICogVGhpcyBtb2R1bGUgY3JlYXRlcyBhbmQgbWFuYWdlcyBhIGxvZyBmaWxlIGZvciB0aGUgYXBwbGljYXRpb24sXG4gKiBhbGxvd2luZyBkZXRhaWxlZCBsb2dnaW5nIGV2ZW4gd2hlbiB0aGUgVUkgaXNuJ3QgdmlzaWJsZS5cbiAqL1xuXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xuY29uc3Qgb3MgPSByZXF1aXJlKCdvcycpO1xuY29uc3QgeyBhcHAgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XG5cbmNsYXNzIExvZ2dlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMubG9nRmlsZSA9IG51bGw7XG4gICAgdGhpcy5sb2dQYXRoID0gJyc7XG4gICAgdGhpcy5pbml0aWFsaXplZCA9IGZhbHNlO1xuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgdGhlIGxvZ2dlclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGluaXRpYWxpemUoKSB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEdldCB0aGUgYXBwIGRhdGEgZGlyZWN0b3J5XG4gICAgICBjb25zdCB1c2VyRGF0YVBhdGggPSBhcHAuZ2V0UGF0aCgndXNlckRhdGEnKTtcbiAgICAgIGNvbnN0IGxvZ3NEaXIgPSBwYXRoLmpvaW4odXNlckRhdGFQYXRoLCAnbG9ncycpO1xuICAgICAgXG4gICAgICAvLyBDcmVhdGUgbG9ncyBkaXJlY3RvcnkgaWYgaXQgZG9lc24ndCBleGlzdFxuICAgICAgYXdhaXQgZnMuZW5zdXJlRGlyKGxvZ3NEaXIpO1xuICAgICAgXG4gICAgICAvLyBDcmVhdGUgYSBsb2cgZmlsZSB3aXRoIHRpbWVzdGFtcFxuICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5vdy50b0lTT1N0cmluZygpLnJlcGxhY2UoL1s6Ll0vZywgJy0nKTtcbiAgICAgIHRoaXMubG9nUGF0aCA9IHBhdGguam9pbihsb2dzRGlyLCBgYXBwLSR7dGltZXN0YW1wfS5sb2dgKTtcbiAgICAgIFxuICAgICAgLy8gV3JpdGUgaW5pdGlhbCBsb2cgaGVhZGVyXG4gICAgICBhd2FpdCBmcy53cml0ZUZpbGUodGhpcy5sb2dQYXRoLCBgPT09IENvZGV4IE1EIEFwcGxpY2F0aW9uIExvZyA9PT1cXG5gKTtcbiAgICAgIGF3YWl0IGZzLmFwcGVuZEZpbGUodGhpcy5sb2dQYXRoLCBgU3RhcnRlZDogJHtub3cudG9Mb2NhbGVTdHJpbmcoKX1cXG5gKTtcbiAgICAgIGF3YWl0IGZzLmFwcGVuZEZpbGUodGhpcy5sb2dQYXRoLCBgUGxhdGZvcm06ICR7cHJvY2Vzcy5wbGF0Zm9ybX0gKCR7b3MucmVsZWFzZSgpfSlcXG5gKTtcbiAgICAgIGF3YWl0IGZzLmFwcGVuZEZpbGUodGhpcy5sb2dQYXRoLCBgTm9kZTogJHtwcm9jZXNzLnZlcnNpb259XFxuYCk7XG4gICAgICBhd2FpdCBmcy5hcHBlbmRGaWxlKHRoaXMubG9nUGF0aCwgYEVsZWN0cm9uOiAke3Byb2Nlc3MudmVyc2lvbnMuZWxlY3Ryb259XFxuYCk7XG4gICAgICBhd2FpdCBmcy5hcHBlbmRGaWxlKHRoaXMubG9nUGF0aCwgYFVzZXIgRGF0YTogJHt1c2VyRGF0YVBhdGh9XFxuYCk7XG4gICAgICBhd2FpdCBmcy5hcHBlbmRGaWxlKHRoaXMubG9nUGF0aCwgYD09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XFxuXFxuYCk7XG4gICAgICBcbiAgICAgIHRoaXMuaW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgICAgdGhpcy5sb2coJ0xvZ2dlciBpbml0aWFsaXplZCBzdWNjZXNzZnVsbHknKTtcbiAgICAgIFxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBpbml0aWFsaXplIGxvZ2dlcjonLCBlcnJvcik7XG4gICAgICAvLyBGYWxsIGJhY2sgdG8gY29uc29sZSBvbmx5IGxvZ2dpbmdcbiAgICAgIHRoaXMubG9nRmlsZSA9IG51bGw7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgY3VycmVudCB0aW1lc3RhbXBcbiAgICogQHJldHVybnMge3N0cmluZ30gRm9ybWF0dGVkIHRpbWVzdGFtcFxuICAgKi9cbiAgZ2V0VGltZXN0YW1wKCkge1xuICAgIHJldHVybiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gIH1cblxuICAvKipcbiAgICogV3JpdGUgYSBsb2cgbWVzc2FnZSB0byBmaWxlIGFuZCBjb25zb2xlXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gTG9nIG1lc3NhZ2VcbiAgICogQHBhcmFtIHtzdHJpbmd9IFtsZXZlbD0nSU5GTyddIC0gTG9nIGxldmVsXG4gICAqL1xuICBhc3luYyBsb2cobWVzc2FnZSwgbGV2ZWwgPSAnSU5GTycpIHtcbiAgICBjb25zdCB0aW1lc3RhbXAgPSB0aGlzLmdldFRpbWVzdGFtcCgpO1xuICAgIGNvbnN0IGxvZ01lc3NhZ2UgPSBgWyR7dGltZXN0YW1wfV0gWyR7bGV2ZWx9XSAke21lc3NhZ2V9XFxuYDtcbiAgICBcbiAgICAvLyBBbHdheXMgb3V0cHV0IHRvIGNvbnNvbGVcbiAgICBjb25zb2xlLmxvZyhgJHtsZXZlbH06ICR7bWVzc2FnZX1gKTtcbiAgICBcbiAgICAvLyBXcml0ZSB0byBmaWxlIGlmIGluaXRpYWxpemVkXG4gICAgaWYgKHRoaXMuaW5pdGlhbGl6ZWQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGZzLmFwcGVuZEZpbGUodGhpcy5sb2dQYXRoLCBsb2dNZXNzYWdlKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byB3cml0ZSB0byBsb2cgZmlsZTonLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvZyBhbiBlcnJvciBtZXNzYWdlXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZVxuICAgKiBAcGFyYW0ge0Vycm9yfSBbZXJyb3JdIC0gRXJyb3Igb2JqZWN0XG4gICAqL1xuICBhc3luYyBlcnJvcihtZXNzYWdlLCBlcnJvcikge1xuICAgIGxldCBmdWxsTWVzc2FnZSA9IG1lc3NhZ2U7XG4gICAgXG4gICAgaWYgKGVycm9yKSB7XG4gICAgICBmdWxsTWVzc2FnZSArPSBgOiAke2Vycm9yLm1lc3NhZ2V9YDtcbiAgICAgIGlmIChlcnJvci5zdGFjaykge1xuICAgICAgICBmdWxsTWVzc2FnZSArPSBgXFxuU3RhY2s6ICR7ZXJyb3Iuc3RhY2t9YDtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgYXdhaXQgdGhpcy5sb2coZnVsbE1lc3NhZ2UsICdFUlJPUicpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZyBhIHdhcm5pbmcgbWVzc2FnZVxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIFdhcm5pbmcgbWVzc2FnZVxuICAgKi9cbiAgYXN5bmMgd2FybihtZXNzYWdlKSB7XG4gICAgYXdhaXQgdGhpcy5sb2cobWVzc2FnZSwgJ1dBUk4nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2cgZGV0YWlsZWQgZGVidWcgaW5mb3JtYXRpb25cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBEZWJ1ZyBtZXNzYWdlXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbZGF0YV0gLSBBZGRpdGlvbmFsIGRhdGEgdG8gbG9nXG4gICAqL1xuICBhc3luYyBkZWJ1ZyhtZXNzYWdlLCBkYXRhKSB7XG4gICAgbGV0IGZ1bGxNZXNzYWdlID0gbWVzc2FnZTtcbiAgICBcbiAgICBpZiAoZGF0YSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnVsbE1lc3NhZ2UgKz0gYFxcbkRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZGF0YSwgbnVsbCwgMil9YDtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGZ1bGxNZXNzYWdlICs9IGBcXG5EYXRhOiBbQ2Fubm90IHN0cmluZ2lmeSBkYXRhOiAke2Vycm9yLm1lc3NhZ2V9XWA7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIGF3YWl0IHRoaXMubG9nKGZ1bGxNZXNzYWdlLCAnREVCVUcnKTtcbiAgfVxuICBcbiAgLyoqXG4gICAqIExvZyBhcHAgc3RhcnR1cCBpbmZvcm1hdGlvblxuICAgKi9cbiAgYXN5bmMgbG9nU3RhcnR1cCgpIHtcbiAgICBhd2FpdCB0aGlzLmxvZygnQXBwbGljYXRpb24gc3RhcnRpbmcgdXAnLCAnU1RBUlRVUCcpO1xuICAgIFxuICAgIC8vIExvZyBrZXkgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgYXdhaXQgdGhpcy5kZWJ1ZygnRW52aXJvbm1lbnQnLCB7XG4gICAgICBOT0RFX0VOVjogcHJvY2Vzcy5lbnYuTk9ERV9FTlYsXG4gICAgICBjd2Q6IHByb2Nlc3MuY3dkKCksXG4gICAgICByZXNvdXJjZXNQYXRoOiBwcm9jZXNzLnJlc291cmNlc1BhdGgsXG4gICAgICBleGVjUGF0aDogcHJvY2Vzcy5leGVjUGF0aCxcbiAgICAgIGFyZ3Y6IHByb2Nlc3MuYXJndlxuICAgIH0pO1xuICB9XG4gIFxuICAvKipcbiAgICogTG9nIHdpbmRvdyBjcmVhdGlvbiBpbmZvcm1hdGlvblxuICAgKiBAcGFyYW0ge09iamVjdH0gd2luZG93Q29uZmlnIC0gV2luZG93IGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIGFzeW5jIGxvZ1dpbmRvd0NyZWF0aW9uKHdpbmRvd0NvbmZpZykge1xuICAgIGF3YWl0IHRoaXMubG9nKCdDcmVhdGluZyBtYWluIHdpbmRvdycsICdXSU5ET1cnKTtcbiAgICBhd2FpdCB0aGlzLmRlYnVnKCdXaW5kb3cgY29uZmlndXJhdGlvbicsIHdpbmRvd0NvbmZpZyk7XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBMb2cgYXNzZXQgbG9hZGluZyBpbmZvcm1hdGlvblxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXNzZXRQYXRoIC0gUGF0aCBvZiB0aGUgYXNzZXQgYmVpbmcgbG9hZGVkXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXNvbHZlZFBhdGggLSBSZXNvbHZlZCBmaWxlc3lzdGVtIHBhdGhcbiAgICovXG4gIGFzeW5jIGxvZ0Fzc2V0TG9hZGluZyhhc3NldFBhdGgsIHJlc29sdmVkUGF0aCkge1xuICAgIGF3YWl0IHRoaXMubG9nKGBMb2FkaW5nIGFzc2V0OiAke2Fzc2V0UGF0aH1gLCAnQVNTRVQnKTtcbiAgICBhd2FpdCB0aGlzLmRlYnVnKCdBc3NldCByZXNvbHV0aW9uJywge1xuICAgICAgcmVxdWVzdGVkUGF0aDogYXNzZXRQYXRoLFxuICAgICAgcmVzb2x2ZWRQYXRoOiByZXNvbHZlZFBhdGhcbiAgICB9KTtcbiAgfVxuICBcbiAgLyoqXG4gICAqIExvZyBhbiBlcnJvciB3aXRoIGZpbGUgcHJvdG9jb2wgcmVzb2x1dGlvblxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVxdWVzdFVybCAtIFJlcXVlc3RlZCBVUkxcbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBFcnJvciBvYmplY3RcbiAgICovXG4gIGFzeW5jIGxvZ1Byb3RvY29sRXJyb3IocmVxdWVzdFVybCwgZXJyb3IpIHtcbiAgICBhd2FpdCB0aGlzLmVycm9yKGBQcm90b2NvbCBlcnJvciBmb3IgJHtyZXF1ZXN0VXJsfWAsIGVycm9yKTtcbiAgfVxufVxuXG4vLyBDcmVhdGUgYW5kIGV4cG9ydCBhIHNpbmdsZXRvbiBpbnN0YW5jZVxuY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xubW9kdWxlLmV4cG9ydHMgPSBsb2dnZXI7XG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsRUFBRSxHQUFHQyxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQzlCLE1BQU1DLElBQUksR0FBR0QsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNRSxFQUFFLEdBQUdGLE9BQU8sQ0FBQyxJQUFJLENBQUM7QUFDeEIsTUFBTTtFQUFFRztBQUFJLENBQUMsR0FBR0gsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUVuQyxNQUFNSSxNQUFNLENBQUM7RUFDWEMsV0FBV0EsQ0FBQSxFQUFHO0lBQ1osSUFBSSxDQUFDQyxPQUFPLEdBQUcsSUFBSTtJQUNuQixJQUFJLENBQUNDLE9BQU8sR0FBRyxFQUFFO0lBQ2pCLElBQUksQ0FBQ0MsV0FBVyxHQUFHLEtBQUs7RUFDMUI7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7RUFDRSxNQUFNQyxVQUFVQSxDQUFBLEVBQUc7SUFDakIsSUFBSTtNQUNGO01BQ0EsTUFBTUMsWUFBWSxHQUFHUCxHQUFHLENBQUNRLE9BQU8sQ0FBQyxVQUFVLENBQUM7TUFDNUMsTUFBTUMsT0FBTyxHQUFHWCxJQUFJLENBQUNZLElBQUksQ0FBQ0gsWUFBWSxFQUFFLE1BQU0sQ0FBQzs7TUFFL0M7TUFDQSxNQUFNWCxFQUFFLENBQUNlLFNBQVMsQ0FBQ0YsT0FBTyxDQUFDOztNQUUzQjtNQUNBLE1BQU1HLEdBQUcsR0FBRyxJQUFJQyxJQUFJLENBQUMsQ0FBQztNQUN0QixNQUFNQyxTQUFTLEdBQUdGLEdBQUcsQ0FBQ0csV0FBVyxDQUFDLENBQUMsQ0FBQ0MsT0FBTyxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUM7TUFDekQsSUFBSSxDQUFDWixPQUFPLEdBQUdOLElBQUksQ0FBQ1ksSUFBSSxDQUFDRCxPQUFPLEVBQUUsT0FBT0ssU0FBUyxNQUFNLENBQUM7O01BRXpEO01BQ0EsTUFBTWxCLEVBQUUsQ0FBQ3FCLFNBQVMsQ0FBQyxJQUFJLENBQUNiLE9BQU8sRUFBRSxvQ0FBb0MsQ0FBQztNQUN0RSxNQUFNUixFQUFFLENBQUNzQixVQUFVLENBQUMsSUFBSSxDQUFDZCxPQUFPLEVBQUUsWUFBWVEsR0FBRyxDQUFDTyxjQUFjLENBQUMsQ0FBQyxJQUFJLENBQUM7TUFDdkUsTUFBTXZCLEVBQUUsQ0FBQ3NCLFVBQVUsQ0FBQyxJQUFJLENBQUNkLE9BQU8sRUFBRSxhQUFhZ0IsT0FBTyxDQUFDQyxRQUFRLEtBQUt0QixFQUFFLENBQUN1QixPQUFPLENBQUMsQ0FBQyxLQUFLLENBQUM7TUFDdEYsTUFBTTFCLEVBQUUsQ0FBQ3NCLFVBQVUsQ0FBQyxJQUFJLENBQUNkLE9BQU8sRUFBRSxTQUFTZ0IsT0FBTyxDQUFDRyxPQUFPLElBQUksQ0FBQztNQUMvRCxNQUFNM0IsRUFBRSxDQUFDc0IsVUFBVSxDQUFDLElBQUksQ0FBQ2QsT0FBTyxFQUFFLGFBQWFnQixPQUFPLENBQUNJLFFBQVEsQ0FBQ0MsUUFBUSxJQUFJLENBQUM7TUFDN0UsTUFBTTdCLEVBQUUsQ0FBQ3NCLFVBQVUsQ0FBQyxJQUFJLENBQUNkLE9BQU8sRUFBRSxjQUFjRyxZQUFZLElBQUksQ0FBQztNQUNqRSxNQUFNWCxFQUFFLENBQUNzQixVQUFVLENBQUMsSUFBSSxDQUFDZCxPQUFPLEVBQUUsc0NBQXNDLENBQUM7TUFFekUsSUFBSSxDQUFDQyxXQUFXLEdBQUcsSUFBSTtNQUN2QixJQUFJLENBQUNxQixHQUFHLENBQUMsaUNBQWlDLENBQUM7TUFFM0MsT0FBTyxJQUFJO0lBQ2IsQ0FBQyxDQUFDLE9BQU9DLEtBQUssRUFBRTtNQUNkQyxPQUFPLENBQUNELEtBQUssQ0FBQyw4QkFBOEIsRUFBRUEsS0FBSyxDQUFDO01BQ3BEO01BQ0EsSUFBSSxDQUFDeEIsT0FBTyxHQUFHLElBQUk7TUFDbkIsT0FBTyxLQUFLO0lBQ2Q7RUFDRjs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtFQUNFMEIsWUFBWUEsQ0FBQSxFQUFHO0lBQ2IsT0FBTyxJQUFJaEIsSUFBSSxDQUFDLENBQUMsQ0FBQ0UsV0FBVyxDQUFDLENBQUM7RUFDakM7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtFQUNFLE1BQU1XLEdBQUdBLENBQUNJLE9BQU8sRUFBRUMsS0FBSyxHQUFHLE1BQU0sRUFBRTtJQUNqQyxNQUFNakIsU0FBUyxHQUFHLElBQUksQ0FBQ2UsWUFBWSxDQUFDLENBQUM7SUFDckMsTUFBTUcsVUFBVSxHQUFHLElBQUlsQixTQUFTLE1BQU1pQixLQUFLLEtBQUtELE9BQU8sSUFBSTs7SUFFM0Q7SUFDQUYsT0FBTyxDQUFDRixHQUFHLENBQUMsR0FBR0ssS0FBSyxLQUFLRCxPQUFPLEVBQUUsQ0FBQzs7SUFFbkM7SUFDQSxJQUFJLElBQUksQ0FBQ3pCLFdBQVcsRUFBRTtNQUNwQixJQUFJO1FBQ0YsTUFBTVQsRUFBRSxDQUFDc0IsVUFBVSxDQUFDLElBQUksQ0FBQ2QsT0FBTyxFQUFFNEIsVUFBVSxDQUFDO01BQy9DLENBQUMsQ0FBQyxPQUFPTCxLQUFLLEVBQUU7UUFDZEMsT0FBTyxDQUFDRCxLQUFLLENBQUMsOEJBQThCLEVBQUVBLEtBQUssQ0FBQztNQUN0RDtJQUNGO0VBQ0Y7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtFQUNFLE1BQU1BLEtBQUtBLENBQUNHLE9BQU8sRUFBRUgsS0FBSyxFQUFFO0lBQzFCLElBQUlNLFdBQVcsR0FBR0gsT0FBTztJQUV6QixJQUFJSCxLQUFLLEVBQUU7TUFDVE0sV0FBVyxJQUFJLEtBQUtOLEtBQUssQ0FBQ0csT0FBTyxFQUFFO01BQ25DLElBQUlILEtBQUssQ0FBQ08sS0FBSyxFQUFFO1FBQ2ZELFdBQVcsSUFBSSxZQUFZTixLQUFLLENBQUNPLEtBQUssRUFBRTtNQUMxQztJQUNGO0lBRUEsTUFBTSxJQUFJLENBQUNSLEdBQUcsQ0FBQ08sV0FBVyxFQUFFLE9BQU8sQ0FBQztFQUN0Qzs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtFQUNFLE1BQU1FLElBQUlBLENBQUNMLE9BQU8sRUFBRTtJQUNsQixNQUFNLElBQUksQ0FBQ0osR0FBRyxDQUFDSSxPQUFPLEVBQUUsTUFBTSxDQUFDO0VBQ2pDOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7RUFDRSxNQUFNTSxLQUFLQSxDQUFDTixPQUFPLEVBQUVPLElBQUksRUFBRTtJQUN6QixJQUFJSixXQUFXLEdBQUdILE9BQU87SUFFekIsSUFBSU8sSUFBSSxFQUFFO01BQ1IsSUFBSTtRQUNGSixXQUFXLElBQUksV0FBV0ssSUFBSSxDQUFDQyxTQUFTLENBQUNGLElBQUksRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLEVBQUU7TUFDM0QsQ0FBQyxDQUFDLE9BQU9WLEtBQUssRUFBRTtRQUNkTSxXQUFXLElBQUksbUNBQW1DTixLQUFLLENBQUNHLE9BQU8sR0FBRztNQUNwRTtJQUNGO0lBRUEsTUFBTSxJQUFJLENBQUNKLEdBQUcsQ0FBQ08sV0FBVyxFQUFFLE9BQU8sQ0FBQztFQUN0Qzs7RUFFQTtBQUNGO0FBQ0E7RUFDRSxNQUFNTyxVQUFVQSxDQUFBLEVBQUc7SUFDakIsTUFBTSxJQUFJLENBQUNkLEdBQUcsQ0FBQyx5QkFBeUIsRUFBRSxTQUFTLENBQUM7O0lBRXBEO0lBQ0EsTUFBTSxJQUFJLENBQUNVLEtBQUssQ0FBQyxhQUFhLEVBQUU7TUFDOUJLLFFBQVEsRUFBRXJCLE9BQU8sQ0FBQ3NCLEdBQUcsQ0FBQ0QsUUFBUTtNQUM5QkUsR0FBRyxFQUFFdkIsT0FBTyxDQUFDdUIsR0FBRyxDQUFDLENBQUM7TUFDbEJDLGFBQWEsRUFBRXhCLE9BQU8sQ0FBQ3dCLGFBQWE7TUFDcENDLFFBQVEsRUFBRXpCLE9BQU8sQ0FBQ3lCLFFBQVE7TUFDMUJDLElBQUksRUFBRTFCLE9BQU8sQ0FBQzBCO0lBQ2hCLENBQUMsQ0FBQztFQUNKOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0VBQ0UsTUFBTUMsaUJBQWlCQSxDQUFDQyxZQUFZLEVBQUU7SUFDcEMsTUFBTSxJQUFJLENBQUN0QixHQUFHLENBQUMsc0JBQXNCLEVBQUUsUUFBUSxDQUFDO0lBQ2hELE1BQU0sSUFBSSxDQUFDVSxLQUFLLENBQUMsc0JBQXNCLEVBQUVZLFlBQVksQ0FBQztFQUN4RDs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsTUFBTUMsZUFBZUEsQ0FBQ0MsU0FBUyxFQUFFQyxZQUFZLEVBQUU7SUFDN0MsTUFBTSxJQUFJLENBQUN6QixHQUFHLENBQUMsa0JBQWtCd0IsU0FBUyxFQUFFLEVBQUUsT0FBTyxDQUFDO0lBQ3RELE1BQU0sSUFBSSxDQUFDZCxLQUFLLENBQUMsa0JBQWtCLEVBQUU7TUFDbkNnQixhQUFhLEVBQUVGLFNBQVM7TUFDeEJDLFlBQVksRUFBRUE7SUFDaEIsQ0FBQyxDQUFDO0VBQ0o7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtFQUNFLE1BQU1FLGdCQUFnQkEsQ0FBQ0MsVUFBVSxFQUFFM0IsS0FBSyxFQUFFO0lBQ3hDLE1BQU0sSUFBSSxDQUFDQSxLQUFLLENBQUMsc0JBQXNCMkIsVUFBVSxFQUFFLEVBQUUzQixLQUFLLENBQUM7RUFDN0Q7QUFDRjs7QUFFQTtBQUNBLE1BQU00QixNQUFNLEdBQUcsSUFBSXRELE1BQU0sQ0FBQyxDQUFDO0FBQzNCdUQsTUFBTSxDQUFDQyxPQUFPLEdBQUdGLE1BQU0iLCJpZ25vcmVMaXN0IjpbXX0=