"use strict";

/**
 * FileSystemService.js
 * Handles native file system operations for the Electron application.
 * Provides secure file access, path normalization, and directory management.
 * 
 * This service is used by IPC handlers to perform file operations requested
 * by the renderer process. It implements security checks and error handling
 * to ensure safe file system access.
 */

const fs = require('fs/promises');
const path = require('path');
const os = require('os'); // Added for temporary directory
const {
  app
} = require('electron');
const {
  PathUtils
} = require('../utils/paths');
const logger = require('../utils/logger'); // Assuming a logger utility exists

class FileSystemService {
  constructor() {
    this.appDataPath = PathUtils.normalizePath(app.getPath('userData'));
    this.documentsPath = PathUtils.normalizePath(app.getPath('documents'));
    this.activeTemporaryDirs = new Set(); // Track active temporary directories
    logger.info('[FileSystemService] Initialized');
  }

  /**
   * Validates and normalizes a file path for security
   * @param {string} filePath - The path to validate
   * @param {boolean} shouldExist - Whether the path should already exist
   * @param {Object} options - Additional validation options
   * @param {boolean} options.isUrl - Whether the path originated from a URL
   * @returns {Promise<string>} Normalized absolute path
   * @throws {Error} If path is invalid or access is denied
   */
  async validatePath(filePath, shouldExist = true, options = {}) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path');
    }
    try {
      const isAbsolute = path.isAbsolute(filePath);
      const isUrl = options.isUrl || /^https?:\/\//.test(filePath);

      // First normalize the path using Node's path module
      const normalizedPath = path.normalize(filePath);

      // For absolute Windows paths, validate the path directly
      if (process.platform === 'win32' && isAbsolute) {
        const validatedPath = await PathUtils.ensureValidPath(normalizedPath);
        if (shouldExist && !(await PathUtils.isAccessible(normalizedPath))) {
          throw new Error(`Path does not exist or access denied: ${filePath}`);
        }
        return normalizedPath;
      }

      // For non-absolute or non-Windows paths, validate with URL awareness
      PathUtils.ensureValidPath(filePath, {
        isUrl
      });

      // Convert to absolute path as needed
      const absolutePath = isAbsolute ? normalizedPath : PathUtils.normalizePath(path.join(this.documentsPath, normalizedPath));
      if (shouldExist && !(await PathUtils.isAccessible(absolutePath))) {
        throw new Error(`Path does not exist or access denied: ${filePath}`);
      }
      return absolutePath;
    } catch (error) {
      throw new Error(`Path validation failed: ${error.message}`);
    }
  }

  /**
   * Reads a file safely
   * @param {string} filePath - Path to the file
   * @param {string} encoding - File encoding (default: 'utf8')
   * @returns {Promise<{success: boolean, data?: any, error?: string}>}
   */
  async readFile(filePath, encoding = 'utf8') {
    console.log(`📖 Reading file: ${filePath} with encoding: ${encoding}`);
    try {
      const validPath = await this.validatePath(filePath);
      console.log(`✓ Path validated: ${validPath}`);

      // Check if file exists before reading
      try {
        const stats = await fs.stat(validPath);
        console.log(`📊 File stats: size=${stats.size}, isFile=${stats.isFile()}`);
        if (!stats.isFile()) {
          console.error(`❌ Not a file: ${validPath}`);
          return {
            success: false,
            error: `Not a file: ${filePath}`
          };
        }
      } catch (statError) {
        console.error(`❌ File stat error: ${statError.message}`);
        return {
          success: false,
          error: `File not accessible: ${statError.message}`
        };
      }

      // Read the file
      const data = await fs.readFile(validPath, {
        encoding
      });

      // Log success with data preview
      const preview = typeof data === 'string' ? `${data.substring(0, 50)}${data.length > 50 ? '...' : ''}` : `<Buffer: ${data.length} bytes>`;
      console.log(`✅ File read successfully: ${validPath} (${typeof data}, ${data.length} bytes)`);
      console.log(`📄 Data preview: ${preview}`);
      return {
        success: true,
        data
      };
    } catch (error) {
      console.error(`❌ Failed to read file: ${filePath}`, error);
      return {
        success: false,
        error: `Failed to read file: ${error.message}`
      };
    }
  }

  /**
   * Writes data to a file safely
   * @param {string} filePath - Path to write the file
   * @param {string|Buffer} data - Data to write
   * @param {string} encoding - File encoding (default: 'utf8')
   * @returns {Promise<{success: boolean, error?: string, stats?: Object}>}
   */
  async writeFile(filePath, data, encoding = 'utf8') {
    console.log(`💾 [FileSystemService] Writing file: ${filePath}`);
    console.log(`📊 [FileSystemService] Data type: ${typeof data}, ${Buffer.isBuffer(data) ? 'Buffer' : 'Not Buffer'}, Length: ${data ? data.length : 'null'}`);
    try {
      const validPath = await this.validatePath(filePath, false);
      console.log(`✓ [FileSystemService] Path validated: ${validPath}`);

      // Ensure directory exists
      const dirPath = path.dirname(validPath);
      await fs.mkdir(dirPath, {
        recursive: true
      });
      console.log(`📁 [FileSystemService] Ensured directory exists: ${dirPath}`);

      // Check if this is base64 data that needs to be decoded
      let dataToWrite = data;
      let dataEncoding = encoding;
      let originalDataLength = data ? data.length : 0;
      let isBase64 = false;
      if (typeof data === 'string' && data.startsWith('BASE64:')) {
        console.log(`🔄 [FileSystemService] Detected BASE64 prefix, decoding binary data`);
        isBase64 = true;

        // Remove the prefix and decode base64 to binary
        const base64Data = data.substring(7); // Remove 'BASE64:' prefix
        console.log(`📊 [FileSystemService] Base64 data length: ${base64Data.length} characters`);

        // Check if base64 data is valid
        if (base64Data.length % 4 !== 0) {
          console.warn(`⚠️ [FileSystemService] Base64 data length is not a multiple of 4: ${base64Data.length}`);
        }

        // Calculate expected decoded size
        const expectedSize = Math.ceil(base64Data.length * 0.75);
        console.log(`📊 [FileSystemService] Expected decoded size: ~${expectedSize} bytes`);
        try {
          dataToWrite = Buffer.from(base64Data, 'base64');
          dataEncoding = null; // Use null encoding for binary data
          console.log(`📊 [FileSystemService] Decoded base64 data to binary buffer: ${dataToWrite.length} bytes`);

          // Verify buffer integrity
          if (dataToWrite.length < expectedSize * 0.9) {
            console.warn(`⚠️ [FileSystemService] Decoded size (${dataToWrite.length}) is significantly smaller than expected (${expectedSize})`);
          }

          // Check for ZIP signature (PK header) for PPTX, DOCX, etc.
          if (dataToWrite.length >= 4) {
            const signature = dataToWrite.slice(0, 4);
            if (signature[0] === 0x50 && signature[1] === 0x4B) {
              console.log(`✅ [FileSystemService] Valid ZIP signature detected (PK header)`);
            } else {
              console.warn(`⚠️ [FileSystemService] No ZIP signature found in binary data: ${signature.toString('hex')}`);
            }
          }
        } catch (decodeError) {
          console.error(`❌ [FileSystemService] Base64 decoding failed: ${decodeError.message}`);
          throw new Error(`Base64 decoding failed: ${decodeError.message}`);
        }
      }

      // Write the file
      const writeStartTime = Date.now();
      await fs.writeFile(validPath, dataToWrite, {
        encoding: dataEncoding
      });
      const writeTime = Date.now() - writeStartTime;
      console.log(`⏱️ [FileSystemService] Write operation took ${writeTime}ms`);

      // Verify the file was written
      try {
        const stats = await fs.stat(validPath);
        console.log(`✅ [FileSystemService] File written successfully: ${validPath} (${stats.size} bytes)`);

        // Verify file size
        if (isBase64) {
          // For base64 data, compare with the decoded buffer size
          if (Buffer.isBuffer(dataToWrite) && stats.size !== dataToWrite.length) {
            console.warn(`⚠️ [FileSystemService] File size mismatch! Expected: ${dataToWrite.length}, Actual: ${stats.size}`);
          }
        } else if (typeof data === 'string') {
          // For text data, compare with original string length
          if (stats.size < originalDataLength * 0.9) {
            console.warn(`⚠️ [FileSystemService] File size smaller than expected! Original data: ${originalDataLength}, File size: ${stats.size}`);
          }
        }

        // Return success with file stats
        return {
          success: true,
          stats: {
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime
          }
        };
      } catch (verifyError) {
        console.error(`⚠️ [FileSystemService] File written but verification failed: ${verifyError.message}`);
        return {
          success: true
        }; // Still return success since write succeeded
      }
    } catch (error) {
      console.error(`❌ [FileSystemService] Failed to write file: ${filePath}`, error);
      return {
        success: false,
        error: `Failed to write file: ${error.message}`
      };
    }
  }

  /**
   * Creates a directory and any necessary parent directories
   * @param {string} dirPath - Path to create
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async createDirectory(dirPath) {
    try {
      const validPath = await this.validatePath(dirPath, false);
      await fs.mkdir(validPath, {
        recursive: true
      });
      return {
        success: true
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create directory: ${error.message}`
      };
    }
  }

  /**
   * Lists contents of a directory with detailed information
   * @param {string} dirPath - Path to list
   * @param {Object} options - Listing options
   * @param {boolean} options.recursive - Whether to list recursively
   * @param {string[]} options.extensions - File extensions to filter (e.g., ['md', 'txt'])
   * @returns {Promise<{success: boolean, items?: Array<Object>, error?: string}>}
   */
  async listDirectory(dirPath, options = {}) {
    try {
      const validPath = await this.validatePath(dirPath);
      const entries = await fs.readdir(validPath, {
        withFileTypes: true
      });

      // Filter entries if extensions are provided
      let filteredEntries = entries;
      if (options.extensions && Array.isArray(options.extensions) && options.extensions.length > 0) {
        const extensions = options.extensions.map(ext => ext.startsWith('.') ? ext : `.${ext}`);
        filteredEntries = entries.filter(entry => entry.isDirectory() || extensions.some(ext => entry.name.toLowerCase().endsWith(ext.toLowerCase())));
      }

      // Map entries to item objects with detailed information
      const items = await Promise.all(filteredEntries.map(async entry => {
        const entryPath = path.join(validPath, entry.name);
        const stats = await fs.stat(entryPath);
        const extension = entry.isFile() ? path.extname(entry.name).slice(1).toLowerCase() : '';
        return {
          name: entry.name,
          path: entryPath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modified: stats.mtime,
          created: stats.birthtime,
          type: extension,
          relativePath: path.relative(validPath, entryPath)
        };
      }));

      // Sort items: directories first, then files alphabetically
      items.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      // If recursive option is true, include subdirectory contents
      if (options.recursive) {
        const directories = items.filter(item => item.isDirectory);
        for (const dir of directories) {
          const subDirResult = await this.listDirectory(dir.path, {
            ...options,
            recursive: true
          });
          if (subDirResult.success) {
            // Add subdirectory path to each item
            const subItems = subDirResult.items.map(item => ({
              ...item,
              relativePath: path.relative(validPath, item.path)
            }));
            items.push(...subItems);
          }
        }
      }
      return {
        success: true,
        items
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list directory: ${error.message}`
      };
    }
  }

  /**
   * Deletes a file or directory
   * @param {string} itemPath - Path to delete
   * @param {boolean} recursive - Whether to delete directories recursively
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async delete(itemPath, recursive = false) {
    try {
      const validPath = await this.validatePath(itemPath);
      const stats = await fs.stat(validPath);
      if (stats.isDirectory()) {
        await fs.rm(validPath, {
          recursive
        });
      } else {
        await fs.unlink(validPath);
      }
      return {
        success: true
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete: ${error.message}`
      };
    }
  }

  /**
   * Gets file or directory information
   * @param {string} itemPath - Path to check
   * @returns {Promise<{success: boolean, stats?: Object, error?: string}>}
   */
  async getStats(itemPath) {
    try {
      const validPath = await this.validatePath(itemPath);
      const stats = await fs.stat(validPath);
      return {
        success: true,
        stats: {
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile()
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get stats: ${error.message}`
      };
    }
  }

  /**
   * Moves a file or directory
   * @param {string} sourcePath - Source path
   * @param {string} destPath - Destination path
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async move(sourcePath, destPath) {
    try {
      const validSourcePath = await this.validatePath(sourcePath);
      const validDestPath = await this.validatePath(destPath, false);
      await fs.rename(validSourcePath, validDestPath);
      return {
        success: true
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to move: ${error.message}`
      };
    }
  }
  /**
   * Creates a unique temporary directory.
   * @param {string} prefix - A prefix for the temporary directory name.
   * @returns {Promise<string>} The path to the created temporary directory.
   * @throws {Error} If directory creation fails.
   */
  async createTemporaryDirectory(prefix = 'codexmd-temp-') {
    logger.info(`[FileSystemService] Creating temporary directory with prefix: ${prefix}`);
    try {
      // Use os.tmpdir() to get the system's temporary directory
      const tempDir = PathUtils.normalizePath(os.tmpdir());
      const fullPrefixPath = PathUtils.normalizePath(path.join(tempDir, prefix));

      // fs.mkdtemp creates a unique directory (e.g., /tmp/codexmd-temp-XXXXXX)
      const createdDirPath = await fs.mkdtemp(fullPrefixPath);
      this.activeTemporaryDirs.add(createdDirPath);
      logger.info(`[FileSystemService] Created and registered temporary directory: ${createdDirPath}`);
      return createdDirPath;
    } catch (error) {
      logger.error(`[FileSystemService] Failed to create temporary directory with prefix ${prefix}: ${error.message}`, error);
      throw new Error(`Failed to create temporary directory: ${error.message}`);
    }
  }

  /**
   * Marks a temporary directory as no longer actively needed by the primary process.
   * This allows it to be potentially cleaned up later.
   * @param {string} dirPath - The path of the temporary directory to release.
   * @returns {Promise<void>}
   */
  async releaseTemporaryDirectory(dirPath) {
    const normalizedPath = PathUtils.normalizePath(dirPath);
    if (this.activeTemporaryDirs.has(normalizedPath)) {
      this.activeTemporaryDirs.delete(normalizedPath);
      logger.info(`[FileSystemService] Released temporary directory: ${normalizedPath}`);
    } else {
      logger.warn(`[FileSystemService] Attempted to release non-tracked or already released temporary directory: ${normalizedPath}`);
    }
  } // <-- Add missing closing brace for the previous method

  /**
   * Deletes a specified temporary directory immediately.
   * Should be called after releaseTemporaryDirectory or when cleanup is certain.
   * @param {string} dirPath - The path of the temporary directory to delete.
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async cleanupTemporaryDirectory(dirPath) {
    const normalizedPath = PathUtils.normalizePath(dirPath);
    logger.info(`[FileSystemService] Attempting cleanup of temporary directory: ${normalizedPath}`);

    // Basic check to ensure we're deleting something that looks like a temp path
    if (!normalizedPath.startsWith(PathUtils.normalizePath(os.tmpdir()))) {
      logger.error(`[FileSystemService] Refusing to cleanup non-temporary path: ${normalizedPath}`);
      return {
        success: false,
        error: 'Path is not within the system temporary directory.'
      };
    }

    // Ensure it's released first (optional, but good practice)
    if (this.activeTemporaryDirs.has(normalizedPath)) {
      logger.warn(`[FileSystemService] Cleaning up directory that was not released: ${normalizedPath}`);
      this.activeTemporaryDirs.delete(normalizedPath); // Remove from tracking
    }
    try {
      await fs.rm(normalizedPath, {
        recursive: true,
        force: true
      });
      logger.info(`[FileSystemService] Successfully cleaned up temporary directory: ${normalizedPath}`);
      return {
        success: true
      };
    } catch (error) {
      // Handle cases where the directory might already be gone
      if (error.code === 'ENOENT') {
        logger.warn(`[FileSystemService] Temporary directory already removed: ${normalizedPath}`);
        return {
          success: true
        }; // Considered success if already gone
      }
      logger.error(`[FileSystemService] Failed to cleanup temporary directory ${normalizedPath}: ${error.message}`, error);
      return {
        success: false,
        error: `Failed to cleanup temporary directory: ${error.message}`
      };
    }
  }
  /**
   * Cleans up any tracked temporary directories that might have been orphaned
   * (e.g., due to application crash before release/cleanup).
   * This is a safety measure against disk space leaks.
   * Note: This currently just logs; uncomment fs.rm to enable deletion.
   * @returns {Promise<void>}
   */
  async cleanupOrphanedTemporaryDirectories() {
    logger.info(`[FileSystemService] Checking for orphaned temporary directories... Found ${this.activeTemporaryDirs.size} tracked.`);
    const cleanupPromises = [];
    for (const dirPath of this.activeTemporaryDirs) {
      logger.warn(`[FileSystemService] Found potentially orphaned temporary directory: ${dirPath}. Consider manual cleanup or enabling automatic removal.`);
      // Uncomment the following lines to enable automatic cleanup of tracked dirs on shutdown/startup
      // cleanupPromises.push(
      //     fs.rm(dirPath, { recursive: true, force: true })
      //         .then(() => logger.info(`[FileSystemService] Cleaned up orphaned directory: ${dirPath}`))
      //         .catch(err => logger.error(`[FileSystemService] Error cleaning up orphaned directory ${dirPath}: ${err.message}`))
      // );
    }
    // await Promise.all(cleanupPromises); // Uncomment if enabling automatic cleanup
    this.activeTemporaryDirs.clear(); // Clear tracking after attempting cleanup
    logger.info('[FileSystemService] Orphaned directory check complete.');
  }
} // End of FileSystemService class
// Class definition ends above. Module-level code starts below.

