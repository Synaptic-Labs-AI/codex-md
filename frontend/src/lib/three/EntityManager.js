/**
 * EntityManager.js
 * 
 * Manages the creation, updates, and disposal of neurons and their connections.
 * Handles the visual representation and state management of the neural network.
 */

import * as THREE from 'three';

// Performance and network limits
const NETWORK_LIMITS = {
  maxNeurons: 50,
  maxConnectionsPerNeuron: 3,
  crossConnectionChance: 0.25, // 25% chance
  updateInterval: 50 // Milliseconds between position updates
};

// Default configurations for visual elements
const DEFAULT_NEURON_CONFIG = {
  minSize: 1.5,      // Even smaller neurons
  maxSize: 2.5,      // Even smaller neurons
  segments: 6,       // Keep reduced segments for performance
  baseEmissive: 0.1,  // Base glow
  activeEmissive: 0.5, // Active glow
  initialSize: 3,    // Smaller initial neuron
  actionPotentialThreshold: 0.7,
  actionPotentialDecay: 0.98,
  burstSize: 2,
  burstDelay: 2000
};

const DEFAULT_CONNECTION_CONFIG = {
  thickness: 1,
  baseEmissive: 0.05,   // Base glow intensity
  activeEmissive: 0.3   // Active glow intensity
};

export class EntityManager {
  constructor(scene) {
    this.scene = scene;
    this.neurons = new Map();
    this.connections = new Map();
    this.nextNeuronId = 0;
    this.groups = new Map(); // Track neuron groups
    this.nextGroupId = 0;
    this.lastUpdateTime = 0; // Track last position update

    // Shared geometries and materials for performance
    this.neuronGeometry = new THREE.SphereGeometry(
      1, // Base radius (will be scaled)
      DEFAULT_NEURON_CONFIG.segments,
      DEFAULT_NEURON_CONFIG.segments
    );

    // Initialize shared materials
    this.neuronMaterial = new THREE.MeshLambertMaterial({
      transparent: false, // No transparency
      color: new THREE.Color(0x444444),
      emissive: new THREE.Color(0x444444),
      emissiveIntensity: DEFAULT_NEURON_CONFIG.baseEmissive
    });

    this.connectionMaterial = new THREE.LineBasicMaterial({
      transparent: false,
      linewidth: DEFAULT_CONNECTION_CONFIG.thickness, // Note: linewidth only works in WebGL2
      emissive: new THREE.Color(0x222222),
      emissiveIntensity: DEFAULT_CONNECTION_CONFIG.baseEmissive
    });

    // Vibrant theme colors
    this.colors = [
      new THREE.Color('#00FFC8'),  // Bright Cyan
      new THREE.Color('#FF00E6'),  // Bright Magenta
      new THREE.Color('#FFA200'),  // Bright Orange
      new THREE.Color('#00B4FF'),  // Bright Blue
      new THREE.Color('#FF4040'),  // Bright Red
    ];
  }

  /**
   * Add a new neuron, optionally connected to an existing parent
   */
  addNeuron(parentId) {
    // Check network size limits
    if (this.neurons.size >= NETWORK_LIMITS.maxNeurons) {
      console.log('Network size limit reached');
      return null;
    }

    // For non-initial neurons, check parent's connection limit
    if (parentId !== undefined) {
      const parent = this.neurons.get(parentId);
      if (parent && parent.connections.length >= NETWORK_LIMITS.maxConnectionsPerNeuron) {
        console.log('Parent connection limit reached');
        return null;
      }
    }

    const id = this.nextNeuronId++;
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];

    // Create material instance for this neuron
    const material = this.neuronMaterial.clone();
    material.color = color;
    material.emissiveIntensity = DEFAULT_NEURON_CONFIG.baseEmissive;

    // Create mesh for the neuron
    const size = THREE.MathUtils.lerp(
      DEFAULT_NEURON_CONFIG.minSize,
      DEFAULT_NEURON_CONFIG.maxSize,
      Math.random()
    );
    const mesh = new THREE.Mesh(this.neuronGeometry, material);
    mesh.scale.setScalar(size);

