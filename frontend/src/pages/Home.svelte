<!-- 
  Home.svelte - Main converter interface
  This is the primary page component that hosts the file conversion interface.
  Migrated from SvelteKit routes to a standard Svelte component.
  
  Key features:
  - File upload and conversion interface
  - Progress tracking
  - Result display
  
  Connected components:
  - CodexMdConverter.svelte: Main converter component
-->
<script>
  import CodexMdConverter from '../lib/components/CodexMdConverter.svelte';
</script>

<div class="home-container">
  <CodexMdConverter />
</div>

<style>
  .home-container {
    width: 100%;
    height: 100%;
    padding: 1rem;
  }
</style>
