// services/openaiProxy.js

import OpenAI from 'openai';
import fs from 'fs';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { config } from '../config/default.js';
import NodeCache from 'node-cache';
import { AppError } from '../utils/errorHandler.js';

class OpenAIProxy {
  constructor() {
    this.openai = null;
    this.cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

    // Create and configure axios instance
    this.axiosInstance = axios.create({
      baseURL: 'https://api.openai.com/v1',
      timeout: 30000
    });

    // Apply axios-retry to the instance
    axiosRetry(this.axiosInstance, {
      retries: 3,
      retryDelay: (retryCount) => retryCount * 1000
    });
  }

  async initialize(apiKey) {
    if (!this.openai) {
      this.openai = new OpenAI({
        apiKey,
        baseURL: config.api.openai.baseUrl,
        timeout: config.api.openai.timeout,
      });

      // Remove axiosRetry(this.openai.httpClient, {...}) since httpClient is undefined
    }
  }

  async makeRequest(apiKey, endpoint, data) {
    await this.initialize(apiKey);

    const cacheKey = `${endpoint}:${JSON.stringify(data)}`;
    const cachedResponse = this.cache.get(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      console.log('Making OpenAI request:', {
        endpoint,
        hasData: !!data,
        isFormData: data instanceof FormData
      });

      const headers = {
        Authorization: `Bearer ${apiKey}`,
      };

      // Handle FormData properly
      if (data instanceof FormData) {
        // Let the FormData set its own Content-Type with boundary
        Object.assign(headers, data.getHeaders?.() || {});
      }

      const response = await this.axiosInstance.post(`/${endpoint}`, data, { headers });
      
      if (!response?.data) {
        throw new Error('Empty response from OpenAI API');
      }

      this.cache.set(cacheKey, response.data);
      return response.data;
    } catch (error) {
      console.error('OpenAI API Error:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      throw this.handleApiError(error);
    }
  }

  handleApiError(error) {
    if (error.response) {
      const { status, data } = error.response;
      switch (status) {
        case 401:
          return new AppError('Invalid API key', 401);
        case 429:
          return new AppError('Rate limit exceeded', 429);
        case 500:
          return new AppError('OpenAI server error', 500);
        default:
          return new AppError(`Whisper API error: ${data.error.message}`, status);
      }
    }
    return new AppError('Unknown OpenAI API error', 500);
  }
}

export const openaiProxy = new OpenAIProxy();