    // Initial position - if parent exists, start near them
    const position = new THREE.Vector3();
    if (parentId !== undefined) {
      const parent = this.neurons.get(parentId);
      if (parent) {
        position.copy(parent.position);
        // Add small random offset
        position.add(new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2
        ));
      }
    }
    mesh.position.copy(position);

    // Create neuron object
    const neuron = {
      id,
      position: mesh.position,
      velocity: new THREE.Vector3(),
      mesh,
      color,
      radius: id === 0 ? DEFAULT_NEURON_CONFIG.initialSize : size,
      connections: [],
      active: false,
      actionPotential: 0,
      pulseCount: 0,
      refractoryPeriod: false,
      groupId: parentId !== undefined ? this.neurons.get(parentId)?.groupId : this.nextGroupId++,
      zDepth: (Math.random() - 0.5) * 20,
      createdAt: Date.now()
    };

    // Track neuron in its group
    if (!this.groups.has(neuron.groupId)) {
      this.groups.set(neuron.groupId, new Set());
    }
    this.groups.get(neuron.groupId).add(neuron);

    // Add to scene and tracking
    this.scene.add(mesh);
    this.neurons.set(id, neuron);

    // If parent specified, create connection
    if (parentId !== undefined) {
      const parent = this.neurons.get(parentId);
      if (parent) {
        this.createConnection(parent, neuron);
      }
    }
    
    // Create cross-connections with probability check and connection limit
    if (this.neurons.size > 3 && 
        Math.random() < NETWORK_LIMITS.crossConnectionChance && 
        neuron.connections.length < NETWORK_LIMITS.maxConnectionsPerNeuron) {
      this.createRandomCrossConnection();
    }

    return neuron;
  }

  /**
   * Create a connection between two neurons
   */
  createConnection(from, to) {
    // Check connection limits
    if (from.connections.length >= NETWORK_LIMITS.maxConnectionsPerNeuron) {
      console.log('Source neuron connection limit reached');
      return null;
    }
    if (to.connections.length >= NETWORK_LIMITS.maxConnectionsPerNeuron) {
      console.log('Target neuron connection limit reached');
      return null;
    }

    // Check if connection already exists
    const connectionId = `${from.id}-${to.id}`;
    if (this.connections.has(connectionId)) {
      console.log('Connection already exists');
      return null;
    }

    try {
      // Create simple line for connection
      const points = [from.position, to.position];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);

      // Create material with simple properties
      const material = this.connectionMaterial.clone();
      material.color = from.color;

      const line = new THREE.Line(geometry, material);
      
      // Create line with variable strength
      const strength = Math.random() * 0.3 + 0.7; // Higher base strength (0.7-1.0)
      material.emissiveIntensity = DEFAULT_CONNECTION_CONFIG.baseEmissive * strength;
      this.scene.add(line);

      const connection = {
        id: `${from.id}-${to.id}`,
        from,
        to,
        mesh: line,
        strength,
        active: false,
        createdAt: Date.now()
      };

      // Track connection
      this.connections.set(connection.id, connection);
      from.connections.push(connection);
      to.connections.push(connection);

      return connection;
    } catch (error) {
      console.error('Error creating connection:', error);
      return null;
    }
  }

  /**
   * Create a random cross-group connection
   */
  createRandomCrossConnection() {
    // Only create cross connections if we have multiple groups
    if (this.groups.size <= 1) return;
    
    // 35% chance of creating a cross connection
    if (Math.random() > 0.35) return;

    // Get random groups
    const groupIds = Array.from(this.groups.keys());
    const group1Id = groupIds[Math.floor(Math.random() * groupIds.length)];
    let group2Id;
    do {
      group2Id = groupIds[Math.floor(Math.random() * groupIds.length)];
    } while (group2Id === group1Id);

    // Get random neurons from each group
    const group1Neurons = Array.from(this.groups.get(group1Id));
    const group2Neurons = Array.from(this.groups.get(group2Id));
    
    const fromNeuron = group1Neurons[Math.floor(Math.random() * group1Neurons.length)];
    const toNeuron = group2Neurons[Math.floor(Math.random() * group2Neurons.length)];

    // Create the cross connection
    this.createConnection(fromNeuron, toNeuron);
  }

  /**
   * Update visual state of all entities
   */
  update(deltaTime) {
    const time = Date.now();
    const timeInSeconds = time * 0.001; // Convert to seconds for animations
    
    // Throttle position updates based on update interval
    const shouldUpdatePositions = time - this.lastUpdateTime >= NETWORK_LIMITS.updateInterval;
    
    // Update connection geometries and materials
    for (const connection of this.connections.values()) {
      // Only update positions at interval
      if (shouldUpdatePositions) {
        const positions = connection.mesh.geometry.attributes.position;
        positions.setXYZ(0, connection.from.position.x, connection.from.position.y, connection.from.position.z);
        positions.setXYZ(1, connection.to.position.x, connection.to.position.y, connection.to.position.z);
        positions.needsUpdate = true;
      }

      // Animate connection opacity and glow based on activity
      if (connection.active) {
        const pulseIntensity = Math.sin(timeInSeconds * 5) * 0.5 + 0.5;
          // Only animate emissive intensity
          connection.mesh.material.emissiveIntensity = DEFAULT_CONNECTION_CONFIG.baseEmissive + 
            (pulseIntensity * DEFAULT_CONNECTION_CONFIG.activeEmissive);
      }
    }

    if (shouldUpdatePositions) {
      this.lastUpdateTime = time;
    }

    // Update neuron visuals with more dynamic pulsing
    for (const neuron of this.neurons.values()) {
      if (neuron.active) {
        // Combine multiple sine waves for more organic pulsing
        const fastPulse = Math.sin(timeInSeconds * 8) * 0.3;
        const slowPulse = Math.sin(timeInSeconds * 2) * 0.2;
        const scale = neuron.radius * (1 + fastPulse + slowPulse);
        neuron.mesh.scale.setScalar(scale);

        // Animate opacity for pulsing effect
        if (neuron.mesh.material instanceof THREE.Material) {
          neuron.mesh.material.emissiveIntensity = DEFAULT_NEURON_CONFIG.baseEmissive + 
            (Math.sin(timeInSeconds * 4) * DEFAULT_NEURON_CONFIG.activeEmissive);
        }
      }
    }
  }

  /**
   * Trigger a pulse through the network
   */
  triggerPulse() {
    // Get center neuron (first created)
    const centerNeuron = this.neurons.get(0);
    if (!centerNeuron) return;

    // Start pulse from center
    this.pulsateNeuron(centerNeuron);
  }

  /**
   * Recursively pulse through connected neurons
   */
  pulsateNeuron(neuron, delay = 0) {
    if (neuron.refractoryPeriod) return;

    setTimeout(() => {
      // Increment action potential and pulse count
      neuron.actionPotential += 0.2;
      neuron.pulseCount++;

      // Activate neuron with intensity based on action potential
      neuron.active = true;
      const intensity = Math.min(1, neuron.actionPotential);
      if (neuron.mesh.material instanceof THREE.Material) {
        neuron.mesh.material.emissiveIntensity = DEFAULT_NEURON_CONFIG.baseEmissive + 
          (intensity * DEFAULT_NEURON_CONFIG.activeEmissive);
      }
      
      // Initial node burst behavior
      if (neuron.id === 0 && neuron.pulseCount === 3) {
        this.initialBurst();
        return;
      }

      // Check for action potential threshold
      if (neuron.actionPotential >= DEFAULT_NEURON_CONFIG.actionPotentialThreshold) {
        this.neuronFire(neuron);
        return;
      }

      // Pulse connections with intensity
      neuron.connections.forEach(conn => {
        conn.active = true;
        if (conn.mesh.material instanceof THREE.Material) {
          // Scale pulse intensity by connection strength
          const pulseIntensity = intensity * conn.strength;
          conn.mesh.material.emissiveIntensity = DEFAULT_CONNECTION_CONFIG.baseEmissive + 
            (pulseIntensity * DEFAULT_CONNECTION_CONFIG.activeEmissive * conn.strength);
          // Scale line thickness during pulse
          conn.mesh.scale.setScalar(conn.strength * (1 + pulseIntensity * 0.5));
        }
      });

      // Reset after duration
      setTimeout(() => {
        // Decay action potential
        neuron.actionPotential *= DEFAULT_NEURON_CONFIG.actionPotentialDecay;
        
        neuron.active = false;
        if (neuron.mesh.material instanceof THREE.Material) {
          neuron.mesh.material.emissiveIntensity = DEFAULT_NEURON_CONFIG.baseEmissive;
        }
        
        neuron.connections.forEach(conn => {
          conn.active = false;
          if (conn.mesh.material instanceof THREE.Material) {
          conn.mesh.material.emissiveIntensity = DEFAULT_CONNECTION_CONFIG.baseEmissive * conn.strength;
            conn.mesh.scale.setScalar(conn.strength); // Reset to base thickness
          }

          // Pulse connected neurons with probability based on connection strength
          const nextNeuron = conn.to === neuron ? conn.from : conn.to;
          if (!nextNeuron.active && Math.random() < (0.8 * conn.strength)) {
            // Stronger connections transmit pulses faster
            const delay = 100 * (1.5 - conn.strength);
            this.pulsateNeuron(nextNeuron, delay);
          }
        });
      }, 300);
    }, delay);
  }

  /**
   * Clean up resources
   */
  dispose() {
    // Clean up geometries
    this.neuronGeometry.dispose();

    // Clean up shared materials
    this.neuronMaterial.dispose();
    this.connectionMaterial.dispose();

    // Clean up individual entities
    this.neurons.forEach(neuron => {
      if (neuron.mesh.material instanceof THREE.Material) {
        neuron.mesh.material.dispose();
      }
      this.scene.remove(neuron.mesh);
    });

    this.connections.forEach(conn => {
      conn.mesh.geometry.dispose();
      if (conn.mesh.material instanceof THREE.Material) {
        conn.mesh.material.dispose();
      }
      this.scene.remove(conn.mesh);
    });

    // Clear collections
    this.neurons.clear();
    this.connections.clear();
  }

  // Getters for physics system
  getNeurons() {
    return Array.from(this.neurons.values());
  }

  getConnections() {
    return Array.from(this.connections.values());
  }

  /**
   * Handle neuron firing when action potential threshold is reached
   */
  neuronFire(neuron) {
    neuron.refractoryPeriod = true;
    neuron.actionPotential = 0;

    // Create intense burst effect with glow
    if (neuron.mesh.material instanceof THREE.Material) {
      neuron.mesh.material.emissiveIntensity = DEFAULT_NEURON_CONFIG.activeEmissive; // Intense glow during burst
      neuron.mesh.scale.multiplyScalar(1.5);
    }


    // Check connection limits before creating new connections
    if (neuron.connections.length < NETWORK_LIMITS.maxConnectionsPerNeuron) {
      const nearbyNeurons = this.getNeurons().filter(n => 
        n !== neuron && 
        !neuron.connections.some(c => c.to === n || c.from === n) &&
        n.connections.length < NETWORK_LIMITS.maxConnectionsPerNeuron
      );
      
      if (nearbyNeurons.length > 0) {
        const target = nearbyNeurons[Math.floor(Math.random() * nearbyNeurons.length)];
        this.createConnection(neuron, target);
      }
    }

    // Reset after refractory period
    setTimeout(() => {
      neuron.refractoryPeriod = false;
      if (neuron.mesh.material instanceof THREE.Material) {
        neuron.mesh.material.emissiveIntensity = DEFAULT_NEURON_CONFIG.baseEmissive; // Reset glow
        neuron.mesh.scale.setScalar(neuron.radius);
      }
    }, 1000);
  }

  /**
   * Initial burst of neurons from center
   */
  initialBurst() {
    const centerNeuron = this.neurons.get(0);
    if (!centerNeuron) return;


    // Create 2-3 new neurons in a burst
    const burstCount = DEFAULT_NEURON_CONFIG.burstSize;
    const angleStep = (Math.PI * 2) / burstCount;

    for (let i = 0; i < burstCount; i++) {
      const angle = angleStep * i;
      const distance = 10;
      const position = new THREE.Vector3(
        Math.cos(angle) * distance,
        Math.sin(angle) * distance,
        (Math.random() - 0.5) * distance
      );

      // Create neuron with more velocity
      const neuron = this.addNeuron(0);
      neuron.position.copy(position);
      neuron.velocity.copy(position).normalize().multiplyScalar(2);
      
      // Connect to center
      this.createConnection(centerNeuron, neuron);
    }

    // Create cross connections between burst neurons
    this.createRandomCrossConnection();
  }
}
