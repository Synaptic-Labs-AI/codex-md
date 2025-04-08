<script>
  // No imports needed
</script>

<div class="about-container">
  <section class="about-section">
    <h1>About <span class="codex-md-brand">codex.md</span></h1>

    <p>
      <span class="codex-md-brand">codex.md</span> is an elegant, cross-platform desktop application developed by Synaptic Labs, and designed to convert various file formats into pristine Markdown for seamless integration with applications .md first applications like Obsidian. Built with Electron and Svelte, <span class="codex-md-brand">codex.md</span> bridges the gap between different content formats and your knowledge base.
    </p>

    <h2>Key Features</h2>
    <ul>
      <li>
        <strong>Multi-format Support</strong>: Convert documents (PDF, DOCX, PPTX), data files (CSV, XLSX), web content (URLs, parent pages), and multimedia (audio, video) to structured Markdown.
      </li>
      <li>
        <strong>Local Processing</strong>: Process most files locally without internet dependency, ensuring privacy and data security (Audio, Video and advanced PDFs require APIs).
      </li>
      <li>
        <strong>Intelligent Formatting</strong>: Preserve document structure, headings, tables, and formatting during conversion for high-fidelity output.
      </li>
      <li>
        <strong>Batch Processing</strong>: Convert multiple files at once with organized output files and proper metadata.
      </li>
      <li>
        <strong>AI Integration</strong>: Transcribe audio and video content, and use more advanced PDf processing using state-of-the-art AI technology (requires API key).
      </li>
    </ul>

    <h2>Development</h2>
    <p>
      <span class="codex-md-brand">codex.md</span> is an open-source project developed by Synaptic Labs, leveraging modern web technologies to create powerful desktop software. The application combines Electron for native desktop capabilities, Svelte for a responsive user interface, and Node.js for backend processing.
    </p>

    <h3>Contribution</h3>
    <p>
      We welcome contributions from the community! Visit our <a href="https://github.com/SynapticLabs/codex-md" target="_blank" rel="noopener noreferrer">GitHub repository</a> to get involved, submit issues, or create pull requests.
    </p>

    <h3>License</h3>
    <p>
      <span class="codex-md-brand">codex.md</span> is released under the MIT License, allowing for free use, modification, and distribution.
    </p>
  </section>

  <hr class="divider" />

  <div class="synaptic-banner">
    <img src="/synaptic-labs-logo.png" alt="Synaptic Labs Logo">
  </div>
  
  <section class="about-section">
    <h2>Our Mission</h2>
    <p class="mission-statement">
      "Powering equitable access to emerging technologies through education and integration"
    </p>

    <h2>What We Do</h2>
    <p>
      Synaptic Labs delivers specialized AI solutions and knowledge management tools to help organizations leverage emerging technologies:
    </p>
    
    <div class="bento-grid services-grid">
      <a href="https://www.synapticlabs.ai/agents" class="bento-card ai-card" target="_blank" rel="noopener noreferrer">
        <div class="card-emoji">🤖</div>
        <h3>AI Agents</h3>
        <p>Custom AI agents and automation solutions</p>
      </a>
      
      <a href="https://www.synapticlabs.ai/flows" class="bento-card flow-card" target="_blank" rel="noopener noreferrer">
        <div class="card-emoji">🔄</div>
        <h3>Flow Products</h3>
        <p>Guided knowledge workflows</p>
      </a>
      
      <a href="https://www.synapticlabs.ai/bootcamps" class="bento-card bootcamp-card" target="_blank" rel="noopener noreferrer">
        <div class="card-emoji">🎓</div>
        <h3>Bootcamps</h3>
        <p>Level up your skills with expert training</p>
      </a>
      
      <a href="https://blog.synapticlabs.ai" class="bento-card blog-card" target="_blank" rel="noopener noreferrer">
        <div class="card-emoji">📖</div>
        <h3>Blog</h3>
        <p>Latest insights and knowledge management tips</p>
      </a>
    </div>

    <h2>Connect With Us</h2>
    <div class="bento-container">
      <div class="contact-grid">
        <a href="https://www.synapticlabs.ai/about" class="contact-card website" target="_blank" rel="noopener noreferrer">
          <span class="contact-emoji">🌐</span>
          <span class="contact-name">About Us</span>
        </a>
        
        <a href="https://www.synapticlabs.ai/contact-us" class="contact-card contact" target="_blank" rel="noopener noreferrer">
          <span class="contact-emoji">📧</span>
          <span class="contact-name">Contact Us</span>
        </a>
      </div>
      
      <div class="social-grid">
        <a href="https://discord.gg/z5DgD5ZHNJ" class="social-card discord" target="_blank" rel="noopener noreferrer">
          <span class="social-emoji">💬</span>
          <span class="social-name">Discord</span>
        </a>
        
        <a href="https://www.linkedin.com/company/synaptic-labs/" class="social-card linkedin" target="_blank" rel="noopener noreferrer">
          <span class="social-emoji">💼</span>
          <span class="social-name">LinkedIn</span>
        </a>
        
        <a href="https://www.youtube.com/@SynapticLabs" class="social-card youtube" target="_blank" rel="noopener noreferrer">
          <span class="social-emoji">🎥</span>
          <span class="social-name">YouTube</span>
        </a>
        
        <a href="https://www.instagram.com/synapticlabs" class="social-card instagram" target="_blank" rel="noopener noreferrer">
          <span class="social-emoji">📸</span>
          <span class="social-name">Instagram</span>
        </a>
      </div>
    </div>
  </section>


  <div class="copyright">
    © 2025 Synaptic Labs. All rights reserved.
  </div>
