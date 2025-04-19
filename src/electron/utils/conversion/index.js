/**
 * Conversion Utilities
 * Centralizes conversion-related functionality for the electron process
 * 
 * This module provides utilities for file conversion operations, including
 * progress tracking, converter registration, and conversion helpers.
 * 
 * Used by:
 * - src/electron/services/ElectronConversionService.js
 * - src/electron/converters/UnifiedConverterFactory.js
 */

const { ProgressTracker } = require('./progress');
const ConversionStatus = require('./ConversionStatus');

// Registry to store converter factories
const converterFactories = new Map();

/**
 * Register a converter factory for a specific type
 * @param {string} name - Name of the converter factory
 * @param {Object} factory - Converter factory instance
 */
function registerConverterFactory(name, factory) {
    converterFactories.set(name, factory);
}

/**
 * Register a converter implementation
 * @param {string} type - File type to handle
 * @param {Object} converter - Converter implementation
 */
function registerConverter(type, converter) {
    const factory = converterFactories.get('converterRegistry');
    if (factory && typeof factory.registerConverter === 'function') {
        factory.registerConverter(type, converter);
    } else {
        console.warn(`No converter registry available to register converter for ${type}`);
    }
}

/**
 * Convert content to markdown using the appropriate converter
 * @param {string} type - File type
 * @param {Buffer|string} content - Content to convert
 * @param {Object} options - Conversion options
 * @returns {Promise<Object>} Conversion result
 */
async function convertToMarkdown(type, content, options = {}) {
    const factory = converterFactories.get('converterRegistry');
    if (!factory) {
        throw new Error('No converter registry available');
    }

    return await factory.convertToMarkdown(type, content, options);
}

module.exports = {
    ProgressTracker,
    ConversionStatus,
    registerConverterFactory,
    registerConverter,
    convertToMarkdown
};
