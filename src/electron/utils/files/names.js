/**
 * File Name Utilities
 * Provides functions for handling file names and URLs
 * 
 * This module contains utilities for cleaning filenames, generating
 * URL-based filenames, and handling temporary files.
 * 
 * Used by:
 * - src/electron/services/ConversionResultManager.js
 * - src/electron/services/FileSystemService.js
 */

const path = require('path');
const { URL } = require('url');

/**
 * Clean a filename to be safe for temporary storage
 * @param {string} filename - The filename to clean
 * @returns {string} The cleaned filename
 */
function cleanTemporaryFilename(filename) {
    if (!filename) return 'unknown';

    return filename
        .replace(/[<>:"/\\|?*]+/g, '_') // Replace invalid characters
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .replace(/__+/g, '_') // Replace multiple underscores with single
        .replace(/^_+|_+$/g, ''); // Trim underscores from start and end
}

/**
 * Get the basename of a file path without extension
 * @param {string} filePath - The file path
 * @returns {string} The basename without extension
 */
function getBasename(filePath) {
    const basename = path.basename(filePath);
    const lastDot = basename.lastIndexOf('.');
    return lastDot === -1 ? basename : basename.slice(0, lastDot);
}

/**
 * Generate a filename from a URL
 * @param {string} url - The URL to convert to a filename
 * @returns {string} The generated filename
 */
function generateUrlFilename(url) {
    try {
        const parsedUrl = new URL(url);
        let filename = parsedUrl.hostname;

        // Add path (excluding query and hash)
        if (parsedUrl.pathname !== '/') {
            filename += parsedUrl.pathname;
        }

        // Clean and return
        return cleanTemporaryFilename(filename);
    } catch (error) {
        console.warn('Invalid URL provided to generateUrlFilename:', url);
        // Fall back to cleaning the URL as a string
        return cleanTemporaryFilename(url);
    }
}

/**
 * Sanitize a filename for safe saving
 * @param {string} filename - The filename to sanitize
 * @returns {string} The sanitized filename
 */
function sanitizeFilename(filename) {
    return cleanTemporaryFilename(filename);
}

module.exports = {
    cleanTemporaryFilename,
    getBasename,
    generateUrlFilename,
    sanitizeFilename
};
