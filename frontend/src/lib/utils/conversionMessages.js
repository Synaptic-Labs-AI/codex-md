/**
 * Conversion Messages
 * 
 * A collection of fun, entertaining messages to display during file conversions.
 * These messages are randomly selected and displayed in the ConversionProgress component
 * with a typing animation effect to make them appear more dynamic and engaging.
 * 
 * Messages now support rich text formatting using markdown-style syntax:
 * - **text** for bold text
 * - *text* for italic text
 * - # for headings (rendered as h3)
 * - [text](url) for links
 * 
 * Includes both general conversion messages and educational "Did you know?" messages
 * about Markdown to help users understand what Markdown is and how to use it.
 * 
 * Exports:
 * - conversionMessages: Array of all available messages
 * - getRandomMessage: Function that returns a random, formatted message
 * 
 * Related files:
 * - frontend/src/lib/components/ConversionProgress.svelte
 * - frontend/src/lib/components/common/ChatBubble.svelte
 */

/**
 * Formats a message with markdown-style syntax into HTML
 * @param {string} message - The message to format
 * @returns {string} HTML formatted message
 */
function formatMessage(message) {
  return message
    // Convert headings (only h3 for chat messages)
    .replace(/^# (.+)$/gm, '<h3>$1</h3>')
    // Convert bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Convert italics
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Convert links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="help-link" target="_blank" rel="noopener noreferrer">$1</a>')
    // Wrap text in paragraphs
    .split('\n')
    .map(line => line.trim() ? `<p>${line}</p>` : '')
    .join('');
}

export const conversionMessages = [
  // Original conversion messages
  "Converting digital knowledge to *markdown*... 🚀",
  "Transforming content into **readable** format... ✨",
  "Extracting the *essence* of your files... 💡",
  "Translating digital content to *markdown*... 🔄",
  "Processing your content with **care**... 🧠",
  "Organizing information for better **readability**... 📊",
  "Converting bytes to *beautiful* markdown... 💫",
  "Distilling **knowledge** from your files... 🔍",
  "Teaching robots to read your content... 🤖",
  "Turning complex data into **simple** markdown... 🧩",
  "Weaving words into *markdown magic*... ✨",
  "Crafting the **perfect** markdown output... 🛠️",
  "Polishing pixels into *perfect prose*... 🌟",
  "Decoding digital documents... 🔑",
  "Translating tech to text... 🌐",
  "Converting content at the *speed of light*... ⚡",
  "Turning information into **insight**... 💭",
  "Making your content more *accessible*... 🌈",
  "Preparing your **perfect** markdown files... 📝",
  "Transforming files with *markdown magic*... 🪄",
  
  // What Markdown is
  "# Quick Markdown Facts\nMarkdown is a *lightweight* markup language for creating **formatted text**! 📄",
  "# History Time\nMarkdown was created by **John Gruber** and **Aaron Swartz** in 2004! 📜",
  "# File Facts\nMarkdown files use the *.md* extension and are **plain text** files! 📋",
  "# Design Philosophy\nMarkdown is designed to be **readable** even in its *raw text* form! 👀",
  "# Wide Adoption\nMarkdown is widely used for **documentation**, *notes*, and web content! 🌐",
  
  // Markdown syntax basics
  "# Markdown Tips\nCreate headings with # symbols - more # means *smaller* headings! 📝",
  "# Styling Text\nMake text *italic* using single asterisks! 🖋️",
  "# Text Formatting\nMake text **bold** using double asterisks! 🖊️",
  "# List Making\nCreate lists using - or * symbols at the start of lines! 📋",
  "# Adding Links\nCreate links using [text](URL) syntax! 🔗",
  "# Image Support\nAdd images using ![alt text](image-url) syntax! 🖼️",
  "# Quote Blocks\nCreate blockquotes using the > symbol! 💬",
  "# Code Formatting\nCreate code blocks using triple backticks! 💻",
  
  // Obsidian-specific features
  "# Obsidian Links\nObsidian uses **[[double brackets]]** for *internal links* between notes! 🔄",
  "# Note Embedding\nEmbed notes within notes using **![[note name]]** syntax! 📑",
  "# Knowledge Graph\nObsidian can display your notes as a *visual knowledge graph*! 🕸️",
  "# Using Tags\nObsidian supports tags using the **#tag** syntax! 🏷️",
  "# Plugin Support\nObsidian has a **thriving** community of *open-source* plugins! 🔌",
  
  // Benefits of Markdown
  "# Future-Proof Notes\nMarkdown files are **future-proof** because they're just *plain text*! 🔮",
  "# Perfect for Notes\nMarkdown is **perfect** for note-taking because it's *quick to write* and *easy to read*! 📒",
  "# Universal Support\nMarkdown is supported by **thousands** of applications across all platforms! 🌍",
  "# Focus on Content\nMarkdown helps you focus on **content** instead of *formatting*! 🧠",
  "# Space Efficient\nMarkdown files are typically *much smaller* than formatted document files! 📦",

  // Knowledge Management Best Practices
  "# PARA Method\nUsing the **PARA** method (*Projects, Areas, Resources, Archives*) helps organize notes! 📁",
  "# Map of Content\nCreating **MOCs** (*Maps of Content*) helps navigate complex knowledge structures! 🗺️",
  "# Progressive Learning\n**Progressive summarization** helps distill knowledge into *actionable insights*! 📝",
  "# Atomic Notes\n**Atomic notes** (one idea per note) make knowledge more *reusable*! ⚛️",
  "# Connected Thinking\n**Bidirectional linking** creates a *network of connected thoughts*! 🕸️",
  "# Metadata Magic\n**Consistent metadata** helps track and organize your knowledge over time! 🏷️",
  "# Regular Reviews\n**Regular knowledge reviews** help *strengthen* your understanding! 🔄",
  "# Natural Growth\nTopic hierarchies can evolve *naturally* through **linked notes**! 📚",

  // Advanced Obsidian Features
  "# Power of Dataview\n**Obsidian Dataview** lets you create *dynamic content views*! 📊",
  "# Visual Thinking\n**Obsidian Canvas** helps *visualize* complex relationships! 🎨",
  "# Custom Styling\nUse **CSS snippets** to *customize* your Obsidian workspace! 💅",
  "# Template Power\n**Obsidian templates** can *automate* note creation! 🤖",
  "# Structured Data\n**Properties** help add *structured metadata* to your notes! 📋",
  "# Stay in Sync\n**Obsidian sync** keeps your knowledge base *consistent* across devices! 🔄",
  "# Share Knowledge\nPublish your notes as a **beautiful website** with [Obsidian Publish](https://obsidian.md/publish)! 🌐",

  // Modern PKM & AI Integration
  "# AI Analysis\n**AI** can help *analyze patterns* in your knowledge base! 🤖",
  "# Smart Summaries\n**LLMs** can generate *structured summaries* from your notes! 📊",
  "# Semantic Search\n**Knowledge graphs** enable *semantic search* of your notes! 🔍",
  "# Smart Connections\n**Machine learning** can suggest *relevant note connections*! 🧠",
  "# AI Assistance\n**AI assistants** can help *maintain* your knowledge base! 🤝",
  "# Vector Search\n**Vector embeddings** enable *semantic similarity search*! 🎯",
  "# Gap Analysis\n**AI** can help identify *knowledge gaps* in your notes! 🔍",
  "# Enhanced Learning\n**Modern PKM tools** integrate with *AI* for enhanced learning! 🚀",

  // Synaptic Labs Integration
  "# Flow Products\nSynaptic Labs offers [Flow products](https://www.synapticlabs.ai/flows) for **guided knowledge workflows**! 🔄",
  "# Optimize Your Workflow\nStreamline your process with our [Flow system](https://www.synapticlabs.ai/flows) for *enhanced productivity*! 🔄",
  
  "# Join Our Community\nJoin our [Discord community](https://discord.gg/z5DgD5ZHNJ) for **PKM tips** and *discussions*! 💬",
  "# Connect with Peers\nShare ideas in our [Discord space](https://discord.gg/z5DgD5ZHNJ) with fellow **knowledge enthusiasts**! 💬",
  
  "# AI Agents\nLearn about our [AI agents](https://www.synapticlabs.ai/agents) and **automations**! 🤖",
  "# Smart Automation\nDiscover how our [AI assistants](https://www.synapticlabs.ai/agents) can *transform* your workflow! 🤖",
  
  "# Level Up\nLevel up your skills with our [bootcamps](https://www.synapticlabs.ai/bootcamps)! 🎓",
  "# Skill Building\nAccelerate your learning through our intensive [training programs](https://www.synapticlabs.ai/bootcamps)! 🎓",
  
  "# Latest Insights\nRead our latest insights at [our blog](https://blog.synapticlabs.ai)! 📖",
  "# Knowledge Hub\nStay updated with fresh perspectives on our [blog](https://blog.synapticlabs.ai)! 📖",
  
  "# Tutorials & Tips\nGet tutorials and tips at our [YouTube channel](https://www.youtube.com/@SynapticLabs)! 🎥",
  "# Video Resources\nLearn visually through our [YouTube content](https://www.youtube.com/@SynapticLabs)! 🎥",
  
  "# About Us\nLearn more at [Synaptic Labs](https://www.synapticlabs.ai/about)! 🏢",
  "# Our Story\nDiscover what drives us at [Synaptic Labs](https://www.synapticlabs.ai/about)! 🏢",
  
  "# Contact Us\nHave questions? [Reach out](https://www.synapticlabs.ai/contact-us) to us! 📧",
  "# Get In Touch\nNeed assistance? [Contact our team](https://www.synapticlabs.ai/contact-us) for support! 📧"
];

/**
 * Returns a random message from the conversionMessages array
 * @returns {string} A randomly selected message, formatted with HTML
 */
export function getRandomMessage() {
  const randomIndex = Math.floor(Math.random() * conversionMessages.length);
  return formatMessage(conversionMessages[randomIndex]);
}
