<!-- 
  WelcomeChat.svelte - Welcome and announcement modal component
  Provides interactive welcome messages and announcements to users.
  
  Features:
  - Animated message display
  - Multiple message types (welcome, update, announcement)
  - Progress tracking
  - API key integration
  - Client-side navigation
  
  Dependencies:
  - svelte-spa-router for navigation
  - ChatBubble component for message display
  - Button component for actions
  - welcomeState store for state management
  - apiKey store for API key status
-->
<script>
  import { fade, fly } from 'svelte/transition';
  import { elasticOut, backOut } from 'svelte/easing';
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { push } from 'svelte-spa-router';
  import ChatBubble from './ChatBubble.svelte';
  import Button from './Button.svelte';
  import welcomeState, { MESSAGE_TYPES } from '../../../lib/stores/welcomeState';
  import { apiKey } from '../../../lib/stores/apiKey';
  
  const dispatch = createEventDispatcher();
  
  // Props
  export let messageType = MESSAGE_TYPES.WELCOME;
  export let showOnMount = true;
  
  let isOpen = true; // Always start open
  let visibleMessages = [];
  let apiKeyValue;
  let shouldShow = false;
  
  // Subscribe to API key store
  const unsubApiKey = apiKey.subscribe(value => {
    apiKeyValue = value;
  });
  
  // Clean up subscriptions
  onDestroy(() => {
    unsubApiKey();
  });
  // Initialize on mount
  onMount(() => {
    // Check if we should show this message type (now synchronous with localStorage)
    if (messageType === MESSAGE_TYPES.WELCOME) {
      shouldShow = welcomeState.shouldShowWelcome();
      console.log('[WelcomeChat] Should show welcome:', shouldShow);
    } else {
      shouldShow = welcomeState.shouldShowMessageType(messageType);
    }
    
    // If we should show and showOnMount is true, animate messages
    if (shouldShow && showOnMount) {
      animateMessages();
    }
  });

  // Message templates for different message types
  const messageTemplates = {
    [MESSAGE_TYPES.WELCOME]: [
      {
        type: 'received',
        name: 'Professor Synapse',
        avatar: '🧙🏾‍♂️',
        text: 'Let me introduce you to <span class="codex-md-brand">codex.md</span>, a powerful tool that transforms your digital content into Markdown format. It\'s perfect for building your personal knowledge base!'
      },
      {
        type: 'received',
        name: '<span class="codex-md-brand">codex.md</span>',
        avatar: '📖',
        text: `
          <p>Hi there! I can help you convert your content in several ways:</p>
          <ul class="feature-list">
            <li><strong>Drag and drop</strong> your files below or <strong>click</strong> to browse</li>
            <li><strong>Convert web content</strong> by adding a URL (single page or entire website)</li>
          </ul>
          <p>Let's get started with your conversion!</p>
        `
      }
    ],
    [MESSAGE_TYPES.UPDATE]: [
      {
        type: 'received',
        name: '<span class="codex-md-brand">codex.md</span>',
        avatar: '📖',
        text: `
          <p>We've updated codex.md with new features!</p>
          <ul class="feature-list">
            <li><strong>Enhanced PDF conversion</strong> with better image extraction</li>
            <li><strong>Improved web scraping</strong> for more accurate content extraction</li>
            <li><strong>Better performance</strong> for large file conversions</li>
          </ul>
          <p>Enjoy the improvements!</p>
        `
      }
    ],
    [MESSAGE_TYPES.ANNOUNCEMENT]: [
      {
        type: 'received',
        name: '<span class="codex-md-brand">codex.md</span>',
        avatar: '📖',
        text: `
          <p>Important announcement from the codex.md team:</p>
          <p>We're constantly working to improve your experience. If you have feedback or suggestions, please let us know!</p>
        `
      }
    ]
  };

  // Get the appropriate messages for the current message type
  $: allMessages = messageTemplates[messageType] || messageTemplates[MESSAGE_TYPES.WELCOME];

  function handleMinimize() {
    isOpen = false;
    
    // Mark the appropriate message type as seen
    if (messageType === MESSAGE_TYPES.WELCOME) {
      welcomeState.markAsSeen();
    } else {
      welcomeState.markMessageTypeSeen(messageType);
    }
    
    // Dispatch event to parent component
    dispatch('closed');
  }

  function goToHelp() {
    handleMinimize(); // Close modal first
    push('/help');
  }

  function goToSettings() {
    handleMinimize(); // Close modal first
    push('/settings');
  }

  function handleContinue() {
    handleMinimize();
    dispatch('continue');
  }

  // Animate messages appearing one by one
  async function animateMessages() {
    visibleMessages = [];
    
    // Add messages one by one with delay
    for (const message of allMessages) {
      await new Promise(resolve => setTimeout(resolve, 800));
      visibleMessages = [...visibleMessages, message];
    }
  }
</script>

