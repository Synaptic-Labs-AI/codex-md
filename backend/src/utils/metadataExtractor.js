// utils/metadataExtractor.js
// This file now re-exports utilities from local modules

import { extractMetadata, extractContent, extractLinks } from './web';
import { formatMetadata } from './markdown';

// Re-export the functions
export {
    extractMetadata,
    extractContent,
    extractLinks,
    formatMetadata
};
