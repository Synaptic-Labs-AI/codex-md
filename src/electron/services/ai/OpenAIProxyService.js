/**
 * OpenAIProxyService.js
 * Manages OpenAI API interactions in the Electron main process.
 * 
 * This service handles:
 * - API key management
 * - Rate limiting and quotas
 * - OpenAI API requests and responses
 * - Response caching for efficiency
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - ApiKeyService.js: For API key management
 * - TranscriptionService.js: Uses this service for audio transcription
 */

const BaseService = require('../BaseService');
const { Configuration, OpenAIApi } = require('openai');
const NodeCache = require('node-cache');
const axios = require('axios');
const axiosRetry = require('axios-retry');

class OpenAIProxyService extends BaseService {
    constructor() {
        super();
        this.openai = null;
        this.cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache
        this.setupAxiosRetry();
    }

    /**
     * Set up IPC handlers for OpenAI operations
     */
    setupIpcHandlers() {
        this.registerHandler('openai:configure', this.handleConfigure.bind(this));
        this.registerHandler('openai:transcribe', this.handleTranscribe.bind(this));
        this.registerHandler('openai:complete', this.handleComplete.bind(this));
        this.registerHandler('openai:check-key', this.handleCheckKey.bind(this));
    }

    /**
     * Configure axios retry behavior
     */
    setupAxiosRetry() {
        axiosRetry(axios, {
            retries: 3,
            retryDelay: axiosRetry.exponentialDelay,
            retryCondition: (error) => {
                return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
                    (error.response && error.response.status === 429); // Rate limit
            }
        });
    }

    /**
     * Handle API configuration request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Configuration details
     */
    async handleConfigure(event, { apiKey }) {
        try {
            const configuration = new Configuration({ apiKey });
            const tempOpenAI = new OpenAIApi(configuration);

            // Verify the API key with a simple request
            await tempOpenAI.listModels();

            // If successful, update the instance
            this.openai = tempOpenAI;
            return { success: true };
        } catch (error) {
            console.error('[OpenAIProxyService] Configuration failed:', error.message);
            throw new Error('Invalid API key or connection failed');
        }
    }

    /**
     * Handle transcription request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Transcription details
     */
    async handleTranscribe(event, { audioPath, language = 'en', prompt = '' }) {
        this.ensureConfigured();

        try {
            const cacheKey = `transcribe:${audioPath}`;
            const cached = this.cache.get(cacheKey);
            if (cached) {
                return cached;
            }

            const response = await this.openai.createTranscription(
                fs.createReadStream(audioPath),
                'whisper-1',
                prompt,
                'text',
                0,
                language
            );

            const result = {
                text: response.data,
                language: language
            };

            this.cache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.error('[OpenAIProxyService] Transcription failed:', error);
            throw this.formatError(error);
        }
    }

    /**
     * Handle completion request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Completion details
     */
    async handleComplete(event, { prompt, model = 'gpt-3.5-turbo', options = {} }) {
        this.ensureConfigured();

        try {
            const cacheKey = `complete:${model}:${prompt}`;
            const cached = this.cache.get(cacheKey);
            if (cached) {
                return cached;
            }

            const response = await this.openai.createChatCompletion({
                model,
                messages: [{ role: 'user', content: prompt }],
                ...options
            });

            const result = {
                text: response.data.choices[0].message.content,
                usage: response.data.usage
            };

            this.cache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.error('[OpenAIProxyService] Completion failed:', error);
            throw this.formatError(error);
        }
    }

    /**
     * Handle API key check request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     */
    async handleCheckKey(event) {
        try {
            if (!this.openai) {
                return { valid: false, error: 'API not configured' };
            }

            await this.openai.listModels();
            return { valid: true };
        } catch (error) {
            console.error('[OpenAIProxyService] API key check failed:', error);
            return { valid: false, error: this.formatError(error).message };
        }
    }

    /**
     * Ensure the API is configured
     * @throws {Error} If API is not configured
     */
    ensureConfigured() {
        if (!this.openai) {
            throw new Error('OpenAI API not configured. Please set an API key.');
        }
    }

    /**
     * Format error for client consumption
     * @param {Error} error - Original error
     * @returns {Error} Formatted error
     */
    formatError(error) {
        if (error.response) {
            const status = error.response.status;
            const message = error.response.data.error?.message || error.message;

            if (status === 429) {
                return new Error('Rate limit exceeded. Please try again later.');
            }

            return new Error(`OpenAI API Error (${status}): ${message}`);
        }

        return error;
    }

    /**
     * Clear the response cache
     */
    clearCache() {
        this.cache.flushAll();
    }
}

module.exports = OpenAIProxyService;
