/**
 * EntityManager.js
 * 
 * Manages the creation and rendering of nodes and edges in a knowledge graph visualization.
 * Handles the visual representation and state management of the graph structure.
 */

import * as THREE from 'three';

// Physics configuration
const PHYSICS_CONFIG = {
  repelStrength: 80,      // Even stronger repulsion for more dynamic movement
  attractStrength: 50,    // Stronger attraction to balance repulsion
  collisionDistance: 6.0, // Slightly larger connection range
  postConnectRepel: 90,   // Much stronger repulsion after connection
  springLength: 12,       // Slightly shorter springs for tighter clusters
  springStrength: 2.0,    // Much stronger spring force for bouncier behavior
  damping: 0.92,         // Less damping for more dynamic motion
  maxVelocity: 8.0,      // Higher speed cap for more energetic movement
  minDistance: 3.5       // Slightly smaller minimum distance
};

// Graph visualization limits
const GRAPH_LIMITS = {
  maxNodes: 50,
  maxConnectionsPerNode: 4,     // Allow more connections
  proximityThreshold: 6.0,      // Larger connection formation range
  additionInterval: 3000        // Keep same timing
};

// Visual configurations
const NODE_CONFIG = {
  size: 1.0,      // Smaller node size
  segments: 16    // Smoother spheres
};

const EDGE_CONFIG = {
  radius: 0.1,    // Thinner tube radius
  segments: 8     // Tube segments
};

