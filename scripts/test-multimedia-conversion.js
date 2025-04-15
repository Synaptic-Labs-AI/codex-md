/**
 * test-multimedia-conversion.js
 * 
 * Test script for audio and video conversion functionality in Codex MD.
 * This script tests:
 * - MP3/audio conversion to Markdown
 * - Video conversion to Markdown
 * - Logs the results of each conversion
 * - Verifies that the converted content contains the expected elements
 * 
 * Usage: node scripts/test-multimedia-conversion.js
 */

const fs = require('fs-extra');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { ipcMain } = require('electron');

// Import required services
const FileProcessorService = require('../src/electron/services/storage/FileProcessorService');
const FileStorageService = require('../src/electron/services/storage/FileStorageService');
const OpenAIProxyService = require('../src/electron/services/ai/OpenAIProxyService');
const TranscriberService = require('../src/electron/services/ai/TranscriberService');
const AudioConverter = require('../src/electron/services/conversion/multimedia/AudioConverter');
const VideoConverter = require('../src/electron/services/conversion/multimedia/VideoConverter');

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

// Paths for output files
const MP3_OUTPUT_PATH = path.join(TEST_DIR, 'audio-conversion-result.md');
const VIDEO_OUTPUT_PATH = path.join(TEST_DIR, 'video-conversion-result.md');

// OpenAI API Key - should be provided as an environment variable
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Initialize the test environment
 */
async function initialize() {
  logger.section('Initializing Test Environment');
  
  // Ensure test directory exists
  await fs.ensureDir(TEST_DIR);
  
  // Check if OpenAI API key is provided
  if (!OPENAI_API_KEY) {
    logger.warning('OpenAI API key not provided. Transcription will be skipped.');
    logger.warning('Set the OPENAI_API_KEY environment variable to enable transcription.');
  } else {
    logger.info('OpenAI API key found.');
  }
  
  // Check if test files exist
  const mp3Exists = await fs.pathExists(SAMPLE_MP3_PATH);
  const videoExists = await fs.pathExists(SAMPLE_VIDEO_PATH);
  
  if (!mp3Exists) {
    logger.warning(`Sample MP3 file not found at: ${SAMPLE_MP3_PATH}`);
    logger.warning('Audio conversion test will be skipped.');
  } else {
    logger.info(`Sample MP3 file found at: ${SAMPLE_MP3_PATH}`);
  }
  
  if (!videoExists) {
    logger.warning(`Sample video file not found at: ${SAMPLE_VIDEO_PATH}`);
    logger.warning('Video conversion test will be skipped.');
  } else {
    logger.info(`Sample video file found at: ${SAMPLE_VIDEO_PATH}`);
  }
  
  return {
    mp3Exists,
    videoExists,
    apiKeyExists: !!OPENAI_API_KEY
  };
}

/**
 * Create service instances
 */
function createServices() {
  logger.section('Creating Service Instances');
  
  // Create service instances
  const fileProcessorInstance = new FileProcessorService();
  const fileStorageInstance = new FileStorageService();
  const openAIProxyInstance = new OpenAIProxyService();
  
  // Configure OpenAI API if key is provided
  if (OPENAI_API_KEY) {
    openAIProxyInstance.handleConfigure(null, { apiKey: OPENAI_API_KEY })
      .then(() => logger.info('OpenAI API configured successfully.'))
      .catch(error => logger.error(`Failed to configure OpenAI API: ${error.message}`));
  }
  
  const transcriberInstance = new TranscriberService(openAIProxyInstance, fileStorageInstance);
  const audioConverterInstance = new AudioConverter(fileProcessorInstance, transcriberInstance, fileStorageInstance);
  const videoConverterInstance = new VideoConverter(fileProcessorInstance, transcriberInstance, fileStorageInstance);
  
  logger.info('Service instances created successfully.');
  
  return {
    fileProcessor: fileProcessorInstance,
    fileStorage: fileStorageInstance,
    openAIProxy: openAIProxyInstance,
    transcriber: transcriberInstance,
    audioConverter: audioConverterInstance,
    videoConverter: videoConverterInstance
  };
}

/**
 * Test audio conversion
 */
async function testAudioConversion(services) {
  logger.section('Testing Audio Conversion');
  
  try {
    // Read the MP3 file
    logger.info(`Reading MP3 file: ${SAMPLE_MP3_PATH}`);
    const audioBuffer = await fs.readFile(SAMPLE_MP3_PATH);
    
    // Set conversion options
    const options = {
      transcribe: services.apiKeyExists,
      language: 'en',
      title: 'Audio Conversion Test'
    };
    
    // Convert the MP3 file
    logger.info('Converting MP3 file to Markdown...');
    const result = await services.audioConverter.processConversion(
      `audio_test_${Date.now()}`,
      SAMPLE_MP3_PATH,
      options
    );
    
    // Save the result to a file
    await fs.writeFile(MP3_OUTPUT_PATH, result);
    logger.info(`Conversion result saved to: ${MP3_OUTPUT_PATH}`);
    
    // Verify the result
    verifyAudioConversionResult(result, options);
    
    return true;
  } catch (error) {
    logger.error(`Audio conversion failed: ${error.message}`);
    return false;
  }
}

/**
 * Test video conversion
 */
