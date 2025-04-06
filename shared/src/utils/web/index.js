/**
 * Web utilities barrel file (ES Module version)
 * Exports web-related utilities in an organized way
 */

import * as metadata from './metadata.js';

// Re-export all utilities
export const {
    extractMetadata,
    extractContent,
    extractLinks
} = metadata;

// Group functions by category
export const webMetadata = {
    extractMetadata,
    extractContent,
    extractLinks
};

// Export metadata module
export { metadata };

// Default export for compatibility
export default {
    // Metadata
    extractMetadata,
    extractContent,
    extractLinks,
    
    // Grouped exports
    metadata: webMetadata
};
