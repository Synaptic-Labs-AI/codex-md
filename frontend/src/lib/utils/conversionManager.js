/**
 * Conversion Manager
 * 
 * Manages the file conversion process, supporting both web and Electron environments.
 * In web mode, it uses HTTP requests and browser APIs.
 * In Electron mode, it uses IPC communication and native file system.
 * 
 * Related files:
 * - frontend/src/lib/api/client.js: HTTP API client
 * - frontend/src/lib/api/electron: Electron IPC client modules
 * - frontend/src/lib/stores/conversionResult.js: Stores conversion results
 * - frontend/src/lib/components/ResultDisplay.svelte: Displays conversion results
 */

import { get } from 'svelte/store';
import { files } from '$lib/stores/files.js';
import { apiKey } from '$lib/stores/apiKey.js';
import { conversionStatus } from '$lib/stores/conversionStatus.js';
import client from '$lib/api/client.js';
import electronClient, { fileSystemOperations } from '$lib/api/electron';
import FileSaver from 'file-saver';
import { CONFIG } from '$lib/config'; 
import { conversionResult } from '$lib/stores/conversionResult.js';
import { validateAndNormalizeItem } from '$lib/api/electron';

// Check if we're running in Electron
const isElectron = typeof window !== 'undefined' && 
  window.electronAPI !== undefined;

/**
 * Utility function to read a file as base64
 */
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
  });
}

/**
 * Saves a File object to a temporary file in Electron
 * @param {File} file - The File object to save
 * @returns {Promise<string>} - Path to the temporary file
 */
