/**
 * Markdown Utilities for Backend
 * 
 * This module provides utilities for working with markdown content,
 * including generation, formatting, and metadata handling.
 * 
 * Used by:
 * - backend/src/utils/markdownGenerator.js
 * - backend/src/services/converter/
 */

/**
 * Generate markdown content from various inputs
 * @param {Object} options - Generation options
 * @param {string} options.title - Document title
 * @param {string} options.content - Main content
 * @param {Object} options.metadata - Metadata to include
 * @param {Array} options.images - Images to reference
 * @returns {string} Generated markdown
 */
export function generateMarkdown({ title, content, metadata = {}, images = [] }) {
  // Start with frontmatter if metadata is provided
  let markdown = metadata && Object.keys(metadata).length > 0 
    ? formatMetadata(metadata) 
    : '';
  
  // Add title if provided
  if (title) {
    markdown += `# ${title}\n\n`;
  }
  
  // Add main content
  if (content) {
    markdown += content;
    
    // Ensure content ends with newlines
    if (!content.endsWith('\n\n')) {
      markdown += content.endsWith('\n') ? '\n' : '\n\n';
    }
  }
  
  // Add images section if images are provided
  if (images && images.length > 0) {
    markdown += '\n## Images\n\n';
    
    images.forEach(image => {
      const path = image.path || image.src || image.url;
      const alt = image.alt || image.description || 'Image';
      
      if (path) {
        markdown += `![${alt}](${path})\n\n`;
      }
    });
  }
  
  return markdown;
}

/**
 * Format metadata as YAML frontmatter
 * @param {Object} metadata - Metadata object to format
 * @returns {string} Formatted YAML frontmatter
 */
export function formatMetadata(metadata = {}) {
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
export function cleanMetadata(metadata = {}) {
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

export default {
  generateMarkdown,
  formatMetadata,
  cleanMetadata
};
