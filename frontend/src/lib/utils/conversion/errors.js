/**
 * Conversion Error Types
 * Provides standardized error classes for conversion operations
 * 
 * This file centralizes error handling for conversion operations,
 * ensuring consistent error reporting across the frontend.
 */

export class ConversionError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'ConversionError';
        this.type = options.type || 'CONVERSION_ERROR';
        this.details = options.details || {};
        this.originalError = options.originalError;
    }
}

export class ValidationError extends ConversionError {
    constructor(message, options = {}) {
        super(message, { ...options, type: 'VALIDATION_ERROR' });
        this.name = 'ValidationError';
    }
}

export class ApiKeyError extends ConversionError {
    constructor(message, options = {}) {
        super(message, { ...options, type: 'API_KEY_ERROR' });
        this.name = 'ApiKeyError';
    }
}

export default {
    ConversionError,
    ValidationError,
    ApiKeyError
};
