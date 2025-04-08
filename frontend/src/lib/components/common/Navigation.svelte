<!-- 
  Navigation.svelte - Main navigation component
  Provides application-wide navigation with active route tracking.
  
  Features:
  - Route-aware navigation links
  - Responsive design
  - Brand logo/link
  - Active state highlighting
  
  Dependencies:
  - svelte-spa-router for navigation and route tracking
  - Logo component for branding
-->
<script>
  import { location, push } from 'svelte-spa-router';
  import { onMount } from 'svelte';
  import Logo from './Logo.svelte';
  
  // Handle client-side navigation
  function handleClick(e, path) {
    e.preventDefault();
    push(path);
  }
</script>

<nav class="navigation">
  <div class="nav-brand">
    <a href="/" on:click={(e) => handleClick(e, '/')} class="brand-link">
      <Logo size="medium" />
    </a>
  </div>
  
  <div class="nav-links">
    <a 
      href="/" 
      on:click={(e) => handleClick(e, '/')}
      class="nav-link" 
      class:active={$location === '/'}
    >
      Convert
    </a>
    
    <a 
      href="/help" 
      on:click={(e) => handleClick(e, '/help')}
      class="nav-link" 
      class:active={$location === '/help'}
    >
      Help
    </a>
    
    <a 
      href="/about" 
      on:click={(e) => handleClick(e, '/about')}
      class="nav-link" 
      class:active={$location === '/about'}
    >
      About
    </a>
    
    <a 
      href="/settings" 
      on:click={(e) => handleClick(e, '/settings')}
      class="nav-link" 
      class:active={$location === '/settings'}
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
    box-shadow: var(--shadow-sm);
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
    background: var(--color-surface);
    border-radius: var(--rounded-lg);
    padding: 0.25rem 0.5rem;
  }
  
  .nav-link {
    color: var(--color-text);
    text-decoration: none;
    font-weight: 500;
    padding: 0.6rem 1rem;
    border-radius: var(--rounded-md);
    transition: all 0.2s ease;
    position: relative;
  }
  
  .nav-link::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%;
    width: 0;
    height: 2px;
    background: var(--color-prime);
    transition: all 0.3s ease;
    transform: translateX(-50%);
    opacity: 0;
  }
  
  .nav-link:hover {
    color: var(--color-prime);
    background: color-mix(in srgb, var(--color-prime) 5%, transparent);
  }
  
  .nav-link:hover::after {
    width: 70%;
    opacity: 1;
  }
  
  .nav-link.active {
    color: var(--color-prime);
    font-weight: 600;
    background: color-mix(in srgb, var(--color-prime) 8%, transparent);
  }
  
  .nav-link.active::after {
    width: 70%;
    opacity: 1;
  }
  
  @media (max-width: 640px) {
    .navigation {
      padding: 0.75rem;
    }
    
    .nav-brand {
      font-size: 1.25rem;
    }
    
    .nav-links {
      gap: 0.5rem;
      padding: 0.15rem 0.25rem;
    }
    
    .nav-link {
      padding: 0.5rem 0.75rem;
      font-size: 0.9rem;
    }
  }

  /* High Contrast Mode */
  @media (prefers-contrast: high) {
    .nav-link {
      outline: 1px solid transparent;
    }
    
    .nav-link.active {
      outline: 2px solid currentColor;
      outline-offset: -2px;
    }
    
    .nav-link::after {
      height: 3px;
    }
  }
</style>