async function saveTempFile(file) {
  if (!isElectron || !window.electronAPI) {
    throw new Error('Cannot save temporary file: Not running in Electron environment');
  }
  
  console.log(`📊 [saveTempFile] Starting file transfer for: ${file.name}`);
  console.log(`📊 [saveTempFile] File size: ${file.size} bytes, Type: ${file.type}`);
  
  // Create a unique filename based on the original filename
  const fileExt = file.name.split('.').pop().toLowerCase();
  const tempFileName = `temp_${Date.now()}_${file.name}`;
  
  // Use a default temp directory
  const tempDir = 'temp';
  
  // Create the temp directory if it doesn't exist
  await fileSystemOperations.createDirectory(tempDir);
  
  // Full path to the temporary file
  const tempFilePath = `${tempDir}/${tempFileName}`;
  
  // For binary files like PDFs, we need to handle them differently
  const isBinaryFile = ['pdf', 'pptx', 'docx', 'xlsx', 'jpg', 'jpeg', 'png', 'gif', 'mp3', 'mp4', 'wav', 'webm', 'avi'].includes(fileExt.toLowerCase());
  
  // Special handling for large video files
  const isVideoFile = ['mp4', 'webm', 'avi'].includes(fileExt.toLowerCase());
  const isLargeFile = file.size > 100 * 1024 * 1024; // 100MB threshold
  
  if (isVideoFile && isLargeFile) {
    console.log(`📊 [saveTempFile] Handling as large video file: ${fileExt} (${Math.round(file.size / (1024 * 1024))}MB)`);
    
    // For large video files, use a different approach that doesn't rely on base64 conversion
    // Use a special prefix to indicate this is a large file that needs special handling
    // The main process will recognize this prefix and handle accordingly
    
    // Write a placeholder file with metadata about the original file
    const metadataObj = {
      originalName: file.name,
      originalSize: file.size,
      originalType: file.type,
      timestamp: Date.now(),
      needsStreamProcessing: true
    };
    
    const metadataStr = `LARGE_FILE:${JSON.stringify(metadataObj)}`;
    
    console.log(`📊 [saveTempFile] Writing metadata placeholder for large file`);
    const writeResult = await fileSystemOperations.writeFile(tempFilePath, metadataStr);
    
    if (!writeResult.success) {
      console.error(`❌ [saveTempFile] Write failed: ${writeResult.error}`);
      throw new Error(`Failed to write temporary file metadata: ${writeResult.error}`);
    }
    
    // Now write the actual file data in chunks using a special IPC channel
    console.log(`📊 [saveTempFile] Starting chunked file transfer for large video`);
    
    try {
      // Use the specialized video file transfer method from electronClient
      const transferResult = await electronClient.transferLargeFile(file, tempFilePath, (progress) => {
        console.log(`📊 [saveTempFile] Transfer progress: ${Math.round(progress)}%`);
      });
      
      if (!transferResult.success) {
        throw new Error(`Failed to transfer large file: ${transferResult.error}`);
      }
      
      console.log(`✅ [saveTempFile] Large file transfer complete: ${transferResult.finalPath}`);
      return transferResult.finalPath;
    } catch (error) {
      console.error(`❌ [saveTempFile] Large file transfer failed:`, error);
      
      // Attempt to clean up the placeholder file
      try {
        await fileSystemOperations.deleteItem(tempFilePath, false);
      } catch (cleanupError) {
        console.warn(`⚠️ [saveTempFile] Failed to clean up placeholder file:`, cleanupError);
      }
      
      throw new Error(`Failed to transfer large video file: ${error.message}`);
    }
  } else if (isBinaryFile) {
    console.log(`📊 [saveTempFile] Handling as binary file: ${fileExt}`);
    
    try {
      // For binary files, we need to convert the base64 to a binary format
      // First read as base64
      console.log(`📊 [saveTempFile] Reading file as base64...`);
      const startTime = Date.now();
      const base64Data = await readFileAsBase64(file);
      const readTime = Date.now() - startTime;
      
      console.log(`📊 [saveTempFile] Base64 conversion complete in ${readTime}ms`);
      
      // Check if base64Data is valid
      if (!base64Data) {
        throw new Error(`Failed to convert file to base64: ${file.name}`);
      }
      
      console.log(`📊 [saveTempFile] Base64 data length: ${base64Data.length} characters`);
      
      // Calculate expected decoded size (approximate)
      const expectedDecodedSize = Math.ceil(base64Data.length * 0.75);
      console.log(`📊 [saveTempFile] Expected decoded size: ~${expectedDecodedSize} bytes`);
      
      // Add a special prefix to indicate this is base64 data that needs to be decoded
      // The main process will recognize this prefix and decode it
      const prefixedData = `BASE64:${base64Data}`;
      
      // Write the file with the prefix
      console.log(`📊 [saveTempFile] Writing to temporary file: ${tempFilePath}`);
      const writeStartTime = Date.now();
      const writeResult = await fileSystemOperations.writeFile(tempFilePath, prefixedData);
      const writeTime = Date.now() - writeStartTime;
      
      if (!writeResult.success) {
        console.error(`❌ [saveTempFile] Write failed: ${writeResult.error}`);
        throw new Error(`Failed to write temporary binary file: ${writeResult.error}`);
      }
      
      console.log(`📊 [saveTempFile] File written in ${writeTime}ms`);
      
      // Verify file was written correctly
      try {
        const stats = await fileSystemOperations.getStats(tempFilePath);
        if (stats.success) {
          console.log(`📊 [saveTempFile] Temporary file stats: Size=${stats.stats.size} bytes`);
          
          // Check if file size is reasonable (should be at least close to original size)
          if (stats.stats.size < file.size * 0.9) {
            console.warn(`⚠️ [saveTempFile] File size mismatch! Original: ${file.size}, Written: ${stats.stats.size}`);
          }
        }
      } catch (error) {
        console.warn(`⚠️ [saveTempFile] Could not verify file stats: ${error.message}`);
      }
    } catch (error) {
      console.error(`❌ [saveTempFile] Error processing binary file:`, error);
      throw new Error(`Failed to process binary file: ${error.message}`);
    }
  } else {
    // For text files, just read as text and write directly
    console.log(`📊 [saveTempFile] Handling as text file: ${fileExt}`);
    const textData = await file.text();
    console.log(`📊 [saveTempFile] Text data length: ${textData.length} characters`);
    
    const writeResult = await fileSystemOperations.writeFile(tempFilePath, textData);
    
    if (!writeResult.success) {
      console.error(`❌ [saveTempFile] Write failed: ${writeResult.error}`);
      throw new Error(`Failed to write temporary text file: ${writeResult.error}`);
    }
  }
  
  console.log(`✅ [saveTempFile] Temporary file saved to: ${tempFilePath}`);
  return tempFilePath;
}

/**
 * Cleans up a temporary file
 * @param {string} filePath - Path to the temporary file
 */
