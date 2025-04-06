/**
 * File type detection and categorization utilities (ES Module version)
 */

export const FILE_CATEGORIES = {
    documents: ['pdf', 'docx', 'pptx'],
    audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma'],
    video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
    data: ['csv', 'xlsx'],
    web: ['url', 'parenturl']
};

export const API_REQUIRED_TYPES = [
    // Audio formats
    'mp3', 'wav', 'ogg', 'm4a', 'mpga',
    // Video formats 
    'mp4', 'webm', 'avi', 'mov', 'mpeg'
];

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
 * Checks if a file/filetype requires an OpenAI API key for processing
 * @param {File|Object|string} input - The file object, file data, or filetype to check
 * @returns {boolean} - Whether an API key is required
 */
export function requiresApiKey(file) {
    if (!file?.name) return false;
    const extension = file.name.split('.').pop().toLowerCase();
    return API_REQUIRED_TYPES.includes(extension);
}

// Default export for compatibility
export default {
    FILE_CATEGORIES,
    API_REQUIRED_TYPES,
    getFileType,
    requiresApiKey
};
