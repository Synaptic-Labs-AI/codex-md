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
    strongDelimiter: '**'
  });

  // Handle tables with direct turndown conversion for cells
  // This is the first table rule that will be overridden by the second one below
  service.addRule('tableFirst', {
    filter: 'table',
    replacement: function(content, node) {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return '';

      const header = rows[0];
      const bodyRows = rows.slice(1);
      
      // Process header cells
      const headerCells = Array.from(header.querySelectorAll('th, td'));
      if (headerCells.length === 0) return '';

      const headerMarkdown = '| ' + headerCells.map(cell => {
        // Convert header cell content directly
        return ` ${service.turndown(cell).trim()} `;
      }).join('|') + ' |';
      
      // Add separator
      const separator = '|' + headerCells.map(() => ' --- ').join('|') + '|';
      
      // Process body rows
      const bodyMarkdown = bodyRows.map(row => {
        const cells = Array.from(row.querySelectorAll('td, th'));
        return '| ' + cells.map(cell => {
          // Convert body cell content directly
          return ` ${service.turndown(cell).trim()} `;
        }).join('|') + ' |';
      }).join('\n');
      
      return '\n\n' + [headerMarkdown, separator, bodyMarkdown].join('\n') + '\n\n';
    }
  });

  // Process tables with proper cell content conversion
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

      // Use our safe cell content processor instead of runRule
      const headerMarkdown = '| ' + headerCells.map(cell => {
        return ` ${processCellContent(cell)} `;
      }).join('|') + ' |';
      
      // Add separator
      const separator = '|' + headerCells.map(() => ' --- ').join('|') + '|';
      
      // Process body rows
      const bodyMarkdown = bodyRows.map(row => {
        const cells = Array.from(row.querySelectorAll('td, th'));
        return '| ' + cells.map(cell => {
          return ` ${processCellContent(cell)} `;
        }).join('|') + ' |';
      }).join('\n');
      
      return '\n\n' + [headerMarkdown, separator, bodyMarkdown].join('\n') + '\n\n';
    }
  });
  // Remove default table rules to prevent conflicts
  service.rules.tableCell = {
    filter: function() { return false; }
  };
  service.rules.tableSeparator = {
    filter: function() { return false; }
  };
  // Helper function to process cell content safely
  function processCellContent(cell) {
    try {
      return service.turndown(cell).trim();
    } catch (e) {
      console.warn('Error processing table cell:', e);
      return cell.textContent.trim();
    }
  }


  // Custom rule for links to use our UrlProcessor
  service.addRule('links', {
    filter: 'a',
    replacement: function(content, node) {
      const href = node.getAttribute('href');
      if (!href) return content;
      
      const linkText = content.trim() || href;
      const baseUrl = node.ownerDocument?.querySelector('base')?.getAttribute('href') || '';
      
      // Process relative URLs if needed
      let processedHref = href;
      if (baseUrl && !href.startsWith('http') && !href.startsWith('mailto:')) {
        try {
          processedHref = new URL(href, baseUrl).toString();
        } catch (e) {
          console.warn(`Failed to resolve relative URL: ${href}`);
        }
      }
      
      return formatLink(linkText, processedHref, options, baseUrl);
    }
  });

  // Custom rule for images to support Obsidian format
  service.addRule('images', {
    filter: 'img',
    replacement: function(content, node) {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      
      // Check if this is an attachment image
      if (src.startsWith('attachments/')) {
        return `![[${src}]]`;
      }
      
      return `![${alt}](${src})`;
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
    .replace(/window\.__[^;]+;/g, '')
    .replace(/var\s+\w+\s*=\s*{[^}]+};/g, '')
    .replace(/const\s+\w+\s*=\s*{[^}]+};/g, '')
    .replace(/let\s+\w+\s*=\s*{[^}]+};/g, '')
    .replace(/\{"\w+":(?:[^}]+|\{[^}]+\})+\}/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Remove unwanted elements from the DOM
 * @private
 */
function removeUnwantedElements(document) {
  const selectors = [
    'script', 'style', 'noscript', 'iframe',
    '[id*="cookie"]', '[class*="cookie"]',
    '[id*="consent"]', '[class*="consent"]',
    '[id*="gdpr"]', '[class*="gdpr"]',
    '[class*="hs-"]', '[id*="hs-"]', '[data-hs-]'
  ];
  
  document.querySelectorAll(selectors.join(', ')).forEach(el => {
    try {
      if (el.tagName.toLowerCase() === 'script' || el.tagName.toLowerCase() === 'style') {
        el.remove();
        return;
      }
      
      const style = el.ownerDocument.defaultView.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'absolute' || 
          parseInt(style.zIndex, 10) > 100 || el.matches('[role="dialog"]')) {
        el.remove();
      }
    } catch (e) {
      el.remove();
    }
  });
}

/**
 * Remove JavaScript-like content from markdown
 * @private
 */
