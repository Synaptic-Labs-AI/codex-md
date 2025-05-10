/**
 * OpenAIProxyService.js
 * This is a placeholder service that replaces the original OpenAI integration.
 * The application now uses Deepgram for transcription instead of OpenAI.
 * 
 * This file exists to maintain backward compatibility with code that
 * expects OpenAIProxyService to be available.
 * 
 * For the full implementation, see OpenAIProxyService.deprecated.js
 */

const BaseService = require('../BaseService');

class OpenAIProxyServicePlaceholder extends BaseService {
    constructor() {
        super();
        this.openai = null;
    }

    setupIpcHandlers() {
        this.registerHandler('openai:configure', this.handleConfigure.bind(this));
        this.registerHandler('openai:transcribe', this.handleTranscribe.bind(this));
        this.registerHandler('openai:complete', this.handleComplete.bind(this));
        this.registerHandler('openai:check-key', this.handleCheckKey.bind(this));
    }

    async handleConfigure(event, { apiKey }) {
        console.log('[OpenAIProxyService] OpenAI functionality has been replaced with Deepgram for transcription');
        return { 
            success: false,
            error: 'OpenAI functionality has been replaced with Deepgram for transcription. Please update your settings to use Deepgram API key instead.'
        };
    }

    async handleTranscribe(event, { audioPath, language = 'en', prompt = '', model = 'whisper' }) {
        console.log('[OpenAIProxyService] Transcription has been moved to Deepgram');
        throw new Error('Transcription has been moved to Deepgram. Please use the DeepgramService instead.');
    }

    async handleComplete(event, { prompt, model = 'gpt-3.5-turbo', options = {} }) {
        console.log('[OpenAIProxyService] OpenAI completion is no longer supported');
        throw new Error('OpenAI functionality is no longer supported.');
    }

    async handleCheckKey(event) {
        console.log('[OpenAIProxyService] OpenAI functionality has been replaced with Deepgram');
        return { 
            valid: false, 
            error: 'OpenAI functionality has been replaced with Deepgram for transcription. Please update your settings to use Deepgram API key instead.'
        };
    }
}

// Create a single instance of the service
const instance = new OpenAIProxyServicePlaceholder();

// Export an object containing the instance
module.exports = { instance };