/**
 * Transcription configuration
 * Defines available models and their capabilities
 */

module.exports = {
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
