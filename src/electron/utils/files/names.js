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
 * @param {boolean} preserveNumbers - Whether to preserve numbers in the filename
 * @returns {string} The cleaned filename
 */
function cleanTemporaryFilename(filename, preserveNumbers = true) {
    if (!filename) return 'unknown';

    // For Excel/CSV files, it's especially important to preserve the exact filename
    // This is the only change we need to safely store the file
    return filename
        .replace(/[<>:"/\\|?*]+/g, '_'); // Replace only invalid file system characters
}

/**
 * Get the basename of a file path without extension
 * @param {string} filePath - The file path
 * @returns {string} The basename without extension
 */
function getBasename(filePath) {
    const basename = path.basename(filePath);

    // Keep any numbers, special characters, etc. in the filename
    // Just remove the extension
    const lastDot = basename.lastIndexOf('.');

    // Log the basename for debugging
    console.log(`[Files] Getting basename from: ${filePath} -> ${lastDot === -1 ? basename : basename.slice(0, lastDot)}`);

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
