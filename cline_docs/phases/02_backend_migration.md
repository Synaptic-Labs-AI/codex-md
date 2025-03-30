# Backend Migration Phase

> "Inter-process communication (IPC) is a key part of building feature-rich desktop applications in Electron. Because the main and renderer processes have different responsibilities in Electron's process model, IPC is the only way to perform many common tasks." - [Inter-Process Communication Documentation]

## Converting Express Routes to IPC
> "Processes communicate by passing messages through developer-defined 'channels' with the ipcMain and ipcRenderer modules. These channels are arbitrary (you can name them anything you want) and bidirectional." - [Inter-Process Communication Documentation]

1. **IPC Handler Structure**
   ```
   electron/ipc/handlers/
   ├── conversion/
   │   ├── documentHandlers.js    # Document conversion handlers
   │   ├── webHandlers.js        # Web content handlers
   │   └── mediaHandlers.js      # Media conversion handlers
   ├── system/
   │   ├── fileSystem.js         # Native file system operations
   │   └── settings.js           # App settings management
   └── index.js                  # Handler registration

   // Handler Naming Convention
   mdcode:convert:*    # Conversion operations
   mdcode:fs:*        # File system operations
   mdcode:settings:*  # Settings management
   ```

2. **Convert ConversionController (backend/src/routes/controllers/ConversionController.js)**
   
   Original Express route:
   ```javascript
   router.post('/convert', upload.single('file'), async (req, res) => {
     // Express handler
   });
   ```
   
   New IPC handler (electron/ipc/handlers/conversion/documentHandlers.js):
   ```javascript
   // Implementing the invoke pattern as recommended in Electron docs
   const { ipcMain } = require('electron');
   const { convertDocument } = require('../../../../backend/src/services/ConversionService');

   // Secure IPC handler with input validation
   ipcMain.handle('mdcode:convert:document', async (event, filePath) => {
     try {
       // Validate input
       if (!filePath || typeof filePath !== 'string') {
         throw new Error('Invalid file path');
       }

       // Perform conversion
       const result = await convertDocument(filePath);
       
       // Return standardized response
       return { 
         success: true, 
         data: result,
         timestamp: Date.now()
       };
     } catch (error) {
       console.error('Document conversion error:', error);
       return { 
         success: false, 
         error: error.message,
         code: error.code || 'CONVERSION_ERROR'
       };
     }
   });
   ```

3. **File System Access (electron/ipc/handlers/system/fileSystem.js)**
   ```javascript
   const { ipcMain, dialog } = require('electron');
   const fs = require('fs/promises');
   const path = require('path');
   const { sanitizePath } = require('../utils/security');

   // File system handlers using recommended patterns
   class FileSystemHandlers {
     constructor() {
       // Register handlers with explicit naming
       ipcMain.handle('mdcode:fs:select', this.handleFileSelect.bind(this));
       ipcMain.handle('mdcode:fs:save', this.handleFileSave.bind(this));
       ipcMain.handle('mdcode:fs:read', this.handleFileRead.bind(this));
     }

     async handleFileSelect() {
       const result = await dialog.showOpenDialog({
         properties: ['openFile', 'multiSelections'],
         filters: [
           { name: 'Documents', extensions: ['pdf', 'docx', 'pptx', 'xlsx'] },
           { name: 'All Files', extensions: ['*'] }
         ]
       });
       return result.filePaths;
     }

     async handleFileSave(event, { content, defaultPath }) {
       try {
         // Validate input
         if (!content || typeof defaultPath !== 'string') {
           throw new Error('Invalid save parameters');
         }

         const safeDefaultPath = sanitizePath(defaultPath);
         const result = await dialog.showSaveDialog({
           defaultPath: safeDefaultPath,
           filters: [{ name: 'Markdown', extensions: ['md'] }]
         });

         if (!result.canceled) {
           await fs.writeFile(result.filePath, content, { encoding: 'utf8' });
           return { success: true, path: result.filePath };
         }
         return { success: false, reason: 'USER_CANCELLED' };
       } catch (error) {
         console.error('File save error:', error);
         return { success: false, error: error.message };
       }
     }

     async handleFileRead(event, filePath) {
       try {
         const safePath = sanitizePath(filePath);
         const content = await fs.readFile(safePath, 'utf8');
         return { success: true, content };
       } catch (error) {
         console.error('File read error:', error);
         return { success: false, error: error.message };
       }
     }
   }
   ```

## Adapting Services

