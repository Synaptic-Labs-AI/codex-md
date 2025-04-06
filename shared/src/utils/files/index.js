/**
 * Files utilities barrel file (ES Module version)
 * Exports all file-related utilities in an organized way
 */

import * as types from './types.js';
import * as validation from './validation.js';
import * as sanitization from './sanitization.js';

// Re-export all utilities
export const {
    FILE_CATEGORIES,
    API_REQUIRED_TYPES,
    getFileType,
    requiresApiKey
} = types;

export const {
    FILE_SIZE_LIMITS,
    isValidFileType,
    formatFileSize,
    validateFileSize,
    validateFile
} = validation;

export const {
    sanitizeFilename,
    cleanTemporaryFilename,
    normalizePath,
    joinPaths,
    getExtension,
    getBasename
} = sanitization;

// Group functions by category
export const fileTypes = {
    getFileType,
    requiresApiKey,
    FILE_CATEGORIES,
    API_REQUIRED_TYPES,
};

export const fileValidation = {
    isValidFileType,
    validateFileSize,
    validateFile,
    formatFileSize,
    FILE_SIZE_LIMITS,
};

export const fileSanitization = {
    sanitizeFilename,
    cleanTemporaryFilename,
    normalizePath,
    joinPaths,
    getExtension,
    getBasename,
};

// Default export for compatibility
export default {
    // Types
    FILE_CATEGORIES,
    API_REQUIRED_TYPES,
    getFileType,
    requiresApiKey,
    
    // Validation
    FILE_SIZE_LIMITS,
    isValidFileType,
    formatFileSize,
    validateFileSize,
    validateFile,
    
    // Sanitization
    sanitizeFilename,
    cleanTemporaryFilename,
    normalizePath,
    joinPaths,
    getExtension,
    getBasename,
    
    // Grouped exports
    fileTypes,
    fileValidation,
    fileSanitization
};
