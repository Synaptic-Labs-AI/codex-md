<!-- 
  Help.svelte - Help and instructions page
  Provides comprehensive documentation and FAQs for codex.md users.
  Migrated from SvelteKit routes to a standard Svelte component.
  
  Features:
  - Purpose and benefits explanation
  - Detailed conversion instructions
  - API key documentation
  - Resource links
  - Frequently asked questions
  
  Dependencies:
  - Container.svelte for layout
-->
<script>
  import Container from '../lib/components/common/Container.svelte';
</script>

<div class="help-page">
  <Container>
    <div class="help-content">
      <h1>Help & Instructions</h1>
      
      <section class="help-section">
        <h2>🎯 Purpose</h2>
        <p>
          <span class="codex-md-brand">codex.md</span> helps you convert your digital content into Markdown files optimized for
          <a href="https://obsidian.md/" target="_blank" rel="noopener noreferrer">Obsidian</a>,
          a powerful personal knowledge management system.
        </p>
        <p>By converting your content into Markdown, you're:</p>
        <ul>
          <li>Creating a portable, future-proof knowledge base</li>
          <li>Making your information more searchable and interconnected</li>
          <li>Preparing your data for local AI tools and Large Language Models</li>
          <li>Building a personal knowledge graph that you fully control</li>
        </ul>
      </section>

      <section class="help-section">
        <h2>🔍 Different Ways to Convert</h2>
        <ul>
          <li>
            <strong>Single Web Page</strong> - Just paste any website URL (like "<em>www.example.com/article</em>"). 
            This will convert just that one page into a note.
          </li>
          <li>
            <strong>Parent URL</strong> - If you want to convert multiple linked pages, use a parent URL. 
            For example, if you put in "<em>www.example.com/guide</em>", it will convert that page <strong>AND</strong> all the pages it links to.
          </li>
          <li>
            <strong>Files from Your Computer</strong> - Click the upload box or drag files into it. You can add:
            <ul class="sub-list">
              <li>Regular documents (like Word files or PDFs)</li>
              <li>Audio files (these need an API key)</li>
              <li>Video files (these need an API key)</li>
            </ul>
          </li>
        </ul>
      </section>      <section class="help-section">
        <h2>🔑 About API Keys</h2>
        <ul>
          <li>You need API keys for specific conversion features:
            <ul class="sub-list">
              <li><strong>Deepgram API key</strong> - Required for audio/video transcription</li>
              <li><strong>Mistral API key</strong> - Required for advanced OCR processing of PDF files</li>
            </ul>
          </li>
          <li>Get your API keys from:
            <ul class="sub-list">
              <li><a href="https://console.deepgram.com/signup" target="_blank" rel="noopener noreferrer">Deepgram's platform</a> - For audio/video transcription</li>
              <li><a href="https://console.mistral.ai/" target="_blank" rel="noopener noreferrer">Mistral's platform</a> - For OCR processing</li>
            </ul>
          </li>
          <li>You'll need to set up billing with these services, but usage is typically affordable</li>
          <li>Your API keys are stored securely on your device and persist between sessions</li>
          <li>Don't worry if you don't have these keys - you can still convert most documents without them!</li>
          <li><strong>Ready to add your API keys?</strong> <a href="#/settings" class="settings-link">Go to Settings →</a></li>
        </ul>
      </section>

      <section class="help-section">
        <h2>📝 Steps to Convert</h2>
        <ol>
          <li>Add your content (either paste a URL or upload files)</li>
          <li>If you're converting audio/video, add your API key when prompted</li>
          <li>Click the "<strong>Start Conversion</strong>" button</li>
          <li>Choose a folder to save your notes</li>
          <li>Wait for processing (this might take a minute)</li>
          
        </ol>
      </section>

      <section class="help-section resources-section">
        <h2>📚 Resources</h2>
        <p><strong>New to <span class="codex-md-brand">codex.md</span>?</strong> Check out these resources:</p>
        <ul>
          <li><a href="https://obsidian.md/" target="_blank" rel="noopener noreferrer">Download Obsidian</a> - Free personal knowledge base</li>
          <li><a href="https://www.youtube.com/watch?v=vdD2FB-bmiE&list=PLa9S_7NRneu-XYTNzCA8T_B3B37ZVrgxx" target="_blank" rel="noopener noreferrer">Build your second brain</a> - Video Tutorials</li>
          <li><a href="https://discord.gg/z5DgD5ZHNJ" target="_blank" rel="noopener noreferrer">Discord</a> - Community support</li>
          <li><a href="https://www.synapticlabs.ai" target="_blank" rel="noopener noreferrer">Synaptic Labs</a> - Work with Us</li>
        </ul>
      </section>

      <section class="help-section faq-section">
        <h2>❓ Frequently Asked Questions</h2>
        
        <div class="faq-item">
          <h3>What file types can I convert?</h3>
          <p><span class="codex-md-brand">codex.md</span> supports a wide range of file types:</p>
          <ul>
            <li><strong>Documents:</strong> PDF, DOCX, PPTX</li>
            <li><strong>Data:</strong> CSV, XLSX</li>
            <li><strong>Audio:</strong> MP3, WAV, M4A (requires API key)</li>
            <li><strong>Video:</strong> MP4, WEBM, AVI (requires API key)</li>
            <li><strong>Web:</strong> Any URL</li>
          </ul>
        </div>
        
        <div class="faq-item">
          <h3>Is my data secure?</h3>
          <p>Yes! <span class="codex-md-brand">codex.md</span> processes your files locally on your device. Your files never leave your computer unless you're using the API key for audio/video transcription or advanced PDF conversion, in which case only those specific files are sent to Deepgram's servers.</p>
        </div>

        <div class="faq-item">
          <h3>What happens to my API keys?</h3>
          <p>Your API keys are stored securely on your device using machine-specific encryption. They persist between sessions so you don't need to re-enter them each time. Your keys are never sent to us and are only used for the specific services they're intended for (Deepgram for transcription, Mistral for OCR).</p>
        </div>
        
        <div class="faq-item">
          <h3>Can I use this offline?</h3>
          <p>Mostly! The desktop version of <span class="codex-md-brand">codex.md</span> works offline for document conversions. Only audio/video transcription, web page conversion, and advanced PDF require an internet connection.</p>
        </div>
      </section>
    </div>
  </Container>
