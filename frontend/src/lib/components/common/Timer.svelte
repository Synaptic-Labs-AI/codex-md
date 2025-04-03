<!-- src/lib/components/common/Timer.svelte -->
<script>
  import { onMount } from 'svelte';
  export let time = '00:00:00';
  export let label = 'Time elapsed';
  
  let hours = '00';
  let minutes = '00';
  let seconds = '00';
  let circumference = 2 * Math.PI * 47; // Circle radius is 47
  let dashOffset = circumference;
  
  // Update time segments and progress circle
  $: {
    [hours, minutes, seconds] = time.split(':');
    // Calculate progress for the circle (based on minutes in an hour)
    const totalMinutes = parseInt(hours) * 60 + parseInt(minutes);
    const progress = Math.min((totalMinutes % 60) / 60, 1);
    dashOffset = circumference * (1 - progress);
  }
  
  // Animation for gradient rotation
  let gradientRotation = 0;
  let animationFrame;
  
  function animateGradient() {
    gradientRotation = (gradientRotation + 0.2) % 360;
    animationFrame = requestAnimationFrame(animateGradient);
  }
  
  onMount(() => {
    animateGradient();
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  });
</script>

<div class="timer-container" role="timer" aria-label={label}>
  <svg class="timer-circle" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <!-- Gradient definitions -->
    <defs>
      <linearGradient id="circleGradient" gradientTransform="rotate({gradientRotation} 0.5 0.5)">
        <stop offset="0%" stop-color="var(--color-prime)" />
        <stop offset="50%" stop-color="var(--color-fourth)" />
        <stop offset="100%" stop-color="var(--color-prime)" />
      </linearGradient>
    </defs>
    
    <!-- Background circle -->
    <circle
      class="timer-circle-bg"
      cx="50"
      cy="50"
      r="47"
      fill="none"
      stroke="var(--color-border)"
      stroke-width="2"
    />
    
    <!-- Progress circle -->
    <circle
      class="timer-circle-progress"
      cx="50"
      cy="50"
      r="47"
      fill="none"
      stroke="url(#circleGradient)"
      stroke-width="3"
      stroke-dasharray={circumference}
      stroke-dashoffset={dashOffset}
      stroke-linecap="round"
      transform="rotate(-90 50 50)"
    />
  </svg>
  
  <div class="timer-content">
    <div class="timer-icon" style="transform: rotate({gradientRotation}deg)">⏱️</div>
    <div class="time-display">
      <div class="time-segment-container">
        <span class="time-label">HH</span>
        <span class="time-segment">{hours}</span>
      </div>
      <span class="separator">:</span>
      <div class="time-segment-container">
        <span class="time-label">MM</span>
        <span class="time-segment">{minutes}</span>
      </div>
      <span class="separator">:</span>
      <div class="time-segment-container">
        <span class="time-label">SS</span>
        <span class="time-segment">{seconds}</span>
      </div>
    </div>
  </div>
</div>

<style>
  .timer-container {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 200px;
    height: 200px;
    margin: 0 auto;
  }

  .timer-circle {
    position: absolute;
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }

  .timer-circle-bg {
    opacity: 0.1;
  }

  .timer-circle-progress {
    transition: stroke-dashoffset 0.3s ease;
  }

  .timer-content {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--spacing-sm);
    z-index: 1;
  }

  .timer-icon {
    font-size: 1.5em;
    transition: transform 0.1s linear;
  }

  .time-display {
    display: flex;
    align-items: center;
    gap: var(--spacing-2xs);
    font-family: var(--font-mono);
    font-size: var(--font-size-lg);
    color: var(--color-text);
    background: var(--color-surface);
    padding: var(--spacing-sm);
    border-radius: var(--rounded-md);
    box-shadow: var(--shadow-sm);
  }

  .time-segment-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .time-label {
    font-size: var(--font-size-2xs);
    color: var(--color-text-light);
    font-weight: 500;
    opacity: 0.7;
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
    margin-top: 1.2em;
  }

  @media (max-width: 640px) {
    .timer-container {
      width: 150px;
      height: 150px;
    }

    .time-display {
      font-size: var(--font-size-base);
      padding: var(--spacing-xs);
    }

    .timer-icon {
      font-size: 1.2em;
    }
  }
</style>
