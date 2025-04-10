// fileHandler.js - Frontend file store management and UI utilities
// Handles file store operations and icon mapping for the UI

import { files } from '@lib/stores/files.js';
import { Document, VideoCamera, MusicalNote, Photo, Link } from 'svelte-hero-icons';
import { getFileHandlingInfo, validateFile } from '@lib/utils/files';

/**
 * Generates a unique ID for file tracking
 * @returns {string} A unique identifier
 */
export function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Adds a file to the store with proper metadata
 * @param {File} file - The file object to add
 * @returns {Object} The created file object with metadata
 */
export function addFile(file) {
    try {
        const fileInfo = getFileHandlingInfo(file);
        const validation = validateFile(file);
        
        if (!validation.valid) {
            throw new Error(validation.errors.join(', '));
        }
        
        const newFile = {
            id: generateUniqueId(),
            file: file,
            name: file.name,
            type: 'file',  // Always use 'file' type for converter compatibility
            fileType: fileInfo.fileType,
            format: fileInfo.fileType,
            size: file.size,
            lastModified: file.lastModified,
            status: 'ready'
        };

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
 * Store operations
 */
export function removeFile(id) {
    console.log('Removing file:', id);
    files.removeFile(id);
}

export function updateFileStatus(id, status) {
    console.log('Updating file status:', { id, status });
    files.updateFile(id, { status });
}

export function clearFiles() {
    console.log('Clearing all files');
    files.clearFiles();
}

/**
 * UI utilities
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

export function getFileIconComponent(type) {
    return TYPE_TO_ICON[type] || Document;
}
