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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJOb3RpZmljYXRpb24iLCJhcHAiLCJyZXF1aXJlIiwicGF0aCIsIk5vdGlmaWNhdGlvbk1hbmFnZXIiLCJjb25zdHJ1Y3RvciIsInNldHVwUGxhdGZvcm1TcGVjaWZpYyIsInByb2Nlc3MiLCJwbGF0Zm9ybSIsInNldEFwcFVzZXJNb2RlbElkIiwiZXhlY1BhdGgiLCJzaG93Q29udmVyc2lvbkNvbXBsZXRlIiwiZmlsZVBhdGgiLCJvdXRwdXRQYXRoIiwiZmlsZU5hbWUiLCJiYXNlbmFtZSIsIm5vdGlmaWNhdGlvbiIsInRpdGxlIiwiYm9keSIsInNpbGVudCIsIm9uIiwic2hlbGwiLCJzaG93SXRlbUluRm9sZGVyIiwic2hvdyIsInNob3dDb252ZXJzaW9uRXJyb3IiLCJlcnJvciIsIm1lc3NhZ2UiLCJzaG93QXBpS2V5RXJyb3IiLCJwcm92aWRlciIsInNob3dOZXR3b3JrU3RhdHVzQ2hhbmdlIiwiaXNPbmxpbmUiLCJzaG93RmlsZVdhdGNoRXZlbnQiLCJldmVudCIsInNob3dVcGRhdGVBdmFpbGFibGUiLCJ2ZXJzaW9uIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbGVjdHJvbi9mZWF0dXJlcy9ub3RpZmljYXRpb25zLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBOYXRpdmUgTm90aWZpY2F0aW9ucyBJbnRlZ3JhdGlvbiBmb3IgdGhlIEVsZWN0cm9uIGFwcGxpY2F0aW9uLlxyXG4gKiBQcm92aWRlcyBjcm9zcy1wbGF0Zm9ybSBub3RpZmljYXRpb24gZnVuY3Rpb25hbGl0eSBmb3IgY29udmVyc2lvbiBldmVudHMgYW5kIGVycm9ycy5cclxuICogXHJcbiAqIFJlbGF0ZWQgZmlsZXM6XHJcbiAqIC0gbWFpbi5qczogTWFpbiBwcm9jZXNzIGVudHJ5IHBvaW50XHJcbiAqIC0gaXBjL2hhbmRsZXJzL2NvbnZlcnNpb24vaW5kZXguanM6IENvbnZlcnNpb24gZXZlbnQgaGFuZGxlcnNcclxuICovXHJcblxyXG5jb25zdCB7IE5vdGlmaWNhdGlvbiwgYXBwIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5cclxuLyoqXHJcbiAqIE1hbmFnZXMgbmF0aXZlIG5vdGlmaWNhdGlvbnMgZm9yIHRoZSBhcHBsaWNhdGlvblxyXG4gKi9cclxuY2xhc3MgTm90aWZpY2F0aW9uTWFuYWdlciB7XHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlcyBhIG5ldyBOb3RpZmljYXRpb25NYW5hZ2VyIGluc3RhbmNlXHJcbiAgICovXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICAvLyBTZXQgdXAgcGxhdGZvcm0tc3BlY2lmaWMgbm90aWZpY2F0aW9uIHNldHRpbmdzXHJcbiAgICB0aGlzLnNldHVwUGxhdGZvcm1TcGVjaWZpYygpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2V0cyB1cCBwbGF0Zm9ybS1zcGVjaWZpYyBub3RpZmljYXRpb24gc2V0dGluZ3NcclxuICAgKi9cclxuICBzZXR1cFBsYXRmb3JtU3BlY2lmaWMoKSB7XHJcbiAgICAvLyBPbiBXaW5kb3dzLCBzZXQgdGhlIGFwcCB1c2VyIG1vZGVsIElEIGZvciBub3RpZmljYXRpb25zIHRvIHdvcmtcclxuICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XHJcbiAgICAgIGFwcC5zZXRBcHBVc2VyTW9kZWxJZChwcm9jZXNzLmV4ZWNQYXRoKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNob3dzIGEgbm90aWZpY2F0aW9uIGZvciBhIGNvbXBsZXRlZCBjb252ZXJzaW9uXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgY29udmVydGVkIGZpbGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3V0cHV0UGF0aCAtIFBhdGggdG8gdGhlIG91dHB1dCBmaWxlXHJcbiAgICovXHJcbiAgc2hvd0NvbnZlcnNpb25Db21wbGV0ZShmaWxlUGF0aCwgb3V0cHV0UGF0aCkge1xyXG4gICAgY29uc3QgZmlsZU5hbWUgPSBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKTtcclxuICAgIFxyXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uID0gbmV3IE5vdGlmaWNhdGlvbih7XHJcbiAgICAgIHRpdGxlOiAnQ29udmVyc2lvbiBDb21wbGV0ZScsXHJcbiAgICAgIGJvZHk6IGBTdWNjZXNzZnVsbHkgY29udmVydGVkICR7ZmlsZU5hbWV9YCxcclxuICAgICAgLy8gVE9ETzogUmVwbGFjZSB3aXRoIGFjdHVhbCBzdWNjZXNzIGljb25cclxuICAgICAgLy8gaWNvbjogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Fzc2V0cy9zdWNjZXNzLWljb24ucG5nJyksXHJcbiAgICAgIHNpbGVudDogZmFsc2VcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBIYW5kbGUgbm90aWZpY2F0aW9uIGNsaWNrIC0gb3BlbiB0aGUgb3V0cHV0IGZpbGVcclxuICAgIG5vdGlmaWNhdGlvbi5vbignY2xpY2snLCAoKSA9PiB7XHJcbiAgICAgIGlmIChvdXRwdXRQYXRoKSB7XHJcbiAgICAgICAgY29uc3QgeyBzaGVsbCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuICAgICAgICBzaGVsbC5zaG93SXRlbUluRm9sZGVyKG91dHB1dFBhdGgpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbm90aWZpY2F0aW9uLnNob3coKTtcclxuICB9XHJcblxyXG5cclxuICAvKipcclxuICAgKiBTaG93cyBhIG5vdGlmaWNhdGlvbiBmb3IgYSBjb252ZXJzaW9uIGVycm9yXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgZmlsZSB0aGF0IGZhaWxlZCBjb252ZXJzaW9uXHJcbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBUaGUgZXJyb3IgdGhhdCBvY2N1cnJlZFxyXG4gICAqL1xyXG4gIHNob3dDb252ZXJzaW9uRXJyb3IoZmlsZVBhdGgsIGVycm9yKSB7XHJcbiAgICBjb25zdCBmaWxlTmFtZSA9IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpO1xyXG4gICAgXHJcbiAgICBjb25zdCBub3RpZmljYXRpb24gPSBuZXcgTm90aWZpY2F0aW9uKHtcclxuICAgICAgdGl0bGU6ICdDb252ZXJzaW9uIEVycm9yJyxcclxuICAgICAgYm9keTogYEVycm9yIGNvbnZlcnRpbmcgJHtmaWxlTmFtZX06ICR7ZXJyb3IubWVzc2FnZX1gLFxyXG4gICAgICAvLyBUT0RPOiBSZXBsYWNlIHdpdGggYWN0dWFsIGVycm9yIGljb25cclxuICAgICAgLy8gaWNvbjogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Fzc2V0cy9lcnJvci1pY29uLnBuZycpLFxyXG4gICAgICBzaWxlbnQ6IGZhbHNlXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbm90aWZpY2F0aW9uLnNob3coKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNob3dzIGEgbm90aWZpY2F0aW9uIGZvciBhbiBBUEkga2V5IGVycm9yXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3ZpZGVyIC0gVGhlIEFQSSBwcm92aWRlciAoZS5nLiwgJ09wZW5BSScpXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBUaGUgZXJyb3IgbWVzc2FnZVxyXG4gICAqL1xyXG4gIHNob3dBcGlLZXlFcnJvcihwcm92aWRlciwgbWVzc2FnZSkge1xyXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uID0gbmV3IE5vdGlmaWNhdGlvbih7XHJcbiAgICAgIHRpdGxlOiBgJHtwcm92aWRlcn0gQVBJIEtleSBFcnJvcmAsXHJcbiAgICAgIGJvZHk6IG1lc3NhZ2UsXHJcbiAgICAgIC8vIFRPRE86IFJlcGxhY2Ugd2l0aCBhY3R1YWwgZXJyb3IgaWNvblxyXG4gICAgICAvLyBpY29uOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vYXNzZXRzL2Vycm9yLWljb24ucG5nJyksXHJcbiAgICAgIHNpbGVudDogZmFsc2VcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBub3RpZmljYXRpb24uc2hvdygpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2hvd3MgYSBub3RpZmljYXRpb24gZm9yIGEgbmV0d29yayBzdGF0dXMgY2hhbmdlXHJcbiAgICogQHBhcmFtIHtib29sZWFufSBpc09ubGluZSAtIFdoZXRoZXIgdGhlIGFwcCBpcyBvbmxpbmVcclxuICAgKi9cclxuICBzaG93TmV0d29ya1N0YXR1c0NoYW5nZShpc09ubGluZSkge1xyXG4gICAgaWYgKGlzT25saW5lKSB7XHJcbiAgICAgIGNvbnN0IG5vdGlmaWNhdGlvbiA9IG5ldyBOb3RpZmljYXRpb24oe1xyXG4gICAgICAgIHRpdGxlOiAnTmV0d29yayBDb25uZWN0aW9uIFJlc3RvcmVkJyxcclxuICAgICAgICBib2R5OiAnWW91IGFyZSBub3cgb25saW5lLiBRdWV1ZWQgb3BlcmF0aW9ucyB3aWxsIHJlc3VtZS4nLFxyXG4gICAgICAgIC8vIFRPRE86IFJlcGxhY2Ugd2l0aCBhY3R1YWwgb25saW5lIGljb25cclxuICAgICAgICAvLyBpY29uOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vYXNzZXRzL29ubGluZS1pY29uLnBuZycpLFxyXG4gICAgICAgIHNpbGVudDogdHJ1ZVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIG5vdGlmaWNhdGlvbi5zaG93KCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBjb25zdCBub3RpZmljYXRpb24gPSBuZXcgTm90aWZpY2F0aW9uKHtcclxuICAgICAgICB0aXRsZTogJ05ldHdvcmsgQ29ubmVjdGlvbiBMb3N0JyxcclxuICAgICAgICBib2R5OiAnWW91IGFyZSBub3cgb2ZmbGluZS4gT3BlcmF0aW9ucyB3aWxsIGJlIHF1ZXVlZC4nLFxyXG4gICAgICAgIC8vIFRPRE86IFJlcGxhY2Ugd2l0aCBhY3R1YWwgb2ZmbGluZSBpY29uXHJcbiAgICAgICAgLy8gaWNvbjogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2Fzc2V0cy9vZmZsaW5lLWljb24ucG5nJyksXHJcbiAgICAgICAgc2lsZW50OiB0cnVlXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgbm90aWZpY2F0aW9uLnNob3coKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNob3dzIGEgbm90aWZpY2F0aW9uIGZvciBhIGZpbGUgd2F0Y2ggZXZlbnRcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIHRoZSBmaWxlIHRoYXQgY2hhbmdlZFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBldmVudCAtIFRoZSBldmVudCB0eXBlIChlLmcuLCAnY2hhbmdlZCcsICdhZGRlZCcsICdyZW1vdmVkJylcclxuICAgKi9cclxuICBzaG93RmlsZVdhdGNoRXZlbnQoZmlsZVBhdGgsIGV2ZW50KSB7XHJcbiAgICBjb25zdCBmaWxlTmFtZSA9IHBhdGguYmFzZW5hbWUoZmlsZVBhdGgpO1xyXG4gICAgXHJcbiAgICBjb25zdCBub3RpZmljYXRpb24gPSBuZXcgTm90aWZpY2F0aW9uKHtcclxuICAgICAgdGl0bGU6ICdGaWxlIENoYW5nZSBEZXRlY3RlZCcsXHJcbiAgICAgIGJvZHk6IGAke2ZpbGVOYW1lfSB3YXMgJHtldmVudH1gLFxyXG4gICAgICAvLyBUT0RPOiBSZXBsYWNlIHdpdGggYWN0dWFsIGZpbGUgaWNvblxyXG4gICAgICAvLyBpY29uOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vYXNzZXRzL2ZpbGUtaWNvbi5wbmcnKSxcclxuICAgICAgc2lsZW50OiB0cnVlXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbm90aWZpY2F0aW9uLnNob3coKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNob3dzIGEgbm90aWZpY2F0aW9uIGZvciBhbiB1cGRhdGUgYXZhaWxhYmxlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHZlcnNpb24gLSBUaGUgbmV3IHZlcnNpb24gYXZhaWxhYmxlXHJcbiAgICovXHJcbiAgc2hvd1VwZGF0ZUF2YWlsYWJsZSh2ZXJzaW9uKSB7XHJcbiAgICBjb25zdCBub3RpZmljYXRpb24gPSBuZXcgTm90aWZpY2F0aW9uKHtcclxuICAgICAgdGl0bGU6ICdVcGRhdGUgQXZhaWxhYmxlJyxcclxuICAgICAgYm9keTogYFZlcnNpb24gJHt2ZXJzaW9ufSBpcyBhdmFpbGFibGUuIENsaWNrIHRvIHVwZGF0ZS5gLFxyXG4gICAgICAvLyBUT0RPOiBSZXBsYWNlIHdpdGggYWN0dWFsIHVwZGF0ZSBpY29uXHJcbiAgICAgIC8vIGljb246IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9hc3NldHMvdXBkYXRlLWljb24ucG5nJyksXHJcbiAgICAgIHNpbGVudDogZmFsc2VcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBIYW5kbGUgbm90aWZpY2F0aW9uIGNsaWNrIC0gdHJpZ2dlciB1cGRhdGVcclxuICAgIG5vdGlmaWNhdGlvbi5vbignY2xpY2snLCAoKSA9PiB7XHJcbiAgICAgIC8vIFRoaXMgd2lsbCBiZSBpbXBsZW1lbnRlZCB3aGVuIHdlIGFkZCBhdXRvLXVwZGF0ZXNcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBub3RpZmljYXRpb24uc2hvdygpO1xyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBOb3RpZmljYXRpb25NYW5hZ2VyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNO0VBQUVBLFlBQVk7RUFBRUM7QUFBSSxDQUFDLEdBQUdDLE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDakQsTUFBTUMsSUFBSSxHQUFHRCxPQUFPLENBQUMsTUFBTSxDQUFDOztBQUU1QjtBQUNBO0FBQ0E7QUFDQSxNQUFNRSxtQkFBbUIsQ0FBQztFQUN4QjtBQUNGO0FBQ0E7RUFDRUMsV0FBV0EsQ0FBQSxFQUFHO0lBQ1o7SUFDQSxJQUFJLENBQUNDLHFCQUFxQixDQUFDLENBQUM7RUFDOUI7O0VBRUE7QUFDRjtBQUNBO0VBQ0VBLHFCQUFxQkEsQ0FBQSxFQUFHO0lBQ3RCO0lBQ0EsSUFBSUMsT0FBTyxDQUFDQyxRQUFRLEtBQUssT0FBTyxFQUFFO01BQ2hDUCxHQUFHLENBQUNRLGlCQUFpQixDQUFDRixPQUFPLENBQUNHLFFBQVEsQ0FBQztJQUN6QztFQUNGOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7RUFDRUMsc0JBQXNCQSxDQUFDQyxRQUFRLEVBQUVDLFVBQVUsRUFBRTtJQUMzQyxNQUFNQyxRQUFRLEdBQUdYLElBQUksQ0FBQ1ksUUFBUSxDQUFDSCxRQUFRLENBQUM7SUFFeEMsTUFBTUksWUFBWSxHQUFHLElBQUloQixZQUFZLENBQUM7TUFDcENpQixLQUFLLEVBQUUscUJBQXFCO01BQzVCQyxJQUFJLEVBQUUsMEJBQTBCSixRQUFRLEVBQUU7TUFDMUM7TUFDQTtNQUNBSyxNQUFNLEVBQUU7SUFDVixDQUFDLENBQUM7O0lBRUY7SUFDQUgsWUFBWSxDQUFDSSxFQUFFLENBQUMsT0FBTyxFQUFFLE1BQU07TUFDN0IsSUFBSVAsVUFBVSxFQUFFO1FBQ2QsTUFBTTtVQUFFUTtRQUFNLENBQUMsR0FBR25CLE9BQU8sQ0FBQyxVQUFVLENBQUM7UUFDckNtQixLQUFLLENBQUNDLGdCQUFnQixDQUFDVCxVQUFVLENBQUM7TUFDcEM7SUFDRixDQUFDLENBQUM7SUFFRkcsWUFBWSxDQUFDTyxJQUFJLENBQUMsQ0FBQztFQUNyQjs7RUFHQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VDLG1CQUFtQkEsQ0FBQ1osUUFBUSxFQUFFYSxLQUFLLEVBQUU7SUFDbkMsTUFBTVgsUUFBUSxHQUFHWCxJQUFJLENBQUNZLFFBQVEsQ0FBQ0gsUUFBUSxDQUFDO0lBRXhDLE1BQU1JLFlBQVksR0FBRyxJQUFJaEIsWUFBWSxDQUFDO01BQ3BDaUIsS0FBSyxFQUFFLGtCQUFrQjtNQUN6QkMsSUFBSSxFQUFFLG9CQUFvQkosUUFBUSxLQUFLVyxLQUFLLENBQUNDLE9BQU8sRUFBRTtNQUN0RDtNQUNBO01BQ0FQLE1BQU0sRUFBRTtJQUNWLENBQUMsQ0FBQztJQUVGSCxZQUFZLENBQUNPLElBQUksQ0FBQyxDQUFDO0VBQ3JCOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7RUFDRUksZUFBZUEsQ0FBQ0MsUUFBUSxFQUFFRixPQUFPLEVBQUU7SUFDakMsTUFBTVYsWUFBWSxHQUFHLElBQUloQixZQUFZLENBQUM7TUFDcENpQixLQUFLLEVBQUUsR0FBR1csUUFBUSxnQkFBZ0I7TUFDbENWLElBQUksRUFBRVEsT0FBTztNQUNiO01BQ0E7TUFDQVAsTUFBTSxFQUFFO0lBQ1YsQ0FBQyxDQUFDO0lBRUZILFlBQVksQ0FBQ08sSUFBSSxDQUFDLENBQUM7RUFDckI7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7RUFDRU0sdUJBQXVCQSxDQUFDQyxRQUFRLEVBQUU7SUFDaEMsSUFBSUEsUUFBUSxFQUFFO01BQ1osTUFBTWQsWUFBWSxHQUFHLElBQUloQixZQUFZLENBQUM7UUFDcENpQixLQUFLLEVBQUUsNkJBQTZCO1FBQ3BDQyxJQUFJLEVBQUUsb0RBQW9EO1FBQzFEO1FBQ0E7UUFDQUMsTUFBTSxFQUFFO01BQ1YsQ0FBQyxDQUFDO01BRUZILFlBQVksQ0FBQ08sSUFBSSxDQUFDLENBQUM7SUFDckIsQ0FBQyxNQUFNO01BQ0wsTUFBTVAsWUFBWSxHQUFHLElBQUloQixZQUFZLENBQUM7UUFDcENpQixLQUFLLEVBQUUseUJBQXlCO1FBQ2hDQyxJQUFJLEVBQUUsaURBQWlEO1FBQ3ZEO1FBQ0E7UUFDQUMsTUFBTSxFQUFFO01BQ1YsQ0FBQyxDQUFDO01BRUZILFlBQVksQ0FBQ08sSUFBSSxDQUFDLENBQUM7SUFDckI7RUFDRjs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VRLGtCQUFrQkEsQ0FBQ25CLFFBQVEsRUFBRW9CLEtBQUssRUFBRTtJQUNsQyxNQUFNbEIsUUFBUSxHQUFHWCxJQUFJLENBQUNZLFFBQVEsQ0FBQ0gsUUFBUSxDQUFDO0lBRXhDLE1BQU1JLFlBQVksR0FBRyxJQUFJaEIsWUFBWSxDQUFDO01BQ3BDaUIsS0FBSyxFQUFFLHNCQUFzQjtNQUM3QkMsSUFBSSxFQUFFLEdBQUdKLFFBQVEsUUFBUWtCLEtBQUssRUFBRTtNQUNoQztNQUNBO01BQ0FiLE1BQU0sRUFBRTtJQUNWLENBQUMsQ0FBQztJQUVGSCxZQUFZLENBQUNPLElBQUksQ0FBQyxDQUFDO0VBQ3JCOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0VBQ0VVLG1CQUFtQkEsQ0FBQ0MsT0FBTyxFQUFFO0lBQzNCLE1BQU1sQixZQUFZLEdBQUcsSUFBSWhCLFlBQVksQ0FBQztNQUNwQ2lCLEtBQUssRUFBRSxrQkFBa0I7TUFDekJDLElBQUksRUFBRSxXQUFXZ0IsT0FBTyxpQ0FBaUM7TUFDekQ7TUFDQTtNQUNBZixNQUFNLEVBQUU7SUFDVixDQUFDLENBQUM7O0lBRUY7SUFDQUgsWUFBWSxDQUFDSSxFQUFFLENBQUMsT0FBTyxFQUFFLE1BQU07TUFDN0I7SUFBQSxDQUNELENBQUM7SUFFRkosWUFBWSxDQUFDTyxJQUFJLENBQUMsQ0FBQztFQUNyQjtBQUNGO0FBRUFZLE1BQU0sQ0FBQ0MsT0FBTyxHQUFHaEMsbUJBQW1CIiwiaWdub3JlTGlzdCI6W119