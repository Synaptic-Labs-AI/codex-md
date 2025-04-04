<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import Button from './common/Button.svelte';
  import Container from './common/Container.svelte';
  import ConversionProgress from './ConversionProgress.svelte';
  import WebsiteProgressDisplay from './WebsiteProgressDisplay.svelte';
  import { unifiedConversion, ConversionState, currentFile, websiteProgress } from '$lib/stores/unifiedConversion.js';
  import { conversionResult } from '$lib/stores/conversionResult.js';
  import { clearFiles, downloadHandler, storeManager } from '$lib/utils/conversion';
  import { files } from '$lib/stores/files.js';

  const dispatch = createEventDispatcher();
  
  // Reference to ConversionProgress component
  let conversionProgressComponent;

  // Local state for persistent completion
  let persistentCompletion = false;
  let hasCompletedOnce = false;

  // Reactive declarations for status
  $: isConverting = !persistentCompletion && [
    ConversionState.STATUS.PREPARING, 
    ConversionState.STATUS.CONVERTING, 
    'selecting_output', // Legacy status
    ConversionState.STATUS.INITIALIZING, 
    'initializing_workers', // Legacy status
    ConversionState.STATUS.CLEANING_UP,
    // Website-specific states (legacy)
    'finding_sitemap',
    'parsing_sitemap',
    'crawling_pages',
    'processing_pages',
    'generating_index'
  ].includes($unifiedConversion.status);
  
  // Check if this is a website conversion
  $: isWebsiteConversion = $unifiedConversion.type === ConversionState.TYPE.WEBSITE || 
    [
      'finding_sitemap',
      'parsing_sitemap',
      'crawling_pages',
      'processing_pages',
      'generating_index'
    ].includes($unifiedConversion.status);
  $: {
    // Track completion state in a way that persists
    const statusCompleted = $unifiedConversion.status === ConversionState.STATUS.COMPLETED || $unifiedConversion.completionTime !== null;
    const resultCompleted = $conversionResult && $conversionResult.success;
    const hasValidResult = $conversionResult?.outputPath != null;
    
    if (statusCompleted || resultCompleted || hasValidResult) {
      persistentCompletion = true;
      hasCompletedOnce = true;
    }
  }
  
  // Use the persistent completion flag for completed state
  $: isCompleted = persistentCompletion;
  $: hasError = $unifiedConversion.error !== null;
  
  // Check if we have a native file path result
  $: hasNativeResult = $conversionResult && $conversionResult.isNative && $conversionResult.outputPath;
  
  /**
   * Opens the output folder directly in the file explorer
   */
  function showInFolder() {
    if (!$conversionResult?.outputPath) return;
    downloadHandler.showInFolder($conversionResult.outputPath);
  }
  
  /**
   * Resets the application state to allow converting more files
   * without reloading the page
   */
  function handleConvertMore() {
    try {
      // Use storeManager to reset all stores
      storeManager.resetStores();
      
      // Ensure proper website progress cleanup
      if (isWebsiteConversion && typeof conversionTimer !== 'undefined') {
        // No need to reset websiteProgress separately as it's now part of unifiedConversion
        conversionTimer.stop();
      }

      // Reset local state
      persistentCompletion = false;
      hasCompletedOnce = false;

      // Reset ConversionProgress component state if exists
      if (conversionProgressComponent) {
        conversionProgressComponent.resetState();
      }

      // Dispatch event to parent component to switch mode
      dispatch('convertMore');
    } catch (error) {
      console.error('Error resetting state:', error);
      // Still try to dispatch event even if cleanup fails
      dispatch('convertMore');
    }
  }
</script>

<Container>
  <div class="conversion-status" transition:fade>
    {#if isConverting || isCompleted || hasError}
      <!-- Progress section -->
      <div class="progress-section">
        {#if isWebsiteConversion}
          <!-- Use our new simplified website progress display for website conversions -->
          <WebsiteProgressDisplay />
        {:else}
          <!-- Use the regular conversion progress for other conversions -->
          <ConversionProgress bind:this={conversionProgressComponent} />
        {/if}
      </div>

      <!-- Action buttons - only show when completed -->
      {#if isCompleted}
        <div class="action-section">
          <div class="button-container">
            {#if hasNativeResult}
              <!-- Button for native file system -->
              <Button 
                variant="secondary"
                size="large"
                on:click={showInFolder}
              >
                <span class="button-icon">📂</span> Open Folder
              </Button>
            {/if}
            <Button 
              variant="secondary"
              size="large"
              on:click={handleConvertMore}
            >
              <span class="button-icon">🔄</span> Convert More
            </Button>
          </div>
        </div>
      {:else if hasError}
        <div class="action-section">
          <div class="button-container">
            <Button 
              variant="primary"
              size="large"
              on:click={handleConvertMore}
            >
              <span class="button-icon">🔄</span> Try Again
            </Button>
          </div>
        </div>
      {/if}
    {:else}
      <!-- Initial state - Show nothing -->
    {/if}
  </div>
</Container>

<style>
  .conversion-status {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    padding: var(--spacing-md) 0;
  }

  .progress-section {
    width: 100%;
    margin: 0 auto;
    padding: var(--spacing-md);
    border-radius: var(--rounded-lg);
    background-color: var(--color-background);
    box-shadow: var(--shadow-sm);
  }

  .action-section {
    margin-top: var(--spacing-sm);
  }

  .button-container {
    width: 100%;
    display: flex;
    gap: var(--spacing-md);
    justify-content: center;
    padding: var(--spacing-sm) 0;
  }

  .button-icon {
    margin-right: var(--spacing-xs);
  }

  /* Mobile Adjustments */
  @media (max-width: 640px) {
    .conversion-status {
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) 0;
    }

    .button-container {
      flex-direction: column;
    }
  }
</style>
