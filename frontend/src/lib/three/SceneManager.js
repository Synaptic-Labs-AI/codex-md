/**
 * SceneManager.js
 * 
 * Manages the Three.js scene setup, rendering, and coordinates between
 * entity management, physics, and particle systems. This is the main
 * orchestrator of the 3D visualization.
 */

import * as THREE from 'three';
import { EntityManager } from './EntityManager';
import { PhysicsManager } from './PhysicsManager';
import { ParticleSystem } from './ParticleSystem';
import { ParticleEffects } from './ParticleEffects';
import { OrbitControls } from './controls/OrbitControls';

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.frameId = null;
    this.isDestroyed = false;
    this.initialized = false;
  }

  /**
   * Asynchronously initialize the scene and all managers
   */
  async initializeDormant() {
    if (this.initialized) return;
    console.log('SceneManager: Starting dormant initialization');
    
    try {
      // Scene setup only
      await this.setupScene();
      console.log('SceneManager: Scene setup complete');
      
      // Initialize managers but don't create any content yet
      this.particleSystem = new ParticleSystem(this.scene);
      this.particleEffects = new ParticleEffects(this.particleSystem);
      this.entityManager = new EntityManager(this.scene, this.particleSystem);
      this.physicsManager = new PhysicsManager(this.entityManager);
      
      // Disable physics for dormant state
      if (typeof this.physicsManager.setEnabled === 'function') {
        this.physicsManager.setEnabled(false);
      } else {
        console.warn('SceneManager: PhysicsManager.setEnabled is not available');
      }
      
      console.log('SceneManager: Components initialized in dormant state');
      
      // Start animation loop
      this.animate = this.animate.bind(this);
      this.animate();

      // Setup resize handler
      this.resizeHandler = () => {
        const rect = this.container.getBoundingClientRect();
        this.resize(rect.width, rect.height);
      };
      window.addEventListener('resize', this.resizeHandler);

      this.initialized = true;
      console.log('SceneManager: Initialization complete');
    } catch (error) {
      console.error('SceneManager: Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Set up the basic scene elements
   */
  async setupScene() {
    
    this.scene = new THREE.Scene();
    this.scene.background = null; // Transparent background
    
    // Camera setup with dynamic aspect ratio
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this.camera.position.set(0, 15, 30); // Closer and lower viewing position
    this.camera.lookAt(0, 0, 0);
    console.log('SceneManager: Camera positioned at:', this.camera.position);

    // Center the scene origin
    this.scene.position.set(0, 0, 0);
    
    // Check WebGL support before creating renderer
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!gl) {
        console.error('SceneManager: WebGL not supported');
        throw new Error('WebGL not supported');
      }
      
      // Get WebGL capabilities and limits
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';
      const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown';
      
      console.log('SceneManager: WebGL supported', {
        renderer,
        vendor,
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE)
      });
    } catch (e) {
      console.error('SceneManager: Error checking WebGL support:', e);
      // Continue anyway to see what happens with THREE.js renderer
    }
    
    // Renderer setup with antialiasing and transparency
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance', // Request high performance GPU
      stencil: false, // Disable stencil buffer if not needed
      depth: true,
      premultipliedAlpha: false, // Try different alpha settings
      preserveDrawingBuffer: true // Important for some Electron environments
    });
    
    // Enhanced rendering settings
    this.renderer.physicallyCorrectLights = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2; // Brighter exposure
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Center the viewport
    const containerWidth = this.container.clientWidth;
    const containerHeight = this.container.clientHeight;
    this.renderer.setSize(containerWidth, containerHeight);
    
    // Force the canvas to be visible with explicit styling
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.zIndex = '999'; // Very high z-index to ensure visibility
    this.renderer.domElement.style.border = '2px solid rgba(255, 0, 0, 0.5)'; // Debug border
    this.renderer.setViewport(0, 0, containerWidth, containerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap pixel ratio for performance
    this.container.appendChild(this.renderer.domElement);
    
    // Log canvas element details after appending to container
    console.log('SceneManager: Canvas element details', {
      width: this.renderer.domElement.width,
      height: this.renderer.domElement.height,
      style: {
        width: this.renderer.domElement.style.width,
        height: this.renderer.domElement.style.height,
        position: this.renderer.domElement.style.position,
        visibility: window.getComputedStyle(this.renderer.domElement).visibility,
        display: window.getComputedStyle(this.renderer.domElement).display,
        opacity: window.getComputedStyle(this.renderer.domElement).opacity,
        zIndex: window.getComputedStyle(this.renderer.domElement).zIndex
      },
      parentSize: {
        width: this.container.clientWidth,
        height: this.container.clientHeight
      },
      offsetParent: this.renderer.domElement.offsetParent ? true : false
    });

    // Initialize clock for timing
    this.clock = new THREE.Clock();

    // Setup orbital controls with configuration
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.applyConfig({
      enableDamping: true,
      dampingFactor: 0.1,
      minDistance: 15,    // Even closer minimum
      maxDistance: 50,    // Reduced max distance
      minPolarAngle: Math.PI / 4,  // Limit vertical rotation
      maxPolarAngle: Math.PI / 1.5,
      autoRotate: true,
      autoRotateSpeed: 0.3  // Very slow rotation
    });

    // Enhanced lighting setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // Reduced ambient
    
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.0); // Stronger main light
    mainLight.position.set(0, 50, 100);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    
    const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
    backLight.position.set(0, 20, -100);
    
    const leftLight = new THREE.PointLight(0x3498db, 0.3, 100);
    leftLight.position.set(-20, 10, 20);
    
    const rightLight = new THREE.PointLight(0xe74c3c, 0.3, 100);
    rightLight.position.set(20, 10, 20);
    
    this.scene.add(ambientLight, mainLight, backLight, leftLight, rightLight);

    // Add a subtle fog for depth
    this.scene.fog = new THREE.FogExp2(0x000000, 0.005);
  }

  /**
   * Start the animation loop explicitly
   */
  startAnimationLoop() {
    if (this.isDestroyed || !this.initialized) return;
    
    console.log('SceneManager: Starting animation loop explicitly');
    this.animating = true;
    
    // Ensure the animation method is bound to this instance
    if (!this._boundAnimate) {
      this._boundAnimate = this.animate.bind(this);
    }
    
    // Start the animation loop if not already running
    if (!this.frameId) {
      this.frameId = requestAnimationFrame(this._boundAnimate);
    }
  }

  /**
   * Main animation loop
   */
  animate() {
    if (this.isDestroyed || !this.initialized) return;

    try {
      // Request next frame first to ensure smooth animation
      this.frameId = requestAnimationFrame(this._boundAnimate || this.animate.bind(this));
      
      // Log first few frames for debugging
      if (this.frameId < 10 || this.frameId % 500 === 0) {
        console.log(`SceneManager: Animation frame ${this.frameId}`);
      }
      
      const delta = Math.min(this.clock.getDelta(), 0.1); // Cap delta time
      
      // Update all managers with error handling
      try {
        this.physicsManager.update(delta);
        this.controls.update();
        this.particleSystem.update(delta);
        this.entityManager.update(delta);
      } catch (error) {
        console.error('SceneManager: Error during component updates:', error);
      }

      // Render scene with additional checks
      try {
        // Check if canvas is actually visible in DOM
        if (this.renderer.domElement.offsetParent === null) {
          console.warn('SceneManager: Canvas element is not visible in DOM');
          
          // Try to make the canvas visible by forcing a style update
          if (this.frameId % 100 === 0) {
            this.renderer.domElement.style.display = 'block';
            this.renderer.domElement.style.visibility = 'visible';
            this.renderer.domElement.style.opacity = '1';
            this.renderer.domElement.style.zIndex = '999';
          }
        }
        
        this.renderer.render(this.scene, this.camera);
      } catch (error) {
        console.error('SceneManager: Error during rendering:', error);
      }
      
      // Periodically log rendering status (every 100 frames)
      if (Math.floor(this.frameId / 100) === this.frameId / 100) {
        console.log('SceneManager: Rendering frame', this.frameId, {
          cameraPosition: this.camera.position,
          neuronCount: this.entityManager?.neurons?.size || 0,
          isVisible: document.visibilityState === 'visible',
          containerVisible: this.container.offsetParent !== null
        });
      }
    } catch (error) {
      console.error('SceneManager: Critical error in animation loop:', error);
      this.isDestroyed = true; // Stop animation on critical error
      if (this.frameId !== null) {
        cancelAnimationFrame(this.frameId);
      }
    }
  }

  /**
   * Get the camera controls for external configuration
   */
  getControls() {
    if (!this.initialized) {
      console.warn('SceneManager: Attempting to access controls before initialization');
      return null;
    }

    try {
      return this.controls;
    } catch (error) {
      console.error('SceneManager: Error accessing controls:', error);
      return null;
    }
  }

  /**
   * Handle window resize events by updating renderer and camera
   */
  resize(width, height) {
    if (!this.initialized) {
      console.warn('SceneManager: Attempting to resize before initialization');
      return;
    }

    try {
      // Update camera
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      // Update renderer with centered viewport
      this.renderer.setSize(width, height);
      this.renderer.setViewport(0, 0, width, height);
      
      console.log('SceneManager: Resize called', {
        width,
        height,
        aspect: this.camera.aspect,
        rendererSize: {
          width: this.renderer.domElement.width,
          height: this.renderer.domElement.height
        }
      });

      // Ensure scene stays centered
      this.scene.position.set(0, 0, 0);
    } catch (error) {
      console.error('SceneManager: Error during resize:', error);
    }
  }

  /**
   * Add a new neuron to the network
   */
  addNeuron(parentId) {
    if (!this.initialized) {
      console.warn('SceneManager: Attempting to add neuron before initialization');
      return null;
    }

    try {
    console.log('SceneManager: Adding neuron, current count:', this.entityManager.neurons.size);
    
    if (!this.entityManager.neurons.size) {
      // Create center node
      const neuron = this.entityManager.addNeuron(undefined);
      neuron.position.set(0, 0, 0);
      console.log('SceneManager: Added center neuron at:', neuron.position);
      return neuron;
    }
    
    // Add subsequent nodes in fixed positions
    const neuron = this.entityManager.addNeuron(0); // Always connect to center
    const angle = (Math.PI * 2 * this.entityManager.neurons.size) / 3; // Divide circle into 3 parts
    neuron.position.set(
      Math.cos(angle) * 10,  // Fixed radius of 10
      Math.sin(angle) * 10,
      0
    );
    console.log('SceneManager: Added satellite neuron at:', neuron.position);
    return neuron;
    } catch (error) {
      console.error('SceneManager: Error adding neuron:', error);
      return null;
    }
  }

  /**
   * Trigger a pulse through the network
   */
  /**
   * Create initial triangle layout of neurons
   */
  async createInitialLayout() {
    if (!this.initialized) {
      throw new Error('Cannot create layout before initialization');
    }

    console.log('SceneManager: Creating initial layout');

    try {
      // Create center neuron
      const centerNeuron = this.entityManager.addNeuron(undefined);
      if (!centerNeuron) throw new Error('Failed to create center neuron');
      centerNeuron.position.set(0, 0, 0); // Ensure center position
      console.log('SceneManager: Created center neuron');

      // Create two satellite neurons
      const satellites = [];
      for (let i = 1; i <= 2; i++) {
        const angle = (Math.PI * 2 * i) / 3;
        const position = new THREE.Vector3(
          Math.cos(angle) * 10,
          Math.sin(angle) * 10,
          0
        );
        const neuron = this.entityManager.addNeuron(0); // Connect to center (id 0)
        if (!neuron) throw new Error(`Failed to create satellite neuron ${i}`);
        neuron.position.copy(position);
        console.log(`SceneManager: Created satellite neuron ${i}`);
        satellites.push(neuron);
      }

      // Create connection between satellites to form a triangle
      if (satellites.length >= 2) {
        this.entityManager.createConnection(satellites[0], satellites[1]);
        console.log('SceneManager: Created connection between satellites');
      }
      
      // Enable physics after creating the initial layout
      if (typeof this.physicsManager.setEnabled === 'function') {
        this.physicsManager.setEnabled(true);
        console.log('SceneManager: Physics enabled for active network');
      }
    } catch (error) {
      console.error('SceneManager: Error creating initial layout:', error);
      throw error;
    }
  }

  triggerPulse() {
    if (!this.initialized) {
      console.warn('SceneManager: Attempting to trigger pulse before initialization');
      return;
    }

    try {
      const neurons = this.entityManager.getNeurons();
      if (neurons.length === 0) return;

      // Start with the central neuron
      const centerNeuron = neurons[0];
      this.particleEffects.neuronActivation(centerNeuron);

      // Pulse through each connection
      centerNeuron.connections.forEach(conn => {
        this.particleEffects.connectionPulse(conn.from, conn.to, conn.from.color);
      });

      this.entityManager.triggerPulse();
    } catch (error) {
      console.error('SceneManager: Error triggering pulse:', error);
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.isDestroyed) return;

    this.isDestroyed = true;
    console.log('SceneManager: Starting cleanup');

    try {
      // Stop animation loop
      if (this.frameId !== null) {
        cancelAnimationFrame(this.frameId);
      }

      // Remove event listeners
      window.removeEventListener('resize', this.resizeHandler);
      if (this.ambientParticleInterval) {
        window.clearInterval(this.ambientParticleInterval);
      }

      // Clean up managers and controls if initialized
      if (this.initialized) {
        try {
          this.entityManager?.dispose();
          this.particleSystem?.dispose();
          this.controls?.dispose();
        } catch (error) {
          console.error('SceneManager: Error disposing managers:', error);
        }

        // Dispose of Three.js resources
        try {
          this.renderer?.dispose();
          this.scene?.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.geometry?.dispose();
              if (object.material instanceof THREE.Material) {
                object.material.dispose();
              }
            }
          });
        } catch (error) {
          console.error('SceneManager: Error disposing Three.js resources:', error);
        }
      }

      this.initialized = false;
      console.log('SceneManager: Cleanup complete');
    } catch (error) {
      console.error('SceneManager: Error during cleanup:', error);
    }
  }
}
