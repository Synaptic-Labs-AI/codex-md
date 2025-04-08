/**
 * cleanup-resources.js
 * 
 * This script performs cleanup operations before the build process
 * to ensure no file handles are open that might cause EBUSY errors.
 * 
 * It focuses on:
 * 1. Ensuring static assets are not locked
 * 2. Clearing any temporary files
 * 3. Providing a delay to allow file handles to be released
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
 * Main cleanup function
 */
async function cleanupResources() {
  console.log('🧹 Starting pre-build cleanup...');
  
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
        console.log(`⚠️ Waiting for file to be released: ${path.basename(filePath)}`);
        // Wait a bit to allow file handles to be released
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.log(`✅ File is accessible: ${path.basename(filePath)}`);
      }
    }
  }
  
  // Clean up any temporary directories that might be left over
  const tempDirs = [
    path.join(__dirname, '../.temp'),
    path.join(__dirname, '../frontend/.temp')
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
  console.log('⏱️ Waiting for all resources to be released...');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('✅ Pre-build cleanup completed');
}

// Run the cleanup function
cleanupResources().catch(error => {
  console.error('❌ Error during cleanup:', error);
  // Don't exit with error code, allow the build to continue
});
