<!-- 
  App.svelte - Main application component
  This component serves as the root of our application, handling:
  - Client-side routing via svelte-spa-router
  - Global layout and styling
  - Welcome state management
  - Meta tags and global styles
  Connects to:
  - /src/routes.js for route definitions
  - lib/stores/welcomeState.js for welcome message tracking
  - lib/components/OfflineStatusBar.svelte for offline status display
  - lib/styles/global.css for global styles
-->
<script>
  import Router from 'svelte-spa-router';
  import { routes } from './routes';
  import { onMount } from 'svelte';
  import welcomeState from './lib/stores/welcomeState';
  import { settings, applyTheme, getThemeMode } from './lib/stores/settings';
  import OfflineStatusBar from './lib/components/OfflineStatusBar.svelte';
  import Navigation from './lib/components/common/Navigation.svelte';
  import './lib/styles/global.css';

  let hasSeenWelcome;
  let currentTheme;

  // Subscribe to welcome state
  const unsubscribeWelcome = welcomeState.subscribe(state => {
    hasSeenWelcome = state.hasSeenWelcome;
  });

  // Subscribe to settings for theme changes
  const unsubscribeSettings = settings.subscribe(value => {
    if (value.theme?.mode && currentTheme !== value.theme.mode) {
      currentTheme = value.theme.mode;
      applyTheme(currentTheme);
      console.log(`[App] Applied theme: ${currentTheme}`);
    }
  });

  onMount(() => {
    // Initialize theme from settings
    const savedTheme = getThemeMode();
    console.log(`[App] Initial theme mode: ${savedTheme}`);

    // Force the theme to be applied on mount
    applyTheme(savedTheme);

    // Also initialize from electron settings if available
    if (window?.electron?.getSetting) {
      window.electron.getSetting('theme.mode')
        .then(value => {
          if (value !== undefined) {
            console.log(`[App] Electron theme setting: ${value}`);
            applyTheme(value);
          }
        })
        .catch(err => console.error('Error loading theme from electron:', err));
    }

    // Clean up subscriptions
    return () => {
      unsubscribeWelcome();
      unsubscribeSettings();
    };
  });
</script>

<svelte:head>
  <title>codex.md | Markdown Converter for Obsidian</title>
  <meta name="description" content="Convert various file types and web content to Markdown format for Obsidian" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#13151a" />
  <meta charset="utf-8" />
  <link rel="icon" href="/favicon.png" />
</svelte:head>

<div class="app-layout">
  <OfflineStatusBar />
  <Navigation />
  <main>
    <div class="app-container">
      <Router {routes} />
    </div>
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: var(--font-family-base);
    background-color: var(--color-background);
    color: var(--color-text);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .app-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .app-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem;
  }
  
  main {
    flex: 1;
    background-color: var(--color-background);
    padding: var(--spacing-md);
    box-sizing: border-box;
    /* Add padding to account for the offline status bar */
    padding-bottom: calc(var(--spacing-md) + 36px);
  }
</style>
