/**
 * resourcePaths.js
 * Utility functions to help with resource path resolution across different environments.
 * 
 * This helps solve path finding issues when the app is packaged with asar or in development mode.
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * Gets the correct path for a resource, trying multiple potential locations
 * @param {string} filename - The resource filename
 * @param {object} options - Options for resource resolution
 * @param {string[]} options.additionalPaths - Additional paths to try
 * @param {string} options.subdir - Subdirectory to look in (e.g., 'static', 'assets')
 * @param {boolean} options.silent - Whether to suppress logging
 * @returns {string|null} - The resolved path or null if not found
 */
function getResourcePath(filename, options = {}) {
  const { additionalPaths = [], subdir = 'static', silent = false } = options;
  
  // Standard locations to check
  const standardPaths = [
    // Path for extraResources in electron-builder
    path.join(process.resourcesPath, subdir, filename),
    
    // Path from app directory
    path.join(app.getAppPath(), 'frontend', subdir, filename),
    
    // Development path
    path.join(__dirname, '../../../frontend', subdir, filename),
    
    // Alternative paths
    path.join(process.resourcesPath, filename),
    path.join(app.getAppPath(), filename),
    
    // For asar-packed resources
    path.join(app.getAppPath(), 'build', subdir, filename)
  ];
  
  // Combine standard paths with any additional paths provided
  const possiblePaths = [...standardPaths, ...additionalPaths];
  
  // Find the first path that exists
  for (const possiblePath of possiblePaths) {
    try {
      fs.accessSync(possiblePath);
      if (!silent) {
        console.log(`✅ Resource found: ${filename} at ${possiblePath}`);
      }
      return possiblePath;
    } catch (e) {
      if (!silent) {
        console.log(`Resource not found at: ${possiblePath}`);
      }
    }
  }
  
  // If we get here, resource wasn't found
  if (!silent) {
    console.warn(`❌ Resource not found: ${filename}`);
  }
  return null;
}

/**
 * Creates an empty native image for fallback
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Electron.NativeImage} - Empty native image
 */
function createEmptyIcon(width = 16, height = 16) {
  const { nativeImage } = require('electron');
  return nativeImage.createFromBuffer(
    Buffer.alloc(width * height * 4), { width, height }
  );
}

/**
 * Gets the correct path for an image resource, with nativeImage fallback
 * @param {string} filename - The image filename
 * @param {object} options - Options for resource resolution
 * @returns {string|Electron.NativeImage} - The resolved path or empty image
 */
function getImageResourcePath(filename, options = {}) {
  const imagePath = getResourcePath(filename, options);
  
  if (imagePath) {
    return imagePath;
  }
  
  // If image not found, create empty image as fallback
  console.warn(`Creating empty fallback image for missing resource: ${filename}`);
  return createEmptyIcon();
}

/**
 * Ensures a directory exists, creating it if needed
 * @param {string} dirPath - The directory path to ensure
 * @returns {boolean} - True if directory exists/was created
 */
function ensureDirectoryExists(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`Created directory: ${dirPath}`);
    }
    return true;
  } catch (error) {
    console.error(`Failed to create directory ${dirPath}:`, error);
    return false;
  }
}

module.exports = {
  getResourcePath,
  getImageResourcePath,
  createEmptyIcon,
  ensureDirectoryExists
};