<!-- 
  Timer.svelte
  
  A simple time display component that shows elapsed time in HH:MM:SS format.
  
  Related files:
  - frontend/src/lib/stores/conversionTimer.js: Timer functionality
  - frontend/src/lib/components/ConversionProgress.svelte: Primary consumer
-->
<script>
  export let time = '00:00:00';
  export let label = 'Time elapsed';
  
  let hours = '00';
  let minutes = '00';
  let seconds = '00';
  
  // Update time segments
  $: {
    [hours, minutes, seconds] = time.split(':');
  }
</script>

<div class="timer-display" role="timer" aria-label={label}>
  <span class="time-segment">{hours}</span>
  <span class="separator">:</span>
  <span class="time-segment">{minutes}</span>
  <span class="separator">:</span>
  <span class="time-segment">{seconds}</span>
</div>

<style>
  .timer-display {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: var(--font-size-lg);
    color: var(--color-text);
    background-color: rgba(251, 247, 241, 0.5); /* Light mode: based on --color-surface: #fbf7f1 */
    backdrop-filter: blur(8px);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--rounded-full);
    box-shadow: var(--shadow-sm);
    border: 1px solid rgba(var(--color-prime-rgb), 0.2);
    transition: all 0.3s ease;
    margin: var(--spacing-md) auto;
    max-width: fit-content;
  }
  
  .timer-display:hover {
    background-color: rgba(251, 247, 241, 0.7);
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }
  
  /* Dark mode support */
  @media (prefers-color-scheme: dark) {
    .timer-display {
      background-color: rgba(42, 42, 42, 0.5); /* Dark mode: based on --color-surface: #1a1a1a in dark mode */
      border: 1px solid rgba(var(--color-prime-rgb), 0.3);
    }
    
    .timer-display:hover {
      background-color: rgba(42, 42, 42, 0.7);
    }
  }

  .time-segment {
    min-width: 1.8em;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    background: linear-gradient(135deg,
      var(--color-prime) 0%,
      var(--color-fourth) 100%
    );
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .separator {
    color: var(--color-text-light);
    font-weight: 300;
    opacity: 0.4;
    margin: 0 2px;
  }

  @media (max-width: 640px) {
    .timer-display {
      font-size: var(--font-size-base);
      padding: var(--spacing-xs);
    }
  }
</style>
