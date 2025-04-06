<!-- src/lib/components/FileUploader.svelte -->
<script>
  import { createEventDispatcher } from 'svelte';
  import { files } from '$lib/stores/files.js';
  import { uploadStore } from '$lib/stores/uploadStore.js';
  import { fade } from 'svelte/transition';
  import { apiKey } from '$lib/stores/apiKey.js';
  import { requiresApiKey, isValidFileType } from '$lib/utils/fileUtils.js';
  import { fileCategories, generateId, normalizeUrl } from '$lib/api/electron';
  import electronClient from '$lib/api/electron';
  import Container from './common/Container.svelte';
  import TabNavigation from './common/TabNavigation.svelte';
  import UrlInput from './common/UrlInput.svelte';
  import DropZone from './common/DropZone.svelte';
  import ErrorMessage from './common/ErrorMessage.svelte';
  import FileList from './file/FileList.svelte';
  import ApiKeyInput from './ApiKeyInput.svelte';
  import NativeFileSelector from './file/NativeFileSelector.svelte';
  import FolderSelector from './file/FolderSelector.svelte';
  import Button from './common/Button.svelte';
  
  // Add prop to control when to show the conversion button
  export let showConversionButton = false;
  // Add prop for the conversion handler
  export let onStartConversion = () => {};

  const dispatch = createEventDispatcher();

  // Use fileCategories from electron utils
  const SUPPORTED_FILES = fileCategories;
  const SUPPORTED_EXTENSIONS = Object.values(SUPPORTED_FILES).flat();

  // Reactive declarations for UI state
  $: showFileList = $files.length > 0;
  $: needsApiKey = $files.some(file => requiresApiKey(file));
  
  // Check if there's a URL in the files store (to disable file uploader if a URL exists)
  $: hasUrl = $files.length > 0 && $files[0].url;
  $: fileUploaderDisabled = hasUrl;

  function showFeedback(message, type = 'info') {
    if (type !== 'success') {
      uploadStore.setMessage(message, type);
      return setTimeout(() => uploadStore.clearMessage(), 5000);
    }
  }

  function validateFile(file) {
    // Handle file path (string) from Electron or File object from web
    const isFilePath = typeof file === 'string';
    const fileName = isFilePath ? file.split(/[/\\]/).pop() : file.name;
    const extension = fileName.split('.').pop().toLowerCase();
    
    if (!isValidFileType(extension)) {
      return { valid: false, message: `Unsupported file type: ${fileName}` };
    }

    // Size validation removed - no file size limits

    return { valid: true };
  }

  function getFileCategory(extension) {
    extension = extension.toLowerCase();
    
    if (['csv', 'xlsx', 'xls'].includes(extension)) {
      return 'data';
    }

    for (const [category, extensions] of Object.entries(SUPPORTED_FILES)) {
      if (extensions.includes(extension)) {
        return category;
      }
    }
    return 'unknown';
  }

  /**
   * Handles files added to the uploader
   * Modified to only process the first file if multiple are provided
   */
  function handleFilesAdded(newFiles) {
    uploadStore.clearMessage();
    
    // Only process the first file if multiple are provided
    if (newFiles.length === 0) return;
    
    // Take only the first file
    const file = newFiles[0];
    
    const validation = validateFile(file);
    if (!validation.valid) {
      showFeedback(validation.message, 'error');
      return;
    }

    // Handle file path (string) from Electron or File object from web
    const isFilePath = typeof file === 'string';
    const fileName = isFilePath ? file.split(/[/\\]/).pop() : file.name;
    const extension = fileName.split('.').pop().toLowerCase();
    const requiresKey = requiresApiKey(isFilePath ? { type: extension } : file);

    const newFile = {
      id: generateId(),
      name: fileName,
      file: file, // This will be either a File object or a file path string
      path: isFilePath ? file : null, // Store the full path if it's from Electron
      type: extension,
      status: 'Ready',
      progress: 0,
      selected: false,
      requiresApiKey: requiresKey,
      isNative: isFilePath // Flag to indicate if this is a native file path
    };

    const result = files.addFile(newFile);
    if (result.success) {
      dispatch('filesAdded', { files: [newFile] });
    } else {
      showFeedback(result.message, 'error');
    }
  }

  /**
   * Handles files selected through the native file selector
   */
  function handleNativeFilesSelected(event) {
    const { paths } = event.detail;
    if (paths && paths.length > 0) {
      // Only pass the first path if multiple are selected
      handleFilesAdded([paths[0]]);
    }
  }

  /**
   * Handles directory selected through the native file selector
   */
  function handleDirectorySelected(event) {
    const { path } = event.detail;
    if (path) {
      // For now, we just store the output directory
      // This will be used when saving conversion results
      localStorage.setItem('lastOutputDirectory', path);
      showFeedback(`Output directory set to: ${path}`, 'success');
    }
  }
  
  /**
   * Handles folder selected for input
   */
  function handleFolderSelected(event) {
    const { path, contents } = event.detail;
    if (path) {
      showFeedback(`Input folder selected: ${path}`, 'success');
      
      // If the folder has contents, we can process them
      if (contents && contents.length > 0) {
        // Filter for supported file types
        const supportedFiles = contents
          .filter(item => !item.isDirectory)
          .filter(item => SUPPORTED_EXTENSIONS.includes(item.type))
          .map(item => item.path);
        
        if (supportedFiles.length > 0) {
          // Only pass the first supported file
          handleFilesAdded([supportedFiles[0]]);
        } else {
          showFeedback('No supported files found in the selected folder', 'warning');
        }
      }
    }
  }
  
  /**
   * Handles file selected from folder browser
   */
  function handleFileSelectedFromFolder(event) {
    const { path } = event.detail;
    if (path) {
      handleFilesAdded([path]);
    }
  }

  async function handleFileUpload(event) {
    const uploadedFiles = Array.from(event.target.files || []);
    // Only pass the first file if multiple are somehow selected
    if (uploadedFiles.length > 0) {
      handleFilesAdded([uploadedFiles[0]]);
      
      const needsKey = requiresApiKey(uploadedFiles[0]);
      if (needsKey && !$apiKey) {
        setTimeout(() => {
          const apiKeySection = document.querySelector('.api-key-input-section');
          apiKeySection?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      } else {
        dispatch('startConversion');
      }
    }
  }
</script>

<div class="file-uploader" in:fade={{ duration: 200 }}>
  <Container>
    <div class="uploader-content">
      <!-- Only show input options when no file/URL is present -->
      {#if !showFileList}
        <!-- URL Input Section -->
        <div class="section">
          <TabNavigation />
          <UrlInput />
        </div>

        <div class="section-divider"></div>

        <!-- File Upload Section -->
        <div class="section">
          <div>
          <DropZone
            acceptedTypes={SUPPORTED_EXTENSIONS}
            on:filesDropped={(event) => !fileUploaderDisabled && handleFilesAdded(event.detail.files)}
            on:filesSelected={(event) => !fileUploaderDisabled && handleFilesAdded(event.detail.files)}
          />
        </div>
      </div>
      
      {#if $uploadStore.message}
        <div class="section">
          <ErrorMessage />
        </div>
      {/if}

      {/if}
      
      <!-- Error messages and file list always shown when needed -->
      {#if $uploadStore.message}
        <div class="section">
          <ErrorMessage />
        </div>
      {/if}

      {#if showFileList}
        <div class="section">
          <FileList
            showConversionButton={showConversionButton}
            on:fileRemoved={() => {
              // This will be called when a file is removed
              // The reactive variable showFileList will automatically update
              // based on $files.length, which will re-reveal the input options
            }}
          >
            <div slot="conversion-button">
              <Button
                variant="primary"
                size="large"
                fullWidth
                on:click={onStartConversion}
              >
                Start Conversion
              </Button>
            </div>
          </FileList>
        </div>
      {/if}

      {#if needsApiKey}
        <div class="section">
          <ApiKeyInput />
        </div>
      {/if}

    </div>
  </Container>
</div>

<style>
  .file-uploader {
    width: 100%;
    max-width: 1000px;
    margin: 0 auto;
  }

  .uploader-content {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .section {
    width: 100%;
  }

  .section-divider {
    width: 100%;
    height: 1px;
    background: linear-gradient(90deg, var(--color-prime), var(--color-fourth));
    opacity: 0.3;
  }
  
  .disabled {
    opacity: 0.5;
    pointer-events: none;
    position: relative;
  }
  
  .disabled-message {
    text-align: center;
    padding: var(--spacing-md);
    margin-bottom: var(--spacing-sm);
    background: rgba(var(--color-info-rgb), 0.1);
    border-radius: var(--rounded-md);
    color: var(--color-info);
  }
  
  .disabled-message p {
    margin: var(--spacing-xs) 0;
  }

  /* Mobile Adjustments */
  @media (max-width: 768px) {
    .uploader-content {
      gap: var(--spacing-sm);
    }
  }

  @media (max-width: 640px) {
    .uploader-content {
      gap: var(--spacing-xs);
    }
  }
</style>
