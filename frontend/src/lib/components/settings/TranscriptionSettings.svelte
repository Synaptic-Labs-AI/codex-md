<script>
  import { onMount } from 'svelte';
  import CONFIG from '$lib/config.js';
  import Accordion from '$lib/components/common/Accordion.svelte';
  
  // Local state
  let selectedModel = CONFIG.TRANSCRIPTION.DEFAULT_MODEL;
  let saving = false;
  let error = '';
  let initialized = false;
  
  // Initialize settings
  async function initSettings() {
    try {
      const result = await window.electron.getTranscriptionModel();
      if (result?.success && result?.model && CONFIG.TRANSCRIPTION.MODELS[result.model]) {
        selectedModel = result.model;
      }
    } catch (err) {
      console.error('Error loading transcription settings:', err);
    }
    initialized = true;
  }
  
  onMount(initSettings);
  
  async function saveModelSelection() {
    // Skip saving if not initialized
    if (!initialized) return;

    saving = true;
    error = '';
    
    try {
      // Save using the transcription model API
      await window.electron.setTranscriptionModel(selectedModel);
    } catch (err) {
      console.error('Error saving transcription model:', err);
    } finally {
      saving = false;
    }
  }
</script>

<div>
  <div class="model-selector">
    <label for="model-select">Transcription Model</label>
    <select
      id="model-select"
      bind:value={selectedModel}
      on:change={saveModelSelection}
      disabled={saving}
    >
      {#each Object.entries(CONFIG.TRANSCRIPTION.MODELS) as [modelId, model]}
        <option value={modelId}>
          {model.name} {model.default ? '(Default)' : ''}
        </option>
      {/each}
    </select>
    
    {#if error}
      <p class="error-message">{error}</p>
    {/if}
  </div>
  
  <Accordion title="Model Details" icon="ℹ️">
    <div class="model-info">
      <h3>{CONFIG.TRANSCRIPTION.MODELS[selectedModel].name}</h3>
      <p class="description">{CONFIG.TRANSCRIPTION.MODELS[selectedModel].description}</p>
      
      <div class="features">
        <h4>Features</h4>
        <ul>
          {#if CONFIG.TRANSCRIPTION.MODELS[selectedModel].features.includes('timestamps')}
            <li>✓ Supports timestamps</li>
          {/if}
          {#if CONFIG.TRANSCRIPTION.MODELS[selectedModel].features.includes('all_formats')}
            <li>✓ All output formats supported</li>
          {/if}
          {#if CONFIG.TRANSCRIPTION.MODELS[selectedModel].features.includes('limited_formats')}
            <li>✓ Basic output formats (JSON, text) supported</li>
          {/if}
        </ul>
      </div>
      
      <div class="formats">
        <h4>Supported Response Formats</h4>
        <p>{CONFIG.TRANSCRIPTION.RESPONSE_FORMATS[selectedModel].join(', ')}</p>
      </div>
    </div>
  </Accordion>
</div>

<style>
  .model-selector {
    margin-bottom: 1rem;
  }
  
  label {
    display: block;
    margin-bottom: 0.5rem;
    color: var(--color-text);
  }
  
  select {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-background);
    color: var(--color-text);
    font-size: 1rem;
    margin-bottom: 0.5rem;
  }
  
  select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .error-message {
    color: var(--color-error);
    font-size: 0.875rem;
    margin-top: 0.5rem;
  }
  
  .model-info {
    padding: 0.5rem 0;
  }
  
  .model-info h3 {
    margin-top: 0;
    margin-bottom: 0.5rem;
    font-size: 1.1rem;
    color: var(--color-text);
  }
  
  .description {
    color: var(--color-text-secondary);
    margin-bottom: 1rem;
  }
  
  h4 {
    font-size: 1rem;
    margin-bottom: 0.5rem;
    color: var(--color-text);
  }
  
  ul {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem 0;
  }
  
  li {
    margin-bottom: 0.25rem;
    color: var(--color-text-secondary);
  }
  
  .formats p {
    color: var(--color-text-secondary);
    margin: 0;
  }
</style>
