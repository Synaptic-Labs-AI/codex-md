<!-- src/lib/components/common/Timer.svelte -->
<!--
  Neural Network Timer Component
  
  A creative timer visualization that displays elapsed time with a neural network
  that grows and becomes more active as time passes. Each second triggers a pulse
  through the network, and new connections form over time.
  
  Related files:
  - frontend/src/lib/stores/conversionTimer.js: Timer functionality
  - frontend/src/lib/components/ConversionProgress.svelte: Primary consumer
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  export let time = '00:00:00';
  export let label = 'Time elapsed';
  
  let hours = '00';
  let minutes = '00';
  let seconds = '00';
  let prevSeconds = '00';
  let circumference = 2 * Math.PI * 47; // Circle radius is 47
  let dashOffset = circumference;
  
  // Neural network state
  let networkComplexity = 1; // Increases over time
  let pulseIntensity = 0; // For pulse animation
  let neuronActivity = {}; // Tracks which neurons are active
  let connectionOpacity = {}; // Tracks connection opacity
  
  // Particle system
  let particles = [];
  const MAX_PARTICLES = 30;
  
  // Create a particle on a random connection
  function createParticle() {
    if (particles.length >= MAX_PARTICLES) return;
    
    // Select a random connection
    const connectionIndex = Math.floor(Math.random() * connections.length);
    const connection = connections[connectionIndex];
    
    const fromNeuron = neurons.find(n => n.id === connection.from);
    const toNeuron = neurons.find(n => n.id === connection.to);
    
    // Create particle with position, velocity, and lifetime
    particles.push({
      id: Date.now() + Math.random(),
      connectionId: connection.id,
      progress: 0, // 0 to 1 along the path
      speed: 0.005 + Math.random() * 0.01, // Random speed
      size: 0.8 + Math.random() * 0.7,
      opacity: 0.4 + Math.random() * 0.4,
      from: fromNeuron,
      to: toNeuron,
      controlPoint: connection.controlPoint
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
    if (particles.length < MAX_PARTICLES * (0.3 + networkComplexity * 0.2) && Math.random() > 0.9) {
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
  
  // Generate random neural network paths
  const centerX = 50;
  const centerY = 50;
  const neurons = [];
  const connections = [];
  
  // Create initial neurons (fixed positions)
  const createInitialNetwork = () => {
    // Central neuron
    neurons.push({ id: 0, x: centerX, y: centerY, radius: 4, active: false });
    
    // First layer neurons (8 neurons in a circle)
    const firstLayerRadius = 25;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * 2 * Math.PI;
      const x = centerX + Math.cos(angle) * firstLayerRadius;
      const y = centerY + Math.sin(angle) * firstLayerRadius;
      neurons.push({ id: i + 1, x, y, radius: 2.5, active: false });
      
      // Connect to central neuron
      connections.push({
        id: `0-${i + 1}`,
        from: 0,
        to: i + 1,
        active: false,
        controlPoint: {
          x: centerX + Math.cos(angle) * firstLayerRadius * 0.5,
          y: centerY + Math.sin(angle) * firstLayerRadius * 0.5
        }
      });
    }
    
    // Second layer neurons (12 neurons in a larger circle)
    const secondLayerRadius = 40;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * 2 * Math.PI;
      const x = centerX + Math.cos(angle) * secondLayerRadius;
      const y = centerY + Math.sin(angle) * secondLayerRadius;
      const id = i + 9;
      neurons.push({ id, x, y, radius: 2, active: false });
      
      // Connect to random neurons from first layer
      const connectTo = Math.floor(Math.random() * 8) + 1;
      connections.push({
        id: `${connectTo}-${id}`,
        from: connectTo,
        to: id,
        active: false,
        controlPoint: {
          x: (neurons[connectTo].x + x) / 2 + (Math.random() * 10 - 5),
          y: (neurons[connectTo].y + y) / 2 + (Math.random() * 10 - 5)
        }
      });
    }
    
    // Initialize neuron activity and connection opacity
    neurons.forEach(n => {
      neuronActivity[n.id] = 0;
    });
    
    connections.forEach(c => {
      connectionOpacity[c.id] = 0.2;
    });
  };
  
  createInitialNetwork();
  
  // Function to add new connections based on time
  function addNewConnections() {
    // Only add new connections up to a reasonable limit
    if (connections.length < 50) {
      // Pick two random neurons that aren't already connected
      const fromIndex = Math.floor(Math.random() * neurons.length);
      let toIndex;
      do {
        toIndex = Math.floor(Math.random() * neurons.length);
      } while (toIndex === fromIndex);
      
      const fromId = neurons[fromIndex].id;
      const toId = neurons[toIndex].id;
      
      // Check if connection already exists
      const connectionExists = connections.some(
        c => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)
      );
      
      if (!connectionExists) {
        const fromNeuron = neurons[fromIndex];
        const toNeuron = neurons[toIndex];
        
        // Create a control point for the curved path
        const controlPoint = {
          x: (fromNeuron.x + toNeuron.x) / 2 + (Math.random() * 20 - 10),
          y: (fromNeuron.y + toNeuron.y) / 2 + (Math.random() * 20 - 10)
        };
        
        // Add the new connection
        const newConnection = {
          id: `${fromId}-${toId}`,
          from: fromId,
          to: toId,
          active: false,
          controlPoint
        };
        
        connections.push(newConnection);
        connectionOpacity[newConnection.id] = 0;
        
        // Animate the new connection appearing
        let opacity = 0;
        const fadeIn = setInterval(() => {
          opacity += 0.05;
          if (opacity >= 0.2) {
            clearInterval(fadeIn);
            opacity = 0.2;
          }
          connectionOpacity[newConnection.id] = opacity;
          connectionOpacity = { ...connectionOpacity };
        }, 50);
      }
    }
  }
  
  // Function to trigger a pulse through the network
  function triggerPulse() {
    // Start with the central neuron
    neuronActivity[0] = 1;
    
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
      }, index * 50); // Stagger the pulses
    });
    
    // Fade central neuron back to normal
    setTimeout(() => {
      neuronActivity[0] = 0;
      neuronActivity = { ...neuronActivity };
    }, 500);
  }
  
  // Update time segments and trigger animations
  $: {
    const [newHours, newMinutes, newSeconds] = time.split(':');
    
    // Check if seconds changed
    if (newSeconds !== seconds) {
      prevSeconds = seconds;
      
      // Trigger pulse animation when seconds change
      triggerPulse();
      
      // Every 10 seconds, add new connections
      if (parseInt(newSeconds) % 10 === 0 && newSeconds !== '00') {
        addNewConnections();
      }
      
      // Every minute, increase complexity
      if (newSeconds === '00' && (newMinutes !== '00' || newHours !== '00')) {
        networkComplexity += 0.2;
        
        // Trigger a larger pulse
        pulseIntensity = 1;
        setTimeout(() => {
          pulseIntensity = 0;
        }, 1000);
      }
    }
    
    hours = newHours;
    minutes = newMinutes;
    seconds = newSeconds;
    
    // Calculate progress for the circle (based on seconds in a minute)
    const progress = parseInt(seconds) / 60;
    dashOffset = circumference * (1 - progress);
  }
  
  // Animation for gradient rotation
  let gradientRotation = 0;
  let animationFrame;
  
  function animateGradient() {
    gradientRotation = (gradientRotation + 0.2) % 360;
    animationFrame = requestAnimationFrame(animateGradient);
  }
  
  onMount(() => {
    // Start gradient animation
    animateGradient();
    
    // Start particle animation
    animateParticles();
    
    // Create initial particles
    for (let i = 0; i < 5; i++) {
      createParticle();
    }
    
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (particleAnimationFrame) cancelAnimationFrame(particleAnimationFrame);
    };
  });
