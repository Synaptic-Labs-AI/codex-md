/**
 * Temp File Manager
 * 
 * Handles all temporary file operations during the conversion process.
 * This includes saving files to temp storage, cleanup, and tracking file status.
 * 
 * Related files:
 * - frontend/src/lib/api/electron/fileSystem.js
 * - src/electron/services/FileSystemService.js
 */

import { fileSystemOperations } from '$lib/api/electron/fileSystem.js';
import { BINARY_FILE_EXTENSIONS, TEMP_FILE_CONFIG } from '../constants';

/**
 * Registry to track temporary files and their status
 * @type {Map<string, {path: string, created: number, inUse: boolean, metadata: Object}>}
 */
const tempFileRegistry = new Map();

class TempFileManager {
    /**
     * Saves a File object to a temporary file
     */
    async saveTempFile(file, onProgress) {
        if (!file) {
            throw new Error('No file provided to save');
        }
        
        console.log(`📊 [TempFileManager] Starting file transfer for: ${file.name}`);
        console.log(`📊 [TempFileManager] File size: ${file.size} bytes, Type: ${file.type}`);
        
        const fileExt = file.name.split('.').pop().toLowerCase();
        const tempFileName = `temp_${Date.now()}_${file.name}`;
        const tempDir = 'temp';
        
        // Create temp directory if needed
        await fileSystemOperations.createDirectory(tempDir);
        const tempFilePath = `${tempDir}/${tempFileName}`;
        
        const isBinaryFile = BINARY_FILE_EXTENSIONS.includes(fileExt.toLowerCase());
        const isLargeFile = file.size > TEMP_FILE_CONFIG.SIZE_THRESHOLD;
        const isVideoFile = ['mp4', 'webm', 'avi'].includes(fileExt.toLowerCase());
        
        try {
            if (isVideoFile && isLargeFile) {
                await this.handleLargeVideoFile(file, tempFilePath, onProgress);
            } else if (isBinaryFile) {
                await this.handleBinaryFile(file, tempFilePath);
            } else {
                await this.handleTextFile(file, tempFilePath);
            }
            
            this.registerFile(tempFilePath, {
                originalName: file.name,
                originalSize: file.size,
                originalType: file.type,
                isBinaryFile,
                isVideoFile,
                isLargeFile
            });
            
            return tempFilePath;
        } catch (error) {
            console.error(`❌ [TempFileManager] Error saving temp file:`, error);
            throw new Error(`Failed to save temporary file: ${error.message}`);
        }
    }
    
    /**
     * Handles saving of large video files
     */
    async handleLargeVideoFile(file, tempFilePath, onProgress) {
        console.log(`📊 [TempFileManager] Handling large video file (${Math.round(file.size / (1024 * 1024))}MB)`);
        
        const metadataObj = {
            originalName: file.name,
            originalSize: file.size,
            originalType: file.type,
            timestamp: Date.now(),
            needsStreamProcessing: true
        };
        
        const metadataStr = `LARGE_FILE:${JSON.stringify(metadataObj)}`;
        const writeResult = await fileSystemOperations.writeFile(tempFilePath, metadataStr);
        
        if (!writeResult.success) {
            throw new Error(`Failed to write temporary file metadata: ${writeResult.error}`);
        }
        
        // Use specialized video file transfer
        const transferResult = await window.electronAPI.transferLargeFile(
            file, 
            tempFilePath,
            (progress) => {
                console.log(`📊 [TempFileManager] Transfer progress: ${Math.round(progress)}%`);
                onProgress?.(progress);
            }
        );
        
        if (!transferResult.success) {
            throw new Error(`Failed to transfer large file: ${transferResult.error}`);
        }
        
        return transferResult.finalPath;
    }
    
