// src/lib/utils/fileUtils.js
// Re-exports file utilities from the shared package

import {
    FILE_CATEGORIES,
    API_REQUIRED_TYPES,
    getFileType,
    requiresApiKey,
    isValidFileType,
    sanitizeFilename
} from '@codex-md/shared/utils/files';

// Re-export utilities
export {
    FILE_CATEGORIES,
    API_REQUIRED_TYPES,
    getFileType,
    requiresApiKey,
    isValidFileType,
    sanitizeFilename
};
