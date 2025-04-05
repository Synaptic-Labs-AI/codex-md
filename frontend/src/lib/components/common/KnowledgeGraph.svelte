<!--
  KnowledgeGraph.svelte

  3D visualization component that displays a growing knowledge graph.
  Every 3 seconds, a new node is added with random connections to existing nodes.
  Each node has a random color from the theme palette.

  Props:
  - secondsCount: Number of seconds elapsed, used to time node addition
  - keepAlive: Whether to persist graph state when component unmounts
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { SceneManager } from '../../three/SceneManager';
  import { conversionTimer } from '../../stores/conversionTimer';

  export let secondsCount = 0;
  export let keepAlive = false;
  export let initialNodes = 1;

  // State management
  let isActive = false;
  let container;
  let sceneManager;
  let lastUpdateTime = 0;
  let updateTimer;

  async function activate() {
    if (!sceneManager || !sceneManager.initialized || isActive) {
      return;
    }
    
    isActive = true;
    
    try {
      // Force a resize to ensure proper sizing
      const rect = container.getBoundingClientRect();
      sceneManager.resize(rect.width, rect.height);
      
      // Add initial node
      sceneManager.addNode();
      
    } catch (error) {
      console.error('KnowledgeGraph: Activation error:', error);
    }
  }
  
  function deactivate() {
    if (!sceneManager || !sceneManager.initialized || !isActive) return;
    isActive = false;
  }

  onMount(async () => {
    if (!container) return;

    try {
      sceneManager = new SceneManager(container);
      await sceneManager.initializeDormant();
      
      // Start animation loop
      sceneManager.startAnimationLoop();
      
      // Update timer for adding new nodes
      updateTimer = setInterval(() => {
        if (sceneManager?.initialized && isActive) {
          try {
            sceneManager.addNode(undefined);
          } catch (error) {
            console.error('KnowledgeGraph: Update error:', error);
          }
        }
      }, 3000);

    } catch (error) {
      console.error('KnowledgeGraph: Initialization error:', error);
    }

    // Handle resizing
    const updateSize = () => {
      if (!container || !sceneManager) return;
      const rect = container.getBoundingClientRect();
      sceneManager.resize(rect.width, rect.height);
    };
    
    updateSize();
    window.addEventListener('resize', updateSize);

    return () => {
      window.removeEventListener('resize', updateSize);
      if (!keepAlive && sceneManager) {
        sceneManager.destroy();
      }
    };
  });

  onDestroy(() => {
    if (updateTimer) {
      clearInterval(updateTimer);
    }

    if (!keepAlive) {
      deactivate();
      if (sceneManager) {
        sceneManager.destroy();
      }
    }
  });

  // Watch conversionTimer store to activate/deactivate graph
  $: if ($conversionTimer.isRunning && !isActive && sceneManager?.initialized) {
    activate();
  } else if (!$conversionTimer.isRunning && isActive && !keepAlive) {
    deactivate();
  }

  // Watch secondsCount for adding new nodes only when active
  $: {
    if (isActive && sceneManager?.initialized && secondsCount !== lastUpdateTime) {
      lastUpdateTime = secondsCount;
      if (secondsCount % 3 === 0) {
        try {
          sceneManager.addNode(undefined);
        } catch (error) {
          console.error('KnowledgeGraph: Error during timed update:', error);
        }
      }
    }
  }

  // Method to update the graph from parent components
  export function updateGraph(seconds) {
    secondsCount = seconds;
  }
</script>

<div 
  bind:this={container} 
  class="knowledge-graph-container"
  role="img" 
  aria-label="3D Knowledge graph visualization" 
>
</div>

<style>
  .knowledge-graph-container {
    width: 100%;
    height: 500px;
    position: relative;
    overflow: visible;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 2rem auto;
    perspective: 1200px;
    transform-style: preserve-3d;
    transform-origin: center center;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
    border-radius: 8px;
    transform: translateZ(0);
    -webkit-transform: translateZ(0);
    z-index: 1;
  }

  .knowledge-graph-container :global(canvas) {
    position: absolute;
    top: 0;
    left: 0;
    width: 100% !important;
    height: 100% !important;
    transform: translateZ(0);
    -webkit-transform: translateZ(0);
    z-index: 999 !important;
    visibility: visible !important;
    opacity: 1 !important;
    display: block !important;
  }

  @media (max-width: 640px) {
    .knowledge-graph-container {
      height: 400px;
      margin: 1rem auto;
    }
  }
</style>
