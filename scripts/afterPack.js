/**
 * afterPack.js
 * Post-packaging script to handle build tasks
 * This script runs after electron-builder packages the app but before creating installers
 * 
 * Responsibilities:
 * - Verify critical files exist in the packaged app
 * - Ensure static assets are properly copied
 * - Implement fallbacks for missing files if needed
 */

const fs = require('fs-extra');
const path = require('path');

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
            if (await fs.pathExists(ffmpegPath)) {
                console.log('✅ Verified ffmpeg.exe');
            } else {
                console.warn('⚠️ ffmpeg.exe not found in resources');
            }
        }

        // Verify critical static assets
        const staticAssets = [
            'favicon-icon.png', // Using dedicated icon file to avoid file locking
            'app-icon.png',     // Using dedicated icon file to avoid file locking
            'logo.png',
            'synaptic-labs-logo.png'
        ];

        // First check if the static directory exists in the packaged app
        const staticDir = path.join(appOutDir, 'frontend', 'static');
        const distDir = path.join(appOutDir, 'frontend', 'dist');
        
        // Ensure the dist directory exists
        await fs.ensureDir(distDir);
        
        // Check if the static directory exists in the packaged app
        const hasStaticDir = await fs.pathExists(staticDir);
        
        if (hasStaticDir) {
            console.log('✅ Static directory found in packaged app');
            
            // Check static assets in both possible locations
            for (const asset of staticAssets) {
                // Check in frontend/static (original location)
                const staticPath = path.join(staticDir, asset);
                const hasStaticAsset = await fs.pathExists(staticPath);
                
                // Check in frontend/dist (where they should be copied)
                const distPath = path.join(distDir, asset);
                const hasDistAsset = await fs.pathExists(distPath);
                
                if (hasStaticAsset) {
                    console.log(`✅ Verified static asset: ${asset}`);
                    
                    // If asset exists in static but not in dist, copy it
                    if (!hasDistAsset) {
                        console.log(`Copying ${asset} to dist directory...`);
                        await fs.copy(staticPath, distPath);
                    }
                } else if (hasDistAsset) {
                    console.log(`✅ Verified dist asset: ${asset}`);
                } else {
                    console.warn(`⚠️ Asset not found in packaged app: ${asset}`);
                    
                    // Try to copy from the project's static directory
                    const projectStaticPath = path.join(process.cwd(), 'frontend', 'static', asset);
                    if (await fs.pathExists(projectStaticPath)) {
                        console.log(`Found ${asset} in project static directory, copying to packaged app...`);
                        await fs.copy(projectStaticPath, distPath);
                        console.log(`✅ Copied ${asset} to dist directory`);
                    } else {
                        console.error(`❌ Could not find ${asset} in any location`);
                    }
                }
            }
        } else {
            console.warn('⚠️ Static directory not found in packaged app');
            
            // Try to copy assets from the project's static directory
            const projectStaticDir = path.join(process.cwd(), 'frontend', 'static');
            
            if (await fs.pathExists(projectStaticDir)) {
                console.log('Found project static directory, copying assets...');
                
                for (const asset of staticAssets) {
                    const projectStaticPath = path.join(projectStaticDir, asset);
                    const distPath = path.join(distDir, asset);
                    
                    if (await fs.pathExists(projectStaticPath)) {
                        console.log(`Copying ${asset} to dist directory...`);
                        await fs.copy(projectStaticPath, distPath);
                        console.log(`✅ Copied ${asset} to dist directory`);
                    } else {
                        console.warn(`⚠️ Asset not found in project: ${asset}`);
                    }
                }
            } else {
                console.error('❌ Could not find static directory in project');
            }
        }

        console.log('✅ afterPack completed successfully');
    } catch (error) {
        console.error('❌ Error in afterPack:', error);
        // Don't throw the error, just log it
        console.log('Continuing despite error...');
    }
};
