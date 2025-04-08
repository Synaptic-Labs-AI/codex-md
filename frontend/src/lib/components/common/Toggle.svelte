<!-- 
  Toggle.svelte - Reusable toggle switch component
  Used for boolean settings and preferences throughout the application.
  
  Features:
  - Custom styling with CSS variables
  - Label support
  - Animation for state changes
  - Keyboard accessibility
  
  Props:
  - checked: boolean - Current state of the toggle
  - label: string - Optional label text
  - disabled: boolean - Optional disabled state
  
  Events:
  - change: Dispatched when toggle state changes
-->
<script>
  import { createEventDispatcher } from 'svelte';
  
  export let checked = false;
  export let label = '';
  export let disabled = false;
  
  const dispatch = createEventDispatcher();
  
  function handleChange() {
    if (!disabled) {
      checked = !checked;
      dispatch('change', { checked });
    }
  }
  
  function handleKeydown(event) {
    if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      handleChange();
    }
  }
</script>

<label class="toggle-container" class:disabled>
  <input
    type="checkbox"
    bind:checked
    {disabled}
    on:change={handleChange}
    on:keydown={handleKeydown}
  />
  <span class="toggle-track">
    <span class="toggle-thumb" />
  </span>
  {#if label}
    <span class="toggle-label">{label}</span>
  {/if}
</label>

<style>
  .toggle-container {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
    gap: var(--spacing-sm);
  }
  
  .toggle-container.disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  
  input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  
  .toggle-track {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;
    background-color: var(--color-surface-variant);
    border-radius: 10px;
    transition: background-color 0.2s ease;
  }
  
  input:checked + .toggle-track {
    background-color: var(--color-prime);
  }
  
  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background-color: var(--color-surface);
    border-radius: 50%;
    transition: transform 0.2s ease;
  }
  
  input:checked + .toggle-track .toggle-thumb {
    transform: translateX(16px);
  }
  
  .toggle-label {
    color: var(--color-text);
    font-size: var(--font-size-sm);
  }
  
  /* Focus styles */
  input:focus-visible + .toggle-track {
    box-shadow: 0 0 0 2px var(--color-prime-light);
  }
  
  /* High Contrast */
  @media (prefers-contrast: high) {
    .toggle-track {
      border: 2px solid currentColor;
    }
    
    .toggle-thumb {
      border: 1px solid currentColor;
    }
  }
  
  /* Reduced Motion */
  @media (prefers-reduced-motion: reduce) {
    .toggle-track,
    .toggle-thumb {
      transition: none;
    }
  }
</style>
