<!-- 
  SettingsSection.svelte - Reusable settings section component
  Provides consistent styling and layout for settings categories.
  
  Features:
  - Consistent styling for settings sections
  - Support for title, icon, and description
  - Visual separation from other settings
  
  Props:
  - title: string - Section title
  - icon: string - Emoji icon for the section
  - description: string - Optional subtitle description
-->
<script>
  export let title = '';
  export let icon = '';
  export let description = '';
</script>

<div class="settings-section">
  <div class="section-header">
    {#if icon}
      <span class="section-icon">{icon}</span>
    {/if}
    <h2>{title}</h2>
  </div>
  
  {#if description}
    <p class="section-description">{description}</p>
  {/if}
  
  <div class="section-content">
    <slot />
  </div>
</div>

<style>
  .settings-section {
    background-color: var(--color-surface);
    border-radius: var(--rounded-lg);
    padding: var(--spacing-lg);
    margin-bottom: var(--spacing-lg);
    box-shadow: var(--shadow-sm);
    border: 1px solid var(--color-border);
  }
  
  .section-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-xs);
  }
  
  .section-icon {
    font-size: 1.4em;
    display: flex;
    align-items: center;
  }
  
  h2 {
    font-size: var(--font-size-xl);
    font-weight: 600;
    margin: 0;
    color: var(--color-text);
  }
  
  .section-description {
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    margin-top: 0;
    margin-bottom: var(--spacing-md);
  }
  
  .section-content {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
  }
  
  /* High Contrast Mode */
  @media (prefers-contrast: high) {
    .settings-section {
      border-width: 2px;
    }
  }
</style>