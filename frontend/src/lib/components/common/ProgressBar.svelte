<!-- src/lib/components/common/ProgressBar.svelte -->
<script>
  import { spring } from 'svelte/motion';

  export let value = 0;       // 0 -> 100
  export let color = '#3B82F6'; // fallback to a bright, typical "primary" color
  export let height = '4px';
  export let showGlow = true;

  const progress = spring(0, {
    stiffness: 0.1,
    damping: 0.4
  });

  $: progress.set(value);
</script>

<div 
  class="progress-bar"
  style="height: {height}"
>
  <div 
    class="progress-fill {showGlow ? 'with-glow' : ''}"
    style="
      width: {$progress}%;
      background: {color};
    "
  >
    {#if showGlow}
      <div class="progress-glow"></div>
    {/if}
  </div>
</div>

<style>
  .progress-bar {
    width: 100%;
    background: transparent;
    border-radius: 9999px;
    overflow: hidden;
    position: relative;
  }

  .progress-bar::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: 9999px;
    padding: 2px;
    background: linear-gradient(135deg, var(--color-prime), var(--color-fourth));
    -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    opacity: 0.3;
  }

  .progress-fill {
    height: 100%;
    transition: background-color 0.3s ease;
    border-radius: 9999px;
    position: relative;
    background: linear-gradient(90deg, var(--color-prime), var(--color-fourth)) !important;
  }

  .progress-fill.with-glow {
    filter: drop-shadow(0 0 2px var(--color-prime));
  }

  .progress-glow {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.2) 50%,
      transparent 100%
    );
    animation: shine 1.5s linear infinite;
  }

  @keyframes shine {
    from { transform: translateX(-100%); }
    to   { transform: translateX(100%); }
  }

  /* High Contrast */
  @media (prefers-contrast: high) {
    .progress-bar::before {
      padding: 3px;
      opacity: 1;
    }
  }
</style>
