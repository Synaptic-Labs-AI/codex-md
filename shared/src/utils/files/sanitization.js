/**
 * File and path sanitization utilities (ES Module version)
 */

/**
 * Sanitizes a filename to ensure it only contains safe characters
 * @param {string} filename - The original filename to sanitize
 * @returns {string} - The sanitized filename
 */
export function sanitizeFilename(filename) {
    if (!filename) return 'unnamed-file';

    // Split the filename into name and extension
    const lastDotIndex = filename.lastIndexOf('.');
    const name = lastDotIndex === -1 ? filename : filename.slice(0, lastDotIndex);
    const ext = lastDotIndex === -1 ? '' : filename.slice(lastDotIndex);

    // Sanitize the name part:
    // 1. Replace non-alphanumeric characters with hyphens
    // 2. Convert to lowercase
    // 3. Remove consecutive hyphens
    // 4. Trim hyphens from start/end
    const sanitizedName = name
        .replace(/[^a-zA-Z0-9]/g, '-')  // Replace special chars with hyphens
        .toLowerCase()
        .replace(/-+/g, '-')    // Replace multiple hyphens with single hyphen
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

    // Combine sanitized name with original extension
    return sanitizedName + ext.toLowerCase();
}

/**
 * Cleans temporary filenames by removing prefixes and identifiers
 * @param {string} filename - The filename to clean
 * @returns {string} - The cleaned filename
 */
export function cleanTemporaryFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        return filename || '';
    }
    
    try {
        // Extract the base name without extension
        const extension = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
        const baseName = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
        
        // Clean the base name - remove temp_ prefix and any numeric identifiers
        let cleanedName = baseName;
        if (baseName.startsWith('temp_')) {
            cleanedName = baseName.replace(/^temp_\d*_?/, '');
        }
        
        // Return the cleaned name with extension if it had one
        return cleanedName + extension;
    } catch (error) {
        console.error(`❌ Error in cleanTemporaryFilename:`, error);
        return filename;
    }
}

/**
 * Ensures a path only uses forward slashes and has no trailing slash
 * @param {string} path - The path to normalize
 * @returns {string} - The normalized path
 */
export function normalizePath(path) {
    if (!path) return '';
    
    return path
        .replace(/\\/g, '/')     // Convert backslashes to forward slashes
        .replace(/\/+/g, '/')    // Replace multiple slashes with single slash
        .replace(/\/$/g, '');    // Remove trailing slash
}

/**
 * Safely joins path segments together
 * @param {...string} segments - The path segments to join
 * @returns {string} - The joined path
 */
export function joinPaths(...segments) {
    return segments
        .filter(Boolean)                 // Remove empty segments
        .map(segment => normalizePath(segment))
        .join('/')
        .replace(/\/+/g, '/');          // Clean up any double slashes
}

/**
 * Extracts the extension from a filename
 * @param {string} filename - The filename to process
 * @returns {string} - The extension (lowercase, without dot)
 */
export function getExtension(filename) {
    if (!filename) return '';
    
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

/**
 * Gets basename without extension
 * @param {string} filename - The filename to process
 * @returns {string} - The basename without extension
 */
export function getBasename(filename) {
    if (!filename) return '';
    
    const lastDotIndex = filename.lastIndexOf('.');
    return lastDotIndex === -1 ? filename : filename.slice(0, lastDotIndex);
}

// Default export for compatibility
export default {
    sanitizeFilename,
    cleanTemporaryFilename,
    normalizePath,
    joinPaths,
    getExtension,
    getBasename
};