export class EntityManager {
  constructor(scene) {
    this.scene = scene;
    this.neurons = new Map();
    this.connections = new Map();
    this.nextNeuronId = 0;
    this.groups = new Map(); // Track node groups
    this.nextGroupId = 0;
    this.lastUpdateTime = 0; // Track last position update
    this.pulsePhase = 0; // Track pulse animation phase
    this.pulseSpeed = 0.15; // Slightly faster base pulse speed
    this.pulseStrength = 0.02; // Minimal scaling, more emphasis on glow
    this.generation = 0; // Track node generation

    // Initialize physics state
    this.velocities = new Map(); // Store node velocities
    this.forces = new Map();     // Store accumulated forces

    // Create shared geometries
    this.nodeGeometry = new THREE.SphereGeometry(
      NODE_CONFIG.size,
      NODE_CONFIG.segments,
      NODE_CONFIG.segments
    );

    // Create shared materials using MeshPhysicalMaterial for glow effects
    this.nodeMaterial = new THREE.MeshPhysicalMaterial({
      transparent: true,
      color: new THREE.Color(0x888888),
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.5,
      opacity: 0.95,
      metalness: 0.3,
      roughness: 0.4,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1
    });

    // Initialize tube geometry for edges
    this.edgeGeometry = new THREE.TubeGeometry(
      new THREE.LineCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0)
      ),
      1,
      EDGE_CONFIG.radius,
      EDGE_CONFIG.segments,
      false
    );

    // Keep vibrant color scheme
    this.colors = [
      new THREE.Color('#00FFC8'),  // Bright Cyan
      new THREE.Color('#FF00E6'),  // Bright Magenta
      new THREE.Color('#FFA200'),  // Bright Orange
      new THREE.Color('#00B4FF'),  // Bright Blue
      new THREE.Color('#FF4040'),  // Bright Red
    ];
    
    this.lastNodeTime = 0;
  }

  // Helper to check if nodes are connected
  isConnected(node1, node2) {
    return this.connections.has(`${node1.id}-${node2.id}`) || 
           this.connections.has(`${node2.id}-${node1.id}`);
  }

  // Calculate force between nodes
  calculateForce(node1, node2) {
    const dx = node2.position.x - node1.position.x;
    const dy = node2.position.y - node1.position.y;
    const dz = node2.position.z - node1.position.z;
    
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance === 0) return new THREE.Vector3();
    
    const direction = new THREE.Vector3(dx, dy, dz).normalize();
    let forceMagnitude;

    // Check if nodes are connected
    if (this.isConnected(node1, node2)) {
      // Connected nodes repel
      forceMagnitude = -PHYSICS_CONFIG.postConnectRepel / (distance * distance);
    } else {
      // Unconnected nodes: attract if different color, repel if same
      if (node1.color.equals(node2.color)) {
        forceMagnitude = -PHYSICS_CONFIG.repelStrength / (distance * distance);
      } else {
        forceMagnitude = PHYSICS_CONFIG.attractStrength / (distance * distance);
      }

      // Check for new connection formation
      if (distance <= PHYSICS_CONFIG.collisionDistance && 
          !node1.color.equals(node2.color)) {
        this.createConnection(node1, node2);
      }
    }
    
    // Prevent extreme forces at very close distances
    if (distance < PHYSICS_CONFIG.minDistance) {
      forceMagnitude *= (distance / PHYSICS_CONFIG.minDistance);
    }
    
    return direction.multiplyScalar(forceMagnitude);
  }

  /**
   * Add a new node to the knowledge graph
   */
  addNode(parentId) {
    // Check size limit
    if (this.neurons.size >= GRAPH_LIMITS.maxNodes) {
      console.log('Graph size limit reached');
      return null;
    }

    const id = this.nextNeuronId++;
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];

    // Create material instance for the node with proper color handling
    const material = this.nodeMaterial.clone();
    material.color.copy(color);
    material.emissive.copy(color);
    material.emissiveIntensity = 0.6;

    // Create mesh for the node
    const mesh = new THREE.Mesh(this.nodeGeometry, material);

    // Position node in a spiral pattern with some randomness
    const spiralAngle = this.neurons.size * 0.5; // Create spiral pattern
    const heightOffset = Math.cos(spiralAngle) * 5; // Oscillating height
    const radius = this.neurons.size === 0 ? 0 : 20 + (Math.random() * 15) + (this.neurons.size * 0.5);
    
    const position = new THREE.Vector3(
      radius * Math.cos(spiralAngle),
      heightOffset + Math.random() * 5, // Add random height variation
      radius * Math.sin(spiralAngle)
    );
    mesh.position.copy(position);

    // Initialize velocity tangential to the spiral
    const tangentAngle = spiralAngle + Math.PI / 2; // 90 degrees offset for tangential motion
    const upwardBias = Math.random() * 0.5; // Add slight upward tendency
    
    const speed = PHYSICS_CONFIG.maxVelocity * (0.4 + Math.random() * 0.4); // 40-80% of max speed
    const velocity = new THREE.Vector3(
      Math.cos(tangentAngle) * speed,     // Tangential X component
      upwardBias * speed,                 // Upward drift
      Math.sin(tangentAngle) * speed      // Tangential Z component
    );
    
    const force = new THREE.Vector3();
    this.velocities.set(id, velocity);
    this.forces.set(id, force);

    // Center camera on first node
    if (this.neurons.size === 0) {
      this.scene.position.set(0, 0, 0);
      if (this.scene.camera) {
        this.scene.camera.position.set(0, 30, 60);
        this.scene.camera.lookAt(0, 0, 0);
      }
    }

    // Create node object with generation and phase offset
    const parentGen = parentId !== undefined ? this.neurons.get(parentId)?.generation : -1;
    const generation = parentGen + 1;
    const phaseOffset = (generation * Math.PI / 4);

    const node = {
      id,
      position: mesh.position,
      mesh,
      color,
      connections: [],
      groupId: parentId !== undefined ? this.neurons.get(parentId)?.groupId : this.nextGroupId++,
      generation,
      phaseOffset,
      createdAt: Date.now()
    };

    // Add to scene and tracking
    this.scene.add(mesh);
    this.neurons.set(id, node);

    // If parent specified, create connection
    if (parentId !== undefined) {
      const parent = this.neurons.get(parentId);
      if (parent) {
        this.createConnection(parent, node);
      }
    }

    return node;
  }

  /**
   * Create an edge between two nodes
   */
  createConnection(from, to) {
    // Check connection limits
    if (from.connections.length >= GRAPH_LIMITS.maxConnectionsPerNode ||
        to.connections.length >= GRAPH_LIMITS.maxConnectionsPerNode) {
      return null;
    }

    // Check if connection already exists
    const connectionId = `${from.id}-${to.id}`;
    if (this.connections.has(connectionId)) {
      return null;
    }

    try {
      // Create path for tube geometry
      const curve = new THREE.LineCurve3(from.position, to.position);
      const tubeGeometry = new THREE.TubeGeometry(
        curve,
        1,
        EDGE_CONFIG.radius,
        EDGE_CONFIG.segments,
        false
      );

      // Create material with emissive color and transparency
      const material = new THREE.MeshPhysicalMaterial({
        color: from.color,
        emissive: from.color,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        metalness: 0.2,
        roughness: 0.5,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1
      });

      const tube = new THREE.Mesh(tubeGeometry, material);
      this.scene.add(tube);

      const connection = {
        id: connectionId,
        from,
        to,
        mesh: tube,
        curve,
        createdAt: Date.now()
      };

      // Track connection
      this.connections.set(connectionId, connection);
      from.connections.push(connection);
      to.connections.push(connection);

      return connection;
    } catch (error) {
      console.error('Error creating connection:', error);
      return null;
    }
  }

  /**
   * Check for proximity-based connections
   */
  checkProximityConnections() {
    const nodeArray = Array.from(this.neurons.values());
    
    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const node1 = nodeArray[i];
        const node2 = nodeArray[j];
        
        // Skip if either node has reached max connections
        if (node1.connections.length >= GRAPH_LIMITS.maxConnectionsPerNode ||
            node2.connections.length >= GRAPH_LIMITS.maxConnectionsPerNode) {
          continue;
        }
        
        // Skip if connection already exists
        if (this.connections.has(`${node1.id}-${node2.id}`) || 
            this.connections.has(`${node2.id}-${node1.id}`)) {
          continue;
        }
        
        // Check distance
        const distance = node1.position.distanceTo(node2.position);
        if (distance <= GRAPH_LIMITS.proximityThreshold) {
          this.createConnection(node1, node2);
        }
      }
    }
  }

  /**
   * Update connections and physics
   */
  update() {
    const time = Date.now();
    const deltaTime = Math.min((time - this.lastUpdateTime) / 1000, 0.1);
    this.lastUpdateTime = time;
    
    // Clear forces
    for (const [id, force] of this.forces) {
      force.set(0, 0, 0);
    }
    
    // Calculate physics in fixed time steps for stability
    const fixedDt = 1/60; // 60 Hz physics update
    const iterations = Math.ceil(deltaTime / fixedDt);
    const iterationDt = deltaTime / iterations;

    for (let step = 0; step < iterations; step++) {
      // Calculate inter-node forces
      const nodeArray = Array.from(this.neurons.values());
      for (let i = 0; i < nodeArray.length; i++) {
        for (let j = i + 1; j < nodeArray.length; j++) {
          // Calculate base force
          const force = this.calculateForce(nodeArray[i], nodeArray[j]);
          
          // Apply to nodes (using iterationDt for stable integration)
          const nodeForce = force.clone().multiplyScalar(iterationDt);
          this.forces.get(nodeArray[i].id).add(nodeForce);
          this.forces.get(nodeArray[j].id).sub(nodeForce);
        }
      }
      
      // Handle spring forces between connections
      for (const connection of this.connections.values()) {
        const dx = connection.to.position.x - connection.from.position.x;
        const dy = connection.to.position.y - connection.from.position.y;
        const dz = connection.to.position.z - connection.from.position.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const direction = new THREE.Vector3(dx, dy, dz).normalize();
        
        // Combined spring and repulsion force
        const repelForce = PHYSICS_CONFIG.postConnectRepel / (distance * distance);
        const springForce = PHYSICS_CONFIG.springStrength * (PHYSICS_CONFIG.springLength - distance);
        const totalForce = springForce - repelForce;
        
        const force = direction.multiplyScalar(totalForce * iterationDt);
      
        // Apply to both nodes
        this.forces.get(connection.from.id).sub(force);
        this.forces.get(connection.to.id).add(force);
      }
    }
    
    // Update velocities and positions
    for (const node of this.neurons.values()) {
      const velocity = this.velocities.get(node.id);
      const force = this.forces.get(node.id);
      
      // Apply accumulated forces with proper time scaling
      force.add(new THREE.Vector3(0, -2, 0)); // Add gravity
      const scaledForce = force.clone().multiplyScalar(deltaTime);
      velocity.add(scaledForce);
      velocity.multiplyScalar(PHYSICS_CONFIG.damping);
      
      // Apply velocity limit
      const speed = velocity.length();
      if (speed > PHYSICS_CONFIG.maxVelocity) {
        velocity.multiplyScalar(PHYSICS_CONFIG.maxVelocity / speed);
      }

      // Add slight inward pull to keep nodes from drifting too far
      const distanceFromCenter = node.position.length();
      if (distanceFromCenter > 30) {
        const pullStrength = (distanceFromCenter - 30) * 0.1;
        velocity.sub(node.position.clone().normalize().multiplyScalar(pullStrength * deltaTime));
      }
      
      // Update position
      node.position.add(velocity.clone().multiplyScalar(deltaTime));
      node.mesh.position.copy(node.position);
      
      // Reset force accumulator
      force.set(0, 0, 0);
    }
    
    // Check for new connections based on proximity
    this.checkProximityConnections();
    
    // Update pulse animation
    this.pulsePhase = (this.pulsePhase + this.pulseSpeed) % (Math.PI * 2);
    const pulseFactor = 1.0 + Math.sin(this.pulsePhase) * this.pulseStrength;
    
    // Update nodes with generation-based phase offset
    for (const node of this.neurons.values()) {
      const nodePhase = this.pulsePhase + node.phaseOffset;
      if (node.mesh.material) {
        // Subtle glow variation (0.4 to 0.8 range)
        node.mesh.material.emissiveIntensity = 0.4 + 0.4 * Math.sin(nodePhase);
        // Very minimal scale change
        node.mesh.scale.setScalar(1.0 + Math.sin(nodePhase) * 0.01);
      }
    }

    // Update connections and their materials
    for (const connection of this.connections.values()) {
      // Update tube geometry to follow nodes
      const curve = new THREE.LineCurve3(
        connection.from.position,
        connection.to.position
      );
      
      const tubeGeometry = new THREE.TubeGeometry(
        curve,
        1,
        EDGE_CONFIG.radius,
        EDGE_CONFIG.segments,
        false
      );
      
      connection.mesh.geometry.dispose();
      connection.mesh.geometry = tubeGeometry;

      // Update connection visual state
      if (connection.mesh.material) {
        const fromPhase = this.pulsePhase + connection.from.phaseOffset;
        const toPhase = this.pulsePhase + connection.to.phaseOffset;
        const connPhase = (fromPhase + toPhase) / 2;
        
        // Base glow and opacity
        let emissiveBase = 0.4;
        let opacityBase = 0.4;
        
        // Subtle connection glow variation
        connection.mesh.material.emissiveIntensity = 0.3 + 0.3 * Math.sin(connPhase);
        connection.mesh.material.opacity = 0.5 + 0.2 * Math.sin(connPhase);
      }
    }
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.nodeGeometry.dispose();
    this.nodeMaterial.dispose();
    this.edgeGeometry.dispose();

    this.neurons.forEach(node => {
      node.mesh.geometry.dispose();
      node.mesh.material.dispose();
      this.scene.remove(node.mesh);
    });

    this.connections.forEach(conn => {
      conn.mesh.geometry.dispose();
      conn.mesh.material.dispose();
      this.scene.remove(conn.mesh);
    });

    this.neurons.clear();
    this.connections.clear();
    this.velocities.clear();
    this.forces.clear();
  }

  // Helpers for external use
  getNodes() {
    return Array.from(this.neurons.values());
  }

  getEdges() {
    return Array.from(this.connections.values());
  }
}
