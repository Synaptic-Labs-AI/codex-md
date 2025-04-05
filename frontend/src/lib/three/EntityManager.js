/**
 * EntityManager.js
 * 
 * Manages the creation and rendering of nodes and edges in a knowledge graph visualization.
 * Handles the visual representation and state management of the graph structure.
 */

import * as THREE from 'three';

// Physics configuration
const PHYSICS_CONFIG = {
  repelStrength: 15,     // Increased same-color repulsion
  attractStrength: 8,    // Increased different-color attraction
  springStrength: 0.3,   // Stronger spring connections
  springLength: 10,      // Longer rest length for more spacing
  damping: 0.9,         // Higher damping for smoother motion
  maxVelocity: 1.5,     // Slower maximum velocity
  minDistance: 3        // Larger minimum distance
};

// Graph visualization limits
const GRAPH_LIMITS = {
  maxNodes: 50,
  maxConnectionsPerNode: 4,
  proximityThreshold: 4, // Shorter distance for connections to keep graph sparse
  additionInterval: 3000 // Milliseconds between node additions
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
      color: new THREE.Color(0x222222),
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

  // Helper method to calculate force between two nodes
  calculateForce(node1, node2) {
    const dx = node2.position.x - node1.position.x;
    const dy = node2.position.y - node1.position.y;
    const dz = node2.position.z - node1.position.z;
    
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance === 0) return new THREE.Vector3();
    
    // Calculate force magnitude
    let forceMagnitude;
    if (node1.color.equals(node2.color)) {
      // Repulsion for same color
      forceMagnitude = -PHYSICS_CONFIG.repelStrength / Math.pow(distance, 2);
    } else {
      // Attraction for different colors
      forceMagnitude = PHYSICS_CONFIG.attractStrength / Math.pow(distance, 2);
    }
    
    // Prevent extreme forces at very close distances
    if (distance < PHYSICS_CONFIG.minDistance) {
      forceMagnitude *= (distance / PHYSICS_CONFIG.minDistance);
    }
    
    // Create force vector
    return new THREE.Vector3(dx, dy, dz).normalize().multiplyScalar(forceMagnitude);
  }

  // Helper method to calculate spring forces for connections
  calculateSpringForce(connection) {
    const dx = connection.to.position.x - connection.from.position.x;
    const dy = connection.to.position.y - connection.from.position.y;
    const dz = connection.to.position.z - connection.from.position.z;
    
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance === 0) return new THREE.Vector3();
    
    const displacement = distance - PHYSICS_CONFIG.springLength;
    const forceMagnitude = PHYSICS_CONFIG.springStrength * displacement;
    
    return new THREE.Vector3(dx, dy, dz).normalize().multiplyScalar(forceMagnitude);
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

    // Create material instance for the node
    const material = this.nodeMaterial.clone();
    material.color = color;
    material.emissive = color;

    // Create mesh for the node
    const mesh = new THREE.Mesh(this.nodeGeometry, material);

    // Position the node randomly within a sphere except for first node
    const radius = this.neurons.size === 0 ? 0 : Math.random() * 15 + 5;
    const phi = Math.random() * Math.PI * 2;
    const theta = Math.acos((Math.random() * 2) - 1);
    
    const position = new THREE.Vector3(
      radius * Math.sin(theta) * Math.cos(phi),
      radius * Math.sin(theta) * Math.sin(phi),
      radius * Math.cos(theta)
    );
    mesh.position.copy(position);

    // Initialize physics properties
    const velocity = new THREE.Vector3();
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
    
    // Calculate forces between all nodes
    const nodeArray = Array.from(this.neurons.values());
    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const force = this.calculateForce(nodeArray[i], nodeArray[j]);
        this.forces.get(nodeArray[i].id).add(force);
        this.forces.get(nodeArray[j].id).sub(force);
      }
    }
    
    // Calculate spring forces for connections
    for (const connection of this.connections.values()) {
      const springForce = this.calculateSpringForce(connection);
      this.forces.get(connection.from.id).sub(springForce);
      this.forces.get(connection.to.id).add(springForce);
    }
    
    // Update velocities and positions
    for (const node of this.neurons.values()) {
      const velocity = this.velocities.get(node.id);
      const force = this.forces.get(node.id);
      
      // Update velocity with force and damping
      velocity.add(force.multiplyScalar(deltaTime));
      velocity.multiplyScalar(PHYSICS_CONFIG.damping);
      
      // Cap maximum velocity
      if (velocity.length() > PHYSICS_CONFIG.maxVelocity) {
        velocity.normalize().multiplyScalar(PHYSICS_CONFIG.maxVelocity);
      }
      
      // Update position
      node.position.add(velocity.clone().multiplyScalar(deltaTime));
      node.mesh.position.copy(node.position);
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
        // More dramatic glow variation
        node.mesh.material.emissiveIntensity = 0.6 + 1.0 * Math.sin(nodePhase);
        // Minimal scale change
        node.mesh.scale.setScalar(1.0 + Math.sin(nodePhase) * this.pulseStrength);
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

      // Update connection material
      if (connection.mesh.material) {
        const fromPhase = this.pulsePhase + connection.from.phaseOffset;
        const toPhase = this.pulsePhase + connection.to.phaseOffset;
        const connPhase = (fromPhase + toPhase) / 2;
        
        // Match node glow intensity for connections
        connection.mesh.material.emissiveIntensity = 0.4 + 0.8 * Math.sin(connPhase);
        connection.mesh.material.opacity = 0.4 + 0.4 * Math.sin(connPhase);
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
