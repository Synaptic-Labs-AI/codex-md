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
  import ToggleGroup from '../common/ToggleGroup.svelte';

  let selectedModel = 'nova-2';

  // Available Deepgram transcription models
  const models = [
    { id: 'nova-3', name: 'Nova 3', description: 'Deepgram\'s latest and most accurate model with enhanced formatting and understanding.' },
    { id: 'nova-2', name: 'Nova 2', description: 'Previous generation model with good accuracy and competitive performance.' },
    { id: 'nova-1', name: 'Nova 1', description: 'Stable model with fast processing time and reliable results.' }
  ];

  // Convert models to options for ToggleGroup
  const modelOptions = models.map(model => ({
    value: model.id,
    label: model.name,
    icon: model.id === 'nova-3' ? '🌟' : model.id === 'nova-2' ? '⚡' : '🚀'
  }));

  // Get model description based on selected model
  $: modelDescription = models.find(m => m.id === selectedModel)?.description || '';

  // Subscribe to settings store
  const unsubscribe = settings.subscribe(value => {
    selectedModel = value.transcription?.model || 'nova-2';
  });

  // Update model when selection changes
  function updateModel(event) {
    selectedModel = event.detail.value;
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
  <!-- Heading is provided by the SettingsSection component -->

  <!-- Model Selection -->
  <div class="settings-section">
    <ToggleGroup
      options={modelOptions}
      value={selectedModel}
      name="transcription-model"
      on:change={updateModel}
    />

    <p class="model-description">
      {modelDescription}
    </p>

    <Accordion title="About Deepgram Transcription Models" icon="🎙️">
      <div class="info-content">
        <p>
          Deepgram provides high-quality transcription for both audio and video files:
        </p>
        <ul>
          <li><strong>Nova 3:</strong> Best accuracy and formatting, great for complex content</li>
          <li><strong>Nova 2:</strong> Good balance of speed and accuracy</li>
          <li><strong>Nova 1:</strong> Fastest processing, reliable for clear audio</li>
        </ul>
        <h4>Supported Files:</h4>
        <ul>
          <li><strong>Audio:</strong> MP3, MP4, M4A, WAV, FLAC, OGG, AAC, and more</li>
          <li><strong>Video:</strong> MP4, MOV, AVI, MKV, WEBM, and other video formats</li>
        </ul>
        <p class="deepgram-info">
          Learn more about <a href="https://developers.deepgram.com/" target="_blank" rel="noopener noreferrer">Deepgram's transcription technology</a>.
        </p>
      </div>
    </Accordion>
  </div>
</div>

<style>
  .transcription-settings {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
  }

  /* h2 removed as it's provided by the parent SettingsSection component */

  h3 {
    font-size: 1.2rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--color-text);
  }

  .settings-section {
    padding-bottom: var(--spacing-lg);
  }

  .settings-section:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .model-description {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    margin-top: var(--spacing-sm);
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

  .info-content a {
    color: var(--color-prime);
    text-decoration: none;
  }

  .info-content a:hover {
    text-decoration: underline;
  }

  .deepgram-info {
    font-style: italic;
    margin-top: var(--spacing-md);
  }

  /* High Contrast Mode */
  @media (prefers-contrast: high) {
    .model-select {
      border-width: 2px;
    }
  }
</style>
