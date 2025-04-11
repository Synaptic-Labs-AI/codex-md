<!-- 
  TranscriptionSettings.svelte - Audio/Video transcription settings component
  Controls and configuration for transcription features.
  
  Features:
  - Transcription model selection
  - Different processing options for various use cases
-->
<script>
  import { onMount } from 'svelte';
  import { settings } from '../../stores/settings.js';
  import { setTranscriptionModel } from '../../stores/settings.js';
  import Accordion from '../common/Accordion.svelte';
  
  let selectedModel = 'whisper';
  
  // Available transcription models
  const models = [
    { id: 'whisper', name: 'Whisper', description: 'Standard transcription model with good accuracy for most audio files.' },
    { id: 'gpt-4o-mini-transcribe', name: 'GPT-4o Mini', description: 'Enhanced transcription with improved formatting and understanding of context.' },
    { id: 'gpt-4o-transcribe', name: 'GPT-4o', description: 'Highest quality transcription with advanced formatting and understanding of technical content.' }
  ];
  
  // Get model description based on selected model
  $: modelDescription = models.find(m => m.id === selectedModel)?.description || '';
  
  // Subscribe to settings store
  const unsubscribe = settings.subscribe(value => {
    selectedModel = value.transcription?.model || 'whisper';
  });
  
  // Update model when selection changes
  function updateModel() {
    setTranscriptionModel(selectedModel);
  }
  
  onMount(() => {
    // Load settings from Electron if available
    if (window?.electron?.getSetting) {
      window.electron.getSetting('transcription.model')
        .then(value => {
          if (value) {
            selectedModel = value;
          }
        })
        .catch(err => console.error('Error loading transcription model setting:', err));
    }
    
    return () => {
      unsubscribe();
    };
  });
</script>

<div class="transcription-settings">
  <div class="setting-group">
    <label for="model-select">Transcription Model</label>
    <select
      id="model-select"
      bind:value={selectedModel}
      on:change={updateModel}
      class="model-select"
    >
      {#each models as model}
        <option value={model.id}>{model.name}</option>
      {/each}
    </select>
    
    <p class="description">
      {modelDescription}
    </p>
  </div>

  <Accordion title="About Transcription Models" icon="ℹ️">
    <div class="info-content">
      <p>
        Choose the transcription model that best fits your needs:
      </p>
      <ul>
        <li><strong>Whisper:</strong> Efficient transcription for most audio files</li>
        <li><strong>GPT-4o Mini:</strong> Better formatting and understanding of context</li>
        <li><strong>GPT-4o:</strong> Best for complex audio with technical content</li>
      </ul>
      <h4>Processing Times & Performance:</h4>
      <ul>
        <li>Whisper: Fastest processing, good accuracy</li>
        <li>GPT-4o Mini: Medium processing time, better formatting</li>
        <li>GPT-4o: Longest processing time, highest quality results</li>
      </ul>
    </div>
  </Accordion>
</div>

<style>
  .transcription-settings {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }
  
  label {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    color: var(--color-text);
    margin-bottom: var(--spacing-xs);
  }

  .model-select {
    padding: var(--spacing-xs) var(--spacing-sm);
    border: 1px solid var(--color-border);
    border-radius: var(--rounded-sm);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-size: var(--font-size-sm);
    width: 100%;
    max-width: 300px;
  }

  .model-select:focus {
    outline: 2px solid var(--color-prime);
    outline-offset: -2px;
  }

  .description {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    margin-top: var(--spacing-xs);
    max-width: 500px;
  }

  .info-content {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }

  .info-content p {
    margin-bottom: var(--spacing-sm);
  }

  .info-content h4 {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    margin: var(--spacing-sm) 0 var(--spacing-xs);
    color: var(--color-text);
  }

  .info-content ul {
    list-style-type: disc;
    padding-left: var(--spacing-lg);
    margin-bottom: var(--spacing-sm);
  }

  .info-content li {
    margin-bottom: var(--spacing-xs);
  }

  /* High Contrast Mode */
  @media (prefers-contrast: high) {
    .model-select {
      border-width: 2px;
    }
  }
</style>
