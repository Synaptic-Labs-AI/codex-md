/**
 * Worker Image Transfer
 * 
 * Utility module for handling image transfers between worker and main processes.
 * Manages file-based image transfers to avoid serialization limits in IPC.
 * 
 * Related files:
 * - src/electron/workers/conversion-worker.js: Uses this to save images before sending results
 * - src/electron/services/WorkerManager.js: Uses this to read images from files after receiving results
 * - src/electron/utils/serializationHelper.js: Works with this to handle large data transfers
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

// Create a dedicated temp directory for worker images
const WORKER_TEMP_DIR = path.join(os.tmpdir(), 'codex-md-worker-images');

// Ensure temp directory exists
async function ensureTempDir() {
  try {
    await fs.mkdir(WORKER_TEMP_DIR, { recursive: true });
    console.log('📁 [WorkerImageTransfer] Created temp directory:', WORKER_TEMP_DIR);
  } catch (error) {
    console.error('❌ [WorkerImageTransfer] Failed to create temp directory:', error);
  }
}

/**
 * Save image buffer to a temporary file
 * @param {Buffer} imageBuffer - Image data buffer
 * @param {string} [extension='jpeg'] - Image file extension
 * @returns {Promise<string>} Path to saved file
 */
async function saveImageToFile(imageBuffer, extension = 'jpeg') {
  await ensureTempDir();
  
  const filePath = path.join(WORKER_TEMP_DIR, `${uuidv4()}.${extension}`);
  await fs.writeFile(filePath, imageBuffer);
  console.log(`💾 [WorkerImageTransfer] Saved image to:`, filePath);
  
  return filePath;
}

/**
 * Convert image objects with buffers to image objects with file paths
 * @param {Array} images - Array of image objects
 * @returns {Promise<Array>} Array of image objects with file paths
 */
async function convertImagesToFilePaths(images) {
  if (!Array.isArray(images) || images.length === 0) return images;
  
  const imagePathMap = new Map();
  const result = [];
  
  for (const image of images) {
    if (!image.data || !Buffer.isBuffer(image.data)) {
      result.push(image);
      continue;
    }
    
    // Save image to file
    const extension = image.type?.split('/')[1] || 'jpeg';
    const filePath = await saveImageToFile(image.data, extension);
    
    // Create a new image object with file path instead of buffer
    const newImage = {
      ...image,
      data: undefined, // Remove buffer
      _filePath: filePath, // Add file path with underscore to mark it as internal
      _isWorkerTransfer: true, // Flag to identify this as a worker transfer
      _originalSize: image.data.length // Store original size for logging
    };
    
    imagePathMap.set(filePath, image.data.length);
    result.push(newImage);
  }
  
  console.log(`🖼️ [WorkerImageTransfer] Converted ${imagePathMap.size} images to file paths`);
  console.log(`📊 [WorkerImageTransfer] Total size bypassed:`, 
    Math.round([...imagePathMap.values()].reduce((a, b) => a + b, 0) / 1024 / 1024) + 'MB');
  
  return result;
}

/**
 * Read images from file paths back into buffers
 * @param {Array} images - Array of image objects
 * @returns {Promise<Array>} Array of image objects with buffers
 */
async function convertFilePathsToImages(images) {
  if (!Array.isArray(images) || images.length === 0) return images;
  
  const result = [];
  let totalSize = 0;
  
  for (const image of images) {
    if (!image._isWorkerTransfer || !image._filePath) {
      result.push(image);
      continue;
    }
    
    try {
      // Read image from file
      const buffer = await fs.readFile(image._filePath);
      totalSize += buffer.length;
      
      // Create a new image object with buffer instead of file path
      const newImage = {
        ...image,
        data: buffer,
        _filePath: undefined,
        _isWorkerTransfer: undefined,
        _originalSize: undefined
      };
      
      result.push(newImage);
    } catch (error) {
      console.error(`❌ [WorkerImageTransfer] Failed to read image from file:`, error);
      // Keep the original image object if reading fails
      result.push(image);
    }
  }
  
  console.log(`🖼️ [WorkerImageTransfer] Converted ${images.length} images back to buffers`);
  console.log(`📊 [WorkerImageTransfer] Total size restored:`, 
    Math.round(totalSize / 1024 / 1024) + 'MB');
  
  return result;
}

/**
 * Clean up temporary files
 * @param {Array} images - Array of image objects
 * @returns {Promise<void>}
 */
async function cleanupTempFiles(images) {
  if (!Array.isArray(images)) return;
  
  const filesToDelete = images
    .filter(img => img._isWorkerTransfer && img._filePath)
    .map(img => img._filePath);
  
  if (filesToDelete.length === 0) return;
  
  console.log(`🧹 [WorkerImageTransfer] Cleaning up ${filesToDelete.length} temp files`);
  
  for (const filePath of filesToDelete) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.warn(`⚠️ [WorkerImageTransfer] Failed to delete temp file:`, error);
    }
  }
}

/**
 * Get stats about worker image transfer activity
 * @returns {Promise<Object>} Statistics about temp directory
 */
async function getWorkerImageStats() {
  try {
    const files = await fs.readdir(WORKER_TEMP_DIR);
    let totalSize = 0;
    
    for (const file of files) {
      const stat = await fs.stat(path.join(WORKER_TEMP_DIR, file));
      totalSize += stat.size;
    }
    
    return {
      fileCount: files.length,
      totalSize,
      tempDir: WORKER_TEMP_DIR
    };
  } catch (error) {
    console.error('❌ [WorkerImageTransfer] Failed to get stats:', error);
    return {
      fileCount: 0,
      totalSize: 0,
      tempDir: WORKER_TEMP_DIR,
      error: error.message
    };
  }
}

module.exports = {
  saveImageToFile,
  convertImagesToFilePaths,
  convertFilePathsToImages,
  cleanupTempFiles,
  getWorkerImageStats,
  WORKER_TEMP_DIR
};
