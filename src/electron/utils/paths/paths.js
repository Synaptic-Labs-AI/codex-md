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

const fs = require('fs');
const fsPromises = require('fs/promises');
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
            await fsPromises.access(filePath);
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
    /**
     * Convert a file path to an ESM-compatible URL
     * @param {string} filePath - Path to convert
     * @returns {string} URL string with file:// protocol
     */
    static toEsmUrl(filePath) {
        console.log('🔄 [VERBOSE] PathUtils.toEsmUrl called');
        console.trace('🔄 [VERBOSE] toEsmUrl stack trace');
        
        if (!filePath) {
            console.warn('⚠️ [VERBOSE] Empty path provided to toEsmUrl');
            return '';
        }
        
        console.log('🔍 [VERBOSE] Converting path to ESM URL:', filePath);
        console.log('🔧 [VERBOSE] Environment details:', {
            environment: process.env.NODE_ENV || 'unknown',
            platform: process.platform,
            isWindows: process.platform === 'win32',
            cwd: process.cwd(),
            dirname: __dirname
        });
        
        // Normalize the path
        const normalizedPath = this.normalizePath(filePath);
        console.log('🔍 [VERBOSE] Normalized path:', normalizedPath);
        
        // Ensure the path is absolute
        const absolutePath = path.isAbsolute(normalizedPath)
            ? normalizedPath
            : path.resolve(normalizedPath);
        console.log('🔍 [VERBOSE] Absolute path:', absolutePath);
        
        // Check if the file exists
        try {
            const exists = fs.existsSync(absolutePath);
            console.log('🔍 [VERBOSE] File exists check:', exists);
            
            if (!exists) {
                console.error('❌ [VERBOSE] File does not exist at path:', absolutePath);
                
                // Check parent directories
                const parentDir = path.dirname(absolutePath);
                const parentExists = fs.existsSync(parentDir);
                console.log('🔍 [VERBOSE] Parent directory exists:', parentExists);
                
                if (parentExists) {
                    try {
                        // List files in parent directory
                        const files = fs.readdirSync(parentDir);
                        console.log('📂 [VERBOSE] Files in parent directory:', files);
                    } catch (dirError) {
                        console.error('❌ [VERBOSE] Error reading parent directory:', dirError);
                    }
                }
            }
        } catch (error) {
            console.error('❌ [VERBOSE] Error checking file existence:', error);
        }
        
        // Special handling for Windows paths
        const isWindowsPath = process.platform === 'win32' && /^[A-Z]:/i.test(absolutePath);
        console.log('🔍 [VERBOSE] Is Windows path with drive letter:', isWindowsPath);
        
        // Special handling for ASAR paths
        const isAsarPath = absolutePath.includes('.asar');
        console.log('🔍 [VERBOSE] Is ASAR path:', isAsarPath);
        
        let urlString;
        
        if (isAsarPath) {
            // For ASAR paths, we need to handle them specially
            console.log('🔍 [VERBOSE] Using special handling for ASAR path');
            
            // Extract the path inside the ASAR archive
            const asarMatch = absolutePath.match(/(.*\.asar)[\\/]?(.*)/);
            if (asarMatch) {
                const [_, asarPath, innerPath] = asarMatch;
                console.log('🔍 [VERBOSE] ASAR path parts:', { asarPath, innerPath });
                
                // Check if the ASAR file exists
                const asarExists = fs.existsSync(asarPath);
                console.log('🔍 [VERBOSE] ASAR file exists:', asarExists);
                
                // Use the original path but ensure it has forward slashes
                urlString = `file://${absolutePath.replace(/\\/g, '/')}`;
            } else {
                // Fallback to standard handling
                urlString = `file://${absolutePath.replace(/\\/g, '/')}`;
            }
        } else if (isWindowsPath) {
            // Special handling for Windows paths with drive letters
            console.log('🔍 [VERBOSE] Using special handling for Windows path with drive letter');
            
            // Ensure the path has forward slashes and starts with an additional /
            const formattedPath = absolutePath.replace(/\\/g, '/');
            urlString = `file:///${formattedPath}`;
            console.log('🔍 [VERBOSE] Windows path formatted as:', urlString);
        } else {
            // Standard path handling
            urlString = `file://${absolutePath.replace(/\\/g, '/')}`;
        }
        
        try {
            const url = new URL(urlString).href;
            console.log('🔍 [VERBOSE] Final URL:', url);
            
            // Verify the URL is valid
            if (!url.startsWith('file://')) {
                console.warn('⚠️ [VERBOSE] Generated URL does not start with file:// protocol:', url);
            }
            
            return url;
        } catch (urlError) {
            console.error('❌ [VERBOSE] Error creating URL from path:', urlError);
            console.log('🔍 [VERBOSE] Attempting fallback URL creation');
            
            // Fallback to a simpler approach
            const fallbackUrl = `file://${absolutePath.replace(/\\/g, '/')}`;
            console.log('🔍 [VERBOSE] Fallback URL:', fallbackUrl);
            return fallbackUrl;
        }
    }
}

module.exports = PathUtils;