1. **Update ConversionService (backend/src/services/ConversionService.js)**
   ```javascript
   // Before: Web-based file handling
   const handleFileUpload = async (file) => {
     const tempPath = path.join(os.tmpdir(), file.originalname);
     await fs.writeFile(tempPath, file.buffer);
     // Process file...
   };

   // After: Direct file system access
   const handleLocalFile = async (filePath) => {
     // Process file directly from path...
     const result = await processFile(filePath);
     return result;
   };
   ```

2. **Job Manager Updates (electron/services/JobManager.js)**
   ```javascript
   const { BrowserWindow } = require('electron');
   
   class JobManager {
     constructor() {
       this.jobs = new Map();
     }

     addJob(id, total) {
       this.jobs.set(id, { 
         progress: 0, 
         total,
         window: BrowserWindow.getFocusedWindow()
       });
     }

     updateProgress(id, progress) {
       const job = this.jobs.get(id);
       if (job) {
         job.progress = progress;
         job.window.webContents.send('conversion-progress', {
           id,
           progress,
           total: job.total
         });
       }
     }
   }
   ```

3. **Youtube Converter Adaptation (backend/src/services/converter/web/youtubeConverter.js)**
   ```javascript
   class YoutubeConverter {
     async convert(url) {
       // Check online status
       if (!navigator.onLine) {
         throw new Error('Internet connection required for YouTube conversion');
       }
       
       // Existing conversion logic...
     }
   }
   ```

## Error Handling
> "A word on error handling: Errors thrown through handle in the main process are not transparent as they are serialized and only the message property from the original error is provided to the renderer process." - [IPC Documentation]

1. **IPC Error Handler (electron/ipc/errorHandler.js)**
   ```javascript
   const { dialog } = require('electron');

   function handleError(error, window) {
     dialog.showErrorBox('Error', error.message);
     window.webContents.send('conversion-error', {
       message: error.message,
       code: error.code
     });
   }

   process.on('uncaughtException', (error) => {
     const window = BrowserWindow.getFocusedWindow();
     if (window) handleError(error, window);
   });
   ```

2. **Type Definitions (electron/ipc/types.ts)**
   ```typescript
   // Following Electron's documentation on type safety
   export interface ConversionError {
     code: string;
     message: string;
     details?: Record<string, unknown>;
     timestamp: number;
   }

   export interface ConversionProgress {
     jobId: string;
     current: number;
     total: number;
     status: 'processing' | 'completed' | 'error';
     file: {
       name: string;
       size: number;
       type: string;
     };
   }

   // Type-safe IPC channel names
   export const IpcChannels = {
     Conversion: {
       START: 'mdcode:convert:start',
       PROGRESS: 'mdcode:convert:progress',
       COMPLETE: 'mdcode:convert:complete',
       ERROR: 'mdcode:convert:error'
     },
     FileSystem: {
       SELECT: 'mdcode:fs:select',
       SAVE: 'mdcode:fs:save',
       READ: 'mdcode:fs:read'
     }
   } as const;
   ```

## File System Integration

1. **File Watcher Setup (electron/services/FileWatcher.js)**
   ```javascript
   const chokidar = require('chokidar');
   const { BrowserWindow } = require('electron');

   class FileWatcher {
     constructor(paths) {
       this.watcher = chokidar.watch(paths, {
         ignored: /(^|[\/\\])\../,
         persistent: true
       });

       this.watcher
         .on('add', path => this.handleFileAdd(path))
         .on('change', path => this.handleFileChange(path));
     }

     handleFileAdd(path) {
       const window = BrowserWindow.getFocusedWindow();
       if (window) {
         window.webContents.send('file-added', { path });
       }
     }

     handleFileChange(path) {
       const window = BrowserWindow.getFocusedWindow();
       if (window) {
         window.webContents.send('file-changed', { path });
       }
     }
   }
   ```

## Testing Guidelines
> "Each renderer process is isolated from other renderers and from the main process, with its own JavaScript context." - [Process Model Documentation]

1. **Unit Tests**
   - Update test files to use IPC mocking
   - Test file system operations
   - Verify error handling
   - Check progress reporting

2. **Integration Tests**
   - Test complete conversion flow
   - Verify file watching
   - Test offline behavior
   - Check memory usage

## Next Steps
1. Verify all services are properly migrated
2. Test error handling across processes
3. Implement file watching
4. Add offline support for local operations

## Important Notes
- Keep file paths consistent across platforms
- Handle large files efficiently
- Implement proper cleanup for temporary files
- Consider resource management for concurrent operations
