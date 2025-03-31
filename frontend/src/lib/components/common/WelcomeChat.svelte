<script>
  import { fade, fly } from 'svelte/transition';
  import { elasticOut, backOut } from 'svelte/easing';
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import ChatBubble from './ChatBubble.svelte';
  import Button from './Button.svelte';
  import welcomeState from '$lib/stores/welcomeState';
  import { apiKey } from '$lib/stores/apiKey';
  
  let hasSeenWelcome = false;
  
  // Subscribe to welcome state
  const unsubWelcome = welcomeState.subscribe(value => {
    hasSeenWelcome = value;
  });

  // Define welcome messages directly in this component
  const allMessages = [
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
  ];

  let isOpen = false;
  let visibleMessages = [];
  let apiKeyValue;

  // Subscribe to API key store
  const unsubApiKey = apiKey.subscribe(value => {
    apiKeyValue = value;
  });
  
  // Clean up subscriptions
  onDestroy(() => {
    unsubApiKey();
    unsubWelcome();
  });
  
  // Auto-open chat for first-time visitors
  onMount(() => {
    if (!hasSeenWelcome) {
      isOpen = true;
      animateMessages();
    }
  });

  function toggleChat() {
    // If user has already seen welcome, don't allow reopening
    if (hasSeenWelcome) {
      return;
    }
    
    isOpen = !isOpen;
    if (isOpen) {
      animateMessages();
    } else {
      visibleMessages = [];
    }
  }

  function handleMinimize() {
    isOpen = false;
    welcomeState.markAsSeen();
  }

  function goToHelp() {
    handleMinimize(); // Close modal first
    goto('/help');
  }

  function goToSettings() {
    handleMinimize(); // Close modal first
    goto('/settings');
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
  <!-- Wave Button -->
  <button 
    class="wave-button" 
    class:hidden={isOpen || hasSeenWelcome}
    on:click={toggleChat}
    title="Welcome Chat"
  >
    <span class="wave">👋</span>
  </button>

  <!-- Modal Overlay -->
  {#if isOpen && !hasSeenWelcome}
    <div class="modal-overlay" transition:fade={{ duration: 300 }} on:click|self={handleMinimize}>
      <div class="chat-modal" transition:fly={{ y: 50, duration: 400, easing: elasticOut }}>
        <div class="modal-header">
          <h3>Welcome to codex.md!</h3>
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
                on:click={handleMinimize}
              >
                I'm Ready
              </Button>
              
              {#if !apiKeyValue}
                <div class="api-key-notice" in:fade={{ duration: 300, delay: 500 }}>
                  Don't forget to <button class="link-button" on:click={goToSettings}>set up your API key</button> for advanced features!
                </div>
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
    bottom: 70px;
    right: 60px;
    z-index: 1000;
  }

  .wave-button {
    width: 75px;
    height: 75px;
    border-radius: 50%;
    background: var(--color-surface);
    border: 2px solid var(--color-border);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5em;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    transition: transform 0.2s ease;
  }

  .wave-button:hover {
    transform: scale(1.05);
  }

  .wave-button.hidden {
    display: none;
  }

  .wave {
    animation: wave 10s ease-in-out infinite;
    transform-origin: 70% 70%;
  }

  @keyframes wave {
    0% { transform: rotate(0deg); }
    15% { transform: rotate(14deg); }
    30% { transform: rotate(-8deg); }
    45% { transform: rotate(14deg); }
    60% { transform: rotate(-4deg); }
    75% { transform: rotate(10deg); }
    100% { transform: rotate(0deg); }
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
</style>
