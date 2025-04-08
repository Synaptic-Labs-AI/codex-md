/**
 * copy-static-assets.js
 * 
 * This script copies static assets from frontend/static to frontend/dist
 * to ensure they are available in the packaged application.
 * 
 * Features:
 * - Handles running from different directories
 * - Implements retry logic for file locking issues
 * - Provides detailed logging for troubleshooting
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * Copy a file with retry logic for handling file locking issues
 * @param {string} srcPath - Source file path
 * @param {string} destPath - Destination file path
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delay - Delay between retries in milliseconds
 * @returns {Promise<boolean>} - True if copy succeeded
 */
async function copyWithRetry(srcPath, destPath, maxRetries = 3, delay = 1000) {
  let attempts = 0;
  const filename = path.basename(srcPath);
  
  while (attempts < maxRetries) {
    try {
      await fs.copy(srcPath, destPath);
      console.log(`✅ Copied ${filename} to dist directory`);
      return true;
    } catch (error) {
      if ((error.code === 'EBUSY' || error.code === 'EPERM') && attempts < maxRetries - 1) {
        console.log(`⚠️ File busy (${error.code}), retrying in ${delay}ms: ${filename}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempts++;
      } else {
        console.error(`❌ Failed to copy ${filename} after ${attempts + 1} attempts:`, error);
        throw error;
      }
    }
  }
  
  return false;
}

async function copyStaticAssets() {
  // Determine if we're running from the root or frontend directory
  const isRunningFromRoot = __dirname.includes('scripts');
  
  const staticDir = isRunningFromRoot 
    ? path.join(__dirname, '../frontend/static')
    : path.join(__dirname, '../static');
    
  const distDir = isRunningFromRoot
    ? path.join(__dirname, '../frontend/dist')
    : path.join(__dirname, '../dist');
  
  console.log('Copying static assets from', staticDir, 'to', distDir);
  
  try {
    // Ensure the dist directory exists
    await fs.ensureDir(distDir);
    
    // Create a static directory in dist for better organization
    const distStaticDir = path.join(distDir, 'static');
    await fs.ensureDir(distStaticDir);
    
    // Get list of files in static directory
    const files = await fs.readdir(staticDir);
    
    // Copy each file to the dist/static directory
    for (const file of files) {
      const srcPath = path.join(staticDir, file);
      const destPath = path.join(distStaticDir, file);
      
      // Check if it's a file (not a directory)
      const stats = await fs.stat(srcPath);
      if (stats.isFile()) {
        try {
          await copyWithRetry(srcPath, destPath);
        } catch (error) {
          console.warn(`⚠️ Could not copy ${file}, will continue with other files`);
          // Continue with other files instead of exiting
        }
      }
    }
    
    console.log('✅ All static assets copied successfully');
  } catch (error) {
    console.error('❌ Error copying static assets:', error);
    process.exit(1);
  }
}

// Run the function
copyStaticAssets();
