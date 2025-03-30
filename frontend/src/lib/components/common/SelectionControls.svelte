<!-- src/lib/components/common/SelectionControls.svelte -->
<script>
    import { createEventDispatcher } from 'svelte';
    import { fly } from 'svelte/transition';
    
    const dispatch = createEventDispatcher();
  
    export let selectedCount = 0;
    export let totalCount = 0;
    export let showActions = true;
    export let actions = [
      { id: 'remove', label: 'Remove', icon: '🗑️', variant: 'danger' }
    ];
  
    $: isAllSelected = selectedCount === totalCount && totalCount > 0;
    $: isIndeterminate = selectedCount > 0 && selectedCount < totalCount;
  
    function handleSelectAll() {
      dispatch('select', { selected: !isAllSelected });
    }
  
    function handleAction(actionId) {
      dispatch('action', { id: actionId, selectedCount });
    }
  
    // Keyboard navigation
    function handleKeydown(event, actionId) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleAction(actionId);
      }
    }
  </script>
  
  <div class="selection-controls" role="toolbar" aria-label="Selection controls">
    <!-- Select All Checkbox -->
    <label class="checkbox-wrapper">
      <input
        type="checkbox"
        class="checkbox-input"
        checked={isAllSelected}
        indeterminate={isIndeterminate}
        on:change={handleSelectAll}
        aria-label={isAllSelected ? 'Deselect all' : 'Select all'}
      />
      <span class="checkbox-custom">
        {#if isIndeterminate}
          <span class="indeterminate-mark">−</span>
        {:else if isAllSelected}
          <span class="check-mark">✓</span>
        {/if}
      </span>
      <span class="checkbox-label">
        {#if selectedCount > 0}
          {selectedCount} selected
        {:else}
          Select all
        {/if}
      </span>
    </label>
  
    <!-- Action Buttons -->
    {#if showActions && selectedCount > 0}
      <div 
        class="actions-group"
        in:fly={{ y: -10, duration: 200 }}
        role="group"
        aria-label="Selection actions"
      >
        {#each actions as action}
          <button
            class="action-button"
            class:variant-danger={action.variant === 'danger'}
            on:click={() => handleAction(action.id)}
            on:keydown={e => handleKeydown(e, action.id)}
            aria-label={`${action.label} ${selectedCount} items`}
          >
            <span class="icon" aria-hidden="true">{action.icon}</span>
            <span class="label">{action.label}</span>
            <span class="count">({selectedCount})</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
  
  <style>
    .selection-controls {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      flex-wrap: wrap;
    }
  
    .checkbox-wrapper {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      cursor: pointer;
      user-select: none;
    }
  
    .checkbox-input {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }
  
    .checkbox-custom {
      width: 18px;
      height: 18px;
      border: 2px solid var(--color-border);
      border-radius: var(--rounded-sm);
      background: var(--color-surface);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition-duration-normal) ease;
    }
  
    .checkbox-input:checked + .checkbox-custom {
      background: var(--color-prime);
      border-color: var(--color-prime);
      color: white;
    }
  
    .checkbox-input:focus + .checkbox-custom {
      outline: 2px solid var(--color-prime);
      outline-offset: 2px;
    }
  
    .check-mark,
    .indeterminate-mark {
      font-size: 12px;
      line-height: 1;
    }
  
    .checkbox-label {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }
  
    .actions-group {
      display: flex;
      gap: var(--spacing-sm);
    }
  
    .action-button {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-xs);
      padding: var(--spacing-xs) var(--spacing-sm);
      border: none;
      border-radius: var(--rounded-md);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      background: var(--color-background);
      cursor: pointer;
      transition: all var(--transition-duration-normal) ease;
    }
  
    .action-button:hover {
      background: var(--color-background-secondary);
    }
  
    .action-button.variant-danger {
      color: var(--color-error);
    }
  
    .action-button.variant-danger:hover {
      background: var(--color-error-light);
    }
  
    .icon {
      font-size: 1.2em;
      line-height: 1;
    }
  
    .count {
      color: var(--color-text-secondary);
    }
  
    /* Accessibility */
    @media (prefers-reduced-motion: reduce) {
      .checkbox-custom,
      .action-button {
        transition: none;
      }
    }
  
    @media (prefers-contrast: high) {
      .checkbox-custom {
        border-width: 2px;
      }
  
      .action-button {
        border: 1px solid currentColor;
      }
    }
  </style>