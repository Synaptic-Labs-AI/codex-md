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
  import welcomeState, { MESSAGE_TYPES } from '$lib/stores/welcomeState.js';
  import ResultDisplay from './ResultDisplay.svelte';

  let mode = 'welcome'; // Start with welcome mode
  let showWelcome = false;
  let hasCompletedConversion = false; // Track if a conversion has completed
  
  // Function to smoothly scroll to top of page
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Website-specific conversion states
  const websiteStates = [
    'finding_sitemap',
    'parsing_sitemap',
    'crawling_pages',
    'processing_pages',
    'generating_index'
  ];
  
  // Check if current status is a website conversion state
  $: isWebsiteConversion = websiteStates.includes($conversionStatus.status);
  
  // Subscribe to conversion status and result changes
  $: if ($conversionStatus.status === 'completed' || $conversionStatus.completionTimestamp) {
    mode = 'converted';
    hasCompletedConversion = true;
    scrollToTop();
  } else if (isWebsiteConversion) {
    // Ensure we're in converting mode for website conversions
    mode = 'converting';
  }
  
  // If we have a result, ensure we're in converted mode
  $: if ($conversionResult && $conversionResult.success) {
    if (!hasCompletedConversion) {
      mode = 'converted';
      hasCompletedConversion = true;
      scrollToTop();
    }
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
    hasCompletedConversion = false; // Reset the completion flag
    mode = 'upload';
  }
  
  // Handle welcome chat closed event
  function handleWelcomeClosed() {
    mode = 'upload';
  }
  
  // Handle welcome chat continue event
  function handleWelcomeContinue() {
    mode = 'upload';
  }

  // Setup on mount
  onMount(() => {
    // Check if we should show welcome messages
    showWelcome = welcomeState.shouldShowWelcome();
    
    // If we shouldn't show welcome, go straight to upload mode
    if (!showWelcome) {
      mode = 'upload';
    }
  });
</script>

<div class="app-container">
  <div class="converter-app">
    {#if mode === 'welcome'}
      <WelcomeChat 
        messageType={MESSAGE_TYPES.WELCOME}
        on:closed={handleWelcomeClosed}
        on:continue={handleWelcomeContinue}
      />
    {:else if mode === 'upload'}
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
