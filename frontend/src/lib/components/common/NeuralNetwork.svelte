<!-- 
  NeuralNetwork.svelte
  
  A creative visualization component that displays a growing neural network.
  Every 3 seconds, a new neuron is added, branching from an existing random neuron.
  Each neuron has a random color from the theme palette.
  
  Related files:
  - frontend/src/lib/components/ConversionProgress.svelte: Primary consumer
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  export let secondsCount = 0; // Track total seconds for growth timing
  export let keepAlive = false; // Whether to persist the network state
  
  // Constants for visual effects
  // Visual effects constants
  const PULSE_SCALE = 0.3; // Subtle pulse animation
  const SPECULAR_INTENSITY = 40; // Strong 3D highlight
  const SHADOW_OPACITY = 0.4; // Shadow depth
  const MIN_NEURON_SIZE = 1.5; // Smallest neuron radius
  const MAX_NEURON_SIZE = 4; // Largest neuron radius
  const MIN_DISTANCE = 35; // Minimum distance between neurons
  const MAX_DISTANCE = 75; // Maximum distance between neurons
  const PULSE_DELAY = 80; // Milliseconds between pulse propagation
  
  // Neural network state
  let pulseIntensity = 0; // For pulse animation
  let neuronActivity = {}; // Tracks which neurons are active
  let connectionOpacity = {}; // Tracks connection opacity
  
  // Theme colors for neurons
  const themeColors = [
    'var(--color-prime)',   // Persian Green
    'var(--color-second)',  // Dark Purple
    'var(--color-third)',   // Cello
    'var(--color-fourth)',  // Carrot Orange
    'var(--color-fifth)',   // Summer Sky
    'var(--color-success)', // Green
    'var(--color-warning)'  // Yellow
  ];
  
  // Get a random color from the theme
  function getRandomColor() {
    const randomIndex = Math.floor(Math.random() * themeColors.length);
    return themeColors[randomIndex];
  }
  
  // Particle system
  let particles = [];
  const MAX_PARTICLES = 30;
  
  // Generate random neural network paths
  const centerX = 50;
  const centerY = 50;
  const neurons = [];
  const connections = [];
  let nextNeuronId = 0;
  
  // Create a particle on a random connection
  function createParticle() {
    if (particles.length >= MAX_PARTICLES || connections.length === 0) return;
    
    // Select a random connection
    const connectionIndex = Math.floor(Math.random() * connections.length);
    const connection = connections[connectionIndex];
    
    const fromNeuron = neurons.find(n => n.id === connection.from);
    const toNeuron = neurons.find(n => n.id === connection.to);
    
    if (!fromNeuron || !toNeuron) return;
    
    // Create particle with position, velocity, and lifetime
    particles.push({
      id: Date.now() + Math.random(),
      connectionId: connection.id,
      progress: 0, // 0 to 1 along the path
      speed: 0.003 + Math.random() * 0.005, // Slower speed for more graceful movement
      size: 0.8 + Math.random() * 0.7,
      opacity: 0.4 + Math.random() * 0.4,
      from: fromNeuron,
      to: toNeuron,
      controlPoint: connection.controlPoint,
      // Use the source neuron's color for the particle
      color: fromNeuron.color
    });
  }
  
  // Update particle positions
  function updateParticles() {
    particles = particles.filter(particle => {
      // Update progress along path
      particle.progress += particle.speed;
      
      // Remove particles that have completed their journey
      return particle.progress < 1;
    });
    
    // Create new particles to maintain a good number
    if (connections.length > 0 && particles.length < MAX_PARTICLES * 0.5 && Math.random() > 0.9) {
      createParticle();
    }
  }
  
  // Calculate position along a quadratic bezier curve
  function getPointOnQuadraticCurve(p0, p1, p2, t) {
    const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
    const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
    return { x, y };
  }
  
  // Animation loop for particles
  let particleAnimationFrame;
  
  function animateParticles() {
    updateParticles();
    particleAnimationFrame = requestAnimationFrame(animateParticles);
  }
  
  // Create initial single neuron
  function createInitialNeuron() {
    // Central neuron
    const neuronId = nextNeuronId++;
    neurons.push({ 
      id: neuronId, 
      x: centerX, 
      y: centerY, 
      radius: 4, 
      active: false,
      createdAt: Date.now(),
      color: getRandomColor()
    });
    
    // Initialize neuron activity
    neuronActivity[neuronId] = 0;
  }
  
  // Count connections for each neuron
  function getConnectionCounts() {
    const counts = {};
    neurons.forEach(neuron => {
      counts[neuron.id] = 0;
    });
    
    connections.forEach(connection => {
      counts[connection.from] = (counts[connection.from] || 0) + 1;
    });
    
    return counts;
  }
  
  // Select a neuron with preference for those with fewer connections
  function selectNeuronForBranching() {
    if (neurons.length === 0) return null;
    
    // Get connection counts for weighting
    const connectionCounts = getConnectionCounts();
    
    // Calculate weights (inverse of connection count)
    const weights = neurons.map(neuron => {
      const count = connectionCounts[neuron.id] || 0;
      // Add 1 to avoid division by zero, and use inverse so fewer connections = higher weight
      return 1 / (count + 1);
    });
    
    // Calculate total weight
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    
    // Select a random point in the total weight
    let randomPoint = Math.random() * totalWeight;
    
    // Find the neuron at this weight point
    for (let i = 0; i < neurons.length; i++) {
      randomPoint -= weights[i];
      if (randomPoint <= 0) {
        return neurons[i];
      }
    }
    
    // Fallback to the last neuron (should rarely happen)
    return neurons[neurons.length - 1];
  }
  
  // Add a new neuron branching from an existing one
  function addNewNeuron() {
    if (neurons.length === 0) return;
    
    // Select a neuron to branch from with preference for those with fewer connections
    const fromNeuron = selectNeuronForBranching();
    if (!fromNeuron) return;
    
    // Create a random angle with more variation
    // Use a bias to encourage growth in different directions
    const baseAngle = Math.random() * 2 * Math.PI;
    const variation = (Math.random() - 0.5) * Math.PI / 2; // +/- 45 degrees
    const angle = baseAngle + variation;
    
    // More variable distance
    // Calculate distance based on depth (z-position affects apparent size)
    const zDepth = Math.random() * 20 - 10; // -10 to +10 for z-axis variation
    const distance = MIN_DISTANCE + Math.pow(Math.random(), 0.7) * (MAX_DISTANCE - MIN_DISTANCE);
    const apparentSize = 1 + (zDepth + 10) / 20; // Scale factor based on depth
    
    // Calculate new neuron position
    const x = fromNeuron.x + Math.cos(angle) * distance;
    const y = fromNeuron.y + Math.sin(angle) * distance;
    
    // Ensure the neuron stays within bounds (with some padding)
    const padding = 10;
    const boundedX = Math.max(padding, Math.min(100 - padding, x));
    const boundedY = Math.max(padding, Math.min(100 - padding, y));
    
    // Create the new neuron
    const newNeuronId = nextNeuronId++;
    neurons.push({ 
      id: newNeuronId, 
      x: boundedX, 
      y: boundedY, 
      radius: (MIN_NEURON_SIZE + Math.random() * (MAX_NEURON_SIZE - MIN_NEURON_SIZE)) * apparentSize,
      zDepth,
      active: false,
      createdAt: Date.now(),
      color: getRandomColor()
    });
    
    // Create a more pronounced control point for the curved path
    // Calculate midpoint
    const midX = (fromNeuron.x + boundedX) / 2;
    const midY = (fromNeuron.y + boundedY) / 2;
    
    // Calculate perpendicular vector to the connection line
    const dx = boundedX - fromNeuron.x;
    const dy = boundedY - fromNeuron.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    // Normalize and rotate 90 degrees
    const perpX = -dy / len;
    const perpY = dx / len;
    
    // Apply a random magnitude to the perpendicular vector
    const curveMagnitude = 1.5 + Math.random() * 2; // Reduced curves for even straighter connections
    
    // Create the control point with perpendicular offset from midpoint
    const controlPoint = {
      x: midX + perpX * curveMagnitude,
      y: midY + perpY * curveMagnitude
    };
    
    // Add the connection
    const connectionId = `${fromNeuron.id}-${newNeuronId}`;
    connections.push({
      id: connectionId,
      from: fromNeuron.id,
      to: newNeuronId,
      active: false,
      controlPoint,
      createdAt: Date.now()
    });
    
    // Initialize neuron activity and connection opacity
    neuronActivity[newNeuronId] = 1; // Start active
    connectionOpacity[connectionId] = 0.8; // Start visible
    
    // Animate the new neuron and connection
    setTimeout(() => {
      neuronActivity[newNeuronId] = 0;
      neuronActivity = { ...neuronActivity };
      
      connectionOpacity[connectionId] = 0.2;
      connectionOpacity = { ...connectionOpacity };
    }, 500);
    
    // Trigger a pulse from the source neuron
    neuronActivity[fromNeuron.id] = 1;
    neuronActivity = { ...neuronActivity };
    
    setTimeout(() => {
      neuronActivity[fromNeuron.id] = 0;
      neuronActivity = { ...neuronActivity };
    }, 300);
    
    // Add slight jitter to existing neurons to create a more organic feel
    applyNetworkJitter();
  }
  
  // Function to trigger a pulse through the network
  export function triggerPulse() {
    if (neurons.length === 0) return;
    
    // Start with the first neuron (central one)
    const firstNeuronId = neurons[0].id;
    neuronActivity[firstNeuronId] = 1;
    neuronActivity = { ...neuronActivity };
    
    // Propagate through connections with delays
    connections.forEach((connection, index) => {
      setTimeout(() => {
        connectionOpacity[connection.id] = 0.8;
        connectionOpacity = { ...connectionOpacity };
        
        // Activate the target neuron
        setTimeout(() => {
          neuronActivity[connection.to] = 1;
          neuronActivity = { ...neuronActivity };
          
          // Fade connection back to normal
          setTimeout(() => {
            connectionOpacity[connection.id] = 0.2;
            connectionOpacity = { ...connectionOpacity };
          }, 200);
          
          // Fade neuron back to normal
          setTimeout(() => {
            neuronActivity[connection.to] = 0;
            neuronActivity = { ...neuronActivity };
          }, 300);
        }, 100);
      }, index * PULSE_DELAY); // Slower pulse propagation
    });
    
    // Fade central neuron back to normal
    setTimeout(() => {
      neuronActivity[firstNeuronId] = 0;
      neuronActivity = { ...neuronActivity };
    }, 500);
  }
  
  // Add a new neuron every 3 seconds
  export function updateNetwork(newSecondsCount) {
    if (newSecondsCount !== secondsCount) {
      secondsCount = newSecondsCount;
      
      // Trigger pulse animation when seconds change
      triggerPulse();
      
      // Every 3 seconds, add new neurons
      if (secondsCount % 3 === 0) {
        // Occasionally add multiple branches from the same neuron
        // This creates more interesting tree-like structures
        const shouldBranchMultiple = Math.random() < 0.3 && neurons.length > 3;
        
        if (shouldBranchMultiple) {
          // Select a random neuron to branch from
          const branchNeuron = selectNeuronForBranching();
          if (branchNeuron) {
            // Add 2-3 branches from this neuron
            const branchCount = 2 + Math.floor(Math.random() * 2);
            
            // Store the original addNewNeuron function
            const originalAddNewNeuron = addNewNeuron;
            
            // Create a temporary function that forces specific angles for each branch
            // to ensure they spread out in different directions
            addNewNeuron = () => {
              if (neurons.length === 0) return;
              
              // Force this neuron as the parent for all branches
              const fromNeuron = branchNeuron;
              
              // Calculate base angle for this branch set
              // This ensures branches are evenly distributed around the parent
              const baseAngle = Math.random() * 2 * Math.PI;
              
              // For each branch, create a new neuron at a different angle
              for (let i = 0; i < branchCount; i++) {
                // Distribute angles evenly around the circle
                const angle = baseAngle + (i * 2 * Math.PI / branchCount);
                
                // Add some randomness to the angle
                const finalAngle = angle + (Math.random() - 0.5) * Math.PI / 4;
                
                // Calculate distance and depth for 3D effect
                const zDepth = Math.random() * 20 - 10; // -10 to +10 for z-axis variation
                const distance = MIN_DISTANCE + Math.pow(Math.random(), 0.7) * (MAX_DISTANCE - MIN_DISTANCE);
                const apparentSize = 1 + (zDepth + 10) / 20; // Scale factor based on depth
                
                // Calculate new neuron position
                const x = fromNeuron.x + Math.cos(finalAngle) * distance;
                const y = fromNeuron.y + Math.sin(finalAngle) * distance;
                
                // Ensure the neuron stays within bounds (with some padding)
                const padding = 10;
                const boundedX = Math.max(padding, Math.min(100 - padding, x));
                const boundedY = Math.max(padding, Math.min(100 - padding, y));
                
                // Create the new neuron
                const newNeuronId = nextNeuronId++;
                neurons.push({ 
                  id: newNeuronId, 
                  x: boundedX, 
                  y: boundedY, 
                  radius: (MIN_NEURON_SIZE + Math.random() * (MAX_NEURON_SIZE - MIN_NEURON_SIZE)) * apparentSize,
                  zDepth,
                  active: false,
                  createdAt: Date.now(),
                  color: getRandomColor()
                });
                
                // Create a more pronounced control point for the curved path
                // Calculate midpoint
                const midX = (fromNeuron.x + boundedX) / 2;
                const midY = (fromNeuron.y + boundedY) / 2;
                
                // Calculate perpendicular vector to the connection line
                const dx = boundedX - fromNeuron.x;
                const dy = boundedY - fromNeuron.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                
                // Normalize and rotate 90 degrees
                const perpX = -dy / len;
                const perpY = dx / len;
                
                // Apply a random magnitude to the perpendicular vector
                const curveMagnitude = 1.5 + Math.random() * 2; // Reduced curves for even straighter connections
                
                // Create the control point with perpendicular offset from midpoint
                const controlPoint = {
                  x: midX + perpX * curveMagnitude,
                  y: midY + perpY * curveMagnitude
                };
                
                // Add the connection
                const connectionId = `${fromNeuron.id}-${newNeuronId}`;
                connections.push({
                  id: connectionId,
                  from: fromNeuron.id,
                  to: newNeuronId,
                  active: false,
                  controlPoint,
                  createdAt: Date.now()
                });
                
                // Initialize neuron activity and connection opacity
                neuronActivity[newNeuronId] = 1; // Start active
                connectionOpacity[connectionId] = 0.8; // Start visible
                
                // Animate the new neuron and connection
                setTimeout(() => {
                  neuronActivity[newNeuronId] = 0;
                  neuronActivity = { ...neuronActivity };
                  
                  connectionOpacity[connectionId] = 0.2;
                  connectionOpacity = { ...connectionOpacity };
                }, 500);
              }
              
              // Trigger a pulse from the source neuron
              neuronActivity[fromNeuron.id] = 1;
              neuronActivity = { ...neuronActivity };
              
              setTimeout(() => {
                neuronActivity[fromNeuron.id] = 0;
                neuronActivity = { ...neuronActivity };
              }, 300);
              
              // Add slight jitter to existing neurons to create a more organic feel
              applyNetworkJitter();
            };
            
            // Call our temporary function once to create all branches
            addNewNeuron();
            
            // Restore the original function
            addNewNeuron = originalAddNewNeuron;
          }
        } else {
          // Regular single neuron addition
          addNewNeuron();
        }
      }
    }
  }
  
  // Apply slight jitter to existing neurons for a more organic feel
  function applyNetworkJitter() {
    // Skip the first (central) neuron to keep it stable
    if (neurons.length <= 1) return;
    
    // Apply small random movements to each neuron except the central one
    for (let i = 1; i < neurons.length; i++) {
      const neuron = neurons[i];
      
      // Skip the most recently added neuron
      if (neuron.id === nextNeuronId - 1) continue;
      
      // Calculate jitter amount (smaller for neurons closer to center)
      const distanceFromCenter = Math.sqrt(
        Math.pow(neuron.x - centerX, 2) + 
        Math.pow(neuron.y - centerY, 2)
      );
      
      // Scale jitter based on distance (more jitter for neurons further from center)
      const jitterScale = Math.min(0.5, distanceFromCenter / 100);
      const jitterAmount = 0.5 + jitterScale * 1.5;
      
      // Apply random jitter
      neuron.x += (Math.random() - 0.5) * jitterAmount;
      neuron.y += (Math.random() - 0.5) * jitterAmount;
      
      // Ensure neurons stay within bounds
      const padding = 5;
      neuron.x = Math.max(padding, Math.min(100 - padding, neuron.x));
      neuron.y = Math.max(padding, Math.min(100 - padding, neuron.y));
    }
    
    // Update control points for all connections to match the new neuron positions
    connections.forEach(connection => {
      const fromNeuron = neurons.find(n => n.id === connection.from);
      const toNeuron = neurons.find(n => n.id === connection.to);
      
      if (fromNeuron && toNeuron) {
        // Calculate midpoint
        const midX = (fromNeuron.x + toNeuron.x) / 2;
        const midY = (fromNeuron.y + toNeuron.y) / 2;
        
        // Calculate perpendicular vector
        const dx = toNeuron.x - fromNeuron.x;
        const dy = toNeuron.y - fromNeuron.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        
        if (len > 0) {
          // Normalize and rotate 90 degrees
          const perpX = -dy / len;
          const perpY = dx / len;
          
          // Keep the same curve magnitude but update the position
          const curveMagnitude = Math.sqrt(
            Math.pow(connection.controlPoint.x - midX, 2) + 
            Math.pow(connection.controlPoint.y - midY, 2)
          );
          
          // Update control point
          connection.controlPoint.x = midX + perpX * curveMagnitude;
          connection.controlPoint.y = midY + perpY * curveMagnitude;
        }
      }
    });
  }
  
  // Animation for gradient rotation
  let gradientRotation = 0;
  let animationFrame;
  
  function animateGradient() {
    gradientRotation = (gradientRotation + 0.2) % 360;
    animationFrame = requestAnimationFrame(animateGradient);
  }
  
  onMount(() => {
    // Create initial neuron
    createInitialNeuron();
    
    // Start gradient animation
    animateGradient();
    
    // Start particle animation
    animateParticles();
  });

  onDestroy(() => {
    // Only clean up animations, preserve network state if keepAlive is true
    if (animationFrame) cancelAnimationFrame(animationFrame);
    if (particleAnimationFrame) cancelAnimationFrame(particleAnimationFrame);
    
    if (!keepAlive) {
      // Reset state only if not keeping alive
      neurons.length = 0;
      connections.length = 0;
      particles.length = 0;
      neuronActivity = {};
      connectionOpacity = {};
      nextNeuronId = 0;
    }
  });
