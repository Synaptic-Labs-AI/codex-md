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
const OpenAI = require('openai');
const NodeCache = require('node-cache');
const axios = require('axios');
const fs = require('fs-extra');
const axiosRetry = require('./OpenAIProxyServiceFix');

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
            // Instantiate directly with v4 syntax
            const tempOpenAI = new OpenAI({ apiKey });

            // Verify the API key with a v4 style request
            await tempOpenAI.models.list();

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
    async handleTranscribe(event, { audioPath, language = 'en', prompt = '', model = 'whisper' }) {
        this.ensureConfigured();

        try {
            const cacheKey = `transcribe:${audioPath}:${model}`;
            const cached = this.cache.get(cacheKey);
            if (cached) {
                return cached;
            }

            // Map our simplified model names to actual API model names
            const modelMapping = {
                'whisper': 'whisper-1',
                'gpt-4o-mini-transcribe': 'gpt-4o-mini-transcribe', 
                'gpt-4o-transcribe': 'gpt-4o-transcribe'
            };
            
            const apiModel = modelMapping[model] || 'whisper-1';
            console.log(`[OpenAIProxyService] Using transcription model: ${apiModel} (from ${model})`);

            const response = await this.openai.audio.transcriptions.create({
                file: fs.createReadStream(audioPath),
                model: apiModel,
                prompt: prompt,
                response_format: 'text',
                language: language
            });

            const result = {
                text: response.text || response, // Handle both object and direct text response
                language: language,
                model: model
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

            const response = await this.openai.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                ...options
            });

            const result = {
                text: response.choices[0].message.content,
                usage: response.usage
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

            await this.openai.models.list();
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

// Create a single instance of the service
const instance = new OpenAIProxyService();

// Export an object containing the instance
module.exports = { instance };