async function cleanupTempFile(filePath) {
  if (!isElectron || !window.electronAPI) {
    return;
  }
  
  console.log(`🧹 [cleanupTempFile] Cleaning up temporary file: ${filePath}`);
  
  // Verify file exists and get stats before deletion
  try {
    const stats = await fileSystemOperations.getStats(filePath);
    if (stats.success) {
      console.log(`📊 [cleanupTempFile] File stats before deletion: Size=${stats.stats.size} bytes, isFile=${stats.stats.isFile}`);
    } else {
      console.warn(`⚠️ [cleanupTempFile] Could not get stats for file: ${stats.error}`);
    }
  } catch (statsError) {
    console.warn(`⚠️ [cleanupTempFile] Error checking file stats: ${statsError.message}`);
  }
  
  try {
    const deleteResult = await fileSystemOperations.deleteItem(filePath, false);
    if (deleteResult.success) {
      console.log(`✅ [cleanupTempFile] Temporary file deleted successfully: ${filePath}`);
    } else {
      console.warn(`⚠️ [cleanupTempFile] Delete operation returned error: ${deleteResult.error}`);
    }
  } catch (error) {
    console.warn(`❌ [cleanupTempFile] Failed to delete temporary file: ${filePath}`, error);
  }
  
  // Verify file was actually deleted
  try {
    const checkStats = await fileSystemOperations.getStats(filePath);
    if (checkStats.success) {
      console.error(`❌ [cleanupTempFile] File still exists after deletion attempt: ${filePath}`);
    } else {
      console.log(`✅ [cleanupTempFile] Confirmed file no longer exists`);
    }
  } catch (error) {
    // This is expected - file should not exist
    console.log(`✅ [cleanupTempFile] Confirmed file no longer exists (error accessing file)`);
  }
}

/**
 * Prepares batch items for conversion, supporting files, URLs, and parent URLs
 * @param {Array} items - Array of items to convert
 * @returns {Promise<Array>} - Array of prepared items
 */
function prepareBatchItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No items provided for conversion');
  }
  
  return Promise.all(items.map(async item => {
    const prepared = isElectron ? validateAndNormalizeItem(item) : item;
    
    // Determine if item should be included in batch based on type
    if (prepared.type === 'url' || prepared.type === 'parent') {
      // URLs and parent URLs can be batched
      prepared.shouldBatch = true;
      prepared.isUrl = true; // Flag for special handling
    } else {
      // For files and other types, use original logic
      prepared.shouldBatch = prepared.type !== 'document';
      prepared.isUrl = false;
    }
    
    return prepared;
  }));
}

/**
 * Starts the conversion process
 */
export async function startConversion() {
  const currentFiles = get(files);
  const currentApiKey = get(apiKey);

  if (currentFiles.length === 0) {
    const error = new Error('No files available for conversion.');
    conversionStatus.setError(error.message);
    conversionStatus.setStatus('error');
    console.error(error);
    return;
  }

  conversionStatus.setStatus('initializing');
  conversionStatus.setProgress(0);

  try {
    // Prepare items for conversion
    const items = await prepareBatchItems(currentFiles);
    const itemCount = items.length;

    // Handle conversion based on environment
    if (isElectron) {
      // First prompt for output directory
      conversionStatus.setStatus('selecting_output');
      const outputResult = await electronClient.selectOutputDirectory();
      
      if (!outputResult.success) {
        // User cancelled directory selection
        conversionStatus.setStatus('cancelled');
        showFeedback('Conversion cancelled: No output directory selected', 'info');
        return;
      }
      
      // Proceed with conversion using the selected directory
      await handleElectronConversion(items, currentApiKey, outputResult.path);
    } else {
      await handleWebConversion(items, currentApiKey);
    }

    // Update status
    conversionStatus.setStatus('processing');
    showFeedback('✨ Processing started! You will be notified when the conversion is complete.', 'success');

  } catch (error) {
    console.error('Conversion error:', error);

    conversionStatus.setError(error.message || 'An unexpected error occurred during conversion');
    conversionStatus.setStatus('error');
    showFeedback(error.message || 'An unexpected error occurred during conversion', 'error');
  }
}

/**
 * Handles conversion in Electron environment
 * @private
 * @param {Array} items - Items to convert
 * @param {string} apiKey - API key for services that require it
 * @param {string} outputDir - Directory to save conversion results
 */
