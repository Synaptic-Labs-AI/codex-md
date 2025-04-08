<!-- src/lib/components/ApiKeyInput.svelte -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { slide, fade } from 'svelte/transition';
  import { getApiKey, setApiKey } from '../stores/apiKey.js';
  import Button from './common/Button.svelte';

  // Props
  export let provider = 'openai';
  export let title = provider === 'openai' ? 'OpenAI API Key' : 'Mistral API Key';
  export let placeholder = provider === 'openai' ? 'Enter your OpenAI API Key' : 'Enter your Mistral API Key';
  export let infoText = provider === 'openai' 
    ? 'Required for audio/video transcription.' 
    : 'Required for advanced OCR processing.';
  export let helpLink = provider === 'openai' 
    ? '/help#api-keys' 
    : 'https://console.mistral.ai/';
  export let helpText = provider === 'openai'
    ? 'Learn more about API keys'
    : 'Get a Mistral API key';

  let apiKeyValue = '';
  let showApiKey = false;
  let saving = false;
  let error = '';
  let keyStatus = { exists: false, valid: false };
  let isInitialized = false;
  let isReady = false;

  onMount(() => {
    if (window?.electron) {
      window.electron.onReady(async () => {
        try {
          isReady = true;
          await initializeApiKey();
        } catch (err) {
          console.error('Failed to initialize API key component:', err);
          error = 'Failed to initialize: ' + (err.message || 'Unknown error');
        }
      });
    } else {
      error = 'Electron API not available';
    }
  });

  // Initialize API key state
  async function initializeApiKey() {
    try {
      // Initialize with current value from store
      apiKeyValue = await getApiKey(provider) || '';
      
      // Check if API key exists
      const result = await window.electron.checkApiKeyExists(provider);
      keyStatus = { exists: result.exists, valid: true };
      
      // If key exists, try to load it
      if (result.exists) {
        const response = await window.electron.getApiKey(provider);
        if (response.success && response.key) {
          apiKeyValue = response.key;
          await setApiKey(response.key, provider);
        }
      }
      
      isInitialized = true;
    } catch (err) {
      console.error(`Error initializing ${provider} API key:`, err);
      error = err.message || `Failed to initialize ${provider} API key`;
    }
  }

  // Update store directly as user types
  function handleInput(event) {
    apiKeyValue = event.target.value;
    setApiKey(apiKeyValue, provider);
    error = '';
  }

  function toggleShowApiKey() {
    showApiKey = !showApiKey;
  }
  
  // Save API key
  async function saveApiKey() {
    if (!apiKeyValue) return;
    
    saving = true;
    error = '';
    
    try {
      const result = await window.electron.saveApiKey(apiKeyValue, provider);
      if (!result.success) {
        throw new Error(result.error || 'Failed to save API key');
      }
      
      keyStatus = { exists: true, valid: true };
    } catch (e) {
      error = e.message;
    } finally {
      saving = false;
    }
  }
  
  // Delete API key
  async function deleteApiKey() {
    try {
      await window.electron.deleteApiKey(provider);
      keyStatus = { exists: false, valid: false };
      apiKeyValue = '';
      setApiKey('', provider);
    } catch (e) {
      error = e.message;
    }
  }
</script>

