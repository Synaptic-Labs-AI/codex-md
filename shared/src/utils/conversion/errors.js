/**
 * Error handling utilities for conversions (ES Module version)
 */

// Define error types
export const ERROR_TYPES = {
    FILE_NOT_FOUND: 'FILE_NOT_FOUND',
    INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
    API_ERROR: 'API_ERROR',
    CONVERSION_ERROR: 'CONVERSION_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    PERMISSION_ERROR: 'PERMISSION_ERROR',
    TIMEOUT_ERROR: 'TIMEOUT_ERROR'
};

/**
 * Base class for conversion errors
 */
export class ConversionError extends Error {
    constructor(message, type = ERROR_TYPES.CONVERSION_ERROR, details = {}) {
        super(message);
        this.name = 'ConversionError';
        this.type = type;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }

    toJSON() {
        return {
            name: this.name,
            type: this.type,
            message: this.message,
            details: this.details,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
}

/**
 * Error for file-related issues
 */
export class FileError extends ConversionError {
    constructor(message, details = {}) {
        super(message, ERROR_TYPES.FILE_NOT_FOUND, {
            path: details.path,
            ...details
        });
        this.name = 'FileError';
    }
}

/**
 * Error for API-related issues
 */
export class ApiError extends ConversionError {
    constructor(message, details = {}) {
        super(message, ERROR_TYPES.API_ERROR, {
            statusCode: details.statusCode,
            endpoint: details.endpoint,
            ...details
        });
        this.name = 'ApiError';
    }
}

/**
 * Creates a standardized error response
 * @param {Error} error - Original error
 * @param {Object} context - Additional context
 * @returns {Object} Standardized error response
 */
export function createErrorResponse(error, context = {}) {
    const isConversionError = error instanceof ConversionError;
    
    return {
        success: false,
        error: {
            type: isConversionError ? error.type : ERROR_TYPES.CONVERSION_ERROR,
            message: error.message || 'An unknown error occurred',
            details: isConversionError ? error.details : {},
            context: context,
            timestamp: new Date().toISOString(),
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
    };
}

/**
 * Wraps an async function with standardized error handling
 * @param {Function} fn - Function to wrap
 * @param {Object} context - Additional context
 * @returns {Function} Wrapped function
 */
export function withErrorHandling(fn, context = {}) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            return createErrorResponse(error, {
                arguments: process.env.NODE_ENV === 'development' ? args : undefined,
                ...context
            });
        }
    };
}

/**
 * Determines if a response is an error
 * @param {Object} response - Response to check
 * @returns {boolean} Whether response is an error
 */
export function isErrorResponse(response) {
    return response && 
           response.success === false && 
           response.error &&
           typeof response.error === 'object';
}

/**
 * Extracts error details from a response
 * @param {Object} response - Response to process
 * @returns {Object|null} Error details or null
 */
export function getErrorDetails(response) {
    if (!isErrorResponse(response)) {
        return null;
    }

    const { type, message, details, context } = response.error;
    return { type, message, details, context };
}

/**
 * Formats error for display
 * @param {Error|Object} error - Error to format
 * @returns {string} Formatted error message
 */
export function formatError(error) {
    if (error instanceof ConversionError) {
        return `${error.type}: ${error.message}`;
    }
    
    if (isErrorResponse(error)) {
        return `${error.error.type}: ${error.error.message}`;
    }
    
    return error?.message || 'An unknown error occurred';
}

// Default export for compatibility
export default {
    ERROR_TYPES,
    ConversionError,
    FileError,
    ApiError,
    createErrorResponse,
    withErrorHandling,
    isErrorResponse,
    getErrorDetails,
    formatError
};
