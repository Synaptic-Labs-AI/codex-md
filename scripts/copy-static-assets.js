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

    // Track copied files and errors
    const copiedFiles = [];
    const errorFiles = [];

    // Copy each file to the dist/static directory
    for (const file of files) {
      const srcPath = path.join(staticDir, file);
      const destPath = path.join(distStaticDir, file);

      // Check if it's a file (not a directory)
      const stats = await fs.stat(srcPath);
      if (stats.isFile()) {
        try {
          await copyWithRetry(srcPath, destPath);
          copiedFiles.push(file);

          // Also copy to root of dist directory to ensure they can be found
          const rootDestPath = path.join(distDir, file);
          await copyWithRetry(srcPath, rootDestPath);
          console.log(`✅ Also copied ${file} to dist root directory`);
        } catch (error) {
          console.warn(`⚠️ Could not copy ${file}, will continue with other files:`, error.message);
          errorFiles.push({ file, error: error.message });
          // Continue with other files instead of exiting
        }
      }
    }

    // Create a manifest file that can be used to verify assets were copied correctly
    const manifestPath = path.join(distDir, 'static-assets-manifest.json');
    await fs.writeJson(manifestPath, {
      timestamp: new Date().toISOString(),
      staticDir,
      distDir,
      distStaticDir,
      copiedFiles,
      errorFiles
    }, { spaces: 2 });
    console.log(`✅ Created static assets manifest at ${manifestPath}`);

    // Also copy critical assets to backup locations to ensure they're available
    const criticalAssets = ['logo.png', 'app-icon.png', 'favicon.png'];

    // Create a backups directory
    const backupsDir = path.join(distDir, 'assets');
    await fs.ensureDir(backupsDir);

    // Copy critical assets from source to backups
    for (const asset of criticalAssets) {
      const srcPath = path.join(staticDir, asset);
      if (await fs.pathExists(srcPath)) {
        try {
          const backupPath = path.join(backupsDir, asset);
          await copyWithRetry(srcPath, backupPath);
          console.log(`✅ Backed up critical asset ${asset} to ${backupsDir}`);
        } catch (backupError) {
          console.warn(`⚠️ Could not back up ${asset}:`, backupError.message);
        }
      }
    }

    // Create an empty assets directory in case it doesn't exist
    await fs.ensureDir(path.join(distDir, 'assets'));

    console.log(`✅ All static assets copied successfully (${copiedFiles.length} files)`);
    if (errorFiles.length > 0) {
      console.warn(`⚠️ Could not copy ${errorFiles.length} files:`, errorFiles.map(e => e.file).join(', '));
    }
  } catch (error) {
    console.error('❌ Error copying static assets:', error);
    process.exit(1);
  }
}

// Run the function
copyStaticAssets();
