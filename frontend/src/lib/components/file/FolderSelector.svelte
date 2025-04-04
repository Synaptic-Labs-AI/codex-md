<!-- 
  FolderSelector.svelte
  
  A component that provides folder selection and browsing capabilities using Electron's dialog API.
  This component allows users to select folders for both input and output operations.
  
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
  export let label = 'Select Folder';
  export let mode = 'input'; // 'input' or 'output'
  export let buttonVariant = 'primary';
  export let buttonSize = 'md';
  export let fullWidth = false;
  export let disabled = false;
  export let showFileList = false;
  export let acceptedTypes = []; // File extensions to filter when browsing
  
  // Internal state
  let isSelecting = false;
  let selectedPath = '';
  let folderContents = [];
  let isExpanded = false;
  
  const dispatch = createEventDispatcher();
  
  /**
   * Opens the native folder selection dialog
   */
  async function openFolderDialog() {
    if (isSelecting || disabled) {
      return;
    }
    
    try {
      isSelecting = true;
      uploadStore.clearMessage();
      
      // Select folder based on mode
      const result = mode === 'output'
        ? await fileSystemOperations.selectOutputDirectory()
        : await fileSystemOperations.selectInputDirectory();
      
      if (result?.success) {
        selectedPath = result.path;
        
        // If input mode and showFileList is true, list directory contents
        if (mode === 'input' && showFileList) {
          await loadFolderContents(selectedPath);
          isExpanded = true;
        }
        
        // Dispatch event
        dispatch('folderSelected', { 
          path: selectedPath,
          contents: folderContents
        });
      }
    } catch (error) {
      console.error('Folder selection error:', error);
      uploadStore.setMessage(
        `Error selecting folder: ${error.message}`,
        'error'
      );
    } finally {
      isSelecting = false;
    }
  }
  
  /**
   * Loads the contents of a folder
   */
  async function loadFolderContents(folderPath) {
    try {
      const options = {
        recursive: false,
        extensions: acceptedTypes
      };
      
      const result = await fileSystemOperations.listDirectory(folderPath, options);
      if (result?.success) {
        folderContents = result.items || [];
      } else {
        folderContents = [];
        console.error('Failed to list directory:', result?.error);
      }
    } catch (error) {
      console.error('Error listing directory:', error);
      folderContents = [];
    }
  }
  
  /**
   * Handles file selection from folder contents
   */
  function selectFile(file) {
    if (file.isDirectory) {
      // Navigate into directory
      browseFolder(file.path);
    } else {
      // Dispatch file selected event
      dispatch('fileSelected', { 
        path: file.path,
        name: file.name,
        size: file.size,
        type: file.type
      });
    }
  }
  
  /**
   * Browses to a specific folder
   */
  async function browseFolder(folderPath) {
    try {
      isSelecting = true;
      
      await loadFolderContents(folderPath);
      selectedPath = folderPath;
      
      // Dispatch folder changed event
      dispatch('folderChanged', { 
        path: selectedPath,
        contents: folderContents
      });
    } catch (error) {
      console.error('Folder browsing error:', error);
      uploadStore.setMessage(
        `Error browsing folder: ${error.message}`,
        'error'
      );
    } finally {
      isSelecting = false;
    }
  }
  
  /**
   * Toggles the folder contents display
   */
  function toggleFolderContents() {
    if (selectedPath && showFileList) {
      isExpanded = !isExpanded;
      
      if (isExpanded && folderContents.length === 0) {
        loadFolderContents(selectedPath);
      }
    }
  }
  
  /**
   * Navigates to the parent folder
   */
  async function navigateToParent() {
    if (!selectedPath) return;
    
    try {
      const parentPath = selectedPath.split(/[/\\]/).slice(0, -1).join('/');
      if (parentPath) {
        await browseFolder(parentPath);
      }
    } catch (error) {
      console.error('Error navigating to parent:', error);
    }
  }
</script>

