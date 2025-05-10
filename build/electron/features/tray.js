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
const {
  getImageResourcePath
} = require('../utils/resourcePaths');

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
      // Get the tray icon path with fallback to an empty image if not found
      const iconPath = getImageResourcePath('logo.png', {
        additionalPaths: [
        // Extra paths specific to tray icon
        path.join(__dirname, '../../../frontend/static/logo.png'), path.join(__dirname, '../../../frontend/static/app-icon.png'), path.join(process.resourcesPath, 'static', 'app-icon.png'), path.join(process.resourcesPath, 'frontend', 'static', 'logo.png'), path.join(app.getPath('userData'), 'logo.png')]
      });

      // Create the tray icon
      this.tray = new Tray(iconPath);
      this.tray.setToolTip('Codex.md - Markdown Converter');

      // Create and set the context menu
      this.updateContextMenu();

      // Handle tray events
      this.setupTrayEvents();
      console.log('✅ Tray successfully created');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJhcHAiLCJUcmF5IiwiTWVudSIsIk1lbnVJdGVtIiwiZGlhbG9nIiwic2hlbGwiLCJyZXF1aXJlIiwicGF0aCIsImNyZWF0ZVN0b3JlIiwiZ2V0SW1hZ2VSZXNvdXJjZVBhdGgiLCJUcmF5TWFuYWdlciIsImNvbnN0cnVjdG9yIiwibWFpbldpbmRvdyIsInN0b3JlIiwid2luZG93IiwidHJheSIsInJlY2VudEZpbGVzIiwiZ2V0IiwiY3JlYXRlVHJheSIsIm9uIiwic2V0IiwiaWNvblBhdGgiLCJhZGRpdGlvbmFsUGF0aHMiLCJqb2luIiwiX19kaXJuYW1lIiwicHJvY2VzcyIsInJlc291cmNlc1BhdGgiLCJnZXRQYXRoIiwic2V0VG9vbFRpcCIsInVwZGF0ZUNvbnRleHRNZW51Iiwic2V0dXBUcmF5RXZlbnRzIiwiY29uc29sZSIsImxvZyIsImVycm9yIiwiY29udGV4dE1lbnUiLCJidWlsZEZyb21UZW1wbGF0ZSIsImxhYmVsIiwiY2xpY2siLCJzaG93V2luZG93Iiwic3VibWVudSIsImJ1aWxkUmVjZW50RmlsZXNTdWJtZW51IiwidHlwZSIsInNob3dGaWxlRGlhbG9nIiwib3BlblNldHRpbmdzIiwicXVpdCIsInNldENvbnRleHRNZW51IiwibGVuZ3RoIiwiZW5hYmxlZCIsInJlY2VudEl0ZW1zIiwic2xpY2UiLCJtYXAiLCJmaWxlIiwiYmFzZW5hbWUiLCJvcGVuRmlsZSIsInB1c2giLCJjbGVhclJlY2VudEZpbGVzIiwicGxhdGZvcm0iLCJpc01pbmltaXplZCIsInJlc3RvcmUiLCJzaG93IiwiZm9jdXMiLCJzaG93T3BlbkRpYWxvZyIsInByb3BlcnRpZXMiLCJmaWx0ZXJzIiwibmFtZSIsImV4dGVuc2lvbnMiLCJ0aGVuIiwicmVzdWx0IiwiY2FuY2VsZWQiLCJmaWxlUGF0aHMiLCJhZGRUb1JlY2VudEZpbGVzIiwid2ViQ29udGVudHMiLCJzZW5kIiwiY2F0Y2giLCJlcnIiLCJmaWxlUGF0aCIsIm9wZW5QYXRoIiwibmV3UmVjZW50RmlsZXMiLCJpbmNsdWRlcyIsImRlc3Ryb3kiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL2ZlYXR1cmVzL3RyYXkuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFN5c3RlbSBUcmF5IEludGVncmF0aW9uIGZvciB0aGUgRWxlY3Ryb24gYXBwbGljYXRpb24uXHJcbiAqIFByb3ZpZGVzIHRyYXkgaWNvbiwgY29udGV4dCBtZW51LCBhbmQgcmVjZW50IGZpbGVzIGZ1bmN0aW9uYWxpdHkuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIG1haW4uanM6IE1haW4gcHJvY2VzcyBlbnRyeSBwb2ludFxyXG4gKiAtIGZyb250ZW5kL3N0YXRpYy9sb2dvLnBuZzogQXBwbGljYXRpb24gdHJheSBpY29uXHJcbiAqL1xyXG5cclxuY29uc3QgeyBhcHAsIFRyYXksIE1lbnUsIE1lbnVJdGVtLCBkaWFsb2csIHNoZWxsIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IGNyZWF0ZVN0b3JlIH0gPSByZXF1aXJlKCcuLi91dGlscy9zdG9yZUZhY3RvcnknKTtcclxuY29uc3QgeyBnZXRJbWFnZVJlc291cmNlUGF0aCB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvcmVzb3VyY2VQYXRocycpO1xyXG5cclxuLyoqXHJcbiAqIE1hbmFnZXMgdGhlIHN5c3RlbSB0cmF5IGljb24gYW5kIGZ1bmN0aW9uYWxpdHlcclxuICovXHJcbmNsYXNzIFRyYXlNYW5hZ2VyIHtcclxuICAvKipcclxuICAgKiBDcmVhdGVzIGEgbmV3IFRyYXlNYW5hZ2VyIGluc3RhbmNlXHJcbiAgICogQHBhcmFtIHtFbGVjdHJvbi5Ccm93c2VyV2luZG93fSBtYWluV2luZG93IC0gVGhlIG1haW4gYXBwbGljYXRpb24gd2luZG93XHJcbiAgICogQHBhcmFtIHtTdG9yZX0gc3RvcmUgLSBFbGVjdHJvbiBzdG9yZSBmb3Igc2V0dGluZ3MgYW5kIHJlY2VudCBmaWxlc1xyXG4gICAqL1xyXG4gIGNvbnN0cnVjdG9yKG1haW5XaW5kb3csIHN0b3JlKSB7XHJcbiAgICB0aGlzLndpbmRvdyA9IG1haW5XaW5kb3c7XHJcbiAgICB0aGlzLnN0b3JlID0gc3RvcmUgfHwgY3JlYXRlU3RvcmUoJ3RyYXktbWFuYWdlcicpO1xyXG4gICAgdGhpcy50cmF5ID0gbnVsbDtcclxuICAgIHRoaXMucmVjZW50RmlsZXMgPSB0aGlzLnN0b3JlLmdldCgncmVjZW50RmlsZXMnLCBbXSk7XHJcbiAgICBcclxuICAgIC8vIENyZWF0ZSB0aGUgdHJheSB3aGVuIHRoZSBhcHAgaXMgcmVhZHlcclxuICAgIHRoaXMuY3JlYXRlVHJheSgpO1xyXG4gICAgXHJcbiAgICAvLyBVcGRhdGUgcmVjZW50IGZpbGVzIHdoZW4gdGhlIHdpbmRvdyBpcyBjbG9zZWRcclxuICAgIHRoaXMud2luZG93Lm9uKCdjbG9zZScsICgpID0+IHtcclxuICAgICAgdGhpcy5zdG9yZS5zZXQoJ3JlY2VudEZpbGVzJywgdGhpcy5yZWNlbnRGaWxlcyk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENyZWF0ZXMgdGhlIHN5c3RlbSB0cmF5IGljb24gYW5kIGNvbnRleHQgbWVudVxyXG4gICAqL1xyXG4gIGNyZWF0ZVRyYXkoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBHZXQgdGhlIHRyYXkgaWNvbiBwYXRoIHdpdGggZmFsbGJhY2sgdG8gYW4gZW1wdHkgaW1hZ2UgaWYgbm90IGZvdW5kXHJcbiAgICAgIGNvbnN0IGljb25QYXRoID0gZ2V0SW1hZ2VSZXNvdXJjZVBhdGgoJ2xvZ28ucG5nJywge1xyXG4gICAgICAgIGFkZGl0aW9uYWxQYXRoczogW1xyXG4gICAgICAgICAgLy8gRXh0cmEgcGF0aHMgc3BlY2lmaWMgdG8gdHJheSBpY29uXHJcbiAgICAgICAgICBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vLi4vZnJvbnRlbmQvc3RhdGljL2xvZ28ucG5nJyksXHJcbiAgICAgICAgICBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vLi4vZnJvbnRlbmQvc3RhdGljL2FwcC1pY29uLnBuZycpLFxyXG4gICAgICAgICAgcGF0aC5qb2luKHByb2Nlc3MucmVzb3VyY2VzUGF0aCwgJ3N0YXRpYycsICdhcHAtaWNvbi5wbmcnKSxcclxuICAgICAgICAgIHBhdGguam9pbihwcm9jZXNzLnJlc291cmNlc1BhdGgsICdmcm9udGVuZCcsICdzdGF0aWMnLCAnbG9nby5wbmcnKSxcclxuICAgICAgICAgIHBhdGguam9pbihhcHAuZ2V0UGF0aCgndXNlckRhdGEnKSwgJ2xvZ28ucG5nJylcclxuICAgICAgICBdXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gQ3JlYXRlIHRoZSB0cmF5IGljb25cclxuICAgICAgdGhpcy50cmF5ID0gbmV3IFRyYXkoaWNvblBhdGgpO1xyXG4gICAgICB0aGlzLnRyYXkuc2V0VG9vbFRpcCgnQ29kZXgubWQgLSBNYXJrZG93biBDb252ZXJ0ZXInKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSBhbmQgc2V0IHRoZSBjb250ZXh0IG1lbnVcclxuICAgICAgdGhpcy51cGRhdGVDb250ZXh0TWVudSgpO1xyXG4gICAgICBcclxuICAgICAgLy8gSGFuZGxlIHRyYXkgZXZlbnRzXHJcbiAgICAgIHRoaXMuc2V0dXBUcmF5RXZlbnRzKCk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZygn4pyFIFRyYXkgc3VjY2Vzc2Z1bGx5IGNyZWF0ZWQnKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNyZWF0aW5nIHRyYXk6JywgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogVXBkYXRlcyB0aGUgdHJheSBjb250ZXh0IG1lbnUgd2l0aCBjdXJyZW50IHJlY2VudCBmaWxlc1xyXG4gICAqL1xyXG4gIHVwZGF0ZUNvbnRleHRNZW51KCkge1xyXG4gICAgY29uc3QgY29udGV4dE1lbnUgPSBNZW51LmJ1aWxkRnJvbVRlbXBsYXRlKFtcclxuICAgICAge1xyXG4gICAgICAgIGxhYmVsOiAnU2hvdyBjb2RleC5tZCcsXHJcbiAgICAgICAgY2xpY2s6ICgpID0+IHRoaXMuc2hvd1dpbmRvdygpXHJcbiAgICAgIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBsYWJlbDogJ1JlY2VudCBGaWxlcycsXHJcbiAgICAgICAgc3VibWVudTogdGhpcy5idWlsZFJlY2VudEZpbGVzU3VibWVudSgpXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgdHlwZTogJ3NlcGFyYXRvcicgfSxcclxuICAgICAge1xyXG4gICAgICAgIGxhYmVsOiAnUXVpY2sgQ29udmVydCcsXHJcbiAgICAgICAgY2xpY2s6ICgpID0+IHRoaXMuc2hvd0ZpbGVEaWFsb2coKVxyXG4gICAgICB9LFxyXG4gICAgICB7IHR5cGU6ICdzZXBhcmF0b3InIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBsYWJlbDogJ1NldHRpbmdzJyxcclxuICAgICAgICBjbGljazogKCkgPT4gdGhpcy5vcGVuU2V0dGluZ3MoKVxyXG4gICAgICB9LFxyXG4gICAgICB7IHR5cGU6ICdzZXBhcmF0b3InIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBsYWJlbDogJ1F1aXQnLFxyXG4gICAgICAgIGNsaWNrOiAoKSA9PiBhcHAucXVpdCgpXHJcbiAgICAgIH1cclxuICAgIF0pO1xyXG4gICAgXHJcbiAgICB0aGlzLnRyYXkuc2V0Q29udGV4dE1lbnUoY29udGV4dE1lbnUpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQnVpbGRzIHRoZSBzdWJtZW51IGZvciByZWNlbnQgZmlsZXNcclxuICAgKiBAcmV0dXJucyB7RWxlY3Ryb24uTWVudUl0ZW1Db25zdHJ1Y3Rvck9wdGlvbnNbXX0gTWVudSBpdGVtcyBmb3IgcmVjZW50IGZpbGVzXHJcbiAgICovXHJcbiAgYnVpbGRSZWNlbnRGaWxlc1N1Ym1lbnUoKSB7XHJcbiAgICBpZiAoIXRoaXMucmVjZW50RmlsZXMgfHwgdGhpcy5yZWNlbnRGaWxlcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgcmV0dXJuIFt7IGxhYmVsOiAnTm8gcmVjZW50IGZpbGVzJywgZW5hYmxlZDogZmFsc2UgfV07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIENyZWF0ZSBtZW51IGl0ZW1zIGZvciBlYWNoIHJlY2VudCBmaWxlIChtYXggMTApXHJcbiAgICBjb25zdCByZWNlbnRJdGVtcyA9IHRoaXMucmVjZW50RmlsZXMuc2xpY2UoMCwgMTApLm1hcChmaWxlID0+ICh7XHJcbiAgICAgIGxhYmVsOiBwYXRoLmJhc2VuYW1lKGZpbGUpLFxyXG4gICAgICBjbGljazogKCkgPT4gdGhpcy5vcGVuRmlsZShmaWxlKVxyXG4gICAgfSkpO1xyXG4gICAgXHJcbiAgICAvLyBBZGQgYSBjbGVhciBvcHRpb24gYXQgdGhlIGJvdHRvbVxyXG4gICAgcmVjZW50SXRlbXMucHVzaCh7IHR5cGU6ICdzZXBhcmF0b3InIH0pO1xyXG4gICAgcmVjZW50SXRlbXMucHVzaCh7XHJcbiAgICAgIGxhYmVsOiAnQ2xlYXIgUmVjZW50IEZpbGVzJyxcclxuICAgICAgY2xpY2s6ICgpID0+IHRoaXMuY2xlYXJSZWNlbnRGaWxlcygpXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHJlY2VudEl0ZW1zO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2V0cyB1cCBldmVudCBoYW5kbGVycyBmb3IgdGhlIHRyYXkgaWNvblxyXG4gICAqL1xyXG4gIHNldHVwVHJheUV2ZW50cygpIHtcclxuICAgIC8vIFBsYXRmb3JtLXNwZWNpZmljIGJlaGF2aW9yc1xyXG4gICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XHJcbiAgICAgIC8vIE9uIG1hY09TLCBjbGlja2luZyB0aGUgdHJheSBpY29uIHNob3dzIHRoZSB3aW5kb3dcclxuICAgICAgdGhpcy50cmF5Lm9uKCdjbGljaycsICgpID0+IHRoaXMuc2hvd1dpbmRvdygpKTtcclxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xyXG4gICAgICAvLyBPbiBXaW5kb3dzLCBkb3VibGUtY2xpY2tpbmcgdGhlIHRyYXkgaWNvbiBzaG93cyB0aGUgd2luZG93XHJcbiAgICAgIHRoaXMudHJheS5vbignZG91YmxlLWNsaWNrJywgKCkgPT4gdGhpcy5zaG93V2luZG93KCkpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2hvd3MgdGhlIG1haW4gYXBwbGljYXRpb24gd2luZG93XHJcbiAgICovXHJcbiAgc2hvd1dpbmRvdygpIHtcclxuICAgIGlmICh0aGlzLndpbmRvdy5pc01pbmltaXplZCgpKSB7XHJcbiAgICAgIHRoaXMud2luZG93LnJlc3RvcmUoKTtcclxuICAgIH1cclxuICAgIHRoaXMud2luZG93LnNob3coKTtcclxuICAgIHRoaXMud2luZG93LmZvY3VzKCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTaG93cyBhIGZpbGUgZGlhbG9nIGZvciBxdWljayBjb252ZXJzaW9uXHJcbiAgICovXHJcbiAgc2hvd0ZpbGVEaWFsb2coKSB7XHJcbiAgICBkaWFsb2cuc2hvd09wZW5EaWFsb2codGhpcy53aW5kb3csIHtcclxuICAgICAgcHJvcGVydGllczogWydvcGVuRmlsZScsICdtdWx0aVNlbGVjdGlvbnMnXSxcclxuICAgICAgZmlsdGVyczogW1xyXG4gICAgICAgIHsgbmFtZTogJ0RvY3VtZW50cycsIGV4dGVuc2lvbnM6IFsncGRmJywgJ2RvY3gnLCAncHB0eCcsICd4bHN4JywgJ2NzdiddIH0sXHJcbiAgICAgICAgeyBuYW1lOiAnTWVkaWEnLCBleHRlbnNpb25zOiBbJ21wMycsICdtcDQnLCAnd2F2JywgJ2F2aScsICdtb3YnXSB9LFxyXG4gICAgICAgIHsgbmFtZTogJ0FsbCBGaWxlcycsIGV4dGVuc2lvbnM6IFsnKiddIH1cclxuICAgICAgXVxyXG4gICAgfSkudGhlbihyZXN1bHQgPT4ge1xyXG4gICAgICBpZiAoIXJlc3VsdC5jYW5jZWxlZCAmJiByZXN1bHQuZmlsZVBhdGhzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICB0aGlzLmFkZFRvUmVjZW50RmlsZXMocmVzdWx0LmZpbGVQYXRocyk7XHJcbiAgICAgICAgdGhpcy5zaG93V2luZG93KCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gU2VuZCB0aGUgc2VsZWN0ZWQgZmlsZXMgdG8gdGhlIHJlbmRlcmVyIHByb2Nlc3NcclxuICAgICAgICB0aGlzLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdjb2RleDpmaWxlcy1zZWxlY3RlZCcsIHJlc3VsdC5maWxlUGF0aHMpO1xyXG4gICAgICB9XHJcbiAgICB9KS5jYXRjaChlcnIgPT4ge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzaG93aW5nIGZpbGUgZGlhbG9nOicsIGVycik7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIE9wZW5zIGEgZmlsZSB3aXRoIHRoZSBkZWZhdWx0IGFwcGxpY2F0aW9uXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgZmlsZSB0byBvcGVuXHJcbiAgICovXHJcbiAgb3BlbkZpbGUoZmlsZVBhdGgpIHtcclxuICAgIHNoZWxsLm9wZW5QYXRoKGZpbGVQYXRoKS50aGVuKGVycm9yID0+IHtcclxuICAgICAgaWYgKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igb3BlbmluZyBmaWxlOicsIGVycm9yKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBPcGVucyB0aGUgc2V0dGluZ3MgcGFnZVxyXG4gICAqL1xyXG4gIG9wZW5TZXR0aW5ncygpIHtcclxuICAgIHRoaXMuc2hvd1dpbmRvdygpO1xyXG4gICAgdGhpcy53aW5kb3cud2ViQ29udGVudHMuc2VuZCgnY29kZXg6b3Blbi1zZXR0aW5ncycpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQWRkcyBmaWxlcyB0byB0aGUgcmVjZW50IGZpbGVzIGxpc3RcclxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBmaWxlUGF0aHMgLSBQYXRocyB0byBhZGQgdG8gcmVjZW50IGZpbGVzXHJcbiAgICovXHJcbiAgYWRkVG9SZWNlbnRGaWxlcyhmaWxlUGF0aHMpIHtcclxuICAgIC8vIEFkZCBuZXcgZmlsZXMgdG8gdGhlIGJlZ2lubmluZyBvZiB0aGUgbGlzdFxyXG4gICAgY29uc3QgbmV3UmVjZW50RmlsZXMgPSBbLi4uZmlsZVBhdGhzXTtcclxuICAgIFxyXG4gICAgLy8gQWRkIGV4aXN0aW5nIGZpbGVzIHRoYXQgYXJlbid0IGR1cGxpY2F0ZXNcclxuICAgIGZvciAoY29uc3QgZmlsZSBvZiB0aGlzLnJlY2VudEZpbGVzKSB7XHJcbiAgICAgIGlmICghbmV3UmVjZW50RmlsZXMuaW5jbHVkZXMoZmlsZSkpIHtcclxuICAgICAgICBuZXdSZWNlbnRGaWxlcy5wdXNoKGZpbGUpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIExpbWl0IHRvIDIwIHJlY2VudCBmaWxlc1xyXG4gICAgdGhpcy5yZWNlbnRGaWxlcyA9IG5ld1JlY2VudEZpbGVzLnNsaWNlKDAsIDIwKTtcclxuICAgIFxyXG4gICAgLy8gVXBkYXRlIHRoZSBzdG9yZSBhbmQgY29udGV4dCBtZW51XHJcbiAgICB0aGlzLnN0b3JlLnNldCgncmVjZW50RmlsZXMnLCB0aGlzLnJlY2VudEZpbGVzKTtcclxuICAgIHRoaXMudXBkYXRlQ29udGV4dE1lbnUoKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENsZWFycyB0aGUgcmVjZW50IGZpbGVzIGxpc3RcclxuICAgKi9cclxuICBjbGVhclJlY2VudEZpbGVzKCkge1xyXG4gICAgdGhpcy5yZWNlbnRGaWxlcyA9IFtdO1xyXG4gICAgdGhpcy5zdG9yZS5zZXQoJ3JlY2VudEZpbGVzJywgW10pO1xyXG4gICAgdGhpcy51cGRhdGVDb250ZXh0TWVudSgpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRGVzdHJveXMgdGhlIHRyYXkgaWNvbiB3aGVuIHRoZSBhcHAgaXMgcXVpdHRpbmdcclxuICAgKi9cclxuICBkZXN0cm95KCkge1xyXG4gICAgaWYgKHRoaXMudHJheSkge1xyXG4gICAgICB0aGlzLnRyYXkuZGVzdHJveSgpO1xyXG4gICAgICB0aGlzLnRyYXkgPSBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBUcmF5TWFuYWdlcjsiXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNO0VBQUVBLEdBQUc7RUFBRUMsSUFBSTtFQUFFQyxJQUFJO0VBQUVDLFFBQVE7RUFBRUMsTUFBTTtFQUFFQztBQUFNLENBQUMsR0FBR0MsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUN4RSxNQUFNQyxJQUFJLEdBQUdELE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTTtFQUFFRTtBQUFZLENBQUMsR0FBR0YsT0FBTyxDQUFDLHVCQUF1QixDQUFDO0FBQ3hELE1BQU07RUFBRUc7QUFBcUIsQ0FBQyxHQUFHSCxPQUFPLENBQUMsd0JBQXdCLENBQUM7O0FBRWxFO0FBQ0E7QUFDQTtBQUNBLE1BQU1JLFdBQVcsQ0FBQztFQUNoQjtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VDLFdBQVdBLENBQUNDLFVBQVUsRUFBRUMsS0FBSyxFQUFFO0lBQzdCLElBQUksQ0FBQ0MsTUFBTSxHQUFHRixVQUFVO0lBQ3hCLElBQUksQ0FBQ0MsS0FBSyxHQUFHQSxLQUFLLElBQUlMLFdBQVcsQ0FBQyxjQUFjLENBQUM7SUFDakQsSUFBSSxDQUFDTyxJQUFJLEdBQUcsSUFBSTtJQUNoQixJQUFJLENBQUNDLFdBQVcsR0FBRyxJQUFJLENBQUNILEtBQUssQ0FBQ0ksR0FBRyxDQUFDLGFBQWEsRUFB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