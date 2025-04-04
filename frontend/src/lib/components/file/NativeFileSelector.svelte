<!-- 
  NativeFileSelector.svelte
  
  A component that provides native file selection capabilities using Electron's dialog API.
  This component replaces the standard HTML file input with native system dialogs.
  
  Related files:
  - frontend/src/lib/api/electron: Modular Electron client implementation
  - frontend/src/lib/components/FileUploader.svelte: Main file upload component
  - src/electron/ipc/handlers/filesystem/index.js: IPC handlers for file system operations
-->

<script>
  import { createEventDispatcher } from 'svelte';
  import { fade } from 'svelte/transition';
  import Button from '../common/Button.svelte';
  import { uploadStore } from '../../stores/uploadStore.js';
  import fileSystemOperations from '../../api/electron/fileSystem.js';
  import electronClient from '../../api/electron';
  
  // Props
  export let label = 'Select Files';
  export let directoryMode = false;
  export let multiple = true;
  export let acceptedTypes = [];
  export let buttonVariant = 'primary';
  export let buttonSize = 'md';
  export let fullWidth = false;
  export let disabled = false;
  
  // Internal state
  let isSelecting = false;
  
  const dispatch = createEventDispatcher();
  
  /**
   * Opens the native file selection dialog
   */
  async function openFileDialog() {
    if (isSelecting || disabled) {
      return;
    }
    
    try {
      isSelecting = true;
      uploadStore.clearMessage();
      
      // Prepare dialog options
      const options = {
        multiple,
        filters: acceptedTypes.length > 0 ? [
          { 
            name: 'Supported Files', 
            extensions: acceptedTypes.map(ext => ext.replace('.', ''))
          }
        ] : undefined
      };
      
      // Select files or directory based on mode
      const result = directoryMode 
        ? await fileSystemOperations.selectOutputDirectory(options)
        : await fileSystemOperations.selectFiles(options);
      
      if (result?.success) {
        // Handle directory selection
        if (directoryMode) {
          dispatch('directorySelected', { path: result.path });
        } 
        // Handle file selection
        else if (result.paths?.length > 0) {
          dispatch('filesSelected', { paths: result.paths });
        }
      }
    } catch (error) {
      console.error('File selection error:', error);
      uploadStore.setMessage(
        `Error selecting ${directoryMode ? 'directory' : 'files'}: ${error.message}`,
        'error'
      );
    } finally {
      isSelecting = false;
    }
  }
</script>

<div class="native-file-selector" in:fade={{ duration: 200 }}>
<Button
    variant={buttonVariant}
    size={buttonSize}
    fullWidth={fullWidth}
    disabled={disabled || isSelecting}
    on:click={openFileDialog}
    data-testid="native-file-selector"
  >
    {#if isSelecting}
      <span class="loading-indicator"></span>
    {/if}
    {label}
  </Button>
  
</div>

<style>
  .native-file-selector {
    position: relative;
  }
  
  .electron-warning {
    font-size: var(--font-size-xs);
    color: var(--color-warning);
    margin-top: var(--spacing-xs);
    text-align: center;
  }
  
  .loading-indicator {
    display: inline-block;
    width: 1em;
    height: 1em;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top-color: white;
    animation: spin 1s ease-in-out infinite;
    margin-right: var(--spacing-xs);
    vertical-align: middle;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* Reduced Motion */
  @media (prefers-reduced-motion: reduce) {
    .loading-indicator {
      animation: none;
    }
  }
</style>