<div class="folder-selector" in:fade={{ duration: 200 }}>
<Button
    variant={buttonVariant}
    size={buttonSize}
    fullWidth={fullWidth}
    disabled={disabled || isSelecting}
    on:click={openFolderDialog}
    data-testid="folder-selector"
  >
    {#if isSelecting}
      <span class="loading-indicator"></span>
    {/if}
    {label}
  </Button>
  
  {#if selectedPath && showFileList}
    <div class="selected-path" on:click={toggleFolderContents} on:keydown={(e) => { if (e.key === 'Enter') toggleFolderContents(); }} tabindex="0">
      <span class="folder-icon">📁</span>
      <span class="path-text">{selectedPath}</span>
      <span class="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
    </div>
    
    {#if isExpanded}
      <div class="folder-contents" in:fade={{ duration: 200 }}>
        <div class="folder-actions">
          <button class="action-button" on:click={navigateToParent} disabled={!selectedPath}>
            <span class="action-icon">⬆️</span>
            <span class="action-text">Parent Directory</span>
          </button>
          <button class="action-button" on:click={() => browseFolder(selectedPath)} disabled={!selectedPath}>
            <span class="action-icon">🔄</span>
            <span class="action-text">Refresh</span>
          </button>
        </div>
        
        {#if folderContents.length > 0}
          <ul class="file-list">
            {#each folderContents as file}
              <li 
                class="file-item"
                class:is-directory={file.isDirectory}
                on:click={() => selectFile(file)}
                on:keydown={(e) => { if (e.key === 'Enter') selectFile(file); }}
                tabindex="0"
              >
                <span class="file-icon">{file.isDirectory ? '📁' : '📄'}</span>
                <span class="file-name">{file.name}</span>
                {#if !file.isDirectory}
                  <span class="file-size">{formatFileSize(file.size)}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-folder">This folder is empty</p>
        {/if}
      </div>
    {/if}
  {/if}
  
</div>

<style>
  .folder-selector {
    position: relative;
    width: 100%;
  }
  
  .selected-path {
    margin-top: var(--spacing-md);
    padding: var(--spacing-sm);
    background-color: var(--color-bg-alt);
    border-radius: var(--rounded-md);
    border: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    cursor: pointer;
    transition: background-color var(--transition-duration-fast);
  }
  
  .selected-path:hover {
    background-color: var(--color-bg-hover);
  }
  
  .folder-icon {
    flex-shrink: 0;
  }
  
  .path-text {
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-sm);
  }
  
  .toggle-icon {
    flex-shrink: 0;
    font-size: var(--font-size-xs);
    color: var(--color-text-secondary);
  }
  
  .folder-contents {
    margin-top: var(--spacing-xs);
    border-radius: var(--rounded-md);
    border: 1px solid var(--color-border);
    overflow: hidden;
  }
  
  .folder-actions {
    padding: var(--spacing-xs);
    background-color: var(--color-bg-alt);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    gap: var(--spacing-xs);
  }
  
  .action-button {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--rounded-sm);
    border: none;
    background-color: var(--color-bg);
    cursor: pointer;
    font-size: var(--font-size-xs);
    transition: background-color var(--transition-duration-fast);
  }
  
  .action-button:hover:not(:disabled) {
    background-color: var(--color-bg-hover);
  }
  
  .action-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .action-icon {
    font-size: var(--font-size-sm);
  }
  
  .file-list {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 300px;
    overflow-y: auto;
  }
  
  .file-item {
    padding: var(--spacing-sm);
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    cursor: pointer;
    transition: background-color var(--transition-duration-fast);
    border-bottom: 1px solid var(--color-border-light);
  }
  
  .file-item:last-child {
    border-bottom: none;
  }
  
  .file-item:hover {
    background-color: var(--color-bg-hover);
  }
  
  .file-item.is-directory {
    font-weight: var(--font-weight-medium);
  }
  
  .file-name {
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .file-size {
    flex-shrink: 0;
    font-size: var(--font-size-xs);
    color: var(--color-text-secondary);
  }
  
  .empty-folder {
    padding: var(--spacing-md);
    text-align: center;
    color: var(--color-text-secondary);
    font-style: italic;
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
  
  /* Mobile Adjustments */
  @media (max-width: 640px) {
    .file-item {
      padding: var(--spacing-xs);
    }
    
    .action-text {
      display: none;
    }
  }
</style>

<script context="module">
  /**
   * Formats a file size in bytes to a human-readable string
   * @param {number} bytes File size in bytes
   * @returns {string} Formatted file size
   */
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }
</script>
