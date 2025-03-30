<script>
  export let size = 'medium'; // tiny, small, medium, large, extra-large
  export let showText = true;
  export let className = '';
</script>

<div class="logo {size} {className}">
  <div class="logo-icon">
    <img src="/logo.png" alt="codex.md Logo" />
  </div>
  {#if showText}
    <div class="logo-text">
      <span class="codex-md-brand">codex.md</span>
    </div>
  {/if}
</div>

<style>
  .logo {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    transition: transform 0.3s ease;
  }
  
  .logo:hover {
    transform: scale(1.05);
  }
  
  .logo-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
    transition: filter 0.3s ease;
  }
  
  .logo:hover .logo-icon {
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15));
  }
  
  .logo-icon img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    max-width: 100%;
  }
  
  .logo-text {
    font-weight: 700;
    display: flex;
    align-items: center;
    position: relative;
    transition: transform 0.3s ease;
  }
  
  .logo:hover .logo-text {
    transform: translateY(-1px);
  }
  
  
  /* Brand gradient text */
  .logo-text :global(.codex-md-brand) {
    font-weight: 700;
    background: linear-gradient(135deg, 
      #00A99D 0%,
      #00A99D 40%,
      #F7931E 100%
    );
    background-size: 400% 400%;
    animation: gradientFlow 8s ease infinite;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    display: inline-block;
    position: relative;
    z-index: 1;
  }

  @keyframes gradientFlow {
    0% {
      background-position: 0% 0%;
    }
    50% {
      background-position: 100% 100%;
    }
    100% {
      background-position: 0% 0%;
    }
  }

  /* Sizes */
  .tiny .logo-icon {
    width: 48px;
    height: 48px;
  }
  
  .tiny .logo-text {
    font-size: var(--font-size-base);
  }
  
  .small .logo-icon {
    width: 56px;
    height: 56px;
  }
  
  .small .logo-text {
    font-size: var(--font-size-lg);
  }
  
  .medium .logo-icon {
    width: 64px;
    height: 64px;
  }
  
  .medium .logo-text {
    font-size: var(--font-size-xl);
  }
  
  .large .logo-icon {
    width: 72px;
    height: 72px;
  }
  
  .large .logo-text {
    font-size: var(--font-size-2xl);
  }
  
  .extra-large .logo-icon {
    width: 84px;
    height: 84px;
  }
  
  .extra-large .logo-text {
    font-size: var(--font-size-3xl);
  }
  
  @media (max-width: 640px) {
    .medium .logo-icon {
      width: 52px;
      height: 52px;
    }
    
    .medium .logo-text {
      font-size: var(--font-size-lg);
    }
    
    .large .logo-icon {
      width: 60px;
      height: 60px;
    }
    
    .large .logo-text {
      font-size: var(--font-size-xl);
    }
    
    .extra-large .logo-icon {
      width: 72px;
      height: 72px;
    }
    
    .extra-large .logo-text {
      font-size: var(--font-size-2xl);
    }
  }
</style>
