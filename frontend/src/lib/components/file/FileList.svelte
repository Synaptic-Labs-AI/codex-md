<!-- src/lib/components/file/FileList.svelte -->
<script>
  import { files, FileStatus } from '$lib/stores/files.js';
  import { fade, slide } from 'svelte/transition';
  import FileCard from './FileCard.svelte';
  import { createEventDispatcher } from 'svelte';
  
  const dispatch = createEventDispatcher();

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

  function handleSelect(event) {
      const { id, selected } = event.detail;
      if (!id) return;

      const result = files.updateFile(id, { selected });
      if (result.success) {
          dispatch('fileSelected', { id, selected, file: result.file });
      }
  }

  function toggleSelectAll() {
      const allSelected = $files.every(f => f.selected);
      $files.forEach(file => {
          files.updateFile(file.id, { selected: !allSelected });
      });
  }

  function deleteSelected() {
      const selectedIds = $files.filter(f => f.selected).map(f => f.id);
      selectedIds.forEach(id => files.removeFile(id));
      if (selectedIds.length === $files.length) {
          files.clearFiles();
      }
  }

  // Reactive declarations
  $: hasFiles = $files && $files.length > 0;
  $: selectedCount = $files.filter(f => f.selected).length;
  $: allSelected = hasFiles && $files.every(f => f.selected);
</script>

{#if hasFiles}
  <div class="file-list-container" in:slide>
      <div class="file-list-actions">
          <button 
              class="action-button"
              on:click={toggleSelectAll}
          >
              {allSelected ? 'Uncheck All' : 'Check All'}
          </button>
          {#if selectedCount > 0}
              <button 
                  class="action-button delete-button"
                  on:click={deleteSelected}
              >
                  Delete Selected ({selectedCount})
              </button>
          {/if}
      </div>
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
                      on:select={handleSelect}
                  />
              </div>
          {/each}
      </div>
  </div>
{:else}
  <div class="empty-state" in:fade>
      <p>No files added yet.</p>
  </div>
{/if}

<style>
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

  .file-list-actions {
      display: flex;
      justify-content: space-between;
      gap: var(--spacing-sm);
      padding: var(--spacing-xs);
      position: relative;
      z-index: 1;
  }

  .action-button {
      padding: var(--spacing-xs) var(--spacing-md);
      border-radius: var(--rounded-md);
      position: relative;
      background: linear-gradient(135deg, var(--color-prime), var(--color-fourth));
      color: white;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      border: none;
  }

  .action-button:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-sm);
  }

  .delete-button {
      background: var(--color-error);
      color: white;
      font-weight: 700;
      opacity: 1;
      border: 2px solid rgba(var(--color-error-rgb), 0.8);
      box-shadow: 0 3px 6px rgba(var(--color-error-rgb), 0.3);
      padding-left: var(--spacing-md);
      padding-right: var(--spacing-md);
  }

  .delete-button::before {
      content: "🗑️";
      margin-right: var(--spacing-xs);
      font-size: 1.1em;
  }

  .delete-button:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(var(--color-error-rgb), 0.4);
      border: 2px solid var(--color-error);
      background: linear-gradient(135deg, var(--color-error), var(--color-error-light));
  }

  .file-list {
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
      .action-button {
          transition: none;
      }

      .action-button:hover {
          transform: none;
      }
  }
</style>
