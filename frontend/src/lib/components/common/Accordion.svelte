<script>
  import { slide } from 'svelte/transition';
  
  export let title = '';
  export let icon = '';
  export let expandedIcon = icon;
  export let isGradientParent = false;
  let expanded = false;
</script>

<div class="accordion-wrapper" class:gradient-parent={isGradientParent}>
  <button class="accordion-header" on:click={() => expanded = !expanded}>
    <span class="icon">{expanded ? expandedIcon : icon}</span>
    <span class="title">{title}</span>
    <span class="arrow" class:expanded>{expanded ? '▼' : '▶'}</span>
  </button>
  {#if expanded}
    <div class="accordion-content" transition:slide>
      <slot />
    </div>
  {/if}
</div>

<style>
  .accordion-wrapper {
    width: 100%;
    background: transparent;
  }

  .accordion-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm);
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: var(--font-size-base);
    font-weight: 600;
    text-align: left;
    border-radius: var(--rounded-md);
    transition: background-color 0.2s ease;
  }

  .accordion-header:hover {
    background: rgba(var(--color-prime-rgb), 0.1);
  }

  .title {
    flex: 1;
  }

  .icon {
    font-size: 1.2em;
  }

  .arrow {
    font-size: 0.8em;
    transition: transform 0.2s ease;
  }

  .arrow.expanded {
    transform: rotate(0deg);
  }

  .accordion-content {
    margin-top: var(--spacing-xs);
    background: transparent;
  }

  /* Reduced Motion */
  @media (prefers-reduced-motion: reduce) {
    .accordion-header {
      transition: none;
    }
  }
</style>
