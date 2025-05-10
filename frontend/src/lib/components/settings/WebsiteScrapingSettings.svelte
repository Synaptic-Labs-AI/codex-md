<!-- 
  WebsiteScrapingSettings.svelte - Settings component for website scraping options
  
  Provides UI for configuring how multi-page websites are converted to markdown:
  - Combined mode: All pages in a single markdown file (default)
  - Separate mode: Each page saved as a separate file in a folder
  
  Dependencies:
  - settings store for state management
  - ToggleGroup for option selection
-->
<script>
  import { onMount } from 'svelte';
  import { settings } from '../../stores/settings.js';
  import ToggleGroup from '../common/ToggleGroup.svelte';
  
  // Local binding for settings state
  let saveMode = 'combined';
  
  // Save mode options
  const saveModeOptions = [
    { value: 'combined', label: 'Combined File', icon: '📄' },
    { value: 'separate', label: 'Separate Files', icon: '📁' }
  ];
  
  // Handle save mode change
  function handleSaveModeChange(event) {
    const newMode = event.detail.value;
    console.log(`[WebsiteScrapingSettings] Save mode changed to: ${newMode}`);
    
    // Update local state
    saveMode = newMode;
    
    // Update the store
    if (window?.electron?.setSetting) {
      window.electron.setSetting('websiteScraping.saveMode', newMode)
        .catch(err => console.error('Error saving website scraping mode:', err));
    }
  }
  
  // Subscribe to settings store
  const unsubscribe = settings.subscribe(value => {
    saveMode = value.websiteScraping?.saveMode || 'combined';
  });
  
  onMount(() => {
    // Initialize from electron settings if available
    if (window?.electron?.getSetting) {
      window.electron.getSetting('websiteScraping.saveMode')
        .then(value => {
          if (value !== undefined) {
            saveMode = value;
          }
        })
        .catch(err => console.error('Error loading website scraping settings:', err));
    }
    
    return () => {
      unsubscribe();
    };
  });
</script>

<div class="scraping-settings">
  <ToggleGroup
    options={saveModeOptions}
    bind:value={saveMode}
    name="website-save-mode"
    on:change={handleSaveModeChange}
  />
</div>

<style>
  .scraping-settings {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }
</style>