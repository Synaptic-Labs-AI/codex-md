/**
 * BinaryPathResolver.js
 * 
 * Utility module for reliably locating FFmpeg and other binaries in both development
 * and production environments. This module helps fix the "Conversion produced empty content"
 * error in video processing by ensuring binaries are correctly located regardless of
 * environment or platform.
 * 
 * Features:
 * - Multiple resolution strategies with fallbacks
 * - Cross-platform path handling (Windows, macOS, Linux)
 * - Caching mechanism to optimize repeated lookups
 * - Binary verification to confirm existence and executability
 * - Detailed logging for troubleshooting
 * 
 * Related Files:
 * - VideoConverter.js: Uses this module to locate FFmpeg binaries
 * - AudioConverter.js: Uses this module to locate FFmpeg binaries
 * - afterPack.js: Handles binary copying during packaging
 */

const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');
const os = require('os');

// Cache for resolved binary paths to avoid repeated lookups
const pathCache = new Map();

/**
 * Resolves the path to a binary executable using multiple resolution strategies
 * @param {string} binaryName - Name of the binary to resolve (e.g., 'ffmpeg', 'ffprobe')
 * @param {Object} options - Additional options
 * @param {boolean} options.forceRefresh - Whether to bypass the cache and force a fresh resolution
 * @param {string[]} options.customPaths - Additional custom paths to check
 * @returns {string|null} The resolved path to the binary or null if not found
 */
function resolveBinaryPath(binaryName, options = {}) {
    const { forceRefresh = false, customPaths = [] } = options;
    
    // Normalize binary name based on platform
    const normalizedBinaryName = normalizeBinaryName(binaryName);
    const cacheKey = normalizedBinaryName;
    
    // Return cached path if available and not forcing refresh
    if (!forceRefresh && pathCache.has(cacheKey)) {
        const cachedPath = pathCache.get(cacheKey);
        console.log(`[BinaryPathResolver] Using cached path for ${normalizedBinaryName}: ${cachedPath}`);
        return cachedPath;
    }
    
    console.log(`[BinaryPathResolver] Resolving path for binary: ${normalizedBinaryName}`);
    
    // Determine if we're in production environment
    const isProduction = process.env.NODE_ENV === 'production' || (app && app.isPackaged);
    console.log(`[BinaryPathResolver] Environment: ${isProduction ? 'Production' : 'Development'}`);
    
    // Get platform-specific paths to check
    const pathsToCheck = getPathsToCheck(normalizedBinaryName, isProduction, customPaths);
    
    // Try each path until we find one that exists and is executable
    for (const binPath of pathsToCheck) {
        try {
            if (verifyBinary(binPath)) {
                console.log(`[BinaryPathResolver] Successfully resolved ${normalizedBinaryName} at: ${binPath}`);
                // Cache the successful path
                pathCache.set(cacheKey, binPath);
                return binPath;
            }
        } catch (error) {
            // Just continue to the next path
            console.log(`[BinaryPathResolver] Path ${binPath} failed verification: ${error.message}`);
        }
    }
    
    // If we get here, we couldn't find the binary
    console.error(`[BinaryPathResolver] Failed to resolve path for ${normalizedBinaryName}`);
    return null;
}

/**
 * Normalizes binary name based on platform (adds .exe for Windows)
 * @param {string} binaryName - Name of the binary
 * @returns {string} Normalized binary name
 */
function normalizeBinaryName(binaryName) {
    const platform = os.platform();
    if (platform === 'win32' && !binaryName.endsWith('.exe')) {
        return `${binaryName}.exe`;
    }
    return binaryName;
}

/**
 * Gets a list of paths to check for the binary based on environment and platform
 * @param {string} binaryName - Name of the binary
 * @param {boolean} isProduction - Whether we're in production mode
 * @param {string[]} customPaths - Additional custom paths to check
 * @returns {string[]} Array of paths to check in priority order
 */
function getPathsToCheck(binaryName, isProduction, customPaths = []) {
    const platform = os.platform();
    const paths = [];
    
    // Add custom paths first (highest priority)
    if (customPaths && customPaths.length > 0) {
        paths.push(...customPaths);
    }
    
    // Production paths - FFmpeg and FFprobe are no longer required
    if (isProduction) {
        console.log('[BinaryPathResolver] FFmpeg and FFprobe binaries are no longer required in production');
    }
    
    // Development paths
    if (!isProduction) {
        try {
            // FFmpeg and FFprobe are no longer required for the application
            console.log('[BinaryPathResolver] FFmpeg and FFprobe are no longer required');
            
            // FFmpeg and FFprobe paths are no longer needed
        } catch (error) {
            console.error('[BinaryPathResolver] Error resolving development paths:', error);
        }
    }
    
    // No system paths needed as FFmpeg and FFprobe are no longer required
    
    // Log all paths we're going to check
    console.log(`[BinaryPathResolver] Paths to check for ${binaryName}:`, paths);
    
    return paths;
}

/**
 * Verifies that a binary exists and is executable
 * @param {string} binaryPath - Path to the binary
 * @returns {boolean} True if the binary exists and is executable
 * @throws {Error} If the binary doesn't exist or isn't executable
 */
function verifyBinary(binaryPath) {
    if (!binaryPath) {
        throw new Error('Binary path is empty or undefined');
    }
    
    try {
        // Check if file exists
        if (!fs.existsSync(binaryPath)) {
            throw new Error(`Binary does not exist at path: ${binaryPath}`);
        }
        
        // Get file stats
        const stats = fs.statSync(binaryPath);
        
        // Check if it's a file (not a directory)
        if (!stats.isFile()) {
            throw new Error(`Path exists but is not a file: ${binaryPath}`);
        }
        
        // On Unix-like systems, check if the file is executable
        const platform = os.platform();
        if (platform !== 'win32') {
            // Check if file has execute permission (Unix-like systems)
            const isExecutable = !!(stats.mode & 0o111); // Check if any execute bit is set
            if (!isExecutable) {
                throw new Error(`Binary exists but is not executable: ${binaryPath}`);
            }
        }
        
        // Log file details for debugging
        console.log(`[BinaryPathResolver] Verified binary at ${binaryPath}`);
        console.log(`[BinaryPathResolver] File size: ${stats.size} bytes`);
        console.log(`[BinaryPathResolver] File permissions: ${stats.mode.toString(8)}`);
        console.log(`[BinaryPathResolver] Last modified: ${stats.mtime}`);
        
        return true;
    } catch (error) {
        throw new Error(`Binary verification failed: ${error.message}`);
    }
}

/**
 * Clears the path cache
 */
function clearPathCache() {
    pathCache.clear();
    console.log('[BinaryPathResolver] Path cache cleared');
}

/**
 * Gets the current state of the path cache
 * @returns {Object} Object with binary names as keys and resolved paths as values
 */
function getPathCache() {
    const cache = {};
    for (const [key, value] of pathCache.entries()) {
        cache[key] = value;
    }
    return cache;
}

module.exports = {
    resolveBinaryPath,
    verifyBinary,
    clearPathCache,
    getPathCache
};