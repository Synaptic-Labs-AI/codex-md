// Environment variables with fallbacks
const ENV = {
    API_BASE_URL: import.meta.env.PROD ? 
        'https://backend-production-6e08.up.railway.app/api/v1' : 
        'http://localhost:3000/api/v1',
    // No size limits
    CORS_ORIGIN: import.meta.env.VITE_CORS_ORIGIN || '*'
};

// Use Railway's URL in production
export const API_BASE_URL = import.meta.env.RAILWAY_API_BASE_URL;

export const CONFIG = {
    TRANSCRIPTION: {
        MODELS: {
            'whisper-1': {
                name: 'Whisper',
                description: 'Original Whisper model with full feature support',
                features: ['timestamps', 'all_formats'],
                default: true
            },
            'gpt-4o-mini-transcribe': {
                name: 'GPT-4o Mini Transcribe',
                description: 'Faster transcription with good accuracy',
                features: ['limited_formats']
            },
            'gpt-4o-transcribe': {
                name: 'GPT-4o Transcribe',
                description: 'Highest quality transcription with superior accuracy',
                features: ['limited_formats']
            }
        },
        DEFAULT_MODEL: 'whisper-1',
        RESPONSE_FORMATS: {
            'whisper-1': ['json', 'text', 'srt', 'verbose_json', 'vtt'],
            'gpt-4o-mini-transcribe': ['json', 'text'],
            'gpt-4o-transcribe': ['json', 'text']
        }
    },
    
    API: {
        MAX_RETRIES: 3,
        RETRY_DELAY: 1000,
        BASE_URL: ENV.API_BASE_URL,
        HEADERS: {
            'Accept': 'application/json, application/zip, application/octet-stream'
            // Don't set Content-Type here - let it be handled per request
        },
        ENDPOINTS: {
            FILE: '/document/file',
            URL: '/web/url',
            PARENT_URL: '/web/parent-url',
            BATCH: '/batch',
            AUDIO: '/multimedia/audio',
            VIDEO: '/multimedia/video'
        },
        // No size limits
    },

    CORS: {
        ORIGIN: ENV.CORS_ORIGIN,
        METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        ALLOWED_HEADERS: ['Content-Type', 'Authorization', 'Accept']
    },

    FILES: {
        CATEGORIES: {
            documents: ['pdf', 'docx', 'pptx'],
            audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma'],
            video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
            data: ['csv', 'xlsx']
        },
            TYPES: {
                // Document types
                FILE: 'file',
                DOCUMENT: 'document',
                
                // Web types
                URL: 'url',
                PARENT_URL: 'parenturl',
                
                // Multimedia types
                AUDIO: 'audio',
                VIDEO: 'video',
                
                // Batch processing
                BATCH: 'batch'
            },
        API_REQUIRED: [
            'mp3', 'wav', 'm4a',
            'mp4', 'webm', 'avi'
        ],
        ICONS: {
            document: 'file-text',
            image: 'image',
            video: 'video',
            audio: 'music',
            pdf: 'file-text',
            text: 'file-text',
            html: 'code',
            docx: 'file-text'
        }
    },

    PROGRESS: {
        START: 0,
        VALIDATING: 10,
        PREPARING: 20,
        CONVERTING: 40,
        PROCESSING: 60,
        FINALIZING: 80,
        COMPLETE: 100
    },

    CONVERSION: {
        SUPPORTED_TYPES: ['file', 'url', 'parent', 'batch'],
        DEFAULT_OPTIONS: {
            includeImages: true,
            includeMeta: true,
            maxDepth: 1,
            convertLinks: true
        },
        BATCH_SIZE_LIMIT: 10,
        // No size limits
    },

    UI: {
        STATUSES: {
            READY: 'ready',
            CONVERTING: 'converting',
            COMPLETED: 'completed',
            ERROR: 'error'
        },
        COLORS: {
            PRIMARY: '#00a99d',
            SECONDARY: '#93278f',
            TERTIARY: '#fbf7f1',
            TEXT: '#333333',
            BACKGROUND: '#ffffff',
            ERROR: '#ff3860'
        },
        CSS: {
            ROUNDED_CORNERS: '12px',
            TRANSITION_SPEED: '0.3s',
            BOX_SHADOW: '0 4px 6px rgba(0, 0, 0, 0.1)'
        }
    },

    STATUS: {
        SUCCESS: 'success',
        ERROR: 'error',
        PENDING: 'pending',
        PROCESSING: 'processing',
        COMPLETED: 'completed',
        CANCELLED: 'cancelled'
    },

    ERROR_TYPES: {
        VALIDATION: 'VALIDATION_ERROR',
        NETWORK: 'NETWORK_ERROR',
        CONVERSION: 'CONVERSION_ERROR',
        TIMEOUT: 'TIMEOUT_ERROR',
        UNKNOWN: 'UNKNOWN_ERROR'
    },

    STORAGE: {
        API_KEY: 'obsdian_note_converter_api_key'
    }
};

// Add CORS configuration check
if (import.meta.env.DEV) {
    console.log('API Configuration:', {
        baseUrl: CONFIG.API.BASE_URL,
        corsOrigin: CONFIG.CORS.ORIGIN
    });
}

// Error messages
export const ERRORS = {
    UNSUPPORTED_FILE_TYPE: 'Unsupported file type',
    API_KEY_REQUIRED: 'API key is required',
    INVALID_API_KEY: 'Invalid API key format',
    INVALID_URL: 'Invalid URL format',
    NO_FILES_FOR_CONVERSION: 'At least one file is required for conversion'
};

// Export commonly used configurations
export const { ITEM_TYPES, FILE_CATEGORIES, API_REQUIRED_TYPES } = CONFIG.FILES;
export const { STATUSES, COLORS, CSS } = CONFIG.UI;

// Helper functions
export const requiresApiKey = (file) => {
    if (!file) return false;
    const ext = (typeof file === 'string' ? file : file.name)
        .split('.')
        .pop()
        .toLowerCase();
    return CONFIG.FILES.API_REQUIRED.includes(ext);
};

// Freeze configurations to prevent modifications
Object.freeze(CONFIG);
Object.freeze(ERRORS);

export default CONFIG;
