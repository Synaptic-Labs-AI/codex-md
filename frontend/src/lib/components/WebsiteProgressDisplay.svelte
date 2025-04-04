<!-- 
  WebsiteProgressDisplay.svelte
  
  Displays website conversion progress using chat bubbles that alternate sides.
  Shows progress through three phases: Prepare, Converting, and Complete.
  Only one chat bubble is shown at a time, with smooth transitions between phases.
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import ChatBubble from './common/ChatBubble.svelte';
  import { websiteProgress, ConversionState } from '../stores/unifiedConversion';
  import { conversionTimer } from '../stores/conversionTimer';

  // Map ConversionState to Phase for backward compatibility
  const Phase = {
    PREPARE: ConversionState.STATUS.PREPARING,
    CONVERTING: ConversionState.STATUS.CONVERTING,
    COMPLETE: ConversionState.STATUS.COMPLETED
  };

  // State tracking
  let bubblePosition = 'left';
  let showBubble = true;
  let currentMessage = '';
  let lastProgress = null;
  let lastPhase = null;
  let lastUrl = null;
  let transitionPromise = null;
  let isTyping = false;
  let showMessage = true;

  // Function to toggle and return position
  function togglePosition() {
    bubblePosition = bubblePosition === 'left' ? 'right' : 'left';
    return bubblePosition;
  }

  // Helper function to handle message transitions
  async function updateMessage(newMessage, immediate = false) {
    if (newMessage === currentMessage) return;

    // Wait for any ongoing transition
    if (transitionPromise) await transitionPromise;

    showBubble = false;
    showMessage = false;
    transitionPromise = new Promise(resolve => {
      setTimeout(() => {
        currentMessage = newMessage;
        showBubble = true;
        isTyping = true;
        
        setTimeout(() => {
          isTyping = false;
          showMessage = true;
          transitionPromise = null;
          resolve();
        }, immediate ? 0 : 800);
      }, immediate ? 0 : 150);
    });
    await transitionPromise;
  }

  // Helper to get phase-specific message
  function getPhaseMessage(phase, state) {
    switch(phase) {
      case Phase.PREPARE:
        return state.message || 'Please select a directory to save the converted files...';
      case Phase.CONVERTING:
        if (!state.currentUrl) return currentMessage;
        const progressInfo = state.totalUrls 
          ? `(page ${state.processedUrls} of ${state.totalUrls} - ${state.percentComplete}%)`
          : `(${state.percentComplete}%)`;
        return `Converting ${state.currentUrl} ${progressInfo}`;
      case Phase.COMPLETE:
        return state.error === null
          ? `Successfully converted ${state.processedUrls} pages in ${$conversionTimer.elapsedTime}! 🎉`
          : `Error: ${state.error || 'Conversion failed'}`;
      default:
        return currentMessage;
    }
  }

  // Watch for state changes
  $: {
    const phase = $websiteProgress.phase;
    const {message, currentUrl, percentComplete} = $websiteProgress;

    // Phase changes
    if (phase !== lastPhase) {
      lastPhase = phase;
      bubblePosition = phase === Phase.PREPARE ? 'left' : bubblePosition;

      let newMessage;
      switch(phase) {
        case Phase.PREPARE:
          newMessage = message || 'Analyzing website...';
          break;
        case Phase.CONVERTING:
          newMessage = getPhaseMessage(Phase.CONVERTING, $websiteProgress);
          break;
        case Phase.COMPLETE:
          newMessage = getPhaseMessage(Phase.COMPLETE, $websiteProgress);
          break;
      }
      
      if (newMessage) {
        updateMessage(newMessage, phase === Phase.PREPARE);
      }
    }
    // URL changes
    else if (phase === Phase.CONVERTING && currentUrl && currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      updateMessage(getPhaseMessage(Phase.CONVERTING, $websiteProgress));
    }
    // Progress updates
    else if (phase === Phase.CONVERTING && percentComplete !== lastProgress && currentUrl) {
      lastProgress = percentComplete;
      updateMessage(getPhaseMessage(Phase.CONVERTING, $websiteProgress));
    }
    // Message updates
    else if (message && message !== currentMessage) {
      updateMessage(message);
    }
  }

  // Start timer when conversion starts
  $: if ($websiteProgress.phase === Phase.CONVERTING && !$conversionTimer.isRunning) {
    conversionTimer.start();
  }

  // Stop timer when conversion completes
  $: if ($websiteProgress.phase === Phase.COMPLETE && $conversionTimer.isRunning) {
    conversionTimer.stop();
  }

  onMount(() => {
    // Set initial message based on current phase
    if ($websiteProgress.phase === Phase.PREPARE) {
      const message = $websiteProgress.message || 'Analyzing website...';
      updateMessage(message, true);
    }
  });

  onDestroy(() => {
    if ($conversionTimer.isRunning) {
      conversionTimer.stop();
    }
  });
</script>

<div class="website-progress">
  {#if showBubble}
    <div class="chat-container" in:fade={{ duration: 200 }} out:fade={{ duration: 100 }}>
      <ChatBubble
        name="Codex"
        avatar={$websiteProgress.phase === Phase.COMPLETE && !$websiteProgress.error ? "✅" : 
               $websiteProgress.phase === Phase.COMPLETE && $websiteProgress.error ? "❌" :
               $websiteProgress.phase === Phase.CONVERTING ? "⚙️" : "🔍"}
        message={currentMessage}
        avatarPosition={togglePosition()}
        isTyping={isTyping}
        showMessage={showMessage}
      />
    </div>
  {/if}

  {#if $websiteProgress.phase === Phase.CONVERTING}
    <div class="progress-container" in:fade>
      <div class="progress-bar">
        <div 
          class="progress-fill"
          style="width: {$websiteProgress.percentComplete}%"
        ></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .website-progress {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
  }

  .chat-container {
    margin-bottom: 1rem;
  }

  .progress-container {
    width: 100%;
    padding: 0 1rem;
  }

  .progress-bar {
    width: 100%;
    height: 4px;
    background: var(--color-border);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg,
      var(--color-prime) 0%,
      var(--color-fourth) 100%
    );
    transition: width 0.3s ease;
  }
</style>
