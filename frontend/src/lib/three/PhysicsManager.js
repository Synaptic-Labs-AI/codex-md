/**
 * PhysicsManager.js
 * 
 * Handles force-directed layout physics for the neural network.
 * Implements spring forces between connected nodes and repulsion between all nodes.
 * Uses a simple velocity-based physics system with damping for stability.
 */

import * as THREE from 'three';

// Default physics configuration
const DEFAULT_PHYSICS_CONFIG = {
  springStrength: 0.2,    // Stronger spring force
  springLength: 30,       // Shorter ideal length
  repulsion: 300,        // Stronger repulsion
  centerPull: 0.03,      // Slightly stronger center pull
  groupCohesion: 0.12,   // Stronger group cohesion
  damping: 0.85,         // Slightly higher damping
  maxSpeed: 8            // Higher max speed
};

export class PhysicsManager {
  constructor(entityManager) {
    this.entityManager = entityManager;
    this.config = { ...DEFAULT_PHYSICS_CONFIG };
    this.tmpVec3 = new THREE.Vector3();
    this.tmpVec3_2 = new THREE.Vector3(); // Second temp vector for calculations
    this.maxConnections = 5; // Limit connections per node for performance
    this.enabled = true; // Physics enabled by default
  }

  /**
   * Enable or disable physics simulation
   */
  setEnabled(value) {
    this.enabled = !!value;
    console.log(`PhysicsManager: Physics ${this.enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Update physics simulation for one time step
   */
  /**
   * Calculate group center for a given group
   */
  calculateGroupCenter(groupId) {
    const group = this.entityManager.groups.get(groupId);
    if (!group || group.size === 0) return null;

    const center = new THREE.Vector3();
    group.forEach(neuron => {
      center.add(neuron.position);
    });
    center.divideScalar(group.size);
    return center;
  }

  /**
   * Apply cohesive force within groups
   */
  applyGroupCohesion(neurons) {
    // Group neurons by their groupId
    const groupCenters = new Map();
    
    neurons.forEach(neuron => {
      if (neuron.id === 0) return; // Skip fixed neurons
      
      let center = groupCenters.get(neuron.groupId);
      if (!center) {
        center = this.calculateGroupCenter(neuron.groupId);
        if (center) groupCenters.set(neuron.groupId, center);
      }
      
      if (center) {
        // Pull towards group center
        this.tmpVec3_2.copy(center).sub(neuron.position);
        this.tmpVec3_2.multiplyScalar(this.config.groupCohesion);
        neuron.velocity.add(this.tmpVec3_2);
      }
    });
  }

  update(deltaTime) {
    // Skip physics calculations if disabled
    if (!this.enabled) return;
    
    const neurons = this.entityManager.getNeurons();
    const connections = this.entityManager.getConnections();

    // Reset forces and apply initial impulse to inactive neurons
    neurons.forEach(neuron => {
      neuron.velocity.multiplyScalar(this.config.damping);
      
      // Add small random movement to inactive neurons to prevent stagnation
      if (!neuron.active && Math.random() < 0.1) {
        neuron.velocity.add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1
        ));
      }
    });

    // Apply spring forces along connections
    connections.forEach(connection => {
      this.applySpringForce(connection);
    });

    // Apply repulsion between all neurons
    this.applyRepulsionForces(neurons);

    // Apply group cohesion
    this.applyGroupCohesion(neurons);

    // Apply centering force (weaker than group cohesion)
    this.applyCenteringForce(neurons);

    // Update positions
    neurons.forEach(neuron => {
      if (neuron.id === 0) return; // Keep first neuron fixed

      // Limit velocity
      if (neuron.velocity.lengthSq() > this.config.maxSpeed * this.config.maxSpeed) {
        neuron.velocity.normalize().multiplyScalar(this.config.maxSpeed);
      }

      // Update position
      neuron.position.add(neuron.velocity.clone().multiplyScalar(deltaTime));
    });
  }

  /**
   * Apply spring force between connected neurons
   */
  applySpringForce(connection) {
    const { from, to } = connection;
    if (from.id === 0 && to.id === 0) return; // Skip if both neurons are fixed

    // Calculate displacement vector
    this.tmpVec3.copy(to.position).sub(from.position);
    const distance = this.tmpVec3.length();

    if (distance === 0) return; // Avoid division by zero

    // Calculate spring force (F = k * (distance - rest_length))
    const force = (distance - this.config.springLength) * this.config.springStrength;
    this.tmpVec3.normalize().multiplyScalar(force);

    // Apply force to both neurons (equal and opposite)
    if (from.id !== 0) { // Don't move fixed neurons
      from.velocity.add(this.tmpVec3);
    }
    if (to.id !== 0) {
      to.velocity.sub(this.tmpVec3);
    }
  }

  /**
   * Apply repulsion between all neurons to prevent clumping
   */
  applyRepulsionForces(neurons) {
    for (let i = 0; i < neurons.length; i++) {
      const neuronA = neurons[i];
      if (neuronA.id === 0) continue; // Skip fixed neurons

      for (let j = i + 1; j < neurons.length; j++) {
        const neuronB = neurons[j];
        if (neuronB.id === 0) continue;

        // Calculate displacement vector
        this.tmpVec3.copy(neuronB.position).sub(neuronA.position);
        const distanceSquared = this.tmpVec3.lengthSq();

        if (distanceSquared === 0) {
          // If neurons are at the same position, add random jitter
          this.tmpVec3.set(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
          ).normalize();
        } else {
          this.tmpVec3.normalize();
        }

        // Calculate repulsion force (inverse square law)
        const force = this.config.repulsion / Math.max(1, distanceSquared);
        this.tmpVec3.multiplyScalar(-force); // Negative for repulsion

        // Apply force to both neurons
        neuronA.velocity.add(this.tmpVec3);
        neuronB.velocity.sub(this.tmpVec3);
      }
    }
  }

  /**
   * Apply a weak force pulling all neurons toward the center
   */
  applyCenteringForce(neurons) {
    neurons.forEach(neuron => {
      if (neuron.id === 0) return; // Skip fixed neurons

      // Vector pointing to origin
      this.tmpVec3.copy(neuron.position).multiplyScalar(-this.config.centerPull);
      neuron.velocity.add(this.tmpVec3);
    });
  }

  /**
   * Update physics configuration
   */
  setConfig(config) {
    Object.assign(this.config, config);
  }

  /**
   * Get current physics configuration
   */
  getConfig() {
    return { ...this.config };
  }
}
