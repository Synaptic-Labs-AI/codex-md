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
   * @param {string} provider - The API provider (e.g., 'Mistral', 'Deepgram')
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJOb3RpZmljYXRpb24iLCJhcHAiLCJyZXF1aXJlIiwicGF0aCIsIk5vdGlmaWNhdGlvbk1hbmFnZXIiLCJjb25zdHJ1Y3RvciIsInNldHVwUGxhdGZvcm1TcGVjaWZpYyIsInByb2Nlc3MiLCJwbGF0Zm9ybSIsInNldEFwcFVzZXJNb2RlbElkIiwiZXhlY1BhdGgiLCJzaG93Q29udmVyc2lvbkNvbXBsZXRlIiwiZmlsZVBhdGgiLCJvdXRwdXRQYXRoIiwiZmlsZU5hbWUiLCJiYXNlbmFtZSIsIm5vdGlmaWNhdGlvbiIsInRpdGxlIiwiYm9keSIsInNpbGVudCIsIm9uIiwic2hlbGwiLCJzaG93SXRlbUluRm9sZGVyIiwic2hvdyIsInNob3dDb252ZXJzaW9uRXJyb3IiLCJlcnJvciIsIm1lc3NhZ2UiLCJzaG93QXBpS2V5RXJyb3IiLCJwcm92aWRlciIsInNob3dOZXR3b3JrU3RhdHVzQ2hhbmdlIiwiaXNPbmxpbmUiLCJzaG93RmlsZVdhdGNoRXZlbnQiLCJldmVudCIsInNob3dVcGRhdGVBdmFpbGFibGUiLCJ2ZXJzaW9uIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbGVjdHJvbi9mZWF0dXJlcy9ub3RpZmljYXRpb25zLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBOYXRpdmUgTm90aWZpY2F0aW9ucyBJbnRlZ3JhdGlvbiBmb3IgdGhlIEVsZWN0cm9uIGFwcGxpY2F0aW9uLlxyXG4gKiBQcm92aWRlcyBjcm9zcy1wbGF0Zm9ybSBub3RpZmljYXRpb24gZnVuY3Rpb25hbGl0eSBmb3IgY29udmVyc2lvbiBldmVudHMgYW5kIGVycm9ycy5cclxuICogXHJcbiAqIFJlbGF0ZWQgZmlsZXM6XHJcbiAqIC0gbWFpbi5qczogTWFpbiBwcm9jZXNzIGVudHJ5IHBvaW50XHJcbiAqIC0gaXBjL2hhbmRsZXJzL2NvbnZlcnNpb24vaW5kZXguanM6IENvbnZlcnNpb24gZXZlbnQgaGFuZGxlcnNcclxuICovXHJcblxyXG5jb25zdCB7IE5vdGlmaWNhdGlvbiwgYXBwIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5cclxuLyoqXHJcbiAqIE1hbmFnZXMgbmF0aXZlIG5vdGlmaWNhdGlvbnMgZm9yIHRoZSBhcHBsaWNhdGlvblxyXG4gKi9cclxuY2xhc3MgTm90aWZpY2F0aW9uTWFuYWdlciB7XHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlcyBhIG5ldyBOb3RpZmljYXRpb25NYW5hZ2VyIGluc3RhbmNlXHJcbiAgICovXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICAvLyBTZXQgdXAgcGxhdGZvcm0tc3BlY2lmaWMgbm90aWZpY2F0aW9uIHNldHRpbmdzXHJcbiAgICB0aGlzLnNldHVwUGxhdGZvcm1TcGVjaWZpYygpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2V0cyB1cCBwbGF0Zm9ybS1zcGVjaWZpYyBub3RpZmljYXRpb24gc2V0dGluZ3NcclxuICAgKi9cclxuICBzZXR1cFBsYXRmb3JtU3BlY2lmaWMoKSB7XHJcbiAgICAvLyBPbiBXaW5kb3dzLCBzZXQgdGhlIGFwcCB1c2VyIG1vZGVsIElEIGZvciBub3RpZmljYXRpb25zIHRvIHdvcmtcclxuICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XHJcbiAgICAgIGFwcC5zZXRBcHBVc2VyTW9kZWxJZChwcm9jZXNzLmV4ZWNQYXRoKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNob3dzIGEgbm90aWZpY2F0aW9uIGZvciBhIGNvbXBsZXRlZCBjb252ZXJzaW9uXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgY29udmVydGVkIGZpbGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3V0cHV0UGF0aCAtIFBhdGggdG8gdGhlIG91dHB1dCBmaWxlXHJcbiAgICovXHJcbiAgc2hvd0NvbnZlcnNpb25Db21wbGV0ZShmaWxlUGF0aCwgb3V0cHV0UGF0aCkge1xyXG4gICAgY29uc3QgZmlsZU5hbWUgPSBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKTtcclxuICAgIFxyXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uID0gbmV3IE5vdGlmaWNhdGlvbih7XHJcbiAgICAgIHRpdGxlOiAnQ29udmVyc2lvbiBDb21wbGV0ZScsXHJcbiAgICAgIGJvZHk6IGBTdWNjZXNzZnVsbHkgY29udmVydGVkICR7ZmlsZU5hbWV9YCxcclxuICAgICAgLy8gVE9ETzogUmVwbGFjZSB3aXRoIGFjdHVhbCBzdWNjZXNzIGljb25cclxuICAgICAgLy8gaWNvbjogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Fzc2V0cy9zdWNjZXNzLWljb24ucG5nJyksXHJcbiAgICAgIHNpbGVudDogZmFsc2VcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBIYW5kbGUgbm90aWZpY2F0aW9uIGNsaWNrIC0gb3BlbiB0aGUgb3V0cHV0IGZpbGVcclxuICAgIG5vdGlmaWNhdGlvbi5vbignY2xpY2snLCAoKSA9PiB7XHJcbiAgICAgIGlmIChvdXRwdXRQYXRoKSB7XHJcbiAgICAgICAgY29uc3QgeyBzaGVsbCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuICAgICAgICBzaGVsbC5zaG93SXRlbUluRm9sZGVyKG91dHB1dFBhdGgpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbm90aWZpY2F0aW9uLnNob3coKTtcclxuICB9XHJcblxyXG5cclxuICAvKipcclxuICAgKiBTaG93cyBhIG5vdGlmaWNhdGlvbiBmb3IgYSBjb252ZXJzaW9uIGVycm9yXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgZmlsZSB0aGF0IGZhaWxlZCBjb252ZXJzaW9uXHJcbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBUaGUgZXJyb3IgdGhhdCBvY2N1cnJlZFxyXG4gICAqL1xyXG4gIHNob3dDb252ZXJzaW9uRXJyb3IoZmlsZVBhdGgsIGVycm9yKSB7XHJcbiAgICBjb25zdCBmaWxlTmFtZSA9IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpO1xyXG4gICAgXHJcbiAgICBjb25zdCBub3RpZmljYXRpb24gPSBuZXcgTm90aWZpY2F0aW9uKHtcclxuICAgICAgdGl0bGU6ICdDb252ZXJzaW9uIEVycm9yJyxcclxuICAgICAgYm9keTogYEVycm9yIGNvbnZlcnRpbmcgJHtmaWxlTmFtZX06ICR7ZXJyb3IubWVzc2FnZX1gLFxyXG4gICAgICAvLyBUT0RPOiBSZXBsYWNlIHdpdGggYWN0dWFsIGVycm9yIGljb25cclxuICAgICAgLy8gaWNvbjogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Fzc2V0cy9lcnJvci1pY29uLnBuZycpLFxyXG4gICAgICBzaWxlbnQ6IGZhbHNlXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbm90aWZpY2F0aW9uLnNob3coKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNob3dzIGEgbm90aWZpY2F0aW9uIGZvciBhbiBBUEkga2V5IGVycm9yXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3ZpZGVyIC0gVGhlIEFQSSBwcm92aWRlciAoZS5nLiwgJ01pc3RyYWwnLCAnRGVlcGdyYW0nKVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gVGhlIGVycm9yIG1lc3NhZ2VcclxuICAgKi9cclxuICBzaG93QXBpS2V5RXJyb3IocHJvdmlkZXIsIG1lc3NhZ2UpIHtcclxuICAgIGNvbnN0IG5vdGlmaWNhdGlvbiA9IG5ldyBOb3RpZmljYXRpb24oe1xyXG4gICAgICB0aXRsZTogYCR7cHJvdmlkZXJ9IEFQSSBLZXkgRXJyb3JgLFxyXG4gICAgICBib2R5OiBtZXNzYWdlLFxyXG4gICAgICAvLyBUT0RPOiBSZXBsYWNlIHdpdGggYWN0dWFsIGVycm9yIGljb25cclxuICAgICAgLy8gaWNvbjogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Fzc2V0cy9lcnJvci1pY29uLnBuZycpLFxyXG4gICAgICBzaWxlbnQ6IGZhbHNlXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbm90aWZpY2F0aW9uLnNob3coKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNob3dzIGEgbm90aWZpY2F0aW9uIGZvciBhIG5ldHdvcmsgc3RhdHVzIGNoYW5nZVxyXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gaXNPbmxpbmUgLSBXaGV0aGVyIHRoZSBhcHAgaXMgb25saW5lXHJcbiAgICovXHJcbiAgc2hvd05ldHdvcmtTdGF0dXNDaGFuZ2UoaXNPbmxpbmUpIHtcclxuICAgIGlmIChpc09ubGluZSkge1xyXG4gICAgICBjb25zdCBub3RpZmljYXRpb24gPSBuZXcgTm90aWZpY2F0aW9uKHtcclxuICAgICAgICB0aXRsZTogJ05ldHdvcmsgQ29ubmVjdGlvbiBSZXN0b3JlZCcsXHJcbiAgICAgICAgYm9keTogJ1lvdSBhcmUgbm93IG9ubGluZS4gUXVldWVkIG9wZXJhdGlvbnMgd2lsbCByZXN1bWUuJyxcclxuICAgICAgICAvLyBUT0RPOiBSZXBsYWNlIHdpdGggYWN0dWFsIG9ubGluZSBpY29uXHJcbiAgICAgICAgLy8gaWNvbjogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Fzc2V0cy9vbmxpbmUtaWNvbi5wbmcnKSxcclxuICAgICAgICBzaWxlbnQ6IHRydWVcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBub3RpZmljYXRpb24uc2hvdygpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc3Qgbm90aWZpY2F0aW9uID0gbmV3IE5vdGlmaWNhdGlvbih7XHJcbiAgICAgICAgdGl0bGU6ICdOZXR3b3JrIENvbm5lY3Rpb24gTG9zdCcsXHJcbiAgICAgICAgYm9keTogJ1lvdSBhcmUgbm93IG9mZmxpbmUuIE9wZXJhdGlvbnMgd2lsbCBiZSBxdWV1ZWQuJyxcclxuICAgICAgICAvLyBUT0RPOiBSZXBsYWNlIHdpdGggYWN0dWFsIG9mZmxpbmUgaWNvblxyXG4gICAgICAgIC8vIGljb246IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9hc3NldHMvb2ZmbGluZS1pY29uLnBuZycpLFxyXG4gICAgICAgIHNpbGVudDogdHJ1ZVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIG5vdGlmaWNhdGlvbi5zaG93KCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTaG93cyBhIG5vdGlmaWNhdGlvbiBmb3IgYSBmaWxlIHdhdGNoIGV2ZW50XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgZmlsZSB0aGF0IGNoYW5nZWRcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXZlbnQgLSBUaGUgZXZlbnQgdHlwZSAoZS5nLiwgJ2NoYW5nZWQnLCAnYWRkZWQnLCAncmVtb3ZlZCcpXHJcbiAgICovXHJcbiAgc2hvd0ZpbGVXYXRjaEV2ZW50KGZpbGVQYXRoLCBldmVudCkge1xyXG4gICAgY29uc3QgZmlsZU5hbWUgPSBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKTtcclxuICAgIFxyXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uID0gbmV3IE5vdGlmaWNhdGlvbih7XHJcbiAgICAgIHRpdGxlOiAnRmlsZSBDaGFuZ2UgRGV0ZWN0ZWQnLFxyXG4gICAgICBib2R5OiBgJHtmaWxlTmFtZX0gd2FzICR7ZXZlbnR9YCxcclxuICAgICAgLy8gVE9ETzogUmVwbGFjZSB3aXRoIGFjdHVhbCBmaWxlIGljb25cclxuICAgICAgLy8gaWNvbjogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Fzc2V0cy9maWxlLWljb24ucG5nJyksXHJcbiAgICAgIHNpbGVudDogdHJ1ZVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIG5vdGlmaWNhdGlvbi5zaG93KCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTaG93cyBhIG5vdGlmaWNhdGlvbiBmb3IgYW4gdXBkYXRlIGF2YWlsYWJsZVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2ZXJzaW9uIC0gVGhlIG5ldyB2ZXJzaW9uIGF2YWlsYWJsZVxyXG4gICAqL1xyXG4gIHNob3dVcGRhdGVBdmFpbGFibGUodmVyc2lvbikge1xyXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uID0gbmV3IE5vdGlmaWNhdGlvbih7XHJcbiAgICAgIHRpdGxlOiAnVXBkYXRlIEF2YWlsYWJsZScsXHJcbiAgICAgIGJvZHk6IGBWZXJzaW9uICR7dmVyc2lvbn0gaXMgYXZhaWxhYmxlLiBDbGljayB0byB1cGRhdGUuYCxcclxuICAgICAgLy8gVE9ETzogUmVwbGFjZSB3aXRoIGFjdHVhbCB1cGRhdGUgaWNvblxyXG4gICAgICAvLyBpY29uOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vYXNzZXRzL3VwZGF0ZS1pY29uLnBuZycpLFxyXG4gICAgICBzaWxlbnQ6IGZhbHNlXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gSGFuZGxlIG5vdGlmaWNhdGlvbiBjbGljayAtIHRyaWdnZXIgdXBkYXRlXHJcbiAgICBub3RpZmljYXRpb24ub24oJ2NsaWNrJywgKCkgPT4ge1xyXG4gICAgICAvLyBUaGlzIHdpbGwgYmUgaW1wbGVtZW50ZWQgd2hlbiB3ZSBhZGQgYXV0by11cGRhdGVzXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbm90aWZpY2F0aW9uLnNob3coKTtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTm90aWZpY2F0aW9uTWFuYWdlcjtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTTtFQUFFQSxZQUFZO0VBQUVDO0FBQUksQ0FBQyxHQUFHQyxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ2pELE1BQU1DLElBQUksR0FBR0QsT0FBTyxDQUFDLE1BQU0sQ0FBQzs7QUFFNUI7QUFDQTtBQUNBO0FBQ0EsTUFBTUUsbUJBQW1CLENBQUM7RUFDeEI7QUFDRjtBQUNBO0VBQ0VDLFdBQVdBLENBQUEsRUFBRztJQUNaO0lBQ0EsSUFB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