/**
 * ConverterRegistry.js
 * 
 * Central registry for all file type converters in the Electron main process.
 * Provides a unified interface for accessing converters based on file type.
 * 
 * This file was created as part of the consolidation process to centralize
 * all converter functionality in the Electron main process.
 * 
 * Related files:
 * - src/electron/converters/UnifiedConverterFactory.js: Uses this registry for conversions
 * - src/electron/services/ElectronConversionService.js: References this registry
 * - src/electron/services/conversion/data/*.js: Data converters
 * - src/electron/services/conversion/document/*.js: Document converters
 * - src/electron/services/conversion/multimedia/*.js: Multimedia converters
 * - src/electron/services/conversion/web/*.js: Web converters
 */

const fs = require('fs-extra');
const path = require('path');
const { ipcMain } = require('electron');

/**
 * Registry for all file type converters
 */
function ConverterRegistry() {
    this.converters = {};
    this.setupConverters();
}

/**
 * Register a converter for a specific file type
 * @param {string} type - File type (extension without dot)
 * @param {Object} converter - Converter implementation
 */
ConverterRegistry.prototype.register = function(type, converter) {
    this.converters[type] = converter;
    console.log(`Registered converter for ${type}`);
};

/**
 * Get converter by file extension
 * @param {string} extension - File extension (with or without dot)
 * @returns {Object|null} Converter or null if not found
 */
ConverterRegistry.prototype.getConverterByExtension = function(extension) {
    // Normalize extension (remove dot, lowercase)
    const normalizedExt = extension.toLowerCase().replace(/^\./, '');
    return this.converters[normalizedExt] || null;
};

/**
 * Get converter by MIME type
 * @param {string} mimeType - MIME type
 * @returns {Object|null} Converter or null if not found
 */
ConverterRegistry.prototype.getConverterByMimeType = function(mimeType) {
    // Find converter that supports this MIME type
    for (const [type, converter] of Object.entries(this.converters)) {
        if (converter.config && 
            converter.config.mimeTypes && 
            converter.config.mimeTypes.includes(mimeType)) {
            return converter;
        }
    }
    return null;
};

/**
 * Convert content to markdown using appropriate converter
 * @param {string} type - File type
 * @param {Buffer|string} content - Content to convert
 * @param {Object} options - Conversion options
 * @returns {Promise<Object>} Conversion result
 */
ConverterRegistry.prototype.convertToMarkdown = async function(type, content, options) {
    options = options || {};
    const converter = this.getConverterByExtension(type);
    if (!converter) {
        throw new Error(`No converter found for type: ${type}`);
    }
    
    return await converter.convert(content, options.name || 'file', options.apiKey, options);
};

/**
 * Setup all available converters
 */
ConverterRegistry.prototype.setupConverters = function() {
    try {
        // Import converters from the new location
        const csvConverter = require('./data/CsvConverter');
        const xlsxConverter = require('./data/XlsxConverter');
        const audioConverter = require('./multimedia/AudioConverter');
        const videoConverter = require('./multimedia/VideoConverter');
        const pdfFactory = require('./document/PdfConverterFactory');
        const urlConverter = require('./web/UrlConverter');
        const parentUrlConverter = require('./web/ParentUrlConverter');

        // Register converters
        this.register('csv', csvConverter);
        this.register('xlsx', xlsxConverter);
        this.register('mp3', audioConverter);
        this.register('wav', audioConverter);
        this.register('mp4', videoConverter);
        this.register('pdf', pdfFactory.createConverter());
        this.register('url', urlConverter);
        this.register('parenturl', parentUrlConverter);
        
        const registeredTypes = Object.keys(this.converters);
        console.log(`✅ Converters registered successfully: ${registeredTypes.length} types`);
        console.log(`📋 Registered types: ${registeredTypes.join(', ')}`);
    } catch (error) {
        console.error('❌ Error setting up converters:', error);
        // Add detailed error logging
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        // Throw the error to be handled by the caller
        throw new Error(`Failed to set up converters: ${error.message}`);
    }
};

// Create and export singleton instance
var registry = new ConverterRegistry();
module.exports = registry;
