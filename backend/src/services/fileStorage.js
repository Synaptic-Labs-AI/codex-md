// services/fileStorage.js

import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory storage for converted files.
 * Key: fileId (string)
 * Value: { content: string, filename: string }
 */
const fileDatabase = new Map();

/**
 * Stores a converted file and returns its unique fileId.
 * @param {string} content - The converted content (Markdown string).
 * @param {string} filename - The sanitized filename.
 * @returns {string} The generated fileId.
 */
export function storeConvertedFile(content, filename) {
  const fileId = uuidv4();
  fileDatabase.set(fileId, { content, filename });
  console.log(`Stored converted file: ${filename} with ID: ${fileId}`);
  return fileId;
}

/**
 * Retrieves a converted file by its fileId.
 * @param {string} fileId - The unique identifier of the file.
 * @returns {Object|null} The file object or null if not found.
 */
export function getConvertedFile(fileId) {
  return fileDatabase.get(fileId) || null;
}

/**
 * Retrieves multiple converted files by their fileIds.
 * @param {Array<string>} fileIds - Array of fileIds.
 * @returns {Array<Object>} Array of file objects.
 */
export function getMultipleConvertedFiles(fileIds) {
  return fileIds.map(id => {
    const file = getConvertedFile(id);
    if (file) {
      return { fileId: id, ...file };
    }
    return null;
  }).filter(file => file !== null);
}
