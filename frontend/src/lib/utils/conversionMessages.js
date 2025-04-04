/**
 * Conversion Messages
 * 
 * A collection of fun, entertaining messages to display during file conversions.
 * These messages are randomly selected and displayed in the ConversionProgress component
 * with a typing animation effect to make them appear more dynamic and engaging.
 * 
 * Includes both general conversion messages and educational "Did you know?" messages
 * about Markdown to help users understand what Markdown is and how to use it.
 * 
 * Exports:
 * - conversionMessages: Array of all available messages
 * - getRandomMessage: Function that returns a random message from the array
 * 
 * Related files:
 * - frontend/src/lib/components/ConversionProgress.svelte
 */

export const conversionMessages = [
  // Original conversion messages
  "Converting digital knowledge to markdown... 🚀",
  "Transforming content into readable format... ✨",
  "Extracting the essence of your files... 💡",
  "Translating digital content to markdown... 🔄",
  "Processing your content with care... 🧠",
  "Organizing information for better readability... 📊",
  "Converting bytes to beautiful markdown... 💫",
  "Distilling knowledge from your files... 🔍",
  "Teaching robots to read your content... 🤖",
  "Turning complex data into simple markdown... 🧩",
  "Weaving words into markdown magic... ✨",
  "Crafting the perfect markdown output... 🛠️",
  "Polishing pixels into perfect prose... 🌟",
  "Decoding digital documents... 🔑",
  "Translating tech to text... 🌐",
  "Converting content at the speed of light... ⚡",
  "Turning information into insight... 💭",
  "Making your content more accessible... 🌈",
  "Preparing your perfect markdown files... 📝",
  "Transforming files with markdown magic... 🪄",
  
  // What Markdown is
  "Did you know? Markdown is a lightweight markup language for creating formatted text! 📄",
  "Did you know? Markdown was created by John Gruber and Aaron Swartz in 2004! 📜",
  "Did you know? Markdown files use the .md extension and are plain text files! 📋",
  "Did you know? Markdown is designed to be readable even in its raw text form! 👀",
  "Did you know? Markdown is widely used for documentation, notes, and web content! 🌐",
  
  // Markdown syntax basics
  "Did you know? In Markdown, you create headings with # symbols - more # means smaller headings! 📝",
  "Did you know? You can make text *italic* by surrounding it with single asterisks! 🖋️",
  "Did you know? You can make text **bold** by surrounding it with double asterisks! 🖊️",
  "Did you know? You can create lists in Markdown using - or * symbols at the start of lines! 📋",
  "Did you know? You can create links in Markdown using [text](URL) syntax! 🔗",
  "Did you know? You can add images in Markdown using ![alt text](image-url) syntax! 🖼️",
  "Did you know? You can create blockquotes in Markdown by starting lines with > symbol! 💬",
  "Did you know? You can create code blocks in Markdown using triple backticks! 💻",
  
  // Obsidian-specific features
  "Did you know? Obsidian uses [[double brackets]] for internal links between notes! 🔄",
  "Did you know? Obsidian supports embedding notes within notes using ![[note name]] syntax! 📑",
  "Did you know? Obsidian can display your notes as a visual knowledge graph! 🕸️",
  "Did you know? Obsidian supports tags using the #tag syntax! 🏷️",
  "Did you know? Obsidian lets you create collapsible sections with the > [!note] syntax! 📚",
  
  // Benefits of Markdown
  "Did you know? Markdown files are future-proof because they're just plain text! 🔮",
  "Did you know? Markdown is perfect for note-taking because it's quick to write and easy to read! 📒",
  "Did you know? Markdown is supported by thousands of applications across all platforms! 🌍",
  "Did you know? Markdown helps you focus on content instead of formatting! 🧠",
  "Did you know? Markdown files are typically much smaller than formatted document files! 📦"
];

/**
 * Returns a random message from the conversionMessages array
 * @returns {string} A randomly selected message
 */
export function getRandomMessage() {
  const randomIndex = Math.floor(Math.random() * conversionMessages.length);
  return conversionMessages[randomIndex];
}
