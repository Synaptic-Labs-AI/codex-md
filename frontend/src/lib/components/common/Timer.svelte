<!-- src/lib/components/common/Timer.svelte -->
<script>
  export let time = '00:00:00';
  export let label = 'Time elapsed';
</script>

<div class="timer-container" role="timer" aria-label={label}>
  <div class="timer-icon">⏱️</div>
  <div class="timer-display">
    {#each time.split(':') as segment, i}
      <span class="time-segment">{segment}</span>
      {#if i < 2}
        <span class="separator">:</span>
      {/if}
    {/each}
  </div>
</div>

<style>
  .timer-container {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--rounded-md);
    box-shadow: var(--shadow-sm);
    font-family: var(--font-mono);
    font-size: var(--font-size-base);
    color: var(--color-text);
    margin: 0 auto;
    width: fit-content;
    transition: all 0.2s ease;
  }

  .timer-container:hover {
    border-color: var(--color-prime);
    box-shadow: var(--shadow-md);
  }

  .timer-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9em;
    color: var(--color-text-light);
    opacity: 0.8;
  }

  .timer-display {
    display: flex;
    align-items: center;
    gap: var(--spacing-2xs);
  }

  .time-segment {
    min-width: 1.8em;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .separator {
    color: var(--color-text-light);
    font-weight: 300;
    opacity: 0.6;
    margin: 0 -1px;
  }

  /* Subtle pulse animation for active timer */
  @keyframes pulse {
    0% { opacity: 0.8; }
    50% { opacity: 1; }
    100% { opacity: 0.8; }
  }

  .timer-container:hover {
    border-color: var(--color-prime);
  }

  .timer-container:hover .timer-icon {
    color: var(--color-prime);
    animation: pulse 2s ease-in-out infinite;
  }

  @media (max-width: 640px) {
    .timer-container {
      padding: var(--spacing-xs) var(--spacing-sm);
      font-size: var(--font-size-sm);
    }
  }
</style>
