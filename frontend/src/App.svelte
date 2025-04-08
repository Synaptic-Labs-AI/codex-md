<!-- 
  App.svelte - Main application component
  This component serves as the root of our application, handling:
  - Client-side routing via svelte-spa-router
  - Global layout and styling
  - Welcome state management
  Connects to:
  - /src/routes.js for route definitions
  - lib/stores/welcomeState.js for welcome message tracking
  - lib/components/OfflineStatusBar.svelte for offline status display
-->
<script>
  import Router from 'svelte-spa-router';
  import { routes } from './routes';
  import { onMount } from 'svelte';
  import welcomeState from './lib/stores/welcomeState';
  import OfflineStatusBar from './lib/components/OfflineStatusBar.svelte';
  import Navigation from './lib/components/common/Navigation.svelte';

  let hasSeenWelcome;
  
  // Subscribe to welcome state
  const unsubscribe = welcomeState.subscribe(state => {
    hasSeenWelcome = state.hasSeenWelcome;
  });
  
  onMount(() => {
    // Clean up subscription
    return () => {
      unsubscribe();
    };
  });
</script>

<main>
  <OfflineStatusBar />
  <Navigation />
  <div class="app-container">
    <Router {routes} />
  </div>
</main>

<style>
  .app-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem;
  }
  
  main {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
</style>