async function handleElectronConversion(items, apiKey, outputDir) {
  // Update status
  conversionStatus.setStatus('converting');
  conversionStatus.setProgress(0);
  
  try {
    // Create options object with outputDir and createSubdirectory: false
    const options = {
      outputDir,
      createSubdirectory: false, // Save directly to the selected directory without creating subdirectories
      // Add API key if available
      ...(apiKey ? { apiKey } : {})
    };
    
    console.log('Conversion options:', {
      outputDir,
      createSubdirectory: false,
      hasApiKey: !!apiKey
    });
    
    // For single file conversion
    if (items.length === 1) {
      const item = items[0];
      
      // Set current file in status
      conversionStatus.setCurrentFile(item.name);
      
      // Handle different item types
      let result;
      if (item.isNative && item.path) {
        // Convert native file path with output directory
        result = await electronClient.convertFile(item.path, {
          ...item.options,
          ...options
        }, (progress) => {
          conversionStatus.setProgress(progress);
        });
      } else if (item.type === 'url') {
        // Convert URL with output directory
        result = await electronClient.convertUrl(item.url, {
          ...item.options,
          ...options
        }, (progress) => {
          conversionStatus.setProgress(progress);
        });
      } else if (item.type === 'parent') {
        // Convert parent URL (website) with output directory
        result = await electronClient.convertParentUrl(item.url, {
          ...item.options,
          ...options
        }, (progress) => {
          conversionStatus.setProgress(progress);
        });
      } else if (item.type === 'youtube') {
        // Convert YouTube URL with output directory
        result = await electronClient.convertYoutube(item.url, {
          ...item.options,
          ...options
        }, (progress) => {
          conversionStatus.setProgress(progress);
        });
      } else if (item.file instanceof File) {
        // Convert File object by saving to a temporary file first
        conversionStatus.setStatus('preparing');
        conversionStatus.setProgress(10);
        
        // Save the file to a temporary location
        const tempFilePath = await saveTempFile(item.file);
        
        try {
          // Convert the temporary file
          result = await electronClient.convertFile(tempFilePath, {
            ...item.options,
            ...options,
            isTemporary: true // Flag to indicate this is a temporary file
          }, (progress) => {
            // Scale progress from 20-90% to account for temp file operations
            conversionStatus.setProgress(20 + (progress * 0.7));
          });
          
          conversionStatus.setProgress(90);
        } finally {
          // Clean up the temporary file regardless of success/failure
          await cleanupTempFile(tempFilePath);
          conversionStatus.setProgress(95);
        }
      }
      
      // Update status and store result
      if (result && result.outputPath) {
        conversionStatus.setStatus('completed');
        conversionStatus.setProgress(100);
        
        // Store the result
        conversionResult.setNativeResult(result.outputPath, [item]);
        
        // Update file status
        files.updateFile(item.id, {
          status: 'completed',
          outputPath: result.outputPath
        });
      } else {
        throw new Error('Conversion failed: No output path returned');
      }
    } 
    // For batch conversion
    else {
      // First, handle any File objects by saving them to temporary files
      conversionStatus.setStatus('preparing');
      conversionStatus.setProgress(5);
      
      // Track temporary files for cleanup
      const tempFilePaths = [];
      
      // Process each item to handle File objects and URLs
      const processedItems = await Promise.all(
        items.map(async (item, index) => {
          if (item.isUrl) {
            // For URLs, return an object with URL info
            return {
              type: item.type,
              url: item.url,
              options: item.options,
              id: item.id
            };
          }
          // For native files, just use the path
          else if (item.isNative && item.path) {
            return {
              type: 'file',
              path: item.path,
              options: item.options,
              id: item.id
            };
          }
          // For File objects, save to temporary file first
          else if (item.file instanceof File) {
            conversionStatus.setCurrentFile(`Preparing ${item.file.name}...`);
            const tempFilePath = await saveTempFile(item.file);
            tempFilePaths.push({ path: tempFilePath, originalName: item.file.name });
            return {
              type: 'file',
              path: tempFilePath,
              isTemporary: true,
              options: item.options,
              id: item.id
            };
          }
          // For unsupported types
          else {
            throw new Error(`Unsupported item type in batch: ${item.type || 'unknown'}`);
          }
        })
      );

      conversionStatus.setStatus('converting');
      conversionStatus.setProgress(10);

      try {
        // Convert batch with mixed content types
        const result = await electronClient.convertBatch(
          processedItems,
          { 
            batchName: `Batch_${new Date().toISOString().replace(/:/g, '-')}`,
            ...options
          },
          (progress) => {
            // Scale progress from 10-90% to account for temp file operations
            conversionStatus.setProgress(10 + (progress * 0.8));
          },
          (itemId, success, error) => {
            files.updateFile(itemId, {
              status: success ? 'completed' : 'error',
              error: error?.message || null
            });
          }
        );
        
        conversionStatus.setProgress(90);
      
        // Update status and store result
        if (result && result.outputPath) {
          // Clean up temporary files
          conversionStatus.setStatus('cleaning_up');
          conversionStatus.setProgress(95);
          
          await Promise.all(
            tempFilePaths.map(async (tempFile) => {
              try {
                await cleanupTempFile(tempFile.path);
              } catch (cleanupError) {
                console.warn(`Failed to clean up temporary file ${tempFile.path}:`, cleanupError);
              }
            })
          );
          
          conversionStatus.setStatus('completed');
          conversionStatus.setProgress(100);
          
          // Store the result
          conversionResult.setNativeResult(result.outputPath, items);
          
          // Update all file statuses
          items.forEach(item => {
            files.updateFile(item.id, {
              status: 'completed'
            });
          });
        } else {
          throw new Error('Batch conversion failed: No output path returned');
        }
      } finally {
        // Ensure cleanup happens even if conversion fails
        if (tempFilePaths.length > 0) {
          console.log(`Cleaning up ${tempFilePaths.length} temporary files...`);
          await Promise.all(
            tempFilePaths.map(async (tempFile) => {
              try {
                await cleanupTempFile(tempFile.path);
              } catch (cleanupError) {
                console.warn(`Failed to clean up temporary file ${tempFile.path}:`, cleanupError);
              }
            })
          );
        }
      }
    }
  } catch (error) {
    console.error('Electron conversion error:', error);
    conversionStatus.setError(error.message);
    conversionStatus.setStatus('error');
    throw error;
  }
}

