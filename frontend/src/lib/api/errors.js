/**
 * Custom Error Classes
 * 
 * Defines custom error classes used throughout the application.
 * These help provide more specific error handling and better error messages.
 */

/**
 * Base error class for conversion-related errors
 */
export class ConversionError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ConversionError';
    this.options = options;
    this.details = options.details || null;
    this.type = options.type || 'generic';
    this.retryable = options.retryable !== false;
  }
}

/**
 * Error class for validation failures
 */
export class ValidationError extends ConversionError {
  constructor(message, options = {}) {
    super(message, { ...options, type: 'validation' });
    this.name = 'ValidationError';
  }
}

/**
 * Error class for file system operation failures
 */
export class FileSystemError extends ConversionError {
  constructor(message, options = {}) {
    super(message, { ...options, type: 'filesystem' });
    this.name = 'FileSystemError';
    this.path = options.path;
    this.operation = options.operation;
  }
}

/**
 * Error class for network-related failures
 */
export class NetworkError extends ConversionError {
  constructor(message, options = {}) {
    super(message, { ...options, type: 'network' });
    this.name = 'NetworkError';
  }
}

/**
 * Error class for API errors
 */
export class ApiError extends NetworkError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ApiError';
    this.statusCode = options.statusCode;
    this.endpoint = options.endpoint;
  }
}

/**
 * Error class for electron IPC errors
 */
export class ElectronError extends ConversionError {
  constructor(message, options = {}) {
    super(message, { ...options, type: 'electron' });
    this.name = 'ElectronError';
    this.channel = options.channel;
  }
}

/**
 * Creates a specific error instance based on type
 */
export function createError(type, message, options = {}) {
  switch (type) {
    case 'validation':
      return new ValidationError(message, options);
    case 'filesystem':
      return new FileSystemError(message, options);
    case 'network':
      return new NetworkError(message, options);
    case 'api':
      return new ApiError(message, options);
    case 'electron':
      return new ElectronError(message, options);
    default:
      return new ConversionError(message, { ...options, type });
  }
}

/**
 * Format error for user display
 */
export function formatError(error) {
  if (error instanceof ConversionError) {
    return {
      message: error.message,
      type: error.type,
      retryable: error.retryable,
      details: error.details
    };
  }

  return {
    message: error.message || 'An unknown error occurred',
    type: 'unknown',
    retryable: true,
    details: null
  };
}

/**
 * Checks if an error is retryable
 */
export function isRetryable(error) {
  if (error instanceof ConversionError) {
    return error.retryable;
  }
  
  // Network errors are generally retryable
  if (error instanceof NetworkError) {
    return true;
  }
  
  // By default, assume unknown errors are retryable
  return true;
}

/**
 * Helper function to ensure errors are proper Error instances
 */
export function ensureError(error) {
  if (error instanceof Error) {
    return error;
  }
  
  if (typeof error === 'string') {
    return new Error(error);
  }
  
  if (typeof error === 'object') {
    const message = error.message || JSON.stringify(error);
    return new Error(message);
  }
  
  return new Error('An unknown error occurred');
}

/**
 * ErrorUtils - A collection of utility functions for error handling
 * 
 * This object groups all error-related utility functions for easier import
 * and usage throughout the application.
 */
export const ErrorUtils = {
  /**
   * Creates a specific error instance based on type
   */
  createError: (type, message, options = {}) => createError(type, message, options),
  
  /**
   * Format error for user display
   */
  formatError: (error) => formatError(error),
  
  /**
   * Checks if an error is retryable
   */
  isRetryable: (error) => isRetryable(error),
  
  /**
   * Helper function to ensure errors are proper Error instances
   */
  ensureError: (error) => ensureError(error),
  
  /**
   * Wraps any error in a ConversionError if it isn't already one
   */
  wrap: (error) => {
    if (error instanceof ConversionError) {
      return error;
    }
    
    if (error instanceof Error) {
      return new ConversionError(
        error.message,
        { 
          type: 'unknown',
          details: error.stack
        }
      );
    }
    
    return new ConversionError(
      typeof error === 'string' ? error : 'An unknown error occurred',
      { type: 'unknown' }
    );
  }
};
