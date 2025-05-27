<!-- LiquidProgressBar.svelte -->
<script>
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  
  export let progress = 0;
  export let height = 24;
  export let showPercentage = true;
  
  // Smooth progress animation
  const progressTween = tweened(0, {
    duration: 300,
    easing: cubicOut
  });
  
  // Update tween when progress changes
  $: progressTween.set(progress);
</script>

<div class="progress-container" style="height: {height}px">
  <div class="progress-liquid" style="width: {$progressTween}%">
    <div class="liquid-wave"></div>
    <div class="liquid-shimmer"></div>
  </div>
  {#if showPercentage}
    <span class="progress-text">{Math.round($progressTween)}%</span>
  {/if}
</div>

<style>
  .progress-container {
    position: relative;
    width: 100%;
    background: #E5E7EB;
    border-radius: 12px;
    overflow: hidden;
    margin: 1rem 0;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.06);
  }

  .progress-liquid {
    position: absolute;
    height: 100%;
    background: linear-gradient(90deg, #3B82F6 0%, #9333EA 100%);
    background-size: 200% 200%;
    animation: breathe 3s ease-in-out infinite;
    transition: width 0.3s ease-out;
    overflow: hidden;
    border-radius: 12px;
  }

  /* Liquid wave effect */
  .liquid-wave {
    position: absolute;
    top: 0;
    left: -100%;
    width: 200%;
    height: 100%;
    background: linear-gradient(90deg, 
      transparent, 
      rgba(255, 255, 255, 0.3), 
      transparent
    );
    animation: wave 2s linear infinite;
  }

  /* Shimmer effect for extra liquid feel */
  .liquid-shimmer {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 100%;
    background: linear-gradient(0deg,
      transparent 0%,
      rgba(255, 255, 255, 0.1) 50%,
      transparent 100%
    );
    animation: shimmer 3s ease-in-out infinite;
  }

  @keyframes wave {
    0% { transform: translateX(0); }
    100% { transform: translateX(100%); }
  }

  @keyframes breathe {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.8; }
  }

  .progress-text {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: #374151;
    font-size: 0.875rem;
    font-weight: 500;
    text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
    z-index: 1;
  }

  /* Add subtle glow effect when progress is high */
  .progress-liquid {
    box-shadow: 0 0 20px rgba(147, 51, 234, 0.3);
  }
  
  /* Ensure smooth edges */
  .progress-liquid::after {
    content: '';
    position: absolute;
    top: 0;
    right: -1px;
    width: 2px;
    height: 100%;
    background: inherit;
  }
</style>