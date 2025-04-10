/**
 * File utilities for the frontend
 * Re-exports file utilities from our local utils implementation
 * 
 * This file provides commonly used file-related utilities for frontend components
 * like FileUploader.svelte and files.js store.
 */

import {
    FILE_CATEGORIES,
    API_REQUIRED_TYPES,
    getFileType,
    requiresApiKey
} from '@lib/utils/files';

/**
 * Check if a file type is supported by the application
 * @param {string} fileType - The file extension to check
 * @returns {boolean} Whether the file type is supported
 */
export function isValidFileType(fileType) {
    return Object.values(FILE_CATEGORIES).flat().includes(fileType.toLowerCase());
}

/**
 * Sanitize a filename to be safe for saving
 * @param {string} filename - The filename to sanitize
 * @returns {string} The sanitized filename
 */
export function sanitizeFilename(filename) {
    return filename.replace(/[^a-z0-9.-]/gi, '_');
}

// Re-export core utilities
export {
    FILE_CATEGORIES,
    API_REQUIRED_TYPES,
    getFileType,
    requiresApiKey
};
