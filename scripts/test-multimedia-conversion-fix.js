#!/usr/bin/env node

/**
 * Test script to verify video conversion output path fixes.
 *
 * This script:
 * 1. Uses a sample video file.
 * 2. Runs conversion tests via the Electron app for:
 *    a. Explicit output path specified.
 *    b. Default output path (temp directory).
 * 3. Verifies the output file location and content for both cases.
 * 4. Checks logs for specific errors.
 * 5. Cleans up generated files.
 */

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const electron = require('electron');

// Configuration
// Configuration
const TEST_DIR_BASE = path.join(__dirname, '../test-files'); // Base test files dir
const INPUT_VIDEO_PATH = path.join(TEST_DIR_BASE, 'videos/Israel Mod7_v1.mp4'); // Corrected path
const EXPLICIT_OUTPUT_MD_PATH = path.join(TEST_DIR_BASE, 'video-conversion-explicit-result.md');
const LOG_FILE_EXPLICIT = path.join(TEST_DIR_BASE, 'test-explicit-results.log'); // Separate logs
const LOG_FILE_DEFAULT = path.join(TEST_DIR_BASE, 'test-default-results.log');
// Function to find the temp directory used by FileStorageService
// Note: This might need adjustment based on the actual implementation
// of FileStorageService.getTempDirectoryPath or how job IDs are handled.
// For now, we'll look in the system temp dir for a folder starting with 'codexmd-temp'.
const os = require('os');
async function findDefaultOutputDir(jobId) {
    // This is an assumption - the actual implementation might differ
    const systemTemp = os.tmpdir();
    const potentialDirs = await fs.readdir(systemTemp);
    const jobDirPrefix = `codexmd-temp-${jobId}`; // Assuming this pattern
    const foundDir = potentialDirs.find(dir => dir.startsWith(jobDirPrefix) || dir.startsWith('codexmd-temp')); // More general fallback

    if (foundDir) {
        const fullPath = path.join(systemTemp, foundDir);
        const files = await fs.readdir(fullPath);
        const mdFile = files.find(f => f.endsWith('.md'));
        if (mdFile) {
            return path.join(fullPath, mdFile);
        }
    }
    return null; // Not found
}


async function main() {
    try {
        console.log('Starting video conversion output path verification...');

        // Ensure test directory exists
        await fs.ensureDir(TEST_DIR_BASE);

        // Check if input video exists
        if (!await fs.pathExists(INPUT_VIDEO_PATH)) {
            console.error(`❌ Input video not found: ${INPUT_VIDEO_PATH}`);
            console.error('Please place a sample video file at this location.');
            process.exit(1);
        }
        console.log(`Using input video: ${INPUT_VIDEO_PATH}`);

        // --- Run Explicit Path Test ---
        console.log('\n--- Running Explicit Path Conversion Test ---');
        const explicitResult = await runSingleConversionTest(INPUT_VIDEO_PATH, EXPLICIT_OUTPUT_MD_PATH, LOG_FILE_EXPLICIT);

        // --- Run Default Path Test ---
        console.log('\n--- Running Default Path Conversion Test ---');
        const defaultResult = await runSingleConversionTest(INPUT_VIDEO_PATH, null, LOG_FILE_DEFAULT); // Pass null for outputPath

        // --- Verify Results ---
        console.log('\n--- Verifying Results ---');
        const explicitSuccess = await verifyExplicitResult(explicitResult, EXPLICIT_OUTPUT_MD_PATH);
        const defaultSuccess = await verifyDefaultResult(defaultResult);

        // --- Cleanup ---
        await cleanup([EXPLICIT_OUTPUT_MD_PATH, LOG_FILE_EXPLICIT, LOG_FILE_DEFAULT]);
        // Add cleanup for temp dir if possible/needed

        if (explicitSuccess && defaultSuccess) {
            console.log('\n✅ All video output path tests passed successfully!');
            process.exit(0);
        } else {
            console.error('❌ Some tests failed');
            process.exit(1);
        }
    } catch (error) {
        console.error('Error running tests:', error);
        process.exit(1);
    }
    // Removed the finally block that was forcing process.exit(1)
}


/**
 * Runs a single conversion test by spawning the Electron app.
 * @param {string} inputFile - Path to the input video file.
 * @param {string|null} outputPath - The explicit output path, or null for default.
 * @param {string} logFile - Path to write logs for this run.
 * @returns {Promise<Object>} - { success: boolean, output: string, logContent: string, jobId: string }
 */
