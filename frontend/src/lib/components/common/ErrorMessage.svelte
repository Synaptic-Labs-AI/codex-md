<!-- src/lib/components/common/ErrorMessage.svelte -->
<script>
  import { fly } from 'svelte/transition';
  import { uploadStore } from '$lib/stores/uploadStore';
</script>

{#if $uploadStore.message}
  <div 
    class="message {$uploadStore.messageType}" 
    role="alert" 
    in:fly={{ y: 10, duration: 200 }}
  >
    <span class="icon">
      {#if $uploadStore.messageType === 'error'}
        ⚠️
      {:else if $uploadStore.messageType === 'success'}
        ✅
      {:else}
        ℹ️
      {/if}
    </span>
    <span class="text">{$uploadStore.message}</span>
  </div>
{/if}

<style>
  .message {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--rounded-md);
    font-size: var(--font-size-sm);
    position: relative;
    background: transparent;
  }

  .message::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--rounded-md);
    padding: 2px;
    -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }

  .error {
    color: var(--color-error);
  }

  .error::before {
    background: linear-gradient(135deg, var(--color-error), var(--color-error-light));
  }

  .success {
    color: var(--color-success);
  }

  .success::before {
    background: linear-gradient(135deg, var(--color-success), var(--color-success-light));
  }

  .info {
    color: var(--color-info);
  }

  .info::before {
    background: linear-gradient(135deg, var(--color-info), var(--color-info-light));
  }

  .icon {
    position: relative;
    z-index: 1;
  }

  .text {
    position: relative;
    z-index: 1;
  }

  /* High Contrast Mode */
  @media (prefers-contrast: high) {
    .message::before {
      padding: 3px;
    }
  }
</style>
