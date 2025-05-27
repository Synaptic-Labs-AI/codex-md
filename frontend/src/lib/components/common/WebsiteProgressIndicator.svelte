<!-- WebsiteProgressIndicator.svelte -->
<script>
  import { websiteData } from '@lib/stores/unifiedConversion.js';
  import { fade } from 'svelte/transition';
  
  // Format time remaining
  function formatTimeRemaining(seconds) {
    if (!seconds || seconds < 0) return 'Calculating...';
    
    if (seconds < 60) {
      return `${Math.round(seconds)}s remaining`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${minutes}m ${secs}s remaining`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m remaining`;
    }
  }
  
  // Truncate URL for display
  function truncateUrl(url, maxLength = 60) {
    if (!url || url.length <= maxLength) return url;
    
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      if (path.length > 30) {
        return `${urlObj.hostname}${path.substring(0, 15)}...${path.substring(path.length - 15)}`;
      }
      
      return `${urlObj.hostname}${path}`;
    } catch {
      // Fallback for invalid URLs
      return url.length > maxLength 
        ? `${url.substring(0, maxLength - 3)}...`
        : url;
    }
  }
  
  $: totalPages = $websiteData.totalDiscovered;
  $: completedPages = $websiteData.completed;
  $: processingPages = $websiteData.processing;
  $: currentPage = $websiteData.currentPage;
  $: timeRemaining = $websiteData.estimatedTimeRemaining;
  $: processingRate = $websiteData.processingRate;
</script>

{#if totalPages > 0}
  <div class="website-progress" transition:fade={{ duration: 200 }}>
    <div class="progress-stats">
      <span class="stat-item">
        <span class="stat-label">Pages:</span>
        <span class="stat-value">{completedPages} / {totalPages}</span>
      </span>
      
      {#if processingRate > 0}
        <span class="stat-item">
          <span class="stat-label">Speed:</span>
          <span class="stat-value">{processingRate.toFixed(1)} pages/s</span>
        </span>
      {/if}
      
      {#if timeRemaining !== null}
        <span class="stat-item">
          <span class="stat-label">Est. time:</span>
          <span class="stat-value">{formatTimeRemaining(timeRemaining)}</span>
        </span>
      {/if}
    </div>
    
    {#if currentPage}
      <div class="current-page" transition:fade={{ duration: 150 }}>
        <span class="page-label">Processing:</span>
        <span class="page-url" title={currentPage.url}>
          {truncateUrl(currentPage.url)}
        </span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .website-progress {
    margin: 0.75rem 0;
    padding: 0.75rem;
    background: rgba(249, 250, 251, 0.8);
    border-radius: 8px;
    font-size: 0.875rem;
  }
  
  .progress-stats {
    display: flex;
    justify-content: center;
    gap: 1.5rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }
  
  .stat-item {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  
  .stat-label {
    color: #6B7280;
    font-weight: 500;
  }
  
  .stat-value {
    color: #111827;
    font-weight: 600;
  }
  
  .current-page {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid #E5E7EB;
  }
  
  .page-label {
    color: #6B7280;
    font-weight: 500;
  }
  
  .page-url {
    color: #3B82F6;
    font-family: monospace;
    font-size: 0.8125rem;
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  /* Responsive adjustments */
  @media (max-width: 640px) {
    .progress-stats {
      gap: 1rem;
    }
    
    .page-url {
      max-width: 250px;
    }
  }
</style>