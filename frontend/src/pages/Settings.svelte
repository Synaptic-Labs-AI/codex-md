<!-- 
  Settings.svelte - Application settings page
  Handles configuration of API keys, transcription options, and OCR settings.
  Migrated from SvelteKit routes to a standard Svelte component.
  
  Features:
  - API key management
  - Transcription settings
  - OCR configuration
  - Persistent storage integration
  
  Dependencies:
  - settings store for state management
  - ApiKeyInput for key management
  - TranscriptionSettings for audio/video options
  - Common components (Toggle, Accordion, Container)
-->
<script>
  import { onMount } from 'svelte';
  import { settings, setOcrEnabled, setThemeMode, getThemeMode } from '../lib/stores/settings.js';
  import apiKeyStore from '../lib/stores/apiKey.js';
  import ApiKeyInput from '../lib/components/ApiKeyInput.svelte';
  import TranscriptionSettings from '../lib/components/settings/TranscriptionSettings.svelte';
  import WebsiteScrapingSettings from '../lib/components/settings/WebsiteScrapingSettings.svelte';
  import DeepgramApiSettings from '../lib/components/settings/DeepgramApiSettings.svelte';
  import SettingsSection from '../lib/components/settings/SettingsSection.svelte';
  import Toggle from '../lib/components/common/Toggle.svelte';
  import Accordion from '../lib/components/common/Accordion.svelte';
  import ToggleGroup from '../lib/components/common/ToggleGroup.svelte';

  // Local binding for settings state
  let ocrEnabled = false;
  let themeMode = 'light';
  let hasMistralApiKey = false;

  // Theme options for toggle group
  const themeOptions = [
    { value: 'light', label: 'Light', icon: '☀️' },
    { value: 'dark', label: 'Dark', icon: '🌙' }
  ];

  // OCR options for toggle group
  const ocrOptions = [
    { value: 'standard', label: 'Standard', icon: '📋' },
    { value: 'advanced', label: 'Advanced OCR', icon: '🔍' }
  ];

  // Subscribe to settings store
  const unsubscribe = settings.subscribe(value => {
    ocrEnabled = value.ocr?.enabled || false;
    themeMode = value.theme?.mode || 'light';
  });

  // Subscribe to API key store
  const unsubscribeApiKey = apiKeyStore.subscribe(value => {
    hasMistralApiKey = !!value.keys.mistral;
  });

  // Update settings when toggle changes
  function handleToggleChange(event) {
    console.log(`[Settings] handleToggleChange called with event:`, event);
    console.log(`[Settings] Current ocrEnabled value: ${ocrEnabled}`);

    // Get the new value from the event detail
    const newValue = event.detail.checked;
    console.log(`[Settings] OCR toggle changed to: ${newValue}`);

    // Update local state to match the new value
    ocrEnabled = newValue;

    // Update the store with the new value
    setOcrEnabled(newValue);

    // Force a log to verify the value was updated
    console.log(`[Settings] After update, ocrEnabled = ${ocrEnabled}`);
  }

  onMount(() => {
    // Initialize from electron settings if available
    if (window?.electron?.getSetting) {
      // Load OCR settings
      window.electron.getSetting('ocr.enabled')
        .then(value => {
          if (value !== undefined) {
            ocrEnabled = value;
            setOcrEnabled(value);
          }
        })
        .catch(err => console.error('Error loading OCR settings:', err));

      // Load theme settings
      window.electron.getSetting('theme.mode')
        .then(value => {
          if (value !== undefined) {
            themeMode = value;
            // No need to call setThemeMode here as it's already applied in main.js
          }
        })
        .catch(err => console.error('Error loading theme settings:', err));

      // Check if Mistral API key exists
      window.electron.checkApiKeyExists('mistral')
        .then(result => {
          hasMistralApiKey = result.exists;
        })
        .catch(err => console.error('Error checking Mistral API key:', err));
    }

    return () => {
      unsubscribe();
      unsubscribeApiKey();
    };
  });
</script>

