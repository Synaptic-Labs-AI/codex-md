<!-- src/routes/settings/+page.svelte -->
<script>
  import { onMount } from 'svelte';
  import { settings, setOcrEnabled } from '$lib/stores/settings.js';
  import ApiKeyInput from '$lib/components/ApiKeyInput.svelte';
  import TranscriptionSettings from '$lib/components/settings/TranscriptionSettings.svelte';
  import Toggle from '$lib/components/common/Toggle.svelte';
  import Accordion from '$lib/components/common/Accordion.svelte';
  import Container from '$lib/components/common/Container.svelte';
  
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
    if (window?.electronAPI?.getSetting) {
      window.electronAPI.getSetting('ocr.enabled')
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
    <Container 
      title="API Keys" 
      subtitle="Configure API keys for external services used by codex.md."
      isGradient={true}
    >
      <div class="api-keys-section">
        <h3>OpenAI API Key</h3>
        <ApiKeyInput provider="openai" />
        
        <h3>Mistral API Key</h3>
        <ApiKeyInput provider="mistral" />
      </div>
    </Container>
    
    <Container 
      title="Document Processing" 
      subtitle="Configure transcription and OCR settings for document conversions."
      isGradient={true}
    >
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
    padding: 2rem;
  }
  
  .settings-grid {
    display: grid;
    gap: 2rem;
  }
  
  h1 {
    font-size: 2rem;
    margin-bottom: 2rem;
    color: var(--color-text);
  }

  /* Remove reduced motion if your app doesn't need it */
  @media (prefers-reduced-motion: reduce) {
    :global(.settings-container .codex-md-brand) {
      animation: none;
    }
  }

  /* API keys section styles */
  .api-keys-section {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  
  .api-keys-section h3 {
    font-size: 1.25rem;
    margin-bottom: 0.5rem;
    color: var(--color-text);
  }
  
  /* Processing settings styles */
  .processing-settings {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  
  .processing-settings h3 {
    font-size: 1.25rem;
    margin-bottom: 0.5rem;
    color: var(--color-text);
  }
  
  /* OCR toggle section styles */
  .ocr-toggle-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .description {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    margin-top: var(--spacing-xs);
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
      padding: 1rem;
    }
    
    .settings-grid {
      gap: 1.5rem;
    }
    
    h1 {
      font-size: 1.75rem;
      margin-bottom: 1.5rem;
    }
    
    .processing-settings {
      gap: 1.5rem;
    }
  }
</style>
