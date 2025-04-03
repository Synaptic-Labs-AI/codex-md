/**
 * Transcription Configuration (Source of Truth)
 * 
 * This module provides the transcription configuration for the entire application.
 * It uses ES Module syntax and serves as the single source of truth for all
 * transcription-related settings and capabilities.
 * 
 * Usage:
 * ES Modules:
 *   import { MODELS, DEFAULT_MODEL, RESPONSE_FORMATS } from './transcription.mjs';
 * 
 * CommonJS (via dynamic import):
 *   const config = await import('./transcription.mjs');
 *   const { MODELS, DEFAULT_MODEL } = config;
 */

export const MODELS = {
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
};

export const DEFAULT_MODEL = 'whisper-1';

export const RESPONSE_FORMATS = {
    'whisper-1': ['json', 'text', 'srt', 'verbose_json', 'vtt'],
    'gpt-4o-mini-transcribe': ['json', 'text'],
    'gpt-4o-transcribe': ['json', 'text']
};

// Also export as default for flexibility
export default {
    MODELS,
    DEFAULT_MODEL,
    RESPONSE_FORMATS
};
