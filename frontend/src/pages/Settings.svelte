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
  import { settings, setOcrEnabled } from '../lib/stores/settings.js';
  import ApiKeyInput from '../lib/components/ApiKeyInput.svelte';
  import TranscriptionSettings from '../lib/components/settings/TranscriptionSettings.svelte';
  import Toggle from '../lib/components/common/Toggle.svelte';
  import Accordion from '../lib/components/common/Accordion.svelte';
  import Container from '../lib/components/common/Container.svelte';
  
  // Local binding for OCR enabled state
  let ocrEnabled = false;
  
  // Subscribe to settings store
  const unsubscribe = settings.subscribe(value => {
    ocrEnabled = value.ocr?.enabled || false;
  });
  
  // Update settings when toggle changes
  function handleToggleChange(event) {
    setOcrEnabled(ocrEnabled);
  }
  
  onMount(() => {
    // Initialize from electron settings if available
    if (window?.electron?.getSetting) {
      window.electron.getSetting('ocr.enabled')
        .then(value => {
          if (value !== undefined) {
            ocrEnabled = value;
            setOcrEnabled(value);
          }
        })
        .catch(err => console.error('Error loading OCR settings:', err));
    }
    
    return () => {
      unsubscribe();
    };
  });
</script>

<div class="settings-container">
  <h1>Settings</h1>
  
  <div class="settings-grid">
    <Container>
      <div class="container-header">
        <h2>API Keys</h2>
        <p class="subtitle">Configure API keys for external services used by codex.md.</p>
      </div>
      
      <div class="api-keys-section">
        <h3>OpenAI API Key</h3>
        <ApiKeyInput provider="openai" />
        
        <h3>Mistral API Key</h3>
        <ApiKeyInput provider="mistral" />
      </div>
    </Container>
    
    <Container>
      <div class="container-header">
        <h2>Document Processing</h2>
        <p class="subtitle">Configure transcription and OCR settings for document conversions.</p>
      </div>
      
      <div class="processing-settings">
        <h3>Transcription</h3>
        <TranscriptionSettings />
        
        <h3>Advanced PDF Processing</h3>
        <div class="ocr-toggle-section">
          <Toggle 
            bind:checked={ocrEnabled} 
            on:change={handleToggleChange}
            label="Enable advanced OCR for PDF documents" 
          />
          <p class="description">
            When enabled, Mistral's advanced OCR will be used to process PDF documents,
            providing better text extraction and document understanding capabilities.
          </p>
          
          <Accordion title="About Mistral OCR" icon="ℹ️">
            <div class="info-content">
              <p>
                Mistral's OCR (Optical Character Recognition) technology provides enhanced PDF processing with:
              </p>
              <ul>
                <li>Better text extraction from complex layouts</li>
                <li>Preservation of document structure and formatting</li>
                <li>Support for tables, lists, and other complex elements</li>
                <li>Higher accuracy for difficult-to-read documents</li>
              </ul>
            </div>
          </Accordion>
        </div>
      </div>
    </Container>
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

  /* API keys section styles */
  .api-keys-section {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
  }
  
  /* Processing settings styles */
  .processing-settings {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
  }
  
  h3 {
    font-size: var(--font-size-lg);
    font-weight: 600;
    margin-bottom: var(--spacing-sm);
    color: var(--color-text);
  }
  
  /* OCR toggle section styles */
  .ocr-toggle-section {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
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
  
  .info-content ul {
    padding-left: var(--spacing-md);
    margin-bottom: var(--spacing-sm);
  }
  
  .info-content li {
    margin-bottom: var(--spacing-xs);
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
