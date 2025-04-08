<!-- src/lib/components/common/Navigation.svelte -->
<script>
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import Logo from './Logo.svelte';
  
</script>

<nav class="navigation">
  <div class="nav-brand">
    <a href="/" class="brand-link">
      <Logo size="medium" />
    </a>
  </div>
  
<div class="nav-links">
    <a 
      href="/" 
      class="nav-link" 
      class:active={$page.url.pathname === '/'}
    >
      Convert
    </a>
    
    <a 
      href="/help" 
      class="nav-link" 
      class:active={$page.url.pathname === '/help'}
    >
      Help
    </a>
    
    <a 
      href="/about" 
      class="nav-link" 
      class:active={$page.url.pathname === '/about'}
    >
      About
    </a>
    
    <a 
      href="/settings" 
      class="nav-link" 
      class:active={$page.url.pathname === '/settings'}
    >
      Settings
    </a>
  </div>
</nav>

<style>
  .navigation {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 1.25rem;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }
  
  .nav-brand {
    display: flex;
    align-items: center;
    padding: 0.5rem;
    border-radius: var(--rounded-md);
    transition: transform 0.3s ease;
    z-index: 10; /* Ensure the brand is above other elements */
  }
  
  .nav-brand:hover {
    transform: translateY(-1px);
  }
  
  .brand-link {
    text-decoration: none;
    display: flex;
    align-items: center;
    padding: 0.25rem 0.5rem;
  }
  
  .nav-links {
    display: flex;
    gap: 1.5rem;
  }
  
  .nav-link {
    color: var(--color-text);
    text-decoration: none;
    font-weight: 500;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    transition: all 0.2s ease;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  
  .nav-link:hover {
    color: var(--color-prime);
    background: var(--color-background);
    border-color: var(--color-prime);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transform: translateY(-1px);
  }
  
  .nav-link.active {
    color: var(--color-prime);
    font-weight: 600;
    border-color: var(--color-prime);
    background: color-mix(in srgb, var(--color-prime) 5%, var(--color-surface));
  }
  
  @media (max-width: 640px) {
    .navigation {
      padding: 0.75rem;
    }
    
    .nav-brand {
      font-size: 1.25rem;
    }
    
    .nav-links {
      gap: 1rem;
    }
  }
</style>
