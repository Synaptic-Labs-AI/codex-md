/**
 * Conversion utilities barrel file (ES Module version)
 * Exports all conversion-related utilities in an organized way
 */

import * as errors from './errors.js';
import * as progress from './progress.js';
import * as converters from './converters.js';

// Re-export all utilities
export const {
    ERROR_TYPES,
    ConversionError,
    FileError,
    ApiError,
    createErrorResponse,
    withErrorHandling,
    isErrorResponse,
    getErrorDetails,
    formatError
} = errors;

export const {
    ProgressTracker
} = progress;

export const {
    FILE_CONVERTERS,
    getConverterByExtension,
    getConverterByMimeType,
    getSupportedExtensions,
    getSupportedMimeTypes,
    validateContent,
    convertToMarkdown,
    backendConverters,
    registerConverter,
    registerConverterFactory,
    initializeBackendConverters
} = converters;

// Group functions by category
export const conversionProgress = {
    ProgressTracker
};

export const conversionErrors = {
    ConversionError,
    FileError,
    ApiError,
    withErrorHandling,
    createErrorResponse,
    isErrorResponse,
    getErrorDetails,
    formatError,
    ERROR_TYPES
};

export const conversionUtils = {
    FILE_CONVERTERS,
    getConverterByExtension,
    getConverterByMimeType,
    getSupportedExtensions,
    getSupportedMimeTypes,
    validateContent,
    convertToMarkdown,
    backendConverters,
    registerConverter,
    registerConverterFactory,
    initializeBackendConverters
};

// Export modules
export { errors, progress, converters };

// Default export for compatibility
export default {
    // Errors
    ERROR_TYPES,
    ConversionError,
    FileError,
    ApiError,
    createErrorResponse,
    withErrorHandling,
    isErrorResponse,
    getErrorDetails,
    formatError,
    
    // Progress
    ProgressTracker,
    
    // Converters
    FILE_CONVERTERS,
    getConverterByExtension,
    getConverterByMimeType,
    getSupportedExtensions,
    getSupportedMimeTypes,
    validateContent,
    convertToMarkdown,
    backendConverters,
    registerConverter,
    registerConverterFactory,
    initializeBackendConverters,
    
    // Grouped exports
    progress: conversionProgress,
    errors: conversionErrors,
    converters: conversionUtils
};
