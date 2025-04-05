<script>
    import { createEventDispatcher } from 'svelte';
    import { getFileIcon } from '$lib/utils/iconUtils.js';
    
    export let file;
    
    const dispatch = createEventDispatcher();
  
    $: fileIcon = getFileIcon(file.type);
    
    function handleRemove() {
      dispatch('remove', { id: file.id });
    }
</script>
  
<div class="file-card">

  <div class="file-info">
      <span class="icon" aria-hidden="true">
          {fileIcon}
      </span>
      <span class="file-name" title={file.name}>
          {file.name}
      </span>
  </div>

  <button 
      class="delete-button" 
      on:click={handleRemove}
      aria-label={`Remove ${file.name}`}
      title="Remove file"
  >
      🗑️
  </button>
</div>
  
<style>
  .file-card {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-md);
      background: var(--color-background);
      border-radius: var(--rounded-md);
      transition: all 0.2s ease;
      box-shadow: var(--shadow-sm);
  }

  .file-card:hover {
      background: rgba(var(--color-prime-rgb), 0.05);
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
  }


  .file-info {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      flex: 1;
      min-width: 0;
  }

  .icon {
      font-size: 1.2em;
      opacity: 0.8;
  }

  .file-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
      color: var(--color-text);
  }

  .delete-button {
      padding: var(--spacing-xs);
      border: none;
      background: transparent;
      cursor: pointer;
      opacity: 0.5;
      transition: all 0.2s ease;
      border-radius: var(--rounded-sm);
  }

  .delete-button:hover {
      opacity: 1;
      background: rgba(var(--color-error-rgb), 0.1);
      color: var(--color-error);
      transform: scale(1.1);
  }

  /* High Contrast Mode */
  @media (prefers-contrast: high) {

      .file-card {
          box-shadow: var(--shadow-lg);
      }
  }

  /* Reduced Motion */
  @media (prefers-reduced-motion: reduce) {
      .file-card,
      .select-checkbox,
      .delete-button {
          transition: none;
      }

      .file-card:hover {
          transform: none;
      }

      .delete-button:hover {
          transform: none;
      }
  }
</style>
