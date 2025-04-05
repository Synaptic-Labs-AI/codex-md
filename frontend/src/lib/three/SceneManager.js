/**
 * SceneManager.js
 * 
 * Manages the Three.js scene setup and rendering for the knowledge graph visualization.
 * This is the main orchestrator of the 3D visualization.
 */

import * as THREE from 'three';
import { EntityManager } from './EntityManager';
import { OrbitControls } from './controls/OrbitControls';

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.frameId = null;
    this.isDestroyed = false;
    this.initialized = false;
  }

  /**
   * Initialize the scene
   */
  async initializeDormant() {
    if (this.initialized) return;
    console.log('SceneManager: Initializing scene');
    
    try {
      // Scene setup only
      await this.setupScene();
      console.log('SceneManager: Scene setup complete');
      
      // Initialize entity manager only
      this.entityManager = new EntityManager(this.scene);
      console.log('SceneManager: Components initialized');
      
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
    this.camera.position.set(0, 30, 60);
    this.camera.lookAt(0, 0, 0);
    
    // Make camera accessible to scene entities
    this.scene.camera = this.camera;
    
    // Center the scene origin
    this.scene.position.set(0, 0, 0);
    
    // Renderer setup with antialiasing and transparency
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true
    });
    
    // Renderer settings
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const containerWidth = this.container.clientWidth;
    const containerHeight = this.container.clientHeight;
    this.renderer.setSize(containerWidth, containerHeight);
    
    // Setup renderer DOM element
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.zIndex = '999';
    this.container.appendChild(this.renderer.domElement);

    // Initialize clock for timing
    this.clock = new THREE.Clock();

    // Setup orbital controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 50;
    this.controls.minPolarAngle = Math.PI / 4;
    this.controls.maxPolarAngle = Math.PI / 1.5;
    this.controls.autoRotate = false; // Disable auto-rotation

    // Simple lighting setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(0, 50, 100);
    
    this.scene.add(ambientLight, mainLight);
  }

  /**
   * Start the animation loop
   */
  startAnimationLoop() {
    if (this.isDestroyed || !this.initialized) return;
    
    if (!this._boundAnimate) {
      this._boundAnimate = this.animate.bind(this);
    }
    
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
      this.frameId = requestAnimationFrame(this._boundAnimate || this.animate.bind(this));
      
      // Update controls and entity manager
      this.controls.update();
      this.entityManager.update();
      
      // Render scene
      this.renderer.render(this.scene, this.camera);
      
    } catch (error) {
      console.error('SceneManager: Error in animation loop:', error);
      this.isDestroyed = true;
      if (this.frameId !== null) {
        cancelAnimationFrame(this.frameId);
      }
    }
  }

  /**
   * Handle window resize events
   */
  resize(width, height) {
    if (!this.initialized) return;

    try {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.renderer.setViewport(0, 0, width, height);
      this.scene.position.set(0, 0, 0);
    } catch (error) {
      console.error('SceneManager: Error during resize:', error);
    }
  }

  /**
   * Add a new node to the graph
   */
  addNode(parentId) {
    if (!this.initialized) return null;

    try {
      return this.entityManager.addNode(parentId);
    } catch (error) {
      console.error('SceneManager: Error adding node:', error);
      return null;
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
      if (this.frameId !== null) {
        cancelAnimationFrame(this.frameId);
      }

      window.removeEventListener('resize', this.resizeHandler);

      if (this.initialized) {
        this.entityManager?.dispose();
        this.controls?.dispose();
        this.renderer?.dispose();
        this.scene?.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry?.dispose();
            if (object.material instanceof THREE.Material) {
              object.material.dispose();
            }
          }
        });
      }

      this.initialized = false;
    } catch (error) {
      console.error('SceneManager: Error during cleanup:', error);
    }
  }

  /**
   * Get controls for external configuration
   */
  getControls() {
    return this.initialized ? this.controls : null;
  }
}