</script>

<div class="timer-container" role="timer" aria-label={label}>
  <svg class="timer-circle" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <!-- Gradient definitions -->
    <defs>
      <linearGradient id="circleGradient" gradientTransform="rotate({gradientRotation} 0.5 0.5)">
        <stop offset="0%" stop-color="var(--color-prime)" />
        <stop offset="50%" stop-color="var(--color-fourth)" />
        <stop offset="100%" stop-color="var(--color-prime)" />
      </linearGradient>
      
      <linearGradient id="neuronGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="var(--color-prime)" />
        <stop offset="100%" stop-color="var(--color-second)" />
      </linearGradient>
      
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    
    <!-- Background circle -->
    <circle
      class="timer-circle-bg"
      cx="50"
      cy="50"
      r="47"
      fill="none"
      stroke="var(--color-border)"
      stroke-width="2"
    />
    
    <!-- Progress circle -->
    <circle
      class="timer-circle-progress"
      cx="50"
      cy="50"
      r="47"
      fill="none"
      stroke="url(#circleGradient)"
      stroke-width="3"
      stroke-dasharray={circumference}
      stroke-dashoffset={dashOffset}
      stroke-linecap="round"
      transform="rotate(-90 50 50)"
    />
    
    <!-- Neural network connections -->
    <g class="neural-connections">
      {#each connections as connection}
        {@const fromNeuron = neurons.find(n => n.id === connection.from)}
        {@const toNeuron = neurons.find(n => n.id === connection.to)}
        {@const opacity = connectionOpacity[connection.id] || 0.2}
        
        <path
          class="neural-connection"
          d="M {fromNeuron.x} {fromNeuron.y} Q {connection.controlPoint.x} {connection.controlPoint.y} {toNeuron.x} {toNeuron.y}"
          stroke="url(#neuronGradient)"
          stroke-width="1"
          fill="none"
          opacity={opacity}
        />
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
          r={neuron.radius * (1 + activity * 0.5) * (neuron.id === 0 ? networkComplexity * 0.2 + 1 : 1)}
          fill="url(#neuronGradient)"
          opacity={0.3 + activity * 0.7}
          filter={activity > 0 ? "url(#glow)" : ""}
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
          fill="var(--color-fifth)"
          opacity={particle.opacity}
          filter="url(#glow)"
          style="animation: particle-pulse {1 + Math.random()}s infinite ease-in-out; animation-delay: {Math.random() * 2}s"
        />
      {/each}
    </g>
    
    <!-- Pulse effect -->
    {#if pulseIntensity > 0}
      <circle
        class="pulse-effect"
        cx="50"
        cy="50"
        r="30"
        fill="none"
        stroke="var(--color-fourth)"
        stroke-width="2"
        opacity={pulseIntensity}
      />
    {/if}
  </svg>
  
  <div class="timer-content">
    <div class="time-display">
      <span class="time-segment">{hours}</span>
      <span class="separator">:</span>
      <span class="time-segment">{minutes}</span>
      <span class="separator">:</span>
      <span class="time-segment">{seconds}</span>
    </div>
  </div>
</div>

<style>
  .timer-container {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 200px;
    height: 200px;
    margin: 0 auto;
  }

  .timer-circle {
    position: absolute;
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }

  .timer-circle-bg {
    opacity: 0.1;
  }

  .timer-circle-progress {
    transition: stroke-dashoffset 0.3s ease;
  }

  .timer-content {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    z-index: 1;
  }

  .time-display {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: var(--font-size-lg);
    color: var(--color-text);
    background-color: rgba(251, 247, 241, 0.5); /* Light mode: based on --color-surface: #fbf7f1 */
    backdrop-filter: blur(8px);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--rounded-full);
    box-shadow: var(--shadow-sm);
    border: 1px solid rgba(var(--color-prime-rgb), 0.2);
    transition: all 0.3s ease;
  }
  
  .time-display:hover {
    background-color: rgba(251, 247, 241, 0.7);
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }
  
  /* Dark mode support */
  @media (prefers-color-scheme: dark) {
    .time-display {
      background-color: rgba(42, 42, 42, 0.5); /* Dark mode: based on --color-surface: #1a1a1a in dark mode */
      border: 1px solid rgba(var(--color-prime-rgb), 0.3);
    }
    
    .time-display:hover {
      background-color: rgba(42, 42, 42, 0.7);
    }
  }

  .time-segment {
    min-width: 1.8em;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    background: linear-gradient(135deg,
      var(--color-prime) 0%,
      var(--color-fourth) 100%
    );
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .separator {
    color: var(--color-text-light);
    font-weight: 300;
    opacity: 0.4;
    margin: 0 2px;
  }
  
  .neural-connection {
    transition: opacity 0.3s ease;
  }
  
  .neuron {
    transition: r 0.3s ease, opacity 0.3s ease;
  }
  
  .particle {
    transition: opacity 0.2s ease;
  }
  
  .pulse-effect {
    animation: pulse 1s ease-out;
  }
  
  @keyframes pulse {
    0% {
      opacity: 0.8;
      r: 10;
    }
    100% {
      opacity: 0;
      r: 50;
    }
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
    .timer-container {
      width: 150px;
      height: 150px;
    }

    .time-display {
      font-size: var(--font-size-base);
      padding: var(--spacing-xs);
    }
  }
</style>