async function runSingleConversionTest(inputFile, outputPath, logFile) {
    const jobId = `test_${outputPath ? 'explicit' : 'default'}_${Date.now()}`;
    const env = {
        ...process.env,
        NODE_ENV: 'development', // Run against source
        TEST_MODE: 'true',
        TEST_FILE: inputFile,
        TEST_JOB_ID: jobId, // Pass job ID for potential temp dir matching
        // Only set TEST_OUTPUT_PATH if outputPath is provided
        ...(outputPath && { TEST_OUTPUT_PATH: outputPath }),
        ELECTRON_ENABLE_LOGGING: 'true', // Ensure logging is enabled
        ELECTRON_LOG_FILE: logFile // Direct logs to specific file
    };

    console.log(`Spawning Electron with env: TEST_FILE=${env.TEST_FILE}, TEST_OUTPUT_PATH=${env.TEST_OUTPUT_PATH || '(default)'}, LOG_FILE=${logFile}`);

    try {
        // Ensure previous log file is cleared
        await fs.remove(logFile);

        const result = await new Promise((resolve, reject) => {
            // Use require('electron') to get the path
            const electronPath = require('electron');
            const args = ['.']; // Pass the main script path

            const proc = require('child_process').spawn(electronPath, args, { env });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                const str = data.toString();
                console.log('[Electron STDOUT]', str);
                stdout += str;
            });

            proc.stderr.on('data', (data) => {
                const str = data.toString();
                console.error('[Electron STDERR]', str);
                stderr += str;
            });

            proc.on('close', async (code) => {
                console.log(`Electron process exited with code ${code}`);
                let logContent = '';
                try {
                    if (await fs.pathExists(logFile)) {
                        logContent = await fs.readFile(logFile, 'utf8');
                    } else {
                        console.warn(`Log file not found: ${logFile}`);
                    }
                } catch (logError) {
                    console.error(`Error reading log file ${logFile}:`, logError);
                }

                resolve({
                    success: code === 0, // Basic success check
                    output: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
                    logContent: logContent,
                    jobId: jobId
                });
            });

            proc.on('error', (err) => {
                console.error('Failed to start Electron process:', err);
                reject({
                    success: false,
                    output: `Error spawning Electron: ${err.message}`,
                    logContent: '',
                    jobId: jobId
                });
            });
        });
        return result;

    } catch (error) {
        console.error(`Error running conversion test:`, error);
        return {
            success: false,
            output: error.message,
            logContent: '',
            jobId: jobId
        };
    }
}

/**
 * Verifies the result of the explicit output path test.
 * @param {Object} result - The result object from runSingleConversionTest.
 * @param {string} expectedOutputPath - The path where the output MD file should exist.
 * @returns {Promise<boolean>} - True if verification passes.
 */
