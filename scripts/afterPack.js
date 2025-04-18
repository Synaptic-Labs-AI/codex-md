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
    // Verify ffmpeg.exe and ffprobe.exe exist (Windows-specific)
    if (isWindows) {
      const ffmpegPath = path.join(appOutDir, 'resources', 'ffmpeg.exe');
      if (await safePathExists(ffmpegPath)) {
        console.log('✅ Verified ffmpeg.exe');
      } else {
        console.warn('⚠️ ffmpeg.exe not found in resources');
      }
      
      const ffprobePath = path.join(appOutDir, 'resources', 'ffprobe.exe');
      if (await safePathExists(ffprobePath)) {
        console.log('✅ Verified ffprobe.exe');
      } else {
        console.warn('⚠️ ffprobe.exe not found in resources');
      }
    }

    // Setup resource directories
    const resourcesDir = path.join(appOutDir, 'resources');

    // We no longer copy the entire node_modules to resources
    // Instead, we're using asar packaging with specific unpack patterns
    console.log('✅ Using optimized node_modules packaging with asar');

    // Verify critical static assets - these should now be in extraResources
    const staticAssets = [
      'favicon-icon.png',
      'app-icon.png',
      'logo.png',
      'synaptic-labs-logo.png'
    ];
    
    // Also verify frontend files
    const frontendFiles = [
      'index.html'
    ];

    // Check in the extraResources destination path
    const extraResourcesDir = path.join(resourcesDir, 'frontend', 'dist', 'static');
    const frontendDir = path.join(resourcesDir, 'frontend', 'dist');
    
    console.log(`Checking for assets in extraResources path: ${extraResourcesDir}`);
    console.log(`Checking for frontend files in: ${frontendDir}`);
    
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

    // Verify frontend files
    if (await safePathExists(frontendDir)) {
      console.log('✅ Frontend dist directory found');
      
      // Check each frontend file
      let missingFrontendFiles = 0;
      for (const file of frontendFiles) {
        const filePath = path.join(frontendDir, file);
        if (await safePathExists(filePath)) {
          console.log(`✅ Verified frontend file: ${file}`);
          
          // For index.html, check its content
          if (file === 'index.html') {
            try {
              const content = await fs.readFile(filePath, 'utf8');
              console.log(`Index.html content length: ${content.length} bytes`);
              
              // Check for key elements in the HTML
              if (content.includes('<div id="app"></div>')) {
                console.log('✅ Index.html contains app div');
              } else {
                console.warn('⚠️ Index.html missing app div');
              }
              
              // Check for script and CSS references
              if (content.includes('src="./assets/')) {
                console.log('✅ Index.html contains script references');
              } else {
                console.warn('⚠️ Index.html missing script references');
              }
            } catch (error) {
              console.warn(`⚠️ Could not read index.html: ${error.message}`);
            }
          }
        } else {
          console.warn(`⚠️ Frontend file not found: ${file}`);
          missingFrontendFiles++;
        }
      }
      
      // Check for assets directory
      const assetsDir = path.join(frontendDir, 'assets');
      if (await safePathExists(assetsDir)) {
        console.log('✅ Assets directory found');
        
        try {
          const assetFiles = await fs.readdir(assetsDir);
          console.log(`Assets directory contains ${assetFiles.length} files`);
          console.log('Asset files:', assetFiles);
        } catch (error) {
          console.warn(`⚠️ Could not read assets directory: ${error.message}`);
        }
      } else {
        console.warn('⚠️ Assets directory not found');
      }
    } else {
      console.warn('⚠️ Frontend dist directory not found');
    }
    
    console.log('✅ afterPack verification completed');
  } catch (error) {
    console.error('❌ Error in afterPack:', error);
    // Don't throw the error, just log it
    console.log('Continuing despite error...');
  }
};
