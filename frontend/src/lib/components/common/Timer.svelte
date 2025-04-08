<!-- 
  Timer.svelte
  
  A simple time display component that shows elapsed time in HH:MM:SS format.
  
  Related files:
  - frontend/src/lib/stores/conversionTimer.js: Timer functionality
  - frontend/src/lib/components/ConversionProgress.svelte: Primary consumer
-->
<script>
  import { unifiedConversion } from '../../../lib/stores/unifiedConversion';
  
  export let time = '00:00:00';
  export let label = 'Time elapsed';
  
  let hours = '00';
  let minutes = '00';
  let seconds = '00';
  
  // Get formatted time from unifiedConversion store
  $: formattedTime = unifiedConversion.formatElapsedTime($unifiedConversion.elapsedSeconds);
  
  // Update time segments
  $: {
    [hours, minutes, seconds] = formattedTime.split(':');
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
    font-size: var(--font-size-2xl);
    color: var(--color-text);
    margin: var(--spacing-md) auto;
    max-width: fit-content;
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
    font-size: var(--font-size-xl);
    padding: var(--spacing-xs) var(--spacing-md);
    }
  }
</style>