async function testVideoConversion(services) {
  logger.section('Testing Video Conversion');
  
  try {
    // Read the video file
    logger.info(`Reading video file: ${SAMPLE_VIDEO_PATH}`);
    const videoBuffer = await fs.readFile(SAMPLE_VIDEO_PATH);
    
    // Set conversion options
    const options = {
      transcribe: services.apiKeyExists,
      language: 'en',
      title: 'Video Conversion Test',
      thumbnailCount: 3
    };
    
    // Convert the video file
    logger.info('Converting video file to Markdown...');
    const result = await services.videoConverter.processConversion(
      `video_test_${Date.now()}`,
      SAMPLE_VIDEO_PATH,
      options
    );
    
    // Save the result to a file
    await fs.writeFile(VIDEO_OUTPUT_PATH, result);
    logger.info(`Conversion result saved to: ${VIDEO_OUTPUT_PATH}`);
    
    // Verify the result
    verifyVideoConversionResult(result, options);
    
    return true;
  } catch (error) {
    logger.error(`Video conversion failed: ${error.message}`);
    return false;
  }
}

/**
 * Verify audio conversion result
 */
function verifyAudioConversionResult(markdown, options) {
  logger.info('Verifying audio conversion result...');
  
  // Check for title
  if (markdown.includes(`# ${options.title}`)) {
    logger.success('Title found in the markdown.');
  } else {
    logger.error('Title not found in the markdown.');
  }
  
  // Check for audio information section
  if (markdown.includes('## Audio Information')) {
    logger.success('Audio Information section found.');
  } else {
    logger.error('Audio Information section not found.');
  }
  
  // Check for metadata table
  if (markdown.includes('| Property | Value |') && 
      markdown.includes('| --- | --- |') &&
      markdown.includes('| Filename |') &&
      markdown.includes('| Duration |') &&
      markdown.includes('| Format |') &&
      markdown.includes('| Codec |') &&
      markdown.includes('| Channels |') &&
      markdown.includes('| Sample Rate |') &&
      markdown.includes('| Bitrate |') &&
      markdown.includes('| File Size |')) {
    logger.success('Metadata table found with all expected fields.');
  } else {
    logger.error('Metadata table missing or incomplete.');
  }
  
  // Check for transcription if enabled
  if (options.transcribe) {
    if (markdown.includes('## Transcription')) {
      logger.success('Transcription section found.');
    } else {
      logger.error('Transcription section not found.');
    }
  } else {
    logger.info('Transcription was disabled, skipping transcription verification.');
  }
}

/**
 * Verify video conversion result
 */
function verifyVideoConversionResult(markdown, options) {
  logger.info('Verifying video conversion result...');
  
  // Check for title
  if (markdown.includes(`# ${options.title}`)) {
    logger.success('Title found in the markdown.');
  } else {
    logger.error('Title not found in the markdown.');
  }
  
  // Check for video information section
  if (markdown.includes('## Video Information')) {
    logger.success('Video Information section found.');
  } else {
    logger.error('Video Information section not found.');
  }
  
  // Check for metadata table
  if (markdown.includes('| Property | Value |') && 
      markdown.includes('| --- | --- |') &&
      markdown.includes('| Filename |') &&
      markdown.includes('| Duration |') &&
      markdown.includes('| Resolution |') &&
      markdown.includes('| Format |') &&
      markdown.includes('| Video Codec |') &&
      markdown.includes('| Frame Rate |') &&
      markdown.includes('| Bitrate |') &&
      markdown.includes('| File Size |')) {
    logger.success('Metadata table found with all expected fields.');
  } else {
    logger.error('Metadata table missing or incomplete.');
  }
  
  // Check for thumbnails
  if (markdown.includes('## Thumbnails')) {
    logger.success('Thumbnails section found.');
    
    // Check for the expected number of thumbnails
    const thumbnailCount = (markdown.match(/!\[Thumbnail at/g) || []).length;
    if (thumbnailCount === options.thumbnailCount) {
      logger.success(`Found ${thumbnailCount} thumbnails as expected.`);
    } else {
      logger.error(`Expected ${options.thumbnailCount} thumbnails, but found ${thumbnailCount}.`);
    }
  } else {
    logger.error('Thumbnails section not found.');
  }
  
  // Check for transcription if enabled
  if (options.transcribe) {
    if (markdown.includes('## Transcription')) {
      logger.success('Transcription section found.');
    } else {
      logger.error('Transcription section not found.');
    }
  } else {
    logger.info('Transcription was disabled, skipping transcription verification.');
  }
}

/**
 * Main test function
 */
async function runTests() {
  try {
    // Initialize test environment
    const { mp3Exists, videoExists, apiKeyExists } = await initialize();
    
    // Create service instances
    const services = createServices();
    services.apiKeyExists = apiKeyExists;
    
    // Run tests
    let audioSuccess = false;
    let videoSuccess = false;
    
    if (mp3Exists) {
      audioSuccess = await testAudioConversion(services);
    } else {
      logger.warning('Skipping audio conversion test due to missing MP3 file.');
    }
    
    if (videoExists) {
      videoSuccess = await testVideoConversion(services);
    } else {
      logger.warning('Skipping video conversion test due to missing video file.');
    }
    
    // Print summary
    logger.section('Test Summary');
    if (mp3Exists) {
      logger.info(`Audio Conversion Test: ${audioSuccess ? 'PASSED' : 'FAILED'}`);
    } else {
      logger.info('Audio Conversion Test: SKIPPED');
    }
    
    if (videoExists) {
      logger.info(`Video Conversion Test: ${videoSuccess ? 'PASSED' : 'FAILED'}`);
    } else {
      logger.info('Video Conversion Test: SKIPPED');
    }
    
    if (audioSuccess && videoSuccess) {
      logger.success('All tests passed successfully!');
    } else if (!mp3Exists && !videoExists) {
      logger.warning('No tests were run. Please provide sample files.');
    } else {
      logger.error('Some tests failed. Check the logs for details.');
    }
  } catch (error) {
    logger.error(`Test execution failed: ${error.message}`);
  }
}

// Run the tests
runTests().catch(error => {
  logger.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});