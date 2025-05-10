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
const {
  getLogger
} = require('../utils/logging/ConversionLogger'); // Use standardized logger

// Get a logger instance for module-level operations if needed, or pass to constructor
const serviceLogger = getLogger('FileSystemService');
class FileSystemService {
  constructor(loggerInstance) {
    this.logger = loggerInstance || getLogger('FileSystemService'); // Use provided or get new
    this.appDataPath = PathUtils.normalizePath(app.getPath('userData'));
    this.documentsPath = PathUtils.normalizePath(app.getPath('documents'));
    this.activeTemporaryDirs = new Set(); // Track active temporary directories

    // Safely log initialization - check if logger is properly initialized first
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info('Initialized');
    } else {
      console.log('FileSystemService initialized (logger not available)');
    }
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
      // No logger here, error is re-thrown
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
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`Reading file`, {
        filePath,
        encoding
      });
    }
    try {
      const validPath = await this.validatePath(filePath);
      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug(`Path validated`, {
          validPath
        });
      }

      // Check if file exists before reading
      let stats;
      try {
        stats = await fs.stat(validPath);
        this.logger.debug(`File stats retrieved`, {
          filePath: validPath,
          size: stats.size,
          isFile: stats.isFile()
        });
        if (!stats.isFile()) {
          const errorMsg = `Not a file`;
          this.logger.error(errorMsg, {
            filePath: validPath
          });
          return {
            success: false,
            error: `${errorMsg}: ${filePath}`
          };
        }
      } catch (statError) {
        this.logger.error(`File stat error: ${statError.message}`, {
          filePath: validPath,
          error: statError
        });
        return {
          success: false,
          error: `File not accessible: ${statError.message}`
        };
      }

      // Read the file
      const data = await fs.readFile(validPath, {
        encoding
      });

      // Log success with data preview (using debug level for potentially large previews)
      const preview = typeof data === 'string' ? `${data.substring(0, 50)}${data.length > 50 ? '...' : ''}` : `<Buffer: ${data.length} bytes>`;
      this.logger.success(`File read successfully`, {
        filePath: validPath,
        type: typeof data,
        size: stats.size
      });
      this.logger.debug(`Data preview: ${preview}`, {
        filePath: validPath
      });
      return {
        success: true,
        data
      };
    } catch (error) {
      this.logger.error(`Failed to read file: ${error.message}`, {
        filePath,
        error
      });
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
    const dataType = typeof data;
    const dataLength = data ? data.length : 0;
    const isBuffer = Buffer.isBuffer(data);
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`Writing file`, {
        filePath,
        dataType,
        isBuffer,
        dataLength
      });
    }
    try {
      const validPath = await this.validatePath(filePath, false);
      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug(`Path validated`, {
          validPath
        });
      }

      // Ensure directory exists
      const dirPath = path.dirname(validPath);
      await fs.mkdir(dirPath, {
        recursive: true
      });
      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug(`Ensured directory exists`, {
          dirPath
        });
      }

      // Check if this is base64 data that needs to be decoded
      let dataToWrite = data;
      let dataEncoding = encoding;
      let originalDataLength = dataLength;
      let isBase64 = false;
      if (dataType === 'string' && data.startsWith('BASE64:')) {
        if (this.logger && typeof this.logger.info === 'function') {
          this.logger.info(`Detected BASE64 prefix, decoding binary data`, {
            filePath
          });
        }
        isBase64 = true;

        // Remove the prefix and decode base64 to binary
        const base64Data = data.substring(7); // Remove 'BASE64:' prefix
        if (this.logger && typeof this.logger.debug === 'function') {
          this.logger.debug(`Base64 data length: ${base64Data.length} characters`, {
            filePath
          });
        }

        // Check if base64 data is valid
        if (base64Data.length % 4 !== 0) {
          if (this.logger && typeof this.logger.warn === 'function') {
            this.logger.warn(`Base64 data length is not a multiple of 4`, {
              filePath,
              length: base64Data.length
            });
          }
        }

        // Calculate expected decoded size
        const expectedSize = Math.ceil(base64Data.length * 0.75);
        if (this.logger && typeof this.logger.debug === 'function') {
          this.logger.debug(`Expected decoded size: ~${expectedSize} bytes`, {
            filePath
          });
        }
        try {
          dataToWrite = Buffer.from(base64Data, 'base64');
          dataEncoding = null; // Use null encoding for binary data
          if (this.logger && typeof this.logger.debug === 'function') {
            this.logger.debug(`Decoded base64 data to binary buffer`, {
              filePath,
              decodedSize: dataToWrite.length
            });
          }

          // Verify buffer integrity
          if (dataToWrite.length < expectedSize * 0.9) {
            if (this.logger && typeof this.logger.warn === 'function') {
              this.logger.warn(`Decoded size is significantly smaller than expected`, {
                filePath,
                decodedSize: dataToWrite.length,
                expectedSize
              });
            }
          }

          // Check for ZIP signature (PK header) for PPTX, DOCX, etc.
          if (dataToWrite.length >= 4) {
            const signature = dataToWrite.slice(0, 4);
            if (signature[0] === 0x50 && signature[1] === 0x4B) {
              if (this.logger && typeof this.logger.debug === 'function') {
                this.logger.debug(`Valid ZIP signature detected (PK header)`, {
                  filePath
                });
              }
            } else {
              if (this.logger && typeof this.logger.warn === 'function') {
                this.logger.warn(`No ZIP signature found in binary data`, {
                  filePath,
                  signature: signature.toString('hex')
                });
              }
            }
          }
        } catch (decodeError) {
          if (this.logger && typeof this.logger.error === 'function') {
            this.logger.error(`Base64 decoding failed: ${decodeError.message}`, {
              filePath,
              error: decodeError
            });
          }
          throw new Error(`Base64 decoding failed: ${decodeError.message}`);
        }
      }

      // Write the file
      const writeStartTime = Date.now();
      await fs.writeFile(validPath, dataToWrite, {
        encoding: dataEncoding
      });
      const writeTime = Date.now() - writeStartTime;
      this.logger.debug(`Write operation took ${writeTime}ms`, {
        filePath,
        writeTime
      });

      // Verify the file was written
      try {
        const stats = await fs.stat(validPath);
        this.logger.success(`File written successfully`, {
          filePath: validPath,
          size: stats.size
        });

        // Verify file size
        if (isBase64) {
          // For base64 data, compare with the decoded buffer size
          if (Buffer.isBuffer(dataToWrite) && stats.size !== dataToWrite.length) {
            this.logger.warn(`File size mismatch!`, {
              filePath,
              expected: dataToWrite.length,
              actual: stats.size
            });
          }
        } else if (dataType === 'string') {
          // For text data, compare with original string length (approximate check)
          if (stats.size < originalDataLength * 0.9) {
            this.logger.warn(`File size smaller than expected!`, {
              filePath,
              originalDataLength,
              fileSize: stats.size
            });
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
        this.logger.warn(`File written but verification failed: ${verifyError.message}`, {
          filePath: validPath,
          error: verifyError
        });
        return {
          success: true
        }; // Still return success since write succeeded
      }
    } catch (error) {
      this.logger.error(`Failed to write file: ${error.message}`, {
        filePath,
        error
      });
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
      this.logger.error(`Failed to create directory: ${error.message}`, {
        dirPath,
        error
      });
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
      this.logger.error(`Failed to list directory: ${error.message}`, {
        dirPath,
        error
      });
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
      this.logger.error(`Failed to delete: ${error.message}`, {
        itemPath,
        recursive,
        error
      });
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
      this.logger.error(`Failed to get stats: ${error.message}`, {
        itemPath,
        error
      });
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
      this.logger.error(`Failed to move: ${error.message}`, {
        sourcePath,
        destPath,
        error
      });
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
    this.logger.info(`Creating temporary directory`, {
      prefix
    });
    try {
      // Use os.tmpdir() to get the system's temporary directory
      const tempDir = PathUtils.normalizePath(os.tmpdir());
      const fullPrefixPath = PathUtils.normalizePath(path.join(tempDir, prefix));

      // fs.mkdtemp creates a unique directory (e.g., /tmp/codexmd-temp-XXXXXX)
      const createdDirPath = await fs.mkdtemp(fullPrefixPath);
      this.activeTemporaryDirs.add(createdDirPath);
      this.logger.info(`Created and registered temporary directory`, {
        createdDirPath
      });
      return createdDirPath;
    } catch (error) {
      this.logger.error(`Failed to create temporary directory: ${error.message}`, {
        prefix,
        error
      });
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
      this.logger.info(`Released temporary directory`, {
        dirPath: normalizedPath
      });
    } else {
      this.logger.warn(`Attempted to release non-tracked or already released temporary directory`, {
        dirPath: normalizedPath
      });
    }
  }
  // Removed erroneous closing brace that was here
  /**
   * Deletes a specified temporary directory immediately.
   * Should be called after releaseTemporaryDirectory or when cleanup is certain.
   * @param {string} dirPath - The path of the temporary directory to delete.
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async cleanupTemporaryDirectory(dirPath) {
    const normalizedPath = PathUtils.normalizePath(dirPath);
    this.logger.info(`Attempting cleanup of temporary directory`, {
      dirPath: normalizedPath
    });

    // Basic check to ensure we're deleting something that looks like a temp path
    if (!normalizedPath.startsWith(PathUtils.normalizePath(os.tmpdir()))) {
      this.logger.error(`Refusing to cleanup non-temporary path`, {
        dirPath: normalizedPath
      });
      return {
        success: false,
        error: 'Path is not within the system temporary directory.'
      };
    }

    // Ensure it's released first (optional, but good practice)
    if (this.activeTemporaryDirs.has(normalizedPath)) {
      this.logger.warn(`Cleaning up directory that was not released`, {
        dirPath: normalizedPath
      });
      this.activeTemporaryDirs.delete(normalizedPath); // Remove from tracking
    }
    try {
      await fs.rm(normalizedPath, {
        recursive: true,
        force: true
      });
      this.logger.info(`Successfully cleaned up temporary directory`, {
        dirPath: normalizedPath
      });
      return {
        success: true
      };
    } catch (error) {
      // Handle cases where the directory might already be gone
      if (error.code === 'ENOENT') {
        this.logger.warn(`Temporary directory already removed`, {
          dirPath: normalizedPath
        });
        return {
          success: true
        }; // Considered success if already gone
      }
      this.logger.error(`Failed to cleanup temporary directory: ${error.message}`, {
        dirPath: normalizedPath,
        error
      });
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
    const trackedCount = this.activeTemporaryDirs.size;
    this.logger.info(`Checking for orphaned temporary directories... Found ${trackedCount} tracked.`);
    if (trackedCount === 0) {
      this.logger.info(`No orphaned directories found.`);
      return;
    }
    const cleanupPromises = [];
    for (const dirPath of this.activeTemporaryDirs) {
      this.logger.warn(`Found potentially orphaned temporary directory. Initiating cleanup.`, {
        dirPath
      });
      // Uncomment the line below to actually delete the directories
      // cleanupPromises.push(this.cleanupTemporaryDirectory(dirPath));

      // For safety, just log for now and remove from tracking
      // If deletion is enabled above, this delete might be redundant but safe
      this.activeTemporaryDirs.delete(dirPath);
    }

    // Wait for all cleanup operations to complete (if deletion is enabled)
    // await Promise.all(cleanupPromises);

    // Log completion status
    const action = cleanupPromises.length > 0 ? 'cleanup process completed (currently logging only)' : 'check completed';
    this.logger.info(`Orphaned directory ${action}.`, {
      initialCount: trackedCount
    });
  }
} // End of FileSystemService class
// Class definition ends above. Module-level code starts below.

// Ensure cleanup runs on application exit - This logic should ideally be moved
// to the main application setup if a singleton instance is truly needed globally.

// Create and export a singleton instance
const fileSystemServiceInstance = new FileSystemService(serviceLogger);

// Ensure cleanup runs on application exit
app.on('will-quit', async () => {
  // Use the instance's logger
  fileSystemServiceInstance.logger.info('Application quitting. Cleaning up orphaned temporary directories...');
  await fileSystemServiceInstance.cleanupOrphanedTemporaryDirectories();
  fileSystemServiceInstance.logger.info('Orphaned temporary directory cleanup finished.');
});
module.exports = {
  instance: fileSystemServiceInstance
}; // Export the INSTANCE
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmcyIsInJlcXVpcmUiLCJwYXRoIiwib3MiLCJhcHAiLCJQYXRoVXRpbHMiLCJnZXRMb2dnZXIiLCJzZXJ2aWNlTG9nZ2VyIiwiRmlsZVN5c3RlbVNlcnZpY2UiLCJjb25zdHJ1Y3RvciIsImxvZ2dlckluc3RhbmNlIiwibG9nZ2VyIiwiYXBwRGF0YVBhdGgiLCJub3JtYWxpemVQYXRoIiwiZ2V0UGF0aCIsImRvY3VtZW50c1BhdGgiLCJhY3RpdmVUZW1wb3JhcnlEaXJzIiwiU2V0IiwiaW5mbyIsImNvbnNvbGUiLCJsb2ciLCJ2YWxpZGF0ZVBhdGgiLCJmaWxlUGF0aCIsInNob3VsZEV4aXN0Iiwib3B0aW9ucyIsIkVycm9yIiwiaXNBYnNvbHV0ZSIsImlzVXJsIiwidGVzdCIsIm5vcm1hbGl6ZWRQYXRoIiwibm9ybWFsaXplIiwicHJvY2VzcyIsInBsYXRmb3JtIiwidmFsaWRhdGVkUGF0aCIsImVuc3VyZVZhbGlkUGF0aCIsImlzQWNjZXNzaWJsZSIsImFic29sdXRlUGF0aCIsImpvaW4iLCJlcnJvciIsIm1lc3NhZ2UiLCJyZWFkRmlsZSIsImVuY29kaW5nIiwidmFsaWRQYXRoIiwiZGVidWciLCJzdGF0cyIsInN0YXQiLCJzaXplIiwiaXNGaWxlIiwiZXJyb3JNc2ciLCJzdWNjZXNzIiwic3RhdEVycm9yIiwiZGF0YSIsInByZXZpZXciLCJzdWJzdHJpbmciLCJsZW5ndGgiLCJ0eXBlIiwid3JpdGVGaWxlIiwiZGF0YVR5cGUiLCJkYXRhTGVuZ3RoIiwiaXNCdWZmZXIiLCJCdWZmZXIiLCJkaXJQYXRoIiwiZGlybmFtZSIsIm1rZGlyIiwicmVjdXJzaXZlIiwiZGF0YVRvV3JpdGUiLCJkYXRhRW5jb2RpbmciLCJvcmlnaW5hbERhdGFMZW5ndGgiLCJpc0Jhc2U2NCIsInN0YXJ0c1dpdGgiLCJiYXNlNjREYXRhIiwid2FybiIsImV4cGVjdGVkU2l6ZSIsIk1hdGgiLCJjZWlsIiwiZnJvbSIsImRlY29kZWRTaXplIiwic2lnbmF0dXJlIiwic2xpY2UiLCJ0b1N0cmluZyIsImRlY29kZUVycm9yIiwid3JpdGVTdGFydFRpbWUiLCJEYXRlIiwibm93Iiwid3JpdGVUaW1lIiwiZXhwZWN0ZWQiLCJhY3R1YWwiLCJmaWxlU2l6ZSIsImNyZWF0ZWQiLCJiaXJ0aHRpbWUiLCJtb2RpZmllZCIsIm10aW1lIiwidmVyaWZ5RXJyb3IiLCJjcmVhdGVEaXJlY3RvcnkiLCJsaXN0RGlyZWN0b3J5IiwiZW50cmllcyIsInJlYWRkaXIiLCJ3aXRoRmlsZVR5cGVzIiwiZmlsdGVyZWRFbnRyaWVzIiwiZXh0ZW5zaW9ucyIsIkFycmF5IiwiaXNBcnJheSIsIm1hcCIsImV4dCIsImZpbHRlciIsImVudHJ5IiwiaXNEaXJlY3RvcnkiLCJzb21lIiwibmFtZSIsInRvTG93ZXJDYXNlIiwiZW5kc1dpdGgiLCJpdGVtcyIsIlByb21pc2UiLCJhbGwiLCJlbnRyeVBhdGgiLCJleHRlbnNpb24iLCJleHRuYW1lIiwicmVsYXRpdmVQYXRoIiwicmVsYXRpdmUiLCJzb3J0IiwiYSIsImIiLCJsb2NhbGVDb21wYXJlIiwiZGlyZWN0b3JpZXMiLCJpdGVtIiwiZGlyIiwic3ViRGlyUmVzdWx0Iiwic3ViSXRlbXMiLCJwdXNoIiwiZGVsZXRlIiwiaXRlbVBhdGgiLCJybSIsInVubGluayIsImdldFN0YXRzIiwibW92ZSIsInNvdXJjZVBhdGgiLCJkZXN0UGF0aCIsInZhbGlkU291cmNlUGF0aCIsInZhbGlkRGVzdFBhdGgiLCJyZW5hbWUiLCJjcmVhdGVUZW1wb3JhcnlEaXJlY3RvcnkiLCJwcmVmaXgiLCJ0ZW1wRGlyIiwidG1wZGlyIiwiZnVsbFByZWZpeFBhdGgiLCJjcmVhdGVkRGlyUGF0aCIsIm1rZHRlbXAiLCJhZGQiLCJyZWxlYXNlVGVtcG9yYXJ5RGlyZWN0b3J5IiwiaGFzIiwiY2xlYW51cFRlbXBvcmFyeURpcmVjdG9yeSIsImZvcmNlIiwiY29kZSIsImNsZWFudXBPcnBoYW5lZFRlbXBvcmFyeURpcmVjdG9yaWVzIiwidHJhY2tlZENvdW50IiwiY2xlYW51cFByb21pc2VzIiwiYWN0aW9uIiwiaW5pdGlhbENvdW50IiwiZmlsZVN5c3RlbVNlcnZpY2VJbnN0YW5jZSIsIm9uIiwibW9kdWxlIiwiZXhwb3J0cyIsImluc3RhbmNlIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0ZpbGVTeXN0ZW1TZXJ2aWNlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBGaWxlU3lzdGVtU2VydmljZS5qc1xyXG4gKiBIYW5kbGVzIG5hdGl2ZSBmaWxlIHN5c3RlbSBvcGVyYXRpb25zIGZvciB0aGUgRWxlY3Ryb24gYXBwbGljYXRpb24uXHJcbiAqIFByb3ZpZGVzIHNlY3VyZSBmaWxlIGFjY2VzcywgcGF0aCBub3JtYWxpemF0aW9uLCBhbmQgZGlyZWN0b3J5IG1hbmFnZW1lbnQuXHJcbiAqIFxyXG4gKiBUaGlzIHNlcnZpY2UgaXMgdXNlZCBieSBJUEMgaGFuZGxlcnMgdG8gcGVyZm9ybSBmaWxlIG9wZXJhdGlvbnMgcmVxdWVzdGVkXHJcbiAqIGJ5IHRoZSByZW5kZXJlciBwcm9jZXNzLiBJdCBpbXBsZW1lbnRzIHNlY3VyaXR5IGNoZWNrcyBhbmQgZXJyb3IgaGFuZGxpbmdcclxuICogdG8gZW5zdXJlIHNhZmUgZmlsZSBzeXN0ZW0gYWNjZXNzLlxyXG4gKi9cclxuXHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMvcHJvbWlzZXMnKTtcclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3Qgb3MgPSByZXF1aXJlKCdvcycpOyAvLyBBZGRlZCBmb3IgdGVtcG9yYXJ5IGRpcmVjdG9yeVxyXG5jb25zdCB7IGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgeyBQYXRoVXRpbHMgfSA9IHJlcXVpcmUoJy4uL3V0aWxzL3BhdGhzJyk7XHJcbmNvbnN0IHsgZ2V0TG9nZ2VyIH0gPSByZXF1aXJlKCcuLi91dGlscy9sb2dnaW5nL0NvbnZlcnNpb25Mb2dnZXInKTsgLy8gVXNlIHN0YW5kYXJkaXplZCBsb2dnZXJcclxuXHJcbi8vIEdldCBhIGxvZ2dlciBpbnN0YW5jZSBmb3IgbW9kdWxlLWxldmVsIG9wZXJhdGlvbnMgaWYgbmVlZGVkLCBvciBwYXNzIHRvIGNvbnN0cnVjdG9yXHJcbmNvbnN0IHNlcnZpY2VMb2dnZXIgPSBnZXRMb2dnZXIoJ0ZpbGVTeXN0ZW1TZXJ2aWNlJyk7XHJcblxyXG5jbGFzcyBGaWxlU3lzdGVtU2VydmljZSB7XHJcbiAgY29uc3RydWN0b3IobG9nZ2VySW5zdGFuY2UpIHtcclxuICAgIHRoaXMubG9nZ2VyID0gbG9nZ2VySW5zdGFuY2UgfHwgZ2V0TG9nZ2VyKCdGaWxlU3lzdGVtU2VydmljZScpOyAvLyBVc2UgcHJvdmlkZWQgb3IgZ2V0IG5ld1xyXG4gICAgdGhpcy5hcHBEYXRhUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKGFwcC5nZXRQYXRoKCd1c2VyRGF0YScpKTtcclxuICAgIHRoaXMuZG9jdW1lbnRzUGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKGFwcC5nZXRQYXRoKCdkb2N1bWVudHMnKSk7XHJcbiAgICB0aGlzLmFjdGl2ZVRlbXBvcmFyeURpcnMgPSBuZXcgU2V0KCk7IC8vIFRyYWNrIGFjdGl2ZSB0ZW1wb3JhcnkgZGlyZWN0b3JpZXNcclxuICAgIFxyXG4gICAgLy8gU2FmZWx5IGxvZyBpbml0aWFsaXphdGlvbiAtIGNoZWNrIGlmIGxvZ2dlciBpcyBwcm9wZXJseSBpbml0aWFsaXplZCBmaXJzdFxyXG4gICAgaWYgKHRoaXMubG9nZ2VyICYmIHR5cGVvZiB0aGlzLmxvZ2dlci5pbmZvID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ0luaXRpYWxpemVkJyk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBjb25zb2xlLmxvZygnRmlsZVN5c3RlbVNlcnZpY2UgaW5pdGlhbGl6ZWQgKGxvZ2dlciBub3QgYXZhaWxhYmxlKScpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogVmFsaWRhdGVzIGFuZCBub3JtYWxpemVzIGEgZmlsZSBwYXRoIGZvciBzZWN1cml0eVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFRoZSBwYXRoIHRvIHZhbGlkYXRlXHJcbiAgICogQHBhcmFtIHtib29sZWFufSBzaG91bGRFeGlzdCAtIFdoZXRoZXIgdGhlIHBhdGggc2hvdWxkIGFscmVhZHkgZXhpc3RcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIEFkZGl0aW9uYWwgdmFsaWRhdGlvbiBvcHRpb25zXHJcbiAgICogQHBhcmFtIHtib29sZWFufSBvcHRpb25zLmlzVXJsIC0gV2hldGhlciB0aGUgcGF0aCBvcmlnaW5hdGVkIGZyb20gYSBVUkxcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBOb3JtYWxpemVkIGFic29sdXRlIHBhdGhcclxuICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgcGF0aCBpcyBpbnZhbGlkIG9yIGFjY2VzcyBpcyBkZW5pZWRcclxuICAgKi9cclxuICBhc3luYyB2YWxpZGF0ZVBhdGgoZmlsZVBhdGgsIHNob3VsZEV4aXN0ID0gdHJ1ZSwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICBpZiAoIWZpbGVQYXRoIHx8IHR5cGVvZiBmaWxlUGF0aCAhPT0gJ3N0cmluZycpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGZpbGUgcGF0aCcpO1xyXG4gICAgfVxyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGlzQWJzb2x1dGUgPSBwYXRoLmlzQWJzb2x1dGUoZmlsZVBhdGgpO1xyXG4gICAgICBjb25zdCBpc1VybCA9IG9wdGlvbnMuaXNVcmwgfHwgL15odHRwcz86XFwvXFwvLy50ZXN0KGZpbGVQYXRoKTtcclxuXHJcbiAgICAgIC8vIEZpcnN0IG5vcm1hbGl6ZSB0aGUgcGF0aCB1c2luZyBOb2RlJ3MgcGF0aCBtb2R1bGVcclxuICAgICAgY29uc3Qgbm9ybWFsaXplZFBhdGggPSBwYXRoLm5vcm1hbGl6ZShmaWxlUGF0aCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBGb3IgYWJzb2x1dGUgV2luZG93cyBwYXRocywgdmFsaWRhdGUgdGhlIHBhdGggZGlyZWN0bHlcclxuICAgICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicgJiYgaXNBYnNvbHV0ZSkge1xyXG4gICAgICAgIGNvbnN0IHZhbGlkYXRlZFBhdGggPSBhd2FpdCBQYXRoVXRpbHMuZW5zdXJlVmFsaWRQYXRoKG5vcm1hbGl6ZWRQYXRoKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoc2hvdWxkRXhpc3QgJiYgIWF3YWl0IFBhdGhVdGlscy5pc0FjY2Vzc2libGUobm9ybWFsaXplZFBhdGgpKSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFBhdGggZG9lcyBub3QgZXhpc3Qgb3IgYWNjZXNzIGRlbmllZDogJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZWRQYXRoO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBGb3Igbm9uLWFic29sdXRlIG9yIG5vbi1XaW5kb3dzIHBhdGhzLCB2YWxpZGF0ZSB3aXRoIFVSTCBhd2FyZW5lc3NcclxuICAgICAgUGF0aFV0aWxzLmVuc3VyZVZhbGlkUGF0aChmaWxlUGF0aCwgeyBpc1VybCB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIENvbnZlcnQgdG8gYWJzb2x1dGUgcGF0aCBhcyBuZWVkZWRcclxuICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gaXNBYnNvbHV0ZSA/IFxyXG4gICAgICAgIG5vcm1hbGl6ZWRQYXRoIDogXHJcbiAgICAgICAgUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgocGF0aC5qb2luKHRoaXMuZG9jdW1lbnRzUGF0aCwgbm9ybWFsaXplZFBhdGgpKTtcclxuXHJcbiAgICAgIGlmIChzaG91bGRFeGlzdCAmJiAhYXdhaXQgUGF0aFV0aWxzLmlzQWNjZXNzaWJsZShhYnNvbHV0ZVBhdGgpKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBQYXRoIGRvZXMgbm90IGV4aXN0IG9yIGFjY2VzcyBkZW5pZWQ6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHJldHVybiBhYnNvbHV0ZVBhdGg7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIC8vIE5vIGxvZ2dlciBoZXJlLCBlcnJvciBpcyByZS10aHJvd25cclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFBhdGggdmFsaWRhdGlvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgIH1cclxuICAgIH1cclxuICBcclxuICAgIC8qKlxyXG4gICAgICogUmVhZHMgYSBmaWxlIHNhZmVseVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB0aGUgZmlsZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGVuY29kaW5nIC0gRmlsZSBlbmNvZGluZyAoZGVmYXVsdDogJ3V0ZjgnKVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8e3N1Y2Nlc3M6IGJvb2xlYW4sIGRhdGE/OiBhbnksIGVycm9yPzogc3RyaW5nfT59XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHJlYWRGaWxlKGZpbGVQYXRoLCBlbmNvZGluZyA9ICd1dGY4Jykge1xyXG4gICAgICBpZiAodGhpcy5sb2dnZXIgJiYgdHlwZW9mIHRoaXMubG9nZ2VyLmluZm8gPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZWFkaW5nIGZpbGVgLCB7IGZpbGVQYXRoLCBlbmNvZGluZyB9KTtcclxuICAgICAgfVxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHZhbGlkUGF0aCA9IGF3YWl0IHRoaXMudmFsaWRhdGVQYXRoKGZpbGVQYXRoKTtcclxuICAgICAgICBpZiAodGhpcy5sb2dnZXIgJiYgdHlwZW9mIHRoaXMubG9nZ2VyLmRlYnVnID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUGF0aCB2YWxpZGF0ZWRgLCB7IHZhbGlkUGF0aCB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgaWYgZmlsZSBleGlzdHMgYmVmb3JlIHJlYWRpbmdcclxuICAgICAgICBsZXQgc3RhdHM7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIHN0YXRzID0gYXdhaXQgZnMuc3RhdCh2YWxpZFBhdGgpO1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZpbGUgc3RhdHMgcmV0cmlldmVkYCwgeyBmaWxlUGF0aDogdmFsaWRQYXRoLCBzaXplOiBzdGF0cy5zaXplLCBpc0ZpbGU6IHN0YXRzLmlzRmlsZSgpIH0pO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBpZiAoIXN0YXRzLmlzRmlsZSgpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVycm9yTXNnID0gYE5vdCBhIGZpbGVgO1xyXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihlcnJvck1zZywgeyBmaWxlUGF0aDogdmFsaWRQYXRoIH0pO1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGAke2Vycm9yTXNnfTogJHtmaWxlUGF0aH1gIH07XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoc3RhdEVycm9yKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmlsZSBzdGF0IGVycm9yOiAke3N0YXRFcnJvci5tZXNzYWdlfWAsIHsgZmlsZVBhdGg6IHZhbGlkUGF0aCwgZXJyb3I6IHN0YXRFcnJvciB9KTtcclxuICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYEZpbGUgbm90IGFjY2Vzc2libGU6ICR7c3RhdEVycm9yLm1lc3NhZ2V9YCB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBSZWFkIHRoZSBmaWxlXHJcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGZzLnJlYWRGaWxlKHZhbGlkUGF0aCwgeyBlbmNvZGluZyB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBMb2cgc3VjY2VzcyB3aXRoIGRhdGEgcHJldmlldyAodXNpbmcgZGVidWcgbGV2ZWwgZm9yIHBvdGVudGlhbGx5IGxhcmdlIHByZXZpZXdzKVxyXG4gICAgICAgIGNvbnN0IHByZXZpZXcgPSB0eXBlb2YgZGF0YSA9PT0gJ3N0cmluZydcclxuICAgICAgICAgID8gYCR7ZGF0YS5zdWJzdHJpbmcoMCwgNTApfSR7ZGF0YS5sZW5ndGggPiA1MCA/ICcuLi4nIDogJyd9YFxyXG4gICAgICAgICAgOiBgPEJ1ZmZlcjogJHtkYXRhLmxlbmd0aH0gYnl0ZXM+YDtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLmxvZ2dlci5zdWNjZXNzKGBGaWxlIHJlYWQgc3VjY2Vzc2Z1bGx5YCwgeyBmaWxlUGF0aDogdmFsaWRQYXRoLCB0eXBlOiB0eXBlb2YgZGF0YSwgc2l6ZTogc3RhdHMuc2l6ZSB9KTtcclxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRGF0YSBwcmV2aWV3OiAke3ByZXZpZXd9YCwgeyBmaWxlUGF0aDogdmFsaWRQYXRoIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGRhdGEgfTtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIHJlYWQgZmlsZTogJHtlcnJvci5tZXNzYWdlfWAsIHsgZmlsZVBhdGgsIGVycm9yIH0pO1xyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYEZhaWxlZCB0byByZWFkIGZpbGU6ICR7ZXJyb3IubWVzc2FnZX1gIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAvKipcclxuICAgKiBXcml0ZXMgZGF0YSB0byBhIGZpbGUgc2FmZWx5XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gUGF0aCB0byB3cml0ZSB0aGUgZmlsZVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfEJ1ZmZlcn0gZGF0YSAtIERhdGEgdG8gd3JpdGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZW5jb2RpbmcgLSBGaWxlIGVuY29kaW5nIChkZWZhdWx0OiAndXRmOCcpXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8e3N1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogc3RyaW5nLCBzdGF0cz86IE9iamVjdH0+fVxyXG4gICAqL1xyXG4gIGFzeW5jIHdyaXRlRmlsZShmaWxlUGF0aCwgZGF0YSwgZW5jb2RpbmcgPSAndXRmOCcpIHtcclxuICAgIGNvbnN0IGRhdGFUeXBlID0gdHlwZW9mIGRhdGE7XHJcbiAgICBjb25zdCBkYXRhTGVuZ3RoID0gZGF0YSA/IGRhdGEubGVuZ3RoIDogMDtcclxuICAgIGNvbnN0IGlzQnVmZmVyID0gQnVmZmVyLmlzQnVmZmVyKGRhdGEpO1xyXG4gICAgaWYgKHRoaXMubG9nZ2VyICYmIHR5cGVvZiB0aGlzLmxvZ2dlci5pbmZvID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFdyaXRpbmcgZmlsZWAsIHsgZmlsZVBhdGgsIGRhdGFUeXBlLCBpc0J1ZmZlciwgZGF0YUxlbmd0aCB9KTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgdmFsaWRQYXRoID0gYXdhaXQgdGhpcy52YWxpZGF0ZVBhdGgoZmlsZVBhdGgsIGZhbHNlKTtcclxuICAgICAgaWYgKHRoaXMubG9nZ2VyICYmIHR5cGVvZiB0aGlzLmxvZ2dlci5kZWJ1ZyA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBQYXRoIHZhbGlkYXRlZGAsIHsgdmFsaWRQYXRoIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBFbnN1cmUgZGlyZWN0b3J5IGV4aXN0c1xyXG4gICAgICBjb25zdCBkaXJQYXRoID0gcGF0aC5kaXJuYW1lKHZhbGlkUGF0aCk7XHJcbiAgICAgIGF3YWl0IGZzLm1rZGlyKGRpclBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG4gICAgICBpZiAodGhpcy5sb2dnZXIgJiYgdHlwZW9mIHRoaXMubG9nZ2VyLmRlYnVnID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEVuc3VyZWQgZGlyZWN0b3J5IGV4aXN0c2AsIHsgZGlyUGF0aCB9KTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgaWYgdGhpcyBpcyBiYXNlNjQgZGF0YSB0aGF0IG5lZWRzIHRvIGJlIGRlY29kZWRcclxuICAgICAgbGV0IGRhdGFUb1dyaXRlID0gZGF0YTtcclxuICAgICAgbGV0IGRhdGFFbmNvZGluZyA9IGVuY29kaW5nO1xyXG4gICAgICBsZXQgb3JpZ2luYWxEYXRhTGVuZ3RoID0gZGF0YUxlbmd0aDtcclxuICAgICAgbGV0IGlzQmFzZTY0ID0gZmFsc2U7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoZGF0YVR5cGUgPT09ICdzdHJpbmcnICYmIGRhdGEuc3RhcnRzV2l0aCgnQkFTRTY0OicpKSB7XHJcbiAgICAgICAgaWYgKHRoaXMubG9nZ2VyICYmIHR5cGVvZiB0aGlzLmxvZ2dlci5pbmZvID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBEZXRlY3RlZCBCQVNFNjQgcHJlZml4LCBkZWNvZGluZyBiaW5hcnkgZGF0YWAsIHsgZmlsZVBhdGggfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlzQmFzZTY0ID0gdHJ1ZTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBSZW1vdmUgdGhlIHByZWZpeCBhbmQgZGVjb2RlIGJhc2U2NCB0byBiaW5hcnlcclxuICAgICAgICBjb25zdCBiYXNlNjREYXRhID0gZGF0YS5zdWJzdHJpbmcoNyk7IC8vIFJlbW92ZSAnQkFTRTY0OicgcHJlZml4XHJcbiAgICAgICAgaWYgKHRoaXMubG9nZ2VyICYmIHR5cGVvZiB0aGlzLmxvZ2dlci5kZWJ1ZyA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEJhc2U2NCBkYXRhIGxlbmd0aDogJHtiYXNlNjREYXRhLmxlbmd0aH0gY2hhcmFjdGVyc2AsIHsgZmlsZVBhdGggfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENoZWNrIGlmIGJhc2U2NCBkYXRhIGlzIHZhbGlkXHJcbiAgICAgICAgaWYgKGJhc2U2NERhdGEubGVuZ3RoICUgNCAhPT0gMCkge1xyXG4gICAgICAgICAgaWYgKHRoaXMubG9nZ2VyICYmIHR5cGVvZiB0aGlzLmxvZ2dlci53YXJuID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYEJhc2U2NCBkYXRhIGxlbmd0aCBpcyBub3QgYSBtdWx0aXBsZSBvZiA0YCwgeyBmaWxlUGF0aCwgbGVuZ3RoOiBiYXNlNjREYXRhLmxlbmd0aCB9KTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2FsY3VsYXRlIGV4cGVjdGVkIGRlY29kZWQgc2l6ZVxyXG4gICAgICAgIGNvbnN0IGV4cGVjdGVkU2l6ZSA9IE1hdGguY2VpbChiYXNlNjREYXRhLmxlbmd0aCAqIDAuNzUpO1xyXG4gICAgICAgIGlmICh0aGlzLmxvZ2dlciAmJiB0eXBlb2YgdGhpcy5sb2dnZXIuZGVidWcgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBFeHBlY3RlZCBkZWNvZGVkIHNpemU6IH4ke2V4cGVjdGVkU2l6ZX0gYnl0ZXNgLCB7IGZpbGVQYXRoIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgZGF0YVRvV3JpdGUgPSBCdWZmZXIuZnJvbShiYXNlNjREYXRhLCAnYmFzZTY0Jyk7XHJcbiAgICAgICAgICBkYXRhRW5jb2RpbmcgPSBudWxsOyAvLyBVc2UgbnVsbCBlbmNvZGluZyBmb3IgYmluYXJ5IGRhdGFcclxuICAgICAgICAgIGlmICh0aGlzLmxvZ2dlciAmJiB0eXBlb2YgdGhpcy5sb2dnZXIuZGVidWcgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYERlY29kZWQgYmFzZTY0IGRhdGEgdG8gYmluYXJ5IGJ1ZmZlcmAsIHsgZmlsZVBhdGgsIGRlY29kZWRTaXplOiBkYXRhVG9Xcml0ZS5sZW5ndGggfSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIFZlcmlmeSBidWZmZXIgaW50ZWdyaXR5XHJcbiAgICAgICAgICBpZiAoZGF0YVRvV3JpdGUubGVuZ3RoIDwgZXhwZWN0ZWRTaXplICogMC45KSB7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLmxvZ2dlciAmJiB0eXBlb2YgdGhpcy5sb2dnZXIud2FybiA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYERlY29kZWQgc2l6ZSBpcyBzaWduaWZpY2FudGx5IHNtYWxsZXIgdGhhbiBleHBlY3RlZGAsIHsgZmlsZVBhdGgsIGRlY29kZWRTaXplOiBkYXRhVG9Xcml0ZS5sZW5ndGgsIGV4cGVjdGVkU2l6ZSB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBDaGVjayBmb3IgWklQIHNpZ25hdHVyZSAoUEsgaGVhZGVyKSBmb3IgUFBUWCwgRE9DWCwgZXRjLlxyXG4gICAgICAgICAgaWYgKGRhdGFUb1dyaXRlLmxlbmd0aCA+PSA0KSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHNpZ25hdHVyZSA9IGRhdGFUb1dyaXRlLnNsaWNlKDAsIDQpO1xyXG4gICAgICAgICAgICBpZiAoc2lnbmF0dXJlWzBdID09PSAweDUwICYmIHNpZ25hdHVyZVsxXSA9PT0gMHg0Qikge1xyXG4gICAgICAgICAgICAgIGlmICh0aGlzLmxvZ2dlciAmJiB0eXBlb2YgdGhpcy5sb2dnZXIuZGVidWcgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBWYWxpZCBaSVAgc2lnbmF0dXJlIGRldGVjdGVkIChQSyBoZWFkZXIpYCwgeyBmaWxlUGF0aCB9KTtcclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgaWYgKHRoaXMubG9nZ2VyICYmIHR5cGVvZiB0aGlzLmxvZ2dlci53YXJuID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBaSVAgc2lnbmF0dXJlIGZvdW5kIGluIGJpbmFyeSBkYXRhYCwgeyBmaWxlUGF0aCwgc2lnbmF0dXJlOiBzaWduYXR1cmUudG9TdHJpbmcoJ2hleCcpIH0pO1xyXG4gICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGRlY29kZUVycm9yKSB7XHJcbiAgICAgICAgICBpZiAodGhpcy5sb2dnZXIgJiYgdHlwZW9mIHRoaXMubG9nZ2VyLmVycm9yID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBCYXNlNjQgZGVjb2RpbmcgZmFpbGVkOiAke2RlY29kZUVycm9yLm1lc3NhZ2V9YCwgeyBmaWxlUGF0aCwgZXJyb3I6IGRlY29kZUVycm9yIH0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBCYXNlNjQgZGVjb2RpbmcgZmFpbGVkOiAke2RlY29kZUVycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBXcml0ZSB0aGUgZmlsZVxyXG4gICAgICBjb25zdCB3cml0ZVN0YXJ0VGltZSA9IERhdGUubm93KCk7XHJcbiAgICAgIGF3YWl0IGZzLndyaXRlRmlsZSh2YWxpZFBhdGgsIGRhdGFUb1dyaXRlLCB7IGVuY29kaW5nOiBkYXRhRW5jb2RpbmcgfSk7XHJcbiAgICAgIGNvbnN0IHdyaXRlVGltZSA9IERhdGUubm93KCkgLSB3cml0ZVN0YXJ0VGltZTtcclxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFdyaXRlIG9wZXJhdGlvbiB0b29rICR7d3JpdGVUaW1lfW1zYCwgeyBmaWxlUGF0aCwgd3JpdGVUaW1lIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gVmVyaWZ5IHRoZSBmaWxlIHdhcyB3cml0dGVuXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KHZhbGlkUGF0aCk7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIuc3VjY2VzcyhgRmlsZSB3cml0dGVuIHN1Y2Nlc3NmdWxseWAsIHsgZmlsZVBhdGg6IHZhbGlkUGF0aCwgc2l6ZTogc3RhdHMuc2l6ZSB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBWZXJpZnkgZmlsZSBzaXplXHJcbiAgICAgICAgaWYgKGlzQmFzZTY0KSB7XHJcbiAgICAgICAgICAvLyBGb3IgYmFzZTY0IGRhdGEsIGNvbXBhcmUgd2l0aCB0aGUgZGVjb2RlZCBidWZmZXIgc2l6ZVxyXG4gICAgICAgICAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihkYXRhVG9Xcml0ZSkgJiYgc3RhdHMuc2l6ZSAhPT0gZGF0YVRvV3JpdGUubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYEZpbGUgc2l6ZSBtaXNtYXRjaCFgLCB7IGZpbGVQYXRoLCBleHBlY3RlZDogZGF0YVRvV3JpdGUubGVuZ3RoLCBhY3R1YWw6IHN0YXRzLnNpemUgfSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChkYXRhVHlwZSA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICAgIC8vIEZvciB0ZXh0IGRhdGEsIGNvbXBhcmUgd2l0aCBvcmlnaW5hbCBzdHJpbmcgbGVuZ3RoIChhcHByb3hpbWF0ZSBjaGVjaylcclxuICAgICAgICAgIGlmIChzdGF0cy5zaXplIDwgb3JpZ2luYWxEYXRhTGVuZ3RoICogMC45KSB7XHJcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYEZpbGUgc2l6ZSBzbWFsbGVyIHRoYW4gZXhwZWN0ZWQhYCwgeyBmaWxlUGF0aCwgb3JpZ2luYWxEYXRhTGVuZ3RoLCBmaWxlU2l6ZTogc3RhdHMuc2l6ZSB9KTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmV0dXJuIHN1Y2Nlc3Mgd2l0aCBmaWxlIHN0YXRzXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICBzdGF0czoge1xyXG4gICAgICAgICAgICBzaXplOiBzdGF0cy5zaXplLFxyXG4gICAgICAgICAgICBjcmVhdGVkOiBzdGF0cy5iaXJ0aHRpbWUsXHJcbiAgICAgICAgICAgIG1vZGlmaWVkOiBzdGF0cy5tdGltZVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICAgIH0gY2F0Y2ggKHZlcmlmeUVycm9yKSB7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgRmlsZSB3cml0dGVuIGJ1dCB2ZXJpZmljYXRpb24gZmFpbGVkOiAke3ZlcmlmeUVycm9yLm1lc3NhZ2V9YCwgeyBmaWxlUGF0aDogdmFsaWRQYXRoLCBlcnJvcjogdmVyaWZ5RXJyb3IgfSk7XHJcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9OyAvLyBTdGlsbCByZXR1cm4gc3VjY2VzcyBzaW5jZSB3cml0ZSBzdWNjZWVkZWRcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhaWxlZCB0byB3cml0ZSBmaWxlOiAke2Vycm9yLm1lc3NhZ2V9YCwgeyBmaWxlUGF0aCwgZXJyb3IgfSk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYEZhaWxlZCB0byB3cml0ZSBmaWxlOiAke2Vycm9yLm1lc3NhZ2V9YCB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlcyBhIGRpcmVjdG9yeSBhbmQgYW55IG5lY2Vzc2FyeSBwYXJlbnQgZGlyZWN0b3JpZXNcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlyUGF0aCAtIFBhdGggdG8gY3JlYXRlXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8e3N1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogc3RyaW5nfT59XHJcbiAgICovXHJcbiAgYXN5bmMgY3JlYXRlRGlyZWN0b3J5KGRpclBhdGgpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHZhbGlkUGF0aCA9IGF3YWl0IHRoaXMudmFsaWRhdGVQYXRoKGRpclBhdGgsIGZhbHNlKTtcclxuICAgICAgYXdhaXQgZnMubWtkaXIodmFsaWRQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgZGlyZWN0b3J5OiAke2Vycm9yLm1lc3NhZ2V9YCwgeyBkaXJQYXRoLCBlcnJvciB9KTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgRmFpbGVkIHRvIGNyZWF0ZSBkaXJlY3Rvcnk6ICR7ZXJyb3IubWVzc2FnZX1gIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBMaXN0cyBjb250ZW50cyBvZiBhIGRpcmVjdG9yeSB3aXRoIGRldGFpbGVkIGluZm9ybWF0aW9uXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpclBhdGggLSBQYXRoIHRvIGxpc3RcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIExpc3Rpbmcgb3B0aW9uc1xyXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gb3B0aW9ucy5yZWN1cnNpdmUgLSBXaGV0aGVyIHRvIGxpc3QgcmVjdXJzaXZlbHlcclxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBvcHRpb25zLmV4dGVuc2lvbnMgLSBGaWxlIGV4dGVuc2lvbnMgdG8gZmlsdGVyIChlLmcuLCBbJ21kJywgJ3R4dCddKVxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzdWNjZXNzOiBib29sZWFuLCBpdGVtcz86IEFycmF5PE9iamVjdD4sIGVycm9yPzogc3RyaW5nfT59XHJcbiAgICovXHJcbiAgYXN5bmMgbGlzdERpcmVjdG9yeShkaXJQYXRoLCBvcHRpb25zID0ge30pIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHZhbGlkUGF0aCA9IGF3YWl0IHRoaXMudmFsaWRhdGVQYXRoKGRpclBhdGgpO1xyXG4gICAgICBjb25zdCBlbnRyaWVzID0gYXdhaXQgZnMucmVhZGRpcih2YWxpZFBhdGgsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIEZpbHRlciBlbnRyaWVzIGlmIGV4dGVuc2lvbnMgYXJlIHByb3ZpZGVkXHJcbiAgICAgIGxldCBmaWx0ZXJlZEVudHJpZXMgPSBlbnRyaWVzO1xyXG4gICAgICBpZiAob3B0aW9ucy5leHRlbnNpb25zICYmIEFycmF5LmlzQXJyYXkob3B0aW9ucy5leHRlbnNpb25zKSAmJiBvcHRpb25zLmV4dGVuc2lvbnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnN0IGV4dGVuc2lvbnMgPSBvcHRpb25zLmV4dGVuc2lvbnMubWFwKGV4dCA9PiBleHQuc3RhcnRzV2l0aCgnLicpID8gZXh0IDogYC4ke2V4dH1gKTtcclxuICAgICAgICBmaWx0ZXJlZEVudHJpZXMgPSBlbnRyaWVzLmZpbHRlcihlbnRyeSA9PiBcclxuICAgICAgICAgIGVudHJ5LmlzRGlyZWN0b3J5KCkgfHwgXHJcbiAgICAgICAgICBleHRlbnNpb25zLnNvbWUoZXh0ID0+IGVudHJ5Lm5hbWUudG9Mb3dlckNhc2UoKS5lbmRzV2l0aChleHQudG9Mb3dlckNhc2UoKSkpXHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gTWFwIGVudHJpZXMgdG8gaXRlbSBvYmplY3RzIHdpdGggZGV0YWlsZWQgaW5mb3JtYXRpb25cclxuICAgICAgY29uc3QgaXRlbXMgPSBhd2FpdCBQcm9taXNlLmFsbChmaWx0ZXJlZEVudHJpZXMubWFwKGFzeW5jIGVudHJ5ID0+IHtcclxuICAgICAgICBjb25zdCBlbnRyeVBhdGggPSBwYXRoLmpvaW4odmFsaWRQYXRoLCBlbnRyeS5uYW1lKTtcclxuICAgICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQoZW50cnlQYXRoKTtcclxuICAgICAgICBjb25zdCBleHRlbnNpb24gPSBlbnRyeS5pc0ZpbGUoKSA/IHBhdGguZXh0bmFtZShlbnRyeS5uYW1lKS5zbGljZSgxKS50b0xvd2VyQ2FzZSgpIDogJyc7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIG5hbWU6IGVudHJ5Lm5hbWUsXHJcbiAgICAgICAgICBwYXRoOiBlbnRyeVBhdGgsXHJcbiAgICAgICAgICBpc0RpcmVjdG9yeTogZW50cnkuaXNEaXJlY3RvcnkoKSxcclxuICAgICAgICAgIHNpemU6IHN0YXRzLnNpemUsXHJcbiAgICAgICAgICBtb2RpZmllZDogc3RhdHMubXRpbWUsXHJcbiAgICAgICAgICBjcmVhdGVkOiBzdGF0cy5iaXJ0aHRpbWUsXHJcbiAgICAgICAgICB0eXBlOiBleHRlbnNpb24sXHJcbiAgICAgICAgICByZWxhdGl2ZVBhdGg6IHBhdGgucmVsYXRpdmUodmFsaWRQYXRoLCBlbnRyeVBhdGgpXHJcbiAgICAgICAgfTtcclxuICAgICAgfSkpO1xyXG4gICAgICBcclxuICAgICAgLy8gU29ydCBpdGVtczogZGlyZWN0b3JpZXMgZmlyc3QsIHRoZW4gZmlsZXMgYWxwaGFiZXRpY2FsbHlcclxuICAgICAgaXRlbXMuc29ydCgoYSwgYikgPT4ge1xyXG4gICAgICAgIGlmIChhLmlzRGlyZWN0b3J5ICYmICFiLmlzRGlyZWN0b3J5KSByZXR1cm4gLTE7XHJcbiAgICAgICAgaWYgKCFhLmlzRGlyZWN0b3J5ICYmIGIuaXNEaXJlY3RvcnkpIHJldHVybiAxO1xyXG4gICAgICAgIHJldHVybiBhLm5hbWUubG9jYWxlQ29tcGFyZShiLm5hbWUpO1xyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIElmIHJlY3Vyc2l2ZSBvcHRpb24gaXMgdHJ1ZSwgaW5jbHVkZSBzdWJkaXJlY3RvcnkgY29udGVudHNcclxuICAgICAgaWYgKG9wdGlvbnMucmVjdXJzaXZlKSB7XHJcbiAgICAgICAgY29uc3QgZGlyZWN0b3JpZXMgPSBpdGVtcy5maWx0ZXIoaXRlbSA9PiBpdGVtLmlzRGlyZWN0b3J5KTtcclxuICAgICAgICBcclxuICAgICAgICBmb3IgKGNvbnN0IGRpciBvZiBkaXJlY3Rvcmllcykge1xyXG4gICAgICAgICAgY29uc3Qgc3ViRGlyUmVzdWx0ID0gYXdhaXQgdGhpcy5saXN0RGlyZWN0b3J5KGRpci5wYXRoLCB7XHJcbiAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgIHJlY3Vyc2l2ZTogdHJ1ZVxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGlmIChzdWJEaXJSZXN1bHQuc3VjY2Vzcykge1xyXG4gICAgICAgICAgICAvLyBBZGQgc3ViZGlyZWN0b3J5IHBhdGggdG8gZWFjaCBpdGVtXHJcbiAgICAgICAgICAgIGNvbnN0IHN1Ykl0ZW1zID0gc3ViRGlyUmVzdWx0Lml0ZW1zLm1hcChpdGVtID0+ICh7XHJcbiAgICAgICAgICAgICAgLi4uaXRlbSxcclxuICAgICAgICAgICAgICByZWxhdGl2ZVBhdGg6IHBhdGgucmVsYXRpdmUodmFsaWRQYXRoLCBpdGVtLnBhdGgpXHJcbiAgICAgICAgICAgIH0pKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGl0ZW1zLnB1c2goLi4uc3ViSXRlbXMpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgaXRlbXMgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gbGlzdCBkaXJlY3Rvcnk6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGRpclBhdGgsIGVycm9yIH0pO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGBGYWlsZWQgdG8gbGlzdCBkaXJlY3Rvcnk6ICR7ZXJyb3IubWVzc2FnZX1gIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBEZWxldGVzIGEgZmlsZSBvciBkaXJlY3RvcnlcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gaXRlbVBhdGggLSBQYXRoIHRvIGRlbGV0ZVxyXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gcmVjdXJzaXZlIC0gV2hldGhlciB0byBkZWxldGUgZGlyZWN0b3JpZXMgcmVjdXJzaXZlbHlcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBzdHJpbmd9Pn1cclxuICAgKi9cclxuICBhc3luYyBkZWxldGUoaXRlbVBhdGgsIHJlY3Vyc2l2ZSA9IGZhbHNlKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB2YWxpZFBhdGggPSBhd2FpdCB0aGlzLnZhbGlkYXRlUGF0aChpdGVtUGF0aCk7XHJcbiAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdCh2YWxpZFBhdGgpO1xyXG4gICAgICBcclxuICAgICAgaWYgKHN0YXRzLmlzRGlyZWN0b3J5KCkpIHtcclxuICAgICAgICBhd2FpdCBmcy5ybSh2YWxpZFBhdGgsIHsgcmVjdXJzaXZlIH0pO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGF3YWl0IGZzLnVubGluayh2YWxpZFBhdGgpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGRlbGV0ZTogJHtlcnJvci5tZXNzYWdlfWAsIHsgaXRlbVBhdGgsIHJlY3Vyc2l2ZSwgZXJyb3IgfSk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogYEZhaWxlZCB0byBkZWxldGU6ICR7ZXJyb3IubWVzc2FnZX1gIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZXRzIGZpbGUgb3IgZGlyZWN0b3J5IGluZm9ybWF0aW9uXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGl0ZW1QYXRoIC0gUGF0aCB0byBjaGVja1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzdWNjZXNzOiBib29sZWFuLCBzdGF0cz86IE9iamVjdCwgZXJyb3I/OiBzdHJpbmd9Pn1cclxuICAgKi9cclxuICBhc3luYyBnZXRTdGF0cyhpdGVtUGF0aCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgdmFsaWRQYXRoID0gYXdhaXQgdGhpcy52YWxpZGF0ZVBhdGgoaXRlbVBhdGgpO1xyXG4gICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQodmFsaWRQYXRoKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIHN0YXRzOiB7XHJcbiAgICAgICAgICBzaXplOiBzdGF0cy5zaXplLFxyXG4gICAgICAgICAgY3JlYXRlZDogc3RhdHMuYmlydGh0aW1lLFxyXG4gICAgICAgICAgbW9kaWZpZWQ6IHN0YXRzLm10aW1lLFxyXG4gICAgICAgICAgaXNEaXJlY3Rvcnk6IHN0YXRzLmlzRGlyZWN0b3J5KCksXHJcbiAgICAgICAgICBpc0ZpbGU6IHN0YXRzLmlzRmlsZSgpXHJcbiAgICAgICAgfVxyXG4gICAgICB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBnZXQgc3RhdHM6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGl0ZW1QYXRoLCBlcnJvciB9KTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBgRmFpbGVkIHRvIGdldCBzdGF0czogJHtlcnJvci5tZXNzYWdlfWAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIE1vdmVzIGEgZmlsZSBvciBkaXJlY3RvcnlcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gc291cmNlUGF0aCAtIFNvdXJjZSBwYXRoXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGRlc3RQYXRoIC0gRGVzdGluYXRpb24gcGF0aFxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzdWNjZXNzOiBib29sZWFuLCBlcnJvcj86IHN0cmluZ30+fVxyXG4gICAqL1xyXG4gIGFzeW5jIG1vdmUoc291cmNlUGF0aCwgZGVzdFBhdGgpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHZhbGlkU291cmNlUGF0aCA9IGF3YWl0IHRoaXMudmFsaWRhdGVQYXRoKHNvdXJjZVBhdGgpO1xyXG4gICAgICBjb25zdCB2YWxpZERlc3RQYXRoID0gYXdhaXQgdGhpcy52YWxpZGF0ZVBhdGgoZGVzdFBhdGgsIGZhbHNlKTtcclxuICAgICAgYXdhaXQgZnMucmVuYW1lKHZhbGlkU291cmNlUGF0aCwgdmFsaWREZXN0UGF0aCk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gbW92ZTogJHtlcnJvci5tZXNzYWdlfWAsIHsgc291cmNlUGF0aCwgZGVzdFBhdGgsIGVycm9yIH0pO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IGBGYWlsZWQgdG8gbW92ZTogJHtlcnJvci5tZXNzYWdlfWAgfTtcclxuICAgIH1cclxuICB9XHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlcyBhIHVuaXF1ZSB0ZW1wb3JhcnkgZGlyZWN0b3J5LlxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwcmVmaXggLSBBIHByZWZpeCBmb3IgdGhlIHRlbXBvcmFyeSBkaXJlY3RvcnkgbmFtZS5cclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBUaGUgcGF0aCB0byB0aGUgY3JlYXRlZCB0ZW1wb3JhcnkgZGlyZWN0b3J5LlxyXG4gICAqIEB0aHJvd3Mge0Vycm9yfSBJZiBkaXJlY3RvcnkgY3JlYXRpb24gZmFpbHMuXHJcbiAgICovXHJcbiAgYXN5bmMgY3JlYXRlVGVtcG9yYXJ5RGlyZWN0b3J5KHByZWZpeCA9ICdjb2RleG1kLXRlbXAtJykge1xyXG4gICAgdGhpcy5sb2dnZXIuaW5mbyhgQ3JlYXRpbmcgdGVtcG9yYXJ5IGRpcmVjdG9yeWAsIHsgcHJlZml4IH0pO1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVXNlIG9zLnRtcGRpcigpIHRvIGdldCB0aGUgc3lzdGVtJ3MgdGVtcG9yYXJ5IGRpcmVjdG9yeVxyXG4gICAgICBjb25zdCB0ZW1wRGlyID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgob3MudG1wZGlyKCkpO1xyXG4gICAgICBjb25zdCBmdWxsUHJlZml4UGF0aCA9IFBhdGhVdGlscy5ub3JtYWxpemVQYXRoKHBhdGguam9pbih0ZW1wRGlyLCBwcmVmaXgpKTtcclxuICAgICAgXHJcbiAgICAgIC8vIGZzLm1rZHRlbXAgY3JlYXRlcyBhIHVuaXF1ZSBkaXJlY3RvcnkgKGUuZy4sIC90bXAvY29kZXhtZC10ZW1wLVhYWFhYWClcclxuICAgICAgY29uc3QgY3JlYXRlZERpclBhdGggPSBhd2FpdCBmcy5ta2R0ZW1wKGZ1bGxQcmVmaXhQYXRoKTtcclxuICAgICAgXHJcbiAgICAgIHRoaXMuYWN0aXZlVGVtcG9yYXJ5RGlycy5hZGQoY3JlYXRlZERpclBhdGgpO1xyXG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDcmVhdGVkIGFuZCByZWdpc3RlcmVkIHRlbXBvcmFyeSBkaXJlY3RvcnlgLCB7IGNyZWF0ZWREaXJQYXRoIH0pO1xyXG4gICAgICByZXR1cm4gY3JlYXRlZERpclBhdGg7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNyZWF0ZSB0ZW1wb3JhcnkgZGlyZWN0b3J5OiAke2Vycm9yLm1lc3NhZ2V9YCwgeyBwcmVmaXgsIGVycm9yIH0pO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgdGVtcG9yYXJ5IGRpcmVjdG9yeTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogTWFya3MgYSB0ZW1wb3JhcnkgZGlyZWN0b3J5IGFzIG5vIGxvbmdlciBhY3RpdmVseSBuZWVkZWQgYnkgdGhlIHByaW1hcnkgcHJvY2Vzcy5cclxuICAgKiBUaGlzIGFsbG93cyBpdCB0byBiZSBwb3RlbnRpYWxseSBjbGVhbmVkIHVwIGxhdGVyLlxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaXJQYXRoIC0gVGhlIHBhdGggb2YgdGhlIHRlbXBvcmFyeSBkaXJlY3RvcnkgdG8gcmVsZWFzZS5cclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cclxuICAgKi9cclxuICBhc3luYyByZWxlYXNlVGVtcG9yYXJ5RGlyZWN0b3J5KGRpclBhdGgpIHtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoZGlyUGF0aCk7XHJcbiAgICBpZiAodGhpcy5hY3RpdmVUZW1wb3JhcnlEaXJzLmhhcyhub3JtYWxpemVkUGF0aCkpIHtcclxuICAgICAgdGhpcy5hY3RpdmVUZW1wb3JhcnlEaXJzLmRlbGV0ZShub3JtYWxpemVkUGF0aCk7XHJcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFJlbGVhc2VkIHRlbXBvcmFyeSBkaXJlY3RvcnlgLCB7IGRpclBhdGg6IG5vcm1hbGl6ZWRQYXRoIH0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdGhpcy5sb2dnZXIud2FybihgQXR0ZW1wdGVkIHRvIHJlbGVhc2Ugbm9uLXRyYWNrZWQgb3IgYWxyZWFkeSByZWxlYXNlZCB0ZW1wb3JhcnkgZGlyZWN0b3J5YCwgeyBkaXJQYXRoOiBub3JtYWxpemVkUGF0aCB9KTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gUmVtb3ZlZCBlcnJvbmVvdXMgY2xvc2luZyBicmFjZSB0aGF0IHdhcyBoZXJlXHJcbiAgLyoqXHJcbiAgICogRGVsZXRlcyBhIHNwZWNpZmllZCB0ZW1wb3JhcnkgZGlyZWN0b3J5IGltbWVkaWF0ZWx5LlxyXG4gICAqIFNob3VsZCBiZSBjYWxsZWQgYWZ0ZXIgcmVsZWFzZVRlbXBvcmFyeURpcmVjdG9yeSBvciB3aGVuIGNsZWFudXAgaXMgY2VydGFpbi5cclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlyUGF0aCAtIFRoZSBwYXRoIG9mIHRoZSB0ZW1wb3JhcnkgZGlyZWN0b3J5IHRvIGRlbGV0ZS5cclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBzdHJpbmd9Pn1cclxuICAgKi9cclxuICBhc3luYyBjbGVhbnVwVGVtcG9yYXJ5RGlyZWN0b3J5KGRpclBhdGgpIHtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRQYXRoID0gUGF0aFV0aWxzLm5vcm1hbGl6ZVBhdGgoZGlyUGF0aCk7XHJcbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBBdHRlbXB0aW5nIGNsZWFudXAgb2YgdGVtcG9yYXJ5IGRpcmVjdG9yeWAsIHsgZGlyUGF0aDogbm9ybWFsaXplZFBhdGggfSk7XHJcblxyXG4gICAgLy8gQmFzaWMgY2hlY2sgdG8gZW5zdXJlIHdlJ3JlIGRlbGV0aW5nIHNvbWV0aGluZyB0aGF0IGxvb2tzIGxpa2UgYSB0ZW1wIHBhdGhcclxuICAgIGlmICghbm9ybWFsaXplZFBhdGguc3RhcnRzV2l0aChQYXRoVXRpbHMubm9ybWFsaXplUGF0aChvcy50bXBkaXIoKSkpKSB7XHJcbiAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgUmVmdXNpbmcgdG8gY2xlYW51cCBub24tdGVtcG9yYXJ5IHBhdGhgLCB7IGRpclBhdGg6IG5vcm1hbGl6ZWRQYXRoIH0pO1xyXG4gICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAnUGF0aCBpcyBub3Qgd2l0aGluIHRoZSBzeXN0ZW0gdGVtcG9yYXJ5IGRpcmVjdG9yeS4nIH07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIEVuc3VyZSBpdCdzIHJlbGVhc2VkIGZpcnN0IChvcHRpb25hbCwgYnV0IGdvb2QgcHJhY3RpY2UpXHJcbiAgICBpZiAodGhpcy5hY3RpdmVUZW1wb3JhcnlEaXJzLmhhcyhub3JtYWxpemVkUGF0aCkpIHtcclxuICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYENsZWFuaW5nIHVwIGRpcmVjdG9yeSB0aGF0IHdhcyBub3QgcmVsZWFzZWRgLCB7IGRpclBhdGg6IG5vcm1hbGl6ZWRQYXRoIH0pO1xyXG4gICAgICAgdGhpcy5hY3RpdmVUZW1wb3JhcnlEaXJzLmRlbGV0ZShub3JtYWxpemVkUGF0aCk7IC8vIFJlbW92ZSBmcm9tIHRyYWNraW5nXHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgZnMucm0obm9ybWFsaXplZFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcclxuICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgU3VjY2Vzc2Z1bGx5IGNsZWFuZWQgdXAgdGVtcG9yYXJ5IGRpcmVjdG9yeWAsIHsgZGlyUGF0aDogbm9ybWFsaXplZFBhdGggfSk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIC8vIEhhbmRsZSBjYXNlcyB3aGVyZSB0aGUgZGlyZWN0b3J5IG1pZ2h0IGFscmVhZHkgYmUgZ29uZVxyXG4gICAgICBpZiAoZXJyb3IuY29kZSA9PT0gJ0VOT0VOVCcpIHtcclxuICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgVGVtcG9yYXJ5IGRpcmVjdG9yeSBhbHJlYWR5IHJlbW92ZWRgLCB7IGRpclBhdGg6IG5vcm1hbGl6ZWRQYXRoIH0pO1xyXG4gICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07IC8vIENvbnNpZGVyZWQgc3VjY2VzcyBpZiBhbHJlYWR5IGdvbmVcclxuICAgICAgfVxyXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNsZWFudXAgdGVtcG9yYXJ5IGRpcmVjdG9yeTogJHtlcnJvci5tZXNzYWdlfWAsIHsgZGlyUGF0aDogbm9ybWFsaXplZFBhdGgsIGVycm9yIH0pO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBgRmFpbGVkIHRvIGNsZWFudXAgdGVtcG9yYXJ5IGRpcmVjdG9yeTogJHtlcnJvci5tZXNzYWdlfWBcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcbiAgLyoqXHJcbiAgICogQ2xlYW5zIHVwIGFueSB0cmFja2VkIHRlbXBvcmFyeSBkaXJlY3RvcmllcyB0aGF0IG1pZ2h0IGhhdmUgYmVlbiBvcnBoYW5lZFxyXG4gICAqIChlLmcuLCBkdWUgdG8gYXBwbGljYXRpb24gY3Jhc2ggYmVmb3JlIHJlbGVhc2UvY2xlYW51cCkuXHJcbiAgICogVGhpcyBpcyBhIHNhZmV0eSBtZWFzdXJlIGFnYWluc3QgZGlzayBzcGFjZSBsZWFrcy5cclxuICAgKiBOb3RlOiBUaGlzIGN1cnJlbnRseSBqdXN0IGxvZ3M7IHVuY29tbWVudCBmcy5ybSB0byBlbmFibGUgZGVsZXRpb24uXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XHJcbiAgICovXHJcbiAgYXN5bmMgY2xlYW51cE9ycGhhbmVkVGVtcG9yYXJ5RGlyZWN0b3JpZXMoKSB7XHJcbiAgICBjb25zdCB0cmFja2VkQ291bnQgPSB0aGlzLmFjdGl2ZVRlbXBvcmFyeURpcnMuc2l6ZTtcclxuICAgIHRoaXMubG9nZ2VyLmluZm8oYENoZWNraW5nIGZvciBvcnBoYW5lZCB0ZW1wb3JhcnkgZGlyZWN0b3JpZXMuLi4gRm91bmQgJHt0cmFja2VkQ291bnR9IHRyYWNrZWQuYCk7XHJcbiAgICBcclxuICAgIGlmICh0cmFja2VkQ291bnQgPT09IDApIHtcclxuICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgTm8gb3JwaGFuZWQgZGlyZWN0b3JpZXMgZm91bmQuYCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjbGVhbnVwUHJvbWlzZXMgPSBbXTtcclxuICAgIGZvciAoY29uc3QgZGlyUGF0aCBvZiB0aGlzLmFjdGl2ZVRlbXBvcmFyeURpcnMpIHtcclxuICAgICAgdGhpcy5sb2dnZXIud2FybihgRm91bmQgcG90ZW50aWFsbHkgb3JwaGFuZWQgdGVtcG9yYXJ5IGRpcmVjdG9yeS4gSW5pdGlhdGluZyBjbGVhbnVwLmAsIHsgZGlyUGF0aCB9KTtcclxuICAgICAgLy8gVW5jb21tZW50IHRoZSBsaW5lIGJlbG93IHRvIGFjdHVhbGx5IGRlbGV0ZSB0aGUgZGlyZWN0b3JpZXNcclxuICAgICAgLy8gY2xlYW51cFByb21pc2VzLnB1c2godGhpcy5jbGVhbnVwVGVtcG9yYXJ5RGlyZWN0b3J5KGRpclBhdGgpKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEZvciBzYWZldHksIGp1c3QgbG9nIGZvciBub3cgYW5kIHJlbW92ZSBmcm9tIHRyYWNraW5nXHJcbiAgICAgIC8vIElmIGRlbGV0aW9uIGlzIGVuYWJsZWQgYWJvdmUsIHRoaXMgZGVsZXRlIG1pZ2h0IGJlIHJlZHVuZGFudCBidXQgc2FmZVxyXG4gICAgICB0aGlzLmFjdGl2ZVRlbXBvcmFyeURpcnMuZGVsZXRlKGRpclBhdGgpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBXYWl0IGZvciBhbGwgY2xlYW51cCBvcGVyYXRpb25zIHRvIGNvbXBsZXRlIChpZiBkZWxldGlvbiBpcyBlbmFibGVkKVxyXG4gICAgLy8gYXdhaXQgUHJvbWlzZS5hbGwoY2xlYW51cFByb21pc2VzKTtcclxuICAgIFxyXG4gICAgLy8gTG9nIGNvbXBsZXRpb24gc3RhdHVzXHJcbiAgICBjb25zdCBhY3Rpb24gPSBjbGVhbnVwUHJvbWlzZXMubGVuZ3RoID4gMCA/ICdjbGVhbnVwIHByb2Nlc3MgY29tcGxldGVkIChjdXJyZW50bHkgbG9nZ2luZyBvbmx5KScgOiAnY2hlY2sgY29tcGxldGVkJztcclxuICAgIHRoaXMubG9nZ2VyLmluZm8oYE9ycGhhbmVkIGRpcmVjdG9yeSAke2FjdGlvbn0uYCwgeyBpbml0aWFsQ291bnQ6IHRyYWNrZWRDb3VudCB9KTtcclxuICB9XHJcbn0gLy8gRW5kIG9mIEZpbGVTeXN0ZW1TZXJ2aWNlIGNsYXNzXHJcbi8vIENsYXNzIGRlZmluaXRpb24gZW5kcyBhYm92ZS4gTW9kdWxlLWxldmVsIGNvZGUgc3RhcnRzIGJlbG93LlxyXG5cclxuLy8gRW5zdXJlIGNsZWFudXAgcnVucyBvbiBhcHBsaWNhdGlvbiBleGl0IC0gVGhpcyBsb2dpYyBzaG91bGQgaWRlYWxseSBiZSBtb3ZlZFxyXG4vLyB0byB0aGUgbWFpbiBhcHBsaWNhdGlvbiBzZXR1cCBpZiBhIHNpbmdsZXRvbiBpbnN0YW5jZSBpcyB0cnVseSBuZWVkZWQgZ2xvYmFsbHkuXHJcblxyXG4vLyBDcmVhdGUgYW5kIGV4cG9ydCBhIHNpbmdsZXRvbiBpbnN0YW5jZVxyXG5jb25zdCBmaWxlU3lzdGVtU2VydmljZUluc3RhbmNlID0gbmV3IEZpbGVTeXN0ZW1TZXJ2aWNlKHNlcnZpY2VMb2dnZXIpO1xyXG5cclxuLy8gRW5zdXJlIGNsZWFudXAgcnVucyBvbiBhcHBsaWNhdGlvbiBleGl0XHJcbmFwcC5vbignd2lsbC1xdWl0JywgYXN5bmMgKCkgPT4ge1xyXG4gIC8vIFVzZSB0aGUgaW5zdGFuY2UncyBsb2dnZXJcclxuICBmaWxlU3lzdGVtU2VydmljZUluc3RhbmNlLmxvZ2dlci5pbmZvKCdBcHBsaWNhdGlvbiBxdWl0dGluZy4gQ2xlYW5pbmcgdXAgb3JwaGFuZWQgdGVtcG9yYXJ5IGRpcmVjdG9yaWVzLi4uJyk7XHJcbiAgYXdhaXQgZmlsZVN5c3RlbVNlcnZpY2VJbnN0YW5jZS5jbGVhbnVwT3JwaGFuZWRUZW1wb3JhcnlEaXJlY3RvcmllcygpO1xyXG4gIGZpbGVTeXN0ZW1TZXJ2aWNlSW5zdGFuY2UubG9nZ2VyLmluZm8oJ09ycGhhbmVkIHRlbXBvcmFyeSBkaXJlY3RvcnkgY2xlYW51cCBmaW5pc2hlZC4nKTtcclxufSk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHsgaW5zdGFuY2U6IGZpbGVTeXN0ZW1TZXJ2aWNlSW5zdGFuY2UgfTsgLy8gRXhwb3J0IHRoZSBJTlNUQU5DRVxyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLEVBQUUsR0FBR0MsT0FBTyxDQUFDLGFBQWEsQ0FBQztBQUNqQyxNQUFNQyxJQUFJLEdBQUdELE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTUUsRUFBRSxHQUFHRixPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUMxQixNQUFNO0VBQUVHO0FBQUksQ0FBQyxHQUFHSCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ25DLE1BQU07RUFBRUk7QUFBVSxDQUFDLEdBQUdKLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQztBQUMvQyxNQUFNO0VBQUVLO0FBQVUsQ0FBQyxHQUFHTCxPQUFPLENBQUMsbUNBQW1DLENBQUMsQ0FBQyxDQUFDOztBQUVwRTtBQUNBLE1BQU1NLGFBQWEsR0FBR0QsU0FBUyxDQUFDLG1CQUFtQixDQUFDO0FBRXBELE1BQU1FLGlCQUFpQixDQUFDO0VB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