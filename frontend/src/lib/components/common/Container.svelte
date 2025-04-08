<!-- 
  Container.svelte - Common layout component
  Provides consistent width and padding for content sections.
  Used across various pages to maintain layout consistency.
  
  Features:
  - Responsive width constraints
  - Consistent padding
  - Optional class pass-through for customization
-->
<script>
  export let className = '';
</script>

<div class="container {className}">
  <slot />
</div>

<style>
  .container {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 var(--spacing-md);
  }

  @media (max-width: 768px) {
    .container {
      padding: 0 var(--spacing-sm);
    }
  }
</style>
