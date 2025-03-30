<script>
  import { fade, fly } from 'svelte/transition';
  
  export let avatar = '';
  export let name = '';
  export let message = '';
  export let delay = 0;
  export let avatarPosition = 'left'; // New prop with default 'left'
  export let showName = true; // New prop to control name visibility
</script>

<div 
  class="chat-bubble-container"
  class:container-right={avatarPosition === 'right'}
  in:fade|local={{delay: delay, duration: 300}}
>
  <div 
    class="chat-bubble"
    class:bubble-left={avatarPosition === 'left'}
    class:bubble-right={avatarPosition === 'right'}
    in:fly|local={{delay: delay, duration: 400, y: 20}}
  >
    <div class="message-content">
      {#if showName}
        <div class="name">{name}</div>
      {/if}
      <div class="message">
        {@html message}
      </div>
    </div>
  </div>
  
  <!-- Left avatar -->
  {#if avatarPosition === 'left'}
    <div class="avatar-bubble avatar-left">
      <span class="avatar">{avatar}</span>
    </div>
  {/if}
  
  <!-- Right avatar -->
  {#if avatarPosition === 'right'}
    <div class="avatar-bubble avatar-right">
      <span class="avatar">{avatar}</span>
    </div>
  {/if}
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
    border: 2px solid white;
  }

  .avatar-left {
    top: 0;
    left: 0;
  }

  .avatar-right {
    top: 0;
    right: 0;
  }

  .book-icon {
    position: absolute;
    top: -10px;
    right: -5px;
    font-size: 20px;
    opacity: 0.8;
    transform: rotate(15deg);
    filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.1));
    z-index: 3;
  }

  .avatar-bubble::before {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: inherit;
    background: inherit;
    filter: blur(8px);
    opacity: 0.4;
    z-index: -1;
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
  }
</style>
