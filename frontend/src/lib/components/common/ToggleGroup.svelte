<!-- src/lib/components/common/ToggleGroup.svelte -->
<script>
  import { createEventDispatcher } from 'svelte';
  import { fade } from 'svelte/transition';
  
  export let options = [];
  export let value = '';
  export let name = '';
  
  const dispatch = createEventDispatcher();
  
  function handleChange(selectedValue) {
    value = selectedValue;
    dispatch('change', { value: selectedValue });
  }
</script>

<div class="toggle-group" role="radiogroup" aria-labelledby={`${name}-label`}>
  <div class="toggle-container">
    {#each options as option}
      <button
        class="toggle-button"
        class:active={value === option.value}
        on:click={() => handleChange(option.value)}
        aria-checked={value === option.value}
        role="radio"
        title={option.description || option.label}
      >
        <div class="toggle-content" in:fade={{ duration: 200 }}>
          {#if option.icon}
            <span class="toggle-icon" aria-hidden="true">{option.icon}</span>
          {/if}
          <span class="toggle-label">{option.label}</span>
        </div>
      </button>
    {/each}
  </div>
</div>

<style>
  .toggle-group {
    width: 100%;
    background: transparent;
    margin-bottom: var(--spacing-md);
  }

  .toggle-container {
    display: flex;
    gap: var(--spacing-xs);
    position: relative;
    z-index: 1;
    border-radius: var(--rounded-lg);
    background-color: var(--color-background-alt);
    padding: var(--spacing-2xs);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
    border: 1px solid var(--color-border);
    margin: 0.5rem 0;
  }

  .toggle-button {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-sm);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--rounded-lg);
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    cursor: pointer;
    transition: all var(--transition-duration-normal);
    overflow: hidden;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .toggle-button::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: var(--rounded-lg);
    background: linear-gradient(135deg,
      #00A99D 0%,
      #00A99D 40%,
      #F7931E 100%
    );
    background-size: 200% 200%;
    animation: gradientFlow 6s ease infinite;
    opacity: 0;
    transition: opacity var(--transition-duration-normal);
  }

  .toggle-button.active {
    color: var(--color-text);
    font-weight: var(--font-weight-bold);
    border-color: transparent;
    transform: translateY(-1px);
    box-shadow: 0 3px 6px rgba(0, 0, 0, 0.15);
  }

  .toggle-button.active::before {
    opacity: 1;
  }

  .toggle-button:hover:not(.active) {
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .toggle-content {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    position: relative;
    z-index: 1;
  }

  .toggle-button.active .toggle-content {
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .toggle-icon {
    font-size: 1.2em;
    transition: transform var(--transition-duration-normal);
  }

  .toggle-label {
    font-weight: var(--font-weight-medium);
    transition: all var(--transition-duration-normal);
  }

  .toggle-button.active .toggle-label {
    font-weight: var(--font-weight-bold);
  }

  .toggle-button:hover .toggle-icon,
  .toggle-button.active .toggle-icon {
    transform: scale(1.1);
  }

  /* Responsive */
  @media (max-width: 640px) {
    .toggle-container {
      padding: var(--spacing-2xs);
    }

    .toggle-button {
      padding: var(--spacing-xs) var(--spacing-sm);
    }

    .toggle-icon {
      font-size: 1.1em;
    }
  }

  /* High Contrast Mode */
  @media (prefers-contrast: high) {
    .toggle-button {
      border-width: 2px;
    }

    .toggle-button.active {
      outline: 2px solid var(--color-prime);
    }

    .toggle-button.active::before {
      opacity: 0.7;
    }
  }

  /* Reduced Motion */
  @media (prefers-reduced-motion: reduce) {
    .toggle-button,
    .toggle-icon,
    .toggle-label {
      transition: none;
    }

    .toggle-button:hover .toggle-icon,
    .toggle-button.active .toggle-icon {
      transform: none;
    }

    .toggle-button::before {
      animation: none;
    }
  }

  /* Dark Mode Adjustments */
  @media (prefers-color-scheme: dark) {
    .toggle-button {
      background-color: var(--color-surface-dark, var(--color-surface));
      border-color: var(--color-border-dark, var(--color-border));
    }

    .toggle-button.active .toggle-content {
      filter: brightness(1.2);
    }
  }

  /* Gradient animation */
  @keyframes gradientFlow {
    0% { background-position: 0% 0%; }
    50% { background-position: 100% 100%; }
    100% { background-position: 0% 0%; }
  }
</style>