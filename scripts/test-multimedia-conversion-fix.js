/**
 * test-multimedia-conversion-fix.js
 * 
 * This script tests the fix for the "Conversion produced empty content" error
 * by simulating a conversion with the UnifiedConverterFactory and ElectronConversionService.
 * 
 * It creates a mock result with a valid content property but also includes a property
 * that might shadow the content property, then verifies that the content is preserved
 * through the standardizeResult method.
 * 
 * Usage:
 * node scripts/test-multimedia-conversion-fix.js
 */

const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

// Import the modules we want to test
const unifiedConverterFactory = require('../src/electron/converters/UnifiedConverterFactory');
const ElectronConversionService = require('../src/electron/services/ElectronConversionService');

// Create a temporary directory for testing
const tempDir = path.join(__dirname, '..', 'temp-test-conversion');

// Mock the convertFile method to return a result with potential content shadowing
const originalConvertFile = unifiedConverterFactory.convertFile;
unifiedConverterFactory.convertFile = async (filePath, options) => {
  console.log('🔄 Mock convertFile called with:', {
    filePath: typeof filePath === 'string' ? filePath : 'Buffer',
    options: {
      ...options,
      buffer: options.buffer ? `Buffer(${options.buffer.length})` : undefined
    }
  });
  
  // Create a mock result with valid content but also with properties that might shadow it
  return {
    success: true,
    content: '# Test Content\n\nThis is test content that should be preserved.',
    // Properties that might shadow content in different ways
    someProperty: {
      content: null
    },
    nestedContent: {
      value: 'This should not override the main content'
    },
    // In the spread, this would override the explicit content property if ordered incorrectly
    content: null
  };
};

// Run the test
async function runTest() {
  try {
    console.log('🧪 Starting test for multimedia conversion fix...');
    
    // Ensure temp directory exists
    await fs.ensureDir(tempDir);
    console.log(`✅ Created temp directory: ${tempDir}`);
    
    // Create a mock file path and options
    const mockFilePath = path.join(tempDir, 'test.mp4');
    const mockOptions = {
      fileType: 'mp4',
      outputDir: tempDir
    };
    
    // Write a small test file
    await fs.writeFile(mockFilePath, Buffer.from('Test file content'));
    console.log(`✅ Created test file: ${mockFilePath}`);
    
    // Call the convert method
    console.log('🔄 Calling ElectronConversionService.convert...');
    const result = await ElectronConversionService.convert(mockFilePath, mockOptions);
    
    // Verify the result
    console.log('🔍 Conversion result:', {
      success: result.success,
      error: result.error,
      hasContent: !!result.content,
      contentLength: result.content ? result.content.length : 0
    });
    
    if (result.success && result.content) {
      console.log('✅ TEST PASSED: Content was preserved and not shadowed by spread properties');
    } else {
      console.error('❌ TEST FAILED: Content was not preserved');
      console.error('Error:', result.error);
    }
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    console.error('Stack trace:', error.stack);
    
    if (error.message === 'Conversion produced empty content') {
      console.error('❌ The fix for "Conversion produced empty content" did not work!');
    }
  } finally {
    // Restore the original method
    unifiedConverterFactory.convertFile = originalConvertFile;
    
    // Clean up
    try {
      await fs.remove(tempDir);
      console.log(`🧹 Cleaned up temp directory: ${tempDir}`);
    } catch (cleanupError) {
      console.warn(`⚠️ Failed to clean up temp directory: ${cleanupError.message}`);
    }
  }
}

// Run the test
runTest().catch(error => {
  console.error('❌ Unhandled error in test:', error);
  process.exit(1);
});