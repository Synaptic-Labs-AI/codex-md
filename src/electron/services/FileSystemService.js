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
const { app } = require('electron');
const { PathUtils } = require('../utils/paths');
const { getLogger } = require('../utils/logging/ConversionLogger'); // Use standardized logger

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
        
        if (shouldExist && !await PathUtils.isAccessible(normalizedPath)) {
          throw new Error(`Path does not exist or access denied: ${filePath}`);
        }
        
        return normalizedPath;
      }
      
      // For non-absolute or non-Windows paths, validate with URL awareness
      PathUtils.ensureValidPath(filePath, { isUrl });
      
      // Convert to absolute path as needed
      const absolutePath = isAbsolute ? 
        normalizedPath : 
        PathUtils.normalizePath(path.join(this.documentsPath, normalizedPath));

      if (shouldExist && !await PathUtils.isAccessible(absolutePath)) {
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
        this.logger.info(`Reading file`, { filePath, encoding });
      }
      try {
        const validPath = await this.validatePath(filePath);
        if (this.logger && typeof this.logger.debug === 'function') {
          this.logger.debug(`Path validated`, { validPath });
        }
        
        // Check if file exists before reading
        let stats;
        try {
          stats = await fs.stat(validPath);
          this.logger.debug(`File stats retrieved`, { filePath: validPath, size: stats.size, isFile: stats.isFile() });
          
          if (!stats.isFile()) {
            const errorMsg = `Not a file`;
            this.logger.error(errorMsg, { filePath: validPath });
            return { success: false, error: `${errorMsg}: ${filePath}` };
          }
        } catch (statError) {
          this.logger.error(`File stat error: ${statError.message}`, { filePath: validPath, error: statError });
          return { success: false, error: `File not accessible: ${statError.message}` };
        }
        
        // Read the file
        const data = await fs.readFile(validPath, { encoding });
        
        // Log success with data preview (using debug level for potentially large previews)
        const preview = typeof data === 'string'
          ? `${data.substring(0, 50)}${data.length > 50 ? '...' : ''}`
          : `<Buffer: ${data.length} bytes>`;
        
        this.logger.success(`File read successfully`, { filePath: validPath, type: typeof data, size: stats.size });
        this.logger.debug(`Data preview: ${preview}`, { filePath: validPath });
        
        return { success: true, data };
      } catch (error) {
        this.logger.error(`Failed to read file: ${error.message}`, { filePath, error });
        return { success: false, error: `Failed to read file: ${error.message}` };
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
      this.logger.info(`Writing file`, { filePath, dataType, isBuffer, dataLength });
    }
    
    try {
      const validPath = await this.validatePath(filePath, false);
      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug(`Path validated`, { validPath });
      }
      
      // Ensure directory exists
      const dirPath = path.dirname(validPath);
      await fs.mkdir(dirPath, { recursive: true });
      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug(`Ensured directory exists`, { dirPath });
      }
      
      // Check if this is base64 data that needs to be decoded
      let dataToWrite = data;
      let dataEncoding = encoding;
      let originalDataLength = dataLength;
      let isBase64 = false;
      
      if (dataType === 'string' && data.startsWith('BASE64:')) {
        if (this.logger && typeof this.logger.info === 'function') {
          this.logger.info(`Detected BASE64 prefix, decoding binary data`, { filePath });
        }
        isBase64 = true;
        
        // Remove the prefix and decode base64 to binary
        const base64Data = data.substring(7); // Remove 'BASE64:' prefix
        if (this.logger && typeof this.logger.debug === 'function') {
          this.logger.debug(`Base64 data length: ${base64Data.length} characters`, { filePath });
        }
        
        // Check if base64 data is valid
        if (base64Data.length % 4 !== 0) {
          if (this.logger && typeof this.logger.warn === 'function') {
            this.logger.warn(`Base64 data length is not a multiple of 4`, { filePath, length: base64Data.length });
          }
        }
        
        // Calculate expected decoded size
        const expectedSize = Math.ceil(base64Data.length * 0.75);
        if (this.logger && typeof this.logger.debug === 'function') {
          this.logger.debug(`Expected decoded size: ~${expectedSize} bytes`, { filePath });
        }
        
        try {
          dataToWrite = Buffer.from(base64Data, 'base64');
          dataEncoding = null; // Use null encoding for binary data
          if (this.logger && typeof this.logger.debug === 'function') {
            this.logger.debug(`Decoded base64 data to binary buffer`, { filePath, decodedSize: dataToWrite.length });
          }
          
          // Verify buffer integrity
          if (dataToWrite.length < expectedSize * 0.9) {
            if (this.logger && typeof this.logger.warn === 'function') {
              this.logger.warn(`Decoded size is significantly smaller than expected`, { filePath, decodedSize: dataToWrite.length, expectedSize });
            }
          }
          
          // Check for ZIP signature (PK header) for PPTX, DOCX, etc.
          if (dataToWrite.length >= 4) {
            const signature = dataToWrite.slice(0, 4);
            if (signature[0] === 0x50 && signature[1] === 0x4B) {
              if (this.logger && typeof this.logger.debug === 'function') {
                this.logger.debug(`Valid ZIP signature detected (PK header)`, { filePath });
              }
            } else {
              if (this.logger && typeof this.logger.warn === 'function') {
                this.logger.warn(`No ZIP signature found in binary data`, { filePath, signature: signature.toString('hex') });
              }
            }
          }
        } catch (decodeError) {
          if (this.logger && typeof this.logger.error === 'function') {
            this.logger.error(`Base64 decoding failed: ${decodeError.message}`, { filePath, error: decodeError });
          }
          throw new Error(`Base64 decoding failed: ${decodeError.message}`);
        }
      }
      
      // Write the file
      const writeStartTime = Date.now();
      await fs.writeFile(validPath, dataToWrite, { encoding: dataEncoding });
      const writeTime = Date.now() - writeStartTime;
      this.logger.debug(`Write operation took ${writeTime}ms`, { filePath, writeTime });
      
      // Verify the file was written
      try {
        const stats = await fs.stat(validPath);
        this.logger.success(`File written successfully`, { filePath: validPath, size: stats.size });
        
        // Verify file size
        if (isBase64) {
          // For base64 data, compare with the decoded buffer size
          if (Buffer.isBuffer(dataToWrite) && stats.size !== dataToWrite.length) {
            this.logger.warn(`File size mismatch!`, { filePath, expected: dataToWrite.length, actual: stats.size });
          }
        } else if (dataType === 'string') {
          // For text data, compare with original string length (approximate check)
          if (stats.size < originalDataLength * 0.9) {
            this.logger.warn(`File size smaller than expected!`, { filePath, originalDataLength, fileSize: stats.size });
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
        this.logger.warn(`File written but verification failed: ${verifyError.message}`, { filePath: validPath, error: verifyError });
        return { success: true }; // Still return success since write succeeded
      }
    } catch (error) {
      this.logger.error(`Failed to write file: ${error.message}`, { filePath, error });
      return { success: false, error: `Failed to write file: ${error.message}` };
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
      await fs.mkdir(validPath, { recursive: true });
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to create directory: ${error.message}`, { dirPath, error });
      return { success: false, error: `Failed to create directory: ${error.message}` };
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
      const entries = await fs.readdir(validPath, { withFileTypes: true });
      
      // Filter entries if extensions are provided
      let filteredEntries = entries;
      if (options.extensions && Array.isArray(options.extensions) && options.extensions.length > 0) {
        const extensions = options.extensions.map(ext => ext.startsWith('.') ? ext : `.${ext}`);
        filteredEntries = entries.filter(entry => 
          entry.isDirectory() || 
          extensions.some(ext => entry.name.toLowerCase().endsWith(ext.toLowerCase()))
        );
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
      
      return { success: true, items };
    } catch (error) {
      this.logger.error(`Failed to list directory: ${error.message}`, { dirPath, error });
      return { success: false, error: `Failed to list directory: ${error.message}` };
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
        await fs.rm(validPath, { recursive });
      } else {
        await fs.unlink(validPath);
      }
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to delete: ${error.message}`, { itemPath, recursive, error });
      return { success: false, error: `Failed to delete: ${error.message}` };
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
      this.logger.error(`Failed to get stats: ${error.message}`, { itemPath, error });
      return { success: false, error: `Failed to get stats: ${error.message}` };
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
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to move: ${error.message}`, { sourcePath, destPath, error });
      return { success: false, error: `Failed to move: ${error.message}` };
    }
  }
  /**
   * Creates a unique temporary directory.
   * @param {string} prefix - A prefix for the temporary directory name.
   * @returns {Promise<string>} The path to the created temporary directory.
   * @throws {Error} If directory creation fails.
   */
  async createTemporaryDirectory(prefix = 'codexmd-temp-') {
    this.logger.info(`Creating temporary directory`, { prefix });
    try {
      // Use os.tmpdir() to get the system's temporary directory
      const tempDir = PathUtils.normalizePath(os.tmpdir());
      const fullPrefixPath = PathUtils.normalizePath(path.join(tempDir, prefix));
      
      // fs.mkdtemp creates a unique directory (e.g., /tmp/codexmd-temp-XXXXXX)
      const createdDirPath = await fs.mkdtemp(fullPrefixPath);
      
      this.activeTemporaryDirs.add(createdDirPath);
      this.logger.info(`Created and registered temporary directory`, { createdDirPath });
      return createdDirPath;
    } catch (error) {
      this.logger.error(`Failed to create temporary directory: ${error.message}`, { prefix, error });
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
      this.logger.info(`Released temporary directory`, { dirPath: normalizedPath });
    } else {
      this.logger.warn(`Attempted to release non-tracked or already released temporary directory`, { dirPath: normalizedPath });
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
    this.logger.info(`Attempting cleanup of temporary directory`, { dirPath: normalizedPath });

    // Basic check to ensure we're deleting something that looks like a temp path
    if (!normalizedPath.startsWith(PathUtils.normalizePath(os.tmpdir()))) {
       this.logger.error(`Refusing to cleanup non-temporary path`, { dirPath: normalizedPath });
       return { success: false, error: 'Path is not within the system temporary directory.' };
    }
    
    // Ensure it's released first (optional, but good practice)
    if (this.activeTemporaryDirs.has(normalizedPath)) {
       this.logger.warn(`Cleaning up directory that was not released`, { dirPath: normalizedPath });
       this.activeTemporaryDirs.delete(normalizedPath); // Remove from tracking
    }

    try {
      await fs.rm(normalizedPath, { recursive: true, force: true });
      this.logger.info(`Successfully cleaned up temporary directory`, { dirPath: normalizedPath });
      return { success: true };
    } catch (error) {
      // Handle cases where the directory might already be gone
      if (error.code === 'ENOENT') {
         this.logger.warn(`Temporary directory already removed`, { dirPath: normalizedPath });
         return { success: true }; // Considered success if already gone
      }
      this.logger.error(`Failed to cleanup temporary directory: ${error.message}`, { dirPath: normalizedPath, error });
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
      this.logger.warn(`Found potentially orphaned temporary directory. Initiating cleanup.`, { dirPath });
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
    this.logger.info(`Orphaned directory ${action}.`, { initialCount: trackedCount });
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

module.exports = { instance: fileSystemServiceInstance }; // Export the INSTANCE
