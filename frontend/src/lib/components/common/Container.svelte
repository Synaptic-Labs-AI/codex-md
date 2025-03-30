<!-- src/lib/components/common/Container.svelte -->
<script>
  export let title = ''; // Optional title prop
  export let subtitle = ''; // Optional subtitle prop
  export let noPadding = false; // Option to remove padding
  export let isGradient = false; // Option for gradient background
  let className = ''; // Additional classes
  export { className as class };
  export let maxWidth = '1000px'; // Default max-width
</script>

<div class="container {className} {isGradient ? 'gradient' : ''}" style="max-width: {maxWidth};">
  {#if title}
    <div class="container-header">
      <h2 class="title">{title}</h2>
      {#if subtitle}
        <p class="subtitle">{subtitle}</p>
      {/if}
    </div>
  {/if}
  <div class="content" class:no-padding={noPadding}>
    <slot />
  </div>
</div>

<style>
  .container {
    background: transparent;
    border-radius: var(--rounded-lg);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    transition: transform var(--transition-duration-normal) var(--transition-timing-ease),
                box-shadow var(--transition-duration-normal) var(--transition-timing-ease);
    width: 100%;
    position: relative;
  }

  /* Gradient border using background-image with a white background */
  .container::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--rounded-lg);
    padding: 2px; /* Border width */
    background: linear-gradient(135deg, var(--color-prime), var(--color-fourth));
    -webkit-mask: 
      linear-gradient(#fff 0 0) content-box, 
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }

  /* Remove gradient styles since we're using borders for all containers */
  .container.gradient {
    color: var(--color-text);
  }

  .container:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }

  .container-header {
    padding: var(--spacing-sm) var(--spacing-md);
    border-bottom: 1px solid var(--color-border);
  }

  .title {
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-semibold);
    color: inherit;
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .subtitle {
    font-size: var(--font-size-base);
    color: inherit;
    opacity: 0.8;
    margin: var(--spacing-sm) 0 0;
  }

  .content {
    padding: var(--spacing-md);
    color: inherit;
  }

  .content.no-padding {
    padding: 0;
  }

  /* Update gradient styles to use primary text color */
  .gradient :global(*) {
    color: var(--color-text);
  }

  .gradient .content :global(a) {
    color: var(--color-text);
    text-decoration: underline;
    opacity: 0.8;
  }

  .gradient .content :global(a:hover) {
    opacity: 1;
  }

  .gradient .content :global(.accordion-wrapper) {
    border-color: var(--color-border);
  }

  /* Responsive adjustments */
  @media (min-width: 1440px) {
    .container-header {
      padding: var(--spacing-md) var(--spacing-lg);
    }

    .content {
      padding: var(--spacing-lg);
    }
  }

  @media (max-width: 768px) {
    .container-header {
      padding: var(--spacing-xs) var(--spacing-sm);
    }

    .content {
      padding: var(--spacing-sm);
    }

    .title {
      font-size: var(--font-size-lg);
    }
  }

  @media (max-width: 640px) {
    .container-header {
      padding: var(--spacing-2xs) var(--spacing-xs);
    }

    .content {
      padding: var(--spacing-xs);
    }

    .title {
      font-size: var(--font-size-base);
    }
  }

  /* High contrast mode */
  @media (prefers-contrast: high) {
    .container {
      border: 2px solid currentColor;
    }
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .container {
      transition: none;
    }

    .container:hover {
      transform: none;
    }
  }
</style>
