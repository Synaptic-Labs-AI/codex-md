<!--
  OfflineStatusBar.svelte
  Displays the current online status and provides offline functionality controls.
  
  This component shows the current network status, API connectivity,
  and provides controls for managing offline operations.
  
  Related files:
  - lib/stores/offlineStore.js: Offline state management
  - lib/services/api.js: API client with offline support
-->

<script>
  import { onMount, onDestroy } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import { offlineStore } from '../../lib/stores/offlineStore';
  import electronClient from '../../lib/api/electron/client';
  
  // Local state
  let expanded = false;
  let queuedOperations = [];
  let showQueuedOperations = false;
  let mounted = false;
  
  // Handle offline events
  function handleOfflineEvent(event) {
    // Log the event structure to help with debugging
    console.log('[OfflineStatusBar] Received offline event:', event);
    
    try {
      // Safely handle each event type with null checks
      if (!event || typeof event !== 'object') {
        console.error('[OfflineStatusBar] Invalid event received');
        return;
      }

      switch (event.type) {
        case 'status-change':
          if (typeof event.online === 'boolean') {
            offlineStore.setOnlineStatus(event.online);
          }
          break;
          
        case 'api-status':
          if (event.status) {
            offlineStore.setApiStatus(event.status);
          }
          break;
          
        case 'operation-complete':
        case 'operation-failed':
          // Refresh queued operations
          loadQueuedOperations();
          
          // Log operation details if available
          if (event.operation) {
            console.log(`[OfflineStatusBar] Operation ${event.type}:`, event.operation);
          }
          break;
          
        default:
          console.warn('[OfflineStatusBar] Unknown offline event type:', event.type);
      }
    } catch (error) {
      console.error('[OfflineStatusBar] Error handling offline event:', error);
    }
  }
  
  // Load queued operations
  async function loadQueuedOperations() {
    try {
      const operations = await electronClient.getQueuedOperations();
      queuedOperations = operations;
    } catch (error) {
      console.error('Failed to load queued operations:', error);
    }
  }
  
  // Clear cache
  async function clearCache() {
    try {
      await electronClient.clearCache();
      alert('Cache cleared successfully');
    } catch (error) {
      console.error('Failed to clear cache:', error);
      alert(`Failed to clear cache: ${error.message}`);
    }
  }
  
  // Toggle expanded state
  function toggleExpanded() {
    expanded = !expanded;
    if (expanded) {
      loadQueuedOperations();
    }
  }
  
  // Toggle queued operations visibility
  function toggleQueuedOperations() {
    showQueuedOperations = !showQueuedOperations;
    if (showQueuedOperations) {
      loadQueuedOperations();
    }
  }
  
  // Format timestamp
  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString();
  }
  
  // Setup on mount
  onMount(async () => {
    mounted = true;
    
    // Get initial status
    try {
      // Wait for store to be initialized
      if (!$offlineStore.isInitialized) {
        // Initialization is handled by the store itself
        // Just wait for it to be ready
        return;
      }
      
      // Listen for offline events
      const cleanup = electronClient.onOfflineEvent((event) => handleOfflineEvent(event));
      
      // Return cleanup function for onDestroy
      return () => {
        mounted = false;
        if (typeof cleanup === 'function') {
          cleanup();
        }
      };
    } catch (error) {
      console.error('Failed to setup offline status bar:', error);
    }
  });
</script>