<div class="welcome-chat">
  {#if isOpen && shouldShow}
    <div class="modal-overlay" transition:fade={{ duration: 300 }} on:click|self={handleMinimize}>
      <div class="chat-modal" transition:fly={{ y: 50, duration: 400, easing: elasticOut }}>
        <div class="modal-header">
          <h3>
            {#if messageType === MESSAGE_TYPES.WELCOME}
              Welcome to codex.md!
            {:else if messageType === MESSAGE_TYPES.UPDATE}
              codex.md Update
            {:else if messageType === MESSAGE_TYPES.ANNOUNCEMENT}
              Announcement
            {:else}
              codex.md
            {/if}
          </h3>
          <button class="close-button" on:click={handleMinimize}>×</button>
        </div>
        <div class="modal-content">
          <div class="chat-messages">
            {#each visibleMessages as message, index (index)}
              <div class="message-wrapper" in:fly={{ y: 30, duration: 500, delay: 100, easing: backOut }}>
                <ChatBubble
                  avatar={message.avatar}
                  name={message.name}
                  message={message.text}
                  delay={0}
                  avatarPosition={message.name.includes('codex.md') ? 'right' : 'left'}
                  showName={false}
                />
              </div>
            {/each}
          </div>
          
          <!-- Progress indicator -->
          <div class="progress-indicator">
            <div class="progress-track">
              <div 
                class="progress-fill" 
                style="width: {Math.min(100, (visibleMessages.length / allMessages.length) * 100)}%"
              ></div>
            </div>
          </div>
          
          <!-- Direct buttons at the bottom of the modal -->
          {#if visibleMessages.length === allMessages.length}
            <div class="action-buttons" in:fly={{ y: 20, duration: 400, delay: 300 }}>
              {#if messageType === MESSAGE_TYPES.WELCOME}
                <Button 
                  variant="secondary" 
                  size="medium"
                  on:click={goToHelp}
                >
                  Help Guide
                </Button>
                <Button 
                  variant="primary" 
                  size="medium"
                  on:click={handleContinue}
                >
                  I'm Ready
                </Button>
                
                {#if !apiKeyValue}
                  <div class="api-key-notice" in:fade={{ duration: 300, delay: 500 }}>
                    Don't forget to <button class="link-button" on:click={goToSettings}>set up your API key</button> for advanced features!
                  </div>
                {/if}
              {:else}
                <Button 
                  variant="primary" 
                  size="medium"
                  on:click={handleContinue}
                >
                  Continue
                </Button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .welcome-chat {
    position: fixed;
    inset: 0;
    z-index: 1000;
    pointer-events: none;
  }

  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    pointer-events: auto;
  }

  .chat-modal {
    width: 90%;
    max-width: 900px;
    max-height: 80vh;
    background: var(--color-surface);
    border-radius: var(--rounded-md);
    border: 1px solid var(--color-border);
    box-shadow: 
      0 10px 15px -3px rgba(0, 0, 0, 0.1),
      0 4px 6px -2px rgba(0, 0, 0, 0.05),
      0 20px 25px -5px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    padding: var(--spacing-sm) var(--spacing-md);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: linear-gradient(to right, var(--color-surface), var(--color-surface-light));
  }

  .modal-header h3 {
    margin: 0;
    font-size: var(--font-size-lg);
    background: linear-gradient(135deg, var(--color-prime), var(--color-fourth));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .close-button {
    background: none;
    border: none;
    font-size: 1.5em;
    line-height: 1;
    padding: 0;
    cursor: pointer;
    color: var(--color-text);
    opacity: 0.6;
    transition: opacity 0.2s ease;
  }

  .close-button:hover {
    opacity: 1;
  }

  .modal-content {
    padding: var(--spacing-md);
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .chat-messages {
    flex: 1;
    margin-bottom: var(--spacing-md);
    overflow: visible;
  }

  .message-wrapper {
    margin-bottom: var(--spacing-sm);
    overflow: visible;
  }

  .message-wrapper:last-child {
    margin-bottom: var(--spacing-md);
  }

  .action-buttons {
    margin-top: auto;
    display: flex;
    justify-content: center;
    gap: var(--spacing-md);
    flex-wrap: wrap;
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--color-border-light);
  }

  .action-buttons :global(button) {
    min-width: 140px;
    flex: 0 1 auto;
  }

  .progress-indicator {
    margin: var(--spacing-sm) 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .progress-track {
    width: 100%;
    height: 4px;
    background-color: var(--color-border-light);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--color-prime), var(--color-fourth));
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .api-key-notice {
    width: 100%;
    margin-top: var(--spacing-md);
    text-align: center;
    font-size: var(--font-size-sm);
    color: var(--color-text-light);
    background: rgba(var(--color-prime-rgb), 0.05);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--rounded-sm);
    border-left: 3px solid var(--color-prime);
  }

  .api-key-notice .link-button {
    color: var(--color-prime);
    text-decoration: none;
    font-weight: var(--font-weight-medium);
    border: none;
    background: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    border-bottom: 1px dotted var(--color-prime);
  }

  .api-key-notice .link-button:hover {
    color: var(--color-fourth);
    border-color: var(--color-fourth);
  }

  /* High Contrast Mode */
  @media (prefers-contrast: high) {
    .modal-overlay {
      background-color: rgba(0, 0, 0, 0.8);
      backdrop-filter: none;
    }

    .chat-modal {
      border-width: 2px;
    }

    .close-button {
      border: 1px solid currentColor;
      border-radius: var(--rounded-sm);
      opacity: 1;
    }

    .api-key-notice .link-button {
      text-decoration: underline;
      border-bottom: none;
    }
  }

  /* Reduced Motion */
  @media (prefers-reduced-motion: reduce) {
    .progress-fill {
      transition: none;
    }
  }
</style>
