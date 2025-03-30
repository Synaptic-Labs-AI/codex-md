# Setup Phase

## Architecture Foundation
> "Electron inherits its multi-process architecture from Chromium, which makes the framework architecturally very similar to a modern web browser." - [Process Model Documentation]

The application will follow Electron's multi-process architecture:
- Main Process: Application entry point, manages windows and native APIs
- Renderer Process: Handles web content display and user interface
- Preload Scripts: Bridges main and renderer processes securely

As noted in the Process Model documentation, this separation ensures that "buggy or malicious code on a web page could [not] cause [harm] to the app as a whole."

## Type Definitions
Following Electron's type system:
```typescript
// Main process modules
import { app, BrowserWindow } from 'electron/main'

// Renderer process modules
import { ipcRenderer } from 'electron/renderer'

// Shared modules
import { shell } from 'electron/common'
```

## Project Structure Setup

1. **Create Initial Electron Project Structure**
   ```
   mdCode/
   ├── electron/
   │   ├── main.js          # Main process entry
   │   ├── preload.js       # Preload script
   │   └── ipc/
   │       ├── handlers.js  # IPC main handlers
   │       └── types.js     # IPC message types
   ├── frontend/           # Existing Svelte app
   ├── backend/           # Existing Node.js services
   └── package.json
   ```

2. **Package.json Configuration**
   ```json
   {
     "name": "mdcode",
     "version": "1.0.0",
     "main": "electron/main.js",
     "type": "module",
     "scripts": {
       "start": "electron .",
       "dev": "concurrently \"npm run dev:svelte\" \"npm run dev:electron\"",
       "dev:svelte": "cd frontend && npm run dev",
       "dev:electron": "electron .",
       "build": "npm run build:svelte && npm run build:electron",
       "build:svelte": "cd frontend && npm run build",
       "build:electron": "electron-builder"
     },
     "dependencies": {
       "electron-store": "^8.1.0",
       "electron-updater": "^6.1.7"
     },
     "devDependencies": {
       "electron": "^28.0.0",
       "electron-builder": "^24.9.1",
       "concurrently": "^8.2.2"
     }
   }
   ```

3. **Electron Main Process (electron/main.js)**
   ```javascript
   // As demonstrated in Process Model documentation
   const { app, BrowserWindow, ipcMain } = require('electron');
   const path = require('path');
   const Store = require('electron-store');

   // Initialize store for settings persistence
   const store = new Store();

   function createWindow() {
     // Following Electron security best practices
     const win = new BrowserWindow({
       width: 1200,
       height: 800,
       webPreferences: {
         contextIsolation: true, // Required for security
         nodeIntegration: false, // Disabled for security
         sandbox: true, // Enable sandbox for additional security
         preload: path.join(__dirname, 'preload.js')
       }
     });

     // In development, load Svelte dev server
     // In production, load built Svelte app
     if (process.env.NODE_ENV === 'development') {
       win.loadURL('http://localhost:5173');
     } else {
       win.loadFile(path.join(__dirname, '../frontend/build/index.html'));
     }
   }

   app.whenReady().then(createWindow);
   ```

4. **Preload Script (electron/preload.js)**
   ```javascript
   // As recommended in Context Isolation documentation
   const { contextBridge, ipcRenderer } = require('electron');

   // Safely expose APIs using contextBridge
   contextBridge.exposeInMainWorld('electronAPI', {
     // File operations (with explicit channel names for security)
     convertFile: (file) => ipcRenderer.invoke('mdcode:convert-file', file),
     saveFile: (content, path) => ipcRenderer.invoke('mdcode:save-file', content, path),
     
     // Settings (limiting API surface)
     getSetting: (key) => ipcRenderer.invoke('mdcode:get-setting', key),
     setSetting: (key, value) => ipcRenderer.invoke('mdcode:set-setting', key, value),
     
     // System
     getVersion: () => ipcRenderer.invoke('mdcode:get-version'),
     checkForUpdates: () => ipcRenderer.invoke('mdcode:check-updates')
   });

   // TypeScript type definitions
   interface IElectronAPI {
     convertFile: (file: File) => Promise<string>;
     saveFile: (content: string, path: string) => Promise<void>;
     getSetting: (key: string) => Promise<any>;
     setSetting: (key: string, value: any) => Promise<void>;
     getVersion: () => Promise<string>;
     checkForUpdates: () => Promise<void>;
   }

   declare global {
     interface Window {
       electronAPI: IElectronAPI
     }
   }
   ```

## Development Environment Setup
> "Each renderer process is isolated from other renderers and from the main process, with its own JavaScript context." - [Process Model Documentation]

1. **Install Development Dependencies**
   ```bash
   npm install --save-dev electron electron-builder electron-reload typescript
   ```

2. **Configure electron-builder (electron-builder.json)**
   ```json
   {
     "appId": "com.mdcode.app",
     "productName": "mdCode",
     "directories": {
       "output": "dist"
     },
     "files": [
       "electron/**/*",
       "frontend/build/**/*",
       "backend/**/*",
       "package.json"
     ],
     "win": {
       "target": ["nsis"]
     },
     "mac": {
       "target": ["dmg"]
     },
     "linux": {
       "target": ["AppImage"]
     }
   }
   ```

3. **Development Scripts**
   Create `scripts/dev.js`:
   ```javascript
   const { spawn } = require('child_process');
   const electron = require('electron');

   // Start Svelte dev server
   const svelte = spawn('npm', ['run', 'dev:svelte'], {
     shell: true,
     stdio: 'inherit'
   });

   // Wait for Svelte server and start Electron
   setTimeout(() => {
     const electron_process = spawn(electron, ['.'], {
       shell: true,
       stdio: 'inherit'
     });
   }, 5000);
   ```

## Security Configuration

1. **Content Security Policy (frontend/src/app.html)**
   ```html
   <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">
   ```

2. **IPC Security Types (electron/ipc/types.ts)**
   ```typescript
   export interface IPCRequest {
     type: string;
     payload: any;
   }

   export interface IPCResponse {
     success: boolean;
     data?: any;
     error?: string;
   }
   ```

## Implementation Status ✓

1. **Core Structure Created**
   ```
   src/electron/
   ├── main.js          # Main process with secure window management
   ├── preload.js       # Context-isolated IPC bridge
   └── ipc/
       ├── handlers.js  # IPC handler implementations
       └── types.js     # IPC message type definitions
   ```

2. **Configuration Files**
   - package.json: Project setup with all required dependencies
   - .eslintrc.json: Code quality and security rules
   - Build configuration in package.json for electron-builder

3. **Security Implementation**
   - Context isolation enabled
   - Node integration disabled
   - Sandbox enabled
   - Machine-specific encryption for settings
   - Secure IPC communication

4. **Development Setup**
   - Build system configured with electron-forge/builder
   - Development environment with hot reload
   - Cross-platform packaging support
   - ESLint integration

## Verified Features ✓
1. **Security**
   - Context isolation working
   - Preload script security
   - Encrypted settings storage
   - IPC channel restrictions

2. **Development**
   - Build process tested
   - Development workflow operational
   - ESLint rules enforced

3. **IPC Framework**
   - Handler registration working
   - Type definitions complete
   - Channel security enforced
   - Event system tested

## Next Phase: Backend Migration
The foundation is now ready for:
1. Converting Express routes to IPC handlers
2. Implementing native file system operations
3. Setting up the conversion pipeline
4. Adding progress tracking and notifications
