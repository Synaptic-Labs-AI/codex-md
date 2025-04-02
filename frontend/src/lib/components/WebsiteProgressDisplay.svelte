<!-- 
  WebsiteProgressDisplay.svelte
  
  A simplified component for displaying website conversion progress.
  Replaces the complex ConversionProgress component with a more direct
  and user-focused progress display.
-->
<script>
  import { onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import ChatBubble from './common/ChatBubble.svelte';
  import { websiteProgress, Phase } from '../stores/websiteProgressStore';
  import { conversionTimer } from '../stores/conversionTimer';
  
  // Track bubble position to alternate
  let bubblePosition = 'left';
  
  // Function to toggle and return position
  function togglePosition() {
    bubblePosition = bubblePosition === 'left' ? 'right' : 'left';
    return bubblePosition;
  }
  
  // Start timer when conversion starts
  $: if ($websiteProgress.phase !== Phase.INITIALIZING && !$conversionTimer.isRunning) {
    conversionTimer.start();
  }
  
  // Stop timer when conversion completes
  $: if (($websiteProgress.phase === Phase.COMPLETED || 
          $websiteProgress.phase === Phase.ERROR) && 
          $conversionTimer.isRunning) {
    conversionTimer.stop();
  }
  
  // Calculate estimated time remaining
  $: estimatedTimeRemaining = $websiteProgress.pagesFound > 0 && 
                             $websiteProgress.pagesProcessed > 0 && 
                             $websiteProgress.startTime ? 
    calculateTimeRemaining($websiteProgress.startTime, 
                          $websiteProgress.pagesProcessed, 
                          $websiteProgress.pagesFound) : null;
  
  function calculateTimeRemaining(startTime, processed, total) {
    if (processed === 0) return null;
    
    const elapsedMs = Date.now() - startTime;
    const msPerPage = elapsedMs / processed;
    const remainingPages = total - processed;
    const remainingMs = msPerPage * remainingPages;
    
    // Format as seconds
    return Math.round(remainingMs / 1000);
  }
  
  function formatSeconds(seconds) {
    if (seconds < 60) return `${seconds} seconds`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
  }
</script>

{#if $websiteProgress.phase !== Phase.INITIALIZING}
  <div class="website-progress" in:fade>
    <!-- Timer -->
    <div class="timer" in:fade>
      Time elapsed: {$conversionTimer.elapsedTime}
    </div>
    
    <!-- Progress bar -->
    <div class="progress-bar">
      <div class="progress-fill" style="width: {$websiteProgress.overallProgress}%"></div>
    </div>
    
    <!-- Phase-based chat bubbles -->
    {#if $websiteProgress.phase === Phase.DISCOVERING}
      <ChatBubble
        name="Codex"
        avatar="🔍"
        message={$websiteProgress.currentActivity}
        avatarPosition={togglePosition()}
      />
    {:else if $websiteProgress.phase === Phase.PROCESSING}
      <ChatBubble
        name="Codex"
        avatar="📄"
        message={$websiteProgress.currentActivity}
        avatarPosition={togglePosition()}
      />
      
      <ChatBubble
        name="Codex"
        avatar="📊"
        message={`Processed ${$websiteProgress.pagesProcessed} of ${$websiteProgress.pagesFound} pages (${$websiteProgress.overallProgress}%)`}
        avatarPosition={togglePosition()}
      />
      
      {#if estimatedTimeRemaining}
        <ChatBubble
          name="Codex"
          avatar="⏱️"
          message={`Estimated time remaining: ${formatSeconds(estimatedTimeRemaining)}`}
          avatarPosition={togglePosition()}
        />
      {/if}
    {:else if $websiteProgress.phase === Phase.FINALIZING}
      <ChatBubble
        name="Codex"
        avatar="📚"
        message={$websiteProgress.currentActivity}
        avatarPosition={togglePosition()}
      />
    {:else if $websiteProgress.phase === Phase.COMPLETED}
      <ChatBubble
        name="Codex"
        avatar="✅"
        message={`Successfully converted ${$websiteProgress.pagesProcessed} pages! 🎉<br>Time taken: ${$conversionTimer.elapsedTime}`}
        avatarPosition={togglePosition()}
      />
    {:else if $websiteProgress.phase === Phase.ERROR}
      <ChatBubble
        name="Codex"
        avatar="❌"
        message={`Error: ${$websiteProgress.error || 'Unknown error occurred'}`}
        avatarPosition={togglePosition()}
      />
    {/if}
  </div>
{/if}

<style>
  .website-progress {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
  }
  
  .timer {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--color-text-light);
    text-align: center;
    padding: 0.5rem;
    background: var(--color-surface);
    border-radius: var(--rounded-md);
    box-shadow: var(--shadow-sm);
  }
  
  .progress-bar {
    height: 8px;
    background: var(--color-surface);
    border-radius: 4px;
    overflow: hidden;
  }
  
  .progress-fill {
    height: 100%;
    background: var(--color-primary);
    transition: width 0.3s ease;
  }
</style>
