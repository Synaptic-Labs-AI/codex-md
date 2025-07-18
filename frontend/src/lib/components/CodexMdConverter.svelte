<script>
  import { onMount } from 'svelte';
  import WelcomeChat from './common/WelcomeChat.svelte';
  import FileUploader from './FileUploader.svelte';
  import Container from './common/Container.svelte';
  import { files } from '../stores/files.js';
  import { startConversion } from '../utils/conversion';
  import { conversionResult } from '../stores/conversionResult.js';
  import { unifiedConversion, ConversionState } from '../stores/unifiedConversion.js';
  import welcomeState, { MESSAGE_TYPES } from '../stores/welcomeState.js';
  import ResultDisplay from './ResultDisplay.svelte';

  let mode = 'welcome'; // Start with welcome mode
  let showWelcome = false;
  let hasCompletedConversion = false; // Track if a conversion has completed
  
  // Function to smoothly scroll to top of page
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Check if current conversion is a website conversion
  $: isWebsiteConversion = $unifiedConversion.type === ConversionState.TYPE.WEBSITE;
  
  // Subscribe to conversion status and result changes
  $: if ($unifiedConversion.status === ConversionState.STATUS.COMPLETED || $unifiedConversion.completionTime) {
    mode = 'converted';
    hasCompletedConversion = true;
    scrollToTop();
  } else if ($unifiedConversion.status === ConversionState.STATUS.CANCELLED) {
    // Handle cancellation - return to upload mode after cleanup
    handleCancellation();
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
    unifiedConversion.reset();
    conversionResult.clearResult();
    hasCompletedConversion = false; // Reset the completion flag
    mode = 'upload';
  }
  
  // Handle cancellation - clean up and return to upload mode
  function handleCancellation() {
    // Show cancellation briefly, then return to upload mode
    setTimeout(() => {
      scrollToTop();
      files.clearFiles();
      unifiedConversion.reset();
      conversionResult.clearResult();
      hasCompletedConversion = false;
      mode = 'upload';
    }, 2000); // Show cancellation message for 2 seconds
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
    // Check if we should show welcome messages (now synchronous with localStorage)
    showWelcome = welcomeState.shouldShowWelcome();
    console.log('[CodexMdConverter] Should show welcome:', showWelcome);
    
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
        <FileUploader
          showConversionButton={$files.length > 0}
          onStartConversion={handleStartConversion}
        />
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
    flex-direction: column;
    align-items: center;
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
  
  /* Button container styling moved to FileList.svelte */
</style>
