/**
 * Core markdown generation utilities (ES Module version)
 */

import { formatMetadata } from './metadata.js';

/**
 * Generates a Markdown document from the given content
 * @param {Object} options - The content and formatting options
 * @param {string} options.title - The title of the document
 * @param {string|Array} options.content - The main content (string or array of strings)
 * @param {Object} [options.metadata] - Optional metadata key-value pairs
 * @param {boolean} [options.tableOfContents=false] - Whether to include a table of contents
 * @returns {string} The formatted Markdown content
 */
export function generateMarkdown({ 
    title, 
    content, 
    metadata = {}, 
    tableOfContents = false 
}) {
    const parts = [];
    
    // Add metadata as frontmatter if it exists
    if (Object.keys(metadata).length > 0) {
        parts.push(formatMetadata(metadata));
    }

    // Add title
    parts.push(`# ${escapeMarkdown(title)}`, '');

    // Add table of contents if requested
    if (tableOfContents) {
        parts.push(generateTableOfContents(content), '');
    }

    // Add main content
    const processedContent = Array.isArray(content)
        ? formatContent(content)
        : escapeMarkdown(content);
    
    parts.push(processedContent);

    return parts.filter(Boolean).join('\n');
}

/**
 * Formats content array into markdown
 * @param {Array<string|Object>} content - The content to format
 * @returns {string} - Formatted content
 */
export function formatContent(content) {
    if (Array.isArray(content)) {
        return content.map(item => formatContentItem(item)).join('\n\n');
    }
    return formatContentItem(content);
}

/**
 * Formats a single content item
 * @param {string|Object} item - The content item
 * @returns {string} - Formatted item
 */
export function formatContentItem(item) {
    if (typeof item === 'string') {
        return item;
    }
    
    if (typeof item === 'object') {
        switch (item.type) {
            case 'list':
                return formatList(item.items, item.ordered);
            case 'code':
                return formatCodeBlock(item.code, item.language);
            case 'quote':
                return formatBlockquote(item.text);
            case 'heading':
                return formatHeading(item.text, item.level);
            default:
                return '';
        }
    }
    
    return '';
}

/**
 * Formats a list in Markdown
 * @param {Array} items - List items
 * @param {boolean} ordered - Whether list is ordered
 * @returns {string} - Formatted list
 */
export function formatList(items, ordered = false) {
    return items
        .map((item, index) => {
            const prefix = ordered ? `${index + 1}.` : '-';
            return `${prefix} ${escapeMarkdown(item)}`;
        })
        .join('\n');
}

/**
 * Formats a code block
 * @param {string} code - Code content
 * @param {string} language - Programming language
 * @returns {string} - Formatted code block
 */
export function formatCodeBlock(code, language = '') {
    return `\`\`\`${language}\n${code}\n\`\`\``;
}

/**
 * Formats a blockquote
 * @param {string} text - Quote text
 * @returns {string} - Formatted blockquote
 */
export function formatBlockquote(text) {
    return text
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n');
}

/**
 * Formats a heading
 * @param {string} text - Heading text
 * @param {number} level - Heading level (1-6)
 * @returns {string} - Formatted heading
 */
export function formatHeading(text, level = 1) {
    level = Math.max(1, Math.min(6, level)); // Ensure valid heading level
    return `${'#'.repeat(level)} ${escapeMarkdown(text)}`;
}

/**
 * Generates a table of contents
 * @param {string|Array} content - Content to generate TOC from
 * @returns {string} - Generated table of contents
 */
export function generateTableOfContents(content) {
    let toc = '## Table of Contents\n\n';
    
    // Convert content array to string if needed
    const contentStr = Array.isArray(content) ? content.join('\n') : content;
    
    // Find all headers (level 2 and 3 only)
    const headers = contentStr.match(/^#{2,3} .+$/gm) || [];
    
    headers.forEach(header => {
        const level = header.match(/^#{2,3}/)[0].length - 2;
        const title = header.replace(/^#{2,3} /, '');
        const link = title.toLowerCase().replace(/[^\w]+/g, '-');
        toc += `${'  '.repeat(level)}* [${title}](#${link})\n`;
    });
    
    return toc;
}

/**
 * Escapes special Markdown characters
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
export function escapeMarkdown(text) {
    if (!text || typeof text !== 'string') {
        return String(text || '');
    }
    
    return text
        .replace(/([*_`~#[\]()>])/g, '\\$1')
        .replace(/\n/g, '  \n');
}

/**
 * Generates a filename-safe slug from text
 * @param {string} text - Text to convert
 * @returns {string} - Slugified text
 */
export function generateSlug(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-')     // Replace spaces with hyphens
        .replace(/-+/g, '-')      // Replace multiple hyphens with single hyphen
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

// Default export for compatibility
export default {
    generateMarkdown,
    formatContent,
    formatContentItem,
    formatList,
    formatCodeBlock,
    formatBlockquote,
    formatHeading,
    generateTableOfContents,
    escapeMarkdown,
    generateSlug
};