{#if mounted}
  {#if $offlineStore.isInitialized}
    {#if $offlineStore.error}
      <div class="offline-status-bar error" transition:fade>
        <div class="status-text">Error: {$offlineStore.error}</div>
      </div>
    {:else}
      <div class="offline-status-bar" class:expanded>
        <button 
          class="status-indicator" 
          on:click={toggleExpanded}
          on:keydown={(e) => e.key === 'Enter' && toggleExpanded()}
          aria-expanded={expanded}
          aria-controls="offline-expanded-content"
          role="button"
          tabindex="0"
        >
          <div class="status-icon" class:online={$offlineStore.online}>
            {#if $offlineStore.online}
              <span class="icon">🟢</span>
            {:else}
              <span class="icon">🔴</span>
            {/if}
          </div>
          <div class="status-text">
            {$offlineStore.online ? 'Online' : 'Offline'}
          </div>
          <div class="expand-icon">
            {expanded ? '▲' : '▼'}
          </div>
        </button>
        
        {#if expanded}
          <div id="offline-expanded-content" class="expanded-content" transition:slide={{ duration: 300 }}>
            <div class="api-status">
              <h4>API Status</h4>
              <ul>
                {#each Object.entries($offlineStore.apiStatus) as [api, status]}
                  <li>
                    <span class="api-name">{api}:</span>
                    <span class="api-status-indicator" class:online={status}>
                      {status ? '🟢 Connected' : '🔴 Disconnected'}
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
            
            <div class="offline-controls">
              <button on:click={toggleQueuedOperations} class="control-button">
                {showQueuedOperations ? 'Hide' : 'Show'} Queued Operations ({queuedOperations.length})
              </button>
              <button on:click={clearCache} class="control-button">
                Clear Cache
              </button>
            </div>
            
            {#if showQueuedOperations}
              <div class="queued-operations" transition:fade={{ duration: 200 }}>
                <h4>Queued Operations</h4>
                {#if queuedOperations.length === 0}
                  <p class="empty-message">No operations in queue</p>
                {:else}
                  <ul>
                    {#each queuedOperations as operation}
                      <li>
                        <div class="operation-type">{operation.type}</div>
                        <div class="operation-time">{formatTime(operation.timestamp)}</div>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <div class="offline-status-bar loading" transition:fade>
      <div class="status-text">Checking connection status...</div>
    </div>
  {/if}
{/if}

<style>
  .offline-status-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05);
    z-index: 1000;
    font-family: var(--font-family);
    transition: all 0.3s ease;
  }
  
  .status-indicator {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 10px 20px;
    cursor: pointer;
    user-select: none;
    background: none;
    border: none;
    text-align: left;
    transition: background-color 0.2s ease;
  }
  
  .status-indicator:hover {
    background-color: var(--color-background);
  }
  
  .status-indicator:focus {
    outline: 2px solid var(--color-prime);
    outline-offset: -2px;
  }
  
  .status-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    margin-right: 10px;
    background-color: var(--color-error);
    transition: all 0.3s ease;
  }
  
  .status-icon.online {
    background-color: var(--color-success, #4caf50);
  }
  
  .icon {
    font-size: 12px;
  }
  
  .status-text {
    flex-grow: 1;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text);
  }
  
  .expand-icon {
    font-size: 12px;
    color: var(--color-text-light);
    transition: transform 0.3s ease;
  }
  
  .expanded .expand-icon {
    transform: rotate(180deg);
  }
  
  .expanded-content {
    padding: 16px 20px;
    border-top: 1px solid var(--color-border);
    background-color: var(--color-surface);
  }
  
  .api-status h4, .queued-operations h4 {
    margin-top: 0;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 600;
    color: #333;
  }
  
  .api-status ul, .queued-operations ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  
  .api-status li, .queued-operations li {
    display: flex;
    padding: 4px 0;
    font-size: 13px;
  }
  
  .api-name {
    width: 100px;
    font-weight: 500;
  }
  
  .api-status-indicator {
    color: #ff3e3e;
  }
  
  .api-status-indicator.online {
    color: #4caf50;
  }
  
  .offline-controls {
    display: flex;
    gap: 12px;
    margin: 16px 0;
  }
  
  .control-button {
    padding: 8px 16px;
    background-color: var(--color-background);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--rounded-md);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  
  .control-button:hover {
    background-color: var(--color-background-hover);
    border-color: var(--color-prime);
  }
  
  .control-button:focus {
    outline: 2px solid var(--color-prime);
    outline-offset: 2px;
  }
  
  .queued-operations {
    margin-top: 16px;
  }
  
  .empty-message {
    font-size: 13px;
    color: #666;
    font-style: italic;
  }
  
  .operation-type {
    flex-grow: 1;
    font-weight: 500;
  }
  
  .operation-time {
    color: #666;
    font-size: 12px;
  }
</style>
