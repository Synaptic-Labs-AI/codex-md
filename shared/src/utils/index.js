/**
 * Main utilities barrel file (ES Module version)
 * Exports all utilities in an organized way
 */

import * as files from './files/index.js';
import * as markdown from './markdown/index.js';
import * as web from './web/index.js';
import * as conversion from './conversion/index.js';
import * as paths from './paths/index.js';

// Re-export major utility groups
export const utils = {
    files: {
        types: files.fileTypes,
        validation: files.fileValidation,
        sanitization: files.fileSanitization
    },
    markdown: {
        document: markdown.document,
        metadata: markdown.metadata,
        format: markdown.format,
        table: markdown.table,
        text: markdown.text
    },
    web: {
        metadata: web.metadata
    },
    conversion: {
        progress: conversion.progress,
        errors: conversion.errors,
        converters: conversion.conversionUtils
    },
    paths: {
        ...paths
    }
};

// Common aliases for frequently used utilities
// File utilities
export const { getFileType, validateFile, sanitizeFilename } = files;

// Markdown utilities
export const { generateMarkdown, formatMetadata } = markdown;

// Web utilities
export const { extractMetadata } = web;

// Conversion utilities
export const { 
    ProgressTracker, 
    ConversionError,
    convertToMarkdown,
    getConverterByExtension,
    getConverterByMimeType,
    FILE_CONVERTERS,
    backendConverters,
    registerConverter,
    registerConverterFactory,
    initializeBackendConverters
} = conversion;

// Re-export all modules
export { files, markdown, web, conversion, paths };

// Default export for compatibility
export default {
    ...files,
    ...markdown,
    ...web,
    ...conversion,
    
    // Utility groups
    utils,
    
    // Common aliases
    getFileType,
    validateFile,
    sanitizeFilename,
    generateMarkdown,
    formatMetadata,
    extractMetadata,
    ProgressTracker,
    ConversionError,
    
    // Path utilities
    ...paths
};