</div>

<style>
  /* Ensure the codex-md-brand class is properly styled */
  :global(.help-page .codex-md-brand) {
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

  .help-page {
    padding: var(--spacing-md) 0;
  }

  .help-content {
    max-width: 800px;
    margin: 0 auto;
  }

  h1 {
    font-size: var(--font-size-2xl);
    font-weight: 700;
    margin-bottom: var(--spacing-lg);
    color: var(--color-text);
    text-align: center;
    position: relative;
    padding-bottom: var(--spacing-sm);
  }

  h1::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100px;
    height: 3px;
    background: linear-gradient(90deg, var(--color-prime), var(--color-fourth));
    border-radius: var(--rounded-full);
  }

  .help-section {
    margin-bottom: var(--spacing-xl);
  }

  h2 {
    font-size: var(--font-size-xl);
    font-weight: 600;
    margin-bottom: var(--spacing-md);
    color: var(--color-text);
    position: relative;
    padding-left: var(--spacing-sm);
  }

  h2::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: linear-gradient(180deg, var(--color-prime), var(--color-fourth));
    border-radius: var(--rounded-full);
  }

  h3 {
    font-size: var(--font-size-lg);
    font-weight: 600;
    margin: var(--spacing-md) 0 var(--spacing-xs);
    color: var(--color-text);
  }

  p {
    margin-bottom: var(--spacing-sm);
    line-height: 1.6;
    color: var(--color-text);
  }

  ul, ol {
    margin: 0 0 var(--spacing-sm) 0;
    padding-left: var(--spacing-lg);
    line-height: 1.6;
  }

  .sub-list {
    margin-top: var(--spacing-2xs);
    padding-left: var(--spacing-md);
  }

  li {
    margin-bottom: var(--spacing-xs);
  }

  li:last-child {
    margin-bottom: 0;
  }

  strong {
    font-weight: 600;
    color: var(--color-text);
  }

  em {
    background: rgba(var(--color-prime-rgb), 0.05);
    padding: 0.2em 0.4em;
    border-radius: var(--rounded-sm);
    font-family: var(--font-mono);
    font-size: 0.9em;
    font-style: normal;
  }
  a {
    color: var(--color-prime);
    text-decoration: none;
    border-bottom: 1px solid var(--color-prime);
    transition: all 0.2s ease;
  }

  a:hover {
    color: var(--color-second);
    border-color: var(--color-second);
  }

  .settings-link {
    font-weight: 600;
    background: linear-gradient(135deg, var(--color-prime), var(--color-fourth));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    border-bottom: 2px solid var(--color-prime);
    padding: 0.2em 0.5em;
    border-radius: var(--rounded-sm);
    display: inline-block;
    background-color: rgba(var(--color-prime-rgb), 0.05);
  }

  .settings-link:hover {
    background-color: rgba(var(--color-prime-rgb), 0.1);
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(var(--color-prime-rgb), 0.2);
  }

  .resources-section {
    background: rgba(var(--color-prime-rgb), 0.05);
    padding: var(--spacing-md);
    border-radius: var(--rounded-md);
  }

  .resources-section h2 {
    margin-top: 0;
  }

  .faq-section {
    border-top: 1px solid var(--color-border);
    padding-top: var(--spacing-lg);
  }

  .faq-item {
    margin-bottom: var(--spacing-md);
    padding-bottom: var(--spacing-md);
    border-bottom: 1px solid var(--color-border-light);
  }

  .faq-item:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .faq-item h3 {
    margin-top: 0;
    color: var(--color-text);
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

  /* Mobile Adjustments */
  @media (max-width: 768px) {
    .help-page {
      padding: var(--spacing-sm) 0;
    }

    h1 {
      font-size: var(--font-size-xl);
      margin-bottom: var(--spacing-md);
    }

    h2 {
      font-size: var(--font-size-lg);
    }

    h3 {
      font-size: var(--font-size-base);
    }

    .help-section {
      margin-bottom: var(--spacing-lg);
    }
  }

  @media (max-width: 640px) {
    .help-page {
      padding: var(--spacing-xs) 0;
    }

    h1 {
      font-size: var(--font-size-lg);
      margin-bottom: var(--spacing-sm);
    }

    h2 {
      font-size: var(--font-size-base);
      margin-bottom: var(--spacing-sm);
    }

    h3 {
      font-size: var(--font-size-sm);
    }

    p, ul, ol {
      font-size: var(--font-size-sm);
    }

    .help-section {
      margin-bottom: var(--spacing-md);
    }

    .resources-section {
      padding: var(--spacing-sm);
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
