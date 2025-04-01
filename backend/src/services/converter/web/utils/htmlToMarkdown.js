/**
 * HTML to Markdown Converter Module using Turndown
 */

import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';
import { formatLink } from './UrlProcessor.js';

/**
 * Configure Turndown service with custom rules
 * @param {Object} options - Configuration options
 * @returns {TurndownService} Configured Turndown instance
 */
function configureTurndown(options = {}) {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    // Minimalistic escaping - only escape what's necessary for Markdown syntax
    escape: function(text) {
      // Only escape markdown special characters when they would interfere with syntax
      return text.replace(/([`*_~\[\]])/g, (match, p1) => {
        // Don't escape if inside a word
        if (/\w\w/.test(text.slice(Math.max(0, text.indexOf(p1) - 1), text.indexOf(p1) + 2))) {
          return p1;
        }
        return '\\' + p1;
      });
    }
  });

  // Custom rule for tables
  service.addRule('table', {
    filter: 'table',
    replacement: function(content, node) {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return '';

      const header = rows[0];
      const bodyRows = rows.slice(1);
      
      // Process header cells
      const headerCells = Array.from(header.querySelectorAll('th, td'));
      if (headerCells.length === 0) return '';

      // Convert header cells with minimal escaping
      const headerRow = headerCells.map(cell => {
        const content = cell.textContent.trim();
        // Only escape pipe characters in table cells
        return content.replace(/\|/g, '\\|');
      });

      const headerMarkdown = '| ' + headerRow.join(' | ') + ' |';
      const separator = '|' + headerCells.map(() => ' --- ').join('|') + '|';
      
      // Process body rows
      const bodyMarkdown = bodyRows.map(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        return '| ' + cells.map(cell => {
          const content = cell.textContent.trim();
          return content.replace(/\|/g, '\\|');
        }).join(' | ') + ' |';
      }).join('\n');
      
      return '\n\n' + [headerMarkdown, separator, bodyMarkdown].join('\n') + '\n\n';
    }
  });

  // Custom rule for links
  service.addRule('links', {
    filter: 'a',
    replacement: function(content, node) {
      const href = node.getAttribute('href');
      if (!href) return content;
      
      const text = content.trim();
      // Only escape brackets in link text and URL if needed
      const escapedText = text.replace(/[\[\]]/g, '\\$&');
      const escapedUrl = href.replace(/[()]/g, '\\$&');
      
      return `[${escapedText}](${escapedUrl})`;
    }
  });

  // Custom rule for images
  service.addRule('images', {
    filter: 'img',
    replacement: function(content, node) {
      const alt = node.getAttribute('alt')?.trim() || '';
      const src = node.getAttribute('src')?.trim() || '';
      
      // Handle attachments differently
      if (src.startsWith('images/')) {
        return `![[${src}]]`;
      }
      
      // Regular image - minimal escaping
      const escapedAlt = alt.replace(/[\[\]]/g, '\\$&');
      const escapedSrc = src.replace(/[()]/g, '\\$&');
      return `![${escapedAlt}](${escapedSrc})`;
    }
  });

  return service;
}

/**
 * Clean HTML content before parsing
 * @private
 */
function cleanHtmlContent(content) {
  if (!content) return '';
  
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/\bon\w+\s*=\s*["'].*?["']/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

/**
 * Clean up Markdown content
 * @param {string} markdown - Markdown content to clean
 * @returns {string} - Cleaned Markdown content
 */
export function cleanMarkdown(markdown) {
  if (!markdown) return '';
  
  // Remove unnecessary escapes
  markdown = markdown
    // Keep escapes for markdown syntax characters
    .replace(/\\([^`*_~\[\]()\\])/g, '$1') // Remove escapes from non-markdown characters
    .replace(/(?<!\\)\\([.,;:])/g, '$1') // Remove escapes from punctuation
    .replace(/(\w)\\([\w])/g, '$1$2') // Remove escapes between word characters
    .replace(/\\\s/g, ' ') // Remove escaped spaces
    .replace(/\\([{}])/g, '$1'); // Remove escapes from curly braces

  // Clean up spacing and formatting
  return markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n\n(\s*[-*+])/g, '\n$1')
    .replace(/\n\n(\s*\d+\.)/g, '\n$1')
    .replace(/\n\n(\s*>)/g, '\n$1')
    .replace(/\n{3,}(#{1,6}\s)/g, '\n\n$1')
    .replace(/\n{3,}(```)/g, '\n\n$1')
    .replace(/\n{3,}(---)/g, '\n\n$1')
    .replace(/\n{3,}(\|)/g, '\n\n$1')
    .trim();
}

/**
 * Convert HTML to Markdown
 * @param {Element} element - HTML element to convert
 * @param {Object} options - Conversion options
 * @returns {string} Markdown content
 */
export function htmlToMarkdown(element, options = {}) {
  try {
    const service = configureTurndown(options);
    const markdown = service.turndown(element);
    return cleanMarkdown(markdown);
  } catch (error) {
    console.error('Error in htmlToMarkdown:', error);
    return '';
  }
}

export default {
  cleanMarkdown,
  htmlToMarkdown
};
