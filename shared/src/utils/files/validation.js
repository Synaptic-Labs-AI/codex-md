/**
 * File validation utilities (ES Module version)
 * Handles file type validation for supported formats.
 */

import { FILE_CATEGORIES } from './types.js';

/**
 * Validates if a file has a supported extension
 * @param {File|String} file - The file object or filename to check
 * @returns {boolean} - Whether the file type is supported
 */
export function isValidFileType(file) {
    if (!file) return false;
    
    const extension = (typeof file === 'string' ? file : file.name || '')
        .toLowerCase()
        .split('.')
        .pop();
        
    return Object.values(FILE_CATEGORIES)
        .flat()
        .includes(extension);
}

/**
 * Validates a file based on its type
 * @param {File|Object} file - The file to validate
 * @returns {Object} - Validation result
 */
export function validateFile(file) {
    if (!file) {
        return {
            valid: false,
            errors: ['No file provided']
        };
    }
    
    const errors = [];
    
    // Only validate file type
    if (!isValidFileType(file)) {
        errors.push('Unsupported file type');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

// Default export for compatibility
export default {
    isValidFileType,
    validateFile
};
