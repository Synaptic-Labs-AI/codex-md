<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import Button from './common/Button.svelte';
  import Container from './common/Container.svelte';
  import ConversionProgress from './ConversionProgress.svelte';
  import { unifiedConversion, ConversionState, currentFile } from '../stores/unifiedConversion.js';
  import { conversionResult } from '../stores/conversionResult.js';
  import { clearFiles, downloadHandler, storeManager } from '../utils/conversion';
  import { files } from '../stores/files.js';

  const dispatch = createEventDispatcher();
  
  /**
   * Handles cancellation of the current conversion
   */
  function handleCancel() {
    storeManager.cancelConversion();
  }
  
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
  
  // Check if we have multiple files result
  $: hasMultipleFiles = $conversionResult && $conversionResult.isMultipleFiles;
  
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
      // Reset ConversionProgress component state if exists
      if (conversionProgressComponent) {
        conversionProgressComponent.resetState();
      }

      // Reset local state
      persistentCompletion = false;
      hasCompletedOnce = false;

      // Use storeManager to reset all stores
      storeManager.resetStores();

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
        <!-- Use the simplified conversion progress for all conversion types -->
        <ConversionProgress 
          bind:this={conversionProgressComponent} 
          on:cancel={handleCancel}
        />
      </div>

      <!-- Action buttons - only show when completed -->
      {#if isCompleted}
        <div class="action-section">
          <!-- Multiple files summary -->
          {#if hasMultipleFiles}
            <div class="result-summary">
              <h3>✅ Website Conversion Completed</h3>
              <p>{$conversionResult.message}</p>
              <div class="files-info">
                <p><strong>Generated Files:</strong> {$conversionResult.totalFiles}</p>
                <p><strong>Location:</strong> {$conversionResult.outputPath}</p>
                {#if $conversionResult.indexFile}
                  <p><strong>Index File:</strong> index.md</p>
                {/if}
              </div>
            </div>
          {/if}
          
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

  .result-summary {
    background: var(--color-success-background, #f0f9ff);
    border: 1px solid var(--color-success-border, #0891b2);
    border-radius: var(--rounded-lg);
    padding: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }

  .result-summary h3 {
    margin: 0 0 var(--spacing-sm) 0;
    color: var(--color-success-text, #0f766e);
    font-size: 1.1rem;
    font-weight: 600;
  }

  .result-summary p {
    margin: 0 0 var(--spacing-xs) 0;
    color: var(--color-text-secondary);
  }

  .files-info {
    background: var(--color-background);
    border-radius: var(--rounded-md);
    padding: var(--spacing-sm);
    margin-top: var(--spacing-sm);
  }

  .files-info p {
    margin: var(--spacing-xs) 0;
    font-size: 0.9rem;
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