<div class="api-key-wrapper api-key-input-section" class:loading={!isInitialized}>
  {#if !isReady}
    <div class="api-key-header">
      <h3>Loading...</h3>
    </div>
  {:else if error}
    <div class="api-key-header error">
      <h3>{title}</h3>
      <div class="error-message">{error}</div>
    </div>
  {:else}
    <div class="api-key-header">
      <h3>{title}</h3>
      {#if keyStatus.exists}
        <div class="key-status success">
          <span>✓ API key is configured</span>
          <button on:click={deleteApiKey} class="delete-btn">Remove</button>
        </div>
      {/if}
    </div>
  {/if}

  {#if !keyStatus.exists}
    <div class="input-container">
      <!-- Use separate input elements for text and password -->
      {#if showApiKey}
        <input
          type="text"
          class="api-key-input"
          placeholder={placeholder}
          bind:value={apiKeyValue}
          on:input={handleInput}
          class:error={!!error}
        />
      {:else}
        <input
          type="password"
          class="api-key-input"
          placeholder={placeholder}
          bind:value={apiKeyValue}
          on:input={handleInput}
          class:error={!!error}
        />
      {/if}

      <!-- Show / Hide API Key -->
      <button
        type="button"
        class="toggle-button"
        on:click={toggleShowApiKey}
        aria-label={showApiKey ? 'Hide API Key' : 'Show API Key'}
      >
        {showApiKey ? '👁️' : '🙈'}
      </button>
      
      <Button
        on:click={saveApiKey}
        disabled={saving || !apiKeyValue}
        variant="primary"
        size="small"
      >
        {#if saving}
          Saving...
        {:else}
          Save
        {/if}
      </Button>
    </div>
  {/if}

  {#if error}
    <div class="error-message" transition:fade={{ duration: 200 }}>{error}</div>
  {/if}

  <div class="api-key-info">
    <p>
      {infoText} Your key is stored securely on your device.
    </p>
    <a href={helpLink} target={provider !== 'openai' ? '_blank' : undefined} rel={provider !== 'openai' ? 'noopener noreferrer' : undefined} class="help-link">{helpText}</a>
  </div>
</div>

<style>
  .api-key-wrapper {
    width: 100%;
    max-width: 1000px; /* Matches FileUploader container width */
    margin: 0 auto;
    padding: var(--spacing-md);
    background: rgba(var(--color-prime-rgb), 0.05);
    border-radius: var(--rounded-md);
  }

  .api-key-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-sm);
  }

  h3 {
    margin: 0;
    font-size: var(--font-size-base);
    font-weight: 600;
    color: var(--color-text);
  }

  .api-key-input-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .input-container {
    width: 100%;
    display: flex;
    align-items: center;
    background: var(--color-surface);
    border: 2px solid var(--color-border);
    border-radius: var(--rounded-lg);
    padding: var(--spacing-xs);
    gap: var(--spacing-xs);
  }

  .input-container:focus-within {
    border-color: var(--color-prime);
    box-shadow: var(--shadow-sm);
  }

  .api-key-input {
    flex: 1;
    border: none;
    background: transparent;
    padding: var(--spacing-sm);
    font-size: var(--font-size-base);
    color: var(--color-text);
  }

  .api-key-input:focus {
    outline: none;
  }
  
  .api-key-input.error {
    color: var(--color-error);
  }

  .toggle-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--spacing-xs);
    font-size: var(--font-size-base);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-light);
  }
  
  .toggle-button:hover {
    color: var(--color-text);
  }

  .api-key-info {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--spacing-xs);
  }
  
  .api-key-info p {
    margin: 0;
  }
  
  .help-link {
    color: var(--color-prime);
    text-decoration: none;
    font-size: var(--font-size-sm);
  }
  
  .help-link:hover {
    text-decoration: underline;
  }
  
  .key-status {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: var(--font-size-sm);
  }
  
  .success {
    color: var(--color-success, #4caf50);
  }
  
  .delete-btn {
    background: var(--color-error);
    color: white;
    border: none;
    border-radius: var(--rounded-sm);
    padding: var(--spacing-2xs) var(--spacing-xs);
    font-size: var(--font-size-xs);
    cursor: pointer;
  }
  
  .error-message {
    color: var(--color-error);
    font-size: var(--font-size-sm);
    margin-top: 0;
  }
  
  @media (max-width: 640px) {
    .api-key-wrapper {
      padding: var(--spacing-sm);
    }
    
    .api-key-info {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  .loading {
    opacity: 0.7;
    pointer-events: none;
  }

  .error-message {
    color: var(--color-error);
    font-size: var(--font-size-sm);
    margin-top: var(--spacing-xs);
  }
</style>