    /**
     * Handles saving of binary files
     */
    async handleBinaryFile(file, tempFilePath) {
        console.log(`📊 [TempFileManager] Handling binary file`);
        
        const base64Data = await this.readFileAsBase64(file);
        if (!base64Data) {
            throw new Error(`Failed to convert file to base64: ${file.name}`);
        }
        
        // Add prefix for main process handling
        const prefixedData = `BASE64:${base64Data}`;
        const writeResult = await fileSystemOperations.writeFile(tempFilePath, prefixedData);
        
        if (!writeResult.success) {
            throw new Error(`Failed to write temporary binary file: ${writeResult.error}`);
        }
        
        await this.verifyFileWrite(tempFilePath, file.size);
    }
    
    /**
     * Handles saving of text files
     */
    async handleTextFile(file, tempFilePath) {
        console.log(`📊 [TempFileManager] Handling text file`);
        
        const textData = await file.text();
        const writeResult = await fileSystemOperations.writeFile(tempFilePath, textData);
        
        if (!writeResult.success) {
            throw new Error(`Failed to write temporary text file: ${writeResult.error}`);
        }
    }
    
    /**
     * Reads a file as base64
     */
    readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = error => reject(error);
        });
    }
    
    /**
     * Verifies file was written correctly
     */
    async verifyFileWrite(filePath, expectedSize) {
        const stats = await fileSystemOperations.getStats(filePath);
        if (stats.success) {
            if (stats.stats.size < expectedSize * 0.9) {
                console.warn(`⚠️ [TempFileManager] File size mismatch! Expected: ${expectedSize}, Written: ${stats.stats.size}`);
            }
        }
    }
    
    /**
     * Registers a temporary file for tracking
     */
    registerFile(filePath, metadata = {}) {
        if (!filePath) return;
        
        tempFileRegistry.set(filePath, {
            path: filePath,
            created: Date.now(),
            inUse: true,
            metadata
        });
        
        console.log(`📝 [TempFileManager] Registered temporary file: ${filePath}`);
    }
    
    /**
     * Marks a temporary file as ready for cleanup
     */
    markForCleanup(filePath) {
        if (!filePath || !tempFileRegistry.has(filePath)) return;
        
        const fileInfo = tempFileRegistry.get(filePath);
        fileInfo.inUse = false;
        fileInfo.readyForCleanup = Date.now();
        
        console.log(`🏁 [TempFileManager] Marked file as ready for cleanup: ${filePath}`);
    }
    
    /**
     * Cleans up a temporary file
     */
    async cleanup(filePath, options = {}) {
        const {
            force = false,
            retryCount = TEMP_FILE_CONFIG.RETRY_COUNT,
            retryDelay = TEMP_FILE_CONFIG.RETRY_DELAY
        } = options;
        
        if (!filePath) {
            console.warn(`⚠️ [TempFileManager] Invalid file path for cleanup`);
            return;
        }
        
        if (tempFileRegistry.has(filePath)) {
            const fileInfo = tempFileRegistry.get(filePath);
            if (fileInfo.inUse && !force) {
                console.warn(`⚠️ [TempFileManager] File still in use, skipping cleanup: ${filePath}`);
                return;
            }
        }
        
        // Attempt delete with retries
        let attempts = 0;
        while (attempts <= retryCount) {
            try {
                const deleteResult = await fileSystemOperations.deleteItem(filePath, false);
                if (deleteResult.success) {
                    tempFileRegistry.delete(filePath);
                    console.log(`✅ [TempFileManager] Cleaned up temporary file: ${filePath}`);
                    return;
                }
                
                if (attempts < retryCount) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay * (attempts + 1)));
                }
            } catch (error) {
                console.warn(`❌ [TempFileManager] Cleanup attempt ${attempts + 1} failed:`, error);
                
                if (attempts < retryCount) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay * (attempts + 1)));
                }
            }
            attempts++;
        }
        
        console.warn(`⚠️ [TempFileManager] Could not clean up file after ${retryCount} attempts: ${filePath}`);
    }
    
    /**
     * Gets information about a temporary file
     */
    getFileInfo(filePath) {
        return tempFileRegistry.get(filePath);
    }
    
    /**
     * Checks if a file is still in use
     */
    isFileInUse(filePath) {
        const fileInfo = tempFileRegistry.get(filePath);
        return fileInfo?.inUse || false;
    }
}

// Export singleton instance
export const tempFileManager = new TempFileManager();