</script>

<div class="neural-network-container">
  <svg class="neural-network" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <!-- Gradient definitions -->
    <defs>
      <linearGradient id="neuronGradient" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate({gradientRotation} 0.5 0.5)">
        <stop offset="0%" stop-color="var(--color-prime)" />
        <stop offset="100%" stop-color="var(--color-second)" />
      </linearGradient>
      
      <!-- Enhanced 3D filters -->
      <filter id="neuron3D" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1" result="blur"/>
        <feOffset dx="2" dy="2" in="blur" result="shadow"/>
        <feFlood flood-color="black" flood-opacity="{SHADOW_OPACITY}" result="shadowColor"/>
        <feComposite in="shadowColor" in2="shadow" operator="in" result="shadowBlur"/>
        <feSpecularLighting in="blur" result="specOut" 
          specularExponent="{SPECULAR_INTENSITY}" 
          lighting-color="#ffffff">
          <fePointLight x="-20" y="-50" z="100"/>
        </feSpecularLighting>
        <feComposite in="SourceGraphic" in2="shadowBlur" operator="over" result="withShadow"/>
        <feComposite in="withShadow" in2="specOut" operator="arithmetic" 
          k1="0" k2="1" k3="1" k4="0"/>
      </filter>

      <!-- Particle glow effect -->
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.5" result="blur"/>
        <feFlood flood-color="#ffffff" flood-opacity="0.5"/>
        <feComposite in2="blur" operator="in"/>
        <feMerge>
          <feMergeNode/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>

      <filter id="connectionShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="1"/>
        <feOffset dx="1" dy="1" result="offsetblur"/>
        <feFlood flood-color="#000000" flood-opacity="0.3"/>
        <feComposite in2="offsetblur" operator="in"/>
        <feMerge>
          <feMergeNode/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    
    <!-- Neural network connections -->
    <g class="neural-connections">
      {#each connections as connection}
        {@const fromNeuron = neurons.find(n => n.id === connection.from)}
        {@const toNeuron = neurons.find(n => n.id === connection.to)}
        {@const opacity = connectionOpacity[connection.id] || 0.2}
        
        {#if fromNeuron && toNeuron}
          <!-- Create a unique gradient ID for each connection -->
          {@const gradientId = `connection-gradient-${connection.id}`}
          
          <!-- Define a gradient for this connection -->
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color={fromNeuron.color} />
            <stop offset="100%" stop-color={toNeuron.color} />
          </linearGradient>
          
          <path
            class="neural-connection"
            d="M {fromNeuron.x} {fromNeuron.y} Q {connection.controlPoint.x} {connection.controlPoint.y} {toNeuron.x} {toNeuron.y}"
            stroke={`url(#${gradientId})`}
            stroke-width="1"
            fill="none"
            opacity={opacity}
          />
        {/if}
      {/each}
    </g>
    
    <!-- Neural network nodes -->
    <g class="neural-nodes">
      {#each neurons as neuron}
        {@const activity = neuronActivity[neuron.id] || 0}
        <circle
          class="neuron"
          cx={neuron.x}
          cy={neuron.y}
          r={neuron.radius * (1 + activity * PULSE_SCALE)}
          fill={neuron.color}
          opacity={0.3 + activity * 0.7}
          filter={activity > 0 ? "url(#neuron3D)" : "url(#connectionShadow)"}
          style="--z-depth: {neuron.zDepth || 0}px"
        />
      {/each}
    </g>
    
    <!-- Particles moving along connections -->
    <g class="particles">
      {#each particles as particle}
        {@const position = getPointOnQuadraticCurve(
          particle.from,
          particle.controlPoint,
          particle.to,
          particle.progress
        )}
        <circle
          class="particle"
          cx={position.x}
          cy={position.y}
          r={particle.size}
          fill={particle.color}
          opacity={particle.opacity}
          filter="url(#glow)"
          style="animation: particle-pulse {1 + Math.random()}s infinite ease-in-out; animation-delay: {Math.random() * 2}s"
        />
      {/each}
    </g>
  </svg>
</div>

<style>
  .neural-network-container {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 400px;
    height: 400px;
    margin: 0 auto;
    overflow: visible;
    perspective: 1000px;
    transform-style: preserve-3d;
  }
  
  .neural-network {
    position: absolute;
    width: 100%;
    height: 100%;
    transform: rotateX(15deg) rotateY(-10deg);
    transform-style: preserve-3d;
  }

  .neural-connection {
    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    transform-style: preserve-3d;
    will-change: opacity, stroke-width;
  }
  
  .neuron {
    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    transform-style: preserve-3d;
    transform: translateZ(var(--z-depth, 0));
    will-change: transform, opacity, r;
  }
  
  .particle {
    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    transform-style: preserve-3d;
    will-change: opacity, transform;
  }
  
  @keyframes particle-pulse {
    0% {
      opacity: 0.2;
      r: 0.5;
    }
    50% {
      opacity: 0.8;
      r: 1.2;
    }
    100% {
      opacity: 0.2;
      r: 0.5;
    }
  }


  @media (max-width: 640px) {
    .neural-network-container {
      width: 300px;
      height: 300px;
    }
  }
</style>
