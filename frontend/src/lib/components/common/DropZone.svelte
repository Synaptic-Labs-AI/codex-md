<!-- src/lib/components/common/DropZone.svelte -->
<script>
    import { createEventDispatcher } from 'svelte';
    import { fade, scale } from 'svelte/transition';
    import { uploadStore } from '../../stores/uploadStore';
    import { formatFileSize, MAX_FILE_SIZE, MAX_VIDEO_SIZE, validateFileSize, getFileType } from '../../utils/fileUtils';
  
    export let acceptedTypes = [];
    let fileInput;
    let dragCounter = 0;
    
    const dispatch = createEventDispatcher();
  
    function handleDrop(event) {
      event.preventDefault();
      uploadStore.setDragOver(false);
      dragCounter = 0;
      
      const files = Array.from(event.dataTransfer.files);
      // Only take the first file if multiple are dropped
      const singleFile = files.length > 0 ? [files[0]] : [];
      dispatch('filesDropped', { files: singleFile });
    }
  
    function handleDragEnter(event) {
      event.preventDefault();
      dragCounter++;
      uploadStore.setDragOver(true);
    }
  
    function handleDragLeave(event) {
      event.preventDefault();
      dragCounter--;
      if (dragCounter === 0) {
        uploadStore.setDragOver(false);
      }
    }
  
    function handleFileSelect(event) {
      const files = Array.from(event.target.files);
      // Only take the first file if multiple are somehow selected
      const singleFile = files.length > 0 ? [files[0]] : [];
      dispatch('filesSelected', { files: singleFile });
      event.target.value = ''; // Reset input
    }
  
    // Format accepted file types for display
    $: displayTypes = acceptedTypes
      .map(type => type.toUpperCase())
      .join(', ');
  </script>
  
  <div 
    class="drop-zone"
    class:drag-over={$uploadStore.dragOver}
    on:dragenter={handleDragEnter}
    on:dragleave={handleDragLeave}
    on:dragover|preventDefault
    on:drop={handleDrop}
    on:click={() => fileInput.click()}
    on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); }}
    role="button"
    tabindex="0"
  >
    <input
      type="file"
      accept={acceptedTypes.map(ext => `.${ext}`).join(',')}
      class="file-input"
      bind:this={fileInput}
      on:change={handleFileSelect}
    />
    
    <div class="drop-zone-content" in:scale={{ duration: 200 }}>
      <!-- Default State -->
      {#if !$uploadStore.dragOver}
        <div class="icon-container">
          <span class="icon">📂</span>
        </div>
        <div class="text-content">
          <p class="primary-text">Drag and drop a file here</p>
          <p class="secondary-text">or click to browse your computer</p>
          <p class="file-types">
            <b>Supported formats:</b> {displayTypes}
          </p>
        </div>
      <!-- Drag Over State -->
      {:else}
        <div class="icon-container" in:scale={{ duration: 200 }}>
          <span class="icon">📥</span>
        </div>
        <p class="primary-text">Drop file to convert!</p>
      {/if}
    </div>
  </div>
  
  <style>
    .drop-zone {
      width: 100%;
      min-height: 200px;
      border-radius: var(--rounded-lg);
      background: transparent;
      transition: all var(--transition-duration-normal);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-xl);
      position: relative;
    }

    .drop-zone::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      border-radius: var(--rounded-lg);
      padding: 2px;
      background: linear-gradient(135deg, var(--color-prime), var(--color-fourth));
      -webkit-mask: 
          linear-gradient(#fff 0 0) content-box, 
          linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
      opacity: 0.5;
    }
  
    .drop-zone:hover::before {
      opacity: 1;
    }
  
    .drop-zone.drag-over {
      transform: scale(1.02);
      box-shadow: var(--shadow-md);
    }

    .drop-zone.drag-over::before {
      opacity: 1;
      background: linear-gradient(135deg, var(--color-fourth), var(--color-prime));
    }
  
    .drop-zone-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-md);
      text-align: center;
      position: relative;
      z-index: 1;
    }
  
    .icon-container {
      position: relative;
      height: 60px;
      width: 60px;
    }
  
    .icon {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      font-size: var(--font-size-3xl);
      transition: all var(--transition-duration-normal);
    }
  
    .text-content {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-xs);
    }
  
    .primary-text {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-medium);
      color: var(--color-text);
      margin: 0;
    }
  
    .secondary-text {
      font-size: var(--font-size-base);
      color: var(--color-text-secondary);
      margin: 0;
    }
  
    .file-types {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin-top: var(--spacing-sm);
    }
  
    .file-input {
      display: none;
    }
  
    /* Hover Effects */
    .drop-zone:hover .icon {
      transform: translate(-50%, -50%) scale(1.1);
    }
  
    /* Mobile Adjustments */
    @media (max-width: 640px) {
      .drop-zone {
        min-height: 160px;
        padding: var(--spacing-lg);
      }
  
      .icon-container {
        height: 48px;
        width: 48px;
      }
  
      .primary-text {
        font-size: var(--font-size-base);
      }
  
      .secondary-text {
        font-size: var(--font-size-sm);
      }
    }
  
    /* High Contrast Mode */
    @media (prefers-contrast: high) {
      .drop-zone::before {
        padding: 3px;
        opacity: 1;
      }
    }
  
    /* Reduced Motion */
    @media (prefers-reduced-motion: reduce) {
      .drop-zone,
      .icon {
        transition: none;
      }
  
      .drop-zone.drag-over {
        transform: none;
      }
    }
  </style>