function removeJavaScriptContent(markdown) {
  if (!markdown) return '';
  
  markdown = markdown
    .replace(/window\.__[\s\S]*?;/g, '')
    .replace(/(?:var|const|let)\s+\w+\s*=[\s\S]*?;/g, '')
    .replace(/document\.[\s\S]*?;/g, '')
    .replace(/\{\s*"[^"]+"\s*:[\s\S]*?\}/g, '');
  
  return markdown.split('\n')
    .filter(line => {
      const trimmed = line.trim();
      return !(
        /^(?:window|document|var|const|let|function)\.\w+/.test(trimmed) ||
        /^[a-zA-Z$_][a-zA-Z0-9$_]*\s*=/.test(trimmed) ||
        /^(?:if|for|while|switch|try|catch|finally)\s*[\({]/.test(trimmed) ||
        /^}\s*(?:else\s*(?:if\s*\()?)?/.test(trimmed)
      );
    })
    .join('\n');
}

/**
 * Extract title from document
 * @private
 */
function extractTitleFromDocument(document) {
  return document.querySelector('h1')?.textContent.trim() ||
         document.querySelector('title')?.textContent.trim() ||
         document.querySelector('h2')?.textContent.trim() ||
         '';
}

/**
 * Clean up Markdown content
 * @param {string} markdown - Markdown content to clean
 * @returns {string} - Cleaned Markdown content
 */
export function cleanMarkdown(markdown) {
  if (!markdown) return '';
  
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
 * Convert HTML element to Markdown
 * @param {Element} element - HTML element to convert
 * @param {Object} options - Conversion options 
 * @returns {string} Markdown content
 */
export function htmlToMarkdown(element, options = {}) {
  try {
    const service = configureTurndown(options);
    return service.turndown(element);
  } catch (error) {
    console.error('Error in htmlToMarkdown:', error);
    return '';
  }
}

/**
 * Generate Markdown from HTML content with metadata
 * @param {string} content - HTML content
 * @param {Object} metadata - Page metadata
 * @param {Array} images - Images to include
 * @param {string} url - Original URL
 * @param {Object} options - Conversion options
 * @returns {Promise<string>} Markdown content
 */
export async function generateMarkdown(content, metadata = {}, images = [], url = '', options = {}) {
  try {
    if (!content) {
      console.error('No content received');
      return `# ${metadata.title || 'Page Content'}\n\nNo content could be extracted from this page.`;
    }

    // Log content details for debugging
    console.log('Raw content details:', {
      length: content.length,
      preview: content.substring(0, 200),
      tags: {
        main: (content.match(/<main[^>]*>/g) || []).length,
        article: (content.match(/<article[^>]*>/g) || []).length,
        div: (content.match(/<div[^>]*>/g) || []).length,
        header: (content.match(/<h[1-6][^>]*>/g) || []).length,
        paragraph: (content.match(/<p[^>]*>/g) || []).length
      }
    });

    // Clean HTML but preserve more content
    content = cleanHtmlContent(content);
    const dom = new JSDOM(content);
    const document = dom.window.document;
    
    // Log DOM structure
    console.log('DOM structure:', {
      hasBody: !!document?.body,
      bodyChildren: document?.body?.children?.length,
      mainContent: document?.querySelector('main, article, [role="main"]')?.textContent?.length,
      totalText: document?.body?.textContent?.length
    });
    
    // Always try to extract content, even if document seems empty
    if (!document || !document.body) {
      console.error('Failed to parse document or no body found');
      return `# ${metadata.title || 'Page Content'}\n\n${content.replace(/<[^>]+>/g, '')}`;
    }
    
    removeUnwantedElements(document);
    const turndownService = configureTurndown(options);
    let markdown = '';
    
    // Add title
    const title = metadata.title || document.title || extractTitleFromDocument(document) || 'Untitled Page';
    markdown = `# ${title.replace(/^temp_\d+_/, '')}\n\n`;
    
    // Convert body
    try {
      markdown += turndownService.turndown(document.body);
    } catch (error) {
      console.error('Error converting content:', error);
      markdown += 'Error converting content: ' + error.message;
    }

    // Handle images
    const imageMap = new Map(images.map(img => [img.src, img]));
    markdown = markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
      const image = imageMap.get(src);
      return image ? `![[${src}]]` : match;
    });
    
    markdown = cleanMarkdown(markdown);
    markdown = removeJavaScriptContent(markdown);
    
    // Log markdown details
    console.log('Markdown details:', {
      rawLength: markdown.length,
      cleanedLength: markdown.trim().length,
      headings: (markdown.match(/^#+\s/gm) || []).length,
      paragraphs: (markdown.match(/\n\n[^#\n]/g) || []).length
    });
    
    // Only add note if absolutely no real content was found
    if (!markdown.match(/^#+\s.*$(?:\n+[^#\n].*$)+/m)) {
      console.log('No structured content found, adding note');
      markdown += `\n\nNote: Limited content was extracted from ${url}. You may want to visit the original page for more information.`;
    }

    // Structure the content better if it's just a blob of text
    if (!markdown.includes('\n\n')) {
      markdown = markdown.split(/[.!?]\s+/).map(s => s.trim()).filter(Boolean).join('.\n\n');
    }

    return markdown;
  } catch (error) {
    console.error('Error generating Markdown:', error);
    throw new Error(`Failed to generate Markdown: ${error.message}`);
  }
}

export default {
  cleanMarkdown,
  htmlToMarkdown,
  generateMarkdown
};
