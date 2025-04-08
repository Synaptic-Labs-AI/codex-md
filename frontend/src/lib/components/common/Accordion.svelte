<!-- 
  Accordion.svelte - Collapsible content component
  Provides an expandable/collapsible section for organizing content.
  
  Features:
  - Smooth animation for expand/collapse
  - Customizable title and icon
  - Keyboard accessibility
  - ARIA attributes for screen readers
  
  Props:
  - title: string - Title text for the accordion header
  - icon: string - Optional icon (emoji) to display before title
  - open: boolean - Optional initial open state
  
  Usage:
  <Accordion title="Section Title" icon="ℹ️">
    Content goes here
  </Accordion>
-->
<script>
  import { slide } from 'svelte/transition';
  import { createEventDispatcher } from 'svelte';
  
  export let title = '';
  export let icon = '';
  export let open = false;
  
  const dispatch = createEventDispatcher();
  
  function toggle() {
    open = !open;
    dispatch('toggle', { open });
  }
  
  function handleKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  }
</script>

<div class="accordion">
  <button
    class="accordion-header"
    on:click={toggle}
    on:keydown={handleKeydown}
    aria-expanded={open}
    aria-controls="accordion-content"
  >
    {#if icon}
      <span class="icon">{icon}</span>
    {/if}
    <span class="title">{title}</span>
    <span class="chevron" class:open>▼</span>
  </button>
  
  {#if open}
    <div
      class="accordion-content"
      id="accordion-content"
      transition:slide={{ duration: 200 }}
    >
      <slot />
    </div>
  {/if}
</div>

<style>
  .accordion {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: var(--rounded-md);
    background-color: var(--color-surface);
    margin-bottom: var(--spacing-sm);
  }
  
  .accordion-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm);
    background: none;
    border: none;
    cursor: pointer;
    font-size: var(--font-size-sm);
    color: var(--color-text);
    text-align: left;
    transition: background-color 0.2s ease;
  }
  
  .accordion-header:hover {
    background-color: var(--color-surface-hover);
  }
  
  .accordion-header:focus-visible {
    outline: 2px solid var(--color-prime);
    outline-offset: -2px;
  }
  
  .icon {
    flex-shrink: 0;
    font-size: 1.2em;
  }
  
  .title {
    flex-grow: 1;
    font-weight: var(--font-weight-medium);
  }
  
  .chevron {
    flex-shrink: 0;
    font-size: 0.8em;
    transition: transform 0.2s ease;
  }
  
  .chevron.open {
    transform: rotate(180deg);
  }
  
  .accordion-content {
    padding: var(--spacing-md);
    border-top: 1px solid var(--color-border);
  }
  
  /* High Contrast */
  @media (prefers-contrast: high) {
    .accordion {
      border-width: 2px;
    }
    
    .accordion-content {
      border-top-width: 2px;
    }
  }
  
  /* Reduced Motion */
  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }
</style>