// Ensure cleanup runs on application exit
const fileSystemServiceInstance = new FileSystemService();
app.on('will-quit', async () => {
  logger.info('[FileSystemService] Application quitting. Cleaning up orphaned temporary directories...');
  await fileSystemServiceInstance.cleanupOrphanedTemporaryDirectories();
  logger.info('[FileSystemService] Orphaned temporary directory cleanup finished.');
});
module.exports = fileSystemServiceInstance;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJwYXRoIiwib3MiLCJhcHAiLCJQYXRoVXRpbHMiLCJsb2dnZXIiLCJGaWxlU3lzdGVtU2VydmljZSIsImNvbnN0cnVjdG9yIiwiYXBwRGF0YVBhdGgiLCJub3JtYWxpemVQYXRoIiwiZ2V0UGF0aCIsImRvY3VtZW50c1BhdGgiLCJhY3RpdmVUZW1wb3JhcnlEaXJzIiwiU2V0IiwiaW5mbyIsInZhbGlkYXRlUGF0aCIsImZpbGVQYXRoIiwic2hvdWxkRXhpc3QiLCJvcHRpb25zIiwiRXJyb3IiLCJpc0Fic29sdXRlIiwiaXNVcmwiLCJ0ZXN0Iiwibm9ybWFsaXplZFBhdGgiLCJub3JtYWxpemUiLCJwcm9jZXNzIiwicGxhdGZvcm0iLCJ2YWxpZGF0ZWRQYXRoIiwiZW5zdXJlVmFsaWRQYXRoIiwiaXNBY2Nlc3NpYmxlIiwiYWJzb2x1dGVQYXRoIiwiam9pbiIsImVycm9yIiwibWVzc2FnZSIsInJlYWRGaWxlIiwiZW5jb2RpbmciLCJjb25zb2xlIiwibG9nIiwidmFsaWRQYXRoIiwic3RhdHMiLCJzdGF0Iiwic2l6ZSIsImlzRmlsZSIsInN1Y2Nlc3MiLCJzdGF0RXJyb3IiLCJkYXRhIiwicHJldmlldyIsInN1YnN0cmluZyIsImxlbmd0aCIsIndyaXRlRmlsZSIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiZGlyUGF0aCIsImRpcm5hbWUiLCJta2RpciIsInJlY3Vyc2l2ZSIsImRhdGFUb1dyaXRlIiwiZGF0YUVuY29kaW5nIiwib3JpZ2luYWxEYXRhTGVuZ3RoIiwiaXNCYXNlNjQiLCJzdGFydHNXaXRoIiwiYmFzZTY0RGF0YSIsIndhcm4iLCJleHBlY3RlZFNpemUiLCJNYXRoIiwiY2VpbCIsImZyb20iLCJzaWduYXR1cmUiLCJzbGljZSIsInRvU3RyaW5nIiwiZGVjb2RlRXJyb3IiLCJ3cml0ZVN0YXJ0VGltZSIsIkRhdGUiLCJub3ciLCJ3cml0ZVRpbWUiLCJjcmVhdGVkIiwiYmlydGh0aW1lIiwibW9kaWZpZWQiLCJtdGltZSIsInZlcmlmeUVycm9yIiwiY3JlYXRlRGlyZWN0b3J5IiwibGlzdERpcmVjdG9yeSIsImVudHJpZXMiLCJyZWFkZGlyIiwid2l0aEZpbGVUeXBlcyIsImZpbHRlcmVkRW50cmllcyIsImV4dGVuc2lvbnMiLCJBcnJheSIsImlzQXJyYXkiLCJtYXAiLCJleHQiLCJmaWx0ZXIiLCJlbnRyeSIsImlzRGlyZWN0b3J5Iiwic29tZSIsIm5hbWUiLCJ0b0xvd2VyQ2FzZSIsImVuZHNXaXRoIiwiaXRlbXMiLCJQcm9taXNlIiwiYWxsIiwiZW50cnlQYXRoIiwiZXh0ZW5zaW9uIiwiZXh0bmFtZSIsInR5cGUiLCJyZWxhdGl2ZVBhdGgiLCJyZWxhdGl2ZSIsInNvcnQiLCJhIiwiYiIsImxvY2FsZUNvbXBhcmUiLCJkaXJlY3RvcmllcyIsIml0ZW0iLCJkaXIiLCJzdWJEaXJSZXN1bHQiLCJzdWJJdGVtcyIsInB1c2giLCJkZWxldGUiLCJpdGVtUGF0aCIsInJtIiwidW5saW5rIiwiZ2V0U3RhdHMiLCJtb3ZlIiwic291cmNlUGF0aCIsImRlc3RQYXRoIiwidmFsaWRTb3VyY2VQYXRoIiwidmFsaWREZXN0UGF0aCIsInJlbmFtZSIsImNyZWF0ZVRlbXBvcmFyeURpcmVjdG9yeSIsInByZWZpeCIsInRlbXBEaXIiLCJ0bXBkaXIiLCJmdWxsUHJlZml4UGF0aCIsImNyZWF0ZWREaXJQYXRoIiwibWtkdGVtcCIsImFkZCIsInJlbGVhc2VUZW1wb3JhcnlEaXJlY3RvcnkiLCJoYXMiLCJjbGVhbnVwVGVtcG9yYXJ5RGlyZWN0b3J5IiwiZm9yY2UiLCJjb2RlIiwiY2xlYW51cE9ycGhhbmVkVGVtcG9yYXJ5RGlyZWN0b3JpZXMiLCJjbGVhbnVwUHJvbWlzZXMiLCJjbGVhciIsImZpbGVTeXN0ZW1TZXJ2aWNlSW5zdGFuY2UiLCJvbiIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvRmlsZVN5c3RlbVNlcnZpY2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIEZpbGVTeXN0ZW1TZXJ2aWNlLmpzXHJcbiAqIEhhbmRsZXMgbmF0aXZlIGZpbGUgc3lzdGVtIG9wZXJhdGlvbnMgZm9yIHRoZSBFbGVjdHJvbiBhcHBsaWNhdGlvbi5cclxuICogUHJvdmlkZXMgc2VjdXJlIGZpbGUgYWNjZXNzLCBwYXRoIG5vcm1hbGl6YXRpb24sIGFuZCBkaXJlY3RvcnkgbWFuYWdlbWVudC5cclxuICogXHJcbiAqIFRoaXMgc2VydmljZSBpcyB1c2VkIGJ5IElQQyBoYW5kbGVycyB0byBwZXJmb3JtIGZpbGUgb3BlcmF0aW9ucyByZXF1ZXN0ZWRcclxuICogYnkgdGhlIHJlbmRlcmVyIHByb2Nlc3MuIEl0IGltcGxlbWVudHMgc2VjdXJpdHkgY2hlY2tzIGFuZCBlcnJvciBoYW5kbGluZ1xyXG4gKiB0byBlbnN1cmUgc2FmZSBmaWxlIHN5c3RlbSBhY2Nlc3MuXHJcbiAqL1xyXG5cclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy9wcm9taXNlcycpO1xyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCBvcyA9IHJlcXVpcmUoJ29zJyk7IC8vIEFkZGVkIGZvciB0ZW1wb3JhcnkgZGlyZWN0b3J5XHJcbmNvbnN0IHsgYXBwIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCB7IFBhdGhVdGlscyB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvcGF0aHMnKTtcclxuY29uc3QgbG9nZ2VyID0gcmVxdWlyZSgnLi4vdXRpbHMvbG9nZ2VyJyk7IC8vIEFzc3VtaW5nIGEgbG9nZ2VyIHV0aWxpdHkgZXhpc3RzXHJcblxyXG5jbGFzcyBGaWxlU3lzdGVtU2VydmljZSB7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmFwcERhdGFQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoYXBwLmdldFBhdGgoJ3VzZXJEYXRhJykpO1xyXG4gICAgdGhpcy5kb2N1bWVudHNQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoYXBwLmdldFBhdGgoJ2RvY3VtZW50cycpKTtcclxuICAgIHRoaXMuYWN0aXZlVGVtcG9yYXJ5RGlycyA9IG5ldyBTZXQoKTsgLy8gVHJhY2sgYWN0aXZlIHRlbXBvcmFyeSBkaXJlY3Rvcmllc1xyXG4gICAgbG9nZ2VyLmluZm8oJ1tGaWxlU3lzdGVtU2VydmljZV0gSW5pdGlhbGl6ZWQnKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFZhbGlkYXRlcyBhbmQgbm9ybWFsaXplcyBhIGZpbGUgcGF0aCBmb3Igc2VjdXJpdHlcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBUaGUgcGF0aCB0byB2YWxpZGF0ZVxyXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gc2hvdWxkRXhpc3QgLSBXaGV0aGVyIHRoZSBwYXRoIHNob3VsZCBhbHJlYWR5IGV4aXN0XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBBZGRpdGlvbmFsIHZhbGlkYXRpb24gb3B0aW9uc1xyXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gb3B0aW9ucy5pc1VybCAtIFdoZXRoZXIgdGhlIHBhdGggb3JpZ2luYXRlZCBmcm9tIGEgVVJMXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gTm9ybWFsaXplZCBhYnNvbHV0ZSBwYXRoXHJcbiAgICogQHRocm93cyB7RXJyb3J9IElmIHBhdGggaXMgaW52YWxpZCBvciBhY2Nlc3MgaXMgZGVuaWVkXHJcbiAgICovXHJcbiAgYXN5bmMgdmFsaWRhdGVQYXRoKGZpbGVQYXRoLCBzaG91bGRFeGlzdCA9IHRydWUsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgaWYgKCFmaWxlUGF0aCB8fCB0eXBlb2YgZmlsZVBhdGggIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBmaWxlIHBhdGgnKTtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBpc0Fic29sdXRlID0gcGF0aC5pc0Fic29sdXRlKGZpbGVQYXRoKTtcclxuICAgICAgY29uc3QgaXNVcmwgPSBvcHRpb25zLmlzVXJsIHx8IC9eaHR0cHM/OlxcL1xcLy8udGVzdChmaWxlUGF0aCk7XHJcblxyXG4gICAgICAvLyBGaXJzdCBub3JtYWxpemUgdGhlIHBhdGggdXNpbmcgTm9kZSdzIHBhdGggbW9kdWxlXHJcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRQYXRoID0gcGF0aC5ub3JtYWxpemUoZmlsZVBhdGgpO1xyXG4gICAgICBcclxuICAgICAgLy8gRm9yIGFic29sdXRlIFdpbmRvd3MgcGF0aHMsIHZhbGlkYXRlIHRoZSBwYXRoIGRpcmVjdGx5XHJcbiAgICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInICYmIGlzQWJzb2x1dGUpIHtcclxuICAgICAgICBjb25zdCB2YWxpZGF0ZWRQYXRoID0gYXdhaXQgUGF0aFV0aWxzLmVuc3VyZVZhbGlkUGF0aChub3JtYWxpemVkUGF0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHNob3VsZEV4aXN0ICYmICFhd2FpdCBQYXRoVXRpbHMuaXNBY2Nlc3NpYmxlKG5vcm1hbGl6ZWRQYXRoKSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBQYXRoIGRvZXMgbm90IGV4aXN0IG9yIGFjY2VzcyBkZW5pZWQ6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBub3JtYWxpemVkUGF0aDtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gRm9yIG5vbi1hYnNvbHV0ZSBvciBub24tV2luZG93cyBwYXRocywgdmFsaWRhdGUgd2l0aCBVUkwgYXdhcmVuZXNzXHJcbiAgICAgIFBhdGhVdGlscy5lbnN1cmVWYWxpZFBhdGgoZmlsZVBhdGgsIHsgaXNVcmwgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDb252ZXJ0IHRvIGFic29sdXRlIHBhdGggYXMgbmVlZGVkXHJcbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IGlzQWJzb2x1dGUgPyBcclxuICAgICAgICBub3JtYWxpemVkUGF0aCA6IFxyXG4gICAgICAgIFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKHBhdGguam9pbih0aGlzLmRvY3VtZW50c1BhdGgsIG5vcm1hbGl6ZWRQYXRoKSk7XHJcblxyXG4gICAgICBpZiAoc2hvdWxkRXhpc3QgJiYgIWF3YWl0IFBhdGhVdGlscy5pc0FjY2Vzc2libGUoYWJzb2x1dGVQYXRoKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUGF0aCBkb2VzIG5vdCBleGlzdCBvciBhY2Nlc3MgZGVuaWVkOiAke2ZpbGVQYXRofWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gYWJzb2x1dGVQYXRoO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBQYXRoIHZhbGlkYXRpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSZWFkcyBhIGZpbGUgc2FmZWx5XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgZmlsZVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBlbmNvZGluZyAtIEZpbGUgZW5jb2RpbmcgKGRlZmF1bHQ6ICd1dGY4JylcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgZGF0YT86IGFueSwgZXJyb3I/OiBzdHJpbmd9Pn1cclxuICAgKi9cclxuICBhc3luYyByZWFkRmlsZShmaWxlUGF0aCwgZW5jb2RpbmcgPSAndXRmOCcpIHtcclxuICAgIGNvbnNvbGUubG9nKGDwn5OWIFJlYWRpbmcgZmlsZTogJHtmaWxlUGF0aH0gd2l0aCBlbmNvZGluZzogJHtlbmNvZGluZ31gKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHZhbGlkUGF0aCA9IGF3YWl0IHRoaXMudmFsaWRhdGVQYXRoKGZpbGVQYXRoKTtcclxuICAgICAgY29uc29sZS5sb2coYOKckyBQYXRoIHZhbGlkYXRlZDogJHt2YWxpZFBhdGh9YCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBpZiBmaWxlIGV4aXN0cyBiZWZvcmUgcmVhZGluZ1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdCh2YWxpZFBhdGgpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OKIEZpbGUgc3RhdHM6IHNpemU9JHtzdGF0cy5zaXplfSwgaXNGaWxlPSR7c3RhdHMuaXNGaWxlKCl9YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFzdGF0cy5pc0ZpbGUoKSkge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIE5vdCBhIGZpbGU6ICR7dmFsaWRQYXRofWApO1xyXG4gICAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICAgICAgZXJyb3I6IGBOb3QgYSBmaWxlOiAke2ZpbGVQYXRofWAgXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoc3RhdEVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIEZpbGUgc3RhdCBlcnJvcjogJHtzdGF0RXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICByZXR1cm4geyBcclxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICAgIGVycm9yOiBgRmlsZSBub3QgYWNjZXNzaWJsZTogJHtzdGF0RXJyb3IubWVzc2FnZX1gIFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFJlYWQgdGhlIGZpbGVcclxuICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGZzLnJlYWRGaWxlKHZhbGlkUGF0aCwgeyBlbmNvZGluZyB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIExvZyBzdWNjZXNzIHdpdGggZGF0YSBwcmV2aWV3XHJcbiAgICAgIGNvbnN0IHByZXZpZXcgPSB0eXBlb2YgZGF0YSA9PT0gJ3N0cmluZycgXHJcbiAgICAgICAgPyBgJHtkYXRhLnN1YnN0cmluZygwLCA1MCl9JHtkYXRhLmxlbmd0aCA+IDUwID8gJy4uLicgOiAnJ31gXHJcbiAgICAgICAgOiBgPEJ1ZmZlcjogJHtkYXRhLmxlbmd0aH0gYnl0ZXM+YDtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGDinIUgRmlsZSByZWFkIHN1Y2Nlc3NmdWxseTogJHt2YWxpZFBhdGh9ICgke3R5cGVvZiBkYXRhfSwgJHtkYXRhLmxlbmd0aH0gYnl0ZXMpYCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OEIERhdGEgcHJldmlldzogJHtwcmV2aWV3fWApO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgZGF0YSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihg4p2MIEZhaWxlZCB0byByZWFkIGZpbGU6ICR7ZmlsZVBhdGh9YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4geyBcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSwgXHJcbiAgICAgICAgZXJyb3I6IGBGYWlsZWQgdG8gcmVhZCBmaWxlOiAke2Vycm9yLm1lc3NhZ2V9YCBcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFdyaXRlcyBkYXRhIHRvIGEgZmlsZSBzYWZlbHlcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIHdyaXRlIHRoZSBmaWxlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd8QnVmZmVyfSBkYXRhIC0gRGF0YSB0byB3cml0ZVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBlbmNvZGluZyAtIEZpbGUgZW5jb2RpbmcgKGRlZmF1bHQ6ICd1dGY4JylcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBzdHJpbmcsIHN0YXRzPzogT2JqZWN0fT59XHJcbiAgICovXHJcbiAgYXN5bmMgd3JpdGVGaWxlKGZpbGVQYXRoLCBkYXRhLCBlbmNvZGluZyA9ICd1dGY4Jykge1xyXG4gICAgY29uc29sZS5sb2coYPCfkr4gW0ZpbGVTeXN0ZW1TZXJ2aWNlXSBXcml0aW5nIGZpbGU6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+TiiBbRmlsZVN5c3RlbVNlcnZpY2VdIERhdGEgdHlwZTogJHt0eXBlb2YgZGF0YX0sICR7QnVmZmVyLmlzQnVmZmVyKGRhdGEpID8gJ0J1ZmZlcicgOiAnTm90IEJ1ZmZlcid9LCBMZW5ndGg6ICR7ZGF0YSA/IGRhdGEubGVuZ3RoIDogJ251bGwnfWApO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB2YWxpZFBhdGggPSBhd2FpdCB0aGlzLnZhbGlkYXRlUGF0aChmaWxlUGF0aCwgZmFsc2UpO1xyXG4gICAgICBjb25zb2xlLmxvZyhg4pyTIFtGaWxlU3lzdGVtU2VydmljZV0gUGF0aCB2YWxpZGF0ZWQ6ICR7dmFsaWRQYXRofWApO1xyXG4gICAgICBcclxuICAgICAgLy8gRW5zdXJlIGRpcmVjdG9yeSBleGlzdHNcclxuICAgICAgY29uc3QgZGlyUGF0aCA9IHBhdGguZGlybmFtZSh2YWxpZFBhdGgpO1xyXG4gICAgICBhd2FpdCBmcy5ta2RpcihkaXJQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcclxuICAgICAgY29uc29sZS5sb2coYPCfk4EgW0ZpbGVTeXN0ZW1TZXJ2aWNlXSBFbnN1cmVkIGRpcmVjdG9yeSBleGlzdHM6ICR7ZGlyUGF0aH1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGlmIHRoaXMgaXMgYmFzZTY0IGRhdGEgdGhhdCBuZWVkcyB0byBiZSBkZWNvZGVkXHJcbiAgICAgIGxldCBkYXRhVG9Xcml0ZSA9IGRhdGE7XHJcbiAgICAgIGxldCBkYXRhRW5jb2RpbmcgPSBlbmNvZGluZztcclxuICAgICAgbGV0IG9yaWdpbmFsRGF0YUxlbmd0aCA9IGRhdGEgPyBkYXRhLmxlbmd0aCA6IDA7XHJcbiAgICAgIGxldCBpc0Jhc2U2NCA9IGZhbHNlO1xyXG4gICAgICBcclxuICAgICAgaWYgKHR5cGVvZiBkYXRhID09PSAnc3RyaW5nJyAmJiBkYXRhLnN0YXJ0c1dpdGgoJ0JBU0U2NDonKSkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5SEIFtGaWxlU3lzdGVtU2VydmljZV0gRGV0ZWN0ZWQgQkFTRTY0IHByZWZpeCwgZGVjb2RpbmcgYmluYXJ5IGRhdGFgKTtcclxuICAgICAgICBpc0Jhc2U2NCA9IHRydWU7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmVtb3ZlIHRoZSBwcmVmaXggYW5kIGRlY29kZSBiYXNlNjQgdG8gYmluYXJ5XHJcbiAgICAgICAgY29uc3QgYmFzZTY0RGF0YSA9IGRhdGEuc3Vic3RyaW5nKDcpOyAvLyBSZW1vdmUgJ0JBU0U2NDonIHByZWZpeFxyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OKIFtGaWxlU3lzdGVtU2VydmljZV0gQmFzZTY0IGRhdGEgbGVuZ3RoOiAke2Jhc2U2NERhdGEubGVuZ3RofSBjaGFyYWN0ZXJzYCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgaWYgYmFzZTY0IGRhdGEgaXMgdmFsaWRcclxuICAgICAgICBpZiAoYmFzZTY0RGF0YS5sZW5ndGggJSA0ICE9PSAwKSB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbRmlsZVN5c3RlbVNlcnZpY2VdIEJhc2U2NCBkYXRhIGxlbmd0aCBpcyBub3QgYSBtdWx0aXBsZSBvZiA0OiAke2Jhc2U2NERhdGEubGVuZ3RofWApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBDYWxjdWxhdGUgZXhwZWN0ZWQgZGVjb2RlZCBzaXplXHJcbiAgICAgICAgY29uc3QgZXhwZWN0ZWRTaXplID0gTWF0aC5jZWlsKGJhc2U2NERhdGEubGVuZ3RoICogMC43NSk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4ogW0ZpbGVTeXN0ZW1TZXJ2aWNlXSBFeHBlY3RlZCBkZWNvZGVkIHNpemU6IH4ke2V4cGVjdGVkU2l6ZX0gYnl0ZXNgKTtcclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgZGF0YVRvV3JpdGUgPSBCdWZmZXIuZnJvbShiYXNlNjREYXRhLCAnYmFzZTY0Jyk7XHJcbiAgICAgICAgICBkYXRhRW5jb2RpbmcgPSBudWxsOyAvLyBVc2UgbnVsbCBlbmNvZGluZyBmb3IgYmluYXJ5IGRhdGFcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5OKIFtGaWxlU3lzdGVtU2VydmljZV0gRGVjb2RlZCBiYXNlNjQgZGF0YSB0byBiaW5hcnkgYnVmZmVyOiAke2RhdGFUb1dyaXRlLmxlbmd0aH0gYnl0ZXNgKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gVmVyaWZ5IGJ1ZmZlciBpbnRlZ3JpdHlcclxuICAgICAgICAgIGlmIChkYXRhVG9Xcml0ZS5sZW5ndGggPCBleHBlY3RlZFNpemUgKiAwLjkpIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gW0ZpbGVTeXN0ZW1TZXJ2aWNlXSBEZWNvZGVkIHNpemUgKCR7ZGF0YVRvV3JpdGUubGVuZ3RofSkgaXMgc2lnbmlmaWNhbnRseSBzbWFsbGVyIHRoYW4gZXhwZWN0ZWQgKCR7ZXhwZWN0ZWRTaXplfSlgKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gQ2hlY2sgZm9yIFpJUCBzaWduYXR1cmUgKFBLIGhlYWRlcikgZm9yIFBQVFgsIERPQ1gsIGV0Yy5cclxuICAgICAgICAgIGlmIChkYXRhVG9Xcml0ZS5sZW5ndGggPj0gNCkge1xyXG4gICAgICAgICAgICBjb25zdCBzaWduYXR1cmUgPSBkYXRhVG9Xcml0ZS5zbGljZSgwLCA0KTtcclxuICAgICAgICAgICAgaWYgKHNpZ25hdHVyZVswXSA9PT0gMHg1MCAmJiBzaWduYXR1cmVbMV0gPT09IDB4NEIpIHtcclxuICAgICAgICAgICAgICBjb25zb2xlLmxvZyhg4pyFIFtGaWxlU3lzdGVtU2VydmljZV0gVmFsaWQgWklQIHNpZ25hdHVyZSBkZXRlY3RlZCAoUEsgaGVhZGVyKWApO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFtGaWxlU3lzdGVtU2VydmljZV0gTm8gWklQIHNpZ25hdHVyZSBmb3VuZCBpbiBiaW5hcnkgZGF0YTogJHtzaWduYXR1cmUudG9TdHJpbmcoJ2hleCcpfWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZGVjb2RlRXJyb3IpIHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBbRmlsZVN5c3RlbVNlcnZpY2VdIEJhc2U2NCBkZWNvZGluZyBmYWlsZWQ6ICR7ZGVjb2RlRXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQmFzZTY0IGRlY29kaW5nIGZhaWxlZDogJHtkZWNvZGVFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gV3JpdGUgdGhlIGZpbGVcclxuICAgICAgY29uc3Qgd3JpdGVTdGFydFRpbWUgPSBEYXRlLm5vdygpO1xyXG4gICAgICBhd2FpdCBmcy53cml0ZUZpbGUodmFsaWRQYXRoLCBkYXRhVG9Xcml0ZSwgeyBlbmNvZGluZzogZGF0YUVuY29kaW5nIH0pO1xyXG4gICAgICBjb25zdCB3cml0ZVRpbWUgPSBEYXRlLm5vdygpIC0gd3JpdGVTdGFydFRpbWU7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDij7HvuI8gW0ZpbGVTeXN0ZW1TZXJ2aWNlXSBXcml0ZSBvcGVyYXRpb24gdG9vayAke3dyaXRlVGltZX1tc2ApO1xyXG4gICAgICBcclxuICAgICAgLy8gVmVyaWZ5IHRoZSBmaWxlIHdhcyB3cml0dGVuXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KHZhbGlkUGF0aCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBbRmlsZVN5c3RlbVNlcnZpY2VdIEZpbGUgd3JpdHRlbiBzdWNjZXNzZnVsbHk6ICR7dmFsaWRQYXRofSAoJHtzdGF0cy5zaXplfSBieXRlcylgKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBWZXJpZnkgZmlsZSBzaXplXHJcbiAgICAgICAgaWYgKGlzQmFzZTY0KSB7XHJcbiAgICAgICAgICAvLyBGb3IgYmFzZTY0IGRhdGEsIGNvbXBhcmUgd2l0aCB0aGUgZGVjb2RlZCBidWZmZXIgc2l6ZVxyXG4gICAgICAgICAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihkYXRhVG9Xcml0ZSkgJiYgc3RhdHMuc2l6ZSAhPT0gZGF0YVRvV3JpdGUubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFtGaWxlU3lzdGVtU2VydmljZV0gRmlsZSBzaXplIG1pc21hdGNoISBFeHBlY3RlZDogJHtkYXRhVG9Xcml0ZS5sZW5ndGh9LCBBY3R1YWw6ICR7c3RhdHMuc2l6ZX1gKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBkYXRhID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgLy8gRm9yIHRleHQgZGF0YSwgY29tcGFyZSB3aXRoIG9yaWdpbmFsIHN0cmluZyBsZW5ndGhcclxuICAgICAgICAgIGlmIChzdGF0cy5zaXplIDwgb3JpZ2luYWxEYXRhTGVuZ3RoICogMC45KSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFtGaWxlU3lzdGVtU2VydmljZV0gRmlsZSBzaXplIHNtYWxsZXIgdGhhbiBleHBlY3RlZCEgT3JpZ2luYWwgZGF0YTogJHtvcmlnaW5hbERhdGFMZW5ndGh9LCBGaWxlIHNpemU6ICR7c3RhdHMuc2l6ZX1gKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmV0dXJuIHN1Y2Nlc3Mgd2l0aCBmaWxlIHN0YXRzXHJcbiAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgICAgc3RhdHM6IHtcclxuICAgICAgICAgICAgc2l6ZTogc3RhdHMuc2l6ZSxcclxuICAgICAgICAgICAgY3JlYXRlZDogc3RhdHMuYmlydGh0aW1lLFxyXG4gICAgICAgICAgICBtb2RpZmllZDogc3RhdHMubXRpbWVcclxuICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG4gICAgICB9IGNhdGNoICh2ZXJpZnlFcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYOKaoO+4jyBbRmlsZVN5c3RlbVNlcnZpY2VdIEZpbGUgd3JpdHRlbiBidXQgdmVyaWZpY2F0aW9uIGZhaWxlZDogJHt2ZXJpZnlFcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTsgLy8gU3RpbGwgcmV0dXJuIHN1Y2Nlc3Mgc2luY2Ugd3JpdGUgc3VjY2VlZGVkXHJcbiAgICAgIH1cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBbRmlsZVN5c3RlbVNlcnZpY2VdIEZhaWxlZCB0byB3cml0ZSBmaWxlOiAke2ZpbGVQYXRofWAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsIFxyXG4gICAgICAgIGVycm9yOiBgRmFpbGVkIHRvIHdyaXRlIGZpbGU6ICR7ZXJyb3IubWVzc2FnZX1gIFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlcyBhIGRpcmVjdG9yeSBhbmQgYW55IG5lY2Vzc2FyeSBwYXJlbnQgZGlyZWN0b3JpZXNcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlyUGF0aCAtIFBhdGggdG8gY3JlYXRlXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8e3N1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogc3RyaW5nfT59XHJcbiAgICovXHJcbiAgYXN5bmMgY3JlYXRlRGlyZWN0b3J5KGRpclBhdGgpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHZhbGlkUGF0aCA9IGF3YWl0IHRoaXMudmFsaWRhdGVQYXRoKGRpclBhdGgsIGZhbHNlKTtcclxuICAgICAgYXdhaXQgZnMubWtkaXIodmFsaWRQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYEZhaWxlZCB0byBjcmVhdGUgZGlyZWN0b3J5OiAke2Vycm9yLm1lc3NhZ2V9YFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogTGlzdHMgY29udGVudHMgb2YgYSBkaXJlY3Rvcnkgd2l0aCBkZXRhaWxlZCBpbmZvcm1hdGlvblxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaXJQYXRoIC0gUGF0aCB0byBsaXN0XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBMaXN0aW5nIG9wdGlvbnNcclxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG9wdGlvbnMucmVjdXJzaXZlIC0gV2hldGhlciB0byBsaXN0IHJlY3Vyc2l2ZWx5XHJcbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gb3B0aW9ucy5leHRlbnNpb25zIC0gRmlsZSBleHRlbnNpb25zIHRvIGZpbHRlciAoZS5nLiwgWydtZCcsICd0eHQnXSlcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgaXRlbXM/OiBBcnJheTxPYmplY3Q+LCBlcnJvcj86IHN0cmluZ30+fVxyXG4gICAqL1xyXG4gIGFzeW5jIGxpc3REaXJlY3RvcnkoZGlyUGF0aCwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB2YWxpZFBhdGggPSBhd2FpdCB0aGlzLnZhbGlkYXRlUGF0aChkaXJQYXRoKTtcclxuICAgICAgY29uc3QgZW50cmllcyA9IGF3YWl0IGZzLnJlYWRkaXIodmFsaWRQYXRoLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBGaWx0ZXIgZW50cmllcyBpZiBleHRlbnNpb25zIGFyZSBwcm92aWRlZFxyXG4gICAgICBsZXQgZmlsdGVyZWRFbnRyaWVzID0gZW50cmllcztcclxuICAgICAgaWYgKG9wdGlvbnMuZXh0ZW5zaW9ucyAmJiBBcnJheS5pc0FycmF5KG9wdGlvbnMuZXh0ZW5zaW9ucykgJiYgb3B0aW9ucy5leHRlbnNpb25zLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zdCBleHRlbnNpb25zID0gb3B0aW9ucy5leHRlbnNpb25zLm1hcChleHQgPT4gZXh0LnN0YXJ0c1dpdGgoJy4nKSA/IGV4dCA6IGAuJHtleHR9YCk7XHJcbiAgICAgICAgZmlsdGVyZWRFbnRyaWVzID0gZW50cmllcy5maWx0ZXIoZW50cnkgPT4gXHJcbiAgICAgICAgICBlbnRyeS5pc0RpcmVjdG9yeSgpIHx8IFxyXG4gICAgICAgICAgZXh0ZW5zaW9ucy5zb21lKGV4dCA9PiBlbnRyeS5uYW1lLnRvTG93ZXJDYXNlKCkuZW5kc1dpdGgoZXh0LnRvTG93ZXJDYXNlKCkpKVxyXG4gICAgICAgICk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIE1hcCBlbnRyaWVzIHRvIGl0ZW0gb2JqZWN0cyB3aXRoIGRldGFpbGVkIGluZm9ybWF0aW9uXHJcbiAgICAgIGNvbnN0IGl0ZW1zID0gYXdhaXQgUHJvbWlzZS5hbGwoZmlsdGVyZWRFbnRyaWVzLm1hcChhc3luYyBlbnRyeSA9PiB7XHJcbiAgICAgICAgY29uc3QgZW50cnlQYXRoID0gcGF0aC5qb2luKHZhbGlkUGF0aCwgZW50cnkubmFtZSk7XHJcbiAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KGVudHJ5UGF0aCk7XHJcbiAgICAgICAgY29uc3QgZXh0ZW5zaW9uID0gZW50cnkuaXNGaWxlKCkgPyBwYXRoLmV4dG5hbWUoZW50cnkubmFtZSkuc2xpY2UoMSkudG9Mb3dlckNhc2UoKSA6ICcnO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxyXG4gICAgICAgICAgcGF0aDogZW50cnlQYXRoLFxyXG4gICAgICAgICAgaXNEaXJlY3Rvcnk6IGVudHJ5LmlzRGlyZWN0b3J5KCksXHJcbiAgICAgICAgICBzaXplOiBzdGF0cy5zaXplLFxyXG4gICAgICAgICAgbW9kaWZpZWQ6IHN0YXRzLm10aW1lLFxyXG4gICAgICAgICAgY3JlYXRlZDogc3RhdHMuYmlydGh0aW1lLFxyXG4gICAgICAgICAgdHlwZTogZXh0ZW5zaW9uLFxyXG4gICAgICAgICAgcmVsYXRpdmVQYXRoOiBwYXRoLnJlbGF0aXZlKHZhbGlkUGF0aCwgZW50cnlQYXRoKVxyXG4gICAgICAgIH07XHJcbiAgICAgIH0pKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFNvcnQgaXRlbXM6IGRpcmVjdG9yaWVzIGZpcnN0LCB0aGVuIGZpbGVzIGFscGhhYmV0aWNhbGx5XHJcbiAgICAgIGl0ZW1zLnNvcnQoKGEsIGIpID0+IHtcclxuICAgICAgICBpZiAoYS5pc0RpcmVjdG9yeSAmJiAhYi5pc0RpcmVjdG9yeSkgcmV0dXJuIC0xO1xyXG4gICAgICAgIGlmICghYS5pc0RpcmVjdG9yeSAmJiBiLmlzRGlyZWN0b3J5KSByZXR1cm4gMTtcclxuICAgICAgICByZXR1cm4gYS5uYW1lLmxvY2FsZUNvbXBhcmUoYi5uYW1lKTtcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBJZiByZWN1cnNpdmUgb3B0aW9uIGlzIHRydWUsIGluY2x1ZGUgc3ViZGlyZWN0b3J5IGNvbnRlbnRzXHJcbiAgICAgIGlmIChvcHRpb25zLnJlY3Vyc2l2ZSkge1xyXG4gICAgICAgIGNvbnN0IGRpcmVjdG9yaWVzID0gaXRlbXMuZmlsdGVyKGl0ZW0gPT4gaXRlbS5pc0RpcmVjdG9yeSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yIChjb25zdCBkaXIgb2YgZGlyZWN0b3JpZXMpIHtcclxuICAgICAgICAgIGNvbnN0IHN1YkRpclJlc3VsdCA9IGF3YWl0IHRoaXMubGlzdERpcmVjdG9yeShkaXIucGF0aCwge1xyXG4gICAgICAgICAgICAuLi5vcHRpb25zLFxyXG4gICAgICAgICAgICByZWN1cnNpdmU6IHRydWVcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBpZiAoc3ViRGlyUmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICAgICAgLy8gQWRkIHN1YmRpcmVjdG9yeSBwYXRoIHRvIGVhY2ggaXRlbVxyXG4gICAgICAgICAgICBjb25zdCBzdWJJdGVtcyA9IHN1YkRpclJlc3VsdC5pdGVtcy5tYXAoaXRlbSA9PiAoe1xyXG4gICAgICAgICAgICAgIC4uLml0ZW0sXHJcbiAgICAgICAgICAgICAgcmVsYXRpdmVQYXRoOiBwYXRoLnJlbGF0aXZlKHZhbGlkUGF0aCwgaXRlbS5wYXRoKVxyXG4gICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpdGVtcy5wdXNoKC4uLnN1Ykl0ZW1zKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGl0ZW1zIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBgRmFpbGVkIHRvIGxpc3QgZGlyZWN0b3J5OiAke2Vycm9yLm1lc3NhZ2V9YFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRGVsZXRlcyBhIGZpbGUgb3IgZGlyZWN0b3J5XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGl0ZW1QYXRoIC0gUGF0aCB0byBkZWxldGVcclxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IHJlY3Vyc2l2ZSAtIFdoZXRoZXIgdG8gZGVsZXRlIGRpcmVjdG9yaWVzIHJlY3Vyc2l2ZWx5XHJcbiAgICogQHJldHVybnMge1Byb21pc2U8e3N1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogc3RyaW5nfT59XHJcbiAgICovXHJcbiAgYXN5bmMgZGVsZXRlKGl0ZW1QYXRoLCByZWN1cnNpdmUgPSBmYWxzZSkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgdmFsaWRQYXRoID0gYXdhaXQgdGhpcy52YWxpZGF0ZVBhdGgoaXRlbVBhdGgpO1xyXG4gICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQodmFsaWRQYXRoKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChzdGF0cy5pc0RpcmVjdG9yeSgpKSB7XHJcbiAgICAgICAgYXdhaXQgZnMucm0odmFsaWRQYXRoLCB7IHJlY3Vyc2l2ZSB9KTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBhd2FpdCBmcy51bmxpbmsodmFsaWRQYXRoKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYEZhaWxlZCB0byBkZWxldGU6ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZXRzIGZpbGUgb3IgZGlyZWN0b3J5IGluZm9ybWF0aW9uXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGl0ZW1QYXRoIC0gUGF0aCB0byBjaGVja1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzdWNjZXNzOiBib29sZWFuLCBzdGF0cz86IE9iamVjdCwgZXJyb3I/OiBzdHJpbmd9Pn1cclxuICAgKi9cclxuICBhc3luYyBnZXRTdGF0cyhpdGVtUGF0aCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgdmFsaWRQYXRoID0gYXdhaXQgdGhpcy52YWxpZGF0ZVBhdGgoaXRlbVBhdGgpO1xyXG4gICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQodmFsaWRQYXRoKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIHN0YXRzOiB7XHJcbiAgICAgICAgICBzaXplOiBzdGF0cy5zaXplLFxyXG4gICAgICAgICAgY3JlYXRlZDogc3RhdHMuYmlydGh0aW1lLFxyXG4gICAgICAgICAgbW9kaWZpZWQ6IHN0YXRzLm10aW1lLFxyXG4gICAgICAgICAgaXNEaXJlY3Rvcnk6IHN0YXRzLmlzRGlyZWN0b3J5KCksXHJcbiAgICAgICAgICBpc0ZpbGU6IHN0YXRzLmlzRmlsZSgpXHJcbiAgICAgICAgfVxyXG4gICAgICB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYEZhaWxlZCB0byBnZXQgc3RhdHM6ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBNb3ZlcyBhIGZpbGUgb3IgZGlyZWN0b3J5XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHNvdXJjZVBhdGggLSBTb3VyY2UgcGF0aFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkZXN0UGF0aCAtIERlc3RpbmF0aW9uIHBhdGhcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBzdHJpbmd9Pn1cclxuICAgKi9cclxuICBhc3luYyBtb3ZlKHNvdXJjZVBhdGgsIGRlc3RQYXRoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB2YWxpZFNvdXJjZVBhdGggPSBhd2FpdCB0aGlzLnZhbGlkYXRlUGF0aChzb3VyY2VQYXRoKTtcclxuICAgICAgY29uc3QgdmFsaWREZXN0UGF0aCA9IGF3YWl0IHRoaXMudmFsaWRhdGVQYXRoKGRlc3RQYXRoLCBmYWxzZSk7XHJcbiAgICAgIGF3YWl0IGZzLnJlbmFtZSh2YWxpZFNvdXJjZVBhdGgsIHZhbGlkRGVzdFBhdGgpO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBgRmFpbGVkIHRvIG1vdmU6ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG4gIC8qKlxyXG4gICAqIENyZWF0ZXMgYSB1bmlxdWUgdGVtcG9yYXJ5IGRpcmVjdG9yeS5cclxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJlZml4IC0gQSBwcmVmaXggZm9yIHRoZSB0ZW1wb3JhcnkgZGlyZWN0b3J5IG5hbWUuXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gVGhlIHBhdGggdG8gdGhlIGNyZWF0ZWQgdGVtcG9yYXJ5IGRpcmVjdG9yeS5cclxuICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgZGlyZWN0b3J5IGNyZWF0aW9uIGZhaWxzLlxyXG4gICAqL1xyXG4gIGFzeW5jIGNyZWF0ZVRlbXBvcmFyeURpcmVjdG9yeShwcmVmaXggPSAnY29kZXhtZC10ZW1wLScpIHtcclxuICAgIGxvZ2dlci5pbmZvKGBbRmlsZVN5c3RlbVNlcnZpY2VdIENyZWF0aW5nIHRlbXBvcmFyeSBkaXJlY3Rvcnkgd2l0aCBwcmVmaXg6ICR7cHJlZml4fWApO1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVXNlIG9zLnRtcGRpcigpIHRvIGdldCB0aGUgc3lzdGVtJ3MgdGVtcG9yYXJ5IGRpcmVjdG9yeVxyXG4gICAgICBjb25zdCB0ZW1wRGlyID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgob3MudG1wZGlyKCkpO1xyXG4gICAgICBjb25zdCBmdWxsUHJlZml4UGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKHBhdGguam9pbih0ZW1wRGlyLCBwcmVmaXgpKTtcclxuICAgICAgXHJcbiAgICAgIC8vIGZzLm1rZHRlbXAgY3JlYXRlcyBhIHVuaXF1ZSBkaXJlY3RvcnkgKGUuZy4sIC90bXAvY29kZXhtZC10ZW1wLVhYWFhYWClcclxuICAgICAgY29uc3QgY3JlYXRlZERpclBhdGggPSBhd2FpdCBmcy5ta2R0ZW1wKGZ1bGxQcmVmaXhQYXRoKTtcclxuICAgICAgXHJcbiAgICAgIHRoaXMuYWN0aXZlVGVtcG9yYXJ5RGlycy5hZGQoY3JlYXRlZERpclBhdGgpO1xyXG4gICAgICBsb2dnZXIuaW5mbyhgW0ZpbGVTeXN0ZW1TZXJ2aWNlXSBDcmVhdGVkIGFuZCByZWdpc3RlcmVkIHRlbXBvcmFyeSBkaXJlY3Rvcnk6ICR7Y3JlYXRlZERpclBhdGh9YCk7XHJcbiAgICAgIHJldHVybiBjcmVhdGVkRGlyUGF0aDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGxvZ2dlci5lcnJvcihgW0ZpbGVTeXN0ZW1TZXJ2aWNlXSBGYWlsZWQgdG8gY3JlYXRlIHRlbXBvcmFyeSBkaXJlY3Rvcnkgd2l0aCBwcmVmaXggJHtwcmVmaXh9OiAke2Vycm9yLm1lc3NhZ2V9YCwgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgdGVtcG9yYXJ5IGRpcmVjdG9yeTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogTWFya3MgYSB0ZW1wb3JhcnkgZGlyZWN0b3J5IGFzIG5vIGxvbmdlciBhY3RpdmVseSBuZWVkZWQgYnkgdGhlIHByaW1hcnkgcHJvY2Vzcy5cclxuICAgKiBUaGlzIGFsbG93cyBpdCB0byBiZSBwb3RlbnRpYWxseSBjbGVhbmVkIHVwIGxhdGVyLlxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaXJQYXRoIC0gVGhlIHBhdGggb2YgdGhlIHRlbXBvcmFyeSBkaXJlY3RvcnkgdG8gcmVsZWFzZS5cclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cclxuICAgKi9cclxuICBhc3luYyByZWxlYXNlVGVtcG9yYXJ5RGlyZWN0b3J5KGRpclBhdGgpIHtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoZGlyUGF0aCk7XHJcbiAgICBpZiAodGhpcy5hY3RpdmVUZW1wb3JhcnlEaXJzLmhhcyhub3JtYWxpemVkUGF0aCkpIHtcclxuICAgICAgdGhpcy5hY3RpdmVUZW1wb3JhcnlEaXJzLmRlbGV0ZShub3JtYWxpemVkUGF0aCk7XHJcbiAgICAgIGxvZ2dlci5pbmZvKGBbRmlsZVN5c3RlbVNlcnZpY2VdIFJlbGVhc2VkIHRlbXBvcmFyeSBkaXJlY3Rvcnk6ICR7bm9ybWFsaXplZFBhdGh9YCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBsb2dnZXIud2FybihgW0ZpbGVTeXN0ZW1TZXJ2aWNlXSBBdHRlbXB0ZWQgdG8gcmVsZWFzZSBub24tdHJhY2tlZCBvciBhbHJlYWR5IHJlbGVhc2VkIHRlbXBvcmFyeSBkaXJlY3Rvcnk6ICR7bm9ybWFsaXplZFBhdGh9YCk7XHJcbiAgICB9XHJcbiAgfSAvLyA8LS0gQWRkIG1pc3NpbmcgY2xvc2luZyBicmFjZSBmb3IgdGhlIHByZXZpb3VzIG1ldGhvZFxyXG5cclxuICAvKipcclxuICAgKiBEZWxldGVzIGEgc3BlY2lmaWVkIHRlbXBvcmFyeSBkaXJlY3RvcnkgaW1tZWRpYXRlbHkuXHJcbiAgICogU2hvdWxkIGJlIGNhbGxlZCBhZnRlciByZWxlYXNlVGVtcG9yYXJ5RGlyZWN0b3J5IG9yIHdoZW4gY2xlYW51cCBpcyBjZXJ0YWluLlxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaXJQYXRoIC0gVGhlIHBhdGggb2YgdGhlIHRlbXBvcmFyeSBkaXJlY3RvcnkgdG8gZGVsZXRlLlxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzdWNjZXNzOiBib29sZWFuLCBlcnJvcj86IHN0cmluZ30+fVxyXG4gICAqL1xyXG4gIGFzeW5jIGNsZWFudXBUZW1wb3JhcnlEaXJlY3RvcnkoZGlyUGF0aCkge1xyXG4gICAgY29uc3Qgbm9ybWFsaXplZFBhdGggPSBQYXRoVXRpbHMubm9ybWFsaXplUGF0aChkaXJQYXRoKTtcclxuICAgIGxvZ2dlci5pbmZvKGBbRmlsZVN5c3RlbVNlcnZpY2VdIEF0dGVtcHRpbmcgY2xlYW51cCBvZiB0ZW1wb3JhcnkgZGlyZWN0b3J5OiAke25vcm1hbGl6ZWRQYXRofWApO1xyXG5cclxuICAgIC8vIEJhc2ljIGNoZWNrIHRvIGVuc3VyZSB3ZSdyZSBkZWxldGluZyBzb21ldGhpbmcgdGhhdCBsb29rcyBsaWtlIGEgdGVtcCBwYXRoXHJcbiAgICBpZiAoIW5vcm1hbGl6ZWRQYXRoLnN0YXJ0c1dpdGgoUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgob3MudG1wZGlyKCkpKSkge1xyXG4gICAgICAgbG9nZ2VyLmVycm9yKGBbRmlsZVN5c3RlbVNlcnZpY2VdIFJlZnVzaW5nIHRvIGNsZWFudXAgbm9uLXRlbXBvcmFyeSBwYXRoOiAke25vcm1hbGl6ZWRQYXRofWApO1xyXG4gICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAnUGF0aCBpcyBub3Qgd2l0aGluIHRoZSBzeXN0ZW0gdGVtcG9yYXJ5IGRpcmVjdG9yeS4nIH07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIEVuc3VyZSBpdCdzIHJlbGVhc2VkIGZpcnN0IChvcHRpb25hbCwgYnV0IGdvb2QgcHJhY3RpY2UpXHJcbiAgICBpZiAodGhpcy5hY3RpdmVUZW1wb3JhcnlEaXJzLmhhcyhub3JtYWxpemVkUGF0aCkpIHtcclxuICAgICAgIGxvZ2dlci53YXJuKGBbRmlsZVN5c3RlbVNlcnZpY2VdIENsZWFuaW5nIHVwIGRpcmVjdG9yeSB0aGF0IHdhcyBub3QgcmVsZWFzZWQ6ICR7bm9ybWFsaXplZFBhdGh9YCk7XHJcbiAgICAgICB0aGlzLmFjdGl2ZVRlbXBvcmFyeURpcnMuZGVsZXRlKG5vcm1hbGl6ZWRQYXRoKTsgLy8gUmVtb3ZlIGZyb20gdHJhY2tpbmdcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBmcy5ybShub3JtYWxpemVkUGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xyXG4gICAgICBsb2dnZXIuaW5mbyhgW0ZpbGVTeXN0ZW1TZXJ2aWNlXSBTdWNjZXNzZnVsbHkgY2xlYW5lZCB1cCB0ZW1wb3JhcnkgZGlyZWN0b3J5OiAke25vcm1hbGl6ZWRQYXRofWApO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAvLyBIYW5kbGUgY2FzZXMgd2hlcmUgdGhlIGRpcmVjdG9yeSBtaWdodCBhbHJlYWR5IGJlIGdvbmVcclxuICAgICAgaWYgKGVycm9yLmNvZGUgPT09ICdFTk9FTlQnKSB7XHJcbiAgICAgICAgIGxvZ2dlci53YXJuKGBbRmlsZVN5c3RlbVNlcnZpY2VdIFRlbXBvcmFyeSBkaXJlY3RvcnkgYWxyZWFkeSByZW1vdmVkOiAke25vcm1hbGl6ZWRQYXRofWApO1xyXG4gICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07IC8vIENvbnNpZGVyZWQgc3VjY2VzcyBpZiBhbHJlYWR5IGdvbmVcclxuICAgICAgfVxyXG4gICAgICBsb2dnZXIuZXJyb3IoYFtGaWxlU3lzdGVtU2VydmljZV0gRmFpbGVkIHRvIGNsZWFudXAgdGVtcG9yYXJ5IGRpcmVjdG9yeSAke25vcm1hbGl6ZWRQYXRofTogJHtlcnJvci5tZXNzYWdlfWAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYEZhaWxlZCB0byBjbGVhbnVwIHRlbXBvcmFyeSBkaXJlY3Rvcnk6ICR7ZXJyb3IubWVzc2FnZX1gXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG4gIC8qKlxyXG4gICAqIENsZWFucyB1cCBhbnkgdHJhY2tlZCB0ZW1wb3JhcnkgZGlyZWN0b3JpZXMgdGhhdCBtaWdodCBoYXZlIGJlZW4gb3JwaGFuZWRcclxuICAgKiAoZS5nLiwgZHVlIHRvIGFwcGxpY2F0aW9uIGNyYXNoIGJlZm9yZSByZWxlYXNlL2NsZWFudXApLlxyXG4gICAqIFRoaXMgaXMgYSBzYWZldHkgbWVhc3VyZSBhZ2FpbnN0IGRpc2sgc3BhY2UgbGVha3MuXHJcbiAgICogTm90ZTogVGhpcyBjdXJyZW50bHkganVzdCBsb2dzOyB1bmNvbW1lbnQgZnMucm0gdG8gZW5hYmxlIGRlbGV0aW9uLlxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxyXG4gICAqL1xyXG4gIGFzeW5jIGNsZWFudXBPcnBoYW5lZFRlbXBvcmFyeURpcmVjdG9yaWVzKCkge1xyXG4gICAgbG9nZ2VyLmluZm8oYFtGaWxlU3lzdGVtU2VydmljZV0gQ2hlY2tpbmcgZm9yIG9ycGhhbmVkIHRlbXBvcmFyeSBkaXJlY3Rvcmllcy4uLiBGb3VuZCAke3RoaXMuYWN0aXZlVGVtcG9yYXJ5RGlycy5zaXplfSB0cmFja2VkLmApO1xyXG4gICAgY29uc3QgY2xlYW51cFByb21pc2VzID0gW107XHJcbiAgICBmb3IgKGNvbnN0IGRpclBhdGggb2YgdGhpcy5hY3RpdmVUZW1wb3JhcnlEaXJzKSB7XHJcbiAgICAgICAgbG9nZ2VyLndhcm4oYFtGaWxlU3lzdGVtU2VydmljZV0gRm91bmQgcG90ZW50aWFsbHkgb3JwaGFuZWQgdGVtcG9yYXJ5IGRpcmVjdG9yeTogJHtkaXJQYXRofS4gQ29uc2lkZXIgbWFudWFsIGNsZWFudXAgb3IgZW5hYmxpbmcgYXV0b21hdGljIHJlbW92YWwuYCk7XHJcbiAgICAgICAgLy8gVW5jb21tZW50IHRoZSBmb2xsb3dpbmcgbGluZXMgdG8gZW5hYmxlIGF1dG9tYXRpYyBjbGVhbnVwIG9mIHRyYWNrZWQgZGlycyBvbiBzaHV0ZG93bi9zdGFydHVwXHJcbiAgICAgICAgLy8gY2xlYW51cFByb21pc2VzLnB1c2goXHJcbiAgICAgICAgLy8gICAgIGZzLnJtKGRpclBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KVxyXG4gICAgICAgIC8vICAgICAgICAgLnRoZW4oKCkgPT4gbG9nZ2VyLmluZm8oYFtGaWxlU3lzdGVtU2VydmljZV0gQ2xlYW5lZCB1cCBvcnBoYW5lZCBkaXJlY3Rvcnk6ICR7ZGlyUGF0aH1gKSlcclxuICAgICAgICAvLyAgICAgICAgIC5jYXRjaChlcnIgPT4gbG9nZ2VyLmVycm9yKGBbRmlsZVN5c3RlbVNlcnZpY2VdIEVycm9yIGNsZWFuaW5nIHVwIG9ycGhhbmVkIGRpcmVjdG9yeSAke2RpclBhdGh9OiAke2Vyci5tZXNzYWdlfWApKVxyXG4gICAgICAgIC8vICk7XHJcbiAgICB9XHJcbiAgICAvLyBhd2FpdCBQcm9taXNlLmFsbChjbGVhbnVwUHJvbWlzZXMpOyAvLyBVbmNvbW1lbnQgaWYgZW5hYmxpbmcgYXV0b21hdGljIGNsZWFudXBcclxuICAgIHRoaXMuYWN0aXZlVGVtcG9yYXJ5RGlycy5jbGVhcigpOyAvLyBDbGVhciB0cmFja2luZyBhZnRlciBhdHRlbXB0aW5nIGNsZWFudXBcclxuICAgIGxvZ2dlci5pbmZvKCdbRmlsZVN5c3RlbVNlcnZpY2VdIE9ycGhhbmVkIGRpcmVjdG9yeSBjaGVjayBjb21wbGV0ZS4nKTtcclxuICB9XHJcbn0gLy8gRW5kIG9mIEZpbGVTeXN0ZW1TZXJ2aWNlIGNsYXNzXHJcbi8vIENsYXNzIGRlZmluaXRpb24gZW5kcyBhYm92ZS4gTW9kdWxlLWxldmVsIGNvZGUgc3RhcnRzIGJlbG93LlxyXG5cclxuLy8gRW5zdXJlIGNsZWFudXAgcnVucyBvbiBhcHBsaWNhdGlvbiBleGl0XHJcbmNvbnN0IGZpbGVTeXN0ZW1TZXJ2aWNlSW5zdGFuY2UgPSBuZXcgRmlsZVN5c3RlbVNlcnZpY2UoKTtcclxuYXBwLm9uKCd3aWxsLXF1aXQnLCBhc3luYyAoKSA9PiB7XHJcbmxvZ2dlci5pbmZvKCdbRmlsZVN5c3RlbVNlcnZpY2VdIEFwcGxpY2F0aW9uIHF1aXR0aW5nLiBDbGVhbmluZyB1cCBvcnBoYW5lZCB0ZW1wb3JhcnkgZGlyZWN0b3JpZXMuLi4nKTtcclxuYXdhaXQgZmlsZVN5c3RlbVNlcnZpY2VJbnN0YW5jZS5jbGVhbnVwT3JwaGFuZWRUZW1wb3JhcnlEaXJlY3RvcmllcygpO1xyXG5sb2dnZXIuaW5mbygnW0ZpbGVTeXN0ZW1TZXJ2aWNlXSBPcnBoYW5lZCB0ZW1wb3JhcnkgZGlyZWN0b3J5IGNsZWFudXAgZmluaXNoZWQuJyk7XHJcbn0pO1xyXG5cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gZmlsZVN5c3RlbVNlcnZpY2VJbnN0YW5jZTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxFQUFFLEdBQUdDLE9BQU8sQ0FBQyxhQUFhLENBQUM7QUFDakMsTUFBTUMsSUFBSSxHQUFHRCxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1FLEVBQUUsR0FBR0YsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7QUFDMUIsTUFBTTtFQUFFRztBQUFJLENBQUMsR0FBR0gsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUNuQyxNQUFNO0VBQUVJO0FBQVUsQ0FBQyxHQUFHSixPQUFPLENBQUMsZ0JBQWdCLENBQUM7QUFDL0MsTUFBTUssTUFBTSxHQUFHTCxPQUFPLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDOztBQUUzQyxNQUFNTSxpQkFBaUIsQ0FBQztFQUN0QkMsV0FBV0EsQ0FBQSxFQUFHO0lBQ1osSUFBSSxDQUFDQyxXQUFXLEdBQUdKLFNBQVMsQ0FBQ0ssYUFBYSxDQUFDTixHQUFHLENBQUNPLE9BQU8sQ0FBQyxV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