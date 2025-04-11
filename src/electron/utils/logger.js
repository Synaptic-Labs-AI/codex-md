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
const { app } = require('electron');

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
