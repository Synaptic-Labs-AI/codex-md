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
  import ConversionProgress from './ConversionProgress.svelte';

  const dispatch = createEventDispatcher();

  // Subscribe to conversionStatus store for basic state
  let status = 'idle';
  const unsub = conversionStatus.subscribe(value => {
    status = value.status;
  });

  onDestroy(() => unsub());

  // Check if we need an API key (any audio/video file) + if we have one
  $: needsApiKey = $files.some(file => requiresApiKey(file));
  $: hasApiKey = !!$apiKey;

  // Show the API key input if needed but not set
  $: showApiKeyInput = needsApiKey && !hasApiKey;

  // Are we converting?
  $: isConverting = (status === 'converting');
  
  // Is this a website conversion?
  $: isWebsiteConversion = [
    'finding_sitemap',
    'parsing_sitemap',
    'crawling_pages',
    'processing_pages',
    'generating_index'
  ].includes(status);

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
  {#if showApiKeyInput}
    <!-- 1) Show API Key Input if needed & missing -->
    <div in:fly={{ y: 20, duration: 300 }}>
      <ApiKeyInput
        on:apiKeySet={handleApiKeySet}
      />
    </div>
  {:else if status !== 'idle' && status !== 'cancelled'}
    <!-- 2) Show conversion progress -->
    <div class="progress-section" in:fly={{ y: 20, duration: 300 }}>
      <ConversionProgress />
      {#if ['converting', 'preparing'].includes(status) || isWebsiteConversion}
        <button
          class="cancel-button"
          on:click={handleCancelConversion}
        >
          Cancel
        </button>
      {/if}
    </div>
  {:else}
    <!-- 3) Show start button -->
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

  /* The progress layout */
  .progress-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
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
