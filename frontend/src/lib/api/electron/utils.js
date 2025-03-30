/**
 * Utility functions for the Electron client
 * 
 * This module contains utility functions used across the Electron client,
 * including ID generation, URL normalization, and type checking.
 * 
 * Related files:
 * - client.js: Core client functionality
 * - converters/*.js: Converter implementations
 */

/**
 * Generates a unique identifier
 * @returns {string} A UUID v4 or timestamp-based fallback
 */
export function generateId() {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Normalizes a URL for consistent handling
 * @param {string} url The URL to normalize
 * @returns {string} The normalized URL
 */
export function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    const normalizedPath = urlObj.pathname.replace(/\/+$/, '').toLowerCase();
    urlObj.pathname = normalizedPath;
    return urlObj.href.toLowerCase();
  } catch (error) {
    console.error('URL normalization error:', error);
    return url.toLowerCase();
  }
}

/**
 * Maps file extensions to their appropriate types
 */
export const fileCategories = {
  documents: ['pdf', 'docx', 'pptx', 'html', 'htm'],
  audio: ['mp3', 'wav', 'm4a', 'flac', 'ogg'],
  video: ['mp4', 'webm', 'avi', 'mov', 'mkv'],
  data: ['csv', 'xlsx']
};

/**
 * Checks if a file type is supported
 * @param {string} extension The file extension to check
 * @returns {boolean} Whether the file type is supported
 */
export function isSupportedFileType(extension) {
  if (!extension) return false;
  
  const ext = extension.toLowerCase();
  return Object.values(fileCategories).some(category => category.includes(ext));
}

/**
 * Checks if a file extension is an audio type
 * @param {string} ext The file extension
 * @returns {boolean} Whether the extension is an audio type
 */
export function isAudioType(ext) {
  return ext && fileCategories.audio.includes(ext.toLowerCase());
}

/**
 * Checks if a file extension is a video type
 * @param {string} ext The file extension
 * @returns {boolean} Whether the extension is a video type
 */
export function isVideoType(ext) {
  return ext && fileCategories.video.includes(ext.toLowerCase());
}

/**
 * Gets the category for a specific file type
 * @param {string} fileType The file extension or type
 * @returns {string|null} The category name or null if not found
 */
export function getFileCategory(fileType) {
  if (!fileType) return null;
  
  const normalizedType = fileType.toLowerCase();
  
  for (const [category, types] of Object.entries(fileCategories)) {
    if (types.includes(normalizedType)) {
      return category;
    }
  }
  
  return null;
}

/**
 * Validates and normalizes an item for conversion
 * @param {Object} item The item to validate and normalize
 * @param {Array<string>} supportedTypes Array of supported types (defaults to all supported types if not provided)
 * @returns {Object} The normalized item
 * @throws {Error} If validation fails
 */
export function validateAndNormalizeItem(item, supportedTypes = ['url', 'parent', 'youtube', 'document', 'audio', 'video', 'data']) {
  if (!item?.type) {
    throw new Error('Invalid item: missing type');
  }

  const type = item.type.toLowerCase();
  
  // Get all specific file types from fileCategories
  const allFileTypes = Object.values(fileCategories).flat();
  
  // Check if the type is a specific file type (like 'pdf') or a category (like 'document')
  if (!supportedTypes.includes(type) && !allFileTypes.includes(type)) {
    // If it's neither a supported category nor a specific file type, reject it
    throw new Error(`Unsupported type: ${type}`);
  }

  // Special validation for parent URL
  if (type === 'parent' && !item.url) {
    throw new Error('Parent URL is required');
  }

  // Normalize URLs if present
  const normalizedUrl = item.url ? normalizeUrl(item.url) : null;
  const normalizedContent = item.content && typeof item.content === 'string' ? 
    normalizeUrl(item.content) : item.content;

  // File validation for audio/video/document types
  if (item.file instanceof File) {
    const fileType = item.file.name.split('.').pop().toLowerCase();
    
    // Validate file type
    if (!isSupportedFileType(fileType)) {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
  }

  // Return normalized item
  return {
    id: item.id || generateId(),
    type,
    name: item.name?.trim() || 'Untitled',
    url: normalizedUrl,
    content: normalizedContent,
    file: item.file,
    options: {
      includeImages: true,
      includeMeta: true,
      convertLinks: true,
      ...(type === 'parent' && {
        depth: item.options?.depth || 1,
        maxPages: item.options?.maxPages || 10
      }),
      ...item.options
    }
  };
}
