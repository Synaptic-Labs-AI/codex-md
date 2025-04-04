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
  import NeuralNetwork from './common/NeuralNetwork.svelte';
  import { conversionTimer } from '$lib/stores/conversionTimer';
  import { unifiedConversion, ConversionState } from '$lib/stores/unifiedConversion';
  import { conversionMessages, getRandomMessage } from '$lib/utils/conversionMessages';
  
  // Component references
  let neuralNetwork;
  
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
  let isAnimating = false; // Flag to track if animation is in progress
  
  // Animation configuration
  const typingSpeed = 40; // milliseconds per character
  const messageDisplayTime = 4000; // Time to display a message before showing the next one
  const typingIndicatorTime = 800; // Time to show typing indicator before starting to type

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
    
    // Stop message animation
    stopMessageAnimation();
  }

  // Function to reset state
  export function resetState() {
    isPersistentlyCompleted = false;
    completionMessage = '';
    finalTotalCount = 0;
    finalElapsedTime = '';
    
    // Reset message animation
    stopMessageAnimation();
    
    // Start a new animation if needed
    if (status !== ConversionState.STATUS.IDLE && 
        status !== ConversionState.STATUS.COMPLETED && 
        status !== ConversionState.STATUS.ERROR &&
        status !== ConversionState.STATUS.CANCELLED) {
      animateMessage();
    }
  }

  /**
   * Manages the complete animation sequence for a message:
   * 1. Show typing indicator
   * 2. Type out the message
   * 3. Pause to let user read
   * 4. Move to next message
   */
  function animateMessage() {
    // If already animating, don't start a new animation
    if (isAnimating) return;
    
    isAnimating = true;
    
    // Get a random message
    currentMessage = getRandomMessage();
    displayedMessage = '';
    
    // Step 1: Show typing indicator
    isTyping = true;
    showMessage = true;
    
    // Step 2: After delay, hide indicator and start typing
    typingTimeout = setTimeout(() => {
      isTyping = false;
      
      // Type out the message character by character
      let charIndex = 0;
      let fullMessage = currentMessage;
      
      typingInterval = setInterval(() => {
        if (charIndex < fullMessage.length) {
          displayedMessage = fullMessage.substring(0, charIndex + 1);
          charIndex++;
        } else {
          // Typing complete, clear interval
          clearInterval(typingInterval);
          typingInterval = null;
          
          // Step 3: Pause to let user read the message
          typingTimeout = setTimeout(() => {
            // Step 4: Schedule next message
            messageTimeout = setTimeout(() => {
              isAnimating = false;
              animateMessage();
            }, 100); // Small delay before starting next animation
          }, messageDisplayTime);
        }
      }, typingSpeed);
    }, typingIndicatorTime);
  }

  /**
   * Stops all animations and clears all timers
   */
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

  // Subscription to conversion state
  const unsubStatus = unifiedConversion.subscribe(value => {
    // Update minimal set of properties
    status = value.status;
    totalCount = value.totalCount || 0;
    error = value.error;

    // Start timer and message animation as soon as conversion starts
    if (status !== ConversionState.STATUS.IDLE && 
        status !== ConversionState.STATUS.COMPLETED && 
        status !== ConversionState.STATUS.ERROR &&
        status !== ConversionState.STATUS.CANCELLED &&
        !$conversionTimer.isRunning) {
      conversionTimer.start();
      
      // Start message animation if not already running
      if (!isAnimating) {
        animateMessage();
      }
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
      stopMessageAnimation();
    }
  });

  onMount(() => {
    // Start message animation immediately if conversion is active
    if (status !== ConversionState.STATUS.IDLE && 
        status !== ConversionState.STATUS.COMPLETED && 
        status !== ConversionState.STATUS.ERROR &&
        status !== ConversionState.STATUS.CANCELLED &&
        !isPersistentlyCompleted) {
      
      // Start message animation if not already running
      if (!isAnimating) {
        animateMessage();
      }
      
      // Start timer if not already running
      if (!$conversionTimer.isRunning) {
        conversionTimer.start();
      }
    }
  });

  // Update neural network when seconds count changes, unless completed
  $: if (neuralNetwork && $conversionTimer.secondsCount > 0 && 
         status !== ConversionState.STATUS.COMPLETED) {
    neuralNetwork.updateNetwork($conversionTimer.secondsCount);
  }

  onDestroy(() => {
    unsubStatus();
    stopMessageAnimation();
    // Don't reset the timer on component destroy
    // This ensures the timer continues across different phases
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

    <!-- Neural Network Visualization -->
    <div class="neural-network-container" class:fade-in={status !== ConversionState.STATUS.IDLE}>
      <NeuralNetwork 
        secondsCount={$conversionTimer.secondsCount}
        bind:this={neuralNetwork}
        keepAlive={status === ConversionState.STATUS.COMPLETED}
      />
    </div>
  </div>
{/if}

<style>
  .conversion-progress {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    padding: 1rem;
    max-width: 900px;
    margin: 0 auto;
  }
  
  .chat-container {
    margin-bottom: 0;
  }
  
  .neural-network-container {
    margin: 0;
  }

  .fade-in {
    animation: fadeIn 0.3s ease-in;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