</div>

<style>
  .about-container {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--spacing-md);
    color: var(--color-text);
    line-height: 1.6;
  }

  .about-section {
    margin-bottom: var(--spacing-xl);
  }

  h1 {
    font-size: var(--font-size-3xl);
    color: var(--color-prime);
    margin-bottom: var(--spacing-md);
    font-weight: 700;
    line-height: 1.2;
  }

  h2 {
    font-size: var(--font-size-xl);
    color: var(--color-fourth);
    margin-top: var(--spacing-lg);
    margin-bottom: var(--spacing-sm);
    font-weight: 600;
  }

  h3 {
    font-size: var(--font-size-lg);
    color: var(--color-text);
    margin-top: var(--spacing-md);
    margin-bottom: var(--spacing-xs);
    font-weight: 600;
  }

  p {
    margin-bottom: var(--spacing-md);
  }

  ul {
    margin-bottom: var(--spacing-md);
    padding-left: var(--spacing-lg);
  }

  li {
    margin-bottom: var(--spacing-xs);
  }

  /* codex.md brand styling */
  :global(.about-container .codex-md-brand) {
    font-weight: 700;
    background: linear-gradient(135deg, 
      #00A99D 0%,
      #00A99D 40%,
      #F7931E 100%
    );
    background-size: 400% 400%;
    animation: gradientFlow 8s ease infinite;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    display: inline-block;
  }

  @keyframes gradientFlow {
    0% {
      background-position: 0% 0%;
    }
    50% {
      background-position: 100% 100%;
    }
    100% {
      background-position: 0% 0%;
    }
  }

  strong {
    font-weight: 600;
    color: var(--color-text-emphasis);
  }

  a {
    color: var(--color-prime);
    text-decoration: none;
    transition: all 0.2s ease;
  }

  a:hover {
    color: var(--color-fourth);
    text-decoration: none;
  }

  .divider {
    border: 0;
    height: 1px;
    background: var(--color-border);
    margin: var(--spacing-xl) 0;
  }

  .synaptic-banner {
    text-align: center;
    margin: var(--spacing-xl) 0;
  }
  
  .synaptic-banner img {
    max-width: 300px;
  }

  .mission-statement {
    font-style: italic;
    font-weight: 500;
    color: var(--color-text-emphasis);
    text-align: center;
    padding: var(--spacing-md);
    border-left: 4px solid var(--color-prime);
    background: var(--color-surface);
    border-radius: var(--rounded-md);
  }

  /* Bento Grid Styles */
  .bento-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-md);
    margin: var(--spacing-lg) 0;
  }

  .bento-card {
    background-color: var(--color-surface);
    border-radius: var(--rounded-lg);
    padding: var(--spacing-lg);
    padding-bottom: calc(var(--spacing-lg) + 30px); /* Extra space for the "Learn More" text */
    box-shadow: var(--shadow-sm);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    text-decoration: none;
    color: var(--color-text);
    display: flex;
    flex-direction: column;
    border: 2px solid var(--color-border);
  }

  .bento-card {
    position: relative;
  }

  .bento-card:hover {
    transform: translateY(-5px);
    box-shadow: var(--shadow-md);
  }

  .bento-card:hover::after {
    content: "Learn More →";
    position: absolute;
    bottom: var(--spacing-sm);
    right: var(--spacing-sm);
    font-size: var(--font-size-xs);
    color: var(--color-prime);
    font-weight: var(--font-weight-medium);
    background-color: rgba(255, 255, 255, 0.9);
    padding: 4px 8px;
    border-radius: var(--rounded-sm);
    box-shadow: var(--shadow-sm);
  }

  .ai-card:hover::after {
    color: var(--color-prime);
  }

  .flow-card:hover::after {
    color: var(--color-second);
  }

  .card-emoji {
    font-size: 2.5rem;
    margin-bottom: var(--spacing-sm);
    text-align: center;
  }

  .bento-card h3 {
    color: var(--color-prime);
    margin-bottom: var(--spacing-xs);
    font-size: var(--font-size-lg);
  }

  .bento-card p {
    margin-bottom: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-light);
  }

  /* Service card specific colors */
  .ai-card {
    border-color: var(--color-prime);
  }

  .flow-card {
    border-color: var(--color-second);
  }

  .bootcamp-card {
    border-color: var(--color-fourth);
  }

  .blog-card {
    border-color: var(--color-fifth);
  }

  /* Contact and Social Section */
  .bento-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-lg);
    margin: var(--spacing-lg) 0;
  }

  .contact-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(1, 1fr);
    gap: var(--spacing-sm);
    width: 100%;
  }

  .contact-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-sm);
    border-radius: var(--rounded-md);
    text-decoration: none;
    color: var(--color-text);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    box-shadow: var(--shadow-sm);
    background-color: var(--color-surface);
    border: 2px solid;
    height: 100%;
  }

  .contact-card:hover {
    transform: translateY(-3px);
    box-shadow: var(--shadow-md);
  }

  .contact-emoji {
    font-size: 1.5rem;
    margin-bottom: var(--spacing-xs);
    text-align: center;
  }

  .contact-name {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }

  .website {
    border-color: var(--color-prime);
  }

  .website:hover {
    color: var(--color-prime);
  }

  .contact {
    border-color: var(--color-fourth);
  }

  .contact:hover {
    color: var(--color-fourth);
  }

  .social-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: var(--spacing-sm);
    width: 100%;
  }

  .social-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-sm);
    border-radius: var(--rounded-md);
    text-decoration: none;
    color: var(--color-text);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    box-shadow: var(--shadow-sm);
    background-color: var(--color-surface);
    border: 2px solid;
  }

  .social-card:hover {
    transform: translateY(-3px);
    box-shadow: var(--shadow-md);
  }

  .social-emoji {
    font-size: 1.5rem;
    margin-bottom: var(--spacing-xs);
    text-align: center;
  }

  .social-name {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }

  .linkedin {
    border-color: #0077B5;
  }

  .linkedin:hover {
    color: #0077B5;
  }

  .instagram {
    border-color: #E1306C;
  }

  .instagram:hover {
    color: #E1306C;
  }

  .discord {
    border-color: #5865F2;
  }

  .discord:hover {
    color: #5865F2;
  }

  .youtube {
    border-color: #FF0000;
  }

  .youtube:hover {
    color: #FF0000;
  }

  /* Responsive Adjustments */
  @media (max-width: 768px) {
    .bento-grid,
    .bento-container {
      grid-template-columns: 1fr;
    }

    .social-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 480px) {
    .social-grid {
      grid-template-columns: 1fr;
    }
  }

  .copyright {
    text-align: center;
    margin-top: var(--spacing-xl);
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
  }

  @media (max-width: 768px) {
    .about-container {
      padding: var(--spacing-sm);
    }

    h1 {
      font-size: var(--font-size-2xl);
    }

    h2 {
      font-size: var(--font-size-lg);
    }
  }

  /* High Contrast Mode */
  @media (prefers-contrast: high) {
    .mission-statement {
      border-left-width: 6px;
    }

    a {
      text-decoration: underline;
    }
  }
</style>
