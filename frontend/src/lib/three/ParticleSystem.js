/**
 * ParticleSystem.js
 * 
 * Manages particle effects for the neural network visualization.
 * Uses instanced rendering for efficient particle management.
 * Implements a pool of reusable particles for memory efficiency.
 */

import * as THREE from 'three';

// Maximum number of particles to render
const MAX_PARTICLES = 100;

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    
    // Initialize buffer arrays
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.opacities = new Float32Array(MAX_PARTICLES);

    // Create geometry with buffer attributes
    this.geometry = new THREE.BufferGeometry();
    
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);
    this.sizeAttribute = new THREE.BufferAttribute(this.sizes, 1);
    this.opacityAttribute = new THREE.BufferAttribute(this.opacities, 1);

    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('color', this.colorAttribute);
    this.geometry.setAttribute('size', this.sizeAttribute);
    this.geometry.setAttribute('opacity', this.opacityAttribute);

    // Create particle material
    this.material = new THREE.PointsMaterial({
      size: 2,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: this.createParticleTexture()
    });

    // Create points mesh
    this.points = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.points);
  }

  /**
   * Create a circular particle texture
   */
  createParticleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get 2D context');

    // Create radial gradient
    const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    // Draw gradient
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);

    // Create texture
    const texture = new THREE.Texture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Emit new particles at a position with a color
   */
  emit(position, color, count = 1, options = {}) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) return;

      // Random velocity in sphere
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      ).normalize().multiplyScalar(0.5 + Math.random() * 0.5);

      // Create particle
      const particle = {
        position: position.clone(),
        velocity: velocity,
        color: color.clone(),
        age: 0,
        maxAge: options.lifetime || 1 + Math.random(),
        size: options.size || 2 + Math.random() * 2,
        opacity: options.opacity ?? 0.8
      };
      
      // Apply custom speed if provided
      if (options.speed !== undefined) {
        particle.velocity.multiplyScalar(options.speed);
      }

      this.particles.push(particle);
      this.updateParticleAttributes(this.particles.length - 1, particle);
    }

    // Update geometry attributes
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.sizeAttribute.needsUpdate = true;
    this.opacityAttribute.needsUpdate = true;
  }

  /**
   * Update particle attributes in the buffer arrays
   */
  updateParticleAttributes(index, particle) {
    const i3 = index * 3;

    // Position
    this.positions[i3] = particle.position.x;
    this.positions[i3 + 1] = particle.position.y;
    this.positions[i3 + 2] = particle.position.z;

    // Color
    this.colors[i3] = particle.color.r;
    this.colors[i3 + 1] = particle.color.g;
    this.colors[i3 + 2] = particle.color.b;

    // Size and opacity
    this.sizes[index] = particle.size;
    this.opacities[index] = particle.opacity;
  }

  /**
   * Update particle simulation
   */
  update(deltaTime) {
    let aliveCount = 0;

    // Update particles
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      particle.age += deltaTime;

      if (particle.age < particle.maxAge) {
        // Update position
        particle.position.add(particle.velocity.clone().multiplyScalar(deltaTime));
        
        // Fade out
        const lifeRatio = particle.age / particle.maxAge;
        particle.opacity = 0.8 * (1 - lifeRatio);
        particle.size = (2 + Math.random() * 2) * (1 - lifeRatio);
        
        // Update attributes for this particle
        this.updateParticleAttributes(aliveCount, particle);
        
        // If we moved the particle, update its index
        if (aliveCount !== i) {
          this.particles[aliveCount] = particle;
        }
        
        aliveCount++;
      }
    }

    // Remove dead particles
    this.particles.length = aliveCount;

    // Clear remaining buffer slots
    for (let i = aliveCount; i < MAX_PARTICLES; i++) {
      const i3 = i * 3;
      this.positions[i3] = 0;
      this.positions[i3 + 1] = 0;
      this.positions[i3 + 2] = 0;
      this.opacities[i] = 0;
    }

    // Update geometry attributes
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.sizeAttribute.needsUpdate = true;
    this.opacityAttribute.needsUpdate = true;

    // Update geometry draw range
    this.geometry.setDrawRange(0, aliveCount);
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    if (this.material.map) {
      this.material.map.dispose();
    }
    this.scene.remove(this.points);
  }
}
