/**
 * System Tray Integration for the Electron application.
 * Provides tray icon, context menu, and recent files functionality.
 * 
 * Related files:
 * - main.js: Main process entry point
 * - frontend/static/logo.png: Application tray icon
 */

const { app, Tray, Menu, MenuItem, dialog, shell } = require('electron');
const path = require('path');
const { createStore } = require('../utils/storeFactory');

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
      this.tray.setToolTip('mdCode - Markdown Converter');
      
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
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show mdCode',
        click: () => this.showWindow()
      },
      {
        label: 'Recent Files',
        submenu: this.buildRecentFilesSubmenu()
      },
      { type: 'separator' },
      {
        label: 'Quick Convert',
        click: () => this.showFileDialog()
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => this.openSettings()
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit()
      }
    ]);
    
    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Builds the submenu for recent files
   * @returns {Electron.MenuItemConstructorOptions[]} Menu items for recent files
   */
  buildRecentFilesSubmenu() {
    if (!this.recentFiles || this.recentFiles.length === 0) {
      return [{ label: 'No recent files', enabled: false }];
    }
    
    // Create menu items for each recent file (max 10)
    const recentItems = this.recentFiles.slice(0, 10).map(file => ({
      label: path.basename(file),
      click: () => this.openFile(file)
    }));
    
    // Add a clear option at the bottom
    recentItems.push({ type: 'separator' });
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
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'pptx', 'xlsx', 'csv'] },
        { name: 'Media', extensions: ['mp3', 'mp4', 'wav', 'avi', 'mov'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }).then(result => {
      if (!result.canceled && result.filePaths.length > 0) {
        this.addToRecentFiles(result.filePaths);
        this.showWindow();
        
        // Send the selected files to the renderer process
        this.window.webContents.send('mdcode:files-selected', result.filePaths);
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
    this.window.webContents.send('mdcode:open-settings');
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
