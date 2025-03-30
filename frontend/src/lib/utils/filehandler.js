// fileHandler.js - Comprehensive file handling module
// Handles file type detection, validation, and management

import { files } from '$lib/stores/files.js';
import { Document, VideoCamera, MusicalNote, Photo, Link } from 'svelte-hero-icons';

/**
 * Constants for file handling
 */
const VALID_EXTENSIONS = [
    'txt', 'pdf', 'docx', 'pptx',
    'csv', 'xlsx',
    'mp3', 'wav', 'm4a',
    'mp4', 'webm', 'avi'
];

const MIME_TYPE_MAPPING = {
    // Document formats
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/pdf': 'pdf',
    
    // Spreadsheet and presentation formats
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    
    // Audio formats
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    
    // Video formats
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/x-msvideo': 'avi'
};

/**
 * Generates a unique ID for file tracking
 * @returns {string} A unique identifier
 */
export function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Maps MIME types to file extensions
 * @param {string} mimeType - The MIME type to convert
 * @param {string} fileName - Original file name as fallback
 * @returns {string} The correct file extension
 * @throws {Error} If file type is not supported
 */
function getMimeTypeExtension(mimeType, fileName) {
    console.log('Processing MIME type:', mimeType);
    console.log('Original filename:', fileName);

    // Try getting extension from MIME type mapping
    const mimeExtension = MIME_TYPE_MAPPING[mimeType];
    if (mimeExtension) {
        console.log('Found MIME type mapping:', mimeExtension);
        return mimeExtension;
    }

    // Fallback to file extension from name
    const fileExtension = fileName.split('.').pop().toLowerCase();
    console.log('Extracted extension from filename:', fileExtension);

    // Validate the extension
    if (VALID_EXTENSIONS.includes(fileExtension)) {
        return fileExtension;
    }

    throw new Error(`Unsupported file type: ${fileExtension}`);
}

/**
 * Determines the file type from a File object
 * @param {File} file - The file object to analyze
 * @returns {string} The normalized file extension
 * @throws {Error} If file type cannot be determined or is not supported
 */
export function getFileType(file) {
    if (!file || !file.name) {
        throw new Error('Invalid file object');
    }

    console.log('Determining file type for:', {
        name: file.name,
        type: file.type,
        size: file.size
    });

    try {
        const extension = getMimeTypeExtension(file.type, file.name);
        console.log('Determined file extension:', extension);
        return extension;
    } catch (error) {
        console.error('Error in getFileType:', error);
        throw error;
    }
}

/**
 * Adds a file to the store with proper metadata
 * @param {File} file - The file object to add
 * @returns {Object} The created file object with metadata
 */
export function addFile(file) {
    try {
        const fileType = getFileType(file);
        
        const newFile = {
            id: generateUniqueId(),
            file: file,
            name: file.name,
            type: 'file',  // Always use 'file' type for converter compatibility
            fileType: fileType, // Original file type 
            format: fileType,
            size: file.size,
            lastModified: file.lastModified,
            status: 'ready'
        };

        // Add debug logging
        console.log('Creating new file object:', {
            ...newFile,
            file: '[File object]' // Avoid logging full file object
        });

        files.addFile(newFile);
        return newFile;
    } catch (error) {
        console.error('Error adding file:', error);
        throw error;
    }
}

/**
 * Removes a file from the store
 * @param {string} id - The file ID to remove
 */
export function removeFile(id) {
    console.log('Removing file:', id);
    files.removeFile(id);
}

/**
 * Updates a file's status in the store
 * @param {string} id - The file ID to update
 * @param {string} status - The new status
 */
export function updateFileStatus(id, status) {
    console.log('Updating file status:', { id, status });
    files.updateFile(id, { status });
}

/**
 * Clears all files from the store
 */
export function clearFiles() {
    console.log('Clearing all files');
    files.clearFiles();
}

/**
 * Maps file types to their corresponding icons
 */
const TYPE_TO_ICON = {
    'pdf': Document,
    'docx': Document,
    'csv': Document,
    'xlsx': Document,
    'pptx': Document,
    'mp3': MusicalNote,
    'wav': MusicalNote,
    'ogg': MusicalNote,
    'mp4': VideoCamera,
    'mov': VideoCamera,
    'avi': VideoCamera,
    'webm': VideoCamera,
    'url': Link
};

/**
 * Gets the icon component for a file type
 * @param {string} type - The file type
 * @returns {Component} The icon component
 */
export function getFileIconComponent(type) {
    return TYPE_TO_ICON[type] || Document;
}

/**
 * Reads a file as text
 * @param {File} file - The file to read
 * @returns {Promise<string>} The file content
 */
export function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(event.target.result);
        reader.onerror = error => reject(error);
        reader.readAsText(file);
    });
}

/**
 * Reads a file as data URL
 * @param {File} file - The file to read
 * @returns {Promise<string>} The file content as data URL
 */
export function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(event.target.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

/**
 * Validates a file object
 * @param {Object} fileObj - The file object to validate
 * @returns {Object} The validated file object
 * @throws {Error} If the file object is invalid
 */
export function validateFileObject(fileObj) {
    if (!fileObj || typeof fileObj !== 'object') {
        throw new Error('Invalid file object');
    }
    
    // Ensure type is always 'file'
    if (fileObj.type !== 'file') {
        console.warn(`Correcting invalid type '${fileObj.type}' to 'file'`);
        fileObj.type = 'file';
    }
    
    return fileObj;
}