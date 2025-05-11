<!--
  DeepgramApiSettings.svelte - Deepgram API key settings component
  Handles storage and management of Deepgram API keys for transcription.

  Features:
  - Secure API key storage
  - Link to Deepgram API documentation
  - Validation of API keys
-->
<script>
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { fade } from 'svelte/transition';
  import Accordion from '../common/Accordion.svelte';
  import Button from '../common/Button.svelte';
  
  // Local state
  let apiKey = '';
  let saving = false;
  let validating = false;
  let error = '';
  let keyStatus = writable({ exists: false, valid: false });
  let showApiKey = false;
  let isInitialized = true;
  
  onMount(async () => {
    try {
      // Initialize
      isInitialized = false;

      console.log('[DeepgramApiSettings] Checking for Deepgram API key on mount');

      // Check if we have a stored Deepgram API key using the dedicated handler
      if (window?.electron) {
        // Use specialized Deepgram API key methods if available
        if (window.electron.getDeepgramApiKey) {
          console.log('[DeepgramApiSettings] Using getDeepgramApiKey to check for API key');
          try {
            const result = await window.electron.getDeepgramApiKey();
            console.log('[DeepgramApiSettings] API key check result:', result);

            if (result && result.hasKey) {
              console.log('[DeepgramApiSettings] API key found via getDeepgramApiKey');
              keyStatus.set({ exists: true, valid: true });
            }
          } catch (err) {
            console.error('[DeepgramApiSettings] Error using getDeepgramApiKey:', err);
            // Fall back to regular API key methods
          }
        } else if (window.electron.getApiKey) {
          console.log('[DeepgramApiSettings] Using getApiKey to check for Deepgram API key');
          try {
            const result = await window.electron.getApiKey('deepgram');
            console.log('[DeepgramApiSettings] API key check result:', result);

            if (result && result.key) {
              console.log('[DeepgramApiSettings] API key found via getApiKey');
              keyStatus.set({ exists: true, valid: true });
            }
          } catch (err) {
            console.error('[DeepgramApiSettings] Error using getApiKey:', err);
            // Fall back to getSetting
          }
        } else if (window.electron.getSetting) {
          console.log('[DeepgramApiSettings] Using getSetting to check for API key');

          // Try both key locations for maximum compatibility
          try {
            // Try direct path first
            const directKey = await window.electron.getSetting('deepgramApiKey');
            if (directKey) {
              console.log('[DeepgramApiSettings] API key found at direct path');
              keyStatus.set({ exists: true, valid: true });
            } else {
              // If not found, try nested path
              const nestedKey = await window.electron.getSetting('transcription.deepgramApiKey');
              if (nestedKey) {
                console.log('[DeepgramApiSettings] API key found at nested path');
                keyStatus.set({ exists: true, valid: true });
              } else {
                console.log('[DeepgramApiSettings] No API key found at any path');
              }
            }
          } catch (err) {
            console.error('[DeepgramApiSettings] Error checking API key with getSetting:', err);
          }
        }
      }
    } catch (err) {
      console.error('[DeepgramApiSettings] Error checking Deepgram API key:', err);
    } finally {
      isInitialized = true;
    }
  });

  async function saveApiKey() {
    if (!apiKey) return;

    saving = true;
    error = '';

    try {
      console.log(`[DeepgramApiSettings] Saving API key (length: ${apiKey.length})`);

      // Use specialized Deepgram method if available
      if (window?.electron?.setDeepgramApiKey) {
        console.log('[DeepgramApiSettings] Using setDeepgramApiKey to save API key');

        const result = await window.electron.setDeepgramApiKey(apiKey);
        console.log('[DeepgramApiSettings] API key save result:', result);

        if (!result || !result.success) {
          throw new Error((result && result.error) || 'Failed to save API key');
        }
      } else if (window?.electron?.saveApiKey) {
        console.log('[DeepgramApiSettings] Using saveApiKey to save Deepgram API key');

        const result = await window.electron.saveApiKey(apiKey, 'deepgram');
        console.log('[DeepgramApiSettings] API key save result:', result);

        if (!result || !result.success) {
          throw new Error((result && result.error) || 'Failed to save API key');
        }
      } else if (window?.electron?.setSetting) {
        console.log('[DeepgramApiSettings] Using setSetting to save API key');

        // Save to both locations for maximum compatibility
        await window.electron.setSetting('deepgramApiKey', apiKey);

        // Save to nested location for frontend compatibility
        const currentTranscription = await window.electron.getSetting('transcription') || {};
        currentTranscription.deepgramApiKey = apiKey;
        await window.electron.setSetting('transcription', currentTranscription);

        console.log('[DeepgramApiSettings] API key saved via setSetting');
      } else {
        throw new Error('No method available to save API key');
      }

      // Configure Deepgram with the new key if available
      if (window?.electron?.configureDeepgram) {
        console.log('[DeepgramApiSettings] Configuring Deepgram with new key');
        const result = await window.electron.configureDeepgram({ apiKey });

        if (!result.success) {
          console.error('[DeepgramApiSettings] Deepgram configuration failed:', result.error);
          throw new Error(result.error || 'Failed to configure Deepgram');
        } else {
          console.log('[DeepgramApiSettings] Deepgram successfully configured');
        }
      }

      // Update status and clear input
      console.log('[DeepgramApiSettings] API key saved successfully');
      keyStatus.set({ exists: true, valid: true });
      apiKey = ''; // Clear input
    } catch (e) {
      console.error('[DeepgramApiSettings] Error saving API key:', e);
      error = e.message;
    } finally {
      saving = false;
      validating = false;
    }
  }

  async function deleteApiKey() {
    try {
      console.log('[DeepgramApiSettings] Deleting API key');

      // Use API key management if available
      if (window?.electron?.deleteApiKey) {
        console.log('[DeepgramApiSettings] Using deleteApiKey to remove Deepgram API key');

        await window.electron.deleteApiKey('deepgram');
        console.log('[DeepgramApiSettings] API key deleted via deleteApiKey');
      } else if (window?.electron?.setSetting) {
        console.log('[DeepgramApiSettings] Using setSetting to delete API key');

        // Clear from both locations
        await window.electron.setSetting('deepgramApiKey', '');

        // Clear from nested location if it exists
        const currentTranscription = await window.electron.getSetting('transcription') || {};
        if (currentTranscription.deepgramApiKey) {
          currentTranscription.deepgramApiKey = '';
          await window.electron.setSetting('transcription', currentTranscription);
        }

        console.log('[DeepgramApiSettings] API key deleted via setSetting');
      }

      console.log('[DeepgramApiSettings] API key deleted successfully');
      keyStatus.set({ exists: false, valid: false });
    } catch (e) {
      console.error('[DeepgramApiSettings] Error deleting API key:', e);
      error = e.message;
    }
  }
  
  function toggleShowApiKey() {
    showApiKey = !showApiKey;
  }
</script>

<div class="api-key-wrapper api-key-input-section" class:loading={!isInitialized}>
  <div class="api-key-header">
    <h3>Deepgram API Key</h3>
    {#if $keyStatus.exists}
      <div class="key-status success">
        <span>✓ API key is configured</span>
        <button on:click={deleteApiKey} class="delete-btn">Remove</button>
      </div>
    {/if}
  </div>

  {#if !$keyStatus.exists}
    <div class="input-container">
      <!-- Use separate input elements for text and password -->
      {#if showApiKey}
        <input
          type="text"
          class="api-key-input"
          placeholder="Enter your Deepgram API Key"
          bind:value={apiKey}
          class:error={!!error}
        />
      {:else}
        <input
          type="password"
          class="api-key-input"
          placeholder="Enter your Deepgram API Key"
          bind:value={apiKey}
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
        disabled={saving || !apiKey}
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
      Required for audio and video transcription. Your key is stored securely on your device.
    </p>
    <a href="https://console.deepgram.com/signup" target="_blank" rel="noopener noreferrer" class="help-link">Get a Deepgram API key</a>
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