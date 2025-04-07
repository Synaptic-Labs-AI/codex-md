/**
 * PathUtils
 * Provides cross-platform path handling utilities for the application.
 * 
 * Features:
 * - Platform-agnostic path normalization
 * - Windows long path handling
 * - Path validation
 * - Common path resolution patterns
 */

import path from 'path';
import os from 'os';

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
   * @returns {boolean} True if valid
   * @throws {Error} If path is invalid
   */
  static ensureValidPath(inputPath) {
    if (!inputPath) {
      throw new Error('Path cannot be empty');
    }

    // Check for illegal characters based on platform
    const illegalChars = process.platform === 'win32' 
      ? /[<>:"|?*]/g 
      : /\0/g; // Null character illegal on all platforms

    if (illegalChars.test(inputPath)) {
      throw new Error(`Path contains illegal characters: ${inputPath}`);
    }

    // Check path length for Windows
    if (process.platform === 'win32') {
      const fullPath = path.resolve(inputPath);
      if (fullPath.length > 32767) { // Maximum Windows path length even with \\?\
        throw new Error('Path exceeds maximum length supported by Windows');
      }
    }

    return true;
  }

  /**
   * Join and resolve path segments with platform-specific handling
   * @param {string} basePath - Base path to start from
   * @param {...string} segments - Path segments to join
   * @returns {string} Resolved path
   */
  static resolvePath(basePath, ...segments) {
    const joined = path.join(basePath, ...segments);
    return this.normalizePath(path.resolve(joined));
  }

  /**
   * Convert a path to use platform-specific separators
   * @param {string} inputPath - Path to convert
   * @returns {string} Path with correct separators
   */
  static toPlatformPath(inputPath) {
    return inputPath.split(/[/\\]/).join(path.sep);
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
   * Clean a filename by removing/replacing invalid characters
   * @param {string} filename - Filename to clean
   * @returns {string} Cleaned filename
   */
  static sanitizeFileName(filename) {
    if (!filename) return filename;

    // Replace invalid characters based on platform
    const invalidChars = process.platform === 'win32'
      ? /[<>:"/\\|?*\x00-\x1F]/g
      : /[/\x00-\x1F]/g;

    return filename
      .replace(invalidChars, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
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
