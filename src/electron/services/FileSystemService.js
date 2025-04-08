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
const { app } = require('electron');
const { utils } = require('@codex-md/shared');
const { PathUtils } = utils.paths;

class FileSystemService {
  constructor() {
    this.appDataPath = PathUtils.normalizePath(app.getPath('userData'));
    this.documentsPath = PathUtils.normalizePath(app.getPath('documents'));
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
      const data = await fs.readFile(validPath, { encoding });
      
      // Log success with data preview
      const preview = typeof data === 'string' 
        ? `${data.substring(0, 50)}${data.length > 50 ? '...' : ''}`
        : `<Buffer: ${data.length} bytes>`;
      
      console.log(`✅ File read successfully: ${validPath} (${typeof data}, ${data.length} bytes)`);
      console.log(`📄 Data preview: ${preview}`);
      
      return { success: true, data };
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
      await fs.mkdir(dirPath, { recursive: true });
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
      await fs.writeFile(validPath, dataToWrite, { encoding: dataEncoding });
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
        return { success: true }; // Still return success since write succeeded
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
      await fs.mkdir(validPath, { recursive: true });
      return { success: true };
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
        await fs.rm(validPath, { recursive });
      } else {
        await fs.unlink(validPath);
      }
      
      return { success: true };
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
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to move: ${error.message}`
      };
    }
  }
}

module.exports = new FileSystemService();
