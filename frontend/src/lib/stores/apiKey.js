// src/lib/stores/apiKey.js
import { writable, get } from 'svelte/store';

// Create an in-memory store for the API key (ephemeral)
const apiKey = writable('');

// Optional helper to retrieve the current value
const getApiKey = () => get(apiKey);

export { apiKey, getApiKey };
