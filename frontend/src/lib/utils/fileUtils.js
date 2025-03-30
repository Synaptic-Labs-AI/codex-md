// src/lib/utils/fileUtils.js

// File size limits
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB in bytes
export const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB in bytes

const FILE_CATEGORIES = {
    documents: ['pdf', 'docx', 'pptx'],
    audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma'],
    video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
    data: ['csv', 'xlsx'],
    web: ['url', 'parenturl'] // Removed youtube
};

// Audio and video formats that require API key
export const API_REQUIRED_TYPES = [
  // Audio formats
  'mp3', 'wav', 'ogg', 'm4a', 'mpga',
  // Video formats 
  'mp4', 'webm', 'avi', 'mov', 'mpeg'
];

/**
 * Checks if a file/filetype requires an OpenAI API key for processing
 * @param {File|Object|string} input - The file object, file data, or filetype to check
 * @returns {boolean} - Whether an API key is required
 */
export function requiresApiKey(file) {
  if (!file?.name) return false;
  const extension = file.name.split('.').pop().toLowerCase();
  return API_REQUIRED_TYPES.includes(extension);
}

/**
 * Gets the type of a file based on its extension or type
 * @param {File|String|Object} file - The file object, filename, or file data to check
 * @returns {string} - The file type category
 */
export function getFileType(file) {
    if (!file) return 'unknown';

    // Handle web content types
    if (typeof file === 'object' && file.type) {
        if (['url', 'parenturl'].includes(file.type)) {
            return 'web';
        }
    }

    const extension = (typeof file === 'string' ? file : file.name || '')
        .toLowerCase()
        .split('.')
        .pop();

    // Direct mapping for audio files
    if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma'].includes(extension)) {
        return 'audio';
    }

    for (const [category, extensions] of Object.entries(FILE_CATEGORIES)) {
        if (extensions.includes(extension)) {
            return category;
        }
    }

    return 'unknown';
}

/**
 * Validates if a file has a supported extension
 * @param {File|String} file - The file object or filename to check
 * @returns {boolean} - Whether the file type is supported
 */
export function isValidFileType(file) {
  if (!file) return false;
  
  const extension = (typeof file === 'string' ? file : file.name || '')
    .toLowerCase()
    .split('.')
    .pop();
    
  return Object.values(FILE_CATEGORIES)
    .flat()
    .includes(extension);
}

/**
 * Gets the file size in a human-readable format
 * @param {number} bytes - The file size in bytes
 * @returns {string} - Formatted file size
 */
export function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
    return `${Math.round(size * 100) / 100} ${units[unitIndex]}`;
}

/**
 * Sanitizes a filename to ensure it only contains safe characters
 * @param {string} filename - The original filename to sanitize
 * @returns {string} - The sanitized filename
 */
export function sanitizeFilename(filename) {
    if (!filename) return 'unnamed-file';

    // Split the filename into name and extension
    const lastDotIndex = filename.lastIndexOf('.');
    const name = lastDotIndex === -1 ? filename : filename.slice(0, lastDotIndex);
    const ext = lastDotIndex === -1 ? '' : filename.slice(lastDotIndex);

    // Sanitize the name part:
    // 1. Replace non-alphanumeric characters with hyphens
    // 2. Convert to lowercase
    // 3. Remove consecutive hyphens
    // 4. Trim hyphens from start/end
    const sanitizedName = name
        .replace(/[^a-zA-Z0-9]/g, '-')  // Replace special chars with hyphens
        .toLowerCase()
        .replace(/-+/g, '-')    // Replace multiple hyphens with single hyphen
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

    // Combine sanitized name with original extension
    return sanitizedName + ext.toLowerCase();
}

/**
 * Validates if a file size is within allowed limits
 * @param {File} file - The file to check
 * @returns {Object} - Validation result with valid status and message
 */
export function validateFileSize(file) {
  if (!file || !file.size) return { valid: false, message: 'Invalid file' };
  
  const fileType = getFileType(file);
  const maxSize = fileType === 'video' ? MAX_VIDEO_SIZE : MAX_FILE_SIZE;
  const isValid = file.size <= maxSize;
  
  return {
    valid: isValid,
    maxSize,
    message: isValid ? '' : `File exceeds maximum size of ${formatFileSize(maxSize)}`
  };
}
