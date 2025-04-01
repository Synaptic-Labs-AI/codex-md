<!-- frontend/src/lib/components/common/Toggle.svelte -->
<script>
  export let checked = false;
  export let label = '';
  export let id = `toggle-${Math.random().toString(36).substring(2)}`;
  export let disabled = false;
  
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  
  function handleChange(event) {
    checked = event.target.checked;
    dispatch('change', { checked });
  }
</script>

<div class="toggle-container">
  <label for={id} class="toggle-label">
    <input
      type="checkbox"
      {id}
      class="toggle-input"
      bind:checked
      on:change={handleChange}
      {disabled}
    />
    <span class="toggle-switch" aria-hidden="true"></span>
    {#if label}
      <span class="label-text">{label}</span>
    {/if}
  </label>
</div>

<style>
  .toggle-container {
    display: flex;
    align-items: center;
    margin-bottom: var(--spacing-sm);
  }
  
  .toggle-label {
    display: flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
  }
  
  .toggle-input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 40px;
    height: 22px;
    background-color: var(--color-border);
    border-radius: 11px;
    transition: all 0.3s;
    margin-right: var(--spacing-sm);
  }
  
  .toggle-switch::after {
    content: '';
    position: absolute;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background-color: white;
    top: 2px;
    left: 2px;
    transition: all 0.3s;
  }
  
  .toggle-input:checked + .toggle-switch {
    background-color: var(--color-prime);
  }
  
  .toggle-input:checked + .toggle-switch::after {
    transform: translateX(18px);
  }
  
  .toggle-input:disabled + .toggle-switch {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .label-text {
    font-size: var(--font-size-sm);
    color: var(--color-text);
  }
  
  /* Accessibility */
  .toggle-input:focus + .toggle-switch {
    outline: 2px solid var(--color-prime);
    outline-offset: 1px;
  }
  
  @media (prefers-reduced-motion: reduce) {
    .toggle-switch, .toggle-switch::after {
      transition: none;
    }
  }
</style>
