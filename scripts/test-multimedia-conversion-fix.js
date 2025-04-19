#!/usr/bin/env node

/**
 * Test script to verify video conversion buffer sanitization fix in production builds
 * 
 * This script:
 * 1. Builds the app in production mode
 * 2. Creates test video files of various sizes
 * 3. Runs conversion tests
 * 4. Verifies logging output
 * 5. Cleans up test files
 */

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const electron = require('electron');

// Configuration
const TEST_SIZES = [1, 10, 40, 100]; // MB
const TEST_DIR = path.join(__dirname, '../test-files/multimedia-fix');
const LOG_FILE = path.join(TEST_DIR, 'test-results.log');

async function main() {
    try {
        console.log('Starting multimedia conversion fix verification...');

        // Ensure test directory exists
        await fs.ensureDir(TEST_DIR);
        
        // Create test video files
        console.log('Creating test files...');
        const testFiles = await createTestFiles();
        
        // Build app in production mode
        console.log('Building app in production mode...');
        execSync('npm run build', { stdio: 'inherit' });
        
        // Run conversion tests
        console.log('Running conversion tests...');
        const results = await runConversionTests(testFiles);
        
        // Verify results
        console.log('Verifying results...');
        const success = verifyResults(results);
        
        if (success) {
            console.log('✅ All tests passed successfully');
            process.exit(0);
        } else {
            console.error('❌ Some tests failed');
            process.exit(1);
        }
    } catch (error) {
        console.error('Error running tests:', error);
        process.exit(1);
    } finally {
        // Cleanup
        await cleanup();
    }
}

/**
 * Create test video files of various sizes
 * @returns {Promise<string[]>} Array of test file paths
 */
async function createTestFiles() {
    const files = [];
    
    for (const size of TEST_SIZES) {
        const filePath = path.join(TEST_DIR, `test-${size}MB.mp4`);
        // Create buffer of specified size
        const buffer = Buffer.alloc(size * 1024 * 1024);
        // Write some recognizable pattern
        buffer.write('TEST VIDEO CONTENT', 0, 'utf8');
        await fs.writeFile(filePath, buffer);
        files.push(filePath);
        console.log(`Created ${size}MB test file: ${filePath}`);
    }
    
    return files;
}

/**
 * Run conversion tests on each test file
 * @param {string[]} testFiles - Array of test file paths
 * @returns {Promise<Object>} Test results
 */
async function runConversionTests(testFiles) {
    const results = {
        conversions: [],
        logs: []
    };
    
    for (const file of testFiles) {
        console.log(`Testing conversion of ${path.basename(file)}...`);
        
        try {
            // Run conversion through the app
            const conversionResult = await new Promise((resolve) => {
                const proc = require('child_process').spawn(electron, ['.'], {
                    env: {
                        ...process.env,
                        NODE_ENV: 'production',
                        TEST_FILE: file,
                        TEST_MODE: 'true'
                    }
                });
                
                let output = '';
                
                proc.stdout.on('data', (data) => {
                    output += data;
                });
                
                proc.stderr.on('data', (data) => {
                    output += data;
                });
                
                proc.on('close', (code) => {
                    resolve({
                        file,
                        success: code === 0,
                        output
                    });
                });
            });
            
            results.conversions.push(conversionResult);
            
            // Collect logs
            const logContent = await fs.readFile(LOG_FILE, 'utf8');
            results.logs.push({
                file,
                content: logContent
            });
        } catch (error) {
            results.conversions.push({
                file,
                success: false,
                error: error.message
            });
        }
    }
    
    return results;
}

/**
 * Verify test results meet our criteria
 * @param {Object} results - Test results to verify
 * @returns {boolean} Whether all tests passed
 */
function verifyResults(results) {
    let allPassed = true;
    
    // Verify each conversion
    for (const conversion of results.conversions) {
        const fileSize = parseInt(path.basename(conversion.file).match(/\d+/)[0]);
        
        if (!conversion.success) {
            console.error(`❌ Conversion failed for ${fileSize}MB file:`, conversion.error || 'Unknown error');
            allPassed = false;
            continue;
        }
        
        // Find corresponding logs
        const logs = results.logs.find(l => l.file === conversion.file)?.content || '';
        
        // Verify no raw buffer content in logs
        if (logs.includes('Buffer content:')) {
            console.error(`❌ Raw buffer content found in logs for ${fileSize}MB file`);
            allPassed = false;
        }
        
        // Verify buffer length indicators are present
        if (!logs.includes('[Buffer length:')) {
            console.error(`❌ Missing buffer length indicators in logs for ${fileSize}MB file`);
            allPassed = false;
        }
        
        // Verify no memory errors
        if (logs.includes('JavaScript heap out of memory') || 
            logs.includes('Invalid string length') ||
            logs.includes('Maximum call stack size exceeded')) {
            console.error(`❌ Memory-related errors found in logs for ${fileSize}MB file`);
            allPassed = false;
        }
        
        if (allPassed) {
            console.log(`✅ All checks passed for ${fileSize}MB file`);
        }
    }
    
    return allPassed;
}

/**
 * Clean up test files and directories
 */
async function cleanup() {
    try {
        await fs.remove(TEST_DIR);
        console.log('Cleaned up test files');
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

// Run the tests
main().catch(console.error);