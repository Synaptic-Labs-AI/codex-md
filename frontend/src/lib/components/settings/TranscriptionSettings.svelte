<!-- 
  TranscriptionSettings.svelte - Audio/Video transcription settings component
  Controls and configuration for transcription features.
  
  Features:
  - Model selection
  - Language settings
  - Quality options
  - Processing preferences
-->
<script>
  import { onMount } from 'svelte';
  import { settings } from '../../stores/settings.js';
  import Toggle from '../common/Toggle.svelte';
  import Accordion from '../common/Accordion.svelte';
  
  let autoDetectLanguage = true;
  let selectedLanguage = 'en';
  let highQualityMode = false;
  
  // Subscribe to settings store
  const unsubscribe = settings.subscribe(value => {
    autoDetectLanguage = value.transcription?.autoDetectLanguage ?? true;
    selectedLanguage = value.transcription?.language ?? 'en';
    highQualityMode = value.transcription?.highQuality ?? false;
  });
  
  // Update settings when values change
  function updateSettings() {
    settings.update(current => ({
      ...current,
      transcription: {
        ...current.transcription,
        autoDetectLanguage,
        language: selectedLanguage,
        highQuality: highQualityMode
      }
    }));
  }
  
  onMount(() => {
    // Load settings from Electron if available
    if (window?.electron?.getSettings) {
      window.electron.getSettings('transcription')
        .then(value => {
          if (value) {
            autoDetectLanguage = value.autoDetectLanguage ?? true;
            selectedLanguage = value.language ?? 'en';
            highQualityMode = value.highQuality ?? false;
            updateSettings();
          }
        })
        .catch(err => console.error('Error loading transcription settings:', err));
    }
    
    return () => {
      unsubscribe();
    };
  });
</script>

<div class="transcription-settings">
  <div class="setting-group">
    <Toggle
      bind:checked={autoDetectLanguage}
      label="Auto-detect language"
      on:change={updateSettings}
    />
    {#if !autoDetectLanguage}
      <select
        bind:value={selectedLanguage}
        on:change={updateSettings}
        class="language-select"
      >
        <option value="en">English</option>
        <option value="es">Spanish</option>
        <option value="fr">French</option>
        <option value="de">German</option>
        <option value="it">Italian</option>
        <option value="pt">Portuguese</option>
        <option value="nl">Dutch</option>
        <option value="pl">Polish</option>
        <option value="ru">Russian</option>
        <option value="ja">Japanese</option>
        <option value="ko">Korean</option>
        <option value="zh">Chinese</option>
      </select>
    {/if}
  </div>

  <div class="setting-group">
    <Toggle
      bind:checked={highQualityMode}
      label="High-quality transcription"
      on:change={updateSettings}
    />
    <p class="description">
      Uses Whisper's large model for better accuracy but takes longer to process.
    </p>
  </div>

  <Accordion title="About Language Settings" icon="ℹ️">
    <div class="info-content">
      <p>
        Auto-detect language uses AI to identify the spoken language in your audio/video.
        For best results with a known language, disable auto-detect and select the specific language.
      </p>
      <h4>Processing Times:</h4>
      <ul>
        <li>Standard Quality: ~1x content duration</li>
        <li>High Quality: ~2-3x content duration</li>
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

  .language-select {
    margin-top: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
    border: 1px solid var(--color-border);
    border-radius: var(--rounded-sm);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-size: var(--font-size-sm);
  }

  .language-select:focus {
    outline: 2px solid var(--color-prime);
    outline-offset: -2px;
  }

  .description {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    margin-left: calc(36px + var(--spacing-sm)); /* Align with toggle label */
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
    margin-bottom: var(--spacing-xs);
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
    .language-select {
      border-width: 2px;
    }
  }
</style>
