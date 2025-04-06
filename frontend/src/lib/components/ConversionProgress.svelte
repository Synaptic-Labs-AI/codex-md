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
  import ChatBubble from './common/ChatBubble.svelte';
  import Timer from './common/Timer.svelte';
  import { conversionTimer } from '$lib/stores/conversionTimer';
  import { unifiedConversion, ConversionState } from '$lib/stores/unifiedConversion';
  import { getRandomMessage } from '$lib/utils/conversionMessages';
  
  // Track bubble position to alternate
  let bubblePosition = 'left';
  
  // Function to toggle and return position
  function togglePosition() {
    bubblePosition = bubblePosition === 'left' ? 'right' : 'left';
    return bubblePosition;
  }

  // State for message rotation and typing animation
  let messageTimeout;
  let typingTimeout;
  let typingInterval;
  let currentMessage = '';
  let displayedMessage = '';
  let isTyping = true;
  let showMessage = true;
  let isAnimating = false;
  
  // Animation configuration
  const typingSpeed = 40; // milliseconds per character
  const messageDisplayTime = 4000; // Time to display message
  const typingIndicatorTime = 800; // Time to show typing indicator

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
    
    // Use the timer's captureAndStop method to ensure we get the final time
    conversionTimer.captureAndStop();
    finalElapsedTime = $conversionTimer.elapsedTime;
    
    completionMessage = `Successfully converted ${finalTotalCount > 0 ? `all ${finalTotalCount} files` : 'your content'}! 🎉<br>Time taken: ${finalElapsedTime}`;
    stopMessageAnimation();
  }

  // Function to reset state with enhanced timer cleanup
  export function resetState() {
    isPersistentlyCompleted = false;
    completionMessage = '';
    finalTotalCount = 0;
    finalElapsedTime = '';
    stopMessageAnimation();
    
    // Enhanced timer cleanup
    conversionTimer.captureAndStop();
    conversionTimer.reset();
    
    // Only start animation if we're in an active conversion state
    if (status !== ConversionState.STATUS.IDLE && 
        status !== ConversionState.STATUS.COMPLETED && 
        status !== ConversionState.STATUS.ERROR &&
        status !== ConversionState.STATUS.CANCELLED) {
      animateMessage();
    }
  }

  function animateMessage() {
    if (isAnimating) return;
    
    isAnimating = true;
    currentMessage = getRandomMessage();
    displayedMessage = '';
    isTyping = true;
    showMessage = true;
    
    typingTimeout = setTimeout(() => {
      isTyping = false;
      
      let charIndex = 0;
      let fullMessage = currentMessage;
      
      typingInterval = setInterval(() => {
        if (charIndex < fullMessage.length) {
          displayedMessage = fullMessage.substring(0, charIndex + 1);
          charIndex++;
        } else {
          clearInterval(typingInterval);
          typingInterval = null;
          
          typingTimeout = setTimeout(() => {
            messageTimeout = setTimeout(() => {
              isAnimating = false;
              animateMessage();
            }, 100);
          }, messageDisplayTime);
        }
      }, typingSpeed);
    }, typingIndicatorTime);
  }

  function stopMessageAnimation() {
    isAnimating = false;
    
    if (messageTimeout) {
      clearTimeout(messageTimeout);
      messageTimeout = null;
    }
    
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      typingTimeout = null;
    }
    
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  }

  // Subscription to conversion state with enhanced completion handling
  const unsubStatus = unifiedConversion.subscribe(value => {
    const prevStatus = status;
    status = value.status;
    totalCount = value.totalCount || 0;
    error = value.error;

    // Handle transition to active state
    if (status !== ConversionState.STATUS.IDLE && 
        status !== ConversionState.STATUS.COMPLETED && 
        status !== ConversionState.STATUS.ERROR &&
        status !== ConversionState.STATUS.CANCELLED &&
        !$conversionTimer.isRunning) {
      conversionTimer.start();
      
      if (!isAnimating) {
        animateMessage();
      }
    }
    
    // Handle completion state
    if (status === ConversionState.STATUS.COMPLETED) {
      if (!isPersistentlyCompleted) {
        captureCompletionState();
      } else if ($conversionTimer.isRunning) {
        // Safety check: ensure timer is stopped if completion state is persistent
        conversionTimer.captureAndStop();
      }
    }
    
    // Handle error and cancellation states
    if ((status === ConversionState.STATUS.ERROR || 
         status === ConversionState.STATUS.CANCELLED) &&
        prevStatus !== status) {  // Only handle state change
      conversionTimer.captureAndStop();
      stopMessageAnimation();
    }
  });

  onMount(() => {
    if (status !== ConversionState.STATUS.IDLE && 
        status !== ConversionState.STATUS.COMPLETED && 
        status !== ConversionState.STATUS.ERROR &&
        status !== ConversionState.STATUS.CANCELLED &&
        !isPersistentlyCompleted) {
      
      if (!isAnimating) {
        animateMessage();
      }
      
      if (!$conversionTimer.isRunning) {
        conversionTimer.start();
      }
    }
  });

  // Ensure timer cleanup on component destroy
  onDestroy(() => {
    unsubStatus();
    stopMessageAnimation();
    conversionTimer.captureAndStop();
  });
</script>

{#if status !== ConversionState.STATUS.IDLE && status !== ConversionState.STATUS.CANCELLED}
  <div class="conversion-progress" class:fade-in={status !== ConversionState.STATUS.IDLE}>
    <!-- Chat Bubbles -->
    <div class="chat-container">
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

    <!-- Conversion Timer -->
    <Timer time={$conversionTimer.elapsedTime} />
  </div>
{/if}

<style>
  .conversion-progress {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    max-width: 900px;
    margin: 0 auto;
    align-items: center;
  }
  
  .chat-container {
    margin-bottom: 0;
    width: 100%;
  }

  .fade-in {
    animation: fadeIn 0.3s ease-in;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
