/**
 * afterPack.js
 * Post-packaging script to handle build tasks
 * This script runs after electron-builder packages the app but before creating installers
 *
 * Responsibilities:
 * - Verify FFmpeg and FFprobe binaries are correctly unpacked and accessible
 * - Check binary permissions and executability across platforms
 * - Implement corrective actions for common FFmpeg issues
 * - Verify critical files exist in the packaged app
 * - Validate extraResources were properly copied
 * - Log detailed information about the packaged application
 */

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

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
 * Gets detailed file information including size, permissions, and hash
 * @param {string} filePath - Path to the file
 * @returns {Promise<Object|null>} - Object with file details or null if error
 */
async function getFileDetails(filePath) {
  try {
    if (!await safePathExists(filePath)) {
      return null;
    }
    
    const stats = await fs.stat(filePath);
    const details = {
      exists: true,
      size: stats.size,
      permissions: stats.mode.toString(8),
      lastModified: stats.mtime,
      isExecutable: (stats.mode & 0o111) !== 0, // Check if file has execute permissions
      path: filePath
    };
    
    // Try to get file hash (first 1000 bytes) for verification
    try {
      const buffer = Buffer.alloc(1000);
      const fd = await fs.open(filePath, 'r');
      await fs.read(fd, buffer, 0, 1000, 0);
      await fs.close(fd);
      
      // Simple hash calculation (not cryptographically secure, just for verification)
      let hash = 0;
      for (let i = 0; i < buffer.length; i++) {
        hash = ((hash << 5) - hash) + buffer[i];
        hash |= 0; // Convert to 32bit integer
      }
      details.hash = hash.toString(16);
    } catch (hashError) {
      console.warn(`⚠️ Could not calculate file hash for ${filePath}: ${hashError.message}`);
    }
    
    return details;
  } catch (error) {
    console.warn(`⚠️ Error getting file details for ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Tests if a binary is executable by attempting to run a simple command
 * @param {string} binaryPath - Path to the binary
 * @param {string} testArgs - Arguments to test the binary with
 * @returns {Promise<boolean>} - True if binary is executable
 */
async function testBinaryExecution(binaryPath, testArgs) {
  try {
    // Execute with -version which should work on all FFmpeg binaries
    const output = execSync(`"${binaryPath}" ${testArgs}`, {
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString();
    
    console.log(`✅ Successfully executed ${path.basename(binaryPath)}`);
    console.log(`  Version info: ${output.split('\n')[0]}`);
    return true;
  } catch (error) {
    console.warn(`⚠️ Failed to execute ${binaryPath}: ${error.message}`);
    return false;
  }
}

/**
 * Sets executable permissions on a file (macOS/Linux only)
 * @param {string} filePath - Path to the file
 * @returns {Promise<boolean>} - True if permissions were set successfully
 */
async function setExecutablePermissions(filePath) {
  try {
    // Set owner, group and others execute permissions
    await fs.chmod(filePath, 0o755);
    console.log(`✅ Set executable permissions on ${path.basename(filePath)}`);
    return true;
  } catch (error) {
    console.warn(`⚠️ Failed to set executable permissions on ${filePath}: ${error.message}`);
    return false;
  }
}

/**
 * Safely copies a file with error handling
 * @param {string} source - Source file path
 * @param {string} destination - Destination file path
 * @returns {Promise<boolean>} - True if copy was successful
 */
async function safeCopyFile(source, destination) {
  try {
    await fs.ensureDir(path.dirname(destination));
    await fs.copyFile(source, destination);
    console.log(`✅ Successfully copied: ${path.basename(source)} to ${destination}`);
    return true;
  } catch (error) {
    console.error(`❌ Error copying ${source} to ${destination}:`, error.message);
    return false;
  }
}

/**
 * Main afterPack function
 */
exports.default = async function(context) {
  const { appOutDir, packager } = context;
  const platform = packager.platform.nodeName;
  const isWindows = platform === 'win32';
  const isMacOS = platform === 'darwin';
  const isLinux = platform === 'linux';

  console.log('🚀 Running afterPack script...');
  console.log(`📋 Build Information:`);
  console.log(`  Platform: ${platform}`);
  console.log(`  Output directory: ${appOutDir}`);
  console.log(`  Electron version: ${packager.electronVersion}`);
  console.log(`  App version: ${packager.appInfo.version}`);
  console.log(`  Build timestamp: ${new Date().toISOString()}`);

  try {
    // Determine resources directory based on platform
    let resourcesDir;
    if (isMacOS) {
      resourcesDir = path.join(appOutDir, packager.appInfo.productName + '.app', 'Contents', 'Resources');
    } else {
      resourcesDir = path.join(appOutDir, 'resources');
    }
    
    console.log(`📁 Resources directory: ${resourcesDir}`);
    
    // Ensure resources directory exists
    await fs.ensureDir(resourcesDir);
    console.log(`✅ Resources directory created/verified`);

    // Verify FFmpeg binaries based on platform
    console.log('🔍 Performing verification of FFmpeg binaries...');
    
    // Log installed FFmpeg packages for reference
    const ffmpegPackages = [
      '@ffmpeg-installer/win32-x64',
      '@ffmpeg-installer/darwin-x64',
      '@ffmpeg-installer/linux-x64',
      'ffmpeg-static',
      '@ffmpeg-installer/ffmpeg'
    ];
    
    for (const pkg of ffmpegPackages) {
      try {
        const pkgPath = require.resolve(`${pkg}/package.json`);
        const pkgInfo = require(pkgPath);
        console.log(`  Found ${pkg} v${pkgInfo.version} at ${path.dirname(pkgPath)}`);
      } catch (e) {
        console.log(`  Package ${pkg} not found or not accessible`);
      }
    }
    
    // Define binary paths based on platform
    let ffmpegPath, ffprobePath;
    let ffmpegTestArgs = '-version';
    let ffprobeTestArgs = '-version';
    
    if (isWindows) {
      ffmpegPath = path.join(resourcesDir, 'ffmpeg.exe');
      ffprobePath = path.join(resourcesDir, 'ffprobe.exe');
    } else if (isMacOS) {
      ffmpegPath = path.join(resourcesDir, 'ffmpeg');
      ffprobePath = path.join(resourcesDir, 'ffprobe');
    } else if (isLinux) {
      ffmpegPath = path.join(resourcesDir, 'ffmpeg');
      ffprobePath = path.join(resourcesDir, 'ffprobe');
    }
    
    // Check for alternative locations if primary location doesn't exist
    const alternativeLocations = [
      path.join(resourcesDir, 'node_modules', 'ffmpeg-static'),
      path.join(resourcesDir, 'node_modules', '@ffmpeg-installer', 'ffmpeg', 'bin'),
      path.join(resourcesDir, 'bin')
    ];
    
    // Verify FFmpeg binary
    console.log(`🔍 Checking FFmpeg binary at ${ffmpegPath}...`);
    let ffmpegDetails = await getFileDetails(ffmpegPath);
    
    if (!ffmpegDetails) {
      console.warn(`⚠️ FFmpeg not found at primary location: ${ffmpegPath}`);
      
      // Check alternative locations
      for (const altLocation of alternativeLocations) {
        const altPath = isWindows
          ? path.join(altLocation, 'ffmpeg.exe')
          : path.join(altLocation, 'ffmpeg');
          
        console.log(`  Checking alternative location: ${altPath}`);
        ffmpegDetails = await getFileDetails(altPath);
        
        if (ffmpegDetails) {
          console.log(`✅ Found FFmpeg at alternative location: ${altPath}`);
          ffmpegPath = altPath;
          break;
        }
      }
      
      if (!ffmpegDetails) {
        console.error('❌ FFmpeg binary not found in any expected location!');
        
        // List all files in resources directory to help diagnose
        try {
          const files = await fs.readdir(resourcesDir);
          console.log(`  Resources directory contents: ${files.join(', ')}`);
        } catch (readError) {
          console.warn(`⚠️ Error reading resources directory: ${readError.message}`);
        }
      }
    }
    
    // If FFmpeg was found, verify it's properly executable
    if (ffmpegDetails) {
      console.log(`✅ FFmpeg binary found:`);
      console.log(`  Path: ${ffmpegDetails.path}`);
      console.log(`  Size: ${ffmpegDetails.size} bytes`);
      console.log(`  Permissions: ${ffmpegDetails.permissions}`);
      console.log(`  Last modified: ${ffmpegDetails.lastModified}`);
      console.log(`  Is executable: ${ffmpegDetails.isExecutable}`);
      
      // For macOS and Linux, ensure executable permissions
      if ((isMacOS || isLinux) && !ffmpegDetails.isExecutable) {
        console.log('⚠️ FFmpeg binary is not executable, attempting to set permissions...');
        await setExecutablePermissions(ffmpegPath);
        
        // Re-check after setting permissions
        ffmpegDetails = await getFileDetails(ffmpegPath);
        console.log(`  Updated executable status: ${ffmpegDetails?.isExecutable}`);
      }
      
      // Test if FFmpeg can actually run
      console.log('🔍 Testing FFmpeg execution...');
      const ffmpegExecutable = await testBinaryExecution(ffmpegPath, ffmpegTestArgs);
      
      if (!ffmpegExecutable) {
        console.error('❌ FFmpeg binary exists but failed execution test!');
        console.log('  This may indicate a corrupted binary or missing dependencies.');
        
        // Attempt corrective action - try to copy from node_modules if available
        console.log('🔧 Attempting corrective action...');
        try {
          const nodeModulesPath = path.join(process.cwd(), 'node_modules');
          let sourcePath = null;
          
          // Try to find a working copy in node_modules
          for (const pkg of ['ffmpeg-static', '@ffmpeg-installer/ffmpeg']) {
            try {
              const pkgPath = require.resolve(`${pkg}/package.json`);
              const pkgDir = path.dirname(pkgPath);
              
              if (isWindows) {
                sourcePath = path.join(pkgDir, 'bin', 'ffmpeg.exe');
              } else {
                sourcePath = path.join(pkgDir, 'bin', 'ffmpeg');
              }
              
              if (await safePathExists(sourcePath)) {
                console.log(`  Found potential source at: ${sourcePath}`);
                break;
              }
            } catch (e) {
              // Continue to next package
            }
          }
          
          if (sourcePath && await safePathExists(sourcePath)) {
            await safeCopyFile(sourcePath, ffmpegPath);
            
            // Set executable permissions if needed
            if (isMacOS || isLinux) {
              await setExecutablePermissions(ffmpegPath);
            }
            
            // Test again after copy
            console.log('🔍 Re-testing FFmpeg after corrective action...');
            const retestResult = await testBinaryExecution(ffmpegPath, ffmpegTestArgs);
            
            if (retestResult) {
              console.log('✅ Corrective action successful! FFmpeg is now working.');
            } else {
              console.error('❌ Corrective action failed. FFmpeg still not working.');
            }
          } else {
            console.warn('⚠️ No viable source found for corrective action.');
          }
        } catch (correctionError) {
          console.error(`❌ Error during corrective action: ${correctionError.message}`);
        }
      }
    }
    
    // Verify FFprobe binary
    console.log(`🔍 Checking FFprobe binary at ${ffprobePath}...`);
    let ffprobeDetails = await getFileDetails(ffprobePath);
    
    if (!ffprobeDetails) {
      console.warn(`⚠️ FFprobe not found at primary location: ${ffprobePath}`);
      
      // Check alternative locations
      for (const altLocation of alternativeLocations) {
        const altPath = isWindows
          ? path.join(altLocation, 'ffprobe.exe')
          : path.join(altLocation, 'ffprobe');
          
        console.log(`  Checking alternative location: ${altPath}`);
        ffprobeDetails = await getFileDetails(altPath);
        
        if (ffprobeDetails) {
          console.log(`✅ Found FFprobe at alternative location: ${altPath}`);
          ffprobePath = altPath;
          break;
        }
      }
      
      if (!ffprobeDetails) {
        console.error('❌ FFprobe binary not found in any expected location!');
      }
    }
    
    // If FFprobe was found, verify it's properly executable
    if (ffprobeDetails) {
      console.log(`✅ FFprobe binary found:`);
      console.log(`  Path: ${ffprobeDetails.path}`);
      console.log(`  Size: ${ffprobeDetails.size} bytes`);
      console.log(`  Permissions: ${ffprobeDetails.permissions}`);
      console.log(`  Last modified: ${ffprobeDetails.lastModified}`);
      console.log(`  Is executable: ${ffprobeDetails.isExecutable}`);
      
      // For macOS and Linux, ensure executable permissions
      if ((isMacOS || isLinux) && !ffprobeDetails.isExecutable) {
        console.log('⚠️ FFprobe binary is not executable, attempting to set permissions...');
        await setExecutablePermissions(ffprobePath);
        
        // Re-check after setting permissions
        ffprobeDetails = await getFileDetails(ffprobePath);
        console.log(`  Updated executable status: ${ffprobeDetails?.isExecutable}`);
      }
      
      // Test if FFprobe can actually run
      console.log('🔍 Testing FFprobe execution...');
      const ffprobeExecutable = await testBinaryExecution(ffprobePath, ffprobeTestArgs);
      
      if (!ffprobeExecutable) {
        console.error('❌ FFprobe binary exists but failed execution test!');
        console.log('  This may indicate a corrupted binary or missing dependencies.');
        
        // Attempt corrective action - try to copy from node_modules if available
        console.log('🔧 Attempting corrective action...');
        try {
          const nodeModulesPath = path.join(process.cwd(), 'node_modules');
          let sourcePath = null;
          
          // Try to find a working copy in node_modules
          for (const pkg of ['ffmpeg-static', '@ffmpeg-installer/ffmpeg']) {
            try {
              const pkgPath = require.resolve(`${pkg}/package.json`);
              const pkgDir = path.dirname(pkgPath);
              
              if (isWindows) {
                sourcePath = path.join(pkgDir, 'bin', 'ffprobe.exe');
              } else {
                sourcePath = path.join(pkgDir, 'bin', 'ffprobe');
              }
              
              if (await safePathExists(sourcePath)) {
                console.log(`  Found potential source at: ${sourcePath}`);
                break;
              }
            } catch (e) {
              // Continue to next package
            }
          }
          
          if (sourcePath && await safePathExists(sourcePath)) {
            await safeCopyFile(sourcePath, ffprobePath);
            
            // Set executable permissions if needed
            if (isMacOS || isLinux) {
              await setExecutablePermissions(ffprobePath);
            }
            
            // Test again after copy
            console.log('🔍 Re-testing FFprobe after corrective action...');
            const retestResult = await testBinaryExecution(ffprobePath, ffprobeTestArgs);
            
            if (retestResult) {
              console.log('✅ Corrective action successful! FFprobe is now working.');
            } else {
              console.error('❌ Corrective action failed. FFprobe still not working.');
            }
          } else {
            console.warn('⚠️ No viable source found for corrective action.');
          }
        } catch (correctionError) {
          console.error(`❌ Error during corrective action: ${correctionError.message}`);
        }
      }
    }
    
    // Check if resources directory is writable
    try {
      const testFile = path.join(resourcesDir, 'write-test.tmp');
      await fs.writeFile(testFile, 'test');
      await fs.remove(testFile);
      console.log('✅ Resources directory is writable');
    } catch (writeError) {
      console.warn('⚠️ Resources directory may not be writable:', writeError.message);
    }

    // Setup resource directories
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
