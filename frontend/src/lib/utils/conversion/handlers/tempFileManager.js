/**
 * Temp File Manager
 * 
 * Handles all temporary file operations during the conversion process.
 * This includes saving files to temp storage, cleanup, and tracking file status.
 * 
 * Implements aggressive cleanup to ensure temporary files don't persist.
 * 
 * Related files:
 * - frontend/src/lib/api/electron/fileSystem.js
 * - src/electron/services/FileSystemService.js
 */

import fileSystemOperations from '@lib/api/electron/fileSystem.js';
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
     * Handles saving of large video files using chunked transfer
     * Uses a three-step process:
     * 1. Initialize transfer
     * 2. Send chunks
     * 3. Finalize transfer
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
        
        try {
            // Step 1: Initialize transfer
            const initResult = await window.electron.initLargeFileTransfer({
                tempFilePath,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                chunkSize: 8 * 1024 * 1024 // 8MB chunks
            });
            
            if (!initResult.success) {
                throw new Error(`Failed to initialize large file transfer: ${initResult.error}`);
            }
            
            const transferId = initResult.transferId;
            const chunkSize = 8 * 1024 * 1024; // 8MB chunks
            const totalChunks = Math.ceil(file.size / chunkSize);
            
            console.log(`📊 [TempFileManager] Transfer initialized with ID: ${transferId}, total chunks: ${totalChunks}`);
            
            // Step 2: Send chunks
            for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                const start = chunkIndex * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                const chunk = file.slice(start, end);
                
                // Read chunk as base64
                const chunkBase64 = await this.readFileAsBase64(chunk);
                
                // Send chunk
                const chunkResult = await window.electron.transferFileChunk({
                    transferId,
                    chunkIndex,
                    data: chunkBase64,
                    size: chunk.size
                });
                
                if (!chunkResult.success) {
                    throw new Error(`Failed to transfer chunk ${chunkIndex + 1}/${totalChunks}: ${chunkResult.error}`);
                }
                
                // Update progress
                const progress = ((chunkIndex + 1) / totalChunks) * 100;
                console.log(`📊 [TempFileManager] Transfer progress: ${Math.round(progress)}%`);
                onProgress?.(progress);
            }
            
            // Step 3: Finalize transfer
            const finalizeResult = await window.electron.finalizeLargeFileTransfer({
                transferId
            });
            
            if (!finalizeResult.success) {
                throw new Error(`Failed to finalize large file transfer: ${finalizeResult.error}`);
            }
            
            console.log(`✅ [TempFileManager] Transfer completed in ${finalizeResult.transferTime.toFixed(2)}s (${finalizeResult.transferSpeed}MB/s)`);
            
            return finalizeResult.finalPath;
        } catch (error) {
            console.error(`❌ [TempFileManager] Large file transfer failed:`, error);
            throw error;
        }
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
                console.warn(`⚠️ [TempFileManager] File still in use, scheduling cleanup for later: ${filePath}`);
                // Schedule cleanup for later
                setTimeout(() => {
                    this.cleanup(filePath, { ...options, force: true });
                }, TEMP_FILE_CONFIG.CLEANUP_DELAY * 2);
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
        
        // Add to cleanup queue for later retry
        this.scheduleForceCleanup(filePath);
    }
    
    /**
     * Schedule a forced cleanup for a file that couldn't be deleted
     */
    scheduleForceCleanup(filePath) {
        if (!filePath) return;
        
        console.log(`📅 [TempFileManager] Scheduling forced cleanup for: ${filePath}`);
        
        // Try again after a longer delay with force=true
        setTimeout(() => {
            this.cleanup(filePath, { force: true, retryCount: 5 });
        }, TEMP_FILE_CONFIG.CLEANUP_DELAY * 5);
    }
    
    /**
     * Clean up all unused temporary files
     */
    async cleanupAllUnusedFiles() {
        console.log(`🧹 [TempFileManager] Running cleanup for all unused temporary files`);
        
        const unusedFiles = [];
        const now = Date.now();
        
        // Find all files that are not in use
        for (const [filePath, fileInfo] of tempFileRegistry.entries()) {
            if (!fileInfo.inUse || (now - fileInfo.created > TEMP_FILE_CONFIG.MAX_AGE)) {
                unusedFiles.push(filePath);
            }
        }
        
        if (unusedFiles.length === 0) {
            console.log(`✅ [TempFileManager] No unused temporary files to clean up`);
            return;
        }
        
        console.log(`🧹 [TempFileManager] Cleaning up ${unusedFiles.length} unused temporary files`);
        
        // Clean up each file
        for (const filePath of unusedFiles) {
            await this.cleanup(filePath, { force: true });
        }
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

// Create singleton instance
const tempFileManager = new TempFileManager();

// Set up automatic cleanup interval
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
    tempFileManager.cleanupAllUnusedFiles();
}, CLEANUP_INTERVAL);

// Export singleton instance
export { tempFileManager };
