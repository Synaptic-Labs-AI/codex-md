import { getApiKey } from '$lib/stores/apiKey.js';

export const addApiKeyToHeaders = (headers = {}) => {
    const apiKey = getApiKey();
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
};

export const makeApiRequest = async (url, options = {}) => {
    const headers = addApiKeyToHeaders(options.headers || {});
    const response = await fetch(url, {
        ...options,
        headers
    });
    if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
    }
    return response;
};
