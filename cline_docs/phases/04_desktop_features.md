# Desktop Features Phase

## System Tray Integration
> "On MacOS and Ubuntu, the Tray will be located on the top right corner of your screen, adjacent to your battery and wifi icons. On Windows, the Tray will usually be located in the bottom right corner." - [Tray Documentation]

1. **Tray Setup (electron/features/tray.js)**
   ```javascript
   const { app, Tray, Menu, nativeImage } = require('electron');
   const path = require('path');

   class TrayManager {
     constructor(mainWindow) {
       this.window = mainWindow;
       this.createTray();
     }

     createTray() {
       // Create tray icon as recommended in docs
       const icon = nativeImage.createFromPath(
         path.join(__dirname, '../assets/tray-icon.png')
       );
       this.tray = new Tray(icon);

       const contextMenu = Menu.buildFromTemplate([
         {
           label: 'Show mdCode',
           click: () => this.window.show()
         },
         {
           label: 'Recent Files',
           submenu: [] // Dynamically populated
         },
         { type: 'separator' },
         {
           label: 'Quick Convert',
           click: () => this.showFileDialog()
         },
         { type: 'separator' },
         {
           label: 'Quit',
           click: () => app.quit()
         }
       ]);

       this.tray.setContextMenu(contextMenu);
       this.tray.setToolTip('mdCode - Markdown Converter');
     }

     updateRecentFiles(files) {
       const menu = this.tray.getContextMenu();
       const recentSubmenu = menu.items[1].submenu;
       recentSubmenu.clear();

       files.forEach(file => {
         recentSubmenu.append(new MenuItem({
           label: path.basename(file),
           click: () => this.openFile(file)
         }));
       });
     }
   }
   ```

## Notifications
> "Each operating system has its own mechanism to display notifications to users. Electron's notification APIs are cross-platform, but are different for each process type." - [Notifications Documentation]

1. **Notification Manager (electron/features/notifications.js)**
   ```javascript
   const { Notification } = require('electron');

   class NotificationManager {
     showConversionComplete(filePath) {
       // Following Notifications documentation pattern
       new Notification({
         title: 'Conversion Complete',
         body: `Successfully converted ${path.basename(filePath)}`,
         icon: path.join(__dirname, '../assets/success-icon.png')
       }).show();
     }

     showError(error) {
       new Notification({
         title: 'Conversion Error',
         body: error.message,
         icon: path.join(__dirname, '../assets/error-icon.png')
       }).show();
     }

     // Platform-specific setup as per docs
     setupPlatformSpecific() {
       if (process.platform === 'win32') {
         app.setAppUserModelId(process.execPath);
       }
     }
   }
   ```

## Desktop Shortcuts
> "On many Linux environments, you can add custom entries to the system launcher by modifying the .desktop file." - [Desktop Launcher Actions Documentation]

1. **Desktop Integration (electron/features/desktop-integration.js)**
   ```javascript
   // Platform-specific desktop integration
   class DesktopIntegration {
     setupLinuxActions() {
       if (process.platform === 'linux') {
         const template = `[Desktop Entry]
           Actions=NewConversion;OpenRecent
           
           [Desktop Action NewConversion]
           Name=New Conversion
           Exec=electron ${process.execPath} --new-conversion
           
           [Desktop Action OpenRecent]
           Name=Open Recent
           Exec=electron ${process.execPath} --open-recent`;
           
         // Save to appropriate location
         fs.writeFileSync('/path/to/mdcode.desktop', template);
       }
     }

     handleArguments(argv) {
       if (argv.includes('--new-conversion')) {
         this.showFileDialog();
       } else if (argv.includes('--open-recent')) {
         this.showRecentFiles();
       }
     }
   }
   ```

## Native File Association
```javascript
// electron/features/file-association.js
class FileAssociation {
  setupAssociations() {
    // Register file types
    app.setAsDefaultProtocolClient('mdcode');
    
    if (process.platform === 'win32') {
      app.setAssociationHandler({
        extensions: ['md', 'markdown'],
        name: 'Markdown File',
        description: 'Markdown Document'
      });
    }

    // Handle file open events
    app.on('open-file', (event, path) => {
      event.preventDefault();
      this.handleFile(path);
    });
  }
}
```

## Platform-Specific Features

1. **Windows Integration**
   ```javascript
   // electron/platforms/windows.js
   class WindowsIntegration {
     constructor() {
       this.setupJumpList();
       this.setupTaskbar();
     }

     setupJumpList() {
       app.setJumpList([
         {
           type: 'custom',
           name: 'Recent Files',
           items: [] // Dynamically populated
         },
         {
           type: 'tasks',
           items: [
             {
               program: process.execPath,
               arguments: '--new-conversion',
               title: 'New Conversion',
               description: 'Start a new file conversion'
             }
           ]
         }
       ]);
     }
   }
   ```

2. **macOS Integration**
   ```javascript
   // electron/platforms/macos.js
   class MacOSIntegration {
     constructor() {
       this.setupDockMenu();
       this.setupTouchBar();
     }

     setupDockMenu() {
       const dockMenu = Menu.buildFromTemplate([
         {
           label: 'New Conversion',
           click: () => this.showFileDialog()
         }
       ]);
       
       app.dock.setMenu(dockMenu);
     }
   }
   ```

## Auto-Updates Implementation
```javascript
// electron/features/auto-updater.js
const { autoUpdater } = require('electron-updater');

class UpdateManager {
  constructor() {
    autoUpdater.logger = require('electron-log');
    autoUpdater.logger.transports.file.level = 'info';
    
    autoUpdater.on('update-available', this.handleUpdateAvailable);
    autoUpdater.on('update-downloaded', this.handleUpdateDownloaded);
    
    // Check for updates every hour
    setInterval(() => {
      autoUpdater.checkForUpdates();
    }, 60 * 60 * 1000);
  }

  handleUpdateAvailable(info) {
    new Notification({
      title: 'Update Available',
      body: `Version ${info.version} is available to download`
    }).show();
  }

  handleUpdateDownloaded(info) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'Install and restart now?',
      buttons: ['Yes', 'Later']
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  }
}
```

## Feature Integration

1. **Initialize Desktop Features (electron/main.js)**
   ```javascript
   function initializeDesktopFeatures(window) {
     const managers = {
       tray: new TrayManager(window),
       notifications: new NotificationManager(),
       updates: new UpdateManager(),
       desktop: new DesktopIntegration(),
       fileAssoc: new FileAssociation()
     };

     // Platform-specific initialization
     if (process.platform === 'win32') {
       managers.windows = new WindowsIntegration();
     } else if (process.platform === 'darwin') {
       managers.macos = new MacOSIntegration();
     }

     return managers;
   }
   ```

## Testing Guidelines

1. **Platform Testing**
   - Test notifications on all platforms
   - Verify tray integration
   - Check file associations
   - Test auto-updates
   - Validate platform-specific features

2. **Integration Testing**
   - Test startup performance
   - Verify offline capabilities
   - Check memory usage
   - Test system integration features

## Deployment Checklist

1. **Windows**
   - [ ] AppUserModelId configuration
   - [ ] Start menu shortcuts
   - [ ] File associations
   - [ ] Jump lists

2. **macOS**
   - [ ] App signing
   - [ ] Dock integration
   - [ ] Touch bar support
   - [ ] Notifications permissions

3. **Linux**
   - [ ] .desktop file configuration
   - [ ] Icon integration
   - [ ] Launcher actions
   - [ ] File associations

## Important Notes
- Follow platform-specific guidelines
- Test thoroughly on all target platforms
- Handle platform differences gracefully
- Consider accessibility features
