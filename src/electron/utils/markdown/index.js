/**
 * Markdown Utilities
 * Provides functionality for handling markdown content in the electron process
 * 
 * This module contains utilities for working with markdown content, including
 * frontmatter extraction and formatting, metadata handling, and content cleaning.
 * 
 * Used by:
 * - src/electron/services/ConversionResultManager.js
 * - src/electron/converters/UnifiedConverterFactory.js
 */

/**
 * Format metadata as YAML frontmatter
 * @param {Object} metadata - Metadata object to format
 * @returns {string} Formatted YAML frontmatter
 */
function formatMetadata(metadata = {}) {
    if (!metadata || Object.keys(metadata).length === 0) {
        return '';
    }

    try {
        // Convert metadata to YAML-like format
        const lines = ['---'];
        
        for (const [key, value] of Object.entries(metadata)) {
            if (value !== undefined && value !== null) {
                if (Array.isArray(value)) {
                    lines.push(`${key}:`);
                    value.forEach(item => lines.push(`  - ${item}`));
                } else if (typeof value === 'object') {
                    lines.push(`${key}:`);
                    Object.entries(value).forEach(([k, v]) => {
                        lines.push(`  ${k}: ${v}`);
                    });
                } else {
                    lines.push(`${key}: ${value}`);
                }
            }
        }
        
        lines.push('---\n');
        return lines.join('\n');
    } catch (error) {
        console.error('Error formatting metadata:', error);
        return '';
    }
}

/**
 * Clean metadata fields to ensure valid values
 * @param {Object} metadata - Metadata object to clean
 * @returns {Object} Cleaned metadata
 */
function cleanMetadata(metadata = {}) {
    const cleaned = {};
    
    for (const [key, value] of Object.entries(metadata)) {
        if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
                cleaned[key] = value.filter(item => item !== null && item !== undefined);
            } else if (typeof value === 'object') {
                cleaned[key] = cleanMetadata(value);
            } else {
                cleaned[key] = value;
            }
        }
    }
    
    return cleaned;
}

/**
 * Extract frontmatter and content from markdown text
 * @param {string} text - Markdown text
 * @returns {Object} Object with metadata and content
 */
function extractFrontmatter(text) {
    if (typeof text !== 'string') {
        return { metadata: {}, content: text || '' };
    }

    try {
        const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        
        if (!match) {
            return { metadata: {}, content: text };
        }

        const [, frontmatter, content] = match;
        const metadata = {};
        
        // Parse YAML-like frontmatter
        const lines = frontmatter.split('\n');
        let currentKey = null;
        let isList = false;
        
        for (const line of lines) {
            const keyMatch = line.match(/^([^:]+):\s*(.*)$/);
            const listItemMatch = line.match(/^\s*-\s*(.+)$/);
            
            if (keyMatch) {
                const [, key, value] = keyMatch;
                currentKey = key.trim();
                if (value.trim()) {
                    metadata[currentKey] = value.trim();
                    isList = false;
                } else {
                    metadata[currentKey] = [];
                    isList = true;
                }
            } else if (listItemMatch && currentKey && isList) {
                if (!Array.isArray(metadata[currentKey])) {
                    metadata[currentKey] = [];
                }
                metadata[currentKey].push(listItemMatch[1].trim());
            }
        }

        return { metadata, content: content.trimStart() };
    } catch (error) {
        console.error('Error extracting frontmatter:', error);
        return { metadata: {}, content: text };
    }
}

/**
 * Merge two metadata objects with optional overrides
 * @param {Object} base - Base metadata object
 * @param {Object} update - Update metadata object
 * @param {Object} overrides - Override values that take precedence
 * @returns {Object} Merged metadata
 */
function mergeMetadata(base = {}, update = {}, overrides = {}) {
    const merged = { ...base };

    // Merge update object
    for (const [key, value] of Object.entries(update)) {
        if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
                merged[key] = [...new Set([...(merged[key] || []), ...value])];
            } else if (typeof value === 'object') {
                merged[key] = {
                    ...(merged[key] || {}),
                    ...value
                };
            } else {
                merged[key] = value;
            }
        }
    }

    // Apply overrides
    for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined && value !== null) {
            merged[key] = value;
        }
    }

    return merged;
}

module.exports = {
    formatMetadata,
    cleanMetadata,
    extractFrontmatter,
    mergeMetadata
};
