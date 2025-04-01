<!-- frontend/src/lib/components/settings/OcrSettings.svelte -->
<script>
  import { onMount } from 'svelte';
  import { settings, setOcrEnabled } from '$lib/stores/settings.js';
  import Toggle from '$lib/components/common/Toggle.svelte';
  import ApiKeyInput from '$lib/components/ApiKeyInput.svelte';
  import Accordion from '$lib/components/common/Accordion.svelte';
  
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

<div class="ocr-settings">
  <ApiKeyInput provider="mistral" />
  
  <div class="ocr-toggle-section">
    <h4>Advanced OCR Processing</h4>
    <Toggle 
      bind:checked={ocrEnabled} 
      on:change={handleToggleChange}
      label="Enable advanced OCR for PDF documents" 
    />
    <p class="description">
      When enabled, Mistral's advanced OCR will be used to process PDF documents,
      providing better text extraction and document understanding capabilities.
    </p>
  </div>
  
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

<style>
  .ocr-settings {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }
  
  .ocr-toggle-section {
    margin-top: var(--spacing-md);
  }
  
  h4 {
    font-size: var(--font-size-base);
    font-weight: 600;
    margin-bottom: var(--spacing-sm);
    color: var(--color-text);
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
</style>
