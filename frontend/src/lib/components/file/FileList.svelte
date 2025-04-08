<!-- src/lib/components/file/FileList.svelte -->
<script>
  import { files, FileStatus } from '../../../lib/stores/files.js';
  import { fade, slide } from 'svelte/transition';
  import FileCard from './FileCard.svelte';
  import { createEventDispatcher } from 'svelte';
  
  const dispatch = createEventDispatcher();

  // Add prop to accept conversion button
  export let showConversionButton = false;

  function handleRemove(event) {
      const { id } = event.detail;
      if (!id) return;

      const result = files.removeFile(id);
      if (result.success) {
          dispatch('fileRemoved', { id, file: result.file });
          if ($files.length === 0) {
              files.clearFiles();
          }
      } else {
          console.error('Error removing file:', result.message);
      }
  }

  // Reactive declarations
  $: hasFiles = $files && $files.length > 0;
</script>

{#if hasFiles}
  <div class="file-list-container" in:slide>
      <div class="file-list">
          {#each $files as file (file.id)}
              <div
                  class="file-item"
                  in:fade={{ duration: 200 }}
                  out:fade={{ duration: 150 }}
              >
                  <FileCard
                      {file}
                      on:remove={handleRemove}
                  />
              </div>
          {/each}
      </div>
      
      <!-- Add slot for conversion button -->
      {#if showConversionButton}
        <div class="conversion-button-container">
          <slot name="conversion-button"></slot>
        </div>
      {/if}
  </div>
{:else}
  <div class="empty-state" in:fade>
      <p>No files added yet.</p>
  </div>
{/if}

<style>
  /* Add style for conversion button container */
  .conversion-button-container {
    margin-top: var(--spacing-md);
    width: 100%;
    padding: 0 var(--spacing-sm);
  }
  .file-list-container {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-md);
      width: 100%;
      background: transparent;
      border-radius: var(--rounded-lg);
      padding: var(--spacing-md);
      position: relative;
      box-shadow: var(--shadow-sm);
  }

  .file-list-container::before {
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
      opacity: 0.3;
  }


  /* Ensure the file list doesn't grow too large */
  .file-list {
    max-height: 300px; /* Reduced from 400px to make room for button */
      display: flex;
      flex-direction: column;
      gap: var(--spacing-xs);
      max-height: 400px;
      overflow-y: auto;
      padding: var(--spacing-xs);
      background: rgba(var(--color-prime-rgb), 0.02);
      border-radius: var(--rounded-md);
      scrollbar-width: thin;
      scrollbar-color: var(--color-border) transparent;
      position: relative;
      z-index: 1;
  }

  .file-list::-webkit-scrollbar {
      width: 8px;
  }

  .file-list::-webkit-scrollbar-track {
      background: transparent;
  }

  .file-list::-webkit-scrollbar-thumb {
      background-color: var(--color-border);
      border-radius: var(--rounded-full);
      border: 2px solid transparent;
  }

  .file-item {
      width: 100%;
      position: relative;
      z-index: 1;
  }

  .empty-state {
      text-align: center;
      padding: var(--spacing-xl);
      color: var(--color-text-secondary);
      background: transparent;
      border-radius: var(--rounded-lg);
      position: relative;
  }

  .empty-state::before {
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
      opacity: 0.2;
  }

  /* High Contrast Mode */
  @media (prefers-contrast: high) {
      .file-list-container::before,
      .empty-state::before {
          padding: 3px;
          opacity: 1;
      }
  }

  /* Reduced Motion */
  @media (prefers-reduced-motion: reduce) {
      /* Reduced motion styles */
  }
</style>
