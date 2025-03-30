<!-- src/lib/components/ConversionStatus.svelte -->
<script>
  import { onDestroy } from 'svelte';
  import { createEventDispatcher } from 'svelte';
  import { fade, fly } from 'svelte/transition';

  import { files } from '$lib/stores/files.js';
  import { apiKey } from '$lib/stores/apiKey.js';
  import { requiresApiKey } from '$lib/utils/fileUtils.js';
  import { conversionStatus } from '$lib/stores/conversionStatus.js';

  import ApiKeyInput from './ApiKeyInput.svelte';
  import ProgressBar from './common/ProgressBar.svelte';

  /**
   * Store shape example:
   * conversionStatus = {
   *   status: 'idle' | 'converting' | 'completed' | 'error' | 'stopped',
   *   progress: number,       // 0..100
   *   error: string|null,
   *   currentFile: string|null,
   *   processedCount: number, // how many files done
   *   totalCount: number      // total files
   * }
   */

  const dispatch = createEventDispatcher();

  // Reactive local variables
  let status = 'idle';
  let progress = 0;
  let error = null;
  let currentFile = null;
  let processedCount = 0;
  let totalCount = 0;

  // Subscribe to your conversionStatus store
  const unsub = conversionStatus.subscribe(value => {
    status = value.status;
    progress = value.progress || 0;
    error = value.error;
    currentFile = value.currentFile;
    processedCount = value.processedCount || 0;
    totalCount = value.totalCount || 0;
  });

  onDestroy(() => unsub());

  // Check if we need an API key (any audio/video file) + if we have one
  $: needsApiKey = $files.some(file => requiresApiKey(file));
  $: hasApiKey = !!$apiKey;

  // Show the API key input if needed but not set
  $: showApiKeyInput = needsApiKey && !hasApiKey;

  // Are we converting?
  $: isConverting = (status === 'converting');

  // If user can convert
  $: canConvert = !needsApiKey || hasApiKey;

  function handleStartConversion() {
    if (!canConvert) return;
    dispatch('startConversion');
  }

  function handleCancelConversion() {
    dispatch('cancelConversion');
  }

  // (Optional) If user sets/clears key
  function handleApiKeySet(event) {
    if (event.detail.success) {
      // Optionally auto-start conversion here or do nothing
      // dispatch('startConversion');
    }
  }
</script>

<!-- Minimal container; remove anything not needed. -->
<div class="conversion-container" transition:fade>
  <!-- 1) Show API Key Input if needed & missing -->
  {#if showApiKeyInput}
    <div in:fly={{ y: 20, duration: 300 }}>
      <ApiKeyInput
        on:apiKeySet={handleApiKeySet}
      />
    </div>
  
  <!-- 2) If converting, show progress bar & cancel button -->
  {:else if isConverting}
    <div class="progress-section" in:fly={{ y: 20, duration: 300 }}>
      <ProgressBar
        value={progress}
        color="#3B82F6"
        height="8px"
        showGlow={true}
      />
      <p class="progress-info">
        Processing {processedCount} / {totalCount}
        {#if currentFile}
          <small>({currentFile})</small>
        {/if}
      </p>
      <button
        class="cancel-button"
        on:click={handleCancelConversion}
      >
        Cancel
      </button>
    </div>
  
  <!-- 3) If finished or not started => Show a single "Start Conversion" button -->
  {:else}
    <!-- If there's an error or completed status, show minimal messages (optional) -->
    {#if status === 'completed'}
      <p class="status-message success" in:fade>All {totalCount} files converted!</p>
    {:else if status === 'error'}
      <p class="status-message error" in:fade>{error}</p>
    {:else if status === 'stopped'}
      <p class="status-message stopped" in:fade>Conversion stopped at {processedCount}/{totalCount} files</p>
    {/if}

    <button
      class="start-button breathing-gradient"
      disabled={!canConvert}
      on:click={handleStartConversion}
      in:fly={{ y: 20, duration: 300 }}
    >
      Start Conversion
    </button>
  {/if}
</div>

<style>
  /* Make a fixed light background so it's consistent across machines */
  .conversion-container {
    background-color: #F7F8FA;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    max-width: 600px;
    margin: 1.5rem auto;
    text-align: center;
    box-shadow: 0 2px 6px rgba(0,0,0,0.05);
  }

  /* Minimal text styling */
  .status-message {
    margin: 0 0 1rem 0;
    font-size: 0.95rem;
    line-height: 1.4;
  }
  .status-message.success {
    color: #16a34a;
  }
  .status-message.error {
    color: #dc2626;
  }
  .status-message.stopped {
    color: #f97316;
  }

  /* The progress + cancel layout */
  .progress-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .progress-info {
    font-size: 0.9rem;
    color: #555;
    margin: 0;
  }
  .progress-info small {
    margin-left: 0.25rem;
    color: #777;
    font-size: 0.8rem;
  }

  .cancel-button {
    padding: 0.6rem 1.2rem;
    background: #E5E7EB;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    cursor: pointer;
  }
  .cancel-button:hover {
    background: #D1D5DB;
  }

  /* The main Start Conversion button with a "breathing" gradient effect */
  .start-button {
    position: relative;
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    color: #fff;
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    overflow: hidden;
  }
  .start-button:disabled {
    background: #9CA3AF;
    cursor: not-allowed;
  }

  /* "Breathing" gradient animation */
  .breathing-gradient {
    background: linear-gradient(90deg, #3B82F6 0%, #9333EA 100%);
    background-size: 200% 200%;
    animation: breathe 3s ease-in-out infinite;
  }

  @keyframes breathe {
    0% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
    100% {
      background-position: 0% 50%;
    }
  }

  /* Hover state for the gradient button */
  .start-button:not(:disabled):hover {
    transform: scale(1.02);
    box-shadow: 0 4px 10px rgba(0,0,0,0.1);
  }

  /* Basic responsiveness */
  @media (max-width: 600px) {
    .conversion-container {
      margin: 1rem;
    }
    .progress-info {
      font-size: 0.85rem;
    }
  }

  /* (Optional) If you want to forcibly ignore dark mode, remove 
     any @media (prefers-color-scheme) rules from your global. */
</style>
