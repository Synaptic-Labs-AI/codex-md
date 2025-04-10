/**
 * Path Utilities
 * Provides utilities for path manipulation and validation
 * 
 * This module contains utilities for working with file paths securely,
 * ensuring proper path normalization and validation across platforms.
 * 
 * Used by:
 * - src/electron/services/FileSystemService.js
 * - src/electron/services/StreamingFileService.js
 */

const fs = require('fs/promises');
const path = require('path');

class PathUtils {
    /**
     * Normalize a path to use correct separators for the current platform
     * @param {string} filePath - Path to normalize
     * @returns {string} Normalized path
     */
    static normalizePath(filePath) {
        if (!filePath) return '';
        return path.normalize(filePath).replace(/\\+/g, '/');
    }

    /**
     * Ensure a path is valid and safe
     * @param {string} filePath - Path to validate
     * @param {Object} [options={}] - Validation options
     * @returns {Promise<string>} Validated path
     * @throws {Error} If path is invalid
     */
    static async ensureValidPath(filePath, options = {}) {
        if (!filePath || typeof filePath !== 'string') {
            throw new Error('Invalid path provided');
        }

        const normalizedPath = this.normalizePath(filePath);

        // Special handling for URLs in content
        if (options.isUrl) {
            return normalizedPath;
        }

        // Basic path validation
        if (normalizedPath.includes('\0')) {
            throw new Error('Path contains null bytes');
        }

        // Platform-specific validation
        if (process.platform === 'win32') {
            // Windows-specific checks
            if (/[<>:"|?*]/.test(path.basename(normalizedPath))) {
                throw new Error('Path contains invalid characters');
            }
        }

        return normalizedPath;
    }

    /**
     * Check if a path is accessible
     * @param {string} filePath - Path to check
     * @returns {Promise<boolean>} Whether the path is accessible
     */
    static async isAccessible(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Join paths with proper normalization
     * @param {...string} paths - Path segments to join
     * @returns {string} Joined path
     */
    static joinPaths(...paths) {
        return this.normalizePath(path.join(...paths));
    }

    /**
     * Get relative path between two paths
     * @param {string} from - Source path
     * @param {string} to - Target path
     * @returns {string} Relative path
     */
    static relativePath(from, to) {
        return this.normalizePath(path.relative(from, to));
    }

    /**
     * Make a path absolute
     * @param {string} filePath - Path to make absolute
     * @returns {string} Absolute path
     */
    static toAbsolute(filePath) {
        if (path.isAbsolute(filePath)) {
            return this.normalizePath(filePath);
        }
        return this.normalizePath(path.resolve(filePath));
    }
}

module.exports = PathUtils;