async function verifyResult(result, expectedOutputPath, isDefaultPathTest = false) {
    let passed = true;
    const testType = isDefaultPathTest ? 'Default Path' : 'Explicit Path';
    const logContent = result.logContent || ''; // Ensure logContent is a string

    console.log(`Verifying ${testType} result...`);

    if (!result.success && !isDefaultPathTest) { // Only fail immediately for explicit path if Electron failed
        console.error(`❌ Electron process failed (${testType}). Output:\n${result.output}`);
        passed = false;
    } else if (!result.success && isDefaultPathTest) {
         console.warn(`⚠️ Electron process failed (${testType}). Output:\n${result.output}. Will still check logs.`);
         // Don't set passed = false yet for default, check logs first
    }


    // Check for critical errors in logs
    if (logContent.includes('Assignment to constant variable')) {
        console.error(`❌ "Assignment to constant variable" error found in logs (${testType}).`);
        passed = false;
    }
    if (logContent.includes('Cannot find module \'ffmpeg-static\'')) {
         console.error(`❌ Missing ffmpeg dependency error found in logs (${testType}).`);
         passed = false;
     }
     if (logContent.includes('ENOENT') && logContent.includes('ffmpeg')) {
          console.error(`❌ Error related to ffmpeg execution (ENOENT) found in logs (${testType}).`);
          passed = false;
      }
     if (logContent.includes('prematurely cleaned up')) { // Check for specific temp file errors
         console.error(`❌ Log indicates potential premature temp file cleanup (${testType}).`);
         passed = false;
     }
     if (logContent.includes('Conversion failed:')) { // Generic failure check
        // Check if it's the OLD conflicting log pattern first
        const conflictingLogRegex = /\[UnifiedConverterFactory:completed\].*✅.*(\n|.)*\[VideoConverter:failed\].*❌/m;
        if (!conflictingLogRegex.test(logContent)) {
            console.error(`❌ Found "Conversion failed:" log message (${testType}).`);
            passed = false;
        }
     }


    // Check for the specific conflicting log pattern
    const conflictingLogRegex = /\[UnifiedConverterFactory:completed\].*✅.*(\n|.)*\[VideoConverter:failed\].*❌/m;
    if (conflictingLogRegex.test(logContent)) {
        console.error(`❌ Found conflicting success/failure logs (${testType}).`);
        passed = false;
    } else {
        console.log(`✅ No conflicting success/failure logs found (${testType}).`);
    }

    // Check for consistent success logs (only if Electron process succeeded *or* default path test AND no major errors found yet)
    const successLogPattern = /\[VideoConverter:completed\].*✅.*(\n|.)*\[UnifiedConverterFactory:completed\].*✅/m;
    if ((result.success || isDefaultPathTest) && passed && successLogPattern.test(logContent)) {
         console.log(`✅ Found consistent success logs (${testType}).`);
    } else if ((result.success || isDefaultPathTest) && passed) {
        console.warn(`⚠️ Could not find expected consistent success logs (${testType}). This might indicate an issue or incomplete logging.`);
        // Don't fail here, file existence is key for success confirmation
    }


    // Check if output file exists (only if expectedOutputPath is provided)
    if (expectedOutputPath) {
        const fileExists = await fs.pathExists(expectedOutputPath);
        if (fileExists) {
            console.log(`✅ Output file found at path: ${expectedOutputPath} (${testType})`);
            // Optional: Verify content
            try {
                const content = await fs.readFile(expectedOutputPath, 'utf8');
                if (content.includes('## Video Information') && content.includes('## Transcription')) { // Basic check
                    console.log(`✅ Output file content seems valid (${testType} - basic check).`);
                } else {
                    console.warn(`⚠️ Output file content might be invalid at ${expectedOutputPath} (${testType}). Content:\n${content.substring(0, 500)}...`);
                    // Not strictly failing, but warning. Focus is on process completion and logs.
                }
            } catch (readError) {
                console.error(`❌ Error reading output file ${expectedOutputPath}:`, readError);
                passed = false;
            }
        } else {
            console.error(`❌ Output file NOT found at expected path: ${expectedOutputPath} (${testType})`);
            passed = false; // This is a definite failure for the happy path
        }
    } else if (!isDefaultPathTest) {
        // This case shouldn't happen if called correctly, but handles missing explicit path
         console.error(`❌ No expected output path provided for explicit test.`);
         passed = false;
    }


    // Final check: if Electron failed in default test, and we didn't find another specific error, mark as failed.
    if (!result.success && isDefaultPathTest && passed) {
        console.error(`❌ Electron process failed for Default Path test, and no specific log error identified the cause.`);
        passed = false;
    }


    return passed;
}

/**
 * Verifies the result of the default output path test.
 * @param {Object} result - The result object from runSingleConversionTest.
 * @returns {Promise<boolean>} - True if verification passes.
 */
async function verifyDefaultResult(result) {
    // Try to find the output file in the temp directory
    const defaultOutputPath = await findDefaultOutputDir(result.jobId);

    if (!defaultOutputPath) {
        console.error(`❌ Could not locate default output directory/file for job ${result.jobId}.`);
        // Run basic log checks anyway using the unified function
        await verifyResult(result, '', true); // Pass empty path, mark as default test
        return false; // Fail because file wasn't found
    }

    // Use the common verification logic, passing the found path
    const passed = await verifyResult(result, defaultOutputPath, true);

    // Clean up the temp directory if the file was found (regardless of pass/fail of content checks)
    // This prevents leaving temp dirs around if content check fails but file exists
    if (await fs.pathExists(defaultOutputPath)) {
        try {
            await fs.remove(path.dirname(defaultOutputPath)); // Remove the job-specific temp dir
            console.log(`Cleaned up temp directory: ${path.dirname(defaultOutputPath)}`);
        } catch (cleanupError) {
            console.error(`⚠️ Error cleaning up temp directory ${path.dirname(defaultOutputPath)}:`, cleanupError);
        }
    }

    return passed;
}


/**
 * Clean up generated test files.
 * @param {string[]} filesToClean - Array of file paths to remove.
 */
async function cleanup(filesToClean = []) {
    console.log('\n--- Cleaning up ---');
    for (const filePath of filesToClean) {
        try {
            if (await fs.pathExists(filePath)) {
                await fs.remove(filePath);
                console.log(`Removed: ${filePath}`);
            }
        } catch (error) {
            console.error(`Error removing ${filePath}:`, error);
        }
    }
     // Add specific temp dir cleanup if needed and not handled in verifyDefaultResult
}

// Run the tests
main().catch(err => {
    console.error("Unhandled error during test execution:", err);
    process.exit(1);
});