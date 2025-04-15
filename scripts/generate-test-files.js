/**
 * generate-test-files.js
 * 
 * Helper script to generate sample audio and video files for testing.
 * This script creates:
 * - A sample MP3 file with a sine wave tone
 * - A sample MP4 video file with a test pattern
 * 
 * Usage: node scripts/generate-test-files.js
 */

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

// Create a logger function
const logger = {
  info: (message) => console.log(`[INFO] ${message}`),
  success: (message) => console.log(`[SUCCESS] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`),
  warning: (message) => console.warn(`[WARNING] ${message}`),
  section: (title) => {
    console.log('\n' + '='.repeat(80));
    console.log(`${title}`);
    console.log('='.repeat(80));
  }
};

// Create a test directory for sample files
const TEST_DIR = path.join(__dirname, '../test-files');

// Paths for test files
const SAMPLE_MP3_PATH = path.join(TEST_DIR, 'sample-audio.mp3');
const SAMPLE_VIDEO_PATH = path.join(TEST_DIR, 'sample-video.mp4');

/**
 * Check if FFmpeg is installed
 */
function checkFFmpegInstalled() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Generate a sample MP3 file
 */
function generateSampleMP3() {
  logger.section('Generating Sample MP3 File');
  
  try {
    // Generate a 5-second sine wave tone at 440Hz
    const command = `ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -c:a libmp3lame -q:a 2 "${SAMPLE_MP3_PATH}"`;
    
    logger.info('Executing FFmpeg command to generate MP3...');
    execSync(command);
    
    logger.success(`Sample MP3 file created at: ${SAMPLE_MP3_PATH}`);
    return true;
  } catch (error) {
    logger.error(`Failed to generate sample MP3 file: ${error.message}`);
    return false;
  }
}

/**
 * Generate a sample MP4 video file
 */
function generateSampleVideo() {
  logger.section('Generating Sample Video File');
  
  try {
    // Generate a 5-second test pattern video with a sine wave tone
    const command = `ffmpeg -f lavfi -i "testsrc=duration=5:size=640x480:rate=30" -f lavfi -i "sine=frequency=440:duration=5" -c:v libx264 -c:a aac -strict experimental "${SAMPLE_VIDEO_PATH}"`;
    
    logger.info('Executing FFmpeg command to generate MP4...');
    execSync(command);
    
    logger.success(`Sample video file created at: ${SAMPLE_VIDEO_PATH}`);
    return true;
  } catch (error) {
    logger.error(`Failed to generate sample video file: ${error.message}`);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Ensure test directory exists
    await fs.ensureDir(TEST_DIR);
    
    // Check if FFmpeg is installed
    if (!checkFFmpegInstalled()) {
      logger.error('FFmpeg is not installed or not in the PATH. Please install FFmpeg to generate test files.');
      process.exit(1);
    }
    
    // Generate sample files
    const mp3Success = generateSampleMP3();
    const videoSuccess = generateSampleVideo();
    
    // Print summary
    logger.section('Summary');
    logger.info(`MP3 Generation: ${mp3Success ? 'SUCCESS' : 'FAILED'}`);
    logger.info(`Video Generation: ${videoSuccess ? 'SUCCESS' : 'FAILED'}`);
    
    if (mp3Success && videoSuccess) {
      logger.success('All test files generated successfully!');
    } else {
      logger.error('Some test files could not be generated. Check the logs for details.');
    }
  } catch (error) {
    logger.error(`An error occurred: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main();