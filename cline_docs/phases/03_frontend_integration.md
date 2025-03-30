# Frontend Integration Phase

> "Context Isolation is a feature that ensures that both your preload scripts and Electron's internal logic run in a separate context to the website you load in a webContents." - [Context Isolation Documentation]

## API Communication Updates
> "Just enabling contextIsolation and using contextBridge does not automatically mean that everything you do is safe." - [Context Isolation Documentation]

1. **Secure API Client (frontend/src/lib/api/client.ts)**
   ```typescript
   // Following Context Isolation best practices
   interface IElectronAPI {
     convert: {
       document: (file: File) => Promise<ConversionResult>;
       web: (url: string) => Promise<ConversionResult>;
       media: (file: File) => Promise<ConversionResult>;
     };
     files: {
       save: (content: string, path: string) => Promise<void>;
       select: () => Promise<string[]>;
       watch: (callback: (event: FileEvent) => void) => void;
     };
     settings: {
       get: <T>(key: string) => Promise<T>;
       set: <T>(key: string, value: T) => Promise<void>;
     };
   }

   class ElectronClient {
     private api: IElectronAPI;

     constructor() {
       // Type-safe access to exposed APIs
       this.api = window.electronAPI;
       if (!this.api) {
         throw new Error('Electron API not available');
       }
     }

     // Conversion methods with proper error handling
     async convertDocument(file: File): Promise<ConversionResult> {
       try {
         return await this.api.convert.document(file);
       } catch (error) {
         console.error('Document conversion failed:', error);
         throw new Error(`Conversion failed: ${error.message}`);
       }
     }

     // File system methods with validation
     async saveFile(content: string, path: string): Promise<void> {
       if (!content || !path) {
         throw new Error('Invalid save parameters');
       }
       return this.api.files.save(content, path);
     }

     // Settings methods with type safety
     async getSetting<T>(key: string): Promise<T> {
       return this.api.settings.get<T>(key);
     }
   }
   ```

2. **API Types (frontend/src/lib/api/types.ts)**
   ```typescript
   interface IPCResponse<T> {
     success: boolean;
     data?: T;
     error?: string;
   }

   interface ConversionResult {
     path: string;
     content: string;
     metadata: {
       original: string;
       converted: string;
       timestamp: number;
     };
   }
   ```

## File Handling Components
> "Make sure to limit the renderer's access to Electron APIs as much as possible." - [Context Isolation Documentation]

1. **File Handling Component (frontend/src/lib/components/FileUploader.svelte)**
   ```svelte
   <script lang="ts">
     import { createEventDispatcher } from 'svelte';
     import type { FileEvent } from '../types';
     import { electronAPI } from '../api/client';
     
     const dispatch = createEventDispatcher<{
       files: { files: File[] | string[] };
       error: { message: string };
     }>();

     // Safe drop handling with validation
     async function handleDrop(event: DragEvent) {
       event.preventDefault();
       try {
         if (!event.dataTransfer?.files) {
           throw new Error('No files received');
         }
         
         const files = Array.from(event.dataTransfer.files);
         // Validate file types
         const validFiles = files.filter(file => 
           ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
           .includes(file.type)
         );
         
         if (validFiles.length === 0) {
           throw new Error('No valid files found');
         }
         
         dispatch('files', { files: validFiles });
       } catch (error) {
         dispatch('error', { message: error.message });
       }
     }

     // Use Electron's native dialog
     async function openFileDialog() {
       try {
         const paths = await electronAPI.files.select();
         if (paths && paths.length > 0) {
           dispatch('files', { files: paths });
         }
       } catch (error) {
         dispatch('error', { message: error.message });
       }
     }
   </script>

   <div 
     class="dropzone"
     on:drop={handleDrop}
     on:dragover|preventDefault
     on:dragenter|preventDefault
   >
     <button 
       on:click={openFileDialog}
       class="select-button"
       data-testid="file-select-btn"
     >
       Select Files
     </button>
     <slot name="dropzone-content" />
   </div>
   ```

