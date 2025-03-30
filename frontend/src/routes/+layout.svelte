<script>
  // Import custom styles
  import '$lib/styles/global.css';
  import Navigation from '$lib/components/common/Navigation.svelte';
  import OfflineStatusBar from '$lib/components/OfflineStatusBar.svelte';
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
  <Navigation />
  
  <main>
    <slot />
  </main>
  
  <OfflineStatusBar />
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

  main {
    flex: 1;
    background-color: var(--color-background);
    padding: var(--spacing-md);
    box-sizing: border-box;
    /* Add padding to account for the offline status bar */
    padding-bottom: calc(var(--spacing-md) + 36px);
  }
</style>
