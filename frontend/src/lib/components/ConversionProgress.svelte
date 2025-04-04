<!-- 
  ConversionProgress.svelte
  
  A simplified component that shows conversion progress with a timer and rotating fun messages.
  Messages rotate on a fixed interval, completely independent of actual conversion progress.
  
  Related files:
  - frontend/src/lib/utils/conversionMessages.js: Source of fun messages
  - frontend/src/lib/stores/conversionTimer.js: Timer functionality
  - frontend/src/lib/stores/unifiedConversion.js: Basic conversion state
-->
<script>
  import { onDestroy, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import ChatBubble from './common/ChatBubble.svelte';
  import Timer from './common/Timer.svelte';
  import { conversionTimer } from '$lib/stores/conversionTimer';
  import { unifiedConversion, ConversionState } from '$lib/stores/unifiedConversion';
  import { conversionMessages } from '$lib/utils/conversionMessages';
  
  // Track bubble position to alternate
  let bubblePosition = 'left';
  
  // Function to toggle and return position
  function togglePosition() {
    bubblePosition = bubblePosition === 'left' ? 'right' : 'left';
    return bubblePosition;
  }

  // State for message rotation
  let currentMessageIndex = 0;
  let messageInterval;
  let currentMessage = '';

  // Persistent state for completion
  let isPersistentlyCompleted = false;
  let completionMessage = '';
  let finalTotalCount = 0;
  let finalElapsedTime = '';

  // Subscribe to minimal set of store properties
  let status = ConversionState.STATUS.IDLE;
  let totalCount = 0;
  let error = null;

  // Function to capture completion state
  function captureCompletionState() {
    isPersistentlyCompleted = true;
    finalTotalCount = totalCount;
    finalElapsedTime = $conversionTimer.elapsedTime;
    completionMessage = `Successfully converted ${finalTotalCount > 0 ? `all ${finalTotalCount} files` : 'your content'}! 🎉<br>Time taken: ${finalElapsedTime}`;
    
    // Clear message rotation interval
    stopMessageRotation();
  }

  // Function to reset state
  export function resetState() {
    isPersistentlyCompleted = false;
    completionMessage = '';
    finalTotalCount = 0;
    finalElapsedTime = '';
    
    // Reset message rotation
    stopMessageRotation();
    currentMessageIndex = 0;
    updateCurrentMessage();
  }

  // Function to get the next message
  function updateCurrentMessage() {
    currentMessage = conversionMessages[currentMessageIndex];
    currentMessageIndex = (currentMessageIndex + 1) % conversionMessages.length;
  }

  // Start message rotation - completely independent of conversion progress
  function startMessageRotation() {
    // Initialize with first message
    updateCurrentMessage();
    
    // Set up interval to rotate messages every 3 seconds
    if (!messageInterval) {
      messageInterval = setInterval(() => {
        updateCurrentMessage();
      }, 3000);
    }
  }

  // Stop message rotation
  function stopMessageRotation() {
    if (messageInterval) {
      clearInterval(messageInterval);
      messageInterval = null;
    }
  }

  // Simple subscription to conversion state - only care about active/completed
  const unsubStatus = unifiedConversion.subscribe(value => {
    // Update minimal set of properties
    status = value.status;
    totalCount = value.totalCount || 0;
    error = value.error;

    // Start timer and message rotation as soon as conversion starts
    if (status !== ConversionState.STATUS.IDLE && 
        status !== ConversionState.STATUS.COMPLETED && 
        status !== ConversionState.STATUS.ERROR &&
        status !== ConversionState.STATUS.CANCELLED &&
        !$conversionTimer.isRunning) {
      conversionTimer.start();
      startMessageRotation();
    }
    
    // Handle completion
    if (status === ConversionState.STATUS.COMPLETED && !isPersistentlyCompleted) {
      conversionTimer.stop();
      captureCompletionState();
    }
    
    // Handle error
    if (status === ConversionState.STATUS.ERROR || 
        status === ConversionState.STATUS.CANCELLED) {
      conversionTimer.stop();
      stopMessageRotation();
    }
  });

  onMount(() => {
    // Start message rotation immediately if conversion is active
    if (status !== ConversionState.STATUS.IDLE && 
        status !== ConversionState.STATUS.COMPLETED && 
        status !== ConversionState.STATUS.ERROR &&
        status !== ConversionState.STATUS.CANCELLED &&
        !isPersistentlyCompleted) {
      startMessageRotation();
      
      // Start timer if not already running
      if (!$conversionTimer.isRunning) {
        conversionTimer.start();
      }
    }
  });

  onDestroy(() => {
    unsubStatus();
    stopMessageRotation();
    // Don't reset the timer on component destroy
    // This ensures the timer continues across different phases
  });
</script>

{#if status !== ConversionState.STATUS.IDLE && status !== ConversionState.STATUS.CANCELLED}
  <div class="conversion-progress" in:fade>
    <!-- Timer -->
    <div in:fade>
      <Timer time={$conversionTimer.elapsedTime} />
    </div>

    <!-- Show appropriate message based on state -->
    {#if status === ConversionState.STATUS.COMPLETED || isPersistentlyCompleted}
      <ChatBubble
        name="Codex"
        avatar="📖"
        message={completionMessage}
        avatarPosition={togglePosition()}
      />
    {:else if status === ConversionState.STATUS.ERROR}
      <ChatBubble
        name="Codex"
        avatar="📖"
        message={`Encountered an error during conversion: ${error || 'Unknown error'}. Please try again.`}
        avatarPosition={togglePosition()}
      />
    {:else if status === 'stopped' || status === ConversionState.STATUS.CANCELLED}
      <ChatBubble
        name="Codex"
        avatar="📖"
        message={`Conversion ${status === ConversionState.STATUS.CANCELLED ? 'cancelled' : 'stopped'}. ${totalCount > 0 ? `Processed some of ${totalCount} files.` : ''}`}
        avatarPosition={togglePosition()}
      />
    {:else}
      <!-- Show rotating fun messages during active conversion -->
      <ChatBubble
        name="Codex"
        avatar="📖"
        message={currentMessage}
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
</style>
