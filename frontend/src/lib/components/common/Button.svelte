<script>
  export let variant = 'primary'; // primary, secondary, danger
  export let type = 'button';
  export let disabled = false;
  export let fullWidth = false;
  export let size = 'medium'; // small, medium, large
  
  // Rest props to handle any additional attributes like data-testid
  let restProps = {};
  export { restProps as $$restProps };
</script>

<button
  {type}
  {disabled}
  class="button {variant} {size} {$$restProps.class || ''}"
  class:full-width={fullWidth}
  on:click
  {...$$restProps}
>
  <slot />
</button>

<style>
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-sm) var(--spacing-xl);
    border: none;
    border-radius: var(--rounded-lg);
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: var(--font-size-base);
    gap: var(--spacing-xs);
    position: relative;
  }

  .button:disabled {
    background: var(--color-disabled);
    cursor: not-allowed;
    opacity: 0.7;
  }

  .button.primary {
    background: linear-gradient(90deg, var(--color-prime), var(--color-fourth));
    color: white;
    background-size: 200% 200%;
    animation: breathe 3s ease-in-out infinite;
  }

  .button.secondary {
    background: transparent;
    color: var(--color-text);
    position: relative;
  }

  .button.secondary::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--rounded-lg);
    padding: 2px;
    background: linear-gradient(135deg, var(--color-prime), var(--color-fourth));
    -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }

  .button.danger {
    background: linear-gradient(90deg, var(--color-error), var(--color-error-light));
    color: white;
    background-size: 200% 200%;
    animation: breathe 3s ease-in-out infinite;
  }

  .button:not(:disabled):hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .button.primary:not(:disabled):hover,
  .button.danger:not(:disabled):hover {
    background-size: 150% 150%;
  }

  .button.secondary:not(:disabled):hover::before {
    background: linear-gradient(135deg, var(--color-fourth), var(--color-prime));
  }

  .full-width {
    width: 100%;
  }

  /* Size variants */
  .small {
    padding: var(--spacing-xs) var(--spacing-lg);
    font-size: var(--font-size-sm);
  }

  .large {
    padding: var(--spacing-md) var(--spacing-2xl);
    font-size: var(--font-size-lg);
  }

  @keyframes breathe {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }

  /* High Contrast Mode */
  @media (prefers-contrast: high) {
    .button.secondary::before {
      padding: 3px;
    }
  }

  /* Reduced Motion */
  @media (prefers-reduced-motion: reduce) {
    .button {
      animation: none;
    }
    
    .button:hover {
      transform: none;
    }

    .button.primary:hover,
    .button.danger:hover {
      background-size: 200% 200%;
      background-position: 0% 50%;
    }
  }
</style>
