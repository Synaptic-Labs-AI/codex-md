<script>
  import { createEventDispatcher } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import Button from './common/Button.svelte';
  import Container from './common/Container.svelte';
  import ProgressBar from './common/ProgressBar.svelte';
  import { conversionStatus, currentFile } from '$lib/stores/conversionStatus.js';
  import { conversionResult } from '$lib/stores/conversionResult.js';
  import { triggerDownload } from '$lib/utils/conversionManager.js';
  import electronClient from '$lib/api/electron';
  import fileSystemOperations from '$lib/api/electron/fileSystem.js';
  import { files } from '$lib/stores/files.js';

  const dispatch = createEventDispatcher();

  // Check if we're running in Electron
  let isElectron = false;
  $: {
    isElectron = electronClient.isRunningInElectron();
  }

  // Reactive declarations for status
  $: isConverting = ['converting', 'selecting_output', 'initializing'].includes($conversionStatus.status);
  $: isCompleted = $conversionStatus.status === 'completed';
  
  // Force the completed state to be shown when we have a result path
  $: if (isElectron && $conversionResult?.outputPath && !isCompleted) {
    isCompleted = true;
  }
  $: hasError = $conversionStatus.error !== null;
  
  // Format current file name for display
  $: currentFileName = $currentFile ? 
    ($currentFile.length > 30 ? 
      $currentFile.substring(0, 27) + '...' : 
      $currentFile) : 
    '';

  // Get status message
  $: statusMessage = getStatusMessage(isCompleted ? 'completed' : $conversionStatus.status, $conversionStatus.error);

  // Check if we have a native file path result
  $: hasNativeResult = $conversionResult && $conversionResult.isNative && $conversionResult.outputPath;

  // Get file count from conversion result
  $: fileCount = $conversionResult?.items?.length || 0;

  function getStatusMessage(status, error) {
    switch(status) {
      case 'converting':
        return '🔄 Converting your files...';
      case 'selecting_output':
        return '📂 Select output directory...';
      case 'completed':
        return '✅ Conversion completed successfully!';
      case 'error':
        return `❌ ${error || 'An error occurred during conversion'}`;
      case 'cancelled':
        return '⚠️ Conversion cancelled';
      default:
        return '⏳ Preparing conversion...';
    }
  }
  
  /**
   * Opens the output folder directly in the file explorer
   */
  async function showInFolder() {
    if (!isElectron || !$conversionResult?.outputPath) return;
    
    try {
      await fileSystemOperations.openFolder($conversionResult.outputPath);
    } catch (error) {
      console.error('Error opening folder:', error);
    }
  }
  
  /**
   * Resets the application state to allow converting more files
   * without reloading the page
   */
  function handleConvertMore() {
    // Reset all stores to their initial state
    files.clearFiles();
    conversionStatus.reset();
    conversionResult.clearResult();
    
    // Dispatch event to parent component to switch mode
    dispatch('convertMore');
  }
</script>

<Container>
  <div class="conversion-status" transition:fade>
    {#if isConverting || isCompleted || hasError}
      <!-- Conversion in progress or completed -->
      <div class="status-card {isCompleted ? 'success' : hasError ? 'error' : ''}">
        <div class="status-content">
          <h3 class="status-title">{statusMessage}</h3>
          
          {#if currentFileName && isConverting}
            <p class="current-file">Processing: {currentFileName}</p>
          {/if}
          
          {#if isCompleted && fileCount > 0}
            <p class="summary">
              Successfully converted {fileCount} {fileCount === 1 ? 'file' : 'files'} to Markdown format for <span class="codex-md-brand">codex.md</span>.
            </p>
          {/if}
          
        </div>
      </div>

      <!-- Progress bar section -->
      <div class="progress-section">
        <div class="progress-container">
          <ProgressBar 
            value={$conversionStatus.progress} 
            color={hasError ? 'var(--color-error)' : isCompleted ? 'var(--color-success)' : 'var(--color-prime)'}
            height="8px"
          />
          <span class="progress-text">
            {$conversionStatus.progress.toFixed(0)}%
          </span>
        </div>
      </div>

      <!-- Action buttons - only show when completed -->
      {#if isCompleted}
        <div class="action-section">
          <div class="button-container">
            {#if $conversionResult && isElectron && hasNativeResult}
              <!-- Electron-specific button for native file system -->
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
  /* Ensure the codex-md-brand class is properly styled */
  :global(.conversion-status .codex-md-brand) {
    font-weight: var(--font-weight-bold);
    background: linear-gradient(180deg,
      var(--color-prime) 0%,
      var(--color-prime) 60%,
      var(--color-fourth) 100%
    );
    background-size: 100% 300%;
    animation: gradientFlow 5s ease infinite;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    display: inline-block;
  }

  .conversion-status {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    padding: var(--spacing-md) 0;
  }

  .status-card {
    display: flex;
    align-items: flex-start;
    gap: var(--spacing-md);
    padding: var(--spacing-lg);
    border-radius: var(--rounded-lg);
    background-color: var(--color-background);
    box-shadow: var(--shadow-sm);
    position: relative;
    overflow: hidden;
  }

  .status-card::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--rounded-lg);
    padding: 2px;
    background: linear-gradient(135deg, var(--color-prime), var(--color-second));
    -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }

  .status-card.success::before {
    background: linear-gradient(135deg, var(--color-success), var(--color-prime));
  }

  .status-card.error::before {
    background: linear-gradient(135deg, var(--color-error), #ff7b7b);
  }


  .status-content {
    flex-grow: 1;
  }

  .status-title {
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    margin-bottom: var(--spacing-xs);
    color: var(--color-text);
  }

  .current-file {
    font-size: var(--font-size-base);
    color: var(--color-text-light);
    margin: var(--spacing-xs) 0;
    padding: var(--spacing-xs);
    background-color: rgba(var(--color-prime-rgb), 0.05);
    border-radius: var(--rounded-sm);
  }

  .summary {
    font-size: var(--font-size-base);
    color: var(--color-text);
    margin: var(--spacing-sm) 0;
  }

  .progress-section {
    width: 100%;
    margin: 0 auto;
    padding: var(--spacing-md);
    border-radius: var(--rounded-lg);
    background-color: var(--color-background);
    box-shadow: var(--shadow-sm);
  }

  .progress-container {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    align-items: center;
  }

  .progress-text {
    font-size: var(--font-size-base);
    color: var(--color-text-light);
    font-weight: var(--font-weight-medium);
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

    .status-card {
      padding: var(--spacing-md);
      flex-direction: column;
      align-items: center;
      text-align: center;
    }

    .status-title {
      font-size: var(--font-size-base);
    }

    .current-file {
      font-size: var(--font-size-sm);
    }

    .button-container {
      flex-direction: column;
    }

  }
</style>
