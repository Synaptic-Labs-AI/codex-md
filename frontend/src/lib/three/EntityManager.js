/**
 * EntityManager.js
 * 
 * Manages the creation and rendering of nodes and edges in a knowledge graph visualization.
 * Handles the visual representation and state management of the graph structure.
 */

import * as THREE from 'three';

// Graph visualization limits
const GRAPH_LIMITS = {
  maxNodes: 50,
  maxConnectionsPerNode: 2,
  connectionChance: 0.5, // 50% chance to connect to another random node
  additionInterval: 3000 // Milliseconds between node additions
};

// Visual configurations
const NODE_CONFIG = {
  size: 2.0,      // Fixed size for all nodes
  segments: 16    // Smoother spheres
};

const EDGE_CONFIG = {
  radius: 0.2,    // Tube radius
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

    // Create shared geometries
    this.nodeGeometry = new THREE.SphereGeometry(
      NODE_CONFIG.size,
      NODE_CONFIG.segments,
      NODE_CONFIG.segments
    );

    // Create shared materials using MeshBasicMaterial for bright solid colors
    this.nodeMaterial = new THREE.MeshBasicMaterial({
      transparent: false,
      color: new THREE.Color(0x444444)
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

    // Create mesh for the node
    const mesh = new THREE.Mesh(this.nodeGeometry, material);

    // Position the node randomly within a sphere except for first node
    const radius = this.neurons.size === 0 ? 0 : Math.random() * 15 + 5; // Random radius (5-20), center for first node
    const phi = Math.random() * Math.PI * 2; // Random angle in XY plane
    const theta = Math.acos((Math.random() * 2) - 1); // Random angle in XZ plane
    
    const position = new THREE.Vector3(
      radius * Math.sin(theta) * Math.cos(phi),
      radius * Math.sin(theta) * Math.sin(phi),
      radius * Math.cos(theta)
    );
    mesh.position.copy(position);

    // Center camera on first node
    if (this.neurons.size === 0) {
      this.scene.position.set(0, 0, 0);
      if (this.scene.camera) {
        this.scene.camera.position.set(0, 15, 30);
        this.scene.camera.lookAt(0, 0, 0);
      }
    }

    // Create node object
    const node = {
      id,
      position: mesh.position,
      mesh,
      color,
      connections: [],
      groupId: parentId !== undefined ? this.neurons.get(parentId)?.groupId : this.nextGroupId++,
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
    
    // Random connections
    if (this.neurons.size > 1 && 
        Math.random() < GRAPH_LIMITS.connectionChance && 
        node.connections.length < GRAPH_LIMITS.maxConnectionsPerNode) {
      this.createRandomConnection(node);
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
        1, // segments
        EDGE_CONFIG.radius,
        EDGE_CONFIG.segments,
        false
      );

      // Create material with solid color
      const material = new THREE.MeshBasicMaterial({
        color: from.color,
        transparent: false
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
   * Create a random connection from a node to another existing node
   */
  createRandomConnection(sourceNode) {
    const availableNodes = Array.from(this.neurons.values()).filter(n => 
      n !== sourceNode && 
      !sourceNode.connections.some(c => c.to === n || c.from === n) &&
      n.connections.length < GRAPH_LIMITS.maxConnectionsPerNode
    );
    
    if (availableNodes.length > 0) {
      const targetNode = availableNodes[Math.floor(Math.random() * availableNodes.length)];
      this.createConnection(sourceNode, targetNode);
    }
  }

  /**
   * Update connections to follow node positions
   */
  update() {
    const time = Date.now();
    
    // Only update if enough time has passed
    if (time - this.lastUpdateTime >= GRAPH_LIMITS.additionInterval) {
      this.lastUpdateTime = time;
      
      // Update tube geometries to match node positions
      for (const connection of this.connections.values()) {
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
  }

  // Helpers for external use
  getNodes() {
    return Array.from(this.neurons.values());
  }

  getEdges() {
    return Array.from(this.connections.values());
  }
}
