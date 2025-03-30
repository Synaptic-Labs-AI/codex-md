// utils/markdownGenerator.js

/**
 * Generates a Markdown document from the given content
 * @param {Object} options - The content and formatting options
 * @param {string} options.title - The title of the document
 * @param {string|Array} options.content - The main content (string or array of strings)
 * @param {Object} [options.metadata] - Optional metadata key-value pairs
 * @param {boolean} [options.tableOfContents=false] - Whether to include a table of contents
 * @returns {string} The formatted Markdown content
 */
export function generateMarkdown({ title, content, metadata = {}, tableOfContents = false }) {
  // Start with frontmatter if metadata exists
  const parts = [];
  
  if (Object.keys(metadata).length > 0) {
    parts.push(
      '---',
      Object.entries(metadata)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n'),
      '---',
      ''
    );
  }

  // Add title
  parts.push(`# ${escapeMarkdown(title)}`, '');

  // Add table of contents if requested
  if (tableOfContents) {
    parts.push(generateTableOfContents(content), '');
  }

  // Add main content
  const processedContent = Array.isArray(content)
    ? content.map(item => formatContentItem(item)).join('\n\n')
    : escapeMarkdown(content);
  
  parts.push(processedContent);

  return parts.filter(Boolean).join('\n');
}

/**
 * Formats the main content, handling both strings and arrays
 * @param {string|Array} content - The content to format
 * @returns {string} The formatted content
 */
function formatContent(content) {
  if (Array.isArray(content)) {
    return content.map(item => formatContentItem(item)).join('\n\n');
  } else {
    return formatContentItem(content);
  }
}

/**
 * Formats a single content item
 * @param {string|Object} item - The content item to format
 * @returns {string} The formatted content item
 */
function formatContentItem(item) {
  if (typeof item === 'string') {
    return item;
  } else if (typeof item === 'object') {
    if (item.type === 'list') {
      return formatList(item.items, item.ordered);
    } else if (item.type === 'code') {
      return formatCodeBlock(item.code, item.language);
    } else if (item.type === 'quote') {
      return formatBlockquote(item.text);
    }
  }
  return '';
}

/**
 * Generates a table of contents from the content
 * @param {string|Array} content - The content to generate TOC from
 * @returns {string} The table of contents in Markdown format
 */
function generateTableOfContents(content) {
  // This is a simplified TOC generation. You might want to enhance this
  // to handle nested headers and more complex structures.
  let toc = '## Table of Contents\n\n';
  const headers = content.match(/^#{2,3} .+$/gm) || [];
  headers.forEach(header => {
    const level = header.match(/^#{2,3}/)[0].length - 2;
    const title = header.replace(/^#{2,3} /, '');
    const link = title.toLowerCase().replace(/[^\w]+/g, '-');
    toc += `${'  '.repeat(level)}* [${title}](#${link})\n`;
  });
  return toc + '\n';
}

/**
 * Formats a list in Markdown
 * @param {Array} items - The list items
 * @param {boolean} [ordered=false] - Whether the list is ordered
 * @returns {string} The formatted list
 */
function formatList(items, ordered = false) {
  return items.map((item, index) => 
    `${ordered ? `${index + 1}.` : '-'} ${escapeMarkdown(item)}`
  ).join('\n');
}

/**
 * Formats a code block in Markdown
 * @param {string} code - The code content
 * @param {string} [language=''] - The programming language
 * @returns {string} The formatted code block
 */
function formatCodeBlock(code, language = '') {
  return `\`\`\`${language}\n${code}\n\`\`\``;
}

/**
 * Formats a blockquote in Markdown
 * @param {string} text - The quote text
 * @returns {string} The formatted blockquote
 */
function formatBlockquote(text) {
  return text.split('\n').map(line => `> ${line}`).join('\n');
}

/**
 * Escapes special Markdown characters in a string
 * @param {string} text - The text to escape
 * @returns {string} The escaped text
 */
function escapeMarkdown(text) {
  if (!text || typeof text !== 'string') {
    return String(text || '');
  }
  
  return text
    .replace(/([*_`~#[\]()>])/g, '\\$1')
    .replace(/\n/g, '  \n');
}