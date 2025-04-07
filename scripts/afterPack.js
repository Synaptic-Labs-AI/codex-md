/**
 * afterPack.js
 * Post-packaging script to handle platform-specific tasks
 * This script runs after electron-builder packages the app but before creating installers
 */

const fs = require('fs-extra');
const path = require('path');

exports.default = async function(context) {
    const { appOutDir, packager, electronPlatformName } = context;

    console.log('Running afterPack script for platform:', electronPlatformName);

    try {
        // Platform-specific processing
        switch (electronPlatformName) {
            case 'darwin': {
                await handleMacOS(appOutDir);
                break;
            }
            case 'win32': {
                await handleWindows(appOutDir);
                break;
            }
            case 'linux': {
                await handleLinux(appOutDir);
                break;
            }
        }

        console.log('✅ afterPack completed successfully');
    } catch (error) {
        console.error('❌ Error in afterPack:', error);
        throw error;
    }
};

/**
 * Handle macOS-specific post-packaging tasks
 * @param {string} appOutDir - Output directory containing the app
 */
async function handleMacOS(appOutDir) {
    console.log('📝 Processing macOS build...');

    try {
        // Set executable permissions for ffmpeg
        const ffmpegPath = path.join(appOutDir, 'codex.md.app', 'Contents', 'Resources', 'ffmpeg');
        if (await fs.pathExists(ffmpegPath)) {
            await fs.chmod(ffmpegPath, 0o755);
            console.log('✅ Set ffmpeg permissions');
        }

        // Any additional macOS-specific tasks...

    } catch (error) {
        console.error('❌ macOS processing failed:', error);
        throw error;
    }
}

/**
 * Handle Windows-specific post-packaging tasks
 * @param {string} appOutDir - Output directory containing the app
 */
async function handleWindows(appOutDir) {
    console.log('📝 Processing Windows build...');

    try {
        // Verify ffmpeg.exe exists
        const ffmpegPath = path.join(appOutDir, 'resources', 'ffmpeg.exe');
        if (await fs.pathExists(ffmpegPath)) {
            console.log('✅ Verified ffmpeg.exe');
        } else {
            throw new Error('ffmpeg.exe not found in resources');
        }

        // Any additional Windows-specific tasks...

    } catch (error) {
        console.error('❌ Windows processing failed:', error);
        throw error;
    }
}

/**
 * Handle Linux-specific post-packaging tasks
 * @param {string} appOutDir - Output directory containing the app
 */
async function handleLinux(appOutDir) {
    console.log('📝 Processing Linux build...');

    try {
        // Set executable permissions for ffmpeg
        const ffmpegPath = path.join(appOutDir, 'resources', 'ffmpeg');
        if (await fs.pathExists(ffmpegPath)) {
            await fs.chmod(ffmpegPath, 0o755);
            console.log('✅ Set ffmpeg permissions');
        }

        // Set executable flag on main binary
        const appBinaryPath = path.join(appOutDir, 'codex-md');
        if (await fs.pathExists(appBinaryPath)) {
            await fs.chmod(appBinaryPath, 0o755);
            console.log('✅ Set app binary permissions');
        }

        // Any additional Linux-specific tasks...

    } catch (error) {
        console.error('❌ Linux processing failed:', error);
        throw error;
    }
}
