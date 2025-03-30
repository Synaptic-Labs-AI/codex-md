<script>
  import { onMount } from 'svelte';
  import WelcomeChat from './common/WelcomeChat.svelte';
  import FileUploader from './FileUploader.svelte';
  import Button from './common/Button.svelte';
  import Container from './common/Container.svelte';
  import { files } from '$lib/stores/files.js';
  import { startConversion, triggerDownload } from '$lib/utils/conversionManager.js';
  import { conversionResult } from '$lib/stores/conversionResult.js';
  import { conversionStatus } from '$lib/stores/conversionStatus.js';
  import welcomeState from '$lib/stores/welcomeState.js';
  import ResultDisplay from './ResultDisplay.svelte';

  let mode = 'upload';
  let hasSeenWelcome = false;
  
  // Subscribe to the welcome state store
  const unsubscribe = welcomeState.subscribe(value => {
    hasSeenWelcome = value;
  });

  // Function to smoothly scroll to top of page
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Subscribe to conversion status changes
  $: if ($conversionStatus.status === 'completed') {
    mode = 'converted';
    scrollToTop();
  }

  function handleStartConversion() {
    mode = 'converting';
    scrollToTop();
    conversionResult.clearResult();
    startConversion();
  }

  function handleConvertMore() {
    scrollToTop();
    files.clearFiles();
    conversionStatus.reset();
    conversionResult.clearResult();
    mode = 'upload';
  }

  // Setup on mount and cleanup
  onMount(() => {
    // Cleanup subscriptions
    return () => {
      unsubscribe();
    };
  });
</script>

<div class="app-container">
  <div class="converter-app">
    {#if mode === 'upload'}
      <div class="main-content">
        <FileUploader />
        {#if $files.length > 0}
          <div class="button-container">
            <Button
              variant="primary"
              size="large"
              fullWidth
              on:click={handleStartConversion}
            >
              Start Conversion
            </Button>
          </div>
        {/if}
      </div>
      <WelcomeChat />
    {:else if mode === 'converting'}
      <ResultDisplay 
        on:startConversion={handleStartConversion}
        on:convertMore={handleConvertMore} 
      />
    {:else if mode === 'converted'}
      <ResultDisplay 
        on:startConversion={handleStartConversion}
        on:convertMore={handleConvertMore}
      />
    {/if}
  </div>
</div>

<style>
  .app-container {
    width: 100%;
    min-height: 100vh;
    display: flex;
    justify-content: center;
    padding: var(--spacing-sm);
    background-color: var(--color-background);
  }

  .converter-app {
    width: 100%;
    max-width: 1200px;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2xs);
  }

  .main-content {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    padding: var(--spacing-sm);
  }

  .button-container {
    width: 100%;
    display: flex;
    justify-content: center;
    padding: var(--spacing-2xs) 0;
    margin-top: var(--spacing-md);
  }
</style>
