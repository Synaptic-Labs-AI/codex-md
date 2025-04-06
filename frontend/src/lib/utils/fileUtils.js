// src/lib/utils/fileUtils.js
// This file now re-exports utilities from the shared package

import { 
    FILE_CATEGORIES,
    API_REQUIRED_TYPES,
    getFileType,
    requiresApiKey,
    isValidFileType,
    formatFileSize,
    sanitizeFilename,
    validateFileSize
} from '@codex-md/shared/utils/files';

// Re-export all utilities
export {
    FILE_CATEGORIES,
    API_REQUIRED_TYPES,
    getFileType,
    requiresApiKey,
    isValidFileType,
    formatFileSize,
    sanitizeFilename,
    validateFileSize
};

// File size limits (effectively removed by setting to extremely large values)
export const MAX_FILE_SIZE = Number.MAX_SAFE_INTEGER; // No practical limit
export const MAX_VIDEO_SIZE = Number.MAX_SAFE_INTEGER; // No practical limit
