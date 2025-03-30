/**
 * Native Notifications Integration for the Electron application.
 * Provides cross-platform notification functionality for conversion events and errors.
 * 
 * Related files:
 * - main.js: Main process entry point
 * - ipc/handlers/conversion/index.js: Conversion event handlers
 */

const { Notification, app } = require('electron');
const path = require('path');

/**
 * Manages native notifications for the application
 */
class NotificationManager {
  /**
   * Creates a new NotificationManager instance
   */
  constructor() {
    // Set up platform-specific notification settings
    this.setupPlatformSpecific();
  }

  /**
   * Sets up platform-specific notification settings
   */
  setupPlatformSpecific() {
    // On Windows, set the app user model ID for notifications to work
    if (process.platform === 'win32') {
      app.setAppUserModelId(process.execPath);
    }
  }

  /**
   * Shows a notification for a completed conversion
   * @param {string} filePath - Path to the converted file
   * @param {string} outputPath - Path to the output file
   */
  showConversionComplete(filePath, outputPath) {
    const fileName = path.basename(filePath);
    
    const notification = new Notification({
      title: 'Conversion Complete',
      body: `Successfully converted ${fileName}`,
      // TODO: Replace with actual success icon
      // icon: path.join(__dirname, '../assets/success-icon.png'),
      silent: false
    });
    
    // Handle notification click - open the output file
    notification.on('click', () => {
      if (outputPath) {
        const { shell } = require('electron');
        shell.showItemInFolder(outputPath);
      }
    });
    
    notification.show();
  }

  /**
   * Shows a notification for a batch conversion completion
   * @param {number} count - Number of files converted
   * @param {string} outputDir - Path to the output directory
   */
  showBatchConversionComplete(count, outputDir) {
    const notification = new Notification({
      title: 'Batch Conversion Complete',
      body: `Successfully converted ${count} files`,
      // TODO: Replace with actual success icon
      // icon: path.join(__dirname, '../assets/success-icon.png'),
      silent: false
    });
    
    // Handle notification click - open the output directory
    notification.on('click', () => {
      if (outputDir) {
        const { shell } = require('electron');
        shell.openPath(outputDir);
      }
    });
    
    notification.show();
  }

  /**
   * Shows a notification for a conversion error
   * @param {string} filePath - Path to the file that failed conversion
   * @param {Error} error - The error that occurred
   */
  showConversionError(filePath, error) {
    const fileName = path.basename(filePath);
    
    const notification = new Notification({
      title: 'Conversion Error',
      body: `Error converting ${fileName}: ${error.message}`,
      // TODO: Replace with actual error icon
      // icon: path.join(__dirname, '../assets/error-icon.png'),
      silent: false
    });
    
    notification.show();
  }

  /**
   * Shows a notification for an API key error
   * @param {string} provider - The API provider (e.g., 'OpenAI')
   * @param {string} message - The error message
   */
  showApiKeyError(provider, message) {
    const notification = new Notification({
      title: `${provider} API Key Error`,
      body: message,
      // TODO: Replace with actual error icon
      // icon: path.join(__dirname, '../assets/error-icon.png'),
      silent: false
    });
    
    notification.show();
  }

  /**
   * Shows a notification for a network status change
   * @param {boolean} isOnline - Whether the app is online
   */
  showNetworkStatusChange(isOnline) {
    if (isOnline) {
      const notification = new Notification({
        title: 'Network Connection Restored',
        body: 'You are now online. Queued operations will resume.',
        // TODO: Replace with actual online icon
        // icon: path.join(__dirname, '../assets/online-icon.png'),
        silent: true
      });
      
      notification.show();
    } else {
      const notification = new Notification({
        title: 'Network Connection Lost',
        body: 'You are now offline. Operations will be queued.',
        // TODO: Replace with actual offline icon
        // icon: path.join(__dirname, '../assets/offline-icon.png'),
        silent: true
      });
      
      notification.show();
    }
  }

  /**
   * Shows a notification for a file watch event
   * @param {string} filePath - Path to the file that changed
   * @param {string} event - The event type (e.g., 'changed', 'added', 'removed')
   */
  showFileWatchEvent(filePath, event) {
    const fileName = path.basename(filePath);
    
    const notification = new Notification({
      title: 'File Change Detected',
      body: `${fileName} was ${event}`,
      // TODO: Replace with actual file icon
      // icon: path.join(__dirname, '../assets/file-icon.png'),
      silent: true
    });
    
    notification.show();
  }

  /**
   * Shows a notification for an update available
   * @param {string} version - The new version available
   */
  showUpdateAvailable(version) {
    const notification = new Notification({
      title: 'Update Available',
      body: `Version ${version} is available. Click to update.`,
      // TODO: Replace with actual update icon
      // icon: path.join(__dirname, '../assets/update-icon.png'),
      silent: false
    });
    
    // Handle notification click - trigger update
    notification.on('click', () => {
      // This will be implemented when we add auto-updates
    });
    
    notification.show();
  }
}

module.exports = NotificationManager;
