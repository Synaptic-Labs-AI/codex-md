/**
 * PathUtils
 * Provides cross-platform path handling utilities for the application.
 * 
 * Features:
 * - Platform-agnostic path normalization
 * - Windows long path handling
 * - Path validation with URL-friendly support
 * - Common path resolution patterns
 * 
 * Handles special cases:
 * - URLs converted to filenames (e.g., website.com -> website-com)
 * - File extensions in domains (e.g., .ai, .io)
 * - Cross-platform path characters
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';

export class PathUtils {
  /**
   * Normalize a path for the current platform
   * Handles Windows long paths and ensures consistent separators
   * @param {string} inputPath - Path to normalize
   * @returns {string} Normalized path
   */
  static normalizePath(inputPath) {
    if (!inputPath) return inputPath;

    // Normalize slashes for platform
    let normalized = path.normalize(inputPath)
      .replace(/\\/g, path.sep)
      .replace(/\/$/g, ''); // Remove trailing slash

    // Handle Windows long paths
    if (process.platform === 'win32' && !normalized.startsWith('\\\\?\\')) {
      const isUNC = normalized.startsWith('\\\\');
      if (normalized.length > 260 && !isUNC) {
        normalized = `\\\\?\\${normalized}`;
      } else if (isUNC && normalized.length > 255) {
        normalized = `\\\\?\\UNC\\${normalized.slice(2)}`;
      }
    }

    return normalized;
  }

  /**
   * Validate path for platform-specific restrictions
   * @param {string} inputPath - Path to validate
   * @param {Object} options - Validation options
   * @param {boolean} options.isUrl - Whether the path originated from a URL
   * @returns {boolean} True if valid
   * @throws {Error} If path is invalid
   */
  static ensureValidPath(inputPath, options = {}) {
    if (!inputPath) {
      throw new Error('Path cannot be empty');
    }

    // Define allowed special characters
    const allowedSpecials = '-._';
    
    // Normalize path first to handle Windows path separators
    const normalizedPath = path.normalize(inputPath);

    // For Windows, we only want to check filename portion for illegal characters
    if (process.platform === 'win32') {
      // Extract the filename part - this handles both forward and backslashes
      const basename = path.basename(normalizedPath);

      // Define illegal characters for Windows filenames
      const illegalChars = options.isUrl 
        ? /[<>"|?*]/g  // Less restrictive for URLs
        : /[<>"|?*]/g; // Standard Windows filename restrictions

      const match = basename.match(illegalChars);
      if (match) {
        const invalidChars = [...new Set(match)].join(', ');
        throw new Error(`Filename contains illegal characters (${invalidChars}): ${basename}`);
      }

      // Check if path follows Windows drive letter pattern (C:, D:, etc.)
      if (!options.isUrl && normalizedPath.length > 1 && !(/^[A-Za-z]:\\/).test(normalizedPath)) {
        console.warn('Path does not follow Windows drive letter pattern:', normalizedPath);
      }
    } else {
      // For non-Windows platforms, just check for null characters in full path
      if (/\0/.test(normalizedPath)) {
        throw new Error('Path contains null characters');
      }
    }

    // Additional validation for URL-based paths
    if (options.isUrl) {
      // Ensure URL-safe characters are properly handled
      const urlSafePattern = new RegExp(`[^a-zA-Z0-9${allowedSpecials.replace(/./g, '\\$&')}]`, 'g');
      const match = inputPath.match(urlSafePattern);
      if (match) {
        console.warn(`Warning: URL-based path contains potentially problematic characters: ${match.join(', ')}`);
      }
    }

    // Check path length for Windows (with detailed message)
    if (process.platform === 'win32') {
      const fullPath = path.resolve(inputPath);
      const maxLength = 32767; // Maximum Windows path length even with \\?\
      if (fullPath.length > maxLength) {
        throw new Error(
          `Path exceeds maximum length supported by Windows (${fullPath.length} > ${maxLength}): ${inputPath}`
        );
      }
    }

    return true;
  }

  /**
   * Clean a filename by removing/replacing invalid characters
   * @param {string} filename - Filename to clean
   * @param {Object} options - Cleaning options
   * @param {boolean} options.isUrl - Whether the filename originated from a URL
   * @returns {string} Cleaned filename
   */
  static sanitizeFileName(filename, options = {}) {
    if (!filename) return filename;

    // Define characters to replace
    const invalidChars = process.platform === 'win32'
      ? /[<>:"/\\|?*]/g  // Removed hyphen from invalid chars
      : /[/]/g;

    // Clean the filename
    return filename
      .replace(invalidChars, '-')  // Replace invalid chars with hyphen
      .replace(/\s+/g, '-')        // Replace spaces with hyphen
      .replace(/-+/g, '-')         // Collapse multiple hyphens
      .replace(/^-+|-+$/g, '')     // Remove leading/trailing hyphens
      .trim();
  }

  /**
   * Resolve home directory references (~ or $HOME)
   * @param {string} inputPath - Path that may contain home references
   * @returns {string} Path with home directory resolved
   */
  static resolveHomePath(inputPath) {
    if (!inputPath) return inputPath;

    // Replace ~ with home directory
    if (inputPath.startsWith('~')) {
      return path.join(os.homedir(), inputPath.slice(1));
    }

    // Replace $HOME with home directory
    return inputPath.replace(/\$HOME/g, os.homedir());
  }

  /**
   * Get absolute path ensuring proper platform handling
   * @param {string} inputPath - Path to resolve
   * @returns {string} Absolute path
   */
  static getAbsolutePath(inputPath) {
    const resolved = path.resolve(inputPath);
    return this.normalizePath(resolved);
  }

  /**
   * Check if a path exists and is accessible
   * @param {string} inputPath - Path to check
   * @returns {Promise<boolean>} True if path exists and is accessible
   */
  static async isAccessible(inputPath) {
    try {
      await fs.access(inputPath);
      return true;
    } catch {
      return false;
    }
  }
}
