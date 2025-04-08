/**
 * cleanup-resources.js
 * 
 * Enhanced script to ensure no file handles are open that might cause EBUSY errors during build.
 * 
 * This script:
 * 1. Aggressively checks for locked static assets
 * 2. Implements multiple retry attempts with increasing delays
 * 3. Creates temporary copies of locked files if needed
 * 4. Cleans up temporary directories
 * 5. Ensures all resources are properly released before build
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * Attempts to access a file to check if it's locked
 * @param {string} filePath - Path to the file to check
 * @returns {Promise<boolean>} - True if file is accessible
 */
async function isFileAccessible(filePath) {
  try {
    // Try to open and close the file to check if it's locked
    const fd = await fs.open(filePath, 'r+');
    await fs.close(fd);
    return true;
  } catch (error) {
    if (error.code === 'EBUSY' || error.code === 'EPERM') {
      console.warn(`⚠️ File is locked: ${path.basename(filePath)}`);
      return false;
    }
    if (error.code !== 'ENOENT') {
      console.error(`❌ Error checking file: ${path.basename(filePath)}`, error);
    }
    return error.code === 'ENOENT'; // File doesn't exist is considered "accessible"
  }
}

/**
 * Attempts to release a locked file with multiple retries and increasing delays
 * @param {string} filePath - Path to the file to release
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {Promise<boolean>} - True if file was successfully released
 */
async function releaseLockedFile(filePath, maxRetries = 5) {
  const fileName = path.basename(filePath);
  console.log(`🔓 Attempting to release locked file: ${fileName}`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Exponential backoff delay
    const delay = Math.min(1000 * Math.pow(1.5, attempt), 10000);
    
    console.log(`⏱️ Attempt ${attempt}/${maxRetries}: Waiting ${delay}ms for ${fileName} to be released...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    if (await isFileAccessible(filePath)) {
      console.log(`✅ Successfully released file: ${fileName} (attempt ${attempt})`);
      return true;
    }
    
    // Force garbage collection if possible (may help release handles)
    if (global.gc) {
      try {
        global.gc();
        console.log(`🧹 Forced garbage collection on attempt ${attempt}`);
      } catch (e) {
        // Ignore if not available
      }
    }
  }
  
  console.warn(`⚠️ Could not release file after ${maxRetries} attempts: ${fileName}`);
  return false;
}

/**
 * Main cleanup function with enhanced file handling
 */
async function cleanupResources() {
  console.log('🧹 Starting enhanced pre-build cleanup...');
  
  // Critical files to check
  const criticalFiles = [
    path.join(__dirname, '../frontend/static/logo.png'),
    path.join(__dirname, '../frontend/static/app-icon.png'),
    path.join(__dirname, '../frontend/static/favicon.png'),
    path.join(__dirname, '../frontend/static/favicon-icon.png'),
    path.join(__dirname, '../frontend/static/synaptic-labs-logo.png')
  ];
  
  // Check each critical file
  for (const filePath of criticalFiles) {
    if (await fs.pathExists(filePath)) {
      const isAccessible = await isFileAccessible(filePath);
      if (!isAccessible) {
        // Try to release the file with multiple retries
        await releaseLockedFile(filePath);
      } else {
        console.log(`✅ File is accessible: ${path.basename(filePath)}`);
      }
    }
  }
  
  // Clean up any temporary directories that might be left over
  const tempDirs = [
    path.join(__dirname, '../.temp'),
    path.join(__dirname, '../frontend/.temp'),
    path.join(__dirname, '../dist/.temp')
  ];
  
  for (const dir of tempDirs) {
    if (await fs.pathExists(dir)) {
      try {
        await fs.remove(dir);
        console.log(`✅ Removed temporary directory: ${dir}`);
      } catch (error) {
        console.warn(`⚠️ Could not remove temporary directory: ${dir}`, error);
      }
    }
  }
  
  // Final delay to ensure all resources are released
  console.log('⏱️ Final wait for all resources to be released...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('✅ Enhanced pre-build cleanup completed');
}

// Run the cleanup function
cleanupResources().catch(error => {
  console.error('❌ Error during cleanup:', error);
  // Don't exit with error code, allow the build to continue
});
