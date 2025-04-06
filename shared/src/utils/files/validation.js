/**
 * File validation utilities (ES Module version)
 */

import { FILE_CATEGORIES } from './types.js';

// Set extremely large values for practical purposes
export const FILE_SIZE_LIMITS = {
    default: Number.MAX_SAFE_INTEGER,
    video: Number.MAX_SAFE_INTEGER,
    audio: Number.MAX_SAFE_INTEGER
};

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
 * Gets the file size in a human-readable format
 * @param {number} bytes - The file size in bytes
 * @returns {string} - Formatted file size
 */
export function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${Math.round(size * 100) / 100} ${units[unitIndex]}`;
}

/**
 * Validates if a file size is within allowed limits
 * @param {File|Object} file - The file to check
 * @param {string} [category='default'] - The file category for specific limits
 * @returns {Object} - Validation result with valid status and message
 */
export function validateFileSize(file, category = 'default') {
    if (!file || !file.size) {
        return { 
            valid: false, 
            message: 'Invalid file',
            maxSize: FILE_SIZE_LIMITS[category] || FILE_SIZE_LIMITS.default
        };
    }
    
    const maxSize = FILE_SIZE_LIMITS[category] || FILE_SIZE_LIMITS.default;
    const valid = file.size <= maxSize;
    
    return {
        valid,
        maxSize,
        message: valid ? '' : `File exceeds size limit of ${formatFileSize(maxSize)}`
    };
}

/**
 * Validates a file against multiple criteria
 * @param {File|Object} file - The file to validate
 * @param {Object} options - Validation options
 * @returns {Object} - Complete validation result
 */
export function validateFile(file, options = {}) {
    if (!file) {
        return {
            valid: false,
            errors: ['No file provided']
        };
    }
    
    const errors = [];
    
    // Check file type
    if (!isValidFileType(file)) {
        errors.push('Unsupported file type');
    }

    // Check file size
    const sizeCheck = validateFileSize(file, options.category);
    if (!sizeCheck.valid) {
        errors.push(sizeCheck.message);
    }

    return {
        valid: errors.length === 0,
        errors,
        fileSize: file.size,
        formattedSize: formatFileSize(file.size),
        ...sizeCheck
    };
}

// Default export for compatibility
export default {
    FILE_SIZE_LIMITS,
    isValidFileType,
    formatFileSize,
    validateFileSize,
    validateFile
};
