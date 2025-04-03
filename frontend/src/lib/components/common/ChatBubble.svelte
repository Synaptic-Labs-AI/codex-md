<script>
  import { fade, fly, slide } from 'svelte/transition';
  import { onMount } from 'svelte';
  
  export let avatar = '';
  export let name = '';
  export let message = '';
  export let delay = 0;
  export let avatarPosition = 'left';
  export let showName = true;

  export let isTyping = false;
  export let showMessage = true;
</script>

<div 
  class="chat-bubble-container"
  class:container-right={avatarPosition === 'right'}
  in:fade|local={{delay, duration: 300}}
>
  <div 
    class="chat-bubble"
    class:bubble-left={avatarPosition === 'left'}
    class:bubble-right={avatarPosition === 'right'}
    in:fly|local={{delay, duration: 400, y: 20}}
  >
    <div class="message-content">
      {#if showName}
        <div class="name" in:slide|local={{delay: delay + 100, duration: 200}}>
          {name}
        </div>
      {/if}
      
      {#if isTyping}
        <div class="typing-indicator" in:fade|local={{duration: 200}}>
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      {/if}

      {#if showMessage}
        <div 
          class="message"
          in:slide|local={{delay: 100, duration: 200, axis: 'y'}}
        >
          {@html message}
        </div>
      {/if}
    </div>
  </div>
  
  <!-- Avatar -->
  <div 
    class="avatar-bubble"
    class:avatar-left={avatarPosition === 'left'}
    class:avatar-right={avatarPosition === 'right'}
    in:fly|local={{
      delay,
      duration: 400,
      x: avatarPosition === 'left' ? -20 : 20
    }}
  >
    <span class="avatar">{avatar}</span>
    <div class="avatar-glow"></div>
  </div>
</div>

<style>
  .chat-bubble-container {
    position: relative;
    margin-bottom: 40px;
    padding: 0;
    width: 100%;
    display: flex;
    justify-content: center;
    box-sizing: border-box;
  }

  .chat-bubble {
    position: relative;
    background-color: var(--color-surface);
    border-radius: var(--rounded-lg);
    padding: var(--spacing-md) var(--spacing-lg);
    box-shadow: 
      0 4px 6px rgba(0, 0, 0, 0.05),
      0 6px 12px rgba(0, 0, 0, 0.05);
    width: calc(100% - 80px);
    box-sizing: border-box;
    z-index: 1;
  }
  
  .bubble-left {
    margin-left: 40px;
    margin-right: 20px;
    padding-left: var(--spacing-lg);
  }
  
  .bubble-right {
    margin-right: 40px;
    margin-left: 20px;
    padding-right: var(--spacing-lg);
  }


  .chat-bubble::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(135deg,
      var(--color-prime) 0%,
      var(--color-fourth) 50%,
      var(--color-prime) 100%
    );
    background-size: 400% 400%;
    animation: gradientFlow 8s ease infinite;
    -webkit-mask: 
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: 0.5;
  }

  @keyframes gradientFlow {
    0% {
      background-position: 0% 0%;
    }
    50% {
      background-position: 100% 100%;
    }
    100% {
      background-position: 0% 0%;
    }
  }

  .avatar-bubble {
    position: absolute;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    background: linear-gradient(135deg,
      var(--color-prime) 0%,
      var(--color-fourth) 50%,
      var(--color-prime) 100%
    );
    background-size: 400% 400%;
    animation: gradientFlow 8s ease infinite;
    box-shadow: 
      0 4px 8px rgba(0, 0, 0, 0.15),
      0 8px 16px rgba(0, 0, 0, 0.1),
      inset 0 2px 3px rgba(255, 255, 255, 0.3);
    z-index: 10;
    border: 2px solid var(--color-surface);
    transform-origin: center;
    transition: transform 0.3s ease;
  }

  .avatar-left {
    top: 0;
    left: 0;
  }

  .avatar-right {
    top: 0;
    right: 0;
  }

  .avatar-bubble:hover {
    transform: scale(1.1);
  }

  .avatar-glow {
    position: absolute;
    inset: -4px;
    border-radius: inherit;
    background: inherit;
    filter: blur(8px);
    opacity: 0;
    z-index: -1;
    transition: opacity 0.3s ease;
  }

  .avatar-bubble:hover .avatar-glow {
    opacity: 0.4;
  }

  .typing-indicator {
    display: flex;
    gap: 4px;
    padding: var(--spacing-xs) var(--spacing-sm);
    align-items: center;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--color-text-light);
    opacity: 0.6;
  }

  .dot:nth-child(1) { animation: bounce 1s infinite 0.1s; }
  .dot:nth-child(2) { animation: bounce 1s infinite 0.2s; }
  .dot:nth-child(3) { animation: bounce 1s infinite 0.3s; }

  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }

  .avatar {
    font-size: 38px;
    line-height: 1;
  }

  .name {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    margin-bottom: 4px;
    background: linear-gradient(90deg,
      var(--color-prime) 0%,
      var(--color-fourth) 100%
    );
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    opacity: 0.9;
  }

  .message-content {
    width: 100%;
    overflow-wrap: break-word;
    word-wrap: break-word;
    word-break: break-word;
  }

  .message {
    color: var(--color-text);
    font-size: var(--font-size-base);
    line-height: 1.5;
    max-width: 100%;
  }

  .message :global(.codex-md-brand) {
    font-weight: 700;
    background: linear-gradient(135deg, 
      #00A99D 0%,
      #00A99D 40%,
      #F7931E 100%
    );
    background-size: 400% 400%;
    animation: gradientFlow 8s ease infinite;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    display: inline-block;
    position: relative;
    z-index: 1;
  }

  .message :global(strong) {
    color: var(--color-prime);
    font-weight: var(--font-weight-bold);
  }

  .message :global(.feature-list) {
    margin: var(--spacing-xs) 0;
    padding-left: var(--spacing-lg);
    list-style-position: outside;
  }

  .message :global(.feature-list li) {
    margin-bottom: var(--spacing-xs);
  }

  .message :global(.help-link) {
    color: var(--color-prime);
    text-decoration: none;
    font-weight: var(--font-weight-medium);
    border-bottom: 1px solid var(--color-prime);
    transition: all 0.2s ease;
    padding: 0 2px;
  }

  .message :global(.help-link:hover) {
    color: var(--color-fourth);
    border-color: var(--color-fourth);
    background: rgba(var(--color-fourth-rgb), 0.05);
    border-radius: 3px;
  }

  @media (max-width: 640px) {
    .chat-bubble-container {
      margin-bottom: 30px;
    }

    .chat-bubble {
      width: calc(100% - 50px);
      padding: var(--spacing-sm) var(--spacing-md);
    }
    
    .bubble-left {
      margin-left: 25px;
      margin-right: 10px;
    }
    
    .bubble-right {
      margin-right: 25px;
      margin-left: 10px;
    }

    .avatar-bubble {
      width: 40px;
      height: 40px;
    }

    .avatar {
      font-size: 20px;
    }

    .dot {
      width: 4px;
      height: 4px;
    }
  }
</style>
