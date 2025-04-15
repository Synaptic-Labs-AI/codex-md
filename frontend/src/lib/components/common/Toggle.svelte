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
  
  function handleChange(event) {
    if (!disabled) {
      console.log(`[Toggle] Before change: checked = ${checked}`);
      
      // Instead of updating the checked value directly, we'll just dispatch the event
      // The parent component will handle updating the value
      const newValue = !checked;
      
      // Dispatch the event with the new value
      dispatch('change', { checked: newValue });
      console.log(`[Toggle] Dispatched 'change' event with value: ${newValue}`);
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
    checked={checked}
    {disabled}
    on:change|preventDefault|stopPropagation={handleChange}
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
    background-color: var(--color-neutral-300);
    border-radius: 10px;
    transition: background-color 0.2s;
  }
  
  input:checked + .toggle-track {
    background-color: var(--color-primary-500);
  }
  
  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background-color: white;
    border-radius: 50%;
    transition: transform 0.2s;
  }
  
  input:checked + .toggle-track .toggle-thumb {
    transform: translateX(16px);
  }
  
  .toggle-label {
    font-size: var(--font-size-sm);
    color: var(--color-text);
  }
</style>
