"use strict";

/**
 * System Tray Integration for the Electron application.
 * Provides tray icon, context menu, and recent files functionality.
 * 
 * Related files:
 * - main.js: Main process entry point
 * - frontend/static/logo.png: Application tray icon
 */

const {
  app,
  Tray,
  Menu,
  MenuItem,
  dialog,
  shell
} = require('electron');
const path = require('path');
const {
  createStore
} = require('../utils/storeFactory');

/**
 * Manages the system tray icon and functionality
 */
class TrayManager {
  /**
   * Creates a new TrayManager instance
   * @param {Electron.BrowserWindow} mainWindow - The main application window
   * @param {Store} store - Electron store for settings and recent files
   */
  constructor(mainWindow, store) {
    this.window = mainWindow;
    this.store = store || createStore('tray-manager');
    this.tray = null;
    this.recentFiles = this.store.get('recentFiles', []);

    // Create the tray when the app is ready
    this.createTray();

    // Update recent files when the window is closed
    this.window.on('close', () => {
      this.store.set('recentFiles', this.recentFiles);
    });
  }

  /**
   * Creates the system tray icon and context menu
   */
  createTray() {
    try {
      const iconPath = path.join(__dirname, '../../../frontend/static/logo.png');

      // Create the tray icon
      this.tray = new Tray(iconPath);
      this.tray.setToolTip('Codex.md - Markdown Converter');

      // Create and set the context menu
      this.updateContextMenu();

      // Handle tray events
      this.setupTrayEvents();
    } catch (error) {
      console.error('Error creating tray:', error);
    }
  }