2. **File List Component (frontend/src/lib/components/file/FileList.svelte)**
   ```svelte
   <script>
     import { onMount } from 'svelte';
     import { files } from '$lib/stores/files';
     
     // Listen for file system events
     onMount(() => {
       window.electron.on('file-added', ({ path }) => {
         files.add(path);
       });
       
       window.electron.on('file-changed', ({ path }) => {
         files.update(path);
       });
     });
   </script>

   {#each $files as file}
     <div class="file-item">
       <span>{file.name}</span>
       <button on:click={() => files.remove(file.path)}>
         Remove
       </button>
     </div>
   {/each}
   ```

## Store Updates
> "Errors thrown through handle in the main process are not transparent as they are serialized." - [Inter-Process Communication Documentation]

1. **Files Store (frontend/src/lib/stores/files.js)**
   ```javascript
   import { writable } from 'svelte/store';

   function createFilesStore() {
     const { subscribe, set, update } = writable([]);

     return {
       subscribe,
       add: (path) => update(files => [...files, { path, status: 'pending' }]),
       remove: (path) => update(files => files.filter(f => f.path !== path)),
       updateStatus: (path, status) => 
         update(files => 
           files.map(f => 
             f.path === path ? { ...f, status } : f
           )
         )
     };
   }

   export const files = createFilesStore();
   ```

2. **Conversion Store (frontend/src/lib/stores/conversionStatus.js)**
   ```javascript
   import { writable } from 'svelte/store';

   export const conversionStatus = writable({
     active: false,
     progress: 0,
     currentFile: null,
     error: null
   });

   // Listen for conversion events
   window.electron.on('conversion-progress', (data) => {
     conversionStatus.update(status => ({
       ...status,
       active: true,
       progress: data.progress,
       currentFile: data.file
     }));
   });

   window.electron.on('conversion-error', (error) => {
     conversionStatus.update(status => ({
       ...status,
       error: error.message
     }));
   });
   ```

## Progress Tracking

1. **Progress Bar Component (frontend/src/lib/components/common/ProgressBar.svelte)**
   ```svelte
   <script>
     import { conversionStatus } from '$lib/stores/conversionStatus';
   </script>

   {#if $conversionStatus.active}
     <div class="progress-container">
       <div 
         class="progress-bar" 
         style="width: {$conversionStatus.progress}%"
       />
       <span class="progress-text">
         Converting: {$conversionStatus.currentFile}
         ({$conversionStatus.progress}%)
       </span>
     </div>
   {/if}
   ```

## Error Handling

1. **Error Display Component (frontend/src/lib/components/common/ErrorMessage.svelte)**
   ```svelte
   <script>
     export let error = null;
     
     function dismissError() {
       error = null;
     }
   </script>

   {#if error}
     <div class="error-message">
       <span>{error}</span>
       <button on:click={dismissError}>Dismiss</button>
     </div>
   {/if}
   ```

## Desktop Integration

1. **System Integration (frontend/src/lib/utils/systemIntegration.js)**
   ```javascript
   export function setupSystemIntegration() {
     // Register file type associations
     window.electron.registerFileTypes(['md', 'markdown']);

     // Listen for system events
     window.electron.on('system-theme-changed', updateTheme);
     window.electron.on('system-offline', handleOffline);
   }

   function updateTheme(isDark) {
     document.body.classList.toggle('dark-theme', isDark);
   }

   function handleOffline() {
     // Disable online-only features
     disableWebFeatures();
   }
   ```

2. **Settings Panel (frontend/src/lib/components/SettingsPanel.svelte)**
   ```svelte
   <script>
     async function getSettings() {
       const settings = await window.electron.getSetting('all');
       return settings;
     }

     async function saveSetting(key, value) {
       await window.electron.setSetting(key, value);
     }
   </script>

   <div class="settings-panel">
     <!-- Settings UI -->
   </div>
   ```

## Testing Guidelines

1. **Component Testing**
   - Test file drag and drop
   - Verify progress updates
   - Check error displays
   - Test offline functionality

2. **Integration Testing**
   - Test full conversion flow
   - Verify file saving
   - Check system integration
   - Test theme switching

## Next Steps
1. Implement remaining components
2. Add system tray integration
3. Test cross-platform functionality
4. Add keyboard shortcuts

## Important Notes
- Test on all target platforms
- Verify memory usage
- Ensure proper error handling
- Check accessibility features
