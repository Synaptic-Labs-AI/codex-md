/**
 * Metadata handling and YAML frontmatter generation (ES Module version)
 */

/**
 * Formats metadata as YAML frontmatter
 * @param {object} metadata - Metadata object
 * @returns {string} - Formatted YAML frontmatter
 */
export function formatMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return '';
    }

    const lines = ['---'];
    
    Object.entries(metadata).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            if (value.length > 0) {
                lines.push(`${key}:`);
                value.forEach(item => lines.push(`  - ${formatValue(item)}`));
            }
        } else if (value !== null && value !== undefined && value !== '') {
            lines.push(`${key}: ${formatValue(value)}`);
        }
    });
    
    lines.push('---', '');
    return lines.join('\n');
}

/**
 * Formats a value for YAML
 * @param {*} value - The value to format
 * @returns {string} - Formatted value
 */
function formatValue(value) {
    if (typeof value === 'string') {
        // Check if the string needs quotes
        if (needsQuotes(value)) {
            return `"${escapeString(value)}"`;
        }
        return value;
    }
    
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    
    if (value instanceof Date) {
        return value.toISOString();
    }
    
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    
    return String(value);
}

/**
 * Checks if a string needs quotes in YAML
 * @param {string} str - String to check
 * @returns {boolean} - Whether quotes are needed
 */
function needsQuotes(str) {
    return /[:#\[\]{}",\n]/.test(str) || 
           str.trim() !== str ||  // Has leading/trailing whitespace
           ['true', 'false', 'yes', 'no', 'null'].includes(str.toLowerCase()) || 
           !isNaN(str);  // Looks like a number
}

/**
 * Escapes special characters in a string
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
function escapeString(str) {
    return str
        .replace(/"/g, '\\"')     // Escape quotes
        .replace(/\n/g, '\\n');   // Escape newlines
}

/**
 * Cleans metadata object by removing empty values
 * @param {Object} metadata - Metadata object to clean
 * @returns {Object} - Cleaned metadata
 */
export function cleanMetadata(metadata) {
    const cleaned = {};
    
    Object.entries(metadata).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
            if (Array.isArray(value)) {
                if (value.length > 0) {
                    cleaned[key] = value;
                }
            } else if (typeof value === 'object') {
                const cleanedValue = cleanMetadata(value);
                if (Object.keys(cleanedValue).length > 0) {
                    cleaned[key] = cleanedValue;
                }
            } else {
                cleaned[key] = value;
            }
        }
    });
    
    return cleaned;
}

/**
 * Merges multiple metadata objects
 * @param {...Object} objects - Metadata objects to merge
 * @returns {Object} - Merged metadata
 */
export function mergeMetadata(...objects) {
    const merged = {};
    
    objects.forEach(obj => {
        if (obj && typeof obj === 'object') {
            Object.entries(obj).forEach(([key, value]) => {
                if (Array.isArray(merged[key]) && Array.isArray(value)) {
                    // Merge arrays
                    merged[key] = [...new Set([...merged[key], ...value])];
                } else if (
                    typeof merged[key] === 'object' && 
                    typeof value === 'object' &&
                    !Array.isArray(merged[key]) &&
                    !Array.isArray(value)
                ) {
                    // Merge nested objects
                    merged[key] = mergeMetadata(merged[key], value);
                } else {
                    // Replace value
                    merged[key] = value;
                }
            });
        }
    });
    
    return merged;
}

/**
 * Parses YAML frontmatter from markdown content
 * @param {string} content - Markdown content
 * @returns {Object} - { metadata: Object, content: string }
 */
export function extractFrontmatter(content) {
    if (typeof content !== 'string') {
        return { metadata: {}, content: String(content || '') };
    }

    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    
    if (!match) {
        return { metadata: {}, content: content };
    }

    try {
        // Simple YAML parsing (for complex YAML, use a proper YAML parser)
        const metadata = match[1]
            .split('\n')
            .reduce((acc, line) => {
                const [key, ...values] = line.split(':').map(s => s.trim());
                if (key && values.length) {
                    acc[key] = values.join(':');
                }
                return acc;
            }, {});

        return {
            metadata,
            content: match[2].trim()
        };
    } catch (error) {
        console.error('Error parsing frontmatter:', error);
        return { metadata: {}, content };
    }
}

// Default export for compatibility
export default {
    formatMetadata,
    cleanMetadata,
    mergeMetadata,
    extractFrontmatter
};
