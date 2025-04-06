/**
 * Markdown utilities barrel file (ES Module version)
 * Exports all markdown-related utilities in an organized way
 */

import * as generator from './generator.js';
import * as metadata from './metadata.js';
import * as formatting from './formatting.js';

// Re-export all utilities
export const {
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
} = generator;

export const {
    formatMetadata,
    cleanMetadata,
    mergeMetadata,
    extractFrontmatter
} = metadata;

export const {
    bold,
    italic,
    inlineCode,
    link,
    image,
    internalLink,
    horizontalRule,
    taskItem,
    indent,
    definitionListItem,
    footnote,
    escapeText,
    tableRow,
    tableHeader,
    table,
    wrapText
} = formatting;

// Group functions by category
export const document = {
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

export const markdownMetadata = {
    formatMetadata,
    cleanMetadata,
    mergeMetadata,
    extractFrontmatter
};

export const format = {
    bold,
    italic,
    inlineCode,
    link,
    image,
    internalLink,
    horizontalRule,
    taskItem,
    indent,
    definitionListItem,
    footnote,
    escapeText
};

export const markdownTable = {
    tableRow,
    tableHeader,
    table
};

export const text = {
    wrapText,
    escapeText
};

// Export modules
export { generator, metadata, formatting };

// Default export for compatibility
export default {
    // Document generation
    generateMarkdown,
    formatContent,
    formatContentItem,
    formatList,
    formatCodeBlock,
    formatBlockquote,
    formatHeading,
    generateTableOfContents,
    escapeMarkdown,
    generateSlug,
    
    // Metadata
    formatMetadata,
    cleanMetadata,
    mergeMetadata,
    extractFrontmatter,
    
    // Formatting
    bold,
    italic,
    inlineCode,
    link,
    image,
    internalLink,
    horizontalRule,
    taskItem,
    indent,
    definitionListItem,
    footnote,
    escapeText,
    
    // Tables
    tableRow,
    tableHeader,
    table,
    
    // Text utilities
    wrapText,
    
    // Grouped exports
    document,
    metadata: markdownMetadata,
    format,
    table: markdownTable,
    text
};