  /**
   * Updates the tray context menu with current recent files
   */
  updateContextMenu() {
    const contextMenu = Menu.buildFromTemplate([{
      label: 'Show codex.md',
      click: () => this.showWindow()
    }, {
      label: 'Recent Files',
      submenu: this.buildRecentFilesSubmenu()
    }, {
      type: 'separator'
    }, {
      label: 'Quick Convert',
      click: () => this.showFileDialog()
    }, {
      type: 'separator'
    }, {
      label: 'Settings',
      click: () => this.openSettings()
    }, {
      type: 'separator'
    }, {
      label: 'Quit',
      click: () => app.quit()
    }]);
    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Builds the submenu for recent files
   * @returns {Electron.MenuItemConstructorOptions[]} Menu items for recent files
   */
  buildRecentFilesSubmenu() {
    if (!this.recentFiles || this.recentFiles.length === 0) {
      return [{
        label: 'No recent files',
        enabled: false
      }];
    }

    // Create menu items for each recent file (max 10)
    const recentItems = this.recentFiles.slice(0, 10).map(file => ({
      label: path.basename(file),
      click: () => this.openFile(file)
    }));

    // Add a clear option at the bottom
    recentItems.push({
      type: 'separator'
    });
    recentItems.push({
      label: 'Clear Recent Files',
      click: () => this.clearRecentFiles()
    });
    return recentItems;
  }

  /**
   * Sets up event handlers for the tray icon
   */
  setupTrayEvents() {
    // Platform-specific behaviors
    if (process.platform === 'darwin') {
      // On macOS, clicking the tray icon shows the window
      this.tray.on('click', () => this.showWindow());
    } else if (process.platform === 'win32') {
      // On Windows, double-clicking the tray icon shows the window
      this.tray.on('double-click', () => this.showWindow());
    }
  }

  /**
   * Shows the main application window
   */
  showWindow() {
    if (this.window.isMinimized()) {
      this.window.restore();
    }
    this.window.show();
    this.window.focus();
  }

  /**
   * Shows a file dialog for quick conversion
   */
  showFileDialog() {
    dialog.showOpenDialog(this.window, {
      properties: ['openFile', 'multiSelections'],
      filters: [{
        name: 'Documents',
        extensions: ['pdf', 'docx', 'pptx', 'xlsx', 'csv']
      }, {
        name: 'Media',
        extensions: ['mp3', 'mp4', 'wav', 'avi', 'mov']
      }, {
        name: 'All Files',
        extensions: ['*']
      }]
    }).then(result => {
      if (!result.canceled && result.filePaths.length > 0) {
        this.addToRecentFiles(result.filePaths);
        this.showWindow();

        // Send the selected files to the renderer process
        this.window.webContents.send('codex:files-selected', result.filePaths);
      }
    }).catch(err => {
      console.error('Error showing file dialog:', err);
    });
  }

  /**
   * Opens a file with the default application
   * @param {string} filePath - Path to the file to open
   */
  openFile(filePath) {
    shell.openPath(filePath).then(error => {
      if (error) {
        console.error('Error opening file:', error);
      }
    });
  }

  /**
   * Opens the settings page
   */
  openSettings() {
    this.showWindow();
    this.window.webContents.send('codex:open-settings');
  }

  /**
   * Adds files to the recent files list
   * @param {string[]} filePaths - Paths to add to recent files
   */
  addToRecentFiles(filePaths) {
    // Add new files to the beginning of the list
    const newRecentFiles = [...filePaths];

    // Add existing files that aren't duplicates
    for (const file of this.recentFiles) {
      if (!newRecentFiles.includes(file)) {
        newRecentFiles.push(file);
      }
    }

    // Limit to 20 recent files
    this.recentFiles = newRecentFiles.slice(0, 20);

    // Update the store and context menu
    this.store.set('recentFiles', this.recentFiles);
    this.updateContextMenu();
  }

  /**
   * Clears the recent files list
   */
  clearRecentFiles() {
    this.recentFiles = [];
    this.store.set('recentFiles', []);
    this.updateContextMenu();
  }

  /**
   * Destroys the tray icon when the app is quitting
   */
  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
module.exports = TrayManager;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJhcHAiLCJUcmF5IiwiTWVudSIsIk1lbnVJdGVtIiwiZGlhbG9nIiwic2hlbGwiLCJyZXF1aXJlIiwicGF0aCIsImNyZWF0ZVN0b3JlIiwiVHJheU1hbmFnZXIiLCJjb25zdHJ1Y3RvciIsIm1haW5XaW5kb3ciLCJzdG9yZSIsIndpbmRvdyIsInRyYXkiLCJyZWNlbnRGaWxlcyIsImdldCIsImNyZWF0ZVRyYXkiLCJvbiIsInNldCIsImljb25QYXRoIiwiam9pbiIsIl9fZGlybmFtZSIsInNldFRvb2xUaXAiLCJ1cGRhdGVDb250ZXh0TWVudSIsInNldHVwVHJheUV2ZW50cyIsImVycm9yIiwiY29uc29sZSIsImNvbnRleHRNZW51IiwiYnVpbGRGcm9tVGVtcGxhdGUiLCJsYWJlbCIsImNsaWNrIiwic2hvd1dpbmRvdyIsInN1Ym1lbnUiLCJidWlsZFJlY2VudEZpbGVzU3VibWVudSIsInR5cGUiLCJzaG93RmlsZURpYWxvZyIsIm9wZW5TZXR0aW5ncyIsInF1aXQiLCJzZXRDb250ZXh0TWVudSIsImxlbmd0aCIsImVuYWJsZWQiLCJyZWNlbnRJdGVtcyIsInNsaWNlIiwibWFwIiwiZmlsZSIsImJhc2VuYW1lIiwib3BlbkZpbGUiLCJwdXNoIiwiY2xlYXJSZWNlbnRGaWxlcyIsInByb2Nlc3MiLCJwbGF0Zm9ybSIsImlzTWluaW1pemVkIiwicmVzdG9yZSIsInNob3ciLCJmb2N1cyIsInNob3dPcGVuRGlhbG9nIiwicHJvcGVydGllcyIsImZpbHRlcnMiLCJuYW1lIiwiZXh0ZW5zaW9ucyIsInRoZW4iLCJyZXN1bHQiLCJjYW5jZWxlZCIsImZpbGVQYXRocyIsImFkZFRvUmVjZW50RmlsZXMiLCJ3ZWJDb250ZW50cyIsInNlbmQiLCJjYXRjaCIsImVyciIsImZpbGVQYXRoIiwib3BlblBhdGgiLCJuZXdSZWNlbnRGaWxlcyIsImluY2x1ZGVzIiwiZGVzdHJveSIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vZmVhdHVyZXMvdHJheS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogU3lzdGVtIFRyYXkgSW50ZWdyYXRpb24gZm9yIHRoZSBFbGVjdHJvbiBhcHBsaWNhdGlvbi5cclxuICogUHJvdmlkZXMgdHJheSBpY29uLCBjb250ZXh0IG1lbnUsIGFuZCByZWNlbnQgZmlsZXMgZnVuY3Rpb25hbGl0eS5cclxuICogXHJcbiAqIFJlbGF0ZWQgZmlsZXM6XHJcbiAqIC0gbWFpbi5qczogTWFpbiBwcm9jZXNzIGVudHJ5IHBvaW50XHJcbiAqIC0gZnJvbnRlbmQvc3RhdGljL2xvZ28ucG5nOiBBcHBsaWNhdGlvbiB0cmF5IGljb25cclxuICovXHJcblxyXG5jb25zdCB7IGFwcCwgVHJheSwgTWVudSwgTWVudUl0ZW0sIGRpYWxvZywgc2hlbGwgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IHsgY3JlYXRlU3RvcmUgfSA9IHJlcXVpcmUoJy4uL3V0aWxzL3N0b3JlRmFjdG9yeScpO1xyXG5cclxuLyoqXHJcbiAqIE1hbmFnZXMgdGhlIHN5c3RlbSB0cmF5IGljb24gYW5kIGZ1bmN0aW9uYWxpdHlcclxuICovXHJcbmNsYXNzIFRyYXlNYW5hZ2VyIHtcclxuICAvKipcclxuICAgKiBDcmVhdGVzIGEgbmV3IFRyYXlNYW5hZ2VyIGluc3RhbmNlXHJcbiAgICogQHBhcmFtIHtFbGVjdHJvbi5Ccm93c2VyV2luZG93fSBtYWluV2luZG93IC0gVGhlIG1haW4gYXBwbGljYXRpb24gd2luZG93XHJcbiAgICogQHBhcmFtIHtTdG9yZX0gc3RvcmUgLSBFbGVjdHJvbiBzdG9yZSBmb3Igc2V0dGluZ3MgYW5kIHJlY2VudCBmaWxlc1xyXG4gICAqL1xyXG4gIGNvbnN0cnVjdG9yKG1haW5XaW5kb3csIHN0b3JlKSB7XHJcbiAgICB0aGlzLndpbmRvdyA9IG1haW5XaW5kb3c7XHJcbiAgICB0aGlzLnN0b3JlID0gc3RvcmUgfHwgY3JlYXRlU3RvcmUoJ3RyYXktbWFuYWdlcicpO1xyXG4gICAgdGhpcy50cmF5ID0gbnVsbDtcclxuICAgIHRoaXMucmVjZW50RmlsZXMgPSB0aGlzLnN0b3JlLmdldCgncmVjZW50RmlsZXMnLCBbXSk7XHJcbiAgICBcclxuICAgIC8vIENyZWF0ZSB0aGUgdHJheSB3aGVuIHRoZSBhcHAgaXMgcmVhZHlcclxuICAgIHRoaXMuY3JlYXRlVHJheSgpO1xyXG4gICAgXHJcbiAgICAvLyBVcGRhdGUgcmVjZW50IGZpbGVzIHdoZW4gdGhlIHdpbmRvdyBpcyBjbG9zZWRcclxuICAgIHRoaXMud2luZG93Lm9uKCdjbG9zZScsICgpID0+IHtcclxuICAgICAgdGhpcy5zdG9yZS5zZXQoJ3JlY2VudEZpbGVzJywgdGhpcy5yZWNlbnRGaWxlcyk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENyZWF0ZXMgdGhlIHN5c3RlbSB0cmF5IGljb24gYW5kIGNvbnRleHQgbWVudVxyXG4gICAqL1xyXG4gIGNyZWF0ZVRyYXkoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBpY29uUGF0aCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi8uLi9mcm9udGVuZC9zdGF0aWMvbG9nby5wbmcnKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSB0aGUgdHJheSBpY29uXHJcbiAgICAgIHRoaXMudHJheSA9IG5ldyBUcmF5KGljb25QYXRoKTtcclxuICAgICAgdGhpcy50cmF5LnNldFRvb2xUaXAoJ0NvZGV4Lm1kIC0gTWFya2Rvd24gQ29udmVydGVyJyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgYW5kIHNldCB0aGUgY29udGV4dCBtZW51XHJcbiAgICAgIHRoaXMudXBkYXRlQ29udGV4dE1lbnUoKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEhhbmRsZSB0cmF5IGV2ZW50c1xyXG4gICAgICB0aGlzLnNldHVwVHJheUV2ZW50cygpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgY3JlYXRpbmcgdHJheTonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBVcGRhdGVzIHRoZSB0cmF5IGNvbnRleHQgbWVudSB3aXRoIGN1cnJlbnQgcmVjZW50IGZpbGVzXHJcbiAgICovXHJcbiAgdXBkYXRlQ29udGV4dE1lbnUoKSB7XHJcbiAgICBjb25zdCBjb250ZXh0TWVudSA9IE1lbnUuYnVpbGRGcm9tVGVtcGxhdGUoW1xyXG4gICAgICB7XHJcbiAgICAgICAgbGFiZWw6ICdTaG93IGNvZGV4Lm1kJyxcclxuICAgICAgICBjbGljazogKCkgPT4gdGhpcy5zaG93V2luZG93KClcclxuICAgICAgfSxcclxuICAgICAge1xyXG4gICAgICAgIGxhYmVsOiAnUmVjZW50IEZpbGVzJyxcclxuICAgICAgICBzdWJtZW51OiB0aGlzLmJ1aWxkUmVjZW50RmlsZXNTdWJtZW51KClcclxuICAgICAgfSxcclxuICAgICAgeyB0eXBlOiAnc2VwYXJhdG9yJyB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgbGFiZWw6ICdRdWljayBDb252ZXJ0JyxcclxuICAgICAgICBjbGljazogKCkgPT4gdGhpcy5zaG93RmlsZURpYWxvZygpXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgdHlwZTogJ3NlcGFyYXRvcicgfSxcclxuICAgICAge1xyXG4gICAgICAgIGxhYmVsOiAnU2V0dGluZ3MnLFxyXG4gICAgICAgIGNsaWNrOiAoKSA9PiB0aGlzLm9wZW5TZXR0aW5ncygpXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgdHlwZTogJ3NlcGFyYXRvcicgfSxcclxuICAgICAge1xyXG4gICAgICAgIGxhYmVsOiAnUXVpdCcsXHJcbiAgICAgICAgY2xpY2s6ICgpID0+IGFwcC5xdWl0KClcclxuICAgICAgfVxyXG4gICAgXSk7XHJcbiAgICBcclxuICAgIHRoaXMudHJheS5zZXRDb250ZXh0TWVudShjb250ZXh0TWVudSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBCdWlsZHMgdGhlIHN1Ym1lbnUgZm9yIHJlY2VudCBmaWxlc1xyXG4gICAqIEByZXR1cm5zIHtFbGVjdHJvbi5NZW51SXRlbUNvbnN0cnVjdG9yT3B0aW9uc1tdfSBNZW51IGl0ZW1zIGZvciByZWNlbnQgZmlsZXNcclxuICAgKi9cclxuICBidWlsZFJlY2VudEZpbGVzU3VibWVudSgpIHtcclxuICAgIGlmICghdGhpcy5yZWNlbnRGaWxlcyB8fCB0aGlzLnJlY2VudEZpbGVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICByZXR1cm4gW3sgbGFiZWw6ICdObyByZWNlbnQgZmlsZXMnLCBlbmFibGVkOiBmYWxzZSB9XTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gQ3JlYXRlIG1lbnUgaXRlbXMgZm9yIGVhY2ggcmVjZW50IGZpbGUgKG1heCAxMClcclxuICAgIGNvbnN0IHJlY2VudEl0ZW1zID0gdGhpcy5yZWNlbnRGaWxlcy5zbGljZSgwLCAxMCkubWFwKGZpbGUgPT4gKHtcclxuICAgICAgbGFiZWw6IHBhdGguYmFzZW5hbWUoZmlsZSksXHJcbiAgICAgIGNsaWNrOiAoKSA9PiB0aGlzLm9wZW5GaWxlKGZpbGUpXHJcbiAgICB9KSk7XHJcbiAgICBcclxuICAgIC8vIEFkZCBhIGNsZWFyIG9wdGlvbiBhdCB0aGUgYm90dG9tXHJcbiAgICByZWNlbnRJdGVtcy5wdXNoKHsgdHlwZTogJ3NlcGFyYXRvcicgfSk7XHJcbiAgICByZWNlbnRJdGVtcy5wdXNoKHtcclxuICAgICAgbGFiZWw6ICdDbGVhciBSZWNlbnQgRmlsZXMnLFxyXG4gICAgICBjbGljazogKCkgPT4gdGhpcy5jbGVhclJlY2VudEZpbGVzKClcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICByZXR1cm4gcmVjZW50SXRlbXM7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTZXRzIHVwIGV2ZW50IGhhbmRsZXJzIGZvciB0aGUgdHJheSBpY29uXHJcbiAgICovXHJcbiAgc2V0dXBUcmF5RXZlbnRzKCkge1xyXG4gICAgLy8gUGxhdGZvcm0tc3BlY2lmaWMgYmVoYXZpb3JzXHJcbiAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2RhcndpbicpIHtcclxuICAgICAgLy8gT24gbWFjT1MsIGNsaWNraW5nIHRoZSB0cmF5IGljb24gc2hvd3MgdGhlIHdpbmRvd1xyXG4gICAgICB0aGlzLnRyYXkub24oJ2NsaWNrJywgKCkgPT4gdGhpcy5zaG93V2luZG93KCkpO1xyXG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XHJcbiAgICAgIC8vIE9uIFdpbmRvd3MsIGRvdWJsZS1jbGlja2luZyB0aGUgdHJheSBpY29uIHNob3dzIHRoZSB3aW5kb3dcclxuICAgICAgdGhpcy50cmF5Lm9uKCdkb3VibGUtY2xpY2snLCAoKSA9PiB0aGlzLnNob3dXaW5kb3coKSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTaG93cyB0aGUgbWFpbiBhcHBsaWNhdGlvbiB3aW5kb3dcclxuICAgKi9cclxuICBzaG93V2luZG93KCkge1xyXG4gICAgaWYgKHRoaXMud2luZG93LmlzTWluaW1pemVkKCkpIHtcclxuICAgICAgdGhpcy53aW5kb3cucmVzdG9yZSgpO1xyXG4gICAgfVxyXG4gICAgdGhpcy53aW5kb3cuc2hvdygpO1xyXG4gICAgdGhpcy53aW5kb3cuZm9jdXMoKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNob3dzIGEgZmlsZSBkaWFsb2cgZm9yIHF1aWNrIGNvbnZlcnNpb25cclxuICAgKi9cclxuICBzaG93RmlsZURpYWxvZygpIHtcclxuICAgIGRpYWxvZy5zaG93T3BlbkRpYWxvZyh0aGlzLndpbmRvdywge1xyXG4gICAgICBwcm9wZXJ0aWVzOiBbJ29wZW5GaWxlJywgJ211bHRpU2VsZWN0aW9ucyddLFxyXG4gICAgICBmaWx0ZXJzOiBbXHJcbiAgICAgICAgeyBuYW1lOiAnRG9jdW1lbnRzJywgZXh0ZW5zaW9uczogWydwZGYnLCAnZG9jeCcsICdwcHR4JywgJ3hsc3gnLCAnY3N2J10gfSxcclxuICAgICAgICB7IG5hbWU6ICdNZWRpYScsIGV4dGVuc2lvbnM6IFsnbXAzJywgJ21wNCcsICd3YXYnLCAnYXZpJywgJ21vdiddIH0sXHJcbiAgICAgICAgeyBuYW1lOiAnQWxsIEZpbGVzJywgZXh0ZW5zaW9uczogWycqJ10gfVxyXG4gICAgICBdXHJcbiAgICB9KS50aGVuKHJlc3VsdCA9PiB7XHJcbiAgICAgIGlmICghcmVzdWx0LmNhbmNlbGVkICYmIHJlc3VsdC5maWxlUGF0aHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIHRoaXMuYWRkVG9SZWNlbnRGaWxlcyhyZXN1bHQuZmlsZVBhdGhzKTtcclxuICAgICAgICB0aGlzLnNob3dXaW5kb3coKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBTZW5kIHRoZSBzZWxlY3RlZCBmaWxlcyB0byB0aGUgcmVuZGVyZXIgcHJvY2Vzc1xyXG4gICAgICAgIHRoaXMud2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ2NvZGV4OmZpbGVzLXNlbGVjdGVkJywgcmVzdWx0LmZpbGVQYXRocyk7XHJcbiAgICAgIH1cclxuICAgIH0pLmNhdGNoKGVyciA9PiB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHNob3dpbmcgZmlsZSBkaWFsb2c6JywgZXJyKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogT3BlbnMgYSBmaWxlIHdpdGggdGhlIGRlZmF1bHQgYXBwbGljYXRpb25cclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIHRoZSBmaWxlIHRvIG9wZW5cclxuICAgKi9cclxuICBvcGVuRmlsZShmaWxlUGF0aCkge1xyXG4gICAgc2hlbGwub3BlblBhdGgoZmlsZVBhdGgpLnRoZW4oZXJyb3IgPT4ge1xyXG4gICAgICBpZiAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBvcGVuaW5nIGZpbGU6JywgZXJyb3IpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIE9wZW5zIHRoZSBzZXR0aW5ncyBwYWdlXHJcbiAgICovXHJcbiAgb3BlblNldHRpbmdzKCkge1xyXG4gICAgdGhpcy5zaG93V2luZG93KCk7XHJcbiAgICB0aGlzLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdjb2RleDpvcGVuLXNldHRpbmdzJyk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBBZGRzIGZpbGVzIHRvIHRoZSByZWNlbnQgZmlsZXMgbGlzdFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGZpbGVQYXRocyAtIFBhdGhzIHRvIGFkZCB0byByZWNlbnQgZmlsZXNcclxuICAgKi9cclxuICBhZGRUb1JlY2VudEZpbGVzKGZpbGVQYXRocykge1xyXG4gICAgLy8gQWRkIG5ldyBmaWxlcyB0byB0aGUgYmVnaW5uaW5nIG9mIHRoZSBsaXN0XHJcbiAgICBjb25zdCBuZXdSZWNlbnRGaWxlcyA9IFsuLi5maWxlUGF0aHNdO1xyXG4gICAgXHJcbiAgICAvLyBBZGQgZXhpc3RpbmcgZmlsZXMgdGhhdCBhcmVuJ3QgZHVwbGljYXRlc1xyXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHRoaXMucmVjZW50RmlsZXMpIHtcclxuICAgICAgaWYgKCFuZXdSZWNlbnRGaWxlcy5pbmNsdWRlcyhmaWxlKSkge1xyXG4gICAgICAgIG5ld1JlY2VudEZpbGVzLnB1c2goZmlsZSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gTGltaXQgdG8gMjAgcmVjZW50IGZpbGVzXHJcbiAgICB0aGlzLnJlY2VudEZpbGVzID0gbmV3UmVjZW50RmlsZXMuc2xpY2UoMCwgMjApO1xyXG4gICAgXHJcbiAgICAvLyBVcGRhdGUgdGhlIHN0b3JlIGFuZCBjb250ZXh0IG1lbnVcclxuICAgIHRoaXMuc3RvcmUuc2V0KCdyZWNlbnRGaWxlcycsIHRoaXMucmVjZW50RmlsZXMpO1xyXG4gICAgdGhpcy51cGRhdGVDb250ZXh0TWVudSgpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2xlYXJzIHRoZSByZWNlbnQgZmlsZXMgbGlzdFxyXG4gICAqL1xyXG4gIGNsZWFyUmVjZW50RmlsZXMoKSB7XHJcbiAgICB0aGlzLnJlY2VudEZpbGVzID0gW107XHJcbiAgICB0aGlzLnN0b3JlLnNldCgncmVjZW50RmlsZXMnLCBbXSk7XHJcbiAgICB0aGlzLnVwZGF0ZUNvbnRleHRNZW51KCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBEZXN0cm95cyB0aGUgdHJheSBpY29uIHdoZW4gdGhlIGFwcCBpcyBxdWl0dGluZ1xyXG4gICAqL1xyXG4gIGRlc3Ryb3koKSB7XHJcbiAgICBpZiAodGhpcy50cmF5KSB7XHJcbiAgICAgIHRoaXMudHJheS5kZXN0cm95KCk7XHJcbiAgICAgIHRoaXMudHJheSA9IG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFRyYXlNYW5hZ2VyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNO0VBQUVBLEdBQUc7RUFBRUMsSUFBSTtFQUFFQyxJQUFJO0VBQUVDLFFBQVE7RUFBRUMsTUFBTTtFQUFFQztBQUFNLENBQUMsR0FBR0MsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUN4RSxNQUFNQyxJQUFJLEdBQUdELE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTTtFQUFFRTtBQUFZLENBQUMsR0FBR0YsT0FBTyxDQUFDLHVCQUF1QixDQUFDOztBQUV4RDtBQUNBO0FBQ0E7QUFDQSxNQUFNRyxXQUFXLENBQUM7RUFDaEI7QUFDRjtBQUNBO0FBQ0E7QUFDQTtFQUNFQyxXQUFXQSxDQUFDQyxVQUFVLEVBQUVDLEtBQUssRUFBRTtJQUM3QixJQUFJLENBQUNDLE1BQU0sR0FBR0YsVUFBVTtJQUN4QixJQUFJLENBQUNDLEtBQUssR0FBR0EsS0FBSyxJQUFJSixXQUFXLENBQUMsY0FBYyxDQUFDO0lBQ2pELElBQUksQ0FBQ00sSUFBSSxHQUFHLElBQUk7SUFDaEIsSUFBSSxDQUFDQyxXQUFXLEdBQUcsSUFBSSxDQUFDSCxLQUFLLENBQUNJLEdBQUcsQ0FBQyxhQUFhLEVBQUUsRUFBRSxDQUFDOztJQUVwRDtJQUNBLElBQUksQ0FBQ0MsVUFBVSxDQUFDLENBQUM7O0lBRWpCO0lBQ0EsSUFBSSxDQUFDSixNQUFNLENBQUNLLEVBQUUsQ0FBQyxPQUFPLEVBQUUsTUFBTTtNQUM1QixJQUFJLENBQUNOLEtBQUssQ0FBQ08sR0FBRyxDQUFDLGFBQWEsRUFBRSxJQUFJLENBQUNKLFdBQVcsQ0FBQztJQUNqRCxDQUFDLENBQUM7RUFDSjs7RUFFQTtBQUNGO0FBQ0E7RUFDRUUsVUFBVUEsQ0FBQSxFQUFHO0lBQ1gsSUFBSTtNQUNGLE1BQU1HLFFBQVEsR0FBR2IsSUFBSSxDQUFDYyxJQUFJLENBQUNDLFNBQVMsRUFBRSxtQ0FBbUMsQ0FBQzs7TUFFMUU7TUFDQSxJQUFJLENBQUNSLElBQUksR0FBRyxJQUFJYixJQUFJLENBQUNtQixRQUFRLENBQUM7TUFDOUIsSUFBSSxDQUFDTixJQUFJLENBQUNTLFVBQVUsQ0FBQywrQkFBK0IsQ0FBQzs7TUFFckQ7TUFDQSxJQUFJLENBQUNDLGlCQUFpQixDQUFDLENBQUM7O01BRXhCO01BQ0EsSUFBSSxDQUFDQyxlQUFlLENBQUMsQ0FBQztJQUN4QixDQUFDLENBQUMsT0FBT0MsS0FBSyxFQUFFO01BQ2RDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLHNCQUFzQixFQUFFQSxLQUFLLENBQUM7SUFDOUM7RUFDRjs7RUFFQTtBQUNGO0FBQ0E7RUFDRUYsaUJBQWlCQSxDQUFBLEVBQUc7SUFDbEIsTUFBTUksV0FBVyxHQUFHMUIsSUFBSSxDQUFDMkIsaUJBQWlCLENBQUMsQ0FDekM7TUFDRUMsS0FBSyxFQUFFLGVBQWU7TUFDdEJDLEtBQUssRUFBRUEsQ0FBQSxLQUFNLElBQUksQ0FBQ0MsVUFBVSxDQUFDO0lBQy9CLENBQUMsRUFDRDtNQUNFRixLQUFLLEVBQUUsY0FBYztNQUNyQkcsT0FBTyxFQUFFLElBQUksQ0FBQ0MsdUJBQXVCLENBQUM7SUFDeEMsQ0FBQyxFQUNEO01BQUVDLElBQUksRUFBRTtJQUFZLENBQUMsRUFDckI7TUFDRUwsS0FBSyxFQUFFLGVBQWU7TUFDdEJDLEtBQUssRUFBRUEsQ0FBQSxLQUFNLElBQUksQ0FBQ0ssY0FBYyxDQUFDO0lBQ25DLENBQUMsRUFDRDtNQUFFRCxJQUFJLEVBQUU7SUFBWSxDQUFDLEVBQ3JCO01BQ0VMLEtBQUssRUFBRSxVQUFVO01BQ2pCQyxLQUFLLEVBQUVBLENBQUEsS0FBTSxJQUFJLENBQUNNLFlBQVksQ0FBQztJQUNqQyxDQUFDLEVBQ0Q7TUFBRUYsSUFBSSxFQUFFO0lBQVksQ0FBQyxFQUNyQjtNQUNFTCxLQUFLLEVBQUUsTUFBTTtNQUNiQyxLQUFLLEVBQUVBLENBQUEsS0FBTS9CLEdBQUcsQ0FBQ3NDLElBQUksQ0FBQztJQUN4QixDQUFDLENBQ0YsQ0FBQztJQUVGLElBQUksQ0FBQ3hCLElBQUksQ0FBQ3lCLGNBQWMsQ0FBQ1gsV0FBVyxDQUFDO0VBQ3ZDOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0VBQ0VNLHVCQUF1QkEsQ0FBQSxFQUFHO0lBQ3hCLElBQUksQ0FBQyxJQUFJLENBQUNuQixXQUFXLElBQUksSUFBSSxDQUFDQSxXQUFXLENBQUN5QixNQUFNLEtBQUssQ0FBQyxFQUFFO01BQ3RELE9BQU8sQ0FBQztRQUFFVixLQUFLLEVBQUUsaUJBQWlCO1FBQUVXLE9BQU8sRUFBRTtNQUFNLENBQUMsQ0FBQztJQUN2RDs7SUFFQTtJQUNBLE1BQU1DLFdBQVcsR0FBRyxJQUFJLENBQUMzQixXQUFXLENBQUM0QixLQUFLLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDQyxHQUFHLENBQUNDLElBQUksS0FBSztNQUM3RGYsS0FBSyxFQUFFdkIsSUFBSSxDQUFDdUMsUUFBUSxDQUFDRCxJQUFJLENBQUM7TUFDMUJkLEtBQUssRUFBRUEsQ0FBQSxLQUFNLElBQUksQ0FBQ2dCLFFBQVEsQ0FBQ0YsSUFBSTtJQUNqQyxDQUFDLENBQUMsQ0FBQzs7SUFFSDtJQUNBSCxXQUFXLENBQUNNLElBQUksQ0FBQztNQUFFYixJQUFJLEVBQUU7SUFBWSxDQUFDLENBQUM7SUFDdkNPLFdBQVcsQ0FBQ00sSUFBSSxDQUFDO01BQ2ZsQixLQUFLLEVBQUUsb0JBQW9CO01BQzNCQyxLQUFLLEVBQUVBLENBQUEsS0FBTSxJQUFJLENBQUNrQixnQkFBZ0IsQ0FBQztJQUNyQyxDQUFDLENBQUM7SUFFRixPQUFPUCxXQUFXO0VBQ3BCOztFQUVBO0FBQ0Y7QUFDQTtFQUNFakIsZUFBZUEsQ0FBQSxFQUFHO0lBQ2hCO0lBQ0EsSUFBSXlCLE9BQU8sQ0FBQ0MsUUFBUSxLQUFLLFFBQVEsRUFBRTtNQUNqQztNQUNBLElBQUksQ0FBQ3JDLElBQUksQ0FBQ0ksRUFBRSxDQUFDLE9BQU8sRUFBRSxNQUFNLElBQUksQ0FBQ2MsVUFBVSxDQUFDLENBQUMsQ0FBQztJQUNoRCxDQUFDLE1BQU0sSUFBSWtCLE9BQU8sQ0FBQ0MsUUFBUSxLQUFLLE9BQU8sRUFBRTtNQUN2QztNQUNBLElBQUksQ0FBQ3JDLElBQUksQ0FBQ0ksRUFBRSxDQUFDLGNBQWMsRUFBRSxNQUFNLElBQUksQ0FBQ2MsVUFBVSxDQUFDLENBQUMsQ0FBQztJQUN2RDtFQUNGOztFQUVBO0FBQ0Y7QUFDQTtFQUNFQSxVQUFVQSxDQUFBLEVBQUc7SUFDWCxJQUFJLElBQUksQ0FBQ25CLE1BQU0sQ0FBQ3VDLFdBQVcsQ0FBQyxDQUFDLEVBQUU7TUFDN0IsSUFBSSxDQUFDdkMsTUFBTSxDQUFDd0MsT0FBTyxDQUFDLENBQUM7SUFDdkI7SUFDQSxJQUFJLENBQUN4QyxNQUFNLENBQUN5QyxJQUFJLENBQUMsQ0FBQztJQUNsQixJQUFJLENBQUN6QyxNQUFNLENBQUMwQyxLQUFLLENBQUMsQ0FBQztFQUNyQjs7RUFFQTtBQUNGO0FBQ0E7RUFDRW5CLGNBQWNBLENBQUEsRUFBRztJQUNmaEMsTUFBTSxDQUFDb0QsY0FBYyxDQUFDLElBQUksQ0FBQzNDLE1BQU0sRUFBRTtNQUNqQzRDLFVBQVUsRUFBRSxDQUFDLFVBQVUsRUFBRSxpQkFBaUIsQ0FBQztNQUMzQ0MsT0FBTyxFQUFFLENBQ1A7UUFBRUMsSUFBSSxFQUFFLFdBQVc7UUFBRUMsVUFBVSxFQUFFLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEtBQUs7TUFBRSxDQUFDLEVBQ3pFO1FBQUVELElBQUksRUFBRSxPQUFPO1FBQUVDLFVBQVUsRUFBRSxDQUFDLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLO01BQUUsQ0FBQyxFQUNsRTtRQUFFRCxJQUFJLEVBQUUsV0FBVztRQUFFQyxVQUFVLEVBQUUsQ0FBQyxHQUFHO01BQUUsQ0FBQztJQUU1QyxDQUFDLENBQUMsQ0FBQ0MsSUFBSSxDQUFDQyxNQUFNLElBQUk7TUFDaEIsSUFBSSxDQUFDQSxNQUFNLENBQUNDLFFBQVEsSUFBSUQsTUFBTSxDQUFDRSxTQUFTLENBQUN4QixNQUFNLEdBQUcsQ0FBQyxFQUFFO1FBQ25ELElBQUksQ0FBQ3lCLGdCQUFnQixDQUFDSCxNQUFNLENBQUNFLFNBQVMsQ0FBQztRQUN2QyxJQUFJLENBQUNoQyxVQUFVLENBQUMsQ0FBQzs7UUFFakI7UUFDQSxJQUFJLENBQUNuQixNQUFNLENBQUNxRCxXQUFXLENBQUNDLElBQUksQ0FBQyxzQkFBc0IsRUFBRUwsTUFBTSxDQUFDRSxTQUFTLENBQUM7TUFDeEU7SUFDRixDQUFDLENBQUMsQ0FBQ0ksS0FBSyxDQUFDQyxHQUFHLElBQUk7TUFDZDFDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLDRCQUE0QixFQUFFMkMsR0FBRyxDQUFDO0lBQ2xELENBQUMsQ0FBQztFQUNKOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0VBQ0V0QixRQUFRQSxDQUFDdUIsUUFBUSxFQUFFO0lBQ2pCakUsS0FBSyxDQUFDa0UsUUFBUSxDQUFDRCxRQUFRLENBQUMsQ0FBQ1QsSUFBSSxDQUFDbkMsS0FBSyxJQUFJO01BQ3JDLElBQUlBLEtBQUssRUFBRTtRQUNUQyxPQUFPLENBQUNELEtBQUssQ0FBQyxxQkFBcUIsRUFBRUEsS0FBSyxDQUFDO01BQzdDO0lBQ0YsQ0FBQyxDQUFDO0VBQ0o7O0VBRUE7QUFDRjtBQUNBO0VBQ0VXLFlBQVlBLENBQUEsRUFBRztJQUNiLElBQUksQ0FBQ0wsVUFBVSxDQUFDLENBQUM7SUFDakIsSUFBSSxDQUFDbkIsTUFBTSxDQUFDcUQsV0FBVyxDQUFDQyxJQUFJLENBQUMscUJBQXFCLENBQUM7RUFDckQ7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7RUFDRUYsZ0JBQWdCQSxDQUFDRCxTQUFTLEVBQUU7SUFDMUI7SUFDQSxNQUFNUSxjQUFjLEdBQUcsQ0FBQyxHQUFHUixTQUFTLENBQUM7O0lBRXJDO0lBQ0EsS0FBSyxNQUFNbkIsSUFBSSxJQUFJLElBQUksQ0FBQzlCLFdBQVcsRUFBRTtNQUNuQyxJQUFJLENBQUN5RCxjQUFjLENBQUNDLFFBQVEsQ0FBQzVCLElBQUksQ0FBQyxFQUFFO1FBQ2xDMkIsY0FBYyxDQUFDeEIsSUFBSSxDQUFDSCxJQUFJLENBQUM7TUFDM0I7SUFDRjs7SUFFQTtJQUNBLElBQUksQ0FBQzlCLFdBQVcsR0FBR3lELGNBQWMsQ0FBQzdCLEtBQUssQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDOztJQUU5QztJQUNBLElBQUksQ0FBQy9CLEtBQUssQ0FBQ08sR0FBRyxDQUFDLGFBQWEsRUFBRSxJQUFJLENBQUNKLFdBQVcsQ0FBQztJQUMvQyxJQUFJLENBQUNTLGlCQUFpQixDQUFDLENBQUM7RUFDMUI7O0VBRUE7QUFDRjtBQUNBO0VBQ0V5QixnQkFBZ0JBLENBQUEsRUFBRztJQUNqQixJQUFJLENBQUNsQyxXQUFXLEdBQUcsRUFBRTtJQUNyQixJQUFJLENBQUNILEtBQUssQ0FBQ08sR0FBRyxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUM7SUFDakMsSUFBSSxDQUFDSyxpQkFBaUIsQ0FBQyxDQUFDO0VBQzFCOztFQUVBO0FBQ0Y7QUFDQTtFQUNFa0QsT0FBT0EsQ0FBQSxFQUFHO0lBQ1IsSUFBSSxJQUFJLENBQUM1RCxJQUFJLEVBQUU7TUFDYixJQUFJLENBQUNBLElBQUksQ0FBQzRELE9BQU8sQ0FBQyxDQUFDO01BQ25CLElBQUksQ0FBQzVELElBQUksR0FBRyxJQUFJO0lBQ2xCO0VBQ0Y7QUFDRjtBQUVBNkQsTUFBTSxDQUFDQyxPQUFPLEdBQUduRSxXQUFXIiwiaWdub3JlTGlzdCI6W119