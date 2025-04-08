/**
 * afterPack.js
 * Post-packaging script to handle build tasks
 * This script runs after electron-builder packages the app but before creating installers
 * 
 * Responsibilities:
 * - Verify critical files exist in the packaged app
 * - Validate extraResources were properly copied
 * - Log detailed information about the packaged application
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * Safely checks if a file exists without causing file locks
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} - True if file exists
 */
async function safePathExists(filePath) {
  try {
    return await fs.pathExists(filePath);
  } catch (error) {
    console.warn(`⚠️ Error checking path: ${filePath}`, error.message);
    return false;
  }
}

/**
 * Main afterPack function
 */
exports.default = async function(context) {
  const { appOutDir, packager } = context;
  const isWindows = packager.platform.nodeName === 'win32';

  console.log('Running afterPack script...');
  console.log(`Platform: ${packager.platform.nodeName}`);
  console.log(`Output directory: ${appOutDir}`);

  try {
    // Verify ffmpeg.exe exists (Windows-specific)
    if (isWindows) {
      const ffmpegPath = path.join(appOutDir, 'resources', 'ffmpeg.exe');
      if (await safePathExists(ffmpegPath)) {
        console.log('✅ Verified ffmpeg.exe');
      } else {
        console.warn('⚠️ ffmpeg.exe not found in resources');
      }
    }

    // Verify critical static assets - these should now be in extraResources
    const staticAssets = [
      'favicon-icon.png',
      'app-icon.png',
      'logo.png',
      'synaptic-labs-logo.png'
    ];

    // Check in the extraResources destination path
    const resourcesDir = path.join(appOutDir, 'resources');
    const extraResourcesDir = path.join(resourcesDir, 'frontend', 'dist', 'static');
    
    console.log(`Checking for assets in extraResources path: ${extraResourcesDir}`);
    
    // Verify the extraResources directory exists
    if (await safePathExists(extraResourcesDir)) {
      console.log('✅ extraResources directory found');
      
      // Check each asset
      let missingAssets = 0;
      for (const asset of staticAssets) {
        const assetPath = path.join(extraResourcesDir, asset);
        if (await safePathExists(assetPath)) {
          console.log(`✅ Verified asset in extraResources: ${asset}`);
        } else {
          console.warn(`⚠️ Asset not found in extraResources: ${asset}`);
          missingAssets++;
        }
      }
      
      if (missingAssets === 0) {
        console.log('✅ All assets verified in extraResources');
      } else {
        console.warn(`⚠️ ${missingAssets} assets missing from extraResources`);
      }
    } else {
      console.warn('⚠️ extraResources directory not found');
      
      // Log all directories in resources to help diagnose
      try {
        const resourcesContents = await fs.readdir(resourcesDir);
        console.log('Resources directory contents:', resourcesContents);
      } catch (error) {
        console.warn('⚠️ Could not read resources directory:', error.message);
      }
    }

    console.log('✅ afterPack verification completed');
  } catch (error) {
    console.error('❌ Error in afterPack:', error);
    // Don't throw the error, just log it
    console.log('Continuing despite error...');
  }
};
