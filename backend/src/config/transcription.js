/**
 * Transcription Configuration (Source of Truth)
 * 
 * This module provides the transcription configuration for the entire application.
 * It uses ES Module format for compatibility with the backend package.
 * 
 * This is the single source of truth for all transcription-related settings.
 */

const transcriptionConfig = {
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
};

// Export as default for ES Module compatibility
export default transcriptionConfig;

// Named exports for direct access
export const MODELS = transcriptionConfig.MODELS;
export const DEFAULT_MODEL = transcriptionConfig.DEFAULT_MODEL;
export const RESPONSE_FORMATS = transcriptionConfig.RESPONSE_FORMATS;