<div class="settings-container">
  <h1>Settings</h1>

  <div class="settings-grid">
    <!-- API Keys Section -->
    <SettingsSection
      title="API Keys"
      icon="🔑"
      description="Configure API keys for external services used by codex.md."
    >
      <div class="subsection">
        <DeepgramApiSettings />
      </div>

      <div class="subsection">
        <ApiKeyInput provider="mistral" />
      </div>
    </SettingsSection>

    <!-- Appearance Section -->
    <SettingsSection
      title="Appearance"
      icon="✨"
      description="Customize the look and feel of the application."
    >
      <ToggleGroup
        options={themeOptions}
        bind:value={themeMode}
        name="theme-mode"
        on:change={(e) => {
          console.log(`[Settings] Theme mode changed to: ${e.detail.value}`);
          setThemeMode(e.detail.value);
        }}
      />
    </SettingsSection>

    <!-- Document Processing Section -->
    <SettingsSection
      title="Document Processing"
      icon="📄"
      description="Configure PDF conversion settings."
    >
      <ToggleGroup
        options={ocrOptions}
        value={ocrEnabled ? 'advanced' : 'standard'}
        name="ocr-mode"
        on:change={(e) => {
          const isAdvanced = e.detail.value === 'advanced';
          setOcrEnabled(isAdvanced);
        }}
      />

      <div class="ocr-info">
        {#if ocrEnabled && !hasMistralApiKey}
          <div class="warning-box">
            <p><strong>Warning:</strong> Advanced OCR is enabled but no Mistral API key is configured. Please add your Mistral API key in the API Keys section above for OCR to work properly.</p>
          </div>
        {:else if ocrEnabled && hasMistralApiKey}
          <div class="success-box">
            <p><strong>Ready:</strong> Advanced OCR is enabled and Mistral API key is configured.</p>
          </div>
        {/if}
      </div>

      <Accordion title="About Mistral OCR" icon="🔍">
        <div class="info-content">
          <p>Advanced OCR features include:</p>
          <ul>
            <li>Better extraction from complex layouts</li>
            <li>Preservation of document structure</li>
            <li>Support for tables and lists</li>
            <li>Higher accuracy for difficult-to-read text</li>
          </ul>
          <p><strong>API Key Required:</strong> Advanced OCR requires a valid Mistral API key to function.</p>
        </div>
      </Accordion>
    </SettingsSection>

    <!-- Media Transcription Section -->
    <SettingsSection
      title="Audio & Video Transcription"
      icon="🎵"
      description="Configure transcription settings for audio and video files."
    >
      <TranscriptionSettings />
    </SettingsSection>

    <!-- Web Content Section -->
    <SettingsSection
      title="Web Content"
      icon="🌐"
      description="Configure how websites and web content are converted."
    >
      <WebsiteScrapingSettings />
    </SettingsSection>
  </div>
</div>

<style>
  /* Keep codex-md-brand styling consistent */
  :global(.settings-container .codex-md-brand) {
    font-weight: 700;
    background: linear-gradient(135deg, 
      #00A99D 0%,
      #00A99D 40%,
      #F7931E 100%
    );
    background-size: 400% 400%;
    animation: gradientFlow 8s ease infinite;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    display: inline-block;
  }

  @keyframes gradientFlow {
    0% { background-position: 0% 0%; }
    50% { background-position: 100% 100%; }
    100% { background-position: 0% 0%; }
  }

  .settings-container {
    max-width: 800px;
    margin: 0 auto;
    padding: var(--spacing-lg);
  }
  
  .settings-grid {
    display: grid;
    gap: var(--spacing-lg);
  }
  
  h1 {
    font-size: var(--font-size-2xl);
    font-weight: 700;
    margin-bottom: var(--spacing-xl);
    color: var(--color-text);
  }

  .container-header {
    margin-bottom: var(--spacing-lg);
  }

  h2 {
    font-size: var(--font-size-xl);
    font-weight: 600;
    margin-bottom: var(--spacing-xs);
    color: var(--color-text);
  }

  .subtitle {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }

  h3 {
    font-size: var(--font-size-lg);
    font-weight: 600;
    margin-bottom: var(--spacing-sm);
    color: var(--color-text);
  }

  .subsection {
    margin-bottom: var(--spacing-lg);
  }

  .subsection:last-child {
    margin-bottom: 0;
  }
  
  .info-content {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }
  
  .info-content p {
    margin-bottom: var(--spacing-sm);
  }
  
  .info-content ul {
    padding-left: var(--spacing-md);
    margin-bottom: var(--spacing-sm);
  }
  
  .info-content li {
    margin-bottom: var(--spacing-xs);
  }

  .ocr-info {
    margin-top: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }

  .warning-box {
    padding: var(--spacing-sm);
    background-color: rgba(255, 193, 7, 0.1);
    border-left: 3px solid #ffc107;
    border-radius: var(--rounded-sm);
    margin-bottom: var(--spacing-md);
  }

  .warning-box p {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-sm);
  }

  .success-box {
    padding: var(--spacing-sm);
    background-color: rgba(76, 175, 80, 0.1);
    border-left: 3px solid #4caf50;
    border-radius: var(--rounded-sm);
    margin-bottom: var(--spacing-md);
  }

  .success-box p {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-sm);
  }
  
  /* Responsive adjustments */
  @media (max-width: 600px) {
    .settings-container {
      padding: var(--spacing-md);
    }
    
    .settings-grid {
      gap: var(--spacing-md);
    }
    
    h1 {
      font-size: var(--font-size-xl);
      margin-bottom: var(--spacing-lg);
    }
    
    .processing-settings {
      gap: var(--spacing-md);
    }
  }

  /* Reduced Motion */
  @media (prefers-reduced-motion: reduce) {
    :global(.settings-container .codex-md-brand) {
      animation: none;
    }
  }
</style>
