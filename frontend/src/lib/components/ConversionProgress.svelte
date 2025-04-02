<!-- src/lib/components/ConversionProgress.svelte -->
<script>
  import { onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import ChatBubble from './common/ChatBubble.svelte';
  import { conversionTimer } from '$lib/stores/conversionTimer';
  import { conversionStatus } from '$lib/stores/conversionStatus';
  
  // Track bubble position to alternate
  let bubblePosition = 'left';
  
  // Function to toggle and return position
  function togglePosition() {
    bubblePosition = bubblePosition === 'left' ? 'right' : 'left';
    return bubblePosition;
  }

  // Persistent state for completion
  let isPersistentlyCompleted = false;
  let completionMessage = '';
  let finalTotalCount = 0;
  let finalElapsedTime = '';

  // Subscribe to stores
  let status = 'idle';
  let progress = 0;
  let currentFile = null;
  let processedCount = 0;
  let totalCount = 0;
  let chunkProgress = 0;
  let completionTimestamp = null;

  // Function to capture completion state
  function captureCompletionState() {
    isPersistentlyCompleted = true;
    finalTotalCount = totalCount;
    finalElapsedTime = $conversionTimer.elapsedTime;
    completionMessage = `Successfully converted all ${finalTotalCount} files! 🎉<br>Time taken: ${finalElapsedTime}`;
  }

  // Worker initialization messages
  const workerMessages = [
    "Initializing worker processes...",
    "Setting up conversion environment...",
    "Preparing files for processing..."
  ];
  let currentWorkerMessageIndex = 0;
  let workerMessageInterval;

  // Function to reset state
  export function resetState() {
    isPersistentlyCompleted = false;
    completionMessage = '';
    finalTotalCount = 0;
    finalElapsedTime = '';
  }

  const unsubStatus = conversionStatus.subscribe(value => {
    // Don't update status if we're persistently completed unless it's explicitly reset
    if (!isPersistentlyCompleted || value.status === 'ready') {
      status = value.status;
      progress = value.progress || 0;
      currentFile = value.currentFile;
      processedCount = value.processedCount || 0;
      totalCount = value.totalCount || 0;
      chunkProgress = value.chunkProgress || 0;
      completionTimestamp = value.completionTimestamp;

      // Manage timer based on status
      const activeStates = [
        'initializing', 
        'initializing_workers', 
        'selecting_output', 
        'preparing', 
        'converting', 
        'cleaning_up',
        // Website-specific states
        'finding_sitemap',
        'parsing_sitemap',
        'crawling_pages',
        'processing_pages',
        'generating_index'
      ];
      const completedStates = ['completed', 'error', 'stopped', 'cancelled'];
      
      if (activeStates.includes(status) && !$conversionTimer.isRunning) {
        conversionTimer.start();
      } else if (completedStates.includes(status)) {
        conversionTimer.stop();
        
        // Clear worker message interval if it's running
        if (workerMessageInterval) {
          clearInterval(workerMessageInterval);
          workerMessageInterval = null;
        }

        // Capture completion state when status becomes 'completed'
        if (status === 'completed') {
          captureCompletionState();
        }
      }
    }
    
    // Start worker message rotation if we're initializing workers
    if (status === 'initializing_workers' && !workerMessageInterval) {
      currentWorkerMessageIndex = 0;
      workerMessageInterval = setInterval(() => {
        currentWorkerMessageIndex = (currentWorkerMessageIndex + 1) % workerMessages.length;
      }, 2000); // Rotate messages every 2 seconds
    } else if (status !== 'initializing_workers' && workerMessageInterval) {
      clearInterval(workerMessageInterval);
      workerMessageInterval = null;
    }
  });

  $: showChunkingProgress = (status === 'preparing' || status === 'converting') && chunkProgress > 0 && chunkProgress < 100;

  onDestroy(() => {
    unsubStatus();
    // Don't reset the timer on component destroy
    // This ensures the timer continues across different phases
  });
</script>

{#if status !== 'idle' && status !== 'cancelled'}
  <div class="conversion-progress" in:fade>
    <!-- Timer -->
    <div class="timer" in:fade>
      Time elapsed: {$conversionTimer.elapsedTime}
    </div>

    <!-- Stage-based chat bubbles -->
    {#if status === 'initializing'}
      <ChatBubble
        name="Codex"
        avatar="📖"
        message="Initializing conversion process..."
        avatarPosition={togglePosition()}
      />
    {:else if status === 'initializing_workers'}
      <ChatBubble
        name="Codex"
        avatar="📖"
        message={workerMessages[currentWorkerMessageIndex]}
        avatarPosition={togglePosition()}
      />
    {:else if status === 'selecting_output'}
      <ChatBubble
        name="Codex"
        avatar="📖"
        message="Please select an output location..."
        avatarPosition={togglePosition()}
      />
    {:else if status === 'preparing'}
      <ChatBubble
        name="Codex"
        avatar="📖"
        message="Getting everything ready..."
        avatarPosition={togglePosition()}
      />
      
      {#if showChunkingProgress}
        <ChatBubble
          name="Codex"
          avatar="📖"
          message="Breaking down {currentFile} into manageable pieces... {chunkProgress.toFixed(2)}%"
          avatarPosition={togglePosition()}
        />
      {/if}
    {:else if status === 'converting'}
      <ChatBubble
        name="Codex"
        avatar="📖"
        message="Preparing {totalCount} files for conversion..."
        avatarPosition={togglePosition()}
      />

      {#if showChunkingProgress}
        <ChatBubble
          name="Codex"
          avatar="📖"
          message="Breaking down {currentFile} into manageable pieces... {chunkProgress.toFixed(2)}%"
          avatarPosition={togglePosition()}
        />
      {/if}

      <!-- Create message content reactively -->
      {#if currentFile}
        {@const conversionMsg = `Converting ${processedCount}/${totalCount} files\nCurrent: ${currentFile} - ${progress.toFixed(2)}%`}
        <ChatBubble
          name="Codex"
          avatar="📖"
          message={conversionMsg}
          avatarPosition={togglePosition()}
        />
      {:else}
        <ChatBubble
          name="Codex"
          avatar="📖"
          message={`Converting ${processedCount}/${totalCount} files...`}
          avatarPosition={togglePosition()}
        />
      {/if}
    
    <!-- Website-specific status messages -->
    {:else if status === 'finding_sitemap'}
      <ChatBubble
        name="Codex"
        avatar="🔍"
        message="Looking for sitemap at {$conversionStatus.websiteUrl}..."
        avatarPosition={togglePosition()}
      />
      
      {#if $conversionStatus.pathFilter}
        <ChatBubble
          name="Codex"
          avatar="🔍"
          message="Using path filter: {$conversionStatus.pathFilter}"
          avatarPosition={togglePosition()}
        />
      {/if}
      
    {:else if status === 'parsing_sitemap'}
      <ChatBubble
        name="Codex"
        avatar="🔍"
        message="Found sitemap! Parsing {$conversionStatus.sitemapUrls} URLs..."
        avatarPosition={togglePosition()}
      />
      
    {:else if status === 'crawling_pages'}
      <ChatBubble
        name="Codex"
        avatar="🕸️"
        message="No sitemap found. Crawling website for links..."
        avatarPosition={togglePosition()}
      />
      
      {#if $conversionStatus.crawledUrls > 0}
        <ChatBubble
          name="Codex"
          avatar="🕸️"
          message="Discovered {$conversionStatus.crawledUrls} pages by crawling"
          avatarPosition={togglePosition()}
        />
      {/if}
      
    {:else if status === 'processing_pages'}
      <ChatBubble
        name="Codex"
        avatar="📄"
        message="Processing {$conversionStatus.discoveredUrls} pages from {$conversionStatus.websiteUrl}"
        avatarPosition={togglePosition()}
      />
      
      {#if $conversionStatus.currentFile}
        <ChatBubble
          name="Codex"
          avatar="📄"
          message="Converting page: {$conversionStatus.currentFile} ({$conversionStatus.processedCount}/{$conversionStatus.totalCount})"
          avatarPosition={togglePosition()}
        />
      {/if}
      
      {#if $conversionStatus.currentSection}
        <ChatBubble
          name="Codex"
          avatar="📄"
          message="Current section: {$conversionStatus.currentSection}"
          avatarPosition={togglePosition()}
        />
      {/if}
      
      {#if $conversionStatus.estimatedTimeRemaining}
        <ChatBubble
          name="Codex"
          avatar="⏱️"
          message="Estimated time remaining: {Math.round($conversionStatus.estimatedTimeRemaining / 1000)} seconds"
          avatarPosition={togglePosition()}
        />
      {/if}
      
    {:else if status === 'generating_index'}
      <ChatBubble
        name="Codex"
        avatar="📚"
        message="Generating index for {$conversionStatus.processedCount} pages..."
        avatarPosition={togglePosition()}
      />
      
      {#if Object.keys($conversionStatus.sectionCounts).length > 0}
        <ChatBubble
          name="Codex"
          avatar="📚"
          message="Sections: {Object.entries($conversionStatus.sectionCounts).map(([section, count]) => `${section} (${count})`).join(', ')}"
          avatarPosition={togglePosition()}
        />
      {/if}
    {:else if status === 'cleaning_up'}
      <ChatBubble
        name="Codex"
        avatar="📖"
        message="Cleaning up temporary files..."
        avatarPosition={togglePosition()}
      />
    {:else if status === 'completed' || isPersistentlyCompleted}
      <ChatBubble
        name="Codex"
        avatar="📖"
        message={isPersistentlyCompleted ? completionMessage : `Successfully converted all ${totalCount} files! 🎉<br>Time taken: ${$conversionTimer.elapsedTime}`}
        avatarPosition={togglePosition()}
      />
    {:else if status === 'error'}
      <ChatBubble
        name="Codex"
        avatar="📖"
        message="Encountered an error during conversion. Please try again."
        avatarPosition={togglePosition()}
      />
    {:else if status === 'stopped' || status === 'cancelled'}
      <ChatBubble
        name="Codex"
        avatar="📖"
        message="Conversion {status === 'cancelled' ? 'cancelled' : 'stopped'}. Processed {processedCount} of {totalCount} files."
        avatarPosition={togglePosition()}
      />
    {/if}
  </div>
{/if}

<style>
  .conversion-progress {
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
</style>
