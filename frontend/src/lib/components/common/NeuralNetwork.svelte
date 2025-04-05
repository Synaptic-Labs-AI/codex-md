<!--
  NeuralNetwork.svelte

  3D visualization component that displays a growing neural network.
  Every 3 seconds, a new neuron is added, branching from an existing random neuron.
  Each neuron has a random color from the theme palette and features particle effects.

  Props:
  - secondsCount: Number of seconds elapsed, used to time neuron addition
  - keepAlive: Whether to persist network state when component unmounts

  Related files:
  - frontend/src/lib/three/SceneManager.js: Core 3D scene management
  - frontend/src/lib/three/EntityManager.js: Neuron and connection management
  - frontend/src/lib/three/PhysicsManager.js: Force-directed layout physics
  - frontend/src/lib/three/ParticleSystem.js: Particle effects
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { SceneManager } from '../../three/SceneManager';
  import { conversionTimer } from '../../stores/conversionTimer';

  export let secondsCount = 0;
  export let keepAlive = false;
  export let autoRotate = true;
  export let initialNeurons = 1;

  // State management
  let isActive = false;
  let container;
  let sceneManager;
  let lastUpdateTime = 0;
  let animationTimer;

  // Activate the neural network
  async function activate() {
    if (!sceneManager || !sceneManager.initialized || isActive) {
      console.log('NeuralNetwork: Cannot activate', {
        hasSceneManager: !!sceneManager,
        isInitialized: sceneManager?.initialized,
        isActive
      });
      return;
    }
    
    console.log('NeuralNetwork: Activating visualization');
    isActive = true;
    
    try {
      // Force a resize before creating the initial layout
      const rect = container.getBoundingClientRect();
      console.log('NeuralNetwork: Container rect before activation', rect);
      sceneManager.resize(rect.width, rect.height);
      
      // Create initial layout only when activated
      await sceneManager.createInitialLayout();
      
      // Trigger initial pulse
      setTimeout(() => {
        if (sceneManager && sceneManager.initialized) {
          console.log('NeuralNetwork: Triggering initial pulse');
          sceneManager.triggerPulse();
          
          // Force another resize after the pulse to ensure everything is visible
          const newRect = container.getBoundingClientRect();
          sceneManager.resize(newRect.width, newRect.height);
          
          // Add diagnostic logging for canvas element after activation
          const canvas = container.querySelector('canvas');
          if (canvas) {
            console.log('NeuralNetwork: Canvas element details after activation', {
              width: canvas.width,
              height: canvas.height,
              clientWidth: canvas.clientWidth,
              clientHeight: canvas.clientHeight,
              style: {
                width: window.getComputedStyle(canvas).width,
                height: window.getComputedStyle(canvas).height,
                position: window.getComputedStyle(canvas).position,
                visibility: window.getComputedStyle(canvas).visibility,
                display: window.getComputedStyle(canvas).display,
                opacity: window.getComputedStyle(canvas).opacity,
                zIndex: window.getComputedStyle(canvas).zIndex
              }
            });
          }
        }
      }, 800); // Increased delay to let layout settle
    } catch (error) {
      console.error('NeuralNetwork: Activation error:', error);
    }
  }
  
  // Deactivate the neural network
  function deactivate() {
    if (!sceneManager || !sceneManager.initialized || !isActive) return;
    
    console.log('NeuralNetwork: Deactivating visualization');
    isActive = false;
    
    // Disable physics when deactivated
    try {
      if (sceneManager.physicsManager && 
          typeof sceneManager.physicsManager.setEnabled === 'function') {
        sceneManager.physicsManager.setEnabled(false);
      }
    } catch (error) {
      console.error('NeuralNetwork: Error disabling physics:', error);
    }
  }

  // Initialize scene but stay dormant
  onMount(async () => {
    if (!container) return;

    console.log('NeuralNetwork: Initializing scene (dormant)');
    
    // Add diagnostic logging for container
    console.log('NeuralNetwork: Container details', {
      width: container.clientWidth,
      height: container.clientHeight,
      offsetWidth: container.offsetWidth,
      offsetHeight: container.offsetHeight,
      style: {
        display: window.getComputedStyle(container).display,
        position: window.getComputedStyle(container).position,
        visibility: window.getComputedStyle(container).visibility,
        opacity: window.getComputedStyle(container).opacity,
        zIndex: window.getComputedStyle(container).zIndex
      }
    });
try {
  sceneManager = new SceneManager(container);
  await sceneManager.initializeDormant();
  
  // Start with empty scene, waiting for activation
  console.log('NeuralNetwork: Scene ready in dormant state');
  
  // Explicitly start the animation loop
  if (sceneManager.startAnimationLoop) {
    console.log('NeuralNetwork: Explicitly starting animation loop');
    sceneManager.startAnimationLoop();
  }
  
  // Debug: Check if canvas was created and properly attached
  if (sceneManager.renderer && sceneManager.renderer.domElement) {
    console.log('NeuralNetwork: Canvas created:', {
      exists: !!sceneManager.renderer.domElement,
      width: sceneManager.renderer.domElement.width,
      height: sceneManager.renderer.domElement.height,
      parent: sceneManager.renderer.domElement.parentElement === container,
      containerSize: { width: container.clientWidth, height: container.clientHeight }
    });
    
    // Force canvas to be visible
    sceneManager.renderer.domElement.style.border = '5px solid red';
    sceneManager.renderer.domElement.style.zIndex = '999';
  }
      
      // Add diagnostic logging for canvas element
      const canvas = container.querySelector('canvas');
      if (canvas) {
        console.log('NeuralNetwork: Canvas element details', {
          width: canvas.width,
          height: canvas.height,
          clientWidth: canvas.clientWidth,
          clientHeight: canvas.clientHeight,
          style: {
            width: window.getComputedStyle(canvas).width,
            height: window.getComputedStyle(canvas).height,
            position: window.getComputedStyle(canvas).position,
            visibility: window.getComputedStyle(canvas).visibility,
            display: window.getComputedStyle(canvas).display,
            opacity: window.getComputedStyle(canvas).opacity,
            zIndex: window.getComputedStyle(canvas).zIndex,
            transform: window.getComputedStyle(canvas).transform
          },
          offsetParent: canvas.offsetParent ? true : false
        });
      } else {
        console.error('NeuralNetwork: Canvas element not found in container');
      }
      
      // Force a repaint after a short delay to help with Electron rendering issues
      setTimeout(() => {
        if (container) {
          console.log('NeuralNetwork: Forcing repaint to fix potential rendering issues');
          
          // Force a repaint by temporarily hiding and showing the container
          container.style.display = 'none';
          // Trigger reflow
          void container.offsetHeight;
          container.style.display = 'flex';
          
          // Force a resize
          const rect = container.getBoundingClientRect();
          if (sceneManager && typeof sceneManager.resize === 'function') {
            sceneManager.resize(rect.width, rect.height);
          }
          
          // Add a debug border to make the container more visible
          container.style.border = '3px solid blue';
          
          // Check if canvas exists and log its dimensions after forced repaint
          const canvas = container.querySelector('canvas');
          if (canvas) {
            console.log('NeuralNetwork: Canvas element after forced repaint', {
              width: canvas.width,
              height: canvas.height,
              clientWidth: canvas.clientWidth,
              clientHeight: canvas.clientHeight,
              style: {
                width: window.getComputedStyle(canvas).width,
                height: window.getComputedStyle(canvas).height
              }
            });
            
            // Add a debug border to make the canvas more visible
            canvas.style.border = '3px solid yellow';
          } else {
            console.error('NeuralNetwork: Canvas element not found after forced repaint');
          }
        }
      }, 1000);
        
    } catch (error) {
      console.error('NeuralNetwork: Initialization error:', error);
    }

    // Configure animation timer
    animationTimer = setInterval(() => {
      if (sceneManager?.initialized && isActive) {
        try {
          sceneManager.addNeuron(undefined);
          sceneManager.triggerPulse();
        } catch (error) {
          console.error('NeuralNetwork: Animation update error:', error);
        }
      }
    }, 5000);
    
    // Configure camera controls after initialization
    if (sceneManager.initialized) {
      console.log('NeuralNetwork: Configuring camera controls');
      sceneManager.getControls().autoRotate = autoRotate;
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
    // Clear the animation timer
    if (animationTimer) {
      clearInterval(animationTimer);
    }

    // Deactivate if not keeping alive
    if (!keepAlive) {
      deactivate();
    }
    
    // Clean up scene manager if not keeping alive
    if (!keepAlive && sceneManager) {
      console.log('NeuralNetwork: Cleaning up scene');
      sceneManager.destroy();
    }
  });

  // Watch for autoRotate changes
  $: if (sceneManager && sceneManager.initialized && autoRotate !== undefined) {
    try {
      sceneManager.getControls().autoRotate = autoRotate;
    } catch (error) {
      console.error('NeuralNetwork: Error updating camera controls:', error);
    }
  }

  // Watch conversionTimer store to activate/deactivate network
  $: if ($conversionTimer.isRunning && !isActive && sceneManager?.initialized) {
    activate();
  } else if (!$conversionTimer.isRunning && isActive && !keepAlive) {
    deactivate();
  }

  // Watch secondsCount for adding new neurons only when active
  $: {
    if (isActive && sceneManager?.initialized && secondsCount !== lastUpdateTime) {
      lastUpdateTime = secondsCount;
      if (secondsCount % 3 === 0) {
        try {
          const neuron = sceneManager.addNeuron(undefined);
          if (neuron) {
            sceneManager.triggerPulse();
          }
        } catch (error) {
          console.error('NeuralNetwork: Error during timed update:', error);
        }
      }
    }
  }

  // Debug log for prop changes
  $: if (autoRotate !== undefined) {
    console.log('NeuralNetwork: AutoRotate changed', autoRotate);
  }

  // Method to update the network from parent components
  export function updateNetwork(seconds) {
    secondsCount = seconds; // This will trigger the reactive statement
  }
</script>

<div 
  bind:this={container} 
  class="neural-network-container"
  role="img" 
  aria-label="3D Neural network visualization" 
>
</div>

<style>
  .neural-network-container {
    width: 100%;
    height: 500px;  /* Taller container */
    position: relative;
    overflow: visible;
    /* 3D perspective for depth effect */
    perspective: 1200px;  /* Increased perspective */
    transform-style: preserve-3d;
    transform-origin: center center;
    /* Center container and contents */
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 2rem auto;  /* Added vertical margin */
    /* Ensure canvas renders properly */
    -webkit-transform-style: preserve-3d;
    -moz-transform-style: preserve-3d;
    /* Add depth through shadows */
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
    border-radius: 8px;
    /* Debug border to visualize container */
    border: 2px solid rgba(255, 0, 0, 0.3);
    /* Force hardware acceleration */
    transform: translateZ(0);
    -webkit-transform: translateZ(0);
    /* Ensure visibility */
    z-index: 1;
  }
  .neural-network-container :global(canvas) {
    position: absolute;
    top: 0;
    left: 0;
    width: 100% !important;
    height: 100% !important;
    /* Debug border to visualize canvas */
    border: 2px solid rgba(0, 255, 0, 0.3);
    /* Force hardware acceleration */
    transform: translateZ(0);
    -webkit-transform: translateZ(0);
    /* Ensure visibility - use very high z-index */
    z-index: 999 !important;
    /* Force visibility */
    visibility: visible !important;
    opacity: 1 !important;
    display: block !important;
  }

  /* Mobile responsiveness */
  @media (max-width: 640px) {
    .neural-network-container {
      height: 400px;
      margin: 1rem auto;
    }
  }
</style>