/**
 * Handles conversion in web environment by using Electron's IPC
 * @private
 */
async function handleWebConversion(items, apiKey) {
  try {
    // Use electronClient's file selection
    conversionStatus.setStatus('selecting_output');
    const outputResult = await electronClient.selectOutputDirectory();
    
    if (!outputResult.success) {
      conversionStatus.setStatus('cancelled');
      showFeedback('Conversion cancelled: No output directory selected', 'info');
      return;
    }
    
    // Use Electron's conversion functionality even in web mode
    await handleElectronConversion(items, apiKey, outputResult.path);
  } catch (error) {
    console.error('Web conversion error:', error);
    conversionStatus.setError(error.message);
    conversionStatus.setStatus('error');
    throw error;
  }
}

/**
 * Triggers the download of the converted files or opens the file in Electron
 */
export function triggerDownload() {
  const result = get(conversionResult);
  if (!result) {
    console.error('No conversion result available');
    return;
  }

  // Handle Electron environment
  if (isElectron && result.outputPath) {
    // The file is already saved to the file system
    // Opening is handled by the ResultDisplay component
    console.log('File already saved to:', result.outputPath);
    return;
  }

  // Handle web environment
  if (result.blob) {
    const { blob, contentType, items } = result;
    let filename;

    // For single markdown files, use original filename with .md extension
    if (contentType === 'text/markdown') {
      const originalName = items[0]?.name;
      filename = originalName ? 
        originalName.replace(/\.[^/.]+$/, '.md') : 
        `document_${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
    } else {
      // For zip files (multiple files or complex conversions)
      filename = `conversion_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    }
    
    FileSaver.saveAs(blob, filename);
  } else {
    console.error('No blob available for download');
  }
  
  // Only clear files store after successful download
  const clearResult = files.clearFiles();
  if (!clearResult.success) {
    console.warn('Failed to clear files store:', clearResult.message);
  }
}

/**
 * Cancels the ongoing conversion process
 */
export function cancelConversion() {
  if (isElectron) {
    electronClient.cancelRequests();
  } else {
    client.cancelRequests();
  }

  conversionStatus.setStatus('cancelled');
  
  files.update(items => 
    items.map(item => 
      item.status === 'converting' 
        ? { ...item, status: 'cancelled' } 
        : item
    )
  );
}

/**
 * Shows feedback message
 */
function showFeedback(message, type = 'info') {
  console.log(`${type.toUpperCase()}: ${message}`);
}
