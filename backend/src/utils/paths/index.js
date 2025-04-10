/**
 * Path utilities for ESM modules
 * Provides utilities for working with file paths in an ESM context
 * 
 * This module contains utilities for path manipulation and resolution,
 * particularly important for handling paths consistently across platforms
 * and within the ES Modules environment.
 * 
 * Used by:
 * - backend/src/services/transcriber.js
 * - backend/src/utils/audioChunker.js
 * - backend/src/services/converter/multimedia/videoConverter.js
 * - Other backend ESM modules that need path handling
 */

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

/**
 * Path Utilities for ESM
 * Provides functions for handling paths in an ES Modules context
 */
export class PathUtils {
    /**
     * Convert a file URL to a path
     * @param {string|URL} fileUrl - File URL to convert
     * @returns {string} File path
     */
    static fileURLToPath(fileUrl) {
        return fileURLToPath(fileUrl);
    }

    /**
     * Convert a path to a file URL
     * @param {string} filePath - Path to convert
     * @returns {URL} File URL
     */
    static pathToFileURL(filePath) {
        return pathToFileURL(filePath);
    }

    /**
     * Get the directory name from a file URL (ESM equivalent of __dirname)
     * @param {string|URL} fileUrl - Usually import.meta.url
     * @returns {string} Directory path
     */
    static getDirname(fileUrl) {
        const filename = fileURLToPath(fileUrl);
        return path.dirname(filename);
    }

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

    /**
     * Resolve a path relative to a module's URL (import.meta.url)
     * @param {string|URL} moduleUrl - The module's URL (import.meta.url)
     * @param {...string} pathSegments - Path segments to resolve
     * @returns {string} Resolved path
     */
    static resolveFromModule(moduleUrl, ...pathSegments) {
        const moduleDirname = this.getDirname(moduleUrl);
        return path.resolve(moduleDirname, ...pathSegments);
    }

    /**
     * Get the extension of a file (without the dot)
     * @param {string} filePath - Path to the file
     * @returns {string} File extension without the dot
     */
    static getExtension(filePath) {
        return path.extname(filePath).slice(1);
    }

    /**
     * Get the base name of a file (without the extension)
     * @param {string} filePath - Path to the file
     * @returns {string} Base name without extension
     */
    static getBaseName(filePath) {
        return path.basename(filePath, path.extname(filePath));
    }
}

// Default export for convenience
export default PathUtils;
