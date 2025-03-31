<!-- src/lib/components/ApiKeyInput.svelte -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { slide, fade } from 'svelte/transition';
  import { apiKey } from '$lib/stores/apiKey.js';
  import Button from './common/Button.svelte';

  let apiKeyValue = '';
  let showApiKey = false;
  let validating = false;
  let error = '';
  let isElectron = false;
  let keyStatus = { exists: false, valid: false };

  // Subscribe to the apiKey store so we can stay in sync
  const unsubscribe = apiKey.subscribe(value => {
    apiKeyValue = value || '';
  });

  onDestroy(() => {
    unsubscribe();
  });

  onMount(() => {
    // Check if we're running in Electron
    isElectron = !!window.electronAPI;
    
    // If in Electron, check if API key exists
    if (isElectron) {
      checkApiKey();
    }
  });

  // Check if API key exists in Electron
  async function checkApiKey() {
    try {
      const result = await window.electronAPI.checkApiKeyExists('openai');
      keyStatus = { exists: result.exists, valid: true };
      
      // If key exists, try to load it
      if (result.exists) {
        const response = await window.electronAPI.getApiKey('openai');
        if (response.success && response.key) {
          apiKeyValue = response.key;
          apiKey.set(response.key);
        }
      }
    } catch (err) {
      console.error('Error checking API key:', err);
    }
  }

  // Update store directly as user types
  function handleInput(event) {
    apiKeyValue = event.target.value;
    apiKey.set(apiKeyValue);
    error = '';
  }

  function toggleShowApiKey() {
    showApiKey = !showApiKey;
  }
  
  // Validate API key
  async function validateApiKey() {
    if (!apiKeyValue) return;
    
    validating = true;
    error = '';
    
    try {
      // Basic validation
      if (!apiKeyValue.startsWith('sk-')) {
        throw new Error('Invalid API key format. Key should start with "sk-"');
      }
      
      // If in Electron, validate with API
      if (isElectron) {
        const validation = await window.electronAPI.validateApiKey(apiKeyValue);
        
        if (!validation.valid) {
          throw new Error(validation.error || 'API key validation failed');
        }
        
        // Save key if valid
        const result = await window.electronAPI.saveApiKey(apiKeyValue);
        if (!result.success) {
          throw new Error(result.error || 'Failed to save API key');
        }
        
        keyStatus = { exists: true, valid: true };
      } else {
        // In web mode, just do basic validation
        apiKey.set(apiKeyValue);
      }
    } catch (e) {
      error = e.message;
    } finally {
      validating = false;
    }
  }
  
  // Delete API key (Electron only)
  async function deleteApiKey() {
    if (!isElectron) return;
    
    try {
      await window.electronAPI.deleteApiKey('openai');
      keyStatus = { exists: false, valid: false };
      apiKeyValue = '';
      apiKey.set('');
    } catch (e) {
      error = e.message;
    }
  }
</script>

<div class="api-key-wrapper api-key-input-section">
  <div class="api-key-header">
    <h3>OpenAI API Key</h3>
    {#if isElectron && keyStatus.exists}
      <div class="key-status success">
        <span>✓ API key is configured</span>
        <button on:click={deleteApiKey} class="delete-btn">Remove</button>
      </div>
    {/if}
  </div>

  {#if !(isElectron && keyStatus.exists)}
    <div class="input-container">
      <!-- Use separate input elements for text and password -->
      {#if showApiKey}
        <input
          type="text"
          class="api-key-input"
          placeholder="Enter your OpenAI API Key (sk-...)"
          bind:value={apiKeyValue}
          on:input={handleInput}
          class:error={!!error}
        />
      {:else}
        <input
          type="password"
          class="api-key-input"
          placeholder="Enter your OpenAI API Key (sk-...)"
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
      
      {#if isElectron}
        <Button
          on:click={validateApiKey}
          disabled={validating || !apiKeyValue}
          variant="primary"
          size="small"
        >
          {#if validating}
            Validating...
          {:else}
            Validate & Save
          {/if}
        </Button>
      {/if}
    </div>
  {/if}

  {#if error}
    <div class="error-message" transition:fade={{ duration: 200 }}>{error}</div>
  {/if}

  <div class="api-key-info">
    <p>
      {#if isElectron}
        Required for audio/video transcription. Your key is stored securely on your device.
      {:else}
        Required for audio/video transcription. Won't persist on refresh.
      {/if}
    </p>
    <a href="/help#api-keys" class="help-link">Learn more about API keys</a>
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
</style>
