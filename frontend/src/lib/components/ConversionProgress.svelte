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
  import { conversionMessages, getRandomMessage } from '$lib/utils/conversionMessages';
  
  // Track bubble position to alternate
  let bubblePosition = 'left';
  
  // Function to toggle and return position
  function togglePosition() {
    bubblePosition = bubblePosition === 'left' ? 'right' : 'left';
    return bubblePosition;
  }

  // State for message rotation and typing animation
  let messageInterval;
  let typingInterval;
  let currentMessage = '';
  let displayedMessage = '';
  let isTyping = true;
  let showMessage = true;
  
  // Typing animation configuration
  const typingSpeed = 40; // milliseconds per character

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
    
    // Reset message rotation and typing animation
    stopMessageRotation();
    stopTypingAnimation();
    updateCurrentMessage();
  }

  // Function to get a random message and start typing animation
  function updateCurrentMessage() {
    // Get a random message
    currentMessage = getRandomMessage();
    displayedMessage = '';
    
    // Start typing animation
    startTypingAnimation();
  }

  // Start typing animation for the current message
  function startTypingAnimation() {
    // Clear any existing typing animation
    stopTypingAnimation();
    
    // Show typing indicator first
    isTyping = true;
    showMessage = true;
    displayedMessage = '';
    
    // Start typing after a short delay
    setTimeout(() => {
      isTyping = false;
      
      // Type out the message character by character
      let charIndex = 0;
      let fullMessage = currentMessage; // Store the complete message
      
      typingInterval = setInterval(() => {
        if (charIndex < fullMessage.length) {
          // Replace the entire message with a substring of increasing length
          // This prevents character duplication issues
          displayedMessage = fullMessage.substring(0, charIndex + 1);
          charIndex++;
        } else {
          // Typing complete
          stopTypingAnimation();
        }
      }, typingSpeed);
    }, 800); // Show typing indicator for 800ms before starting to type
  }

  // Stop typing animation
  function stopTypingAnimation() {
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  }

  // Start message rotation - completely independent of conversion progress
  function startMessageRotation() {
    // Initialize with first message
    updateCurrentMessage();
    
    // Calculate a reasonable interval based on average message length and typing speed
    // This ensures messages have time to fully type out before changing
    const avgMessageLength = 50; // Approximate average character count
    const typingTime = avgMessageLength * typingSpeed; // Time to type average message
    const pauseTime = 2000; // Time to pause after typing completes
    const totalRotationTime = typingTime + pauseTime + 800; // Total time including typing indicator
    
    // Set up interval to rotate messages
    if (!messageInterval) {
      messageInterval = setInterval(() => {
        updateCurrentMessage();
      }, totalRotationTime);
    }
  }

  // Stop message rotation
  function stopMessageRotation() {
    if (messageInterval) {
      clearInterval(messageInterval);
      messageInterval = null;
    }
    stopTypingAnimation();
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
      <!-- Show rotating fun messages during active conversion with typing effect -->
      <ChatBubble
        name="Codex"
        avatar="📖"
        message={displayedMessage}
        avatarPosition={togglePosition()}
        isTyping={isTyping}
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
