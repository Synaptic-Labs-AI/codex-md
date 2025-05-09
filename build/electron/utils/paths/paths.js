"use strict";

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
    const absolutePath = path.isAbsolute(normalizedPath) ? normalizedPath : path.resolve(normalizedPath);
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
        console.log('🔍 [VERBOSE] ASAR path parts:', {
          asarPath,
          innerPath
        });

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJmc1Byb21pc2VzIiwicGF0aCIsIlBhdGhVdGlscyIsIm5vcm1hbGl6ZVBhdGgiLCJmaWxlUGF0aCIsIm5vcm1hbGl6ZSIsInJlcGxhY2UiLCJlbnN1cmVWYWxpZFBhdGgiLCJvcHRpb25zIiwiRXJyb3IiLCJub3JtYWxpemVkUGF0aCIsImlzVXJsIiwiaW5jbHVkZXMiLCJwcm9jZXNzIiwicGxhdGZvcm0iLCJ0ZXN0IiwiYmFzZW5hbWUiLCJpc0FjY2Vzc2libGUiLCJhY2Nlc3MiLCJqb2luUGF0aHMiLCJwYXRocyIsImpvaW4iLCJyZWxhdGl2ZVBhdGgiLCJmcm9tIiwidG8iLCJyZWxhdGl2ZSIsInRvQWJzb2x1dGUiLCJpc0Fic29sdXRlIiwicmVzb2x2ZSIsInRvRXNtVXJsIiwiY29uc29sZSIsImxvZyIsInRyYWNlIiwid2FybiIsImVudmlyb25tZW50IiwiZW52IiwiTk9ERV9FTlYiLCJpc1dpbmRvd3MiLCJjd2QiLCJkaXJuYW1lIiwiX19kaXJuYW1lIiwiYWJzb2x1dGVQYXRoIiwiZXhpc3RzIiwiZXhpc3RzU3luYyIsImVycm9yIiwicGFyZW50RGlyIiwicGFyZW50RXhpc3RzIiwiZmlsZXMiLCJyZWFkZGlyU3luYyIsImRpckVycm9yIiwiaXNXaW5kb3dzUGF0aCIsImlzQXNhclBhdGgiLCJ1cmxTdHJpbmciLCJhc2FyTWF0Y2giLCJtYXRjaCIsIl8iLCJhc2FyUGF0aCIsImlubmVyUGF0aCIsImFzYXJFeGlzdHMiLCJmb3JtYXR0ZWRQYXRoIiwidXJsIiwiVVJMIiwiaHJlZiIsInN0YXJ0c1dpdGgiLCJ1cmxFcnJvciIsImZhbGxiYWNrVXJsIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi91dGlscy9wYXRocy9wYXRocy5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogUGF0aCBVdGlsaXRpZXNcclxuICogUHJvdmlkZXMgdXRpbGl0aWVzIGZvciBwYXRoIG1hbmlwdWxhdGlvbiBhbmQgdmFsaWRhdGlvblxyXG4gKiBcclxuICogVGhpcyBtb2R1bGUgY29udGFpbnMgdXRpbGl0aWVzIGZvciB3b3JraW5nIHdpdGggZmlsZSBwYXRocyBzZWN1cmVseSxcclxuICogZW5zdXJpbmcgcHJvcGVyIHBhdGggbm9ybWFsaXphdGlvbiBhbmQgdmFsaWRhdGlvbiBhY3Jvc3MgcGxhdGZvcm1zLlxyXG4gKiBcclxuICogVXNlZCBieTpcclxuICogLSBzcmMvZWxlY3Ryb24vc2VydmljZXMvRmlsZVN5c3RlbVNlcnZpY2UuanNcclxuICogLSBzcmMvZWxlY3Ryb24vc2VydmljZXMvU3RyZWFtaW5nRmlsZVNlcnZpY2UuanNcclxuICovXHJcblxyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XHJcbmNvbnN0IGZzUHJvbWlzZXMgPSByZXF1aXJlKCdmcy9wcm9taXNlcycpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5cclxuY2xhc3MgUGF0aFV0aWxzIHtcclxuICAgIC8qKlxyXG4gICAgICogTm9ybWFsaXplIGEgcGF0aCB0byB1c2UgY29ycmVjdCBzZXBhcmF0b3JzIGZvciB0aGUgY3VycmVudCBwbGF0Zm9ybVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBub3JtYWxpemVcclxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IE5vcm1hbGl6ZWQgcGF0aFxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgbm9ybWFsaXplUGF0aChmaWxlUGF0aCkge1xyXG4gICAgICAgIGlmICghZmlsZVBhdGgpIHJldHVybiAnJztcclxuICAgICAgICByZXR1cm4gcGF0aC5ub3JtYWxpemUoZmlsZVBhdGgpLnJlcGxhY2UoL1xcXFwrL2csICcvJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBFbnN1cmUgYSBwYXRoIGlzIHZhbGlkIGFuZCBzYWZlXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIHZhbGlkYXRlXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnM9e31dIC0gVmFsaWRhdGlvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBWYWxpZGF0ZWQgcGF0aFxyXG4gICAgICogQHRocm93cyB7RXJyb3J9IElmIHBhdGggaXMgaW52YWxpZFxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgYXN5bmMgZW5zdXJlVmFsaWRQYXRoKGZpbGVQYXRoLCBvcHRpb25zID0ge30pIHtcclxuICAgICAgICBpZiAoIWZpbGVQYXRoIHx8IHR5cGVvZiBmaWxlUGF0aCAhPT0gJ3N0cmluZycpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHBhdGggcHJvdmlkZWQnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRQYXRoID0gdGhpcy5ub3JtYWxpemVQYXRoKGZpbGVQYXRoKTtcclxuXHJcbiAgICAgICAgLy8gU3BlY2lhbCBoYW5kbGluZyBmb3IgVVJMcyBpbiBjb250ZW50XHJcbiAgICAgICAgaWYgKG9wdGlvbnMuaXNVcmwpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZWRQYXRoO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQmFzaWMgcGF0aCB2YWxpZGF0aW9uXHJcbiAgICAgICAgaWYgKG5vcm1hbGl6ZWRQYXRoLmluY2x1ZGVzKCdcXDAnKSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1BhdGggY29udGFpbnMgbnVsbCBieXRlcycpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gUGxhdGZvcm0tc3BlY2lmaWMgdmFsaWRhdGlvblxyXG4gICAgICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XHJcbiAgICAgICAgICAgIC8vIFdpbmRvd3Mtc3BlY2lmaWMgY2hlY2tzXHJcbiAgICAgICAgICAgIGlmICgvWzw+OlwifD8qXS8udGVzdChwYXRoLmJhc2VuYW1lKG5vcm1hbGl6ZWRQYXRoKSkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUGF0aCBjb250YWlucyBpbnZhbGlkIGNoYXJhY3RlcnMnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZWRQYXRoO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgYSBwYXRoIGlzIGFjY2Vzc2libGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gY2hlY2tcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBwYXRoIGlzIGFjY2Vzc2libGVcclxuICAgICAqL1xyXG4gICAgc3RhdGljIGFzeW5jIGlzQWNjZXNzaWJsZShmaWxlUGF0aCkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGZzUHJvbWlzZXMuYWNjZXNzKGZpbGVQYXRoKTtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBKb2luIHBhdGhzIHdpdGggcHJvcGVyIG5vcm1hbGl6YXRpb25cclxuICAgICAqIEBwYXJhbSB7Li4uc3RyaW5nfSBwYXRocyAtIFBhdGggc2VnbWVudHMgdG8gam9pblxyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gSm9pbmVkIHBhdGhcclxuICAgICAqL1xyXG4gICAgc3RhdGljIGpvaW5QYXRocyguLi5wYXRocykge1xyXG4gICAgICAgIHJldHVybiB0aGlzLm5vcm1hbGl6ZVBhdGgocGF0aC5qb2luKC4uLnBhdGhzKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgcmVsYXRpdmUgcGF0aCBiZXR3ZWVuIHR3byBwYXRoc1xyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZyb20gLSBTb3VyY2UgcGF0aFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHRvIC0gVGFyZ2V0IHBhdGhcclxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IFJlbGF0aXZlIHBhdGhcclxuICAgICAqL1xyXG4gICAgc3RhdGljIHJlbGF0aXZlUGF0aChmcm9tLCB0bykge1xyXG4gICAgICAgIHJldHVybiB0aGlzLm5vcm1hbGl6ZVBhdGgocGF0aC5yZWxhdGl2ZShmcm9tLCB0bykpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogTWFrZSBhIHBhdGggYWJzb2x1dGVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gbWFrZSBhYnNvbHV0ZVxyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gQWJzb2x1dGUgcGF0aFxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgdG9BYnNvbHV0ZShmaWxlUGF0aCkge1xyXG4gICAgICAgIGlmIChwYXRoLmlzQWJzb2x1dGUoZmlsZVBhdGgpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLm5vcm1hbGl6ZVBhdGgoZmlsZVBhdGgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdGhpcy5ub3JtYWxpemVQYXRoKHBhdGgucmVzb2x2ZShmaWxlUGF0aCkpO1xyXG4gICAgfVxyXG4gICAgLyoqXHJcbiAgICAgKiBDb252ZXJ0IGEgZmlsZSBwYXRoIHRvIGFuIEVTTS1jb21wYXRpYmxlIFVSTFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byBjb252ZXJ0XHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBVUkwgc3RyaW5nIHdpdGggZmlsZTovLyBwcm90b2NvbFxyXG4gICAgICovXHJcbiAgICBzdGF0aWMgdG9Fc21VcmwoZmlsZVBhdGgpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+UhCBbVkVSQk9TRV0gUGF0aFV0aWxzLnRvRXNtVXJsIGNhbGxlZCcpO1xyXG4gICAgICAgIGNvbnNvbGUudHJhY2UoJ/CflIQgW1ZFUkJPU0VdIHRvRXNtVXJsIHN0YWNrIHRyYWNlJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFmaWxlUGF0aCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oJ+KaoO+4jyBbVkVSQk9TRV0gRW1wdHkgcGF0aCBwcm92aWRlZCB0byB0b0VzbVVybCcpO1xyXG4gICAgICAgICAgICByZXR1cm4gJyc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBDb252ZXJ0aW5nIHBhdGggdG8gRVNNIFVSTDonLCBmaWxlUGF0aCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ/CflKcgW1ZFUkJPU0VdIEVudmlyb25tZW50IGRldGFpbHM6Jywge1xyXG4gICAgICAgICAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgICAgICBwbGF0Zm9ybTogcHJvY2Vzcy5wbGF0Zm9ybSxcclxuICAgICAgICAgICAgaXNXaW5kb3dzOiBwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInLFxyXG4gICAgICAgICAgICBjd2Q6IHByb2Nlc3MuY3dkKCksXHJcbiAgICAgICAgICAgIGRpcm5hbWU6IF9fZGlybmFtZVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIE5vcm1hbGl6ZSB0aGUgcGF0aFxyXG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRQYXRoID0gdGhpcy5ub3JtYWxpemVQYXRoKGZpbGVQYXRoKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gTm9ybWFsaXplZCBwYXRoOicsIG5vcm1hbGl6ZWRQYXRoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBFbnN1cmUgdGhlIHBhdGggaXMgYWJzb2x1dGVcclxuICAgICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSBwYXRoLmlzQWJzb2x1dGUobm9ybWFsaXplZFBhdGgpXHJcbiAgICAgICAgICAgID8gbm9ybWFsaXplZFBhdGhcclxuICAgICAgICAgICAgOiBwYXRoLnJlc29sdmUobm9ybWFsaXplZFBhdGgpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBBYnNvbHV0ZSBwYXRoOicsIGFic29sdXRlUGF0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGZpbGUgZXhpc3RzXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgZXhpc3RzID0gZnMuZXhpc3RzU3luYyhhYnNvbHV0ZVBhdGgpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gRmlsZSBleGlzdHMgY2hlY2s6JywgZXhpc3RzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmICghZXhpc3RzKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIEZpbGUgZG9lcyBub3QgZXhpc3QgYXQgcGF0aDonLCBhYnNvbHV0ZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBDaGVjayBwYXJlbnQgZGlyZWN0b3JpZXNcclxuICAgICAgICAgICAgICAgIGNvbnN0IHBhcmVudERpciA9IHBhdGguZGlybmFtZShhYnNvbHV0ZVBhdGgpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcGFyZW50RXhpc3RzID0gZnMuZXhpc3RzU3luYyhwYXJlbnREaXIpO1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIFBhcmVudCBkaXJlY3RvcnkgZXhpc3RzOicsIHBhcmVudEV4aXN0cyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChwYXJlbnRFeGlzdHMpIHtcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBMaXN0IGZpbGVzIGluIHBhcmVudCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZmlsZXMgPSBmcy5yZWFkZGlyU3luYyhwYXJlbnREaXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygn8J+TgiBbVkVSQk9TRV0gRmlsZXMgaW4gcGFyZW50IGRpcmVjdG9yeTonLCBmaWxlcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZGlyRXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIFtWRVJCT1NFXSBFcnJvciByZWFkaW5nIHBhcmVudCBkaXJlY3Rvcnk6JywgZGlyRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbVkVSQk9TRV0gRXJyb3IgY2hlY2tpbmcgZmlsZSBleGlzdGVuY2U6JywgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBXaW5kb3dzIHBhdGhzXHJcbiAgICAgICAgY29uc3QgaXNXaW5kb3dzUGF0aCA9IHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicgJiYgL15bQS1aXTovaS50ZXN0KGFic29sdXRlUGF0aCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIElzIFdpbmRvd3MgcGF0aCB3aXRoIGRyaXZlIGxldHRlcjonLCBpc1dpbmRvd3NQYXRoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBBU0FSIHBhdGhzXHJcbiAgICAgICAgY29uc3QgaXNBc2FyUGF0aCA9IGFic29sdXRlUGF0aC5pbmNsdWRlcygnLmFzYXInKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gSXMgQVNBUiBwYXRoOicsIGlzQXNhclBhdGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGxldCB1cmxTdHJpbmc7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGlzQXNhclBhdGgpIHtcclxuICAgICAgICAgICAgLy8gRm9yIEFTQVIgcGF0aHMsIHdlIG5lZWQgdG8gaGFuZGxlIHRoZW0gc3BlY2lhbGx5XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBVc2luZyBzcGVjaWFsIGhhbmRsaW5nIGZvciBBU0FSIHBhdGgnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgdGhlIHBhdGggaW5zaWRlIHRoZSBBU0FSIGFyY2hpdmVcclxuICAgICAgICAgICAgY29uc3QgYXNhck1hdGNoID0gYWJzb2x1dGVQYXRoLm1hdGNoKC8oLipcXC5hc2FyKVtcXFxcL10/KC4qKS8pO1xyXG4gICAgICAgICAgICBpZiAoYXNhck1hdGNoKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBbXywgYXNhclBhdGgsIGlubmVyUGF0aF0gPSBhc2FyTWF0Y2g7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gQVNBUiBwYXRoIHBhcnRzOicsIHsgYXNhclBhdGgsIGlubmVyUGF0aCB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIEFTQVIgZmlsZSBleGlzdHNcclxuICAgICAgICAgICAgICAgIGNvbnN0IGFzYXJFeGlzdHMgPSBmcy5leGlzdHNTeW5jKGFzYXJQYXRoKTtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBBU0FSIGZpbGUgZXhpc3RzOicsIGFzYXJFeGlzdHMpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBVc2UgdGhlIG9yaWdpbmFsIHBhdGggYnV0IGVuc3VyZSBpdCBoYXMgZm9yd2FyZCBzbGFzaGVzXHJcbiAgICAgICAgICAgICAgICB1cmxTdHJpbmcgPSBgZmlsZTovLyR7YWJzb2x1dGVQYXRoLnJlcGxhY2UoL1xcXFwvZywgJy8nKX1gO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgLy8gRmFsbGJhY2sgdG8gc3RhbmRhcmQgaGFuZGxpbmdcclxuICAgICAgICAgICAgICAgIHVybFN0cmluZyA9IGBmaWxlOi8vJHthYnNvbHV0ZVBhdGgucmVwbGFjZSgvXFxcXC9nLCAnLycpfWA7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2UgaWYgKGlzV2luZG93c1BhdGgpIHtcclxuICAgICAgICAgICAgLy8gU3BlY2lhbCBoYW5kbGluZyBmb3IgV2luZG93cyBwYXRocyB3aXRoIGRyaXZlIGxldHRlcnNcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIFVzaW5nIHNwZWNpYWwgaGFuZGxpbmcgZm9yIFdpbmRvd3MgcGF0aCB3aXRoIGRyaXZlIGxldHRlcicpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRW5zdXJlIHRoZSBwYXRoIGhhcyBmb3J3YXJkIHNsYXNoZXMgYW5kIHN0YXJ0cyB3aXRoIGFuIGFkZGl0aW9uYWwgL1xyXG4gICAgICAgICAgICBjb25zdCBmb3JtYXR0ZWRQYXRoID0gYWJzb2x1dGVQYXRoLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcclxuICAgICAgICAgICAgdXJsU3RyaW5nID0gYGZpbGU6Ly8vJHtmb3JtYXR0ZWRQYXRofWA7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBXaW5kb3dzIHBhdGggZm9ybWF0dGVkIGFzOicsIHVybFN0cmluZyk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgLy8gU3RhbmRhcmQgcGF0aCBoYW5kbGluZ1xyXG4gICAgICAgICAgICB1cmxTdHJpbmcgPSBgZmlsZTovLyR7YWJzb2x1dGVQYXRoLnJlcGxhY2UoL1xcXFwvZywgJy8nKX1gO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHVybFN0cmluZykuaHJlZjtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ/CflI0gW1ZFUkJPU0VdIEZpbmFsIFVSTDonLCB1cmwpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gVmVyaWZ5IHRoZSBVUkwgaXMgdmFsaWRcclxuICAgICAgICAgICAgaWYgKCF1cmwuc3RhcnRzV2l0aCgnZmlsZTovLycpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ+KaoO+4jyBbVkVSQk9TRV0gR2VuZXJhdGVkIFVSTCBkb2VzIG5vdCBzdGFydCB3aXRoIGZpbGU6Ly8gcHJvdG9jb2w6JywgdXJsKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHVybDtcclxuICAgICAgICB9IGNhdGNoICh1cmxFcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgW1ZFUkJPU0VdIEVycm9yIGNyZWF0aW5nIFVSTCBmcm9tIHBhdGg6JywgdXJsRXJyb3IpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygn8J+UjSBbVkVSQk9TRV0gQXR0ZW1wdGluZyBmYWxsYmFjayBVUkwgY3JlYXRpb24nKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEZhbGxiYWNrIHRvIGEgc2ltcGxlciBhcHByb2FjaFxyXG4gICAgICAgICAgICBjb25zdCBmYWxsYmFja1VybCA9IGBmaWxlOi8vJHthYnNvbHV0ZVBhdGgucmVwbGFjZSgvXFxcXC9nLCAnLycpfWA7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfwn5SNIFtWRVJCT1NFXSBGYWxsYmFjayBVUkw6JywgZmFsbGJhY2tVcmwpO1xyXG4gICAgICAgICAgICByZXR1cm4gZmFsbGJhY2tVcmw7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFBhdGhVdGlscztcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsRUFBRSxHQUFHQyxPQUFPLENBQUMsSUFBSSxDQUFDO0FBQ3hCLE1BQU1DLFVBQVUsR0FBR0QsT0FBTyxDQUFDLGFBQWEsQ0FBQztBQUN6QyxNQUFNRSxJQUFJLEdBQUdGLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFFNUIsTUFBTUcsU0FBUyxDQUFDO0VBQ1o7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJLE9BQU9DLGFBQWFBLENBQUNDLFFBQVEsRUFBRTtJQUMzQixJQUFJLENBQUNBLFFBQVEsRUFBRSxPQUFPLEVBQUU7SUFDeEIsT0FBT0gsSUFBSSxDQUFDSSxTQUFTLENBQUNELFFBQVEsQ0FBQyxDQUFDRSxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQztFQUN4RDs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNJLGFBQWFDLGVBQWVBLENBQUNILFFBQVEsRUFBRUksT0FBTyxHQUFHLENBQUMsQ0FBQyxFQUFFO0lBQ2pELElBQUksQ0FBQ0osUUFBUSxJQUFJLE9BQU9BLFFBQVEsS0FBSyxRQUFRLEVBQUU7TUFDM0MsTUFBTSxJQUFJSyxLQUFLLENBQUMsdUJBQXVCLENBQUM7SUFDNUM7SUFFQSxNQUFNQyxjQUFjLEdBQUcsSUFBSSxDQUFDUCxhQUFhLENBQUNDLFFBQVEsQ0FBQzs7SUFFbkQ7SUFDQSxJQUFJSSxPQUFPLENBQUNHLEtBQUssRUFBRTtNQUNmLE9BQU9E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