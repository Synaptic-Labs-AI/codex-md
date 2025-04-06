// utils/metadataExtractor.js
// This file now re-exports utilities from the shared package

import { extractMetadata, extractContent, extractLinks } from '@codex-md/shared/utils/web';
import { formatMetadata } from '@codex-md/shared/utils/markdown';

// Re-export the functions
export {
    extractMetadata,
    extractContent,
    extractLinks,
    formatMetadata
};
