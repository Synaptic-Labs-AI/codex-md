<!-- src/routes/settings/+page.svelte -->
<script>
  import ApiKeySettings from '$lib/components/settings/ApiKeySettings.svelte';
  import TranscriptionSettings from '$lib/components/settings/TranscriptionSettings.svelte';
  import Container from '$lib/components/common/Container.svelte';
</script>

<div class="settings-container">
  <h1>Settings</h1>
  
  <div class="settings-grid">
    <Container 
      title="API Keys" 
      subtitle="Configure API keys for external services used by codex.md."
      isGradient={true}
    >
      <ApiKeySettings />
    </Container>
    
    <Container 
      title="Transcription" 
      subtitle="Configure transcription model and settings for audio/video conversions."
      isGradient={true}
    >
      <TranscriptionSettings />
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
  }
</style>
