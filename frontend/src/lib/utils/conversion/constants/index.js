/**
 * Shared constants for conversion functionality
 */

export const CONVERSION_STATUSES = {
    IDLE: 'idle',
    INITIALIZING: 'initializing',
    PREPARING: 'preparing',
    SELECTING_OUTPUT: 'selecting_output',
    CONVERTING: 'converting',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    ERROR: 'error',
    CANCELLED: 'cancelled'
};

export const FILE_TYPES = {
    DOCUMENT: 'document',
    URL: 'url',
    PARENT: 'parent',
    YOUTUBE: 'youtube'
};

export const TEMP_FILE_CONFIG = {
    RETRY_COUNT: 3,
    RETRY_DELAY: 500,
    CLEANUP_DELAY: 1000,
    SIZE_THRESHOLD: 100 * 1024 * 1024, // 100MB
    MAX_AGE: 30 * 60 * 1000 // 30 minutes - max time to keep temp files
};

export const BINARY_FILE_EXTENSIONS = [
    'pdf', 'pptx', 'docx', 'xlsx',
    'jpg', 'jpeg', 'png', 'gif',
    'mp3', 'mp4', 'wav', 'webm', 'avi'
];

export const MIME_TYPES = {
    MARKDOWN: 'text/markdown',
    ZIP: 'application/zip'
};
