/**
 * ParticleEffects.js
 * 
 * Helper class to manage particle effect presets for the neural network.
 * Provides standardized effects for neuron activation, connection pulses,
 * and ambient particles.
 */

import * as THREE from 'three';

// Default particle configurations
const DEFAULT_PARTICLE_CONFIG = {
  minSize: 0.5,
  maxSize: 2.0,
  minLifetime: 0.5,
  maxLifetime: 3.0,
  baseSpeed: 1.0,
  spreadFactor: 1.0
};

export class ParticleEffects {
  constructor(particleSystem) {
    this.particleSystem = particleSystem;
  }

  /**
   * Create a burst of particles from a neuron when it's activated
   */
  neuronActivation(neuron, intensity = 1) {
    // Base particle count scales with intensity
    const particleCount = Math.floor((5 + Math.random() * 5) * intensity);
    
    // Create burst effect
    this.particleSystem.emit(neuron.position, neuron.color, particleCount, {
      lifetime: DEFAULT_PARTICLE_CONFIG.minLifetime + intensity * DEFAULT_PARTICLE_CONFIG.maxLifetime,
      speed: DEFAULT_PARTICLE_CONFIG.baseSpeed * (0.5 + intensity * 0.5),
      size: DEFAULT_PARTICLE_CONFIG.minSize + intensity * DEFAULT_PARTICLE_CONFIG.maxSize,
      opacity: 0.8 * intensity,
      spread: DEFAULT_PARTICLE_CONFIG.spreadFactor
    });

    // Create secondary glow particles
    const glowCount = Math.floor(particleCount * 0.5);
    const glowColor = neuron.color.clone().multiplyScalar(1.5);
    this.particleSystem.emit(neuron.position, glowColor, glowCount, {
      lifetime: DEFAULT_PARTICLE_CONFIG.minLifetime * intensity,
      speed: DEFAULT_PARTICLE_CONFIG.baseSpeed * 0.2,
      size: DEFAULT_PARTICLE_CONFIG.maxSize * intensity,
      opacity: 0.4 * intensity,
      spread: DEFAULT_PARTICLE_CONFIG.spreadFactor * 1.5
    });
  }

  /**
   * Create dramatic burst for neuron firing
   */
  neuronFiringEffect(neuron) {
    // Create intense burst
    this.neuronActivation(neuron, 2.5);

    // Add shockwave effect
    const shockwaveCount = 20;
    const shockwaveColor = neuron.color.clone().multiplyScalar(1.2);
    this.particleSystem.emit(neuron.position, shockwaveColor, shockwaveCount, {
      lifetime: DEFAULT_PARTICLE_CONFIG.maxLifetime,
      speed: DEFAULT_PARTICLE_CONFIG.baseSpeed * 2,
      size: DEFAULT_PARTICLE_CONFIG.maxSize * 0.75,
      opacity: 0.6,
      spread: DEFAULT_PARTICLE_CONFIG.spreadFactor * 2
    });
  }

  /**
   * Create intense burst effect for initial node expansion
   */
  initialBurstEffect(centerNeuron) {
    // Super intense burst from center
    this.neuronActivation(centerNeuron, 3);

    // Create expanding ring effect
    const ringCount = 30;
    const ringColor = new THREE.Color('#ffffff');
    this.particleSystem.emit(centerNeuron.position, ringColor, ringCount, {
      lifetime: DEFAULT_PARTICLE_CONFIG.maxLifetime,
      speed: DEFAULT_PARTICLE_CONFIG.baseSpeed * 3,
      size: DEFAULT_PARTICLE_CONFIG.maxSize,
      opacity: 0.4,
      spread: DEFAULT_PARTICLE_CONFIG.spreadFactor * 2.5
    });

    // Add ambient particles in a larger volume
    const ambientCount = 40;
    this.particleSystem.emit(centerNeuron.position, centerNeuron.color, ambientCount, {
      lifetime: DEFAULT_PARTICLE_CONFIG.maxLifetime + 1,
      speed: DEFAULT_PARTICLE_CONFIG.baseSpeed * 0.5,
      size: DEFAULT_PARTICLE_CONFIG.minSize * 2,
      opacity: 0.3,
      spread: DEFAULT_PARTICLE_CONFIG.spreadFactor * 20
    });
  }

  /**
   * Create particles that follow a connection when pulsing
   */
  connectionPulse(from, to, color) {
    // Calculate direction vector
    const direction = to.position.clone().sub(from.position);
    const distance = direction.length();
    direction.normalize();

    // Create particles along the path
    const particleCount = Math.ceil(distance / 5); // One particle every 5 units
    for (let i = 0; i < particleCount; i++) {
      const t = i / particleCount; // Position along path (0 to 1)
      const pos = from.position.clone().add(direction.clone().multiplyScalar(distance * t));
      
      // Add some random offset perpendicular to the path
      const offset = new THREE.Vector3();
      offset.copy(direction).cross(new THREE.Vector3(0, 1, 0)).multiplyScalar(Math.random() - 0.5);
      pos.add(offset.multiplyScalar(0.5)); // Small offset

      // Emit particle with velocity along the path
      this.particleSystem.emit(pos, color, 1, {
        lifetime: DEFAULT_PARTICLE_CONFIG.minLifetime,
        speed: DEFAULT_PARTICLE_CONFIG.baseSpeed * 0.8,
        size: DEFAULT_PARTICLE_CONFIG.minSize,
        opacity: 0.6,
        spread: DEFAULT_PARTICLE_CONFIG.spreadFactor * 0.5
      });
    }
  }

  /**
   * Create ambient background particles
   */
  createAmbientParticles(bounds) {
    const { min, max } = bounds;
    const count = 20;

    for (let i = 0; i < count; i++) {
      const position = new THREE.Vector3(
        min.x + Math.random() * (max.x - min.x),
        min.y + Math.random() * (max.y - min.y),
        min.z + Math.random() * (max.z - min.z)
      );

      // Use a random color from our theme with reduced opacity
      const color = new THREE.Color();
      color.setHSL(Math.random(), 0.5, 0.7);
      
      // Create slow-moving ambient particle
      this.particleSystem.emit(position, color, 1, {
        lifetime: DEFAULT_PARTICLE_CONFIG.maxLifetime + Math.random() * DEFAULT_PARTICLE_CONFIG.maxLifetime,
        speed: DEFAULT_PARTICLE_CONFIG.baseSpeed * 0.1,
        size: DEFAULT_PARTICLE_CONFIG.minSize + Math.random() * DEFAULT_PARTICLE_CONFIG.minSize,
        opacity: 0.3,
        spread: DEFAULT_PARTICLE_CONFIG.spreadFactor * 0.5
      });
    }
  }
}
