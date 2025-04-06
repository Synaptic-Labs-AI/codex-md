<script>
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { slide } from 'svelte/transition';
  import Accordion from '$lib/components/common/Accordion.svelte';
  
  // Local state
  let apiKey = '';
  let saving = false;
  let validating = false;
  let error = '';
  let keyStatus = writable({ exists: false, valid: false });
  let showApiKey = false;
  
  onMount(async () => {
    try {
      const result = await window.electron.checkApiKeyExists('openai');
      keyStatus.set({ exists: result.exists, valid: true });
    } catch (err) {
      console.error('Error checking API key:', err);
    }
  });
  
  async function saveApiKey() {
    if (!apiKey) return;
    
    saving = true;
    error = '';
    
    try {
      // Save key without validation
      const result = await window.electron.saveApiKey(apiKey);
      if (!result.success) {
        throw new Error(result.error || 'Failed to save API key');
      }
      
      // Update status
      keyStatus.set({ exists: true, valid: true });
      apiKey = ''; // Clear input
    } catch (e) {
      error = e.message;
    } finally {
      saving = false;
      validating = false;
    }
  }
  
  async function deleteApiKey() {
    try {
      await window.electron.deleteApiKey('openai');
      keyStatus.set({ exists: false, valid: false });
    } catch (e) {
      error = e.message;
    }
  }
  
  function toggleShowApiKey() {
    showApiKey = !showApiKey;
  }
</script>

<div>
  {#if $keyStatus.exists}
    <div class="key-status success">
      <span>✓ API key is configured and securely stored</span>
      <button on:click={deleteApiKey} class="delete-btn">Remove Key</button>
    </div>
    <p class="info">
      Your API key is stored securely on your device using machine-specific encryption.
    </p>
  {:else}
    <div class="input-container">
      <!-- Use separate input elements for text and password -->
      {#if showApiKey}
        <input
          type="text"
          class="api-key-input"
          placeholder="Enter your OpenAI API Key (sk-...)"
          bind:value={apiKey}
          class:error={!!error}
        />
      {:else}
        <input
          type="password"
          class="api-key-input"
          placeholder="Enter your OpenAI API Key (sk-...)"
          bind:value={apiKey}
          class:error={!!error}
        />
      {/if}

      <button
        type="button"
        class="toggle-button"
        on:click={toggleShowApiKey}
        aria-label={showApiKey ? 'Hide API Key' : 'Show API Key'}
      >
        {showApiKey ? '👁️' : '🙈'}
      </button>
      
      <button
        on:click={saveApiKey}
        disabled={saving || !apiKey}
        class="save-btn"
      >
      {#if saving}
          Saving...
        {:else}
          Save API Key
        {/if}
      </button>
    </div>
    
    {#if error}
      <p class="error-message" transition:slide={{ duration: 200 }}>{error}</p>
    {/if}
    
    <Accordion title="How to get an OpenAI API key" icon="ℹ️">
      <div class="api-key-info">
        <ol>
          <li>Go to <a href="https://platform.openai.com/account/api-keys" target="_blank" rel="noopener noreferrer">OpenAI API Keys</a></li>
          <li>Sign in or create an account</li>
          <li>Create a new secret key</li>
          <li>Copy and paste it here</li>
        </ol>
        <p class="note">Your API key is stored securely on your device and is only used for transcription services.</p>
      </div>
    </Accordion>
  {/if}
</div>

<style>
  .input-container {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    width: 100%;
  }
  
  .api-key-input {
    flex: 1;
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: 1rem;
    background: var(--color-background);
    color: var(--color-text);
  }
  
  .api-key-input.error {
    border-color: var(--color-error);
  }
  
  button {
    padding: 0.75rem 1rem;
    border: none;
    border-radius: 4px;
    font-weight: 500;
    cursor: pointer;
  }
  
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .save-btn {
    background: var(--color-prime);
    color: white;
    min-width: 120px;
  }
  
  .delete-btn {
    background: var(--color-error);
    color: white;
    font-size: 0.875rem;
    padding: 0.5rem 0.75rem;
  }
  
  .toggle-button {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    padding: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .key-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-radius: 4px;
    margin-bottom: 1rem;
  }
  
  .success {
    background: var(--color-success-bg);
    color: var(--color-success);
  }
  
  .error-message {
    color: var(--color-error);
    font-size: 0.875rem;
    margin-top: 0.5rem;
    margin-bottom: 1rem;
  }
  
  .api-key-info {
    padding: 0.5rem 0;
  }
  
  .api-key-info ol {
    padding-left: 1.5rem;
    margin: 0.5rem 0;
  }
  
  .api-key-info li {
    margin-bottom: 0.5rem;
    color: var(--color-text-secondary);
  }
  
  .api-key-info a {
    color: var(--color-prime);
    text-decoration: none;
  }
  
  .api-key-info a:hover {
    text-decoration: underline;
  }
  
  .note {
    font-style: italic;
    color: var(--color-text-secondary);
    margin: 1rem 0 0 0;
  }
  
  .info {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    margin-top: 0;
  }
  
  @media (prefers-reduced-motion: reduce) {
    .save-btn:hover:not(:disabled),
    .delete-btn:hover {
      transform: none;
    }
  }
</style>
