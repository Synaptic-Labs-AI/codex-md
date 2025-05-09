"use strict";

/**
 * Native Notifications Integration for the Electron application.
 * Provides cross-platform notification functionality for conversion events and errors.
 * 
 * Related files:
 * - main.js: Main process entry point
 * - ipc/handlers/conversion/index.js: Conversion event handlers
 */

const {
  Notification,
  app
} = require('electron');
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
        const {
          shell
        } = require('electron');
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
        const {
          shell
        } = require('electron');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJOb3RpZmljYXRpb24iLCJhcHAiLCJyZXF1aXJlIiwicGF0aCIsIk5vdGlmaWNhdGlvbk1hbmFnZXIiLCJjb25zdHJ1Y3RvciIsInNldHVwUGxhdGZvcm1TcGVjaWZpYyIsInByb2Nlc3MiLCJwbGF0Zm9ybSIsInNldEFwcFVzZXJNb2RlbElkIiwiZXhlY1BhdGgiLCJzaG93Q29udmVyc2lvbkNvbXBsZXRlIiwiZmlsZVBhdGgiLCJvdXRwdXRQYXRoIiwiZmlsZU5hbWUiLCJiYXNlbmFtZSIsIm5vdGlmaWNhdGlvbiIsInRpdGxlIiwiYm9keSIsInNpbGVudCIsIm9uIiwic2hlbGwiLCJzaG93SXRlbUluRm9sZGVyIiwic2hvdyIsInNob3dCYXRjaENvbnZlcnNpb25Db21wbGV0ZSIsImNvdW50Iiwib3V0cHV0RGlyIiwib3BlblBhdGgiLCJzaG93Q29udmVyc2lvbkVycm9yIiwiZXJyb3IiLCJtZXNzYWdlIiwic2hvd0FwaUtleUVycm9yIiwicHJvdmlkZXIiLCJzaG93TmV0d29ya1N0YXR1c0NoYW5nZSIsImlzT25saW5lIiwic2hvd0ZpbGVXYXRjaEV2ZW50IiwiZXZlbnQiLCJzaG93VXBkYXRlQXZhaWxhYmxlIiwidmVyc2lvbiIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vZmVhdHVyZXMvbm90aWZpY2F0aW9ucy5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogTmF0aXZlIE5vdGlmaWNhdGlvbnMgSW50ZWdyYXRpb24gZm9yIHRoZSBFbGVjdHJvbiBhcHBsaWNhdGlvbi5cclxuICogUHJvdmlkZXMgY3Jvc3MtcGxhdGZvcm0gbm90aWZpY2F0aW9uIGZ1bmN0aW9uYWxpdHkgZm9yIGNvbnZlcnNpb24gZXZlbnRzIGFuZCBlcnJvcnMuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIG1haW4uanM6IE1haW4gcHJvY2VzcyBlbnRyeSBwb2ludFxyXG4gKiAtIGlwYy9oYW5kbGVycy9jb252ZXJzaW9uL2luZGV4LmpzOiBDb252ZXJzaW9uIGV2ZW50IGhhbmRsZXJzXHJcbiAqL1xyXG5cclxuY29uc3QgeyBOb3RpZmljYXRpb24sIGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuXHJcbi8qKlxyXG4gKiBNYW5hZ2VzIG5hdGl2ZSBub3RpZmljYXRpb25zIGZvciB0aGUgYXBwbGljYXRpb25cclxuICovXHJcbmNsYXNzIE5vdGlmaWNhdGlvbk1hbmFnZXIge1xyXG4gIC8qKlxyXG4gICAqIENyZWF0ZXMgYSBuZXcgTm90aWZpY2F0aW9uTWFuYWdlciBpbnN0YW5jZVxyXG4gICAqL1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgLy8gU2V0IHVwIHBsYXRmb3JtLXNwZWNpZmljIG5vdGlmaWNhdGlvbiBzZXR0aW5nc1xyXG4gICAgdGhpcy5zZXR1cFBsYXRmb3JtU3BlY2lmaWMoKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNldHMgdXAgcGxhdGZvcm0tc3BlY2lmaWMgbm90aWZpY2F0aW9uIHNldHRpbmdzXHJcbiAgICovXHJcbiAgc2V0dXBQbGF0Zm9ybVNwZWNpZmljKCkge1xyXG4gICAgLy8gT24gV2luZG93cywgc2V0IHRoZSBhcHAgdXNlciBtb2RlbCBJRCBmb3Igbm90aWZpY2F0aW9ucyB0byB3b3JrXHJcbiAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xyXG4gICAgICBhcHAuc2V0QXBwVXNlck1vZGVsSWQocHJvY2Vzcy5leGVjUGF0aCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTaG93cyBhIG5vdGlmaWNhdGlvbiBmb3IgYSBjb21wbGV0ZWQgY29udmVyc2lvblxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gdGhlIGNvbnZlcnRlZCBmaWxlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IG91dHB1dFBhdGggLSBQYXRoIHRvIHRoZSBvdXRwdXQgZmlsZVxyXG4gICAqL1xyXG4gIHNob3dDb252ZXJzaW9uQ29tcGxldGUoZmlsZVBhdGgsIG91dHB1dFBhdGgpIHtcclxuICAgIGNvbnN0IGZpbGVOYW1lID0gcGF0aC5iYXNlbmFtZShmaWxlUGF0aCk7XHJcbiAgICBcclxuICAgIGNvbnN0IG5vdGlmaWNhdGlvbiA9IG5ldyBOb3RpZmljYXRpb24oe1xyXG4gICAgICB0aXRsZTogJ0NvbnZlcnNpb24gQ29tcGxldGUnLFxyXG4gICAgICBib2R5OiBgU3VjY2Vzc2Z1bGx5IGNvbnZlcnRlZCAke2ZpbGVOYW1lfWAsXHJcbiAgICAgIC8vIFRPRE86IFJlcGxhY2Ugd2l0aCBhY3R1YWwgc3VjY2VzcyBpY29uXHJcbiAgICAgIC8vIGljb246IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9hc3NldHMvc3VjY2Vzcy1pY29uLnBuZycpLFxyXG4gICAgICBzaWxlbnQ6IGZhbHNlXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gSGFuZGxlIG5vdGlmaWNhdGlvbiBjbGljayAtIG9wZW4gdGhlIG91dHB1dCBmaWxlXHJcbiAgICBub3RpZmljYXRpb24ub24oJ2NsaWNrJywgKCkgPT4ge1xyXG4gICAgICBpZiAob3V0cHV0UGF0aCkge1xyXG4gICAgICAgIGNvbnN0IHsgc2hlbGwgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbiAgICAgICAgc2hlbGwuc2hvd0l0ZW1JbkZvbGRlcihvdXRwdXRQYXRoKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIG5vdGlmaWNhdGlvbi5zaG93KCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTaG93cyBhIG5vdGlmaWNhdGlvbiBmb3IgYSBiYXRjaCBjb252ZXJzaW9uIGNvbXBsZXRpb25cclxuICAgKiBAcGFyYW0ge251bWJlcn0gY291bnQgLSBOdW1iZXIgb2YgZmlsZXMgY29udmVydGVkXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IG91dHB1dERpciAtIFBhdGggdG8gdGhlIG91dHB1dCBkaXJlY3RvcnlcclxuICAgKi9cclxuICBzaG93QmF0Y2hDb252ZXJzaW9uQ29tcGxldGUoY291bnQsIG91dHB1dERpcikge1xyXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uID0gbmV3IE5vdGlmaWNhdGlvbih7XHJcbiAgICAgIHRpdGxlOiAnQmF0Y2ggQ29udmVyc2lvbiBDb21wbGV0ZScsXHJcbiAgICAgIGJvZHk6IGBTdWNjZXNzZnVsbHkgY29udmVydGVkICR7Y291bnR9IGZpbGVzYCxcclxuICAgICAgLy8gVE9ETzogUmVwbGFjZSB3aXRoIGFjdHVhbCBzdWNjZXNzIGljb25cclxuICAgICAgLy8gaWNvbjogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Fzc2V0cy9zdWNjZXNzLWljb24ucG5nJyksXHJcbiAgICAgIHNpbGVudDogZmFsc2VcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBIYW5kbGUgbm90aWZpY2F0aW9uIGNsaWNrIC0gb3BlbiB0aGUgb3V0cHV0IGRpcmVjdG9yeVxyXG4gICAgbm90aWZpY2F0aW9uLm9uKCdjbGljaycsICgpID0+IHtcclxuICAgICAgaWYgKG91dHB1dERpcikge1xyXG4gICAgICAgIGNvbnN0IHsgc2hlbGwgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbiAgICAgICAgc2hlbGwub3BlblBhdGgob3V0cHV0RGlyKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIG5vdGlmaWNhdGlvbi5zaG93KCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTaG93cyBhIG5vdGlmaWNhdGlvbiBmb3IgYSBjb252ZXJzaW9uIGVycm9yXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgZmlsZSB0aGF0IGZhaWxlZCBjb252ZXJzaW9uXHJcbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBUaGUgZXJyb3IgdGhhdCBvY2N1cnJlZFxyXG4gICAqL1xyXG4gIHNob3dDb252ZXJzaW9uRXJyb3IoZmlsZVBhdGgsIGVycm9yKSB7XHJcbiAgICBjb25zdCBmaWxlTmFtZSA9IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpO1xyXG4gICAgXHJcbiAgICBjb25zdCBub3RpZmljYXRpb24gPSBuZXcgTm90aWZpY2F0aW9uKHtcclxuICAgICAgdGl0bGU6ICdDb252ZXJzaW9uIEVycm9yJyxcclxuICAgICAgYm9keTogYEVycm9yIGNvbnZlcnRpbmcgJHtmaWxlTmFtZX06ICR7ZXJyb3IubWVzc2FnZX1gLFxyXG4gICAgICAvLyBUT0RPOiBSZXBsYWNlIHdpdGggYWN0dWFsIGVycm9yIGljb25cclxuICAgICAgLy8gaWNvbjogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Fzc2V0cy9lcnJvci1pY29uLnBuZycpLFxyXG4gICAgICBzaWxlbnQ6IGZhbHNlXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbm90aWZpY2F0aW9uLnNob3coKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNob3dzIGEgbm90aWZpY2F0aW9uIGZvciBhbiBBUEkga2V5IGVycm9yXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3ZpZGVyIC0gVGhlIEFQSSBwcm92aWRlciAoZS5nLiwgJ09wZW5BSScpXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBUaGUgZXJyb3IgbWVzc2FnZVxyXG4gICAqL1xyXG4gIHNob3dBcGlLZXlFcnJvcihwcm92aWRlciwgbWVzc2FnZSkge1xyXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uID0gbmV3IE5vdGlmaWNhdGlvbih7XHJcbiAgICAgIHRpdGxlOiBgJHtwcm92aWRlcn0gQVBJIEtleSBFcnJvcmAsXHJcbiAgICAgIGJvZHk6IG1lc3NhZ2UsXHJcbiAgICAgIC8vIFRPRE86IFJlcGxhY2Ugd2l0aCBhY3R1YWwgZXJyb3IgaWNvblxyXG4gICAgICAvLyBpY29uOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vYXNzZXRzL2Vycm9yLWljb24ucG5nJyksXHJcbiAgICAgIHNpbGVudDogZmFsc2VcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBub3RpZmljYXRpb24uc2hvdygpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2hvd3MgYSBub3RpZmljYXRpb24gZm9yIGEgbmV0d29yayBzdGF0dXMgY2hhbmdlXHJcbiAgICogQHBhcmFtIHtib29sZWFufSBpc09ubGluZSAtIFdoZXRoZXIgdGhlIGFwcCBpcyBvbmxpbmVcclxuICAgKi9cclxuICBzaG93TmV0d29ya1N0YXR1c0NoYW5nZShpc09ubGluZSkge1xyXG4gICAgaWYgKGlzT25saW5lKSB7XHJcbiAgICAgIGNvbnN0IG5vdGlmaWNhdGlvbiA9IG5ldyBOb3RpZmljYXRpb24oe1xyXG4gICAgICAgIHRpdGxlOiAnTmV0d29yayBDb25uZWN0aW9uIFJlc3RvcmVkJyxcclxuICAgICAgICBib2R5OiAnWW91IGFyZSBub3cgb25saW5lLiBRdWV1ZWQgb3BlcmF0aW9ucyB3aWxsIHJlc3VtZS4nLFxyXG4gICAgICAgIC8vIFRPRE86IFJlcGxhY2Ugd2l0aCBhY3R1YWwgb25saW5lIGljb25cclxuICAgICAgICAvLyBpY29uOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vYXNzZXRzL29ubGluZS1pY29uLnBuZycpLFxyXG4gICAgICAgIHNpbGVudDogdHJ1ZVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIG5vdGlmaWNhdGlvbi5zaG93KCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBjb25zdCBub3RpZmljYXRpb24gPSBuZXcgTm90aWZpY2F0aW9uKHtcclxuICAgICAgICB0aXRsZTogJ05ldHdvcmsgQ29ubmVjdGlvbiBMb3N0JyxcclxuICAgICAgICBib2R5OiAnWW91IGFyZSBub3cgb2ZmbGluZS4gT3BlcmF0aW9ucyB3aWxsIGJlIHF1ZXVlZC4nLFxyXG4gICAgICAgIC8vIFRPRE86IFJlcGxhY2Ugd2l0aCBhY3R1YWwgb2ZmbGluZSBpY29uXHJcbiAgICAgICAgLy8gaWNvbjogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Fzc2V0cy9vZmZsaW5lLWljb24ucG5nJyksXHJcbiAgICAgICAgc2lsZW50OiB0cnVlXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgbm90aWZpY2F0aW9uLnNob3coKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNob3dzIGEgbm90aWZpY2F0aW9uIGZvciBhIGZpbGUgd2F0Y2ggZXZlbnRcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIHRoZSBmaWxlIHRoYXQgY2hhbmdlZFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBldmVudCAtIFRoZSBldmVudCB0eXBlIChlLmcuLCAnY2hhbmdlZCcsICdhZGRlZCcsICdyZW1vdmVkJylcclxuICAgKi9cclxuICBzaG93RmlsZVdhdGNoRXZlbnQoZmlsZVBhdGgsIGV2ZW50KSB7XHJcbiAgICBjb25zdCBmaWxlTmFtZSA9IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpO1xyXG4gICAgXHJcbiAgICBjb25zdCBub3RpZmljYXRpb24gPSBuZXcgTm90aWZpY2F0aW9uKHtcclxuICAgICAgdGl0bGU6ICdGaWxlIENoYW5nZSBEZXRlY3RlZCcsXHJcbiAgICAgIGJvZHk6IGAke2ZpbGVOYW1lfSB3YXMgJHtldmVudH1gLFxyXG4gICAgICAvLyBUT0RPOiBSZXBsYWNlIHdpdGggYWN0dWFsIGZpbGUgaWNvblxyXG4gICAgICAvLyBpY29uOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vYXNzZXRzL2ZpbGUtaWNvbi5wbmcnKSxcclxuICAgICAgc2lsZW50OiB0cnVlXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbm90aWZpY2F0aW9uLnNob3coKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNob3dzIGEgbm90aWZpY2F0aW9uIGZvciBhbiB1cGRhdGUgYXZhaWxhYmxlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHZlcnNpb24gLSBUaGUgbmV3IHZlcnNpb24gYXZhaWxhYmxlXHJcbiAgICovXHJcbiAgc2hvd1VwZGF0ZUF2YWlsYWJsZSh2ZXJzaW9uKSB7XHJcbiAgICBjb25zdCBub3RpZmljYXRpb24gPSBuZXcgTm90aWZpY2F0aW9uKHtcclxuICAgICAgdGl0bGU6ICdVcGRhdGUgQXZhaWxhYmxlJyxcclxuICAgICAgYm9keTogYFZlcnNpb24gJHt2ZXJzaW9ufSBpcyBhdmFpbGFibGUuIENsaWNrIHRvIHVwZGF0ZS5gLFxyXG4gICAgICAvLyBUT0RPOiBSZXBsYWNlIHdpdGggYWN0dWFsIHVwZGF0ZSBpY29uXHJcbiAgICAgIC8vIGljb246IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9hc3NldHMvdXBkYXRlLWljb24ucG5nJyksXHJcbiAgICAgIHNpbGVudDogZmFsc2VcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBIYW5kbGUgbm90aWZpY2F0aW9uIGNsaWNrIC0gdHJpZ2dlciB1cGRhdGVcclxuICAgIG5vdGlmaWNhdGlvbi5vbignY2xpY2snLCAoKSA9PiB7XHJcbiAgICAgIC8vIFRoaXMgd2lsbCBiZSBpbXBsZW1lbnRlZCB3aGVuIHdlIGFkZCBhdXRvLXVwZGF0ZXNcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBub3RpZmljYXRpb24uc2hvdygpO1xyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBOb3RpZmljYXRpb25NYW5hZ2VyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNO0VBQUVBLFlBQVk7RUFBRUM7QUFBSSxDQUFDLEdBQUdDLE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDakQsTUFBTUMsSUFBSSxHQUFHRCxPQUFPLENBQUMsTUFBTSxDQUFDOztBQUU1QjtBQUNBO0FBQ0E7QUFDQSxNQUFNRSxtQkFBbUIsQ0FBQztFQUN4QjtBQUNGO0FBQ0E7RUFDRUMsV0FBV0EsQ0FBQSxFQUFHO0lBQ1o7SUFDQSxJQUFJ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