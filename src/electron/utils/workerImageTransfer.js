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
// Use in-memory storage instead of file system when possible
const WORKER_TEMP_DIR = path.join(os.tmpdir(), 'codex-md-worker-images');
const USE_IN_MEMORY = true; // Flag to use in-memory storage instead of files
const inMemoryImageStore = new Map(); // Store images in memory when possible

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
 * Save image buffer to a temporary file or memory
 * @param {Buffer} imageBuffer - Image data buffer
 * @param {string} [extension='jpeg'] - Image file extension
 * @returns {Promise<string>} Path or memory ID for the image
 */
async function saveImageToFile(imageBuffer, extension = 'jpeg') {
  // Use in-memory storage if enabled and image is not too large
  if (USE_IN_MEMORY && imageBuffer.length < 10 * 1024 * 1024) { // 10MB limit
    const imageId = `mem-${uuidv4()}`;
    inMemoryImageStore.set(imageId, {
      buffer: imageBuffer,
      extension,
      timestamp: Date.now()
    });
    console.log(`💾 [WorkerImageTransfer] Stored image in memory with ID:`, imageId);
    return imageId;
  }
  
  // Fall back to file system for larger images
  await ensureTempDir();
  
  const filePath = path.join(WORKER_TEMP_DIR, `${uuidv4()}.${extension}`);
  await fs.writeFile(filePath, imageBuffer);
  console.log(`💾 [WorkerImageTransfer] Saved image to:`, filePath);
  
  return filePath;
}

/**
 * Convert image objects with buffers to image objects with file paths or memory IDs
 * @param {Array} images - Array of image objects
 * @returns {Promise<Array>} Array of image objects with file paths or memory IDs
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
    
    // Save image to file or memory
    const extension = image.type?.split('/')[1] || 'jpeg';
    const storageId = await saveImageToFile(image.data, extension);
    
    // Create a new image object with storage ID instead of buffer
    const newImage = {
      ...image,
      data: undefined, // Remove buffer
      _storageId: storageId, // Add storage ID with underscore to mark it as internal
      _isWorkerTransfer: true, // Flag to identify this as a worker transfer
      _originalSize: image.data.length, // Store original size for logging
      _isInMemory: storageId.startsWith('mem-') // Flag if stored in memory
    };
    
    imagePathMap.set(storageId, image.data.length);
    result.push(newImage);
  }
  
  console.log(`🖼️ [WorkerImageTransfer] Converted ${imagePathMap.size} images to storage IDs`);
  console.log(`📊 [WorkerImageTransfer] Total size bypassed:`, 
    Math.round([...imagePathMap.values()].reduce((a, b) => a + b, 0) / 1024 / 1024) + 'MB');
  
  return result;
}

/**
 * Read images from storage (file paths or memory) back into buffers
 * @param {Array} images - Array of image objects
 * @returns {Promise<Array>} Array of image objects with buffers
 */
async function convertFilePathsToImages(images) {
  if (!Array.isArray(images) || images.length === 0) return images;
  
  const result = [];
  let totalSize = 0;
  
  for (const image of images) {
    if (!image._isWorkerTransfer || !image._storageId) {
      result.push(image);
      continue;
    }
    
    try {
      let buffer;
      
      // Check if image is stored in memory
      if (image._isInMemory && inMemoryImageStore.has(image._storageId)) {
        // Get from memory
        const memImage = inMemoryImageStore.get(image._storageId);
        buffer = memImage.buffer;
        
        // Remove from memory store after retrieval
        inMemoryImageStore.delete(image._storageId);
      } else if (!image._isInMemory) {
        // Read from file
        buffer = await fs.readFile(image._storageId);
        
        // Delete file after reading
        try {
          await fs.unlink(image._storageId);
          console.log(`🧹 [WorkerImageTransfer] Deleted temp file after reading: ${image._storageId}`);
        } catch (unlinkError) {
          console.warn(`⚠️ [WorkerImageTransfer] Failed to delete temp file:`, unlinkError);
        }
      } else {
        throw new Error(`Memory image not found: ${image._storageId}`);
      }
      
      totalSize += buffer.length;
      
      // Create a new image object with buffer instead of storage ID
      const newImage = {
        ...image,
        data: buffer,
        _storageId: undefined,
        _isWorkerTransfer: undefined,
        _originalSize: undefined,
        _isInMemory: undefined
      };
      
      result.push(newImage);
    } catch (error) {
      console.error(`❌ [WorkerImageTransfer] Failed to read image from storage:`, error);
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
 * Clean up temporary storage (files and memory)
 * @param {Array} images - Array of image objects
 * @returns {Promise<void>}
 */
async function cleanupTempFiles(images) {
  if (!Array.isArray(images)) return;
  
  // Clean up files
  const filesToDelete = images
    .filter(img => img._isWorkerTransfer && !img._isInMemory && img._storageId)
    .map(img => img._storageId);
  
  if (filesToDelete.length > 0) {
    console.log(`🧹 [WorkerImageTransfer] Cleaning up ${filesToDelete.length} temp files`);
    
    for (const filePath of filesToDelete) {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        console.warn(`⚠️ [WorkerImageTransfer] Failed to delete temp file:`, error);
      }
    }
  }
  
  // Clean up memory images
  const memoryIdsToDelete = images
    .filter(img => img._isWorkerTransfer && img._isInMemory && img._storageId)
    .map(img => img._storageId);
  
  if (memoryIdsToDelete.length > 0) {
    console.log(`🧹 [WorkerImageTransfer] Cleaning up ${memoryIdsToDelete.length} memory images`);
    
    for (const memId of memoryIdsToDelete) {
      inMemoryImageStore.delete(memId);
    }
  }
  
  // Periodically clean up old memory images (older than 10 minutes)
  const now = Date.now();
  const oldThreshold = 10 * 60 * 1000; // 10 minutes
  let cleanedCount = 0;
  
  for (const [id, data] of inMemoryImageStore.entries()) {
    if (now - data.timestamp > oldThreshold) {
      inMemoryImageStore.delete(id);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 [WorkerImageTransfer] Cleaned up ${cleanedCount} old memory images`);
  }
}

/**
 * Get stats about worker image transfer activity
 * @returns {Promise<Object>} Statistics about temp directory and memory usage
 */
async function getWorkerImageStats() {
  try {
    // Get file stats
    let files = [];
    let totalFileSize = 0;
    
    try {
      files = await fs.readdir(WORKER_TEMP_DIR);
      
      for (const file of files) {
        const stat = await fs.stat(path.join(WORKER_TEMP_DIR, file));
        totalFileSize += stat.size;
      }
    } catch (dirError) {
      console.warn('⚠️ [WorkerImageTransfer] Failed to read temp directory:', dirError);
    }
    
    // Get memory stats
    let totalMemorySize = 0;
    for (const [id, data] of inMemoryImageStore.entries()) {
      totalMemorySize += data.buffer.length;
    }
    
    return {
      fileCount: files.length,
      fileSize: totalFileSize,
      memoryImageCount: inMemoryImageStore.size,
      memorySize: totalMemorySize,
      tempDir: WORKER_TEMP_DIR,
      usingInMemory: USE_IN_MEMORY
    };
  } catch (error) {
    console.error('❌ [WorkerImageTransfer] Failed to get stats:', error);
    return {
      fileCount: 0,
      fileSize: 0,
      memoryImageCount: inMemoryImageStore.size,
      memorySize: 0,
      tempDir: WORKER_TEMP_DIR,
      usingInMemory: USE_IN_MEMORY,
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
